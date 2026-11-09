# Test Environments

## 1.3.0: plugin-only saved account reuse

Choose a project and edition for initial sign-in in the test app. `login_accounts` lists public references;
`bind_login_account({account,project})` reuses the observed app-owned profile for another source checkout and returns a profile to preview/start.
The page offers Saved test account and an expandable App-owned login profile path. Previously observed catalog entries migrate automatically.
Without client region metadata, reuse the observed build/profile rather than infer a realm. No new native/server API is needed.
Stopping retains data. Existing sliding expiry (default about 30 days, server configuration authoritative) remains; idle listed accounts are not refreshed in the background.
Do not claim permanent login, direct daily-host authorization or arbitrary desktop-package isolation. Never read/copy credentials.


## Simplest use (1.2.1)

Choose project… uses **Cindy’s existing native directory picker**. Select the source
project, then Start test. No path/name/profile form: defaults are stored automatically,
and choosing the same canonical directory reuses its project and persistent profile.
Selection/cancellation never launches. One running panel shows sign-in guidance and
available sample/check/capture/stop actions. Advanced management retains configuration,
diagnostics and history. SSH still previews the exact revision before starting.

This uses the public cindy.pick API, not copied private project-picker components or
Host database scanning. It reuses native directory selection, not the Host recent-project
list, whose component has no public plugin API. The pick declaration is solely for
user-selected directories; existing node filesystem authority is unchanged. Cancellation,
busy and unsupported results never automatically reopen the picker. Author stays omitted;
Git/contributor history is preserved.

## Real accounts and retained sessions

Accounts are ordinary real application accounts, not machine-only test identities.
Each computer must complete its own normal sign-in. The same account may then be
selected in that computer's application profile, subject to the application's
normal session policy. This is not credential synchronization or data migration.

Keep the same persistent isolated name to reuse its own login and data. Multiple
real accounts can be saved in one profile through the application's normal Add
account flow, or kept in separate profiles. While an acceptance job is supervised,
the plugin observes every app-saved account and remembers its opaque account key
and local profile binding automatically. Login committed immediately before stop
remains in the application's vault and is discovered on the next run. The plugin
cannot retain accounts the application itself never saves or that were logged out.

`catalog.accounts[].sessions` records local profile locations, whether an account
was last listed, and historical authenticated observation. It is not a token vault
or proof of current authorization. Credentials stay in application-owned encrypted
storage. Do not put passwords, tokens, cookies or copied credential files in plugin
fields, commands, tool arguments, logs or exports. Stop and remove never log out or
delete the application profile; updates do not replace it. Expiration, revocation,
application logout or deletion of app data requires normal sign-in again.

`import_cindy({project,jobId})` explicitly refreshes public references from the exact
owned app. Omit jobId only if exactly one live job matches. It no longer reads an
unshipped dev alias file or scans daily-host profiles. Account labels are editable;
the opaque selector cannot be rebound. Old nickname selectors must be replaced by
a newly observed real-account reference and selected on the profile.

## Full acceptance workflow

1. Save a Cindy source project and desktop profile with `mode:acceptance`, a stable
   `isolated` name and unused `debugPort`. Default automatic background triggers and
   remote control are off. `background:off` uses the existing `--passive` scheduler/
   routine switch; it does not disable authentication refresh or every background process.
2. Call `plan`, then `start` once. Read its jobId with `status`; do not repeat start.
3. Sign in through the target application's normal UI on this computer. Add any
   other real accounts there. They are recorded automatically. Choose a reference
   in the saved profile for next start, or call `select_account({jobId,account})`
   to request a switch now. `account` is the catalog ID, not a display name or token.
4. Wait for `ready / application-account-online`: the account must be authenticated,
   match the selection, pass the app's online refresh and have a ready database.
   Login waiting does not consume the launch deadline. Missing local login waits;
   app readiness or a saved-account list alone cannot prove authentication.
