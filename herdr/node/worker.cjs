'use strict';

const net = require('node:net');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const DEFAULT_TIMEOUT_MS = 120000;

function socketPath() {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;
  const home = os.homedir();
  const base = path.join(home, '.config', 'herdr');
  if (process.env.HERDR_SESSION) {
    return path.join(base, 'sessions', process.env.HERDR_SESSION, 'herdr.sock');
  }
  return path.join(base, 'herdr.sock');
}

function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function notify(method, params) {
  reply({ jsonrpc: '2.0', method: method, params: params });
}

function fail(id, code, message) {
  reply({ jsonrpc: '2.0', id: id, error: { code: code, message: message } });
}

let requestCounter = 0;
function nextId() {
  requestCounter += 1;
  return 'w' + requestCounter;
}

function sendLine(socket, payload) {
  socket.write(JSON.stringify(payload) + '\n');
}

// The Herdr server answers one request per connection and then closes it,
// so every ordinary call needs its own socket.
function callOnce(method, params, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const id = nextId();
    const socket = net.createConnection(socketPath());
    let buffer = '';
    let settled = false;
    const timer = setTimeout(function () {
      finish(reject, new Error('herdr 请求超时：' + method));
    }, timeoutMs || DEFAULT_TIMEOUT_MS);

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (error) { void error; }
      fn(value);
    }

    socket.on('connect', function () {
      sendLine(socket, { id: id, method: method, params: params || {} });
    });

    socket.on('data', function (chunk) {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          finish(reject, new Error('herdr 返回了无法解析的响应'));
          return;
        }
        if (message.id && message.id !== id) continue;
        if (message.error) {
          finish(reject, new Error(message.error.code + ': ' + message.error.message));
          return;
        }
        if (message.result !== undefined) {
          finish(resolve, message.result);
          return;
        }
      }
    });

    socket.on('error', function (error) { finish(reject, error); });
    socket.on('close', function () {
      if (!settled) finish(reject, new Error('herdr 连接在返回前关闭：' + method));
    });
  });
}

// --- Event subscription -------------------------------------------------

const subscription = {
  socket: null,
  paneIds: [],
  webhookUrl: null,
  running: false
};

async function listPaneIds() {
  const result = await callOnce('pane.list', {}, 15000);
  const panes = (result && result.panes) || [];
  return panes.map(function (pane) { return pane.pane_id; }).filter(Boolean);
}

function buildEntries(paneIds) {
  const entries = [
    { type: 'pane.created' },
    { type: 'pane.closed' },
    { type: 'pane.focused' },
    { type: 'pane.updated' },
    { type: 'pane.exited' },
    { type: 'pane.agent_detected' },
    { type: 'workspace.created' },
    { type: 'workspace.closed' },
    { type: 'workspace.focused' },
    { type: 'tab.created' },
    { type: 'tab.closed' },
    { type: 'tab.focused' }
  ];
  for (const paneId of paneIds) {
    entries.push({ type: 'pane.agent_status_changed', pane_id: paneId });
  }
  return entries;
}

function isStatusEvent(event) {
  return event === 'pane_agent_status_changed' || event === 'pane.agent_status_changed';
}

function handleEvent(message) {
  const data = message.data || {};
  notify('herdr/event', { event: message.event, data: data });
  const status = data.agent_status;
  if (isStatusEvent(message.event)
      && (status === 'blocked' || status === 'done')
      && subscription.webhookUrl) {
    postWebhook({
      event: isStatusEvent(message.event) ? 'pane_agent_status_changed' : message.event,
      pane_id: data.pane_id,
      workspace_id: data.workspace_id,
      agent_status: status,
      agent: data.agent || null,
      title: data.title || null
    }).catch(function () {});
  }
}

async function postWebhook(payload) {
  const url = subscription.webhookUrl;
  if (!url) return;
  const body = JSON.stringify({
    type: payload.event,
    source: 'cindy-plugin:herdr',
    data: payload
  });
  await new Promise(function (resolve) {
    let settled = false;
    const done = function () {
      if (settled) return;
      settled = true;
      resolve();
    };
    const request = https.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, function (response) {
      response.resume();
      response.on('end', done);
    });
    request.on('error', done);
    request.setTimeout(10000, function () {
      request.destroy();
      done();
    });
    request.end(body);
  });
}

