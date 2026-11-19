// Vendored from akiiwa-games/magpie-agentcompass-router src/profiler-core.js at ef542848af95d2b3278c4ca43a81cf0e0673c5d7 (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate with scripts/vendor_engine.mjs rather than edit.
/**
 * Multi-Protocol Request Extractor & Task Profile Schema
 *
 * A task profile comes from the classifier (`src/scorer-live.js`) or from the caller, never from the task's text:
 * without one the router does not route (`unroutedDecision`). The profile is `task_intake.py`'s: one of 11 work kinds with its
 * depth (`primary_level`) and an optional second kind, the access split, the flags, the hours and the task count. `axis_demand`,
 * how much the task needs of each of the four capability categories (0..3), is projected from the kinds and depths through the
 * declared signature table (`WORK_KIND_SIGNATURES`); nothing else scores.
 * Pure ES2022 module (zero Node-only imports) so it runs identically in both Bun and `moejs`.
 */

import { DIFFICULTY_ORDER } from "./catalog.mjs";
import { FIVE_AXES, validateAxisDemand } from "./axis-scores.mjs";
import { analyzeTurnState } from "./continuity.mjs";

/** The 11 atomic work kinds the classifier answers (`task_intake.WORK_KINDS`). */
export const WORK_KINDS = [
  "creative_ideation",
  "architecture_reasoning",
  "code_implementation",
  "frontend_ui",
  "code_audit",
  "exploration_forensics",
  "web_research",
  "visual_analysis",
  "text_processing",
  "live_loop",
  "gui_control",
];
export const PROFILE_KINDS = [...WORK_KINDS, "other_or_mixed"];
export const SECONDARY_KINDS = ["none", ...WORK_KINDS];

/**
 * Role codes per (creativity, coding, aesthetics, tool_operation) for depth s in {1, 2, 3}: `0` -> 0; `B` -> 1 when s >= 2 (a
 * baseline); `S` -> s - 1 (supporting); `P` -> s (the primary bottleneck); `F2` -> 2 and `F3` -> 3 (tool_operation floors of a live
 * text/API loop and a live GUI).
 */
export const ROLE_FN = {
  0: () => 0,
  B: (s) => (s >= 2 ? 1 : 0),
  S: (s) => s - 1,
  P: (s) => s,
  F2: () => 2,
  F3: () => 3,
};
/** The role each work kind gives each category: a maintainer declaration (2026-11-17, AgentCompass `references/work-kinds.md`). */
export const WORK_KIND_SIGNATURES = {
  creative_ideation: ["P", "0", "B", "0"],
  architecture_reasoning: ["S", "P", "0", "0"],
  code_implementation: ["B", "P", "0", "B"],
  frontend_ui: ["B", "P", "P", "B"],
  code_audit: ["B", "P", "0", "0"],
  exploration_forensics: ["S", "P", "0", "B"],
  web_research: ["S", "B", "0", "B"],
  visual_analysis: ["B", "B", "P", "0"],
  text_processing: ["B", "0", "B", "0"],
  live_loop: ["0", "S", "0", "F2"],
  gui_control: ["0", "B", "S", "F3"],
};

export const PROFILE_INTEGERS = { primary_level: [1, 3], secondary_level: [0, 3] };
export const REQUIRED_BOOL_FLAGS = ["local_only", "needs_visual", "wants_fast"];
export const ACCESS_LEVELS = ["read-only", "write"];
export const HOURS_RANGE = [0.05, 24.0];
export const TASK_COUNTS = ["1", "2", "3", ">3"];
export { DIFFICULTY_ORDER };

export const WORK_KIND_QUESTION =
  "Primary observable activity of the assignment (choose the core deliverable; ignore role/receipt boilerplate): creative_ideation = cross-domain association, de-novo concept/mechanism invention, creative writing, dialogue, open brainstorming; architecture_reasoning = first-principles system architecture, mathematical/formal proof, rigorous trade-off critique or planning without editing code; code_implementation = write, fix, refactor, or test backend, CLI, library, algorithm, data/experiment script, or config code; frontend_ui = implement or restyle user-facing UI, web/desktop views, CSS, animations, charts, or interactive components; code_audit = independent read-only code, PR, diff, branch, security, or release review/audit (even when saving a report file); exploration_forensics = read-only codebase mapping, log/database/metric forensics, or runtime root-cause diagnosis without modifying code; web_research = open-web, literature, vendor, documentation, or multi-source public fact gathering and synthesis; visual_analysis = static offline inspection of images, photos, screenshots, mockups, OCR, UI layout diffs, or fine-grained visual styling/material classification; text_processing = bounded rule-based text cleaning, translation, formatting, mechanical extraction, or summarization; live_loop = low-latency observe-act loop attached to a live external text/API stream (live market, ticket polling, live chat); gui_control = operate a live desktop, browser, or mobile GUI via screenshots, mouse clicks, and keyboard actions.";
