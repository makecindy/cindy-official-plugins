import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { validateGhostManifest } from './contracts/plugin-manifest.bcdea7e27f97.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pluginDir = path.join(root, 'ntfy');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'ghost.json'), 'utf8'));
const source = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(pluginDir, 'settings.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(pluginDir, 'settings.html'), 'utf8');
const localeNames = ['en', 'zh-CN', 'ja', 'ko'];
const locales = Object.fromEntries(localeNames.map((locale) => [
  locale,
  JSON.parse(fs.readFileSync(path.join(pluginDir, 'locales', `${locale}.json`), 'utf8')),
]));

// Fixture credential: only the simulated host knows it, exactly like the real host.
const TOKEN = 'tk_0123456789abcdefghijklmnopqrs';
const SERVER_A = { id: 'conn-a', host: 'ntfy.example.test', label: 'ntfy.example.test', isDefault: true, tail: 'pqrs' };
const SERVER_B = { id: 'conn-b', host: 'push.example.test', label: 'push.example.test', isDefault: false, tail: 'wxyz' };

const plain = (value) => JSON.parse(JSON.stringify(value));

async function flushAsync(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function published(extra = {}) {
  return {
    ok: true,
    status: 200,
    body: JSON.stringify({
      id: 'msg123',
      time: 1761570000,
      expires: 1761613200,
      event: 'message',
      topic: 'alerts',
      message: 'ok',
      ...extra,
    }),
  };
}

function assertNoSecret(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(TOKEN), false, 'a tool result leaked the access token');
  assert.equal(text.includes(TOKEN.slice(3)), false, 'a tool result leaked part of the access token');
}

function hasAuthorizationHeader(headers) {
  return Object.keys(headers ?? {}).some((name) => name.toLowerCase() === 'authorization');
}

// The existing assertions check the English copy, so the simulated host reports
// `en` unless a test picks another locale or a failing app-context explicitly.
function createHarness(options = {}) {
  const connections = options.connections ?? [SERVER_A];
  const kv = options.kv ?? { defaultTopics: { 'conn-a': 'alerts' } };
  const networkCalls = [];
  const sentHeaders = [];
  const toolResults = [];
  const dataPlane = [];
  const appContextRequests = [];
  let handler = null;

  const cindy = {
    async request(message) {
      assert.deepEqual(plain(message), { kind: 'app-context' });
      appContextRequests.push(message);
      if (options.appContext) return options.appContext();
      return { ok: true, context: { region: 'global', locale: options.locale ?? 'en' } };
    },
    onHostMessage(fn) {
      handler = fn;
    },
    async fetch(request) {
      networkCalls.push(request);
      // Simulate the host: inject the connection token for the matching host only.
      const headers = { ...(request.headers ?? {}) };
      if (connections.some((connection) => request.url.startsWith(`https://${connection.host}/`))) {
        headers.Authorization = `Bearer ${TOKEN}`;
      }
      sentHeaders.push(headers);
      if (!options.respond) throw new Error('unexpected network request');
      return options.respond(request, headers);
    },
    async send(message) {
      if (message.type === 'tool-result') {
        toolResults.push(message);
        return { ok: true };
      }
      throw new Error(`unexpected cindy.send type ${message.type}`);
    },
  };

  const fetchMock = async (url, init) => {
    dataPlane.push({ url, init });
    if (url === '/connections') {
      if (options.connectionsFail) throw new Error('data plane unavailable');
      return {
        ok: true,
        status: 200,
        async json() {
          return [{ key: 'ntfy_conn', label: 'ntfy server', maxConnections: 8, connections }];
        },
      };
    }
    if (url === '/kv') {
      if (options.kvFail) throw new Error('kv unavailable');
      return {
        ok: true,
        status: 200,
        async json() {
          return kv;
        },
      };
    }
    throw new Error(`unexpected data plane request ${url}`);
  };

  if (options.withoutRequest) delete cindy.request;
  const context = {
    cindy,
    fetch: fetchMock,
    URL,
    setTimeout: options.setTimeout ?? setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context);
  assert.equal(typeof handler, 'function');

  return {
    networkCalls,
    sentHeaders,
    toolResults,
    dataPlane,
    appContextRequests,
    messages: context.MESSAGES,
    async hostMessage(message) {
      await handler(message);
    },
    async call(tool, args) {
      const before = toolResults.length;
      await handler({ type: 'tool-call', tool, callId: 'call-1', args });
      assert.equal(toolResults.length, before + 1, 'exactly one tool-result per tool call');
      const result = toolResults.at(-1);
      assert.equal(result.type, 'tool-result');
      assert.equal(result.callId, 'call-1');
      assertNoSecret(result);
      return plain(result);
    },
    send(args) {
      return this.call('ntfy_send', args);
    },
  };
}

/* ── Manifest, locales and package files ─────────────────────────────── */

test('manifest is a v3 package using host-managed connections only', () => {
  const validated = validateGhostManifest(manifest);
  assert.ok(validated.ok, validated.reason);
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(Object.hasOwn(manifest, 'slots'), false);
  assert.equal(manifest.id, 'ntfy');
  assert.equal(manifest.command, 'ntfy');
  assert.equal(manifest.name, 'ntfy');
  assert.equal(manifest.version, '1.1.0');
  assert.equal(manifest.minCindyVersion, '0.1.64');
  assert.equal(manifest.author, 'Rui Valim');
  assert.equal(manifest.settingsHtml, 'settings.html');
  assert.equal(manifest.network.hosts, undefined, 'no static host: servers come from connections');
  assert.deepEqual(manifest.network.connections.map((c) => c.key), ['ntfy_conn']);
  assert.deepEqual(manifest.network.connections[0].inject, { header: 'Authorization', format: 'Bearer {value}' });
  assert.deepEqual(manifest.tools.map((tool) => tool.name), ['ntfy_send', 'ntfy_servers']);
  const send = manifest.tools[0].parameters;
  assert.deepEqual(send.required, ['message']);
  assert.deepEqual(send.properties.priority.enum, ['1', '2', '3', '4', '5', 'min', 'low', 'default', 'high', 'urgent']);
  assert.equal(send.properties.tags.type, 'array');
  assert.equal(send.properties.markdown.type, 'boolean');
  for (const tool of manifest.tools) assert.match(tool.name, /^[a-z][a-z0-9_]*$/);
});

test('four locales fully cover the catalog with real translations', () => {
  const expectedTools = manifest.tools.map((tool) => tool.name).sort();
  for (const locale of localeNames) {
    const resource = locales[locale];
    for (const key of ['name', 'description', 'whenToUse']) {
      assert.equal(typeof resource[key], 'string', `${locale}.${key}`);
      assert.ok(resource[key].trim(), `${locale}.${key}`);
    }
    assert.deepEqual(Object.keys(resource.tools).sort(), expectedTools, `${locale} tool keys`);
    for (const name of expectedTools) assert.ok(resource.tools[name].description.trim(), `${locale}.${name}`);
    assert.ok(resource.network.connections.ntfy_conn.label.trim(), `${locale} connection label`);
    assert.match(resource.tools.ntfy_send.description, /4096/, `${locale} keeps the size limit`);
  }
  assert.equal(locales.en.description, manifest.description);
  assert.equal(locales.en.whenToUse, manifest.whenToUse);
  for (const locale of ['zh-CN', 'ja', 'ko']) {
    assert.notEqual(locales[locale].description, locales.en.description, `${locale} must be translated`);
    assert.notEqual(locales[locale].tools.ntfy_send.description, locales.en.tools.ntfy_send.description, `${locale} must be translated`);
  }
});

test('package files exist, the icon is a PNG and no text uses en or em dashes', () => {
  const icon = fs.readFileSync(path.join(pluginDir, manifest.icon));
  assert.deepEqual([...icon.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const textFiles = ['ghost.json', 'main.js', 'settings.html', 'settings.js', ...localeNames.map((l) => `locales/${l}.json`)];
  for (const file of textFiles) {
    const text = fs.readFileSync(path.join(pluginDir, file), 'utf8');
    assert.doesNotMatch(text, /[\u2013\u2014]/, `${file} contains an en or em dash`);
  }
});

test('settings page reads the language only from /app-context and loads its script externally', () => {
  assert.match(settingsSource, /fetch\('\/app-context'/);
  assert.doesNotMatch(settingsSource, /navigator\./);
  assert.doesNotMatch(settingsHtml, /navigator\./);
  assert.match(settingsHtml, /<script src="\/settings\.js"><\/script>/);
  assert.doesNotMatch(settingsHtml, /<script>(?!<\/script>)/, 'no inline script');
  assert.doesNotMatch(source, /navigator\./);
});

/* ── ntfy_send: happy path ───────────────────────────────────────────── */

test('happy path publishes a JSON body to the server root and keeps UTF-8 titles intact', async () => {
  const harness = createHarness({ respond: () => published() });
  const result = await harness.send({
    message: 'Backup finished without errors',
    title: 'Backup: início às 03:00',
    priority: 'high',
    tags: ['white_check_mark', ' backup '],
    click: 'https://example.test/report',
    markdown: true,
  });

  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.result, {
    sent: true,
    server: 'ntfy.example.test',
    topic: 'alerts',
    id: 'msg123',
    time: 1761570000,
    expires: 1761613200,
  });

  assert.equal(harness.networkCalls.length, 1);
  const request = harness.networkCalls[0];
  assert.equal(request.url, 'https://ntfy.example.test/');
  assert.equal(request.method, 'POST');
  assert.equal(request.callId, 'call-1');
  assert.equal(request.as, 'text');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.equal(hasAuthorizationHeader(request.headers), false, 'the plugin must not set credentials itself');
  assert.equal(harness.sentHeaders[0].Authorization, `Bearer ${TOKEN}`, 'the simulated host injects the token');
  for (const name of Object.keys(request.headers)) {
    assert.doesNotMatch(name, /^x-/i, 'metadata travels in the JSON body, never in X- headers');
  }

  assert.equal(typeof request.body, 'string');
  assert.ok(request.body.includes('início às 03:00'), 'title stays raw UTF-8 in the body');
  assert.deepEqual(JSON.parse(request.body), {
    topic: 'alerts',
    message: 'Backup finished without errors',
    title: 'Backup: início às 03:00',
    priority: 4,
    tags: ['white_check_mark', 'backup'],
    click: 'https://example.test/report',
    markdown: true,
  });
});

test('a minimal send carries only topic and message', async () => {
  const harness = createHarness({ respond: () => published() });
  const result = await harness.send({ message: 'hello' });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(harness.networkCalls[0].body), { topic: 'alerts', message: 'hello' });
});

test('markdown false and empty optional fields are left out of the body', async () => {
  const harness = createHarness({ respond: () => published() });
  const result = await harness.send({ message: 'hello', markdown: false, title: '  ', tags: [], click: '', priority: '' });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(harness.networkCalls[0].body), { topic: 'alerts', message: 'hello' });
});

test('explicit topic overrides the default topic', async () => {
  const harness = createHarness({ respond: () => published() });
  const result = await harness.send({ message: 'hello', topic: 'deploy-prod_2' });
  assert.equal(result.ok, true);
  assert.equal(result.result.topic, 'deploy-prod_2');
  assert.equal(JSON.parse(harness.networkCalls[0].body).topic, 'deploy-prod_2');
});

test('priority accepts 1-5 and ntfy names, sent as integers', async () => {
  const cases = [
    [1, 1], [5, 5], ['1', 1], ['3', 3], [' 4 ', 4],
    ['min', 1], ['low', 2], ['default', 3], ['high', 4], ['urgent', 5], ['URGENT', 5],
  ];
  for (const [input, expected] of cases) {
    const harness = createHarness({ respond: () => published() });
    const result = await harness.send({ message: 'hello', priority: input });
    assert.equal(result.ok, true, `priority ${JSON.stringify(input)}`);
    assert.equal(JSON.parse(harness.networkCalls[0].body).priority, expected, `priority ${JSON.stringify(input)}`);
  }
});

test('a 2xx without a message id still reports the notification as sent', async () => {
  const harness = createHarness({ respond: () => ({ ok: true, status: 200, body: 'not json' }) });
  const result = await harness.send({ message: 'hello' });
  assert.equal(result.ok, true);
  assert.equal(result.result.sent, true);
  assert.equal(result.result.id, null);
  assert.match(result.result.note, /did not return a message id/);
});

/* ── ntfy_send: argument validation (nothing reaches the network) ────── */

test('empty or missing message is rejected before any network or settings access', async () => {
  for (const args of [{}, { message: '' }, { message: '   \n ' }, { message: 42 }, { message: null }]) {
    const harness = createHarness({ respond: () => published() });
    const result = await harness.send(args);
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.equal(result.errorCode, 'INVALID_ARGUMENT');
    assert.match(result.message, /message is required/);
    assert.equal(harness.networkCalls.length, 0);
    assert.equal(harness.dataPlane.length, 0);
  }
});

test('null or non-object args are treated as an empty call', async () => {
  for (const args of [null, undefined, 'hello', ['hello']]) {
    const harness = createHarness({ respond: () => published() });
    const result = await harness.send(args);
    assert.equal(result.errorCode, 'INVALID_ARGUMENT');
    assert.equal(harness.networkCalls.length, 0);
  }
});

test('messages are limited to 4096 UTF-8 bytes, counted in bytes and never truncated', async () => {
  // Each of these is exactly 4096 bytes.
  const accepted = ['a'.repeat(4096), 'é'.repeat(2048), '😀'.repeat(1024), `${'a'.repeat(4094)}é`];
  for (const message of accepted) {
    const harness = createHarness({ respond: () => published() });
    const result = await harness.send({ message });
    assert.equal(result.ok, true, `${message.length} chars should fit`);
    assert.equal(JSON.parse(harness.networkCalls[0].body).message, message, 'message is sent unchanged');
  }

  const rejected = [
    ['a'.repeat(4097), 4097],
    ['é'.repeat(2049), 4098],
    ['😀'.repeat(1025), 4100],
    [`${'a'.repeat(4095)}é`, 4097],
  ];
  for (const [message, bytes] of rejected) {
    const harness = createHarness({ respond: () => published() });
    const result = await harness.send({ message });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'MESSAGE_TOO_LARGE');
    assert.match(result.message, new RegExp(`${bytes} bytes`));
    assert.match(result.message, /nothing was sent/);
    assert.equal(harness.networkCalls.length, 0);
  }
});

