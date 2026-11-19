'use strict';

const channel = new BroadcastChannel('cindy-plugin-herdr');
const $ = function (selector) { return document.querySelector(selector); };

// 面板文案跟随宿主语言：只读 /app-context 的 uiLocale ?? locale，插件没有的语言回退英文。
// 不读 navigator.language，也不保存自己的语言偏好。
const strings = {
  'zh-CN': {
    refreshing: '刷新中…',
    updated: '已更新',
    refreshFailed: '刷新失败',
    noWorkspaces: '没有可显示的工作区',
    focused: '当前',
    noTmuxSessions: '没有正在运行的 tmux session',
    allSessions: '全部 session',
    noPanes: '这个 session 下没有可列的 pane',
    tmuxMissing: '这台电脑上没有 tmux',
    tmuxMissingHint: '装上 tmux 后这里会列出 session 与 pane。',
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
    placeholder: '输入内容发送给选中的 pane',
    send: '发送',
    submit: '发送并回车',
    statusWorking: '进行中',
    statusBlocked: '待处理',
    statusDone: '已完成',
    statusIdle: '空闲',
    sendingTo: '发送到 '
  },
  en: {
    refreshing: 'Refreshing…',
    updated: 'Updated',
    refreshFailed: 'Could not refresh',
    noWorkspaces: 'No workspace to show',
    focused: 'focused',
    noTmuxSessions: 'No running tmux session',
    allSessions: 'All sessions',
    noPanes: 'No pane listed in this session',
    tmuxMissing: 'tmux is not installed on this computer',
    tmuxMissingHint: 'Install tmux to list sessions and panes here.',
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
    placeholder: 'Type to send to the selected pane',
    send: 'Send',
    submit: 'Send and press Enter',
    statusWorking: 'working',
    statusBlocked: 'blocked',
    statusDone: 'done',
    statusIdle: 'idle',
    sendingTo: 'Send to '
  },
  ja: {
    refreshing: '更新中…',
    updated: '更新しました',
    refreshFailed: '更新できませんでした',
    noWorkspaces: '表示できるワークスペースがありません',
    focused: '現在',
    noTmuxSessions: '実行中の tmux セッションはありません',
    allSessions: 'すべてのセッション',
    noPanes: 'このセッションに pane は表示できません',
    tmuxMissing: 'このコンピューターに tmux がありません',
    tmuxMissingHint: 'tmux を入れるとセッションと pane が表示されます。',
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
    placeholder: '選択中の pane へ送信する文字',
    send: '送信',
    submit: '送信して Enter',
    statusWorking: '作業中',
    statusBlocked: '要対応',
    statusDone: '完了',
    statusIdle: '待機',
    sendingTo: '送信先: '
  },
  ko: {
    refreshing: '새로 고치는 중…',
    updated: '갱신됨',
    refreshFailed: '갱신하지 못했습니다',
    noWorkspaces: '표시할 작업 공간이 없습니다',
    focused: '현재',
    noTmuxSessions: '실행 중인 tmux 세션이 없습니다',
    allSessions: '모든 세션',
    noPanes: '이 세션에 표시할 창이 없습니다',
    tmuxMissing: '이 컴퓨터에 tmux가 없습니다',
    tmuxMissingHint: 'tmux를 설치하면 세션과 창이 표시됩니다.',
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
    placeholder: '선택한 창으로 보낼 입력',
    send: '보내기',
    submit: '보내고 Enter',
    statusWorking: '작업 중',
    statusBlocked: '확인 필요',
    statusDone: '완료',
    statusIdle: '대기',
    sendingTo: '보낼 대상: '
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

function request(action, payload) {
  return new Promise(function (resolve, reject) {
    const reqId = 'p' + Date.now() + Math.random().toString(16).slice(2);
    let settled = false;
    function cleanup() {
      clearTimeout(timer);
      channel.removeEventListener('message', onMessage);
    }
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('插件未响应'));
    }, 15000);
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

// 状态：一个小圆点 + 一个词。颜色只做辅助，文字始终说明状态本身。
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

function makeRow(options) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'row' + (options.dead ? ' is-dead' : '');
  row.setAttribute('role', 'listitem');

  const dot = document.createElement('span');
  dot.className = 'dot ' + (options.dotClass || 'unknown');
  row.appendChild(dot);

  const main = document.createElement('span');
  main.className = 'row-main';
  const title = document.createElement('span');
  title.className = 'row-title';
  title.textContent = options.title;
  main.appendChild(title);
  if (options.subtitle) {
    const sub = document.createElement('span');
    sub.className = 'row-sub';
    sub.textContent = options.subtitle;
    main.appendChild(sub);
  }
  row.appendChild(main);

  const stateLabel = document.createElement('span');
  stateLabel.className = 'row-state';
  stateLabel.textContent = options.state || '';
  row.appendChild(stateLabel);

  if (options.onSelect) row.addEventListener('click', options.onSelect);
  return row;
}

// agent pane 用 chip 呈现：一颗 chip 就是「一个正在跑的东西」，
// 名称、状态点都在里面，扫一眼就知道谁在忙。
function makeChip(options) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip' + (options.on ? ' on' : '');
  chip.title = options.title || '';
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

function localize() {
  $('#composer-text').placeholder = T.placeholder;
  $('#detail-close').setAttribute('aria-label', T.collapse);
  $('#refresh').setAttribute('aria-label', T.updated);
  syncWrapButton();
  syncComposerButtons();
}

// 终端输出默认自动换行；切到「不换行」可以保住终端原本的列对齐。
let outputWrap = true;

function syncWrapButton() {
  const button = $('#detail-wrap');
  button.textContent = outputWrap ? T.wrapOn : T.wrapOff;
  button.setAttribute('aria-pressed', outputWrap ? 'true' : 'false');
  const output = $('#detail-body');
  output.classList.toggle('nowrap', !outputWrap);
}

// tmux 的文本发送是字面量，不会自己回车，所以主按钮是「发送并回车」；
// Herdr 的 pane.send_input 本身就会提交，只需要一个「发送」。
function syncComposerButtons() {
  const send = $('#composer-send');
  const submit = $('#composer-submit');
  if (view === 'tmux') {
    send.textContent = T.send;
    submit.textContent = T.submit;
    submit.hidden = false;
    submit.classList.add('primary');
    send.classList.remove('primary');
  } else {
    send.textContent = T.send;
    submit.hidden = true;
    send.classList.add('primary');
  }
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

    const agents = panes.filter(function (pane) { return pane.agent; });
    const others = panes.filter(function (pane) { return !pane.agent; });
    if (agents.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const pane of agents) {
        chips.appendChild(makeChip({
          name: pane.agent,
          meta: pane.title || pane.label || '',
          dotClass: String(pane.agent_status || 'unknown').toLowerCase(),
          title: (pane.title || '') + ' · ' + pane.pane_id,
          on: Boolean(selectedPane && selectedPane.pane_id === pane.pane_id),
          onSelect: function () { openPane(pane); }
        }));
      }
      list.appendChild(chips);
    }
    for (const pane of others) {
      const row = makeRow({
        title: pane.label || pane.pane_id,
        subtitle: pane.title || pane.cwd || '',
        dotClass: String(pane.agent_status || 'unknown').toLowerCase(),
        state: statusLabel(pane.agent_status),
        onSelect: function () { openPane(pane); }
      });
      if (selectedPane && selectedPane.pane_id === pane.pane_id) row.classList.add('on');
      list.appendChild(row);
    }
  }
}

