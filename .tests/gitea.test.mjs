import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const pluginDir = path.join(root, 'gitea');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'ghost.json'), 'utf8'));
const source = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(pluginDir, 'settings.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(pluginDir, 'settings.html'), 'utf8');
const LOCALES = ['en', 'zh-CN', 'ja', 'ko'];

// Placeholder credential in the 40-hex shape Gitea uses. The fake host below
// "injects" it like Cindy does; the plugin must never see or echo it.
const TOKEN = '0123456789abcdef0123456789abcdef01234567';
const HOST = 'git.example.test';
const DEFAULT_CONNECTIONS = [{ id: 'conn-1', host: HOST, isDefault: true, tail: '4567' }];

// Values created inside the vm realm have foreign prototypes; normalize them
// so strict deep equality compares data only.
function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function json(data, status = 200, headers = {}) {
  return { ok: true, status, body: JSON.stringify(data), headers };
}

function text(body, status = 200) {
  return { ok: true, status, body, headers: {} };
}

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

// Existing assertions check the English copy, so the fake host reports `en`
// unless a test picks another locale or a failing app-context explicitly.
function createHarness(options = {}) {
  const connections = options.connections ?? DEFAULT_CONNECTIONS;
  const appContextRequests = [];
  const requests = [];
  const confirms = [];
  const results = [];
  const kvWrites = [];
  let handler = null;
  let channel = null;

  const cindy = {
    async request(message) {
      assert.deepEqual(plain(message), { kind: 'app-context' });
      appContextRequests.push(plain(message));
      if (options.appContext) return options.appContext();
      return { ok: true, context: { region: 'global', locale: options.locale ?? 'en' } };
    },
    onHostMessage(fn) {
      handler = fn;
    },
    async fetch(req) {
      const r = plain(req);
      requests.push(r);
      // What the host would add for a matching connection. Kept out of the
      // plugin's view on purpose; responders may echo it to prove redaction.
      const injected = { ...r.headers, Authorization: `token ${TOKEN}` };
      if (options.respond) return options.respond(r, injected, requests.length);
      return json({});
    },
    async send(message) {
      results.push(plain(message));
      return { ok: true };
    },
  };
  if (options.confirm !== false) {
    cindy.confirm = async (spec) => {
      confirms.push(plain(spec));
      if (typeof options.confirmAnswer === 'function') return options.confirmAnswer(spec);
      return options.confirmAnswer ?? { ok: true, confirmed: true };
    };
  }

  class FakeBroadcastChannel {
    constructor() {
      channel = this;
      this.posted = [];
    }

    postMessage(message) {
      this.posted.push(plain(message));
    }
  }

  const localFetch = async (url, init) => {
    if (url === '/connections') {
      return { ok: true, json: async () => [{ key: 'gitea_conn', connections }] };
    }
    if (url === '/kv') {
      if (init?.method === 'PUT') {
        kvWrites.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({}) };
    }
    throw new Error(`unexpected local fetch ${url}`);
  };

  if (options.withoutRequest) delete cindy.request;
  const context = {
    cindy,
    fetch: localFetch,
    BroadcastChannel: FakeBroadcastChannel,
    atob,
    TextDecoder,
    setTimeout: options.setTimeout ?? setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context, { filename: 'gitea/main.js' });
  assert.equal(typeof handler, 'function');

  return {
    appContextRequests,
    messages: context.MESSAGES,
    async hostMessage(message) {
      await handler(message);
    },
    requests,
    confirms,
    results,
    kvWrites,
    get channel() {
      return channel;
    },
    async call(name, args = {}, extra = {}) {
      await handler({ type: 'tool-call', tool: 'call_tool', callId: 'call-1', args: { name, args }, ...extra });
      return results.at(-1);
    },
    async listTools(category) {
      await handler({ type: 'tool-call', tool: 'list_tools', callId: 'call-1', args: category ? { category } : {} });
      return results.at(-1);
    },
  };
}

function urlOf(request) {
  return new URL(request.url);
}

function assertFailure(result, code) {
  assert.equal(result.type, 'tool-result');
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.errorCode, code, result.message);
  return result.message;
}

function assertSuccess(result) {
  assert.equal(result.type, 'tool-result');
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.result.data;
}

/* ── manifest, locales, static policy ──────────────────────────────── */

test('manifest declares a v3 package with per-instance token injection and business confirmation', () => {
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.id, 'gitea');
  assert.equal(manifest.minCindyVersion, '0.1.64');
  assert.equal(manifest.command, 'gitea');
  assert.equal(manifest.author, 'Rui Valim');
  assert.equal('slots' in manifest, false);
  assert.equal(manifest.confirm, true);
  assert.equal(manifest.settingsHtml, 'settings.html');
  assert.equal('notify' in manifest, false);
  assert.equal('fs' in manifest, false);
  assert.equal(manifest.network.hosts, undefined, 'no static hosts: every instance comes from a connection');
  assert.deepEqual(manifest.network.connections.map((c) => [c.key, c.inject]), [
    ['gitea_conn', { header: 'Authorization', format: 'token {value}' }],
  ]);
  assert.deepEqual(manifest.tools.map((t) => t.name), ['list_tools', 'call_tool']);
  assert.ok(fs.statSync(path.join(pluginDir, manifest.icon)).size > 0);
});

test('four locales cover the catalog, connection label and every tool with real text', () => {
  const seen = new Set();
  for (const locale of LOCALES) {
    const resource = JSON.parse(fs.readFileSync(path.join(pluginDir, manifest.locales[locale]), 'utf8'));
    for (const key of ['name', 'description', 'whenToUse']) {
      assert.ok(resource[key].trim().length > 0 && resource[key].length <= 300, `${locale}.${key}`);
    }
    assert.deepEqual(Object.keys(resource.tools).sort(), ['call_tool', 'list_tools']);
    for (const tool of Object.values(resource.tools)) assert.ok(tool.description.trim().length > 0);
    assert.ok(resource.network.connections.gitea_conn.label.trim());
    assert.ok(resource.network.connections.gitea_conn.hint.length <= 200);
    seen.add(resource.tools.call_tool.description);
  }
  assert.equal(seen.size, LOCALES.length, 'each locale must carry its own translation');
});

test('plugin sources contain no em or en dashes and never read the browser language', () => {
  for (const file of ['ghost.json', 'main.js', 'settings.js', 'settings.html', ...LOCALES.map((l) => `locales/${l}.json`)]) {
    const content = fs.readFileSync(path.join(pluginDir, file), 'utf8');
    assert.doesNotMatch(content, /[\u2013\u2014]/, file);
    assert.doesNotMatch(content, /navigator\.language/, file);
  }
  // The settings page passes an abort signal, so the call may carry options.
  assert.match(settingsSource, /fetch\('\/app-context'[,)]/);
  assert.doesNotMatch(source + settingsSource, /\b(?:navigator|Intl)\b/);
  assert.match(settingsHtml, /<script src="\/settings\.js"><\/script>/);
});

/* ── catalog ───────────────────────────────────────────────────────── */

test('list_tools gives an overview and per-category details with scopes and write flags', async () => {
  const h = createHarness();
  const overview = (await h.listTools()).result;
  const total = Object.values(overview.categories).reduce((sum, c) => sum + c.count, 0);
  assert.ok(total >= 20 && total <= 30, `operation count ${total}`);
  assert.equal(overview.categories.pulls.writes, 2);

  const pulls = (await h.listTools('pulls')).result.tools;
  const merge = pulls.find((t) => t.name === 'merge_pull_request');
  assert.equal(merge.write, true);
  assert.equal(merge.token_scope, 'write:repository');
  assert.match(merge.description, /^WRITE/);
  assert.equal(pulls.find((t) => t.name === 'list_pull_requests').write, false);

  assertFailure(await h.listTools('admin'), 'UNKNOWN_CATEGORY');
  assertFailure(await h.call('delete_repo', {}), 'UNKNOWN_OPERATION');
  assert.equal(h.requests.length, 0);
});

/* ── instance resolution ───────────────────────────────────────────── */

test('no configured instance fails before any request', async () => {
  const h = createHarness({ connections: [] });
  const message = assertFailure(await h.call('get_current_user'), 'NO_INSTANCE');
  assert.match(message, /settings/);
  assertFailure(await h.call('create_issue', { owner: 'o', repo: 'r', title: 'x' }), 'NO_INSTANCE');
  assert.equal(h.requests.length, 0);
  assert.equal(h.confirms.length, 0);
});

