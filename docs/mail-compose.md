<p align="right"><a href="mail-compose.zh-CN.md">简体中文</a> · <strong>English</strong></p>

# Shared mail compose workflow

Read-only mail uses the same Cindy presentation. Declare
`mailReader: { "tool": "your_read_message", "hosts": ["mail.example.com"] }` plus
`mail: true`, and declare that tool normally. Cindy calls it with `{url}` for a
matched HTTPS link. Return `accountId`, `messageId`, `from`, `to`, `cc`, `bcc`,
`subject`, `date`, `bodyText`, `bodyHtml` (all strings), and `attachments` in the
existing attachment format. Resolve the account explicitly or use a sole account;
never guess among several. Default reading must not mark read, edit, delete, send or publish
a draft card. Providers supporting automatic read status may add `markRead:true` to
`mailReader` and accept optional `markRead:true` in the same tool. Cindy sends it
only for a user's explicit opening, never AI reads or neighboring preloads. After
successfully reading, mark only the selected message, never the thread or drafts.
Report an attempted mark-read operation as
`markReadResult: {execution: 'not_executed'|'executed'|'unknown', message?}`.
The provider's write receipt is the source of truth: confirmed success is
`executed`, explicit rejection is `not_executed`, and a timeout, connection loss
or server error without confirmation is `unknown`. Keep the readable body for
all three outcomes. Only `not_executed` may additionally set the compatibility
field `markReadFailed:true`; never use it for an unknown result. For `unknown`,
instruct the caller to check the mailbox state first, without blind or automatic
retries. Omit the result when no write was attempted (including background reads,
already-read mail and drafts). Older hosts omit the request flag and older
providers remain read-only. New OAuth scopes must not disable
already granted read/compose operations; ask for reconnection only for missing
permissions. Keep provider HTTP/IMAP/MIME operations in the adapter; UI stays in
Cindy. Include the original account-qualified link in AI answers. Desktop opens a
side preview; mobile opens a full screen. Unsupported hosts retain browser links.
Gmail accepts hex message and thread IDs. Opaque web IDs still require Gmail.
Non-image attachments show metadata; open the mailbox to download.

Readers may additionally return `conversation: {threadId, messages: [{messageId,
url, from, date, subject, snippet}]}` with chronological summaries (all strings,
up to 1000 messages, unique IDs, including the selected message). Each URL must
use the reader's declared HTTPS host and explicitly bind the same mailbox account.
Cindy shows the selected message and reads other bodies through the same tool
only when expanded, checking that account and message IDs match. Long histories
collapse middle summaries without hiding the selected message. If metadata fails,
return the selected mail with `conversationUnavailable: true`; do not silently
present an incomplete conversation as complete. Old clients ignore these optional
fields and retain the selected message; old readers still work as single messages.

Cindy owns the universal mail editor, layout, autosave, sending and task continuation.
Plugins provide only accounts and mailbox operations, registered with the Host's
`cindyMail` SDK (version 1). Do not bundle the SDK or generate card HTML.
Connected plugins: Gmail, Outlook (Microsoft Graph), and the IMAP/SMTP plugins QQ Mail,
163 Mail, iCloud Mail and Yahoo Mail. Gmail is verified with real mailboxes; Outlook and
the IMAP plugins are so far verified only against simulated mailboxes (see Provider notes).

## Provider notes

- **IMAP/SMTP** (QQ, 163, iCloud, Yahoo) share one adapter: `src/mail-compose.cjs` in the
  Node worker and the `cindy-imap-compose` block in `main.js`. The copies must stay
  identical; `.tests/imap-mail-compose.test.mjs` checks this and runs the same end-to-end
  suite for every plugin. The draft's Message-ID is the stable `draftId`; the locator is
  folder + UID + UIDVALIDITY, falling back to a Message-ID search. IMAP cannot edit a stored
  message, so each save appends the next revision, reads it back, verifies it and only then
  removes older copies; the fingerprint is the SHA-256 of the stored message. Sending
  rebuilds the verified draft without a Bcc header (Bcc goes only in the SMTP envelope),
  then removes the draft; an SMTP envelope rejection before DATA is `not_executed`, every
  other interruption `unknown`. Saving a copy to Sent is left to the provider, as before.