5. Read `plan.workflow`: prepare the named sample and execute each saved case's
   actions with actual application tools. `fixture` is a sample instruction label,
   not a client injection flag. Keep sample names distinguishable and account-scoped.
   Record actual results/evidence. `ready` is not acceptance success; sample and
   case status remains `not-verified / not-executed` until the AI verifies them.
6. Call `stop` and query until stopped. Only the owned process group and verified
   application instance are stopped; all saved accounts and local data remain.

Uncertain switches are never automatically repeated. Inspect the exact current
account and login state, then explicitly select again if appropriate. A supervisor
that exited unexpectedly reports unknown; do not kill processes by broad patterns.
Only one active launch per project root is allowed. An immediately restarted
checkout may still have exiting child processes; retain the ownership checks.

## Existing project capabilities

Cindy uses the exported restart coordinator, preserving isolation, migration,
dependency, asset and process-conflict checks. Only the final `--wait-ready` wait
moves into the plugin. No `dev-acceptance.mjs`, special acceptance receipt or
`--preset/--account/--fixture/--login-source/--serve-login` WIP is required.
`loginSource` / `serveLogin` remain readable legacy fields but fail clearly on
execution. New computers use normal sign-in, not credentials from another profile.
`mode:legacy` preserves original launch/login behavior and does not supervise accounts.

The fixed CDP adapter verifies PID, process startup identity and debug-port ownership
before attaching to exactly one main page. It uses only existing app APIs and projects
non-secret results. No arbitrary JavaScript or debug URL is accepted. `inspect` can
capture a private screenshot, including while the desktop is locked. This does not
complete sign-in or approve OS credential dialogs. The new integration has not yet
been verified on real Cindy accounts. Windows is explicitly unavailable for account
supervision; Linux still needs real platform evidence.

The server already has hosted browser-login callbacks, but delivering a login URL
to a different device is not implemented here. Source-profile authorization of an
empty target profile is also not implemented. Neither is required to reuse a valid
login already saved by the target application on this computer.

For other projects, use adapter `command` and documented argv arrays, for example
`{"start":["node","scripts/dev.mjs","--data-dir","{dataDir}"]}`. Substitutions are
profile, account, isolated, fixture, remoteControl, background, platform and dataDir.
Optional prepare/verify commands belong to that project. No implicit shell or
cross-application credential conversion exists.

For iOS/Android, prepare builds or Metro, then follow `plan.handoff` through the
installed Baguette plugin: select the exact device, install and confirm matchesLocal,
launch, sign in and inspect samples/cases. Desktop account supervision is not mobile
login support. Do not revive cancelled devices or invent unsupported app flags.

## Independent development

Use `node <plugin-source>/node/cli.cjs catalog`. For parameters use `--stdin` with
JSON, e.g. method `plan` with `{"profile":"daily"}`. Set `TEST_ENVIRONMENTS_HOME`
outside the repository and plugin install folder. Node, the project's toolchain,
Python 3 for macOS PTY and lsof for owned-port checks must already be installed.

The catalog, job logs and screenshots stay in local user data. Review/redact logs
before sharing. Do not enable unfinished builds in the daily host or install this
plugin inside the target dev app to launch another layer. Packaging is not installation.

Local acceptance and generic SSH orchestration are delivered together in PR #309 and one test package, with separate evidence. #308 is superseded; #279 remains the handoff source. Neither must merge first. Cross-device first authorization remains unimplemented future research.

## Generic SSH template (unified test package)

Unified test package 1.2.1 includes local acceptance and generic SSH orchestration; computers are parameters.
Use AI/CLI remote_catalog(target) to inspect B's profiles and observed model, then
remote_plan(target,profile,pr,requirements). Review it and remote_start the returned
runId. Reuse that ID for status, account selection, remote_action, stop and collection.
target.host is a configured SSH alias/hostname; target.node optionally names B's Node
executable. pr requires GitHub owner/repo and number; commit is optional and otherwise read from target Git for exact preview. B needs its local acceptance
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
