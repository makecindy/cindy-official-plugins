<p align="right">
  <a href="plugin-authoring.zh-CN.md">简体中文</a> · <strong>English</strong>
</p>

# Plugin authoring and migration reference

This reference works with any coding Agent, editor, or human developer. Cindy
Forge and a particular harness are not prerequisites. See the
[README](../README.md#local-development) for the minimum layout, complete starter
Manifest, and package format, and [Contributing](../CONTRIBUTING.md) for official
publishing requirements. This document adds migration mappings and common runtime calls.

Mail plugins should reuse the [shared compose workflow](mail-compose.md) for
editable draft cards, autosave, unified sends and task continuation. Keep
provider account, MIME and transport differences in adapters.

## Target Host reference and capability map

When authoring inside Cindy, start with the built-in `cindy-plugin-creator` Skill.
`ghost_forge_guide` is a compatibility reader for that same bundled reference,
not another SDK. Outside Cindy, use this repository's quick path and the matching
Host reference; no Cindy-specific tools or client checkout are required.

The [Host Skill and reference index](https://github.com/makecindy/cindy/tree/main/apps/desktop/resources/system-skills/cindy-plugin-creator)
and its [version verification guide](https://github.com/makecindy/cindy/blob/main/apps/desktop/resources/system-skills/cindy-plugin-creator/references/plugin-source-verification.md)
are navigation links. Determine the executing computer's Cindy version and
verified release tag or build commit, then read those files at that ref. `main`,
an unmerged PR, or a development-only chapter does not prove installed support.
When source verification is unavailable, state the limit and use the target
Host's bundled guide and actual runtime results without inventing API support.

Use the matching reference index to find the capability before implementing it:

| Need | Declarations / interfaces | Host reference sections |
|---|---|---|
| Agent tools and workflows | `tools`, `manual`, bundled `skill` | §3, §3.5, §3.6, §4.16 |
| UI and interaction | `panel`, `mainView`, `taskView`, `settingsHtml`, cards, `mcpApps.ui` | §4.5, §4.8, §4.20, §4.22, §4.23, §5 |
| Models and media | model catalog / picker, `models`, `cindy`, Agent Core `media` | §4.0.3, §4.0.4, §4.6.3 |
| Host interaction | public context, `notify`, `badge`, `confirm` | §4.1, §4.9, §4.18 |
| Tasks and coordination | `agent`, `cindy.tasks`, `cindy.targets` | §4.11 |
| Events and routine triggers | `subscribe`, reply hooks, control points, `routineEvents` | §4.6 and routine-event reference |
| Files and project context | `fs`, `library`, `sessionContext`, `pick`, `preview`, `workspace` | §4.10, §4.13–§4.17 |
| Bundled code, CLI and stdio MCP | top-level `node`, declared entries and secret bindings | §4.12 |
| Browser integration | `browserExtension` | §4.24 |
| Mobile pages and desktop synchronization | `mobile`, `deviceSync` | §5.1, §4.10.2 |

This is a reading map, not a minimum-version or availability guarantee. Check
the target Host's capability results and the relevant chapter's release status;
experimental or unpublished interfaces are not a stable compatibility promise.
Repository validation and publication rules remain defined here; runtime API
parameters, return values and authorization come from the matching Host contract.

### Icons

Use a user-supplied image, or generate one only after the user's consent.
Do not draw or keep a solid-color placeholder, including one from an older
scaffold. If no icon is supplied, omit `icon` and the unused file as described
in the README; let the Host render its default symbol. Do not package that
default symbol as an image. A declared `icon` must reference a real package file.

## Capability declarations are not a client support gate

Plugin development must not wait for Cindy client capability releases. Within a
supported manifest format, unfamiliar declarations are data, not a reason to
reject publication or installation. The validator preserves unknown top-level
fields, extension fields in capability objects (mainView, panel, card, agent,
node and secret bindings, preview, skill/manual and their items, subscribe),
Cindy categories/actions, and subscription topics/hooks. Legacy v2 slot names
are not checked against a repository-specific capability allowlist.

This does not implement an API or grant permission. Known-field types, safe
package paths, format constraints, and runtime account/credential/session
authorization remain enforced. Unknown declarations stay inert until a Host
implements them; an unresolved credential reference must fail at use time,
never fall back to another credential or account.

Authors must detect unavailable APIs or handle unsupported-operation results,
disable only the affected functionality, and offer a clear upgrade prompt or
a supported fallback. Never bypass a permission denial or silently claim success.
`minCindyVersion` remains required where applicable for distribution/version
selection, but is not proof of runtime support: users may directly install a
package on an incompatible client. Test that case and keep the remaining
supported functionality usable.

## Derive changes from the task

The author describes the desired functionality. The implementing Agent reads the
existing `ghost.json`, entry code, and relevant resources, then handles format
conversion, declarations, versions, localized text, and validation. Do not hand
the field-mapping checklist back to the author or require them to paste this
reference into every task.

- New plugin: start with the README's v3 example and add only declarations and
  resources required by the functionality.
- Existing plugin: preserve its ID, entry points, tool interfaces, and existing
  capabilities. If package content changes and the manifest is v2, apply the
  table below. Do not replace an existing Manifest with a minimal example or
  migrate unrelated plugins.
- Ordinary HTTPS, workdir writes, and CLIs: use the existing interfaces below;
  do not add Slots, client allowlists, or execution APIs for particular hosts,
  paths, or commands.
- Resolve facts available in the implementation yourself. Surface only genuine
  product choices, an unconfirmed target client version, or missing real-device
  verification evidence. Never guess a minimum version or claim an unperformed check.

## Manifest v2 to v3: preserve behavior, change representation

`schemaVersion` identifies the manifest format; `minCindyVersion` identifies the
client version this particular package needs. They are not interchangeable.
Set `schemaVersion: 3`, establish the package's minimum version, apply these
mappings, and only then remove `slots`. These are equivalent representations of
existing capabilities, not a requirement to add capabilities the plugin never had.

| v2 slot / field | v3 representation | Preserve during migration |
|---|---|---|
| `tool` | `tools` | Entire tool list, parameters, and descriptions; retain the existing field |
| `card` | `card: {}` or existing `card` object | Empty object for basic rendering; retain `externalLinks` when present |
| `agent` | `agent: {}` or existing `agent` object | Empty object for basic click-triggered use; retain optional fields without adding background access |
| `panel` | `panel` | HTML path, title, position, and sizing |
| `main-view` | `mainView` | Application-level view; not interchangeable with `panel` |
| `cindy`, legacy alias `model` | `cindy` | Action declarations; rename a lone `model` field, keeping the original `cindy` when both exist |
| `subscribe` | `subscribe` | topics/hooks and associated `launch` configuration |
| `node` | `node` | entry/entries, protocol, lifecycle, `childSpawn`, and secret bindings |
| `network` | `network` | hosts, secrets, connections, and their injection boundaries |
| `preview` | `preview` | Original hosts, without broadening allowed URLs |
| `skill` | `skill` | items and bundled SKILL.md files; do not rename or replace them with Manual |
| `notify` | `notify: true` | Notifications |
| `badge` | `badge: true` | Unread badge; still requires `panel` |
| `confirm` | `confirm: true` | Plugin business confirmation, not installation authorization |
| `fs` | `fs: true` | Plugin-private data directory access |
| `library` | `library: true` | Persistent user works; do not substitute `fs` |
| `session-context` | `sessionContext: true` | Host-injected trusted session context |
| `pick` | `pick: true` | User directory picker |
| `workspace` | `workspace: true` | Workspace session entry |
| `ios-simulator` | `iosSimulator: true` | Retired Host embedded simulator; current Hosts reject new installs that declare it. Kept only for reading legacy manifests |

Boolean capabilities must be literal `true` when present; omit unused ones rather
than setting `false` or `null`. Keep independent fields such as `manual`, `setup`,
`locales`, `settingsHtml`, `showTaskPreferences`, `releaseNotes`, `command`, and `keywords`; their absence from `slots`
does not make them disposable. A format-only migration does not change tool
behavior or execution paths. Historical empty slot names without declarations
should not be filled with new permissions; inspect their actual usage. Do not
guess mappings for unfamiliar declarations or silently drop them: establish the
target Host's actual contract.

For example, migrate `slots: ["tool", "card", "node", "session-context", "pick", "preview"]`
by keeping `tools`, `node`, `preview`, and the existing `card` (or adding `{}` when
absent), then adding `sessionContext: true` and `pick: true`. Merely deleting
`slots` loses those presence-only capabilities.

The validator preserves unknown v3 top-level fields. Preservation neither grants
permission nor proves Host implementation. Business functionality built on
existing network, file, or Node interfaces does not require client-side business
registration. An invented field or method cannot create an unimplemented Host API.

## Release notes (optional, recommended)

In this official repository, `ghost.json.releaseNotes` is optional in both v2
and v3. For a version update, include a user-facing summary of the changes when
possible: new features, fixes, and compatibility changes. Keep the plugin's
purpose in `description`; release notes describe this particular version.

```json
{ "releaseNotes": "Added batch processing.\nFixed result display for empty input." }
```

When present, the value must be a plain-text string. Validation preserves it
verbatim, including line breaks, without trimming or truncation. It is not an
HTML or Markdown execution surface. Omitting it or leaving it empty does not
block repository validation or publication. Existing plugins need no historical
backfill or separate version bump just to add release notes; include them with
the next actual update, following the existing package-version rules.

## Host default settings card

The top-level `showTaskPreferences` field is an optional boolean display setting,
not a presence-only capability. Both `true` and `false` are valid in v2 and v3.
Omitting it or setting it to `true` keeps the existing capability-based visibility
of Cindy's **Model and tasks** card. A plugin providing its own settings UI can declare:

```json
{ "showTaskPreferences": false }
```

Supporting clients hide the Host's default card on Desktop and mobile. This field
only controls visibility; task APIs, model precedence, saved defaults, permission
checks, and installation confirmation keep their existing behavior.
Plugins can still select models through the existing `tasks.models`, explicit
creation `route`, and `tasks.setModel` interfaces; check `tasks.capabilities`
before using incremental operations.

Older clients that do not recognize the field still show the original card.
Establish stable/Beta release evidence before relying on the hidden card or setting
`minCindyVersion`; do not infer a supporting version from a merged PR.

## Version and installation facts

- Determine `minCindyVersion` from the package's manifest format, required Host
  interfaces, and stable or Beta release evidence. Keeping the old v2 value is not
  automatically correct; merged code is not proof of release. The README's
  `1.2.3` is a placeholder, not a repository-wide client floor.
- Current official CI requires v3 for new plugins and changed package content,
  including descriptions, icons, and bundled documentation. Shared packaged
  LICENSE/NOTICE/TRADEMARKS files affect every plugin. Root README files, this
  reference, and CI files are not bundled and do not trigger plugin migration.
- Package changes require increasing the plugin's own `version`. After moving to
  v3, do not claim support for clients that only understand v2. Server selects a
  compatible historical release using the package's minimum version, or hides
  the plugin if none exists. If the task explicitly requires new fixes for
  v2-only clients, the current repository gate does not support that path:
  explain the conflict instead of lowering metadata or changing CI yourself.
- Repository validation and publication do not grant Host permissions. Installation,
  updates, and any capability confirmation follow the target Host version and
  installation source; consult its matching guide. Development-tool packaging only
  produces an artifact, and installation needs an appropriate user request.
  Runtime Agent authorization, account connection, credential setup, and user
  directory selection remain separate steps.
- Package manifests accurately describe contributions and autonomous Host use.
  Do not introduce an installation gate treating market summaries as the actual
  package's capability ceiling. Host support, credential boundaries, and existing
  runtime authorization govern actual use.

## Runtime interfaces: choose the execution boundary first

`main.js` runs in a browser sandbox, not Node. It cannot directly
`require('node:fs')`, launch a CLI, or bypass Host networking. The code below runs
inside the plugin; the authoring Agent does not need Cindy tools of its own.

### Tool calls and completion

Host sends `{ type: 'tool-call', tool, args, callId }`. Dispatch by `tool`, use that
call's `callId`, complete operations dependent on it, then return exactly one
`tool-result`. Never persist, forge, or reuse the ID after completion, and never
reroute an operation to bypass a permission denial.

```js
cindy.onHostMessage(async function (msg) {
  if (msg.type !== 'tool-call' || msg.tool !== 'hello') return;
  await cindy.send({
    type: 'tool-result', callId: msg.callId, ok: true,
    result: { message: 'The plugin is working.' }
  });
});
```

Return failures as `{ type: 'tool-result', callId, ok: false, errorCode, message }`
with actionable text, not raw stacks, credentials, or sensitive request content.
Timeouts after sends/deletes may mean the external action already happened:
report an unknown outcome requiring verification, rather than blindly retrying
as if it were a read-only operation.

### Ordinary HTTPS

Call this helper inside the relevant `tool-call` handler and put its return value
in the final `tool-result.result`; catch failures there and send the failure reply
described above. Replace the placeholder `example.test` with
the actual business endpoint before use.

```js
async function readRemoteText(msg) {
  const response = await cindy.fetch({
    url: 'https://example.test/info', method: 'GET',
    headers: { Accept: 'text/plain' },
    as: 'text', timeoutMs: 30000, callId: msg.callId
  });
  if (!response.ok) throw new Error(response.message || 'Request incomplete; check networking or authorization.');
  // ok means the Host completed the request, not that HTTP succeeded.
  if (response.status < 200 || response.status >= 300) {
    throw new Error('The remote service rejected the request; check service status and account permissions.');
  }
  if (response.truncated) throw new Error('Response too large; narrow the query.');
  return { text: response.body };
}
```

Ordinary HTTPS during an in-flight Agent call does not need host pre-registration.
Host still enforces URL, SSRF, timeout, and redirect checks. Autonomous networking
outside the call needs `network`. Host-managed credentials, OAuth, and dynamic
connections also need declarations matching the target host; `callId` does not
authorize credential access or injection to arbitrary domains. Do not put tokens
in `headers` or chat arguments. A text request's `body` is a string, used only
with methods supporting request bodies. HTTP 4xx/5xx can return `ok: true`, so
check `status` explicitly.

### File operations

| Target | Operations | Authorization and lifetime |
|---|---|---|
| `root: 'workdir'` | Only `write` | Current `callId`, following session permission mode; no `fs: true` needed |
| `root: 'save'` | Only `write` | Host-injected `args.save_deposit.token`; no `fs: true` needed |
| `root: 'data'` | `write/read/list/delete` | Requires `fs: true`; plugin-private directory removed on uninstall |

```js
// Complete inside tool-call, before sending tool-result.
const written = await cindy.fs({
  op: 'write', root: 'workdir', path: 'output/summary.md',
  content: '# Summary\n', callId: msg.callId
});
if (!written.ok) throw new Error(written.message || 'Write incomplete; check workdir and authorization.');
// Success includes op, path, and bytes; return the actual result to the Agent.
```

`cindy.fs(options)` is shorthand for `cindy.send({ type: 'fs-request', ...options })`.
`path` is relative: absolute paths, `..`, and symlink traversal are rejected.
Content defaults to UTF-8; binary data can use `encoding: 'base64'`. Session
workdir writes are denied in plan/read-only mode; remote workspaces are not local
directories. Save tickets must exist and remain valid; never fabricate a token.
Reading/deleting workspace files is not supported by changing the workdir `op`:
use existing Agent file tools or a genuinely needed Node worker, respecting that
execution route's authorization and scope. Preserve `library` for persistent
user works rather than moving them into uninstall-deleted private `data`.

Declaring `sessionContext` can provide a trusted `args.session_context.workdir`
path. Location metadata grants no file access: check `workdir_is_local` and
`workdir_is_read_only` before passing it to a Node worker, following Host §4.13.

### Bundled Node / CLI

Bundled code, CLIs and stdio MCP always require the top-level `node` field,
including when called by the current Agent. Add this field fragment to the
existing Manifest and declare the actual tool
(for example `git_version`). `entry: 'main.js'` remains the sandbox entry;
`node.entry` refers to a different, real bundled file.

```json
{
  "node": {
    "entry": "node/worker.cjs",
    "protocol": "json-rpc-stdio",
    "lifecycle": "on-demand"
  }
}
```

This example requires Git installed and available on the worker's PATH. It runs
only `git --version` with fixed arguments, without shell interpolation or an extra
Node dependency. Missing Git is a setup failure, not success:

```js
// node/worker.cjs: stdout is newline-delimited JSON-RPC only; log to stderr.
const readline = require('node:readline');
const { execFile } = require('node:child_process');
const reply = (value) => process.stdout.write(JSON.stringify(value) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let request;
  try { request = JSON.parse(line); }
  catch { reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  if (!request || request.id === undefined) return;
  if (request.method !== 'cli/git-version') {
    reply({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
    return;
  }
  execFile('git', ['--version'], { timeout: 5000 }, (error, stdout) => {
    reply(error
      ? { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Git check failed; ensure Git is installed and available on PATH' } }
      : { jsonrpc: '2.0', id: request.id, result: { version: stdout.trim() } });
  });
});
```

```js
// main.js: complete tool reply; Manifest tools must include git_version.
cindy.onHostMessage(async function (msg) {
  if (msg.type !== 'tool-call' || msg.tool !== 'git_version') return;
  let result;
  try {
    result = await cindy.node.request({ method: 'cli/git-version', params: {}, timeoutMs: 10000 });
  } catch {
    result = { ok: false, message: 'No result from the local worker; check plugin runtime status.' };
  }
  await cindy.send(result.ok
    ? { type: 'tool-result', callId: msg.callId, ok: true, result: result.result }
    : { type: 'tool-result', callId: msg.callId, ok: false,
        errorCode: 'NODE_REQUEST_FAILED', message: result.message });
});
```

The worker has no global `cindy` or Electron IPC; return data to `main.js` for
Host operations. `cindy.node.request.timeoutMs` is 1000–120000, default 30000.
Optional `entry` must name an extra entry declared in `node.entries`. `mcp-stdio`
uses the same request entry; Host handles MCP initialization, so plugins do not
call `initialize` themselves. A particular CLI needs no client registration or
new `cindy.process.run` API. Verify installation, platform support, and argument
safety for real external CLIs.

`node.childSpawn: true` enables the Host's `globalThis.__CINDY_NODE__.spawnEntry`
bridge for JS files listed in `node.entry` / `node.entries`. It is not a switch
for ordinary `child_process.execFile` and is not needed by this Git example.
Do not use `process.execPath` as a Node executable: packaged Cindy disables
Electron RunAsNode. Use the Host bridge for a bundled JS subprocess instead.
Node workers have the current OS user's permissions, not the browser sandbox;
keep commands and file/network access within the requested task's scope.

Use `network.secrets[].inject` / `network.connections[].inject` for managed HTTP
credentials. If a worker genuinely needs plaintext, restrict methods and entry
using `node.secretBindings`; Host injects `cindy.secrets` into the request.
Never send it through ordinary `params`, cache it, return it, or log it. Keep
credential setup separate from business calls: installation success is not
proof of account connection.

### Media generation and task coordination

For new image/video functionality, the plugin returns business parameters and
model preferences. The current Agent calls Cindy Core `media`, then explicitly
hands results to the plugin through `ghost_call.attachments` if needed. The Host
does not automatically invoke the plugin after generation. Legacy
`cindy-request` image/video generation is for existing-plugin compatibility;
do not copy it as the new-plugin path. See Host §4.0.4 for the full flow.

For independent Agent work, use the target Host's §4.11 task interfaces and their
declared capabilities. Check `cindy.tasks.capabilities()` before incremental
operations. `archive({taskId})` applies only to the plugin's own idle local tasks;
busy tasks return `TASK_BUSY`. Sending to projects, existing tasks or companions
requires the separately declared and approved `agent.targets` together with
`agent.tasks`; it does not confer ownership of every task. Newer observation and
companion interfaces must follow their own release status and Host checks;
their presence in a guide does not establish stable support.

## Validation and delivery: handled by the Agent

1. Compare existing declarations and code with the migration; preserve resources,
   tool parameters, and four-language text. Change behavior only when requested;
   do not drop permissions merely to satisfy validation.
2. `node scripts/validate-plugin-manifest.mjs ./<directory>` checks JSON/Manifest
   shape only, not file existence, package contents, actual client support, or
   every official publishing rule.
3. Run the repository gates and relevant plugin tests from Contributing. You can
   use PR CI verification artifacts directly; the [dependency guide](binary-dependencies.md)
   covers local development, migration and downloading packages. For optional
   local CI reproduction, `.github/scripts/package-plugin.sh <directory> <output.cindy>`
   archives that plugin's committed **HEAD** content and adds fixed repository
   legal files; it does not include uncommitted plugin changes. It also collects
   [declared binary dependencies](binary-dependencies.md) into the same package
   (Python 3.11+ for local collector reproduction; no plugin build hooks).
   Local Forge packaging instead requires prepared dependency outputs; it does
   not download them. Never recursively
   ZIP a working directory: a local credential file can enter the archive. A harness
   packaging uncommitted work must use an explicit reviewed file list. Inspect
   every final archive for expected files, no outer plugin directory, and no
   credentials; verification evidence must apply to the submitted contents.
4. Provide real runtime evidence for affected paths under the
   [review contract](../.greptile/rules.md#运行验证与证据复用). For installation,
   migration or tool behavior changes, exercise the relevant package in a Cindy
   environment meeting its actual requirements, including failure paths and
   retained capabilities. Record the tested package/source, Cindy version/channel,
   scenarios, results and gaps. Identify development builds truthfully; they do
   not establish compatibility with released clients without applicable evidence.
   Reuse prior evidence only with an explanation of why the full diff from the
   tested version to the current submission leaves those paths unaffected; an
   older package's test is not a claim that the latest package was installed.
   Authors or maintainers may supply evidence. The Agent performs authorized
   operations when available; otherwise explicitly hand off unverified steps.
   No fixed verification checkbox is required or read by CI. Green CI does not
   collect runtime evidence, prove the minimum version correct, or compare
   migration capabilities.

## Interpreting documentation and comments

Runtime examples are a convenience for any harness; consult the
[matching Host reference](#target-host-reference-and-capability-map) for current
API details instead of treating an old single-file guide as the whole SDK.
Invoking Forge or checking out the client is unnecessary. The pinned validator
records its source in the header of
`.tests/contracts/plugin-manifest.*.mjs`. It is generated, not hand-edited, and is
not a complete SDK manual. Historical v2 slot/installation-confirmation comments
do not authorize reinstating installation permission gates. Use this reference,
Contributing, and the target Host's actual interfaces for current behavior.
Official repository plugins are published through PRs and the repository workflow.
Client community submissions use their separate contribution flow; Forge
`intent: 'publish'` targets the current organization. Packaging alone does not
select any of those destinations or publish a plugin.
Keep both languages synchronized; correcting wording does not require changing
plugin packages, Host behavior, or CI restrictions.

### Current declarations and future synchronization

The fields below reference [Host commit 94475474ec](https://github.com/makecindy/cindy/blob/94475474ec60d13f94790d0548e74b7d75ce9de6/packages/plugin-protocol/src/manifest.ts)
(`v0.1.135`) and its runtime references. They help locate capabilities;
availability still depends on the target Host.

| Capability | Declaration |
| --- | --- |
| Tool approval policy | `tools[].approval` (`auto / each-call`) |
| Tasks and companions | `agent.tasks / hiddenTasks / targets / delegation / observe / companions` |
| Views | `mainView.open / side / multiple`, `taskView`, `mobile` |
| Configuration and prerequisites | `showTaskPreferences`, `setup.requires[].anyOf` |
| Introductions and mail | `readme`, `mail`, `mailReader` |
| Models and Routine events | `models.types`, `routineEvents.events` |
| Static system prompt | `systemPrompt` (v3, `scope: "selected-task"`) |
| Event hooks | `subscribe.hooks` values `will-start-turn`, `will-model-request`, `will-compose-context`, `will-search-memory` |
| Credential checks | `network.secrets[].check` |
| Desktop synchronization and device screens | `deviceSync`, `liveScreen` |

Page resources remain under `mcpApps.ui`: `resources` and `tools` must not both be
empty; a page opened only through a named entry may use empty `tools: {}`.

Host resource languages include `zh-CN / zh-TW / en / ja / ko / es / fr / de / pt-PT / pt-BR`.
Host capabilities and official repository admission are maintained separately.
This documentation update keeps the repository's existing four-language policy,
pinned validator, file checks and package budgets, and changes no plugin manifest
or runtime behavior.

For future updates, record the target Host commit, fields and reference sections,
then synchronize declaration types and both language guides. Preserve unknown
capability extensions instead of adding a whitelist of implemented capabilities.
Any validation, normalization or stored-package read changes need their own
behavioral diff; documentation updates do not replace the validator snapshot.
No cross-repository build dependency is needed.

## Same-account device synchronization

The optional `deviceSync: true` capability uses `cindy.deviceSync` on supporting
Hosts. Probe the function before use; older Hosts keep local functionality.
`status` lists online desktops, `request` sends bounded JSON to the same plugin
(namespace + id), and the peer receives a `device-sync-request` message and calls
`reply` only after committing its data. Each envelope is at most 64 KiB; timeout
returns `SYNC_RESULT_UNKNOWN`, so only idempotent operations may be retried after
reconciliation. The Host encrypts transport and binds account, peer, installation
revision and plugin identity. The plugin owns persistence, conflict resolution
and tombstones. Use `launch: resident` when automatic reception is required.
Both computers need a Host implementing this API; this declaration alone does
not add support to released clients. Mobile remains a controller of a desktop.

Contacts uses this optional capability with an explicit per-device setting.
Local data remains usable on its existing minimum Cindy version. Synchronization
needs two online same-account desktops with the new Host API, and the exact
Host/plugin combination still requires stable/Beta two-device verification.
