# Cindy Ping

Give the cat a poke to ping Cindy. What you’re looking at and what you want done go along with it, and Cindy takes it from there. Currently supports macOS 14+ only.

A configurable desktop emote wheel for **macOS 14+ (Apple Silicon and Intel)** and **Cindy 0.1.114 or later**. Hold a shortcut, point at an emote, and release. Start with display-only reactions, then connect individual emotes to projects, conversations or companions. Windows and Linux are not supported. There are no third-party runtime dependencies.

## Use

Import the generated `.cindy` package into Cindy and enable Cindy Ping in plugin details. Settings apply immediately. Record a modifier, single key or combination; the default is `Command + G`. **Press to open the wheel at the pointer, hold while moving, and release the shortcut to send and close. No click or drag is needed.** The centre, Escape, right-click or moving beyond 240 points cancels. Selection is retained just outside the visible wheel. Other key combinations cancel the current wheel; a letter/digit single-key binding reserves that character while enabled.

Recording temporarily suspends wheel input. Escape, loss of focus or timeout cancels recording and restores it. Use the selected key to apply it immediately. Accessibility is required for the input hook, including display-only use. This plugin only checks existing access and never requests separate system authorization. After updating Cindy to a build with permission sharing, disable and re-enable the plugin in Cindy, then refresh its status.

Configure at least four emotes with no fixed maximum, using emoji or local PNG/JPEG/GIF/WebP images. Click a wheel slice to configure it, drag to reorder, and use its Pin/delete controls. Pin preserves its angle. Use the centre + and move to choose an insertion position. Local images are referenced, not copied: keep the original files. Animated files use the image frame decoded by macOS; animation playback is not guaranteed. Each emote appears immediately and owns its lifetime; optional task actions wait two seconds after the last trigger. Settings follow Cindy's language; Japanese and Korean settings use the documented English fallback.

Actions:

- **Display only**: no capture, model call, task or message. Also discards the previous pending action.
- **Create task**: choose a model, reasoning effort and supported Fast option per emote, or inherit the plugin default. Choose a project each time or bind a fixed project. Permissions follow plugin Task settings.
- **Add context to a task**: select any available local ordinary task each time, or bind a fixed task. The recipient keeps its model, permissions and directory.
- **Send to a companion**: choose each time or bind a fixed active companion; delivery resolves the canonical conversation and preserves its settings.

The editor groups actions into Display and Send to. Display also cancels the previous pending action during its 2-second wait, explained by a short tip. Completed effects are not rolled back. The wheel keeps at least four emotes: clicking Delete at that limit explains why; above four, deletion works directly. Send presets include three recent conversations or companions, choosing each time, fixed conversations or companions, and new conversations in a selected or fixed project. Fixed targets are chosen in the Cindy plugin settings panel, with optional name/directory filtering and no separate native window. A stable `{kind,id}` is stored and resolved on each trigger; unavailable targets are never replaced automatically.

Selecting an emote with a dynamic destination immediately reveals up to three options inside its wheel sector. Scroll to page through a full list. Cindy supplies the activity order; candidates are queried and frozen for each wheel opening, never reordered in an open wheel or chosen automatically. Fixed and local actions do not expand. Releasing without a required destination, before loading finishes or with no available targets sends nothing. The wheel is about 228 points across, shows only emotes at the first level and keeps the opening pointer as its centre.

New-task models remain configurable per emote. The searchable picker groups models by provider, displays source logos and can filter Claude Code, Codex or Pi, with compact reasoning and Fast controls. Hidden models are collapsed initially, while the current selection stays visible. Selecting the current model again preserves valid tuning; reselecting a model with unsupported settings restores its current defaults. Existing tasks and companions retain their own model, directory and permissions. `showTaskPreferences:false` hides the duplicate host card; the task capability and host-managed defaults remain available, with all permission checks intact.

For task and companion destinations, each emote also chooses **Queue** (the default) or **Insert now**. Queue waits until the recipient is ready; Insert now adds context to its running turn without stopping it. If insertion is unavailable, Cindy queues the input and the status shows the actual delivery mode. When idle, normal queued input can start immediately. Screening rejection never retries through the queue; an uncertain insertion stays paused for inspection rather than sending another copy. Existing emotes without this setting retain queue behavior. Legacy owned-task bindings keep their original API and queue behavior; select a destination mode to use the new delivery setting.

The host API is `cindy.targets.list/resolve/send/cancel`. Both `agent.tasks:true` and the independent `agent.targets:true` are declared; Cindy enforces its destination capability checks independently of owned-task access. The plugin checks the actual API and image capabilities before use. Unsupported clients stop with a clear message rather than using private IPC or changing receivers. Existing emotes without `target` keep their owned-task API, task bindings, explicit models and directory behavior. No migration silently changes the destination.

New installations start with Help me out, Verify, Find ideas, and a dedicated Undo cat emote. All four display only; Undo retains its own cat image. Every display-only emote cancels the previous pending action. Legacy undo settings normalize to display-only without changing images, names or positions. Eleven cat images are available. The library contains no prompt templates, and adding an emote or changing its action never fills instructions automatically. Write your own instructions to enable task actions. Image replacement preserves your settings. Updates convert untouched factory task prompts to display-only and replace the fourth untouched factory slot with Undo, retaining the shortcut and positions. User-authored instructions, fixed destinations, explicit models and custom wheels are preserved. Both built-in and custom images start as display-only when added.