test('several instances without a default are ambiguous for reads; writes always need an explicit instance', async () => {
  const two = [
    { id: 'a', host: 'git.one.test' },
    { id: 'b', host: 'git.two.test' },
  ];
  const h = createHarness({ connections: two, respond: () => json({ login: 'alice' }) });
  const message = assertFailure(await h.call('get_current_user'), 'AMBIGUOUS_INSTANCE');
  assert.match(message, /git\.one\.test/);
  assert.match(message, /git\.two\.test/);
  assert.equal(h.requests.length, 0);

  assertSuccess(await h.call('get_current_user', { instance: 'git.two.test' }));
  assert.equal(urlOf(h.requests[0]).host, 'git.two.test');
  assertSuccess(await h.call('get_current_user', { instance: 'a' }));
  assert.equal(urlOf(h.requests[1]).host, 'git.one.test');
  assertFailure(await h.call('get_current_user', { instance: 'git.three.test' }), 'UNKNOWN_INSTANCE');

  const withDefault = createHarness({
    connections: [{ ...two[0] }, { ...two[1], isDefault: true }],
    respond: () => json({ login: 'alice' }),
  });
  assertSuccess(await withDefault.call('get_current_user'));
  assert.equal(urlOf(withDefault.requests[0]).host, 'git.two.test');
  assertFailure(await withDefault.call('create_issue', { owner: 'o', repo: 'r', title: 'x' }), 'AMBIGUOUS_INSTANCE');
  assert.equal(withDefault.confirms.length, 0);
  assert.equal(withDefault.requests.length, 1);
});

test('instances must be https on port 443 without a path', async () => {
  const h = createHarness({ respond: () => json({ login: 'alice' }) });
  for (const instance of ['http://git.example.test', 'git.example.test:3000', 'https://git.example.test:8443', 'https://git.example.test/gitea', 'ftp://git.example.test']) {
    assertFailure(await h.call('get_current_user', { instance }), 'INVALID_INSTANCE_URL');
  }
  assert.equal(h.requests.length, 0);
  assertSuccess(await h.call('get_current_user', { instance: 'https://GIT.example.test:443/' }));
  assert.equal(h.requests[0].url, 'https://git.example.test/api/v1/user');

  const badStored = createHarness({ connections: [{ id: 'x', host: 'git.example.test:8443' }] });
  assertFailure(await badStored.call('get_current_user'), 'INVALID_INSTANCE_URL');
  assert.equal(badStored.requests.length, 0);
});

/* ── request shape and HTTP errors ─────────────────────────────────── */

test('reads carry the call id and no credential header from the plugin', async () => {
  const h = createHarness({ respond: () => json({ id: 1, login: 'alice', full_name: 'Alice', avatar_url: 'https://x.test/a.png', is_admin: false }) });
  const data = assertSuccess(await h.call('get_current_user'));
  assert.equal(data.login, 'alice');
  assert.equal('avatar_url' in data, false);
  const req = h.requests[0];
  assert.equal(req.method, 'GET');
  assert.equal(req.callId, 'call-1');
  assert.equal(req.as, 'text');
  assert.equal(req.timeoutMs, 30000);
  assert.deepEqual(Object.keys(req.headers).map((k) => k.toLowerCase()), ['accept']);
});

for (const [status, code, pattern] of [
  [401, 'AUTH_FAILED', /HTTP 401.*replace it/],
  [403, 'FORBIDDEN', /"read:issue" scope/],
  [404, 'NOT_FOUND', /HTTP 404/],
  [409, 'CONFLICT', /Gitea said: branch already exists/],
  [422, 'VALIDATION_FAILED', /Gitea said: branch already exists/],
  [429, 'RATE_LIMITED', /Wait 30 seconds/],
  [500, 'SERVER_ERROR', /HTTP 500/],
  [503, 'SERVER_ERROR', /HTTP 503/],
]) {
  test(`read HTTP ${status} maps to ${code}`, async () => {
    const h = createHarness({
      respond: () => ({ ok: true, status, body: JSON.stringify({ message: 'branch already exists' }), headers: { 'Retry-After': '30' } }),
    });
    const message = assertFailure(await h.call('list_issues', { owner: 'o', repo: 'r' }), code);
    assert.match(message, pattern);
    assert.equal(h.requests.length, 1, 'reads are not retried either');
  });
}

test('network failures and timeouts on reads are reported as network errors', async () => {
  const timeout = createHarness({ respond: () => ({ ok: false, message: 'request timed out after 30000ms' }) });
  assert.match(assertFailure(await timeout.call('get_repo', { owner: 'o', repo: 'r' }), 'NETWORK_ERROR'), /timed out/);
  const thrown = createHarness({ respond: () => { throw new Error('ECONNRESET'); } });
  assert.match(assertFailure(await thrown.call('get_repo', { owner: 'o', repo: 'r' }), 'NETWORK_ERROR'), /ECONNRESET/);
});

test('the token never appears in any result, even when servers or the host echo it', async () => {
  const scenarios = [
    (r, injected) => ({ ok: true, status: 401, body: JSON.stringify({ message: `bad ${injected.Authorization}` }), headers: {} }),
    () => ({ ok: true, status: 403, body: JSON.stringify({ message: `token ${TOKEN} does not have at least one of required scope(s): [read:issue]` }), headers: {} }),
    () => ({ ok: true, status: 422, body: JSON.stringify({ message: `invalid ${TOKEN}` }), headers: {} }),
    () => ({ ok: true, status: 500, body: `Authorization: token ${TOKEN}`, headers: {} }),
    () => ({ ok: false, message: `socket hang up (Authorization: token ${TOKEN})` }),
    () => { throw new Error(`proxy rejected token ${TOKEN}`); },
  ];
  for (const respond of scenarios) {
    const h = createHarness({ respond });
    const read = await h.call('list_issues', { owner: 'o', repo: 'r' });
    assert.equal(read.ok, false);
    assert.doesNotMatch(JSON.stringify(read), new RegExp(TOKEN));
    const write = await h.call('comment_issue', { owner: 'o', repo: 'r', index: 1, body: 'hi' });
    assert.equal(write.ok, false);
    assert.doesNotMatch(JSON.stringify(write), new RegExp(TOKEN));
    for (const req of h.requests) {
      assert.equal(Object.keys(req.headers).some((k) => k.toLowerCase() === 'authorization'), false);
    }
  }
});

/* ── pagination, trimming and size caps ────────────────────────────── */

function rawIssue(n, extra = {}) {
  return {
    id: 1000 + n, number: n, title: `Issue ${n}`, state: 'open', body: 'x'.repeat(5000),
    user: { id: 7, login: 'alice', avatar_url: 'https://x.test/a.png', email: 'a@example.test' },
    labels: [{ id: 1, name: 'bug', color: 'ff0000', url: 'https://x.test/l' }],
    assignees: [{ login: 'bob', avatar_url: 'https://x.test/b.png' }],
    milestone: { id: 3, title: 'v1' }, comments: 2,
    repository: { id: 9, full_name: 'o/r', owner: 'o' },
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
    html_url: `https://${HOST}/o/r/issues/${n}`, url: 'api', original_author: '', assets: [],
    ...extra,
  };
}

test('pagination defaults to 20, caps limit at 50 and validates page/limit', async () => {
  const h = createHarness({ respond: () => json([]) });
  assertSuccess(await h.call('list_issues', { owner: 'o', repo: 'r' }));
  let q = urlOf(h.requests[0]).searchParams;
  assert.equal(q.get('page'), '1');
  assert.equal(q.get('limit'), '20');
  assert.equal(q.get('type'), 'issues');

  const capped = assertSuccess(await h.call('list_issues', { owner: 'o', repo: 'r', limit: 500, page: 3 }));
  q = urlOf(h.requests[1]).searchParams;
  assert.equal(q.get('limit'), '50');
  assert.equal(q.get('page'), '3');
  assert.equal(capped.limit, 50);
  assert.match(capped.note, /capped/);

  for (const bad of [{ page: 0 }, { page: -1 }, { page: 'x' }, { limit: 0 }, { limit: 2.5 }, { page: 1e9 }]) {
    assertFailure(await h.call('list_issues', { owner: 'o', repo: 'r', ...bad }), 'INVALID_ARGS');
  }
  assert.equal(h.requests.length, 2);
});

