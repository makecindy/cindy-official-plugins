# Running a Fix Round

Read this when taking over an existing PR or addressing failing checks, merge conflicts, or review feedback (`SKILL.md` section 3).

To take over an existing PR, use the link or number given, or the current branch's PR (`gh pr view --json url --jq .url`). Derive `owner/repo` from the URL or `origin`; never assume it. Confirm the PR is open; if its head is a fork you cannot push to, say so and stop. Work on its head branch: if the current directory is a clean checkout of it, use it; otherwise create a task worktree as in `references/publish.md` §1 and run `gh pr checkout <number>` inside it.

1. Get facts, do not reconstruct them from memory or flat `gh` output:
   `node "<skill-dir>/scripts/pr-node.cjs" pr-snapshot.mjs <PR_URL>`. Use its `verdict` and `blockers[]`. If the snapshot fails or is truncated, never claim the PR is clean.
2. Review threads are read per thread, active **and** outdated. For each outdated unresolved thread, check the current HEAD: still a problem → fix it; already fixed or superseded → reply pointing at the commit, then resolve.
3. **Feedback is a symptom, not a task list.** Before editing, attribute each comment to the invariant it reveals, group comments by that invariant (a failure family), and fix every path of the family, including ones nobody pointed at. Fix one family at a time, not one thread at a time. Method: `references/review-convergence.md`.
4. **Wait for the round to be complete.** While following, the check already does this: after a push it holds news from bots and checks until every bot reviewer of this PR or repository has answered on the new commit (a review, a comment, or a reaction such as Codex's 👍), or 20 minutes have passed. When it wakes you, fix everything it lists together. Without a schedule (a fix round in the foreground), if a bot reviewer that reviewed earlier commits has not yet reviewed the new head, wait for it once (see `references/review-convergence.md` §5). Checks need no separate wait: look at them again right before pushing (step 8) and fold in any failure that arrived meanwhile.
5. **CI:** read `gh pr checks` and `gh run view <run-id> --log-failed`. Failures unrelated to this PR (they also fail on the base branch) are baseline problems: do not mix fixes for them into this PR. Re-run only a confirmed flake, once (`gh run rerun <run-id> --failed`); a second failure is real.
6. **Conflicts or a stale base:** fetch the base branch from the PR’s target repository (`git fetch <base-remote> <base>`). On success, merge the fetched tip (`git merge FETCH_HEAD`), resolve conflicts and test. If fetching fails, report that the base is still unverified. Do not rebase a shared PR branch.
7. Verify with the narrowest tests, lint and type checks that cover the change, using the commands the repository's rules name (its own test gate when it has one). Write long test output to a log file and read the log to find failures instead of re-running a whole suite because the terminal cut it off. A failure unrelated to this PR is a baseline problem when it also fails on an up-to-date base: say so with that evidence, do not mix a fix for it into this PR, and do not let it block the push. Stage only related files.
8. **One push per round.** Check the PR is still open, run `pr-preflight.mjs` as in `references/publish.md` §2 (with `--base <the PR's base branch>` when that is not the default branch), then `git push` once with all of this round's commits; confirm with `gh pr view --json commits` that they landed. Every extra intermediate push makes every bot review an intermediate state again.
9. Reply in each thread you handled (what changed, which commit) before resolving it: `gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id=<thread-id>`. Where the reviewer is mistaken or the comment is stale, reply with evidence and resolve; do not distort the product to please a comment.
10. Before reporting ready or performing an already-authorized merge, refresh the snapshot with
    `--expect-head <verified-head> --strict-exit`. If the head changed, verify its results again.
    Unknown required-check rules prevent a ready claim but do not stop observing real checks.
    Base movement alone does not invalidate the round; use GitHub's mergeability, branch protections
    and expected-head check for an authorized merge.
    Re-run the snapshot to confirm: active and outdated unresolved threads are both zero, checks are green or pending on the new head.

Hard convergence lines (the check output repeats them with the current round number):

- **Do not grow machinery to satisfy reviewers.** If a fix would add concurrency, locks, caches, persistence or retries, first ask "if this whole mechanism were deleted, would the PR's original goal still hold?" If yes, delete it and shrink back. Only if no, ask the user before writing it.
- **Checkpoint:** when a previous fix missed the symmetric half of a path, or the same predicate appears for the third time, stop and do the checkpoint in `references/review-convergence.md` §2 before the next fix.
- **Round 5** with new serious findings: the checkpoint is mandatory. **Round 10:** convergence mode, batch whole families and keep going (it is not a stop condition), and tell the user the round count, the failure families and the chosen path once.
