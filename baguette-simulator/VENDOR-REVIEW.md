# Vendored runtime evidence

Upstream: [tddworks/baguette v0.1.98](https://github.com/tddworks/baguette/releases/tag/v0.1.98), macOS arm64 release. Original release archive SHA-256: `f4eafe5a19bde27be192edb17305848f3f8100240f3f55dce07bef5cf0690b14` (recorded during local trial acquisition). The upstream executable is unchanged; `vendor-inventory.json` enumerates all 94 packaged upstream files with SHA-256 and byte size. Official logo is resized to 512×512 within Cindy’s 512 KiB limit.

## Exact source modifications

`vendor-web.patch` is the complete diff against `Sources/Baguette/Resources/Web` at tag v0.1.98 (commit `5975fa510a5083956f99e25544b6583f296228dd`). Only these nine Web files differ:

- `stream-session.js`: bounded reconnect after unexpected socket close; cancel scheduled reconnect on deliberate stop.
- `baguette/parts/keyboard.js`: delegate key/text/clipboard actions to the private-device bridge, suppress OS repeats and duplicate in-flight paste, serialize keys/paste/copy, report queue overflow, drop unsent keys on blur/hide/detach/release.
- `baguette/parts/bezel.js`, `baguette/carplay/carplay-frame.js`, `sim-native.html`: standard arrow cursor instead of crosshair.

- `farm/farm.html`: remove remote font/preconnect links; keep the existing system-font fallback and all Device Farm controls.
- `sim-location.js`: map tiles/search use same-origin `/map/` routes; the Node worker validates coordinates/query length and sends HTTPS only to fixed OSM hosts, with no redirects or forwarded credentials.
- `sim-native.js`: toolbar labels use textContent, preserving literal text instead of interpreting DOM-sourced titles as HTML.
- `sim-3d.js`: fallback selector escaping uses CSS hexadecimal escapes for every code point, including backslashes and quotes.

The first-party `native/keyboard.m` adapts Baguette’s SimulatorKit ABI and device resolution (Apache-2.0); its source and `native/build.sh` accompany the ad-hoc signed Apple Silicon binary. It waits for every delivery completion, releases keys on partial failure, refuses a foreign/default device set and serializes helper access using a per-device lock. It does not restart SpringBoard or extract clipboard/account contents.

## Outbound-domain and execution scan

Source URL scan of all vendor JS/HTML/CSS/JSON identified:

- `nominatim.openstreetmap.org`, `tile.openstreetmap.org`: pre-existing optional location search and map tiles (`sim-location.js`). User-triggered functionality now routed through the autonomous Node worker fixed endpoints; browser requests stay same-origin.
- `fonts.googleapis.com`, `fonts.gstatic.com`: removed from `farm/farm.html`; existing CSS system-font fallbacks are used without font downloads.
- `leafletjs.com`: library attribution; `bugs.chromium.org`, `bugzilla.mozilla.org`: CSS comment references; `www.w3.org`: SVG namespace constant. These are not added runtime API clients.
- `127.0.0.1`: the added clipboard bridge; exact Origin and random capability required, request body capped at 40 KB, no clipboard content logging.

No eval/new Function calls or added executable base64 blobs were found in the nine modified upstream files or first-party Node/native code. Leaflet contains its upstream embedded transparent GIF and CSS assets; no executable payload was added. The full Baguette binary includes more upstream capabilities than the 16 exposed Agent tools: this PR does not claim to audit every native feature by reading JavaScript. Native binary and new plugin admission require maintainer review; the runtime’s own private-framework ABI is not a stable Apple API.

The plugin declares Node and loopback preview, uses fixed executable paths and argument arrays (never shell interpolation), no managed credentials, and launches Baguette with `--no-plugins`. Simulator apps retain their own network/auth state; App input may still trigger external actions. No command download occurs at runtime. Dependency licenses from the upstream tag’s Package.resolved (including build/test-only packages) and Leaflet 1.9.4 are reproduced in THIRD-PARTY-LICENSES.txt.

## Known limits and verification boundary

Native WebSocket disconnect SIGABRT remains an upstream issue; recovery is bounded mitigation. Worker shutdown also stops the controller. Browser session ownership is separate from persistent simulator data. Tests cover the bridge and real iOS 27 native input during the local trial, but those tests are not an attestation that this official candidate was installed in Cindy. Record the final package’s installed-client verification separately before submitting a Ready PR.

The proxy bootstraps an HttpOnly SameSite=Strict capability cookie only from a token-authenticated control request. All proxied viewer HTTP, map and WebSocket routes require it; credentials are stripped before HTTP forwarding. The empty controller shell is public so its fragment can authenticate. This protects the proxy, not against same-user processes that can access CoreSimulator or the upstream Baguette loopback listener directly. Manual restart excludes only the retired child from crash accounting.

Minimum OS evidence: `xcrun vtool -show-build` reports `LC_BUILD_VERSION minos 15.0` for both bundled Baguette and native/keyboard. The worker checks `/usr/bin/sw_vers -productVersion` before launching either binary and rejects older or unrecognized versions with UNSUPPORTED_OS.