test('has_more follows X-Total-Count; comment lists are sliced locally', async () => {
  const h = createHarness({
    respond: (req) => {
      if (req.url.includes('/comments')) {
        return json(Array.from({ length: 25 }, (_, i) => ({ id: i + 1, body: 'c', user: { login: 'u' } })));
      }
      return json([rawIssue(1)], 200, { 'X-Total-Count': '45' });
    },
  });
  assert.equal(assertSuccess(await h.call('list_issues', { owner: 'o', repo: 'r', page: 2 })).has_more, true);
  const last = assertSuccess(await h.call('list_issues', { owner: 'o', repo: 'r', page: 3 }));
  assert.equal(last.has_more, false);
  assert.equal(last.total, 45);

  const page2 = assertSuccess(await h.call('list_issue_comments', { owner: 'o', repo: 'r', index: 4, page: 2, limit: 10 }));
  assert.deepEqual(page2.items.map((c) => c.id), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.equal(page2.total, 25);
  assert.equal(page2.has_more, true);
  const page3 = assertSuccess(await h.call('list_issue_comments', { owner: 'o', repo: 'r', index: 4, page: 3, limit: 10 }));
  assert.equal(page3.items.length, 5);
  assert.equal(page3.has_more, false);
});

test('issue lists are trimmed to useful fields', async () => {
  const h = createHarness({ respond: () => json([rawIssue(1), rawIssue(2, { pull_request: { merged: false } })]) });
  const data = assertSuccess(await h.call('list_issues', { owner: 'o', repo: 'r', state: 'all', labels: ['bug', 'ui'], assignee: 'bob' }));
  const q = urlOf(h.requests[0]).searchParams;
  assert.equal(q.get('labels'), 'bug,ui');
  assert.equal(q.get('assigned_by'), 'bob');
  assert.equal(q.get('state'), 'all');
  const [first, second] = data.items;
  assert.deepEqual(Object.keys(first).sort(), [
    'assignees', 'body_preview', 'comments', 'created_at', 'html_url', 'labels', 'milestone',
    'number', 'state', 'title', 'updated_at', 'user',
  ]);
  assert.deepEqual(first.labels, ['bug']);
  assert.deepEqual(first.assignees, ['bob']);
  assert.equal(first.user, 'alice');
  assert.ok(first.body_preview.length < 400);
  assert.equal(second.is_pull_request, true);
  const serialized = JSON.stringify(data);
  assert.doesNotMatch(serialized, /avatar_url|a@example\.test|"repository"/);
  assertFailure(await h.call('list_issues', { owner: 'o', repo: 'r', state: 'merged' }), 'INVALID_ARGS');
});

test('oversized results fail with OUTPUT_TOO_LARGE instead of flooding the agent', async () => {
  const big = createHarness({
    respond: () => json(Array.from({ length: 50 }, (_, i) => rawIssue(i + 1, { title: 'T'.repeat(1200) }))),
  });
  assert.match(assertFailure(await big.call('list_issues', { owner: 'o', repo: 'r', limit: 50 }), 'OUTPUT_TOO_LARGE'), /limit/);

  const cut = createHarness({ respond: () => ({ ok: true, status: 200, body: '[', headers: {}, truncated: true }) });
  assertFailure(await cut.call('list_branches', { owner: 'o', repo: 'r' }), 'OUTPUT_TOO_LARGE');

  const hugeFile = createHarness({
    respond: () => json({ type: 'file', path: 'big.bin', size: 2 * 1024 * 1024, encoding: 'base64', content: 'AAAA', html_url: 'https://x.test/big' }),
  });
  assertFailure(await hugeFile.call('get_file', { owner: 'o', repo: 'r', path: 'big.bin' }), 'OUTPUT_TOO_LARGE');
});

test('get_file decodes base64 UTF-8 within a text window and refuses binary content', async () => {
  const body = 'olá ✓\nsecond line';
  const responses = {
    'README.md': { type: 'file', name: 'README.md', path: 'README.md', size: Buffer.byteLength(body), encoding: 'base64', content: Buffer.from(body).toString('base64').replace(/(.{8})/g, '$1\n'), sha: 'abc' },
    'logo.png': { type: 'file', name: 'logo.png', path: 'logo.png', size: 4, encoding: 'base64', content: Buffer.from([0x89, 0x50, 0x00, 0x01]).toString('base64') },
  };
  const h = createHarness({
    respond: (req) => {
      const p = urlOf(req).pathname;
      if (p.endsWith('/contents')) return json([{ name: 'src', path: 'src', type: 'dir', size: 0, sha: 's', _links: {} }]);
      return json(responses[decodeURIComponent(p.split('/').pop())]);
    },
  });
  const full = assertSuccess(await h.call('get_file', { owner: 'o', repo: 'r', path: 'README.md' }));
  assert.equal(full.content, body);
  assert.equal(full.truncated, false);
  const part = assertSuccess(await h.call('get_file', { owner: 'o', repo: 'r', path: 'README.md', max_chars: 3 }));
  assert.equal(part.content, 'olá');
  assert.equal(part.truncated, true);
  assert.equal(part.next_offset, 3);
  const bin = assertSuccess(await h.call('get_file', { owner: 'o', repo: 'r', path: 'logo.png' }));
  assert.equal(bin.binary, true);
  assert.equal('content' in bin, false);
  const dir = assertSuccess(await h.call('get_file', { owner: 'o', repo: 'r', path: '' }));
  assert.equal(dir.type, 'dir');
  assert.deepEqual(dir.entries, [{ name: 'src', path: 'src', type: 'dir', size: 0 }]);
  assert.equal(urlOf(h.requests[3]).pathname, '/api/v1/repos/o/r/contents');
});

test('diffs and job logs are capped text; logs return the tail by default', async () => {
  const log = 'a'.repeat(50000) + 'ERROR at end';
  const h = createHarness({
    respond: (req) => (req.url.includes('/logs') ? text(log) : text('diff --git a/x b/x\n+line\n')),
  });
  const diff = assertSuccess(await h.call('get_pull_request_diff', { owner: 'o', repo: 'r', index: 5 }));
  assert.equal(urlOf(h.requests[0]).pathname, '/api/v1/repos/o/r/pulls/5.diff');
  assert.equal(h.requests[0].headers.Accept, 'text/plain');
  assert.match(diff.content, /^diff --git/);

  const tail = assertSuccess(await h.call('get_job_log', { owner: 'o', repo: 'r', job_id: 77 }));
  assert.equal(urlOf(h.requests[1]).pathname, '/api/v1/repos/o/r/actions/jobs/77/logs');
  assert.equal(tail.content.length, 20000);
  assert.ok(tail.content.endsWith('ERROR at end'));
  assert.equal(tail.truncated, true);
  const capped = assertSuccess(await h.call('get_job_log', { owner: 'o', repo: 'r', job_id: 77, max_chars: 999999 }));
  assert.equal(capped.content.length, 40000);
  const head = assertSuccess(await h.call('get_job_log', { owner: 'o', repo: 'r', job_id: 77, offset: 0, max_chars: 10 }));
  assert.equal(head.content, 'a'.repeat(10));
  assert.equal(head.offset, 0);
  assert.equal(head.next_offset, 10);
  assertFailure(await h.call('get_job_log', { owner: 'o', repo: 'r', job_id: 77, offset: -5 }), 'INVALID_ARGS');
  assertFailure(await h.call('get_job_log', { owner: 'o', repo: 'r', job_id: '7/../../admin' }), 'INVALID_ARGS');
});

test('Actions runs and jobs use total_count for has_more', async () => {
  const h = createHarness({
    respond: (req) => (req.url.includes('/jobs')
      ? json({ total_count: 1, jobs: [{ id: 3, run_id: 2, name: 'build', status: 'completed', conclusion: 'failure', steps: [{ number: 1, name: 'checkout', status: 'completed', conclusion: 'success' }] }] })
      : json({ total_count: 30, workflow_runs: [{ id: 2, run_number: 9, status: 'completed', conclusion: 'failure', actor: { login: 'alice', avatar_url: 'x' }, repository: { big: true } }] })),
  });
  const runs = assertSuccess(await h.call('list_workflow_runs', { owner: 'o', repo: 'r', status: 'failure', limit: 10 }));
  assert.equal(runs.total, 30);
  assert.equal(runs.has_more, true);
  assert.equal(runs.items[0].actor, 'alice');
  assert.equal('repository' in runs.items[0], false);
  assert.equal(urlOf(h.requests[0]).searchParams.get('status'), 'failure');
  const jobs = assertSuccess(await h.call('list_run_jobs', { owner: 'o', repo: 'r', run_id: 2 }));
  assert.equal(urlOf(h.requests[1]).pathname, '/api/v1/repos/o/r/actions/runs/2/jobs');
  assert.equal(jobs.items[0].steps[0].name, 'checkout');
  assert.equal(jobs.has_more, false);
});

/* ── path injection ────────────────────────────────────────────────── */

test('owner, repo and numeric ids are validated before any request', async () => {
  const h = createHarness({ respond: () => json({}) });
  const bad = [
    { owner: '..', repo: 'r' },
    { owner: '../admin', repo: 'r' },
    { owner: 'o', repo: '.' },
    { owner: 'o', repo: 'r?x=1' },
    { owner: 'o', repo: 'r#frag' },
    { owner: 'a/b', repo: 'r' },
    { owner: 'o', repo: 'r/../../admin' },
    { owner: 'o%2F..', repo: 'r' },
    { repo: 'o/r/x' },
  ];
  for (const args of bad) assertFailure(await h.call('get_repo', args), 'INVALID_ARGS');
  for (const index of ['1/../../admin', '1?x', -1, 0, 1.5, '01']) {
    assertFailure(await h.call('get_issue', { owner: 'o', repo: 'r', index }), 'INVALID_ARGS');
  }
  assert.equal(h.requests.length, 0);
  assertSuccess(await h.call('get_repo', { repo: 'o/r' }));
  assert.equal(urlOf(h.requests[0]).pathname, '/api/v1/repos/o/r');
});

test('file paths and refs are encoded and cannot leave the contents endpoint', async () => {
  const h = createHarness({ respond: () => json([]) });
  for (const p of ['../../admin/users', 'docs/../../../user', 'a/./b', 'a//b', 'a/%2e%2e/b', 'a\\..\\b', 'a/\u0000/b']) {
    assertFailure(await h.call('get_file', { owner: 'o', repo: 'r', path: p }), 'INVALID_ARGS');
  }
  assert.equal(h.requests.length, 0);

  assertSuccess(await h.call('get_file', { owner: 'o', repo: 'r', path: '/docs/a?b#c.md', ref: 'feature/x?y#z&path=evil' }));
  const url = urlOf(h.requests[0]);
  assert.equal(url.host, HOST);
  assert.equal(url.pathname, '/api/v1/repos/o/r/contents/docs/a%3Fb%23c.md');
  assert.equal(url.hash, '');
  assert.deepEqual([...url.searchParams.keys()], ['ref']);
  assert.equal(url.searchParams.get('ref'), 'feature/x?y#z&path=evil');

  assertSuccess(await h.call('list_commits', { owner: 'o', repo: 'r', sha: 'main&path=x', path: 'src/a b.js' }));
  const commits = urlOf(h.requests[1]);
  assert.equal(commits.pathname, '/api/v1/repos/o/r/commits');
  assert.equal(commits.searchParams.get('sha'), 'main&path=x');
  assert.equal(commits.searchParams.get('path'), 'src/a b.js');
  assert.equal(commits.searchParams.getAll('path').length, 1);
});

/* ── writes: confirmation, single attempt, outcome reporting ───────── */

test('a declined confirmation sends nothing', async () => {
  const h = createHarness({ confirmAnswer: { ok: true, confirmed: false } });
  const message = assertFailure(await h.call('create_issue', { owner: 'o', repo: 'r', title: 'Bug' }), 'CONFIRM_DECLINED');
  assert.match(message, /Not executed/);
  assert.equal(h.confirms.length, 1);
  assert.equal(h.requests.length, 0);
});

test('an unavailable, busy or failing confirmation sends nothing', async () => {
  const noApi = createHarness({ confirm: false });
  assertFailure(await noApi.call('merge_pull_request', { owner: 'o', repo: 'r', index: 1, style: 'merge' }), 'CONFIRM_UNAVAILABLE');
  assert.equal(noApi.requests.length, 0);

  const busy = createHarness({ confirmAnswer: { ok: false, message: 'BUSY' } });
  assertFailure(await busy.call('comment_issue', { owner: 'o', repo: 'r', index: 1, body: 'hi' }), 'CONFIRM_UNAVAILABLE');
  assert.equal(busy.requests.length, 0);

  const throws = createHarness({ confirmAnswer: () => { throw new Error('no window'); } });
  assertFailure(await throws.call('create_release', { owner: 'o', repo: 'r', tag_name: 'v1' }), 'CONFIRM_UNAVAILABLE');
  assert.equal(throws.requests.length, 0);
});

test('invalid write arguments fail before the confirmation dialog', async () => {
  const h = createHarness();
  assertFailure(await h.call('create_issue', { owner: 'o', repo: 'r' }), 'INVALID_ARGS');
  assertFailure(await h.call('merge_pull_request', { owner: 'o', repo: 'r', index: 1 }), 'INVALID_ARGS');
  assertFailure(await h.call('merge_pull_request', { owner: 'o', repo: 'r', index: 1, style: 'yolo' }), 'INVALID_ARGS');
  assertFailure(await h.call('set_issue_state', { owner: 'o', repo: 'r', index: 1, state: 'merged' }), 'INVALID_ARGS');
  assertFailure(await h.call('edit_issue_labels', { owner: 'o', repo: 'r', index: 1, action: 'add', labels: [] }), 'INVALID_ARGS');
  assertFailure(await h.call('comment_issue', { owner: '..', repo: 'r', index: 1, body: 'x' }), 'INVALID_ARGS');
  assert.equal(h.confirms.length, 0);
  assert.equal(h.requests.length, 0);
});

test('a confirmed write sends exactly one request with a bounded confirmation', async () => {
  const h = createHarness({ respond: () => json(rawIssue(12, { title: 'Bug' }), 201) });
  const longTitle = 'B'.repeat(250);
  const data = assertSuccess(await h.call(
    'create_issue',
    { owner: 'o', repo: 'r', title: longTitle, body: 'Details', labels: [1, '2'] },
    { mobilePageId: '0f0e0d0c-0b0a-4908-8706-050403020100' },
  ));
  assert.equal(data.created, true);
  assert.equal(data.issue.number, 12);
  assert.equal(h.requests.length, 1);
  const req = h.requests[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.url, `https://${HOST}/api/v1/repos/o/r/issues`);
  assert.equal(req.callId, 'call-1');
  assert.deepEqual(JSON.parse(req.body), { title: longTitle, body: 'Details', labels: [1, 2] });
  const spec = h.confirms[0];
  assert.ok(spec.body.length <= 300, `confirm body ${spec.body.length}`);
  assert.match(spec.body, /o\/r/);
  assert.match(spec.body, /git\.example\.test/);
  assert.equal(spec.confirmText, 'Create');
  assert.ok(spec.confirmText.length <= 12 && spec.cancelText.length <= 12);
  assert.equal(spec.danger, false);
  assert.equal(spec.mobilePageId, '0f0e0d0c-0b0a-4908-8706-050403020100');
});

test('merge requires an explicit style, is marked dangerous and maps fields to Gitea names', async () => {
  const h = createHarness({ respond: () => ({ ok: true, status: 200, body: '', headers: {} }) });
  const head = 'a'.repeat(40);
  const data = assertSuccess(await h.call('merge_pull_request', {
    owner: 'o', repo: 'r', index: 9, style: 'squash', title: 'T', message: 'M', delete_branch_after_merge: true, head_commit_id: head,
  }));
  assert.deepEqual(data, { merged: true, index: 9, style: 'squash' });
  assert.equal(h.confirms[0].danger, true);
  assert.match(h.confirms[0].body, /squash/);
  const req = h.requests[0];
  assert.equal(urlOf(req).pathname, '/api/v1/repos/o/r/pulls/9/merge');
  assert.deepEqual(JSON.parse(req.body), {
    Do: 'squash', MergeTitleField: 'T', MergeMessageField: 'M', delete_branch_after_merge: true, head_commit_id: head,
  });
});

test('issue state and label writes use the documented methods and paths', async () => {
  const h = createHarness({ respond: (req) => (req.method === 'PATCH' ? json(rawIssue(3, { state: 'closed' }), 201) : json([{ id: 1, name: 'bug' }])) });
  const closed = assertSuccess(await h.call('set_issue_state', { owner: 'o', repo: 'r', index: 3, state: 'closed' }));
  assert.equal(closed.issue.state, 'closed');
  assert.equal(h.requests[0].method, 'PATCH');
  assert.deepEqual(JSON.parse(h.requests[0].body), { state: 'closed' });
  assert.match(h.confirms[0].body, /^Close #3/);

  assertSuccess(await h.call('edit_issue_labels', { owner: 'o', repo: 'r', index: 3, action: 'replace', labels: ['bug', 4] }));
  assert.equal(h.requests[1].method, 'PUT');
  assert.equal(urlOf(h.requests[1]).pathname, '/api/v1/repos/o/r/issues/3/labels');
  assert.deepEqual(JSON.parse(h.requests[1].body), { labels: ['bug', 4] });

  assertSuccess(await h.call('edit_issue_labels', { owner: 'o', repo: 'r', index: 3, action: 'remove', label_id: 7 }));
  assert.equal(h.requests[2].method, 'DELETE');
  assert.equal(urlOf(h.requests[2]).pathname, '/api/v1/repos/o/r/issues/3/labels/7');
  assert.equal(h.requests[2].body, undefined);
});

test('writes are never retried: 5xx, timeouts and thrown errors report an unknown outcome', async () => {
  const scenarios = [
    ['HTTP 500', () => ({ ok: true, status: 500, body: '{"message":"internal"}', headers: {} })],
    ['HTTP 502', () => ({ ok: true, status: 502, body: '', headers: {} })],
    ['timeout', () => ({ ok: false, message: 'request timed out' })],
    ['thrown', () => { throw new Error('connection reset'); }],
  ];
  for (const [label, respond] of scenarios) {
    const h = createHarness({ respond });
    const message = assertFailure(await h.call('create_release', { owner: 'o', repo: 'r', tag_name: 'v1.0.0' }), 'OUTCOME_UNKNOWN');
    assert.match(message, /may or may not/, label);
    assert.match(message, /Check the current state before retrying/, label);
    assert.equal(h.requests.length, 1, `${label}: exactly one attempt`);
  }
});

test('write rejections (4xx) say nothing was executed and pass Gitea\'s message', async () => {
  for (const [status, code] of [[401, 'AUTH_FAILED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [405, 'NOT_ALLOWED'], [409, 'CONFLICT'], [422, 'VALIDATION_FAILED'], [429, 'RATE_LIMITED']]) {
    const h = createHarness({ respond: () => ({ ok: true, status, body: JSON.stringify({ message: 'head branch does not exist' }), headers: {} }) });
    const message = assertFailure(await h.call('create_pull_request', { owner: 'o', repo: 'r', head: 'feat', base: 'main', title: 'T' }), code);
    assert.match(message, /^Not executed/);
    if (status === 403) assert.match(message, /"write:repository" scope/);
    if (status === 409 || status === 422 || status === 405) assert.match(message, /head branch does not exist/);
    assert.equal(h.requests.length, 1);
  }
});

/* ── settings connection test channel ──────────────────────────────── */

test('the settings connection test reports the login and caches it per connection', async () => {
  const h = createHarness({ respond: () => json({ login: 'alice', avatar_url: 'x' }) });
  h.channel.onmessage({ data: { type: 'test-connection', reqId: 'r1', connectionId: 'conn-1' } });
  h.channel.onmessage({ data: { type: 'test-connection', reqId: 'r1', connectionId: 'conn-1' } });
  await flush();
  assert.equal(h.requests.length, 1, 'repeated broadcasts of one reqId run once');
  assert.equal(h.requests[0].url, `https://${HOST}/api/v1/user`);
  assert.deepEqual(h.channel.posted, [{ type: 'test-connection-result', reqId: 'r1', ok: true, username: 'alice', host: HOST }]);
  assert.deepEqual(h.kvWrites.at(-1), { connectedUsers: { 'conn-1': 'alice' } });

  const failing = createHarness({ respond: () => ({ ok: true, status: 401, body: '', headers: {} }) });
  failing.channel.onmessage({ data: { type: 'test-connection', reqId: 'r2', connectionId: 'conn-1' } });
  await flush();
  assert.equal(failing.channel.posted[0].ok, false);
  assert.match(failing.channel.posted[0].message, /HTTP 401/);
});

/* ── settings page ─────────────────────────────────────────────────── */

// Fake clock for the settings page: timers only fire through advance().
function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const add = (fn, ms, every) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + Math.max(0, ms || 0), every: every ? Math.max(1, ms || 0) : 0 });
    return id;
  };
  return {
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => { timers.delete(id); },
    clearInterval: (id) => { timers.delete(id); },
    pending: () => [...timers.values()].map((x) => ({ in: x.at - now, every: x.every })),
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let dueId = null;
        for (const [id, x] of timers) if (x.at <= until && (dueId === null || x.at < timers.get(dueId).at)) dueId = id;
        if (dueId === null) break;
        const timer = timers.get(dueId);
        now = timer.at;
        if (timer.every) timer.at += timer.every; else timers.delete(dueId);
        timer.fn();
      }
      now = until;
    },
  };
}

