/**
 * Explicit user-authorized zero-queue direct merge for pr-heartbeat-gate.mjs.
 *
 * Security & fail-closed invariants:
 * - Default OFF everywhere. Only a policy written by a real human click on the
 *   PR card (per-PR or strictly single-repo, bound to the verified GitHub actor)
 *   can authorize direct merging. Policy for one repo never carries to another.
 * - Executes inside preRunHook (before queueing into a busy target session),
 *   consuming zero model tokens and touching zero local worktrees.
 * - Re-verifies live GraphQL PR state, viewer login, repository permission,
 *   branch protection / rulesets, CLEAN merge state, and exact 40-char head SHA
 *   before issuing PUT /repos/{owner}/{repo}/pulls/{number}/merge with sha match.
 * - Strictly distinguishes not-executed / executed / unknown. Persists a pending
 *   marker BEFORE the external write and NEVER retries an unknown or rejected SHA.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { ghGraphQL, ghJson, splitHttpResponse } from './gh.mjs';

const exec = promisify(execFile);

const POLICY_FILENAME = '.auto-merge-policy.json';
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[a-f0-9]{40}$/i;
const MERGE_METHODS = new Set(['MERGE', 'SQUASH', 'REBASE']);
const REJECTED_STATUS_RE = /^(400|401|403|404|405|409|422|429)$/;

const PR_MERGE_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){viewer{id login} repository(owner:$owner,name:$name){' +
  'id viewerPermission viewerDefaultMergeMethod mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed ' +
  'pullRequest(number:$number){id state isDraft merged mergeable mergeStateStatus headRefOid mergeQueue{id} ' +
  'baseRef{name branchProtectionRule{restrictsPushes lockBranch requiresLinearHistory} ' +
  'rules(first:100){pageInfo{hasNextPage} nodes{type repositoryRuleset{databaseId} parameters{... on PullRequestParameters{allowedMergeMethods}}}}}}}}';

const PR_MERGED_RECHECK_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){' +
  'pullRequest(number:$number){state merged headRefOid}}}';

export function autoMergePolicyPath(stateDir) {
  return path.join(stateDir, POLICY_FILENAME);
}

export function readAutoMergePolicy(stateDir) {
  if (!stateDir) return { version: 1, prs: {}, repos: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(autoMergePolicyPath(stateDir), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { version: 1, prs: {}, repos: {} };
    }
    return {
      version: 1,
      prs: parsed.prs && typeof parsed.prs === 'object' && !Array.isArray(parsed.prs) ? parsed.prs : {},
      repos: parsed.repos && typeof parsed.repos === 'object' && !Array.isArray(parsed.repos) ? parsed.repos : {},
    };
  } catch {
    return { version: 1, prs: {}, repos: {} };
  }
}

/**
 * Match an explicit user auto-merge policy for this exact PR or exact single repo.
 * Requires matching verified GitHub viewer login; per-PR also binds the base branch.
 */
export function matchAutoMergePolicy(policy, { repo, number, viewer, baseRefName }) {
  if (!policy || typeof policy !== 'object') return null;
  const repoKey = typeof repo === 'string' && REPO_RE.test(repo.trim()) ? repo.trim().toLowerCase() : '';
  const actorKey = typeof viewer === 'string' ? viewer.trim().toLowerCase() : '';
  const prNum = Number(number);
  const base = typeof baseRefName === 'string' ? baseRefName.trim() : '';
  if (!repoKey || !actorKey || !Number.isInteger(prNum) || prNum <= 0 || !base) return null;

  const prEntry = policy.prs && policy.prs[`${repoKey}#${prNum}`];
  if (
    prEntry &&
    typeof prEntry === 'object' &&
    String(prEntry.repo || '').toLowerCase() === repoKey &&
    Number(prEntry.number) === prNum &&
    String(prEntry.actor || '').toLowerCase() === actorKey &&
    String(prEntry.base || '') === base
  ) {
    return { scope: 'pr', entry: prEntry };
  }

  const repoEntry = policy.repos && policy.repos[repoKey];
  if (
    repoEntry &&
    typeof repoEntry === 'object' &&
    String(repoEntry.repo || '').toLowerCase() === repoKey &&
    String(repoEntry.actor || '').toLowerCase() === actorKey
  ) {
    return { scope: 'repo', entry: repoEntry };
  }

  return null;
}

/**
 * Strict fail-closed eligibility gate on the full PR snapshot + settle window.
 * Every check must pass, all review threads (active AND outdated) must be zero,
 * required-check rules must be readable, and bot settling must be finished.
 */
