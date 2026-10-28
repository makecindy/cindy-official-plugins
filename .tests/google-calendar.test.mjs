import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import './google-account-metadata.test.mjs';
import './google-workspace-tool-schema.test.mjs';
import './google-workspace-worker-paths.test.mjs';

const source = readFileSync(new URL('../google-calendar/main.js', import.meta.url), 'utf8');
const event = { id: 'event-1', summary: '<产品评审>', location: '会议室',
  htmlLink: 'https://calendar.google.com/calendar/event?eid=abc&x=1',
  start: { date: '2026-09-17' }, end: { date: '2026-09-18' } };

const connected = [{ key: 'google_calendar_account', clientConfigured: true,
  accounts: [{ id: 'acc-1', label: 'work@example.test', status: 'connected' }] }];

// The Host answers app-context with zh-CN unless a test asks otherwise, so the
// Chinese assertions below keep testing the zh-CN copy.
function load(options = {}) {
  const messages = [], requests = [], contextRequests = [];
  let handler;
  const cindy = {
    onHostMessage: fn => { assert.equal(handler, undefined); handler = fn; },
    send: async message => {
      if (options.cardFailure && message.type === 'card-update') throw new Error('card unavailable');
      messages.push(JSON.parse(JSON.stringify(message)));
    },
    node: { request: async request => { requests.push(request);
      if (options.throw) throw new Error('worker stopped');
      return { ok: true, result: options.failure || { ok: true, data: options.data } };
    } },
  };
  if (!options.noContextRequest) {
    cindy.request = async request => {
      contextRequests.push(request);
      assert.equal(JSON.stringify(request), JSON.stringify({ kind: 'app-context' }));
      if (options.appContext) return options.appContext();
      return { ok: true, context: { region: 'cn', locale: options.locale ?? 'zh-CN' } };
    };
  }
  const ctx = createContext({
    fetch: async url => {
      assert.ok(url === '/oauth' || url === '/kv');
      if (url === '/oauth' && options.oauth) return options.oauth();
      return { ok: true, json: async () => url === '/kv' ? {} : JSON.parse(JSON.stringify(options.accounts || connected)) };
    },
    cindy, setTimeout, clearTimeout,
    ...(options.globals || {}),
  });
  runInContext(source, ctx);
  const run = async (command, data, flags = {}, tool = 'google_calendar_run', args = {}) => {
    options.data = data;
    const before = messages.length;
    await handler({ type: 'tool-call', tool, callId: 'call-1',
      args: { command: [command], arguments: ['primary'], options: flags,
        session_context: { workdir_is_read_only: false, workdir_is_local: true, workdir: '/test-workdir' }, ...args } });
    const produced = messages.slice(before);
    assert.equal(produced.filter(m => m.type === 'tool-result').length, 1);
    return produced;
  };
  return { ctx, messages, requests, contextRequests, run, notify: message => handler(message) };
}

async function call(command, data, options = {}) {
  const loaded = load(options);
  const messages = await loaded.run(command, data, options.flags || {}, options.tool || 'google_calendar_run', options.args || {});
  return { messages, requests: loaded.requests, contextRequests: loaded.contextRequests };
}

test('gog 原始日程输出生成卡片，不调用第二套 Google API', async () => {
  for (const [command, data, label] of [
    ['events', { events: [event] }, '日程'], ['event', { event }, '日程详情'],
    ['create', { event }, '日程已创建'], ['update', { event }, '日程已修改'],
  ]) {
    const { messages, requests } = await call(command, data, { flags: { location: '会议室' } });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].authAccount, 'acc-1');
    assert.equal(requests[0].params.options.location, '会议室');
    assert.equal(messages[0].type, 'card-update');
    assert.match(messages[0].html, new RegExp(label));
    assert.match(messages[0].html, /&lt;产品评审&gt;|全天/);
    assert.match(messages[0].html, /data-ghost-link=.*abc&amp;x=1/);
    assert.ok(messages[0].height >= 104 && messages[0].height <= 720);
    assert.deepEqual(messages.at(-1).result, data);
  }
});