export const PRIMARY_LEVEL_QUESTION =
  "Depth of the primary work_kind (1..3), based on task complexity rather than prompt length: 1 = routine/localized (small script or config tweak, checklist/runbook, coarse OCR, simple lookup or formatting); 2 = standard module/analysis (implement, fix, or audit a production module with tests, standard UI page/chart or mockup diff, structured research synthesis); 3 = frontier/coupled/fine-grained (cross-module concurrency/protocol architecture, de-novo cross-domain invention, design-led UI system, or fine-grained outfit/material/lighting visual classification).";
export const SECONDARY_KIND_QUESTION =
  'Optional second distinct work_kind ONLY when a single worker must execute a genuinely composite task spanning two atomic domains (e.g. code_implementation + creative_ideation for inventing a novel mechanism and coding it, frontend_ui + gui_control for coding UI and clicking through a live browser); use "none" whenever the task belongs to one primary domain (including normal test running, git/CLI usage, or reading files before coding).';
export const SECONDARY_LEVEL_QUESTION =
  'Depth of secondary_kind: MUST be 0 when secondary_kind is "none"; otherwise 1..3 rating only the secondary part\'s own depth.';
export const ACCESS_QUESTION =
  'Whether this brief only reads, inspects, reviews, diagnoses, or returns output in its reply without modifying workspace files or state ("read-only"), or creates, edits, or deletes workspace files or runs mutating commands ("write"). code_audit is ALWAYS "read-only" (even when saving a review report file); local repository code_implementation and frontend_ui are ALWAYS "write".';
export const LOCAL_ONLY_QUESTION =
  "True when the task explicitly depends on existing un-inlined files, directories, repositories, processes, or GUI on this machine. False when all required inputs are inlined in the prompt or fetched from the public web—even if the brief has a workspace header or names a local output path.";
export const NEEDS_VISUAL_QUESTION =
  "True when the worker must inspect images, photos, screenshots, mockups, or operate a GUI (always true for visual_analysis and gui_control); false for pure text/code work.";
export const WANTS_FAST_QUESTION =
  'True ONLY when the assignment affirmatively requests fast mode, priority service tier, urgent/ASAP turnaround, or a pre-reset quota sprint (e.g. "pre-reset sprint", "before quota resets", "重置前冲刺") for the task itself, and does not negate or opt out of fast mode (e.g. "do not use fast mode", "no fast mode", or "not urgent" -> false). False for action adverbs inside runtime steps (e.g. "click Save immediately when the button appears"), ordinary mentions of quota/reset without requesting fast execution, or ordinary tasks without an explicit speed/fast request.';
export const TASK_COUNT_QUESTION =
  'How many independent parallel tasks the brief bundles ("1" when it is a single task, including multi-step sequential workflows like investigate-fix-test, implement+tests, or review+report; "2", "3", or ">3" ONLY when different workers could produce separate deliverables in parallel without waiting on one another).';

