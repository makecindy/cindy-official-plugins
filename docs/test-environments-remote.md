# Phase 2: generic SSH acceptance and first authorization

[简体中文](test-environments-remote.zh-CN.md)

## Independent capabilities

1. **SSH orchestration**: AI on A controls already-signed-in B. Check out an exact
   PR commit into a separate worktree, build/start, reuse B's profile, prepare samples,
   execute acceptance, stop only this instance, and return evidence.
2. **Cross-device first authorization**: research A approving a new, independent
   device session for signed-out B. Check existing client/server capabilities first;
   hosted browser callbacks do not establish that device authorization exists.
   This does not block SSH for an already-signed-in B or Phase 1 delivery.

SSH carries control and evidence, never copied credentials, cookies, Keychain files
or A's existing device session as a substitute for authorization.

## A generic template, not a computer-specific script

Choose an SSH Host alias/hostname, remote Node path, repository and exact PR SHA,
B's repository path, saved profile and acceptance work on each run. Reuse existing
SSH configuration and B-local profiles for frequently used computers. Record B's
observed hardware model; SSH connectivity is not hardware or feel verification.

Do not store SSH passwords/private keys, automatically trust new host keys or forward
A's agent. The selected computer needs SSH, Node, Git, the project toolchain and any
required graphical session. These prerequisites and B's own login are setup, not
hard-coded business logic for each computer.

## Reserved interfaces (design-only in Phase 1; implemented in Phase 2)

- remote_catalog(target): observe platform/model and B's public project/profile/account references.
- remote_plan(target, profile, pr): preview pinned checkout/start and human/device steps.
- remote_start(planId): start only the previewed target/repository/PR-SHA/profile and return a durable run ID.
- remote_status(runId), remote_stop(runId): reconcile the same run after disconnect and stop only its work.
- remote_collect(runId): retrieve only this run's logs, private screenshots and structured results with size/hash checks.
- Samples/cases use project-declared commands and real app/device tools, with explicit evidence sources.

A run records target, PR/SHA, actual checkout, platform/model, profile reference,
stage, remote jobId, artifacts and each case's evidence source. Starting is not
proof of login, build or acceptance. Disconnect/timeout preserves unknown execution;
query the same run instead of blindly starting another ID. Never overwrite B's
working tree, kill by broad process names or delete retained logs/worktrees by default.

## Real devices and human steps

Physical phones require the target's actual device tools, exact device ID and build.
Trackpad feel and similar input-dependent checks remain pending human verification.
Synthetic events, independent windows and simulators do not certify real sidebar,
physical-device or human-input behavior. Bring artifacts to private task storage;
review/redact before authorized PR publication, never send automatically.

## Existing capabilities and verification gaps

Source contains SSH management, isolated startup, account switching and hosted
browser callbacks. The plugin does not import private client modules or copy other
Agent authentication files through their bootstrap helpers. Prefer system OpenSSH
and Phase 1's shared CLI. Cross-device approval still needs source identity, target
binding, expiry, denial/revocation and independent-session protocol evaluation.

Phase 1 evidence applies only to that implementation. Phase 2 adds injection,
wrong-host/repository/SHA, uncertain disconnect, worktree isolation, artifact boundary/
size checks and real SSH/hardware evidence. Without an actual selected B, simulated
transport plus local Git/process tests must be labeled simulated, never cross-computer
hardware acceptance.
