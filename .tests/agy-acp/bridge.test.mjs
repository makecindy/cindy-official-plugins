// Run: node --test
//
// Exercises the real entry files (worker.js, agy-acp.js) as child processes against
// a fake `agy` placed on PATH (a Node script plus a `.cmd` wrapper on Windows or a
// `sh` wrapper elsewhere). Each test gets its own temp directory, HOME and PATH, so
// the tests run in parallel and do not see a real agy installation.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const official = new URL(import.meta.url).searchParams.has('official');
const pluginId = official ? 'cindy-antigravity-acp' : 'agy-acp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', pluginId);
const isWin = process.platform === 'win32';

const RESULT_JSON =
  '{"protocolVersion":1,"agentCapabilities":{"loadSession":false,"promptCapabilities":{"image":false}},' +
  '"agentInfo":{"name":"fake-agy","title":"假 AGY ✓","version":"0.2.2"},"authMethods":[]}';
const INITIALIZE =
  '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}\n';
const EXPECTED_RESPONSE = Buffer.from(`{"jsonrpc":"2.0","id":0,"result":${RESULT_JSON}}\n`, 'utf8');

const EXPECTED_ACP_ARGS = ['--settings', '{"useG1Credits":false}', 'acp', '--disable-telemetry'];

const FAKE_AGY_SOURCE = `'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.FAKE_AGY_IGNORE_TERM === '1') process.on('SIGTERM', () => {});
// A pinned FAKE_AGY_VERSION (custom-path test) makes usage report that version; otherwise the generic block below answers.
if (process.env.FAKE_AGY_VERSION && args.includes('/usage')) {
  process.stdout.write(JSON.stringify({ status: 'SUCCESS', num_turns: 0,
    command: { name: 'usage', data: { groups: [{ name: process.env.FAKE_AGY_VERSION, buckets: [{ window: '5h', remaining_fraction: 0.75 }] }] } } }));
  process.exit(0);
}
if (args.at(-1) === '/usage') {
  if (process.env.FAKE_AGY_LAUNCHFILE) {
    fs.writeFileSync(process.env.FAKE_AGY_LAUNCHFILE, process.env.AGY_CLI_DISABLE_AUTO_UPDATE ?? '');
  }
  const groups = [{ name: 'Test', buckets: [{ window: 'weekly', remaining_fraction: 0.5 }] }];
  process.stdout.write(JSON.stringify({ status: 'SUCCESS', num_turns: 0, command: { name: 'usage', data: { groups } } }));
  process.exit(0);
}
if (args.length === 1 && args[0] === '--version') {
  if (process.env.FAKE_AGY_BROKEN === '1') {
    process.stderr.write('agy requires Node.js >= 24.9.0\\n');
    process.exit(1);
  }
  process.stdout.write('agy ' + (process.env.FAKE_AGY_VERSION || '0.2.2') + '\\n');
  process.exit(0);
}
// Remote-workspace mode: the session process runs under the restricted agent of its working directory.
const REMOTE_ARGS = ${JSON.stringify(JSON.stringify([...EXPECTED_ACP_ARGS, '--agent', 'cindy-remote']))};
if (JSON.stringify(args) === REMOTE_ARGS) {
  const record = (extra) => fs.writeFileSync(process.env.FAKE_AGY_LAUNCHFILE, JSON.stringify(Object.assign({
    args, cwd: process.cwd(), files: fs.readdirSync(process.cwd()),
    definition: fs.readFileSync('.agents/agents/cindy-remote.md', 'utf8'),
  }, extra)));
  record({});
  if (process.env.FAKE_AGY_PIDFILE) fs.writeFileSync(process.env.FAKE_AGY_PIDFILE, String(process.pid));
  const send = (message) => process.stdout.write(JSON.stringify(Object.assign({ jsonrpc: '2.0' }, message)) + '\\n');
  const MCP_CALL = { toolCallId: 'call-1', name: 'call_mcp_tool', kind: 'execute', title: 'MCP Tool Bash',
    args: { Arguments: { command: 'ls' }, ServerName: 'cindy_exec', ToolName: 'Bash' },
    rawInput: { Arguments: { command: 'ls' }, ServerName: 'cindy_exec', ToolName: 'Bash' } };
  // In a resumed session agy 1.5.13 reports the same call as a tool of its own name, with a summary it adds.
  const DIRECT_CALL = { toolCallId: 'call-1', name: 'mcp_cindy_exec_Bash', kind: 'other', title: 'Run mcp_cindy_exec_Bash',
    args: { command: 'ls', toolSummary: 'List files' }, rawInput: { command: 'ls', toolSummary: 'List files' } };
  let call = MCP_CALL;
  let promptId = null;
  let lines = '';
  process.stdin.on('data', (chunk) => {
    lines += chunk.toString('utf8');
    let index;
    while ((index = lines.indexOf('\\n')) !== -1) {
      const line = lines.slice(0, index);
      lines = lines.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] } });
      } else if (message.method === 'session/new' || message.method === 'session/resume') {
        record({ method: message.method, session: message.params });
        if (message.method === 'session/resume') call = DIRECT_CALL;
        send({ id: message.id, result: { sessionId: 'sess-1', configOptions: [] } });
      } else if (message.method === 'session/prompt' && process.env.FAKE_AGY_SCRIPT === 'native') {
        // An agy that ignored the agent's tool list: one of its own tools runs, and the turn stays open.
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call', toolCallId: 'call-n',
          name: 'write_to_file', kind: 'edit', title: 'note.txt', status: 'in_progress' } } });
      } else if (message.method === 'session/prompt' && process.env.FAKE_AGY_SCRIPT === 'cards') {
        // Native UI tools (even if tagged with edit/execute kinds) are adapted when elicitation.form is negotiated,
        // preserved unchanged on older hosts, and failure updates are never dropped.
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call', toolCallId: 'steps-r1',
          name: 'update_steps', kind: 'edit', title: 'Run update_steps', status: 'in_progress',
          rawInput: { steps: [{ title: 'Inspect', status: 'done' }, { title: 'Optional', status: 'skipped' }] } } } });
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'steps-r1',
          kind: 'edit', status: 'completed',
          rawInput: { steps: [{ title: 'Inspect', status: 'done' }, { title: 'Optional', status: 'skipped' }] } } } });
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call', toolCallId: 'steps-r2',
          name: 'update_steps', kind: 'edit', title: 'Run update_steps', status: 'in_progress',
          rawInput: { steps: [{ title: 'Verify', status: 'in_progress' }] } } } });
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'steps-r2',
          kind: 'edit', status: 'failed', rawOutput: 'validation failed' } } });
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call', toolCallId: 'ask-r1',
          name: 'ask_question', kind: 'execute', title: 'Run ask_question', status: 'in_progress' } } });
        send({ id: message.id, result: { stopReason: 'end_turn' } });
      } else if (message.method === 'session/prompt' && process.env.FAKE_AGY_SCRIPT === 'cards_and_mcp') {
        // Mix Antigravity native ask_question/update_steps with external MCP tools sharing the exact same names.
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call', toolCallId: 'steps-native',
          name: 'update_steps', kind: 'edit', title: 'Run update_steps', status: 'in_progress',
          rawInput: { steps: [{ title: 'Native plan', status: 'in_progress' }] } } } });
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call', toolCallId: 'ask-native',
          name: 'ask_question', kind: 'execute', title: 'Run ask_question', status: 'in_progress' } } });
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call', toolCallId: 'ext-ask',
          name: 'ask_question', kind: 'other', title: 'Run ask_question', status: 'in_progress',
          rawInput: { ServerName: 'partner', ToolName: 'ask_question', Arguments: { prompt: 'External prompt' } } } } });
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call', toolCallId: 'ext-steps',
          name: 'update_steps', kind: 'other', title: 'Run update_steps', status: 'in_progress',
          rawInput: { ServerName: 'partner', ToolName: 'update_steps', Arguments: { steps: [{ title: 'External step', status: 'in_progress' }] } } } } });
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'ext-steps',
          name: 'update_steps', kind: 'other', title: 'Run update_steps', status: 'completed',
          rawInput: { steps: [{ title: 'External step', status: 'done' }] } } } });
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call', toolCallId: 'ext-direct',
          name: 'mcp_partner_update_steps', kind: 'other', title: 'Run mcp_partner_update_steps', status: 'in_progress',
          rawInput: { steps: [{ title: 'Direct MCP step', status: 'in_progress' }], toolSummary: 'update steps' } } } });
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'ext-direct',
          name: 'update_steps', kind: 'other', title: 'Run update_steps', status: 'completed',
          rawInput: { steps: [{ title: 'Direct MCP step', status: 'done' }] } } } });
        send({ id: message.id, result: { stopReason: 'end_turn' } });
      } else if (message.method === 'session/prompt') {
        promptId = message.id;
        send({ id: 'perm-1', method: 'session/request_permission', params: { sessionId: 'sess-1',
          toolCall: Object.assign({ sessionUpdate: 'tool_call', status: 'pending' }, call),
          options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }] } });
      } else if (message.id === 'perm-1') {
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: Object.assign({ sessionUpdate: 'tool_call', status: 'in_progress' }, call) } });
        // A later update without the arguments still carries agy's own name for the call.
        send({ method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 'call-1',
          kind: call.kind, title: call.title, status: 'completed', rawOutput: 'a.txt\\n' } } });
        send({ id: promptId, result: { stopReason: 'end_turn', answered: message.result.outcome.optionId } });
      }
    }
  });
  process.stdin.on('end', () => process.stdout.write('', () => process.exit(0)));
  return;
}
// Every launch must pass the constant ACP args (including no paid credits and no telemetry).
if (args[0] === '--log-file' && require('node:path').isAbsolute(args[1]) && require('node:path').basename(args[1]) === 'session.log') args.splice(0, 2);
if (JSON.stringify(args) !== ${JSON.stringify(JSON.stringify(EXPECTED_ACP_ARGS))}) {
  process.stderr.write('fake-agy: unexpected arguments ' + JSON.stringify(args) + '\\n');
  process.exit(2);
}
if (process.env.FAKE_AGY_ARGSFILE) fs.writeFileSync(process.env.FAKE_AGY_ARGSFILE, JSON.stringify(args));
if (process.env.FAKE_AGY_PIDFILE) fs.writeFileSync(process.env.FAKE_AGY_PIDFILE, String(process.pid));
process.stderr.write('fake-agy: ready\\n');
if (process.env.FAKE_AGY_CRASH === '1') process.exit(3);
const STATE = process.env.FAKE_AGY_STATE;
if (STATE) {
  // Sign-in mode: an agent that offers Google sign-in and logout (like agy 1.5.12), keeps its sign-in
  // in FAKE_AGY_STATE and logs every ACP method it receives to FAKE_AGY_STATE + '.log'.
  const signedIn = () => fs.existsSync(STATE) && fs.readFileSync(STATE, 'utf8') === 'signed-in';
  const TIER = { antigravity: { tier: { name: 'Google AI Pro', id: 'g1-pro-tier', upgradeUri: 'https://example.test/upgrade' } } };
  const send = (message) => process.stdout.write(JSON.stringify(Object.assign({ jsonrpc: '2.0' }, message)) + '\\n');
  const authRequired = (id) => send({ id, error: { code: -32000, message: 'Authentication required' } });
  const sendAfterGate = (file, message) => {
    if (!file) return send(message);
    const timer = setInterval(() => {
      if (!fs.existsSync(file)) return;
      clearInterval(timer);
      send(message);
    }, 10);
  };
  let lines = '';
  process.stdin.on('data', (chunk) => {
    lines += chunk.toString('utf8');
    let index;
    while ((index = lines.indexOf('\\n')) !== -1) {
      const line = lines.slice(0, index);
      lines = lines.slice(index + 1);
      if (!line.trim()) continue;
      const { id, method, params } = JSON.parse(line);
      fs.appendFileSync(STATE + '.log', method + (method === 'authenticate' ? ':' + params.methodId : '') + '\\n');
      if (method === 'initialize') {
        if (process.env.FAKE_AGY_LOGIN === 'hang-init') continue;
        send({ id, result: { protocolVersion: 1, authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }],
          agentCapabilities: { auth: { logout: {} }, sessionCapabilities: { list: {}, resume: {}, close: {} } } } });
      } else if (method === 'authenticate') {
        if (params.methodId !== 'oauth-personal') send({ id, error: { code: -32602, message: 'Unsupported auth method' } });
        else if (process.env.FAKE_AGY_LOGIN !== 'hang') {
          fs.writeFileSync(STATE, 'signed-in');
          send({ id, result: { _meta: TIER } });
        }
      } else if (method === 'logout') {
        fs.writeFileSync(STATE, 'signed-out');
        send({ id, result: {} });
      } else if (method === 'session/list' || method === 'session/resume') {
        if (!signedIn()) authRequired(id);
        else sendAfterGate(method === 'session/resume' && process.env.FAKE_AGY_RESUME_GATE,
          { id, result: method === 'session/list' ? { sessions: [] } : { _meta: TIER } });
      } else if (method === 'session/new') {
        if (!signedIn()) authRequired(id);
        else sendAfterGate(process.env.FAKE_AGY_MODEL_GATE, { id, result: { sessionId: 'fake-session', configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: 'fake-model',
          options: [{ value: 'fake-model', name: 'Fake ' + (process.env.FAKE_AGY_VERSION || '0.2.2') }] }] } });
      } else {
        send({ id, result: {} });
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
const RESULT_JSON = ${JSON.stringify(RESULT_JSON)};
let buffered = '';
if (!STATE) process.stdin.on('data', (chunk) => {
  buffered += chunk.toString('utf8');
  let index;
  while ((index = buffered.indexOf('\\n')) !== -1) {
    const line = buffered.slice(0, index);
    buffered = buffered.slice(index + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method !== 'initialize') continue;
    const bytes = Buffer.from('{"jsonrpc":"2.0","id":' + JSON.stringify(message.id) + ',"result":' + RESULT_JSON + '}\\n', 'utf8');
    // Split inside a multi-byte character: the bridge must relay bytes, not text.
    const cut = bytes.indexOf(Buffer.from('\\u2713', 'utf8')) + 1;
    process.stdout.write(bytes.subarray(0, cut));
    setTimeout(() => process.stdout.write(bytes.subarray(cut)), 50);
  }
});
if (!STATE) process.stdin.on('end', () => {
  if (process.env.FAKE_AGY_IGNORE_EOF === '1') {
    setInterval(() => {}, 1000);
    return;
  }
  process.stdout.write('', () => process.exit(0));
});
`;

