// Vendored from akiiwa-games/magpie-agentcompass-router src/catalog.js at e98a82287ee1793ae559c8a0fed188e5d1c69ef1 (MIT), itself ported from AgentCompass.
// Only the import paths differ from the source; regenerate rather than edit.
/**
 * AgentCompass Core Model Capabilities, Subjective DNA Vectors, Canonical Routes,
 * Effort Curves, and Scoring Policy.
 *
 * Ported directly from AgentCompass (`skills/agent-compass/references/model-capabilities.json`
 * and `skills/agent-compass/references/accounts.json`).
 * Pure ES2022 module with zero external or Node-only dependencies so it runs in both
 * Bun (`magpie.hooks` / provider plugin) and Magpie's in-process `moejs` (`magpie.middleware`).
 */

export const CAPABILITY_DIMENSIONS = [
  "reasoning",
  "coding",
  "exploration",
  "anti_hallucination",
  "visual",
  "gui",
];

export const SUBJECTIVE_DIMENSIONS = [
  "divergence",
  "global_rigor",
  "module_precision",
];

export const INTERACTION_STYLES = [
  "engineering",
  "exploration",
  "text_only",
  "advisory",
];

export const DIFFICULTY_ORDER = ["routine", "hard", "coupled", "frontier"];

export const DEPTH_BY_DIFFICULTY = {
  routine: 1,
  hard: 2,
  coupled: 3,
  frontier: 4,
};

export const EFFORT_ORDER = ["none", "off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export const HARD_BY_DEFAULT = [
  "debug_review",
  "general_implementation",
  "frontend_implementation",
  "computer_use",
  "exploration_analysis",
  "research_packet",
];

export const ROUTE_FIT_PEERS = {
  "grok-bot": "claude-opus-5-5",
};

/**
 * kind -> [code_complexity, context_scale, hallucination_risk, error_cost, interaction_style]
 */
export const KIND_TRAITS = {
  general_implementation: [2, 1, 2, 2, "engineering"],
  frontend_implementation: [2, 1, 2, 2, "engineering"],
  debug_review: [2, 2, 3, 2, "engineering"],
  bounded_bulk_work: [1, 2, 1, 1, "engineering"],
  tool_execution: [1, 1, 1, 2, "engineering"],
  self_contained_code: [2, 1, 1, 1, "engineering"],
  exploration_analysis: [0, 2, 3, 1, "exploration"],
  research_packet: [1, 2, 3, 1, "exploration"],
  computer_use: [0, 1, 2, 2, "engineering"],
  visual_analysis: [0, 1, 3, 1, "exploration"],
  text_in_text_out: [0, 1, 2, 1, "text_only"],
  web_research: [0, 2, 2, 1, "text_only"],
  dot_execution: [1, 1, 2, 1, "text_only"],
  direction_reasoning: [0, 2, 3, 1, "advisory"],
  complex_build_plan: [0, 3, 3, 2, "advisory"],
  other_or_mixed: [1, 1, 2, 2, "engineering"],
};

