'use strict';
const net = require('node:net');
const crypto = require('node:crypto');
const readline = require('node:readline');
const LF = String.fromCharCode(10);
const ACTIONS = new Set(['status', 'objects', 'create', 'transform', 'create_layer', 'assign_layer', 'operation_result']);
const WRITES = new Set(['create', 'transform', 'create_layer', 'assign_layer']);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
function requestRhino(params, secret, transport = net) {
  const { action, args = {}, port = 19986 } = params || {};
  if (!ACTIONS.has(action)) return Promise.resolve(failure('BRIDGE_ACTION', '不支持此操作，请使用已声明的建模工具。'));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return Promise.resolve(failure('BRIDGE_PORT', '端口无效，请填写 1024–65535 的整数。'));
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return Promise.resolve(failure('BRIDGE_PAIRING', '请把 Rhino 连接脚本显示的配对密钥填入插件设置。'));
  if (!args || typeof args !== 'object' || Array.isArray(args)) return Promise.resolve(failure('BRIDGE_ARGS', '参数必须是对象，请按工具说明填写。'));
  const id = crypto.randomUUID();
  const wire = JSON.stringify({ protocol: 1, id, token: secret, action, args }) + LF;
  if (Buffer.byteLength(wire) > 262144) return Promise.resolve(failure('BRIDGE_SIZE', '请求过大，请减少对象数量。'));
  return new Promise((resolve) => {
    let socket, timer, done = false, sent = false, chunks = [], bytes = 0;
    const finish = (value) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (socket) socket.destroy();
      resolve(value);
    };
    const uncertain = () => failure('BRIDGE_OUTCOME_UNKNOWN', '连接中断或等待超时，操作结果尚未确认。请保持 Rhino 连接脚本运行，用原 operation_id 查询结果；不要换编号重做。', { operation_id: args.operation_id });
    try {
      socket = transport.createConnection({ host: '127.0.0.1', port });
      timer = setTimeout(() => finish(sent && WRITES.has(action) ? uncertain() : failure('BRIDGE_WAIT', 'Rhino 暂未响应，请关闭对话框、结束当前命令后再检测连接。')), 16000);
      socket.on('connect', () => { sent = true; socket.end(wire); });
      socket.on('data', (chunk) => {
        chunks.push(chunk); bytes += chunk.length;
        if (bytes > 786432) return finish(sent && WRITES.has(action) ? uncertain() : failure('BRIDGE_RESPONSE_SIZE', '返回内容过大，请缩小查询范围。'));
        const data = Buffer.concat(chunks), newline = data.indexOf(10);
        if (newline < 0) return;
        try {
          const reply = JSON.parse(data.subarray(0, newline).toString('utf8'));
          if (reply.id !== id || reply.protocol !== 1 || !reply.result || typeof reply.result.ok !== 'boolean') throw new Error('protocol');
          finish(reply.result);
        } catch { finish(sent && WRITES.has(action) ? uncertain() : failure('BRIDGE_PROTOCOL', '协议不匹配，请确认端口对应随包提供的 Rhino 连接脚本。')); }
      });
      socket.on('error', () => finish(sent && WRITES.has(action) ? uncertain() : failure('BRIDGE_CONNECT', '无法连接 Rhino。请在同一台电脑的 Rhino 中运行连接脚本，并核对端口。')));
      socket.on('end', () => { if (!done) finish(sent && WRITES.has(action) ? uncertain() : failure('BRIDGE_CLOSED', 'Rhino 提前关闭连接，请重新检测连接并核对脚本版本。')); });
    } catch { finish(failure('BRIDGE_CONNECT', '无法建立本机连接，请检查 Rhino 连接脚本与端口。')); }
  });
}
function serve() {
  let officialBusy = false;
  const reply = (value) => {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > 980000) {
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:value.id,result:failure('BRIDGE_SIZE','响应超过当前容量。操作可能已完成，请先检查 Rhino；查询请缩小范围。')}) + LF);
    } else process.stdout.write(encoded + LF);
  };
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    let req;
    try { req = JSON.parse(line); } catch { reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); return; }
    if (!req || req.jsonrpc !== '2.0' || req.id === undefined || !['rhino/request','official/request'].includes(req.method)) {
      reply({ jsonrpc: '2.0', id: req?.id ?? null, error: { code: -32600, message: 'Invalid request' } }); return;
    }
    try {
      if (req.method === 'official/request') {
        if (officialBusy) { reply({jsonrpc:'2.0',id:req.id,result:failure('OFFICIAL_BUSY','已有官方请求执行中，此请求未发送，请稍后再试。')}); return; }
        officialBusy = true;
        try { reply({jsonrpc:'2.0',id:req.id,result:await require('./official.cjs').officialRequest(req.params)}); }
        finally { officialBusy = false; }
        return;
      }
      const result = await requestRhino(req.params, req.cindy?.secrets?.rhino_token);
      reply({ jsonrpc: '2.0', id: req.id, result });
    } catch { reply({ jsonrpc: '2.0', id: req.id, result: failure('BRIDGE_WORKER', '连接组件处理失败，请检测连接；写入操作请先查询原操作编号。') }); }
  });
}
module.exports = { requestRhino };
if (require.main === module || globalThis.__CINDY_NODE__) serve();
