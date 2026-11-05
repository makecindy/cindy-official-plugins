# Automatic reading notes (0.4.0 development build)

From an episode with an existing transcript, open **Reading notes → Generate**.
The plugin starts a Cindy task which calls `podcast_minutes` to organize the
transcript through Cindy's configured text model. Model quota applies; audio is
not retranscribed. No new provider key or MCP is needed for this workflow.

The output includes an overview, selected insights, topic chapters, explicit
choices described by speakers, quotations, source links when present, and the
complete transcript. The model selects existing sentence identifiers; the
program extracts and matches quotations. Navigation ranges are computed from
source anchors and cover all transcript segments. They are navigation aids,
not manually verified semantic boundaries or sentence-level timestamps.

The reader supports a collapsible contents list, source jumps, full-transcript
search, and chapter questions which open a new Cindy task with the chapter,
source version and original segment range. Answers must retrieve and cite the
original transcript. This chapter-question route is implemented; the EP52
live run did not submit a real follow-up question.

Read mode removes artificial Chinese character spacing and splits at sentence
punctuation and selected discourse pauses. It never changes original stored
text, ASR facts, speaker identities or source time intervals. Expand the raw
text to inspect the unchanged original. Quotes and summaries remain subject to
ASR errors and interpretation errors; matching alone does not verify a claim.
Explicit choices may be historical, not meeting action items. No links or
decisions are fabricated to fill empty sections.

`podcast_minutes` actions:

- `generate`: existing active transcript only; cache by language and transcript
  version. `regenerate:true` requests a fresh result. `overview_only:true`
  refreshes the overview and insight selection from existing validated chapters.
- `read`: metadata, stale state and artifact paths. `section_offset` reads up to
  two chapter records per page.
- `export`: writes standalone HTML and structured JSON to `outputs/` in the
  current task working directory, through the current Agent call's host grant.

JSON/HTML live in the plugin Library under immutable generated identifiers;
the previous result pointer is replaced only after successful generation and
artifact writes. A changed active transcript marks the old result stale.
Missing models, invalid references or incomplete structures preserve the old
result. Old files are retained; no automatic file cleanup or external knowledge
base publishing is included.

YouTube extraction is not implemented. YouTube URLs now return a specific
supported-alternatives message before fetching; matching RSS is a separate
Agent step, not an automatic plugin capability.
