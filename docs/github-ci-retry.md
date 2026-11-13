<p align="right"><a href="github-ci-retry.zh-CN.md">简体中文</a> · <strong>English</strong></p>

# Optional GitHub CI recovery

GitHub contributors may be able to push to their PR branch without permission
to rerun a failed Actions job. Improving tests and CI stability is the primary
remedy for recurring failures. The GitHub plugin also offers a limited recovery
route for a confirmed transient failure after a normal rerun is denied for
permissions.

In the PR card's top-right settings, enable
**Repush CI when rerun permission is denied**. It is off by default, including
for existing users without the field. It is stored in this computer's plugin
user preferences, applies to subsequent follow-up rounds across all repositories
and PRs, and does not sync to other computers. Turn it off from any PR card at
any time. This preference neither starts auto-follow nor grants merge permission.

The existing PR Skill reads the live `pr_follow_settings` preference when
following starts, in each actual background round, and again before amend and
push. Old prompts or card results cannot act as lasting rewrite authorization.
Missing, disabled or unreadable preferences forbid CI-only rewrites; ordinary
authorized fixes can continue. Card actions share the existing main-page queue
and set their displayed target value rather than inverting a newer global value.
The plugin account-settings page has no PR preference controls, reads or writes.
Its retired preference messages are ignored; no preference handshake or second
writer remains. Unknown writes require read-back, not blind replay.
Unreadable or malformed storage is displayed as unknown, with no toggle/model
choices, rather than as Off. A read-only Refresh action can recover the current
state. Every preference action reads back current settings, including a save
whose response was lost; an unconfirmed result is not reported as not saved.
If read-back also fails, the panel stays unknown and grants no new authorization.

Recovery requires an open PR, diagnosed transient CI/installation/infrastructure
failure unrelated to the change, and an explicit permission denial from the
normal rerun. Approval-required workflows, protection blocks, deterministic
failures and unknown outcomes are excluded. The head must be the task's verified
exclusive branch with write permission, no WIP, no rewrite ban and no unknown or
other people's commits. Required real fixes take priority and are batched into a
normal push when possible.

When all conditions hold, the Agent may amend without editing the commit intent
or changing its tree, parents or author, preserving the repository's DCO rules.
This changes the commit SHA. Preserve signed-commit provenance: a signed head requires verified original
signatures and an existing, available automatic signing configuration before
budget consumption. Otherwise recovery stops, including one-off `git commit -S`
without automatic signing. Verify the replacement signature before pushing;
missing/invalid/unknown signatures remain unpushed. The explicit push uses
`--force-with-lease=refs/heads/<branch>:<verified-remote-SHA>`. An intervening
remote commit ends the attempt; the Agent must not update the lease and blindly
push again. It checks the new SHA on the original PR and whether CI actually
started; triggering is not passing.

There is no PR-wide cap: **the same diagnosed failure on a PR may have one
CI-only repush per computer**. Before any amend, the existing gate exclusively
creates a durable `.ci-retry` receipt keyed by the immutable PR `node_id` and stable
diagnosis (workflow file, job name, failed step and normalized root cause).
Both budget commands require the verified ID and
`--ci-retry-failure <diagnosis.json>`. Exclude SHA, run/job IDs, attempts,
timestamps and transient paths. Head changes, restarts, renames/transfers,
observation resets and interrupted operations do not restore the same fault's
budget. A distinct failure needs fresh logs, a normal rerun permission denial
and every eligibility check before its own attempt. The gate normalizes case
and whitespace but cannot verify the Agent's diagnosis; uncertainty stops
recovery, rather than inventing a key. Earlier development receipts without a
diagnosis require reconciliation, not deletion. Receipts are not pruned with
traces or refunded. Do not delete them, move the directory or reset the budget.
Unknown outcomes require read-back, not another push. Receipts live in user data,
separate from disposable observation/trace cache. The gate exclusively copies
matching earlier cache receipts into durable storage without overwriting or
deleting them; even status reads may perform this adoption. Clearing/changing
cache does not reset migrated budgets. Unknown evidence deleted before upgrade
cannot be reconstructed and is not permission to retry. See the Skill reference
for platform data paths; never change data-root variables to restore a budget.

The plugin sandbox does not run Git itself or mechanically diagnose logs and
branch ownership. Those checks and the Git operation remain in the existing
task Agent workflow and task authorization; the gate enforces the retry budget,
not those factual judgments. No platform scopes, credentials, Host runtime or
service changes are added. No empty commits, bare force pushes, merge, auto-merge,
queue changes, direct main pushes or permission changes are authorized.

See the [runtime evidence and remaining gaps](verification/github-ci-retry-2026-11-13.md),
including cropped actual screenshots and separately labeled generated previews.