/** The classifier's schema (`task_intake.TASK_PROFILE_SCHEMA`). Integers carry minimum/maximum, never an integer enum (Gemini's protobuf schema rejects those). */
export const TASK_PROFILE_SCHEMA = {
  type: "object",
  properties: {
    work_kind: { type: "string", enum: [...WORK_KINDS], description: WORK_KIND_QUESTION },
    primary_level: { type: "integer", minimum: 1, maximum: 3, description: PRIMARY_LEVEL_QUESTION },
    secondary_kind: { type: "string", enum: [...SECONDARY_KINDS], description: SECONDARY_KIND_QUESTION },
    secondary_level: { type: "integer", minimum: 0, maximum: 3, description: SECONDARY_LEVEL_QUESTION },
    access: { type: "string", enum: [...ACCESS_LEVELS], description: ACCESS_QUESTION },
    local_only: { type: "boolean", description: LOCAL_ONLY_QUESTION },
    needs_visual: { type: "boolean", description: NEEDS_VISUAL_QUESTION },
    wants_fast: { type: "boolean", description: WANTS_FAST_QUESTION },
    expected_hours: {
      type: "number",
      minimum: HOURS_RANGE[0],
      maximum: HOURS_RANGE[1],
      description:
        "Active worker-hours this task needs at an ordinary agent pace (quick check, runbook, or small review = 0.1-0.25; standard investigation, bug fix, or 1-5 file feature with tests = 0.3-0.6; wide 8+ file refactor or broad survey = 1-3; multi-stage build or sustained live loop = 4 or more). Estimate work, never money, quota or balances; brief length and boilerplate add nothing. Use 0.5 when the text gives no basis.",
    },
    task_count: { type: "string", enum: [...TASK_COUNTS], description: TASK_COUNT_QUESTION },
  },
  required: ["work_kind", "primary_level", "secondary_kind", "secondary_level", "access", "local_only", "needs_visual", "wants_fast", "expected_hours", "task_count"],
};

const isInt = (value) => typeof value === "number" && Number.isInteger(value);

/** `project_axis_demand`: the four category levels of `(work_kind, primary_level, secondary_kind, secondary_level)`, the max of both kinds' roles. */
export function projectAxisDemand(workKind, primaryLevel, secondaryKind = "none", secondaryLevel = 0) {
  if (!(workKind in WORK_KIND_SIGNATURES)) throw new Error(`task.profile.work_kind must be one of ${WORK_KINDS.join(", ")}`);
  if (!isInt(primaryLevel) || primaryLevel < 1 || primaryLevel > 3) throw new Error("task.profile.primary_level must be an integer from 1 to 3");
  if (!SECONDARY_KINDS.includes(secondaryKind)) throw new Error(`task.profile.secondary_kind must be one of ${SECONDARY_KINDS.join(", ")}`);
  if (!isInt(secondaryLevel) || secondaryLevel < 0 || secondaryLevel > 3) throw new Error("task.profile.secondary_level must be an integer from 0 to 3");
  const primary = WORK_KIND_SIGNATURES[workKind].map((r) => ROLE_FN[r](primaryLevel));
  const levels =
    secondaryKind !== "none" && secondaryLevel > 0
      ? WORK_KIND_SIGNATURES[secondaryKind].map((r, i) => Math.max(primary[i], ROLE_FN[r](secondaryLevel)))
      : primary;
  return Object.fromEntries(FIVE_AXES.map((a, i) => [a, levels[i]]));
}

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
 * do not state: the category demand is stated explicitly, zero except the tool operation a GUI or an image needs. The work kind
 * is the one the signal names (`gui_control` for a GUI, `visual_analysis` for an image) and `text_processing` otherwise, at depth 1.
 */
export function noTextProfile(facts = {}) {
  const gui = Boolean(facts.hasComputerUse);
  const image = Boolean(facts.hasVisualInput || gui);
  return {
    work_kind: gui ? "gui_control" : image ? "visual_analysis" : "text_processing",
    primary_level: 1,
    secondary_kind: "none",
    secondary_level: 0,
    access: "read-only",
    local_only: gui,
    needs_visual: image,
    wants_fast: false,
    expected_hours: 0.4,
    task_count: "1",
    axis_demand: { creativity: 0, coding: 0, aesthetics: 0, tool_operation: image ? 3 : 0 },
  };
}

/** The schema's task-count band for a band or a positive whole number; anything else is an invalid profile. */
export function taskCountBucket(value) {
  if (typeof value === "string" && TASK_COUNTS.includes(value)) return value;
  const whole = typeof value === "number" && Number.isInteger(value) ? value : null;
  if (whole !== null && whole >= 1) return TASK_COUNTS[Math.min(whole, 4) - 1];
  throw new Error(`task.profile.task_count must be one of ${TASK_COUNTS.join(", ")} or a positive whole number`);
}

function checkInt(raw, name, low, high) {
  const value = raw[name];
  if (!isInt(value) || value < low || value > high) throw new Error(`task.profile.${name} must be an integer from ${low} to ${high}`);
  return value;
}

function derivedFlag(raw, name, derived, contradiction) {
  if (raw[name] === undefined || raw[name] === null) return derived;
  if (typeof raw[name] !== "boolean") throw new Error(`task.profile.${name} must be true or false`);
  if (derived && raw[name] === false) throw new Error(contradiction);
  return raw[name];
}

