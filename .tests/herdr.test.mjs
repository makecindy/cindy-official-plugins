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
import { promises as fsPromises } from 'node:fs';
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
    /function writeKv\(patch\)[\s\S]*?response\.ok === false[\s\S]*?throw new Error/,
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

  // 宿主回执：外层 isError 与正文 ok:false 是明确失败；解析不了是结果未知。
  assert.match(
    mainSource,
    /function hostBody[\s\S]*?parsed && body && body\.ok === false[\s\S]*?explicit: true/,
    'an explicit rejection must be recognised'
  );
  assert.match(
    mainSource,
    /function hostBody[\s\S]*?return \{ ok: false, parsed: parsed, body: body, detail: detail, explicit: false \}/,
    'an unparseable receipt must not be treated as an explicit rejection'
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

  // 创建成功但 KV 没落盘：要带 id 报「已创建、需对账」，不能让人重试重复创建。
  assert.match(mainSource, /自动化已创建（id=/,
    'a create that could not be persisted must report the created id');
  assert.match(mainSource, /cachedScheduleId = scheduleId;\s*\n\s*const saved = await writeKv/,
    'the cache must be updated before the KV write so events still find the schedule');

  // Node 传输层断开时，写路径要报「结果未知」。
  assert.match(mainSource, /function isPotentiallyMutating[\s\S]*?tmux\/send/,
    'tmux sends must be treated as mutating');
  assert.match(mainSource, /与插件工作进程的连接中断，请求可能已执行/,
    'a transport rejection on a write must be outcome-unknown');

  // tmux 写操作超时 = 结果未知（读命令仍是普通超时）。
  const workerSource2 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSource2, /function tmuxOutcomeUnknown[\s\S]*?HERDR_OUTCOME_UNKNOWN/,
    'tmux write timeouts must be outcome-unknown');
  assert.match(workerSource2, /await tmuxWrite\(\['send-keys'/,
    'both tmux send paths must go through tmuxWrite');

  // 指定 pane_id 时，没有 pane_id 的全局事件不能完成等待。
  assert.match(workerSource2, /if \(!data \|\| data\.pane_id !== waiter\.pane_id\) return false;/,
    'events without a pane id must not satisfy a pane-scoped waiter');

  // 面板用自己四语言的 tmux 缺失文案。
  const panelSource2 = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSource2, /notInstalled \? T\.tmuxMissing : T\.tmuxBroken/,
    'the panel must tell a missing tmux apart from a broken one');
  assert.match(panelSource2, /tmux\.reason === 'not-installed'/,
    'the branch must key off the worker reason, not just available:false');
  assert.doesNotMatch(panelSource2, /tmux\.hint \|\|/,
    'the panel must not prefer the tool hint over its localized text');

  // KV 失败（读或写）在拿到 id 之后也要带 id 报结果未知。
  assert.match(mainSource, /async function persistScheduleId[\s\S]*?自动化已创建（id=/,
    'a KV failure after a create must carry the created id');

  // 写回执解析不了 = 结果未知；明确 ok:false / isError 才是业务失败。
  assert.match(mainSource, /if \(outcome\.explicit\)[\s\S]*?hostWriteFailure\(outcome\)/,
    'an unparseable write receipt must be outcome-unknown');

  // 整段查找+创建要互斥，避免并行 setup 各建一条。
  assert.match(mainSource, /return withSetupLock\(function \(\) \{ return ensureAutomationScheduleUnlocked/,
    'the find-and-create flow must be serialized');

  // 面板刷新按钮不能把 MouseEvent 当 force。
  const panelSource3 = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSource3, /'#refresh'\)\.addEventListener\('click', function \(\) \{ refresh\(\); \}\)/,
    'the refresh click handler must not pass the event as force');

  // 所有 KV 补丁要排队，避免并发互相覆盖。
  assert.match(mainSource, /let kvWriteLock = Promise\.resolve\(\);[\s\S]*?kvWriteLock\.then\(async function \(\) \{[\s\S]*?await readKv\(\)/,
    'KV read-modify-writes must be serialized');

  // 订阅握手要给宿主超时留余量（worker 两段各 15 秒）。
  assert.match(mainSource, /nodeRequest\('herdr\/subscribe', \{\}, callId, SUBSCRIBE_HOST_TIMEOUT_MS\)/,
    'the subscribe call must carry a host timeout above the handshake budget');

  // tmux 行数封顶要如实标记。
  const workerSource3 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSource3, /truncated: truncated \|\| requested > want/,
    'a clamped line count must be reported as truncated');
  assert.match(workerSource3, /max_lines: 5000/,
    'the response must expose the line cap');

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


test('a lost schedule_create receipt is reported as outcome-unknown', async () => {
  const mainSource = readFileSync(path.join(root, 'herdr', 'main.js'), 'utf8');
  const kv = { herdrScheduleId: 'S1', herdrSubscribed: true };

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
        call: (tool, name) => {
          if (name === 'schedule_get') {
            // 记录里的自动化已经被用户删了：NOT_FOUND，允许重建。
            return Promise.resolve({
              isError: true,
              content: [{ type: 'text', text: JSON.stringify({ ok: false, errorCode: 'NOT_FOUND' }) }]
            });
          }
          if (name === 'schedule_create') return Promise.reject(new Error('transport lost'));
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

  await assert.rejects(
    () => sandbox.ensureAutomationSchedule('Herdr 事件处理', {}),
    (error) => {
      // 不能是普通 HERDR_REQUEST_FAILED：必须让调用方先核对再重试。
      assert.match(String(error.message), /^HERDR_OUTCOME_UNKNOWN/,
        `expected outcome-unknown, got: ${error.message}`);
      assert.match(String(error.message), /核对/,
        'the message must tell the caller to reconcile first');
      return true;
    },
    'a lost create receipt must be outcome-unknown, not a plain failure'
  );
});

test('a subscription handover delivers each event exactly once', async () => {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'herdr-handover-'));
  const socketPath = path.join(dir, 'herdr.sock');
  const conns = [];

  const server = net.createServer((conn) => {
    let buffer = '';
    conn.on('data', (chunk) => {
      buffer += String(chunk);
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        const request = JSON.parse(line);
        if (request.method === 'events.subscribe') {
          conns.push(conn);
          conn.write(JSON.stringify({ id: request.id, result: { ok: true } }) + '\n');
        } else if (request.method === 'pane.list') {
          conn.write(JSON.stringify({ id: request.id, result: { panes: [{ pane_id: 'w1:p1' }] } }) + '\n');
        } else {
          conn.write(JSON.stringify({ id: request.id, result: {} }) + '\n');
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));

  const worker = spawn(process.execPath, [path.join(root, 'herdr', 'node', 'worker.cjs')], {
    env: { ...process.env, HERDR_SOCKET_PATH: socketPath },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const notifications = [];
  let stdout = '';
  worker.stdout.on('data', (chunk) => {
    stdout += String(chunk);
    let index;
    while ((index = stdout.indexOf('\n')) >= 0) {
      const line = stdout.slice(0, index);
      stdout = stdout.slice(index + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.method === 'herdr/event') notifications.push(message);
      } catch (error) { void error; }
    }
  });

  const call = (method, params) => new Promise((resolve, reject) => {
    const id = 'h' + method + Date.now();
    const timer = setTimeout(() => reject(new Error('timeout ' + method)), 8000);
    const onData = (chunk) => {
      const text = String(chunk);
      if (!text.includes(id)) return;
      worker.stdout.off('data', onData);
      clearTimeout(timer);
      resolve();
    };
    worker.stdout.on('data', onData);
    worker.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
  });

  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('timed out waiting for ' + label);
  };

  try {
    await call('herdr/subscribe', {});
    await waitFor(() => conns.length === 1, 'first subscription');
    await call('herdr/subscribe', {});
    await waitFor(() => conns.length === 2, 'second subscription');

    // 同一个事件同时从新旧两条连接推过来：交接期间只应转发一次。
    const payload = JSON.stringify({
      event: 'pane_agent_status_changed',
      data: { pane_id: 'w1:p1', agent_status: 'blocked' }
    }) + '\n';
    conns[0].write(payload);
    conns[1].write(payload);

    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(notifications.length, 1,
      `expected one event delivery, got ${notifications.length}`);
  } finally {
    worker.kill();
    await new Promise((resolve) => server.close(resolve));
    for (const conn of conns) { try { conn.destroy(); } catch (error) { void error; } }
    await fsPromises.rm(dir, { recursive: true, force: true });
  }
});


test('tmux key names are validated against the keys tmux recognises', async () => {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'herdr-keys-'));
  const worker = spawn(process.execPath, [path.join(root, 'herdr', 'node', 'worker.cjs')], {
    env: { ...process.env, HERDR_SOCKET_PATH: path.join(dir, 'missing.sock') },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const call = (method, params) => new Promise((resolve) => {
    const id = 'k' + Date.now();
    const timer = setTimeout(() => resolve({ timeout: true }), 5000);
    const onData = (chunk) => {
      const text = String(chunk);
      if (!text.includes(id)) return;
      worker.stdout.off('data', onData);
      clearTimeout(timer);
      try { resolve(JSON.parse(text.split('\n').find((line) => line.includes(id)))); }
      catch (error) { resolve({ parseError: String(error) }); }
    };
    worker.stdout.on('data', onData);
    worker.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  try {
    // 拼错的键名必须被拒绝：tmux 会把它当字面文本发出去。
    const typo = await call('tmux/send', { target: 'x:0.0', keys: ['Entter'] });
    assert.ok(typo.error, `expected an error for a misspelled key, got ${JSON.stringify(typo)}`);
    assert.match(typo.error.message, /TMUX_BAD_KEY|不支持的按键/,
      `expected a key rejection, got ${typo.error.message}`);

    // 修饰键 + 单字符、以及 tmux 的具名键要放行（校验先于任何 tmux 调用）。
    for (const key of ['C-c', 'M-x', 'S-Tab', 'Enter', 'F12', 'a']) {
      const result = await call('tmux/send', { target: 'x:0.0', keys: [key] });
      assert.ok(!result.error || !/TMUX_BAD_KEY/.test(result.error.message || ''),
        `expected ${key} to be accepted, got ${JSON.stringify(result)}`);
    }
  } finally {
    worker.kill();
    await fsPromises.rm(dir, { recursive: true, force: true });
  }
});
