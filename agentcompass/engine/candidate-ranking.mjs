// Vendored from akiiwa-games/magpie-agentcompass-router src/candidate-ranking.js at 35a7aea5b6bc4028bb78c460482b6d3ad8708948 (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Ranking and ordering of evaluated candidates (`candidate_ranking.py`).
 *
 * Net score N = fit + continuity (both in panel standard deviations) + a temporary boost - the economy's cost (already in
 * score units); no normalization over the candidate set. Not carried: the harness order (the gateway has no harness; every
 * candidate's `harness_place` is 0).
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

import { pyRound } from "./catalog.mjs";
import { fiveAxisConfig, fiveAxisContinuityValue, fiveAxisDemand, fiveAxisTargets } from "./axis-scores.mjs";
import { FIVE_AXIS_ANCHOR } from "./reference-data.mjs";
import { evaluateBundle, namedEffortBundles } from "./candidate-eval.mjs";
import { applyFiveAxisEconomy } from "./quota-economy.mjs";

export const FIVE_AXIS_ORDER_KEYS = ["net_score", "wait_hours", "completion_hours", "usd", "axis_level", "harness_place"];

/**
 * Lexicographic order, in tuple order: 1. net score descending (exact float, never rounded: the quota economy is a term of N, never
 * a tie-break); 2. wait before the start ascending; 3. faster completion (wait + expected hours) ascending; 4. fewer list-price
 * USD ascending; 5. demand-weighted category level descending, then sibling harness place ascending.
 */
export function fiveAxisOrder(candidate) {
  const k = candidate.components;
  const waitH = Number(candidate.available_in_hours || 0.0);
  const doneKey = pyRound(waitH + Number(candidate.duration_hours), 4);
  const usd = Number(candidate.expected_usd !== null && candidate.expected_usd !== undefined ? candidate.expected_usd : Number.POSITIVE_INFINITY);
  return [-Number(candidate.score), pyRound(waitH, 4), doneKey, pyRound(usd, 4), -pyRound(Number(k.five_axis_level || 0.0), 4), k.harness_place || 0];
}

export function compareOrder(a, b) {
  const x = fiveAxisOrder(a);
  const y = fiveAxisOrder(b);
  for (let i = 0; i < x.length; i++) {
    if (x[i] < y[i]) return -1;
    if (x[i] > y[i]) return 1;
  }
  return 0;
}

/** The name of the first key of `fiveAxisOrder` on which `first` beats `second` ("tie" when none does). */
export function fiveAxisDecidingKey(first, second) {
  const x = fiveAxisOrder(first);
  const y = fiveAxisOrder(second);
  for (let i = 0; i < FIVE_AXIS_ORDER_KEYS.length; i++) if (x[i] !== y[i]) return FIVE_AXIS_ORDER_KEYS[i];
  return "tie";
}

/** The ranking row for a bundle id: `<id>` is the row itself; a row built from a bundle entry also answers to its `base_id`. */
export function candidateForBundle(rows, bundleId) {
  return rows.find((c) => c.id === bundleId) || rows.find((c) => c.base_id === bundleId) || null;
}

/**
 * `{ candidates, eligible, system }`: every bundle evaluated, the eligible ones ordered, and the economy's per-window report.
 * `ctx`: `{ policy, fleet, usage, now, unavailable, unhealthy, bundles, launch_failures }`.
 */
export function rank(taskIn, ctx) {
  const { policy, fleet } = ctx;
  const poolBundles = { ...ctx.bundles }; // the catalogue, before a task-named effort adds bundles to it
  Object.assign(ctx.bundles, namedEffortBundles(taskIn, ctx));
  const five = (ctx.five_axis = fiveAxisConfig(policy));
  ctx.targets = FIVE_AXIS_ANCHOR.targets;
  const demand = fiveAxisDemand(taskIn);
  const task = {
    ...taskIn,
    five_axis_demand: demand,
    five_axis_targets: fiveAxisTargets(demand, ctx.targets),
    five_axis_continuity: fiveAxisContinuityValue(demand, ctx.targets),
  };
  const candidates = Object.values(ctx.bundles).map((b) => evaluateBundle(b, task, ctx));
  // When `--model` is named without `--effort` (and no bundle is pinned), never let an unscored effort beat a scored effort of
  // the same model via a silent 0.0 default. Only when ALL eligible candidates lack trusted scores do they proceed together as
  // an explicit `unscored_named_dispatch` with `fit = null`.
  if (task.constraint_model && !task.constraint_effort && !task.pinned_bundle) {
    const eligNow = candidates.filter((c) => c.excluded.length === 0);
    if (eligNow.some((c) => !c._five_blind_msg)) {
      for (const c of eligNow) {
        const msg = c._five_blind_msg;
        if (!msg) continue;
        const blindNote = `data error: ${msg}; dispatched because it was named`;
        c.notes = c.notes.filter((n) => n !== blindNote);
        if (c.data_errors) {
          c.data_errors = c.data_errors.filter((e) => e !== msg);
          if (c.data_errors.length === 0) delete c.data_errors;
        }
        c.excluded.push(`data error: ${msg} (excluded because another effort of ${task.constraint_model} has trusted data)`);
      }
    }
  }
  for (const c of candidates) {
    if (c.excluded.length === 0 && c._five_blind_msg) {
      c.components.fit = null;
      c.components.unscored_named_dispatch = true;
      c.unscored_named_dispatch = true;
    }
  }
  const eligible = candidates.filter((c) => c.excluded.length === 0);
  const poolTask = {
    ...task,
    local_only: false,
    outbound_ok: null,
    file_transfer: false,
    needs_visual: false,
    needs_gui: false,
    wants_fast: false,
    read_only_review: false,
    constraint_model: null,
    constraint_effort: null,
    pinned_bundle: null,
    min_context_tokens: 0,
    metered_ok: true,
    metered_fallback: false,
    disable_fast: false,
    force_fast: false,
    _economy_pool: true,
  };
  const pool = Object.values(poolBundles)
    .map((b) => evaluateBundle(b, poolTask, ctx))
    .filter((c) => c.excluded.length === 0);
  const quotaWindows = applyFiveAxisEconomy(candidates, eligible, task, fleet, policy, pool);
  const weights = { ...five.weights };
  for (const c of eligible) {
    let raw = 0;
    for (const k of Object.keys(weights)) raw += weights[k] * (c.components[k] === null || c.components[k] === undefined ? 0.0 : c.components[k]);
    raw = raw + (c.components.boost || 0) - c.components.opportunity_cost;
    // Evaluate at IEEE-754 unit scale so F = 0 has the same ~2.2e-16 float64 resolution as F > 0 (shift invariance).
    c.score = Number(1.0 + raw) - 1.0;
  }
  for (const c of eligible) c.components.harness_place = 0;
  eligible.sort(compareOrder);
  eligible.forEach((c, i) => {
    c.components.decided_by = i + 1 < eligible.length ? fiveAxisDecidingKey(c, eligible[i + 1]) : "only_candidate";
  });
  const system = { weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, pyRound(v, 3)])), quota_windows: quotaWindows };
  return { candidates, eligible, system, task };
}