export function isSnapshotEligibleForAutoMerge(snap, settle) {
  if (!snap || typeof snap !== 'object') return false;
  if (snap.state !== 'OPEN' || snap.merged === true || snap.closed === true || snap.isDraft === true) {
    return false;
  }
  if (snap.verdict !== 'READY') return false;
  if (settle?.open === true) return false;
  if (snap.gate?.truncated === true || snap.gate?.requiredChecksUnavailable === true) return false;
  const checks = snap.checksSummary;
  if (!checks || checks.unavailable === true || checks.truncated === true) return false;
  if ((Number(checks.pending) || 0) > 0 || (Number(checks.failed) || 0) > 0 || (Number(checks.actionRequired) || 0) > 0) {
    return false;
  }
  const threads = snap.reviewThreads;
  if (!threads || threads.truncated === true) return false;
  if ((Number(threads.activeUnresolvedCount) || 0) > 0 || (Number(threads.outdatedUnresolvedCount) || 0) > 0) {
    return false;
  }
  if (typeof threads.rawUnresolvedCount === 'number' && threads.rawUnresolvedCount > 0) return false;
  if (!SHA_RE.test(String(snap.latestCommitOid || ''))) return false;
  if (snap.mergeable !== true || snap.mergeStateStatus !== 'CLEAN') return false;
  if (!snap.mergeQueue || snap.mergeQueue.status !== 'NONE') return false;
  if (Array.isArray(snap.blockers) && snap.blockers.length > 0) return false;
  return true;
}

/**
 * Whether an existing auto-merge attempt on this exact head SHA blocks another try.
 * Unknown, pending (crashed mid-write), rejected, or merged attempts NEVER auto-retry.
 */
export function hasBlockedAutoMergeAttempt(previous, headSha) {
  const attempt = previous?.autoMergeAttempt;
  if (!attempt || typeof attempt !== 'object' || !headSha) return false;
  if (attempt.sha !== headSha) return false;
  return ['pending', 'unknown', 'rejected', 'merged'].includes(attempt.status);
}

/**
 * Whether probe-skipping should be bypassed so a newly enabled auto-merge policy
 * can evaluate an already-READY PR without waiting 30 minutes for a full reread.
 */
export function shouldBypassProbeForAutoMerge(previous, policy, { repo, number }) {
  if (!previous || previous.merged || previous.closed) return false;
  if (previous.verdict !== 'READY') return false;
  if (!previous.headOid || hasBlockedAutoMergeAttempt(previous, previous.headOid)) return false;
  const repoKey = String(repo || '').toLowerCase();
  const hasAnyPolicy = Boolean(
    (policy?.prs && policy.prs[`${repoKey}#${number}`]) ||
    (policy?.repos && policy.repos[repoKey]),
  );
  return hasAnyPolicy;
}

async function canBypassUpdateRulesets(owner, name, ruleNodes, runRestGet) {
  const ids = [];
  for (const rule of ruleNodes) {
    if (!rule || rule.type !== 'UPDATE') continue;
    const id = rule.repositoryRuleset?.databaseId;
    if (!Number.isInteger(id) || id <= 0) return false;
    if (!ids.includes(id)) ids.push(id);
  }
  for (const id of ids) {
    let data;
    try {
      data = await runRestGet(`repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/rulesets/${id}`);
    } catch {
      return false;
    }
    if (!data || !/^(always|pull_requests_only|exempt)$/.test(String(data.current_user_can_bypass || ''))) {
      return false;
    }
  }
  return true;
}

/**
 * Live pre-merge verification mirroring main.js fetchPrMergeInfo (#375).
 */
