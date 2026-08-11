---
name: cindy-ios-simulator
description: Use Cindy's Host-owned embedded iOS Simulator for app build, launch, inspection, and interaction without opening the external Simulator.app.
---

# Cindy iOS Simulator

> This skill belongs to the Cindy `ios-simulator` plugin. Before acting, confirm that the available tools include the Host-provided `cindy_ios_simulator` MCP. If it is unavailable, explain that this workflow requires a Cindy version with embedded iOS Simulator support and stop. Do not reproduce the workflow with shell commands, `cindy_computer`, or an external Simulator.app.

Use Cindy's Host-owned simulator runtime for iOS app development and testing. The Host owns Simulator lifecycle, viewer UI, WDA, Native Sidecar, H.264, Native HID, capability admission, recovery, and compatibility fallback. The plugin contributes this workflow and makes the Host viewer available in the task's right sidebar.

## Workflow

1. Inspect the `cindy_ios_simulator` tool catalog before choosing an action. Do not infer availability from generic MCP resource listing.
2. Run `check_environment` or `doctor` when the environment, device ownership, or current route is unclear.
3. Use `list_instances` before creating or attaching a device. Reuse the current session's instance when it matches the request.
4. Use `list_devices`, then `attach_device` or `create_instance` only with an exact device identity. Never select an arbitrary booted simulator.
5. Start with `start_instance`. The Host opens Cindy's embedded viewer; do not open Simulator.app separately.
6. Build, install, and launch through the Host tools (`build_app`, `install_app`, `launch_app`). Preserve the exact instance route returned by the Host.
7. Inspect and interact through accessibility-first tools (`get_screen_map`, `tap`, `swipe`, `type_text`, and related actions). Use screenshots only when visual evidence is needed.
8. Treat Native H.264 and Native HID as accelerators. If the Host reports a WDA/JPEG fallback, continue in compatibility mode unless the user asks for diagnosis.
9. Stop or detach only when the user requests it or the workflow owns that cleanup. Do not shut down unrelated external devices.

## Safety Boundaries

- Never call `cindy_computer` to control the external Simulator window when the user asked for Cindy's embedded simulator.
- Never use shell commands to launch Simulator.app, boot an implicit device, inject input, or bypass Host admission.
- Never ask plugin code for frame bytes, Sidecar paths, process handles, viewer leases, or arbitrary session IDs; those capabilities intentionally remain inside the Host.
- Honor an explicit user request for a different named workflow. This skill only governs Cindy's embedded simulator path.
