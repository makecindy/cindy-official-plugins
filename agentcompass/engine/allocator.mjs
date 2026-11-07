// Vendored from akiiwa-games/magpie-agentcompass-router src/allocator.js at a2215b3e2dc57cd6a3689b05ae8d4927e7926b7f (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate rather than edit.
/**
 * AgentCompass Core Pure Intent & Multi-Dimensional Capability Allocator
 *
 * Exact port of the intent, capability vector, Model DNA (`divergence`, `global_rigor`,
 * `module_precision`), continuous `taskDemand`, `effortAbility`, ability floor, and
 * overqualification pricing algorithms from `skills/agent-compass/scripts/allocator.py`.
 *
 * Pure ES2022 module with zero external dependencies so it runs in both Bun (`magpie.hooks`
 * and `/v1/systemone` Decision Provider) and Magpie's in-process `moejs` (`magpie.middleware`).
 */

import {
  CANONICAL_ROUTES,
  CAPABILITY_DIMENSIONS,
  DEFAULT_MODELS,
  DEFAULT_SCORING_POLICY,
  DIFFICULTY_ORDER,
  EFFORT_CURVES,
  EFFORT_ORDER,
  KIND_TRAITS,
  MODEL_ALIASES,
  ROUTE_FIT_PEERS,
  SUBJECTIVE_DIMENSIONS,
  canonicalModel,
  resolveModelSpec,
} from "./catalog.mjs";
import { inferTaskProfile, validateProfile } from "./profiler.mjs";
/**
 * AgentCompass Subscription Quota, Opportunity Cost & Pre-Reset Sprint Economics
 *
 * Exact port of the subscription window state, Normal demand forecast (`demand_forecast`),
 * expected shortage (`expected_shortage`), shortage probability (`shortage_probability`),
 * window opportunity cost (`window_cost`), scarcity penalty, pre-reset surplus sprint
 * (`reset_sunk_weight`, `reset_bonus`), and subscription-vs-metered billing discipline from
 * `skills/agent-compass/scripts/allocator.py` (lines 604-797, 1655-2170).
 *
 * Also integrates natively with Magpie's quota telemetry:
 * 1. `quotas.json` (`{ "<provider>/<account>": { kind, quota: { windows: [...] }, balance } }`)
 * 2. `GET /v1/magpie/quotas` (`[{ provider, name, kind, windows: [...], balance }]`)
 * 3. Magpie `Seat` objects in `strategies.agentcompass(pool, seats, options)`
 *    (`{ key, account, known, learns, used, soon, pace, weight, resting, tokens }`)
 *
 * Pure ES2022 module with zero external or Node-only dependencies so it runs in both
 * Bun (`magpie.hooks` / `/v1/systemone`) and Magpie's in-process `moejs` (`magpie.middleware`).
 */


const SQRT2 = Math.SQRT2;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * Default API-equivalent USD capacity priors for subscription windows when `capacity_usd`
 * is not explicitly specified in `quotas.json` or `options.windowCapacityUsd`.
 */
export const DEFAULT_WINDOW_CAPACITY_USD = {
  claude: {
    short: 45.0,
    weekly: 220.0,
    monthly: 800.0,
  },
  codex: {
    short: 50.0,
    weekly: 250.0,
    monthly: 900.0,
  },
  antigravity: {
    "gemini-5h": 182.0,
    "gemini-weekly": 625.0,
    "3p-5h": 17.6,
    "3p-weekly": 88.0,
    short: 182.0,
    weekly: 625.0,
    monthly: 1800.0,
  },
  gemini: {
    short: 120.0,
    weekly: 450.0,
    monthly: 1500.0,
  },
  default: {
    short: 40.0,
    weekly: 180.0,
    monthly: 650.0,
  },
};




/**
 * Abramowitz & Stegun 7.1.26 error function `erf(x)` (max error < 1.5e-7).
 */
export function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + 0.3275911 * ax);
  const y =
    1.0 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * E[(D - remaining)+] in percent for demand D ~ Normal(mean, sd) (`allocator.py:expected_shortage`).
 */
export function expectedShortage(remaining, mean, sd) {
  const safeSd = Math.max(Number(sd) || 1e-6, 1e-6);
  const z = (mean - remaining) / safeSd;
  return (
    (safeSd * Math.exp((-z * z) / 2.0)) / SQRT_2PI +
    ((mean - remaining) * (1.0 + erf(z / SQRT2))) / 2.0
  );
}

/**
 * P(D > remaining) for demand D ~ Normal(mean, sd) (`allocator.py:shortage_probability`).
 */
export function shortageProbability(remaining, mean, sd) {
  const safeSd = Math.max(Number(sd) || 1e-6, 1e-6);
  return (1.0 + erf((mean - remaining) / (safeSd * SQRT2))) / 2.0;
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
  if (canon.startsWith("gpt") || canon.includes("codex") || canon.includes("o1") || canon.includes("o3")) {
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
 * Check whether a specific quota window applies to the given canonical model
 * (`allocator.py:legacy_model_binds_window` and Magpie `strategies.go:124`).
 */
export function windowBindsModel(windowName, canonicalModelName, explicitModels = null) {
  const wid = String(windowName || "").trim().toLowerCase();
  const model = String(canonicalModelName || "").trim().toLowerCase();

  if (Array.isArray(explicitModels) && explicitModels.length > 0) {
    const matchesExplicit = explicitModels.some((tag) => {
      const t = String(tag || "").toLowerCase();
      return t && (model.includes(t) || wid.includes(t));
    });
    if (!matchesExplicit) return false;
  }

  if (wid.includes("fable") && !model.includes("fable")) return false;
  if (wid.includes("opus") && !model.includes("opus")) return false;
  if (wid.includes("sonnet") && !model.includes("sonnet")) return false;
  if (wid.includes("haiku") && !model.includes("haiku")) return false;
  if (wid.startsWith("gemini-") && !model.startsWith("gemini")) return false;
  if (wid.startsWith("3p-") && model.startsWith("gemini")) return false;

  return true;
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
 * Resolve API-equivalent USD capacity for a subscription window (`allocator.py:window_capacity_usd`).
 */
export function resolveWindowCapacityUsd(provider, windowName, windowHours, explicitCapUsd = null, customTable = null) {
  if (typeof explicitCapUsd === "number" && explicitCapUsd > 0) {
    return explicitCapUsd;
  }
  const prov = String(provider || "default").toLowerCase();
  const wid = String(windowName || "").toLowerCase();
  const table =
    (customTable && (customTable[prov] || customTable.default)) ||
    DEFAULT_WINDOW_CAPACITY_USD[prov] ||
    DEFAULT_WINDOW_CAPACITY_USD.default;

  if (table && typeof table[wid] === "number") {
    return table[wid];
  }
  if (windowHours < 24) {
    return Number(table?.short ?? DEFAULT_WINDOW_CAPACITY_USD.default.short);
  }
  if (windowHours <= 170) {
    return Number(table?.weekly ?? DEFAULT_WINDOW_CAPACITY_USD.default.weekly);
  }
  return Number(table?.monthly ?? DEFAULT_WINDOW_CAPACITY_USD.default.monthly);
}

/**
 * Normalize a single window observation into AgentCompass's canonical `windowState`
 * (`allocator.py:window_state`).
 */
export function normalizeWindowState(rawWin, provider = "default", nowMs = Date.now(), policy = DEFAULT_SCORING_POLICY, accountStale = false) {
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
  const capacityUsd = resolveWindowCapacityUsd(
    provider,
    id,
    hours,
    rawWin.capacity_usd ?? rawWin.capacityUsd,
  );

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
    capacityUsd,
    rateLimited: Boolean(rawWin.rate_limited || rawWin.rateLimited),
    pctPerHour3h: typeof rawWin.pct_per_hour_3h === "number" ? rawWin.pct_per_hour_3h : null,
    pctPerHour24h: typeof rawWin.pct_per_hour_24h === "number" ? rawWin.pct_per_hour_24h : null,
    models: Array.isArray(rawWin.models) ? rawWin.models : null,
  };
}

/**
 * Normalize Magpie's `quotas.json`, `/v1/magpie/quotas` array, AgentCompass `usage.json`,
 * or shorthand `{ provider: { remaining, resetsInHours, windows } }` into a uniform array
 * of account quota records:
 *   `[{ key, provider, account, kind, unlimited, stale, balance, windows: [windowState, ...] }]`
 */
export function normalizeQuotaSnapshot(rawQuotas, nowMs = Date.now(), policy = DEFAULT_SCORING_POLICY) {
  if (!rawQuotas || typeof rawQuotas !== "object") return [];

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
      const windows = rawWindows
        .map((w) => normalizeWindowState(w, provider, nowMs, policy, stale))
        .filter(Boolean);
      const kind = String(
        item.kind ||
          item.billing ||
          (windows.length > 0 ? "subscription" : item.balance ? "balance" : "subscription")
      ).toLowerCase();
      entries.push({
        key,
        provider: provider || inferModelProviderFamily(key),
        account,
        kind,
        unlimited: Boolean(item.unlimited),
        stale,
        balance: item.balance || null,
        error: item.error || null,
        windows,
      });
    }
    return entries;
  }

  // Format B: AgentCompass `usage.json` (`{ accounts: { claude: { status, windows: [...] } } }`)
  if (rawQuotas.accounts && typeof rawQuotas.accounts === "object" && !Array.isArray(rawQuotas.accounts)) {
    return normalizeQuotaSnapshot(rawQuotas.accounts, nowMs, policy);
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

    const windows = rawWindows
      .map((w) => normalizeWindowState(w, provider, nowMs, policy, stale))
      .filter(Boolean);

    const kind = String(
      item.kind ||
        item.billing ||
        item.quota?.kind ||
        (windows.length > 0 ? "subscription" : item.balance || item.quota?.balance ? "balance" : "subscription")
    ).toLowerCase();

    entries.push({
      key: rawKey,
      provider: provider || inferModelProviderFamily(rawKey),
      account,
      kind,
      unlimited: Boolean(item.unlimited || item.quota?.unlimited),
      stale,
      balance: item.balance || item.quota?.balance || null,
      error: item.error || item.quota?.error || null,
      windows,
    });
  }

  return entries;
}

