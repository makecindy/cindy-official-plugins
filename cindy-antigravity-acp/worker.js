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
 *   account({ sessionId? }) -> { supported: true, signedIn, tier?, canSignIn, canSignOut }
 *      | { supported: false, reason } | { supported: true, error, detail? }
 *   accountStatus({ harnessId, accountDir? }) -> { state: 'signed-in', plan? } | { state: 'signed-out' } | null
 *     Cindy's engine accounts (the engine publishes `accounts: { methods: [] }`): agy's one login and
 *     its tier name as `plan`, read like `account` with the dedicated model-list session the last
 *     listModels used. null when agy is missing, the check fails or takes longer than 20 s, and for
 *     an `accountDir` (the plugin never offers to add accounts).
 *   adoptModelSession({ sessionId }) -> { ok: true, adopted } | { ok: false, error: 'invalid' | 'busy' }
 *     main.js hands over the model-list session it saved, so accountStatus can read the tier before
 *     the next listing (plugins upgraded from 0.4.x kept it only in main.js). Kept only when the worker
 *     remembers none; starts no agy.
 *   usage({ harnessId }) -> { updatedAt, windows } | null   (agy's native /usage, see agy-usage.js)
 *   login() -> { ok: true, tier? } | { ok: false, error, detail? }
 *     agy's Google sign-in: agy opens the browser; answers when the sign-in finished, was cancelled
 *     or after 5 minutes. Sends a `progress` notification every 10 s meanwhile (keeps Cindy's
 *     request alive).
 *   cancelLogin() -> { ok: true, cancelled }
 *   cliMaintenance({ action, version?, op? }) -> { state, version } | { error }
 *     Checks, installs or updates agy (see cli-installer.cjs). While installing it sends `progress`
 *     keep-alives and `cli-progress` { op, events } notifications for the settings page.
 *   logout() -> { ok: true } | { ok: false, error, detail? }
 *     Signs agy out; the settings page only asks after the user confirmed.
 *   login() and logout() answer { ok: false, error: 'busy' } while a custom path is being saved: the account
 *   they would act on is the one of the executable being replaced.
 *   Sign-in stays with agy (see agy-account.js); the plugin never sees credentials or the email.
 */

const readline = require('node:readline');
const maintain = require('./cli-installer.cjs');
const { detectAgy, readCustomAgyConfig, runVersion, validateCustomPath, writeCustomAgyPath } = require('./resolve-agy.js');
const { listModels, readModelSession, rememberModelSession } = require('./agy-models.js');
const account = require('./agy-account.js');

const HARNESS_ID = 'agy';
/** Cindy waits 26 s for accountStatus; answer "unknown" before that rather than not at all. */
const ACCOUNT_STATUS_DEADLINE_MS = 20_000;

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

let usageRead;
let accountStatusRead;
let maintenanceActive = false;
let customPathPending = 0;
let modelSourceRevision = 0;
let customPathQueue = Promise.resolve();
let activeLoginPromise = null;

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
  usageRead = undefined;
  accountStatusRead = undefined;
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
  usage() {
    if (!usageRead) {
      const read = require('./agy-usage.js').readUsage().catch(() => null).finally(() => {
        if (usageRead === read) usageRead = undefined;
      });
      usageRead = read;
    }
    return usageRead;
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
  async account(params) {
    return account.status(params).catch((error) => ({
      supported: true,
      error: 'status-failed',
      detail: String((error && error.message) || error).slice(0, 300),
    }));
  },
  accountStatus(params) {
    if (params && (params.accountDir != null || (params.harnessId !== undefined && params.harnessId !== HARNESS_ID))) {
      return null;
    }
    if (!accountStatusRead) {
      // Callers share one check (one agy at a time), each with its own deadline.
      const sessionId = readModelSession();
      const read = account.accountStatus(sessionId ? { sessionId } : {})
        .then((result) => accountStatusRead === read ? result : null, () => null)
        .finally(() => {
          if (accountStatusRead === read) accountStatusRead = undefined;
        });
      accountStatusRead = read;
    }
    return withDeadline(accountStatusRead, ACCOUNT_STATUS_DEADLINE_MS, null);
  },
  login() {
    if (customPathPending > 0) return Promise.resolve({ ok: false, error: 'busy' });
    usageRead = undefined;
    if (activeLoginPromise) return Promise.resolve({ ok: false, error: 'busy' });
    const run = Promise.resolve(account.login(undefined, () => {
      reply({ jsonrpc: '2.0', method: 'progress', params: { stage: 'waiting-for-browser' } });
    })).finally(() => {
      if (activeLoginPromise === run) activeLoginPromise = null;
      // A status read that started before the sign-in finished may describe the old state.
      accountStatusRead = undefined;
    });
    activeLoginPromise = run;
    return run;
  },
  async cancelLogin() {
    return account.cancelLogin();
  },
  async logout() {
    if (customPathPending > 0) return { ok: false, error: 'busy' };
    usageRead = undefined;
    return account.logout().finally(() => { accountStatusRead = undefined; });
  },
  async listModels(params) {
    const revision = modelSourceRevision;
    return listModels(params).then((result) => {
      if (revision === modelSourceRevision && typeof result?.sessionId === 'string') {
        rememberModelSession(result.sessionId);
      }
      return result;
    }, (error) => ({
      supported: true,
      error: 'list-failed',
      detail: String((error && error.message) || error).slice(0, 300),
    }));
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
