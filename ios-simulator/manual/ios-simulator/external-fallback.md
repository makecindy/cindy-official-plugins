# Host-authorized external fallback

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
