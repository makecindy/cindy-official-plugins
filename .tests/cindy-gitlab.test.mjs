import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../cindy-gitlab/main.js', import.meta.url), 'utf8');
const url = 'https://git.team.test/group/sub/repo/-/merge_requests/2';

function runtime(draft = false, followModel = null, nativeScheduler = true, onCreateSchedule = null) {
  let handler, card, result, call = 0;
  const files = new Map(), schedules = new Map(), requests = [], merges = [], createAttempts = [];
  const failures = new Set(), handoffs = [];
  const viewer = { id: 19 };
  let mergeOutcome = 'merged';
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
        if (req.url === 'https://git.team.test/api/v4/user') {
          return { ok: true, status: 200, body: JSON.stringify(viewer) };
        }
        if (req.method === 'PUT' && req.url.endsWith('/merge')) {
          assert.equal(req.url, 'https://git.team.test/api/v4/projects/group%2Fsub%2Frepo/merge_requests/2/merge');
          merges.push(JSON.parse(req.body));
          if (mergeOutcome === 'unknown') return { ok: false, message: 'connection lost' };
          if (mergeOutcome === 'conflict') return { ok: true, status: 409, body: '{}' };
          mr.state = 'merged';
          return { ok: true, status: 200, body: JSON.stringify(mr) };
        }
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
          if (m.op === 'list') return { ok: true, entries: [...files.keys()].map((path, mtime) => ({ path, mtime })) };
          if (m.op === 'read') return files.has(m.path)
            ? { ok: true, content: files.get(m.path) }
            : { ok: false, errorCode: 'NOT_FOUND' };
          if (m.op === 'write') files.set(m.path, m.content);
          if (m.op === 'delete') files.delete(m.path);
        }
        return { ok: true };
      },
      agent: { async run(message) { handoffs.push(message); return { ok: true }; } },
      host: nativeScheduler ? { async call(server, tool, args) {
        assert.equal(server, 'cindy_scheduler');
        if (failures.delete(tool)) throw new Error(tool + ' unavailable');
        let data;
        if (tool === 'schedule_list') data = [...schedules.values()];
        else if (tool === 'schedule_create') {
          createAttempts.push({ ...args });
          if (onCreateSchedule) {
            const rejected = onCreateSchedule(args);
            if (rejected) return { isError: true, content: [{ type: 'text', text: JSON.stringify(rejected) }] };
          }
          assert.equal(schedules.size, 0);
          data = { ...args, id: 'schedule', status: 'active' }; schedules.set(data.id, data);
        } else if (tool === 'schedule_get') data = schedules.get(args.id) ?? null;
        else if (tool === 'schedule_delete') { schedules.delete(args.id); data = true; }
        else throw new Error(tool);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
      } } : undefined,
    },
  });
  return {
    files, schedules, mr, viewer, requests, failures, merges, handoffs, createAttempts,
    setMergeOutcome(value) { mergeOutcome = value; },
    lastCard: () => card,
    setSettingsReadable(value) { settingsReadable = value; },
    async show(args, session = 's1') {
      result = null;
      await handler({ type: 'tool-call', tool: 'mr_card', callId: 'c' + ++call,
        args: { session_context: { session_id: session }, ...args } });
      assert.equal(result?.ok, true, result?.message);
      return { ...result.result, html: card.html, anchor: card.callId };
    },
    async click(callId, actionId, extra = {}) {
      await handler({ type: 'event', name: 'card-action', sessionId: 's1', callId, actionId, userActionToken: 'click', ...extra });
    },
  };
}

function mergeableMrRuntime() {
  const workspace = runtime();
  Object.assign(workspace.mr, { id: 82, sha: 'a'.repeat(40), detailed_merge_status: 'mergeable',
    user: { can_merge: true }, squash: true });
  return workspace;
}

