import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const pluginRoot = path.join(root, 'console-cli');
const source = readFileSync(path.join(pluginRoot, 'main.js'), 'utf8');
const worker = readFileSync(path.join(pluginRoot, 'src/worker.cjs'), 'utf8');
const settings = readFileSync(path.join(pluginRoot, 'settings.html'), 'utf8');
const settingsScript = readFileSync(path.join(pluginRoot, 'settings.js'), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(pluginRoot, 'ghost.json'), 'utf8'));

test('manifest uses a production-only Node CLI bridge', () => {
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.version, '0.1.17');
  assert.equal(manifest.minCindyVersion, '0.1.72');
  assert.equal(manifest.id, 'console-cli');
  assert.equal(manifest.name, 'TapTap Console');
  assert.equal(Object.hasOwn(manifest, 'slots'), false);
  assert.equal(manifest.notify, true);
  assert.equal(manifest.network, undefined);
  assert.equal(manifest.node.entry, 'node/worker.cjs');
  assert.equal(manifest.node.protocol, 'json-rpc-stdio');
  assert.equal(manifest.node.lifecycle, 'resident');
  assert.equal(manifest.node.idleTimeoutSeconds, undefined);
  assert.deepEqual(
    manifest.tools.map((tool) => tool.name),
    ['console_cli_status', 'console_cli_login', 'console_cli_discover', 'console_cli_help', 'console_cli_schema', 'console_cli_run'],
  );
});

test('manifest and locales record Console recall boundaries and CLI call order', () => {
  assert.match(manifest.whenToUse, /TapTap Infra Console/);
  for (const term of ['status', 'discover', 'help', 'schema', 'run']) {
    assert.ok(manifest.whenToUse.includes(term), `manifest.whenToUse should mention ${term}`);
  }
  assert.match(manifest.whenToUse, /CLI 不支持/);

  for (const locale of ['en', 'zh-CN', 'ja', 'ko']) {
    const resource = JSON.parse(readFileSync(path.join(pluginRoot, 'locales', `${locale}.json`), 'utf8'));
    const text = resource.whenToUse;
    const order = ['status', 'discover', 'help', 'schema', 'run'];
    for (let index = 1; index < order.length; index += 1) {
      assert.ok(
        text.indexOf(order[index - 1]) < text.indexOf(order[index]),
        `${locale}.whenToUse should preserve ${order[index - 1]} before ${order[index]}`,
      );
    }
    assert.match(text, /schema[\s\S]{0,80}run/);
    assert.ok(resource.tools.console_cli_run.description.includes('CLI'));
    assert.match(resource.tools.console_cli_status.description, /macOS|macOS\/Linux/);
    assert.match(resource.tools.console_cli_login.description, /macOS|macOS\/Linux/);
    assert.ok(resource.tools.console_cli_status.description.length <= 300, `${locale}.status description exceeds 300 characters`);
    assert.ok(resource.tools.console_cli_login.description.length <= 300, `${locale}.login description exceeds 300 characters`);
  }
});

test('display name is consistent across the manifest and locales', () => {
  for (const locale of ['en', 'zh-CN', 'ja', 'ko']) {
    const resource = JSON.parse(readFileSync(path.join(pluginRoot, 'locales', `${locale}.json`), 'utf8'));
    assert.equal(resource.name, 'TapTap Console', locale);
  }
  assert.match(settings, /<span class="name">TapTap Console<\/span>/);
});

