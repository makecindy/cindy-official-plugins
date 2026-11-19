'use strict';

const channel = new BroadcastChannel('cindy-plugin-herdr');
const $ = function (selector) { return document.querySelector(selector); };

let view = 'herdr';
let state = { workspaces: [], tabs: [], panes: [] };
let selectedPane = null;

let tmux = { available: false, version: null, reason: null, message: null, sessions: [], panes: [], hint: null };
let tmuxFilter = null;
let selectedTarget = null;

function request(action, payload) {
  return new Promise(function (resolve, reject) {
    const reqId = 'p' + Date.now() + Math.random().toString(16).slice(2);
    const timer = setTimeout(function () {
      reject(new Error('插件未响应'));
    }, 15000);
    function onMessage(event) {
      const message = event.data;
      if (!message || message.type !== 'panel-response' || message.reqId !== reqId) return;
      clearTimeout(timer);
      channel.removeEventListener('message', onMessage);
      if (message.ok) resolve(message.data);
      else reject(new Error(message.message || '操作失败'));
    }
    channel.addEventListener('message', onMessage);
    channel.postMessage(Object.assign({ type: 'panel-request', reqId: reqId, action: action }, payload || {}));
  });
}

function badgeClass(status) {
  return 'badge ' + String(status || 'unknown');
}

// --- Herdr 视图 ----------------------------------------------------------

function renderHerdr() {
  const list = $('#list');
  list.textContent = '';
  if (!state.workspaces.length) {
    const empty = document.createElement('div');
    empty.className = 'group-title';
    empty.textContent = '没有可显示的工作区';
    list.appendChild(empty);
    return;
  }
  for (const workspace of state.workspaces) {
    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = (workspace.label || workspace.workspace_id)
      + (workspace.focused ? ' · 当前' : '');
    list.appendChild(title);
    for (const pane of state.panes.filter(function (item) {
      return item.workspace_id === workspace.workspace_id;
    })) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pane';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = pane.label || pane.pane_id;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = pane.title || pane.agent || pane.cwd || pane.pane_id;
      const badge = document.createElement('span');
      badge.className = badgeClass(pane.agent_status);
      badge.textContent = pane.agent_status || 'unknown';
      row.appendChild(name);
      row.appendChild(meta);
      row.appendChild(badge);
      row.addEventListener('click', function () { openPane(pane); });
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
  $('#detail').hidden = false;
  $('#detail-title').textContent = (pane.label || pane.pane_id) + ' · ' + pane.pane_id;
  $('#detail-body').textContent = '读取中…';
  try {
    const result = await request('read', { pane_id: pane.pane_id, source: 'visible', lines: 80 });
    $('#detail-body').textContent = result.text || '(没有输出)';
  } catch (error) {
    $('#detail-body').textContent = error.message || '读取失败';
  }
}

// --- tmux 视图 -----------------------------------------------------------

function renderTmux() {
  const list = $('#list');
  list.textContent = '';

  const sessions = (tmux && tmux.sessions) || [];
  const panes = (tmux && tmux.panes) || [];

  const head = document.createElement('div');
  head.className = 'group-title';
  if (!tmux.available) {
    head.textContent = tmux.hint || '这台电脑上没有 tmux';
  } else {
    head.textContent = 'tmux ' + (tmux.version || '') + ' · '
      + sessions.length + ' 个 session · ' + panes.length + ' 个 pane';
  }
  list.appendChild(head);

  if (!tmux.available) {
    const note = document.createElement('div');
    note.className = 'meta';
    note.textContent = tmux.message || '装上 tmux 后这里会列出 session 与 pane。';
    list.appendChild(note);
    return;
  }

  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'group-title';
    empty.textContent = '没有正在运行的 tmux session';
    list.appendChild(empty);
    return;
  }

  if (tmuxFilter) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'pane';
    back.textContent = '← 全部 session';
    back.addEventListener('click', function () {
      tmuxFilter = null;
      renderTmux();
    });
    list.appendChild(back);
  }

  const shown = tmuxFilter
    ? sessions.filter(function (s) { return s.name === tmuxFilter; })
    : sessions;

  for (const session of shown) {
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'group-title link-row';
    title.textContent = (session.name + ' · ' + session.windows + ' 个窗口'
      + (session.attached ? ' · 已连接' : ''));
    title.addEventListener('click', function () {
      tmuxFilter = session.name;
      renderTmux();
    });
    list.appendChild(title);

    const sessionPanes = panes.filter(function (pane) { return pane.session === session.name; });
    if (!sessionPanes.length) {
      const none = document.createElement('div');
      none.className = 'meta';
      none.textContent = '（这个 session 下没有可列的 pane）';
      list.appendChild(none);
      continue;
    }
    for (const pane of sessionPanes) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pane' + (pane.dead ? ' dead' : '');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = pane.target;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = [pane.window_name, pane.command, pane.path]
        .filter(Boolean).join(' · ') || pane.target;
      const badge = document.createElement('span');
      badge.className = 'badge ' + (pane.dead ? 'blocked' : pane.active ? 'done' : 'idle');
      badge.textContent = pane.dead ? '已退出' : (pane.active ? '活动' : pane.width + '×' + pane.height);
      row.appendChild(name);
      row.appendChild(meta);
      row.appendChild(badge);
      row.addEventListener('click', function () { openTmuxPane(pane); });
      list.appendChild(row);
    }
  }
}