test('空日历和删除回执真实展示，不捏造删除前详情', async () => {
  assert.match((await call('events', { events: [] })).messages[0].html, /这段时间没有日程/);
  const deleted = await call('delete', { deleted: true, eventId: 'event-1' });
  assert.match(deleted.messages[0].html, /日程已从 Google Calendar 删除/);
  assert.doesNotMatch(deleted.messages[0].html, /全天|data-ghost-link=/);
});

test('未识别结果、未知执行结果与卡片失败不伪造业务结果', async () => {
  assert.equal((await call('events', 'unexpected output')).messages.length, 1);
  assert.equal((await call('update', { event }, { cardFailure: true })).messages[0].ok, true);
  const failed = await call('update', null, { failure: { ok: false, execution: 'unknown', message: 'Check remote state before retrying' } });
  assert.equal(failed.messages.length, 1);
  assert.match(failed.messages[0].message, /\[unknown\]/);
  assert.equal((await call('update', null, { throw: true })).messages[0].ok, false);
});

test('旧工具不会再发起请求；schema 不需要账号凭证', async () => {
  const old = await call('events', {}, { tool: 'google_calendar' });
  assert.equal(old.requests.length, 0);
  assert.equal(old.messages[0].ok, false);
  const schema = await call('events', { name: 'events' }, { tool: 'google_calendar_schema' });
  assert.equal(schema.requests[0].method, 'schema');
  assert.equal(schema.requests[0].authAccount, undefined);
});


