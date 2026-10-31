import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import { setImmediate as flush } from 'node:timers/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const read = file => readFileSync(new URL('../google-gmail/' + file, import.meta.url), 'utf8');
const mainSource = read('main.js');
const settingsSource = read('settings.js');
const settingsHtml = read('settings.html');
const gogSource = read('node/gog.cjs');
const mimeSource = read('node/mailMime.cjs');
const { MESSAGES: workerMessages, workerMessage, draftBodyErrorMessage } = require('../google-gmail/node/mailMime.cjs');

const hostLocales = ['zh-CN', 'en', 'ja', 'ko'];
const hanRe = /[一-鿿]/;
const placeholdersOf = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const copy = value => JSON.parse(JSON.stringify(value));
// Japanese writes the detail in the same full-width parentheses as Chinese.
const sharedWithZh = new Set(['settings.js ja.withDetail']);

function tableIn(source, marker, end) {
  const start = source.indexOf(marker) + marker.length - 1;
  return runInNewContext('(' + source.slice(start, source.indexOf(end, start) + end.length - 1) + ')');
}
const mainMessages = tableIn(mainSource, 'var MESSAGES = {', '\n};');
const settingsMessages = tableIn(settingsSource, 'var MESSAGES = {', '\n  };');
// settings.js nests the OAuth error labels; compare them as flat keys.
const flatSettings = Object.fromEntries(Object.entries(settingsMessages).map(([locale, table]) => [locale,
  Object.fromEntries(Object.entries(table).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]]
    : Object.entries(value).map(([code, text]) => [key + '.' + code, text])))]));

function assertParity(messages, label) {
  assert.deepEqual(Object.keys(messages).sort(), [...hostLocales].sort(), label + ' locales');
  const keys = Object.keys(messages.en).sort();
  for (const locale of hostLocales) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys, `${label} ${locale} keys`);
    for (const key of keys) {
      const text = messages[locale][key];
      assert.equal(typeof text, 'string', `${label} ${locale}.${key}`);
      assert.ok(text.trim(), `${label} ${locale}.${key} is empty`);
      assert.deepEqual(placeholdersOf(text), placeholdersOf(messages.en[key]), `${label} ${locale}.${key} placeholders`);
      // Japanese legitimately writes kanji; English and Korean never need Han.
      if (locale === 'en' || locale === 'ko') assert.doesNotMatch(text, hanRe, `${label} ${locale}.${key}`);
      if (locale !== 'zh-CN' && !sharedWithZh.has(`${label} ${locale}.${key}`)) assert.notEqual(text, messages['zh-CN'][key], `${label} ${locale}.${key} copied from zh-CN`);
    }
  }
}

test('runtime, worker and settings tables have identical keys and placeholders in all four locales', () => {
  assertParity(mainMessages, 'main.js');
  assertParity(workerMessages, 'mailMime.cjs');
  assertParity(flatSettings, 'settings.js');
});

