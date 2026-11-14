# Test Environments

Optional Cindy plugin and standalone local CLI. Manage application-owned account
references, reusable launch settings and acceptance cases without changing the host.

See [the manual](manual/start/MANUAL.md). Start from the plugin's Projects tab, then
Accounts and Profiles; AI tools use the same catalog and validation as the page.

The Node capability can execute configured commands as the current computer user.
Application credentials stay with their application. This package is opt-in, never
seeded to all Cindy users. No cloud service, background schedule or extra client
permission interface is required. Long-running jobs have their own explicit stop.

Local source tests: `node --test .tests/test-environments.test.mjs` from the repository.

Desktop inspection uses the owned app's CDP endpoint and works independently of
the desktop lock state. Login waiting preserves the app; startup failures retain
their cause. Develop with a separate `TEST_ENVIRONMENTS_HOME` and the shared CLI,
keeping unfinished builds disabled in the daily host. First-login remote
authorization is a separate pending integration, not implied by inspection.
