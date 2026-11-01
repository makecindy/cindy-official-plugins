// Decision Gate settings: the judge plus a table of rules (when → what to judge → what to do).
// Copy follows the host language only (GET /app-context); anything else falls back to English.
const MESSAGES = {
  "en": {
    save: "Save",
    pointRunHint: "If a condition holds, this run is skipped.",
    ifWord: "If",
    useWord: "use",
    otherwise: "Anything else, or if judging fails",
    chooseModel: "Choose a model",
    addCondition: "Add condition",
    phCondition: "e.g. writing code or fixing a bug",
    phRunCondition: "e.g. the prompt says not to run this time",
    conditionLabel: "Condition {n}",
    modelFor: "Model for condition {n}",
    fallbackLabel: "Fallback model",
    moveUp: "Move condition {n} up",
    deleteRule: "Delete condition {n}",
    fallbackNeeded: "Choose a fallback model, then “Pick by rules” appears in the new task model picker.",
    pickerFailed: "Could not open the model picker: {error}",
    pickerUnsupported: "this version of Cindy needs an update",
    modelGone: "Not available",
    belowA: "Count a condition as met when the judge is at least",
    belowB: "sure.",
    storeLoadFailed: "Could not load rules: {error}.",
    storeSaveFailed: "Could not save: {error}. Your change was not applied.",
    storeRetry: "Try again",
    pointStart: "When a new task starts",
    pointStartHint: "Checks the first message once and keeps that model afterward. Not used in teammate chats.",
    pointSchedule: "Before an automation runs",
    pointRoutine: "Before a routine runs",
    effort_minimal: "Minimal",
    effort_low: "Low",
    effort_medium: "Medium",
    effort_high: "High",
    effort_xhigh: "Extra high",
    effort_max: "Max",
    effort_ultra: "Ultra",
    noModel: "No model selected",
    noReply: "The plugin did not respond",
    keySaved: "Key saved",
    keyMissing: "Key not set",
    done: "Done",
    change: "Change",
    use: "Use",
    judgeModelLabel: "Model used for judging",
    keyReplace: "Enter a new key to replace it",
    keyPaste: "Paste {label}",
    keyStored: "Saved. Cindy encrypts it and the plugin cannot read it back.",
    notSet: "Not set",
    modelVersion: "Model version",
    modelVersionJev: "Models available to your TypeSafe account",
    modelVersionOpenai: "The Decisions API currently supports only gpt-6-luna. Change this when a new version is available.",
    jevVersionLabel: "Jev model version",
    openaiVersionLabel: "OpenAI model version",
    judgeTitle: "Judged by",
    judgeDesc: "It only answers whether each condition holds. It never touches your files.",
    skipRun: "Skip this run",
    justNow: "just now",
    minsAgo: "{n} min ago",
    hoursAgo: "{n} hr ago",
    daysAgo: "{n} days ago",
    lastRun: "Last: {summary} · {when}",
    removeItem: "Remove {text}",
    pressEnter: "Type and press Enter",
    tryIt: "Try it",
    thresholdLabel: "Confidence threshold",
    chooseModel: "Select a model",
    belowA: "Below",
    belowB: "counts as unsure. You can only choose connected models.",
    keywordHint: "Skip without asking the model when the name or prompt contains:",
    addKeyword: "Add keyword",
    tryLabel: "Text to try",
    phTryStart: "Try a message, e.g. Fix the bug on the login page",
    phTryRun: "Try a task name, e.g. Weekly report (paused)",
    judging: "Judging…",
    seconds: " · {n} s",
    noConclusion: "No conclusion",
    noChange: "{why}, no change{sec}",
    enableRule: "Enable this rule",
    tipA: "The AI can write rules for you. In any task, say",
    tipQuote: "Use Claude Opus for coding and a cheaper model for chat",
    tipB: "and it adds the rule here for you to edit.",
  },
  "zh-CN": {
    save: "保存",
    pointRunHint: "条件符合就跳过这次运行。",
    ifWord: "如果",
    useWord: "用",
    otherwise: "其他情况，或判断失败",
    chooseModel: "选择模型",
    addCondition: "添加条件",
    phCondition: "例如：在写代码或改 bug",
    phRunCondition: "例如：指令写明这次不用运行",
    conditionLabel: "条件 {n}",
    modelFor: "条件 {n} 用的模型",
    fallbackLabel: "保底模型",
    moveUp: "上移条件 {n}",
    deleteRule: "删除条件 {n}",
    fallbackNeeded: "选好保底模型后，新任务的模型选择器里才会出现「按规则选模型」。",
    pickerFailed: "打不开模型选择器：{error}",
    pickerUnsupported: "当前 Cindy 版本需要更新",
    modelGone: "已不可用",
    belowA: "判断把握达到",
    belowB: "算条件符合。",
    storeLoadFailed: "读取规则失败：{error}。",
    storeSaveFailed: "保存失败：{error}。这次改动没有生效。",
    storeRetry: "重试",
    pointStart: "开新任务时",
    pointStartHint: "只在新任务的第一条消息判断一次，之后不再换模型；伙伴对话不使用",
    pointSchedule: "自动化运行前",
    pointRoutine: "例行任务运行前",
    effort_minimal: "最低",
    effort_low: "低",
    effort_medium: "中",
    effort_high: "高",
    effort_xhigh: "超高",
    effort_max: "最高",
    effort_ultra: "极致",
    noModel: "未选模型",
    noReply: "插件没有回应",
    keySaved: "Key 已保存",
    keyMissing: "Key 未填写",
    done: "完成",
    change: "更改",
    use: "使用",
    judgeModelLabel: "判断用的模型",
    keyReplace: "输入新 Key 以更换",
    keyPaste: "粘贴 {label}",
    keyStored: "已保存，Cindy 加密保管，插件读不回",
    notSet: "未填写",
    modelVersion: "模型版本",
    modelVersionJev: "来自 TypeSafe 账号可用的模型",
    modelVersionOpenai: "Decisions API 目前只支持 gpt-6-luna，有新版本时可直接改",
    jevVersionLabel: "Jev 模型版本",
    openaiVersionLabel: "OpenAI 模型版本",
    judgeTitle: "判断用",
    judgeDesc: "它只回答每个条件是否符合，不会动你的文件。",
    skipRun: "跳过本次",
    justNow: "刚刚",
    minsAgo: "{n} 分钟前",
    hoursAgo: "{n} 小时前",
    daysAgo: "{n} 天前",
    lastRun: "上次：{summary} · {when}",
    removeItem: "删除 {text}",
    pressEnter: "输入后回车",
    tryIt: "试一下",
    thresholdLabel: "把握阈值",
    chooseModel: "选择模型",
    belowA: "把握低于",
    belowB: "算拿不准。只能选你已连接的模型。",
    keywordHint: "名称或指令里含这些词，不问模型直接跳过：",
    addKeyword: "添加关键词",
    tryLabel: "试一下的内容",
    phTryStart: "写一条消息试试，例如：帮我修一下登录页的 bug",
    phTryRun: "写一个任务名试试，例如：周报汇总（暂停中）",
    judging: "正在判断…",
    seconds: " · {n} 秒",
    noConclusion: "没有结论",
    noChange: "{why}，不改{sec}",
    enableRule: "启用这条规则",
    tipA: "也可以让 AI 帮你写规则。在任何任务里说一句",
    tipQuote: "写代码用 Claude Opus，闲聊用便宜点的模型",
    tipB: "，AI 会把规则加到这里，你可以再改。",
  },
  "ja": {
    save: "保存",
    pointRunHint: "条件に一致すると、この実行をスキップします。",
    ifWord: "もし",
    useWord: "使う",
    otherwise: "その他、または判断に失敗したとき",
    chooseModel: "モデルを選ぶ",
    addCondition: "条件を追加",
    phCondition: "例：コードを書いている、バグを直している",
    phRunCondition: "例：今回は実行不要と指示に書かれている",
    conditionLabel: "条件 {n}",
    modelFor: "条件 {n} のモデル",
    fallbackLabel: "保険のモデル",
    moveUp: "条件 {n} を上へ",
    deleteRule: "条件 {n} を削除",
    fallbackNeeded: "保険のモデルを選ぶと、新しいタスクのモデル選択に「ルールで選ぶ」が表示されます。",
    pickerFailed: "モデル選択を開けませんでした: {error}",
    pickerUnsupported: "この Cindy は更新が必要です",
    modelGone: "利用不可",
    belowA: "判断の確信度が",
    belowB: "以上で一致とします。",
    storeLoadFailed: "ルールを読み込めませんでした: {error}。",
    storeSaveFailed: "保存できませんでした: {error}。変更は適用されていません。",
    storeRetry: "再試行",
    pointStart: "新しいタスクの開始時",
    pointStartHint: "新しいタスクの最初のメッセージで一度だけ判断し、その後はモデルを変えません。チームメイトとの会話では使いません。",
    pointSchedule: "自動化の実行前",
    pointRoutine: "ルーティンの実行前",
    effort_minimal: "最小",
    effort_low: "低",
    effort_medium: "中",
    effort_high: "高",
    effort_xhigh: "超高",
    effort_max: "最大",
    effort_ultra: "ウルトラ",
    noModel: "モデル未選択",
    noReply: "プラグインから応答がありません",
    keySaved: "キー保存済み",
    keyMissing: "キー未設定",
    done: "完了",
    change: "変更",
    use: "使用",
    judgeModelLabel: "判断に使うモデル",
    keyReplace: "新しいキーを入力して置き換え",
    keyPaste: "{label} を貼り付け",
    keyStored: "保存済み。Cindy が暗号化して保管し、プラグインは読み戻せません。",
    notSet: "未設定",
    modelVersion: "モデルのバージョン",
    modelVersionJev: "TypeSafe アカウントで使えるモデル",
    modelVersionOpenai: "Decisions API は現在 gpt-6-luna のみ対応です。新しいバージョンが出たら変更できます。",
    jevVersionLabel: "Jev モデルのバージョン",
    openaiVersionLabel: "OpenAI モデルのバージョン",
    judgeTitle: "判断に使うモデル",
    judgeDesc: "各条件に一致するかどうかだけを答えます。ファイルには触れません。",
    skipRun: "今回はスキップ",
    justNow: "たった今",
    minsAgo: "{n} 分前",
    hoursAgo: "{n} 時間前",
    daysAgo: "{n} 日前",
    lastRun: "前回: {summary} · {when}",
    removeItem: "{text} を削除",
    pressEnter: "入力して Enter",
    tryIt: "試す",
    thresholdLabel: "確信度のしきい値",
    chooseModel: "モデルを選択",
    belowA: "確信度が",
    belowB: "未満なら判断できない扱いです。接続済みのモデルだけ選べます。",
    keywordHint: "名前または指示に次の語があれば、モデルに聞かずスキップ:",
    addKeyword: "キーワードを追加",
    tryLabel: "試す内容",
    phTryStart: "メッセージを試す。例: ログインページのバグを直して",
    phTryRun: "タスク名を試す。例: 週報まとめ(一時停止中)",
    judging: "判断中…",
    seconds: " · {n} 秒",
    noConclusion: "結論なし",
    noChange: "{why}、変更なし{sec}",
    enableRule: "このルールを有効にする",
    tipA: "AI にルールを書いてもらえます。任意のタスクで次のように伝えてください:",
    tipQuote: "コードは Claude Opus、雑談は安いモデルで",
    tipB: "AI がここにルールを追加し、あとから編集できます。",
  },
  "ko": {
    save: "저장",
    pointRunHint: "조건에 맞으면 이번 실행을 건너뜁니다.",
    ifWord: "만약",
    useWord: "사용",
    otherwise: "그 외, 또는 판단 실패 시",
    chooseModel: "모델 선택",
    addCondition: "조건 추가",
    phCondition: "예: 코드를 쓰거나 버그를 고칠 때",
    phRunCondition: "예: 이번에는 실행하지 말라고 적혀 있을 때",
    conditionLabel: "조건 {n}",
    modelFor: "조건 {n}의 모델",
    fallbackLabel: "기본 모델",
    moveUp: "조건 {n} 위로",
    deleteRule: "조건 {n} 삭제",
    fallbackNeeded: "기본 모델을 고르면 새 작업의 모델 선택기에 “규칙으로 선택”이 나타납니다.",
    pickerFailed: "모델 선택기를 열지 못했습니다: {error}",
    pickerUnsupported: "이 Cindy 버전은 업데이트가 필요합니다",
    modelGone: "사용 불가",
    belowA: "판단 확신도가",
    belowB: "이상이면 조건에 맞는 것으로 봅니다.",
    storeLoadFailed: "규칙을 불러오지 못했습니다: {error}.",
    storeSaveFailed: "저장하지 못했습니다: {error}. 변경 사항이 적용되지 않았습니다.",
    storeRetry: "다시 시도",
    pointStart: "새 작업을 시작할 때",
    pointStartHint: "새 작업의 첫 메시지에서 한 번만 판단하고 이후에는 모델을 바꾸지 않습니다. 팀원 대화에서는 쓰지 않습니다.",
    pointSchedule: "자동화 실행 전",
    pointRoutine: "루틴 실행 전",
    effort_minimal: "최소",
    effort_low: "낮음",
    effort_medium: "중간",
    effort_high: "높음",
    effort_xhigh: "매우 높음",
    effort_max: "최대",
    effort_ultra: "울트라",
    noModel: "모델 미선택",
    noReply: "플러그인이 응답하지 않습니다",
    keySaved: "키 저장됨",
    keyMissing: "키 미설정",
    done: "완료",
    change: "변경",
    use: "사용",
    judgeModelLabel: "판단에 쓰는 모델",
    keyReplace: "새 키를 입력해 교체",
    keyPaste: "{label} 붙여넣기",
    keyStored: "저장됨. Cindy가 암호화해 보관하며 플러그인은 다시 읽을 수 없습니다.",
    notSet: "미설정",
    modelVersion: "모델 버전",
    modelVersionJev: "TypeSafe 계정에서 쓸 수 있는 모델",
    modelVersionOpenai: "Decisions API는 현재 gpt-6-luna만 지원합니다. 새 버전이 나오면 바꿀 수 있습니다.",
    jevVersionLabel: "Jev 모델 버전",
    openaiVersionLabel: "OpenAI 모델 버전",
    judgeTitle: "판단 모델",
    judgeDesc: "각 조건에 맞는지만 답합니다. 파일은 건드리지 않습니다.",
    skipRun: "이번 실행 건너뛰기",
    justNow: "방금",
    minsAgo: "{n}분 전",
    hoursAgo: "{n}시간 전",
    daysAgo: "{n}일 전",
    lastRun: "지난번: {summary} · {when}",
    removeItem: "{text} 삭제",
    pressEnter: "입력 후 Enter",
    tryIt: "시험해 보기",
    thresholdLabel: "확신도 기준",
    chooseModel: "모델 선택",
    belowA: "확신도가",
    belowB: "미만이면 확실하지 않은 것으로 봅니다. 연결된 모델만 고를 수 있습니다.",
    keywordHint: "이름이나 지시에 다음 단어가 있으면 모델에 묻지 않고 건너뜁니다:",
    addKeyword: "키워드 추가",
    tryLabel: "시험할 내용",
    phTryStart: "메시지를 시험해 보세요. 예: 로그인 페이지 버그 고쳐 줘",
    phTryRun: "작업 이름을 시험해 보세요. 예: 주간 보고(일시 중지)",
    judging: "판단 중…",
    seconds: " · {n}초",
    noConclusion: "결론 없음",
    noChange: "{why}, 변경 없음{sec}",
    enableRule: "이 규칙 사용",
    tipA: "AI에게 규칙 작성을 맡길 수 있습니다. 아무 작업에서나 이렇게 말해 보세요:",
    tipQuote: "코딩은 Claude Opus, 잡담은 저렴한 모델로",
    tipB: "AI가 여기에 규칙을 추가하며 나중에 고칠 수 있습니다.",
  },
};
let locale = 'en';
const t = (key, vars = {}) => (MESSAGES[locale]?.[key] ?? MESSAGES.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
async function loadLocale() {
  const body = await fetch('/app-context').then((r) => r.json()).catch(() => null);
  const next = body?.context?.locale;
  locale = MESSAGES[next] ? next : 'en';
  document.documentElement.lang = locale;
}
const POINTS = [
  { id: 'will-start-task', label: () => t('pointStart'), hint: () => t('pointStartHint') },
  { id: 'will-schedule-run', label: () => t('pointSchedule'), hint: () => t('pointRunHint') },
  { id: 'will-routine-run', label: () => t('pointRoutine'), hint: () => t('pointRunHint') },
];
const PROVIDERS = {
  openai: { name: 'OpenAI Decisions', key: 'openai_api_key', keyLabel: 'OpenAI API Key', model: 'gpt-6-luna' },
  jev: { name: 'TypeSafe Jev', key: 'typesafe_api_key', keyLabel: 'TypeSafe API Key', model: 'jev-latest' },
};
const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9];
const effortName = (effort) => (MESSAGES.en[`effort_${effort}`] ? t(`effort_${effort}`) : effort);
const AGENT_KIND = { 'claude-code': 'cc', codex: 'codex', pi: 'pi' };
const AGENT_LABEL = { 'claude-code': 'Claude Code', codex: 'Codex', pi: 'Pi' };
const root = document.getElementById('root');
const channel = new BroadcastChannel('decision-gate');
let cfg = { rules: [] };
let secrets = {};
let models = [];
let jevModels = null;
let editingJudge = false;
let loaded = false; // the stored config was read successfully
let stored = '{}'; // last config known to be in the store
let storeError = '';
const tryRuns = {};
const unsavedKeys = {}; // input kept after a failed save, per secret so it never fills another service's field
let pickerError = '';
const tryTexts = {};
const tryStates = {}; // by point: { busy } | { result } | { error }

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
};
const svg = (d, size = 14) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true'); s.classList.add('ic');
  for (const part of d.split('|')) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', part); s.append(p); }
  return s;
};
const ICON = {
  chevron: 'm6 9 6 6 6-6', up: 'm5 12 7-7 7 7|M12 19V5', plus: 'M5 12h14|M12 5v14', x: 'M18 6 6 18|m6 6 12 12', arrow: 'M5 12h14|m12 5 7 7-7 7',
  check: 'M20 6 9 17l-5-5', play: 'M6 3v18l15-9z', trash: 'M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  wand: 'm21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72|m14 7 3 3|M5 6v4|M19 14v4|M10 2v2|M7 8H3|M21 16h-4|M11 3H9',
};
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const newId = () => randomId();
const pct = (n) => `${Math.round(n * 100)}%`;
const provider = () => PROVIDERS[cfg.provider === 'jev' ? 'jev' : 'openai'];
const providerId = () => (cfg.provider === 'jev' ? 'jev' : 'openai');
const modelOf = (id) => (id === 'openai' ? cfg.openaiModel : cfg.jevModel) || PROVIDERS[id].model;