test('every referenced message key exists and no table key is unused', () => {
  const mainKeys = new Set([...mainSource.matchAll(/\bt\('(\w+)'/g)].map(m => m[1]));
  const workerKeys = new Set([...(gogSource + mimeSource).matchAll(/(?:\btext\(|workerMessage\([^,()]+, )'(\w+)'/g)].map(m => m[1]));
  // draftWriteFailure maps execution states to keys through an object literal.
  for (const key of ['draftNotSaved', 'draftSavedReceiptUnverified', 'draftSaveUnknown']) {
    assert.match(gogSource, new RegExp(`: '${key}'`));
    workerKeys.add(key);
  }
  const settingsKeys = new Set([...settingsSource.matchAll(/\bt\('(\w+)'/g)].map(m => m[1]).concat(['title', 'scopeHint', 'connect', 'reauth']));
  for (const [label, keys, messages] of [['main.js', mainKeys, mainMessages], ['worker', workerKeys, workerMessages]]) {
    assert.ok(keys.size >= 20, label);
    for (const key of keys) assert.ok(Object.hasOwn(messages.en, key), `${label} uses missing key ${key}`);
    for (const key of Object.keys(messages.en)) assert.ok(keys.has(key), `${label} has unused key ${key}`);
  }
  for (const key of settingsKeys) assert.ok(Object.hasOwn(settingsMessages.en, key), `settings.js uses missing key ${key}`);
  for (const key of Object.keys(settingsMessages.en)) assert.ok(key === 'errors' || settingsKeys.has(key), `settings.js has unused key ${key}`);
});

test('no hardcoded Chinese copy remains outside comments and the zh-CN and ja tables', () => {
  const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
  const cjkTables = /\n( +)(?:'zh-CN'|ja): \{[\s\S]*?\n\1\},(?=\n)/g;
  for (const [label, text] of [['main.js', mainSource], ['settings.js', settingsSource], ['settings.html', settingsHtml],
    ['node/gog.cjs', gogSource], ['node/mailMime.cjs', mimeSource]]) {
    const outside = stripComments(text).replace(cjkTables, '\n');
    assert.deepEqual(outside.split('\n').filter(line => hanRe.test(line)), [], label);
  }
  for (const source of [mainSource, settingsSource, gogSource, mimeSource]) assert.doesNotMatch(stripComments(source), /navigator\.language/);
});

test('zh-CN copy is the previous Simplified Chinese text, unchanged for Chinese users', () => {
  const zh = mainMessages['zh-CN'];
  assert.equal(zh.accountServiceUnreachable, '无法连接 Cindy 本地账号服务，请稍后重试；若持续失败，请重新打开 Gmail 插件详情检查服务状态');
  assert.equal(zh.noAccount, '尚未连接账号，请到「{plugin}」详情页单独授权');
  assert.equal(zh.sendRequiresDraft, '邮件未发送。请先用 drafts create / drafts reply / drafts reply-all 创建并展示草稿，再用 drafts send 发送；Cindy 公共流程会提供 10 秒撤销窗口。不要绕过草稿流程直接发送。');
  assert.equal(zh.outcomeUnknown, '无法确认邮箱操作结果，请先核对邮箱中的实际状态，不要重复发送、保存或删除。');
  const worker = workerMessages['zh-CN'];
  assert.equal(worker.draftSavedReceiptUnverified, '草稿已保存但未发送：无法完整核对 Gmail 回执，请先重新读取或到 Gmail 检查，不要重复创建、保存或发送。');
  assert.equal(worker.removedImageReferenced, '正文仍引用已移除的图片，请先在正文中删除图片');
  assert.equal(worker.draftBodyCharset, '不支持草稿正文的字符编码，请在邮箱中编辑此草稿。');
  const settings = settingsMessages['zh-CN'];
  assert.equal(settings.scopeHint, '连接 Gmail 和 Google 通讯录：读写个人联系人，读取账号资料、其他联系人及可见的企业目录。已有账号需重新连接补充授权；未补充时原邮件功能仍可使用。');
  assert.equal(settings.connectedOther, '已连接 {connected}；这不是所选账号，{target} 仍需重新连接。');
  assert.equal(settings.errors.VAULT_WRITE_FAILED, '账号保存失败，请重试');
});

test('English copy uses the official plugin name', () => {
  for (const table of [mainMessages.en, workerMessages.en, flatSettings.en]) {
    for (const text of Object.values(table)) assert.doesNotMatch(text, /\(Rui\)|ruivalim/i);
  }
  assert.match(mainMessages.en.accountServiceUnreachable, /reopen the Gmail plugin details/);
  assert.match(workerMessages.en.draftNotSaved, /in the Gmail plugin details/);
});

// Agents act on these words: an outcome that is unknown or already applied must
// tell them, in every language, not to repeat the write.
test('agent-safety meaning survives in every locale', () => {
  const marks = {
    notExecuted: { 'zh-CN': /^尚未执行/, en: /^Not executed/, ja: /^未実行/, ko: /^실행되지 않음/ },
    doNotRepeat: { 'zh-CN': /不要(?:重复|盲目重试)/, en: /do not (?:send|create|save|retry)/, ja: /(?:繰り返さない|むやみに再試行しない)でください/, ko: /(?:반복하지|무작정 다시 시도하지) 마세요/ },
    notSent: { 'zh-CN': /(?:尚)?未发送/, en: /not (?:been )?sent/i, ja: /送信されていません/, ko: /전송되지 않았습니다/ },
    unchanged: { 'zh-CN': /(?:草稿|原草稿)未(?:修改|更改)/, en: /draft was not changed/, ja: /下書きは変更されていません/, ko: /초안은 변경되지 않았습니다/ },
  };
  const cases = [
    [mainMessages, ['notExecuted', 'multipleAccounts', 'accountNotFound', 'accountReauth', 'unknownTool', 'runtimeMissing'], 'notExecuted'],
    [mainMessages, ['markReadUnknown', 'earlierDraftUnconfirmed', 'executedUnreturned', 'outcomeUnknown'], 'doNotRepeat'],
    [mainMessages, ['sendRequiresDraft'], 'notSent'],
    [workerMessages, ['draftSavedReceiptUnverified', 'draftSaveUnknown', 'draftSavedReadBackUnverified'], 'doNotRepeat'],
    [workerMessages, ['draftNotSaved', 'draftSavedReceiptUnverified', 'draftSaveUnknown', 'composeFieldsIncomplete', 'composeReadFailed',
      'composeHeadersInvalid', 'composeHtmlDraft', 'draftSavedReadBackUnverified', 'draftSaveUnconfirmed', 'draftSavedNoReadBack', 'draftSavedMismatch'], 'notSent'],
    [workerMessages, ['inlineImagesNotPreserved', 'draftAttachmentsUnverified', 'htmlDraftFieldsOnly', 'tooManyAttachments', 'attachmentReadIncomplete', 'attachmentSizeInvalid'], 'unchanged'],
  ];
  for (const [messages, keys, mark] of cases) {
    for (const locale of hostLocales) for (const key of keys) assert.match(messages[locale][key], marks[mark][locale], `${locale}.${key} ${mark}`);
  }
});

function mainHarness(options = {}) {
  const sent = [], nodeRequests = [], appContextRequests = [];
  let handler;
  const accounts = options.accounts ?? [{ id: 'acc-work', label: 'work@example.test', status: 'connected' }];
  const cindy = {
    onHostMessage: fn => { handler = fn; },
    send: async message => { sent.push(copy(message)); return { ok: true }; },
    request: async message => {
      assert.deepEqual(copy(message), { kind: 'app-context' });
      appContextRequests.push(message);
      if (options.appContext) return options.appContext();
      return { ok: true, context: { region: 'global', locale: options.locale ?? 'zh-CN' } };
    },
    node: { request: async request => { nodeRequests.push(copy(request)); return { ok: true, result: { ok: true, execution: 'executed', data: {} } }; } },
  };
  if (options.withoutRequest) delete cindy.request;
  const ctx = createContext({
    setTimeout: options.setTimeout ?? setTimeout, clearTimeout,
    navigator: { locks: { request: (_name, action) => action() } },
    fetch: async url => {
      if (url === '/oauth') return { ok: true, json: async () => [{ key: 'gmail_account', clientConfigured: true, accounts: copy(accounts) }] };
      assert.equal(url, '/kv');
      return { ok: true, json: async () => ({}) };
    },
    cindy,
  });
  runInContext(mainSource, ctx);
  const call = async (tool, args = {}) => {
    await handler({ type: 'tool-call', tool, callId: 'call-' + sent.length, args });
    return sent.at(-1);
  };
  return { sent, nodeRequests, appContextRequests, hostMessage: message => handler(message), call,
    listAccounts: () => ctx.listAccounts(),
    unknownTool: async () => (await call('gmail_missing')).message };
}

test('zh-CN tool results are byte-identical to the previous hardcoded strings', async () => {
  const f = mainHarness({ accounts: [] });
  assert.equal((await f.call('gmail_accounts')).message, '尚未连接账号，请到「Gmail」详情页单独授权');
  assert.equal(await f.unknownTool(), '尚未执行：未知工具，请重新查看当前插件工具列表。');
  assert.equal((await f.call('gmail_run', { command: ['list'], session_context: {} })).message,
    '尚未执行：尚未连接账号，请到「Gmail」详情页单独授权');
});

test('runtime copy falls back to English for unsupported or unavailable Host locales', async () => {
  const english = 'Not executed: unknown tool. Check the current plugin tool list again.';
  const variants = {
    unsupported: { locale: 'fr' },
    regionalTag: { locale: 'zh-TW' },
    notOk: { appContext: () => ({ ok: false }) },
    missingLocale: { appContext: () => ({ ok: true, context: {} }) },
    throws: { appContext: () => { throw new Error('host unavailable'); } },
    noRequestApi: { withoutRequest: true },
    hangs: { appContext: () => new Promise(() => {}), setTimeout: fn => { setImmediate(fn); return 1; } },
  };
  for (const [label, options] of Object.entries(variants)) {
    assert.equal(await mainHarness(options).unknownTool(), english, label);
  }
});

for (const locale of ['ja', 'ko']) {
  test(`${locale} copy reaches tool results and the worker request carries the Host locale`, async () => {
    const f = mainHarness({ locale });
    const table = mainMessages[locale];
    assert.equal(await f.unknownTool(), table.unknownTool);
    assert.equal((await f.call('gmail_run', { command: ['list'] })).message, table.runtimeMissing);
    assert.equal((await f.call('gmail_run', { command: ['send'], session_context: { workdir_is_read_only: false } })).message,
      '[not_executed] ' + table.sendRequiresDraft);
    const result = await f.call('gmail_run', { command: ['search'], arguments: ['in:inbox'], session_context: {} });
    assert.equal(result.ok, true);
    assert.equal(f.nodeRequests.length, 1);
    assert.equal(f.nodeRequests[0].params.locale, locale);
    assert.deepEqual(f.nodeRequests[0].params.command, ['search']);
    const none = mainHarness({ locale, accounts: [] });
    assert.equal((await none.call('gmail_accounts')).message, table.noAccount.replace('{plugin}', 'Gmail'));
  });
}

test('host-context-changed switches runtime and worker locale without another app-context request', async () => {
  const f = mainHarness({ locale: 'zh-CN' });
  assert.equal(await f.unknownTool(), mainMessages['zh-CN'].unknownTool);
  for (const [context, expected] of [[{ region: 'global', locale: 'ko' }, 'ko'], [{ locale: 'ja' }, 'ja'], [{ locale: 'xx' }, 'en'], [undefined, 'en']]) {
    await f.hostMessage({ type: 'host-context-changed', context });
    assert.equal(await f.unknownTool(), mainMessages[expected].unknownTool, expected);
    await f.call('gmail_run', { command: ['search'], session_context: {} });
    assert.equal(f.nodeRequests.at(-1).params.locale, expected);
  }
  assert.equal(f.appContextRequests.length, 1);
});

test('a locale change during the app-context request wins over the stale reply', async () => {
  let resolve;
  const f = mainHarness({ appContext: () => new Promise(done => { resolve = done; }) });
  const pending = f.unknownTool();
  await flush();
  await f.hostMessage({ type: 'host-context-changed', context: { locale: 'ja' } });
  resolve({ ok: true, context: { locale: 'zh-CN' } });
  assert.equal(await pending, mainMessages.ja.unknownTool);
  assert.equal(await f.unknownTool(), mainMessages.ja.unknownTool);
});

test('concurrent tool calls share one app-context request and wait for the Host locale', async () => {
  let resolve;
  const f = mainHarness({ appContext: () => new Promise(done => { resolve = done; }) });
  const calls = [1, 2, 3].map(() => f.call('gmail_run', { command: ['search'], session_context: {} }));
  await flush();
  assert.equal(f.appContextRequests.length, 1);
  assert.equal(f.nodeRequests.length, 0, 'no worker request before the locale is known');
  resolve({ ok: true, context: { locale: 'ko' } });
  await Promise.all(calls);
  assert.deepEqual(f.nodeRequests.map(request => request.params.locale), ['ko', 'ko', 'ko']);
});

test('a failed app-context lookup is retried on the next call instead of pinning English', async () => {
  let attempts = 0;
  const f = mainHarness({ appContext: () => {
    attempts += 1;
    if (attempts === 1) throw new Error('host busy');
    return { ok: true, context: { locale: 'zh-CN' } };
  } });
  assert.equal(await f.unknownTool(), mainMessages.en.unknownTool);
  assert.equal(await f.unknownTool(), mainMessages['zh-CN'].unknownTool);
  assert.equal(await f.unknownTool(), mainMessages['zh-CN'].unknownTool);
  assert.equal(attempts, 2);
});

test('a hung app-context lookup is waited for once per tool call, then retried on the next call', async () => {
  const timers = [];
  const f = mainHarness({
    appContext: () => new Promise(() => {}),
    setTimeout: (fn, ms) => { timers.push(ms); setImmediate(fn); return timers.length; },
  });
  const english = mainMessages.en;
  const cases = [
    ['gmail_accounts', {}, result => assert.equal(result.ok, true)],
    ['gmail_run', { command: ['search'], arguments: ['in:inbox'], session_context: {} }, result => assert.equal(result.ok, true)],
    // Reaches account listing and selection, then stops at the missing cindy.fetch.
    ['gmail_read_message', { url: 'https://mail.google.com/mail/u/0/#inbox/abcdef1234' }, result => assert.equal(result.ok, false)],
    ['gmail_run', { command: ['list'], account: 'acc-missing', session_context: {} },
      result => assert.equal(result.message, english.accountNotFound)],
  ];
  for (const [index, [tool, args, check]] of cases.entries()) {
    const result = await f.call(tool, args);
    check(result);
    assert.equal(f.appContextRequests.length, index + 1, `${tool}: one app-context request per call`);
    assert.deepEqual(timers, Array(index + 1).fill(3000), `${tool}: one 3 s wait per call`);
  }
  assert.deepEqual(f.nodeRequests.map(request => request.params.locale), ['en']);
});

test('a card callback outside a tool call still does its own single locale lookup', async () => {
  const timers = [];
  const f = mainHarness({
    appContext: () => new Promise(() => {}),
    setTimeout: (fn, ms) => { timers.push(ms); setImmediate(fn); return timers.length; },
  });
  await f.listAccounts();
  assert.equal(f.appContextRequests.length, 1);
  assert.deepEqual(timers, [3000]);
});

// Loads the mail SDK with main.js so card actions reach the real draft adapter.
// app-context replies and timers are driven by the test.
function cardHarness() {
  const appContext = [], requests = [], timers = [], handlers = [];
  let kv = {}, runReply = null;
  const readBack = { status: 'read_back', draftId: 'draft-test', fingerprint: 'f'.repeat(64), locator: 'draft-test',
    headers: { from: 'work@example.test', to: 'to@example.test', cc: '', bcc: '', subject: 'Hello' },
    editor: { editable: true, format: 'text', body: 'Hi', quote: '' }, attachments: [] };
  const sandbox = createContext({ crypto: globalThis.crypto, Map, Set, Promise, JSON,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
    navigator: { locks: { request: (_name, action) => action() } },
    fetch: async (url, init = {}) => {
      if (url === '/oauth') return { ok: true, json: async () => [{ key: 'gmail_account', clientConfigured: true,
        accounts: [{ id: 'acc-work', label: 'work@example.test', status: 'connected' }] }] };
      if (url === '/kv') { if (init.method === 'PUT') kv = JSON.parse(init.body); return { ok: true, json: async () => copy(kv) }; }
      if (url === '/app-context') return { ok: true, json: async () => ({ context: { locale: 'en' } }) };
      throw new Error('unexpected fetch ' + url);
    },
    cindy: {
      onHostMessage: fn => { handlers.push(fn); },
      send: async () => ({ ok: true }),
      request: message => {
        assert.deepEqual(copy(message), { kind: 'app-context' });
        return new Promise(resolve => appContext.push(resolve));
      },
      node: { request: async request => {
        requests.push(copy(request));
        if (request.method === 'compose') return { ok: true, result: { ok: true, execution: 'executed', data: { draftId: 'draft-test', readBack: copy(readBack) } } };
        if (request.params.command[0] === 'search' && runReply) return runReply;
        return { ok: true, result: { ok: true, execution: 'executed', data: { draftId: 'draft-test', readBack: copy(readBack) } } };
      } },
    },
  });
  runInContext(readFileSync(new URL('./contracts/cindy-mail-runtime.js', import.meta.url), 'utf8'), sandbox);
  runInContext(mainSource, sandbox);
  const dispatch = async message => { for (const handle of handlers) await handle(message); };
  const session = { workdir: '/work', workdir_is_local: true, workdir_is_read_only: false };
  // Fires the pending timers with this delay, e.g. the 3 s locale fallback.
  const fire = async ms => {
    for (const timer of timers) if (timer.ms === ms && timer.fn) { const fn = timer.fn; timer.fn = null; await fn(); }
  };
  return { appContext, requests, fire, session, waits: () => timers.filter(timer => timer.ms === 3000).map(timer => timer.ms),
    holdSearch: reply => { runReply = reply; },
    tool: (callId, args) => dispatch({ type: 'tool-call', tool: 'gmail_run', callId, args: { session_context: session, ...args } }),
    // A draft card shown while the Host never answered, so no locale is known yet.
    async showCard() {
      const shown = this.tool('call-card', { command: ['drafts', 'get'], arguments: ['draft-test'] });
      await flush();
      await fire(3000);
      await shown;
      const key = Object.keys(kv.mailDraftCards)[0];
      assert.ok(key);
      return key;
    },
    // Editing the card, then the 1.1 s autosave that writes the draft.
    async editCard(key, { autosave = true } = {}) {
      await dispatch({ type: 'event', name: 'card-action', callId: 'call-card', actionId: 'mail:change:' + key, formChange: true,
        formValues: { to: 'to@example.test', cc: '', bcc: '', subject: 'Hello', body: 'Edited' } });
      if (!autosave) return;
      const saving = fire(1100);
      await flush();
      return saving;
    },
    composeLocales: () => requests.filter(request => request.method === 'compose').map(request => request.params.locale),
  };
}

test('a card autosave during a tool call\'s pending lookup waits for that same reply', async () => {
  const f = cardHarness();
  const key = await f.showCard();
  assert.equal(f.appContext.length, 1);
  const search = f.tool('call-search', { command: ['search'], arguments: ['in:inbox'] });
  await flush();
  assert.equal(f.appContext.length, 2, 'the tool call is waiting for the Host');
  const saving = f.editCard(key);
  await flush();
  assert.equal(f.appContext.length, 2, 'the card joins the pending lookup instead of asking again');
  assert.deepEqual(f.composeLocales(), [], 'no draft write before the Host answers');
  f.appContext[1]({ ok: true, context: { locale: 'ja' } });
  await Promise.all([saving, search]);
  assert.deepEqual(f.composeLocales(), ['ja']);
  assert.equal(f.requests.find(request => request.params.command?.[0] === 'search').params.locale, 'ja');
});

test('a card autosave after a timed-out lookup asks the Host itself while a tool call is still running', async () => {
  const f = cardHarness();
  const key = await f.showCard();
  let releaseSearch;
  f.holdSearch(new Promise(resolve => { releaseSearch = resolve; }));
  const search = f.tool('call-search', { command: ['search'], arguments: ['in:inbox'] });
  await flush();
  await f.fire(3000);
  await flush();
  const searchRequest = f.requests.find(request => request.params.command?.[0] === 'search');
  assert.equal(searchRequest.params.locale, 'en', 'the tool call fell back to English after its one wait');
  const saving = f.editCard(key);
  await flush();
  assert.equal(f.appContext.length, 3, 'the card does its own lookup');
  f.appContext[2]({ ok: true, context: { locale: 'ja' } });
  await saving;
  assert.deepEqual(f.composeLocales(), ['ja']);
  releaseSearch({ ok: true, result: { ok: true, execution: 'executed', data: {} } });
  await search;
});

test('draft callbacks made for a tool call reuse its single wait', async () => {
  const f = cardHarness();
  const key = await f.showCard();
  // An unsaved card edit makes drafts update write through the mail SDK.
  await f.editCard(key, { autosave: false });
  const update = f.tool('call-update', { command: ['drafts', 'update'], arguments: ['draft-test'], options: {} });
  await flush();
  assert.equal(f.appContext.length, 2);
  await f.fire(3000);
  await update;
  assert.equal(f.appContext.length, 2, 'selectAccount and writeDraft do not ask again');
  assert.deepEqual(f.waits(), [3000, 3000], 'one 3 s wait for the card and one for the tool call');
  assert.deepEqual(f.composeLocales(), ['en']);
});

function workerContext() {
  const ctx = createContext({ Buffer, __dirname: '/fixture', process: { env: {}, on() {} },
    require: name => name === '../vendor/gog/binaries.json' ? {} : name === './mailMime.cjs' ? require('../google-gmail/node/mailMime.cjs') : require(name) });
  runInContext(gogSource.split('const input = readline.createInterface')[0], ctx);
  return ctx;
}

test('the worker answers in params.locale and falls back to English without one', async () => {
  const ctx = workerContext();
  for (const locale of hostLocales) {
    const incomplete = await ctx.composeDraft({ params: { locale } }, {});
    assert.deepEqual({ ...incomplete }, { ok: false, execution: 'not_executed', message: workerMessages[locale].composeFieldsIncomplete });
    for (const [execution, key] of [['executed', 'draftSavedReceiptUnverified'], ['unknown', 'draftSaveUnknown']]) {
      const failure = ctx.draftWriteFailure(Object.assign(new Error('provider detail'), { execution }), { started: true }, locale);
      assert.equal(failure.execution, execution);
      assert.equal(failure.message, workerMessages[locale][key]);
    }
    const unsaved = ctx.draftWriteFailure({ code: 'DRAFT_BODY_DECODE' }, { started: false }, locale);
    assert.equal(unsaved.message, workerMessages[locale].draftBodyDecode);
    assert.throws(() => ctx.draftReadBack({ draft: { id: 'd', message: { id: 'm', payload: { mimeType: 'text/plain', body: { size: 4 } } } } }, 'd', locale),
      error => error.message === workerMessages[locale].draftBodyIncomplete);
  }
  for (const locale of [undefined, 'fr', 'zh-TW', 'toString']) {
    assert.equal(workerMessage(locale, 'messageTooLarge'), workerMessages.en.messageTooLarge, String(locale));
    assert.equal(draftBodyErrorMessage({ code: 'DRAFT_BODY_CHARSET' }, locale), workerMessages.en.draftBodyCharset);
  }
  assert.equal((await ctx.composeDraft({ params: {} }, {})).message, workerMessages.en.composeFieldsIncomplete);
});

async function settingsHarness(options = {}) {
  const nodes = {};
  const element = id => nodes[id] ||= { id, textContent: '', disabled: false, hidden: false };
  const ctx = createContext({
    AbortController, setTimeout, clearTimeout,
    document: { documentElement: { lang: 'zh-CN' }, getElementById: element },
    window: { renderGoogleAccounts() {} },
    googleAccountMetadata: { list: async (_key, accounts) => accounts },
    fetch: async (url, init = {}) => {
      if (url === '/app-context') {
        if (options.appContext) return options.appContext(init);
        return { ok: true, json: async () => ({ ok: true, context: { locale: options.locale } }) };
      }
      if (url === '/oauth') return { ok: true, json: async () => [{ key: 'gmail_account', accounts: [] }] };
      assert.equal(url, '/oauth/gmail_account/connect');
      return options.connect();
    },
  });
  runInContext(settingsSource, ctx);
  await flush();
  return { nodes, lang: () => ctx.document.documentElement.lang, connect: async () => { nodes.connect.onclick(); await flush(); return nodes.status.textContent; } };
}

for (const locale of hostLocales) {
  test(`settings page renders ${locale} copy from /app-context`, async () => {
    const table = settingsMessages[locale];
    const page = await settingsHarness({ locale, connect: async () => ({ ok: true, json: async () => ({ ok: false, error: 'ACCOUNT_LIMIT', detail: 'max 5' }) }) });
    assert.equal(page.lang(), locale);
    assert.equal(page.nodes['settings-title'].textContent, table.title);
    assert.equal(page.nodes['scope-hint'].textContent, table.scopeHint);
    assert.equal(page.nodes.connect.textContent, table.connect);
    assert.equal(page.nodes.reauth.textContent, table.reauth);
    assert.equal(await page.connect(), table.withDetail.replace('{message}', table.errors.ACCOUNT_LIMIT).replace('{detail}', 'max 5'));
    const connected = await settingsHarness({ locale, connect: async () => ({ ok: true, json: async () => ({ ok: true, account: {} }) }) });
    assert.equal(await connected.connect(), table.connected.replace('{account}', table.accountFallback));
  });
}

test('settings page falls back to English for unknown, failed or malformed app-context', async () => {
  for (const appContext of [
    () => ({ ok: true, json: async () => ({ context: { locale: 'fr' } }) }),
    () => ({ ok: false, status: 500 }),
    () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }),
    () => { throw new Error('offline'); },
  ]) {
    const page = await settingsHarness({ appContext, connect: async () => { throw new Error('lost'); } });
    assert.equal(page.lang(), 'en');
    assert.equal(page.nodes['settings-title'].textContent, 'Connected accounts');
    assert.equal(await page.connect(), settingsMessages.en.connectUnknown);
  }
});

test('settings.html ships no hardcoded copy before the Host locale is known', () => {
  for (const id of ['settings-title', 'scope-hint', 'connect']) {
    assert.match(settingsHtml, new RegExp(`id="${id}"[^>]*></`), id);
  }
  assert.doesNotMatch(settingsHtml.replace(/<[^>]*>/g, ''), /[^\s]/);
});
