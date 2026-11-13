// Vendored from akiiwa-games/magpie-agentcompass-router src/quota-loader.js at ac494f31dda6dc516e985594208e28fca85aa5fb (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Explicit Quota Snapshot Loader for Bun (`magpie.hooks` & `/v1/systemone`)
 *
 * By default, performs zero disk reads and never walks parent directories or probes
 * Magpie's internal configuration directory.
 * Only reads from:
 * 1. Explicit `options.quotas` in-memory object/array (returned immediately)
 * 2. Explicit `options.quotasPath` / `options.quotaFile` / `options.magpieConfigDir` when explicitly configured by the user
 */

import { normalizeQuotaSnapshot } from "./quota.mjs";

const nodeFs = globalThis.process?.getBuiltinModule?.("node:fs") || null;
const nodePath = globalThis.process?.getBuiltinModule?.("node:path") || null;
const existsSync = (p) => (nodeFs?.existsSync ? nodeFs.existsSync(p) : false);
const readFileSync = (p, enc) => nodeFs.readFileSync(p, enc);
const statSync = (p) => nodeFs.statSync(p);
const join = (...parts) => (nodePath?.join ? nodePath.join(...parts) : parts.join("/"));

const CACHE_TTL_MS = 5000;
const OPTION_KEYS = new Set(["usage_max_age_hours", "usageMaxAgeHours", "usage_fresh_hours", "usageFreshHours"]);
const TIMESTAMP_KEYS = [
  "fetched_at",
  "fetchedAt",
  "updated_at",
  "updatedAt",
  "read_at",
  "last_success_at",
  "lastSuccessAt",
  "last_ok_at",
  "lastOkAt",
];

let cachedPath = "";
let cachedMtimeMs = 0;
let cachedSize = -1;
let cachedRawText = "";
let cachedReadAt = 0;
let cachedQuotas = null;
let lastGoodAt = null;
let failingPath = "";
let failingSinceAt = null;
let loadStatus = { configured: false, ok: true, path: "", cause: null, detail: null };
let reportedSignature = "";

/**
 * Resolve an explicitly configured quotas file path if provided in `options`.
 * Never walks parent directories or probes `$HOME` / `$XDG_CONFIG_HOME`.
 */
export function resolveMagpieQuotasFile(options = {}) {
  const explicitFile = options.quotasPath || options.quotaFile;
  if (typeof explicitFile === "string" && explicitFile.trim()) {
    return explicitFile.trim();
  }

  const explicitDir = options.magpieConfigDir;
  if (typeof explicitDir === "string" && explicitDir.trim()) {
    const dir = explicitDir.trim();
    const candidate = join(dir, "quotas.json");
    if (existsSync(candidate)) return candidate;
    const nested = join(dir, "magpie", "quotas.json");
    if (existsSync(nested)) return nested;
    return candidate;
  }

  return "";
}

/** Why the last explicitly configured quotas file could not be used (`ok: true` when it could). */
export function getQuotasLoadStatus() {
  return { ...loadStatus };
}

function describeSchemaProblem(parsed, nowMs) {
  if (!parsed || typeof parsed !== "object") return "top level is not an object or array";
  const keys = Array.isArray(parsed) ? parsed : Object.keys(parsed).filter((k) => !OPTION_KEYS.has(k));
  if (keys.length > 0 && normalizeQuotaSnapshot(parsed, nowMs).length === 0) {
    return "no account entries found";
  }
  return null;
}

/** Log once per change of state, not on every request. */
function reportLoad(signature, message) {
  if (signature === reportedSignature) return;
  reportedSignature = signature;
  if (message) console.warn(`agentcompass: ${message}`);
}

function hasExplicitTimestamp(item) {
  if (!item || typeof item !== "object") return false;
  for (const k of TIMESTAMP_KEYS) {
    if (item[k] !== undefined && item[k] !== null && item[k] !== "") return true;
    if (item.quota && typeof item.quota === "object" && item.quota[k] !== undefined && item.quota[k] !== null && item.quota[k] !== "") {
      return true;
    }
  }
  return false;
}

function stampItemTimestamp(item, fallbackAt) {
  if (!fallbackAt || !item || typeof item !== "object" || hasExplicitTimestamp(item)) {
    return item;
  }
  return { ...item, fetched_at: fallbackAt };
}

function stampSnapshotTimestamps(snapshot, fallbackAt) {
  if (!snapshot || !fallbackAt || typeof snapshot !== "object") return snapshot;
  if (Array.isArray(snapshot)) {
    return snapshot.map((item) => stampItemTimestamp(item, fallbackAt));
  }
  if (snapshot.accounts && typeof snapshot.accounts === "object" && !Array.isArray(snapshot.accounts)) {
    const accounts = {};
    for (const [k, v] of Object.entries(snapshot.accounts)) {
      accounts[k] = stampItemTimestamp(v, fallbackAt);
    }
    return { ...snapshot, accounts };
  }
  const out = {};
  for (const [k, v] of Object.entries(snapshot)) {
    out[k] = OPTION_KEYS.has(k) ? v : stampItemTimestamp(v, fallbackAt);
  }
  return out;
}