const withRules = (raw) => ({ ...raw, rules: Array.isArray(raw.rules) ? raw.rules : [] });

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
// The brain and this page rewrite the whole config: one lock keeps either from writing back a stale copy.
const withConfigLock = (fn) => (navigator.locks ? navigator.locks.request('decision-gate-config', fn) : fn());
async function readStore() {
  const res = await fetch('/kv');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
// Apply only what this page changed since `base` onto the latest store, so a rule the Agent just saved survives.
function mergeChanges(base, mine, latest) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const merged = { ...latest };
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine)])) {
    if (key !== 'rules' && key !== 'lastByRule' && !same(base[key], mine[key])) merged[key] = mine[key];
  }
  const rulesById = (rules) => new Map((rules || []).map((r) => [r.id, r]));
  const baseRules = rulesById(base.rules);
  const mineRules = rulesById(mine.rules);
  const rules = (latest.rules || []).filter((r) => !baseRules.has(r.id) || mineRules.has(r.id));
  for (const rule of mine.rules || []) {
    const before = baseRules.get(rule.id);
    if (same(before, rule)) continue;
    const index = rules.findIndex((r) => r.id === rule.id);
    if (index < 0) { rules.push(rule); continue; }
    // Same rule changed elsewhere too: apply only the fields this page changed.
    const next = { ...rules[index] };
    for (const key of new Set([...Object.keys(before || {}), ...Object.keys(rule)])) {
      if (same(before?.[key], rule[key])) continue;
      if (rule[key] === undefined) delete next[key]; else next[key] = rule[key];
    }
    rules[index] = before ? next : rule;
  }
  // Moving a rule changes only the order: follow this page's order, with anything added meanwhile at the end.
  const baseIds = (base.rules || []).map((r) => r.id);
  const mineIds = (mine.rules || []).map((r) => r.id);
  const kept = baseIds.filter((id) => mineIds.includes(id));
  const added = mineIds.filter((id) => !baseIds.includes(id));
  const moved = !same(mineIds, [...kept, ...added]);
  const order = new Map((mine.rules || []).map((r, i) => [r.id, i]));
  merged.rules = moved ? rules.sort((x, y) => (order.get(x.id) ?? Infinity) - (order.get(y.id) ?? Infinity)) : rules;
  return merged;
}
let saves = 0;
// Returns whether the change landed. On failure the page drops that change and keeps later edits.
async function save() {
  // All of it inside the lock, so a queued save starts from what this one wrote and from the latest edits.
  const landed = await withConfigLock(async () => {
    const mine = JSON.parse(JSON.stringify(cfg));
    try {
      const next = mergeChanges(JSON.parse(stored), mine, withRules(await readStore()));
      const res = await fetch('/kv', { method: 'PUT', body: JSON.stringify(next) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Keep what was typed while the write was in flight.
      cfg = mergeChanges(mine, cfg, next);
      stored = JSON.stringify(next);
      saves += 1;
      storeError = '';
      return true;
    } catch (error) {
      // Undo only what this save sent; edits made since belong to the saves queued behind it.
      cfg = mergeChanges(mine, cfg, JSON.parse(stored));
      storeError = t('storeSaveFailed', { error: error && error.message });
      return false;
    }
  });
  if (!landed) return false;
  channel.postMessage({ from: 'settings', type: 'config-changed' });
  await publishModels();
  return true;
}

function ask(kind, payload, timeoutMs = 30000) {
  const reqId = randomId();
  fetch('/wake').catch(() => {});
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { clearInterval(resend); channel.removeEventListener('message', on); reject(new Error(t('noReply'))); }, timeoutMs);
    const send = () => channel.postMessage({ from: 'settings', reqId, kind, ...payload });
    const resend = setInterval(send, 600);
    const on = ({ data }) => {
      if (data?.from !== 'brain' || data.reqId !== reqId) return;
      clearTimeout(timer); clearInterval(resend); channel.removeEventListener('message', on);
      data.ok ? resolve(data) : reject(new Error(data.message));
    };
    channel.addEventListener('message', on);
    send();
  });
}

