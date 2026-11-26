import assert from 'node:assert/strict';
import test from 'node:test';

import { REVIEWER_BOTS_VERSION, botKey, botsAnswered, breaksSettle, expectedBots, pacingDue, resolvePrReviewerBots, reviewerBotsOf, settleState, uncorroboratedApprovalCommits, updateRepoBots } from '../../cindy-github/skills/pr/scripts/lib/follow-pacing.mjs';

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
  assert.equal(breaksSettle([{ kind: 'remarks', remarks: [{ authorIsBot: false, state: 'APPROVED', body: '' }] }]), false);
  assert.equal(breaksSettle([{ kind: 'remarks', remarks: [{ authorIsBot: false, state: 'APPROVED', body: 'rename this' }] }]), true);
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

test('approval-only and auto-merge bots are not recorded as expected reviewer bots', () => {
  const at = new Date(T0 - 10 * MIN).toISOString();
  const autoMergeSnap = {
    reviews: [
      { author: 'cindy-auto-merge-bot', authorIsBot: true, state: 'APPROVED', body: 'Catalog checks verified.', submittedAt: at },
      { author: 'stale-approver', authorIsBot: true, state: 'DISMISSED', body: '', submittedAt: at },
      { author: 'draft-bot', authorIsBot: true, state: 'PENDING', body: '', submittedAt: at },
      { author: 'github-actions', authorIsBot: true, state: 'APPROVED', body: 'Auto-approved', submittedAt: at },
    ],
    reviewerChecks: [
      { name: 'CI', appSlug: 'github-actions', appId: 15368, headSha: 'h1', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: at, completedAt: at },
    ],
  };
  assert.deepEqual([...reviewerBotsOf(autoMergeSnap)], []);
  assert.deepEqual(updateRepoBots({}, autoMergeSnap, T0), {});
  // Legacy repo cache entry is not renewed by uncorroborated APPROVED reviews.
  const oldAt = T0 - 13 * 24 * 60 * MIN;
  assert.deepEqual(updateRepoBots({ 'cindy-auto-merge-bot': oldAt }, autoMergeSnap, T0), { 'cindy-auto-merge-bot': oldAt });

  // Corroborated reviewer bots submitting APPROVED still count:
  // 1) dedicated reviewer GitHub App check run (e.g. Greptile approving a clean PR)
  const cleanGreptile = {
    reviews: [{ author: 'greptile-apps', authorIsBot: true, state: 'APPROVED', body: 'LGTM', submittedAt: at }],
    reviewerChecks: [{ name: 'Greptile Review', appSlug: 'greptile-apps', appId: 99, headSha: 'h1', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: at, completedAt: at }],
  };
  assert.deepEqual([...reviewerBotsOf(cleanGreptile)], ['greptile-apps']);
  assert.deepEqual(updateRepoBots({}, cleanGreptile, T0), { 'greptile-apps': T0 - 10 * MIN });

  // 2) inline review thread comment alongside APPROVED
  const inlineApprover = {
    reviews: [{ author: 'code-bot', authorIsBot: true, state: 'APPROVED', body: 'Minor nit', submittedAt: at }],
    reviewThreads: { nodes: [{ comments: [{ author: 'code-bot', authorIsBot: true, body: 'nit' }] }] },
  };
  assert.deepEqual([...reviewerBotsOf(inlineApprover)], ['code-bot']);
  assert.deepEqual(updateRepoBots({}, inlineApprover, T0), { 'code-bot': T0 - 10 * MIN });

  // 3) COMMENTED / CHANGES_REQUESTED reviews count directly; botsAnswered still accepts APPROVED for expected bots.
  const activeReviewers = {
    latestCommitOid: 'h2',
    reviews: [
      { author: 'reviewer-a', authorIsBot: true, state: 'COMMENTED', submittedAt: at },
      { author: 'reviewer-b', authorIsBot: true, state: 'CHANGES_REQUESTED', submittedAt: at },
      { author: 'greptile-apps', authorIsBot: true, state: 'APPROVED', commitOid: 'h2', submittedAt: new Date(T0 + MIN).toISOString() },
    ],
  };
  assert.deepEqual([...reviewerBotsOf(activeReviewers)].sort(), ['reviewer-a', 'reviewer-b']);
  assert.deepEqual(botsAnswered(activeReviewers, ['greptile-apps'], 'h2', T0), ['greptile-apps']);
});

