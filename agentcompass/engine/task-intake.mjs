// Vendored from akiiwa-games/magpie-agentcompass-router src/task-intake.js at ac494f31dda6dc516e985594208e28fca85aa5fb (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * The task as the allocator sees it (`task_intake.py`): its route kind, modality needs, named pins, hours and chain. The profile
 * itself (schema, validation) lives in `profiler-core.js`; nothing here reads a task's text.
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

import { DIFFICULTY_ORDER, DIRECT_SOURCES, ROUTES, SCORING_POLICY, resolveModel, splitEffortSuffix } from "./catalog.mjs";
import { PROFILE_KINDS, validateProfile } from "./profiler.mjs";

export const COUPLINGS = ["low", "medium", "high"]; // chain.coupling; high is a related task that continues its worker
export const GENERIC_CALLER_KINDS = [null, undefined, "general_implementation", "tool_execution", "debug_review", "other_or_mixed"];

export class InvalidCallerProfile extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidCallerProfile";
    this.code = "invalid_caller_profile";
  }
}

/** A profile the caller wrote, checked like the classifier's; a failure is the caller's, not a retry. */
export function validateCallerProfile(raw) {
  try {
    return validateProfile(raw);
  } catch (err) {
    throw new InvalidCallerProfile(`invalid_caller_profile: ${err.message}`);
  }
}

/** The display label of a profile's reasoning depth (`profile.difficulty_by_depth`): nothing scores on it. */
export function profileDifficulty(profile, policy = SCORING_POLICY) {
  return policy.profile.difficulty_by_depth[String(profile.reasoning_depth)];
}

/** A classifier route other than the unmatched bucket; null when the profile did not name one. */
export function namedRoute(profile) {
  if (!profile || typeof profile !== "object") return null;
  const named = profile.work_kind;
  return PROFILE_KINDS.includes(named) && named !== "other_or_mixed" ? named : null;
}

/** The route a profile implies when the caller named none. */
export function profileKind(profile, policy = SCORING_POLICY) {
  const named = namedRoute(profile);
  if (named) return named;
  if (profile.needs_gui) return "computer_use";
  if (profile.needs_visual && profile.code_complexity === 0 && profile.interaction_style !== "text_only") return "visual_analysis";
  if (profile.interaction_style === "engineering" && profile.code_complexity === 0) return "tool_execution";
  return ((policy.profile || {}).kind_by_style || {})[profile.interaction_style] || "other_or_mixed";
}

/** The route the allocator uses: the caller's work_kind, else the profile's. */
export function taskKind(task, routes = ROUTES, policy = SCORING_POLICY) {
  if (!task || typeof task !== "object") return "other_or_mixed";
  const prof = task.profile && typeof task.profile === "object" ? task.profile : null;
  const caller = task.work_kind;
  const named = namedRoute(prof);
  if (named && named in routes && (caller === null || caller === undefined || caller === named)) return named;
  if (prof && prof.needs_gui && GENERIC_CALLER_KINDS.includes(caller) && named === null) return "computer_use";
  if (caller in routes) return task.work_kind;
  if (!task.work_kind && prof !== null) {
    try {
      const kind = profileKind(validateProfile(prof), policy);
      return kind in routes ? kind : "other_or_mixed";
    } catch {
      return "other_or_mixed";
    }
  }
  return "other_or_mixed";
}

const flagPresent = (mapping, key) => Boolean(mapping) && typeof mapping === "object" && key in mapping && mapping[key] !== null && mapping[key] !== undefined;

/** Resolve visual and local_only: a caller's explicit true or false wins; the profile fills what the caller left unset. */
export function resolveModalityNeeds(needs, profile, implies) {
  needs = needs && typeof needs === "object" ? needs : {};
  profile = profile && typeof profile === "object" ? profile : null;
  implies = implies && typeof implies === "object" ? implies : {};
  let visual;
  if (flagPresent(needs, "visual")) visual = Boolean(needs.visual);
  else if (profile !== null && (flagPresent(profile, "needs_visual") || flagPresent(profile, "needs_gui"))) visual = Boolean(profile.needs_visual || profile.needs_gui);
  else visual = Boolean(implies.visual);
  if (profile !== null && profile.needs_gui && !flagPresent(needs, "visual")) visual = true;
  let localOnly;
  if (flagPresent(needs, "local_only")) localOnly = Boolean(needs.local_only);
  else if (profile !== null && flagPresent(profile, "local_only")) localOnly = Boolean(profile.local_only);
  else localOnly = Boolean(implies.local_only);
  return { visual, local_only: localOnly };
}

/**
 * `[model the user named, effort the user named]` from the constraints or the pinned_* request fields. The effort comes from its
 * own field, else from the name (`model:effort`). A name only a family guess could place stays itself: naming gemini-2.5-pro
 * never launches the flagship the family folds to.
 */
