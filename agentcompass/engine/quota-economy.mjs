// Vendored from akiiwa-games/magpie-agentcompass-router src/quota-economy.js at 35a7aea5b6bc4028bb78c460482b6d3ad8708948 (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Quota economy and pricing (`quota_economy.py`, quota economy v3.1): usd rates, the quota price of a window and the
 * five-axis economy that turns the remaining capacity of long reset-period windows into a cost in fit units.
 *
 *   window recovery   capacity C, used U, elapsed fraction e of the period: the line C * e is the pace at which the period's
 *                     capacity just runs out
 *   need tail         P(the demand reaching the window before its reset >= room): negative binomial, via the regularized
 *                     incomplete beta function
 *   value ladder      the upper hull of (spend, fit) over the 63-point demand grid
 *   quota price       lambda_w(y), the fit lost elsewhere per unit at cumulative use y
 *   spend cost        cost = integral of lambda_w over [U, U + spend], N = fit - cost
 *
 * Only long reset-period windows are priced; 5-hour windows keep their feasibility role in candidate-eval. Not carried:
 * fast-mode variants (a vendor service tier is a worker-launch setting; the gateway has none to offer).
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

import { pyRound } from "./catalog.mjs";
import { fiveAxisFit, fiveAxisTargets } from "./axis-scores.mjs";
import { FIVE_AXIS_ANCHOR } from "./reference-data.mjs";

export const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max", "ultra"];
const INF = Number.POSITIVE_INFINITY;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** API-priced dollars one full window allows, or null when unknown. */
export function capacityUsd(spec, wid) {
  const value = ((spec && spec.capacity_usd) || {})[wid];
  return value ? Number(value) : null;
}

/** The effort a bundle is scored at: its own, else its model's `fixed_effort`. */
export function scoringEffort(bundle, info) {
  return (bundle && bundle.effort) || (info && info.fixed_effort) || null;
}

export function usdUnpriced(model, info) {
  return !info || info.usd_per_hour === null || info.usd_per_hour === undefined;
}

/** Percent of the window this bundle spends per worker-hour, or null when the window has no cited capacity. */
export function unitRate(spec, wid, model, info) {
  const capacity = capacityUsd(spec, wid);
  const usd = info ? info.usd_per_hour : null;
  if (capacity && usd) return (100 * usd) / capacity;
  return usdUnpriced(model, info) ? 0.0 : null;
}

export function modelUsdPerHour(model, info) {
  const usd = info ? info.usd_per_hour : null;
  return usd === null || usd === undefined ? 0.0 : Number(usd);
}

/** Expected API-equivalent task budget in USD for `hours` active worker-hours. */
export function bundleTaskUsd(spec, model, hours, info, contextBurn = 1.0) {
  if (spec.unlimited || spec.unmetered) return 0.0;
  return hours * modelUsdPerHour(model, info) * contextBurn;
}

/** `[multiplier, basis]` of the time a task takes this model at `effort`; `[null, null]` when the data has none. */
export function durationAt(info, effort) {
  const five = (((info || {}).five_axis || {}).duration) || {};
  const key = effort || "high";
  const mult = (five.by_effort || {})[key];
  if (typeof mult === "number" && Number.isFinite(mult) && mult > 0) return [Number(mult), (five.basis_by_effort || {})[key] || {}];
  return [null, null];
}

// ---------------------------------------------------------------------------- window recovery and the need tail

/** One window on its own clock; null when it is unreadable. */
export function fiveAxisWindowRecovery(state, capUsd) {
  if (!capUsd || capUsd <= 0 || !state || !state.known) return null;
  const full = Number(state.full ?? 100.0) || 100.0;
  const poolCap = capUsd * (full / 100.0);
  const remPct = Number(state.remaining ?? full);
  const usedUsd = Math.max(0.0, ((full - remPct) / 100.0) * capUsd);
  const hours = state.hours;
  const resetH = state.reset_hours;
  if (hours === null || hours === undefined || resetH === null || resetH === undefined || hours === INF || resetH === INF || Number(hours) <= 0) {
    return { capacity_usd: poolCap, used_usd: usedUsd, elapsed_frac: 0.0, line_now_usd: 0.0, period_hours: null, reset_hours: INF, unstarted: false };
  }
  const L = Number(hours);
  if (state.unstarted && usedUsd <= 1e-9) {
    return { capacity_usd: poolCap, used_usd: 0.0, elapsed_frac: 0.0, line_now_usd: 0.0, period_hours: L, reset_hours: L, unstarted: true };
  }
  const tau = Math.max(0.0, Math.min(L, Number(resetH)));
  const elapsed = (L - tau) / L;
  return { capacity_usd: poolCap, used_usd: usedUsd, elapsed_frac: elapsed, line_now_usd: poolCap * elapsed, period_hours: L, reset_hours: tau, unstarted: false };
}

