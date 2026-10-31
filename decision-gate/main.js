// Decision Gate answers Cindy's control points from rules shaped as when → what to judge → what to do:
// - when a new task starts (will-start-task): pick one → a model per option; yes/no → highest reasoning effort;
// - before an automation or routine runs (will-schedule-run / will-routine-run): yes/no → skip this run.
// Rules for a moment are checked top to bottom; the first with a conclusion applies. Below threshold counts as unsure.
// OpenAI Decisions (gpt-6-luna) or TypeSafe Jev answers all questions for a moment in one request.
// On error no verdict is sent: Cindy follows the task's failure setting (a new task keeps the original model).
const POINTS = ['will-start-task', 'will-schedule-run', 'will-routine-run'];
const DEFAULT_MODELS = { jev: 'jev-latest', openai: 'gpt-6-luna' };
const AGENT_KIND = { 'claude-code': 'cc', codex: 'codex', pi: 'pi' };
const MESSAGES = {
  "en": {
    effortKept: "Reasoning effort is already at its highest",
    effortKeptSummary: "Yes {pct} → model and reasoning effort unchanged",
    badOptionLabels: "Each option needs a name, and names must be different: the decision model answers with the name.",
    modelAmbiguous: "“{model}” matches several models: {candidates}. Pass model with agent and providerId from availableModels.",
    serviceAuth: "The API key was rejected. Check or replace it under Judged by.",
    serviceLimit: "The judge service limit or quota was reached. Try again later or check your plan.",
    serviceDown: "The judge service is temporarily unavailable. Please try again later.",
    whyNoRules: "no rules are enabled",
    whyNoQuestions: "no rule needs the model",
    whyUnsure: "no rule was confident enough",
    keywordReason: "Matched keyword “{word}”",
    keywordSummary: "Keyword “{word}” → skip",
    effortReason: "Raised reasoning effort {pct}",
    effortSummary: "Yes {pct} → {effort} reasoning effort",
    judgedBy: "{name} judged {pct}",
    yesSkip: "Yes {pct} → skip",
    requestFailed: "Request failed",
    badPoint: "point must be will-start-task, will-schedule-run or will-routine-run",
    noQuestion: "question is missing: write one question for the decision model",
    modelNotFound: "Model “{model}” was not found. Check availableModels with list_rules and use an id or name from it.",
    noteStart: "Saved. It checks only the first message of a new task, once. The user must choose “Pick by rules” in the new task model picker for it to apply.",
    noteRun: "Saved. The user must choose Plugin → Decision Gate in that automation or routine’s pre-run check for it to apply.",
    ruleNotFound: "This rule does not exist. Get its id with list_rules first.",
    unknownTool: "Unknown tool {tool}",
    storeFailed: "Could not read or write rules: {error}. Please try again later.",
    saveRuleFirst: "Save this rule first",
    effort_minimal: "Minimal",
    effort_low: "Low",
    effort_medium: "Medium",
    effort_high: "High",
    effort_xhigh: "Extra high",
    effort_max: "Max",
    effort_ultra: "Ultra",
  },
  "zh-CN": {
    effortKept: "推理强度已经是最高",
    effortKeptSummary: "是 {pct} → 模型和推理强度不变",
    badOptionLabels: "每个选项都要有名称，且名称不能重复：决策模型按名称作答。",
    modelAmbiguous: "「{model}」对应多个模型：{candidates}。请按 availableModels 同时传 model、agent 和 providerId。",
    serviceAuth: "API Key 被拒绝。请在「判断用」里检查或更换。",
    serviceLimit: "判断服务达到限额或额度不足。请稍后再试，或检查套餐。",
    serviceDown: "判断服务暂时不可用，请稍后再试。",
    whyNoRules: "没有启用的规则",
    whyNoQuestions: "没有需要模型判断的规则",
    whyUnsure: "没有规则有把握",
    keywordReason: "命中关键词「{word}」",
    keywordSummary: "关键词「{word}」→ 跳过",
    effortReason: "推理强度调高 {pct}",
    effortSummary: "是 {pct} → 推理强度{effort}",
    judgedBy: "{name} 判断 {pct}",
    yesSkip: "是 {pct} → 跳过",
    requestFailed: "请求失败",
    badPoint: "point 必须是 will-start-task / will-schedule-run / will-routine-run 之一",
    noQuestion: "缺少 question：写一句交给决策模型判断的问题",
    modelNotFound: "找不到模型「{model}」。先用 list_rules 看 availableModels，再按其中的 id 或名称填写。",
    noteStart: "已保存。只在新任务的第一条消息判断一次；用户需要在新任务的模型选择器里选「按规则选模型」才会生效。",
    noteRun: "已保存。用户需要在对应自动化或例行任务的「前置检查」里选「插件 → 决策闸门」才会生效。",
    ruleNotFound: "没有这条规则，先用 list_rules 查 id",
    unknownTool: "未知工具 {tool}",
    storeFailed: "读写规则失败：{error}。请稍后重试。",
    saveRuleFirst: "先保存这条规则",
    effort_minimal: "最低",
    effort_low: "低",
    effort_medium: "中",
    effort_high: "高",
    effort_xhigh: "超高",
    effort_max: "最高",
    effort_ultra: "极致",
  },
  "ja": {
    effortKept: "推論レベルはすでに最高です",
    effortKeptSummary: "はい {pct} → モデルと推論レベルは変更なし",
    badOptionLabels: "各選択肢に名前が必要で、名前は重複できません。判断モデルは名前で回答します。",
    modelAmbiguous: "「{model}」は複数のモデルに一致します: {candidates}。availableModels の model、agent、providerId を指定してください。",
    serviceAuth: "API キーが拒否されました。判断モデルの設定で確認または変更してください。",
    serviceLimit: "判断サービスの上限またはクォータに達しました。後でもう一度試すか、プランを確認してください。",
    serviceDown: "判断サービスは一時的に利用できません。後でもう一度お試しください。",
    whyNoRules: "有効なルールがありません",
    whyNoQuestions: "モデルの判断が必要なルールがありません",
    whyUnsure: "確信できるルールがありません",
    keywordReason: "キーワード「{word}」に一致",
    keywordSummary: "キーワード「{word}」→ スキップ",
    effortReason: "推論レベルを上げる {pct}",
    effortSummary: "はい {pct} → 推論レベル {effort}",
    judgedBy: "{name} の判断 {pct}",
    yesSkip: "はい {pct} → スキップ",
    requestFailed: "リクエストに失敗しました",
    badPoint: "point は will-start-task / will-schedule-run / will-routine-run のいずれかにしてください",
    noQuestion: "question がありません。判断モデルへの質問を 1 つ書いてください",
    modelNotFound: "モデル「{model}」が見つかりません。list_rules の availableModels を確認し、その id か名前を指定してください。",
    noteStart: "保存しました。新しいタスクの最初のメッセージで一度だけ判断します。適用するには、新しいタスクのモデル選択で「ルールで選ぶ」を選ぶ必要があります。",
    noteRun: "保存しました。適用するには、その自動化またはルーティンの実行前チェックで「プラグイン → Decision Gate」を選ぶ必要があります。",
    ruleNotFound: "このルールはありません。先に list_rules で id を確認してください",
    unknownTool: "不明なツール {tool}",
    storeFailed: "ルールの読み書きに失敗しました: {error}。後でもう一度お試しください。",
    saveRuleFirst: "先にこのルールを保存してください",
    effort_minimal: "最小",
    effort_low: "低",
    effort_medium: "中",
    effort_high: "高",
    effort_xhigh: "超高",
    effort_max: "最大",
    effort_ultra: "ウルトラ",
  },
  "ko": {
    effortKept: "추론 강도가 이미 최고입니다",
    effortKeptSummary: "예 {pct} → 모델과 추론 강도 변경 없음",
    badOptionLabels: "각 선택지에는 이름이 있어야 하며 이름은 겹칠 수 없습니다. 판단 모델은 이름으로 답합니다.",
    modelAmbiguous: "“{model}”에 해당하는 모델이 여러 개입니다: {candidates}. availableModels의 model, agent, providerId를 함께 전달하세요.",
    serviceAuth: "API 키가 거부되었습니다. 판단 모델 설정에서 확인하거나 교체하세요.",
    serviceLimit: "판단 서비스 한도 또는 할당량에 도달했습니다. 나중에 다시 시도하거나 요금제를 확인하세요.",
    serviceDown: "판단 서비스를 일시적으로 사용할 수 없습니다. 나중에 다시 시도하세요.",
    whyNoRules: "사용 중인 규칙이 없습니다",
    whyNoQuestions: "모델 판단이 필요한 규칙이 없습니다",
    whyUnsure: "확신할 수 있는 규칙이 없습니다",
    keywordReason: "키워드 “{word}” 일치",
    keywordSummary: "키워드 “{word}” → 건너뛰기",
    effortReason: "추론 강도 높임 {pct}",
    effortSummary: "예 {pct} → 추론 강도 {effort}",
    judgedBy: "{name} 판단 {pct}",
    yesSkip: "예 {pct} → 건너뛰기",
    requestFailed: "요청 실패",
    badPoint: "point는 will-start-task / will-schedule-run / will-routine-run 중 하나여야 합니다",
    noQuestion: "question이 없습니다. 판단 모델에 물을 질문을 하나 쓰세요",
    modelNotFound: "모델 “{model}”을 찾을 수 없습니다. list_rules의 availableModels에서 id나 이름을 확인해 쓰세요.",
    noteStart: "저장했습니다. 새 작업의 첫 메시지에서 한 번만 판단합니다. 적용하려면 새 작업의 모델 선택기에서 “규칙으로 선택”를 골라야 합니다.",
    noteRun: "저장했습니다. 적용하려면 해당 자동화나 루틴의 실행 전 확인에서 “플러그인 → Decision Gate”를 골라야 합니다.",
    ruleNotFound: "이 규칙이 없습니다. 먼저 list_rules로 id를 확인하세요",
    unknownTool: "알 수 없는 도구 {tool}",
    storeFailed: "규칙을 읽거나 쓰지 못했습니다: {error}. 나중에 다시 시도하세요.",
    saveRuleFirst: "먼저 이 규칙을 저장하세요",
    effort_minimal: "최소",
    effort_low: "낮음",
    effort_medium: "중간",
    effort_high: "높음",
    effort_xhigh: "매우 높음",
    effort_max: "최대",
    effort_ultra: "울트라",
  },
};
let locale = 'en';
const t = (key, vars = {}) => (MESSAGES[locale]?.[key] ?? MESSAGES.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
async function loadLocale() {
  const context = await cindy.request({ kind: 'app-context' }).catch(() => null);
  const next = context?.context?.locale;
  locale = MESSAGES[next] ? next : 'en';
}
const effortName = (effort) => (MESSAGES.en[`effort_${effort}`] ? t(`effort_${effort}`) : effort);

// The brain and the settings page rewrite the whole config: one lock keeps either from writing back a stale copy.
const withConfigLock = (fn) => (globalThis.navigator?.locks ? navigator.locks.request('decision-gate-config', fn) : fn());

// A failed read must not look like "no rules": callers would overwrite the stored rules or allow the run.
async function readConfig() {
  const res = await fetch('/kv');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return withRules(await res.json());
}

async function writeConfig(cfg) {
  const res = await fetch('/kv', { method: 'PUT', body: JSON.stringify(cfg) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  channel.postMessage({ from: 'brain', type: 'config-changed' });
}

// The model this plugin adds to the new task picker. Published only once a rule can actually decide.
const PICKER_MODEL = {
  id: 'by-rules',
  name: 'Pick by rules',
  description: 'Picks a model for a new task from your rules',
  locales: {
    'zh-CN': { name: '按规则选模型', description: '开新任务时，按你写的规则选模型' },
    ja: { name: 'ルールで選ぶ', description: '新しいタスクのモデルをルールで選びます' },
    ko: { name: '규칙으로 선택', description: '새 작업의 모델을 규칙에 따라 고릅니다' },
  },
  target: { type: 'route' },
};
// Publishes run one at a time and each reads the latest state once it is its turn, so a slow older
// publish can never remove a model a newer save just added. If a read fails, the last list stays.
// Its own lock: callers may already hold the config lock, and this one never waits on that.
function publishModels() {
  const run = async () => {
    try {
      const [configRes, secretsRes] = await Promise.all([fetch('/kv'), fetch('/secrets')]);
      if (!configRes.ok || !secretsRes.ok) return;
      const [config, list] = await Promise.all([configRes.json(), secretsRes.json()]);
      // The judge in use needs its key, not just any key. Same default as usesOpenAi: OpenAI unless Jev was chosen.
      const keyName = config.provider === 'jev' ? 'typesafe_api_key' : 'openai_api_key';
      const keySaved = list.some((s) => s.key === keyName && s.saved);
      const rules = Array.isArray(config.rules) ? config.rules : [];
      const ready = keySaved && rules.some((r) => r.point === 'will-start-task' && r.enabled !== false);
      // Hosts before model publishing answer with an error here; the rest of the plugin still works.
      await fetch('/models', { method: 'PUT', body: JSON.stringify({ models: ready ? [PICKER_MODEL] : [] }) });
    } catch { /* the picker keeps the last published list */ }
  };
  return globalThis.navigator?.locks ? navigator.locks.request('decision-gate-models', run) : run();
}

// Rule ids are sent to the decision API as question names.
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

const withRules = (raw) => ({ ...raw, rules: Array.isArray(raw.rules) ? raw.rules : [] });

function describe(point, data) {
  if (point === 'will-start-task') {
    return [`First message: ${data.text}`, data.attachmentCount ? `Attachments: ${data.attachmentCount}` : ''].filter(Boolean).join('\n');
  }
  const lines = [`Type: ${point === 'will-routine-run' ? 'teammate routine' : 'automation'}`, `Name: ${data.name}`, `Prompt: ${data.prompt || '(none)'}`];
  if (data.trigger) lines.push(`Trigger: ${data.trigger}`);
  if (Array.isArray(data.events) && data.events.length > 0) lines.push(`Events: ${JSON.stringify(data.events).slice(0, 4000)}`);
  lines.push(`Current time: ${new Date().toISOString()}`);
  return lines.join('\n');
}

const budget = (deadline) => Math.max(1000, Math.min(deadline - Date.now() - 1500, 20000));

async function post(url, body, deadline) {
  const r = await cindy.fetch({ url, method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs: budget(deadline), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(r.message || t('requestFailed'));
  if (r.status !== 200) {
    const hint = r.status === 401 || r.status === 403 ? 'serviceAuth' : r.status === 402 || r.status === 429 ? 'serviceLimit' : r.status >= 500 ? 'serviceDown' : null;
    const detail = `HTTP ${r.status}: ${String(r.body).slice(0, 200)}`;
    throw new Error(hint ? `${t(hint)} (${detail})` : detail);
  }
  return JSON.parse(r.body);
}

// Same default as the settings page: OpenAI unless the user chose Jev.
const usesOpenAi = (cfg) => cfg.provider !== 'jev';

// Ask all rules for a moment in one request. Returns { [ruleId]: { probability } | { choice, confidence } }.
async function askAll(cfg, rules, input, deadline) {
  if (usesOpenAi(cfg)) {
    const res = await post('https://api.openai.com/v1/decisions', {
      model: cfg.openaiModel || DEFAULT_MODELS.openai,
      input,
      questions: rules.map((rule) => rule.type === 'choice'
        ? { type: 'choice', name: rule.id, instructions: rule.question, choices: rule.options.map((o) => ({ value: o.label, description: o.description || o.label })) }
        : { type: 'predicate', name: rule.id, instructions: rule.question }),
    }, deadline);
    const out = {};
    for (const answer of res.answers || []) {
      if (answer.type === 'predicate') out[answer.name] = { probability: answer.probability };
      else if (answer.type === 'choice') out[answer.name] = { choice: answer.choice, confidence: answer.confidence };
    }
    return out;
  }
  const questions = {};
  for (const rule of rules) {
    questions[rule.id] = rule.type === 'choice'
      ? { type: 'choice', instructions: rule.question, criteria: Object.fromEntries(rule.options.map((o) => [o.label, o.description || o.label])) }
      : { type: 'noul', instructions: rule.question };
  }
  const res = await post('https://api.typesafe.ai/v1/systemone', { model: cfg.jevModel || DEFAULT_MODELS.jev, state: input, questions }, deadline);
  const out = {};
  for (const [id, answer] of Object.entries(res.answers || {})) {
    if (typeof answer?.noul === 'number') out[id] = { probability: answer.noul };
    else if (typeof answer?.choice === 'string') out[id] = { choice: answer.choice, confidence: answer.confidence };
  }
  return out;
}

async function agentModels() {
  const r = await fetch('/agent-models');
  const body = await r.json();
  return body.ok ? body.models : [];
}

const providerName = (cfg) => (usesOpenAi(cfg) ? 'OpenAI' : 'Jev');
const pct = (n) => `${Math.round(n * 100)}%`;

// First conclusion in rule order. Returns { action, reason?, route?, ruleId?, summary? }.
async function decide(point, data, deadline, cfg) {
  const rules = (cfg.rules || []).filter((rule) => rule.enabled !== false && rule.point === point);
  if (rules.length === 0) return { action: 'allow', why: t('whyNoRules') };
  if (point !== 'will-start-task') {
    const text = `${data.name}\n${data.prompt || ''}`.toLowerCase();
    for (const rule of rules) {
      const keyword = (rule.keywords || []).find((k) => k && text.includes(String(k).toLowerCase()));
      if (keyword) return { action: 'skip', reason: t('keywordReason', { word: keyword }), ruleId: rule.id, summary: t('keywordSummary', { word: keyword }) };
    }
  }
  const asked = rules.filter((rule) => rule.question && (rule.type !== 'choice' || rule.options?.length));
  if (asked.length === 0) return { action: 'allow', why: t('whyNoQuestions') };
  const started = Date.now();
  const answers = await askAll(cfg, asked, describe(point, data), deadline);
  const ms = Date.now() - started;
  const name = providerName(cfg);
  for (const rule of asked) {
    const answer = answers[rule.id];
    if (!answer) continue;
    const threshold = typeof rule.threshold === 'number' ? rule.threshold : (rule.type === 'choice' ? 0.6 : 0.7);
    if (rule.type === 'choice') {
      if (typeof answer.confidence !== 'number' || answer.confidence < threshold) continue;
      const option = rule.options.find((o) => o.label === answer.choice);
      if (!option?.route) continue;
      return {
        action: 'route', route: option.route, ruleId: rule.id, ms,
        reason: `${option.label} ${pct(answer.confidence)}`,
        summary: `${option.label} ${pct(answer.confidence)} → ${option.route.modelName || option.route.model}${option.route.effort ? ` · ${effortName(option.route.effort)}` : ''}`,
      };
    }
    if (typeof answer.probability !== 'number' || answer.probability < threshold) continue;
    if (point === 'will-start-task') {
      // Keep the user's model and raise only its reasoning effort to the highest it supports.
      const current = data.route;
      const models = await agentModels();
      const entry = models.find((m) => m.id === current.model && m.providerId === current.providerId && AGENT_KIND[m.agent] === current.agentKind);
      const top = entry?.efforts?.length ? entry.efforts[entry.efforts.length - 1] : null;
      // Already at the top, or no effort to raise: this rule still has its answer, so the model stays and later rules don't run.
      if (!top || top === current.effort) {
        return { action: 'allow', ruleId: rule.id, ms, why: t('effortKept'), summary: t('effortKeptSummary', { pct: pct(answer.probability) }) };
      }
      return {
        action: 'route', route: { ...current, effort: top }, ruleId: rule.id, ms,
        reason: t('effortReason', { pct: pct(answer.probability) }), summary: t('effortSummary', { pct: pct(answer.probability), effort: effortName(top) }),
      };
    }
    return { action: rule.action === 'block' ? 'block' : 'skip', reason: t('judgedBy', { name, pct: pct(answer.probability) }), ruleId: rule.id, ms, summary: t('yesSkip', { pct: pct(answer.probability) }) };
  }
  return { action: 'allow', ms, why: t('whyUnsure') };
}

// Remember each rule's latest conclusion for the settings page. Read-modify-write keeps rules just saved.
async function recordLast(result) {
  if (!result.ruleId) return;
  try {
    await withConfigLock(async () => {
      const cfg = await readConfig();
      cfg.lastByRule = { ...(cfg.lastByRule || {}), [result.ruleId]: { at: Date.now(), summary: result.summary } };
      await writeConfig(cfg);
    });
  } catch { /* display only */ }
}

const channel = new BroadcastChannel('decision-gate');

cindy.onHostMessage(async (msg) => {
  if (msg.type === 'tool-call') { await loadLocale(); return handleTool(msg); }
  if (msg.type !== 'event' || !POINTS.includes(msg.name) || !msg.hookId) return;
  try {
    await loadLocale();
    const result = await decide(msg.name, msg.data, msg.deadline || Date.now() + 8000, await readConfig());
    const { action, reason, route } = result;
    const { modelName: _label, ...wireRoute } = route || {};
    cindy.send({ type: 'event-verdict', hookId: msg.hookId, action, ...(reason ? { reason } : {}), ...(route ? { route: wireRoute } : {}) });
    void recordLast(result);
  } catch (error) {
    console.warn('decision-gate failed', error && error.message);
  }
});

// ── Tools the Agent can call: list, save and delete rules ──────────────────────
// The same model can exist under several engines and providers: never pick one of them silently.
function findModels(models, option) {
  const q = String(option.model || '').trim().toLowerCase();
  if (!q) return [];
  const scoped = models.filter((m) => (!option.agent || m.agent === option.agent) && (!option.providerId || m.providerId === option.providerId));
  const exact = scoped.filter((m) => m.id.toLowerCase() === q || m.name.toLowerCase() === q);
  const pool = exact.length ? exact : scoped.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  const visible = pool.filter((m) => m.visible !== false);
  return visible.length ? visible : pool;
}

function routeOf(model, effort) {
  const efforts = model.efforts || [];
  const chosen = effort && efforts.includes(effort) ? effort : model.defaultEffort || undefined;
  return { agentKind: AGENT_KIND[model.agent], model: model.id, providerId: model.providerId, modelName: model.name, ...(chosen ? { effort: chosen } : {}) };
}

async function handleTool(msg) {
  const reply = (ok, payload) => cindy.send({ type: 'tool-result', callId: msg.callId, ok, ...(ok ? { result: payload } : payload) });
  try {
    if (msg.tool === 'list_rules') {
      const cfg = await readConfig();
      const models = await agentModels();
      return reply(true, {
        judge: usesOpenAi(cfg) ? 'OpenAI Decisions' : 'TypeSafe Jev',
        rules: cfg.rules,
        availableModels: models.filter((m) => m.visible !== false).map((m) => ({ id: m.id, name: m.name, agent: m.agent, providerId: m.providerId, efforts: m.efforts })),
      });
    }
    if (msg.tool === 'save_rule') {
      const a = msg.args || {};
      if (!POINTS.includes(a.point)) return reply(false, { errorCode: 'INVALID_RULE', message: t('badPoint') });
      if (!a.question) return reply(false, { errorCode: 'INVALID_RULE', message: t('noQuestion') });
      const type = a.point === 'will-start-task' && Array.isArray(a.options) && a.options.length ? 'choice' : 'predicate';
      const rule = { id: a.id || newId(), point: a.point, type, enabled: a.enabled !== false, question: a.question };
      if (type === 'choice') {
        const labels = a.options.map((o) => String(o.label || '').trim());
        if (labels.some((l) => !l) || new Set(labels).size !== labels.length) {
          return reply(false, { errorCode: 'INVALID_RULE', message: t('badOptionLabels') });
        }
        const models = await agentModels();
        rule.options = [];
        for (const option of a.options) {
          const found = findModels(models, option);
          if (!found.length) return reply(false, { errorCode: 'MODEL_NOT_FOUND', message: t('modelNotFound', { model: option.model }) });
          if (found.length > 1) {
            const candidates = found.map((m) => `${m.name} (agent: ${m.agent}, providerId: ${m.providerId})`).join('; ');
            return reply(false, { errorCode: 'MODEL_AMBIGUOUS', message: t('modelAmbiguous', { model: option.model, candidates }) });
          }
          const [model] = found;
          rule.options.push({ label: option.label, ...(option.description ? { description: option.description } : {}), route: routeOf(model, option.effort) });
        }
        rule.threshold = typeof a.threshold === 'number' ? a.threshold : 0.6;
      } else {
        rule.action = a.point === 'will-start-task' ? 'max-effort' : 'skip';
        rule.threshold = typeof a.threshold === 'number' ? a.threshold : 0.7;
        if (a.point !== 'will-start-task' && Array.isArray(a.keywords)) rule.keywords = a.keywords;
      }
      await withConfigLock(async () => {
        const cfg = await readConfig();
        const index = cfg.rules.findIndex((r) => r.id === rule.id);
        if (index >= 0) cfg.rules[index] = rule; else cfg.rules.push(rule);
        await writeConfig(cfg);
        await publishModels();
      });
      return reply(true, {
        saved: rule,
        note: a.point === 'will-start-task'
          ? t('noteStart')
          : t('noteRun'),
      });
    }
    if (msg.tool === 'delete_rule') {
      const deleted = await withConfigLock(async () => {
        const cfg = await readConfig();
        const before = cfg.rules.length;
        cfg.rules = cfg.rules.filter((r) => r.id !== msg.args?.id);
        if (cfg.rules.length === before) return false;
        await writeConfig(cfg);
        await publishModels();
        return true;
      });
      if (!deleted) return reply(false, { errorCode: 'RULE_NOT_FOUND', message: t('ruleNotFound') });
      return reply(true, { deleted: msg.args.id });
    }
    return reply(false, { errorCode: 'UNKNOWN_TOOL', message: t('unknownTool', { tool: msg.tool }) });
  } catch (error) {
    return reply(false, { errorCode: 'RULE_STORE_FAILED', message: t('storeFailed', { error: error && error.message }) });
  }
}

// ── Settings page ↔ brain: try a rule, list Jev models ─────────────────────────
const handled = new Set();
channel.onmessage = async ({ data: req }) => {
  if (!req || req.from !== 'settings' || handled.has(req.reqId)) return;
  handled.add(req.reqId);
  const reply = (payload) => channel.postMessage({ from: 'brain', reqId: req.reqId, ...payload });
  try {
    await loadLocale();
    if (req.kind === 'try') {
      const config = withRules(req.config || {});
      const rule = config.rules.find((r) => r.id === req.ruleId);
      if (!rule) throw new Error(t('saveRuleFirst'));
      const data = rule.point === 'will-start-task'
        ? { text: req.text, attachmentCount: 0, route: req.route || {} }
        : { name: req.text, prompt: '' };
      const result = await decide(rule.point, data, Date.now() + 25000, { ...config, rules: [rule] });
      reply({ ok: true, result });
    } else if (req.kind === 'jev-models') {
      const r = await cindy.fetch({ url: 'https://api.typesafe.ai/v1/models', timeoutMs: 10000 });
      if (!r.ok || r.status !== 200) throw new Error(r.message || `HTTP ${r.status}`);
      reply({ ok: true, models: (JSON.parse(r.body).models || []).map((m) => m.name).filter(Boolean) });
    }
  } catch (error) {
    reply({ ok: false, message: String((error && error.message) || error) });
  }
};

// The picker reads the last published list, so a stale one is only ever one start away from fixed.
publishModels();