/**
 * Forecast percent of the window that other work will draw before the window resets
 * (`allocator.py:demand_forecast`).
 */
export function demandForecast(windowState, policy = DEFAULT_SCORING_POLICY, forceShortForecast = false) {
  if (!windowState || !windowState.known || windowState.unlimited) return null;

  let rate = null;
  let source = "observed";

  if (windowState.short && !forceShortForecast) {
    rate = windowState.pctPerHour3h ?? windowState.pctPerHour24h;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
      return null;
    }
  } else {
    rate = windowState.pctPerHour24h;
    const elapsed = Math.max(0, windowState.hours - windowState.resetHours);
    const minElapsed = Number(policy?.demand_min_elapsed_hours ?? 6);
    if (
      (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) &&
      elapsed >= minElapsed &&
      typeof windowState.remaining === "number"
    ) {
      rate = Math.max(0.0, 100.0 - windowState.remaining) / elapsed;
      source = "period average";
    }
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
      rate = 100.0 / Math.max(1.0, windowState.hours);
      source = "straight-line schedule";
    }
    if (
      source === "observed" &&
      windowState.remaining < (windowState.targetRemaining ?? 0)
    ) {
      const paceFloorRatio = Number(policy?.demand_pace_floor_ratio ?? 0.5);
      rate = Math.max(rate, (paceFloorRatio * 100.0) / Math.max(1.0, windowState.hours));
    }
  }

  const endHours = Math.max(0.0, windowState.endHours);
  const mean = rate * endHours;
  const sdFloor =
    Number(policy?.demand_sd_floor_pct ?? 5) * Math.min(1.0, Math.max(0.0, endHours) / 24.0);
  const cv = Number(policy?.demand_cv ?? 0.35);
  const sd = Math.max(cv * mean, sdFloor, 1e-6);

  return { mean, sd, rate, source };
}

/**
 * Compute one window's opportunity cost, scarcity cost, and pre-reset surplus bonus
 * (`allocator.py:window_cost`).
 */
export function computeWindowCost(windowState, stepPct, forecast, policy = DEFAULT_SCORING_POLICY, stepUsd = null) {
  const { mean, sd, rate, source } = forecast;
  const remaining = windowState.remaining;
  const endHours = windowState.endHours;
  const safetyMarginPct = Number(policy?.safety_margin_pct ?? 5);
  const usable = remaining - safetyMarginPct;

  const shortage = Math.max(
    0.0,
    expectedShortage(usable - stepPct, mean, sd) - expectedShortage(usable, mean, sd)
  );
  const shortageProb = shortageProbability(usable - stepPct, mean, sd);
  const capacityUsd = windowState.capacityUsd || 180.0;
  const realStepUsd =
    stepUsd !== null && stepUsd !== undefined
      ? stepUsd
      : (stepPct * capacityUsd) / 100.0;
  const displacedUsd = (shortage * capacityUsd) / 100.0;
  const scorePerUsd = Number(
    policy?.opportunity_exchange?.score_per_displaced_usd ??
      policy?.shortage_loss_per_usd ??
      0.012
  );
  let cost = scorePerUsd * displacedUsd;

  const scarcityRef = Number(policy?.scarcity_usable_ref_pct ?? 45.0);
  const scarcity =
    !windowState.short && scarcityRef > 0
      ? shortageProb *
        Math.pow(clamp(1.0 - Math.max(0.0, usable - stepPct) / scarcityRef, 0.0, 1.0), 1.5)
      : 0.0;
  let scarcityCost = Number(policy?.scarcity_penalty_max ?? 0.06) * scarcity;
  cost += scarcityCost;

  const horizon = Number(policy?.reset_horizon_hours ?? 36);
  let sunkWeight = 0.0;
  const excessPct = Math.max(0.0, usable - stepPct - mean);

  if (
    horizon > 0 &&
    !windowState.stale &&
    windowState.resetHours > 0 &&
    windowState.resetHours <= horizon &&
    usable - stepPct > 0
  ) {
    const base = clamp(1.0 - windowState.resetHours / horizon, 0.0, 1.0);
    const urgencyPower = Number(policy?.reset_urgency_power ?? 1.0);
    const urgency = Math.pow(
      0.4 * base + 0.6 * Math.exp(-windowState.resetHours / 12.0),
      urgencyPower
    );
    const surplusRef = Math.max(1e-6, Number(policy?.reset_surplus_ref_pct ?? 15));
    const surplus = (1.0 - shortageProb) * clamp(excessPct / surplusRef, 0.0, 1.0);
    sunkWeight = round4(urgency * surplus);
  }

  const resetBonus =
    sunkWeight > 0
      ? round4(Number(policy?.reset_bonus_max ?? 1.2) * sunkWeight)
      : 0.0;

  cost *= 1.0 - sunkWeight;
  scarcityCost *= 1.0 - sunkWeight;

  return {
    window: windowState.id,
    remaining: round3(remaining),
    after: round3(remaining - stepPct),
    step_pct: round3(stepPct),
    capacity_usd: round3(capacityUsd),
    expected_usd: round3(realStepUsd),
    reset_hours: round3(windowState.resetHours),
    end_hours: round3(endHours),
    demand_pct: round3(mean),
    demand_source: source,
    rate_pct_per_hour: round3(rate),
    shortage_probability: round3(shortageProb),
    scarcity_cost: round4(scarcityCost),
    usd_displaced: round3(displacedUsd),
    reset_sunk_weight: sunkWeight,
    reset_bonus: resetBonus,
    surplus_pct: round3(excessPct),
    opportunity_cost: round4(cost),
  };
}

