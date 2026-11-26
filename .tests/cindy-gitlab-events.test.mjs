// GitLab automation events: the plugin polls only what automations subscribed to
// (routine-request subscriptions), records a baseline first, then publishes changes.
// Runs the real main.js in a vm with a fake host; no network, placeholder hosts only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const pluginDir = path.join(root, 'cindy-gitlab');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'ghost.json'), 'utf8'));
const source = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');
const HOST = 'git.example.test';

const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const json = (data, status = 200) => ({ ok: true, status, body: JSON.stringify(data), headers: {} });

function mr(overrides = {}) {
  return {
    id: 501, iid: 7, project_id: 42, title: 'Add feature', description: 'desc', state: 'opened',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    sha: 'aaa', labels: [], draft: false, source_branch: 'feat', target_branch: 'main',
    author: { username: 'alice' }, references: { full: 'Group/App!7' },
    web_url: `https://${HOST}/group/app/-/merge_requests/7`,
    head_pipeline: { id: 9, status: 'running' }, user_notes_count: 0,
    ...overrides,
  };
}

function harness({ subscriptions = [], routes = {}, subscriptionsReply } = {}) {
  const sent = [];
  const requests = [];
  const state = { routes, handler: null };
  const cindy = {
    onHostMessage(fn) { state.handler = fn; },
    async fetch(req) {
      const url = String(req.url);
      requests.push(url);
      for (const [pattern, reply] of Object.entries(state.routes)) {
        if (url.includes(pattern)) return typeof reply === 'function' ? reply(url) : json(reply);
      }
      return json({ message: 'not found' }, 404);
    },
    async send(message) {
      const m = plain(message);
      sent.push(m);
      if (m.type === 'routine-request' && m.action === 'subscriptions') {
        return subscriptionsReply ?? { ok: true, subscriptions };
      }
      return { ok: true, accepted: 1, duplicate: false };
    },
  };
  const context = vm.createContext({
    cindy,
    console,
    URL,
    Date,
    setTimeout: () => 0,
    BroadcastChannel: class { postMessage() {} },
    fetch: async (url) => ({
      json: async () => (url === '/connections'
        ? [{ key: 'gitlab_conn', connections: [{ id: 'c1', host: HOST, isDefault: true }] }]
        : {}),
    }),
  });
  vm.runInContext(source, context, { filename: 'main.js' });
  return {
    state,
    requests,
    cycle: () => vm.runInContext('eventsCycle()', context),
    push: (subscriptions) => state.handler({ type: 'routine-subscriptions', subscriptions }),
    pulls: () => sent.filter((m) => m.action === 'subscriptions').length,
    published: () => sent.filter((m) => m.action === 'publish').map((m) => m.event),
    statuses: () => sent.filter((m) => m.action === 'status').map((m) => m.status),
  };
}

const watchMr = [{
  events: ['merge_request.merged', 'merge_request.comment', 'merge_request.pipeline'],
  filters: [
    { field: 'host', operator: 'equals', value: HOST },
    { field: 'project', operator: 'equals', value: 'group/app' },
    { field: 'iid', operator: 'equals', value: '7' },
  ],
}];

test('manifest declares glab-cli connection fallback and the published events with every field they carry', () => {
  assert.equal(manifest.network.connections[0].source, 'glab-cli');
  const types = manifest.routineEvents.events.map((event) => event.type);
  assert.ok(types.includes('merge_request.merged') && types.includes('issue.comment'));
  for (const event of manifest.routineEvents.events) {
    const prefix = event.type.split('.')[0];
    assert.ok(prefix === 'merge_request' || prefix === 'issue');
    for (const field of ['host', 'project', 'iid', 'kind', 'state', 'url']) assert.ok(event.fields.includes(field), `${event.type} ${field}`);
  }
});

test('does nothing without subscriptions and stops on hosts without the subscriptions operation', async () => {
  const idle = harness();
  assert.equal(await idle.cycle(), 'idle', 'no subscriptions: no timer, wait for the host to push');
  assert.deepEqual(idle.requests, []);
  const old = harness({ subscriptionsReply: { ok: false, message: 'Unknown routine operation' } });
  assert.equal(await old.cycle(), null);
});

