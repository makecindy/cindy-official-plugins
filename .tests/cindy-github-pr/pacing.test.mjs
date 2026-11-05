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
  assert.equal(at(looked(), 9).due, false);
  assert.equal(at(looked(), 10).due, true);
  // active: checks running, failing, conflicting, a recent push or agent round
  for (const extra of [{ inFlight: true }, { watch: { failedChecks: ['build'] } }, { watch: { conflicting: true } }, { headSeenAt: T0 - 10 * MIN }, { lastPassAt: T0 - 10 * MIN }]) {
    assert.equal(at(looked(extra), 5).due, false, JSON.stringify(extra));
    assert.equal(at(looked(extra), 6).pace, 'active', JSON.stringify(extra));
    assert.equal(at(looked(extra), 6).due, true, JSON.stringify(extra));
  }
  // waiting for a human: every 30 minutes
  assert.equal(at(looked({ verdict: 'READY' }), 29).due, false);
  assert.equal(at(looked({ verdict: 'BLOCKED_HUMAN' }), 30).due, true);
  assert.equal(at(looked({ humanOnlyPending: true }), 29).pace, 'waiting');
  // quiet: drafts, or nothing changed for six hours
  assert.equal(at(looked({ watch: { isDraft: true } }), 59).due, false);
  assert.equal(at(looked({ lastChangeAt: T0 - 7 * 60 * MIN }), 60).due, true);
  // fast: unacknowledged update, defer due, no-checks deadline due, settle window open
  for (const extra of [{ pendingWatch: {} }, { nextAllowAt: T0 }, { watch: { checksAwaitedSince: new Date(T0 - 20 * MIN).toISOString() } }, { settleUntil: T0 + 10 * MIN }]) {
    assert.equal(at(looked({ verdict: 'READY', ...extra }), 1).due, true, JSON.stringify(extra));
  }
});

test('settle: expected bots answer by a review on the head, a later comment or a reaction', () => {
  assert.equal(botKey('chatgpt-codex-connector[bot]'), 'chatgpt-codex-connector');
  const repoBots = updateRepoBots({ stale: T0 - 30 * 24 * 60 * MIN }, { reviews: [{ author: 'greptile-apps', authorIsBot: true }] }, T0);
  assert.deepEqual(Object.keys(repoBots), ['greptile-apps'], 'bots unseen for 14 days drop out');
  const expected = expectedBots({ snap: { reactions: [{ author: 'chatgpt-codex-connector[bot]' }] }, previous: { reviewerBots: ['coderabbitai'] }, repoBots, viewer: 'coderabbitai' });
  assert.deepEqual(expected, ['chatgpt-codex-connector', 'greptile-apps'], 'the viewer is never waited for');

  const head = 'bbb';
  const seen = T0;
  const base = { latestCommitOid: head };
  assert.deepEqual(settleState({ snap: base, headSeenAt: seen, expected, now: T0 + MIN }).waiting, expected);
  const answered = {
    ...base,
    reviews: [{ author: 'greptile-apps', commitOid: head, submittedAt: new Date(T0 - 60 * MIN).toISOString() }],
    reactions: [{ author: 'chatgpt-codex-connector[bot]', at: new Date(T0 + 2 * MIN).toISOString() }],
  };
  assert.deepEqual(botsAnswered(answered, expected, head, seen), expected);
  assert.equal(settleState({ snap: answered, headSeenAt: seen, expected, now: T0 + 3 * MIN }).open, false);
  // An old reaction from the previous round does not count.
  const old = { ...base, reactions: [{ author: 'chatgpt-codex-connector[bot]', at: new Date(T0 - 30 * MIN).toISOString() }] };
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
