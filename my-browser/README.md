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

Settings makes ZIP installation the primary Chrome/Edge route: open the extensions manager and ZIP location, enable Developer mode, then drag the ZIP onto the page. No unzip or directory selection is needed. Connection checks are automatic; opening a page is not installation success. Directory loading remains a fallback. Manual ZIP dropping in official Chrome still needs real-device verification and may be blocked by managed browser policy.

Safari still requires a store release or signed/notarized app, neither configured yet. Chrome/Edge ZIP installation does not depend on store publication. Unknown extension identities still require real Cindy pairing confirmation. After updates, drag the new ZIP again; directory installations use Reload. Keep only one copy.

Installation cards appear only for connected browsers or installed browsers with a deliverable ZIP/store route. Unpublished Safari and browsers absent from this device are hidden, with no coming-soon placeholder.

## Security and limitations

- New installations allow reading and interaction on all public websites. Saved restrictions are preserved until explicitly removed in settings: old policies lack provenance, so matching the legacy preset does not prove user intent; the all-sites switch enables broad interaction, while read blocks and interaction exclusions still take precedence. Domain grants include subdomains; `=host.example.test` is exact-only. New grants/unblocking require real confirmation; cancellation changes nothing.
- Only `127.0.0.1:18810–18819` is bound. HTTP cannot enqueue work or modify policy. Host, extension origin, profile identity and current bridge session are checked; no CORS. Unknown extension identities get no session/jobs before approval. This is browser-origin protection, not a defense against malicious same-user native software or already-trusted extensions.
- Jobs and acknowledgments/results are bound to one profile. Delivered actions are never replayed. `execution:executed` proves DOM dispatch, not successful sending/purchase; `unknown` requires checking before repetition.
- No cookie export, arbitrary JS tool, debugger or credential extraction. Hidden/password/payment-code fields are excluded, but arbitrary page text may still contain private information. AI may receive this data off-device. Visits/reads contact websites and may affect server-side notification read state.
- Public-looking hostnames are insufficient: before reading or acting, the extension requires a public peer IP reported by `webRequest` for the current main document, correlates navigation/request timestamps, and targets that exact `documentId`. Private/missing addresses, unobserved older tabs and ambiguous navigation evidence fail closed with `ADDRESS_UNVERIFIED`; tab metadata is redacted. No automatic refresh or replacement tab is attempted. A manually refreshed public page can supply new evidence. Cache/proxy/browser configurations that cannot provide public peer evidence are unsupported for that page. This prevents extraction from private main documents; it is not a network firewall: navigation may already have contacted the destination, and arbitrary page content can originate elsewhere. `webRequest` and `webNavigation` observe main-document address/identity only; no cookie/header capture.
- At most three background tabs per profile, reclaimed after ten idle minutes. User-owned/focused/navigated tabs are not reclaimed. Safari without session storage keeps the ownership ledger in memory rather than persisting tab ids across browser restarts.
- Refs are isolated-world Element maps, not page-writable attributes, and expire on navigation/new snapshots. Synthetic keys/hover may be ignored. No cross-origin frames or closed Shadow DOM. Form submission uses one mechanism only.
- Text/record values default to a 6000-character budget; JSON/link overhead is additional. Tabs default to 20, max 100, with an additional aggregate budget. Overlong tab URLs are not exported. A timeout/empty shell is not proof of no results.

## Build and verification

First-party JS and Node built-ins only. No runtime dependency installation. `node/worker.cjs` activates unconditionally because Cindy requires the entry rather than running it as `require.main`. Runtime subprocesses are restricted to fixed browser/app launchers and Safari signature checks.

```sh
python3 scripts/package-my-browser-zip.py
node scripts/validate-plugin-manifest.mjs ./my-browser
node --test .tests/my-browser.test.mjs .tests/my-browser-multibrowser.test.mjs .tests/my-browser-tabs.test.mjs .tests/my-browser-policy-sync.test.mjs
PLAYWRIGHT_CORE=/absolute/path/to/playwright-core node --test .tests/my-browser.browser.test.mjs
# macOS build host with Xcode; fresh output directory (existing builds are never overwritten)
node scripts/build-my-browser.mjs /absolute/output/directory all
```

The builder creates Chrome/Edge store ZIPs and a Safari Xcode project/universal app. Without signing credentials, it clearly labels the Safari artifact **not consumer-ready**. Optional `MY_BROWSER_SIGN_IDENTITY` and `MY_BROWSER_DEVELOPMENT_TEAM` enable signing; `MY_BROWSER_NOTARY_PROFILE` names an existing Apple notarytool keychain profile for notarization. No credential values belong in source, plugin settings or artifacts. Only after successful notarization/assessment copy the output `native/` into the plugin for packaging. Signing/notarization paths are not verified on this machine because it has zero available signing identities.

