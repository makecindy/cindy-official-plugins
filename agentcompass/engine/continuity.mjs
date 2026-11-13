// Vendored from akiiwa-games/magpie-agentcompass-router src/continuity.js at ac494f31dda6dc516e985594208e28fca85aa5fb (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Session Affinity, Turn-Loop Lock, Cache-Temperature Hold & Monotonic Effort Ratchet.
 *
 * Pure ES2022 module (zero `node:*` imports) so it runs identically inside:
 *   1. Magpie's embedded `moejs` Go JS VM (`src/middleware.js`)
 *   2. Magpie's Bun plugin host (`src/hooks.js`, `src/index.js`)
 *   3. Node.js / Bun test runners
 *
 * Aligned with Magpie native router (`internal/gateway/affinity.go`, `rules.go`,
 * `decide.go`, `classify.go`, `user_said_test.go`) and AgentCompass 2M token wear rules.
 */

import {
  DISPATCH_EFFORTS,
  FAMILIES,
  MODEL_ALIASES,
  SCORING_POLICY as DEFAULT_SCORING_POLICY,
  canonicalModel,
  healthKey,
  modelSpec,
  resolveModel,
} from "./catalog.mjs";
import { defaultScoredModels } from "./axis-scores.mjs";
import { dispatchAllowedEfforts } from "./candidate-eval.mjs";
import { isModelQuotaExhausted } from "./quota.mjs";

/** The scored models a call reads (the host's own `options.models` when it gives some). */
const modelsOf = (options) => (options && options.models) || defaultScoredModels();
const aliasesOf = (options) => (options && options.aliases) || MODEL_ALIASES;

/** The row of a model a session runs on: its context window and whether the public data says it takes images. */
const specOf = (model, options) => modelSpec(model, modelsOf(options), aliasesOf(options), FAMILIES);

/** Whether the public data cites image input for this model (unknown is not yes: a turn that needs images routes again). */
const takesImages = (spec) => (((spec || {}).five_axis || {}).image_input || {}).status === "yes";

export const CACHE_WORTH_TOKENS = 1024;
export const CACHE_COLD_MS = 5 * 60 * 1000;
export const CHATGPT_CODEX_COLD_MS = 60 * 60 * 1000;
export const DEEPSEEK_COLD_MS = 60 * 60 * 1000;
export const CACHE_HOUR_MS = 60 * 60 * 1000;
export const STICK_KEEP_MS = 24 * 60 * 60 * 1000;
export const UNHEALTHY_COOLDOWN_MS = 5 * 60 * 1000;
export const WORKER_WORN_TOKENS = 2_000_000;
export const CONTEXT_OUTGROWN_RATIO = 0.95;
export const COMPACTION_DROP_RATIO = 0.5;

const EFFORT_RANK = {
  none: 0,
  off: 0,
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 4,
  ultra: 4,
};

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(n, x) {
  return (x >>> n) | (x << (32 - n));
}

