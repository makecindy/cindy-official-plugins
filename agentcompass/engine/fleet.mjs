// Vendored from akiiwa-games/magpie-agentcompass-router src/fleet.js at 35a7aea5b6bc4028bb78c460482b6d3ad8708948 (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * The fleet the allocator ranks over, built from what the gateway has: a candidate pool and a quota snapshot.
 *
 * AgentCompass reads accounts, bundles and usage from the worker launcher's discovery; Magpie has a pool of models and the
 * quota readings of its accounts, so this module is the one place that turns them into the same shapes (`account_fleet.py`,
 * `provider_inventory.py`, `usage_magpie.py`):
 *
 *   account   family, plan, windows (hours, scope, launch floor), `capacity_usd` per window from the public community data
 *             of the plan (`PLAN_CAPACITY`), billing, and the account's own health
 *   usage     one row per account: each window's remaining percentage and time to reset
 *   bundle    a model at an effort on one account; a model no quota account serves runs on the unmetered gateway account
 *
 * Nothing here scores. Window scope, plan names, capacities and efforts are all data from the pinned reference tables.
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

import {
  DISPATCH_EFFORTS,
  EFFORT_ORDER,
  FAMILIES,
  MODEL_ALIASES,
  SCORING_POLICY,
  healthKey,
  nameFixesEffort,
  resolveModel,
  splitEffortSuffix,
} from "./catalog.mjs";
import { PLAN_CAPACITY } from "./reference-data.mjs";
import { canonicalWindowId, configuredPlan, planDefaults, planTable, planUnknownText } from "./plans.mjs";
import { defaultScoredModels, scoredModels } from "./axis-scores.mjs";
import { dispatchAllowedEfforts, modelInfo } from "./candidate-eval.mjs";
import { inferModelProviderFamily, normalizeProviderFamily, providerMatchesModel, providersMatch } from "./quota.mjs";

export const GATEWAY_ACCOUNT = "_gateway";
const METERED_KINDS = ["balance", "metered", "api", "payg"];
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** One account of the quota snapshot as the allocator reads it: `{ spec, usage }`. */
export function accountFrom(entry, nowMs) {
  const family = normalizeProviderFamily(entry.provider);
  const metered = METERED_KINDS.includes(entry.kind);
  const spec = { family, billing: metered ? "metered" : "subscription", verified: true, windows: {}, capacity_usd: {}, key: entry.key, provider: entry.provider };
  const usage = { status: "fresh", available: true, windows: [] };
  if (entry.excluded) spec.state_excluded = `${entry.key}: ${entry.state}: ${entry.reason}`;
  const failing = entry.state === "usage_failing" || entry.stale === true;
  if (failing) {
    usage.status = "stale";
    usage.available = false;
    if (entry.lastSuccessAt) usage.fetched_at = entry.lastSuccessAt;
  }
  if (entry.unlimited || (entry.windows || []).some((w) => w.unlimited)) {
    spec.unlimited = true;
    return { spec, usage };
  }
  if (metered) {
    spec.backend_kind = "metered_usd";
    const amount = entry.balance && typeof entry.balance.amount === "number" ? entry.balance.amount : null;
    if (amount !== null && amount <= 0) spec.prepaid_exhausted = `${entry.key}: prepaid balance is exhausted (${amount})`;
    if (amount !== null && amount > 0) {
      spec.windows = { balance: { hours: null } };
      spec.capacity_usd = { balance: amount };
      usage.windows.push({ id: "balance", remaining_pct_before_reset: 100 });
    }
    return { spec, usage };
  }
  const plan = configuredPlan(family, entry.plan);
  const template = planDefaults(family, plan);
  const tplWindows = (template && template.windows) || {};
  spec.plan = plan || entry.plan || null;
  spec.windows = JSON.parse(JSON.stringify(tplWindows));
  for (const w of entry.windows || []) {
    const wid = canonicalWindowId(w.id, tplWindows);
    if (!(wid in spec.windows)) spec.windows[wid] = { hours: w.hours, ...(Array.isArray(w.models) && w.models.length > 0 ? { models: w.models } : {}) };
    if (!w.known) continue;
    const row = { id: wid, remaining_pct_before_reset: w.remaining, seconds_until_reset: w.resetHours * 3600 };
    if (Array.isArray(w.models) && w.models.length > 0) row.models = w.models;
    if (w.accounts) row.accounts = w.accounts;
    if (w.rateLimited) row.rate_limited = true;
    usage.windows.push(row);
  }
  // A window's capacity is the community's real-usage figure for the plan and window; a window without one is unknown.
  const rows = (PLAN_CAPACITY[family] || {})[plan] || {};
  const sources = {};
  for (const wid of Object.keys(spec.windows)) {
    const row = rows[wid] || {};
    if (typeof row.capacity_usd === "number" && row.capacity_usd > 0) spec.capacity_usd[wid] = row.capacity_usd;
    sources[wid] = { status: row.status || "missing", plan: plan || null };
  }
  spec.capacity_source = sources;
  const unknown = Object.keys(spec.windows).filter((wid) => !(wid in spec.capacity_usd));
  if (unknown.length > 0) {
    spec.capacity_unknown = true;
    if (Object.keys(planTable(family)).length > 0 && !(plan in planTable(family))) spec.plan_unknown_reason = planUnknownText(entry.plan);
  }
  return { spec, usage };
}

