// Vendored from akiiwa-games/magpie-agentcompass-router src/profiler-core.js at dcca04c7946a4e86c4c9dfa986f158fef83458af (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate rather than edit.
/**
 * Multi-Protocol Request Extractor & Deterministic 10-Field Task Profiler
 *
 * Ported from AgentCompass (`skills/agent-compass/scripts/allocator.py` and `route_judge.py`).
 * Pure ES2022 module (zero Node-only imports) so it runs identically in both Bun and `moejs`.
 */

import {
  CANONICAL_ROUTES,
  DEPTH_BY_DIFFICULTY,
  HARD_BY_DEFAULT,
  INTERACTION_STYLES,
  KIND_TRAITS,
} from "./catalog.mjs";

export const PROFILE_INTEGERS = {
  reasoning_depth: [1, 4],
  code_complexity: [0, 3],
  context_scale: [1, 3],
  divergence: [1, 3],
  hallucination_risk: [1, 3],
  error_cost: [1, 3],
};

export const PROFILE_FLAGS = ["needs_visual", "needs_gui", "local_only"];

export const DIVERGENT_WORDS = [
  "brainstorm",
  "creative",
  "novel",
  "innovat",
  "propose",
  "formulate",
  "scheme",
  "roadmap",
  "hypothesis",
  "ideat",
  "divergent",
  "制定方案",
  "设计方案",
  "新方案",
  "创造性",
  "发散",
  "创新",
  "新方向",
  "提出假设",
  "路线图",
  "架构创新",
];

export const READONLY_REVIEW_PHRASES = [
  "(read-only)",
  "read-only review",
  "read-only investigation",
  "read-only code",
  "read-only audit",
  "read-only release",
  "read-only diff",
  "read-only diagnostic",
  "read-only inspection",
  "independent review",
  "independent code and",
  "independent audit",
  "no repo code edits",
  "write no application code",
  "write no production code",
  "do not edit repo",
  "do not modify repo",
  "do not change repo",
  "只读审阅",
  "只读代码审查",
  "只读审查",
  "只读排查",
  "独立代码审查",
  "独立审查",
  "不修改仓库代码",
];

export const GUI_WORDS = [
  "click the",
  "click save",
  "take a screenshot",
  "capture a screenshot",
  " gui",
  "desktop app",
  "mouse",
  "keyboard",
  "operate the browser",
  "operate the desktop",
  "点击",
  "截取屏幕",
  "截屏操作",
  "桌面",
  "鼠标",
  "键盘",
  "操作浏览器",
  "操作桌面",
];

const OBJECTIVE_LOCAL_RUNTIME_RE =
  /\b(?:ssh|ssh-agent|vps|localhost|127\.0\.0\.1|pytest|unittest|sqlite|daemon|worktree|adb|emulator|intranet|webhook|credentials?)\b/i;

const LOCAL_MACHINE_RE =
  /(?:[A-Za-z]:[\\/]|~\/|\\\\)|\b(?:working tree|git checkout|local repo|this repo|local daemon|local git)\b/i;

