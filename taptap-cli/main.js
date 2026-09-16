'use strict';

// TapTap CLI plugin brain. Runs in the Cindy sandbox: no fs, no network, no Node.
// Responsibilities are intentionally thin:
//   1. map the two declared tools to worker JSON-RPC methods
//   2. read the plugin settings (/kv) and pass the configured CLI path down
//   3. pass the session workdir down so the CLI resolves relative file paths
//      (upload <file>, --output) where the user expects, and carry the
//      read-only verdict so the worker can refuse writes
//   4. forward worker progress notifications as tool-progress heartbeats so
//      long tasks (uploads, login polling) keep the host tool-call window alive
//   5. shape tool-results (ok/result vs ok/errorCode/message)
//
// All real work happens in node/worker.cjs, which runs the user's own taptap-cli.

var TOOL_METHODS = {
  list_tools: 'taptap/list_tools',
  call_tool: 'taptap/call_tool',
};

// A hung /kv must never stall a tool call: bound the read and fall back to
// defaults, which is what the worker already does when no path is configured.
var SETTINGS_TIMEOUT_MS = 2000;
var settingsPromise = null;

function readSettings() {
  if (settingsPromise) return settingsPromise;
  settingsPromise = new Promise(function (resolve) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, SETTINGS_TIMEOUT_MS);
    var done = function (cfg) {
      clearTimeout(timer);
      resolve(cfg && typeof cfg === 'object' ? cfg : {});
    };
    var failed = function () {
      // A transient /kv failure must not be cached: the cached value would
      // answer every later call with no cli_path, so a CLI that is not on the
      // auto-detected path would report CLI_NOT_INSTALLED until the plugin
      // reloads. Drop the promise so the next call reads again.
      settingsPromise = null;
      clearTimeout(timer);
      resolve({});
    };
    fetch('/kv', { signal: controller.signal })
      .then(function (res) { return res.json(); })
      .then(done, failed);
  });
  return settingsPromise;
}

// settings.js rewrites /kv and pings us on the shared channel so the next call
// picks the new path up without a reload.
try {
  new BroadcastChannel('taptap-cli').onmessage = function () { settingsPromise = null; };
} catch (_) {
  // Older hosts may not expose BroadcastChannel; the setting still applies on
  // the next plugin wake.
}

function reply(callId, payload) {
  cindy.send(Object.assign({ type: 'tool-result', callId: callId }, payload));
}

function fail(callId, errorCode, message, executionState, data) {
  var payload = { ok: false, errorCode: errorCode, message: message };
  // Surfaced as a field, not only in prose, so the agent can tell "refused,
  // safe to retry" from "may already have been applied, check first" without
  // parsing the message. Same field name the other CLI-backed plugins use.
  if (executionState) payload.execution_state = executionState;
  // The worker keeps the CLI's own envelope on failure — the error type, hint
  // and any handles a half-finished upload already created. Dropping it here
  // would leave the agent unable to resume without re-uploading.
  if (data !== undefined) payload.data = data;
  // The host keeps the execution state only when it also travels in MCP-shaped
  // structured content — that is why the bundled TapTap Maker runtime sends
  // both (see README, "Cindy's error sanitizer retains the execution state").
  // Without this the agent receives the prose and the state is dropped.
  payload.structuredContent = Object.assign(
    { success: false, message: message },
    executionState ? { execution_state: executionState } : {},
    data !== undefined ? { data: data } : {}
  );
  reply(callId, payload);
}

cindy.onHostMessage(function (msg) {
  // worker progress -> host heartbeat
  if (msg.type === 'event' && msg.name === 'node-notification' && msg.method === 'progress') {
    var progressCallId = msg.params && msg.params.callId;
    if (progressCallId) cindy.send({ type: 'tool-progress', callId: progressCallId });
    return;
  }
  if (msg.type !== 'tool-call') return;

  var callId = msg.callId;
  var method = TOOL_METHODS[msg.tool];
  if (!method) {
    fail(callId, 'UNKNOWN_TOOL', '未知工具 ' + msg.tool + ';可用工具:list_tools、call_tool');
    return;
  }

  // session_context is minted by the host, so workdir_is_local is trustworthy:
  // a remote workspace path must never be treated as a local directory.
  var ctx = msg.args && msg.args.session_context;
  var workdir = ctx && ctx.workdir_is_local && ctx.workdir ? ctx.workdir : undefined;

  readSettings()
    .then(function (settings) {
      var params = Object.assign({}, msg.args || {});
      delete params.session_context;
      params.callId = callId;
      params.cli_path = settings && typeof settings.cli_path === 'string' ? settings.cli_path : undefined;
      params.workdir = workdir;
      params.read_only = Boolean(ctx && ctx.workdir_is_read_only);
      return cindy.node.request({
        method: method,
        params: params,
        timeoutMs: 120000,
        maxTotalMs: 900000
      });
    })
    .then(function (resp) {
      var result = resp && resp.ok ? resp.result : null;
      if (result && result.ok === true) {
        reply(callId, { ok: true, result: result.data });
        return;
      }
      fail(
        callId,
        (result && result.errorCode) || (resp && resp.errorCode) || 'CLI_ERROR',
        (result && result.message) || (resp && resp.message) || 'TapTap CLI 执行失败,无附加信息',
        result && result.execution_state,
        result && result.data
      );
    })
    .catch(function (err) {
      // A worker crash or transport failure after call_tool was dispatched is
      // indeterminate for writes — the CLI may already have applied the change —
      // so mark it unknown rather than a plain failure that looks safe to retry.
      // list_tools is read-only, so its failure is safely "not executed".
      var state = msg.tool === 'call_tool' ? 'unknown' : 'not_executed';
      fail(
        callId,
        'INTERNAL',
        '插件电子脑错误:' + ((err && err.message) || String(err)) +
          (state === 'unknown' ? ';写操作可能已在服务端生效,请先核对实际状态再决定是否重试' : ''),
        state
      );
    });
});
