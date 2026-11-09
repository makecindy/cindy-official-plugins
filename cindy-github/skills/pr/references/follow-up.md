# How the background check decides

Read this when debugging a follow-up, or before changing the schedule or the check. Day-to-day rounds only need SKILL.md.

The schedule fires every 5 minutes (older schedules: every 10, switched by their next round). Each time, `scripts/pr-heartbeat-gate.mjs` runs first as the schedule's pre-run check:

- **exit 0:** wake the agent in the bound task; the check's output, including the list of what happened, is attached to the prompt.
- **exit 2:** skip this run. No model call, no tokens, nothing in the task.
- **anything else:** the run is recorded as failed and the user is notified.

Each check saves its decision, reason, detail and list as `lastResult`. The agent reads it with the read-only `--last-result --json`, which also returns the current `wait` and the acknowledged/released `waitContext`.

## Pace: most firings end at once

Before any GitHub call the check asks whether a look is due, from what its last look saw (`lib/follow-pacing.mjs`). A firing that is not due ends with `not-due`: no API call, no state change.

| Stage | Looks |
|---|---|
| Fast: an unacknowledged update, a due model wait or defer or no-checks deadline, an open settle window | every firing |
| Explicit model wait | every 5 minutes to detect new work; this does not call the model |
| Active: checks running, a failure, a conflict or merge-queue problem, a new commit or an agent round in the last hour | every firing of the 5-minute schedule |
| Idle | about every 10 minutes |
| Waiting: only a human approval or the merge is left (`READY`, `BLOCKED_HUMAN`) | about every 30 minutes |
| Quiet: a draft, or nothing changed for 6 hours | about every hour |

**Cindy fires it early.** When the title-bar PR status (refreshed about every 90 seconds while someone looks at Cindy) shows a change for this PR, Cindy runs the schedule at once and tells the check through the hook's stdin (`trigger: { kind: 'watch', … }`). Such a run skips both the pace and the probe and reads the PR in full. `--triggered` does the same by hand; `--no-pacing` looks every time.

## Batching: collect a push's feedback first

After a new commit (one first seen while following, not the commit already there when following started), news that only bots and checks produced is held (`settling`) until every expected bot has answered on that commit, or 20 minutes after the commit was first seen:

- **Expected bots:** bots that reviewed or reacted on this PR, plus bots that reviewed or reacted on other PRs of this repository in the last 14 days (`<owner>__<repo>.repo.json` in the state directory). Plain comment bots (deploy previews) are not waited for; neither is the agent's own account.
- **Answered:** a review on the new commit, or a comment, thread comment or reaction from that bot since the commit was first seen (5 minutes of slack). Codex's 👍 counts: it means no suggestions.
- **Not held:** comments or reviews from people, new conflicts, changes to named wait conditions, merge-queue problems, draft changes, merged or closed, and an update already released but not acknowledged.
- **Checks are not waited for.** A failure that arrives while the agent works is folded in before its push.

While a round settles the watch does not advance, so the held items and anything newer arrive together in one wake.

## Cost: a small question first

Every check first runs `pr-snapshot.mjs --probe`: one small GraphQL query for the PR's state, head, mergeability, check counts by state, the newest comment and review, and the base branch's commit (used only while a check is failing). When it matches the last full read, the check stops there (`unchanged`). It reads the PR in full (three or four API calls) only when the probe differs or when one of these holds: an update was released but not yet acknowledged, checks were still running or mergeability was unknown at the last full read, the PR is merged or closed, 30 minutes have passed since the last full read (the probe cannot see edits inside review threads), a new commit's check deadline or a defer is due, or the silence guard is due. A failed probe also falls back to a full read. While an explicit wait names checks or threads, each due poll reads in full instead of probing: equal counts can hide a rerun or an inline resolution. Such changes must not wait for the 30-minute fallback. Waits without named targets still use the small probe. Host triggers accelerate observation, never bypass the wait filter.

## When the agent is woken

The check keeps a `watch`: what the agent has already been told about. It wakes the agent only for news against it, in the spirit of T3 Code's pull request watch:

