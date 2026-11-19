'use strict';

// Cindy plugin brain: exposes Herdr to the agent, drives the side panel,
// and bridges Herdr events into Cindy notifications and automation webhooks.

const CHANNEL = 'cindy-plugin-herdr';
// KV 里只放自动化 id（不是凭据）。Webhook 接收地址本身是能触发自动化的持有式
// 凭据，所以插件从不保存、也不返回它：事件由插件交给宿主调度器去唤醒自动化。
const SCHEDULE_ID_KEY = 'herdrScheduleId';
// 用户显式退订过的偏好：宿主 wake 不能把它悄悄撤销。
const SUBSCRIBED_KEY = 'herdrSubscribed';
// null = 还没表态；true/false = 用户的选择（优先于 KV，因为 KV 可能读不到）。
let subscriptionPreference = null;
// 同一个 agent 连续进入 blocked/done 时不要反复唤醒自动化。
const TRIGGER_THROTTLE_MS = 30000;
// 本插件创建的自动化，prompt 末尾都带这个标记；只有带标记、且 manual 的才复用，
// 避免把用户已有的同名定时任务误当成自己的事件桥。
const AUTOMATION_MARK = '[cindy-plugin:herdr]';
const AUTOMATION_PROMPT_DEFAULT = 'Herdr 报告终端里的 agent 状态发生变化。请用 Herdr 插件的工具读取最新画面，'
  + '判断发生了什么，只在需要用户决策或值得提醒时汇报。';
let lastTriggerAt = 0;
let triggerTimer = null;

// 宿主给随包 Node 进程的单次请求上限是 120 秒，超时就断。长等待因此拆成一段段
// 的短请求：每段最多 WAIT_CHUNK_MS，段内超时（Herdr 返回 timeout）就接着等下一段，
// 直到用户给的等待上限。主机这一层的等待要比 Herdr 那一段略长，否则先断的是主机。
const HOST_REQUEST_TIMEOUT_MAX_MS = 120000;
const WAIT_CHUNK_MS = 45000;
// 宿主这一层要比 worker 的 socket 计时更晚到点（worker = 内层 + 15s），
// 否则宿主会先把续段循环打断。45s 的一段因此是 45 < 60 < 70 秒的次序。
const WAIT_CHUNK_MARGIN_MS = 25000;

// Herdr 连不上时，把 Node 的底层错误码换成可行动的本地化提示。
function localizeHerdrError(message) {
  const text = String(message || '');
  if (/HERDR_NOT_RUNNING/.test(text)) return runtime.herdrNotRunning;
  if (/HERDR_SOCKET_DENIED/.test(text)) return runtime.herdrSocketDenied;
  if (/HERDR_UNSUBSCRIBED/.test(text)) return runtime.herdrUnsubscribed;
  return text;
}

// 运行时文案跟随宿主语言：只读 /app-context 的 uiLocale ?? locale，
// 插件没提供的语言回退英文。不读 navigator.language。
const runtimeStrings = {
  'zh-CN': {
    notifyBlocked: '需要处理',
    notifyDone: '已完成',
    badgeBlocked: '待处理',
    badgeDone: '已完成',
    agentFallback: 'agent',
    automationFailed: '创建自动化失败：',
    automationUnknown: '未知错误',
    automationNoId: '自动化已创建，但没拿到 id，请到自动化列表里查看',
    automationSaveFailed: '自动化 id 没有保存成功，事件桥暂时不会触发；请重新调用本工具重试',
    kvReadFailed: '读取插件存储失败，暂不改动自动化配置',
    waitTimeout: '等待超时',
    nodeFailed: 'Node 工作进程调用失败',
    missingTarget: '缺少 target（session、window 或 pane 的名字）',
    missingTextOrKeys: '缺少 text 或 keys',
    unknownPanelAction: '未知的面板动作：',
    herdrNotRunning: '找不到或连不上 Herdr 的 socket。请先启动 Herdr，或用 HERDR_SOCKET_PATH 指定正确路径。',
    herdrSocketDenied: '没有权限访问 Herdr 的 socket。请检查文件权限，或用 HERDR_SOCKET_PATH 指定路径。',
    herdrUnsubscribed: '已经退订事件，无法等待事件；先用 herdr_events 的 subscribe 恢复订阅。',
    tmuxMissingHint: '这台电脑上没有 tmux。装上 tmux 后这里会列出 session 与 pane。'
  },
  en: {
    notifyBlocked: 'needs attention',
    notifyDone: 'finished',
    badgeBlocked: 'needs attention',
    badgeDone: 'finished',
    agentFallback: 'agent',
    automationFailed: 'Could not create the automation: ',
    automationUnknown: 'unknown error',
    automationNoId: 'The automation was created but returned no id; check the automation list',
    automationSaveFailed: 'The automation id could not be saved, so events will not trigger; call this tool again',
    kvReadFailed: 'Could not read plugin storage; automation setup was left untouched',
    waitTimeout: 'Timed out',
    nodeFailed: 'The bundled Node worker call failed',
    missingTarget: 'target is required (session, window, or pane name)',
    missingTextOrKeys: 'text or keys is required',
    unknownPanelAction: 'Unknown panel action: ',
    herdrNotRunning: 'The Herdr socket is missing or unreachable. Start Herdr, or point HERDR_SOCKET_PATH at the right socket.',
    herdrSocketDenied: 'No permission to access the Herdr socket. Check its file permissions, or point HERDR_SOCKET_PATH at it.',
    herdrUnsubscribed: 'Events are unsubscribed, so no event can be waited on; subscribe again with herdr_events first.',
    tmuxMissingHint: 'tmux is not installed on this computer. Install it to list sessions and panes here.'
  }
};

let runtime = runtimeStrings.en;

