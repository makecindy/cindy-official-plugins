'use strict';

const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const DEFAULT_TIMEOUT_MS = 120000;
// Herdr 自己的等待（参数里的 timeout_ms）先到点并返回 timeout；worker 的 socket
// 计时要比它晚一截，否则同一时刻超时会抢先把错误定成「结果未知」。
const WORKER_TIMEOUT_MARGIN_MS = 15000;
const WORKER_TIMEOUT_MAX_MS = 120000;

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

// Herdr 没起来、socket 不存在或没权限：换成带错误码的可行动描述，
// 主进程再按宿主语言给出提示，而不是把 ENOENT 这种底层消息直接丢给用户。
function describeConnectionError(error) {
  const code = error && error.code;
  const path = socketPath();
  if (code === 'ENOENT' || code === 'ECONNREFUSED') {
    const wrapped = new Error('HERDR_NOT_RUNNING: 找不到或连不上 Herdr 的 socket（' + path + '）。');
    wrapped.code = 'HERDR_NOT_RUNNING';
    return wrapped;
  }
  if (code === 'EACCES' || code === 'EPERM') {
    const wrapped = new Error('HERDR_SOCKET_DENIED: 没有权限访问 Herdr 的 socket（' + path + '）。');
    wrapped.code = 'HERDR_SOCKET_DENIED';
    return wrapped;
  }
  return error;
}

function fail(id, code, message) {
  reply({ jsonrpc: '2.0', id: id, error: { code: code, message: message } });
}

// 写操作「已发出但结果未知」的错误：调用方必须先核对终端实际状态，
// 不要盲目重试（重试可能重复发送输入、任务或关闭操作）。
// 「写入后等待」的超时：提示词已经发出去了，只是没等到目标状态。
function outcomeUnknownWait(method) {
  // 同时带上英文 timeout 标记：专用等待路径（herdr_prompt/wait_until）
  // 据此继续分段等待；原始 herdr_call 的调用方看到的仍是结果未知。
  const error = new Error(
    'HERDR_OUTCOME_UNKNOWN: timeout: ' + method + ' 已提交，但等待目标状态超时。'
    + '请先读取画面确认实际状态，再决定是否重发，避免重复执行。'
  );
  error.code = 'HERDR_OUTCOME_UNKNOWN';
  return error;
}

function outcomeUnknown(method) {
  const error = new Error(
    'HERDR_OUTCOME_UNKNOWN: 请求已发出但未收到回包（' + method
    + '）。操作可能已经生效，请先读取终端/分屏确认实际状态，再决定是否重试。'
  );
  error.code = 'HERDR_OUTCOME_UNKNOWN';
  return error;
}

const crypto = require('node:crypto');

// 请求 id 不用可预测的序号：一次连接里 id 要能唯一对应请求，
// 用随机 id 顺带避免不同会话/进程撞号。
function nextId() {
  return 'w_' + crypto.randomUUID();
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
    // sent 表示请求已经写进 socket。写进去之后超时或断线，就不能断言
    // 「没执行」——写操作可能已经生效，只是回包没回来。这种情况必须报
    // 「结果未知」，让调用方先核对实际状态再决定是否重试。
    let sent = false;
    const timer = setTimeout(function () {
      finish(reject, sent
        ? outcomeUnknown(method)
        : new Error('herdr 请求超时（未发出）：' + method));
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
      sent = true;
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
          // 请求已经发出去了：回包解析不了不能报「没执行」。
          finish(reject, sent
            ? outcomeUnknown(method)
            : new Error('herdr 返回了无法解析的响应'));
          return;
        }
        if (message.id && message.id !== id) continue;
        if (message.error) {
          // agent.prompt 带 wait 的 timeout = 提示已发送、只是没等到状态：
          // 必须报「结果未知」，否则调用方重试会重复发提示。
          if (message.error.code === 'timeout' && method === 'agent.prompt' && params && params.wait) {
            finish(reject, outcomeUnknownWait('agent.prompt'));
            return;
          }
          // 保留 Herdr 的错误码（例如 timeout）：上层据此判断「继续等」还是「失败」。
          const error = new Error(message.error.code + ': ' + message.error.message);
          error.code = message.error.code;
          finish(reject, error);
          return;
        }
        if (message.result !== undefined) {
          finish(resolve, message.result);
          return;
        }
      }
    });

    socket.on('error', function (error) {
      finish(reject, sent ? outcomeUnknown(method) : describeConnectionError(error));
    });
    socket.on('close', function () {
      if (!settled) {
        finish(reject, sent
          ? outcomeUnknown(method)
          : new Error('herdr 连接在返回前关闭（未发出）：' + method));
      }
    });
  });
}

