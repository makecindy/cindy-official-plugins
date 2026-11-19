// Vendored from akiiwa-games/magpie-agentcompass-router src/user-scores.js at ef542848af95d2b3278c4ca43a81cf0e0673c5d7 (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Manual capability scores (`user_scores.py`, schema 4): a maintainer layer (`MAINTAINER_SCORES`, from AgentCompass's
 * `references/user-scores.json`) and an operator's own layer (the plugin option `userScores`), both on the demand-level scale
 * mapped onto the panel's z-scale through the facet's targets: `1` = the panel's weakest (`t1`), `2` = the panel median (`t2`),
 * `3` = the panel's best (`t3`), linear between them and beyond them (a level above 3 is above the panel's best). Precedence:
 * `local user > maintainer > measured > estimated`.
 *
 * An operator's `userScores` written for an earlier schema is carried into schema 4 by the same steps AgentCompass applies to a
 * local file (`LOCAL_UPGRADES`): schema 1 (plugin 0.2.x, AgentCompass through v0.6.6; a table without `schema_version` is that
 * shape) names the first category `divergence`; schema 2 had level 3 = the anchor (the declared conversion of
 * `references/level-3-conversion.json`, `LEVEL3_CONVERSIONS`, moves those levels onto the current scale); schema 3 (plugin 0.3.0,
 * AgentCompass v0.7.0) keyed a score by the name the operator wrote, and a name v0.7.0 resolved through an alias this release
 * removed or re-targeted (`released-names.js`) moves to the row v0.7.0 meant. A score whose name resolves to no row is kept in the
 * table and ignored, never made a row.
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

import { makerDefault, pyRound } from "./catalog.mjs";
import { LEVEL3_CONVERSIONS } from "./reference-data.mjs";
import { v070Row } from "./released-names.mjs";

export const SCHEMA_VERSION = 4;
export const CATEGORIES = ["creativity", "coding", "aesthetics", "tool_operation"];
export const CATEGORY_FACETS = {
  creativity: ["creative_writing"],
  coding: ["execution", "faithfulness"],
  aesthetics: ["design"],
  tool_operation: ["responsiveness", "image_recognition"],
};
/** What each demand level of `tool_operation` asks of a model: level 1 nothing, level 2 speed, level 3 speed and vision. */
export const TOOL_LEVEL_FACETS = { 1: [], 2: ["responsiveness"], 3: ["responsiveness", "image_recognition"] };
/**
 * The effort order, its one owner (`user_scores.EFFORTS`): every effort a curve carries and a launch can name on the scale, lowest
 * first. `none` is reasoning switched off; `minimal` and `ultra` lie beyond what boards measure (`MEASURED_EFFORTS`). An effort
 * name off the scale (`default`) reads the effort `five-axis-scores.json` `effort_readings` names (`axis-scores.js` `readingEffort`).
 */
export const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
/** The efforts boards measure at a reasoning level. */
export const MEASURED_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** The anchor of `none`: a model's lowest measured reasoning effort, else High (`edgeAnchor`). */
const LOWEST_REASONING = "lowest_reasoning";
/**
 * `{ edge effort: [the effort it is filled from, the pair whose fleet difference is the step] }`, in fill order (`EDGES`):
 * `minimal` from Low, `ultra` from Max, `none` from the model's lowest measured reasoning effort.
 */
export const EDGES = {
  minimal: ["low", ["low", "medium"]],
  ultra: ["max", ["max", "xhigh"]],
  none: [LOWEST_REASONING, ["none", LOWEST_REASONING]],
};

/**
 * `edge_anchor`: the effort edge effort `edge` is filled from: its neighbour, or for `none` the lowest reasoning effort among
 * `measured` that `values` holds, else High when `values` holds it; null when there is none.
 */
export function edgeAnchor(edge, values, measured) {
  const near = EDGES[edge][0];
  if (near !== LOWEST_REASONING) return near in values ? near : null;
  return EFFORTS.slice(1).find((e) => measured.includes(e) && e in values) || ("high" in values ? "high" : null);
}
export const VALID_TARGETS = [...CATEGORIES, ...CATEGORIES.flatMap((cat) => CATEGORY_FACETS[cat].map((facet) => `${cat}.${facet}`))];

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const isRow = (value) => value && typeof value === "object" && !Array.isArray(value);
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

export function parseTarget(target) {
  const raw = String(target ?? "").trim();
  if (!raw.includes(".")) {
    if (CATEGORIES.includes(raw)) return [raw, null];
  } else {
    const at = raw.indexOf(".");
    const cat = raw.slice(0, at);
    const facet = raw.slice(at + 1);
    if (cat in CATEGORY_FACETS && CATEGORY_FACETS[cat].includes(facet)) return [cat, facet];
  }
  throw new Error(`Unknown score target ${JSON.stringify(target)}; expected one of: ${VALID_TARGETS.join(", ")}`);
}

