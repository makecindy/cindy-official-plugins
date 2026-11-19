'use strict';

// Cindy plugin brain: exposes Herdr to the agent, drives the side panel,
// and bridges Herdr events into Cindy notifications and automation webhooks.

const CHANNEL = 'cindy-plugin-herdr';
const WEBHOOK_KEY = 'herdrWebhookUrl';

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

async function nodeRequest(method, params, callId) {
  const request = { method: method, params: params || {} };
  if (callId) request.callId = callId;
  const response = await cindy.node.request(request);
  if (!response.ok) {
    const error = new Error(response.message || 'Node 工作进程调用失败');
    error.code = response.errorCode;
    throw error;
  }
  return response.result;
}

async function herdrCall(method, params, callId) {
  return nodeRequest('herdr/request', { method: method, params: params || {} }, callId);
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

// --- Tool implementations ------------------------------------------------

const tools = {
  async herdr_state(args) {
    const params = {};
    if (args.workspace_id) params.workspace_id = args.workspace_id;
    const raw = await herdrCall('session.snapshot', params);
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
      result = await herdrCall('pane.read', params);
    } else {
      params.target = args.target || args.pane_id;
      result = await herdrCall('agent.read', params);
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
    const params = { target: args.target, text: args.text };
    if (args.wait_until && args.wait_until.length) {
      params.wait = {
        until: args.wait_until,
        timeout_ms: args.timeout_ms === undefined ? 120000 : args.timeout_ms
      };
    }
    const result = await herdrCall('agent.prompt', params);
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
      });
      return { pane_id: args.pane_id, mode: 'keys', result: result || null };
    }
    if (args.pane_id && args.text !== undefined) {
      const result = await herdrCall('pane.send_text', {
        pane_id: args.pane_id,
        text: args.text
      });
      return { pane_id: args.pane_id, mode: 'text', result: result || null };
    }
    const result = await herdrCall('pane.send_input', {
      pane_id: args.pane_id,
      text: args.text || '',
      keys: args.keys || []
    });
    return { pane_id: args.pane_id, mode: 'input', result: result || null };
  },

  async herdr_wait(args) {
    if (args.pane_id && args.match) {
      const result = await herdrCall('pane.wait_for_output', {
        pane_id: args.pane_id,
        source: args.source || 'visible',
        match: args.match,
        lines: args.lines === undefined ? undefined : args.lines,
        timeout_ms: args.timeout_ms === undefined ? 120000 : args.timeout_ms
      });
      return { pane_id: args.pane_id, result: result || null };
    }
    const result = await herdrCall('agent.wait', {
      target: args.target,
      until: args.until && args.until.length ? args.until : undefined,
      timeout_ms: args.timeout_ms === undefined ? 300000 : args.timeout_ms
    });
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
    const result = await herdrCall(method, params);
    return { method: method, result: result || null };
  },

  async herdr_notify(args) {
    const params = { title: args.title };
    if (args.body) params.body = args.body;
    if (args.sound) params.sound = args.sound;
    if (args.position) params.position = args.position;
    const result = await herdrCall('notification.show', params);
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
      const result = await herdrCall('events.wait', {
        match_event: args.match_event,
        timeout_ms: args.timeout_ms === undefined ? 60000 : args.timeout_ms
      });
      return result || null;
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
      throw new Error('创建自动化失败：' + (detail || '未知错误'));
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
      throw new Error('自动化已创建，但读取不到 Webhook 接收地址，请在自动化详情里查看');
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
    if (!args.target) throw new Error('缺少 target（session、window 或 pane 的名字）');
    return nodeRequest('tmux/capture', {
      target: String(args.target),
      lines: args.lines === undefined ? undefined : args.lines
    }, args.__callId);
  },

  async tmux_send(args) {
    if (!args.target) throw new Error('缺少 target（session、window 或 pane 的名字）');
    const params = { target: String(args.target) };
    if (args.keys && args.keys.length) {
      params.keys = args.keys;
    } else if (args.text !== undefined && args.text !== null) {
      params.text = args.text;
    } else {
      throw new Error('缺少 text 或 keys');
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
  throw new Error('未知的面板动作：' + action);
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
      const label = data.agent || data.pane_id || 'agent';
      try {
        await cindy.send({
          type: 'notify',
          tone: status === 'blocked' ? 'warning' : 'success',
          text: 'Herdr · ' + label + ' ' + (status === 'blocked' ? '需要处理' : '已完成')
            + (data.title ? '：' + data.title : '')
        });
      } catch (error) {
        void error;
      }
      try {
        await cindy.send({
          type: 'badge',
          unread: true,
          summary: label + ' ' + (status === 'blocked' ? '待处理' : '已完成')
        });
      } catch (error) {
        void error;
      }
    }
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

ensureSubscription();
