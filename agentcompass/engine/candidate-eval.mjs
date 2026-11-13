// Vendored from akiiwa-games/magpie-agentcompass-router src/candidate-eval.js at 35a7aea5b6bc4028bb78c460482b6d3ad8708948 (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Candidate evaluation (`candidate_eval.py`): one bundle against one task, its gates, exclusions (rule B) and breakdown.
 *
 * A bundle is a model at an effort on one quota account. The exclusions are the allocator's: a demanded category with no data,
 * no cited usd on a billed account, unknown image input or no duration at the effort leaves automatic routing unless the model
 * is named; a window of unknown capacity is excluded; a long reset-period window is required to price the spend (QUOTA_NO_LONG_WINDOW,
 * QUOTA_LONG_UNREAD, QUOTA_READING_UNAVAILABLE). Not carried: the worker launcher's host policy, cwd restriction, launch-failure,
 * model-latch, provider-retry and live-model holds, user overrides, in-flight reservations, cadence windows and fast-mode
 * variants (the gateway has none of those records).
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

import { DIRECT_SOURCES, healthKey, modelLeaf, nameFixesEffort, resolveModel, rowKey, canonicalModel, splitEffortSuffix, pyRound } from "./catalog.mjs";
import {
  FIVE_AXES,
  IMAGE_INPUT_LEVEL,
  TOOL_LEVEL_FACETS,
  atEffort,
  fiveAxisFit,
  fiveAxisHeadroom,
  fiveAxisLevel,
  fiveAxisShares,
  fiveAxisValues,
} from "./axis-scores.mjs";
import { CATEGORY_FACETS } from "./user-scores.mjs";
import {
  bundleTaskUsd,
  capacityUsd,
  durationAt,
  modelUsdPerHour,
  scoringEffort,
  unitRate,
} from "./quota-economy.mjs";
import {
  afterReset,
  applicableWindows,
  clamp,
  cycleObservation,
  meteredUsdUncapped,
  parseTime,
  shortWindowLimits,
  windowIsShort,
  windowRefusal,
  windowState,
} from "./quota-pools.mjs";

export const METERED_LAST_RESORT = "metered access is a last resort";
export const QUOTA_READING_UNAVAILABLE = "quota reading unavailable (no current observation of any window of this account, so its spend cannot be priced)";
export const QUOTA_LONG_UNREAD =
  "weekly quota reading unavailable (the account has a long reset-period window but no current or last-good observation of it, only its 5-hour window is read, so its spend cannot be priced)";
export const QUOTA_NO_LONG_WINDOW =
  "no weekly quota window (neither the account configuration nor the public capacity data gives this account a long reset-period window, so its spend cannot be priced)";
export const QUOTA_DATA_ERRORS = [QUOTA_READING_UNAVAILABLE, QUOTA_LONG_UNREAD, QUOTA_NO_LONG_WINDOW];
export const MARKED_UNHEALTHY = "model is currently marked unhealthy";
export const EXPLICIT_MODEL_CONSTRAINT = "explicit model constraint";
export const EXPLICIT_EFFORT_CONSTRAINT = "explicit effort constraint";
export const EXPLICIT_BUNDLE_CONSTRAINT = "explicit bundle constraint";
export const MARKED_BY_PARENT = "marked unavailable by the parent";
const INF = Number.POSITIVE_INFINITY;
const HOUR_MS = 3600000;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const sumOf = (rows, fn) => rows.reduce((total, row) => total + fn(row), 0);

// ---------------------------------------------------------------------------- the fleet's name resolution

export const rowKeyOf = (model, fleet) => rowKey(model, fleet.models, fleet.aliases, fleet.families);
export const canonicalOf = (model, fleet) => canonicalModel(model, fleet.aliases, fleet.models, fleet.families);
export const modelInfo = (fleet, model) => {
  const resolved = resolveModel(String(model || ""), fleet.models, fleet.aliases, fleet.families);
  const value = DIRECT_SOURCES.includes(resolved.source) ? fleet.models[resolved.key] : null;
  return value && typeof value === "object" ? value : {};
};

/** Does the task's named model (or bundle id) name this bundle? Compares the resolved key and the raw spelling. */
export function modelPinMatches(task, bundle, model) {
  const named = task.constraint_model;
  if (!named) return false;
  const raw = String((bundle || {}).model || "");
  return [(bundle || {}).id, model, raw].includes(named) || modelLeaf(named).toLowerCase() === modelLeaf(raw).toLowerCase();
}

/** The user named this bundle, or its model and effort: it keeps that effort. */
export function exactPin(task, bundle, model) {
  const bid = (bundle || {}).id;
  if (bid && [task.pinned_bundle, task.constraint_bundle, task.constraint_model].includes(bid)) return true;
  return Boolean(task.constraint_effort) && modelPinMatches(task, bundle, model);
}