async function loadRuntimeLocale() {
  try {
    const response = await cindy.request({ kind: 'app-context' });
    const context = (response && response.context) || {};
    const locale = context.uiLocale || context.locale;
    runtime = runtimeStrings[locale] || runtimeStrings.en;
  } catch (error) {
    runtime = runtimeStrings.en;
  }
}

const channel = new BroadcastChannel(CHANNEL);

let pendingPanelRequests = new Map();

function replyTool(callId, ok, payload) {
  if (ok) {
    return cindy.send({
      type: 'tool-result',
      callId: callId,
      ok: true,
      result: payload
    });
  }
  return cindy.send({
    type: 'tool-result',
    callId: callId,
    ok: false,
    errorCode: payload.errorCode || 'HERDR_REQUEST_FAILED',
    message: payload.message || 'herdr 调用失败'
  });
}

function isUnknownOutcome(error) {
  return /HERDR_OUTCOME_UNKNOWN/.test(String((error && error.message) || ''));
}

// 只读的 Herdr 方法：传输断了就是普通失败；其余（含 tmux/send）
// 可能已经交给本机执行，必须报「结果未知」。
const READ_ONLY_HERDR_METHODS = {
  ping: true, 'session.snapshot': true, 'pane.read': true, 'pane.list': true,
  'pane.get': true, 'pane.current': true, 'agent.read': true, 'agent.list': true,
  'agent.get': true, 'workspace.list': true, 'workspace.get': true,
  'tab.list': true, 'tab.get': true, 'worktree.list': true, 'events.wait': true
};

function isPotentiallyMutating(method, params) {
  if (method === 'tmux/send') return true;
  if (method !== 'herdr/request') return false;   // tmux/read、tmux/sessions 等
  const inner = params && params.method;
  return !READ_ONLY_HERDR_METHODS[inner];
}

async function nodeRequest(method, params, callId, timeoutMs) {
  const request = { method: method, params: params || {} };
  if (callId) request.callId = callId;
  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    request.timeoutMs = Math.min(Math.round(timeoutMs), HOST_REQUEST_TIMEOUT_MAX_MS);
  }
  let response;
  try {
    response = await cindy.node.request(request);
  } catch (error) {
    // 传输层断了（worker 崩溃、stdio 掉线）：请求可能已经交给本机执行，
    // 写路径必须报「结果未知」，否则重试会重复执行。
    if (isPotentiallyMutating(method, request.params)) {
      throw new Error(
        'HERDR_OUTCOME_UNKNOWN: 与插件工作进程的连接中断，请求可能已执行；'
        + '请先核对终端实际状态，再决定是否重试。'
      );
    }
    throw error;
  }
  if (!response.ok) {
    const error = new Error(localizeHerdrError(response.message) || runtime.nodeFailed);
    error.code = response.errorCode;
    throw error;
  }
  return response.result;
}

// 普通调用（读状态、发输入、关闭分屏等）也要给明确预算：不给的话宿主按
// 默认 30 秒断，而 worker 默认等 120 秒，写操作可能已经生效、宿主却先报一个
// 普通 Node 失败，丢掉「结果未知」这个可核对的信号。这里让 worker 先到点。
const DEFAULT_HERDR_CALL_TIMEOUT_MS = 45000;
// worker 的 socket 计时 = 内层等待 + 这个余量（与 worker.cjs 保持一致）。
const WORKER_TIMEOUT_MARGIN_MS = 15000;
// 原始 herdr_call 允许的最大内层等待：再长的话宿主 120 秒上限兜不住，
// 会被迫切成「宿主先断、worker 还在等」。更长的等待请用分段的 herdr_wait。
const RAW_WAIT_MAX_MS = 90000;

function clampRawWait(params) {
  const clamp = function (value) {
    return Number(value) > RAW_WAIT_MAX_MS ? RAW_WAIT_MAX_MS : value;
  };
  if (params.timeout_ms !== undefined) params.timeout_ms = clamp(params.timeout_ms);
  if (params.wait && params.wait.timeout_ms !== undefined) {
    params.wait.timeout_ms = clamp(params.wait.timeout_ms);
  }
  return params;
}

// 三层预算从同一个内层截止时间派生：内层 ≤ 90s → worker ≤ 105s → 宿主 120s，
// 顺序永远是 内层 < worker < 宿主。
async function herdrCall(method, params, callId, timeoutMs) {
  const inner = Math.max(
    Number((params && params.timeout_ms) || 0),
    Number((params && params.wait && params.wait.timeout_ms) || 0)
  );
  let budget;
  if (typeof timeoutMs === 'number' && timeoutMs > 0) budget = timeoutMs;
  else if (inner > 0) budget = inner + WORKER_TIMEOUT_MARGIN_MS;
  else budget = DEFAULT_HERDR_CALL_TIMEOUT_MS;
  budget = Math.min(budget, HOST_REQUEST_TIMEOUT_MAX_MS - WAIT_CHUNK_MARGIN_MS);
  const request = { method: method, params: params || {}, timeout_ms: budget };
  return nodeRequest('herdr/request', request, callId, budget + WAIT_CHUNK_MARGIN_MS);
}

// Herdr 等待超时时返回 code=timeout；这属于「还没等到」，可以接着等下一段。
// 其他错误（例如 agent_blocked）要原样抛出去。
function isTimeoutError(error) {
  const text = String((error && error.message) || '');
  return /(^|[\s:])timeout([\s:]|$)/i.test(text) || /timed out/i.test(text);
}

// 读取失败必须抛出来：当成空配置会让事件触发以为「没配过」而丢掉这次唤醒，
// setup 还会因此新建第二条自动化、覆盖归属 id。
async function readKv() {
  const response = await fetch('/kv');
  if (!response || response.ok === false) {
    throw new Error(runtime.kvReadFailed);
  }
  const value = await response.json();
  return value && typeof value === 'object' ? value : {};
}

