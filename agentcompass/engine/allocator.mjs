// Vendored from akiiwa-games/magpie-agentcompass-router src/allocator.js at 35a7aea5b6bc4028bb78c460482b6d3ad8708948 (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * AgentCompass allocator for the Magpie gateway: the port of `allocator.py` (`plan`) onto a gateway's inputs.
 *
 * The scoring is AgentCompass's and lives in its own modules, each the port of the file of the same name upstream:
 *
 *   axis-scores.js        category scores, panel targets, fit (`fit = sum_a w_a (min(z_a, c_a) - t1_a) / sum_a w_a`)
 *   task-intake.js        the task: route kind, modality needs, pins, hours, chain
 *   candidate-eval.js     one bundle against one task: gates, rule B data errors, window feasibility
 *   quota-economy.js      the price of the quota a candidate spends (quota economy v3.1)
 *   candidate-ranking.js  net score N = fit + continuity - cost, and the order
 *   fleet.js              what the gateway has (pool entries, quota accounts) in the shapes above
 *
 * This file is the glue: it turns a profile and a host's options into a task, a pool and a fleet, ranks them, and says why a
 * route is blocked. Nothing here reads a task's text and nothing here scores.
 *
 * Pure ES2022 module with zero external dependencies so it runs in both Bun (`magpie.hooks` and `/v1/systemone` Decision
 * Provider) and Magpie's in-process `moejs` (`magpie.middleware`).
 */

import {
  CATALOG_NAME_WARNING,
  EFFORT_ORDER,
  MODELS,
  MODEL_ALIASES,
  ROUTES,
  SCORING_POLICY,
  canonicalModel,
  catalogNameWarning,
  escapeControls,
  healthKey,
  nameFixesEffort,
  resolveModel,
  safeName,
  splitEffortSuffix,
} from "./catalog.mjs";
import { unroutedDecision } from "./profiler.mjs";
import { listQuotaAccounts, normalizeQuotaSnapshot } from "./quota.mjs";
import { InvalidCallerProfile, normalizeTask } from "./task-intake.mjs";
import { candidateForBundle, rank } from "./candidate-ranking.mjs";
import {
  EXPLICIT_EFFORT_CONSTRAINT,
  EXPLICIT_MODEL_CONSTRAINT,
  MARKED_UNHEALTHY,
  METERED_LAST_RESORT,
  canonicalOf,
  dispatchAllowedEfforts,
  rowKeyOf,
  whenFailure,
} from "./candidate-eval.mjs";
import { GATEWAY_ACCOUNT, attachDisabledEfforts, buildFleet, effortRows, entryModel, expandBundles } from "./fleet.mjs";

const EFFORT_NOT_PINNED = EXPLICIT_EFFORT_CONSTRAINT;
export { MARKED_UNHEALTHY, EXPLICIT_MODEL_CONSTRAINT };

const lc = (v) => String(v).trim().toLowerCase();

/**
 * The fleet a call ranks over: the catalogue's scored models (or the host's own `catalog.models`), with the operator's manual
 * scores laid over them, and the host's quota accounts.
 */
export function fleetFor(options = {}, nowMs = Date.now()) {
  const catalog = options.catalog || {};
  const policy = catalog.policy || SCORING_POLICY;
  const normalized = options.quotas
    ? Array.isArray(options.quotas._normalized)
      ? options.quotas
      : { _normalized: normalizeQuotaSnapshot(options.quotas, nowMs, policy) }
    : null;
  const built = buildFleet({
    entries: normalized ? normalized._normalized : null,
    nowMs,
    policy,
    models: catalog.models || null,
    aliases: catalog.aliases || MODEL_ALIASES,
    userScores: options.userScores || null,
  });
  return { ...built, policy, normalized };
}

/** The default pool: every model of the catalogue that is not off by default (naming one still reaches it). */
export function defaultPool(fleet, pinnedKey) {
  return Object.keys(fleet.models).filter((m) => !(fleet.models[m] || {}).disabled_by_default || m === pinnedKey);
}

const KNOWN_EFFORT_SUFFIXES = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "default"];

