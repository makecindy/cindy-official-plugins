'use strict';

/**
 * Lists Antigravity's models, reasoning levels and working modes by asking agy itself over ACP,
 * the same protocol Cindy uses for tasks: the ids are exactly the values agy accepts in a task.
 *
 * agy keeps every session in its own history, and ACP has no "list models" call outside a session.
 * So the plugin owns one dedicated session in a fixed folder: the first listing opens it, later
 * listings resume it (falling back to a new one if agy no longer knows it). agy's history therefore
 * gains at most one entry. Nothing is ever sent as a prompt, so no model is called.
 *
 * Each model's reasoning levels come from agy's `thought_level` option, which agy republishes per
 * model: the listing switches that session's model once per model to read them. Only values that
 * are Cindy level ids are reported. The `mode` option (default / accept-edits / auto / plan) is
 * reported as Cindy permission mode ids, and the subscription tier agy attaches to the session as
 * `tier`. A session that cannot start because agy is not signed in reports `not-signed-in`.
 */

const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isSignInRequired, openAgy, tierFromMeta } = require('./agy-client.js');
const { configFilePath } = require('./resolve-agy.js');

const PROBE_FOLDER = 'cindy-agy-model-list';
/**
 * Where the worker remembers that dedicated session (next to the custom path config), so a status
 * check can resume it for the tier instead of opening a new session in agy's history.
 */
const SESSION_FILE_NAME = 'model-session.json';
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_SESSION_FILE_BYTES = 1024;
const MAX_MODELS = 200;
const MAX_TEXT = 200;
const MAX_ID = 256;
/** Cindy reasoning levels, low → high (the set Cindy maps from ACP thought_level values). */
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/** Cindy permission modes an agent mode can stand for (same rule as Cindy's ACP engine). */
const MODES = ['default', 'acceptEdits', 'auto', 'plan'];

function modeKey(value) {
  return value.toLowerCase().replace(/[-_\s]/g, '');
}

/** agy's working modes as Cindy permission mode ids, in agy's order, and the one it starts in. */
function modesFromConfigOptions(configOptions) {
  if (!Array.isArray(configOptions)) return {};
  const option = configOptions.find((entry) => entry && typeof entry === 'object' && entry.type === 'select'
    && (entry.category === 'mode' || entry.id === 'mode'));
  if (!option || !Array.isArray(option.options)) return {};
  const modes = [];
  let defaultMode;
  for (const item of option.options) {
    if (!item || typeof item !== 'object' || typeof item.value !== 'string') continue;
    const mode = MODES.find((candidate) => modeKey(candidate) === modeKey(item.value));
    if (!mode || modes.includes(mode)) continue;
    modes.push(mode);
    if (item.value === option.currentValue) defaultMode = mode;
  }
  if (modes.length === 0) return {};
  return { modes, ...(defaultMode ? { defaultMode } : {}) };
}

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

function sessionFilePath(options) {
  const config = configFilePath(options);
  return config ? path.join(path.dirname(config), SESSION_FILE_NAME) : null;
}

/** The dedicated session of the last listing, or null (none yet, unreadable or malformed). */
function readModelSession(options) {
  const file = sessionFilePath(options);
  if (!file) return null;
  try {
    if (fs.statSync(file).size > MAX_SESSION_FILE_BYTES) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data.sessionId === 'string' && SESSION_ID.test(data.sessionId) ? data.sessionId : null;
  } catch {
    return null;
  }
}

/** Remembers the dedicated session (best effort; `null` forgets it, e.g. after the agy path changed). */
function rememberModelSession(sessionId, options) {
  const file = sessionFilePath(options);
  if (!file) return;
  try {
    if (sessionId === null) {
      fs.rmSync(file, { force: true });
      return;
    }
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || readModelSession(options) === sessionId) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ sessionId }) + '\n', { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(tmp, file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  } catch {
    // Only the tier of a later status check depends on it.
  }
}

/**
 * @param {{ sessionId?: string }} [params] the dedicated session from the previous listing
 * @returns {Promise<{ supported: true, models: Array<{id: string, name: string, description?: string, group?: string}>,
 *   modes?: string[], defaultMode?: string, tier?: { name: string }, sessionId?: string } | { supported: false, reason: string }>}
 */
async function listModels(params, options) {
  const agy = await openAgy(options);
  if (!agy) return { supported: false, reason: 'not-installed' };
  const { call, init } = agy;
  const cwd = probeFolder();
  try {
    const sessionCaps = (init.agentCapabilities && init.agentCapabilities.sessionCapabilities) || {};
    const previous = params && typeof params.sessionId === 'string' && params.sessionId ? params.sessionId : null;
    let result = null;
    let sessionId = null;
    if (previous && sessionCaps.resume) {
      try {
        result = await call('session/resume', { sessionId: previous, cwd, mcpServers: [] });
        sessionId = previous;
      } catch {
        result = null;
      }
    }
    if (!result) {
      try {
        result = await call('session/new', { cwd, mcpServers: [] });
      } catch (error) {
        if (isSignInRequired(error)) return { supported: false, reason: 'not-signed-in' };
        throw error;
      }
      sessionId = typeof result.sessionId === 'string' ? result.sessionId : null;
    }
    const modes = modesFromConfigOptions(result.configOptions);
    const tier = tierFromMeta(result._meta);
    const models = modelsFromConfigOptions(result.configOptions);
    const modelOption = findModelOption(result.configOptions);
    const current = modelOption && typeof modelOption.currentValue === 'string' ? modelOption.currentValue : null;
    for (const model of models) {
      let options = model.id === current ? result.configOptions : null;
      if (!options && sessionId && modelOption) {
        // Switching the probe session's model is the only way ACP shows another model's levels.
        const switched = await call('session/set_config_option', { sessionId, configId: modelOption.id, value: model.id })
          .catch(() => null);
        options = switched && Array.isArray(switched.configOptions) ? switched.configOptions : null;
      }
      Object.assign(model, effortsFromConfigOptions(options));
    }
    if (sessionId && sessionCaps.close) await call('session/close', { sessionId }).catch(() => {});
    return { supported: true, models, ...modes, ...(tier ? { tier } : {}), ...(sessionId ? { sessionId } : {}) };
  } finally {
    agy.close();
  }
}

module.exports = {
  listModels,
  modelsFromConfigOptions,
  effortsFromConfigOptions,
  modesFromConfigOptions,
  probeFolder,
  readModelSession,
  rememberModelSession,
};
