/** A model's scoped wait, stored in the existing PR gate state. No timers or I/O here. */
export function checkOutcome(check) {
  if (check?.outcome) return check.outcome;
  const status = String(check?.status ?? '').toUpperCase();
  const conclusion = String(check?.conclusion ?? '').toUpperCase();
  if (check?.type === 'StatusContext') {
    if (['PENDING', 'EXPECTED'].includes(status)) return 'pending';
    return ['FAILURE', 'ERROR'].includes(status) ? 'failed' : 'passed';
  }
  if (status && status !== 'COMPLETED') return 'pending';
  if (!conclusion) return 'pending';
  return ['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(conclusion) ? 'passed' : 'failed';
}

export const checkKey = (check) => JSON.stringify([check.workflowName || '', check.name]);

/** Only observations, never an inferred instruction from a PR comment. Keep these on each watch
 * so acknowledging a slow round cannot silence events that arrived after that round was released. */
export function waitFacts(snap) {
  return {
    headSha: snap.latestCommitOid ?? null,
    complete: !snap.gate?.truncated && !snap.checksSummary?.unavailable && !snap.checksSummary?.truncated
      && !snap.reviewThreads?.truncated,
    checks: (snap.checks ?? []).filter((c) => c.name).map((c) => ({
      name: c.name, workflowName: c.workflowName || '', outcome: checkOutcome(c),
      attempt: JSON.stringify([c.detailsUrl ?? '', c.startedAt ?? '', c.completedAt ?? '']),
    })),
    threads: (snap.reviewThreads?.nodes ?? []).map((t) => ({
      id: t.id, resolved: Boolean(t.isResolved), outdated: Boolean(t.isOutdated),
    })),
    reviewDecision: snap.reviewDecision ?? null,
    blockers: snap.blockers ?? [],
  };
}

const KINDS = new Set(['human', 'baseline', 'checks', 'retry']);
const HUMAN_BLOCKERS = new Set(['ci_failing', 'unresolved_review_threads', 'branch_protection_blocked', 'approval_required', 'check_action_required', 'changes_requested_waiting_re_review', 'merge_state_unstable']);

/** Validate before ack or any state write. Missing/ambiguous targets fail rather than widening scope. */
export function makeWait(input, facts, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('--wait expects a JSON object');
  const fields = new Set(['kind', 'headSha', 'reason', 'afterMinutes', 'checks', 'threads']);
  for (const key of Object.keys(input)) if (!fields.has(key)) throw new Error(`unknown wait field: ${key}`);
  if (!KINDS.has(input.kind)) throw new Error('wait kind must be human, baseline, checks or retry');
  if (!facts?.complete || !facts.headSha) throw new Error('wait needs a complete gate observation; run the gate and read --last-result first');
  if (input.headSha !== facts.headSha) throw new Error('wait headSha must match the acknowledged observation');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000) throw new Error('wait reason must be 1–2000 characters');
  const minutes = input.afterMinutes;
  if (!(minutes === null && input.kind === 'human')
    && !(typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 5 && minutes <= 1440)) {
    throw new Error('afterMinutes must be 5–1440; only a human wait may use null (events only)');
  }
  if (!Array.isArray(input.checks) || !Array.isArray(input.threads)) throw new Error('wait checks and threads must be arrays (use [] when empty)');
  const checks = input.checks.map((target) => {
    if (!target || typeof target.name !== 'string' || Object.keys(target).some((k) => !['name', 'workflowName'].includes(k))) {
      throw new Error('each wait check must have name and optionally workflowName');
    }
    const matches = facts.checks.filter((c) => c.name === target.name
      && (target.workflowName === undefined || c.workflowName === target.workflowName));
    if (matches.length !== 1) throw new Error(`unknown or ambiguous wait check: ${target.name}; use its exact workflowName`);
    return matches[0];
  });
  const threads = input.threads.map((id) => {
    const thread = facts.threads.find((t) => t.id === id);
    if (!thread) throw new Error(`unknown wait thread: ${id}`);
    return thread;
  });
  if (input.kind === 'baseline' && !checks.some((c) => c.outcome === 'failed')) throw new Error('a baseline wait must name a failing check');
  if (input.kind === 'checks' && checks.length === 0) throw new Error('a checks wait must name the checks being awaited');
  if (input.kind === 'human') {
    if (facts.blockers.some((b) => !HUMAN_BLOCKERS.has(b))) throw new Error('cannot wait only for a human while other blockers remain');
    if (facts.checks.some((c) => c.outcome === 'pending')) throw new Error('checks are still running; use a timed checks wait');
    if (facts.checks.some((c) => c.outcome === 'failed' && !checks.some((t) => checkKey(t) === checkKey(c)))
      || facts.threads.some((t) => !t.resolved && !threads.some((s) => s.id === t.id))) {
      throw new Error('a human wait must account for every failing check and unresolved thread');
    }
  }
  return {
    kind: input.kind, headSha: facts.headSha, reason: input.reason.trim(),
    createdAt: now, until: minutes === null ? null : now + minutes * 60_000,
    checks, threads, reviewDecision: facts.reviewDecision, blockers: facts.blockers,
  };
}

/** An explicit wait never hides new failures/comments/conflicts. It can only absorb base movement
 * for the exact failed checks already handled, plus the ordinary silence guard. */
export function inspectWait(wait, snap) {
  if (!wait || wait.headSha !== snap.latestCommitOid) return { wait: null, changed: [], ignoreBase: false };
  const current = waitFacts(snap);
  const changed = [];
  if (!current.complete) return { wait, changed, ignoreBase: false };
  for (const old of wait.checks) {
    const check = current.checks.find((c) => checkKey(c) === checkKey(old));
    // Running is not actionable. Completion of a different attempt is, even with the same verdict.
    if (!check || (check.outcome !== 'pending' && (check.outcome !== old.outcome || check.attempt !== old.attempt))) {
      changed.push(`check ${old.name}`);
    }
  }
  for (const old of wait.threads) {
    const thread = current.threads.find((t) => t.id === old.id);
    if (!thread || thread.resolved !== old.resolved || thread.outdated !== old.outdated) changed.push(`thread ${old.id}`);
  }
  if (current.blockers.includes('branch_behind_base') && !wait.blockers.includes('branch_behind_base')) changed.push('branch requires an updated base');
  if (current.reviewDecision !== wait.reviewDecision) changed.push('review decision');
  const ignoreBase = current.checks.filter((c) => c.outcome === 'failed').every((c) =>
    wait.checks.some((old) => checkKey(old) === checkKey(c) && old.attempt === c.attempt && old.outcome === c.outcome));
  const signature = JSON.stringify([
    wait.checks.map((old) => current.checks.find((c) => checkKey(c) === checkKey(old)) ?? null),
    wait.threads.map((old) => current.threads.find((t) => t.id === old.id) ?? null),
    current.reviewDecision, current.blockers.includes('branch_behind_base'),
  ]);
  return { wait, changed, ignoreBase, signature };
}
