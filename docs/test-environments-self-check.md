# Unified test package 1.1.2 self-check

## 1.3.0 current implementation checks (plugin only)

Adds cross-checkout public account references, old-catalog migration, compatibility with clients lacking region metadata, stable profile reuse and ownership protection.
Native client/server/database drafts are not in this PR or package. No permanent-login feature or new authorization endpoint is shipped.

- Repository gates, plugin behavior, native-picker bridge, unpacked real Worker/CLI and real OpenSSH loopback: 114 passed, zero failed/skipped.
- Current pages/main.js and actual Worker in Chromium: 29 passed, zero failed/skipped. Covers account selection without client region metadata, profile paths, first-sign-in edition selection, existing workflow and four-language narrow layouts.
- Environment: Node 22.23.2, macOS darwin/arm64, Chrome 157.0.8103.38. The browser Host bridge is a fixture, not installed-Cindy acceptance.
- 1.3.0 `.cindy`: 472769 bytes, all 28 files match source bytes, ZIP CRC passed; SHA-256 `aa9a77039728d0bdd4f7ec164823adccc9d11d4a285c60e5d0199520297601f3`. Not automatically installed.
- Evidence covers placeholder accounts and owned local processes. Real SSO/email/phone sign-in, real expiry/revocation, two physical computers and actual Cindy build/installation remain runtime gaps.

The new account cases are imported by `.tests/test-environments.test.mjs`, so the existing plugin CI entry runs them without changing the workflow.
See [account acceptance](test-environments-accounts.md) for user steps, storage and expected outcomes. Historical evidence follows and does not substitute for this section.


Scope: PR #309 local real-account supervision, generic SSH orchestration, stop and
artifact collection. #308 is superseded; #279 remains the handoff source. This test
package has not been installed, enabled, merged or published.

## Fixes

| Path | Previous problem and impact | Current behavior |
| --- | --- | --- |
| Stop/actions | A cancelled run could start commands; concurrent stop could miss a command during registration | Check cancellation before/inside the action lock and stop newly registered jobs; refuse account selection after cancellation |
| Concurrent local requests | An earlier status receipt could overwrite an action's unknown state | Serialize requests for the same runId; reconcile uncertain operations before retry; reclaim abandoned locks by process identity |
| SSH receipts | Chunk-by-chunk decoding corrupted split UTF-8; errors after process launch were classified as not executed | Cap total bytes and decode the complete buffer; preserve unknown after launch |
| Public tool errors | Public remote Worker failures without an execution conclusion could be classified as not executed | Default mutating remote/stop failures to unknown; retain explicit execution receipts, including in CLI |
| Git checkout | Shared FETCH_HEAD modified B's repository and allowed overlapping fetches to interfere | Use a run-specific ref and --no-write-fetch-head; verify the requested SHA |
| Evidence directories | Invalid later entries left partial output; repeated collections could retain stale screenshots | Validate names, duplicates, encoding, size and digest first; stage a complete independent snapshot |
| Evidence reads | A growing file could exceed the cap; short reads could introduce invalid bytes | Bounded positional reads using actual bytes read, with log-tail truncation notices |
| Account supervision | Post-verification identity/login changes showed stale account information; control changes were not rechecked | Display the latest account/login snapshot and withdraw ready if the control setting changes |
| Process ownership | A reused supervisor PID could preserve stale ready | Record process-start identity; mismatches return unknown and revoke stale online verification |
| Remote account discovery | A could not retrieve catalog IDs for newly signed-in accounts | Status returns allowlisted public account references, excluding sessions and credentials |

## Automated evidence

Environment: macOS 26.7.1, Node v22.23.2, Python 3.14.7. Final repository checks: **97/97 passed**. New regressions cover
cancellation, request serialization/abandoned locks, split UTF-8, complete evidence,
bounded short reads, changing accounts, process identity and public Worker errors.
Simulated SSH invokes real Node/Git/worktrees/processes; existing simulated-app
coverage uses actual HTTP/WebSocket/CDP and macOS PTY.

For the first baseline comparison, original HEAD plugin files were restored into
an independent temporary directory and only the then-current regression tests were
applied. Seven of 28 tests failed, exposing FETCH_HEAD, UTF-8, mixed evidence,
overlapping requests, actions after stop, stale accounts and reused PIDs. All passed
with the fixes. Additional tests cover registration cancellation, bounded reads,
abandoned locks and public Worker execution semantics. Final counts and package
digest are recorded in #309.

```sh
node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs .tests/test-environments.test.mjs .tests/test-environments-ssh.test.mjs
```

## Outstanding real acceptance

Automated checks do not prove the absence of further vulnerabilities or replace
host integration. The new .cindy still needs real Cindy two-account sign-in,
switching, stop/restart reuse and reauthorization; independent second-computer login;
actual SSH build/B-local session reuse/disconnect recovery/log and screenshot
retrieval; and management UI/AI/CLI integration with actual version/channel evidence.
Physical phones and trackpad feel require their respective device tools and human
steps, rather than successful script exits.

Cross-device first authorization is unimplemented. Windows account supervision is
unavailable; Linux/mobile remain separately unverified. No client/server changes,
new dependencies, permissions or credential transfer are introduced. Remote project
commands run with B's current-user permissions, not in a sandbox: execute trusted
PRs and project commands only. Logs/screenshots remain private task evidence until
reviewed for real account and project information.