// ── Host locale (docs/localization.md): zh-CN, en, ja, ko; English fallback ──
const locales = ['zh-CN', 'en', 'ja', 'ko'];
const intlLocales = { 'zh-CN': 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR' };
const hanRe = /[一-鿿]/;
const kanaRe = /[぀-ヿ]/;
const hangulRe = /[가-힯]/;
const placeholdersOf = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const timed = { id: 'event-2', summary: '', start: { dateTime: '2026-09-17T23:00:00' }, end: { dateTime: '2026-09-18T01:30:00' } };
const cardCopy = {
  'zh-CN': { list: '日程', created: '日程已创建', updated: '日程已修改', deleted: '日程已删除', details: '日程详情',
    allDay: '全天', untitled: '无标题日程', empty: '这段时间没有日程。', deletedNotice: '日程已从 Google Calendar 删除。', count: '2 个日程', weekday: '周四' },
  en: { list: 'Events', created: 'Event created', updated: 'Event updated', deleted: 'Event deleted', details: 'Event details',
    allDay: 'All day', untitled: 'Untitled event', empty: 'No events in this period.', deletedNotice: 'Event deleted from Google Calendar.', count: '2 events', weekday: 'Thu' },
  ja: { list: '予定', created: '予定を作成しました', updated: '予定を変更しました', deleted: '予定を削除しました', details: '予定の詳細',
    allDay: '終日', untitled: '無題の予定', empty: 'この期間に予定はありません。', deletedNotice: '予定を Google Calendar から削除しました。', count: '2 件の予定', weekday: '木' },
  ko: { list: '일정', created: '일정 생성됨', updated: '일정 수정됨', deleted: '일정 삭제됨', details: '일정 세부정보',
    allDay: '종일', untitled: '제목 없는 일정', empty: '이 기간에는 일정이 없습니다.', deletedNotice: 'Google Calendar에서 일정을 삭제했습니다.', count: '일정 2개', weekday: '목' },
};
const notExecutedPrefix = { 'zh-CN': '尚未执行：', en: 'Not executed: ', ja: '未実行：', ko: '실행되지 않음: ' };
const heading = (locale, date) => new Intl.DateTimeFormat(intlLocales[locale], { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
const compact = (locale, date) => new Intl.DateTimeFormat(intlLocales[locale], { month: 'long', day: 'numeric' }).format(date);
const statusOf = html => html.match(/font-weight:600;color:#202124;">([^<]*)<\/div>/)[1];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(setImmediate);

for (const locale of locales) {
  test(`${locale}: 卡片文案、日期标题和跨日时间按宿主语言渲染`, async () => {
    const copy = cardCopy[locale];
    const f = load({ locale });
    const list = (await f.run('events', { events: [event, timed] }))[0].html;
    assert.equal(statusOf(list), copy.list);
    assert.ok(list.includes('>' + copy.count + '<'), copy.count);
    assert.ok(list.includes('>' + copy.allDay + '<'));
    assert.ok(list.includes('>' + copy.untitled + '<'));
    // Date headings use Intl in the host locale, with the weekday in that language.
    const headingText = heading(locale, new Date('2026-09-17T00:00:00'));
    assert.ok(headingText.includes(copy.weekday), headingText);
    assert.ok(list.includes('>' + headingText + '<'), headingText);
    assert.ok(list.includes('>23:00 → ' + compact(locale, new Date('2026-09-18T00:00:00')) + ' 01:30<'));
    for (const [command, key] of [['create', 'created'], ['update', 'updated'], ['event', 'details']]) {
      assert.equal(statusOf((await f.run(command, { event }))[0].html), copy[key]);
    }
    const timedOnly = (await f.run('event', { event: { ...timed, end: { dateTime: '2026-09-17T23:45:00' } } }))[0].html;
    assert.ok(timedOnly.includes('>23:00\u201323:45<'), 'same-day range keeps the 24-hour clock');
    assert.ok((await f.run('events', { events: [] }))[0].html.includes(copy.empty));
    const deleted = (await f.run('delete', { deleted: true }))[0].html;
    assert.equal(statusOf(deleted), copy.deleted);
    assert.ok(deleted.includes(copy.deletedNotice));
    assert.equal(f.contextRequests.length, 1, 'locale is resolved once, then follows host-context-changed');
    for (const other of locales.filter(l => l !== locale)) {
      assert.ok(!list.includes('>' + cardCopy[other].list + '<'), other);
    }
  });

  test(`${locale}: 账号失败保留“尚未执行”语义且不发起 gog 请求`, async () => {
    const prefix = notExecutedPrefix[locale];
    const cases = [
      [{ accounts: [{ ...connected[0], accounts: [connected[0].accounts[0], { id: 'acc-2', label: 'home@example.test', status: 'connected' }] }] }, {}],
      [{}, { account: 'missing' }],
      [{ accounts: [{ ...connected[0], accounts: [{ id: 'acc-1', label: 'work@example.test', status: 'expired' }] }] }, {}],
      [{ accounts: [{ ...connected[0], accounts: [{ id: 'acc-1', label: 'work@example.test', status: 'connected', scopeStale: true }] }] }, {}],
      [{ accounts: [{ ...connected[0], accounts: [] }] }, {}],
      [{ accounts: [] }, {}],
      [{ oauth: () => { throw new Error('offline'); } }, {}],
      [{ oauth: () => ({ ok: false, status: 503 }) }, {}],
      [{ oauth: () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }) }, {}],
    ];
    for (const [options, args] of cases) {
      const f = load({ locale, ...options });
      const [reply] = await f.run('events', {}, {}, 'google_calendar_run', args);
      assert.equal(reply.ok, false);
      assert.ok(reply.message.startsWith(prefix), reply.message);
      assert.equal(f.requests.length, 0);
    }
    const stale = load({ locale, accounts: [{ ...connected[0], accounts: [{ id: 'acc-1', label: 'work@example.test', status: 'expired' }] }] });
    assert.ok((await stale.run('events', {}))[0].message.includes('work@example.test'));
    const down = load({ locale, oauth: () => ({ ok: false, status: 503 }) });
    const [listed] = await down.run('events', {}, {}, 'google_calendar_accounts');
    assert.ok(listed.message.includes('Google Calendar') && listed.message.includes('HTTP 503'), listed.message);
    assert.ok(!listed.message.startsWith(prefix), 'listing accounts is not a refused execution');
    assert.ok((await load({ locale }).run('events', {}, {}, 'google_calendar'))[0].message.startsWith(prefix));
    const noRuntime = load({ locale });
    noRuntime.ctx.cindy.node = undefined;
    const [missing] = await noRuntime.run('events', {});
    assert.ok(missing.message.startsWith(prefix) && missing.message.includes('0.1.92'), missing.message);
  });
}

test('zh-CN 日期标题、卡片与运行时错误文案与迁移前逐字一致', async () => {
  const f = load({ locale: 'zh-CN' });
  const list = (await f.run('events', { events: [event, timed] }))[0].html;
  assert.ok(list.includes('>9月17日周四<'), 'zh-CN date heading');
  assert.ok(list.includes('>23:00 → 9月18日 01:30<'), 'zh-CN cross-day range');
  assert.ok(list.includes('>2 个日程<'));
  const reply = async (options, args = {}, tool) => (await load(options).run('events', {}, {}, tool, args))[0].message;
  const P = 'Google Calendar';
  const expected = [
    [{ oauth: () => { throw new Error('offline'); } }, {}, 'google_calendar_accounts', '无法连接 Cindy 本地账号服务，请稍后重试；若持续失败，请重新打开 ' + P + ' 插件详情检查服务状态'],
    [{ oauth: () => null }, {}, 'google_calendar_accounts', 'Cindy 本地账号服务未返回结果，请稍后重试'],
    [{ oauth: () => ({ ok: false, status: 401 }) }, {}, 'google_calendar_accounts', '账号状态服务拒绝访问，请到 ' + P + ' 插件详情检查连接状态后重试（HTTP 401）'],
    [{ oauth: () => ({ ok: false, status: 500 }) }, {}, 'google_calendar_accounts', 'Cindy 本地账号服务暂时不可用，请稍后重试；若持续失败，请重新打开 ' + P + ' 插件详情检查服务状态（HTTP 500）'],
    [{ oauth: () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }) }, {}, 'google_calendar_accounts', 'Cindy 账号状态数据无法解析，请重新打开 ' + P + ' 插件详情后重试'],
    [{ oauth: () => ({ ok: true, json: async () => ({}) }) }, {}, 'google_calendar_accounts', 'Cindy 账号状态数据格式异常，请重新打开 ' + P + ' 插件详情后重试'],
    [{ accounts: [] }, {}, 'google_calendar_accounts', '内置应用身份缺失，请升级 Cindy 后重试'],
    [{ accounts: [{ ...connected[0], accounts: [{ id: '' }] }] }, {}, 'google_calendar_accounts', 'Cindy 账号列表数据格式异常，请重新打开 ' + P + ' 插件详情后重试'],
    [{ accounts: [{ ...connected[0], accounts: [] }] }, {}, 'google_calendar_accounts', '尚未连接账号，请到「' + P + '」详情页单独授权'],
    [{ accounts: [{ ...connected[0], accounts: [] }] }, {}, undefined, '尚未执行：尚未连接账号，请到「' + P + '」详情页单独授权'],
    [{ accounts: [{ ...connected[0], accounts: [connected[0].accounts[0], { id: 'acc-2', label: 'b', status: 'connected' }] }] }, {}, undefined, '尚未执行：已连接多个账号，请明确选择账号并传入 account。'],
    [{}, { account: 'missing' }, undefined, '尚未执行：指定账号不存在，请重新选择账号；不会切换到其他账号。'],
    [{ accounts: [{ ...connected[0], accounts: [{ id: 'acc-1', label: 'work@example.test', status: 'expired' }] }] }, {}, undefined, '尚未执行：账号 work@example.test 授权已失效或权限不足，请到插件详情页重新连接此账号。'],
    [{}, {}, 'google_calendar', '尚未执行：未知工具，请重新查看当前插件工具列表。'],
  ];
  for (const [options, args, tool, message] of expected) {
    assert.equal(await reply({ locale: 'zh-CN', ...options }, args, tool), message);
  }
  const noRuntime = load({ locale: 'zh-CN' });
  noRuntime.ctx.cindy.node = undefined;
  assert.equal((await noRuntime.run('events', {}))[0].message, '尚未执行：当前 Cindy 缺少此功能所需的插件运行接口，请升级至 0.1.92 或更新版本。账号列表仍可使用。');
});

