# Cindy Chrome Web Store assets

[简体中文](README.zh-CN.md)

The store materials submitted with Chrome extension **0.4.60** on **2026-10-30**.
Open [index.html](index.html) locally to browse both languages, copy, and promotional images.
This directory is repository documentation, outside the `my-browser/` plugin package.

## Upload set

| File                                | Purpose                                                             | Dimensions |
| ----------------------------------- | ------------------------------------------------------------------- | ---------- |
| `assets/store-icon-128.png`         | Store icon, existing Cindy Chrome artwork with padding              | 128 × 128  |
| `screenshots/en-1.png` … `en-5.png` | Global screenshots, in numeric order                                | 1280 × 800 |
| `assets/promo-small.png`            | Small promotional tile                                              | 440 × 280  |
| `assets/promo-marquee.png`          | Marquee promotional tile                                            | 1400 × 560 |
| `copy/global-description.txt`       | Exact submitted description, English followed by Simplified Chinese | Text       |

The dashboard for this submission exposed a single global listing with at most five screenshots.
The five `zh-CN` images are localized alternatives, **not additional uploaded screenshots**.
The separate descriptions remain editable in `copy/`; `*-summary.txt` are proposals for a future
manifest change and were **not uploaded**. The installed extension's icons and manifest remain unchanged.

[`submission.json`](submission.json) records the historical submission: pending review at
2026-10-30 07:25 UTC, automatic publication selected, previous live version 0.4.22.
It is not a live status feed. [`asset-manifest.json`](asset-manifest.json) records PNG dimensions,
SHA-256 hashes, and the exact uploaded set. Private account details and dashboard receipts are omitted.
Merging this directory does not upload or submit anything to the Chrome Web Store.

## Sources

- Icon: the existing `my-browser/assets/icon-source/plugin.svg` and `my-browser/assets/icon.png`,
  archived in `assets/`. The store adaptation uses 96 × 96 artwork with 16-pixel transparent padding.
- Slides 1 and 3: actual extension UI rendered against an original sample article and fixed local
  translations. `source/` preserves the input captures; `build.mjs --capture-ui` retains the fixture
  and capture procedure. It does not contact Cindy or an AI provider, or submit a task.
- Slide 2: labeled example instructions, not claimed completed tasks.
- Slide 4: original AI-generated space kitten/pancake illustration, with manually composed bilingual
  subtitles and a generic player. The slide labels this as an AI-generated example. The source image
  is `assets/video-space-breakfast.png`; the built-in image generation prompt is in
  `source/video-generation-prompt.txt`. No third-party video frame is included.
- Slide 5: actual extension options UI with optional permissions disabled, using local mock state.

The original captures used extension 0.4.60 from commit
`2bf3f8227d5dbfde81788424ab1a1d09dbf91aeb`. The eight relevant UI source files were compared with
the uploaded ZIP before submission. This is visual/material verification, not an end-to-end test
of browser assistance or model output. Existing repository licensing and trademark terms apply.

## Render and verify

Prerequisites: Node.js 22 or later. The local renderer pins `playwright-core` in its lockfile.

```sh
cd docs/chrome-web-store
npm ci
npx playwright-core install chromium
npm run verify
npm run render
```

The renderer uses archived input captures by default and writes to the ignored repository
`.build/chrome-web-store/` directory, preserving the submitted files here. It also writes editable
HTML layouts for all ten slides and both promotional tiles. Copy and the gallery live here; layout
text and styles live in `build.mjs`. To use an already installed Chromium, set
`CHROME_EXECUTABLE_PATH` to its executable path instead of installing the bundled browser.

To deliberately refresh sample UI against the current checkout:

```sh
npm run render -- --capture-ui
```

`EXTENSION_SOURCE` can point to another checkout's `my-browser/extension` directory. The capture
option uses that source as-is: a newer extension may change layout or behavior. For the original
UI, use the source commit recorded above. Rendering uses system fonts; the submitted images were
produced on macOS with SF/PingFang. Other fonts/platforms may produce different pixels or wrapping.
Review both languages before promoting regenerated files into this archive or uploading them.

`npm run verify` checks committed PNG hashes/dimensions, upload color format, the complete upload
set, and local gallery links. After an intentional asset change, update the manifest hashes and
submission record for the new set. Keep past submission facts dated; do not imply fresh approval.

Store size reference: [Chrome Web Store images](https://developer.chrome.com/docs/webstore/images).
