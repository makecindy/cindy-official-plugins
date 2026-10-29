import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const plugin = new URL('../cindy-ping/', import.meta.url);
const source = name => readFileSync(new URL(name, plugin), 'utf8');
const library = require('../cindy-ping/emote-library.js');
const { validateConfig, migrateConfig } = require('../cindy-ping/node/config.cjs');
const defaults = () => migrateConfig(library.defaults('en'));
const clone = value => structuredClone(value);
const revision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const sendEmote = (config = defaults()) => ({ ...config.emotes[0], action: 'existing', prompt: 'Inspect this example.',
  target: { mode: 'fixed', ref: { kind: 'task', id: 'fixture-task' }, label: 'Example task' }, delivery: 'queue' });

function clockedScheduler(capture = async () => ({ text: 'example' })) {
  let now = 0, next = 0;
  const timers = new Map(), events = [];
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ module: { exports: {} }, require, structuredClone, Date: Clock,
    setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id) });
  vm.runInContext(source('node/scheduler.cjs'), context);
  const scheduler = new context.module.exports.LatestAction({ capture, notify: (kind, data) => events.push({ kind, ...data }) });
  return { scheduler, events, async tick(ms) {
    const until = now + ms;
    for (;;) {
      const entry = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry; now = timer.at; timers.delete(id); timer.fn(); await settle();
    }
    now = until; await settle();
  } };
}

async function host({ saved = {}, send, cancel, create, list, capabilities, beginDispatch = () => ({ current: true }), modelCatalog = [], failWrite = () => false } = {}) {
  let stored = clone(saved), handler;
  const writes = [], calls = [], events = [];
  const snapshot = { capturedAt: 1000, text: 'fixture-window-text', jpeg: 'ZmFrZS1pbWFnZQ==',
    source: { target: { windowId: 1, app: 'Example', title: 'Example window' }, point: { x: 10, y: 20 } }, issues: [] };
  const info = { operations: ['create', 'get', 'list', 'send', 'getRun', 'cancel', 'models', 'setModel'], createPermissionMode: true,
    messageContext: true, autoTitle: true, messageAttachments: { kinds: ['image'] } };
  const context = vm.createContext({ TextEncoder, console,
    BroadcastChannel: class { postMessage(value) { events.push(clone(value)); } },
    fetch: async (url, options) => {
      assert.equal(url, '/kv');
      if (options?.method === 'PUT') {
        if (failWrite()) return { ok: false };
        stored = JSON.parse(options.body); writes.push(clone(stored));
      }
      return { ok: true, json: async () => clone(stored) };
    },
    cindy: {
      request: async () => ({ context: { locale: 'en' } }),
      onHostMessage: fn => { handler = fn; }, send: async () => {},
      node: { request: async ({ method, params }) => {
        calls.push({ method, params: clone(params) });
        const result = (() => {
          switch (method) {
            case 'defaults': return library.defaults(params.locale);
            case 'validate': return validateConfig(params);
            case 'migrate': return migrateConfig(params);
            case 'configRevision': return { revision: revision(params) };
            case 'configure': return { enabled: params.runtimeEnabled !== false, issues: [] };
            case 'status': return { enabled: true, permissions: {}, issues: [] };
            case 'current': return { current: true };
            case 'beginDispatch': return beginDispatch(params);
            case 'complete': return { current: true };
            case 'readSnapshot': return clone(snapshot);
            case 'wheelTargets': return { current: true };
            case 'resolveTarget': return { current: true };
            default: throw new Error(`Unexpected node method: ${method}`);
          }
        })();
        return { ok: true, result: clone(result) };
      } },
      tasks: { capabilities: async () => capabilities || info, models: async () => ({ models: modelCatalog }),
        create: async params => { calls.push({ method: 'create', params: clone(params) }); return create(params); },
        get: async ({ taskId }) => ({ taskId, title: 'Example', status: 'active', revision: 1, resolvedConfig: { agentKind: 'codex', providerId: 'primary', model: 'current', effort: 'medium', fastMode: false } }),
        setModel: async params => { calls.push({ method: 'setModel', params: clone(params) }); return { task: { taskId: params.taskId, status: 'active', revision: 2, resolvedConfig: params.route } }; },
        send: async params => { calls.push({ method: 'taskSend', params: clone(params) }); return { runId: 'fixture-run', status: 'queued' }; } },
      targets: {
        list: async params => list ? list(params) : { targets: [] },
        resolve: async ({ target }) => ({ ...target, label: 'Example', detail: '' }),
        send: async params => { calls.push({ method: 'send', params: clone(params) }); return send ? send(params) : { taskId: 'fixture-task', accepted: true, delivery: params.delivery }; },
        cancel: async params => { calls.push({ method: 'cancel', params: clone(params) }); return cancel ? cancel(params) : { cancelled: true, runningWorkMayHaveStarted: true }; },
      },
    },
  });
  vm.runInContext(source('main.js') + '\nglobalThis.api = { boot, queueSetting, dispatch, invalidate, capabilities, inspect: () => ({state, recovered, outcome}), drained: () => dispatchQueue };', context);
  await context.api.boot;
  await context.api.capabilities();
  return { api: context.api, calls, writes, events, snapshot, stored: () => clone(stored),
    event: params => handler({ type: 'event', name: 'node-notification', method: 'emote/event', params }) };
}

test('defaults have four display-only emotes, a distinct undo image and Command+G', () => {
  const config = defaults();
  assert.equal(config.emotes.length, 4);
  assert.deepEqual(config.wheelShortcut, { code: 'KeyG', modifiers: 8 });
  for (const emote of config.emotes) { assert.equal(emote.action, 'none'); assert.equal(emote.prompt, ''); }
  assert.equal(config.emotes[3].id, 'ping-undo');
  for (const preset of library.presets()) assert.ok(readFileSync(new URL(preset.imagePath, plugin)).length);
});

test('old built-in image paths migrate without changing user instructions, targets or pinned positions', () => {
  const config = defaults();
  config.emotes[0] = { ...sendEmote(config), imagePath: 'assets/emotes/help.png', pinAngle: 0 };
  config.emotes[1].imagePath = '/example.test/custom.png';
  config.emotes[3].action = 'undo';
  const next = migrateConfig(config);
  assert.deepEqual(next.emotes[0], { ...config.emotes[0], imagePath: 'assets/emotes/help.webp' });
  assert.equal(next.emotes[1].imagePath, '/example.test/custom.png');
  assert.equal(next.emotes[3].action, 'none');
  assert.equal(next.emotes[3].imagePath, config.emotes[3].imagePath);
});

test('invalid prompt, target kind, pin angle and duplicate slots are rejected', () => {
  for (const mutate of [
    config => { config.emotes[0] = { ...sendEmote(config), prompt: ' ' }; },
    config => { config.emotes[0] = { ...sendEmote(config), target: { mode: 'fixed', ref: { kind: 'bot', id: 'fixture' } } }; },
    config => { config.emotes[0].pinAngle = 15; },
    config => { config.emotes[1].angle = 0; },
    config => { config.emotes.pop(); },
  ]) { const config = defaults(); mutate(config); assert.throws(() => validateConfig(config), /CONFIG_INVALID/); }
});

// The send delay must not change the page that is captured when the emote is released.
test('display-only emotes never capture; sending captures immediately but waits two seconds', async () => {
  let count = 0;
  const { scheduler, events, tick } = clockedScheduler(async () => { count++; return { text: 'example' }; });
  scheduler.trigger({}, defaults().emotes[0]); await tick(5000); assert.equal(count, 0);
  scheduler.trigger({}, { ...sendEmote(), target: undefined });
  await tick(0); assert.equal(count, 1);
  assert.equal(events.filter(event => event.kind === 'prepared').length, 0);
  await tick(1999); assert.equal(count, 1);
  await tick(1); assert.equal(count, 1);
  assert.equal(events.filter(event => event.kind === 'prepared').length, 1);
});

test('a display-only emote at 1999ms cancels the old action and drops late captures', async () => {
  const capture = deferred();
  const { scheduler, events, tick } = clockedScheduler(() => capture.promise);
  scheduler.trigger({}, { ...sendEmote(), target: undefined }); await tick(1999);
  scheduler.trigger({}, defaults().emotes[3]); await tick(5000);
  assert.equal(events.filter(event => event.kind === 'capturing').length, 1);
  scheduler.trigger({}, { ...sendEmote(), target: undefined }); await tick(2000);
  scheduler.trigger({}, defaults().emotes[1]); capture.resolve({ text: 'late material' }); await settle();
  assert.equal(scheduler.snapshot, null);
  assert.equal(events.filter(event => event.kind === 'prepared').length, 0);
});

