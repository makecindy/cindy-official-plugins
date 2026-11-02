import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

// Production tool/event entry points. Bug: shared provider models were absent and a persisted
// remote source was discarded. Existing plugin contract tests only validate manifest shape.
// Minimal fixture: identical local/shared provider+model, one unavailable share. Tier: unit.
const settingsSource = readFileSync(new URL('../decision-gate/settings.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../decision-gate/main.js', import.meta.url), 'utf8');
const model = { id: 'example', name: 'Example', agent: 'codex', providerId: 'account', efforts: ['high'], defaultEffort: 'high' };
function host({ modern = true, fallback = null, settings = false, remoteHang = null } = {}) {
  let handler, stored = { provider: 'openai', rules: [], fallback };
  const sent = [], requests = [], pickerRequests = [];
  let now = 0, nextTimer = 0;
  const timers = new Map(), remoteSignals = [];
  class Element {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.classList = { add() {} }; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute(name, value) { this.attrs[name] = value; }
    get childElementCount() { return this.children.filter((n) => n instanceof Element).length; }
  }
  const root = new Element('root');
  const json = (value) => ({ ok: true, json: async () => structuredClone(value) });
  const context = vm.createContext({ console: { warn() {} }, crypto: webcrypto, AbortController,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    navigator: {},
    document: { documentElement: {}, getElementById: () => root,
      createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag) },
    BroadcastChannel: class { postMessage() {} addEventListener() {} },
    fetch: async (url, options) => {
      requests.push(url);
      if (url === '/app-context') return json({ context: { locale: 'en' } });
      if (url === '/model-picker') {
        pickerRequests.push(JSON.parse(options.body));
        return json({ ok: true, route: { agentKind: 'codex', providerId: 'account', model: 'example', effort: 'high', fastMode: false, agentDeviceId: 'share:one' } });
      }
      if (url === '/kv') {
        if (options?.method === 'PUT') stored = JSON.parse(options.body);
        return json(stored);
      }
      if (url === '/secrets') return json([]);
      if (url === '/models') return json({ ok: true });
      if (url === '/agent-models') return json({ ok: true, models: [model],
        supportsRemoteRoutes: modern, locations: [{ agentDeviceId: 'share:one', name: 'Shared' }, { agentDeviceId: 'share:offline', name: 'Offline' }] });
      if (url.endsWith('share%3Aone')) return json({ ok: true, agentDeviceId: 'share:one', models: [model] });
      if (url.endsWith('share%3Aoffline')) {
        remoteSignals.push(options?.signal);
        if (remoteHang === 'fetch') return new Promise(() => {});
        if (remoteHang === 'body') return { ok: true, json: () => new Promise(() => {}) };
        return json({ ok: false, errorCode: 'NOT_AVAILABLE' });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
    cindy: { request: async () => ({ context: { locale: 'en' } }),
      onHostMessage: (cb) => { handler = cb; }, send: (msg) => sent.push(structuredClone(msg)) },
  });
  vm.runInContext(settings ? settingsSource.replace(/\nboot\(\);\s*$/, '\nglobalThis.ready = boot();') : source, context);
  return { sent, requests, root, pickerRequests, remoteSignals, ready: context.ready, config: () => stored,
    pendingTimers: () => timers.size,
    async tick(ms = 0) {
      now += ms;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await new Promise((resolve) => setImmediate(resolve));
    },
    async tool(tool, args = {}) {
      const callId = `call-${sent.length}`;
      await handler({ type: 'tool-call', callId, tool, args });
      return sent.find((m) => m.callId === callId);
    },
    async event() {
      await handler({ type: 'event', name: 'will-start-task', hookId: 'hook', data: {}, deadline: Date.now() + 8000 });
      return sent.find((m) => m.hookId === 'hook');
    },
  };
}

test('lists share models, requires exact source, saves and returns it in the verdict', async () => {
  const h = host();
  const list = await h.tool('list_rules');
  assert.deepEqual(list.result.availableModels.map((m) => m.agentDeviceId), [null, 'share:one']);
  assert.equal((await h.tool('set_fallback_model', { model: 'example', agent: 'codex', providerId: 'account' })).errorCode, 'MODEL_AMBIGUOUS');
  const saved = await h.tool('set_fallback_model', { model: 'example', agent: 'codex', providerId: 'account', agentDeviceId: 'share:one' });
  assert.equal(saved.ok, true);
  assert.equal(h.config().fallback.agentDeviceId, 'share:one');
  const verdict = await h.event();
  assert.deepEqual(verdict.route, { agentKind: 'codex', providerId: 'account', model: 'example', effort: 'high', agentDeviceId: 'share:one' });
});

test('an explicit local choice stays local when an identical shared model exists', async () => {
  const h = host();
  assert.equal((await h.tool('set_fallback_model', { model: 'example', agent: 'codex', providerId: 'account', agentDeviceId: null })).ok, true);
  assert.equal(h.config().fallback.agentDeviceId, undefined);
  assert.equal((await h.event()).route.agentDeviceId, undefined);
});

test('older hosts preserve local rules and cannot execute a saved share as a local namesake', async () => {
  const h = host({ modern: false, fallback: { agentKind: 'codex', providerId: 'account', model: 'example', agentDeviceId: 'share:one' } });
  assert.equal((await h.tool('list_rules')).result.availableModels.length, 1);
  assert.equal(h.requests.some((url) => url.includes('agent_device_id')), false);
  assert.equal(await h.event(), undefined);
  assert.equal((await h.tool('set_fallback_model', { model: 'example', agentDeviceId: null })).ok, true);
  assert.equal((await h.event()).route.agentDeviceId, undefined);
});

// Settings save is a different production consumer from the Agent tool: exercise the real
// fallback button callback, KV merge and reopening the host picker. No model/service calls.
test('settings save and reopen retain the share source and its display name', async () => {
  const h = host({ settings: true });
  await h.ready;
  const nodes = (node) => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
  const button = () => nodes(h.root).find((node) => node.attrs?.class?.startsWith('mbtn'));
  await button().listeners.click();
  assert.equal(h.config().fallback.agentDeviceId, 'share:one');
  assert.equal(h.config().fallback.locationName, 'Shared');
  await button().listeners.click();
  assert.equal(h.pickerRequests[1].allowRemote, true);
  assert.equal(h.pickerRequests[1].initial.agentDeviceId, 'share:one');
  assert.equal(h.pickerRequests[1].initial.model, 'example');
});

// Bug: one remote fetch/body that never resolves blocks settings boot, listing and saves.
// Existing cases only cover immediate errors. Tier: unit; the real handlers run with a virtual
// clock and a transport that ignores abort, so no wall-clock wait or external service is needed.
for (const remoteHang of ['fetch', 'body']) {
  test(`tools keep local and healthy shared models when a remote ${remoteHang} stalls`, async () => {
    const h = host({ remoteHang });
    const list = h.tool('list_rules');
    let finished = false;
    list.then(() => { finished = true; });
    await h.tick();
    assert.equal(h.pendingTimers(), 1);
    await h.tick(2999);
    assert.equal(finished, false);
    await h.tick(1);
    assert.deepEqual((await list).result.availableModels.map((m) => m.agentDeviceId), [null, 'share:one']);
    assert.equal(h.remoteSignals[0].aborted, true);
    assert.equal(h.pendingTimers(), 0);

    const save = h.tool('set_fallback_model', { model: 'example', agentDeviceId: 'share:one' });
    await h.tick();
    assert.equal(h.pendingTimers(), 1);
    await h.tick(3000);
    assert.equal((await save).ok, true);
    assert.equal(h.config().fallback.agentDeviceId, 'share:one');
    assert.equal(h.pendingTimers(), 0);
  });

  test(`settings boot and save stay usable when a remote ${remoteHang} stalls`, async () => {
    const h = host({ settings: true, remoteHang });
    let finished = false;
    h.ready.then(() => { finished = true; });
    await h.tick();
    assert.equal(h.pendingTimers(), 1);
    await h.tick(2999);
    assert.equal(finished, false);
    await h.tick(1);
    await h.ready;
    assert.equal(h.remoteSignals[0].aborted, true);
    assert.equal(h.pendingTimers(), 0);
    const nodes = (node) => node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
    const button = () => nodes(h.root).find((node) => node.attrs?.class?.startsWith('mbtn'));
    const save = button().listeners.click();
    await h.tick();
    assert.equal(h.pendingTimers(), 1);
    await h.tick(3000);
    await save;
    assert.equal(h.config().fallback.agentDeviceId, 'share:one');
    assert.equal(h.config().fallback.locationName, 'Shared');
    assert.equal(h.pendingTimers(), 0);
  });
}
