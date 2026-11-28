'use strict';

/**
 * Short-lived ACP connection to the local agy for the plugin's own requests (model listing,
 * sign-in status, sign-in and sign-out): start `agy acp` with Cindy's session settings, send
 * `initialize`, call methods, then stop agy. Tasks never use this; Cindy runs them through
 * agy-acp.js.
 */

const { acpArgsFor, killTree, resolveAgy, spawnAgy } = require('./resolve-agy.js');

const REQUEST_TIMEOUT_MS = 45_000;
const STOP_GRACE_MS = 3_000;
const MAX_TEXT = 200;

/** ACP's auth_required error (-32000), or an agent message saying sign-in is needed. */
const { isSignInRequired } = require('./agy-account-errors.js');

function text(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

/**
 * The subscription tier agy reports with a session or a sign-in (`_meta.antigravity.tier`,
 * e.g. { name: 'Google AI Pro' }). Only the display name leaves the plugin worker.
 */
function tierFromMeta(meta) {
  const tier = meta && typeof meta === 'object' && meta.antigravity && typeof meta.antigravity === 'object'
    ? meta.antigravity.tier
    : null;
  const name = tier && typeof tier === 'object' ? text(tier.name, MAX_TEXT) : undefined;
  return name ? { name } : undefined;
}

/** Minimal JSON-RPC client over agy's stdio (one message per line). */
function connect(child) {
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
        if (message.error) {
          entry.reject(Object.assign(new Error(message.error.message || 'agy returned an error'), { code: message.error.code }));
        } else {
          entry.resolve(message.result || {});
        }
      } else if (message && message.id !== undefined && typeof message.method === 'string') {
        // A request from agy (e.g. a permission prompt) is never expected here; decline it.
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Not supported' } }) + '\n');
      }
    }
  });
  child.stdin.on('error', failAll);
  child.on('exit', () => failAll(new Error('agy exited')));
  child.on('error', (error) => failAll(error));
  return (method, params, timeoutMs) => new Promise((resolve, reject) => {
    if (disconnectError) {
      reject(disconnectError);
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(`agy did not answer ${method}`), { code: 'TIMEOUT' }));
    }, timeoutMs || REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

/**
 * Starts agy and initializes ACP. Returns null when agy is not installed; otherwise
 * { child, call, init, close }. Always call close() (it ends stdin, then force-stops a lingering agy).
 */
async function openAgy(options) {
  const agyPath = resolveAgy(options);
  if (!agyPath) return null;
  const child = spawnAgy(agyPath, acpArgsFor(options), options);
  if (options && typeof options.onSpawn === 'function') options.onSpawn(child);
  child.stderr.resume();
  const call = connect(child);
  const close = () => {
    try { child.stdin.end(); } catch { /* already closed */ }
    if (child.exitCode !== null || child.signalCode !== null) return;
    const timer = setTimeout(() => killTree(child, 'SIGKILL'), STOP_GRACE_MS);
    if (typeof timer.unref === 'function') timer.unref();
    child.once('exit', () => clearTimeout(timer));
  };
  try {
    const init = await call('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'cindy-agy-acp-plugin', version: '0.1.0' },
    });
    return { child, call, init, close };
  } catch (error) {
    close();
    throw error;
  }
}

module.exports = { connect, isSignInRequired, openAgy, tierFromMeta };
