// Vendored from akiiwa-games/magpie-agentcompass-router src/profiler-core.js at ac494f31dda6dc516e985594208e28fca85aa5fb (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Multi-Protocol Request Extractor & Task Profile Schema
 *
 * A task profile comes from the classifier (`src/scorer-live.js`) or from the caller, never from the task's text:
 * without one the router does not route (`unroutedDecision`). The profile is `task_intake.py`'s: two integers
 * (`reasoning_depth`, `code_complexity`), the flags, the task count, and `axis_demand`, how much the task needs of each of the
 * four capability categories (0..3). Nothing else scores.
 * Pure ES2022 module (zero Node-only imports) so it runs identically in both Bun and `moejs`.
 */

import { DIFFICULTY_ORDER, INTERACTION_STYLES, ROUTES } from "./catalog.mjs";
import { FIVE_AXIS_DEMAND_SCHEMA, validateAxisDemand } from "./axis-scores.mjs";
import { analyzeTurnState } from "./continuity.mjs";

export const PROFILE_INTEGERS = {
  reasoning_depth: [1, 4],
  code_complexity: [0, 3],
};

export const PROFILE_FLAGS = ["needs_visual", "needs_gui", "local_only", "wants_fast", "read_only_review"];
export const PROFILE_KINDS = Object.keys(ROUTES);
export const ACCESS_LEVELS = ["read-only", "write"];
export const HOURS_RANGE = [0.05, 24.0];
export const CONFIDENCE_LEVELS = ["low", "medium", "high"];
export const URGENCY_LEVELS = ["unknown", "low", "normal", "high"];
export const TASK_COUNTS = ["1", "2", "3", ">3"];
export { DIFFICULTY_ORDER };

export const WANTS_FAST_QUESTION =
  'True ONLY when the assignment affirmatively requests fast mode, priority service tier, urgent/ASAP turnaround, or a pre-reset quota sprint (e.g. "pre-reset sprint", "before quota resets", "重置前冲刺") for the task itself, and does not negate or opt out of fast mode (e.g. "do not use fast mode", "no fast mode", or "not urgent" -> false). False for action adverbs inside runtime steps (e.g. "click Save immediately when the button appears"), ordinary mentions of quota/reset without requesting fast execution, or ordinary tasks without an explicit speed/fast request.';

export const READ_ONLY_REVIEW_QUESTION =
  "True ONLY when the assignment is a read-only code, diff, branch, security, or release review/audit that inspects existing material and reports findings without writing or modifying repository production/test code (code_complexity = 0, even if the reviewer saves its review report file to a specified output path). False when the worker implements, fixes, or refactors code (including fixing issues found by a prior review), runs operational/release commands, or performs general exploration/research that is not a code/diff/release audit.";

export const ACCESS_QUESTION =
  'Whether this brief only reads, inspects, reviews, or analyzes without modifying workspace files or state ("read-only"), or writes, edits, creates, or deletes workspace files or runs mutating commands ("write"). Any brief with read_only_review=true is "read-only"; any brief with code_complexity > 0 is "write".';

export const MULTI_TASK_QUESTION =
  "True when the brief bundles more than one separate task: deliverables that different workers could produce at the same time without waiting for each other's result (e.g. collect reference images, compare game engines, design the gameplay loop). False for one task, however many steps: investigate-fix-test-release, implement plus its tests, a review plus its report, the remaining steps of a handoff, a brief that already assigns one share of a larger task, or a sequence where each part needs the previous part's output.";

export const TASK_COUNT_QUESTION =
  "How many separate tasks, in the sense of multi_task, the brief holds: 1 when multi_task is false.";