function utf8Bytes(str) {
  const s = String(str || "");
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

/**
 * Pure ES2022 SHA-256 hex digest (compatible with `moejs` without `node:crypto`).
 */
export function sha256Hex(input) {
  const bytes = utf8Bytes(input);
  const bitLenHi = Math.floor((bytes.length * 8) / 0x100000000);
  const bitLenLo = (bytes.length * 8) >>> 0;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  bytes.push(
    (bitLenHi >>> 24) & 0xff,
    (bitLenHi >>> 16) & 0xff,
    (bitLenHi >>> 8) & 0xff,
    bitLenHi & 0xff,
    (bitLenLo >>> 24) & 0xff,
    (bitLenLo >>> 16) & 0xff,
    (bitLenLo >>> 8) & 0xff,
    bitLenLo & 0xff
  );

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Array(64);
  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      const j = i + t * 4;
      w[t] =
        ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = (rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3)) >>> 0;
      const s1 = (rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = (rotr(6, e) ^ rotr(11, e) ^ rotr(25, e)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = (rotr(2, a) ^ rotr(13, a) ^ rotr(22, a)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, "0"))
    .join("");
}

const AGENT_TAG_NOISE_PATTERNS = [
  /<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/gi,
  /<task-notification\b[^>]*>[\s\S]*?<\/task-notification>/gi,
  /<plugin_reference\b[^>]*>[\s\S]*?<\/plugin_reference>/gi,
  /<environment_context\b[^>]*>[\s\S]*?<\/environment_context>/gi,
  /<turn_aborted\b[^>]*>[\s\S]*?<\/turn_aborted>/gi,
  /<external_codex_apps_open_page\b[^>]*>[\s\S]*?<\/external_codex_apps_open_page>/gi,
  /<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/gi,
  /<user-prompt-submit-hook\b[^>]*>[\s\S]*?<\/user-prompt-submit-hook>/gi,
];

const AGENT_PARAGRAPH_NOISE_PATTERNS = [
  /^#\s*AGENTS\.md instructions\b[\s\S]*$/i,
  /^The TodoWrite tool hasn't been used recently\b[\s\S]*$/i,
  /^Available agent types\b[\s\S]*$/i,
  /^\[System note:[\s\S]*\]$/i,
];

export const MAX_NOISE_STRIP_CHARS = 8000;
export const MAX_USER_TURN_CHARS = 4000;
export const MAX_FIRST_WORDS_HASH_CHARS = 1024;
const PARAGRAPH_NOISE_FAST_RE = /AGENTS\.md|TodoWrite|Available agent types|\[System note:/i;

function capTextSlice(text, maxChars = MAX_USER_TURN_CHARS) {
  if (!text || typeof text !== "string") return "";
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.625);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n${text.slice(-tail)}`;
}

/**
 * Strip agent-injected reminder tags and boilerplate blocks (`internal/gateway/classify.go` & `user_said_test.go`).
 */
export function stripAgentNoise(rawText) {
  if (!rawText || typeof rawText !== "string") return "";
  let cleaned =
    rawText.length > MAX_NOISE_STRIP_CHARS
      ? `${rawText.slice(0, 5000)}\n\n${rawText.slice(-3000)}`
      : rawText;
  const hadTags = cleaned.includes("<");
  if (hadTags) {
    for (const re of AGENT_TAG_NOISE_PATTERNS) {
      cleaned = cleaned.replace(re, " ");
    }
  }
  if (!hadTags && !PARAGRAPH_NOISE_FAST_RE.test(cleaned)) {
    return cleaned.trim();
  }
  const blocks = cleaned
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .filter((block) => !AGENT_PARAGRAPH_NOISE_PATTERNS.some((re) => re.test(block)));
  return blocks.join("\n\n").trim();
}

/**
 * Return cleaned genuine user speech, or `""` if the message only contained agent-injected noise.
 */
export function userSaidFromText(rawText) {
  return stripAgentNoise(rawText);
}

function extractPartText(part) {
  if (!part) return "";
  if (typeof part === "string") return part;
  if (typeof part.text === "string") return part.text;
  if (typeof part.input_text === "string") return part.input_text;
  if (typeof part.content === "string") return part.content;
  if (Array.isArray(part.content)) {
    return part.content.map(extractPartText).filter(Boolean).join("\n");
  }
  return "";
}

function measurePartChars(part) {
  if (!part) return 0;
  if (typeof part === "string") return part.length;
  if (typeof part.text === "string") return part.text.length;
  if (typeof part.input_text === "string") return part.input_text.length;
  if (typeof part.content === "string") return part.content.length;
  if (Array.isArray(part.content)) {
    let sum = 0;
    for (const sub of part.content) sum += measurePartChars(sub);
    return sum;
  }
  return 0;
}

function partHasVisual(part) {
  if (!part || typeof part !== "object") return false;
  const t = String(part.type || "").toLowerCase();
  if (
    t === "image" ||
    t === "image_url" ||
    t === "input_image" ||
    t === "video" ||
    t === "video_url" ||
    t === "input_video" ||
    part.fileData ||
    part.file_data
  ) {
    return true;
  }
  if (part.image_url || part.inline_data || part.inlineData) {
    const mime =
      part.inline_data?.mime_type ||
      part.inlineData?.mimeType ||
      part.source?.media_type ||
      "";
    if (!mime || mime.startsWith("image/") || mime.startsWith("video/")) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a single protocol message/item (OpenAI Chat, Responses API, Anthropic, Gemini)
 * into a normalized step record for turn-loop and `firstWords` analysis.
 */
function inspectMessageItem(item, options = {}) {
  if (!item || typeof item !== "object") {
    return {
      role: "",
      rawUserText: "",
      userSaid: "",
      assistantText: "",
      isToolStep: false,
      isAssistantStep: false,
      hasVisual: false,
      charCount: 0,
    };
  }

  const needFullText = options.needFullText !== false;
  const needAssistantText = Boolean(options.needAssistantText);
  const role = String(item.role || "").toLowerCase();
  const itemType = String(item.type || "").toLowerCase();

  // OpenAI Responses API top-level function_call / function_call_output / reasoning items
  if (
    itemType === "function_call_output" ||
    itemType === "custom_tool_call_output" ||
    itemType === "tool_result" ||
    role === "tool" ||
    role === "function"
  ) {
    let hasVisual = false;
    let charCount = typeof item.content === "string" ? item.content.length : 0;
    if (Array.isArray(item.content)) {
      for (const p of item.content) {
        if (partHasVisual(p)) hasVisual = true;
        charCount += measurePartChars(p);
      }
    } else if (Array.isArray(item.output)) {
      for (const p of item.output) {
        if (partHasVisual(p)) hasVisual = true;
        charCount += measurePartChars(p);
      }
    } else if (typeof item.output === "string") {
      charCount += item.output.length;
    }
    return {
      role: "tool",
      rawUserText: "",
      userSaid: "",
      assistantText: "",
      isToolStep: true,
      isAssistantStep: false,
      hasVisual,
      charCount,
    };
  }

  if (
    itemType === "function_call" ||
    itemType === "custom_tool_call" ||
    itemType === "tool_use" ||
    itemType === "reasoning"
  ) {
    const summary = typeof item.summary === "string" ? item.summary : "";
    return {
      role: "assistant",
      rawUserText: "",
      userSaid: "",
      assistantText: needAssistantText ? summary.slice(0, 1000) : "",
      isToolStep: true,
      isAssistantStep: true,
      hasVisual: false,
      charCount: summary.length + (typeof item.arguments === "string" ? item.arguments.length : 0),
    };
  }

  const content =
    item.content !== undefined
      ? item.content
      : item.parts !== undefined
        ? item.parts
        : typeof item.text === "string"
          ? item.text
          : "";
  const collectStrings = role === "user" ? needFullText : needAssistantText;
  const maxCollectChars = role === "user" ? MAX_NOISE_STRIP_CHARS : 1000;
  let collected = "";
  let charCount = 0;
  let sawToolResultBlock = false;
  let sawToolUseBlock = false;
  let sawNonToolUserBlock = false;
  let hasVisual = false;

  if (typeof content === "string") {
    charCount = content.length;
    if (collectStrings) {
      collected =
        content.length > maxCollectChars ? capTextSlice(content, maxCollectChars) : content;
    }
    if (role === "user") sawNonToolUserBlock = true;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part) continue;
      if (typeof part === "string") {
        charCount += part.length;
        if (collectStrings && collected.length < maxCollectChars) {
          collected += (collected ? "\n" : "") + part.slice(0, maxCollectChars - collected.length);
        }
        if (role === "user") sawNonToolUserBlock = true;
        continue;
      }
      if (partHasVisual(part)) {
        hasVisual = true;
      }
      const pType = String(part.type || "").toLowerCase();
      if (
        pType === "tool_result" ||
        pType === "function_call_output" ||
        pType === "custom_tool_call_output" ||
        part.functionResponse
      ) {
        sawToolResultBlock = true;
        charCount += measurePartChars(part);
        continue;
      }
      if (
        pType === "tool_use" ||
        pType === "function_call" ||
        pType === "custom_tool_call" ||
        part.functionCall
      ) {
        sawToolUseBlock = true;
        charCount += measurePartChars(part);
        continue;
      }
      if (pType === "thinking" || pType === "redacted_thinking") {
        charCount += typeof part.thinking === "string" ? part.thinking.length : 0;
        continue;
      }
      const partLen = measurePartChars(part);
      charCount += partLen;
      if (partLen > 0) {
        if (role === "user") sawNonToolUserBlock = true;
        if (collectStrings && collected.length < maxCollectChars) {
          const t = extractPartText(part);
          if (t) {
            const slice =
              t.length > maxCollectChars - collected.length
                ? capTextSlice(t, maxCollectChars - collected.length)
                : t;
            collected += (collected ? "\n" : "") + slice;
          }
        }
      }
    }
  }

  const joinedText = collected.trim();

  if (role === "assistant" || role === "model") {
    const hasToolCalls =
      sawToolUseBlock || (Array.isArray(item.tool_calls) && item.tool_calls.length > 0);
    return {
      role: "assistant",
      rawUserText: "",
      userSaid: "",
      assistantText: needAssistantText ? joinedText : "",
      isToolStep: hasToolCalls,
      isAssistantStep: true,
      hasVisual,
      charCount,
      scannedChars: needAssistantText ? joinedText.length : 0,
    };
  }

  if (role === "user") {
    const said = needFullText && sawNonToolUserBlock ? userSaidFromText(joinedText) : "";
    const hasUserSpeech = needFullText ? Boolean(said) : sawNonToolUserBlock;
    const isPureToolOrNoise = !hasUserSpeech && sawToolResultBlock;
    return {
      role: isPureToolOrNoise ? "tool" : "user",
      rawUserText: needFullText ? capTextSlice(joinedText, MAX_USER_TURN_CHARS) : "",
      userSaid: needFullText ? capTextSlice(said, MAX_USER_TURN_CHARS) : hasUserSpeech ? "1" : "",
      assistantText: "",
      isToolStep: sawToolResultBlock && !hasUserSpeech,
      isAssistantStep: false,
      hasVisual,
      charCount,
      scannedChars: needFullText && sawNonToolUserBlock ? joinedText.length : 0,
    };
  }

  return {
    role,
    rawUserText: "",
    userSaid: "",
    assistantText: "",
    isToolStep: false,
    isAssistantStep: false,
    hasVisual,
    charCount,
  };
}

function getNormalizedItems(body) {
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.messages)) return body.messages;
  if (Array.isArray(body.input)) return body.input;
  if (Array.isArray(body.contents)) return body.contents;
  if (typeof body.input === "string" && body.input.trim()) {
    return [{ role: "user", content: body.input }];
  }
  if (typeof body.prompt === "string" && body.prompt.trim()) {
    return [{ role: "user", content: body.prompt }];
  }
  return [];
}

/**
 * Compute session `firstWords` fingerprint (inspired by `internal/gateway/rules.go:153`,
 * hashing the first 1,024 chars of the first genuine user message text rather than the
 * full unbounded string so huge initial context blocks stay sub-millisecond).
 */
export function firstWords(body) {
  const items = getNormalizedItems(body);
  for (const item of items) {
    const info = inspectMessageItem(item, { needFullText: true, needAssistantText: false });
    if (info.userSaid) {
      return sha256Hex(info.userSaid.slice(0, MAX_FIRST_WORDS_HASH_CHARS)).slice(0, 24);
    }
  }
  return "";
}

/**
 * The latest genuine user turns of the conversation the client resent, newest first:
 * `{ index, stamp }`. `index` is the item's position, so the body cut after it is the
 * request that turn began with; `stamp` names the turn (`<index>:<hash>`) and stays the same as
 * the conversation grows, since history is only appended to. Scans back from the end and stops
 * after `max` turns, so a long conversation costs no more than its last few turns.
 */
export function recentUserTurns(body, max = 6) {
  const items = getNormalizedItems(body);
  const turns = [];
  for (let i = items.length - 1; i >= 0 && turns.length < max; i--) {
    const item = items[i];
    if (!item || typeof item !== "object" || String(item.role || "").toLowerCase() !== "user") {
      continue;
    }
    const info = inspectMessageItem(item, { needFullText: true, needAssistantText: false });
    if (!info.userSaid) continue;
    turns.push({
      index: i,
      stamp: `${i}:${sha256Hex(info.userSaid.slice(0, MAX_FIRST_WORDS_HASH_CHARS)).slice(0, 16)}`,
    });
  }
  return turns;
}

/**
 * `body` as it was when the item at `index` was its last: the request that began that turn,
 * for the router to decide again what that request was given.
 */
export function bodyUpTo(body, index) {
  const cut = { ...body };
  delete cut.estimated_input_tokens;
  if (Array.isArray(body.messages)) cut.messages = body.messages.slice(0, index + 1);
  else if (Array.isArray(body.input)) cut.input = body.input.slice(0, index + 1);
  else if (Array.isArray(body.contents)) cut.contents = body.contents.slice(0, index + 1);
  return cut;
}

function getHeaderCaseInsensitive(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target && typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return "";
}

/**
 * Compute session & subagent isolation key (`internal/gateway/rules.go:141 ruleKey` & `affinity.go:524 stickKey`).
 * Combines explicit session/conversation ID, `firstWords(body)`, and `x-claude-code-agent-id` so
 * subagents sharing a parent session never clobber the main session's sticky provider/model.
 */
export function computeSessionKey(body = {}, ctx = {}, precomputedFirstWords = undefined) {
  const headers = ctx?.headers || body?.headers || {};
  const metadata = body?.metadata || ctx?.metadata || {};

  const explicitSession =
    ctx?.session ||
    ctx?.session_id ||
    ctx?.sessionId ||
    ctx?.conversation_id ||
    ctx?.conversationId ||
    getHeaderCaseInsensitive(headers, "x-session-id") ||
    getHeaderCaseInsensitive(headers, "x-conversation-id") ||
    getHeaderCaseInsensitive(headers, "session_id") ||
    getHeaderCaseInsensitive(headers, "conversation_id") ||
    body?.session_id ||
    body?.sessionId ||
    body?.conversation_id ||
    body?.conversationId ||
    body?.prompt_cache_key ||
    metadata?.session_id ||
    metadata?.conversation_id ||
    (typeof metadata?.user_id === "string" ? metadata.user_id : "") ||
    (typeof body?.user === "string" ? body.user : "") ||
    "";

  const agentId =
    ctx?.agent_id ||
    ctx?.agentId ||
    getHeaderCaseInsensitive(headers, "x-claude-code-agent-id") ||
    getHeaderCaseInsensitive(headers, "x-agent-id") ||
    metadata?.agent_id ||
    body?.agent_id ||
    "";

  const fw = precomputedFirstWords !== undefined ? precomputedFirstWords : firstWords(body);
  const prevRespId =
    typeof body?.previous_response_id === "string" ? body.previous_response_id.trim() : "";

  let baseKey = "";
  if (explicitSession && fw) {
    baseKey = `${explicitSession}\x00${fw}`;
  } else if (explicitSession) {
    baseKey = String(explicitSession);
  } else if (fw) {
    baseKey = fw;
  } else if (prevRespId) {
    baseKey = `resp:${prevRespId}`;
  }

  if (agentId) {
    return baseKey ? `${baseKey}\x00${agentId}` : `agent:${agentId}`;
  }
  return baseKey;
}

/**
 * Analyze conversation turn count and mid-turn tool loop state (`internal/gateway/affinity.go:393 turnIn`).
 *
 * `within === true` when the request is a mid-turn continuation (tool result or agent-injected
 * reminder after an assistant/tool step with no new genuine `userSaid`).
 */
export function analyzeTurnState(body = {}, ctx = {}) {
  const items = getNormalizedItems(body);
  const len = items.length;

  // Find the last index of a potential user turn so we only extract full text on the first user turn
  // and the last 2 user turns (avoiding expensive string joins & regexes on 40+ middle turns).
  let recentUserBoundary = Math.max(0, len - 6);
  let userCandidatesSeenFromEnd = 0;
  for (let i = len - 1; i >= 0; i--) {
    const it = items[i];
    if (it && typeof it === "object" && String(it.role || "").toLowerCase() === "user") {
      userCandidatesSeenFromEnd += 1;
      if (userCandidatesSeenFromEnd >= 3) {
        recentUserBoundary = Math.min(recentUserBoundary, i);
        break;
      }
    }
  }

  let turn = 0;
  let sawStep = false;
  let within = false;
  let hasAnyVisual = false;
  let hasCurrentTurnVisual = false;
  let totalChars = 0;
  let scannedChars = 0;
  let extractedTurns = 0;
  let isToolFollowup = false;
  let firstUserSaid = "";
  let lastUserText = "";
  let previousUserText = "";
  let previousAssistantText = "";

  for (let i = 0; i < len; i++) {
    const item = items[i];
    const needFullText = !firstUserSaid || i >= recentUserBoundary;
    const needAssistantText = i >= len - 3;
    const info = inspectMessageItem(item, { needFullText, needAssistantText });
    totalChars += info.charCount;
    scannedChars += info.scannedChars || 0;
    if (info.hasVisual) {
      hasAnyVisual = true;
    }
    if (i === len - 1 && info.isToolStep) {
      isToolFollowup = true;
    }

    if (info.isAssistantStep || info.isToolStep) {
      sawStep = true;
      within = true;
      if (info.hasVisual) {
        hasCurrentTurnVisual = true;
      }
      if (info.assistantText) {
        previousAssistantText = info.assistantText;
      }
      continue;
    }

    if (info.userSaid) {
      turn += 1;
      if (!firstUserSaid) {
        firstUserSaid = info.userSaid;
      }
      if (needFullText) {
        extractedTurns += 1;
        previousUserText = lastUserText;
        lastUserText = info.userSaid;
      }
      hasCurrentTurnVisual = info.hasVisual;
      if (sawStep) {
        within = false;
      }
    }
  }

  // OpenAI Responses API continuation where `previous_response_id` is passed with tool outputs
  if (
    typeof body?.previous_response_id === "string" &&
    body.previous_response_id.trim() &&
    turn === 0 &&
    len > 0
  ) {
    within = true;
    turn = 1;
  }

  if (ctx?.within === true) {
    within = true;
  }

  const fw = firstUserSaid
    ? sha256Hex(firstUserSaid.slice(0, MAX_FIRST_WORDS_HASH_CHARS)).slice(0, 24)
    : "";

  return {
    turn,
    within,
    isToolFollowup,
    totalChars,
    scannedChars,
    extractedTurns,
    lastUserText,
    previousUserText,
    previousAssistantText,
    hasAnyVisual,
    hasCurrentTurnVisual,
    firstWords: fw,
    sessionKey: computeSessionKey(body, ctx, fw),
  };
}

/**
 * Determine KV cache cold TTL in milliseconds (`internal/gateway/affinity.go:1007 coldAfter`).
 * - ChatGPT / Codex Responses API: 1 hour
 * - DeepSeek prefix cache: 1 hour
 * - Anthropic 1h cache TTL option: 1 hour
 * - Default (Anthropic / OpenAI / Gemini): 5 minutes
 */
export function coldAfterMs(providerOrModel = "", options = {}) {
  if (Number.isFinite(options?.coldAfterMs) && options.coldAfterMs > 0) {
    return Number(options.coldAfterMs);
  }
  if (options?.cacheTtl === "1h" || options?.longCache === true) {
    return CACHE_HOUR_MS;
  }
  const lower = String(providerOrModel || "").toLowerCase();
  if (
    lower.includes("chatgpt") ||
    lower.includes("codex") ||
    lower.includes("gpt-6.1-sol") ||
    lower.includes("gpt-6-sol")
  ) {
    return CHATGPT_CODEX_COLD_MS;
  }
  if (lower.includes("deepseek")) {
    return DEEPSEEK_COLD_MS;
  }
  return CACHE_COLD_MS;
}

/**
 * Monotonically ratchet effort (`low < medium < high < xhigh/max`) so effort never drops
 * while a session's KV cache is warm (`internal/gateway/rules.go:404 keepsEffort`).
 */
export function ratchetEffort(prevEffort, wantedEffort, allowedEfforts = ["low", "medium", "high"]) {
  const prevRank = EFFORT_RANK[String(prevEffort || "").toLowerCase()] ?? 0;
  const wantedRank = EFFORT_RANK[String(wantedEffort || "").toLowerCase()] ?? 0;
  const targetRank = Math.max(prevRank, wantedRank);

  if (targetRank <= wantedRank && wantedEffort) {
    return wantedEffort;
  }

  const candidateEffort = prevRank >= wantedRank ? prevEffort : wantedEffort;
  if (Array.isArray(allowedEfforts) && allowedEfforts.length > 0) {
    if (allowedEfforts.includes(candidateEffort)) {
      return candidateEffort;
    }
    if ((candidateEffort === "max" || candidateEffort === "xhigh") && allowedEfforts.includes("xhigh")) {
      return "xhigh";
    }
    if ((candidateEffort === "max" || candidateEffort === "xhigh") && allowedEfforts.includes("max")) {
      return "max";
    }
    return allowedEfforts[allowedEfforts.length - 1];
  }
  return candidateEffort || "high";
}

/**
 * Apply Magpie's `keepsEffort` rule (`internal/gateway/rules.go:404`):
 * When staying on the same model and KV cache is still warm (not cold and not compacted),
 * preserve at least the previous reasoning effort.
 */
export function keepsEffort(
  sessionState,
  wantedEffort,
  currentTokens = 0,
  now = Date.now(),
  options = {}
) {
  if (!sessionState || !sessionState.effort || !sessionState.model) {
    return wantedEffort || "medium";
  }
  const ttlMs = coldAfterMs(sessionState.provider || sessionState.model, {
    ...sessionState,
    ...options,
  });
  const ageMs = Math.max(0, now - (sessionState.updatedAt || 0));
  const prevTokens = Number(sessionState.tokens || 0);
  const prevReqTokens = Number(sessionState.requestTokens || 0);
  const compacted =
    (options?.hasExplicitEstimatedTokens &&
      prevTokens >= CACHE_WORTH_TOKENS &&
      currentTokens > 0 &&
      currentTokens < prevTokens * COMPACTION_DROP_RATIO) ||
    (prevReqTokens >= CACHE_WORTH_TOKENS &&
      currentTokens > 0 &&
      currentTokens < prevReqTokens * COMPACTION_DROP_RATIO);
  const isWarm =
    !compacted &&
    sessionState.ageKnown !== false &&
    ageMs <= ttlMs &&
    (sessionState.cached === true ||
      prevTokens >= CACHE_WORTH_TOKENS ||
      currentTokens >= CACHE_WORTH_TOKENS);

  if (!isWarm) {
    return wantedEffort || "medium";
  }

  const fleet = { models: modelsOf(options), aliases: aliasesOf(options), families: FAMILIES, dispatch_efforts: DISPATCH_EFFORTS };
  const allowed = dispatchAllowedEfforts({ provider: sessionState.provider || "", model: sessionState.model }, fleet, sessionState.model);
  return ratchetEffort(sessionState.effort, wantedEffort, allowed || undefined);
}

/**
 * Evaluate whether the router should HOLD the current session's Provider/Model (`shouldHold: true`)
 * or execute intent routing to select/switch a Provider/Model (`shouldHold: false`).
 *
 * Hold reasons (`shouldHold: true`):
 *   - `"turn"`: mid-turn tool call / tool result loop (`within === true`)
 *   - `"cache"`: KV cache is worth holding (`>= 1024` tokens or `cached: true`) and still warm
 *   - `"session"`: `affinityMode === "session"` and model is healthy & within limits
 *   - `"strict"`: `affinityMode === "strict"` and model is healthy
 *
 * Switch / Re-route reasons (`shouldHold: false`):
 *   - `"first"`: first turn of a new session
 *   - `"provider_unhealthy"`: current model/provider failed (`status >= 400`, rate-limited, rejected)
 *   - `"gone"`: current model is no longer in the candidate pool
 *   - `"worn"`: cumulative session tokens (`compactedTokens + tokens`) >= 2,000,000
 *   - `"outgrown"`: current token count exceeds 95% of the model's `context_window`
 *   - `"capability_outgrown"`: new turn needs image input (a screenshot, or computer use) the current model is not cited for
 *   - `"compacted"`: conversation was `/compact`-ed (token count dropped > 50%)
 *   - `"cold"`: KV cache TTL expired (`now - updatedAt > coldAfterMs`) or cache < 1024 tokens, or the state has no
 *     age (`ageKnown: false`, decided again from the history), so no TTL-gated hold applies
 *   - `"turn_mode"`: `affinityMode === "turn"` and request is a new user turn (`within === false`)
 *   - `"off"`: `affinityMode === "off"`
 */
/**
 * Whether the user now names something other than what the session runs (contract R3). A hold would hide that.
 */
function pinOverridesSession(sessionState, pins, options) {
  if (!pins) return false;
  if (pins.pinnedBundle && pins.pinnedBundle !== sessionState.pinnedBundle) return true;
  let effort = pins.constraintEffort ? String(pins.constraintEffort).trim().toLowerCase() : null;
  if (pins.constraintModel) {
    const models = modelsOf(options);
    const aliases = aliasesOf(options);
    // Each row is its own model (contract R1): a session on a family row is not on the flagship it folds to, nor the other way round.
    const running = healthKey(sessionState.target || sessionState.model, models, aliases);
    if (healthKey(String(pins.constraintModel), models, aliases) !== running) return true;
    effort = effort || resolveModel(String(pins.constraintModel), models, aliases).effort;
  }
  return Boolean(effort && effort !== sessionState.effort);
}

export function evaluateProviderContinuation(facts = {}, sessionState = null, options = {}) {
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const affinityMode = String(options.affinityMode || "cache").toLowerCase();

  if (affinityMode === "off") {
    return {
      shouldHold: false,
      why: "off",
      within: Boolean(facts.within),
      turn: facts.turn || 0,
    };
  }

  if (!sessionState || !sessionState.model) {
    return {
      shouldHold: false,
      why: "first",
      within: Boolean(facts.within),
      turn: facts.turn || 1,
    };
  }

  const currentModel = canonicalModel(sessionState.model, aliasesOf(options), modelsOf(options));
  const spec = specOf(currentModel, options);

  // 1. Check 24h session retention expiry
  const ageMs = Math.max(0, now - (sessionState.updatedAt || 0));
  if (sessionState.updatedAt && ageMs > STICK_KEEP_MS) {
    return {
      shouldHold: false,
      why: "cold",
      reasonDetail: "session_expired",
      previousModel: currentModel,
      previousEffort: sessionState.effort,
      within: Boolean(facts.within),
      turn: facts.turn || 1,
    };
  }

  if (pinOverridesSession(sessionState, options.pins, options)) {
    return {
      shouldHold: false,
      why: "user_pin_override",
      previousModel: currentModel,
      previousEffort: sessionState.effort,
      within: Boolean(facts.within),
      turn: facts.turn || 1,
    };
  }

  // 2. Check candidate pool membership (if candidate list is explicitly provided)
  const candidateList = Array.isArray(options.availableModels)
    ? options.availableModels
    : Array.isArray(facts.candidateModels)
      ? facts.candidateModels
      : [];
  if (candidateList.length > 0) {
    const running = healthKey(sessionState.target || sessionState.model, options.models, options.aliases);
    const candidateKeys = candidateList.map((m) =>
      healthKey(typeof m === "string" ? m : m?.model || m?.id || "", options.models, options.aliases)
    );
    if (!candidateKeys.includes(running)) {
      return {
        shouldHold: false,
        why: "gone",
        previousModel: currentModel,
        previousEffort: sessionState.effort,
        within: Boolean(facts.within),
        turn: facts.turn || 1,
      };
    }
  }

  // 3. Check provider/model health
  const runningName = sessionState.target || sessionState.model;
  const failedModel = healthKey(runningName, options.models, options.aliases);
  const unhealthySet = new Set(
    (options.unhealthyModels || []).map((m) => healthKey(m, options.models, options.aliases))
  );
  const storeHealthy =
    options.store && typeof options.store.isModelHealthy === "function"
      ? options.store.isModelHealthy(runningName, now)
      : true;
  if (
    sessionState.healthy === false ||
    !storeHealthy ||
    unhealthySet.has(failedModel)
  ) {
    return {
      shouldHold: false,
      why: "provider_unhealthy",
      failedModel,
      previousModel: currentModel,
      previousEffort: sessionState.effort,
      within: Boolean(facts.within),
      turn: facts.turn || 1,
    };
  }

  // 3b. Check subscription quota exhaustion (`spent` in Magpie `affinity.go`):
  // If all accounts serving the sticky session's model/provider have exhausted their binding
  // subscription window (`remaining <= safety_margin_pct`), switch to an eligible provider!
  if (
    options.quotas &&
    isModelQuotaExhausted(
      sessionState.model || currentModel,
      options.quotas,
      options.policy || DEFAULT_SCORING_POLICY,
      now,
      sessionState.provider
    )
  ) {
    return {
      shouldHold: false,
      why: "quota_exhausted",
      previousModel: currentModel,
      previousEffort: sessionState.effort,
      within: Boolean(facts.within),
      turn: facts.turn || 1,
    };
  }

  const estTokens = Number(facts.estimatedInputTokens || 0);
  const prevTokens = Number(sessionState.tokens || 0);
  const effectiveTokens = Math.max(estTokens, prevTokens);
  const compactedTokens = Number(sessionState.compactedTokens || 0);

  // 4. Check AgentCompass 2M cumulative token wear rule (`compacted_tokens + context_tokens >= 2M`)
  if (compactedTokens + effectiveTokens >= WORKER_WORN_TOKENS) {
    return {
      shouldHold: false,
      why: "worn",
      previousModel: currentModel,
      previousEffort: sessionState.effort,
      cumulativeTokens: compactedTokens + effectiveTokens,
      within: Boolean(facts.within),
      turn: facts.turn || 1,
    };
  }

  // 5. Check context window 95% outgrowth (`internal/gateway/rules.go:388 outgrown`)
  const contextWindow = Number(spec?.context_window || 128000);
  if (
    affinityMode !== "strict" &&
    contextWindow > 0 &&
    effectiveTokens > contextWindow * CONTEXT_OUTGROWN_RATIO
  ) {
    return {
      shouldHold: false,
      why: "outgrown",
      previousModel: currentModel,
      previousEffort: sessionState.effort,
      tokens: effectiveTokens,
      contextWindow,
      within: Boolean(facts.within),
      turn: facts.turn || 1,
    };
  }

  // 6. Check visual modality outgrowth (even mid-turn if a tool returned a screenshot to a blind model)
  const needsVisual = Boolean(facts.hasCurrentTurnVisual || facts.hasVisual);
  const modelHasVisual = takesImages(spec);
  if (affinityMode !== "strict" && needsVisual && !modelHasVisual) {
    return {
      shouldHold: false,
      why: "capability_outgrown",
      reasonDetail: "visual_modality_required",
      previousModel: currentModel,
      previousEffort: sessionState.effort,
      within: Boolean(facts.within),
      turn: facts.turn || 1,
    };
  }

  // 7. Mid-turn lock (`within === true`): 100% hold provider & model:effort without calling scorer
  if (facts.within) {
    return {
      shouldHold: true,
      why: "turn",
      model: currentModel,
      effort: sessionState.effort || "high",
      provider: sessionState.provider || "",
      previousModel: currentModel,
      previousEffort: sessionState.effort || "high",
      within: true,
      turn: facts.turn || sessionState.turn || 1,
    };
  }

  // 8. Between-turn checks (`within === false`)
  if (affinityMode === "turn") {
    return {
      shouldHold: false,
      why: "turn_mode",
      previousModel: currentModel,
      previousEffort: sessionState.effort,
      within: false,
      turn: facts.turn || 1,
    };
  }

  // GUI / computer-use capability outgrowth on a new user turn
  if (affinityMode !== "strict" && facts.hasComputerUse && !modelHasVisual) {
    return {
      shouldHold: false,
      why: "capability_outgrown",
      reasonDetail: "gui_capability_required",
      previousModel: currentModel,
      previousEffort: sessionState.effort,
      within: false,
      turn: facts.turn || 1,
    };
  }

  // Check context compaction (request token drop > 50% from warm state)
  const prevReqTokens = Number(sessionState.requestTokens || 0);
  const tokenDroppedByHalf =
    (facts.hasExplicitEstimatedTokens &&
      prevTokens >= CACHE_WORTH_TOKENS &&
      estTokens > 0 &&
      estTokens < prevTokens * COMPACTION_DROP_RATIO) ||
    (prevReqTokens >= CACHE_WORTH_TOKENS &&
      estTokens > 0 &&
      estTokens < prevReqTokens * COMPACTION_DROP_RATIO);
  if (
    affinityMode !== "strict" &&
    affinityMode !== "session" &&
    tokenDroppedByHalf
  ) {
    return {
      shouldHold: false,
      why: "compacted",
      previousModel: currentModel,
      previousEffort: sessionState.effort,
      within: false,
      turn: facts.turn || 1,
    };
  }

  if (affinityMode === "strict" || affinityMode === "session") {
    return {
      shouldHold: true,
      why: affinityMode,
      model: currentModel,
      effort: sessionState.effort || "high",
      provider: sessionState.provider || "",
      previousModel: currentModel,
      previousEffort: sessionState.effort || "high",
      within: false,
      turn: facts.turn || sessionState.turn || 1,
    };
  }

  const ttlMs = coldAfterMs(sessionState.provider || currentModel, {
    ...sessionState,
    ...options,
  });
  // A state decided again from the history (`ageKnown: false`) has no age, so it is never within a TTL
  const ageKnown = sessionState.ageKnown !== false;
  const withinCacheTtl = ageKnown && ageMs <= ttlMs;

  // Warm KV cache hold (`tokens >= 1024` or `cached === true` within TTL)
  const cacheWorthHolding =
    sessionState.cached === true ||
    prevTokens >= CACHE_WORTH_TOKENS ||
    estTokens >= CACHE_WORTH_TOKENS;

  if (cacheWorthHolding && withinCacheTtl) {
    return {
      shouldHold: true,
      why: "cache",
      model: currentModel,
      effort: sessionState.effort || "high",
      provider: sessionState.provider || "",
      previousModel: currentModel,
      previousEffort: sessionState.effort || "high",
      within: false,
      turn: facts.turn || sessionState.turn || 1,
    };
  }

  return {
    shouldHold: false,
    why: "cold",
    previousModel: currentModel,
    previousEffort: sessionState.effort,
    ageMs: ageKnown ? ageMs : null,
    ttlMs,
    within: false,
    turn: facts.turn || 1,
  };
}

/**
 * In-memory Session Continuity & Provider Health Store (works in both `moejs` and Bun).
 */
export class SessionContinuityStore {
  constructor() {
    this.sessions = new Map();
    this.modelHealth = new Map();
    this.lastActiveSessionKey = "";
  }

  prune(now = Date.now()) {
    for (const [k, state] of this.sessions.entries()) {
      if (state.updatedAt && now - state.updatedAt > STICK_KEEP_MS) {
        this.sessions.delete(k);
      }
    }
    for (const [m, health] of this.modelHealth.entries()) {
      if (health.until && now > health.until) {
        this.modelHealth.delete(m);
      }
    }
  }

  get(sessionKey, now = Date.now(), { keepExpired = false } = {}) {
    if (!sessionKey) return null;
    let resolvedKey = sessionKey;
    let state = this.sessions.get(resolvedKey);
    if (!state && sessionKey.includes("\x00")) {
      const parts = sessionKey.split("\x00");
      // Only fall back to bare explicitSession when there is no subagent suffix (parts.length === 2)
      if (parts.length === 2 && this.sessions.has(parts[0])) {
        resolvedKey = parts[0];
        state = this.sessions.get(resolvedKey);
      }
    }
    if (!state) return null;
    if (state.updatedAt && now - state.updatedAt > STICK_KEEP_MS) {
      this.sessions.delete(resolvedKey);
      return keepExpired ? state : null;
    }
    return state;
  }

  set(sessionKey, patch = {}, now = Date.now()) {
    if (!sessionKey) return null;
    const existing = this.get(sessionKey, now) || {
      sessionKey,
      model: "",
      effort: "medium",
      provider: "",
      workKind: "general_implementation",
      difficulty: "routine",
      tokens: 0,
      requestTokens: 0,
      compactedTokens: 0,
      cached: false,
      healthy: true,
      turn: 1,
      updatedAt: now,
    };

    const next = {
      ...existing,
      ...patch,
      sessionKey,
      updatedAt: Number.isFinite(patch.updatedAt) ? Number(patch.updatedAt) : now,
    };
    if (next.model) {
      next.model = canonicalModel(next.model);
    }
    this.sessions.set(sessionKey, next);
    this.lastActiveSessionKey = sessionKey;
    return next;
  }

  /**
   * Record a routing/continuation decision on request entry.
   */
  recordRequest(sessionKey, decision = {}, facts = {}, now = Date.now()) {
    if (!sessionKey) return null;
    const existing = this.get(sessionKey, now);
    const estTokens = Number(facts.estimatedInputTokens || 0);
    let compactedTokens = Number(existing?.compactedTokens || 0);
    const prevTokens = Number(existing?.tokens || 0);
    const prevReqTokens = Number(existing?.requestTokens || 0);

    const dropped =
      (facts.hasExplicitEstimatedTokens &&
        prevTokens >= CACHE_WORTH_TOKENS &&
        estTokens > 0 &&
        estTokens < prevTokens * COMPACTION_DROP_RATIO) ||
      (prevReqTokens >= CACHE_WORTH_TOKENS &&
        estTokens > 0 &&
        estTokens < prevReqTokens * COMPACTION_DROP_RATIO);

    // If compaction happened, accumulate previous context window into `compactedTokens`
    if (existing && prevTokens >= CACHE_WORTH_TOKENS && dropped) {
      compactedTokens += prevTokens;
    }

    const tokens =
      estTokens > 0
        ? existing && !dropped
          ? Math.max(prevTokens, estTokens)
          : estTokens
        : prevTokens;

    const cached =
      !dropped &&
      (Boolean(existing?.cached) ||
        tokens >= CACHE_WORTH_TOKENS ||
        decision.why === "cache" ||
        decision.why === "turn");

    return this.set(
      sessionKey,
      {
        model: decision.model || existing?.model || "",
        // `target` keeps the model as routed (`upstream/claude-opus-5-5`); `set` stores `model` canonical
        target: decision.model || existing?.target || "",
        effort: decision.effort || existing?.effort || "medium",
        provider: decision.provider ?? existing?.provider ?? "",
        workKind: decision.workKind || existing?.workKind || "general_implementation",
        difficulty: decision.difficulty || existing?.difficulty || "routine",
        tokens,
        requestTokens: estTokens > 0 ? estTokens : prevReqTokens,
        compactedTokens,
        cached,
        healthy: true,
        turn: facts.turn || existing?.turn || 1,
        anchor: decision.anchor ?? existing?.anchor ?? "",
        lastWhy: decision.why || "first",
        lastHeld: Boolean(decision.held),
        // What a later provider route of a held turn profiles with, and which pin the session is on.
        profile: decision.profile ?? existing?.profile ?? null,
        pinnedBundle: decision.pinnedBundle ?? existing?.pinnedBundle ?? null,
      },
      now
    );
  }

  /**
   * Record response completion or failure (`onResponse` hook/middleware).
   */
  recordResponse(sessionKey, reply, ctx = {}, now = Date.now()) {
    const key = sessionKey || this.lastActiveSessionKey;
    const existing = key ? this.get(key, now) : null;
    const status = Number(
      ctx?.status || ctx?.statusCode || reply?.error?.status || reply?.status || 0
    );
    const isError =
      ctx?.success === false ||
      reply === null ||
      Boolean(reply?.error) ||
      (status >= 400 && status < 600);

    const targetModel = canonicalModel(
      ctx?.model || existing?.model || reply?.model || ""
    );
    const ranModel = healthKey(ctx?.model || existing?.target || existing?.model || reply?.model || "");

    if (isError) {
      if (ranModel) {
        this.markModelUnhealthy(
          ranModel,
          ctx?.error || reply?.error?.message || `http_${status || "error"}`,
          now
        );
      }
      if (key && existing) {
        return this.set(
          key,
          {
            ...existing,
            healthy: false,
          },
          now
        );
      }
      return null;
    }

    // Extract token usage & cache read/creation watermarks from OpenAI / Anthropic / Gemini response
    const usage = reply?.usage || reply?.usageMetadata || ctx?.usage || {};
    const inputTokens = Number(
      usage.input_tokens ||
        usage.prompt_tokens ||
        usage.promptTokenCount ||
        usage.inputTokens ||
        0
    );
    const outputTokens = Number(
      usage.output_tokens ||
        usage.completion_tokens ||
        usage.candidatesTokenCount ||
        usage.outputTokens ||
        0
    );
    const cacheReadTokens = Number(
      usage.cache_read_input_tokens ||
        usage.prompt_tokens_details?.cached_tokens ||
        usage.input_tokens_details?.cached_tokens ||
        usage.cachedContentTokenCount ||
        usage.cacheRead ||
        0
    );
    const cacheWriteTokens = Number(
      usage.cache_creation_input_tokens || usage.cacheWrite || 0
    );
    const totalContext = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens;

    if (ranModel) {
      this.markModelHealthy(ranModel);
    }

    if (!key) return null;
    const prevTokens = Number(existing?.tokens || 0);
    const nextTokens = totalContext > 0 ? Math.max(prevTokens, totalContext) : prevTokens;
    const cached =
      Boolean(existing?.cached) ||
      cacheReadTokens > 0 ||
      cacheWriteTokens > 0 ||
      nextTokens >= CACHE_WORTH_TOKENS;

    return this.set(
      key,
      {
        ...(existing || {}),
        model: targetModel || existing?.model || "",
        tokens: nextTokens,
        cached,
        healthy: true,
      },
      now
    );
  }

  /**
   * Record Magpie `onUsage(row)` telemetry event (`internal/middleware/run.go:349`).
   */
  recordUsage(row = {}, now = Date.now()) {
    const key =
      row.session_id ||
      row.sessionId ||
      row.conversation_id ||
      this.lastActiveSessionKey;
    const targetModel = canonicalModel(row.model || row.request_model || "");
    const ranModel = healthKey(row.model || row.request_model || "");
    const isRejected =
      row.rejected === true ||
      Boolean(row.error) ||
      (Number(row.status) >= 400 && Number(row.status) < 600);

    if (isRejected) {
      if (ranModel) {
        this.markModelUnhealthy(
          ranModel,
          row.error || row.reject_reason || `status_${row.status || "rejected"}`,
          now
        );
      }
      if (key && this.sessions.has(key)) {
        const existing = this.sessions.get(key);
        if (!ranModel || healthKey(existing.target || existing.model) === ranModel) {
          this.set(key, { ...existing, healthy: false }, now);
        }
      }
      return { healthy: false, model: targetModel, sessionKey: key };
    }

    const totalTokens =
      Number(row.input_tokens || row.inputTokens || 0) +
      Number(row.output_tokens || row.outputTokens || 0) +
      Number(row.cache_read || row.cacheRead || 0) +
      Number(row.cache_write || row.cacheWrite || 0);
    const hasCache =
      Number(row.cache_read || row.cacheRead || 0) > 0 ||
      Number(row.cache_write || row.cacheWrite || 0) > 0 ||
      totalTokens >= CACHE_WORTH_TOKENS;

    if (targetModel) {
      this.markModelHealthy(targetModel);
    }

    if (key && (this.sessions.has(key) || targetModel)) {
      const existing = this.sessions.get(key) || {};
      this.set(
        key,
        {
          ...existing,
          model: targetModel || existing.model || "",
          provider: row.provider || existing.provider || "",
          tokens: Math.max(Number(existing.tokens || 0), totalTokens),
          cached: Boolean(existing.cached || hasCache),
          healthy: true,
        },
        now
      );
    }
    return { healthy: true, model: targetModel, sessionKey: key };
  }

  markModelUnhealthy(model, reason = "unhealthy", now = Date.now(), cooldownMs = UNHEALTHY_COOLDOWN_MS) {
    const key = healthKey(model);
    if (!key) return;
    this.modelHealth.set(key, {
      healthy: false,
      reason: String(reason || "unhealthy"),
      failedAt: now,
      until: now + cooldownMs,
    });
    for (const [k, state] of this.sessions.entries()) {
      if (healthKey(state.target || state.model) === key) {
        this.sessions.set(k, { ...state, healthy: false });
      }
    }
  }

  markModelHealthy(model) {
    const key = healthKey(model);
    if (!key) return;
    this.modelHealth.delete(key);
  }

  isModelHealthy(model, now = Date.now()) {
    const key = healthKey(model);
    if (!key) return true;
    const entry = this.modelHealth.get(key);
    if (!entry) return true;
    if (entry.until && now > entry.until) {
      this.modelHealth.delete(key);
      return true;
    }
    return entry.healthy !== false;
  }

  getUnhealthyModels(now = Date.now()) {
    const out = [];
    for (const [m, entry] of this.modelHealth.entries()) {
      if (entry.until && now > entry.until) {
        this.modelHealth.delete(m);
        continue;
      }
      if (entry.healthy === false) {
        out.push(m);
      }
    }
    return out;
  }

  /**
   * Optional synchronization with Magpie's persisted `affinity.json` (`internal/gateway/affinity.go:1182`)
   * when a JSON snapshot or parsed object is passed in.
   */
  ingestMagpieAffinitySnapshot(snapshot, now = Date.now()) {
    if (!snapshot || typeof snapshot !== "object") return 0;
    const sticks = snapshot.sticks || snapshot.sessions || snapshot;
    if (!sticks || typeof sticks !== "object") return 0;
    let count = 0;
    for (const [key, entry] of Object.entries(sticks)) {
      if (!entry || typeof entry !== "object" || !entry.model) continue;
      const updatedAt = entry.at
        ? typeof entry.at === "number"
          ? entry.at
          : Date.parse(entry.at) || now
        : now;
      this.set(
        key,
        {
          model: canonicalModel(entry.model),
          effort: entry.effort || "high",
          provider: entry.provider || "",
          tokens: Number(entry.tokens || 0),
          cached: Boolean(entry.cached || Number(entry.tokens || 0) >= CACHE_WORTH_TOKENS),
          healthy: entry.healthy !== false,
          turn: Number(entry.turn || 1),
          updatedAt,
        },
        now
      );
      count += 1;
    }
    return count;
  }

  clear() {
    this.sessions.clear();
    this.modelHealth.clear();
    this.lastActiveSessionKey = "";
  }
}

export const defaultContinuityStore = new SessionContinuityStore();