export function normalizeLevel(level) {
  if (typeof level === "boolean" || level === null || level === undefined || level === "") {
    throw new Error("Score level must be a finite number on the demand-level scale.");
  }
  const value = Number(level);
  if (!Number.isFinite(value)) throw new Error(`Score level ${JSON.stringify(level)} must be a finite number on the demand-level scale.`);
  return pyRound(value, 6);
}

const ROUND_LEVELS = 2; // decimals of a converted level

/**
 * `convert_level`: a level written with level 3 = the anchor, carried onto the scale whose level 3 is the panel maximum. At or
 * below 2 it stays; above 2 it becomes `2 + (L - 2) * (A - 2)`, A = the anchor's level on the facet; on a plateau facet (a declared
 * `above_3_slope`) it is 2 up to level 3 and `2 + (L - 3) * s` above.
 */
export function convertLevel(level, anchorLevel, aboveSlope = null, ndigits = ROUND_LEVELS) {
  const lv = normalizeLevel(level);
  if (lv <= 2.0) return lv;
  if (aboveSlope !== null && aboveSlope !== undefined) return pyRound(2.0 + Math.max(lv - 3.0, 0.0) * aboveSlope, ndigits);
  return pyRound(2.0 + (lv - 2.0) * (anchorLevel - 2.0), ndigits);
}

/** `(category, facet)` of a score target; a category of one facet stands for that facet's scale. */
function facetOf(target) {
  const [cat, facet] = parseTarget(target);
  return [cat, facet === null && CATEGORY_FACETS[cat].length === 1 ? CATEGORY_FACETS[cat][0] : facet];
}

/**
 * `convert_scores`: `{ model: { target: entry } }` converted by `convertLevel` with the facet's anchor level and slope. A category
 * entry of several facets above level 2 is written per facet (except a facet the model has its own entry for); everything but
 * `level` is kept.
 */
export function convertScores(scores, anchorLevels, aboveSlopes) {
  const out = {};
  for (const [model, entries] of Object.entries(scores)) {
    const converted = {};
    const explicit = new Set(Object.keys(entries).filter((t) => parseTarget(t)[1] !== null));
    for (const [target, entry] of Object.entries(entries)) {
      const [cat, facet] = parseTarget(target);
      if (facet === null && CATEGORY_FACETS[cat].length > 1) {
        if (normalizeLevel(entry.level) <= 2.0) {
          converted[target] = { ...entry };
          continue;
        }
        for (const f of CATEGORY_FACETS[cat]) {
          const key = `${cat}.${f}`;
          if (!explicit.has(key)) converted[key] = { ...entry, level: convertLevel(entry.level, anchorLevels[key], aboveSlopes[key] ?? null) };
        }
        continue;
      }
      const key = facetOf(target).join(".");
      converted[target] = { ...entry, level: convertLevel(entry.level, anchorLevels[key], aboveSlopes[key] ?? null) };
    }
    out[model] = Object.fromEntries(Object.keys(converted).sort().map((k) => [k, converted[k]]));
  }
  return out;
}

const entryOf = (rec) => (isRow(rec) ? rec : { level: rec });
const entriesOf = (scores) =>
  Object.fromEntries(
    Object.entries(scores).map(([m, targets]) => [m, isRow(targets) ? Object.fromEntries(Object.entries(targets).map(([k, r]) => [k, entryOf(r)])) : targets]),
  );

/** Schema 1 named the first category `divergence`; schema 2 names it `creativity`. */
function schema1To2(doc) {
  const scores = {};
  for (const [model, targets] of Object.entries(doc.scores)) {
    scores[model] = isRow(targets)
      ? Object.fromEntries(
          Object.entries(targets).map(([t, e]) => [String(t).split(".")[0] === "divergence" ? `creativity${t.slice("divergence".length)}` : t, e]),
        )
      : targets;
  }
  return { ...doc, schema_version: 2, scores };
}

/** Schema 2 levels had level 3 = the anchor; schema 3 levels have level 3 = the panel maximum (the declared conversion). */
function schema2To3(doc) {
  const conversion = LEVEL3_CONVERSIONS["2"];
  const rows = Object.fromEntries(Object.entries(doc.scores).filter(([, t]) => isRow(t)));
  return { ...doc, schema_version: 3, scores: { ...doc.scores, ...convertScores(rows, conversion.anchor_levels, conversion.above_3_slopes) } };
}

/**
 * Schema 3 (plugin 0.3.0, AgentCompass v0.7.0) entries keyed by a name v0.7.0 resolved through an alias this release removed or
 * re-targeted (`v070Row`: the name, else its last `/` segment) move to the row v0.7.0 resolved the name to, the model the operator
 * scored. Entries that meet on one row merge in table order, a later one winning, as v0.7.0's overlay applied them.
 */
function schema3To4(doc) {
  const out = {};
  for (const [model, targets] of Object.entries(doc.scores)) {
    const key = v070Row(model) || model;
    out[key] = isRow(targets) && isRow(out[key]) ? { ...out[key], ...targets } : targets;
  }
  return { ...doc, schema_version: 4, scores: out };
}