function makeFixture(t, { withAgy = true, extraEnv = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-acp-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  const script = path.join(dir, 'fake-agy.js');
  fs.writeFileSync(script, FAKE_AGY_SOURCE, 'utf8');
  let agyPath = null;
  if (withAgy) {
    if (isWin) {
      agyPath = path.join(bin, 'agy.cmd');
      fs.writeFileSync(agyPath, `@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      agyPath = path.join(bin, 'agy');
      fs.writeFileSync(agyPath, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
      fs.chmodSync(agyPath, 0o755);
    }
  }
  const pidFile = path.join(dir, 'agy.pid');
  const env = { FAKE_AGY_PIDFILE: pidFile, ...extraEnv };
  if (isWin) {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    Object.assign(env, {
      SystemRoot: systemRoot,
      PATH: [bin, path.join(systemRoot, 'System32')].join(';'),
      USERPROFILE: home,
      APPDATA: path.join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      TEMP: os.tmpdir(),
      TMP: os.tmpdir(),
    });
  } else {
    Object.assign(env, { PATH: [bin, '/usr/bin', '/bin'].join(':'), HOME: home, TMPDIR: os.tmpdir() });
  }
  return { dir, agyPath, pidFile, env };
}

/** Real installs in fixed system directories would make "not installed" untestable. */
function systemHasAgy() {
  if (isWin) return false;
  return ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin'].some((dir) => fs.existsSync(path.join(dir, 'agy')));
}

function samePath(a, b) {
  return isWin ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function collect(stream) {
  const chunks = [];
  stream.on('data', (chunk) => chunks.push(chunk));
  return {
    bytes: () => Buffer.concat(chunks),
    text: () => Buffer.concat(chunks).toString('utf8'),
  };
}

function waitClose(child) {
  return new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
}

async function waitFor(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readPid(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
  return text ? Number(text) : null;
}

function startWorker(env) {
  const child = spawn(process.execPath, [path.join(root, 'worker.js')], { env, cwd: os.tmpdir(), stdio: 'pipe' });
  const stderr = collect(child.stderr);
  const closed = waitClose(child);
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    const next = waiting.get(message.id);
    waiting.delete(message.id);
    if (next) next(message);
  });
  return {
    call(request) {
      return new Promise((resolve) => {
        waiting.set(request.id, resolve);
        child.stdin.write(JSON.stringify(request) + '\n');
      });
    },
    async close() {
      child.stdin.end();
      const result = await closed;
      assert.equal(result.code, 0, `worker exit code (stderr: ${stderr.text()})`);
    },
  };
}

function startBridge(env, args = []) {
  const child = spawn(process.execPath, [path.join(root, 'agy-acp.js'), ...args], { env, cwd: os.tmpdir(), stdio: 'pipe' });
  return { child, stdout: collect(child.stdout), stderr: collect(child.stderr), closed: waitClose(child) };
}

describe('agy-acp plugin', { concurrency: true, timeout: 20_000 }, () => {
  test('detect finds agy on PATH and reports its version', async (t) => {
    const fixture = makeFixture(t);
    const worker = startWorker(fixture.env);
    const response = await worker.call({ jsonrpc: '2.0', id: 1, method: 'detect', params: { locale: 'zh-CN' } });
    assert.equal(response.id, 1);
    assert.equal(response.result.available, true);
    assert.equal(response.result.version, '0.2.2');
    assert.ok(samePath(response.result.path, fixture.agyPath), `path ${response.result.path}`);
    assert.equal(response.result.reason, undefined);

    const unknown = await worker.call({ jsonrpc: '2.0', id: 2, method: 'no/such-method' });
    assert.deepEqual(unknown, { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method not found' } });
    await worker.close();
  });

  test('detect reports not-installed with an install hint when agy is missing', async (t) => {
    if (systemHasAgy()) {
      t.skip('a real agy is installed in a fixed system directory on this machine');
      return;
    }
    const fixture = makeFixture(t, { withAgy: false });
    const worker = startWorker(fixture.env);
    const zh = await worker.call({ jsonrpc: '2.0', id: 'a', method: 'detect', params: { locale: 'zh-CN' } });
    assert.equal(zh.result.available, false);
    assert.equal(zh.result.reason, 'not-installed');
    assert.equal(zh.result.message, '未找到 Antigravity 命令行（agy）。请先从 https://antigravity.google 安装，然后点「重新检测」。');
    assert.equal(zh.result.path, undefined);
    const en = await worker.call({ jsonrpc: '2.0', id: 'b', method: 'detect', params: { locale: 'fr' } });
    assert.match(en.result.message, /^The Antigravity CLI \(agy\) was not found\. Install it from https:\/\/antigravity\.google/);
    assert.equal(en.result.messages['zh-CN'], zh.result.message);
    await worker.close();
  });

  test('detect reports not-runnable when agy --version fails', async (t) => {
    const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_BROKEN: '1' } });
    const worker = startWorker(fixture.env);
    const response = await worker.call({ jsonrpc: '2.0', id: 3, method: 'detect', params: { locale: 'en' } });
    assert.equal(response.result.available, false);
    assert.equal(response.result.reason, 'not-runnable');
    assert.ok(samePath(response.result.path, fixture.agyPath));
    assert.match(response.result.detail, /exit code 1: agy requires Node\.js >= 24\.9\.0/);
    await worker.close();
  });

  test('agy-acp relays ACP bytes unchanged and exits with agy when stdin closes', async (t) => {
    const fixture = makeFixture(t);
    const bridge = startBridge(fixture.env);
    bridge.child.stdin.write(INITIALIZE);
    await waitFor(() => bridge.stdout.bytes().length >= EXPECTED_RESPONSE.length, 8_000, 'initialize response');
    assert.ok(bridge.stdout.bytes().equals(EXPECTED_RESPONSE), `stdout was ${JSON.stringify(bridge.stdout.text())}`);
    const pid = readPid(fixture.pidFile);
    assert.ok(pid, 'fake agy wrote its pid');
    assert.ok(isAlive(pid), 'fake agy is running before stdin closes');

    bridge.child.stdin.end();
    const { code } = await bridge.closed;
    assert.equal(code, 0);
    assert.ok(bridge.stdout.bytes().equals(EXPECTED_RESPONSE), 'no extra bytes on stdout');
    assert.match(bridge.stderr.text(), /fake-agy: ready/);
    await waitFor(() => !isAlive(pid), 3_000, 'fake agy to exit');
  });

  /**
   * Remote-workspace mode (`--cindy-remote-workspace`): the task's files and commands are on another
   * computer, so Antigravity's own file and command tools would act on the wrong one.
   * Why these tests: the mode replaces the byte-for-byte relay with one that reads ACP, starts agy
   * twice and rewrites what Cindy sees; the existing relay tests cover none of it. Each case below is
   * the smallest input for one promise of the mode: tools only through Cindy, no session without them,
   * a stop when agy uses a tool of its own, and no start on an agy that was never checked.
   */
  const remoteSession = (t, extraEnv = {}) => {
    const launchFile = path.join(os.tmpdir(), `agy-acp-launch-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    t.after(() => fs.rmSync(launchFile, { force: true }));
    const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_VERSION: '1.5.13', FAKE_AGY_LAUNCHFILE: launchFile, ...extraEnv } });
    const bridge = startBridge(fixture.env, ['--cindy-remote-workspace']);
    // A failing case must not leave the entry (and the fake agy behind it) running.
    t.after(() => bridge.child.kill());
    const messages = () => bridge.stdout.text().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const send = (message) => bridge.child.stdin.write(JSON.stringify(message) + '\n');
    const reply = async (id, what) => {
      await waitFor(() => messages().some((m) => m.id === id && !m.method), 8_000, what);
      return messages().find((m) => m.id === id && !m.method);
    };
    const server = (name) => ({ type: 'http', name, url: `http://127.0.0.1:4711/mcp/${name}`, headers: [{ name: 'Authorization', value: 'Bearer task-secret' }] });
    return { launchFile, fixture, bridge, messages, send, reply, server };
  };

  test('remote-workspace mode runs the session under an agent that only has Cindy’s tools', async (t) => {
    const { launchFile, bridge, messages, send, reply, server } = remoteSession(t);
    bridge.child.stdin.write(INITIALIZE);
    const init = await reply(0, 'initialize answer');
    // agy connects to HTTP MCP servers without declaring it; Cindy hands its tools only to an agent that does.
    assert.deepEqual(init.result.agentCapabilities.mcpCapabilities, { http: true });
    assert.equal(init.result.agentInfo.title, '假 AGY ✓');

    send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/shadow/p',
      mcpServers: [server('cindy_exec'), server('cindy'), server('not a name'), { name: 'local', command: 'tool', args: [], env: [] }] } });
    assert.deepEqual((await reply(1, 'session/new answer')).result, { sessionId: 'sess-1', configOptions: [] });
    const launch = JSON.parse(fs.readFileSync(launchFile, 'utf8'));
    assert.deepEqual(launch.args.slice(-2), ['--agent', 'cindy-remote']);
    assert.deepEqual(launch.files, ['.agents'], 'agy runs in a directory holding only the agent definition');
    assert.ok(!samePath(launch.cwd, os.tmpdir()), 'not the shared temp folder');
    // One harmless tool of agy's own; the servers by name only. Their address and the task token stay in session/new.
    assert.match(launch.definition, /^tools:\n  - search_web\n  - ask_question\n  - update_steps\nmcpServers:\n  - name: cindy_exec\n  - name: cindy\n---$/m);
    assert.doesNotMatch(launch.definition, /task-secret|127\.0\.0\.1/);
    assert.deepEqual(launch.session, { cwd: '/shadow/p', mcpServers: [server('cindy_exec'), server('cindy')] });

    send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'list the files' }] } });
    await waitFor(() => messages().some((m) => m.method === 'session/request_permission'), 8_000, 'permission request');
    const permission = messages().find((m) => m.method === 'session/request_permission');
    // agy reports its generic MCP caller; Cindy must see (and check) its own Bash tool with the real arguments.
    const asked = permission.params.toolCall;
    assert.deepEqual({ title: asked.title, kind: asked.kind, rawInput: asked.rawInput, args: asked.args },
      { title: 'Bash', kind: 'execute', rawInput: { command: 'ls' }, args: undefined });
    send({ jsonrpc: '2.0', id: permission.id, result: { outcome: { outcome: 'selected', optionId: 'allow' } } });
    assert.deepEqual((await reply(2, 'prompt answer')).result, { stopReason: 'end_turn', answered: 'allow' });
    const updates = messages().filter((m) => m.method === 'session/update').map((m) => m.params.update);
    assert.deepEqual(updates.map((update) => [update.sessionUpdate, update.title, update.kind]),
      [['tool_call', 'Bash', 'execute'], ['tool_call_update', 'Bash', 'execute']]);
    assert.deepEqual(updates[0].rawInput, { command: 'ls' });

    bridge.child.stdin.end();
    assert.equal((await bridge.closed).code, 0);
    assert.ok(!fs.existsSync(launch.cwd), 'the private directory is removed when the task ends');
  });

  // Why: a task is resumed every time it is reopened (and after Cindy releases an idle connection). agy then
  // reports Cindy's tools in another form than in a new session; left as it is, Cindy would show
  // "Run mcp_cindy_exec_Bash" and could not match an approved command to the one that runs.
  test('remote-workspace mode names Cindy’s tools the same way in a resumed session', async (t) => {
    const { launchFile, bridge, messages, send, reply, server } = remoteSession(t);
    bridge.child.stdin.write(INITIALIZE);
    await reply(0, 'initialize answer');
    send({ jsonrpc: '2.0', id: 1, method: 'session/resume', params: { sessionId: 'sess-1', cwd: '/shadow/p', mcpServers: [server('cindy_exec')] } });
    await reply(1, 'session/resume answer');
    const launch = JSON.parse(fs.readFileSync(launchFile, 'utf8'));
    assert.equal(launch.method, 'session/resume');
    assert.deepEqual(launch.args.slice(-2), ['--agent', 'cindy-remote'], 'a resumed session runs under the restricted agent too');

    send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'list the files' }] } });
    await waitFor(() => messages().some((m) => m.method === 'session/request_permission'), 8_000, 'permission request');
    const permission = messages().find((m) => m.method === 'session/request_permission');
    const asked = permission.params.toolCall;
    assert.deepEqual({ title: asked.title, kind: asked.kind, rawInput: asked.rawInput, args: asked.args },
      { title: 'Bash', kind: 'execute', rawInput: { command: 'ls' }, args: undefined });
    send({ jsonrpc: '2.0', id: permission.id, result: { outcome: { outcome: 'selected', optionId: 'allow' } } });
    await reply(2, 'prompt answer');
    const updates = messages().filter((m) => m.method === 'session/update').map((m) => m.params.update);
    assert.deepEqual(updates.map((update) => [update.sessionUpdate, update.title, update.kind]),
      [['tool_call', 'Bash', 'execute'], ['tool_call_update', 'Bash', 'execute']]);
    bridge.child.stdin.end();
    assert.equal((await bridge.closed).code, 0);
  });

  test('remote-workspace mode does not start a session without Cindy’s file and command tools', async (t) => {
    const { launchFile, bridge, send, reply, server } = remoteSession(t);
    bridge.child.stdin.write(INITIALIZE);
    await reply(0, 'initialize answer');
    send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/shadow/p', mcpServers: [server('cindy')] } });
    const refused = await reply(1, 'session/new answer');
    assert.equal(refused.error.code, -32602);
    assert.match(refused.error.message, /cindy_exec/);
    assert.ok(!fs.existsSync(launchFile), 'the session process was never started');
    bridge.child.stdin.end();
    assert.equal((await bridge.closed).code, 0);
  });

  test('remote-workspace mode adapts native update_steps and ask_question updates through the relay and preserves compatibility without elicitation.form', async (t) => {
    const withForm = remoteSession(t, { FAKE_AGY_SCRIPT: 'cards' });
    withForm.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } } },
    });
    await withForm.reply(0, 'initialize answer');
    withForm.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/shadow/p', mcpServers: [withForm.server('cindy_exec')] } });
    await withForm.reply(1, 'session/new answer');
    withForm.send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'plan and ask' }] } });
    assert.deepEqual((await withForm.reply(2, 'prompt answer')).result, { stopReason: 'end_turn' });
    const updates = withForm.messages().filter((m) => m.method === 'session/update').map((m) => m.params.update);
    assert.deepEqual(updates, [
      {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Inspect', priority: 'medium', status: 'completed' },
          { content: 'Optional', priority: 'medium', status: 'completed' },
        ],
      },
      {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Verify', priority: 'medium', status: 'in_progress' },
        ],
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'steps-r2',
        kind: 'edit',
        status: 'failed',
        rawOutput: 'validation failed',
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'ask-r1',
        name: 'AskUserQuestion',
        kind: 'execute',
        title: 'AskUserQuestion',
        status: 'in_progress',
      },
    ]);
    withForm.bridge.child.stdin.end();
    assert.equal((await withForm.bridge.closed).code, 0);

    // Older Cindy hosts (without elicitation.form) keep the raw update_steps and ask_question tool rows unchanged.
    const legacy = remoteSession(t, { FAKE_AGY_SCRIPT: 'cards' });
    legacy.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false } } },
    });
    await legacy.reply(0, 'legacy initialize answer');
    legacy.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/shadow/p', mcpServers: [legacy.server('cindy_exec')] } });
    await legacy.reply(1, 'legacy session/new answer');
    legacy.send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'plan and ask' }] } });
    assert.deepEqual((await legacy.reply(2, 'legacy prompt answer')).result, { stopReason: 'end_turn' });
    const legacyUpdates = legacy.messages().filter((m) => m.method === 'session/update').map((m) => m.params.update);
    assert.equal(legacyUpdates.some((u) => u.sessionUpdate === 'plan'), false);
    assert.equal(legacyUpdates[0].name, 'update_steps');
    assert.equal(legacyUpdates.at(-1).name, 'ask_question');
    legacy.bridge.child.stdin.end();
    assert.equal((await legacy.bridge.closed).code, 0);
  });

  test('remote-workspace mode checks MCP ownership before native card adaptation while keeping local-tool blocking active', async (t) => {
    const relay = remoteSession(t, { FAKE_AGY_SCRIPT: 'cards_and_mcp' });
    relay.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } } },
    });
    await relay.reply(0, 'initialize answer');
    relay.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: { cwd: '/shadow/p', mcpServers: [relay.server('cindy_exec'), relay.server('partner')] },
    });
    await relay.reply(1, 'session/new answer');
    relay.send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'native and mcp' }] } });
    assert.deepEqual((await relay.reply(2, 'prompt answer')).result, { stopReason: 'end_turn' });
    const updates = relay.messages().filter((m) => m.method === 'session/update').map((m) => m.params.update);
    assert.deepEqual(updates, [
      {
        sessionUpdate: 'plan',
        entries: [{ content: 'Native plan', priority: 'medium', status: 'in_progress' }],
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'ask-native',
        name: 'AskUserQuestion',
        kind: 'execute',
        title: 'AskUserQuestion',
        status: 'in_progress',
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'ext-ask',
        name: 'mcp__partner__ask_question',
        kind: 'other',
        title: 'mcp__partner__ask_question',
        status: 'in_progress',
        rawInput: { prompt: 'External prompt' },
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'ext-steps',
        name: 'mcp__partner__update_steps',
        kind: 'other',
        title: 'mcp__partner__update_steps',
        status: 'in_progress',
        rawInput: { steps: [{ title: 'External step', status: 'in_progress' }] },
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'ext-steps',
        name: 'mcp__partner__update_steps',
        kind: 'other',
        title: 'mcp__partner__update_steps',
        status: 'completed',
        rawInput: { steps: [{ title: 'External step', status: 'done' }] },
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'ext-direct',
        name: 'mcp__partner__update_steps',
        kind: 'other',
        title: 'mcp__partner__update_steps',
        status: 'in_progress',
        rawInput: { steps: [{ title: 'Direct MCP step', status: 'in_progress' }] },
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'ext-direct',
        name: 'mcp__partner__update_steps',
        kind: 'other',
        title: 'mcp__partner__update_steps',
        status: 'completed',
        rawInput: { steps: [{ title: 'Direct MCP step', status: 'done' }] },
      },
    ]);
    relay.bridge.child.stdin.end();
    assert.equal((await relay.bridge.closed).code, 0);

    // Local file/command tools still terminate the remote task even when elicitation.form is negotiated.
    const blocked = remoteSession(t, { FAKE_AGY_SCRIPT: 'native' });
    blocked.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } } },
    });
    await blocked.reply(0, 'blocked initialize answer');
    blocked.send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/shadow/p', mcpServers: [blocked.server('cindy_exec')] } });
    await blocked.reply(1, 'blocked session/new answer');
    blocked.send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'write a note' }] } });
    const closed = await Promise.race([blocked.bridge.closed, new Promise((resolve) => setTimeout(() => resolve(null), 8_000))]);
    assert.ok(closed, 'the entry ended the task');
    assert.equal(closed.code, 78);
    assert.match(blocked.bridge.stderr.text(), /its own tool "write_to_file"/);
  });

  test('remote-workspace mode stops the task when Antigravity uses a tool of its own', async (t) => {
    const { fixture, bridge, messages, send, reply, server } = remoteSession(t, { FAKE_AGY_SCRIPT: 'native' });
    bridge.child.stdin.write(INITIALIZE);
    await reply(0, 'initialize answer');
    send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/shadow/p', mcpServers: [server('cindy_exec')] } });
    await reply(1, 'session/new answer');
    send({ jsonrpc: '2.0', id: 2, method: 'session/prompt', params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'write a note' }] } });
    // Nothing else ends this turn: the entry has to stop the task by itself.
    const closed = await Promise.race([bridge.closed, new Promise((resolve) => setTimeout(() => resolve(null), 8_000))]);
    assert.ok(closed, 'the entry ended the task');
    assert.equal(closed.code, 78);
    assert.match(bridge.stderr.text(), /its own tool "write_to_file"/);
    // The user is told why the task ended; the call is not passed on as work that was done.
    const updates = messages().filter((m) => m.method === 'session/update').map((m) => m.params.update);
    assert.deepEqual(updates.map((update) => update.sessionUpdate), ['agent_message_chunk']);
    const pid = readPid(fixture.pidFile);
    assert.ok(pid, 'the session process had started');
    await waitFor(() => !isAlive(pid), 4_000, 'fake agy to be stopped');
  });

  test('remote-workspace mode refuses an Antigravity CLI older than the version it was checked with', async (t) => {
    const fixture = makeFixture(t); // the fake reports 0.2.2
    const bridge = startBridge(fixture.env, ['--cindy-remote-workspace']);
    const { code } = await bridge.closed;
    assert.equal(code, 78);
    assert.equal(bridge.stdout.bytes().length, 0);
    assert.match(bridge.stderr.text(), /needs 1\.5\.13 or later/);
    assert.equal(readPid(fixture.pidFile), null, 'agy was never started for ACP');
  });

  // Why: Cindy shows 「允许被远程调用」 only for an engine that reports remoteWorkspace. main.js runs in the
  // plugin page and cannot load remote-workspace.js, so it carries its own copy of the version check; if
  // the two drift apart the switch is offered for an agy the entry then refuses (or never offered).
  test('main.js offers the engine to other computers exactly from the agy version the entry accepts', async () => {
    const { versionSupported } = (await import(pathToFileURL(path.join(root, 'remote-workspace.js')).href)).default;
    const published = async (version) => {
      const puts = [];
      class Channel { constructor() { this.onmessage = null; } postMessage() {} }
      const context = vm.createContext({
        BroadcastChannel: Channel,
        setTimeout,
        clearTimeout,
        cindy: {
          request: async () => ({ ok: true, context: { locale: 'en', uiLocale: 'en' } }),
          node: {
            request: async (request) => (request.method === 'detect'
              ? { ok: true, result: { available: true, version } }
              : { ok: true, result: { supported: true, sessionId: 'probe-1', models: [], modes: [] } }),
          },
          onHostMessage: () => () => {},
        },
        fetch: async (url, init) => {
          if (url === '/kv' && !init) return { ok: true, json: async () => ({}) };
          if (url === '/harnesses') puts.push(JSON.parse(init.body));
          return { ok: true, status: 204 };
        },
      });
      vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });
      await waitFor(() => puts.some((body) => body.harnesses[0].available), 3_000, `engine published for ${version}`);
      return puts.findLast((body) => body.harnesses[0].available).harnesses[0];
    };
    assert.deepEqual(['1.5.12', '1.5.13', '1.6.0', '2.0.1'].map(versionSupported), [false, true, true, true]);
    for (const version of ['1.5.12', '1.5.13', '1.6.0', '2.0.1']) {
      const entry = await published(version);
      assert.equal(entry.remoteWorkspace === true, versionSupported(version), version);
      assert.equal(entry.guestWorkspace === true, versionSupported(version), version);
    }
  });

  test('guest-workspace mode runs under the restricted agent and refuses session/list', async (t) => {
    const launchFile = path.join(os.tmpdir(), `agy-acp-guest-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    t.after(() => fs.rmSync(launchFile, { force: true }));
    const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_VERSION: '1.5.13', FAKE_AGY_LAUNCHFILE: launchFile } });
    const bridge = startBridge(fixture.env, ['--cindy-remote-workspace', '--cindy-guest-workspace']);
    t.after(() => bridge.child.kill());
    const messages = () => bridge.stdout.text().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const send = (message) => bridge.child.stdin.write(JSON.stringify(message) + '\n');
    const reply = async (id, what) => {
      await waitFor(() => messages().some((m) => m.id === id && !m.method), 8_000, what);
      return messages().find((m) => m.id === id && !m.method);
    };
    bridge.child.stdin.write(INITIALIZE);
    await reply(0, 'initialize answer');
    send({ jsonrpc: '2.0', id: 7, method: 'session/list', params: {} });
    assert.equal((await reply(7, 'session/list refusal')).error.code, -32601);
    bridge.child.stdin.end();
    assert.equal((await bridge.closed).code, 0);
  });

  test('stopping agy-acp leaves no agy process behind', async (t) => {
    // POSIX: the SIGTERM handler must stop a agy that ignores stdin EOF.
    // Windows: TerminateProcess skips handlers; agy must see EOF on its stdin and exit.
    const fixture = makeFixture(t, { extraEnv: isWin ? {} : { FAKE_AGY_IGNORE_EOF: '1' } });
    const bridge = startBridge(fixture.env);
    await waitFor(() => readPid(fixture.pidFile) !== null, 8_000, 'fake agy to start');
    const pid = readPid(fixture.pidFile);
    assert.ok(isAlive(pid), 'fake agy is running before the stop');
    bridge.child.kill('SIGTERM');
    const { code } = await bridge.closed;
    if (!isWin) assert.equal(code, 143);
    await waitFor(() => !isAlive(pid), 4_000, 'fake agy to be stopped');
    assert.equal(bridge.stdout.bytes().length, 0);
  });

  test('agy-acp force-stops a agy that lingers after stdin closes', async (t) => {
    // Windows: exercises the taskkill /T tree kill (cmd.exe shim and node).
    const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_IGNORE_EOF: '1' } });
    const bridge = startBridge(fixture.env);
    await waitFor(() => readPid(fixture.pidFile) !== null, 8_000, 'fake agy to start');
    const pid = readPid(fixture.pidFile);
    assert.ok(isAlive(pid), 'fake agy is running before stdin closes');
    bridge.child.stdin.end();
    const { code } = await bridge.closed;
    assert.notEqual(code, 0);
    await waitFor(() => !isAlive(pid), 3_000, 'fake agy to be stopped');
  });

  test('main.js publishes detection with PUT /harnesses and answers the settings page', async (t) => {
    const ZH = '未找到 Antigravity 命令行（agy）。请先从 https://antigravity.google 安装，然后点「重新检测」。';
    const EN = 'The Antigravity CLI (agy) was not found. Install it from https://antigravity.google, then select Check again.';
    const channels = [];
    class TrackedChannel extends BroadcastChannel {
      constructor(name) {
        super(name);
        channels.push(this);
      }
    }
    t.after(() => channels.forEach((channel) => channel.close()));
    const puts = [];
    const nodeCalls = [];
    const hostListeners = [];
    let putStatus = 404; // an older Cindy without the endpoint
    const context = vm.createContext({
      BroadcastChannel: TrackedChannel,
      setTimeout,
      clearTimeout,
      cindy: {
        request: async (request) =>
          request.kind === 'app-context' ? { ok: true, context: { region: 'cn', locale: 'zh-CN', uiLocale: 'zh-CN' } } : { ok: false },
        node: {
          request: async (request) => {
            nodeCalls.push(JSON.parse(JSON.stringify(request))); // copy out of the vm realm
            return {
              ok: true,
              result: { available: false, reason: 'not-installed', message: ZH, messages: { 'zh-CN': ZH, en: EN } },
            };
          },
        },
        onHostMessage: (listener) => {
          hostListeners.push(listener);
          return () => {};
        },
      },
      fetch: async (url, init) => {
        puts.push({ url, method: init && init.method, body: JSON.parse(init.body) });
        return { ok: putStatus < 300, status: putStatus };
      },
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });

    await waitFor(() => puts.length === 1, 3_000, 'publish on start');
    assert.deepEqual(nodeCalls[0], { method: 'detect', params: { locale: 'zh-CN' }, timeoutMs: 30_000 });
    assert.deepEqual(puts[0], {
      url: '/harnesses',
      method: 'PUT',
      body: { harnesses: [{ id: 'agy', available: false, reason: 'not-installed', message: ZH }] },
    });

    const page = new TrackedChannel(pluginId);
    const received = [];
    page.onmessage = (event) => received.push(event.data);
    putStatus = 204;
    page.postMessage({ type: 'detect-request', reqId: 'r1' });
    await waitFor(() => received.some((m) => m.type === 'detect-result'), 3_000, 'detect-result');
    assert.ok(received.some((m) => m.type === 'detect-ack' && m.reqId === 'r1'));
    const { snapshot } = received.find((m) => m.type === 'detect-result');
    assert.equal(snapshot.result.reason, 'not-installed');
    assert.deepEqual(snapshot.publish, { status: 'published' });
    assert.equal(nodeCalls.length, 2);

    // A resent request is only acknowledged again, never detected twice.
    page.postMessage({ type: 'detect-request', reqId: 'r1' });
    await waitFor(() => received.filter((m) => m.type === 'detect-ack').length === 2, 3_000, 'second ack');
    assert.equal(nodeCalls.length, 2);

    // Switching Cindy to English republishes the stored hint in English without re-detecting.
    hostListeners[0]({ type: 'host-context-changed', ok: true, context: { region: 'cn', locale: 'en', uiLocale: 'en' } });
    await waitFor(() => puts.length === 3, 3_000, 'republish after language change');
    assert.equal(puts[2].body.harnesses[0].message, EN);
    assert.equal(nodeCalls.length, 2);
  });

  // 2026-11-19:agy 未登录时会话起不来；登录后点「重新检测」要立即恢复，并发布模型与 Agent 自己的模式。
  test('main.js shows a sign-in hint until agy signs in, then publishes its models and modes', async () => {
    class Channel {
      static all = [];
      constructor(name) {
        this.name = name;
        this.onmessage = null;
        Channel.all.push(this);
      }
      postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        for (const other of Channel.all) {
          if (other !== this && other.name === this.name && other.onmessage) setTimeout(() => other.onmessage({ data: copy }), 0);
        }
      }
    }
    const nodeCalls = [];
    const puts = [];
    let savedState = null;
    let signedIn = false;
    const context = vm.createContext({
      BroadcastChannel: Channel,
      setTimeout,
      clearTimeout,
      cindy: {
        request: async () => ({ ok: true, context: { locale: 'en', uiLocale: 'en' } }),
        node: {
          request: async (request) => {
            nodeCalls.push(JSON.parse(JSON.stringify(request)));
            if (request.method === 'detect') return { ok: true, result: { available: true, version: '1.5.12' } };
            if (!signedIn) return { ok: true, result: { supported: false, reason: 'not-signed-in' } };
            return { ok: true, result: { supported: true, sessionId: 'probe-1',
              models: [{ id: 'gemini-4-neon', name: 'Gemini 4 Neon', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' }],
              modes: ['default', 'acceptEdits', 'auto', 'plan', 'yolo'], defaultMode: 'default' } };
          },
        },
        onHostMessage: () => () => {},
      },
      fetch: async (url, init) => {
        if (url === '/kv' && !init) return { ok: true, json: async () => ({}) };
        if (url === '/kv') savedState = JSON.parse(init.body);
        if (url === '/harnesses') puts.push(JSON.parse(init.body));
        return { ok: true, status: 204 };
      },
    });
    const calls = (method) => nodeCalls.filter((call) => call.method === method);
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });

    // Start-up: agy is installed but refuses a session: unavailable with the sign-in hint.
    await waitFor(() => puts.some((body) => body.harnesses[0].reason === 'not-signed-in'), 3_000, 'sign-in hint');
    assert.deepEqual(puts.at(-1), { harnesses: [{ id: 'agy', available: false, reason: 'not-signed-in', version: '1.5.12',
      message: 'Antigravity is not signed in. Open the Antigravity plugin settings and select Sign in with Google.' }] });

    // Signed in, then "Check again": listed right away (no one-minute wait) and published with the modes.
    signedIn = true;
    const page = new Channel(pluginId);
    const received = [];
    page.onmessage = (event) => received.push(event.data);
    page.postMessage({ type: 'detect-request', reqId: 'r1' });
    await waitFor(() => puts.some((body) => body.harnesses[0].modes), 3_000, 'models and modes published');
    assert.deepEqual(puts.at(-1), { harnesses: [{ id: 'agy', available: true, reportsUsage: true, ...(official ? { accounts: { methods: [] } } : {}), version: '1.5.12',
      models: [{ id: 'gemini-4-neon', name: 'Gemini 4 Neon', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' }],
      modes: ['default', 'acceptEdits', 'auto', 'plan'], defaultMode: 'default' }] });
    assert.equal(calls('listModels').length, 2);
    assert.deepEqual(savedState.modes, ['default', 'acceptEdits', 'auto', 'plan']);
    assert.equal(savedState.modelSessionId, 'probe-1');
    // The page hears the cleared hint without asking again.
    await waitFor(() => received.some((m) => m.type === 'detect-result' && m.snapshot.signInRequired === false), 3_000, 'updated snapshot');
  });

  // 2026-11-19 实测 agy 1.5.12:ACP 的 authenticate(oauth-personal)由 agy 打开浏览器登录；logout 一调用就登出。
  test('the worker signs agy in and out over ACP and reports only the sign-in and the tier', async (t) => {
    const fixture = makeFixture(t);
    const state = path.join(fixture.dir, 'agy-state');
    fixture.env.FAKE_AGY_STATE = state;
    const worker = startWorker(fixture.env);
    const call = async (id, method, params) => (await worker.call({ jsonrpc: '2.0', id, method, params })).result;
    const capabilities = { canSignIn: true, canSignOut: true };
    assert.deepEqual(await call(1, 'account', {}), { supported: true, ...capabilities, signedIn: false });
    assert.deepEqual(await call(2, 'login', {}), { ok: true, tier: { name: 'Google AI Pro' } });
    assert.deepEqual(await call(3, 'account', { sessionId: 'probe-1' }),
      { supported: true, ...capabilities, signedIn: true, tier: { name: 'Google AI Pro' } });
    assert.deepEqual(await call(4, 'logout', {}), { ok: true });
    assert.deepEqual(await call(5, 'account', {}), { supported: true, ...capabilities, signedIn: false });
    const sent = fs.readFileSync(state + '.log', 'utf8').trim().split('\n');
    assert.deepEqual(sent.filter((method) => method.startsWith('authenticate') || method === 'logout'),
      ['authenticate:oauth-personal', 'logout']);
    await worker.close();
  });

  test('cancelling a sign-in stops agy and reports it as cancelled', async (t) => {
    const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_LOGIN: 'hang' } });
    const state = path.join(fixture.dir, 'agy-state');
    fixture.env.FAKE_AGY_STATE = state;
    const worker = startWorker(fixture.env);
    const login = worker.call({ jsonrpc: '2.0', id: 1, method: 'login' });
    await waitFor(() => fs.existsSync(state + '.log') && fs.readFileSync(state + '.log', 'utf8').includes('authenticate'),
      5_000, 'sign-in sent to agy');
    const agyPid = readPid(fixture.pidFile);
    assert.deepEqual((await worker.call({ jsonrpc: '2.0', id: 2, method: 'cancelLogin' })).result, { ok: true, cancelled: true });
    assert.deepEqual((await login).result, { ok: false, error: 'cancelled' });
    await waitFor(() => !isAlive(agyPid), 5_000, 'agy stopped');
    await worker.close();
  });

  if (official) test('accountStatus reports agy’s one login with its tier as the plan, without opening agy sessions', async (t) => {
    const fixture = makeFixture(t);
    const state = path.join(fixture.dir, 'agy-state');
    fixture.env.FAKE_AGY_STATE = state;
    const worker = startWorker(fixture.env);
    t.after(() => worker.close());
    let id = 0;
    const call = async (method, params) => (await worker.call({ jsonrpc: '2.0', id: ++id, method, params })).result;
    const accountStatus = (params = { harnessId: 'agy' }) => call('accountStatus', params);
    const sent = (method) => fs.readFileSync(state + '.log', 'utf8').trim().split('\n').filter((line) => line === method).length;

    assert.deepEqual(await accountStatus(), { state: 'signed-out' });
    assert.equal((await call('login', {})).ok, true);
    // Signed in before any model listing: there is no session to read the tier from, so no plan.
    assert.deepEqual(await accountStatus(), { state: 'signed-in' });
    assert.equal((await call('listModels', {})).sessionId, 'fake-session');
    const opened = sent('session/new');
    const resumed = sent('session/resume');
    assert.deepEqual(await accountStatus(), { state: 'signed-in', plan: 'Google AI Pro' });
    assert.equal(sent('session/new'), opened, 'accountStatus opened no session');
    assert.equal(sent('session/resume'), resumed + 1, 'accountStatus resumed the model-list session');

    // Cindy can never add an Antigravity account: an account directory or another engine has no status.
    assert.equal(await accountStatus({ harnessId: 'agy', accountDir: path.join(fixture.dir, 'account-1') }), null);
    assert.equal(await accountStatus({ harnessId: 'other' }), null);

    assert.deepEqual(await call('logout', {}), { ok: true });
    assert.deepEqual(await accountStatus(), { state: 'signed-out' });
  });

  // Why: 0.4.x kept the model-list session only in main.js's /kv, and start-up skips the listing when a
  // list was saved; without the hand-over Cindy shows the upgraded login without its plan until models
  // are listed again.
  if (official) test('after an upgrade, start-up hands the saved model-list session to the worker so accountStatus reports the plan', async (t) => {
    const fixture = makeFixture(t);
    const state = path.join(fixture.dir, 'agy-state');
    fs.writeFileSync(state, 'signed-in');
    fixture.env.FAKE_AGY_STATE = state;
    const worker = startWorker(fixture.env);
    t.after(() => worker.close());
    let id = 0;
    const call = async (method, params) => (await worker.call({ jsonrpc: '2.0', id: ++id, method, params })).result;
    const sent = (method) => (fs.existsSync(state + '.log')
      ? fs.readFileSync(state + '.log', 'utf8').trim().split('\n').filter((line) => line === method).length
      : 0);
    // Before main.js starts, the worker has no session of its own to read the tier from.
    assert.deepEqual(await call('accountStatus', { harnessId: 'agy' }), { state: 'signed-in' });

    const answered = [];
    class Channel { constructor() { this.onmessage = null; } postMessage() {} }
    const context = vm.createContext({
      BroadcastChannel: Channel,
      setTimeout,
      clearTimeout,
      cindy: {
        request: async () => ({ ok: true, context: { locale: 'en', uiLocale: 'en' } }),
        node: {
          request: async (request) => {
            const result = await call(request.method, JSON.parse(JSON.stringify(request.params || {})));
            answered.push(request.method);
            return { ok: true, result };
          },
        },
        onHostMessage: () => () => {},
      },
      fetch: async (url, init) => {
        if (url === '/kv' && !init) {
          return { ok: true, json: async () => ({ models: [{ id: 'fake-model', name: 'Fake' }], modelsListedAt: Date.now(),
            modelSessionId: 'saved-session' }) };
        }
        return { ok: true, status: 204 };
      },
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });
    await waitFor(() => answered.includes('adoptModelSession'), 8_000, 'saved session handed to the worker');
    await waitFor(() => answered.includes('detect'), 8_000, 'start-up detection finished');
    assert.ok(!answered.includes('listModels'), 'start-up with a saved list does not list models');

    const opened = sent('session/new');
    const resumed = sent('session/resume');
    assert.deepEqual(await call('accountStatus', { harnessId: 'agy' }), { state: 'signed-in', plan: 'Google AI Pro' });
    assert.equal(sent('session/new'), opened, 'no agy session was opened');
    assert.equal(sent('session/resume'), resumed + 1);
    // A session the worker already remembers is kept.
    assert.deepEqual(await call('adoptModelSession', { sessionId: 'older-session' }), { ok: true, adopted: false });
  });

  if (official) test('a late model probe cannot restore the previous custom path session', async (t) => {
    const fixture = makeFixture(t);
    const state = path.join(fixture.dir, 'agy-state');
    const modelGate = path.join(fixture.dir, 'finish-model-probe');
    fs.writeFileSync(state, 'signed-in');
    fixture.env.FAKE_AGY_STATE = state;
    fixture.env.FAKE_AGY_MODEL_GATE = modelGate;
    // Copy the platform-specific test launcher to a new configured path.
    const customBin = path.join(fixture.dir, isWin ? 'custom-agy.cmd' : 'custom-agy');
    fs.copyFileSync(fixture.agyPath, customBin);
    if (!isWin) fs.chmodSync(customBin, 0o755);
    const worker = startWorker(fixture.env);
    t.after(() => { if (fs.existsSync(fixture.dir)) fs.writeFileSync(modelGate, ''); return worker.close(); });
    const listing = worker.call({ jsonrpc: '2.0', id: 1, method: 'listModels', params: {} });
    const sent = () => fs.existsSync(state + '.log') ? fs.readFileSync(state + '.log', 'utf8') : '';
    await waitFor(() => sent().includes('session/new'), 5_000, 'old model probe reached agy');
    const saved = await worker.call({ jsonrpc: '2.0', id: 2, method: 'setCustomPath', params: { path: customBin } });
    assert.equal(saved.result.ok, true);
    fs.writeFileSync(modelGate, '');
    assert.equal((await listing).result.sessionId, 'fake-session');
    const status = await worker.call({ jsonrpc: '2.0', id: 3, method: 'accountStatus', params: { harnessId: 'agy' } });
    assert.deepEqual(status.result, { state: 'signed-in' });
    assert.ok(!sent().includes('session/resume'), 'the new path never resumes the old probe');
  });

  if (official) test('a late account read is discarded after signing out', async (t) => {
    const fixture = makeFixture(t);
    const state = path.join(fixture.dir, 'agy-state');
    const resumeGate = path.join(fixture.dir, 'finish-account-read');
    fs.writeFileSync(state, 'signed-in');
    fixture.env.FAKE_AGY_STATE = state;
    fixture.env.FAKE_AGY_RESUME_GATE = resumeGate;
    const worker = startWorker(fixture.env);
    t.after(() => { if (fs.existsSync(fixture.dir)) fs.writeFileSync(resumeGate, ''); return worker.close(); });
    const args = { harnessId: 'agy' };
    assert.equal((await worker.call({ jsonrpc: '2.0', id: 1, method: 'listModels', params: {} })).result.sessionId, 'fake-session');
    const pending = worker.call({ jsonrpc: '2.0', id: 2, method: 'accountStatus', params: args });
    await waitFor(() => fs.readFileSync(state + '.log', 'utf8').includes('session/resume'), 5_000, 'account request has read old sign-in');
    assert.deepEqual((await worker.call({ jsonrpc: '2.0', id: 3, method: 'logout', params: {} })).result, { ok: true });
    fs.writeFileSync(resumeGate, '');
    assert.equal((await pending).result, null);
    assert.deepEqual((await worker.call({ jsonrpc: '2.0', id: 4, method: 'accountStatus', params: args })).result, { state: 'signed-out' });
  });

  if (official) test('accountStatus answers null instead of guessing when agy is missing or the check fails', async (t) => {
    if (systemHasAgy()) {
      t.skip('a real agy is installed in a fixed system directory on this machine');
      return;
    }
    const request = { jsonrpc: '2.0', id: 1, method: 'accountStatus', params: { harnessId: 'agy' } };
    const missing = startWorker(makeFixture(t, { withAgy: false }).env);
    t.after(() => missing.close());
    assert.equal((await missing.call(request)).result, null);

    const crashing = makeFixture(t, { extraEnv: { FAKE_AGY_CRASH: '1' } });
    crashing.env.FAKE_AGY_STATE = path.join(crashing.dir, 'agy-state');
    const worker = startWorker(crashing.env);
    t.after(() => worker.close());
    assert.equal((await worker.call(request)).result, null);
    // The settings page still sees the failure itself.
    assert.equal((await worker.call({ jsonrpc: '2.0', id: 2, method: 'account', params: {} })).result.error, 'status-failed');
  });

  // 登录前就开始读取模型时，它晚于登录返回的「未登录」不能把引擎改回未登录。
  test('main.js signs in and out for the settings page and keeps Cindy’s engine status in step', async () => {
    class Channel {
      static all = [];
      constructor(name) {
        this.name = name;
        this.onmessage = null;
        Channel.all.push(this);
      }
      postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        for (const other of Channel.all) {
          if (other !== this && other.name === this.name && other.onmessage) setTimeout(() => other.onmessage({ data: copy }), 0);
        }
      }
    }
    const nodeCalls = [];
    const puts = [];
    let finishFirstListing = null;
    const context = vm.createContext({
      BroadcastChannel: Channel,
      setTimeout,
      clearTimeout,
      cindy: {
        request: async () => ({ ok: true, context: { locale: 'zh-CN', uiLocale: 'zh-CN' } }),
        node: {
          request: async (request) => {
            nodeCalls.push(JSON.parse(JSON.stringify(request)));
            if (request.method === 'detect') return { ok: true, result: { available: true, version: '1.5.12' } };
            if (request.method === 'listModels' && !finishFirstListing) {
              // The start-up listing began while agy was signed out and answers only after the sign-in.
              return new Promise((resolve) => {
                finishFirstListing = () => resolve({ ok: true, result: { supported: false, reason: 'not-signed-in' } });
              });
            }
            if (request.method === 'listModels') {
              return { ok: true, result: { supported: true, sessionId: 'probe-1', tier: { name: 'Google AI Pro' },
                models: [{ id: 'gemini-4-neon', name: 'Gemini 4 Neon' }] } };
            }
            if (request.method === 'login') return { ok: true, result: { ok: true, tier: { name: 'Google AI Pro' } } };
            if (request.method === 'logout') return { ok: true, result: { ok: true } };
            return { ok: false };
          },
        },
        onHostMessage: () => () => {},
      },
      fetch: async (url, init) => {
        if (url === '/kv' && !init) return { ok: true, json: async () => ({}) };
        if (url === '/harnesses') puts.push(JSON.parse(init.body).harnesses[0]);
        return { ok: true, status: 204 };
      },
    });
    const calls = (method) => nodeCalls.filter((call) => call.method === method);
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });
    await waitFor(() => finishFirstListing, 3_000, 'start-up listing');

    const page = new Channel(pluginId);
    const received = [];
    page.onmessage = (event) => received.push(event.data);
    const result = (reqId) => received.find((m) => m.type === 'account-result' && m.reqId === reqId);
    page.postMessage({ type: 'account-request', reqId: 'a1', op: 'login' });
    page.postMessage({ type: 'account-request', reqId: 'a1', op: 'login' }); // resent before the ack
    await waitFor(() => result('a1'), 3_000, 'sign-in result');
    assert.deepEqual(calls('login'), [{ method: 'login', params: {}, timeoutMs: 30_000, maxTotalMs: 330_000 }]);
    assert.deepEqual(result('a1').account, { signedIn: true, tier: 'Google AI Pro', canSignIn: true, canSignOut: true, busy: null });

    finishFirstListing();
    await waitFor(() => puts.length && puts.at(-1).models, 3_000, 'models read again after the sign-in');
    assert.ok(puts.every((entry) => entry.available), 'the late listing never marks the engine signed out');
    assert.deepEqual(puts.at(-1), { id: 'agy', available: true, reportsUsage: true, ...(official ? { accounts: { methods: [] } } : {}), version: '1.5.12', models: [{ id: 'gemini-4-neon', name: 'Gemini 4 Neon' }] });

    page.postMessage({ type: 'account-request', reqId: 'a2', op: 'logout' });
    await waitFor(() => result('a2'), 3_000, 'sign-out result');
    assert.equal(calls('logout').length, 1);
    assert.equal(result('a2').account.signedIn, false);
    assert.deepEqual(puts.at(-1), { id: 'agy', available: false, reason: 'not-signed-in', version: '1.5.12',
      message: 'Antigravity 还没有登录。请打开 Antigravity 插件设置，点「用 Google 登录」。' });
  });

  // agy 的 logout 一调用就登出(2026-11-19 实测)：设置页只在用户确认后才发出退出请求。
  test('the settings page resumes a CLI update after reopening and confirms sign-out', async () => {
    class Channel {
      static all = [];
      constructor(name) {
        this.name = name;
        this.onmessage = null;
        this.listeners = [];

        Channel.all.push(this);
      }
      addEventListener(type, listener) { if (type === 'message') this.listeners.push(listener); }
      postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        for (const other of Channel.all) {
          if (other === this || other.name !== this.name) continue;
          setTimeout(() => {
            other.onmessage?.({ data: copy });
            for (const listener of other.listeners) listener({ data: copy });
          }, 0);
        }
      }
    }
    const elements = new Map();
    const element = (id) => {
      if (!elements.has(id)) {
        const listeners = {};
        elements.set(id, { id, textContent: '', hidden: false, disabled: false, attributes: {}, dataset: {}, listeners,
          setAttribute(name, value) { this.attributes[name] = value; },
          addEventListener(type, listener) { listeners[type] = listener; },
          focus() {},
          click() { listeners.click(); } });
      }
      return elements.get(id);
    };
    const context = vm.createContext({
      BroadcastChannel: Channel, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval,
      document: { getElementById: element, documentElement: {}, visibilityState: 'visible', addEventListener() {} },
      fetch: async (url) => ({ ok: true,
        json: async () => (url === '/app-context' ? { context: { uiLocale: 'zh-CN' } } : { state: 'on' }) }),
    });
    // Stands in for main.js: agy is installed and signed in.
    const main = new Channel(pluginId);
    const requests = [];
    const maintenance = [];
    let version = '1.5.11';
    let maintenanceState = { type: 'cli-state' };
    let finishUpdate;
    const account = { signedIn: true, tier: 'Google AI Pro', canSignIn: true, canSignOut: true, busy: null };
    main.onmessage = ({ data }) => {
      if (data.type === 'detect-request') {
        main.postMessage({ type: 'detect-ack', reqId: data.reqId });
        main.postMessage({ type: 'detect-result', reqId: data.reqId, snapshot: { ok: true, account,
          result: { available: true, version }, signInRequired: false, publish: { status: 'published' }, checkedAt: 1 } });
      }
      if (data.type === 'cli-state-request') main.postMessage(maintenanceState);
      if (data.type === 'cli-maintenance') {
        maintenance.push(data);
        const status = { type: 'cli-state', reqId: data.reqId, action: data.action };
        if (data.action === 'check') {
          maintenanceState = { ...status, result: { state: 'newer', version: '1.5.12' } };
        } else {
          maintenanceState = { ...status, active: true };
          finishUpdate = () => {
            version = data.version;
            maintenanceState = { ...status, result: { state: 'installed', version } };
            main.postMessage(maintenanceState);
          };
        }
        main.postMessage(maintenanceState);
      }
      if (data.type === 'account-request') {
        requests.push(data.op);
        main.postMessage({ type: 'account-ack', reqId: data.reqId });
        main.postMessage({ type: 'account-result', reqId: data.reqId, op: data.op, account });
      }
    };
    context.window = context;
    vm.runInContext(fs.readFileSync(path.join(root, 'cli-settings.js'), 'utf8'), context, { filename: 'cli-settings.js' });
    const openSettings = () => vm.runInContext(fs.readFileSync(path.join(root, 'settings.js'), 'utf8'), context, { filename: 'settings.js' });
    openSettings();

    await waitFor(() => element('account-status').textContent === '已登录 · Google AI Pro', 3_000, 'signed-in status');
    assert.equal(element('badge').textContent, '可以使用');
    assert.equal(element('account-logout').hidden, false);
    assert.equal(element('account-login').hidden, true);
    // After each detection the page also asks once whether agy is signed in.
    await waitFor(() => requests.length > 0, 3_000, 'sign-in check after detection');
    assert.deepEqual(requests, ['status']);
    element('account-logout').click();
    assert.equal(element('account-confirm').hidden, false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(requests, ['status'], 'choosing Sign out only asks for confirmation');
    element('account-confirm-yes').click();
    await waitFor(() => requests.includes('logout'), 3_000, 'sign-out request after confirming');

    await waitFor(() => element('cli-action').textContent === '更新到 1.5.12', 3_000, 'automatic update check');
    assert.deepEqual(maintenance.map(item => item.action), ['check']);
    assert.equal(element('recheck').attributes['aria-label'], '检测 CLI 版本和更新');
    element('recheck').click();
    await waitFor(() => maintenance.length === 2 && !element('recheck').disabled, 3_000, 'manual check completed');
    assert.deepEqual(maintenance.map(item => item.action), ['check', 'check']);
    element('cli-action').click();
    await waitFor(() => !!finishUpdate, 3_000, 'CLI update started');
    await waitFor(() => maintenanceState.active, 3_000, 'active state published');
    Channel.all = [main];
    elements.clear();
    openSettings();
    await waitFor(() => element('cli-status').textContent === '正在更新…', 3_000, 'restored update in progress');
    assert.equal(element('recheck').disabled, true);
    assert.equal(element('cli-action').hidden, true);
    finishUpdate();
    await waitFor(() => element('version').textContent === '1.5.12', 3_000, 'local CLI version after refresh');
    assert.equal(element('recheck').disabled, false);
    assert.equal(element('cli-action').hidden, true);
    assert.deepEqual(maintenance.map(item => item.action), ['check', 'check', 'update']);
    assert.equal(maintenance[2].version, '1.5.12');
  });

  test('listModels reads the model option agy offers, flattening its groups', async () => {
    const { modelsFromConfigOptions } = await import(pathToFileURL(path.join(root, 'agy-models.js')).href);
    assert.deepEqual(modelsFromConfigOptions([
      { id: 'reasoning_effort', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'high', name: 'High' }] },
      { id: 'model', category: 'model', type: 'select', currentValue: 'gemini-4-neon', options: [
        { name: 'Models', options: [
          { value: 'gemini-4-neon', name: 'Gemini 4 Neon' },
          { value: 'claude-opus-5-5', name: 'Claude Opus 5.5', description: 'Anthropic via Antigravity' },
          { value: 'claude-opus-5-5', name: 'duplicate' },
          { name: 'no value' },
        ] },
      ] },
    ]), [
      { id: 'gemini-4-neon', name: 'Gemini 4 Neon', group: 'Models' },
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', description: 'Anthropic via Antigravity', group: 'Models' },
    ]);
    assert.deepEqual(modelsFromConfigOptions(undefined), []);
  });

  // 测试的是与 DSH 插件同一套档位规则(DSH 的 off 在 Cindy 中没有对应档)；agy 1.5.12 是 low / medium / high / xhigh。
  test('reasoning levels come from the thought_level option, keeping only Cindy level ids', async () => {
    const { effortsFromConfigOptions } = await import(pathToFileURL(path.join(root, 'agy-models.js')).href);
    const thought = (currentValue, values) => [{ id: 'reasoning_effort', category: 'thought_level', type: 'select', currentValue,
      options: values.map((value) => ({ value, name: value })) }];
    assert.deepEqual(effortsFromConfigOptions(thought('high', ['off', 'low', 'high', 'max'])),
      { efforts: ['low', 'high', 'max'], defaultEffort: 'high' });
    assert.deepEqual(effortsFromConfigOptions(thought('off', ['max', 'off', 'low'])), { efforts: ['low', 'max'] });
    assert.deepEqual(effortsFromConfigOptions(thought('off', ['off'])), {});
    assert.deepEqual(effortsFromConfigOptions(undefined), {});
  });

  // agy 1.5.12 的 mode 配置项：default / accept-edits / auto / plan(2026-11-19 实测)。
  test('working modes map to Cindy permission mode ids in agy’s order', async () => {
    const { modesFromConfigOptions } = await import(pathToFileURL(path.join(root, 'agy-models.js')).href);
    const mode = (currentValue, values) => [{ id: 'mode', category: 'mode', type: 'select', currentValue,
      options: values.map((value) => ({ value, name: value })) }];
    assert.deepEqual(modesFromConfigOptions(mode('default', ['default', 'accept-edits', 'auto', 'plan', 'yolo'])),
      { modes: ['default', 'acceptEdits', 'auto', 'plan'], defaultMode: 'default' });
    assert.deepEqual(modesFromConfigOptions(mode('yolo', ['plan', 'yolo'])), { modes: ['plan'] });
    assert.deepEqual(modesFromConfigOptions(mode('yolo', ['yolo'])), {});
    assert.deepEqual(modesFromConfigOptions(undefined), {});
  });

  test('agy-acp exits 127 with a single stderr line when agy is missing', async (t) => {
    if (systemHasAgy()) {
      t.skip('a real agy is installed in a fixed system directory on this machine');
      return;
    }
    const fixture = makeFixture(t, { withAgy: false });
    const bridge = startBridge(fixture.env);
    const { code } = await bridge.closed;
    assert.equal(code, 127);
    assert.equal(bridge.stdout.bytes().length, 0);
    assert.match(bridge.stderr.text(), /^\[agy-acp\] [^\n]*https:\/\/antigravity\.google[^\n]*\n$/);
  });

  test('custom agy path is shared by detect, account, login, listModels, usage, and agy-acp, and blocks unsafe fallbacks', async (t) => {
    const stateFile = path.join(os.tmpdir(), `agy-custom-state-${process.pid}-${Date.now()}`);
    t.after(() => {
      fs.rmSync(stateFile, { force: true });
      fs.rmSync(stateFile + '.log', { force: true });
    });
    const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_STATE: stateFile } });
    const customDir = path.join(fixture.dir, 'custom');
    fs.mkdirSync(customDir);
    const customScript = path.join(customDir, 'custom-agy.js');
    fs.writeFileSync(customScript, FAKE_AGY_SOURCE, 'utf8');
    const callsFile = path.join(fixture.dir, 'custom.calls');
    const argsFile = path.join(fixture.dir, 'custom.args');
    let customBin;
    let brokenBin;
    if (isWin) {
      customBin = path.join(customDir, 'my-agy.cmd');
      fs.writeFileSync(customBin, `@set FAKE_AGY_VERSION=9.9.9\r\n@echo %*>>"${callsFile}"\r\n@"${process.execPath}" "${customScript}" %*\r\n`);
      brokenBin = path.join(customDir, 'broken-agy.cmd');
      fs.writeFileSync(brokenBin, `@set FAKE_AGY_BROKEN=1\r\n@"${process.execPath}" "${customScript}" %*\r\n`);
    } else {
      customBin = path.join(customDir, 'my-agy');
      fs.writeFileSync(customBin, `#!/bin/sh\necho "$@" >> "${callsFile}"\nFAKE_AGY_VERSION=9.9.9 exec "${process.execPath}" "${customScript}" "$@"\n`);
      fs.chmodSync(customBin, 0o755);
      brokenBin = path.join(customDir, 'broken-agy');
      fs.writeFileSync(brokenBin, `#!/bin/sh\nFAKE_AGY_BROKEN=1 exec "${process.execPath}" "${customScript}" "$@"\n`);
      fs.chmodSync(brokenBin, 0o755);
    }

    const env = { ...fixture.env, FAKE_AGY_ARGSFILE: argsFile };
    const worker = startWorker(env);
    t.after(() => worker.close());

    // Malformed, relative, missing, and non-runnable paths are rejected without saving config.json.
    const badMissingParam = await worker.call({ jsonrpc: '2.0', id: 1, method: 'setCustomPath', params: {} });
    assert.deepEqual(badMissingParam.result, { ok: false, error: 'not-absolute' });
    const badType = await worker.call({ jsonrpc: '2.0', id: 2, method: 'setCustomPath', params: { path: 42 } });
    assert.deepEqual(badType.result, { ok: false, error: 'not-absolute' });
    const badRel = await worker.call({ jsonrpc: '2.0', id: 3, method: 'setCustomPath', params: { path: 'agy', locale: 'en' } });
    assert.deepEqual(badRel.result, { ok: false, error: 'not-absolute' });
    const badMissing = await worker.call({ jsonrpc: '2.0', id: 4, method: 'setCustomPath', params: { path: path.join(customDir, 'nope'), locale: 'en' } });
    assert.deepEqual(badMissing.result, { ok: false, error: 'not-found' });
    const badProbe = await worker.call({ jsonrpc: '2.0', id: 5, method: 'setCustomPath', params: { path: brokenBin, locale: 'en' } });
    assert.equal(badProbe.result.ok, false);
    assert.equal(badProbe.result.error, 'not-runnable');
    const afterFailedSave = await worker.call({ jsonrpc: '2.0', id: 6, method: 'detect', params: { locale: 'en' } });
    assert.equal(afterFailedSave.result.customPath, undefined);
    assert.equal(afterFailedSave.result.version, '0.2.2');

    // Saving a quoted custom path succeeds and routes detect, account, login, listModels, usage, and agy-acp to it.
    const saved = await worker.call({ jsonrpc: '2.0', id: 7, method: 'setCustomPath', params: { path: `"${customBin}"`, locale: 'en' } });
    assert.equal(saved.result.ok, true);
    assert.ok(samePath(saved.result.customPath, customBin));
    assert.equal(saved.result.detection.available, true);
    assert.equal(saved.result.detection.version, '9.9.9');
    assert.equal(saved.result.detection.customPathConfigured, true);
    assert.ok(samePath(saved.result.detection.path, customBin));
    assert.ok(samePath(saved.result.detection.customPath, customBin));

    // Malformed setCustomPath must NOT clear the saved config.
    const badTypeAfterSave = await worker.call({ jsonrpc: '2.0', id: 8, method: 'setCustomPath', params: {} });
    assert.deepEqual(badTypeAfterSave.result, { ok: false, error: 'not-absolute' });

    const acctBefore = await worker.call({ jsonrpc: '2.0', id: 9, method: 'account', params: {} });
    assert.equal(acctBefore.result.supported, true);
    assert.equal(acctBefore.result.signedIn, false);
    const loginRes = await worker.call({ jsonrpc: '2.0', id: 10, method: 'login', params: {} });
    assert.equal(loginRes.result.ok, true);
    const modelsRes = await worker.call({ jsonrpc: '2.0', id: 11, method: 'listModels', params: {} });
    assert.equal(modelsRes.result.supported, true);
    assert.equal(modelsRes.result.models[0]?.name, 'Fake 9.9.9');
    const usageRes = await worker.call({ jsonrpc: '2.0', id: 12, method: 'usage', params: {} });
    assert.equal(usageRes.result.windows[0].label, '9.9.9 · 5h');

    // agy-acp launches the custom binary with constant ACP_ARGS.
    const bridgeEnv = { ...env };
    delete bridgeEnv.FAKE_AGY_STATE;
    const callsBeforeAcp = fs.readFileSync(callsFile, 'utf8').trim().split(/\r?\n/).length;
    const bridge = startBridge(bridgeEnv);
    bridge.child.stdin.write(INITIALIZE);
    await waitFor(() => bridge.stdout.bytes().length >= EXPECTED_RESPONSE.length, 8_000, 'custom agy initialize');
    bridge.child.stdin.end();
    const { code } = await bridge.closed;
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(argsFile, 'utf8')), EXPECTED_ACP_ARGS);
    const customCalls = fs.readFileSync(callsFile, 'utf8').trim().split(/\r?\n/);
    // The probes and account calls above already reached six calls: only a call logged after callsBeforeAcp is the launch.
    assert.ok(customCalls.length > callsBeforeAcp, 'agy-acp itself started the configured binary');
    assert.match(customCalls.at(-1), /acp --disable-telemetry$/);

    // If the configured custom binary is removed, never fall back to PATH and refuse standard install.
    fs.rmSync(customBin);
    const missingDetect = await worker.call({ jsonrpc: '2.0', id: 13, method: 'detect', params: { locale: 'en' } });
    assert.equal(missingDetect.result.available, false);
    assert.equal(missingDetect.result.reason, 'custom-path-unavailable');
    assert.equal(missingDetect.result.customPathConfigured, true);
    assert.equal(missingDetect.result.path, undefined);
    assert.ok(samePath(missingDetect.result.customPath, customBin));
    assert.doesNotMatch(missingDetect.result.message, /antigravity\.google/i);
    const blockedInstall = await worker.call({ jsonrpc: '2.0', id: 14, method: 'cliMaintenance', params: { action: 'install' } });
    assert.deepEqual(blockedInstall.result, { error: 'custom-path' });
    const brokenBridge = startBridge(bridgeEnv);
    const brokenClosed = await brokenBridge.closed;
    assert.equal(brokenClosed.code, 127);
    assert.match(brokenBridge.stderr.text(), /configured Antigravity CLI path/);

    // A corrupt config.json also refuses PATH fallback and blocks standard install.
    const { configFilePath } = await import(pathToFileURL(path.join(root, 'resolve-agy.js')).href);
    const cfgFile = configFilePath({ env });
    fs.writeFileSync(cfgFile, '{"customPath":', 'utf8');
    const corruptDetect = await worker.call({ jsonrpc: '2.0', id: 15, method: 'detect', params: { locale: 'en' } });
    assert.equal(corruptDetect.result.available, false);
    assert.equal(corruptDetect.result.reason, 'custom-path-unavailable');
    assert.equal(corruptDetect.result.customPathConfigured, true);
    assert.equal(corruptDetect.result.path, undefined);
    const blockedCorruptInstall = await worker.call({ jsonrpc: '2.0', id: 16, method: 'cliMaintenance', params: { action: 'install' } });
    assert.deepEqual(blockedCorruptInstall.result, { error: 'custom-path' });

    // Clearing the custom path restores PATH auto-discovery.
    const cleared = await worker.call({ jsonrpc: '2.0', id: 17, method: 'setCustomPath', params: { path: '', locale: 'en' } });
    assert.equal(cleared.result.ok, true);
    assert.equal(cleared.result.customPath, null);
    assert.equal(cleared.result.detection.available, true);
    assert.equal(cleared.result.detection.version, '0.2.2');
    assert.equal(cleared.result.detection.customPath, undefined);
    assert.ok(samePath(cleared.result.detection.path, fixture.agyPath));
    await worker.close();
  });

  test('validateCustomPath and configFilePath enforce Windows drive/UNC, cmd safety, LOCALAPPDATA, and POSIX permissions', async (t) => {
    const { configFilePath, validateCustomPath } = await import(pathToFileURL(path.join(root, 'resolve-agy.js')).href);
    assert.deepEqual(validateCustomPath('\\bin\\agy.cmd', { platform: 'win32', env: {} }), { ok: false, error: 'not-absolute' });
    assert.deepEqual(validateCustomPath('C:bin\\agy.cmd', { platform: 'win32', env: {} }), { ok: false, error: 'not-absolute' });
    assert.deepEqual(validateCustomPath('C:\\bad%path\\agy.cmd', { platform: 'win32', env: {} }), { ok: false, error: 'unsafe-path' });
    assert.deepEqual(validateCustomPath('relative/agy', { platform: 'darwin', env: { HOME: '/tmp' } }), { ok: false, error: 'not-absolute' });
    assert.equal(
      configFilePath({ platform: 'win32', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' } }),
      path.win32.join('C:\\Users\\a\\AppData\\Local', official ? pluginId : 'cindy-agy-acp', 'config.json'),
    );
    if (!isWin) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-perm-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const plain = path.join(dir, 'agy');
      fs.writeFileSync(plain, '#!/bin/sh\n', { mode: 0o644 });
      assert.deepEqual(validateCustomPath(plain, { platform: process.platform, env: {} }), { ok: false, error: 'not-executable' });
    }
  });

  test('main.js discards stale detect/listModels from the old binary, refreshes usage, and never leaks paths', async () => {
    class Channel {
      static all = [];
      constructor(name) { this.name = name; this.onmessage = null; Channel.all.push(this); }
      postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        for (const other of Channel.all) {
          if (other !== this && other.name === this.name && other.onmessage) setTimeout(() => other.onmessage({ data: copy }), 0);
        }
      }
    }
    const puts = [];
    const nodeCalls = [];
    let resolveListA;
    let resolveDetectA;
    let listCount = 0;
    let detectCount = 0;
    const context = vm.createContext({
      BroadcastChannel: Channel, setTimeout, clearTimeout,
      cindy: {
        request: async () => ({ ok: true, context: { locale: 'en', uiLocale: 'en' } }),
        node: {
          request: async (request) => {
            nodeCalls.push(JSON.parse(JSON.stringify(request)));
            if (request.method === 'detect') {
              detectCount += 1;
              if (detectCount === 1) {
                return { ok: true, result: { available: true, path: '/bin/agy-a', version: '1.0.0' } };
              }
              return new Promise((resolve) => { resolveDetectA = resolve; });
            }
            if (request.method === 'listModels') {
              listCount += 1;
              if (listCount === 1) return new Promise((resolve) => { resolveListA = resolve; });
              return { ok: true, result: { supported: true, models: [{ id: 'model-b', name: 'Model B' }], sessionId: 'sess-b' } };
            }
            if (request.method === 'setCustomPath') {
              if (request.params.path === '/missing/agy') {
                return { ok: true, result: { ok: true, customPath: '/missing/agy', detection: {
                  available: false, reason: 'custom-path-unavailable', customPath: '/missing/agy', customPathConfigured: true,
                  message: 'The configured Antigravity CLI path is unavailable. Open the Antigravity plugin settings to update it or switch back to auto-detect.',
                  messages: { en: 'The configured Antigravity CLI path is unavailable. Open the Antigravity plugin settings to update it or switch back to auto-detect.' },
                } } };
              }
              return { ok: true, result: { ok: true, customPath: '/opt/agy-b', detection: {
                available: true, path: '/opt/agy-b', customPath: '/opt/agy-b', customPathConfigured: true, version: '2.0.0',
              } } };
            }
            if (request.method === 'usage') {
              return { ok: true, result: { updatedAt: 1, windows: [{ label: 'B · 5h', remainingPercent: 80 }] } };
            }
            return { ok: false };
          },
        },
        onHostMessage: () => () => {},
      },
      fetch: async (url, init) => {
        if (url === '/kv' && !init) return { ok: true, json: async () => ({}) };
        if (url === '/harnesses') puts.push(JSON.parse(init.body).harnesses[0]);
        return { ok: true, status: 204 };
      },
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });
    await waitFor(() => listCount === 1, 3_000, 'initial listModels for A in flight');

    const page = new Channel(pluginId);
    const received = [];
    page.onmessage = (event) => received.push(event.data);

    // Start a slow detect on A, then switch to B before either detect or listModels(A) settles.
    page.postMessage({ type: 'detect-request', reqId: 'd-stale' });
    await waitFor(() => typeof resolveDetectA === 'function', 3_000, 'slow detect A in flight');
    page.postMessage({ type: 'custom-path-request', reqId: 'p1', path: '/opt/agy-b' });
    await waitFor(() => received.some((m) => m.type === 'custom-path-result' && m.reqId === 'p1'), 3_000, 'custom-path-result B');
    await waitFor(() => listCount === 2, 3_000, 'fresh listModels for B');

    // Now release the stale detect(A) and listModels(A); neither may overwrite B.
    resolveDetectA({ ok: true, result: { available: true, path: '/bin/agy-a', version: '1.0.0' } });
    resolveListA({ ok: true, result: { supported: true, models: [{ id: 'model-a', name: 'Model A' }], sessionId: 'sess-a' } });
    await waitFor(() => puts.some((entry) => entry.version === '2.0.0' && entry.models?.[0]?.id === 'model-b'), 3_000, 'published B models');
    await waitFor(() => received.some((m) => m.type === 'harness-usage' && m.usage?.windows?.[0]?.label === 'B · 5h'), 3_000, 'refreshed usage for B');

    const latest = puts.at(-1);
    assert.equal(latest.version, '2.0.0');
    assert.deepEqual(latest.models, [{ id: 'model-b', name: 'Model B' }]);
    assert.equal(latest.path, undefined);
    assert.equal(latest.customPath, undefined);
    assert.ok(!puts.some((entry) => entry.version === '2.0.0' && entry.models?.[0]?.id === 'model-a'), 'never pairs B version with A models');

    // Unavailable custom path publishes a path-free settings message, never an antigravity.google install prompt.
    page.postMessage({ type: 'custom-path-request', reqId: 'p2', path: '/missing/agy' });
    await waitFor(() => received.some((m) => m.type === 'custom-path-result' && m.reqId === 'p2'), 3_000, 'unavailable custom path');
    const unavailablePut = puts.at(-1);
    assert.equal(unavailablePut.available, false);
    assert.match(unavailablePut.message, /plugin settings/i);
    assert.doesNotMatch(unavailablePut.message, /\/missing\/agy|antigravity\.google/i);
  });

  test('settings.js + cli-settings.js disable unchanged save, re-translate notes, hide install for unavailable custom path, and reset', async () => {
    class Channel {
      static all = [];
      constructor(name) { this.name = name; this.onmessage = null; this.listeners = []; Channel.all.push(this); }
      addEventListener(type, listener) { if (type === 'message') this.listeners.push(listener); }
      postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        for (const other of Channel.all) {
          if (other === this || other.name !== this.name) continue;
          setTimeout(() => {
            other.onmessage?.({ data: copy });
            for (const listener of other.listeners) listener({ data: copy });
          }, 0);
        }
      }
    }
    const elements = new Map();
    const element = (id) => {
      if (!elements.has(id)) {
        const listeners = {};
        elements.set(id, { id, value: '', placeholder: '', textContent: '', hidden: false, disabled: false, attributes: {}, dataset: {}, listeners,
          setAttribute(name, value) { this.attributes[name] = value; },
          addEventListener(type, listener) { listeners[type] = listener; },
          focus() {},
          click() { listeners.click(); } });
      }
      return elements.get(id);
    };
    let currentLocale = 'en';
    const context = vm.createContext({
      BroadcastChannel: Channel, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval,
      document: { getElementById: element, documentElement: {}, visibilityState: 'visible', addEventListener() {} },
      fetch: async (url) => ({ ok: true, json: async () => (url === '/app-context' ? { context: { uiLocale: currentLocale } } : { state: 'on' }) }),
    });
    const main = new Channel(pluginId);
    const savedPaths = [];
    const cliActions = [];
    const account = { signedIn: true, canSignIn: true, canSignOut: true, busy: null };
    main.onmessage = ({ data }) => {
      if (data.type === 'detect-request') {
        main.postMessage({ type: 'detect-ack', reqId: data.reqId });
        main.postMessage({ type: 'detect-result', reqId: data.reqId, snapshot: { ok: true, account,
          result: { available: true, version: '1.5.9', path: '/usr/local/bin/agy' }, signInRequired: false, publish: { status: 'published' }, checkedAt: 1 } });
      }
      if (data.type === 'cli-state-request') main.postMessage({ type: 'cli-state' });
      if (data.type === 'cli-maintenance') {
        cliActions.push(data.action);
        main.postMessage({ type: 'cli-state', reqId: data.reqId, action: data.action, active: false, result: { state: 'current', version: '1.5.9' } });
      }
      if (data.type === 'account-request') {
        main.postMessage({ type: 'account-ack', reqId: data.reqId });
        main.postMessage({ type: 'account-result', reqId: data.reqId, op: data.op, account });
      }
      if (data.type === 'custom-path-request') {
        savedPaths.push(data.path);
        main.postMessage({ type: 'custom-path-ack', reqId: data.reqId });
        if (data.path === 'bad') {
          main.postMessage({ type: 'custom-path-result', reqId: data.reqId, ok: false, error: 'not-absolute' });
        } else if (data.path === '/gone/agy') {
          main.postMessage({ type: 'custom-path-result', reqId: data.reqId, ok: true, snapshot: { ok: true, account,
            result: { available: false, reason: 'custom-path-unavailable', customPath: '/gone/agy', customPathConfigured: true },
            signInRequired: false, publish: { status: 'published' }, checkedAt: 2 } });
        } else {
          const customPath = data.path || undefined;
          main.postMessage({ type: 'custom-path-result', reqId: data.reqId, ok: true, snapshot: { ok: true, account,
            result: { available: true, version: customPath ? '9.9.9' : '1.5.9', path: customPath || '/usr/local/bin/agy', ...(customPath ? { customPath, customPathConfigured: true } : {}) },
            signInRequired: false, publish: { status: 'published' }, checkedAt: 3 } });
        }
      }
    };
    context.window = context;
    vm.runInContext(fs.readFileSync(path.join(root, 'cli-settings.js'), 'utf8'), context, { filename: 'cli-settings.js' });
    vm.runInContext(fs.readFileSync(path.join(root, 'settings.js'), 'utf8'), context, { filename: 'settings.js' });

    await waitFor(() => element('version').textContent === '1.5.9', 3_000, 'initial detect');
    assert.equal(element('custom-path-reset').hidden, true);
    assert.equal(element('custom-path-save').disabled, true, 'Save is disabled when unchanged');

    // IME Enter must not submit; typing enables Save and invalid path surfaces inline error that re-translates on locale change.
    element('custom-path-input').value = 'bad';
    element('custom-path-input').listeners.input();
    assert.equal(element('custom-path-save').disabled, false);
    element('custom-path-input').listeners.keydown({ key: 'Enter', isComposing: true });
    assert.deepEqual(savedPaths, []);
    element('custom-path-save').click();
    await waitFor(() => element('custom-path-note').textContent.includes('absolute path'), 3_000, 'validation error');
    assert.equal(element('custom-path-note').attributes['data-tone'], 'error');
    currentLocale = 'zh-CN';
    main.postMessage({ type: 'locale-changed' });
    await waitFor(() => element('custom-path-note').textContent.includes('绝对路径'), 3_000, 'note re-translated to zh-CN');
    currentLocale = 'en';
    main.postMessage({ type: 'locale-changed' });
    await waitFor(() => element('custom-path-note').textContent.includes('absolute path'), 3_000, 'note re-translated back to en');

    // Valid path updates version, triggers a fresh CLI update check, and shows Reset button.
    element('custom-path-input').value = '/opt/custom/agy';
    element('custom-path-input').listeners.input();
    element('custom-path-save').click();
    await waitFor(() => element('version').textContent === '9.9.9', 3_000, 'saved custom path');
    await waitFor(() => cliActions.filter((a) => a === 'check').length >= 1, 3_000, 'CLI update check re-ran after path change');
    assert.equal(element('custom-path-reset').hidden, false);
    assert.equal(element('custom-path-save').disabled, true);

    // Unavailable custom path hides "Install from official source" and shows Path unavailable badge.
    element('custom-path-input').value = '/gone/agy';
    element('custom-path-input').listeners.input();
    element('custom-path-save').click();
    await waitFor(() => element('badge').textContent === 'Path unavailable', 3_000, 'unavailable badge');
    assert.equal(element('cli-action').hidden, true, 'Install button is hidden when custom path is unavailable');
    assert.equal(element('custom-path-reset').hidden, false);

    // Reset sends empty path and restores auto-detection.
    element('custom-path-reset').click();
    await waitFor(() => element('version').textContent === '1.5.9', 3_000, 'reset to auto-detect');
    assert.equal(element('custom-path-reset').hidden, true);
    assert.deepEqual(savedPaths, ['bad', '/opt/custom/agy', '/gone/agy', '']);

    // After installing A, selecting an older B clears "Installed" and triggers a fresh update check;
    // active install/update locks the custom path controls.
    const checksBefore = cliActions.filter((a) => a === 'check').length;
    main.postMessage({ type: 'cli-state', reqId: 'inst-1', action: 'update', active: true });
    await waitFor(() => element('custom-path-input').disabled === true, 3_000, 'path locked during update');
    assert.equal(element('custom-path-save').disabled, true);
    assert.equal(element('custom-path-reset').disabled, true);
    main.postMessage({ type: 'cli-state', reqId: 'inst-1', action: 'update', active: false, result: { state: 'installed', version: '2.0.0' } });
    await waitFor(() => element('cli-status').textContent === 'Installed 2.0.0', 3_000, 'installed status shown');
    assert.equal(element('custom-path-input').disabled, false);

    element('custom-path-input').value = '/opt/older/agy';
    element('custom-path-input').listeners.input();
    element('custom-path-save').click();
    await waitFor(() => cliActions.filter((a) => a === 'check').length > checksBefore, 3_000, 'fresh check triggered after switching from installed binary');
    assert.notEqual(element('cli-status').textContent, 'Installed 2.0.0');
  });

  test('worker.js serializes overlapping setCustomPath calls and cancels active login on path switch', async (t) => {
    const stateFile = path.join(os.tmpdir(), `agy-serial-state-${process.pid}-${Date.now()}`);
    t.after(() => {
      fs.rmSync(stateFile, { force: true });
      fs.rmSync(stateFile + '.log', { force: true });
    });
    const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_STATE: stateFile, FAKE_AGY_LOGIN: 'hang' } });
    const dir = path.join(fixture.dir, 'bins');
    fs.mkdirSync(dir);
    const script = path.join(dir, 'fake.js');
    fs.writeFileSync(script, FAKE_AGY_SOURCE, 'utf8');
    let binA;
    let binB;
    if (isWin) {
      binA = path.join(dir, 'agy-a.cmd');
      fs.writeFileSync(binA, `@set FAKE_AGY_VERSION=1.1.1\r\n@"${process.execPath}" -e "setTimeout(()=>{}, 150)"\r\n@"${process.execPath}" "${script}" %*\r\n`);
      binB = path.join(dir, 'agy-b.cmd');
      fs.writeFileSync(binB, `@set FAKE_AGY_VERSION=2.2.2\r\n@set FAKE_AGY_LOGIN=\r\n@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      binA = path.join(dir, 'agy-a');
      fs.writeFileSync(binA, `#!/bin/sh\nsleep 0.15\nFAKE_AGY_VERSION=1.1.1 exec "${process.execPath}" "${script}" "$@"\n`);
      fs.chmodSync(binA, 0o755);
      binB = path.join(dir, 'agy-b');
      fs.writeFileSync(binB, `#!/bin/sh\nFAKE_AGY_VERSION=2.2.2 FAKE_AGY_LOGIN= exec "${process.execPath}" "${script}" "$@"\n`);
      fs.chmodSync(binB, 0o755);
    }

    const worker = startWorker(fixture.env);
    t.after(() => worker.close());

    // Start a hanging login on the default binary, then fire overlapping saves A (slow) and B (fast).
    const loginPending = worker.call({ jsonrpc: '2.0', id: 1, method: 'login', params: {} });
    await waitFor(() => fs.existsSync(stateFile + '.log') && fs.readFileSync(stateFile + '.log', 'utf8').includes('authenticate:oauth-personal'), 5_000, 'login started');

    const saveA = worker.call({ jsonrpc: '2.0', id: 2, method: 'setCustomPath', params: { path: binA, locale: 'en' } });
    const saveB = worker.call({ jsonrpc: '2.0', id: 3, method: 'setCustomPath', params: { path: binB, locale: 'en' } });
    const [loginResult, resA, resB] = await Promise.all([loginPending, saveA, saveB]);
    assert.deepEqual(loginResult.result, { ok: false, error: 'cancelled' });
    assert.equal(resA.result.ok, true);
    assert.equal(resA.result.detection.version, '1.1.1');
    assert.equal(resB.result.ok, true);
    assert.equal(resB.result.detection.version, '2.2.2');

    const finalDetect = await worker.call({ jsonrpc: '2.0', id: 4, method: 'detect', params: { locale: 'en' } });
    assert.equal(finalDetect.result.version, '2.2.2');
    assert.ok(samePath(finalDetect.result.customPath, binB));

    // A new login on B must succeed right away (never stuck as 'busy').
    const loginB = await worker.call({ jsonrpc: '2.0', id: 5, method: 'login', params: {} });
    assert.equal(loginB.result.ok, true);
  });

  test('setCustomPath immediately cancels a sign-in stuck in ACP initialize', async (t) => {
    const stateFile = path.join(os.tmpdir(), `agy-init-cancel-${process.pid}-${Date.now()}`);
    t.after(() => {
      fs.rmSync(stateFile, { force: true });
      fs.rmSync(stateFile + '.log', { force: true });
    });
    const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_STATE: stateFile, FAKE_AGY_LOGIN: 'hang-init' } });
    const dir = path.join(fixture.dir, 'bins');
    fs.mkdirSync(dir);
    const script = path.join(dir, 'fake.js');
    fs.writeFileSync(script, FAKE_AGY_SOURCE, 'utf8');
    let binB;
    if (isWin) {
      binB = path.join(dir, 'agy-b.cmd');
      fs.writeFileSync(binB, `@set FAKE_AGY_VERSION=2.2.2\r\n@set FAKE_AGY_LOGIN=\r\n@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      binB = path.join(dir, 'agy-b');
      fs.writeFileSync(binB, `#!/bin/sh\nFAKE_AGY_VERSION=2.2.2 FAKE_AGY_LOGIN= exec "${process.execPath}" "${script}" "$@"\n`);
      fs.chmodSync(binB, 0o755);
    }

    const worker = startWorker(fixture.env);
    t.after(() => worker.close());

    // Start login on default binary which hangs before replying to initialize.
    const loginPending = worker.call({ jsonrpc: '2.0', id: 1, method: 'login', params: {} });
    await waitFor(() => fs.existsSync(stateFile + '.log') && fs.readFileSync(stateFile + '.log', 'utf8').includes('initialize'), 5_000, 'login initialize sent');
    const hungPid = readPid(fixture.pidFile);
    assert.ok(hungPid, 'hung agy process started');

    const startedAt = Date.now();
    const saveB = worker.call({ jsonrpc: '2.0', id: 2, method: 'setCustomPath', params: { path: binB, locale: 'en' } });
    const [loginResult, saveResult] = await Promise.all([loginPending, saveB]);
    assert.ok(Date.now() - startedAt < 5_000, 'cancelled initialize without waiting for 45s timeout');
    assert.deepEqual(loginResult.result, { ok: false, error: 'cancelled' });
    assert.equal(saveResult.result.ok, true);
    assert.equal(saveResult.result.detection.version, '2.2.2');
    await waitFor(() => !isAlive(hungPid), 3_000, 'hung initialize agy killed');

    const loginB = await worker.call({ jsonrpc: '2.0', id: 3, method: 'login', params: {} });
    assert.equal(loginB.result.ok, true);
  });

  test('main.js serializes saves, drops stale login after path switch, and blocks path changes during update', async () => {
    class Channel {
      static all = [];
      constructor(name) { this.name = name; this.onmessage = null; Channel.all.push(this); }
      postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        for (const other of Channel.all) {
          if (other !== this && other.name === this.name && other.onmessage) setTimeout(() => other.onmessage({ data: copy }), 0);
        }
      }
    }
    const puts = [];
    const cancels = [];
    let resolveLoginA;
    let resolveSaveA;
    let resolveUpdate;
    let loginCalls = 0;
    const context = vm.createContext({
      BroadcastChannel: Channel, setTimeout, clearTimeout,
      cindy: {
        request: async () => ({ ok: true, context: { locale: 'en', uiLocale: 'en' } }),
        node: {
          request: async (request) => {
            if (request.method === 'detect') return { ok: true, result: { available: true, path: '/bin/agy', version: '1.0.0' } };
            if (request.method === 'listModels') return { ok: true, result: { supported: true, models: [{ id: 'm', name: 'M' }] } };
            if (request.method === 'usage') return { ok: true, result: null };
            if (request.method === 'login') {
              loginCalls += 1;
              if (loginCalls === 1) return new Promise((resolve) => { resolveLoginA = resolve; });
              return { ok: true, result: { ok: true, tier: { name: 'New Tier' } } };
            }
            if (request.method === 'cancelLogin') {
              cancels.push(true);
              return { ok: true, result: { ok: true, cancelled: true } };
            }
            if (request.method === 'setCustomPath') {
              if (request.params.path === '/opt/agy-a') {
                return new Promise((resolve) => {
                  resolveSaveA = () => resolve({ ok: true, result: { ok: true, customPath: '/opt/agy-a',
                    detection: { available: true, path: '/opt/agy-a', customPath: '/opt/agy-a', customPathConfigured: true, version: '1.5.0' } } });
                });
              }
              return { ok: true, result: { ok: true, customPath: '/opt/agy-b',
                detection: { available: true, path: '/opt/agy-b', customPath: '/opt/agy-b', customPathConfigured: true, version: '2.0.0' } } };
            }
            if (request.method === 'cliMaintenance' && request.params.action === 'update') {
              return new Promise((resolve) => {
                resolveUpdate = () => resolve({ ok: true, result: { state: 'installed', version: '2.1.0' } });
              });
            }
            return { ok: false };
          },
        },
        onHostMessage: () => () => {},
      },
      fetch: async (url, init) => {
        if (url === '/kv' && !init) return { ok: true, json: async () => ({}) };
        if (url === '/harnesses') puts.push(JSON.parse(init.body).harnesses[0]);
        return { ok: true, status: 204 };
      },
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });
    await waitFor(() => puts.length > 0, 3_000, 'initial publish');

    const page = new Channel(pluginId);
    const received = [];
    page.onmessage = (event) => received.push(event.data);

    // Start login on initial binary, then fire overlapping saves A (slow) and B (fast).
    page.postMessage({ type: 'account-request', reqId: 'login-a', op: 'login' });
    await waitFor(() => typeof resolveLoginA === 'function', 3_000, 'login A started');

    page.postMessage({ type: 'custom-path-request', reqId: 'save-a', path: '/opt/agy-a' });
    page.postMessage({ type: 'custom-path-request', reqId: 'save-b', path: '/opt/agy-b' });
    await waitFor(() => typeof resolveSaveA === 'function', 3_000, 'save A started');
    resolveSaveA();
    await waitFor(() => received.some((m) => m.type === 'custom-path-result' && m.reqId === 'save-b'), 3_000, 'save B finished after A');

    // Final published version must be B (2.0.0), and old login must have been cancelled.
    assert.equal(puts.at(-1).version, '2.0.0');
    assert.ok(cancels.length >= 1, 'cancelLogin was called on path switch');

    // Late resolution of A's login must not taint B or block a new login on B.
    resolveLoginA({ ok: true, result: { ok: true, tier: { name: 'Old Tier' } } });
    await waitFor(() => received.some((m) => m.type === 'account-result' && m.reqId === 'login-a'), 3_000, 'stale login settled');
    assert.equal(received.find((m) => m.type === 'account-result' && m.reqId === 'login-a').error, 'cancelled');

    page.postMessage({ type: 'account-request', reqId: 'login-b', op: 'login' });
    await waitFor(() => received.some((m) => m.type === 'account-result' && m.reqId === 'login-b'), 3_000, 'login B succeeded');
    const loginBResult = received.find((m) => m.type === 'account-result' && m.reqId === 'login-b');
    assert.equal(loginBResult.error, undefined);
    assert.equal(loginBResult.account.tier, 'New Tier');

    // Path changes are rejected with 'busy' while a CLI update is active.
    page.postMessage({ type: 'cli-maintenance', reqId: 'upd-1', action: 'update', version: '2.1.0' });
    await waitFor(() => typeof resolveUpdate === 'function', 3_000, 'update active');
    page.postMessage({ type: 'custom-path-request', reqId: 'save-during-upd', path: '/opt/agy-b' });
    await waitFor(() => received.some((m) => m.type === 'custom-path-result' && m.reqId === 'save-during-upd'), 3_000, 'blocked during update');
    assert.equal(received.find((m) => m.type === 'custom-path-result' && m.reqId === 'save-during-upd').error, 'busy');
    resolveUpdate();
  });
  test('worker.js refuses sign-in and sign-out while a custom path is being saved', async (t) => {
    const stateFile = path.join(os.tmpdir(), `agy-save-busy-${process.pid}-${Date.now()}`);
    t.after(() => {
      fs.rmSync(stateFile, { force: true });
      fs.rmSync(stateFile + '.log', { force: true });
    });
    const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_STATE: stateFile } });
    fs.writeFileSync(stateFile, 'signed-in');
    const dir = path.join(fixture.dir, 'bins');
    fs.mkdirSync(dir);
    const script = path.join(dir, 'fake.js');
    fs.writeFileSync(script, FAKE_AGY_SOURCE, 'utf8');
    // The new binary answers `--version` slowly, so the save stays pending while the account requests arrive.
    let slowBin;
    if (isWin) {
      slowBin = path.join(dir, 'agy-slow.cmd');
      fs.writeFileSync(slowBin, `@set FAKE_AGY_VERSION=3.3.3\r\n@"${process.execPath}" -e "setTimeout(()=>{}, 400)"\r\n@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      slowBin = path.join(dir, 'agy-slow');
      fs.writeFileSync(slowBin, `#!/bin/sh\nsleep 0.4\nFAKE_AGY_VERSION=3.3.3 exec "${process.execPath}" "${script}" "$@"\n`);
      fs.chmodSync(slowBin, 0o755);
    }

    const worker = startWorker(fixture.env);
    t.after(() => worker.close());

    const save = worker.call({ jsonrpc: '2.0', id: 1, method: 'setCustomPath', params: { path: slowBin, locale: 'en' } });
    const logout = await worker.call({ jsonrpc: '2.0', id: 2, method: 'logout', params: {} });
    const login = await worker.call({ jsonrpc: '2.0', id: 3, method: 'login', params: {} });
    assert.deepEqual(logout.result, { ok: false, error: 'busy' });
    assert.deepEqual(login.result, { ok: false, error: 'busy' });
    assert.equal((await save).result.ok, true);
    assert.equal(fs.readFileSync(stateFile, 'utf8'), 'signed-in', 'neither request reached an agy');

    // Once the save is over, the same request signs out on the new binary.
    const after = await worker.call({ jsonrpc: '2.0', id: 4, method: 'logout', params: {} });
    assert.deepEqual(after.result, { ok: true });
    assert.equal(fs.readFileSync(stateFile, 'utf8'), 'signed-out');
  });

  test('main.js refuses sign-in and sign-out during a custom path save, and a sign-out asked for the replaced path', async () => {
    class Channel {
      static all = [];
      constructor(name) { this.name = name; this.onmessage = null; Channel.all.push(this); }
      postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        for (const other of Channel.all) {
          if (other !== this && other.name === this.name && other.onmessage) setTimeout(() => other.onmessage({ data: copy }), 0);
        }
      }
    }
    const puts = [];
    const workerCalls = [];
    let resolveSave;
    const context = vm.createContext({
      BroadcastChannel: Channel, setTimeout, clearTimeout,
      cindy: {
        request: async () => ({ ok: true, context: { locale: 'en', uiLocale: 'en' } }),
        node: {
          request: async (request) => {
            workerCalls.push(request.method);
            if (request.method === 'detect') return { ok: true, result: { available: true, path: '/bin/agy', version: '1.0.0' } };
            if (request.method === 'listModels') return { ok: true, result: { supported: true, models: [{ id: 'm', name: 'M' }] } };
            if (request.method === 'usage') return { ok: true, result: null };
            if (request.method === 'account') return { ok: true, result: { supported: true, signedIn: true, canSignIn: true, canSignOut: true } };
            if (request.method === 'login' || request.method === 'logout') return { ok: true, result: { ok: true } };
            if (request.method === 'setCustomPath') {
              return new Promise((resolve) => {
                resolveSave = () => resolve({ ok: true, result: { ok: true, customPath: '/opt/agy-b',
                  detection: { available: true, path: '/opt/agy-b', customPath: '/opt/agy-b', customPathConfigured: true, version: '2.0.0' } } });
              });
            }
            return { ok: false };
          },
        },
        onHostMessage: () => () => {},
      },
      fetch: async (url, init) => {
        if (url === '/kv' && !init) return { ok: true, json: async () => ({}) };
        if (url === '/harnesses') puts.push(JSON.parse(init.body).harnesses[0]);
        return { ok: true, status: 204 };
      },
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });
    await waitFor(() => puts.length > 0, 3_000, 'initial publish');

    const page = new Channel(pluginId);
    const received = [];
    page.onmessage = (event) => received.push(event.data);
    const resultOf = (reqId) => received.find((m) => m.type === 'account-result' && m.reqId === reqId);

    page.postMessage({ type: 'custom-path-request', reqId: 'save', path: '/opt/agy-b' });
    await waitFor(() => typeof resolveSave === 'function', 3_000, 'save started');
    page.postMessage({ type: 'account-request', reqId: 'out-1', op: 'logout' });
    page.postMessage({ type: 'account-request', reqId: 'in-1', op: 'login' });
    await waitFor(() => resultOf('out-1') && resultOf('in-1'), 3_000, 'account requests answered');
    assert.equal(resultOf('out-1').error, 'busy');
    assert.equal(resultOf('in-1').error, 'busy');
    assert.ok(!workerCalls.includes('logout') && !workerCalls.includes('login'), 'neither request reached the worker');

    resolveSave();
    await waitFor(() => received.some((m) => m.type === 'custom-path-result' && m.reqId === 'save'), 3_000, 'save finished');
    const generation = received.find((m) => m.type === 'custom-path-result' && m.reqId === 'save').snapshot.generation;
    assert.equal(typeof generation, 'number');

    // A sign-out confirmed for the state shown before the switch is refused, even when it only arrives after the save.
    page.postMessage({ type: 'account-request', reqId: 'out-stale', op: 'logout', generation: generation - 1 });
    await waitFor(() => resultOf('out-stale'), 3_000, 'stale logout answered');
    assert.equal(resultOf('out-stale').error, 'stale');
    assert.ok(!workerCalls.includes('logout'), 'the stale request did not reach the worker');

    // The same request for the state of the new executable goes through.
    page.postMessage({ type: 'account-request', reqId: 'out-2', op: 'logout', generation });
    await waitFor(() => resultOf('out-2'), 3_000, 'logout after the save');
    assert.equal(resultOf('out-2').error, undefined);
    assert.ok(workerCalls.includes('logout'));
  });

  test('setCustomPath still finishes when the cancelled sign-in ignores SIGTERM', async (t) => {
    if (isWin) {
      t.skip('Windows stops agy with taskkill /F, there is no SIGTERM to ignore');
      return;
    }
    const stateFile = path.join(os.tmpdir(), `agy-ignore-term-${process.pid}-${Date.now()}`);
    t.after(() => {
      fs.rmSync(stateFile, { force: true });
      fs.rmSync(stateFile + '.log', { force: true });
    });
    const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_STATE: stateFile, FAKE_AGY_LOGIN: 'hang-init', FAKE_AGY_IGNORE_TERM: '1' } });
    const dir = path.join(fixture.dir, 'bins');
    fs.mkdirSync(dir);
    const script = path.join(dir, 'fake.js');
    fs.writeFileSync(script, FAKE_AGY_SOURCE, 'utf8');
    const binB = path.join(dir, 'agy-b');
    fs.writeFileSync(binB, `#!/bin/sh\nFAKE_AGY_VERSION=2.2.2 FAKE_AGY_LOGIN= FAKE_AGY_IGNORE_TERM= exec "${process.execPath}" "${script}" "$@"\n`);
    fs.chmodSync(binB, 0o755);

    const worker = startWorker(fixture.env);
    t.after(() => worker.close());

    // The default binary never answers `initialize` and ignores SIGTERM.
    const loginPending = worker.call({ jsonrpc: '2.0', id: 1, method: 'login', params: {} });
    await waitFor(() => fs.existsSync(stateFile + '.log') && fs.readFileSync(stateFile + '.log', 'utf8').includes('initialize'), 5_000, 'login initialize sent');
    const hungPid = readPid(fixture.pidFile);
    assert.ok(hungPid, 'hung agy process started');
    t.after(() => {
      try { process.kill(hungPid, 'SIGKILL'); } catch { /* already gone */ }
    });

    const startedAt = Date.now();
    const saveB = worker.call({ jsonrpc: '2.0', id: 2, method: 'setCustomPath', params: { path: binB, locale: 'en' } });
    const [loginResult, saveResult] = await Promise.all([loginPending, saveB]);
    assert.ok(Date.now() - startedAt < 10_000, 'the cancelled sign-in is force-stopped, not waited for until the 45 s ACP timeout');
    assert.deepEqual(loginResult.result, { ok: false, error: 'cancelled' });
    assert.equal(saveResult.result.ok, true);
    assert.equal(saveResult.result.detection.version, '2.2.2');
    await waitFor(() => !isAlive(hungPid), 3_000, 'the agy that ignored SIGTERM was killed');
  });

  test('settings.js adopts a path saved in another window while its own save waits, and keeps it when its own save fails', async () => {
    class Channel {
      static all = [];
      constructor(name) { this.name = name; this.onmessage = null; this.listeners = []; Channel.all.push(this); }
      addEventListener(type, listener) { if (type === 'message') this.listeners.push(listener); }
      postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        for (const other of Channel.all) {
          if (other === this || other.name !== this.name) continue;
          setTimeout(() => {
            other.onmessage?.({ data: copy });
            for (const listener of other.listeners) listener({ data: copy });
          }, 0);
        }
      }
    }
    const elements = new Map();
    const element = (id) => {
      if (!elements.has(id)) {
        const listeners = {};
        elements.set(id, { id, value: '', placeholder: '', textContent: '', hidden: false, disabled: false, attributes: {}, dataset: {}, listeners,
          setAttribute(name, value) { this.attributes[name] = value; },
          addEventListener(type, listener) { listeners[type] = listener; },
          focus() {},
          click() { listeners.click(); } });
      }
      return elements.get(id);
    };
    const context = vm.createContext({
      BroadcastChannel: Channel, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval,
      document: { getElementById: element, documentElement: {}, visibilityState: 'visible', addEventListener() {} },
      fetch: async (url) => ({ ok: true, json: async () => (url === '/app-context' ? { context: { uiLocale: 'en' } } : { state: 'on' }) }),
    });
    const main = new Channel(pluginId);
    const account = { signedIn: true, canSignIn: true, canSignOut: true, busy: null };
    const snapshotFor = (version, customPath) => ({ ok: true, account,
      result: { available: true, version, path: customPath || '/usr/local/bin/agy', ...(customPath ? { customPath, customPathConfigured: true } : {}) },
      signInRequired: false, publish: { status: 'published' }, checkedAt: 1 });
    let heldReqId = null;
    main.onmessage = ({ data }) => {
      if (data.type === 'detect-request') {
        main.postMessage({ type: 'detect-ack', reqId: data.reqId });
        main.postMessage({ type: 'detect-result', reqId: data.reqId, snapshot: snapshotFor('1.5.9') });
      }
      if (data.type === 'cli-state-request') main.postMessage({ type: 'cli-state' });
      if (data.type === 'account-request') {
        main.postMessage({ type: 'account-ack', reqId: data.reqId });
        main.postMessage({ type: 'account-result', reqId: data.reqId, op: data.op, account });
      }
      if (data.type === 'custom-path-request') {
        // This window's save of C waits for its answer, as another window's save of B goes through first.
        heldReqId = data.reqId;
        main.postMessage({ type: 'custom-path-ack', reqId: data.reqId });
      }
    };
    context.window = context;
    vm.runInContext(fs.readFileSync(path.join(root, 'cli-settings.js'), 'utf8'), context, { filename: 'cli-settings.js' });
    vm.runInContext(fs.readFileSync(path.join(root, 'settings.js'), 'utf8'), context, { filename: 'settings.js' });
    await waitFor(() => element('version').textContent === '1.5.9', 3_000, 'initial detect');

    element('custom-path-input').value = '/opt/c/agy';
    element('custom-path-input').listeners.input();
    element('custom-path-save').click();
    await waitFor(() => heldReqId !== null, 3_000, 'save of C sent');

    main.postMessage({ type: 'custom-path-result', reqId: 'other-window', ok: true, snapshot: snapshotFor('9.9.9', '/opt/b/agy') });
    await waitFor(() => element('version').textContent === '9.9.9', 3_000, 'path saved in the other window is shown while the local save waits');

    main.postMessage({ type: 'custom-path-result', reqId: heldReqId, ok: false, error: 'not-runnable' });
    await waitFor(() => element('custom-path-note').attributes['data-tone'] === 'error', 3_000, 'error of the local save');
    assert.equal(element('version').textContent, '9.9.9', 'the failed save does not bring the old path back');
    assert.equal(element('custom-path-reset').hidden, false, 'a custom path is configured');
    assert.equal(element('custom-path-input').value, '/opt/c/agy', 'what the user typed is kept for correction');
    assert.equal(element('custom-path-save').disabled, false);
  });

  test('agy-acp launches the configured binary and offers steering through it', async (t) => {
    // The agy on PATH is the plain fake (no steering); only the configured binary identifies as a steering-capable agy.
    const fixture = makeFixture(t);
    const customDir = path.join(fixture.dir, 'custom');
    fs.mkdirSync(customDir);
    const callsFile = path.join(fixture.dir, 'steering.calls');
    const script = path.join(customDir, 'steering-agy.js');
    fs.writeFileSync(script, `'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('agy 1.5.13\\n');
  process.exit(0);
}
fs.appendFileSync(${JSON.stringify(callsFile)}, args.join(' ') + '\\n');
process.stdin.on('data', (chunk) => {
  for (const line of chunk.toString('utf8').split('\\n').filter(Boolean)) {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      const agentInfo = { name: 'Antigravity ACP Server', version: '1.5.13' };
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentInfo } }) + '\\n');
    }
  }
});
process.stdin.on('end', () => process.exit(0));
`, 'utf8');
    let customBin;
    if (isWin) {
      customBin = path.join(customDir, 'steering-agy.cmd');
      fs.writeFileSync(customBin, `@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      customBin = path.join(customDir, 'steering-agy');
      fs.writeFileSync(customBin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
      fs.chmodSync(customBin, 0o755);
    }

    const worker = startWorker(fixture.env);
    t.after(() => worker.close());
    const saved = await worker.call({ jsonrpc: '2.0', id: 1, method: 'setCustomPath', params: { path: customBin, locale: 'en' } });
    assert.equal(saved.result.ok, true);

    const bridge = startBridge(fixture.env);
    t.after(() => bridge.child.kill());
    bridge.child.stdin.write(INITIALIZE);
    await waitFor(() => bridge.stdout.text().includes('\n'), 8_000, 'initialize answer');
    const init = JSON.parse(bridge.stdout.text().split('\n')[0]);
    assert.equal(init.result.agentInfo.name, 'Antigravity ACP Server', 'the answer comes from the configured binary');
    assert.deepEqual(init.result._meta, { steering: { supported: true } }, 'the steering relay is in the path');
    bridge.child.stdin.end();
    assert.equal((await bridge.closed).code, 0);
    assert.match(fs.readFileSync(callsFile, 'utf8'), /acp --disable-telemetry/);
  });

  test('the configured binary is the one the remote-workspace entry checks and starts', async (t) => {
    const launchFile = path.join(os.tmpdir(), `agy-custom-remote-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    t.after(() => fs.rmSync(launchFile, { force: true }));
    // The agy on PATH is too old for a remote workspace (0.2.2); only the configured binary reports 1.5.13.
    const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_LAUNCHFILE: launchFile } });
    const customDir = path.join(fixture.dir, 'custom');
    fs.mkdirSync(customDir);
    const customScript = path.join(customDir, 'custom-agy.js');
    fs.writeFileSync(customScript, FAKE_AGY_SOURCE, 'utf8');
    const callsFile = path.join(fixture.dir, 'custom-remote.calls');
    let customBin;
    if (isWin) {
      customBin = path.join(customDir, 'my-agy.cmd');
      fs.writeFileSync(customBin, `@set FAKE_AGY_VERSION=1.5.13\r\n@echo %*>>"${callsFile}"\r\n@"${process.execPath}" "${customScript}" %*\r\n`);
    } else {
      customBin = path.join(customDir, 'my-agy');
      fs.writeFileSync(customBin, `#!/bin/sh\necho "$@" >> "${callsFile}"\nFAKE_AGY_VERSION=1.5.13 exec "${process.execPath}" "${customScript}" "$@"\n`);
      fs.chmodSync(customBin, 0o755);
    }

    // Without a configured path, the agy on PATH is refused for a remote workspace.
    const refused = startBridge(fixture.env, ['--cindy-remote-workspace']);
    assert.notEqual((await refused.closed).code, 0);
    assert.match(refused.stderr.text(), /1\.5\.13/);
    assert.ok(!fs.existsSync(callsFile), 'the configured binary has not been used yet');

    const worker = startWorker(fixture.env);
    t.after(() => worker.close());
    const saved = await worker.call({ jsonrpc: '2.0', id: 1, method: 'setCustomPath', params: { path: customBin, locale: 'en' } });
    assert.equal(saved.result.ok, true);
    const callsAfterSave = fs.readFileSync(callsFile, 'utf8').trim().split(/\r?\n/).length;

    const bridge = startBridge(fixture.env, ['--cindy-remote-workspace', '--cindy-guest-workspace']);
    t.after(() => bridge.child.kill());
    const messages = () => bridge.stdout.text().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const send = (message) => bridge.child.stdin.write(JSON.stringify(message) + '\n');
    const reply = async (id, what) => {
      await waitFor(() => messages().some((m) => m.id === id && !m.method), 8_000, what);
      return messages().find((m) => m.id === id && !m.method);
    };
    bridge.child.stdin.write(INITIALIZE);
    await reply(0, 'initialize answer');
    const server = { type: 'http', name: 'cindy_exec', url: 'http://127.0.0.1:4711/mcp/cindy_exec', headers: [{ name: 'Authorization', value: 'Bearer task-secret' }] };
    send({ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/shadow/p', mcpServers: [server] } });
    assert.deepEqual((await reply(1, 'session/new answer')).result, { sessionId: 'sess-1', configOptions: [] });
    const launches = fs.readFileSync(callsFile, 'utf8').trim().split(/\r?\n/).slice(callsAfterSave);
    assert.ok(launches.some((line) => /acp --disable-telemetry$/.test(line)), `the plain ACP process started the configured binary: ${launches}`);
    assert.ok(launches.some((line) => /--agent cindy-remote$/.test(line)), `the restricted session process started the configured binary: ${launches}`);
    send({ jsonrpc: '2.0', id: 7, method: 'session/list', params: {} });
    assert.equal((await reply(7, 'session/list refusal')).error.code, -32601);
    bridge.child.stdin.end();
    assert.equal((await bridge.closed).code, 0);
  });

  test('settings.js tags sign-in and sign-out with the state the user acted on, and drops a refusal note once it no longer applies', async () => {
    class Channel {
      static all = [];
      constructor(name) { this.name = name; this.onmessage = null; this.listeners = []; Channel.all.push(this); }
      addEventListener(type, listener) { if (type === 'message') this.listeners.push(listener); }
      postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        for (const other of Channel.all) {
          if (other === this || other.name !== this.name) continue;
          setTimeout(() => {
            other.onmessage?.({ data: copy });
            for (const listener of other.listeners) listener({ data: copy });
          }, 0);
        }
      }
    }
    const elements = new Map();
    const element = (id) => {
      if (!elements.has(id)) {
        const listeners = {};
        elements.set(id, { id, value: '', placeholder: '', textContent: '', hidden: false, disabled: false, attributes: {}, dataset: {}, listeners,
          setAttribute(name, value) { this.attributes[name] = value; },
          addEventListener(type, listener) { listeners[type] = listener; },
          focus() {},
          click() { listeners.click(); } });
      }
      return elements.get(id);
    };
    let wakeGate = null;
    const context = vm.createContext({
      BroadcastChannel: Channel, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval,
      document: { getElementById: element, documentElement: {}, visibilityState: 'visible', addEventListener() {} },
      fetch: async (url) => {
        if (url === '/wake' && wakeGate) await wakeGate;
        return { ok: true, json: async () => (url === '/app-context' ? { context: { uiLocale: 'en' } } : { state: 'on' }) };
      },
    });
    const main = new Channel(pluginId);
    const account = { signedIn: true, canSignIn: true, canSignOut: true, busy: null };
    const snapshotFor = (generation, version) => ({ ok: true, account, generation,
      result: { available: true, version, path: '/usr/local/bin/agy' }, signInRequired: false, publish: { status: 'published' }, checkedAt: 1 });
    const accountRequests = [];
    let detectRequests = 0;
    let refusal = null;
    let heldReqId = null;
    main.onmessage = ({ data }) => {
      if (data.type === 'detect-request') {
        detectRequests += 1;
        main.postMessage({ type: 'detect-ack', reqId: data.reqId });
        main.postMessage({ type: 'detect-result', reqId: data.reqId, snapshot: snapshotFor(3, '1.5.9') });
      }
      if (data.type === 'cli-state-request') main.postMessage({ type: 'cli-state' });
      if (data.type === 'account-request') {
        accountRequests.push(data);
        main.postMessage({ type: 'account-ack', reqId: data.reqId });
        main.postMessage({ type: 'account-result', reqId: data.reqId, op: data.op, account, ...(refusal && data.op === 'logout' ? { error: refusal } : {}) });
      }
      if (data.type === 'custom-path-request') {
        heldReqId = data.reqId;
        main.postMessage({ type: 'custom-path-ack', reqId: data.reqId });
      }
    };
    context.window = context;
    vm.runInContext(fs.readFileSync(path.join(root, 'cli-settings.js'), 'utf8'), context, { filename: 'cli-settings.js' });
    vm.runInContext(fs.readFileSync(path.join(root, 'settings.js'), 'utf8'), context, { filename: 'settings.js' });
    await waitFor(() => element('version').textContent === '1.5.9', 3_000, 'initial detect');
    const signOut = () => {
      element('account-logout').click();
      element('account-confirm-yes').click();
    };

    // A refusal for a replaced path is explained, makes the page read its state again, and the explanation outlives that check.
    refusal = 'stale';
    const detectsBefore = detectRequests;
    signOut();
    await waitFor(() => accountRequests.some((request) => request.op === 'logout'), 3_000, 'sign-out sent');
    assert.equal(accountRequests.find((request) => request.op === 'logout').generation, 3, 'the request names the state the page shows');
    const logoutIndex = accountRequests.findIndex((request) => request.op === 'logout');
    await waitFor(() => element('account-note').textContent.includes('executable changed'), 3_000, 'stale refusal explained');
    await waitFor(() => detectRequests > detectsBefore, 3_000, 'the page read its state again');
    await waitFor(() => accountRequests.slice(logoutIndex + 1).some((request) => request.op === 'status'), 3_000, 'sign-in checked again after the refresh');
    assert.ok(element('account-note').textContent.includes('executable changed'), 'the refresh does not wipe the explanation');

    // The request keeps the state the user confirmed on, even when the page shows another one by the time it is sent.
    refusal = null;
    let openWake;
    wakeGate = new Promise((resolve) => { openWake = resolve; });
    const requestsBefore = accountRequests.length;
    signOut();
    main.postMessage({ type: 'detect-result', reqId: 'other-view', snapshot: snapshotFor(4, '9.9.9') });
    await waitFor(() => element('version').textContent === '9.9.9', 3_000, 'newer state shown while the request waits for /wake');
    wakeGate = null;
    openWake();
    await waitFor(() => accountRequests.slice(requestsBefore).some((request) => request.op === 'logout'), 3_000, 'sign-out sent after /wake');
    assert.equal(accountRequests.slice(requestsBefore).find((request) => request.op === 'logout').generation, 3, 'generation of the confirmation, not of the send');

    // A refusal made while a save of our own waits does not outlive that save.
    refusal = 'busy';
    element('custom-path-input').value = '/opt/c/agy';
    element('custom-path-input').listeners.input();
    element('custom-path-save').click();
    await waitFor(() => heldReqId !== null, 3_000, 'save sent');
    signOut();
    await waitFor(() => element('account-note').textContent.includes('hasn’t finished'), 3_000, 'busy refusal shown');
    main.postMessage({ type: 'custom-path-result', reqId: heldReqId, ok: false, error: 'not-runnable' });
    await waitFor(() => element('custom-path-note').attributes['data-tone'] === 'error', 3_000, 'save failed');
    assert.equal(element('account-note').textContent, '', 'the busy note is gone once the save is over');

    // Nor does it outlive a save that another window started and that failed.
    signOut();
    await waitFor(() => element('account-note').textContent.includes('hasn’t finished'), 3_000, 'busy refusal shown again');
    main.postMessage({ type: 'custom-path-result', reqId: 'other-window', ok: false, error: 'not-runnable' });
    await waitFor(() => element('account-note').textContent === '', 3_000, 'busy note gone after the other window’s save failed');
  });

  test('main.js never reuses a generation across restarts, so a restarted main.js refuses a sign-out asked for the previous one', async () => {
    const boot = async () => {
      class Channel {
        static all = [];
        constructor(name) { this.name = name; this.onmessage = null; Channel.all.push(this); }
        postMessage(data) {
          const copy = JSON.parse(JSON.stringify(data));
          for (const other of Channel.all) {
            if (other !== this && other.name === this.name && other.onmessage) setTimeout(() => other.onmessage({ data: copy }), 0);
          }
        }
      }
      const puts = [];
      const workerCalls = [];
      const context = vm.createContext({
        BroadcastChannel: Channel, setTimeout, clearTimeout,
        cindy: {
          request: async () => ({ ok: true, context: { locale: 'en', uiLocale: 'en' } }),
          node: {
            request: async (request) => {
              workerCalls.push(request.method);
              if (request.method === 'detect') return { ok: true, result: { available: true, path: '/bin/agy', version: '1.0.0' } };
              if (request.method === 'listModels') return { ok: true, result: { supported: true, models: [{ id: 'm', name: 'M' }] } };
              if (request.method === 'usage') return { ok: true, result: null };
              if (request.method === 'account') return { ok: true, result: { supported: true, signedIn: true, canSignIn: true, canSignOut: true } };
              if (request.method === 'logout') return { ok: true, result: { ok: true } };
              return { ok: false };
            },
          },
          onHostMessage: () => () => {},
        },
        fetch: async (url, init) => {
          if (url === '/kv' && !init) return { ok: true, json: async () => ({}) };
          if (url === '/harnesses') puts.push(JSON.parse(init.body).harnesses[0]);
          return { ok: true, status: 204 };
        },
      });
      vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });
      await waitFor(() => puts.length > 0, 3_000, 'initial publish');
      const page = new Channel(pluginId);
      const received = [];
      page.onmessage = (event) => received.push(event.data);
      page.postMessage({ type: 'detect-request', reqId: 'detect' });
      await waitFor(() => received.some((m) => m.type === 'detect-result'), 3_000, 'detect result');
      return { page, received, workerCalls, generation: received.find((m) => m.type === 'detect-result').snapshot.generation };
    };

    const first = await boot();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await boot();
    assert.ok(second.generation > first.generation, 'a later instance starts from a later generation');

    // A page that still holds the first instance's generation asks the second one for a sign-out.
    second.page.postMessage({ type: 'account-request', reqId: 'out-old', op: 'logout', generation: first.generation });
    await waitFor(() => second.received.some((m) => m.type === 'account-result' && m.reqId === 'out-old'), 3_000, 'sign-out answered');
    assert.equal(second.received.find((m) => m.type === 'account-result' && m.reqId === 'out-old').error, 'stale');
    assert.ok(!second.workerCalls.includes('logout'), 'the stale request did not reach the worker');
  });

});