/** The classifier's schema. Integers carry minimum/maximum, never an integer enum (Gemini's protobuf schema rejects those). */
export const TASK_PROFILE_SCHEMA = {
  type: "object",
  properties: {
    reasoning_depth: {
      type: "integer",
      minimum: 1,
      maximum: 4,
      description:
        "How hard the thinking is, not how long the brief is. 1 = routine or direct execution with obvious steps, even when the brief is long and sectioned (run an existing script, checklist, drift round, build/install/switch release runbook; a mechanical edit or constant tweak; click and screenshot; reformat text); 2 = standard engineering or analysis with a clear direction (implement or fix one module, a standard read-only review of a diff/module, execute a structured research packet and report metrics, diagnose one subsystem); 3 = cross-module architectural design/refactor, subtle concurrency or distributed-invariant debugging, or orchestrating a multi-stage research line; 4 = frontier mathematical, strategic or architectural critique and formulation.",
    },
    code_complexity: {
      type: "integer",
      minimum: 0,
      maximum: 3,
      description:
        "Production code the worker itself writes or modifies (NOT the complexity of code being read or reviewed). 0 = none: ANY read-only code/release/diff review or independent audit (even when saving a review report file to a specified path), diagnosis that only proposes, running existing CLI/release/test commands, log or data exploration, text drafting; 1 = a small script, config/constant tweak, localized helper, or analysis scripts inside a research packet; 2 = a production module implemented, fixed or refactored with its unit tests; 3 = complex multi-module, concurrency, protocol or core-library changes.",
    },
    needs_visual: { type: "boolean", description: "True when the work must look at images, screenshots or other visual input." },
    needs_gui: {
      type: "boolean",
      description: "True when the work must operate a desktop or browser GUI through screenshots, mouse and keyboard.",
    },
    local_only: {
      type: "boolean",
      description:
        "True when the task explicitly depends on existing files, directories, or repositories on this machine (reading, copying, searching, editing, building, or testing un-inlined local files) or on local processes/GUI/environment. False when all required inputs are inlined in the prompt or fetched from the public web (web_research, self_contained_code, text_in_text_out, direction_reasoning, complex_build_plan)—even if the brief has a workspace header or names a local target path where the finished output will be saved.",
    },
    wants_fast: { type: "boolean", description: WANTS_FAST_QUESTION },
    read_only_review: { type: "boolean", description: READ_ONLY_REVIEW_QUESTION },
    access: { type: "string", enum: [...ACCESS_LEVELS], description: ACCESS_QUESTION },
    interaction_style: {
      type: "string",
      enum: [...INTERACTION_STYLES],
      description:
        "engineering = write or change software; exploration = explore a codebase, run experiments or backtests, analyze logs or data; text_only = pure text in and out or public web lookup; advisory = direction reasoning or complex build planning.",
    },
    expected_hours: {
      type: "number",
      minimum: HOURS_RANGE[0],
      maximum: HOURS_RANGE[1],
      description:
        "Active worker-hours this task needs at an ordinary agent pace (a few tool calls = 0.1; one module fix with a test = 0.5; a multi-file feature or investigation = 1-3; a long multi-stage build = 4 or more). Estimate work, never money, quota or balances. Use 0.5 when the text gives no basis and set hours_confidence low.",
    },
    hours_confidence: {
      type: "string",
      enum: [...CONFIDENCE_LEVELS],
      description:
        "How well the text supports expected_hours: high = scope and steps are explicit; medium = scope is clear but steps are not; low = guess.",
    },
    urgency: {
      type: "string",
      enum: [...URGENCY_LEVELS],
      description:
        'unknown unless the text itself states a deadline, an incident or "asap"; then high/normal/low. Never infer urgency from topic or tone. Shown in the result so the caller can see it; fast mode is controlled by wants_fast, not urgency.',
    },
    multi_task: { type: "boolean", description: MULTI_TASK_QUESTION },
    task_count: { type: "string", enum: [...TASK_COUNTS], description: TASK_COUNT_QUESTION },
    axis_demand: FIVE_AXIS_DEMAND_SCHEMA,
  },
  required: [
    ...Object.keys(PROFILE_INTEGERS),
    ...PROFILE_FLAGS,
    "access",
    "expected_hours",
    "hours_confidence",
    "urgency",
    "interaction_style",
    "multi_task",
    "task_count",
    "axis_demand",
  ],
};

export const UNROUTED_NOTICE = "未路由：分类不可用";

/**
 * What a request is sent on with when it has no task profile: no routing decision, the client's model as it asked.
 */
export function unroutedDecision(reason) {
  return { ok: false, routed: false, notice: UNROUTED_NOTICE, reason, targetModel: null, targetEffort: null };
}

/**
 * A profile the caller passed, checked like the classifier's: `{ profile }`, `{ error }`, or `null` when there is none.
 * Image parts in the request are a structured signal, so they hold whatever the profile says: the work reads images (needs_visual,
 * tool_operation 3), and a model that cannot read them leaves the pool.
 */
export function resolveCallerProfile(raw, hasVisualInput = false) {
  if (raw === undefined || raw === null) return null;
  try {
    const profile = validateProfile(raw);
    return { profile: hasVisualInput ? { ...profile, needs_visual: true, axis_demand: { ...profile.axis_demand, tool_operation: 3 } } : profile };
  } catch (err) {
    return { error: `invalid_caller_profile: ${String(err?.message || err).slice(0, 120)}` };
  }
}

