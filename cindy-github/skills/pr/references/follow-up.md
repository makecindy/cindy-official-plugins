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

After a new commit (one first seen while following, or the commit of a PR opened less than 20 minutes before following started; not an older commit already there), news that only bots and checks produced is held (`settling`) until every expected bot has answered on that commit, or 20 minutes after the commit was first seen:

- **Expected bots:** bots that reviewed or reacted on this PR, plus bots that reviewed or reacted on other PRs of this repository in the last 14 days (`<owner>__<repo>.repo.json` in the state directory). Plain comment bots (deploy previews) are not waited for; neither is the agent's own account.
- **Answered:** a submitted review on the new commit, or a 👍 from that bot since the commit was first seen (5 minutes of slack). A review naming an older commit never counts.
- **Not held:** comments or reviews from people (an approval without a comment asks nothing of the agent and is held with the batch), new conflicts, changes to named wait conditions, merge-queue problems, draft changes, merged or closed, and an update already released but not acknowledged.
- **Checks are not waited for.** A failure that arrives while the agent works is folded in before its push.

Only submitted `APPROVED`, `CHANGES_REQUESTED` or `COMMENTED` reviews, or a recent 👍,
count as completion. Plain comments (including Running/Queued summaries), individual inline
findings, pending reviews and 👀 do not close the window. Unknown or comment-only bot formats
remain bounded by the same 20-minute deadline; their feedback is retained for that round.

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

A round ends with one decision: `--wait <plan.json>` for a known blocker,
`--resume "<what was handled or pushed>"` to acknowledge and resume observation, or `--ack`
when nothing remains. All acknowledge only the earliest released observation. Plain ack refuses
an existing wait, incomplete/missing observations or remaining checks, threads or blockers;
it leaves state untouched and tells the model how to finish in the same turn. The gate's event
output carries the same short hint, including for schedules created before this protocol.
No extra wake or migration timer is added; an interrupted turn uses the existing retry/backoff.
Resume is the model's explicit account of its work, not machine proof that a failure was fixed.

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
| `human` | All remaining failures/threads have been investigated and need a human action | Only approval or the merge left: `null`, relevant events only. A failing check or open thread set aside: at most one day (`null` means one day) |
| `baseline` | A named failed check also fails on the base; waiting for its fix | Usually 10–15 minutes during active repair, 30–60 after repeated blockage; batch base commits until then |
| `checks` | Named CI checks are running; there is no work to do before a result | Choose a time, often 10–20 minutes; successful results are batched until all named checks finish |
| `retry` | An external temporary dependency needs another attempt | Choose a time from the observed failure and its likely recovery |

Durations are 5–1440 minutes. Only `human` accepts `null`. Setting a failure or thread aside for a
human is a verdict that can go stale, so it is reviewed daily: confirm the reason still holds (the
base may have fixed or dismissed it), then wait again or resume. Repeated baseline failures should get
longer evidence-based waits, not a five-minute timer or repeated reruns. New work is never delayed
until that timer. After a push use `--resume` and the existing bot settle window; do not extend
bot batching with successive model waits. A baseline fix must be merged and pushed, not just rerun
on the old commit. When several causes coexist, use a timed wait and include the handled checks;
only choose human waiting when every failing check and unresolved thread is accounted for.

The `wait-set` receipt of such a wait carries `notice` when the user is owed a message: `entered`
the first time on this head, then `reminder` on every model renewal, including a same-day renewal.
Each actual round states progress and the blocker; if the user must decide, ask that specific
question again with a recommendation. No-change polls still skip without a message or model call.
An absent receipt notice does not override a pending user decision known to the agent. A wait recorded before this rule existed is reviewed a day after it was set
and reported once.

Safety and resumption:

- Check names must exist and be unambiguous; include `workflowName` when needed (empty string is a
  workflow with no reported name). Threads use exact IDs. Unknown fields, a stale head, missing data,
  uncovered failures/threads in a human wait, or other actionable blockers reject the plan **before ack**.
- A slow round binds to its earliest released observation, not whatever a later poll saw. Newly arriving
  failures and feedback still get a round. A new head invalidates the wait; an own push alone still
  does not wake the model, and new-head bot batching continues normally.
- New failures, human or bot feedback, conflicts, queue problems, draft changes, merged/closed states
  remain actionable. In a `checks` wait, a successful partial result (including a required-check
  milestone) is absorbed while another named check is pending; all named checks completing or the
  original deadline wakes once. Progress never extends that deadline. A missing target, failure or
  recovery of a previously failed target still wakes. Other wait kinds batch the same way: while a
  named check is still running, further attempts of a failure the wait already accounts for (a rerun
  that fails again, or recovers) are reported once, when the named checks have all finished or the
  deadline arrives, as a changed wait rather than as new failures. A failure the wait does not name
  is never held. Named threads resolving/outdating, approval changes and a newly
  required base update also wake. Starting a check does not wake.