test('usage polling returns quota and skips CLI self-update on Windows', async (t) => {
  const fixture = makeFixture(t, { extraEnv: { AGY_CLI_DISABLE_AUTO_UPDATE: 'false' } });
  const launchFile = path.join(fixture.dir, 'usage-launch.txt');
  const worker = startWorker({ ...fixture.env, FAKE_AGY_LAUNCHFILE: launchFile });
  t.after(() => worker.close());
  const { result } = await worker.call({ jsonrpc: '2.0', id: 1, method: 'usage' });
  assert.deepEqual(result.windows, [{ label: 'Test · weekly', remainingPercent: 50, ...(official ? { windowMinutes: 10080 } : {}) }]);
  assert.equal(fs.readFileSync(launchFile, 'utf8'), isWin ? 'true' : 'false');
});

test('native /usage preserves exhausted groups and ignores model turns and disabled buckets', async () => {
  const { usageFromReport } = await import(pathToFileURL(path.join(root, 'agy-usage.js')));
  const command = { name: 'usage', data: { groups: [{ name: 'Gemini', buckets: [
    { window: 'weekly', remaining_fraction: 0, reset_time: '2030-01-01T00:00:00Z' },
    { window: '5h', remaining_fraction: 0.5, disabled: true },
    { window: 'unreported', remaining_fraction: null },
  ] }, { name: 'Claude/GPT', buckets: [{ window: '5h', remaining_fraction: 1 }, { window: 'monthly', remaining_fraction: 0.25 }] }] } };
  const usage = usageFromReport({ status: 'SUCCESS', num_turns: 0, command });
  assert.deepEqual(usage.windows, [
    { label: 'Gemini · weekly', remainingPercent: 0, resetsAt: Date.UTC(2030, 0, 1), ...(official ? { windowMinutes: 10080 } : {}) },
    { label: 'Claude/GPT · 5h', remainingPercent: 100, ...(official ? { windowMinutes: 300 } : {}) },
    { label: 'Claude/GPT · monthly', remainingPercent: 25 },
  ]);
  assert.equal(usageFromReport({ status: 'SUCCESS', num_turns: 1, command }), null);
});

