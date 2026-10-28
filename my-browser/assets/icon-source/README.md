# Cindy toolbar mark

Sources for the extension's toolbar and context-menu icon. The silhouette and
hair strands are the Cindy desktop menu-bar mark
(`apps/desktop/native/menubar/macos-menubar-helper.swift` in the client repo),
drawn in `#15161c` on Cindy red `#F70121`.

- `toolbar.svg`: full detail (strands, earring), rendered at 24 and 32 px.
- `toolbar-small.svg`: silhouette only, slightly larger, rendered at 16 px.

The illustrated `48.png` / `128.png` stay for the extensions page and the
store listing. Render the PNGs at their exact pixel size (device scale 1)
into `extension/icons/toolbar-{16,24,32}.png`.