test('invalid topics are rejected with the ntfy topic rule', async () => {
  for (const topic of ['has space', 'a'.repeat(65), 'ação', 'x/y', 'topic.name', 42, true]) {
    const harness = createHarness({ respond: () => published() });
    const result = await harness.send({ message: 'hello', topic });
    assert.equal(result.ok, false, JSON.stringify(topic));
    assert.equal(result.errorCode, 'INVALID_TOPIC');
    assert.match(result.message, /letters, digits, - and _/);
    assert.equal(harness.networkCalls.length, 0);
  }
  const longest = createHarness({ respond: () => published() });
  assert.equal((await longest.send({ message: 'hello', topic: 'a'.repeat(64) })).ok, true);
});

test('invalid priorities are rejected', async () => {
  for (const priority of [0, 6, 2.5, -1, 'max', 'highest', 'p1', true, ['high']]) {
    const harness = createHarness({ respond: () => published() });
    const result = await harness.send({ message: 'hello', priority });
    assert.equal(result.ok, false, JSON.stringify(priority));
    assert.equal(result.errorCode, 'INVALID_PRIORITY');
    assert.match(result.message, /1-5 or one of min, low, default, high, urgent/);
    assert.equal(harness.networkCalls.length, 0);
  }
});

test('click must be an absolute https URL', async () => {
  for (const click of ['http://example.test/x', 'javascript:alert(1)', 'example.test/x', 'https://', 'ftp://example.test', 'https://exa mple.test', 7]) {
    const harness = createHarness({ respond: () => published() });
    const result = await harness.send({ message: 'hello', click });
    assert.equal(result.ok, false, JSON.stringify(click));
    assert.equal(result.errorCode, 'INVALID_CLICK_URL');
    assert.equal(harness.networkCalls.length, 0);
  }
});

