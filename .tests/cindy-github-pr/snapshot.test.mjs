import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import nodeTest from 'node:test';

import { runGate, decide, isHumanOnlyReviewPending, watchFromSnapshot, evaluateWatch, snapshotFailurePlan } from '../../cindy-github/skills/pr/scripts/pr-heartbeat-gate.mjs';
import { splitHttpResponse, rateLimitRetryAt } from '../../cindy-github/skills/pr/scripts/lib/gh.mjs';
import {
  parseGitHubRemote,
  parsePullRequestUrl,
  resolvePullRequestTarget,
} from '../../cindy-github/skills/pr/scripts/lib/repo-target.mjs';

// The fake `gh` below is a POSIX shell script, which Windows cannot execute.
const test = (name, fn) => nodeTest(name, { skip: process.platform === 'win32' ? 'POSIX-only: fake gh shim / symlink' : false }, fn);

const script = fileURLToPath(new URL('../../cindy-github/skills/pr/scripts/pr-snapshot.mjs', import.meta.url));
const cleanupScript = fileURLToPath(new URL('../../cindy-github/skills/pr/scripts/pr-cleanup-plan.mjs', import.meta.url));
const group = (conclusion = 'FAILURE', truncated = false) => ({
  oid: 'group-sha',
  statusCheckRollup: { contexts: {
    totalCount: 1, pageInfo: { hasNextPage: truncated },
    nodes: [{ __typename: 'CheckRun', name: 'arm64-build', status: 'COMPLETED', conclusion }],
  } },
});
const removal = { __typename: 'RemovedFromMergeQueueEvent', id: 'removed', reason: 'failed_checks', beforeCommit: group() };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-snapshot-queue-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // A POSIX shell `gh`: each snapshot makes several gh calls, and a shell shim answers them
  // without starting a Node process per call. It still rejects writes and checks the query.
  fs.writeFileSync(path.join(root, 'gh'), `#!/bin/sh
d="$QUEUE_FIXTURE_DIR"
for a in "$@"; do
  case "$a" in
    --method|-X|*mutation*) echo "Snapshot must not mutate GitHub" >&2; exit 1 ;;
  esac
done
case "$1" in
  --version) exit 0 ;;
  auth) echo "Snapshot must not run gh auth precheck" >&2; exit 1 ;;
esac
if [ "$1" = pr ] && [ "$2" = view ]; then cat "$d/resp-prview.json"; exit 0; fi
if [ "$1" = api ] && [ "$2" = graphql ]; then
  q=""
  for a in "$@"; do case "$a" in query=*) q="$a" ;; esac; done
  case "$q" in
    *viewer*) ;;
    *checkRunCountsByState*) cat "$d/resp-probe.json"; exit 0 ;;
  esac
  for f in mergeQueueEntry beforeCommit ADDED_TO_MERGE_QUEUE_EVENT headRefOid baseRef; do
    case "$q" in *"$f"*) ;; *) echo "Missing query field: $f" >&2; exit 1 ;; esac
  done
  cat "$d/resp-graphql.json"; exit 0
fi
case "$2" in
  */rules/branches/*) if [ -s "$d/resp-rules-error" ]; then cat "$d/resp-rules-error" >&2; exit 1; fi; cat "$d/resp-rules.json"; exit 0 ;;
  */compare/head-sha...group-sha) cat "$d/resp-compare.json"; exit 0 ;;
  */compare/*) echo "Wrong ancestry direction" >&2; exit 1 ;;
esac
if [ "$1" = api ] && [ "$2" = repos/acme/game/pulls/54 ]; then cat "$d/resp-rest.json"; exit 0; fi
echo "Unexpected command: $*" >&2
exit 1
`, { mode: 0o755 });
  const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  return (overrides = {}, comparison = 'ahead', heads = {}) => {
    const data = { comparison, checkHead: 'head-sha', restHead: 'head-sha', ...heads, pr: {
      state: 'OPEN', headRefOid: 'head-sha', mergeStateStatus: 'CLEAN', baseRefName: 'main', baseRef: { branchProtectionRule: null },
      reviewThreads: { nodes: [] }, mergeQueueEntry: null,
      timelineItems: { nodes: [removal] }, ...overrides,
    } };
    if (data.pr.baseRef && !Object.hasOwn(data.pr.baseRef, 'branchProtectionRule')) data.pr.baseRef.branchProtectionRule = null;
    write('resp-rules.json', data.rules ?? []);
    fs.writeFileSync(path.join(root, 'resp-rules-error'), data.rulesError ?? '');
    write('resp-prview.json', { headRefOid: data.checkHead, statusCheckRollup: data.rollup ?? [{ __typename: 'CheckRun', name: 'PR check', status: 'COMPLETED', conclusion: 'SUCCESS' }] });
    write('resp-graphql.json', { data: { viewer: { login: 'me' }, repository: { pullRequest: data.pr } } });
    write('resp-probe.json', { data: { repository: { pullRequest: data.pr } } });
    write('resp-compare.json', { status: data.comparison });
    write('resp-rest.json', { base: { sha: data.restBase ?? 'old-base' }, head: { sha: data.restHead }, mergeable: true, state: 'open', html_url: 'https://github.com/acme/game/pull/54' });
    return JSON.parse(execFileSync(process.execPath, [script, 'https://github.com/acme/game/pull/54', ...(data.args ?? [])], {
      env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`, QUEUE_FIXTURE_DIR: root }, encoding: 'utf8',
    }));
  };
}

test('base movement uses the live ref in both probe and full snapshot despite a stale REST base', t => {
  const run = fixture(t);
  const pr = (base) => ({ timelineItems: { nodes: [] }, baseRef: base ? { target: { oid: base } } : null });
  const red = { rollup: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' }] };
  const before = run(pr('old-base'), 'ahead', red);
  const watch = watchFromSnapshot(before, Date.now());
  const probe = run(pr('new-base'), 'ahead', { args: ['--probe'] });
  const after = run(pr('new-base'), 'ahead', red);
  assert.equal(after.baseCommitOid, probe.base);
  const moved = evaluateWatch(watch, after, Date.now());
  assert.deepEqual(moved.events, [{ kind: 'base-moved', sha: 'new-base' }]);
  assert.deepEqual(evaluateWatch(moved.next, after, Date.now()).events, []);
  const green = run(pr('new-base'));
  assert.equal(evaluateWatch(watchFromSnapshot(run(pr('old-base')), Date.now()), green, Date.now()).events.length, 0);
  assert.equal(run(pr(null), 'ahead', red).baseCommitOid, null, 'missing live ref must not fall back to stale REST base');
});

test('full snapshot: PR green + merge-group failed/removed wakes gate despite approval blocker', t => {
  const run = fixture(t);
  const healthy = run({ timelineItems: { nodes: [] } });
  assert.equal(healthy.verdict, 'READY');
  const broken = run({ reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED' });
  assert.equal(broken.checksSummary.failed, 0);
  assert.equal(broken.verdict, 'NEEDS_WORK');
  assert.equal(broken.mergeQueue.checksSummary.failingRuns[0].name, 'arm64-build');
  assert.ok(broken.blockers.includes('merge_queue_ci_failing'));
  assert.equal(isHumanOnlyReviewPending(broken), false);
  const decision = decide({ snap: broken, previous: { watch: watchFromSnapshot(healthy, Date.now()) }, now: Date.now() });
  assert.equal(decision.exitCode, 0);
  assert.equal(decision.reason, 'changed');
  assert.match(decision.detail, /events=\[merge-queue\]/);
});

test('full snapshot: compare ancestry prevents stale failures, including batched groups', t => {
  const run = fixture(t);
  for (const status of ['ahead', 'identical']) assert.equal(run({}, status).verdict, 'NEEDS_WORK');
  for (const status of ['behind', 'diverged']) {
    const snap = run({}, status);
    assert.equal(snap.verdict, 'READY');
    assert.equal(snap.mergeQueue.status, 'SUPERSEDED');
  }
  assert.ok(run({}, 'unknown').blockers.includes('merge_queue_unavailable'));
});

test('full snapshot: active queue checks, requeue and incomplete evidence', t => {
  const run = fixture(t);
  const entry = { id: 'new-entry', state: 'AWAITING_CHECKS', headCommit: group('SUCCESS') };
  assert.equal(run({ mergeQueueEntry: entry }).verdict, 'WAITING_CI');
  assert.equal(run({ mergeQueueEntry: { ...entry, headCommit: group() } }).verdict, 'NEEDS_WORK');
  assert.ok(run({ mergeQueueEntry: { ...entry, headCommit: group('SUCCESS', true) } }).blockers.includes('merge_queue_unavailable'));
  assert.equal(run({ mergeQueueEntry: { ...entry, headCommit: null } }).verdict, 'WAITING_CI');
  const unknown = run({ timelineItems: { nodes: [{ __typename: 'AddedToMergeQueueEvent', id: 'added' }] } });
  assert.ok(unknown.blockers.includes('merge_queue_unavailable'));
});

test('full snapshot: a long review thread keeps its first comment and says how many were left out', t => {
  const run = fixture(t);
  const comment = (id) => ({ id, databaseId: id.length, author: { login: 'bot', __typename: 'Bot' }, body: id, createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z', url: '' });
  const last = Array.from({ length: 30 }, (_, i) => comment(`late-${i}`));
  const snap = run({ reviewThreads: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [{
    id: 'T1', isResolved: false, isOutdated: false, path: 'a.js', line: 1, originalLine: 1,
    firstComment: { nodes: [comment('original-ask')] }, comments: { totalCount: 45, nodes: last },
  }] } });
  const thread = snap.reviewThreads.nodes[0];
  assert.equal(thread.comments[0].body, 'original-ask');
  assert.equal(thread.comments.length, 31);
  assert.equal(thread.commentsOmitted, 14);
  assert.equal(snap.reviewThreads.commentsOmitted, 14);
});

test('full snapshot: terminal status wins over historical failure', t => {
  const run = fixture(t);
  assert.equal(run({ merged: true, closed: true }).verdict, 'MERGED_CLEANUP_READY');
  assert.equal(run({ closed: true, state: 'CLOSED' }).verdict, 'CLOSED_CLEANUP_REVIEW');
});

test('another repo retains its approval gate, even after old queue failure is superseded', t => {
  const run = fixture(t);
  for (const timelineItems of [{ nodes: [] }, { nodes: [removal] }]) {
    const snap = run({ reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED', timelineItems }, 'diverged');
    assert.equal(snap.repo, 'acme/game');
    assert.equal(snap.verdict, 'BLOCKED_HUMAN');
    assert.deepEqual(snap.blockers, ['branch_protection_blocked', 'approval_required']);
  }
});

test('push between REST/checks/GraphQL queries never assigns old green checks to the new head', t => {
  const run = fixture(t);
  for (const heads of [
    { restHead: 'old', checkHead: 'old' },
    { restHead: 'old', checkHead: 'head-sha' },
    { restHead: 'head-sha', checkHead: 'old' },
    { checkHead: null },
  ]) {
    const snap = run({ timelineItems: { nodes: [] } }, 'ahead', heads);
    assert.equal(snap.latestCommitOid, 'head-sha');
    assert.equal(snap.verdict, 'NEEDS_WORK');
    assert.ok(snap.blockers.includes('checks_unavailable'));
    assert.equal(snap.checksSummary.unavailable, true);
    assert.deepEqual(snap.checks, []);
  }
});

test('dequeue cancellations and action requests do not invent a CI failure', t => {
  const run = fixture(t);
  for (const reason of ['manually_removed', 'unknown']) {
    for (const conclusion of ['CANCELLED', 'ACTION_REQUIRED', 'FAILURE']) {
      const snap = run({ timelineItems: { nodes: [{ ...removal, reason, beforeCommit: group(conclusion) }] } });
      assert.deepEqual(snap.mergeQueue.blockers, ['merge_queue_removed']);
    }
  }
  assert.ok(run({ timelineItems: { nodes: [{ ...removal, beforeCommit: group('CANCELLED') }] } }).blockers.includes('merge_queue_ci_failing'));
  const action = run({ mergeQueueEntry: { id: 'q', state: 'AWAITING_CHECKS', headCommit: group('ACTION_REQUIRED') } });
  assert.equal(action.verdict, 'BLOCKED_HUMAN');
  assert.ok(action.blockers.includes('check_action_required'));
  assert.ok(!action.blockers.includes('merge_queue_ci_failing'));
});

// ---------- gh 包装：限流元数据 ----------

nodeTest('gh wrapper requests headers and preserves rate-limit metadata on a fatal response', { skip: process.platform === 'win32' ? 'POSIX-only: fake gh shim / symlink' : false }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-rate-limit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const retryAt = Math.floor(Date.now() / 1000) + 600;
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env node
if (!process.argv.includes('--include')) process.exit(2);
process.stdout.write('HTTP/2.0 403 Forbidden\\nX-RateLimit-Reset: ${retryAt}\\n\\n{}');
process.stderr.write('gh: API rate limit already exceeded');
process.exitCode = 1;
`, { mode: 0o755 });
  const moduleUrl = new URL('../../cindy-github/skills/pr/scripts/lib/gh.mjs', import.meta.url).href;
  for (const call of ["ghJson('test', { includeHeaders: true })", "ghGraphQL('query{}', {}, { includeHeaders: true })"]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { ghJson, ghGraphQL } from ${JSON.stringify(moduleUrl)}; await ${call};`], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`\\[gh-rate-limit\\] retryAt=${retryAt * 1000}`));
  }
});

nodeTest('graphql string variables stay raw strings; other types keep their JSON typing', { skip: process.platform === 'win32' ? 'POSIX-only: fake gh shim / symlink' : false }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-graphql-vars-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));
`, { mode: 0o755 });
  const moduleUrl = new URL('../../cindy-github/skills/pr/scripts/lib/gh.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { ghGraphQL } from ${JSON.stringify(moduleUrl)}; const r = await ghGraphQL('query{}', { name: '2048', flag: 'true', nothing: 'null', file: '@secret', number: 7, ok: false }); process.stdout.write(JSON.stringify(r));`], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  const { argv } = JSON.parse(result.stdout);
  const pairs = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '-f' || argv[i] === '-F') pairs.push([argv[i], argv[i + 1]]);
  assert.deepEqual(pairs, [
    ['-f', 'query=query{}'],
    ['-f', 'name=2048'],
    ['-f', 'flag=true'],
    ['-f', 'nothing=null'],
    ['-f', 'file=@secret'],
    ['-F', 'number=7'],
    ['-F', 'ok=false'],
  ]);
});

nodeTest('HTTP metadata is separated from JSON for LF and CRLF responses', () => {
  for (const newline of ['\n', '\r\n']) {
    const response = ['HTTP/2.0 200 OK', 'Content-Type: application/json', 'X-RateLimit-Reset: 123', '', '{"ok":true}'].join(newline);
    const { headers, body } = splitHttpResponse(response);
    assert.deepEqual(JSON.parse(body), { ok: true });
    assert.equal(rateLimitRetryAt(headers, 100_000), 123_000);
  }
  assert.equal(splitHttpResponse('{"ok":true}').body, '{"ok":true}');
});

nodeTest('Retry-After seconds and dates override an earlier reset; invalid values fall back', () => {
  assert.equal(rateLimitRetryAt('Retry-After: 60\nX-RateLimit-Reset: 110', 100_000), 160_000);
  assert.equal(rateLimitRetryAt('Retry-After: Thu, 01 Jan 1970 00:03:00 GMT', 100_000), 180_000);
  assert.equal(rateLimitRetryAt('X-RateLimit-Reset: garbage', 100_000), null);
  assert.equal(rateLimitRetryAt('X-RateLimit-Reset: 90', 100_000), null);
  assert.equal(rateLimitRetryAt('Retry-After: 60\nX-RateLimit-Reset: 3700\nX-RateLimit-Remaining: 4000', 100_000), 160_000);
  assert.equal(rateLimitRetryAt('Retry-After: 60\nX-RateLimit-Reset: 3700', 100_000), 160_000);
  assert.equal(rateLimitRetryAt('Retry-After: 60\nX-RateLimit-Reset: 3700\nX-RateLimit-Remaining: 0', 100_000), 3_700_000);
  assert.equal(rateLimitRetryAt('X-RateLimit-Reset: 3700\nX-RateLimit-Remaining: 4000', 100_000), null);
});

// ---------- 仓库与 PR 目标解析 ----------

nodeTest('parses common GitHub remote forms', () => {
  assert.equal(parseGitHubRemote('git@github.com:acme/widgets-moved.git'), 'acme/widgets-moved');
  assert.equal(parseGitHubRemote('https://github.com/acme/widgets-moved.git'), 'acme/widgets-moved');
  assert.equal(parseGitHubRemote('ssh://git@github.com/acme/widgets-moved.git'), 'acme/widgets-moved');
  assert.equal(parseGitHubRemote('git@gitlab.example.com:group/repo.git'), null);
  assert.equal(parseGitHubRemote('https://evilgithub.com/acme/app.git'), null);
  assert.equal(parseGitHubRemote('git@evilgithub.com:acme/app.git'), null);
});

nodeTest('full PR URL supplies repo and number', () => {
  assert.deepEqual(parsePullRequestUrl('https://github.com/acme/widgets/pull/42'), {
    repo: 'acme/widgets',
    number: 42,
  });
  assert.deepEqual(resolvePullRequestTarget('https://github.com/acme/widgets/pull/42/files'), {
    repo: 'acme/widgets',
    owner: 'acme',
    name: 'widgets',
    number: 42,
  });
});

nodeTest('bare number resolves repo from worktree origin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-target-'));
  try {
    execFileSync('git', ['init', '-q', dir]);
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:acme/widgets.git']);
    assert.deepEqual(resolvePullRequestTarget('42', { worktree: dir }), {
      repo: 'acme/widgets',
      owner: 'acme',
      name: 'widgets',
      number: 42,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

nodeTest('rejects conflicting URL and explicit repo', () => {
  assert.throws(
    () => resolvePullRequestTarget('https://github.com/acme/widgets/pull/42', { explicitRepo: 'other/repo' }),
    /does not match/,
  );
});

nodeTest('rejects a URL that cannot supply a GitHub repository', () => {
  assert.throws(
    () => resolvePullRequestTarget('https://gitlab.example.com/acme/widgets/pull/42'),
    /Unsupported GitHub PR URL/,
  );
});

test('checks keep only the latest run per name, carry required flags, and the probe stays small', t => {
  const run = fixture(t);
  const ci = (name, conclusion, startedAt) => ({ __typename: 'CheckRun', name, workflowName: 'ci', status: 'COMPLETED', conclusion, startedAt });
  const rollup = [
    ci('verify', 'CANCELLED', '2026-10-17T10:00:00Z'),
    ci('verify', 'SUCCESS', '2026-10-17T10:20:00Z'),
    ci('lint', 'FAILURE', '2026-10-17T10:00:00Z'),
    { __typename: 'CheckRun', name: 'codeql', status: 'IN_PROGRESS', startedAt: '2026-10-17T10:05:00Z' },
  ];
  const contexts = { totalCount: 4, pageInfo: { hasNextPage: false }, nodes: [{ __typename: 'CheckRun', name: 'verify', isRequired: true }] };
  const snap = run({ timelineItems: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: { contexts } } }] } }, 'ahead', { rollup });
  assert.equal(snap.viewer, 'me');
  assert.deepEqual(snap.checks.map((c) => [c.name, c.outcome, c.required]), [
    ['verify', 'passed', true], ['lint', 'failed', false], ['codeql', 'pending', false],
  ]);
  assert.equal(snap.checksSummary.failed, 1, 'the re-run replaced the cancelled verify');

  const probe = run({
    isDraft: false, mergeable: 'MERGEABLE', comments: { totalCount: 2, nodes: [{ updatedAt: 'c2' }] },
    reviews: { totalCount: 0, nodes: [] }, reviewThreads: { totalCount: 1 }, baseRef: { target: { oid: 'base-sha' } },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { checkRunCountsByState: [{ state: 'SUCCESS', count: 3 }, { state: 'QUEUED', count: 0 }] } } } }] },
  }, 'ahead', { args: ['--probe'] });
  assert.deepEqual(probe, { status: 'OPEN false MERGEABLE head-sha  SUCCESS:3 ', remarks: '2 c2 0  1 0', base: 'base-sha' });
});

