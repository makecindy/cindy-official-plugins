<p align="right"><a href="github-ci-retry.zh-CN.md">简体中文</a> · <strong>English</strong></p>

# Optional GitHub CI recovery

GitHub contributors may be able to push to their PR branch without permission
to rerun a failed Actions job. Improving tests and CI stability is the primary
remedy for recurring failures. The GitHub plugin also offers a limited recovery
route for a confirmed transient failure after a normal rerun is denied for
permissions.

In the PR card's top-right settings or the GitHub plugin settings, enable
**Repush CI when rerun permission is denied**. It is off by default, including
for existing users without the field. It is stored in this computer's plugin
user preferences, applies to subsequent follow-up rounds across all repositories
and PRs, and does not sync to other computers. Turn it off at either entry at
any time. This preference neither starts auto-follow nor grants merge permission.

The existing PR Skill reads the live `pr_follow_settings` preference when
following starts, in each actual background round, and again before amend and
push. Old prompts or card results cannot act as lasting rewrite authorization.
Missing, disabled or unreadable preferences forbid CI-only rewrites; ordinary
authorized fixes can continue.

Recovery requires an open PR, diagnosed transient CI/installation/infrastructure
failure unrelated to the change, and an explicit permission denial from the
normal rerun. Approval-required workflows, protection blocks, deterministic
failures and unknown outcomes are excluded. The head must be the task's verified
exclusive branch with write permission, no WIP, no rewrite ban and no unknown or
other people's commits. Required real fixes take priority and are batched into a
normal push when possible.

When all conditions hold, the Agent may amend without editing the commit intent
or changing its tree, parents or author, preserving the repository's DCO rules.
This changes the commit SHA. The push must use an explicit destination and
`--force-with-lease=refs/heads/<branch>:<verified-remote-SHA>`. An intervening
remote commit ends the attempt; the Agent must not update the lease and blindly
push again. It checks the new SHA on the original PR and whether CI actually
started; triggering is not passing.

The existing follow-up gate reserves one attempt **per PR per computer**, before
any amend. A small exclusive-create `.ci-retry` file beside its observation state
survives head changes, restarts, observation resets and interrupted operations.
It is not pruned with traces or refunded after failure. Do not delete it, move the
state directory or reset it to obtain another attempt. Unknown outcomes require
read-back, not another push. Even a different later failure on that PR has no
second CI-only repush budget.

The plugin sandbox does not run Git itself or mechanically diagnose logs and
branch ownership. Those checks and the Git operation remain in the existing
task Agent workflow and task authorization; the gate enforces the retry budget,
not those factual judgments. No platform scopes, credentials, Host runtime or
service changes are added. No empty commits, bare force pushes, merge, auto-merge,
queue changes, direct main pushes or permission changes are authorized.