// --- Event subscription -------------------------------------------------

// 订阅要守住三件事：① 同一时刻只有一条订阅连接（并发订阅会重复投递同一个事件，
// 让自动化跑两遍）；② 连接断开后自己回来（Herdr 重启不能让通知永久停摆）；
// ③ 分屏增减后重新订阅（状态事件按 pane_id 订阅，新分屏不在旧列表里；而且引用
// 已经消失的分屏会让整条订阅请求被 Herdr 拒绝）。
const subscription = {
  socket: null,
  paneIds: [],
  running: false,
  desired: false,
  attempts: 0,
  retryTimer: null,
  refreshTimer: null
};

const SUBSCRIPTION_RETRY_MIN_MS = 2000;
const SUBSCRIPTION_RETRY_MAX_MS = 30000;
const PANE_REFRESH_DEBOUNCE_MS = 300;

// 订阅的建立与替换串行执行：两个请求同时进来时，后一个不能覆盖前一个的连接，
// 否则前一条连接还在收事件，同一个 blocked/done 会触发两次自动化。
let subscriptionLock = Promise.resolve();

function withSubscriptionLock(task) {
  const result = subscriptionLock.then(task, task);
  subscriptionLock = result.then(function () {}, function () {});
  return result;
}

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

// 订阅时用点号命名，推送出来是下划线，两种写法都要认。
function isPaneLifecycleEvent(event) {
  return ['pane.created', 'pane.closed', 'pane.exited'].some(function (name) {
    return event === name || event === name.replace(/\./g, '_');
  });
}

// 事件等待：在已有的订阅流上等一个事件名（点号与下划线两种写法都认），
// 可选按 pane_id 过滤。不用 events.wait：那个接口要求完整的内部标签结构，
// 调用方很难拼对，而在订阅流上等语义更直接。
const eventWaiters = [];

function matchesEvent(waiter, event, data) {
  const wanted = String(waiter.event || '');
  if (wanted) {
    const normalized = wanted.replace(/\./g, '_');
    const actual = String(event || '');
    if (actual !== wanted
      && actual.replace(/\./g, '_') !== normalized
      && actual !== normalized) {
      return false;
    }
  }
  if (waiter.pane_id) {
    // 指定了 pane：事件没带 pane_id（workspace/tab 等全局事件）也算不匹配。
    if (!data || data.pane_id !== waiter.pane_id) return false;
  }
  return true;
}

function notifyEventWaiters(event, data) {
  for (let index = eventWaiters.length - 1; index >= 0; index -= 1) {
    const waiter = eventWaiters[index];
    if (!matchesEvent(waiter, event, data)) continue;
    eventWaiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve({ event: event, data: data });
  }
}

function handleEvent(message) {
  const data = message.data || {};
  notify('herdr/event', { event: message.event, data: data });
  notifyEventWaiters(message.event, data);
  // 分屏变了就重新订阅：新分屏的状态事件否则收不到，已关闭的分屏还会让整条
  // 订阅请求被 Herdr 拒绝。
  if (isPaneLifecycleEvent(message.event)) schedulePaneRefresh();
}