function createSettingsHarness(locale = 'en', options = {}) {
  const elements = new Map();
  const fetchCalls = [];
  const created = [];
  const kvWrites = [];
  let channel = null;
  function control(attrs = {}) {
    const listeners = new Map();
    const attributes = new Map(Object.entries(attrs));
    let text = '';
    return {
      value: '', placeholder: '', disabled: false, type: 'password', className: '',
      children: [],
      // Like the DOM: assigning textContent replaces the children.
      get textContent() { return text; },
      set textContent(value) { text = value; this.children = []; },
      classList: { toggle() {}, remove() {} },
      appendChild(child) { this.children.push(child); },
      focus() {},
      getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
      setAttribute(name, value) { attributes.set(name, value); },
      hasAttribute(name) { return attributes.has(name); },
      addEventListener(type, fn) { listeners.set(type, fn); },
      emit(type, ev = {}) { return listeners.get(type)?.({ preventDefault() {}, ...ev }); },
    };
  }
  // Every element of settings.html that carries a data-i18n* attribute, with
  // its real attributes; elements with an id are shared with getElementById.
  const copyNodes = [];
  for (const [, attrText] of settingsHtml.slice(settingsHtml.indexOf('<body>')).matchAll(/<\w+([^>]*)>/g)) {
    const attrs = Object.fromEntries([...attrText.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    if (!Object.keys(attrs).some((name) => name.startsWith('data-i18n'))) continue;
    const node = control(attrs);
    if (attrs.id) elements.set(attrs.id, node);
    copyNodes.push(node);
  }
  const document = {
    documentElement: { lang: '' },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, control());
      return elements.get(id);
    },
    querySelectorAll(selector) {
      const match = /^\[(data-i18n(?:-title|-aria-label|-placeholder)?)\]$/.exec(selector);
      assert.ok(match, `unexpected selector ${selector}`);
      return copyNodes.filter((node) => node.hasAttribute(match[1]));
    },
    createElement: () => {
      const node = control();
      created.push(node);
      return node;
    },
  };
  const kv = options.kv ?? {};
  const fetch = async (url, init) => {
    fetchCalls.push({ url, method: init?.method ?? 'GET', body: init?.body, signal: init?.signal });
    if (url === '/app-context') {
      if (options.appContext) return options.appContext(init);
      return { ok: true, json: async () => ({ ok: true, context: { locale } }) };
    }
    const custom = options.respond?.(url, init);
    if (custom) return custom;
    if (url === '/connections') return { json: async () => [{ key: 'gitea_conn', connections: options.connections ?? [] }] };
    if (url === '/kv' && init?.method === 'PUT') {
      kvWrites.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (url === '/kv') return { json: async () => JSON.parse(JSON.stringify(kv)) };
    if (url === '/wake') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (url === '/connections/gitea_conn') return { status: 200, json: async () => ({ ok: false, error: 'CONFIRM_DENIED' }) };
    throw new Error(`unexpected settings fetch ${url}`);
  };
  class FakeBroadcastChannel {
    constructor() {
      channel = this;
      this.posted = [];
      this.listeners = new Set();
    }

    postMessage(message) { this.posted.push(plain(message)); }

    addEventListener(type, fn) { if (type === 'message') this.listeners.add(fn); }

    removeEventListener(type, fn) { if (type === 'message') this.listeners.delete(fn); }

    deliver(data) { for (const fn of [...this.listeners]) fn({ data }); }
  }
  const clock = options.clock;
  const context = {
    document,
    AbortController,
    fetch,
    BroadcastChannel: FakeBroadcastChannel,
    setTimeout: clock ? clock.setTimeout : () => 0,
    clearTimeout: clock ? clock.clearTimeout : () => {},
    setInterval: clock ? clock.setInterval : () => 0,
    clearInterval: clock ? clock.clearInterval : () => {},
    Date,
  };
  vm.runInNewContext(settingsSource, context);
  return {
    el: (id) => document.getElementById(id),
    document,
    fetchCalls,
    copyNodes,
    kvWrites,
    messages: context.MESSAGES,
    get channel() { return channel; },
    rows: () => document.getElementById('list').children.filter((n) => n.className === 'account'),
    button: (label) => created.filter((n) => n.className === 'mini' && n.textContent === label),
  };
}

test('settings read the locale only from /app-context and fall back to English', async () => {
  const s = createSettingsHarness('fr');
  await flush();
  assert.equal(s.fetchCalls[0].url, '/app-context');
  assert.equal(s.document.documentElement.lang, 'en');
  assert.equal(s.el('add').textContent, 'Add');
  assert.equal(s.el('list').textContent, '');
});

test('settings reject http, custom ports and sub-paths before contacting the host', async () => {
  const s = createSettingsHarness('en');
  await flush();
  for (const [host, pattern] of [
    ['http://git.example.test', /Only https/],
    ['git.example.test:3000', /port 443/],
    ['https://git.example.test/gitea', /sub-path/],
  ]) {
    s.el('host').value = host;
    s.el('token').value = 'placeholder-token';
    s.el('add').emit('click');
    await flush();
    assert.match(s.el('status').textContent, pattern);
  }
  assert.equal(s.fetchCalls.some((c) => c.method === 'POST'), false);

  s.el('host').value = 'https://Git.Example.test:443/';
  s.el('add').emit('click');
  await flush();
  const post = s.fetchCalls.find((c) => c.method === 'POST');
  assert.equal(post.url, '/connections/gitea_conn');
  assert.deepEqual(JSON.parse(post.body), { host: 'git.example.test', token: 'placeholder-token' });
  assert.match(s.el('status').textContent, /Cancelled/);
});

/* ── runtime and settings localization ─────────────────────────────── */

const HOST_LOCALES = ['en', 'zh-CN', 'ja', 'ko'];
const placeholdersOf = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const hanRe = /[㐀-鿿]/;
const kanaRe = /[぀-ヿ]/;
const hangulRe = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const cjkRe = /[　-〿぀-ヿ㐀-鿿가-힯＀-￯]/;
// Half-width punctuation touching a Han or kana character, e.g. "实例:仓库" or "(はい)".
const halfWidthNextToCjk = /[぀-ヿ㐀-鿿][,;:()]|[,;:()][぀-ヿ㐀-鿿]/;
// The same word can be correct in Chinese and Japanese.
const sharedWithZh = new Set(['settings.js ja.add']);

function assertParity(messages, label) {
  assert.deepEqual(Object.keys(messages).sort(), [...HOST_LOCALES].sort(), `${label} locales`);
  const keys = Object.keys(messages.en).sort();
  for (const locale of HOST_LOCALES) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys, `${label} ${locale} keys`);
    for (const key of keys) {
      const value = messages[locale][key];
      const where = `${label} ${locale}.${key}`;
      assert.equal(typeof value, 'string', where);
      assert.ok(value.trim(), `${where} is empty`);
      assert.deepEqual(placeholdersOf(value), placeholdersOf(messages.en[key]), `${where} placeholders`);
      assert.doesNotMatch(value, /[\u2013\u2014]/, `${where} has an em or en dash`);
      if (locale === 'en') assert.doesNotMatch(value, cjkRe, where);
      if (locale === 'ko') assert.doesNotMatch(value, /[぀-ヿ㐀-鿿]/, where);
      if (locale === 'zh-CN') {
        assert.doesNotMatch(value, kanaRe, where);
        assert.doesNotMatch(value, hangulRe, where);
      }
      if (locale === 'ja') assert.doesNotMatch(value, hangulRe, where);
      if (locale === 'zh-CN' || locale === 'ja') {
        assert.doesNotMatch(value, halfWidthNextToCjk, `${where} uses half-width punctuation in CJK text`);
      }
      if (locale !== 'en') assert.notEqual(value, messages.en[key], `${where} is untranslated`);
      if (locale !== 'zh-CN' && locale !== 'en' && !sharedWithZh.has(where)) {
        assert.notEqual(value, messages['zh-CN'][key], `${where} copied from zh-CN`);
      }
    }
  }
}

