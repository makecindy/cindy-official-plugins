/**
 * Follow-up pacing and round batching (pure functions, no I/O).
 *
 * Pacing: the schedule fires often, but each check first asks "is a look due yet?" from what the
 * last check saw, so a PR that only waits for a human costs nothing between looks:
 *   - fast (every tick): a host trigger, an unacknowledged update, a due defer or no-checks deadline,
 *     or an open settle window;
 *   - active: checks running, something failing or conflicting, a new commit or an agent round
 *     in the last hour (every tick of the 5-minute schedule);
 *   - waiting: only a human approval or the merge is left;
 *   - quiet: a draft, or nothing changed for hours;
 *   - otherwise idle.
 *
 * Batching (the settle window): after a push, bot reviewers that review this repository usually
 * answer within minutes. Waking the agent on the first failed check or the first bot comment makes
 * it push again while the other reviewers are still on the old commit, which costs a whole extra
 * round. So for up to SETTLE_MAX_MS after a new commit is first seen, news that only bots or checks
 * produced is held until every expected bot has answered on the new commit (a submitted review or
 * a 👍 reaction for "no suggestions"). People's comments, merge-queue problems and
 * draft changes are never held. Checks are not waited for: the agent looks at them again before it
 * pushes, so a failure that lands while it works joins the same round.
 */
import { waitIsDue } from './follow-wait.mjs';

export const TICK_MS = 5 * 60_000;
export const PACE_MS = {
  fast: 0,
  active: 5 * 60_000,
  idle: 10 * 60_000,
  waiting: 30 * 60_000,
  quiet: 60 * 60_000,
};
/** The cron fires every TICK_MS but never exactly on time; a look this much early still counts as due. */
export const PACE_SLACK_MS = 60_000;
export const ACTIVE_WINDOW_MS = 60 * 60_000;
export const QUIET_AFTER_MS = 6 * 60 * 60_000;
export const SETTLE_MAX_MS = 20 * 60_000;
/** Bot activity this long before the commit was first seen still counts (the check runs on a tick). */
export const SETTLE_SLACK_MS = 5 * 60_000;
/** A repository bot that has not reviewed anything for this long is no longer waited for. */
export const REPO_BOT_TTL_MS = 14 * 24 * 60 * 60_000;

const WAITING_VERDICTS = new Set(['READY', 'BLOCKED_HUMAN']);

/** `chatgpt-codex-connector[bot]` and `chatgpt-codex-connector` are the same account. */
export function botKey(login) {
  return String(login ?? '').trim().toLowerCase().replace(/\[bot\]$/, '');
}

const timeOf = (value) => {
  const at = Date.parse(value ?? '');
  return Number.isFinite(at) ? at : null;
};

const NON_REVIEW_STATES = new Set(['APPROVED', 'DISMISSED', 'PENDING']);

/**
 * Bots with concrete code-review activity on this snapshot (commented/requested-changes review,
 * inline thread comment, bot reaction, or a dedicated reviewer App check run). Used to decide
 * whether an APPROVED or DISMISSED review comes from a real reviewer bot rather than an
 * approval-only auto-merge gate bot (which never reviews ordinary PRs and must not hold settling).
 */
function corroboratedReviewerBots(snap) {
  const bots = new Set();
  for (const review of snap?.reviews ?? []) {
    if (!review?.authorIsBot || !review.author) continue;
    const state = String(review.state ?? '').toUpperCase();
    if (!NON_REVIEW_STATES.has(state)) bots.add(botKey(review.author));
  }
  for (const thread of snap?.reviewThreads?.nodes ?? []) {
    for (const comment of thread?.comments ?? []) {
      if (comment?.authorIsBot && comment.author) bots.add(botKey(comment.author));
    }
  }
  for (const reaction of snap?.reactions ?? []) {
    if (/\[bot\]$/i.test(String(reaction?.author ?? ''))) bots.add(botKey(reaction.author));
  }
  // A dedicated reviewer GitHub App (e.g. Greptile, CodeQL) runs its own check suite on the PR;
  // github-actions runs arbitrary workflows (including auto-approve actions) and does not corroborate.
  for (const check of snap?.reviewerChecks ?? []) {
    const slug = botKey(check?.appSlug);
    if (slug && slug !== 'github-actions' && Number.isInteger(check.appId) && check.appId > 0) {
      bots.add(slug);
    }
  }
  bots.delete('');
  return bots;
}

function isReviewerBotReview(review, corroborated) {
  if (!review?.authorIsBot || !review.author) return false;
  const state = String(review.state ?? '').toUpperCase();
  if (state === 'PENDING') return false;
  if (state === 'APPROVED' || state === 'DISMISSED') return corroborated.has(botKey(review.author));
  return true;
}

