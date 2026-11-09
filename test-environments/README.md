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

Run `node --test .tests/test-environments.test.mjs` from the repository root.
This draft still needs real Cindy host/account integration evidence; simulated
protocol tests are not proof of real-account or cross-computer authentication.

This package is the Phase 1 local delivery. SSH orchestration and cross-device first authorization are independent Phase 2 capabilities, neither a Phase 1 completion gate. Device-tool and real human steps remain explicit.
