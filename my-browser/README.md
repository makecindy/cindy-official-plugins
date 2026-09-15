# My Browser

[简体中文](README.zh-CN.md)

A local candidate plugin connecting Cindy to your everyday signed-in browser. Version **0.3.0** adds content-first reading, browser/profile-bound routing, a minimal Art-generated icon and browser-specific setup. It is **not yet a publicly distributed consumer release**.

## Reading vs interaction

- Public page: use the host's ordinary public reader; no extension required.
- Signed-in page: `browser_read` directly extracts bounded DOM content. Default `content` returns main text and links; `extract` returns records. Readiness is awaited inside the extension, not through repeated model calls.
- X replies/mentions: `browser_read({recipe:"x_mentions",limit:5,maxChars:4000})` combines destination, waiting, text, author, time and links in one call. No home/menu snapshots, private API tokens or UI clicks. This is the rendered slice, not all history or necessarily unread-only.
- Interaction: request a scoped `snapshot` for fresh refs, then `browser_act` with site authorization. Reading does not require an interaction grant.
- Multiple connected profiles: pass the `browser` connection id; ambiguity returns `BROWSER_REQUIRED`, never a guessed account. Tab listing supports `host` and `limit`.
- `after` returns rows before a previously seen permalink in newest-first lists. `cursorFound:false` and `truncated:true` prohibit completeness claims. No automatic scrolling.

The on-demand workflow manual is `manual/browser/MANUAL.md`. Parameter names and enums remain stable across locales.

## Browser support and installation readiness

| Browser | Code/artifact | Verification and release status |
| --- | --- | --- |
| Chrome | Shared MV3 extension, Chrome 120+ | Real Chromium integration; everyday Chrome 0.2.0 reads verified. 0.3.0 real Cindy/everyday Chrome X extraction also verified. |
| Edge | Shared Chromium extension, separate store artifact and profile routing | Protocol and Windows launcher tests; no real Windows/Edge device verification yet. |
| Safari | WebExtension adapter + generated macOS container app | Universal arm64/x86_64 Release build and identity-pairing tests; no signed consumer installation or real Safari extension execution yet. |

Settings detects installed browsers, offers the appropriate available store/bundled-app route, and polls the actual handshake. A browser opening is **not** installation success. Unknown extension identities require a real Cindy pairing confirmation. Multiple browser installations are not the same as connected profiles.

**Current external blockers:** `distribution.json` has no approved Chrome/Edge store entries or Safari App Store entry, and no signed/notarized Safari app is bundled. Those install buttons explicitly show publisher release required. Do not mistake this for a finished zero-directory consumer installation.

For release, provide approved store ids/URLs in `distribution.json`, or bundle the signed/notarized Safari app at `native/My Browser.app`. The Safari button verifies it with macOS `codesign` and `spctl` before launching. Required browser/user consent is never bypassed. No executable is downloaded at runtime.

Developer directory loading is hidden in **Developer options**. Buttons open the selected browser's extension manager and reveal the packaged directory; this is explicitly a testing fallback, not the consumer flow. Existing local extensions must be reloaded after plugin updates. Do not disable security policies or enable unsigned Safari extensions for ordinary users.

## Security and limitations

- Read-default-allow, sensitive-site blocklist (not exhaustive), interaction-default-deny. Domain grants include subdomains; `=host.example.test` is exact-only. New grants/unblocking require real confirmation; cancellation changes nothing.
- Only `127.0.0.1:18810–18819` is bound. HTTP cannot enqueue work or modify policy. Host, extension origin, profile identity and current bridge session are checked; no CORS. Unknown extension identities get no session/jobs before approval. This is browser-origin protection, not a defense against malicious same-user native software or already-trusted extensions.
- Jobs and acknowledgments/results are bound to one profile. Delivered actions are never replayed. `execution:executed` proves DOM dispatch, not successful sending/purchase; `unknown` requires checking before repetition.
- No cookie export, arbitrary JS tool, debugger or credential extraction. Hidden/password/payment-code fields are excluded, but arbitrary page text may still contain private information. AI may receive this data off-device. Visits/reads contact websites and may affect server-side notification read state.
- URL-level local/private literal filtering is not a DNS firewall. Redirects and current policy are rechecked; navigation may already have contacted a redirected host.
- At most three background tabs per profile, reclaimed after ten idle minutes. User-owned/focused/navigated tabs are not reclaimed. Safari without session storage keeps the ownership ledger in memory rather than persisting tab ids across browser restarts.
- Refs are isolated-world Element maps, not page-writable attributes, and expire on navigation/new snapshots. Synthetic keys/hover may be ignored. No cross-origin frames or closed Shadow DOM. Form submission uses one mechanism only.
- Text/record values default to a 6000-character budget; JSON/link overhead is additional. Tabs default to 20, max 100, with an additional aggregate budget. Overlong tab URLs are not exported. A timeout/empty shell is not proof of no results.

