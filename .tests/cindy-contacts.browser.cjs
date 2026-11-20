'use strict';

// Run with playwright-core outside the plugin. Only the host's contact data is a fixture.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { chromium } = require(process.env.CONTACTS_PLAYWRIGHT_PATH || 'playwright-core');

test('contact search keeps IME composition across refreshes and matches pinyin alongside the original fields', async () => {
  const root = path.resolve(__dirname, '../cindy-contacts');
  const browser = await chromium.launch({ executablePath: process.env.CONTACTS_CHROME_PATH });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://contacts.example.test/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/app-context') return route.fulfill({ json: { context: { locale: 'zh-CN' } } });
      if (pathname === '/wake') return route.fulfill({ json: {} });
      const file = path.resolve(root, '.' + pathname);
      assert.ok(file.startsWith(root + path.sep));
      return route.fulfill({ path: file });
    });
    await page.addInitScript(() => {
      const row = { kind: 'person', circle: 'contactOnly', aliases: [], groups: [] };
      const contacts = [
        { ...row, id: '1', name: '陶小林', summary: '修理古钟', latest: '已经校时', groups: ['钟表组'] },
        { ...row, id: '2', name: '周青', aliases: ['小舟'] },
        { ...row, id: '3', name: '单敏' },
      ];
      const replies = { state: { ready: true }, opened: {}, list: { contacts, groups: [{ name: '钟表组', members: 1 }] } };
      const host = new BroadcastChannel('cindy-contacts');
      host.onmessage = ({ data }) => {
        if (data.kind === 'req') host.postMessage({ kind: 'res', id: data.id, ok: true, result: replies[data.method] });
      };
    });
    await page.goto('https://contacts.example.test/main-view.html');
    await page.locator('[data-fold="contactOnly"]').click();
    const names = () => page.locator('#lscroll .row .nm').allTextContents();
    const all = await names();
    assert.deepEqual([...all].sort(), ['陶小林', '单敏', '周青'].sort());
    const input = page.locator('#findInput');
    const original = await input.elementHandle();
    await input.fill('小舟');
    assert.deepEqual(await names(), ['周青']);
    await input.press('ControlOrMeta+a');

    const cdp = await page.context().newCDPSession(page);
    for (const text of ['t', 'ta', 'tao']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
      assert.equal(await input.inputValue(), text);
      assert.deepEqual(await names(), ['周青'], 'results wait for the candidate to be committed');
    }
    await page.evaluate(() => {
      const host = new BroadcastChannel('cindy-contacts');
      host.postMessage({ kind: 'event', name: 'task', data: { key: 'maintain', status: 'running' } });
      host.close();
    });
    await page.locator('.lfoot .spin').waitFor();
    assert.ok(await original.evaluate((el) => el === document.activeElement && el.value === 'tao'));
    await cdp.send('Input.insertText', { text: '陶' });
    assert.equal(await input.inputValue(), '陶');
    assert.deepEqual(await names(), ['陶小林']);

    await page.locator('#clearFind').click();
    assert.deepEqual(await names(), all);
    assert.ok(await original.evaluate((el) => el === document.activeElement && el.value === ''));
    await input.pressSequentially('tao');
    assert.deepEqual(await names(), ['陶小林']);
    await input.press('Escape');
    assert.deepEqual(await names(), all);
    // The macOS host can cancel the marked text without forwarding compositionend.
    await page.evaluate(() => {
      document.addEventListener('compositionend', (e) => e.stopPropagation(), { capture: true, once: true });
    });
    await cdp.send('Input.imeSetComposition', { text: 'bqr', selectionStart: 3, selectionEnd: 3 });
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await input.pressSequentially('tao');
    assert.deepEqual(await names(), ['陶小林'], 'plain typing still works after cancelling Wubi');
    for (const q of ['TAOXIAOLIN', 'xiǎo lín', '古钟', '校时', '钟表组']) {
      await input.fill(q);
      assert.deepEqual(await names(), ['陶小林'], q);
    }
    for (const [q, want] of [['xiaozhou', ['周青']], ['shan', ['单敏']], ['nobody', []]]) {
      await input.fill(q);
      assert.deepEqual(await names(), want, q);
    }
    await page.locator('#scopeBtn').click();
    await page.locator('[data-scope="g:钟表组"]').click();
    await input.fill('zhou');
    assert.deepEqual(await names(), [], 'pinyin respects the selected group');
    await input.fill('tao');
    assert.deepEqual(await names(), ['陶小林']);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
