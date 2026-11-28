'use strict';

/**
 * Node worker (json-rpc-stdio). One JSON-RPC 2.0 object per line in each direction;
 * stdout carries protocol messages only.
 *
 * Methods:
 *   detect({ locale? }) -> { available, path?, customPath?, customPathConfigured?, version?, reason?, message?, messages?, detail? }
 *     Finds the local agy executable and checks that `agy --version` runs. `message`
 *     is in the requested locale ('zh-CN' or English); `messages` carries both.
 *   setCustomPath({ path, locale? }) -> { ok: true, customPath, detection } | { ok: false, error, detail? }
 *     Validates and probes a user-supplied absolute path to agy before saving it, or clears it
 *     when `path` is an empty string, then returns a fresh detection result.
 *   listModels({ sessionId? })
 *     -> { supported: true, models: [{ id, name, description?, group?, efforts?, defaultEffort? }],
 *          modes?, defaultMode?, sessionId? }
 *      | { supported: false, reason: 'not-installed' | 'not-signed-in' } | { supported: true, error, detail? }
 *     Asks agy over ACP in the plugin's one dedicated session (see agy-models.js); `tier` is the
 *     subscription tier name agy reports.
 *   accountStatus({ harnessId, accountDir? }) -> { state: 'signed-in', identity?, plan?, fingerprint? } | { state: 'signed-out' } | null
 *     Cindy's engine accounts (the engine publishes `accounts: { methods: [{ id: 'oauth-personal', kind: 'browser' }] }`):
 *     reads either the original agy login (no `accountDir`) or an isolated account directory Cindy created.
 *     `identity.email` and `fingerprint` come from agy's own log of the check, for both alike.
 *   accountLogin({ harnessId, accountDir?, methodId: 'oauth-personal' }) -> { ok: true } | { ok: false, error, message? }
 *     Runs agy's Google browser sign-in for the original login or `accountDir`, sending `progress`
 *     notifications every 10 s while waiting.
 *   accountLoginCancel({ harnessId, accountDir? }) -> { ok: true }
 *     Cancels an in-flight Google sign-in for the matching account.
 *   adoptModelSession({ sessionId }) -> { ok: true, adopted } | { ok: false, error: 'invalid' | 'busy' }
 *     main.js hands over the model-list session it saved, so accountStatus can read the tier before
 *     the next listing (plugins upgraded from 0.4.x kept it only in main.js). Kept only when the worker
 *     remembers none; starts no agy.
 *   usage({ harnessId?, accountDir? }) -> { updatedAt, windows } | null   (agy's native /usage, see agy-usage.js)
 *   cliMaintenance({ action, version?, op? }) -> { state, version } | { error }
 *     Checks, installs or updates agy (see cli-installer.cjs). While installing it sends `progress`
 *     keep-alives and `cli-progress` { op, events } notifications for the settings page.
 *   accountLogin answers { ok: false, error: 'busy' } while a custom path is being saved: the account it
 *   would act on is the one of the executable being replaced. There is no sign-out: removing an account
 *   in Cindy only stops Cindy using it.
 *   OAuth tokens stay in agy's own storage and the worker never opens agy's credential files; the
 *   email it reports comes from agy's log, the tier from ACP.
 */

const readline = require('node:readline');
const maintain = require('./cli-installer.cjs');
const { accountDirProblem, hasVerifiedIsolatedSignIn } = require('./agy-account-dir.js');
const { detectAgy, readCustomAgyConfig, runVersion, validateCustomPath, writeCustomAgyPath } = require('./resolve-agy.js');
const { listModels, readModelSession, rememberModelSession } = require('./agy-models.js');
const account = require('./agy-account.js');

