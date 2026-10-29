'use strict';
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateConfig, migrateConfig } = require('./config.cjs');
const shortcuts = require('../shortcuts.js');
const { LatestAction } = require('./scheduler.cjs');
const library = require('../emote-library.js');
const bundledImages = new Set(library.presets().map(item => item.imagePath));

const write = message => process.stdout.write(JSON.stringify(message) + '\n');
const notify = (kind, data) => write({ jsonrpc: '2.0', method: 'emote/event', params: { kind, ...data } });
const nativePath = path.resolve(__dirname, '../native/Cindy Ping.app/Contents/MacOS/Cindy Ping');
let config = { emotes: [] };
let runtimeEnabled = false;
let child = null;
let starting = null;
let configRevision = '';
let wheelSession = null;
let locale = 'en';
let nativeOperation = null;
const pending = new Map();
function actionEvent(kind, data) {
  if (kind === 'trigger') {
    if (nativeOperation && child && (data.action === 'none' || data.emote.promptMode !== 'input'))
      void nativeRequest('closeInput', nativeOperation).catch(() => {});
    nativeOperation = { id: data.id, gestureId: data.gestureId };
  } else if (['invalidate', 'complete'].includes(kind)) {
    if (data.id && child) void nativeRequest('closeInput', { id: data.id, gestureId: data.gestureId }).catch(() => {});
    if (nativeOperation?.id === data.id) nativeOperation = null;
  }
  notify(kind, data);
  if (kind === 'input-required') {
    void nativeRequest('openInput', { ...data, locale }).then(result => {
      if (!result.current) scheduler.cancel(data.id);
    }, () => {
      if (!scheduler.isCurrent(data.id)) return;
      notify('input-error', { id: data.id, code: 'INPUT_UNAVAILABLE' });
      scheduler.complete(data.id);
    });
  } else if (kind === 'capture-error') scheduler.complete(data.id);
}
const scheduler = new LatestAction({ notify: actionEvent, capture: operation => nativeRequest('capture', {
  event: operation.event, screenshot: operation.emote.screenshot,
}) });

async function startNative() {
  if (starting) return starting;
  if (child) return;
  if (process.platform !== 'darwin') throw new Error('MACOS_REQUIRED');
  starting = (async () => {
    await fs.chmod(nativePath, 0o755);
    await new Promise((resolve, reject) => {
      const processHandle = spawn(nativePath, [], { stdio: ['pipe', 'pipe', 'ignore'] });
      child = processHandle;
      let ready = false;
      const timer = setTimeout(() => { processHandle.kill(); reject(new Error('HELPER_START_FAILED')); }, 8000);
      let buffer = '';
      processHandle.stdout.setEncoding('utf8');
      processHandle.stdout.on('data', data => {
        buffer += data;
        if (buffer.length > 1100000) { processHandle.kill(); return; }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.kind === 'ready') { ready = true; clearTimeout(timer); resolve(); }
          else if (event.kind === 'wheel-open' && runtimeEnabled && event.configRevision === configRevision) {
            wheelSession = { id: event.gestureId, choices: {}, ready: false };
            notify('wheel-open', { gestureId: event.gestureId, configRevision });
          } else if (event.kind === 'wheel-closed') {
            notify('wheel-closed', { gestureId: event.gestureId });
          } else if (event.kind === 'trigger' && runtimeEnabled && event.configRevision === configRevision) {
            const emote = config.emotes.find(item => item.id === event.emoteId);
            if (!emote) continue;
            let selected = emote;
            if (!['none', 'undo'].includes(emote.action) && ['pick', 'recent'].includes(emote.target?.mode)) {
              const target = wheelSession?.id === event.gestureId && Number.isInteger(event.optionIndex)
                ? wheelSession.choices[emote.id]?.[event.optionIndex] : null;
              if (!target || target.kind !== { new: 'project', existing: 'task', bot: 'bot' }[emote.action]) continue;
              selected = { ...emote, target: { mode: 'fixed', ref: { kind: target.kind, id: target.id }, label: target.label } };
            }
            scheduler.trigger(event, selected);
          } else if (event.kind === 'input-submit') {
            if (scheduler.submitInput(event.id, event.text).current)
              void nativeRequest('closeInput', { id: event.id, keepPending: true }).catch(() => {});
          } else if (event.kind === 'input-cancel') {
            scheduler.cancel(event.id);
          } else if (event.kind === 'cancel-action' && scheduler.current?.event.gestureId === event.gestureId) {
            scheduler.cancel(scheduler.current.id);
          } else if (event.id && pending.has(event.id)) {
            const request = pending.get(event.id);
            pending.delete(event.id);
            clearTimeout(request.timer);
            if (event.error) request.reject(new Error(event.error)); else request.resolve(event.result);
          }
        }
      });
      const closed = () => {
        clearTimeout(timer);
        if (child === processHandle) child = null;
        for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('HELPER_STOPPED')); }
        pending.clear();
        scheduler.invalidate();
        if (!ready) reject(new Error('HELPER_START_FAILED'));
        notify('native-stopped', {});
      };
      processHandle.once('error', closed);
      processHandle.once('exit', closed);
      processHandle.stdin.on('error', () => {});
    });
  })();
  try { await starting; } finally { starting = null; }
}
function nativeRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!child || !child.stdin.writable) { reject(new Error('HELPER_STOPPED')); return; }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CAPTURE_TIMEOUT'));
      // A hung native API must not leave an orphan or an unbounded capture queue.
      child?.kill();
    }, method === 'pickImage' ? 120000 : 8000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
