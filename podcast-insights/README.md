# Podcast Insights

Approved scope: [proposal #158](https://github.com/makecindy/cindy-official-plugins/issues/158#issuecomment-6120456702). M1 imports and original-evidence workflows plus optional M2 AssemblyAI cloud transcription. In-app playback is deferred to M3.

Open the sidebar library, import RSS / Apple Podcasts / Xiaoyuzhou or public audio URLs ending in `.mp3`, `.m4a`, `.wav`, `.ogg`, `.aac` or `.flac`, then search or read the available transcript. Query strings and fragments are allowed. Link import in the page creates a visible Cindy task; match RSS candidates and confirm cloud fees in its cards. Tools expose eight stable `podcast_*` names. The optional key is stored only by Cindy; Agent arguments cannot submit paid transcription.

Build: `node podcast-insights/build.mjs`. Tests: `node --test .tests/podcast-insights.test.mjs`. Requires stable/Beta Cindy >=0.1.103. Metadata locales cover en/zh-CN/ja/ko; runtime pages support Chinese and English with English fallback.

SQLite migrations retain legacy0.1.x JSON, receipts, briefs and export files. Legacy active transcript versions and pending cloud jobs are imported using stable IDs. Deletes affect the new index and create a backup; originals and exports are retained. Uninstall retains the library.

Declared differences from the approved draft: preserve the existing `assemblyai_key` secret name because the Host does not expose a sanctioned plaintext migration path; never ask existing users to reconfigure it. Host secret status may supply a masked tail; show it only when present, never read the key. Page imports/cloud estimates create ordinary visible tasks (`agent.tasks`), with no background Agent permission. Unknown-job list recovery examines100 recent provider tasks and fails closed if ambiguous. Harmless DOCTYPE is removed; declared entities are rejected to prevent entity expansion.

Content permissions are separate from API access and user confirmation. Provider retention/training settings and the actual model data flow need verification before public release; local library storage does not imply local-only analysis. Review the release evidence before marking device verification complete.

Review fixes in0.2.1: interruption-safe legacy migration, reset reader state when changing episodes, long-text splitting without invented timing, preserve timed boundaries, paired paragraph/character continuation, deduplicated GUIDs, ISO dates, ready transcripts retained during cloud failures, correctly failed Host results, and explicit untrusted-content labels. Cloud reconciliation uses a bounded submission window. Source requests use Host in-flight callId checks, URL/SSRF/DNS/redirect checks and pinned connections; no plugin code grants private-network access. The cloud card states that only audio URL and processing options are sent, and that no zero-retention or training opt-out is requested.

0.2.2 fixes: search crosses artificial cuts between adjacent text blocks sharing their source interval. Quotes longer than1200 characters are rejected with an actionable message; neither selected quotes nor whole displayed passages are silently truncated.

0.2.3 fixes: citation cards display matching source context with explicit omission marks and a library link for complete evidence; source links declare card.externalLinks. A local persistence failure after cloud submission still returns an unknown outcome and a do-not-resubmit warning. Interrupted submitting jobs enter status reconciliation, including after restart.

0.2.4 fixes: citations prefer directly matching segments before boundary-spanning context, preserving the actual speaker/time/focus ID. Prepared estimates refresh current audio and price; changes after display require another confirmation. Cloud claim and failure transitions atomically update job/episode states. episodes selects publisher transcripts via latest:N (1-50) or feed GUIDs, not library episode IDs.

0.2.5 fixes: durable claiming separates the pre-submit phase from possible paid submission. A failed ownership read releases only its own claim and restores the prior episode/card state; failed releases can resume through status, preparation or restart. Recovery of claiming never queries or submits to the provider.

Additional0.2.5 fixes: source retrieval refuses the credentialed AssemblyAI API host; only fixed cloud operations may use it. Fallback persistence keeps known provider IDs and reports execution. Library search displays actual show/episode and clears old action targets. Empty completed transcription ends in an atomic failed state.

0.2.6 fixes: only Host-completed 4xx responses mean a rejected cloud POST; incomplete transport remains unknown. Transcript input limits are5 MB and20000 source cues before splitting. Search emits no internal norm or full adjacent context, with a20000-character total/1000-character excerpt budget and explicit truncation flags. UI timestamps format elapsed duration beyond24 hours without wrapping.

0.2.7 fixes: reject oversized metadata before indexing (title500/author300/language64 chars; GUID/URL4000, date128, max50 transcript links/type128). Cite has a20000-character quote+excerpt budget, max800 source chars per result, omission flags and reference_index; cards disclose their first3-match limit. Query/quote schema limits are300/1200 chars. Library paginates episodes only; shows first500/jobs latest100 are snapshots with truncation flags. Source Accept supports advertised RSS/Atom/HTML/VTT types.

0.2.8 fixes: excerpts prefer the exact quote location before normalization;20000 source cues can expand beyond20000 storage chunks. Known audio limits4 hours/256 MiB are explicit. Library summaries omit remote transcripts, GUID and audio/page URLs, project short titles and share a60000-byte envelope; episode cursors follow returned rows. around_segment starts with its target. Notes have independent bounded pages and a Load more action. Expected errors give concrete remedies.

0.2.9 fixes: Xiaoyuzhou candidate confirmation preserves the requested episodes selector. Import receipts are bounded to60000 bytes with omitted counts and library continuation; stored imports remain intact. Reader pages omit internal norm even with max_chars=1. Notes beyond5000 chars are rejected before saving with a clear message, not truncated. Full GUIDs remain reachable using library include_guid:true and cursors, even without a transcript.

0.2.10 fixes: citation matching checks later direct quotes before earlier normalized matches; search results include source metadata in a60000-byte envelope; documented audio URL extensions allow query strings and fragments; invalid episode selectors fail before source fetch or writes; and each cloud job receives an independent polling budget.


0.2.11 fixes: citation search no longer imposes a 20000-row cap; it reaches the full active transcript after source-cue splitting, including the final legal segment.

0.2.12 fixes: cloud estimate and status responses omit full audio URLs until the user confirms; status checks use bounded concurrency and a 60000-byte response budget.

0.2.13 fixes: cloud estimate projections use an explicit safe field list; status added offset/limit pagination (replaced in0.2.15); publisher transcript retrieval uses four-way concurrency and tries alternate transcript sources after failures. 0.2.14 fixes: the English manifest description now matches the localized status pagination contract.

0.2.15 fixes: status uses submission-time/ID cursor=next_cursor so terminal transitions cannot skip active jobs. Local paging never extends provider reconciliation beyond100 recent tasks. Publisher retrieval awaits all workers before returning errors, uses a shared120-second/100-attempt budget, and reports incomplete episode IDs without marking them failed.

0.2.16: Library recovery follows every local status page and refreshes after each page, yielding to queued actions between pages. Recovery pages and polling rounds use four workers and a shared60-second network deadline; requests use the remaining time and all workers settle before releasing the queue. Storage/card delivery can take additional time. Unchecked card jobs rotate to the front of the next poll; each job retains its29-minute/40-check limit. Reading exposes only selected episode metadata and a source page link, omitting audio URLs and GUIDs. Missing Library/network APIs return CLIENT_UPGRADE_REQUIRED with upgrade instructions.

0.2.17 closes legacy cardless recovery, consecutive-cue citation and Unicode-splitting gaps. Read/search/cite share safe source-link projection; full citation output is limited to60000 bytes with explicit reference continuation. Reader refresh follows active transcript versions while preserving loaded pages after unrelated refreshes and failed continuation.

0.2.18: Full response max60000 bytes; Unicode-safe continuation (one astral character may exceed max_chars=1). Supported HTML decodes semicolon-terminated named character references once. Ambiguous overlapping unknown jobs stay unknown; remote IDs are atomically claimed by one local job.

0.2.19: JSON: array or {segments:[...]}; text (alias body), start/end (aliases startTime/endTime) in seconds, not milliseconds; optional speaker. HTML excludes comments, nested templates and raw-text containers; not a general page-visibility/CSS extractor.

0.2.20: HTML evidence uses the pinned parse5 standard parser; excludes plaintext/raw-text/template contexts without executing scripts or fetching resources. WebVTT cue entities decode once. Publisher retries retain active cloud status; continuation restarts on transcript-version changes; deletion refreshes notes. Progress cards show current recovery errors. Restart reclaims only incomplete inactive user/publisher versions, retaining completed history, active and cloud versions. Parser provenance: THIRD-PARTY-LICENSES.txt.

0.2.21: Unknown-job cards retain a safe default recovery hint when UI localization initialization fails.
