// GitLab automation events: runs the real main.js in a vm with a fake host; no network.
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
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const json = (data, status = 200) => ({ ok: true, status, body: JSON.stringify(data), headers: {} });

function mr(overrides = {}) {
  return {
    id: 501, iid: 7, project_id: 42, title: 'Add feature', description: 'desc', state: 'opened',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    sha: 'aaa', labels: [], draft: false, source_branch: 'feat', target_branch: 'main',
    author: { username: 'alice' }, references: { full: 'Group/App!7' },
    web_url: `https://${HOST}/group/app/-/merge_requests/7`,
    head_pipeline: { id: 9, status: 'running' }, user_notes_count: 0, ...overrides,
  };
}

function issue(overrides = {}) {
  return {
    id: 601, iid: 3, project_id: 42, title: 'Bug', description: 'body', state: 'opened',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    labels: [], assignees: [], author: { username: 'alice' }, references: { full: 'group/app#3' },
    web_url: `https://${HOST}/group/app/-/issues/3`, user_notes_count: 0, ...overrides,
  };
}

function harness({ subscriptions = [], routes = {}, subscriptionsReply, publishReply } = {}) {
  const sent = [];
  const requests = [];
  const state = { routes: { '/api/v4/user': { id: 1, username: 'me' }, ...routes }, handler: null, publishReply };
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
      if (m.type === 'routine-request' && m.action === 'subscriptions') return subscriptionsReply ?? { ok: true, subscriptions };
      if (m.type === 'routine-request' && m.action === 'publish' && state.publishReply) return state.publishReply(m.event);
      return { ok: true, accepted: 1, duplicate: false };
    },
  };
  const context = vm.createContext({
    cindy, console, URL, Date, setTimeout: () => 0, BroadcastChannel: class { postMessage() {} },
    fetch: async (url) => ({ json: async () => (url === '/connections' ? [{ key: 'gitlab_conn', connections: [{ id: 'c1', host: HOST, isDefault: true }] }] : {}) }),
  });
  vm.runInContext(source, context, { filename: 'main.js' });
  return {
    state, requests,
    cycle: () => vm.runInContext('eventsCycle()', context),
    push: (s) => state.handler({ type: 'routine-subscriptions', subscriptions: s }),
    pulls: () => sent.filter((m) => m.action === 'subscriptions').length,
    published: () => sent.filter((m) => m.action === 'publish').map((m) => m.event),
    statuses: () => sent.filter((m) => m.action === 'status').map((m) => m.status),
  };
}

const watchMr = [{
  events: ['merge_request.merged', 'merge_request.comment', 'merge_request.pipeline'],
  filters: [{ field: 'host', operator: 'equals', value: HOST }, { field: 'project', operator: 'equals', value: 'group/app' }, { field: 'iid', operator: 'equals', value: '7' }],
}];

test('manifest declares glab-cli connection fallback and the published events with every field they carry', () => {
  assert.equal(manifest.network.connections[0].source, 'glab-cli');
  const types = manifest.routineEvents.events.map((event) => event.type);
  assert.ok(types.includes('merge_request.merged') && types.includes('issue.comment'));
  for (const event of manifest.routineEvents.events) {
    assert.ok(['merge_request', 'issue'].includes(event.type.split('.')[0]));
    for (const field of ['host', 'project', 'iid', 'kind', 'state', 'url']) assert.ok(event.fields.includes(field), `${event.type} ${field}`);
  }
});

test('does nothing without subscriptions and stops on hosts without the subscriptions operation', async () => {
  const idle = harness();
  assert.equal(await idle.cycle(), 'idle');
  assert.deepEqual(idle.requests, []);
  assert.equal(await harness({ subscriptionsReply: { ok: false, message: 'Unknown routine operation' } }).cycle(), null);
});