// Lanczos approximation of log Gamma (Numerical Recipes gammln, about 1e-15 relative error) for x > 0.
const LANCZOS = [
  57.1562356658629235, -59.5979603554754912, 14.1360979747417471, -0.491913816097620199, 0.339946499848118887e-4, 0.465236289270485756e-4,
  -0.983744753048795646e-4, 0.158088703224912494e-3, -0.210264441724104883e-3, 0.217439618115212643e-3, -0.16431810653676389e-3,
  0.844182239838527433e-4, -0.261908384015814087e-4, 0.368991826595316234e-5,
];
export function lgamma(x) {
  if (x === 1 || x === 2) return 0;
  let y = x;
  let tmp = x + 5.2421875;
  tmp = (x + 0.5) * Math.log(tmp) - tmp;
  let ser = 0.999999999999997092;
  for (let j = 0; j < 14; j++) ser += LANCZOS[j] / ++y;
  return tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betaContinuedFraction(a, b, x) {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1.0;
  const qam = a - 1.0;
  let c = 1.0;
  let d = 1.0 - (qab * x) / qap;
  d = 1.0 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m < 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1.0 + aa * d;
    d = 1.0 / (Math.abs(d) < tiny ? tiny : d);
    c = 1.0 + aa / c;
    c = Math.abs(c) < tiny ? tiny : c;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1.0 + aa * d;
    d = 1.0 / (Math.abs(d) < tiny ? tiny : d);
    c = 1.0 + aa / c;
    c = Math.abs(c) < tiny ? tiny : c;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1.0) < 1e-13) break;
  }
  return h;
}

/** I_x(a, b) for real a, b > 0 and 0 <= x <= 1. */
export function regularizedIncompleteBeta(a, b, x) {
  if (x <= 0.0) return 0.0;
  if (x >= 1.0) return 1.0;
  const logFront = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x);
  const direct = x < (a + 1.0) / (a + b + 2.0);
  if (logFront < -700.0) return direct ? 0.0 : 1.0;
  const front = Math.exp(logFront);
  if (direct) return Math.min(1.0, (front * betaContinuedFraction(a, b, x)) / a);
  return Math.max(0.0, 1.0 - (front * betaContinuedFraction(b, a, 1.0 - x)) / b);
}

/** P(the demand that reaches this window before its reset is at least `roomUsd`). `rec.lump_usd` is required. */
export function fiveAxisNeedTail(rec, roomUsd) {
  if (!isNum(rec.lump_usd)) throw new Error("the window record has no lump_usd");
  const lump = Math.min(Number(rec.capacity_usd), Number(rec.lump_usd));
  if (roomUsd <= 0) return 1.0;
  const cap = Number(rec.capacity_usd);
  const e = Number(rec.elapsed_frac || 0.0);
  if (cap <= 0 || e >= 1.0 || lump <= 0) return 0.0;
  const s = lump / cap;
  return regularizedIncompleteBeta(roomUsd / lump, Number(rec.used_usd) / lump + 1.0, (1.0 - e) / (1.0 + s));
}

export function fiveAxisNeedProbability(rec, levelUsd) {
  return fiveAxisNeedTail(rec, Number(rec.capacity_usd) - Number(levelUsd));
}

export function fiveAxisSubstituteSlack(rec, spendUsd) {
  const cap = Number(rec.capacity_usd);
  const room = cap - Number(rec.used_usd) - Number(spendUsd);
  if (cap <= 0 || room <= 0) return 0.0;
  return 1.0 - fiveAxisNeedTail(rec, room);
}