// 上次成功读到的自动化 id：存储暂时不可读时用它兜底，不丢这次唤醒。
let cachedScheduleId = null;

async function readScheduleId() {
  const kv = await readKv();
  const id = kv[SCHEDULE_ID_KEY];
  if (id) {
    cachedScheduleId = id;
    return id;
  }
  return cachedScheduleId;
}

async function writeKv(patch) {
  const current = await readKv();
  const next = Object.assign({}, current, patch);
  const response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(next) });
  // 不看响应的话，存没存上根本无从判断——返回的只是内存里的对象。
  if (!response || response.ok === false) {
    throw new Error(runtime.automationSaveFailed);
  }
  return next;
}

function unwrapSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.snapshot && typeof raw.snapshot === 'object') return raw.snapshot;
  return raw;
}

function textOf(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

// 一段一段地等 agent 状态：每段最多 WAIT_CHUNK_MS，段内超时（Herdr 返回
// timeout）就接着等下一段，直到到达目标状态或用完等待上限。
async function waitForAgentState(target, until, deadline, callId) {
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error('等待 agent 状态超时（' + until.join('/') + '）');
    }
    const chunk = Math.min(remaining, WAIT_CHUNK_MS);
    try {
      return await herdrCall('agent.wait', {
        target: target,
        until: until,
        timeout_ms: chunk
      }, callId, chunk);
    } catch (error) {
      if (!isTimeoutError(error)) throw error;
    }
  }
}

// 宿主工具回执有两层：外层 isError，正文里还可能有 { ok:false }。
// 只看外层会把「传输成功但业务失败」当成成功。
function hostBody(call) {
  const detail = call && call.content && call.content[0] && call.content[0].text;
  let body = null;
  let parsed = false;
  if (detail) {
    try { body = JSON.parse(detail); parsed = true; } catch (error) { body = null; }
  }
  if (call && call.isError) return { ok: false, parsed: parsed, body: body, detail: detail, explicit: true };
  // 明确的业务拒绝（解析出来 ok:false）才算失败；解析不了/没有正文属于
  // 「结果未知」——写操作可能已经生效，不能报成明确的业务失败。
  if (parsed && body && body.ok === false) {
    return { ok: false, parsed: parsed, body: body, detail: detail, explicit: true };
  }
  if (!parsed || !body || body.ok !== true) {
    return { ok: false, parsed: parsed, body: body, detail: detail, explicit: false };
  }
  return { ok: true, parsed: parsed, body: body, detail: detail, explicit: true };
}

// 用户可能已经把那条自动化删了：NOT_FOUND 属于「没有了，可以重建」，
// 不是「查询失败」。
function isNotFound(outcome) {
  const text = String(outcome.detail || '');
  const code = outcome.body && outcome.body.errorCode;
  return code === 'NOT_FOUND' || text.indexOf('NOT_FOUND') >= 0;
}

// 判断一条已有自动化是不是本插件建的，并且和本次要求完全对得上。
// 任何一项不匹配都不复用——复用错任务会让事件跑错内容、或把用户自己的
// 定时任务当成事件桥。
function isOurAutomation(item, name, args) {
  if (!item || item.name !== name) return false;
  if (item.manual !== true) return false;                // 不能复用会按时间自己跑的
  const prompt = String(item.prompt || '');
  if (prompt.indexOf(AUTOMATION_MARK) < 0) return false; // 不是本插件创建的
  // 会话差异不在这里否决：归属、manual、标记、active 都对得上，
  // 就认这条是我们的，再由调用处用 schedule_update 把绑定改成本次要求的。
  if (item.status && item.status !== 'active') return false;       // 非 active 复用不了
  // 精确匹配：把唯一的 marker 去掉后必须整串相等。
  // 前缀匹配会把「处理」当成「处理所有 pane」的改写而复用旧指令。
  if (args.prompt && prompt !== String(args.prompt) + '\n\n' + AUTOMATION_MARK) return false;
  if (args.agentKind && item.agentKind !== args.agentKind) return false;
  return true;
}

// 「只由事件唤醒」的自动化载荷：cronExpr/timezone 是 schema 必填项，
// manual=true 时它不会真的按时间跑，只是留着，用户以后想恢复定时触发不用重填。
function schedulePayload(name, args) {
  return {
    name: name,
    prompt: (args.prompt || AUTOMATION_PROMPT_DEFAULT) + '\n\n' + AUTOMATION_MARK,
    cronExpr: '0 9 * * *',
    timezone: args.timezone || 'Asia/Shanghai',
    recurring: true,
    manual: true,
    agentKind: args.agentKind || 'codex',
    targetSessionId: args.targetSessionId || undefined,
    // 工具契约写的是「默认静默」：省略时按 true，只有显式要求提醒才关掉。
    silentWhenIdle: args.silentWhenIdle !== false,
    notify: { desktop: true, feishu: false }
  };
}

// 整段「读 KV → 核对 → 创建/复用 → 写 KV」加互斥：两个会话并行 setup 时，
// 都读到「没有 id」会各建一条，后写的 id 还会覆盖先建的。
let setupLock = Promise.resolve();

function withSetupLock(task) {
  const result = setupLock.then(task, task);
  setupLock = result.then(function () {}, function () {});
  return result;
}

// 复用只认本插件自己记录的那一条：拿 KV 里的 id 去 schedule_get 取回来逐项核实，
// 不再按名称从全部自动化里挑——按名称挑会把用户的同名定时任务接到事件桥上。
// 认下来但会话不一致时，用 schedule_update 把绑定改成这次要求的，不新建重复任务。
async function ensureAutomationSchedule(name, args) {
  return withSetupLock(function () { return ensureAutomationScheduleUnlocked(name, args); });
}

