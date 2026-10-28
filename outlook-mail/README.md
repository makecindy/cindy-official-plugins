# Outlook Mail for Cindy 2.1.0

Search, read, draft, send and organize Outlook, Hotmail, Live and Microsoft 365 cloud mail. Global and 21Vianet China accounts are isolated, with multiple accounts and a default per cloud. Other mail providers and on-premises Exchange opened in Outlook are not supported.

Requests follow one path:

`Plugin mail logic → cindy.fetch → Host-injected OAuth token → Microsoft Graph`

The plugin uses Cindy's browser sandbox and has no Node worker, PowerShell, Microsoft SDK, native executables or runtime downloads. The Host opens Microsoft sign-in, verifies the callback, exchanges and refreshes tokens, stores credentials and injects Authorization only into the declared Graph host. The plugin receives account metadata from `/oauth`; it never receives or stores tokens. Every mail request carries the current `callId` and an explicitly resolved `authAccount`.

## Connect

Install on Cindy 0.1.75 or later, open plugin settings, select the mailbox's service region and connect an account. Settings and tool messages follow the Cindy language (Chinese, English, Japanese or Korean), with English for any other language. The publisher or enterprise IT must configure a registered public Microsoft application Client ID for each supported region; no client secret is needed. The global cloud now includes the administrator-provided public Client ID, so users can start sign-in without entering an application ID. China still requires a separately registered application; its required Client ID form appears immediately, and Add mailbox becomes available after saving. See [application setup](APPLICATION-SETUP.md). Ordinary users authorize their own accounts through the configured application without registering an application themselves. Custom application editing is under “More settings → Connection application”; authorization details are also collapsed there. The service dropdown sits beside “Connect your mailbox”: its checkmark means the currently viewed service, while its Default badge identifies the saved default. Switching services changes the form without saving; “Use current service by default” explicitly saves the default.

Global accounts request User.Read, Mail.ReadWrite, Mail.Send, openid and offline_access. China uses the matching China Graph resource scopes. These are delegated user permissions, not tenant-wide application permissions. Tenant policy can require administrator consent. The settings page delegates connect, disconnect and default-account management to the Host; it stores only the default region in plugin KV.

Settings show all connected mailboxes in one card, with an add-account row at the bottom. Each row’s “⋯” menu contains its service, status, default-account and disconnect controls; authorization warnings and reconnect are shown directly when needed. Add additional accounts without signing out existing ones; reconnecting an existing identity is handled by Host OAuth. Each account row binds reconnect, default and disconnect to its own cloud, even when the service selector points elsewhere. Mail calls with an explicit `account` target that account; otherwise `cloud` selects its default, and omitting both uses the saved default cloud. Disconnecting one account does not sign out other accounts or the other cloud. China still requires its separately configured application.

Call `outlook_accounts` without arguments to inspect connection metadata without a Graph request. To verify an account’s address, pass its returned ID as `profile_account`: the read-only Graph profile returns `mail` (SMTP address, possibly null) and `user_principal_name` (sign-in name). Never substitute the sign-in name when `mail` is null; this lookup does not prove delivery or sending eligibility. It uses the existing delegated User.Read permission and never returns tokens.

## Mail operations

Tools provide account listing, KQL/structured search, reading, plain-text send with CC/BCC, drafts, paginated folders, read/unread and moving mail. Reading does not mark mail read. Writes require explicit user intent; check sender, recipients and content. Send success means Microsoft accepted the request, not confirmed delivery. For executed or unknown failures, inspect the mailbox before repeating. The plugin never retries a mail request; OAuth refresh/retry behavior belongs to the Host.

Requests are capped at approximately 250 KB, 100 recipients and 50 results per page. Pagination binds to account, cloud and operation. Microsoft KQL search has a 1000-message limit. Bodies above 50000 characters are explicitly truncated; moves return a new message ID. Attachments, reply/forward, shared mailboxes, categories and deletion are not implemented.

## Upgrade and verification

2.0.0 replaces the SDK authentication route. Former SDK sessions and saved SDK account metadata are not reused; reconnect through Host OAuth. Other local Microsoft tools' credential caches are not read or cleared. There is no automatic login restoration from legacy plugin KV.

Run `node --test .tests/outlook-mail.test.mjs` and the repository contract/localization/provisioning/publish-workflow tests. Package with `.github/scripts/package-plugin.sh outlook-mail /tmp/outlook-mail.cindy` after committing. Browser tests use mocked Host endpoints and synthetic accounts, not real OAuth evidence; see `.tests/outlook-mail/settings-browser.mjs`.

The administrator supplied the global public application ID on 2026-09-09. Real Host OAuth sign-in and single-account read operations have been verified on Cindy Beta; the PR records the exact package, build, and current coverage. Sending, drafts, marking and moving still require authorized real-mailbox verification; multi-account and China scenarios remain unverified. Earlier SDK development-package results do not validate this implementation. New-plugin admission and final device verification remain maintainer review items. Provisioning is an empty targeted audience, with no automatic distribution. Tests and package limits are not weakened.

## Settings UI development

The settings page bundles React and the shadcn/ui Radix DropdownMenu composition locally. Shared Button, Input and Collapsible wrappers use Cindy semantic theme tokens, pill controls and 12px menu panels. Menus stay inside the settings webview; the service menu matches its trigger width and reserves its measured height for Host auto-sizing. Narrow cards stack controls without reducing font size. External links use ordinary same-page HTTPS anchors as required by Forge §4.8. No CDN, host component import, runtime network dependency or credential flow is added.

Run `cd outlook-mail && npm ci && npm run build` after editing `src/`. Commit `settings.js`, the lockfile and the generated `THIRD-PARTY-LICENSES.txt` together; do not edit the bundle directly. The missing npm license for react-remove-scroll-bar 2.3.8 is retained from upstream commit `8ca9ba5ea52de03308fe8ced94f7b159a44d28ff` in `src/licenses/`.