async function startSubscription(webhookUrl) {
  await stopSubscription();
  subscription.webhookUrl = webhookUrl || null;
  const paneIds = await listPaneIds();
  subscription.paneIds = paneIds;
  const entries = buildEntries(paneIds);
  const id = nextId();
  const socket = net.createConnection(socketPath());
  subscription.socket = socket;
  subscription.running = true;

  await new Promise(function (resolve, reject) {
    let buffer = '';
    const timer = setTimeout(function () { reject(new Error('订阅连接超时')); }, 15000);
    socket.on('connect', function () {
      sendLine(socket, {
        id: id,
        method: 'events.subscribe',
        params: { subscriptions: entries }
      });
    });
    socket.on('data', function (chunk) {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          continue;
        }
        if (message.id === id) {
          clearTimeout(timer);
          if (message.error) {
            reject(new Error(message.error.code + ': ' + message.error.message));
          } else {
            resolve();
          }
          continue;
        }
        if (message.event) handleEvent(message);
      }
    });
    socket.on('error', function (error) {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('close', function () {
      subscription.running = false;
      subscription.socket = null;
    });
  });
}

async function stopSubscription() {
  const socket = subscription.socket;
  subscription.socket = null;
  subscription.running = false;
  if (socket) {
    try { socket.destroy(); } catch (error) { void error; }
  }
}

async function refreshPaneSubscriptions() {
  if (!subscription.running) return;
  let paneIds;
  try {
    paneIds = await listPaneIds();
  } catch (error) {
    return;
  }
  const changed = paneIds.length !== subscription.paneIds.length
    || paneIds.some(function (id, index) { return id !== subscription.paneIds[index]; });
  if (!changed) return;
  const webhookUrl = subscription.webhookUrl;
  await startSubscription(webhookUrl).catch(function () {});
}

// --- tmux backend --------------------------------------------------------
// tmux 不是 shell：参数一律作为 argv 元素直传 spawn，不经 shell，没有注入面。
// 字段分隔符用 ASCII Unit Separator(31)：路径里可以有 |、换行、制表符，但不可能
// 有 31，比 | 分列安全。解析时校验列数，对不上就整行报错而不是错位。
const { spawn } = require('node:child_process');

const TMUX_FIELD_SEP = String.fromCharCode(31);
const TMUX_TIMEOUT_MS = 8000;
const TMUX_CAPTURE_TIMEOUT_MS = 15000;
const TMUX_CAPTURE_MAX_CHARS = 120000;
const TMUX_SESSION_FIELDS = ['name', 'windows', 'attached', 'created'];
const TMUX_PANE_FIELDS = [
  'target', 'session', 'window', 'pane', 'window_name', 'command', 'path',
  'active', 'dead', 'width', 'height', 'pid', 'title'
];
const TMUX_SESSION_FORMAT = TMUX_SESSION_FIELDS.map(function (field) {
  return {
    name: '#{session_name}',
    windows: '#{session_windows}',
    attached: '#{session_attached}',
    created: '#{session_created}'
  }[field];
}).join(TMUX_FIELD_SEP);
const TMUX_PANE_FORMAT = TMUX_PANE_FIELDS.map(function (field) {
  return {
    target: '#{session_name}:#{window_index}.#{pane_index}',
    session: '#{session_name}',
    window: '#{window_index}',
    pane: '#{pane_index}',
    window_name: '#{window_name}',
    command: '#{pane_current_command}',
    path: '#{pane_current_path}',
    active: '#{pane_active}',
    dead: '#{pane_dead}',
    width: '#{pane_width}',
    height: '#{pane_height}',
    pid: '#{pane_pid}',
    title: '#{pane_title}'
  }[field];
}).join(TMUX_FIELD_SEP);

function tmuxError(message, code, stderr) {
  const error = new Error(message);
  error.code = code;
  if (stderr) error.stderr = stderr;
  return error;
}

function isNoTmuxServer(error) {
  if (!error || error.code !== 'TMUX_FAILED') return false;
  const text = String(error.stderr || error.message || '');
  return text.indexOf('no server running') >= 0 || text.indexOf('no sessions') >= 0;
}

// 指定了 session 而它不在时，tmux 非零退出并说 can't find session/window。
// 「列 pane」是总量操作：session 刚退出与「从没有过」对调用方是同一种答案——
// 空列表。面板靠这个把已消失的 filter 自动退回全部 session；agent 也不会因为
// 一次竞态就只拿到一个错误。注意只有带 session 过滤时才这么算，`-a` 全列不
// 存在这个问题，它的失败必须照原样抛出。
function isMissingTmuxTarget(error) {
  if (!error || error.code !== 'TMUX_FAILED') return false;
  const text = String(error.stderr || error.message || '');
  return text.indexOf("can't find session") >= 0 || text.indexOf("can't find window") >= 0;
}

