# Outlook Mail for Cindy 2.1.0

Search, read, draft, send and organize Outlook, Hotmail, Live and Microsoft 365 cloud mail. Global and 21Vianet China accounts are isolated, with multiple accounts and a default per cloud. Other mail providers and on-premises Exchange opened in Outlook are not supported.

Requests follow one path:

`Plugin mail logic → cindy.fetch → Host-injected OAuth token → Microsoft Graph`

The plugin uses Cindy's browser sandbox and has no Node worker, PowerShell, Microsoft SDK, native executables or runtime downloads. The Host opens Microsoft sign-in, verifies the callback, exchanges and refreshes tokens, stores credentials and injects Authorization only into the declared Graph host. The plugin receives account metadata from `/oauth`; it never receives or stores tokens. Every mail request carries the current `callId` and an explicitly resolved `authAccount`.

## Connect

Install on Cindy 0.1.75 or later, open plugin settings, select the mailbox's service region and connect an account. Settings support Chinese, English, Japanese and Korean. The publisher or enterprise IT must configure a registered public Microsoft application Client ID for each supported region; no client secret is needed. The global cloud now includes the administrator-provided public Client ID, so users can start sign-in without entering an application ID. China still requires a separately registered application; its connection button stays disabled until configured. See [application setup](APPLICATION-SETUP.md). Ordinary users authorize their own accounts through the configured application.

Global accounts request User.Read, Mail.ReadWrite, Mail.Send, openid and offline_access. China uses the matching China Graph resource scopes. These are delegated user permissions, not tenant-wide application permissions. Tenant policy can require administrator consent. The settings page delegates connect, disconnect and default-account management to the Host; it stores only the default region in plugin KV.

Settings show all connected accounts grouped by cloud at the same time. Add additional accounts without signing out existing ones; reconnecting an existing identity is handled by Host OAuth. Each account row binds reconnect, default and disconnect to its own cloud, even when the service selector points elsewhere. Mail calls with an explicit `account` target that account; otherwise `cloud` selects its default, and omitting both uses the saved default cloud. Disconnecting one account does not sign out other accounts or the other cloud. China still requires its separately configured application.

## Mail operations

Tools provide account listing, KQL/structured search, reading, plain-text send with CC/BCC, drafts, paginated folders, read/unread and moving mail. Reading does not mark mail read. Writes require explicit user intent; check sender, recipients and content. Send success means Microsoft accepted the request, not confirmed delivery. For executed or unknown failures, inspect the mailbox before repeating. The plugin never retries a mail request; OAuth refresh/retry behavior belongs to the Host.

Requests are capped at approximately 250 KB, 100 recipients and 50 results per page. Pagination binds to account, cloud and operation. Microsoft KQL search has a 1000-message limit. Bodies above 50000 characters are explicitly truncated; moves return a new message ID. Attachments, reply/forward, shared mailboxes, categories and deletion are not implemented.

## Upgrade and verification

2.0.0 replaces the SDK authentication route. Former SDK sessions and saved SDK account metadata are not reused; reconnect through Host OAuth. Other local Microsoft tools' credential caches are not read or cleared. There is no automatic login restoration from legacy plugin KV.

Run `node --test .tests/outlook-mail.test.mjs` and the repository contract/localization/provisioning/publish-workflow tests. Package with `.github/scripts/package-plugin.sh outlook-mail /tmp/outlook-mail-2.1.0.cindy` after committing. Browser tests use mocked Host endpoints and synthetic accounts, not real OAuth evidence; see `.tests/outlook-mail/settings-browser.mjs`.

The administrator supplied the global public application ID on 2026-09-09. Its registered redirect URI, supported account types and delegated permissions still require real sign-in verification. No live Host OAuth sign-in or production-client mail verification has been completed for this version. Earlier SDK development-package results do not validate this version. New-plugin admission and final production verification remain maintainer review items. Provisioning is an empty targeted audience, with no automatic distribution. The PR remains open for review; tests and package limits are not weakened.
