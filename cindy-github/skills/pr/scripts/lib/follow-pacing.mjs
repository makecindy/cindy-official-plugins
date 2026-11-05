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
 * produced is held until every expected bot has answered on the new commit (a review, a comment or
 * a reaction such as Codex's 👍 for "no suggestions"). People's comments, merge-queue problems and
 * draft changes are never held. Checks are not waited for: the agent looks at them again before it
 * pushes, so a failure that lands while it works joins the same round.
 */

export const TICK_MS = 2 * 60_000;
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

/**
 * Bots that review this PR or this repository: authors of reviews marked as bots, and bot accounts
 * that react on the PR (Codex answers a push with only a 👍 when it has no suggestions). Plain comment
 * bots (deploy previews, CI summaries) neither review nor react, and are never waited for.
 */
export function reviewerBotsOf(snap) {
  const bots = new Set();
  for (const review of snap?.reviews ?? []) {
    if (review?.authorIsBot && review.author) bots.add(botKey(review.author));
  }
  for (const reaction of snap?.reactions ?? []) {
    if (/\[bot\]$/i.test(String(reaction?.author ?? ''))) bots.add(botKey(reaction.author));
  }
  return bots;
}

/** When each reviewer bot last reviewed or reacted on this PR (ms); bots with no usable time are left out. */
function reviewerBotActivity(snap) {
  const last = new Map();
  const note = (login, value) => {
    const at = timeOf(value);
    if (at === null) return;
    const key = botKey(login);
    if (key && at > (last.get(key) ?? 0)) last.set(key, at);
  };
  for (const review of snap?.reviews ?? []) {
    if (review?.authorIsBot && review.author) note(review.author, review.submittedAt);
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

/** Bots to wait for on a new commit: this PR's reviewer bots plus the repository's recent ones. */
export function expectedBots({ snap, previous, repoBots, viewer }) {
  const bots = new Set(reviewerBotsOf(snap));
  for (const bot of Array.isArray(previous?.reviewerBots) ? previous.reviewerBots : []) bots.add(botKey(bot));
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
    // A review that names its commit answers for that commit only; time decides just when it names none.
    if (review?.commitOid ? review.commitOid === head : after(review?.submittedAt)) mark(review?.author);
  }
  for (const comment of snap?.comments ?? []) {
    if (after(comment?.updatedAt ?? comment?.createdAt)) mark(comment?.author);
  }
  for (const thread of snap?.reviewThreads?.nodes ?? []) {
    for (const comment of thread?.comments ?? []) {
      if (after(comment?.updatedAt ?? comment?.createdAt)) mark(comment?.author);
    }
  }
  for (const reaction of snap?.reactions ?? []) {
    if (after(reaction?.at)) mark(reaction?.author);
  }
  return [...answered].sort();
}

/** Events that wake the agent at once even while a round is settling. */
export function breaksSettle(events) {
  return events.some((event) =>
    (event.kind === 'remarks' && (event.remarks ?? []).some((remark) => !remark.authorIsBot))
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
 * Is a look due? Reads only the state written by the previous check, so a "not due" answer
 * costs no GitHub call.
 */
export function pacingDue(previous, now, { triggered = false } = {}) {
  if (triggered) return { due: true, pace: 'fast', reason: 'host-trigger' };
  if (!previous?.watch) return { due: true, pace: 'fast', reason: 'first-check' };
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
    || (awaited !== null && now - awaited >= 15 * 60_000)
    || (Number(previous.settleUntil) || 0) > 0
    || Number(previous.retryBackoffUntil) > 0;
  if (fast) return { due: true, pace: 'fast', reason: 'fast' };
  const recent = (value) => Number.isFinite(Number(value)) && Number(value) > 0 && now - Number(value) < ACTIVE_WINDOW_MS;
  let pace;
  if (previous.inFlight || (watch.failedChecks ?? []).length > 0 || watch.conflicting
    || (watch.queueProblems ?? []).length > 0 || recent(previous.headSeenAt) || recent(previous.lastPassAt)) {
    pace = 'active';
  } else if (previous.humanOnlyPending || WAITING_VERDICTS.has(previous.verdict)) {
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
