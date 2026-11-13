// Vendored from akiiwa-games/magpie-agentcompass-router src/quota.js at ac494f31dda6dc516e985594208e28fca85aa5fb (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Quota accounts of the gateway: Magpie's quota snapshot normalized into one record per account (its windows, plan, state and
 * last good reading), the account list the plugin shows, and the pool seat ordering.
 *
 * What a window costs is the allocator's (`quota-economy.js`, `candidate-eval.js`): this module only reads and classifies. It
 * integrates with Magpie's quota telemetry:
 * 1. `quotas.json` (`{ "<provider>/<account>": { kind, quota: { windows: [...] }, balance } }`)
 * 2. `GET /v1/magpie/quotas` (`[{ provider, name, kind, windows: [...], balance }]`)
 * 3. Magpie `Seat` objects in `strategies.agentcompass(pool, seats, options)`
 *    (`{ key, account, known, learns, used, soon, pace, weight, resting, tokens }`)
 *
 * Pure ES2022 module with zero external or Node-only dependencies so it runs in both
 * Bun (`magpie.hooks` / `/v1/systemone`) and Magpie's in-process `moejs` (`magpie.middleware`).
 */

import { MODEL_ALIASES, SCORING_POLICY as DEFAULT_SCORING_POLICY, canonicalModel, pyRound } from "./catalog.mjs";
import { PLAN_CAPACITY } from "./reference-data.mjs";
import { configuredPlan, planTable, templateWindowScope } from "./plans.mjs";
import { bindsAny } from "./quota-pools.mjs";
import { fiveAxisWindowRecovery } from "./quota-economy.mjs";
import { loadLiveQuotas } from "./quota-loader.mjs";

/** Plan values that mean the subscription is not paying any more (not a capacity tier). */
const INACTIVE_PLANS = new Set([
  "free",
  "free_tier",
  "antigravity_free_tier",
  "expired",
  "cancelled",
  "canceled",
  "inactive",
  "plan_inactive",
  "payment_failed",
  "past_due",
  "unpaid",
  "lapsed",
]);

/** `status` values by state; AgentCompass names (`ready` / `plan_inactive` / `usage_failing` / `auth_failed`). */
export const ACCOUNT_STATES = Object.freeze({
  READY: "ready",
  PLAN_INACTIVE: "plan_inactive",
  USAGE_FAILING: "usage_failing",
  AUTH_FAILED: "auth_failed",
  // Operator switch (`disabled: true`), not a health state; listed so it is never silent either.
  DISABLED: "disabled",
});

const STATUS_PLAN_INACTIVE = new Set([
  "expired",
  "cancelled",
  "canceled",
  "inactive",
  "plan_inactive",
  "payment_failed",
  "past_due",
  "unpaid",
  "lapsed",
]);
const INACTIVE_ERROR_CODES = new Set([
  "subscription_inactive",
  "subscription_expired",
  "subscription_canceled",
  "subscription_cancelled",
  "plan_expired",
  "plan_inactive",
  "payment_required",
  "payment_failed",
]);
const STATUS_AUTH_FAILED = new Set(["auth_failed", "unauthorized", "forbidden"]);
const STATUS_USAGE_FAILING = new Set(["error", "failed", "usage_failing", "no_data"]);
const PLAN_VENDOR_WORDS = new Set(["antigravity", "chatgpt", "claude", "google", "ai", "openai", "plan"]);

/** No successful reading for this long takes the account out of dispatch. */
export const DEFAULT_USAGE_MAX_AGE_HOURS = 6;
/** An error warns at once; with no error, a reading older than this counts as failing (still dispatchable). */
export const DEFAULT_USAGE_FRESH_HOURS = 2;

const plansProviders = Object.keys(PLAN_CAPACITY);

const POOL_SUFFIX_RE = /\s*×\s*\d+\s*$/;

function stripPoolCount(raw) {
  return String(raw ?? "").replace(POOL_SUFFIX_RE, "");
}