test('prompt mode keeps preset instructions and permits an empty per-use input draft', () => {
  const config = defaults();
  config.emotes[0] = sendEmote(config);
  const preset = validateConfig(config).emotes[0];
  assert.equal(preset.promptMode, 'preset');
  assert.equal(preset.prompt, config.emotes[0].prompt);
  config.emotes[0].promptMode = 'input';
  assert.equal(validateConfig(config).emotes[0].prompt, preset.prompt);
  config.emotes[0].prompt = '';
  assert.equal(validateConfig(config).emotes[0].promptMode, 'input');
  config.emotes[0].promptMode = 'other';
  assert.throws(() => validateConfig(config), /CONFIG_INVALID/);
});

// Real scheduler entry: only the selected input-mode emote may request the input UI.
test('only per-use input opens an input request and cannot send until submitted', async () => {
  const { scheduler, events, tick } = clockedScheduler();
  const emote = { ...sendEmote(), target: undefined, promptMode: 'input' };
  scheduler.trigger({ gestureId: 'input-gesture' }, emote);
  const id = scheduler.current.id;
  await tick(0);
  assert.equal(events.filter(event => event.kind === 'input-required').length, 1);
  assert.equal(events.find(event => event.kind === 'input-required').prompt, '');
  await tick(10000);
  assert.equal(events.filter(event => event.kind === 'prepared').length, 0);
  assert.equal(scheduler.submitInput('old', 'wrong').current, false);
  assert.equal(scheduler.submitInput(id, ' ').current, false);
  assert.equal(scheduler.submitInput(id, 'Only for this send').current, true);
  const prepared = events.find(event => event.kind === 'prepared');
  assert.equal(prepared.emote.prompt, 'Only for this send');
  assert.equal(emote.prompt, 'Inspect this example.');
  assert.equal(scheduler.submitInput(id, 'duplicate').current, false);
  scheduler.complete(id);
  assert.equal(scheduler.snapshot, null);
  assert.equal(scheduler.current, null);

  events.length = 0;
  scheduler.trigger({}, { ...sendEmote(), target: undefined, promptMode: 'preset' });
  await tick(2000);
  assert.equal(events.some(event => event.kind === 'input-required'), false);
  assert.equal(events.filter(event => event.kind === 'prepared').length, 1);
  scheduler.trigger({}, { ...defaults().emotes[0], promptMode: 'input' });
  await tick(2000);
  assert.equal(events.some(event => event.kind === 'input-required'), false);
});

test('rapid triggers keep one capture in flight and only the newest pending source', async () => {
  const first = deferred(), seen = [];
  const { scheduler, events, tick } = clockedScheduler(async operation => {
    seen.push(operation.event.page);
    return operation.event.page === 'first' ? first.promise : { text: operation.event.page };
  });
  const emote = { ...sendEmote(), target: undefined };
  scheduler.trigger({ page: 'first' }, emote);
  scheduler.trigger({ page: 'middle' }, emote);
  scheduler.trigger({ page: 'last' }, emote);
  await tick(0);
  assert.deepEqual(seen, ['first']);
  first.resolve({ text: 'stale' }); await settle(); await settle();
  assert.deepEqual(seen, ['first', 'last']);
  assert.equal(scheduler.snapshot.text, 'last');
  await tick(2000);
  assert.equal(events.filter(event => event.kind === 'prepared').length, 1);
  const id = scheduler.current.id;
  assert.equal(scheduler.beginDispatch(id).current, true);
  assert.equal(scheduler.cancel(id).cancelled, false);
  scheduler.complete(id);
  assert.equal(scheduler.snapshot, null);
});

test('Esc cancellation clears an input draft and drops a late capture without preparing delivery', async () => {
  const capture = deferred();
  const { scheduler, events, tick } = clockedScheduler(() => capture.promise);
  scheduler.trigger({}, { ...sendEmote(), target: undefined, promptMode: 'input' });
  const id = scheduler.current.id;
  assert.equal(scheduler.cancel(id).cancelled, true);
  capture.resolve({ text: 'cancelled' }); await tick(5000);
  assert.equal(scheduler.snapshot, null);
  assert.equal(events.some(event => ['input-required', 'prepared'].includes(event.kind)), false);
});

test('destination selection and delay must both complete; stale or duplicate callbacks cannot send', async () => {
  const { scheduler, events, tick } = clockedScheduler();
  scheduler.trigger({}, sendEmote()); const old = scheduler.current.id;
  await tick(2000); assert.equal(events.filter(event => event.kind === 'prepared').length, 0);
  scheduler.trigger({}, sendEmote()); const id = scheduler.current.id;
  scheduler.resolveTarget(old, { kind: 'task', id: 'wrong' });
  scheduler.resolveTarget(id, { kind: 'task', id: 'fixture-task' }); await tick(1999);
  assert.equal(events.filter(event => event.kind === 'prepared').length, 0);
  await tick(1); scheduler.resolveTarget(id, { kind: 'task', id: 'wrong' }); await settle();
  assert.equal(events.filter(event => event.kind === 'prepared').length, 1);
  assert.equal(events.find(event => event.kind === 'prepared').target.id, 'fixture-task');
});

// Run the production stdio worker with an in-memory native transport, never an app.
async function workerFixture(config, captureSnapshot = {}) {
  const native = [], notifications = [], timers = new Map();
  let now = 0, next = 0;
  const child = new EventEmitter(); child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  const emit = event => child.stdout.emit('data', JSON.stringify(event) + '\n');
  child.stdin = new EventEmitter(); child.stdin.writable = true;
  child.stdin.write = line => {
    const request = JSON.parse(line); native.push(request);
    const result = request.method === 'capture'
      ? { text: 'original-window', ...captureSnapshot, source: request.params.event, capturedAt: now, issues: [] } : { current: true };
    queueMicrotask(() => emit({ id: request.id, result }));
  };
  child.kill = () => { throw new Error('Unexpected helper kill'); };
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ module: { exports: {} }, __dirname: '/example.test/cindy-ping/node',
    structuredClone, Date: Clock, Buffer,
    setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    require: name => {
      if (name === './scheduler.cjs') return context.schedulerModule;
      if (name === './config.cjs') return { validateConfig, migrateConfig };
      if (name === '../emote-library.js') return library;
      if (name === '../shortcuts.js') return require('../cindy-ping/shortcuts.js');
      if (name === 'node:readline') return { createInterface: () => new EventEmitter() };
      if (name === 'node:fs/promises') return { chmod: async () => {} };
      if (name === 'node:child_process') return { spawn: () => { queueMicrotask(() => emit({ kind: 'ready' })); return child; } };
      return require(name);
    },
    process: { platform: 'darwin', stdin: {}, on() {}, exit() { throw new Error('Unexpected exit'); },
      stdout: { write: line => { const event = JSON.parse(line); if (event.method) notifications.push(event.params); } } },
  });
  vm.runInContext(`(function(){${source('node/scheduler.cjs')}\n})();`, context);
  context.schedulerModule = context.module.exports;
  vm.runInContext(source('node/worker.cjs') + '\nglobalThis.api={execute,scheduler};', context);
  await context.api.execute('configure', { ...config, locale: 'en' });
  const revision = native.find(call => call.method === 'configure').params.configRevision;
  return { api: context.api, native, notifications, emit,
    trigger: (id, gestureId) => emit({ kind: 'trigger', emoteId: id, gestureId, configRevision: revision,
      point: { x: 12, y: 34 }, target: { windowId: 7 } }),
    async tick(ms = 0) {
      await settle();
      const until = now + ms;
      for (;;) {
        const entry = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, timer] = entry; now = timer.at; timers.delete(id); timer.fn(); await settle();
      }
      now = until; await settle();
    },
  };
}

