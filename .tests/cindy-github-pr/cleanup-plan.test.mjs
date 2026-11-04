import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCleanupCommands, githubRepoNamesOfRemotes, githubRepoOfUrl, isLongLivedBranch, isPrWorktree, planLocalCleanup, remoteNameForRepo } from '../../cindy-github/skills/pr/scripts/lib/cleanup-plan.mjs';

const PRIMARY = '/repo';
const SIBLING = '/repo-pr-branch';

function plan(overrides = {}) {
  return planLocalCleanup({
    terminal: true,
    merged: true,
    longLivedBranch: false,
    primaryStatus: { ok: true, dirty: false },
    primaryIsHead: false,
    dirtyTargetCount: 0,
    hasLocalArtifacts: true,
    ...overrides,
  });
}

function commandKinds(commands) {
  return commands.map(entry => entry.argv.slice(3).join(' '));
}

test('dirty primary does not block sibling worktree cleanup', () => {
  const result = plan({ primaryStatus: { ok: true, dirty: true } });
  assert.equal(result.recommendation, 'remove_local_worktree_and_branch');
  assert.equal(result.canCleanupLocal, true);
  assert.equal(result.canSyncPrimary, false);
  assert.ok(!result.blockers.includes('primary_worktree_dirty'));
  assert.match(result.notes.join('\n'), /Primary worktree is dirty/);
});

test('dirty primary blocks cleanup only when PR branch is checked out there', () => {
  const result = plan({
    primaryIsHead: true,
    primaryStatus: { ok: true, dirty: true },
  });
  assert.equal(result.recommendation, 'do_not_cleanup');
  assert.equal(result.canCleanupLocal, false);
  assert.ok(result.blockers.includes('primary_worktree_dirty'));
});

test('unreadable primary skips sync but still allows sibling cleanup', () => {
  const result = plan({ primaryStatus: { ok: false, dirty: true } });
  assert.equal(result.recommendation, 'remove_local_worktree_and_branch');
  assert.equal(result.canSyncPrimary, false);
  assert.ok(!result.blockers.includes('primary_worktree_status_unavailable'));
});

test('unreadable primary blocks cleanup when PR branch is checked out there', () => {
  const result = plan({
    primaryIsHead: true,
    primaryStatus: { ok: false, dirty: true },
  });
  assert.equal(result.recommendation, 'do_not_cleanup');
  assert.ok(result.blockers.includes('primary_worktree_status_unavailable'));
});

test('dirty target worktree still blocks', () => {
  const result = plan({ dirtyTargetCount: 1 });
  assert.equal(result.recommendation, 'do_not_cleanup');
  assert.ok(result.blockers.includes('dirty_worktree'));
});

test('Cindy-managed worktree is left to its task', () => {
  const result = plan({ cindyManagedWorktree: true });
  assert.equal(result.recommendation, 'leave_to_cindy_task');
  assert.equal(result.canCleanupLocal, false);
  assert.ok(result.blockers.includes('cindy_managed_worktree'));
});

test('closed unmerged still requires a decision', () => {
  const result = plan({ merged: false });
  assert.equal(result.recommendation, 'do_not_cleanup');
  assert.ok(result.blockers.includes('closed_unmerged_requires_user_decision'));
});

test('clean primary emits switch, pull, prune, and forced worktree remove', () => {
  const commands = buildCleanupCommands({
    primaryWorktree: PRIMARY,
    baseRef: 'main',
    headRef: 'feature/pr',
    localBranchExists: true,
    targetWorktrees: [{ path: SIBLING }],
    syncPrimary: true,
  });
  assert.deepEqual(commandKinds(commands), [
    `worktree remove --force ${SIBLING}`,
    'branch -D feature/pr',
    'switch main',
    'pull --ff-only origin main',
    'worktree prune',
  ]);
});

test('dirty primary omits switch/pull but still removes sibling worktree and branch', () => {
  const commands = buildCleanupCommands({
    primaryWorktree: PRIMARY,
    baseRef: 'main',
    headRef: 'feature/pr',
    localBranchExists: true,
    targetWorktrees: [{ path: SIBLING }],
    syncPrimary: false,
  });
  assert.deepEqual(commandKinds(commands), [
    `worktree remove --force ${SIBLING}`,
    'branch -D feature/pr',
    'worktree prune',
  ]);
});

test('local commits the PR does not contain block cleanup even when the worktree is clean', () => {
  const result = plan({ localWorkNotInPr: true });
  assert.equal(result.recommendation, 'do_not_cleanup');
  assert.equal(result.canCleanupLocal, false);
  assert.ok(result.blockers.includes('local_commits_not_in_pr'));
});

