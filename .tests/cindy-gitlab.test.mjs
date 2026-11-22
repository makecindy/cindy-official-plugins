import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../cindy-gitlab/main.js', import.meta.url), 'utf8');
const url = 'https://git.team.test/group/sub/repo/-/merge_requests/2';

function runtime(draft = false, followModel = null) {
  let handler, card, result, call = 0;
  const files = new Map(), schedules = new Map(), requests = [];
  const failures = new Set();
  let settingsReadable = true;
  const mr = { iid: 2, title: 'Fix rendering', state: 'opened', draft, target_branch: 'main', source_branch: 'fix' };
  let kv = { prCard: { autoFollow: true, autoRename: true, autoArchive: true, followModel } };
  runInNewContext(source, {
    BroadcastChannel: class {}, setTimeout, clearTimeout,
    async fetch(path, init) {
      if (path === '/connections') return { json: async () => [{ key: 'gitlab_conn', connections: [
        { host: 'other.team.test', id: 'other', isDefault: true }, { host: 'git.team.test', id: 'team' },
      ] }] };
      assert.equal(path, '/kv');
      if (!settingsReadable) return { ok: false, status: 503 };
      if (init?.method === 'PUT') kv = JSON.parse(init.body);
      return { ok: true, json: async () => kv };
    },
    cindy: {
      onHostMessage(fn) { handler = fn; },
      request: async () => ({ ok: true, context: { locale: 'en' } }),
      async fetch(req) {
        requests.push(req.url);
        if (req.method === 'POST' && req.url.endsWith('/merge_requests/2/notes')) {
          assert.deepEqual(JSON.parse(req.body), { body: '/ready' });
          mr.draft = false;
          return { ok: true, status: 201, body: '{}' };
        }
        assert.equal(req.url, 'https://git.team.test/api/v4/projects/group%2Fsub%2Frepo/merge_requests/2');
        return { ok: true, status: 200, body: JSON.stringify(mr) };
      },
      async send(m) {
        if (m.type === 'tool-result') result = m;
        if (m.type === 'card-update') card = m;
        if (m.type === 'fs-request') {
          if (m.op === 'list') return { ok: true, entries: [...files.keys()].map(path => ({path})) };
          if (m.op === 'read') return { ok: files.has(m.path), content: files.get(m.path) };
          if (m.op === 'write') files.set(m.path, m.content);
        }
        return { ok: true };
      },
      host: { async call(server, tool, args) {
        assert.equal(server, 'cindy_scheduler');
        if (failures.delete(tool)) throw new Error(tool + ' unavailable');
        let data;
        if (tool === 'schedule_list') data = [...schedules.values()];
        else if (tool === 'schedule_create') {
          assert.equal(schedules.size, 0);
          data = { ...args, id: 'schedule', status: 'active' }; schedules.set(data.id, data);
        } else if (tool === 'schedule_get') data = schedules.get(args.id) ?? null;
        else if (tool === 'schedule_delete') { schedules.delete(args.id); data = true; }
        else throw new Error(tool);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
      } },
    },
  });
  return {
    schedules, mr, requests, failures,
    setSettingsReadable(value) { settingsReadable = value; },
    async show(args, session = 's1') {
      result = null;
      await handler({ type: 'tool-call', tool: 'mr_card', callId: 'c' + ++call,
        args: { session_context: { session_id: session }, ...args } });
      assert.equal(result?.ok, true, result?.message);
      return { ...result.result, html: card.html };
    },
    async click(callId, actionId) {
      await handler({ type: 'event', name: 'card-action', sessionId: 's1', callId, actionId, userActionToken: 'click' });
    },
  };
}

test('published MR uses its host and original card, claims one follow-up, stops on verified merge', async () => {
  const r = runtime();
  const ask = await r.show({ project_path: 'group/sub/repo', instance: 'team', head: 'fix' });
  assert.equal(ask.stage, 'ask');
  const open = await r.show({ card_id: ask.card_id, mr: url, published: true });
  assert.equal(open.follow_state, 'active', open.note);
  assert.match(open.todo.join(' '), /!2/);
  assert.ok(open.html.includes('data-ghost-pr-status="' + url + '"'));
  assert.ok(open.html.includes('data-ghost-task-archive-auto'));
  assert.equal(r.schedules.get('schedule').prTrigger.url, url);
  assert.equal((await r.show({ mr: url }, 's2')).disposition, 'existing_task');
  r.mr.state = 'merged';
  const ended = await r.show({ card_id: ask.card_id, renamed: true });
  assert.equal(ended.stage, 'merged');
  assert.equal(r.schedules.size, 0);
});