test('required inventory: missing checks wait, rules change, unknown stays unknown', t => {
  const run = fixture(t);
  const pr = { timelineItems: { nodes: [] } };
  const rules = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'late-test' }] } }];
  const missing = run(pr, 'ahead', { rules });
  assert.equal(missing.verdict, 'WAITING_CI');
  assert.equal(missing.checks.find(c => c.name === 'late-test').expected, true);
  assert.equal(missing.checksSummary.pending, 1);
  const completed = run(pr, 'ahead', { rules, rollup: [{ __typename: 'CheckRun', name: 'late-test', status: 'COMPLETED', conclusion: 'SUCCESS' }] });
  assert.equal(completed.verdict, 'READY');
  assert.equal(completed.checks[0].required, true);
  assert.equal(run(pr).checks.some(c => c.expected), false, 'inventory is reread, not cached forever');
  const unknown = run(pr, 'ahead', { rules: { message: 'unavailable' } });
  assert.equal(unknown.gate.requiredChecksUnavailable, true);
  assert.notEqual(unknown.verdict, 'READY');
  assert.equal(run({ ...pr, baseRef: null }).gate.requiredChecksUnavailable, true);
});

test('registered checks do not gain phantom placeholders when app metadata differs', t => {
  const run = fixture(t);
  const baseRef = { branchProtectionRule: { requiresStatusChecks: true, requiredStatusChecks: [{ context: 'verify', app: { databaseId: 42 } }] } };
  const c = { __typename: 'CheckRun', name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://example.test/check', startedAt: '2026-11-10T00:00:00Z', completedAt: '2026-11-10T00:01:00Z' };
  const pr = id => ({ baseRef, timelineItems: { nodes: [] }, commits: { nodes: [{ commit: { oid: 'head-sha', statusCheckRollup: { contexts: { nodes: [{ ...c, checkSuite: { app: { databaseId: id, slug: 'test-bot' } } }] } } } }] } });
  assert.equal(run(pr(43), 'ahead', { rollup: [c] }).checks.some(c => c.expected), false);
  const valid = run(pr(42), 'ahead', { rollup: [c] });
  assert.equal(valid.verdict, 'READY');
  assert.equal(valid.reviewerChecks[0].headSha, 'head-sha');
});

test('delivery snapshot detects head/base changes without scheduling a model round', t => {
  const run = fixture(t);
  const pr = { timelineItems: { nodes: [] }, baseRef: { target: { oid: 'base-new' } } };
  const args = ['--expect-head', 'head-sha'];
  assert.equal(run(pr, 'ahead', { args }).verdict, 'READY');
  args[1] = 'head-old';
  assert.ok(run(pr, 'ahead', { args }).blockers.includes('delivery_evidence_changed'));
});

test('full snapshot -> persisted gate: delayed check, restart before ack, late failure', async t => {
  const read = fixture(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-chain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = Date.parse('2026-11-10T10:00:00Z');
  let current;
  const poll = async (extra = []) => {
    let stdout = '';
    const code = await runGate(['https://github.com/acme/game/pull/54', '--state-dir', dir, '--no-pacing', '--json', ...extra], {
      now: () => now, runSnapshot: async () => ({ code: 0, stdout: JSON.stringify(current), stderr: '' }),
      runProbe: async () => ({ code: 1 }), readTrigger: async () => null,
      out: s => { stdout += s; }, err: () => {},
    });
    return { code, data: JSON.parse(stdout) };
  };
  const rules = [{type:'required_status_checks',parameters:{required_status_checks:[{context:'late'}]}}];
  const pr = { timelineItems:{nodes:[]} };
  current = read(pr, 'ahead', {rules});
  assert.equal((await poll()).code, 2, 'missing required check does not announce green');
  const rollup = [{__typename:'CheckRun',name:'late',status:'COMPLETED',conclusion:'SUCCESS'}];
  current = read(pr, 'ahead', {rules,rollup}); now += 5*60000;
  assert.equal((await poll()).code, 0);
  now += 5*60000;
  assert.equal((await poll()).data.reason, 'retry-unacked', 'new invocation restores pending event from disk');
  assert.equal((await poll(['--ack'])).code, 0);
  now += 5*60000;
  assert.equal((await poll()).code, 2, 'acknowledged success is not delivered twice');
  current = read(pr, 'ahead', {rules,rollup:[...rollup,{__typename:'CheckRun',name:'late-optional',status:'COMPLETED',conclusion:'FAILURE'}]});
  now += 5*60000;
  const failed = await poll();
  assert.equal(failed.code, 0);
  assert.match(failed.data.detail, /checks-failed/);
});

test('rules HTTP 403 does not kill the snapshot or hide CI', t => {
  const run=fixture(t);
  const s=run({timelineItems:{nodes:[]}},'ahead',{rulesError:'gh: Resource not accessible (HTTP 403)'});
  assert.equal(s.gate.requiredChecksUnavailable,true);
  assert.equal(s.checksSummary.unavailable,false);
  assert.equal(s.checks.length,1);
  assert.notEqual(s.verdict,'READY');
});

test('two policies for the same absent name produce one wait target',t=>{
 const run=fixture(t);
 const rules=[{type:'required_status_checks',parameters:{required_status_checks:[{context:'late',integration_id:42},{context:'late'}]}}];
 const s=run({timelineItems:{nodes:[]}},'ahead',{rules});
 assert.equal(s.checks.filter(c=>c.name==='late').length,1);
});

nodeTest('probe and full snapshot skip gh auth prechecks and classify auth, rate-limit, and network errors from the first real request', { skip: process.platform === 'win32' ? 'POSIX-only: fake gh shim / symlink' : false }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-first-req-errors-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logFile = path.join(dir, 'argv.log');
  const now = Date.now();
  const resetSec = Math.floor(now / 1000) + 600;
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_ARGV_LOG, JSON.stringify(args) + '\\n');
if (args[0] === '--version') process.exit(0);
if (args[0] === 'auth') {
  process.stderr.write('unexpected gh auth precheck\\n');
  process.exit(9);
}
const mode = process.env.FAKE_GH_MODE;
if (mode === 'no-creds') {
  process.stderr.write('To get started with GitHub CLI, please run:  gh auth login\\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\\n');
  process.exit(4);
}
if (mode === 'bad-creds') {
  process.stdout.write('HTTP/2.0 401 Unauthorized\\n\\n{"message":"Bad credentials"}');
  process.stderr.write('gh: Bad credentials (HTTP 401)\\n');
  process.exit(1);
}
if (mode === 'rate-limit') {
  process.stdout.write('HTTP/2.0 403 Forbidden\\nX-RateLimit-Remaining: 0\\nX-RateLimit-Reset: ${resetSec}\\n\\n{"message":"API rate limit exceeded"}');
  process.stderr.write('gh: API rate limit already exceeded for user ID 123 (HTTP 403)\\n');
  process.exit(1);
}
if (mode === 'dns') {
  process.stderr.write('Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host\\n');
  process.exit(1);
}
if (mode === 'timeout') {
  process.stderr.write('Get "https://api.github.com/repos/acme/game/pulls/54": dial tcp 140.82.121.6:443: i/o timeout\\n');
  process.exit(1);
}
process.exit(2);
`, { mode: 0o755 });

  const runCase = (mode, extraArgs = []) => {
    fs.writeFileSync(logFile, '');
    const res = spawnSync(process.execPath, [script, 'https://github.com/acme/game/pull/54', ...extraArgs], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, GH_ARGV_LOG: logFile, FAKE_GH_MODE: mode },
    });
    const calls = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(calls.some(argv => argv[0] === 'auth'), false, `must never invoke gh auth (${mode})`);
    return { res, calls };
  };

  for (const extraArgs of [['--probe'], []]) {
    const label = extraArgs.length ? 'probe' : 'full';
    for (const mode of ['no-creds', 'bad-creds']) {
      const { res, calls } = runCase(mode, extraArgs);
      assert.equal(res.status, 1, `${label}/${mode}`);
      assert.equal(calls.filter(argv => argv[0] === 'api').length, 1, `${label}/${mode} fails fast without retry`);
      const plan = snapshotFailurePlan({ code: res.status, stderr: res.stderr }, null, now, 1);
      assert.equal(plan.diagnosis.kind, 'auth', `${label}/${mode}: ${res.stderr}`);
    }

    const rl = runCase('rate-limit', extraArgs);
    assert.equal(rl.res.status, 1, `${label}/rate-limit`);
    assert.equal(rl.calls.filter(argv => argv[0] === 'api').length, 1, `${label}/rate-limit fails fast without retry`);
    assert.match(rl.res.stderr, new RegExp(`\\[gh-rate-limit\\] retryAt=${resetSec * 1000}`));
    const rlPlan = snapshotFailurePlan({ code: rl.res.status, stderr: rl.res.stderr }, null, now, 1);
    assert.equal(rlPlan.diagnosis.kind, 'rate-limit', `${label}/rate-limit`);
    assert.equal(rlPlan.until, resetSec * 1000 + 1000);
  }

  // Network errors: verify DNS on probe and timeout on full snapshot classify as dns / timeout (never auth or rate-limit).
  const dnsRun = runCase('dns', ['--probe']);
  assert.notEqual(dnsRun.res.status, 0);
  assert.equal(snapshotFailurePlan({ code: dnsRun.res.status, stderr: dnsRun.res.stderr }, null, now, 1).diagnosis.kind, 'dns');

  const timeoutRun = runCase('timeout', []);
  assert.notEqual(timeoutRun.res.status, 0);
  assert.equal(snapshotFailurePlan({ code: timeoutRun.res.status, stderr: timeoutRun.res.stderr }, null, now, 1).diagnosis.kind, 'timeout');
});

nodeTest('pr-cleanup-plan stays read-only and skips gh auth prechecks', { skip: process.platform === 'win32' ? 'POSIX-only: fake gh shim / symlink' : false }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-cleanup-readonly-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const binDir = path.join(dir, 'bin');
  const repoDir = path.join(dir, 'repo');
  const logFile = path.join(dir, 'gh.log');
  fs.mkdirSync(binDir);
  fs.mkdirSync(repoDir);

  execFileSync('git', ['init', '-q', '-b', 'main', repoDir]);
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repoDir, 'README.md'), 'hi\n');
  execFileSync('git', ['-C', repoDir, 'add', 'README.md']);
  execFileSync('git', ['-C', repoDir, 'commit', '-q', '-m', 'init']);
  execFileSync('git', ['-C', repoDir, 'remote', 'add', 'origin', 'https://github.com/acme/game.git']);
  execFileSync('git', ['-C', repoDir, 'checkout', '-q', '-b', 'feat/demo']);
  const headSha = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', repoDir, 'checkout', '-q', 'main']);

  fs.writeFileSync(path.join(binDir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
for (const a of args) {
  if (a === '--method' || a === '-X' || /mutation/i.test(a)) {
    process.stderr.write('cleanup planner must not mutate GitHub\\n');
    process.exit(8);
  }
}
if (args[0] === '--version') process.exit(0);
if (args[0] === 'auth') {
  process.stderr.write('cleanup planner must not run gh auth precheck\\n');
  process.exit(9);
}
if (args[0] === 'api' && args[1] === 'repos/acme/game/pulls/54') {
  process.stdout.write(JSON.stringify({
    html_url: 'https://github.com/acme/game/pull/54',
    state: 'closed',
    merged: true,
    merged_at: '2026-11-26T00:00:00Z',
    closed_at: '2026-11-26T00:00:00Z',
    merge_commit_sha: ${JSON.stringify(headSha)},
    head: { ref: 'feat/demo', sha: ${JSON.stringify(headSha)}, repo: { full_name: 'acme/game', default_branch: 'main' } },
    base: { ref: 'main', repo: { full_name: 'acme/game', default_branch: 'main' } },
  }));
  process.exit(0);
}
process.exit(2);
`, { mode: 0o755 });

  const res = spawnSync(process.execPath, [cleanupScript, 'https://github.com/acme/game/pull/54', '--worktree', repoDir], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, GH_LOG: logFile },
  });
  assert.equal(res.status, 0, res.stderr);
  const plan = JSON.parse(res.stdout);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.fetched, false);
  assert.equal(plan.merged, true);
  // Confirm local branch still exists (read-only planner did not delete it) and gh auth was never called.
  const branches = execFileSync('git', ['-C', repoDir, 'branch', '--list', 'feat/demo'], { encoding: 'utf8' });
  assert.match(branches, /feat\/demo/);
  const calls = fs.readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls, [['--version'], ['api', 'repos/acme/game/pulls/54']]);
});

