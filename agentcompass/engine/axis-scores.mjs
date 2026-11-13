// Vendored from akiiwa-games/magpie-agentcompass-router src/axis-scores.js at ac494f31dda6dc516e985594208e28fca85aa5fb (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Four-category (five-axis) scoring (`axis_scores.py`): the category scores of a model, the demand of a task, the panel targets
 * and the fit. The formulas are defined once in AgentCompass's `docs/technical-reference.md` section 1:
 *
 *   fit        = sum_a w_a * (min(z_a, c_a) - t1_a) / sum_a w_a      (panel standard deviations; t1 = the panel's weakest)
 *   cap c_a    = the level's target at demand levels 1 and 2; the category's ceiling at level 3
 *   continuity = max positive (t3 - t2) among the demanded categories when coupling == "high"
 *   score N    = fit + continuity + boost - quota_cost
 *
 * Nothing here reads a task's text; the classifier states how much the task needs (0..3) of `divergence`, `coding`,
 * `aesthetics` and `tool_operation` (`axis_demand`).
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

import { MODELS, MODEL_ALIASES, SCORING_POLICY, pyRound } from "./catalog.mjs";
import { FIVE_AXIS_ANCHOR, FIVE_AXIS_MODELS, MAINTAINER_SCORES } from "./reference-data.mjs";
import { CATEGORIES, TOOL_LEVEL_FACETS, applyOverlay, validateScores } from "./user-scores.mjs";

export const FIVE_AXES = CATEGORIES;
export { TOOL_LEVEL_FACETS };
/** `tool_operation` at this level must read images: a text-only model leaves the task. */
export const IMAGE_INPUT_LEVEL = 3;
export const FIVE_AXIS_DEFAULTS = {
  // Fit and continuity are both in panel standard deviations: one unit each, not a hand-set trade-off.
  weights: { fit: 1.0, continuity: 1.0 },
  demanded_level: 1, // rule B: a category demanded at this level or above must have data
};

/** What each demand level 0..3 means per category: the one text the classifier schema and the Jev questions are built from. */
export const FIVE_AXIS_DEMAND_LEVELS = {
  divergence: [
    "Divergent work: creative writing, brainstorming, research synthesis and data analysis, and decomposing a problem from first principles outside the existing architecture.",
    [
      "execute a known spec or checklist",
      "small judgment calls or wording choices",
      "several options or hypotheses to generate and compare, or a research or data-analysis question to investigate and synthesize",
      "open-ended creative writing, open research synthesis across many sources, or a first-principles redesign outside the existing architecture",
    ],
  ],
  coding: [
    "Coding ability: reading, writing, reviewing and changing code correctly, doing exactly what was asked and reporting it honestly.",
    [
      "no code read or written",
      "a small script or config change, or a result a test verifies",
      "a production module with its tests, or a review or audit of one",
      "changes across coupled modules, concurrency, protocol or core-library work, a whole-system review or audit, or a defect would be costly or irreversible",
    ],
  ],
  aesthetics: [
    "Visual and design judgment: GUI and interaction design, layout and typesetting, tables and charts, 2D or 3D modeling.",
    [
      "no visual output",
      "plain output where only tidy formatting matters",
      "a user-facing screen, page, chart or document whose look matters",
      "design-led work: a new interface or interaction, a visual identity, a 3D scene or model",
    ],
  ],
  tool_operation: [
    "Operating tools fast: per-turn speed inside a tool loop, and reading images. Writing or fixing software about real-time systems is coding, not a live loop.",
    [
      "reads files and runs a few shell commands",
      "routine tool or API calls",
      "heavy tool or API orchestration, or the worker itself stays inside a live external system (a game, a ticket queue, an order book, a live page or chat) where slow turns degrade the outcome",
      "must read images or screenshots inside the loop, or operate a desktop or browser GUI through screenshots",
    ],
  ],
};

export const FIVE_AXIS_DEMAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...FIVE_AXES],
  description:
    "How much the task needs each capability category of the model, 0..3. Economy is not a task demand: the router prices it from cost and live quota.",
  properties: Object.fromEntries(
    Object.entries(FIVE_AXIS_DEMAND_LEVELS).map(([axis, [intro, levels]]) => [
      axis,
      {
        type: "integer",
        minimum: 0,
        maximum: 3,
        description: `${intro} ${levels.map((text, i) => `${i} = ${text}`).join("; ")}.`,
      },
    ]),
  ),
};

export function fiveAxisConfig(policy) {
  const raw = policy && typeof policy.five_axis === "object" && policy.five_axis ? policy.five_axis : {};
  return { ...FIVE_AXIS_DEFAULTS, ...raw, weights: { ...FIVE_AXIS_DEFAULTS.weights, ...(raw.weights || {}) } };
}

