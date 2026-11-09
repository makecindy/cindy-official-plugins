# Generic SSH acceptance and future first authorization

[简体中文](test-environments-remote.zh-CN.md)


[#309](https://github.com/makecindy/cindy-official-plugins/pull/309) is the single delivery PR; #308 is superseded and #279 remains the handoff source. Neither must merge first. One package contains local and SSH features with separate evidence; cross-device first authorization remains design-only.

## Independent capabilities

1. **SSH orchestration**: AI on A controls already-signed-in B. Check out an exact
   PR commit into a separate worktree, build/start, reuse B's profile, prepare samples,
   execute acceptance, stop only this instance, and return evidence.
2. **Cross-device first authorization**: research A approving a new, independent
   device session for signed-out B. Check existing client/server capabilities first;
   hosted browser callbacks do not establish that device authorization exists.
   This does not block SSH for an already-signed-in B and is not an implemented capability.

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

## SSH interfaces in the unified PR

- remote_catalog(target): observe platform/model and B's public project/profile/account references.
- remote_plan(target, profile, pr): preview pinned checkout/start and human/device steps.
- remote_start(runId): start only the previewed target/repository/PR-SHA/profile and return a durable run ID.
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
and the shared local-acceptance core. Cross-device approval still needs source identity, target
binding, expiry, denial/revocation and independent-session protocol evaluation.

Local evidence cannot certify actual SSH/hardware. Current tests cover injection,
wrong-host/repository/SHA, uncertain disconnect, worktree isolation, artifact boundary/
size checks and real SSH/hardware evidence. Without an actual selected B, simulated
transport plus local Git/process tests must be labeled simulated, never cross-computer
hardware acceptance.

## Unified implementation draft (PR #309, test package 1.2.0)

The unified AI remote tool and CLI workflow entries include remote_catalog, remote_plan, remote_start,
remote_status, remote_stop, remote_select_account, remote_action and remote_collect.
Pass target.host and optionally target.node each time; no per-computer business script
is generated. The management page remains local-first; use AI/CLI for SSH.

Read B's catalog, get the exact head SHA through the GitHub plugin, then remote_plan
with target, B profile ID, pr.repo/number/commit and requirements. Review the returned
runId/plan, start once, and use that same ID for status, account selection, configured
prepare/verify commands, stop and collection. outputDir can name the current task's
absolute directory; otherwise artifacts remain in private local application data.

B needs a local acceptance profile, source repository and project toolchain. Only the fixed
plugin runtime is provisioned outside Git; no Cindy plugin installation or credential
transfer occurs on B. A new worktree checks repository origin and exact SHA without
overwriting B's source. Reuse B-local application login; missing login waits rather
than treating SSH as authorization. Cindy can use project-owned prepare/verify argv;
missing commands report ACTION_NOT_CONFIGURED. Device/human work stays pending after
zero command exits.

OpenSSH uses existing host trust, BatchMode, and disables agent/port forwarding.
No password/private key is read or stored. Transfer contains plugin code, public
configuration and selected evidence only. A fixed Node bootstrap receives JSON stdin;
validated target/Node values are shell-quoted, Git/project commands use argv.
Remote execution and evidence transfer are a separate review boundary requiring
maintainer assessment in the unified PR, not certification by local tests alone.

Automated tests simulate SSH transport with real Node/Git/worktrees/shared runners,
checking checkout, sample/verification commands, scoped stop, evidence limits/hashes
and uncertain replies. There is **no actual cross-computer SSH, real-account, specific
hardware, physical-phone or human-trackpad evidence** yet. Missing 1.0.4 WIP evidence
is not reused.

## Cross-device first authorization: findings and reserved design

| Capability | Source finding | Plan |
| --- | --- | --- |
| B already signed in | Existing account list/switch/refresh and encrypted storage paths | Reuse directly; no new auth service prerequisite |
| Browser login result retrieval | Hosted callback, PKCE and client polling exist; current entry opens B's system browser | Evaluate a minimal URL handoff later; this is not A's Cindy approving B |
| Signed-in A approving an independent session for empty B | No complete reusable contract found in inspected routes/client; no deployment assumed | Separate protocol work, never copy A's session files |

Potential interfaces are begin (B initiates and retains its secret), approve/deny
(A explicitly confirms device/account), and redeem/poll (B proves initiation and
receives its own device session). Bind target identity/challenge, account, expiry and
single consumption; cover denial, revocation, expiration and concurrent replay.
Editable display fields must not establish device identity. A/B credentials remain
inside their respective applications; plugin/SSH carries only public request IDs,
authorization links and progress. Prefer existing session issuance/completeLogin.
Minimal client/server changes, compatibility and deployment order require protocol
review and real integration evidence. This iteration reserves design/unsupported
states only, without new authorization endpoints or claims of password-free login.

AI calls the single `remote` tool with operation=catalog/plan/start/status/stop/select_account/action/collect. The remote_catalog-style names also remain CLI/internal workflow entries, not eight separate Host tools.

Additional automated evidence uses the actual OpenSSH client over 127.0.0.1 to an
ephemeral SSH test server: two local fixture targets, pinned checkout/mock build,
samples/verification, lost start/action/stop receipts, evidence and strict host-key
rejection. Unpacked public CLI and main.js → real Worker also use this loopback;
Host transport remains a fixture. This is not two-computer/formal-account acceptance.
Follow the [real checklist](test-environments-acceptance.md). Capture while running;
collect final stopped logs/results without requesting a new screenshot.

Version 1.2.0 exposes SSH setup, PR preview, start/status recovery, actions, stop and
collection in the home page. pr.commit is optional: after origin verification, fixed
Git ls-remote resolves the head for exact preview before an explicit start. Existing
pins remain valid and changed heads still fail checkout. No new network target,
forwarding, credential reading or client/server change is introduced.