test('a chosen MR: baseline first, then merged, new comments and pipeline changes', async () => {
  const h = harness({ subscriptions: watchMr, routes: { '/merge_requests/7/notes': [], '/projects/group%2Fapp/merge_requests/7': mr({ head_pipeline: null }) } });
  await h.cycle();
  assert.deepEqual([h.published(), h.statuses()], [[], ['listening']]);
  h.state.routes['/merge_requests/7/notes'] = [
    { id: 90, body: 'LGTM', system: false, created_at: '2026-01-02T00:00:00Z', author: { username: 'me' } },
    { id: 89, body: 'approved this merge request', system: true, created_at: '2026-01-02T00:00:00Z', author: { username: 'bob' } },
    { id: 10, body: 'old', system: false, created_at: '2025-12-31T00:00:00Z', author: { username: 'bob' } },
  ];
  h.state.routes['/projects/group%2Fapp/merge_requests/7'] = mr({ state: 'merged', merged_at: '2026-01-02T00:00:00Z', merged_by: { username: 'bob' }, updated_at: '2026-01-02T00:00:01Z', head_pipeline: { id: 9, status: 'success' } });
  await h.cycle();
  const events = h.published();
  assert.deepEqual(events.map((e) => e.type).sort(), ['merge_request.approved', 'merge_request.comment', 'merge_request.merged', 'merge_request.pipeline']);
  const merged = events.find((e) => e.type === 'merge_request.merged');
  assert.equal(merged.id, `${HOST}/group/app!7:merged`);
  assert.deepEqual({ host: merged.data.host, project: merged.data.project, iid: merged.data.iid, kind: merged.data.kind, actor: merged.data.actor, fromSelf: merged.data.fromSelf }, { host: HOST, project: 'group/app', iid: 7, kind: 'mr', actor: 'bob', fromSelf: false });
  assert.equal(events.find((e) => e.type === 'merge_request.comment').data.fromSelf, true);
  assert.equal(events.find((e) => e.type === 'merge_request.pipeline').data.pipelineStatus, 'success');
  await h.cycle();
  assert.equal(h.published().length, events.length);
});

test('a whole project: new MRs after the baseline become opened events, and API failures report error', async () => {
  const h = harness({
    subscriptions: [{ events: ['merge_request.opened'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] }],
    routes: { '/projects/group%2Fapp/events': [{ id: 1 }], '/projects/group%2Fapp/merge_requests?': [mr()] },
  });
  await h.cycle();
  const before = h.requests.length;
  await h.cycle();
  assert.deepEqual(h.requests.slice(before).map((url) => url.includes('/events')), [true]);
  const fresh = new Date(Date.now() + 1000).toISOString();
  h.state.routes['/projects/group%2Fapp/events'] = [{ id: 2 }];
  h.state.routes['/projects/group%2Fapp/merge_requests?'] = [mr(), mr({ id: 502, iid: 8, created_at: fresh, updated_at: fresh, references: { full: 'group/app!8' } })];
  h.state.routes['/merge_requests/8/notes'] = [];
  await h.cycle();
  assert.deepEqual(h.published().map((e) => [e.type, e.data.iid]), [['merge_request.opened', 8]]);

  const errH = harness({ subscriptions: watchMr, routes: { '/projects/group%2Fapp/merge_requests/7': () => json({}, 500) } });
  await errH.cycle();
  assert.deepEqual(errH.statuses(), ['error']);
});