/**
 * Evaluate a single account's quota eligibility and opportunity cost for `(canonicalModel, effort)`.
 */
export function evaluateAccountQuotaForModel(
  accountEntry,
  canonicalModelName,
  modelSpec,
  effort,
  effortScale,
  taskHours,
  policy = DEFAULT_SCORING_POLICY
) {
  const excluded = [];
  const kind = String(accountEntry.kind || "subscription").toLowerCase();
  const isMetered = kind === "balance" || kind === "metered" || kind === "api" || kind === "payg";

  if (accountEntry.unlimited) {
    return {
      account: accountEntry.key,
      provider: accountEntry.provider,
      kind,
      eligible: true,
      excluded: [],
      opportunity_cost: 0.0,
      free_usage: Number(policy?.unlimited_bonus ?? 0.18),
      reset_bonus: 0.0,
      reset_sunk_weight: 0.0,
      binding_window: null,
    };
  }

  const applicable = (accountEntry.windows || []).filter((w) =>
    windowBindsModel(w.id, canonicalModelName, w.models)
  );

  // If this is a metered / balance-only account with no subscription windows
  if (applicable.length === 0) {
    if (isMetered) {
      const bal = accountEntry.balance;
      if (bal && typeof bal.amount === "number" && bal.amount <= 0) {
        excluded.push(`${accountEntry.key}: prepaid balance is exhausted (${bal.amount})`);
      }
      const usdPerHour = Number(modelSpec?.usd_per_hour ?? 3.0);
      const stepUsd = taskHours * usdPerHour * effortScale;
      const scorePerUsd = Number(
        policy?.opportunity_exchange?.score_per_displaced_usd ??
          policy?.shortage_loss_per_usd ??
          0.012
      );
      // Metered API keys pay direct list-price opportunity cost plus a small reserve preference penalty
      const meteredCost = round4(scorePerUsd * stepUsd + 0.035);
      return {
        account: accountEntry.key,
        provider: accountEntry.provider,
        kind: "metered",
        eligible: excluded.length === 0,
        excluded,
        opportunity_cost: meteredCost,
        reset_bonus: 0.0,
        reset_sunk_weight: 0.0,
        binding_window: null,
      };
    }
    return {
      account: accountEntry.key,
      provider: accountEntry.provider,
      kind,
      eligible: true,
      excluded: [],
      opportunity_cost: Number(policy?.unknown_capacity_penalty ?? 0.03),
      reset_bonus: 0.0,
      reset_sunk_weight: 0.0,
      binding_window: null,
    };
  }

  const usdPerHour = Number(modelSpec?.usd_per_hour ?? 3.0);
  const durMult = Number(modelSpec?.duration_multiplier ?? 1.0);
  const effectiveHours = taskHours * durMult;
  const stepUsd = effectiveHours * usdPerHour * effortScale;

  const hasLongWindow = applicable.some((w) => !w.short && w.known);
  let totalOpportunityCost = 0.0;
  let binding = null;

  for (const w of applicable) {
    if (!w.known) continue;
    if (w.unlimited) continue;

    const unitRatePct = w.capacityUsd > 0 ? (100.0 * usdPerHour * effortScale) / w.capacityUsd : 2.0 * effortScale;
    const stepPct = effectiveHours * unitRatePct;

    if (w.short) {
      const smallShort = w.capacityUsd < Number(policy?.small_short_capacity_usd ?? 50);
      const floorPct = smallShort
        ? Number(policy?.small_short_window_floor_pct ?? 25)
        : Number(policy?.short_window_floor_pct ?? 10);
      const marginPct = smallShort
        ? Number(policy?.small_short_safety_margin_pct ?? 12)
        : Number(policy?.safety_margin_pct ?? 5);

      if (w.rateLimited || w.remaining <= floorPct || w.remaining - stepPct < marginPct) {
        excluded.push(
          `${accountEntry.key} ${w.id}: ${w.remaining.toFixed(1)}% remaining is below short-window floor (${floorPct}% / ${marginPct}% margin)`
        );
        continue;
      }
      // If the account has a weekly/long window, the short window is a rate-cap gate and the weekly window prices the loss.
      // If the account ONLY has a short window (e.g. Claude Enterprise 5h-only), price it directly.
      if (hasLongWindow) {
        continue;
      }
    }

    const safetyMarginPct = Number(policy?.safety_margin_pct ?? 5);
    if (w.rateLimited || w.remaining <= 0 || w.remaining - stepPct < safetyMarginPct) {
      excluded.push(
        `${accountEntry.key} ${w.id}: ${w.remaining.toFixed(1)}% remaining is below ${safetyMarginPct}% safety margin (needs ~${stepPct.toFixed(1)}%)`
      );
      continue;
    }

    const forecast = demandForecast(w, policy, !hasLongWindow);
    if (!forecast) continue;

    const row = computeWindowCost(w, stepPct, forecast, policy, stepUsd);
    totalOpportunityCost += row.opportunity_cost;

    if (
      binding === null ||
      row.opportunity_cost > binding.opportunity_cost ||
      (row.opportunity_cost === binding.opportunity_cost && row.after < binding.after)
    ) {
      binding = row;
    }
  }

  return {
    account: accountEntry.key,
    provider: accountEntry.provider,
    kind,
    eligible: excluded.length === 0,
    excluded,
    opportunity_cost: round4(totalOpportunityCost),
    reset_bonus: binding ? binding.reset_bonus : 0.0,
    reset_sunk_weight: binding ? binding.reset_sunk_weight : 0.0,
    shortage_probability: binding ? binding.shortage_probability : 0.0,
    binding_window: binding,
  };
}

/**
 * Evaluate subscription quota economics across all matching accounts for a candidate `(rawModel, effort)`.
 * If a provider has multiple accounts in `quotas.json`, selects the best eligible account
 * (highest `reset_bonus - opportunity_cost`).
 */
export function evaluateModelQuota(
  rawModel,
  effort,
  taskCtx = {},
  rawQuotas = null,
  catalog = {},
  nowMs = Date.now()
) {
  if (!rawQuotas) return null;

  const models = catalog.models || DEFAULT_MODELS;
  const aliases = catalog.aliases || MODEL_ALIASES;
  const policy = catalog.policy || DEFAULT_SCORING_POLICY;
  const curvesTable = catalog.effortCurves || EFFORT_CURVES;

  const { canonical, spec: info } = resolveModelSpec(rawModel, models, aliases);
  const curves = curvesTable[canonical] || {};
  const refBurn = curves?.burn?.high ?? policy?.effort_burn?.high ?? 0.7;
  const effBurn = curves?.burn?.[effort] ?? policy?.effort_burn?.[effort] ?? refBurn;
  const effortScale = refBurn > 0 ? effBurn / refBurn : 1.0;

  const taskHours = Number(
    taskCtx.hours ??
      taskCtx.profile?.expected_hours ??
      policy?.default_hours?.[taskCtx.difficulty] ??
      0.5
  );

  const normalized = Array.isArray(rawQuotas._normalized)
    ? rawQuotas._normalized
    : normalizeQuotaSnapshot(rawQuotas, nowMs, policy);

  if (normalized.length === 0) return null;

  const matchingAccounts = normalized.filter((entry) =>
    providerMatchesModel(entry.provider, rawModel, aliases) ||
    providerMatchesModel(entry.key, rawModel, aliases)
  );

  if (matchingAccounts.length === 0) {
    return null;
  }

  const evaluations = matchingAccounts.map((entry) =>
    evaluateAccountQuotaForModel(
      entry,
      canonical,
      info,
      effort,
      effortScale,
      taskHours,
      policy
    )
  );

  const eligibleAccounts = evaluations.filter((e) => e.eligible);
  if (eligibleAccounts.length === 0) {
    return {
      eligible: false,
      excluded: evaluations.flatMap((e) => e.excluded),
      account: evaluations[0]?.account || null,
      provider: evaluations[0]?.provider || null,
      kind: evaluations[0]?.kind || "subscription",
      opportunity_cost: 0.0,
      reset_bonus: 0.0,
      reset_sunk_weight: 0.0,
      binding_window: null,
    };
  }

  // Prefer subscription accounts over metered accounts unless metered is the only eligible option;
  // among subscription accounts, pick the one with the best net quota score (reset_bonus - opportunity_cost).
  eligibleAccounts.sort((a, b) => {
    const aSub = a.kind !== "metered" ? 1 : 0;
    const bSub = b.kind !== "metered" ? 1 : 0;
    if (aSub !== bSub) return bSub - aSub;
    const aNet = (a.reset_bonus || 0) - (a.opportunity_cost || 0);
    const bNet = (b.reset_bonus || 0) - (b.opportunity_cost || 0);
    return bNet - aNet;
  });

  const best = eligibleAccounts[0];
  if (best.kind === "metered" && taskCtx.metered_ok === false) {
    return {
      ...best,
      eligible: false,
      excluded: [`${best.account}: metered billing is disabled (metered_ok: false)`],
    };
  }

  return best;
}