test('runtime and settings message tables have identical keys and placeholders in all four locales', () => {
  assertParity(createHarness().messages, 'main.js');
  assertParity(createSettingsHarness().messages, 'settings.js');
});

test('every message key used by code or settings.html exists, and no settings key is unused', () => {
  const main = createHarness().messages.en;
  const mainKeys = [...source.matchAll(/\bt\('(\w+)'[,)]/g)].map((m) => m[1]);
  assert.ok(mainKeys.length >= 60, `found ${mainKeys.length} runtime keys`);
  for (const key of mainKeys) assert.ok(Object.hasOwn(main, key), `main.js ${key}`);
  // Keys picked by a ternary inside t(...) calls.
  for (const key of ['confirmClose', 'confirmReopen', 'buttonClose', 'buttonReopen', 'confirmAddLabels',
    'confirmReplaceLabels', 'buttonAdd', 'buttonReplace', 'confirmMerge', 'confirmMergeDelete',
    'confirmRelease', 'confirmReleaseAt', 'kindRelease', 'kindDraftRelease', 'kindPreRelease',
    'rateLimited', 'rateLimitedWait', 'confirmUnavailable', 'confirmUnavailableReason']) {
    assert.ok(Object.hasOwn(main, key), key);
    assert.match(source, new RegExp(`'${key}'`), `${key} is referenced`);
  }

  const settings = createSettingsHarness().messages.en;
  const htmlKeys = [...settingsHtml.matchAll(/data-i18n(?:-title|-aria-label|-placeholder)?="(\w+)"/g)].map((m) => m[1]);
  const codeKeys = [...settingsSource.matchAll(/\bt\('(\w+)'[,)]/g), ...settingsSource.matchAll(/t\(\w+ \? '(\w+)' : '(\w+)'[,)]/g),
    ...settingsSource.matchAll(/failureText\(\w+, '(\w+)', '(\w+)'\)/g)]
    .flatMap((m) => m.slice(1));
  for (const key of [...htmlKeys, ...codeKeys]) assert.ok(Object.hasOwn(settings, key), `settings ${key}`);
  // Host error codes are looked up as error_<CODE>.
  const used = new Set([...htmlKeys, ...codeKeys]);
  for (const key of Object.keys(settings)) {
    assert.ok(used.has(key) || key.startsWith('error_'), `unused settings key ${key}`);
  }
  assert.deepEqual(Object.keys(settings).filter((k) => k.startsWith('error_')).sort(), [
    'error_CONFIRM_DENIED', 'error_INVALID_HOST', 'error_INVALID_LABEL', 'error_INVALID_TOKEN',
    'error_LIMIT', 'error_TOKEN_TOO_LONG', 'error_VAULT_WRITE_FAILED',
  ]);
});