export const bundleNamed = (task, bundle, model) => exactPin(task, bundle, model) || modelPinMatches(task, bundle, model);

/** `model:effort` and `model-effort` launch ids run at that level only. */
export function hasFixedEffort(bundle, fleet) {
  if ((bundle || {}).effort_fixed) return true;
  const launchId = String((bundle || {}).launch_model || (bundle || {}).model || "");
  return splitEffortSuffix(launchId).effort !== null && splitEffortSuffix(launchId).effort !== undefined || nameFixesEffort(launchId, fleet.models, fleet.aliases);
}

// ---------------------------------------------------------------------------- the effort rows a model offers

/**
 * The launch table of a provider (`dispatch_efforts`), or null for a provider the table does not describe (a gateway), as
 * `account_fleet.dispatch_table` reads it: the provider's own name, then a numbered account's main family (`claude-2` -> `claude`).
 * `antigravity` has no row of its own: only the launch provider `antigravity-resilient` does.
 */
export function dispatchTable(provider, fleet) {
  const name = String(provider || "").trim();
  const tables = fleet.dispatch_efforts || {};
  for (const candidate of [name, name.replace(/[-_][0-9]+$/, "")]) {
    if (candidate && tables[candidate] && typeof tables[candidate] === "object") return tables[candidate];
  }
  return null;
}

/** Names a table may hold this model under: its resolved key, then its raw spellings. */
export function lookupNames(model, fleet) {
  const raw = splitEffortSuffix(String(model || "")).name;
  const names = [raw, modelLeaf(model)];
  const resolved = resolveModel(String(model || ""), fleet.models, fleet.aliases, fleet.families);
  if (DIRECT_SOURCES.includes(resolved.source)) names.unshift(resolved.key);
  return [...new Set(names.filter(Boolean))];
}

/** Efforts the launch contract offers this bundle's model: null when the provider has no table at all (a gateway). */
export function dispatchAllowedEfforts(bundle, fleet, model = null) {
  const table = dispatchTable((bundle || {}).provider || (bundle || {}).account, fleet);
  if (table === null) return null;
  const raw = (bundle || {}).model;
  for (const name of raw ? lookupNames(raw, fleet) : [model]) if (table[name]) return [...table[name]];
  const own = (bundle || {}).efforts;
  return Array.isArray(own) ? [...own] : [];
}

/**
 * Rows for the effort the user's pin names on a model the pool has no row at that level for, so the score decides among
 * them exactly as it does among written rows. Each row is the model's own carrier with a distinct id.
 */
