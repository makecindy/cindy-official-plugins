# Test Environments

Use `catalog` first. Choose the exact project, account reference and profile. Inspect
`plan` before `start`. Only execute within the user's authorized project/device scope.
The plugin runs on the computer hosting it, including when viewed from another device.

## What is stored

Projects, named account references, launch settings and ordered acceptance cases live
outside the plugin package in the current user's Test Environments application-data
directory. CLI and Cindy use the same catalog. Uninstalling or updating the plugin
does not remove this catalog or app login. `remove` removes a catalog entry only.

Credentials remain in each application's isolated profile/secure storage. Never put
passwords, cookies, tokens or copied production credential files in catalog fields,
command arguments, case steps, logs, or tool input. An account selector names an
application-managed account; it is not a token vault or an authentication bypass.
Initial login and expired authorizations use the application's ordinary login.
Changing an account reference's identity requires a new reference.

## Cindy

Add a source checkout using adapter `cindy`; `import_cindy` imports only public local
dev account aliases. Save persistent isolated names for desktop profiles. Keep the
same name to reuse that profile's own valid login and data. Different accounts may
have different isolated names. `mode:legacy` supplies no new acceptance arguments
and preserves original startup/sign-in behavior. `mode:acceptance` requires a
checkout supporting `scripts/lib/dev-acceptance.mjs`; use the existing WIP checkout
until those project changes are released. This does not require updating the Cindy
application hosting this plugin.

Acceptance options: account, region, remoteControl, background, fixture, loginSource,
serveLogin. Use remoteControl/off and background/off for quiet acceptance profiles.
A login source for a fresh device requires the application's supported authorization
service; the plugin does not bypass that service. Existing local login is reused.
An authenticated source may be a different configured profile, managed separately.

## Other projects (Filo, Electron, native or Linux)

Use adapter `command`, root as an absolute project path and commands as argv arrays:
`{"start":["node","scripts/dev.mjs","--profile","{profile}","--account","{account}","--data-dir","{dataDir}"]}`.
Supported substitutions: profile, account, isolated, fixture, remoteControl,
background, platform, dataDir. Configure optional prepare/verify commands using the
project's own documented interfaces. No implicit shell is used. Parameters only
work when the target project actually implements them; do not invent project flags.
The adapter does not transform authentication formats between applications.
Node, Python 3 for the macOS desktop terminal, and each project's toolchain must already be installed on the execution computer.
macOS is currently runtime-tested; Windows/Linux behavior needs platform validation.

## Execution and recovery

`start` returns a jobId immediately. Query `status`; do not repeatedly start while a
build/sign-in is pending. Runs survive the plugin Worker's idle timeout. A Cindy
ready receipt is distinct from a custom command merely running or exiting zero.
`waiting-for-owner` preserves the existing app without charging login time to the
startup deadline. Never
report an account test successful from a process-start receipt alone. Acceptance
cases are instructions: the AI executes them with actual tools and reports actual
results; saving a case does not run it.

`stop` targets only the job's own process group and verified app instance, retaining
login/data. Query until stopped. Unknown state requires inspecting the exact recorded
instance before retrying; do not kill broad process patterns. One active launch per
project root avoids the project's own restart scripts replacing an unrelated test.
Private run logs remain locally available; they may contain project output and are
not returned inline by tools. Do not upload them without reviewing/redacting secrets.

## Simulators

For iOS/Android, prepare builds or the project's Metro service here. Read the returned
handoff and use the installed `baguette-simulator` plugin: discover exact devices,
install the actual build, confirm matchesLocal, launch and inspect account/fixtures.
The AI coordinates the two plugins; this plugin does not claim a host-provided
cross-plugin bridge. Android does not receive iOS-only app arguments/environment;
Cindy transports its configuration via the project's Metro configuration. Do not
revive a cancelled owner handoff or a device the user asked to keep stopped.

## Standalone CLI

`node <plugin-source>/node/cli.cjs catalog`

For writes, supply JSON on stdin with `--stdin`, for example:
`node <plugin-source>/node/cli.cjs plan --stdin` with `{"profile":"daily"}`.
`TEST_ENVIRONMENTS_HOME` selects a different catalog for independent tests. The CLI
uses the identical core, without a running Cindy client. Do not place its storage
inside a Git-tracked project or the plugin installation folder.

## Away from the execution computer

Cindy desktop launches use an owned background PTY and the project's exported
`runDesktopRestart` coordinator. Isolation, migration, dependency, asset and
existing-process checks stay in that coordinator; only its final `--wait-ready`
flag is removed because the plugin owns readiness. Removing the flag from the
outer pnpm command is insufficient: that command adds it back internally.
The plugin reads the app's
private startup status and matching instance receipt itself, so its login wait
is independent of the restart CLI's fixed `--wait-ready` deadline. Genuine startup
failure and unexpected exit remain failures with their cause, not a successful stop.
Normal project CLI commands remain unchanged.

Save a dedicated `debugPort` on the desktop profile. `inspect({jobId,screenshot:true})`
checks that the listener belongs to that exact live app before using CDP to read
non-secret login state and capture the app viewport. It does not use screen recording,
Accessibility, Terminal.app or the desktop lock state. It never reads credentials,
cookies, form values or raw login data. The latest image replaces the previous job
inspection image; it is private local user data, and the AI can deliver it through
Cindy's standard media import when requested. No arbitrary debug URL or JavaScript
is accepted. macOS/Linux ownership checks use lsof; Windows is not yet verified.

A locked desktop does not imply a locked credential store. Reuse an already signed-in
isolated app profile first. A missing login remains a separate authentication step;
inspection does not complete sign-in or approve a Keychain dialog. If a project needs
browser authorization, route it through a supported remote authorization flow rather
than repeatedly asking the owner to unlock the execution computer. This version does
not yet provide Cindy's remote sign-in bridge; do not report a waiting job as logged in.

For plugin development use a separate TEST_ENVIRONMENTS_HOME with the standalone CLI.
Do not install/enable an unfinished plugin in the owner's daily host or launch another
plugin host from a target dev instance. Target apps do not need this plugin installed.
