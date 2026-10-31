import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

const githubSource = readFileSync(
  new URL('../cindy-github/main.js', import.meta.url),
  'utf8',
);
const settingsSource = readFileSync(
  new URL('../cindy-github/settings.js', import.meta.url),
  'utf8',
);
const manifest = JSON.parse(
  readFileSync(new URL('../cindy-github/ghost.json', import.meta.url), 'utf8'),
);

function jsonResponse(data, status = 200) {
  return { ok: true, status, body: JSON.stringify(data), headers: {} };
}

async function testConnection() {
  let channel;
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });

  class FakeBroadcastChannel {
    constructor() { channel = this; }

    postMessage(message) {
      if (message?.type === 'test-connection-result') resolveResult(message);
    }
  }

  const fetch = async (url) => { throw new Error(`unexpected fetch: ${url}`); };

  const cindy = {
    onHostMessage() {},
    send() {},
    fetch: async (request) => {
      assert.equal(request.url, 'https://api.github.com/user');
      return jsonResponse({ login: 'octocat' });
    },
  };

  new Script(githubSource, { filename: 'cindy-github/main.js' }).runInContext(
    createContext({
      cindy,
      BroadcastChannel: FakeBroadcastChannel,
      fetch,
      setTimeout,
      clearTimeout,
      URL,
      encodeURIComponent,
    }),
  );

  await channel.onmessage({ data: { type: 'test-connection', reqId: 'req-1' } });
  const message = await result;
  assert.equal(message.ok, true);
}

test('manifest pins host GitHub login injection to the GitHub API', () => {
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.minCindyVersion, '0.1.112');
  assert.equal('slots' in manifest, false);
  assert.equal(manifest.notify, true);
  assert.equal(manifest.fs, true);
  // PR card: the title links to the PR; agent turns only on clicks, no background runs.
  assert.deepEqual(manifest.card, { externalLinks: true });
  assert.deepEqual(manifest.agent, {});
  const auth = manifest.network?.secrets?.find((secret) => secret.key === 'github_pat');
  assert.equal(manifest.version, '1.4.0');
  assert.deepEqual(auth, {
    key: 'github_pat',
    label: 'GitHub 登录',
    source: 'gh-cli',
    hint: '宿主优先使用本机 GitHub 登录；不可用时可粘贴备用 Token',
    url: 'https://github.com/settings/tokens',
    inject: {
      header: 'Authorization',
      format: 'Bearer {value}',
      hosts: ['api.github.com'],
    },
  });
});

test('connection tests never cache an identity that the plugin cannot attribute atomically', async () => {
  await testConnection();
  assert.doesNotMatch(githubSource, /connectedLogin|connectedSource/);
});

