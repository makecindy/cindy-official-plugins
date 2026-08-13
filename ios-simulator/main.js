"use strict";

// The plugin contributes only its Skill and Host capability declaration.
// Embedded simulator UI, video, input, lifecycle, and recovery stay inside
// Cindy Host. Any external fallback is selected and authorized by the Host;
// the handoff carries the Host-named workflow, exact device identity, and
// original task; this plugin never invents commands or reads Host state.
