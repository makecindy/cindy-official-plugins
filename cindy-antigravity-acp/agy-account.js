'use strict';

/**
 * Antigravity sign-in for Cindy's engine accounts, over ACP (the protocol Cindy uses for tasks).
 *
 * Sign-in stays with agy: `authenticate` with agy's Google method makes agy open the browser and
 * keep the token in its own store. Over ACP the plugin only learns whether agy is signed in and the
 * subscription tier name agy reports (`_meta.antigravity.tier`); agy 1.5.18 reports no account
 * identity there, so the identity of an account Cindy added comes from agy's token file in that
 * account's directory (agy-account-dir.js), never from the original login.
 *
 * Verified with agy 1.5.12 (2026-11-19): `authenticate` returns once the browser sign-in finishes.
 * agy in a terminal shares the original sign-in. The plugin never signs agy out.
 */

const { killTree } = require('./resolve-agy.js');
const { accountDirProblem, ensureAccountSubdirs, readAccountTokenMeta } = require('./agy-account-dir.js');
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

function canSignIn(init) {
  return Array.isArray(init.authMethods)
    && init.authMethods.some((method) => method && method.id === GOOGLE_METHOD);
}

/**
 * Whether agy is signed in, and its tier. Resumes the plugin's model-list session when there is one
 * (that also returns the tier); otherwise lists sessions, which opens nothing.
 * @returns {Promise<{ supported: true, signedIn: boolean, tier?: { name: string } }
 *   | { supported: false, reason: 'not-installed' }>}
 */
async function status(params, options) {
  const agy = await openAgy(options);
  if (!agy) return { supported: false, reason: 'not-installed' };
  const { call, init } = agy;
  const base = { supported: true };
  const sessionCaps = (init.agentCapabilities && init.agentCapabilities.sessionCapabilities) || {};
  const sessionId = params && typeof params.sessionId === 'string' && params.sessionId ? params.sessionId : null;
  try {
    if (sessionId && sessionCaps.resume) {
      try {
        const result = await call('session/resume', { sessionId, cwd: probeFolder(), mcpServers: [] });
        const tier = tierFromMeta(result._meta);
        if (sessionCaps.close) await call('session/close', { sessionId }).catch(() => {});
        return { ...base, signedIn: true, ...(tier ? { tier } : {}) };
      } catch (error) {
        if (isSignInRequired(error)) return { ...base, signedIn: false };
        // The session is gone from agy's history: check without it.
      }
    }
    try {
      await call('session/list', { cwd: probeFolder() });
      return { ...base, signedIn: true };
    } catch (error) {
      if (isSignInRequired(error)) return { ...base, signedIn: false };
      throw error;
    }
  } finally {
    agy.close();
  }
}

/** Cindy's engine-account limit for `plan`. */
const MAX_PLAN = 64;

/**
 * The account status as Cindy's engine accounts read it (`accountStatus`): signed in or out,
 * identity (email/name when known from an isolated account's token metadata), fingerprint for
 * duplicate-login deduplication, and the subscription tier name as `plan`. Null when agy is
 * not installed or an explicit `accountDir` is unusable.
 * @returns {Promise<{ state: 'signed-in', identity?: { email?: string, name?: string }, plan?: string, fingerprint?: string } | { state: 'signed-out' } | null>}
 */
async function accountStatus(params, options) {
  const accountDir = options && typeof options.accountDir === 'string' && options.accountDir ? options.accountDir : undefined;
  if (accountDir && accountDirProblem(accountDir, options)) return null;
  const current = await status(params, options);
  if (!current.supported) return null;
  if (!current.signedIn) return { state: 'signed-out' };
  const meta = accountDir ? readAccountTokenMeta(accountDir) : {};
  const rawPlan = (current.tier && current.tier.name)
    || meta.plan
    || (params && typeof params.fallbackPlan === 'string' ? params.fallbackPlan : undefined);
  const plan = typeof rawPlan === 'string' && !/[\u0000-\u001f\u007f-\u009f]/.test(rawPlan)
    ? rawPlan.slice(0, MAX_PLAN).trim()
    : '';
  const identity = meta.email || meta.name
    ? { ...(meta.email ? { email: meta.email } : {}), ...(meta.name ? { name: meta.name } : {}) }
    : undefined;
  return {
    state: 'signed-in',
    ...(identity ? { identity } : {}),
    ...(plan ? { plan } : {}),
    ...(meta.fingerprint ? { fingerprint: meta.fingerprint } : {}),
  };
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
    const result = await state.agy.call('authenticate', { methodId: GOOGLE_METHOD }, timeoutMs);
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

module.exports = { GOOGLE_METHOD, accountStatus, cancelLogin, login, status };