if (official) test('launches the Windows verification probe with the CLI updater disabled', async t => {
  const fx = makeFixture(t);
  const launch = path.join(fx.dir, 'usage-environment');
  const { createVerification } = await import(pathToFileURL(path.join(root, 'agy-verification.js')));
  const owner = createVerification(fx.agyPath, { platform: 'win32', env: { ...fx.env, FAKE_AGY_LAUNCHFILE: launch } });
  t.after(() => owner.dispose());
  fs.writeFileSync(owner.taskLog, 'I1127 15:13:05.876413     68 server_oauth.go:226] OAuth: authenticated successfully as a@example.test\n');
  assert.deepEqual(await owner.check(owner.sessionAccount()), { status: 'unknown' });
  assert.equal(fs.readFileSync(launch, 'utf8'), 'true');
});

if (official) test('binds usage checks to the opening ACP account and removes a pending probe on relay exit', async t => {
  const fx = makeFixture(t);
  const control = path.join(fx.dir, 'control');
  fs.writeFileSync(path.join(fx.dir, 'fake-agy.js'), String.raw`
    const fs = require('node:fs'), path = require('node:path');
    const args = process.argv.slice(2), control = process.env.TEST_CONTROL;
    const log = args[args.indexOf('--log-file') + 1];
    const identity = who => 'I1127 15:13:05.876413     68 server_oauth.go:226] OAuth: authenticated successfully as ' + who + '@example.test\n';
    if (args.includes('/usage')) {
      const [who, state] = fs.readFileSync(control, 'utf8').split(' ');
      if (process.platform === 'win32' && process.env.AGY_CLI_DISABLE_AUTO_UPDATE !== 'true') process.exit(2);
      const error = { code:403, status:'PERMISSION_DENIED', details:[{reason:'VALIDATION_REQUIRED',domain:'cloudcode-pa.googleapis.com',
        '@type':'type.googleapis.com/google.rpc.ErrorInfo',metadata:{validation_url:process.env.TEST_LANDING}}] };
      fs.writeFileSync(log, (who === '?' ? '' : identity(who)) + (state === 'gate' ? JSON.stringify({error}, null, 2) : ''));
      fs.writeFileSync(control + '.probe', process.cwd());
      if (state === 'hold') setInterval(() => {}, 1000);
      else console.log(JSON.stringify({status:'SUCCESS', num_turns:0,command:{name:'usage',data:{groups:[{name:'test',buckets:[{window:'5h',remaining_fraction:1}]}]}}}));
    } else {
      fs.writeFileSync(log, identity('a'));
      fs.writeFileSync(control + '.session', path.resolve(log));
      require('node:readline').createInterface({input:process.stdin}).on('line', line => {
        const {id,method} = JSON.parse(line), result = method === 'initialize'
          ? {agentInfo:{name:'Antigravity ACP Server',version:'1.5.18'}} : {sessionId:'one'};
        console.log(JSON.stringify({jsonrpc:'2.0',id,result}));
      });
    }`);
  const landing = 'https://accounts.google.com/v3/signin/continue?plt=test&continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini';
  const bridge = startBridge({ ...fx.env, TEST_CONTROL: control, TEST_LANDING: landing });
  t.after(() => bridge.child.stdin.end());
  let next = 0;
  const send = method => {
    const id = ++next;
    bridge.child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params:{sessionId:'one'} }) + '\n');
    return id;
  };
  const call = async method => {
    const id = send(method);
    const response = () => bridge.stdout.text().trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).find(item => item.id === id);
    await waitFor(response, 6000, method);
    return response().result;
  };
  await call('initialize');
  await call('session/new');
  const probe = '_cindy/checkAccountVerification';
  for (const [input, result] of [
    ['a gate', { status:'required', url:landing }], ['b ready', { status:'unknown' }],
    ['b gate', { status:'unknown' }], ['? ready', { status:'unknown' }], ['a ready', { status:'ready' }],
  ]) {
    fs.writeFileSync(control, input);
    assert.deepEqual(await call(probe), result);
    assert.equal(fs.existsSync(fs.readFileSync(control + '.probe', 'utf8')), false);
  }
  fs.rmSync(control + '.probe');
  fs.writeFileSync(control, 'a hold');
  send(probe);
  await waitFor(() => fs.existsSync(control + '.probe'), 6000, 'live verification child');
  bridge.child.stdin.end();
  assert.equal((await bridge.closed).code, 0);
  assert.equal(fs.existsSync(fs.readFileSync(control + '.probe', 'utf8')), false);
  assert.equal(fs.existsSync(path.dirname(fs.readFileSync(control + '.session', 'utf8'))), false);
  assert.ok(!bridge.stdout.text().includes('@example.test'));
  assert.ok(!bridge.stderr.text().includes('@example.test'));
});