2026-09-15 local evidence:
- Manifest, 55 Node/HTTP/localization/provisioning/workflow tests plus the isolated Chromium integration suite passed (56 total).
- Real Chromium suite covers read/extract/interaction, waiting for hydration, one-call X-shaped fixture extraction, cursor bounds, stale refs, denial/revocation, redirects, tab cleanup, popup, pairing cancellation/persistence, settings failures and 330px layout.
- X-shaped **fixture**, not a real X latency claim: 5 records in 1 read call, 714ms, 792 bytes of result JSON in the recorded run.
- Safari universal Release build succeeded. No Safari signature, notarization, App Store release or real Safari runtime claim.
- Installed Cindy is 0.1.82; minimum remains 0.1.64 (Manifest v3). Manual support predates that minimum (first containing stable tag v0.1.48).
- Previous 0.2.0 real Cindy/everyday Chrome checks passed for example.com and the user's X notifications; interactions remained denied. 0.3.0 was subsequently installed in Cindy and reloaded in everyday Chrome: the real signed-in X mentions page returned 5 structured replies in one call (bridge total 4329ms, including 1785ms readiness wait). A second incremental read found its anchor and returned zero preceding rendered rows in 22ms; this is not a fresh-network or all-notifications completeness claim. The installed on-demand manual was also read successfully. Existing site permissions were preserved.

0.3.1 fixes repeated tab creation after redirected load timeouts, lost aliases after focus, and eviction that discarded bookkeeping without closing the actual tab. Protected tabs stay counted; unexpected navigation and exhausted capacity stop with non-retryable errors. Five regression tests plus the real Chromium redirect-retry test cover these paths.

0.3.8 closes a permission-ordering race found in review: `sync()` read the stored policy and applied it to the worker in two separate steps, so a settings save landing between them could be overwritten by the stale snapshot, leaving a site the user had just revoked actionable until the next sync. Reading and applying now share one critical section with `save()`. Two regression tests exercise the real `main.js` orchestrator with stubbed host APIs: one stalls a sync between the read and the apply, lets the save overtake it, and asserts the revocation both survives in storage and stays denied for later tool calls; the other checks concurrent saves and tool calls neither fail nor deadlock. Both fail against the pre-fix `sync()`.

A packaged ZIP can also be dragged onto Chromium's extensions manager as a developer-install alternative to selecting a directory. Browser developer-mode/policy requirements still apply; this is not a store-signed release or an automatic-update promise. Chromium's implementation supports this path; this machine's official Chrome ZIP-drop flow has not yet been verified. A self-packed CRX may be blocked rather than merely showing a dismissible warning.

Provisioning retains an empty staged audience. No marketplace admission, store submission, push, PR or public release is implied. The four HEAD-based package-contract tests also passed against the committed snapshot containing the new plugin and provisioning entry.

Review regressions: public hostname served by a real loopback fixture returns no DOM/title; positive fixture IPs are simulated at the browser API boundary in the isolated Chromium suite. Navigation/reload identity, late responses and unknown address paths are covered by unit tests.

## Runtime source evidence

`node/worker.cjs` is the reviewed first-party source entry, shipped byte-for-byte without transpilation or a separate generated/vendor copy. Its dependency graph is `worker.cjs` → `node:readline`, `node/bridge.cjs`, `node/installation.cjs`, `extension/policy.js`; these require only Node built-ins and the bundled manifest/distribution JSON. There is no external package name/version or upstream binary to reconstruct. `.github/scripts/package-plugin.sh my-browser <output.cindy>` packages the committed source; compare the extracted entry with `git show HEAD:my-browser/node/worker.cjs` to verify provenance.

Network/launch inventory: the worker creates only a loopback HTTP listener on 18810–18819; the extension polls those exact ports. Website navigation is HTTP(S) for the requested browser task. Installation opens fixed extension-manager URLs, bundled files, or configured store URLs validated against `chromewebstore.google.com`, `microsoftedge.microsoft.com`, `apps.apple.com`; the current store URLs are unset. Installation/signature checks use fixed executables and argv, not shell commands. Source inspection found no eval/Function/string-code execution or Math.random; the only base64 runtime decode is the public extension identity key. Loopback contract approval and bridge authentication remain unresolved review items; this evidence does not waive them.

Status tool output explicitly selects connection and installation fields; local paths, policy and pairing-origin details stay in the settings response. Extract attributes are limited to href/src/datetime/title/alt/aria-label/role before dispatch. Arbitrary token attributes are rejected, but site text and links can still contain private information.

Read failures after starting navigation report `execution: unknown`: the website may already have received the visit. A lost acknowledged read also reports unknown; jobs that expire before acknowledgement remain not executed.
