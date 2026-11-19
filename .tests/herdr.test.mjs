import test from 'node:test';
// CI 只运行 .tests/<plugin>.test.mjs，从这里把面板渲染测试一并引入。
import './herdr-panel.test.mjs';

import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import lib from '../herdr/panel-lib.js';

const { WIDE_CHAR, graphemes, isWideGrapheme, specialKey, dirName } = lib;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function key(overrides) {
  return Object.assign({ key: '', ctrlKey: false, metaKey: false }, overrides);
}

test('wide characters occupy two cells, and combined emoji stay one unit', () => {
  assert.equal(isWideGrapheme('中'), true);
  assert.equal(isWideGrapheme('한'), true);
  assert.equal(isWideGrapheme('！'), true);
  assert.equal(isWideGrapheme('a'), false);
  assert.equal(isWideGrapheme('-'), false);
  assert.equal(isWideGrapheme('│'), false); // 制表符是窄字符

  // ZWJ 组合 emoji 必须作为一个整体，否则一个符号会被拆成多个方块。
  const family = graphemes('👩‍💻');
  assert.equal(family.length, 1, `expected one grapheme, got ${JSON.stringify(family)}`);
  assert.equal(isWideGrapheme(family[0]), true);

  // 组合标点、代理对同样不拆。
  assert.equal(graphemes('é').length, 1);
  assert.equal(graphemes('𝟘').length, 1);
  assert.equal(graphemes('a中b').length, 3);
});

test('special keys are forwarded, editing keys stay in the draft', () => {
  // Ctrl 组合：任何单字符都可以，Ctrl+C 用来中断终端任务。
  assert.equal(specialKey('herdr', key({ key: 'c', ctrlKey: true })), 'ctrl+c');
  assert.equal(specialKey('tmux', key({ key: 'c', ctrlKey: true })), 'C-c');
  assert.equal(specialKey('tmux', key({ key: 'd', metaKey: true })), 'C-d');

  // 终端行为键转发，按键名按后端方言。
  assert.equal(specialKey('herdr', key({ key: 'ArrowUp' })), 'up');
  assert.equal(specialKey('tmux', key({ key: 'ArrowUp' })), 'Up');
  assert.equal(specialKey('tmux', key({ key: 'PageUp' })), 'PageUp');
  assert.equal(specialKey('herdr', key({ key: 'Tab' })), 'tab');
  assert.equal(specialKey('herdr', key({ key: 'Escape' })), 'esc');

  // 文本编辑键不转发，否则用户没法修改还没提交的命令。
  for (const name of ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'a', 'Enter']) {
    assert.equal(specialKey('herdr', key({ key: name })), null, name);
    assert.equal(specialKey('tmux', key({ key: name })), null, name);
  }
});

test('directory names keep only the last segment', () => {
  assert.equal(dirName('/home/michael/codes/cindy'), 'cindy');
  assert.equal(dirName('/home/michael/codes/cindy/'), 'cindy');
  assert.equal(dirName('~/'), '~');
  assert.equal(dirName(''), '');
  assert.equal(dirName(null), '');
});

test('the panel page loads the shared library before the panel script', () => {
  const html = readFileSync(path.join(root, 'herdr', 'panel.html'), 'utf8');
  const lib = html.indexOf('panel-lib.js');
  const panel = html.indexOf('panel.js"');
  assert.ok(lib > 0, 'panel.html must load panel-lib.js');
  assert.ok(panel > lib, 'panel-lib.js must load before panel.js');
  assert.match(html, /href="\/panel\.css"/, 'panel.html must load panel.css');
});

test('no wide-character fast path is needed for plain terminal text', () => {
  const plain = '$ gh pr checks 353 --repo makecindy/cindy-official-plugins\nok\n';
  assert.equal(WIDE_CHAR.test(plain), false);
  assert.equal(WIDE_CHAR.test('Herdr 控制台'), true);
});