async function ensureAutomationScheduleUnlocked(name, args) {
  // 读不到就抛：不能把「存储不可读」当成「没配过」再去新建一条。
  const kv = await readKv();
  const storedId = kv[SCHEDULE_ID_KEY];
  if (storedId) {
    const fetched = await cindy.host.call('cindy_scheduler', 'schedule_get', { id: storedId });
    const outcome = hostBody(fetched);
    if (!outcome.ok && !isNotFound(outcome)) {
      // 查询失败时不能闷头新建：那会让归属 id 被第二条覆盖。
      throw new Error(runtime.automationFailed + (outcome.detail || runtime.automationUnknown));
    }
    const info = outcome.ok ? outcome.body : null;
    const item = info && info.data;
    if (isOurAutomation(item, name, args)) {
      const wantSession = args.targetSessionId || null;
      const hasSession = Boolean(item.targetSessionId);
      if (wantSession && (!hasSession || item.targetSessionId !== wantSession)) {
        // 点名了会话（或换了会话）：直接改绑定。
        await hostWrite(cindy.host.call('cindy_scheduler', 'schedule_update', {
          id: storedId,
          targetSessionId: wantSession
        }));
      } else if (!wantSession && hasSession) {
        // 没点名会话 = 承诺「每次新开会话」。宿主不接受 null 解绑，
        // 所以新建一条未绑定的，成功后再删掉旧的（先确认旧的确实是我们的）。
        return await replaceUnboundSchedule(storedId, item, name, args);
      }
      // 常规复用（含会话改绑之后）都要走到这里：silentWhenIdle 只有这一条路径能落下去。
      // silentWhenIdle 是暴露给用户的工具参数：改了就必须写进 scheduler，
      // 否则返回旧 id、配置看起来生效了实际没生效。
      if (args.silentWhenIdle !== undefined
          && Boolean(item.silentWhenIdle) !== Boolean(args.silentWhenIdle)) {
        await hostWrite(cindy.host.call('cindy_scheduler', 'schedule_update', {
          id: storedId,
          silentWhenIdle: Boolean(args.silentWhenIdle)
        }));
      }
      await persistScheduleId(storedId);
      cachedScheduleId = storedId;
      return storedId;
    }
  }
  // 两个创建入口（普通新建、替换解绑）都走 hostWrite：回执丢失 = 结果未知，
  // 必须提示先核对，不能报普通失败让调用方重试出重复任务。
  const createdOutcome = await hostWrite(
    cindy.host.call('cindy_scheduler', 'schedule_create', schedulePayload(name, args))
  );
  const body = createdOutcome.body;
  const scheduleId = body.data && body.data.id;
  if (!scheduleId) throw new Error(runtime.automationNoId);
  // 先记缓存：即使接下来 KV 失败，本会话的事件唤醒也用得上这条新的。
  cachedScheduleId = scheduleId;
  await persistScheduleId(scheduleId);
  return scheduleId;
}

// 自动化已经确定创建了：KV 读或写失败都不能报「请重试」（重试会再建一条），
// 要带着已知 id 报「已创建但没存上，先核对」。
async function persistScheduleId(scheduleId) {
  let saved;
  try {
    saved = await writeKv({ [SCHEDULE_ID_KEY]: scheduleId });
  } catch (error) {
    throw new Error(
      'HERDR_OUTCOME_UNKNOWN: 自动化已创建（id=' + scheduleId + '），但 id 没保存成功。'
      + '请先核对自动化列表，不要直接重试重复创建。'
    );
  }
  if (saved[SCHEDULE_ID_KEY] !== scheduleId) {
    throw new Error(
      'HERDR_OUTCOME_UNKNOWN: 自动化已创建（id=' + scheduleId + '），但 id 没保存成功。'
      + '请先核对自动化列表，不要直接重试重复创建。'
    );
  }
}

// 旧任务已绑到别的会话、而这次要求不绑：宿主的 schedule_update 不接受
// targetSessionId:null，所以新建一条未绑定的；只有新条目保存成功后才删旧的，
// 且删之前再确认旧条目确实带本插件的标记。
async function replaceUnboundSchedule(storedId, oldItem, name, args) {
  const outcome = await hostWrite(
    cindy.host.call('cindy_scheduler', 'schedule_create', schedulePayload(name, args))
  );
  const body = outcome.body;
  const scheduleId = body && body.data && body.data.id;
  if (!scheduleId) throw new Error(runtime.automationNoId);
  cachedScheduleId = scheduleId;
  const saved = await writeKv({ [SCHEDULE_ID_KEY]: scheduleId });
  if (saved[SCHEDULE_ID_KEY] !== scheduleId) {
    throw new Error(
      'HERDR_OUTCOME_UNKNOWN: 自动化已创建（id=' + scheduleId + '），但 id 没保存成功。'
      + '请先核对自动化列表，不要直接重试重复创建。'
    );
  }
  if (isOurAutomation(oldItem, name, args)) {
    await hostWrite(cindy.host.call('cindy_scheduler', 'schedule_delete', { id: storedId }));
  }
  return scheduleId;
}

// 所有调度器写操作共用的回执处理：抛错 = 结果未知（可能已经生效），
// 明确失败 = 报错。两种都要让调用方先核对，不能当成「没执行」。
function hostWriteFailure(outcome) {
  return new Error(
    'HERDR_OUTCOME_UNKNOWN: 操作可能已经生效，但没拿到回执。'
    + '请先核对自动化列表确认实际状态，再决定是否重试。'
    + (outcome && outcome.detail ? '（' + outcome.detail + '）' : '')
  );
}

async function hostWrite(call) {
  let result;
  try {
    result = await call;
  } catch (error) {
    throw hostWriteFailure(null);
  }
  const outcome = hostBody(result);
  if (!outcome.ok) {
    // 明确拒绝（外层 isError、正文 ok:false）→ 报业务错误；
    // 回执解析不了 → 结果未知（写可能已经生效），提示先核对。
    if (outcome.explicit) {
      throw new Error(runtime.automationFailed + (outcome.detail || runtime.automationUnknown));
    }
    throw hostWriteFailure(outcome);
  }
  return outcome;
}