## Build and verification

First-party JS and Node built-ins only. No runtime dependency installation. `node/worker.cjs` activates unconditionally because Cindy requires the entry rather than running it as `require.main`. Runtime subprocesses are restricted to fixed browser/app launchers and Safari signature checks.

```sh
node scripts/validate-plugin-manifest.mjs ./my-browser
node --test .tests/my-browser.test.mjs .tests/my-browser-multibrowser.test.mjs .tests/my-browser-tabs.test.mjs
PLAYWRIGHT_CORE=/absolute/path/to/playwright-core node --test .tests/my-browser.browser.test.mjs
# macOS build host with Xcode; fresh output directory (existing builds are never overwritten)
node scripts/build-my-browser.mjs /absolute/output/directory all
```

The builder creates Chrome/Edge store ZIPs and a Safari Xcode project/universal app. Without signing credentials, it clearly labels the Safari artifact **not consumer-ready**. Optional `MY_BROWSER_SIGN_IDENTITY` and `MY_BROWSER_DEVELOPMENT_TEAM` enable signing; `MY_BROWSER_NOTARY_PROFILE` names an existing Apple notarytool keychain profile for notarization. No credential values belong in source, plugin settings or artifacts. Only after successful notarization/assessment copy the output `native/` into the plugin for packaging. Signing/notarization paths are not verified on this machine because it has zero available signing identities.

2026-09-15 local evidence:
- Manifest, 30 Node/HTTP/localization/provisioning/workflow tests passed.
- Real Chromium suite covers read/extract/interaction, waiting for hydration, one-call X-shaped fixture extraction, cursor bounds, stale refs, denial/revocation, redirects, tab cleanup, popup, pairing cancellation/persistence, settings failures and 330px layout.
- X-shaped **fixture**, not a real X latency claim: 5 records in 1 read call, 714ms, 792 bytes of result JSON in the recorded run.
- Safari universal Release build succeeded. No Safari signature, notarization, App Store release or real Safari runtime claim.
- Installed Cindy is 0.1.82; minimum remains 0.1.64 (Manifest v3). Manual support predates that minimum (first containing stable tag v0.1.48).
- Previous 0.2.0 real Cindy/everyday Chrome checks passed for example.com and the user's X notifications; interactions remained denied. 0.3.0 was subsequently installed in Cindy and reloaded in everyday Chrome: the real signed-in X mentions page returned 5 structured replies in one call (bridge total 4329ms, including 1785ms readiness wait). A second incremental read found its anchor and returned zero preceding rendered rows in 22ms; this is not a fresh-network or all-notifications completeness claim. The installed on-demand manual was also read successfully. Existing site permissions were preserved.

0.3.1 fixes repeated tab creation after redirected load timeouts, lost aliases after focus, and eviction that discarded bookkeeping without closing the actual tab. Protected tabs stay counted; unexpected navigation and exhausted capacity stop with non-retryable errors. Five regression tests plus the real Chromium redirect-retry test cover these paths.

A packaged ZIP can also be dragged onto Chromium's extensions manager as a developer-install alternative to selecting a directory. Browser developer-mode/policy requirements still apply; this is not a store-signed release or an automatic-update promise. Chromium's implementation supports this path; this machine's official Chrome ZIP-drop flow has not yet been verified. A self-packed CRX may be blocked rather than merely showing a dismissible warning.

Provisioning retains an empty staged audience. No marketplace admission, store submission, push, PR or public release is implied. The four HEAD-based package-contract tests also passed against the committed snapshot containing the new plugin and provisioning entry.
