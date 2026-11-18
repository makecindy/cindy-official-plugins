// Vendored from akiiwa-games/magpie-agentcompass-router src/user-scores.js at c27dd73065cddb0c01a45d6010f03ad2740a5e56 (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Manual capability scores (`user_scores.py`, schema 3): a maintainer layer (`MAINTAINER_SCORES`, from AgentCompass's
 * `references/user-scores.json`) and an operator's own layer (the plugin option `userScores`), both on the demand-level scale
 * mapped onto the panel's z-scale through the facet's targets: `1` = the panel's weakest (`t1`), `2` = the panel median (`t2`),
 * `3` = the panel's best (`t3`), linear between them and beyond them (a level above 3 is above the panel's best). Precedence:
 * `local user > maintainer > measured > estimated`.
 *
 * An operator's `userScores` written for an earlier schema is carried into schema 3 by the same steps AgentCompass applies to a
 * local file (`LOCAL_UPGRADES`): schema 1 (plugin 0.2.x, AgentCompass through v0.6.6; a table without `schema_version` is that
 * shape) names the first category `divergence`, schema 2 had level 3 = the anchor; the declared conversion of
 * `references/level-3-conversion.json` (`LEVEL3_CONVERSIONS`) moves those levels onto the current scale.
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

import { pyRound } from "./catalog.mjs";
import { LEVEL3_CONVERSIONS } from "./reference-data.mjs";

export const SCHEMA_VERSION = 3;
export const CATEGORIES = ["creativity", "coding", "aesthetics", "tool_operation"];
export const CATEGORY_FACETS = {
  creativity: ["creative_writing"],
  coding: ["execution", "faithfulness"],
  aesthetics: ["design"],
  tool_operation: ["responsiveness", "image_recognition"],
};
/** What each demand level of `tool_operation` asks of a model: level 1 nothing, level 2 speed, level 3 speed and vision. */
export const TOOL_LEVEL_FACETS = { 1: [], 2: ["responsiveness"], 3: ["responsiveness", "image_recognition"] };
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
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

/** `LOCAL_UPGRADES`: the step from each schema an earlier release documented to the next. */
export const LOCAL_UPGRADES = { 1: schema1To2, 2: schema2To3 };

/**
 * The operator's `userScores` as a `{ schema_version, scores }` document carried into `SCHEMA_VERSION`: a document names its
 * `schema_version`; a bare `{ model: { target: level } }` table (or `{ scores }` without one) is the shape plugin 0.2.x documented,
 * schema 1. Nothing is dropped: every entry is converted, or refused with its name.
 */
export function upgradeScores(raw) {
  const named = isRow(raw) && isRow(raw.scores);
  const version = named && raw.schema_version !== undefined ? raw.schema_version : 1;
  if (![1, 2, SCHEMA_VERSION].includes(version)) {
    throw new Error(`userScores schema_version ${JSON.stringify(version)} is not one this plugin reads (1, 2 or ${SCHEMA_VERSION})`);
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

/** The efforts of a facet cell that hold a board measurement. */
function measuredEfforts(cell) {
  if (!isRow(cell)) return [];
  const by = cell.by_effort || {};
  const has = (e) => by[e] !== undefined && by[e] !== null;
  if (String(cell.status || "").startsWith("measured")) return EFFORTS.filter(has);
  return (cell.measured_efforts || []).filter(has);
}

/** `values` made non-decreasing by pooling adjacent violators. */
function pav(values) {
  const blocks = values.map((v) => [v, 1]);
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i][0] / blocks[i][1] > blocks[i + 1][0] / blocks[i + 1][1]) {
      blocks[i] = [blocks[i][0] + blocks[i + 1][0], blocks[i][1] + blocks[i + 1][1]];
      blocks.splice(i + 1, 1);
      i = Math.max(i - 1, 0);
    } else {
      i += 1;
    }
  }
  return blocks.flatMap(([sum, n]) => Array.from({ length: n }, () => sum / n));
}

/** `rises_with_effort`: ability facets never decrease with effort; `tool_operation.responsiveness` falls as effort rises. */
export function risesWithEffort(cat, facet) {
  return !(cat === "tool_operation" && facet === "responsiveness");
}

