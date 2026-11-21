'use strict';

const channel = new BroadcastChannel('cindy-plugin-herdr');
const lib = window.HerdrPanelLib || {};
// 从共享库取纯函数；直接绑名，调用处保持可读。
const dirName = lib.dirName || function (value) { return value ? String(value) : ''; };
const graphemes = lib.graphemes || function (text) { return [String(text || '')]; };
const isWideGrapheme = lib.isWideGrapheme || function () { return false; };
const WIDE_CHAR = lib.WIDE_CHAR || /$^/;
const $ = function (selector) { return document.querySelector(selector); };

// 面板文案跟随宿主语言：只读 /app-context 的 uiLocale ?? locale，插件没有的语言回退英文。
// 不读 navigator.language，也不保存自己的语言偏好。
const strings = {
  'zh-CN': {
    refreshing: '刷新中…',
    updated: '已更新',
    refreshAction: '刷新',
    refreshFailed: '刷新失败',
    noWorkspaces: '没有可显示的工作区',
    focused: '当前',
    noTmuxSessions: '没有正在运行的 tmux session',
    allSessions: '全部 session',
    noPanes: '这个 session 下没有可列的 pane',
    tmuxMissing: '这台电脑上没有 tmux',
    tmuxMissingHint: '装上 tmux 后这里会列出 session 与 pane。',
    tmuxBroken: 'tmux 无法使用',
    tmuxBrokenHint: 'tmux 装了但没能运行，下面给出了具体原因。',
    windows: '个窗口',
    attached: '已连接',
    exited: '已退出',
    active: '活动',
    panes: '个 pane',
    sessions: '个 session',
    collapse: '收起',
    wrapOn: '自动换行',
    wrapOff: '不换行',
    loading: '读取中…',
    noOutput: '(没有输出)',
    readFailed: '读取失败',
    writeTimeoutUnknown: '请求可能已执行，请先在终端里核对实际状态，再决定是否重试。',
    heldHint: '这个终端有未确认的操作。请先核对终端：确认后可按 Ctrl+C 取消那行，或回车补发。',
    enterUnconfirmed: '文本已输入到终端，但回车没有确认。请先在终端里核对内容：若命令尚未执行，直接再按一次回车即可（只会补发回车，不会重复粘贴文本）。',
    enterStillUnknown: '回车没有确认。请先核对终端内容，再决定是否再按一次回车。',
    doneRefreshFailed: '操作已完成，但画面刷新失败：',
    terminalInput: '终端输入',
    lang: 'zh-CN',
    dataSourceTabs: '数据源',
    pluginUnresponsive: '插件未响应',
    operationFailed: '操作失败',
    paneReplaced: '这个分屏已经被替换（tmux server 重启），请重新选择目标。',
    sendFailed: '发送失败',
    termPlaceholder: '直接输入命令，回车执行',
    send: '发送',
    submit: '发送并回车',
    statusWorking: '进行中',
    statusBlocked: '待处理',
    statusDone: '已完成',
    statusIdle: '空闲',
    sendingTo: '发送到 ',
    paneFallback: '分屏'
  },
  en: {
    refreshing: 'Refreshing…',
    updated: 'Updated',
    refreshAction: 'Refresh',
    refreshFailed: 'Could not refresh',
    noWorkspaces: 'No workspace to show',
    focused: 'focused',
    noTmuxSessions: 'No running tmux session',
    allSessions: 'All sessions',
    noPanes: 'No pane listed in this session',
    tmuxMissing: 'tmux is not installed on this computer',
    tmuxMissingHint: 'Install tmux to list sessions and panes here.',
    tmuxBroken: 'tmux could not be used',
    tmuxBrokenHint: 'tmux is installed but did not run; the reason is below.',
    windows: 'window(s)',
    attached: 'attached',
    exited: 'exited',
    active: 'active',
    panes: 'pane(s)',
    sessions: 'session(s)',
    collapse: 'Collapse',
    wrapOn: 'Wrap',
    wrapOff: 'No wrap',
    loading: 'Loading…',
    noOutput: '(no output)',
    readFailed: 'Could not read',
    writeTimeoutUnknown: 'The request may have run; check the terminal before retrying.',
    heldHint: 'This terminal has an unconfirmed operation. Check the terminal first; press Ctrl+C to cancel the line, or Enter to complete it.',
    enterUnconfirmed: 'The text is in the terminal but Enter is unconfirmed. Check the terminal; if the command did not run, press Enter again (only Enter is resent, not the text).',
    enterStillUnknown: 'Enter is still unconfirmed. Check the terminal before pressing Enter again.',
    doneRefreshFailed: 'The operation completed, but refreshing the screen failed: ',
    terminalInput: 'Terminal input',
    lang: 'en',
    dataSourceTabs: 'Data source',
    pluginUnresponsive: 'The plugin did not respond',
    operationFailed: 'The operation failed',
    paneReplaced: 'This pane was replaced (the tmux server restarted). Please pick the target again.',
    sendFailed: 'Could not send',
    termPlaceholder: 'Type a command, Enter runs it',
    send: 'Send',
    submit: 'Send and press Enter',
    statusWorking: 'working',
    statusBlocked: 'blocked',
    statusDone: 'done',
    statusIdle: 'idle',
    sendingTo: 'Send to ',
    paneFallback: 'pane'
  },
  ja: {
    refreshing: '更新中…',
    updated: '更新しました',
    refreshAction: '更新',
    refreshFailed: '更新できませんでした',
    noWorkspaces: '表示できるワークスペースがありません',
    focused: '現在',
    noTmuxSessions: '実行中の tmux セッションはありません',
    allSessions: 'すべてのセッション',
    noPanes: 'このセッションに pane は表示できません',
    tmuxMissing: 'このコンピューターに tmux がありません',
    tmuxMissingHint: 'tmux を入れるとセッションと pane が表示されます。',
    tmuxBroken: 'tmux を使えません',
    tmuxBrokenHint: 'tmux はありますが実行できませんでした。理由は下にあります。',
    windows: 'ウィンドウ',
    attached: '接続済み',
    exited: '終了',
    active: 'アクティブ',
    panes: 'pane',
    sessions: 'セッション',
    collapse: '閉じる',
    wrapOn: '自動折り返し',
    wrapOff: '折り返さない',
    loading: '読み込み中…',
    noOutput: '（出力なし）',
    readFailed: '読み込みに失敗',
    writeTimeoutUnknown: 'リクエストは実行された可能性があります。端末を確認してから再試してください。',
    heldHint: 'この端末に未確認の操作があります。端末を確認し、Ctrl+C で行を取り消すか Enter で補完してください。',
    enterUnconfirmed: 'テキストは端末にありますが Enter が未確認です。端末を確認し、実行されていなければもう一度 Enter を押してください（テキストは再送しません）。',
    enterStillUnknown: 'Enter が未確認です。端末を確認してから再送してください。',
    doneRefreshFailed: '操作は完了しましたが、画面の更新に失敗しました：',
    terminalInput: '端末入力',
    lang: 'ja',
    dataSourceTabs: 'データソース',
    pluginUnresponsive: 'プラグインが応答しません',
    operationFailed: '操作に失敗しました',
    paneReplaced: 'このペインは置き換えられました（tmux server が再起動）。対象を選び直してください。',
    sendFailed: '送信に失敗',
    termPlaceholder: 'ここにコマンドを入力し Enter で実行',
    send: '送信',
    submit: '送信して Enter',
    statusWorking: '作業中',
    statusBlocked: '要対応',
    statusDone: '完了',
    statusIdle: '待機',
    sendingTo: '送信先: ',
    paneFallback: 'pane'
  },
  ko: {
    refreshing: '새로 고치는 중…',
    updated: '갱신됨',
    refreshAction: '새로 고침',
    refreshFailed: '갱신하지 못했습니다',
    noWorkspaces: '표시할 작업 공간이 없습니다',
    focused: '현재',
    noTmuxSessions: '실행 중인 tmux 세션이 없습니다',
    allSessions: '모든 세션',
    noPanes: '이 세션에 표시할 창이 없습니다',
    tmuxMissing: '이 컴퓨터에 tmux가 없습니다',
    tmuxMissingHint: 'tmux를 설치하면 세션과 창이 표시됩니다.',
    tmuxBroken: 'tmux를 사용할 수 없습니다',
    tmuxBrokenHint: 'tmux는 설치되어 있지만 실행되지 않았습니다. 아래에 원인이 있습니다.',
    windows: '개 창',
    attached: '연결됨',
    exited: '종료됨',
    active: '활성',
    panes: '개 창',
    sessions: '개 세션',
    collapse: '접기',
    wrapOn: '자동 줄바꿈',
    wrapOff: '줄바꿈 안 함',
    loading: '읽는 중…',
    noOutput: '(출력 없음)',
    readFailed: '읽지 못했습니다',
    writeTimeoutUnknown: '요청이 이미 실행되었을 수 있습니다. 터미널을 확인한 후 다시 시도하세요.',
    heldHint: '이 터미널에 확인되지 않은 작업이 있습니다. 터미널을 확인하고 Ctrl+C로 취소하거나 Enter로 완료하세요.',
    enterUnconfirmed: '텍스트는 터미널에 있지만 Enter가 확인되지 않았습니다. 실행되지 않았다면 Enter만 다시 누르세요(텍스트는 재전송하지 않습니다).',
    enterStillUnknown: 'Enter가 아직 확인되지 않았습니다. 터미널을 확인한 후 다시 누르세요.',
    doneRefreshFailed: '작업은 완료되었지만 화면 갱신에 실패했습니다: ',
    terminalInput: '터미널 입력',
    lang: 'ko',
    dataSourceTabs: '데이터 소스',
    pluginUnresponsive: '플러그인이 응답하지 않습니다',
    operationFailed: '작업이 실패했습니다',
    paneReplaced: '이 페인은 교체되었습니다(tmux server 재시작). 대상을 다시 선택하세요.',
    sendFailed: '보내지 못했습니다',
    termPlaceholder: '명령을 입력하고 Enter 로 실행',
    send: '보내기',
    submit: '보내고 Enter',
    statusWorking: '작업 중',
    statusBlocked: '확인 필요',
    statusDone: '완료',
    statusIdle: '대기',
    sendingTo: '보낼 대상: ',
    paneFallback: '창'
  }
};