test('malformed tags, title and markdown are rejected', async () => {
  const cases = [
    { tags: 'warning' },
    { tags: ['ok', ''] },
    { tags: ['ok', 3] },
    { title: 12 },
    { markdown: 'yes' },
    { server: 3 },
  ];
  for (const extra of cases) {
    const harness = createHarness({ respond: () => published() });
    const result = await harness.send({ message: 'hello', ...extra });
    assert.equal(result.ok, false, JSON.stringify(extra));
    assert.equal(result.errorCode, 'INVALID_ARGUMENT');
    assert.equal(harness.networkCalls.length, 0);
  }
});

/* ── ntfy_send: server and topic resolution ──────────────────────────── */

test('no configured server explains how to add one', async () => {
  const harness = createHarness({ connections: [], respond: () => published() });
  const result = await harness.send({ message: 'hello', topic: 'alerts' });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'NOT_CONFIGURED');
  assert.match(result.message, /plugin settings/);
  assert.equal(harness.networkCalls.length, 0);
});

test('unreadable connection list fails without sending', async () => {
  const harness = createHarness({ connectionsFail: true, respond: () => published() });
  const result = await harness.send({ message: 'hello', topic: 'alerts' });
  assert.equal(result.errorCode, 'SETTINGS_UNAVAILABLE');
  assert.equal(harness.networkCalls.length, 0);
});

test('several servers require an explicit choice', async () => {
  const connections = [SERVER_A, SERVER_B];
  const kv = { defaultTopics: { 'conn-a': 'alerts', 'conn-b': 'home' } };

  const ambiguous = createHarness({ connections, kv, respond: () => published() });
  const result = await ambiguous.send({ message: 'hello' });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'AMBIGUOUS_SERVER');
  assert.match(result.message, /ntfy\.example\.test/);
  assert.match(result.message, /push\.example\.test/);
  assert.equal(ambiguous.networkCalls.length, 0, 'isDefault on a connection is not a silent pick');

  for (const server of ['push.example.test', 'conn-b', 'https://PUSH.example.test/']) {
    const harness = createHarness({ connections, kv, respond: () => published() });
    const sent = await harness.send({ message: 'hello', server });
    assert.equal(sent.ok, true, server);
    assert.equal(harness.networkCalls[0].url, 'https://push.example.test/');
    assert.equal(JSON.parse(harness.networkCalls[0].body).topic, 'home', 'uses that server default topic');
  }

  const unknown = createHarness({ connections, kv, respond: () => published() });
  const missing = await unknown.send({ message: 'hello', server: 'other.example.test' });
  assert.equal(missing.errorCode, 'SERVER_NOT_FOUND');
  assert.match(missing.message, /ntfy\.example\.test, push\.example\.test/);
  assert.equal(unknown.networkCalls.length, 0);
});

test('missing topic without a default topic is reported, and KV failure only loses defaults', async () => {
  const noDefault = createHarness({ kv: {}, respond: () => published() });
  const result = await noDefault.send({ message: 'hello' });
  assert.equal(result.errorCode, 'NO_TOPIC');
  assert.match(result.message, /default topic/);
  assert.equal(noDefault.networkCalls.length, 0);

  const invalidDefault = createHarness({ kv: { defaultTopics: { 'conn-a': 'bad topic' } }, respond: () => published() });
  assert.equal((await invalidDefault.send({ message: 'hello' })).errorCode, 'NO_TOPIC');

  const kvDown = createHarness({ kvFail: true, respond: () => published() });
  assert.equal((await kvDown.send({ message: 'hello' })).errorCode, 'NO_TOPIC');
  const kvDownExplicit = createHarness({ kvFail: true, respond: () => published() });
  assert.equal((await kvDownExplicit.send({ message: 'hello', topic: 'alerts' })).ok, true);
});

/* ── ntfy_send: HTTP and transport failures ──────────────────────────── */

test('401 and 403 say the token is invalid or lacks write access, and nothing was sent', async () => {
  const unauthorized = createHarness({
    respond: () => ({ ok: true, status: 401, body: '{"code":40101,"http":401,"error":"unauthorized"}' }),
  });
  const r401 = await unauthorized.send({ message: 'hello' });
  assert.equal(r401.errorCode, 'NTFY_UNAUTHORIZED');
  assert.match(r401.message, /^Not sent/);
  assert.match(r401.message, /token/);

  const forbidden = createHarness({
    respond: () => ({ ok: true, status: 403, body: '{"code":40301,"http":403,"error":"forbidden"}' }),
  });
  const r403 = await forbidden.send({ message: 'hello' });
  assert.equal(r403.errorCode, 'NTFY_FORBIDDEN');
  assert.match(r403.message, /^Not sent/);
  assert.match(r403.message, /no write permission on topic "alerts"/);
  assert.match(r403.message, /forbidden/);
  assert.equal(forbidden.networkCalls.length, 1);
});

test('404, 413, 429 and other 4xx are definite rejections', async () => {
  const cases = [
    [404, 'NTFY_NOT_FOUND', /root of the domain/],
    [413, 'MESSAGE_TOO_LARGE', /too large/],
    [429, 'NTFY_RATE_LIMITED', /do not retry in a loop/],
    [400, 'NTFY_REJECTED', /invalid request: priority/],
  ];
  for (const [status, errorCode, pattern] of cases) {
    const harness = createHarness({
      respond: () => ({ ok: true, status, body: JSON.stringify({ code: status * 100, http: status, error: 'invalid request: priority' }) }),
    });
    const result = await harness.send({ message: 'hello' });
    assert.equal(result.ok, false, String(status));
    assert.equal(result.errorCode, errorCode);
    assert.match(result.message, /^Not sent/);
    assert.match(result.message, pattern);
    assert.equal(harness.networkCalls.length, 1, 'never retried');
  }
});

test('5xx is an unknown outcome and is never retried', async () => {
  for (const status of [500, 502, 503, 504]) {
    const harness = createHarness({ respond: () => ({ ok: true, status, body: 'upstream error' }) });
    const result = await harness.send({ message: 'hello' });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'SEND_OUTCOME_UNKNOWN');
    assert.match(result.message, /^Outcome unknown/);
    assert.match(result.message, new RegExp(`HTTP ${status}`));
    assert.match(result.message, /may already have been delivered/);
    assert.match(result.message, /Do not resend automatically/);
    assert.equal(harness.networkCalls.length, 1, `HTTP ${status} must not be retried`);
  }
});

test('unexpected statuses are an unknown outcome', async () => {
  const harness = createHarness({ respond: () => ({ ok: true, status: 302, body: '' }) });
  const result = await harness.send({ message: 'hello' });
  assert.equal(result.errorCode, 'SEND_OUTCOME_UNKNOWN');
  assert.equal(harness.networkCalls.length, 1);
});

