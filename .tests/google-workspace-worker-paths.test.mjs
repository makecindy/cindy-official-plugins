import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../google-drive/node/gog.cjs', import.meta.url), 'utf8');

test('JSON @file 参数使用相同工作区边界，不能绕过路径或符号链接校验', () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'google-worker-paths-')));
  const workspace = path.join(directory, 'workspace');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'values.json'), '[["example"]]');
  fs.writeFileSync(path.join(directory, 'outside.json'), '[["private"]]');
  const ctx = createContext({
    __dirname: workspace,
    require,
  });
  // Load the production validation functions without starting its stdio loop.
  runInContext(source.split('const input = readline.createInterface')[0], ctx);
  try {
    for (const flag of ['values-json', 'data-json', 'spec-json', 'cells-json', 'format-json', 'gradient-rule-json', 'columns-json']) {
      assert.equal(ctx.optionValue(flag, ' @ values.json ', workspace), '@' + path.join(workspace, 'values.json'));
      assert.equal(ctx.optionValue(flag, '[["literal"]]', workspace), '[["literal"]]');
      assert.throws(() => ctx.optionValue(flag, '@../outside.json', workspace), /inside the current workspace/);
      assert.throws(() => ctx.optionValue(flag, '@' + path.join(directory, 'outside.json'), workspace), /inside the current workspace/);
      assert.throws(() => ctx.optionValue(flag, '@values.json', undefined), /explicit local workspace/);
      assert.throws(() => ctx.optionValue(flag, '@-', workspace), /explicit local workspace/);
    }
    if (process.platform !== 'win32') {
      fs.symlinkSync(path.join(directory, 'outside.json'), path.join(workspace, 'link.json'));
      assert.throws(() => ctx.optionValue('values-json', '@link.json', workspace), /escapes the current workspace/);
    }
    assert.equal(ctx.optionValue('body', '@ordinary text', workspace), '@ordinary text');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('三个插件共用同一 Worker 边界，仅切换 gog 服务名', () => {
  for (const service of ['drive', 'calendar', 'sheets']) {
    const bundled = fs.readFileSync(new URL(`../google-${service}/node/gog.cjs`, import.meta.url), 'utf8');
    assert.equal(bundled, source.replace("const SERVICE = 'drive';", `const SERVICE = '${service}';`));
  }
});

function workerFixture(service) {
  const worker = fs.readFileSync(new URL(`../google-${service}/node/gog.cjs`, import.meta.url), 'utf8');
  const calls = [];
  const ctx = createContext({ __dirname: '/fixture', require });
  runInContext(worker.split('const input = readline.createInterface')[0], ctx);
  const leaf = (name, flags = []) => ({ name, subcommands: [], flags: flags.map(([flag, type = 'string']) => ({ name: flag, type })) });
  const commands = {
    calendar: [leaf('events'), leaf('create', [['summary']])],
    drive: [leaf('list'), leaf('upload'), leaf('download', [['out']])],
    sheets: [leaf('get'), leaf('update', [['values-json']]), leaf('export', [['out']])],
  };
  ctx.schema = async () => ({ name: service, flags: [], subcommands: commands[service] });
  ctx.execute = async (...args) => { calls.push(args); return { ok: true, execution: 'executed', data: {} }; };
  const run = (params, token = 'request-token') => ctx.handle({ method: 'run', params, cindy: { secrets: { gog_access_token: token } } }, {});
  return { ctx, calls, run };
}

test('三个新执行入口都传递请求级 token、会话只读约束并拒绝危险覆盖', async () => {
  for (const [service, readCommand, writeCommand] of [
    ['calendar', 'events', 'create'],
    ['drive', 'list', 'list'],
    ['sheets', 'get', 'update'],
  ]) {
    const { calls, run } = workerFixture(service);
    assert.equal((await run({ command: [readCommand] }, '')).execution, 'not_executed');
    assert.equal((await run({ command: [readCommand], options: { account: 'other' } })).execution, 'not_executed');
    assert.equal((await run({ command: [readCommand], arguments: ['--token=other'] })).execution, 'not_executed');
    assert.equal(calls.length, 0);

    await run({ command: [readCommand] });
    assert.equal(calls[0][1], 'request-token');
    assert.ok(calls[0][0].includes('--force'));
    assert.ok(calls[0][0].includes('--readonly'));

    await run({ command: [writeCommand], readOnly: false });
    assert.equal(calls[1][0].includes('--readonly'), false);
  }
});

test('Drive 上传下载和 Sheets 导出只能访问显式可写工作区路径', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'google-worker-io-')));
  const workspace = path.join(directory, 'workspace');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'upload.txt'), 'content');
  try {
    const drive = workerFixture('drive');
    await drive.run({ command: ['upload'], arguments: ['upload.txt'], workdir: workspace, readOnly: false });
    assert.equal(drive.calls[0][0][2], path.join(workspace, 'upload.txt'));
    assert.equal((await drive.run({ command: ['download'], options: { out: 'download.bin' }, workdir: workspace, readOnly: true })).execution, 'not_executed');
    await drive.run({ command: ['download'], options: { out: 'download.bin' }, workdir: workspace, readOnly: false });
    assert.ok(drive.calls[1][0].includes('--out=' + path.join(workspace, 'download.bin')));
    await assert.rejects(drive.run({ command: ['upload'], arguments: ['../outside.txt'], workdir: workspace, readOnly: false }), /inside the current workspace/);

    const sheets = workerFixture('sheets');
    assert.equal((await sheets.run({ command: ['export'], options: { out: 'sheet.xlsx' }, workdir: workspace, readOnly: true })).execution, 'not_executed');
    await sheets.run({ command: ['export'], options: { out: 'sheet.xlsx' }, workdir: workspace, readOnly: false });
    assert.ok(sheets.calls[0][0].includes('--out=' + path.join(workspace, 'sheet.xlsx')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('gog 启动前、启动后和成功返回保持未执行、不确定、已执行三态', async () => {
  for (const mode of ['spawn-throw', 'nonzero', 'success']) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const ctx = createContext({
      __dirname: '/fixture', Buffer, process: { env: {} }, setTimeout, clearTimeout,
      require: name => name === 'node:fs' ? {
        ...fs, mkdtempSync: () => '/private/call-test', rmSync() {},
      } : name === 'node:child_process' ? { spawn() {
        if (mode === 'spawn-throw') throw new Error('spawn failed');
        queueMicrotask(() => {
          child.emit('spawn');
          child.stdout.write('{"ok":true}');
          child.stderr.write('failed');
          child.emit('close', mode === 'nonzero' ? 1 : 0);
        });
        return child;
      } } : require(name),
    });
    runInContext(source.split('const input = readline.createInterface')[0], ctx);
    ctx.initialize = () => ({ directory: '/private', binary: '/gog' });
    const result = await ctx.execute(['drive', 'list'], 'request-token');
    assert.equal(result.execution, mode === 'spawn-throw' ? 'not_executed' : mode === 'nonzero' ? 'unknown' : 'executed');
    assert.equal(result.ok, mode === 'success');
    assert.doesNotMatch(JSON.stringify(result), /request-token/);
  }
});
