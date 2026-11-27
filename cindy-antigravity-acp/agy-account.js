'use strict';

/**
 * Antigravity sign-in for Cindy's engine accounts, over ACP (the protocol Cindy uses for tasks).
 *
 * Sign-in stays with agy: `authenticate` with agy's Google method makes agy open the browser and
 * keep the token in its own store. Over ACP the plugin learns whether agy is signed in and the
 * subscription tier name agy reports (`_meta.antigravity.tier`). agy 1.5.18 reports no account
 * identity there; it writes the signed-in email to its own log, so the sign-in check has agy write
 * that run's log to a private temporary file and reads the email from it. The same works for agy's
 * original login and for the accounts Cindy added. The plugin never opens agy's credential files.
 *
 * Verified with agy 1.5.12 (2026-11-19): `authenticate` returns once the browser sign-in finishes.
 * Verified with agy 1.5.18 (2026-11-27): `agy acp --log-file <file>` logs
 * "OAuth: authenticated successfully as <email>" once a request used the sign-in, and no token.
 * agy in a terminal shares the original sign-in. The plugin never signs agy out.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { killTree } = require('./resolve-agy.js');
const {
  accountDirProblem,
  ensureAccountSubdirs,
  hasIsolatedStoreFile,
  hasUpdatedIsolatedStoreFile,
  snapshotIsolatedStoreFiles,
} = require('./agy-account-dir.js');
const { isSignInRequired, openAgy, tierFromMeta } = require('./agy-client.js');
const { probeFolder } = require('./agy-models.js');

/** agy's "Log in with Google" method. */
const GOOGLE_METHOD = 'oauth-personal';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const PROGRESS_INTERVAL_MS = 10_000;
/** How long a cancelled sign-in's agy may take to exit before it is killed. */
const CANCEL_KILL_GRACE_MS = 2_000;
const MAX_DETAIL = 300;

/** The sign-in in progress (at most one): { key, agy, child, cancelled }. */
let activeLogin = null;

function accountKeyOf(options) {
  return options && typeof options.accountDir === 'string' && options.accountDir ? options.accountDir : 'default';
}

function detailOf(error) {
  return String((error && error.message) || error).slice(0, MAX_DETAIL);
}

/**
 * Stops the agy of a cancelled sign-in. One that ignores SIGTERM (for example while stuck in `initialize`)
 * is killed after a short grace, so the cancel always settles instead of waiting for the ACP timeout.
 */
function stopAgy(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  killTree(child);
  const timer = setTimeout(() => killTree(child, 'SIGKILL'), CANCEL_KILL_GRACE_MS);
  if (typeof timer.unref === 'function') timer.unref();
  child.once('exit', () => clearTimeout(timer));
}

const MAX_EMAIL = 254;
/** Enough for the start of a run; the sign-in line comes with the first request that uses it. */
const MAX_STATUS_LOG_BYTES = 1024 * 1024;
const EMAIL_SHAPE = /^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[^\s@<>"',;:]+$/;
const LOG_EMAIL_PATTERNS = [
  /OAuth: authenticated successfully as (\S+)/g,
  /applyAuthResult: email=([^,\s]+)/g,
];

/**
 * The signed-in email in agy's log text (its last mention), or undefined. Anything that is not a
 * plain email address is ignored, so a changed log format means "no identity", never a wrong one.
 */
function emailFromAgyLog(text) {
  if (typeof text !== 'string') return undefined;
  for (const pattern of LOG_EMAIL_PATTERNS) {
    let found;
    for (const match of text.matchAll(pattern)) found = match[1];
    if (found && found.length <= MAX_EMAIL && EMAIL_SHAPE.test(found)) return found;
  }
  return undefined;
}

/** Stable digest of the account for Cindy's duplicate-login check; holds no credential. */
function fingerprintOf(email) {
  return crypto.createHash('sha256').update(`antigravity-google:${email.toLowerCase()}`).digest('hex').slice(0, 32);
}

/**
 * A private temporary file for the log of one sign-in check: { file, readEmail(), remove() }, or
 * null when it cannot be created (the check then runs without it and reports no identity).
 */
function openStatusLog() {
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-agy-status-'));
  } catch {
    return null;
  }
  const file = path.join(dir, 'agy.log');
  return {
    file,
    readEmail() {
      let handle;
      try {
        handle = fs.openSync(file, 'r');
        const buffer = Buffer.alloc(Math.min(fs.fstatSync(handle).size, MAX_STATUS_LOG_BYTES));
        fs.readSync(handle, buffer, 0, buffer.length, 0);
        return emailFromAgyLog(buffer.toString('utf8'));
      } catch {
        return undefined;
      } finally {
        if (handle !== undefined) fs.closeSync(handle);
      }
    },
    remove() {
      // agy may still hold the file for a moment after it was asked to stop (Windows refuses to delete it then).
      fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }, () => {});
    },
  };
}