test('宿主语言不受支持、不可用或超时时回退英文，且不读浏览器语言', async () => {
  const englishList = async options => statusOf((await load({ ...options, globals: { navigator: { language: 'zh-CN' } } }).run('events', { events: [event] }))[0].html);
  assert.equal(await englishList({ locale: 'fr' }), 'Events');
  assert.equal(await englishList({ locale: 'zh-TW' }), 'Events');
  assert.equal(await englishList({ noContextRequest: true }), 'Events');
  assert.equal(await englishList({ appContext: () => { throw new Error('unsupported'); } }), 'Events');
  assert.equal(await englishList({ appContext: async () => ({ ok: false }) }), 'Events');
  assert.equal(await englishList({ appContext: async () => ({ ok: true, context: {} }) }), 'Events');
  assert.equal(await englishList({ appContext: async () => null }), 'Events');
  // A Host that never answers falls back after the bounded wait instead of stalling the tool call.
  const timers = [];
  const hung = load({ appContext: () => new Promise(() => {}), globals: {
    setTimeout: (fn, ms) => { timers.push(ms); setImmediate(fn); return timers.length; }, clearTimeout: () => {},
    navigator: { language: 'zh-CN' },
  } });
  const html = (await hung.run('events', { events: [event] }))[0].html;
  assert.equal(statusOf(html), 'Events');
  assert.ok(html.includes('>' + heading('en', new Date('2026-09-17T00:00:00')) + '<'), 'English fallback also formats dates in English');
  assert.deepEqual(timers, [3000]);
  assert.doesNotMatch(source, /navigator\.language/);
});

