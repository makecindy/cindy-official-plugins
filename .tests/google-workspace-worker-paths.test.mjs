import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../scripts/google-workspace/worker.cjs', import.meta.url), 'utf8');

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

test('四个插件的 Worker 都由当前源文件生成', () => {
  for (const service of ['gmail', 'drive', 'calendar', 'sheets']) {
    const bundled = fs.readFileSync(new URL(`../google-${service}/node/gog.cjs`, import.meta.url), 'utf8');
    assert.equal(bundled, source.replaceAll('__SERVICE__', service));
  }
});