test('settings show only host availability and fallback-token storage state', () => {
  assert.match(settingsSource, /function renderHostAccount\(available\)/);
  assert.doesNotMatch(settingsSource, /renderHostAccount\(hostAvailable,\s*\w+/);
  assert.doesNotMatch(settingsSource, /connectedLogin|connectedSource|fetch\(['"]\/kv/);
  assert.doesNotMatch(settingsSource, /else void test\(\)/);
  assert.match(settingsSource, /检查当前 GitHub 连接/);
  assert.doesNotMatch(settingsSource, /gh auth token/);
});

for (const [managed, available, saved] of [[true, true, true], [true, false, true], [false, true, false]]) {
  test(`settings adapt to host account UI: managed=${managed}, gh=${available}, fallback=${saved}`, async () => {
    const elements = new Map();
    const element = () => ({ value: '', textContent: '', hidden: false, open: false,
      classList: { toggle() {}, remove() {} }, appendChild() {}, addEventListener() {} });
    const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element,
      documentElement: { lang: 'zh-CN' }, querySelectorAll: () => [] };
    new Script(settingsSource).runInContext(createContext({
      document, BroadcastChannel: class {}, setTimeout: () => 0, clearTimeout() {}, AbortController,
      fetch: async (url) => (url === '/app-context'
        ? { ok: true, json: async () => ({ ok: true, context: { locale: 'zh-CN' } }) }
        : { json: async () => [{ key: 'github_pat', saved,
          hostSource: 'gh-cli', hostAvailable: available, ...(managed ? { hostManagedSetup: true } : {}) }] }),
    }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(elements.get('legacy-account').hidden, managed);
    assert.equal(elements.get('test').hidden, managed);
    assert.equal(elements.get('other-methods')?.open ?? false, !available && saved);
  });
}

/* ── Localization (docs/localization.md) ─────────────────────────────── */

const settingsHtml = readFileSync(new URL('../cindy-github/settings.html', import.meta.url), 'utf8');
const hostLocales = ['zh-CN', 'en', 'ja', 'ko'];
const placeholdersOf = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const catalogTokensOf = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const hanRe = /[一-鿿]/;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

// The runtime harness reports zh-CN unless a test picks another locale, so the
// Chinese assertions keep checking the original copy.
function createRuntime(options = {}) {
  let handler = null;
  let channel = null;
  const sent = [];
  const appContextRequests = [];
  const fetches = [];
  const cindy = {
    async request(message) {
      assert.deepEqual(JSON.parse(JSON.stringify(message)), { kind: 'app-context' });
      appContextRequests.push(message);
      if (options.appContext) return options.appContext();
      return { ok: true, context: { region: 'cn', locale: options.locale ?? 'zh-CN' } };
    },
    onHostMessage(fn) { handler = fn; },
    send(message) { sent.push(message); return Promise.resolve({ ok: true }); },
    async fetch(request) {
      fetches.push(request);
      if (options.github) return options.github(request);
      return { ok: true, status: 200, body: '{}', headers: {} };
    },
  };
  if (options.withoutRequest) delete cindy.request;
  class FakeBroadcastChannel {
    constructor(name) { assert.equal(name, 'cindy-github'); channel = this; this.posted = []; }
    postMessage(message) { this.posted.push(message); }
  }
  const context = createContext({
    cindy,
    BroadcastChannel: FakeBroadcastChannel,
    fetch: async (url) => { throw new Error(`unexpected fetch: ${url}`); },
    setTimeout: options.setTimeout ?? setTimeout,
    clearTimeout,
    URL,
    encodeURIComponent,
  });
  new Script(githubSource, { filename: 'cindy-github/main.js' }).runInContext(context);
  assert.equal(typeof handler, 'function');
  let seq = 0;
  return {
    context,
    sent,
    fetches,
    appContextRequests,
    get channel() { return channel; },
    hostMessage: (message) => handler(message),
    async tool(tool, args = {}) {
      const callId = `call-${++seq}`;
      await handler({ type: 'tool-call', tool, callId, args });
      return sent.filter((m) => m.type === 'tool-result' && m.callId === callId).at(-1);
    },
  };
}

function createSettings(options = {}) {
  const elements = new Map();
  const element = () => ({
    value: '', textContent: '', hidden: false, open: false, disabled: false, placeholder: '', type: 'password',
    classList: { toggle() {}, remove() {} }, appendChild(child) { (this.children ??= []).push(child); },
    addEventListener(type, fn) { (this.listeners ??= {})[type] = fn; },
    set innerHTML(v) { this.children = []; },
  });
  const copyNodes = {};
  for (const attribute of ['data-i18n', 'data-i18n-title', 'data-i18n-placeholder']) {
    const re = new RegExp(`\\s${attribute}="(\\w+)"`, 'g');
    copyNodes[attribute] = [...settingsHtml.matchAll(re)].map((m) => {
      const attrs = new Map([[attribute, m[1]]]);
      return { textContent: '', getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null), setAttribute: (n, v) => attrs.set(n, v) };
    });
  }
  const fetchCalls = [];
  const document = {
    documentElement: { lang: 'zh-CN' },
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element,
    querySelectorAll(selector) {
      const match = /^\[(data-i18n(?:-title|-placeholder)?)\]$/.exec(selector);
      assert.ok(match, `unexpected selector ${selector}`);
      return copyNodes[match[1]];
    },
  };
  const context = createContext({
    document,
    AbortController,
    BroadcastChannel: class { postMessage() {} addEventListener() {} removeEventListener() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    clearInterval() {},
    setInterval: () => 0,
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url, init });
      if (url === '/app-context') {
        if (options.appContext) return options.appContext();
        return { ok: true, json: async () => ({ ok: true, context: { region: 'cn', locale: options.locale ?? 'zh-CN' } }) };
      }
      if (url === '/secrets') {
        if (options.secretsFail) throw new Error('offline');
        return { ok: true, json: async () => [{ key: 'github_pat', saved: options.saved ?? false, tail: options.tail,
          hostSource: 'gh-cli', hostAvailable: options.hostAvailable ?? false }] };
      }
      if (options.secretWrite) return options.secretWrite(url, init);
      return { status: 204 };
    },
  });
  new Script(settingsSource, { filename: 'cindy-github/settings.js' }).runInContext(context);
  return { context, document, elements, copyNodes, fetchCalls, messages: context.MESSAGES };
}

function assertParity(tables, label, { allowJaSameAsZh = new Set(), allowSameAsZh = new Set() } = {}) {
  assert.deepEqual(Object.keys(tables).sort(), [...hostLocales].sort(), `${label} locales`);
  const keys = Object.keys(tables.en).sort();
  for (const locale of hostLocales) {
    assert.deepEqual(Object.keys(tables[locale]).sort(), keys, `${label} ${locale} keys`);
    for (const key of keys) {
      const text = tables[locale][key];
      assert.equal(typeof text, 'string', `${label} ${locale}.${key}`);
      assert.ok(text.trim(), `${label} ${locale}.${key} is empty`);
      assert.deepEqual(placeholdersOf(text), placeholdersOf(tables.en[key]), `${label} ${locale}.${key} placeholders`);
      if (locale === 'en' || locale === 'ko') assert.doesNotMatch(text, hanRe, `${label} ${locale}.${key} still has Chinese`);
      if (locale !== 'zh-CN' && !allowSameAsZh.has(key) && !(locale === 'ja' && allowJaSameAsZh.has(key))) {
        assert.notEqual(text, tables['zh-CN'][key], `${label} ${locale}.${key} copied from zh-CN`);
      }
    }
  }
}

test('runtime, catalog and settings tables have identical keys and placeholders in all four locales', () => {
  const runtime = createRuntime().context;
  assertParity(runtime.MESSAGES, 'main.js MESSAGES');
  assertParity(runtime.PARAM_NOTES, 'main.js PARAM_NOTES');
  assertParity(createSettings().messages, 'settings.js', { allowJaSameAsZh: new Set(['save']) });

  // Catalog descriptions: zh-CN stays next to each op() / in CATEGORIES; en/ja/ko are keyed by
  // the stable operation and category names and must cover exactly the same set.
  const opNames = Object.keys(runtime.OPS).sort();
  const catNames = Object.keys(runtime.CATEGORIES).sort();
  assert.equal(opNames.length, 117);
  assert.equal(catNames.length, 15);
  for (const locale of ['en', 'ja', 'ko']) {
    assert.deepEqual(Object.keys(runtime.OP_DESC[locale]).sort(), opNames, `OP_DESC ${locale}`);
    assert.deepEqual(Object.keys(runtime.CATEGORY_DESC[locale]).sort(), catNames, `CATEGORY_DESC ${locale}`);
    for (const name of opNames) {
      const text = runtime.OP_DESC[locale][name];
      assert.ok(text.trim(), `${locale} ${name}`);
      assert.deepEqual(catalogTokensOf(text), catalogTokensOf(runtime.OPS[name].desc), `${locale} ${name} tokens`);
      if (locale !== 'ja') assert.doesNotMatch(text, hanRe, `${locale} ${name}`);
    }
  }
  // Every {{note}} used in operation params or descriptions has a translation.
  for (const name of opNames) {
    for (const token of [...catalogTokensOf(runtime.OPS[name].params), ...catalogTokensOf(runtime.OPS[name].desc)]) {
      assert.ok(Object.hasOwn(runtime.PARAM_NOTES.en, token), `${name} uses unknown note ${token}`);
    }
  }
});

test('every message key referenced by code or settings.html exists in the tables', () => {
  const runtime = createRuntime().context.MESSAGES;
  const mainKeys = [...githubSource.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(mainKeys.length >= 30);
  for (const key of mainKeys) assert.ok(Object.hasOwn(runtime.en, key), `main.js ${key}`);
  const usedMain = new Set([...mainKeys, 'required']);
  for (const key of Object.keys(runtime.en)) assert.ok(usedMain.has(key), `unused main.js key ${key}`);

  const settings = createSettings().messages;
  const settingsKeys = [
    ...settingsSource.matchAll(/\bt\('(\w+)'/g),
    ...settingsHtml.matchAll(/data-i18n(?:-title|-placeholder)?="(\w+)"/g),
  ].map((m) => m[1]);
  for (const key of settingsKeys) assert.ok(Object.hasOwn(settings.en, key), `settings ${key}`);
  const usedSettings = new Set(settingsKeys);
  for (const key of Object.keys(settings.en)) assert.ok(usedSettings.has(key), `unused settings key ${key}`);
});

test('no hardcoded Chinese copy remains outside comments, the tables and the zh-CN catalog source', () => {
  const stripComments = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  // zh-CN and ja blocks of every table (ja shares kanji with Chinese).
  const cjkTables = /\n {2}(?:'zh-CN'|ja): \{[\s\S]*?\n {2}\},(?=\n)/g;
  const mainOutside = stripComments(githubSource)
    .replace(cjkTables, '')
    .replace(/\nvar CATEGORIES = \{[\s\S]*?\n\};/, '')
    .replace(/\bop\('\w+', '\w+', '(?:[^'\\]|\\.)*'/g, '');
  for (const [label, text] of [
    ['main.js', mainOutside],
    ['settings.js', stripComments(settingsSource).replace(cjkTables, '')],
    ['settings.html', stripComments(settingsHtml)],
  ]) {
    const offenders = text.split('\n').filter((line) => hanRe.test(line));
    assert.deepEqual(offenders, [], label);
  }
});

test('neither the runtime nor the settings page reads the browser language', () => {
  for (const text of [githubSource, settingsSource, settingsHtml]) {
    assert.doesNotMatch(text, /navigator\s*\.\s*language/);
  }
});

test('zh-CN tables keep the original Simplified Chinese text', () => {
  const runtime = createRuntime().context.MESSAGES['zh-CN'];
  assert.equal(runtime.status401, 'GitHub 授权未配置或已失效，请到「插件」→「GitHub」详情页重新连接账号，或更换备用 Token');
  assert.equal(runtime.status403, '此操作没有权限(HTTP 403)，请检查仓库访问权及授权范围；账号的其他功能可能仍可使用：{detail}');
  assert.equal(runtime.noBaseTree, '取不到 head commit 的 base tree,拒绝继续(避免建出丢失其余文件的孤儿树)');
  assert.equal(runtime.saveDirRequired, '下载需要落盘目录——请主 agent 调 ghost_call 时把目标目录绝对路径放在顶层 save_dir 参数');
  const settings = createSettings().messages['zh-CN'];
  assert.equal(settings.accountHint, '优先使用本机 GitHub 登录，也可以展开下方的其他连接方式。');
  assert.equal(settings.savedTestHint, '备用 Token 已保存；点击“测试连接”可检查当前 GitHub 连接');
  assert.equal(settings.testTimeout, '测试超时——电子脑未响应,请稍后重试');
  assert.equal(settings.tokenFormat, 'ghp_… 或 github_pat_…');
});

function githubStatus(status, body = '') {
  return () => ({ ok: true, status, body, headers: {} });
}

test('zh-CN runtime output is byte-identical to the previous hardcoded strings', async () => {
  const repo = { owner: 'o', repo: 'r' };
  const cases = [
    [401, '', 'GitHub 授权未配置或已失效，请到「插件」→「GitHub」详情页重新连接账号，或更换备用 Token'],
    [403, 'API rate limit exceeded', 'GitHub 接口限流(HTTP 403 rate limit),请稍后重试'],
    [403, 'forbidden', '此操作没有权限(HTTP 403)，请检查仓库访问权及授权范围；账号的其他功能可能仍可使用：forbidden'],
    [404, '', '对象不存在或无访问权(HTTP 404)'],
    [422, 'bad', 'GitHub 拒绝了请求参数(HTTP 422):bad'],
    [429, '', 'GitHub 接口限流(HTTP 429),请稍后重试'],
    [502, 'gateway', 'GitHub API 返回 HTTP 502:gateway'],
  ];
  for (const [status, body, message] of cases) {
    const runtime = createRuntime({ github: githubStatus(status, body) });
    const result = await runtime.tool('call_tool', { name: 'get_issue', args: { ...repo, issue_number: 1 } });
    assert.equal(result.message, message + '\n该操作参数:owner*:string, repo*:string(成对必填), issue_number*:int');
  }
  const runtime = createRuntime();
  assert.equal((await runtime.tool('call_tool', { name: 'get_issue', args: repo })).message,
    '需要 issue_number\n该操作参数:owner*:string, repo*:string(成对必填), issue_number*:int');
  assert.match((await runtime.tool('call_tool', { name: 'get_issue', args: {} })).message,
    /^repo 级操作必须显式传 owner 与 repo\(在 git 仓库里工作时,主 agent 可用 `git remote get-url origin` 推导后传入\)\n/);
  assert.equal((await runtime.tool('call_tool', {})).message, '需要 name(list_tools 可查)');
  assert.match((await runtime.tool('call_tool', { name: 'nope' })).message, /^未知操作:nope——用 list_tools 查目录\(类目:issues \/ pulls/);
  assert.match((await runtime.tool('list_tools', { category: 'nope' })).message, /^未知类目:nope\(可用:issues \/ pulls/);
  assert.equal((await runtime.tool('zzz')).message, '未知工具:zzz');

  const overview = (await runtime.tool('list_tools')).result;
  assert.equal(overview.hint, '传 category 看该类目下的操作明细;执行用 call_tool({name, args})。repo 级操作必须显式传 owner/repo。');
  assert.deepEqual(JSON.parse(JSON.stringify(overview.categories.reactions)), { count: 6, description: 'issue / 评论 / 行评 reaction' });
  const reactions = (await runtime.tool('list_tools', { category: 'reactions' })).result;
  assert.equal(reactions.hint, '执行用 call_tool({name, args});参数记法:* 必填,pp = per_page/page。');
  assert.deepEqual(JSON.parse(JSON.stringify(reactions.tools[0])), {
    name: 'list_issue_reactions',
    description: '列 issue 的 reaction(content 枚举:+1|-1|laugh|confused|heart|hooray|rocket|eyes)',
    params: 'owner*:string, repo*:string(成对必填), issue_number*:int, content?, per_page?:1-100, page?:int',
  });
  const repoTools = (await runtime.tool('list_tools', { category: 'repo' })).result.tools;
  assert.equal(repoTools.find((t) => t.name === 'create_or_update_file_contents').params,
    'owner*:string, repo*:string(成对必填), path*, message*, content*:base64, sha?(改文件必填), branch?, committer?:{name*,email*}, author?:{name*,email*}');
});

test('runtime copy and catalog fall back to English for unsupported or unavailable host locales', async () => {
  const variants = {
    unsupported: { locale: 'fr' },
    legacyTag: { locale: 'zh-TW' },
    notOk: { appContext: () => ({ ok: false }) },
    missingLocale: { appContext: () => ({ ok: true, context: {} }) },
    throws: { appContext: () => { throw new Error('host unavailable'); } },
    noRequestApi: { withoutRequest: true },
    hangs: { appContext: () => new Promise(() => {}), setTimeout: (fn) => { setImmediate(fn); return 1; } },
  };
  for (const [label, options] of Object.entries(variants)) {
    const runtime = createRuntime({ ...options, github: githubStatus(404) });
    const en = runtime.context.MESSAGES.en;
    const result = await runtime.tool('call_tool', { name: 'get_issue', args: { owner: 'o', repo: 'r', issue_number: 1 } });
    assert.equal(result.message, `${en.status404}\nParameters for this operation: owner*:string, repo*:string(required together), issue_number*:int`, label);
    const list = (await runtime.tool('list_tools', { category: 'issues' })).result;
    assert.equal(list.tools[0].description, runtime.context.OP_DESC.en.list_issues, label);
    assert.doesNotMatch(JSON.stringify(list), hanRe, label);
  }
});

test('English catalog covers every category and operation without Chinese', async () => {
  const runtime = createRuntime({ locale: 'en' });
  const overview = (await runtime.tool('list_tools')).result;
  assert.doesNotMatch(JSON.stringify(overview), hanRe);
  let total = 0;
  for (const category of Object.keys(overview.categories)) {
    const result = (await runtime.tool('list_tools', { category })).result;
    total += result.tools.length;
    const text = JSON.stringify(result);
    assert.doesNotMatch(text, hanRe, category);
    assert.doesNotMatch(text, /\{\{/, category);
  }
  assert.equal(total, 117);
});

for (const locale of ['ja', 'ko']) {
  test(`${locale} runtime copy and catalog are used and protocol values stay intact`, async () => {
    const runtime = createRuntime({ locale, github: githubStatus(422, 'Validation Failed') });
    const { MESSAGES, OP_DESC, CATEGORY_DESC, PARAM_NOTES } = runtime.context;
    const m = MESSAGES[locale];
    const failure = await runtime.tool('call_tool', { name: 'get_issue', args: { owner: 'o', repo: 'r', issue_number: 1 } });
    const params = `owner*:string, repo*:string(${PARAM_NOTES[locale].pairRequired}), issue_number*:int`;
    assert.equal(failure.message, m.withOperationParams
      .replace('{error}', m.status422.replace('{detail}', 'Validation Failed'))
      .replace('{params}', params));
    assert.match(failure.message, /422/);

    const missing = await runtime.tool('call_tool', { name: 'create_pull_request', args: { owner: 'o', repo: 'r' } });
    assert.ok(missing.message.startsWith(m.required.replace('{fields}', 'title / head / base')));

    const overview = (await runtime.tool('list_tools')).result;
    assert.equal(overview.hint, m.overviewHint);
    assert.equal(overview.categories.pulls.description, CATEGORY_DESC[locale].pulls);
    const pulls = (await runtime.tool('list_tools', { category: 'pulls' })).result;
    assert.equal(pulls.category, 'pulls');
    const merge = pulls.tools.find((t) => t.name === 'merge_pull_request');
    assert.equal(merge.description, OP_DESC[locale].merge_pull_request);
    assert.match(merge.params, /merge_method\?:merge\|squash\|rebase/);
    assert.ok(merge.params.includes(PARAM_NOTES[locale].headCheck));
    if (locale === 'ko') assert.doesNotMatch(JSON.stringify(pulls), hanRe);
    assert.equal((await runtime.tool('zzz')).message, m.unknownTool.replace('{tool}', 'zzz'));
  });
}

test('host-context-changed switches runtime copy without another app-context request', async () => {
  const runtime = createRuntime({ locale: 'zh-CN', github: githubStatus(404) });
  const args = { name: 'get_issue', args: { owner: 'o', repo: 'r', issue_number: 1 } };
  const { MESSAGES } = runtime.context;
  assert.match((await runtime.tool('call_tool', args)).message, /^对象不存在或无访问权/);
  assert.equal(runtime.appContextRequests.length, 1);
  for (const locale of ['ko', 'ja']) {
    await runtime.hostMessage({ type: 'host-context-changed', context: { region: 'global', locale } });
    assert.ok((await runtime.tool('call_tool', args)).message.startsWith(MESSAGES[locale].status404));
  }
  await runtime.hostMessage({ type: 'host-context-changed', context: { locale: 'xx' } });
  assert.ok((await runtime.tool('call_tool', args)).message.startsWith(MESSAGES.en.status404));
  await runtime.hostMessage({ type: 'host-context-changed', context: { locale: 'zh-CN' } });
  assert.equal((await runtime.tool('list_tools')).result.categories.gists.description, 'gist');
  await runtime.hostMessage({ type: 'host-context-changed' });
  assert.ok((await runtime.tool('call_tool', args)).message.startsWith(MESSAGES.en.status404));
  assert.equal(runtime.appContextRequests.length, 1);
});

test('a locale change that arrives during the app-context request wins over the stale reply', async () => {
  const pending = deferred();
  const runtime = createRuntime({ appContext: () => pending.promise });
  const listing = runtime.tool('zzz');
  await flushAsync();
  await runtime.hostMessage({ type: 'host-context-changed', context: { locale: 'ja' } });
  pending.resolve({ ok: true, context: { locale: 'zh-CN' } });
  const ja = runtime.context.MESSAGES.ja.unknownTool.replace('{tool}', 'zzz');
  assert.equal((await listing).message, ja);
  assert.equal((await runtime.tool('zzz')).message, ja);
});

test('concurrent tool calls share one app-context request and all use the host locale', async () => {
  const pending = deferred();
  const runtime = createRuntime({ appContext: () => pending.promise, github: githubStatus(401) });
  const calls = [1, 2, 3].map(() => runtime.tool('call_tool', { name: 'get_issue', args: { owner: 'o', repo: 'r', issue_number: 1 } }));
  await flushAsync();
  assert.equal(runtime.appContextRequests.length, 1);
  assert.equal(runtime.fetches.length, 0, 'no GitHub request before the locale is known');
  pending.resolve({ ok: true, context: { locale: 'ko' } });
  for (const result of await Promise.all(calls)) {
    assert.ok(result.message.startsWith(runtime.context.MESSAGES.ko.status401));
  }
});

test('a failed app-context lookup is retried on the next call instead of pinning English', async () => {
  let attempts = 0;
  const runtime = createRuntime({
    appContext: () => {
      attempts += 1;
      if (attempts === 1) throw new Error('host busy');
      return { ok: true, context: { locale: 'zh-CN' } };
    },
  });
  assert.equal((await runtime.tool('zzz')).message, 'Unknown tool: zzz');
  assert.equal((await runtime.tool('zzz')).message, '未知工具:zzz');
  assert.equal((await runtime.tool('zzz')).message, '未知工具:zzz');
  assert.equal(attempts, 2);
});

test('settings connection test reports in the host locale', async () => {
  for (const [locale, expectFail, expectOk] of [
    ['zh-CN', 'GitHub 连接测试失败:对象不存在或无访问权(HTTP 404)', '连接成功:@octocat'],
    ['ja', null, null],
  ]) {
    for (const status of [404, 200]) {
      const runtime = createRuntime({ locale, github: status === 200
        ? () => ({ ok: true, status: 200, body: JSON.stringify({ login: 'octocat' }), headers: {} })
        : githubStatus(404) });
      await runtime.channel.onmessage({ data: { type: 'test-connection', reqId: `r-${status}` } });
      await flushAsync();
      const m = runtime.context.MESSAGES[locale];
      const notify = runtime.sent.find((x) => x.type === 'notify');
      const result = runtime.channel.posted.find((x) => x.type === 'test-connection-result');
      if (status === 404) {
        assert.equal(result.ok, false);
        assert.equal(result.message, m.status404);
        assert.equal(notify.text, expectFail ?? m.testFailedNotify.replace('{detail}', m.status404));
        assert.equal(notify.tone, 'error');
      } else {
        assert.equal(result.login, 'octocat');
        assert.equal(notify.text, expectOk ?? m.testSucceededNotify.replace('{login}', 'octocat'));
      }
    }
  }
});

for (const locale of hostLocales) {
  test(`settings page renders ${locale} copy from /app-context`, async () => {
    const page = createSettings({ locale, saved: true, tail: 'abcd' });
    await flushAsync();
    const m = page.messages[locale];
    assert.equal(page.fetchCalls[0].url, '/app-context', 'locale is resolved before any copy is rendered');
    assert.equal(page.document.documentElement.lang, locale);
    assert.equal(page.copyNodes['data-i18n'].length, 8);
    for (const node of page.copyNodes['data-i18n']) {
      const key = node.getAttribute('data-i18n');
      if (key !== 'save') assert.equal(node.textContent, m[key], key);
    }
    assert.equal(page.copyNodes['data-i18n-title'][0].getAttribute('title'), m.eyeTitle);
    assert.equal(page.copyNodes['data-i18n-placeholder'][0].getAttribute('placeholder'), m.tokenFormat);
    // A saved fallback token switches the input row to "replace".
    assert.equal(page.elements.get('save').textContent, m.replace);
    assert.equal(page.elements.get('token').placeholder, m.placeholderReplace);
    const fallbackRow = page.elements.get('fallback-account').children[0];
    assert.equal(fallbackRow.children[0].textContent, m.fallbackSaved);
    assert.equal(fallbackRow.children[1].textContent, m.tail.replace('{tail}', 'abcd'));
    const hostRow = page.elements.get('host-account').children[0];
    assert.equal(hostRow.children[0].textContent, m.hostNotConnected);
    assert.equal(hostRow.children[1].textContent, m.fallbackUsable);
    page.elements.get('save').listeners.click();
    assert.equal(page.elements.get('status').textContent, m.pasteFirst);
  });
}

test('settings page falls back to English for unknown, failed or malformed app-context', async () => {
  const variants = [
    () => ({ ok: true, json: async () => ({ ok: true, context: { locale: 'de' } }) }),
    () => ({ ok: false, json: async () => ({}) }),
    () => { throw new Error('offline'); },
    () => ({ ok: true, json: async () => null }),
  ];
  for (const appContext of variants) {
    const page = createSettings({ appContext, secretsFail: true });
    await flushAsync();
    assert.equal(page.document.documentElement.lang, 'en');
    assert.equal(page.elements.get('status').textContent, 'Could not load the status. Try again later.');
  }
});

test('settings.html ships no hardcoded copy before the host locale is known', () => {
  const body = settingsHtml.slice(settingsHtml.indexOf('<body>'));
  assert.doesNotMatch(body.replace(/<!--[\s\S]*?-->/g, ''), hanRe);
  assert.doesNotMatch(body, /\splaceholder="|\stitle="/);
});

/* ── PR card (pr_card) ───────────────────────────────────────────────── */

// Production entry: the plugin's tool-call and card-action handlers. The host renders the
// card HTML on desktop and projects only its text plus aria-label buttons on the phone,
// so the visible text and the actions handed to the task's agent are the contract.
const zhCopy = createRuntime().context.MESSAGES['zh-CN'];
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));

function visibleText(html) {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<\/(?:div|p)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function prGraphql({ number = 42, title = 'Built-in PR skill', ci = 'SUCCESS', threads = [], mergeState = 'CLEAN', merged = false } = {}) {
  return (request) => {
    assert.equal(request.url, 'https://api.github.com/graphql');
    assert.deepEqual(JSON.parse(request.body).variables, { owner: 'octo', name: 'repo', number });
    return jsonResponse({ data: { repository: { pullRequest: {
      number, title, url: `https://github.com/octo/repo/pull/${number}`, state: merged ? 'MERGED' : 'OPEN',
      isDraft: false, merged, mergeStateStatus: mergeState, reviewDecision: null, baseRefName: 'main',
      commits: { nodes: [{ commit: { statusCheckRollup: ci ? { state: ci } : null } }] },
      reviewThreads: { nodes: threads.map((isResolved) => ({ isResolved })) },
    } } } });
  };
}

function createPrRuntime(options = {}) {
  let handler = null;
  const sent = [];
  const files = new Map();
  const agentRuns = [];
  let kv = options.kv ?? {};
  const cindy = {
    async request() { return { ok: true, context: { locale: 'zh-CN' } }; },
    onHostMessage(fn) { handler = fn; },
    async send(message) {
      sent.push(message);
      if (message.type !== 'fs-request') return { ok: true };
      assert.equal(message.root, 'data');
      if (message.op === 'write') { files.set(message.path, message.content); return { ok: true, op: 'write', path: message.path }; }
      if (message.op === 'read') {
        return files.has(message.path)
          ? { ok: true, op: 'read', path: message.path, content: files.get(message.path) }
          : { ok: false, errorCode: 'NOT_FOUND', message: 'missing' };
      }
      if (message.op === 'list') {
        const entries = [...files.keys()].filter((p) => p.startsWith(`${message.path}/`)).map((p, mtime) => ({ path: p, bytes: 1, mtime }));
        return { ok: true, op: 'list', entries };
      }
      if (message.op === 'delete') return { ok: true, op: 'delete', path: message.path, existed: files.delete(message.path) };
      throw new Error(`unexpected fs op ${message.op}`);
    },
    async fetch(request) {
      if (options.github) return options.github(request);
      throw new Error(`unexpected GitHub request ${request.url}`);
    },
    agent: {
      async run(request) {
        agentRuns.push(JSON.parse(JSON.stringify(request)));
        return options.agentRun ? options.agentRun(request) : { ok: true, sessionId: 's1', mode: 'continue', disposition: 'resumed' };
      },
    },
  };
  const context = createContext({
    cindy,
    BroadcastChannel: class { postMessage() {} },
    fetch: async (url, init = {}) => {
      assert.equal(url, '/kv');
      if (init.method === 'PUT') { kv = JSON.parse(init.body); return { ok: true, status: 204 }; }
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(kv)) };
    },
    setTimeout,
    clearTimeout,
    URL,
    encodeURIComponent,
  });
  new Script(githubSource, { filename: 'cindy-github/main.js' }).runInContext(context);
  let seq = 0;
  const cards = (callId) => sent.filter((m) => m.type === 'card-update' && m.callId === callId);
  return {
    files,
    agentRuns,
    get kv() { return kv; },
    cards,
    lastCard: (callId) => cards(callId).at(-1),
    setGithub(github) { options.github = github; },
    async tool(args) {
      const callId = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      await handler({ type: 'tool-call', tool: 'pr_card', callId, args });
      const reply = sent.filter((m) => m.type === 'tool-result' && m.callId === callId).at(-1);
      return { callId, reply: JSON.parse(JSON.stringify(reply)) };
    },
    click: (callId, actionId, extra = {}) => handler({
      type: 'event', name: 'card-action', callId, actionId, spawnCallId: `${callId}::sp1`, ts: 1,
      sessionId: 's1', userActionToken: 'token-1', ...extra,
    }),
  };
}

test('pr_card asks first, hands the click to the task agent, then updates the same card with the PR', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const ask = await runtime.tool({
    repo: 'octo/repo', head: 'feat/pr-card', base: 'main', commits: 3,
    files: [{ path: 'cindy-github/main.js', additions: 900, deletions: 2 }, { path: 'cindy-github/ghost.json', additions: 70 }],
  });
  const cardId = ask.reply.result.card_id;
  assert.equal(cardId, ask.callId);
  assert.deepEqual(ask.reply.result, {
    card_id: cardId, stage: 'ask', settings: { auto_rename: false, auto_follow: false }, next: zhCopy.prNextAsk,
  });
  const askCard = runtime.lastCard(cardId);
  assert.equal(askCard.state, 'done');
  assert.equal(askCard.sourceCallId, undefined);
  // Button labels live in aria-label, so the phone's text projection is just the question.
  assert.deepEqual(visibleText(askCard.html), [zhCopy.prAskTitle, 'feat/pr-card → main · 3 个提交 · 2 个文件']);
  assert.match(askCard.html, /<button data-ghost-action="pr:publish" aria-label="发 PR" style="[^"]*"><\/button>/);

  await runtime.click(cardId, 'pr:files');
  assert.ok(visibleText(runtime.lastCard(cardId).html).includes('cindy-github/main.js +900 −2'));
  assert.equal(runtime.agentRuns.length, 0);

  await runtime.click(cardId, 'pr:publish');
  assert.deepEqual(runtime.agentRuns, [{
    mode: 'continue',
    userActionToken: 'token-1',
    promptTemplate: '[UI_ACTION_TRIGGER]{{user_message}}\n{{event_json}}',
    userMessage: zhCopy.prClickPublish,
    event: {
      card_id: cardId, action: 'publish', repo: 'octo/repo', head: 'feat/pr-card', base: 'main',
      settings: { auto_rename: false, auto_follow: false },
    },
  }]);
  assert.deepEqual(visibleText(runtime.lastCard(cardId).html), [
    zhCopy.prPublishingTitle, zhCopy.prPublishingMeta, 'feat/pr-card → main · 3 个提交 · 2 个文件',
  ]);

  const opened = await runtime.tool({ card_id: cardId, pr: 'https://github.com/octo/repo/pull/42' });
  assert.equal(opened.reply.result.stage, 'open');
  assert.deepEqual(opened.reply.result.pr, {
    number: 42, title: 'Built-in PR skill', url: 'https://github.com/octo/repo/pull/42', state: 'open', draft: false,
  });
  assert.equal(opened.reply.result.todo, undefined);
  // The later call updates the original card in place instead of adding a second one.
  assert.equal(runtime.cards(opened.callId).length, 0);
  const update = runtime.lastCard(cardId);
  assert.equal(update.sourceCallId, opened.callId);
  assert.deepEqual(visibleText(update.html), ['#42 Built-in PR skill', `octo/repo · ${zhCopy.prStateOpen}`]);
  assert.match(update.html, /<a href="https:\/\/github\.com\/octo\/repo\/pull\/42">/);
});

test('card settings persist in /kv and become one-time todos once the PR exists', async () => {
  const runtime = createPrRuntime({ github: prGraphql({ number: 7, title: 'Fix login', ci: 'PENDING', threads: [false, true], mergeState: 'BLOCKED' }), kv: { unrelated: 1 } });
  const cardId = (await runtime.tool({ repo: 'octo/repo', head: 'fix/login', base: 'main' })).reply.result.card_id;
  await runtime.click(cardId, 'prui:settings');
  await runtime.click(cardId, 'prset:follow');
  assert.deepEqual(runtime.kv, { unrelated: 1, prCard: { autoRename: false, autoFollow: true } });
  assert.match(runtime.lastCard(cardId).html, /data-ghost-action="prset:follow" aria-label="关闭「发完自动跟进」"/);
  assert.equal(runtime.agentRuns.length, 0);

  // A bare number resolves against the repository recorded on the card.
  const opened = await runtime.tool({ card_id: cardId, pr: '7' });
  const url = 'https://github.com/octo/repo/pull/7';
  assert.deepEqual(opened.reply.result.settings, { auto_rename: false, auto_follow: true });
  assert.deepEqual(opened.reply.result.todo, [fill(zhCopy.prTodoFollow, { url })]);
  assert.equal(opened.reply.result.next, zhCopy.prNextApply);
  assert.equal((await runtime.tool({ card_id: cardId })).reply.result.todo, undefined);

  await runtime.click(cardId, 'pr:follow');
  assert.equal(runtime.agentRuns.at(-1).userMessage, fill(zhCopy.prClickFollow, { url }));
  assert.deepEqual(runtime.agentRuns.at(-1).event, { card_id: cardId, action: 'follow', repo: 'octo/repo', pr_number: 7, pr_url: url });
  assert.ok(visibleText(runtime.lastCard(cardId).html).includes(zhCopy.prFollowStarting));

  await runtime.tool({ card_id: cardId, following: true });
  const lines = visibleText(runtime.lastCard(cardId).html);
  assert.equal(lines[1], `octo/repo · ${zhCopy.prStateFollowing}`);
  for (const text of [zhCopy.prCiRunning, fill(zhCopy.prThreadsOpen, { count: 1 }), zhCopy.prMergeWaiting]) assert.ok(lines.includes(text), text);

  runtime.setGithub(prGraphql({ number: 7, title: 'Fix login', merged: true }));
  const merged = await runtime.tool({ card_id: cardId });
  assert.equal(merged.reply.result.stage, 'merged');
  assert.deepEqual(visibleText(runtime.lastCard(cardId).html), [
    '#7 Fix login', `octo/repo · ${zhCopy.prStateMerged} · ${zhCopy.prFollowEnded}`, 'fix/login → main',
  ]);
});

test('a click the agent did not receive keeps the ask card and says whether to retry', async () => {
  const cases = [
    [() => ({ ok: false, errorCode: 'TOKEN_EXPIRED' }), {}, zhCopy.prHandoffFailed],
    [() => { throw new Error('bridge closed'); }, {}, zhCopy.prHandoffUnknown],
    // No click token: the plugin's agent capability was not granted, so nothing is sent.
    [undefined, { userActionToken: undefined }, zhCopy.prHandoffFailed],
  ];
  for (const [agentRun, extra, note] of cases) {
    const runtime = createPrRuntime({ agentRun });
    const cardId = (await runtime.tool({ repo: 'octo/repo', head: 'feat/x' })).reply.result.card_id;
    await runtime.click(cardId, 'pr:publish', extra);
    const lines = visibleText(runtime.lastCard(cardId).html);
    assert.equal(lines[0], zhCopy.prAskTitle);
    assert.equal(lines.at(-1), note);
    assert.equal(runtime.agentRuns.length, agentRun ? 1 : 0);
  }
});

test('pr_card rejects unusable input and keeps its largest card under the host size limit', async () => {
  const runtime = createPrRuntime();
  assert.equal((await runtime.tool({ head: 'feat/x' })).reply.message, zhCopy.prNeedRepo);
  assert.equal((await runtime.tool({ repo: 'octo/repo' })).reply.message, zhCopy.prNeedHead);
  assert.equal((await runtime.tool({ repo: 'octo/repo', pr: 'pull/abc' })).reply.message, zhCopy.prBadPr);
  assert.equal((await runtime.tool({ card_id: '../escape' })).reply.message, zhCopy.prBadCardId);

  const files = Array.from({ length: 80 }, (_, i) => ({
    path: `packages/a/deeply/nested/module-${i}/${'segment/'.repeat(30)}index.ts`, additions: 1000 + i, deletions: i,
  }));
  const ask = await runtime.tool({ repo: 'octo/repo', head: `feat/${'x'.repeat(250)}`, base: 'main', commits: 99, files, files_total: 80 });
  const cardId = ask.reply.result.card_id;
  await runtime.click(cardId, 'pr:files');
  await runtime.click(cardId, 'prui:settings');
  const { html } = runtime.lastCard(cardId);
  assert.ok(Buffer.byteLength(html) < 32 * 1024, `${Buffer.byteLength(html)} bytes`);
  assert.ok(visibleText(html).includes(fill(zhCopy.prMoreFiles, { count: 72 })));
});