// 触发一次自动化并核对业务回执；失败时把限流窗口复位，
// 让下一次 blocked/done 能立刻重试，而不是被这次失败挡住。
async function runAutomationNow(scheduleId) {
  const called = await cindy.host.call('cindy_scheduler', 'schedule_run_now', { id: scheduleId });
  const outcome = hostBody(called);
  if (!outcome.ok) {
    lastTriggerAt = 0;
    throw new Error(runtime.automationFailed + (outcome.detail || runtime.automationUnknown));
  }
}

// Herdr 报告 agent 进入 blocked/done 时，让宿主调度器跑一次那条自动化。
// 由宿主负责投递，插件不持有也不外发任何地址。
// 限流窗口内到达的新事件不丢弃：合并成一次延后执行，否则后一个分屏的
// blocked/done 会一直没人处理。
async function triggerAutomation() {
  let scheduleId;
  try {
    scheduleId = await readScheduleId();
  } catch (error) {
    // 存储暂时读不了时退回上次记下的 id，不把这次唤醒直接丢掉。
    scheduleId = cachedScheduleId;
  }
  if (!scheduleId) return;
  const now = Date.now();
  if (triggerTimer) return;                       // 已经排了延后执行
  if (now - lastTriggerAt >= TRIGGER_THROTTLE_MS) {
    lastTriggerAt = now;
    try {
      await runAutomationNow(scheduleId);
    } catch (error) {
      void error;   // 后台唤醒没有读者；失败已复位限流，下个事件会重试
    }
    return;
  }
  const wait = TRIGGER_THROTTLE_MS - (now - lastTriggerAt);
  triggerTimer = setTimeout(async function () {
    triggerTimer = null;
    lastTriggerAt = Date.now();
    // 等待期间用户可能换掉或解绑了自动化：到点时重新读一次当前 id，
    // 不能再跑闭包里那条旧的。
    let current = scheduleId;
    try { current = await readScheduleId(); } catch (error) { current = cachedScheduleId; }
    if (!current) return;
    try {
      await runAutomationNow(current);
    } catch (error) {
      void error;
    }
  }, wait);
  if (triggerTimer.unref) triggerTimer.unref();
}


// --- Tool implementations ------------------------------------------------