export function namedEffortBundles(task, ctx) {
  const effort = task.constraint_effort;
  if (!effort || task.constraint_bundle) return {};
  const fleet = ctx.fleet;
  const groups = new Map();
  for (const bundle of Object.values(ctx.bundles)) {
    const model = rowKeyOf(bundle.model, fleet);
    if (task.constraint_model && !modelPinMatches(task, bundle, model)) continue;
    const key = JSON.stringify([bundle.account, bundle.harness || null, model]);
    if (!groups.has(key)) groups.set(key, { model, rows: [] });
    groups.get(key).rows.push(bundle);
  }
  const found = {};
  for (const { model, rows } of groups.values()) {
    const written = new Set(rows.map((r) => String(scoringEffort(r, modelInfo(fleet, r.model)) || "").toLowerCase()));
    const carriers = rows.filter((r) => (!r.disabled || r.disabled_by_default) && !r.discovery_unavailable && !hasFixedEffort(r, fleet));
    // Each level goes to the first row that offers it, so the answer does not depend on the order of the rows.
    for (const carrier of carriers) {
      const allowed = dispatchAllowedEfforts(carrier, fleet, model);
      const levels = (allowed !== null ? !allowed.includes(effort) : !task.constraint_model) ? [] : [effort];
      for (const level of levels) {
        const own = Array.isArray(carrier.offered_efforts) ? carrier.offered_efforts : Array.isArray(carrier.efforts) ? carrier.efforts : null;
        if (written.has(level) || (own && !own.includes(level))) continue;
        written.add(level);
        const rowId = `${carrier.id}@${level}`;
        found[rowId] = { ...carrier, id: rowId, effort: level, pin_carrier: carrier.id };
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------- the bundle's `when` rule

/** Which part of a bundle's `when` this task fails, or null when the bundle applies. */
export function whenFailure(bundle, task) {
  const rule = bundle && bundle.when;
  if (!rule || typeof rule !== "object") return null;
  const pinned = task.pinned_bundle || task.constraint_bundle;
  if (pinned && bundle.id && (pinned === bundle.id || pinned === bundle.source_id)) return null;
  if ("max_reasoning_depth" in rule) {
    const depth = task.profile && task.profile.reasoning_depth;
    if (!isNum(depth) || depth > Number(rule.max_reasoning_depth)) {
      return `its when rule allows reasoning depth up to ${rule.max_reasoning_depth}, the task has ${depth}`;
    }
  }
  if ("min_difficulty" in rule) {
    const order = ["routine", "hard", "coupled", "frontier"];
    const diff = task.difficulty;
    const req = rule.min_difficulty;
    if (order.includes(diff) && order.includes(req) && order.indexOf(diff) < order.indexOf(req)) {
      return `its when rule asks for difficulty ${req} or above, the task is ${diff}`;
    }
  }
  return null;
}

/** The cooldown a host-reported launch failure keeps on an account or one of its models. */
export function coolingReason(bundle, launchFailures, now) {
  if (!launchFailures || typeof launchFailures !== "object") return null;
  const entries = launchFailures.entries && typeof launchFailures.entries === "object" ? launchFailures.entries : launchFailures;
  const account = bundle.account || bundle.provider;
  if (!account) return null;
  for (const k of [String(account), bundle.model ? `${account}/${bundle.model}` : null].filter(Boolean)) {
    const entry = entries[k];
    if (!entry || typeof entry !== "object") continue;
    const until = entry.until ? Date.parse(String(entry.until)) : NaN;
    if (Number.isFinite(until) && until <= now) continue;
    const left = Number.isFinite(until) ? Math.max(1, Math.round((until - now) / 60000)) : 15;
    const scope = k === String(account) ? "account" : "model";
    return `host refused to create a worker on this ${scope} (${entry.failure_class || "unknown"}); cooling down ${left} more min, then reroute`;
  }
  return null;
}

// ---------------------------------------------------------------------------- the worker a related task continues

export const workerHistoricalTokens = (worker) => {
  if (!worker || typeof worker !== "object") return 0;
  return Math.max(Number(worker.historical_context_tokens || 0), Number(worker.compacted_tokens || 0) + Number(worker.context_tokens || 0));
};
export const rotationThreshold = (policy) => {
  const raw = policy.rotate_after_carried_tokens;
  if (!isNum(raw) || raw <= 0) throw new Error(`scoring.rotate_after_carried_tokens must be a positive number, got ${raw}`);
  return Math.trunc(raw);
};
export const workerWorn = (worker, policy) => {
  const limit = rotationThreshold(policy);
  return worker && typeof worker === "object" ? workerHistoricalTokens(worker) >= limit : false;
};

// ---------------------------------------------------------------------------- evaluate_bundle

const BUNDLE_FIELDS = ["provider", "harness", "account", "model", "effort", "modeId", "launch_model", "draws", "pin_carrier"];

/** One bundle against one task: `{ id, bundle, excluded, notes, components, score, ... }` (the allocator's candidate row). */
export function evaluateBundle(bundle, task, ctx) {
  const { policy, fleet } = ctx;
  const spec = fleet.accounts[bundle.account];
  const model = canonicalOf(bundle.model, fleet);
  const ownModel = rowKeyOf(bundle.model, fleet);
  const info = modelInfo(fleet, bundle.model);
  const kind = task.kind;
  const baseHours = task.hours;
  const baseChainHours = task.chain_hours;
  const result = {
    id: bundle.id,
    bundle: Object.fromEntries(BUNDLE_FIELDS.filter((k) => bundle[k] !== undefined && bundle[k] !== null).map((k) => [k, bundle[k]])),
    excluded: [],
    notes: [],
    components: {},
    score: null,
  };
  const five = ctx.five_axis;
  const now = ctx.now;
  // Economy pool mode: a window's price must not depend on the current task's flags. The pool is what an account can run at
  // all: it keeps the account-level exclusions and drops the ones that belong to the task.
  const pool = Boolean(task._economy_pool);
  const exclude = (reason) => result.excluded.push(reason);
  const taskExclude = (reason) => {
    if (!pool) result.excluded.push(reason);
  };
  const shortExclude = (reason) => {
    if (pool) return;
    result.excluded.push(reason);
    (result._five_short_reasons ||= []).push(reason);
  };

  if (bundle.disabled && !(bundle.disabled_by_default && bundleNamed(task, bundle, ownModel))) exclude("unchecked in model management");
  if (Array.isArray(bundle.disabled_efforts) && bundle.disabled_efforts.includes(String(bundle.effort || "").toLowerCase())) {
    exclude("unchecked in model management");
  }
  if (bundle.discovery_unavailable) exclude(typeof bundle.discovery_unavailable === "string" ? bundle.discovery_unavailable : "model not detected by discovery for 7+ days");
  if (bundle.not_dispatchable) exclude(`${bundle.model}@${bundle.effort}: not in dispatch_efforts of ${bundle.provider || bundle.account || "its route"}`);
  if (ctx.unavailable.has(bundle.id) || (bundle.source_id && ctx.unavailable.has(bundle.source_id))) exclude(MARKED_BY_PARENT);
  const cooling = coolingReason(bundle, ctx.launch_failures, now);
  if (cooling) exclude(cooling);
  if (ctx.unhealthy.has(healthKey(bundle.model, fleet.models, fleet.aliases, fleet.families)) || ctx.unhealthy.has(bundle.model)) exclude(MARKED_UNHEALTHY);
  if (task.min_context_tokens && Number(info.context_window || 128000) * 0.95 < task.min_context_tokens) {
    exclude(`context window ${info.context_window || 128000} outgrown by ${task.min_context_tokens} tokens`);
  }
  // The account's own state: signed out, plan lapsed, disabled or long-failing. Out by the account, never by this task.
  if (spec.state_excluded) {
    exclude(spec.state_excluded);
    result.account_unavailable = true;
  }
  if (spec.prepaid_exhausted) exclude(spec.prepaid_exhausted);
  // Only subscription accounts join automatic routing. A checked metered (API) bundle is a last resort: explicit selection,
  // task.metered_ok, or the plan's fallback pass when no subscription can take the work. Unknown billing stays explicit only.
  const billing = (spec.billing || "unknown") === "subscription" ? null : spec.billing || "unknown";
  if (billing && !task.metered_ok && !(billing === "metered" && task.metered_fallback)) {
    if (!modelPinMatches(task, bundle, ownModel) && task.pinned_bundle !== bundle.id) {
      exclude(billing === "metered" ? METERED_LAST_RESORT : `${billing} billing: explicit selection only`);
    }
  }
  if (spec.verified === false && !task.include_unverified) exclude("account not verified as launchable");
  if (info.advisor_only && !(info.advisor_for || []).includes(kind)) exclude("advisor only; cannot execute");
  const accountOut = result.excluded.length > 0; // out by the account, the checkbox, a hold or billing: not by this task
  if (info.excluded_when === "local_only" && task.local_only) {
    taskExclude("the parent marked this work local-only (it must run on this machine: in-place edits, local tools, secrets or live accounts); this worker runs remotely");
  }
  if (info.excluded_when === "local_only" && task.outbound_ok === false) taskExclude("the parent disallowed outbound work; this worker runs remotely");
  if (info.text_only && task.file_transfer) taskExclude("this text-only runner cannot transfer or apply local files");
  if (task.constraint_model && !modelPinMatches(task, bundle, ownModel)) taskExclude(EXPLICIT_MODEL_CONSTRAINT);
  if (task.constraint_effort && String(scoringEffort(bundle, info) || "").toLowerCase() !== task.constraint_effort) taskExclude(EXPLICIT_EFFORT_CONSTRAINT);
  // A named bundle (its id, the entry it was split from, or the row a named effort was cut from) is the only one that runs.
  const namedBundle = task.pinned_bundle || task.constraint_bundle;
  if (namedBundle && ![bundle.id, bundle.source_id, bundle.pin_carrier].includes(namedBundle)) taskExclude(EXPLICIT_BUNDLE_CONSTRAINT);

  // Rule B: a demanded category with no data at all, no cited usd on a metered account, or unknown image_input modality when
  // the task demands image input (needs_visual, or tool_operation 3), leaves automatic routing; naming the model still dispatches it, with the
  // data error as a warning and its cost unpriced.
  const state = info.five_axis || { missing: [...FIVE_AXES], usd_status: "missing" };
  const billed = !(spec.unmetered || spec.unlimited);
  const named0 = !pool && (modelPinMatches(task, bundle, ownModel) || task.pinned_bundle === bundle.id);
  const imgInfo = state.image_input || { status: "missing" };
  // The task reads images when the classifier says so (needs_visual, which task intake also sets for needs_gui) or when it
  // demands tool_operation 3: a model that takes no image input cannot do either.
  const needsImageInput = (Boolean(task.needs_visual) || (task.five_axis_demand.tool_operation || 0) >= IMAGE_INPUT_LEVEL) && !pool;
  const eff = scoringEffort(bundle, info);
  const values = fiveAxisValues(state, eff);
  if (needsImageInput && imgInfo.status === "no") exclude(`model does not accept image input (${imgInfo.source || "public data"})`);

  const missingTargets = (axis, level) => {
    if (level < five.demanded_level) return [];
    if (axis === "tool_operation") {
      const selected = TOOL_LEVEL_FACETS[level] || [];
      return selected.filter((f) => ((values.tool_operation || {})[f] ?? null) === null).map((f) => `tool_operation.${f}`);
    }
    if (values[axis] !== null && values[axis] !== undefined) return [];
    const cell = (state.categories || {})[axis] || {};
    const facets = cell && typeof cell === "object" ? cell.facets : null;
    const req = CATEGORY_FACETS[axis] || [];
    if (facets && typeof facets === "object" && req.length > 1) {
      const missF = req.filter((f) => atEffort(facets[f], eff) === null).map((f) => `${axis}.${f}`);
      if (missF.length > 0 && missF.length < req.length) return missF;
    }
    return [axis];
  };
  const blind = [];
  const missingList = [];
  if (!pool) {
    for (const [a, w] of Object.entries(task.five_axis_demand)) {
      const miss = missingTargets(a, w);
      if (miss.length > 0) {
        blind.push(a);
        missingList.push(...miss);
      }
    }
  }
  let blindMsg = null;
  if (blind.length > 0) {
    const effNote = eff && blind.some((a) => (((state.categories || {})[a] || {}).value ?? null) !== null) ? ` at effort ${eff}` : "";
    blindMsg = `no trusted data for the demanded category ${blind.join(", ")} on ${model}${effNote} (missing ${missingList.join(", ")}; fill with \`agentcompass score set ${model} ${missingList[0]} <1..3>\` or in the tray Manual Scores panel)`;
  }
  if (blindMsg && !pool) result._five_blind_msg = blindMsg;
  const errors = [
    ...(blindMsg ? [blindMsg] : []),
    ...(billed && state.usd_status !== "ok" ? ["usd_per_hour has no cited source on a metered account"] : []),
    ...(needsImageInput && !["yes", "no"].includes(imgInfo.status) ? ["image_input modality has no cited source"] : []),
  ];
  for (const error of errors) {
    if (named0) {
      const unpriced = error.startsWith("usd_per_hour") ? " (its cost is not priced)" : "";
      result.notes.push(`data error: ${error}; dispatched because it was named${unpriced}`);
      (result.data_errors ||= []).push(error);
    } else {
      exclude(`data error: ${error} (out of automatic routing; name the model to dispatch it)`);
    }
  }
  const manualApplied = state.manual_scores || {};
  if (Object.keys(manualApplied).length > 0) {
    const parts = Object.entries(manualApplied)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([t, r]) => `${t}=${Number(r.level)} (z=${r.z >= 0 ? "+" : "-"}${Math.abs(r.z).toFixed(4)}, ${r.kind}, ${r.as_of})`);
    result.notes.push(`manual capability scores applied: ${parts.join("; ")}`);
    result.manual_scores = { ...manualApplied };
  }
  const estimated = state.estimates || {};
  if (Object.keys(estimated).length > 0) {
    result.notes.push(`facets estimated (same-series sibling or the fit on the tier; no board of their own): ${Object.keys(estimated).sort().join(", ")}`);
    result.estimated_axes = [...new Set(Object.keys(estimated).map((n) => n.split(".")[0]))].sort();
  }
  // One basis for the time a task takes, its spend and the window it needs (`durationAt`): Time/Task at this effort.
  const [durMult, durBasis] = durationAt(info, eff);
  if (durMult === null) {
    const error = `no Time/Task for ${model} at ${eff || "its single configuration"} (Artificial Analysis, arena.ai Agent on its scale, or a same-series effort conversion)`;
    if (named0) {
      result.notes.push(`data error: ${error}; dispatched because it was named, hours are the task's own estimate`);
      (result.data_errors ||= []).push(error);
    } else {
      exclude(`data error: ${error} (out of automatic routing at this effort; name the model to dispatch it)`);
    }
  }
  const hours = durMult === null ? baseHours : baseHours * durMult;
  const chainHours = durMult === null ? baseChainHours : baseChainHours * durMult;
  result.components.duration_source = (durBasis || {}).method || "unknown";
  if (durMult !== null) {
    result.notes.push(`time at ${eff || "its single configuration"}: ${hours.toFixed(2)}h from ${(durBasis || {}).method} (${(durBasis || {}).source || "series"})`);
  }
  const expires = parseTime(spec.expires_at);
  if (expires !== null && (expires - now) / 1000 < hours * 3600) taskExclude("subscription ends before the work would finish");

  const worker = task.worker;
  const workerBundle = worker ? worker.bundle : null;
  const sameWorker = Boolean(worker) && workerBundle === bundle.id && !(task.read_only_review && worker.read_only_review === false);
  const resumes = sameWorker;
  const worn = workerWorn(worker, policy);
  let contextExtra = 0.0;
  if (resumes) {
    const carried = workerHistoricalTokens(worker);
    if (!worn) contextExtra = policy.context_burn_extra_at_250k * clamp(carried / rotationThreshold(policy), 0, 1);
  }
  const contextBurn = 1 + contextExtra;
  // `usd_per_hour` is the model's dollars per hour of its own work (a rate), so the spend is usd/h x the hours this candidate
  // takes at its effort, and the window's quota rate carries no second effort factor.
  const econHours = hours;
  const econChainHours = chainHours;
  const stepUsd = bundleTaskUsd(spec, model, econHours, info, contextBurn);
  const chainUsd = bundleTaskUsd(spec, model, econChainHours, info, contextBurn);
  let availableAt = null;
  const windowStates = {};
  let longApplicable = false; // the bundle draws at least one long reset-period window (read or not)
  if (spec.unlimited) result.notes.push("unlimited usage");
  // Purpose-limited unmetered channels have no quota to relieve: never another window's substitute.
  result._five_unmetered = Boolean(spec.unmetered || spec.unlimited);
  // A metered (API) account is a last resort: it has a ladder of its own but is never another window's substitute.
  result._five_metered = billing === "metered";
  if (!spec.unmetered) {
    const acctUsage = (ctx.usage.accounts || {})[bundle.account] || {};
    const acctStale = acctUsage.status === "stale" || acctUsage.stale === true;
    const named = !pool && (modelPinMatches(task, bundle, ownModel) || task.pinned_bundle === bundle.id);
    for (const [wid, wspec, observed0] of applicableWindows(spec, model, acctUsage, bundle, bundle.model)) {
      (result._five_axis_windows ||= []).push(wid);
      longApplicable = longApplicable || !windowIsShort(wspec, policy);
      const observed = cycleObservation(wspec, observed0, acctUsage, now, true);
      const refusal = windowRefusal(wid, wspec, observed, acctUsage, now);
      if (refusal) (windowIsShort(wspec, policy) ? shortExclude : exclude)(refusal);
      const wstate = windowState(wid, wspec, observed, spec, now, policy.short_window_hours, acctStale, null);
      const unit = unitRate(spec, wid, model, info);
      const capUsdW = capacityUsd(spec, wid);
      if (capUsdW === null) {
        if (wstate.known && wstate.remaining <= policy.safety_margin_pct) {
          exclude(`${wid} has ${Math.round(wstate.remaining)}% left, inside the ${policy.safety_margin_pct}% reserve (capacity unknown, so the need cannot be priced)`);
          result.wait_until_hours = Math.max(result.wait_until_hours || 0, wstate.reset_hours);
          continue;
        }
        const err = `${wid} capacity_unknown (quota unknown, spend unpriced)`;
        const planSuffix = spec.plan_unknown_reason ? `; plan unknown (${spec.plan_unknown_reason})` : "";
        if (named) {
          result.notes.push(`data error: ${err}; dispatched because it was named${planSuffix}`);
          (result.data_errors ||= []).push(`${err}${planSuffix}`);
        } else {
          exclude(`data error: ${err}${planSuffix} (out of automatic routing; name the model to dispatch it)`);
        }
        continue;
      }
      if (!wstate.known) {
        if (wstate.short) {
          const wLen = Number(wspec.hours || 0) || econHours;
          const step = unit === null ? null : Math.min(econHours, wLen) * unit * contextBurn;
          const marginPct = shortWindowLimits(spec, wid, policy, now)[2];
          if (step !== null && 100.0 - step < marginPct) {
            shortExclude(`${wid} full capacity (100%) is short of the ~${step.toFixed(1)}% the work needs plus ${marginPct}% margin`);
          } else {
            const resetDt = observed ? parseTime(observed.resets_at) : null;
            if (observed && resetDt !== null && resetDt > now && observed.reset_time_passed !== true) {
              const wait = (resetDt - now) / HOUR_MS;
              shortExclude(`${wid} has an active reset in ${wait.toFixed(1)}h with unknown remaining percentage`);
            }
          }
        }
        continue;
      }
      let st = wstate;
      if (st.short) {
        const wLen = Number(wspec.hours || 0) || econHours;
        const tau = st.reset_hours ?? wLen;
        const hBefore = tau === null || tau === INF || st.unstarted ? Math.min(econHours, wLen) : Math.min(econHours, Math.max(0.0, Number(tau)));
        const step = unit === null ? null : hBefore * unit * contextBurn;
        const stepPeriod = unit === null ? null : Math.min(Math.max(0.0, econHours - hBefore), wLen) * unit * contextBurn;
        const [smallShort, floorPct, marginPct] = shortWindowLimits(spec, wid, policy, now);
        const empty = st.remaining <= floorPct;
        if (empty || (step !== null && st.remaining - step < marginPct)) {
          const wait = st.reset_hours;
          const what = empty ? "is empty" : `has ${Math.round(st.remaining)}%, short of the ~${step.toFixed(1)}% the work needs,`;
          const postPeriod = unit === null ? null : Math.min(econHours, wLen) * unit * contextBurn;
          if (postPeriod !== null && 100.0 - postPeriod < marginPct) {
            shortExclude(`${wid} full capacity (100%) is short of the ~${postPeriod.toFixed(1)}% the work needs plus ${marginPct}% margin`);
          } else if (!smallShort && !st.stale && 0 < wait && wait <= policy.defer_if_reset_within_hours && wait >= (st.natural_reset_hours ?? wait)) {
            availableAt = Math.max(availableAt || 0, wait);
            result.notes.push(`${wid} ${what} for ${wait.toFixed(1)}h; start after its reset`);
            const renewed = afterReset(st, wLen);
            if (renewed !== null) {
              renewed.unstarted = true;
              windowStates[wid] = [wspec, renewed, capUsdW, unit];
            }
          } else {
            shortExclude(`${wid} ${what} for ${wait.toFixed(1)}h`);
          }
          continue;
        }
        if (stepPeriod !== null && 100.0 - stepPeriod < marginPct) {
          shortExclude(`${wid} full capacity (100%) is short of the ~${stepPeriod.toFixed(1)}% the work needs plus ${marginPct}% margin`);
          continue;
        }
        windowStates[wid] = [wspec, st, capUsdW, unit];
        continue;
      }
      if (unit === null) continue;
      const wLen = wspec.hours === undefined ? null : wspec.hours;
      const tau = st.reset_hours;
      const reqHours = task.coupling === "high" ? econChainHours : econHours;
      const hBefore = tau === null || tau === undefined || tau === INF || wLen === null ? reqHours : Math.min(reqHours, Math.max(0.0, Number(tau)));
      let need = hBefore * unit * contextBurn;
      if (!pool && st.remaining - need < policy.safety_margin_pct && wLen !== null && st.reset_hours <= policy.defer_if_reset_within_hours) {
        let renewed = afterReset(st, wLen);
        if (renewed !== null && renewed.expiry_hours !== null && renewed.expiry_hours !== undefined && renewed.expiry_hours < hours) renewed = null;
        if (renewed !== null && 100.0 - Math.min(reqHours, Number(wLen)) * unit * contextBurn >= policy.safety_margin_pct) {
          st = renewed;
          availableAt = Math.max(availableAt || 0, renewed.deferred_hours);
          result._five_long_wait = true; // a long window must renew first: no absorber of other work now
          need = Math.min(reqHours, Number(wLen)) * unit * contextBurn;
          result.notes.push(`${wid} renews in ${renewed.deferred_hours.toFixed(1)}h; start then (assumes a full renewal)`);
        }
      }
      if (st.remaining - need < policy.safety_margin_pct) {
        if (st.reset_hours === INF) {
          taskExclude(`${wid} has ${Math.round(st.remaining)}% left; the work needs ~${need.toFixed(1)}% plus a ${policy.safety_margin_pct}% margin (starter allowance does not reset)`);
        } else {
          taskExclude(`${wid} has ${Math.round(st.remaining)}% left; the work needs ~${need.toFixed(1)}% plus a ${policy.safety_margin_pct}% margin and it resets in ${(st.reset_hours / 24).toFixed(1)} days`);
          result.wait_until_hours = Math.max(result.wait_until_hours || 0, st.reset_hours);
        }
      } else if (wLen !== null && reqHours > hBefore) {
        const remNeed = Math.min(reqHours - hBefore, Number(wLen)) * unit * contextBurn;
        if (100.0 - remNeed < policy.safety_margin_pct) {
          taskExclude(`${wid} full capacity (100%) is short of the ~${remNeed.toFixed(1)}% the work needs per period plus ${policy.safety_margin_pct}% margin`);
        }
      }
      windowStates[wid] = [wspec, st, capUsdW, unit];
      const capEv = (((spec.capacity_source || {})[wid]) || {}).evidence;
      if (capEv) {
        result.notes.push(`${wid} capacity: ${capEv}`);
        (result.components.capacity_evidence ||= {})[wid] = capEv;
      }
      if (st.stale && !result.notes.includes("capacity from a stale observation")) result.notes.push("capacity from a stale observation");
      if (acctUsage.status !== "fresh" && acctUsage.fetched_at && !result.components.reading_at) {
        // Priced from the last successful reading of this reset period: labelled with its read time.
        result.components.reading_at = acctUsage.fetched_at;
        result.notes.push(`${wid}: priced from the reading taken at ${acctUsage.fetched_at} (the latest read did not succeed; it is the last good reading of this reset period)`);
      }
    }
    if (spec.capacity_unknown && !(result._five_axis_windows || []).length) {
      const err = "capacity_unknown (quota unknown, spend unpriced)";
      const planSuffix = spec.plan_unknown_reason ? `; plan unknown (${spec.plan_unknown_reason})` : "";
      if (named) {
        result.notes.push(`data error: ${err}; dispatched because it was named${planSuffix}`);
        (result.data_errors ||= []).push(`${err}${planSuffix}`);
      } else {
        exclude(`data error: ${err}${planSuffix} (out of automatic routing; name the model to dispatch it)`);
      }
    }
    if (meteredUsdUncapped(spec)) {
      // no budget: not a window, not excluded for exhaustion, still a metered last resort
    } else if (!spec.unlimited && !accountOut && !(result.data_errors || []).length && !Object.values(windowStates).some(([, s]) => !s.short)) {
      // Priced on the weekly window or not at all: a candidate with no long reset-period window in its state cannot be priced
      // and cannot stand in for another account's work, so it leaves automatic routing as a surfaced data error. Three causes,
      // three messages: nothing of the account can be read; the weekly window is declared but not read while the 5-hour window
      // is; no weekly window exists at all.
      let err;
      if (!(result._five_axis_windows || []).length || !longApplicable) err = !longApplicable ? QUOTA_NO_LONG_WINDOW : QUOTA_READING_UNAVAILABLE;
      else if (Object.keys(windowStates).length > 0) err = QUOTA_LONG_UNREAD;
      else err = QUOTA_READING_UNAVAILABLE;
      if (named) {
        result.notes.push(`data error: ${err}; dispatched because it was named`);
        (result.data_errors ||= []).push(err);
      } else {
        exclude(`data error: ${err} (out of automatic routing; name the model to dispatch it)`);
      }
    }
    result._five_window_states = windowStates;
    result._five_econ_hours = econHours;
    result._five_chain_hours = econChainHours;
    result._five_context_burn = contextBurn;
    if (Object.keys(windowStates).length === 0 && result.excluded.length === 0 && !(result.data_errors || []).length) {
      result.notes.push("no current capacity observation; unknown is not exhausted");
    }
  }
  result.capacity = null; // the economy sets the priced window (applyFiveAxisEconomy)
  result.expected_hours = pyRound(hours, 2);
  result.duration_hours = pyRound(hours, 4);
  if (durMult !== null) result.components.duration_multiplier = pyRound(durMult, 4);
  result.expected_pct = result.chain_pct = null;
  result.expected_usd = billing === "unknown" ? null : pyRound(stepUsd, 2);
  result.chain_usd = billing === "unknown" ? null : pyRound(chainUsd, 2);
  result.available_in_hours = availableAt;
  let action = "start";
  if (worker) action = worn ? "rotate" : resumes ? "resume" : "switch";
  result.action = action;
  // Quality is the continuous fit of the category scores at this effort to the demand, and nothing else (the effort's extra
  // burn is priced in its usd and its gain in the categories' effort shift). The economy decides.
  const [fit, axisRows] = fiveAxisFit(values, task.five_axis_demand, task.five_axis_targets);
  result._five_values = values; // the economy re-reads this candidate's scores at its effort over the demand grid
  // The candidate's four category scores at this effort: what the radar and the explanation show (tool_operation: the weaker
  // of its facets that have a value).
  const tool = Object.values(values.tool_operation).filter((z) => z !== null && z !== undefined);
  const shown = { ...Object.fromEntries(FIVE_AXES.filter((a) => a !== "tool_operation").map((a) => [a, values[a]])), tool_operation: tool.length > 0 ? Math.min(...tool) : null };
  for (const [a, v] of Object.entries(shown)) result.components[a] = v === null || v === undefined ? null : pyRound(v, 4);
  for (const [a, v] of Object.entries(fiveAxisShares(values, ctx.targets))) result.components[`share_${a}`] = v;
  const rows = Object.values(axisRows);
  result.components.five_axis_level = pyRound(fiveAxisLevel(axisRows), 4);
  result.components.five_axis_shortfall = pyRound(sumOf(rows, (r) => r.demand * r.shortfall) / Math.max(1, sumOf(rows, (r) => r.demand)), 4);
  result.five_axis_demand = task.five_axis_demand;
  result.five_axis_fit = axisRows;
  const headroom = fiveAxisHeadroom(axisRows, ctx.targets);
  if (Object.keys(headroom).length > 0) result.five_axis_headroom = headroom; // level-3 credit above the anchor
  const usdRate = spec.unlimited || spec.unmetered || billing === "unknown" ? 0.0 : modelUsdPerHour(model, info); // dollars per hour of this candidate's own work
  result.five_axis_price = { usd_per_hour: pyRound(usdRate, 4) };
  Object.assign(result.components, { fit: pyRound(fit, 3), continuity: 0.0 });
  if (action === "resume" && ["medium", "high"].includes(task.coupling)) {
    // a related task continues its worker: one demand level's worth
    result.components.continuity = pyRound(task.five_axis_continuity, 4);
  }
  return result;
}