export async function verifyLivePrMergeTarget({
  repo,
  number,
  expectedSha,
  expectedBase,
  expectedViewer,
  preferredMethod,
  runGraphQL = (query, vars) => ghGraphQL(query, vars, { retries: 0 }),
  runRestGet = (apiPath) => ghJson(apiPath, { retries: 0, fatalExit: false }),
}) {
  const slash = String(repo || '').indexOf('/');
  if (slash <= 0 || !SHA_RE.test(String(expectedSha || ''))) {
    return { ok: false, reason: 'invalid-target' };
  }
  const owner = repo.slice(0, slash);
  const name = repo.slice(slash + 1);
  let res;
  try {
    res = await runGraphQL(PR_MERGE_QUERY, { owner, name, number });
  } catch (err) {
    return { ok: false, reason: `verify-query-failed:${String(err?.message || err).slice(0, 120)}` };
  }
  const data = res?.data;
  const viewer = data?.viewer;
  const repository = data?.repository;
  const pr = repository?.pullRequest;
  if (!viewer?.id || !viewer?.login || !repository?.id || !pr?.id) {
    return { ok: false, reason: 'verify-incomplete' };
  }
  if (String(viewer.login).toLowerCase() !== String(expectedViewer || '').toLowerCase()) {
    return { ok: false, reason: 'actor-mismatch' };
  }
  if (!/^(WRITE|MAINTAIN|ADMIN)$/.test(String(repository.viewerPermission || ''))) {
    return { ok: false, reason: 'viewer-permission-denied' };
  }
  if (pr.merged === true) {
    return { ok: false, reason: 'already-merged', alreadyMerged: true };
  }
  if (pr.state !== 'OPEN' || pr.isDraft !== false || pr.mergeQueue !== null) {
    return { ok: false, reason: 'pr-state-changed' };
  }
  if (!pr.baseRef?.name || pr.baseRef.name !== expectedBase) {
    return { ok: false, reason: 'base-branch-changed' };
  }
  if (pr.headRefOid !== expectedSha) {
    return { ok: false, reason: 'head-sha-changed' };
  }
  if (pr.mergeable !== 'MERGEABLE' || pr.mergeStateStatus !== 'CLEAN') {
    return { ok: false, reason: `merge-state-${pr.mergeStateStatus || pr.mergeable || 'unknown'}` };
  }
  const protection = pr.baseRef.branchProtectionRule;
  const rules = pr.baseRef.rules;
  if (
    (protection !== null && (!protection || protection.restrictsPushes !== false || protection.lockBranch !== false)) ||
    !rules ||
    !rules.pageInfo ||
    rules.pageInfo.hasNextPage !== false ||
    !Array.isArray(rules.nodes) ||
    rules.nodes.some((rule) => !rule || !rule.type || /^(LOCK_BRANCH|MERGE_QUEUE|MERGE_QUEUE_LOCKED_REF)$/.test(rule.type))
  ) {
    return { ok: false, reason: 'branch-rules-disallowed' };
  }
  if (!(await canBypassUpdateRulesets(owner, name, rules.nodes, runRestGet))) {
    return { ok: false, reason: 'update-ruleset-blocked' };
  }
  const methods = [
    repository.mergeCommitAllowed === true &&
      !(protection && protection.requiresLinearHistory) &&
      !rules.nodes.some((rule) => rule.type === 'REQUIRED_LINEAR_HISTORY')
      ? 'MERGE'
      : null,
    repository.squashMergeAllowed === true ? 'SQUASH' : null,
    repository.rebaseMergeAllowed === true ? 'REBASE' : null,
  ].filter((method) =>
    method &&
    rules.nodes.every((rule) => {
      const allowed = rule.type === 'PULL_REQUEST' && rule.parameters?.allowedMergeMethods;
      return !Array.isArray(allowed) || allowed.includes(method);
    }),
  );
  const preferredUpper = typeof preferredMethod === 'string' ? preferredMethod.toUpperCase() : '';
  const method = MERGE_METHODS.has(preferredUpper) && methods.includes(preferredUpper)
    ? preferredUpper
    : methods.includes(repository.viewerDefaultMergeMethod)
      ? repository.viewerDefaultMergeMethod
      : methods[0];
  if (!method) return { ok: false, reason: 'no-allowed-merge-method' };
  return {
    ok: true,
    target: {
      sha: pr.headRefOid,
      base: pr.baseRef.name,
      method: method.toLowerCase(),
      actor: viewer.login,
    },
  };
}

/**
 * Default production executor: PUT /repos/{owner}/{repo}/pulls/{number}/merge
 * via execFile('gh', ...) with --include and exact sha match.
 */