/** The log is written by agy, not by the reply: give the line a moment to reach the file. */
async function readStatusEmail(log) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const email = log.readEmail();
    if (email) return email;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

function canSignIn(init) {
  return Array.isArray(init.authMethods)
    && init.authMethods.some((method) => method && method.id === GOOGLE_METHOD);
}

/**
 * Whether agy is signed in, and its tier. Resumes the plugin's model-list session when there is one
 * (that also returns the tier); otherwise lists sessions, which opens nothing.
 * @returns {Promise<{ supported: true, signedIn: boolean, tier?: { name: string }, email?: string }
 *   | { supported: false, reason: 'not-installed' }>}
 */
async function status(params, options) {
  let log = openStatusLog();
  let agy;
  try {
    agy = await openAgy(log ? { ...options, logFile: log.file } : options);
  } catch (error) {
    if (!log || !error || error.code !== 'UNSAFE_PATH') {
      if (log) log.remove();
      throw error;
    }
    // The temporary folder cannot be passed to this agy (a cmd.exe shim): check without the identity.
    log.remove();
    log = null;
    agy = await openAgy(options);
  }
  if (!agy) {
    if (log) log.remove();
    return { supported: false, reason: 'not-installed' };
  }
  const { call, init } = agy;
  const base = { supported: true };
  const sessionCaps = (init.agentCapabilities && init.agentCapabilities.sessionCapabilities) || {};
  const sessionId = params && typeof params.sessionId === 'string' && params.sessionId ? params.sessionId : null;
  const accountDir = options && typeof options.accountDir === 'string' && options.accountDir ? options.accountDir : undefined;
  const signedIn = async (tier) => {
    if (accountDir && !hasIsolatedStoreFile(accountDir, options)) {
      try {
        process.stderr.write('[agy-acp] Ignoring signed-in status for isolated account directory without isolated sign-in files.\n');
      } catch { /* ignore */ }
      return { ...base, signedIn: false };
    }
    const email = log ? await readStatusEmail(log) : undefined;
    return { ...base, signedIn: true, ...(tier ? { tier } : {}), ...(email ? { email } : {}) };
  };
  try {
    if (sessionId && sessionCaps.resume) {
      try {
        const result = await call('session/resume', { sessionId, cwd: probeFolder(), mcpServers: [] });
        const tier = tierFromMeta(result._meta);
        const answer = await signedIn(tier);
        if (sessionCaps.close) await call('session/close', { sessionId }).catch(() => {});
        return answer;
      } catch (error) {
        if (isSignInRequired(error)) return { ...base, signedIn: false };
        // The session is gone from agy's history: check without it.
      }
    }
    try {
      await call('session/list', { cwd: probeFolder() });
      return await signedIn();
    } catch (error) {
      if (isSignInRequired(error)) return { ...base, signedIn: false };
      throw error;
    }
  } finally {
    agy.close();
    if (log) log.remove();
  }
}

/** Cindy's engine-account limit for `plan`. */
const MAX_PLAN = 64;

