import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  attemptAutoMerge,
  hasBlockedAutoMergeAttempt,
  isSnapshotEligibleForAutoMerge,
  matchAutoMergePolicy,
  readAutoMergePolicy,
  verifyLivePrMergeTarget,
} from '../../cindy-github/skills/pr/scripts/lib/auto-merge.mjs';
import { runGate } from '../../cindy-github/skills/pr/scripts/pr-heartbeat-gate.mjs';

const require = createRequire(import.meta.url);
const followNode = require('../../cindy-github/node/follow.cjs');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function makeTempDir(prefix = 'cindy-pr-automerge-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeReadySnapshot(overrides = {}) {
  return {
    repo: 'octo/repo',
    number: 122,
    url: 'https://github.com/octo/repo/pull/122',
    state: 'OPEN',
    closed: false,
    merged: false,
    isDraft: false,
    viewer: 'dash',
    baseRefName: 'main',
    headRefName: 'feat/fix',
    latestCommitOid: SHA_A,
    updatedAt: '2026-11-28T00:00:00Z',
    createdAt: '2026-11-27T20:00:00Z',
    mergeable: true,
    mergeStateStatus: 'CLEAN',
    mergeQueue: { status: 'NONE', blockers: [] },
    verdict: 'READY',
    blockers: [],
    gate: { truncated: false, requiredChecksUnavailable: false },
    checksSummary: {
      total: 2,
      totalCount: 2,
      passed: 2,
      pending: 0,
      failed: 0,
      actionRequired: 0,
      unavailable: false,
      truncated: false,
      pendingRuns: [],
      failingRuns: [],
      actionRequiredRuns: [],
    },
    checks: [
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', required: true },
      { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', required: true },
    ],
    reviewThreads: {
      totalCount: 0,
      activeUnresolvedCount: 0,
      outdatedUnresolvedCount: 0,
      rawUnresolvedCount: 0,
      truncated: false,
      nodes: [],
    },
    reviews: [],
    comments: [],
    ...overrides,
  };
}

test('node/follow.cjs policy store validates inputs, scopes per-PR and single-repo, and clears cleanly', () => {
  const dir = makeTempDir();
  try {
    assert.deepEqual(followNode.readAutoMergePolicy(dir), { version: 1, prs: {}, repos: {} });

    followNode.updateAutoMergePolicyFile(
      { op: 'set-pr', repo: 'Octo/Repo', number: 122, actor: 'Dash', base: 'main', method: 'squash', authorizedAt: 1000 },
      dir,
    );
    followNode.updateAutoMergePolicyFile(
      { op: 'set-repo', repo: 'Octo/Repo-A', actor: 'Dash', authorizedAt: 2000 },
      dir,
    );

    const policy = readAutoMergePolicy(dir);
    assert.equal(policy.prs['octo/repo#122'].actor, 'dash');
    assert.equal(policy.prs['octo/repo#122'].method, 'squash');
    assert.equal(policy.repos['octo/repo-a'].actor, 'dash');

    // Exact match vs cross-repo / actor / base isolation.
    assert.equal(matchAutoMergePolicy(policy, { repo: 'octo/repo', number: 122, viewer: 'dash', baseRefName: 'main' })?.scope, 'pr');
    assert.equal(matchAutoMergePolicy(policy, { repo: 'octo/repo', number: 122, viewer: 'other-user', baseRefName: 'main' }), null);
    assert.equal(matchAutoMergePolicy(policy, { repo: 'octo/repo', number: 122, viewer: 'dash', baseRefName: 'release' }), null);
    assert.equal(matchAutoMergePolicy(policy, { repo: 'octo/repo-a', number: 5, viewer: 'dash', baseRefName: 'main' })?.scope, 'repo');
    assert.equal(matchAutoMergePolicy(policy, { repo: 'octo/repo-b', number: 5, viewer: 'dash', baseRefName: 'main' }), null);

    // Invalid inputs fail closed.
    assert.throws(() => followNode.updateAutoMergePolicyFile({ op: 'set-repo', repo: 'not a repo', actor: 'dash' }, dir));
    assert.throws(() => followNode.updateAutoMergePolicyFile({ op: 'set-pr', repo: 'octo/repo', number: -1, actor: 'dash', base: 'main' }, dir));
    assert.throws(() => followNode.updateAutoMergePolicyFile({ op: 'set-repo', repo: 'octo/repo', actor: 'bad actor!' }, dir));

    followNode.updateAutoMergePolicyFile({ op: 'clear-pr', repo: 'octo/repo', number: 122 }, dir);
    followNode.updateAutoMergePolicyFile({ op: 'clear-repo', repo: 'octo/repo-a' }, dir);
    assert.deepEqual(readAutoMergePolicy(dir), { version: 1, prs: {}, repos: {} });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isSnapshotEligibleForAutoMerge fails closed on every incomplete or unready condition', () => {
  assert.equal(isSnapshotEligibleForAutoMerge(makeReadySnapshot(), { open: false }), true);
  assert.equal(isSnapshotEligibleForAutoMerge(makeReadySnapshot(), { open: true }), false);
  assert.equal(isSnapshotEligibleForAutoMerge(makeReadySnapshot({ isDraft: true }), { open: false }), false);
  assert.equal(isSnapshotEligibleForAutoMerge(makeReadySnapshot({ verdict: 'NEEDS_WORK' }), { open: false }), false);
  assert.equal(isSnapshotEligibleForAutoMerge(makeReadySnapshot({ gate: { truncated: false, requiredChecksUnavailable: true } }), { open: false }), false);
  assert.equal(isSnapshotEligibleForAutoMerge(makeReadySnapshot({ checksSummary: { ...makeReadySnapshot().checksSummary, pending: 1 } }), { open: false }), false);
  assert.equal(isSnapshotEligibleForAutoMerge(makeReadySnapshot({ reviewThreads: { ...makeReadySnapshot().reviewThreads, outdatedUnresolvedCount: 1 } }), { open: false }), false);
  assert.equal(isSnapshotEligibleForAutoMerge(makeReadySnapshot({ mergeStateStatus: 'BLOCKED' }), { open: false }), false);
  assert.equal(isSnapshotEligibleForAutoMerge(makeReadySnapshot({ mergeable: null }), { open: false }), false);
  assert.equal(isSnapshotEligibleForAutoMerge(makeReadySnapshot({ mergeQueue: null }), { open: false }), false);
  assert.equal(isSnapshotEligibleForAutoMerge(makeReadySnapshot({ mergeQueue: { id: 'mq-1' } }), { open: false }), false);
});

test('verifyLivePrMergeTarget checks actor, permissions, head SHA, base branch, and rulesets', async () => {
  const validGraphQL = async () => ({
    data: {
      viewer: { id: 'V1', login: 'dash' },
      repository: {
        id: 'R1',
        viewerPermission: 'WRITE',
        viewerDefaultMergeMethod: 'SQUASH',
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: false,
        pullRequest: {
          id: 'PR1',
          state: 'OPEN',
          isDraft: false,
          merged: false,
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN',
          headRefOid: SHA_A,
          mergeQueue: null,
          baseRef: {
            name: 'main',
            branchProtectionRule: null,
            rules: { pageInfo: { hasNextPage: false }, nodes: [] },
          },
        },
      },
    },
  });

  const ok = await verifyLivePrMergeTarget({
    repo: 'octo/repo',
    number: 122,
    expectedSha: SHA_A,
    expectedBase: 'main',
    expectedViewer: 'dash',
    runGraphQL: validGraphQL,
    runRestGet: async () => null,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.target.method, 'squash');
  assert.equal(ok.target.sha, SHA_A);

  const wrongSha = await verifyLivePrMergeTarget({
    repo: 'octo/repo',
    number: 122,
    expectedSha: SHA_B,
    expectedBase: 'main',
    expectedViewer: 'dash',
    runGraphQL: validGraphQL,
    runRestGet: async () => null,
  });
  assert.equal(wrongSha.ok, false);
  assert.equal(wrongSha.reason, 'head-sha-changed');

  const wrongActor = await verifyLivePrMergeTarget({
    repo: 'octo/repo',
    number: 122,
    expectedSha: SHA_A,
    expectedBase: 'main',
    expectedViewer: 'someone-else',
    runGraphQL: validGraphQL,
    runRestGet: async () => null,
  });
  assert.equal(wrongActor.ok, false);
  assert.equal(wrongActor.reason, 'actor-mismatch');
});

test('attemptAutoMerge persists pending before write and separates merged / rejected / unknown', async () => {
  const events = [];
  const snap = makeReadySnapshot();
  const match = { scope: 'pr', entry: { method: 'squash' } };
  const verifyTarget = async () => ({
    ok: true,
    target: { sha: SHA_A, base: 'main', method: 'squash', actor: 'dash' },
  });

  // 1. Merged: persistBeforeWrite MUST run before executeMerge.
  const merged = await attemptAutoMerge({
    repo: 'octo/repo',
    number: 122,
    snap,
    match,
    now: 5000,
    verifyTarget,
    persistBeforeWrite: (marker) => { events.push(['persist', marker.status]); },
    executeMerge: async () => { events.push(['merge']); return { statusCode: 200, data: { merged: true }, error: null }; },
  });
  assert.equal(merged.outcome, 'merged');
  assert.deepEqual(events, [['persist', 'pending'], ['merge']]);

  // 2. Rejected (409 head mismatch): explicit rejection, no recheck.
  const rejected = await attemptAutoMerge({
    repo: 'octo/repo',
    number: 122,
    snap,
    match,
    now: 6000,
    verifyTarget,
    persistBeforeWrite: () => {},
    executeMerge: async () => ({ statusCode: 409, data: { message: 'Head branch was modified' }, error: 'HTTP 409' }),
    recheckMerged: async () => { throw new Error('must not recheck explicit 409'); },
  });
  assert.equal(rejected.outcome, 'rejected');

  // 3. Network drop / unknown: recheck confirms still unmerged -> unknown (fail closed).
  const unknown = await attemptAutoMerge({
    repo: 'octo/repo',
    number: 122,
    snap,
    match,
    now: 7000,
    verifyTarget,
    persistBeforeWrite: () => {},
    executeMerge: async () => ({ statusCode: null, data: null, error: 'ETIMEDOUT' }),
    recheckMerged: async () => ({ known: true, merged: false }),
  });
  assert.equal(unknown.outcome, 'unknown');
  assert.equal(hasBlockedAutoMergeAttempt({ autoMergeAttempt: { sha: SHA_A, status: 'unknown' } }, SHA_A), true);
  assert.equal(hasBlockedAutoMergeAttempt({ autoMergeAttempt: { sha: SHA_A, status: 'unknown' } }, SHA_B), false);
});

test('runGate executes zero-queue auto-merge only when explicitly authorized, never in diagnostic or unknown retry', async () => {
  const dir = makeTempDir();
  const fakeSnapPath = path.join(dir, 'fake-snap.mjs');
  fs.writeFileSync(fakeSnapPath, '// placeholder\n', 'utf8');
  try {
    const snap = makeReadySnapshot();
    const runSnapshot = async () => ({ code: 0, stdout: JSON.stringify(snap), stderr: '' });
    const runProbe = async () => ({ code: 0, stdout: JSON.stringify({ status: 'ok' }), stderr: '' });

    // 1. Default OFF: no policy -> never invokes runAutoMerge (first look wakes on already-READY PR; after --ack, next tick skips).
    let mergeCalls = 0;
    let out1 = '';
    const code1 = await runGate(['https://github.com/octo/repo/pull/122', '--snapshot', fakeSnapPath, '--state-dir', dir, '--no-pacing'], {
      now: () => 10_000,
      runSnapshot,
      runProbe,
      readTrigger: async () => null,
      runAutoMerge: async () => { mergeCalls++; return { outcome: 'merged', sha: SHA_A, method: 'squash', scope: 'pr' }; },
      out: (s) => { out1 += s; },
      err: () => {},
    });
    assert.equal(mergeCalls, 0);
    assert.equal(code1, 0);
    await runGate(['https://github.com/octo/repo/pull/122', '--ack', '--snapshot', fakeSnapPath, '--state-dir', dir], {
      now: () => 10_200,
      runSnapshot,
      runProbe,
      readTrigger: async () => null,
      out: () => {},
      err: () => {},
    });
    const code1b = await runGate(['https://github.com/octo/repo/pull/122', '--snapshot', fakeSnapPath, '--state-dir', dir, '--no-pacing'], {
      now: () => 10_500,
      runSnapshot,
      runProbe,
      readTrigger: async () => null,
      runAutoMerge: async () => { mergeCalls++; return { outcome: 'merged', sha: SHA_A, method: 'squash', scope: 'pr' }; },
      out: () => {},
      err: () => {},
    });
    assert.equal(mergeCalls, 0);
    assert.equal(code1b, 2);

    // 2. Enable explicit per-PR policy; diagnostic preview still MUST NOT merge.
    followNode.updateAutoMergePolicyFile(
      { op: 'set-pr', repo: 'octo/repo', number: 122, actor: 'dash', base: 'main', method: 'squash', authorizedAt: 11_000 },
      dir,
    );
    await runGate(['https://github.com/octo/repo/pull/122', '--snapshot', fakeSnapPath, '--state-dir', dir], {
      now: () => 12_000,
      runSnapshot,
      runProbe,
      readTrigger: async () => ({ kind: 'diagnostic' }),
      runAutoMerge: async () => { mergeCalls++; return { outcome: 'merged', sha: SHA_A, method: 'squash', scope: 'pr' }; },
      out: () => {},
      err: () => {},
    });
    assert.equal(mergeCalls, 0);

    // 3. Real tick with pacing enabled STILL bypasses waiting-stage pacing & probe and executes direct merge.
    let out3 = '';
    const code3 = await runGate(['https://github.com/octo/repo/pull/122', '--snapshot', fakeSnapPath, '--state-dir', dir], {
      now: () => 13_000,
      runSnapshot,
      runProbe: async () => { throw new Error('probe should be bypassed for untried auto-merge on READY PR'); },
      readTrigger: async () => null,
      runAutoMerge: async ({ persistBeforeWrite }) => {
        mergeCalls++;
        persistBeforeWrite({ sha: SHA_A, status: 'pending', method: 'squash', scope: 'pr', at: 13_000 });
        return { outcome: 'merged', sha: SHA_A, method: 'squash', scope: 'pr' };
      },
      out: (s) => { out3 += s; },
      err: () => {},
    });
    assert.equal(mergeCalls, 1);
    assert.equal(code3, 0);
    assert.match(out3, /reason=terminal \(merged/);
    assert.match(out3, /auto-merged \(pr policy, method=squash/);

    // 4. Unknown outcome on another PR persists unknown and NEVER retries even across a new schedule (newFollow).
    followNode.updateAutoMergePolicyFile(
      { op: 'set-repo', repo: 'octo/repo-u', actor: 'dash', authorizedAt: 20_000 },
      dir,
    );
    const snapU = makeReadySnapshot({ repo: 'octo/repo-u', number: 7, url: 'https://github.com/octo/repo-u/pull/7' });
    let unknownCalls = 0;
    let outU = '';
    const codeU1 = await runGate(['https://github.com/octo/repo-u/pull/7', '--snapshot', fakeSnapPath, '--state-dir', dir, '--no-pacing'], {
      now: () => 21_000,
      runSnapshot: async () => ({ code: 0, stdout: JSON.stringify(snapU), stderr: '' }),
      runProbe,
      readTrigger: async () => null,
      runAutoMerge: async ({ persistBeforeWrite }) => {
        unknownCalls++;
        persistBeforeWrite({ sha: SHA_A, status: 'pending', method: 'merge', scope: 'repo', at: 21_000 });
        return { outcome: 'unknown', sha: SHA_A, method: 'merge', scope: 'repo', reason: 'ETIMEDOUT' };
      },
      out: (s) => { outU += s; },
      err: () => {},
    });
    assert.equal(unknownCalls, 1);
    assert.equal(codeU1, 0);
    assert.match(outU, /auto-merge outcome unknown/);

    // Second tick (even with a brand new schedule firstScheduleId) MUST NOT retry SHA_A!
    await runGate(['https://github.com/octo/repo-u/pull/7', '--snapshot', fakeSnapPath, '--state-dir', dir, '--no-pacing'], {
      now: () => 25_000,
      runSnapshot: async () => ({ code: 0, stdout: JSON.stringify(snapU), stderr: '' }),
      runProbe,
      readTrigger: async () => ({ firstScheduleId: 'sched-new-2' }),
      runAutoMerge: async () => { unknownCalls++; return { outcome: 'merged', sha: SHA_A, method: 'merge', scope: 'repo' }; },
      out: () => {},
      err: () => {},
    });
    assert.equal(unknownCalls, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