test('worker opens native input only for the selected input-mode sender and ignores stale submission', async () => {
  const config = defaults();
  config.emotes[0] = { ...sendEmote(config), action: 'new', target: undefined, screenshot: false, promptMode: 'input', prompt: 'Saved preset stays in settings' };
  config.emotes[1] = { ...config.emotes[0], id: config.emotes[1].id, angle: 90, promptMode: 'preset', prompt: 'Preset' };
  config.emotes[2].promptMode = 'input';
  const f = await workerFixture(config);
  f.trigger(config.emotes[0].id, 'first'); await f.tick();
  const opened = f.native.filter(call => call.method === 'openInput');
  assert.equal(opened.length, 1);
  assert.equal(opened[0].params.prompt, '');
  const capture = f.native.find(call => call.method === 'capture');
  assert.equal(capture.params.screenshot, false);
  assert.equal(capture.params.event.target.windowId, 7);
  f.trigger(config.emotes[1].id, 'second'); await f.tick();
  f.emit({ kind: 'input-submit', id: opened[0].params.id, text: 'Stale input' }); await f.tick(2000);
  assert.equal(f.native.filter(call => call.method === 'openInput').length, 1);
  const prepared = f.notifications.filter(event => event.kind === 'prepared');
  assert.equal(prepared.length, 1); assert.equal(prepared[0].emote.prompt, 'Preset');
  f.trigger(config.emotes[2].id, 'display'); await f.tick(2000);
  assert.equal(f.native.filter(call => call.method === 'openInput').length, 1);
  assert.equal(f.native.filter(call => call.method === 'capture').length, 2);
});

test('worker Esc cancels unsent input, while dispatch and completion clear only their own native state', async () => {
  const config = defaults(); config.emotes[0] = { ...sendEmote(config), action: 'new', target: undefined, promptMode: 'input' };
  const f = await workerFixture(config);
  f.trigger(config.emotes[0].id, 'cancelled'); await f.tick();
  const first = f.api.scheduler.current.id;
  f.emit({ kind: 'input-cancel', id: first }); await f.tick(3000);
  assert.equal(f.api.scheduler.snapshot, null);
  assert.equal(f.notifications.some(event => event.kind === 'prepared'), false);
  f.trigger(config.emotes[0].id, 'accepted'); await f.tick();
  const id = f.api.scheduler.current.id;
  f.emit({ kind: 'input-submit', id, text: 'Temporary prompt' }); await f.tick(2000);
  assert.equal(f.notifications.find(event => event.kind === 'prepared').emote.prompt, 'Temporary prompt');
  assert.equal((await f.api.execute('beginDispatch', { id })).current, true);
  f.emit({ kind: 'cancel-action', gestureId: 'accepted' }); await f.tick();
  assert.equal(f.api.scheduler.isCurrent(id), true);
  await f.api.execute('complete', { id: first });
  assert.equal(f.api.scheduler.isCurrent(id), true);
  await f.api.execute('complete', { id });
  assert.equal(f.api.scheduler.snapshot, null);
  assert.ok(f.native.some(call => call.method === 'closeInput' && call.params.id === id));
});

test('Esc after reopening the wheel cancels the previous preset send during its wait', async () => {
  const config = defaults(); config.emotes[0] = { ...sendEmote(config), action: 'new', target: undefined };
  const f = await workerFixture(config);
  f.trigger(config.emotes[0].id, 'waiting-send'); await f.tick(1500);
  const id = f.api.scheduler.current.id;
  f.emit({ kind: 'wheel-open', gestureId: 'reopened', configRevision: f.native.find(call => call.method === 'configure').params.configRevision });
  assert.equal(f.notifications.at(-1).kind, 'wheel-open');
  f.emit({ kind: 'wheel-closed', gestureId: 'reopened' });
  f.emit({ kind: 'cancel-action', gestureId: 'waiting-send' }); await f.tick(3000);
  assert.equal(f.api.scheduler.isCurrent(id), false);
  assert.equal(f.api.scheduler.snapshot, null);
  assert.equal(f.notifications.some(event => event.kind === 'prepared'), false);
  assert.equal((await f.api.execute('beginDispatch', { id })).current, false);
});

test('worker retains the original screenshot through an hour of input without recapture or automatic sending', async () => {
  const config = defaults();
  config.emotes[0] = { ...sendEmote(config), action: 'new', target: undefined, screenshot: true, promptMode: 'input' };
  const jpeg = Buffer.from('synthetic screenshot fixture').toString('base64');
  const f = await workerFixture(config, { jpeg });
  f.trigger(config.emotes[0].id, 'long-input'); await f.tick();
  const id = f.api.scheduler.current.id;
  const original = await f.api.execute('readSnapshot', { id });
  await f.tick(60 * 60 * 1000);
  assert.equal(f.native.filter(call => call.method === 'capture').length, 1);
  assert.equal(f.notifications.some(event => event.kind === 'prepared'), false);
  const retained = await f.api.execute('readSnapshot', { id });
  assert.equal(retained.jpeg, jpeg);
  assert.equal(retained.capturedAt, original.capturedAt);
  assert.equal(retained.source.gestureId, 'long-input');
  f.emit({ kind: 'input-submit', id, text: 'Written over an hour' }); await f.tick();
  const prepared = f.notifications.filter(event => event.kind === 'prepared');
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].summary.hasImage, true);
  assert.equal((await f.api.execute('readSnapshot', { id })).jpeg, jpeg);
  assert.equal(f.native.filter(call => call.method === 'capture').length, 1);
  await f.api.execute('complete', { id });
  assert.equal(f.api.scheduler.snapshot, null);
});

test('worker keeps per-use input after the animation and reuses it for only the latest rapid trigger', async () => {
  const config = defaults();
  config.emotes[0] = { ...sendEmote(config), action: 'new', target: undefined, promptMode: 'input' };
  config.emotes[1] = { ...config.emotes[0], id: config.emotes[1].id, angle: 90 };
  const f = await workerFixture(config);
  const projection = f.native.find(call => call.method === 'configure').params.emotes;
  assert.equal(projection[0].promptMode, 'input');
  f.trigger(config.emotes[0].id, 'first'); await f.tick();
  const oldId = f.api.scheduler.current.id;
  const closes = f.native.filter(call => call.method === 'closeInput').length;
  for (let index = 0; index < 20; index++) f.trigger(config.emotes[index % 2].id, `rapid-${index}`);
  await f.tick();
  assert.equal(f.native.filter(call => call.method === 'closeInput').length, closes);
  const opens = f.native.filter(call => call.method === 'openInput');
  assert.equal(opens.length, 2);
  const id = opens[1].params.id;
  assert.equal(opens[1].params.gestureId, 'rapid-19');
  f.emit({ kind: 'input-submit', id: oldId, text: 'Stale' }); await f.tick(10000);
  assert.equal(f.notifications.some(event => event.kind === 'prepared'), false);
  assert.equal(f.native.filter(call => call.method === 'openInput').length, 2);
  assert.equal(f.api.scheduler.snapshot.source.gestureId, 'rapid-19');
  f.emit({ kind: 'input-submit', id, text: 'Still typing after the emote faded' }); await f.tick();
  const prepared = f.notifications.filter(event => event.kind === 'prepared');
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].id, id);
  assert.equal(prepared[0].emote.id, config.emotes[1].id);
  assert.equal(prepared[0].emote.prompt, 'Still typing after the emote faded');
  assert.equal((await f.api.execute('beginDispatch', { id })).current, true);
  await f.api.execute('complete', { id });
  assert.equal(f.api.scheduler.snapshot, null);
});

test('cancelled dispatch never creates a task or sends a message and releases its snapshot', async () => {
  for (const target of [true, false]) {
    const h = await host({ beginDispatch: () => ({ current: false }) });
    const emote = { ...sendEmote(), action: 'new' }; h.api.invalidate('cancelled');
    await h.event({ kind: 'prepared', id: 'cancelled', emote, ...(target ? { target: emote.target.ref } : {}) });
    await h.api.drained();
    assert.equal(h.calls.some(call => ['create', 'send', 'taskSend'].includes(call.method)), false);
    assert.ok(h.calls.some(call => call.method === 'complete' && call.params.id === 'cancelled'));
    assert.equal(h.stored().pending, null);
  }
});

test('prepared delivery releases its snapshot on success and on pre-send failure', async () => {
  for (const attachmentsSupported of [true, false]) {
    const h = await host({ ...(attachmentsSupported ? {} : {
      capabilities: { operations: ['create', 'get', 'list', 'send', 'getRun', 'cancel'], messageContext: true },
    }) });
    const emote = sendEmote(); h.api.invalidate('release');
    await h.event({ kind: 'prepared', id: 'release', emote, target: emote.target.ref });
    await h.api.drained();
    assert.ok(h.calls.some(call => call.method === 'complete' && call.params.id === 'release'));
    assert.equal(h.calls.some(call => call.method === 'send'), attachmentsSupported);
    assert.equal(h.api.inspect().outcome.phase, attachmentsSupported ? 'sent' : 'error');
    assert.equal(h.stored().pending, null);
  }
});

