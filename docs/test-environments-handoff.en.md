# Test Environments: unified PR plan and handoff

[简体中文](test-environments-handoff.md)

On 2026-11-09 the recipient chose **[#309](https://github.com/makecindy/cindy-official-plugins/pull/309)
as the single development, testing and merge entry** for local and SSH workflows.
#308 is superseded; [#279](https://github.com/makecindy/cindy-official-plugins/pull/279)
remains the original requirements/handoff source. Neither must merge first.
The unified PR remains Draft; packaging does not mean installation, publication or real acceptance.

## Goal and included scope

Keep **start → select account → prepare samples → execute acceptance → stop**.
Use ordinary real application accounts with independent sign-in on each computer.
Isolation separates local test data, not a special machine-bound account identity.

| Capability | Unified PR implementation | Verification boundary |
| --- | --- | --- |
| Local acceptance | Catalog, account discovery/selection, supervision, sample/verification commands and stop | Current-code automated regressions; real Cindy/accounts still unverified |
| Generic SSH template | Choose computer/B profile per run, pin PR SHA, checkout/build/start, reuse B login, run commands and retrieve evidence | Simulated transport, real OpenSSH loopback and unpacked entries; actual cross-computer/hardware testing remains |
| Physical devices/human steps | Explicit device-tool/human handoffs stay pending | Phones require their actual tools; trackpad feel requires real human input |
| Cross-device first authorization | Research/interface design only, not implemented/deployed | Not a prerequisite for SSH with an already-signed-in B or an implemented capability |

Local and SSH features share one test package, with evidence recorded separately.
Cross-device first authorization remains independent future work.

## Login and data ownership

Cindy's existing vault safely retains each computer's encrypted sessions. The plugin
records public account references, local profile locations and launch configuration.
All app-saved accounts can be remembered; renaming metadata, stop/restart and plugin
updates do not log out or clear application profiles.

A new computer needs its own normal sign-in. Expiration, revocation, explicit logout
or deleted application data requires reauthorization. No plaintext tokens, cookies,
Keychain entries or credential files are extracted, copied or stored by the plugin,
and indefinite login is not promised. Discovery covers only verified plugin-owned
apps, not arbitrary daily-host/other-computer history. SSH carries control, public
configuration and selected evidence, never copied credentials as device authorization.

## Code navigation

Paths below are relative to test-environments/.

| Module | Responsibility |
| --- | --- |
| node/core.cjs | Shared catalog, plans, account selection, sample/verification commands and workflow |
| node/account-catalog.cjs | Merge app-saved public references and local profile history, without credentials |
| node/session-monitor.cjs | Actual identity, one-shot selection, reauthorization waits, online auth/database checks |
| node/observation.cjs | PID/startup identity/port/main-page ownership, fixed app operations and projected results |
| node/cindy-launch.cjs | Reuse restart coordinator/checks; take over final readiness wait only |
| node/runner.cjs, node/terminal.py | Owned supervision, macOS PTY and scoped stop |
| node/remote.cjs | Parameterized OpenSSH, local run ledger, bounded/hash-checked artifact storage |
| node/remote-agent.cjs, node/remote-runner.cjs | B-side preview, pinned PR worktree, shared core, status/stop/evidence receipts |
| main.js, manage.*, workflow.js, worker/CLI | Guided/advanced/AI/CLI share implementation; local/SSH both have page controls |

No client/server code or third-party OAuth scopes change. Remote execution/transfer
still requires maintainer review; a unified PR or green tests does not waive it.
Audience remains opt-in.

## Testing local and SSH paths

Locally, catalog first; save a source project and persistent isolated profile with an
unused debugPort. Preview, start and use normal app sign-in/Add account. References
are remembered automatically. Select an account and inspect status; missing/expired
login waits for normal authorization. ready/application-account-online proves online
identity/database readiness only. Prepare samples, execute cases with real tools and
evidence, then stop and query until stopped.

For SSH, obtain the exact current PR SHA through the GitHub plugin. Use the single
remote tool:

1. operation=catalog with target {host,node?} reads B's observed model/public catalog.
2. operation=plan takes target, B profile ID, pr {repo,number,commit} and requirements.
   The repository path comes from B's profile/catalog. Returned runId has not fetched/started the PR.
3. Review, then start. All subsequent status/select_account/action/stop/collect operations use that runId.
4. action runs saved prepare/verify argv only. Missing commands require explicit handoff.
   Human/device work never passes from a zero exit code.
5. collect returns results and optional bounded logs/private screenshots to outputDir
   or private local storage; review/redact before sharing.

B needs existing SSH trust, Node, Git, project tooling and a local profile, not a
computer-specific business script. Never automatically trust new host keys, forward
A's agent, overwrite B's working tree or kill broad process patterns. After disconnect,
query the same run instead of blindly repeating start/actions. See the [SSH/auth design](test-environments-remote.md).

## Current-code evidence and gaps

Unified test package: **1.2.1**. This revision fixes stop/action races, stale account and
process status, SSH UTF-8 receipts, execution uncertainty, shared FETCH_HEAD and mixed evidence.
Version 1.1.3 also adds the desktop Prepare samples button and persistent reauthorization guidance after a verified session expires. See [click testing](test-environments-click-check.md).
See the [self-check record](test-environments-self-check.md) for fixes, regression evidence and integration gaps.
Current automated coverage includes:

- Local persistence, A→B→A state transitions, separate-computer login models,
  expiration guidance, uncertain switch handling and invalidating stale queued readiness.
- Real children/macOS PTY/ownership/coordinator checks and a simulated app using real HTTP/WebSocket/CDP.
- Simulated SSH driving real Node/Git/worktrees/shared runners, sample/verification commands, scoped stop and evidence transfer.
- SSH input validation, wrong repository/SHA, unknown versus confirmed-not-executed outcomes and artifact name/size/hash checks.

This is not real Cindy, real-account, two-computer, specific-hardware, physical-phone
or human-feel acceptance. Missing 1.0.4 WIP evidence remains historical only.

Still required: real local login/restart/A→B→A, second-computer sign-in, actual SSH
build/login reuse/recovery/evidence retrieval, UI/AI/CLI host integration with actual
version/channel, and the relevant device-tool/human checks. Windows account supervision
remains explicitly unavailable; Linux/mobile need separate verification.

Do not install/enable the unfinished package in the daily host or bundle real accounts,
logs or profiles. Use a separate TEST_ENVIRONMENTS_HOME outside Git and the shared CLI;
do not install this plugin inside a target dev instance to launch another layer.

```sh
node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs .tests/test-environments.test.mjs .tests/test-environments-ssh.test.mjs
```

The package, source commit and SHA-256 association is recorded in #309 and the current Cindy task.

## Actionable real acceptance checklist

[English checklist](test-environments-acceptance.md) / [中文](test-environments-acceptance.zh-CN.md)
provides prerequisites, actions, expected results and evidence: L1–L6 local, R0–R4
two-computer, plus relevant device/human checks. Capture screenshots before stop;
collect final logs/results afterward. Historical 1.1.3 combined checks: 114/114 passed, none skipped,
including browser, unpacked AI/Worker/CLI, actual OpenSSH loopback and screenshot
protocol boundaries. This does not certify an installed Host, formal accounts or
two physical computers. That historical test-only revision left 1.1.3 package content unchanged.

## 1.2.0 guided home

See the [guided usage notes](test-environments-guided.md): local/SSH target, project,
account and five-step workflow by default; catalog controls move under Advanced.
First setup creates persistent configuration; target Git resolves omitted PR pins
for exact preview. Author display is omitted at the owner’s request without changing
contributor history. Older evidence keeps its original version.

Final 1.2.0 checks: **129/129 passed, none skipped** (100 regular, 27 browser,
one unpacked package and one actual OpenSSH loopback test). Runtime and page changes
in this version require the new 1.2.0 package; old evidence remains versioned.

## 1.2.1 native selection and minimal home

See [minimal usage](test-environments-simple.md). Public native directory selection
replaces project forms; canonical directories reuse test references/profiles and
selection/cancellation never launches. Home is Choose project/Start and one running
panel. pick is declared without expanding existing Node filesystem authority; no
recent-project component copying, Host DB reading or main-app changes. Author stays
omitted; older evidence remains versioned. Actual OS dialog/accounts/two-computer
integration still need real evidence.

## Additional account choice and both SSO requirements

The user requires both daily-Cindy enterprise account authorization and existing browser SSO,
alongside selectable email/phone accounts. [Account plan and acceptance](test-environments-accounts.md)
separates the goal from 1.2.1: saved target accounts are selectable and normal browser/email/phone
login uses the existing app; daily-Cindy-to-isolated-target authorization is still unimplemented.
It needs a minimal client/server authorization contract, never credential copying, removed isolation
or presenting account discovery as granted auth. The additional goal remains open despite previous tests.
