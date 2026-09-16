# OpenDesign for Cindy — local trial 0.4.7

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

0.4.3: Installed packages carry all tracked `source/` files in `source.zip` to meet the platform’s 256-entry limit; the repository keeps them as reviewable text. Extract `source.zip` in the plugin directory before building an installed package. Repository maintainers regenerate the archive with `python3 .github/scripts/package-opendesign-source.py` after source changes (stage new source files first); `--check` verifies every archived path and byte against Git-tracked sources. Runtime capabilities remain unchanged. Card previews now block external resources while preserving inline layout/colors and embedded raster images; uncertain submissions remain unknown.

Browser regressions: install Playwright Chromium, then run `node --test .tests/opendesign/native-ui.cjs .tests/opendesign/source-regressions.cjs` from the repository root. To use an existing browser, set `OPENDESIGN_CHROMIUM_PATH` to its executable. Tests use isolated headless windows only.

0.4.4: URL-load previews carry a project-scoped CSP; editor resources no longer allow arbitrary loopback ports. Unexpected host session receipts remain unknown. Manual HTML edits, undo/redo and Agent writes share an atomic revision check: stale saves return 409 and keep newer content intact. Browser regressions cover a real save race and blocked outbound image/script/fetch requests.

0.4.5: Text editing runs in an editor-owned input over the canvas. Click selects the inspector; double-click opens inline text editing, Enter saves and Escape cancels. Only trusted input in this parent document authorizes a one-use save; the credential never enters the artifact iframe. Forged iframe commit/session messages are ignored. Saving validates the active target, original text and source revision; conflicts retain the draft.

0.4.6: The editor-owned canvas captures selection, double-click and drag gestures. Artifact messages cannot open text inputs or stage drag writes; input placement and displacement come from trusted parent pointer coordinates. Source revisions still guard every save. Browser coverage exercises the actual srcdoc viewer network policy as well as the raw URL response.

0.4.7: Explicit pre-dispatch validation failures retain rejected status and the server message. Lost responses, polling errors and post-dispatch exceptions remain unknown. Browser regressions also verify that the editor frame-src policy blocks artifact self-navigation via location assignment/replacement, meta refresh and links.