/** V: the expected best fit still available elsewhere when this account's work is displaced. */
export function fiveAxisOutsideValue(alternatives, ownBestFit) {
  let value = 0.0;
  let noneOpen = 1.0;
  const ordered = [...alternatives].sort((x, y) => y[0] - x[0] || y[1] - x[1]);
  for (const [fit, slack] of ordered) {
    value += noneOpen * slack * Math.min(fit, ownBestFit);
    noneOpen *= 1.0 - slack;
  }
  return value;
}

/** Upper concave envelope, ascending in spend, of (spend, fit) points above the outside option. */
export function fiveAxisUpperHull(points, outsideFit) {
  const best = points.filter(([s, f]) => s > 0 && f > outsideFit + 1e-15);
  if (best.length === 0) return [];
  const fmax = Math.max(...best.map(([, f]) => f));
  const top = Math.min(...best.filter(([, f]) => f >= fmax - 1e-9).map(([s]) => s));
  const chosen = [];
  let running = outsideFit;
  const ordered = best.filter((p) => p[0] <= top + 1e-12).sort((p, q) => p[0] - q[0] || q[1] - p[1]);
  for (const [s, f] of ordered) {
    const eps = running === outsideFit ? 1e-15 : 1e-12;
    if (f > running + eps) {
      chosen.push([s, f]);
      running = f;
    }
  }
  const hull = [[0.0, outsideFit]];
  for (const [s, f] of chosen) {
    while (hull.length >= 2 && (hull[hull.length - 1][1] - hull[hull.length - 2][1]) * (s - hull[hull.length - 2][0]) <= (f - hull[hull.length - 2][1]) * (hull[hull.length - 1][0] - hull[hull.length - 2][0])) {
      hull.pop();
    }
    hull.push([s, f]);
  }
  return hull;
}

/** The account's merged value ladder from one upper hull per demand point. */
export function fiveAxisValueLadder(hulls) {
  const steps = [];
  let full = 0.0;
  for (const hull of hulls) {
    if (hull.length < 2) continue;
    full += hull[hull.length - 1][0];
    for (let i = 0; i + 1 < hull.length; i++) {
      const lo = hull[i];
      const hi = hull[i + 1];
      steps.push([(hi[1] - lo[1]) / (hi[0] - lo[0]), hi[0] - lo[0]]);
    }
  }
  const ladder = [];
  let givenUp = 0.0;
  steps.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  let i = 0;
  while (i < steps.length) {
    const slope = steps[i][0];
    let j = i;
    let group = 0.0;
    while (j < steps.length && steps[j][0] - slope <= 1e-12 * Math.max(1.0, Math.abs(slope))) {
      group += steps[j][1];
      j += 1;
    }
    ladder.push([(full - givenUp) / full, slope]);
    givenUp += group;
    i = j;
  }
  return { steps: ladder, full_usd: full };
}

/** lambda_w(y): fit lost elsewhere per unit at cumulative use y. */
export function fiveAxisQuotaPrice(rec, ladder, levelUsd) {
  const cap = Number(rec.capacity_usd);
  const e = Number(rec.elapsed_frac || 0.0);
  if (cap <= 0 || e >= 1.0) return 0.0;
  const room = cap - Number(levelUsd);
  let price = 0.0;
  let prev = 0.0;
  for (const [rho, slope] of ladder.steps) {
    price += (slope - prev) * fiveAxisNeedTail(rec, room / rho);
    prev = slope;
  }
  return price;
}

export const FIVE_AXIS_PRICE_NODES = 48;

function quadraticIntegral(lam, k, t) {
  const c = Math.min(Math.max(k, 1), lam.length - 2);
  const a = (lam[c + 1] - lam[c - 1]) / 2.0;
  const b = (lam[c + 1] - 2.0 * lam[c] + lam[c - 1]) / 2.0;
  const prim = (s) => lam[c] * s + (a * s * s) / 2.0 + (b * s ** 3) / 3.0;
  const s0 = k - c;
  return prim(s0 + t) - prim(s0);
}