nodeTest('ghJsonConditional handles HTTP 200 ETag and HTTP 304 Not Modified without retries or exit', { skip: process.platform === 'win32' ? 'POSIX-only: fake gh shim / symlink' : false }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-cond-etag-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logFile = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
const hIdx = args.indexOf('-H');
const ifNoneMatch = hIdx >= 0 ? args[hIdx + 1] : '';
if (ifNoneMatch === 'If-None-Match: W/"v1"') {
  process.stdout.write('HTTP/2.0 304 Not Modified\\r\\nETag: W/"v1"\\r\\nX-RateLimit-Remaining: 4999\\r\\n\\r\\n');
  process.stderr.write('gh: HTTP 304\\n');
  process.exit(1);
}
process.stdout.write('HTTP/2.0 200 OK\\r\\nETag: W/"v1"\\r\\nContent-Type: application/json\\r\\n\\r\\n{"ok":true}');
process.exit(0);
`, { mode: 0o755 });
  const moduleUrl = new URL('../../cindy-github/skills/pr/scripts/lib/gh.mjs', import.meta.url).href;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { ghJsonConditional } from ${JSON.stringify(moduleUrl)};
    const first = await ghJsonConditional('repos/acme/game/pulls/1');
    const second = await ghJsonConditional('repos/acme/game/pulls/1', { etag: first.etag });
    process.stdout.write(JSON.stringify({ first, second }));
  `], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, GH_LOG: logFile },
  });
  assert.equal(run.status, 0, run.stderr);
  const { first, second } = JSON.parse(run.stdout);
  assert.equal(first.notModified, false);
  assert.equal(first.etag, 'W/"v1"');
  assert.deepEqual(first.data, { ok: true });
  assert.equal(second.notModified, true);
  assert.equal(second.etag, 'W/"v1"');
  assert.equal(second.data, null);
  const calls = fs.readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 2, '304 must not trigger retries');
  assert.ok(calls[1].includes('If-None-Match: W/"v1"'));
});