// ── Widgets ───────────────────────────────────────────────────────────────
function seg(options, value, onChange, label) {
  return h('div', { class: 'seg', role: 'group', ...(label ? { 'aria-label': label } : {}) },
    ...options.map(([key, text]) => h('button', { type: 'button', 'aria-pressed': String(key === value), onclick: () => onChange(key) }, text)));
}
function select(options, value, onChange, label, cls = '') {
  return h('span', { class: `sel ${cls}` },
    h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
      ...options.map(([v, text]) => h('option', { value: v, selected: v === value }, text))),
    svg(ICON.chevron, 14));
}
const toggle = (on, label, onChange) => h('button', { class: 'sw', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: onChange });

// ── Judge ─────────────────────────────────────────────────────────────────
function judgeSection() {
  const p = provider();
  const saved = secrets[p.key];
  const group = h('div', { class: 'group' },
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('p', { class: 't14' }, p.name), h('p', { class: 'meta', style: 'margin-top:2px' }, `${modelOf(providerId())} · ${saved ? t('keySaved') : t('keyMissing')}`)),
      h('button', { class: 'btn', type: 'button', 'aria-expanded': String(editingJudge), onclick: () => { editingJudge = !editingJudge; render(); } }, editingJudge ? t('done') : t('change'))));
  if (editingJudge) {
    const id = providerId();
    group.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('p', {}, t('use'))),
      seg(Object.entries(PROVIDERS).map(([key, v]) => [key, v.name]), id, async (key) => { cfg.provider = key; await save(); render(); if (key === 'jev') loadJevModels(); }, t('judgeModelLabel'))));
    const keyInput = h('input', { class: 'pill', type: 'password', autocomplete: 'off', value: unsavedKeys[p.key] || '', placeholder: saved ? t('keyReplace') : t('keyPaste', { label: p.keyLabel }), 'aria-label': p.keyLabel });
    group.append(h('form', {
      class: 'row', onsubmit: async (e) => {
        e.preventDefault();
        const value = keyInput.value.trim();
        if (!value) return;
        try {
          const res = await fetch(`/secrets/${p.key}`, { method: 'PUT', body: JSON.stringify({ value }) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          delete unsavedKeys[p.key];
          storeError = '';
        } catch (error) {
          // Keep what was typed so it can be retried.
          unsavedKeys[p.key] = value;
          storeError = t('storeSaveFailed', { error: error && error.message });
        }
        await loadSecrets();
        await publishModels();
        render();
      },
    }, h('div', { class: 'grow' }, h('p', {}, p.keyLabel), h('p', { class: 'meta', style: 'margin-top:2px' }, saved ? t('keyStored') : t('notSet')),
      h('div', { class: 'line', style: 'margin-top:8px' }, keyInput, h('button', { class: 'btn', type: 'submit' }, t('save'))))));
    const modelRow = h('div', { class: 'row' }, h('div', { class: 'grow' }, h('p', {}, t('modelVersion')),
      h('p', { class: 'meta', style: 'margin-top:2px' }, id === 'jev' ? t('modelVersionJev') : t('modelVersionOpenai'))));
    if (id === 'jev') {
      const options = jevModels?.length ? jevModels : [modelOf('jev')];
      modelRow.append(select(options.map((m) => [m, m]), modelOf('jev'), async (v) => { cfg.jevModel = v; await save(); }, t('jevVersionLabel')));
    } else {
      modelRow.append(h('input', { class: 'pill narrow', value: modelOf('openai'), 'aria-label': t('openaiVersionLabel'), onchange: async (e) => { cfg.openaiModel = e.target.value.trim(); await save(); } }));
    }
    group.append(modelRow);
  }
  return h('section', { class: 'sec' }, h('p', { class: 'st' }, t('judgeTitle')),
    h('p', { class: 'sd' }, t('judgeDesc')), group);
}

