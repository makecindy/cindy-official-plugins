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
    statusIdle: '空闲'
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
    statusIdle: 'idle'
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
    statusIdle: '待機'
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
    statusIdle: '대기'
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
  syncComposerButtons();
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
    for (const pane of panes) {
      const row = makeRow({
        title: pane.label || pane.pane_id,
        subtitle: pane.title || pane.cwd || pane.agent || '',
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
  $('#detail-title').textContent = pane.label || pane.pane_id;
  $('#detail-sub').textContent = [pane.pane_id, statusLabel(pane.agent_status), pane.cwd]
    .filter(Boolean).join(' · ');
  $('#detail-body').textContent = T.loading;
  try {
    const result = await request('read', { pane_id: pane.pane_id, source: 'visible', lines: 80 });
    if (token !== readToken) return;
    $('#detail-body').textContent = result.text || T.noOutput;
  } catch (error) {
    if (token !== readToken) return;
    $('#detail-body').textContent = error.message || T.readFailed;
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
    for (const pane of sessionPanes) {
      const row = makeRow({
        title: pane.target,
        subtitle: [pane.window_name, pane.command, pane.path].filter(Boolean).join(' · '),
        dotClass: pane.dead ? 'blocked' : pane.active ? 'working' : 'unknown',
        state: statusLabelForTmux(pane),
        dead: pane.dead,
        onSelect: function () { openTmuxPane(pane); }
      });
      if (selectedTarget === pane.target) row.classList.add('on');
      list.appendChild(row);
    }
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
  $('#detail-body').textContent = T.loading;
  try {
    const result = await request('tmux_read', { target: pane.target });
    if (token !== readToken) return;
    $('#detail-body').textContent = result.text || T.noOutput;
  } catch (error) {
    if (token !== readToken) return;
    $('#detail-body').textContent = error.message || T.readFailed;
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
  try {
    if (view === 'tmux') {
      if (!selectedTarget) return;
      await request('tmux_send', { target: selectedTarget, text: text });
      if (submit) await request('tmux_send', { target: selectedTarget, keys: ['Enter'] });
      field.value = '';
      await openTmuxPane({ target: selectedTarget });
    } else {
      if (!selectedPane) return;
      await request('send', { pane_id: selectedPane.pane_id, text: text });
      field.value = '';
      await openPane(selectedPane);
    }
  } catch (error) {
    $('#detail-body').textContent = error.message || T.sendFailed;
  }
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