function splitPinModelAndEffort(normConstraint) {
  const colonIdx = normConstraint.lastIndexOf(":");
  if (colonIdx > 0) {
    const suffix = normConstraint.slice(colonIdx + 1).trim().toLowerCase();
    if (KNOWN_EFFORT_SUFFIXES.includes(suffix)) {
      return { modelPart: normConstraint.slice(0, colonIdx).trim(), effortPart: suffix };
    }
  }
  const { effort } = resolveModel(normConstraint);
  return { modelPart: normConstraint, effortPart: KNOWN_EFFORT_SUFFIXES.includes(effort) ? effort : null };
}

/** The pins of a host's options and a task wrapper, as the allocator's raw task fields. */
function pinsOf(options, taskOpts) {
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") || null;
  const c = (taskOpts && taskOpts.constraints) || {};
  const oc = options.constraints || {};
  return {
    bundle: pick(options.pinnedBundle, options.pinned_bundle, taskOpts?.pinned_bundle),
    constraintBundle: pick(options.constraintBundle, options.constraint_bundle, taskOpts?.constraint_bundle, c.bundle, oc.bundle),
    model: pick(options.constraintModel, options.constraint_model, options.pinnedModel, options.pinned_model, taskOpts?.constraint_model, c.model, oc.model),
    effort: pick(options.constraintEffort, options.constraint_effort, options.pinnedEffort, options.pinned_effort, taskOpts?.constraint_effort, c.effort, oc.effort),
  };
}

/** What a gateway request is, as the allocator's raw task: the profile, the pins, the hours and the chain it continues. */
function rawTaskOf(profileInput, options, nowMs) {
  const wrapped = profileInput && typeof profileInput === "object" && profileInput.profile && typeof profileInput.profile === "object" ? profileInput : null;
  const profile = wrapped ? wrapped.profile : profileInput && typeof profileInput === "object" && "reasoning_depth" in profileInput ? profileInput : null;
  if (!profile) return null;
  const pins = pinsOf(options, wrapped);
  const needs = { ...(wrapped && wrapped.needs && typeof wrapped.needs === "object" ? wrapped.needs : {}) };
  if (typeof options.local_only === "boolean") needs.local_only = options.local_only;
  const raw = { ...(wrapped || {}), profile };
  raw.needs = needs;
  raw.constraints = {
    ...((wrapped && wrapped.constraints) || {}),
    ...(pins.constraintBundle ? { bundle: pins.constraintBundle } : {}),
    ...(pins.model ? { model: pins.model } : {}),
    ...(pins.effort ? { effort: pins.effort } : {}),
  };
  if (pins.bundle) raw.pinned_bundle = pins.bundle;
  if (options.hours !== undefined && options.hours !== null) raw.expected_hours = Number(options.hours);
  if (options.meteredOk !== undefined) raw.metered_ok = Boolean(options.meteredOk);
  if (options.urgency) raw.urgency = options.urgency;
  const continuity =
    options.continuity ||
    (options.previousModel ? { previousModel: options.previousModel, previousEffort: options.previousEffort, coupling: options.coupling } : null);
  return { raw, continuity, nowMs };
}

/**
 * The bundle a held session runs on: the one of the pool at its model and effort. A related task continues its worker (one demand
 * level of continuity, `coupling` medium or high); with no coupling given the held worker counts as a medium-coupled chain.
 */
function workerOf(continuity, bundles, fleet) {
  if (!continuity || !continuity.previousModel) return null;
  const key = rowKeyOf(continuity.previousModel, fleet);
  const effort = continuity.previousEffort ? lc(continuity.previousEffort) : null;
  const rows = Object.values(bundles).filter((b) => rowKeyOf(b.model, fleet) === key);
  const row = rows.find((b) => effort && lc(b.effort || "") === effort) || (effort ? null : rows[0]);
  return row ? { bundle: row.id } : null;
}

/**
 * Expand the pool into bundles and rank them for the given task profile (`allocator.plan`): `{ task, pin, selected, ranking,
 * allCandidates, accounts, system }`. `ranking` holds the eligible candidates in order; `selected` is the named bundle when the
 * request pinned one, else the first that can start now.
 */
