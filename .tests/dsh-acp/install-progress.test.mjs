// Run: node --test test/install-progress.test.mjs
//
// Install progress, end to end inside the plugin: the real maintenance runner (cli-maintenance.cjs)
// sends its notifications through a stand-in for Cindy's Node bridge to the real main.js, which
// relays them over BroadcastChannel to the real cli-settings.js. Only the release lookup and the
// install itself are fakes, so no network or real CLI is needed.
//
// Why: before this, the settings page only said "Installing…" for minutes with no sign of life.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dsh-acp');
const require = createRequire(import.meta.url);
const { createMaintenance, stream } = require(path.join(root, 'cli-maintenance.cjs'));
const MAIN = 'main.js';
const CHANNEL = 'dsh-acp';

async function waitFor(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

/** The plugin's logic page with a fake Cindy whose Node bridge runs `maintain` in this process. */
function startMain(t, maintain) {
  const channels = [];
  class TrackedChannel extends BroadcastChannel {
    constructor(name) { super(name); channels.push(this); }
  }
  t.after(() => channels.forEach((channel) => channel.close()));
  const listeners = [];
  const forward = (method, params) => {
    const message = { type: 'event', name: 'node-notification', method, ...(params ? { params } : {}), ts: Date.now() };
    for (const listener of listeners) listener(JSON.parse(JSON.stringify(message)));
  };
  const context = vm.createContext({
    BroadcastChannel: TrackedChannel, setTimeout, clearTimeout, setInterval, clearInterval,
    cindy: {
      request: async (request) => (request.kind === 'app-context' ?
        { ok: true, context: { locale: 'zh-CN', uiLocale: 'zh-CN' } } : { ok: false }),
      node: {
        request: async (request) => {
          const copy = JSON.parse(JSON.stringify(request));
          if (copy.method === 'cliMaintenance') return { ok: true, result: await maintain(copy.params, forward) };
          if (copy.method === 'detect') return { ok: true, result: { available: false, reason: 'not-installed' } };
          return { ok: false };
        },
      },
      onHostMessage: (listener) => { listeners.push(listener); return () => {}; },
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  });
  vm.runInContext(fs.readFileSync(path.join(root, MAIN), 'utf8'), context, { filename: MAIN });
}

/** cli-settings.js on a minimal DOM; returns the elements by id. */
function openSettings(t) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      const listeners = {};
      elements.set(id, {
        id, textContent: '', hidden: false, disabled: false, dataset: {}, attributes: {}, style: {},
        scrollTop: 0, scrollHeight: 0, clientHeight: 0,
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, listener) { listeners[type] = listener; },
        click() { listeners.click?.(); },
      });
    }
    return elements.get(id);
  };
  const channels = [];
  class TrackedChannel extends BroadcastChannel {
    constructor(name) { super(name); channels.push(this); }
  }
  const timers = new Set();
  const context = vm.createContext({
    BroadcastChannel: TrackedChannel, crypto: globalThis.crypto, setTimeout, clearTimeout,
    setInterval: (...args) => { const id = setInterval(...args); timers.add(id); return id; },
    clearInterval: (id) => { timers.delete(id); clearInterval(id); },
    document: { getElementById: element, addEventListener() {}, visibilityState: 'visible' },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  });
  const close = () => { channels.forEach((channel) => channel.close()); timers.forEach((id) => clearInterval(id)); };
  t.after(close);
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(root, 'cli-settings.js'), 'utf8'), context, { filename: 'cli-settings.js' });
  const refreshes = [];
  const render = context.createCliMaintenance(new TrackedChannel(CHANNEL), () => refreshes.push(Date.now()), 'recheck');
  render({ available: false, reason: 'not-installed' }, 'zh-CN', false);
  return { element, close, refreshes, render };
}