async function refreshTmux() {
  try {
    tmux = await request('tmux_state', tmuxFilter ? { session: tmuxFilter } : {});
  } catch (error) {
    // 带 filter 时那个 session 可能刚好退出：退回全部 session 再试一次。不能
    // 让面板停在错误态——那时「← 全部 session」按钮还没渲染，用户点不回来。
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
  $('#detail').hidden = false;
  $('#detail-title').textContent = pane.target;
  $('#detail-body').textContent = '读取中…';
  try {
    const result = await request('tmux_read', { target: pane.target });
    $('#detail-body').textContent = result.text || '(没有输出)';
  } catch (error) {
    $('#detail-body').textContent = error.message || '读取失败';
  }
}

// --- 共用 ---------------------------------------------------------------

async function refresh() {
  $('#status').textContent = '刷新中…';
  try {
    if (view === 'tmux') await refreshTmux();
    else await refreshHerdr();
    $('#status').textContent = '已更新';
  } catch (error) {
    $('#status').textContent = error.message || '读取失败';
  }
}

async function send() {
  const field = $('#composer-text');
  const text = field.value;
  if (!text.trim()) return;
  try {
    if (view === 'tmux') {
      if (!selectedTarget) return;
      await request('tmux_send', { target: selectedTarget, text: text });
      field.value = '';
      await openTmuxPane({ target: selectedTarget });
    } else {
      if (!selectedPane) return;
      await request('send', { pane_id: selectedPane.pane_id, text: text });
      field.value = '';
      await openPane(selectedPane);
    }
  } catch (error) {
    $('#detail-body').textContent = error.message || '发送失败';
  }
}

function closeDetail() {
  $('#detail').hidden = true;
  selectedPane = null;
  selectedTarget = null;
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
  refresh();
}

$('#refresh').addEventListener('click', refresh);
$('#composer-send').addEventListener('click', send);
$('#detail-close').addEventListener('click', closeDetail);
$('#composer-text').addEventListener('keydown', function (event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    send();
  }
});
document.querySelectorAll('[data-view]').forEach(function (button) {
  button.addEventListener('click', function () { setView(button.getAttribute('data-view')); });
});

channel.addEventListener('message', function (event) {
  const message = event.data;
  if (!message || message.type !== 'herdr-event') return;
  if (view === 'herdr') refresh();
});

refresh();
setInterval(refresh, 15000);
