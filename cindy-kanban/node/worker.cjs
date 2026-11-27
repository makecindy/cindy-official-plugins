// JSON-RPC stdio worker：连本机 Herdr unix socket 读取 agent 列表。
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

function socketPath() {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;
  return path.join(os.homedir(), '.config', 'herdr', 'herdr.sock');
}

// 写入类方法一旦发出，超时或断线都不能断言「没执行」。
const MUTATING = new Set(['agent.prompt', 'pane.send_text', 'pane.send_keys', 'pane.send_input', 'pane.focus']);

function callOnce(method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath());
    socket.setEncoding('utf8');
    let buffer = '';
    let settled = false;
    let sent = false;
    const unknown = () => {
      const error = new Error('outcome_unknown: ' + method);
      error.code = 'outcome_unknown';
      return error;
    };
    const timer = setTimeout(() => {
      finish(reject, sent && MUTATING.has(method) ? unknown() : new Error('timeout'));
    }, timeoutMs || 10000);
    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* ignore */ }
      fn(value);
    }
    socket.on('connect', () => {
      socket.write(JSON.stringify({ id: 'k1', method, params: params || {} }) + '\n');
      sent = true;
    });
    socket.on('data', chunk => {
      buffer += chunk;
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      const line = buffer.slice(0, index).trim();
      try {
        const message = JSON.parse(line);
        if (message.error) finish(reject, new Error(message.error.message || message.error.code || 'herdr error'));
        else finish(resolve, message.result);
      } catch (e) {
        finish(reject, sent && MUTATING.has(method) ? unknown() : new Error('herdr 返回了无法解析的响应'));
      }
    });
    socket.on('error', e => {
      let err = e;
      if (!sent) {
        const code = e && e.code;
        if (code === 'ENOENT') err = new Error('找不到 Herdr 的 socket，请先启动 Herdr（可用 HERDR_SOCKET_PATH 指定路径）');
        else if (code === 'EACCES') err = new Error('没有权限访问 Herdr 的 socket，请检查文件权限或 HERDR_SOCKET_PATH');
      }
      finish(reject, sent && MUTATING.has(method) ? unknown() : err);
    });
  });
}

function reply(message) { process.stdout.write(JSON.stringify(message) + '\n'); }

readline.createInterface({ input: process.stdin }).on('line', async line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === 'herdr/agents') {
    try {
      const result = await callOnce('agent.list', {});
      reply({ jsonrpc: '2.0', id: request.id, result: {
        agents: (result.agents || []).map(a => ({
          paneId: a.pane_id, agent: a.agent, title: a.terminal_title_stripped || a.terminal_title,
          status: a.agent_status, cwd: a.cwd, focused: a.focused === true,
        })),
      } });
    } catch (e) {
      reply({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: String(e && e.message || e) } });
    }
    return;
  }
  if (request.method === 'herdr/prompt') {
    try {
      const result = await callOnce('agent.prompt', {
        target: request.params?.target, text: request.params?.text,
      }, 20000);
      reply({ jsonrpc: '2.0', id: request.id, result });
    } catch (e) {
      reply({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: String(e && e.message || e) } });
    }
    return;
  }
  if (request.method === 'herdr/read') {
    try {
      const result = await callOnce('pane.read', { pane_id: request.params?.paneId, source: request.params?.source || 'recent', lines: request.params?.lines ?? 60, strip_ansi: request.params?.stripAnsi === true }, 15000);
      reply({ jsonrpc: '2.0', id: request.id, result });
    } catch (e) {
      reply({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: String(e && e.message || e) } });
    }
    return;
  }
  if (request.method === 'herdr/send') {
    try {
      const result = await callOnce('pane.send_text', { pane_id: request.params?.paneId, text: String(request.params?.text ?? '') }, 15000);
      reply({ jsonrpc: '2.0', id: request.id, result });
    } catch (e) {
      reply({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: String(e && e.message || e) } });
    }
    return;
  }
  if (request.method === 'herdr/send_input') {
    try {
      const result = await callOnce('pane.send_input', { pane_id: request.params?.paneId, text: String(request.params?.text ?? ''), keys: Array.isArray(request.params?.keys) ? request.params.keys : [] }, 20000);
      reply({ jsonrpc: '2.0', id: request.id, result });
    } catch (e) {
      reply({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: String(e && e.message || e) } });
    }
    return;
  }
  if (request.method === 'herdr/keys') {
    try {
      const result = await callOnce('pane.send_keys', { pane_id: request.params?.paneId, keys: request.params?.keys ?? [] }, 15000);
      reply({ jsonrpc: '2.0', id: request.id, result });
    } catch (e) {
      reply({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: String(e && e.message || e) } });
    }
    return;
  }
  if (request.method === 'herdr/focus') {
    try {
      const result = await callOnce('pane.focus', { pane_id: request.params?.paneId }, 15000);
      reply({ jsonrpc: '2.0', id: request.id, result });
    } catch (e) {
      reply({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: String(e && e.message || e) } });
    }
    return;
  }
  reply({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
});
