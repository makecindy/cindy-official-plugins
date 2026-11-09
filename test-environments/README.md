# Test Environments

## 1.3.0: plugin-only account reuse

Choose a project, select a saved test account, then start. First sign-in stays in the app; stopping retains its profile, including reuse from another source checkout.
Older clients without account-region metadata reuse the observed profile version. No new client/server API is required. Existing sliding expiry remains unchanged (code default about 30 days; deployment configuration is authoritative); idle listed accounts are not refreshed in the background.
Expand App-owned login profile after selecting an account to see its path. See [account usage and acceptance](../docs/test-environments-accounts.md).
Daily-host authorization, permanent login and arbitrary packaged desktop isolation are outside this delivery. The 1.2.1 sections below describe existing behavior.


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
Current evidence includes simulated SSH, real local Git/processes and OpenSSH loopback, not two physical computers,
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