// ── Rules ─────────────────────────────────────────────────────────────────
function lastLine(rule) {
  const last = cfg.lastByRule[rule.id];
  const mins = Math.max(0, Math.round((Date.now() - last.at) / 60000));
  const when = mins < 1 ? t('justNow') : mins < 60 ? t('minsAgo', { n: mins }) : mins < 1440 ? t('hoursAgo', { n: Math.round(mins / 60) }) : t('daysAgo', { n: Math.round(mins / 1440) });
  return t('lastRun', { summary: last.summary, when });
}

function findModelEntry(route) {
  return route && models.find((m) => m.id === route.model && m.providerId === route.providerId && AGENT_KIND[m.agent] === route.agentKind);
}

// Choosing a model is the host's picker, the same one Cindy uses everywhere; this page only keeps the result.
async function pickRoute(current) {
  pickerError = '';
  const initial = current ? { agentKind: current.agentKind, providerId: current.providerId, model: current.model, effort: current.effort || '', fastMode: false } : undefined;
  let selected;
  try {
    const res = await fetch('/model-picker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(initial ? { initial } : {}) });
    if (res.status === 404) throw new Error(t('pickerUnsupported'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    selected = await res.json();
  } catch (error) {
    pickerError = t('pickerFailed', { error: error.message });
    render();
    return null;
  }
  if (!selected.ok) {
    if (selected.errorCode !== 'CANCELLED') { pickerError = t('pickerFailed', { error: selected.message || selected.errorCode }); render(); }
    return null;
  }
  await loadModels();
  const { agentKind, providerId, model, effort } = selected.route;
  const name = findModelEntry(selected.route)?.name;
  return { agentKind, providerId, model, ...(effort ? { effort } : {}), ...(name ? { modelName: name } : {}) };
}

function modelButton(route, label, onPick) {
  const entry = findModelEntry(route);
  const detail = route && [entry ? AGENT_LABEL[entry.agent] || entry.agent : t('modelGone'), route.effort ? effortName(route.effort) : ''].filter(Boolean).join(' · ');
  return h('button', {
    class: `mbtn ${route ? '' : 'unset'}`, type: 'button', 'aria-label': label,
    onclick: async () => { const next = await pickRoute(route); if (next) await onPick(next); },
  }, route
    ? h('span', { class: 'mname' }, entry?.name || route.modelName || route.model, h('span', { class: 'mdetail' }, ` ${detail}`))
    : h('span', { class: 'mname' }, t('chooseModel')), svg(ICON.chevron, 12));
}

function chipsOf(list, onRemove, addLabel, onAdd) {
  const wrap = h('div', { class: 'chips' },
    ...list.map((text, i) => h('span', { class: 'chip' }, text, h('button', { class: 'x', type: 'button', 'aria-label': t('removeItem', { text }), onclick: () => { onRemove(i); render(); } }, svg(ICON.x, 12)))),
    h('button', { class: 'chip add', type: 'button', onclick: (e) => {
      const input = h('input', { 'aria-label': addLabel, placeholder: t('pressEnter') });
      let done = false;
      const commit = () => { if (done) return; done = true; const v = input.value.trim(); if (v) onAdd(v); render(); };
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } if (ev.key === 'Escape') { done = true; render(); } });
      input.addEventListener('blur', commit);
      e.currentTarget.replaceWith(h('span', { class: 'chip' }, input));
      input.focus();
    } }, svg(ICON.plus, 12), addLabel));
  return wrap;
}