/**
 * Bots that review this PR or this repository: bot authors of code reviews (not approval-only
 * auto-merge bots), and bot accounts that react on the PR (Codex answers a push with only a 👍
 * when it has no suggestions). Plain comment bots (deploy previews, CI summaries) neither review
 * nor react, and are never waited for.
 */
export function reviewerBotsOf(snap) {
  const bots = new Set();
  const corroborated = corroboratedReviewerBots(snap);
  for (const review of snap?.reviews ?? []) {
    if (isReviewerBotReview(review, corroborated)) bots.add(botKey(review.author));
  }
  for (const reaction of snap?.reactions ?? []) {
    if (/\[bot\]$/i.test(String(reaction?.author ?? ''))) bots.add(botKey(reaction.author));
  }
  return bots;
}

/** When each reviewer bot last reviewed or reacted on this PR (ms); bots with no usable time are left out. */
function reviewerBotActivity(snap) {
  const last = new Map();
  const corroborated = corroboratedReviewerBots(snap);
  const note = (login, value) => {
    const at = timeOf(value);
    if (at === null) return;
    const key = botKey(login);
    if (key && at > (last.get(key) ?? 0)) last.set(key, at);
  };
  for (const review of snap?.reviews ?? []) {
    if (isReviewerBotReview(review, corroborated)) note(review.author, review.submittedAt);
  }
  for (const reaction of snap?.reactions ?? []) {
    if (/\[bot\]$/i.test(String(reaction?.author ?? ''))) note(reaction.author, reaction.at);
  }
  return last;
}

/**
 * Merge this snapshot's reviewer bots into a repository record `{ <bot>: lastActivityAtMs }`, using the
 * time of the review or reaction itself (an old PR that still shows a retired bot's review must not keep
 * renewing it), and dropping bots idle for REPO_BOT_TTL_MS.
 */
export function updateRepoBots(record, snap, now) {
  const next = {};
  for (const [bot, at] of Object.entries(record && typeof record === 'object' ? record : {})) {
    if (Number.isFinite(Number(at)) && now - Number(at) < REPO_BOT_TTL_MS) next[bot] = Number(at);
  }
  for (const [bot, at] of reviewerBotActivity(snap)) {
    if (now - at < REPO_BOT_TTL_MS && at > (next[bot] ?? 0)) next[bot] = at;
  }
  return next;
}

export const REVIEWER_BOTS_VERSION = 2;

const REVIEW_WINDOW_LIMIT = 50;
const REACTION_WINDOW_LIMIT = 30;

function hasCompleteBotHistory(snap) {
  if (!Array.isArray(snap?.reviews)) return false;
  if (snap.reviews.length >= REVIEW_WINDOW_LIMIT) return false;
  if ((snap.reactions ?? []).length >= REACTION_WINDOW_LIMIT) return false;
  if (snap.checksSummary?.unavailable || snap.checksSummary?.truncated) return false;
  if (snap.reviewThreads?.truncated || snap.gate?.truncated) return false;
  return true;
}

/**
 * Carry forward this PR's known reviewer bots onto `snap`.
 * - v2 state (`previous.reviewerBotsVersion === REVIEWER_BOTS_VERSION`) already contains only vetted
 *   reviewer bots, so they stay even before a new commit's checks register.
 * - Legacy state (pre-v2) may contain approval-only auto-merge bots recorded before filtering: when
 *   `snap` carries the PR's complete review, reaction, thread and check history, drop legacy bots
 *   only when distinguishable current-head evidence rules them out (an APPROVED/DISMISSED on
 *   `latestCommitOid` without a dedicated reviewer App check, or no reviews on `snap`). Legacy bots
 *   whose only review is an older-head APPROVED/DISMISSED stay retained at v1 across settle-window
 *   expiries and subsequent pushes until distinguishable current-head evidence arrives (no extra
 *   historical-commit GraphQL queries).
 */