test('only explicit cancellation clears the status; other invalidation preserves the failure', async () => {
  const h = await host(); h.api.invalidate('failed');
  await h.event({ kind: 'capture-error', id: 'failed', code: 'NO_CONTENT' });
  await h.event({ kind: 'invalidate', id: 'failed' });
  assert.equal(h.api.inspect().outcome.code, 'NO_CONTENT');
  await h.event({ kind: 'invalidate', id: 'cancelled', cancelled: true });
  assert.equal(h.api.inspect().outcome.phase, 'idle');
});

test('settings and Agent accept input mode with an empty draft without changing other emotes', async () => {
  const settings = source('settings.js');
  const context = vm.createContext({ L: (_, en) => en });
  vm.runInContext(settings.slice(settings.indexOf('function emoteErrors('), settings.indexOf('function renderValidation(')) +
    '\nglobalThis.errors=emoteErrors;', context);
  const h = await host(); const initial = await h.api.queueSetting('getConfig');
  const config = clone(initial.config);
  config.emotes[0] = { ...sendEmote(config), promptMode: 'input', prompt: '' };
  assert.equal(context.errors(config.emotes[0]).prompt, undefined);
  const result = await h.api.queueSetting('configure', { revision: initial.revision, config });
  assert.equal(result.config.emotes[0].promptMode, 'input');
  assert.equal(result.config.emotes[0].prompt, '');
  assert.deepEqual(result.config.emotes.slice(1), initial.config.emotes.slice(1));
  config.emotes[0].promptMode = 'preset';
  assert.ok(context.errors(config.emotes[0]).prompt);
});

test('single-line native prompt respects IME, Enter and Esc without opening any window', { skip: process.platform !== 'darwin' }, () => {
  const swift = source('native/EmoteHelper.swift');
  const prompt = swift.slice(swift.indexOf('final class PromptPanel:'), swift.indexOf('final class WheelView:'));
  const dir = mkdtempSync(join(tmpdir(), 'ping-prompt-'));
  writeFileSync(join(dir, 'main.swift'), `import AppKit
import Carbon
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
${prompt}
func check(_ value: Bool, _ name: String) {
    if !value { fputs("Prompt failed: \\(name)\\n", stderr); exit(1) }
}
func key(_ code: UInt16, _ flags: NSEvent.ModifierFlags = []) -> NSEvent {
    NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0,
        windowNumber: 0, context: nil, characters: code == UInt16(kVK_Escape) ? "\\u{1b}" : "\\r",
        charactersIgnoringModifiers: code == UInt16(kVK_Escape) ? "\\u{1b}" : "\\r", isARepeat: false, keyCode: code)!
}
let panel = PromptPanel(id: "fixture", label: "Example", prompt: "", locale: "en",
    frame: NSRect(x: 0, y: 0, width: 360, height: 44))
var sent = 0, cancelled = 0
panel.submitted = { _ in sent += 1 }
panel.cancelled = { cancelled += 1 }
check(!panel.validText, "empty")
check(panel.sendButton.title == "Send" && panel.sendButton.isBordered, "discoverable send button")
panel.input.stringValue = String(repeating: "x", count: 8001)
check(!panel.validText, "limit")
check(panel.input.usesSingleLineMode && panel.frame.height == 44, "compact single line")
panel.input.stringValue = ""
panel.input.selectText(nil)
guard let editor = panel.input.currentEditor() as? NSTextView else { fatalError("Missing native field editor") }
for code in [UInt16(kVK_Return), UInt16(kVK_Escape)] {
    editor.string = ""
    editor.setMarkedText("你好", selectedRange: NSRange(location: 2, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
    check(editor.hasMarkedText(), "composition started")
    editor.keyDown(with: key(code))
    check(sent == 0 && cancelled == 0, "composition never sends or cancels")
    editor.unmarkText()
}
editor.string = "Temporary text"
editor.setSelectedRange(NSRange(location: editor.string.utf16.count, length: 0))
editor.keyDown(with: key(UInt16(kVK_Return), .shift))
// In a single-line field, modified Return is still Return, never a new line.
check(!editor.string.contains("\\n") && sent == 1, "stays on one line")
sent = 0;
editor.keyDown(with: key(UInt16(kVK_Return)))
check(sent == 1, "enter submits")
panel.updateSendButton()
panel.sendButton.performClick(nil)
check(sent == 2, "click sends without Return")
editor.keyDown(with: key(UInt16(kVK_Escape)))
check(cancelled == 1, "escape cancels")
panel.clearInput()
check(panel.input.stringValue.isEmpty && !panel.isVisible, "clear releases draft")
print("Native prompt cases passed")
`);
  execFileSync('xcrun', ['swiftc', '-module-cache-path', join(dir, 'module-cache'), join(dir, 'main.swift'), '-o', join(dir, 'check')], { timeout: 90000 });
  assert.match(execFileSync(join(dir, 'check'), { encoding: 'utf8', timeout: 15000 }), /cases passed/);
});

