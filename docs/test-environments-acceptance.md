# Test Environments 1.1.3: real acceptance checklist

[简体中文](test-environments-acceptance.zh-CN.md)

Unified PR: [#309](https://github.com/makecindy/cindy-official-plugins/pull/309).
Use `test-environments-1.1.3.cindy`, SHA-256
`fd293ef9d81ea31ff44b057db653eac01ac32925e62c2609461053a1ba82f85f`.
Its runtime source is `70547c6d4203656f37cf4be8b738d929ec19cde3`.
This follow-up adds tests/documentation without changing packaged content.

## Evidence versus remaining acceptance

| Area | Available evidence | Still requires a real environment |
| --- | --- | --- |
| Catalog, account references, profiles/cases | Shared core, real Worker, unpacked CLI/AI bridge | Cindy installation and actual Host dispatch |
| Management controls and validation | Real isolated Chromium clicks, real Worker, four languages/light/dark | Embedded Cindy page appearance, connection and controls |
| Account discovery/switch/expiration/restart | Simulated account application over actual HTTP/WebSocket/CDP | Formal accounts, actual application vault, separate-computer login |
| Screenshot handling | Valid fixture PNG, invalid/oversized rejection | Actual target Cindy screenshot and locked-desktop compatibility |
| SSH, checkout, commands, recovery, artifacts | Real OpenSSH loopback; A/B/C are local fixture directories | Two physical computers, actual Cindy build and B-local login reuse |
| Phone/trackpad | Explicit device/human pending requirements | Device tooling and real human input |
| First authorization on B confirmed by A | Design only; not implemented | Excluded from current acceptance |

The loopback also exercises the public CLI and original main.js → real Worker →
SSH path. Host transport is a fixture adapter, not installed-Host evidence. The
fixture PNG is protocol test material, not a real application screenshot.

Final combined checks: **114/114 passed, zero skipped**: 99 regular checks, 13 browser
tests, one unpacked-package flow and one real-SSH loopback test (13 internal checks).
The 13 base SSH regressions are already included in the regular checks.

## One-time preparation

1. Choose controller A. Import/enable the package in the Cindy Host used for
   acceptance, preferably a dedicated test Host. Record Host version/channel,
   system and plugin version. Install the plugin in the controller, not again
   inside the target dev instance to launch another layer.
2. Prepare a buildable application checkout with its existing restart coordinator
   and toolchain: Node/project package manager, Python 3 and lsof on macOS;
   SSH targets need Node 22+ and Git. Repair missing prerequisites before launching.
3. Prepare two authorized formal accounts, called account One/Two below; computers
   remain A/B. Enter passwords, codes and QR authorization only in normal app UI.
   A daily Host login does not populate a fresh isolated target: daily-Host sessions
   are neither scanned nor copied.
4. Ask Cindy to save the checkout as a cindy project and create profile
   `qa309-desktop`: acceptance, desktop, stable isolated name `qa309-main`, an unused
   debug port, remote control/background triggers off. Preview without launching.
   Expect the correct absolute checkout path, isolation, port, initially unselected
   account and five workflow steps. Reuse the same isolation/region/data location.
5. Define actual samples and a business case. `fixture` is an instruction label,
   not a data generator. Configure prepare/verify using real existing argv scripts,
   never invented client flags. Without those commands, use actual app tools and
   record evidence; ACTION_NOT_CONFIGURED is not success. Configure commands first
   if command-based acceptance is required.
6. Record jobId and, for SSH, runId. Initial builds may install dependencies: read
   progress logs. On STARTUP_TIMEOUT, retain stage/duration, stop and investigate
   rather than repeatedly launching over an old instance.

## Required local acceptance

### L1: installation, management page and AI entry

Open all five management sections. Save the project/profile and refresh. Ask Cindy
for catalog and plan. Edit the profile's display name, close/reopen management and
read catalog again.

**Expected:** UI and AI share persistent records. No blank page, permanent connection
failure or unknown tool. Renaming does not change isolation, region or account
identity. Capture actual Host version and a page screenshot.

### L2: first sign-in and remembering every saved account

Start once, record jobId and inspect status. Sign in as One normally in the target
app, then add/sign in as Two through its normal account UI. Refresh plugin accounts;
use Remember accounts for an explicit refresh if necessary. Ask for current identity,
account catalog IDs, profile location and online verification.

**Expected:** missing login waits without claiming ready. Both app-saved accounts
are remembered, not only the current one. No passwords/tokens appear in plugin
fields, catalog or tool results. ready/application-account-online requires confirmed
identity, online authentication and a ready database; a saved list alone is not proof.
Record jobId, both IDs, profile/isolation/userDataDir and status screenshots, not secrets.

### L3: One → Two → One with account-scoped samples

Create a distinguishable private sample under One, e.g. `QA309-One-date`. In the run
card choose Two and click Select account. Wait for verification and confirm the
actual app identity. Check private One data is not treated as Two's data, then
create `QA309-Two-date`. Select One again, verify and inspect its original sample.

**Expected:** status and visible identity agree, switching does not reuse stale ready,
and private data follows the account. Treat intentionally shared application data
according to business rules. A window opening or exit 0 does not prove account
correctness. Label/redact account screenshots before sharing.

### L4: stop/restart and plugin re-enable preserve local login

Stop and query until stopped; verify only the owned target closed. Start the same
profile/isolation/region without copying credentials or switching to a fresh profile.
Check both account references, switch to each and inspect retained samples. Stop
again, disable/re-enable the plugin, reopen management and launch the same profile.

**Expected:** still-valid app-owned login is reused; references/profiles/samples remain.
Other apps/daily Host remain unaffected. Re-enable is not actual version-upgrade
evidence: test in-place upgrade when a newer package exists, without downgrading
now. Handle normal system vault prompts personally and record them.

### L5: expiration clearly requests reauthorization

First reach ready. Use normal application sign-out for the test account/profile,
or a supported current-device session revocation; do not edit the vault/auth DB.
Refresh run/status, or restart the same profile if sign-out closes the window.
Then complete normal sign-in and recheck identity/verification/sample.

**Expected:** authentication is not falsely retained. A previously verified expired
session shows reauthorization guidance/ACCOUNT_REAUTH_REQUIRED; an empty or removed
account may show ACCOUNT_SIGN_IN_REQUIRED. Wait for normal authorization without
repeated automatic switching. Capture before/after state. Record any application's
own global-device revocation policy separately rather than attributing it to the
plugin copying sessions.

### L6: a real business case, screenshot before stop

Write an actual case's action/expected result. Use Prepare samples or actual app
tools to create named data. Run verify and operate the real business case; keep
command results distinct from visible results. While the target is still running,
ask Cindy to inspect this job with a screenshot. Confirm the correct instance/account,
then stop and query until stopped.

**Expected:** configured desktop prepare exposes Prepare samples. Failed commands
or mismatching business results remain failures. The screenshot is current target
content, not the daily Host/old image, and remains private.
**Capture before stopping: a closed app cannot be screenshotted, but logs/state remain.**

## Required second-computer/SSH acceptance

### R0: prepare B once

Choose the exact required model/system. Configure authorized SSH access and verified
host trust, plus B's own Git access to the application repository; A's SSH agent is
not forwarded. Prepare the checkout/toolchain. Using the same-version standalone CLI
or an acceptance Host on B, create its local catalog/profile. Installing only on A
does not provision an empty B catalog. Use B-returned paths and account IDs. One
direct preparation route is importing the same package into an acceptance Host on B
and following L1/L2 for its catalog/first login; A then orchestrates, and the target
dev application itself does not install this plugin again.

Normally sign in as One on B's persistent isolated profile; add Two if needed. Reach
local ready once, then stop to free the port/profile. Copy no A credential files.

**Expected:** the same formal identity can sign in independently on A/B, with B's own
session and references. An unsigned-in B waits for normal login, without requiring
the unimplemented A-approved first authorization flow.

### R1: exact target and PR preview, preserving the original checkout

Ask Cindy on A to call remote catalog for the exact SSH alias (with B's Node path
if needed), display actual hardware/projects/profiles, and select B's profile ID.
Use the GitHub tool for the chosen application PR's current exact head SHA. Preview
the target/origin/SHA/profile/commands/device-human requirements without starting.

**Note:** #309 is this plugin's PR, not automatically the application PR to build.
pr.repo must match B's saved application repository origin.

**Expected:** correct computer/model/paths, persistent runId, execution=not_executed,
no new app, unchanged original/uncommitted workspace. Record runId and SHA. Another
computer uses a different target/local profile, not a rewritten business template.

### R2: real checkout/build and B-local session reuse

After reviewing R1, start its runId once and keep that ID. Confirm actualCommit
matches the preview, checkout is a new worktree and B's original checkout is intact.
Inspect B's real app/account One/online verification; select Two and back using
B's returned catalog IDs.

**Expected:** an actual build/new instance, not an old app impersonating success;
still-valid B-local sessions reused; B's identity/content reflected in status.
Missing B login waits for normal B sign-in, never A's copied credentials. A remains
unaffected. Missing B Git/toolchain/graphical access is an environment gap, not a pass.

### R3: samples, business case and evidence back on A

Run configured remote prepare and inspect B's sample, then verify and the actual
case. Configure missing real commands first: ACTION_NOT_CONFIGURED is not success.
While B still runs with confirmed identity, collect logs+screenshot to an absolute
A-task outputDir. Open files on A and match screenshot/PR/SHA/runId/model/account/
action results; check digests. Stop, query until stopped, then collect final logs and
results with screenshot=false.

**Expected:** pre-stop screenshot and final stopped result occupy independent
collection directories without stale images. Files really open on A; failed actions
remain recorded. Device/human requirements stay pending rather than becoming passes
from script exits. No credentials or automatic private-evidence PR upload.

### R4: real network interruption/recovery

With B running and runId recorded, interrupt only an interruptible test connection
A→B. Do not start again or resubmit commands. Query the original ID and record the
actual error/timeout. If interruption coincides with a start/action/stop receipt,
execution may be unknown. Restore connectivity and query the original ID first to
inspect build/app/action/stop state. Continue only after reconciling.

**Expected:** recover the same task without duplicate instances/samples; unknown is
not reported as definitely unexecuted. A disconnected status request alone is not
real lost-action-receipt coverage: label the timing accurately. Fault-injected lost
receipts are already automated. If disruption is impractical, retain a real-network
gap rather than borrowing loopback evidence.

## Additional checks only when the actual requirement involves them

- Physical phone: use device tooling available on B; list and match deviceId/model/
  OS/build, install/start and operate the actual case. A's local tools do not imply
  B-side device control; simulators do not certify physical phones.
- Trackpad: a human operates zoom, continuous reversal, rotation and pan in the
  actual target dev task sidebar; record jumps/direction/feel. Standalone windows
  or synthetic events do not replace this evidence.
- Compatibility: automated evidence is macOS. Windows account supervision is
  unsupported. Linux/mobile/minimum-declared Cindy versions need their own actual
  evidence; do not extrapolate the macOS result.

## Report each case

```text
Case: L3 / R2 / ...
Outcome: pass / fail / environment missing / not applicable
Host version/channel:
Plugin: 1.1.3
Computer/system/model:
Application repository/PR/exact SHA:
Profile / isolated / region:
jobId / runId:
Actions:
Expected:
Actual:
Evidence: private screenshot/status JSON/command or app log paths
Failure time/errorCode:
```

On failure preserve IDs/status/logs/screenshots before resetting or deleting anything.
Share only necessary redacted evidence; never credentials. Local failures can be
reported immediately without waiting for all SSH cases. Mark irrelevant hardware
not applicable.

## Maintainer reproduction (owners need not rerun automation)

Prepare Playwright Core 1.65.0, ssh2 1.17.0 and test Chromium outside Git. Extract
1.1.3 to a separate temporary directory for testing only, without Host installation;
point TEST_ENVIRONMENTS_RUNTIME there. Substitute real absolute paths below and
keep evidence outside the packaged plugin source.

```sh
TEST_ENVIRONMENTS_PLAYWRIGHT=/absolute/test-tools/node_modules/playwright-core \
TEST_ENVIRONMENTS_SSH2=/absolute/test-tools/node_modules/ssh2 \
TEST_ENVIRONMENTS_PACKAGE=/absolute/test-environments-1.1.3.cindy \
TEST_ENVIRONMENTS_RUNTIME=/absolute/unpacked-plugin \
TEST_ENVIRONMENTS_SSH_EVIDENCE=/absolute/private-evidence \
node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs .tests/test-environments.test.mjs .tests/test-environments-ssh.test.mjs .tests/test-environments-package.test.mjs .tests/test-environments.browser.test.mjs .tests/test-environments-ssh-loopback.test.cjs
```

Browser defaults to the macOS test Chrome path; override with
TEST_ENVIRONMENTS_CHROMIUM and optionally set TEST_ENVIRONMENTS_BROWSER_EVIDENCE.
SSH uses temporary fixture keys/trust and loopback service, cleans up on exit, and
never uses formal account credentials. Respect local test resource queues; do not
bypass limits or report waiting as passing.