const MULTI_TASK_MARK_RE =
  /(?:^|\n)\s*(?:#{1,4}\s*)?(?:task|deliverable|part|module|workstream|任务|交付物|模块|工作线)\s*(?:[1-9a-d]|[一二三四五六])\s*[.:：\-—]/gi;

export function multiTaskMarks(objective) {
  return String(objective || "").match(MULTI_TASK_MARK_RE) || [];
}

const COUPLED_SIGNALS = [
  "cross-module",
  "multi-module",
  "refactor",
  "architecture",
  "concurrency",
  "deadlock",
  "race condition",
  "distributed",
  "migration",
  "subsystem",
  "orchestrat",
  "跨模块",
  "多模块",
  "架构重构",
  "并发",
  "死锁",
  "竞态",
  "迁移方案",
  "子系统",
];

const FRONTIER_SIGNALS = [
  "formal proof",
  "mathematical proof",
  "mathematical critique",
  "theorem",
  "optimal-stopping",
  "frontier reasoning",
  "prove or refute",
  "形式化证明",
  "数学证明",
  "数学推导",
  "定理推导",
];

export function inferKindFromObjective(objective) {
  const text = ` ${String(objective || "").toLowerCase()} `;
  if (GUI_WORDS.some((w) => text.includes(w))) {
    return "computer_use";
  }
  const rules = [
    [
      "direction_reasoning",
      [
        "formal proof",
        "mathematical critique",
        "optimal-stopping",
        "frontier reasoning",
        "critique the architecture",
        "prove or refute",
        "brainstorm",
        "first-principles",
        "first principles",
        "unconventional",
        "creative architecture",
        "creative product",
        "creative direction",
        "novel product",
        "形式化证明",
        "数学推导",
        "架构批判",
        "战略权衡",
        "头脑风暴",
        "脑暴",
        "第一性原理",
      ],
    ],
    [
      "complex_build_plan",
      [
        "migration plan",
        "migration spec",
        "implementation specification",
        "multi-phase",
        "system architecture plan",
        "new scheme",
        "plan a new scheme",
        "规划一个新方案",
        "迁移方案",
        "迁移计划",
        "分阶段设计",
        "系统建设方案",
      ],
    ],
    [
      "bounded_bulk_work",
      [
        "bulk ",
        "batch rename",
        "mechanical refactor",
        "uniform rule",
        "codemod",
        "批量",
        "机械替换",
        "统一替换",
      ],
    ],
    [
      "web_research",
      [
        "web survey",
        "web research",
        "vendor survey",
        "public documentation",
        "search the web",
        "search public",
        "open-web",
        "literature survey",
        "网页调研",
        "文献综述",
        "厂商调研",
        "搜索官网",
        "公开文档",
      ],
    ],
    [
      "visual_analysis",
      [
        "visual diff",
        "design diff",
        "inspect screenshot",
        "compare screenshot",
        "compare screenshots",
        "inspect the image",
        "inspect the screenshot",
        "inspect the supplied screenshot",
        "compare the screenshots",
        "layout misalignment",
        "screenshot review",
        "ui screenshot",
        "design inspection",
        "视觉对比",
        "截图对比",
        "检查截图",
        "设计稿检查",
        "看图分析",
      ],
    ],
    [
      "debug_review",
      [
        "bug",
        "fix ",
        "deadlock",
        "race condition",
        "regression",
        "review the diff",
        "code review",
        "diff review",
        "read-only review",
        "(read-only)",
        "independent review",
        "invariant audit",
        "security audit",
        "memory leak",
        "diagnos",
        "rendering glitch",
        "intermittent failure",
        "报错",
        "排查",
        "修复",
        "死锁",
        "代码审查",
        "只读审阅",
        "只读审查",
        "安全审计",
        "内存泄漏",
      ],
    ],
    [
      "frontend_implementation",
      [
        "frontend",
        "react",
        "css",
        "tailwind",
        "mockup",
        "desktop ui",
        "game ui",
        "界面",
        "前端",
        "样式",
        "组件",
      ],
    ],
    [
      "research_packet",
      [
        "backtest",
        "quantitative experiment",
        "benchmark suite",
        "statistical evaluation",
        "research packet",
        "simulation",
        "data analysis pipeline",
        "回测",
        "定量实验",
        "评测",
        "仿真",
        "统计检验",
      ],
    ],
    [
      "tool_execution",
      [
        "runbook",
        "checklist",
        "deploy",
        "release commands",
        "health check",
        "run the test suite",
        "巡检",
        "发版",
        "运行测试",
        "操作手册",
        "发布流程",
      ],
    ],
    [
      "exploration_analysis",
      [
        "explore",
        "investigate",
        "trace",
        "map the codebase",
        "architecture exploration",
        "调研",
        "分析",
        "梳理",
        "探索仓库",
        "架构追踪",
      ],
    ],
    [
      "self_contained_code",
      [
        "standalone",
        "self-contained",
        "algorithm",
        "isolated module",
        "独立算法",
        "独立脚本",
        "自包含",
        "实现算法",
      ],
    ],
    [
      "text_in_text_out",
      [
        "translate ",
        "translation of ",
        "translation into ",
        "draft a document",
        "draft documentation",
        "rewrite the text",
        "summarize the text",
        "翻译",
        "撰写文档",
        "文案",
        "润色",
        "摘要",
      ],
    ],
  ];

  for (const [kind, keywords] of rules) {
    if (keywords.some((w) => text.includes(w))) {
      return kind;
    }
  }
  return objective && String(objective).trim() ? "general_implementation" : "other_or_mixed";
}

export function isReadonlyReviewTask(objective, profile = null) {
  if (profile && profile.needs_gui) return false;
  const text = ` ${String(objective || "").toLowerCase()} ${String(profile?.reason || "").toLowerCase()} `;
  if (READONLY_REVIEW_PHRASES.some((p) => text.includes(p))) return true;
  return /\bread-only\b[^.]{0,40}\b(?:review|audit|investig|diagnos|inspect|check)\b/i.test(text);
}

export function inferDivergence(objective, kind = null, style = null) {
  if (kind === "computer_use") return 1;
  if (kind === "complex_build_plan" || kind === "direction_reasoning" || style === "advisory") {
    return 3;
  }
  const text = ` ${String(objective || "").toLowerCase()} `;
  if (DIVERGENT_WORDS.some((w) => text.includes(w))) {
    return 3;
  }
  if (
    [
      "intermittent",
      "unknown cause",
      "hypothes",
      "race condition",
      "deadlock",
      "root cause",
      "root-cause",
      "memory leak",
      "security audit",
      "invariant audit",
      "偶发",
      "未知根因",
      "死锁",
      "竞态",
      "根因",
      "安全审计",
      "内存泄漏",
    ].some((w) => text.includes(w))
  ) {
    return 2;
  }
  return 1;
}

export function inferReasoningDepth(objective, kind, explicitDifficulty = null) {
  if (explicitDifficulty && DEPTH_BY_DIFFICULTY[explicitDifficulty]) {
    return DEPTH_BY_DIFFICULTY[explicitDifficulty];
  }
  const text = ` ${String(objective || "").toLowerCase()} `;
  if (FRONTIER_SIGNALS.some((w) => text.includes(w))) {
    return 4;
  }
  if (COUPLED_SIGNALS.some((w) => text.includes(w)) || kind === "complex_build_plan" || kind === "direction_reasoning") {
    return 3;
  }
  if (HARD_BY_DEFAULT.includes(kind) || kind === "self_contained_code") {
    return 2;
  }
  return 1;
}

export function validateProfile(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("task.profile must be an object");
  }
  const profile = {};
  if (raw.work_kind !== undefined && raw.work_kind !== null) {
    if (typeof raw.work_kind !== "string" || !(raw.work_kind in KIND_TRAITS)) {
      throw new Error(`task.profile.work_kind must be one of ${Object.keys(KIND_TRAITS).join(", ")}`);
    }
    profile.work_kind = raw.work_kind;
  }
  for (const [name, [low, high]] of Object.entries(PROFILE_INTEGERS)) {
    if (name === "divergence" && !(name in raw)) {
      profile.divergence = 1;
      continue;
    }
    const val = Number(raw[name]);
    if (!Number.isInteger(val) || val < low || val > high) {
      throw new Error(`task.profile.${name} must be an integer from ${low} to ${high}`);
    }
    profile[name] = val;
  }
  for (const flag of PROFILE_FLAGS) {
    profile[flag] = Boolean(raw[flag]);
  }
  const style = raw.interaction_style || "engineering";
  if (!INTERACTION_STYLES.includes(style)) {
    throw new Error(`task.profile.interaction_style must be one of ${INTERACTION_STYLES.join(", ")}`);
  }
  profile.interaction_style = style;
  const hours = Number(raw.expected_hours ?? 0.5);
  profile.expected_hours = Number.isFinite(hours)
    ? Math.round(Math.min(Math.max(hours, 0.05), 24.0) * 100) / 100
    : 0.5;
  profile.hours_confidence = ["low", "medium", "high"].includes(raw.hours_confidence)
    ? raw.hours_confidence
    : "medium";
  profile.urgency = ["unknown", "low", "normal", "high"].includes(raw.urgency) ? raw.urgency : "unknown";
  if (typeof raw.reason === "string" && raw.reason.trim()) {
    profile.reason = raw.reason.trim().slice(0, 300);
  }
  profile.multi_task = Boolean(raw.multi_task);
  profile.task_count = ["1", "2", "3", ">3"].includes(raw.task_count) ? raw.task_count : "1";
  return profile;
}