test('native input rebinds the same editor without presentation, draft loss or stale callbacks', { skip: process.platform !== 'darwin' }, () => {
  const swift = source('native/EmoteHelper.swift');
  // Exercise the production controller, replacing only presentation and stdio.
  // No application loop, event tap, capture or visible window is started.
  const implementation = swift.slice(swift.indexOf('final class Overlay:'), swift.indexOf('let application = NSApplication.shared'))
    .replace('final class PromptPanel: NSPanel, NSTextFieldDelegate {', `final class PromptPanel: NSPanel, NSTextFieldDelegate {
    override func makeKeyAndOrderFront(_ sender: Any?) { presentations += 1 }
`);
  const dir = mkdtempSync(join(tmpdir(), 'ping-input-reuse-'));
  writeFileSync(join(dir, 'main.swift'), `import AppKit
import Carbon
import ApplicationServices
import ScreenCaptureKit
import UniformTypeIdentifiers
import QuartzCore
var presentations = 0
var events: [[String: Any]] = []
func emit(_ message: [String: Any]) { events.append(message) }
func answer(_ id: String, _ result: [String: Any]) { emit(["id": id, "result": result]) }
func failure(_ id: String, _ code: String) { emit(["id": id, "error": code]) }
${implementation}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
func check(_ value: Bool, _ name: String) {
    if !value { fputs("Input lifecycle failed: \\(name)\\n", stderr); exit(1) }
}
let controller = Controller()
controller.enabled = true
let inputEmote: [String: Any] = ["action": "new", "promptMode": "input", "label": "Example"]
func open(_ id: String, _ gesture: String) -> Bool {
    controller.openInput(["id": id, "gestureId": gesture, "prompt": "", "label": "Example"])["current"] as? Bool == true
}
controller.prepareInput(for: inputEmote, gestureId: "first")
check(open("first", "first"), "initial input")
let panel = controller.promptPanel!
panel.input.selectText(nil)
guard let editor = panel.input.currentEditor() as? NSTextView else { fatalError("Missing editor") }
editor.string = "Already typing "
editor.setSelectedRange(NSRange(location: editor.string.utf16.count, length: 0))
editor.setMarkedText("你好", selectedRange: NSRange(location: 2, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
let text = editor.string, selection = editor.selectedRange()
var previous = "first"
for index in 0..<20 {
    let latest = "rapid-\\(index)"
    controller.prepareInput(for: inputEmote, gestureId: latest)
    check(panel.operationId == nil && !panel.sendButton.isEnabled, "cannot submit with old capture")
    panel.sendInput()
    check(!open(previous, previous), "late request rejected")
    controller.command(["id": "stale-close", "method": "closeInput", "params": ["id": previous, "gestureId": previous]])
    check(controller.promptPanel === panel, "old close cannot clear current editor")
    check(open(latest, latest), "latest request accepted")
    check(controller.promptPanel === panel && presentations == 1, "reuse without reappearing or focus steal")
    check(panel.input.currentEditor() === editor && editor.string == text && editor.selectedRange() == selection && editor.hasMarkedText(), "draft and IME preserved")
    previous = latest
}
editor.unmarkText()
panel.updateSendButton()
panel.sendButton.performClick(nil)
let afterSubmit = events.count
panel.resignKey()
check(events.count == afterSubmit, "confirmed send never becomes cancellation")
let sent = events.filter { $0["kind"] as? String == "input-submit" }
check(sent.count == 1 && sent[0]["id"] as? String == "rapid-19" && sent[0]["text"] as? String == text, "submit only latest")
check(controller.promptPanel == nil, "submit releases editor")
controller.prepareInput(for: inputEmote, gestureId: "again")
check(open("again", "again") && controller.promptPanel?.text == "", "new input is blank")
controller.prepareInput(for: inputEmote, gestureId: "cancel-before-capture")
controller.promptPanel?.cancelInput()
check(controller.promptPanel == nil && controller.pendingGestureId == nil, "cancel waiting capture")
check(events.last?["kind"] as? String == "cancel-action" && events.last?["gestureId"] as? String == "cancel-before-capture", "cancel latest gesture")
check(!open("cancelled", "cancel-before-capture") && presentations == 2, "late callback never reopens")
controller.prepareInput(for: inputEmote, gestureId: "failure")
check(open("failure", "failure"), "next input")
controller.prepareInput(for: inputEmote, gestureId: "failed-capture")
controller.command(["id": "close-failure", "method": "closeInput", "params": ["id": "new-operation", "gestureId": "failed-capture"]])
check(controller.promptPanel == nil && controller.pendingGestureId == nil, "failed capture closes unbound editor")
controller.prepareInput(for: inputEmote, gestureId: "display")
check(open("display", "display"), "input before display")
controller.prepareInput(for: ["action": "none", "promptMode": "input"], gestureId: "display-only")
check(controller.promptPanel == nil && controller.pendingGestureId == nil, "display cancels without input")
check(!open("stale", "display"), "display prevents reopening")
for composing in [false, true] {
    let gesture = composing ? "blur-composing" : "blur"
    controller.prepareInput(for: inputEmote, gestureId: gesture)
    check(open(gesture, gesture), "input before blur")
    let blurred = controller.promptPanel!
    blurred.input.selectText(nil)
    guard let fieldEditor = blurred.input.currentEditor() as? NSTextView else { fatalError("Missing editor") }
    fieldEditor.string = "Unsent text"
    if composing {
        fieldEditor.setMarkedText("你好", selectedRange: NSRange(location: 2, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
        check(blurred.isComposing, "composition before blur")
    }
    let cancels = events.filter { $0["kind"] as? String == "cancel-action" }.count
    let sends = events.filter { $0["kind"] as? String == "input-submit" }.count
    blurred.resignKey()
    check(controller.promptPanel == nil && controller.pendingGestureId == nil && blurred.text.isEmpty, "blur clears input and pending action")
    check(events.last?["kind"] as? String == "cancel-action" && events.last?["gestureId"] as? String == gesture, "blur cancels latest action")
    blurred.resignKey()
    check(events.filter { $0["kind"] as? String == "cancel-action" }.count == cancels + 1, "blur cancels once")
    check(events.filter { $0["kind"] as? String == "input-submit" }.count == sends, "blur never submits")
    check(!open(gesture, gesture), "blur prevents late reopening")
}
for withInput in [false, true] {
    let pending = withInput ? "waiting-input" : "waiting-preset"
    controller.prepareInput(for: withInput ? inputEmote : ["action": "new", "promptMode": "preset"], gestureId: pending)
    if withInput { check(open(pending, pending), "input before reopening wheel") }
    controller.inputActive = true
    controller.gesture = .wheel
    controller.wheelGestureId = "reopened"
    controller.triggerDown = true
    controller.heldKeys.insert(CGKeyCode(kVK_ANSI_G))
    let cancels = events.filter { $0["kind"] as? String == "cancel-action" }.count
    let esc = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_Escape), keyDown: true)!
    esc.flags = [.maskCommand]
    check(controller.handleInput(.keyDown, event: esc), "wheel Esc swallowed with shortcut still held")
    check(controller.gesture == .cancelled && controller.wheelGestureId == nil, "Esc closes reopened wheel")
    check(controller.pendingGestureId == nil && controller.promptPanel == nil, "wheel Esc clears prior waiting action")
    check(events.last?["kind"] as? String == "cancel-action" && events.last?["gestureId"] as? String == pending, "wheel Esc cancels previous send")
    let release = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_G), keyDown: false)!
    release.flags = []
    _ = controller.handleInput(.keyUp, event: release)
    check(!events.contains { $0["kind"] as? String == "trigger" }, "release after Esc cannot send")
    check(events.filter { $0["kind"] as? String == "cancel-action" }.count == cancels + 1, "wheel Esc cancels once")
}
controller.gesture = .wheel
controller.inputActive = true
let noPendingEsc = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_Escape), keyDown: true)!
let cancelCount = events.filter { $0["kind"] as? String == "cancel-action" }.count
check(controller.handleInput(.keyDown, event: noPendingEsc), "wheel Esc without pending action")
check(events.filter { $0["kind"] as? String == "cancel-action" }.count == cancelCount, "no cancellation without prior send")
print("Native input lifecycle cases passed")
`);
  execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-module-cache-path', join(dir, 'module-cache'), join(dir, 'main.swift'), '-o', join(dir, 'check')], { timeout: 90000 });
  assert.match(execFileSync(join(dir, 'check'), { encoding: 'utf8', timeout: 15000 }), /cases passed/);
});

test('settings and Agent writes share revision checks before any native or state mutation', async () => {
  const h = await host();
  const initial = await h.api.queueSetting('load');
  const changed = clone(initial.config); changed.emotes[0].label = 'Agent label';
  const next = await h.api.queueSetting('configure', { config: changed, revision: initial.revision });
  assert.notEqual(next.revision, initial.revision);
  const count = h.calls.length;
  await assert.rejects(h.api.queueSetting('save', { config: initial.config, revision: initial.revision }), /STALE_REVISION/);
  assert.deepEqual(h.calls.slice(count).map(call => call.method), ['configRevision']);
  const latest = await h.api.queueSetting('load');
  assert.equal(latest.config.emotes[0].label, 'Agent label');
  const uiEdit = clone(latest.config); uiEdit.emotes[1].label = 'UI label';
  await h.api.queueSetting('save', { config: uiEdit, revision: latest.revision });
  await assert.rejects(h.api.queueSetting('configure', { config: changed, revision: next.revision }), /STALE_REVISION/);
  assert.equal(h.stored().config.emotes[1].label, 'UI label');
  assert.equal(h.calls.some(call => call.method === 'send'), false);
});

test('failed settings persistence restores the previous config and native runtime', async () => {
  let fail = false;
  const h = await host({ failWrite: () => fail });
  const initial = await h.api.queueSetting('load');
  const next = clone(initial.config); next.emotes[0].label = 'Unsaved'; fail = true;
  await assert.rejects(h.api.queueSetting('save', { config: next, revision: initial.revision }), /SAVE_FAILED/);
  assert.deepEqual(clone(h.api.inspect().state.config), initial.config);
  assert.equal(h.calls.filter(call => call.method === 'configure').at(-1).params.emotes[0].label, initial.config.emotes[0].label);
});

test('delivery separates instructions from window context, retaining attachments, queue/steer and no capture in KV', async () => {
  for (const delivery of ['queue', 'steer']) for (const kind of ['task', 'bot']) {
    const h = await host(); const emote = { ...sendEmote(), delivery };
    emote.action = kind === 'bot' ? 'bot' : 'existing'; emote.target.ref.kind = kind;
    h.api.invalidate(delivery); await h.api.dispatch({ id: delivery, emote, target: emote.target.ref });
    const sent = h.calls.find(call => call.method === 'send').params;
    assert.equal(sent.delivery, delivery); assert.deepEqual(sent.target, emote.target.ref);
    assert.deepEqual(sent.attachments, [{ name: 'window.jpg', base64: h.snapshot.jpeg }]);
    assert.equal(sent.text, emote.prompt); assert.ok(sent.context.includes(h.snapshot.text));
    assert.ok(sent.context.includes(JSON.stringify(h.snapshot.source.target)));
    assert.ok(sent.context.includes(JSON.stringify(h.snapshot.source.point)));
    assert.equal(sent.context.includes(emote.prompt), false);
    assert.equal('route' in sent, false); assert.equal('title' in sent, false); assert.equal('autoTitle' in sent, false);
    assert.equal(JSON.stringify(h.writes).includes(h.snapshot.text), false);
    assert.equal(JSON.stringify(h.writes).includes(h.snapshot.jpeg), false);
    assert.equal(h.stored().pending, null);
  }
});

