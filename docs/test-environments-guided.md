# 1.2.0: start from the guided home page

> Version 1.2.1 further simplifies this to Choose project → Start; see [minimal usage](test-environments-simple.md). Below is historical 1.2.0 guidance/evidence.

[简体中文](test-environments-guided.zh-CN.md)

The old empty catalog exposed projects/accounts/profiles/cases/runs without a first
step. Version 1.2.0 defaults to an actionable workflow, retaining those controls under
Advanced management. No client/server changes are introduced.

## Local start

1. Choose This computer. Enter a name and Cindy source folder, then Save project
   and continue. Internal IDs, stable isolation, debug port and default switches
   are created as reusable configuration without launching. If the location is
   unknown, ask Cindy in a conversation to find the local Cindy source and configure
   the plugin, previewing without starting. It is not the installed Cindy.app or
   this plugin's own source directory.
2. Choose a saved project/account (first sign-in happens normally in the target
   app), Check launch settings, review target/account/data, then Start test.
3. Follow start/account/samples/checks/stop and readable next steps. Formal accounts
   are remembered after normal app login; passwords/tokens never belong in the page.
4. Configured prepare/verify scripts run directly. Missing scripts explain how to
   ask Cindy to operate the real app. Script completion is not business/device/human
   acceptance. Command projects report process start rather than online authentication.
5. Capture before stopping. Stop requests cancellation of the selected run's active
   sample/verification commands created after this launch and its main instance,
   leaving other projects alone. Accounts remain. History, parameters and diagnostic
   JSON are available through Advanced management.

## SSH home workflow

1. Choose Another computer · SSH, enter an existing SSH alias and Connect and read
   projects. An optional Node path is under advanced options. B needs its own project,
   profile, tools and normal login; an empty catalog gives preparation instructions.
2. Choose B's profile, paste the **application PR link**, then Read PR and preview.
   After verifying origin, B uses fixed Git ls-remote to resolve the exact PR head.
   No manual SHA copying is required; advanced pinning remains. A failed read cannot
   start an application.
3. Review computer/project/version before Start, then prepare/check/stop/collect.
   Editing target or PR disables the old launch preview until it is read again.
4. A lost receipt retains the same runId and offers Read this run, without a blind
   start-again button. Recent remote runs can be resumed. Missing scripts/build/login
   or uncertain results never become acceptance passes.
5. Capture before stop; collect final logs/results afterward. Evidence is scoped to
   its jobId/runId and is not shown as another run's output.

Viewing state persists validated host names, catalog references, run IDs and PR URLs
without queries. Invalid SSH text and PR query parameters are not written to durable
browser state. SSH passwords/private keys are not saved.

## The original advanced sections

| Section | Purpose |
| --- | --- |
| Projects | Source location, adapter and project commands |
| Profiles | Reusable account selection, isolated data and launch choices |
| Accounts | Public app-saved references and local profile history, not passwords |
| Cases | Actions and expectations; saving does not execute checks |
| Runs | Launch/stop/failure/diagnostic history |

## Author display and evidence boundaries

Chris was static metadata inherited from the original draft, not the signed-in user.
At the owner's explicit request, 1.2.0 omits author rather than substituting a person,
official identity or anonymous placeholder. Git authors/contributor history remain.
Omission passes Forge package validation; the Host controls its detail-page layout.

Guided and advanced controls share the catalog/Worker/APIs; daily Host sessions are
not scanned or copied. Coverage includes real browser clicks, advanced regressions,
persistence, scoped stop, lost receipts, validated viewing state and Git/OpenSSH
loopback. Remote page tests use an explicit adapter, not real two-computer/account
proof. Final counts/source/package digest are recorded in PR #309.
Real installation, formal accounts, network, devices and human input still follow
[the acceptance checklist](test-environments-acceptance.md); old menu steps remain
available under Advanced management. Cross-device passwordless first authorization
is still unimplemented.

Final combined checks: **129/129 passed, zero skipped**: 100 regular, 27 browser,
one unpacked package and one real SSH loopback test. Chinese theme/narrow/local/remote
screenshots were inspected. Actual 1.2.0 Host installation/formal-account integration remains unverified.