export function rankCandidates(profileInput, options = {}) {
  const nowMs = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const given = rawTaskOf(profileInput, options, nowMs);
  if (!given) return { task: null, selected: null, ranking: [], allCandidates: [] };
  const { fleet, usage, entries, policy, normalized } = fleetFor(options, nowMs);
  const pins = pinsOf(options, profileInput && profileInput.profile ? profileInput : null);
  const pinnedKey = pins.model ? canonicalModel(splitPinModelAndEffort(String(pins.model).trim()).modelPart, fleet.aliases, fleet.models, fleet.families) : null;
  const list = Array.isArray(options.candidateModels) && options.candidateModels.length > 0 ? options.candidateModels : defaultPool(fleet, pinnedKey);
  let task;
  try {
    task = normalizeTask(given.raw, { policy, routes: ROUTES, models: fleet.models, aliases: fleet.aliases });
  } catch (err) {
    if (!err.code) err.code = "invalid_caller_profile";
    throw err;
  }
  task.min_context_tokens = Number(options.minContextTokens || 0);
  const taskOpts = profileInput && profileInput.profile ? profileInput : null;
  const unhealthy = new Set();
  for (const m of options.unhealthyModels || []) {
    const key = healthKey(m, fleet.models, fleet.aliases, fleet.families);
    if (key) unhealthy.add(key);
    if (m) unhealthy.add(m);
  }
  const ctx = {
    policy,
    fleet,
    usage,
    now: nowMs,
    unavailable: new Set(options.unavailable || taskOpts?.unavailable || []),
    unhealthy,
    launch_failures: options.launchFailures || options.launch_failures || taskOpts?.launch_failures || null,
    bundles: {},
  };
  const all = expandBundles(list, fleet, entries);
  // Rows their `when` keeps out never compete, but a blocked route still says why.
  const outOfScope = [];
  for (const [id, b] of Object.entries(all)) {
    const failure = whenFailure(b, task);
    if (failure === null) ctx.bundles[id] = b;
    else outOfScope.push({ bundle: b, failure });
  }
  const worker = workerOf(given.continuity, ctx.bundles, fleet);
  if (worker) {
    task.worker = worker;
    if (task.coupling === "low") task.coupling = (given.continuity && given.continuity.coupling) || "medium";
  }
  let result = rank(task, ctx);
  // Metered last resort: only when no subscription bundle is eligible, re-rank with checked metered bundles admitted.
  if (result.eligible.length === 0 && result.candidates.some((c) => c.excluded.length === 1 && c.excluded[0] === METERED_LAST_RESORT)) {
    task.metered_fallback = true;
    ctx.bundles = Object.fromEntries(Object.entries(ctx.bundles).filter(([id]) => id in all));
    result = rank(task, ctx);
  }
  const { candidates, eligible, system } = result;
  // A row answers to the model and effort it runs, as the callers of a ranking read them.
  const decorate = (c) => {
    c.model = c.bundle.model;
    c.effort = c.bundle.effort;
    c.provider = c.bundle.provider;
    c.account = c.bundle.account;
    c.canonicalModel = canonicalOf(c.bundle.model, fleet);
  };
  candidates.forEach(decorate);
  // A gateway cannot wait for a window to renew: a candidate that can start only after its reset leaves the ranking unless the
  // caller allows the wait, and says so.
  const canWait = task.can_wait_hours;
  const ranking = eligible.filter((c) => (c.available_in_hours || 0) <= canWait);
  for (const c of eligible) {
    if ((c.available_in_hours || 0) > canWait) c.excluded.push(`can start only after its window resets in ${c.available_in_hours.toFixed(1)}h`);
  }
  for (const c of candidates) c.eligible = c.excluded.length === 0;
  const pinnedCand = task.pinned_bundle ? candidateForBundle(ranking, task.pinned_bundle) : null;
  const outRows = outOfScope.map(({ bundle, failure }) => ({
    id: bundle.id,
    model: bundle.model,
    effort: bundle.effort,
    provider: bundle.provider,
    account: bundle.account,
    canonicalModel: canonicalOf(bundle.model, fleet),
    bundle: { account: bundle.account, model: bundle.model, effort: bundle.effort },
    excluded: [failure],
    notes: [],
    components: {},
    score: null,
    non_quota_excluded: true,
    account_unavailable: false,
    eligible: false,
  }));
  return {
    task: {
      kind: task.kind,
      difficulty: task.difficulty,
      axis_demand: task.profile.axis_demand,
      wants_fast: task.wants_fast,
      read_only_review: task.read_only_review,
      profile: task.profile,
    },
    pin: { model: pins.model || null, effort: pins.effort || null, bundle: task.pinned_bundle || task.constraint_bundle || null },
    selected: pinnedCand || ranking[0] || null,
    ranking,
    allCandidates: [...candidates, ...outRows],
    system,
    ...(normalized ? { accounts: listQuotaAccounts(normalized) } : {}),
  };
}