async function openSubscription() {
  // 先留着旧连接：新的订阅确认之后再关，切换期间的 blocked/done 不会漏。
  // 新的失败时旧连接继续服务，不会出现没人收事件的空窗。
  const previous = subscription.socket;

  const paneIds = await listPaneIds();
  subscription.paneIds = paneIds;
  const entries = buildEntries(paneIds);
  const id = nextId();
  const socket = net.createConnection(socketPath());
  subscription.socket = socket;

  try {
    await new Promise(function (resolve, reject) {
    let buffer = '';
    let settled = false;
    const timer = setTimeout(function () { finish(reject, new Error('订阅连接超时')); }, 15000);

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    }

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
          if (message.error) {
            finish(reject, new Error(message.error.code + ': ' + message.error.message));
          } else {
            // 订阅确认的同一段数据里就开始以新连接为准，避免交接期间
            // 新旧两条连接各转发一次事件。
            socket.isCurrentSubscription = true;
            if (previous) previous.isCurrentSubscription = false;
            finish(resolve);
          }
          continue;
        }
        if (message.event && socket.isCurrentSubscription) handleEvent(message);
      }
    });
    socket.on('error', function (error) {
      finish(reject, error);
    });
      socket.on('close', function () {
        if (socket.herdrIntentionalClose) return;
        // 只清理属于自己的状态：旧连接的 close 不能抹掉新连接。
        if (subscription.socket === socket) {
          subscription.socket = null;
          subscription.running = false;
        }
        if (!settled) finish(reject, new Error('订阅连接在确认前关闭'));
        scheduleReconnect();
      });
    });
  } catch (error) {
    // 新订阅没成：无论 close 回调有没有先把记录清掉，都要把旧连接
    // 接回来（还活着）或排一次重连（已经死了），不能让它失管。
    try { socket.destroy(); } catch (destroyError) { void destroyError; }
    if (previous && previous !== socket && !previous.destroyed) {
      subscription.socket = previous;
      subscription.running = true;
      previous.isCurrentSubscription = true;
    } else {
      subscription.socket = null;
      subscription.running = false;
      if (subscription.desired) scheduleReconnect();
    }
    throw error;
  }
  subscription.running = true;
  subscription.attempts = 0;
  // 新连接已经确认，再关旧的（主动关不触发重连，也不清新连接的状态）。
  if (previous && previous !== socket) {
    previous.herdrIntentionalClose = true;
    try { previous.destroy(); } catch (error) { void error; }
  }
}

async function closeSubscription() {
  const socket = subscription.socket;
  subscription.socket = null;
  subscription.running = false;
  if (socket) {
    socket.herdrIntentionalClose = true;
    try { socket.destroy(); } catch (error) { void error; }
  }
}

// 断线后自己回来（间隔重试，封顶 30 秒）。只有用户主动退订时才不再重连。
function scheduleReconnect() {
  if (!subscription.desired) return;
  if (subscription.retryTimer) return;
  subscription.attempts += 1;
  const delay = Math.min(
    SUBSCRIPTION_RETRY_MAX_MS,
    SUBSCRIPTION_RETRY_MIN_MS * subscription.attempts
  );
  subscription.retryTimer = setTimeout(function () {
    subscription.retryTimer = null;
    withSubscriptionLock(async function () {
      if (!subscription.desired) return;
      try {
        await openSubscription();
      } catch (error) {
        scheduleReconnect();
      }
    });
  }, delay);
  if (subscription.retryTimer.unref) subscription.retryTimer.unref();
}