test('no CJK text outside the zh-CN, ja and ko tables, and settings.html ships no visible copy', () => {
  const stripComments = (value) => value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const cjkTables = /\n {2}(?:'zh-CN'|ja|ko): \{[\s\S]*?\n {2}\},(?=\n)/g;
  for (const [label, value] of [['main.js', source], ['settings.js', settingsSource], ['settings.html', settingsHtml]]) {
    const tables = value.match(cjkTables) ?? [];
    if (label !== 'settings.html') assert.equal(tables.length, 3, `${label} has three CJK tables`);
    const outside = stripComments(value).replace(cjkTables, '');
    assert.deepEqual(outside.split('\n').filter((line) => cjkRe.test(line)), [], label);
  }
  const body = settingsHtml.slice(settingsHtml.indexOf('<body>')).replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
  const visible = body.replace(/<[^>]*>/g, '').trim();
  assert.equal(visible, '', 'settings.html text comes from the tables');
  assert.doesNotMatch(body, /\s(?:title|aria-label|placeholder)="/, 'attributes come from the tables');
});

test('locale resources keep CJK punctuation full-width', () => {
  for (const locale of ['zh-CN', 'ja']) {
    const raw = fs.readFileSync(path.join(pluginDir, manifest.locales[locale]), 'utf8');
    const strings = [];
    (function walk(value) {
      if (typeof value === 'string') strings.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    })(JSON.parse(raw));
    for (const value of strings) assert.doesNotMatch(value, halfWidthNextToCjk, `${locale}: ${value.slice(0, 60)}`);
  }
});

test('manifest version is bumped for the localized runtime', () => {
  assert.equal(manifest.version, '1.1.0');
});

test('runtime copy falls back to English for unsupported or unavailable host locales', async () => {
  const variants = {
    unsupported: { locale: 'fr' },
    legacyTag: { locale: 'zh-TW' },
    notOk: { appContext: () => ({ ok: false }) },
    missingLocale: { appContext: () => ({ ok: true, context: {} }) },
    nonStringLocale: { appContext: () => ({ ok: true, context: { locale: 7 } }) },
    throws: { appContext: () => { throw new Error('host unavailable'); } },
    rejects: { appContext: () => Promise.reject(new Error('host unavailable')) },
    noRequestApi: { withoutRequest: true },
    hangs: {
      appContext: () => new Promise(() => {}),
      setTimeout: (fn) => { setImmediate(fn); return 1; },
    },
  };
  for (const [label, options] of Object.entries(variants)) {
    const h = createHarness({ ...options, connections: [] });
    const message = assertFailure(await h.call('get_current_user'), 'NO_INSTANCE');
    assert.equal(message, h.messages.en.noInstance, label);
    assert.doesNotMatch(message, cjkRe, label);
  }
});

for (const locale of ['ja', 'ko', 'zh-CN']) {
  test(`${locale} runtime copy is used for results, errors and confirmations with protocol values intact`, async () => {
    const m = createHarness().messages[locale];

    const none = createHarness({ locale, connections: [] });
    assert.equal(assertFailure(await none.call('get_current_user'), 'NO_INSTANCE'), m.noInstance);

    const forbidden = createHarness({ locale, respond: () => ({ ok: true, status: 403, body: '{"message":"nope"}', headers: {} }) });
    const forbiddenMsg = assertFailure(await forbidden.call('list_issues', { owner: 'o', repo: 'r' }), 'FORBIDDEN');
    assert.ok(forbiddenMsg.includes('"read:issue"') && forbiddenMsg.includes(HOST) && forbiddenMsg.includes('HTTP 403'), forbiddenMsg);
    assert.ok(forbiddenMsg.endsWith('nope'), forbiddenMsg);
    assert.match(forbiddenMsg, locale === 'zh-CN' ? hanRe : locale === 'ja' ? kanaRe : hangulRe);

    const rejected = createHarness({ locale, respond: () => ({ ok: true, status: 409, body: '{"message":"exists"}', headers: {} }) });
    const rejectedMsg = assertFailure(await rejected.call('create_pull_request', { owner: 'o', repo: 'r', head: 'feat', base: 'main', title: 'T' }), 'CONFLICT');
    assert.ok(rejectedMsg.startsWith(m.notExecutedPrefix), rejectedMsg);
    assert.equal(rejected.confirms[0].confirmText, m.buttonOpenPr);
    assert.equal(rejected.confirms[0].cancelText, m.buttonCancel);
    assert.ok(rejected.confirms[0].confirmText.length <= 12 && rejected.confirms[0].cancelText.length <= 12);
    assert.ok(rejected.confirms[0].body.includes('feat') && rejected.confirms[0].body.includes('main') && rejected.confirms[0].body.includes('o/r'));

    const unknown = createHarness({ locale, respond: () => ({ ok: false, message: 'request timed out' }) });
    const unknownMsg = assertFailure(await unknown.call('create_release', { owner: 'o', repo: 'r', tag_name: 'v1.0.0' }), 'OUTCOME_UNKNOWN');
    assert.equal(unknownMsg, m.writeIncomplete.replace('{host}', HOST).replace('{reason}', 'request timed out'));
    assert.equal(unknown.requests.length, 1);

    const declined = createHarness({ locale, confirmAnswer: { ok: true, confirmed: false } });
    assert.equal(assertFailure(await declined.call('create_issue', { owner: 'o', repo: 'r', title: 'Bug' }), 'CONFIRM_DECLINED'), m.confirmDeclined);
    assert.equal(declined.requests.length, 0);

    const invalid = createHarness({ locale });
    const invalidMsg = assertFailure(await invalid.call('merge_pull_request', { owner: 'o', repo: 'r', index: 1 }), 'INVALID_ARGS');
    assert.ok(invalidMsg.startsWith(m.styleRequired.replace('{styles}', 'merge, rebase, rebase-merge, squash, fast-forward-only')), invalidMsg);
    assert.ok(invalidMsg.includes('style*:merge|rebase'), 'parameter notation stays untranslated');

    const overview = createHarness({ locale });
    const list = (await overview.listTools()).result;
    assert.equal(list.hint, m.overviewHint);
    assert.equal(list.categories.pulls.writes, 2);
    assert.equal(assertFailure(await overview.listTools('admin'), 'UNKNOWN_CATEGORY'),
      m.unknownCategory.replace('{category}', 'admin').replace('{categories}', Object.keys(list.categories).join(', ')));
    await overview.hostMessage({ type: 'tool-call', tool: 'nope', callId: 'call-9', args: {} });
    assert.equal(overview.results.at(-1).errorCode, 'UNKNOWN_TOOL');
    assert.equal(overview.results.at(-1).message, m.unknownTool.replace('{tool}', 'nope'));
  });
}

test('English runtime output is unchanged for representative results and confirmations', async () => {
  const h = createHarness({ respond: () => json(rawIssue(12, { title: 'Bug' }), 201) });
  assertSuccess(await h.call('create_issue', { owner: 'o', repo: 'r', title: 'Bug' }));
  assert.equal(h.confirms[0].body, `Create an issue in o/r on ${HOST}?\nTitle: Bug`);
  assert.equal(h.confirms[0].cancelText, 'Cancel');

  const rel = createHarness({ respond: () => json({ id: 1, tag_name: 'v1' }, 201) });
  assertSuccess(await rel.call('create_release', { owner: 'o', repo: 'r', tag_name: 'v1', target_commitish: 'main', name: 'One', draft: true }));
  assert.equal(rel.confirms[0].body, `Create draft release v1 in o/r (${HOST}) at main?\nName: One`);
  assertSuccess(await rel.call('create_release', { owner: 'o', repo: 'r', tag_name: 'v2', prerelease: true }));
  assert.equal(rel.confirms[1].body, `Create pre-release v2 in o/r (${HOST})?`);

  const labels = createHarness({ respond: () => json([]) });
  assertSuccess(await labels.call('edit_issue_labels', { owner: 'o', repo: 'r', index: 3, action: 'replace', labels: [] }));
  assert.equal(labels.confirms[0].body, `Replace all labels with (none) on #3 in o/r (${HOST})?`);
  assertSuccess(await labels.call('edit_issue_labels', { owner: 'o', repo: 'r', index: 3, action: 'remove', label_id: 7 }));
  assert.equal(labels.confirms[1].body, `Remove label id 7 on #3 in o/r (${HOST})?`);

  const merge = createHarness({ respond: () => ({ ok: true, status: 200, body: '', headers: {} }) });
  assertSuccess(await merge.call('merge_pull_request', { owner: 'o', repo: 'r', index: 9, style: 'merge', delete_branch_after_merge: true }));
  assert.equal(merge.confirms[0].body, `Merge pull request #9 in o/r (${HOST}) using "merge" and delete the head branch? This cannot be undone.`);

  const limited = createHarness({ respond: () => ({ ok: true, status: 429, body: '', headers: {} }) });
  assert.equal(assertFailure(await limited.call('list_issues', { owner: 'o', repo: 'r' }), 'RATE_LIMITED'),
    `Gitea at ${HOST} is rate limiting requests (HTTP 429). Wait before retrying.`);

  const bad = createHarness();
  assert.equal(assertFailure(await bad.call('get_issue', { owner: 'o', repo: 'r' }), 'INVALID_ARGS'),
    'index is required and must be a positive integer. Parameters: owner*:string, repo*:string (or repo:"owner/name"), index*:int, instance?:connection id or host');
  const busy = createHarness({ confirmAnswer: { ok: false, message: 'BUSY' } });
  assert.equal(assertFailure(await busy.call('comment_issue', { owner: 'o', repo: 'r', index: 1, body: 'hi' }), 'CONFIRM_UNAVAILABLE'),
    'Not executed: the confirmation dialog could not be shown (BUSY). Try again in a few seconds.');
});

test('host-context-changed switches runtime copy without another app-context request', async () => {
  const h = createHarness({ locale: 'zh-CN', connections: [] });
  const zh = h.messages['zh-CN'];
  assert.equal((await h.call('get_current_user')).message, zh.noInstance);
  assert.equal(h.appContextRequests.length, 1);
  await h.hostMessage({ type: 'host-context-changed', context: { region: 'global', locale: 'ko' } });
  assert.equal((await h.call('get_current_user')).message, h.messages.ko.noInstance);
  await h.hostMessage({ type: 'host-context-changed', context: { locale: 'ja' } });
  assert.equal((await h.call('get_current_user')).message, h.messages.ja.noInstance);
  await h.hostMessage({ type: 'host-context-changed', context: { locale: 'xx' } });
  assert.equal((await h.call('get_current_user')).message, h.messages.en.noInstance);
  await h.hostMessage({ type: 'host-context-changed' });
  assert.equal((await h.call('get_current_user')).message, h.messages.en.noInstance);
  assert.equal(h.appContextRequests.length, 1);
  assert.equal(h.results.length, 5);
});

test('a locale change that arrives during the app-context request wins over the stale reply', async () => {
  let resolve;
  const h = createHarness({ connections: [], appContext: () => new Promise((r) => { resolve = r; }) });
  const pending = h.call('get_current_user');
  await flush();
  await h.hostMessage({ type: 'host-context-changed', context: { locale: 'ja' } });
  resolve({ ok: true, context: { locale: 'zh-CN' } });
  assert.equal((await pending).message, h.messages.ja.noInstance);
  assert.equal((await h.call('get_current_user')).message, h.messages.ja.noInstance);
  assert.equal(h.appContextRequests.length, 1);
});

test('concurrent tool calls share one app-context request and none runs before the locale is known', async () => {
  let resolve;
  const h = createHarness({ respond: () => ({ ok: true, status: 401, body: '', headers: {} }), appContext: () => new Promise((r) => { resolve = r; }) });
  const calls = [1, 2, 3].map(() => h.call('get_current_user'));
  await flush();
  assert.equal(h.appContextRequests.length, 1);
  assert.equal(h.requests.length, 0, 'no Gitea request before the locale is known');
  resolve({ ok: true, context: { locale: 'ko' } });
  await Promise.all(calls);
  assert.equal(h.results.length, 3);
  for (const result of h.results) {
    assert.equal(result.errorCode, 'AUTH_FAILED');
    assert.equal(result.message, h.messages.ko.authFailed.replace('{host}', HOST));
  }
});

test('a failed app-context lookup is retried on the next call instead of pinning English', async () => {
  let attempts = 0;
  const h = createHarness({
    connections: [],
    appContext: () => {
      attempts += 1;
      if (attempts === 1) throw new Error('host busy');
      return { ok: true, context: { locale: 'ja' } };
    },
  });
  assert.equal((await h.call('get_current_user')).message, h.messages.en.noInstance);
  assert.equal((await h.call('get_current_user')).message, h.messages.ja.noInstance);
  assert.equal((await h.call('get_current_user')).message, h.messages.ja.noInstance);
  assert.equal(attempts, 2);
});

test('the settings connection test reports failures in the host locale', async () => {
  const h = createHarness({ locale: 'ko', respond: () => ({ ok: true, status: 401, body: '', headers: {} }) });
  h.channel.onmessage({ data: { type: 'test-connection', reqId: 'r3', connectionId: 'conn-1' } });
  await flush();
  assert.equal(h.channel.posted[0].ok, false);
  assert.equal(h.channel.posted[0].message, h.messages.ko.authFailed.replace('{host}', HOST));
});

for (const locale of HOST_LOCALES) {
  test(`settings page renders ${locale} copy from /app-context`, async () => {
    const s = createSettingsHarness(locale);
    await flush();
    const m = s.messages[locale];
    assert.equal(s.fetchCalls[0].url, '/app-context', 'locale is resolved before anything else is fetched');
    assert.ok(s.fetchCalls[0].signal, 'the app-context read can be aborted');
    assert.equal(s.document.documentElement.lang, locale);
    const byAttr = (name) => s.copyNodes.filter((n) => n.hasAttribute(name));
    assert.equal(byAttr('data-i18n').length, 4);
    for (const node of byAttr('data-i18n')) assert.equal(node.textContent, m[node.getAttribute('data-i18n')]);
    for (const node of byAttr('data-i18n-title')) assert.equal(node.getAttribute('title'), m[node.getAttribute('data-i18n-title')]);
    assert.equal(byAttr('data-i18n-aria-label').length, 3);
    for (const node of byAttr('data-i18n-aria-label')) assert.equal(node.getAttribute('aria-label'), m[node.getAttribute('data-i18n-aria-label')]);
    assert.equal(s.el('host').getAttribute('placeholder'), m.hostPlaceholder);
    assert.equal(s.el('token').getAttribute('placeholder'), m.tokenPlaceholder);
    assert.equal(s.el('add').textContent, m.add);
    assert.equal(s.el('eye').getAttribute('aria-label'), m.toggleAria);

    s.el('host').value = '';
    s.el('token').value = 'x';
    s.el('add').emit('click');
    await flush();
    assert.equal(s.el('status').textContent, m.needHost);
    s.el('host').value = 'git.example.test';
    s.el('add').emit('click');
    await flush();
    assert.equal(s.el('status').textContent, m.error_CONFIRM_DENIED);
  });
}

test('settings page falls back to English for unknown, failed or malformed app-context', async () => {
  const variants = [
    () => ({ ok: true, json: async () => ({ ok: true, context: { locale: 'de' } }) }),
    () => ({ ok: false, json: async () => ({ ok: true, context: { locale: 'ja' } }) }),
    () => { throw new Error('offline'); },
    () => ({ ok: true, json: async () => null }),
    () => ({ ok: true, json: async () => { throw new SyntaxError('not json'); } }),
  ];
  for (const appContext of variants) {
    const s = createSettingsHarness('en', { appContext });
    await flush();
    assert.equal(s.document.documentElement.lang, 'en');
    assert.equal(s.el('add').textContent, 'Add');
    assert.equal(s.el('host').getAttribute('placeholder'), 'Instance, e.g. git.example.com or https://git.example.com');
  }
});

/* ── maintainer review: confirmation fit, settings failures, test timeout ─ */

for (const locale of HOST_LOCALES) {
  test(`${locale} write confirmations keep number, repo and host visible within 300 characters`, async () => {
    const labels = Array.from({ length: 10 }, (_, i) => `label-${String(i).padStart(2, '0')}-${'x'.repeat(21)}`);
    assert.ok(labels.every((l) => l.length === 30));
    for (const action of ['add', 'replace']) {
      const h = createHarness({ locale, respond: () => json([]) });
      const m = h.messages[locale];
      assertSuccess(await h.call('edit_issue_labels', { owner: 'acme', repo: 'widgets', index: 4242, action, labels }));
      const body = h.confirms[0].body;
      assert.ok(body.length <= 300, `${action}: ${body.length} characters`);
      for (const part of ['#4242', 'acme/widgets', HOST]) assert.ok(body.includes(part), `${action} lost ${part}: ${body}`);
      const shown = labels.filter((l) => body.includes(l)).length;
      assert.ok(shown >= 1 && shown < labels.length, `${action}: ${shown} labels shown`);
      const more = m.moreItems.slice(m.moreItems.indexOf('{shown}') + '{shown}'.length).replace('{count}', String(labels.length - shown));
      assert.ok(body.includes(more), `${action}: missing "${more}" in ${body}`);
      assert.deepEqual(JSON.parse(h.requests[0].body), { labels }, 'the request still carries every label');
    }

    const owner = 'o'.repeat(60);
    const repo = 'r'.repeat(60);
    const long = 'T'.repeat(255);
    const cases = [
      ['create_issue', { owner, repo, title: long }],
      ['comment_issue', { owner, repo, index: 7, body: 'B'.repeat(2000) }],
      ['create_pull_request', { owner, repo, head: 'h'.repeat(250), base: 'b'.repeat(250), title: long }],
      ['create_release', { owner, repo, tag_name: 'v'.repeat(250), target_commitish: 'c'.repeat(250), name: long }],
    ];
    for (const [name, args] of cases) {
      const h = createHarness({ locale, respond: () => json({}, 201) });
      assertSuccess(await h.call(name, args));
      const body = h.confirms[0].body;
      assert.ok(body.length <= 300, `${name}: ${body.length} characters`);
      assert.ok(body.includes(`${owner}/${repo}`) && body.includes(HOST), `${name} lost the destination: ${body}`);
      if (args.index) assert.ok(body.includes(`#${args.index}`), name);
      assert.ok(body.includes('...'), `${name} marks the cut`);
    }
  });
}

test('settings remove and set-default report host failures and keep the row', async () => {
  const connections = [
    { id: 'conn-1', host: 'git.one.test', isDefault: true, tail: '1111' },
    { id: 'conn-2', host: 'git.two.test', isDefault: false, tail: '2222' },
  ];
  const failures = [
    [() => ({ ok: false, status: 500, json: async () => ({}) }), (m) => m.removeFailedCode.replace('{code}', '500'), (m) => m.defaultFailedCode.replace('{code}', '500')],
    [() => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'CONFIRM_DENIED' }) }), (m) => m.error_CONFIRM_DENIED, (m) => m.error_CONFIRM_DENIED],
    [() => ({ ok: true, status: 200, json: async () => ({ ok: false, errorCode: 'NOT_FOUND' }) }), (m) => m.removeFailedCode.replace('{code}', 'NOT_FOUND'), (m) => m.defaultFailedCode.replace('{code}', 'NOT_FOUND')],
    [() => { throw new Error('offline'); }, (m) => m.removeFailed, (m) => m.defaultFailed],
  ];
  for (const locale of ['en', 'ja']) {
    for (const [respond, removeText, defaultText] of failures) {
      const s = createSettingsHarness(locale, {
        connections,
        kv: { connectedUsers: { 'conn-1': 'alice', 'conn-2': 'bob' } },
        respond: (url, init) => (url.startsWith('/connections/gitea_conn/') && init?.method ? respond() : null),
      });
      await flush();
      const m = s.messages[locale];
      assert.equal(s.rows().length, 2);

      s.button(m.remove)[0].emit('click');
      await flush();
      assert.equal(s.el('status').textContent, removeText(m), locale);
      assert.notEqual(s.el('status').textContent, m.removed);
      assert.deepEqual(s.kvWrites, [], 'the cached login is kept');
      assert.deepEqual(s.rows().map((r) => r.children[0].textContent), ['git.one.test', 'git.two.test'], 'the row is still listed');

      s.button(m.makeDefault)[0].emit('click');
      await flush();
      assert.equal(s.el('status').textContent, defaultText(m), locale);
      assert.equal(s.rows().length, 2);
    }
  }

  const ok = createSettingsHarness('en', {
    connections,
    kv: { connectedUsers: { 'conn-1': 'alice', 'conn-2': 'bob' } },
    respond: (url, init) => (url.startsWith('/connections/gitea_conn/') && init?.method ? { ok: true, status: 204, json: async () => { throw new SyntaxError('empty'); } } : null),
  });
  await flush();
  ok.button('Remove')[1].emit('click');
  await flush();
  assert.equal(ok.el('status').textContent, 'Removed.');
  assert.deepEqual(ok.kvWrites, [{ connectedUsers: { 'conn-1': 'alice' } }]);
  ok.button('Make default')[0].emit('click');
  await flush();
  assert.equal(ok.el('status').textContent, 'Removed.', 'a successful default change adds no error');
  const posted = ok.fetchCalls.find((c) => c.url === '/connections/gitea_conn/default');
  assert.deepEqual(JSON.parse(posted.body), { connectionId: 'conn-2' });
});