/** `LOCAL_UPGRADES`: the step from each schema an earlier release documented to the next. */
export const LOCAL_UPGRADES = { 1: schema1To2, 2: schema2To3, 3: schema3To4 };

/**
 * The operator's `userScores` as a `{ schema_version, scores }` document carried into `SCHEMA_VERSION`: a document names its
 * `schema_version`; a bare `{ model: { target: level } }` table (or `{ scores }` without one) is the shape plugin 0.2.x documented,
 * schema 1. Nothing is dropped: every entry is converted, or refused with its name.
 */
export function upgradeScores(raw) {
  const named = isRow(raw) && isRow(raw.scores);
  const version = named && raw.schema_version !== undefined ? raw.schema_version : 1;
  if (![1, 2, 3, SCHEMA_VERSION].includes(version)) {
    throw new Error(`userScores schema_version ${JSON.stringify(version)} is not one this plugin reads (1, 2, 3 or ${SCHEMA_VERSION})`);
  }
  const scores = named ? raw.scores : raw;
  if (!isRow(scores)) throw new Error("userScores must be an object mapping model -> { target: level | { level, as_of, note } }");
  for (const [model, targets] of Object.entries(scores)) {
    if (!String(model ?? "").trim() || !isRow(targets)) throw new Error(`Invalid model entry ${JSON.stringify(model)} in userScores`);
  }
  let doc = { schema_version: version, scores: entriesOf(scores) };
  while (doc.schema_version in LOCAL_UPGRADES) doc = LOCAL_UPGRADES[doc.schema_version](doc);
  return doc;
}

/** The `{ model: { target: { level, as_of, kind, note? } } }` table of a layer, every entry checked, or an `Error`. */
export function validateScores(raw, kind = "user") {
  if (raw === undefined || raw === null) return {};
  if (!isRow(raw)) throw new Error("userScores must be an object mapping model -> { target: level | { level, as_of, note } }");
  const scores = upgradeScores(raw).scores;
  const out = {};
  for (const [model, targets] of Object.entries(scores)) {
    const name = String(model ?? "").trim();
    if (!name || !isRow(targets)) throw new Error(`Invalid model entry ${JSON.stringify(model)} in userScores`);
    const clean = {};
    for (const [target, rec] of Object.entries(targets)) {
      parseTarget(target);
      const entry = isRow(rec) ? rec : { level: rec };
      clean[target] = {
        level: normalizeLevel(entry.level),
        as_of: typeof entry.as_of === "string" && entry.as_of.trim() ? entry.as_of.trim() : "local",
        kind,
        ...(entry.note ? { note: String(entry.note).trim() } : {}),
      };
    }
    if (Object.keys(clean).length > 0) out[name] = clean;
  }
  return out;
}

/** `(t1, t2, t3)` on the current panel z-scale for `category` or `category.facet` (a category of one facet reads that facet's scale). */
export function targetTriad(targets, category, facet = null) {
  const block = (targets || {})[category] || {};
  const f = facet === null && (CATEGORY_FACETS[category] || []).length === 1 ? CATEGORY_FACETS[category][0] : facet;
  const levels = (f !== null ? ((block.facets || {})[f] || {}).levels : block.levels) || {};
  if (["1", "2", "3"].every((k) => isNumber((levels[k] || {}).target))) return [levels["1"].target, levels["2"].target, levels["3"].target];
  throw new Error(`Panel targets for ${category}${f ? `.${f}` : ""} are missing from anchor.targets`);
}

function scale(t1, t2, t3) {
  if (!(t1 < t2 && t2 < t3)) throw new Error(`A level scale needs t1 < t2 < t3, got (${t1}, ${t2}, ${t3}).`);
  return [t1, t2, t3];
}

/**
 * Map demand-level `level` (`1 -> t1`, `2 -> t2`, `3 -> t3`) onto panel z-scores: linear between the points, and beyond them with
 * the step of the nearest pair (`t3 - t2` above 3, `t2 - t1` below 1).
 */
export function levelToZ(level, t1, t2, t3) {
  const lv = normalizeLevel(level);
  [t1, t2, t3] = scale(t1, t2, t3);
  if (lv <= 2.0) return t1 + (lv - 1.0) * (t2 - t1);
  return t2 + (lv - 2.0) * (t3 - t2);
}

/** The inverse of `levelToZ`, unclamped: a value above the panel maximum is a level above 3. */
export function zToLevel(z, t1, t2, t3) {
  if (typeof z === "boolean" || !Number.isFinite(Number(z))) throw new Error("Panel z-score must be a finite number.");
  const zf = Number(z);
  [t1, t2, t3] = scale(t1, t2, t3);
  if (zf <= t2) return pyRound(1.0 + (zf - t1) / (t2 - t1), 4);
  return pyRound(2.0 + (zf - t2) / (t3 - t2), 4);
}

