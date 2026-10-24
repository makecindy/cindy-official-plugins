<p align="right"><a href="google-oauth-permissions.zh-CN.md">简体中文</a> · <strong>English</strong></p>

# Google Contacts and OAuth verification checklist

Date: 2026-10-25. Applies to the Gmail 1.6.0 source proposal. This document does
not establish that Google has approved these permissions.

Scope: current-account photos, personal contact lookup and create/update/delete,
Other contacts and visible Workspace directory lookup. Gmail settings management
is excluded. Personal contacts are managed through the `gmail_contacts` chat tool;
there is no new address-book page or integration with Cindy's local Smart Contacts.
The mail reader now returns exact-email personal-contact photos to the updated
Desktop sidebar. Old clients ignore the optional field. A real Google consent and
test-account demonstration is still required before presenting verification evidence.

## New scopes

All names below have the prefix `https://www.googleapis.com/auth/`.

| Scope | Actual purpose | Demonstration |
| --- | --- | --- |
| userinfo.profile | Current account name and photo; Host reads UserInfo picture | Connected-account list after reconnecting |
| contacts | Read personal contacts/photos and create, update or delete contacts | gmail_contacts list/search/get/create/update/delete |
| contacts.other.readonly | Read Google's automatically saved Other contacts and available photos | gmail_contacts other_contacts |
| directory.readonly | Read people and available photos from the user's visible Workspace directory | gmail_contacts directory |

Contact editing requires `contacts`; do not also add `contacts.readonly`.
Read-only access cannot support the selected contact management functionality.
Directory access remains subject to organization policy; no Admin SDK permission
or domain-wide delegation is requested. No source guarantees photos for arbitrary emails.

## Existing scope inventory

The Gmail, Calendar, Drive and Sheets manifests use the same OAuth client, so
their verification evidence can be prepared together. Check approved scopes in
Google Cloud Verification Center; source declarations do not prove approval.

| Plugin | Current declarations beyond basic identity | This change |
| --- | --- | --- |
| Gmail | gmail.readonly / gmail.compose / gmail.modify | Preserve existing declarations and grant migration behavior |
| Calendar | calendar | Unchanged |
| Drive | drive | Unchanged |
| Sheets | drive | Unchanged |

`gmail.modify` already supports common mail reading, drafts, sending, labels and
moving messages to trash. The three existing Gmail grants overlap: reconcile
actual calls with approved scopes when submitting. This change does not add
gmail.send, gmail.labels or mail.google.com for photos. Request
gmail.settings.basic only with implemented filter, signature or vacation-response
management. gmail.settings.sharing is not a general-purpose consumer OAuth scope.

## Submission and demonstration

1. Enable People API and configure the four new scopes in a test OAuth project.
   Use test accounts before exposing unapproved scopes to production users.
2. Install the test package in an identifiable Cindy build. Record the English
   consent flow, app name and browser client ID. Host and Google handle consent;
   never copy tokens or authorization codes into tasks or demonstration materials.
3. Show the current-account photo, an existing test contact with a photo,
   paginated Other contacts and a directory lookup using a permitted Workspace account.
4. Explicitly request creation of a test contact, read its resourceName, update
   its phone or organization and read back the result. Explicitly request deletion
   of that same test contact and verify. Do not use real business contacts as fixtures.
5. Verify that declining new contact grants preserves existing mail access and
   only contact actions prompt for consent. Check account isolation, stale-etag
   rejection and no automatic write retries after network failures.
6. Reconcile the privacy policy, homepage, data use and all existing scopes.
   Submit justification and demonstration evidence for each new scope, then release
   production authorization changes after approval.

Combined review preparation does not require Gmail users to grant Calendar or
Drive access. Existing tokens gain no new permissions merely from a manifest
change: users must reconnect and consent. Partial denial should affect only the
related functionality. Approval and end-to-end authorization require separate verification.

## Data flow and evidence boundaries

Host `cindy.fetch` sends contact requests only to `people.googleapis.com`, using
the selected Gmail account and Host-injected credentials. The plugin does not
persist contact data in KV or send it to third-party avatar services. Results
return to the current AI task: verification materials and the privacy policy must
describe the actual Host and selected-model data flow, rather than claiming all
data stays local because the plugin does not persist it. Account photos use the
existing Host avatar path. Synthetic code tests do not establish real Google
consent or live-account contact management evidence.

Sidebar enrichment queries only the first 12 unique mail participants, with a
two-second lookup budget overlapping other message reads and a bounded, account-scoped,
one-minute in-memory cache. Missing contact scopes, default photos, partial email
matches and network failures fall back without making the message unreadable.
Other contacts and directory photos remain available through `gmail_contacts`;
the automatic sidebar lookup currently searches personal contacts only.

The updated Desktop falls back to Gravatar using the SHA-256 hash of the normalized
mail-header email, then DuckDuckGo's public domain favicon endpoint for business
domains, then initials. These image requests disclose an email hash or domain and
the viewer's network address to the service; no message body, raw email, Google
credential or contact record is sent. Hashes are not a promise of anonymity. Images
use no referrer; public mailbox domains such as Gmail and QQ skip domain logos.
Domain icons are not verified sender identities. This data flow must be reflected
in product privacy disclosures. Mail-body external images still require a separate
user click. No Unavatar subscription or Logo.dev key is required.

New sensitive/restricted scopes require additional review. Google's current
guidance says adding scopes alone does not require repeating an already-completed
security assessment. Other assessment and periodic review requirements depend on
the actual project.

## Official references

- [Changes to approved apps](https://support.google.com/cloud/answer/13464018?hl=en)
- [Minimum-scope policy](https://developers.google.com/identity/protocols/oauth2/policies)
- [Justification and video requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google account profile](https://developers.google.com/identity/openid-connect/openid-connect)
- [Create contacts](https://developers.google.com/people/api/rest/v1/people/createContact), [updates and etags](https://developers.google.com/people/api/rest/v1/people/updateContact)
- [Other contacts](https://developers.google.com/people/api/rest/v1/otherContacts/list), [directory search](https://developers.google.com/people/api/rest/v1/people/searchDirectoryPeople)
