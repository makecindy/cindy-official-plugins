/**
 * Pure cleanup-plan decisions for a terminal GitHub PR.
 *
 * The planner script gathers git/gh facts; this module decides what is safe
 * to delete versus what must wait. Primary-worktree dirtiness only blocks
 * switch/pull, not sibling worktree or local branch removal.
 */

const STATIC_NOTES = [
  'Remote branch deletion is not part of this plan.',
  'A squash/rebase merge can make local head commits non-ancestors even when the PR is merged; merged=true is the remote source of truth for local branch disposability.',
  'Cindy-managed worktrees (.cindy-worktrees/ or .xdt-worktrees/) belong to their Cindy task; Cindy removes the folder when that task is archived or deleted, so this plan never touches them.',
];

export function command(argv, description) {
  return { description, argv };
}

/**
 * Build the currently-safe cleanup commands.
 *
 * `syncPrimary=false` omits switch/pull. Worktree removal always uses
 * `--force` because callers only pass worktrees already judged clean;
 * the flag exists to bypass git 2.50's submodule hard-reject, not to
 * discard uncommitted changes.
 */
export function buildCleanupCommands({
  primaryWorktree,
  baseRef,
  headRef,
  localBranchExists,
  targetWorktrees,
  syncPrimary = true,
  baseRemote = 'origin',
}) {
  const commands = [];
  const removableWorktrees = targetWorktrees.filter(worktree => worktree.path !== primaryWorktree);
  const primaryIsHead = targetWorktrees.some(worktree => worktree.path === primaryWorktree);

  for (const worktree of removableWorktrees) {
    commands.push(command(
      ['git', '-C', primaryWorktree, 'worktree', 'remove', '--force', worktree.path],
      `Remove PR worktree ${worktree.path}`,
    ));
  }
  if (primaryIsHead && syncPrimary) {
    commands.push(command(
      ['git', '-C', primaryWorktree, 'switch', baseRef],
      `Leave head branch ${headRef} before deleting it`,
    ));
  }
  if (localBranchExists && (!primaryIsHead || syncPrimary)) {
    commands.push(command(
      ['git', '-C', primaryWorktree, 'branch', '-D', headRef],
      `Delete local head branch ${headRef}`,
    ));
  }
  if (!primaryIsHead && syncPrimary) {
    commands.push(command(
      ['git', '-C', primaryWorktree, 'switch', baseRef],
      `Switch primary worktree to ${baseRef}`,
    ));
  }
  if (syncPrimary) {
    commands.push(command(
      ['git', '-C', primaryWorktree, 'pull', '--ff-only', baseRemote, baseRef],
      `Fast-forward ${baseRef}`,
    ));
  }
  commands.push(command(
    ['git', '-C', primaryWorktree, 'worktree', 'prune'],
    'Prune stale worktree metadata',
  ));
  return commands;
}

/**
 * Decide local cleanup from already-collected facts.
 *
 * `primary_worktree_dirty` / `primary_worktree_status_unavailable` are
 * blockers only when the PR branch is checked out on primary (must switch
 * away before deleting the branch). Otherwise they skip sync and still
 * allow sibling worktree + local branch removal.
 */