// ---------------------------------------------------------------------------- pins of a host's options

const PIN_OPTIONS = [
  "pinnedBundle",
  "pinned_bundle",
  "constraintBundle",
  "constraint_bundle",
  "pinnedModel",
  "pinned_model",
  "constraintModel",
  "constraint_model",
  "pinnedEffort",
  "pinned_effort",
  "constraintEffort",
  "constraint_effort",
  "constraints",
];

/**
 * The user's pins among a host's own options, for `selectBestRoute`.
 */
export function pinOptionsOf(options = {}) {
  const pins = {};
  for (const key of PIN_OPTIONS) {
    if (options?.[key] !== undefined && options?.[key] !== null) pins[key] = options[key];
  }
  return pins;
}

/**
 * The pins of several sources, later ones winning field by field: plugin options, then a request's own. Without this a
 * request's `pinned_model` would lose to a plugin's `constraintModel`, whichever spelling `rankCandidates` reads first.
 */
export function mergePinOptions(...sources) {
  const merged = {};
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const c = source.constraints && typeof source.constraints === "object" ? source.constraints : {};
    const model = source.constraintModel || source.constraint_model || source.pinnedModel || source.pinned_model || c.model;
    const effort = source.constraintEffort || source.constraint_effort || source.pinnedEffort || source.pinned_effort || c.effort;
    const bundle = source.pinnedBundle || source.pinned_bundle || source.constraintBundle || source.constraint_bundle || c.bundle;
    if (model) {
      merged.constraintModel = model;
      // A later `model:effort` replaces an earlier effort rather than contradicting it.
      if (splitPinModelAndEffort(String(model).trim()).effortPart) delete merged.constraintEffort;
    }
    if (effort) merged.constraintEffort = effort;
    if (bundle) merged.pinnedBundle = bundle;
  }
  return merged;
}

/**
 * Remove a request's pin fields, which name nothing an upstream knows.
 */
export function dropPinFields(body) {
  if (!body || typeof body !== "object") return false;
  let dropped = false;
  for (const target of [body, body.task]) {
    if (!target || typeof target !== "object") continue;
    for (const key of PIN_OPTIONS) {
      if (key in target) {
        delete target[key];
        dropped = true;
      }
    }
  }
  return dropped;
}

/**
 * Whether these pins fix the effort, so nothing may ratchet it afterwards.
 */
export function pinsFixEffort(pins = {}) {
  if (pins.pinnedBundle || pins.constraintEffort) return true;
  return Boolean(pins.constraintModel && splitPinModelAndEffort(String(pins.constraintModel).trim()).effortPart);
}

/**
 * A configured candidate list: an object entry that names a `model` stays whole, with its provider, effort, efforts and
 * `when`; an object with no `model` is a model listing (`{ id }`), and a dictionary lists its keys.
 */
export function extractModelList(source) {
  if (!source) return null;
  if (Array.isArray(source)) {
    const list = source
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          if (typeof item.model === "string" && item.model.trim()) return { ...item };
          return String(item.id || item.name || "").trim();
        }
        return "";
      })
      .filter(Boolean);
    return list.length > 0 ? list : null;
  }
  if (typeof source === "object") {
    const keys = Object.keys(source)
      .map((k) => k.trim())
      .filter(Boolean);
    return keys.length > 0 ? keys : null;
  }
  return null;
}

/**
 * The candidate list a plugin's options or a request's context configure, or `null`.
 */
export function explicitCandidateModels(options = {}, ctx = {}) {
  return (
    extractModelList(options.candidateModels) ||
    extractModelList(options.allowedModels) ||
    extractModelList(options.availableModels) ||
    extractModelList(options.models) ||
    extractModelList(ctx?.models) ||
    extractModelList(ctx?.availableModels) ||
    extractModelList(options.modelMap)
  );
}

