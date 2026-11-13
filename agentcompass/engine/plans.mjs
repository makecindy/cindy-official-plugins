// Vendored from akiiwa-games/magpie-agentcompass-router src/plans.js at ac494f31dda6dc516e985594208e28fca85aa5fb (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Plan names and plan templates (`provider_inventory.configured_plan`, `plan_defaults`, `usage_magpie.window_name`): which plan a
 * reported label names, the windows that plan has, and the window id a reading's window name stands for. Pure data lookups over
 * the pinned `plan-templates.json`; nothing here scores.
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

import { PLAN_TEMPLATES } from "./catalog.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const PLAN_VENDOR_WORDS = new Set(["antigravity", "chatgpt", "claude", "google", "ai", "openai", "plan", "grok", "xai"]);
// The plan names each family reports or a user may write, word for word once the vendor's name is dropped.
const PLAN_NAMES = {
  claude: {
    pro: "pro", max: "max", max5: "max5", "max 5x": "max5", "max x5": "max5", "5x": "max5", x5: "max5", max20: "max20", "max 20x": "max20",
    "max x20": "max20", "20x": "max20", x20: "max20", free: "free", team: "team", enterprise: "enterprise",
  },
  codex: {
    plus: "plus", pro: "pro", pro100: "pro100", "pro 100": "pro100", 100: "pro100", prolite: "pro100", "pro lite": "pro100", free: "free",
    team: "team", enterprise: "enterprise",
  },
};
const POOL_SUFFIX = /\s*×\s*\d+\s*$/;

export const stripPoolCount = (label) => String(label ?? "").replace(POOL_SUFFIX, "");
export const planWords = (label) => (String(label ?? "").replace(/×/g, "x").toLowerCase().match(/[a-z0-9]+/g) || []).join(" ");
export const planWithoutVendor = (label) => planWords(label).split(" ").filter((w) => w && !PLAN_VENDOR_WORDS.has(w)).join(" ");

export const planTable = (family) => PLAN_TEMPLATES[family] || {};

/** The template of a plan (`{alias}` resolved up to three hops), or null. */
export function planDefaults(family, plan) {
  const base = planTable(family);
  let template = null;
  let id = plan;
  for (let i = 0; i < 3; i++) {
    template = isObj(base[id]) ? base[id] : {};
    id = template.alias;
    if (typeof id !== "string" || Object.keys(template).length === 0) break;
  }
  const { alias: _alias, ...rest } = template || {};
  return Object.keys(rest).length > 0 ? JSON.parse(JSON.stringify(rest)) : null;
}

/** The plan id a reported label names (`PLAN_NAMES`, then the templates' tier names); the label itself when none does. */
export function configuredPlan(family, label) {
  const raw = String(label ?? "").toLowerCase();
  if (!raw.trim()) return raw;
  const names = PLAN_NAMES[family];
  if (names) {
    for (const candidate of [raw, stripPoolCount(raw)]) {
      const words = planWords(candidate);
      if (words in names) return names[words];
      const without = planWithoutVendor(candidate);
      if (without in names) return names[without];
    }
  }
  const table = planTable(family);
  if (Object.keys(table).length > 0) {
    const tierMap = {};
    for (const [planId, entry] of Object.entries(table)) {
      if (!isObj(entry)) continue;
      for (const token of [planId, ...(Array.isArray(entry.tiers) ? entry.tiers : [])]) {
        if (typeof token === "string" && token.trim()) {
          const w = planWords(token);
          if (w && !(w in tierMap)) tierMap[w] = planId;
        }
      }
    }
    for (const candidate of [raw, stripPoolCount(raw)]) {
      const words = planWords(candidate);
      const strippedEnum = words.replace(/^subscription tier /, "").trim();
      const without = planWithoutVendor(candidate);
      for (const key of [words, strippedEnum, without]) if (key && key in tierMap) return tierMap[key];
    }
  }
  return raw;
}

export const planUnknownText = (raw) => {
  const label = String(raw || "").trim();
  return ["", "unknown", "subscription"].includes(planWithoutVendor(label)) ? "subscription tier not reported" : `unrecognized tier '${label}'`;
};

const FIVE_HOUR_NAMES = new Set(["5h", "five_hour", "5 hours", "5-hour", "session", "usage-5h", "usage-300m"]);
const WEEK_NAMES = new Set(["7d", "seven_day", "7 days", "7-day", "week", "weekly", "usage", "usage-10080m"]);
const SCOPED_WEEK = /^7 days\s*[·•-]\s*(.+)$/i;

/** The window id the plan's template and the community data use for a reading's window name. */
export function canonicalWindowId(raw, templateWindows) {
  const id = String(raw ?? "").trim();
  if (id in templateWindows) return id;
  const low = id.toLowerCase();
  if (FIVE_HOUR_NAMES.has(low)) return "five_hour";
  if (WEEK_NAMES.has(low)) return "seven_day" in templateWindows || !("usage" in templateWindows) ? "seven_day" : "usage";
  const scoped = SCOPED_WEEK.exec(id);
  if (scoped) {
    const slug = scoped[1].toLowerCase().replace(/\s+/g, "");
    if (/^[a-z0-9]+$/.test(slug)) return `weekly_${slug}`;
  }
  return id;
}

/** The scope (`models`, `models_except`) the plan's template gives a reading's window, or `{}` when it declares none. */
export function templateWindowScope(family, planLabel, rawWindowId) {
  const plan = configuredPlan(family, planLabel);
  const windows = ((planDefaults(family, plan) || {}).windows) || {};
  const spec = windows[canonicalWindowId(rawWindowId, windows)] || {};
  return { ...(spec.models ? { models: spec.models } : {}), ...(spec.models_except ? { models_except: spec.models_except } : {}) };
}