// 分屏增减后重建订阅（去抖，避免连续事件触发多次重连）。
function schedulePaneRefresh() {
  if (subscription.refreshTimer) return;
  subscription.refreshTimer = setTimeout(function () {
    subscription.refreshTimer = null;
    withSubscriptionLock(async function () {
      if (!subscription.desired) return;
      try {
        await openSubscription();
      } catch (error) {
        scheduleReconnect();
      }
    });
  }, PANE_REFRESH_DEBOUNCE_MS);
  if (subscription.refreshTimer.unref) subscription.refreshTimer.unref();
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
  // -s 让 list-panes 列出整个 session 的所有窗口，而不是只看目标窗口。
  const args = session
    ? ['list-panes', '-s', '-t', String(session), '-F', TMUX_PANE_FORMAT]
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
  const requested = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const want = Math.min(requested, 5000);   // tmux 历史区一次最多取 5000 行
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
    // 请求超过 5000 行时行数被封顶：必须如实标记，否则调用方分不清
    // 「历史只有这么多」和「更早的行没取」。
    truncated: truncated || requested > want,
    requested_lines: requested || null,
    max_lines: 5000
  };
}

// tmux 自己的命令行解析就是一层注入面：spawn 不经 shell，但 tmux 仍会把独立的
// `;` 当命令分隔符，把以 `-` 开头的值当选项。所以按键只允许「键名」形态，
// 并且用 `--` 结束选项解析。
// tmux(1) 对无法识别的键名会「当作一系列字符发出去」——拼错的 Entter 会变成
// 字面文本。所以只接受 tmux 真正认识的键名：单字符字面量，或「修饰键前缀 +
// tmux 键名」。修饰键只允许 tmux 文档里的 C- / M- / S-。
const TMUX_NAMED_KEY = /^(Escape|BSpace|BTab|DC|Down|End|F[1-9]|F1[0-2]|Home|IC|Left|NPage|PPage|Right|Up|Tab|Enter|Space)$/;

function isTmuxKeyName(value) {
  // tmux 的命令列表用分号分隔（tmux(1) COMMANDS）：`--` 只结束选项解析，
  // 挡不住它。含分号的键一律拒绝，避免把后续 argv 变成另一条 tmux 命令。
  if (value.indexOf(';') >= 0) return false;
  if (value.length === 1) return true;               // 单字符（含标点、'-'）
  const parts = value.split('-');
  let index = 0;
  while (index < parts.length - 1) {
    if (!/^[CMS]$/.test(parts[index])) return false; // 只认 C- / M- / S-
    index += 1;
  }
  const base = parts.slice(index).join('-');
  return TMUX_NAMED_KEY.test(base) || base.length === 1;
}

function validateTmuxKeys(keys) {
  return keys.map(function (key) {
    const value = String(key);
    if (!isTmuxKeyName(value)) {
      throw tmuxError(
        '不支持的按键：' + value
        + '（只接受 tmux 认识的键名，如 Enter、Escape、F1、C-c、M-x、S-Tab）',
        'TMUX_BAD_KEY'
      );
    }
    return value;
  });
}

// 写操作的超时不是「没执行」：命令可能已经交给 tmux server，
// 只是客户端没在时限内退出。必须报「结果未知」，让调用方先看画面。
function tmuxOutcomeUnknown(target, what) {
  const error = new Error(
    'HERDR_OUTCOME_UNKNOWN: tmux 命令已交给 ' + target + '，但超时没有回执（' + what
    + '）。可能已经生效，请先读取画面确认，再决定是否重试。'
  );
  error.code = 'HERDR_OUTCOME_UNKNOWN';
  return error;
}

async function tmuxWrite(args, what) {
  try {
    await runTmux(args);
  } catch (error) {
    if (error && error.code === 'TMUX_TIMEOUT') throw tmuxOutcomeUnknown(args[args.indexOf('-t') + 1], what);
    throw error;
  }
}