test('a remote matches the PR repository by its whole name, not by a shared prefix', () => {
  const remotes = [
    'origin\thttps://github.com/acme/app-tools.git (fetch)',
    'origin\thttps://github.com/acme/app-tools.git (push)',
    'fork\tgit@github.com:Acme/App.git (fetch)',
    'ci\thttps://example.com/acme/app (fetch)',
  ].join('\n');
  const names = githubRepoNamesOfRemotes(remotes);
  assert.deepEqual(names.sort(), ['acme/app', 'acme/app-tools']);
  assert.equal(githubRepoNamesOfRemotes('origin\thttps://github.com/acme/app-tools.git (fetch)').includes('acme/app'), false);
});

test('a fork checkout syncs the base branch from the remote of the PR base repository', () => {
  const remotes = [
    'origin\thttps://github.com/me/app.git (fetch)',
    'upstream\thttps://github.com/Acme/App.git (fetch)',
  ].join('\n');
  assert.equal(remoteNameForRepo(remotes, 'acme/app'), 'upstream');
  assert.equal(remoteNameForRepo(remotes, 'nobody/else'), null);
  const commands = buildCleanupCommands({
    primaryWorktree: PRIMARY, baseRef: 'main', headRef: 'feature/pr', localBranchExists: true, targetWorktrees: [], baseRemote: 'upstream',
  });
  assert.ok(commands.some(entry => entry.argv.join(' ').endsWith('pull --ff-only upstream main')));
});

test('only the fetch URL of a remote decides which repository it points at', () => {
  const remotes = 'origin\thttps://github.com/me/app.git (fetch)\norigin\thttps://github.com/acme/app.git (push)\n';
  assert.equal(remoteNameForRepo(remotes, 'acme/app'), null, 'a push URL alone does not make a remote the base repository');
  assert.deepEqual(githubRepoNamesOfRemotes(remotes), ['me/app', 'acme/app']);
});

test('a worktree on another branch is not the PR\'s just because it sits on the same commit', () => {
  const sha = 'a'.repeat(40);
  const own = { branch: 'feature/pr', head: sha };
  const other = { branch: 'other', head: sha };
  const detached = { branch: null, head: sha, detached: true };
  assert.equal(isPrWorktree(own, { headRef: 'feature/pr', headSha: sha, fromFork: false }), true);
  assert.equal(isPrWorktree(other, { headRef: 'feature/pr', headSha: sha, fromFork: false }), false);
  assert.equal(isPrWorktree(detached, { headRef: 'feature/pr', headSha: sha, fromFork: false }), false);
  // A fork PR: the name alone is not proof, but the same commit on that name, or detached there, is.
  assert.equal(isPrWorktree({ branch: 'feature/pr', head: 'b'.repeat(40) }, { headRef: 'feature/pr', headSha: sha, fromFork: true }), false);
  assert.equal(isPrWorktree(own, { headRef: 'feature/pr', headSha: sha, fromFork: true }), true);
  assert.equal(isPrWorktree(detached, { headRef: 'feature/pr', headSha: sha, fromFork: true }), true);
  assert.equal(isPrWorktree(other, { headRef: 'feature/pr', headSha: sha, fromFork: true }), false);
});

test('only the real github.com host counts as a GitHub remote', () => {
  assert.equal(githubRepoOfUrl('https://github.com/acme/app.git'), 'acme/app');
  assert.equal(githubRepoOfUrl('git@github.com:Acme/App.git'), 'Acme/App');
  assert.equal(githubRepoOfUrl('ssh://git@github.com/acme/app'), 'acme/app');
  for (const url of ['https://evilgithub.com/acme/app.git', 'ssh://git@evilgithub.com/acme/app.git', 'git@evilgithub.com:acme/app.git',
    'https://github.com.evil.net/acme/app', '/local/path/github.com/acme/app']) assert.equal(githubRepoOfUrl(url), undefined, url);
  assert.deepEqual(githubRepoNamesOfRemotes('origin\thttps://evilgithub.com/acme/app.git (fetch)'), []);
  assert.equal(remoteNameForRepo('origin\thttps://evilgithub.com/acme/app.git (fetch)', 'acme/app'), null);
});

test('long-lived branches include the repository default branch, whatever it is called', () => {
  for (const name of ['main', 'master', 'develop', 'release/1', 'hotfix/2', 'support/3']) assert.equal(isLongLivedBranch(name), true, name);
  assert.equal(isLongLivedBranch('trunk'), false, 'unknown name without metadata looks like a topic branch');
  assert.equal(isLongLivedBranch('trunk', ['trunk']), true, 'the actual default branch is protected');
  assert.equal(isLongLivedBranch('trunk', ['main']), false);
  assert.equal(isLongLivedBranch('fix/x', ['trunk', 'main']), false);
  assert.equal(isLongLivedBranch('', ['']), false);
  // The planner refuses to clean up a protected head even when it is merged into a release branch.
  const result = plan({ longLivedBranch: isLongLivedBranch('trunk', ['trunk']) });
  assert.equal(result.canCleanupLocal, false);
});
