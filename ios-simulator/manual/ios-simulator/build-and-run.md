# Build and run within the current session

Use the live `build_app` schema. The Host derives `worktreeRoot` from the current
Cindy session; do not pass `worktreeRoot`, `projectRoot`, arbitrary build-output
paths, or session overrides as tool arguments. The default build source is the
current task's worktree; an explicit `projectDir` selects another local source
without changing that ownership. This directory boundary does not prove Git
checkout identity or sandbox Xcode build scripts. Build only a trusted project:
its scripts run as the current macOS user, may read or modify files outside the
project, and return build output to the Agent.

## Selecting the build project

When the user supplies another local project or worktree directory, pass it as
`build_app.projectDir` if the Host's current tool schema supports that argument.
Use an absolute directory or a path relative to the current task's worktree.
If the user supplies an Xcode container, use its containing project directory
as `projectDir` and select that container with `containerPath`.
`containerPath` is relative to the selected directory (or absolute inside it).

Keep the current task's simulator route. Selecting worktree B from task A changes
the build source, not task or device ownership. Pass `projectDir` on every rebuild
of B: omitting it selects A's directory again. Use the returned `artifactId` for
installation and launch in A; check the artifact's project summary when switching
sources. The summary's fingerprint identifies the directory, not a source revision.
The build uses the task's existing execution permissions; do not add a separate
external-directory approval step merely because the user selected B.

Older Hosts may omit `projectDir` from their schema. Report that this Host needs
an update to build the requested external directory. Do not silently build A,
copy B into A, or use shell commands to bypass the embedded route. Building inside
the current task's directory remains available on those Hosts.

For nested or multiple Xcode containers, pass `containerPath` identifying an
existing `.xcworkspace` or `.xcodeproj` directory inside the selected project directory.
Prefer a project-relative path. An absolute path is allowed only when its
resolved target is still inside that directory; `..` or symlink traversal must
not escape it. Select a shared `scheme` from the Host's reported choices when
needed. Do not guess an external checkout or change the task's working directory
to bypass a path rejection.

## Build, install, and observe

1. Call `build_app` on the current Host route. On `AMBIGUOUS_XCODE_PROJECT`,
   select the intended in-project container or shared scheme from the returned
   choices before building again. On `INVALID_ARGS`, `INVALID_ARGUMENT`, or
   `PROJECT_NOT_FOUND`, correct the input within the same boundary; never bypass
   the rejection with shell or `simctl`.
2. On a failed build, use `read_build_diagnostics` with the Host-returned
   `diagnosticsId` when that tool and ID are available. Report the actual error;
   a missing result is not a successful build and is not fallback authorization.
3. After a successful build, pass its Host-returned `artifactId` to `install_app`
   and then `launch_app` in the same Cindy session, on the exact instance and
   current `instanceId`, `generation`, and `leaseId` route. Never substitute an
   arbitrary `.app` path or another instance's artifact. If the artifact is
   invalid or the route becomes stale, inspect current Host state and reacquire
   the route or build artifact before continuing.
4. Observe the launched app with `get_screen_map` and the required interaction
   tools. Report build, install, launch, and observed behavior separately; do not
   claim runtime success from build success alone.