test('new conversations use automatic titles and both task APIs separate instructions and context', async () => {
  for (const target of [true, false]) for (const action of ['new', 'existing']) {
    if (target && action !== 'new') continue; // Existing destinations are covered above.
    const h = await host({ create: async () => ({ taskId: 'created-task', status: 'active', title: 'Example', revision: 1 }) });
    const emote = { ...sendEmote(), action, target: undefined, taskId: 'fixture-legacy',
      ...(action === 'new' ? { permissionMode: 'auto' } : {}) };
    const id = `${target}-${action}`;
    h.api.invalidate(id);
    await h.api.dispatch({ id, emote, ...(target ? { target: { kind: 'project', id: 'fixture-project' } } : {}) });
    const sent = h.calls.find(call => call.method === (target ? 'send' : 'taskSend')).params;
    assert.equal(sent.text, emote.prompt);
    assert.ok(sent.context.includes(h.snapshot.text));
    assert.ok(sent.context.includes(JSON.stringify(h.snapshot.source.target)));
    assert.deepEqual(sent.attachments, [{ name: 'window.jpg', base64: h.snapshot.jpeg }]);
    assert.equal('title' in sent, false);
    assert.equal(sent.requestKey, target ? id : `${id}-send`);
    if (action === 'new') {
      const creation = target ? sent : h.calls.find(call => call.method === 'create').params;
      assert.equal(creation.autoTitle, true); assert.equal('title' in creation, false);
      assert.equal(creation.permissionMode, 'auto');
      assert.equal(creation.requestKey, target ? id : `${id}-create`);
    } else {
      assert.equal(h.calls.some(call => call.method === 'create'), false);
      assert.equal('autoTitle' in sent, false);
    }
    assert.equal(JSON.stringify(h.writes).includes(h.snapshot.text), false);
    assert.equal(JSON.stringify(h.writes).includes(h.snapshot.jpeg), false);
  }
});

test('missing message context support stops both APIs before creating or sending anything', async () => {
  const info = clone(await (await host()).api.capabilities()); delete info.messageContext;
  for (const target of [true, false]) for (const action of ['new', 'existing']) {
    const h = await host({ capabilities: info });
    const emote = { ...sendEmote(), action, taskId: 'fixture-legacy', target: undefined };
    h.api.invalidate('context-unsupported');
    await assert.rejects(h.api.dispatch({ id: 'context-unsupported', emote,
      ...(target ? { target: { kind: action === 'new' ? 'project' : 'task', id: 'fixture-target' } } : {}) }), /MESSAGE_CONTEXT_UNSUPPORTED/);
    assert.equal(h.calls.some(call => ['create', 'send', 'taskSend', 'beginDispatch'].includes(call.method)), false);
    assert.equal(h.stored().pending, null); assert.equal(h.api.inspect().recovered, false);
  }
});

test('missing automatic title support blocks new tasks without affecting existing conversations', async () => {
  const info = clone(await (await host()).api.capabilities()); delete info.autoTitle;
  for (const target of [true, false]) {
    const h = await host({ capabilities: info });
    const emote = { ...sendEmote(), action: 'new', target: undefined };
    h.api.invalidate('title-unsupported');
    await assert.rejects(h.api.dispatch({ id: 'title-unsupported', emote,
      ...(target ? { target: { kind: 'project', id: 'fixture-project' } } : {}) }), /AUTO_TITLE_UNSUPPORTED/);
    assert.equal(h.calls.some(call => ['create', 'send', 'taskSend', 'beginDispatch'].includes(call.method)), false);
    assert.equal(h.stored().pending, null); assert.equal(h.api.inspect().recovered, false);
    emote.action = 'existing'; emote.taskId = 'fixture-legacy';
    h.api.invalidate('existing');
    await h.api.dispatch({ id: 'existing', emote,
      ...(target ? { target: { kind: 'task', id: 'fixture-task' } } : {}) });
    const sent = h.calls.find(call => call.method === (target ? 'send' : 'taskSend')).params;
    assert.equal(sent.text, emote.prompt); assert.equal('title' in sent || 'autoTitle' in sent, false);
  }
});

test('window context stays bounded without clipping user instructions or splitting surrogate pairs', async () => {
  const h = await host();
  h.snapshot.text = '😀'.repeat(20000);
  const emote = { ...sendEmote(), prompt: 'Original instructions '.repeat(350) };
  h.api.invalidate('bounded'); await h.api.dispatch({ id: 'bounded', emote, target: emote.target.ref });
  const sent = h.calls.find(call => call.method === 'send').params;
  assert.equal(sent.text, emote.prompt);
  assert.ok(sent.context.length <= 32768);
  assert.ok(sent.text.length + sent.context.length <= 64000);
  assert.match(sent.context, /\n\[窗口文本过长，已截断\]$/);
  assert.equal(/\p{Surrogate}/u.test(sent.context), false);
});

test('missing image capability never silently drops an available screenshot', async () => {
  const h = await host({ capabilities: { operations: ['create', 'get', 'list', 'send', 'getRun', 'cancel'], messageContext: true } });
  const emote = sendEmote(); h.api.invalidate('image');
  await assert.rejects(h.api.dispatch({ id: 'image', emote, target: emote.target.ref }), /ATTACHMENTS_UNSUPPORTED/);
  assert.equal(h.calls.some(call => call.method === 'send'), false); assert.equal(h.stored().pending, null);
});

test('late receipts withdraw only the old input and do not report the newer emote as sent', async () => {
  const entered = deferred(), receipt = deferred();
  const h = await host({ send: () => { entered.resolve(); return receipt.promise; } });
  const emote = sendEmote(); h.api.invalidate('old');
  const dispatch = h.api.dispatch({ id: 'old', emote, target: emote.target.ref }); await entered.promise;
  h.api.invalidate('display-only'); await settle();
  receipt.resolve({ taskId: 'fixture-task', accepted: true, delivery: 'queue' }); await dispatch;
  assert.ok(h.calls.filter(call => call.method === 'cancel').every(call => call.params.requestKey === 'old'));
  assert.equal(h.events.some(event => event.outcome?.phase === 'sent'), false);
});

test('uncertain sends stay paused across withdrawal, restart and subsequent triggers until acknowledged', async () => {
  const entered = deferred(), receipt = deferred();
  const h = await host({ send: () => { entered.resolve(); return receipt.promise; } });
  const emote = sendEmote(); h.api.invalidate('uncertain');
  const dispatch = h.api.dispatch({ id: 'uncertain', emote, target: emote.target.ref }); await entered.promise;
  h.api.invalidate('display-only'); await settle();
  receipt.reject(new Error('DELIVERY_UNCERTAIN')); await assert.rejects(dispatch, /DELIVERY_UNCERTAIN/);
  assert.equal(h.stored().pending.id, 'uncertain');
  h.api.invalidate('display-again'); await settle(); assert.equal(h.stored().pending.id, 'uncertain');
  const restarted = await host({ saved: h.stored() });
  restarted.api.invalidate('new');
  await assert.rejects(restarted.api.dispatch({ id: 'new', emote, target: emote.target.ref }), /CHECK_PREVIOUS_TASK/);
  assert.equal(restarted.calls.some(call => call.method === 'send'), false);
  const status = await restarted.api.queueSetting('reviewed'); assert.equal(status.needsReview, false);
  assert.equal(restarted.stored().pending, null);
});

test('a definite delivery rejection is not retried and does not become an uncertain send', async () => {
  const h = await host({ send: async () => { throw new Error('DELIVERY_REJECTED'); } });
  const emote = sendEmote(); h.api.invalidate('rejected');
  await assert.rejects(h.api.dispatch({ id: 'rejected', emote, target: emote.target.ref }), /DELIVERY_REJECTED/);
  assert.equal(h.calls.filter(call => call.method === 'send').length, 1);
  assert.equal(h.api.inspect().recovered, false); assert.equal(h.stored().pending, null);
});

test('restart before a withdrawn send returns retains the unresolved input', async () => {
  const entered = deferred(), receipt = deferred();
  const h = await host({ send: () => { entered.resolve(); return receipt.promise; } });
  const emote = sendEmote(); h.api.invalidate('in-flight');
  const dispatch = h.api.dispatch({ id: 'in-flight', emote, target: emote.target.ref }); await entered.promise;
  h.api.invalidate('display-only'); await settle();
  const disk = h.stored();
  receipt.resolve({ taskId: 'fixture-task', accepted: true, delivery: 'queue' }); await dispatch;
  assert.equal(disk.pending?.id, 'in-flight');
  const restarted = await host({ saved: disk }); restarted.api.invalidate('next');
  await assert.rejects(restarted.api.dispatch({ id: 'next', emote, target: emote.target.ref }), /CHECK_PREVIOUS_TASK/);
  assert.equal(restarted.calls.some(call => call.method === 'send'), false);
});