function runTmux(args, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let child;
    try {
      child = spawn('tmux', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error && error.code === 'ENOENT'
        ? tmuxError('这台电脑上没有 tmux（命令未找到）', 'TMUX_NOT_INSTALLED')
        : error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const limit = timeoutMs || TMUX_TIMEOUT_MS;
    const timer = setTimeout(function () {
      finish(reject, tmuxError('tmux 命令超时（' + limit + 'ms）', 'TMUX_TIMEOUT', stderr));
      try { child.kill('SIGKILL'); } catch (error) { void error; }
    }, limit);

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    }

    child.stdout.on('data', function (chunk) { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', function (chunk) { stderr += chunk.toString('utf8'); });
    child.on('error', function (error) {
      finish(reject, error && error.code === 'ENOENT'
        ? tmuxError('这台电脑上没有 tmux（命令未找到）', 'TMUX_NOT_INSTALLED')
        : error);
    });
    child.on('close', function (code) {
      if (code === 0) {
        finish(resolve, stdout);
        return;
      }
      // tmux 用非 0 退出码表达「没有 server / 没有匹配 target」，正文在 stderr。
      finish(reject, tmuxError(
        (stderr || stdout || '').trim() || ('tmux 退出码 ' + code),
        'TMUX_FAILED',
        stderr
      ));
    });
  });
}

function parseTmuxRows(output, fields) {
  const rows = [];
  const lines = String(output || '').split('\n');
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split(TMUX_FIELD_SEP);
    if (parts.length !== fields.length) {
      throw tmuxError(
        'tmux 输出列数不符（期望 ' + fields.length + '，实际 ' + parts.length + '）',
        'TMUX_PARSE_FAILED',
        line
      );
    }
    const row = {};
    fields.forEach(function (field, index) { row[field] = parts[index]; });
    rows.push(row);
  }
  return rows;
}

async function tmuxSessions() {
  let output;
  try {
    output = await runTmux(['list-sessions', '-F', TMUX_SESSION_FORMAT]);
  } catch (error) {
    if (isNoTmuxServer(error)) return [];
    throw error;
  }
  return parseTmuxRows(output, TMUX_SESSION_FIELDS).map(function (row) {
    return {
      name: row.name,
      windows: Number(row.windows) || 0,
      attached: row.attached === '1',
      created: Number(row.created) || null
    };
  });
}

async function tmuxPanes(session) {
  const args = session
    ? ['list-panes', '-t', String(session), '-F', TMUX_PANE_FORMAT]
    : ['list-panes', '-a', '-F', TMUX_PANE_FORMAT];
  let output;
  try {
    output = await runTmux(args);
  } catch (error) {
    if (isNoTmuxServer(error)) return [];
    if (session && isMissingTmuxTarget(error)) return [];
    throw error;
  }
  return parseTmuxRows(output, TMUX_PANE_FIELDS).map(function (row) {
    return {
      target: row.target,
      session: row.session,
      window: Number(row.window) || 0,
      pane: Number(row.pane) || 0,
      window_name: row.window_name || null,
      command: row.command || null,
      path: row.path || null,
      active: row.active === '1',
      dead: row.dead === '1',
      width: Number(row.width) || 0,
      height: Number(row.height) || 0,
      pid: Number(row.pid) || null,
      title: row.title || null
    };
  });
}

async function tmuxPaneHeight(target) {
  try {
    const output = await runTmux(['display-message', '-p', '-t', String(target), '-F', '#{pane_height}']);
    const height = parseInt(String(output).trim(), 10);
    return Number.isFinite(height) && height > 0 ? height : 24;
  } catch (error) {
    void error;
    return 24;
  }
}

