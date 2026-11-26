'use strict';

/**
 * Classifies explicit Antigravity account / quota / capacity ACP errors into Cindy's
 * plugin-engine account protocol (`error.data._meta.cindy = { kind, resetsAt?, model? }`)
 * so Cindy can cool the failing account and switch tasks to another account in the pool.
 */

const { isObject, isSessionOpen } = require('./agy-mcp.js');

const QUOTA_REASONS = new Set([
  'QUOTA_EXHAUSTED',
  'SUBSCRIPTION_QUOTA_EXHAUSTED',
  'MODEL_QUOTA_EXHAUSTED',
  'GEMINI_ENTERPRISE_USER_QUOTA_EXHAUSTED',
  'SPEND_CAP_REACHED',
]);

const OVERLOADED_REASONS = new Set([
  'MODEL_CAPACITY_EXHAUSTED',
  'CAPACITY_EXHAUSTED',
  'PREFILL_QUEUE_OVERLOADED',
  'OVERLOADED',
  'RATE_LIMITED',
  'RATE_LIMIT_EXCEEDED',
  'UNAVAILABLE',
]);

const AUTH_TEXT = /\bauthentication required\b|\bnot logged into antigravity\b|\bUNAUTHENTICATED\b|\bsign[- ]?in required\b/i;
const QUOTA_TEXT = /you have exhausted your quota|prepaid balance is insufficient|\b(?:subscription|model|daily|weekly)\s+quota\s+(?:exhausted|exceeded)\b|\bexceeded\s+(?:the\s+|your\s+)?(?:subscription|model|daily|weekly)\s+quota\b|(?<![A-Z_])QUOTA_EXHAUSTED\b/i;
const OVERLOADED_TEXT = /\bMODEL_CAPACITY_EXHAUSTED\b|\bPREFILL_QUEUE_OVERLOADED\b|\bCAPACITY_EXHAUSTED\b|\b(?:model|server|service)\s+overloaded\b|\brate[- ]?limit(?:ed| exceeded)?\b/i;

const MAX_TRACKED_REQUESTS = 256;

function parseFutureResetMs(data, now) {
  for (const field of ['resetsAt', 'resetAtMs', 'resetTime', 'quotaResetTime', 'reset_time', 'quota_reset_time']) {
    const value = data[field];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > now) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed) && Number.isSafeInteger(parsed) && parsed > now) return parsed;
    }
  }
  return undefined;
}

function normalizeCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function classifyAccountErrorResponse(message, now = Date.now()) {
  if (!isObject(message)) return message;
  const error = message.error;
  if (!isObject(error) || (error.data !== undefined && !isObject(error.data))) return message;
  const data = error.data ?? {};
  if (data._meta !== undefined && !isObject(data._meta)) return message;
  const meta = data._meta ?? {};
  if (meta.cindy !== undefined) return message;

  const reason = normalizeCode(data.reason);
  const status = normalizeCode(data.status);
  const text = typeof error.message === 'string' ? error.message : '';

  let info;
  if (error.code === -32000 || reason === 'AUTH_REQUIRED' || status === 'UNAUTHENTICATED' || AUTH_TEXT.test(text)) {
    info = { kind: 'auth-required' };
  } else if (
    QUOTA_REASONS.has(reason)
    || QUOTA_REASONS.has(status)
    || (!OVERLOADED_REASONS.has(reason) && !OVERLOADED_REASONS.has(status) && QUOTA_TEXT.test(text))
  ) {
    info = { kind: 'usage-limit' };
    const resetsAt = parseFutureResetMs(data, now);
    if (resetsAt !== undefined) info.resetsAt = resetsAt;
  } else if (OVERLOADED_REASONS.has(reason) || OVERLOADED_REASONS.has(status) || OVERLOADED_TEXT.test(text)) {
    info = { kind: 'overloaded' };
  }

  if (!info) return message;
  return {
    ...message,
    error: {
      ...error,
      data: {
        ...data,
        _meta: {
          ...meta,
          cindy: info,
        },
      },
    },
  };
}

/** Tracks session open / prompt request IDs so only their error responses carry `_meta.cindy`. */
function accountErrorRelay() {
  const pending = new Set();
  return {
    request(message) {
      if (!isObject(message) || message.id === undefined) return;
      if (isSessionOpen(message.method) || message.method === 'session/prompt') {
        if (pending.size >= MAX_TRACKED_REQUESTS) {
          const oldest = pending.values().next().value;
          pending.delete(oldest);
        }
        pending.add(message.id);
      }
    },
    response(message) {
      if (!isObject(message) || message.method !== undefined || message.id === undefined) return message;
      if (!pending.delete(message.id)) return message;
      return classifyAccountErrorResponse(message);
    },
  };
}

module.exports = { accountErrorRelay, classifyAccountErrorResponse };