export const CANONICAL_ROUTES = {
  general_implementation: {
    scope:
      "Implement an agreed plan, maintain production features, refactor bounded code or deliver ordinary repository changes.",
    role: "worker",
    preferred: [
      "gemini-3.8-flash-high",
      "claude-opus-5-5",
      "grok-bot",
      "claude-sonnet-5-5",
      "gpt-6-astra",
      "gemini-4-argon-high",
      "gpt-6.1-sol",
      "grok-4.7",
    ],
    restrict_models: false,
  },
  frontend_implementation: {
    scope:
      "Write UI components, interactions, animations and styling from the accepted design; visual evidence inspection is a separate visual_analysis task when material.",
    role: "worker",
    preferred: [
      "gemini-3.8-flash-high",
      "claude-opus-5-5",
      "grok-bot",
      "gemini-4-argon-high",
      "gpt-6-astra",
      "claude-sonnet-5-5",
      "gpt-6.1-sol",
      "grok-4.7",
    ],
    restrict_models: false,
  },
  debug_review: {
    scope:
      "Subtle bug diagnosis, regression analysis, review of code and diffs, invariants, test-driven repairs and checking existing behavior.",
    role: "reviewer or debugging worker",
    preferred: [
      "gpt-6.1-sol",
      "claude-sonnet-5-5",
      "gpt-6-astra",
      "claude-opus-5-5",
      "grok-bot",
      "gemini-4-argon-high",
      "grok-4.7",
      "gemini-3.8-flash-high",
    ],
    harness_order: ["codex", "pi"],
    restrict_models: false,
  },
  complex_build_plan: {
    scope:
      "Turn an agreed direction into a repository-grounded multi-system build plan: dependencies, interfaces, staged migrations, sequencing, validation and rollback.",
    role: "planner",
    preferred: [
      "gpt-6-pro",
      "gemini-4-argon-high",
      "claude-opus-5-5",
      "grok-bot",
      "gpt-6-astra",
      "claude-sonnet-5-5",
    ],
    restrict_models: true,
  },
  direction_reasoning: {
    scope:
      "Deep reasoning and discussion of solution direction, competing architectures, assumptions, causal explanations, or which problem to solve.",
    role: "advisor or scheme designer",
    preferred: [
      "gpt-6-pro",
      "gemini-4-argon-high",
      "claude-opus-5-5",
      "grok-bot",
      "gpt-6-astra",
      "claude-sonnet-5-5",
    ],
    restrict_models: true,
  },
  exploration_analysis: {
    scope:
      "Explore and analyze material in the codebase or dataset and return findings as text: map how a system works, trace where and why something happens, read logs, configs, or documents.",
    role: "explorer or analyst",
    preferred: [
      "claude-sonnet-5-5",
      "gpt-6.1-sol",
      "claude-opus-5-5",
      "grok-bot",
      "gpt-6-astra",
      "gemini-4-argon-high",
      "grok-4.7",
      "gemini-3.8-flash-high",
    ],
    implies: { local_only: true },
    harness_order: ["pi", "codex"],
    restrict_models: false,
  },
  research_packet: {
    scope:
      "Run a defined quantitative experiment, evaluation benchmark, simulation, backtest or data analysis pipeline, compare variants against a baseline, and report metrics.",
    role: "research worker",
    preferred: [
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "grok-bot",
      "gpt-6-astra",
      "gemini-4-argon-high",
      "gpt-6.1-sol",
      "grok-4.7",
      "gemini-3.8-flash-high",
    ],
    implies: { local_only: true },
    harness_order: ["pi", "codex"],
    restrict_models: false,
  },
  self_contained_code: {
    scope:
      "Self-contained code and validation work whose whole input fits in the prompt and whose deliverable is new files with unit tests or an isolated algorithm.",
    role: "worker",
    preferred: [
      "dot",
      "claude-opus-5-5",
      "grok-bot",
      "claude-sonnet-5-5",
      "gpt-6-astra",
      "gemini-4-argon-high",
      "gpt-6.1-sol",
      "grok-4.7",
      "gemini-3.8-flash-high",
    ],
    restrict_models: false,
  },
  visual_analysis: {
    scope:
      "Interpret screenshots, charts, diagrams, spatial layouts, image evidence or visual discrepancies; distinct from writing frontend code.",
    role: "visual analyst",
    preferred: [
      "claude-opus-5-5",
      "grok-bot",
      "gpt-6-astra",
      "gemini-4-argon-high",
      "gpt-6.1-sol",
      "claude-sonnet-5-5",
      "gemini-3.8-flash-high",
    ],
    implies: { visual: true },
    strict_order: true,
    restrict_models: false,
  },
  computer_use: {
    scope:
      "Operate a graphical computer or app through screenshots, mouse and keyboard (computer use): GUI-only applications, desktop or browser flows.",
    role: "computer-use worker",
    preferred: ["gpt-6-astra", "gpt-6.1-sol"],
    implies: { visual: true },
    strict_order: true,
    capability_fit: { gui: 1.0 },
    harness_order: ["codex", "pi"],
    restrict_models: false,
  },
  bounded_bulk_work: {
    scope:
      "Homogeneous small changes, independent extraction or inventory, boilerplate and fixed transformations with explicit acceptance.",
    role: "bounded leaf worker",
    preferred: [
      "gemini-3.8-flash-high",
      "grok-4.7",
      "gpt-6.1-sol",
      "claude-sonnet-5-5",
      "gemini-4-argon-high",
      "gpt-6-astra",
      "claude-opus-5-5",
      "grok-bot",
    ],
    restrict_models: false,
  },
  tool_execution: {
    scope:
      "A bounded outcome primarily requiring file, shell, browser, API or other tool calls, with direction and authorized actions already established.",
    role: "tool-execution worker",
    preferred: [
      "gemini-3.8-flash-high",
      "gpt-6.1-sol",
      "claude-sonnet-5-5",
      "gemini-4-argon-high",
      "claude-opus-5-5",
      "grok-bot",
      "gpt-6-astra",
      "grok-4.7",
    ],
    restrict_models: false,
  },
  text_in_text_out: {
    scope:
      "Self-contained work whose deliverable is text: drafting, rewriting, translating, summarizing, critiquing, comparing, explaining.",
    role: "worker",
    preferred: [
      "claude-opus-5-5",
      "grok-bot",
      "claude-sonnet-5-5",
      "dot",
      "gpt-6-astra",
      "gemini-4-argon-high",
      "gpt-6.1-sol",
      "grok-4.7",
      "gemini-3.8-flash-high",
    ],
    harness_order: ["pi", "codex"],
    restrict_models: false,
  },
  web_research: {
    scope:
      "Gather, check and organize information from the open web or public documentation: vendor surveys, current specs, changelog lookups, fact-checks, comparison tables.",
    role: "worker",
    preferred: [
      "dot",
      "claude-sonnet-5-5",
      "grok-4.7",
      "gemini-4-argon-high",
      "gpt-6.1-sol",
      "claude-opus-5-5",
      "grok-bot",
      "gpt-6-astra",
      "gemini-3.8-flash-high",
    ],
    harness_order: ["pi", "codex"],
    restrict_models: false,
  },
  dot_execution: {
    scope:
      "A bounded assignment an isolated remote worker can finish end to end and return as a completed text deliverable.",
    role: "worker",
    preferred: ["dot"],
    implies: { local_only: false },
    restrict_models: true,
  },
  other_or_mixed: {
    scope: "Unmatched or mixed work.",
    role: "worker",
    preferred: [],
    restrict_models: false,
  },
};