test('opening an existing MR only displays it; explicit start and stop operate the task schedule', async () => {
  const r = runtime();
  const view = await r.show({ mr: url });
  assert.equal(view.todo, undefined);
  assert.equal(r.schedules.size, 0);
  await r.click(view.card_id, 'pr:follow');
  assert.equal(r.schedules.size, 1);
  await r.click(view.card_id, 'pr:stop');
  assert.equal(r.schedules.size, 0);
});

test('publishing a draft with auto-follow enabled does not start a schedule', async () => {
  const r = runtime(true);
  const view = await r.show({ mr: url, published: true });
  assert.equal(view.stage, 'draft');
  assert.equal(r.schedules.size, 0);
});

test('marking a published draft ready starts one schedule with the model configured on the card', async () => {
  const r = runtime(true, { route: { agentKind: 'codex', model: 'example-model', providerId: 'example-provider',
    effort: 'high', fastMode: false }, label: 'Example' });
  const view = await r.show({ mr: url, published: true });
  await r.click(view.card_id, 'pr:ready');
  assert.equal(r.mr.draft, false);
  assert.equal(r.schedules.get('schedule')?.model, 'example-model');
  assert.equal(r.schedules.get('schedule')?.effort, 'high');
  assert.equal(r.schedules.get('schedule')?.targetSessionId, 's1');
});

test('a follow click rechecks a previously opened MR that has since become a draft', async () => {
  const r = runtime();
  const view = await r.show({ mr: url });
  r.mr.draft = true;
  await r.click(view.card_id, 'pr:follow');
  assert.equal(r.schedules.size, 0);
});

test('reusing a publish card to view an existing MR leaves automatic actions idle', async () => {
  const r = runtime();
  const ask = await r.show({ project_path: 'group/sub/repo', instance: 'team', head: 'fix' });
  for (const args of [{ card_id: ask.card_id, mr: url }, { card_id: ask.card_id }]) {
    const view = await r.show(args);
    assert.equal(view.card_id, ask.card_id);
    assert.equal(view.todo, undefined);
    assert.equal(view.follow_state, undefined);
    assert.equal(r.schedules.size, 0);
  }
});

for (const publishOnly of [false, true]) {
  test('publication follow choice survives settings failure (publish only: ' + publishOnly + ')', async () => {
    const r = runtime();
    const ask = await r.show({ project_path: 'group/sub/repo', instance: 'team', head: 'fix' });
    const args = { card_id: ask.card_id, mr: url, published: true };
    r.setSettingsReadable(false);
    const published = await r.show(publishOnly ? { ...args, following: false } : args);
    assert.equal(published.todo, undefined);
    assert.equal(r.schedules.size, 0);
    // A repeated publication report may omit the opt-out, just like a later refresh.
    await r.show(args);
    r.setSettingsReadable(true);
    const recovered = await r.show({ card_id: ask.card_id });
    assert.equal(recovered.follow_state, publishOnly ? undefined : 'active');
    assert.equal(recovered.todo?.length, 1);
    assert.equal(r.schedules.size, publishOnly ? 0 : 1);
    const refreshed = await r.show({ card_id: ask.card_id, renamed: true });
    assert.equal(refreshed.todo, undefined);
    assert.equal(r.schedules.size, publishOnly ? 0 : 1);
    if (publishOnly) {
      await r.click(ask.card_id, 'pr:follow');
      assert.equal(r.schedules.size, 1);
    }
  });
}

for (const end of ['merged', 'closed', 'draft']) {
  test('a ' + end + ' MR cleans up its created but unverified schedule', async () => {
    const r = runtime();
    r.failures.add('schedule_get');
    const open = await r.show({ mr: url, published: true });
    assert.equal(open.follow_state, 'unverified');
    assert.equal(r.schedules.size, 1);

    if (end === 'draft') r.mr.draft = true;
    else r.mr.state = end;
    const owned = r.schedules.get('schedule');
    r.schedules.set('other-card', { ...owned, id: 'other-card', prompt: 'MR card: other-card' });

    r.failures.add('schedule_delete');
    const pending = await r.show({ card_id: open.card_id });
    assert.equal(pending.stage, end);
    assert.equal(pending.follow_state, 'unverified');
    assert.equal(r.schedules.size, 2);

    const ended = await r.show({ card_id: open.card_id });
    assert.equal(ended.stage, end);
    assert.equal(ended.follow_state, 'stopped');
    assert.deepEqual([...r.schedules.keys()], ['other-card']);
  });
}