let T = strings.en;

let view = 'herdr';
let state = { workspaces: [], tabs: [], panes: [] };
let selectedPane = null;

let tmux = { available: false, version: null, reason: null, message: null, sessions: [], panes: [], hint: null };
let tmuxFilter = null;
// 最近一次 tmux_state 里的 server pid：写入时带给 worker 校验代次，
// server 重启复用 %N 之后，这次写入不能打到新 server 的同名 pane。
let tmuxServerPid = null;
let selectedTarget = null;

// 每次读取带一个序号：晚到的旧结果不能盖掉用户已经选中的另一个 pane。
let readToken = 0;

// 面板这一层必须晚于后端：普通写请求的 worker 预算是 45 秒、宿主是 70 秒，
// 面板若也是 45 秒就会先报「插件未响应」并丢掉稍后到达的「结果未知」，
// 用户重试可能把命令执行两次。快照的宿主预算是 45 秒，也一起覆盖。
// 面板预算必须晚于主进程的 tmux 写预算（90s）+ 回包余量，
// 否则主进程还在等精确回包时，面板已经误判结果未知并冻结。
const PANEL_REQUEST_TIMEOUT_MS = 100000;
// 这些动作会把内容写进终端/后端：80 秒超时只代表「没收到回包」，
// 不代表「没执行」，必须按结果未知处理，不能报普通失败让人直接重试。
const PANEL_WRITE_ACTIONS = { tmux_send: true, tmux_submit: true, submit: true, send: true, prompt: true };

function request(action, payload) {
  return new Promise(function (resolve, reject) {
    // reqId 经 BroadcastChannel 对外可见：用 crypto 生成，
    // 同毫秒或弱随机碰撞不能让两个面板串回包。
    const reqId = 'p' + crypto.randomUUID();
    let settled = false;
    function cleanup() {
      clearTimeout(timer);
      channel.removeEventListener('message', onMessage);
    }
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(PANEL_WRITE_ACTIONS[action]
        ? 'HERDR_OUTCOME_UNKNOWN: ' + T.writeTimeoutUnknown + '（' + action + '）'
        : T.pluginUnresponsive));
    }, PANEL_REQUEST_TIMEOUT_MS);
    function onMessage(event) {
      const message = event.data;
      if (!message || message.type !== 'panel-response' || message.reqId !== reqId) return;
      if (settled) return;
      settled = true;
      cleanup();
      if (message.ok) resolve(message.data);
      else reject(new Error(message.message || T.operationFailed));
    }
    channel.addEventListener('message', onMessage);
    channel.postMessage(Object.assign({ type: 'panel-request', reqId: reqId, action: action }, payload || {}));
  });
}

// tmux 的 target（session:window.pane）只是位置，重建会复用；
// 写入与恢复状态都按 tmux 的稳定 pane_id（%N）归属。
function tmuxStableTarget(pane) {
  return (pane && pane.pane_id) || (pane && pane.target) || null;
}

// 状态点配色：agent 运行中绿、出错红、空闲/已完成灰；普通 pane 中性色。
// 颜色只做辅助，详情卡里的文字始终说明状态本身。
function paneDotClass(pane) {
  if (!pane.agent) return 'hollow';
  const status = String(pane.agent_status || 'unknown').toLowerCase();
  if (status === 'working') return 'working';
  if (status === 'blocked') return 'blocked';
  return 'idle';
}

// 没有 agent 也没有 label 的分屏，用「分屏 N」而不是 w7:p3 这种原始 ID。
function paneDisplayName(pane) {
  if (pane.agent) return pane.agent;
  if (pane.label) return pane.label;
  const match = /p(\d+)$/.exec(String(pane.pane_id || ''));
  return match ? T.paneFallback + ' ' + match[1] : (pane.pane_id || '');
}

function tmuxDotClass(pane) {
  if (pane.dead) return 'blocked';
  if (pane.active) return 'plain';
  return 'hollow';
}
const STATUS_TEXT = {
  working: 'statusWorking',
  blocked: 'statusBlocked',
  done: 'statusDone',
  idle: 'statusIdle'
};

function statusLabel(status) {
  const key = STATUS_TEXT[String(status || '').toLowerCase()];
  return key ? T[key] : String(status || '');
}

function statusLabelForTmux(pane) {
  if (pane.dead) return T.exited;
  if (pane.active) return T.active;
  return '';
}

// agent pane 用 chip 呈现：一颗 chip 就是「一个正在跑的东西」，
// 名称、状态点都在里面，扫一眼就知道谁在忙。
// agent 图标：认识的 agent 用它的官方标识（原样使用，不改色、不拉伸）；
// 不认识的退回通用图形。文件都在插件的 assets/agents/ 下。
const AGENT_MARKS = {
  claude: 'assets/agents/claude.svg',
  codex: 'assets/agents/codex.svg',
  cursor: 'assets/agents/cursor.png'
};

function agentIcon(kind) {
  const icon = document.createElement('span');
  icon.className = 'chip-icon';
  icon.title = kind || 'agent';
  const mark = AGENT_MARKS[String(kind || '').toLowerCase()];
  if (mark) {
    const image = document.createElement('img');
    image.className = 'chip-logo';
    image.src = mark;
    image.alt = '';
    image.draggable = false;
    icon.appendChild(image);
    return icon;
  }
  icon.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M8 1.6l1.7 3.9 3.9 1.7-3.9 1.7L8 12.8 6.3 8.9 2.4 7.2l3.9-1.7z"'
    + ' fill="currentColor"/></svg>';
  return icon;
}

function makeChip(options) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip' + (options.on ? ' on' : '');
  chip.title = options.title || '';
  if (options.icon) chip.appendChild(agentIcon(options.icon));
  const dot = document.createElement('span');
  dot.className = 'dot ' + (options.dotClass || 'unknown');
  chip.appendChild(dot);
  const name = document.createElement('span');
  name.className = 'chip-name';
  name.textContent = options.name;
  chip.appendChild(name);
  if (options.meta) {
    const meta = document.createElement('span');
    meta.className = 'chip-meta';
    meta.textContent = options.meta;
    chip.appendChild(meta);
  }
  // 颜色之外再给一份可读的状态文字：颜色分辨不出时也能判断，
  // 读屏软件也能直接读到完整信息。
  if (options.ariaLabel) chip.setAttribute('aria-label', options.ariaLabel);
  if (options.onSelect) chip.addEventListener('click', options.onSelect);
  return chip;
}

function makeGroup(name, meta, link) {
  const group = document.createElement('div');
  group.className = 'group';
  const label = document.createElement('span');
  label.className = 'group-name';
  label.textContent = name;
  group.appendChild(label);
  if (meta) {
    const extra = document.createElement('span');
    extra.className = 'group-meta';
    extra.textContent = meta;
    group.appendChild(extra);
  }
  if (link) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'group-link';
    back.textContent = link;
    back.addEventListener('click', link.onClick);
    group.appendChild(back);
  }
  return group;
}

// 终端输入框的占位提示跟随语言；输入本身就是终端，没有额外按钮。
function syncTermTarget() {
  $('#term-input').placeholder = T.termPlaceholder;
}

function localize() {
  syncTermTarget();
  // 屏幕阅读器读到的输入框名称也要跟随宿主语言。
  $('#term-input').setAttribute('aria-label', T.terminalInput);
  // 整页语言标记同步：否则 en/ja/ko 用户仍被按中文规则朗读。
  document.documentElement.lang = T.lang;
  // 顶部数据源 tablist 的可访问名同样跟随语言。
  const tabs = document.querySelector('.seg[role="tablist"]');
  if (tabs) tabs.setAttribute('aria-label', T.dataSourceTabs);
  $('#detail-close').setAttribute('aria-label', T.collapse);
  // 按钮的可访问名要说它会做什么，不能用「已更新」这种状态文案。
  $('#refresh').setAttribute('aria-label', T.refreshAction);
  $('#refresh').setAttribute('title', T.refreshAction);
  syncWrapButton();
}