export function fiveAxisPriceTable(rec, ladder, spendMax, nodesIn = FIVE_AXIS_PRICE_NODES) {
  if (spendMax <= 0 || ladder.steps.length === 0) return null;
  const nodes = nodesIn + (nodesIn % 2);
  const step = spendMax / nodes;
  const used = Number(rec.used_usd);
  const lam = [];
  for (let k = 0; k <= nodes; k++) lam.push(fiveAxisQuotaPrice(rec, ladder, used + k * step));
  const cum = [0.0];
  for (let k = 0; k < nodes; k++) cum.push(cum[cum.length - 1] + quadraticIntegral(lam, k, 1.0) * step);
  return { start: used, step, nodes, lam, cum };
}

export function fiveAxisTableIntegral(table, spendUsd) {
  if (!table || spendUsd <= 0) return 0.0;
  const x = Math.min(spendUsd, table.step * table.nodes) / table.step;
  const k = Math.min(Math.trunc(x), table.nodes - 1);
  return table.cum[k] + quadraticIntegral(table.lam, k, x - k) * table.step;
}

/** The cost of `spendUsd` of window `rec`, split by time across the reset. */
export function fiveAxisSpendCost(rec, ladder, spendUsd, taskHours, spendMax = null, tables = null, freshLump = null) {
  tables = tables || {};
  const spend = Math.max(0.0, Number(spendUsd));
  spendMax = Math.max(spend, Number(spendMax || 0.0));
  const rawHours = Number(taskHours || 0.0);
  const hours = Math.max(1e-9, rawHours);
  const tau = rec.reset_hours;
  const crossing = rawHours > 0 && tau !== null && tau !== undefined && tau !== INF && Number(tau) < hours - 1e-12;
  const before = crossing ? spend * (Number(tau) / hours) : spend;
  const after = spend - before;
  if (!("now" in tables)) tables.now = fiveAxisPriceTable(rec, ladder, spendMax);
  const table = tables.now;
  const lam0 = table ? table.lam[0] : fiveAxisQuotaPrice(rec, ladder, rec.used_usd);
  let cost = fiveAxisTableIntegral(table, before);
  const needStart = fiveAxisNeedProbability(rec, rec.used_usd);
  let needEnd = fiveAxisNeedProbability(rec, Number(rec.used_usd) + before);
  if (crossing && after > 0) {
    const cap = Number(rec.capacity_usd);
    const fresh = { capacity_usd: cap, used_usd: 0.0, elapsed_frac: 0.0, lump_usd: freshLump === null ? rec.lump_usd : freshLump };
    if (!("fresh" in tables)) tables.fresh = fiveAxisPriceTable(fresh, ladder, spendMax);
    cost += fiveAxisTableIntegral(tables.fresh, after);
    needEnd = fiveAxisNeedProbability(fresh, Math.min(after, cap));
  }
  return { cost, lambda_start: lam0, need_start: needStart, need_end: needEnd, spend_before: before, spend_after: after };
}

// The demands a window's value ladder is read over: every mix of the three thinking categories (tool_operation 0).
export const FIVE_AXIS_DEMAND_GRID = (() => {
  const grid = [];
  for (let d1 = 0; d1 < 4; d1++) for (let d2 = 0; d2 < 4; d2++) for (let d3 = 0; d3 < 4; d3++) if (d1 || d2 || d3) grid.push({ divergence: d1, coding: d2, aesthetics: d3, tool_operation: 0 });
  return grid;
})();

const keyOf = (qsrc, wid) => `${qsrc}\u0001${wid}`;
const roundTo = (v, n) => pyRound(v, n);

/** The first element with the greatest key (Python's `max(..., key=)`), the key a `[a, b]` pair compared in order. */
function maxByPair(rows, keyFn) {
  let best = null;
  let bestKey = null;
  for (const row of rows) {
    const key = keyFn(row);
    if (best === null || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = row;
      bestKey = key;
    }
  }
  return best;
}

