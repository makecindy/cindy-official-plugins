import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

const root = new URL('..', import.meta.url);
const source = readFileSync(new URL('console-cli/main.js', root), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('console-cli/ghost.json', root), 'utf8'));

const commandManifest = {
  manifest_version: 'v2',
  server_version: 'test',
  commands: [
    {
      id: 'app.list',
      command_path: ['app', 'list'],
      summary: 'List apps',
      http_method: 'GET',
      path: '/api/v1/app',
      params: [
        { name: 'team', in: 'query', required: false, type: 'string' },
      ],
    },
    {
      id: 'deployment.rollout-restart',
      command_path: ['deployment', 'rollout-restart'],
      http_method: 'POST',
      path: '/api/v1/deployment/{id}/rollout-restart',
      params: [
        { name: 'id', in: 'path', required: true, type: 'string' },
      ],
      request_body: {
        required: false,
        content_type: 'application/json',
        schema: { type: 'object', properties: { reason: { type: 'string' } } },
      },
    },
    {
      id: 'deployment.logs',
      command_path: ['deployment', 'logs'],
      http_method: 'GET',
      path: '/api/v1/deployment/{id}/logs',
      params: [
        { name: 'id', in: 'path', required: true, type: 'string' },
        { name: 'follow', in: 'query', required: false, type: 'boolean' },
      ],
      cli_constraints: {
        params: { follow: { disallow_true: true, note: 'follow=true is not supported' } },
      },
    },
  ],
};

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, body: JSON.stringify(data), headers: {} };
}

async function boot({ connections = [{ id: 'one', host: 'console.example.test', isDefault: true }], manifestData = commandManifest, manifestResponses, requestResult = response({ code: 0, data: { ok: true } }) } = {}) {
  let hostHandler;
  let manifestCalls = 0;
  let clock = Date.now();
  const requests = [];
  const cindy = {
    onHostMessage(handler) { hostHandler = handler; },
    async send(message) { this.messages.push(message); },
    messages: [],
    async fetch(request) {
      requests.push(request);
      if (request.url.endsWith('/api/v1/cli/manifest')) {
        const configured = manifestResponses && manifestResponses[Math.min(manifestCalls, manifestResponses.length - 1)];
        manifestCalls += 1;
        return configured || response({ code: 0, data: manifestData });
      }
      if (typeof requestResult === 'function') return requestResult(request);
      return requestResult;
    },
  };
  const context = createContext({
    cindy,
    fetch: async (url) => {
      assert.equal(url, '/connections');
      return { ok: true, async json() { return [{ key: 'console_conn', connections }]; } };
    },
    BroadcastChannel: undefined,
    setTimeout,
    clearTimeout,
    Date: class TestDate extends Date {
      static now() { return clock; }
    },
    URL,
    encodeURIComponent,
  });
  new Script(source, { filename: 'console-cli/main.js' }).runInContext(context);
  assert.equal(typeof hostHandler, 'function');
  async function call(tool, args = {}) {
    await hostHandler({ type: 'tool-call', tool, args, callId: 'test-call' });
    return cindy.messages.at(-1);
  }
  return { call, requests, advance(ms) { clock += ms; } };
}

test('manifest declares host-injected Console connection and no CLI binary', () => {
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.entry, 'main.js');
  assert.equal(manifest.network.connections[0].key, 'console_conn');
  assert.deepEqual(manifest.network.connections[0].inject, {
    header: 'Authorization',
    format: 'Bearer {value}',
  });
  assert.equal(manifest.network.connections[0].inject.hosts, undefined);
});

test('list_tools loads the fixed manifest endpoint and projects categories', async () => {
  const { call, requests } = await boot();
  const result = await call('list_tools');
  assert.equal(result.ok, true);
  assert.equal(result.result.categories.app.count, 1);
  assert.deepEqual(Array.from(result.result.categories.deployment.commands), ['deployment.rollout-restart', 'deployment.logs']);
  assert.equal(requests[0].url, 'https://console.example.test/api/v1/cli/manifest');
  assert.equal(requests[0].headers.Authorization, undefined);
  const category = await call('list_tools', { category: 'deployment' });
  assert.equal(category.result.commands[0].request_body.schema.type, 'object');
  assert.equal(category.result.commands[0].request_body.schema.properties.reason.type, 'string');
});

test('manifest ETag revalidation accepts a cached 304 response', async () => {
  const { call, requests, advance } = await boot({
    manifestResponses: [
      response({ code: 0, data: commandManifest }),
      { ok: false, status: 304, body: '', headers: {} },
    ],
  });
  assert.equal((await call('list_tools')).ok, true);
  advance(12 * 60 * 60 * 1000 + 1);
  const result = await call('list_tools');
  assert.equal(result.ok, true);
  assert.equal(requests.filter((request) => request.url.endsWith('/api/v1/cli/manifest')).length, 2);
});

test('call_tool builds escaped path/query parameters and JSON body', async () => {
  const { call, requests } = await boot();
  const result = await call('call_tool', {
    name: 'deployment.rollout-restart',
    params: { id: 'a/b', ignored: true },
    body: { reason: 'manual' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.execution, 'not_executed');
  const successful = await call('call_tool', {
    name: 'deployment.rollout-restart',
    params: { id: 'a/b' },
    body: { reason: 'manual' },
  });
  assert.equal(successful.ok, true);
  assert.equal(successful.result.execution, 'executed');
  assert.equal(requests.at(-1).url, 'https://console.example.test/api/v1/deployment/a%2Fb/rollout-restart');
  assert.equal(requests.at(-1).body, JSON.stringify({ reason: 'manual' }));
  assert.equal(requests.at(-1).headers.Authorization, undefined);
});

test('validation failures are not executed and manifest constraints are enforced', async () => {
  const { call, requests } = await boot();
  const missingBody = await call('call_tool', { name: 'deployment.rollout-restart', params: {} });
  assert.equal(missingBody.execution, 'not_executed');
  const forbidden = await call('call_tool', { name: 'deployment.logs', params: { id: 'd1', follow: true } });
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.message, /follow=true/);
  assert.equal(requests.length, 1); // manifest fetch only
});

test('network or HTTP failures after dispatch are unknown for mutations', async () => {
  const { call } = await boot({ requestResult: { ok: false, status: 503, body: 'temporarily unavailable', headers: {} } });
  const result = await call('call_tool', { name: 'deployment.rollout-restart', params: { id: 'd1' } });
  assert.equal(result.ok, false);
  assert.equal(result.execution, 'unknown');
});

test('multiple Console instances require explicit selection', async () => {
  const { call } = await boot({ connections: [
    { id: 'one', host: 'one.console.example.test' },
    { id: 'two', host: 'two.console.example.test' },
  ] });
  const ambiguous = await call('list_tools');
  assert.equal(ambiguous.execution, 'not_executed');
  const selected = await call('list_tools', { instance: 'two' });
  assert.equal(selected.ok, true);
  assert.equal(selected.result.instance, 'two.console.example.test');
});

test('malformed connection hosts are rejected before any request is sent', async () => {
  const { call, requests } = await boot({ connections: [{ id: 'bad', host: 'console.example.test@evil.example.test', isDefault: true }] });
  const result = await call('list_tools');
  assert.equal(result.execution, 'not_executed');
  assert.equal(requests.length, 0);
});

test('source never handles a token value directly', () => {
  assert.doesNotMatch(source, /Authorization\s*:/);
  assert.doesNotMatch(source, /token\s*=/i);
});