// 终端输出默认自动换行；切到「不换行」可以保住终端原本的列对齐。
let outputWrap = true;

function syncWrapButton() {
  const button = $('#detail-wrap');
  const label = outputWrap ? T.wrapOn : T.wrapOff;
  // 保留按钮里的 SVG，只更新可访问名与状态；图标切换交给 CSS（aria-pressed）。
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.setAttribute('aria-pressed', outputWrap ? 'true' : 'false');
  const output = $('#detail-body');
  output.classList.toggle('nowrap', !outputWrap);
}

// 面板语言加载竞态：旧请求晚回时不能覆盖新请求的结果。
let panelLocaleSeq = 0;

async function loadLocale() {
  const seq = panelLocaleSeq += 1;
  try {
    const response = await fetch('/app-context');
    if (seq !== panelLocaleSeq) return;
    const context = await response.json();
    const ctx = (context && context.context) || {};
    // uiLocale ?? locale 是宿主语言的唯一事实来源；插件没提供的语言回退英文。
    const locale = ctx.uiLocale || ctx.locale;
    T = strings[locale] || strings.en;
  } catch (error) {
    if (seq !== panelLocaleSeq) return;
    T = strings.en;
  }
  localize();
}

// 特殊键直接发给终端：上下（历史）、翻页、Tab、Esc，以及 Ctrl/Meta 组合。
// 退格、删除、左右、Home/End 属于文本编辑，只作用于还没提交的草稿。
function specialKey(event) {
  return lib.specialKey ? lib.specialKey(view, event) : null;
}

function forwardKey(event) {
  const key = specialKey(event);
  if (!key) return false;
  event.preventDefault();
  // 视图与目标在按键这一刻钉住：排队等待期间切了分屏或视图，
  // 按键也必须打到发起时的目标上。
  const pinnedView = view;
  const target = selectedTarget;
  const paneId = selectedPane ? selectedPane.pane_id : null;
  if (pinnedView === 'tmux' && !target) return true;
  if (pinnedView !== 'tmux' && !paneId) return true;
  const scope = (pinnedView === 'tmux' ? 't:' + target : 'h:' + paneId);
  // 草稿连同归属在按键这一刻捕获并取走：不取走的话，连按两次 Tab
  // 会让两个队列项带着同一份草稿，出队后重复发送。
  const draftField = $('#term-input');
  let draft = '';
  let draftFromRestore = false;
  if (draftField && !PENDING_ENTER_KEEP_KEYS[key] && draftField.value) {
    draft = draftField.value;
    // 恢复的文字可能被用户接着编辑（git  后追加 status）：
    // 以前缀判断是否仍源自这次恢复，不能整串相等才算。
    draftFromRestore = Boolean(restoredBoxText[scope])
      && draft.indexOf(restoredBoxText[scope]) === 0;
    consumeFromInput(draftField, draft);
  }
  // 同一终端的操作排队执行：草稿同步、改行按键不能与正在进行的提交交错。
  enqueueForScope(scope, function (epoch) {
    return forwardKeyQueued(key, pinnedView, target, paneId, scope, draft, draftFromRestore, epoch);
  });
  return true;
}

async function forwardKeyQueued(key, pinnedView, target, paneId, scope, draft, draftFromRestore, epoch) {
  // 会改动终端里那行内容的按键（取消 C-c、历史 Up/Down、补全 Tab、
  // 删除 C-u/C-w/C-k/C-d、Esc、M-* 宏等）让恢复记录失效；
  // 但清屏 C-l、移动光标 C-a/C-e、翻滚动条 PPage/NPage 不改内容，
  // 这些键若清掉记录，恢复时会把同一文本再粘一遍。
  if (!PENDING_ENTER_KEEP_KEYS[key]) {
  // 注意：pendingEnterOnly 与 scopeHolds 不在此处清除——取消/改行键
  // 发送成功之前，未确认的那一行可能还原样在终端里；失败时记录要保留。
    // 即将转发会改动终端行的按键：发起时的本地草稿先同步过去，
    // 否则终端行被换掉后旧草稿留着，下一次回车会把它粘到别的内容上。
    // 有未确认的操作（unknown 冻结）：只允许明确的取消键（C-c）通过——
    // 它正是用来清掉那行的；其它键一律拦下并提示先核对，
    // 否则恢复在输入框里的同一草稿会被再粘一次（draftdraft）。
    const isCancelKey = key === 'C-c' || key === 'ctrl+c';
    if (isCancelKey) {
      // 取消就是要把终端里的行丢掉：跳过草稿同步，直接发取消键。
      draft = '';
    }
    if (scopeHolds[scope] && !isCancelKey) {
      // 多个被拦下的按键草稿按入队顺序累积（ABC，不是 CBA），
      // 与提交队列共用 queuedDrafts；切回该分屏时统一交还。
      // 用户已经切到别的分屏时也要保存：草稿在按键时就从输入框取走了，
      // 不存下来就永久丢失。
      if (draft) {
        const prior = queuedDrafts[scope] || '';
        // 多个已排队按键分别失败时都要保留，按输入顺序累积。
        // 只有「这次文字确实是面板刚恢复的那份」才去重：
        // 两份碰巧有相同前缀的独立草稿必须都保留。
        const addition = draftFromRestore && prior && draft.indexOf(prior) === 0
          ? draft.slice(prior.length) : draft;
        queuedDrafts[scope] = prior + addition;
        if (currentScope() === scope) {
          const holdBox = $('#term-input');
          holdBox.value = holdBox.value.indexOf(prior) === 0
            ? queuedDrafts[scope] + holdBox.value.slice(prior.length)
            : queuedDrafts[scope] + holdBox.value;
          restoredBoxText[scope] = holdBox.value;
        }
      }
      renderOutput(T.heldHint);
      return true;
    }
    // 例外：这段文字确认已在终端里（Enter 未确认、恢复到了输入框），
    // 不能再粘一遍，直接发键。
    if (draft && pendingEnterOnly[scope] === draft) {
      // 已在远端，跳过同步。
    } else if (draft) {
      try {
        // 「草稿 + 按键」一次调用：worker 里同一队列任务顺序执行两步，
        // 两个面板不会交错成 A文本、B文本、A键、B键。
        if (pinnedView === 'tmux') {
          await request('tmux_send', {
            target: target, text: draft, keys: [key], server_pid: tmuxServerPid
          });
        } else {
          await request('send', { pane_id: paneId, text: draft, keys: [key] });
        }
        // 草稿与按键已随同一次调用发出，下面不再单独发 key。
        if (!scopeEpochIsCurrent(scope, epoch)) return true;
        if (!PENDING_ENTER_KEEP_KEYS[key]) {
          delete pendingEnterOnly[scope];
          scopeHolds[scope] = 0;
          terminalHasContent[scope] = true;
        }
        await refreshAfterWrite();
        return true;
      } catch (error) {
        if (!scopeEpochIsCurrent(scope, epoch)) return true;
        // 文本已送达、按键失败：不能把整段草稿当没发送又粘一遍——
        // 记「终端有内容」并冻结，让用户核对后空框补发该键。
        const detailEarly = String(error && error.message ? error.message : error);
        if (/(HERDR|TMUX)_STAGE=keys/.test(detailEarly)) {
          terminalHasContent[scope] = true;
          scopeHolds[scope] = holdGeneration += 1;
          // keys 阶段专属语义：文本已在终端，只允许核对后的空 Enter、
          // Ctrl+C 或原按键解冻；任意新文本不能解锁（见 submitLine 的闸门）。
          scopeHoldKind[scope] = 'keys';
          renderOutput(T.heldHint + '（'
            + detailEarly.replace('HERDR_STAGE=keys ', '') + '）');
          return true;
        }
        // 结果未知 = 草稿可能已在终端：冻结并记下「可能有内容」，
        // 不能像确定失败那样只放回输入框让人普通重发。
        if (/HERDR_OUTCOME_UNKNOWN/.test(String(error && error.message ? error.message : error))) {
          terminalHasContent[scope] = true;
          scopeHolds[scope] = holdGeneration += 1;
          scopeHoldKind[scope] = 'unknown';
        }
        // 同步没成功：草稿按归属放回。上一次恢复的还在最前面时接在它
        // 后面（保持输入顺序），否则前置（用户期间续打的部分接在后面）。
        // 用户在请求返回前切到别的分屏时，输入框已经不是这个 scope 的了：
        // 草稿仍要按 scope 存下来，否则这条命令会彻底丢失。
        if (currentScope() !== scope) {
          queuedDrafts[scope] = (queuedDrafts[scope] || '') + draft;
        }
        if (currentScope() === scope) {
          const box = $('#term-input');
          if (box) {
            if (restoredDraft && restoredDraft.scope === scope
                && box.value.indexOf(restoredDraft.text) === 0) {
              box.value = restoredDraft.text + draft + box.value.slice(restoredDraft.text.length);
              restoredDraft.text += draft;
            } else {
              box.value = draft + box.value;
              restoredDraft = { scope: scope, text: draft };
            }
          }
        }
        renderOutput(error.message || T.sendFailed);
        return true;
      }
      if (!scopeEpochIsCurrent(scope, epoch)) return true;
      // 草稿已转移到终端：记下来，之后空输入框的回车可以只补 Enter。
      // 注意不是 pendingEnterOnly——随后的改行按键会改变这行内容，
      // 同一文本恢复粘贴的去重记录不能假装它还原样存在。
      terminalHasContent[scope] = true;
      // 草稿在捕获时已从输入框取走，这里不需要再动它。
    }
  }
  try {
    const allowHeld = key === 'C-c' || key === 'ctrl+c' || key === 'Enter' || key === 'enter';
    if (pinnedView === 'tmux') {
      await request('tmux_send', {
        target: target, keys: [key], allow_held: allowHeld, server_pid: tmuxServerPid
      });
    } else await request('send', { pane_id: paneId, keys: [key] });
    if (!scopeEpochIsCurrent(scope, epoch)) return true;
    // 取消/改行已送达：未确认的那一行不存在了，记录与冻结才解除。
    // 改行键可能已经在终端行里留下内容（Up 调出历史、Tab 补全）：
    // 即便没有本地草稿也记下来，空回车才能把这行提交。
    if (!PENDING_ENTER_KEEP_KEYS[key]) {
      delete pendingEnterOnly[scope];
      scopeHolds[scope] = 0;
      terminalHasContent[scope] = true;
      // 取消成功：那行已经丢掉，之前攒下的草稿与解冻占用一起作废，
      // 否则下一次提交会被旧的 queuedDrafts 拦住。
      if (key === 'C-c' || key === 'ctrl+c') {
        delete queuedDrafts[scope];
        delete scopeHoldKind[scope];
        delete scopeUnlockClaims[scope];
        delete scopeUnlockText[scope];
        delete restoredBoxText[scope];
        delete restoredSubmissionText[scope];
        restoreNextSubmission(scope);
      }
    }
    await refreshAfterWrite();
  } catch (error) {
    if (!scopeEpochIsCurrent(scope, epoch)) return true;
    // 失败或结果未知：保留待核对记录与冻结，新文本不会被放行粘到旧命令上。
    // 改行键本身结果未知时（可能已改、可能没改），同样冻结这个终端。
    if (!PENDING_ENTER_KEEP_KEYS[key]
        && /HERDR_OUTCOME_UNKNOWN/.test(String(error && error.message ? error.message : error))) {
      scopeHolds[scope] = holdGeneration += 1;
      scopeHoldKind[scope] = 'unknown';
    }
    renderOutput(error.message || T.sendFailed);
  }
  return true;
}

