'use strict';

/**
 * Classifies Antigravity account / quota / capacity ACP errors into Cindy's
 * plugin-engine account protocol (`error.data._meta.cindy = { kind, resetsAt?, model? }`).
 *
 * Also handles `agy acp`'s step-error wire behavior: `agy` often reports quota or
 * capacity failures as a standalone `\n⚠ <message>\n` `agent_message_chunk`
 * followed by a normal `session/prompt` result (`stopReason: "end_turn"`). The
 * relay holds a single classified warning chunk while a prompt is active, flushes
 * it immediately if real content follows, and converts a terminal warning-only
 * ending into a classified JSON-RPC error so Cindy handles it like built-in models.
 */

const { isObject, isSessionOpen } = require('./agy-mcp.js');
const { hasIsolatedStoreFile } = require('./agy-account-dir.js');

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
const QUOTA_TEXT = /you have exhausted your quota|prepaid balance is insufficient|\b(?:individual|subscription|model|daily|weekly|monthly)\s+quota\s+(?:reached|exhausted|exceeded)\b|\bexceeded\s+(?:the\s+|your\s+)?(?:individual|subscription|model|daily|weekly|monthly)\s+quota\b|\busage[\s_-]?limit[\s_-]?(?:reached|exceeded)\b|(?<![A-Z_])QUOTA_EXHAUSTED\b/i;
const OVERLOADED_TEXT = /\bMODEL_CAPACITY_EXHAUSTED\b|\bPREFILL_QUEUE_OVERLOADED\b|\bCAPACITY_EXHAUSTED\b|\b(?:model|server|service)\s+overloaded\b|\brate[- ]?limit(?:ed| exceeded)?\b/i;

const WARNING_CHUNK_RE = /^\r?\n⚠ ([^\r\n]+)\r?\n$/;
const RELATIVE_RESET_RE = /\b(?:resets?|retry(?:\s+after)?|try\s+again)\s+(?:in\s+)?(?:~\s*|about\s+)?(?:(\d+)\s*d(?:ays?)?\s*)?(?:(\d+)\s*h(?:ours?|rs?)?\s*)?(?:(\d+)\s*m(?:in(?:ute)?s?)?\s*)?(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?(?=$|[\s.,;!?)])/i;
const ISO_TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})\b/g;

/** Matches Cindy's USAGE_LIMIT_MAX_WAIT_MS (8 days) so bogus relative durations are ignored. */
const MAX_RELATIVE_RESET_MS = 8 * 24 * 60 * 60 * 1000;
const MAX_TRACKED_REQUESTS = 256;

/** Updates that prove the agent continued doing work/output after a warning chunk. */
const CONTENT_SESSION_UPDATES = new Set([
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
  'plan_update',
  'user_message_chunk',
]);

function parseRelativeResetMs(text, now) {
  if (typeof text !== 'string' || !text) return undefined;
  const match = RELATIVE_RESET_RE.exec(text);
  if (!match || (match[1] === undefined && match[2] === undefined && match[3] === undefined && match[4] === undefined)) {
    return undefined;
  }
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const delayMs = (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  if (!Number.isSafeInteger(delayMs) || delayMs <= 0 || delayMs > MAX_RELATIVE_RESET_MS) return undefined;
  return now + delayMs;
}

function parseTextIsoResetMs(text, now) {
  if (typeof text !== 'string' || !text) return undefined;
  for (const value of text.match(ISO_TIMESTAMP_RE) ?? []) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && Number.isSafeInteger(parsed) && parsed > now) return parsed;
  }
  return undefined;
}

function parseFutureResetMs(data, text, now) {
  if (isObject(data)) {
    for (const field of ['resetsAt', 'resetAtMs', 'resetTime', 'quotaResetTime', 'reset_time', 'quota_reset_time']) {
      const value = data[field];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value > now) return value;
      if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed) && Number.isSafeInteger(parsed) && parsed > now) return parsed;
      }
    }
  }
  return parseTextIsoResetMs(text, now) ?? parseRelativeResetMs(text, now);
}

function normalizeCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function classifyAccountErrorInfo({ code, data, text, now }) {
  const reason = isObject(data) ? normalizeCode(data.reason) : '';
  const status = isObject(data) ? normalizeCode(data.status) : '';
  const message = typeof text === 'string' ? text : '';

  if (code === -32000 || reason === 'AUTH_REQUIRED' || status === 'UNAUTHENTICATED' || AUTH_TEXT.test(message)) {
    return { kind: 'auth-required' };
  }
  if (
    QUOTA_REASONS.has(reason)
    || QUOTA_REASONS.has(status)
    || (!OVERLOADED_REASONS.has(reason) && !OVERLOADED_REASONS.has(status) && QUOTA_TEXT.test(message))
  ) {
    const info = { kind: 'usage-limit' };
    const resetsAt = parseFutureResetMs(data, message, now);
    if (resetsAt !== undefined) info.resetsAt = resetsAt;
    return info;
  }
  if (OVERLOADED_REASONS.has(reason) || OVERLOADED_REASONS.has(status) || OVERLOADED_TEXT.test(message)) {
    return { kind: 'overloaded' };
  }
  return null;
}