/**
 * The model a candidate entry names, without a `:effort` suffix.
 */
export function candidateModelName(entry) {
  return splitEffortSuffix(typeof entry === "string" ? entry : entry?.model || "").name;
}

// ---------------------------------------------------------------------------- a session held from an earlier turn

const fleetOfCatalog = (catalog) => fleetFor({ catalog: catalog || {} }, Date.now()).fleet;

/**
 * The rows a candidate list holds for this model name, with what each may run at (contract R2). Used on a route decided
 * elsewhere: a session held from an earlier turn, or a route another provider's list has to take.
 */
function rowsNaming(list, model, catalog, pins) {
  const fleet = fleetOfCatalog(catalog);
  const key = rowKeyOf(model, fleet);
  const pinnedName = pins?.constraintModel ? splitPinModelAndEffort(String(pins.constraintModel).trim()).modelPart : null;
  const pinnedKey = pinnedName ? rowKeyOf(pinnedName, fleet) : null;
  const pinnedEffort = pins?.constraintEffort ? lc(pins.constraintEffort) : pins?.constraintModel ? splitPinModelAndEffort(String(pins.constraintModel).trim()).effortPart : null;
  const rows = [];
  for (const entry of list || []) {
    // A bare entry of the pinned model runs at the effort the pin names, table or not: as a new route expands it.
    const same = pinnedKey !== null && rowKeyOf(entryModel(entry), fleet) === pinnedKey;
    const obj = typeof entry === "string" ? { model: entry } : entry;
    const given = same && pinnedEffort && !obj.effort && !Array.isArray(obj.efforts) && !nameFixesEffort(obj.model, fleet.models, fleet.aliases) ? { ...obj, effort: pinnedEffort } : entry;
    rows.push(...effortRows(given, fleet));
  }
  attachDisabledEfforts(rows, fleet);
  return { rows: rows.filter((row) => rowKeyOf(row.model, fleet) === key), fleet };
}

/** R2 for one row: dispatch table, within the row's own list, without what the user disabled. A row's own effort is what it runs. */
function rowOffers(row, effort, fleet) {
  if (row.disabled && !row.disabled_by_default) return false;
  if (row.disabled_efforts?.includes(effort)) return false;
  if (row.effort_fixed) return row.effort === effort;
  if (row.offered_efforts && !row.offered_efforts.includes(effort)) return false;
  if (effort === row.effort && !row.not_dispatchable) return true;
  // A row with no effort of its own (a family or unknown name, a fixed-effort model) runs as it is: nothing to step
  if (row.effort === null || row.effort === undefined) return true;
  const allowed = dispatchAllowedEfforts(row, fleet, row.model);
  return !allowed || allowed.includes(effort);
}

/**
 * Whether a candidate list offers this model at this effort (contract R2). A pool entry that fixes its effort (`m:high`,
 * `m-high`) or lists them (`{ model, efforts }`) offers those only. `{ model, effort }` is one bundle at its scoring effort and
 * may step within the dispatch table, as `allocator.py` has `own_efforts` None for it.
 */
export function candidateOffers(list, model, effort, catalog, pins) {
  const { rows, fleet } = rowsNaming(list, model, catalog, pins);
  return rows.some((row) => rowOffers(row, effort, fleet));
}

const DEPTH_FOR_DIFFICULTY = { routine: 1, hard: 2, coupled: 3, frontier: 4 };

/**
 * The effort a held session can stay on: its own while the pool offers it, else the highest one below that the pool does and
 * a new route for this `profile` would take (contract R2). `null` when there is none. A name the pool does not hold verbatim is
 * not this check's to judge: membership was settled by `gone`.
 */
export function heldEffortOn(list, model, effort, catalog, { pins, profile } = {}) {
  const { rows, fleet } = rowsNaming(list, model, catalog, pins);
  if (rows.length === 0) return effort;
  const offers = (candidate) => rows.some((row) => rowOffers(row, candidate, fleet));
  if (offers(effort)) return effort;
  const fullProfile = profile ? (profile.reasoning_depth ? profile : sessionProfile({ profile })) : null;
  const ranked = fullProfile ? rankCandidates(fullProfile, { candidateModels: list, catalog }).ranking : null;
  const key = rowKeyOf(model, fleet);
  const passes = (candidate) => !ranked || ranked.some((row) => rowKeyOf(row.model, fleet) === key && row.effort === candidate);
  const rank = EFFORT_ORDER.indexOf(effort);
  for (let i = rank - 1; i >= 0; i--) {
    if (offers(EFFORT_ORDER[i]) && passes(EFFORT_ORDER[i])) return EFFORT_ORDER[i];
  }
  return null;
}

