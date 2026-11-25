# Open Artifact for Cindy

In a local desktop task with a writable workspace, type `/artifacts` and describe what to make. Open Artifact can produce documents, slides, design canvases and systems, whiteboards, spreadsheets, dashboards and animated work. The editor opens in the task sidebar. Reopening the same URL reuses its tab.

Edit and export in the editor. Send your comment or ask for a change in the page to queue a message to the task that owns the artifact. Collaborator or system notices are kept in Open Artifact. Works stay in the task workspace. After restarting Cindy, reopen the artifact from its task.

To adopt a folder or move an existing work to another task, run `adopt` in the destination task and confirm in Cindy. Comments and edit requests go to the destination task after the move succeeds.

The plugin starts its bundled Open Artifact runtime on first use. No Node installation, runtime download, external account, or automatic cloud publishing is needed. The plugin needs approval for its local Node worker, localhost previews and task delivery. Disabling it stops the worker and its daemon.

Artifact folders and tool-supplied import and export paths must resolve inside the task workspace. The editor remains bound to the workspace registered for the work as long as the page is open. The plugin checks the extracted runtime against the bundled integrity inventory before reuse.

Based on [Open Artifact](https://github.com/JimLiu/open-artifact) and the [original Cindy integration](https://github.com/makecindy/cindy/pull/12226). The bundled runtime uses Open Artifact 0.14.6 with the workspace changes documented in [vendor/BUILD.md](vendor/BUILD.md). See `THIRD-PARTY-LICENSES.txt`.
