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
let selectedTarget = null;

// 每次读取带一个序号：晚到的旧结果不能盖掉用户已经选中的另一个 pane。
let readToken = 0;

// 面板这一层必须晚于后端：普通写请求的 worker 预算是 45 秒、宿主是 70 秒，
// 面板若也是 45 秒就会先报「插件未响应」并丢掉稍后到达的「结果未知」，
// 用户重试可能把命令执行两次。快照的宿主预算是 45 秒，也一起覆盖。
const PANEL_REQUEST_TIMEOUT_MS = 80000;
// 这些动作会把内容写进终端/后端：80 秒超时只代表「没收到回包」，
// 不代表「没执行」，必须按结果未知处理，不能报普通失败让人直接重试。
const PANEL_WRITE_ACTIONS = { tmux_send: true, submit: true, send: true, prompt: true };

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
        ? 'HERDR_OUTCOME_UNKNOWN: 面板请求超时（' + action + '）：请求可能已执行，'
          + '请先在终端里核对实际状态，再决定是否重试。'
        : '插件未响应'));
    }, PANEL_REQUEST_TIMEOUT_MS);
    function onMessage(event) {
      const message = event.data;
      if (!message || message.type !== 'panel-response' || message.reqId !== reqId) return;
      if (settled) return;
      settled = true;
      cleanup();
      if (message.ok) resolve(message.data);
      else reject(new Error(message.message || '操作失败'));
    }
    channel.addEventListener('message', onMessage);
    channel.postMessage(Object.assign({ type: 'panel-request', reqId: reqId, action: action }, payload || {}));
  });
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

