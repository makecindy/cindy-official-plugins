import assert from 'node:assert/strict';
import test from 'node:test';

import { botKey, botsAnswered, breaksSettle, expectedBots, pacingDue, settleState, updateRepoBots } from '../../cindy-github/skills/pr/scripts/lib/follow-pacing.mjs';

const T0 = Date.parse('2026-11-06T00:00:00Z');
const MIN = 60_000;
const watch = (extra = {}) => ({ failedChecks: [], conflicting: false, isDraft: false, queueProblems: [], ...extra });
const looked = (extra = {}) => ({ watch: watch(extra.watch), lastFullReadAt: T0, ...extra, ...(extra.watch ? { watch: watch(extra.watch) } : {}) });

test('pacing: each stage looks at its own interval; fast reasons look every tick', () => {
  const at = (previous, minutes) => pacingDue(previous, T0 + minutes * MIN);
  assert.equal(at(null, 0).due, true, 'first check');
  assert.equal(pacingDue(looked(), T0 + MIN, { triggered: true }).reason, 'host-trigger');
  // idle: every 10 minutes
  // (a firing may come up to a minute early: the schedule never fires exactly on time)
  assert.equal(at(looked(), 8).due, false);
  assert.equal(at(looked(), 9).due, true);
  // active: checks running, failing, conflicting, a recent push or agent round
  for (const extra of [{ inFlight: true }, { watch: { failedChecks: ['build'] } }, { watch: { conflicting: true } }, { headSeenAt: T0 - 10 * MIN }, { lastPassAt: T0 - 10 * MIN }]) {
    assert.equal(at(looked(extra), 3).due, false, JSON.stringify(extra));
    assert.equal(at(looked(extra), 5).pace, 'active', JSON.stringify(extra));
    assert.equal(at(looked(extra), 5).due, true, JSON.stringify(extra));
  }
  // Review (Greptile P2 on #287): consecutive 5-minute firings, even a few seconds early, must each look
  // while a PR is active; an interval longer than the schedule would silently halve the frequency.
  for (const jitter of [0, 20_000, 55_000]) {
    for (let tick = 1; tick <= 4; tick += 1) {
      const previous = looked({ inFlight: true });
      assert.equal(pacingDue({ ...previous, lastFullReadAt: T0 + (tick - 1) * 5 * MIN }, T0 + tick * 5 * MIN - jitter).due, true, `tick ${tick} jitter ${jitter}`);
    }
  }
  // waiting for a human: every 30 minutes
  assert.equal(at(looked({ verdict: 'READY' }), 28).due, false);
  assert.equal(at(looked({ verdict: 'BLOCKED_HUMAN' }), 29).due, true);
  assert.equal(at(looked({ humanOnlyPending: true }), 28).pace, 'waiting');
  // quiet: drafts, or nothing changed for six hours
  assert.equal(at(looked({ watch: { isDraft: true } }), 58).due, false);
  assert.equal(at(looked({ lastChangeAt: T0 - 7 * 60 * MIN }), 59).due, true);
  // fast: unacknowledged update, defer due, no-checks deadline due, settle window open
  for (const extra of [{ pendingWatch: {} }, { nextAllowAt: T0 }, { watch: { checksAwaitedSince: new Date(T0 - 20 * MIN).toISOString() } }, { settleUntil: T0 + 10 * MIN }, { settleUntil: T0 - MIN }]) {
    assert.equal(at(looked({ verdict: 'READY', ...extra }), 1).due, true, JSON.stringify(extra));
  }
});

test('settle: expected bots answer by a submitted review on the head or a thumbs-up reaction', () => {
  assert.equal(botKey('chatgpt-codex-connector[bot]'), 'chatgpt-codex-connector');
  const repoBots = updateRepoBots({ stale: T0 - 30 * 24 * 60 * MIN }, { reviews: [{ author: 'greptile-apps', authorIsBot: true, submittedAt: new Date(T0 - 60 * MIN).toISOString() }] }, T0);
  assert.deepEqual(Object.keys(repoBots), ['greptile-apps'], 'bots unseen for 14 days drop out');
  assert.equal(repoBots['greptile-apps'], T0 - 60 * MIN, 'recorded at the review time, not at the read time');
  // Review (Greptile P2 on #287): an old PR that still shows a retired bot's review must not renew it.
  const retired = { reviews: [{ author: 'old-bot', authorIsBot: true, submittedAt: new Date(T0 - 20 * 24 * 60 * MIN).toISOString() }] };
  assert.deepEqual(updateRepoBots({}, retired, T0), {});
  assert.deepEqual(updateRepoBots({ 'old-bot': T0 - 13 * 24 * 60 * MIN }, retired, T0), { 'old-bot': T0 - 13 * 24 * 60 * MIN }, 'the record keeps its own newer time');
  const expected = expectedBots({ snap: { reactions: [{ author: 'chatgpt-codex-connector[bot]' }] }, previous: { reviewerBots: ['coderabbitai'] }, repoBots, viewer: 'coderabbitai' });
  assert.deepEqual(expected, ['chatgpt-codex-connector', 'greptile-apps'], 'the viewer is never waited for');

  const head = 'bbb';
  const seen = T0;
  const base = { latestCommitOid: head };
  assert.deepEqual(settleState({ snap: base, headSeenAt: seen, expected, now: T0 + MIN }).waiting, expected);
  const answered = {
    ...base,
    reviews: [{ author: 'greptile-apps', state: 'COMMENTED', commitOid: head, submittedAt: new Date(T0 - 60 * MIN).toISOString() }],
    reactions: [{ author: 'chatgpt-codex-connector[bot]', content: 'THUMBS_UP', at: new Date(T0 + 2 * MIN).toISOString() }],
  };
  assert.deepEqual(botsAnswered(answered, expected, head, seen), expected);
  assert.equal(settleState({ snap: answered, headSeenAt: seen, expected, now: T0 + 3 * MIN }).open, false);
  // Review (Codex P2, Greptile P1 on #287): a review that names an older commit answers for that commit
  // only, however recently it was submitted.
  const stale = { ...base, reviews: [{ author: 'greptile-apps', state: 'COMMENTED', commitOid: 'aaa', submittedAt: new Date(T0 + MIN).toISOString() }] };
  assert.deepEqual(botsAnswered(stale, expected, head, seen - 5 * MIN), []);
  assert.deepEqual(botsAnswered({ ...base, reviews: [{ author: 'greptile-apps', state: 'COMMENTED', submittedAt: new Date(T0 + MIN).toISOString() }] }, expected, head, seen), ['greptile-apps'], 'no commit named: the time decides');
  // An old reaction from the previous round does not count.
  const old = { ...base, reactions: [{ author: 'chatgpt-codex-connector[bot]', content: 'THUMBS_UP', at: new Date(T0 - 30 * MIN).toISOString() }] };
  assert.deepEqual(botsAnswered(old, expected, head, seen - 5 * MIN), []);
  // The window closes after 20 minutes even if bots never answer.
  assert.equal(settleState({ snap: base, headSeenAt: seen, expected, now: T0 + 20 * MIN }).open, false);
  assert.equal(settleState({ snap: base, headSeenAt: seen, expected: [], now: T0 + MIN }).open, false, 'nothing to wait for');
});