// 回车提交这一行：Herdr 的 pane.send_input 本身带回车；tmux 是字面量发送，
// 需要再补一个 Enter。
// 文本已在终端、只欠回车时记在这里：按 scope 存该段文本。
// （单槽会被另一个分屏的晚到回包覆盖，两个 pane 的记录必须互不影响。）
const pendingEnterOnly = {};
// 「终端行里有内容」（草稿刚同步过去、或刚粘过文本）：空输入框的回车
// 只补 Enter。改行按键之后内容形态未知，但空行补一次回车本身无害。
const terminalHasContent = {};
// 同步失败后恢复到输入框的草稿前缀 {scope, text}：连续失败时，
// 后失败的片段要接在前一个恢复后面，保持输入顺序，不能逐次前置。
let restoredDraft = null;
// 不改变终端行内容的直达按键：这些键之后恢复记录仍然有效。
// 两种后端的键名都要列：tmux 是 C-l/PPage，Herdr 是 ctrl+l（没确认翻页键）。
const PENDING_ENTER_KEEP_KEYS = {
  'C-l': true, 'C-a': true, 'C-e': true, PPage: true, NPage: true,
  'ctrl+l': true, 'ctrl+a': true, 'ctrl+e': true
};

// 同一终端的提交/按键串行执行：两条 submitLine 并行时，第二次 paste 可能
// 排在第一次 Enter 前，把两条命令拼成一行或颠倒顺序。按 scope 排队。
const scopeQueues = {};
// 每个 scope 的队列代次：pane 被替换时递增，旧队列里尚未开始的闭包就作废。
const scopeQueueEpochs = {};

// Enter 未确认的终端要冻结后续提交：队列若立刻放行，下一条会清掉
// 待核对记录并把文本粘到仍含上一条的终端行上。补发 Enter 成功或
// 用户切换目标后才解除。
// 冻结代次：每次建立 hold 递增，0 表示没有冻结。用代次而不是布尔/状态值，
// 否则连续两次未确认的回车会被误判成同一个 hold。
let holdGeneration = 0;
const scopeHolds = {};
// 该次冻结的语义（enter / unknown），与代次一一对应。
const scopeHoldKind = {};
// unknown 解冻语义只能被一次提交占用：占用期间别的提交拿不到它，
// 占用者没有真正发出请求时把占用还回去（用户可以重试恢复）。
const scopeUnlockClaims = {};
const scopeUnlockText = {};
let unlockToken = 0;

function releaseUnlock(scope, token) {
  if (token && scopeUnlockClaims[scope] === token) {
    delete scopeUnlockClaims[scope];
    delete scopeUnlockText[scope];
  }
}
// 冻结期间被拦下的按键草稿：按入队顺序累积为一段文本。
const queuedDrafts = {};
// 被新 hold 拦下的独立 Enter 提交：必须保留每条命令的 Enter 边界，
// 恢复时逐条交给用户确认，不能拼成一条命令。
const queuedSubmissions = {};
const restoredSubmissionText = {};
// 最近一次把累积草稿写回输入框的内容：用来区分「用户新打的文字」和
// 「面板刚恢复的同一份文字」，不能只看前缀。
const restoredBoxText = {};

// 排队执行时输入框可能已追加新内容：只去掉已发送的那段前缀，
// 不能把用户排队期间新打的部分也清掉。
function consumeFromInput(field, sent) {
  if (!field) return;
  if (field.value === sent) {
    field.value = '';
  } else if (field.value.indexOf(sent) === 0) {
    field.value = field.value.slice(sent.length);
  }
}

function scopeEpochIsCurrent(scope, epoch) {
  return (scopeQueueEpochs[scope] || 0) === epoch;
}

function enqueueForScope(scope, task) {
  const epoch = scopeQueueEpochs[scope] || 0;
  function runIfCurrent() {
    if (!scopeEpochIsCurrent(scope, epoch)) return undefined;
    return task(epoch);
  }
  const run = (scopeQueues[scope] || Promise.resolve()).then(runIfCurrent, runIfCurrent);
  scopeQueues[scope] = run.then(function () {}, function () {});
  return run;
}

// 写操作已经成功后的刷新（只读）：刷新失败只说明画面没更新，
// 绝不能掉进写失败的 catch（那会把已执行的命令放回输入框让人重复执行）。
async function refreshAfterWrite() {
  try {
    await refreshTerminal(true);
  } catch (error) {
    renderOutput(T.doneRefreshFailed
      + String(error && error.message ? error.message : error));
  }
}

// 切回某个分屏时，把冻结期间被拦下、还没交还给用户的提交放回输入框。
function restoreQueuedDrafts() {
  const scope = currentScope();
  if (!scope) return;
  const box = $('#term-input');
  if (!box) return;
  if (queuedDrafts[scope]) {
    // 框里已经显示着这些草稿时不再重复添加（面板自己回填过一次）。
    const alreadyShown = box.value.indexOf(queuedDrafts[scope]) !== -1;
    if (!alreadyShown) box.value = queuedDrafts[scope] + box.value;
    restoredBoxText[scope] = box.value;
    delete queuedDrafts[scope];
  }
  restoreNextSubmission(scope);
}

function restoreNextSubmission(scope) {
  const queue = queuedSubmissions[scope];
  const box = $('#term-input');
  if (!queue || !queue.length || !box || box.value) return;
  // 一次只把下一条独立提交放回输入框，保留每次 Enter 的边界。
  if (currentScope() !== scope) return;
  box.value = queue.shift();
  if (!queue.length) delete queuedSubmissions[scope];
  restoredSubmissionText[scope] = box.value;
  restoredBoxText[scope] = box.value;
}

