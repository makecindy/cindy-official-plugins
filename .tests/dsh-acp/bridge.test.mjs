// Run: node --test test/
//
// Exercises the real entry files (worker.js, dsh-acp.js) as child processes against
// a fake `dsh` placed on PATH (a Node script plus a `.cmd` wrapper on Windows or a
// `sh` wrapper elsewhere). Each test gets its own temp directory, HOME and PATH, so
// the tests run in parallel and do not see a real dsh installation.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dsh-acp');
const isWin = process.platform === 'win32';

const RESULT_JSON =
  '{"protocolVersion":1,"agentCapabilities":{"loadSession":false,"promptCapabilities":{"image":false}},' +
  '"agentInfo":{"name":"fake-dsh","title":"假 DSH ✓","version":"0.2.2"},"authMethods":[]}';
const INITIALIZE =
  '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}\n';
const EXPECTED_RESPONSE = Buffer.from(`{"jsonrpc":"2.0","id":0,"result":${RESULT_JSON}}\n`, 'utf8');

const FAKE_DSH_SOURCE = `'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  if (process.env.FAKE_DSH_BROKEN === '1') {
    process.stderr.write('dsh requires Node.js >= 24.9.0\\n');
    process.exit(1);
  }
  process.stdout.write('dsh 0.2.2\\n');
  process.exit(0);
}
const PATCH_FILES = new Set(['remote-workspace.patch.yml', 'guest-workspace.patch.yml']);
const isRemote = args.length >= 4 && args[0] === '--profile' && args[1] === 'acp' && args[2] === '--patch' && PATCH_FILES.has(args[3]);
if (isRemote && process.env.FAKE_DSH_NO_PATCH === '1') {
  process.stderr.write("error: unknown option '--patch'\\n");
  process.exit(1);
}
if (isRemote && args.length === 5 && args[4] === '--dump-config') {
  if (process.env.FAKE_DSH_DELAY_DUMP) {
    fs.writeFileSync(process.env.FAKE_DSH_DELAY_DUMP, JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
    setTimeout(() => process.exit(1), 15000);
    return;
  }
  // The composed tree as dsh prints it: the overlay file in the working directory decides what is off.
  const overlay = fs.readFileSync(args[3], 'utf8');
  // The overlay may be checked out with CRLF line endings; dsh reads it either way.
  const off = (id) => new RegExp('^- id: ' + id + '\\r?\\n  disabled: true\\r?$', 'm').test(overlay);
  const tools = ['tool-bash', 'tool-fs', 'tool-workflow', 'tool-todo', 'tool-skill', 'tool-web', 'skill', 'web-fetch-http', ...(process.env.FAKE_DSH_EXTRA_TOOL ? [process.env.FAKE_DSH_EXTRA_TOOL] : [])];
  process.stdout.write('- id: llm\\n  name: llm\\n' + tools.map((id) => '- id: ' + id + '\\n  name: x\\n' + (off(id) ? '  disabled: true\\n' : '')).join(''));
  process.exit(0);
}
if (!(isRemote && args.length === 4) && (args.length !== 2 || args[0] !== '--profile' || args[1] !== 'acp')) {
  process.stderr.write('fake-dsh: unexpected arguments ' + JSON.stringify(args) + '\\n');
  process.exit(2);
}
if (process.env.FAKE_DSH_LAUNCHFILE) {
  fs.writeFileSync(process.env.FAKE_DSH_LAUNCHFILE, JSON.stringify({ args, cwd: process.cwd(), files: fs.readdirSync(process.cwd()) }));
}
if (process.env.FAKE_DSH_PIDFILE) fs.writeFileSync(process.env.FAKE_DSH_PIDFILE, String(process.pid));
process.stderr.write('fake-dsh: ready\\n');
const RESULT_JSON = ${JSON.stringify(RESULT_JSON)};
let buffered = '';
process.stdin.on('data', (chunk) => {
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
process.stdin.on('end', () => {
  if (process.env.FAKE_DSH_IGNORE_EOF === '1') {
    setInterval(() => {}, 1000);
    return;
  }
  process.stdout.write('', () => process.exit(0));
});
`;