const tools = {
  async herdr_state(args) {
    const params = {};
    if (args.workspace_id) params.workspace_id = args.workspace_id;
    const raw = await herdrCall('session.snapshot', params, args.__callId);
    const snapshot = unwrapSnapshot(raw);
    const workspaces = (snapshot && snapshot.workspaces) || [];
    const tabs = (snapshot && snapshot.tabs) || [];
    const panes = (snapshot && snapshot.panes) || [];
    const agents = (snapshot && snapshot.agents) || [];
    return {
      focused: snapshot && snapshot.focused,
      workspaces: workspaces.map(function (workspace) {
        return {
          workspace_id: workspace.workspace_id,
          label: workspace.label,
          focused: workspace.focused,
          pane_count: workspace.pane_count,
          tab_count: workspace.tab_count,
          active_tab_id: workspace.active_tab_id,
          agent_status: workspace.agent_status
        };
      }),
      tabs: tabs.map(function (tab) {
        return {
          tab_id: tab.tab_id,
          workspace_id: tab.workspace_id,
          label: tab.label,
          focused: tab.focused,
          pane_count: tab.pane_count
        };
      }),
      panes: panes.map(function (pane) {
        return {
          pane_id: pane.pane_id,
          workspace_id: pane.workspace_id,
          tab_id: pane.tab_id,
          label: pane.label || null,
          title: pane.terminal_title_stripped || pane.terminal_title || null,
          agent: pane.agent || null,
          agent_status: pane.agent_status || 'unknown',
          cwd: pane.cwd,
          focused: pane.focused
        };
      }),
      agents: agents.map(function (agent) {
        return {
          agent: agent.agent,
          pane_id: agent.pane_id,
          workspace_id: agent.workspace_id,
          tab_id: agent.tab_id,
          agent_status: agent.agent_status || 'unknown',
          title: agent.terminal_title_stripped || agent.terminal_title || null,
          cwd: agent.cwd
        };
      })
    };
  },

  async herdr_read(args) {
    const source = args.source || 'visible';
    const params = {
      source: source,
      lines: args.lines === undefined ? undefined : args.lines,
      strip_ansi: args.strip_ansi === false ? false : undefined
    };
    let result;
    if (args.pane_id && !args.target) {
      params.pane_id = args.pane_id;
      result = await herdrCall('pane.read', params, args.__callId);
    } else {
      params.target = args.target || args.pane_id;
      result = await herdrCall('agent.read', params, args.__callId);
    }
    const read = (result && (result.read || result.output)) || result || {};
    return {
      pane_id: read.pane_id || args.pane_id || args.target || null,
      source: read.source || source,
      text: textOf(read.text || read.content || ''),
      truncated: Boolean(read.truncated)
    };
  },

  async herdr_prompt(args) {
    const until = args.wait_until && args.wait_until.length ? args.wait_until : null;
    const timeoutMs = args.timeout_ms === undefined ? 120000 : Number(args.timeout_ms);
    if (!until) {
      const result = await herdrCall('agent.prompt', { target: args.target, text: args.text }, args.__callId);
      return {
        target: args.target,
        agent_status: result && result.agent_status ? result.agent_status : null,
        completion: result ? result.completion || null : null,
        result: result || null
      };
    }
    const deadline = Date.now() + timeoutMs;
    // 先发提示并等一段；这一段没等到目标状态（Herdr 返回 timeout）不算失败，
    // 接着用 agent.wait 一段段等下去，直到到达目标状态或用完等待上限。
    const firstChunk = Math.min(Math.max(timeoutMs, 1), WAIT_CHUNK_MS);
    try {
      const result = await herdrCall('agent.prompt', {
        target: args.target,
        text: args.text,
        wait: { until: until, timeout_ms: firstChunk }
      }, args.__callId, firstChunk);
      return {
        target: args.target,
        agent_status: result && result.agent_status ? result.agent_status : null,
        completion: result ? result.completion || null : null,
        result: result || null
      };
    } catch (error) {
      if (!isTimeoutError(error)) throw error;
    }
    try {
      const result = await waitForAgentState(args.target, until, deadline, args.__callId);
      return {
        target: args.target,
        agent_status: result && result.agent_status ? result.agent_status : null,
        completion: result ? result.completion || null : null,
        result: result || null
      };
    } catch (error) {
      // 提示词已经发出去了，等待没到目标状态——这不是「没执行」，
      // 必须让 Agent 知道别直接重发。
      if (/等待 agent 状态超时/.test(String(error && error.message))) {
        throw new Error(
          'HERDR_OUTCOME_UNKNOWN: 提示词已发送，但等待 ' + until.join('/')
          + ' 超时。请先读取画面确认状态，再决定是否重发，避免重复执行。'
        );
      }
      throw error;
    }
  },

  async herdr_send(args) {
    // 只传 pane_id 是无效参数：send_input 会把终端里已有的草稿提交掉，
    // 不能当成「空发送」执行，要像 tmux_send 一样明确报错。
    if (!(args.keys && args.keys.length) && (args.text === undefined || args.text === null || args.text === '')) {
      throw new Error(runtime.missingTextOrKeys);
    }
    if (args.pane_id && args.keys && args.keys.length) {
      const result = await herdrCall('pane.send_keys', {
        pane_id: args.pane_id,
        keys: args.keys
      }, args.__callId);
      return { pane_id: args.pane_id, mode: 'keys', result: result || null };
    }
    if (args.pane_id && args.text !== undefined) {
      const result = await herdrCall('pane.send_text', {
        pane_id: args.pane_id,
        text: args.text
      }, args.__callId);
      return { pane_id: args.pane_id, mode: 'text', result: result || null };
    }
    // 到这里说明 pane_id / text / keys 组合无效：schema 要求 pane_id 必填，
    // 上面的校验又要求 text 或 keys 至少有一个，所以不会再有第三种发送。
    throw new Error(runtime.missingTextOrKeys);
  },

  async herdr_wait(args) {
    const timeoutMs = args.timeout_ms === undefined ? 300000 : Number(args.timeout_ms);
    const deadline = Date.now() + timeoutMs;
    if (args.pane_id && args.match) {
      const match = typeof args.match === 'string'
        ? { type: 'substring', value: args.match }
        : args.match;
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('等待输出超时（' + timeoutMs + 'ms）');
        const chunk = Math.min(remaining, WAIT_CHUNK_MS);
        try {
          const result = await herdrCall('pane.wait_for_output', {
            pane_id: args.pane_id,
            source: args.source || 'visible',
            match: match,
            lines: args.lines === undefined ? undefined : args.lines,
            timeout_ms: chunk
          }, args.__callId, chunk);
          return { pane_id: args.pane_id, result: result || null };
        } catch (error) {
          if (!isTimeoutError(error)) throw error;
        }
      }
    }
    const until = args.until && args.until.length ? args.until : ['done'];
    const result = await waitForAgentState(args.target, until, deadline, args.__callId);
    return { target: args.target, result: result || null };
  },

  async herdr_control(args) {
    const area = String(args.area || 'workspace');
    const action = String(args.action || '');
    const params = Object.assign({}, args.params || {});
    if (args.workspace_id) params.workspace_id = args.workspace_id;
    if (args.tab_id) params.tab_id = args.tab_id;
    if (args.pane_id) params.pane_id = args.pane_id;
    if (args.direction) params.direction = args.direction;
    if (args.label !== undefined) params.label = args.label;
    if (args.cwd) params.cwd = args.cwd;
    if (args.ratio !== undefined) params.ratio = args.ratio;
    if (args.amount !== undefined) params.amount = args.amount;
    if (args.focus !== undefined) params.focus = args.focus;
    if (args.mode) params.mode = args.mode;
    if (args.command) params.command = args.command;
    if (args.branch) params.branch = args.branch;
    if (args.path) params.path = args.path;
    if (args.target_pane_id) params.target_pane_id = args.target_pane_id;
    const method = area + '.' + action;
    const result = await herdrCall(method, params, args.__callId);
    return { method: method, result: result || null };
  },

  async herdr_notify(args) {
    const params = { title: args.title };
    if (args.body) params.body = args.body;
    if (args.sound) params.sound = args.sound;
    if (args.position) params.position = args.position;
    const result = await herdrCall('notification.show', params, args.__callId);
    return result || null;
  },

  async herdr_events(args) {
    const mode = args.mode || 'status';
    if (mode === 'subscribe') {
      return enableSubscription(args.__callId);
    }
    if (mode === 'unsubscribe') {
      subscriptionPreference = false;
      await persistSubscriptionPreference(false);
      return nodeRequest('herdr/unsubscribe', {}, args.__callId);
    }
    if (mode === 'wait') {
      const timeoutMs = args.timeout_ms === undefined ? 60000 : Number(args.timeout_ms);
      const deadline = Date.now() + timeoutMs;
      const wanted = args.match_event || {};
      const eventName = typeof wanted === 'string' ? wanted : wanted.event || '';
      const paneId = typeof wanted === 'string' ? null : wanted.pane_id || null;
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('等待事件超时（' + timeoutMs + 'ms）');
        const chunk = Math.min(remaining, WAIT_CHUNK_MS);
        try {
          const result = await nodeRequest('herdr/wait-event', {
            event: eventName,
            pane_id: paneId,
            timeout_ms: chunk
          }, args.__callId, chunk + WAIT_CHUNK_MARGIN_MS);
          return result || null;
        } catch (error) {
          if (!isTimeoutError(error)) throw error;
        }
      }
    }
    return nodeRequest('herdr/status', {}, args.__callId);
  },

  async herdr_automation_setup(args) {
    const wantedName = args.name || 'Herdr 事件处理';
    const scheduleId = await ensureAutomationSchedule(wantedName, args);
    // 订阅要真的开着，否则事件到了也没人接；同时把偏好改回「订阅」，
    // 让重启后不会按旧的退订值停摆。
    await enableSubscription(args.__callId);
    return { schedule_id: scheduleId, name: wantedName, trigger: 'event-only' };
  },

  async herdr_call(args) {
    const params = clampRawWait(Object.assign({}, args.params || {}));
    const result = await herdrCall(args.method, params, args.__callId);
    return result === undefined ? null : result;
  },

  // --- tmux（同一插件的第二个后端；tmux 没装时降级，不抛错） ---

  async tmux_state(args) {
    const available = await nodeRequest('tmux/available', {}, args.__callId);
    if (!available.available) {
      return {
        available: false,
        version: null,
        reason: available.reason || 'error',
        message: available.message || null,
        sessions: [],
        panes: [],
        // 只有真的没装才给安装提示；权限/超时/执行失败保留具体原因。
        hint: available.reason === 'not-installed' ? runtime.tmuxMissingHint : null
      };
    }
    const sessions = await nodeRequest('tmux/sessions', {}, args.__callId);
    const panes = await nodeRequest(
      'tmux/panes',
      args.session ? { session: String(args.session) } : {},
      args.__callId
    );
    return {
      available: true,
      version: available.version,
      reason: null,
      message: null,
      sessions: sessions.sessions,
      panes: panes.panes
    };
  },

  async tmux_read(args) {
    if (!args.target) throw new Error(runtime.missingTarget);
    return nodeRequest('tmux/capture', {
      target: String(args.target),
      lines: args.lines === undefined ? undefined : args.lines
    }, args.__callId);
  },

  async tmux_send(args) {
    if (!args.target) throw new Error(runtime.missingTarget);
    const params = { target: String(args.target) };
    if (args.keys && args.keys.length) {
      params.keys = args.keys;
    } else if (args.text !== undefined && args.text !== null) {
      params.text = args.text;
    } else {
      throw new Error(runtime.missingTextOrKeys);
    }
    return nodeRequest('tmux/send', params, args.__callId);
  }
};