export const DEFAULT_MODELS = {
  "claude-fable-5-1": {
    tier: 4.6,
    cost: 5,
    visual: false,
    usd_per_hour: 18.7,
    context_window: 200000,
    disabled_by_default: true,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    capabilities: {
      reasoning: 0.98,
      coding: 0.95,
      exploration: 0.9,
      anti_hallucination: 0.9,
      visual: 0.0,
      gui: 0.0,
    },
    subjective: {
      divergence: 0.92,
      global_rigor: 0.95,
      module_precision: 0.9,
    },
  },
  "claude-opus-5-5": {
    tier: 4.6,
    cost: 4,
    visual: 1.0,
    usd_per_hour: 7.5,
    context_window: 200000,
    fast_capable: true,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    capabilities: {
      reasoning: 0.89,
      coding: 0.91,
      exploration: 0.88,
      anti_hallucination: 0.92,
      visual: 1.0,
      gui: 0.55,
    },
    subjective: {
      divergence: 0.62,
      global_rigor: 0.98,
      module_precision: 0.92,
    },
  },
  "gpt-6-astra": {
    tier: 4.2,
    cost: 4,
    visual: 0.8,
    usd_per_hour: 22.6,
    context_window: 400000,
    fast_capable: true,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    capabilities: {
      reasoning: 0.8,
      coding: 0.79,
      exploration: 0.8,
      anti_hallucination: 0.78,
      visual: 0.8,
      gui: 0.95,
    },
    subjective: {
      divergence: 0.68,
      global_rigor: 0.82,
      module_precision: 0.84,
    },
  },
  "gemini-4-argon-high": {
    tier: 4.0,
    cost: 3,
    visual: 0.75,
    usd_per_hour: 4.0,
    context_window: 1000000,
    duration_multiplier: 1.35,
    burn_pct_per_worker_hour: {
      "gemini-weekly": 0.62,
      "gemini-5h": 2.13,
    },
    efforts: ["low", "medium", "high"],
    capabilities: {
      reasoning: 0.78,
      coding: 0.83,
      exploration: 0.86,
      anti_hallucination: 0.81,
      visual: 0.75,
      gui: 0.62,
    },
    subjective: {
      divergence: 0.96,
      global_rigor: 0.8,
      module_precision: 0.8,
    },
  },
  "claude-sonnet-5-5": {
    tier: 3.9,
    cost: 2,
    visual: 0.6,
    usd_per_hour: 4.4,
    context_window: 200000,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    capabilities: {
      reasoning: 0.74,
      coding: 0.82,
      exploration: 0.89,
      anti_hallucination: 0.73,
      visual: 0.6,
      gui: 0.55,
    },
    subjective: {
      divergence: 0.6,
      global_rigor: 0.76,
      module_precision: 0.78,
    },
  },
  "gpt-6.1-terra": {
    tier: 3.7,
    cost: 3,
    visual: 0.72,
    usd_per_hour: 3.0,
    context_window: 500000,
    fast_capable: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.73,
      coding: 0.83,
      exploration: 0.71,
      anti_hallucination: 0.75,
      visual: 0.72,
      gui: 0.8,
    },
    subjective: {
      divergence: 0.5,
      global_rigor: 0.65,
      module_precision: 0.88,
    },
  },
  "gpt-6.1-sol": {
    tier: 3.6,
    cost: 3,
    visual: 0.7,
    usd_per_hour: 2.6,
    context_window: 400000,
    duration_multiplier: 1.35,
    fast_capable: true,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    capabilities: {
      reasoning: 0.71,
      coding: 0.85,
      exploration: 0.62,
      anti_hallucination: 0.74,
      visual: 0.7,
      gui: 0.82,
    },
    subjective: {
      divergence: 0.4,
      global_rigor: 0.25,
      module_precision: 0.95,
    },
  },
  "gpt-6-sol": {
    tier: 3.5,
    cost: 3,
    visual: 0.68,
    usd_per_hour: 2.6,
    context_window: 272000,
    fast_capable: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.69,
      coding: 0.82,
      exploration: 0.6,
      anti_hallucination: 0.72,
      visual: 0.68,
      gui: 0.8,
    },
    subjective: {
      divergence: 0.4,
      global_rigor: 0.25,
      module_precision: 0.92,
    },
  },
  "grok-4.7": {
    tier: 3.4,
    cost: 2,
    visual: false,
    usd_per_hour: 1.5,
    context_window: 131072,
    efforts: ["low", "high", "xhigh"],
    capabilities: {
      reasoning: 0.59,
      coding: 0.58,
      exploration: 0.6,
      anti_hallucination: 0.62,
      visual: 0.0,
      gui: 0.0,
    },
    subjective: {
      divergence: 0.45,
      global_rigor: 0.4,
      module_precision: 0.58,
    },
  },
  "claude-haiku-5-5": {
    tier: 3.2,
    cost: 1,
    visual: 0.48,
    usd_per_hour: 0.8,
    context_window: 200000,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.58,
      coding: 0.65,
      exploration: 0.62,
      anti_hallucination: 0.62,
      visual: 0.48,
      gui: 0.35,
    },
    subjective: {
      divergence: 0.42,
      global_rigor: 0.53,
      module_precision: 0.67,
    },
  },
  "gpt-6-luna": {
    tier: 3.2,
    cost: 1,
    visual: 0.55,
    usd_per_hour: 0.8,
    context_window: 272000,
    fast_capable: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.58,
      coding: 0.65,
      exploration: 0.57,
      anti_hallucination: 0.62,
      visual: 0.55,
      gui: 0.5,
    },
    subjective: {
      divergence: 0.4,
      global_rigor: 0.45,
      module_precision: 0.68,
    },
  },
  "gemini-3.8-flash-high": {
    tier: 3.0,
    cost: 1,
    visual: 0.3,
    usd_per_hour: 0.5,
    context_window: 1000000,
    efforts: ["medium", "high"],
    capabilities: {
      reasoning: 0.52,
      coding: 0.47,
      exploration: 0.5,
      anti_hallucination: 0.72,
      visual: 0.3,
      gui: 0.42,
    },
    subjective: {
      divergence: 0.35,
      global_rigor: 0.35,
      module_precision: 0.65,
    },
  },
  "deepseek-v4.1-flash-free": {
    tier: 2.8,
    cost: 0,
    visual: false,
    usd_per_hour: 0.0,
    context_window: 64000,
    disabled_by_default: true,
    efforts: ["low", "high", "max"],
    capabilities: {
      reasoning: 0.48,
      coding: 0.5,
      exploration: 0.5,
      anti_hallucination: 0.45,
      visual: 0.0,
      gui: 0.0,
    },
    subjective: {
      divergence: 0.45,
      global_rigor: 0.35,
      module_precision: 0.55,
    },
  },
  "grok-bot": {
    tier: 4.6,
    cost: 2,
    visual: false,
    excluded_when: "local_only",
    text_only: true,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.89,
      coding: 0.91,
      exploration: 0.88,
      anti_hallucination: 0.92,
      visual: 1.0,
      gui: 0.55,
    },
    subjective: {
      divergence: 0.62,
      global_rigor: 0.98,
      module_precision: 0.92,
    },
  },
  dot: {
    tier: 4.2,
    cost: 0,
    visual: false,
    excluded_when: "local_only",
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.8,
      coding: 0.79,
      exploration: 0.8,
      anti_hallucination: 0.78,
      visual: 0.0,
      gui: 0.0,
    },
    subjective: {
      divergence: 0.68,
      global_rigor: 0.82,
      module_precision: 0.84,
    },
  },
  "gpt-6-pro": {
    tier: 5.0,
    cost: 0,
    visual: false,
    advisor_only: true,
    advisor_for: ["direction_reasoning", "complex_build_plan"],
    disabled_by_default: true,
    efforts: ["max"],
    capabilities: {
      reasoning: 1.0,
      coding: 0.9,
      exploration: 0.78,
      anti_hallucination: 0.95,
      visual: 0.0,
      gui: 0.0,
    },
    subjective: {
      divergence: 0.95,
      global_rigor: 0.96,
      module_precision: 0.9,
    },
  },
  "gpt-5.6-sol": {
    tier: 3.4,
    cost: 2,
    visual: 0.65,
    usd_per_hour: 2.4,
    context_window: 272000,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.67,
      coding: 0.79,
      exploration: 0.58,
      anti_hallucination: 0.7,
      visual: 0.65,
      gui: 0.75,
    },
    subjective: {
      divergence: 0.4,
      global_rigor: 0.25,
      module_precision: 0.88,
    },
  },
  "gpt-5.6-terra": {
    tier: 3.5,
    cost: 2,
    visual: 0.67,
    usd_per_hour: 2.7,
    context_window: 272000,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.69,
      coding: 0.78,
      exploration: 0.66,
      anti_hallucination: 0.71,
      visual: 0.67,
      gui: 0.74,
    },
    subjective: {
      divergence: 0.48,
      global_rigor: 0.6,
      module_precision: 0.83,
    },
  },
  "gpt-5.6-luna": {
    tier: 3.1,
    cost: 1,
    visual: 0.5,
    usd_per_hour: 0.7,
    context_window: 272000,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.55,
      coding: 0.62,
      exploration: 0.54,
      anti_hallucination: 0.59,
      visual: 0.5,
      gui: 0.45,
    },
    subjective: {
      divergence: 0.38,
      global_rigor: 0.42,
      module_precision: 0.65,
    },
  },
  "grok-4.7-build-fast": {
    tier: 3.1,
    cost: 1,
    visual: false,
    usd_per_hour: 0.5,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.54,
      coding: 0.58,
      exploration: 0.54,
      anti_hallucination: 0.55,
      visual: 0,
      gui: 0,
    },
    subjective: {
      divergence: 0.55,
      global_rigor: 0.45,
      module_precision: 0.6,
    },
  },
  "deepseek-v4-pro": {
    tier: 3.9,
    cost: 2,
    visual: false,
    usd_per_hour: 1.2,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.78,
      coding: 0.82,
      exploration: 0.72,
      anti_hallucination: 0.75,
      visual: 0,
      gui: 0,
    },
    subjective: {
      divergence: 0.62,
      global_rigor: 0.74,
      module_precision: 0.84,
    },
  },
  "glm-5.3": {
    tier: 3.7,
    cost: 2,
    visual: 0.6,
    usd_per_hour: 1.0,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.72,
      coding: 0.78,
      exploration: 0.74,
      anti_hallucination: 0.72,
      visual: 0.6,
      gui: 0.55,
    },
    subjective: {
      divergence: 0.6,
      global_rigor: 0.72,
      module_precision: 0.8,
    },
  },
  "glm-5.3-flash-free": {
    tier: 2.9,
    cost: 0,
    visual: 0.4,
    usd_per_hour: 0,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.5,
      coding: 0.54,
      exploration: 0.52,
      anti_hallucination: 0.52,
      visual: 0.4,
      gui: 0.3,
    },
    subjective: {
      divergence: 0.45,
      global_rigor: 0.42,
      module_precision: 0.58,
    },
  },
  "qwen3-coder-next": {
    tier: 3.7,
    cost: 2,
    visual: false,
    usd_per_hour: 1.0,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.7,
      coding: 0.82,
      exploration: 0.65,
      anti_hallucination: 0.66,
      visual: 0,
      gui: 0,
    },
    subjective: {
      divergence: 0.48,
      global_rigor: 0.67,
      module_precision: 0.84,
    },
  },
  "qwen3.8-max": {
    tier: 3.9,
    cost: 2,
    visual: 0.65,
    usd_per_hour: 1.5,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.78,
      coding: 0.8,
      exploration: 0.75,
      anti_hallucination: 0.74,
      visual: 0.65,
      gui: 0.48,
    },
    subjective: {
      divergence: 0.67,
      global_rigor: 0.75,
      module_precision: 0.8,
    },
  },
  "kimi-k3.1-pro": {
    tier: 4.0,
    cost: 2,
    visual: 0.68,
    usd_per_hour: 1.8,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.79,
      coding: 0.82,
      exploration: 0.83,
      anti_hallucination: 0.74,
      visual: 0.68,
      gui: 0.5,
    },
    subjective: {
      divergence: 0.72,
      global_rigor: 0.76,
      module_precision: 0.81,
    },
  },
  "kimi-k3": {
    tier: 3.8,
    cost: 2,
    visual: 0.62,
    usd_per_hour: 1.2,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.74,
      coding: 0.79,
      exploration: 0.8,
      anti_hallucination: 0.7,
      visual: 0.62,
      gui: 0.45,
    },
    subjective: {
      divergence: 0.7,
      global_rigor: 0.71,
      module_precision: 0.78,
    },
  },
  "minimax-m3": {
    tier: 3.8,
    cost: 2,
    visual: 0.6,
    usd_per_hour: 1.0,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.73,
      coding: 0.81,
      exploration: 0.75,
      anti_hallucination: 0.7,
      visual: 0.6,
      gui: 0.45,
    },
    subjective: {
      divergence: 0.63,
      global_rigor: 0.7,
      module_precision: 0.82,
    },
  },
  "minimax-m3.1-flash": {
    tier: 3.5,
    cost: 1,
    visual: 0.55,
    usd_per_hour: 0.6,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.66,
      coding: 0.74,
      exploration: 0.68,
      anti_hallucination: 0.65,
      visual: 0.55,
      gui: 0.4,
    },
    subjective: {
      divergence: 0.58,
      global_rigor: 0.62,
      module_precision: 0.76,
    },
  },
  "doubao-seed-2-1-pro-260628": {
    tier: 3.7,
    cost: 2,
    visual: 0.65,
    usd_per_hour: 0.8,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.72,
      coding: 0.74,
      exploration: 0.74,
      anti_hallucination: 0.7,
      visual: 0.65,
      gui: 0.5,
    },
    subjective: {
      divergence: 0.66,
      global_rigor: 0.68,
      module_precision: 0.74,
    },
  },
  "mimo-v2.6-pro": {
    tier: 3.7,
    cost: 2,
    visual: 0.6,
    usd_per_hour: 0.8,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.72,
      coding: 0.79,
      exploration: 0.7,
      anti_hallucination: 0.69,
      visual: 0.6,
      gui: 0.45,
    },
    subjective: {
      divergence: 0.57,
      global_rigor: 0.67,
      module_precision: 0.8,
    },
  },
  "mimo-v2.6-flash-free": {
    tier: 2.9,
    cost: 0,
    visual: 0.4,
    usd_per_hour: 0,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.51,
      coding: 0.55,
      exploration: 0.51,
      anti_hallucination: 0.5,
      visual: 0.4,
      gui: 0.3,
    },
    subjective: {
      divergence: 0.45,
      global_rigor: 0.42,
      module_precision: 0.58,
    },
  },
  "nemotron-3-ultra-free": {
    tier: 3.4,
    cost: 0,
    visual: false,
    usd_per_hour: 0,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.65,
      coding: 0.7,
      exploration: 0.65,
      anti_hallucination: 0.63,
      visual: 0,
      gui: 0,
    },
    subjective: {
      divergence: 0.53,
      global_rigor: 0.62,
      module_precision: 0.71,
    },
  },
  "nemotron-3.5-super-vl-free": {
    tier: 3.3,
    cost: 0,
    visual: 0.65,
    usd_per_hour: 0,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.62,
      coding: 0.65,
      exploration: 0.63,
      anti_hallucination: 0.62,
      visual: 0.65,
      gui: 0.45,
    },
    subjective: {
      divergence: 0.52,
      global_rigor: 0.59,
      module_precision: 0.66,
    },
  },
  "nemotron-3.5-lightning-free": {
    tier: 2.9,
    cost: 0,
    visual: false,
    usd_per_hour: 0,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.5,
      coding: 0.54,
      exploration: 0.5,
      anti_hallucination: 0.48,
      visual: 0,
      gui: 0,
    },
    subjective: {
      divergence: 0.42,
      global_rigor: 0.42,
      module_precision: 0.56,
    },
  },
  "mistral-large-4": {
    tier: 3.8,
    cost: 2,
    visual: 0.65,
    usd_per_hour: 1.2,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.74,
      coding: 0.78,
      exploration: 0.73,
      anti_hallucination: 0.71,
      visual: 0.65,
      gui: 0.45,
    },
    subjective: {
      divergence: 0.65,
      global_rigor: 0.71,
      module_precision: 0.78,
    },
  },
  "muse-wonder-1.0": {
    tier: 3.9,
    cost: 2,
    visual: 0.72,
    usd_per_hour: 1.5,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.77,
      coding: 0.77,
      exploration: 0.79,
      anti_hallucination: 0.73,
      visual: 0.72,
      gui: 0.48,
    },
    subjective: {
      divergence: 0.71,
      global_rigor: 0.73,
      module_precision: 0.77,
    },
  },
  "beam-free": {
    tier: 3.0,
    cost: 0,
    visual: false,
    usd_per_hour: 0,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.53,
      coding: 0.56,
      exploration: 0.53,
      anti_hallucination: 0.5,
      visual: 0,
      gui: 0,
    },
    subjective: {
      divergence: 0.45,
      global_rigor: 0.45,
      module_precision: 0.58,
    },
  },
  "flint-40b-free": {
    tier: 2.8,
    cost: 0,
    visual: false,
    usd_per_hour: 0,
    disabled_by_default: true,
    efforts: ["high"],
    capabilities: {
      reasoning: 0.48,
      coding: 0.52,
      exploration: 0.48,
      anti_hallucination: 0.46,
      visual: 0,
      gui: 0,
    },
    subjective: {
      divergence: 0.4,
      global_rigor: 0.4,
      module_precision: 0.54,
    },
  },
};