/**
 * Deterministic 10-field task profile (the `< 1 ms` offline twin of the System-One scorer).
 * Ported directly from `allocator.py:infer_task_profile`.
 */
export function inferTaskProfile(task = {}, routes = CANONICAL_ROUTES) {
  const objective = typeof task.objective === "string" ? task.objective : "";
  let kind = task.work_kind && routes[task.work_kind] ? task.work_kind : inferKindFromObjective(objective);
  const needs = task.needs && typeof task.needs === "object" ? task.needs : {};
  const implies = routes[kind]?.implies || {};
  const depth = inferReasoningDepth(objective, kind, task.difficulty);

  let [code, context, risk, cost, style] = KIND_TRAITS[kind] || KIND_TRAITS.other_or_mixed;
  if (isReadonlyReviewTask(objective)) {
    code = 0;
    if (kind === "general_implementation") {
      kind = "debug_review";
    }
  }
  const gui =
    kind === "computer_use" ||
    Boolean(needs.gui) ||
    (kind === "other_or_mixed" && GUI_WORDS.some((w) => ` ${objective.toLowerCase()} `.includes(w)));

  if (depth >= 3) {
    context = Math.max(context, 2);
    if (style === "engineering" && code > 0) {
      code = Math.max(code, 2);
      if (objective.toLowerCase().includes("concurrency") || objective.toLowerCase().includes("protocol") || objective.includes("并发")) {
        code = 3;
      }
    }
  }
  if (needs.critical) {
    cost = 3;
  }
  const divergence = inferDivergence(objective, kind, style);
  const evidence = `${objective} ${task.context || ""} ${task.cwd || ""}`;
  const localHit = OBJECTIVE_LOCAL_RUNTIME_RE.test(evidence) || LOCAL_MACHINE_RE.test(evidence);
  const localOnly =
    needs.local_only !== undefined ? Boolean(needs.local_only) : Boolean(localHit || implies.local_only);

  const expectedHours =
    Number.isFinite(Number(task.expected_hours ?? task.hours)) && Number(task.expected_hours ?? task.hours) > 0
      ? Number(task.expected_hours ?? task.hours)
      : depth === 1
        ? 0.4
        : depth === 2
          ? 1.0
          : depth === 3
            ? 2.0
            : 3.5;

  const marks = multiTaskMarks(objective);
  const multiTask =
    task.multi_task !== undefined ? Boolean(task.multi_task) : marks.length >= 2;
  const taskCount =
    task.task_count ||
    (!multiTask ? "1" : marks.length === 2 ? "2" : marks.length === 3 ? "3" : ">3");

  return validateProfile({
    work_kind: kind,
    reasoning_depth: depth,
    code_complexity: code,
    context_scale: context,
    divergence,
    hallucination_risk: risk,
    error_cost: cost,
    needs_visual: Boolean(needs.visual || task.hasVisualInput || implies.visual || gui),
    needs_gui: gui,
    local_only: localOnly,
    interaction_style: style,
    expected_hours: expectedHours,
    hours_confidence: "medium",
    urgency: "unknown",
    multi_task: multiTask,
    task_count: taskCount,
  });
}

export const profileTask = inferTaskProfile;