/** The classifier's `axis_demand`, every category an integer 0..3, or an `Error`. */
export function validateAxisDemand(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== FIVE_AXES.length || !FIVE_AXES.every((a) => a in raw)) {
    throw new Error(`task.profile.axis_demand must give exactly ${FIVE_AXES.join(", ")}`);
  }
  const out = {};
  for (const axis of FIVE_AXES) {
    const value = raw[axis];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 3) {
      throw new Error(`task.profile.axis_demand.${axis} must be an integer from 0 to 3`);
    }
    out[axis] = value;
  }
  return out;
}

/** `{ category: level 0..3 }`: the profile's `axis_demand` as it stands. An all-zero answer asks nothing: the economy decides. */
export function fiveAxisDemand(task) {
  return { ...task.profile.axis_demand };
}

const isNumber = (value) => typeof value === "number" && Number.isFinite(value) && typeof value !== "boolean";
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// ---------------------------------------------------------------------------- the model rows with their scores

/**
 * The catalogue's model rows with `five_axis` attached (`five_axis_overlay`): the category cells, `missing`, `estimates`, tier,
 * image input, fast mode and duration of `five-axis-scores.json`, the cited `usd_per_hour` (an unsourced one is removed, never
 * defaulted), then the maintainer's manual scores and, when given, the operator's own (`userScores`).
 */
export function scoredModels({ models = MODELS, aliases = MODEL_ALIASES, userScores = null } = {}) {
  const local = validateScores(userScores, "user");
  const out = {};
  for (const [name, row] of Object.entries(models)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const info = clone(row);
    const five = FIVE_AXIS_MODELS[name];
    const cats = (five && five.categories) || {};
    const usd = five ? five.usd_per_hour : null;
    info.five_axis = {
      categories: Object.fromEntries(FIVE_AXES.filter((a) => cats[a] && typeof cats[a] === "object").map((a) => [a, clone(cats[a])])),
      scores: Object.fromEntries(FIVE_AXES.map((a) => [a, (cats[a] || {}).value ?? null])),
      missing: five ? [...(five.missing || [])] : [...FIVE_AXES],
      estimates: five ? clone(five.estimates || {}) : {},
      axis_status: Object.fromEntries(FIVE_AXES.map((a) => [a, (cats[a] || {}).status || "missing"])),
      tier: five ? clone(five.tier) : { value: null, method: "none" },
      usd_status: usd !== null && usd !== undefined ? "ok" : "missing",
      image_input: five ? clone(five.image_input) : { status: "missing" },
      fast_mode: five ? clone(five.fast_mode) : { status: "not_offered" },
      duration: five ? clone(five.duration) : {},
    };
    if (usd !== null && usd !== undefined) info.usd_per_hour = usd;
    else delete info.usd_per_hour;
    out[name] = info;
  }
  applyOverlay(out, FIVE_AXIS_ANCHOR.targets, { publicScores: MAINTAINER_SCORES, localScores: local, aliases });
  for (const info of Object.values(out)) {
    if (info && info.five_axis) info.five_axis.shares = fiveAxisShares(fiveAxisValues(info.five_axis, "high"), FIVE_AXIS_ANCHOR.targets);
  }
  return out;
}

let defaultScored = null;
/** `scoredModels()` of the shipped catalogue, built once. */
export function defaultScoredModels() {
  return (defaultScored ||= scoredModels());
}

// ---------------------------------------------------------------------------- values, targets and fit

/** A score cell's value at `effort`: its `by_effort` entry, a bundle that names no effort running its single configuration. */
export function atEffort(cell, effort) {
  if (!cell || typeof cell !== "object") return null;
  if (cell.by_effort && typeof cell.by_effort === "object") {
    const by = cell.by_effort;
    if (Object.keys(by).length === 0) return null;
    const value = effort ? by[effort] : "high" in by ? by.high : cell.value;
    return value === undefined || value === null ? null : Number(value);
  }
  return cell.value === undefined || cell.value === null ? null : Number(cell.value);
}

/** `{ category: z }`, with `tool_operation` as `{ facet: z }`: this model's panel standard scores at `effort` (null where none). */
export function fiveAxisValues(state, effort) {
  const cats = (state && state.categories) || {};
  const out = {};
  for (const a of FIVE_AXES) if (a !== "tool_operation") out[a] = atEffort(cats[a], effort);
  const facets = ((cats.tool_operation || {}).facets) || {};
  out.tool_operation = Object.fromEntries(TOOL_LEVEL_FACETS[3].map((f) => [f, atEffort(facets[f], effort)]));
  return out;
}

/** `{ category: the demanded level's target row }` for every demanded category that asks for something. */
export function fiveAxisTargets(demand, targets) {
  const rowOf = (r, w) => ({ target: r.target, zero: r.zero, cap: w === 3 ? r.ceiling.value : r.target });
  const out = {};
  for (const [a, w] of Object.entries(demand)) {
    if (w <= 0) continue;
    const row = (((targets[a] || {}).levels || {})[String(w)]) || {};
    if (a === "tool_operation") {
      if (row.by_facet && Object.keys(row.by_facet).length > 0) out[a] = { by_facet: Object.fromEntries(Object.entries(row.by_facet).map(([f, r]) => [f, rowOf(r, w)])) };
    } else if (row.target !== undefined && row.target !== null) {
      out[a] = rowOf(row, w);
    }
  }
  return out;
}