async function refreshHerdr() {
  state = await request('state');
  renderHerdr();
}

async function openPane(pane) {
  selectedPane = pane;
  readToken += 1;
  const token = readToken;
  renderHerdr();
  $('#detail').hidden = false;
  $('#detail-title').textContent = pane.title || pane.label || pane.pane_id;
  $('#detail-sub').textContent = [pane.label, pane.agent, pane.cwd, pane.pane_id]
    .filter(Boolean).join(' · ');
  setDetailState(String(pane.agent_status || 'unknown').toLowerCase(), statusLabel(pane.agent_status));
  setComposerTarget([pane.label || pane.pane_id, pane.agent].filter(Boolean).join(' · '));
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
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = tmux.hint || T.tmuxMissing;
    list.appendChild(empty);
    const note = document.createElement('div');
    note.className = 'empty';
    note.textContent = tmux.message || T.tmuxMissingHint;
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
        meta: [pane.window_name, pane.command].filter(Boolean).join(' · '),
        dotClass: pane.dead ? 'blocked' : pane.active ? 'working' : 'unknown',
        title: [pane.path, pane.target].filter(Boolean).join(' · '),
        on: selectedTarget === pane.target,
        onSelect: function () { openTmuxPane(pane); }
      }));
    }
    list.appendChild(chips);
  }
}