test('a chosen MR: baseline first, then merged, new comments and pipeline changes', async () => {
  const h = harness({
    subscriptions: watchMr,
    routes: {
      '/api/v4/user': { id: 1, username: 'me' },
      '/merge_requests/7/notes': [],
      '/projects/group%2Fapp/merge_requests/7': mr({ head_pipeline: null }),
    },
  });
  await h.cycle();
  assert.deepEqual(h.published(), [], 'first look only records a baseline');
  assert.deepEqual(h.statuses(), ['listening']);

  h.state.routes['/merge_requests/7/notes'] = [
    { id: 90, body: 'LGTM', system: false, created_at: '2026-01-02T00:00:00Z', author: { username: 'me' } },
    { id: 89, body: 'approved this merge request', system: true, created_at: '2026-01-02T00:00:00Z', author: { username: 'bob' } },
    { id: 10, body: 'old', system: false, created_at: '2025-12-31T00:00:00Z', author: { username: 'bob' } },
  ];
  h.state.routes['/projects/group%2Fapp/merge_requests/7'] = mr({
    state: 'merged', merged_at: '2026-01-02T00:00:00Z', merged_by: { username: 'bob' },
    updated_at: '2026-01-02T00:00:01Z', head_pipeline: { id: 9, status: 'success' },
  });
  await h.cycle();
  const events = h.published();
  assert.deepEqual(events.map((e) => e.type).sort(), [
    'merge_request.approved', 'merge_request.comment', 'merge_request.merged', 'merge_request.pipeline',
  ]);
  const merged = events.find((e) => e.type === 'merge_request.merged');
  assert.equal(merged.id, `${HOST}/group/app!7:merged`);
  assert.deepEqual(
    { host: merged.data.host, project: merged.data.project, iid: merged.data.iid, kind: merged.data.kind, actor: merged.data.actor, fromSelf: merged.data.fromSelf },
    { host: HOST, project: 'group/app', iid: 7, kind: 'mr', actor: 'bob', fromSelf: false },
  );
  const comment = events.find((e) => e.type === 'merge_request.comment');
  assert.equal(comment.data.fromSelf, true, 'own comments are delivered and marked, not dropped');
  assert.equal(comment.data.body, 'LGTM');
  assert.equal(events.find((e) => e.type === 'merge_request.pipeline').data.pipelineStatus, 'success');

  await h.cycle();
  assert.equal(h.published().length, events.length, 'unchanged object publishes nothing');
});

test('a whole project: new MRs after the baseline become opened events', async () => {
  const h = harness({
    subscriptions: [{ events: ['merge_request.opened'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] }],
    routes: {
      '/api/v4/user': { id: 1, username: 'me' },
      '/projects/group%2Fapp/events': [{ id: 1 }],
      '/projects/group%2Fapp/merge_requests?': [mr()],
    },
  });
  await h.cycle();
  assert.deepEqual(h.published(), []);
  // Quiet project: one look at its activity, no merge request list.
  const before = h.requests.length;
  await h.cycle();
  assert.deepEqual(h.requests.slice(before).map((url) => url.includes('/events')), [true]);
  h.state.routes['/projects/group%2Fapp/events'] = [{ id: 2 }];
  const fresh = new Date(Date.now() + 1000).toISOString();
  h.state.routes['/projects/group%2Fapp/merge_requests?'] = [mr(), mr({ id: 502, iid: 8, created_at: fresh, updated_at: fresh, references: { full: 'group/app!8' } })];
  h.state.routes['/merge_requests/8/notes'] = [];
  await h.cycle();
  assert.deepEqual(h.published().map((e) => [e.type, e.data.iid]), [['merge_request.opened', 8]]);
  assert.ok(h.requests.every((url) => !url.includes('/merge_requests?scope=created_by_me')), 'only the chosen project is read');
});

test('API failures report an error status instead of listening', async () => {
  const h = harness({
    subscriptions: watchMr,
    routes: { '/api/v4/user': { id: 1, username: 'me' }, '/projects/group%2Fapp/merge_requests/7': () => json({}, 500) },
  });
  await h.cycle();
  assert.deepEqual(h.statuses(), ['error']);
});

test('a whole project: finished pipelines are reported on their MR, running ones are not', async () => {
  const pipeline = (status, updated) => ({ id: 77, status, ref: 'refs/merge-requests/7/head', updated_at: updated });
  const h = harness({
    subscriptions: [{ events: ['merge_request.pipeline'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] }],
    routes: {
      '/api/v4/user': { id: 1, username: 'me' },
      '/projects/group%2Fapp/events': [{ id: 1 }],
      '/projects/group%2Fapp/pipelines?': [pipeline('running', '2026-01-01T00:00:00Z')],
      '/projects/group%2Fapp/merge_requests?': [mr()],
      '/projects/group%2Fapp/merge_requests/7': mr(),
    },
  });
  await h.cycle();
  const later = new Date(Date.now() + 1000).toISOString();
  h.state.routes['/projects/group%2Fapp/pipelines?'] = [pipeline('running', later)];
  await h.cycle();
  assert.deepEqual(h.published(), []);
  h.state.routes['/projects/group%2Fapp/pipelines?'] = [pipeline('failed', later)];
  await h.cycle();
  assert.deepEqual(h.published().map((e) => [e.type, e.data.iid, e.data.pipelineStatus]), [['merge_request.pipeline', 7, 'failed']]);
});