test('a new delivery waits for withdrawal of the previous accepted input', async () => {
  const withdrawal = deferred();
  const h = await host({ cancel: () => withdrawal.promise });
  const emote = sendEmote(); h.api.invalidate('first');
  await h.api.dispatch({ id: 'first', emote, target: emote.target.ref });
  h.api.invalidate('next');
  const next = h.api.dispatch({ id: 'next', emote, target: emote.target.ref }); await settle();
  const beforeReceipt = h.calls.filter(call => call.method === 'send').length;
  const disk = h.stored();
  withdrawal.resolve({ cancelled: true, runningWorkMayHaveStarted: true }); await next;
  assert.equal(beforeReceipt, 1);
  assert.equal(disk.pending?.id, 'first');
  assert.equal(h.calls.filter(call => call.method === 'send').length, 2);
});

test('an unknown withdrawal blocks a new delivery and survives restart', async () => {
  const withdrawal = deferred();
  const h = await host({ cancel: () => withdrawal.promise });
  const emote = sendEmote(); h.api.invalidate('first');
  await h.api.dispatch({ id: 'first', emote, target: emote.target.ref });
  h.api.invalidate('next');
  const next = h.api.dispatch({ id: 'next', emote, target: emote.target.ref });
  const rejected = assert.rejects(next, /DELIVERY_UNCERTAIN|CHECK_PREVIOUS_TASK/);
  await settle(); withdrawal.reject(new Error('DELIVERY_UNCERTAIN')); await rejected;
  assert.equal(h.calls.filter(call => call.method === 'send').length, 1);
  assert.equal(h.stored().pending.id, 'first');
  assert.equal(h.api.inspect().recovered, true);
  const restarted = await host({ saved: h.stored() });
  assert.equal((await restarted.api.queueSetting('load')).needsReview, true);
});

test('a legacy task created after supersession remains recorded for review', async () => {
  const entered = deferred(), creation = deferred();
  const h = await host({ create: () => { entered.resolve(); return creation.promise; } });
  const emote = { ...sendEmote(), action: 'new', target: undefined }; h.api.invalidate('creating');
  const dispatch = h.api.dispatch({ id: 'creating', emote });
  const rejected = assert.rejects(dispatch, /CHECK_PREVIOUS_TASK/);
  await entered.promise; h.api.invalidate('display-only');
  creation.resolve({ taskId: 'created-task', status: 'active', title: 'Example', revision: 1 }); await rejected;
  assert.equal(h.stored().pending.taskId, 'created-task');
  assert.equal(h.api.inspect().recovered, true);
  assert.equal(h.calls.some(call => call.method === 'send'), false);
  const restarted = await host({ saved: h.stored() });
  assert.equal((await restarted.api.queueSetting('load')).pending.taskId, 'created-task');
});

test('recent destinations are limited to three and a closed wheel ignores a late catalog', async () => {
  const config = defaults(); config.emotes[0] = { ...sendEmote(config), target: { mode: 'recent' } };
  const result = deferred(); const h = await host({ saved: { config }, list: () => result.promise });
  await h.event({ kind: 'wheel-open', gestureId: 'closed', configRevision: 'example' });
  await h.event({ kind: 'wheel-closed', gestureId: 'closed' });
  const targets = Array.from({ length: 5 }, (_, i) => ({ kind: 'task', id: `task-${i}`, label: `Task ${i}`, detail: '' }));
  result.resolve({ targets }); await settle();
  assert.equal(h.calls.some(call => call.method === 'wheelTargets'), false);
  await h.event({ kind: 'wheel-open', gestureId: 'current', configRevision: 'example' }); await settle();
  const catalog = h.calls.find(call => call.method === 'wheelTargets').params;
  assert.equal(catalog.gestureId, 'current'); assert.deepEqual(catalog.catalogs.task, targets.slice(0, 3));
});

test('native text matching rejects missing, replaced and ambiguous original windows', { skip: process.platform !== 'darwin' }, () => {
  const swift = source('native/EmoteHelper.swift');
  const match = swift.slice(swift.indexOf('func sameWindow('), swift.indexOf('func isSecure('));
  const dir = mkdtempSync(join(tmpdir(), 'ping-window-'));
  const code = `import AppKit
import ApplicationServices
var listedWindows: [[String: Any]] = []
let element = AXUIElementCreateApplication(12345)
var frame = CGRect(x: 10, y: 20, width: 500, height: 400)
var axFrame = frame
func axElement(_ element: AXUIElement, _ attribute: CFString) -> AXUIElement? { element }
func axValue(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
    if attribute as String == kAXPositionAttribute { var p = axFrame.origin; return AXValueCreate(.cgPoint, &p) }
    var size = axFrame.size; return AXValueCreate(.cgSize, &size)
}
func CGWindowListCopyWindowInfo(_ options: CGWindowListOption, _ id: CGWindowID) -> CFArray? { listedWindows as CFArray }
func window(_ id: UInt32, _ pid: Int32 = 12345) -> [String: Any] {
    [kCGWindowNumber as String: id, kCGWindowOwnerPID as String: pid, kCGWindowLayer as String: 0,
     kCGWindowBounds as String: frame.dictionaryRepresentation]
}
let target: [String: Any] = ["windowId": UInt32(1), "pid": Int32(12345), "bounds": frame.dictionaryRepresentation]
${match}
func check(_ expected: Bool, _ name: String) {
    if sameWindow(element, target) != expected { fputs("Window identity failed: \\(name)\\n", stderr); exit(1) }
}
listedWindows = [window(1)]; check(true, "original")
listedWindows = []; check(false, "closed")
listedWindows = [window(2)]; check(false, "same bounds replacement")
listedWindows = [window(1), window(2)]; check(false, "ambiguous same-app windows")
listedWindows = [window(1, 54321)]; check(false, "different process")
listedWindows = [window(1), window(2, 54321)]; check(true, "unrelated process")
axFrame.origin.x += 40; check(false, "different AX window")
print("Native window identity cases passed")
`;
  writeFileSync(join(dir, 'main.swift'), code);
  execFileSync('xcrun', ['swiftc', '-module-cache-path', join(dir, 'module-cache'), join(dir, 'main.swift'), '-o', join(dir, 'check')], { timeout: 90000 });
  assert.match(execFileSync(join(dir, 'check'), { encoding: 'utf8', timeout: 10000 }), /cases passed/);
});

test('settings adopt normalized saves without overwriting a newer incomplete draft', async () => {
  const settings = source('settings.js');
  const apply = settings.slice(settings.indexOf('async function applyChanges()'), settings.indexOf('function renderOutcome('));
  for (const editDuringSave of [false, true]) {
    const initial = defaults(); initial.emotes[0].prompt = 'Previously configured instruction';
    const receipt = deferred(), entered = deferred();
    const fields = new Map([['#retry', { hidden: true }], ['#shortcut-label', {}],
      ['#emote-name', { value: initial.emotes[0].label }]]);
    const context = vm.createContext({ initial, document: { activeElement: null },
      $: selector => fields.get(selector), EmoteShortcuts: { label: () => 'Command+G' },
      rpc: async (_, { config }) => { entered.resolve(config); return receipt.promise; },
      valid: config => { try { validateConfig(config); return true; } catch { return false; } },
      L: (_, en) => en, feedback: () => {}, report: error => { throw error; },
      applyStatus: () => {}, renderWheel: () => {}, renderValidation: () => {},
    });
    vm.runInContext(`let config=initial, slots=initial.emotes, shortcut=initial.wheelShortcut, selected=0;
      let configRevision='before', editRevision=1, appliedRevision=0, saving=false;
      const original=slots[0];
      const draftConfig=()=>({version:2,emotes:slots,wheelShortcut:shortcut});
      const completeDraft=()=>valid(draftConfig());
      ${apply}
      globalThis.api={applyChanges,inspect:()=>({slots,config,sameObject:slots[0]===original}),
        edit:()=>{slots[0].action='existing';slots[0].target={mode:'recent'};slots[0].prompt='';editRevision++;}};`, context);
    const saving = context.api.applyChanges(); const sent = await entered.promise;
    if (editDuringSave) context.api.edit();
    receipt.resolve({ config: validateConfig(sent), revision: 'after', outcome: { phase: 'configured' } }); await saving;
    const result = context.api.inspect();
    assert.equal(result.slots[0].prompt, '');
    assert.equal(result.slots[0].action, editDuringSave ? 'existing' : 'none');
    assert.equal(result.sameObject, true);
    assert.equal(result.config.emotes[0].action, 'none');
  }
});

