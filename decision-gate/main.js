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
    whyNoMatch: "No condition matched, using the fallback model",
    whyJudgeFailed: "Could not judge, using the fallback model",
    fallbackSummary: "{reason} → {model}",
    noteNoFallback: "Saved. Set a fallback model with set_fallback_model: without one, this plugin’s model does not appear in the new task picker.",
    modelAmbiguous: "“{model}” matches several models: {candidates}. Pass model with agent and providerId from availableModels.",
    serviceAuth: "The API key was rejected. Check or replace it under Judged by.",
    serviceLimit: "The judge service limit or quota was reached. Try again later or check your plan.",
    serviceDown: "The judge service is temporarily unavailable. Please try again later.",
    whyNoRules: "no rules are enabled",
    keywordReason: "Matched keyword “{word}”",
    keywordSummary: "Keyword “{word}” → skip",
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
    effort_minimal: "Minimal",
    effort_low: "Low",
    effort_medium: "Medium",
    effort_high: "High",
    effort_xhigh: "Extra high",
    effort_max: "Max",
    effort_ultra: "Ultra",
  },
  "zh-CN": {
    whyNoMatch: "没有符合的条件，用保底模型",
    whyJudgeFailed: "判断失败，用保底模型",
    fallbackSummary: "{reason} → {model}",
    noteNoFallback: "已保存。还要用 set_fallback_model 设置保底模型，否则新任务的模型选择器里不会出现这个模型。",
    modelAmbiguous: "「{model}」对应多个模型：{candidates}。请按 availableModels 同时传 model、agent 和 providerId。",
    serviceAuth: "API Key 被拒绝。请在「判断用」里检查或更换。",
    serviceLimit: "判断服务达到限额或额度不足。请稍后再试，或检查套餐。",
    serviceDown: "判断服务暂时不可用，请稍后再试。",
    whyNoRules: "没有启用的规则",
    keywordReason: "命中关键词「{word}」",
    keywordSummary: "关键词「{word}」→ 跳过",
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
    effort_minimal: "最低",
    effort_low: "低",
    effort_medium: "中",
    effort_high: "高",
    effort_xhigh: "超高",
    effort_max: "最高",
    effort_ultra: "极致",
  },
  "ja": {
    whyNoMatch: "一致する条件がないため、保険のモデルを使います",
    whyJudgeFailed: "判断できなかったため、保険のモデルを使います",
    fallbackSummary: "{reason} → {model}",
    noteNoFallback: "保存しました。set_fallback_model で保険のモデルを設定してください。未設定だと新しいタスクのモデル選択に表示されません。",
    modelAmbiguous: "「{model}」は複数のモデルに一致します: {candidates}。availableModels の model、agent、providerId を指定してください。",
    serviceAuth: "API キーが拒否されました。判断モデルの設定で確認または変更してください。",
    serviceLimit: "判断サービスの上限またはクォータに達しました。後でもう一度試すか、プランを確認してください。",
    serviceDown: "判断サービスは一時的に利用できません。後でもう一度お試しください。",
    whyNoRules: "有効なルールがありません",
    keywordReason: "キーワード「{word}」に一致",
    keywordSummary: "キーワード「{word}」→ スキップ",
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
    effort_minimal: "最小",
    effort_low: "低",
    effort_medium: "中",
    effort_high: "高",
    effort_xhigh: "超高",
    effort_max: "最大",
    effort_ultra: "ウルトラ",
  },
  "ko": {
    whyNoMatch: "일치하는 조건이 없어 기본 모델을 사용합니다",
    whyJudgeFailed: "판단하지 못해 기본 모델을 사용합니다",
    fallbackSummary: "{reason} → {model}",
    noteNoFallback: "저장했습니다. set_fallback_model로 기본 모델을 설정하세요. 없으면 새 작업의 모델 선택기에 나타나지 않습니다.",
    modelAmbiguous: "“{model}”에 해당하는 모델이 여러 개입니다: {candidates}. availableModels의 model, agent, providerId를 함께 전달하세요.",
    serviceAuth: "API 키가 거부되었습니다. 판단 모델 설정에서 확인하거나 교체하세요.",
    serviceLimit: "판단 서비스 한도 또는 할당량에 도달했습니다. 나중에 다시 시도하거나 요금제를 확인하세요.",
    serviceDown: "판단 서비스를 일시적으로 사용할 수 없습니다. 나중에 다시 시도하세요.",
    whyNoRules: "사용 중인 규칙이 없습니다",
    keywordReason: "키워드 “{word}” 일치",
    keywordSummary: "키워드 “{word}” → 건너뛰기",
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

// The model this plugin adds to the new task picker. Published once it has a key and a fallback model to land on.
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
      const ready = keySaved && !!config.fallback;
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

// Ask all conditions for a moment in one request. Returns { [ruleId]: probability }.
async function askAll(cfg, rules, input, deadline) {
  if (usesOpenAi(cfg)) {
    const res = await post('https://api.openai.com/v1/decisions', {
      model: cfg.openaiModel || DEFAULT_MODELS.openai,
      input,
      questions: rules.map((rule) => ({ type: 'predicate', name: rule.id, instructions: rule.question })),
    }, deadline);
    return Object.fromEntries((res.answers || []).filter((a) => a.type === 'predicate').map((a) => [a.name, a.probability]));
  }
  const questions = Object.fromEntries(rules.map((rule) => [rule.id, { type: 'noul', instructions: rule.question }]));
  const res = await post('https://api.typesafe.ai/v1/systemone', { model: cfg.jevModel || DEFAULT_MODELS.jev, state: input, questions }, deadline);
  return Object.fromEntries(Object.entries(res.answers || {}).filter(([, a]) => typeof a?.noul === 'number').map(([id, a]) => [id, a.noul]));
}

async function agentModels() {
  const r = await fetch('/agent-models');
  const body = await r.json();
  return body.ok ? body.models : [];
}

const providerName = (cfg) => (usesOpenAi(cfg) ? 'OpenAI' : 'Jev');
const pct = (n) => `${Math.round(n * 100)}%`;

// First conclusion in rule order. Returns { action, reason?, route?, ruleId?, summary? }.
const routeName = (route) => `${route.modelName || route.model}${route.effort ? ` · ${effortName(route.effort)}` : ''}`;

// Rules read as "if <condition>, use <model>": top to bottom, the first that holds wins, otherwise the fallback.
async function decide(point, data, deadline, cfg) {
  const start = point === 'will-start-task';
  const threshold = typeof cfg.threshold === 'number' ? cfg.threshold : 0.6;
  const rules = (cfg.rules || []).filter((rule) => rule.enabled !== false && rule.point === point);
  const fallback = (reason) => (start && cfg.fallback
    ? { action: 'route', route: cfg.fallback, reason, summary: t('fallbackSummary', { reason, model: routeName(cfg.fallback) }) }
    : { action: 'allow', why: reason });
  if (!start) {
    const text = `${data.name}\n${data.prompt || ''}`.toLowerCase();
    for (const rule of rules) {
      const keyword = (rule.keywords || []).find((k) => k && text.includes(String(k).toLowerCase()));
      if (keyword) return { action: 'skip', reason: t('keywordReason', { word: keyword }), ruleId: rule.id, summary: t('keywordSummary', { word: keyword }) };
    }
  }
  const asked = rules.filter((rule) => rule.question && (!start || rule.route));
  if (asked.length === 0) return fallback(t('whyNoRules'));
  const started = Date.now();
  let answers;
  try {
    answers = await askAll(cfg, asked, describe(point, data), deadline);
  } catch (error) {
    // A judge outage must still land on the model the user chose for this. Without one, the host's failure setting applies.
    if (!start || !cfg.fallback) throw error;
    console.warn('decision-gate judge failed', error && error.message);
    return fallback(t('whyJudgeFailed'));
  }
  const ms = Date.now() - started;
  const name = providerName(cfg);
  for (const rule of asked) {
    const probability = answers[rule.id];
    if (typeof probability !== 'number' || probability < threshold) continue;
    const label = `${rule.question.slice(0, 120)} ${pct(probability)}`;
    if (start) return { action: 'route', route: rule.route, reason: label, ruleId: rule.id, ms, summary: `${label} → ${routeName(rule.route)}` };
    return { action: 'skip', reason: t('judgedBy', { name, pct: pct(probability) }), ruleId: rule.id, ms, summary: t('yesSkip', { pct: pct(probability) }) };
  }
  return { ...fallback(t('whyNoMatch')), ms };
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
    const { modelName: _label, fastMode: _fast, ...wireRoute } = route || {};
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

async function resolveRoute(a) {
  const found = findModels(await agentModels(), a);
  if (!found.length) return { error: { errorCode: 'MODEL_NOT_FOUND', message: t('modelNotFound', { model: a.model }) } };
  if (found.length > 1) {
    const candidates = found.map((m) => `${m.name} (agent: ${m.agent}, providerId: ${m.providerId})`).join('; ');
    return { error: { errorCode: 'MODEL_AMBIGUOUS', message: t('modelAmbiguous', { model: a.model, candidates }) } };
  }
  return { route: routeOf(found[0], a.effort) };
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
        fallback: cfg.fallback || null,
        threshold: typeof cfg.threshold === 'number' ? cfg.threshold : 0.6,
        availableModels: models.filter((m) => m.visible !== false).map((m) => ({ id: m.id, name: m.name, agent: m.agent, providerId: m.providerId, efforts: m.efforts })),
      });
    }
    if (msg.tool === 'save_rule') {
      const a = msg.args || {};
      if (!POINTS.includes(a.point)) return reply(false, { errorCode: 'INVALID_RULE', message: t('badPoint') });
      if (!a.question && !a.keywords?.length) return reply(false, { errorCode: 'INVALID_RULE', message: t('noQuestion') });
      const rule = { id: a.id || newId(), point: a.point, enabled: a.enabled !== false, question: a.question || '' };
      if (a.point === 'will-start-task') {
        const resolved = await resolveRoute(a);
        if (resolved.error) return reply(false, resolved.error);
        rule.route = resolved.route;
      } else if (Array.isArray(a.keywords)) rule.keywords = a.keywords;
      const hasFallback = await withConfigLock(async () => {
        const cfg = await readConfig();
        const index = cfg.rules.findIndex((r) => r.id === rule.id);
        if (index >= 0) cfg.rules.splice(index, 1);
        const target = Number.isInteger(a.position) ? a.position : index >= 0 ? index : cfg.rules.length;
        cfg.rules.splice(target, 0, rule);
        await writeConfig(cfg);
        await publishModels();
        return !!cfg.fallback;
      });
      return reply(true, { saved: rule, note: a.point !== 'will-start-task' ? t('noteRun') : hasFallback ? t('noteStart') : t('noteNoFallback') });
    }
    if (msg.tool === 'set_fallback_model') {
      const a = msg.args || {};
      const resolved = await resolveRoute(a);
      if (resolved.error) return reply(false, resolved.error);
      await withConfigLock(async () => {
        const cfg = await readConfig();
        cfg.fallback = resolved.route;
        if (typeof a.threshold === 'number') cfg.threshold = a.threshold;
        await writeConfig(cfg);
        await publishModels();
      });
      return reply(true, { fallback: resolved.route, note: t('noteStart') });
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
      const data = req.point === 'will-start-task' ? { text: req.text, attachmentCount: 0 } : { name: req.text, prompt: '' };
      const result = await decide(req.point, data, Date.now() + 25000, config);
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