Each trigger pops the emote immediately, settles through a 460ms spring with two expanding ripples, and fades after 2 seconds. The system Reduce Motion preference skips the spring and ripples. Actions wait until both two seconds after the last trigger and target selection are complete and can incur model costs. If task access is denied, change the action to display-only.

## Capture and cancellation

Once both the two-second delay and target selection are complete, close the plugin picker and read bounded accessibility content and optionally capture the original target window. Capture is not a historical screenshot of the instant the emote appeared. The helper never reads the clipboard or records continuously. Permissions are checked without prompting; unchecked is distinct from denied. Client change #6029 launches macOS Node workers with `disclaim: false`, allowing their child processes to use Cindy's TCC responsibility. The plugin starts its bundled helper directly from that worker and provides no separate permission-request buttons or native permission-request calls. If access is unavailable, it reports the missing capability instead of requesting authorization. Native compilation alone does not verify system-permission access in an installed client. Either material can be missing, with the reason recorded. Password fields are skipped by the accessibility reader; screenshots can still contain anything visible in the chosen window.

The original window is identified immediately **after** the emote is displayed. ScreenCaptureKit captures that exact window, excluding the emote and picker. If the window is closed, it does not switch to another app or capture the whole desktop. Text selection must belong to the same target window; nearby text is bounded rather than a complete browser DOM scrape.

Screenshots are sent as image attachments through Cindy's existing managed-media and message pipeline, for both new destinations and legacy owned-task bindings. Window text, source-window details, capture time, missing fields and cursor position go directly in the message body. No capture folder, `context.json`, temporary screenshot path or separate media-deposit permission is needed. The client must advertise `tasks.capabilities().messageAttachments` with image support; otherwise screenshot delivery stops with an explicit update message. Images are visible in message history and included in model input for queue and same-turn delivery. No screen contents are written to plugin KV or diagnostic logs. Unadopted images follow Cindy's existing media reclamation rules.

Every trigger replaces one global pending action. Stale capture results are dropped. Legacy inputs are cancelled by their own `runId`. New destination inputs withdraw only their host-generated queued input; an already running turn is not forcibly stopped. This includes late receipts; the plugin never stops an entire task or someone else's input. Completed side effects cannot be undone. If cancellation or dispatch is unconfirmed, automatic delivery pauses and requires inspection in Cindy; no automatic resend or new request key bypasses an ambiguous result. Restart never replays old work.

## Development and package

The JavaScript and `node/*.cjs` files are handwritten plugin source, not a vendored bundle. No third-party runtime libraries are included.

Run `node scripts/build.mjs` on macOS with Xcode Command Line Tools. It compiles arm64 and x86_64 helpers targeting macOS 14 and applies a local ad-hoc signature. The bundled helper is ad-hoc signed, not separately notarized. It runs as a child of Cindy’s Node worker, without a separate app launch. Source is in `native/EmoteHelper.swift`; the installed package does not need Swift or Node installed separately.

`npm run check` checks JavaScript syntax. `node scripts/stage.mjs` stages only runtime files under `build/package`. Use Cindy `ghost_forge_pack` on that directory. Packing does not install or publish the plugin.

Native helper and shortcuts exit when the worker's input closes, or when Cindy stops the plugin. Disable the plugin in Cindy to release input hooks while retaining configuration. The official repository packages the committed plugin directory with its root license and trademark notices.

Reference: [Cindy](https://github.com/makecindy/cindy), [ScreenCaptureKit window filter](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(desktopindependentwindow:)). [lolPing](https://github.com/darrenprx/lolPing) inspired the interaction; no code or League of Legends assets are copied.

Run `node --test .tests/cindy-ping.test.mjs` from the repository root for isolated scheduler, configuration and delivery regressions. These checks do not launch Cindy or send real messages. Native compilation and mocked checks do not replace real-device verification.

The icon and eleven cat emotes are original illustrations generated for this plugin, not bundled emoji fonts or copied game assets. The emotes use lossless WebP at their original 1254 × 1254 resolution; all decoded RGBA pixels match the earlier PNG assets. Existing built-in PNG references are mapped to the corresponding WebP without changing instructions or destinations. Custom image paths are unchanged. No image decoder is bundled; Cindy and macOS decode the assets.

## Agent configuration

Use `get_config` for the full configuration and revision, and `list_targets`/`list_models` for exact identifiers. Submit only the requested edits within the complete config through `configure({revision, config})`. The tool and settings page share validation, revisions and a serial queue. A stale settings page cannot overwrite a newer Agent edit. Saving never displays an emote, captures content or sends a message. A stale snapshot returns `STALE_REVISION`; read again before editing. Per-emote actions, destinations, images, instructions, models, delivery, angles/Pin and the shortcut are configurable. Preserve unrelated fields; new entries should be display-only with an empty prompt, at least four entries and unchanged pinned angles.

The plugin omits `command`, so it has no standalone chat entry. Agents can still discover its tools and configure it from an ordinary conversation.