test('finished pipelines, subscription push wake, periodic sweep, and assignee/reviewer/targetBranch updates', async () => {
  const pipeline = (status, updated) => ({ id: 77, status, ref: 'refs/merge-requests/7/head', updated_at: updated });
  const h = harness({
    subscriptions: [{ events: ['merge_request.pipeline'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] }],
    routes: { '/projects/group%2Fapp/events': [{ id: 1 }], '/projects/group%2Fapp/pipelines?': [pipeline('running', '2026-01-01T00:00:00Z')], '/projects/group%2Fapp/merge_requests?': [mr()], '/projects/group%2Fapp/merge_requests/7': mr() },
  });
  await h.cycle();
  const later = new Date(Date.now() + 1000).toISOString();
  h.state.routes['/projects/group%2Fapp/pipelines?'] = [pipeline('running', later)];
  await h.cycle();
  assert.deepEqual(h.published(), []);
  h.state.routes['/projects/group%2Fapp/pipelines?'] = [pipeline('failed', later)];
  await h.cycle();
  assert.deepEqual(h.published().map((e) => [e.type, e.data.iid, e.data.pipelineStatus]), [['merge_request.pipeline', 7, 'failed']]);

  const wake = harness({ subscriptions: [], routes: { '/projects/group%2Fapp/merge_requests/7': mr() } });
  assert.equal(await wake.cycle(), 'idle');
  assert.equal(await wake.cycle(), 'idle');
  wake.push(watchMr);
  assert.equal(await wake.cycle(), 60 * 1000);
  assert.equal(wake.pulls(), 1);

  const upd = harness({
    subscriptions: [{ events: ['issue.updated', 'merge_request.updated'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] }],
    routes: { '/projects/group%2Fapp/events': [{ id: 1 }], '/projects/group%2Fapp/issues?': [issue()], '/projects/group%2Fapp/merge_requests?': [mr({ head_pipeline: null })], '/notes': [] },
  });
  for (let i = 0; i < 6; i += 1) await upd.cycle();
  assert.equal(upd.requests.filter((url) => url.includes('/merge_requests?')).length, 2, 'baseline + one sweep in six quiet minutes');
  const t1 = new Date(Date.now() + 2000).toISOString();
  upd.state.routes['/projects/group%2Fapp/events'] = [{ id: 2 }];
  upd.state.routes['/projects/group%2Fapp/issues?'] = [issue({ assignees: [{ id: 5, username: 'carol' }], updated_at: t1 })];
  upd.state.routes['/projects/group%2Fapp/merge_requests?'] = [mr({ head_pipeline: null, reviewers: [{ id: 6, username: 'dave' }], target_branch: 'release', updated_at: t1 })];
  await upd.cycle();
  assert.deepEqual(upd.published().map((e) => [e.type, e.data.changes]).sort(), [
    ['issue.updated', 'assignees'],
    ['merge_request.updated', 'targetBranch,reviewers'],
  ]);
});

test('previously inactive objects, >100 notes pagination/retry, and >20 changed items draining', async () => {
  const inactive = harness({
    subscriptions: [{ events: ['merge_request.updated', 'merge_request.reopened', 'merge_request.comment'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] }],
    routes: { '/projects/group%2Fapp/events': [{ id: 1 }], '/projects/group%2Fapp/merge_requests?': [mr()] },
  });
  await inactive.cycle();
  const fresh = new Date(Date.now() + 2000).toISOString();
  inactive.state.routes['/projects/group%2Fapp/events'] = [{ id: 2 }];
  inactive.state.routes['/projects/group%2Fapp/merge_requests?'] = [3, 4, 5].map((iid) => mr({ id: 400 + iid, iid, created_at: '2025-06-01T00:00:00Z', updated_at: fresh, references: { full: `group/app!${iid}` } }));
  inactive.state.routes['/merge_requests/3/notes'] = [];
  inactive.state.routes['/merge_requests/4/notes'] = [{ id: 301, body: 'reopened', system: true, created_at: fresh, author: { username: 'alice' } }];
  inactive.state.routes['/merge_requests/5/notes'] = [{ id: 302, body: 'just a comment', system: false, created_at: fresh, author: { username: 'bob' } }];
  await inactive.cycle();
  assert.deepEqual(inactive.published().map((e) => [e.type, e.data.iid]), [['merge_request.updated', 3], ['merge_request.reopened', 4], ['merge_request.comment', 5]]);

  let failNotes = true;
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: 1000 - i, body: 'mentioned in commit abc', system: true, created_at: '2026-01-02T00:04:00Z', author: { username: 'bot' } }));
  const page2 = [
    { id: 202, body: 'approved this merge request', system: true, created_at: '2026-01-02T00:02:00Z', author: { username: 'reviewer' } },
    { id: 201, body: 'Early review remark', system: false, created_at: '2026-01-02T00:01:00Z', author: { username: 'reviewer' } },
    { id: 100, body: 'before baseline', system: false, created_at: '2025-12-31T00:00:00Z', author: { username: 'alice' } },
  ];
  const notesH = harness({
    subscriptions: watchMr,
    routes: { '/projects/group%2Fapp/merge_requests/7': mr({ head_pipeline: null }), '/merge_requests/7/notes': (url) => (failNotes ? json({ message: 'gateway timeout' }, 502) : json(url.includes('page=2') ? page2 : page1)) },
  });
  await notesH.cycle();
  notesH.state.routes['/projects/group%2Fapp/merge_requests/7'] = mr({ updated_at: '2026-01-02T00:05:00Z', head_pipeline: null });
  await notesH.cycle();
  assert.deepEqual(notesH.statuses(), ['listening', 'error']);
  failNotes = false;
  await notesH.cycle();
  assert.deepEqual(notesH.published().map((e) => [e.type, e.data.noteId]), [['merge_request.comment', 201], ['merge_request.approved', 202]]);

  const unchanged = Array.from({ length: 20 }, (_, i) => mr({ id: 100 + i, iid: i + 1, references: { full: `group/app!${i + 1}` } }));
  const drain = harness({
    subscriptions: [{ events: ['merge_request.opened'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] }],
    routes: { '/projects/group%2Fapp/events': [{ id: 1 }], '/projects/group%2Fapp/merge_requests?': unchanged, '/notes': [] },
  });
  await drain.cycle();
  const baseMs = Date.now() + 1000;
  const burst = Array.from({ length: 25 }, (_, i) => {
    const ts = new Date(baseMs + i * 10).toISOString();
    return mr({ id: 300 + i, iid: 101 + i, created_at: ts, updated_at: ts, references: { full: `group/app!${101 + i}` } });
  });
  drain.state.routes['/projects/group%2Fapp/events'] = [{ id: 2 }];
  drain.state.routes['/projects/group%2Fapp/merge_requests?'] = (url) => json(url.includes('page=2') ? [] : [...unchanged, ...burst]);
  await drain.cycle();
  assert.equal(drain.published().length, 20);
  await drain.cycle();
  assert.deepEqual(drain.published().map((e) => e.data.iid), Array.from({ length: 25 }, (_, i) => 101 + i));
});