// 清掉已经不存在（或同名重建）的分屏的待确认状态。
// 只清「这次成功拿到完整列表」的那个后端：探测失败（权限、超时）
// 不代表分屏消失，不能把仍在运行的分屏的记录也删掉。
function pruneStaleScopeState() {
  const live = {};
  if (view === 'tmux' && tmux && tmux.available === true) {
    for (const pane of tmux.panes || []) live['t:' + tmuxStableTarget(pane)] = true;
  }
  if (view !== 'tmux') {
    for (const pane of state.panes || []) live['h:' + pane.pane_id] = true;
  }
  const covers = function (scope) {
    return scope.charAt(0) === 't' ? Boolean(tmux && tmux.available === true) && view === 'tmux'
      : view !== 'tmux';
  };
  for (const scope of Object.keys(pendingEnterOnly)) {
    if (covers(scope) && !live[scope]) delete pendingEnterOnly[scope];
  }
  for (const scope of Object.keys(terminalHasContent)) {
    if (covers(scope) && !live[scope]) delete terminalHasContent[scope];
  }
  // pane 消失时统一使整个 scope 的待确认状态、尚未开始的队列任务和选中态失效。
  // 如果之后新 pane 复用同一个 %N，旧命令不能从旧队列回调或输入框流过去。
  const allScopes = new Set([
    ...Object.keys(scopeQueues), ...Object.keys(pendingEnterOnly),
    ...Object.keys(terminalHasContent), ...Object.keys(scopeHolds),
    ...Object.keys(queuedDrafts), ...Object.keys(queuedSubmissions),
    ...Object.keys(scopeUnlockClaims), ...Object.keys(restoredBoxText)
  ]);
  for (const scope of allScopes) {
    if (!covers(scope) || live[scope]) continue;
    clearScopeState(scope);
    if (scope.startsWith('t:')) {
      const id = scope.slice(2);
      delete tmuxPaneIdentities[id];
      if (selectedTarget === id) {
        selectedTarget = null;
        const box = $('#term-input');
        if (box) box.value = '';
        restoredDraft = null;
        const detail = $('#detail');
        if (detail) detail.hidden = true;
        renderOutput(T.paneReplaced);
      }
    }
  }
}

// 当前选中目标的标识：tmux 用 target，Herdr 用 pane_id。
function currentScope() {
  if (view === 'tmux') return selectedTarget ? 't:' + selectedTarget : null;
  return selectedPane ? 'h:' + selectedPane.pane_id : null;
}

// 只补一次回车：文本确认已在终端里时用它，绝不重复粘贴。
// 目标用入队时钉住的值：排队期间切了分屏，Enter 不能发到新目标上。
async function sendEnterOnly(scope, pinnedView, target, paneId, epoch) {
  const hadText = pendingEnterOnly[scope] !== undefined ? pendingEnterOnly[scope] : null;
  delete pendingEnterOnly[scope];
  delete terminalHasContent[scope];
  try {
    // Herdr 的键名契约是小写（enter/up/esc…），tmux 才是 Enter。
    if (pinnedView === 'tmux') {
      await request('tmux_send', {
        target: target, keys: ['Enter'], allow_held: true, server_pid: tmuxServerPid
      });
    } else await request('send', { pane_id: paneId, keys: ['enter'] });
    if (epoch !== undefined && !scopeEpochIsCurrent(scope, epoch)) return;
    scopeHolds[scope] = 0;
    delete scopeHoldKind[scope];
    await refreshAfterWrite();
    restoreNextSubmission(scope);
  } catch (error) {
    if (epoch !== undefined && !scopeEpochIsCurrent(scope, epoch)) return;
    // 回车结果未知：恢复同一目标的待提交记录，否则下一次回车什么都不做,
    // 终端里已有的命令就再也提交不了；同时提示先核对终端。
    scopeHolds[scope] = holdGeneration += 1;
    scopeHoldKind[scope] = 'enter';
    // map 记录按 scope 存：无论现在选中哪个分屏都要恢复，
    // 否则回到该终端后既没有可补发的记录、新文本又被冻结拦住。
    terminalHasContent[scope] = true;
    if (hadText !== null) pendingEnterOnly[scope] = hadText;
    renderOutput(T.enterStillUnknown + '（'
      + String(error && error.message ? error.message : T.sendFailed) + '）');
  }
}

function submitLine() {
  const field = $('#term-input');
  const text = field.value;
  // 目标与文本在这一刻钉死：排队/请求期间切了分屏或又输入了内容，
  // 这次提交的内容与目标都不能变。
  const pinnedView = view;
  const target = selectedTarget;
  const paneId = selectedPane ? selectedPane.pane_id : null;
  if (pinnedView === 'tmux' && !target) return;
  if (pinnedView !== 'tmux' && !paneId) return;
  const scope = (pinnedView === 'tmux' ? 't:' + target : 'h:' + paneId);
  const waiting = queuedSubmissions[scope];
  const isPresentedQueuedCommand = restoredSubmissionText[scope] !== undefined;
  const isUnclaimedUnknownRecovery = Boolean(text) && scopeHoldKind[scope] === 'unknown'
    && scopeUnlockClaims[scope] === undefined;
  const isClaimedRecoveryRetry = Boolean(text) && scopeUnlockClaims[scope] !== undefined
    && scopeUnlockText[scope] === text;
  if (waiting && waiting.length && !isPresentedQueuedCommand && text
      && !isUnclaimedUnknownRecovery && !isClaimedRecoveryRetry) {
    // 旧的排队命令优先；新输入 D 追加在 B/C 后面，不能越过它们执行。
    waiting.push(text);
    consumeFromInput(field, text);
    restoreNextSubmission(scope);
    renderOutput(T.heldHint);
    return;
  }
  // 当前显示的 queued command 已被用户确认提交，清除标记；下一条仍按队列恢复。
  if (isPresentedQueuedCommand) delete restoredSubmissionText[scope];
  // 按下回车这一刻就把草稿从输入框取走：否则排队期间输入的第二条
  // 会和没清掉的第一条拼在一起，被下一次提交重复捕获。
  restoredDraft = null;
  consumeFromInput(field, text);
  // 这个终端有一次未确认的回车：只拦「新文本」提交——空框回车
  // 和同一文本的恢复必须放行，否则永远无法补发。草稿放回输入框。
  const isResume = !text || pendingEnterOnly[scope] === text;
  // 先在清空前记下入队时的冻结代次与语义（核对过的恢复要靠它解冻 worker 队列）。
  const holdAtEnqueue = scopeHolds[scope] || 0;
  // unknown 解冻语义已被别的提交占用时不再捕获：只有用户核对过的那一次
  // 能带着 allow_held 通过，紧跟着的下一条提交不能继承。
  const unlockClaimed = scopeUnlockClaims[scope] !== undefined;
  const kindAtEnqueue = unlockClaimed ? null : (scopeHoldKind[scope] || null);
  let unlockTokenValue = 0;
  // unknown 冻结：失败时已提示先核对终端，这次提交按完整重发放行。
  // 这里只「占用」解冻语义，真正发出恢复请求之后才消费它——
  // 中途被挡下（草稿不匹配、出现新冻结）时还回去，用户可以重试。
  if (kindAtEnqueue === 'unknown') {
    scopeHolds[scope] = 0;
    unlockTokenValue = unlockToken += 1;
    scopeUnlockClaims[scope] = unlockTokenValue;
    scopeUnlockText[scope] = text;
  }
  if (scopeHolds[scope] && !isResume) {
    if (currentScope() === scope) {
      const box = $('#term-input');
      if (box && !box.value) box.value = text;
    }
    renderOutput(T.heldHint);
    return;
  }
  // 同一终端的「文本 + Enter」串行执行：两条提交并行时，第二次 paste
  // 可能排在第一次 Enter 前，把两条命令拼成一行或颠倒顺序。
  enqueueForScope(scope, function (epoch) {
    return submitLineQueued(text, pinnedView, target, paneId, scope, holdAtEnqueue, kindAtEnqueue,
      unlockTokenValue, epoch, isPresentedQueuedCommand);
  });
}