export function planLocalCleanup({
  terminal,
  merged,
  longLivedBranch,
  primaryStatus,
  primaryIsHead,
  dirtyTargetCount,
  hasLocalArtifacts,
  cindyManagedWorktree = false,
  localWorkNotInPr = false,
}) {
  const blockers = [];
  const notes = [...STATIC_NOTES];

  if (!terminal) blockers.push('pr_not_terminal');
  if (longLivedBranch) blockers.push('long_lived_branch');
  if (dirtyTargetCount > 0) blockers.push('dirty_worktree');
  if (!hasLocalArtifacts) blockers.push('nothing_local_to_cleanup');
  if (terminal && !merged) blockers.push('closed_unmerged_requires_user_decision');
  if (cindyManagedWorktree) blockers.push('cindy_managed_worktree');
  // Commits made after the PR head (not pushed, so `git status` stays clean) would be lost with `branch -D`.
  if (localWorkNotInPr) blockers.push('local_commits_not_in_pr');

  const primaryReadable = Boolean(primaryStatus?.ok);
  const primaryDirty = primaryReadable && Boolean(primaryStatus.dirty);
  const cannotLeavePrimaryHead = Boolean(primaryIsHead) && (!primaryReadable || primaryDirty);

  if (cannotLeavePrimaryHead) {
    blockers.push(primaryReadable ? 'primary_worktree_dirty' : 'primary_worktree_status_unavailable');
  } else if (!primaryReadable) {
    notes.push('Primary worktree status is unreadable; skipped switch/pull. Sibling worktree and local branch can still be removed.');
  } else if (primaryDirty) {
    notes.push('Primary worktree is dirty; skipped switch/pull. Sibling worktree and local branch can still be removed.');
  }

  const canRemoveLocalArtifacts = Boolean(terminal)
    && Boolean(merged)
    && !longLivedBranch
    && dirtyTargetCount === 0
    && !cindyManagedWorktree
    && !localWorkNotInPr
    && Boolean(hasLocalArtifacts)
    && !cannotLeavePrimaryHead;

  const canSyncPrimary = primaryReadable && !primaryDirty;

  let recommendation = 'do_not_cleanup';
  if (cindyManagedWorktree) recommendation = 'leave_to_cindy_task';
  else if (canRemoveLocalArtifacts) recommendation = 'remove_local_worktree_and_branch';

  return {
    recommendation,
    blockers,
    notes,
    canRemoveLocalArtifacts,
    canCleanupLocal: canRemoveLocalArtifacts,
    canSyncPrimary,
  };
}

/**
 * `owner/repo` of a remote URL whose host is exactly github.com (https, ssh:// and scp-style), else undefined.
 * The host must stand alone: `evilgithub.com` and `github.com.evil.net` do not count.
 */
export function githubRepoOfUrl(url) {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/(?:[^/@]*@)?|[^/@:]+@)(?:www\.)?github\.com(?::\d+)?[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(String(url));
  return m?.[1];
}

/** `owner/repo` of every GitHub remote in `git remote -v` output, lower-cased; the whole name must match, not a prefix. */
export function githubRepoNamesOfRemotes(remoteVerbose) {
  const names = new Set();
  for (const line of String(remoteVerbose).split('\n')) {
    const url = /^\S+\s+(\S+)/.exec(line)?.[1] ?? '';
    const name = githubRepoOfUrl(url);
    if (name) names.add(name.toLowerCase());
  }
  return [...names];
}

/** The remote whose fetch URL is `repoName` (owner/repo, any case); null when none is. */
export function remoteNameForRepo(remoteVerbose, repoName) {
  const wanted = String(repoName ?? '').toLowerCase();
  for (const line of String(remoteVerbose).split('\n')) {
    // `git remote -v` lists fetch and push URLs; the fetch one is where branches are read from.
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line);
    if (!m) continue;
    const repo = githubRepoOfUrl(m[2]);
    if (repo && repo.toLowerCase() === wanted) return m[1];
  }
  return null;
}

/**
 * Whether a worktree belongs to the PR. It does when it has the PR's branch checked out; for a fork PR, where a
 * branch name is not proof, that branch must also sit on the PR's head commit, or the worktree is detached there.
 * Another branch that happens to sit on the same commit is never taken.
 */
export function isPrWorktree(worktree, { headRef, headSha, fromFork }) {
  const onHead = Boolean(headSha) && worktree.head === headSha;
  if (worktree.branch === headRef) return !fromFork || onHead;
  return fromFork && onHead && worktree.detached === true;
}

const LONG_LIVED_BRANCHES = new Set(['main', 'master', 'develop', 'dev', 'staging', 'production']);
const LONG_LIVED_PREFIXES = ['release/', 'hotfix/', 'support/'];

/**
 * Whether a PR head branch is a long-lived branch that cleanup must never delete. Besides the common names,
 * the repositories' actual default branches (for example `trunk`) are protected: a PR can merge the default
 * branch into a release branch, and that head must not look like a throwaway topic branch.
 */
export function isLongLivedBranch(name, defaultBranches = []) {
  if (!name) return false;
  return defaultBranches.includes(name)
    || LONG_LIVED_BRANCHES.has(name)
    || LONG_LIVED_PREFIXES.some(prefix => name.startsWith(prefix));
}