- **Checks failed:** a check failed (including cancelled, timed out or needing action) that had not failed on this commit before. Reported once per commit and name; a re-run that replaced a failed attempt no longer counts, because the snapshot keeps only the latest run of each check.
- **Checks passed:** all required checks passed (all checks when the repository marks none as required). Non-required checks still running at that moment get one more update when they all finish; later changes to them do not wake.
- **Comments:** new comments, reviews with a body or a verdict, and review-thread comments from anyone except the account the agent uses. Edits count as new. Empty "commented" reviews are skipped; their thread comments carry the content.
- **Base moved while failing:** a check is failing and the base branch got a new commit (`base-moved`), for example a fix for a baseline failure. Both the probe and full snapshot read the live GraphQL `baseRef.target.oid`; the REST pull base SHA can lag behind the branch. When the updated base contains the fix, merge it into the PR, verify and push, then confirm CI on the new head. While nothing fails the base is not watched, so ordinary base progress never wakes. During an explicit wait, base movement is absorbed only when every currently failing check is the exact named attempt already handled; a timed baseline wait revisits the accumulated base updates at its deadline. Any other failure retains the ordinary base watch.
- **Conflict:** the branch started to conflict with the base. GitHub's mergeability recomputation ("unknown") neither raises nor clears it.
- **No checks:** 15 minutes after a new commit, no check has reported, although this PR ran checks before.
- **Draft:** the PR became a draft (`draft-entered`) or left draft (`draft-exited`).
- **Merge queue:** the merge queue removed the PR, its group's checks failed, or the group cannot merge. Waiting in the queue does not wake.
- **Merged or closed:** always, until the schedule is deleted (cleanup must happen; a failed cleanup gets another round).

Not woken: pushes, checks starting or running, an unchanged failure, the agent's own comments, base progress covered by an explicit wait. New technical comments are never suppressed merely because an older thread awaits approval. These advance the watch silently.

- **Comment limit:** after 10 updates in a row that bring only comments, the check asks the agent to stop following (`comment-limit`), which stops reply loops with bots. A push or any check, conflict or queue news resets the count.
- **Defer:** `--defer <minutes>` acknowledges the round and asks for one more wake at that time if nothing happens first (`defer-expired`).
- **Silence guard:** after 24 hours without waking the agent, one look at what the check cannot see (`silence-guard`). Not during an explicit model wait, or while only a human approval or the merge is left (`waiting-human`): there is nothing for the agent to do, and any change is reported by the check itself.
- **Truncated snapshot:** incomplete data never counts as "nothing changed"; the watch does not advance past it.

## Model-directed waits

A wait delays **model work**, not observation of GitHub. No extra scheduler, background process,
lock or queue is added: `--wait` acknowledges the current round and writes one record alongside
`watch` in the existing state file. The schedule stays at five minutes. A skip creates no model
turn and no conversation message. Do not change its cron to implement a wait.

Read `--last-result --json`, then create a JSON file from its `waitContext` (substitute real values):

```json
{
  "kind": "human",
  "headSha": "<waitContext.headSha>",
  "reason": "The maintainer must decide this specific certificate finding; its use was reviewed.",
  "afterMinutes": null,
  "checks": [{ "name": "CodeQL", "workflowName": "" }],
  "threads": ["<the corresponding thread id>"]
}
```

Apply with `node "<skill-dir>/scripts/pr-heartbeat-gate.mjs" <PR_URL> --wait <plan.json>`.
Check the `wait-set` receipt; `--last-result --json` reads it back without changing anything.
The JSON file is consumed once, not kept as a dependency. The reason is the agent's conclusion,
never an instruction copied from a PR comment. This changes only wake-up decisions, not GitHub
checks, merge permissions, thread resolution or the PR's verdict.

| Kind | When to use | Next review |
|---|---|---|
| `human` | All remaining failures/threads have been investigated and need a human action | `null`: relevant events only; optional timed review if justified |
| `baseline` | A named failed check also fails on the base; waiting for its fix | Usually 10–15 minutes during active repair, 30–60 after repeated blockage; batch base commits until then |
| `checks` | Named CI checks are running; there is no work to do before a result | Choose a time, often 10–20 minutes; completion can wake earlier |
| `retry` | An external temporary dependency needs another attempt | Choose a time from the observed failure and its likely recovery |

Durations are 5–1440 minutes. Only `human` accepts `null`. Repeated baseline failures should get
longer evidence-based waits, not a five-minute timer or repeated reruns. New work is never delayed
until that timer. After a push use ordinary ack and the existing bot settle window; do not extend
bot batching with successive model waits. A baseline fix must be merged and pushed, not just rerun
on the old commit. When several causes coexist, use a timed wait and include the handled checks;
only choose indefinite human waiting when every failing check and unresolved thread is accounted for.