export function resolvePrReviewerBots(previous, snap) {
  const current = reviewerBotsOf(snap);
  const prevList = Array.isArray(previous?.reviewerBots) ? previous.reviewerBots.map(botKey).filter(Boolean) : [];
  if (previous?.reviewerBotsVersion === REVIEWER_BOTS_VERSION || prevList.length === 0) {
    return { bots: [...new Set([...prevList, ...current])].sort(), version: REVIEWER_BOTS_VERSION };
  }
  if (!hasCompleteBotHistory(snap)) {
    return { bots: [...new Set([...prevList, ...current])].sort(), version: previous?.reviewerBotsVersion ?? 1 };
  }
  const head = snap?.latestCommitOid ?? null;
  const unconfirmedLegacy = [];
  for (const bot of prevList) {
    if (current.has(bot)) continue;
    const botReviews = (snap.reviews ?? []).filter((r) => r?.authorIsBot && botKey(r.author) === bot);
    const hasCurrentHeadApproval = Boolean(head) && botReviews.some((r) => {
      const state = String(r.state ?? '').toUpperCase();
      return (state === 'APPROVED' || state === 'DISMISSED') && r.commitOid === head;
    });
    const hasOlderApproval = botReviews.some((r) => {
      const state = String(r.state ?? '').toUpperCase();
      return (state === 'APPROVED' || state === 'DISMISSED') && (!head || r.commitOid !== head);
    });
    if (!hasCurrentHeadApproval && hasOlderApproval) {
      unconfirmedLegacy.push(bot);
    }
  }
  return {
    bots: [...new Set([...current, ...unconfirmedLegacy])].sort(),
    version: unconfirmedLegacy.length === 0 ? REVIEWER_BOTS_VERSION : (previous?.reviewerBotsVersion ?? 1),
  };
}

/** Bots to wait for on a new commit: this PR's reviewer bots plus the repository's recent ones. */
export function expectedBots({ snap, previous, repoBots, viewer }) {
  const bots = new Set(resolvePrReviewerBots(previous, snap).bots);
  for (const bot of Object.keys(repoBots ?? {})) bots.add(botKey(bot));
  if (viewer) bots.delete(botKey(viewer));
  bots.delete('');
  return [...bots].sort();
}