test('首次语言请求失败后下次调用重试，不把英文钉死', async () => {
  let attempts = 0;
  const f = load({ appContext: () => {
    attempts += 1;
    if (attempts === 1) throw new Error('host busy');
    return { ok: true, context: { locale: 'zh-CN' } };
  } });
  assert.equal(statusOf((await f.run('events', { events: [event] }))[0].html), 'Events');
  assert.equal(statusOf((await f.run('events', { events: [event] }))[0].html), '日程');
  assert.equal(statusOf((await f.run('events', { events: [event] }))[0].html), '日程');
  assert.equal(attempts, 2);
});

test('并发工具调用共享同一个 app-context 请求，且在拿到语言前不调用 gog', async () => {
  const pending = deferred();
  const f = load({ appContext: () => pending.promise });
  const calls = [1, 2, 3].map(n => f.notify({ type: 'tool-call', tool: 'google_calendar_run', callId: 'call-' + n,
    args: { account: 'missing', command: ['events'], session_context: { workdir_is_local: false } } }));
  await flush();
  assert.equal(f.contextRequests.length, 1);
  assert.equal(f.messages.length, 0, 'no reply before the locale is known');
  pending.resolve({ ok: true, context: { locale: 'ko' } });
  await Promise.all(calls);
  const replies = f.messages.filter(m => m.type === 'tool-result');
  assert.deepEqual(replies.map(m => m.callId).sort(), ['call-1', 'call-2', 'call-3']);
  for (const reply of replies) assert.ok(reply.message.startsWith('실행되지 않음: '), reply.message);
  assert.equal(f.contextRequests.length, 1);
  assert.equal(f.requests.length, 0);
});

test('host-context-changed 立即切换后续卡片与错误语言，不再重复请求', async () => {
  const f = load({ locale: 'zh-CN' });
  assert.equal(statusOf((await f.run('events', { events: [event] }))[0].html), '日程');
  await f.notify({ type: 'host-context-changed', context: { region: 'global', locale: 'ja' } });
  const ja = (await f.run('events', { events: [event] }))[0].html;
  assert.equal(statusOf(ja), '予定');
  assert.ok(ja.includes('>' + heading('ja', new Date('2026-09-17T00:00:00')) + '<'));
  await f.notify({ type: 'host-context-changed', context: { locale: 'ko' } });
  assert.ok((await f.run('events', {}, {}, 'google_calendar_run', { account: 'missing' }))[0].message.startsWith('실행되지 않음: '));
  await f.notify({ type: 'host-context-changed', context: { locale: 'de' } });
  assert.equal(statusOf((await f.run('events', { events: [event] }))[0].html), 'Events');
  await f.notify({ type: 'host-context-changed' });
  assert.equal(statusOf((await f.run('events', { events: [event] }))[0].html), 'Events');
  assert.equal(f.contextRequests.length, 1);
  assert.equal(f.messages.filter(m => m.type === 'tool-result').length, 5, 'context changes never produce tool results');
});