/** Quota economy v3 for one plan: the account's own pool (task flags neutralised by `rank`) and the windows it draws. */
export class FiveAxisEconomy {
  constructor(pool, accounts, policy, task, extra = []) {
    this.grid = FIVE_AXIS_DEMAND_GRID;
    const targets = this.grid.map((d) => fiveAxisTargets(d, FIVE_AXIS_ANCHOR.targets));
    this.taskGi = this.grid.length;
    const fitCache = new Map();
    this.entries = [];
    this.spendMax = new Map();
    this.units = new Map();
    this.unitWkeys = new Map();
    this.points = new Map();
    this.wkeyParts = new Map();
    this.tables = new Map();
    this.ladders = new Map();
    this.alts = new Map();
    this.lumps = new Map();
    for (const c of [...pool, ...extra]) {
      const qsrc = quotaSource(c.bundle.account, accounts);
      const states = {};
      for (const [wid, [, st, cap]] of Object.entries(c._five_window_states || {})) if (!st.short) states[wid] = [st, cap];
      if (Object.keys(states).length === 0) continue;
      const values = c._five_values || {};
      const key = JSON.stringify(values);
      if (!fitCache.has(key)) {
        fitCache.set(
          key,
          this.grid.map((d, i) =>
            Object.entries(d).every(([a, w]) => !(w > 0) || values[a] !== null && values[a] !== undefined) ? fiveAxisFit(values, d, targets[i])[0] : -1.0,
          ),
        );
      }
      const wSpend = c._five_window_spend;
      const spend = wSpend !== undefined && wSpend !== null ? Number(wSpend) : Number(c.expected_usd || 0.0);
      const hours = c._five_cadence_instant ? 0.0 : Number(c._five_econ_hours || c.expected_hours || 0.0);
      const entry = {
        cand: c,
        qsrc,
        startable: !c._five_long_wait,
        unmetered: Boolean(c._five_unmetered),
        metered: Boolean(c._five_metered),
        spend,
        states,
        hours,
        fits: [...fitCache.get(key), Number(c.components.fit || 0.0)],
        unit: `${qsrc}\u0002${Object.keys(states).sort().join("\u0003")}`,
      };
      this.entries.push(entry);
      for (const wid of Object.keys(states)) {
        const wk = keyOf(qsrc, wid);
        this.wkeyParts.set(wk, [qsrc, wid]);
        this.spendMax.set(wk, Math.max(this.spendMax.get(wk) || 0.0, entry.spend));
      }
    }
    for (const e of this.entries) {
      if (e.startable && !e.unmetered && !e.metered) {
        if (!this.units.has(e.unit)) this.units.set(e.unit, []);
        this.units.get(e.unit).push(e);
        this.unitWkeys.set(e.unit, new Set(Object.keys(e.states).map((wid) => keyOf(e.qsrc, wid))));
      }
    }
    const drawn = new Map();
    for (const e of this.entries) {
      for (const wid of Object.keys(e.states)) {
        const wk = keyOf(e.qsrc, wid);
        if (!drawn.has(wk)) drawn.set(wk, []);
        drawn.get(wk).push(e);
      }
    }
    for (const [wk, rows] of drawn) {
      const startable = rows.filter((e) => e.startable);
      this.points.set(wk, startable.length > 0 ? startable : rows);
    }
  }

  rec(entry, wid) {
    const [st, cap] = entry.states[wid];
    return this.record(keyOf(entry.qsrc, wid), st, cap);
  }

  record(wkey, st, cap) {
    const rec = fiveAxisWindowRecovery(st, cap);
    if (rec !== null) rec.lump_usd = this.lump(wkey, rec.reset_hours);
    return rec;
  }

  /** q_w, the window's burst size: what one task like the demand grid's spends of this window on the account's best candidate. */
  lump(wkey, resetHours = null) {
    const tau = resetHours === null || resetHours === undefined ? INF : Number(resetHours);
    const key = `${wkey}\u0004${tau}`;
    let got = this.lumps.get(key);
    if (got === undefined) {
      const wid = this.wkeyParts.get(wkey)[1];
      const own = (this.points.get(wkey) || []).filter((e) => e.spend > 0);
      let total = 0.0;
      for (let gi = 0; gi < this.grid.length; gi++) {
        if (own.length > 0) {
          const top = maxByPair(own, (e) => [roundTo(e.fits[gi], 9), -e.spend]);
          const share = top.hours <= 0 || tau === INF ? 1.0 : Math.min(1.0, tau / top.hours);
          total += top.spend * share;
        }
      }
      const cap = own.length > 0 ? Math.max(...own.map((e) => Number(e.states[wid][1]))) : 0.0;
      got = own.length > 0 ? Math.min(cap, total / this.grid.length) : 0.0;
      this.lumps.set(key, got);
    }
    return got;
  }

