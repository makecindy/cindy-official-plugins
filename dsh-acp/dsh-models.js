'use strict';

/**
 * Lists DeepSeek Harness's models by asking dsh itself over ACP, the same protocol Cindy uses for
 * tasks: the model ids are then exactly the values dsh accepts when a task switches model.
 *
 * dsh keeps every session in its own history, and ACP has no "list models" call outside a
 * session. So the plugin owns one dedicated session in a fixed folder: the first listing opens it,
 * later listings resume it (falling back to a new one if dsh no longer knows it). dsh's history
 * therefore gains at most one entry. Nothing is ever sent as a prompt, so no model is called.
 *
 * Each model's reasoning levels come from dsh's `thought_level` option, which dsh republishes per
 * model: the listing switches that session's model once per model to read them. Only values that
 * are Cindy level ids are reported (dsh's "off" has no Cindy level).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { killTree, resolveDsh, spawnDsh } = require('./resolve-dsh.js');

const PROBE_FOLDER = 'cindy-dsh-model-list';
const REQUEST_TIMEOUT_MS = 45_000;
// The logic page waits 90 seconds, including transport and child shutdown.
const PROBE_TIMEOUT_MS = 80_000;
const STOP_GRACE_MS = 3_000;
const MAX_MODELS = 200;
const MAX_TEXT = 200;
const MAX_ID = 256;
/** Cindy reasoning levels, low → high (the set Cindy maps from ACP thought_level values). */
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function text(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max ? value : undefined;
}

function findModelOption(configOptions) {
  if (!Array.isArray(configOptions)) return undefined;
  return configOptions.find((entry) =>
    entry && typeof entry === 'object' && entry.type === 'select' && (entry.category === 'model' || entry.id === 'model'));
}

/**
 * The reasoning levels of the session's current model: the `thought_level` select option's values
 * that are Cindy level ids (low → high), and its current value as the model's default.
 */
function effortsFromConfigOptions(configOptions) {
  if (!Array.isArray(configOptions)) return {};
  const option = configOptions.find((entry) => entry && typeof entry === 'object' && entry.type === 'select'
    && (entry.category === 'thought_level' || entry.id === 'reasoning_effort' || entry.id === 'thought_level'));
  if (!option || !Array.isArray(option.options)) return {};
  const values = option.options
    .filter((item) => item && typeof item === 'object' && typeof item.value === 'string')
    .map((item) => item.value.toLowerCase());
  const efforts = EFFORTS.filter((level) => values.includes(level));
  if (efforts.length === 0) return {};
  const current = typeof option.currentValue === 'string' ? option.currentValue.toLowerCase() : '';
  return { efforts, ...(efforts.includes(current) ? { defaultEffort: current } : {}) };
}

/** The `model` select option of an ACP session, flattened like Cindy flattens grouped options. */
function modelsFromConfigOptions(configOptions) {
  const option = findModelOption(configOptions);
  if (!option || !Array.isArray(option.options)) return [];
  const models = [];
  const seen = new Set();
  const add = (raw, group) => {
    if (!raw || typeof raw !== 'object' || models.length >= MAX_MODELS) return;
    const id = text(raw.value, MAX_ID);
    const name = text(raw.name, MAX_TEXT);
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    const description = text(raw.description, MAX_TEXT);
    const groupName = text(group, MAX_TEXT);
    models.push({ id, name, ...(description ? { description } : {}), ...(groupName ? { group: groupName } : {}) });
  };
  for (const item of option.options) {
    if (item && typeof item === 'object' && Array.isArray(item.options)) {
      for (const grouped of item.options) add(grouped, item.name);
    } else {
      add(item);
    }
  }
  return models;
}

function probeFolder() {
  const dir = path.join(os.tmpdir(), PROBE_FOLDER);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Minimal JSON-RPC client over dsh's stdio (one message per line). */
function connect(child, deadline) {
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  let disconnectError;
  const failAll = (error) => {
    disconnectError ??= error;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message && message.id !== undefined && message.method === undefined && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(Object.assign(new Error(message.error.message || 'dsh returned an error'), { rpcError: true }));
        else entry.resolve(message.result || {});
      } else if (!disconnectError && message && message.id !== undefined && typeof message.method === 'string') {
        // A request from dsh (e.g. a permission prompt) is never expected here; decline it.
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Not supported' } }) + '\n');
      }
    }
  });
  child.stdin.on('error', failAll);
  child.on('exit', () => failAll(new Error('dsh exited')));
  child.on('error', failAll);
  return (method, params) => new Promise((resolve, reject) => {
    if (disconnectError) return reject(disconnectError);
    const remaining = deadline - performance.now();
    if (remaining <= 0) return reject(new Error('dsh model probe timed out'));
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`dsh did not answer ${method}`));
    }, Math.min(remaining, REQUEST_TIMEOUT_MS));
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

/**
 * @param {{ sessionId?: string }} [params] the dedicated session from the previous listing
 * @returns {Promise<{ supported: true, models: Array<{id: string, name: string, description?: string, group?: string}>, sessionId?: string } | { supported: false, reason: string }>}
 */
async function listModels(params, options) {
  const dshPath = resolveDsh(options);
  if (!dshPath) return { supported: false, reason: 'not-installed' };
  const cwd = probeFolder();
  const child = spawnDsh(dshPath, ['--profile', 'acp'], options);
  child.stderr.resume();
  const call = connect(child, performance.now() + (options?.probeTimeoutMs ?? PROBE_TIMEOUT_MS));
  try {
    const init = await call('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'cindy-dsh-acp-plugin', version: '0.1.0' },
    });
    const sessionCaps = (init.agentCapabilities && init.agentCapabilities.sessionCapabilities) || {};
    const previous = params && typeof params.sessionId === 'string' && params.sessionId ? params.sessionId : null;
    let result = null;
    let sessionId = null;
    if (previous && sessionCaps.resume) {
      try {
        result = await call('session/resume', { sessionId: previous, cwd, mcpServers: [] });
        sessionId = previous;
      } catch (error) {
        if (!error.rpcError) throw error;
        result = null;
      }
    }
    if (!result) {
      result = await call('session/new', { cwd, mcpServers: [] });
      sessionId = typeof result.sessionId === 'string' ? result.sessionId : null;
    }
    const models = modelsFromConfigOptions(result.configOptions);
    const modelOption = findModelOption(result.configOptions);
    const current = modelOption && typeof modelOption.currentValue === 'string' ? modelOption.currentValue : null;
    for (const model of models) {
      let options = model.id === current ? result.configOptions : null;
      if (!options && sessionId && modelOption) {
        // Switching the probe session's model is the only way ACP shows another model's levels.
        const switched = await call('session/set_config_option', { sessionId, configId: modelOption.id, value: model.id })
          .catch(error => {
            if (!error.rpcError) throw error;
            return null;
          });
        options = switched && Array.isArray(switched.configOptions) ? switched.configOptions : null;
      }
      Object.assign(model, effortsFromConfigOptions(options));
    }
    if (sessionId && sessionCaps.close) await call('session/close', { sessionId }).catch(() => {});
    return { supported: true, models, ...(sessionId ? { sessionId } : {}) };
  } finally {
    try { child.stdin.end(); } catch { /* already closed */ }
    if (child.exitCode === null && child.signalCode === null) {
      const timer = setTimeout(() => killTree(child, 'SIGKILL'), STOP_GRACE_MS);
      timer.unref();
      child.once('exit', () => clearTimeout(timer));
    }
  }
}

module.exports = { listModels, modelsFromConfigOptions, effortsFromConfigOptions };