describe('CLI install progress', () => {
  test('the settings page follows the install step by step and keeps the log after reopening', async (t) => {
    const download = gate();
    const finish = gate();
    let installedVersion;
    const maintain = createMaintenance({
      latest: async () => ({ version: '1.2.3' }),
      installed: async () => (installedVersion ?
        { present: true, runnable: true, version: installedVersion } : { present: false }),
      plan: () => ['download', 'probe', 'activate'],
      install: async (release, current, report) => {
        report.step('download');
        report.bytes(0, 4 * 1024 * 1024);
        report.bytes(1024 * 1024, 4 * 1024 * 1024);
        report.log(`\u001b[32mfetch\u001b[0m https://user:hunter2@registry.example/pkg.tgz into ${os.homedir()}${path.sep}cache`);
        report.log('using token=abc123secret');
        await download.promise;
        report.note('downloaded', { size: 4 * 1024 * 1024 });
        report.step('probe');
        report.note('probe', { version: release.version });
        report.step('activate');
        await finish.promise;
        installedVersion = release.version;
      },
    });
    startMain(t, maintain);
    const page = openSettings(t);
    const { element } = page;

    await waitFor(() => element('cli-action').textContent === '从官方安装' && !element('cli-action').disabled, 3_000, 'install button');
    element('cli-action').click();
    await waitFor(() => element('cli-progress-step').textContent === '第 2/5 步 · 下载安装包', 3_000, 'download step');
    await waitFor(() => element('cli-progress-percent').textContent === '25%', 3_000, 'byte progress');
    assert.equal(element('cli-status').textContent, '正在安装…');
    assert.equal(element('cli-progress').hidden, false);
    assert.equal(element('cli-progress-bar').hidden, false);
    assert.equal(element('cli-progress-fill').style.width, '25%');
    assert.equal(element('cli-progress-detail').textContent, '已下载 1.0 MB / 4.0 MB');
    await waitFor(() => element('cli-log-lines').textContent.includes('token='), 3_000, 'log lines');
    const log = element('cli-log-lines').textContent;
    assert.equal(element('cli-log').hidden, false);
    assert.match(log, /0:0\d {2}官方最新版本 1\.2\.3，本机尚未安装/);
    assert.match(log, /fetch https:\/\/\*\*\*@registry\.example\/pkg\.tgz into ~[\\/]cache/);
    assert.ok(!log.includes('hunter2') && !log.includes('abc123secret') && !log.includes('\u001b'), log);
    assert.ok(!log.includes(os.homedir()), 'the home folder is shortened to ~');

    download.open();
    await waitFor(() => element('cli-progress-step').textContent === '第 4/5 步 · 启用新版本', 3_000, 'activate step');
    assert.equal(element('cli-progress-bar').hidden, true, 'no bar when the size is unknown');
    assert.match(element('cli-progress-rate').textContent, /^已用 0:\d\d$/);

    // Reopening the settings page restores the running step and the log from main.js.
    page.close();
    const reopened = openSettings(t);
    await waitFor(() => reopened.element('cli-progress-step').textContent === '第 4/5 步 · 启用新版本', 3_000, 'restored step');
    assert.match(reopened.element('cli-log-lines').textContent, /已下载 4\.0 MB，校验通过\n.*新版本 1\.2\.3 可以运行/);

    finish.open();
    await waitFor(() => reopened.element('cli-progress').hidden, 3_000, 'progress hidden after the install');
    await waitFor(() => reopened.refreshes.length > 0, 3_000, 'the page re-detects the CLI after installing');
    reopened.render({ available: true, version: '1.2.3' }, 'zh-CN', false);
    assert.match(reopened.element('cli-status').textContent, /1\.2\.3/);
    assert.equal(reopened.element('cli-log').hidden, false, 'the log stays available');
    assert.match(reopened.element('cli-log-lines').textContent, /已安装 1\.2\.3$/);
    assert.match(reopened.element('cli-log-title').textContent, /^安装日志（\d+ 行）$/);
  });

  test('a failed install shows what the installer printed', async (t) => {
    const maintain = createMaintenance({
      latest: async () => ({ version: '1.2.3' }),
      installed: async () => ({ present: false }),
      plan: () => ['download'],
      install: async (release, current, report) => {
        report.step('download');
        const updater = [
          'console.log("fetching")',
          'console.error("Authorization: Bearer fixture-bearer")',
          'console.error("Authorization: Basic Zml4dHVyZQ==")',
          'console.error("E404 Not Found")',
          'process.exit(3)',
        ].join(';');
        await stream(process.execPath, ['-e', updater],
          { timeout: 10_000, onLine: report.log });
      },
    });
    startMain(t, maintain);
    const { element } = openSettings(t);
    await waitFor(() => !element('cli-action').disabled && !element('cli-action').hidden, 3_000, 'install button');
    element('cli-action').click();
    await waitFor(() => element('cli-status').textContent === '安装或更新未完成，请重试。', 5_000, 'failure message');
    assert.equal(element('cli-progress').hidden, true);
    const log = element('cli-log-lines').textContent;
    assert.match(log, /fetching/);
    assert.match(log, /Authorization: \*\*\*/);
    assert.doesNotMatch(log, /fixture-bearer/);
    assert.doesNotMatch(log, /Zml4dHVyZQ==/);
    assert.match(log, /E404 Not Found/);
    assert.match(log, /Exited with 3/);
    assert.match(log, /未完成：安装或更新未完成，请重试。$/);
  });
});