  alt(unit, gi) {
    const key = `${unit}\u0005${gi}`;
    let got = this.alts.get(key);
    if (got === undefined) {
      const rows = this.units.get(unit);
      const best = maxByPair(rows, (e) => [roundTo(e.fits[gi], 9), -e.spend]);
      let slack = 1.0;
      for (const wid of Object.keys(best.states)) {
        const rec = this.rec(best, wid);
        if (rec !== null) slack = Math.min(slack, fiveAxisSubstituteSlack(rec, best.spend));
      }
      got = [best.fits[gi], slack];
      this.alts.set(key, got);
    }
    return got;
  }

  outside(wkey, gi) {
    const out = [];
    for (const unit of this.units.keys()) if (!this.unitWkeys.get(unit).has(wkey)) out.push(this.alt(unit, gi));
    return out;
  }

  ladder(wkey) {
    let got = this.ladders.get(wkey);
    if (got === undefined) {
      const own = this.points.get(wkey) || [];
      const hulls = [];
      for (let gi = 0; gi < this.grid.length; gi++) {
        const pts = own.filter((e) => e.spend > 0).map((e) => [e.spend, e.fits[gi]]);
        if (pts.length > 0) {
          const outside = fiveAxisOutsideValue(this.outside(wkey, gi).filter(([f]) => f > 0), Math.max(...pts.map(([, f]) => f)));
          hulls.push(fiveAxisUpperHull(pts, outside));
        }
      }
      got = fiveAxisValueLadder(hulls);
      this.ladders.set(wkey, got);
    }
    return got;
  }

  /** `[V, own best fit, P(some outside candidate has room)]` at the task's own demand. */
  outsideAtTask(wkey) {
    const own = (this.points.get(wkey) || []).filter((e) => e.spend > 0);
    const alts = this.outside(wkey, this.taskGi).filter(([f]) => f > 0);
    const best = own.length > 0 ? Math.max(...own.map((e) => e.fits[this.taskGi])) : 0.0;
    let noneOpen = 1.0;
    for (const [, a] of alts) noneOpen *= 1.0 - a;
    return [fiveAxisOutsideValue(alts, best), best, 1.0 - noneOpen];
  }

  windowCost(wkey, rec, spend, econHours) {
    const tkey = `${wkey}\u0006${roundTo(rec.used_usd, 6)}\u0006${roundTo(rec.elapsed_frac, 9)}\u0006${roundTo(rec.capacity_usd, 6)}\u0006${roundTo(rec.lump_usd, 6)}`;
    let tables = this.tables.get(tkey);
    if (!tables) this.tables.set(tkey, (tables = {}));
    return fiveAxisSpendCost(rec, this.ladder(wkey), spend, econHours, this.spendMax.get(wkey) ?? spend, tables, this.lump(wkey));
  }

  /** One block per priced window for the plan's `quota_windows`: its state and its price now. */
  report() {
    const out = [];
    const keys = [...this.points.keys()].sort((p, q) => {
      const [pa, pw] = this.wkeyParts.get(p);
      const [qa, qw] = this.wkeyParts.get(q);
      return pa < qa ? -1 : pa > qa ? 1 : pw < qw ? -1 : pw > qw ? 1 : 0;
    });
    for (const wkey of keys) {
      const [qsrc, wid] = this.wkeyParts.get(wkey);
      const rec = this.rec(this.points.get(wkey)[0], wid);
      if (rec === null) continue;
      const ladder = this.ladder(wkey);
      const [outside, best, slack] = this.outsideAtTask(wkey);
      const period = rec.period_hours;
      out.push({
        label: `${qsrc}/${wid}`,
        quota_source: qsrc,
        window: wid,
        capacity_usd: roundTo(rec.capacity_usd, 2),
        used_usd: roundTo(rec.used_usd, 2),
        recovery_line_usd: roundTo(rec.line_now_usd, 2),
        period_hours: period === null ? null : roundTo(period, 2),
        elapsed_hours: period === null ? null : roundTo(period - rec.reset_hours, 2),
        reset_in_hours: rec.reset_hours === INF ? null : roundTo(rec.reset_hours, 2),
        need_probability: roundTo(fiveAxisNeedProbability(rec, rec.used_usd), 4),
        lump_usd: roundTo(rec.lump_usd, 2),
        quota_price: ladder.steps.length > 0 ? roundTo(fiveAxisQuotaPrice(rec, ladder, rec.used_usd), 6) : 0.0,
        ladder_steps: ladder.steps.length,
        outside_fit: roundTo(outside, 4),
        best_fit: roundTo(best, 4),
        substitute_slack: roundTo(slack, 4),
        candidates: this.points.get(wkey).length,
      });
    }
    return out;
  }
}