/**
 * Quick check for `evaluateProviderContinuation`: returns `true` when the sticky session's
 * current model/provider has exhausted its subscription quota (`remaining <= safety_margin_pct`),
 * so the session hold should break with `why: "quota_exhausted"` (matching Magpie's `spent`).
 */
export function isModelQuotaExhausted(
  rawModel,
  rawQuotas,
  policy = DEFAULT_SCORING_POLICY,
  nowMs = Date.now(),
  preferredProvider = ""
) {
  if (!rawQuotas || !rawModel) return false;
  const evalResult = evaluateModelQuota(
    preferredProvider && !rawModel.includes("/") ? `${preferredProvider}/${rawModel}` : rawModel,
    "medium",
    { hours: 0.1, difficulty: "routine" },
    rawQuotas,
    { policy },
    nowMs
  );
  if (!evalResult) return false;
  return evalResult.eligible === false;
}

/**
 * Magpie Pool Seat Ordering Strategy (`strategies.agentcompass` & `strategies["agentcompass-pure"]`).
 *
 * Combines Magpie's `Seat` telemetry (`internal/middleware/points.go:201-212`:
 * `{ key, account, known, learns, used, soon, pace, weight, resting, tokens }`)
 * with AgentCompass's subscription opportunity-cost and pre-reset surplus sprint economics:
 *
 * 1. Partitions seats into 3 availability tiers:
 *    - Tier 0 (`fine`): `!resting && used < keepPercent (default 90%)`
 *    - Tier 1 (`low` reserve): `!resting && used >= keepPercent && used < 100%`
 *    - Tier 2 (`spent` / `resting`): `resting || used >= 100%`
 * 2. Within Tier 0 (`fine`):
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
 * 3. Returns a permutation of seat indices `[0 .. seats.length - 1]`.
 */