export const MODEL_ALIASES = {
  "claude-haiku-4-5@20251001": "claude-haiku-5-5",
  "claude-haiku-4-5": "claude-haiku-5-5",
  "claude-opus-5": "claude-opus-5-5",
  "claude-opus-5-5-low": "claude-opus-5-5",
  "claude-opus-5-5-medium": "claude-opus-5-5",
  "claude-opus-5-5-high": "claude-opus-5-5",
  "claude-opus-4-6": "claude-opus-5-5",
  "claude-opus-4-5": "claude-opus-5-5",
  "claude-sonnet-5": "claude-sonnet-5-5",
  "claude-sonnet-5-5-low": "claude-sonnet-5-5",
  "claude-sonnet-5-5-medium": "claude-sonnet-5-5",
  "claude-sonnet-5-5-high": "claude-sonnet-5-5",
  "claude-sonnet-4-6": "claude-sonnet-5-5",
  "claude-sonnet-4-5": "claude-sonnet-5-5",
  "claude-fable-5": "claude-fable-5-1",
  "gemini-3.8-flash": "gemini-3.8-flash-high",
  "gemini-2.5-flash": "gemini-3.8-flash-high",
  "gemini-4-argon": "gemini-4-argon-high",
  "gemini-4-pro": "gemini-4-argon-high",
  "gemini-2.5-pro": "gemini-4-argon-high",
  "gemini-4-ultra": "gemini-4-argon-high",
  argon: "gemini-4-argon-high",
  "ChatGPT Pro via chatgpt-pro-consult": "gpt-6-pro",
  "gpt-5.4": "gpt-6-astra",
  "gpt-5.3-codex": "gpt-6.1-sol",
  "gpt-5.4-mini": "gpt-6-luna",
  "gpt-5.6-sol-mini": "gpt-6-luna",
  "grok-4.7-latest": "grok-4.7",
  "grok-4": "grok-4.7",
  "opencode/deepseek-v4.1-flash-free": "deepseek-v4.1-flash-free",
  "deepseek-v4.1-flash": "deepseek-v4.1-flash-free",
  "deepseek-v4.1-io": "deepseek-v4.1-flash-free",
  deepseek: "deepseek-v4.1-flash-free",
  "glm-5.3-flash": "glm-5.3-flash-free",
  "opencode/glm-5.3-flash-free": "glm-5.3-flash-free",
  "MiniMax-M3": "minimax-m3",
  "MiniMax-M3.1-Flash": "minimax-m3.1-flash",
  "mimo-v2.6-flash": "mimo-v2.6-flash-free",
  "mimo-v2.6-pro-ultraspeed": "mimo-v2.6-pro",
  "kimi-k3.1-pro-highspeed": "kimi-k3.1-pro",
  "nemotron-3-ultra-550b-a55b": "nemotron-3-ultra-free",
  "nemotron-3.5-super-vl-120b-a12b": "nemotron-3.5-super-vl-free",
  "nemotron-3.5-lightning-30b-a3b": "nemotron-3.5-lightning-free",
  "opencode/mimo-v2.6-flash-free": "mimo-v2.6-flash-free",
  "opencode/nemotron-3-ultra-free": "nemotron-3-ultra-free",
  "opencode/nemotron-3.5-super-vl-free": "nemotron-3.5-super-vl-free",
  "opencode/nemotron-3.5-lightning-free": "nemotron-3.5-lightning-free",
  "opencode/beam-free": "beam-free",
  "opencode/flint-40b-free": "flint-40b-free",
};