async function tmuxCapture(target, lines) {
  const dest = String(target || '');
  if (!dest) throw tmuxError('缺少 target', 'TMUX_BAD_TARGET');
  const args = ['capture-pane', '-p', '-t', dest];
  const count = Number(lines);
  const want = Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), 5000) : 0;
  if (want > 0) {
    // tmux 的行号语义（man capture-pane）：0 是可见屏第一行，负数只数 history，
    // 「-」到 -E 是可见屏末行。所以「最近 N 行」不能写成 -S -N -E -1 —— 那样
    // history 为空时会整个塌回 history 区，只回一行。正确拆法：
    //   N <= 可见屏高  → 抓整屏，在 JS 里取尾部 N 行；
    //   N >  可见屏高  → -S -(N-高度) -E -，正好 N 行；history 不够时 tmux 自行夹到顶。
    const height = await tmuxPaneHeight(dest);
    args.push('-S', want > height ? '-' + String(want - height) : '0', '-E', '-');
  }
  const output = await runTmux(args, TMUX_CAPTURE_TIMEOUT_MS);
  let rows = String(output).replace(/\n$/, '').split('\n');
  if (want > 0 && rows.length > want) rows = rows.slice(rows.length - want);
  let text = rows.join('\n');
  let truncated = false;
  if (text.length > TMUX_CAPTURE_MAX_CHARS) {
    text = text.slice(text.length - TMUX_CAPTURE_MAX_CHARS);
    truncated = true;
  }
  return {
    target: dest,
    text: text,
    lines: text ? text.split('\n').length : 0,
    truncated: truncated
  };
}

async function tmuxSend(target, params) {
  const dest = String(target || '');
  if (!dest) throw tmuxError('缺少 target', 'TMUX_BAD_TARGET');
  const keys = Array.isArray(params.keys) && params.keys.length
    ? params.keys.map(String)
    : null;
  if (keys) {
    await runTmux(['send-keys', '-t', dest].concat(keys));
    return { target: dest, mode: 'keys', keys: keys };
  }
  if (params.text === undefined || params.text === null) {
    throw tmuxError('缺少 text 或 keys', 'TMUX_BAD_TARGET');
  }
  // -l 让 tmux 把内容当字面量，不解释 C-b / Enter 这类键名；-- 允许以 - 开头的文本。
  await runTmux(['send-keys', '-t', dest, '-l', '--', String(params.text)]);
  return { target: dest, mode: 'text', text: String(params.text) };
}

// --- RPC ----------------------------------------------------------------

const handlers = {
  async ping() {
    return callOnce('ping', {}, 10000);
  },

  async 'herdr/request'(params) {
    const method = String(params.method || '');
    if (!method) throw new Error('缺少 method');
    const timeout = Number(params.timeout_ms || 0);
    return callOnce(method, params.params || {}, timeout || undefined);
  },

  async 'herdr/snapshot'() {
    return callOnce('session.snapshot', {}, 30000);
  },

  async 'herdr/subscribe'(params) {
    await startSubscription(params.webhookUrl || null);
    return { subscribed: true, panes: subscription.paneIds.length };
  },

  async 'herdr/configure'(params) {
    subscription.webhookUrl = params.webhookUrl || null;
    await refreshPaneSubscriptions();
    return { ok: true };
  },

  async 'herdr/status'() {
    return {
      subscribed: subscription.running,
      panes: subscription.paneIds.length,
      webhook: Boolean(subscription.webhookUrl),
      socket: socketPath()
    };
  },

  async 'herdr/unsubscribe'() {
    await stopSubscription();
    return { subscribed: false };
  },

  async 'tmux/available'() {
    try {
      const output = await runTmux(['-V'], 5000);
      return { available: true, version: String(output).trim(), reason: null, message: null };
    } catch (error) {
      if (error.code === 'TMUX_NOT_INSTALLED') {
        return { available: false, version: null, reason: 'not-installed', message: null };
      }
      return {
        available: false,
        version: null,
        reason: 'error',
        message: error && error.message ? error.message : String(error)
      };
    }
  },

  async 'tmux/sessions'() {
    const sessions = await tmuxSessions();
    return { available: true, sessions: sessions };
  },

  async 'tmux/panes'(params) {
    const panes = await tmuxPanes(params && params.session ? String(params.session) : null);
    return { available: true, panes: panes };
  },

  async 'tmux/capture'(params) {
    return tmuxCapture(params && params.target, params && params.lines);
  },

  async 'tmux/send'(params) {
    return tmuxSend(params && params.target, params || {});
  }
};

readline.createInterface({ input: process.stdin }).on('line', async function (line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    fail(null, -32700, 'Parse error');
    return;
  }
  const handler = handlers[request.method];
  if (!handler) {
    fail(request.id, -32601, 'Method not found: ' + request.method);
    return;
  }
  try {
    const result = await handler(request.params || {});
    reply({ jsonrpc: '2.0', id: request.id, result: result });
  } catch (error) {
    fail(request.id, -32000, error && error.message ? error.message : String(error));
  }
});

process.on('exit', function () {
  if (subscription.socket) {
    try { subscription.socket.destroy(); } catch (error) { void error; }
  }
});