// ---------------------------------------------------------------------------- the fleet

/**
 * `{ fleet, usage, entries }` for a quota snapshot (already normalized into `entries`) or none. The fleet is the allocator's
 * accounts document: scored models, aliases, family patterns, launch efforts, the scoring policy and the accounts.
 */
export function buildFleet({ entries = null, nowMs = Date.now(), policy = SCORING_POLICY, models = null, aliases = MODEL_ALIASES, userScores = null } = {}) {
  const scored = models || (userScores ? scoredModels({ aliases, userScores }) : defaultScoredModels());
  const fleet = { models: scored, aliases, families: FAMILIES, scoring: policy, dispatch_efforts: DISPATCH_EFFORTS, accounts: {} };
  const usage = { accounts: {} };
  for (const entry of entries || []) {
    const { spec, usage: row } = accountFrom(entry, nowMs);
    fleet.accounts[entry.key] = spec;
    usage.accounts[entry.key] = row;
  }
  fleet.accounts[GATEWAY_ACCOUNT] = { family: null, billing: "subscription", verified: true, unmetered: true, windows: {}, capacity_usd: {}, key: GATEWAY_ACCOUNT, provider: "gateway" };
  return { fleet, usage, entries: entries || [] };
}

// ---------------------------------------------------------------------------- pool entries to bundles

const lc = (v) => String(v).trim().toLowerCase();
const withoutUnconstrainingTag = (raw) => raw.replace(/:(?:auto|off|default)$/i, "");

/** The name of a pool entry: a string, or the object's `model`. */
export const entryModel = (entry) => (typeof entry === "string" ? entry.trim() : entry && typeof entry === "object" ? String(entry.model || "").trim() : "");

/**
 * The efforts a bare model (no effort in its name or entry) is offered at: the provider's launch table's when it lists the model;
 * none (`[null]`: the row has no effort of its own) when the provider has a table that does not list it, as
 * `account_fleet.dispatch_allowed_efforts` does; else, for a gateway with no table, those the data times.
 */
export function bareEfforts(provider, model, fleet) {
  const info = modelInfo(fleet, model);
  if (info.fixed_effort) return [null];
  const allowed = dispatchAllowedEfforts({ provider, model }, fleet, model);
  // A provider whose table does not list the model offers it at no effort ("a step-down never lands on an unverified flag",
  // `account_fleet.dispatch_allowed_efforts`): one row with no effort of its own. Only a provider with no table (a gateway) offers
  // the efforts the data times.
  if (allowed !== null && allowed.length === 0) return [null];
  const timed = Object.keys((((info.five_axis || {}).duration) || {}).by_effort || {});
  const pool = allowed !== null ? allowed : timed;
  const known = EFFORT_ORDER.filter((e) => pool.includes(e));
  return known.length > 0 ? known : [null];
}