function planSlug(raw) {
  return String(raw ?? "")
    .replace(/×/g, "x")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function stripVendorWords(slug) {
  if (!slug) return "";
  return slug
    .split("_")
    .filter((w) => w && !PLAN_VENDOR_WORDS.has(w))
    .join("_");
}

/**
 * Map a provider's reported plan label to a plan of the pinned plan templates. `inactive` means the subscription is no longer
 * paying; `known: false` means an unrecognised (or absent) plan, whose capacity is unknown. Matches the full name first, and
 * only strips a trailing `×N` pool count if the full name did not match.
 */
export function normalizePlan(provider, rawPlan) {
  const rawStr = String(rawPlan ?? "");
  const slug = planSlug(rawStr);
  const prov = String(provider || "").toLowerCase();
  if (!slug || slug === "none" || slug === "null" || slug === "unknown") {
    return { raw: slug ? rawStr : null, key: null, known: false, inactive: false };
  }
  const withoutPool = stripPoolCount(rawStr);
  const candidates = withoutPool !== rawStr ? [rawStr, withoutPool] : [rawStr];
  for (const candidate of candidates) {
    const candSlug = planSlug(candidate);
    if (!candSlug) continue;
    const stripped = stripVendorWords(candSlug);
    if (INACTIVE_PLANS.has(candSlug) || (stripped && INACTIVE_PLANS.has(stripped))) {
      return { raw: rawStr, key: null, known: true, inactive: true };
    }
    const id = configuredPlan(prov, candidate);
    if (id && id in planTable(prov)) return { raw: rawStr, key: id, known: true, inactive: false };
  }
  return { raw: rawStr, key: null, known: false, inactive: false };
}

export function clamp(val, low, high) {
  return Math.max(low, Math.min(high, val));
}

export function round4(val) {
  return pyRound(val, 4);
}

export function round3(val) {
  return Math.round(val * 1000) / 1000;
}

/**
 * Infer provider family (`claude`, `codex`, `antigravity`, `gemini`, `grok`, `deepseek`, `zai`, `kimi`, `minimax`, `qwen`)
 * from a model ID or provider prefix.
 */
export function inferModelProviderFamily(rawModel, aliases = MODEL_ALIASES) {
  if (!rawModel || typeof rawModel !== "string") return "";
  const clean = rawModel.trim().toLowerCase();
  const slashIdx = clean.indexOf("/");
  if (slashIdx > 0) {
    const prefix = clean.slice(0, slashIdx);
    if (
      [
        "claude",
        "anthropic",
        "codex",
        "openai",
        "antigravity",
        "gemini",
        "google",
        "grok",
        "xai",
        "deepseek",
        "zai",
        "glm",
        "kimi",
        "moonshot",
        "minimax",
        "qwen",
      ].includes(prefix)
    ) {
      if (prefix === "anthropic") return "claude";
      if (prefix === "openai") return "codex";
      if (prefix === "google") return "gemini";
      if (prefix === "xai") return "grok";
      if (prefix === "glm") return "zai";
      if (prefix === "moonshot") return "kimi";
      return prefix;
    }
  }
  const canon = canonicalModel(rawModel, aliases).toLowerCase();
  if (canon.startsWith("claude")) return "claude";
  if (canon.startsWith("gpt") || canon.includes("codex") || /^o\d/.test(canon)) {
    return "codex";
  }
  if (canon.startsWith("gemini") || canon.includes("argon")) return "gemini";
  if (canon.startsWith("grok")) return "grok";
  if (canon.startsWith("deepseek")) return "deepseek";
  if (canon.startsWith("glm")) return "zai";
  if (canon.startsWith("kimi")) return "kimi";
  if (canon.startsWith("minimax")) return "minimax";
  if (canon.startsWith("qwen")) return "qwen";
  return "";
}

/**
 * Normalize a provider identifier (`claude`/`anthropic`, `codex`/`openai`, `antigravity`/`gemini`/`google`, etc.)
 * into its canonical provider family.
 */
export function normalizeProviderFamily(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  const slash = s.indexOf("/");
  const p = slash > 0 ? s.slice(0, slash) : s;
  if (p === "anthropic" || p === "claude" || p === "claude-code") return "claude";
  if (p === "openai" || p === "codex" || p === "chatgpt") return "codex";
  if (p === "antigravity" || p === "gemini" || p === "google") return "antigravity";
  if (p === "xai" || p === "grok") return "grok";
  if (p === "glm" || p === "zai") return "zai";
  if (p === "moonshot" || p === "kimi") return "kimi";
  return p;
}

/**
 * Check whether two provider identifiers belong to the same provider family.
 */
export function providersMatch(provA, provB) {
  const fa = normalizeProviderFamily(provA);
  const fb = normalizeProviderFamily(provB);
  if (!fa || !fb) return false;
  return fa === fb;
}

/**
 * Check whether an account's provider matches a candidate model's provider family.
 */
export function providerMatchesModel(accountProvider, rawModel, aliases = MODEL_ALIASES) {
  const acctProv = String(accountProvider || "").trim().toLowerCase();
  if (!acctProv) return false;
  const rawLower = String(rawModel || "").trim().toLowerCase();
  const canon = canonicalModel(rawModel, aliases).toLowerCase();
  const modelProv = inferModelProviderFamily(rawModel, aliases);

  if (acctProv === rawLower || acctProv === canon || acctProv === modelProv) {
    return true;
  }
  if (
    (acctProv === "anthropic" || acctProv === "claude" || acctProv === "claude-code") &&
    modelProv === "claude"
  ) {
    return true;
  }
  if (
    (acctProv === "openai" || acctProv === "codex" || acctProv === "chatgpt") &&
    modelProv === "codex"
  ) {
    return true;
  }
  if (
    (acctProv === "antigravity" || acctProv === "gemini" || acctProv === "google") &&
    modelProv === "gemini"
  ) {
    return true;
  }
  if (acctProv === "antigravity" && (modelProv === "claude" || modelProv === "codex")) {
    // Antigravity can also host 3P models when explicitly configured
    return rawLower.startsWith("antigravity/");
  }
  return false;
}

/**
 * Parse a timestamp (ISO string, unix seconds, or unix ms) into milliseconds since epoch.
 */
export function parseResetTimeMs(val) {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number" && Number.isFinite(val)) {
    if (val <= 0) return null;
    // Heuristic: < 1e11 is unix seconds, >= 1e11 is unix ms
    return val < 1e11 ? val * 1000 : val;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum) && asNum > 0) {
      return asNum < 1e11 ? asNum * 1000 : asNum;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Infer a window's total duration in hours from its name/id or explicit `hours`.
 */
export function inferWindowHours(windowObj = {}, resetHours = null) {
  if (typeof windowObj.hours === "number" && windowObj.hours > 0) {
    return windowObj.hours;
  }
  if (typeof windowObj.spanHours === "number" && windowObj.spanHours > 0) {
    return windowObj.spanHours;
  }
  const name = String(windowObj.name || windowObj.id || "").trim().toLowerCase();
  if (
    name === "5h" ||
    name === "five_hour" ||
    name === "5-hour" ||
    name.endsWith("-5h") ||
    name.includes("5h") ||
    name === "session"
  ) {
    return 5;
  }
  if (name === "3h" || name === "three_hour" || name.includes("3h")) {
    return 3;
  }
  if (name === "1d" || name === "24h" || name === "daily" || name === "day") {
    return 24;
  }
  if (
    name === "30d" ||
    name === "month" ||
    name === "monthly" ||
    name.includes("month")
  ) {
    return 720;
  }
  if (
    name === "7d" ||
    name === "seven_day" ||
    name === "7-day" ||
    name === "week" ||
    name === "weekly" ||
    name === "usage" ||
    name.includes("week") ||
    name.includes("7d") ||
    name === "opus" ||
    name === "sonnet"
  ) {
    return 168;
  }
  if (typeof resetHours === "number" && resetHours > 0) {
    if (resetHours <= 5.5) return 5;
    if (resetHours <= 24.5) return 24;
    if (resetHours <= 170) return 168;
    return 720;
  }
  return 168;
}

/**
 * Normalize a single window observation into AgentCompass's canonical `windowState`
 * (`allocator.py:window_state`).
 */
export function normalizeWindowState(
  rawWin,
  provider = "default",
  nowMs = Date.now(),
  policy = DEFAULT_SCORING_POLICY,
  accountStale = false,
  planKey = undefined,
  keepRates = true
) {
  if (!rawWin || typeof rawWin !== "object") return null;
  if (rawWin.unlimited === true) {
    return {
      id: String(rawWin.name || rawWin.id || "unlimited"),
      unlimited: true,
      known: true,
      short: false,
      remaining: 100,
      used: 0,
      hours: 168,
      resetHours: 168,
      endHours: 168,
      targetRemaining: 100,
      stale: false,
    };
  }

  const id = String(rawWin.name || rawWin.id || "usage");
  let remaining = null;
  let used = null;

  if (typeof rawWin.remaining === "number" && Number.isFinite(rawWin.remaining)) {
    remaining = clamp(rawWin.remaining, 0, 100);
    used = clamp(100 - remaining, 0, 100);
  } else if (
    typeof rawWin.remaining_pct_before_reset === "number" &&
    Number.isFinite(rawWin.remaining_pct_before_reset)
  ) {
    remaining = clamp(rawWin.remaining_pct_before_reset, 0, 100);
    used = clamp(100 - remaining, 0, 100);
  } else if (
    typeof rawWin.observed_remaining_pct === "number" &&
    Number.isFinite(rawWin.observed_remaining_pct)
  ) {
    remaining = clamp(rawWin.observed_remaining_pct, 0, 100);
    used = clamp(100 - remaining, 0, 100);
  } else if (typeof rawWin.used === "number" && Number.isFinite(rawWin.used)) {
    used = clamp(rawWin.used, 0, 100);
    remaining = clamp(100 - used, 0, 100);
  } else if (typeof rawWin.used_pct === "number" && Number.isFinite(rawWin.used_pct)) {
    used = clamp(rawWin.used_pct, 0, 100);
    remaining = clamp(100 - used, 0, 100);
  } else if (
    typeof rawWin.amount === "number" &&
    typeof rawWin.limit === "number" &&
    rawWin.limit > 0
  ) {
    used = clamp((rawWin.amount / rawWin.limit) * 100, 0, 100);
    remaining = clamp(100 - used, 0, 100);
  }

  let resetHours = null;
  if (typeof rawWin.resetHours === "number" && Number.isFinite(rawWin.resetHours)) {
    resetHours = rawWin.resetHours;
  } else if (typeof rawWin.resetsInHours === "number" && Number.isFinite(rawWin.resetsInHours)) {
    resetHours = rawWin.resetsInHours;
  } else if (
    typeof rawWin.seconds_until_reset === "number" &&
    Number.isFinite(rawWin.seconds_until_reset)
  ) {
    resetHours = rawWin.seconds_until_reset / 3600;
  } else {
    const resetMs = parseResetTimeMs(rawWin.resetsAt ?? rawWin.resets_at ?? rawWin.resetAt);
    if (resetMs !== null) {
      resetHours = (resetMs - nowMs) / 3600000;
    }
  }

  const hours = inferWindowHours(rawWin, resetHours);
  const shortHoursThreshold = Number(policy?.short_window_hours ?? 24);
  const short = hours < shortHoursThreshold;

  // If a rolling window hasn't started yet (remaining === 100, resetsAt === null), its full span is available
  if (remaining === 100 && (resetHours === null || resetHours === undefined)) {
    resetHours = hours;
  }
  // If reset time already passed in the past, treat remaining as unknown or renewed unless explicitly rate_limited
  if (resetHours !== null && resetHours <= 0 && rawWin.rate_limited !== true) {
    if (remaining !== null && remaining <= 0) {
      // A window whose reset timestamp is in the past has already renewed!
      remaining = 100;
      used = 0;
      resetHours = hours;
    } else {
      resetHours = hours;
    }
  }

  if (remaining === null) {
    return {
      id,
      hours,
      short,
      known: false,
      stale: Boolean(accountStale || rawWin.stale),
      models: rawWin.models || null,
    };
  }

  // Default resetHours if omitted in shorthand test fixtures (`{ remaining: 80 }`)
  if (resetHours === null || !Number.isFinite(resetHours) || resetHours <= 0) {
    resetHours = short ? hours : hours * Math.max(0.1, remaining / 100);
  }

  const endHours = Math.max(0, resetHours);
  const targetRemaining = 100 * Math.min(1.0, endHours / hours);
  return {
    id,
    hours,
    short,
    known: true,
    stale: Boolean(accountStale || rawWin.stale),
    remaining: round4(remaining),
    used: round4(used),
    resetHours: round4(resetHours),
    endHours: round4(endHours),
    targetRemaining: round4(targetRemaining),
    rateLimited: Boolean(rawWin.rate_limited || rawWin.rateLimited),
    models: Array.isArray(rawWin.models) ? rawWin.models : null,
    accounts: Number.isInteger(rawWin.accounts) && rawWin.accounts > 1 ? rawWin.accounts : undefined,
  };
}

function firstTimeMs(...vals) {
  for (const v of vals) {
    const ms = parseResetTimeMs(v);
    if (ms !== null) return ms;
  }
  return null;
}

function httpStatusOf(item) {
  const err = item.error ?? item.quota?.error;
  const cands = [
    item.http_status,
    item.httpStatus,
    item.lastErrorHttpStatus,
    item.quota?.http_status,
    typeof item.status === "number" ? item.status : null,
    err && typeof err === "object"
      ? (err.status ?? err.http_status ?? (typeof err.code === "number" || /^\d+$/.test(String(err.code || "")) ? err.code : null))
      : null,
  ];
  for (const c of cands) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function errorCodeOf(item) {
  const err = item.error ?? item.quota?.error;
  const cands = [
    err && typeof err === "object" ? (err.code ?? err.error_code ?? err.type) : null,
    item.error_code,
    item.errorCode,
    item.lastErrorClass,
    item.failure_class,
    item.quota?.error_code,
  ];
  for (const c of cands) {
    if (c === null || c === undefined || typeof c === "number") continue;
    const s = planSlug(c);
    if (s && !/^\d+$/.test(s)) return s;
  }
  return null;
}

function fmtHours(ms) {
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * One account's state (`ready` / `plan_inactive` / `usage_failing` / `auth_failed`, plus operator `disabled`),
 * why, when it last read successfully, and whether it is out of dispatch. Reads structured fields only
 * (`status`, `error`, HTTP codes, timestamps); never message text.
 */
function classifyAccount(item, entry, plan, nowMs, maxAgeMs, freshMs) {
  const warnings = [];
  const status = String(item.status ?? item.quota?.status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const errorValue = item.error ?? item.quota?.error ?? null;
  const http = httpStatusOf(item);
  const errorCode = errorCodeOf(item);
  const hasReading = entry.unlimited || entry.windows.some((w) => w.known || w.unlimited);
  const metered = ["balance", "metered", "api", "payg"].includes(entry.kind);

  const prevOk =
    item.previous && typeof item.previous === "object" && item.previous.status === ACCOUNT_STATES.READY
      ? firstTimeMs(item.previous.last_success_at, item.previous.updated_at, item.previous.fetched_at)
      : null;
  const explicitOk = firstTimeMs(
    item.last_success_at,
    item.lastSuccessAt,
    item.last_ok_at,
    item.lastOkAt,
    item.quota?.last_success_at,
    prevOk
  );
  const readAt = firstTimeMs(
    item.fetched_at,
    item.fetchedAt,
    item.updated_at,
    item.updatedAt,
    item.read_at,
    item.quota?.fetched_at
  );

  let state = ACCOUNT_STATES.READY;
  let reason = null;
  let failing = false;

  if (item.disabled === true || item.enabled === false || status === "disabled") {
    state = ACCOUNT_STATES.DISABLED;
    reason = "account is disabled";
  } else if (
    plan.inactive ||
    STATUS_PLAN_INACTIVE.has(status) ||
    http === 402 ||
    (errorCode && INACTIVE_ERROR_CODES.has(errorCode))
  ) {
    state = ACCOUNT_STATES.PLAN_INACTIVE;
    const why = plan.inactive
      ? plan.raw
      : errorCode && INACTIVE_ERROR_CODES.has(errorCode)
        ? errorCode
        : http === 402
          ? "HTTP 402"
          : status;
    reason = `subscription is not active (${why})`;
  } else if (
    http === 401 ||
    http === 403 ||
    STATUS_AUTH_FAILED.has(status) ||
    (errorCode && STATUS_AUTH_FAILED.has(errorCode))
  ) {
    state = ACCOUNT_STATES.AUTH_FAILED;
    reason = `sign-in rejected${http ? ` (HTTP ${http})` : ""}`;
  } else if (
    errorValue ||
    item.available === false ||
    entry.stale ||
    STATUS_USAGE_FAILING.has(status) ||
    (!hasReading && !metered)
  ) {
    failing = true;
    const detail =
      typeof errorValue === "string"
        ? errorValue
        : errorValue && typeof errorValue === "object" && typeof errorValue.message === "string"
          ? errorValue.message
          : item.available === false
            ? "provider unavailable"
            : entry.stale
              ? "reading is stale"
              : !hasReading
                ? "no usage reading"
                : status || "reading failed";
    reason = `usage reading failing: ${detail}`;
  }

  // Last success: an explicit field, else the time of a good reading when the poll did not fail.
  let lastSuccessMs = explicitOk;
  if (lastSuccessMs === null && state === ACCOUNT_STATES.READY && !failing && (hasReading || metered)) {
    lastSuccessMs = readAt;
  }

  // No error but no fresh reading either: failing once the reading is older than the freshness limit (2h).
  if (state === ACCOUNT_STATES.READY && !failing && lastSuccessMs !== null && nowMs - lastSuccessMs > freshMs) {
    failing = true;
    reason = `usage reading failing: no successful reading for ${fmtHours(nowMs - lastSuccessMs)}`;
  }

  const explicitFailingSinceMs = firstTimeMs(
    item.failing_since,
    item.failingSince,
    item.quota?.failing_since,
    item.previous && typeof item.previous === "object" && item.previous.status === ACCOUNT_STATES.USAGE_FAILING
      ? item.previous.failing_since
      : null
  );

  const poolLevel = item.pool_level === true;
  let excluded = false;
  if (failing) {
    state = ACCOUNT_STATES.USAGE_FAILING;
    const anchorMs = lastSuccessMs ?? explicitFailingSinceMs ?? (poolLevel ? nowMs : null);
    excluded = anchorMs === null || nowMs - anchorMs >= maxAgeMs;
  } else if (state !== ACCOUNT_STATES.READY) {
    excluded = true;
  }

  if (state !== ACCOUNT_STATES.READY) {
    const lastTxt =
      lastSuccessMs === null ? "never read successfully" : `last success ${new Date(lastSuccessMs).toISOString()}`;
    warnings.push(
      poolLevel
        ? excluded
          ? `${entry.key}: ${state}, excluded from dispatch: ${reason} (${lastTxt})`
          : `${entry.key}: ${state}: ${reason} (${lastTxt}); quota limits may be missing or out of date`
        : excluded
          ? `${entry.key}: ${state}, excluded from dispatch: ${reason} (${lastTxt})`
          : `${entry.key}: ${state}: ${reason} (${lastTxt}); excluded after ${fmtHours(maxAgeMs)} without a successful reading`
    );
  }
  // Where the failure began: an explicit `failing_since`, else the last success (readings stopped after it).
  const failingSinceMs =
    state === ACCOUNT_STATES.USAGE_FAILING
      ? explicitFailingSinceMs ?? lastSuccessMs
      : null;
  return { state, reason, lastSuccessMs, excluded, warnings, failingSinceMs };
}

function planInfoOf(item, provider, key) {
  const online =
    item.plan ?? item.quota?.plan ?? item.plan_type ?? item.planType ?? item.plan_label ?? item.quota?.plan_type ?? null;
  const claim = item.plan_claim ?? item.planClaim ?? null;
  // The online plan wins; the credential claim is only a fallback when there is no online plan.
  const rawPlan = normalizePlan(provider, online).raw !== null ? online : claim;
  const plan = normalizePlan(provider, rawPlan);
  const warnings = [];
  let conflict = null;
  if (claim && normalizePlan(provider, online).raw !== null) {
    const claimed = normalizePlan(provider, claim);
    if (claimed.key !== plan.key || claimed.inactive !== plan.inactive) {
      conflict = { online: String(online), credential: String(claim) };
      warnings.push(
        `${key}: plan sources disagree (online "${online}" vs credential claim "${claim}"); using the online value`
      );
    }
  }
  if (!plan.known && !plan.inactive && plansProviders.includes(provider)) {
    warnings.push(
      `${key}: plan ${plan.raw ? `"${plan.raw}" is not recognized` : "was not reported"}; capacity is sized as the smallest known ${provider} plan`
    );
  }
  return { plan, warnings, conflict };
}

/** Build one canonical account record from a raw quota item (shared by every snapshot format). */
function buildAccountEntry(
  item,
  { key, provider, account, rawWindows, kind, unlimited, balance, stale, nowMs, policy, maxAgeMs, freshMs }
) {
  const { plan, warnings: planWarnings, conflict } = planInfoOf(item, provider, key);
  const planKey = plansProviders.includes(provider) ? plan.key : undefined;
  // Rates measured under another plan must not be carried over (a tier change reads as a demand jump).
  const ratePlan = item.rate_plan ?? item.ratePlan;
  const keepRates = !ratePlan || normalizePlan(provider, ratePlan).key === plan.key;
  const windows = rawWindows
    .map((w) => normalizeWindowState(w, provider, nowMs, policy, stale, planKey, keepRates))
    .filter(Boolean);
  const entry = {
    key,
    provider,
    account,
    kind,
    poolLevel: Boolean(item.pool_level),
    unlimited,
    stale,
    balance,
    error: item.error || item.quota?.error || null,
    plan: plan.raw,
    planKey: plan.key,
    planKnown: plan.known,
    planConflict: conflict,
    maxAgeHours: maxAgeMs / 3600000,
    windows,
  };
  const cls = classifyAccount(item, entry, plan, nowMs, maxAgeMs, freshMs);
  entry.state = cls.state;
  entry.reason = cls.reason;
  entry.lastSuccessAt = cls.lastSuccessMs === null ? null : new Date(cls.lastSuccessMs).toISOString();
  entry.excluded = cls.excluded;
  entry.failingSince = cls.failingSinceMs === null ? null : new Date(cls.failingSinceMs).toISOString();
  entry.warnings = [...(cls.state === ACCOUNT_STATES.PLAN_INACTIVE ? [] : planWarnings), ...cls.warnings];
  return entry;
}

/**
 * Normalize Magpie's `quotas.json`, `/v1/magpie/quotas` array, AgentCompass `usage.json`,
 * or shorthand `{ provider: { remaining, resetsInHours, windows } }` into a uniform array
 * of account quota records:
 *   `[{ key, provider, account, kind, unlimited, stale, balance, plan, windows: [windowState, ...],
 *       state, reason, lastSuccessAt, excluded, warnings }]`
 * `state` is the account status shared by dispatch and the account list (see `ACCOUNT_STATES`).
 * `opts.usageMaxAgeHours` (else `policy.usage_max_age_hours`, else a top-level `usage_max_age_hours`
 * in the snapshot, else 6) is how long an account may go without a successful reading before it is excluded;
 * `usageFreshHours` / `usage_fresh_hours` (default 2) is when a reading with no error starts counting as failing.
 */
export function normalizeQuotaSnapshot(rawQuotas, nowMs = Date.now(), policy = DEFAULT_SCORING_POLICY, opts = {}) {
  if (!rawQuotas || typeof rawQuotas !== "object") return [];

  const maxAgeHours =
    [opts?.usageMaxAgeHours, policy?.usage_max_age_hours, rawQuotas.usage_max_age_hours, rawQuotas.usageMaxAgeHours]
      .map(Number)
      .find((n) => Number.isFinite(n) && n > 0) ?? DEFAULT_USAGE_MAX_AGE_HOURS;
  const maxAgeMs = maxAgeHours * 3600000;
  const freshHours =
    [opts?.usageFreshHours, policy?.usage_fresh_hours, rawQuotas.usage_fresh_hours, rawQuotas.usageFreshHours]
      .map(Number)
      .find((n) => Number.isFinite(n) && n > 0) ?? DEFAULT_USAGE_FRESH_HOURS;
  const freshMs = Math.min(freshHours, maxAgeHours) * 3600000;
  const entries = [];

  // Format A: Array from `/v1/magpie/quotas`
  if (Array.isArray(rawQuotas)) {
    for (const item of rawQuotas) {
      if (!item || typeof item !== "object") continue;
      const provider = String(item.provider || item.type || "").trim().toLowerCase();
      const account = String(item.name || item.account || item.user || provider || "default").trim();
      const key = item.key || (provider ? `${provider}/${account}` : account);
      const rawWindows = Array.isArray(item.windows)
        ? item.windows
        : Array.isArray(item.quota?.windows)
          ? item.quota.windows
          : [];
      const stale = Boolean(item.stale || item.status === "stale" || item.error);
      const kind = String(
        item.kind || item.billing || (rawWindows.length > 0 ? "subscription" : item.balance ? "balance" : "subscription")
      ).toLowerCase();
      entries.push(
        buildAccountEntry(item, {
          key,
          provider: provider || inferModelProviderFamily(key),
          account,
          rawWindows,
          kind,
          unlimited: Boolean(item.unlimited),
          balance: item.balance || null,
          stale,
          nowMs,
          policy,
          maxAgeMs,
          freshMs,
        })
      );
    }
    return entries;
  }

  // Format B: AgentCompass `usage.json` (`{ accounts: { claude: { status, windows: [...] } } }`)
  if (rawQuotas.accounts && typeof rawQuotas.accounts === "object" && !Array.isArray(rawQuotas.accounts)) {
    return normalizeQuotaSnapshot(rawQuotas.accounts, nowMs, policy, { usageMaxAgeHours: maxAgeHours, usageFreshHours: freshHours, ...opts });
  }

  // Format C: Magpie `quotas.json` object (`{ "claude/user@example.com": { quota: { windows: [...] } } }`)
  // or shorthand (`{ claude: { remaining: 75, resetsInHours: 12 } }`)
  for (const [rawKey, item] of Object.entries(rawQuotas)) {
    if (!item || typeof item !== "object") continue;
    const slashIdx = rawKey.indexOf("/");
    const keyProvider = slashIdx > 0 ? rawKey.slice(0, slashIdx) : rawKey;
    const keyAccount = slashIdx > 0 ? rawKey.slice(slashIdx + 1) : rawKey;
    const provider = String(item.provider || keyProvider || "").trim().toLowerCase();
    const account = String(item.name || item.account || keyAccount || provider).trim();
    const stale = Boolean(item.stale || item.status === "stale");

    let rawWindows = [];
    if (Array.isArray(item.windows)) {
      rawWindows = item.windows;
    } else if (Array.isArray(item.quota?.windows)) {
      rawWindows = item.quota.windows;
    } else if (
      typeof item.remaining === "number" ||
      typeof item.used === "number" ||
      typeof item.remaining_pct_before_reset === "number" ||
      typeof item.used_pct === "number"
    ) {
      rawWindows = [
        {
          name: item.window || item.name || "7d",
          remaining: item.remaining ?? item.remaining_pct_before_reset,
          used: item.used ?? item.used_pct,
          resetsAt: item.resetsAt ?? item.resets_at,
          resetHours: item.resetHours ?? item.resetsInHours,
          hours: item.hours,
          capacity_usd: item.capacity_usd ?? item.capacityUsd,
          pct_per_hour_24h: item.pct_per_hour_24h ?? item.pctPerHour24h,
          pct_per_hour_3h: item.pct_per_hour_3h ?? item.pctPerHour3h,
          unlimited: item.unlimited,
        },
      ];
    }

    const kind = String(
      item.kind ||
        item.billing ||
        item.quota?.kind ||
        (rawWindows.length > 0 ? "subscription" : item.balance || item.quota?.balance ? "balance" : "subscription")
    ).toLowerCase();

    entries.push(
      buildAccountEntry(item, {
        key: rawKey,
        provider: provider || inferModelProviderFamily(rawKey),
        account,
        rawWindows,
        kind,
        unlimited: Boolean(item.unlimited || item.quota?.unlimited),
        balance: item.balance || item.quota?.balance || null,
        stale,
        nowMs,
        policy,
        maxAgeMs,
        freshMs,
      })
    );
  }

  return entries;
}

/**
 * The account list: one row per account with its state, why, plan and last successful reading.
 * This is what the plugin shows users (`accounts` in decisions, `formatQuotaAccountList`).
 */
export function listQuotaAccounts(rawQuotas, nowMs = Date.now(), policy = DEFAULT_SCORING_POLICY, opts = {}) {
  if (!rawQuotas || typeof rawQuotas !== "object") return [];
  const entries = Array.isArray(rawQuotas._normalized)
    ? rawQuotas._normalized
    : normalizeQuotaSnapshot(rawQuotas, nowMs, policy, opts);
  return entries.map((e) => ({
    key: e.key,
    provider: e.provider,
    account: e.account,
    plan: e.plan,
    plan_known: e.planKnown,
    // `status` is AgentCompass's field name; `state` is the same value.
    status: e.state,
    state: e.state,
    reason: e.reason,
    last_success_at: e.lastSuccessAt,
    ...(e.state === ACCOUNT_STATES.USAGE_FAILING
      ? { failing_since: e.failingSince, exclude_after_hours: e.maxAgeHours, usage_excluded: e.excluded }
      : {}),
    ...(e.planConflict ? { plan_conflict: e.planConflict } : {}),
    dispatchable: !e.excluded,
    warnings: e.warnings,
  }));
}

/** Plain-text account list for CLI / status output. */
export function formatQuotaAccountList(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return "No quota accounts.";
  return accounts
    .map((a) => {
      const flag = a.dispatchable ? "" : " [excluded from dispatch]";
      const why = a.reason ? ` - ${a.reason}` : "";
      return `${a.key}  plan=${a.plan ?? "unknown"}  state=${a.state}${flag}  last_success=${a.last_success_at ?? "never"}${why}`;
    })
    .join("\n");
}

/** Every account's warning (plan unknown, reading failing, excluded, ...), deduplicated. */
export function quotaAccountWarnings(rawQuotas, nowMs = Date.now(), policy = DEFAULT_SCORING_POLICY) {
  return [...new Set(listQuotaAccounts(rawQuotas, nowMs, policy).flatMap((a) => a.warnings))];
}

/** The usage entries of a snapshot, normalized once. */
function entriesOf(rawQuotas, nowMs, policy) {
  if (!rawQuotas || typeof rawQuotas !== "object") return [];
  return Array.isArray(rawQuotas._normalized) ? rawQuotas._normalized : normalizeQuotaSnapshot(rawQuotas, nowMs, policy);
}

/** The accounts of a snapshot that serve a model (by provider family). */
export function accountsServing(entries, rawModel, aliases = MODEL_ALIASES) {
  return entries.filter((e) => providerMatchesModel(e.provider, rawModel, aliases) || providerMatchesModel(e.key, rawModel, aliases));
}

/** Whether an account's balance is spent (a prepaid account with nothing left). */
const balanceSpent = (entry) => Boolean(entry.balance) && typeof entry.balance.amount === "number" && entry.balance.amount <= 0;

/**
 * Quick check for `evaluateProviderContinuation`: `true` when the sticky session's current model has exhausted its quota: every
 * account that serves it is out (state, spent balance) or has a known window that binds the model at or inside the safety
 * margin, so the session hold should break with `why: "quota_exhausted"` (matching Magpie's `spent`).
 */
export function isModelQuotaExhausted(rawModel, rawQuotas, policy = DEFAULT_SCORING_POLICY, nowMs = Date.now(), preferredProvider = "") {
  if (!rawQuotas || !rawModel) return false;
  const name = preferredProvider && !rawModel.includes("/") ? `${preferredProvider}/${rawModel}` : rawModel;
  const serving = accountsServing(entriesOf(rawQuotas, nowMs, policy), name);
  if (serving.length === 0) return false;
  const margin = Number(policy.safety_margin_pct ?? 5);
  const names = [canonicalModel(name), name];
  return serving.every((entry) => {
    if (entry.excluded || balanceSpent(entry)) return true;
    if (entry.unlimited) return false;
    return (entry.windows || []).some((w) => {
      if (!w.known || w.unlimited) return false;
      const scope = templateWindowScope(entry.provider, entry.plan, w.id);
      return bindsAny(names, scope, { models: w.models }) && w.remaining <= margin;
    });
  });
}

/**
 * True when `rawQuotas` is present and every model in `candidateModels` (or none) is blocked by account non-dispatchability
 * (`excluded`, `pool/quotas` expired >= 6h, exhausted prepaid balance <= 0).
 */
export function areCandidatesAccountBlocked(candidateModels, rawQuotas, options = {}, nowMs = Date.now()) {
  if (!rawQuotas || typeof rawQuotas !== "object") return false;
  const policy = (options?.catalog || {}).policy || DEFAULT_SCORING_POLICY;
  const list = entriesOf(rawQuotas, nowMs, policy);
  if (list.length === 0) return false;
  if (list.some((e) => e.poolLevel && e.excluded)) return true;
  const names = (Array.isArray(candidateModels) ? candidateModels : [])
    .map((item) => (typeof item === "string" ? item.trim() : item && typeof item === "object" ? String(item.model || item.id || item.name || "").trim() : ""))
    .filter(Boolean);
  if (names.length === 0) return false;
  return names.every((m) => {
    const serving = accountsServing(list, m);
    return serving.length > 0 && serving.every((e) => e.excluded || balanceSpent(e));
  });
}

/**
 * Magpie Pool Seat Ordering Strategy (`strategies.agentcompass` & `strategies["agentcompass-pure"]`).
 *
 * Combines Magpie's `Seat` telemetry (`internal/middleware/points.go:201-212`:
 * `{ key, account, known, learns, used, soon, pace, weight, resting, tokens }`)
 * with AgentCompass's subscription opportunity-cost and pre-reset surplus sprint economics:
 *
 * 1. Partitions seats into 4 availability tiers:
 *    - Tier 0 (`fine`): `!excluded && !resting && used < keepPercent (default 90%)`
 *    - Tier 1 (`low` reserve): `!excluded && !resting && used >= keepPercent && used < 100%`
 *    - Tier 2 (`spent` / `resting`): `!excluded && (resting || used >= 100%)`
 *    - Tier 3 (`excluded`): `plan_inactive`, `auth_failed`, `disabled`, or `usage_failing` past 6h
 * 2. Within each tier, non-expired `usage_failing` seats rank after `ready` seats.
 * 3. Within Tier 0 (`fine`):
 *    - `seat.learns === true` goes first once (so unknown accounts that learn their quota from
 *      response headers get probed, matching Magpie's `Smart` and `Pace`).
 *    - Subscription seats (`seat.account !== false` and known window/use) rank ahead of
 *      pay-as-you-go API keys (`seat.account === false` with no window), preventing paid wallet
 *      balance from burning while subscription quota sits idle.
 *    - Computes each subscription seat's net AgentCompass quota score (`resetBonus - opportunityCost`)
 *      from `remaining = 100 - used`, `soon[0]` (window renewal unix ms), and `pace` (% left/hour):
 *      * Seats inside the 36h pre-reset horizon with surplus quota (`resetBonus > 0`) go FIRST
 *        so expiring allowance is harvested before reset!
 *      * Otherwise, seats with the lowest opportunity cost / highest sustainable pace go first.
 * 4. Returns a permutation of seat indices `[0 .. seats.length - 1]`.
 */
const EXCLUDED_SEAT_STATES = new Set([
  ACCOUNT_STATES.PLAN_INACTIVE,
  ACCOUNT_STATES.AUTH_FAILED,
  ACCOUNT_STATES.DISABLED,
]);

/** A seat's weekly capacity: its own `capacityUsd`, else the public community figure of its plan; null when unknown. */
function seatCapacityUsd(seat, matchedEntry = null, poolProvider = "") {
  if (typeof seat.capacityUsd === "number" && seat.capacityUsd > 0) return seat.capacityUsd;
  const provider =
    String(seat.provider || matchedEntry?.provider || poolProvider || "").toLowerCase() ||
    inferModelProviderFamily(String(seat.key || ""));
  const plan = configuredPlan(provider, seat.plan ?? matchedEntry?.plan);
  const rows = (PLAN_CAPACITY[provider] || {})[plan] || {};
  const row = rows.seven_day || rows.usage || null;
  return row && typeof row.capacity_usd === "number" ? row.capacity_usd : null;
}

function matchSeatQuotaEntry(seat, poolProvider, normalizedQuotas) {
  if (!Array.isArray(normalizedQuotas) || normalizedQuotas.length === 0 || !seat) return null;
  const prov =
    String(seat.provider || poolProvider || "").trim().toLowerCase() ||
    inferModelProviderFamily(String(seat.key || ""));
  const key = typeof seat.key === "string" ? seat.key.trim() : "";
  const acct = typeof seat.account === "string" ? seat.account.trim() : "";
  const name = typeof seat.name === "string" ? seat.name.trim() : "";

  for (const e of normalizedQuotas) {
    if (e.poolLevel) continue;
    const provOk = !prov || !e.provider || providersMatch(prov, e.provider);
    if (
      key &&
      (e.key === key ||
        (prov && e.key === `${prov}/${key}`) ||
        (!key.includes("/") && provOk && e.account === key))
    ) {
      return e;
    }
    if (
      acct &&
      (e.key === acct ||
        (prov && e.key === `${prov}/${acct}`) ||
        (!acct.includes("/") && provOk && e.account === acct))
    ) {
      return e;
    }
    if (
      name &&
      (e.key === name ||
        (prov && e.key === `${prov}/${name}`) ||
        (!name.includes("/") && provOk && e.account === name))
    ) {
      return e;
    }
  }
  return null;
}

function resolveSeatHealth(seat, poolProvider, matchedEntry, nowMs, maxAgeMs) {
  if (!seat || typeof seat !== "object") {
    return { state: ACCOUNT_STATES.READY, excluded: false };
  }
  const prov =
    String(seat.provider || matchedEntry?.provider || poolProvider || "").trim().toLowerCase() ||
    inferModelProviderFamily(String(seat.key || ""));
  const rawState = String(seat.state || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const rawStatus = String(seat.status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const planInfo = normalizePlan(prov, seat.plan ?? matchedEntry?.plan);
  const http = httpStatusOf(seat);
  const errCode = errorCodeOf(seat);

  let state = ACCOUNT_STATES.READY;
  let excluded = Boolean(seat.excluded === true || seat.usage_excluded === true || seat.dispatchable === false);

  if (seat.disabled === true || seat.enabled === false || rawState === ACCOUNT_STATES.DISABLED || rawStatus === "disabled") {
    state = ACCOUNT_STATES.DISABLED;
    excluded = true;
  } else if (
    rawState === ACCOUNT_STATES.PLAN_INACTIVE ||
    planInfo.inactive ||
    STATUS_PLAN_INACTIVE.has(rawStatus) ||
    http === 402 ||
    (errCode && INACTIVE_ERROR_CODES.has(errCode))
  ) {
    state = ACCOUNT_STATES.PLAN_INACTIVE;
    excluded = true;
  } else if (
    rawState === ACCOUNT_STATES.AUTH_FAILED ||
    http === 401 ||
    http === 403 ||
    STATUS_AUTH_FAILED.has(rawStatus) ||
    (errCode && STATUS_AUTH_FAILED.has(errCode))
  ) {
    state = ACCOUNT_STATES.AUTH_FAILED;
    excluded = true;
  } else if (
    rawState === ACCOUNT_STATES.USAGE_FAILING ||
    STATUS_USAGE_FAILING.has(rawStatus) ||
    seat.error ||
    seat.stale === true
  ) {
    state = ACCOUNT_STATES.USAGE_FAILING;
    const anchorMs = firstTimeMs(
      seat.last_success_at,
      seat.lastSuccessAt,
      seat.failing_since,
      seat.failingSince
    );
    if (anchorMs !== null && nowMs - anchorMs >= maxAgeMs) {
      excluded = true;
    }
  } else if (EXCLUDED_SEAT_STATES.has(rawState)) {
    state = rawState;
    excluded = true;
  }

  if (matchedEntry) {
    if (matchedEntry.excluded) {
      excluded = true;
      state = matchedEntry.state;
    } else if (state === ACCOUNT_STATES.READY && matchedEntry.state !== ACCOUNT_STATES.READY) {
      state = matchedEntry.state;
    }
  }

  return { state, excluded };
}

export function orderSeatsByQuotaEconomics(_pool, seats, options = {}) {
  if (!Array.isArray(seats)) return [];
  if (seats.length <= 1) return seats.map((_, i) => i);

  const nowMs = Number.isFinite(options?.now) ? Number(options.now) : Date.now();
  const keepPercent = Number(options?.keepPercent ?? 90);
  const policy = options?.catalog?.policy || DEFAULT_SCORING_POLICY;
  const maxAgeHours = Number(options?.usageMaxAgeHours ?? policy?.usage_max_age_hours ?? DEFAULT_USAGE_MAX_AGE_HOURS);
  const maxAgeMs = maxAgeHours * 3600000;
  const poolProvider = typeof _pool === "string" ? _pool.trim().toLowerCase() : "";

  const rawQuotas =
    options?.quotas && typeof options.quotas === "object"
      ? options.quotas
      : loadLiveQuotas(options, nowMs);
  const normalizedQuotas =
    rawQuotas && typeof rawQuotas === "object"
      ? Array.isArray(rawQuotas._normalized)
        ? rawQuotas._normalized
        : normalizeQuotaSnapshot(rawQuotas, nowMs, policy)
      : [];

  const matchedEntries = seats.map((s) => matchSeatQuotaEntry(s, poolProvider, normalizedQuotas));
  const seatHealth = seats.map((s, i) => resolveSeatHealth(s, poolProvider, matchedEntries[i], nowMs, maxAgeMs));

  const isSharedSubscription = (s) => {
    if (s.account === false) {
      return Boolean(s.known && Array.isArray(s.soon) && s.soon.some((t) => Number(t) > 0));
    }
    if (!s.known && s.account !== true) return false;
    return true;
  };

  const seatTier = (idx) => {
    const s = seats[idx] || {};
    if (seatHealth[idx]?.excluded) return 3;
    if (s.resting) return 2;
    const used = typeof s.used === "number" ? s.used : 0;
    if (used >= 100) return 2;
    if (used >= keepPercent) return 1;
    return 0;
  };

  // How far each seat is behind the pace at which its week's capacity just runs out (the economy's recovery line, C * e): a
  // seat behind it will let capacity expire at its reset, so it goes first; a seat ahead of it is scarce.
  const netScores = seats.map((s, idx) => {
    const used = typeof s.used === "number" ? clamp(s.used, 0, 100) : 0;
    const remaining = 100 - used;
    const soonMs = Array.isArray(s.soon) && s.soon.length > 0 && Number(s.soon[0]) > 0 ? Number(s.soon[0]) : null;
    let resetHours = soonMs !== null && soonMs > nowMs ? (soonMs - nowMs) / 3600000 : null;
    if ((resetHours === null || resetHours <= 0) && typeof s.pace === "number" && s.pace > 0 && remaining > 0) resetHours = remaining / s.pace;
    if (resetHours === null || resetHours <= 0) resetHours = 168;
    const known = Boolean(s.known || soonMs !== null || s.used > 0);
    if (!known) return 0.0;
    const rec = fiveAxisWindowRecovery({ known: true, full: 100, remaining, hours: 168, reset_hours: Math.min(resetHours, 168) }, seatCapacityUsd(s, matchedEntries[idx], poolProvider) || 100);
    if (rec === null) return 0.0;
    return round4(rec.elapsed_frac - used / 100);
  });

  return seats
    .map((_, i) => i)
    .sort((ia, ib) => {
      const a = seats[ia] || {};
      const b = seats[ib] || {};

      const ta = seatTier(ia);
      const tb = seatTier(ib);
      if (ta !== tb) return ta - tb;

      // Within any tier, non-expired `usage_failing` seats rank after `ready` seats
      const aFailing = seatHealth[ia]?.state === ACCOUNT_STATES.USAGE_FAILING ? 1 : 0;
      const bFailing = seatHealth[ib]?.state === ACCOUNT_STATES.USAGE_FAILING ? 1 : 0;
      if (aFailing !== bFailing) return aFailing - bFailing;

      // Within Tier 0 (healthy seats)
      if (ta === 0) {
        if (Boolean(a.learns) !== Boolean(b.learns)) {
          return a.learns ? -1 : 1;
        }
        const aSub = isSharedSubscription(a);
        const bSub = isSharedSubscription(b);
        if (aSub !== bSub) {
          return aSub ? -1 : 1;
        }
        const diffScore = netScores[ib] - netScores[ia];
        if (Math.abs(diffScore) > 0.002) {
          return diffScore < 0 ? -1 : 1;
        }
        if (typeof a.pace === "number" && typeof b.pace === "number" && Math.abs(a.pace - b.pace) > 0.05) {
          return b.pace - a.pace;
        }
      }

      const aUsed = typeof a.used === "number" ? a.used : 50;
      const bUsed = typeof b.used === "number" ? b.used : 50;
      if (aUsed !== bUsed) return aUsed - bUsed;

      const aTokens = typeof a.tokens === "number" ? a.tokens : 0;
      const bTokens = typeof b.tokens === "number" ? b.tokens : 0;
      if (aTokens !== bTokens) return aTokens - bTokens;

      return ia - ib;
    });
}

export function shouldSkipQuotaAccount(acct, ctx, quotaAccounts) {
  if (!Array.isArray(quotaAccounts) || quotaAccounts.length === 0) return false;
  if (quotaAccounts.some((a) => a.key === "pool/quotas" && a.dispatchable === false)) {
    return true;
  }
  const rawProv =
    acct.provider ||
    ctx?.provider?.id ||
    ctx?.provider?.name ||
    (typeof acct.key === "string" && acct.key.includes("/") ? acct.key.split("/")[0] : "") ||
    (typeof acct.ref === "string" && acct.ref.includes("/") ? acct.ref.split("/")[0] : "");
  const acctProv = normalizeProviderFamily(rawProv);
  const fullKeys = new Set(
    [
      typeof acct.key === "string" && acct.key.includes("/") ? acct.key : "",
      typeof acct.ref === "string" && acct.ref.includes("/") ? acct.ref : "",
      acct.provider && acct.name ? `${acct.provider}/${acct.name}` : "",
      acct.provider && acct.account ? `${acct.provider}/${acct.account}` : "",
      acctProv && acct.name ? `${acctProv}/${acct.name}` : "",
      acctProv && acct.account ? `${acctProv}/${acct.account}` : "",
    ]
      .filter((v) => typeof v === "string" && v.trim())
      .map((v) => v.trim())
  );
  const bareNames = new Set(
    [
      acct.name,
      acct.account,
      typeof acct.key === "string" && !acct.key.includes("/") ? acct.key : "",
      typeof acct.ref === "string" && !acct.ref.includes("/") ? acct.ref : "",
    ]
      .filter((v) => typeof v === "string" && v.trim())
      .map((v) => v.trim())
  );
  const exactMatches = quotaAccounts.filter((a) => {
    if (a.key === "pool/quotas") return false;
    if (fullKeys.has(a.key)) return true;
    const provOk = !acctProv || !a.provider || providersMatch(acctProv, a.provider);
    if (!provOk) return false;
    return bareNames.has(a.account) || bareNames.has(a.key);
  });
  if (exactMatches.length > 0) {
    if (exactMatches.some((a) => a.dispatchable === false)) {
      return true;
    }
  } else if (acctProv) {
    const provMatches = quotaAccounts.filter(
      (a) => a.key !== "pool/quotas" && providersMatch(acctProv, a.provider)
    );
    if (provMatches.length > 0 && provMatches.every((a) => a.dispatchable === false)) {
      return true;
    }
  }
  return false;
}
