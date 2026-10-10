const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('main sends exactly one tool-result for thrown, absent and failed Node APIs', async () => {
  for (const node of [undefined, {}, { request: async () => { throw new Error('sensitive detail'); } }, { request: async () => ({ ok: false }) }, { request: async () => null }, { request: async () => ({ ok: true, result: { data: [] } }) }]) {
    let handler;
    const replies = [];
    vm.runInNewContext(source('main.js'), { cindy: { node, onHostMessage(fn) { handler = fn; }, async send(reply) { replies.push(reply); } } });
    await handler({ type: 'tool-call', tool: 'train_search', callId: 'call-1', args: {} });
    assert.equal(replies.length, 1);
    assert.equal(replies[0].type, 'tool-result');
    assert.equal(replies[0].callId, 'call-1');
    assert.ok(!JSON.stringify(replies[0]).includes('sensitive detail'));
    if (!replies[0].ok) assert.ok(replies[0].message);
  }
});

test('worker lets a fast query finish while a slow query is pending', async () => {
  let onLine, finishSlow;
  const replies = [];
  vm.runInNewContext(source('node/worker.cjs'), {
    require(name) {
      if (name === 'node:readline') return { createInterface: () => ({ on(event, callback) { onLine = callback; } }) };
      return { TOOL_DEFINITIONS: [{ name: 'train_search' }], createTongchengClient: () => ({
        call: async (name, args) => args.slow ? new Promise((resolve) => { finishSlow = resolve; }) : { status: 'ok' }
      }) };
    },
    process: { stdin: {}, stdout: { write: (line) => replies.push(JSON.parse(line)) }, stderr: { write() {} } }
  });
  const request = (id, args) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'train_search', arguments: args } });
  onLine(request('slow', { slow: true }));
  onLine(request('fast', {}));
  await new Promise(setImmediate);
  assert.deepEqual(replies.map((reply) => reply.id), ['fast']);
  finishSlow({ status: 'ok' });
  await new Promise(setImmediate);
  assert.deepEqual(replies.map((reply) => reply.id), ['fast', 'slow']);
});

test('settings follows host locale, falls back to English and localizes status messages', async () => {
  for (const locale of ['zh-CN', 'en', 'ja', 'ko', 'unknown', null]) {
    const nodes = new Map();
    const translations = [...source('settings.html').matchAll(/data-i18n="([^"]+)"/g)].map(([, key]) => ({ dataset: { i18n: key }, textContent: '' }));
    const document = { documentElement: {}, getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', addEventListener(event, fn) { this.click = fn; } });
      return nodes.get(id);
    }, querySelectorAll: () => translations };
    vm.runInNewContext(source('settings.js'), { document, fetch: async (url) => ({ ok: true, json: async () => url === '/app-context' ? { context: { locale } } : [] }) });
    await new Promise(setImmediate);
    assert.equal(document.documentElement.lang, locale === 'zh-CN' ? 'zh-CN' : 'en');
    assert.ok(translations.every((node) => typeof node.textContent === 'string' && node.textContent.length > 0));
    await nodes.get('save').click();
    assert.match(nodes.get('status').textContent, locale === 'zh-CN' ? /输入/ : /Enter/);
  }
});