function makeFixture(t, { withDsh = true, extraEnv = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-acp-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  const script = path.join(dir, 'fake-dsh.js');
  fs.writeFileSync(script, FAKE_DSH_SOURCE, 'utf8');
  let dshPath = null;
  if (withDsh) {
    if (isWin) {
      dshPath = path.join(bin, 'dsh.cmd');
      fs.writeFileSync(dshPath, `@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      dshPath = path.join(bin, 'dsh');
      fs.writeFileSync(dshPath, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
      fs.chmodSync(dshPath, 0o755);
    }
  }
  const pidFile = path.join(dir, 'dsh.pid');
  const env = { FAKE_DSH_PIDFILE: pidFile, ...extraEnv };
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
  return { dir, dshPath, pidFile, env };
}

/** Real installs in fixed system directories would make "not installed" untestable. */
function systemHasDsh() {
  if (isWin) return false;
  return ['/usr/local/bin', '/opt/homebrew/bin'].some((dir) => fs.existsSync(path.join(dir, 'dsh')));
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

function startWorker(env, preload) {
  const child = spawn(process.execPath, [...(preload ? ['--require', preload] : []), path.join(root, 'worker.js')], { env, cwd: os.tmpdir(), stdio: 'pipe' });
  const stderr = collect(child.stderr);
  const closed = waitClose(child);
  const waiting = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const next = waiting.shift();
    if (next) next(JSON.parse(line));
  });
  return {
    call(request) {
      return new Promise((resolve) => {
        waiting.push(resolve);
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

/**
 * A stand-in for the npm layout of `@deepseek-ai/dsh` next to the fake dsh: the package plus
 * minimal `cordis` / `dsh-credentials` / `dsh-credentials-local` modules with the API surface the
 * plugin uses. The fake store keeps keys in `<dir>/credentials.json` and records its config.
 */
function addFakeCredentialStore(fixture) {
  const pkg = path.join(path.dirname(fixture.dshPath), 'node_modules', '@deepseek-ai', 'dsh');
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  };
  write(path.join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2' }));
  const dep = (name, source) => {
    const dir = path.join(pkg, 'node_modules', '@deepseek-ai', name);
    write(path.join(dir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, type: 'module' }));
    write(path.join(dir, 'lib', 'index.js'), source);
  };
  dep('cordis', `export class Context {
  constructor() { this.services = new Map(); }
  get(name) { return this.services.get(name); }
  plugin(Provider, config) {
    const service = new Provider(this, config);
    let ready;
    const inertia = new Promise((resolve) => { ready = resolve; });
    setTimeout(() => { this.services.set('credentials', service); ready(); }, 10);
    return { inertia, dispose: async () => { this.services.delete('credentials'); } };
  }
}
`);
  dep('dsh-credentials', 'export const credentialRef = (name) => name;\n');
  dep('dsh-credentials-local', `import fs from 'node:fs';
import path from 'node:path';
const home = process.env.FAKE_DSH_HOME;
const file = path.join(home, 'credentials.json');
const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
export class LocalCredentialProvider {
  constructor(ctx, config) { fs.writeFileSync(path.join(home, 'provider-config.json'), JSON.stringify(config)); }
  async resolve(ref) {
    const value = read()[ref] || process.env[ref];
    return value ? { value } : undefined;
  }
  async describe(ref) {
    if (read()[ref]) return { configured: true, source: 'file', writable: true };
    if (process.env[ref]) return { configured: true, source: 'env', writable: true };
    return { configured: false, writable: true };
  }
  async set(ref, value) { fs.writeFileSync(file, JSON.stringify({ ...read(), [ref]: value })); }
  async unset(ref) { const next = read(); delete next[ref]; fs.writeFileSync(file, JSON.stringify(next)); }
}
`);
  return { storeFile: path.join(fixture.dir, 'credentials.json'), configFile: path.join(fixture.dir, 'provider-config.json') };
}

function startBridge(env, args = [], stdio = 'pipe') {
  const child = spawn(process.execPath, [path.join(root, 'dsh-acp.js'), ...args], { env, cwd: os.tmpdir(), stdio });
  return { child, stdout: collect(child.stdout), stderr: collect(child.stderr), closed: waitClose(child) };
}

describe('dsh-acp plugin', { concurrency: true, timeout: 20_000 }, () => {
  test('detect finds dsh on PATH and reports its version', async (t) => {
    const fixture = makeFixture(t);
    const worker = startWorker(fixture.env);
    const response = await worker.call({ jsonrpc: '2.0', id: 1, method: 'detect', params: { locale: 'zh-CN' } });
    assert.equal(response.id, 1);
    assert.equal(response.result.available, true);
    assert.equal(response.result.version, '0.2.2');
    assert.ok(samePath(response.result.path, fixture.dshPath), `path ${response.result.path}`);
    assert.equal(response.result.reason, undefined);

    const unknown = await worker.call({ jsonrpc: '2.0', id: 2, method: 'no/such-method' });
    assert.deepEqual(unknown, { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method not found' } });
    await worker.close();
  });

  test('detect reports not-installed with an install hint when dsh is missing', async (t) => {
    if (systemHasDsh()) {
      t.skip('a real dsh is installed in a fixed system directory on this machine');
      return;
    }
    const fixture = makeFixture(t, { withDsh: false });
    const worker = startWorker(fixture.env);
    const zh = await worker.call({ jsonrpc: '2.0', id: 'a', method: 'detect', params: { locale: 'zh-CN' } });
    assert.equal(zh.result.available, false);
    assert.equal(zh.result.reason, 'not-installed');
    assert.equal(
      zh.result.message,
      '未找到 DeepSeek Harness。请先安装：npm i -g @deepseek-ai/dsh（需要 Node.js 24.9 或更高版本）',
    );
    assert.equal(zh.result.path, undefined);
    const en = await worker.call({ jsonrpc: '2.0', id: 'b', method: 'detect', params: { locale: 'fr' } });
    assert.match(en.result.message, /^DeepSeek Harness was not found\. Install it first: npm i -g @deepseek-ai\/dsh/);
    assert.equal(en.result.messages['zh-CN'], zh.result.message);
    await worker.close();
  });

  test('detect reports not-runnable when dsh --version fails', async (t) => {
    const fixture = makeFixture(t, { extraEnv: { FAKE_DSH_BROKEN: '1' } });
    const worker = startWorker(fixture.env);
    const response = await worker.call({ jsonrpc: '2.0', id: 3, method: 'detect', params: { locale: 'en' } });
    assert.equal(response.result.available, false);
    assert.equal(response.result.reason, 'not-runnable');
    assert.ok(samePath(response.result.path, fixture.dshPath));
    assert.match(response.result.detail, /exit code 1: dsh requires Node\.js >= 24\.9\.0/);
    await worker.close();
  });

  test('dsh-acp relays ACP bytes unchanged and exits with dsh when stdin closes', async (t) => {
    const fixture = makeFixture(t);
    const bridge = startBridge(fixture.env);
    bridge.child.stdin.write(INITIALIZE);
    await waitFor(() => bridge.stdout.bytes().length >= EXPECTED_RESPONSE.length, 8_000, 'initialize response');
    assert.ok(bridge.stdout.bytes().equals(EXPECTED_RESPONSE), `stdout was ${JSON.stringify(bridge.stdout.text())}`);
    const pid = readPid(fixture.pidFile);
    assert.ok(pid, 'fake dsh wrote its pid');
    assert.ok(isAlive(pid), 'fake dsh is running before stdin closes');

    bridge.child.stdin.end();
    const { code } = await bridge.closed;
    assert.equal(code, 0);
    assert.ok(bridge.stdout.bytes().equals(EXPECTED_RESPONSE), 'no extra bytes on stdout');
    assert.match(bridge.stderr.text(), /fake-dsh: ready/);
    await waitFor(() => !isAlive(pid), 3_000, 'fake dsh to exit');
  });

  // Why: with the project on another computer, dsh's own file and command tools would act on the
  // wrong computer. Gap: the existing relay tests only cover the plain `--profile acp` launch.
  // Smallest failing input: the same initialize request, with Cindy's remote-workspace argument.
  test('remote-workspace mode starts dsh with its own tools off, in a private directory', async (t) => {
    const launchFile = path.join(os.tmpdir(), `dsh-acp-launch-${process.pid}-${Date.now()}.json`);
    t.after(() => fs.rmSync(launchFile, { force: true }));
    const fixture = makeFixture(t, { extraEnv: { FAKE_DSH_LAUNCHFILE: launchFile } });
    const bridge = startBridge(fixture.env, ['--cindy-remote-workspace']);
    bridge.child.stdin.write(INITIALIZE);
    await waitFor(() => bridge.stdout.bytes().length >= EXPECTED_RESPONSE.length, 8_000, 'initialize response');
    assert.ok(bridge.stdout.bytes().equals(EXPECTED_RESPONSE), `stdout was ${JSON.stringify(bridge.stdout.text())}`);
    const launch = JSON.parse(fs.readFileSync(launchFile, 'utf8'));
    assert.deepEqual(launch.args, ['--profile', 'acp', '--patch', 'remote-workspace.patch.yml']);
    assert.deepEqual(launch.files, ['remote-workspace.patch.yml'], 'dsh runs in a directory holding only the overlay');
    assert.ok(!samePath(launch.cwd, os.tmpdir()), 'not the shared temp folder');

    bridge.child.stdin.end();
    const { code } = await bridge.closed;
    assert.equal(code, 0);
    assert.ok(!fs.existsSync(launch.cwd), 'the private directory is removed when the task ends');
  });

  for (const mode of ['remote', 'guest']) {
    test(`cancelling the ${mode} precheck stops DSH and removes the launch directory`, async t => {
      const fixture = makeFixture(t);
      const marker = path.join(fixture.dir, 'precheck.json');
      fixture.env.FAKE_DSH_DELAY_DUMP = marker;
      const bridge = startBridge(fixture.env, [`--cindy-${mode}-workspace`], ['pipe', 'pipe', 'pipe', 'ipc']);
      await waitFor(() => fs.existsSync(marker) && fs.statSync(marker).size > 0, 8_000, 'DSH precheck');
      const { pid, cwd } = JSON.parse(fs.readFileSync(marker, 'utf8'));
      const exited = new Promise(resolve => bridge.child.once('exit', resolve));
      if (mode === 'remote' && !isWin) bridge.child.kill('SIGTERM');
      else bridge.child.disconnect();
      await waitFor(() => !isAlive(pid), 3_000, 'precheck to stop');
      assert.equal(await exited, 143);
      assert.equal(readPid(fixture.pidFile), null, 'ACP did not launch after cancellation');
      assert.equal(fs.existsSync(cwd), false);
    });
  }

  // Why: the overlay only names the tools known today. A tool it does not switch off (a newer dsh,
  // or a plugin in the user's profile) would touch this computer, so the launch must not happen.
  test('remote-workspace mode refuses to start when a tool would still act on this computer', async (t) => {
    const fixture = makeFixture(t, { extraEnv: { FAKE_DSH_EXTRA_TOOL: 'tool-new-shell' } });
    const bridge = startBridge(fixture.env, ['--cindy-remote-workspace']);
    bridge.child.stdin.write(INITIALIZE);
    const { code } = await bridge.closed;
    assert.equal(code, 78);
    assert.equal(bridge.stdout.bytes().length, 0, 'dsh never answered: it was not started');
    assert.match(bridge.stderr.text(), /tool-new-shell/);
    assert.equal(readPid(fixture.pidFile), null, 'the ACP process was never launched');
  });

  // Why: a dsh from before `--patch` cannot take the overlay; it must not fall back to a normal launch.
  test('remote-workspace mode refuses a dsh that does not accept the overlay', async (t) => {
    const fixture = makeFixture(t, { extraEnv: { FAKE_DSH_NO_PATCH: '1' } });
    const bridge = startBridge(fixture.env, ['--cindy-remote-workspace']);
    const { code } = await bridge.closed;
    assert.equal(code, 78);
    assert.equal(bridge.stdout.bytes().length, 0);
    assert.equal(readPid(fixture.pidFile), null);
  });

  test('guest-workspace mode starts dsh with guest-workspace.patch.yml and blocks session/list', async (t) => {
    const launchFile = path.join(os.tmpdir(), `dsh-acp-guest-${process.pid}-${Date.now()}.json`);
    t.after(() => fs.rmSync(launchFile, { force: true }));
    const fixture = makeFixture(t, { extraEnv: { FAKE_DSH_LAUNCHFILE: launchFile } });
    const bridge = startBridge(fixture.env, ['--cindy-remote-workspace', '--cindy-guest-workspace']);
    bridge.child.stdin.write(INITIALIZE);
    await waitFor(() => bridge.stdout.bytes().length >= EXPECTED_RESPONSE.length, 8_000, 'initialize response');
    const launch = JSON.parse(fs.readFileSync(launchFile, 'utf8'));
    assert.deepEqual(launch.args, ['--profile', 'acp', '--patch', 'guest-workspace.patch.yml']);
    assert.deepEqual(launch.files, ['guest-workspace.patch.yml']);

    bridge.child.stdin.write('{"jsonrpc":"2.0","id":9,"method":"session/list","params":{}}\n');
    await waitFor(() => bridge.stdout.text().includes('"id":9'), 3_000, 'session/list error');
    const lines = bridge.stdout.text().trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(lines.find((m) => m.id === 9)?.error?.code, -32601);

    bridge.child.stdin.end();
    const { code } = await bridge.closed;
    assert.equal(code, 0);
  });

  test('stopping dsh-acp leaves no dsh process behind', async (t) => {
    // POSIX: the SIGTERM handler must stop a dsh that ignores stdin EOF.
    // Windows: TerminateProcess skips handlers; dsh must see EOF on its stdin and exit.
    const fixture = makeFixture(t, { extraEnv: isWin ? {} : { FAKE_DSH_IGNORE_EOF: '1' } });
    const bridge = startBridge(fixture.env);
    await waitFor(() => readPid(fixture.pidFile) !== null, 8_000, 'fake dsh to start');
    const pid = readPid(fixture.pidFile);
    assert.ok(isAlive(pid), 'fake dsh is running before the stop');
    bridge.child.kill('SIGTERM');
    const { code } = await bridge.closed;
    if (!isWin) assert.equal(code, 143);
    await waitFor(() => !isAlive(pid), 4_000, 'fake dsh to be stopped');
    assert.equal(bridge.stdout.bytes().length, 0);
  });

  test('dsh-acp force-stops a dsh that lingers after stdin closes', async (t) => {
    // Windows: exercises the taskkill /T tree kill (cmd.exe shim and node).
    const fixture = makeFixture(t, { extraEnv: { FAKE_DSH_IGNORE_EOF: '1' } });
    const bridge = startBridge(fixture.env);
    await waitFor(() => readPid(fixture.pidFile) !== null, 8_000, 'fake dsh to start');
    const pid = readPid(fixture.pidFile);
    assert.ok(isAlive(pid), 'fake dsh is running before stdin closes');
    bridge.child.stdin.end();
    const { code } = await bridge.closed;
    assert.notEqual(code, 0);
    await waitFor(() => !isAlive(pid), 3_000, 'fake dsh to be stopped');
  });

  test('main.js publishes detection with PUT /harnesses and answers the settings page', async (t) => {
    const ZH = '未找到 DeepSeek Harness。请先安装：npm i -g @deepseek-ai/dsh（需要 Node.js 24.9 或更高版本）';
    const EN = 'DeepSeek Harness was not found. Install it first: npm i -g @deepseek-ai/dsh (requires Node.js 24.9 or later)';
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
      body: { harnesses: [{ id: 'dsh', available: false, reason: 'not-installed', message: ZH }] },
    });

    const page = new TrackedChannel('dsh-acp');
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

  test('the worker saves, reports and clears the DeepSeek key in DSH’s store and never returns it', async (t) => {
    const fixture = makeFixture(t, { extraEnv: { DEEPSEEK_API_KEY: 'sk-from-env' } });
    fixture.env.FAKE_DSH_HOME = fixture.dir;
    const store = addFakeCredentialStore(fixture);
    const worker = startWorker(fixture.env);
    const call = async (id, method, params) => {
      const response = await worker.call({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
      assert.ok(!JSON.stringify(response).includes('sk-'), `${method} response must not carry a key`);
      return response.result;
    };

    assert.deepEqual(await call(1, 'keyStatus'), { supported: true, configured: true, source: 'env', writable: true });
    assert.deepEqual(await call(2, 'setKey', { key: 'sk-with space' }), { supported: true, error: 'invalid-key' });
    assert.equal(fs.existsSync(store.storeFile), false, 'an invalid key is never written');

    assert.deepEqual(await call(3, 'setKey', { key: '  sk-saved-123\n' }), {
      supported: true, configured: true, source: 'file', writable: true,
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(store.storeFile, 'utf8')), { DEEPSEEK_API_KEY: 'sk-saved-123' });
    // One-shot store: no file watcher of its own (running dsh processes watch the file).
    assert.deepEqual(JSON.parse(fs.readFileSync(store.configFile, 'utf8')), { watch: false });

    // Clearing the saved key falls back to the environment again.
    assert.deepEqual(await call(4, 'clearKey'), { supported: true, configured: true, source: 'env', writable: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(store.storeFile, 'utf8')), {});
    await worker.close();
  });

  test('the key methods report an unsupported setup instead of writing anywhere', async (t) => {
    const noStore = makeFixture(t);
    const worker = startWorker(noStore.env);
    const layout = await worker.call({ jsonrpc: '2.0', id: 1, method: 'setKey', params: { key: 'sk-x' } });
    assert.deepEqual(layout.result, { supported: false, reason: 'unknown-layout' });
    await worker.close();

    const noDsh = makeFixture(t, { withDsh: false });
    if (!systemHasDsh()) {
      const missing = startWorker(noDsh.env);
      const response = await missing.call({ jsonrpc: '2.0', id: 1, method: 'keyStatus' });
      assert.deepEqual(response.result, { supported: false, reason: 'not-installed' });
      await missing.close();
    }
    assert.deepEqual(fs.readdirSync(noStore.dir).filter((name) => name.endsWith('.json')), []);
  });

  test('usage checks the official account and preserves zero without exposing the credential', async t => {
    const fixture = makeFixture(t);
    const { storeFile } = addFakeCredentialStore(fixture);
    const preload = path.join(fixture.dir, 'balance.cjs');
    fs.writeFileSync(preload, `globalThis.fetch = async (url, options) => {
      if (url !== 'https://api.deepseek.com/user/balance' || options.headers.Authorization !== 'Bearer fixture'
        || options.redirect !== 'error') throw new Error('unexpected balance request');
      return { ok: true, json: async () => ({ balance_infos: [
        { currency: 'CNY', total_balance: '0.00', other: 'private' },
        { currency: 'USD', total_balance: '1.23' }, { currency: 'USD', total_balance: '' }
      ] }) };
    };`);
    const worker = startWorker({ ...fixture.env, FAKE_DSH_HOME: fixture.dir }, preload);
    try {
      fs.writeFileSync(storeFile, JSON.stringify({ DEEPSEEK_API_KEY: 'fixture' }));
      const read = async id => (await worker.call({ jsonrpc: '2.0', id, method: 'usage', params: { harnessId: 'dsh' } })).result;
      const usage = await read(1);
      assert.ok(usage.updatedAt > 0);
      assert.deepEqual(usage, { updatedAt: usage.updatedAt, balances: [
        { currency: 'CNY', amount: '0.00' }, { currency: 'USD', amount: '1.23' },
      ] });
      fs.writeFileSync(storeFile, JSON.stringify({ DEEPSEEK_API_KEY: 'fixture', DEEPSEEK_BASE_URL: 'https://proxy.invalid' }));
      assert.equal(await read(2), null);
    } finally { await worker.close(); }
  });

  test('main.js passes the key to the worker once and returns only its status fields', async () => {
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
    const context = vm.createContext({
      BroadcastChannel: Channel,
      setTimeout,
      clearTimeout,
      cindy: {
        request: async () => ({ ok: true, context: { locale: 'en', uiLocale: 'en' } }),
        node: {
          request: async (request) => {
            nodeCalls.push(JSON.parse(JSON.stringify(request)));
            if (request.method === 'detect') return { ok: true, result: { available: true, version: '0.2.2' } };
            if (request.method === 'listModels') {
              return { ok: true, result: { supported: true, sessionId: 'probe-1',
                models: [{ id: '["deepseek-official","v4-pro"]', name: 'DeepSeek-V4-Pro', group: 'DeepSeek', extra: 'x' }] } };
            }
            // Anything beyond the status fields (here a stray `value`) must not reach the page.
            return { ok: true, result: { supported: true, configured: true, source: 'file', writable: true, value: 'sk-leak' } };
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
    const calls = (...methods) => nodeCalls.filter((call) => methods.includes(call.method));
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });

    // Start-up without a saved list: detect, read DSH's models once, publish them with the status.
    await waitFor(() => puts.some((body) => body.harnesses[0].models), 3_000, 'models published');
    assert.deepEqual(calls('listModels'), [{ method: 'listModels', params: {}, timeoutMs: 90_000 }]);
    assert.deepEqual(puts.at(-1), { harnesses: [{ id: 'dsh', available: true, reportsUsage: true, remoteWorkspace: true, guestWorkspace: true, version: '0.2.2',
      models: [{ id: '["deepseek-official","v4-pro"]', name: 'DeepSeek-V4-Pro', group: 'DeepSeek' }] }] });
    assert.equal(savedState.modelSessionId, 'probe-1');

    const page = new Channel('dsh-acp');
    const received = [];
    page.onmessage = (event) => received.push(event.data);
    page.postMessage({ type: 'key-request', reqId: 'k1', op: 'set', key: 'sk-typed' });
    page.postMessage({ type: 'key-request', reqId: 'k1', op: 'set', key: 'sk-typed' }); // resent before the ack
    await waitFor(() => received.some((m) => m.type === 'key-result'), 3_000, 'key-result');
    assert.deepEqual(calls('setKey', 'keyStatus', 'clearKey'), [{ method: 'setKey', params: { key: 'sk-typed' }, timeoutMs: 30_000 }]);
    assert.deepEqual(received.find((m) => m.type === 'key-result'), {
      type: 'key-result', reqId: 'k1', result: { supported: true, configured: true, source: 'file', writable: true },
    });
    // A new key can change DeepSeek's models: the list is read again in the same dedicated session.
    await waitFor(() => calls('listModels').length === 2, 3_000, 'models re-read after the key changed');
    assert.deepEqual(calls('listModels')[1].params, { sessionId: 'probe-1' });

    page.postMessage({ type: 'key-request', reqId: 'k2', op: 'status', key: 'sk-ignored' });
    await waitFor(() => received.filter((m) => m.type === 'key-result').length === 2, 3_000, 'status result');
    assert.deepEqual(calls('keyStatus'), [{ method: 'keyStatus', params: {}, timeoutMs: 30_000 }]);
    page.postMessage({ type: 'key-request', reqId: 'k3', op: 'delete-everything' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls('setKey', 'keyStatus', 'clearKey').length, 2, 'unknown operations are ignored');
    assert.equal(calls('listModels').length, 2, 'a status check does not re-read the models');
  });

  test('listModels reads the model option dsh offers, flattening its groups', async () => {
    const { modelsFromConfigOptions } = await import(pathToFileURL(path.join(root, 'dsh-models.js')).href);
    assert.deepEqual(modelsFromConfigOptions([
      { id: 'reasoning_effort', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'high', name: 'High' }] },
      { id: 'model', category: 'model', type: 'select', currentValue: '["deepseek-official","deepseek-v4-flash"]', options: [
        { name: 'DeepSeek', options: [
          { value: '["deepseek-official","deepseek-v4-flash"]', name: 'deepseek-v4-flash' },
          { value: '["deepseek-official","v4-pro"]', name: 'DeepSeek-V4-Pro', description: 'Stronger agentic coding' },
          { value: '["deepseek-official","v4-pro"]', name: 'duplicate' },
          { name: 'no value' },
        ] },
      ] },
    ]), [
      { id: '["deepseek-official","deepseek-v4-flash"]', name: 'deepseek-v4-flash', group: 'DeepSeek' },
      { id: '["deepseek-official","v4-pro"]', name: 'DeepSeek-V4-Pro', description: 'Stronger agentic coding', group: 'DeepSeek' },
    ]);
    assert.deepEqual(modelsFromConfigOptions(undefined), []);
  });

  test('a disconnected model probe leaves its worker available for detection', async (t) => {
    const fixture = makeFixture(t);
    const script = path.join(fixture.dir, 'fake-dsh.js');
    fs.writeFileSync(script, `
      if (process.argv.includes('--version')) { console.log('dsh 0.2.2'); return; }
      require('node:fs').closeSync(0);
      // Ask the client to reply on the closed pipe before this process exits.
      setTimeout(() => console.log(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 99 })), 50);
      setTimeout(() => process.exit(1), 300);
    `);
    const worker = startWorker(fixture.env);
    t.after(() => worker.close());
    const result = await worker.call({ jsonrpc: '2.0', id: 1, method: 'listModels' });
    assert.equal(result.result.error, 'list-failed');
    const detect = await worker.call({ jsonrpc: '2.0', id: 2, method: 'detect' });
    assert.equal(detect.result.version, '0.2.2');
  });

  test('slow but responsive model switches share one deadline and the probe is reaped', async (t) => {
    const fixture = makeFixture(t);
    const script = path.join(fixture.dir, 'fake-dsh.js');
    const switches = path.join(fixture.dir, 'switches');
    fs.writeFileSync(script, `
      const fs = require('node:fs');
      fs.writeFileSync(process.env.FAKE_DSH_PIDFILE, String(process.pid));
      const options = Array.from({length: 60}, (_, i) => ({value: String(i), name: String(i)}));
      const configOptions = [{id: 'model', type: 'select', currentValue: '0', options}];
      require('node:readline').createInterface({input: process.stdin}).on('line', line => {
        const {id, method} = JSON.parse(line);
        const reply = result => console.log(JSON.stringify({jsonrpc: '2.0', id, result}));
        if (method === 'initialize') return reply({});
        if (method === 'session/new') return reply({sessionId: 'probe', configOptions});
        fs.appendFileSync(process.env.FAKE_SWITCHES, 'x');
        setTimeout(() => reply({configOptions}), 150);
      });
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `);
    fixture.env.FAKE_SWITCHES = switches;
    const { listModels } = await import(pathToFileURL(path.join(root, 'dsh-models.js')).href);
    await assert.rejects(listModels({}, { env: fixture.env, probeTimeoutMs: 1500 }), /did not answer|timed out/);
    const count = fs.readFileSync(switches, 'utf8').length;
    assert.ok(count > 0 && count < 59);
    const pid = readPid(fixture.pidFile);
    await waitFor(() => !isAlive(pid), 6_000, 'the probe to exit after its deadline');
    assert.equal(fs.readFileSync(switches, 'utf8').length, count);
  });

  // 2026-11-19 实测 dsh 的 reasoning_effort 是 off / low / high / max；Cindy 没有 off。
  test('reasoning levels come from the thought_level option, keeping only Cindy level ids', async () => {
    const { effortsFromConfigOptions } = await import(pathToFileURL(path.join(root, 'dsh-models.js')).href);
    const thought = (currentValue, values) => [{ id: 'reasoning_effort', category: 'thought_level', type: 'select', currentValue,
      options: values.map((value) => ({ value, name: value })) }];
    assert.deepEqual(effortsFromConfigOptions(thought('high', ['off', 'low', 'high', 'max'])),
      { efforts: ['low', 'high', 'max'], defaultEffort: 'high' });
    assert.deepEqual(effortsFromConfigOptions(thought('off', ['max', 'off', 'low'])), { efforts: ['low', 'max'] });
    assert.deepEqual(effortsFromConfigOptions(thought('off', ['off'])), {});
    assert.deepEqual(effortsFromConfigOptions(undefined), {});
  });

  test('dsh-acp exits 127 with a single stderr line when dsh is missing', async (t) => {
    if (systemHasDsh()) {
      t.skip('a real dsh is installed in a fixed system directory on this machine');
      return;
    }
    const fixture = makeFixture(t, { withDsh: false });
    const bridge = startBridge(fixture.env);
    const { code } = await bridge.closed;
    assert.equal(code, 127);
    assert.equal(bridge.stdout.bytes().length, 0);
    assert.match(bridge.stderr.text(), /^\[dsh-acp\] [^\n]*npm i -g @deepseek-ai\/dsh[^\n]*\n$/);
  });
});
