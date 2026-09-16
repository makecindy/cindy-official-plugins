# Baguette Simulator

[简体中文](README.zh-CN.md)

Opt-in Apple Silicon iOS simulator integration using bundled Baguette 0.1.98.
Requires macOS 15.0+, Apple Silicon, Cindy 0.1.83+, full Xcode and an installed iOS runtime. No first-run dependency download.

Use only when the user explicitly selects Baguette. Run `environment` and `devices`, reuse a suitable logged-in device, then `boot` if needed. Build the App with the project’s normal Xcode workflow; use `install_app` and `launch_app` for its already-built Simulator `.app`. `launch_app` opens the current session’s sidebar by default. Check `viewer.previewOpened`; a running process does not prove a visible preview. Reopen an existing device with `open_viewer` after changing sessions.

The controller provides **Recover view** (restart the viewer only) and **Release keys** (key-up events only). Neither operation restarts the simulator or app. Agent recovery uses `press` with `button=release-input`. Unicode paste replaces the simulator clipboard; browser Copy replaces the Mac clipboard. Observe the focused field before input and inspect the result afterwards. Keyboard delivery acknowledgements are not App completion acknowledgements.

Devices live under `~/Library/Application Support/BaguetteCindy/devices`, screenshots under its sibling `screenshots`. No default/Cindy embedded device access or automatic device erasure. Reinstalling the same bundle ID normally preserves App data, but App migrations/logout/server session expiry still govern authentication. Concurrent agents must not interleave operations on one device.

`heal` explicitly restarts SpringBoard and terminates running apps: require user acceptance of that effect. Try releasing stuck keys first. `shutdown` stops the selected simulator but retains its data. `close_viewer` stops streaming, not the simulator.

## Security and limitations

The Node Worker runs with local user permissions. Executable paths and command shapes are fixed; there is no arbitrary shell tool. The controller listens only on 127.0.0.1; clipboard/control requests require a matching Origin, random capability and an opened private device. No account tokens are extracted or copied into Cindy storage. Screenshot analysis may send images to the configured model. Actions inside apps can have external side effects and remain subject to the task’s authorization.

The viewer’s optional location map requests reach OpenStreetMap through the fixed-endpoint Node proxy; see VENDOR-REVIEW.md. The farm page uses local font fallbacks without remote font requests. These features do not synchronize simulator accounts. No background dependency installation occurs.

Known upstream limitation: stream disconnects can SIGABRT on iOS 27. The supervisor restarts at most five times per minute; the independent controller remains available for manual recovery. This is mitigation, not a native crash fix. Worker disable/exit or one hour of tool inactivity stops the controller too; recovery after Worker exit requires Cindy to start it again. Cross-session device data persists, but a browser tab is session-scoped.

## Build and verification

Run `sh native/build.sh` on an Apple Silicon Mac with Xcode. This compiles the included Objective-C source and ad-hoc signs the helper. No dependency download. The upstream Baguette executable is unchanged.

Run the repository contracts and `.tests/baguette-simulator.test.mjs`. Review VENDOR-REVIEW.md, THIRD-PARTY-LICENSES.txt and the proposal [#119](https://github.com/makecindy/cindy-official-plugins/issues/119). Initial provisioning is an empty targeted audience, not all users. Final package installation in eligible Cindy must be recorded separately from direct Node/native tests.

The optional location panel sends search text and requested map tiles to OpenStreetMap through the Node Worker (fixed nominatim.openstreetmap.org and tile.openstreetmap.org HTTPS endpoints). Browser requests remain same-origin; redirects and arbitrary upstream URLs are rejected. No account credentials are forwarded.

The viewer proxy requires a capability session for HTTP and WebSocket access. The controller exchanges its fragment token for an HttpOnly session cookie. This is not a sandbox against processes with the same macOS user permissions or direct access to the upstream Baguette listener.
