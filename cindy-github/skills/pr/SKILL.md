---
name: pr
description: Carry a GitHub pull request from start to merge in any Git repository - start the work on a fresh branch, open the PR only when the user asks for it, fix failing checks, merge conflicts and review feedback, follow it in the background, and clean up after merge. Use when the user invokes /pr or gives a PR link, starts a feature or fix that will become a pull request, or asks to open, fix or follow a PR.
---

# PR

Take a change from its first edit to a merged pull request without the user having to supervise. The goal is a mergeable PR, not answering every comment: before each round ask "what still stands between this PR and mergeable?"

Reply in the user's language. Read the reference files only when the active scenario points to them.

**PR card:** `ghost_call` `cindy-github` / `pr_card` (in Claude Code `mcp__cindy__ghost_call`; load it with ToolSearch if deferred). It comes with the same GitHub plugin as this Skill, so it is unavailable only when that call fails; never ask in text instead. When the card you need is far up the conversation, bring it down instead of telling the user to scroll up to it: update it with `card_id` and `to_latest: true`, which moves it under this reply and removes it from where it was. A card that is still in view can stay where it is.

**One active follow-up per PR.** Cards may appear in multiple tasks. When nobody follows, the user can choose which task starts following; merely displaying an existing PR does not apply post-publication auto-follow or rename settings. Check every `pr_card` response before renaming, starting a fix round or creating a schedule. `disposition: existing_task` means another task is actively following (or starting/stopping): the card shows its status, explains why it is read-only, and contains a link to that follow-up task. Normally do not repeat `task_url` outside the card or start a second follow-up. On older clients, clicking the entry sends an `open-task` navigation event: reply only with its requested Markdown task link; this is not permission to start, stop, rename, transfer, or modify follow-up. The fallback keeps the existing minimum Host version; native in-card navigation is an optional enhancement. Do not automatically transfer an active follow-up. After the previous schedule has been deleted and its card reports `following: false`, the user can start following in any task. An unknown follow state must be resolved before creating a schedule.

**What wins:** the user's explicit instructions and saved preferences first, then the repository's own rules (AGENTS.md, CLAUDE.md, CONTRIBUTING, the PR template), then this Skill's defaults. Repository rules govern commit, test and PR requirements; the attribution below is a fallback.

`<skill-dir>` below is the real directory of this Skill. The directory you were given may be a temporary link that disappears when Cindy restarts, so resolve it once: run `realpath` on the directory containing this SKILL.md and use that path everywhere, including the schedule hook. When Cindy saves the schedule it replaces that path with this Skill's entry that survives plugin updates. Quote every path.

## Commit and PR attribution

For commits and pull requests you create with AI assistance in this workflow, use `Assisted-by: Cindy (https://cindy.app)` as the attribution, unless the user or repository specifies otherwise. Preserve the human author, existing contributors and required Signed-off-by trailers. Do not add the underlying model or harness as a co-author automatically; if model details are requested, report the actual model separately. Do not add attribution to unrelated or pre-existing work, or rewrite existing commits just to add it.

## Boundaries

- **Decide technical questions yourself** and carry them through: correctness, tests, types, lint, CI, races, performance, error handling, compatibility, security hardening, structure, local architecture trade-offs, reviewer P1/P2 suggestions. Never hand the user an "A or B" technical choice.
- **Ask the user first** only for: product behaviour changes; security, permission or privacy boundaries; splitting the PR; adding new machinery that significantly raises complexity (concurrency, locks, caches, persistence, retries). Give your recommended option, the trade-off and the impact.
- **Tell the user** (do not ask) when a problem stays stuck after repeated attempts; the check output names these cases.
- Deleting machinery that grew during review, reverting, or shrinking back to the PR's original goal is technical convergence. It needs no confirmation and is not "splitting the PR".
- Never push or open a pull request until the user explicitly asks for one or clicks the PR card's button. Approving a plan does not count, even one that mentions a PR. When the originating task already has explicit authorization to fix and push to that PR's branch, subsequent ordinary (non-force-push) fix commits reuse that authorization without asking again each round, scoped to the same repository and target branch; requests or handoffs that only ask to watch, review, or pass along a PR allow inspection and feedback, not pushing. Never approve, merge, enable auto-merge, re-enqueue a merge queue, or take a PR out of draft unless the user authorised it for this repository. Authorisation for one repository never carries to another.
- Never stash, reset, clean, revert or overwrite the user's uncommitted changes. Never force-push.
- Public replies stay short, factual and traceable. Ask before posting anything that takes a product position, discloses sensitive material, or attaches screenshots containing real or unredacted user, account, machine, or private/sensitive data (or when you are unsure a screenshot is clean). Screenshots showing only simulator/emulator, mock, fixture, or redacted/sanitized data—with no real or sensitive information—need no separate confirmation. Whenever you do ask before publishing or posting, wait for the user's answer before pushing, opening or updating the PR, or posting the reply.
- Requires the GitHub CLI signed in (`gh auth status`) and Node.js 18 or newer on PATH. The bundled `pr-node.cjs` launcher selects a supported Node even if an older system Node is first on PATH. If GitHub is not signed in, call Cindy's `connect_account` with `kind: "plugin"` and this plugin's id: Cindy opens its own GitHub sign-in on this computer (`GITHUB_SIGN_IN_REQUIRED`), so tell the user to finish it there and check `gh auth status` again; never ask for a token in chat. If that is unavailable, Node.js or `gh` is missing, or the repository is not on GitHub, say exactly that; you can still do the local work.

