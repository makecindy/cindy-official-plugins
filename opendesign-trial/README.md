# OpenDesign for Cindy — local trial 0.4.2

Cindy's native conversation, Harness and current session model generate and revise designs. The sidebar embeds the real OpenDesign v0.22.1 FileViewer, element comments, manual editing and PreviewDrawOverlay, plus the v0.1.0 SketchEditor. The official logo and bundled source are included. This is a component integration, not the full OpenDesign daemon or a separate chat application.

Generation and updates return a manuscript preview card. Clicking it opens that manuscript in the card's owning session sidebar; it never creates or switches sessions or opens a directory. After updating the plugin, click the existing card again to obtain a fresh local URL.

The viewer supports element comments with selectors, manual text/style edits saved to HTML, drawing/region annotations with screenshots, and saved sketches. “Save feedback” only persists context for the next conversation turn; it does not populate Cindy's composer or start a model.

Explicit Send submits through Cindy `agent.run(mode:continue)` to the fixed owning session; Cindy queues it when busy. `agent.background` is required because the action originates in a local webpage rather than a Cindy card action ticket. There are no errands, schedules or separate model credentials. Click the session's artifact card first to establish the host association. Host rejection is shown as a failure, never redirected to another session. Unknown outcomes are not retried automatically.

Follow-up conversation calls `opendesign_context` for current HTML, revision, sketches, comments and screenshot paths, then `opendesign_update` for the same manuscript. Conflicting revisions are rejected; prior HTML is backed up. Historical feedback remains context. The viewer refreshes after changes.

Separate random-token localhost origins serve the editor and read-only artifact. Authored HTML runs in an opaque sandboxed iframe; editor requests reject foreign origins. Session ownership is persisted and restored on card clicks after restart. Unsupported cloud sharing, collaboration and version browsing are hidden.

Validation uses isolated headless Chrome for real upstream comments, manual edits, annotation screenshots, JavaScript interaction and refresh. Node tests cover card restoration, session isolation, filesystem/origin boundaries, revision conflicts, duplicate submission and unknown outcomes. Model dispatch is mocked: no paid run was started in the user's real design session, so the installed host/model/write-back round trip still needs use-time acceptance. No user desktop automation was used.

Official repository proposal; provisioning is an empty targeted audience, not automatic distribution. See `source/`, `node/`, `UPSTREAM.json` and `THIRD-PARTY-LICENSES.txt` for sources, provenance, patches and licenses.

0.4.2: Card CSS is inlined before host sanitization, preserving selector styling and body colors. Opening controls have independent styles. Cards remain static; JavaScript interaction stays in the viewer.

Build from the plugin directory: `npm ci --prefix source/build && npm run build --prefix source/build`. The lockfile pins dependencies; no network is required at runtime. `SOURCE-INVENTORY.json` records every vendored source hash and modification. `NETWORK-INVENTORY.json` records literal source domains (including inert examples). See the PR for verification gaps.