Safety and resumption:

- Check names must exist and be unambiguous; include `workflowName` when needed (empty string is a
  workflow with no reported name). Threads use exact IDs. Unknown fields, a stale head, missing data,
  uncovered failures/threads in a human wait, or other actionable blockers reject the plan **before ack**.
- A slow round binds to its earliest released observation, not whatever a later poll saw. Newly arriving
  failures and feedback still get a round. A new head invalidates the wait; an own push alone still
  does not wake the model, and new-head bot batching continues normally.
- New failures, human or bot feedback, conflicts, queue problems, draft changes, merged/closed states
  remain actionable. Named checks completing (including an optional failure passing), a new completed
  attempt with the same result, named threads resolving/outdating, approval changes and a newly required
  base update also wake. Starting a check does not wake. Required status alone never decides suppression.
- Base movement alone cannot wake when all remaining failures are the exact handled attempts. This
  applies to ordinary polls and host-triggered polls. Baseline waits get their model-chosen deadline;
  indefinite human waits do not get daily reminders.
- Expiry uses the same pending/ack/retry mechanism as other events. If the model fails to start or
  crashes, the deadline is retried with backoff, not silently consumed. Ack clears the wait; the next
  round chooses a new one if needed. Real new events can break a retry backoff.
- Missing/truncated data is never evidence of continued waiting. It requests investigation without
  advancing past potentially unseen events. Existing network failures and rate-limit backoff still apply.

Latency: with Cindy running and GitHub available, an explicit wait is inspected on each five-minute
poll; a host status trigger can inspect sooner. Model start still depends on the task being available.
Only post-push bot/check feedback retains the existing maximum 20-minute batching window. This is not
a real-time delivery guarantee. Without an explicit wait, existing stage pacing and the 30-minute
full-read fallback remain unchanged.

## Reliability rules

- **Two-phase watch.** A released update stays pending until the agent's `--ack` moves `pendingWatch` into `watch`. If the run never starts or crashes, the same items are released again: three quick retries, then every 30 minutes until acknowledged. Releases less than 5 minutes apart (the host postponing a run) do not count as attempts.
- Pending records only the earliest unacknowledged watch, so a slow agent's `--ack` can only confirm what it was actually told; anything newer is reported again. This relies on one agent turn at a time in the bound task: keep `bindToCurrentSession: true`.
- If the items disappear before the agent acknowledges them (for example a fix was pushed), the pending update is dropped.
- **Snapshot failures** are skipped up to three times in a row before the check fails and the user is notified. A GitHub rate limit backs off until the reset time from the response headers. The same failure is reported at most once a day.
- After the same update goes unacknowledged for three backoff cycles, the detail tells the agent to notify the user.
- **Upgrades.** A state file written by the earlier version of the check (fingerprints, no watch) starts a watch from the current PR without repeating old news. If it still had an unacknowledged change, the agent is woken once (`upgraded`). Retired options (`--no-cadence-throttle`, `--draft-reminder-hours`, `--max-work-pending-passes`) are accepted and ignored so existing schedules keep working.

## Machine-checked hints in the detail

- `round=N`, with checkpoint instructions from round 5 and convergence mode from round 10 (`references/review-convergence.md`).
- **Scope growth:** the diff grew at least 1.5× and by 300+ lines since following started. Machinery grown under review should usually be deleted.
- **Almost there:** only human blockers left and at most two active threads. Finish them, then wait silently.
- **Hotspot:** one file has 8+ review threads. Redesign or declare scope instead of patching further.

## Files

- State: `~/.cache/cindy-pr/<owner>__<repo>-<number>.json` (override with `--state-dir` or `CINDY_PR_STATE_DIR`). It lives outside the worktree because cleanup deletes the worktree.
- `pr-snapshot.mjs`: read-only facts, including merge-queue state, required checks and the viewer; `--probe` prints the small change fingerprint. Not a pre-run hook by itself: its exit codes do not match the hook protocol.
- `pr-cleanup-plan.mjs`: read-only local cleanup plan after merge or close.
- `pr-preflight.mjs`: read-only checks before pushing (not on the default branch, DCO only when the repository requires it, Prettier only when configured, uncommitted or unpulled changes), plus the rule files and PR template to follow.