const paginate = (list, url) => {
  const u = new URL(url);
  const page = Number(u.searchParams.get('page') || 1);
  const per = Number(u.searchParams.get('per_page') || 50);
  const after = u.searchParams.get('updated_after');
  const filtered = after ? list.filter((it) => Date.parse(it.updated_at) >= Date.parse(after)) : [...list].reverse();
  return json(filtered.slice((page - 1) * per, page * per));
};

test('branch pipelines: multi-MR fan-out, unconfirmed SHA retention, and multi-page pending rotation wrap-around', async () => {
  assert.equal(await harness({ subscriptions: [{ events: ['merge_request.pipeline'] }] }).cycle(), 'idle');
  let failMrLookup = true, confirm55th = false, confirm1st = false, pipeReady = false;
  let baseMs = 0;
  const h = harness({
    subscriptions: [{ events: ['merge_request.pipeline'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] }],
    routes: {
      '/projects/group%2Fapp/events': [{ id: 1 }],
      '/projects/group%2Fapp/pipelines?': (url) => {
        if (!pipeReady) return json([]);
        const mrPipes = Array.from({ length: 11 }, (_, i) => ({ id: 900 + i, status: 'success', ref: `refs/merge-requests/${i + 1}/head`, updated_at: new Date(baseMs + i * 10).toISOString() }));
        const pendPipes = Array.from({ length: 65 }, (_, i) => {
          const n = i + 1;
          const ok = (n === 55 && confirm55th) || (n === 1 && confirm1st);
          return { id: 960 + i, status: 'success', ref: `pend-${n}`, sha: ok ? `sha-${n}` : `wait-${n}`, updated_at: new Date(baseMs + (n <= 37 ? 300 : 5000)).toISOString() };
        });
        return paginate([
          ...mrPipes,
          { id: 950, status: 'success', ref: 'main', sha: 'upstream-main-sha', updated_at: new Date(baseMs + 200).toISOString() },
          { id: 951, status: 'success', ref: 'feat', sha: 'feat-sha', updated_at: new Date(baseMs + 210).toISOString() },
          ...pendPipes,
        ], url);
      },
      '/projects/group%2Fapp/merge_requests?': (url) => {
        if (url.includes('source_branch=main')) return json([mr({ iid: 88, source_branch: 'main', source_project_id: 99, target_project_id: 42, sha: 'fork-sha' }), mr({ iid: 89, source_branch: 'main', source_project_id: 42, target_project_id: 42, sha: 'old-sha' })]);
        const pendMatch = /source_branch=pend-([0-9]+)/.exec(url);
        if (pendMatch) {
          const n = Number(pendMatch[1]);
          const ok = (n === 55 && confirm55th) || (n === 1 && confirm1st);
          return json([mr({ id: 900 + n, iid: 100 + n, source_branch: `pend-${n}`, ...(ok ? { source_project_id: 42, target_project_id: 42, sha: `sha-${n}` } : { sha: '' }), references: { full: `group/app!${100 + n}` } })]);
        }
        return json([
          mr({ id: 890, iid: 90, source_branch: 'feat', target_branch: 'main', source_project_id: 42, target_project_id: 42, sha: 'feat-sha', references: { full: 'group/app!90' } }),
          mr({ id: 891, iid: 91, source_branch: 'feat', target_branch: 'release', source_project_id: 42, target_project_id: 42, sha: 'feat-sha', references: { full: 'group/app!91' } }),
        ]);
      },
      '/projects/group%2Fapp/merge_requests/': (url) => (failMrLookup ? json({ message: 'err' }, 500) : json(mr({ id: 800, iid: Number(url.split('/').pop()), references: { full: `group/app!${url.split('/').pop()}` } }))),
    },
  });
  await h.cycle();
  baseMs = Date.now() + 1000;
  pipeReady = true;
  h.state.routes['/projects/group%2Fapp/events'] = [{ id: 2 }];
  await h.cycle();
  assert.deepEqual(h.statuses(), ['listening', 'error']);
  failMrLookup = false;
  await h.cycle();
  assert.equal(h.published().length, 10);
  for (let c = 0; c < 8; c += 1) await h.cycle();
  assert.deepEqual(h.published().map((e) => e.data.iid), [...Array.from({ length: 11 }, (_, i) => i + 1), 90, 91]);
  // 65 pending pipelines span page 1 (pend-1..37 at +300ms) and page 2 (pend-38..65 at +5000ms):
  // confirm pend-55 on page 2 first, then confirm pend-1 on page 1 to verify rotation wraps back to page 1 without advancing resumeAt past page 1.
  confirm55th = true;
  for (let c = 0; c < 10 && !h.published().some((e) => e.data.iid === 155); c += 1) await h.cycle();
  assert.ok(h.published().some((e) => e.data.iid === 155));
  confirm1st = true;
  for (let c = 0; c < 10 && !h.published().some((e) => e.data.iid === 101); c += 1) await h.cycle();
  assert.deepEqual(h.published().map((e) => e.data.iid), [...Array.from({ length: 11 }, (_, i) => i + 1), 90, 91, 155, 101]);
});

