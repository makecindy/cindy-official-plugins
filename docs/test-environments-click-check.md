# 1.1.3 page click testing

An isolated Chromium clicks, types, selects and submits the packaged original
manage.html/manage.js/main.js, connected to the actual node/worker.cjs and shared
core. All data and applications are temporary fixtures, without real credentials.

## Coverage

Final regular repository checks: **98/98 passed**. Browser click tests: **13/13 passed**.

The 13 browser tests cover:

- Creating projects, two accounts, profiles and cases; filtering accounts by project;
  toggling legacy/acceptance settings; reading the resulting launch plan.
- Desktop buttons starting real children, preparing a sample file, verifying,
  stopping and restarting while preserving account references.
- Invalid account rebinding/JSON/stale revisions; preserving newer records;
  recovering from a wake connection failure using Refresh.
- Delayed replies and BroadcastChannel retries executing a save only once.
- Chinese/English/Japanese/Korean × light/dark at 320 px without horizontal overflow;
  Chinese screenshots were visually inspected.
- Remember/select account clicks against a simulated application over real
  HTTP/WebSocket/CDP; confirming the actual simulated identity; showing localized reauthorization guidance directly on the run card and
  ACCOUNT_REAUTH_REQUIRED in details after a verified session expires; stopping the owned job.

## Discovered fixes

1. A configured desktop prepare command had no button because preparation was
   displayed only for mobile profiles. Configured commands now expose Prepare
   samples in all four languages, retaining implicit mobile build preparation.
   Before the fix, one of the initial 12 browser tests failed; the full click flow
   passed after the fix.
2. A previously verified session expiring could fall back to an unconfirmed-switch
   message or initiate another switch. Explicit reauthorization guidance now
   persists, with four-language guidance on the run card, without automatic switch retries, covered by core and browser tests.

## Evidence boundaries

The plugin is not installed in the current Cindy, and its selected user-browser
controller is unavailable. These tests therefore run in a new isolated headless
Chromium. Only Host /app-context, /wake and node transport use a local fixture
bridge; the management page, BroadcastChannel deduplication, Worker, catalog and
process execution use the original code. The bridge binds loopback and validates
origin plus a random per-test request nonce; it does not contact daily Cindy.
The simulated account application is not real Cindy. This is not installation,
real-account or two-computer SSH acceptance.

The macOS/Node/Python environment matches the self-check; Playwright Core is
1.65.0 and Chromium is 157.0.8103.38 (also recorded in test output). Final results,
source commit and .cindy digest are recorded in #309. Screenshots are available
in the current task's research/browser-clicks. Real accounts, logs, profiles and
test dependencies are not bundled into the plugin.

## Reproduce

Prepare playwright-core outside Git, and an isolated test-browser executable;
do not attach to a daily browser profile.

```sh
TEST_ENVIRONMENTS_PLAYWRIGHT=/absolute/path/to/playwright-core \
TEST_ENVIRONMENTS_CHROMIUM='/absolute/path/to/Chrome' \
TEST_ENVIRONMENTS_BROWSER_EVIDENCE=/absolute/path/to/task-screenshots \
node --test .tests/test-environments.browser.test.mjs
```

Run the regular repository gates as well. Real Cindy installation, account
login/stop/restart/expiration, independent second-computer login, actual SSH and
device/human checks remain subject to the handoff acceptance plan.