/**
 * `validate_profile`: a task profile with every field checked and the derived fields filled (`axis_demand`, `needs_gui`,
 * `read_only_review`, `multi_task`), or an `Error`. A derived field the input carries is checked against its derivation; an
 * explicit `axis_demand` stands as given. A profile of the older shape (`reasoning_depth`, `interaction_style`, ...) is refused:
 * it has no `work_kind` of the 11 and no `primary_level`.
 */
export function validateProfile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("task.profile must be an object");
  const workKind = raw.work_kind;
  if (typeof workKind !== "string" || !WORK_KINDS.includes(workKind)) throw new Error(`task.profile.work_kind must be one of ${WORK_KINDS.join(", ")}`);
  const primaryLevel = checkInt(raw, "primary_level", 1, 3);
  const secondaryKind = raw.secondary_kind;
  if (typeof secondaryKind !== "string" || !SECONDARY_KINDS.includes(secondaryKind)) {
    throw new Error(`task.profile.secondary_kind must be one of ${SECONDARY_KINDS.join(", ")}`);
  }
  const secondaryLevel = checkInt(raw, "secondary_level", 0, 3);
  if (secondaryKind === "none" && secondaryLevel !== 0) throw new Error("task.profile.secondary_level must be 0 when secondary_kind is 'none'");
  if (secondaryKind !== "none" && secondaryLevel === 0) throw new Error("task.profile.secondary_level must be 1 to 3 when secondary_kind is not 'none'");
  if (secondaryKind === workKind) throw new Error("task.profile.secondary_kind must differ from work_kind (use 'none' for single-domain tasks)");
  const profile = { work_kind: workKind, primary_level: primaryLevel, secondary_kind: secondaryKind, secondary_level: secondaryLevel };
  for (const name of REQUIRED_BOOL_FLAGS) {
    if (typeof raw[name] !== "boolean") throw new Error(`task.profile.${name} must be true or false`);
    profile[name] = raw[name];
  }
  const kindsUsed = secondaryKind === "none" ? [workKind] : [workKind, secondaryKind];
  profile.needs_gui = derivedFlag(raw, "needs_gui", kindsUsed.includes("gui_control"), "task.profile.needs_gui false contradicts gui_control");
  if (profile.needs_gui || kindsUsed.includes("visual_analysis")) profile.needs_visual = true;
  profile.read_only_review = derivedFlag(raw, "read_only_review", workKind === "code_audit", "task.profile.read_only_review false contradicts work_kind 'code_audit'");
  const access = raw.access;
  if (!ACCESS_LEVELS.includes(access)) throw new Error(`task.profile.access must be one of ${ACCESS_LEVELS.join(", ")}`);
  if (profile.read_only_review === true && access === "write") throw new Error("task.profile.access 'write' contradicts read_only_review / work_kind 'code_audit'");
  if (profile.local_only === true && ["code_implementation", "frontend_ui"].includes(workKind) && access === "read-only") {
    throw new Error(`task.profile.access 'read-only' contradicts local '${workKind}'`);
  }
  profile.access = access;
  if (raw.expected_hours !== undefined && raw.expected_hours !== null) {
    if (typeof raw.expected_hours !== "number" || !Number.isFinite(raw.expected_hours)) throw new Error("task.profile.expected_hours must be a finite number");
    profile.expected_hours = Math.round(Math.min(Math.max(raw.expected_hours, HOURS_RANGE[0]), HOURS_RANGE[1]) * 100) / 100;
  }
  if (typeof raw.reason === "string" && raw.reason.trim()) profile.reason = raw.reason.trim().slice(0, 300).trimEnd();
  profile.task_count = taskCountBucket(raw.task_count);
  const derivedMulti = profile.task_count !== "1";
  if (raw.multi_task !== undefined && raw.multi_task !== null) {
    if (typeof raw.multi_task !== "boolean") throw new Error("task.profile.multi_task must be true or false");
    if (raw.multi_task !== derivedMulti) throw new Error(`task.profile.multi_task ${raw.multi_task} contradicts task.profile.task_count '${profile.task_count}'`);
  }
  profile.multi_task = derivedMulti;
  profile.axis_demand =
    raw.axis_demand !== undefined && raw.axis_demand !== null
      ? validateAxisDemand(raw.axis_demand)
      : projectAxisDemand(workKind, primaryLevel, secondaryKind, secondaryLevel);
  return profile;
}
