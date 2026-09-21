import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../google-gmail/node/gog.cjs', import.meta.url), 'utf8');

function workerFixture() {
  const calls = [];
  const ctx = createContext({
    __dirname: '/fixture', process: { env: { PATH: '/bin', GOG_ACCESS_TOKEN: 'inherited', GOOGLE_APPLICATION_CREDENTIALS: '/private', NODE_OPTIONS: '--inspect', LD_PRELOAD: '/private' } },
    require: name => name === '../vendor/gog/binaries.json' ? {} : require(name),
  });
  runInContext(source.split('const input = readline.createInterface')[0], ctx);
  const leaf = (name, flags = []) => ({ name, subcommands: [], flags: flags.map(([name, type = 'string']) => ({ name, type })) });
  ctx.schema = async () => ({ name: 'gmail', flags: [], subcommands: [
    leaf('send', [['to'], ['attach'], ['body-file'], ['track', 'bool']]),
    leaf('attachment', [['out'], ['inline', 'bool']]),
    leaf('search', [['max', 'int']]),
  ] });
  ctx.execute = async (...args) => { calls.push(args); return { ok: true, execution: 'executed', data: {} }; };
  const run = (params, token = 'request-token') => ctx.handle({ method: 'run', params, cindy: { secrets: { gog_access_token: token } } }, {});
  return { ctx, calls, run };
}

test('only the request token is passed; inherited credentials and hook environment are absent', () => {
  const { ctx } = workerFixture();
  const env = ctx.environment('/isolated', 'selected-token');
  assert.equal(env.GOG_ACCESS_TOKEN, 'selected-token');
  assert.equal(env.HOME, '/isolated');
  assert.equal(env.GOG_HOME, '/isolated');
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'LD_PRELOAD', 'NODE_OPTIONS']) assert.equal(env[key], undefined);
  assert.equal(ctx.environment('/isolated').GOG_ACCESS_TOKEN, '');
});

test('schema hides global overrides and persistent/non-Gmail integrations', () => {
  const { ctx } = workerFixture();
  const clean = ctx.cleanSchema({ name: 'gmail', flags: [], subcommands: [
    { name: 'send', flags: [{ name: 'token' }, { name: 'track' }, { name: 'to' }] },
    { name: 'track' }, { name: 'settings', subcommands: [{ name: 'watch' }] },
  ] }, new Set(['token']));
  assert.deepEqual(JSON.parse(JSON.stringify(clean.subcommands[0].flags)), [{ name: 'to' }]);
  assert.equal(clean.subcommands.some(c => c.name === 'track'), false);
  assert.equal(clean.subcommands[1].subcommands.length, 0);
});

test('invalid options, account overrides and missing tokens never launch a business command', async () => {
  const { run, calls } = workerFixture();
  for (const params of [
    { command: [] }, { command: ['search'], options: { account: 'other' } },
    { command: ['search'], options: { home: '/other' } },
    { command: ['search'], options: { max: {} } },
    { command: ['search'], arguments: ['--token=other'] },
    { command: ['search'], arguments: ['bad\0input'] },
  ]) assert.equal((await run(params)).execution, 'not_executed');
  assert.equal((await run({ command: ['search'] }, '')).execution, 'not_executed');
  await assert.rejects(run({ command: ['auth', 'login'] }), /Command unavailable/);
  assert.equal(calls.length, 0);
});

test('readonly is forwarded to gog; attachment writes require explicit writable local paths', async () => {
  const { run, calls } = workerFixture();
  const readonly = await run({ command: ['attachment'], arguments: ['message', 'part'], options: { out: 'file' }, readOnly: true });
  assert.equal(readonly.execution, 'not_executed');
  assert.equal((await run({ command: ['attachment'], readOnly: false })).execution, 'not_executed');
  await run({ command: ['search'], arguments: ['in:inbox'] });
  assert.ok(calls[0][0].includes('--readonly'));
  await run({ command: ['search'], arguments: ['in:inbox'], readOnly: false });
  assert.equal(calls[1][0].includes('--readonly'), false);
  assert.equal(calls[1][1], 'request-token');
  assert.ok(calls[1][0].includes('--force'));
});

test('JSON @file 参数使用相同工作区边界，不能绕过路径或符号链接校验', () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'google-worker-paths-')));
  const workspace = path.join(directory, 'workspace');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'values.json'), '[["example"]]');
  fs.writeFileSync(path.join(directory, 'outside.json'), '[["private"]]');
  const ctx = createContext({
    __dirname: workspace,
    require: name => name === '../vendor/gog/binaries.json' ? {} : require(name),
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