export const EFFORT_CURVES = {
  "deepseek-v4.1-flash-free": {
    ability: { default: 0.0, low: -0.2, high: 0.0, max: 0.1 },
    burn: { default: 0.7, low: 0.35, high: 0.7, max: 1.4 },
  },
  "claude-opus-5-5": {
    ability: { low: -1.2, medium: -0.3, high: 0.0, xhigh: 0.2, max: 0.4 },
    burn: { low: 0.21, medium: 0.52, high: 0.7, xhigh: 1.33, max: 2.3 },
  },
  "claude-sonnet-5-5": {
    ability: { low: -1.1, medium: -0.6, high: 0.0, xhigh: 0.5, max: 0.9 },
    burn: { low: 0.28, medium: 0.38, high: 0.7, xhigh: 1.6, max: 4.34 },
  },
  "gpt-6-astra": {
    ability: { low: -0.5, medium: -0.1, high: 0.0, xhigh: 0.1, max: 0.2 },
    burn: { low: 0.33, medium: 0.62, high: 0.7, xhigh: 0.93, max: 1.32 },
  },
  "gpt-6.1-sol": {
    ability: { low: -0.8, medium: -0.2, high: 0.0, xhigh: 0.1, max: 0.2 },
    burn: { low: 0.28, medium: 0.46, high: 0.7, xhigh: 0.85, max: 1.58 },
  },
  "grok-4.7": {
    ability: { low: -0.4, high: 0.0, xhigh: 0.0 },
    burn: { low: 0.32, high: 0.7, xhigh: 0.96 },
  },
  "gemini-3.8-flash-high": {
    ability: { medium: -0.1, high: 0.0 },
    burn: { medium: 0.53, high: 0.7 },
  },
  "gemini-4-argon-high": {
    ability: { low: -0.3, medium: -0.1, high: 0.0 },
    burn: { low: 0.63, medium: 0.7, high: 0.7 },
  },
  "claude-fable-5-1": {
    ability: { low: -0.7, medium: -0.3, high: 0.0, xhigh: 0.2, max: 0.4 },
    burn: { low: 0.2, medium: 0.4, high: 0.7, xhigh: 1.0, max: 1.3 },
  },
};

