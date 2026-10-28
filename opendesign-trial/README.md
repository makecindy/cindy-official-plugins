# OpenDesign for Cindy — local trial 0.4.27

## Cross-device preview

Every draft tool returns `previewPath` and `previewMarkdown` for the actual HTML file. Include `previewMarkdown` in the assistant reply as the primary entry: Cindy routes that file through its standard local, remote-desktop and mobile preview. No localhost editor URL, cloud upload, duplicate draft or new transport is needed. Prefer self-contained HTML for portable content.

Continue edits in the original task with `opendesign_context` and `opendesign_update` using the current revision. Native desktop preview supports element comments and style proposals. Mobile uses the standard file reader; HTML text-to-task quoting requires the companion client change. These capabilities do not make the plugin’s dedicated drawing canvas or direct-save editor portable: that optional card entry remains local to the execution computer. Mobile card clicks explain the file entry without opening an unusable editor or consuming the preview rate limit.

Cindy's native conversation, Harness and current session model generate and revise designs. The sidebar embeds the real OpenDesign v0.25.0 FileViewer, element comments, manual editing and PreviewDrawOverlay, plus the v0.1.0 SketchEditor. The official logo and bundled source are included. This is a component integration, not the full OpenDesign daemon or a separate chat application.

Generation and updates return a standard HTML file link plus an optional local-editor card. On the execution computer, clicking that card opens the editor in the owning session sidebar; it never creates or switches sessions or opens a directory. After updating the plugin, click the existing card again to obtain a fresh local URL.

The viewer supports element comments with selectors, manual text/style edits saved to HTML, drawing/region annotations with screenshots, and saved sketches. “Save feedback” only persists context for the next conversation turn; it does not populate Cindy's composer or start a model.

Explicit Send submits through Cindy `agent.run(mode:continue)` to the fixed owning session; Cindy queues it when busy. `agent.background` is required because the action originates in a local webpage rather than a Cindy card action ticket. There are no errands, schedules or separate model credentials. Click the session's artifact card first to establish the host association. Host rejection is shown as a failure, never redirected to another session. Unknown outcomes are not retried automatically.

Follow-up conversation calls `opendesign_context` for current HTML, revision, sketches, comments and screenshot paths, then `opendesign_update` for the same manuscript. Conflicting revisions are rejected; prior HTML is backed up. Historical feedback remains context. The viewer refreshes after changes.

Separate random-token localhost origins serve the editor and read-only artifact. Authored HTML runs in an opaque sandboxed iframe; editor requests reject foreign origins. Session ownership is persisted and restored on card clicks after restart. Unsupported cloud sharing, collaboration and version browsing are hidden.

Validation uses isolated headless Chrome for real upstream comments, manual edits, annotation screenshots, JavaScript interaction and refresh. Node tests cover card restoration, session isolation, filesystem/origin boundaries, revision conflicts, duplicate submission and unknown outcomes. Automated tests mock model dispatch; separately, the user confirmed real-device acceptance in the development session on 2026-09-17. That confirmation is the device-verification evidence, not the automated tests. No user desktop automation was used.

Official repository proposal; provisioning is an empty targeted audience, not automatic distribution. See `source/`, `node/`, `UPSTREAM.json` and `THIRD-PARTY-LICENSES.txt` for sources, provenance, patches and licenses.

0.4.2: Card CSS is inlined before host sanitization, preserving selector styling and body colors. Opening controls have independent styles. Cards remain static; JavaScript interaction stays in the viewer.

Build from the plugin directory: `npm ci --prefix source/build && npm run build --prefix source/build`. The lockfile pins dependencies; no network is required at runtime. `SOURCE-INVENTORY.json` records every vendored source hash and modification. `NETWORK-INVENTORY.json` records literal source domains (including inert examples). See the PR for verification gaps.

0.4.3: Installed packages carry all tracked `source/` files in `source.zip` to meet the platform’s 256-entry limit; the repository keeps them as reviewable text. Extract `source.zip` in the plugin directory before building an installed package. Repository maintainers regenerate the archive with `python3 .github/scripts/package-opendesign-source.py` after source changes (stage new source files first); `--check` verifies every archived path and byte against Git-tracked sources. Runtime capabilities remain unchanged. Card previews now block external resources while preserving inline layout/colors and embedded raster images; uncertain submissions remain unknown.

Browser regressions: install Playwright Chromium, then run `node --test .tests/opendesign/native-ui.cjs .tests/opendesign/source-regressions.cjs` from the repository root. To use an existing browser, set `OPENDESIGN_CHROMIUM_PATH` to its executable. Tests use isolated headless windows only.

0.4.4: URL-load previews carry a project-scoped CSP; editor resources no longer allow arbitrary loopback ports. Unexpected host session receipts remain unknown. Manual HTML edits, undo/redo and Agent writes share an atomic revision check: stale saves return 409 and keep newer content intact. Browser regressions cover a real save race and blocked outbound image/script/fetch requests.