/**
 * What a session was routed on: a hold and a route after it judge by this, not by what a short follow-up looks like. A session that
 * kept no profile gets the one its difficulty and demand imply; no field of it comes from a task's text.
 */
export function sessionProfile(sessionState) {
  if (sessionState?.profile?.reasoning_depth) return sessionState.profile;
  const kept = sessionState?.profile || {};
  const difficulty = kept.difficulty || sessionState?.difficulty || "routine";
  const demand = kept.axis_demand || sessionState?.axisDemand || {};
  const level = (axis) => (Number.isInteger(demand[axis]) && demand[axis] >= 0 && demand[axis] <= 3 ? demand[axis] : 0);
  const gui = Boolean(kept.needs_gui);
  return {
    work_kind: kept.work_kind || sessionState?.workKind || "other_or_mixed",
    reasoning_depth: DEPTH_FOR_DIFFICULTY[difficulty] || 1,
    code_complexity: level("coding"),
    needs_visual: Boolean(kept.needs_visual || level("tool_operation") >= 3),
    needs_gui: gui,
    local_only: Boolean(kept.local_only),
    wants_fast: false,
    read_only_review: false,
    access: "read-only",
    interaction_style: kept.interaction_style || "engineering",
    expected_hours: 0.5,
    hours_confidence: "medium",
    urgency: "unknown",
    multi_task: false,
    task_count: "1",
    axis_demand: { divergence: level("divergence"), coding: level("coding"), aesthetics: level("aesthetics"), tool_operation: level("tool_operation") },
  };
}

/** Says why a session that lost its effort was routed again. */
export function effortGoneWarning(cont) {
  return `${cont.previousModel}: effort ${cont.previousEffort} is no longer offered; routed again`;
}

/** The pool's row a held session runs on (`modeId`, `draws`, ...), at its held effort: one that offers it, on an account that does. */
export function heldBundle(list, model, effort, catalog, pins) {
  const { rows, fleet } = rowsNaming(list, model, catalog, pins);
  const offering = rows.filter((r) => rowOffers(r, effort, fleet));
  const row = offering.find((r) => r.effort === effort) || offering[0] || rows.find((r) => r.effort === effort) || rows[0];
  return row ? { ...row, effort } : null;
}

/** Whether a candidate list unchecks this effort on any of its models: a turn that knows no model yet cannot rely on it. */
export function effortUnchecked(list, effort, catalog) {
  const fleet = fleetOfCatalog(catalog);
  const rows = (list || []).flatMap((entry) => effortRows(entry, fleet));
  attachDisabledEfforts(rows, fleet);
  return rows.some((row) => row.disabled_efforts?.includes(effort));
}

/**
 * The model a hold sends the request to, as the candidate list names it: the store keeps models canonical (`claude-opus-5-5`), and
 * the bare name may resolve to another provider in Magpie than the `upstream/claude-opus-5-5` the session was routed to. The name
 * routed last (`target`) when it is still a candidate, else the one candidate of that row, else the model itself. A family
 * name never stands in for its flagship, or the other way round.
 */
export function heldTarget(model, sessionState, candidateModels, catalog) {
  if (!Array.isArray(candidateModels) || candidateModels.length === 0) return model;
  const names = candidateModels.map(candidateModelName);
  if (sessionState?.target && names.includes(sessionState.target)) return sessionState.target;
  const fleet = fleetOfCatalog(catalog);
  const key = healthKey(sessionState?.target || model, fleet.models, fleet.aliases, fleet.families);
  return names.find((m) => healthKey(m, fleet.models, fleet.aliases, fleet.families) === key) || model;
}


// ---------------------------------------------------------------------------- warnings and refusals

/** One line of why a row is out, naming the row. */
function excludedLine(candidate, why) {
  return why.startsWith(`${candidate.model}`) ? why : `${candidate.model}@${candidate.effort}: ${why}`;
}