async function localRelay(t, checkAccount) {
  const { PassThrough } = await import('node:stream');
  const { default: steering } = await import(pathToFileURL(path.join(root, 'agy-steering.js')));
  const source = new PassThrough();
  const output = new PassThrough();
  const child = { stdin: new PassThrough(), stdout: new PassThrough() };
  const server = [];
  const client = [];
  child.stdin.on('data', (data) => server.push(JSON.parse(data)));
  output.on('data', (data) => client.push(JSON.parse(data)));
  steering.attachSteering(source, output, child, (error) => { throw error; }, undefined, checkAccount && { sessionAccount: () => "synthetic", check: checkAccount });
  const write = (stream, message) => stream.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const request = (id, method, extra = {}) => write(source, { id, method, params: { sessionId: 'one', ...extra } });
  const response = (id, result) => write(child.stdout, { id, result });
  t.after(() => {
    source.end();
    child.stdout.end();
  });
  return { server, client, request, response, send: (message) => write(child.stdout, message) };
}

describe('Antigravity local ACP relay', () => {
  if (official) test('returns account verification only for the live native session and a provider 403', async t => {
    const { default: verification } = await import(pathToFileURL(path.join(root, 'agy-verification.js')));
    const url = 'https://accounts.google.com/v3/signin/continue?plt=synthetic&continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini';
    const detail = { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', domain: 'cloudcode-pa.googleapis.com',
      reason: 'VALIDATION_REQUIRED', metadata: { validation_url: url } };
    const log = (code, item) => 'agy diagnostics: ' + JSON.stringify({ error: { code, status: 'PERMISSION_DENIED', details: [item] } }, null, 2);
    assert.equal(verification.validationUrl(log(429, detail)), null);
    assert.equal(verification.validationUrl(log(403, { ...detail, domain: 'example.test' })), null);
    assert.equal(verification.validationUrl(log(403, { ...detail, reason: 'OTHER' })), null);
    const probe = () => Promise.resolve({ status: 'required', url: verification.validationUrl(log(403, detail)) });
    const { server, client, request, response } = await localRelay(t, probe);
    request(1, 'initialize');
    response(1, { agentInfo: { name: 'Antigravity ACP Server', version: '1.5.18' } });
    request(2, 'session/new'); response(2, { sessionId: 'one' });
    request(3, '_cindy/checkAccountVerification'); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(client.at(-1).result, { status: 'required', url });
    assert.ok(!server.some(req => req.method === '_cindy/checkAccountVerification'));
  });

  test('adds HTTP MCP to Antigravity initialize and preserves capabilities and steering metadata', async (t) => {
    const { client, request, response } = await localRelay(t);
    const result = {
      agentInfo: { name: 'Antigravity ACP Server', version: '1.5.14' },
      agentCapabilities: { loadSession: true, mcpCapabilities: { http: false, sse: true } },
      _meta: { antigravity: { tier: true }, steering: { retained: true } },
    };
    request(1, 'initialize');
    response(1, result);
    assert.deepEqual(client.at(-1).result, {
      ...result,
      agentCapabilities: { loadSession: true, mcpCapabilities: { http: true, sse: true } },
      _meta: { antigravity: { tier: true }, steering: { retained: true, supported: true } },
    });
  });

  test('advertises HTTP MCP even on an Antigravity version without steering', async (t) => {
    const { client, request, response } = await localRelay(t);
    request(1, 'initialize');
    response(1, { agentInfo: { name: 'Antigravity ACP Server', version: '1.5.14-beta.1' } });
    assert.deepEqual(client.at(-1).result.agentCapabilities, { mcpCapabilities: { http: true } });
    assert.equal(client.at(-1).result._meta, undefined);
  });

  for (const method of ['session/new', 'session/resume', 'session/load']) {
    test(`${method} restores MCP updates and permission requests and relays native tools unchanged`, async (t) => {
      const { server, client, request, response, send } = await localRelay(t);
      request(1, 'initialize');
      response(1, { agentInfo: { name: 'Antigravity ACP Server', version: '1.5.14' } });
      const mcpServers = ['cindy', 'cindy_helper'].map((name) => ({
        type: 'http', name, url: `http://127.0.0.1:4711/mcp/${name}`, headers: [{ name: 'Authorization', value: 'Bearer test-token' }],
      }));
      request(2, method, { mcpServers });
      assert.deepEqual(server.at(-1).params.mcpServers, mcpServers);

      const rawInput = { category: 'control' };
      const nested = method === 'session/resume';
      const reportedInput = nested
        ? { ServerName: 'cindy_helper', ToolName: 'list_tools', Arguments: JSON.stringify(rawInput) }
        : { ...rawInput, toolSummary: 'List tools' };
      const call = {
        toolCallId: 'mcp-1',
        name: nested ? 'call_mcp_tool' : 'mcp_cindy_helper_list_tools',
        title: nested ? 'MCP Tool List Tools' : 'Run mcp_cindy_helper_list_tools',
        kind: nested ? 'execute' : 'other',
      };
      const canonical = { ...call, name: 'mcp__cindy_helper__list_tools', title: 'mcp__cindy_helper__list_tools', kind: 'other', rawInput };
      const update = (fields) => send({ method: 'session/update', params: { sessionId: 'one', update: fields } });
      const options = [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }];
      const permission = (toolCall) => send({
        method: 'session/request_permission', id: 'perm', params: { sessionId: 'one', toolCall, options },
      });

      // Resume and load can replay tool updates before the response arrives.
      if (method === 'session/new') response(2, { sessionId: 'one' });
      update({ ...call, sessionUpdate: 'tool_call', rawInput: reportedInput, args: reportedInput });
      assert.deepEqual(client.at(-1).params.update, { ...canonical, sessionUpdate: 'tool_call' });
      if (method !== 'session/new') response(2, {});
      permission({ ...call, rawInput: reportedInput, args: reportedInput });
      assert.deepEqual(client.at(-1).params, { sessionId: 'one', toolCall: canonical, options });
      update({ sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, title: call.title, status: 'completed' });
      assert.deepEqual(client.at(-1).params.update,
        { sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, title: canonical.title, status: 'completed' });

      const unchanged = [
        { toolCallId: 'native-1', name: 'run_command', title: 'Run command', kind: 'execute', rawInput: { command: 'echo relay-test' } },
        { toolCallId: 'native-2', name: 'write_to_file', title: 'Write file', kind: 'edit', rawInput: { path: 'file.txt', content: 'probe' } },
        { toolCallId: 'untracked-1', name: 'mcp_other_server_list_tools', title: 'Run other tool', kind: 'other', rawInput: reportedInput },
        { toolCallId: 'untracked-2', name: 'call_mcp_tool', title: 'MCP Tool List Tools', kind: 'other',
          rawInput: { ServerName: 'other_server', ToolName: 'list_tools', Arguments: rawInput } },
      ];
      for (const toolCall of unchanged) {
        permission(toolCall);
        assert.deepEqual(client.at(-1).params.toolCall, toolCall);
        update({ ...toolCall, sessionUpdate: 'tool_call' });
        assert.deepEqual(client.at(-1).params.update, { ...toolCall, sessionUpdate: 'tool_call' });
      }
    });
  }

  test('keeps the original ACP request open through successive native prompts', async (t) => {
    const { server, client, request, response, send } = await localRelay(t);
    request(1, 'initialize');
    response(1, { agentInfo: { name: 'Antigravity ACP Server', version: '1.5.14' }, _meta: { retained: true } });
    assert.deepEqual(client.at(-1).result._meta, { retained: true, steering: { supported: true } });
    const prompt = [{ type: 'text', text: 'Switch focus' }];
    request(2, 'session/prompt', { prompt });
    request(3, '_session/steering', { prompt });
    const firstSteer = server.at(-1);
    assert.equal(firstSteer.method, 'session/prompt');
    assert.deepEqual(firstSteer.params, { sessionId: 'one', prompt });
    assert.equal(client.at(-1).result.outcome, 'injected');
    response(2, { stopReason: 'end_turn' });
    assert.equal(client.some((message) => message.id === 2), false);
    request(4, '_session/steering', { prompt });
    const lastSteer = server.at(-1);
    assert.notEqual(firstSteer.id, lastSteer.id);
    response(firstSteer.id, { stopReason: 'end_turn' });
    send({ method: 'session/update', params: { sessionId: 'one', update: { sessionUpdate: 'agent_message_chunk' } } });
    assert.equal(client.at(-1).method, 'session/update');
    response(lastSteer.id, { stopReason: 'end_turn', usage: { outputTokens: 7 } });
    assert.deepEqual(client.at(-1), { jsonrpc: '2.0', id: 2, result: { stopReason: 'end_turn', usage: { outputTokens: 7 } } });
    request(5, '_session/steering', { prompt });
    assert.equal(client.at(-1).result.outcome, 'promptRequired');
    assert.equal(server.at(-1).id, lastSteer.id);
  });

  /**
   * agy writes `notifications` notifications of about 1 KiB and exits while Cindy reads nothing, so the
   * relay still holds output when agy's exit reaches it. Resolves with the bridge once agy is gone and the
   * relay has had time to notice, or with null after skipping the test where the pipes are too small for
   * agy to exit unread.
   */
  const agyExitsBeforeCindyReads = async (t, notifications) => {
    const fixture = makeFixture(t);
    fs.writeFileSync(path.join(fixture.dir, 'fake-agy.js'), `'use strict';
require('node:fs').writeFileSync(process.env.FAKE_AGY_PIDFILE, String(process.pid));
const padding = 'x'.repeat(1000);
for (let n = 0; n < ${notifications}; n++) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { n, padding } }) + '\\n');
}
process.stdout.write('', () => process.exit(0));
`, 'utf8');
    const bridge = startBridge(fixture.env);
    t.after(() => bridge.child.kill());
    bridge.child.stdout.pause();
    await waitFor(() => readPid(fixture.pidFile) !== null, 8_000, 'fake agy to start');
    const pid = readPid(fixture.pidFile);
    const exited = await waitFor(() => !isAlive(pid), 3_000, 'fake agy to exit').then(() => true, () => false);
    if (!exited) {
      t.skip('the pipes are too small for agy to exit before Cindy reads, so the exit this test targets cannot happen here');
      return null;
    }
    // Let the relay learn of the exit and start closing while Cindy still reads nothing.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return bridge;
  };
  const notificationsOf = (bridge) => bridge.stdout.text().split('\n').filter(Boolean);

  /**
   * The relay keeps agy's output in its own buffers while Cindy is slow to read. The entry used to exit
   * once stdout had room again, which dropped whatever those buffers still held. 300 KiB is more than the
   * pipe to Cindy takes and less than the relay can hold, so most of it is still in the relay when agy's
   * exit reaches it.
   */
  test('hands Cindy every notification agy wrote before it exited, even if Cindy reads late', { timeout: 20_000 }, async (t) => {
    const notifications = 300;
    const bridge = await agyExitsBeforeCindyReads(t, notifications);
    if (!bridge) return;
    bridge.child.stdout.resume();
    const { code } = await bridge.closed;
    const lines = notificationsOf(bridge);
    assert.equal(lines.length, notifications, `${lines.length} of ${notifications} notifications reached Cindy`);
    assert.ok(lines.every((line, n) => JSON.parse(line).params.n === n), 'notifications arrive in order');
    assert.equal(code, 0, `exit code (stderr: ${bridge.stderr.text()})`);
  });

  /**
   * With a little output left, stdout keeps part of it queued below its high-water mark, and no 'drain' event
   * follows. The entry used to wait for one anyway, so the exit took the whole flush timeout (FLUSH_TIMEOUT_MS
   * in agy-acp.js) after Cindy had read everything. The exit must come right after Cindy reads; half the
   * timeout is a wide margin, not a budget.
   * How much the pipes take before stdout keeps a queue varies with the load, so the burst grows until the
   * relay is still running when Cindy reads. The first such burst leaves only a little queued.
   */
  test('adapts update_steps into ACP plans, drops duplicates, and renames ask_question only when elicitation.form is negotiated', async (t) => {
    const withForm = await localRelay(t);
    withForm.request(1, 'initialize', { clientCapabilities: { elicitation: { form: {} } } });
    withForm.response(1, { agentInfo: { name: 'Antigravity ACP Server', version: '1.5.17' } });
    withForm.request(2, 'session/new', { cwd: '/repo', mcpServers: [] });
    withForm.response(2, { sessionId: 'one' });

    withForm.send({
      method: 'session/update',
      params: {
        sessionId: 'one',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'steps-l1',
          name: 'update_steps',
          kind: 'other',
          title: 'Run update_steps',
          status: 'in_progress',
          rawInput: { steps: [{ title: 'Check', status: 'in_progress' }, { title: 'Skip', status: 'skipped' }] },
        },
      },
    });
    withForm.send({
      method: 'session/update',
      params: {
        sessionId: 'one',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'steps-l1',
          kind: 'other',
          status: 'completed',
          rawInput: { steps: [{ title: 'Check', status: 'in_progress' }, { title: 'Skip', status: 'skipped' }] },
        },
      },
    });
    withForm.send({
      method: 'session/update',
      params: {
        sessionId: 'one',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'ask-l1',
          name: 'ask_question',
          kind: 'other',
          title: 'Run ask_question',
          status: 'in_progress',
        },
      },
    });

    const updatesWithForm = withForm.client.filter((m) => m.method === 'session/update').map((m) => m.params.update);
    assert.deepEqual(updatesWithForm, [
      {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Check', priority: 'medium', status: 'in_progress' },
          { content: 'Skip', priority: 'medium', status: 'completed' },
        ],
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'ask-l1',
        name: 'AskUserQuestion',
        kind: 'other',
        title: 'AskUserQuestion',
        status: 'in_progress',
      },
    ]);

    const withoutForm = await localRelay(t);
    withoutForm.request(1, 'initialize', { clientCapabilities: { fs: { readTextFile: false } } });
    withoutForm.response(1, { agentInfo: { name: 'Antigravity ACP Server', version: '1.5.17' } });
    withoutForm.request(2, 'session/new', { cwd: '/repo', mcpServers: [] });
    withoutForm.response(2, { sessionId: 'one' });
    withoutForm.send({
      method: 'session/update',
      params: {
        sessionId: 'one',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'steps-l2',
          name: 'update_steps',
          kind: 'other',
          title: 'Run update_steps',
          status: 'in_progress',
          rawInput: { steps: [{ title: 'Keep legacy row', status: 'in_progress' }] },
        },
      },
    });
    withoutForm.send({
      method: 'session/update',
      params: {
        sessionId: 'one',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'ask-l2',
          name: 'ask_question',
          kind: 'other',
          title: 'Run ask_question',
          status: 'in_progress',
        },
      },
    });
    const updatesWithoutForm = withoutForm.client.filter((m) => m.method === 'session/update').map((m) => m.params.update);
    assert.equal(updatesWithoutForm.length, 2);
    assert.equal(updatesWithoutForm[0].sessionUpdate, 'tool_call');
    assert.equal(updatesWithoutForm[0].name, 'update_steps');
    assert.equal(updatesWithoutForm[1].name, 'ask_question');
  });

  test('local relay keeps follow-up short-name update_steps and ask_question updates on their registered MCP tool rows', async (t) => {
    const relay = await localRelay(t);
    relay.request(1, 'initialize', { clientCapabilities: { elicitation: { form: {} } } });
    relay.response(1, { agentInfo: { name: 'Antigravity ACP Server', version: '1.5.17' } });
    relay.request(2, 'session/new', {
      cwd: '/repo',
      mcpServers: [{ type: 'http', name: 'partner', url: 'http://127.0.0.1:4711/mcp/partner' }],
    });
    relay.response(2, { sessionId: 'one' });

    // External MCP update_steps starts with direct name, then follows up with short name `update_steps`.
    relay.send({
      method: 'session/update',
      params: {
        sessionId: 'one',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'mcp-steps-1',
          name: 'mcp_partner_update_steps',
          kind: 'other',
          title: 'Run mcp_partner_update_steps',
          status: 'in_progress',
          rawInput: { steps: [{ title: 'Partner step', status: 'in_progress' }], toolSummary: 'update steps' },
        },
      },
    });
    relay.send({
      method: 'session/update',
      params: {
        sessionId: 'one',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'mcp-steps-1',
          name: 'update_steps',
          kind: 'other',
          title: 'Run update_steps',
          status: 'completed',
          rawInput: { steps: [{ title: 'Partner step', status: 'done' }] },
        },
      },
    });

    // External MCP ask_question starts via nested call_mcp_tool (or direct name), then follows up with short name `ask_question`.
    relay.send({
      method: 'session/update',
      params: {
        sessionId: 'one',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'mcp-ask-1',
          name: 'call_mcp_tool',
          kind: 'other',
          title: 'MCP Tool ask_question',
          status: 'in_progress',
          rawInput: { ServerName: 'partner', ToolName: 'ask_question', Arguments: { prompt: 'Partner question' } },
        },
      },
    });
    relay.send({
      method: 'session/update',
      params: {
        sessionId: 'one',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'mcp-ask-1',
          name: 'ask_question',
          kind: 'other',
          title: 'Run ask_question',
          status: 'completed',
        },
      },
    });

    // Native Antigravity update_steps and ask_question in the same session still adapt normally.
    relay.send({
      method: 'session/update',
      params: {
        sessionId: 'one',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'native-steps-1',
          name: 'update_steps',
          kind: 'other',
          title: 'Run update_steps',
          status: 'in_progress',
          rawInput: { steps: [{ title: 'Native step', status: 'in_progress' }] },
        },
      },
    });
    relay.send({
      method: 'session/update',
      params: {
        sessionId: 'one',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'native-ask-1',
          name: 'ask_question',
          kind: 'other',
          title: 'Run ask_question',
          status: 'in_progress',
        },
      },
    });

    const updates = relay.client.filter((m) => m.method === 'session/update').map((m) => m.params.update);
    assert.deepEqual(updates, [
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'mcp-steps-1',
        name: 'mcp__partner__update_steps',
        kind: 'other',
        title: 'mcp__partner__update_steps',
        status: 'in_progress',
        rawInput: { steps: [{ title: 'Partner step', status: 'in_progress' }] },
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'mcp-steps-1',
        name: 'mcp__partner__update_steps',
        kind: 'other',
        title: 'mcp__partner__update_steps',
        status: 'completed',
        rawInput: { steps: [{ title: 'Partner step', status: 'done' }] },
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'mcp-ask-1',
        name: 'mcp__partner__ask_question',
        kind: 'other',
        title: 'mcp__partner__ask_question',
        status: 'in_progress',
        rawInput: { prompt: 'Partner question' },
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'mcp-ask-1',
        name: 'mcp__partner__ask_question',
        kind: 'other',
        title: 'mcp__partner__ask_question',
        status: 'completed',
      },
      {
        sessionUpdate: 'plan',
        entries: [{ content: 'Native step', priority: 'medium', status: 'in_progress' }],
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'native-ask-1',
        name: 'AskUserQuestion',
        kind: 'other',
        title: 'AskUserQuestion',
        status: 'in_progress',
      },
    ]);
  });

  test('exits right after Cindy has read the last notification, not after the flush timeout', { timeout: 40_000 }, async (t) => {
    const flushTimeoutMs = 2_000;
    let bridge = null;
    let notifications = 130;
    for (; notifications <= 210; notifications += 20) {
      const attempt = await agyExitsBeforeCindyReads(t, notifications);
      if (!attempt) return;
      if (attempt.child.exitCode === null) {
        bridge = attempt;
        break;
      }
    }
    if (!bridge) {
      t.skip("the pipes hold all of agy's output, so the relay has nothing left to flush when Cindy reads");
      return;
    }
    const resumedAt = Date.now();
    bridge.child.stdout.resume();
    const { code } = await bridge.closed;
    const exitMs = Date.now() - resumedAt;
    assert.equal(notificationsOf(bridge).length, notifications, 'every notification reaches Cindy');
    assert.equal(code, 0, `exit code (stderr: ${bridge.stderr.text()})`);
    assert.ok(exitMs < flushTimeoutMs / 2, `the bridge took ${exitMs} ms to exit after Cindy read everything; the flush timeout is ${flushTimeoutMs} ms`);
  });
});

