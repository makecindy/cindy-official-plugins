# Test Environments

## Account page

The page only adds/selects real accounts and shows app-owned profile locations. With no prepared client, ask the adjacent conversation to start it, then click Add account. Login happens in the real client's existing page. Use this account saves the next-test selection without switching an already running client. There are no project, PR, directory, package, API or sample forms.

## Conversation workflow

1. Resolve the client source/version from the current task, not another user form. Inspect `catalog`; use `save_project` / `save_profile` when setup is missing. Keep a stable isolated profile and free debugPort; do not alter the daily Cindy profile.
2. `login_accounts` returns observed accounts, profile locations and `selectedAccount`. Optional `account` saves the user's selection. Available means an observed local profile, not a valid-session claim.
3. `add_account({project,region})` opens the compatible client's existing login page. Omit parameters only for one unambiguous client setup; ACCOUNT_CONTEXT_REQUIRED means resolve context in the conversation first. It may start an instance: retain jobId, do not repeat while waiting for login. Requested only confirms registration; inspect status and the real client. The user completes password/code/SSO in the client; the plugin never handles these secrets.
4. `bind_login_account({project})` defaults to the page-selected account; pass `account` only for an explicit alternative. Reuse the app-owned persistent profile. When an older client omits realm metadata, use the observed profile edition rather than guessing from email. Profiles cannot run concurrently. Preview with `plan`, then `start` and inspect `status` for actual identity.
5. `ready / application-account-online` confirms current identity, online authorization and database availability, not acceptance. Use existing account data; prepare samples and actions only as required by the actual task. No business API configuration, manufactured identity or fake-data injection is needed.
6. Verify using real application/device tools and retain actual evidence; `inspect` can capture a private screenshot. `stop` and poll until stopped; keep the application profile for reuse.

## Retention and expiry

The target application encrypts credentials. The plugin stores public references and locations only. Stopping, restarting and plugin upgrades retain profiles. Sliding expiry defaults to about 30 days, governed by server configuration; the plugin does not refresh idle accounts in the background. Logout, expiry, revocation or deleted app data requires normal sign-in again. Never promise permanent login. Each computer authorizes separately; never copy another device's credentials. Selecting on the page does not switch a running app: use `select_account` explicitly and verify its result.

## SSH and limitations

The conversation uses `remote` catalog / plan / start / status / select_account / action / stop / collect. Supply the target computer per operation, never hardcode a personal machine. Inspect target profiles/toolchain, preview the actual PR SHA, then retain runId for launch, status and evidence. After disconnect, inspect the same run instead of blindly restarting. SSH transports control/results; B uses B's own login. Cross-device first authorization is not implemented. Redact logs before sharing; do not automatically upload to a PR.

The fixed desktop adapter only accesses an owned source-launched instance after verifying PID, process identity, port and main page. It uses existing app capabilities and accepts no arbitrary JS or debug URL. Arbitrary installed-package isolation and direct daily-host authorization are not implemented. Windows account supervision is unavailable; Linux needs real-device validation. Use Baguette for mobile devices; retain human steps for physical trackpad feel. Real-account and second-computer integration evidence remains outstanding; test doubles do not establish native-login acceptance.

Command adapters and prepare/verify exit codes prove only the command result, not identity, business behavior or hardware acceptance. Do not pass missing WIP --account/--fixture/--login-source flags. Never store passwords, tokens or cookies in tool arguments, logs, configuration or evidence.