/** The quota source an account draws on: itself unless the fleet declares it pooled onto another. */
export function quotaSource(account, accounts) {
  const declared = ((accounts && accounts.accounts) || {})[account];
  const src = declared && typeof declared.quota_source === "string" ? declared.quota_source : null;
  const top = ((accounts && accounts.quota_sources) || {})[account];
  const named = src || (typeof top === "string" ? top : null);
  return named && named !== account ? named : account;
}

const PRIVATE_KEYS = [
  "_five_axis_windows",
  "_five_window_states",
  "_five_econ_hours",
  "_five_chain_hours",
  "_five_context_burn",
  "_five_values",
  "_five_short_reasons",
  "_five_long_wait",
  "_five_unmetered",
  "_five_metered",
  "_five_window_spend",
  "_five_cadence_instant",
  "_five_blind_msg",
];

/**
 * Quota economy v3: cost_i = integral over the candidate's own spend of the window's quota price, N = F - cost. Sets
 * `capacity`, `economy`, `expected_pct`, `chain_pct` and the cost components on each eligible candidate; returns the
 * per-window report.
 */
export function applyFiveAxisEconomy(candidates, eligible, task, accounts, policy, pool = null) {
  const econ = new FiveAxisEconomy(pool === null ? eligible : pool, accounts, policy, task);
  const baseHours = Math.max(1e-6, Number(task.hours || 0.0));

  function evalWindows(wStates, ownQsrc, spend, chainUsd, econH) {
    const rows = [];
    for (const [wid, [, st, capUsdW]] of Object.entries(wStates)) {
      econ.wkeyParts.set(keyOf(ownQsrc, wid), [ownQsrc, wid]);
      const rec = st.short ? fiveAxisWindowRecovery(st, capUsdW) : econ.record(keyOf(ownQsrc, wid), st, capUsdW);
      if (rec === null) continue;
      const rem = st.remaining;
      const remUsd = (rem * capUsdW) / 100.0;
      const stepPct = capUsdW > 0 ? (100.0 * spend) / capUsdW : 0.0;
      const chainPct = capUsdW > 0 ? (100.0 * chainUsd) / capUsdW : 0.0;
      const resetH = rec.reset_hours;
      const endH = st.end_hours;
      const period = rec.period_hours;
      const row = {
        window: wid,
        quota_source: ownQsrc,
        short: Boolean(st.short),
        unstarted: Boolean(rec.unstarted),
        remaining: rem,
        full: st.full,
        after: rem - stepPct,
        step_pct: stepPct,
        chain_pct: chainPct,
        capacity_usd: roundTo(capUsdW, 2),
        remaining_usd: roundTo(remUsd, 2),
        reserved_usd: roundTo(st.reserved_usd || 0.0, 2),
        expected_usd: roundTo(spend, 2),
        chain_usd: roundTo(chainUsd, 2),
        after_usd: roundTo(remUsd - spend, 2),
        used_usd: roundTo(rec.used_usd, 2),
        line_now_usd: roundTo(rec.line_now_usd, 2),
        period_hours: period === null ? null : roundTo(period, 2),
        elapsed_hours: period === null ? null : roundTo(period - resetH, 2),
        reset_hours: resetH === INF ? null : resetH,
        end_hours: endH === INF ? null : endH,
        expires_first: endH < resetH,
        stale: st.stale,
        priced: false,
        cost: 0.0,
        opportunity_cost: 0.0,
      };
      for (const k of ["natural_reset_hours", "expected_reset_at"]) if (k in st) row[k] = st[k];
      if (!row.short && spend > 0) {
        const got = econ.windowCost(keyOf(ownQsrc, wid), rec, spend, econH);
        const unitCost = Number(1.0 + Number(got.cost)) - 1.0;
        Object.assign(row, {
          priced: true,
          cost: unitCost,
          opportunity_cost: unitCost,
          quota_price: roundTo(got.lambda_start, 6),
          need_start: roundTo(got.need_start, 4),
          need_end: roundTo(got.need_end, 4),
          spend_before_reset: roundTo(got.spend_before, 2),
          spend_after_reset: roundTo(got.spend_after, 2),
        });
      }
      rows.push(row);
    }
    if (rows.length === 0) return null;
    // max(rows, key=(cost, not short, -after)): the first of the greatest
    let binding = rows[0];
    const keyOfRow = (r) => [r.cost, r.short ? 0 : 1, -r.after];
    for (const r of rows.slice(1)) {
      const a = keyOfRow(r);
      const b = keyOfRow(binding);
      const greater = a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));
      if (greater) binding = r;
    }
    const priced = rows.filter((r) => r.priced);
    return [
      binding,
      {
        windows: priced.map((r) => ({
          quota_source: r.quota_source,
          window: r.window,
          capacity_usd: r.capacity_usd,
          used_usd: r.used_usd,
          period_hours: r.period_hours,
          elapsed_hours: r.elapsed_hours,
          cost: r.cost,
          quota_price: r.quota_price,
          need_start: r.need_start,
          need_end: r.need_end,
          spend_before_reset: r.spend_before_reset,
          spend_after_reset: r.spend_after_reset,
          spend_usd: r.expected_usd,
          reset_in_hours: r.reset_hours === null ? null : roundTo(r.reset_hours, 2),
        })),
        cost: binding.cost,
        need_end_max: priced.length > 0 ? Math.max(...priced.map((r) => r.need_end)) : 0.0,
        binding_window: binding.priced ? binding.window : null,
      },
    ];
  }

  function price(c, wStates, ownQsrc, spend, chainUsd, econH) {
    const got = evalWindows(wStates, ownQsrc, spend, chainUsd, econH);
    const [binding, summary] = got || [null, { windows: [], cost: 0.0, need_end_max: 0.0, binding_window: null }];
    if (binding !== null) {
      c.capacity = binding;
      c.expected_pct = roundTo(binding.step_pct, 2);
      c.chain_pct = roundTo(binding.chain_pct, 2);
    }
    const cost = Number(summary.cost);
    c.economy = summary;
    c.components.opportunity_cost = cost;
    c.components.quota_price = binding && binding.priced ? binding.quota_price : 0.0;
    c.components.need_probability = binding && binding.priced ? binding.need_start : 0.0;
    c.components.need_probability_end = summary.need_end_max;
    const resets = summary.windows.map((w) => w.reset_in_hours).filter((h) => h !== null);
    c.components.earliest_reset_hours = resets.length > 0 ? Math.min(...resets) : null;
    if (binding !== null && binding.priced) {
      const [, , slack] = econ.outsideAtTask(keyOf(ownQsrc, binding.window));
      c.components.substitute_slack = roundTo(slack, 4);
    }
    if (c.five_axis_price && typeof c.five_axis_price === "object") {
      Object.assign(c.five_axis_price, {
        cost,
        quota_price: c.components.quota_price,
        need_probability: c.components.need_probability,
        need_probability_end: c.components.need_probability_end,
      });
    }
  }

  for (const c of [...eligible]) {
    const wStates = c._five_window_states || {};
    const ownQsrc = quotaSource(c.bundle.account, accounts);
    const wSpendOverride = c._five_window_spend;
    const cadInstant = Boolean(c._five_cadence_instant);
    const econH = cadInstant ? 0.0 : Number(c._five_econ_hours || baseHours);
    const stepUsd = wSpendOverride !== undefined && wSpendOverride !== null ? Number(wSpendOverride) : Number(c.expected_usd || 0.0);
    const chainUsd = wSpendOverride !== undefined && wSpendOverride !== null ? Number(wSpendOverride) : Number(c.chain_usd || stepUsd);
    price(c, wStates, ownQsrc, stepUsd, chainUsd, econH);
  }
  const report = econ.report();
  for (const c of candidates) for (const priv of PRIVATE_KEYS) delete c[priv];
  return report;
}