/** One pool entry as effort rows, before accounts: `{ model, effort, ...flags }`. */
export function effortRows(entry, fleet) {
  const name = entryModel(entry);
  if (!name) return [];
  const obj = typeof entry === "object" ? entry : {};
  const stripped = withoutUnconstrainingTag(name);
  const { name: modelName, effort: colon } = splitEffortSuffix(stripped);
  const resolved = resolveModel(modelName, fleet.models, fleet.aliases, fleet.families);
  const suffix = colon || resolved.effort || null;
  const fixedBySuffix = suffix && EFFORT_ORDER.includes(suffix);
  const model = fixedBySuffix ? modelName : stripped;
  const provider = obj.provider || inferModelProviderFamily(model, fleet.aliases) || "gateway";
  let efforts;
  let notDispatchable = false;
  if (fixedBySuffix) efforts = [obj.effort ? lc(obj.effort) : suffix];
  else if (obj.effort) efforts = [lc(obj.effort)];
  else if (Array.isArray(obj.efforts)) {
    const listed = obj.efforts.map(lc).filter(Boolean);
    const allowed = dispatchAllowedEfforts({ ...obj, model, provider }, fleet, model);
    efforts = allowed && allowed.length > 0 ? listed.filter((e) => allowed.includes(e)) : listed;
    if (efforts.length === 0 && listed.length > 0) {
      efforts = listed;
      notDispatchable = true;
    }
  } else {
    efforts = bareEfforts(provider, model, fleet);
  }
  const own = Array.isArray(obj.efforts) ? obj.efforts.map(lc) : null;
  const split = efforts.length > 1 && obj.id;
  return efforts.map((effort) => ({
    ...obj,
    model,
    effort,
    provider,
    ...(fixedBySuffix ? { offered_efforts: [effort], effort_fixed: true } : own ? { offered_efforts: own } : {}),
    ...(notDispatchable ? { not_dispatchable: true } : {}),
    ...(split ? { id: `${obj.id}:${effort}`, source_id: obj.id } : {}),
  }));
}


/** The quota accounts that serve a pool entry's model (by provider family), narrowed by an `account` or `provider` it names. */
export function matchingAccounts(row, entries, aliases) {
  let found = entries.filter((e) => providerMatchesModel(e.provider, row.model, aliases) || providerMatchesModel(e.key, row.model, aliases));
  if (row.account) found = found.filter((e) => e.key === row.account || e.account === row.account);
  if (row.provider && row.provider !== inferModelProviderFamily(row.model, aliases)) found = found.filter((e) => providersMatch(e.provider, row.provider));
  return found;
}

/**
 * Every bundle the pool offers: each entry's effort rows on each account that serves it (or the gateway account when none does).
 * A bundle's id is the entry's `id` or `model:effort`, with `@account` added where one id would name two accounts' bundles.
 */
export function expandBundles(poolEntries, fleet, entries) {
  const rows = [];
  for (const entry of poolEntries) for (const row of effortRows(entry, fleet)) rows.push(row);
  const bundles = [];
  for (const row of rows) {
    const accounts = matchingAccounts(row, entries, fleet.aliases);
    const targets = accounts.length > 0 ? accounts.map((e) => ({ account: e.key, provider: normalizeProviderFamily(e.provider) })) : [{ account: GATEWAY_ACCOUNT, provider: row.provider }];
    for (const t of targets) {
      const baseId = row.id || `${row.model}:${row.effort ?? "default"}`;
      bundles.push({ ...row, id: baseId, account: t.account, provider: t.provider, harness: row.harness || t.provider });
    }
  }
  const perId = new Map();
  for (const b of bundles) perId.set(b.id, new Set([...(perId.get(b.id) || []), b.account]));
  const out = {};
  for (const b of bundles) {
    const id = perId.get(b.id).size > 1 ? `${b.id}@${b.account}` : b.id;
    out[id] = id === b.id ? b : { ...b, id, source_id: b.source_id || b.id };
  }
  attachDisabledEfforts(Object.values(out), fleet);
  return out;
}

/** An effort the user unchecked on an account and model is no landing for any row of them (a family row is another model). */
export function attachDisabledEfforts(rows, fleet) {
  const groups = new Map();
  const keyOf = (c) => JSON.stringify([c.account || "", c.harness || "", healthKey(c.model, fleet.models, fleet.aliases, fleet.families)]);
  for (const c of rows) {
    if (!c.disabled || c.disabled_by_default) continue;
    const key = keyOf(c);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c.effort);
  }
  for (const c of rows) {
    const disabled = groups.get(keyOf(c));
    if (disabled) c.disabled_efforts = disabled;
  }
}

export { nameFixesEffort };