test('legacy per-PR reviewerBots drops verified approval-only bots while keeping real reviewers across pushes', () => {
  const oldAt = new Date(T0 - 20 * 24 * 60 * MIN).toISOString();
  const autoOnlyVerifiedSnap = {
    latestCommitOid: 'bbb2222',
    reviews: [{ author: 'cindy-auto-merge-bot', authorIsBot: true, state: 'APPROVED', body: 'ok', commitOid: 'aaa1111', submittedAt: oldAt }],
    reviewerChecks: [],
    reviewCommitChecks: { aaa1111: [{ appSlug: 'github-actions', appId: 15368 }] },
  };
  const repoBots = updateRepoBots({}, autoOnlyVerifiedSnap, T0);
  assert.deepEqual(repoBots, {});

  // Legacy state with verified historical commit checks showing no reviewer App: drops cindy-auto-merge-bot.
  const legacyOnly = { reviewerBots: ['cindy-auto-merge-bot'] };
  const expected = expectedBots({ snap: autoOnlyVerifiedSnap, previous: legacyOnly, repoBots });
  assert.deepEqual(expected, []);
  assert.equal(settleState({ snap: autoOnlyVerifiedSnap, headSeenAt: T0, expected, now: T0 + MIN }).open, false);
  assert.deepEqual(resolvePrReviewerBots(legacyOnly, autoOnlyVerifiedSnap), { bots: [], version: REVIEWER_BOTS_VERSION });

  // Current-head APPROVED without own App check drops even without reviewCommitChecks.
  const autoCurrentHead = {
    latestCommitOid: 'bbb2222',
    reviews: [{ author: 'cindy-auto-merge-bot', authorIsBot: true, state: 'APPROVED', body: 'ok', commitOid: 'bbb2222', submittedAt: oldAt }],
    reviewerChecks: [],
  };
  assert.deepEqual(resolvePrReviewerBots(legacyOnly, autoCurrentHead), { bots: [], version: REVIEWER_BOTS_VERSION });

  // Real reviewer (Greptile) approved an older head with its own App check, new head has no checks yet:
  // 1) with historical commit check evidence -> keeps Greptile, drops cindy-auto-merge-bot, migrates to v2.
  const mixedHistoricalSnap = {
    latestCommitOid: 'bbb2222',
    reviews: [
      { author: 'cindy-auto-merge-bot', authorIsBot: true, state: 'APPROVED', body: 'ok', commitOid: 'aaa1111', submittedAt: oldAt },
      { author: 'greptile-apps', authorIsBot: true, state: 'APPROVED', body: 'LGTM', commitOid: 'aaa1111', submittedAt: oldAt },
    ],
    reviewerChecks: [],
    reviewCommitChecks: {
      aaa1111: [
        { appSlug: 'greptile-apps', appId: 99 },
        { appSlug: 'github-actions', appId: 15368 },
      ],
    },
  };
  const legacyMixed = { reviewerBots: ['cindy-auto-merge-bot', 'greptile-apps'] };
  const mixedExpected = expectedBots({ snap: mixedHistoricalSnap, previous: legacyMixed, repoBots: {} });
  assert.deepEqual(mixedExpected, ['greptile-apps']);
  assert.equal(settleState({ snap: mixedHistoricalSnap, headSeenAt: T0, expected: mixedExpected, now: T0 + MIN }).open, true);
  assert.deepEqual(resolvePrReviewerBots(legacyMixed, mixedHistoricalSnap), { bots: ['greptile-apps'], version: REVIEWER_BOTS_VERSION });

  // 2) without historical commit check data for aaa1111 -> conservatively retains legacy bot and leaves migration at v1.
  const unverifiedOlderSnap = {
    latestCommitOid: 'bbb2222',
    reviews: [{ author: 'greptile-apps', authorIsBot: true, state: 'APPROVED', body: 'LGTM', commitOid: 'aaa1111', submittedAt: oldAt }],
    reviewerChecks: [],
  };
  const legacyGreptile = { reviewerBots: ['greptile-apps'] };
  const retainedExpected = expectedBots({ snap: unverifiedOlderSnap, previous: legacyGreptile, repoBots: {} });
  assert.deepEqual(retainedExpected, ['greptile-apps']);
  assert.equal(settleState({ snap: unverifiedOlderSnap, headSeenAt: T0, expected: retainedExpected, now: T0 + MIN }).open, true);
  assert.deepEqual(resolvePrReviewerBots(legacyGreptile, unverifiedOlderSnap), { bots: ['greptile-apps'], version: 1 });
  assert.deepEqual(uncorroboratedApprovalCommits(unverifiedOlderSnap), ['aaa1111']);
  assert.deepEqual(uncorroboratedApprovalCommits(mixedHistoricalSnap), []);

  // Incomplete/truncated snapshot: preserves legacy list and leaves migration pending.
  const truncatedSnap = { ...autoOnlyVerifiedSnap, checksSummary: { unavailable: true } };
  assert.deepEqual(resolvePrReviewerBots(legacyOnly, truncatedSnap), { bots: ['cindy-auto-merge-bot'], version: 1 });

  // Vetted v2 state: keeps previously verified reviewer bot even before checks register on a new head.
  const v2Prev = { reviewerBots: ['greptile-apps'], reviewerBotsVersion: REVIEWER_BOTS_VERSION };
  assert.deepEqual(expectedBots({ snap: unverifiedOlderSnap, previous: v2Prev, repoBots: {} }), ['greptile-apps']);
  assert.deepEqual(resolvePrReviewerBots(v2Prev, unverifiedOlderSnap), { bots: ['greptile-apps'], version: REVIEWER_BOTS_VERSION });

  // Partial historical check page (`complete: false`): proved App on page 1 still corroborates its
  // bot, while uncorroborated bots on that incomplete commit stay conservatively retained at v1.
  const partialPageSnap = {
    latestCommitOid: 'bbb2222',
    reviews: [
      { author: 'greptile-apps', authorIsBot: true, state: 'APPROVED', body: 'LGTM', commitOid: 'aaa1111', submittedAt: oldAt },
      { author: 'cindy-auto-merge-bot', authorIsBot: true, state: 'APPROVED', body: 'ok', commitOid: 'aaa1111', submittedAt: oldAt },
    ],
    reviewerChecks: [],
    reviewCommitChecks: {
      aaa1111: { complete: false, apps: [{ appSlug: 'greptile-apps', appId: 99 }] },
    },
  };
  assert.deepEqual([...reviewerBotsOf(partialPageSnap)], ['greptile-apps']);
  assert.deepEqual(
    resolvePrReviewerBots({ reviewerBots: ['cindy-auto-merge-bot', 'greptile-apps'] }, partialPageSnap),
    { bots: ['cindy-auto-merge-bot', 'greptile-apps'], version: 1 },
  );
  assert.deepEqual(uncorroboratedApprovalCommits(partialPageSnap), ['aaa1111']);

  // More than 10 historical approval commits are all returned (not truncated at 10).
  const elevenOids = Array.from({ length: 11 }, (_, i) => `10000000000000000000000000000000000000${String(i).padStart(2, '0')}`);
  const elevenSnap = {
    latestCommitOid: 'bbb2222',
    reviews: elevenOids.map((oid) => ({ author: 'cindy-auto-merge-bot', authorIsBot: true, state: 'APPROVED', body: 'ok', commitOid: oid, submittedAt: oldAt })),
    reviewerChecks: [],
  };
  assert.deepEqual(uncorroboratedApprovalCommits(elevenSnap), elevenOids);
});