test('首次语言请求未返回时到达的 host-context-changed 优先', async () => {
  const pending = deferred();
  const f = load({ appContext: () => pending.promise });
  const running = f.run('events', { events: [event] });
  await flush();
  await f.notify({ type: 'host-context-changed', context: { locale: 'ko' } });
  pending.resolve({ ok: true, context: { locale: 'zh-CN' } });
  assert.equal(statusOf((await running)[0].html), '일정');
  assert.equal(statusOf((await f.run('events', { events: [event] }))[0].html), '일정');
});

// ── Message tables ──
const settingsSource = readFileSync(new URL('../google-calendar/settings.js', import.meta.url), 'utf8');
// Japanese legitimately shares some strings and punctuation with Chinese.
const sharedWithZh = new Set(['settings.js ja.errorDetail']);

function assertParity(messages, label) {
  assert.deepEqual(Object.keys(messages).sort(), [...locales].sort(), `${label} locales`);
  const keys = Object.keys(messages.en).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys, `${label} ${locale} keys`);
    for (const key of keys) {
      const text = messages[locale][key];
      assert.equal(typeof text, 'string', `${label} ${locale}.${key}`);
      assert.ok(text.trim(), `${label} ${locale}.${key} is empty`);
      assert.deepEqual(placeholdersOf(text), placeholdersOf(messages.en[key]), `${label} ${locale}.${key} placeholders`);
      if (locale === 'en' || locale === 'ko') assert.doesNotMatch(text, hanRe, `${label} ${locale}.${key} contains Chinese`);
      if (locale === 'en' || locale === 'ko') assert.doesNotMatch(text, kanaRe, `${label} ${locale}.${key} contains Japanese`);
      if (locale !== 'ko') assert.doesNotMatch(text, hangulRe, `${label} ${locale}.${key} contains Korean`);
      if (locale !== 'zh-CN' && !sharedWithZh.has(`${label} ${locale}.${key}`)) {
        assert.notEqual(text, messages['zh-CN'][key], `${label} ${locale}.${key} copied from zh-CN`);
      }
    }
  }
}

test('运行时与设置页文案表：四种语言键、占位符一致，无空值，不串语言', () => {
  const { ctx } = load();
  assertParity(ctx.MESSAGES, 'main.js');
  // The settings page keeps its MESSAGES inside an IIFE, so read it through the source.
  const table = new Function(settingsSource.match(/ {2}var MESSAGES = (\{[\s\S]*?\n {2}\});/)[0] + '\nreturn MESSAGES;')();
  assertParity(table, 'settings.js');
});

test('代码引用的文案键都存在，表内没有无人使用的键', () => {
  const { ctx } = load();
  const settingsTable = new Function(settingsSource.match(/ {2}var MESSAGES = (\{[\s\S]*?\n {2}\});/)[0] + '\nreturn MESSAGES;')();
  for (const [label, text, table, dynamic] of [
    ['main.js', source, ctx.MESSAGES.en, []],
    ['settings.js', settingsSource, settingsTable.en, Object.keys(settingsTable.en).filter(key => key.startsWith('error_'))],
  ]) {
    const used = [...text.matchAll(/\bt\('(\w+)'[,)]/g), ...text.matchAll(/MESSAGES\[locale\]\.(\w+)/g)].map(m => m[1]);
    assert.ok(used.length >= 10, label);
    for (const key of used) assert.ok(Object.hasOwn(table, key), `${label} ${key}`);
    const all = new Set([...used, ...dynamic]);
    for (const key of Object.keys(table)) assert.ok(all.has(key), `${label} unused key ${key}`);
  }
  // Host OAuth error codes the settings page maps (protocol values, never translated).
  for (const code of ['NO_CLIENT_CONFIG', 'INVALID_CONFIG', 'CALLBACK_INVALID', 'EXCHANGE_FAILED', 'NETWORK',
    'TIMEOUT', 'CANCELLED', 'ACCOUNT_LIMIT', 'VAULT_WRITE_FAILED']) {
    assert.ok(Object.hasOwn(settingsTable.en, 'error_' + code), code);
  }
});