test('the MR merge button appears only when GitLab explicitly permits the current account to merge', async () => {
  const workspace = mergeableMrRuntime();
  workspace.mr.user.can_merge = false;
  const view = await workspace.show({ mr: url });
  const button = /data-ghost-action="pr:merge"/;
  assert.doesNotMatch(view.html, button);
  workspace.mr.user.can_merge = true;
  assert.match((await workspace.show({ card_id: view.card_id })).html, button);
  for (const changes of [
    { detailed_merge_status: 'not_approved' }, { detailed_merge_status: 'checking' },
    { draft: true }, { has_conflicts: true }, { state: 'closed' }, { user: {} },
  ]) {
    const original = Object.fromEntries(Object.keys(changes).map((key) => [key, workspace.mr[key]]));
    Object.assign(workspace.mr, changes);
    assert.doesNotMatch((await workspace.show({ card_id: view.card_id })).html, button);
    Object.assign(workspace.mr, original);
  }
  assert.equal(workspace.merges.length, 0);
});

test('the MR merge confirmation sends the checked head to the exact instance and ends follow-up', async () => {
  const workspace = mergeableMrRuntime();
  const view = await workspace.show({ mr: url, published: true });
  assert.equal(workspace.schedules.size, 1);
  await workspace.click(view.anchor, 'pr:merge');
  const confirmation = workspace.lastCard().html;
  assert.match(confirmation, /data-ghost-action="pr:merge-confirm:1" aria-label="Confirm merge"/);
  assert.match(confirmation, /Merge commit aaaaaaaaaaaa into main\? · Squash and merge/);
  assert.equal(workspace.merges.length, 0);
  await workspace.click(view.anchor, 'pr:merge-confirm:1', { userActionToken: undefined });
  assert.equal(workspace.merges.length, 0);
  await Promise.all([workspace.click(view.anchor, 'pr:merge-confirm:1'), workspace.click(view.anchor, 'pr:merge-confirm:1')]);
  assert.deepEqual(workspace.merges, [{ sha: workspace.mr.sha }]);
  assert.equal(workspace.schedules.size, 0);
  assert.match(workspace.lastCard().html, /data-ghost-task-archive-state="merged"/);
  assert.doesNotMatch(workspace.lastCard().html, /data-ghost-action="pr:merge/);
});

test('the MR merge confirmation does not merge a different commit or an ineligible MR', async () => {
  for (const change of [
    (workspace) => { workspace.mr.sha = 'b'.repeat(40); },
    (workspace) => { workspace.mr.detailed_merge_status = 'not_approved'; },
    (workspace) => { workspace.mr.user.can_merge = false; },
    (workspace) => { workspace.viewer.id = 21; },
  ]) {
    const workspace = mergeableMrRuntime();
    const view = await workspace.show({ mr: url });
    await workspace.click(view.anchor, 'pr:merge');
    change(workspace);
    await workspace.click(view.anchor, 'pr:merge-confirm:1');
    assert.equal(workspace.merges.length, 0);
    assert.match(workspace.lastCard().html, /Merge not sent/);
  }
});

test('confirming a merge after the MR becomes a draft stops its follow-up without merging', async () => {
  const workspace = mergeableMrRuntime();
  const view = await workspace.show({ mr: url, published: true });
  assert.equal(workspace.schedules.size, 1);
  await workspace.click(view.anchor, 'pr:merge');
  workspace.mr.draft = true;
  await workspace.click(view.anchor, 'pr:merge-confirm:1');
  assert.equal(workspace.merges.length, 0);
  assert.equal(workspace.schedules.size, 0);
  assert.match(workspace.lastCard().html, /data-ghost-action="pr:ready"/);
});

test('the MR merge card does not repeat writes when the result is unknown', async () => {
  const workspace = mergeableMrRuntime();
  const view = await workspace.show({ mr: url });
  workspace.setMergeOutcome('unknown');
  await workspace.click(view.anchor, 'pr:merge');
  await workspace.click(view.anchor, 'pr:merge-confirm:1');
  assert.match(workspace.lastCard().html, /Could not confirm the merge result/);
  assert.doesNotMatch(workspace.lastCard().html, /data-ghost-action="pr:merge"/);
  await workspace.click(view.anchor, 'pr:merge-recheck');
  assert.equal(workspace.merges.length, 1);
  workspace.mr.state = 'merged';
  await workspace.click(view.anchor, 'pr:merge-recheck');
  assert.match(workspace.lastCard().html, /data-ghost-task-archive-state="merged"/);
  assert.equal(workspace.merges.length, 1);
});

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

for (const nativeScheduler of [false, true]) {
  test('mark ready keeps the publish-only choice and accepts manual follow (scheduler: ' + nativeScheduler + ')', async () => {
    const r = runtime(true, null, nativeScheduler);
    const view = await r.show({ mr: url, published: true, following: false });
    await r.click(view.anchor, 'pr:ready');
    assert.equal(r.mr.draft, false);
    assert.equal(r.schedules.size, 0);
    assert.equal(r.handoffs.length, 0);
    await r.click(view.anchor, 'pr:follow');
    assert.equal(r.schedules.size, nativeScheduler ? 1 : 0);
    assert.equal(r.handoffs.length, nativeScheduler ? 0 : 1);
  });
}

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


test('card pruning preserves the current anchor of an active MR and drops its superseded anchor', async () => {
  const r = runtime();
  const open = await r.show({ mr: url, published: true });
  const previous = await r.show({ card_id: open.card_id, to_latest: true });
  const visible = await r.show({ card_id: open.card_id, to_latest: true });
  assert.notEqual(visible.anchor, previous.anchor);
  assert.equal(r.schedules.size, 1);

  for (let i = 0; i < 201; i++) {
    await r.show({ project_path: 'group/sub/repo', instance: 'team', head: 'other-' + i });
  }

  assert.equal(r.files.has('mr-cards/' + previous.anchor + '.json'), false);
  await r.click(visible.anchor, 'pr:stop');
  assert.equal(r.schedules.size, 0);
});

test('plugin-engine (acp) follow models survive card validation and reach auto-follow scheduling', async () => {
  const route = {
    agentKind: 'acp',
    providerId: 'acp-plugin:antigravity:agy',
    model: 'gemini-4-neon',
    effort: 'high',
    fastMode: false,
  };
  const r = runtime(true, { route, label: 'Gemini 4 Neon · Antigravity' });
  const view = await r.show({ mr: url, published: true });
  await r.click(view.card_id, 'pr:ready');
  assert.equal(r.mr.draft, false);
  assert.equal(r.schedules.get('schedule')?.modelAgentKind, 'acp');
  assert.equal(r.schedules.get('schedule')?.providerId, 'acp-plugin:antigravity:agy');
  assert.equal(r.schedules.get('schedule')?.model, 'gemini-4-neon');
  assert.equal(r.schedules.get('schedule')?.effort, 'high');
  assert.equal(r.schedules.get('schedule')?.fastMode, false);
  assert.equal(r.schedules.get('schedule')?.targetSessionId, 's1');
  assert.doesNotMatch(r.lastCard().html, /follow-up started with this task/);
});

test('malformed plugin-engine (acp) routes are dropped by card validation', async () => {
  for (const badRoute of [
    { agentKind: 'acp', providerId: 'not-a-plugin-prefix', model: 'gemini-4-neon', effort: 'high', fastMode: false },
    { agentKind: 'acp', providerId: 'acp-plugin:', model: 'gemini-4-neon', effort: 'high', fastMode: false },
    { agentKind: 'acp', providerId: 'acp-plugin:antigravity:agy', model: 'gemini-4-neon', effort: 'high', fastMode: true },
  ]) {
    const r = runtime(false, { route: badRoute, label: 'Invalid ACP' });
    const view = await r.show({ mr: url, published: true });
    assert.equal(view.follow_state, 'active');
    assert.equal(r.schedules.get('schedule')?.modelAgentKind, undefined);
    assert.equal(r.schedules.get('schedule')?.providerId, undefined);
    assert.equal(r.schedules.get('schedule')?.targetSessionId, 's1');
  }
});

test('bound ACP follow-up falls back to the task model when the host explicitly rejects bound ACP overrides', async () => {
  const route = {
    agentKind: 'acp',
    providerId: 'acp-plugin:antigravity:agy',
    model: 'gemini-4-neon',
    effort: 'high',
    fastMode: false,
  };
  const hostRejections = [
    { ok: false, message: 'A plugin engine schedule starts a new task each run' },
    { ok: false, message: 'Plugin engines run on the automation host only' },
    { ok: false, message: 'Explicit scheduled model Harness requires a supported Harness and model' },
    { ok: false, message: 'Collaborative tasks cannot switch to or from a plugin engine' },
    {
      ok: false,
      errorCode: 'INVALID_ARGS',
      data: {
        validation_errors: [
          { path: ['modelAgentKind'], message: "Invalid enum value. Expected 'claude-code' | 'codex' | 'pi', received 'acp'" },
        ],
      },
    },
  ];
  for (const rejection of hostRejections) {
    const r = runtime(false, { route, label: 'Gemini 4 Neon · Antigravity' }, true, (args) => {
      if (args.modelAgentKind === 'acp' && args.targetSessionId) return rejection;
      return null;
    });
    const view = await r.show({ mr: url, published: true });
    assert.equal(view.follow_state, 'active');
    assert.equal(view.follow_model_fallback, true);
    assert.match(view.note ?? '', /follow-up started with this task's current model/);
    assert.match(view.html, /follow-up started with this task&#39;s current model|follow-up started with this task's current model/);
    assert.equal(r.createAttempts.length, 2);
    assert.equal(r.createAttempts[0].modelAgentKind, 'acp');
    assert.equal(r.createAttempts[0].targetSessionId, 's1');
    assert.equal(r.createAttempts[1].modelAgentKind, undefined);
    assert.equal(r.createAttempts[1].model, undefined);
    assert.equal(r.createAttempts[1].providerId, undefined);
    assert.equal(r.createAttempts[1].modelAgentDeviceId, undefined);
    assert.equal(r.createAttempts[1].targetSessionId, 's1');
    assert.equal(r.schedules.size, 1);
    assert.equal(r.schedules.get('schedule')?.modelAgentKind, undefined);
    // Refreshing while active keeps the fallback notice; stopping clears it.
    const refreshed = await r.show({ card_id: view.card_id });
    assert.equal(refreshed.follow_model_fallback, true);
    assert.match(refreshed.note ?? '', /follow-up started with this task's current model/);
    await r.click(refreshed.anchor, 'pr:stop');
    assert.equal(r.schedules.size, 0);
    assert.doesNotMatch(r.lastCard().html, /follow-up started with this task/);
  }
});

test('bound ACP follow-up fails closed on non-compatibility errors and never falls back for non-ACP overrides', async () => {
  const acpRoute = {
    agentKind: 'acp',
    providerId: 'acp-plugin:antigravity:agy',
    model: 'gemini-4-neon',
    effort: 'high',
    fastMode: false,
  };
  for (const errorBody of [
    { ok: false, message: 'Plugin engine is currently unavailable' },
    { ok: false, message: 'A plugin engine schedule cannot use a persistent session' },
    { ok: false, errorCode: 'INVALID_ARGS', data: { validation_errors: [{ path: ['cronExpr'], message: 'Invalid cron' }] } },
  ]) {
    const r = runtime(false, { route: acpRoute, label: 'Gemini 4 Neon · Antigravity' }, true, () => errorBody);
    const view = await r.show({ mr: url, published: true });
    assert.equal(view.follow_state, 'failed');
    assert.equal(r.createAttempts.length, 1);
    assert.equal(r.schedules.size, 0);
  }

  const codexRoute = {
    agentKind: 'codex',
    providerId: 'openai',
    model: 'gpt-5.6',
    effort: 'high',
    fastMode: false,
  };
  const rCodex = runtime(false, { route: codexRoute, label: 'GPT-5.6' }, true, () => ({
    ok: false,
    message: 'A plugin engine schedule starts a new task each run',
  }));
  const viewCodex = await rCodex.show({ mr: url, published: true });
  assert.equal(viewCodex.follow_state, 'failed');
  assert.equal(rCodex.createAttempts.length, 1);
  assert.equal(rCodex.schedules.size, 0);
});

test('plugin-engine (acp) follow models are preserved in agent handoff when native scheduler is absent', async () => {
  const route = {
    agentKind: 'acp',
    providerId: 'acp-plugin:antigravity:agy',
    model: 'gemini-4-neon',
    effort: 'high',
    fastMode: false,
    agentDeviceId: 'mac-mini',
  };
  const r = runtime(false, { route, label: 'Gemini 4 Neon · Antigravity' }, false);
  const view = await r.show({ mr: url });
  await r.click(view.anchor, 'pr:follow');
  assert.equal(r.handoffs.length, 1);
  assert.deepEqual({ ...r.handoffs[0].event.follow_model }, {
    model_agent_kind: 'acp',
    provider_id: 'acp-plugin:antigravity:agy',
    model: 'gemini-4-neon',
    effort: 'high',
    fast_mode: false,
    label: 'Gemini 4 Neon · Antigravity',
    agent_device_id: 'mac-mini',
  });
});

test('live MR follow-up schedule in another task resolves to existing_task even when its peer card is missing', async () => {
  const r = runtime();
  const opened = await r.show({ mr: url, published: true }, 's-owner');
  assert.equal(opened.follow_state, 'active');
  assert.equal(r.schedules.size, 1);

  // Simulate the owning task's card being evicted/absent while its schedule keeps running.
  r.files.delete('mr-cards/' + opened.card_id + '.json');

  const viewed = await r.show({ mr: url }, 's-other');
  assert.equal(viewed.disposition, 'existing_task');
  assert.equal(viewed.owner_session_id, 's-owner');
  assert.equal(viewed.task_url, 'cindy://session/s-owner');
  assert.equal(viewed.follow_claimed, false);
  assert.match(viewed.html, /cindy:\/\/session\/s-owner/);
  assert.doesNotMatch(viewed.html, /data-ghost-action="pr:follow"/);

  // Legacy client fallback click on "Open follow-up task" resolves the live schedule owner.
  await r.click(viewed.anchor, 'pr:open-task', { sessionId: 's-other' });
  assert.equal(r.handoffs.length, 1);
  assert.equal(r.handoffs[0].event.action, 'open-task');
  assert.equal(r.handoffs[0].event.task_url, 'cindy://session/s-owner');

  // Clicking follow or calling published: true in another task stays read-only and creates no duplicate.
  await r.click(viewed.anchor, 'pr:follow', { sessionId: 's-other' });
  const pub = await r.show({ mr: url, published: true }, 's-third');
  assert.equal(pub.disposition, 'existing_task');
  assert.equal(pub.owner_session_id, 's-owner');
  assert.equal(r.schedules.size, 1);
});

test('unrecognized or ambiguous foreign MR schedules still fail closed without misdirecting', async () => {
  const r = runtime();
  r.schedules.set('custom', {
    id: 'custom', targetSessionId: 's-other', recurring: true, status: 'active',
    prTrigger: { url, change: 'any' }, prompt: 'Custom reminder for ' + url,
  });
  const pub = await r.show({ mr: url, published: true }, 's-orig');
  assert.equal(pub.disposition, undefined);
  assert.equal(pub.follow_state, 'failed');
  assert.equal(r.schedules.size, 1);
});
