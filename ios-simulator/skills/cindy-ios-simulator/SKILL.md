---
name: cindy-ios-simulator
description: Use Cindy's Host-owned embedded iOS Simulator for app build, launch, inspection, and interaction; use external Xcode/Simulator/simctl only on a Host-authorized fallback route when no Cindy-owned runtime is active.
---

# Cindy iOS Simulator

> This skill belongs to the Cindy `ios-simulator` plugin. Prefer the Host-provided `cindy_ios_simulator` MCP. Do not reproduce the embedded workflow with shell commands, `cindy_computer`, or an external Simulator.app. The only exception is the Host-authorized fallback below; if the Host cannot establish the required state, stop and diagnose.

Use Cindy's Host-owned simulator runtime for iOS app development and testing. The Host owns Simulator lifecycle, viewer UI, WDA, Native Sidecar, H.264, Native HID, capability admission, ownership, lease/generation freshness, recovery, and compatibility fallback. The plugin contributes this workflow and makes the Host viewer available in the task's right sidebar.

## Workflow

1. Inspect the `cindy_ios_simulator` tool catalog before choosing an action. Do not infer availability from generic MCP resource listing. Prefer the current tool names (`list_simulator_devices`, `type_simulator_text`) reported by the Host.
2. Run `check_environment` or `doctor` when the environment, device ownership, or current route is unclear.
3. Use `list_instances` before creating or attaching a device. Reuse the current session's instance when it matches the request.
4. Use `list_simulator_devices`, then `attach_device` or `create_instance` only with an exact device identity. Never select an arbitrary booted simulator.
5. Start with `start_instance`. The Host opens Cindy's embedded viewer; do not open Simulator.app separately.
6. Build, install, and launch through the Host tools (`build_app`, `install_app`, `launch_app`). Every mutation must preserve the exact route returned by the Host: `instanceId`, `generation`, and `leaseId`. If a route is stale, reacquire it through `list_instances`; never invent or reuse an old route.
7. Inspect and interact through accessibility-first tools (`get_screen_map`, `audit_accessibility`, `tap`, `swipe`, `drag_on_simulator`, `long_press`, `type_simulator_text`, `press_simulator_key`, and related actions). Use screenshots only when visual evidence is needed. Use `batch` or native touch-path tools only with a fresh screen observation and bounded inputs.
8. Treat Native H.264 and Native HID as accelerators. If the Host reports a WDA/JPEG fallback, continue in compatibility mode unless the user asks for diagnosis.
9. Stop or detach only when the user requests it or the workflow owns that cleanup. Do not shut down unrelated external devices.

## Host-authorized external fallback

Use this route only when the Host explicitly reports one of the following: the
plugin is not installed, the plugin is disabled, or Host capability admission
failed. Before falling back, the same Host response must establish that
`runningInstanceCount` is zero and that no Cindy-owned runtime, cleanup task,
lease, or generation transition is active. A missing response, an unknown
ownership state, or an unavailable status probe is not confirmation; stop and
ask for the Host/plugin to be restored.

When those conditions are satisfied, perform a strict handoff: pass the
Host-provided workflow name, exact device identity/UDID, and the user's
original task unchanged to that named external Xcode, Simulator, or `simctl`
workflow. Use only the entry point and arguments supplied by the Host; never
translate the request into guessed shell commands. If the Host does not return
all three handoff fields, stop. Do not use the fallback to reach a Cindy-owned
instance, select an arbitrary booted device, or clean up resources that the
Host may still own. This fallback is a routing decision, not permission for
the plugin to inspect Host internals.

## Safety Boundaries

- Never call `cindy_computer` to control the external Simulator window when the user asked for Cindy's embedded simulator.
- Never use shell commands to launch Simulator.app, boot an implicit device, inject input, or bypass Host admission on the embedded route. Only the Host-authorized external fallback above may hand off to a named Xcode/Simulator/simctl workflow.
- Never ask plugin code for frame bytes, Sidecar paths, process handles, viewer leases, or arbitrary session IDs; those capabilities intentionally remain inside the Host.
- Honor an explicit user request for a different named workflow. This skill only governs Cindy's embedded simulator path.
