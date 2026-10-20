# Outlook Mail for Cindy 2.2.0

Search, read, draft, send and organize Outlook, Hotmail, Live and Microsoft 365 cloud mail. Global and 21Vianet China accounts are isolated, with multiple accounts and a default per cloud. Other mail providers and on-premises Exchange opened in Outlook are not supported.

Requests follow one path:

`Plugin mail logic → cindy.fetch → Host-injected OAuth token → Microsoft Graph`

The plugin uses Cindy's browser sandbox and has no Node worker, PowerShell, Microsoft SDK, native executables or runtime downloads. The Host opens Microsoft sign-in, verifies the callback, exchanges and refreshes tokens, stores credentials and injects Authorization only into the declared Graph host. The plugin receives account metadata from `/oauth`; it never receives or stores tokens. Every mail request carries the current `callId` and an explicitly resolved `authAccount`.

## Connect

Install on Cindy 0.1.75 or later, open plugin settings, select the mailbox's service region and connect an account. Settings support Chinese, English, Japanese and Korean. The publisher or enterprise IT must configure a registered public Microsoft application Client ID for each supported region; no client secret is needed. The global cloud now includes the administrator-provided public Client ID, so users can start sign-in without entering an application ID. China still requires a separately registered application; its connection button stays disabled until configured. See [application setup](APPLICATION-SETUP.md). Ordinary users authorize their own accounts through the configured application without registering an application themselves. “Administrator settings (optional)” is only for plugin maintainers or enterprise IT.

Global accounts request User.Read, Mail.ReadWrite, Mail.Send, openid and offline_access. China uses the matching China Graph resource scopes. These are delegated user permissions, not tenant-wide application permissions. Tenant policy can require administrator consent. The settings page delegates connect, disconnect and default-account management to the Host; it stores only the default region in plugin KV.

Settings show all connected accounts grouped by cloud at the same time. Add additional accounts without signing out existing ones; reconnecting an existing identity is handled by Host OAuth. Each account row binds reconnect, default and disconnect to its own cloud, even when the service selector points elsewhere. Mail calls with an explicit `account` target that account; otherwise `cloud` selects its default, and omitting both uses the saved default cloud. Disconnecting one account does not sign out other accounts or the other cloud. China still requires its separately configured application.

Call `outlook_accounts` without arguments to inspect connection metadata without a Graph request. To verify an account’s address, pass its returned ID as `profile_account`: the read-only Graph profile returns `mail` (SMTP address, possibly null) and `user_principal_name` (sign-in name). Never substitute the sign-in name when `mail` is null; this lookup does not prove delivery or sending eligibility. It uses the existing delegated User.Read permission and never returns tokens.

## Mail operations

Tools provide account listing, KQL/structured search, reading, plain-text send with CC/BCC, drafts, paginated folders, read/unread and moving mail. Reading does not mark mail read. Writes require explicit user intent; check sender, recipients and content. Send success means Microsoft accepted the request, not confirmed delivery. For executed or unknown failures, inspect the mailbox before repeating. The plugin never retries a mail request; OAuth refresh/retry behavior belongs to the Host.

Requests are capped at approximately 250 KB, 100 recipients and 50 results per page. Pagination binds to account, cloud and operation. Microsoft KQL search has a 1000-message limit. Bodies above 50000 characters are explicitly truncated; moves return a new message ID. Reply/forward, shared mailboxes, categories and deletion are not implemented. The 250 KB limit applies to the text/template, not attachment bytes.

## Upgrade and verification

2.0.0 replaces the SDK authentication route. Former SDK sessions and saved SDK account metadata are not reused; reconnect through Host OAuth. Other local Microsoft tools' credential caches are not read or cleared. There is no automatic login restoration from legacy plugin KV.

Run `node --test .tests/outlook-mail.test.mjs` and the repository contract/localization/provisioning/publish-workflow tests. Package with `.github/scripts/package-plugin.sh outlook-mail /tmp/outlook-mail-2.2.0.cindy` after committing. Browser tests use mocked Host endpoints and synthetic accounts, not real OAuth evidence; see `.tests/outlook-mail/settings-browser.mjs`.

The administrator supplied the global public application ID on 2026-09-09. Real Host OAuth sign-in and single-account read operations have been verified on Cindy Beta; the PR records the exact package, build, and current coverage. Sending, drafts, marking and moving still require authorized real-mailbox verification; multi-account and China scenarios remain unverified. Earlier SDK development-package results do not validate this implementation. New-plugin admission and final device verification remain maintainer review items. Provisioning is an empty targeted audience, with no automatic distribution. Tests and package limits are not weakened.

## File attachments (2.2.0)

Requires Cindy 0.1.109 or later for the existing download and authorized handoff APIs.
Attachment **sending and drafting additionally require a future released Host with
`uploadJson` v1**. That Host change is not yet released; installing this plugin on
0.1.109 does not enable attachment sending. Ordinary mail behavior is unchanged.
Capability detection fails before sending; it never silently omits requested files.

- `outlook_mail(action: "list_attachments", message_id, account)` lists IDs, type,
  size and inline status without returning contentBytes. Pagination remains bound
  to the selected account, region and message; retain message_id with page_token.
- `download_attachment` takes message_id and attachment_id, plus **ghost_call
  top-level save_dir** pointing to an existing authorized destination. It downloads
  only fileAttachment objects up to 25 MiB, including inline files. Names are
  sanitized and the Host saves without overwriting existing files. Success requires
  HTTP 200 and the receipt byte count matching Graph metadata. A mismatch is an
  error; a file may already have been saved and must not be treated as verified.
- `prepare_attachments` takes **ghost_call top-level dir**, a single local file or
  a directory containing only the intended attachments. It returns names, total
  size and Host readiness without accessing a mailbox or sending. It does not
  certify future file content; send/draft must receive a fresh dir handoff.
- `send` / `draft` with attachments require `with_attachments: true` and a fresh
  top-level dir. Maximum 10 files and 2 MiB combined raw size. The Host reads the
  authorized one-use ticket, fills null JSON placeholders with base64 and sends
  directly. Never put local paths or file bytes in args or model context. A failed
  or expired ticket must be handed off again; unknown outcomes must be checked in
  the mailbox before retrying. No redirect or HTTP 401 replay in uploadJson mode.

The 2 MiB aggregate policy leaves room for base64 and the text template within a
4 MiB Host request; it also stays below Graph's under-3-MB small-attachment route.
Nested messages/events, cloud reference attachments and large upload sessions are
not supported. Files are sent as application/octet-stream with their filenames.
Graph returns 202 for accepted send requests, which is not delivery confirmation.

References: [sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0),
[add attachment](https://learn.microsoft.com/en-us/graph/api/message-post-attachments?view=graph-rest-1.0),
[download attachment](https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0),
[large attachments](https://learn.microsoft.com/en-us/graph/outlook-large-attachments).

Automated attachment tests use synthetic accounts and bytes. Real mailbox sending,
drafting and downloading require user-selected targets and remain unverified;
local file handoff is not production mail verification. No account scopes, settings,
credential stores or Node capabilities were added. Use the preserved 2.1.2 package
to roll back this local update without disconnecting accounts.
