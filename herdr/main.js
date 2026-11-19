'use strict';

// Cindy plugin brain: exposes Herdr to the agent, drives the side panel,
// and bridges Herdr events into Cindy notifications and automation webhooks.

const CHANNEL = 'cindy-plugin-herdr';
const WEBHOOK_KEY = 'herdrWebhookUrl';

// 宿主给随包 Node 进程的单次请求上限是 120 秒，超时就断。长等待因此拆成一段段
// 的短请求：每段最多 WAIT_CHUNK_MS，段内超时（Herdr 返回 timeout）就接着等下一段，
// 直到用户给的等待上限。主机这一层的等待要比 Herdr 那一段略长，否则先断的是主机。
const HOST_REQUEST_TIMEOUT_MAX_MS = 120000;
const WAIT_CHUNK_MS = 45000;
const WAIT_CHUNK_MARGIN_MS = 10000;

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
    automationNoAddress: '自动化已创建，但读取不到 Webhook 接收地址，请在自动化详情里查看',
    waitTimeout: '等待超时',
    nodeFailed: 'Node 工作进程调用失败',
    missingTarget: '缺少 target（session、window 或 pane 的名字）',
    missingTextOrKeys: '缺少 text 或 keys',
    unknownPanelAction: '未知的面板动作：'
  },
  en: {
    notifyBlocked: 'needs attention',
    notifyDone: 'finished',
    badgeBlocked: 'needs attention',
    badgeDone: 'finished',
    agentFallback: 'agent',
    automationFailed: 'Could not create the automation: ',
    automationUnknown: 'unknown error',
    automationNoAddress: 'The automation was created but its webhook address is unavailable; check the automation details',
    waitTimeout: 'Timed out',
    nodeFailed: 'The bundled Node worker call failed',
    missingTarget: 'target is required (session, window, or pane name)',
    missingTextOrKeys: 'text or keys is required',
    unknownPanelAction: 'Unknown panel action: '
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

async function nodeRequest(method, params, callId, timeoutMs) {
  const request = { method: method, params: params || {} };
  if (callId) request.callId = callId;
  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    request.timeoutMs = Math.min(Math.round(timeoutMs), HOST_REQUEST_TIMEOUT_MAX_MS);
  }
  const response = await cindy.node.request(request);
  if (!response.ok) {
    const error = new Error(response.message || runtime.nodeFailed);
    error.code = response.errorCode;
    throw error;
  }
  return response.result;
}

// Herdr 的超时写在 worker 请求的外层参数里；host 这一层要多留一点余量。
async function herdrCall(method, params, callId, timeoutMs) {
  const request = { method: method, params: params || {} };
  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    request.timeout_ms = Math.min(Math.round(timeoutMs), HOST_REQUEST_TIMEOUT_MAX_MS);
  }
  return nodeRequest(
    'herdr/request',
    request,
    callId,
    timeoutMs ? timeoutMs + WAIT_CHUNK_MARGIN_MS : undefined
  );
}

// Herdr 等待超时时返回 code=timeout；这属于「还没等到」，可以接着等下一段。
// 其他错误（例如 agent_blocked）要原样抛出去。
function isTimeoutError(error) {
  const text = String((error && error.message) || '');
  return /(^|[\s:])timeout([\s:]|$)/i.test(text) || /timed out/i.test(text);
}

async function readKv() {
  try {
    const response = await fetch('/kv');
    if (!response.ok) return {};
    const value = await response.json();
    return value && typeof value === 'object' ? value : {};
  } catch (error) {
    return {};
  }
}

