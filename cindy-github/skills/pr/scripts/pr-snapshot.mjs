#!/usr/bin/env node
// Stable read-only GitHub PR snapshot for PR heartbeat tasks.
//
// Keep heartbeat prompts from hand-writing mixed gh/GraphQL field lists. This
// script centralizes the API shape and uses execFile-based gh wrappers so shell
// quoting cannot corrupt long GraphQL queries.

import { ensureBinary, ghGraphQL, ghJson, ghJsonConditional } from './lib/gh.mjs';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePullRequestTarget } from './lib/repo-target.mjs';
import { applyRequiredChecks, requiredChecksOf } from './lib/required-checks.mjs';
import { classifyMergeQueue } from './lib/merge-queue.mjs';
import { uncorroboratedApprovalCommits } from './lib/follow-pacing.mjs';

const PASS_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const FAIL_CONCLUSIONS = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STALE', 'STARTUP_FAILURE']);
const ACTION_REQUIRED_CONCLUSIONS = new Set(['ACTION_REQUIRED']);
const PENDING_STATES = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'REQUESTED', 'WAITING', 'EXPECTED']);
const VERDICT_EXIT_CODES = {
  READY: 0,
  MERGED_CLEANUP_READY: 0,
  WAITING_CI: 10,
  NEEDS_WORK: 20,
  BLOCKED_HUMAN: 30,
  NOT_READY: 40,
  CLOSED_CLEANUP_REVIEW: 40,
};

function usage() {
  process.stderr.write(`Usage: node scripts/pr-snapshot.mjs <pr-number-or-url> [--repo owner/name] [--state-dir <dir>] [--strict-exit]\n`);
}