test('settle: only people, the merge queue and draft changes break the wait', () => {
  assert.equal(breaksSettle([{ kind: 'checks-failed' }, { kind: 'remarks', remarks: [{ authorIsBot: true }] }]), false);
  assert.equal(breaksSettle([{ kind: 'remarks', remarks: [{ authorIsBot: false }] }]), true);
  for (const kind of ['merge-queue', 'draft-entered', 'draft-exited']) assert.equal(breaksSettle([{ kind }]), true, kind);
});

test('settle: pending reviews, status comments, inline findings and EYES are not completion evidence', () => {
  const head = 'new-head';
  const at = new Date(T0 + MIN).toISOString();
  const bot = 'review-bot';
  const snap = {
    latestCommitOid: head,
    reviews: [{ author: bot, state: 'PENDING', commitOid: head, submittedAt: at }],
    comments: [{ author: bot, createdAt: at, body: 'Running' }],
    reviewThreads: { nodes: [{ comments: [{ author: bot, createdAt: at, body: 'Partial finding' }] }] },
    reactions: [{ author: bot, at, content: 'EYES' }],
  };
  assert.deepEqual(botsAnswered(snap, [bot], head, T0), []);
  assert.equal(settleState({ snap, headSeenAt: T0, expected: [bot], now: T0 + 19 * MIN }).open, true);
  assert.equal(settleState({ snap, headSeenAt: T0, expected: [bot], now: T0 + 20 * MIN }).open, false);
  snap.comments[0].body = 'Unknown bot final summary';
  assert.deepEqual(botsAnswered(snap, [bot], head, T0), [], 'unstructured content cannot prove completion');
  for (const state of ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']) {
    snap.reviews[0].state = state;
    assert.deepEqual(botsAnswered(snap, [bot], head, T0), [bot]);
  }
});

test('bot check completion uses app identity, current head and latest successful attempt', () => {
  const c = { name: 'Review', appSlug: 'review-bot', appId: 42, headSha: 'head', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: new Date(T0).toISOString(), completedAt: new Date(T0 + MIN).toISOString() };
  const answered = checks => botsAnswered({ reviewerChecks: checks }, ['review-bot'], 'head', T0);
  assert.deepEqual(answered([c]), ['review-bot']);
  for (const patch of [{headSha:'old'}, {appSlug:'other'}, {appId:null}, {status:'IN_PROGRESS'}, {conclusion:'FAILURE'}, {conclusion:'CANCELLED'}, {conclusion:'SKIPPED'}, {completedAt:null}]) {
    assert.deepEqual(answered([{...c,...patch}]), [], JSON.stringify(patch));
  }
  const newer = {...c, startedAt:new Date(T0+2*MIN).toISOString(), status:'IN_PROGRESS', conclusion:null};
  assert.deepEqual(answered([c,newer]), []);
  assert.deepEqual(answered([{...c,conclusion:'FAILURE'}, {...newer,status:'COMPLETED',conclusion:'SUCCESS',completedAt:new Date(T0+3*MIN).toISOString()}]), ['review-bot']);
  assert.deepEqual(botsAnswered({reviewerChecks:[c],checksSummary:{unavailable:true}}, ['review-bot'], 'head', T0), []);
});

test('a queued bot rerun without a start time keeps the earlier success from counting', () => {
  const c = { name: 'Review', appSlug: 'review-bot', appId: 42, headSha: 'head', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: new Date(T0).toISOString(), completedAt: new Date(T0 + MIN).toISOString() };
  const answered = checks => botsAnswered({ reviewerChecks: checks }, ['review-bot'], 'head', T0);
  for (const status of ['QUEUED', 'PENDING', 'WAITING']) {
    assert.deepEqual(answered([c, { ...c, status, conclusion: null, startedAt: null, completedAt: null }]), [], status);
  }
  assert.deepEqual(answered([c, { ...c, name: 'Other', status: 'QUEUED', conclusion: null, startedAt: null, completedAt: null }]), [], 'another queued check of the same app also blocks');
  assert.deepEqual(answered([c, { ...c, status: 'COMPLETED', conclusion: 'CANCELLED', startedAt: null, completedAt: null }]), ['review-bot'], 'a finished run that never started is not pending');
});
