# Todo Scan

Collects TODO, FIXME, HACK and XXX markers out of text the Agent already has, shows them in a dockable panel for triage, and hands the still-open ones back as items or a markdown checklist. Requires **Cindy 0.1.64 or later**. Plain JavaScript with no third-party runtime dependencies, no build step, no network access and no credentials.

## What it does not do

It does not open files, walk a repository, edit anything, or watch for changes. It reads the string the Agent passes in — file contents, a diff, a document, notes — and reports markers relative to that string. Anything that needs the filesystem is the Agent's job before the call; the marker list is this plugin's job.

## Install and enable

This plugin is **opt-in**: its `provisioning.json` entry seeds it for nobody, so it is never installed automatically. Enable it from the marketplace. The panel docks on the left and shows "Run a scan in chat and its results appear here" until the first scan.

## Use

Ask for a specific marker search — "collect the FIXMEs from this PR", "list every HACK before we ship", "find the TODOs in this diff" — and the Agent calls `scan_todos` with the text. Plain task-list questions ("what is left to do here") are not routed here, because the plugin only matches the four literal markers. Two tools are exposed.

`scan_todos`

| Parameter | Meaning |
| --- | --- |
| `text` | Required. The exact text to scan, including newlines, up to 200,000 characters. Line numbers are reported against this string, so it must be passed verbatim rather than summarised. |
| `tag` | Optional. `TODO`, `FIXME`, `HACK` or `XXX`; omit it to scan all four. |

Returns `{ total, truncated, scannedLines, byTag, items }`. Each item is `{ key, line, column, tag, text }`, with 1-based `line` and `column` inside the supplied text and `text` the remainder of that line after the marker, with leading separators and trailing whitespace removed and capped at 300 characters (a `…` marks a cut). The cap keeps one very long line from inflating the whole result; it does not affect `line`/`column`, which always point at the real position. A line can hold several markers; each is reported separately, which is why the key is `line:column:tag`. `byTag` counts only the markers the scan kept: when `tag` is set the other three tags are reported as `0`, because the filter applies while scanning rather than to a finished list. An empty match list is a successful result, not an error.

At most 200 markers are returned. Past that, `truncated` is `true` and `total` equals the number returned rather than the true count. `scan_todos` returns no `note` field — the `note` that calls a scan incomplete comes from `get_selection`. Rescan a narrower slice to see the rest.

`get_selection`

Takes no parameters. Returns the panel's current state: `{ hasScan, lastScanAt, filter, total, truncated, visibleCount, unresolvedCount, resolvedCount, byTag, items, markdown, note }`. `items` are the unresolved markers the panel currently shows, and `markdown` is the same list as a `- [ ]` checklist ready to paste.

`items`, `markdown` and the counts `visibleCount`, `unresolvedCount` and `resolvedCount` all follow the active `filter` — `resolvedCount` counts items the user actually ticked, so markers hidden by the filter are never reported as done — while `total` and `byTag` describe the whole scan. If `hasScan` is false, nothing has been scanned yet in this session.

## The panel

Filter chips (All, TODO, FIXME, HACK, XXX), a checkbox per item, a running "N open" count and a markdown view of the unresolved items. A scan pushes its results to the panel straight away; Refresh asks for the current state again without rescanning.

Ticking an item off changes what `get_selection` returns, and nothing else: resolved items stay in the panel, struck through, until the next scan. A new scan starts from zero tick-offs and bumps a `scanGen` counter, because the old keys no longer describe the new text and a key can be reused by the new scan. A tick the panel queued against the old scan carries the old `scanGen` and is dropped rather than resolving whatever item in the new scan happens to share that key.

The panel and `main.js` talk over a same-origin `BroadcastChannel`, and the panel wakes the plugin with `fetch('cindy-ghost://todo-scan/wake')` first, because a freshly opened panel usually finds it asleep. A state read carries a `reqId` and is re-sent until the plugin answers, because a freshly opened panel usually meets a plugin that is still starting; the plugin answers every retry again rather than caching "already answered," because that cache is what could otherwise swallow a retry after a lost first reply. A filter change or a tick is sent once and drawn from the panel's own copy straight away; the next state read is what reconciles it with the plugin. Every panel message is safe to repeat, so answering a read twice or a dropped stale mark never double-applies anything. The panel has no bridge to the Host: it cannot call tools, read credentials or touch files, and it never pushes anything to the Agent. The Agent asks, with `get_selection`.

## Errors

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | `text` missing or empty, or `tag` outside the four markers. |
| `TEXT_TOO_LARGE` | More than 200,000 characters; scan one file or one hunk at a time. |
| `UNKNOWN_TOOL` | A tool this version does not expose. |
| `INTERNAL_ERROR` | The plugin stopped before finishing; nothing was modified. |

Messages say what to do next, and the plugin never retries on its own.

## Privacy

Everything stays local and in memory. No files, no clipboard, no screen access, no network, no telemetry, no credentials declared in `ghost.json`, and nothing persisted — the scan, the filter and the tick-offs live in the plugin's process and disappear when it stops. The only text the plugin ever sees is what the Agent passes to `scan_todos`.

## Development and package

Run `node --test .tests/todo-scan.test.mjs` from the repository root. The tests run `main.js` in `node:vm` against a mocked Host and a mocked `BroadcastChannel`, covering the scanner (multiple markers per line, tag filters, the 200 cap, line and column numbering), argument validation, both tools, the panel protocol (wake, retry, `reqId` dedupe, filter and tick), the honest split between filtered and whole-scan counts, and the page CSP. Mocked tests do not replace verification on a real Cindy build.

The repository packages the committed directory with its root license and trademark notices through `.github/scripts/package-plugin.sh`; there is no generated or vendored code to rebuild.

Reference: [Cindy](https://github.com/makecindy/cindy).
