# Test Environments

[简体中文](README.zh-CN.md)

An opt-in Cindy plugin and standalone local CLI for the complete workflow:
**start → select a real account → prepare samples → execute acceptance cases → stop**.

Real accounts are ordinary application accounts, usable on different computers.
Each computer signs in separately. A persistent application profile retains every
account the application saves, including its encrypted login sessions. The plugin
automatically remembers public account references and their local profile locations;
it never copies tokens, cookies, Keychain entries or encrypted credential files.
Expired, revoked or explicitly logged-out sessions require normal sign-in again.

AI tools, the management page and CLI share the same catalog. Cindy desktop uses
existing restart, isolation, account-switching and authentication interfaces;
there is no client/server code change and no dependency on the previous local WIP.
Account supervision requires an unused `debugPort` and a persistent isolated name.
Isolation separates local data, not account identity. Stop, catalog removal and
plugin updates do not log out or delete application data.

`ready` confirms the current account online and the application database. Sample
preparation and case execution still require actual tools and evidence. Saving a
case never runs it. iOS/Android installation and operation use Baguette.

Read [the manual](manual/start/MANUAL.md) and the updated
[implementation plan and handoff](../docs/test-environments-handoff.en.md).
Develop with a separate `TEST_ENVIRONMENTS_HOME` outside Git and the standalone
CLI; do not enable unfinished builds in the daily host. Commands execute as the
computer's current user. Account discovery is limited to this plugin's owned
application jobs, not arbitrary daily-host instances.

Run `node --test .tests/test-environments.test.mjs .tests/test-environments-ssh.test.mjs` from the repository root.
This draft still needs real Cindy host/account integration evidence; simulated
protocol tests are not proof of real-account or cross-computer authentication.

Local acceptance and generic SSH orchestration are delivered together in PR #309 and one test package, with separate evidence. #308 is superseded; #279 remains the handoff source. Neither must merge first. Cross-device first authorization remains unimplemented future research.

## Generic SSH template (unified test package)

Unified test package 1.1.3 includes local acceptance and generic SSH orchestration; computers are parameters.
Use AI/CLI remote_catalog(target) to inspect B's profiles and observed model, then
remote_plan(target,profile,pr,requirements). Review it and remote_start the returned
runId. Reuse that ID for status, account selection, remote_action, stop and collection.
target.host is a configured SSH alias/hostname; target.node optionally names B's Node
executable. pr requires GitHub owner/repo, number and exact commit. B needs its local acceptance
profile, repository, SSH trust and toolchain; accounts/encrypted sessions stay on B.
Prepare/verify run saved argv only, never arbitrary ad-hoc SSH commands. Missing project
commands/device tools produce explicit handoffs. Human/device-tool requirements remain
pending; synthetic input and command exits do not certify real hardware or human feel.
Only this run's result, bounded optional logs and private screenshot are collected with
hash checks; no credentials or automatic PR publication. Review/redact project logs.
After disconnect, inspect the same runId rather than blindly starting again. Cross-device
first authorization remains independent research; missing B login waits normally.
Current evidence is simulated SSH with real local Git/processes, not cross-computer,
real-account, physical-phone or human-input verification.

AI calls the single `remote` tool with operation=catalog/plan/start/status/stop/select_account/action/collect. The remote_catalog-style names also remain CLI/internal workflow entries, not eight separate Host tools.

New actions and account selections are rejected after stop; commands being registered receive cancellation too.
Local requests for the same runId are serialized; wait for an in-flight receipt. Abandoned locks
are reclaimed only after checking process identity, without trusting a reused PID.
remote_status.accounts exposes this run’s discovered catalog IDs for remote_select_account, without credentials.
Each collection validates the entire manifest before creating an independent evidence subdirectory;
old screenshots cannot mix with a new result, and failed collections do not deliver partial files.

Desktop profiles with a configured prepare command expose Prepare samples, completing start/prepare/verify/stop from the page.
A previously verified local session that expires retains explicit reauthorization guidance without automatically retrying account switches.