/** `[fit, { category: row }]`: the demand-weighted mean of `min(z, cap) - zero` over the demanded categories. */
export function fiveAxisFit(values, demand, targets) {
  const rows = {};
  let value = 0.0;
  let total = 0;
  for (const [a, w] of Object.entries(demand)) {
    const tgt = targets[a];
    if (w <= 0 || !tgt) continue;
    let term;
    if ("by_facet" in tgt) {
      const parts = {};
      for (const [f, t] of Object.entries(tgt.by_facet)) {
        const z = (values[a] || {})[f];
        const z_ = z === undefined ? null : z;
        parts[f] = {
          score: z_ === null ? null : pyRound(z_, 4),
          target: t.target,
          zero: t.zero,
          cap: t.cap,
          term: pyRound(z_ !== null ? Math.min(z_, t.cap) - t.zero : 0.0, 4),
        };
      }
      const scored = Object.values(parts);
      term = Math.min(...scored.map((p) => p.term));
      rows[a] = {
        demand: w,
        facets: parts,
        term,
        shortfall: pyRound(Math.max(...scored.map((p) => (p.score !== null ? Math.max(0.0, p.target - p.score) : p.target - p.zero))), 4),
      };
    } else {
      const z = values[a] === undefined ? null : values[a];
      term = pyRound(z !== null ? Math.min(z, tgt.cap) - tgt.zero : 0.0, 4);
      rows[a] = {
        demand: w,
        score: z === null ? null : pyRound(z, 4),
        target: tgt.target,
        zero: tgt.zero,
        cap: tgt.cap,
        term,
        shortfall: pyRound(z !== null ? Math.max(0.0, tgt.target - z) : tgt.target - tgt.zero, 4),
      };
    }
    value += w * term;
    total += w;
  }
  return [total ? value / total : 0.0, rows];
}

/** `{ category: { above_anchor, ceiling, model } }` for the categories `rows` demand at level 3: the credit above the anchor. */
export function fiveAxisHeadroom(rows, targets) {
  const out = {};
  for (const [a, r0] of Object.entries(rows)) {
    if (r0.demand !== 3) continue;
    const level3 = (((targets[a] || {}).levels || {})["3"]) || {};
    let r = r0;
    let ceiling;
    let facet = {};
    if ("facets" in r0) {
      const [f, part] = Object.entries(r0.facets).reduce((best, cur) => (cur[1].term < best[1].term ? cur : best));
      r = part;
      ceiling = level3.by_facet[f].ceiling;
      facet = { facet: f };
    } else {
      ceiling = level3.ceiling;
    }
    const z = r.score;
    out[a] = {
      above_anchor: z === null ? null : pyRound(Math.max(0.0, Math.min(z, ceiling.value)), 4),
      ceiling: ceiling.value,
      model: ceiling.model,
      ...facet,
    };
  }
  return out;
}

/** `{ category: 0..1 }` for display: `(min(z, t3) - t1) / (t3 - t1)`, 0 at the panel's weakest and 1 at the anchor. */
export function fiveAxisShares(values, targets) {
  const share = (z, row) => {
    if (z === null || z === undefined || !row || row.target === undefined || row.target === null || row.target <= row.zero) return null;
    return pyRound(Math.max(0.0, (Math.min(z, row.target) - row.zero) / (row.target - row.zero)), 4);
  };
  const out = {};
  for (const a of FIVE_AXES) {
    const level3 = (((targets[a] || {}).levels || {})["3"]) || {};
    if (a === "tool_operation") {
      const parts = Object.entries(level3.by_facet || {}).map(([f, r]) => share((values[a] || {})[f], r));
      out[a] = parts.length > 0 && parts.every((p) => p !== null) ? Math.min(...parts) : null;
    } else {
      out[a] = share(values[a], level3);
    }
  }
  return out;
}

/** The demand-weighted mean of the candidate's scores over the demanded categories, uncapped: the last tie-break. */
export function fiveAxisLevel(rows) {
  let total = 0;
  let value = 0.0;
  for (const r of Object.values(rows)) {
    const z = "facets" in r ? Math.min(...Object.values(r.facets).map((p) => (p.score !== null ? p.score : p.zero))) : r.score !== null ? r.score : r.zero;
    value += r.demand * z;
    total += r.demand;
  }
  return total ? value / total : 0.0;
}

/** One demand level's worth of continuing a related worker: the largest positive `t3 - t2` among the demanded categories. */
export function fiveAxisContinuityValue(demand, targets) {
  const gaps = Object.entries(demand)
    .filter(([, w]) => w >= 1)
    .map(([a]) => (targets[a] || {}).continuity);
  return Math.max(0.0, ...gaps.filter((g) => isNumber(g) && g > 0));
}

export { FIVE_AXIS_ANCHOR, SCORING_POLICY };
