# Background Follow-Up Round

Read this when woken up by a scheduled PR follow-up round (`SKILL.md` section 5), or when ending follow-up / toggling draft state.

Read the gate's event report; `--last-result --json` also provides `waitContext`. Follow any convergence instructions in `detail`. Refresh the named PR card first to verify ownership: on `existing_task`, do no work or gate acknowledgement; delete only this task's duplicate schedule after checking its target. If ownership is unknown, stop the round.

1. **Handle new work** as in `references/fix-round.md`: failed checks, feedback, conflicts and queue problems. On `base-moved` or a baseline wait's expiry, look for the fix on the base; when present, merge, verify and push it, then confirm CI started on the new head. If still blocked, record a wait; rerun only a confirmed flake, once. Reassess changed/expired waits and investigate unavailable data. A `silence-guard` is a chance to inspect what the gate cannot see. A `defer-expired` means continue with the results available.
2. **Refresh the card** before finishing, using `card_id`, `repo` and `pr`; add `to_latest: true` only when notifying below. If an older schedule has no card, create one with `following: true` and add its ID to the schedule prompt, preserving its timing and hook.
3. **Finish once**, using `node "<skill-dir>/scripts/pr-heartbeat-gate.mjs" <PR_URL>` with one of:
   - `--wait <plan.json>` when blocked: choose concrete targets and a useful review time from `waitContext`; see [Model-directed waits](follow-up.md#model-directed-waits). A CI failure this PR did not cause (it fails on the base, or shared tooling, dependency install or infrastructure broke) is a `baseline` wait even if base CI passes intermittently; pass `afterMinutes: null` and the program backs off from 15 minutes to 12 hours, looking within an hour after the base moves. Use `human` only when a person must act on this PR itself. A human wait that only awaits approval or the merge may use `afterMinutes: null`. One that sets a failing check or an open thread aside for a human comes back within a day: confirm the reason still holds (the base may have fixed or dismissed it) before waiting again.
   - `--resume "<what was handled or pushed>"` after resolving work or pushing. This clears the wait; the existing bot-review window handles the new commit.
   - `--ack` when no blockers or wait remain.
   Read the receipt; correct a rejected decision in this round. Reporting “waiting” in chat does not record a wait.

**Stop conditions.** Merged/closed → report once, end following, then `references/cleanup.md`. `comment-limit` → end following and explain. `draft-entered` → end following unless the user requested draft following or their saved preference allows it. While following a draft, fix normally but do not mark it ready without authorization.

**Notifications.** Every actual follow-up round that ends needing a user decision must ask again, even if the same question was asked earlier or this round found no GitHub changes. Call `schedule_notify_current_run`, bring the PR card to the latest reply, and briefly state progress, what is blocked, the specific decision needed, and your recommended option with its impact. Use the available question tool or decision card to present the choice; a passive “waiting for confirmation” status is not enough. Ask once per round, combining pending choices. Existing authorization remains valid; do not ask again for something already approved or treat silence as consent.

Stay silent for observation-only polls and rounds with no user decision or reportable event, including merely waiting for another reviewer's approval or an already-authorized merge. If merging actually needs this user's authorization, it is a user decision and follows the rule above. Also notify for merged/closed, following stopping itself, a problem stuck through several backoff cycles, or a `notice` in the `--wait` receipt. Both `notice: entered` and `notice: reminder` require a message in this round: say who must act and what is needed. When the user can decide (merge with an optional check failing, dismiss an alert, approve a workflow run), ask that specific question with a recommendation instead of merely saying “waiting for a maintainer” or asking only whether to keep following. When only somebody else can act, report that accurately without inventing a decision for the user. A missing `notice` never suppresses a known pending user decision.

## Ending following

Delete the schedule and verify deletion first; then set `following: false` on its card (add `to_latest: true` when notifying). If deletion is uncertain, keep the reservation and resolve it. This order also applies to foreground cleanup and a user stop request (do not run the full background-round steps above for a foreground stop).

## Older schedules

Change a ten-minute schedule once to `cronExpr: "*/5 * * * *"`, `intervalMs: 300000`, preserving its hook. When the prompt's fallback `SKILL.md` path is not under `/agent-skills/skills/`, replace that path once with the `SKILL.md` beside the hook's `scripts` directory. The script filters idle firings; five-minute checks do not imply five-minute model calls.

## Draft and ready

When the user asks in text to mark a draft ready, run `gh pr ready <PR_URL>`, refresh the card (`pr_card` with `card_id`, `repo`, `pr`) and apply its follow setting as after opening. When they ask to turn a PR back into a draft, run `gh pr ready --undo <PR_URL>`; if it was being followed, stop following as in `## Ending following` above, then refresh the card. (Foreground draft/ready requests do not run the full background-round steps above.)