/** Pool names routed on no row of their own: without this, a retired name just stops being picked. */
function poolNameWarnings(options, models, aliases) {
  if (!Array.isArray(options.candidateModels)) return [];
  const names = options.candidateModels.map((entry) => (typeof entry === "string" ? entry : entry?.model)).filter(Boolean);
  return [...new Set(names.map((name) => catalogNameWarning(name, models, aliases)).filter(Boolean))];
}

const MAX_LOGGED_NAME_WARNINGS = 1024;
const MAX_LOG_LINE = 16384;
const loggedNameWarnings = new Set();

/** Whether this name warning is new here. The least recently seen goes first: under `routeAllModels` a client can write names. */
function firstNameWarning(warning) {
  const seen = loggedNameWarnings.delete(warning);
  loggedNameWarnings.add(warning);
  if (loggedNameWarnings.size > MAX_LOGGED_NAME_WARNINGS) loggedNameWarnings.delete(loggedNameWarnings.values().next().value);
  return !seen;
}

/** One line whatever the model names in it hold: a reason can quote a row's name as the request wrote it. */
function logLine(warning) {
  return escapeControls(warning)
    .replace(/\S{129,}/g, (long) => `${long.slice(0, 128)}...`)
    .slice(0, MAX_LOG_LINE);
}

/** Log a route's warnings. A name warning is about the configuration, not this request: once per runtime. */
export function logRouteWarnings(warnings) {
  for (const warning of warnings || []) {
    if (warning.startsWith(CATALOG_NAME_WARNING) && !firstNameWarning(warning)) continue;
    console.warn(`agentcompass: ${logLine(warning)}`);
  }
}

/**
 * Why a pinned choice came back blocked (`warnings` of the decision).
 */
function blockedWarnings(result) {
  const label = pinLabel(result.pin);
  if (!label) {
    const reasons = [...new Set(result.allCandidates.flatMap((c) => c.excluded.map((reason) => excludedLine(c, reason))))];
    return [`no candidate is available${reasons.length > 0 ? `: ${reasons.join("; ")}` : ""}`];
  }
  const matching = rowsThePinNames(result);
  if (matching.length === 0) return [`${label} is not among the candidates`];
  const reasons = [...new Set(matching.flatMap((c) => c.excluded))];
  return [`${label} is unavailable: ${reasons.join("; ")}`];
}

/** How a blocked route refers to what was pinned, or `null` with no pin. */
function pinLabel(pin) {
  if (pin?.bundle) return `pinned bundle ${safeName(pin.bundle)}`;
  if (pin?.model) return `pinned model ${safeName(pin.model)}`;
  return pin?.effort ? `pinned effort ${safeName(pin.effort)}` : null;
}

function rowsThePinNames(result) {
  const notTheOne = (why) => why === "explicit model constraint" || why === "explicit bundle constraint";
  return result.allCandidates.filter((c) => !c.excluded.some(notTheOne));
}

const ACCOUNTS_UNAVAILABLE_REFUSAL = "accounts_unavailable: every candidate account is unavailable";

function allCandidatesAccountUnavailable(result) {
  const all = result.allCandidates;
  if (!Array.isArray(all) || all.length === 0) return false;
  const capable = all.filter((c) => !c.non_quota_excluded);
  return capable.length > 0 && capable.every((c) => c.account_unavailable === true);
}

/** What a client hears when a route is refused: what it pinned, a code, one sentence. The pool and its quotas stay in the local log. */
function refusalOf(result) {
  const { pin } = result;
  const label = pinLabel(pin);
  if (!label) {
    return allCandidatesAccountUnavailable(result)
      ? ACCOUNTS_UNAVAILABLE_REFUSAL
      : "no_route: no candidate can serve this request";
  }
  const matching = rowsThePinNames(result);
  if (matching.length === 0) return `pin_not_in_pool: ${label} is not among the candidates`;
  // Health belongs to a model: a row left out by its effort says nothing here, and an effort pin has no model to blame.
  const down = matching.some((c) => c.excluded.includes(MARKED_UNHEALTHY) && !c.excluded.includes(EFFORT_NOT_PINNED));
  if (pin.bundle && down) return `model_unhealthy: the model of ${label} is marked unhealthy`;
  if (!pin.bundle && pin.model && down) return `model_unhealthy: ${label} is marked unhealthy`;
  return `pin_unavailable: ${label} cannot serve this request`;
}