// --- Panel bridge --------------------------------------------------------

async function panelState() {
  // worker 的 herdr/snapshot 等 30 秒；宿主要留出余量，否则回包前就被掐掉。
  const raw = await nodeRequest('herdr/snapshot', {}, undefined, 45000);
  const snapshot = unwrapSnapshot(raw);
  const workspaces = (snapshot && snapshot.workspaces) || [];
  const tabs = (snapshot && snapshot.tabs) || [];
  const panes = (snapshot && snapshot.panes) || [];
  const agents = (snapshot && snapshot.agents) || [];
  return {
    workspaces: workspaces.map(function (workspace) {
      return {
        workspace_id: workspace.workspace_id,
        label: workspace.label,
        focused: Boolean(workspace.focused),
        pane_count: workspace.pane_count,
        agent_status: workspace.agent_status || 'unknown'
      };
    }),
    tabs: tabs.map(function (tab) {
      return {
        tab_id: tab.tab_id,
        workspace_id: tab.workspace_id,
        label: tab.label,
        focused: Boolean(tab.focused)
      };
    }),
    panes: panes.map(function (pane) {
      const agent = agents.find(function (item) { return item.pane_id === pane.pane_id; });
      return {
        pane_id: pane.pane_id,
        workspace_id: pane.workspace_id,
        tab_id: pane.tab_id,
        label: pane.label || null,
        title: pane.terminal_title_stripped || pane.terminal_title || null,
        agent: pane.agent || (agent ? agent.agent : null),
        agent_status: pane.agent_status || (agent ? agent.agent_status : 'unknown'),
        cwd: pane.cwd,
        focused: Boolean(pane.focused)
      };
    })
  };
}

async function handlePanelRequest(request) {
  const action = request.action;
  if (action === 'state') return panelState();
  if (action === 'read') {
    return tools.herdr_read({ pane_id: request.pane_id, source: request.source, lines: request.lines });
  }
  if (action === 'send') {
    // 面板的按键转发：只发按键，不动文本。
    return tools.herdr_send({ pane_id: request.pane_id, keys: request.keys });
  }
  if (action === 'submit') {
    // 面板回车 = 提交这一行。pane.send_text 只是把字打进输入行、不带回车，
    // 必须用 pane.send_input（相当于「跑一条命令」）才会执行。
    if (request.pane_id === undefined || request.pane_id === null) {
      throw new Error(runtime.missingTarget);
    }
    if (request.text === undefined || request.text === null || request.text === '') {
      throw new Error(runtime.missingTextOrKeys);
    }
    // 面板请求不是 Agent 工具调用，没有 callId 可带。
    return herdrCall('pane.send_input', { pane_id: request.pane_id, text: request.text });
  }
  if (action === 'prompt') {
    return tools.herdr_prompt({ target: request.target, text: request.text });
  }
  if (action === 'focus') {
    return herdrCall('pane.focus', { pane_id: request.pane_id });
  }
  if (action === 'close') {
    return herdrCall('pane.close', { pane_id: request.pane_id });
  }
  if (action === 'setup_automation') {
    return tools.herdr_automation_setup(request.params || {});
  }
  if (action === 'tmux_state') {
    return tools.tmux_state({ session: request.session });
  }
  if (action === 'tmux_read') {
    return tools.tmux_read({ target: request.target, lines: request.lines });
  }
  if (action === 'tmux_send') {
    return tools.tmux_send({ target: request.target, text: request.text, keys: request.keys });
  }
  throw new Error(runtime.unknownPanelAction + action);
}