function parseArgs(argv, env = process.env) {
  let repo = null;
  let prArg = null;
  let strictExit = false;
  let probe = false;
  let expectHead = null;
  let stateDir = env.CINDY_PR_STATE_DIR?.trim() || null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '--expect-head') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a commit SHA`);
      expectHead = value;
      continue;
    }
    if (arg === '--state-dir') {
      const value = argv[++i];
      if (!value || !value.trim() || value.startsWith('--')) throw new Error(`${arg} needs a directory path`);
      stateDir = value.trim();
      continue;
    }
    if (arg === '--repo') {
      repo = argv[++i];
      continue;
    }
    if (arg === '--strict-exit') {
      strictExit = true;
      continue;
    }
    if (arg === '--probe') {
      probe = true;
      continue;
    }
    if (!prArg) {
      prArg = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  if (probe && expectHead) throw new Error('--expect-head cannot be used with --probe');
  return {
    expectHead,
    stateDir,
    ...resolvePullRequestTarget(prArg, { explicitRepo: repo }),
    strictExit,
    probe,
  };
}

const MAX_RULES_CACHE_ENTRIES = 20;
const PR_REST_CACHE_SCHEMA = 2;
const RULES_CACHE_SCHEMA = 2;

function safeCacheSlug(repo) {
  return String(repo).replace(/[^a-zA-Z0-9._-]+/g, '__');
}

function prRestCachePath(stateDir, repo, number) {
  return path.join(stateDir, `${safeCacheSlug(repo)}-${number}.rest-cache.json`);
}

function repoRulesCachePath(stateDir, repo) {
  return path.join(stateDir, `${safeCacheSlug(repo)}.rules-cache.json`);
}

function readJsonCache(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonCacheAtomic(filePath, payload) {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  } catch {
    // ETag cache writes are best-effort optimizations and never fail a snapshot.
  }
}

function isValidPullCacheData(data) {
  return Boolean(data && typeof data === 'object' && !Array.isArray(data) && typeof data.state === 'string' && data.head && typeof data.head === 'object');
}

/**
 * Persist only the minimal fields that pr-snapshot.mjs actually consumes from
 * REST `repos/{owner}/{repo}/pulls/{number}` — never bodies, reviewers, or
 * nested repository payloads.
 */
function pickPullCacheData(data) {
  if (!isValidPullCacheData(data)) return null;
  return {
    ...(typeof data.html_url === 'string' ? { html_url: data.html_url } : {}),
    ...(typeof data.title === 'string' ? { title: data.title } : {}),
    state: data.state,
    merged: Boolean(data.merged),
    mergeable: typeof data.mergeable === 'boolean' ? data.mergeable : null,
    mergeable_state: typeof data.mergeable_state === 'string' ? data.mergeable_state : null,
    head: { sha: typeof data.head.sha === 'string' ? data.head.sha : null },
    additions: Number.isFinite(data.additions) ? data.additions : null,
    deletions: Number.isFinite(data.deletions) ? data.deletions : null,
    changed_files: Number.isFinite(data.changed_files) ? data.changed_files : null,
  };
}

/**
 * Persist only the required-status-check entries consumed by requiredChecksOf,
 * discarding unrelated branch rules and ruleset metadata.
 */
function pickBranchRulesCacheData(rules) {
  if (!Array.isArray(rules) || rules.length >= 100) return null;
  const projected = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue;
    if (rule.type !== 'required_status_checks') continue;
    const checks = rule.parameters?.required_status_checks;
    if (!Array.isArray(checks)) return null;
    const projectedChecks = [];
    for (const check of checks) {
      if (!check || typeof check !== 'object' || typeof check.context !== 'string' || !check.context) {
        return null;
      }
      projectedChecks.push({
        context: check.context,
        ...(Number.isInteger(check.integration_id) && check.integration_id > 0
          ? { integration_id: check.integration_id }
          : {}),
      });
    }
    projected.push({
      type: 'required_status_checks',
      parameters: { required_status_checks: projectedChecks },
    });
  }
  return projected;
}

async function fetchPrView(repo, number, stateDir) {
  const apiPath = `repos/${repo}/pulls/${number}`;
  const cachePath = stateDir ? prRestCachePath(stateDir, repo, number) : null;
  const cached = cachePath ? readJsonCache(cachePath) : null;
  const cachedData = cached?.schema === PR_REST_CACHE_SCHEMA && typeof cached.etag === 'string'
    ? pickPullCacheData(cached.data)
    : null;
  const validCached = cachedData ? { etag: cached.etag, data: cachedData } : null;
  const res = await ghJsonConditional(apiPath, {
    etag: validCached?.etag ?? null,
    includeHeaders: true,
  });
  if (res.notModified && validCached) {
    if (cachePath && res.etag && res.etag !== validCached.etag) {
      writeJsonCacheAtomic(cachePath, {
        schema: PR_REST_CACHE_SCHEMA,
        etag: res.etag,
        data: validCached.data,
        updatedAt: Date.now(),
      });
    }
    return { ...validCached.data, head: { ...validCached.data.head } };
  }
  const data = res.notModified
    ? await ghJson(apiPath, { includeHeaders: true })
    : res.data;
  const picked = pickPullCacheData(data);
  if (cachePath && res.etag && picked) {
    writeJsonCacheAtomic(cachePath, {
      schema: PR_REST_CACHE_SCHEMA,
      etag: res.etag,
      data: picked,
      updatedAt: Date.now(),
    });
  }
  return picked ?? data;
}

function upsertBranchRulesCache(cachePath, cacheKey, entry) {
  if (!cachePath) return;
  const freshStore = readJsonCache(cachePath);
  const prevEntries = freshStore?.schema === RULES_CACHE_SCHEMA && freshStore.entries && typeof freshStore.entries === 'object'
    ? { ...freshStore.entries }
    : {};
  prevEntries[cacheKey] = entry;
  const sortedEntries = Object.entries(prevEntries)
    .sort((a, b) => (Number(b[1]?.updatedAt) || 0) - (Number(a[1]?.updatedAt) || 0))
    .slice(0, MAX_RULES_CACHE_ENTRIES);
  writeJsonCacheAtomic(cachePath, { schema: RULES_CACHE_SCHEMA, entries: Object.fromEntries(sortedEntries) });
}

async function fetchBranchRules(repo, baseRefName, viewer, stateDir) {
  const apiPath = `repos/${repo}/rules/branches/${encodeURIComponent(baseRefName)}?per_page=100`;
  const cachePath = stateDir ? repoRulesCachePath(stateDir, repo) : null;
  const cacheKey = `${viewer ?? ''}:${baseRefName}`;
  const store = cachePath ? readJsonCache(cachePath) : null;
  const rawEntry = store?.schema === RULES_CACHE_SCHEMA && store.entries && typeof store.entries === 'object'
    ? store.entries[cacheKey]
    : null;
  const cachedRules = rawEntry && typeof rawEntry.etag === 'string'
    ? pickBranchRulesCacheData(rawEntry.rules)
    : null;
  const validEntry = cachedRules ? { etag: rawEntry.etag, rules: cachedRules } : null;
  const res = await ghJsonConditional(apiPath, {
    etag: validEntry?.etag ?? null,
    includeHeaders: true,
    fatalExit: false,
    retries: 1,
  });
  if (res.notModified && validEntry) {
    if (cachePath) {
      upsertBranchRulesCache(cachePath, cacheKey, {
        etag: res.etag || validEntry.etag,
        rules: validEntry.rules,
        updatedAt: Date.now(),
      });
    }
    return validEntry.rules;
  }
  const rules = res.notModified
    ? await ghJson(apiPath, { includeHeaders: true, fatalExit: false, retries: 1 })
    : res.data;
  // A full page may be truncated. Unknown is not an empty inventory; never cache incomplete rules.
  if (!Array.isArray(rules) || rules.length >= 100) throw new Error('Incomplete branch rules');
  const picked = pickBranchRulesCacheData(rules);
  if (cachePath && res.etag && picked) {
    upsertBranchRulesCache(cachePath, cacheKey, { etag: res.etag, rules: picked, updatedAt: Date.now() });
  }
  return picked ?? rules;
}

function lastCommit(prView) {
  const commits = Array.isArray(prView.commits) ? prView.commits : [];
  return commits.length ? commits[commits.length - 1] : null;
}

function isCheckPending(c) {
  if (!c) return false;
  if (c.type === 'CheckRun') return c.status && c.status !== 'COMPLETED';
  if (c.type === 'StatusContext') return PENDING_STATES.has(c.status);
  return PENDING_STATES.has(c.status);
}

function isCheckActionRequired(c) {
  return ACTION_REQUIRED_CONCLUSIONS.has(c?.conclusion);
}

function isCheckFailure(c) {
  if (!c) return false;
  if (c.type === 'StatusContext') return FAIL_CONCLUSIONS.has(c.status);
  if (!c.conclusion) return false;
  return !PASS_CONCLUSIONS.has(c.conclusion) && !isCheckActionRequired(c);
}

/** pending / failed / passed, as the gate's events read it (action-required counts as failed). */
function checkOutcome(c) {
  if (isCheckPending(c)) return 'pending';
  if (isCheckFailure(c) || isCheckActionRequired(c)) return 'failed';
  return 'passed';
}

/**
 * Keep only the latest run of each check. A re-run adds a new run under the same name and the
 * rollup keeps the old one, so a cancelled or failed attempt that a later run replaced would
 * otherwise count as failing forever (a follow-up woke 91 times on one such leftover).
 */
function latestChecks(checks) {
  const latest = new Map();
  for (const c of checks) {
    const key = `${c.workflowName ?? ''}\u0000${c.name ?? ''}`;
    const at = Date.parse(c.startedAt ?? c.completedAt ?? '') || 0;
    const kept = latest.get(key);
    if (!kept || at >= kept.at) latest.set(key, { at, check: c });
  }
  return [...latest.values()].map((entry) => entry.check);
}

function summarizeChecks(checks, unavailable, truncated, totalCount) {
  const pendingRuns = checks.filter(isCheckPending);
  const failingRuns = checks.filter(isCheckFailure);
  const actionRequiredRuns = checks.filter(isCheckActionRequired);
  return {
    total: checks.length,
    totalCount,
    pending: pendingRuns.length,
    failed: failingRuns.length,
    actionRequired: actionRequiredRuns.length,
    unavailable,
    truncated,
    pendingRuns,
    failingRuns,
    actionRequiredRuns,
  };
}

function addBlocker(blockers, condition, name) {
  if (condition) blockers.push(name);
}

function deriveVerdict({ pr, ghView, checksSummary, reviewThreads, truncated, mergeQueue }) {
  const needsWorkBlockers = [];
  const waitingBlockers = [];
  const humanBlockers = [];
  const mergeStateStatus = pr.mergeStateStatus || ghView.mergeable_state || null;
  const reviewDecision = pr.reviewDecision || null;
  const mergeable = ghView.mergeable ?? null;

  if (pr.merged || ghView.merged) {
    return { verdict: 'MERGED_CLEANUP_READY', blockers: [] };
  }
  if (pr.closed || pr.state === 'CLOSED' || ghView.state === 'closed') {
    return { verdict: 'CLOSED_CLEANUP_REVIEW', blockers: [] };
  }
  if (pr.isDraft || mergeStateStatus === 'DRAFT') {
    return { verdict: 'NOT_READY', blockers: ['draft'] };
  }

  addBlocker(needsWorkBlockers, checksSummary.unavailable, 'checks_unavailable');
  addBlocker(needsWorkBlockers, truncated, 'snapshot_truncated');
  addBlocker(needsWorkBlockers, checksSummary.failed > 0, 'ci_failing');
  addBlocker(needsWorkBlockers, reviewThreads.unresolvedCount > 0, 'unresolved_review_threads');
  addBlocker(needsWorkBlockers, mergeStateStatus === 'BEHIND', 'branch_behind_base');
  addBlocker(needsWorkBlockers, mergeStateStatus === 'DIRTY' || mergeable === false, 'merge_conflict');
  addBlocker(needsWorkBlockers, mergeStateStatus === 'UNSTABLE', 'merge_state_unstable');
  for (const blocker of mergeQueue.blockers) {
    if (blocker === 'check_action_required') humanBlockers.push(blocker);
    else (blocker === 'merge_queue_pending' ? waitingBlockers : needsWorkBlockers).push(blocker);
  }

  addBlocker(waitingBlockers, checksSummary.pending > 0, 'pending_checks');
  addBlocker(waitingBlockers, mergeable === null || mergeStateStatus === 'UNKNOWN', 'mergeability_pending');

  addBlocker(humanBlockers, checksSummary.actionRequired > 0, 'check_action_required');
  addBlocker(humanBlockers, mergeStateStatus === 'BLOCKED' || mergeStateStatus === 'HAS_HOOKS', 'branch_protection_blocked');
  addBlocker(humanBlockers, reviewDecision === 'REVIEW_REQUIRED', 'approval_required');
  addBlocker(humanBlockers, reviewDecision === 'CHANGES_REQUESTED', 'changes_requested_waiting_re_review');

  const blockers = [...needsWorkBlockers, ...waitingBlockers, ...humanBlockers];
  if (waitingBlockers.length > 0 && needsWorkBlockers.length === 0) {
    return { verdict: 'WAITING_CI', blockers };
  }
  if (needsWorkBlockers.length > 0) {
    return { verdict: 'NEEDS_WORK', blockers };
  }
  if (humanBlockers.length > 0) {
    return { verdict: 'BLOCKED_HUMAN', blockers };
  }

  return { verdict: 'READY', blockers };
}

function ghPrViewJson(number, repo) {
  return new Promise((resolve, reject) => {
    execFile('gh', [
      'pr',
      'view',
      String(number),
      '--repo',
      repo,
      '--json',
      'statusCheckRollup,commits,headRefOid',
    ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else {
        resolve(JSON.parse(stdout));
      }
    });
  });
}

function normalizeCheckRun(x) {
  if (!x || typeof x !== 'object') return null;
  return {
    type: x.__typename || null,
    name: x.name || x.context || null,
    status: x.status || x.state || null,
    conclusion: x.conclusion || null,
    detailsUrl: x.detailsUrl || x.targetUrl || null,
    startedAt: x.startedAt || x.createdAt || null,
    completedAt: x.completedAt || null,
    workflowName: x.workflowName || null,
  };
}

function normalizeComment(c) {
  return {
    id: c.id || null,
    databaseId: c.databaseId || null,
    author: c.author?.login || null,
    authorIsBot: c.author?.__typename === 'Bot',
    body: c.body || '',
    createdAt: c.createdAt || null,
    updatedAt: c.updatedAt || null,
    url: c.url || null,
  };
}

function normalizeThread(t) {
  let comments = t.comments?.nodes || [];
  // A long thread keeps its last 30 comments plus the first one: the original ask must not be lost.
  const first = t.firstComment?.nodes?.[0];
  if (first && comments.length > 0 && !comments.some((c) => c.id === first.id)) comments = [first, ...comments];
  const total = t.comments?.totalCount;
  return {
    commentsOmitted: Number.isFinite(total) ? Math.max(0, total - comments.length) : 0,
    id: t.id,
    isResolved: Boolean(t.isResolved),
    isOutdated: Boolean(t.isOutdated),
    path: t.path || null,
    line: t.line ?? null,
    originalLine: t.originalLine ?? null,
    comments: comments.map(normalizeComment),
  };
}

function normalizeReview(r) {
  return {
    id: r.id || null,
    author: r.author?.login || null,
    authorIsBot: r.author?.__typename === 'Bot',
    state: r.state || null,
    body: r.body || '',
    submittedAt: r.submittedAt || null,
    url: r.url || null,
    // review 针对的 commit;与 latestCommitOid 对比可判「该 reviewer 是否已审最新
    // HEAD」(回合制等齐判据)、并用不同 oid 个数近似 review 轮数(pr 技能
    // references/review-convergence.md §5)。gate 指纹只取 id:state:submittedAt,
    // 不受此字段影响。
    commitOid: r.commit?.oid || null,
  };
}

function normalizeTopComment(c) {
  return {
    id: c.id || null,
    author: c.author?.login || null,
    authorIsBot: c.author?.__typename === 'Bot',
    body: c.body || '',
    createdAt: c.createdAt || null,
    updatedAt: c.updatedAt || null,
    url: c.url || null,
  };
}

const THREAD_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      number
      state
      closed
      merged
      isDraft
      mergeable
      mergedAt
      closedAt
      createdAt
      updatedAt
      reviewDecision
      mergeStateStatus
      headRefName
      headRefOid
      baseRefName
      baseRef { target { oid } branchProtectionRule { requiresStatusChecks requiredStatusChecks { context app { databaseId } } } }
      mergeQueueEntry {
        id state
        headCommit { ...QueueCommit }
      }
      timelineItems(last: 1, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT]) {
        nodes {
          __typename
          ... on AddedToMergeQueueEvent { id createdAt }
          ... on RemovedFromMergeQueueEvent {
            id createdAt reason
            beforeCommit { ...QueueCommit }
          }
        }
      }
      reviewThreads(first: 100) {
        totalCount
        pageInfo { hasNextPage }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          firstComment: comments(first: 1) {
            nodes {
              id
              databaseId
              author { login __typename }
              body
              createdAt
              updatedAt
              url
            }
          }
          comments(last: 30) {
            totalCount
            nodes {
              id
              databaseId
              author { login __typename }
              body
              createdAt
              updatedAt
              url
            }
          }
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              contexts(first: 100) {
                totalCount
                pageInfo { hasNextPage }
                checkRunCountsByState { state count }
                statusContextCountsByState { state count }
                nodes {
                  __typename
                  ... on CheckRun { name isRequired(pullRequestNumber: $number) status conclusion detailsUrl startedAt completedAt checkSuite { app { databaseId slug } } }
                  ... on StatusContext { context isRequired(pullRequestNumber: $number) }
                }
              }
            }
          }
        }
      }
      reviews(last: 50) {
        totalCount
        nodes {
          id
          author { login __typename }
          state
          body
          submittedAt
          updatedAt
          url
          commit { oid }
        }
      }
      reactions(last: 30) {
        totalCount
        nodes { content createdAt user { login } }
      }
      comments(last: 100) {
        totalCount
        nodes {
          id
          author { login __typename }
          body
          createdAt
          updatedAt
          url
        }
      }
    }
  }
}
fragment QueueCommit on Commit {
  oid
  statusCheckRollup {
    contexts(first: 100) {
      totalCount
      pageInfo { hasNextPage }
      nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl startedAt completedAt }
        ... on StatusContext { context state targetUrl createdAt }
      }
    }
  }
}
`;

