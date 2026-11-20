// Vendored from akiiwa-games/magpie-agentcompass-router src/released-names.js at 7549882db0fb239ba346b5561ecdc5cbcad255ff (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Model names a released version resolved through an alias that a later release removed or re-targeted, and the row that release
 * resolved each to (`released_names.py`): what the operator meant by the name when they wrote it into a table the plugin keeps
 * (the `userScores` option).
 *
 * `V0_7_0` is the diff of the `aliases` tables of AgentCompass `references/accounts.json` between the `v0.7.0` tag (the engine of
 * plugin 0.3.0) and the pinned commit: every name v0.7.0 resolved through an alias to one of its rows that the pinned data resolves
 * otherwise. `test/engine-071.test.mjs` checks it against `released_names.py` at the pinned commit.
 *
 * Pure ES2022 module with zero external or Node-only dependencies (Bun and Magpie's `moejs`).
 */

export const V0_7_0 = {
  "claude-fable-5": "claude-fable-5-2", // now a row of its own
  "claude-opus-5": "claude-opus-5-5", // now a row of its own
  "claude-sonnet-5": "claude-sonnet-5-5", // now a row of its own
  "deepseek-flash": "deepseek-v4.1-flash-free", // re-targeted to deepseek-v4.1-flash-1017
  "deepseek-v4-flash": "deepseek-v4.1-flash-free", // now a row of its own
  "deepseek-v4.1-flash": "deepseek-v4.1-flash-free", // now a row of its own
  "gemini-4-pro": "gemini-4-argon-high", // alias removed
  "gemini-4-ultra": "gemini-4-argon-high", // alias removed
  "glm-5.3-flash": "glm-5.3-flash-free", // now a row of its own
  "grok-4": "grok-4.7", // alias removed
  "kimi-k3.1-pro-highspeed": "kimi-k3.1-pro", // now a row of its own
  "mimo-v2.6-pro-ultraspeed": "mimo-v2.6-pro", // now a row of its own
};

/**
 * `v0_7_0_row`: the row v0.7.0 resolved `name` to where the pinned data resolves it otherwise, else null. v0.7.0 read a name as a
 * row, then an alias, then its last `/` segment as a row, then that segment as an alias.
 */
export function v070Row(name) {
  const raw = String(name);
  const leaf = raw.split("/").pop();
  return (Object.hasOwn(V0_7_0, raw) && V0_7_0[raw]) || (Object.hasOwn(V0_7_0, leaf) && V0_7_0[leaf]) || null;
}