test('subscriptions are read once, then pushed by the host; a push wakes the watcher', async () => {
  const h = harness({ subscriptions: [], routes: { '/api/v4/user': { id: 1, username: 'me' }, '/projects/group%2Fapp/merge_requests/7': mr() } });
  assert.equal(await h.cycle(), 'idle');
  assert.equal(await h.cycle(), 'idle');
  assert.equal(h.pulls(), 1, 'no repeated asking');
  h.push(watchMr);
  assert.equal(await h.cycle(), 60 * 1000);
  assert.equal(h.pulls(), 1);
  assert.ok(h.requests.some((url) => url.includes('/merge_requests/7')), 'pushed subscription is watched');
});

test('a whole project is fully re-checked every few minutes even without new activity', async () => {
  const h = harness({
    subscriptions: [{ events: ['merge_request.updated'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] }],
    routes: {
      '/api/v4/user': { id: 1, username: 'me' },
      '/projects/group%2Fapp/events': [{ id: 1 }],
      '/projects/group%2Fapp/merge_requests?': [mr()],
    },
  });
  for (let i = 0; i < 6; i += 1) await h.cycle();
  const lists = h.requests.filter((url) => url.includes('/merge_requests?')).length;
  assert.equal(lists, 2, 'baseline + one sweep in six quiet minutes');
});

test('previously inactive existing objects still emit their first updated or reopened event', async () => {
  const h = harness({
    subscriptions: [{
      events: ['merge_request.updated', 'merge_request.reopened', 'merge_request.comment'],
      filters: [{ field: 'project', operator: 'equals', value: 'group/app' }],
    }],
    routes: {
      '/api/v4/user': { id: 1, username: 'me' },
      '/projects/group%2Fapp/events': [{ id: 1 }],
      '/projects/group%2Fapp/merge_requests?': [mr()],
    },
  });
  await h.cycle();
  assert.deepEqual(h.published(), []);

  const fresh = new Date(Date.now() + 2000).toISOString();
  h.state.routes['/projects/group%2Fapp/events'] = [{ id: 2 }];
  // MR !3 and MR !4 were created months ago and fell outside the initial baseline page, then woke up.
  h.state.routes['/projects/group%2Fapp/merge_requests?'] = [
    mr({ id: 403, iid: 3, created_at: '2025-06-01T00:00:00Z', updated_at: fresh, references: { full: 'group/app!3' } }),
    mr({ id: 404, iid: 4, created_at: '2025-06-01T00:00:00Z', updated_at: fresh, references: { full: 'group/app!4' } }),
    mr({ id: 405, iid: 5, created_at: '2025-06-01T00:00:00Z', updated_at: fresh, references: { full: 'group/app!5' } }),
  ];
  h.state.routes['/merge_requests/3/notes'] = [];
  h.state.routes['/merge_requests/4/notes'] = [
    { id: 301, body: 'reopened', system: true, created_at: fresh, author: { username: 'alice' } },
  ];
  h.state.routes['/merge_requests/5/notes'] = [
    { id: 302, body: 'just a comment', system: false, created_at: fresh, author: { username: 'bob' } },
  ];
  await h.cycle();
  assert.deepEqual(
    h.published().map((e) => [e.type, e.data.iid]),
    [
      ['merge_request.updated', 3],
      ['merge_request.reopened', 4],
      ['merge_request.comment', 5],
    ],
  );
});