nodeTest('pr-snapshot --state-dir revalidates REST pulls and shared repo branch rules via live ETag 304 with minimal cached fields', { skip: process.platform === 'win32' ? 'POSIX-only: fake gh shim / symlink' : false }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-snapshot-etag-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateDir = path.join(dir, 'state');
  const logFile = path.join(dir, 'gh.log');
  const cfgFile = path.join(dir, 'cfg.json');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(process.env.CFG_FILE, 'utf8'));
if (args[0] === '--version') process.exit(0);
const hIdx = args.indexOf('-H');
const ifNoneMatch = hIdx >= 0 ? args[hIdx + 1] : '';
const record = (kind, status) => fs.appendFileSync(process.env.GH_LOG, JSON.stringify({ kind, path: args[1] ?? '', ifNoneMatch, status }) + '\\n');
if (args[0] === 'pr' && args[1] === 'view') {
  record('pr-view', 200);
  process.stdout.write(JSON.stringify({ headRefOid: cfg.headSha, statusCheckRollup: cfg.rollup }));
  process.exit(0);
}
if (args[0] === 'api' && args[1] === 'graphql') {
  record('graphql', 200);
  process.stdout.write(JSON.stringify({
    data: {
      viewer: { login: cfg.viewer },
      repository: {
        pullRequest: {
          state: 'OPEN', headRefOid: cfg.headSha, mergeStateStatus: 'CLEAN', baseRefName: 'main',
          baseRef: { target: { oid: 'base-1' }, branchProtectionRule: null },
          reviewThreads: { nodes: [] }, mergeQueueEntry: null, timelineItems: { nodes: [] },
        },
      },
    },
  }));
  process.exit(0);
}
if (args[0] === 'api' && /^repos\\/acme\\/game\\/pulls\\/\\d+$/.test(args[1])) {
  const expected = 'If-None-Match: ' + cfg.pullEtag;
  if (ifNoneMatch === expected) {
    record('pull', 304);
    process.stdout.write('HTTP/2.0 304 Not Modified\\nETag: ' + cfg.pullEtag + '\\n\\n');
    process.stderr.write('gh: HTTP 304\\n');
    process.exit(1);
  }
  record('pull', 200);
  process.stdout.write(
    'HTTP/2.0 200 OK\\nETag: ' + cfg.pullEtag + '\\n\\n' +
    JSON.stringify({
      html_url: 'https://github.com/acme/game/pull/' + args[1].split('/').pop(),
      title: 'Private feature title',
      body: 'CONFIDENTIAL_PRIVATE_PR_BODY_DO_NOT_PERSIST',
      state: 'open',
      merged: false,
      mergeable: true,
      mergeable_state: 'clean',
      additions: 12,
      deletions: 3,
      changed_files: 2,
      user: { login: 'author-secret' },
      requested_reviewers: [{ login: 'reviewer-secret' }],
      requested_teams: [{ slug: 'security-team' }],
      base: { sha: 'base-1', repo: { full_name: 'acme/game', private: true, description: 'internal repo' } },
      head: { sha: cfg.headSha, label: 'acme:feat', repo: { full_name: 'acme/private-fork', description: 'secret fork' } },
    }),
  );
  process.exit(0);
}
if (args[0] === 'api' && args[1].includes('/rules/branches/')) {
  if (cfg.rulesError) {
    record('rules', 500);
    process.stderr.write(cfg.rulesError + '\\n');
    process.exit(1);
  }
  const expected = 'If-None-Match: ' + cfg.rulesEtag;
  if (ifNoneMatch === expected) {
    record('rules', 304);
    process.stdout.write('HTTP/2.0 304 Not Modified\\nETag: ' + cfg.rulesEtag + '\\n\\n');
    process.stderr.write('gh: HTTP 304\\n');
    process.exit(1);
  }
  record('rules', 200);
  process.stdout.write('HTTP/2.0 200 OK\\nETag: ' + cfg.rulesEtag + '\\n\\n' + JSON.stringify(cfg.rules));
  process.exit(0);
}
process.stderr.write('Unexpected gh call: ' + args.join(' ') + '\\n');
process.exit(2);
`, { mode: 0o755 });

  const runSnap = (prNumber, cfg, extraArgs = [], expectedStatus = 0) => {
    fs.writeFileSync(cfgFile, JSON.stringify(cfg));
    fs.writeFileSync(logFile, '');
    const res = spawnSync(process.execPath, [script, `https://github.com/acme/game/pull/${prNumber}`, '--state-dir', stateDir, ...extraArgs], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, GH_LOG: logFile, CFG_FILE: cfgFile },
    });
    assert.equal(res.status, expectedStatus, res.stderr);
    const calls = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    return { snap: JSON.parse(res.stdout), calls };
  };

  const baseCfg = {
    viewer: 'alice',
    headSha: 'head-1',
    pullEtag: 'W/"pull-v1"',
    rulesEtag: 'W/"rules-v1"',
    rules: [
      { type: 'pull_request', ruleset_id: 99, parameters: { required_approving_review_count: 2 } },
      {
        type: 'required_status_checks',
        ruleset_source: 'internal-org-policy',
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [{ context: 'late-test', integration_id: 15368, extra_meta: 'drop-me' }],
        },
      },
    ],
    rollup: [{ __typename: 'CheckRun', name: 'PR check', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };

  // 1. First snapshot of PR #54 primes both pull and shared repo rules caches (200)
  //    and writes ONLY the minimal fields consumed by pr-snapshot.mjs.
  const r1 = runSnap(54, baseCfg);
  assert.equal(r1.snap.verdict, 'WAITING_CI');
  assert.equal(r1.calls.find(c => c.kind === 'pull').status, 200);
  assert.equal(r1.calls.find(c => c.kind === 'rules').status, 200);

  const restCachePath = path.join(stateDir, 'acme__game-54.rest-cache.json');
  const restCacheRaw = fs.readFileSync(restCachePath, 'utf8');
  assert.doesNotMatch(restCacheRaw, /CONFIDENTIAL_PRIVATE_PR_BODY|requested_reviewers|requested_teams|private-fork|internal repo|author-secret/);
  const restCache = JSON.parse(restCacheRaw);
  assert.equal(restCache.schema, 2);
  assert.deepEqual(Object.keys(restCache.data).sort(), [
    'additions', 'changed_files', 'deletions', 'head', 'html_url',
    'mergeable', 'mergeable_state', 'merged', 'state', 'title',
  ]);
  assert.deepEqual(Object.keys(restCache.data.head), ['sha']);

  const rulesCachePath = path.join(stateDir, 'acme__game.rules-cache.json');
  const rulesCacheRaw = fs.readFileSync(rulesCachePath, 'utf8');
  assert.doesNotMatch(rulesCacheRaw, /pull_request|ruleset_id|internal-org-policy|strict_required_status_checks_policy|drop-me/);
  const rulesCache = JSON.parse(rulesCacheRaw);
  assert.equal(rulesCache.schema, 2);
  assert.deepEqual(rulesCache.entries['alice:main'].rules, [
    { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'late-test', integration_id: 15368 }] } },
  ]);

  // 2. Second snapshot of PR #54 hits 304 for both pull and rules (including under --strict-exit live revalidation)
  //    and yields the exact same snapshot payload as the 200 run.
  const r2 = runSnap(54, baseCfg, ['--expect-head', 'head-1', '--strict-exit'], 10);
  assert.equal(r2.snap.verdict, 'WAITING_CI');
  assert.equal(r2.calls.find(c => c.kind === 'pull').status, 304);
  assert.equal(r2.calls.find(c => c.kind === 'rules').status, 304);
  assert.deepEqual({ ...r2.snap, fetchedAt: null }, { ...r1.snap, fetchedAt: null });

  // 2b. A legacy schema:1 cache file containing full REST fields (e.g. body) is ignored and replaced by narrowed schema:2.
  fs.writeFileSync(restCachePath, JSON.stringify({
    schema: 1,
    etag: baseCfg.pullEtag,
    data: { state: 'open', head: { sha: baseCfg.headSha }, body: 'LEGACY_SECRET_BODY' },
    updatedAt: 1000,
  }));
  const r2b = runSnap(54, baseCfg);
  assert.equal(r2b.calls.find(c => c.kind === 'pull').status, 200);
  const rewrittenRaw = fs.readFileSync(restCachePath, 'utf8');
  assert.doesNotMatch(rewrittenRaw, /LEGACY_SECRET_BODY|CONFIDENTIAL_PRIVATE_PR_BODY/);
  assert.equal(JSON.parse(rewrittenRaw).schema, 2);

  // 3. Another PR (#55) in the same repo & viewer reuses the shared rules ETag immediately (rules 304, pull 200).
  const r3 = runSnap(55, baseCfg);
  assert.equal(r3.snap.verdict, 'WAITING_CI');
  assert.equal(r3.calls.find(c => c.kind === 'pull').status, 200);
  assert.equal(r3.calls.find(c => c.kind === 'rules').status, 304);

  // 4. Different viewer does NOT reuse alice's rules cache entry (viewer isolation).
  const r4 = runSnap(55, { ...baseCfg, viewer: 'bob' });
  assert.equal(r4.calls.find(c => c.kind === 'rules').ifNoneMatch, '');
  assert.equal(r4.calls.find(c => c.kind === 'rules').status, 200);

  // 5. When rules change on GitHub (new ETag), live revalidation gets 200 immediately (zero staleness).
  const r5 = runSnap(54, { ...baseCfg, rulesEtag: 'W/"rules-v2"', rules: [] });
  assert.equal(r5.snap.verdict, 'READY');
  assert.equal(r5.calls.find(c => c.kind === 'rules').status, 200);

  // 6. When pull changes (new head & ETag), pull gets 200 and updates cache.
  const r6 = runSnap(54, { ...baseCfg, headSha: 'head-2', pullEtag: 'W/"pull-v2"', rulesEtag: 'W/"rules-v2"', rules: [] });
  assert.equal(r6.snap.latestCommitOid, 'head-2');
  assert.equal(r6.calls.find(c => c.kind === 'pull').status, 200);
  assert.equal(r6.calls.find(c => c.kind === 'rules').status, 304);

  // 7. Rules error is never masked by cached rules.
  const r7 = runSnap(54, { ...baseCfg, headSha: 'head-2', pullEtag: 'W/"pull-v2"', rulesError: 'gh: Resource not accessible (HTTP 403)' });
  assert.equal(r7.snap.gate.requiredChecksUnavailable, true);
  assert.notEqual(r7.snap.verdict, 'READY');

  // 8. CINDY_PR_STATE_DIR env var enables ETag 304 without passing --state-dir on CLI,
  //    and omitting both writes no cache files.
  const envStateDir = path.join(dir, 'env-state');
  fs.writeFileSync(cfgFile, JSON.stringify(baseCfg));
  const envRun = (useEnv) => {
    fs.writeFileSync(logFile, '');
    const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, GH_LOG: logFile, CFG_FILE: cfgFile };
    if (useEnv) env.CINDY_PR_STATE_DIR = envStateDir;
    else delete env.CINDY_PR_STATE_DIR;
    const res = spawnSync(process.execPath, [script, 'https://github.com/acme/game/pull/54'], { encoding: 'utf8', env });
    assert.equal(res.status, 0, res.stderr);
    return fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  };
  assert.equal(envRun(false).find(c => c.kind === 'pull').status, 200);
  assert.equal(fs.existsSync(envStateDir), false);
  assert.equal(envRun(true).find(c => c.kind === 'pull').status, 200);
  const envSecond = envRun(true);
  assert.equal(envSecond.find(c => c.kind === 'pull').status, 304);
  assert.equal(envSecond.find(c => c.kind === 'rules').status, 304);

  // 9. Branch-rules cache refreshes updatedAt on 304 hits so hot entries survive >20-entry eviction.
  const seededEntries = {
    'alice:main': { etag: 'W/"rules-v2"', rules: [], updatedAt: 1000 },
  };
  for (let i = 1; i <= 19; i++) {
    seededEntries[`cold-${String(i).padStart(2, '0')}:main`] = {
      etag: `W/"cold-${i}"`,
      rules: [],
      updatedAt: 1000 + i * 1000,
    };
  }
  fs.writeFileSync(rulesCachePath, JSON.stringify({ schema: 2, entries: seededEntries }));
  // Hot entry `alice:main` hits 304 (even with unchanged ETag) -> refreshes updatedAt above cold entries.
  const hotHit = runSnap(54, { ...baseCfg, headSha: 'head-2', pullEtag: 'W/"pull-v2"', rulesEtag: 'W/"rules-v2"', rules: [] });
  assert.equal(hotHit.calls.find(c => c.kind === 'rules').status, 304);
  // Adding a 21st entry (`newbie:main`) triggers eviction down to 20 entries.
  const twentyFirst = runSnap(54, { ...baseCfg, viewer: 'newbie', headSha: 'head-2', pullEtag: 'W/"pull-v2"', rulesEtag: 'W/"rules-newbie"', rules: [] });
  assert.equal(twentyFirst.calls.find(c => c.kind === 'rules').status, 200);
  const afterEvict = JSON.parse(fs.readFileSync(rulesCachePath, 'utf8'));
  assert.equal(Object.keys(afterEvict.entries).length, 20);
  assert.ok(afterEvict.entries['alice:main'], 'frequently reused entry must survive >20-entry eviction');
  assert.ok(afterEvict.entries['alice:main'].updatedAt > 20000, '304 hit must refresh updatedAt');
  assert.ok(afterEvict.entries['newbie:main'], 'newly added entry must be retained');
  assert.equal(afterEvict.entries['cold-01:main'], undefined, 'oldest unused entry should be evicted');
  // Confirm alice:main still gets 304 immediately after eviction.
  const afterEvictHit = runSnap(54, { ...baseCfg, headSha: 'head-2', pullEtag: 'W/"pull-v2"', rulesEtag: 'W/"rules-v2"', rules: [] });
  assert.equal(afterEvictHit.calls.find(c => c.kind === 'rules').status, 304);
});