/**
 * The account status as Cindy's engine accounts read it (`accountStatus`): signed in or out, the
 * account's email as identity (from agy's log of this check, for the original login and for added
 * accounts alike), its digest as fingerprint for duplicate-login deduplication, and the subscription
 * tier name as `plan`. Null when agy is not installed or an explicit `accountDir` is unusable.
 * @returns {Promise<{ state: 'signed-in', identity?: { email: string }, plan?: string, fingerprint?: string } | { state: 'signed-out' } | null>}
 */
async function accountStatus(params, options) {
  const accountDir = options && typeof options.accountDir === 'string' && options.accountDir ? options.accountDir : undefined;
  if (accountDir && accountDirProblem(accountDir, options)) return null;
  const current = await status(params, options);
  if (!current.supported) return null;
  if (!current.signedIn) return { state: 'signed-out' };
  const rawPlan = (current.tier && current.tier.name)
    || (params && typeof params.fallbackPlan === 'string' ? params.fallbackPlan : undefined);
  const plan = typeof rawPlan === 'string' && !/[\u0000-\u001f\u007f-\u009f]/.test(rawPlan)
    ? rawPlan.slice(0, MAX_PLAN).trim()
    : '';
  return {
    state: 'signed-in',
    ...(current.email ? { identity: { email: current.email } } : {}),
    ...(plan ? { plan } : {}),
    ...(current.email ? { fingerprint: fingerprintOf(current.email) } : {}),
  };
}

/**
 * Verifies that agy honours isolated storage by checking that a fresh empty account directory
 * requires sign-in. If it appears signed in, agy is ignoring file-based isolation and falling back
 * to the OS keyring / default login.
 */
async function probeEmptyDirIsolation(options, state) {
  let tmpDir;
  let probeAgy = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-agy-iso-'));
    ensureAccountSubdirs(tmpDir);
    probeAgy = await openAgy({
      ...(options && typeof options === 'object' ? options : null),
      accountDir: tmpDir,
      logFile: undefined,
      onSpawn: (child) => {
        if (state) {
          state.child = child;
          if (state.cancelled) stopAgy(child);
        }
      },
    });
    if (!probeAgy) return { ok: false, error: 'not-installed' };
    if (state && state.cancelled) return { ok: false, error: 'cancelled' };
    try {
      await probeAgy.call('session/list', { cwd: probeFolder() });
      return { ok: true, isolated: false };
    } catch (error) {
      if (state && state.cancelled) return { ok: false, error: 'cancelled' };
      if (isSignInRequired(error)) return { ok: true, isolated: true };
      throw error;
    }
  } finally {
    if (probeAgy) probeAgy.close();
    if (tmpDir) fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }, () => {});
  }
}

/**
 * agy's Google sign-in: agy opens the browser and this resolves when the user finished there,
 * cancelled (cancelLogin) or timed out. `onProgress` runs every 10 s while waiting.
 * When `options.accountDir` is set, agy keeps the sign-in in that isolated directory.
 * @returns {Promise<{ ok: true, tier?: { name: string } } | { ok: false, error: 'busy' | 'not-installed'
 *   | 'unsupported' | 'cancelled' | 'timeout' | 'failed', detail?: string }>}
 */
