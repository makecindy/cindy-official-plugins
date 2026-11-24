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
  const state = { routes };
  const cindy = {
    onHostMessage() {},
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

test('manifest declares the published events with every field they carry', () => {
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
  assert.equal(await idle.cycle(), 60 * 1000);
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
      '/projects/group%2Fapp/merge_requests/7': mr(),
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
    routes: { '/api/v4/user': { id: 1, username: 'me' }, '/projects/group%2Fapp/merge_requests?': [mr()] },
  });
  await h.cycle();
  assert.deepEqual(h.published(), []);
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