/** Which expected bots have answered on `head` since `since` (ms). */
export function botsAnswered(snap, bots, head, since) {
  const answered = new Set();
  const after = (value) => {
    const at = timeOf(value);
    return at !== null && at >= since;
  };
  const wanted = new Set(bots);
  const mark = (login) => {
    const key = botKey(login);
    if (wanted.has(key)) answered.add(key);
  };
  for (const review of snap?.reviews ?? []) {
    if (!['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(review?.state)) continue;
    // A review that names its commit answers for that commit only; time decides just when it names none.
    if (review?.commitOid ? review.commitOid === head : after(review?.submittedAt)) mark(review?.author);
  }
  // Plain comments (including edited status summaries) and individual inline findings do not
  // prove the reviewer has finished. Unknown/comment-only bots retain the 20-minute bound.
  // EYES means started, not finished. Only a positive completion reaction closes the window.
  for (const reaction of snap?.reactions ?? []) {
    if (reaction?.content === 'THUMBS_UP' && after(reaction?.at)) mark(reaction?.author);
  }
  // Only an expected reviewer's own GitHub App can supply its completion signal.
  // Keep the latest attempt per app/check; a failed/cancelled/skipped run is not success.
  if (!snap?.checksSummary?.unavailable && !snap?.checksSummary?.truncated) {
    for (const bot of wanted) {
      const latest = new Map();
      let unfinished = false;
      for (const c of snap?.reviewerChecks ?? []) {
        if (c.headSha !== head || c.appSlug !== bot || !Number.isInteger(c.appId) || c.appId <= 0) continue;
        const at = timeOf(c.startedAt);
        if (!c.name) continue;
        // 排队或等待中、还没有开始时间的重跑:只要它没结束就不能凭旧的成功算「已答复」。
        if (at === null) {
          if (c.status !== 'COMPLETED') unfinished = true;
          continue;
        }
        const key = `${c.appId}:${c.name}`;
        const old = latest.get(key);
        if (!old || at > old.at) latest.set(key, { at, c });
        else if (at === old.at && (c.status !== old.c.status || c.conclusion !== old.c.conclusion)) {
          latest.set(key, { at, c: { ...c, status: 'UNKNOWN' } });
        }
      }
      if (!unfinished && latest.size && [...latest.values()].every(({c}) => c.status === 'COMPLETED'
        && c.conclusion === 'SUCCESS' && timeOf(c.completedAt) !== null)) mark(bot);
    }
  }
  return [...answered].sort();
}

/** An approval without a comment asks nothing of the agent; it joins the batch the bots complete. */
const bareApproval = (remark) => String(remark.state ?? '').toUpperCase() === 'APPROVED'
  && !String(remark.body ?? '').trim();

/** Events that wake the agent at once even while a round is settling. */
export function breaksSettle(events) {
  return events.some((event) =>
    (event.kind === 'remarks' && (event.remarks ?? []).some((remark) => !remark.authorIsBot && !bareApproval(remark)))
    || event.kind === 'conflicting'
    || event.kind === 'wait-changed'
    || event.kind === 'merge-queue'
    || event.kind === 'draft-entered'
    || event.kind === 'draft-exited');
}

/**
 * Settle state for the current head: `open` while expected bots have not all answered and the
 * window has not expired. `waiting` lists the bots still owed.
 */
export function settleState({ snap, headSeenAt, expected, now }) {
  const head = snap?.latestCommitOid ?? null;
  if (!head || !Number.isFinite(headSeenAt) || expected.length === 0) {
    return { open: false, waiting: [], until: null };
  }
  const until = headSeenAt + SETTLE_MAX_MS;
  const answered = new Set(botsAnswered(snap, expected, head, headSeenAt - SETTLE_SLACK_MS));
  const waiting = expected.filter((bot) => !answered.has(bot));
  return { open: waiting.length > 0 && now < until, waiting, until };
}

/**
 * A release too close to the previous one means the host deferred/dropped it (no real agent run).
 */
export function isEmptyPass(previous, now, minPassSpacingMs = TICK_MS) {
  const lastPassAt = Number(previous?.lastPassAt) || 0;
  return minPassSpacingMs > 0 && lastPassAt > 0 && now - lastPassAt < minPassSpacingMs;
}

/**
 * An unacknowledged terminal-backoff reminder retried within the empty-pass spacing window
 * (e.g. host deferred due to user-active and retried ~90s later) must still pass pacing so
 * `decide()` can replay the unexecuted reminder instead of delaying it 2–12 hours.
 */
export function isPendingTerminalBackoffRetry(previous, now, minPassSpacingMs = TICK_MS) {
  return Boolean(previous?.pendingWatch)
    && previous?.lastDecisionReason === 'terminal-backoff-attempt'
    && isEmptyPass(previous, now, minPassSpacingMs);
}

/**
 * Is a look due? Reads only the state written by the previous check, so a "not due" answer
 * costs no GitHub call.
 */
export function pacingDue(previous, now, { triggered = false, minPassSpacingMs = TICK_MS } = {}) {
  if (triggered) return { due: true, pace: 'fast', reason: 'host-trigger' };
  if (!previous?.watch) return { due: true, pace: 'fast', reason: 'first-check' };
  const terminalBackoffUntil = Number(previous.terminalBackoffUntil) || 0;
  if ((previous.merged || previous.closed) && terminalBackoffUntil > now
    && !isPendingTerminalBackoffRetry(previous, now, minPassSpacingMs)) {
    return { due: false, pace: 'terminal-backoff', reason: 'terminal-backoff', nextAt: terminalBackoffUntil };
  }
  const watch = previous.watch;
  const lastLook = Math.max(
    Number(previous.lastFullReadAt) || 0,
    Number(previous.lastProbeAt) || 0,
    Number(previous.lastCheckedAt) || 0,
  );
  const since = now - lastLook;
  const nextAllowAt = Number(previous.nextAllowAt) || 0;
  const awaited = timeOf(watch.checksAwaitedSince);
  const fast = previous.pendingWatch
    || (nextAllowAt > 0 && now >= nextAllowAt)
    || waitIsDue(previous.wait, now)
    || (awaited !== null && now - awaited >= 15 * 60_000)
    || (Number(previous.settleUntil) || 0) > 0
    || Number(previous.retryBackoffUntil) > 0
    || (terminalBackoffUntil > 0 && now >= terminalBackoffUntil);
  if (fast) return { due: true, pace: 'fast', reason: 'fast' };
  const recent = (value) => Number.isFinite(Number(value)) && Number(value) > 0 && now - Number(value) < ACTIVE_WINDOW_MS;
  let pace;
  // A non-human wait (checks/baseline/retry) delays model work, not detection of new work.
  // A human wait explicitly parks the PR on a human decision or merge (and accounts for any
  // set-aside failures/threads), so once recent activity cools down it paces at `waiting`.
  const humanWait = previous.wait?.kind === 'human';
  const activeWait = Boolean(previous.wait) && !humanWait;
  const unhandledFailedChecks = !humanWait && (watch.failedChecks ?? []).length > 0;
  if (activeWait || previous.inFlight || unhandledFailedChecks || watch.conflicting
    || (watch.queueProblems ?? []).length > 0 || recent(previous.headSeenAt) || recent(previous.lastPassAt)) {
    pace = 'active';
  } else if (humanWait || previous.humanOnlyPending || WAITING_VERDICTS.has(previous.verdict)) {
    pace = 'waiting';
  } else if (watch.isDraft || (Number(previous.lastChangeAt) > 0 && now - Number(previous.lastChangeAt) >= QUIET_AFTER_MS)) {
    pace = 'quiet';
  } else {
    pace = 'idle';
  }
  const interval = PACE_MS[pace];
  return since + PACE_SLACK_MS >= interval
    ? { due: true, pace, reason: pace }
    : { due: false, pace, reason: pace, nextAt: lastLook + interval - PACE_SLACK_MS };
}