export const DEFAULT_SCORING_POLICY = {
  weights: {
    fit: 0.3,
    ability: 0.1,
    continuity: 0.25,
  },
  coupling_continuity_multiplier: {
    low: 0.4,
    medium: 1.0,
    high: 2.5,
  },
  fallback_fit: {
    start: 0.6,
    step: 0.015,
    floor: 0.4,
  },
  extra_effort_penalty: 0.025,
  high_precision_effort_weight: 0.14,
  fast_burn_multiplier: 2.0,
  fast_plentiful_usable_pct: 45.0,
  fast_max_shortage_prob: 0.2,
  fast_max_extra_opportunity_cost: 0.015,
  fast_sprint_sunk_threshold: 0.25,
  fast_bonus_max: 0.04,
  unlimited_bonus: 0.18,
  deferred_start_penalty: 0.15,
  rotate_after_carried_tokens: 2000000,
  context_burn_extra_at_250k: 0.5,
  needs_judgment_margin: 0.02,
  harness_order: ["codex", "pi"],
  harness_step: 0.03,
  harness_factors: {
    default: 1.0,
    rules: [
      {
        harness: "antigravity-resilient",
        model_prefix: "claude",
        factor: 0.9,
      },
      {
        harness: "antigravity",
        model_prefix: "claude",
        factor: 0.9,
      },
    ],
  },
  safety_margin_pct: 5,
  short_window_floor_pct: 10,
  short_window_hours: 24,
  small_short_capacity_usd: 50,
  small_short_window_floor_pct: 25,
  small_short_safety_margin_pct: 12,
  defer_if_reset_within_hours: 6,
  reset_horizon_hours: 36,
  reset_bonus_max: 1.2,
  reset_surplus_ref_pct: 15,
  reset_urgency_power: 1.0,
  demand_cv: 0.35,
  demand_sd_floor_pct: 5,
  demand_min_elapsed_hours: 6,
  demand_pace_floor_ratio: 0.5,
  scarcity_usable_ref_pct: 45.0,
  scarcity_penalty_max: 0.06,
  unknown_capacity_penalty: 0.03,
  shortage_loss_per_usd: 0.012,
  shortage_loss_per_worker_hour: 0.06,
  opportunity_exchange: {
    score_per_displaced_usd: 0.012,
    score_per_displaced_worker_hour: 0.06,
  },
  default_hours: {
    routine: 0.4,
    hard: 1.0,
    coupled: 2.0,
    frontier: 3.5,
  },
  ability_floor: {
    routine: 3.0,
    hard: 3.3,
    coupled: 3.6,
    frontier: 4.2,
  },
  ability_span: 0.6,
  effort_unlock_difficulties: ["coupled", "frontier"],
  critical_headroom: 0.3,
  effort_ability: {
    none: -1.1,
    off: -1.1,
    minimal: -1.0,
    low: -0.7,
    medium: -0.3,
    high: 0.0,
    xhigh: 0.2,
    max: 0.4,
    ultra: 0.5,
  },
  effort_burn: {
    none: 0.1,
    off: 0.1,
    minimal: 0.12,
    low: 0.2,
    medium: 0.4,
    high: 0.7,
    xhigh: 1.0,
    max: 1.3,
    ultra: 1.6,
  },
  demand: {
    property_span: 0.5,
    default_load: 0.5,
    depth_coupling: 0.06,
    shortfall_weight: 0.35,
    precision_headroom: 0.15,
    sprint_effort_weight: 0.06,
    property_weights: {
      code_complexity: 1.0,
      context_scale: 0.8,
      divergence: 0.8,
      hallucination_risk: 1.0,
      error_cost: 0.5,
    },
  },
  profile: {
    difficulty_by_depth: {
      1: "routine",
      2: "hard",
      3: "coupled",
      4: "frontier",
    },
    saturation_span: 0.3,
    vector_weight: 0.5,
    subjective: {
      weight: 0.49,
      vector_weight: 0.34,
      route_weight: 0.17,
    },
    overqualification_weight: 0.08,
    overqualification_span: 0.6,
    overqualification_ref_usd_per_hour: 10.0,
    overqualification_price_cap: 3.0,
    requirements: {
      reasoning: { 1: 0.45, 2: 0.6, 3: 0.75, 4: 0.9 },
      coding: { 0: 0.0, 1: 0.5, 2: 0.65, 3: 0.8 },
      exploration: { 1: 0.4, 2: 0.6, 3: 0.75 },
      anti_hallucination: { 1: 0.4, 2: 0.6, 3: 0.8 },
      visual: 0.6,
      gui: { 1: 0.5, 2: 0.7, 3: 0.8, 4: 0.85 },
    },
    requirement_weights: {
      reasoning: 1.0,
      coding: 1.0,
      exploration: 0.5,
      exploration_style: 1.0,
      anti_hallucination: 0.5,
      anti_hallucination_high: 1.0,
      visual: 1.0,
      gui: 1.5,
    },
    harness_by_style: {
      engineering: ["codex", "pi"],
      exploration: ["pi", "codex"],
    },
    kind_by_style: {
      engineering: "general_implementation",
      exploration: "exploration_analysis",
      text_only: "text_in_text_out",
      advisory: "direction_reasoning",
    },
  },
};