function requireCurrent(id) {
  if (!scheduler.isCurrent(id)) throw new Error('SUPERSEDED');
}
function readSnapshot({ id }) {
  requireCurrent(id);
  const snapshot = scheduler.snapshot;
  if (!snapshot || (!snapshot.jpeg && !snapshot.text)) throw new Error('NO_CONTENT');
  return { jpeg: snapshot.jpeg, text: snapshot.text, source: snapshot.source,
    capturedAt: snapshot.capturedAt, issues: snapshot.issues };
}
let configuring = Promise.resolve();
async function execute(method, params) {
  switch (method) {
    case 'defaults': return library.defaults(params.locale);
    case 'validate': return validateConfig(params);
    case 'migrate': return migrateConfig(params);
    case 'configRevision': return { revision: createHash('sha256').update(JSON.stringify(params)).digest('hex') };
    case 'configure': {
      const next = validateConfig(params);
      const apply = async () => {
        scheduler.invalidate();
        wheelSession = null;
        config = next;
        locale = params.locale || 'en';
        runtimeEnabled = params.runtimeEnabled !== false;
        configRevision = randomUUID();
        if (!runtimeEnabled && !child) return { enabled: false };
        await startNative();
        return nativeRequest('configure', { enabled: runtimeEnabled, locale: params.locale, configRevision,
          wheelShortcut: shortcuts.native(config.wheelShortcut),
          emotes: config.emotes.map(({ id, label, emoji, imagePath, action, angle, target, promptMode }) => ({ id, label, emoji, action, angle, promptMode,
            targetMode: !['none', 'undo'].includes(action) ? target?.mode || '' : '',
            targetKind: { new: 'project', existing: 'task', bot: 'bot' }[action] || '',
            imagePath: bundledImages.has(imagePath) ? path.resolve(__dirname, '..', imagePath) : imagePath })) });
      };
      configuring = configuring.then(apply, apply);
      return configuring;
    }
    case 'status':
      // Read the OS preflight result through Cindy's normal child-process chain.
      // This neither requests permissions nor captures any window contents.
      await startNative();
      return { platform: process.platform, nativeRunning: !!child, enabled: runtimeEnabled,
        ...await nativeRequest('status') };
    case 'pickImage':
    case 'previewImages':
    case 'theme': await startNative(); return nativeRequest(method, params);
    case 'wheelTargets': {
      if (!wheelSession || params.gestureId !== wheelSession.id || params.configRevision !== configRevision || wheelSession.ready)
        return { current: false };
      const choices = {}, catalogs = {};
      for (const emote of config.emotes) {
        if (['none', 'undo'].includes(emote.action) || !['pick', 'recent'].includes(emote.target?.mode)) continue;
        const kind = { new: 'project', existing: 'task', bot: 'bot' }[emote.action];
        const rows = params.catalogs?.[kind];
        if (!Array.isArray(rows) || rows.some(row => row.kind !== kind || typeof row.id !== 'string' ||
            !row.id || typeof row.label !== 'string' || typeof row.detail !== 'string')) throw new Error('CONFIG_INVALID');
        if (!catalogs[kind]) catalogs[kind] = rows.slice(0, 3);
        choices[emote.id] = catalogs[kind];
      }
      wheelSession.choices = choices; wheelSession.ready = true;
      return nativeRequest('wheelTargets', { gestureId: params.gestureId, choices: Object.fromEntries(
        Object.entries(catalogs).map(([kind, rows]) => [kind, rows.map(({ label, detail }) => ({ label: label.slice(0, 160), detail: detail.slice(0, 400) }))])) });
    }
    case 'shortcutRecording':
      if (params.active === true) scheduler.invalidate();
      await startNative();
      return nativeRequest('shortcutRecording', { active: params.active === true });
    case 'current': return { current: scheduler.isCurrent(params.id) };
    case 'resolveTarget': return scheduler.resolveTarget(params.id, params.target);
    case 'beginDispatch': {
      const result = scheduler.beginDispatch(params.id);
      if (result.current && child)
        await nativeRequest('closeInput', { id: params.id, gestureId: scheduler.current.event.gestureId });
      return result;
    }
    case 'complete': return scheduler.complete(params.id);
    case 'readSnapshot': return readSnapshot(params);
    case 'wait': await new Promise(resolve => setTimeout(resolve, 500)); return {};
    default: throw new Error('METHOD_UNKNOWN');
  }
}
const input = readline.createInterface({ input: process.stdin });
input.on('line', async line => {
  if (line.length > 262144) return;
  let request;
  try { request = JSON.parse(line); } catch { return; }
  try {
    const result = await execute(request.method, request.params || {});
    write({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'LOCAL_OPERATION_FAILED';
    write({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: code } });
  }
});
function stop() {
  scheduler.invalidate();
  child?.stdin.end();
  child?.kill();
  process.exit(0);
}
input.on('close', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