async function submitLineQueued(text, pinnedView, target, paneId, scope, holdAtEnqueue,
  kindAtEnqueue, unlockTokenValue, epoch, wasQueuedSubmission) {
  const field = $('#term-input');
  if (!scopeEpochIsCurrent(scope, epoch)) return;
  // 入队之后才建立的 hold 要挡住所有预先排队的任务，包括空回车：
  // 用户还没看到提示，不能替他补发。入队时已存在的 hold 才是确认过的恢复。
  // 新 scope 上 scopeHolds[scope] 是 undefined：先归一到 0 再比较，
  // 否则「没有冻结」会被误判成新冻结，首次提交全被拦下。
  const currentHold = scopeHolds[scope] || 0;
  const holdIsNew = currentHold !== 0 && currentHold !== holdAtEnqueue;
  // 入队之后才建立的 hold 拦住**所有**预排任务：同文本也不例外——
  // 两次相同命令里，后一条可能在前一条建立 hold 之前就排好了。
  // 只有在看到 hold 之后才重新入队的提交才是恢复（那时 holdAtEnqueue
  // 已经等于当前代次，holdIsNew 本来就是 false）。
  if (holdIsNew) {
    // 每次 Enter 提交是独立命令：保留条目及其边界，不能拼成一个文本。
    if (text) (queuedSubmissions[scope] || (queuedSubmissions[scope] = [])).push(text);
    // 输入框保留更早的失败命令；本条在独立队列里逐条恢复，避免丢掉 Enter 边界。
    // 不把两条独立提交拼入同一输入行。
    releaseUnlock(scope, unlockTokenValue);
    renderOutput(T.heldHint);
    return;
  }
  // 之前被拦下的累积草稿：只有用户看到并重新提交它（本次文本以它开头）
  // 才算交还；否则连同本次文本按原顺序放回输入框，绝不能静默丢掉。
  const pending = queuedDrafts[scope];
  if (pending) {
    // 空输入框回车是当前未确认操作的恢复路径：先放行，
    // 被拦下的后续草稿继续留在 map 里，之后切分屏/再提交时交还。
    const resuming = !text
      && (pendingEnterOnly[scope] !== undefined || terminalHasContent[scope]);
    if (text && text.indexOf(pending) === 0) {
      delete queuedDrafts[scope];
      delete restoredBoxText[scope];
    } else if (!resuming) {
      if (currentScope() === scope) {
        // 顺序必须和提交顺序一致：框里已经躺着更早提交的失败内容时
        // （前面那次结果未知、已回填到输入框），新排队的草稿要排在它后面，
        // 不能前置拼成「ba」这样的倒序命令。
        const boxHasEarlier = restoredBoxText[scope] !== undefined
          && field.value.indexOf(restoredBoxText[scope]) === 0;
        // 框里已经显示着这些草稿时不再重复添加。
        const pendingPart = field.value.indexOf(pending) !== -1 ? '' : pending;
        field.value = boxHasEarlier
          ? field.value + pendingPart + text
          : pendingPart + text + field.value;
        // 与另两条恢复路径一致：登记恢复 marker，
        // 否则之后按 Tab/Up 会把刚回填的整段当成新草稿重复累积。
        restoredBoxText[scope] = field.value;
      }
      releaseUnlock(scope, unlockTokenValue);
      renderOutput(T.heldHint);
      return;
    }
  }
  // 空输入框的这次回车就是一次 Enter：终端里可能有 CLI 提示
  // （“Press Enter to continue”），侧栏拦下了按键，必须由这里转出去。
  if (!text) {
    try {
      await sendEnterOnly(scope, pinnedView, target, paneId, epoch);
    } finally {
      // 补发回车不消费解冻语义：结束路径都要把占用还回去，
      // 否则这个分屏之后再次结果未知时拿不到 unknown 标记。
      releaseUnlock(scope, unlockTokenValue);
    }
    return;
  }
  // 恢复语义：这段文本已在终端里（上次粘贴后 Enter 未确认，或草稿刚被
  // 同步过去），同一目标同一文本的提交只补 Enter，不再粘一遍。
  if (pendingEnterOnly[scope] === text) {
    delete pendingEnterOnly[scope];
    // 输入框在入队时已消费过这段文字，这里不能再扣：
    // 框里可能是用户刚输入的、带相同前缀的新命令。
    try {
      if (pinnedView === 'tmux') {
        await request('tmux_send', {
          target: target, keys: ['Enter'], allow_held: true, server_pid: tmuxServerPid
        });
      } else await request('send', { pane_id: paneId, keys: ['enter'] });
      if (!scopeEpochIsCurrent(scope, epoch)) return;
      scopeHolds[scope] = 0;
      delete scopeHoldKind[scope];
      releaseUnlock(scope, unlockTokenValue);
      await refreshAfterWrite();
      restoreNextSubmission(scope);
    } catch (error) {
      if (!scopeEpochIsCurrent(scope, epoch)) return;
      scopeHolds[scope] = holdGeneration += 1;
      scopeHoldKind[scope] = 'enter';
      pendingEnterOnly[scope] = text;
      // 只在仍选中同一目标时补回输入框，别把 A 的命令写进 B 的框。
      if (currentScope() === scope && !field.value) field.value = text;
      renderOutput(error.message || T.sendFailed);
    }
    return;
  }
  delete pendingEnterOnly[scope];
  delete terminalHasContent[scope];
  // 只有入队时已处于 unknown 冻结（用户看过提示、核对过终端）的完整重发
  // 才带 allow_held；tmux 与 Herdr 两条路径共用。
  const unlockedResend = kindAtEnqueue === 'unknown';
  try {
    if (pinnedView === 'tmux') {
      // 一个 RPC、worker 的一个队列任务里完成「文本 + Enter」：
      // 另一个面板的文本不会再插到这两步之间。
      let submitError = null;
      try {
        await request('tmux_submit', {
          target: target, text: text, allow_held: unlockedResend, server_pid: tmuxServerPid
        });
        if (!scopeEpochIsCurrent(scope, epoch)) return;
      } catch (error) {
        submitError = error;
      }
      if (!scopeEpochIsCurrent(scope, epoch)) return;
      const submitDetail = submitError
        ? String(submitError.message || submitError) : '';
      if (submitError && /TMUX_STAGE=enter/.test(submitDetail)) {
        // 文本已进终端、Enter 结果未知：只补回车，不重贴文本。
        // 本次的解冻占用在这里结束，否则之后的写入永远拿不到解冻标记。
        releaseUnlock(scope, unlockTokenValue);
        pendingEnterOnly[scope] = text;
        scopeHolds[scope] = holdGeneration += 1;
        scopeHoldKind[scope] = 'enter';
        // 文本阶段已成功：这条命令已在终端里，只差 Enter。它不再是
        // 「未发送的队列项」，绝不能重新进 queuedSubmissions——补发 Enter
        // 成功后恢复队列时会把它当成未发送命令再显示出来。
        // 保留排队身份标记：输入框里的就是终端里的那条命令，下次回车按
        // 「只补 Enter」走，不会被当成新命令排到 C 后面。不入队：文本已
        // 在终端里，补发成功后不能再把它当成未发送命令恢复出来。
        if (currentScope() === scope && !field.value) {
          field.value = text;
          if (wasQueuedSubmission) restoredSubmissionText[scope] = text;
        }
        renderOutput(T.enterUnconfirmed + '（' + submitDetail.replace('TMUX_STAGE=enter ', '') + '）');
        return;
      }
      if (submitError) {
        // 文本阶段（或整段结果未知）：交给外层 catch 的既有语义处理。
        throw new Error(submitDetail.replace(/TMUX_STAGE=text(_failed)? /, ''));
      }
      scopeHolds[scope] = 0;
      // 解冻语义在请求真正发出之后才消费：发不出去（中途被挡下）就还回去，
      // 用户改完文字重试时仍然能用它解冻 worker 的队列。
      delete scopeHoldKind[scope];
      releaseUnlock(scope, unlockTokenValue);
      await refreshAfterWrite();
      restoreNextSubmission(scope);
    } else {
      // submit = pane.send_input，自带回车；pane.send_text 只打字不执行。
      await request('submit', {
        pane_id: paneId, text: text, allow_held: unlockedResend
      });
      if (!scopeEpochIsCurrent(scope, epoch)) return;
      scopeHolds[scope] = 0;
      delete scopeHoldKind[scope];
      releaseUnlock(scope, unlockTokenValue);
      await refreshAfterWrite();
      restoreNextSubmission(scope);
    }
  } catch (error) {
    if (!scopeEpochIsCurrent(scope, epoch)) return;
    // 第一段的失败走这里。结果未知 = 文本可能已粘进终端：
    // 和 Enter 未确认一样冻结这个终端，直到用户核对或取消；
    // 确定失败才只是恢复草稿。只在仍选中同一目标时回填。
    const detail = String(error && error.message ? error.message : error);
    if (/HERDR_OUTCOME_UNKNOWN/.test(detail)) {
      // 结果未知 ≠ 文字已在终端里：不能建「只补回车」的记录
      // （否则核对后发现没输入，重发同一段文字却只发了 Enter）。
      // 记「终端可能有内容」供空框回车补发，并冻结为 unknown：
      // 用户核对后再提交会按完整重发放行（见 submitLine 的闸门）。
      // 单槽记录：请求返回时用户可能已在另一个分屏操作，
      // 不能覆盖那个分屏的记录。
      terminalHasContent[scope] = true;
      scopeHolds[scope] = holdGeneration += 1;
      scopeHoldKind[scope] = 'unknown';
    }
    // 被消费的提交不能凭空消失：按 scope 单独记下来（不覆盖用户正在输入的
    // 新内容），用户核对后可以重试或取回原命令。
    // 已经放回输入框的文字不再另存一份，避免同一段文字出现两处。
    const restoredToBox = currentScope() === scope && !field.value;
    if (restoredToBox) {
      field.value = text;
      // 登记 marker：后面的排队草稿要排在这条失败内容之后，
      // 顺序不能反。
      restoredBoxText[scope] = text;
      if (wasQueuedSubmission) restoredSubmissionText[scope] = text;
    } else if (wasQueuedSubmission) {
      // 失败的队列头仍排在 C 等后续项之前；输入框里新打的文字会在之后入队。
      queuedSubmissions[scope] = [text].concat(queuedSubmissions[scope] || []);
    } else if (!queuedDrafts[scope]) queuedDrafts[scope] = text;
    releaseUnlock(scope, unlockTokenValue);
    renderOutput(error.message || T.sendFailed);
  }
}