/** The refusal of a block with no decision behind it: its code and one sentence. */
export function blockedRefusal(blocked) {
  return blocked.refusal || `${blocked.error || "no_route"}: this request could not be routed`;
}

const PIN_REFUSALS = ["pin_not_in_pool", "model_unhealthy", "pin_unavailable"];

/** A refusal for any holder of a gateway key: whether a pinned name is in the pool or healthy is the operator's to know. */
export function refusalSummary(blocked) {
  const refusal = blockedRefusal(blocked);
  const colon = refusal.indexOf(": ");
  const code = refusal.slice(0, colon);
  return PIN_REFUSALS.includes(code)
    ? { code: "pin_unavailable", message: "the pinned model cannot serve this request" }
    : { code, message: refusal.slice(colon + 2) };
}

/** The quota the selected candidate draws on: its account and the window that prices it, or `null` when nothing is priced. */
function quotaOf(candidate) {
  const cap = candidate.capacity;
  if (!cap) return null;
  const account = candidate.bundle?.account;
  return {
    account: account && account !== GATEWAY_ACCOUNT ? account : null,
    window: cap.window ?? null,
    quota_source: cap.quota_source ?? null,
    expected_pct: candidate.expected_pct ?? null,
    chain_pct: candidate.chain_pct ?? null,
    cost: candidate.economy ? candidate.economy.cost : null,
    priced: Boolean(cap.priced),
  };
}

/**
 * Convenience entry point: takes a task profile (or a `{ profile }` wrapper) + options and returns the winning route decision.
 */
export function selectBestRoute(taskOrProfile, options = {}) {
  let result;
  try {
    result = rankCandidates(taskOrProfile, options);
  } catch (err) {
    if (err?.code !== "invalid_caller_profile" && !(err instanceof InvalidCallerProfile)) throw err;
    return {
      ok: false,
      blocked: true,
      error: "invalid_caller_profile",
      refusal: "invalid_caller_profile: the task profile is invalid",
      targetModel: null,
      canonicalModel: null,
      targetEffort: "high",
      modelWithEffort: null,
      warnings: [String(err.message)],
      excluded: [],
      topCandidates: [],
    };
  }
  if (!result.task) return unroutedDecision("no_task_profile");
  const top = result.selected;
  const catalog = options.catalog || {};
  const warnings = [
    ...(top ? [] : blockedWarnings(result)),
    ...(top ? (top.notes || []).filter((n) => n.startsWith("data error:")) : []),
    ...poolNameWarnings(options, catalog.models || MODELS, catalog.aliases || MODEL_ALIASES),
    ...new Set((result.accounts || []).flatMap((a) => a.warnings)),
  ];
  const refusal = top ? null : refusalOf(result);
  return {
    ok: Boolean(top),
    blocked: !top,
    ...(refusal === ACCOUNTS_UNAVAILABLE_REFUSAL ? { error: "accounts_unavailable" } : {}),
    refusal,
    targetModel: top ? top.model : null,
    canonicalModel: top ? top.canonicalModel : null,
    // A row with no effort of its own (a family or unknown name, a model with one configuration) is sent at the nominal "high".
    targetEffort: top ? top.effort || "high" : "high",
    modelWithEffort: top ? `${top.model}:${top.effort || "high"}` : null,
    bundle: top ? top.bundle : null,
    selectedAccount: top ? quotaOf(top)?.account || null : null,
    quota: top ? quotaOf(top) : null,
    workKind: result.task.kind,
    difficulty: result.task.difficulty,
    axisDemand: result.task.axis_demand,
    warnings,
    excluded: result.allCandidates.flatMap((c) => c.excluded.map((reason) => excludedLine(c, reason))),
    ...(result.accounts ? { accounts: result.accounts } : {}),
    score: top ? top.score : null,
    components: top ? top.components : null,
    profile: result.task.profile,
    topCandidates: result.ranking.slice(0, 5).map((r) => ({
      id: r.id,
      model: r.model,
      effort: r.effort,
      score: r.score,
      quota: quotaOf(r),
      components: r.components,
    })),
  };
}