test('delivers >550 same-timestamp notes with overlapping subscription, 900/900 across >5000 snapshots, and 1001/1001 same-timestamp items', async () => {
  let allowPublish = true, cycleSent = 0, maxSentPerCycle = 0;
  const accepted = [];
  const allNotes = Array.from({ length: 620 }, (_, idx) => ({ id: 620 - idx, body: `c-${620 - idx}`, system: false, created_at: '2026-01-02T00:01:00Z', author: { username: 'alice' } }));
  const projectSub = { events: ['merge_request.comment'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] };
  const h = harness({
    subscriptions: [projectSub],
    publishReply: (ev) => (!allowPublish ? { ok: false, message: 'busy' } : (cycleSent += 1, accepted.push(ev), { ok: true, accepted: 1, duplicate: false })),
    routes: {
      '/projects/group%2Fapp/events': [{ id: 1 }],
      '/projects/group%2Fapp/merge_requests?': [mr({ head_pipeline: null })],
      '/projects/group%2Fapp/merge_requests/7': mr({ head_pipeline: null }),
      '/merge_requests/7/notes': (url) => { const p = Number((/[?&]page=([0-9]+)/.exec(url) || [])[1] || 1); return json(allNotes.slice((p - 1) * 100, p * 100)); },
    },
  });
  await h.cycle();
  const updatedMr = mr({ updated_at: '2026-01-02T00:01:00Z', head_pipeline: null });
  h.state.routes['/projects/group%2Fapp/events'] = [{ id: 2 }];
  h.state.routes['/projects/group%2Fapp/merge_requests?'] = [updatedMr];
  h.state.routes['/projects/group%2Fapp/merge_requests/7'] = updatedMr;
  allowPublish = false;
  await h.cycle();
  assert.deepEqual(h.statuses(), ['listening', 'error']);
  h.push([projectSub, ...watchMr]);
  allowPublish = true;
  for (let i = 0; i < 20 && accepted.length < 620; i += 1) { cycleSent = 0; await h.cycle(); if (cycleSent > maxSentPerCycle) maxSentPerCycle = cycleSent; }
  assert.ok(maxSentPerCycle <= 40);
  assert.deepEqual(accepted.map((e) => e.data.noteId), Array.from({ length: 620 }, (_, i) => i + 1));

  let overlapItems = [], fillerItems = [], sameTsItems = [];
  const overlap = harness({
    subscriptions: [
      { events: ['merge_request.opened'], filters: [{ field: 'project', operator: 'equals', value: 'group/app' }] },
      { events: ['merge_request.opened'], filters: [{ field: 'host', operator: 'equals', value: HOST }, { field: 'project', operator: 'equals', value: 'group/app' }] },
      { events: ['merge_request.opened'] },
      { events: ['merge_request.opened'], filters: [{ field: 'project', operator: 'equals', value: 'group/filler' }] },
    ],
    routes: {
      '/projects/group%2Fapp/events': [{ id: 1 }], '/projects/group%2Ffiller/events': [{ id: 1 }],
      '/projects/group%2Fapp/merge_requests?': (url) => paginate(overlapItems, url),
      '/projects/group%2Ffiller/merge_requests?': (url) => paginate(fillerItems, url),
      '/api/v4/merge_requests?': (url) => (url.includes('scope=created_by_me') ? paginate(overlapItems, url) : json([])),
      '/notes': [],
    },
  });
  await overlap.cycle();
  const t0 = Date.now() + 1000;
  overlapItems = Array.from({ length: 900 }, (_, i) => { const ts = new Date(t0 + Math.floor(i / 3) * 10).toISOString(); return mr({ id: 10_000 + i, iid: i + 1, created_at: ts, updated_at: ts, references: { full: `group/app!${i + 1}` } }); });
  fillerItems = Array.from({ length: 3000 }, (_, i) => { const ts = new Date(t0 + i).toISOString(); return mr({ id: 30_000 + i, iid: i + 1, created_at: ts, updated_at: ts, references: { full: `group/filler!${i + 1}` } }); });
  overlap.state.routes['/projects/group%2Fapp/events'] = [{ id: 2 }];
  overlap.state.routes['/projects/group%2Ffiller/events'] = [{ id: 2 }];
  for (let c = 0; c < 160 && new Set(overlap.published().filter((e) => e.data.project === 'group/app').map((e) => e.data.iid)).size < 900; c += 1) await overlap.cycle();
  assert.equal(new Set(overlap.published().filter((e) => e.data.project === 'group/app').map((e) => e.data.iid)).size, 900);

  const sameTs = harness({
    subscriptions: [{ events: ['merge_request.opened'], filters: [{ field: 'project', operator: 'equals', value: 'group/same' }] }],
    routes: { '/projects/group%2Fsame/events': [{ id: 1 }], '/projects/group%2Fsame/merge_requests?': (url) => paginate(sameTsItems, url), '/notes': [] },
  });
  await sameTs.cycle();
  const stamp = new Date(Date.now() + 2000).toISOString();
  sameTsItems = Array.from({ length: 1001 }, (_, i) => mr({ id: 50_000 + i, iid: i + 1, created_at: stamp, updated_at: stamp, references: { full: `group/same!${i + 1}` } }));
  sameTs.state.routes['/projects/group%2Fsame/events'] = [{ id: 2 }];
  for (let c = 0; c < 60 && sameTs.published().length < 1001; c += 1) await sameTs.cycle();
  assert.equal(new Set(sameTs.published().map((e) => e.data.iid)).size, 1001);
  for (let c = 0; c < 3; c += 1) await sameTs.cycle();
  assert.equal(sameTs.published().length, 1001);
});