test('timeouts, network errors and thrown fetches are unknown outcomes and never retried', async () => {
  const responders = [
    () => ({ ok: false, errorCode: 'TIMEOUT', message: 'Request timed out after 20000ms' }),
    () => ({ ok: false, errorCode: 'NETWORK_ERROR', message: 'ECONNRESET' }),
    () => ({ ok: false }),
    () => undefined,
    () => { throw new Error('socket hang up'); },
    () => Promise.reject(new Error('aborted')),
  ];
  for (const respond of responders) {
    const harness = createHarness({ respond });
    const result = await harness.send({ message: 'hello' });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'SEND_OUTCOME_UNKNOWN', String(respond));
    assert.match(result.message, /^Outcome unknown/);
    assert.match(result.message, /Do not resend automatically/);
    assert.equal(harness.networkCalls.length, 1, 'never retried');
  }
});

// cindy.fetch reports failures as { ok: false, message } with free-form text only
// (Cindy shared/ghost.ts GhostPipeFetchResult). Text that sounds pre-dispatch is
// not proof the POST never left, e.g. a blocked redirect happens after the
// server already received the request, so none of these may say "safe to resend".
test('host fetch failures are outcome unknown even when their text sounds pre-dispatch', async () => {
  const cases = [
    { ok: false, message: '重定向超出了本意识的域名白名单,已阻断' },
    { ok: false, message: 'Redirect to a host that is not allowed was blocked' },
    { ok: false, message: '重定向到了非 https/非默认端口地址,已阻断' },
    { ok: false, errorCode: 'PERMISSION_DENIED', message: 'The user denied the network request' },
    { ok: false, errorCode: 'HOST_ERROR', message: 'host ntfy.example.test is not allowed' },
    { ok: false, message: 'credential not configured' },
    { ok: false, errorCode: 'INVALID_PARAMS' },
  ];
  for (const response of cases) {
    const harness = createHarness({ respond: () => response });
    const result = await harness.send({ message: 'hello' });
    assert.equal(result.errorCode, 'SEND_OUTCOME_UNKNOWN', JSON.stringify(response));
    assert.match(result.message, /^Outcome unknown/);
    assert.match(result.message, /Do not resend automatically/);
    assert.doesNotMatch(result.message, /sending again is safe/);
    assert.equal(harness.networkCalls.length, 1, 'never retried');
  }
  assert.doesNotMatch(source, /SEND_NOT_DISPATCHED/, 'no host failure is classified as not dispatched');
});

test('the access token never appears in results, even when echoed back', async () => {
  const echoes = [
    () => ({ ok: true, status: 400, body: JSON.stringify({ error: `bad header Authorization: Bearer ${TOKEN}` }) }),
    () => ({ ok: true, status: 401, body: `token ${TOKEN} rejected` }),
    () => ({ ok: false, errorCode: 'NETWORK_ERROR', message: `failed with Bearer ${TOKEN}` }),
    () => { throw new Error(`proxy said ${TOKEN}`); },
  ];
  for (const respond of echoes) {
    const harness = createHarness({ respond });
    // createHarness.call asserts the token is absent from every tool result.
    const result = await harness.send({ message: 'hello' });
    assert.equal(result.ok, false);
    assert.equal(hasAuthorizationHeader(harness.networkCalls[0].headers), false);
  }
});

test('unknown tools get exactly one failure result', async () => {
  const harness = createHarness();
  const result = await harness.call('ntfy_delete', {});
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'UNKNOWN_TOOL');
});

/* ── ntfy_servers ────────────────────────────────────────────────────── */