/**
 * One small query that changes whenever anything the follow-up reacts to changes: state, head,
 * mergeability, check counts by state, and the newest comment and review. The gate compares it
 * with the last full read and skips the full snapshot (three or four API calls) when it matches.
 * Edits inside review threads do not show here; the gate rereads in full every 30 minutes.
 */
const PROBE_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state isDraft mergeable headRefOid
      baseRef { target { oid } }
      mergeQueueEntry { state }
      comments(last: 1) { totalCount nodes { updatedAt } }
      reviews(last: 1) { totalCount nodes { updatedAt } }
      reviewThreads { totalCount }
      reactions { totalCount }
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 1) {
        checkRunCountsByState { state count }
        statusContextCountsByState { state count }
      } } } } }
    }
  }
}
`;

const counts = (list) => (list ?? []).filter((c) => c.count > 0).map((c) => `${c.state}:${c.count}`).sort().join(',');

/**
 * Recompute checkRunCountsByState / statusContextCountsByState from the raw `gh pr view`
 * statusCheckRollup (before latestChecks deduplication). Comparing this with GraphQL's rollup
 * counts detects checks that changed between the two requests so we never cache a newer probe
 * baseline over an older check list.
 */
function rollupProbeCounts(rawRollup) {
  const checkRuns = new Map();
  const statusContexts = new Map();
  for (const item of rawRollup) {
    if (item.__typename === 'CheckRun') {
      const state = item.status === 'COMPLETED' && item.conclusion ? item.conclusion : item.status;
      if (!state) return null;
      checkRuns.set(state, (checkRuns.get(state) ?? 0) + 1);
    } else if (item.__typename === 'StatusContext') {
      if (!item.state) return null;
      statusContexts.set(item.state, (statusContexts.get(item.state) ?? 0) + 1);
    } else {
      return null;
    }
  }
  const format = (map) => [...map.entries()].map(([state, count]) => `${state}:${count}`).sort().join(',');
  return { checkRuns: format(checkRuns), statusContexts: format(statusContexts) };
}

function probeFingerprint(pr) {
  const contexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts;
  return {
    status: [
      pr.state, pr.isDraft, pr.mergeable, pr.headRefOid, pr.mergeQueueEntry?.state ?? '',
      counts(contexts?.checkRunCountsByState), counts(contexts?.statusContextCountsByState),
    ].join(' '),
    remarks: [
      pr.comments?.totalCount ?? 0, pr.comments?.nodes?.at(-1)?.updatedAt ?? '',
      pr.reviews?.totalCount ?? 0, pr.reviews?.nodes?.at(-1)?.updatedAt ?? '',
      pr.reviewThreads?.totalCount ?? 0,
      // A bot reviewer's 👍 (Codex: no suggestions) ends the wait after a push.
      pr.reactions?.totalCount ?? 0,
    ].join(' '),
    // base 分支当前提交:只在检查失败期间被 gate 用来判断要不要完整读取。
    base: pr.baseRef?.target?.oid ?? '',
  };
}

async function probe(args) {
  const gql = await ghGraphQL(PROBE_QUERY, { owner: args.owner, name: args.name, number: args.number }, { includeHeaders: true });
  if (gql.errors?.length) throw new Error('Probe failed: ' + gql.errors.map(e => e.message).join('; '));
  const pr = gql.data?.repository?.pullRequest;
  if (!pr) throw new Error(`Pull request not found: ${args.repo}#${args.number}`);
  process.stdout.write(JSON.stringify(probeFingerprint(pr)) + '\n');
}

