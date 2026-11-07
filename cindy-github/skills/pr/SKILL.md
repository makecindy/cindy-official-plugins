---
name: pr
description: Carry a GitHub pull request from start to merge in any Git repository - start the work on a fresh branch, open the PR only when the user asks for it, fix failing checks, merge conflicts and review feedback, follow it in the background, and clean up after merge. Use when the user invokes /pr or gives a PR link, starts a feature or fix that will become a pull request, or asks to open, fix or follow a PR.
---

# PR

Take a change from its first edit to a merged pull request without the user having to supervise. The goal is a mergeable PR, not answering every comment: before each round ask "what still stands between this PR and mergeable?"

Reply in the user's language. Read the reference files only when this file points to them.

**PR card:** `ghost_call` `cindy-github` / `pr_card` (in Claude Code `mcp__cindy__ghost_call`; load it with ToolSearch if deferred). It comes with the same GitHub plugin as this Skill, so it is unavailable only when that call fails; never ask in text instead. When the card you need is far up the conversation, bring it down instead of telling the user to scroll up to it: update it with `card_id` and `to_latest: true`, which moves it under this reply and removes it from where it was. A card that is still in view can stay where it is.

**What wins:** the user's explicit instructions and saved preferences first, then the repository's own rules (AGENTS.md, CLAUDE.md, CONTRIBUTING, the PR template), then this Skill's defaults. This Skill adds no commit, test or PR rules of its own.

`<skill-dir>` below is the real directory of this Skill. The directory you were given may be a temporary link that disappears when Cindy restarts, so resolve it once: run `realpath` on the directory containing this SKILL.md and use that path everywhere, including the schedule hook. When Cindy saves the schedule it replaces that path with this Skill's entry that survives plugin updates. Quote every path.

## Boundaries

- **Decide technical questions yourself** and carry them through: correctness, tests, types, lint, CI, races, performance, error handling, compatibility, security hardening, structure, local architecture trade-offs, reviewer P1/P2 suggestions. Never hand the user an "A or B" technical choice.
- **Ask the user first** only for: product behaviour changes; security, permission or privacy boundaries; splitting the PR; adding new machinery that significantly raises complexity (concurrency, locks, caches, persistence, retries). Give your recommended option, the trade-off and the impact.
- **Tell the user** (do not ask) when a problem stays stuck after repeated attempts; the check output names these cases.
- Deleting machinery that grew during review, reverting, or shrinking back to the PR's original goal is technical convergence. It needs no confirmation and is not "splitting the PR".
- Never push or open a pull request until the user explicitly asks for one or clicks the PR card's button. Approving a plan does not count, even one that mentions a PR. Never approve, merge, enable auto-merge, re-enqueue a merge queue, or take a PR out of draft unless the user authorised it for this repository. Authorisation for one repository never carries to another.
- Never stash, reset, clean, revert or overwrite the user's uncommitted changes. Never force-push.
- Public replies stay short, factual and traceable. Ask before posting anything that takes a product position, discloses sensitive material, or attaches screenshots.
- Requires the GitHub CLI signed in (`gh auth status`) and Node.js. If GitHub is not signed in, call Cindy's `connect_account` with `kind: "plugin"` and this plugin's id: Cindy opens its own GitHub sign-in on this computer (`GITHUB_SIGN_IN_REQUIRED`), so tell the user to finish it there and check `gh auth status` again; never ask for a token in chat. If that is unavailable, Node.js or `gh` is missing, or the repository is not on GitHub, say exactly that; you can still do the local work.

## Where to start