async function changeRule(id, change) {
  // cfg may have been refreshed since this row rendered: change the current rule, not the captured one.
  const rule = cfg.rules.find((r) => r.id === id);
  if (!rule) { render(); return; }
  change(rule);
  await save();
  render();
}

// The same row number exists in every section: the section name keeps each control's label unique.
const sectionLabel = (point, text) => `${point.label()}: ${text}`;
const conditionLabel = (point, n) => sectionLabel(point, t('conditionLabel', { n }));

function ruleRow(rule, index, point) {
  const start = point.id === 'will-start-task';
  const n = index + 1;
  const condition = h('input', {
    class: 'pill grow', value: rule.question || '', 'aria-label': conditionLabel(point, n),
    placeholder: start ? t('phCondition') : t('phRunCondition'),
    // Keep what is typed in cfg right away, so a redraw from another save can't bring back the old text.
    oninput: (e) => { const r = cfg.rules.find((x) => x.id === rule.id); if (r) r.question = e.target.value; },
    onchange: (e) => changeRule(rule.id, (r) => { r.question = e.target.value.trim(); }),
  });
  const moveUp = () => {
    // cfg may have been refreshed since this row rendered: move what is there now, by id.
    const rows = cfg.rules.filter((r) => r.point === point.id);
    const at = rows.findIndex((r) => r.id === rule.id);
    if (at > 0) {
      const from = cfg.rules.indexOf(rows[at]);
      const to = cfg.rules.indexOf(rows[at - 1]);
      cfg.rules.splice(from, 1);
      cfg.rules.splice(to, 0, rows[at]);
    }
    save().then(render);
  };
  return h('div', { class: `rule ${rule.enabled === false ? 'off' : ''}` },
    h('div', { class: 'rr' },
      toggle(rule.enabled !== false, sectionLabel(point, `${t('enableRule')} ${n}`), () => changeRule(rule.id, (r) => { r.enabled = r.enabled === false; })),
      h('span', { class: 'w' }, t('ifWord')),
      condition,
      h('span', { class: 'w' }, start ? t('useWord') : ''),
      start
        ? modelButton(rule.route, sectionLabel(point, t('modelFor', { n })), (route) => changeRule(rule.id, (r) => { r.route = route; }))
        : h('span', { class: 'sd skip' }, t('skipRun')),
      h('button', { class: 'ib', type: 'button', disabled: index === 0, 'aria-label': sectionLabel(point, t('moveUp', { n })), onclick: moveUp }, svg(ICON.up, 14)),
      h('button', { class: 'ib', type: 'button', 'aria-label': sectionLabel(point, t('deleteRule', { n })), onclick: () => { cfg.rules = cfg.rules.filter((r) => r.id !== rule.id); save().then(render); } }, svg(ICON.trash, 14))),
    start ? null : h('div', { class: 'kw' }, h('span', { class: 'hint' }, t('keywordHint')),
      chipsOf(rule.keywords || [], (i) => { const word = rule.keywords[i]; changeRule(rule.id, (r) => { r.keywords = (r.keywords || []).filter((k) => k !== word); }); }, t('addKeyword'),
        (k) => changeRule(rule.id, (r) => { r.keywords ||= []; if (!r.keywords.includes(k)) r.keywords.push(k); }))),
    cfg.lastByRule?.[rule.id] ? h('p', { class: 'meta last' }, lastLine(rule)) : null);
}