const facetHasAnyScore = (cell) =>
  isRow(cell) && (cell.value !== undefined && cell.value !== null || Object.values(cell.by_effort || {}).some((v) => v !== null && v !== undefined));

function sharedByEffort(facets, names) {
  const shared = EFFORTS.filter((e) => names.every((f) => (facets[f].by_effort || {})[e] !== undefined && facets[f].by_effort[e] !== null));
  return Object.fromEntries(shared.map((e) => [e, pyRound(Math.min(...names.map((f) => Number(facets[f].by_effort[e]))), 4)]));
}

function recomputeCategory(category, cell, status) {
  const facets = cell.facets || {};
  const req = CATEGORY_FACETS[category];
  const valueOf = (names, byEffort) => {
    let value = byEffort.high;
    if (value === undefined && names.every((f) => facets[f].value !== undefined && facets[f].value !== null)) {
      value = pyRound(Math.min(...names.map((f) => Number(facets[f].value))), 4);
    }
    return value === undefined ? null : value;
  };
  if (category !== "tool_operation") {
    const missing = req.filter((f) => !facetHasAnyScore(facets[f]));
    if (missing.length > 0) return { value: null, by_effort: {}, facets, missing_facets: missing, status: "partial", flag: "partial" };
    const byEffort = sharedByEffort(facets, req);
    const value = valueOf(req, byEffort);
    const res = { value, by_effort: byEffort, facets, status: value !== null ? status : "partial" };
    if (value === null || Object.keys(byEffort).length === 0) res.flag = "partial";
    return res;
  }
  const byLevel = { 1: { facets: [], value: 0.0, by_effort: Object.fromEntries(EFFORTS.map((e) => [e, 0.0])) } };
  for (const lvl of [2, 3]) {
    const need = TOOL_LEVEL_FACETS[lvl];
    const miss = need.filter((f) => !facetHasAnyScore(facets[f]));
    if (miss.length > 0) {
      byLevel[lvl] = { facets: [...need], missing_facets: miss, value: null, by_effort: {} };
    } else {
      const byEffort = sharedByEffort(facets, need);
      byLevel[lvl] = { facets: [...need], value: valueOf(need, byEffort), by_effort: byEffort };
    }
  }
  const l3 = byLevel[3];
  const res = { value: l3.value, by_effort: { ...l3.by_effort }, by_level: byLevel, facets, status: l3.value !== null ? status : "partial" };
  if (l3.missing_facets) {
    res.missing_facets = [...l3.missing_facets];
    res.flag = Object.keys(facets).length > 0 ? "partial" : "missing";
  } else if (l3.value === null || Object.keys(l3.by_effort).length === 0) {
    res.flag = "partial";
  }
  return res;
}

/**
 * The efforts of a facet cell that hold a board measurement: the cell's own `measured_efforts` when it lists them (every facet of
 * the shipped file does: the efforts the calibration filled or bounded are not among them), else every effort of a `measured*`
 * cell, else none.
 */
function measuredEfforts(cell) {
  if (!isRow(cell)) return [];
  const by = cell.by_effort || {};
  const has = (e) => by[e] !== undefined && by[e] !== null;
  if ("measured_efforts" in cell) return (cell.measured_efforts || []).filter(has);
  if (String(cell.status || "").startsWith("measured")) return EFFORTS.filter(has);
  return [];
}

/** `rises_with_effort`: an ability facet never decreases as effort rises; `tool_operation.responsiveness` never rises. */
export function risesWithEffort(cat, facet) {
  return !(cat === "tool_operation" && facet === "responsiveness");
}

/** `anchor_effort`: High when the curve has it, else its effort nearest High (the lower on a tie). */
export function anchorEffort(efforts) {
  const present = EFFORTS.filter((e) => efforts.includes(e));
  if (present.length === 0) return null;
  const at = EFFORTS.indexOf("high");
  const dist = (e) => [Math.abs(EFFORTS.indexOf(e) - at), EFFORTS.indexOf(e)];
  return present.reduce((best, e) => {
    const [a, b] = [dist(e), dist(best)];
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? e : best;
  });
}

/**
 * `bound_along_effort`: `by` (`{ effort: value }`) with no inversion along `EFFORTS`, the one rule for every value along the efforts
 * of one model: a curve that `rises` never decreases as effort rises, any other never increases. The `pinned` efforts present in
 * `by` keep their values and must already be in order (default: the anchor, `anchorEffort`). An effort between two pinned ones is
 * held between them; below the lowest pinned effort each is capped by the next higher one's bounded value, above the highest each
 * is floored by the next lower one's (the mirror image for a falling curve). A curve already in order is returned unchanged.
 */