test('文案表以外（注释除外）没有硬编码中文，也不读浏览器语言', () => {
  const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Only the zh-CN and ja tables may contain Han characters (Japanese shares kanji).
  const cjkTables = /\n( +)(?:'zh-CN'|ja): \{[\s\S]*?\n\1\},(?=\n)/g;
  for (const [label, text] of [['main.js', source], ['settings.js', settingsSource]]) {
    const outside = stripComments(text).replace(cjkTables, '');
    assert.deepEqual(outside.split('\n').filter(line => hanRe.test(line)), [], label);
    assert.doesNotMatch(text, /navigator\.language/, label);
  }
});

test('英文文案使用正式名称 Google Calendar', () => {
  const { ctx } = load();
  for (const text of Object.values(ctx.MESSAGES.en)) assert.doesNotMatch(text, /\(Rui\)|ruivalim/i);
  assert.match(source, /var PLUGIN_NAME = 'Google Calendar';/);
});

// ── Settings page ──
const settingsCopy = {
  'zh-CN': { CANCELLED: '授权已取消', NETWORK: '连接 Google 失败，请检查网络后重试', detail: '授权已取消（user closed）',
    loadFailed: '账号状态加载失败，请重试', opened: '已打开浏览器，请完成 Google Calendar 授权…', connected: '已连接 work@example.test',
    connectedNoLabel: '已连接 账号',
    other: '已连接 other@example.test；这不是所选账号，work@example.test 仍需重新连接。', reauth: '请在浏览器中选择 work@example.test，重新授权此账号。',
    unknown: '无法确认连接结果，请重新打开插件详情核对账号状态，再决定是否重试。', title: '已连接的账户' },
  en: { CANCELLED: 'Authorization cancelled', NETWORK: 'Could not connect to Google. Check your network and try again.', detail: 'Authorization cancelled (user closed)',
    loadFailed: 'Could not load the account status. Try again.', opened: 'Browser opened. Complete the Google Calendar authorization...', connected: 'Connected work@example.test',
    connectedNoLabel: 'Connected account',
    other: 'Connected other@example.test, but that is not the selected account; work@example.test still needs to be reconnected.', reauth: 'In the browser, select work@example.test to reauthorize this account.',
    unknown: 'Connection outcome is unknown. Reopen plugin details and check the account status before deciding whether to retry.', title: 'Connected accounts' },
  ja: { CANCELLED: '認証がキャンセルされました', NETWORK: 'Google に接続できませんでした。ネットワークを確認して再試行してください。', detail: '認証がキャンセルされました（user closed）',
    loadFailed: 'アカウントの状態を読み込めませんでした。再試行してください。', opened: 'ブラウザを開きました。Google Calendar の認証を完了してください…', connected: 'work@example.test を接続しました',
    connectedNoLabel: 'アカウント を接続しました',
    other: 'other@example.test を接続しましたが、選択したアカウントではありません。work@example.test はまだ再接続が必要です。', reauth: 'ブラウザで work@example.test を選択し、このアカウントを再認証してください。',
    unknown: '接続結果を確認できません。プラグインの詳細を開き直してアカウントの状態を確認してから、再試行するか判断してください。', title: '接続済みアカウント' },
  ko: { CANCELLED: '인증이 취소되었습니다', NETWORK: 'Google에 연결하지 못했습니다. 네트워크를 확인한 후 다시 시도하세요.', detail: '인증이 취소되었습니다 (user closed)',
    loadFailed: '계정 상태를 불러오지 못했습니다. 다시 시도하세요.', opened: '브라우저를 열었습니다. Google Calendar 인증을 완료하세요…', connected: 'work@example.test 연결됨',
    connectedNoLabel: '계정 연결됨',
    other: 'other@example.test 계정을 연결했지만 선택한 계정이 아닙니다. work@example.test 계정은 아직 다시 연결해야 합니다.', reauth: '브라우저에서 work@example.test 계정을 선택해 이 계정을 다시 인증하세요.',
    unknown: '연결 결과를 확인할 수 없습니다. 플러그인 상세 페이지를 다시 열어 계정 상태를 확인한 후 재시도 여부를 결정하세요.', title: '연결된 계정' },
};

