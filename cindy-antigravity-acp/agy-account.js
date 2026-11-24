'use strict';

/**
 * Antigravity sign-in for the settings page, over ACP (the protocol Cindy uses for tasks).
 *
 * Sign-in stays with agy: `authenticate` with agy's Google method makes agy open the browser and
 * keep the token in its own store; `logout` makes agy forget it. The plugin never sees a credential
 * or the account email; it only learns whether agy is signed in and the subscription tier name agy
 * reports (`_meta.antigravity.tier`).
 *
 * Verified with agy 1.5.12 (2026-11-19): `authenticate` returns once the browser sign-in finishes;
 * `logout` ignores its params and signs out immediately, so it is only sent after the user
 * confirmed in the settings page. agy in a terminal shares the same sign-in.
 */

const { killTree } = require('./resolve-agy.js');
const { isSignInRequired, openAgy, tierFromMeta } = require('./agy-client.js');
const { probeFolder } = require('./agy-models.js');

/** agy's "Log in with Google" method. */
const GOOGLE_METHOD = 'oauth-personal';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const PROGRESS_INTERVAL_MS = 10_000;
/** How long a cancelled sign-in's agy may take to exit before it is killed. */
const CANCEL_KILL_GRACE_MS = 2_000;
const MAX_DETAIL = 300;

/** The sign-in in progress (at most one): { agy, child, cancelled }. */
let activeLogin = null;

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

function canSignOut(init) {
  const auth = init.agentCapabilities && init.agentCapabilities.auth;
  return Boolean(auth && typeof auth === 'object' && auth.logout);
}

/**
 * Whether agy is signed in, and its tier. Resumes the plugin's model-list session when there is one
 * (that also returns the tier); otherwise lists sessions, which opens nothing.
 * @returns {Promise<{ supported: true, signedIn: boolean, tier?: { name: string }, canSignIn: boolean, canSignOut: boolean }
 *   | { supported: false, reason: 'not-installed' }>}
 */
async function status(params, options) {
  const agy = await openAgy(options);
  if (!agy) return { supported: false, reason: 'not-installed' };
  const { call, init } = agy;
  const base = { supported: true, canSignIn: canSignIn(init), canSignOut: canSignOut(init) };
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
 * The current login as Cindy's engine accounts read it (`accountStatus`): signed in or out, and the
 * tier name as `plan` when the plugin's model-list session is known (resuming it reports the tier).
 * agy keeps one Google sign-in per computer, so this is the only account; ACP does not report the
 * email, so there is no identity. Null when agy is not installed.
 * @returns {Promise<{ state: 'signed-in', plan?: string } | { state: 'signed-out' } | null>}
 */
async function accountStatus(params, options) {
  const current = await status(params, options);
  if (!current.supported) return null;
  if (!current.signedIn) return { state: 'signed-out' };
  const name = current.tier && current.tier.name;
  const plan = typeof name === 'string' && !/[\u0000-\u001f\u007f-\u009f]/.test(name)
    ? name.slice(0, MAX_PLAN).trim()
    : '';
  return { state: 'signed-in', ...(plan ? { plan } : {}) };
}

/**
 * agy's Google sign-in: agy opens the browser and this resolves when the user finished there,
 * cancelled (cancelLogin) or after 5 minutes. `onProgress` runs every 10 s while waiting.
 * @returns {Promise<{ ok: true, tier?: { name: string } } | { ok: false, error: 'busy' | 'not-installed'
 *   | 'unsupported' | 'cancelled' | 'timeout' | 'failed', detail?: string }>}
 */
async function login(options, onProgress) {
  if (activeLogin) return { ok: false, error: 'busy' };
  const state = { agy: null, child: null, cancelled: false };
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
    const result = await state.agy.call('authenticate', { methodId: GOOGLE_METHOD }, LOGIN_TIMEOUT_MS);
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

/** Stops the sign-in in progress (its agy process ends; the browser page can just be closed). */
function cancelLogin() {
  const state = activeLogin;
  if (!state) return { ok: true, cancelled: false };
  state.cancelled = true;
  const child = (state.agy && state.agy.child) || state.child;
  if (child) stopAgy(child);
  return { ok: true, cancelled: true };
}

/**
 * Signs agy out (Cindy's Antigravity tasks and agy in a terminal then need a new sign-in).
 * @returns {Promise<{ ok: true } | { ok: false, error: 'busy' | 'not-installed' | 'unsupported' | 'failed', detail?: string }>}
 */
async function logout(options) {
  if (activeLogin) return { ok: false, error: 'busy' };
  const agy = await openAgy(options);
  if (!agy) return { ok: false, error: 'not-installed' };
  try {
    if (!canSignOut(agy.init)) return { ok: false, error: 'unsupported' };
    await agy.call('logout', {});
    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'failed', detail: detailOf(error) };
  } finally {
    agy.close();
  }
}

module.exports = { GOOGLE_METHOD, accountStatus, cancelLogin, login, logout, status };