/**
 * Strip provider prefix (`provider/model`) and `:effort` suffix if present, then resolve alias.
 */
export function canonicalModel(rawModel, aliases = MODEL_ALIASES) {
  if (!rawModel || typeof rawModel !== "string") return "";
  let clean = rawModel.trim().replace(/\[1m\]$/i, "");
  const colonIdx = clean.lastIndexOf(":");
  if (colonIdx > 0) {
    const suffix = clean.slice(colonIdx + 1).toLowerCase();
    if (["none", "off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "auto"].includes(suffix)) {
      clean = clean.slice(0, colonIdx);
    }
  }
  if (aliases[clean]) return aliases[clean];
  let unprefixed = clean;
  while (unprefixed.includes("/")) {
    unprefixed = unprefixed.slice(unprefixed.indexOf("/") + 1);
    if (aliases[unprefixed]) return aliases[unprefixed];
    const lowerStep = unprefixed.toLowerCase();
    if (aliases[lowerStep]) return aliases[lowerStep];
  }
  const lower = unprefixed.toLowerCase();
  if (aliases[lower]) return aliases[lower];
  return unprefixed;
}

export function resolveModelSpec(rawModel, models = DEFAULT_MODELS, aliases = MODEL_ALIASES) {
  const name = canonicalModel(rawModel, aliases);
  if (models[name]) return { canonical: name, spec: models[name] };
  // Fuzzy family fallback for provider-specific model IDs
  const lower = name.toLowerCase();
  if (lower.includes("opus")) return { canonical: "claude-opus-5-5", spec: models["claude-opus-5-5"] };
  if (lower.includes("fable")) return { canonical: "claude-fable-5-1", spec: models["claude-fable-5-1"] };
  if (lower.includes("sonnet")) return { canonical: "claude-sonnet-5-5", spec: models["claude-sonnet-5-5"] };
  if (lower.includes("haiku")) return { canonical: "claude-haiku-5-5", spec: models["claude-haiku-5-5"] };
  if (lower.includes("argon") || (lower.includes("gemini") && (lower.includes("pro") || lower.includes("ultra")))) {
    return { canonical: "gemini-4-argon-high", spec: models["gemini-4-argon-high"] };
  }
  if (lower.includes("flash")) return { canonical: "gemini-3.8-flash-high", spec: models["gemini-3.8-flash-high"] };
  if (lower.includes("astra") || lower.includes("gpt-5.4") || lower.includes("gpt-6-pro")) {
    return { canonical: "gpt-6-astra", spec: models["gpt-6-astra"] };
  }
  if (lower.includes("terra")) return { canonical: "gpt-6.1-terra", spec: models["gpt-6.1-terra"] };
  if (lower.includes("luna") || lower.includes("mini")) return { canonical: "gpt-6-luna", spec: models["gpt-6-luna"] };
  if (lower.includes("sol") || lower.includes("codex")) return { canonical: "gpt-6.1-sol", spec: models["gpt-6.1-sol"] };
  if (lower.includes("grok")) return { canonical: "grok-4.7", spec: models["grok-4.7"] };
  if (lower.includes("deepseek")) return { canonical: "deepseek-v4.1-flash-free", spec: models["deepseek-v4.1-flash-free"] };
  return {
    canonical: name || "unknown",
    spec: {
      tier: 3.4,
      cost: 2,
      visual: 0.5,
      usd_per_hour: 3.0,
      context_window: 128000,
      efforts: ["low", "medium", "high"],
      capabilities: {
        reasoning: 0.65,
        coding: 0.65,
        exploration: 0.65,
        anti_hallucination: 0.65,
        visual: 0.5,
        gui: 0.4,
      },
      subjective: {
        divergence: 0.5,
        global_rigor: 0.5,
        module_precision: 0.5,
      },
    },
  };
}
