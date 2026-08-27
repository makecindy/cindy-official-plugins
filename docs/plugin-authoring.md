<p align="right">
  <a href="plugin-authoring.zh-CN.md">简体中文</a> · <strong>English</strong>
</p>

# Plugin authoring and migration reference

This reference works with any coding Agent, editor, or human developer. Cindy
Forge and a particular harness are not prerequisites. See the
[README](../README.md#local-development) for the minimum layout, complete starter
Manifest, and ZIP packaging, and [Contributing](../CONTRIBUTING.md) for official
publishing requirements. This document adds migration mappings and common runtime calls.

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
| `ios-simulator` | `iosSimulator: true` | Host embedded simulator entry; retain accompanying Skill and other declarations |

Boolean capabilities must be literal `true` when present; omit unused ones rather
than setting `false` or `null`. Keep independent fields such as `manual`, `setup`,
`locales`, `settingsHtml`, `command`, and `keywords`; their absence from `slots`
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

## Version and installation facts

- Determine `minCindyVersion` from the package's manifest format, required Host
  interfaces, and stable release evidence. Keeping the old v2 value is not
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
- Installation and updates do not ask for per-capability confirmation because
  declarations changed. Package source does not create another capability
  authorization policy. Existing automatic installation entry points remain;
  development-tool packaging only produces an artifact, and installation needs
  an appropriate user request. Runtime Agent authorization, account connection,
  credential setup, and user directory selection may still be necessary.
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

### Bundled Node / CLI

Add this field fragment to the existing Manifest and declare the actual tool
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

## Validation and delivery: handled by the Agent

1. Compare existing declarations and code with the migration; preserve resources,
   tool parameters, and four-language text. Change behavior only when requested;
   do not drop permissions merely to satisfy validation.
2. `node scripts/validate-plugin-manifest.mjs ./<directory>` checks JSON/Manifest
   shape only, not file existence, package contents, actual client support, or
   every official publishing rule.
3. Run the repository gates and relevant plugin tests from Contributing. The
   official `.github/scripts/package-plugin.sh <directory> <output.cindy>`
   archives committed **HEAD**, not uncommitted changes. The README's ZIP command
   can package a working copy, but production verification must cover the final
   submitted contents. Inspect the archive root and declared files; do not wrap
   them in an outer plugin directory.
4. Install the final package in a production stable Cindy build meeting its real
   minimum, exercise core tools and failures, and check retained capabilities.
   The Agent does this when authorized operating tools are available; otherwise
   explicitly hand off the unverified steps. Never falsely check the author's
   verification box. CI reads the PR attestation; it does not collect device
   evidence, prove the minimum version correct, or compare migration capabilities.

## Interpreting documentation and comments

Runtime examples follow Cindy's
[Host authoring reference](https://github.com/makecindy/cindy/blob/d1171fc58cc3368005a92c63afe8b4b7bc0ccda3/apps/desktop/src/main/cindy-brain/forge.ts).
They are reproduced here for any harness; invoking Forge or checking out the
client is unnecessary. The pinned validator records its source in the header of
`.tests/contracts/plugin-manifest.*.mjs`. It is generated, not hand-edited, and is
not a complete SDK manual. Historical v2 slot/installation-confirmation comments
do not authorize reinstating installation permission gates. Use this reference,
Contributing, and the target Host's actual interfaces for current behavior.
Keep both languages synchronized; correcting wording does not require changing
plugin packages, Host behavior, or CI restrictions.