test('retries notes on transient failure without advancing the snapshot, and paginates past >100 notes', async () => {
  let failNotes = true;
  const fresh = '2026-01-02T00:05:00Z';
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    id: 1000 - i,
    body: 'mentioned in commit abc',
    system: true,
    created_at: '2026-01-02T00:04:00Z',
    author: { username: 'bot' },
  }));
  const page2 = [
    { id: 202, body: 'approved this merge request', system: true, created_at: '2026-01-02T00:02:00Z', author: { username: 'reviewer' } },
    { id: 201, body: 'Early review remark', system: false, created_at: '2026-01-02T00:01:00Z', author: { username: 'reviewer' } },
    { id: 100, body: 'before baseline', system: false, created_at: '2025-12-31T00:00:00Z', author: { username: 'alice' } },
  ];
  const h = harness({
    subscriptions: watchMr,
    routes: {
      '/api/v4/user': { id: 1, username: 'me' },
      '/projects/group%2Fapp/merge_requests/7': mr({ head_pipeline: null }),
      '/merge_requests/7/notes': (url) => {
        if (failNotes) return json({ message: 'gateway timeout' }, 502);
        return json(url.includes('page=2') ? page2 : page1);
      },
    },
  });
  await h.cycle();
  assert.deepEqual(h.statuses(), ['listening']);

  h.state.routes['/projects/group%2Fapp/merge_requests/7'] = mr({ updated_at: fresh, head_pipeline: null });
  await h.cycle();
  assert.deepEqual(h.statuses(), ['listening', 'error'], 'failed notes read reports error and keeps retry cursor');
  assert.deepEqual(h.published(), []);

  failNotes = false;
  await h.cycle();
  assert.deepEqual(h.statuses(), ['listening', 'error', 'listening']);
  assert.deepEqual(
    h.published().map((e) => [e.type, e.data.noteId]),
    [['merge_request.comment', 201], ['merge_request.approved', 202]],
  );
});

test('drains >20 changed items across cycles without letting unchanged items consume the per-cycle budget', async () => {
  const unchanged = Array.from({ length: 20 }, (_, i) => mr({
    id: 100 + i, iid: i + 1, references: { full: `group/app!${i + 1}` },
  }));
  const h = harness({
    subscriptions: [{ events: ['merge_request.opened'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] }],
    routes: {
      '/api/v4/user': { id: 1, username: 'me' },
      '/projects/group%2Fapp/events': [{ id: 1 }],
      '/projects/group%2Fapp/merge_requests?': unchanged,
      '/notes': [],
    },
  });
  await h.cycle();
  assert.deepEqual(h.published(), []);

  const baseMs = Date.now() + 1000;
  const burst = Array.from({ length: 25 }, (_, i) => {
    const ts = new Date(baseMs + i * 10).toISOString();
    return mr({
      id: 300 + i, iid: 101 + i, created_at: ts, updated_at: ts, references: { full: `group/app!${101 + i}` },
    });
  });
  h.state.routes['/projects/group%2Fapp/events'] = [{ id: 2 }];
  h.state.routes['/projects/group%2Fapp/merge_requests?'] = (url) =>
    json(url.includes('page=2') ? [] : [...unchanged, ...burst]);

  await h.cycle();
  assert.equal(h.published().length, 20, 'first active cycle handles 20 newly changed MRs after skipping 20 unchanged ones');

  // Even without another project `/events` change, the remaining 5 MRs drain on the very next cycle.
  await h.cycle();
  assert.deepEqual(
    h.published().map((e) => e.data.iid),
    Array.from({ length: 25 }, (_, i) => 101 + i),
  );
});

test('retains finished pipelines on MR lookup errors or lookup cap until all are queued', async () => {
  let failMrLookup = true;
  const h = harness({
    subscriptions: [{ events: ['merge_request.pipeline'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] }],
    routes: {
      '/api/v4/user': { id: 1, username: 'me' },
      '/projects/group%2Fapp/events': [{ id: 1 }],
      '/projects/group%2Fapp/pipelines?': [],
      '/projects/group%2Fapp/merge_requests?': [],
      '/projects/group%2Fapp/merge_requests/': (url) => {
        if (failMrLookup) return json({ message: 'server error' }, 500);
        const iid = Number(url.split('/').pop());
        return json(mr({ id: 800 + iid, iid, references: { full: `group/app!${iid}` } }));
      },
    },
  });
  await h.cycle();

  const baseMs = Date.now() + 1000;
  const finished = Array.from({ length: 12 }, (_, i) => ({
    id: 900 + i,
    status: 'success',
    ref: `refs/merge-requests/${i + 1}/head`,
    updated_at: new Date(baseMs + i * 10).toISOString(),
  }));
  h.state.routes['/projects/group%2Fapp/events'] = [{ id: 2 }];
  h.state.routes['/projects/group%2Fapp/pipelines?'] = finished;

  await h.cycle();
  assert.deepEqual(h.statuses(), ['listening', 'error']);
  assert.deepEqual(h.published(), []);

  failMrLookup = false;
  await h.cycle();
  assert.equal(h.published().length, 10, 'caps MR lookups to 10 per cycle without marking #11 and #12 done');

  await h.cycle();
  assert.deepEqual(
    h.published().map((e) => e.data.iid),
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
});
