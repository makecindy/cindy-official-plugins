# Optional recovery when CI rerun permission is denied

This is an Agent workflow using the existing GitHub tools and task shell, not
an autonomous Git worker. The plugin cannot establish branch ownership or
diagnose CI logs by itself. The Agent must establish the facts below. Unknown
facts stop recovery; do not replace them with assumptions or a checklist flag.

## Eligibility

All conditions must hold:

1. Read `cindy-github` / `pr_follow_settings` now. Require successful
   `settings.ci_retry_repush === true` on the computer hosting this PR task and
   checkout. Missing, false, failed or ambiguous-device reads forbid rewriting.
   Auto-follow alone, an old card event and a saved schedule prompt are not this
   authorization. Never enable the preference on the user's behalf.
2. Refresh the exact PR. Read its immutable `node_id` from `get_pull_request`
   (use `call_tool` with `raw: true`); retain that verified ID for all budget
   operations. Never derive or invent it from owner/repo, URL or PR number.
   Renaming or transferring the repository does not change this PR identity.
   It must still be open, with the same known head
   repository, branch and SHA. Read the failing job logs and identify a confirmed
   transient installation/runner/network/infrastructure failure unrelated to this
   PR's code. An `ERR_PNPM_ENOENT` string alone is insufficient: establish why the
   missing file is an environment failure, not a changed path or dependency.
   Deterministic baseline failures wait for their fix; actual code errors get a
   real fix. Do not treat unknown logs as a flake.
3. Prefer a real fix or required base merge already being prepared: batch the
   recovery with that normal push and verify CI there instead of rewriting solely
   to start another run. Do not add empty commits. Pushing the identical SHA does
   not trigger a new run.
4. Attempt the normal rerun first, once, using the run for the current head.
   Continue only with an explicit permission denial (for example `403 Must have
   admin rights to Repository`). Rate limiting, timeout/unknown outcome, workflow
   approval, `action_required`, environment/maintainer approval and protection-rule
   blocks are not eligible. Verify an unknown rerun outcome rather than retrying
   through a different route. Never bypass GitHub approvals or repository gates.
5. Establish from this task's creation/checkout history and current repository
   rules that the head is a task-owned, exclusive feature branch that may safely
   be rewritten. Shared branches, unknown ownership, `main`/default/base/release
   branches, rewrite bans and another person's commits are ineligible. Confirm
   write permission for the actual head repository (a fork may differ from the
   base), and that neither task permissions nor branch rules prohibit this push.
   A successful fetch is not evidence of write permission.

If any condition fails, report the specific blocker and record a concrete wait
using the existing follow-up gate. Enabling this option never authorizes merge,
auto-merge, queue operations, direct main pushes, permission changes or bypasses.

## Verify, consume the budget, amend and push

Use the current `<skill-dir>` and existing gate state directory. Keep the same
state location as this PR's follow-up; never create another state directory,
delete the budget sentinel or reset the budget to obtain another attempt.

There is no PR-wide retry cap. Each distinct diagnosed failure on a PR may have
one CI-only repush. Before checking/reserving its budget, write a diagnosis JSON
file with exactly four nonempty strings: `workflow` (workflow file path), `job`
(stable job name, not numeric job ID), `step` (failed step name), and `cause`
(normalized root cause supported by the logs). For example:

```json
{"workflow":".github/workflows/verify.yml","job":"verify-checks","step":"install dependencies","cause":"package store unavailable"}
```

Do not put commit SHAs, run/job IDs, attempts, timestamps or transient paths in
the diagnosis. Reuse it when the same fault recurs on a new run/head; a changed
SHA, log wording or symptom alone is not a new cause. A different diagnosis
requires new log evidence, the normal rerun denial and all eligibility checks
again. When unsure whether it is the same fault, stop rather than inventing a
new key. The gate normalizes case/whitespace and hashes these four fields with
the immutable PR ID; it cannot verify the Agent's causal diagnosis.

1. Inspect `git status --porcelain=v1 --untracked-files=all`, the index and
   ongoing merge/rebase/cherry-pick state. Require a clean task checkout. Any WIP
   stops this route; do not stage, stash, reset or overwrite it. Read repository
   rules, `git remote -v`, the actual push URL(s), `git branch --show-current`,
   `git rev-parse HEAD`, and the head commit's tree, parents, author and message.
   Require a single verified push destination matching the PR head repository.
   Never infer `origin` is the PR's head remote. Use the explicit target ref
   `refs/heads/<PR-head-branch>` throughout; verify it with `git check-ref-format`.