test('a disconnected input rejects pending and subsequent ACP calls', async () => {
  const { connect } = await import(pathToFileURL(path.join(root, 'agy-client.js')));
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough() });
  const call = connect(child);
  const first = call('initialize', {});
  child.stdin.destroy(new Error('closed pipe'));
  await assert.rejects(first, /closed pipe/);
  await assert.rejects(call('session/new', {}), /closed pipe/);
});

test('closing a short-lived ACP connection reaps a CLI that ignores EOF and SIGTERM', { skip: isWin }, async t => {
  const fixture = makeFixture(t, { extraEnv: { FAKE_AGY_IGNORE_TERM: '1', FAKE_AGY_IGNORE_EOF: '1' } });
  const { openAgy } = await import(pathToFileURL(path.join(root, 'agy-client.js')));
  const connection = await openAgy({ env: fixture.env });
  t.after(() => connection.child.kill('SIGKILL'));
  connection.close();
  await waitFor(() => connection.child.signalCode === 'SIGKILL', 6000, 'CLI shutdown');
});

test('installation verifies the archive and staged CLI before activating it', {
  skip: isWin || systemHasAgy(),
}, t => {
  const fixture = makeFixture(t, { withAgy: false });
  const cli = path.join(fixture.dir, 'antigravity');
  fs.writeFileSync(cli, '#!/bin/sh\necho "agy 1.5.14"\n', { mode: 0o755 });
  const archive = execFileSync('/usr/bin/tar', ['-czf', '-', '-C', fixture.dir, 'antigravity']);
  const archivePath = path.join(fixture.dir, 'release.tar.gz');
  fs.writeFileSync(archivePath, archive);
  const digest = createHash('sha512').update(archive).digest('hex');
  const target = path.join(fixture.env.HOME, '.local/bin/agy');
  const script = `
    const [installer, archive, sha512] = process.argv.slice(1);
    const url = 'https://storage.googleapis.com/antigravity-public/antigravity-cli/fixture.tar.gz';
    global.fetch = async target => {
      if (target.href === url) return new Response(require('node:fs').readFileSync(archive));
      if (target.origin !== 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app') throw Error('unexpected host');
      return Response.json({ url, version: '1.5.14', sha512 });
    };
    require(installer)({ action: 'install' }).then(result => console.log(JSON.stringify(result)));
  `;
  const install = hash => JSON.parse(execFileSync(process.execPath, ['-e', script,
    path.join(root, 'cli-installer.cjs'), archivePath, hash], { env: fixture.env, encoding: 'utf8' }));
  assert.deepEqual(install('0'.repeat(128)), { error: 'integrity' });
  assert.equal(fs.existsSync(target), false);
  fs.mkdirSync(target);
  assert.deepEqual(install(digest), { error: 'operation' });
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['agy']);
  fs.rmdirSync(target);
  assert.deepEqual(install(digest), { state: 'installed', version: '1.5.14' });
  assert.deepEqual(fs.readFileSync(target), fs.readFileSync(cli));
});