- **No PR yet** (a change to make or finish): sections 1 and 2.
- **An existing PR** (a link or number, `/pr <link>`, "follow <link>", or the current branch's PR): first show its PR card if this task has none (section 4), do a fix round only if something stands in the way (section 3), then start following it in the background (section 4). Following is the default here; skip it only when the user said to just check or look.
- **A background round** (the prompt says so): section 5.
- **An issue to fix** (a link to an issue): start the work as in section 1 and link the issue in the PR. Claim or comment on the issue only if the repository's CONTRIBUTING asks for it, and ask the user before posting.

## 1. Start the work

For a change that will become a pull request (not for a question or a read-only investigation):

- **Already isolated:** if the task already works in a worktree or feature branch made for this same change, keep using it. A branch left over from another change does not count: create a task worktree instead of stacking unrelated commits on it. If it is behind the remote default branch, merge that in before continuing.
- **Otherwise create a task worktree:** call `cindy_helper` → `create_task_worktree` (category `control`; pass `repo_dir` when the task directory is not the repository itself). Cindy creates a branch from the freshly fetched remote default branch, binds the worktree to this task and removes it when the task is archived. The task itself does not move: run every shell command from the returned `worktree_path`, use absolute paths inside it for edits, and re-read the repository's rules there (the main checkout may be older). Keep using that path after restarts and context compaction.
- **Fallback** when the tool is unavailable or fails: fetch, then `git worktree add -b <branch> ../<repo-folder>-<slug> origin/<default-branch>` and work there.

## 2. Open the pull request

**Explain the change before offering to publish.** Once the work is verified, give a concise, self-contained summary in the conversation before showing the PR card or asking in text. Lead with the problem and resulting behavior, then the main changes and verification results; mention material limitations when present. Use plain language and scale the detail to the change: a small fix may need only a few sentences. File names, diff statistics and a card alone do not explain what the PR does. Base the summary on the final diff, including related uncommitted work. If the user already asked to publish, give the same brief explanation and proceed without another approval round.

**Use visuals when they clarify the change.** A before/after screenshot can explain a UI change; a small diagram can explain a flow or interaction. Keep simple changes textual. Show any proposed screenshots before asking to publish and obtain approval to attach them under the boundaries above; reuse existing approval for those exact assets. Prepare useful visuals for both the conversation and the PR: use GitHub-compatible Markdown images or Mermaid in the PR, with captions and a short textual explanation. Cindy-only components need a portable equivalent. Image links must be durable and accessible to the repository's readers, not local paths or session-only references. If an asset cannot be shared, retain the explanation and state the omission instead of inserting a broken link.

1. **Ask once, unless the user already asked you to open it** (then go straight to step 2). When the work is done and verified and you are waiting for the user's go-ahead to publish, including when they said "not yet" or "let me look first", ask with the PR card instead of inviting confirmation in text when Cindy's GitHub plugin offers it: `ghost_call` with `ghost_id` `"cindy-github"`, `namespace` `null`, `tool` `"pr_card"` and args `repo`, `head`, `base`, plus `commits` and `files_total` from `git rev-list --count` and `git diff --name-only` against `origin/<base>` (count uncommitted changes too). The card does not need title or description fields; the explanation above belongs in the conversation. If this branch already has a card, update it with its `card_id` and the new counts rather than showing a second one. Keep the returned `card_id`, end your reply with one short line pointing at the card without saying where it is (Cindy places it at the end of your reply), and do not ask again in text. The user answers by clicking (a hidden message from the plugin arrives with the choice and the card's `settings`) or by saying so. Ask in one short sentence instead when the plugin is unavailable or the user is talking to you through an IM channel, where cards are not shown. Just ask; do not explain that this Skill or a rule makes you wait, and do not link this Skill or other local files.
2. Commit only related files, following the repository's rules. Run `node "<skill-dir>/scripts/pr-preflight.mjs" "<worktree>"` (add `--base <branch>` when the PR targets a branch other than the default one): fix every `BLOCK` (it checks only what the repository declares, such as DCO sign-off), handle each `WARN`, re-read the rule files it lists, and use the PR template it prints. Push the branch, then `gh pr create` (ready for review unless the user chose a draft), adapting the explanation and useful, approved visuals above to the repository's PR template: what changed, how it was verified, risks. Write for reviewers who have not seen the conversation, and refresh the description and visuals if the final scope changed. Preserve the explanation when no template exists. Before reporting success, read back the published body and check that the intended text, diagrams and image references were carried over.
3. **Complete the follow-up handoff on every channel, including IM.** Card visibility only changes presentation, not whether saved preferences apply. In Cindy, update the existing `pr_card` with `pr`, or create it with `repo` and `pr`, and read its `settings`. For a PR in a group chat or an unrelated source task, read preferences first and put the card in the dedicated task described in section 4. In IM (or when card delivery fails), call `ghost_call` with `ghost_id: "cindy-github"`, `tool: "pr_follow_settings"`, `args: {}` to read the same preferences without showing a card. A settings read failure is unknown, never `auto_follow: false`; use an already-known explicit instruction if available, otherwise report the missing setting and offer following once in text. Do not repeat a failed card call just to obtain settings.
4. Apply the user's explicit instructions first, then saved preferences. A prior explicit stop for this PR still wins; do not restart it on an ordinary update. `auto_follow: true` → section 4, without asking again (drafts still require the user's draft-follow preference or explicit request). `auto_rename: true` applies to the PR's own task, never to the originating group chat. Pass `follow_model` intact into the follow-up handoff. Only report `renamed` / `following` on the card after the corresponding action has succeeded.
5. **Close with the actual follow-up state alongside the PR link:** verified active (name the independent task if used), not enabled, setup pending, waiting for a decision, finished because the PR is merged/closed, or failed to start (reason and next step). A created task or a delivered handoff alone is not active follow-up. Do not end with only "waiting for CI/review". If no instruction or preference enables following, offer it once as described in section 4. Apply this same closure after updating a PR: recheck existing follow-up and do not silently leave a previously missed handoff unaddressed.

## 3. A fix round

To take over an existing PR, use the link or number given, or the current branch's PR (`gh pr view --json url --jq .url`). Derive `owner/repo` from the URL or `origin`; never assume it. Confirm the PR is open; if its head is a fork you cannot push to, say so and stop. Work on its head branch: if the current directory is a clean checkout of it, use it; otherwise create a task worktree as in section 1 and run `gh pr checkout <number>` inside it.

1. Get facts, do not reconstruct them from memory or flat `gh` output:
   `node "<skill-dir>/scripts/pr-snapshot.mjs" <PR_URL>`. Use its `verdict` and `blockers[]`. If the snapshot fails or is truncated, never claim the PR is clean.
2. Review threads are read per thread, active **and** outdated. For each outdated unresolved thread, check the current HEAD: still a problem → fix it; already fixed or superseded → reply pointing at the commit, then resolve.
3. **Feedback is a symptom, not a task list.** Before editing, attribute each comment to the invariant it reveals, group comments by that invariant (a failure family), and fix every path of the family, including ones nobody pointed at. Fix one family at a time, not one thread at a time. Method: `references/review-convergence.md`.
4. **Wait for the round to be complete.** While following, the check already does this: after a push it holds news from bots and checks until every bot reviewer of this PR or repository has answered on the new commit (a review, a comment, or a reaction such as Codex's 👍), or 20 minutes have passed. When it wakes you, fix everything it lists together. Without a schedule (a fix round in the foreground), if a bot reviewer that reviewed earlier commits has not yet reviewed the new head, wait for it once (see `references/review-convergence.md` §5). Checks need no separate wait: look at them again right before pushing (step 8) and fold in any failure that arrived meanwhile.
5. **CI:** read `gh pr checks` and `gh run view <run-id> --log-failed`. Failures unrelated to this PR (they also fail on the base branch) are baseline problems: do not mix fixes for them into this PR. Re-run only a confirmed flake, once (`gh run rerun <run-id> --failed`); a second failure is real.
6. **Conflicts or a stale base:** merge the base branch into the PR branch (`git fetch origin <base>`, `git merge origin/<base>`), resolve, test. Do not rebase a shared PR branch.
7. Verify with the narrowest tests, lint and type checks that cover the change, using the commands the repository's rules name (its own test gate when it has one). Write long test output to a log file and read the log to find failures instead of re-running a whole suite because the terminal cut it off. A failure unrelated to this PR is a baseline problem when it also fails on an up-to-date base: say so with that evidence, do not mix a fix for it into this PR, and do not let it block the push. Stage only related files.
8. **One push per round.** Check the PR is still open, run `pr-preflight.mjs` as in section 2 (with `--base <the PR's base branch>` when that is not the default branch), then `git push` once with all of this round's commits; confirm with `gh pr view --json commits` that they landed. Every extra intermediate push makes every bot review an intermediate state again.
9. Reply in each thread you handled (what changed, which commit) before resolving it: `gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=<thread-id>`. Where the reviewer is mistaken or the comment is stale, reply with evidence and resolve; do not distort the product to please a comment.
10. Re-run the snapshot to confirm: active and outdated unresolved threads are both zero, checks are green or pending on the new head.

Hard convergence lines (the check output repeats them with the current round number):

- **Do not grow machinery to satisfy reviewers.** If a fix would add concurrency, locks, caches, persistence or retries, first ask "if this whole mechanism were deleted, would the PR's original goal still hold?" If yes, delete it and shrink back. Only if no, ask the user before writing it.
- **Checkpoint:** when a previous fix missed the symmetric half of a path, or the same predicate appears for the third time, stop and do the checkpoint in `references/review-convergence.md` §2 before the next fix.
- **Round 5** with new serious findings: the checkpoint is mandatory. **Round 10:** convergence mode, batch whole families and keep going (it is not a stop condition), and tell the user the round count, the failure families and the chosen path once.

## 4. Following in the background

**When to follow:** when the user asked you to (including `/pr <link>` and the PR card's "Auto-follow until merged" button), or when the card's "Follow after opening" setting or their saved preference says so. With a PR card, its button and setting are the offer: do not also ask in text. Without a card, first read `pr_follow_settings`; apply an enabled preference without asking again. Only when no instruction or preference enables following, offer it once in one short sentence: you can keep following it in the background, fixing CI and review feedback and telling them when it is ready or needs them. If the user answers "always" or "never", save that preference where your memory tools allow and do not ask again. Do not follow draft PRs unless asked, or unless the user's saved preference says to follow drafts too: a draft is still being worked on. A draft's card offers "Mark ready for review" instead; the plugin converts it itself and, when the card's setting says so, then asks you to start following.

**Group chats and unrelated source tasks:** first confirm the PR is still open; if merged/closed, report that terminal state without creating a new follow-up. Otherwise keep this PR's background work in its own Cindy task. First find an existing schedule for the exact PR URL across devices (`schedule_list` with `device: "all"`, no status filter); inspect its target before reusing it. An offline device is an incomplete lookup, not proof of absence. Reuse an existing dedicated PR task when known. Otherwise discover `cindy_helper` `send_to_session` and create one with a concise PR title, the existing repository as `working_dir`, and `use_worktree: true`. Pass the exact PR URL, known follow preferences/model, original task context, authorization limits and a request to establish and read back the schedule. Keep the source group name and conversation intact. The dedicated task owns its card and schedule; bind there, never to the group or an unrelated dispatcher. Creation/delivery is only a handoff: query `schedule_list` / `schedule_get` for that target (or read its verified receipt) before reporting success. If still pending, say setup is pending. If handoff fails, report that following has not started; do not silently bind to the group. Do not create another independent task inside an already dedicated PR task.

If this task has no PR card for this PR yet (for example `/pr <link>` or "follow <link>"), show one first with `pr_card` (`repo`, `pr`) when the plugin offers it, and keep its `card_id` for the schedule prompt.

Use `cindy_scheduler` (`list_tools` with category `scheduler`, then `call_tool`). First `schedule_list` with `device: "all"` and without a status filter and look for a schedule whose prompt or `preRunHook.command` contains this exact PR URL (host, owner/repo and number). If one exists, check its target and status: an active schedule bound to the dedicated PR task can be reused; paused or expired is not running. Resume or repair only within the current authorization, and never create a second schedule to hide a binding or status problem. Otherwise call `schedule_create`, filling only the placeholders:

```json
{
  "name": "PR #<number>",
  "prompt": "Follow <PR_URL> with the pr Skill of Cindy's GitHub plugin (background round): load it first (in Claude Code it sits under the plugin `cindy-plugin-cindy-github`; if this session does not offer it, read <skill-dir>/SKILL.md) and follow its section 5. Checkout: <worktree path> (branch <branch>).",
  "cronExpr": "*/5 * * * *",
  "intervalMs": 300000,
  "timezone": "<the user's IANA time zone>",
  "recurring": true,
  "bindToCurrentSession": true,
  "silentWhenIdle": true,
  "agentKind": "<claude-code, codex or pi: the agent running this task>",
  "notify": { "desktop": true, "feishu": false },
  "preRunHook": {
    "command": "node \"<skill-dir>/scripts/pr-heartbeat-gate.mjs\" <PR_URL>",
    "timeoutMs": 180000
  }
}
```

- Add a line to the prompt only for facts specific to this PR that cannot be derived (for example a reviewer the user named), and `PR card: <card_id>.` when there is one. General procedure lives in this Skill, not in the prompt.
- The prompt names `<skill-dir>/SKILL.md` because a task whose agent runs on another computer (a remote or shared provider) may not offer this Skill there, while its shell still runs on this computer.
- The hook is a check that ships with this Skill: mount it directly, never generate one with `schedule_set_pre_run_hook` or copy the script. Do not pass `workingDir`.
- **Model.** When `pr_follow_settings`, the card's settings or the click event carry `follow_model`, the user chose the model for following: pass its `model_agent_kind` as `modelAgentKind`, plus `providerId`, `model`, `effort` (omit when empty) and `fastMode` from it, and its `agent_device_id` as `modelAgentDeviceId` when present (a model on another computer or a shared provider), then confirm them in the `schedule_get` read-back. Without `follow_model`, pass none of these so each round uses this task's model. If the scheduler rejects the chosen model, say so in one line and create the schedule without it rather than guessing another.
- The hook path must be the resolved `<skill-dir>`. Never put a path under the system temp directory (for example one containing `cindy-claude-skills-`) in the hook: it disappears when Cindy restarts. Resolve it right before creating the schedule: run `realpath` on the base directory Cindy gave when this Skill was loaded. If that directory no longer exists, load this Skill again for a fresh one. Never search the disk for it.
- `notify` values are JSON booleans. On `INVALID_ARGS`, fix the arguments once from the returned schema; if it fails again, report it.
- A returned id is not proof. Read it back with `schedule_get`, confirm `status: active`, the exact PR URL and intended target session, confirm its `preRunHook.command` points at this Skill's update-stable entry (the path contains `/agent-skills/skills/`), and confirm it appears in `schedule_list`. Tell the user in one line that following started and how to stop it ("say stop following", or the card's Stop button), and update the card with `following: true`.
- Leave `cronExpr` and `intervalMs` alone afterwards. The check paces itself from what it last saw: most firings end at once without calling GitHub, a PR that only waits for a human is looked at every 30 minutes, and Cindy fires the schedule at once when its title-bar PR status shows a change. How the check decides is described in `references/follow-up.md`.

## 5. Background round

The schedule wakes this task only when something new needs you: a check failed, the required checks passed, someone else commented or reviewed, the branch started to conflict, the base branch moved while checks are failing, no checks reported for a new commit, the PR became or left a draft, the merge queue dropped it, or it was merged or closed. Your own comments and pushes never wake you, and each failure or comment is reported once. Each round:

1. Read what happened: the check's output lists each item with links, and `node "<skill-dir>/scripts/pr-heartbeat-gate.mjs" <PR_URL> --last-result --json` returns the same list as `report`. Its `detail` carries the reason, the round number and any convergence instructions, which you must follow. Run `node "<skill-dir>/scripts/pr-snapshot.mjs" <PR_URL>` when you need more than the list, for example before calling the PR ready.
2. Do the work:
   - **Failed checks, comments, conflicts, merge queue problems:** a fix round (section 3). Each item is reported only this once: fix it, or reply where it was raised and say why not. Never just `--ack` with unhandled technical items.
   - **Required checks passed, approved, or only waiting for review, approval or merge:** nothing to fix; stay silent, the PR card shows it is ready. Waiting for approval or merge is not a decision for the user.
   - **`base-moved`:** checks are failing and the base branch moved. If a failure also failed on the old base (a baseline problem), merge the base in and push, or re-run the failed checks once; otherwise keep fixing this PR's own failure.
   - **`draft-entered`:** unless the user asked you to follow this draft or their saved preference says to follow drafts, tell them in one line that it became a draft and stop following (below). While following a draft, fix CI, conflicts and review feedback as usual, but never take it out of draft unless the user authorised that for this repository.
   - **`comment-limit`:** ten updates in a row brought only comments, usually a loop with a bot. Stop following and tell the user why.
   - **`defer-expired`:** the wait you set is over. Continue with what you have, for example fix with the bot feedback that did arrive.
   - **`silence-guard`:** a periodic look at what the check cannot see. Decide whether to merge in the base, re-run, close or nudge, rather than staying silent just because nothing changed.
   - **Merged or closed:** report it in one line, update the card (below), then `schedule_delete` this schedule (delete, never pause), then clean up (section 6).
3. If the prompt names a PR card, refresh it before finishing: `pr_card` with `card_id`, `repo` and `pr`. It reads the current CI, review and merge state itself. When this round notifies the user (below), add `to_latest: true` so the card moves under your message; otherwise it updates where it is. If it names none (a follow-up started before cards existed, or moved from another workflow) and the plugin is available, show one with `pr_card` (`repo`, `pr`, `following: true`), then add `PR card: <card_id>.` to the end of this schedule's prompt with `schedule_update` (pass `cronExpr`, `intervalMs` and `preRunHook` unchanged with it) so later rounds refresh the same card.
4. Finish every round with `node "<skill-dir>/scripts/pr-heartbeat-gate.mjs" <PR_URL> --ack`. Use `--defer <minutes>` (which implies `--ack`) only to be woken again at a set time when nothing else happens first; the check already waits for this push's bot reviewers by itself. When you are waiting for the user's decision, just `--ack`: their reply comes to this task.
5. **An older schedule:** if this schedule still fires every 10 minutes (`cronExpr` `*/10 * * * *`), switch it once with `schedule_update` to `"cronExpr": "*/5 * * * *"`, `"intervalMs": 300000`, passing `preRunHook` unchanged. The check paces itself, so the extra firings cost nothing.

**Notifications.** The schedule runs silently. Call `schedule_notify_current_run` (then write one short message) only when the user should know now: it was merged or closed, you need their decision, following stopped on its own (a draft or the comment limit), or the check reports a problem stuck for several backoff cycles. Never notify to say nothing changed or that the PR is ready to merge, and never nag about pending approval or merge.

**Ending following, on any path** (merged or closed, the user asks to stop or presses the card's Stop button, a draft or the comment limit, or cleanup done in the foreground): first update the PR card with `pr_card` (`card_id`, `repo`, `pr`, `following: false`; add `to_latest: true` when you also tell the user), then delete the schedule. A card left at "following" keeps telling the user a follow-up exists. The `card_id` is in the schedule prompt (`PR card: …`) or in this task's earlier card.

**Draft and ready.** When the user asks in text to mark a draft ready, run `gh pr ready <PR_URL>`, refresh the card (`pr_card` with `card_id`, `repo`, `pr`) and apply its follow setting as after opening. When they ask to turn a PR back into a draft, run `gh pr ready --undo <PR_URL>`; if it was being followed, stop following as above, then refresh the card.

## 6. Cleanup after merge or close

Run `node "<skill-dir>/scripts/pr-cleanup-plan.mjs" <PR_URL> --worktree <checkout> --fetch` from the primary checkout and follow its read-only plan:

- Only remove a worktree or local branch the plan says is safe (`canCleanupLocal`). Never delete remote branches or long-lived branches.
- `cindy_managed_worktree`: the worktree belongs to a Cindy task (including one made by `create_task_worktree`); Cindy removes it when that task is archived. Leave it.
- A dirty target worktree: list what is uncommitted and let the user decide; never stash or force-delete it.
- Closed without merging: ask the user before removing anything.