test('ntfy_servers lists id, host, url and default topic, never token data', async () => {
  const harness = createHarness({
    connections: [SERVER_A, SERVER_B],
    kv: { defaultTopics: { 'conn-a': 'alerts', 'conn-b': 'bad topic' } },
  });
  const result = await harness.call('ntfy_servers', {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, {
    count: 2,
    servers: [
      { id: 'conn-a', host: 'ntfy.example.test', url: 'https://ntfy.example.test', default_topic: 'alerts' },
      { id: 'conn-b', host: 'push.example.test', url: 'https://push.example.test', default_topic: null },
    ],
  });
  const text = JSON.stringify(result);
  assert.equal(text.includes('pqrs'), false, 'token tail is not exposed');
  assert.equal(text.includes('tail'), false);
  assert.equal(harness.networkCalls.length, 0);
});

test('ntfy_servers with nothing configured says how to add a server', async () => {
  const harness = createHarness({ connections: [] });
  const result = await harness.call('ntfy_servers', {});
  assert.equal(result.ok, true);
  assert.equal(result.result.count, 0);
  assert.deepEqual(result.result.servers, []);
  assert.match(result.result.note, /plugin settings/);
});

/* ── Settings page behavior (DOM and data plane mocked) ──────────────── */

// Elements of settings.html that carry data-i18n* attributes, keyed by id.
function settingsCopyBindings() {
  const bindings = [];
  for (const match of settingsHtml.matchAll(/<(\w+)\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const i18n = Object.fromEntries(Object.entries(attrs).filter(([name]) => name.startsWith('data-i18n')));
    if (Object.keys(i18n).length) bindings.push({ id: attrs.id ?? null, i18n });
  }
  return bindings;
}

function createSettingsHarness(options = {}) {
  let connections = (options.connections ?? []).map((c) => ({ ...c }));
  let kv = options.kv ?? {};
  const fetchCalls = [];
  const posts = [];

  function element(tag = 'div') {
    const listeners = new Map();
    let text = '';
    return {
      tagName: tag.toUpperCase(),
      value: '',
      type: '',
      placeholder: '',
      title: '',
      className: '',
      disabled: false,
      attributes: {},
      children: [],
      get textContent() {
        return text;
      },
      set textContent(value) {
        text = String(value);
        this.children = [];
      },
      classList: {
        names: new Set(),
        toggle(name, force) {
          const on = force === undefined ? !this.names.has(name) : Boolean(force);
          if (on) this.names.add(name);
          else this.names.delete(name);
          return on;
        },
        add(name) { this.names.add(name); },
        remove(name) { this.names.delete(name); },
        contains(name) { return this.names.has(name); },
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      getAttribute(name) {
        return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      focus() {},
      emit(type, event = {}) {
        const listener = listeners.get(type);
        assert.ok(listener, `missing ${type} listener`);
        return listener({ preventDefault() {}, ...event });
      },
    };
  }

  const ids = ['title', 'badge', 'hint', 'list', 'host', 'token', 'eye', 'topic', 'add', 'status'];
  const elements = new Map(ids.map((id) => [id, element(id === 'add' || id === 'eye' ? 'button' : 'div')]));
  const copyNodes = settingsCopyBindings().map(({ id, i18n }) => {
    assert.ok(id && elements.has(id), `data-i18n element without a known id: ${JSON.stringify(i18n)}`);
    const node = elements.get(id);
    Object.assign(node.attributes, i18n);
    return node;
  });
  const document = {
    documentElement: { lang: '' },
    getElementById(id) {
      return elements.get(id);
    },
    createElement(tag) {
      return element(tag);
    },
    querySelectorAll(selector) {
      const match = /^\[(data-i18n(?:-title|-aria-label|-placeholder)?)\]$/.exec(selector);
      assert.ok(match, `unexpected selector ${selector}`);
      return copyNodes.filter((node) => node.getAttribute(match[1]) !== null);
    },
  };

  const json = (data, ok = true) => ({ ok, status: ok ? 200 : 500, async json() { return data; } });
  const fetchMock = async (url, init = {}) => {
    fetchCalls.push({ url, init });
    const method = init.method ?? 'GET';
    if (url === '/app-context') {
      if (options.appContextResponse) return options.appContextResponse(init);
      return json(options.appContext ?? { ok: true, context: { region: 'global', locale: options.locale ?? 'en' } });
    }
    if (url === '/connections' && method === 'GET') {
      return json([{ key: 'ntfy_conn', label: 'ntfy server', maxConnections: 8, connections }]);
    }
    if (url === '/connections/ntfy_conn' && method === 'POST') {
      const body = JSON.parse(init.body);
      posts.push(body);
      if (options.addGate) await options.addGate;
      const result = options.addResult ?? { ok: true };
      if (result.ok && !connections.some((c) => c.host === body.host)) {
        connections.push({ id: `conn-${connections.length + 1}`, host: body.host, label: body.host, isDefault: false, tail: body.token.slice(-4) });
      }
      return json(result);
    }
    if (url.startsWith('/connections/ntfy_conn/') && method === 'DELETE') {
      const id = decodeURIComponent(url.slice('/connections/ntfy_conn/'.length));
      connections = connections.filter((c) => c.id !== id);
      return json({ ok: true });
    }
    // Like the real data plane, every read returns a fresh copy and the store only
    // changes on PUT; the extra turn lets concurrent read-modify-writes interleave.
    if (url === '/kv' && method === 'GET') {
      const snapshot = structuredClone(kv);
      await new Promise((resolve) => setImmediate(resolve));
      return json(snapshot);
    }
    if (url === '/kv' && method === 'PUT') {
      await new Promise((resolve) => setImmediate(resolve));
      if (options.kvWriteFails) return json({ ok: false }, false);
      kv = JSON.parse(init.body);
      return json({ ok: true });
    }
    throw new Error(`unexpected settings request ${method} ${url}`);
  };

  // No navigator in this context: reading it would throw.
  const context = {
    document,
    fetch: fetchMock,
    AbortController,
    setTimeout: options.setTimeout ?? (() => 1),
    clearTimeout: () => {},
    encodeURIComponent,
  };
  vm.runInNewContext(settingsSource, context);

  return {
    document,
    messages: context.MESSAGES,
    el: (id) => elements.get(id),
    fetchCalls,
    posts,
    get kv() {
      return kv;
    },
    rows() {
      return elements.get('list').children.filter((child) => child.className === 'server');
    },
  };
}

test('settings page reads /app-context and falls back to English', async () => {
  // ja is a supported locale now, so an unsupported one exercises the fallback.
  const page = createSettingsHarness({ appContext: { ok: true, context: { region: 'global', locale: 'fr' } } });
  await flushAsync();
  assert.equal(page.fetchCalls[0].url, '/app-context');
  assert.equal(page.document.documentElement.lang, 'en');
  assert.equal(page.el('add').textContent, 'Add');
  assert.match(page.el('list').children[0].textContent, /No ntfy server added yet/);
});

test('settings page adds a server, sends the token only to the host and stores the default topic', async () => {
  const page = createSettingsHarness({ kv: { unrelated: 1 } });
  await flushAsync();
  page.el('host').value = '  https://NTFY.example.test/ ';
  page.el('token').value = ` ${TOKEN} `;
  page.el('topic').value = 'alerts';
  page.el('add').emit('click');
  await flushAsync();

  assert.deepEqual(plain(page.posts), [{ host: 'ntfy.example.test', token: TOKEN }]);
  assert.deepEqual(plain(page.kv), { unrelated: 1, defaultTopics: { 'conn-1': 'alerts' } });
  assert.equal(JSON.stringify(page.kv).includes(TOKEN), false, 'the token never lands in KV');
  assert.equal(page.el('token').value, '');
  assert.equal(page.el('host').value, '');
  assert.match(page.el('status').textContent, /Added ntfy\.example\.test/);
  assert.equal(page.rows().length, 1);
  assert.equal(page.rows()[0].children[1].value, 'alerts');
});

test('settings page accepts an explicit :443 and refuses http, ports, paths, bad topics and missing input', async () => {
  const ok443 = createSettingsHarness();
  await flushAsync();
  ok443.el('host').value = 'ntfy.example.test:443';
  ok443.el('token').value = TOKEN;
  ok443.el('add').emit('click');
  await flushAsync();
  assert.deepEqual(plain(ok443.posts), [{ host: 'ntfy.example.test', token: TOKEN }]);

  const cases = [
    [{ host: 'http://ntfy.example.test', token: TOKEN }, /Only https/],
    [{ host: 'ntfy.example.test:8080', token: TOKEN }, /Custom ports/],
    [{ host: 'https://example.test/ntfy', token: TOKEN }, /without a path/],
    [{ host: 'user@ntfy.example.test', token: TOKEN }, /valid server address/],
    [{ host: 'localhost', token: TOKEN }, /valid server address/],
    [{ host: '', token: TOKEN }, /Enter the server URL/],
    [{ host: 'ntfy.example.test', token: '  ' }, /Paste the access token/],
    [{ host: 'ntfy.example.test', token: TOKEN, topic: 'bad topic' }, /Topics may contain/],
  ];
  for (const [input, pattern] of cases) {
    const page = createSettingsHarness();
    await flushAsync();
    page.el('host').value = input.host;
    page.el('token').value = input.token;
    page.el('topic').value = input.topic ?? '';
    page.el('add').emit('click');
    await flushAsync();
    assert.equal(page.posts.length, 0, JSON.stringify(input));
    assert.match(page.el('status').textContent, pattern);
  }
});

test('settings page reports host errors from adding a connection', async () => {
  const page = createSettingsHarness({ addResult: { ok: false, error: 'CONFIRM_DENIED' } });
  await flushAsync();
  page.el('host').value = 'ntfy.example.test';
  page.el('token').value = TOKEN;
  page.el('topic').value = 'alerts';
  page.el('add').emit('click');
  await flushAsync();
  assert.equal(page.posts.length, 1);
  assert.match(page.el('status').textContent, /Cancelled/);
  assert.deepEqual(plain(page.kv), {}, 'no topic stored for a server that was not added');
  assert.equal(page.el('add').disabled, false);
});

test('settings page edits and clears the default topic, and removal drops it', async () => {
  const page = createSettingsHarness({
    connections: [SERVER_A],
    kv: { defaultTopics: { 'conn-a': 'alerts' }, unrelated: 1 },
  });
  await flushAsync();
  const [row] = page.rows();
  const [, topicInput, saveButton, removeButton] = row.children;
  assert.equal(topicInput.value, 'alerts');

  topicInput.value = 'not valid!';
  saveButton.emit('click');
  await flushAsync();
  assert.match(page.el('status').textContent, /Topics may contain/);
  assert.equal(page.kv.defaultTopics['conn-a'], 'alerts');

  topicInput.value = 'deploys';
  saveButton.emit('click');
  await flushAsync();
  assert.equal(page.kv.defaultTopics['conn-a'], 'deploys');

  removeButton.emit('click');
  await flushAsync();
  assert.ok(page.fetchCalls.some((call) => call.url === '/connections/ntfy_conn/conn-a' && call.init.method === 'DELETE'));
  assert.deepEqual(plain(page.kv), { defaultTopics: {}, unrelated: 1 });
  assert.equal(page.rows().length, 0);
});

/* ── Runtime and settings localization ───────────────────────────────── */

const hostLocales = ['en', 'zh-CN', 'ja', 'ko'];
const placeholdersOf = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
// Han, kana, Hangul and full-width punctuation: anything that is not English copy.
const cjkRe = /[　-ヿ㐀-鿿가-힯＀-￯]/;
const hanRe = /[一-鿿]/;
// Half-width , ; : ( ) touching Han or kana, which Chinese and Japanese write full-width.
const halfWidthInCjkRe = /[぀-ヿ一-鿿][,;:()]|[,;:(][぀-ヿ一-鿿]/;
const SETTINGS_HOST_ERRORS = ['INVALID_HOST', 'INVALID_TOKEN', 'TOKEN_TOO_LONG', 'INVALID_LABEL', 'LIMIT', 'CONFIRM_DENIED', 'VAULT_WRITE_FAILED'];

function assertParity(messages, label) {
  assert.deepEqual(Object.keys(messages).sort(), [...hostLocales].sort(), `${label} locales`);
  const keys = Object.keys(messages.en).sort();
  for (const locale of hostLocales) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys, `${label} ${locale} keys`);
    for (const key of keys) {
      const text = messages[locale][key];
      assert.equal(typeof text, 'string', `${label} ${locale}.${key}`);
      assert.ok(text.trim(), `${label} ${locale}.${key} is empty`);
      assert.deepEqual(placeholdersOf(text), placeholdersOf(messages.en[key]), `${label} ${locale}.${key} placeholders`);
      if (locale === 'en') assert.doesNotMatch(text, cjkRe, `${label} en.${key}`);
      else assert.notEqual(text, messages.en[key], `${label} ${locale}.${key} is still English`);
      if (locale === 'ko') assert.doesNotMatch(text, hanRe, `${label} ko.${key} contains Han characters`);
      if (locale === 'zh-CN' || locale === 'ja') {
        assert.doesNotMatch(text, halfWidthInCjkRe, `${label} ${locale}.${key} uses half-width punctuation`);
      }
    }
  }
}

test('runtime and settings message tables have identical keys and placeholders in all four locales', () => {
  assertParity(createHarness().messages, 'main.js');
  assertParity(createSettingsHarness().messages, 'settings.js');
});

test('every message key used by the code or settings.html exists, and no key is unused', () => {
  const main = createHarness().messages.en;
  const mainKeys = [
    ...source.matchAll(/\bt\('(\w+)'/g),
    ...source.matchAll(/\brejected\('[A-Z_]+', '(\w+)'\)/g),
  ].map((m) => m[1]);
  assert.ok(mainKeys.length >= 30);
  for (const key of mainKeys) assert.ok(Object.hasOwn(main, key), `main.js ${key}`);
  assert.deepEqual([...new Set(mainKeys)].sort(), Object.keys(main).sort(), 'main.js keys used exactly');

  const settings = createSettingsHarness().messages.en;
  const settingsKeys = [
    ...settingsSource.matchAll(/\bt\('(\w+)'/g),
    ...settingsSource.matchAll(/\berror: '(\w+)'/g),
    ...settingsSource.matchAll(/\bt\(replacing \? '(\w+)' : '(\w+)'/g).flatMap((m) => [[0, m[1]], [0, m[2]]]),
    ...settingsHtml.matchAll(/data-i18n(?:-title|-aria-label|-placeholder)?="(\w+)"/g),
  ].map((m) => m[1]);
  for (const key of settingsKeys) assert.ok(Object.hasOwn(settings, key), `settings ${key}`);
  for (const code of SETTINGS_HOST_ERRORS) assert.ok(Object.hasOwn(settings, `error_${code}`), code);
  const used = new Set([...settingsKeys, ...SETTINGS_HOST_ERRORS.map((code) => `error_${code}`)]);
  for (const key of Object.keys(settings)) assert.ok(used.has(key), `unused settings key ${key}`);
});

test('no CJK text outside comments and the zh-CN, ja and ko tables', () => {
  const stripComments = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const cjkTables = /\n {2}(?:'zh-CN'|ja|ko): \{[\s\S]*?\n {2}\},(?=\n)/g;
  for (const [label, text] of [['main.js', source], ['settings.js', settingsSource], ['settings.html', settingsHtml]]) {
    const outside = stripComments(text).replace(cjkTables, '');
    assert.deepEqual(outside.split('\n').filter((line) => cjkRe.test(line)), [], label);
  }
});

test('settings.html ships no visible copy before the host locale is known', () => {
  const body = settingsHtml.slice(settingsHtml.indexOf('<body>'), settingsHtml.indexOf('</body>'));
  const text = body.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
  assert.equal(text, '');
  assert.doesNotMatch(body, /\s(?:placeholder|aria-label|title)="/, 'copy attributes come from data-i18n-*');
});

test('locale resources and zh-CN or ja copy use full-width punctuation inside CJK sentences', () => {
  const walk = (value, at) => (typeof value === 'string'
    ? [[at, value]]
    : Object.entries(value).flatMap(([key, child]) => walk(child, `${at}.${key}`)));
  for (const locale of ['zh-CN', 'ja']) {
    for (const [at, text] of walk(locales[locale], locale)) {
      assert.doesNotMatch(text, halfWidthInCjkRe, at);
    }
  }
});

test('English runtime copy is the previous text, byte for byte', async () => {
  const outcome = createHarness({ respond: () => ({ ok: true, status: 502, body: 'bad gateway' }) });
  assert.equal(
    (await outcome.send({ message: 'hello' })).message,
    'Outcome unknown: ntfy.example.test returned a server error (HTTP 502). The request may have reached ntfy.example.test and the notification may already have been delivered to topic "alerts". Do not resend automatically; ask the user to check the topic in their ntfy app before sending again.',
  );
  const noResponse = createHarness({ respond: () => ({ ok: false }) });
  assert.match((await noResponse.send({ message: 'hello' })).message, /^Outcome unknown: no response from ntfy\.example\.test \(timeout or network error\)\. /);
  const thrown = createHarness({ respond: () => { throw new Error(''); } });
  assert.match((await thrown.send({ message: 'hello' })).message, /^Outcome unknown: the request failed \(no details\)\. /);
  const unauthorized = createHarness({ respond: () => ({ ok: true, status: 401, body: '{"error":"unauthorized"}' }) });
  assert.equal(
    (await unauthorized.send({ message: 'hello' })).message,
    'Not sent: ntfy.example.test rejected the access token (HTTP 401). The token is missing, invalid or expired; ask the user to replace it in the ntfy plugin settings. Server said: unauthorized',
  );
  const rejected = createHarness({ respond: () => ({ ok: true, status: 400, body: '' }) });
  assert.equal((await rejected.send({ message: 'hello' })).message, 'Not sent: ntfy.example.test rejected the notification (HTTP 400).');
  const hostFailure = createHarness({ respond: () => ({ ok: false, message: 'ECONNRESET' }) });
  assert.match((await hostFailure.send({ message: 'hello' })).message, /^Outcome unknown: no response from ntfy\.example\.test \(ECONNRESET\)\. /);
  const tooLarge = createHarness();
  assert.equal(
    (await tooLarge.send({ message: 'a'.repeat(4097) })).message,
    'message is 4097 bytes; ntfy accepts at most 4096 UTF-8 bytes. Shorten it (nothing was sent and nothing was truncated).',
  );
  const noId = createHarness({ respond: () => ({ ok: true, status: 200, body: '' }) });
  assert.equal((await noId.send({ message: 'hello' })).result.note, 'ntfy accepted the notification (HTTP 200) but did not return a message id.');
  const unknown = createHarness();
  assert.equal((await unknown.call('ntfy_delete', {})).message, 'Unknown tool: ntfy_delete');
});

test('runtime copy falls back to English for unsupported or unavailable host locales', async () => {
  const english = 'No ntfy server is configured. Ask the user to add one (server URL and access token) in the ntfy plugin settings.';
  const variants = {
    unsupported: { locale: 'fr' },
    regionTag: { locale: 'zh-TW' },
    notOk: { appContext: () => ({ ok: false }) },
    missingLocale: { appContext: () => ({ ok: true, context: {} }) },
    throws: { appContext: () => { throw new Error('host unavailable'); } },
    rejects: { appContext: () => Promise.reject(new Error('host unavailable')) },
    noRequestApi: { withoutRequest: true },
    hangs: {
      appContext: () => new Promise(() => {}),
      setTimeout: (fn) => { setImmediate(fn); return 1; },
    },
  };
  for (const [label, options] of Object.entries(variants)) {
    const harness = createHarness({ ...options, connections: [] });
    const result = await harness.send({ message: 'hello', topic: 'alerts' });
    assert.equal(result.errorCode, 'NOT_CONFIGURED', label);
    assert.equal(result.message, english, label);
  }
});

for (const locale of ['zh-CN', 'ja', 'ko']) {
  test(`${locale} runtime copy keeps error codes, hosts, topics and safety guidance`, async () => {
    const harness = createHarness({ locale });
    const m = harness.messages[locale];
    const fill = (key, vars) => m[key].replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));

    const fiveHundred = createHarness({ locale, respond: () => ({ ok: true, status: 503, body: 'down' }) });
    const unknown = await fiveHundred.send({ message: 'hello' });
    assert.equal(unknown.errorCode, 'SEND_OUTCOME_UNKNOWN');
    assert.equal(unknown.message, fill('unknownOutcome', {
      reason: fill('reasonServerError', { host: 'ntfy.example.test', status: 503 }),
      host: 'ntfy.example.test',
      topic: 'alerts',
    }));
    assert.ok(unknown.message.includes('HTTP 503') && unknown.message.includes('alerts'));
    assert.equal(fiveHundred.networkCalls.length, 1, 'never retried in any locale');

    const forbidden = createHarness({ locale, respond: () => ({ ok: true, status: 403, body: '{"error":"forbidden"}' }) });
    const r403 = await forbidden.send({ message: 'hello' });
    assert.equal(r403.errorCode, 'NTFY_FORBIDDEN');
    assert.equal(r403.message, fill('withServerDetail', {
      message: fill('forbidden', { host: 'ntfy.example.test', topic: 'alerts' }),
      detail: 'forbidden',
    }));

    const blocked = createHarness({ locale, respond: () => ({ ok: false, message: 'redirect blocked' }) });
    const hostFailure = await blocked.send({ message: 'hello' });
    assert.equal(hostFailure.errorCode, 'SEND_OUTCOME_UNKNOWN');
    assert.equal(hostFailure.message, fill('unknownOutcome', {
      reason: fill('reasonNoResponse', { host: 'ntfy.example.test', detail: 'redirect blocked' }),
      host: 'ntfy.example.test',
      topic: 'alerts',
    }));

    const tooLarge = await harness.send({ message: 'a'.repeat(4097) });
    assert.equal(tooLarge.errorCode, 'MESSAGE_TOO_LARGE');
    assert.ok(tooLarge.message.includes('4097') && tooLarge.message.includes('4096'));

    const priority = await harness.send({ message: 'hello', priority: 'max' });
    assert.equal(priority.errorCode, 'INVALID_PRIORITY');
    assert.ok(priority.message.includes('"max"') || priority.message.includes('「max」') || priority.message.includes('“max”'));
    assert.match(priority.message, /min.*low.*default.*high.*urgent/);

    const unknownTool = await harness.call('ntfy_delete', {});
    assert.equal(unknownTool.message, fill('unknownTool', { tool: 'ntfy_delete' }));

    const empty = createHarness({ locale, connections: [] });
    const listed = await empty.call('ntfy_servers', {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.note, m.notConfigured);
    assert.doesNotMatch(JSON.stringify(unknown) + JSON.stringify(r403), /Not sent|Outcome unknown/);
  });
}

test('host-context-changed switches runtime copy without another app-context request', async () => {
  const harness = createHarness({ connections: [] });
  const send = async () => (await harness.send({ message: 'hello', topic: 'alerts' })).message;
  assert.equal(await send(), harness.messages.en.notConfigured);
  assert.equal(harness.appContextRequests.length, 1);
  for (const [context, locale] of [
    [{ region: 'cn', locale: 'zh-CN' }, 'zh-CN'],
    [{ locale: 'ko' }, 'ko'],
    [{ locale: 'ja' }, 'ja'],
    [{ locale: 'xx' }, 'en'],
    [undefined, 'en'],
  ]) {
    await harness.hostMessage({ type: 'host-context-changed', context });
    assert.equal(await send(), harness.messages[locale].notConfigured, JSON.stringify(context));
  }
  assert.equal(harness.appContextRequests.length, 1);
  assert.equal(harness.toolResults.length, 6, 'context changes produce no tool results');
});

test('a locale change that arrives during the app-context request wins over the stale reply', async () => {
  let resolveContext;
  const harness = createHarness({
    connections: [],
    appContext: () => new Promise((resolve) => { resolveContext = resolve; }),
  });
  const sending = harness.send({ message: 'hello', topic: 'alerts' });
  await flushAsync();
  await harness.hostMessage({ type: 'host-context-changed', context: { locale: 'ja' } });
  resolveContext({ ok: true, context: { locale: 'zh-CN' } });
  assert.equal((await sending).message, harness.messages.ja.notConfigured);
  assert.equal((await harness.send({ message: 'hello', topic: 'alerts' })).message, harness.messages.ja.notConfigured);
  assert.equal(harness.appContextRequests.length, 1);
});

test('concurrent tool calls share one app-context request and nothing is sent before it settles', async () => {
  let resolveContext;
  const harness = createHarness({
    appContext: () => new Promise((resolve) => { resolveContext = resolve; }),
    respond: () => ({ ok: true, status: 401, body: '' }),
  });
  const calls = [1, 2, 3].map((n) => harness.hostMessage({
    type: 'tool-call', tool: 'ntfy_send', callId: `call-${n}`, args: { message: `hello ${n}` },
  }));
  await flushAsync();
  assert.equal(harness.appContextRequests.length, 1);
  assert.equal(harness.networkCalls.length, 0, 'no send before the locale is known');
  resolveContext({ ok: true, context: { locale: 'ko' } });
  await Promise.all(calls);
  assert.equal(harness.toolResults.length, 3);
  assert.equal(harness.networkCalls.length, 3);
  const expected = harness.messages.ko.unauthorized.replace('{host}', 'ntfy.example.test');
  for (const result of harness.toolResults) {
    assert.equal(result.errorCode, 'NTFY_UNAUTHORIZED');
    assert.equal(result.message, expected);
  }
});

test('a failed app-context lookup is retried on the next call instead of pinning English', async () => {
  let attempts = 0;
  const harness = createHarness({
    connections: [],
    appContext: () => {
      attempts += 1;
      if (attempts === 1) throw new Error('host busy');
      return { ok: true, context: { locale: 'zh-CN' } };
    },
  });
  const send = async () => (await harness.send({ message: 'hello', topic: 'alerts' })).message;
  assert.equal(await send(), harness.messages.en.notConfigured);
  assert.equal(await send(), harness.messages['zh-CN'].notConfigured);
  assert.equal(await send(), harness.messages['zh-CN'].notConfigured);
  assert.equal(attempts, 2, 'cached after the first success');
});

for (const locale of hostLocales) {
  test(`settings page renders ${locale} copy from /app-context`, async () => {
    const page = createSettingsHarness({ locale, connections: [SERVER_A], kv: { defaultTopics: { 'conn-a': 'alerts' } } });
    await flushAsync();
    const m = page.messages[locale];
    assert.equal(page.fetchCalls[0].url, '/app-context', 'the locale is resolved before any other request');
    assert.equal(page.document.documentElement.lang, locale);
    assert.equal(page.el('title').textContent, m.title);
    assert.equal(page.el('badge').textContent, m.badge);
    assert.equal(page.el('hint').textContent, m.hint);
    assert.equal(page.el('add').textContent, m.add);
    assert.equal(page.el('host').getAttribute('placeholder'), m.hostPlaceholder);
    assert.equal(page.el('host').getAttribute('aria-label'), m.hostLabel);
    assert.equal(page.el('token').getAttribute('placeholder'), m.tokenPlaceholder);
    assert.equal(page.el('token').getAttribute('aria-label'), m.tokenLabel);
    assert.equal(page.el('topic').getAttribute('placeholder'), m.topicPlaceholder);
    assert.equal(page.el('topic').getAttribute('aria-label'), m.topicLabel);
    assert.equal(page.el('eye').getAttribute('title'), m.eye);
    assert.equal(page.el('eye').getAttribute('aria-label'), m.eye);

    const [row] = page.rows();
    const [, topicInput, saveButton, removeButton] = row.children;
    assert.equal(topicInput.placeholder, m.topicPlaceholder);
    assert.equal(topicInput.attributes['aria-label'], m.rowTopicLabel.replace('{host}', 'ntfy.example.test'));
    assert.equal(saveButton.textContent, m.save);
    assert.equal(removeButton.textContent, m.remove);

    page.el('host').value = 'http://ntfy.example.test';
    page.el('token').value = TOKEN;
    page.el('add').emit('click');
    await flushAsync();
    assert.equal(page.el('status').textContent, m.httpNotSupported);
    assert.equal(page.posts.length, 0);
  });
}

test('settings page localizes host error codes and success status', async () => {
  for (const locale of ['ja', 'ko']) {
    const denied = createSettingsHarness({ locale, addResult: { ok: false, error: 'LIMIT' } });
    await flushAsync();
    denied.el('host').value = 'ntfy.example.test';
    denied.el('token').value = TOKEN;
    denied.el('add').emit('click');
    await flushAsync();
    assert.equal(denied.el('status').textContent, denied.messages[locale].error_LIMIT);

    const odd = createSettingsHarness({ locale, addResult: { ok: false, error: 'toString' } });
    await flushAsync();
    odd.el('host').value = 'ntfy.example.test';
    odd.el('token').value = TOKEN;
    odd.el('add').emit('click');
    await flushAsync();
    assert.equal(odd.el('status').textContent, odd.messages[locale].addFailed, 'unknown codes use the generic copy');

    const added = createSettingsHarness({ locale });
    await flushAsync();
    added.el('host').value = 'ntfy.example.test';
    added.el('token').value = TOKEN;
    added.el('add').emit('click');
    await flushAsync();
    assert.equal(added.el('status').textContent, added.messages[locale].added.replace('{host}', 'ntfy.example.test'));
  }
});

test('settings page falls back to English for unknown, failed, malformed or slow app-context', async () => {
  const json = (data, ok = true) => () => ({ ok, status: ok ? 200 : 500, async json() { return data; } });
  const variants = {
    unknown: { appContextResponse: json({ ok: true, context: { locale: 'de' } }) },
    httpError: { appContextResponse: json({ ok: true, context: { locale: 'ja' } }, false) },
    throws: { appContextResponse: () => { throw new Error('offline'); } },
    nullBody: { appContextResponse: json(null) },
    badJson: { appContextResponse: () => ({ ok: true, async json() { throw new SyntaxError('bad'); } }) },
    // The 2 s abort fires at once here; the request only settles through the abort signal.
    slow: {
      setTimeout: (fn) => { setImmediate(fn); return 1; },
      appContextResponse: (init) => new Promise((resolve, reject) => {
        assert.ok(init.signal, 'app-context request is abortable');
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    },
  };
  for (const [label, options] of Object.entries(variants)) {
    const page = createSettingsHarness(options);
    await flushAsync();
    assert.equal(page.document.documentElement.lang, 'en', label);
    assert.equal(page.el('add').textContent, 'Add', label);
    assert.equal(page.el('host').getAttribute('placeholder'), 'Server URL, e.g. https://ntfy.example.com', label);
    assert.match(page.el('list').children[0].textContent, /No ntfy server added yet/, label);
  }
});

/* ── Settings writes: one KV queue and one add at a time ─────────────── */

test('concurrent topic saves for two servers both persist', async () => {
  const page = createSettingsHarness({
    connections: [SERVER_A, SERVER_B],
    kv: { defaultTopics: { 'conn-a': 'old-a', 'conn-b': 'old-b' }, unrelated: 1 },
  });
  await flushAsync();
  const [rowA, rowB] = page.rows();
  rowA.children[1].value = 'new-a';
  rowB.children[1].value = 'new-b';
  rowA.children[2].emit('click');
  rowB.children[2].emit('click');
  await flushAsync(30);
  assert.deepEqual(plain(page.kv), { defaultTopics: { 'conn-a': 'new-a', 'conn-b': 'new-b' }, unrelated: 1 });
});

test('a remove and a topic save started together both reach KV', async () => {
  const page = createSettingsHarness({
    connections: [SERVER_A, SERVER_B],
    kv: { defaultTopics: { 'conn-a': 'old-a', 'conn-b': 'old-b' } },
  });
  await flushAsync();
  const [rowA, rowB] = page.rows();
  rowB.children[1].value = 'new-b';
  rowA.children[3].emit('click');
  rowB.children[2].emit('click');
  await flushAsync(30);
  assert.deepEqual(plain(page.kv), { defaultTopics: { 'conn-b': 'new-b' } });
});

test('a failed KV write does not block later writes', async () => {
  // The harness reads options.kvWriteFails on every PUT, so flipping it fails one write.
  const options = { connections: [SERVER_A], kv: { defaultTopics: {} }, kvWriteFails: true };
  const page = createSettingsHarness(options);
  await flushAsync();
  const [row] = page.rows();
  row.children[1].value = 'first';
  row.children[2].emit('click');
  await flushAsync(30);
  assert.equal(page.el('status').textContent, 'Could not save the default topic. Please try again.');
  assert.deepEqual(plain(page.kv), { defaultTopics: {} });
  options.kvWriteFails = false;
  row.children[1].value = 'second';
  row.children[2].emit('click');
  await flushAsync(30);
  assert.deepEqual(plain(page.kv), { defaultTopics: { 'conn-a': 'second' } });
});

test('repeated Enter or clicks while an add is pending start only one request', async () => {
  let release;
  const page = createSettingsHarness({ addGate: new Promise((resolve) => { release = resolve; }) });
  await flushAsync();
  page.el('host').value = 'ntfy.example.test';
  page.el('token').value = TOKEN;
  page.el('topic').value = 'alerts';
  for (let i = 0; i < 3; i += 1) page.el('topic').emit('keydown', { key: 'Enter' });
  page.el('add').emit('click');
  await flushAsync();
  assert.equal(page.posts.length, 1);
  release();
  await flushAsync(30);
  assert.equal(page.posts.length, 1);
  assert.match(page.el('status').textContent, /Added ntfy\.example\.test/);
  assert.deepEqual(plain(page.kv), { defaultTopics: { 'conn-1': 'alerts' } });

  // The guard is released afterwards: a second, separate add goes through.
  page.el('host').value = 'push.example.test';
  page.el('token').value = TOKEN;
  page.el('topic').emit('keydown', { key: 'Enter' });
  await flushAsync(30);
  assert.equal(page.posts.length, 2);
});