test('settings connection test outlasts the 30 s request timeout and always detaches its listener', async () => {
  const connections = [{ id: 'conn-1', host: HOST, isDefault: true, tail: '4567' }];
  async function start() {
    const clock = createClock();
    const s = createSettingsHarness('en', { connections, clock });
    await flush();
    s.button('Test')[0].emit('click');
    await flush();
    assert.equal(s.channel.listeners.size, 1);
    assert.equal(s.el('status').textContent, 'Contacting Gitea...');
    return { s, clock };
  }

  // A reply after 20 s (past the old 15 s page limit, within the request's 30 s) is accepted.
  const late = await start();
  late.clock.advance(20000);
  assert.equal(late.s.el('status').textContent, 'Contacting Gitea...');
  const reqId = late.s.channel.posted[0].reqId;
  late.s.channel.deliver({ type: 'test-connection-result', reqId: 'other', ok: false, message: 'not mine' });
  assert.equal(late.s.channel.listeners.size, 1, 'replies for other tests are ignored');
  late.s.channel.deliver({ type: 'test-connection-result', reqId, ok: true, username: 'alice', host: HOST });
  assert.equal(late.s.el('status').textContent, `Connected as @alice (${HOST})`);
  assert.equal(late.s.channel.listeners.size, 0, 'listener removed on success');
  assert.deepEqual(late.clock.pending().filter((x) => x.every || x.in > 4000), [], 'deadline and resend timers cleared');
  const sent = late.s.channel.posted.length;
  late.clock.advance(60000);
  assert.equal(late.s.channel.posted.length, sent, 'no resends after the reply');
  assert.equal(late.s.el('status').textContent, '', 'only the status auto-clear ran');

  // No reply: still waiting just past the request timeout, gives up at the page limit.
  const silent = await start();
  silent.clock.advance(31000);
  assert.equal(silent.s.el('status').textContent, 'Contacting Gitea...');
  assert.equal(silent.s.channel.listeners.size, 1);
  silent.clock.advance(14000);
  assert.equal(silent.s.el('status').textContent, 'Test timed out: the plugin did not answer. Try again.');
  assert.equal(silent.s.channel.listeners.size, 0, 'listener removed on timeout');
  assert.deepEqual(silent.clock.pending(), [], 'no timers left after the timeout');
  const after = silent.s.channel.posted.length;
  silent.s.channel.deliver({ type: 'test-connection-result', reqId: silent.s.channel.posted[0].reqId, ok: true, username: 'alice', host: HOST });
  silent.clock.advance(5000);
  assert.equal(silent.s.channel.posted.length, after);
  assert.equal(silent.s.el('status').textContent, 'Test timed out: the plugin did not answer. Try again.');
});