function extractSystemSummary(rawSystem, maxPreviewChars = 2000) {
  if (!rawSystem) return { preview: "", totalChars: 0 };
  if (typeof rawSystem === "string") {
    return {
      preview: rawSystem.slice(0, maxPreviewChars),
      totalChars: rawSystem.length,
    };
  }
  if (!Array.isArray(rawSystem)) return { preview: "", totalChars: 0 };
  let preview = "";
  let totalChars = 0;
  for (const part of rawSystem) {
    if (!part) continue;
    const t =
      typeof part === "string"
        ? part
        : typeof part.text === "string"
          ? part.text
          : typeof part.input_text === "string"
            ? part.input_text
            : typeof part.content === "string"
              ? part.content
              : "";
    if (t) {
      totalChars += t.length;
      if (preview.length < maxPreviewChars) {
        preview += (preview ? "\n" : "") + t.slice(0, maxPreviewChars - preview.length);
      }
    }
  }
  return { preview, totalChars };
}

/**
 * Parse a Magpie request body (`chat`, `responses`, `anthropic`, or `gemini`)
 * into a normalized routing evidence envelope in a single bounded O(N) pass.
 */
export function extractRequestFacts(body, ctx = {}) {
  if (!body || typeof body !== "object") {
    return {
      model: "",
      objective: "",
      turnText: "",
      lastUserText: "",
      previousUser: "",
      previousUserText: "",
      previousAssistantText: "",
      systemText: "",
      hasVisualInput: false,
      hasVisual: false,
      hasCurrentTurnVisual: false,
      hasComputerUse: false,
      demandsFrontierEscalation: false,
      isToolFollowup: false,
      within: false,
      turn: 0,
      toolCount: 0,
      scannedChars: 0,
      extractedTurns: 0,
      estimatedTokens: 0,
      estimatedInputTokens: 0,
      firstWords: "",
      sessionKey: "",
      agent: ctx?.agent || "",
      protocol: ctx?.protocol || "",
    };
  }

  const model = typeof body.model === "string" ? body.model : "";
  const sysSource =
    body.system !== undefined
      ? body.system
      : body.instructions !== undefined
        ? body.instructions
        : body.systemInstruction?.parts;
  const { preview: systemText, totalChars: sysChars } = extractSystemSummary(sysSource, 2000);

  const turnState = analyzeTurnState(body, ctx);
  const effectiveObjective = turnState.lastUserText || "";
  const effectivePrevUser = turnState.previousUserText || "";
  const hasVisual = Boolean(turnState.hasAnyVisual);
  const totalChars = sysChars + (turnState.totalChars || 0);
  const hasExplicitEstimatedTokens =
    Number.isFinite(body?.estimated_input_tokens) ||
    Number.isFinite(ctx?.estimated_input_tokens);
  const estimatedTokens = Number(
    body?.estimated_input_tokens ||
      ctx?.estimated_input_tokens ||
      Math.ceil(totalChars / 4)
  );

  const tools = Array.isArray(body.tools) ? body.tools : [];
  const needsObj = body?.needs && typeof body.needs === "object" ? body.needs : null;
  const callerProfile = [ctx?.state?.profile, ctx?.profile, body.profile].find((p) => p && typeof p === "object");

  return {
    model,
    objective: effectiveObjective,
    turnText: effectiveObjective,
    lastUserText: effectiveObjective,
    previousUser: effectivePrevUser,
    previousUserText: effectivePrevUser,
    previousAssistantText: turnState.previousAssistantText || "",
    systemText,
    hasVisualInput: hasVisual,
    hasVisual,
    hasCurrentTurnVisual: Boolean(turnState.hasCurrentTurnVisual),
    hasComputerUse: Boolean(needsObj?.gui === true || callerProfile?.needs_gui === true),
    demandsFrontierEscalation: Number(callerProfile?.reasoning_depth) >= 3,
    ...(callerProfile ? { callerProfile } : {}),
    isToolFollowup: Boolean(turnState.isToolFollowup || turnState.within),
    within: Boolean(turnState.within || turnState.isToolFollowup),
    turn: turnState.turn,
    toolCount: tools.length,
    scannedChars: turnState.scannedChars || 0,
    extractedTurns: turnState.extractedTurns || 0,
    estimatedTokens,
    estimatedInputTokens: estimatedTokens,
    hasExplicitEstimatedTokens,
    firstWords: turnState.firstWords,
    sessionKey: turnState.sessionKey,
    agent: ctx?.agent || "",
    protocol: ctx?.protocol || "",
  };
}

/**
 * A profile from a request's structured signals alone (image parts, explicit `needs.gui`), used only when the turn has no
 * text (`!facts.objective`) and the user set a candidate pool or a pin (contract R2, R3). It asks for nothing the signals
 * do not state: the category demand is zero except the tool operation a GUI or an image needs.
 */