function attachCindyMeta(message, info) {
  const error = message.error;
  const data = isObject(error.data) ? error.data : {};
  const meta = isObject(data._meta) ? data._meta : {};
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

function classifyAccountErrorResponse(message, now = Date.now()) {
  if (!isObject(message)) return message;
  const error = message.error;
  if (!isObject(error) || (error.data !== undefined && !isObject(error.data))) return message;
  const data = error.data ?? {};
  if (data._meta !== undefined && !isObject(data._meta)) return message;
  const meta = data._meta ?? {};
  if (meta.cindy !== undefined) return message;

  const info = classifyAccountErrorInfo({
    code: error.code,
    data,
    text: typeof error.message === 'string' ? error.message : '',
    now,
  });
  if (!info) return message;
  return attachCindyMeta(message, info);
}

/**
 * Tracks session open / prompt request IDs and agy's warning chunks so both
 * explicit JSON-RPC errors and terminal `⚠ <error>` message chunks carry `_meta.cindy`.
 */
function accountErrorRelay(nowFn = Date.now, options) {
  const accountDir = options && typeof options.accountDir === 'string' && options.accountDir ? options.accountDir : null;
  const onIsolationViolation = options && typeof options.onIsolationViolation === 'function' ? options.onIsolationViolation : null;
  const pending = new Map();

  function activePrompt(sessionId) {
    for (const entry of pending.values()) {
      if (entry.sessionId === sessionId) return entry;
    }
  }

  return {
    request(message) {
      if (!isObject(message) || message.id === undefined) return;
      const sessionOpen = isSessionOpen(message.method);
      if (sessionOpen || message.method === 'session/prompt') {
        if (pending.size >= MAX_TRACKED_REQUESTS) {
          const oldest = pending.keys().next().value;
          pending.delete(oldest);
        }
        const sessionId = message.method === 'session/prompt' && typeof message.params?.sessionId === 'string'
          ? message.params.sessionId
          : undefined;
        // Notifications only identify the session. Overlapping prompts cannot attribute a text warning.
        const previous = sessionId && activePrompt(sessionId);
        if (previous) previous.canInferWarning = false;
        pending.set(message.id, { sessionId, sessionOpen, canInferWarning: !previous, warning: null });
      }
    },

    notification(message) {
      if (!isObject(message) || message.method !== 'session/update') return null;
      const params = isObject(message.params) ? message.params : null;
      const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : null;
      const update = isObject(params?.update) ? params.update : null;
      if (!sessionId || !update) return null;

      const prompt = activePrompt(sessionId);
      if (!prompt || !CONTENT_SESSION_UPDATES.has(update.sessionUpdate)) return null;

      if (prompt.warning) {
        // More content makes the held chunk part of the visible reply, even if the next chunk is also a warning.
        const { rawMessage } = prompt.warning;
        prompt.warning = null;
        prompt.canInferWarning = false;
        return { hold: false, flush: [rawMessage] };
      }

      if (update.sessionUpdate !== 'agent_message_chunk' || !prompt.canInferWarning) return null;
      const content = update.content;
      if (content?.type === 'text' && typeof content.text === 'string') {
        if (!content.text.trim()) return null;
        // ACP puts this CLI fallback on the same channel as model text. Never interpret a quotation
        // inside an existing answer as an account signal. Explicit RPC errors are handled separately.
        const match = WARNING_CHUNK_RE.exec(content.text);
        if (match) {
          const errorText = match[1];
          const info = classifyAccountErrorInfo({ text: errorText, now: nowFn() });
          if (info) {
            prompt.warning = { rawMessage: message, errorText, info };
            return { hold: true };
          }
        }
      }
      prompt.canInferWarning = false;
      return null;
    },

    response(message, flush) {
      if (!isObject(message) || message.method !== undefined || message.id === undefined) return message;
      const tracked = pending.get(message.id);
      if (!tracked) return message;
      pending.delete(message.id);
      const held = tracked.canInferWarning ? tracked.warning : null;
      if (!held && tracked.warning) flush?.(tracked.warning.rawMessage);

      if (tracked.sessionOpen && accountDir && message.error === undefined && isObject(message.result) && !hasIsolatedStoreFile(accountDir)) {
        if (onIsolationViolation) onIsolationViolation();
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32000,
            message: 'Antigravity ignored isolated account storage; refusing to run on the default login.',
            data: { _meta: { cindy: { kind: 'auth-required' } } },
          },
        };
      }

      if (isObject(message.error)) {
        const classified = classifyAccountErrorResponse(message, nowFn());
        if (classified !== message || !held) return classified;
        if (message.error.data !== undefined && !isObject(message.error.data)) return message;
        if (isObject(message.error.data) && message.error.data._meta !== undefined && !isObject(message.error.data._meta)) {
          return message;
        }
        if (isObject(message.error.data?._meta) && message.error.data._meta.cindy !== undefined) return message;
        return attachCindyMeta(message, held.info);
      }

      if (held && message.result?.stopReason === 'end_turn') {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: held.info.kind === 'auth-required' ? -32000 : -32603,
            message: held.errorText,
            data: {
              _meta: {
                cindy: held.info,
              },
            },
          },
        };
      }

      if (held) flush?.(held.rawMessage);
      return message;
    },
  };
}

module.exports = { accountErrorRelay, classifyAccountErrorResponse };