async function runTry(point) {
  const text = (tryTexts[point] || '').trim();
  if (!text) return;
  const run = (tryRuns[point] || 0) + 1;
  tryRuns[point] = run;
  tryStates[point] = { busy: true }; render();
  try {
    const res = await ask('try', { point, text, config: cfg });
    if (run !== tryRuns[point]) return;
    tryStates[point] = { result: res.result };
  } catch (error) {
    if (run !== tryRuns[point]) return;
    tryStates[point] = { error: error.message };
  }
  render();
}

function tryBox(point) {
  const state = tryStates[point.id];
  let line = null;
  if (state?.busy) line = h('p', { class: 'res' }, t('judging'));
  else if (state?.error) line = h('p', { class: 'res err' }, state.error);
  else if (state?.result) {
    const r = state.result;
    const sec = r.ms ? t('seconds', { n: (r.ms / 1000).toFixed(1) }) : '';
    line = h('p', { class: 'res' }, svg(ICON.check, 14), r.action === 'allow' ? t('noChange', { why: r.why || t('noConclusion'), sec }) : `${r.summary || r.reason}${sec}`);
  }
  return h('div', { class: 'try' },
    h('div', { class: 'line' },
      h('input', { class: 'pill grow', value: tryTexts[point.id] || '', 'aria-label': sectionLabel(point, t('tryLabel')),
        placeholder: point.id === 'will-start-task' ? t('phTryStart') : t('phTryRun'), oninput: (e) => { tryTexts[point.id] = e.target.value; } }),
      h('button', { class: 'btn', type: 'button', disabled: !!state?.busy, onclick: () => runTry(point.id) }, svg(ICON.play, 14), t('tryIt'))),
    line);
}