0.4.5: Text editing runs in an editor-owned input over the canvas. Click selects the inspector; double-click opens inline text editing, Enter saves and Escape cancels. Only trusted input in this parent document authorizes a one-use save; the credential never enters the artifact iframe. Forged iframe commit/session messages are ignored. Saving validates the active target, original text and source revision; conflicts retain the draft.

0.4.6: The editor-owned canvas captures selection, double-click and drag gestures. Artifact messages cannot open text inputs or stage drag writes; input placement and displacement come from trusted parent pointer coordinates. Source revisions still guard every save. Browser coverage exercises the actual srcdoc viewer network policy as well as the raw URL response.

0.4.7: Explicit pre-dispatch validation failures retain rejected status and the server message. Lost responses, polling errors and post-dispatch exceptions remain unknown. Browser regressions also verify that the editor frame-src policy blocks artifact self-navigation via location assignment/replacement, meta refresh and links.

0.4.8: Persisted free-pin and file-comment identifiers use crypto.randomUUID. Cards with oversized direct text or root attributes fall back to a fixed small preview without changing the manuscript. **Known host limitation:** a real viewer probe confirmed RTCPeerConnection can send STUN UDP outside the HTTP CSP boundary. Host-enforced WebRTC isolation is still required; this version does not claim that gap is fixed.

0.4.9: Both persisted annotation paths share the existing UUID utility. Where randomUUID is unavailable it uses getRandomValues to construct a v4 UUID; absent Web Crypto fails closed. Removed the upstream weak-random fallback. The free-pin bridge embeds the same self-contained implementation in its sandbox realm. Real-device acceptance was subsequently confirmed by the user; WebRTC remains a host limitation.

0.4.21: Artifact frames (including thumbnails and presentation previews) no longer grant allow-downloads. Authored data/blob or local-project download links propose a file to the parent editor; only a trusted click on Save file authorizes the download. The proposal shows the filename and byte size, accepts at most 12 MiB, and can be cancelled. Existing parent-owned export controls remain available. Device acceptance is confirmed. WebRTC isolation remains outside this plugin change by the user’s scope decision; the risk is not claimed fixed.

Download confirmations also accept explicitly marked version and presentation previews and appear inside the presentation/fullscreen container. URL-load/powered mode is disabled by this adapter; noninteractive thumbnails cannot request saves.

Editing annotation text retains existing screenshot attachments and appends newly uploaded images. Successful dispatch requires an exact bound session receipt; missing session IDs remain unknown.

Image batches are fully decoded and validated before any attachment file is written, so a later invalid image cannot leave earlier orphan files.

Token-scoped read-only project resources allow credential-free CORS for opaque sandbox origins, restoring local fetch and ES module imports without enabling editor access.

Multi-element pod annotations now use the shared cryptographic UUID helper, matching free-pin and file-comment IDs.

Project-file downloads request raw source so saved HTML exactly matches the original file without the preview reload script.

Snapshot and export bridge request IDs use the shared cryptographic UUID helper; missing Web Crypto fails closed.

CodeQL cleanup: cryptographic analytics IDs, non-concatenating markup masking, whitespace-tolerant script closing tags, and backslash-safe Markdown table code spans. Inert source editing and Blob image rendering retain their behavior.

Manual saves and Agent updates share a 1 MiB decoded HTML byte limit; oversized saves fail before writing, preserving the previous draft. Asset files retain their existing limit.

Comment and Inspect picking now require a one-use parent-owned pointer gesture. Artifact messages cannot clear or retarget an unsaved comment. Target broadcasts inspect at most 1,000 nodes and return at most 500 visible candidates; the parent rejects oversized arrays. Direct picking remains available beyond the broadcast budget.

Initial creation reserves a recoverable pending project. A failed first write can be retried in the same session and directory; the binding becomes ready only after writing succeeds. If a write completed but its receipt or final state was lost, recovery preserves the existing manuscript instead of overwriting it.

All ordinary draft tools, card actions and feedback dispatch reject pending initialization with an explicit same-session opendesign_new recovery instruction; no empty draft card or model run is produced.

Runtime card metadata, unnamed design titles and card-open status use the host language: Chinese for zh-CN and English fallback for en/ja/ko. Explicit user titles remain unchanged.

Runtime-state capture/restore and related preview measurement, scroll, scope and transport correlation IDs now use the shared fail-closed cryptographic UUID helper. Retries retain the same pending request ID; subsequent requests receive a fresh ID.

0.4.26: Reopening an existing card can repair a missing project ownership marker using the exact draft/session/root binding previously saved in Host-private storage. Recovery requires the original generated project directory and its HTML file; it never overwrites conflicting or corrupt markers, follows draft symlinks, recreates missing content, or adopts an unregistered workspace. Missing directories and drafts now give recovery guidance instead of a raw ENOENT path. Project files remain local to the computer and workspace where they were created; this is not cloud synchronization or a backup of deleted files.

0.4.26 also upgrades the bundled viewer to official `open-design-v0.25.0` (`de6d2c0`): snapshot XHTML serialization, localized export errors and updated viewer styles. Existing Cindy ownership, revision, trusted-input and download protections remain. The new daemon diagnostics bridge is disabled; runtime permissions and npm dependency versions are unchanged. Current-package device verification is recorded separately in the PR.
