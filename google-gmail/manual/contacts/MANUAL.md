# Google Contacts

Use `gmail_accounts` to select the intended Google account, then `gmail_contacts`.
The tool uses the Gmail plugin's Host-managed OAuth account; it does not read or
write Cindy's separate local Smart Contacts directory. Existing mail grants stay
usable when added contact scopes have not yet been granted. A contact permission
error requires reconnecting that specific account in Gmail plugin details; never
choose a different account to get around the error.

## Reading people and photos

- `list`: personal contacts, with `pageSize` (1–100) and `pageToken`.
- `search`: `query` matches prefixes of contact fields. Results are capped at 30;
  this is not exhaustive or an exact-email resolver. The tool performs Google's
  required cache warmup automatically. Use list pagination when completeness matters.
- `get`: read a returned `resourceName` such as `people/c123`.
- `other_contacts`: Google's automatically saved Other contacts, with pagination.
- `directory`: search the visible Workspace directory using `query`, with pagination.
  Personal Gmail accounts may not have a directory, and Workspace administrators
  can limit visibility. Never turn a denied directory read into a request for admin access.

Responses keep Google's `nextPageToken` and `photos`. Continue with the same
account, action, query and page size. A single page is not the whole address book.
For a mail participant photo, compare the result's emailAddresses to the exact
mailbox address; do not match by name, strip plus-address tags, or remove dots.
Ignore photos marked `default: true` when presenting a real contact photo.
These APIs cannot resolve arbitrary strangers' Google profile photos.
The mail reader returns optional exact-email personal-contact photos to updated
Desktop readers (first 12 participants, two-second budget, account-scoped one-minute
memory cache). Missing permission or photos keeps mail readable. Other-contact and
directory photos are available through this tool but not the automatic sidebar lookup.
Desktop can fall back to public Gravatar email hashes, business-domain icons and
initials. Logos do not verify identity. Current-account photos use the Host OAuth
identity avatar path and the existing connected-account UI.

## Managing personal contacts

Only mutate contacts requested by the user. Process writes sequentially for a
given account. Supported fields are `names`, `emailAddresses`, `phoneNumbers`,
and `organizations`; photo editing, groups and bulk import are not exposed.

Create:

```json
{"action":"create","account":"selected-account-id","person":{"names":[{"givenName":"Example","familyName":"Contact"}],"emailAddresses":[{"value":"person@example.test","type":"work"}]}}
```

Update: first get the exact contact. Read the **CONTACT source etag** from
`data.metadata.sources` (not the top-level etag), then pass it with resourceName.
The tool rereads the contact before writing and Google also checks the source
etag atomically. A conflict requires reading and reconciling the latest data;
never just retry the same edit with a new etag.

```json
{"action":"update","account":"selected-account-id","resourceName":"people/c123","etag":"source-etag-from-get","person":{"phoneNumbers":[{"value":"+1 202 555 0100","type":"work"}]}}
```

Each supplied array replaces that whole field. Include values that should remain.
Omitted fields remain unchanged; an empty array explicitly clears that field.
Directory and Other contacts are read-only. Copying one into personal contacts
requires an explicit create request from the user.

Delete: obtain a specifically identified personal contact's resourceName through
get/search/list and ensure the user intended that deletion. Names alone are not
identifiers. Use `action: "delete"`, `account`, and `resourceName`.

## Execution receipts

Read results use `execution: "not_executed"` to indicate no mutation. Successful
writes use `execution: "executed"` and return Google's receipt. Failures include
`[not_executed]`, `[executed]`, or `[unknown]` in their message:

- `not_executed`: validation, read-only task, explicit API rejection, or a failed
  pre-write read. Reconcile the cause before any new attempt.
- `executed`: Google accepted the write but its response or final delivery was
  incomplete. Check the actual contact; do not create or modify it again blindly.
- `unknown`: transport loss or a server error may have followed a completed write.
  Check Google Contacts before deciding what to do. There are no automatic write retries.

Google scope approval and end-user consent are separate. The plugin cannot grant
itself permissions or change a Google Cloud project's verification status.
