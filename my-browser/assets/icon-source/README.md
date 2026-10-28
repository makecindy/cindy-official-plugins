# Cindy toolbar mark

Sources for all of the extension's icons (toolbar, context menu, extensions page, store). The silhouette and
hair strands are the Cindy desktop menu-bar mark
(`apps/desktop/native/menubar/macos-menubar-helper.swift` in the client repo),
drawn in `#15161c` on a white rounded tile with a light border, with the earring in Cindy red `#F70121`.

- `toolbar.svg`: full detail (strands, earring), rendered at 24, 32 and 48 px, and at 96 px inside a 128 px canvas (16 px transparent margin, as the Chrome Web Store asks).
- `toolbar-small.svg`: silhouette only, slightly larger, rendered at 16 px.

Render the PNGs at their exact pixel size (device scale 1) into
`extension/icons/mark-{16,24,32,48,128}.png`. The illustrated `16/32/48/128.png`
remain only for the in-page brand image and tests.