export async function defaultExecuteMerge({ repo, number, sha, method }) {
  const slash = repo.indexOf('/');
  const owner = encodeURIComponent(repo.slice(0, slash));
  const name = encodeURIComponent(repo.slice(slash + 1));
  const endpoint = `repos/${owner}/${name}/pulls/${number}/merge`;
  try {
    const { stdout } = await exec(
      'gh',
      ['api', '--include', '-X', 'PUT', endpoint, '-f', `sha=${sha}`, '-f', `merge_method=${method}`],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    const { statusCode, body } = splitHttpResponse(stdout);
    let data = null;
    try { data = JSON.parse(body); } catch { data = null; }
    return { statusCode, data, error: null };
  } catch (err) {
    const { statusCode, body } = splitHttpResponse(String(err?.stdout ?? ''));
    let data = null;
    try { data = body ? JSON.parse(body) : null; } catch { data = null; }
    const statusFromStderr = /\bHTTP (\d{3})\b/.exec(String(err?.stderr ?? ''))?.[1];
    return {
      statusCode: statusCode ?? (statusFromStderr ? Number(statusFromStderr) : null),
      data,
      error: String(err?.stderr || err?.message || err).slice(0, 240),
    };
  }
}

async function defaultRecheckMerged({ repo, number, runGraphQL = (q, v) => ghGraphQL(q, v, { retries: 0 }) }) {
  const slash = repo.indexOf('/');
  const owner = repo.slice(0, slash);
  const name = repo.slice(slash + 1);
  try {
    const res = await runGraphQL(PR_MERGED_RECHECK_QUERY, { owner, name, number });
    const pr = res?.data?.repository?.pullRequest;
    return { known: Boolean(pr), merged: pr?.merged === true };
  } catch {
    return { known: false, merged: false };
  }
}

/**
 * Execute an explicitly authorized auto-merge with strict 3-state semantics:
 *   - 'not-eligible' (no write sent)
 *   - 'merged'       (confirmed merged on GitHub)
 *   - 'rejected'     (explicit GitHub rejection / 4xx, not merged)
 *   - 'unknown'      (write sent, outcome uncertain — fail closed, never retry SHA)
 */
export async function attemptAutoMerge({
  repo,
  number,
  snap,
  match,
  now,
  persistBeforeWrite,
  verifyTarget = verifyLivePrMergeTarget,
  executeMerge = defaultExecuteMerge,
  recheckMerged = defaultRecheckMerged,
}) {
  const expectedSha = snap.latestCommitOid;
  const verified = await verifyTarget({
    repo,
    number,
    expectedSha,
    expectedBase: snap.baseRefName,
    expectedViewer: snap.viewer,
    preferredMethod: match.entry?.method,
  });
  if (!verified.ok) {
    if (verified.alreadyMerged) {
      return { outcome: 'merged', sha: expectedSha, method: match.entry?.method || 'merge', scope: match.scope, alreadyMerged: true };
    }
    return { outcome: 'not-eligible', reason: verified.reason || 'verification-failed' };
  }

  const target = verified.target;
  // Persist the pending write marker BEFORE touching GitHub so a crash mid-request
  // never leaves the next tick free to blindly retry an unknown external write.
  try {
    persistBeforeWrite({
      sha: target.sha,
      status: 'pending',
      method: target.method,
      scope: match.scope,
      actor: target.actor,
      at: now,
    });
  } catch (err) {
    return { outcome: 'not-eligible', reason: `state-persist-failed:${String(err?.message || err).slice(0, 120)}` };
  }

  let res;
  try {
    res = await executeMerge({ repo, number, sha: target.sha, method: target.method });
  } catch (err) {
    res = { statusCode: null, data: null, error: String(err?.message || err).slice(0, 200) };
  }

  if (res?.data && res.data.merged === true) {
    return { outcome: 'merged', sha: target.sha, method: target.method, scope: match.scope, actor: target.actor };
  }
  const statusStr = res?.statusCode != null ? String(res.statusCode) : '';
  if ((res?.data && res.data.merged === false) || REJECTED_STATUS_RE.test(statusStr)) {
    return {
      outcome: 'rejected',
      sha: target.sha,
      method: target.method,
      scope: match.scope,
      statusCode: res?.statusCode ?? null,
      reason: String(res?.data?.message || res?.error || `HTTP ${statusStr || 'rejected'}`).slice(0, 200),
    };
  }

  // Ambiguous result after request may have been sent: perform one read-only recheck.
  const recheck = await recheckMerged({ repo, number }).catch(() => ({ known: false, merged: false }));
  if (recheck.merged === true) {
    return {
      outcome: 'merged',
      sha: target.sha,
      method: target.method,
      scope: match.scope,
      actor: target.actor,
      confirmedByRecheck: true,
    };
  }
  return {
    outcome: 'unknown',
    sha: target.sha,
    method: target.method,
    scope: match.scope,
    reason: String(res?.error || `ambiguous-status-${statusStr || 'none'}`).slice(0, 200),
  };
}