- Base movement alone cannot wake when all remaining failures are the exact handled attempts. This
  applies to ordinary polls and host-triggered polls. Baseline waits get their model-chosen deadline;
  a human wait gets its daily review only when it sets a failure or thread aside.
- Expiry uses the same pending/ack/retry mechanism as other events. If the model fails to start or
  crashes, the deadline is retried with backoff, not silently consumed. Replace the wait with
  `--wait`, or clear it with `--resume` after handling the work. Plain `--ack` and legacy `--defer`
  cannot discard an existing wait. Real new events can break a retry backoff.
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
- **Almost there:** only human blockers left and at most two active threads. Finish them, then ask again if a user decision remains; otherwise wait silently.
- **Hotspot:** one file has 8+ review threads. Redesign or declare scope instead of patching further.

## Files

- State: `~/.cache/cindy-pr/<owner>__<repo>-<number>.json` (override with `--state-dir` or `CINDY_PR_STATE_DIR`). It lives outside the worktree because cleanup deletes the worktree.
- `pr-snapshot.mjs`: read-only facts, including merge-queue state, required checks and the viewer; `--probe` prints the small change fingerprint. Not a pre-run hook by itself: its exit codes do not match the hook protocol.
- `pr-cleanup-plan.mjs`: read-only local cleanup plan after merge or close.
- `pr-preflight.mjs`: read-only checks before pushing (not on the default branch, DCO only when the repository requires it, Prettier only when configured, uncommitted or unpulled changes), plus the rule files and PR template to follow.

## Required checks and delivery evidence

Full snapshots read active rulesets and the classic protection visible to the current account.
A null GraphQL branchProtectionRule can mean absent OR not visible; it is not proof of an empty
classic policy for non-admin accounts. GitHub mergeability/protection remains authoritative. Only absent check names get an
ExpectedCheck placeholder. Once a real check registers, GitHub's status and merge protection are
responsible for its application requirements; missing app metadata does not create a duplicate.
An expected target can become a real workflow without changing a checks wait or its original deadline.
Aggregate jobs often register last: while actual checks are pending, missing placeholders do not
trigger the registration watchdog. After actual activity stops, the existing fifteen-minute window
provides a grace period. The next observation determines when that window starts.

Rules-read failures do not discard checks or feedback. After two consecutive failed full reads, a dedicated rules-read notice survives
resume/ack and brief recoveries, and repeats at most daily once acknowledged; normal new events still wake. Unacknowledged
notices retain the existing retry/backoff. Do not report ready with unreadable rules. Ordinary check completion still wakes, and human
approval waits remain available during the outage. Transient rule calls retain one retry. No stale rules
cache or new polling loop is added. The lightweight probe may defer a rules-only change until the
existing full-read cadence; the final snapshot always reads rules again.

The bot settle window accepts completed SUCCESS checks from the expected reviewer's exact App
slug on the current commit. Latest attempts per app/check are considered. Failed/cancelled/skipped
checks are not successful completion. This ends batching, not merge protection or feedback handling.
Bots without reliable checks retain review/reaction signals and the twenty-minute cap.

Before reporting ready or an authorized merge, refresh with --expect-head <verified-head> --strict-exit.
Base movement alone does not invalidate the round. GitHub's expected-head merge check and branch
protections remain authoritative; a snapshot is not an atomic merge guard.

## Local evidence and continuous replay

Each gate observation and finish receipt appends to <state-file>.trace.jsonl (2 MiB plus one rotated
file), with a shared 32 MiB budget per state directory and fourteen-day retention enforced on
writes. Pacing-only firings without new inputs are not recorded. Bodies become fixed empty/redacted/approval markers; explanations and API error text are
omitted. Raw comment text is never retained. Identifiers, timings, check identities and local
pre-observation state remain private diagnostic data. CINDY_PR_TRACE=0 disables recording.
Recording failures never change the gate decision. Oversized/failed samples are explicit replay gaps.

Run `node <skill-dir>/scripts/pr-follow-replay.mjs <trace.jsonl> [candidate-scripts-directory]`.
The trace must be chronological and for one PR; concatenate .1 before the current file when needed.
Replay seeds once, then carries state through observations and recorded ack/wait/resume actions.
It never changes production state or calls a model. It reports wake counts and decision differences,
not an inferred empty-work rate. Missing snapshots or rejected model receipts stop the replay with
an explicit gap; a different candidate may require inputs the original run never collected.
This is evidence-driven comparison, not simulation of what a model would choose under a new policy.

A suppressed rules-read notice follows the ordinary waiting/defer/retry flow; it must not drop
an existing deadline. If a delivered round could not confirm ready solely because rules were
unknown, the same-head watch retains that obligation. When a later snapshot is READY with readable
rules, `rules-recovered` requests one reassessment through the existing pending/ack protocol.
A transient failure that never prevented a ready result does not create this recovery event.