- **Outlook** uses Graph's native drafts, `createReply`/`createReplyAll`/`createForward` and
  `/send`, plus a `mailReader` for Outlook web links. It has no Node worker, so new local
  files cannot be attached from the card yet; removing, renaming or inlining existing
  attachments works.
- Direct-send tool actions are refused in all of these plugins; mail is sent only through
  the draft card flow.

## Adapter

Create one flow per plugin origin:

```js
const mail = cindyMail.register({
  providerName: 'My Mail',
  draftStorage: 'server', // or 'local'; never label local storage as server sync
  // Optional: use the same lock name as other writers replacing this plugin's KV.
  storageLock: 'my-plugin-settings',
  async selectAccount(accountId) { /* {ok:true, accountId, accountEmail} or failure */ },
  async readDraft({record, sourceCallId}) { /* normalized read result */ },
  async writeDraft({record, account, fields, send, sourceCallId}) { /* save OR send */ },
  async deleteDraft({record, account, sourceCallId}) { /* optional: delete stored draft */ },
});
```

- Account IDs are opaque, selected explicitly and never silently substituted.
  The adapter checks connection/authorization; credentials remain in Host
  injection channels. Common records contain routing and receipts only.
- `sourceCallId` is the current Agent call, when one exists. Card edits have no
  Agent call ID. Do not use `record.callId` (the display card ID) to authorize HTTP.
  Node adapters use declared fixed endpoints and secret bindings; HTTP adapters
  need declared hosts/credential injection for autonomous card saves/sends.
- `readDraft` returns `{ok:true,data:{readBack:snapshot}}`.
- Optional `deleteDraft` enables the common Delete draft button. Delete from the
  provider's draft store using the current record/locator and return
  `{ok:true,data:{deleted:true,draftId:record.draftId}}` only after confirmed success.
  The SDK serializes deletion with save/send, cancels pending autosave/countdown,
  and reads back the draft identity/current locator. Explicit discard targets the
  logical draft, including newer revisions; save/send conflict checks do not apply.
  The card shows progress before read-back; failed preparation can be retried. Card and model
  `beforeTool({operation:'delete',...})` share this path. Deleted cards stay read-only;
  unknown deletion results block further writes and are never retried automatically.
  Adapters without this method retain their existing tool path and show no button.
- `writeDraft` with `send:false` saves and verifies the complete draft, then
  returns `{ok:true,data:{readBack:snapshot}}`. With `send:true`, verify the
  current version and send the existing draft, returning
  `{ok:true,data:{sent:true,receipt:{...}}}`. `sent` means the service accepted
  the send operation, not delivery. Preserve `delivery_confirmed:false`, SMTP
  accepted/rejected recipients and other provider receipt facts. Receipt data
  must be JSON-safe, bounded, credential-free and contain no mail body.
- Failures return `{ok:false,execution:'not_executed'|'executed'|'unknown',message}`.
  An external edit additionally sets `stale`; do not silently overwrite it.
  A thrown/lost/malformed write result becomes unknown and is never replayed.
  Sending already succeeded if a later task continuation fails.

Snapshot shape:

```js
{
  status: 'read_back',
  draftId: 'stable-logical-id',
  fingerprint: 'opaque-version',
  locator: { folder: 'Drafts', uid: 42, uidValidity: '700' }, // optional, opaque
  headers: { from: 'self@example.test', to: 'person@example.test', cc: '', bcc: '', subject: 'Hello' },
  editor: { editable: true, body: 'Message', quote: '' },
  attachments: [{ filename: 'example.pdf', mimeType: 'application/pdf' }]
}
```