// 重读当前 pane 的画面；不清空输入框——发送返回前用户可能已经开始打下一条。
async function refreshTerminal(rethrow) {
  const token = readToken + 1;
  readToken = token;
  try {
    const result = view === 'tmux'
      ? await request('tmux_read', { target: selectedTarget })
      : await request('read', { pane_id: selectedPane.pane_id, source: 'visible', lines: 80 });
    if (token !== readToken) return;
    renderOutput(result.text || T.noOutput);
  } catch (error) {
    if (token !== readToken) return;
    // 写后调用（refreshAfterWrite）要拿得到失败，才能提示「操作已完成」，
    // 否则用户只看到读取失败，可能把已执行的命令重新提交。
    if (rethrow) throw error;
    renderOutput(error.message || T.readFailed);
  }
}

// --- Herdr 视图 ----------------------------------------------------------

function renderHerdr() {
  const list = $('#list');
  list.textContent = '';
  if (!state.workspaces.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = T.noWorkspaces;
    list.appendChild(empty);
    return;
  }
  for (const workspace of state.workspaces) {
    const panes = state.panes.filter(function (item) {
      return item.workspace_id === workspace.workspace_id;
    });
    const meta = [panes.length + ' ' + T.panes];
    if (workspace.focused) meta.push(T.focused);
    list.appendChild(makeGroup(workspace.label || workspace.workspace_id, meta.join(' · ')));

    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const pane of panes) {
      const name = pane.agent ? (dirName(pane.cwd) || paneDisplayName(pane)) : paneDisplayName(pane);
      chips.appendChild(makeChip({
        icon: pane.agent ? pane.agent : null,
        name: name,
        meta: pane.agent ? statusLabel(pane.agent_status) : (pane.cwd ? dirName(pane.cwd) : pane.title || ''),
        dotClass: paneDotClass(pane),
        title: [pane.agent, pane.title, pane.cwd, pane.pane_id].filter(Boolean).join(' · '),
        // 无障碍名以可见名称开头，再补 agent、状态、标题和 pane id。
        ariaLabel: [name, pane.agent, statusLabel(pane.agent_status), pane.title, pane.pane_id]
          .filter(Boolean).join(' · '),
        on: Boolean(selectedPane && selectedPane.pane_id === pane.pane_id),
        onSelect: function () { openPane(pane); }
      }));
    }
    list.appendChild(chips);
  }
}

async function refreshHerdr(token) {
  const snapshot = await request('state');
  // 先判过期再写 state：否则旧请求最后返回时已经把列表画成旧快照了。
  if (token !== undefined && token !== refreshToken) return;
  state = snapshot;
  renderHerdr();
}

// 详情头部：状态、标题、目录和发送目标。刷新后按 pane_id 重绑时也走这里，
// 否则列表显示新状态、详情卡还停在旧值。
function renderHerdrDetail(pane) {
  $('#detail-title').textContent = pane.title || dirName(pane.cwd) || paneDisplayName(pane);
  $('#detail-sub').textContent = [pane.agent, pane.cwd]
    .filter(Boolean).join(' · ');
  setDetailState(paneDotClass(pane), statusLabel(pane.agent_status));
  // 原始 pane id 只在真正能操作它的地方出现：发送目标行。
  setComposerTarget([paneDisplayName(pane), pane.pane_id].filter(Boolean).join(' · '));
}

async function openPane(pane) {
  // 换目标就丢掉草稿：A 里没发出去的命令不能在回车时打到 B 上。
  const changed = !selectedPane || selectedPane.pane_id !== pane.pane_id;
  selectedPane = pane;
  if (changed) {
    // 输入框清空，但各 scope 的待确认状态保留：切走并没有取消
    // 那个终端里待提交的行，回来后的恢复路径还要用。
    $('#term-input').value = '';
    restoredDraft = null;
    restoreQueuedDrafts();
  }
  readToken += 1;
  const token = readToken;
  renderHerdr();
  $('#detail').hidden = false;
  renderHerdrDetail(pane);
  renderOutput('');
  $('#detail-body').textContent = T.loading;
  try {
    const result = await request('read', { pane_id: pane.pane_id, source: 'visible', lines: 80 });
    if (token !== readToken) return;
    renderOutput(result.text || T.noOutput);
  } catch (error) {
    if (token !== readToken) return;
    renderOutput(error.message || T.readFailed);
  }
}

// --- tmux 视图 -----------------------------------------------------------

function renderTmux() {
  const list = $('#list');
  list.textContent = '';

  const sessions = (tmux && tmux.sessions) || [];
  const panes = (tmux && tmux.panes) || [];

  if (!tmux.available) {
    // available:false 不只是「没装」：权限、超时、-V 执行失败也会走到这里。
    // 没装 → 四语言的安装提示；其它情况 → 故障标题 + 具体原因（worker 返回的 message）。
    const notInstalled = tmux.reason === 'not-installed';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = notInstalled ? T.tmuxMissing : T.tmuxBroken;
    list.appendChild(empty);
    const note = document.createElement('div');
    note.className = 'empty';
    note.textContent = notInstalled ? T.tmuxMissingHint : (tmux.message || T.tmuxBrokenHint);
    list.appendChild(note);
    return;
  }

  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = T.noTmuxSessions;
    list.appendChild(empty);
    return;
  }

  list.appendChild(makeGroup(
    'tmux ' + (tmux.version || ''),
    sessions.length + ' ' + T.sessions + ' · ' + panes.length + ' ' + T.panes,
    tmuxFilter ? { text: T.allSessions, onClick: function () { tmuxFilter = null; renderTmux(); } } : null
  ));

  const shown = tmuxFilter
    ? sessions.filter(function (s) { return s.name === tmuxFilter; })
    : sessions;

  for (const session of shown) {
    const meta = [session.windows + ' ' + T.windows];
    if (session.attached) meta.push(T.attached);
    list.appendChild(makeGroup(session.name, meta.join(' · ')));

    const sessionPanes = panes.filter(function (pane) { return pane.session === session.name; });
    if (!sessionPanes.length) {
      const none = document.createElement('div');
      none.className = 'empty';
      none.textContent = T.noPanes;
      list.appendChild(none);
      continue;
    }
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const pane of sessionPanes) {
      chips.appendChild(makeChip({
        name: pane.target,
        icon: null,
        dotClass: tmuxDotClass(pane),
        meta: statusLabelForTmux(pane) || [pane.window_name, pane.command].filter(Boolean).join(' · '),
        title: [pane.path, pane.target].filter(Boolean).join(' · '),
        ariaLabel: [pane.target, statusLabelForTmux(pane), pane.command, pane.path]
          .filter(Boolean).join(' · '),
        on: selectedTarget === tmuxStableTarget(pane),
        onSelect: function () { openTmuxPane(pane); }
      }));
    }
    list.appendChild(chips);
  }
}

// tmux 分屏身份：pane id 会被复用的 tmux server 重启后重复使用，
// 用会话名 + 会话创建时间区分「同一个 pane id，不同的进程」。
const tmuxPaneIdentities = {};

function tmuxPaneIdentity(pane, serverGeneration) {
  const id = tmuxStableTarget(pane);
  if (!id) return null;
  // 只用「pane id + server 代次」：会话改名、分屏移动都不改变它，
  // 而 tmux server 重启（复用 %0 这类 pane id）一定会换一代。
  return [id, String(serverGeneration || '')].join('|');
}

// 某个 scope 的全部待确认状态作废（分屏被重建、被替换）。
function clearScopeState(scope) {
  scopeQueueEpochs[scope] = (scopeQueueEpochs[scope] || 0) + 1;
  delete scopeQueues[scope];
  delete pendingEnterOnly[scope];
  delete terminalHasContent[scope];
  delete scopeHolds[scope];
  delete scopeHoldKind[scope];
  delete queuedDrafts[scope];
  delete queuedSubmissions[scope];
  delete restoredSubmissionText[scope];
  delete scopeUnlockClaims[scope];
  delete scopeUnlockText[scope];
  delete restoredBoxText[scope];
}