async function login(options, onProgress) {
  if (activeLogin) return { ok: false, error: 'busy' };
  const accountDir = options && typeof options.accountDir === 'string' && options.accountDir ? options.accountDir : undefined;
  if (accountDir) {
    const problem = accountDirProblem(accountDir, options);
    if (problem) return { ok: false, error: 'failed', detail: problem };
    try {
      ensureAccountSubdirs(accountDir);
    } catch (error) {
      return { ok: false, error: 'failed', detail: detailOf(error) };
    }
  }
  const timeoutMs = (options && typeof options.timeoutMs === 'number' && options.timeoutMs > 0)
    ? options.timeoutMs
    : LOGIN_TIMEOUT_MS;
  const state = { key: accountKeyOf(options), agy: null, child: null, cancelled: false };
  activeLogin = state;
  const ticker = setInterval(() => { if (onProgress) onProgress(); }, PROGRESS_INTERVAL_MS);
  try {
    let existingStore = null;
    if (accountDir) {
      existingStore = snapshotIsolatedStoreFiles(accountDir, options);
      if (existingStore.size > 0) {
        // Re-login into an existing isolated directory: check with a fresh empty directory first so
        // an agy build that ignores file-based isolation cannot overwrite the default keyring login.
        const preProbe = await probeEmptyDirIsolation(options, state);
        if (!preProbe.ok) return preProbe;
        if (!preProbe.isolated) {
          return {
            ok: false,
            error: 'failed',
            detail: 'Antigravity ignored isolated account storage; aborted sign-in to protect the default login.',
          };
        }
      }
    }
    state.agy = await openAgy({
      ...(options && typeof options === 'object' ? options : null),
      onSpawn: (child) => {
        state.child = child;
        if (state.cancelled) stopAgy(child);
      },
    });
    if (!state.agy) return { ok: false, error: 'not-installed' };
    if (state.cancelled) return { ok: false, error: 'cancelled' };
    if (!canSignIn(state.agy.init)) return { ok: false, error: 'unsupported' };
    let beforeAuthStore = existingStore;
    if (accountDir) {
      if (existingStore.size === 0) {
        // Fresh isolated directory: verify agy sees it as signed out before calling authenticate,
        // protecting the user's default keyring login if a future agy ignores file token storage.
        try {
          await state.agy.call('session/list', { cwd: probeFolder() });
          return {
            ok: false,
            error: 'failed',
            detail: 'Antigravity ignored isolated account storage; aborted sign-in to protect the default login.',
          };
        } catch (error) {
          if (state.cancelled) return { ok: false, error: 'cancelled' };
          if (!isSignInRequired(error)) throw error;
        }
      }
      beforeAuthStore = snapshotIsolatedStoreFiles(accountDir, options);
    }
    const result = await state.agy.call('authenticate', { methodId: GOOGLE_METHOD }, timeoutMs);
    if (state.cancelled) return { ok: false, error: 'cancelled' };
    if (accountDir) {
      const afterAuthStore = snapshotIsolatedStoreFiles(accountDir, options);
      if (afterAuthStore.size === 0 || (beforeAuthStore.size === 0 && !hasUpdatedIsolatedStoreFile(beforeAuthStore, afterAuthStore))) {
        return {
          ok: false,
          error: 'failed',
          detail: 'Antigravity did not store the sign-in inside the isolated account directory.',
        };
      }
      state.agy.close();
      state.agy = null;
      const postProbe = await probeEmptyDirIsolation(options, state);
      if (!postProbe.ok) return postProbe;
      if (!postProbe.isolated) {
        return {
          ok: false,
          error: 'failed',
          detail: 'Antigravity leaked the sign-in outside the isolated account directory.',
        };
      }
    }
    const tier = tierFromMeta(result._meta);
    return { ok: true, ...(tier ? { tier } : {}) };
  } catch (error) {
    if (state.cancelled) return { ok: false, error: 'cancelled' };
    if (error && error.code === 'TIMEOUT') return { ok: false, error: 'timeout' };
    return { ok: false, error: 'failed', detail: detailOf(error) };
  } finally {
    clearInterval(ticker);
    if (activeLogin === state) activeLogin = null;
    if (state.agy) state.agy.close();
  }
}

/**
 * Stops the sign-in in progress (its agy process ends; the browser page can just be closed).
 * When `options.accountDir` is specified (including `null` for the original login), only cancels a
 * matching login; omitting `options` cancels whichever login is running.
 */
function cancelLogin(options) {
  const state = activeLogin;
  if (!state) return { ok: true, cancelled: false };
  if (options && Object.prototype.hasOwnProperty.call(options, 'accountDir')) {
    const key = options.accountDir ? options.accountDir : 'default';
    if (state.key !== key) return { ok: true, cancelled: false };
  }
  state.cancelled = true;
  const child = (state.agy && state.agy.child) || state.child;
  if (child) stopAgy(child);
  return { ok: true, cancelled: true };
}

module.exports = { GOOGLE_METHOD, accountStatus, cancelLogin, emailFromAgyLog, login, status };