/**
 * `{ by_effort, measured }` of a facet a manual score sets to `zVal`: the score sets High, and also the model's `fixedEffort`;
 * efforts the facet measured keep their values, its other efforts follow its own curve moved to `zVal` at High. The curve is then
 * made monotone in the facet's direction (`risesWithEffort`) with the set efforts held at `zVal`: a rising facet is
 * non-decreasing, a falling one non-increasing (bounded as its mirror image); efforts between two set ones are `zVal`.
 */
function manualByEffort(zVal, ownCell, rises, fixedEffort = null) {
  const pinned = EFFORTS.filter((e) => e === "high" || e === fixedEffort);
  const by = {};
  for (const [e, v] of Object.entries((ownCell || {}).by_effort || {})) if (EFFORTS.includes(e) && v !== null && v !== undefined) by[e] = Number(v);
  const measured = measuredEfforts(ownCell).filter((e) => !pinned.includes(e));
  let out = {};
  for (const e of measured) out[e] = by[e];
  for (const e of pinned) out[e] = zVal;
  if ("high" in by) for (const [e, v] of Object.entries(by)) if (!(e in out)) out[e] = zVal + v - by.high;
  out = Object.fromEntries(EFFORTS.filter((e) => e in out).map((e) => [e, out[e]]));
  const sign = rises ? 1.0 : -1.0;
  const signed = Object.fromEntries(Object.entries(out).map(([e, v]) => [e, sign * v]));
  const held = sign * zVal;
  const lo = EFFORTS.indexOf(pinned[0]);
  const hi = EFFORTS.indexOf(pinned[pinned.length - 1]);
  const keys = Object.keys(signed);
  const below = keys.filter((e) => EFFORTS.indexOf(e) < lo);
  const above = keys.filter((e) => EFFORTS.indexOf(e) > hi);
  pav(below.map((e) => signed[e])).forEach((v, i) => (signed[below[i]] = Math.min(v, held)));
  pav(above.map((e) => signed[e])).forEach((v, i) => (signed[above[i]] = Math.max(v, held)));
  for (const e of keys) if (lo < EFFORTS.indexOf(e) && EFFORTS.indexOf(e) < hi) signed[e] = held;
  out = Object.fromEntries(Object.entries(signed).map(([e, v]) => [e, pyRound(sign * v, 4)]));
  return { by_effort: out, measured: measured.filter((e) => out[e] === pyRound(by[e], 4)) };
}

function applyOneLayer(fiveState, entries, targets, fixedEffort = null) {
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
        const { by_effort: byEffort, measured } = manualByEffort(zf, facets[f], risesWithEffort(cat, f), fixedEffort);
        facets[f] = { value: zf, by_effort: byEffort, measured_efforts: measured, status, manual: { ...rec, target, z: zf } };
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
      const { by_effort: byEffort, measured } = manualByEffort(zVal, facets[facet], risesWithEffort(cat, facet), fixedEffort);
      facets[facet] = { value: zVal, by_effort: byEffort, measured_efforts: measured, status, manual: { ...rec, target, z: zVal } };
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
 * Apply `publicScores` (kind `maintainer`) then `localScores` (kind `user`) onto `models[m].five_axis`, in place. `aliases` maps
 * other spellings to a row; a model the table does not have gets a row with no scores of its own.
 */
export function applyOverlay(models, targets, { publicScores = null, localScores = null, aliases = {} } = {}) {
  const pub = publicScores || {};
  const loc = localScores || {};
  if (Object.keys(pub).length === 0 && Object.keys(loc).length === 0) return;
  const toCanonical = new Map();
  for (const name of Object.keys(models)) if (isRow(models[name])) toCanonical.set(name, name);
  for (const [al, target] of Object.entries(aliases || {})) if (typeof target === "string" && target in models) toCanonical.set(String(al), target);
  const canonical = (raw) => {
    const name = String(raw ?? "").trim();
    if (toCanonical.has(name)) return toCanonical.get(name);
    const leaf = name.split("/").pop();
    return toCanonical.has(leaf) ? toCanonical.get(leaf) : name;
  };
  for (const layer of [pub, loc]) {
    const grouped = new Map();
    for (const [raw, entries] of Object.entries(layer)) {
      if (!isRow(entries) || Object.keys(entries).length === 0) continue;
      const canon = canonical(raw);
      grouped.set(canon, { ...(grouped.get(canon) || {}), ...entries });
    }
    for (const [canon, entries] of grouped) {
      const info = (models[canon] ||= {});
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
      applyOneLayer(info.five_axis, entries, targets, info.fixed_effort || null);
    }
  }
}