const HARNESS_ID = 'agy';
/** Cindy waits 26 s for accountStatus; answer "unknown" before that rather than not at all. */
const ACCOUNT_STATUS_DEADLINE_MS = 20_000;
/** Cindy keeps browser accountLogin alive up to 11 minutes while progress notifications arrive. */
const ACCOUNT_LOGIN_TIMEOUT_MS = 10 * 60_000;
const LOGIN_MESSAGE_MAX = 200;
const ACCOUNT_LOGIN_ERRORS = new Set(['cancelled', 'timeout', 'busy', 'unsupported', 'invalid-secret', 'failed']);

function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function replyError(id, code, message) {
  reply({ jsonrpc: '2.0', id, error: { code, message } });
}

/** `promise`'s value, or `fallback` once `ms` passed (the work itself still finishes and cleans up). */
function withDeadline(promise, ms, fallback) {
  let timer;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

function cleanLoginMessage(text) {
  if (typeof text !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > LOGIN_MESSAGE_MAX ? flat.slice(0, LOGIN_MESSAGE_MAX - 1) + '…' : flat;
}

/**
 * Validates `harnessId` and optional `accountDir` for Cindy's engine-account worker methods.
 * Returns `{ key, accountDir? }` or `null` when the request is not for this engine or names
 * an unusable account directory.
 */
function targetAccountOf(params, harnessRequired) {
  const harnessId = params && params.harnessId;
  if (harnessRequired ? harnessId !== HARNESS_ID : harnessId !== undefined && harnessId !== HARNESS_ID) return null;
  const accountDir = params && params.accountDir !== undefined ? params.accountDir : undefined;
  if (accountDir === undefined) return { key: '' };
  if (accountDirProblem(accountDir)) return null;
  return { key: accountDir, accountDir };
}

const usageReads = new Map();
const accountStatusReads = new Map();
const rememberedPlans = new Map();
const signedInAccountDirs = new Set();
let maintenanceActive = false;
let customPathPending = 0;
let modelSourceRevision = 0;
let customPathQueue = Promise.resolve();
let activeLoginPromise = null;

function clearAccountCaches() {
  usageReads.clear();
  accountStatusReads.clear();
  rememberedPlans.clear();
  signedInAccountDirs.clear();
}

async function applyCustomPath(params) {
  if (maintenanceActive) return { ok: false, error: 'busy' };
  const locale = typeof params.locale === 'string' ? params.locale : undefined;
  const checked = validateCustomPath(params.path);
  if (!checked.ok) return { ok: false, error: checked.error };
  if (checked.path !== null) {
    const probe = await runVersion(checked.path);
    if (!probe.ok) return { ok: false, error: 'not-runnable', detail: probe.detail };
  }
  if (maintenanceActive) return { ok: false, error: 'busy' };
  const saved = writeCustomAgyPath(params.path);
  if (!saved.ok) return { ok: false, error: saved.error };
  clearAccountCaches();
  // Like main.js, start the model listing of the new executable afresh.
  modelSourceRevision += 1;
  rememberModelSession(null);
  const pendingLogin = activeLoginPromise;
  if (pendingLogin) {
    account.cancelLogin();
    await pendingLogin.catch(() => {});
  }
  const detection = await detectAgy({ locale });
  return { ok: true, customPath: saved.customPath, detection };
}

function runAccountLogin(accountDir, timeoutMs) {
  const key = accountDir || '';
  if (customPathPending > 0) return Promise.resolve({ ok: false, error: 'busy' });
  usageReads.delete(key);
  if (activeLoginPromise) return Promise.resolve({ ok: false, error: 'busy' });
  const options = {
    ...(accountDir ? { accountDir } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  };
  const run = Promise.resolve(account.login(options, () => {
    reply({ jsonrpc: '2.0', method: 'progress', params: { stage: 'waiting-for-browser' } });
  })).then((result) => {
    if (result && result.ok) {
      if (result.tier && typeof result.tier.name === 'string' && result.tier.name.trim()) {
        rememberedPlans.set(key, result.tier.name.trim());
      }
      if (accountDir) signedInAccountDirs.add(accountDir);
      reply({ jsonrpc: '2.0', method: 'account-ready', params: {} });
    }
    return result;
  }).finally(() => {
    if (activeLoginPromise === run) activeLoginPromise = null;
    // A status read that started before the sign-in finished may describe the old state.
    accountStatusReads.delete(key);
    usageReads.delete(key);
  });
  activeLoginPromise = run;
  return run;
}

const handlers = {
  cliMaintenance(params) {
    const mutating = params && (params.action === 'install' || params.action === 'update');
    if (mutating && customPathPending > 0) return { error: 'busy' };
    if (params && params.action === 'install' && readCustomAgyConfig().kind !== 'none') {
      return { error: 'custom-path' };
    }
    const result = maintain(params, (method, data) => reply({ jsonrpc: '2.0', method, ...(data ? { params: data } : {}) }));
    if (mutating && result && typeof result.then === 'function') {
      maintenanceActive = true;
      return Promise.resolve(result).finally(() => { maintenanceActive = false; });
    }
    return result;
  },
  usage(params) {
    const target = targetAccountOf(params, false);
    if (!target) return null;
    const { key, accountDir } = target;
    let read = usageReads.get(key);
    if (!read) {
      read = require('./agy-usage.js').readUsage(accountDir ? { accountDir } : undefined)
        .then((result) => (usageReads.get(key) === read ? result : null), () => null)
        .finally(() => {
          if (usageReads.get(key) === read) usageReads.delete(key);
        });
      usageReads.set(key, read);
    }
    return read;
  },
  async detect(params) {
    const locale = params && typeof params.locale === 'string' ? params.locale : undefined;
    return detectAgy({ locale });
  },
  setCustomPath(params) {
    if (!params || typeof params.path !== 'string') return { ok: false, error: 'not-absolute' };
    customPathPending += 1;
    const run = customPathQueue.then(() => applyCustomPath(params));
    customPathQueue = run.catch(() => {});
    return run.finally(() => { customPathPending -= 1; });
  },
  accountStatus(params) {
    const target = targetAccountOf(params, false);
    if (!target) return null;
    const { key, accountDir } = target;
    let read = accountStatusReads.get(key);
    if (!read) {
      // Callers share one check per account (one agy at a time), each with its own deadline.
      const options = accountDir ? { accountDir } : undefined;
      const sessionId = readModelSession(options);
      const fallbackPlan = rememberedPlans.get(key);
      const statusParams = {
        ...(sessionId ? { sessionId } : {}),
        ...(fallbackPlan ? { fallbackPlan } : {}),
      };
      read = account.accountStatus(statusParams, options)
        .then((result) => {
          if (accountStatusReads.get(key) !== read) return null;
          if (accountDir) {
            if (result && result.state === 'signed-in') {
              const wasKnown = signedInAccountDirs.has(accountDir);
              signedInAccountDirs.add(accountDir);
              if (!wasKnown) reply({ jsonrpc: '2.0', method: 'account-ready', params: {} });
            } else if (result && result.state === 'signed-out') {
              signedInAccountDirs.delete(accountDir);
              rememberedPlans.delete(key);
            }
          } else if (result && result.state === 'signed-out') {
            rememberedPlans.delete('');
          }
          return result;
        }, () => null)
        .finally(() => {
          if (accountStatusReads.get(key) === read) accountStatusReads.delete(key);
        });
      accountStatusReads.set(key, read);
    }
    return withDeadline(read, ACCOUNT_STATUS_DEADLINE_MS, null);
  },
  async accountLogin(params) {
    if (!params || params.harnessId !== HARNESS_ID) return { ok: false, error: 'unsupported' };
    if (params.methodId !== account.GOOGLE_METHOD) return { ok: false, error: 'unsupported' };
    if (params.secret !== undefined) return { ok: false, error: 'invalid-secret' };
    const accountDir = params.accountDir !== undefined ? params.accountDir : undefined;
    if (accountDir !== undefined) {
      const problem = accountDirProblem(accountDir);
      if (problem) return { ok: false, error: 'failed', message: cleanLoginMessage(problem) };
    }
    const result = await runAccountLogin(accountDir, ACCOUNT_LOGIN_TIMEOUT_MS);
    if (result && result.ok) return { ok: true };
    const rawError = result && result.error;
    const error = ACCOUNT_LOGIN_ERRORS.has(rawError) ? rawError : 'failed';
    const message = cleanLoginMessage(result && result.detail);
    return { ok: false, error, ...(message ? { message } : {}) };
  },
  async accountLoginCancel(params) {
    if (params && params.harnessId !== undefined && params.harnessId !== HARNESS_ID) return { ok: true };
    const accountDir = params && params.accountDir !== undefined ? params.accountDir : null;
    account.cancelLogin({ accountDir });
    return { ok: true };
  },
  async listModels(params) {
    const revision = modelSourceRevision;
    try {
      const primary = await listModels(params);
      if (primary && primary.supported) {
        if (revision === modelSourceRevision && typeof primary.sessionId === 'string') {
          rememberModelSession(primary.sessionId);
        }
        return primary;
      }
      if (primary && primary.reason === 'not-signed-in') {
        // Default login is signed out: fall back to a signed-in isolated account so Cindy still
        // learns the model catalog and working modes, while reporting defaultSignedOut to main.js.
        for (const dir of [...signedInAccountDirs]) {
          if (accountDirProblem(dir) || !hasVerifiedIsolatedSignIn(dir)) {
            signedInAccountDirs.delete(dir);
            continue;
          }
          const options = { accountDir: dir };
          const savedSession = readModelSession(options);
          const fallback = await listModels(savedSession ? { sessionId: savedSession } : {}, options).catch(() => null);
          if (fallback && fallback.supported) {
            if (revision === modelSourceRevision && typeof fallback.sessionId === 'string') {
              rememberModelSession(fallback.sessionId, options);
            }
            const { sessionId: _unusedSession, tier: _unusedTier, ...catalog } = fallback;
            return { ...catalog, defaultSignedOut: true };
          }
          if (fallback && fallback.reason === 'not-signed-in') signedInAccountDirs.delete(dir);
        }
      }
      return primary;
    } catch (error) {
      return {
        supported: true,
        error: 'list-failed',
        detail: String((error && error.message) || error).slice(0, 300),
      };
    }
  },
  adoptModelSession(params) {
    const sessionId = params && params.sessionId;
    if (typeof sessionId !== 'string' || !sessionId) return { ok: false, error: 'invalid' };
    // The saved session belongs to the executable being replaced.
    if (customPathPending > 0) return { ok: false, error: 'busy' };
    if (readModelSession()) return { ok: true, adopted: false };
    rememberModelSession(sessionId);
    return { ok: true, adopted: readModelSession() === sessionId };
  },
};

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on('line', (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    replyError(null, -32700, 'Parse error');
    return;
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    replyError(null, -32600, 'Invalid request');
    return;
  }
  const hasId = Object.prototype.hasOwnProperty.call(request, 'id') && request.id !== null;
  if (typeof request.method !== 'string') {
    if (hasId) replyError(request.id, -32600, 'Invalid request');
    return;
  }
  const handler = Object.prototype.hasOwnProperty.call(handlers, request.method) ? handlers[request.method] : null;
  if (!handler) {
    if (hasId) replyError(request.id, -32601, 'Method not found');
    return;
  }
  Promise.resolve()
    .then(() => handler(request.params))
    .then(
      (result) => {
        if (hasId) reply({ jsonrpc: '2.0', id: request.id, result });
      },
      (error) => {
        process.stderr.write(`[agy-acp worker] ${request.method} failed: ${error && error.message ? error.message : error}\n`);
        if (hasId) replyError(request.id, -32603, `Antigravity ${request.method} failed`);
      },
    );
});

input.on('close', () => {
  process.exit(0);
});