async function refreshTmux(token) {
  const stale = function () { return token !== undefined && token !== refreshToken; };
  let next;
  try {
    next = await request('tmux_state', tmuxFilter ? { session: tmuxFilter } : {});
  } catch (error) {
    // 带 filter 时那个 session 可能刚好退出：退回全部 session 再试一次。不能
    // 让面板停在错误态——那时「全部 session」按钮还没渲染，用户点不回来。
    if (!tmuxFilter) throw error;
    if (stale()) return;
    tmuxFilter = null;
    next = await request('tmux_state', {});
  }
  if (stale()) return;
  const sessions = (next && next.sessions) || [];
  // pane id 被复用（tmux server 重启）时，旧分屏的待确认状态必须作废：
  // 否则旧命令会被恢复到新进程里，或被误判成只需补 Enter。
  // server 代次：优先用 tmux server 的进程号——它只在 server 重启时变化，
  // 开/关会话、改名、移动分屏都不影响。取不到时退回会话创建时间。
  let serverGeneration = next && next.server_pid ? String(next.server_pid) : '';
  if (!serverGeneration) {
    for (const session of sessions) {
      const created = String(session.created || '');
      if (created && (serverGeneration === '' || Number(created) > Number(serverGeneration))) {
        serverGeneration = created;
      }
    }
  }
  const seen = {};
  for (const pane of (next && next.panes) || []) {
    const id = tmuxStableTarget(pane);
    if (!id) continue;
    const identity = tmuxPaneIdentity(pane, serverGeneration);
    seen[id] = identity;
    const before = tmuxPaneIdentities[id];
    if (before !== undefined && before !== identity) {
      clearScopeState('t:' + id);
      // 旧 pane 的编辑状态也要作废：详情不能再绑到新进程上，
      // 输入框里没发出去的草稿不能被下一次回车发到新 pane。
      if (selectedTarget === id) {
        selectedTarget = null;
        const box = $('#term-input');
        if (box) box.value = '';
        restoredDraft = null;
        const detail = $('#detail');
        if (detail) detail.hidden = true;
        renderOutput(T.paneReplaced);
      }
    }
  }
  for (const id of Object.keys(tmuxPaneIdentities)) {
    if (!(id in seen)) delete tmuxPaneIdentities[id];
  }
  for (const id of Object.keys(seen)) tmuxPaneIdentities[id] = seen[id];
  tmux = next;
  tmuxServerPid = next && next.server_pid !== undefined ? next.server_pid : null;
  if (tmuxFilter && !sessions.some(function (s) { return s.name === tmuxFilter; })) {
    tmuxFilter = null;
  }
  renderTmux();
}

function renderTmuxDetail(pane) {
  $('#detail-title').textContent = pane.target;
  $('#detail-sub').textContent = [pane.window_name, pane.command, pane.path]
    .filter(Boolean).join(' · ');
  setDetailState(tmuxDotClass(pane), statusLabelForTmux(pane));
  setComposerTarget(tmuxStableTarget(pane));
}

async function openTmuxPane(pane) {
  // 换目标就丢掉草稿：A 里没发出去的命令不能在回车时打到 B 上。
  const stable = tmuxStableTarget(pane);
  const changed = selectedTarget !== stable;
  selectedTarget = stable;
  if (changed) {
    // 输入框清空，但各 scope 的待确认状态保留：切走并没有取消
    // 那个终端里待提交的行，回来后的恢复路径还要用。
    $('#term-input').value = '';
    restoredDraft = null;
    restoreQueuedDrafts();
  }
  readToken += 1;
  const token = readToken;
  renderTmux();
  $('#detail').hidden = false;
  renderTmuxDetail(pane);
  $('#term-input').focus();
  renderOutput('');
  $('#detail-body').textContent = T.loading;
  try {
    const result = await request('tmux_read', { target: tmuxStableTarget(pane) });
    if (token !== readToken) return;
    renderOutput(result.text || T.noOutput);
  } catch (error) {
    if (token !== readToken) return;
    renderOutput(error.message || T.readFailed);
  }
}

// --- 共用 ---------------------------------------------------------------

// 切换视图会让进行中的刷新作废：旧结果回来时视图可能已经变了。
let refreshToken = 0;
// 正在刷新时不要再开新的：否则快照慢于轮询间隔（15 秒）时，
// 每次轮询都会把上一个有效结果判成过期，面板永远停在「刷新中」。
let refreshRunning = false;

// force = 视图切换这类必须立刻开始的刷新（允许作废进行中的那次）。
async function refresh(force) {
  if (refreshRunning && !force) return;
  refreshRunning = true;
  const status = $('#status');
  // 每次刷新都领一个新序号：上一次刷新若最后返回，就会被判定为过期，
  // 不会把新列表覆盖成旧快照。
  refreshToken += 1;
  const startedView = view;
  const token = refreshToken;
  const stale = function () { return view !== startedView || token !== refreshToken; };
  status.textContent = T.refreshing;
  try {
    if (view === 'tmux') await refreshTmux(token);
    else await refreshHerdr(token);
    if (stale()) return;
    // 清理已消失分屏的待确认状态：tmux 的 target 只是位置
    // （session:window.pane），同名重建不能继承旧分屏的恢复记录，
    // 否则新分屏的同文本提交会被误判成「只补回车」。
    pruneStaleScopeState();
    // 详情卡开着的时候，先按 id 把选中对象换成最新的一份并刷新头部，
    // 再重读正文：否则列表显示新状态、详情卡还是旧值。
    if (view === 'tmux') {
      if (selectedTarget) {
        const fresh = ((tmux && tmux.panes) || []).find(function (pane) {
          return tmuxStableTarget(pane) === selectedTarget;
        });
        // 分屏已经没了：关掉详情，别继续对着无效目标发输入。
        if (fresh) renderTmuxDetail(fresh);
        else closeDetail();
      }
    } else if (selectedPane) {
      const fresh = (state.panes || []).find(function (pane) {
        return pane.pane_id === selectedPane.pane_id;
      });
      if (fresh) {
        selectedPane = fresh;
        renderHerdrDetail(fresh);
      } else {
        closeDetail();
      }
    }
    const hasOpenDetail = view === 'tmux' ? selectedTarget : selectedPane;
    if (hasOpenDetail) await refreshTerminal();
    if (stale()) return;
    status.textContent = T.updated;
  } catch (error) {
    if (stale()) return;
    status.textContent = error.message || T.refreshFailed;
  } finally {
    // 只有自己仍是最新那次刷新时才解除占位；
    // 被 force 作废的旧刷新不能把新刷新的占位清掉。
    if (token === refreshToken) refreshRunning = false;
  }
}


// 宽字符单独占 2 个等宽单元格（和真实终端的口径一致），按完整显示字符分组，
// 组合 emoji 不会被拆开；内容大也不裁剪，只是宽字符节点有预算。
const WIDE_CELL_BUDGET = 20000;

function renderOutput(text) {
  const body = $('#detail-body');
  body.textContent = '';
  if (!text) return;
  const source = String(text);
  if (!WIDE_CHAR.test(source)) {
    // 没有宽字符：整段按纯文本渲染，一个节点都不建。
    body.appendChild(document.createTextNode(source));
    return;
  }
  const fragment = document.createDocumentFragment();
  let plain = '';
  let budget = WIDE_CELL_BUDGET;
  const flush = function () {
    if (!plain) return;
    fragment.appendChild(document.createTextNode(plain));
    plain = '';
  };
  for (const unit of graphemes(source)) {
    if (budget > 0 && isWideGrapheme(unit)) {
      flush();
      budget -= 1;
      const cell = document.createElement('span');
      cell.className = 'wide';
      cell.textContent = unit;
      fragment.appendChild(cell);
    } else {
      plain += unit;
    }
  }
  flush();
  body.appendChild(fragment);
}

function setDetailState(dotClass, label) {
  $('#detail-state-dot').className = 'dot ' + dotClass;
  $('#detail-state-text').textContent = label || '';
  $('#detail-state').hidden = !label;
}

function setComposerTarget(text) {
  $('#composer-target').textContent = text ? (T.sendingTo + text) : '';
}

function closeDetail() {
  $('#detail').hidden = true;
  selectedPane = null;
  selectedTarget = null;
  restoredDraft = null;
  readToken += 1;
  if (view === 'tmux') renderTmux();
  else renderHerdr();
}

function setView(next) {
  refreshToken += 1;
  view = next;
  selectedPane = null;
  selectedTarget = null;
  closeDetail();
  document.querySelectorAll('[data-view]').forEach(function (button) {
    const on = button.getAttribute('data-view') === view;
    button.classList.toggle('on', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  syncTermTarget();
  refresh(true);
}

// 不能直接把 refresh 当 handler：浏览器会把 MouseEvent 当 force 传进去，
// 点击就会绕过「有刷新在跑就跳过」的合并保护。
$('#refresh').addEventListener('click', function () { refresh(); });
$('#detail-close').addEventListener('click', closeDetail);
$('#detail-wrap').addEventListener('click', function () {
  outputWrap = !outputWrap;
  syncWrapButton();
});
$('#term-input').addEventListener('keydown', function (event) {
  // 中文/日文/韩文输入法组字时的回车是确认候选词，不能当成提交；
  // keyCode 229 兼容仍在用它的浏览器。
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitLine();
    return;
  }
  forwardKey(event);
});
document.querySelectorAll('[data-view]').forEach(function (button) {
  button.addEventListener('click', function () { setView(button.getAttribute('data-view')); });
});

channel.addEventListener('message', function (event) {
  const message = event.data;
  if (!message) return;
  if (message.type === 'herdr-event') {
    if (view === 'herdr') refresh();
    return;
  }
  // 宿主语言变了就跟着换文案。
  if (message.type === 'host-context-changed') {
    loadLocale().then(function () { refresh(); }, function () { refresh(); });
  }
});

// 先拿到语言再首次刷新：否则 /app-context 慢一点，列表与详情会先渲染成英文，
// 要等下一次刷新才纠正。语言变化后也重绘当前视图。
loadLocale().then(function () { refresh(); }, function () { refresh(); });
setInterval(refresh, 15000);