export function boundAlongEffort(by, rises, pinned = null) {
  const sign = rises ? 1.0 : -1.0;
  const order = EFFORTS.filter((e) => e in by);
  if (order.length === 0) return {};
  const pins = new Set(pinned !== null ? pinned : [anchorEffort(Object.keys(by))]);
  const s = Object.fromEntries(order.map((e) => [e, sign * Number(by[e])]));
  const at = order.map((e, i) => (pins.has(e) ? i : -1)).filter((i) => i >= 0);
  if (at.length === 0) {
    throw new Error(`bound_along_effort: none of the pinned efforts ${JSON.stringify([...pins].sort())} is in the curve ${JSON.stringify(order)}`);
  }
  for (let k = 0; k + 1 < at.length; k++) {
    if (s[order[at[k + 1]]] < s[order[at[k]]]) {
      throw new Error(`bound_along_effort: the pinned efforts ${order[at[k]]} and ${order[at[k + 1]]} are themselves inverted`);
    }
  }
  for (let i = at[0] - 1; i >= 0; i--) s[order[i]] = Math.min(s[order[i]], s[order[i + 1]]);
  for (let i = at[at.length - 1] + 1; i < order.length; i++) s[order[i]] = Math.max(s[order[i]], s[order[i - 1]]);
  for (let k = 0; k + 1 < at.length; k++) {
    for (let i = at[k] + 1; i < at[k + 1]; i++) s[order[i]] = Math.min(Math.max(s[order[i]], s[order[i - 1]]), s[order[at[k + 1]]]);
  }
  return Object.fromEntries(order.map((e) => [e, s[e] === sign * Number(by[e]) ? by[e] : pyRound(sign * s[e], 4)]));
}

/**
 * `{ by_effort, measured }` of a facet a manual score sets to `zVal` (`_manual_by_effort`): the score sets High, and also the
 * model's `fixedEffort`; efforts the facet measured keep their values; its other efforts follow its own curve moved to `zVal` at
 * High; an effort it has no value at takes `zVal` plus the panel's median own step from High to it (`steps`: the facet's entry of
 * `effort_steps`) and stays missing only where the panel gives no step; an edge effort is its anchor plus the fleet's edge step
 * (`EDGES`). The curve is then bounded in the facet's direction (`boundAlongEffort`): first the measured efforts with the set ones
 * pinned at `zVal` (a measured effort that bound moves is no longer listed as measured), then the other efforts with those pinned.
 */
function manualByEffort(zVal, ownCell, rises, fixedEffort = null, steps = null) {
  const pinned = EFFORTS.filter((e) => e === "high" || e === fixedEffort);
  const by = {};
  for (const [e, v] of Object.entries((ownCell || {}).by_effort || {})) if (EFFORTS.includes(e) && v !== null && v !== undefined) by[e] = Number(v);
  const measured = measuredEfforts(ownCell).filter((e) => !pinned.includes(e));
  let out = {};
  for (const e of measured) out[e] = by[e];
  for (const e of pinned) out[e] = zVal;
  if ("high" in by) for (const [e, v] of Object.entries(by)) if (!(e in out)) out[e] = zVal + v - by.high;
  const hasStep = (step) => isRow(step) && step.step !== null && step.step !== undefined;
  for (const [e, step] of Object.entries((steps || {}).high || {})) {
    if (EFFORTS.includes(e) && !(e in out) && hasStep(step)) out[e] = zVal + Number(step.step);
  }
  for (const [edge, [key]] of Object.entries(EDGES)) {
    const near = edgeAnchor(edge, out, [...measured, ...pinned]);
    const step = ((steps || {})[key] || {})[edge];
    if (!(edge in out) && near !== null && hasStep(step)) out[edge] = out[near] + Number(step.step);
  }
  const held = boundAlongEffort(
    Object.fromEntries(EFFORTS.filter((e) => e in out && (pinned.includes(e) || measured.includes(e))).map((e) => [e, out[e]])),
    rises,
    pinned,
  );
  out = boundAlongEffort(Object.fromEntries(EFFORTS.filter((e) => e in out).map((e) => [e, e in held ? held[e] : out[e]])), rises, Object.keys(held));
  out = Object.fromEntries(Object.entries(out).map(([e, v]) => [e, pyRound(Number(v), 4)]));
  return { by_effort: out, measured: measured.filter((e) => out[e] === pyRound(by[e], 4)) };
}

/**
 * `operating_point_floor`: `cell` (a manual score's facet cell) bounded below by the row's operating point. A row declared as another
 * row at an operating point (its facet estimated `same_model` with `at_effort`) never reads below it on an ability facet under a
 * shipped maintainer score: what routing reads is max(score, base cell) at each effort, and the cell records both inputs and which
 * binds. A local user's score is the user's and is not bounded; responsiveness keeps its own rule.
 */
