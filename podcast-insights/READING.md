# Automatic reading notes (0.4.14)

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
original transcript. The question task passes transcript_id on every podcast_read call (including continuation) and every podcast_cite reference. This keeps the original version even if a replacement is imported after the task starts. An unavailable or foreign-episode version fails without substituting the active transcript.

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

Chapter ranges merge overlapping evidence spans, including decisions and quotations, so every cited segment remains within its chapter. When a transcript changes, the open reader updates its stale warning without rebuilding the document or resetting scroll; chapter questions are disabled and the runtime checks the active source version before creating a task. Regenerate before asking.


Model citation excerpts are capped at600 UTF-16 code units. Long passages are split for citation selection only, preferring pauses/word boundaries and preserving surrogate pairs. Prompt and evidence extraction use the same excerpt mapping to original segment IDs; semantic reading paragraphs, raw text and source timing are unchanged.

Full-transcript search uses the same Chinese spacing cleanup as the reading view across artificial storage cuts, retaining the original block mapping. Stored text and source time ranges remain unchanged.

Citation cards keep the cited transcript version when opening the Library, restoring the saved selection and loading more text. Existing cards resolve their source version from the stored segment. Opening an episode normally still uses the active transcript. Full-transcript search matches source text only; speaker labels and other interface text do not count as matches.
