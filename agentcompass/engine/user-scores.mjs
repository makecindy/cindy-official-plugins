// Vendored from akiiwa-games/magpie-agentcompass-router src/user-scores.js at 35a7aea5b6bc4028bb78c460482b6d3ad8708948 (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Manual capability scores (`user_scores.py`): a maintainer layer (`MAINTAINER_SCORES`, from AgentCompass's
 * `references/user-scores.json`) and an operator's own layer (the plugin option `userScores`), both on the 1..3 demand-level
 * scale, mapped onto the panel's z-scale through the targets (`level 1 -> t1, 2 -> t2, 3 -> t3`). Precedence:
 * `local user > maintainer > measured > estimated`.
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

import { pyRound } from "./catalog.mjs";

export const CATEGORIES = ["divergence", "coding", "aesthetics", "tool_operation"];
export const CATEGORY_FACETS = {
  divergence: ["creative_writing"],
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
    throw new Error("Score level must be a finite number on the 1..3 demand scale.");
  }
  const value = Number(level);
  if (!Number.isFinite(value)) throw new Error(`Score level ${JSON.stringify(level)} must be a finite number on the 1..3 demand scale.`);
  return pyRound(value, 6);
}

/** The `{ model: { target: { level, as_of, kind, note? } } }` table of a layer, every entry checked, or an `Error`. */
export function validateScores(raw, kind = "user") {
  if (raw === undefined || raw === null) return {};
  const scores = isRow(raw) && isRow(raw.scores) ? raw.scores : raw;
  if (!isRow(scores)) throw new Error("userScores must be an object mapping model -> { target: level | { level, as_of, note } }");
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

/** `(t1, t2, t3)` on the current panel z-scale for `category` or `category.facet`. */
export function targetTriad(targets, category, facet = null) {
  const block = (targets || {})[category] || {};
  if (facet !== null) {
    const levels = ((block.facets || {})[facet] || {}).levels || {};
    if (["1", "2", "3"].every((k) => isNumber((levels[k] || {}).target))) return [levels["1"].target, levels["2"].target, levels["3"].target];
    if (category === "tool_operation") {
      const l3 = (((block.levels || {})["3"] || {}).by_facet || {})[facet] || {};
      const l2 = (((block.levels || {})["2"] || {}).by_facet || {})[facet] || {};
      if (isNumber(l3.zero) && isNumber(l3.target)) {
        const t1 = l3.zero;
        const t3 = l3.target;
        return [t1, isNumber(l2.target) ? l2.target : 0.5 * (t1 + t3), t3];
      }
    }
  }
  const levels = block.levels || {};
  if (["1", "2", "3"].every((k) => isNumber((levels[k] || {}).target))) return [levels["1"].target, levels["2"].target, levels["3"].target];
  throw new Error(`Panel targets for ${category}${facet ? `.${facet}` : ""} are missing from anchor.targets`);
}

/**
 * Map demand-level `level` (`1 -> t1`, `2 -> t2`, `3 -> t3`) onto panel z-scores. Decimals in `[1, 3]` interpolate; above 3 it
 * extrapolates by `t3 - t2` (`t2 - t1` where they coincide, as on `tool_operation.responsiveness`); below 1 by `t2 - t1`.
 */
export function levelToZ(level, t1, t2, t3) {
  const lv = normalizeLevel(level);
  const stepLo = t2 - t1;
  const stepHi = t3 - t2;
  if (lv <= 2.0) return t1 + (lv - 1.0) * stepLo;
  if (lv <= 3.0) return t2 + (lv - 2.0) * stepHi;
  return t3 + (lv - 3.0) * (stepHi > 0.0 ? stepHi : stepLo);
}

/** The inverse of `levelToZ`: a panel z-score on the `1..3` demand-level scale. */
export function zToLevel(z, t1, t2, t3) {
  if (typeof z === "boolean" || !Number.isFinite(Number(z))) throw new Error("Panel z-score must be a finite number.");
  const zf = Number(z);
  const stepLo = t2 - t1;
  const stepHi = t3 - t2;
  if (zf <= t2) {
    if (stepLo <= 0.0) return zf >= t2 ? 2.0 : 1.0;
    return pyRound(1.0 + (zf - t1) / stepLo, 4);
  }
  if (stepHi > 0.0) return zf <= t3 ? pyRound(2.0 + (zf - t2) / stepHi, 4) : pyRound(3.0 + (zf - t3) / stepHi, 4);
  if (stepLo <= 0.0) return 3.0;
  return pyRound(3.0 + (zf - t3) / stepLo, 4);
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

/**
 * `{ by_effort, measured }` of a facet a manual score sets to `zVal`: the score sets High, and also the model's `fixed_effort`;
 * efforts the facet measured keep their values, its other efforts follow its own curve moved to `zVal` at High, and an ability
 * facet is made non-decreasing with the set efforts held at `zVal`.
 */
function manualByEffort(zVal, ownCell, ability, fixedEffort = null) {
  const pinned = EFFORTS.filter((e) => e === "high" || e === fixedEffort);
  const by = {};
  for (const [e, v] of Object.entries((ownCell || {}).by_effort || {})) if (EFFORTS.includes(e) && v !== null && v !== undefined) by[e] = Number(v);
  const measured = measuredEfforts(ownCell).filter((e) => !pinned.includes(e));
  let out = {};
  for (const e of measured) out[e] = by[e];
  for (const e of pinned) out[e] = zVal;
  if ("high" in by) for (const [e, v] of Object.entries(by)) if (!(e in out)) out[e] = zVal + v - by.high;
  out = Object.fromEntries(EFFORTS.filter((e) => e in out).map((e) => [e, out[e]]));
  if (ability) {
    const lo = EFFORTS.indexOf(pinned[0]);
    const hi = EFFORTS.indexOf(pinned[pinned.length - 1]);
    const keys = Object.keys(out);
    const below = keys.filter((e) => EFFORTS.indexOf(e) < lo);
    const above = keys.filter((e) => EFFORTS.indexOf(e) > hi);
    pav(below.map((e) => out[e])).forEach((v, i) => (out[below[i]] = Math.min(v, zVal)));
    pav(above.map((e) => out[e])).forEach((v, i) => (out[above[i]] = Math.max(v, zVal)));
    for (const e of keys) if (lo < EFFORTS.indexOf(e) && EFFORTS.indexOf(e) < hi) out[e] = zVal;
  }
  out = Object.fromEntries(Object.entries(out).map(([e, v]) => [e, pyRound(v, 4)]));
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
        const { by_effort: byEffort, measured } = manualByEffort(zf, facets[f], !(cat === "tool_operation" && f === "responsiveness"), fixedEffort);
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
      const { by_effort: byEffort, measured } = manualByEffort(zVal, facets[facet], !(cat === "tool_operation" && facet === "responsiveness"), fixedEffort);
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
