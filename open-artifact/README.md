# Open Artifact for Cindy

In a local desktop task with a writable workspace, type `/artifacts` and describe what to make. Open Artifact can produce documents, slides, design canvases and systems, whiteboards, spreadsheets, dashboards and animated work. The editor opens in the task sidebar. Reopening the same URL reuses its tab.

Edit and export in the editor. Send your comment or ask for a change in the page to queue a message to the task that owns the artifact. Collaborator or system notices are kept in Open Artifact. Works stay in the task workspace. After restarting Cindy, reopen the artifact from its task.

The plugin starts its bundled Open Artifact runtime on first use. No Node installation, runtime download, external account, or automatic cloud publishing is needed. The plugin needs approval for its local Node worker, localhost previews and task delivery. Disabling it stops the worker and its daemon.

Artifact folders and tool-supplied import and export paths must resolve inside the task workspace. The plugin checks extracted runtime files against the bundled integrity inventory before reuse.

Based on [Open Artifact](https://github.com/JimLiu/open-artifact) and the [original Cindy integration](https://github.com/makecindy/cindy/pull/12226). The bundled runtime is pinned to 0.14.6. See `THIRD-PARTY-LICENSES.txt`.