test('adapts Antigravity update_steps into ACP plan updates and normalizes ask_question when form elicitation is negotiated', async () => {
  const mcp = await import(pathToFileURL(path.join(root, 'agy-mcp.js')));
  assert.equal(mcp.clientSupportsElicitationForm({ clientCapabilities: { elicitation: { form: {} } } }), true);
  assert.equal(mcp.clientSupportsElicitationForm({ clientCapabilities: { fs: { readTextFile: false } } }), false);

  const seenSteps = new Map();
  const firstSteps = mcp.adaptAgyNativeToolUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'steps-1',
    name: 'update_steps',
    title: 'Run update_steps',
    status: 'in_progress',
    rawInput: {
      steps: [
        { title: 'Inspect codebase', status: 'done' },
        { title: 'Apply fix', status: 'in_progress' },
        { title: 'Skip optional', status: 'skipped' },
      ],
    },
  }, { elicitationForm: true, seenSteps });
  assert.deepEqual(firstSteps, {
    action: 'replace',
    update: {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Inspect codebase', priority: 'medium', status: 'completed' },
        { content: 'Apply fix', priority: 'medium', status: 'in_progress' },
        { content: 'Skip optional', priority: 'medium', status: 'completed' },
      ],
    },
  });

  // Duplicate completed update for the same toolCallId is dropped instead of rendering a raw tool card.
  const duplicateSteps = mcp.adaptAgyNativeToolUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'steps-1',
    name: 'update_steps',
    status: 'completed',
    rawInput: {
      steps: [
        { title: 'Inspect codebase', status: 'done' },
        { title: 'Apply fix', status: 'in_progress' },
        { title: 'Skip optional', status: 'skipped' },
      ],
    },
  }, { elicitationForm: true, seenSteps });
  assert.deepEqual(duplicateSteps, { action: 'drop' });

  // Failed tool_call_update is preserved even when rawInput is omitted or repeats the same steps.
  const failedOmitted = mcp.adaptAgyNativeToolUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'steps-1',
    status: 'failed',
    rawOutput: 'error',
  }, { elicitationForm: true, seenSteps });
  assert.equal(failedOmitted, null);

  mcp.adaptAgyNativeToolUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'steps-2',
    name: 'update_steps',
    status: 'in_progress',
    rawInput: { steps: [{ title: 'Step A', status: 'in_progress' }] },
  }, { elicitationForm: true, seenSteps });
  const failedRepeated = mcp.adaptAgyNativeToolUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'steps-2',
    name: 'update_steps',
    status: 'failed',
    rawInput: { steps: [{ title: 'Step A', status: 'in_progress' }] },
  }, { elicitationForm: true, seenSteps });
  assert.equal(failedRepeated, null);

  // Older hosts (elicitationForm: false) keep raw update_steps unchanged so existing progress rows do not disappear.
  const legacySteps = mcp.adaptAgyNativeToolUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'steps-legacy',
    name: 'update_steps',
    status: 'in_progress',
    rawInput: { steps: [{ title: 'Legacy step', status: 'in_progress' }] },
  }, { elicitationForm: false, seenSteps });
  assert.equal(legacySteps, null);

  // ask_question is normalized to AskUserQuestion only when the client negotiated form elicitation.
  const askWithForm = mcp.adaptAgyNativeToolUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'ask-1',
    name: 'ask_question',
    title: 'Run ask_question',
    status: 'in_progress',
  }, { elicitationForm: true, seenSteps });
  assert.equal(askWithForm?.action, 'replace');
  assert.equal(askWithForm?.update.name, 'AskUserQuestion');
  assert.equal(askWithForm?.update.title, 'AskUserQuestion');

  const askWithoutForm = mcp.adaptAgyNativeToolUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'ask-2',
    name: 'ask_question',
    title: 'Run ask_question',
    status: 'in_progress',
  }, { elicitationForm: false, seenSteps });
  assert.equal(askWithoutForm, null);
});