channel.addEventListener('message', async function (event) {
  const message = event.data;
  if (!message || message.type !== 'panel-request') return;
  const reqId = message.reqId;
  try {
    const data = await handlePanelRequest(message);
    channel.postMessage({ type: 'panel-response', reqId: reqId, ok: true, data: data });
  } catch (error) {
    channel.postMessage({
      type: 'panel-response',
      reqId: reqId,
      ok: false,
      message: error && error.message ? error.message : String(error)
    });
  }
});

// --- Host messages -------------------------------------------------------

cindy.onHostMessage(async function (msg) {
  if (msg.type === 'tool-call') {
    const handler = tools[msg.tool];
    if (!handler) return;
    const args = Object.assign({}, msg.args || {});
    args.__callId = msg.callId;
    let result;
    try {
      result = await handler(args);
    } catch (error) {
      await replyTool(msg.callId, false, {
        errorCode: isUnknownOutcome(error) ? 'HERDR_OUTCOME_UNKNOWN' : 'HERDR_REQUEST_FAILED',
        message: error && error.message ? error.message : String(error)
      });
      return;
    }
    // 操作已经执行完了：回执送不出去也不能报成「操作失败」，
    // 否则 Agent 会以为没做而重试（重复发送输入、重复关闭分屏）。
    try {
      await replyTool(msg.callId, true, result);
    } catch (error) {
      void error;
    }
    return;
  }

  if (msg.type === 'event' && msg.name === 'node-notification') {
    if (msg.method !== 'herdr/event') return;
    const payload = msg.params || {};
    const data = payload.data || {};
    channel.postMessage({ type: 'herdr-event', event: payload.event, data: data });
    const status = data.agent_status;
    const statusEvent = payload.event === 'pane_agent_status_changed'
      || payload.event === 'pane.agent_status_changed';
    if (statusEvent && (status === 'blocked' || status === 'done')) {
      const label = data.agent || data.pane_id || runtime.agentFallback;
      try {
        await cindy.send({
          type: 'notify',
          tone: status === 'blocked' ? 'warning' : 'success',
          text: 'Herdr · ' + label + ' '
            + (status === 'blocked' ? runtime.notifyBlocked : runtime.notifyDone)
            + (data.title ? '：' + data.title : '')
        });
      } catch (error) {
        void error;
      }
      try {
        await cindy.send({
          type: 'badge',
          unread: true,
          summary: label + ' '
            + (status === 'blocked' ? runtime.badgeBlocked : runtime.badgeDone)
        });
      } catch (error) {
        void error;
      }
      await triggerAutomation();
    }
  }

  // 宿主语言变了：换掉运行时文案，并通知面板重新读取 /app-context。
  if (msg.type === 'host-context-changed') {
    await loadRuntimeLocale();
    channel.postMessage({ type: 'host-context-changed' });
  }
});

// 偏好尽量写进 KV（跨重启生效）；写不进去也不影响本次动作——
// 会话内的 subscriptionPreference 已经记下了。
async function persistSubscriptionPreference(wanted) {
  try {
    await writeKv({ [SUBSCRIBED_KEY]: wanted });
  } catch (error) {
    void error;
  }
}

// 打开订阅并记住这次的意图（setup 与 subscribe 共用，
// 否则 setup 成功后重启仍会按旧的退订偏好停摆）。
async function enableSubscription(callId) {
  subscriptionPreference = true;
  await persistSubscriptionPreference(true);
  return nodeRequest('herdr/subscribe', {}, callId);
}

// Keep the event subscription alive for panel and webhook users ——
// 除非用户显式退订过：wake 不能把那次退订撤销。
async function ensureSubscription() {
  try {
    if (subscriptionPreference === false) return;
    if (subscriptionPreference === null) {
      let kv = null;
      try {
        kv = await readKv();
      } catch (error) {
        // 存储读不了：先按「没表态 = 默认订阅」继续，稍后重试核对偏好，
        // 不能因为一次读取失败就连订阅都不发起。
        schedulePreferenceRecheck();
      }
      // 读取期间用户可能刚表态（哪怕那次持久化失败了）：以最新的内存选择为准，
      // 存储里的旧值只在「还没表态」时才生效。
      if (subscriptionPreference !== null) return;
      if (kv && kv[SUBSCRIBED_KEY] === false) {
        subscriptionPreference = false;
        return;
      }
    }
    await nodeRequest('herdr/subscribe', {});
  } catch (error) {
    void error;
  }
}

// 存储恢复后重新核对退订偏好；仍然读不到就继续排下一次（定时器不占着进程）。
let preferenceRetryTimer = null;

function schedulePreferenceRecheck() {
  if (preferenceRetryTimer) return;
  preferenceRetryTimer = setTimeout(async function () {
    preferenceRetryTimer = null;
    try {
      const kv = await readKv();
      // 只在用户仍未表态时恢复存储里的退订值；读取期间用户刚选过就尊重它。
      if (subscriptionPreference !== null) return;
      if (kv[SUBSCRIBED_KEY] === false) {
        subscriptionPreference = false;
        await nodeRequest('herdr/unsubscribe', {});
      }
    } catch (error) {
      schedulePreferenceRecheck();
    }
  }, 30000);
  if (preferenceRetryTimer.unref) preferenceRetryTimer.unref();
}

cindy.onHostMessage(function (msg) {
  if (msg.type === 'event' && msg.name === 'wake') ensureSubscription();
});

loadRuntimeLocale();
ensureSubscription();