test('settings provides a manual missing-CLI install guide', () => {
  assert.match(settings, /id="install-guide"[^>]*hidden/);
  assert.match(settings, /id="copy-install-command"/);
  assert.match(settings, /id="open-install-url"/);
  assert.match(settings, /id="retry-install"/);
  assert.match(settingsScript, /isMissingCliError/);
  assert.match(settingsScript, /isUnsupportedPlatformError/);
  assert.match(settingsScript, /isMissingCliError\(error\) && !isUnsupportedPlatformError\(error\)/);
  assert.match(settingsScript, /setInstallGuideVisible\(true\)/);
  assert.match(settingsScript, /setInstallGuideVisible\(false\)/);
  assert.match(settingsScript, /document\.execCommand\('copy'\)/);
  assert.match(settingsScript, /navigator\.clipboard/);
  assert.match(settingsScript, /当前客户端不支持复制，请手动复制安装命令/);
  assert.ok(
    settingsScript.indexOf("document.execCommand('copy')") < settingsScript.indexOf('navigator.clipboard'),
    'the synchronous copy fallback should be attempted before Clipboard API',
  );
  assert.match(settingsScript, /var statusSequence = 0/);
  assert.match(settingsScript, /requestSequence !== statusSequence/);
  assert.match(settingsScript, /STATUS_REQUEST_TIMEOUT_MS = 8000/);
  assert.doesNotMatch(settingsScript, /STATUS_UI_NOTICE_MS|后台进行/);
  assert.match(settingsScript, /AUTO_STATUS_DELAY_MS = 3000/);
  assert.doesNotMatch(settingsScript, /插件正在启动/);
  assert.match(settingsScript, /clearTimeout\(autoStatusTimer\)/);
  assert.match(settingsScript, /async function login\(\) \{[\s\S]*clearTimeout\(autoStatusTimer\)/);
  assert.match(settingsScript, /statusSequence \+= 1/);
  assert.match(settingsScript, /setTimeout\(function \(\) \{[\s\S]*void checkStatus\(\);[\s\S]*\}, AUTO_STATUS_DELAY_MS\)/);
  assert.match(settingsScript, /setInterval\(send, 400\)/);
  assert.match(settingsScript, /BroadcastChannel 的首条消息会丢失/);
  assert.doesNotMatch(settings, /install-dialog|dialog-backdrop|target="_blank"/);
  assert.doesNotMatch(settingsScript, /setInstallDialogVisible|dialog-copy-install-command|close-install-dialog/);
  assert.match(settingsScript, /https:\/\/console\.tapsvc\.com\/cli\/console-cli\/install\.sh/);
  assert.doesNotMatch(settingsScript, /child_process|execFile|spawn\s*\(/);
  assert.match(source, /console\/status', \{\}, \{ timeoutMs: 8000 \}/);
  assert.match(worker, /STATUS_COMMAND_TIMEOUT_MS = 3_000/);
  assert.match(worker, /runCli\(\['auth', 'status'\], \{ timeoutMs: STATUS_COMMAND_TIMEOUT_MS \}/);
  assert.match(worker, /authData\.account/);
  assert.match(worker, /无法连接 Console 服务/);
});

test('browser entry never calls Console network APIs or handles credentials', () => {
  assert.doesNotMatch(source, /cindy\.fetch|fetch\s*\(/);
  assert.doesNotMatch(source, /Authorization|Bearer|secretBindings|network\.connections/);
  assert.match(source, /cindy\.node\.request/);
  assert.doesNotMatch(worker, /exec\s*\(|execSync|spawnSync|shell\s*:\s*true/);
});

test('worker preserves CLI command semantics while protecting agent boundaries', async () => {
  const { commandParts, failureMessage, installMessage, normalizeLoginArgs, normalizeRunArgs, redactDiagnostic } = await import(path.join(pluginRoot, 'src/worker.cjs'));
  assert.deepEqual(commandParts('deployment.logs', true), ['deployment', 'logs']);
  assert.throws(() => commandParts('Deployment.logs', true), /小写点分/);
  assert.deepEqual(
    normalizeRunArgs({ argv: ['deploy', 'set-image', '--deployment=my-app', '--cluster=tap-prod-sh-a', '--tag=v1.2.3'] }),
    ['deploy', 'set-image', '--deployment=my-app', '--cluster=tap-prod-sh-a', '--tag=v1.2.3'],
  );
  assert.throws(() => normalizeRunArgs({ argv: ['--token=secret'] }), /不允许传 --token/);
  assert.throws(() => normalizeRunArgs({ argv: ['--context=dev'] }), /--context/);
  assert.throws(() => normalizeRunArgs({ argv: ['app', 'list', '--server-endpoint=https://example.test'] }), /不允许传/);
  assert.throws(() => normalizeRunArgs({ argv: [] }), /argv 必须是/);
  assert.deepEqual(normalizeLoginArgs({ permission_level: 'readonly' }), { permission_level: 'readonly' });
  assert.throws(() => normalizeLoginArgs({ permission_level: 'sensitive', permission_profile: 'ops' }), /不能同时/);
  assert.throws(() => normalizeLoginArgs({ permission_level: 'admin' }), /必须是 readonly/);
  assert.match(installMessage('darwin'), /curl -fsSL https:\/\/console\.tapsvc\.com\/cli\/console-cli\/install\.sh \| sh/);
  assert.match(installMessage('win32'), /Windows.*console-cli.*PATH/);
  assert.doesNotMatch(installMessage('win32'), /curl -fsSL/);
  assert.doesNotMatch(redactDiagnostic('{"access_token":"secret","refresh_token":"refresh"}'), /secret|refresh"/);
  assert.match(
    failureMessage({ kind: 'output_limit', diagnostic: '' }, 'Console CLI 执行失败', 'unknown'),
    /核对 Console 远端状态/,
  );
  assert.doesNotMatch(
    failureMessage({ kind: 'output_limit', diagnostic: '' }, 'Console CLI 执行失败', 'unknown'),
    /缩小查询范围后重试/,
  );
  assert.match(
    failureMessage({ kind: 'exit', diagnostic: 'unexpected failure' }, 'Console CLI 执行失败', 'unknown'),
    /执行结果无法确认[\s\S]*不要盲目重试/,
  );
});

async function makeFakeCli(t, mode = 'normal') {
  const home = await mkdtemp(path.join(os.tmpdir(), 'console-cli-plugin-'));
  const bin = path.join(home, '.local', 'bin');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin, { recursive: true }));
  const cliPath = path.join(bin, 'console-cli');
  const script = `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === 'version') {
  process.stdout.write(JSON.stringify({ version: 'v-test', os: 'test', arch: 'arm64' }));
  } else if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write(${mode === 'logged-out' ? JSON.stringify('not logged in') : JSON.stringify(JSON.stringify(mode === 'account-only' ? { account: 'agent-001' } : { email: 'agent@example.test', authorization_mode: 'grant', permission_level: 'readonly' }))});
} else if (args[0] === 'auth' && args[1] === 'login') {
  process.stdout.write('logged in');
} else if (args[0] === 'skill' && args[1] === 'show') {
  process.stdout.write('overview skill');
} else if (args[0] === 'skill' && args[1] === 'list') {
  process.stdout.write(JSON.stringify([{ name: 'overview', source: 'builtin' }]));
} else if (args[0] === 'schema') {
  const name = args[1];
  const method = name === 'deployment.restart' || name === 'deployment.fail' || name === 'deployment.denied' ? 'POST' : 'GET';
  process.stdout.write(JSON.stringify({ commandPath: name.split('.'), httpMethod: method, path: '/api/v1/test' }));
} else if (args.includes('--help')) {
  process.stdout.write('help text');
} else if (args[0] === 'network-fail') {
  process.stderr.write('network timeout');
  process.exitCode = 1;
} else if (args[0] === 'invalid') {
  process.stderr.write('unknown command');
  process.exitCode = 1;
} else if (
  args[0] === 'app' && args[1] === 'list' ||
  args[0] === 'deploy' && args[1] === 'set-image' ||
  args[0] === 'auth' && args[1] === 'my-permissions'
) {
  process.stdout.write(JSON.stringify({ args }));
} else {
  process.stderr.write('unknown command');
  process.exitCode = 1;
}
`;
  await writeFile(cliPath, script, 'utf8');
  await chmod(cliPath, 0o755);
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

function runWorker(home, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, 'src/worker.cjs')], {
      env: { HOME: home, PATH: `${home}/.local/bin:/bin:/usr/bin` },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', () => {
      try {
        const line = stdout.trim().split(/\r?\n/).at(-1);
        resolve({ response: JSON.parse(line), stderr });
      } catch (error) {
        reject(new Error(`worker output invalid: ${error.message}; stderr=${stderr}`));
      }
    });
    child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, ...request })}\n`);
  });
}

test('worker proxies CLI discovery, schema, and direct CLI argv', async (t) => {
  const home = await makeFakeCli(t);
  const status = await runWorker(home, { method: 'console/status', params: {} });
  assert.equal(status.response.result.ok, true);
  assert.equal(status.response.result.result.logged_in, true);
  assert.equal(status.response.result.result.email, 'agent@example.test');

  const accountOnlyHome = await makeFakeCli(t, 'account-only');
  const accountOnly = await runWorker(accountOnlyHome, { method: 'console/status', params: {} });
  assert.equal(accountOnly.response.result.result.logged_in, true);

  const overview = await runWorker(home, { method: 'console/discover', params: { mode: 'overview' } });
  assert.equal(overview.response.result.result.content, 'overview skill');
  const schema = await runWorker(home, { method: 'console/schema', params: { command: 'app.list' } });
  assert.equal(schema.response.result.result.httpMethod, 'GET');
  const help = await runWorker(home, { method: 'console/help', params: { command: 'app.list' } });
  assert.equal(help.response.result.result.content, 'help text');

  const deploy = await runWorker(home, {
    method: 'console/run',
    params: { argv: ['deploy', 'set-image', '--deployment=my-app', '--cluster=tap-prod-sh-a', '--tag=v1.2.3'] },
  });
  assert.equal(deploy.response.result.ok, true);
  assert.equal(deploy.response.result.result.execution, 'executed');
  assert.deepEqual(deploy.response.result.result.data.args, ['deploy', 'set-image', '--deployment=my-app', '--cluster=tap-prod-sh-a', '--tag=v1.2.3']);

  const permissions = await runWorker(home, { method: 'console/run', params: { argv: ['auth', 'my-permissions'] } });
  assert.equal(permissions.response.result.ok, true);
  assert.deepEqual(permissions.response.result.result.data.args, ['auth', 'my-permissions']);

  const unknown = await runWorker(home, { method: 'console/run', params: { argv: ['network-fail'] } });
  assert.equal(unknown.response.result.execution, 'unknown');
  const invalid = await runWorker(home, { method: 'console/run', params: { argv: ['invalid'] } });
  assert.equal(invalid.response.result.execution, 'not_executed');
  const forbidden = await runWorker(home, { method: 'console/run', params: { argv: ['--token=secret'] } });
  assert.equal(forbidden.response.result.execution, 'not_executed');
});

test('worker returns actionable missing-install and login results', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'console-cli-plugin-missing-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const missing = await runWorker(home, { method: 'console/status', params: {} });
  assert.equal(missing.response.result.ok, false);
  assert.match(missing.response.result.message, /curl -fsSL https:\/\/console\.tapsvc\.com\/cli\/console-cli\/install\.sh \| sh/);
  assert.match(missing.response.result.message, /安装完成后告诉我，我会重新检查/);
  assert.match(missing.response.result.message, /https:\/\/console\.tapsvc\.com\/cli\/console-cli\/install\.sh/);

  const loggedOutHome = await makeFakeCli(t, 'logged-out');
  const login = await runWorker(loggedOutHome, { method: 'console/login', params: { permission_level: 'readonly' } });
  assert.equal(login.response.result.ok, false);
  assert.equal(login.response.result.execution, 'unknown');
  assert.match(login.response.result.message, /仍未登录|无法确认/);
});

test('main bridges tool calls to the Node worker methods', async () => {
  let hostHandler;
  const requests = [];
  const messages = [];
  const cindy = {
    onHostMessage(handler) { hostHandler = handler; },
    async send(message) { messages.push(message); },
    async nodeRequest() {},
    node: { async request(request) {
      requests.push(request);
      return { ok: true, result: { ok: true, result: { installed: true, logged_in: false } } };
    } },
  };
  const context = createContext({ cindy, BroadcastChannel: undefined, setTimeout });
  new Script(source, { filename: 'console-cli/main.js' }).runInContext(context);
  await hostHandler({ type: 'tool-call', tool: 'console_cli_status', args: {}, callId: 'status' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests[0].method, 'console/status');
  assert.equal(messages.at(-1).ok, true);
  await hostHandler({ type: 'tool-call', tool: 'console_cli_run', args: { argv: ['deploy', 'set-image'] }, callId: 'run' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests[1].method, 'console/run');
  assert.equal(messages.at(-1).callId, 'run');
});

test('main preserves unknown execution when the Node request rejects', async () => {
  let hostHandler;
  const messages = [];
  const cindy = {
    onHostMessage(handler) { hostHandler = handler; },
    async send(message) { messages.push(message); },
    node: { async request() { throw new Error('worker unavailable'); } },
  };
  const context = createContext({ cindy, BroadcastChannel: undefined, setTimeout });
  new Script(source, { filename: 'console-cli/main.js' }).runInContext(context);
  await hostHandler({ type: 'tool-call', tool: 'console_cli_run', args: { argv: ['deploy', 'set-image'] }, callId: 'run-error' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.at(-1).execution, 'unknown');
  assert.equal(messages.at(-1).callId, 'run-error');
});