## Where to start

- **No PR yet** (a change to make or finish): read `references/publish.md` (sections 1 and 2).
- **An existing PR** (a link or number, `/pr <link>`, "follow <link>", or the current branch's PR): first show its PR card if this task has none (section 4), start following it in the background (section 4) before any fix round that might need a user decision. Following is the default here; skip it only when the user said to just check or look. Apply the continuing-follow decision rule in `references/background-round.md` to the first handoff and any reused owner's foreground fix round too.
- **Stopping follow-up or changing draft state in the foreground** (e.g. "stop following", "mark ready", "turn back into draft"): read only the `## Ending following` / `## Draft and ready` subsections of `references/background-round.md` — do not run the full background-round steps.
- **A background round** (the prompt says so): read `references/background-round.md` (section 5).
- **An issue to fix** (a link to an issue): start the work as in section 1 (`references/publish.md`) and link the issue in the PR. Claim or comment on the issue only if the repository's CONTRIBUTING asks for it, and ask the user before posting.
- **Cleanup after merge or close**: read `references/cleanup.md` (and `## Ending following` in `references/background-round.md` first if a follow-up schedule is still active).

## 1. Start the work

Isolate the change in its own task worktree (`cindy_helper` → `create_task_worktree`, or `git worktree add` fallback) from the freshly fetched target branch. Full rules: `references/publish.md` §1.

## 2. Open the pull request

Follow `references/publish.md` §2 to explain the change, run `pr-node.cjs pr-preflight.mjs`, create the PR, and complete the post-publish handoff.

**Mandatory publish exit checklist (never skip before replying):**

1. Read back the published PR body after `gh pr create`.
2. **Before calling `pr_card` with `published: true`**, check follow-up ownership first:
   - **Group chat or unrelated source task:** do not call `pr_card(published: true)` in the source session (it would bind the publish card and schedule there). Show the source card with `published: false`, then use its preferences to hand off authorized following to the dedicated task. Refresh the source card after handoff.
   - **Do not suppress auto-follow at publish time:** when the user enabled "Follow after opening", newly published non-draft PRs follow automatically — omit `following` on publish and never pass `following: false` to block auto-follow or avoid multi-PR session conflicts (let `follow_handoff` or `published: false` hand off to a dedicated task instead). Only the user opts out or stops follow-up (via draft PR, card setting, or the Stop button).
   - **X and other IM:** always show the card in the Cindy task. Use text for the external reply. Only read `pr_follow_settings` if the card call returned no preferences. Task origin alone does not determine the current channel or follow-up owner.
3. Call `ghost_call` `cindy-github` / `pr_card` in the owning PR task with `repo`, `pr`, and `published: true` (plus `card_id` if one exists; omit `following`).
4. If `pr_card` returns `legacy_hook_repair`, report its exact schedule ID and replacement command so the user can update only the command in Automation settings (never rewrite or duplicate it). If `pr_card` returns `follow_handoff` (independent-follow setting enabled, active `/goal` session, or another active PR follow-up already bound to this session), do **not** bind the schedule or rename this busy/multi-PR session — follow `references/follow-up-setup.md` to hand off to an isolated dedicated PR task (`send_to_session` with `use_worktree: true`), then refresh the source card so it shows the read-only reference and task link. If `pr_card` returns `follow_state`, the card owns follow-up setup — do not create a second schedule. Only when `follow_state` and `follow_handoff` are absent and follow-up is enabled, follow `references/follow-up-setup.md`. Apply `auto_rename: true` via `cindy_helper` `set_current_session_title` (never rename a group chat or a decoupled multi-PR / Goal source session).
5. Report the actual follow-up state alongside the PR link — never end with only "waiting for CI/review".

## 3. A fix round

Read `references/fix-round.md` (and `references/review-convergence.md` when grouping failure families or hitting a checkpoint / round 5 / round 10).

## 4. Following in the background

Read `references/follow-up-setup.md` whenever you need to establish, hand off (group chat / unrelated source task / IM), deduplicate (local + optional bounded remote lookup), or verify a follow-up schedule manually. Gate pacing and wait semantics live in `references/follow-up.md`. To stop following or change draft/ready state in the foreground, read only `## Ending following` / `## Draft and ready` in `references/background-round.md`.

## 5. Background round

Read `references/background-round.md` and follow every step (verify ownership via `pr_card`, handle new work via `references/fix-round.md`, refresh the card, finish once with `pr-node.cjs pr-heartbeat-gate.mjs` `--wait` / `--resume` / `--ack`, and apply stop/notification rules).

## 6. Cleanup after merge or close

Read `references/cleanup.md` and run `pr-node.cjs pr-cleanup-plan.mjs` from the primary checkout.
