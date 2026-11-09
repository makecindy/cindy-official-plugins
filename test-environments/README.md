# Test Environments

The page manages test accounts only: **add an account, select it for the next test, and view where the app retains its login**. Sign in normally in the real client and use the account’s existing data. There are no project, directory, PR, package, API, sample or launch-configuration forms.

For first use, ask the conversation beside the page to start the client for adding a test account. Click Add account once the client is prepared, then finish normal sign-in in its window. App-saved accounts appear automatically. Use this account remembers your choice for subsequent tests; selecting does not switch a running client immediately.

The app encrypts login in its persistent local profile. The plugin stores public account references and profile locations only. Expand Where is my login saved? to see paths. Stopping preserves profiles; expiry, logout or revocation requires sign-in again. Existing sliding expiry defaults to about 30 days, subject to server policy. No permanent-login promise or background refresh for idle accounts.

The conversation invokes tools for builds, startup, necessary samples, verification, stop and SSH orchestration. Use real account data without requiring business API configuration or fake-data injection. Another computer uses its own login; never copy credential files.

Plugin-only changes. Desktop account supervision currently supports compatible Cindy source-launched instances, not arbitrary installed packages, direct daily-host authorization or cross-device first authorization. Real accounts and a real second computer still require integration validation; simulated tests do not replace it. See the bundled manual for operation contracts.
