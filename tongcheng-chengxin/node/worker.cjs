'use strict';

const readline = require('node:readline');
const { TOOL_DEFINITIONS, createTongchengClient } = require('./tongcheng.cjs');

const client = createTongchengClient();

function reply(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolResult(id, result) {
  reply({ jsonrpc: '2.0', id, result });
}

async function handle(request) {
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    reply({ jsonrpc: '2.0', id: request && request.id || null, error: { code: -32600, message: 'Invalid Request' } });
    return;
  }
  if (request.method === 'notifications/initialized') return;
  if (request.method === 'initialize') {
    reply({ jsonrpc: '2.0', id: request.id, result: {
      protocolVersion: request.params && request.params.protocolVersion || '2025-03-26',
      capabilities: { tools: {} }, serverInfo: { name: 'tongcheng-chengxin', version: '0.2.6' }
    } });
    return;
  }
  if (request.method === 'tools/list') {
    toolResult(request.id, { tools: TOOL_DEFINITIONS });
    return;
  }
  if (request.method !== 'tools/call') {
    reply({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
    return;
  }
  const name = request.params && request.params.name;
  const args = request.params && request.params.arguments || {};
  const tool = TOOL_DEFINITIONS.find((entry) => entry.name === name);
  if (!tool) {
    reply({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'Unknown Tongcheng tool' } });
    return;
  }
  const apiKey = request.cindy && request.cindy.secrets && request.cindy.secrets.tongcheng_api_key;
  try {
    const result = await client.call(name, args, typeof apiKey === 'string' ? apiKey : '');
    toolResult(request.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result
    });
  } catch (error) {
    toolResult(request.id, { isError: true, content: [{ type: 'text', text: error.message || '同程查询失败。' }] });
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let request;
  try { request = JSON.parse(line); }
  catch { reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  // Queries have independent request state and credentials; replies are correlated by id.
  void handle(request).catch(() => {
    process.stderr.write('Tongcheng MCP worker request failed.\n');
  });
});