/**
 * The configured quotas file could not be used. The last good snapshot (if any) is kept, so its readings
 * age out through the 6h rule, and a pool-level `usage_failing` entry (`quotas_unreadable`) is added so the
 * account list and decision warnings say so. Once the file-level failure exceeds 6h without a successful read,
 * dispatch is stopped.
 */
function loadFailed(qPath, cause, detail, nowMs) {
  loadStatus = { configured: true, ok: false, path: qPath, cause, detail: detail || null };
  if (!failingSinceAt || failingPath !== qPath) {
    failingPath = qPath;
    failingSinceAt = new Date(nowMs).toISOString();
  }
  const text = `quotas_unreadable: ${cause}${detail ? ` (${detail})` : ""} at ${qPath}`;
  reportLoad(`${qPath}|${cause}|${detail || ""}`, `quotas file unusable, ${text}`);
  const rawLastGood = cachedQuotas && cachedPath === qPath ? cachedQuotas : null;
  const lastGood = stampSnapshotTimestamps(rawLastGood, lastGoodAt);
  const entry = {
    provider: "pool",
    name: "quotas",
    pool_level: true,
    status: "error",
    error: { message: text },
    failing_since: failingSinceAt,
    ...(lastGoodAt !== null ? { last_success_at: lastGoodAt } : {}),
  };
  if (Array.isArray(lastGood)) return [...lastGood, entry];
  const { name, ...keyed } = entry;
  if (lastGood?.accounts && typeof lastGood.accounts === "object" && !Array.isArray(lastGood.accounts)) {
    return { ...lastGood, accounts: { ...lastGood.accounts, "pool/quotas": keyed } };
  }
  return { ...(lastGood || {}), "pool/quotas": keyed };
}

/**
 * Load live subscription quotas from `options.quotas` or an explicitly configured `options.quotasPath` / `options.quotaFile`.
 * No configured source -> `null`, no warning. A configured file that is missing, unreadable, not JSON or
 * the wrong shape is never silent: see `loadFailed` and `getQuotasLoadStatus`.
 */
export function loadLiveQuotas(options = {}, nowMs = Date.now()) {
  if (options.quotas && typeof options.quotas === "object") {
    return options.quotas;
  }
  if (options.disableQuotas === true) {
    return null;
  }

  const qPath = resolveMagpieQuotasFile(options);
  if (!qPath) {
    loadStatus = { configured: false, ok: true, path: "", cause: null, detail: null };
    return null;
  }

  let rawText;
  let mtimeMs;
  let size;
  try {
    if (!existsSync(qPath)) return loadFailed(qPath, "missing", null, nowMs);
    const st = statSync(qPath);
    mtimeMs = st.mtimeMs;
    size = st.size;
    rawText = readFileSync(qPath, "utf8");
    if (
      loadStatus.ok &&
      cachedQuotas &&
      cachedPath === qPath &&
      st.mtimeMs === cachedMtimeMs &&
      st.size === cachedSize &&
      rawText === cachedRawText
    ) {
      cachedReadAt = nowMs;
      return cachedQuotas;
    }
  } catch (err) {
    return loadFailed(qPath, "unreadable", err?.code || "read error", nowMs);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return loadFailed(qPath, "invalid_json", null, nowMs);
  }
  const problem = describeSchemaProblem(parsed, nowMs);
  if (problem) return loadFailed(qPath, "wrong_schema", problem, nowMs);

  cachedPath = qPath;
  cachedMtimeMs = mtimeMs;
  cachedSize = size;
  cachedRawText = rawText;
  cachedReadAt = nowMs;
  cachedQuotas = parsed;
  lastGoodAt = new Date(nowMs).toISOString();
  failingPath = "";
  failingSinceAt = null;
  loadStatus = { configured: true, ok: true, path: qPath, cause: null, detail: null };
  reportLoad("", reportedSignature ? `quotas file readable again at ${qPath}` : "");
  return parsed;
}

export function clearQuotasCache() {
  cachedPath = "";
  cachedMtimeMs = 0;
  cachedSize = -1;
  cachedRawText = "";
  cachedReadAt = 0;
  cachedQuotas = null;
  lastGoodAt = null;
  failingPath = "";
  failingSinceAt = null;
  loadStatus = { configured: false, ok: true, path: "", cause: null, detail: null };
  reportedSignature = "";
}