export function operatingPointFloor(cell, ownCell, status, cat, facet) {
  const est = (ownCell || {}).estimate || {};
  if (status !== "maintainer" || est.method !== "same_model" || !("at_effort" in est) || (cat === "tool_operation" && facet === "responsiveness")) {
    return cell;
  }
  const base = {};
  for (const [e, v] of Object.entries((ownCell || {}).by_effort || {})) if (v !== null && v !== undefined) base[e] = Number(v);
  const score = cell.by_effort;
  const by = Object.fromEntries(Object.entries(score).map(([e, v]) => [e, e in base ? Math.max(v, base[e]) : v]));
  return {
    ...cell,
    value: "high" in by ? by.high : cell.value,
    by_effort: by,
    operating_point_floor: {
      base_model: est.base_model ?? null,
      at_effort: est.at_effort,
      base_by_effort: Object.fromEntries(Object.keys(score).filter((e) => e in base).map((e) => [e, base[e]])),
      score_by_effort: { ...score },
      binds_by_effort: Object.fromEntries(Object.entries(score).map(([e, v]) => [e, e in base && base[e] > v ? "base" : "score"])),
    },
  };
}

/**
 * `applied_scores`: `{ target: the manual score entry with reads }`, `reads` being `{ cat.facet: what routing reads at effort }` from
 * the overlay's facet cell and, on a facet with a declared operating point, `operating_point_floor` (`{ cat.facet: { base_model,
 * at_effort, base, score, binds } }`): what the overlay applied, read from its cells, never computed again. `effort` is the effort
 * the candidate reads (`readingEffort`); null reads High, or a cell's lone value.
 */
export function appliedScores(fiveState, effort) {
  const cats = (fiveState || {}).categories || {};
  const manual = (fiveState || {}).manual_scores || {};
  const out = {};
  for (const target of Object.keys(manual).sort()) {
    const rec = manual[target];
    const [cat, facet] = parseTarget(target);
    const reads = {};
    const floors = {};
    for (const f of facet ? [facet] : CATEGORY_FACETS[cat]) {
      const cell = (((cats[cat] || {}).facets || {})[f]) || {};
      const by = isRow(cell.by_effort) ? cell.by_effort : {};
      const key = effort ? effort : "high" in by ? "high" : null;
      const value = Object.keys(by).length > 0 ? by[key] : cell.value;
      reads[`${cat}.${f}`] = value === null || value === undefined ? null : Number(value);
      const floor = cell.operating_point_floor;
      if (isRow(floor) && key !== null && key in (floor.binds_by_effort || {})) {
        floors[`${cat}.${f}`] = {
          base_model: floor.base_model ?? null,
          at_effort: floor.at_effort ?? null,
          base: floor.base_by_effort[key],
          score: floor.score_by_effort[key],
          binds: floor.binds_by_effort[key],
        };
      }
    }
    out[target] = { ...rec, reads, ...(Object.keys(floors).length > 0 ? { operating_point_floor: floors } : {}) };
  }
  return out;
}

/** Python's `f"{x:+.4f}"`. */
const signed4 = (x) => `${x < 0 ? "-" : "+"}${Math.abs(x).toFixed(4)}`;
/** Python's `f"{x:g}"` for a level (six significant digits, no trailing zeros). */
const general = (x) => String(Number(Number(x).toPrecision(6)));

/**
 * `applied_note`: the candidate note of `appliedScores`: each manual score, then what routing reads on each of its facets at
 * `effort`; on a facet with a declared operating point, both inputs and which one binds. null when nothing was applied.
 */
export function appliedNote(applied, effort) {
  const facetText = (name, value, floor) => {
    let text = `${name.split(".")[1]} ${value === null ? "missing" : signed4(value)}`;
    if (floor) {
      const point = `${floor.base_model} at ${floor.at_effort} ${signed4(floor.base)}`;
      text +=
        floor.binds === "base"
          ? ` (the operating point binds: ${point} above the score ${signed4(floor.score)})`
          : ` (the score binds: ${signed4(floor.score)} at or above the operating point ${point})`;
    }
    return text;
  };
  const parts = Object.entries(applied).map(
    ([t, r]) =>
      `${t}=${general(r.level)} (z=${signed4(r.z)}, ${r.kind}, ${r.as_of}): ` +
      Object.entries(r.reads)
        .map(([n, v]) => facetText(n, v, (r.operating_point_floor || {})[n]))
        .join(", "),
  );
  return parts.length > 0 ? `manual capability scores applied, read at ${effort || "its single configuration"}: ${parts.join("; ")}` : null;
}