// Production picker filtering and click handler: the old native select had no search
// or hidden-model policy. Keep source identity and per-emote tuning across selections.
function modelPickerFixture(emotes = []) {
  const settings = source('settings.js');
  const filter = settings.slice(settings.indexOf('function filterModelOptions('), settings.indexOf('function closeModelPicker('));
  const same = settings.match(/^const sameModel = .*$/m)[0];
  const engine = settings.match(/^const modelEngineName = .*$/m)[0];
  let writes = 0;
  const context = vm.createContext({ slots: emotes, selected: 0, modelPicker: { open: true },
    renderModels: () => {}, change: () => { writes++; }, $: () => ({ focus() {} }) });
  vm.runInContext(`${same}\n${engine}\n${filter}\nglobalThis.api={filterModelOptions,chooseModel};`, context);
  return { ...context.api, writes: () => writes };
}
test('model picker searches every source and keeps hidden current routes visible', () => {
  const f = modelPickerFixture();
  const model = (agentKind, providerId, visible = true) => ({
    route: { agentKind, providerId, model: 'example-model', effort: 'medium', fastMode: false },
    details: { name: 'Example Model', providerName: providerId, visible },
  });
  const items = [model('cc', 'Primary'), model('codex', 'Secondary'), model('pi', 'Hidden', false)];
  const state = { query: '', engine: 'cc', hidden: false };
  assert.deepEqual(f.filterModelOptions(items, state), [items[0]]);
  assert.deepEqual(f.filterModelOptions(items, { ...state, query: 'MODEL secondary' }), [items[1]]);
  assert.deepEqual(f.filterModelOptions(items, { ...state, engine: 'all' }), items.slice(0, 2));
  assert.deepEqual(f.filterModelOptions(items, { ...state, engine: 'all' }, items[2].route), items);
  assert.deepEqual(f.filterModelOptions(items, { ...state, engine: 'all', hidden: true }), items);
  assert.deepEqual(f.filterModelOptions(items, { ...state, query: 'missing' }), []);
});
test('model picker preserves tuning on reselection and changes only the selected emote', () => {
  const route = { agentKind: 'codex', providerId: 'primary', model: 'example', effort: 'high', fastMode: 'ultrafast' };
  const emotes = [{ route: clone(route) }, { route: null }];
  const f = modelPickerFixture(emotes);
  f.chooseModel(emotes[0], { route: { ...route, effort: 'medium', fastMode: false },
    efforts: ['medium', 'high'], supportsFastMode: true });
  assert.deepEqual(emotes[0].route, route);
  assert.equal(f.writes(), 0);
  const option = { route: { ...route, providerId: 'secondary', effort: 'low', fastMode: false } };
  f.chooseModel(emotes[0], option);
  assert.deepEqual(clone(emotes[0].route), option.route);
  assert.notEqual(emotes[0].route, option.route);
  assert.equal(emotes[1].route, null);
  assert.equal(f.writes(), 1);
  f.chooseModel(emotes[1], { route });
  assert.equal(emotes[1].route, null);
  assert.equal(f.writes(), 1);
  f.chooseModel(emotes[0], null);
  assert.equal(emotes[0].route, null);
  assert.equal(f.writes(), 2);
});

test('reselecting a model repairs tuning that its provider no longer supports', () => {
  const route = { agentKind: 'codex', providerId: 'primary', model: 'example', effort: 'medium', fastMode: false };
  const option = { route, efforts: ['low', 'medium', 'high'], supportsFastMode: false };
  for (const changed of [{ effort: 'retired' }, { fastMode: true }]) {
    const emotes = [{ route: { ...route, ...changed } }];
    const f = modelPickerFixture(emotes);
    f.chooseModel(emotes[0], option);
    assert.deepEqual(clone(emotes[0].route), route);
    assert.equal(f.writes(), 1);
    f.chooseModel(emotes[0], option);
    assert.equal(f.writes(), 1, 'valid defaults stay unchanged on the next selection');
  }
});

test('approved settings: legacy dynamic destinations normalize to recent for every kind', () => {
  for (const action of ['new', 'existing', 'bot']) {
    const config = defaults();
    config.emotes[0] = { ...sendEmote(config), action, target: { mode: 'pick' }, pinAngle: 0 };
    const emote = migrateConfig(config).emotes[0];
    assert.equal(emote.target.mode, 'recent');
    assert.equal(emote.pinAngle, 0);
    assert.equal(emote.prompt, config.emotes[0].prompt);
  }
});

test('approved settings: only new conversations retain model and permission overrides', () => {
  const route = { agentKind: 'codex', providerId: 'primary', model: 'example', effort: 'high', fastMode: false };
  for (const action of ['new', 'existing', 'bot']) {
    const config = defaults();
    config.emotes[0] = { ...sendEmote(config), action, target: { mode: 'recent' }, route, permissionMode: 'bypassPermissions' };
    const emote = validateConfig(config).emotes[0];
    assert.deepEqual(emote.route, action === 'new' ? route : null);
    assert.equal(emote.permissionMode, action === 'new' ? 'bypassPermissions' : undefined);
  }
  for (const permissionMode of ['ask', 'auto', 'bypassPermissions']) {
    const config = defaults();
    config.emotes[0] = { ...sendEmote(config), action: 'new', target: { mode: 'recent' }, permissionMode };
    assert.equal(validateConfig(config).emotes[0].permissionMode, permissionMode);
  }
  const invalid = defaults();
  invalid.emotes[0] = { ...sendEmote(invalid), action: 'new', target: { mode: 'recent' }, permissionMode: 'invalid' };
  assert.throws(() => validateConfig(invalid), /CONFIG_INVALID/);
});

test('approved settings: every dynamic destination sends at most three recent choices', async () => {
  const config = defaults();
  for (const [index, action] of ['new', 'existing', 'bot'].entries()) {
    config.emotes[index] = { ...sendEmote(config), ...config.emotes[index], action, prompt: 'Inspect this example.', target: { mode: 'pick' } };
  }
  const h = await host({ saved: { config, pending: null }, list: async ({ targetKind }) => ({ targets:
    Array.from({ length: 7 }, (_, index) => ({ kind: targetKind, id: `${targetKind}-${index}`, label: `Example ${index}`, detail: '' })) }) });
  h.event({ kind: 'wheel-open', gestureId: 'three-choices', configRevision: 'fixture' });
  await settle(); await settle();
  const catalogs = h.calls.find(call => call.method === 'wheelTargets').params.catalogs;
  for (const kind of ['project', 'task', 'bot']) {
    assert.equal(catalogs[kind].length, 3);
    assert.equal(catalogs[kind][2].id, `${kind}-2`);
  }
});

test('approved settings: new conversation permissions reach the public target API', async () => {
  for (const permissionMode of ['ask', 'auto', 'bypassPermissions']) {
    const h = await host();
    const emote = { ...sendEmote(), action: 'new', permissionMode, target: { mode: 'fixed', ref: { kind: 'project', id: 'fixture-project' }, label: 'Example project' } };
    h.api.invalidate(permissionMode);
    await h.api.dispatch({ id: permissionMode, emote, target: emote.target.ref });
    assert.equal(h.calls.find(call => call.method === 'send').params.permissionMode, permissionMode);
  }
});

test('approved settings: unsupported permission selection never silently falls back or sends', async () => {
  const h = await host({ capabilities: { operations: ['create', 'get', 'list', 'send', 'getRun', 'cancel', 'models'], messageAttachments: { kinds: ['image'] } } });
  const emote = { ...sendEmote(), action: 'new', permissionMode: 'bypassPermissions' };
  h.api.invalidate('unsupported-permission');
  await assert.rejects(h.api.dispatch({ id: 'unsupported-permission', emote, target: { kind: 'project', id: 'fixture-project' } }), /PERMISSION_MODE_UNSUPPORTED/);
  assert.equal(h.calls.some(call => ['create', 'send'].includes(call.method)), false);
});

test('approved settings: a legacy conversation binding never changes its current model', async () => {
  const route = { agentKind: 'codex', providerId: 'primary', model: 'example', effort: 'medium', fastMode: false };
  const h = await host({ modelCatalog: [{ route, efforts: ['medium'], supportsFastMode: false }] });
  const emote = { ...sendEmote(), taskId: 'fixture-legacy', route };
  delete emote.target;
  h.api.invalidate('legacy-model');
  await h.api.dispatch({ id: 'legacy-model', emote });
  assert.equal(h.calls.some(call => call.method === 'setModel'), false);
  assert.equal(h.calls.find(call => call.method === 'taskSend').params.taskId, 'fixture-legacy');
});