async function loadLocale() {
  try {
    const response = await fetch('/app-context');
    const context = await response.json();
    const ctx = (context && context.context) || {};
    // uiLocale ?? locale 是宿主语言的唯一事实来源；插件没提供的语言回退英文。
    const locale = ctx.uiLocale || ctx.locale;
    T = strings[locale] || strings.en;
  } catch (error) {
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
  // 同一终端的操作排队执行：草稿同步、改行按键不能与正在进行的提交交错。
  enqueueForScope(scope, function () {
    return forwardKeyQueued(key, pinnedView, target, paneId, scope);
  });
  return true;
}

async function forwardKeyQueued(key, pinnedView, target, paneId, scope) {
  // 会改动终端里那行内容的按键（取消 C-c、历史 Up/Down、补全 Tab、
  // 删除 C-u/C-w/C-k/C-d、Esc、M-* 宏等）让恢复记录失效；
  // 但清屏 C-l、移动光标 C-a/C-e、翻滚动条 PPage/NPage 不改内容，
  // 这些键若清掉记录，恢复时会把同一文本再粘一遍。
  if (!PENDING_ENTER_KEEP_KEYS[key]) {
    pendingEnterOnly = null;
    // 即将转发会改动终端行的按键：输入框里还有本地草稿就先同步过去，
    // 否则终端行被换掉后旧草稿留着，下一次回车会把它粘到别的内容上。
    const draftField = $('#term-input');
    const draft = draftField ? draftField.value : '';
    if (draft) {
      try {
        if (pinnedView === 'tmux') await request('tmux_send', { target: target, text: draft });
        else await request('send', { pane_id: paneId, text: draft });
      } catch (error) {
        renderOutput(error.message || T.sendFailed);
        return true;
      }
      // 草稿已转移到终端：记下来，之后空输入框的回车可以只补 Enter。
      // 注意不是 pendingEnterOnly——随后的改行按键会改变这行内容，
      // 同一文本恢复粘贴的去重记录不能假装它还原样存在。
      terminalHasContent = { scope: scope };
      // 只有还停在这个分屏时才动输入框，且只去掉已同步的那段：
      // 等待期间切了目标、或用户又接着输入了，都不能误删。
      if (currentScope() === scope) consumeFromInput(draftField, draft);
    }
  }
  try {
    if (pinnedView === 'tmux') await request('tmux_send', { target: target, keys: [key] });
    else await request('send', { pane_id: paneId, keys: [key] });
    await refreshTerminal();
  } catch (error) {
    renderOutput(error.message || T.sendFailed);
  }
  return true;
}

// 回车提交这一行：Herdr 的 pane.send_input 本身带回车；tmux 是字面量发送，
// 需要再补一个 Enter。
// 文本已在终端、只欠回车时记在这里：{scope, text}。
let pendingEnterOnly = null;
// 「终端行里有内容」（草稿刚同步过去、或刚粘过文本）：空输入框的回车
// 只补 Enter。改行按键之后内容形态未知，但空行补一次回车本身无害。
let terminalHasContent = null;
// 不改变终端行内容的直达按键：这些键之后恢复记录仍然有效。
const PENDING_ENTER_KEEP_KEYS = { 'C-l': true, 'C-a': true, 'C-e': true, PPage: true, NPage: true };

// 同一终端的提交/按键串行执行：两条 submitLine 并行时，第二次 paste 可能
// 排在第一次 Enter 前，把两条命令拼成一行或颠倒顺序。按 scope 排队。
const scopeQueues = {};

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

function enqueueForScope(scope, task) {
  const run = (scopeQueues[scope] || Promise.resolve()).then(task, task);
  scopeQueues[scope] = run.then(function () {}, function () {});
  return run;
}

// 当前选中目标的标识：tmux 用 target，Herdr 用 pane_id。
function currentScope() {
  if (view === 'tmux') return selectedTarget ? 't:' + selectedTarget : null;
  return selectedPane ? 'h:' + selectedPane.pane_id : null;
}

// 只补一次回车：文本确认已在终端里时用它，绝不重复粘贴。
async function sendEnterOnly(scope, pinnedView) {
  const hadText = pendingEnterOnly && pendingEnterOnly.scope === scope
    ? pendingEnterOnly.text : null;
  pendingEnterOnly = null;
  terminalHasContent = null;
  const target = selectedTarget;
  const paneId = selectedPane ? selectedPane.pane_id : null;
  try {
    if (pinnedView === 'tmux') await request('tmux_send', { target: target, keys: ['Enter'] });
    else await request('send', { pane_id: paneId, keys: ['Enter'] });
    await refreshTerminal();
  } catch (error) {
    // 回车结果未知：恢复同一目标的待提交记录，否则下一次回车什么都不做，
    // 终端里已有的命令就再也提交不了；同时提示先核对终端。
    if (currentScope() === scope) {
      terminalHasContent = { scope: scope };
      if (hadText !== null) pendingEnterOnly = { scope: scope, text: hadText };
    }
    renderOutput('回车没有确认（'
      + String(error && error.message ? error.message : T.sendFailed)
      + '）。请先核对终端内容，再决定是否再按一次回车。');
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
  // 同一终端的「文本 + Enter」串行执行：两条提交并行时，第二次 paste
  // 可能排在第一次 Enter 前，把两条命令拼成一行或颠倒顺序。
  enqueueForScope(scope, function () {
    return submitLineQueued(text, pinnedView, target, paneId, scope);
  });
}

async function submitLineQueued(text, pinnedView, target, paneId, scope) {
  const field = $('#term-input');
  // 空输入框但终端里有内容（草稿刚同步、或粘贴后回车未确认）：
  // 这次回车只补 Enter。
  if (!text) {
    if ((pendingEnterOnly && pendingEnterOnly.scope === scope)
        || (terminalHasContent && terminalHasContent.scope === scope)) {
      await sendEnterOnly(scope, pinnedView);
    }
    return;
  }
  // 恢复语义：这段文本已在终端里（上次粘贴后 Enter 未确认，或草稿刚被
  // 同步过去），同一目标同一文本的提交只补 Enter，不再粘一遍。
  if (pendingEnterOnly && pendingEnterOnly.scope === scope && pendingEnterOnly.text === text) {
    pendingEnterOnly = null;
    consumeFromInput(field, text);
    try {
      if (pinnedView === 'tmux') await request('tmux_send', { target: target, keys: ['Enter'] });
      else await request('send', { pane_id: paneId, keys: ['Enter'] });
      await refreshTerminal();
    } catch (error) {
      pendingEnterOnly = { scope: scope, text: text };
      // 只在仍选中同一目标时补回输入框，别把 A 的命令写进 B 的框。
      if (currentScope() === scope && !field.value) field.value = text;
      renderOutput(error.message || T.sendFailed);
    }
    return;
  }
  pendingEnterOnly = null;
  terminalHasContent = null;
  consumeFromInput(field, text);
  try {
    if (pinnedView === 'tmux') {
      await request('tmux_send', { target: target, text: text });
      try {
        await request('tmux_send', { target: target, keys: ['Enter'] });
      } catch (error) {
        // Enter 的结果可能是「没发出」也可能是「发出了但回执丢了」：
        // 不能断言。恢复草稿并记住这次粘贴，下一次同一文本只补回车；
        // 用户也可以先在终端里核对内容再决定。
        pendingEnterOnly = { scope: scope, text: text };
        if (currentScope() === scope && !field.value) field.value = text;
        renderOutput('文本已输入到终端，但回车没有确认（'
          + String(error && error.message ? error.message : T.sendFailed)
          + '）。请先在终端里核对内容：若命令尚未执行，直接再按一次回车即可（只会补发回车，不会重复粘贴文本）。');
        return;
      }
      await refreshTerminal();
    } else {
      // submit = pane.send_input，自带回车；pane.send_text 只打字不执行。
      await request('submit', { pane_id: paneId, text: text });
      await refreshTerminal();
    }
  } catch (error) {
    // 第一段的失败走这里：终端多半没收到内容，把草稿放回输入框，
    // 别让用户丢命令；错误文案本身（含「结果未知」）会提示先核对终端。
    // 但只在仍选中同一目标时回填：框里可能已是另一个分屏的内容。
    if (currentScope() === scope && !field.value) field.value = text;
    renderOutput(error.message || T.sendFailed);
  }
}

// 重读当前 pane 的画面；不清空输入框——发送返回前用户可能已经开始打下一条。
async function refreshTerminal() {
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
  if (changed) { $('#term-input').value = ''; pendingEnterOnly = null; terminalHasContent = null; }
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
        on: selectedTarget === pane.target,
        onSelect: function () { openTmuxPane(pane); }
      }));
    }
    list.appendChild(chips);
  }
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
  tmux = next;
  const sessions = (tmux && tmux.sessions) || [];
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
  setComposerTarget(pane.target);
}

async function openTmuxPane(pane) {
  // 换目标就丢掉草稿：A 里没发出去的命令不能在回车时打到 B 上。
  const changed = selectedTarget !== pane.target;
  selectedTarget = pane.target;
  if (changed) { $('#term-input').value = ''; pendingEnterOnly = null; terminalHasContent = null; }
  readToken += 1;
  const token = readToken;
  renderTmux();
  $('#detail').hidden = false;
  renderTmuxDetail(pane);
  $('#term-input').focus();
  renderOutput('');
  $('#detail-body').textContent = T.loading;
  try {
    const result = await request('tmux_read', { target: pane.target });
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
    // 详情卡开着的时候，先按 id 把选中对象换成最新的一份并刷新头部，
    // 再重读正文：否则列表显示新状态、详情卡还是旧值。
    if (view === 'tmux') {
      if (selectedTarget) {
        const fresh = ((tmux && tmux.panes) || []).find(function (pane) {
          return pane.target === selectedTarget;
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
  pendingEnterOnly = null;
  terminalHasContent = null;
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