export function namedPin(constraints, task, models, aliases) {
  let effort = constraints.effort || task.pinned_effort;
  effort = typeof effort === "string" && effort.trim() ? effort.trim().toLowerCase() : null;
  const raw = constraints.model || task.pinned_model;
  if (!raw) return [constraints.bundle || null, effort];
  const resolved = resolveModel(String(raw), models, aliases);
  const name = DIRECT_SOURCES.includes(resolved.source) ? resolved.key : splitEffortSuffix(String(raw)).name;
  return [name, effort || resolved.effort || null];
}

/** The task the allocator works on, from the caller's wrapper (`{ profile, constraints, chain, ... }`). */
export function normalizeTask(raw, { policy = SCORING_POLICY, routes = ROUTES, models, aliases } = {}) {
  const task = { ...(raw || {}) };
  let profile = task.profile !== undefined && task.profile !== null ? validateCallerProfile(task.profile) : null;
  const needs = task.needs && typeof task.needs === "object" && !Array.isArray(task.needs) ? { ...task.needs } : {};
  for (const [flag, field] of [
    ["gui", "needs_gui"],
    ["visual", "needs_visual"],
    ["local_only", "local_only"],
  ]) {
    if (!flagPresent(needs, flag) && flagPresent(task, field)) needs[flag] = Boolean(task[field]);
  }
  let wantsFast;
  if (flagPresent(needs, "fast")) wantsFast = Boolean(needs.fast);
  else if (flagPresent(task, "fast")) wantsFast = Boolean(task.fast);
  else if (flagPresent(task, "wants_fast")) wantsFast = Boolean(task.wants_fast);
  else if (profile !== null && "wants_fast" in profile) wantsFast = Boolean(profile.wants_fast);
  else wantsFast = false;
  let readOnlyReview;
  if (flagPresent(needs, "read_only_review")) readOnlyReview = Boolean(needs.read_only_review);
  else if (flagPresent(task, "read_only_review")) readOnlyReview = Boolean(task.read_only_review);
  else if (profile !== null && "read_only_review" in profile) readOnlyReview = Boolean(profile.read_only_review);
  else readOnlyReview = false;
  if (profile === null) throw new InvalidCallerProfile("task.profile is required: the classifier always produces it, with its axis_demand");
  profile = { ...profile, wants_fast: wantsFast, read_only_review: readOnlyReview };
  const kind = taskKind({ ...task, profile }, routes, policy);
  const derived = profileDifficulty(profile, policy);
  const difficulty = task.difficulty || derived;
  const difficultySource = task.difficulty ? "caller" : "profile";
  if (!DIFFICULTY_ORDER.includes(difficulty)) throw new Error(`difficulty must be one of ${DIFFICULTY_ORDER.join(", ")}`);
  const chain = task.chain && typeof task.chain === "object" ? task.chain : {};
  const coupling = chain.coupling || "low";
  if (!COUPLINGS.includes(coupling)) throw new Error("chain.coupling must be low, medium or high");
  if (!(task.expected_hours || profile.expected_hours)) {
    throw new Error("expected_hours is required: the caller gives it or the classifier estimates it in task.profile");
  }
  const hours = Number(task.expected_hours || profile.expected_hours);
  const constraints = task.constraints && typeof task.constraints === "object" ? task.constraints : {};
  const [constraintModel, constraintEffort] = namedPin(constraints, task, models, aliases);
  const implies = (routes[kind] || {}).implies || {};
  Object.assign(needs, resolveModalityNeeds(needs, profile, implies));
  const worker = chain.worker && typeof chain.worker === "object" ? { ...chain.worker } : null;
  let needsGui;
  if (flagPresent(needs, "gui")) needsGui = Boolean(needs.gui);
  else if (flagPresent(task, "needs_gui")) needsGui = Boolean(task.needs_gui);
  else if (flagPresent(profile, "needs_gui")) needsGui = Boolean(profile.needs_gui);
  else needsGui = kind === "computer_use";
  return {
    kind,
    difficulty,
    difficulty_source: difficultySource,
    hours,
    profile,
    profile_difficulty: derived,
    needs_gui: needsGui,
    wants_fast: wantsFast,
    read_only_review: readOnlyReview,
    force_fast: Boolean(task.force_fast || needs.force_fast),
    disable_fast: Boolean(task.disable_fast || needs.disable_fast),
    pinned_bundle: task.pinned_bundle || null,
    chain_hours: Number(chain.total_hours || hours),
    coupling,
    worker,
    handoff_ready: Boolean(chain.handoff_ready),
    needs_visual: needs.visual,
    local_only: Boolean(needs.local_only),
    file_transfer: Boolean(needs.file_transfer),
    outbound_ok: needs.outbound_ok === undefined ? null : needs.outbound_ok,
    constraint_bundle: typeof constraints.bundle === "string" ? constraints.bundle : null,
    constraint_model: constraintModel,
    constraint_effort: constraintEffort,
    metered_ok: Boolean(task.metered_ok),
    include_unverified: Boolean(task.include_unverified),
    can_wait_hours: Number(task.can_wait_hours || 0),
    chain_id: chain.id || null,
    cwd: task.cwd || null,
  };
}
