import test from 'node:test';
// CI 只运行 .tests/<plugin>.test.mjs，从这里把面板渲染测试一并引入。
import './herdr-panel.test.mjs';

import net from 'node:net';
import vm from 'node:vm';
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

  // 会话不一致要能走到改绑分支，而不是先被归属校验挡掉。
  assert.match(
    mainSource,
    /if \(wantSession && \(!hasSession \|\| item\.targetSessionId !== wantSession\)\)[\s\S]*?schedule_update/,
    'a session mismatch must reach the schedule_update repair path'
  );

  // 复用不再按名称搜索全部自动化：只认 KV 记录的那一条。
  // （错误提示里可以提到让用户去核对，但代码不能真的调 schedule_list 去挑。）
  assert.doesNotMatch(mainSource, /cindy\.host\.call\('cindy_scheduler', 'schedule_list'/,
    'reuse must not search schedules by name');
  assert.match(
    mainSource,
    /schedule_get[\s\S]*?isOurAutomation/,
    'reuse must fetch the stored schedule and verify it'
  );

  // KV 读取失败必须抛出来：当成空配置会丢掉唤醒、还会新建第二条自动化。
  assert.match(
    mainSource,
    /async function readKv[\s\S]*?throw new Error\(runtime\.kvReadFailed\)/,
    'readKv must fail loudly instead of returning an empty config'
  );

  // 宿主回执要同时看外层 isError 和正文：只有解析成功且 ok===true 才算成功。
  assert.match(
    mainSource,
    /function hostBody[\s\S]*?!parsed \|\| !body \|\| body\.ok !== true/,
    'host results must be checked at both levels'
  );

  // 普通调用也要带明确预算，让 worker 先于宿主到点、报出可核对的结果。
  assert.match(
    mainSource,
    /const request = \{ method: method, params: params \|\| \{\}, timeout_ms: budget \}/,
    'herdrCall must always send an explicit worker timeout'
  );

  // 保存/复用后必须同步缓存，否则存储读不了时会跑旧任务。
  const cacheWrites = (mainSource.match(/cachedScheduleId = /g) || []).length;
  assert.ok(cacheWrites >= 3, `cache must be updated on read, reuse and create (found ${cacheWrites})`);

  // 省略 targetSessionId = 承诺每次新开会话；宿主不支持 null 解绑，要走替换。
  assert.match(
    mainSource,
    /!wantSession && hasSession[\s\S]*?replaceUnboundSchedule/,
    'omitting the session must replace the bound schedule'
  );
  assert.match(
    mainSource,
    /function replaceUnboundSchedule[\s\S]*?schedule_delete/,
    'the old bound schedule must be removed after the new one is saved'
  );

  // 面板回车必须走 pane.send_input（带回车），不能是只打字的 pane.send_text。
  assert.match(
    mainSource,
    /if \(action === 'submit'\)[\s\S]*?pane\.send_input/,
    'the panel submit path must use pane.send_input'
  );

  // 面板快照的宿主要比 worker 的 30 秒更宽。
  assert.match(
    mainSource,
    /nodeRequest\('herdr\/snapshot', \{\}, undefined, 45000\)/,
    'panel snapshot needs a host budget above the worker wait'
  );

  // silentWhenIdle 是暴露给用户的参数，改了必须写进 scheduler。
  assert.match(
    mainSource,
    /silentWhenIdle !== undefined[\s\S]*?schedule_update/,
    'silentWhenIdle changes must be applied to the schedule'
  );

  // 延迟触发到点时要重新读当前 id，不能跑闭包里的旧 id。
  assert.match(
    mainSource,
    /triggerTimer = setTimeout[\s\S]*?readScheduleId\(\)/,
    'the deferred trigger must re-read the schedule id'
  );

  // 显式退订不能被 wake 撤销。
  assert.match(
    mainSource,
    /subscriptionPreference === false[\s\S]*?return;/,
    'ensureSubscription must honour an explicit unsubscribe'
  );
  assert.match(
    mainSource,
    /mode === 'unsubscribe'[\s\S]*?subscriptionPreference = false/,
    'unsubscribe must record the preference'
  );

  // 回包必须解析成功且 ok===true，否则按失败处理（不能拿未知结果去新建/删除）。
  assert.match(
    mainSource,
    /if \(!parsed \|\| !body \|\| body\.ok !== true\) return \{ ok: false/,
    'unparseable host payloads must be treated as failures'
  );

  // 新建自动化的 silentWhenIdle 要跟工具契约一致（默认静默）。
  assert.match(
    mainSource,
    /silentWhenIdle: args\.silentWhenIdle !== false/,
    'silentWhenIdle must default to true'
  );

  // setup 要把订阅偏好改回「订阅」，否则重启后按旧退订值停摆。
  assert.match(
    mainSource,
    /enableSubscription\(args\.__callId\)/,
    'setup must re-enable the subscription with the recorded preference'
  );

  // 原始调用的内层等待要封顶，三层预算才兜得住。
  assert.match(mainSource, /const RAW_WAIT_MAX_MS = 90000;/, 'raw waits must be capped');
  assert.match(mainSource, /clampRawWait\(/, 'herdr_call must clamp the inner wait');

  // 触发自动化要核对业务回执，失败要复位限流。
  assert.match(mainSource, /async function runAutomationNow[\s\S]*?hostBody\(called\)/,
    'schedule_run_now results must be checked');

  // worker 退订后不能被 wait 重新打开长连接。
  const worker = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(worker, /'herdr\/wait-event'[\s\S]*?!subscription\.desired[\s\S]*?HERDR_UNSUBSCRIBED/,
    'wait-event must respect an explicit unsubscribe');

  // 面板轮询不能在上一次刷新未完成时再开一次。
  const panel = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panel, /if \(refreshRunning && !force\) return;/,
    'a refresh must not start while another is running');

  // 提示词已发出、等待超时 → 必须是「结果未知」，不能报普通失败让 Agent 重发。
  assert.match(mainSource, /HERDR_OUTCOME_UNKNOWN: 提示词已发送/,
    'a timed-out prompt wait must be reported as outcome-unknown');

  // 操作执行完之后，回执送不出去不能报成操作失败。
  assert.match(mainSource, /操作已经执行完了[\s\S]*?void error;/,
    'a failed receipt must not turn an executed operation into a failure');

  // 所有调度器写操作（create/update/delete）回执丢失都要报「结果未知」。
  assert.match(mainSource, /function hostWrite[\s\S]*?HERDR_OUTCOME_UNKNOWN: 操作可能已经生效/,
    'a lost write receipt must be reported as outcome-unknown');
  const writeCalls = (mainSource.match(/hostWrite\(\s*cindy\.host\.call\('cindy_scheduler', 'schedule_(create|update|delete)'/g) || []);
  assert.ok(writeCalls.length >= 4,
    `every scheduler write must go through hostWrite (found ${writeCalls.length})`);

  // worker 重建订阅要先建后断（旧连接在新连接确认后才关）。
  const workerSource = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  const ackAt = workerSource.indexOf('subscription.running = true;');
  const oldCloseAt = workerSource.indexOf('previous.herdrIntentionalClose = true;', ackAt);
  assert.ok(ackAt > 0 && oldCloseAt > ackAt,
    'the old subscription must be closed only after the new one is acknowledged');

  // 只有 text / keys 都没有时要拒绝，不能把终端里的草稿提交掉。
  assert.match(
    mainSource,
    /async herdr_send\([\s\S]*?runtime\.missingTextOrKeys/,
    'herdr_send must reject calls without text or keys'
  );
});


test('changing only silentWhenIdle updates the existing schedule', async () => {
  const mainSource = readFileSync(path.join(root, 'herdr', 'main.js'), 'utf8');
  const kv = { herdrScheduleId: 'S1', herdrSubscribed: true };
  const calls = [];

  const owned = {
    id: 'S1',
    name: 'Herdr 事件处理',
    manual: true,
    status: 'active',
    prompt: '默认提示词\n\n[cindy-plugin:herdr]',
    silentWhenIdle: false,
    targetSessionId: null,
    agentKind: 'codex'
  };

  const reply = (data) => Promise.resolve({
    isError: false,
    content: [{ type: 'text', text: JSON.stringify({ ok: true, data: data }) }]
  });

  const sandbox = {
    console,
    BroadcastChannel: class {
      constructor() {}
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
    },
    fetch: (url, opts) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(opts && opts.method === 'PUT'
        ? Object.assign({}, kv, JSON.parse(opts.body))
        : Object.assign({}, kv))
    }),
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    Date, Math, JSON, Object, Array, String, Number, Boolean, Error, Promise, RegExp, Intl,
    cindy: {
      request: () => Promise.resolve({ context: { locale: 'zh-CN' } }),
      send: () => Promise.resolve(),
      onHostMessage: () => {},
      node: { request: () => Promise.resolve({ ok: true, result: { subscribed: true } }) },
      host: {
        call: (tool, name, args) => {
          calls.push({ tool: name, args: args });
          if (name === 'schedule_get') return reply(owned);
          if (name === 'schedule_update') return reply({ id: 'S1' });
          if (name === 'schedule_create') return reply({ id: 'NEW' });
          if (name === 'schedule_delete') return reply({ deleted: 'S1' });
          if (name === 'schedule_run_now') return reply({ runId: 'R1' });
          return reply(null);
        }
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(mainSource, sandbox, { filename: 'main.js' });

  const id = await sandbox.ensureAutomationSchedule('Herdr 事件处理', { silentWhenIdle: true });

  assert.equal(id, 'S1', 'must reuse the recorded schedule');
  const updates = calls.filter((entry) => entry.tool === 'schedule_update');
  assert.equal(updates.length, 1, `expected one schedule_update, got ${JSON.stringify(calls)}`);
  // 跨 realm 的对象不能用 deepStrictEqual（原型不同），逐字段比。
  assert.equal(updates[0].args.id, 'S1', 'the silent flag must target the recorded schedule');
  assert.equal(updates[0].args.silentWhenIdle, true, 'the silent flag must be written through');
  assert.equal(calls.filter((entry) => entry.tool === 'schedule_create').length, 0,
    'a silent-flag change must not create a second schedule');
});