test('the worker socket timer waits longer than the Herdr-side wait', async () => {
  // 复现 Codex 那条 P1：调用方把同一个 chunk 写进 Herdr 内层 timeout_ms 和
  // worker 外层计时。外层若不比内层多留余量，内层超时的那一刻会被抢成
  // 「结果未知」，续段等待收不到可继续的 timeout。
  // 这里让假 Herdr 在内层超时之后、余量之内回包：外层必须还活着并以成功收尾。
  const dir = await import('node:fs/promises').then((fs) => fs.mkdtemp(path.join(os.tmpdir(), 'herdr-timeout-')));
  const socketPath = path.join(dir, 'herdr.sock');
  const innerWaitMs = 100;
  const replyAfterMs = 450;

  const server = net.createServer((conn) => {
    let buffer = '';
    conn.on('data', (chunk) => {
      buffer += String(chunk);
      if (!buffer.includes('\n')) return;
      // 必须回同一个 id，worker 才会把它当成这次请求的结果。
      const request = JSON.parse(buffer.split('\n')[0]);
      setTimeout(() => {
        conn.end(JSON.stringify({ id: request.id, result: { ok: true } }) + '\n');
      }, replyAfterMs);
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));

  const worker = spawn(process.execPath, [path.join(root, 'herdr', 'node', 'worker.cjs')], {
    env: { ...process.env, HERDR_SOCKET_PATH: socketPath },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  try {
    const startedAt = Date.now();
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker did not answer in time')), 12000);
      worker.stdout.on('data', (chunk) => {
        const line = String(chunk).split('\n').find((entry) => entry.trim());
        if (!line) return;
        try {
          const message = JSON.parse(line);
          if (message.id === 'regression-1') {
            clearTimeout(timer);
            resolve(message);
          }
        } catch (error) { void error; }
      });
      worker.on('error', reject);
      worker.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 'regression-1',
        method: 'herdr/request',
        // 外层和内层都给 100ms，正是老代码的竞态形状。
        params: { method: 'session.snapshot', params: { timeout_ms: innerWaitMs }, timeout_ms: innerWaitMs }
      }) + '\n');
    });
    const elapsed = Date.now() - startedAt;
    assert.equal(response.error, undefined, `expected success, got ${JSON.stringify(response.error)}`);
    assert.deepEqual(response.result, { ok: true });
    assert.ok(elapsed >= innerWaitMs + 300, `worker answered too early: ${elapsed}ms`);
  } finally {
    worker.kill();
    await new Promise((resolve) => server.close(resolve));
    await import('node:fs/promises').then((fs) => fs.rm(dir, { recursive: true, force: true }));
  }
});


test('automation setup surfaces KV failures and never reuses a foreign session', () => {
  const mainSource = readFileSync(path.join(root, 'herdr', 'main.js'), 'utf8');

  // 写 KV 必须看响应：只看返回对象会把 HTTP 500 当成保存成功。
  assert.match(
    mainSource,
    /async function writeKv[\s\S]*?response\.ok === false[\s\S]*?throw new Error/,
    'writeKv must check the PUT response and throw on failure'
  );

  // 复用只允许本插件建的、manual、active，且 prompt 必须整串相等。
  assert.match(
    mainSource,
    /function isOurAutomation[\s\S]*?item\.manual !== true[\s\S]*?AUTOMATION_MARK[\s\S]*?item\.status !== 'active'[\s\S]*?prompt !== String\(args\.prompt\) \+ '\\n\\n' \+ AUTOMATION_MARK/,
    'reuse must verify ownership, manual-only trigger, active state and an exact prompt'
  );

  // 会话不一致要能走到 schedule_update 修复分支，而不是先被归属校验挡掉。
  assert.match(
    mainSource,
    /if \(wantSession && wantSession !== \(item\.targetSessionId \|\| null\)\)[\s\S]*?schedule_update/,
    'a session mismatch must reach the schedule_update repair path'
  );

  // 复用不再按名称搜索全部自动化：只认 KV 记录的那一条。
  assert.doesNotMatch(mainSource, /schedule_list/, 'reuse must not search schedules by name');
  assert.match(
    mainSource,
    /schedule_get[\s\S]*?isOurAutomation/,
    'reuse must fetch the stored schedule and verify it'
  );

  // 只有 text / keys 都没有时要拒绝，不能把终端里的草稿提交掉。
  assert.match(
    mainSource,
    /async herdr_send\([\s\S]*?runtime\.missingTextOrKeys/,
    'herdr_send must reject calls without text or keys'
  );
});
