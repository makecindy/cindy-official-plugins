# 1.3.0: choose an account and reuse its local session

[简体中文](test-environments-accounts.zh-CN.md)

The confirmed scope is **plugin only**, accepting the existing default sliding refresh lifetime of about 30 days.
No client, server or database change is delivered. There is no permanent-login switch.

## First use

1. Click Choose project and select a Cindy source checkout in Cindy’s native directory picker.
2. Under Saved test account, choose Choose or add an account in the test app.
3. Choose Global or China mainland for first sign-in, then Start test.
4. Sign in in the test application’s own UI using its available SSO, email or phone flow. Never enter passwords, codes, cookies or tokens in the plugin.
5. Return and update status. Verify the actual identity and online authentication before sample preparation and acceptance.
6. Add a second account through the application’s account menu, then update status. Adding an account is different from logging out the first one.
7. Stop this instance. Stopping ends this run without deleting the application’s profile.

## Reuse

Choose a source project, select a saved test account, and start. Selecting alone does not launch.
A different source checkout can reuse the same observed profile without copying files. The app switches and verifies the selected identity; valid sessions need no password, expired sessions require normal sign-in.
Only one instance can own a profile at a time. Stop it before starting another checkout.
Prepare/verify buttons require configured commands; otherwise follow the manual checklist. Startup is not an acceptance pass.

Opaque application keys identify accounts. Never infer identity or realm from email domains, phone numbers or personal SSO details.
If an older client omits account region, reuse the observed profile’s build version without requiring a client update or guessing its realm.
An application profile can itself contain several accounts; the app manages each session.

## Storage and lifetime

- On macOS the default plugin catalog is `~/Library/Application Support/Test Environments/catalog.json`; it contains public references, configuration and profile locations only.
- Select an account and expand App-owned login profile to see its actual local path. The app manages credentials in that profile’s `safe-storage/`; do not open, copy or share credential files.
- The code default is about 30 days after successful refresh, sliding with subsequent refreshes. Deployment settings are authoritative; the plugin changes no lifetime.
- Stopping preserves files but does not pause expiry. An unused account can expire; logout/revocation also invalidates it. Merely listing it does not refresh it in the background.
- Another computer requires its own sign-in. SSH transports control and test evidence, never credentials.

## Acceptance

| Action | Expected result |
| --- | --- |
| Sign in as A and update | Actual A identity and online verification; process startup alone is insufficient |
| Add B in the app, update, stop | Both references are selectable on the next launch; no credentials enter the plugin |
| Start A, stop, then start B | Correct application identity each time, without passwords while sessions remain valid |
| Choose another checkout and A | Same original profile path, no credential copy |
| Use a client without region summaries | Account remains selectable; existing profile version is reused |
| Start another run using an occupied profile | Refusal, without terminating the original owner |
| Log B out and update | B is not presented as immediately reusable; no silent substitution with A |
| Stop and reopen the plugin | Account references, configuration and app data remain |

Real first sign-in, organization SSO, expiry/revocation and two physical computers still need runtime acceptance. Placeholder automated tests do not prove those paths.

## Not claimed

Daily-host-to-isolated-instance authorization, first-time cross-device passwordless authorization and arbitrary packaged desktop app isolation are not delivered by this plugin change.
Browser SSO reuse depends on the existing browser/organization session. Local launch uses source checkouts; the existing SSH workflow can preview and check out an application PR.