async function refreshTmux() {
  try {
    tmux = await request('tmux_state', tmuxFilter ? { session: tmuxFilter } : {});
  } catch (error) {
    // 带 filter 时那个 session 可能刚好退出：退回全部 session 再试一次。不能
    // 让面板停在错误态——那时「全部 session」按钮还没渲染，用户点不回来。
    if (!tmuxFilter) throw error;
    tmuxFilter = null;
    tmux = await request('tmux_state', {});
  }
  const sessions = (tmux && tmux.sessions) || [];
  if (tmuxFilter && !sessions.some(function (s) { return s.name === tmuxFilter; })) {
    tmuxFilter = null;
  }
  renderTmux();
}

async function openTmuxPane(pane) {
  selectedTarget = pane.target;
  readToken += 1;
  const token = readToken;
  renderTmux();
  $('#detail').hidden = false;
  $('#detail-title').textContent = pane.target;
  $('#detail-sub').textContent = [pane.window_name, pane.command, pane.path]
    .filter(Boolean).join(' · ');
  setDetailState(pane.dead ? 'blocked' : pane.active ? 'working' : 'unknown', statusLabelForTmux(pane));
  setComposerTarget(pane.target);
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

async function refresh() {
  const status = $('#status');
  status.textContent = T.refreshing;
  try {
    if (view === 'tmux') await refreshTmux();
    else await refreshHerdr();
    status.textContent = T.updated;
  } catch (error) {
    status.textContent = error.message || T.refreshFailed;
  }
}

// submit=true 时额外发一个 Enter：tmux 的文本发送是字面量，不会自己回车，
// 所以「发送并回车」才是真正跑起一条命令的动作。
async function send(submit) {
  const field = $('#composer-text');
  const text = field.value;
  if (!text.trim()) return;
  // 发送开始时锁定目标：中途切换选中项，文本和回车仍发往同一个分屏。
  const paneId = selectedPane ? selectedPane.pane_id : null;
  const target = selectedTarget;
  if (view === 'tmux' && !target) return;
  if (view !== 'tmux' && !paneId) return;
  try {
    if (view === 'tmux') {
      await request('tmux_send', { target: target, text: text });
      if (submit) await request('tmux_send', { target: target, keys: ['Enter'] });
      field.value = '';
      await openTmuxPane({ target: target });
    } else {
      await request('send', { pane_id: paneId, text: text });
      field.value = '';
      await openPane(selectedPane || { pane_id: paneId });
    }
  } catch (error) {
    renderOutput(error.message || T.sendFailed);
  }
}


// 中日韩字符在多数系统上会掉到比例字体，终端的列就会歪。把宽字符单独包一层、
// 固定占 2 个等宽单元格（和真实终端的口径一致），其余字符保持普通文本，
// 这样换行和性能都不受影响。内容很大或没有宽字符时直接走纯文本。
const WIDE_CHAR = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{2FA1F}]/u;
const CELL_CAP = 20000;

function renderOutput(text) {
  const body = $('#detail-body');
  body.textContent = '';
  if (!text) return;
  const source = text.length > CELL_CAP ? text.slice(text.length - CELL_CAP) : text;
  if (!WIDE_CHAR.test(source)) {
    body.appendChild(document.createTextNode(source));
    return;
  }
  const fragment = document.createDocumentFragment();
  let plain = '';
  const flush = function () {
    if (!plain) return;
    fragment.appendChild(document.createTextNode(plain));
    plain = '';
  };
  for (const char of source) {
    if (WIDE_CHAR.test(char)) {
      flush();
      const cell = document.createElement('span');
      cell.className = 'wide';
      cell.textContent = char;
      fragment.appendChild(cell);
    } else {
      plain += char;
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
  readToken += 1;
  if (view === 'tmux') renderTmux();
  else renderHerdr();
}

function setView(next) {
  view = next;
  selectedPane = null;
  selectedTarget = null;
  closeDetail();
  document.querySelectorAll('[data-view]').forEach(function (button) {
    const on = button.getAttribute('data-view') === view;
    button.classList.toggle('on', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  syncComposerButtons();
  refresh();
}

$('#refresh').addEventListener('click', refresh);
$('#composer-send').addEventListener('click', function () { send(false); });
$('#composer-submit').addEventListener('click', function () { send(true); });
$('#detail-close').addEventListener('click', closeDetail);
$('#detail-wrap').addEventListener('click', function () {
  outputWrap = !outputWrap;
  syncWrapButton();
});
$('#composer-text').addEventListener('keydown', function (event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    send(view === 'tmux');
  }
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
  if (message.type === 'host-context-changed') loadLocale();
});

loadLocale();
refresh();
setInterval(refresh, 15000);
