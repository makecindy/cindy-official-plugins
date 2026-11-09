# Test Environments: real-account plan and handoff

[简体中文](test-environments-handoff.md)

Revised on 2026-11-09 for the recipient's goal. PR #279 remains Draft, not installed
or published. This is not a claim of completed real-account acceptance.

## Goal

Keep **start → select account → prepare samples → execute acceptance → stop**.
Use ordinary real application accounts, with separate sign-in on each computer.
An isolated profile separates local data; it does not create a machine-bound account.

Retention has two layers: the app's existing vault keeps all app-saved encrypted
sessions; the plugin remembers public account references, local profile bindings
and observations. Stop/restart, metadata edits and plugin upgrades do not log out
or clear these profiles. Sign in once on a new computer to retain its own session.
Expiration, revocation, explicit logout or deleting app data still requires sign-in.
No tokens, cookies, Keychain entries or encrypted credential files are copied, and
no indefinite authentication is promised. Discovery covers only this plugin's
owned applications, not arbitrary daily-host or other-computer login histories.

## Two-phase delivery boundary

| Area | Phase 1: current #279 / #308 | Phase 2: separate follow-up PR |
| --- | --- | --- |
| Execution | Complete local acceptance; real accounts sign in independently per computer | Generic SSH template; choose computer, PR, profile and hardware requirements per run |
| Login storage | Cindy owns local sessions; plugin keeps references, locations and configuration | Reuse B's local session; SSH never transports credentials |
| B signed out | Explicit normal reauthorization wait | Research cross-device first authorization separately; not a prerequisite for SSH with B already signed in |
| Samples/cases | Plugin orchestration, real tools and explicit human steps | Prepare/execute on B; bring logs, screenshots and results to the current task |
| Evidence | Current implementation's real integration, without requiring SSH or password-free authorization | Separate SSH, hardware, device-tool and human verification evidence |

See the [SSH and first-authorization design](test-environments-remote.md) for reserved interfaces.
Targets are parameters, not hard-coded computers: SSH Host, B repository path, PR number and exact commit,
B profile and cases. SSH trust, Node and the project toolchain must exist on the selected computer.
A concrete machine is needed for real hardware verification, not for writing the generic template.
Physical phones use their device tools; trackpad feel keeps real human input rather than synthetic events.

## Implementation ownership

| Module | Responsibility |
| --- | --- |
| Plugin `node/core.cjs` | Project/account/profile/case catalog, launch plans, explicit selection requests and workflow instructions |
| `node/account-catalog.cjs` | Merge every app-saved public account and local profile history without credentials |
| `node/session-monitor.cjs` | Observe identity, request a switch once, wait for sign-in, verify online and record status |
| `node/observation.cjs` | PID/process/port/main-page ownership, fixed app operations, projected results and screenshots |
| `node/cindy-launch.cjs` | Reuse restart coordinator and checks; take over only final readiness waiting |
| `node/runner.cjs`, `terminal.py` | Owned job supervision, macOS background PTY, waiting and exact stop |
| `manage.*`, `main.js`, worker/CLI | One shared implementation for UI, AI and CLI |

Plugin paths are relative to `test-environments/`. No client/server code or OAuth
scope changed. New `select_account` only controls a verified plugin job, not
arbitrary IPC/JS or host accounts. `import_cindy` now syncs public references from
an exact live job instead of an unshipped alias file.

## Existing capabilities reused

Local client source and GitHub main's auth manager, preload, restart coordinator
and startup status were inspected. The local server checkout was older, so main's
auth route list and hosted callback were checked separately. Source availability
is not proof of a released client version or production deployment.

- Named isolation, restart coordination and `.dev-instances` registration.
- App account list/sync/switch, ordinary login, auth refresh and database readiness.
- Existing `--passive` for automatic scheduler/routine triggers, not every background process.
- Existing remote-control setting, off by default for acceptance and checked afterwards.
- Existing hosted browser-login callback and client polling; no new device-auth service.

The missing local `dev-acceptance-profiles` and `feat/dev-device-authorization` WIP
are no longer dependencies. No WIP acceptance flags or special acceptance receipt
are required. Old loginSource/serveLogin fields remain readable but fail clearly
on execution with normal per-computer login guidance.

## Workflow and boundaries

1. Save a project and persistent desktop profile with an unused debugPort. Start
   without selecting an account if necessary, then complete normal app login.
2. Automatically remember every app-saved account and profile; refresh/edit names in UI.
3. Select a reference for next launch or request a switch in the exact live job.
4. Missing local sign-in waits; no sessions are copied from other computers/profiles.
5. App ready alone is insufficient: verify actual account, online auth and database.
6. Prepare named samples and execute saved cases with real app tools and evidence,
   then stop. The plan exposes the whole workflow; saving, launching or login does
   not automatically pass sample preparation or cases.
7. Lost/uncertain switch results require observation, never an automatic repeat.

Legacy mode preserves original startup/login without account supervision. Mobile
build/Metro and Baguette handoff remain; desktop evidence does not certify mobile.
Generic argv adapters retain project-owned prepare/verify commands without
converting authentication formats between applications.

## Evidence and remaining work

Version 1.0.6 has regressions for persistence, safe app projections, A→B→A state
transitions, independent computer login, uncertain switch handling, locks, deleted
profiles and real child-process/PTY/ownership behavior. A local HTTP/WebSocket app
simulator exercises the real runner, lsof and CDP transport, without real accounts
or credentials. It is not real Cindy account integration evidence.

The 1.0.4 tests with missing client WIP are historical context, not proof of this
new adapter. Still required:

1. Real Cindy dev login, remembering all accounts, stop/restart reuse and A→B→A.
2. Independent sign-in to the same real account on a second computer, checking
   identity, samples and retention on the original computer.
3. Expiration/revocation, login waits, account/database/background transitions and legacy startup.
4. Real host UI/AI/CLI integration with actual client version and channel recorded.
5. If first login must happen from another device, evaluate a minimal login-URL
   handoff and test the hosted callback. Source-profile authorization of an empty
   target is a separate unimplemented capability, not this iteration's dependency.
6. Separate mobile, Windows, Linux and other-project evidence. Windows account
   supervision currently fails explicitly as unsupported.

Keep Draft until the real integration gaps relevant to release are filled. Never
upload private accounts, logs, screenshots or application profiles to the PR.

## Continue

Set a separate TEST_ENVIRONMENTS_HOME outside Git; use the shared CLI with JSON
stdin, catalog/plan before start. Do not enable unfinished builds in the daily
host or install the plugin inside the target dev instance.

```sh
node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs .tests/test-environments.test.mjs
```

A separate Phase 2 implementation draft now adds the generic SSH tools; see the [Phase 2 plan](test-environments-remote.md). It is not a Phase 1 completion gate. Actual SSH/hardware and authorization research evidence remains separate from Phase 1 account simulations.