const COMMIT_CHECK_BATCH_SIZE = 10;
const MAX_COMMIT_CHECK_PAGES = 5;

const COMMIT_CHECK_PAGE_QUERY = `
query($owner: String!, $name: String!, $oid: GitObjectID!, $after: String!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit {
        oid
        statusCheckRollup {
          contexts(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              __typename
              ... on CheckRun { checkSuite { app { databaseId slug } } }
            }
          }
        }
      }
    }
  }
}
`;

function collectCheckRunApps(nodes, seen) {
  for (const n of nodes ?? []) {
    if (n?.__typename !== 'CheckRun') continue;
    const appSlug = n.checkSuite?.app?.slug ?? null;
    const appId = n.checkSuite?.app?.databaseId ?? null;
    if (appSlug && Number.isInteger(appId) && appId > 0 && !seen.has(appSlug)) {
      seen.set(appSlug, { appSlug, appId });
    }
  }
}

async function fetchReviewCommitChecks(owner, name, oids) {
  if (!oids.length) return {};
  const out = {};
  for (let offset = 0; offset < oids.length; offset += COMMIT_CHECK_BATCH_SIZE) {
    const batch = oids.slice(offset, offset + COMMIT_CHECK_BATCH_SIZE);
    const varDefs = batch.map((_, i) => `$oid${i}: GitObjectID!`).join(', ');
    const fields = batch
      .map((_, i) => `    c${i}: object(oid: $oid${i}) { ... on Commit { oid statusCheckRollup { contexts(first: 100) { pageInfo { hasNextPage endCursor } nodes { __typename ... on CheckRun { checkSuite { app { databaseId slug } } } } } } } }`)
      .join('\n');
    const query = `query($owner: String!, $name: String!, ${varDefs}) {\n  repository(owner: $owner, name: $name) {\n${fields}\n  }\n}`;
    const vars = { owner, name };
    batch.forEach((oid, i) => { vars[`oid${i}`] = oid; });
    let repo;
    try {
      const res = await ghGraphQL(query, vars, { includeHeaders: true, fatalExit: false, retries: 1 });
      repo = res?.data?.repository ?? {};
    } catch {
      // Preserve results already fetched by earlier batches; failed batch commits stay unverified.
      continue;
    }
    for (let i = 0; i < batch.length; i++) {
      const oid = batch[i];
      const commit = repo[`c${i}`];
      if (!commit || commit.oid !== oid) continue;
      let contexts = commit.statusCheckRollup?.contexts;
      const seen = new Map();
      collectCheckRunApps(contexts?.nodes, seen);
      let complete = !contexts?.pageInfo?.hasNextPage;
      let pages = 1;
      while (!complete && contexts?.pageInfo?.endCursor && pages < MAX_COMMIT_CHECK_PAGES) {
        pages += 1;
        try {
          const pageRes = await ghGraphQL(
            COMMIT_CHECK_PAGE_QUERY,
            { owner, name, oid, after: contexts.pageInfo.endCursor },
            { includeHeaders: true, fatalExit: false, retries: 1 },
          );
          const nextCommit = pageRes?.data?.repository?.object;
          if (!nextCommit || nextCommit.oid !== oid) break;
          contexts = nextCommit.statusCheckRollup?.contexts;
          collectCheckRunApps(contexts?.nodes, seen);
          complete = !contexts?.pageInfo?.hasNextPage;
        } catch {
          // Keep Apps already proved on earlier pages while leaving this commit unverified (`complete: false`).
          break;
        }
      }
      if (complete || seen.size > 0) {
        out[oid] = { complete, apps: [...seen.values()] };
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureBinary();
  if (args.probe) return probe(args);

  const prView = await fetchPrView(args.repo, args.number, args.stateDir);
  const ghView = prView;

  let rawCheckRollup = [];
  let checkRollup = [];
  let checksUnavailable = false;
  let checksError = null;
  let checksHeadOid = null;
  try {
    const stdoutShape = await ghPrViewJson(args.number, args.repo);
    checksHeadOid = stdoutShape.headRefOid || null;
    rawCheckRollup = Array.isArray(stdoutShape.statusCheckRollup)
      ? stdoutShape.statusCheckRollup.filter((x) => x && typeof x === 'object')
      : [];
    checkRollup = latestChecks(rawCheckRollup.map(normalizeCheckRun).filter(Boolean));
    if (Array.isArray(stdoutShape.commits) && stdoutShape.commits.length) {
      prView.__ghCommits = stdoutShape.commits;
    }
  } catch (e) {
    checksUnavailable = true;
    checksError = String(e.stderr || e.message || e).slice(0, 1000);
    rawCheckRollup = [];
    checkRollup = [];
  }

  const gql = await ghGraphQL(THREAD_QUERY, {
    owner: args.owner,
    name: args.name,
    number: args.number,
  }, { includeHeaders: true });
  if (gql.errors?.length) throw new Error('Incomplete GraphQL snapshot: ' + gql.errors.map(e => e.message).join('; '));
  const pr = gql.data?.repository?.pullRequest;
  if (!pr) throw new Error(`Pull request not found: ${args.repo}#${args.number}`);
  // All head-scoped evidence must refer to the same commit. A push between
  // requests invalidates old checks/mergeability; do not present them as green
  // evidence for the newer GraphQL head. The next normal heartbeat can retry.
  if (!pr.headRefOid || checksHeadOid !== pr.headRefOid || ghView.head?.sha !== pr.headRefOid) {
    checksUnavailable = true;
    checksError = checksError || 'PR head changed between snapshot requests or check head is unavailable';
    rawCheckRollup = [];
    checkRollup = [];
    ghView.mergeable = null;
    ghView.mergeable_state = null;
  }

  const entry = pr.mergeQueueEntry;
  const event = pr.timelineItems?.nodes?.at(-1) ?? null;
  const terminal = pr.merged || pr.closed;
  let containsHead = null;
  if (!terminal && !entry && event?.__typename === 'RemovedFromMergeQueueEvent' && event.beforeCommit?.oid && pr.headRefOid) {
    // beforeCommit is the synthetic merge-group commit, NOT the PR head.
    // Ancestry also covers batched groups where this PR is not a direct parent.
    const comparison = await ghJson(`repos/${args.repo}/compare/${pr.headRefOid}...${event.beforeCommit.oid}`, { includeHeaders: true });
    if (['ahead', 'identical', 'behind', 'diverged'].includes(comparison.status)) {
      containsHead = ['ahead', 'identical'].includes(comparison.status);
    }
  }
  const queueContexts = (entry ? entry.headCommit : event?.beforeCommit)?.statusCheckRollup?.contexts;
  const queueRuns = (queueContexts?.nodes ?? []).map(normalizeCheckRun).filter(Boolean);
  const mergeQueue = classifyMergeQueue({
    entry, event, containsHead, terminal,
    checks: summarizeChecks(queueRuns, false, Boolean(queueContexts?.pageInfo?.hasNextPage), queueContexts?.totalCount ?? queueRuns.length),
  });

  const threads = (pr.reviewThreads?.nodes || []).map(normalizeThread);
  const activeUnresolvedThreads = threads.filter(t => !t.isResolved && !t.isOutdated);
  const outdatedUnresolvedThreads = threads.filter(t => !t.isResolved && t.isOutdated);
  const rawUnresolvedThreads = threads.filter(t => !t.isResolved);
  const commits = Array.isArray(prView.__ghCommits) ? prView.__ghCommits : [];
  const latestCommit = lastCommit(commits);
  const reviewThreadsTruncated = Boolean(pr.reviewThreads?.pageInfo?.hasNextPage);
  const checkContexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts || null;
  const requiredNames = new Set((checkContexts?.nodes ?? [])
    .filter((n) => n?.isRequired === true).map((n) => n.name ?? n.context).filter(Boolean));
  // Identity comes from GitHub, never from a display-name/body heuristic. Match an exact attempt.
  checkRollup = checkRollup.map((c) => {
    const candidates = (checkContexts?.nodes ?? []).filter(n => n.__typename === 'CheckRun'
      && n.name === c.name && n.detailsUrl === c.detailsUrl
      && n.startedAt === c.startedAt && n.completedAt === c.completedAt);
    const app = candidates.length === 1 ? candidates[0].checkSuite?.app : null;
    return { ...c, appId: app?.databaseId ?? null, required: requiredNames.has(c.name), outcome: checkOutcome(c) };
  });
  let requiredChecks = [];
  let requiredChecksUnavailable = false;
  if (!terminal) {
    try {
      if (!pr.baseRefName) throw new Error('Missing PR base branch');
      const rules = await fetchBranchRules(args.repo, pr.baseRefName, gql.data?.viewer?.login ?? null, args.stateDir);
      requiredChecks = requiredChecksOf(pr.baseRef, rules);
      checkRollup = applyRequiredChecks(checkRollup, requiredChecks);
    } catch (error) {
      requiredChecksUnavailable = true;
      checksError = checksError || `Required-check inventory unavailable: ${String(error.message).slice(0, 300)}`;
    }
  }
  const checkCommit = pr.commits?.nodes?.[0]?.commit;
  const reviewerChecks = !checksUnavailable && !checkContexts?.pageInfo?.hasNextPage
    && checkCommit?.oid === pr.headRefOid
    ? (checkContexts?.nodes ?? []).filter(n => n.__typename === 'CheckRun').map(n => ({
      ...normalizeCheckRun(n), headSha: checkCommit.oid,
      appId: n.checkSuite?.app?.databaseId ?? null, appSlug: n.checkSuite?.app?.slug ?? null,
    })) : [];
  const checksTruncated = Boolean(checkContexts?.pageInfo?.hasNextPage);
  const rawCounts = !checksUnavailable && !checksTruncated && (!checkCommit?.oid || checkCommit.oid === pr.headRefOid)
    ? rollupProbeCounts(rawCheckRollup)
    : null;
  const probeCountsMatch = Boolean(rawCounts)
    && rawCounts.checkRuns === counts(checkContexts?.checkRunCountsByState)
    && rawCounts.statusContexts === counts(checkContexts?.statusContextCountsByState);
  const checksSummary = summarizeChecks(
    checkRollup,
    checksUnavailable,
    checksTruncated,
    checkContexts?.totalCount ?? checkRollup.length
  );
  const reviewThreads = {
    totalCount: pr.reviewThreads?.totalCount ?? threads.length,
    fetchedCount: threads.length,
    unresolvedCount: activeUnresolvedThreads.length,
    activeUnresolvedCount: activeUnresolvedThreads.length,
    outdatedUnresolvedCount: outdatedUnresolvedThreads.length,
    rawUnresolvedCount: rawUnresolvedThreads.length,
    truncated: reviewThreadsTruncated,
    // Comments left out of long threads (the first one and the last 30 are always kept).
    commentsOmitted: threads.reduce((sum, t) => sum + (t.commentsOmitted || 0), 0),
    nodes: threads,
  };
  const truncated = reviewThreadsTruncated || checksTruncated;
  const gate = deriveVerdict({ pr, ghView, checksSummary, reviewThreads, truncated, mergeQueue });
  if (requiredChecksUnavailable && !terminal) {
    if (gate.verdict === 'READY') gate.verdict = 'NOT_READY';
    gate.blockers.push('required_checks_unavailable');
  }
  if (args.expectHead && args.expectHead !== pr.headRefOid) {
    gate.verdict = 'NEEDS_WORK';
    gate.blockers.push('delivery_evidence_changed');
  }
  const strictExitCode = VERDICT_EXIT_CODES[gate.verdict] ?? 50;

  const latestCommitOid = pr.headRefOid || latestCommit?.oid || ghView.head?.sha || null;
  const reviews = (pr.reviews?.nodes || []).map(normalizeReview);
  const reactions = (pr.reactions?.nodes || []).map((r) => ({ content: r.content ?? null, at: r.createdAt ?? null, author: r.user?.login ?? null }));
  const approvalCommits = uncorroboratedApprovalCommits({ latestCommitOid, reviews, reviewThreads, reactions, reviewerChecks });
  const reviewCommitChecks = approvalCommits.length
    ? await fetchReviewCommitChecks(args.owner, args.name, approvalCommits)
    : {};

  const out = {
    fetchedAt: new Date().toISOString(),
    repo: args.repo,
    number: args.number,
    url: ghView.html_url,
    title: ghView.title,
    // The account the follow-up acts as: its own comments never wake it.
    viewer: gql.data?.viewer?.login ?? null,
    state: pr.state,
    closed: Boolean(pr.closed),
    merged: Boolean(pr.merged),
    isDraft: Boolean(pr.isDraft),
    mergedAt: pr.mergedAt,
    closedAt: pr.closedAt,
    createdAt: pr.createdAt ?? null,
    updatedAt: pr.updatedAt,
    reviewDecision: pr.reviewDecision,
    mergeStateStatus: pr.mergeStateStatus,
    mergeable: ghView.mergeable ?? null,
    mergeableState: ghView.mergeable_state ?? null,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    // Match the lightweight probe's live base ref. REST pull.base.sha can remain
    // at the PR's old base after the branch advances, hiding baseline fixes.
    baseCommitOid: pr.baseRef?.target?.oid ?? null,
    latestCommitOid,
    // diff 规模(REST /pulls 自带):供 gate 的「范围膨胀」机判用。刻意不进 gate 指纹
    // (指纹按字段显式挑选),base 移动等噪声不会因此制造无谓唤起。
    additions: Number.isFinite(ghView.additions) ? ghView.additions : null,
    deletions: Number.isFinite(ghView.deletions) ? ghView.deletions : null,
    changedFiles: Number.isFinite(ghView.changed_files) ? ghView.changed_files : null,
    verdict: gate.verdict,
    blockers: gate.blockers,
    gate: {
      verdict: gate.verdict,
      strictExitCode,
      requiredChecksUnavailable,
      truncated,
      reviewThreadsTruncated,
      checksTruncated,
    },
    checks: checkRollup,
    requiredChecks,
    reviewerChecks,
    reviewCommitChecks,
    mergeQueue,
    checksSummary: {
      total: checksSummary.total,
      totalCount: checksSummary.totalCount,
      pending: checksSummary.pending,
      failed: checksSummary.failed,
      actionRequired: checksSummary.actionRequired,
      unavailable: checksSummary.unavailable,
      error: checksError,
      truncated: checksSummary.truncated,
      pendingRuns: checksSummary.pendingRuns,
      failingRuns: checksSummary.failingRuns,
      actionRequiredRuns: checksSummary.actionRequiredRuns,
    },
    reviewThreads,
    reviews,
    comments: (pr.comments?.nodes || []).map(normalizeTopComment),
    // Reactions on the PR itself: a bot reviewer's 👍 can be its whole answer to a push.
    reactions,
    // Older top-level comments beyond the 100 read (a PR with more than that; the gate watches new ones only).
    commentsOmitted: Math.max(0, (pr.comments?.totalCount ?? 0) - (pr.comments?.nodes?.length ?? 0)),
    // Emit the GraphQL probe baseline only when it agrees with the check rollup evaluated in this
    // snapshot; on skew (or unavailable/truncated checks), return null so the gate forces a full
    // read on the next tick instead of caching a newer check state.
    probe: probeCountsMatch ? probeFingerprint(pr) : null,
  };

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  if (args.strictExit) process.exit(strictExitCode);
}

main().catch(e => {
  process.stderr.write(`[pr-snapshot] ${e.message}\n`);
  process.exit(2);
});
