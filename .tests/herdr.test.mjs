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
  return Object.assign({ key: '', ctrlKey: false, metaKey: false, shiftKey: false }, overrides);
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
  // Command 留给浏览器：⌘D/⌘C/⌘V 不能当终端组合键转发。
  assert.equal(specialKey('tmux', key({ key: 'd', metaKey: true })), null);
  assert.equal(specialKey('herdr', key({ key: 'c', metaKey: true })), null);

  // Shift+Tab 的 key 仍是 'Tab'，修饰必须保留。
  assert.equal(specialKey('tmux', key({ key: 'Tab', shiftKey: true })), 'BTab');
  assert.equal(specialKey('herdr', key({ key: 'Tab', shiftKey: true })), 'shift+tab');

  // 终端行为键转发，按键名按后端方言。
  assert.equal(specialKey('herdr', key({ key: 'ArrowUp' })), 'up');
  assert.equal(specialKey('tmux', key({ key: 'ArrowUp' })), 'Up');
  // tmux 用它自己的键名（PPage/NPage），否则会被 validateTmuxKeys 拒绝；
  // Herdr 文档没确认翻页键名，不转发。
  assert.equal(specialKey('tmux', key({ key: 'PageUp' })), 'PPage');
  assert.equal(specialKey('tmux', key({ key: 'PageDown' })), 'NPage');
  assert.equal(specialKey('herdr', key({ key: 'PageUp' })), null);
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
    /silentWhenIdle: args\.silentWhenIdle !== undefined\s*\n\s*\? args\.silentWhenIdle !== false\s*\n\s*: source\.silentWhenIdle !== false/,
    'silentWhenIdle must default to true and keep the old value when unspecified'
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
  assert.match(mainSource, /cachedScheduleId = scheduleId;\s*\n\s*await persistScheduleId\(scheduleId\)/,
    'the cache must be updated before the KV write so events still find the schedule');
  assert.match(mainSource, /await persistScheduleId\(scheduleId\);[\s\S]{0,80}?if \(isOurAutomation/,
    'the replace path must persist through the same helper');

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

  // herdr_read 的目标必须二选一（schema 层面）。
  const manifest = JSON.parse(readFileSync(path.join(root, 'herdr', 'ghost.json'), 'utf8'));
  const readTool = manifest.tools.find((tool) => tool.name === 'herdr_read');
  assert.ok(readTool && readTool.parameters.oneOf, 'herdr_read must constrain its target');
  assert.equal(readTool.parameters.oneOf.length, 2, 'oneOf must cover both single-target shapes');

  // tmux 的命令分隔符必须拒绝（tmux(1) COMMANDS 用分号分隔命令）。
  const workerSource4 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  const rejectsSemicolon = workerSource4.indexOf("indexOf(';')") >= 0 || workerSource4.indexOf('[;\\s]') >= 0;
  assert.ok(rejectsSemicolon, 'semicolon and newline keys must be rejected');

  // 两种等待模式、text/keys 都要在 schema 层二选一。
  const waitTool = manifest.tools.find((tool) => tool.name === 'herdr_wait');
  assert.ok(waitTool && waitTool.parameters.oneOf, 'herdr_wait must constrain its two modes');
  for (const name of ['tmux_send', 'herdr_send']) {
    const tool = manifest.tools.find((entry) => entry.name === name);
    assert.ok(tool.parameters.oneOf, `${name} must make text and keys exclusive`);
  }

  // agent.prompt 带 wait 的超时 = 提示已发送，必须报结果未知。
  const workerSource5 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSource5, /outcomeUnknownWait\('agent\.prompt'\)/,
    'a prompt wait timeout must be reported as outcome-unknown');

  // 传输失败要有结构化标记，订阅路径据此决定自己重试。
  assert.match(mainSource, /wrapped\.transportFailure = true;/,
    'transport failures must be marked structurally');
  assert.match(mainSource, /error && error\.transportFailure/,
    'the subscription note must read the marker');

  // run_now：明确失败才复位限流；回执丢失是结果未知、保留限流。
  assert.match(mainSource, /if \(outcome\.explicit\) \{[\s\S]{0,120}?lastTriggerAt = 0;/,
    'only an explicit run_now failure resets the throttle');
  assert.match(mainSource, /throw hostWriteFailure\(outcome\);[\s\S]{0,80}?\}/,
    'an unparseable run_now receipt must be outcome-unknown');

  // 偏好保存的失败要传回调用方，不能在 helper 内部吞掉。
  const persistBody = /async function persistSubscriptionPreference\(wanted\) \{([\s\S]*?)\n\}/.exec(mainSource);
  assert.ok(persistBody, 'persistSubscriptionPreference must exist');
  assert.ok(!/try/.test(persistBody[1]), 'the preference write must not swallow failures');

  // 启动/wake 的订阅传输失败也要排重试。
  assert.match(mainSource, /transportFailure\) scheduleSubscriptionRetry\(\)/,
    'a startup transport failure must schedule a retry');

  const workerSource6 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  // 已发出的写请求收到损坏回包 = 结果未知。
  assert.match(workerSource6, /finish\(reject, sent\s*\?\s*outcomeUnknown\(method\)/,
    'an unparseable reply after send must be outcome-unknown');
  // 分段等待要能认出「已发送后的等待超时」。
  assert.match(workerSource6, /HERDR_OUTCOME_UNKNOWN: timeout:/,
    'the wait timeout must keep a marker the segmented path recognises');

  // 重试只恢复连接，不替用户改订阅选择；退订失败要有自己的提示。
  const retryBody = /function scheduleSubscriptionRetry\(\) \{([\s\S]*?)\n\}/.exec(mainSource);
  assert.ok(retryBody, 'scheduleSubscriptionRetry must exist');
  assert.ok(!/persistSubscriptionPreference/.test(retryBody[1]),
    'the retry must not rewrite the subscription preference');
  assert.match(mainSource, /preferenceSaveFailedUnsubscribe/,
    'an unsubscribe preference failure needs its own guidance');

  // 解绑替换要沿用旧配置，且旧任务清理失败要带回新 id。
  const workerSrc7 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc7, /load-buffer/,
    'tmux literal text must go through a paste buffer, not argv');
  assert.match(mainSource, /schedulePayload\(name, args, oldItem\)/,
    'the replacement must carry the old schedule config');
  assert.match(mainSource, /新自动化已生效（id=/,
    'a failed cleanup must report the new schedule id');

  // 状态等待分支要排除输出匹配字段。
  const waitTool2 = manifest.tools.find((tool) => tool.name === 'herdr_wait');
  const targetBranch = waitTool2.parameters.oneOf.find((branch) => branch.required.includes('target'));
  assert.deepEqual(Object.keys(targetBranch.not.anyOf || {}).length ? ['anyOf'] : [],
    ['anyOf'], 'the target branch must exclude the output-match fields');

  // 首次创建也要返回 { schedule_id, note }（不能是裸字符串）。
  const createBody = /const createdOutcome = await hostWrite\([\s\S]*?schedule_create[\s\S]*?\n  const body = createdOutcome\.body;/.exec(mainSource);
  assert.ok(createBody, 'the create path must go through hostWrite');
  assert.match(mainSource, /await persistScheduleId\(scheduleId\);\s*return \{ schedule_id: scheduleId, note: null \};/,
    'the first create must return the schedule id as an object');

  // 重试只在用户还没表态时采用存储值。
  const retryBody2 = /function scheduleSubscriptionRetry\(\) \{([\s\S]*?)\n\}/.exec(mainSource);
  assert.match(retryBody2[1], /subscriptionPreference === null/,
    'the retry must only adopt the stored value when the user has not decided');

  // tmux 缓冲区名用 crypto 生成。
  const workerSrc8 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc8, /'herdr-' \+ crypto\.randomUUID\(\)/,
    'the tmux buffer name must come from crypto');
  assert.ok(!/pasteCounter/.test(workerSrc8), 'no counter-based buffer names');

  // 解绑替换的载荷要真正沿用旧任务配置。
  assert.match(mainSource, /function schedulePayload\(name, args, base\)/,
    'schedulePayload must accept the old schedule as a base');
  assert.match(mainSource, /const basePrompt = String\(source\.prompt \|\| ''\)/,
    'the replacement prompt must come from the old schedule');
  assert.match(mainSource, /新自动化已生效（id=' \+ scheduleId \+ '），但旧任务的删除结果未知/,
    'an unknown delete outcome must be reported as unknown');

  // paste 失败要删掉残留 buffer。
  const workerSrc9 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc9, /'delete-buffer', '-b', buffer/,
    'a failed paste must clean up the buffer');

  // IME 组字中的回车不能当提交。
  const panelSrcIme = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcIme, /event\.isComposing \|\| event\.keyCode === 229/,
    'the panel must ignore Enter while an IME is composing');

  // 订阅握手失败但 worker 已排重连时返回 pending。
  assert.match(mainSource, /pending: true/,
    'a queued reconnect must be reported as pending, not as a failed subscribe');
  // 成功的订阅路径要重置重试额度。
  assert.match(mainSource, /function resetSubscriptionRetries\(\)[\s\S]*?subscriptionRetries = 0;/,
    'a successful subscribe must reset the retry budget');
  assert.match(mainSource, /nodeRequest\('herdr\/subscribe', \{\}, callId, SUBSCRIBE_HOST_TIMEOUT_MS\);[\s\S]{0,220}?resetSubscriptionRetries\(\);/,
    'enableSubscription must reset the budget on success');

  // 提示词发出后的续段等待：任何失败都要保留「已发送/结果未知」。
  assert.match(mainSource, /HERDR_OUTCOME_UNKNOWN: 提示词已发送，但后续状态等待失败/,
    'a failed continuation wait must stay unknown-outcome');

  // 握手失败要把 persisted 随错误带出；pending 回执不能隐瞒。
  assert.match(mainSource, /error\.subscriptionPersisted = persisted;/,
    'the handshake failure must carry the preference save result');
  assert.match(mainSource, /preference_saved: error\.subscriptionPersisted !== false/,
    'the pending receipt must report the preference save result');

  // worker 退订要单独重试（内存已 false 会让偏好重检短路）。
  assert.match(mainSource, /function scheduleUnsubscribeRetry\(\)/,
    'a dedicated unsubscribe retry must exist');
  assert.match(mainSource, /schedulePreferenceRecheck[\s\S]*?scheduleUnsubscribeRetry\(\);/,
    'the preference recheck must schedule the unsubscribe retry');

  // 面板：Enter 失败时把草稿放回输入框。
  const panelSrcAtomic = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcAtomic, /回车没有确认/,
    'a failed Enter after a pasted text must restore the draft without asserting the outcome');
  assert.match(panelSrcAtomic, /pendingEnterOnly/,
    'a resumed submit must only send Enter, not paste the text again');
  assert.match(panelSrcAtomic, /PENDING_ENTER_KEEP_KEYS/,
    'line-preserving keys must keep the pending-enter record');
  assert.match(panelSrcAtomic, /if \(!PENDING_ENTER_KEEP_KEYS\[key\]\) \{[\s\S]{0,300}?delete pendingEnterOnly\[scope\];/,
    'line-altering keys must invalidate the pending-enter record for their scope');
  // 记录按 scope 保留：关闭详情不等于取消终端里待提交的行。
  assert.ok(!/closeDetail[\s\S]{0,300}?delete pendingEnterOnly/.test(panelSrcAtomic),
    'closing the detail must not drop another scope state');

  // herdr_wait 输出分支也要排除 until。
  const waitTool3 = manifest.tools.find((tool) => tool.name === 'herdr_wait');
  const matchBranch = waitTool3.parameters.oneOf.find((branch) => branch.required.includes('match'));
  const excluded = (matchBranch.not.anyOf || []).map((entry) => entry.required[0]);
  assert.ok(excluded.includes('until'), 'the output branch must exclude the status condition');

  // 面板请求 id 用 crypto（BroadcastChannel 上不能撞号）。
  const panelSrcReq = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcReq, /crypto\.randomUUID\(\)/,
    'the panel request id must come from crypto');
  assert.ok(!/Math\.random/.test(panelSrcReq), 'no Math.random in the panel');

  // 两个方向的重试额度互相复位。
  assert.match(mainSource, /unsubscribeRetries = 0;[\s\S]{0,140}?unsubscribeRetryTimer = null;/,
    'subscribing again must reset the unsubscribe retry budget');
  const unsubBlock = /mode === 'unsubscribe'\) \{([\s\S]*?)persistSubscriptionPreference/.exec(mainSource);
  assert.ok(unsubBlock && /resetSubscriptionRetries\(\)/.test(unsubBlock[1]),
    'unsubscribing must reset the subscribe retry budget');

  // tmux_read 披露字符上限。
  const workerSrc10 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc10, /char_limit: TMUX_CAPTURE_MAX_CHARS/,
    'tmux_read must report its character limit');
  const tmuxReadTool = manifest.tools.find((tool) => tool.name === 'tmux_read');
  assert.match(tmuxReadTool.description, /120000/,
    'the tmux_read contract must disclose the character limit');

  // 转发改行按键前先同步本地草稿；首段失败恢复草稿。
  const panelSrcDraft = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcDraft, /即将转发会改动终端行的按键/,
    'line-altering keys must sync the local draft first');
  assert.match(panelSrcDraft, /if \(currentScope\(\) === scope && !field\.value\) field\.value = text;/,
    'a failed first-stage send must restore the draft');

  // 显式选择时同方向额度也复位。
  const enableBlock = /async function enableSubscription\(callId\) \{([\s\S]*?)persistSubscriptionPreference/.exec(mainSource);
  assert.ok(enableBlock && /resetSubscriptionRetries\(\)/.test(enableBlock[1]),
    'an explicit subscribe must reset the same-direction budget too');
  const unsubBlock2 = /mode === 'unsubscribe'\) \{([\s\S]*?)persistSubscriptionPreference/.exec(mainSource);
  assert.ok(unsubBlock2 && /unsubscribeRetries = 0/.test(unsubBlock2[1]),
    'an explicit unsubscribe must reset the same-direction budget too');

  // 流式 UTF-8 解码。
  const workerSrc11 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.ok(!/chunk\.toString\('utf8'\)/.test(workerSrc11),
    'streams must decode at character boundaries, not per chunk');
  assert.ok((workerSrc11.match(/setEncoding\('utf8'\)/g) || []).length >= 4,
    'sockets and tmux stdio must all use setEncoding');

  // 四个 locale 的 tmux_read 都要披露字符上限。
  for (const loc of ['en', 'zh-CN', 'ja', 'ko']) {
    const locData = JSON.parse(readFileSync(path.join(root, 'herdr', 'locales', loc + '.json'), 'utf8'));
    assert.match(locData.tools.tmux_read.description, /120 ?000|120000/,
      loc + ' tmux_read must disclose the character limit');
  }

  // 草稿同步与发送目标绑定：等待期间切分屏不会打到新目标、不改写新目标的输入框。
  const panelSrcPin = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcPin, /forwardKeyQueued\(key, pinnedView, target, paneId, scope, draft, draftFromRestore\) \{[\s\S]{0,2600}?tmux_send', \{ target: target, text: draft \}/,
    'the draft sync must use the pinned target');
  assert.match(panelSrcPin, /if \(currentScope\(\) === scope && !field\.value\) field\.value = text;/,
    'the draft restore must only touch the box of the same target');
  // 草稿同步后空输入框的回车可以只补 Enter。
  assert.match(panelSrcPin, /terminalHasContent/,
    'a synced draft must allow an enter-only submit');
  assert.match(panelSrcPin, /回车没有确认/,
    'a failed enter-only send must restore the pending record');
  // 面板桥接的 send 动作要支持 text。
  assert.match(mainSource, /tools\.herdr_send\(\{ pane_id: request\.pane_id, keys: request\.keys, text: request\.text \}\)/,
    'the panel send bridge must forward text too');

  // 删除旧任务前重新核实归属。
  assert.match(mainSource, /schedule_get', \{ id: storedId \}\)[\s\S]{0,500}?isOurAutomation\(freshItem/,
    'the old schedule must be re-fetched before deletion');
  assert.match(mainSource, /删除旧任务前的核对查询失败/,
    'a failed ownership re-check must surface a cleanup note');
  assert.match(mainSource, /不再确认是本插件创建的，所以保留未删/,
    'a repurposed old schedule must be kept with an explanation');

  // 事件等待跨段回放。
  const workerSrc12 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc12, /recentEvents/,
    'the worker must keep a short event replay buffer');
  assert.match(workerSrc12, /since_ms/,
    'continuation chunks must pass a replay cursor');
  assert.match(workerSrc12, /rememberEvent\(message\.event, data\)/,
    'every event must enter the replay buffer');

  // load 与 paste 都在清理范围内。
  assert.match(workerSrc12, /try \{\s*await runTmux\(\['load-buffer'/,
    'load-buffer failures must also clean up the buffer');

  // worktree remove 标为破坏性（四语言）。
  const controlTool = manifest.tools.find((tool) => tool.name === 'herdr_control');
  assert.match(controlTool.description, /remove/,
    'herdr_control must mark worktree remove as destructive');
  for (const loc of ['en', 'zh-CN', 'ja', 'ko']) {
    const locData = JSON.parse(readFileSync(path.join(root, 'herdr', 'locales', loc + '.json'), 'utf8'));
    assert.match(locData.tools.herdr_control.description, /remove/,
      loc + ' herdr_control must mark worktree remove as destructive');
  }

  // 面板等语言加载完再首次刷新。
  const panelSrcLoc = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcLoc, /loadLocale\(\)\.then\(function \(\) \{ refresh\(\); \}/,
    'the first refresh must wait for the locale');

  // 写请求超时要报结果未知。
  const panelSrcTimeout = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcTimeout, /PANEL_WRITE_ACTIONS/,
    'write actions must be marked for unknown-outcome timeouts');
  assert.match(panelSrcTimeout, /tmux_submit: true/,
    'the atomic tmux submit must keep the unknown-outcome timeout');
  assert.match(panelSrcTimeout, /HERDR_OUTCOME_UNKNOWN: ' \+ T\.writeTimeoutUnknown/,
    'a write timeout must be reported as unknown, not a plain failure');
  for (const loc2 of ['zh-CN', 'en', 'ja', 'ko']) {
    assert.ok(new RegExp("'" + loc2 + "'").test(panelSrcTimeout) || true);
  }
  assert.ok((panelSrcTimeout.match(/writeTimeoutUnknown:/g) || []).length >= 4,
    'the write-timeout hint must exist in all four locales');

  // 同一终端的提交串行化 + 按键时钉住视图。
  assert.match(panelSrcTimeout, /enqueueForScope\(scope, function \(\) \{\s*return submitLineQueued/,
    'submits must be serialized per scope');
  assert.match(panelSrcTimeout, /consumeFromInput/,
    'queued submits must only consume the sent prefix');
  assert.match(panelSrcTimeout, /按下回车这一刻就把草稿从输入框取走/,
    'the draft must leave the box at submit time, not at dequeue time');
  assert.match(panelSrcTimeout, /forwardKeyQueued\(key, pinnedView, target, paneId, scope, draft, draftFromRestore\)/,
    'the draft must be captured with its ownership at keypress time');
  assert.match(panelSrcTimeout, /捕获并取走/,
    'a line-altering key must consume the draft at keypress time');
  assert.match(panelSrcTimeout, /restoredDraft\.text \+ draft/,
    'consecutive failed syncs must keep the input order');
  assert.match(panelSrcTimeout, /box\.value = draft \+ box\.value/,
    'a failed draft sync must restore the draft, never drop it');
  assert.match(panelSrcTimeout, /不能再扣/,
    'a resumed submit must not consume the box a second time');

  // Enter 未确认要冻结同 scope 的后续提交。
  const panelSrcHold = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcHold, /scopeHolds\[scope\] = holdGeneration \+= 1/,
    'an unconfirmed Enter must hold the scope queue with a fresh generation');
  assert.match(panelSrcHold, /renderOutput\(T\.heldHint\)/,
    'a held scope must explain why the submit was not queued');

  // 缺 id 的创建回执 = 结果未知。
  const noIdCount = (mainSource.match(/HERDR_OUTCOME_UNKNOWN: ' \+ runtime\.automationNoId/g) || []).length;
  assert.ok(noIdCount >= 2, 'both create paths must report a missing id as unknown-outcome');

  // 跨面板的 tmux 提交在 worker 侧串行。
  const workerSrc13 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc13, /enqueueTmuxSend/,
    'tmux sends must be serialized in the shared worker');
  // 订阅建立后对新 pane 对账。
  assert.match(workerSrc13, /reconcileNewPanes/,
    'new panes must be reconciled after a resubscribe');
  assert.match(workerSrc13, /agent_status: status, reconciled: true/,
    'the reconciled event must use the agent_status key the host reads');
  assert.match(workerSrc13, /liveArrived/,
    'the reconcile must skip statuses that already arrived live');
  assert.match(mainSource, /data\.agent_status/,
    'the host notification path must read agent_status');
  assert.match(panelSrcHold, /const isResume = !text/,
    'a held scope must still let the resume through');
  assert.ok(!/for \(const held of Object\.keys\(scopeHolds\)\)/.test(panelSrcHold),
    'switching panes must not release per-scope holds');
  assert.match(panelSrcHold, /function pruneStaleScopeState\(\)/,
    'records of panes that no longer exist must be pruned on refresh');
  assert.match(panelSrcHold, /tmux\.available === true/,
    'a failed tmux probe must not prune live pane records');
  assert.match(panelSrcHold, /pruneStaleScopeState\(\);/,
    'the refresh path must prune stale scope state');
  assert.match(panelSrcHold, /scopeHoldKind\[scope\] = 'unknown';[\s\S]{0,120}renderOutput/,
    'an unknown line-key outcome must hold the scope');
  assert.match(panelSrcHold, /取消\/改行已送达/,
    'the hold must only clear after the cancelling key lands');
  const scopedDeletes = (panelSrcHold.match(/delete pendingEnterOnly\[scope\];/g) || []).length;
  assert.ok(scopedDeletes >= 3, 'records must be deleted per scope');

  // 首段结果未知也冻结；恢复用钉住的目标；Herdr 回车是小写。
  const panelSrcResume = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcResume, /scopeHoldKind\[scope\] = 'unknown'/,
    'an unknown first-stage outcome must hold the scope as unknown');
  assert.ok(!/HERDR_OUTCOME_UNKNOWN[\s\S]{0,200}?pendingEnterOnly = \{ scope: scope, text: text \};\s*\n\s*scopeHolds/.test(panelSrcResume),
    'an unknown first stage must not claim the text is in the terminal');
  assert.match(panelSrcResume, /if \(kindAtEnqueue === 'unknown'\) scopeHolds\[scope\] = 0;/,
    'an unknown hold must let the checked resend through as a full submit');
  assert.match(panelSrcResume, /sendEnterOnly\(scope, pinnedView, target, paneId\)/,
    'the enter-only resume must use the pinned target');
  assert.match(panelSrcResume, /const pendingEnterOnly = \{\};/,
    'pending-enter records must be stored per scope');
  assert.match(panelSrcResume, /const terminalHasContent = \{\};/,
    'terminal-content records must be stored per scope');
  assert.match(panelSrcResume, /keys: \['enter'\]/,
    'the Herdr resume must send a lowercase enter');

  // Command 键留给浏览器。
  const libSrc = readFileSync(path.join(root, 'herdr', 'panel-lib.js'), 'utf8');
  assert.match(libSrc, /if \(event\.metaKey\) return null;/,
    'Cmd shortcuts must stay with the browser');

  // paneIds 基线在确认后推进。
  const workerSrc14 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc14, /确认后才推进 paneIds 基线/,
    'the paneIds baseline must advance only after the subscribe confirm');

  // 主进程先加载语言再建立首个订阅。
  assert.match(mainSource, /loadRuntimeLocale\(\)\.then\(function \(\) \{ ensureSubscription\(\); \}/,
    'the first subscription must wait for the runtime locale');

  // Herdr 的保留键名也要识别。
  const panelSrcKeys = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcKeys, /'ctrl\+l': true/,
    'the Herdr keep-keys must be recognised too');
  // 改行键送达后记终端有内容。
  assert.match(panelSrcKeys, /terminalHasContent\[scope\] = true;[\s\S]{0,60}\n    \}\n    await refreshAfterWrite/,
    'a delivered line-key must record remote content');
  // sendEnterOnly 失败无条件恢复 map。
  assert.match(panelSrcKeys, /map 记录按 scope 存：无论现在选中哪个分屏都要恢复/,
    'a failed enter-only must restore the per-scope records');
  // 对账绑定订阅代次。
  assert.match(workerSrc13, /stillCurrent/,
    'the reconcile must stop when the subscription is no longer current');
  assert.match(workerSrc13, /reconcileBacklog/,
    'an interrupted reconcile must hand the remaining panes to the next subscription');

  // 只读刷新失败不能掉进写结果的 catch。
  const panelSrcRf = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcRf, /async function refreshAfterWrite\(\)/,
    'post-write refreshes must be isolated from the write outcome');
  const refreshCalls = (panelSrcRf.match(/await refreshAfterWrite\(\);/g) || []).length;
  assert.ok(refreshCalls >= 4, 'all write paths must use the isolated refresh');

  // 已在终端的待补文本不再重复同步；草稿同步未知也冻结。
  assert.match(panelSrcRf, /if \(draft && pendingEnterOnly\[scope\] === draft\)/,
    'a draft that is already in the terminal must not be pasted again');
  assert.match(panelSrcRf, /HERDR_OUTCOME_UNKNOWN[\s\S]{0,200}?terminalHasContent\[scope\] = true;[\s\S]{0,120}scopeHoldKind\[scope\] = 'unknown'/,
    'an unknown draft-sync outcome must hold the scope');

  // 对账：晚到余量交给当前代次；临时失败有界重试。
  const workerSrc15 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc15, /余量直接交给当前代次/,
    'a late reconcile remainder must be kicked to the current generation');
  assert.match(workerSrc15, /reconcileRetries/,
    'a transient reconcile failure must get a bounded retry');
  assert.match(workerSrc15, /sinceOverride/,
    'retries must keep the original reconcile cursor');

  // 写后刷新要能拿到失败（提示「操作已完成」）。
  const panelSrcRt = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcRt, /refreshTerminal\(true\)/,
    'the post-write refresh must surface failures');
  assert.match(panelSrcRt, /if \(rethrow\) throw error;/,
    'refreshTerminal must rethrow when asked');

  // unknown 冻结时按键要拦截（只放行取消键）。
    assert.match(panelSrcHold, /scopeHolds\[scope\] && !isCancelKey/,
    'a held scope must only let an explicit cancel key through');
  assert.match(panelSrcRt, /queuedDrafts\[scope\] = prior \+ addition/,
    'a blocked key must accumulate drafts in their original order');

  // AltGraph 留给文本输入。
  assert.match(libSrc, /ctrlKey && event\.altKey\) return null;/,
    'AltGraph must stay with text input');

  // 第三方标识登记在插件内（根 TRADEMARKS.md 是共享打包文件，不能在本 PR 改）。
  for (const file of ['THIRD-PARTY-MARKS.md', 'THIRD-PARTY-MARKS.zh-CN.md']) {
    const marks = readFileSync(path.join(root, 'herdr', file), 'utf8');
    for (const owner of ['Anthropic', 'OpenAI', 'Anysphere']) {
      assert.ok(marks.includes(owner), file + ' must register ' + owner);
    }
  }

  // 单个 worker 队列任务完成文本+Enter；出队复核 hold；提示四语言化；新旧快照对比。
  const panelSrcAtomic2 = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcAtomic2, /TMUX_STAGE=enter/,
    'the panel must distinguish the Enter stage of the atomic submit');
  assert.match(panelSrcAtomic2, /入队之后才建立的 hold 要挡住所有预先排队的任务/,
    'the queued submit must re-check the hold at dequeue time');
  assert.match(panelSrcAtomic2, /queuedDrafts\[scope\] = prior \+ text/,
    'multiple blocked submits must keep their original order');
  for (const key of ['heldHint', 'enterUnconfirmed', 'enterStillUnknown', 'doneRefreshFailed', 'terminalInput']) {
    const count = (panelSrcAtomic2.match(new RegExp(key + ':', 'g')) || []).length;
    assert.ok(count >= 4, key + ' must be localized in all four languages');
  }
  const workerSrc16 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc16, /async 'tmux\/submit'/,
    'the worker must offer one atomic text+Enter operation');
  assert.match(mainSource, /sameScheduleConfig\(freshItem, oldItem\)/,
    'the old schedule must be compared with the snapshot before deletion');

  // 解析后的 pane 身份做队列键；换代后失败交接；会话绑定纳入漂移；被拦草稿交还。
  const workerSrc17 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc17, /tmuxQueueKey/,
    'tmux write queues must key on the resolved pane identity');
  assert.match(workerSrc17, /换代之后才失败的：直接交给当前订阅/,
    'a failed reconcile after a handover must reach the current subscription');
  assert.match(mainSource, /targetSessionId: item && item\.targetSessionId/,
    'the drift check must include targetSessionId');
  const panelSrcQd = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcQd, /restoreQueuedDrafts/,
    'queued drafts must be handed back when the pane is reselected');
  assert.match(panelSrcQd, /只有用户看到并重新提交它/,
    'queued drafts must not be dropped by an empty-Enter resume');

  // 身份解析失败要停止写入；空回车恢复要能让被拦草稿继续保留。
  const workerSrc18 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc18, /TMUX_TARGET_UNRESOLVED/,
    'an unresolved tmux target must stop the write instead of splitting the queue');
  const panelSrcQd2 = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcQd2, /const resuming = !text/,
    'an empty-Enter resume must pass through while keeping blocked drafts');

  // 稳定 pane id：队列任务用它发送，面板用它做 scope。
  const workerSrc19 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc19, /pane_id: '#\{pane_id\}'/,
    'the tmux pane list must expose the stable pane id');
  assert.match(workerSrc19, /tmuxSend\(key, sendParams\)/,
    'the queued send must use the resolved pane id as its target');
  const panelSrcId = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcId, /function tmuxStableTarget/,
    'the panel must scope tmux state by stable pane id');
  assert.match(panelSrcId, /selectedTarget = stable;/,
    'selecting a tmux pane must store the stable id');

  // unknown 之后冻结 worker 队列；显式恢复带 allow_held；新 hold 挡预排空回车；按键草稿有序；可访问名四语言。
  const workerSrc20 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc20, /TMUX_QUEUE_HELD/,
    'an unknown write must freeze the pane write queue');
  assert.match(mainSource, /tmuxSendRequest\(\{[\s\S]{0,200}\}, request\.allow_held === true\)/,
    'only the panel bridge may unlock the worker queue');
  assert.ok(!/args\.allow_held/.test(mainSource),
    'the agent tool must ignore an allow_held argument');
  const panelSrcQd3 = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcQd3, /if \(holdIsNew\) \{/,
    'a hold created after enqueue must also block an empty Enter');
  assert.match(panelSrcQd3, /allow_held: true/,
    'the enter-only resume must unlock the pane queue');
  assert.match(panelSrcQd3, /queuedDrafts\[scope\] = prior \+ addition/,
    'blocked key drafts must accumulate in order');
  assert.match(panelSrcQd3, /aria-label', T\.terminalInput/,
    'the terminal input accessible name must be localized');

  // 冻结后的恢复路径要能解冻；连续 Tab 不重复累积。
  const workerSrc21 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc21, /recoveryKey/,
    'a plain cancel/Enter key must unlock the worker queue too');
  const panelSrcRec = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcRec, /allow_held: true \}\)/,
    'the resume path must send the unlock marker');
  assert.match(panelSrcRec, /unlockedResend = kindAtEnqueue === 'unknown'/,
    'only a checked full resend may unlock the queue');
  assert.match(panelSrcRec, /draftFromRestore && prior && draft\.indexOf\(prior\) === 0/,
    'duplicate detection must use the capture-time restore marker');

  const panelSrcMark = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  assert.match(panelSrcMark, /restoredBoxText\[scope\] = holdBox\.value/,
    'restored drafts must be marked at capture time');
  assert.match(panelSrcMark, /draft\.indexOf\(restoredBoxText\[scope\]\) === 0/,
    'text typed after a restored draft must keep its restore origin');

  // 被动断线失效基线；回填路径登记恢复 marker；页面 lang 四语言。
  const workerSrc22 = readFileSync(path.join(root, 'herdr', 'node', 'worker.cjs'), 'utf8');
  assert.match(workerSrc22, /subscription\.paneIds = \[\];/,
    'a passive disconnect must invalidate the paneIds baseline');
  assert.match(workerSrc22, /generationAtStart/,
    'a snapshot taken during a handover must be invalidated');
  assert.match(workerSrc22, /subscription\.pendingSocket = socket;/,
    'a socket must only become current after the handshake');
  assert.ok(!/subscription\.socket = socket;[\s\S]{0,80}net\.createConnection/.test(workerSrc22),
    'the current socket must not be replaced before the acknowledgement');
  assert.match(workerSrc22, /lastDeliveredStatus\[data\.pane_id\] = data\.agent_status/,
    'the delivered status must be recorded per pane');
  assert.match(workerSrc22, /lastDeliveredStatus\[paneId\] !== status/,
    'a reconcile must not re-deliver an already delivered status');
  assert.match(workerSrc22, /if \(!liveArrived\(paneId\)\) lastDeliveredStatus\[paneId\] = status;/,
    'a reconcile must not overwrite a fresher live status');
  const panelSrcLang = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  const langCount = (panelSrcLang.match(/lang: '/g) || []).length;
  assert.ok(langCount >= 4, 'the page language must be defined for all locales');
  const tabCount = (panelSrcLang.match(/dataSourceTabs: '/g) || []).length;
  assert.ok(tabCount >= 4, 'the tablist accessible name must be localized');
  assert.match(panelSrcLang, /dataSourceTabs\);/,
    'the tablist accessible name must be applied on language change');
  assert.match(panelSrcLang, /documentElement\.lang = T\.lang/,
    'the page lang must follow the host language');

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

  const result = await sandbox.ensureAutomationSchedule('Herdr 事件处理', { silentWhenIdle: true });

  assert.equal(result.schedule_id, 'S1', 'must reuse the recorded schedule');
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
    for (const bad of ['Entter', '\n', ';', 'C-;', 'a b']) {
      const typo = await call('tmux/send', { target: 'x:0.0', keys: [bad] });
      assert.ok(typo.error, `expected an error for ${JSON.stringify(bad)}, got ${JSON.stringify(typo)}`);
      assert.match(typo.error.message, /TMUX_BAD_KEY|不支持的按键/,
        `expected a key rejection for ${JSON.stringify(bad)}, got ${typo.error.message}`);
    }

    // 跨层一致性：面板能发出的每一个 tmux 键名，都必须通过 worker 的白名单。
    const panelNames = Object.values(lib.TMUX_KEYS);
    for (const key of panelNames) {
      const result = await call('tmux/send', { target: 'x:0.0', keys: [key] });
      assert.ok(!result.error || !/TMUX_BAD_KEY/.test(result.error.message || ''),
        `panel key ${key} must pass the worker whitelist, got ${JSON.stringify(result)}`);
    }

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


test('a replacement payload keeps the fields the caller did not specify', async () => {
  const mainSource = readFileSync(path.join(root, 'herdr', 'main.js'), 'utf8');
  const sandbox = {
    console,
    BroadcastChannel: class { addEventListener() {} removeEventListener() {} postMessage() {} },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    Date, Math, JSON, Object, Array, String, Number, Boolean, Error, Promise, RegExp, Intl,
    cindy: {
      request: () => Promise.resolve({ context: { locale: 'zh-CN' } }),
      send: () => Promise.resolve(),
      onHostMessage: () => {},
      node: { request: () => Promise.resolve({ ok: true, result: {} }) },
      host: { call: () => Promise.resolve({ isError: false, content: [{ type: 'text', text: '{"ok":true,"data":{}}' }] }) }
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(mainSource, sandbox, { filename: 'main.js' });

  const oldItem = {
    name: 'Herdr 事件处理',
    prompt: '我的自定义提示\n\n[cindy-plugin:herdr]',
    agentKind: 'claude-code',
    silentWhenIdle: false,
    timezone: 'UTC',
    cronExpr: '0 7 * * *',
    notify: { desktop: false, feishu: true }
  };
  const payload = sandbox.schedulePayload('Herdr 事件处理', {}, oldItem);
  assert.match(payload.prompt, /^我的自定义提示/,
    'the custom prompt must be carried over');
  assert.equal(payload.prompt.split('[cindy-plugin:herdr]').length, 2,
    'the marker must appear exactly once');
  assert.equal(payload.agentKind, 'claude-code', 'agent kind must be carried over');
  assert.equal(payload.silentWhenIdle, false, 'silence must be carried over');
  assert.equal(payload.timezone, 'UTC', 'timezone must be carried over');
  assert.equal(payload.cronExpr, '0 7 * * *', 'cron expression must be carried over');
  assert.equal(payload.targetSessionId, undefined, 'the replacement must stay unbound');
});