2. Read that exact ref with `git ls-remote --heads <verified-remote> <exact-ref>`.
   Its SHA must equal both local HEAD and the current GitHub PR head. Inspect
   the PR commit list and task history for other people's or unknown commits.
   If anything differs, stop and reconcile safely; do not fetch/reset away an
   unknown remote commit. Record the verified remote SHA as the fixed lease.
3. Read live `pr_follow_settings` again. If still enabled and all conditions
   hold, consume the **single CI-only repush attempt for this diagnosed failure
   on this PR/computer**:

   ```sh
   node "<skill-dir>/scripts/pr-heartbeat-gate.mjs" <PR_URL> --reserve-ci-retry <verified-remote-SHA> --ci-retry-id <verified-PR-node-id> --ci-retry-failure <diagnosis.json> --json
   ```

   Require exit 0, `reason: "ci-retry-reserved"` and the matching
   `reservation.sourceHead` and normalized `reservation.failure`. This receipt
   only consumes budget; it does not authorize Git operations.
   `--ci-retry-status --ci-retry-id <verified-PR-node-id> --ci-retry-failure <diagnosis.json> --json` reads it without writes
   or GitHub calls. The budget survives changed SHAs, gate acknowledgements,
   follow-up restarts, repository renames/transfers and interrupted operations.
   The sentinel is keyed by the immutable PR node ID and stable diagnosis,
   never the mutable URL, head SHA or run ID.
   A denied, corrupt or uncertain
   reservation means stop: no amend/push. Even a failed push consumes the attempt.
   A different diagnosed failure can have its own attempt without deleting any
   prior receipt; the same failure cannot start an amend/force-push loop by
   changing job/run IDs or head SHA. Earlier development receipts lacking a
   diagnosis stop recovery for reconciliation; do not silently discard them.
4. Recheck the PR is open, the preference is enabled, and local/index/remote
   facts still match before `git commit --amend --no-edit`. Preserve the code
   tree, parents, author, commit intent and existing trailers; never use
   `--reset-author`, `--allow-empty`, identity overrides or disable hooks. Follow
   repository DCO rules: preserve matching sign-offs; add `-s` only with the
   configured identity and when valid for this author. If a matching sign-off
   cannot legitimately be supplied, stop. After amend verify a **new** SHA and
   unchanged tree, parents and author; compare the message (only required DCO
   additions may differ). If hooks changed the tree or SHA is unchanged, stop.
5. Read live `pr_follow_settings` immediately before pushing, and refresh PR
   state, head, clean worktree and exact remote ref. All must still match the
   original verified state apart from the intended local new SHA. If disabled
   now, leave the local amend unpushed and report it; do not reset it automatically.
   Push exactly once:

   ```sh
   git push --force-with-lease=refs/heads/<branch>:<original-verified-remote-SHA> <verified-remote> HEAD:refs/heads/<branch>
   ```

   Never use bare `--force`, implicit lease expectations, or multiple push URLs.
   A lease failure ends recovery. Do not refresh the expected SHA and push again.
   A network error may mean executed: read back the exact remote ref and original
   PR before deciding what happened, with no automatic second push.

## Verify and report

Check the new SHA appears on the **original PR** and exact remote branch. Check
GitHub Actions/check suites for that SHA and this PR event; a new SHA alone does
not prove CI started (fork workflow rules/path filters may prevent it). Record
old/new SHA, stable diagnosis, failed run and permission-denied evidence, consumed budget, push
outcome and observed CI run/check identifiers in this task's follow-up record.
Report separately: not executed, executed and verified, or unknown pending
read-back. Never call CI passed until its actual results pass. If checks do not
start, investigate/report and wait, without another amend, empty commit or push.
Use the ordinary gate finish/wait procedure; do not change schedule cadence.

After a crash or ambiguous outcome, read the current PR's verified `node_id`,
reuse the recorded diagnosis and use
`--ci-retry-status --ci-retry-id <verified-PR-node-id> --ci-retry-failure <diagnosis.json> --json` and compare
its `sourceHead` with local history, the remote and original PR. Verify and
report the existing outcome; never consume another attempt or replay the push.