function applyOneLayer(fiveState, entries, targets, fixedEffort = null, effortSteps = null) {
  if (!entries || Object.keys(entries).length === 0) return;
  const cats = (fiveState.categories ||= {});
  const manual = (fiveState.manual_scores ||= {});
  const estimates = (fiveState.estimates ||= {});
  // Whole-category entries first, then the facet entries of the same layer.
  const ordered = Object.entries(entries).sort(([a], [b]) => {
    const ka = [a.includes("."), a];
    const kb = [b.includes("."), b];
    return ka[0] !== kb[0] ? (ka[0] ? 1 : -1) : ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0;
  });
  for (const [target, rec] of ordered) {
    const [cat, facet] = parseTarget(target);
    const status = rec.kind;
    let cell = isRow(cats[cat]) ? clone(cats[cat]) : { facets: {} };
    const facets = isRow(cell.facets) ? clone(cell.facets) : {};
    cell.facets = facets;
    if (facet === null) {
      const zMap = {};
      for (const f of CATEGORY_FACETS[cat]) {
        const zf = pyRound(levelToZ(rec.level, ...targetTriad(targets, cat, f)), 4);
        zMap[f] = zf;
        const { by_effort: byEffort, measured } = manualByEffort(zf, facets[f], risesWithEffort(cat, f), fixedEffort, (effortSteps || {})[`${cat}.${f}`]);
        facets[f] = operatingPointFloor(
          { value: zf, by_effort: byEffort, measured_efforts: measured, status, manual: { ...rec, target, z: zf } },
          facets[f],
          status,
          cat,
          f,
        );
        delete estimates[`${cat}.${f}`];
      }
      const zVal = pyRound(Math.min(...Object.values(zMap)), 4);
      cell = recomputeCategory(cat, cell, status);
      cell.manual = { ...rec, target, z: zVal };
      for (const sub of Object.keys(manual)) if (sub === cat || sub.startsWith(`${cat}.`)) delete manual[sub];
      manual[target] = { ...rec, z: zVal };
    } else {
      if (
        cat !== "tool_operation" &&
        Object.keys(facets).length === 0 &&
        !cell.missing_facets &&
        cell.flag !== "missing" &&
        cell.flag !== "partial" &&
        ((cell.value !== undefined && cell.value !== null) || Object.keys(cell.by_effort || {}).length > 0)
      ) {
        for (const sib of CATEGORY_FACETS[cat]) {
          if (sib !== facet) facets[sib] = { value: cell.value ?? null, by_effort: clone(cell.by_effort || {}), status: cell.status || "measured" };
        }
      }
      const zVal = pyRound(levelToZ(rec.level, ...targetTriad(targets, cat, facet)), 4);
      const { by_effort: byEffort, measured } = manualByEffort(zVal, facets[facet], risesWithEffort(cat, facet), fixedEffort, (effortSteps || {})[`${cat}.${facet}`]);
      facets[facet] = operatingPointFloor(
        { value: zVal, by_effort: byEffort, measured_efforts: measured, status, manual: { ...rec, target, z: zVal } },
        facets[facet],
        status,
        cat,
        facet,
      );
      delete estimates[`${cat}.${facet}`];
      cell = recomputeCategory(cat, cell, status);
      manual[target] = { ...rec, z: zVal };
    }
    cats[cat] = cell;
    (fiveState.scores ||= {})[cat] = cell.value ?? null;
    (fiveState.axis_status ||= {})[cat] = cell.status || status;
    if ((cell.value !== null && cell.value !== undefined) || Object.keys(cell.by_effort || {}).length > 0) {
      if ((fiveState.missing || []).includes(cat)) fiveState.missing = fiveState.missing.filter((m) => m !== cat);
    }
  }
  fiveState.user_scores = Object.fromEntries(Object.entries(manual).filter(([, v]) => v.kind === "user"));
}

/**
 * The row a score keyed `model` lands on (`user_scores.resolve_model_key`), or `model` itself when it names none. A score names a
 * model, not a provider's offer: no provider's declaration is read. A name its maker moved to a newer dated snapshot means what the
 * name means now: the maker's `provider_names` `defaults` declaration is read first (`makerDefault`), so a score keyed by the moved
 * name lands on the snapshot's row. Else the name as a row, an alias, its last `/` segment as a row, that segment as an alias.
 */
export function resolveModelKey(model, models, aliases = {}) {
  const raw = String(model ?? "").trim();
  if (!raw) throw new Error("Model id must not be empty.");
  const isModel = (name) => Object.prototype.hasOwnProperty.call(models, name) && isRow(models[name]);
  const aliasOf = (name) => (Object.prototype.hasOwnProperty.call(aliases || {}, name) && isModel(aliases[name]) ? aliases[name] : null);
  const declared = makerDefault(raw);
  if (declared) {
    if (!isModel(declared.model)) throw new Error(`provider_names defaults names row ${JSON.stringify(declared.model ?? null)} for ${JSON.stringify(raw)}, which the catalogue does not have`);
    return declared.model;
  }
  if (isModel(raw)) return raw;
  if (aliasOf(raw)) return aliasOf(raw);
  const leaf = raw.split("/").pop();
  if (isModel(leaf)) return leaf;
  return aliasOf(leaf) || raw;
}

/**
 * `[[row, { target: entry }]]` of one user-scores layer (`user_scores.score_layer`), each key read by `resolveModelKey`. Keys
 * landing on one row merge by target; a key that is the row's own id (`deepseek-v4-pro-0813`) wins over another spelling or a moved
 * name (`deepseek-v4-pro`) for each target both hold, and other spellings apply in name order, so the result never depends on the
 * order of the keys in the file. A key that lands on no row keeps its own name.
 */
