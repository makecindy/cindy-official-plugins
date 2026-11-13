// Vendored from akiiwa-games/magpie-agentcompass-router src/quota-pools.js at 35a7aea5b6bc4028bb78c460482b6d3ad8708948 (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Quota windows and pools (`quota_pools.py`, `window_scope.py`): which windows a bundle draws, their state, and the refusals
 * they raise. Times are epoch milliseconds. Not carried: in-flight dispatch reservations, cadence windows and confirmed
 * exhaustion latches (they read the worker launcher's own records, which the gateway does not have).
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

import { canonicalModel } from "./catalog.mjs";
import { capacityUsd } from "./quota-economy.mjs";

const INF = Number.POSITIVE_INFINITY;
const HOUR_MS = 3600000;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** An ISO time with a zone as epoch milliseconds; null for anything else (a naive time is not a time here). */
export function parseTime(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !hasZone.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// ---------------------------------------------------------------------------- window scope

const tokenForm = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const tagsOf = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string").map(tokenForm).filter(Boolean) : []);

/** True when `tag` occurs in `model` as whole tokens; case and separators do not matter. */
export function tagMatches(tag, model) {
  const t = tokenForm(tag);
  const m = tokenForm(model);
  return Boolean(t && m) && `-${m}-`.includes(`-${t}-`);
}

const declaresScope = (source) => Boolean(source) && typeof source === "object" && (tagsOf(source.models).length > 0 || tagsOf(source.models_except).length > 0);

/** Does work on a model known by several names draw a window scoped by `sources` (specs and/or readings)? */
export function bindsAny(names, ...sources) {
  const named = names.filter((n) => tokenForm(n));
  if (named.length === 0) return true;
  const declared = sources.filter(declaresScope);
  if (declared.length === 0) return true;
  const sourceBinds = (source) => {
    const include = tagsOf(source.models);
    const exclude = tagsOf(source.models_except);
    if (include.length > 0 && !include.some((tag) => named.some((name) => tagMatches(tag, name)))) return false;
    return !exclude.some((tag) => named.some((name) => tagMatches(tag, name)));
  };
  return declared.some(sourceBinds);
}

// ---------------------------------------------------------------------------- applicable windows and observations

/** `[window id, spec, observed window]` for the windows of an account that bind this model. */
export function applicableWindows(accountSpec, model, usageRow, bundle, rawModel) {
  const observed = {};
  for (const w of (usageRow && usageRow.windows) || []) if (w && w.id && !(w.id in observed)) observed[w.id] = w;
  const configured = (accountSpec && accountSpec.windows) || {};
  const windows = { ...configured };
  for (const wid of Object.keys(observed)) if (!(wid in windows)) windows[wid] = {};
  const names = [canonicalModel(rawModel || model || ""), rawModel || model || ""];
  return Object.entries(windows)
    .filter(([wid, wspec]) => bindsAny(names, wspec, observed[wid]))
    .map(([wid, wspec]) => [wid, wspec, observed[wid] || null]);
}

/** Existing launch protection: a rate-limited window with an active reset, a used-up window, or a window at its own floor. */
export function belowLaunchFloor(window, observed, usageRow, now) {
  const floor = window.launch_min_remaining_pct;
  const reset = parseTime((observed || {}).resets_at);
  const seconds = (observed || {}).seconds_until_reset;
  const activeReset = (reset !== null && reset > now) || (reset === null && isNum(seconds) && seconds > 0 && (observed || {}).reset_time_passed !== true);
  if (floor !== undefined && floor !== null && (observed || {}).rate_limited === true && activeReset) return true;
  const fetched = parseTime(usageRow.fetched_at);
  if (
    usageRow.status !== "fresh" ||
    usageRow.stale === true ||
    usageRow.available === false ||
    ("fetched_at" in usageRow && (fetched === null || !(-60 <= (now - fetched) / 1000 && (now - fetched) / 1000 <= 900)))
  ) {
    return false;
  }
  const remaining = (observed || {}).remaining_pct_before_reset;
  if (isNum(remaining) && remaining <= 0 && (reset === null || activeReset)) return true;
  return Boolean(floor !== undefined && floor !== null && activeReset && isNum(remaining) && remaining <= floor);
}

/**
 * The window's reading, or null when a reading that is not current cannot describe the current cycle. Usage only grows
 * inside a cycle, so an old reading still bounds what is left until its reset; no reading describes the cycle after its own
 * reset. A reading that is not current also cannot when the reading has no time, is from the future, or was taken more than the
 * window's `hours` before its reset (an earlier cycle). `readFailedOk`: an account whose latest read failed keeps the last
 * successful reading of this cycle, labelled by the caller with its read time.
 */
export function cycleObservation(window, observed, usageRow, now, readFailedOk = false) {
  if (observed === null || observed === undefined || observed.rate_limited === true) return observed || null;
  if (observed.reset_time_passed === true) return null;
  if (usageRow.status === null || usageRow.status === undefined || usageRow.status === "fresh") return observed;
  const fetched = parseTime(usageRow.fetched_at);
  if ((usageRow.available === false && !readFailedOk) || fetched === null || (fetched - now) / 1000 > 60) return null;
  const reset = parseTime(observed.resets_at);
  const hours = window.hours;
  if (reset !== null && isNum(hours) && fetched < reset - hours * HOUR_MS) return null;
  return observed;
}

/** Why a drawn window refuses any launch now, whatever the task's size; null when it does not. */
export function windowRefusal(wid, window, observed, usageRow, now, latched = new Set()) {
  if (latched.has(wid)) return `${wid}: quota confirmed exhausted; refresh quota or replan`;
  if (belowLaunchFloor(window, observed, usageRow, now)) return `${wid}: confirmed exhausted or below launch floor; refresh quota or replan`;
  return null;
}

/** `[small, floor %, safety margin %]` of a short window; a small window keeps the larger reserve. */
export function shortWindowLimits(spec, wid, policy, now) {
  const cap = capacityUsd(spec, wid);
  const small = cap !== null && cap < (policy.small_short_capacity_usd ?? 50);
  return [
    small,
    small ? (policy.small_short_window_floor_pct ?? 25) : (policy.short_window_floor_pct ?? 10),
    small ? (policy.small_short_safety_margin_pct ?? 12) : (policy.safety_margin_pct ?? 5),
  ];
}

/** How many accounts a window reading pools (a Magpie pool reports `accounts: N`); 1 for a single account. */
export function poolSize(observed) {
  const count = (observed || {}).accounts;
  return Number.isInteger(count) && count > 1 ? count : 1;
}

/** A dollar account with no budget has no window and is not excluded for exhaustion; it stays a metered last resort. */
export function meteredUsdUncapped(spec) {
  if (!spec || typeof spec !== "object" || spec.backend_kind !== "metered_usd") return false;
  const cap = spec.capacity_usd;
  const balance = cap && typeof cap === "object" ? cap.balance : null;
  return !isNum(balance) || balance <= 0;
}

/** True for a 5-hour-class window (a reset period shorter than `short_window_hours`): it gates a start, never prices. */
export function windowIsShort(wspec, policy) {
  const hours = (wspec || {}).hours;
  return hours !== null && hours !== undefined && hours !== INF && hours < policy.short_window_hours;
}

/** Remaining capacity, time to the end of the allowance and how sure we are. */
export function windowState(wid, spec, observed, accountSpec, now, shortHours, accountStale = false, expectedResetAt = null) {
  const hours = spec.hours;
  const starter = hours === null || hours === undefined || hours === INF;
  const expires = parseTime(accountSpec.expires_at);
  const row = {
    id: wid,
    hours: hours === undefined ? null : hours,
    short: hours !== null && hours !== undefined && hours !== INF && hours < shortHours,
    known: false,
    stale: Boolean(accountStale),
  };
  if (starter) {
    const cap = capacityUsd(accountSpec, wid);
    if (cap === null || cap <= 0) return row;
    const full = 100.0 * poolSize(observed);
    row.full = full;
    let remaining = (observed || {}).remaining_pct_before_reset;
    if (remaining === null || remaining === undefined) remaining = (observed || {}).observed_remaining_pct;
    if (remaining === null || remaining === undefined) {
      let usedUsd = (observed || {}).used_usd;
      if (usedUsd === null || usedUsd === undefined) usedUsd = accountSpec.local_spend_usd ?? 0.0;
      remaining = Math.max(0.0, full - (100.0 * Number(usedUsd || 0.0)) / cap);
    }
    const expiryHours = expires !== null && expires > now ? (expires - now) / HOUR_MS : null;
    Object.assign(row, {
      known: true,
      remaining,
      reset_hours: INF,
      end_hours: expiryHours !== null ? expiryHours : INF,
      expiry_hours: expiryHours,
      target_remaining: 0.0,
      reset_at: null,
    });
    return row;
  }
  if (observed === null || observed === undefined || hours === null || hours === undefined) return row;
  // Percentages are of one account's allowance; a pool of N accounts holds N x 100 when full.
  const full = (row.full = 100.0 * poolSize(observed));
  let remaining = observed.remaining_pct_before_reset;
  if (remaining === null || remaining === undefined) {
    remaining = observed.observed_remaining_pct;
    row.stale = row.stale || (remaining !== null && remaining !== undefined);
  }
  let seconds = observed.seconds_until_reset;
  const naturalReset = parseTime(observed.resets_at);
  if ((seconds === null || seconds === undefined) && naturalReset !== null) seconds = (naturalReset - now) / 1000;
  if (row.short && remaining === 100 && (seconds === null || seconds === undefined) && (observed.resets_at === null || observed.resets_at === undefined)) {
    // An unstarted rolling short window (used_pct == 0, resets_at == null) has full 5h capacity ready.
    seconds = hours * 3600;
    row.stale = Boolean(accountStale);
    row.unstarted = true;
  } else if ((row.short || accountSpec.family === "antigravity" || spec.starts_on_first_use) && remaining === 100) {
    row.unstarted = true;
  }
  const expectedHours = expectedResetAt !== null && expectedResetAt > now ? (expectedResetAt - now) / HOUR_MS : null;
  if (expectedHours !== null) {
    row.natural_reset_hours = seconds !== null && seconds !== undefined ? seconds / 3600 : hours;
    row.expected_reset_at = new Date(expectedResetAt).toISOString();
    seconds = seconds !== null && seconds !== undefined ? Math.min(seconds, expectedHours * 3600) : expectedHours * 3600;
  }
  if (remaining === null || remaining === undefined || seconds === null || seconds === undefined) return row;
  let endHours = seconds / 3600;
  const expiryHours = expires !== null && expires > now ? (expires - now) / HOUR_MS : null;
  if (expiryHours !== null) endHours = Math.min(endHours, expiryHours);
  Object.assign(row, {
    known: true,
    remaining,
    reset_hours: seconds / 3600,
    end_hours: endHours,
    expiry_hours: expiryHours,
    target_remaining: full * Math.min(1.0, endHours / hours),
    reset_at: observed.resets_at === undefined ? null : observed.resets_at,
  });
  return row;
}

/** The same allowance once it renews, assuming a full renewal. null when the plan ends first. */
export function afterReset(state, hours) {
  const wait = state.reset_hours;
  if (state.expected_reset_at && wait < (state.natural_reset_hours ?? wait)) return null; // a prediction never authorizes an imagined refill
  if (wait <= 0 || state.stale) return null;
  const expiry = state.expiry_hours;
  const left = expiry === null || expiry === undefined ? null : expiry - wait;
  if (left !== null && left <= 0) return null;
  const end = left === null ? state.hours : Math.min(state.hours, left);
  const full = state.full ?? 100.0;
  return {
    ...state,
    remaining: full,
    reset_hours: wait + state.hours,
    end_hours: end,
    target_remaining: full * Math.min(1.0, end / state.hours),
    deferred_hours: wait,
    expiry_hours: left,
  };
}