async function tmuxSend(target, params) {
  const dest = String(target || '');
  if (!dest) throw tmuxError('缺少 target', 'TMUX_BAD_TARGET');
  const keys = Array.isArray(params.keys) && params.keys.length
    ? validateTmuxKeys(params.keys)
    : null;
  if (keys) {
    await tmuxWrite(['send-keys', '-t', dest, '--'].concat(keys), '按键');
    return { target: dest, mode: 'keys', keys: keys };
  }
  if (params.text === undefined || params.text === null) {
    throw tmuxError('缺少 text 或 keys', 'TMUX_BAD_TARGET');
  }
  // -l 让 tmux 把内容当字面量，不解释 C-b / Enter 这类键名；-- 允许以 - 开头的文本。
  await tmuxWrite(['send-keys', '-t', dest, '-l', '--', String(params.text)], '文本');
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
    const inner = params.params || {};
    // 除 params.timeout_ms 外，agent.prompt 的等待还挂在 wait.timeout_ms 上
    // （提交提示词 + 等待是一个请求），两处都要算进余量。
    const innerWait = Math.max(
      Number(inner.timeout_ms || 0),
      Number((inner.wait && inner.wait.timeout_ms) || 0)
    );
    // 外层 = 调用方给的上限，但至少比 Herdr 内层等待多留一点余量。
    const requested = Math.max(
      Number(params.timeout_ms || 0),
      innerWait > 0 ? innerWait + WORKER_TIMEOUT_MARGIN_MS : 0
    );
    const timeout = requested > 0 ? Math.min(requested, WORKER_TIMEOUT_MAX_MS) : 0;
    return callOnce(method, inner, timeout || undefined);
  },

  async 'herdr/snapshot'() {
    return callOnce('session.snapshot', {}, 30000);
  },

  async 'herdr/subscribe'() {
    subscription.desired = true;
    try {
      await withSubscriptionLock(async function () {
        await openSubscription();
      });
    } catch (error) {
      scheduleReconnect();
      throw error;
    }
    return { subscribed: true, panes: subscription.paneIds.length };
  },

  async 'herdr/configure'() {
    subscription.desired = true;
    try {
      await withSubscriptionLock(async function () {
        await openSubscription();
      });
    } catch (error) {
      scheduleReconnect();
      throw error;
    }
    return { ok: true };
  },

  async 'herdr/wait-event'(params) {
    const requested = Number(params.timeout_ms || 0);
    const timeoutMs = requested > 0 ? Math.min(requested, 60000) : 60000;
    // 用户退订过就不能借 wait 把长连接重新打开（否则通知和自动化会自己回来）。
    if (!subscription.desired) {
      const error = new Error('HERDR_UNSUBSCRIBED: 已退订，事件等待需要先订阅（herdr_events mode=subscribe）。');
      error.code = 'HERDR_UNSUBSCRIBED';
      throw error;
    }
    if (!subscription.running) {
      await withSubscriptionLock(async function () {
        await openSubscription();
      });
    }
    return new Promise(function (resolve, reject) {
      const waiter = {
        event: params.event || '',
        pane_id: params.pane_id || null,
        resolve: resolve,
        reject: reject,
        timer: null
      };
      waiter.timer = setTimeout(function () {
        const index = eventWaiters.indexOf(waiter);
        if (index >= 0) eventWaiters.splice(index, 1);
        // 消息里带 timeout 前缀，上层据此判断「接着等下一段」而不是当失败。
        reject(new Error('timeout: 等待事件超时：' + (waiter.event || '任意事件')));
      }, timeoutMs);
      eventWaiters.push(waiter);
    });
  },

  async 'herdr/status'() {
    return {
      subscribed: subscription.running,
      panes: subscription.paneIds.length,
      socket: socketPath()
    };
  },

  async 'herdr/unsubscribe'() {
    subscription.desired = false;
    subscription.attempts = 0;
    if (subscription.retryTimer) {
      clearTimeout(subscription.retryTimer);
      subscription.retryTimer = null;
    }
    if (subscription.refreshTimer) {
      clearTimeout(subscription.refreshTimer);
      subscription.refreshTimer = null;
    }
    await withSubscriptionLock(async function () {
      await closeSubscription();
    });
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