test('full snapshot emits the same probe fingerprint as --probe when check counts agree, and omits probe on skew', (t) => {
  const run = fixture(t);
  const twoGreen = [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-11-26T00:00:00Z' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-11-26T00:00:00Z' },
  ];
  const pr = {
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefOid: 'head-sha',
    baseRef: { target: { oid: 'base-sha' }, branchProtectionRule: null },
    mergeQueueEntry: null,
    timelineItems: { nodes: [] },
    comments: { totalCount: 1, nodes: [{ id: 'C1', author: { login: 'alice', __typename: 'User' }, body: 'hi', createdAt: '2026-11-26T00:00:00Z', updatedAt: '2026-11-26T00:05:00Z', url: '' }] },
    reviews: { totalCount: 1, nodes: [{ id: 'R1', author: { login: 'bob', __typename: 'User' }, state: 'COMMENTED', body: 'ok', submittedAt: '2026-11-26T00:06:00Z', updatedAt: '2026-11-26T00:07:00Z', url: '', commit: { oid: 'head-sha' } }] },
    reviewThreads: { totalCount: 2, pageInfo: { hasNextPage: false }, nodes: [] },
    reactions: { totalCount: 3, nodes: [] },
    commits: {
      nodes: [{
        commit: {
          oid: 'head-sha',
          statusCheckRollup: {
            contexts: {
              totalCount: 2,
              pageInfo: { hasNextPage: false },
              checkRunCountsByState: [{ state: 'SUCCESS', count: 2 }],
              statusContextCountsByState: [],
              nodes: [],
            },
          },
        },
      }],
    },
  };
  const probe = run(pr, 'ahead', { args: ['--probe'], rollup: twoGreen });
  const full = run(pr, 'ahead', { rollup: twoGreen });
  assert.deepEqual(full.probe, probe);

  // Rerun attempts on the same check name still match GraphQL checkRunCountsByState (computed before latestChecks dedup).
  const rerunRollup = [
    { __typename: 'CheckRun', name: 'verify', status: 'COMPLETED', conclusion: 'CANCELLED', startedAt: '2026-11-26T00:00:00Z' },
    { __typename: 'CheckRun', name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-11-26T00:01:00Z' },
    { __typename: 'StatusContext', context: 'ci/deploy', state: 'SUCCESS' },
  ];
  const rerunPr = {
    ...pr,
    commits: {
      nodes: [{
        commit: {
          oid: 'head-sha',
          statusCheckRollup: {
            contexts: {
              totalCount: 3,
              pageInfo: { hasNextPage: false },
              checkRunCountsByState: [{ state: 'CANCELLED', count: 1 }, { state: 'SUCCESS', count: 1 }],
              statusContextCountsByState: [{ state: 'SUCCESS', count: 1 }],
              nodes: [],
            },
          },
        },
      }],
    },
  };
  assert.deepEqual(run(rerunPr, 'ahead', { rollup: rerunRollup }).probe, run(rerunPr, 'ahead', { args: ['--probe'], rollup: rerunRollup }));

  // If a check reran and failed between gh pr view (two green checks) and GraphQL (FAILURE:1,SUCCESS:2),
  // full snapshot must emit probe: null so the gate does not cache the unseen failure.
  const skewedPr = {
    ...pr,
    commits: {
      nodes: [{
        commit: {
          oid: 'head-sha',
          statusCheckRollup: {
            contexts: {
              totalCount: 3,
              pageInfo: { hasNextPage: false },
              checkRunCountsByState: [{ state: 'SUCCESS', count: 2 }, { state: 'FAILURE', count: 1 }],
              statusContextCountsByState: [],
              nodes: [],
            },
          },
        },
      }],
    },
  };
  assert.equal(run(skewedPr, 'ahead', { rollup: twoGreen }).probe, null);

  // StatusContext skew and truncated/unavailable checks must also emit probe: null.
  const statusSkewPr = {
    ...rerunPr,
    commits: {
      nodes: [{
        commit: {
          oid: 'head-sha',
          statusCheckRollup: {
            contexts: {
              ...rerunPr.commits.nodes[0].commit.statusCheckRollup.contexts,
              statusContextCountsByState: [{ state: 'FAILURE', count: 1 }],
            },
          },
        },
      }],
    },
  };
  assert.equal(run(statusSkewPr, 'ahead', { rollup: rerunRollup }).probe, null);
  assert.equal(run(pr, 'ahead', { rollup: twoGreen, checkHead: 'old-head' }).probe, null);
  const truncatedPr = {
    ...pr,
    commits: {
      nodes: [{
        commit: {
          oid: 'head-sha',
          statusCheckRollup: {
            contexts: {
              ...pr.commits.nodes[0].commit.statusCheckRollup.contexts,
              pageInfo: { hasNextPage: true },
            },
          },
        },
      }],
    },
  };
  assert.equal(run(truncatedPr, 'ahead', { rollup: twoGreen }).probe, null);
});
