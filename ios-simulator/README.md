# iOS Simulator Manual migration

Plugin `1.1.4` uses Manifest v3 with `iosSimulator: true` and moves its complete
workflow guidance from the user-level Skill contribution to a bundled Manual.
It declares no plugin tools, network, Node worker, or additional permissions.
The omitted `kind` still normalizes to `chip`; identity, entry, icon, launch
mode, and four-language catalog copy are preserved.

## Minimum Cindy version

`minCindyVersion: 0.1.83` is the minimum supported Cindy version for this
Manual-only release. It prevents older clients from receiving a package that
requires the no-tools Manual discovery and reading support described below.

- [Cindy v0.1.64](https://github.com/makecindy/cindy/releases/tag/v0.1.64) is
  the first stable release with Manifest-v3 support. Its manifest contract
  supports `iosSimulator` and `manual`, but this alone does not make a
  Manual-bearing plugin without tools discoverable.
- Cindy [PR #4440](https://github.com/makecindy/cindy/pull/4440) fixed no-tools
  Manual discovery and reading and was merged to `main` on 2026-09-15 as
  `b201f1f663a1199c1e296ee0b6ddca7d465d4e9d`. It keeps `ghost_call` unavailable
  for plugins without tools while allowing roster, `ghost_info`, and
  `ghost_manual` access.

Clients below the declared minimum continue receiving the newest compatible
historical release from the marketplace. That historical release retains the
Skill, so this package does not need a transition copy. This package removes
the `skill` declaration and `skills/` directory and exposes only the Manual on
compatible Hosts.

## Manual layout

`manual.items` is a lightweight top-level index. Read the workflow with
`ghost_manual({ ghost_id: "ios-simulator", path: "ios-simulator" })`.
`manual/ios-simulator/MANUAL.md` directly links to `build-and-run.md` and
`external-fallback.md` with full logical-path calls. These pages contain plain
Markdown without Skill frontmatter. Runtime tool contracts remain in the live
`cindy_ios_simulator` catalog; do not invent `ghost_call` tools for this plugin.
The catalog localization contract has no Manual translation field; existing
zh-CN/en/ja/ko catalog text remains unchanged and the operational Manual is
English.

## Production verification

Production acceptance for this migration was completed on 2026-09-16 with the
packaged `.cindy` installed in the official signed Cindy CN 0.1.83 client on a
real Mac, using an isolated data directory. The author confirmed the tested
client's stable-release status. Artifact identities and detailed results are
recorded in [PR #111](https://github.com/makecindy/cindy-official-plugins/pull/111).

- The installed, enabled plugin appeared in the roster and `ghost_info`.
- `ghost_manual` read the root index, entry, and both child pages.
- `ghost_call` returned `TOOL_NOT_FOUND` because the plugin declares no tools.
- Without injecting or reading the old Skill, the Host-owned embedded viewer,
  build, install, launch, screen reading, click, text input, and submission
  workflow passed. This covered WDA/JPEG and WDA input compatibility mode;
  Native H.264/HID, external fallback, and broad regression were not covered.

For future package changes, install the exact `.cindy` on a real device running
stable Cindy at or above `minCindyVersion` and exercise its core functionality
before attesting production verification in the PR.

Run the four repository gates, `.tests/ios-simulator.test.mjs`, and
`node scripts/validate-plugin-manifest.mjs ./ios-simulator` from the repository
root. The repository packager uses committed `HEAD`; inspect the resulting
archive before installation. Static checks and packaging validate the contract,
not production operation; real-device results remain separate evidence.