function rulesSection() {
  const threshold = typeof cfg.threshold === 'number' ? cfg.threshold : 0.6;
  const sec = h('section', { class: 'sec' });
  if (pickerError) sec.append(h('p', { class: 'res err' }, pickerError));
  for (const point of POINTS) {
    const start = point.id === 'will-start-task';
    const list = cfg.rules.filter((r) => r.point === point.id);
    sec.append(h('div', { class: 'glabel' }, h('b', {}, point.label()), h('span', {}, point.hint())));
    const group = h('div', { class: 'group' }, ...list.map((rule, i) => ruleRow(rule, i, point)));
    if (start) {
      group.append(h('div', { class: 'rule base' }, h('div', { class: 'rr other' },
        h('span', { class: 'lab' }, t('otherwise')), h('span', { class: 'w' }, t('useWord')),
        modelButton(cfg.fallback, t('fallbackLabel'), async (route) => { cfg.fallback = route; await save(); render(); }))));
    }
    if (group.childElementCount) sec.append(group);
    sec.append(h('div', { class: 'line addline' }, h('button', { class: 'btn', type: 'button', onclick: async () => {
      cfg.rules.push({ id: newId(), point: point.id, enabled: true, question: '' });
      render();
      root.querySelector(`[aria-label="${CSS.escape(conditionLabel(point, list.length + 1))}"]`)?.focus();
    } }, svg(ICON.plus, 14), t('addCondition'))));
    if (start && !cfg.fallback) sec.append(h('p', { class: 'hint' }, t('fallbackNeeded')));
    if (start || list.length) sec.append(tryBox(point));
  }
  sec.append(h('p', { class: 'hint line thr' }, t('belowA'), select(THRESHOLDS.map((v) => [String(v), pct(v)]), String(threshold), (v) => { cfg.threshold = Number(v); save().then(render); }, t('thresholdLabel'), 'small'), t('belowB')));
  sec.append(h('div', { class: 'tip' }, svg(ICON.wand, 16),
    h('p', { class: 'sd' }, t('tipA'), ' ', h('q', {}, t('tipQuote')), ' ', t('tipB'))));
  return sec;
}

