# Third-party marks in the Herdr console

The panel shows official agent logos only to identify which agent is running
in a pane. They are used unmodified, remain the property of their owners, and
do not indicate affiliation or endorsement.

| Third party | Where it appears |
| --- | --- |
| Claude (Anthropic, PBC) | `assets/agents/claude.svg` — official mark, unmodified; identifies Claude agents |
| OpenAI, Codex (OpenAI, Inc.) | `assets/agents/codex.svg` — official mark, unmodified; identifies Codex agents |
| Cursor (Anysphere, Inc.) | `assets/agents/cursor.png` — official mark, unmodified; identifies Cursor agents |

The repository-level `TRADEMARKS.md` is a shared package file: editing it in a
plugin PR makes the release contract treat every plugin as changed and require
version bumps for all of them. The registration therefore lives in this
plugin-scoped table instead; see also `README.md` / `README.zh-CN.md`.