`draftId` stays stable for this compose session. Native IDs/locations may change:
return the new `locator` after a save; subsequent reads and sends receive it.
IMAP adapters can carry folder + UID + UIDVALIDITY, while API adapters can carry
their native message ID. `fingerprint` is an opaque version, not a required hash
algorithm. The adapter must compare it before writes and preserve reply headers,
attachments and unchanged rich content. `editable:false` declines the card when
the adapter cannot preserve the full draft. Never reconstruct HTML-only mail
from a truncated body. Text fields allow 16,000 characters; HTML fields allow
64,000 characters, with 1 MiB for the host-owned card (ordinary plugin HTML stays
at 32 KiB). Mail content is kept in the adapter's draft store and
ordinary Host card history, not in common KV records.

## Rich content and attachments

An adapter that can preserve complete MIME content opts in with `richText: true`.
Return `editor.bodyHtml`, `editor.quoteHtml` and attachment metadata containing
`key`, `filename`, `bytes`, `contentId`. `key` identifies a part of the current
snapshot; reject unknown keys instead of treating them as paths. The common form
adds `bodyHtml`, `quoteHtml` and `attachmentItems` (a JSON metadata list). Removing
an item removes that attachment. HTML is authored/updated by the AI through provider
tools; the card supports direct typing into rendered text and an enlarged view,
without an edit-mode button, source editor or formatting toolbar. Text edits patch
the original HTML and update the plain alternative. `editor.format: "text"` retains
the original compact plain-text input. Providers
regenerate the HTML alternative when that plain-text input changes.

`writeDraft` also receives `attachments`, containing only files selected by the
Host's native picker or the phone's existing attachment upload channel:
`{path,filename,bytes,sha256,contentId?}`. The Host accepts upload references,
never phone-supplied desktop paths, and materializes verified bytes. Recheck bytes/hash
and reject symbolic links before reading; an inline image has a Host-issued CID.
These file descriptors are transient, never persisted in cards/KV, and consumed
once after a verified save. Every send flushes them before starting the countdown.
An uncertain upload is never repeated automatically. Current desktop limits are
16 MiB per added file and 25 MiB in total. Mobile supports file picking,
attachment removal, inert HTML/CID previews and enlarged viewing. Sending,
undo, deletion and autosave use the same Host workflow.

Optional snapshot `images: [{cid,url}]` provides managed `cindy-media://` preview
URLs. They are display-only: saved/sent HTML always retains its `cid:` references.
Gmail uses the existing Host media deposit capability for previews and its fixed
Gmail API draft PUT for complete MIME updates, retaining CID bytes, quote, reply
headers and thread. Ordinary send remains the existing draft-send operation.
Preview failures do not change a successful save receipt. Other adapters must
implement and test the same preservation contract before opting in.

## Entry points

Cindy normalizes rich content before presentation, autosave and sending: document
wrappers in replies become fragments with body attributes retained on a container;
missing plain-text alternatives are derived, known MIME types supply missing file
extensions, and managed image previews reconnect to their attachment CID. Broken
or duplicate image references stop sending with an actionable error. The formatted
draft is saved and read back before the countdown; a provider that reintroduces
invalid structure cannot proceed to send. Existing authored text and ordinary HTML
fragments are retained. This is structural protection, not identical rendering in
every email client; arbitrary CSS support and image compression are not guaranteed.
Adapters must honor supplied attachment filenames as well as keys and Content-IDs,
verify the saved MIME/bytes, preserve reply headers, and transport the supplied
HTML/text without rebuilding the original quote. Do not copy formatting policy
into individual plugins. The public adapter shape is unchanged.

1. Create a new draft or reply using the provider. Replies default to all,
   excluding self/duplicates/Bcc; explicit sender-only remains possible. Read
   back the complete result, then `mail.present(message, account, snapshot)`.
2. The Host SDK subscribes to card events itself; the plugin must not register
   a second mail card handler. Both card Send and Agent Send flush pending edits
   and use the same saved draft.