function render() {
  const active = document.activeElement;
  const focused = active?.getAttribute('aria-label');
  const caret = active?.tagName === 'INPUT' && active.type === 'text' ? [active.selectionStart, active.selectionEnd] : null;
  if (!loaded) {
    root.replaceChildren(h('p', { class: 'res err' }, storeError), h('button', { class: 'btn', type: 'button', onclick: boot }, t('storeRetry')));
    return;
  }
  root.replaceChildren(...(storeError ? [h('p', { class: 'res err' }, storeError)] : []), judgeSection(), rulesSection());
  if (focused) {
    const next = root.querySelector(`[aria-label="${CSS.escape(focused)}"]`);
    next?.focus();
    if (caret && next?.tagName === 'INPUT') next.setSelectionRange(...caret);
  }
}

async function loadSecrets() {
  const list = await fetch('/secrets').then((r) => r.json()).catch(() => []);
  secrets = Object.fromEntries(list.map((s) => [s.key, s.saved]));
}
async function loadJevModels() {
  if (jevModels || !secrets[PROVIDERS.jev.key]) return;
  try { jevModels = (await ask('jev-models', {}, 15000)).models; if (editingJudge) render(); } catch { jevModels = null; }
}
async function loadModels() {
  const body = await fetch('/agent-models').then((r) => r.json()).catch(() => ({ ok: false }));
  models = body.ok ? body.models : [];
}

// The brain or the AI changed rules: refresh unless the user is editing.
channel.addEventListener('message', async ({ data }) => {
  if (data?.from !== 'brain' || data.type !== 'config-changed') return;
  // A read that overlapped a save of ours may be older than that save: read again.
  let raw, seen;
  do {
    seen = saves;
    raw = await readStore().catch(() => null);
    if (!raw) return;
  } while (seen !== saves);
  // Edits not stored yet, in flight or just typed, stay on this page; don't redraw under someone typing.
  const latest = withRules(raw);
  cfg = mergeChanges(JSON.parse(stored), cfg, latest);
  // The baseline is only what is stored: a local row in it would look unchanged and never be saved.
  stored = JSON.stringify(latest);
  if (loaded && document.activeElement?.tagName !== 'INPUT') render();
});

async function boot() {
  await loadLocale();
  let raw;
  try {
    [raw] = await Promise.all([readStore(), loadSecrets(), loadModels()]);
  } catch (error) {
    // Do not render an empty page that could be saved over the stored rules.
    storeError = t('storeLoadFailed', { error: error && error.message });
    render();
    return;
  }
  cfg = withRules(raw);
  stored = JSON.stringify(cfg);
  loaded = true;
  storeError = '';
  // Same default as the brain; saved here so the page and the actual judge agree.
  if (!cfg.provider) { cfg.provider = secrets.openai_api_key || !secrets.typesafe_api_key ? 'openai' : 'jev'; await save(); }
  render();
  // The brain only starts when it is needed, so the page keeps the published list current too.
  publishModels();
  if (providerId() === 'jev') loadJevModels();
}
boot();