export function scoreLayer(layer, models, aliases = {}) {
  const keyed = Object.entries(layer || {})
    .filter(([, entries]) => isRow(entries) && Object.keys(entries).length > 0)
    .map(([key, entries]) => [resolveModelKey(key, models, aliases), key, entries]);
  const own = ([row, key]) => (row === key ? 1 : 0);
  keyed.sort((a, b) => own(a) - own(b) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const grouped = new Map();
  for (const [row, , entries] of keyed) grouped.set(row, { ...(grouped.get(row) || {}), ...entries });
  return grouped;
}

/**
 * Apply `publicScores` (kind `maintainer`) then `localScores` (kind `user`) onto `models[m].five_axis`, in place. Each key lands on
 * its row as `resolveModelKey` reads it (`scoreLayer`, `aliases` mapping other spellings to a row); `effortSteps` is
 * `five-axis-scores.json` `effort_steps` (`manualByEffort`). An entry whose name resolves to no row is ignored, never made a row.
 * Facets derived from a larger row then follow a score on that row (`followEffectiveSources`).
 */
export function applyOverlay(models, targets, { publicScores = null, localScores = null, aliases = {}, effortSteps = null } = {}) {
  const pub = publicScores || {};
  const loc = localScores || {};
  if (Object.keys(pub).length === 0 && Object.keys(loc).length === 0) return;
  const shipped = Object.fromEntries(Object.entries(models).filter(([, info]) => isRow(info)).map(([name, info]) => [name, facetCurves(info)]));
  for (const layer of [pub, loc]) {
    for (const [canon, entries] of scoreLayer(layer, models, aliases)) {
      const info = models[canon];
      if (!isRow(info)) continue;
      info.five_axis ||= {
        categories: {},
        scores: Object.fromEntries(CATEGORIES.map((a) => [a, null])),
        missing: [...CATEGORIES],
        estimates: {},
        axis_status: Object.fromEntries(CATEGORIES.map((a) => [a, "missing"])),
        tier: { value: null, method: "none" },
        usd_status: "missing",
        image_input: { status: "missing" },
        fast_mode: { status: "not_offered" },
        duration: {},
      };
      applyOneLayer(info.five_axis, entries, targets, info.fixed_effort || null, effortSteps);
    }
  }
  followEffectiveSources(models, shipped);
}

/** The estimate methods that derive a small row's facet from its larger model (`DERIVED_FROM_LARGER`). */
export const DERIVED_FROM_LARGER = ["tier_down", "size_step"];

/** `_facet_curves`: `{ category: { facet: by_effort } }` of a model row's facets as they stand. */
function facetCurves(info) {
  const cats = ((info || {}).five_axis || {}).categories || {};
  const out = {};
  for (const [c, cat] of Object.entries(cats)) {
    if (!isRow(cat)) continue;
    for (const [f, cell] of Object.entries(cat.facets || {})) if (isRow(cell)) (out[c] ||= {})[f] = { ...(cell.by_effort || {}) };
  }
  return out;
}

const curveOf = (curves, cat, facet) => (curves[cat] || {})[facet] || {};
const sameCurve = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => k in b && a[k] === b[k]);

/**
 * `_follow_effective_sources`: a facet derived from a larger model (`DERIVED_FROM_LARGER`) whose source facet a hand-written score
 * (shipped or local) changed moves by the source's change at each effort, derived(e) + effective(e) - shipped(e), and the curve is
 * bounded along effort. A hand-written score on the derived model's own facet wins: the cell it writes carries no estimate. The
 * category is recomputed from its facets.
 */
function followEffectiveSources(models, shipped) {
  for (const info of Object.values(models)) {
    const state = isRow(info) ? info.five_axis : null;
    for (const [cat, catCell] of Object.entries((state || {}).categories || {})) {
      let changed = false;
      for (const [facet, cell] of Object.entries((catCell || {}).facets || {})) {
        const est = (cell || {}).estimate || {};
        const base = est.base_model;
        if (!DERIVED_FROM_LARGER.includes(est.method) || !(base in shipped)) continue;
        const now = curveOf(facetCurves(models[base] || {}), cat, facet);
        const was = curveOf(shipped[base], cat, facet);
        if (sameCurve(now, was)) continue;
        let by = {};
        for (const [e, v] of Object.entries(cell.by_effort || {})) if (e in now && e in was) by[e] = v + now[e] - was[e];
        if (Object.keys(by).length > 0) {
          by = Object.fromEntries(Object.entries(boundAlongEffort(by, risesWithEffort(cat, facet))).map(([e, v]) => [e, pyRound(Number(v), 4)]));
        }
        const baseCell = (((models[base].five_axis.categories[cat] || {}).facets || {})[facet]) || {};
        cell.by_effort = by;
        cell.value = "high" in by ? by.high : null;
        cell.follows = { base_model: base, base_status: baseCell.status ?? null };
        changed = true;
      }
      if (changed) {
        state.categories[cat] = recomputeCategory(cat, catCell, catCell.status || "estimated");
        (state.scores ||= {})[cat] = state.categories[cat].value ?? null;
      }
    }
  }
}
