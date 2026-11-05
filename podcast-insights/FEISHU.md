# Direct Feishu Minutes integration (0.3.0 development)

No MCP server or CLI is installed. Calls go directly to Feishu APIs. Existing AssemblyAI behavior and library data remain available.

## Configuration and limits

Save a `user_access_token` from your own Feishu application only in plugin settings. Cindy's vault stores it and injects it exclusively into `open.feishu.cn`. Never put credentials in chat, files or logs. The application needs Drive upload and Minutes upload/basic/artifact read permissions. This is a short-lived manual credential, not OAuth refresh or a shared XD Feishu account. Replace expired credentials in settings.

The Feishu button or `prepare` only creates a confirmation card. A real owner click uploads audio and creates a Minute, consuming the account's quota or applicable paid allowance. **Direct upload is limited to20 MiB.** Larger media must already be in Feishu Drive, with its `file_token` supplied. No automatic chunking, compression or transcoding is implemented; the roughly104 MB EP52 original cannot be uploaded automatically. Cloud files stay in the Feishu account; local deletion never deletes them.

## Tools

`podcast_feishu` supports:

1. `prepare`: `episode_id`, optionally an existing Drive `file_token`. Prepares confirmation only.
2. `import`: `episode_id` and an HTTPS `minute_url`. Reads an existing Minute without uploading or creating one.
3. `recover`: `episode_id`, `job_id` and an exact user-verified `minute_url`. Resumes an uncertain submission through reads, without repeating POST.

A file token is a resource identifier, not an access credential. Minute links must use a Feishu `/minutes/` path, not a docx document path. `podcast_status` reads progress. Plain text stays untimed; genuine SRT/VTT retains supplied timestamps. No speaker identity or new paragraph timing is invented. Provider summaries and chapters are retained as unverified local meta data, not validated claims.

## Recovery

After a timeout or lost receipt, never repeat upload or creation automatically. Check Feishu and recover using the exact Minute URL. Receipts distinguish `upload_outcome` and `minute_outcome`: rejected Minute creation may still leave a Drive file. `submission_outcome` covers external side effects of the whole flow. Account changes stop the original job; there is no automatic fallback to AssemblyAI.

## Verification boundary

Baseline: official plugin commit `628bfd79773453fd09734cfe53a261dedade215a` (0.2.21); new version0.3.0. Host APIs checked against Cindy0.1.125, commit `ac785430449042f120a296b881a25ae52333f1e1`. Injected HTTP and in-memory SQLite tests do not prove live Feishu compatibility, permissions or pricing. No live audio submission, installation, publication or production-library replacement has been performed.