function settingsPage(locale, connectResults, options = {}) {
  const nodes = {};
  let reconnect, oauthFails = false;
  const statuses = [];
  const document = { documentElement: { lang: 'zh-CN' }, getElementById: id => nodes[id] ||= {} };
  const ctx = createContext({
    AbortController, setTimeout, clearTimeout, document,
    navigator: { language: 'zh-CN' },
    googleAccountMetadata: { list: async (_key, accounts) => accounts },
    window: { renderGoogleAccounts: (_key, _accounts, _reload, connect) => { reconnect = connect; } },
    fetch: async (url, init = {}) => {
      if (url === '/app-context') {
        if (options.appContext) return options.appContext();
        return { ok: true, json: async () => ({ ok: true, context: { locale } }) };
      }
      if (url === '/oauth') {
        if (oauthFails) return { ok: false, status: 500 };
        return { ok: true, json: async () => JSON.parse(JSON.stringify(connected)) };
      }
      assert.equal(url, '/oauth/google_calendar_account/connect');
      assert.equal(init.method, 'POST');
      const next = connectResults.shift();
      if (next instanceof Error) throw next;
      return { ok: true, json: async () => next };
    },
  });
  Object.defineProperty(nodes, 'status', { value: { set textContent(text) { statuses.push(text); } } });
  runInContext(settingsSource, ctx);
  return { nodes, statuses, document, connect: target => reconnect(target), failOAuth: () => { oauthFails = true; } };
}

for (const locale of [...locales, 'fr']) {
  test(`${locale}: 设置页连接状态与 OAuth 错误按宿主语言显示`, async () => {
    const expected = settingsCopy[locale] || settingsCopy.en;
    const page = settingsPage(locale, [
      { ok: false, error: 'CANCELLED' }, { ok: false, error: 'NETWORK' }, { ok: false, error: 'CANCELLED', detail: ' user closed ' },
      { ok: true, account: { id: 'acc-1', label: 'work@example.test' } },
      { ok: true, account: { id: 'acc-9', label: 'other@example.test' } },
      { ok: true },
      { ok: false, error: 'toString' },
      new Error('transport'),
      { ok: false, error: 'CANCELLED' },
    ]);
    await flush();
    assert.equal(page.document.documentElement.lang, locale === 'fr' ? 'en' : locale);
    assert.equal(page.nodes['settings-title'].textContent, expected.title);
    const target = { id: 'acc-1', label: 'work@example.test' };
    for (const [connectTarget, message] of [[undefined, 'CANCELLED'], [undefined, 'NETWORK'], [undefined, 'detail'],
      [undefined, 'connected'], [target, 'other'], [undefined, 'connectedNoLabel']]) {
      await page.connect(connectTarget);
      assert.equal(page.statuses.at(-1), expected[message], message);
      assert.equal(page.statuses.at(-2), connectTarget ? expected.reauth : expected.opened);
    }
    // Unknown codes (including inherited property names) and transport failures keep the "outcome unknown" copy.
    await page.connect();
    assert.equal(page.statuses.at(-1), expected.unknown);
    await page.connect();
    assert.equal(page.statuses.at(-1), expected.unknown);
    page.failOAuth();
    await page.connect();
    assert.equal(page.statuses.at(-2), expected.CANCELLED);
    assert.equal(page.statuses.at(-1), expected.loadFailed);
  });
}

test('设置页 /app-context 失败时回退英文，不读 settings.html 的 lang 或浏览器语言', async () => {
  for (const appContext of [() => ({ ok: false, status: 404 }), () => { throw new Error('offline'); },
    () => ({ ok: true, json: async () => ({ ok: true, context: { locale: 'zh-TW' } }) })]) {
    const page = settingsPage('zh-CN', [{ ok: false, error: 'TIMEOUT' }], { appContext });
    await flush();
    assert.equal(page.document.documentElement.lang, 'en');
    assert.equal(page.nodes['settings-title'].textContent, 'Connected accounts');
    await page.connect();
    assert.equal(page.statuses.at(-1), 'Timed out waiting for authorization. Try again.');
  }
  assert.doesNotMatch(settingsSource, /navigator\.language/);
});