3. Before a tool reads/sends/updates/deletes a displayed draft, call
   `mail.beforeTool({operation:'get'|'send'|'update'|'delete', account, draftId,
   readOnly, sourceCallId})`. Pass the trusted Host read-only status; only
   `readOnly:false` permits writes. A non-null result is final: return it,
   never fall back to an older draft or direct send on failure. `null` lets the
   adapter run its normal operation (no managed card, or a flushed update/delete).
4. For native operations after a flush, use
   `await mail.resolveDraft(account, draftId)` to obtain the latest locator.
   Present a fresh snapshot after an external tool update/get. After a restart,
   the common flow automatically reads the saved draft on the next card edit or
   tool operation, restores the same card identity and retains unsynced form values.
   The existing Host card retains the last synchronized values for three-way
   comparison: equal changes, one-sided changes and independent text ranges merge
   automatically; only unmergeable edits require review of the named fields.
   Fingerprint or preview-address changes alone are not conflicts. A proven
   `not_executed` stale write can merge and retry once; unknown writes never retry.
   Changed content discovered after the send countdown is shown with a new full
   countdown. Pending/unknown receipts remain blocked; old countdowns never resume.

Do not rename provider tools or add a second AI tool catalog just to use this
module. Map existing command/action names to these four operations. Card sends
continue the task once; model sends return directly to the already-running turn.
New mail omits an empty quote; reply cards share the same form and send path.
The client waits for edit delivery before passing a chat instruction to the model.

## Host support and verification

Declare `mail: true` and `agent: {}` in manifest v3; a mail-only plugin needs no
`card` capability. The Host serves its SDK before the plugin entry point within
that provider's existing sandbox. Credentials and provider transport stay isolated.
Check `typeof cindyMail !== 'undefined' && cindyMail.version === 1`. If unavailable,
keep read-only tools usable and report that Cindy must be updated before draft
editing/sending. Do not silently bypass the common flow.

Editing/autosaving updates the current card. A later tool read presents a new
view; Cindy hides previous views and their plugin labels for the same provider
instance/account/draft within that task, retaining only the latest card. Historical
snapshots remain stored. Equal subjects do not identify a draft.
Old buttons are rejected at the Host, not only hidden. Sent cards cannot send again.

Run `.tests/mail-compose.test.mjs` and the provider tests. The SDK contract snapshot
in `.tests/contracts/cindy-mail-runtime.js` is test-only, copied from Cindy's
`apps/desktop/src/main/cindy-brain/runtime/mailComposeRuntime.js`; it must never be
packaged. Cindy also tests the authoritative source, lifecycle, ownership and UI.
For IMAP plugins also run `.tests/<plugin>.test.mjs`, which includes the shared
end-to-end suite. Synthetic IMAP/Graph tests do not establish real provider support or mail delivery.

By default, present the draft card and wait for the user to confirm recipients and content. Skip another question only when the user clearly confirmed this email or an applicable user/task instruction explicitly authorizes direct sending within this scope; writing/reply requests, edits and auto-approval alone are not confirmation. A card Send click is confirmation. Even authorized direct sends first present the same draft card and use its latest edits; no raw-send, CLI or other bypass is allowed. Both entry points wait 10 seconds before the adapter receives send:true; the card offers Undo and Send now. beforeTool(send) waits for the final receipt. Cancellation retains the draft and must not be retried automatically. Restart does not resume waiting sends. Direct-send tool commands must route through this flow.

Attachment metadata may include `mimeType` and `previewUrl` (managed image URLs only). Both clients display type and size and open images in the existing viewer. Removing an inline image removes its MIME part and matching CID image nodes while preserving head styles. "Insert into message" assigns an available `image-N@cindy.local` Content-ID to an existing image key and adds a CID image to HTML. Validate actual image bytes and reuse the same MIME part; never upload a duplicate. Compare attachment keys and normalized Content-IDs, ignoring preview-only metadata when deciding whether to rewrite a draft.