export function orderSeatsByQuotaEconomics(_pool, seats, options = {}) {
  if (!Array.isArray(seats)) return [];
  if (seats.length <= 1) return seats.map((_, i) => i);

  const nowMs = Number.isFinite(options?.now) ? Number(options.now) : Date.now();
  const keepPercent = Number(options?.keepPercent ?? 90);
  const policy = options?.catalog?.policy || DEFAULT_SCORING_POLICY;

  const isSharedSubscription = (s) => {
    if (s.account === false) {
      return Boolean(s.known && Array.isArray(s.soon) && s.soon.some((t) => Number(t) > 0));
    }
    if (!s.known && s.account !== true) return false;
    return true;
  };

  const seatTier = (s) => {
    if (s.resting) return 2;
    const used = typeof s.used === "number" ? s.used : 0;
    if (used >= 100) return 2;
    if (used >= keepPercent) return 1;
    return 0;
  };

  // Pre-compute AgentCompass net quota score (`resetBonus - opportunityCost`) for each seat
  const netScores = seats.map((s) => {
    const used = typeof s.used === "number" ? clamp(s.used, 0, 100) : 0;
    const remaining = 100 - used;
    const soonMs =
      Array.isArray(s.soon) && s.soon.length > 0 && Number(s.soon[0]) > 0
        ? Number(s.soon[0])
        : null;
    let resetHours =
      soonMs !== null && soonMs > nowMs ? (soonMs - nowMs) / 3600000 : null;
    if (
      (resetHours === null || resetHours <= 0) &&
      typeof s.pace === "number" &&
      s.pace > 0 &&
      remaining > 0
    ) {
      resetHours = remaining / s.pace;
    }
    if (resetHours === null || resetHours <= 0) {
      resetHours = 168;
    }

    const winState = {
      id: "week",
      hours: 168,
      short: false,
      known: Boolean(s.known || soonMs !== null || s.used > 0),
      stale: false,
      remaining,
      used,
      resetHours,
      endHours: resetHours,
      targetRemaining: 100 * Math.min(1.0, resetHours / 168),
      capacityUsd: 220.0,
    };

    if (!winState.known) {
      return 0.0;
    }
    const forecast = demandForecast(winState, policy);
    if (!forecast) return 0.0;
    const costRow = computeWindowCost(winState, 1.5, forecast, policy);
    return round4((costRow.reset_bonus || 0) - (costRow.opportunity_cost || 0));
  });

  return seats
    .map((_, i) => i)
    .sort((ia, ib) => {
      const a = seats[ia] || {};
      const b = seats[ib] || {};

      const ta = seatTier(a);
      const tb = seatTier(b);
      if (ta !== tb) return ta - tb;

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


export const EFFORT_SCALED_CAPABILITIES = [
  "reasoning",
  "coding",
  "exploration",
  "anti_hallucination",
];

export const SUBJECTIVE_DIVERGENCE_SHARE = 0.4;

export function clamp(val, low, high) {
  return Math.max(low, Math.min(high, val));
}

export function round4(val) {
  return Math.round(val * 10000) / 10000;
}

export function round3(val) {
  return Math.round(val * 1000) / 1000;
}

export function profileDifficulty(profile, policy = DEFAULT_SCORING_POLICY) {
  const table = policy?.profile?.difficulty_by_depth || {};
  const depth = profile?.reasoning_depth || 2;
  return table[depth] || table[String(depth)] || { 1: "routine", 2: "hard", 3: "coupled", 4: "frontier" }[depth] || "hard";
}

export function namedRoute(profile) {
  if (!profile || typeof profile !== "object") return null;
  const named = profile.work_kind;
  if (named && named in KIND_TRAITS && named !== "other_or_mixed") return named;
  return null;
}

export function profileKind(profile, policy = DEFAULT_SCORING_POLICY) {
  const named = namedRoute(profile);
  if (named) return named;
  if (profile.needs_gui) return "computer_use";
  if (profile.needs_visual && profile.code_complexity === 0 && profile.interaction_style !== "text_only") {
    return "visual_analysis";
  }
  if (profile.interaction_style === "engineering" && profile.code_complexity === 0) {
    return "tool_execution";
  }
  return policy?.profile?.kind_by_style?.[profile.interaction_style] || "other_or_mixed";
}

export function effortValue(policy, curves, name, effort, fallback) {
  const own = curves?.[name] || {};
  if (effort in own) return own[effort];
  if (effort === "ultra" && "max" in own) return own.max;
  const policyTable = policy?.[`effort_${name}`] || {};
  if ((effort === "minimal" || effort === "none" || effort === "off") && "low" in own) {
    if (name === "ability") {
      const delta = (policyTable[effort] ?? -1.0) - (policyTable.low ?? -0.54);
      return own.low + Math.min(delta, -0.2);
    }
    if (name === "burn") {
      const ratio = (policyTable[effort] ?? 0.12) / (policyTable.low || 0.2);
      return round4(own.low * Math.min(ratio, 0.75));
    }
  }
  if (effort in policyTable) return policyTable[effort];
  if (effort === "ultra" && "max" in policyTable) return policyTable.max;
  return fallback;
}

/**
 * The model's effective tier at one effort level (`allocator.py:effort_ability`).
 */
export function effortAbility(policy, curves, info, effort = "high") {
  const tier = Number(info?.tier || 0);
  const mult = curves?.ability_mult || {};
  if (effort in mult) {
    return tier * Number(mult[effort]);
  }
  return tier + effortValue(policy, curves, "ability", effort, 0);
}

/**
 * Relative burn scale of `effort` compared to `high` (`allocator.py:burn_scale`).
 */
export function burnScale(policy, curves, effort = "high") {
  const mult = curves?.burn_mult || {};
  if (effort in mult) return Number(mult[effort]);
  const ref = effortValue(policy, curves, "burn", "high", 0.7);
  return effortValue(policy, curves, "burn", effort, ref) / (ref || 1.0);
}

export function capabilityVector(info) {
  const raw = info?.capabilities || {};
  const legacyVisual = typeof info?.visual === "number" ? info.visual : 0.0;
  const out = {};
  for (const dim of CAPABILITY_DIMENSIONS) {
    let val = raw[dim];
    if (dim === "visual" && val === undefined) {
      val = legacyVisual;
    }
    out[dim] = clamp(Number(val || 0.0), 0.0, 1.0);
  }
  return out;
}

export function capabilityScore(weights, model, catalog = {}) {
  const { spec } = resolveModelSpec(model, catalog.models, catalog.aliases);
  const caps = capabilityVector(spec);
  let total = 0;
  let sum = 0;
  for (const [dim, w] of Object.entries(weights || {})) {
    if (dim in caps) {
      total += w;
      sum += w * caps[dim];
    }
  }
  return total > 0 ? sum / total : 0.0;
}

/**
 * Collapse models that share a route-fit slot (`allocator.py:route_preference`).
 */
export function routePreference(preferred = [], peers = ROUTE_FIT_PEERS, aliases = MODEL_ALIASES) {
  const collapsed = [];
  for (const rawItem of preferred) {
    const item = canonicalModel(rawItem, aliases);
    const target = peers?.[item] ? canonicalModel(peers[item], aliases) : item;
    if (!collapsed.includes(target)) {
      collapsed.push(target);
    }
  }
  return collapsed;
}

/**
 * Route preference score (`allocator.py:fit_score`).
 */
export function fitScore(kind, model, catalog = {}, options = {}) {
  const routes = catalog.routes || CANONICAL_ROUTES;
  const policy = catalog.policy || DEFAULT_SCORING_POLICY;
  const peers = catalog.routeFitPeers || ROUTE_FIT_PEERS;
  const route = routes[kind] || {};
  const rawCanonical = canonicalModel(model, catalog.aliases);
  const canonical = peers?.[rawCanonical]
    ? canonicalModel(peers[rawCanonical], catalog.aliases)
    : rawCanonical;
  let preferred = routePreference(route.preferred || [], peers, catalog.aliases);
  if (
    preferred[0] === "dot" &&
    (options.local_only || (options.dotAvailable === false && canonical !== "dot"))
  ) {
    preferred = preferred.slice(1);
  }

  if (preferred.length === 0 && !route.capability_fit) {
    return 0.6;
  }
  const place = preferred.indexOf(canonical);
  if (place === -1 && route.capability_fit) {
    return round4(0.2 + 0.5 * capabilityScore(route.capability_fit, rawCanonical, catalog));
  }
  if (route.strict_order) {
    if (place === -1) return 0.3;
    const step = preferred.length <= 5 ? 0.2 : 0.8 / (preferred.length - 1);
    return Math.max(0.2, round4(1 - step * place));
  }
  if (place === 0) return 1.0;
  const band = policy.fallback_fit || { start: 0.6, step: 0.015, floor: 0.4 };
  if (place === -1) return band.floor;
  return Math.max(band.floor, round4(band.start - band.step * (place - 1)));
}

/**
 * The minimum ability a route's work needs at a difficulty (`allocator.py:ability_floor`).
 */
export function abilityFloor(policy = DEFAULT_SCORING_POLICY, route = null, difficulty = "hard") {
  const own = route?.ability_floor || {};
  return difficulty in own ? Number(own[difficulty]) : Number(policy.ability_floor?.[difficulty] ?? 3.0);
}

/**
 * Extra ability critical work needs above the difficulty's floor (`allocator.py:critical_headroom`).
 */
export function criticalHeadroom(policy = DEFAULT_SCORING_POLICY, difficulty = "hard") {
  const own = policy?.critical_headroom_by_difficulty || {};
  return difficulty in own ? Number(own[difficulty]) : Number(policy?.critical_headroom ?? 0.3);
}

/**
 * Continuous task ability demand (`allocator.py:task_demand`).
 */
export function taskDemand(
  profile,
  difficulty,
  critical,
  divergence,
  policy = DEFAULT_SCORING_POLICY,
  highPrecision = false,
  floorOverride = null,
) {
  const cfg = policy.demand || DEFAULT_SCORING_POLICY.demand;
  const floor =
    floorOverride === null || floorOverride === undefined
      ? Number(policy.ability_floor?.[difficulty] ?? 3.3)
      : Number(floorOverride);
  const headroom = critical ? criticalHeadroom(policy, difficulty) : 0.0;
  const precision = highPrecision && !critical ? Number(cfg.precision_headroom ?? 0.15) : 0.0;
  const span = Number(policy.profile?.saturation_span ?? 0.3);

  let depth = 2;
  let load = Number(cfg.default_load ?? 0.5);
  let levels = {};
  let source = "difficulty";

  if (profile) {
    depth = profile.reasoning_depth;
    levels = {
      code_complexity: profile.code_complexity / 3.0,
      context_scale: (profile.context_scale - 1) / 2.0,
      divergence: (divergence - 1) / 2.0,
      hallucination_risk: (profile.hallucination_risk - 1) / 2.0,
      error_cost: Math.min(profile.error_cost, 2) - 1,
    };
    const weights = cfg.property_weights || DEFAULT_SCORING_POLICY.demand.property_weights;
    let totalW = 0;
    let weightedSum = 0;
    for (const [k, v] of Object.entries(levels)) {
      const w = Number(weights[k] || 0);
      totalW += w;
      weightedSum += w * v;
    }
    load = totalW > 0 ? weightedSum / totalW : 0.0;
    source = "profile";
  } else {
    const idx = DIFFICULTY_ORDER.indexOf(difficulty);
    depth = idx >= 0 ? idx + 1 : 2;
  }

  const extra = Number(cfg.property_span ?? 0.5) * (depth / 4.0) * load;
  const required = floor + headroom + precision + extra;
  return {
    required_ability: round4(required),
    floor,
    critical_headroom: headroom,
    precision_headroom: precision,
    property_extra: round4(extra),
    reasoning_depth: depth,
    property_load: round4(load),
    saturation_span: span,
    saturates_at: round4(required + span),
    source,
  };
}

export function effortScaledCapabilities(info, policy, curves, effort) {
  const caps = capabilityVector(info);
  const base = effortAbility(policy, curves, info, "high");
  const ratio = base > 0 ? effortAbility(policy, curves, info, effort) / base : 1.0;
  const out = {};
  for (const [dim, val] of Object.entries(caps)) {
    out[dim] = EFFORT_SCALED_CAPABILITIES.includes(dim) ? clamp(val * ratio, 0.0, 1.0) : val;
  }
  return out;
}

export function profileRequirements(profile, policy = DEFAULT_SCORING_POLICY) {
  const cfg = policy.profile || DEFAULT_SCORING_POLICY.profile;
  const table = cfg.requirements;
  const weights = cfg.requirement_weights || {};
  const depthCoupling = Number(policy.demand?.depth_coupling ?? 0.06);
  const amp = 1.0 + depthCoupling * (profile.reasoning_depth - 2);
  const need = (level) => round4(Math.min(0.98, Number(level) * amp));

  const out = {
    reasoning: [table.reasoning[profile.reasoning_depth], weights.reasoning ?? 1.0],
  };
  if (profile.code_complexity > 0) {
    out.coding = [need(table.coding[profile.code_complexity]), weights.coding ?? 1.0];
  }
  const exploreKey = profile.interaction_style === "exploration" ? "exploration_style" : "exploration";
  out.exploration = [need(table.exploration[profile.context_scale]), weights[exploreKey] ?? 0.5];
  const riskKey = profile.hallucination_risk >= 3 ? "anti_hallucination_high" : "anti_hallucination";
  out.anti_hallucination = [need(table.anti_hallucination[profile.hallucination_risk]), weights[riskKey] ?? 0.5];
  if (profile.needs_visual || profile.needs_gui) {
    out.visual = [table.visual, weights.visual ?? 1.0];
  }
  if (profile.needs_gui) {
    out.gui = [table.gui[profile.reasoning_depth], weights.gui ?? 1.5];
  }
  return out;
}

export function vectorFit(requirements, caps) {
  let totalW = 0;
  let sum = 0;
  for (const [dim, [need, weight]] of Object.entries(requirements)) {
    totalW += weight;
    sum += weight * (need <= 0 ? 1.0 : Math.min(1.0, (caps[dim] ?? 0.0) / need));
  }
  return totalW > 0 ? sum / totalW : 1.0;
}

export function subjectiveVector(info) {
  const raw = info?.subjective || {};
  const out = {};
  for (const dim of SUBJECTIVE_DIMENSIONS) {
    out[dim] = clamp(Number(raw[dim] ?? 0.5), 0.0, 1.0);
  }
  return out;
}

export function convergentWeights(depth, code, scale, style) {
  let g;
  if (code === 3 || scale === 3 || (depth >= 3 && scale >= 2)) {
    g = 0.85;
  } else if (depth >= 3 || code === 0) {
    g = scale >= 2 ? 0.75 : 0.65;
  } else if (code >= 1 && style !== "exploration") {
    g = scale >= 2 ? 0.25 : 0.0;
  } else {
    g = scale >= 2 ? 0.65 : 0.5;
  }
  const out = {};
  const mp = Math.round((1 - g) * 100) / 100;
  if (mp > 0) out.module_precision = mp;
  if (g > 0) out.global_rigor = g;
  return out;
}

export function subjectiveWeights(profile, kind = null) {
  if (!profile || typeof profile !== "object") return {};
  const depth = profile.reasoning_depth;
  const code = profile.code_complexity;
  const scale = profile.context_scale;
  const style = profile.interaction_style;
  const isGui = kind === "computer_use" || Boolean(profile.needs_gui);
  const div = isGui ? Math.min(profile.divergence || 1, 2) : profile.divergence || 1;

  if (depth === 1 && div === 1 && scale <= 2 && code <= 2) {
    return {};
  }
  if (div >= 3 || kind === "direction_reasoning") {
    const g = scale >= 2 ? 0.15 : 0.05;
    return { divergence: Math.round((1 - g) * 100) / 100, global_rigor: g };
  }
  if (kind === "frontend_implementation") {
    return { global_rigor: 0.65, divergence: 0.35 };
  }
  let base = convergentWeights(depth, isGui ? 0 : code, scale, style);
  if (div === 2 || kind === "complex_build_plan") {
    const g = Math.max(0.75, base.global_rigor || 0.0);
    base = {};
    const mp = Math.round((1 - g) * 100) / 100;
    if (mp > 0) base.module_precision = mp;
    if (g > 0) base.global_rigor = g;
    const share = SUBJECTIVE_DIVERGENCE_SHARE;
    const out = { divergence: share };
    for (const [k, v] of Object.entries(base)) {
      out[k] = round3(v * (1 - share));
    }
    return out;
  }
  return base;
}

export function subjectiveFit(weights, subj) {
  let totalW = 0;
  let sum = 0;
  for (const [dim, w] of Object.entries(weights || {})) {
    totalW += w;
    sum += w * (subj[dim] ?? 0.5);
  }
  return totalW > 0 ? sum / totalW : 1.0;
}

/**
 * Evaluate one `(model, effort)` candidate against a profiled task (`allocator.py:evaluate_bundle`).
 */
export function evaluateCandidate(candidate, taskCtx, catalog = {}) {
  const models = catalog.models || DEFAULT_MODELS;
  const aliases = catalog.aliases || MODEL_ALIASES;
  const policy = catalog.policy || DEFAULT_SCORING_POLICY;
  const curvesTable = catalog.effortCurves || EFFORT_CURVES;

  const rawModel = candidate.model;
  const { canonical, spec: info } = resolveModelSpec(rawModel, models, aliases);
  const effort = candidate.effort || "high";
  const curves = curvesTable[canonical] || {};
  const excluded = [];

  if (taskCtx.needs_visual && !info.visual) {
    excluded.push("task needs visual input");
  }
  if (taskCtx.unhealthy_models && taskCtx.unhealthy_models.has(canonical)) {
    excluded.push("model is currently marked unhealthy");
  }
  if (
    taskCtx.min_context_tokens &&
    Number(info.context_window || 128000) * 0.95 < taskCtx.min_context_tokens
  ) {
    excluded.push(
      `context window ${info.context_window || 128000} outgrown by ${taskCtx.min_context_tokens} tokens`
    );
  }
  const routes = catalog.routes || CANONICAL_ROUTES;
  const route = routes[taskCtx.kind] || {};
  const ability = effortAbility(policy, curves, info, effort);
  const highAbility = effortAbility(policy, curves, info, "high");
  const demand = taskCtx.demand;
  const target = demand.required_ability;
  const floor = demand.floor ?? abilityFloor(policy, route, taskCtx.difficulty);
  const headroom = taskCtx.critical ? criticalHeadroom(policy, taskCtx.difficulty) : 0.0;
  const gate = floor + headroom;

  if (
    route.restrict_models &&
    taskCtx.specialist_available &&
    !(route.preferred || []).map((m) => canonicalModel(m, aliases)).includes(canonical)
  ) {
    excluded.push(`not in the allowed model list for ${taskCtx.kind}`);
  }

  if (ability < gate) {
    excluded.push(`ability ${ability.toFixed(2)} below the ${taskCtx.difficulty} floor ${gate.toFixed(2)}`);
  }

  // Subscription quota, safety margin, opportunity cost & pre-reset sprint evaluation
  const quotaEval = taskCtx.quotas
    ? evaluateModelQuota(
        rawModel,
        effort,
        taskCtx,
        taskCtx.quotas,
        catalog,
        taskCtx.now
      )
    : null;
  if (quotaEval && !quotaEval.eligible) {
    excluded.push(...(quotaEval.excluded || [`${rawModel}: subscription quota exhausted`]));
  }

  let fit = fitScore(taskCtx.kind, canonical, catalog, {
    local_only: taskCtx.local_only,
    dotAvailable: taskCtx.dot_available,
  });
  const visual = info.visual;
  if (
    taskCtx.needs_visual &&
    taskCtx.kind !== "visual_analysis" &&
    !route.capability_fit &&
    typeof visual === "number"
  ) {
    fit = (fit + visual) / 2.0;
  }

  let vfit = 1.0;
  let sfit = 1.0;
  const routeFitRaw = fit;

  if (taskCtx.profile && (!route.strict_order || route.capability_fit)) {
    vfit = vectorFit(taskCtx.requirements, effortScaledCapabilities(info, policy, curves, effort));
    const sWeights = taskCtx.subjective_weights || {};
    const sCfg = policy.profile?.subjective;
    if (Object.keys(sWeights).length > 0 && sCfg && info.subjective) {
      const subjScale = highAbility > 0 ? Math.min(1.0, ability / highAbility) : 1.0;
      const scaledSubj = {};
      for (const [k, v] of Object.entries(subjectiveVector(info))) {
        scaledSubj[k] = v * subjScale;
      }
      sfit = subjectiveFit(sWeights, scaledSubj);
      const wS = Number(sCfg.weight ?? 0.45);
      const wV = Number(sCfg.vector_weight ?? 0.35);
      const wR = Number(sCfg.route_weight ?? Math.max(0.0, 1.0 - wS - wV));
      fit = wR * fit + wV * vfit + wS * sfit;
    } else {
      const wV = Number(policy.profile?.vector_weight ?? 0.5);
      fit = (1 - wV) * fit + wV * vfit;
    }
  }

  const sunkWeight = Number(quotaEval?.reset_sunk_weight ?? 0.0);
  const sprintSunk = taskCtx.difficulty === "routine" ? 0.0 : sunkWeight;
  const effortScale = burnScale(policy, curves, effort);
  const effortPenalty = round4(
    (policy.extra_effort_penalty ?? 0.025) *
      Math.max(0.0, effortScale - 1.0) *
      (1.0 - sprintSunk)
  );
  const effortGain = Math.max(0.0, ability - highAbility);
  const saturationSpan = Number(policy.profile?.saturation_span ?? 0.3);
  const sprintQuality =
    sprintSunk > 0 && effortGain > 0
      ? round4(
          Number(policy.demand?.sprint_effort_weight ?? 0.06) *
            sprintSunk *
            clamp(effortGain / saturationSpan, 0, 1)
        )
      : 0.0;
  const credited = Math.min(ability, Math.max(highAbility, target));
  const shortfall = Math.max(0.0, target - ability);
  const shortfallPenalty = round4((policy.demand?.shortfall_weight ?? 0.35) * shortfall);

  let span = Number(policy.ability_span ?? 0.6);
  if (
    ["frontend_implementation", "complex_build_plan", "direction_reasoning"].includes(taskCtx.kind) &&
    !taskCtx.high_precision
  ) {
    span = Number(policy.profile?.saturation_span ?? 0.3);
  }

  const origin = Math.max(floor, Number(policy.ability_score_origin?.[taskCtx.difficulty] ?? floor));
  let abilityScore = clamp((credited - origin - (taskCtx.high_precision ? gate - floor : 0.0)) / span, 0, 1);
  const qualityBonus = taskCtx.high_precision
    ? round4(Number(policy.high_precision_effort_weight ?? 0.14) * effortGain)
    : 0.0;

  let overqualification = 0.0;
  if (taskCtx.minimum_sufficient) {
    const pCfg = policy.profile || DEFAULT_SCORING_POLICY.profile;
    const satSpan = Number(pCfg.saturation_span ?? 0.3);
    abilityScore = ability >= gate ? 1.0 : 0.0;
    const excess = clamp((ability - target - satSpan) / Number(pCfg.overqualification_span ?? 0.6), 0, 1);
    const usd = Number(info.usd_per_hour ?? 3.0) * Math.max(effortScale, 0.0);
    let price = usd / Number(pCfg.overqualification_ref_usd_per_hour ?? 10.0);
    const gui = taskCtx.kind === "computer_use" || Boolean(taskCtx.profile?.needs_gui);
    const guiCapable = (capabilityVector(info).gui ?? 0) >= 0.7;
    price = gui && guiCapable ? Math.min(1.0, price) : Math.min(Number(pCfg.overqualification_price_cap ?? 3.0), price);
    if (((gui && guiCapable) || taskCtx.kind === "frontend_implementation") && (taskCtx.profile?.reasoning_depth ?? 1) >= 2) {
      price = 0.0;
    }
    overqualification = round4(
      Number(pCfg.overqualification_weight ?? 0.08) * excess * price * (1.0 - sprintSunk)
    );
  }

  if (taskCtx.difficulty !== "routine" && ability < highAbility) {
    abilityScore = clamp(
      abilityScore - (0.2 * (highAbility - ability)) / Number(policy.ability_span ?? 0.6),
      0,
      1,
    );
  }

  const weights = policy.weights || { fit: 0.3, ability: 0.1, continuity: 0.25 };
  let continuityBonus = 0.0;
  const cont = taskCtx.continuity;
  if (cont && cont.previousModel) {
    const prevCanonical = canonicalModel(cont.previousModel, aliases);
    if (canonical === prevCanonical && cont.active !== false) {
      let coupling = 0.0;
      if (Number.isFinite(cont.coupling)) {
        coupling = clamp(Number(cont.coupling), 0.0, 1.0);
      } else if (cont.cacheWarm === true) {
        coupling = 1.0;
      } else if (cont.why === "cold" || cont.why === "compacted") {
        coupling = taskCtx.difficulty === "coupled" || taskCtx.difficulty === "frontier" ? 0.35 : 0.0;
      } else if (
        taskCtx.difficulty === "coupled" ||
        taskCtx.difficulty === "frontier" ||
        (taskCtx.profile?.context_scale ?? 1) >= 2
      ) {
        coupling = 0.65;
      }
      if (cont.cacheWarm && cont.previousEffort) {
        const prevIdx = EFFORT_ORDER.indexOf(cont.previousEffort);
        const curIdx = EFFORT_ORDER.indexOf(effort);
        if (prevIdx >= 0 && curIdx >= 0 && curIdx < prevIdx) {
          coupling *= 0.25;
        }
      }
      continuityBonus = round4(Number(weights.continuity ?? 0.25) * coupling);
    }
  }

  const resetBonus = Number(quotaEval?.reset_bonus ?? 0.0);
  const opportunityCost = Number(quotaEval?.opportunity_cost ?? 0.0);
  const freeUsage = Number(quotaEval?.free_usage ?? 0.0);
  const fastBonus = Number(quotaEval?.fast_bonus ?? 0.0);

  const totalScore = round4(
    weights.fit * fit +
      weights.ability * abilityScore +
      continuityBonus +
      qualityBonus +
      freeUsage +
      resetBonus +
      sprintQuality +
      fastBonus -
      opportunityCost -
      effortPenalty -
      overqualification -
      shortfallPenalty,
  );

  return {
    id: `${rawModel}:${effort}`,
    model: rawModel,
    canonicalModel: canonical,
    effort,
    fast: Boolean(quotaEval?.fast),
    excluded,
    eligible: excluded.length === 0,
    score: excluded.length === 0 ? totalScore : null,
    quota: quotaEval
      ? {
          account: quotaEval.account,
          provider: quotaEval.provider,
          kind: quotaEval.kind,
          opportunity_cost: opportunityCost,
          reset_bonus: resetBonus,
          reset_sunk_weight: sunkWeight,
          free_usage: freeUsage,
          fast_bonus: fastBonus,
          fast: Boolean(quotaEval.fast),
          shortage_probability: quotaEval.shortage_probability ?? 0.0,
          binding_window: quotaEval.binding_window || null,
        }
      : null,
    components: {
      fit: round3(fit),
      route_fit: round3(routeFitRaw),
      vector_fit: round3(vfit),
      subjective_fit: round3(sfit),
      ability: round3(abilityScore),
      ability_value: round3(ability),
      required_ability: round3(target),
      continuity: continuityBonus,
      quality_bonus: qualityBonus,
      free_usage: freeUsage,
      reset_bonus: resetBonus,
      sprint_quality: sprintQuality,
      fast_bonus: fastBonus,
      opportunity_cost: opportunityCost,
      effort_penalty: effortPenalty,
      overqualification,
      shortfall: shortfallPenalty,
    },
  };
}

/**
 * Expand candidate models into `(model, effort)` bundles and rank them for the given task profile.
 */
export function rankCandidates(profileInput, options = {}) {
  const catalog = options.catalog || {};
  const policy = catalog.policy || DEFAULT_SCORING_POLICY;
  const routes = catalog.routes || CANONICAL_ROUTES;
  const models = catalog.models || DEFAULT_MODELS;
  const aliases = catalog.aliases || MODEL_ALIASES;
  const nowMs = Number.isFinite(options.now) ? Number(options.now) : Date.now();

  const profile = profileInput?.reasoning_depth
    ? validateProfile(profileInput)
    : inferTaskProfile(profileInput || {}, routes);

  const kind = profileKind(profile, policy);
  const difficulty = profileDifficulty(profile, policy);
  const critical = Boolean(options.critical ?? profile.error_cost >= 3);
  const div = profile.divergence || 1;
  const depth = profile.reasoning_depth;
  const mechanicalRunbook = Boolean(depth === 1 && profile.code_complexity === 0 && div === 1);
  const unlockDiffs = policy.effort_unlock_difficulties || ["coupled", "frontier"];
  const unlocked = Boolean(
    unlockDiffs.includes(difficulty) ||
      (critical && !mechanicalRunbook) ||
      depth >= 3 ||
      (depth >= 2 && profile.hallucination_risk >= 3 && (div >= 2 || profile.code_complexity >= 2))
  );
  const highPrecision = Boolean(
    unlocked &&
      (difficulty === "frontier" ||
        (critical && !mechanicalRunbook) ||
        (profile.hallucination_risk >= 3 &&
          (((div >= 2 || profile.code_complexity >= 2) &&
            !["complex_build_plan", "direction_reasoning"].includes(kind) &&
            profile.interaction_style !== "advisory") ||
            (depth >= 3 && profile.code_complexity >= 3))))
  );
  const minimumSufficient = Boolean(
    depth <= 2 &&
      profile.code_complexity < 3 &&
      div === 1 &&
      (profile.error_cost <= 2 || mechanicalRunbook) &&
      (!critical || mechanicalRunbook)
  );

  const routeObj = routes[kind] || {};
  const floor = abilityFloor(policy, routeObj, difficulty);
  const demand = taskDemand(profile, difficulty, critical, div, policy, highPrecision, floor);
  const requirements = profileRequirements(profile, policy);
  const sWeights = subjectiveWeights(profile, kind);

  const unhealthySet = new Set(
    (options.unhealthyModels || []).map((m) => canonicalModel(m, aliases)).filter(Boolean)
  );
  const continuity =
    options.continuity ||
    (options.previousModel
      ? {
          previousModel: options.previousModel,
          previousEffort: options.previousEffort,
          cacheWarm: Boolean(options.cacheWarm),
          why: options.why || "",
          coupling: options.coupling,
        }
      : null);

  const normalizedQuotas = options.quotas
    ? Array.isArray(options.quotas._normalized)
      ? options.quotas
      : { _normalized: normalizeQuotaSnapshot(options.quotas, nowMs, policy) }
    : null;

  // Build candidate list from user-configured pool or default catalog
  const candidateModels =
    Array.isArray(options.candidateModels) && options.candidateModels.length > 0
      ? options.candidateModels
      : Object.keys(models).filter((m) => m !== "deepseek-v4.1-flash-free" && !models[m]?.disabled_by_default);

  const candidateCanonicals = new Set();
  for (const entry of candidateModels) {
    const rawM = typeof entry === "string" ? entry.split(":")[0] : entry?.model;
    if (rawM) candidateCanonicals.add(canonicalModel(rawM, aliases));
  }
  const dotAvailable = candidateCanonicals.has("dot");
  const specialistAvailable = Boolean(
    routeObj.restrict_models &&
      (routeObj.preferred || []).some((m) => candidateCanonicals.has(canonicalModel(m, aliases)))
  );

  const taskCtx = {
    profile,
    kind,
    difficulty,
    critical,
    unlocked,
    high_precision: highPrecision,
    minimum_sufficient: minimumSufficient,
    needs_visual: profile.needs_visual,
    local_only: Boolean(options.local_only ?? profile.local_only),
    dot_available: dotAvailable,
    specialist_available: specialistAvailable,
    demand,
    requirements,
    subjective_weights: sWeights,
    unhealthy_models: unhealthySet,
    min_context_tokens: Number(options.minContextTokens || 0),
    continuity,
    quotas: normalizedQuotas,
    hours: options.hours,
    metered_ok: options.meteredOk,
    fast_requested: Boolean(options.fast),
    urgency: options.urgency || profile.urgency || "unknown",
    now: nowMs,
  };

  const expanded = [];
  for (const entry of candidateModels) {
    if (typeof entry === "string") {
      const colonIdx = entry.lastIndexOf(":");
      if (colonIdx > 0) {
        const suffix = entry.slice(colonIdx + 1).toLowerCase();
        if (EFFORT_ORDER.includes(suffix)) {
          expanded.push({ model: entry.slice(0, colonIdx), effort: suffix });
          continue;
        }
      }
      const { spec } = resolveModelSpec(entry, models, aliases);
      const efforts = Array.isArray(spec.efforts) && spec.efforts.length > 0 ? spec.efforts : ["medium", "high"];
      for (const eff of efforts) {
        expanded.push({ model: entry, effort: eff });
      }
    } else if (entry && typeof entry === "object" && entry.model) {
      const efforts = Array.isArray(entry.efforts)
        ? entry.efforts
        : entry.effort
          ? [entry.effort]
          : ["medium", "high"];
      for (const eff of efforts) {
        expanded.push({ model: entry.model, effort: eff });
      }
    }
  }

  const evaluated = expanded.map((c) => evaluateCandidate(c, taskCtx, catalog));
  const eligible = evaluated.filter((c) => c.eligible);
  eligible.sort((a, b) => b.score - a.score);

  return {
    task: {
      kind,
      difficulty,
      critical,
      high_precision: highPrecision,
      minimum_sufficient: minimumSufficient,
      required_ability: demand.required_ability,
      subjective_weights: sWeights,
      profile,
    },
    selected: eligible[0] || null,
    ranking: eligible,
    allCandidates: evaluated,
  };
}

/**
 * Convenience entry point: takes a raw request or task object + options and returns the winning route decision.
 */
export function selectBestRoute(taskOrProfile, options = {}) {
  const result = rankCandidates(taskOrProfile, options);
  const top = result.selected;
  return {
    ok: Boolean(top),
    targetModel: top ? top.model : null,
    canonicalModel: top ? top.canonicalModel : null,
    targetEffort: top ? top.effort : "high",
    modelWithEffort: top ? `${top.model}:${top.effort}` : null,
    selectedAccount: top?.quota?.account || null,
    quota: top?.quota || null,
    workKind: result.task.kind,
    difficulty: result.task.difficulty,
    requiredAbility: result.task.required_ability,
    score: top ? top.score : null,
    components: top ? top.components : null,
    profile: result.task.profile,
    topCandidates: result.ranking.slice(0, 5).map((r) => ({
      id: r.id,
      model: r.model,
      effort: r.effort,
      score: r.score,
      quota: r.quota || null,
      components: r.components,
    })),
  };
}