async function writeKv(patch) {
  const current = await readKv();
  const next = Object.assign({}, current, patch);
  await fetch('/kv', { method: 'PUT', body: JSON.stringify(next) });
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
    const result = await waitForAgentState(args.target, until, deadline, args.__callId);
    return {
      target: args.target,
      agent_status: result && result.agent_status ? result.agent_status : null,
      completion: result ? result.completion || null : null,
      result: result || null
    };
  },

  async herdr_send(args) {
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
    const result = await herdrCall('pane.send_input', {
      pane_id: args.pane_id,
      text: args.text || '',
      keys: args.keys || []
    }, args.__callId);
    return { pane_id: args.pane_id, mode: 'input', result: result || null };
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
      const kv = await readKv();
      const result = await nodeRequest('herdr/subscribe', {
        webhookUrl: kv[WEBHOOK_KEY] || null
      }, args.__callId);
      return result;
    }
    if (mode === 'unsubscribe') {
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
    const existing = await cindy.host.call('cindy_scheduler', 'schedule_webhook_list', {});
    if (!existing.isError) {
      const info = JSON.parse(existing.content[0].text);
      const endpoints = (info.data && info.data.endpoints) || [];
      const match = endpoints.find(function (item) { return item.scheduleName === wantedName; });
      if (match && match.url) {
        await writeKv({ [WEBHOOK_KEY]: match.url });
        await nodeRequest('herdr/configure', { webhookUrl: match.url });
        return {
          schedule_id: match.scheduleId,
          webhook_address: match.url,
          reused: true
        };
      }
    }
    const created = await cindy.host.call('cindy_scheduler', 'schedule_create', {
      name: wantedName,
      targetSessionId: args.targetSessionId || undefined,
      prompt: args.prompt || 'Herdr 报告终端里的 agent 状态发生变化。请用 Herdr 插件的工具读取最新画面，判断发生了什么，只在需要用户决策或值得提醒时汇报。',
      cronExpr: args.cronExpr || '0 * * * *',
      timezone: args.timezone || 'Asia/Shanghai',
      recurring: true,
      manual: true,
      agentKind: args.agentKind || 'codex',
      targetSessionId: args.targetSessionId || undefined,
      silentWhenIdle: args.silentWhenIdle === true,
      notify: { desktop: true, feishu: false },
      webhookTrigger: {
        events: ['pane_agent_status_changed'],
        source: {
          preset: 'standard-webhooks',
          signed: false
        }
      }
    });
    if (created.isError) {
      const detail = created.content && created.content[0] && created.content[0].text;
      throw new Error(runtime.automationFailed + (detail || runtime.automationUnknown));
    }
    const body = JSON.parse(created.content[0].text);
    const scheduleId = body.data && body.data.id;
    if (!scheduleId) throw new Error('自动化创建成功但没有拿到 id');
    let address = null;
    const fetched = await cindy.host.call('cindy_scheduler', 'schedule_get', { id: scheduleId });
    if (!fetched.isError) {
      const info = JSON.parse(fetched.content[0].text);
      const status = info.data && info.data.webhookStatus;
      address = status && (status.url || status.address) ? (status.url || status.address) : null;
    }
    if (!address) {
      const list = await cindy.host.call('cindy_scheduler', 'schedule_webhook_list', {});
      if (!list.isError) {
        const info = JSON.parse(list.content[0].text);
        const endpoints = (info.data && info.data.endpoints) || [];
        const match = endpoints.find(function (item) { return item.scheduleId === scheduleId; });
        if (match && match.url) address = match.url;
      }
    }
    if (!address) {
      throw new Error(runtime.automationNoAddress);
    }
    await writeKv({ [WEBHOOK_KEY]: address });
    await nodeRequest('herdr/configure', { webhookUrl: address });
    return { schedule_id: scheduleId, webhook_address: address };
  },

  async herdr_call(args) {
    const result = await herdrCall(args.method, args.params || {}, args.__callId);
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
        hint: '这台电脑上没有 tmux。装上 tmux 后这里会列出 session 与 pane。'
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
  const raw = await nodeRequest('herdr/snapshot', {});
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
    return tools.herdr_send({ pane_id: request.pane_id, text: request.text });
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
    try {
      const args = Object.assign({}, msg.args || {});
      args.__callId = msg.callId;
      const result = await handler(args);
      await replyTool(msg.callId, true, result);
    } catch (error) {
      await replyTool(msg.callId, false, {
        message: error && error.message ? error.message : String(error)
      });
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
    }
  }

  // 宿主语言变了：换掉运行时文案，并通知面板重新读取 /app-context。
  if (msg.type === 'host-context-changed') {
    await loadRuntimeLocale();
    channel.postMessage({ type: 'host-context-changed' });
  }
});

// Keep the event subscription alive for panel and webhook users.
async function ensureSubscription() {
  try {
    const kv = await readKv();
    await nodeRequest('herdr/subscribe', { webhookUrl: kv[WEBHOOK_KEY] || null });
  } catch (error) {
    void error;
  }
}

cindy.onHostMessage(function (msg) {
  if (msg.type === 'event' && msg.name === 'wake') ensureSubscription();
});

loadRuntimeLocale();
ensureSubscription();
