// Decision Gate settings: the judge plus a table of rules (when → what to judge → what to do).
// Copy follows the host language only (GET /app-context); anything else falls back to English.
const MESSAGES = {
  "en": {
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
    save: "Save",
    modelVersion: "Model version",
    modelVersionJev: "Models available to your TypeSafe account",
    modelVersionOpenai: "The Decisions API currently supports only gpt-6-luna. Change this when a new version is available.",
    jevVersionLabel: "Jev model version",
    openaiVersionLabel: "OpenAI model version",
    judgeTitle: "Judged by",
    judgeDesc: "It answers the questions in your rules with only “yes or no” or “which one”. It never touches your files.",
    yes: "Yes",
    maxEffort: "Set reasoning effort to the highest",
    contains: "Contains “{word}”",
    skipRun: "Skip this run",
    keywordFound: "A keyword appears in the name or prompt",
    noQuestion: "No question yet",
    paused: "Paused",
    neverRun: "Not triggered yet",
    justNow: "just now",
    minsAgo: "{n} min ago",
    hoursAgo: "{n} hr ago",
    daysAgo: "{n} days ago",
    lastRun: "Last: {summary} · {when}",
    removeItem: "Remove {text}",
    pressEnter: "Type and press Enter",
    when: "When",
    what: "What to judge",
    how: "What to do",
    tryIt: "Try it",
    questionLabel: "Question to judge",
    phChoice: "e.g. What is this message mainly about?",
    phEffort: "e.g. Is this a hard problem that needs deep reasoning?",
    phSkip: "e.g. Is there nothing new, so no need to run?",
    choiceMode: "Pick one",
    yesNoMode: "Yes / No",
    judgeMode: "Judging method",
    addOption: "Add option",
    thresholdLabel: "Confidence threshold",
    chooseModel: "Select a model",
    optionModel: "Model for {label}",
    optionEffort: "Reasoning effort for {label}",
    unsure: "Unsure",
    unsureAction: "Use the model selected in the model picker",
    belowA: "Below",
    belowB: "counts as unsure. You can only choose connected models.",
    maxEffortKeep: "Set reasoning effort to the highest (same model)",
    atLeastA: "Counts as “yes” at",
    atLeastB: "confidence or above.",
    keywordHint: "Skip without asking the model when the name or prompt contains:",
    addKeyword: "Add keyword",
    tryLabel: "Text to try",
    phTryStart: "Try a message, e.g. Fix the bug on the login page",
    phTryRun: "Try a task name, e.g. Weekly report (paused)",
    judging: "Judging…",
    seconds: " · {n} s",
    noConclusion: "No conclusion",
    noChange: "{why}, no change{sec}",
    delete: "Delete",
    cancel: "Cancel",
    enableRule: "Enable this rule",
    rulesTitle: "Rules",
    rulesDesc: "At each moment below, rules are checked top to bottom. The first with a conclusion applies.",
    addRule: "Add rule",
    newRule: "New rule",
    emptyRules: "No rules yet. Choose “Add rule”, or ask the AI in any task to write one.",
    tipA: "The AI can write rules for you. In any task, say",
    tipQuote: "Use Claude Opus for coding and a cheaper model for chat",
    tipB: "and it adds the rule here for you to edit.",
  },
  "zh-CN": {
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
    save: "保存",
    modelVersion: "模型版本",
    modelVersionJev: "来自 TypeSafe 账号可用的模型",
    modelVersionOpenai: "Decisions API 目前只支持 gpt-6-luna，有新版本时可直接改",
    jevVersionLabel: "Jev 模型版本",
    openaiVersionLabel: "OpenAI 模型版本",
    judgeTitle: "判断用",
    judgeDesc: "规则里的问题交给它回答，它只回答“是不是”或“选哪个”，不会动你的文件。",
    yes: "是",
    maxEffort: "推理强度调到最高",
    contains: "含「{word}」",
    skipRun: "跳过本次",
    keywordFound: "名称或指令里出现关键词",
    noQuestion: "还没写判断的问题",
    paused: "已暂停",
    neverRun: "还没触发过",
    justNow: "刚刚",
    minsAgo: "{n} 分钟前",
    hoursAgo: "{n} 小时前",
    daysAgo: "{n} 天前",
    lastRun: "上次：{summary} · {when}",
    removeItem: "删除 {text}",
    pressEnter: "输入后回车",
    when: "什么时候",
    what: "判断什么",
    how: "怎么做",
    tryIt: "试一下",
    questionLabel: "判断的问题",
    phChoice: "例如：这条消息主要在做什么？",
    phEffort: "例如：这是不是一个需要深入推理的难题？",
    phSkip: "例如：这次是不是没有新情况，不用跑？",
    choiceMode: "多选一",
    yesNoMode: "是 / 否",
    judgeMode: "判断方式",
    addOption: "添加选项",
    thresholdLabel: "把握阈值",
    chooseModel: "选择模型",
    optionModel: "{label} 用的模型",
    optionEffort: "{label} 的推理强度",
    unsure: "拿不准",
    unsureAction: "用模型选择器里选的模型",
    belowA: "把握低于",
    belowB: "算拿不准。只能选你已连接的模型。",
    maxEffortKeep: "推理强度调到最高（模型不变）",
    atLeastA: "把握达到",
    atLeastB: "才算“是”。",
    keywordHint: "名称或指令里含这些词，不问模型直接跳过：",
    addKeyword: "添加关键词",
    tryLabel: "试一下的内容",
    phTryStart: "写一条消息试试，例如：帮我修一下登录页的 bug",
    phTryRun: "写一个任务名试试，例如：周报汇总（暂停中）",
    judging: "正在判断…",
    seconds: " · {n} 秒",
    noConclusion: "没有结论",
    noChange: "{why}，不改{sec}",
    delete: "删除",
    cancel: "取消",
    enableRule: "启用这条规则",
    rulesTitle: "规则",
    rulesDesc: "到了下面这些时刻，从上到下检查，第一条有结论的规则生效。",
    addRule: "添加规则",
    newRule: "新规则",
    emptyRules: "还没有规则。点「添加规则」，或在任何任务里让 AI 帮你写。",
    tipA: "也可以让 AI 帮你写规则。在任何任务里说一句",
    tipQuote: "写代码用 Claude Opus，闲聊用便宜点的模型",
    tipB: "，AI 会把规则加到这里，你可以再改。",
  },
  "ja": {
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
    save: "保存",
    modelVersion: "モデルのバージョン",
    modelVersionJev: "TypeSafe アカウントで使えるモデル",
    modelVersionOpenai: "Decisions API は現在 gpt-6-luna のみ対応です。新しいバージョンが出たら変更できます。",
    jevVersionLabel: "Jev モデルのバージョン",
    openaiVersionLabel: "OpenAI モデルのバージョン",
    judgeTitle: "判断に使うモデル",
    judgeDesc: "ルールの質問に「はい/いいえ」または「どれか」だけで答えます。ファイルには触れません。",
    yes: "はい",
    maxEffort: "推論レベルを最高にする",
    contains: "「{word}」を含む",
    skipRun: "今回はスキップ",
    keywordFound: "名前または指示にキーワードが含まれる",
    noQuestion: "質問がまだありません",
    paused: "一時停止中",
    neverRun: "まだ実行されていません",
    justNow: "たった今",
    minsAgo: "{n} 分前",
    hoursAgo: "{n} 時間前",
    daysAgo: "{n} 日前",
    lastRun: "前回: {summary} · {when}",
    removeItem: "{text} を削除",
    pressEnter: "入力して Enter",
    when: "いつ",
    what: "何を判断するか",
    how: "どうするか",
    tryIt: "試す",
    questionLabel: "判断する質問",
    phChoice: "例: このメッセージの主な内容は?",
    phEffort: "例: 深い推論が必要な難問ですか?",
    phSkip: "例: 新しい動きがなく、実行不要ですか?",
    choiceMode: "いずれかを選ぶ",
    yesNoMode: "はい / いいえ",
    judgeMode: "判断方法",
    addOption: "選択肢を追加",
    thresholdLabel: "確信度のしきい値",
    chooseModel: "モデルを選択",
    optionModel: "{label} のモデル",
    optionEffort: "{label} の推論レベル",
    unsure: "判断できない",
    unsureAction: "モデル選択で選んだモデルを使う",
    belowA: "確信度が",
    belowB: "未満なら判断できない扱いです。接続済みのモデルだけ選べます。",
    maxEffortKeep: "推論レベルを最高にする(モデルは同じ)",
    atLeastA: "確信度が",
    atLeastB: "以上で「はい」とします。",
    keywordHint: "名前または指示に次の語があれば、モデルに聞かずスキップ:",
    addKeyword: "キーワードを追加",
    tryLabel: "試す内容",
    phTryStart: "メッセージを試す。例: ログインページのバグを直して",
    phTryRun: "タスク名を試す。例: 週報まとめ(一時停止中)",
    judging: "判断中…",
    seconds: " · {n} 秒",
    noConclusion: "結論なし",
    noChange: "{why}、変更なし{sec}",
    delete: "削除",
    cancel: "キャンセル",
    enableRule: "このルールを有効にする",
    rulesTitle: "ルール",
    rulesDesc: "以下の各タイミングで上から順に確認し、最初に結論が出たルールを適用します。",
    addRule: "ルールを追加",
    newRule: "新しいルール",
    emptyRules: "ルールはまだありません。「ルールを追加」を選ぶか、任意のタスクで AI に頼んでください。",
    tipA: "AI にルールを書いてもらえます。任意のタスクで次のように伝えてください:",
    tipQuote: "コードは Claude Opus、雑談は安いモデルで",
    tipB: "AI がここにルールを追加し、あとから編集できます。",
  },
  "ko": {
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
    save: "저장",
    modelVersion: "모델 버전",
    modelVersionJev: "TypeSafe 계정에서 쓸 수 있는 모델",
    modelVersionOpenai: "Decisions API는 현재 gpt-6-luna만 지원합니다. 새 버전이 나오면 바꿀 수 있습니다.",
    jevVersionLabel: "Jev 모델 버전",
    openaiVersionLabel: "OpenAI 모델 버전",
    judgeTitle: "판단 모델",
    judgeDesc: "규칙의 질문에 “예/아니요” 또는 “어느 쪽”으로만 답합니다. 파일은 건드리지 않습니다.",
    yes: "예",
    maxEffort: "추론 강도를 최고로",
    contains: "“{word}” 포함",
    skipRun: "이번 실행 건너뛰기",
    keywordFound: "이름이나 지시에 키워드가 있음",
    noQuestion: "아직 질문이 없습니다",
    paused: "일시 중지됨",
    neverRun: "아직 실행되지 않음",
    justNow: "방금",
    minsAgo: "{n}분 전",
    hoursAgo: "{n}시간 전",
    daysAgo: "{n}일 전",
    lastRun: "지난번: {summary} · {when}",
    removeItem: "{text} 삭제",
    pressEnter: "입력 후 Enter",
    when: "언제",
    what: "무엇을 판단할지",
    how: "어떻게 할지",
    tryIt: "시험해 보기",
    questionLabel: "판단할 질문",
    phChoice: "예: 이 메시지의 주된 내용은?",
    phEffort: "예: 깊은 추론이 필요한 어려운 문제인가요?",
    phSkip: "예: 새로운 내용이 없어 실행할 필요가 없나요?",
    choiceMode: "하나 선택",
    yesNoMode: "예 / 아니요",
    judgeMode: "판단 방식",
    addOption: "선택지 추가",
    thresholdLabel: "확신도 기준",
    chooseModel: "모델 선택",
    optionModel: "{label}에 쓸 모델",
    optionEffort: "{label}의 추론 강도",
    unsure: "확실하지 않음",
    unsureAction: "모델 선택기에서 고른 모델 사용",
    belowA: "확신도가",
    belowB: "미만이면 확실하지 않은 것으로 봅니다. 연결된 모델만 고를 수 있습니다.",
    maxEffortKeep: "추론 강도를 최고로(모델 유지)",
    atLeastA: "확신도가",
    atLeastB: "이상이면 “예”로 봅니다.",
    keywordHint: "이름이나 지시에 다음 단어가 있으면 모델에 묻지 않고 건너뜁니다:",
    addKeyword: "키워드 추가",
    tryLabel: "시험할 내용",
    phTryStart: "메시지를 시험해 보세요. 예: 로그인 페이지 버그 고쳐 줘",
    phTryRun: "작업 이름을 시험해 보세요. 예: 주간 보고(일시 중지)",
    judging: "판단 중…",
    seconds: " · {n}초",
    noConclusion: "결론 없음",
    noChange: "{why}, 변경 없음{sec}",
    delete: "삭제",
    cancel: "취소",
    enableRule: "이 규칙 사용",
    rulesTitle: "규칙",
    rulesDesc: "아래 각 시점에 위에서부터 확인하며, 먼저 결론이 난 규칙을 적용합니다.",
    addRule: "규칙 추가",
    newRule: "새 규칙",
    emptyRules: "아직 규칙이 없습니다. “규칙 추가”를 누르거나 아무 작업에서나 AI에게 부탁하세요.",
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
  { id: 'will-schedule-run', label: () => t('pointSchedule'), hint: () => '' },
  { id: 'will-routine-run', label: () => t('pointRoutine'), hint: () => '' },
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
let openId = null; // rule being edited
let draft = null; // working copy
let tryText = '';
let tryState = null; // { busy } | { result } | { error }

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
  chevron: 'm6 9 6 6 6-6', plus: 'M5 12h14|M12 5v14', x: 'M18 6 6 18|m6 6 12 12', arrow: 'M5 12h14|m12 5 7 7-7 7',
  check: 'M20 6 9 17l-5-5', play: 'M6 3v18l15-9z', trash: 'M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  wand: 'm21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72|m14 7 3 3|M5 6v4|M19 14v4|M10 2v2|M7 8H3|M21 16h-4|M11 3H9',
};
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const newId = () => randomId();
const pct = (n) => `${Math.round(n * 100)}%`;
const provider = () => PROVIDERS[cfg.provider === 'jev' ? 'jev' : 'openai'];
const providerId = () => (cfg.provider === 'jev' ? 'jev' : 'openai');
const modelOf = (id) => (id === 'openai' ? cfg.openaiModel : cfg.jevModel) || PROVIDERS[id].model;
const routeLabel = (route) => route ? `${route.modelName || route.model}${route.effort ? ` · ${effortName(route.effort)}` : ''}` : t('noModel');

function migrate(raw) {
  const out = { ...raw };
  if (!Array.isArray(out.rules)) {
    out.rules = [];
    for (const point of ['will-schedule-run', 'will-routine-run']) {
      const old = raw[point];
      if (!old || (!old.question && !(old.keywords || []).length)) continue;
      out.rules.push({ id: newId(), point, type: 'predicate', enabled: old.enabled !== false, question: old.question || '', keywords: old.keywords || [], action: 'skip', threshold: typeof old.threshold === 'number' ? old.threshold : 0.7 });
    }
  }
  delete out['will-schedule-run'];
  delete out['will-routine-run'];
  return out;
}

async function save() {
  // The brain writes lastByRule: re-read before saving and overwrite only rules and judge settings.
  const latest = await fetch('/kv').then((r) => r.json()).catch(() => ({}));
  const next = { ...cfg, lastByRule: latest.lastByRule || cfg.lastByRule || {} };
  await fetch('/kv', { method: 'PUT', body: JSON.stringify(next) });
  cfg = next;
  channel.postMessage({ from: 'settings', type: 'config-changed' });
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
    const keyInput = h('input', { class: 'pill', type: 'password', autocomplete: 'off', placeholder: saved ? t('keyReplace') : t('keyPaste', { label: p.keyLabel }), 'aria-label': p.keyLabel });
    group.append(h('form', {
      class: 'row', onsubmit: async (e) => {
        e.preventDefault();
        const value = keyInput.value.trim();
        if (!value) return;
        await fetch(`/secrets/${p.key}`, { method: 'PUT', body: JSON.stringify({ value }) });
        await loadSecrets();
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
function summary(rule) {
  const outs = [];
  if (rule.type === 'choice') {
    for (const o of rule.options || []) outs.push([o.label, routeLabel(o.route)]);
  } else if (rule.point === 'will-start-task') outs.push([t('yes'), t('maxEffort')]);
  else {
    for (const k of rule.keywords || []) outs.push([t('contains', { word: k }), t('skipRun')]);
    if (rule.question) outs.push([t('yes'), t('skipRun')]);
  }
  return [
    h('p', { class: 'sent' }, rule.question || (rule.keywords?.length ? t('keywordFound') : t('noQuestion'))),
    outs.length ? h('div', { class: 'outs' }, ...outs.map(([k, v]) => h('span', { class: 'out' }, k, h('span', { class: 'a' }, '→'), v))) : null,
  ];
}

function lastLine(rule) {
  if (rule.enabled === false) return t('paused');
  const last = cfg.lastByRule?.[rule.id];
  if (!last) return t('neverRun');
  const mins = Math.max(0, Math.round((Date.now() - last.at) / 60000));
  const when = mins < 1 ? t('justNow') : mins < 60 ? t('minsAgo', { n: mins }) : mins < 1440 ? t('hoursAgo', { n: Math.round(mins / 60) }) : t('daysAgo', { n: Math.round(mins / 1440) });
  return t('lastRun', { summary: last.summary, when });
}

function modelOptions() {
  // The same model can appear under several engines and providers: show both to tell them apart.
  return models.filter((m) => m.visible !== false).map((m) => [`${m.providerId}|${m.agent}|${m.id}`, `${m.name} · ${m.providerName} · ${AGENT_LABEL[m.agent] || m.agent}`]);
}
function findModelEntry(route) {
  return route && models.find((m) => m.id === route.model && m.providerId === route.providerId && AGENT_KIND[m.agent] === route.agentKind);
}
function routeFor(key, effort) {
  const [pid, agent, id] = key.split('|');
  const m = models.find((x) => x.providerId === pid && x.agent === agent && x.id === id);
  if (!m) return null;
  const e = effort && m.efforts?.includes(effort) ? effort : m.defaultEffort || undefined;
  return { agentKind: AGENT_KIND[m.agent], model: m.id, providerId: m.providerId, modelName: m.name, ...(e ? { effort: e } : {}) };
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

function editor() {
  const d = draft;
  const start = d.point === 'will-start-task';
  const field = (label, ...body) => h('div', { class: 'f' }, h('div', { class: 'fl' }, label), h('div', { class: 'fv' }, ...body));
  const parts = [];
  parts.push(field(t('when'), seg(POINTS.map((p) => [p.id, p.label()]), d.point, (point) => {
    d.point = point;
    if (point !== 'will-start-task') d.type = 'predicate';
    render();
  }, t('when'))));
  const question = h('input', {
    class: 'pill', value: d.question || '', 'aria-label': t('questionLabel'),
    placeholder: d.type === 'choice' ? t('phChoice') : start ? t('phEffort') : t('phSkip'),
    oninput: (e) => { d.question = e.target.value; },
  });
  parts.push(field(t('what'),
    start ? seg([['choice', t('choiceMode')], ['predicate', t('yesNoMode')]], d.type, (type) => { d.type = type; render(); }, t('judgeMode')) : null,
    h('div', { class: start ? 'gap' : '' }, question),
    d.type === 'choice' ? chipsOf((d.options ||= []).map((o) => o.label), (i) => d.options.splice(i, 1), t('addOption'), (label) => { if (!d.options.some((o) => o.label === label)) d.options.push({ label }); }) : null));

  const thresholdSel = select(THRESHOLDS.map((t) => [String(t), pct(t)]), String(d.threshold ?? (d.type === 'choice' ? 0.6 : 0.7)), (v) => { d.threshold = Number(v); }, t('thresholdLabel'), 'small');
  if (d.type === 'choice') {
    const rows = (d.options || []).map((o) => {
      const entry = findModelEntry(o.route);
      const key = entry ? `${entry.providerId}|${entry.agent}|${entry.id}` : '';
      const modelSel = select([['', t('chooseModel')], ...modelOptions()], key, (v) => { o.route = v ? routeFor(v) : undefined; render(); }, t('optionModel', { label: o.label }), 'wide');
      const effortSel = entry?.efforts?.length
        ? select(entry.efforts.map((e) => [e, effortName(e)]), o.route?.effort || entry.defaultEffort || entry.efforts[0], (v) => { o.route = routeFor(key, v); }, t('optionEffort', { label: o.label }), 'small')
        : null;
      return h('div', { class: 'mrow' }, h('span', { class: 'k' }, o.label), svg(ICON.arrow, 14), h('div', { class: 'line' }, modelSel, effortSel));
    });
    parts.push(field(t('how'), h('div', { class: 'map' }, ...rows,
      h('div', { class: 'mrow' }, h('span', { class: 'k dim' }, t('unsure')), svg(ICON.arrow, 14), h('span', { class: 'sd' }, t('unsureAction'))),
      h('p', { class: 'hint line' }, t('belowA'), thresholdSel, t('belowB')))));
  } else {
    parts.push(field(t('how'), h('div', { class: 'map' },
      h('div', { class: 'mrow' }, h('span', { class: 'k' }, t('yes')), svg(ICON.arrow, 14), h('span', { class: 'sd' }, start ? t('maxEffortKeep') : t('skipRun'))),
      h('p', { class: 'hint line' }, t('atLeastA'), thresholdSel, t('atLeastB')),
      start ? null : h('div', {}, h('p', { class: 'hint' }, t('keywordHint')),
        chipsOf(d.keywords ||= [], (i) => d.keywords.splice(i, 1), t('addKeyword'), (k) => { if (!d.keywords.includes(k)) d.keywords.push(k); })))));
  }

  const tryInput = h('input', {
    class: 'pill', value: tryText, 'aria-label': t('tryLabel'),
    placeholder: start ? t('phTryStart') : t('phTryRun'),
    oninput: (e) => { tryText = e.target.value; },
  });
  let tryLine = null;
  if (tryState?.busy) tryLine = h('p', { class: 'res' }, t('judging'));
  else if (tryState?.error) tryLine = h('p', { class: 'res err' }, tryState.error);
  else if (tryState?.result) {
    const r = tryState.result;
    const sec = r.ms ? t('seconds', { n: (r.ms / 1000).toFixed(1) }) : '';
    const text = r.action === 'allow' ? t('noChange', { why: r.why || t('noConclusion'), sec }) : `${r.summary || r.reason}${sec}`;
    tryLine = h('p', { class: 'res' }, svg(ICON.check, 14), text);
  }
  parts.push(field(t('tryIt'), h('div', { class: 'line' }, tryInput, h('button', { class: 'btn', type: 'button', disabled: !!tryState?.busy, onclick: runTry }, svg(ICON.play, 14), t('tryIt'))), tryLine));

  parts.push(h('div', { class: 'edfoot' },
    h('button', { class: 'btn quiet', type: 'button', onclick: removeRule }, svg(ICON.trash, 14), t('delete')),
    h('span', { class: 'line' }, h('button', { class: 'btn', type: 'button', onclick: () => { openId = null; draft = null; tryState = null; render(); } }, t('cancel')),
      h('button', { class: 'btn cta', type: 'button', onclick: commitRule }, t('save')))));
  return h('div', { class: 'ed' }, ...parts);
}

function normalizeDraft(d) {
  if (d.point !== 'will-start-task') { d.type = 'predicate'; d.action = 'skip'; delete d.options; }
  else if (d.type === 'predicate') { d.action = 'max-effort'; delete d.keywords; delete d.options; }
  else { d.options = (d.options || []).filter((o) => o.label); delete d.keywords; delete d.action; }
  return d;
}
async function commitRule() {
  const d = normalizeDraft(draft);
  const i = cfg.rules.findIndex((r) => r.id === d.id);
  if (i >= 0) cfg.rules[i] = d; else cfg.rules.push(d);
  openId = null; draft = null; tryState = null;
  await save();
  render();
}
async function removeRule() {
  cfg.rules = cfg.rules.filter((r) => r.id !== draft.id);
  openId = null; draft = null; tryState = null;
  await save();
  render();
}
async function runTry() {
  if (!tryText.trim()) return;
  tryState = { busy: true }; render();
  try {
    const rule = normalizeDraft(JSON.parse(JSON.stringify(draft)));
    const config = { ...cfg, rules: [...cfg.rules.filter((r) => r.id !== rule.id), rule] };
    // No real task here: demonstrate the highest-effort rule with the first model that has efforts.
    const sample = models.find((m) => m.visible !== false && m.efforts?.length);
    const route = sample ? { agentKind: AGENT_KIND[sample.agent], model: sample.id, providerId: sample.providerId } : {};
    const res = await ask('try', { ruleId: rule.id, text: tryText.trim(), config, route });
    tryState = { result: res.result };
  } catch (error) {
    tryState = { error: error.message };
  }
  render();
}

function ruleRow(rule) {
  const open = openId === rule.id;
  return h('div', { class: `rule ${rule.enabled === false ? 'off' : ''}` },
    h('div', { class: 'rtop' },
      toggle(rule.enabled !== false, t('enableRule'), async () => { rule.enabled = rule.enabled === false; await save(); render(); }),
      h('button', { class: 'rbody', type: 'button', 'aria-expanded': String(open), onclick: () => {
        if (open) { openId = null; draft = null; } else { openId = rule.id; draft = JSON.parse(JSON.stringify(rule)); }
        tryState = null; render();
      } }, h('div', { class: 'grow' }, ...summary(open ? draft : rule), h('p', { class: 'meta' }, lastLine(rule))), h('span', { class: `chev ${open ? 'up' : ''}` }, svg(ICON.chevron, 16)))),
    open ? editor() : null);
}

function rulesSection() {
  const sec = h('section', { class: 'sec' },
    h('div', { class: 'sh' }, h('div', {}, h('p', { class: 'st' }, t('rulesTitle')), h('p', { class: 'sd' }, t('rulesDesc'))),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        draft = { id: newId(), point: 'will-start-task', type: 'choice', enabled: true, question: '', options: [], threshold: 0.6 };
        openId = draft.id; tryState = null; render();
      } }, svg(ICON.plus, 14), t('addRule'))));
  const pending = draft && !cfg.rules.some((r) => r.id === draft.id) ? draft : null;
  for (const point of POINTS) {
    const list = cfg.rules.filter((r) => r.point === point.id);
    const showNew = pending && pending.point === point.id;
    if (!list.length && !showNew) continue;
    sec.append(h('div', { class: 'glabel' }, h('b', {}, point.label()), point.hint() ? h('span', {}, point.hint()) : null));
    const group = h('div', { class: 'group' }, ...list.map(ruleRow));
    if (showNew) group.append(h('div', { class: 'rule' }, h('div', { class: 'rtop' }, h('div', { class: 'grow' }, h('p', { class: 'sent' }, t('newRule')))), editor()));
    sec.append(group);
  }
  if (!cfg.rules.length && !pending) sec.append(h('p', { class: 'empty' }, t('emptyRules')));
  sec.append(h('div', { class: 'tip' }, svg(ICON.wand, 16),
    h('p', { class: 'sd' }, t('tipA'), ' ', h('q', {}, t('tipQuote')), ' ', t('tipB'))));
  return sec;
}

function render() {
  const focused = document.activeElement?.getAttribute('aria-label');
  root.replaceChildren(judgeSection(), rulesSection());
  if (focused) root.querySelector(`[aria-label="${CSS.escape(focused)}"]`)?.focus();
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
  cfg = migrate(await fetch('/kv').then((r) => r.json()).catch(() => ({})));
  if (!draft) render();
});

(async () => {
  await loadLocale();
  const [raw] = await Promise.all([fetch('/kv').then((r) => r.json()).catch(() => ({})), loadSecrets(), loadModels()]);
  cfg = migrate(raw);
  // Same default as the brain; saved here so the page and the actual judge agree.
  if (!cfg.provider) { cfg.provider = secrets.openai_api_key || !secrets.typesafe_api_key ? 'openai' : 'jev'; await save(); }
  render();
  if (providerId() === 'jev') loadJevModels();
})();