export function noTextProfile(facts = {}) {
  const gui = Boolean(facts.hasComputerUse);
  const image = Boolean(facts.hasVisualInput || gui);
  return {
    work_kind: gui ? "computer_use" : "other_or_mixed",
    reasoning_depth: 1,
    code_complexity: 0,
    needs_visual: image,
    needs_gui: gui,
    local_only: gui,
    wants_fast: false,
    read_only_review: false,
    access: "read-only",
    interaction_style: "engineering",
    expected_hours: 0.4,
    hours_confidence: "medium",
    urgency: "unknown",
    multi_task: false,
    task_count: "1",
    axis_demand: { divergence: 0, coding: 0, aesthetics: 0, tool_operation: image ? 3 : 0 },
  };
}

/** The schema's task-count band for a band or a positive whole number; anything else is an invalid profile. */
export function taskCountBucket(value) {
  if (typeof value === "string" && TASK_COUNTS.includes(value)) return value;
  const whole = typeof value === "number" && Number.isInteger(value) ? value : null;
  if (whole !== null && whole >= 1) return TASK_COUNTS[Math.min(whole, 4) - 1];
  throw new Error(`task.profile.task_count must be one of ${TASK_COUNTS.join(", ")} or a positive whole number`);
}

/** A task profile with every field checked, or an `Error`. `reason`, `work_kind` and the hours estimate may be omitted. */
export function validateProfile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("task.profile must be an object");
  const profile = {};
  if (raw.work_kind !== undefined && raw.work_kind !== null) {
    if (typeof raw.work_kind !== "string" || !PROFILE_KINDS.includes(raw.work_kind)) {
      throw new Error(`task.profile.work_kind must be one of ${PROFILE_KINDS.join(", ")}`);
    }
    profile.work_kind = raw.work_kind;
  }
  for (const [name, [low, high]] of Object.entries(PROFILE_INTEGERS)) {
    const value = raw[name];
    if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high) {
      throw new Error(`task.profile.${name} must be an integer from ${low} to ${high}`);
    }
    profile[name] = value;
  }
  for (const name of PROFILE_FLAGS) {
    if (typeof raw[name] !== "boolean") throw new Error(`task.profile.${name} must be true or false`);
    profile[name] = raw[name];
  }
  if (profile.read_only_review === true && profile.code_complexity !== 0) {
    throw new Error(`task.profile.read_only_review true contradicts task.profile.code_complexity ${profile.code_complexity} (must be 0)`);
  }
  if (raw.access !== undefined && raw.access !== null) {
    if (!ACCESS_LEVELS.includes(raw.access)) throw new Error(`task.profile.access must be one of ${ACCESS_LEVELS.join(", ")}`);
    if (raw.access === "read-only" && profile.code_complexity !== 0) {
      throw new Error(`task.profile.access 'read-only' contradicts task.profile.code_complexity ${profile.code_complexity} (must be 0)`);
    }
    if (profile.read_only_review === true && raw.access === "write") {
      throw new Error("task.profile.access 'write' contradicts task.profile.read_only_review true");
    }
    profile.access = raw.access;
  }
  // The hours estimate is the classifier's to give; with no caller `expected_hours` it is the task's budget.
  if (raw.expected_hours !== undefined && raw.expected_hours !== null) {
    if (typeof raw.expected_hours !== "number" || !Number.isFinite(raw.expected_hours)) {
      throw new Error("task.profile.expected_hours must be a finite number");
    }
    profile.expected_hours = Math.round(Math.min(Math.max(raw.expected_hours, HOURS_RANGE[0]), HOURS_RANGE[1]) * 100) / 100;
  }
  for (const [name, levels] of [
    ["hours_confidence", CONFIDENCE_LEVELS],
    ["urgency", URGENCY_LEVELS],
  ]) {
    if (raw[name] !== undefined && raw[name] !== null) {
      if (!levels.includes(raw[name])) throw new Error(`task.profile.${name} must be one of ${levels.join(", ")}`);
      profile[name] = raw[name];
    }
  }
  if (!INTERACTION_STYLES.includes(raw.interaction_style)) {
    throw new Error(`task.profile.interaction_style must be one of ${INTERACTION_STYLES.join(", ")}`);
  }
  profile.interaction_style = raw.interaction_style;
  if (typeof raw.reason === "string" && raw.reason.trim()) profile.reason = raw.reason.trim().slice(0, 300).trimEnd();
  if (typeof raw.multi_task !== "boolean") throw new Error("task.profile.multi_task must be true or false");
  profile.multi_task = raw.multi_task;
  profile.task_count = taskCountBucket(raw.task_count);
  if (profile.multi_task !== (profile.task_count !== "1")) {
    throw new Error(`task.profile.multi_task ${profile.multi_task} contradicts task.profile.task_count ${profile.task_count}`);
  }
  // The classifier always answers the category demand.
  if (raw.axis_demand === undefined || raw.axis_demand === null) throw new Error("task.profile.axis_demand is required");
  profile.axis_demand = validateAxisDemand(raw.axis_demand);
  return profile;
}
