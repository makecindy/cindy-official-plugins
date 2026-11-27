import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

// CI runs only .tests/<plugin>.test.mjs for a changed plugin; the /pr Skill's script tests ride along here.
import './cindy-github-pr/cleanup-plan.test.mjs';
import './cindy-github-pr/gate.test.mjs';
import './cindy-github-pr/preflight.test.mjs';
import './cindy-github-pr/pacing.test.mjs';
import './cindy-github-pr/trace.test.mjs';
import './cindy-github-pr/snapshot.test.mjs';

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

test('legacy repair is disclosed in release notes and the four-language pr_card tool contract', () => {
  assert.match(manifest.releaseNotes, /Node\.js 18\+/);
  assert.match(manifest.releaseNotes, /跟进待修复/);
  const base = manifest.tools.find(tool => tool.name === 'pr_card').description;
  for (const locale of ['zh-CN', 'en', 'ja', 'ko']) {
    const catalog = JSON.parse(readFileSync(new URL(`../cindy-github/locales/${locale}.json`, import.meta.url), 'utf8'));
    const description = catalog.tools.pr_card.description;
    assert.ok(description.length <= 1024, `${locale}: exceeds host tool-description limit`);
    for (const term of ['unverified', 'legacy_hook_repair', 'schedule_id', 'command'])
      assert.ok(description.includes(term), `${locale}: missing ${term}`);
    if (locale === 'zh-CN') assert.equal(description, base);
  }
});

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

  const fetch = async (url) => {
    if (url === '/kv') return { ok: true, json: async () => ({}) };
    throw new Error(`unexpected fetch: ${url}`);
  };

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
  // First Cindy release carrying makecindy/cindy#8244: 0.1.125-beta and earlier do not contain it, and a
  // stable release reuses its same-number beta's commit (so 0.1.125 stable would not either).
  assert.equal(manifest.minCindyVersion, '0.1.126');
  assert.equal('slots' in manifest, false);
  assert.equal(manifest.notify, true);
  assert.equal(manifest.fs, true);
  // The card can manage its saved follow-up directly.
  assert.deepEqual(manifest.card, { externalLinks: true });
  assert.deepEqual(manifest.agent, { hostTools: ['scheduler'] });
  assert.equal(manifest.node.entry, 'node/follow.cjs');
  const auth = manifest.network?.secrets?.find((secret) => secret.key === 'github_pat');
  assert.equal(manifest.version, '1.5.41');
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
  assert.doesNotMatch(settingsSource, /connectedLogin|connectedSource/);
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
    send(message) { sent.push(message); return Promise.resolve(options.send ? options.send(message) : { ok: true }); },
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
    fetch: options.localFetch ?? (async (url) => {
      assert.equal(url, '/kv');
      return { ok: true, json: async () => ({}) };
    }),
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
    crypto: globalThis.crypto,
    BroadcastChannel: options.channel ?? class { postMessage() {} addEventListener() {} removeEventListener() {} },
    setTimeout: options.setTimeout ?? (() => 0),
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
      if (url === '/kv') return { ok: true, json: async () => options.kv ?? {} };
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
  // Effort names follow Cindy's own Japanese model picker, which shares the kanji with Chinese.
  assertParity(runtime.MESSAGES, 'main.js MESSAGES', {
    allowJaSameAsZh: new Set(['prEffortLow', 'prEffortMedium', 'prEffortHigh', 'prEffortXhigh', 'prEffortMax']),
  });
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
    assert.equal(page.copyNodes['data-i18n'].length, 10);
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

function prGraphql({ owner = 'octo', repo = 'repo', number = 42, title = 'Built-in PR skill', ci = 'SUCCESS', threads = [], mergeState = 'CLEAN', merged = false, draft = false, state = merged ? 'MERGED' : 'OPEN' } = {}) {
  return (request) => {
    assert.equal(request.url, 'https://api.github.com/graphql');
    assert.deepEqual(JSON.parse(request.body).variables, { owner, name: repo, number });
    return jsonResponse({ data: { repository: { pullRequest: {
      number, title, url: `https://github.com/${owner}/${repo}/pull/${number}`, state,
      isDraft: draft, merged, mergeStateStatus: mergeState, reviewDecision: null, baseRefName: 'main',
      commits: { nodes: [{ commit: { statusCheckRollup: ci ? { state: ci } : null } }] },
      reviewThreads: { nodes: threads.map((isResolved) => ({ isResolved })) },
    } } } });
  };
}

function createPrRuntime(options = {}) {
  let handler = null;
  const sent = [];
  const files = options.files ?? new Map();
  const agentRuns = [];
  let kv = options.kv ?? {};
  const cindy = {
    ...options.hostApi,
    ...(options.pickModel ? { pickModel: options.pickModel } : {}),
    async request() { return { ok: true, context: { locale: 'zh-CN' } }; },
    onHostMessage(fn) { handler = fn; },
    async send(message) {
      sent.push(message);
      if (message.type === 'card-update' && options.refuseCards) throw new Error('card refused');
      if (message.type !== 'fs-request') return { ok: true };
      assert.equal(message.root, 'data');
      if (message.op === 'write' && (typeof options.failWrites === 'function' ? options.failWrites() : options.failWrites)) return { ok: false, errorCode: 'IO_ERROR', message: 'disk full' };
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
      if (String(url).startsWith('/agent-models') && options.agentModels) {
        const device = new URL(url, 'http://plugin').searchParams.get('agent_device_id');
        const models = typeof options.agentModels === 'function' ? options.agentModels(device) : options.agentModels;
        return { ok: true, status: 200, json: async () => ({ ok: true, models, ...(device ? { agentDeviceId: device } : { locations: options.agentLocations ?? [] }) }) };
      }
      assert.equal(url, '/kv');
      if (options.kvFails && init.method !== 'PUT') return { ok: false, status: 500, json: async () => ({}) };
      if (init.method === 'PUT') { kv = JSON.parse(init.body); return { ok: true, status: 204 }; }
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(kv)) };
    },
    setTimeout(fn, delay) { return delay >= 300_000 ? 0 : setTimeout(fn, delay); },
    clearTimeout,
    URL,
    encodeURIComponent,
  });
  new Script(githubSource, { filename: 'cindy-github/main.js' }).runInContext(context);
  let seq = options.files ? 100 : 0;
  const cards = (callId) => sent.filter((m) => m.type === 'card-update' && m.callId === callId);
  return {
    files,
    agentRuns,
    get kv() { return kv; },
    cards,
    lastCard: (callId) => cards(callId).at(-1),
    setGithub(github) { options.github = github; },
    async tool(args, tool = 'pr_card') {
      const callId = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      await handler({ type: 'tool-call', tool, callId, args: tool === 'pr_card' ? { session_context: { session_id: 's1' }, ...args } : args });
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
  assert.deepEqual(visibleText(askCard.html), [zhCopy.prAskTitle, 'octo/repo', 'feat/pr-card → main · 3 个提交 · 2 个文件']);
  // The primary marker lets the phone draw this one as the main button.
  assert.match(askCard.html, /<button data-ghost-action="pr:publish" aria-label="发 PR" data-ghost-primary style="[^"]*"><\/button>/);

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
  // While the agent publishes, the card stays live so the host plays its spinner.
  assert.equal(runtime.lastCard(cardId).state, 'working');

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
  assert.equal(update.state, 'done');
  assert.deepEqual(visibleText(update.html), [
    '#42 Built-in PR skill', `octo/repo · ${zhCopy.prStateOpen}`, 'feat/pr-card → main · 3 个提交 · 2 个文件',
  ]);
  assert.match(update.html, /<a href="https:\/\/github\.com\/octo\/repo\/pull\/42">/);
  // Every stage asks the host for the changed-files card's slot and width, so it never jumps or resizes.
  for (const html of [askCard.html, update.html]) assert.match(html, /<div data-ghost-placement="turn-end" data-ghost-width="full" style=/);
});

test('to_latest moves the card to the current call and leaves one line where it was', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const first = await runtime.tool({ repo: 'octo/repo', pr: 'https://github.com/octo/repo/pull/42', following: true });
  const cardId = first.reply.result.card_id;

  const moved = await runtime.tool({ card_id: cardId, pr: 42, to_latest: true });
  // card_id stays the same, so the schedule prompt keeps working.
  assert.equal(moved.reply.result.card_id, cardId);
  const stub = runtime.lastCard(cardId);
  assert.equal(stub.sourceCallId, moved.callId);
  // Cindy hides the old place; versions that do not know supersededBy show the one-line stub instead.
  assert.equal(stub.supersededBy, moved.callId);
  assert.deepEqual(visibleText(stub.html), [`#42 Built-in PR skill · ${zhCopy.prMovedBelow}`]);
  assert.doesNotMatch(stub.html, /data-ghost-action/);
  const latest = runtime.lastCard(moved.callId);
  assert.equal(latest.sourceCallId, undefined);
  assert.equal(visibleText(latest.html)[0], '#42 Built-in PR skill');

  // A click on the new place finds the card through the alias and redraws it there.
  await runtime.click(moved.callId, 'pr:stop');
  assert.equal(runtime.agentRuns.at(-1).event.card_id, cardId);
  assert.equal(runtime.cards(cardId).length, 2);
  assert.equal(runtime.lastCard(moved.callId).state, 'working');

  // A later refresh without to_latest updates the new place in place.
  const refresh = await runtime.tool({ card_id: cardId, following: false });
  assert.equal(runtime.cards(refresh.callId).length, 0);
  assert.equal(runtime.lastCard(moved.callId).sourceCallId, refresh.callId);

  // The stub is left alone, and the new place's id also finds the card.
  assert.equal(runtime.cards(cardId).length, 2);
  assert.equal((await runtime.tool({ card_id: moved.callId })).reply.result.card_id, cardId);
});

test('to_latest also moves a card that is still asking, with the new change summary', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const cardId = (await runtime.tool({ repo: 'octo/repo', head: 'feat/pr-card', base: 'main', commits: 2, files_total: 4 })).reply.result.card_id;

  // More commits landed after the first ask: the same card moves under the new reply.
  const moved = await runtime.tool({ card_id: cardId, commits: 3, files_total: 6, to_latest: true });
  assert.equal(moved.reply.result.card_id, cardId);
  assert.equal(moved.reply.result.stage, 'ask');
  const stub = runtime.lastCard(cardId);
  assert.deepEqual(visibleText(stub.html), [`octo/repo · ${zhCopy.prMovedBelow}`]);
  assert.doesNotMatch(stub.html, /data-ghost-action/);
  const latest = runtime.lastCard(moved.callId);
  assert.deepEqual(visibleText(latest.html), [zhCopy.prAskTitle, 'octo/repo', 'feat/pr-card → main · 3 个提交 · 6 个文件']);
  assert.match(latest.html, /data-ghost-action="pr:publish"/);

  // Open PR on the new place reaches the agent with the original card_id.
  await runtime.click(moved.callId, 'pr:publish');
  assert.equal(runtime.agentRuns.at(-1).event.card_id, cardId);
  assert.equal(runtime.agentRuns.at(-1).event.action, 'publish');
  assert.equal(runtime.lastCard(moved.callId).state, 'working');
});

test('card settings persist in /kv and become one-time todos once the PR exists', async () => {
  const runtime = createPrRuntime({ github: prGraphql({ number: 7, title: 'Fix login', ci: 'PENDING', threads: [false, true], mergeState: 'BLOCKED' }), kv: { unrelated: 1 } });
  const cardId = (await runtime.tool({ repo: 'octo/repo', head: 'fix/login', base: 'main' })).reply.result.card_id;
  await runtime.click(cardId, 'prui:settings');
  await runtime.click(cardId, 'prset:follow');
  assert.deepEqual(runtime.kv, { unrelated: 1, prCard: { autoRename: false, autoFollow: true } });
  // The toggle state lets the phone draw a native switch.
  assert.match(runtime.lastCard(cardId).html, /data-ghost-action="prset:follow" data-ghost-toggle="on" aria-label="关闭「发完自动跟进」"/);
  assert.equal(runtime.agentRuns.length, 0);

  // A bare number resolves against the repository recorded on the card.
  const opened = await runtime.tool({ card_id: cardId, pr: '7' });
  const url = 'https://github.com/octo/repo/pull/7';
  assert.deepEqual(opened.reply.result.settings, { auto_rename: false, auto_follow: true });
  assert.deepEqual(opened.reply.result.todo, [fill(zhCopy.prTodoFollow, { url })]);
  assert.equal(opened.reply.result.next, zhCopy.prNextApply);
  assert.equal((await runtime.tool({ card_id: cardId })).reply.result.todo, undefined);

  await runtime.click(cardId, 'pr:follow');
  assert.equal(runtime.agentRuns.length, 0); // the auto-follow todo already reserved this start
  assert.ok(visibleText(runtime.lastCard(cardId).html).includes(zhCopy.prFollowStarting));

  await runtime.tool({ card_id: cardId, following: true });
  const lines = visibleText(runtime.lastCard(cardId).html);
  // Following is shown once, by the live indicator in the footer.
  assert.equal(lines[1], 'octo/repo');
  assert.equal(lines.filter((line) => line === zhCopy.prStateFollowing).length, 1);
  for (const text of [zhCopy.prCiRunning, fill(zhCopy.prThreadsOpen, { count: 1 }), zhCopy.prMergeWaiting]) assert.ok(lines.includes(text), text);
  // Parts that only hold while the PR is open carry the slot key, so the host can hide them once it sees a merge.
  const openOnly = runtime.lastCard(cardId).html.match(/<(\w+)[^>]*data-ghost-pr-open-only="octo\/repo#7"/g) ?? [];
  // Settings stay accessible after an external merge; only active PR actions are open-only.
  assert.deepEqual(openOnly.map((tag) => tag.match(/^<(\w+)/)[1]), ['div']);

  runtime.setGithub(prGraphql({ number: 7, title: 'Fix login', merged: true }));
  const merged = await runtime.tool({ card_id: cardId });
  assert.equal(merged.reply.result.stage, 'merged');
  assert.doesNotMatch(runtime.lastCard(cardId).html, /data-ghost-pr-open-only/);
  assert.deepEqual(visibleText(runtime.lastCard(cardId).html).slice(0, 3), [
    '#7 Fix login', `octo/repo · ${zhCopy.prStateMerged} · ${zhCopy.prFollowEnded}`, 'fix/login → main',
  ]);
});

// Rule (2026-11-14): like the title-bar PR popover, the PR card offers "Copy link". Cindy does the copying,
// so the button only declares the PR URL, stays hidden for hosts that do not know it, and never dispatches.
test('PR cards carry a hidden host copy-link button for the PR URL', async () => {
  const runtime = createPrRuntime({ github: prGraphql({ number: 7, title: 'Fix login' }) });
  const cardId = (await runtime.tool({ repo: 'octo/repo', pr: '7' })).reply.result.card_id;
  const html = runtime.lastCard(cardId).html;
  assert.match(html, /Fix login<\/a><\/span><button data-ghost-copy-link=/);
  const button = html.match(/<button data-ghost-copy-link=[^>]*>/)?.[0] ?? '';
  assert.match(button, /^<button data-ghost-copy-link="https:\/\/github\.com\/octo\/repo\/pull\/7" aria-label="复制链接" style="display:none;/);
  assert.doesNotMatch(button, /data-ghost-action|data-ghost-link|data-ghost-task-archive/);
});

// Rule (2026-11-06): the archive-task button is Cindy's, not the plugin's. Every card for a PR carries it
// hidden (so a merge outside the card can reveal it), outside the open-only group, with the plugin's
// snapshot once it read the PR ended; the "Archive after merge" setting adds the auto marker.
test('PR cards carry a hidden host archive button and the auto-archive setting', async () => {
  const runtime = createPrRuntime({ github: prGraphql({ number: 7, title: 'Fix login' }) });
  const cardId = (await runtime.tool({ repo: 'octo/repo', pr: '7' })).reply.result.card_id;
  const button = () => runtime.lastCard(cardId).html.match(/<button data-ghost-task-archive=[^>]*>/)?.[0] ?? '';
  assert.match(button(), /^<button data-ghost-task-archive="octo\/repo#7" aria-label="归档任务" style="display:none;/);
  assert.doesNotMatch(button(), /data-ghost-action|data-ghost-task-archive-(?:state|auto)/);
  assert.doesNotMatch(runtime.lastCard(cardId).html, /data-ghost-pr-open-only="[^"]*"[^>]*>(?:(?!<\/div>).)*data-ghost-task-archive/s);

  await runtime.click(cardId, 'prui:settings');
  await runtime.click(cardId, 'prset:archive');
  assert.equal(runtime.kv.prCard.autoArchive, true);
  assert.match(runtime.lastCard(cardId).html, /data-ghost-action="prset:archive" data-ghost-toggle="on" aria-label="关闭「合并后自动归档」"/);
  assert.match(button(), / data-ghost-task-archive-auto /);

  runtime.setGithub(prGraphql({ number: 7, title: 'Fix login', merged: true }));
  await runtime.tool({ card_id: cardId });
  assert.match(button(), /data-ghost-task-archive="octo\/repo#7" data-ghost-task-archive-state="merged" data-ghost-task-archive-auto aria-label/);
});

for (const state of ['MERGED', 'CLOSED']) {
  test(`ended PR settings remain usable: ${state}`, async () => {
    const github = prGraphql({ number: 7, merged: state === 'MERGED', state });
    const runtime = createPrRuntime({ github });
    const cardId = (await runtime.tool({ repo: 'octo/repo', pr: '7' })).reply.result.card_id;
    assert.match(runtime.lastCard(cardId).html, /data-ghost-action="prui:settings"/);
    await runtime.click(cardId, 'prui:settings');
    assert.match(runtime.lastCard(cardId).html, /data-ghost-action="prset:archive"/);
    assert.equal(runtime.lastCard(cardId).height, 280);
    await runtime.click(cardId, 'prset:archive');
    assert.equal(runtime.kv.prCard.autoArchive, true);
    await runtime.tool({ card_id: cardId });
    assert.match(runtime.lastCard(cardId).html, /data-ghost-action="prset:archive"/);
    assert.match(runtime.lastCard(cardId).html, /data-ghost-task-archive-auto/);
    assert.doesNotMatch(runtime.lastCard(cardId).html, /data-ghost-pr-open-only|<button[^>]*data-ghost-action="pr:(?:follow|ready|stop)"/);
    await runtime.click(cardId, 'prui:settings');
    assert.doesNotMatch(runtime.lastCard(cardId).html, /data-ghost-action="prset:archive"/);
    assert.equal(runtime.lastCard(cardId).height, 120);
    assert.equal(runtime.agentRuns.length, 0);
  });
}

// Drafts are still being worked on, so the card offers "mark ready" instead of following.
// The plugin flips it directly, rereads GitHub, then applies the auto-follow setting.
test('a draft card marks the PR ready itself, then follows when the card setting says so', async () => {
  let draft = true;
  const mutations = [];
  const github = (request) => {
    const { query, variables } = JSON.parse(request.body);
    if (query.startsWith('mutation')) { mutations.push(variables); draft = false; return jsonResponse({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } }); }
    if (query.includes('{id}')) return jsonResponse({ data: { repository: { pullRequest: { id: 'PR_node' } } } });
    return jsonResponse({ data: { repository: { pullRequest: {
      number: 9, title: 'Draft', url: 'https://github.com/octo/repo/pull/9', state: 'OPEN', isDraft: draft, merged: false,
      mergeStateStatus: 'CLEAN', reviewDecision: null, baseRefName: 'main', commits: { nodes: [] }, reviewThreads: { nodes: [] },
    } } } });
  };
  const runtime = createPrRuntime({ github, kv: { prCard: { autoRename: false, autoFollow: true } } });
  const cardId = (await runtime.tool({ repo: 'octo/repo', pr: '9' })).reply.result.card_id;
  const draftCard = runtime.lastCard(cardId).html;
  assert.match(draftCard, /data-ghost-action="pr:ready" aria-label="转为正式 PR"/);
  assert.doesNotMatch(draftCard, /pr:follow/);

  await runtime.click(cardId, 'pr:ready');
  assert.deepEqual(mutations, [{ id: 'PR_node' }]);
  const url = 'https://github.com/octo/repo/pull/9';
  assert.equal(runtime.agentRuns.length, 1);
  assert.equal(runtime.agentRuns[0].userMessage, fill(zhCopy.prReadyFollow, { url }));
  assert.equal(runtime.agentRuns[0].event.marked_ready_on_card, true);
  const card = runtime.lastCard(cardId);
  assert.equal(card.state, 'working');
  assert.ok(visibleText(card.html).includes(zhCopy.prFollowStarting));

  // Once following, the check strip is a slot the host fills from the title bar's live data.
  await runtime.tool({ card_id: cardId, following: true });
  assert.match(runtime.lastCard(cardId).html, /<div data-ghost-pr-status="octo\/repo#9">/);
});

test('marking a draft ready keeps an unconfirmed write uncertain instead of reporting failure', async () => {
  const prBody = (draft) => ({ data: { repository: { pullRequest: {
    number: 9, title: 'Draft', url: 'https://github.com/octo/repo/pull/9', state: 'OPEN', isDraft: draft, merged: false,
    mergeStateStatus: 'CLEAN', reviewDecision: null, baseRefName: 'main', commits: { nodes: [] }, reviewThreads: { nodes: [] },
  } } } });
  const scenario = (mutation, rereadFails) => {
    let reads = 0;
    const github = (request) => {
      const { query } = JSON.parse(request.body);
      if (query.startsWith('mutation')) return mutation();
      if (query.includes('{id}')) return jsonResponse({ data: { repository: { pullRequest: { id: 'PR_node' } } } });
      reads += 1;
      return reads > 1 && rereadFails ? { ok: false, status: 502, body: '', headers: {} } : jsonResponse(prBody(true));
    };
    return createPrRuntime({ github });
  };
  const noteAfterClick = async (runtime) => {
    const cardId = (await runtime.tool({ repo: 'octo/repo', pr: '9' })).reply.result.card_id;
    await runtime.click(cardId, 'pr:ready');
    return visibleText(runtime.lastCard(cardId).html).join('\n');
  };

  // The request went out, its answer was lost, and the re-read failed too: GitHub may already have it.
  const lost = await noteAfterClick(scenario(() => ({ ok: false, status: 502, body: '', headers: {} }), true));
  assert.match(lost, new RegExp(zhCopy.prReadyUnknown));
  assert.doesNotMatch(lost, new RegExp(zhCopy.prReadyFailed.split('{')[0]));

  // The answer says it worked although the re-read failed: believe the answer.
  const confirmed = scenario(() => jsonResponse({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } }), true);
  const confirmedText = await noteAfterClick(confirmed);
  assert.doesNotMatch(confirmedText, new RegExp(zhCopy.prReadyFailed.split('{')[0]));
  assert.doesNotMatch(confirmedText, new RegExp(zhCopy.prReadyUnknown));

  // Errors next to data are a partial success: the write may have happened, so with the re-read failing too
  // it stays uncertain unless the data itself says ready.
  const partial = await noteAfterClick(scenario(() => jsonResponse({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: true } } }, errors: [{ message: 'field error' }] }), true));
  assert.match(partial, new RegExp(zhCopy.prReadyUnknown));
  const partialReady = await noteAfterClick(scenario(() => jsonResponse({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } }, errors: [{ message: 'field error' }] }), true));
  assert.doesNotMatch(partialReady, new RegExp(zhCopy.prReadyFailed.split('{')[0]));
  assert.doesNotMatch(partialReady, new RegExp(zhCopy.prReadyUnknown));

  // GitHub answered with an error: the write did not happen, so failing is accurate.
  const rejected = await noteAfterClick(scenario(() => jsonResponse({ data: null, errors: [{ type: 'FORBIDDEN', message: 'not allowed' }] }), true));
  assert.match(rejected, new RegExp(zhCopy.prReadyFailed.split('{')[0]));
  // An error with no data and no pre-run type (a resolver failing after the change) is not proof it did not run.
  const afterRun = await noteAfterClick(scenario(() => jsonResponse({ data: null, errors: [{ message: 'Something went wrong' }] }), true));
  assert.match(afterRun, new RegExp(zhCopy.prReadyUnknown));
});

test('pr_card reads every page of review threads, and reports unknown instead of zero when it cannot', async () => {
  const thread = (isResolved) => ({ isResolved });
  const pr = (threads, pageInfo) => ({ number: 7, title: 'Big', url: 'https://github.com/octo/repo/pull/7', state: 'OPEN', isDraft: false,
    merged: false, mergeStateStatus: 'CLEAN', reviewDecision: null, baseRefName: 'main', commits: { nodes: [] }, reviewThreads: { pageInfo, nodes: threads } });
  const seenAfter = [];
  const github = (failSecondPage) => (request) => {
    const { variables } = JSON.parse(request.body);
    seenAfter.push(variables.after ?? null);
    if (!variables.after) return jsonResponse({ data: { repository: { pullRequest: pr(Array.from({ length: 100 }, () => thread(true)), { hasNextPage: true, endCursor: 'c1' }) } } });
    if (failSecondPage) return { ok: false, status: 502, body: '', headers: {} };
    return jsonResponse({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [thread(false), thread(false), thread(true)] } } } } });
  };
  const ok = createPrRuntime({ github: github(false) });
  const opened = await ok.tool({ repo: 'octo/repo', pr: '7', following: true });
  assert.deepEqual(seenAfter, [null, 'c1']);
  assert.ok(visibleText(ok.lastCard(opened.reply.result.card_id).html).join('\n').includes(fill(zhCopy.prThreadsOpen, { count: 2 })), 'the two unresolved threads on page two are counted');

  const broken = createPrRuntime({ github: github(true) });
  const failed = await broken.tool({ repo: 'octo/repo', pr: '7' });
  assert.equal(failed.reply.ok, false, 'no card with a made-up zero');
});

test('when the final save after marking ready fails, the card shows the real state and its next click works', async () => {
  const prBody = (draft) => ({ data: { repository: { pullRequest: {
    number: 9, title: 'Draft', url: 'https://github.com/octo/repo/pull/9', state: 'OPEN', isDraft: draft, merged: false,
    mergeStateStatus: 'CLEAN', reviewDecision: null, baseRefName: 'main', commits: { nodes: [] }, reviewThreads: { nodes: [] } } } } });
  let draft = true;
  const github = (request) => {
    const { query } = JSON.parse(request.body);
    if (query.startsWith('mutation')) { draft = false; return jsonResponse({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } }); }
    if (query.includes('{id}')) return jsonResponse({ data: { repository: { pullRequest: { id: 'PR_node' } } } });
    return jsonResponse(prBody(draft));
  };
  let writes = 0, healed = false;
  const runtime = createPrRuntime({ github, failWrites: () => !healed && ++writes >= 3 });
  const cardId = (await runtime.tool({ repo: 'octo/repo', pr: '9' })).reply.result.card_id;
  await runtime.click(cardId, 'pr:ready');
  const card = runtime.lastCard(cardId);
  // The PR is ready for review now, so the card offers following; the note says the record was not saved.
  assert.match(card.html, /<button data-ghost-action="pr:follow"/);
  assert.ok(visibleText(card.html).includes(zhCopy.prSaveFailed));
  // The record still says 'ready': the next click reads the PR again first, then works.
  healed = true;
  await runtime.click(cardId, 'pr:follow');
  assert.equal(runtime.agentRuns.at(-1)?.event.action, 'follow');
});

test('publish and draft clicks replace the buttons before a slow agent handoff completes', async () => {
  for (const action of ['pr:publish', 'pr:draft']) {
    let started, finish;
    const starting = new Promise(resolve => { started = resolve; });
    const receipt = new Promise(resolve => { finish = resolve; });
    const runtime = createPrRuntime({ agentRun: () => { started(); return receipt; } });
    const { callId } = await runtime.tool({ repo: 'octo/repo', head: 'feat/x', base: 'main' });
    const click = runtime.click(callId, action);
    await starting;
    const pending = runtime.lastCard(callId);
    finish({ ok: true, disposition: 'queued' });
    await click;
    assert.equal(pending.state, 'working');
    assert.doesNotMatch(pending.html, /data-ghost-action="pr:(publish|draft)"/);
    assert.ok(visibleText(runtime.lastCard(callId).html).includes(zhCopy.prQueuedMeta));
    await runtime.click(callId, action);
    assert.equal(runtime.agentRuns.length, 1);
  }
});

test('a click is recorded before it is handed over: no record, nothing sent; handed over, a lost save cannot offer it again', async () => {
  // The in-progress record cannot be saved: nothing is sent and the ask card stays.
  const options = {};
  const none = createPrRuntime(options);
  const idA = (await none.tool({ repo: 'octo/repo', head: 'feat/x', base: 'main' })).reply.result.card_id;
  options.failWrites = true;
  await none.click(idA, 'pr:publish');
  assert.equal(none.agentRuns.length, 0);
  assert.ok(visibleText(none.lastCard(idA).html).includes(zhCopy.prSaveFailed));
  assert.match(none.lastCard(idA).html, /<button data-ghost-action="pr:publish"/);

  // Writes: 1 card, 2 the in-progress record, 3 the final save (lost).
  let writes = 0;
  const handed = createPrRuntime({ failWrites: () => ++writes === 3 });
  const idB = (await handed.tool({ repo: 'octo/repo', head: 'feat/x', base: 'main' })).reply.result.card_id;
  await handed.click(idB, 'pr:publish');
  assert.equal(handed.agentRuns.length, 1);
  const card = handed.lastCard(idB);
  assert.equal(card.state, 'working');
  assert.doesNotMatch(card.html, /data-ghost-action="pr:(publish|draft)"/);
  assert.ok(visibleText(card.html).includes(zhCopy.prHandedOffSaveFailed));
  assert.equal(JSON.parse(handed.files.get(`pr-cards/${idB}.json`)).stage, 'publishing');
  await handed.click(idB, 'pr:publish');
  assert.equal(handed.agentRuns.length, 1, 'the record already says publishing, so it is not sent again');
});

test('settings that cannot be read are not sent as "everything off"', async () => {
  const options = {};
  const runtime = createPrRuntime(options);
  const cardId = (await runtime.tool({ repo: 'octo/repo', head: 'feat/x', base: 'main' })).reply.result.card_id;
  options.kvFails = true;
  await runtime.click(cardId, 'pr:publish');
  assert.equal(runtime.agentRuns.length, 0);
  assert.ok(visibleText(runtime.lastCard(cardId).html).includes(zhCopy.prSettingsUnreadable));
});

test('following an existing PR is not started with a default model when the settings cannot be read', async () => {
  const options = { kv: { prCard: { followModel: { route: { agentKind: 'cc', providerId: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium', fastMode: false }, label: 'Sonnet' } } }, github: prGraphql() };
  const runtime = createPrRuntime(options);
  const cardId = (await runtime.tool({ repo: 'octo/repo', pr: '42' })).reply.result.card_id;
  options.kvFails = true;
  await runtime.click(cardId, 'pr:follow');
  assert.equal(runtime.agentRuns.length, 0);
  assert.ok(visibleText(runtime.lastCard(cardId).html).includes(zhCopy.prSettingsUnreadable));
  options.kvFails = false;
  await runtime.click(cardId, 'pr:follow');
  assert.equal(runtime.agentRuns.length, 1);
});

test('unreadable settings do not use up the one-time to-do list either', async () => {
  const options = { kv: { prCard: { autoRename: true, autoFollow: false } }, github: prGraphql() };
  const runtime = createPrRuntime(options);
  const cardId = (await runtime.tool({ repo: 'octo/repo', head: 'feat/pr-card', base: 'main' })).reply.result.card_id;
  options.kvFails = true;
  const first = await runtime.tool({ card_id: cardId, pr: 'https://github.com/octo/repo/pull/42' });
  assert.equal(first.reply.ok, true);
  assert.equal(first.reply.result.todo, undefined);
  assert.ok(first.reply.result.note.includes(zhCopy.prSettingsLater));
  options.kvFails = false;
  const second = await runtime.tool({ card_id: cardId, pr: 'https://github.com/octo/repo/pull/42' });
  assert.ok(second.reply.result.todo?.length > 0, 'the to-do list is still there once the settings can be read');
});

test('a refused card does not use up the one-time settings to-do list', async () => {
  const options = { kv: { prCard: { autoRename: true, autoFollow: false } }, github: prGraphql() };
  const runtime = createPrRuntime(options);
  const ask = await runtime.tool({ repo: 'octo/repo', head: 'feat/pr-card', base: 'main' });
  const cardId = ask.reply.result.card_id;
  options.refuseCards = true;
  const refused = await runtime.tool({ card_id: cardId, pr: 'https://github.com/octo/repo/pull/42' });
  assert.equal(refused.reply.ok, false);
  options.refuseCards = false;
  const retry = await runtime.tool({ card_id: cardId, pr: 'https://github.com/octo/repo/pull/42' });
  assert.equal(retry.reply.ok, true);
  assert.ok(Array.isArray(retry.reply.result.todo) && retry.reply.result.todo.length > 0, 'the rename to-do is still there');
});

test('with auto-follow, a lost save of the follow state sends nothing, and a lost final save cannot cause a second send', async () => {
  const prBody = (draft) => ({ data: { repository: { pullRequest: {
    number: 9, title: 'Draft', url: 'https://github.com/octo/repo/pull/9', state: 'OPEN', isDraft: draft, merged: false,
    mergeStateStatus: 'CLEAN', reviewDecision: null, baseRefName: 'main', commits: { nodes: [] }, reviewThreads: { nodes: [] } } } } });
  const scenario = (failAt) => {
    let draft = true, writes = 0;
    const github = (request) => {
      const { query } = JSON.parse(request.body);
      if (query.startsWith('mutation')) { draft = false; return jsonResponse({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } }); }
      if (query.includes('{id}')) return jsonResponse({ data: { repository: { pullRequest: { id: 'PR_node' } } } });
      return jsonResponse(prBody(draft));
    };
    const runtime = createPrRuntime({ github, kv: { prCard: { autoRename: false, autoFollow: true } }, failWrites: () => ++writes === failAt });
    return runtime;
  };
  // Writes: 1 card, 2 'ready', 3 'follow' (before the handoff), 4 final.
  const noSend = scenario(3);
  const idA = (await noSend.tool({ repo: 'octo/repo', pr: '9' })).reply.result.card_id;
  await noSend.click(idA, 'pr:ready');
  assert.equal(noSend.agentRuns.length, 0, 'the follow state could not be recorded, so nothing was sent');
  assert.ok(visibleText(noSend.lastCard(idA).html).includes(zhCopy.prSaveFailed));

  const sentOnce = scenario(4);
  const idB = (await sentOnce.tool({ repo: 'octo/repo', pr: '9' })).reply.result.card_id;
  await sentOnce.click(idB, 'pr:ready');
  assert.equal(sentOnce.agentRuns.length, 1);
  await sentOnce.click(idB, 'pr:follow');
  assert.equal(sentOnce.agentRuns.length, 1, 'the record says following is starting, so the same request is not sent again');
});

test('a card the host refuses is reported to the agent, not claimed as shown', async () => {
  const runtime = createPrRuntime({ refuseCards: true });
  const attempt = await runtime.tool({ repo: 'octo/repo', head: 'feat/x', base: 'main' });
  assert.equal(attempt.reply.ok, false);
  assert.equal(attempt.reply.message, zhCopy.prCardNotDelivered);
});

test('a clearly refused follow handoff is written back even if one save fails, so the card is not stuck on starting', async () => {
  let draft = true, writes = 0;
  const github = (request) => {
    const { query } = JSON.parse(request.body);
    if (query.startsWith('mutation')) { draft = false; return jsonResponse({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } }); }
    if (query.includes('{id}')) return jsonResponse({ data: { repository: { pullRequest: { id: 'PR_node' } } } });
    return jsonResponse({ data: { repository: { pullRequest: { number: 9, title: 'Draft', url: 'https://github.com/octo/repo/pull/9', state: 'OPEN', isDraft: draft, merged: false,
      mergeStateStatus: 'CLEAN', reviewDecision: null, baseRefName: 'main', commits: { nodes: [] }, reviewThreads: { nodes: [] } } } } });
  };
  // Writes: 1 card, 2 'ready', 3 'follow', 4 the write-back after the refusal (fails once), 5 its retry.
  const runtime = createPrRuntime({ github, kv: { prCard: { autoRename: false, autoFollow: true } }, agentRun: () => ({ ok: false, errorCode: 'TOKEN_EXPIRED' }), failWrites: () => ++writes === 4 });
  const cardId = (await runtime.tool({ repo: 'octo/repo', pr: '9' })).reply.result.card_id;
  await runtime.click(cardId, 'pr:ready');
  const record = JSON.parse(runtime.files.get(`pr-cards/${cardId}.json`));
  assert.equal(record.pending, null);
  assert.match(runtime.lastCard(cardId).html, /<button data-ghost-action="pr:follow"/);
});

test('after an uncertain mark-ready the button stays away until the PR has been read again', async () => {
  let reads = 0;
  const github = (request) => {
    const { query } = JSON.parse(request.body);
    if (query.startsWith('mutation')) return { ok: false, status: 502, body: '', headers: {} };
    if (query.includes('{id}')) return jsonResponse({ data: { repository: { pullRequest: { id: 'PR_node' } } } });
    reads += 1;
    if (reads === 2) return { ok: false, status: 502, body: '', headers: {} };
    return jsonResponse({ data: { repository: { pullRequest: { number: 9, title: 'Draft', url: 'https://github.com/octo/repo/pull/9', state: 'OPEN', isDraft: true, merged: false,
      mergeStateStatus: 'CLEAN', reviewDecision: null, baseRefName: 'main', commits: { nodes: [] }, reviewThreads: { nodes: [] } } } } });
  };
  const runtime = createPrRuntime({ github });
  const cardId = (await runtime.tool({ repo: 'octo/repo', pr: '9' })).reply.result.card_id;
  assert.match(runtime.lastCard(cardId).html, /<button data-ghost-action="pr:ready"/);
  await runtime.click(cardId, 'pr:ready');
  assert.ok(visibleText(runtime.lastCard(cardId).html).includes(zhCopy.prReadyUnknown));
  assert.doesNotMatch(runtime.lastCard(cardId).html, /<button data-ghost-action="pr:ready"/);
  // A click that still arrives (an old card on another screen) does nothing.
  const agentRunsBefore = runtime.agentRuns.length;
  await runtime.click(cardId, 'pr:ready');
  assert.equal(runtime.agentRuns.length, agentRunsBefore);
  // The agent reads the PR again: the real state is known, so the button returns.
  await runtime.tool({ card_id: cardId, pr: '9' });
  assert.match(runtime.lastCard(cardId).html, /<button data-ghost-action="pr:ready"/);
});

test('an exception after the mark-ready write went out is shown as uncertain, not swallowed', async () => {
  let calls = 0;
  const github = (request) => {
    const { query } = JSON.parse(request.body);
    if (query.startsWith('mutation')) return jsonResponse({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: true } } } });
    if (query.includes('{id}')) return jsonResponse({ data: { repository: { pullRequest: { id: 'PR_node' } } } });
    calls += 1;
    if (calls > 1) throw new Error('connection reset');
    return jsonResponse({ data: { repository: { pullRequest: { number: 9, title: 'Draft', url: 'https://github.com/octo/repo/pull/9', state: 'OPEN', isDraft: true, merged: false,
      mergeStateStatus: 'CLEAN', reviewDecision: null, baseRefName: 'main', commits: { nodes: [] }, reviewThreads: { nodes: [] } } } } });
  };
  const runtime = createPrRuntime({ github });
  const cardId = (await runtime.tool({ repo: 'octo/repo', pr: '9' })).reply.result.card_id;
  await runtime.click(cardId, 'pr:ready');
  const text = visibleText(runtime.lastCard(cardId).html).join('\n');
  assert.ok(text.includes(zhCopy.prReadyUnknown));
  assert.ok(!text.includes(zhCopy.prReadyFailed.split('{')[0]));
});

test('pr_card does not invent a state it could not read, and does not show a card it could not save', async () => {
  // Status unreadable and no earlier snapshot: no card, so no wrong buttons.
  const unreadable = createPrRuntime({ github: () => ({ ok: false, status: 502, body: '', headers: {} }) });
  const failed = await unreadable.tool({ repo: 'octo/repo', pr: '9' });
  assert.equal(failed.reply.ok, false);
  assert.equal(unreadable.cards(failed.callId).length, 0);

  // The card record cannot be saved: buttons would find nothing, so the card is not shown.
  const full = createPrRuntime({ failWrites: true });
  const saved = await full.tool({ repo: 'octo/repo', head: 'feat/x', base: 'main' });
  assert.equal(saved.reply.ok, false);
  assert.equal(saved.reply.message, zhCopy.prSaveFailed);
  assert.equal(full.cards(saved.callId).length, 0);
});

// The follow-up round can run on a cheaper model than the task. The card uses the host's own
// model picker (no hard-coded list), shows the chosen name, and hands the full route to the agent.
test('card settings pick the auto-follow model with the host picker and hand its route to the agent', async () => {
  const route = { agentKind: 'cc', providerId: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium', fastMode: false };
  const pickModel = async (request) => { picks.push(JSON.parse(JSON.stringify(request))); return { ok: true, route }; };
  const picks = [];
  const runtime = createPrRuntime({ github: prGraphql({ number: 7 }), pickModel,
    agentModels: [{ id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', providerId: 'anthropic', providerName: 'Anthropic' }] });
  const cardId = (await runtime.tool({ repo: 'octo/repo', head: 'fix/login', base: 'main' })).reply.result.card_id;
  await runtime.click(cardId, 'prui:settings');
  // Default is following the task; the choice is a two-way switch.
  assert.ok(visibleText(runtime.lastCard(cardId).html).includes(zhCopy.prFollowModelTaskHint));
  // The phone sees only button names, so the selected half says so.
  assert.match(runtime.lastCard(cardId).html, /data-ghost-action="prset:modelTask" aria-label="跟随当前任务（当前）"/);
  assert.match(runtime.lastCard(cardId).html, /data-ghost-action="prset:model" aria-label="指定模型"/);

  await runtime.click(cardId, 'prset:model', { mobilePageId: '12345678-1234-1234-1234-123456789abc' });
  // The picker opens on the device that tapped the card.
  assert.deepEqual(picks, [{ mobilePageId: '12345678-1234-1234-1234-123456789abc' }]);
  const chosen = { route, label: 'Sonnet 5.5 · Anthropic' };
  assert.deepEqual(runtime.kv.prCard, { autoRename: false, autoFollow: false, followModel: chosen, lastFollowModel: chosen });
  // The chosen model shows as a clickable name; clicking it changes the model.
  assert.match(runtime.lastCard(cardId).html, /data-ghost-action="prset:modelPick"[^>]*>.*Sonnet 5\.5 · Anthropic<\/span>/);

  await runtime.tool({ card_id: cardId, pr: '7' });
  await runtime.click(cardId, 'pr:follow');
  assert.deepEqual(runtime.agentRuns.at(-1).event.follow_model, {
    model_agent_kind: 'claude-code', provider_id: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium', fast_mode: false, label: 'Sonnet 5.5 · Anthropic',
  });

  // Back to following the task keeps the chosen model in memory: picking "choose a model" again
  // restores it without reopening the picker; changing it goes through the model name.
  await runtime.click(cardId, 'prset:modelTask');
  assert.deepEqual(runtime.kv.prCard, { autoRename: false, autoFollow: false, lastFollowModel: { route, label: 'Sonnet 5.5 · Anthropic' } });
  await runtime.click(cardId, 'prset:model');
  assert.equal(picks.length, 1);
  assert.deepEqual(runtime.kv.prCard.followModel, { route, label: 'Sonnet 5.5 · Anthropic' });
  assert.match(runtime.lastCard(cardId).html, /data-ghost-action="prset:modelPick" aria-label="更换模型（当前：Sonnet 5.5 · Anthropic）"/);
  await runtime.click(cardId, 'prset:modelPick');
  assert.deepEqual(picks.at(-1), { initial: route });

  // A host with the in-card dropdown opens it under the button (the current model rides on the
  // button) and returns the checked choice with the click; the dialog picker stays closed.
  assert.ok(runtime.lastCard(cardId).html.includes(` data-ghost-model-select="${JSON.stringify(route).replace(/"/g, '&quot;')}"`));
  const codex = { agentKind: 'codex', providerId: 'openai', model: 'gpt-5.6', effort: 'high', fastMode: true };
  await runtime.click(cardId, 'prset:modelPick', { modelSelection: codex });
  assert.equal(picks.length, 2);
  assert.deepEqual(runtime.kv.prCard.followModel, { route: codex, label: 'gpt-5.6' });
});

// Remote providers: the card dropdown can pick a model on another computer or from a shared provider.
// The card names where it runs, and the agent gets the location to set on the follow-up schedule.
test('a follow model on another computer or a shared provider keeps its location', async () => {
  const picks = [];
  const runtime = createPrRuntime({
    github: prGraphql({ number: 7 }),
    pickModel: async (request) => { picks.push(JSON.parse(JSON.stringify(request))); return { ok: false, errorCode: 'CANCELLED' }; },
    agentModels: (device) => device === 'mac-mini'
      ? [{ id: 'claude-opus-5-5', name: 'Opus 5.5', providerId: 'anthropic', providerName: 'Anthropic' }]
      : device === 'share:abc' ? [{ id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', providerId: 'openai', providerName: 'OpenAI' }] : [],
    agentLocations: [{ agentDeviceId: 'mac-mini', name: 'Mac mini' }, { agentDeviceId: 'share:abc', name: 'OpenAI · 来自 Magi 的分享' }],
  });
  const cardId = (await runtime.tool({ repo: 'octo/repo', head: 'fix/login', base: 'main' })).reply.result.card_id;
  await runtime.click(cardId, 'prui:settings');
  const remote = { agentKind: 'cc', providerId: 'anthropic', model: 'claude-opus-5-5', effort: 'high', fastMode: false, agentDeviceId: 'mac-mini' };
  await runtime.click(cardId, 'prset:modelPick', { modelSelection: remote });
  assert.deepEqual(runtime.kv.prCard.followModel, { route: remote, label: 'Opus 5.5 · Anthropic · Mac mini' });
  assert.ok(runtime.lastCard(cardId).html.includes(JSON.stringify(remote).replace(/"/g, '&quot;')));

  const shared = { agentKind: 'codex', providerId: 'openai', model: 'gpt-6.1-sol', effort: 'medium', fastMode: false, agentDeviceId: 'share:abc' };
  await runtime.click(cardId, 'prset:modelPick', { modelSelection: shared });
  assert.equal(runtime.kv.prCard.followModel.label, 'GPT-6.1-Sol · OpenAI · 来自 Magi 的分享');

  await runtime.tool({ card_id: cardId, pr: '7' });
  await runtime.click(cardId, 'pr:follow');
  assert.equal(runtime.agentRuns.at(-1).event.follow_model.agent_device_id, 'share:abc');
  // The generic picker (phone, older hosts) only knows this computer: no remote initial value.
  await runtime.click(cardId, 'prset:modelPick');
  assert.deepEqual(picks.at(-1), {});
  // A location the host would not offer never gets stored.
  await runtime.click(cardId, 'prset:modelPick', { modelSelection: { ...remote, agentDeviceId: 'local' } });
  assert.equal(runtime.kv.prCard.followModel.route.agentDeviceId, 'share:abc');
});

test('a click the agent clearly did not receive keeps the ask card; an unclear one stays in progress', async () => {
  const cases = [
    [() => ({ ok: false, errorCode: 'TOKEN_EXPIRED' }), {}, zhCopy.prHandoffFailed],
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

  // The call threw: the agent may have received it, so the buttons must not offer the same action again.
  const unclear = createPrRuntime({ agentRun: () => { throw new Error('bridge closed'); } });
  const cardId = (await unclear.tool({ repo: 'octo/repo', head: 'feat/x' })).reply.result.card_id;
  await unclear.click(cardId, 'pr:publish');
  const card = unclear.lastCard(cardId);
  assert.doesNotMatch(card.html, /<button data-ghost-action="pr:(publish|draft)"/);
  assert.equal(visibleText(card.html).at(-1), zhCopy.prHandoffUnknown);
  assert.equal(card.state, 'working');
});

test('pr_card rejects unusable input and keeps its largest card under the host size limit', async () => {
  const runtime = createPrRuntime();
  assert.equal((await runtime.tool({ head: 'feat/x' })).reply.message, zhCopy.prNeedRepo);
  assert.equal((await runtime.tool({ repo: 'octo/repo' })).reply.message, zhCopy.prNeedHead);
  assert.equal((await runtime.tool({ repo: 'octo/repo', pr: 'pull/abc' })).reply.message, zhCopy.prBadPr);
  assert.equal((await runtime.tool({ card_id: '../escape' })).reply.message, zhCopy.prBadCardId);

  const files = Array.from({ length: 80 }, (_, i) => ({ path: `packages/module-${i}/index.ts`, additions: 1000 + i, deletions: i }));
  const ask = await runtime.tool({ repo: 'octo/repo', head: `feat/${'x'.repeat(250)}`, base: 'main', commits: 99, files, files_total: 80 });
  const cardId = ask.reply.result.card_id;
  await runtime.click(cardId, 'prui:settings');
  const { html } = runtime.lastCard(cardId);
  assert.ok(Buffer.byteLength(html) < 32 * 1024, `${Buffer.byteLength(html)} bytes`);

  // Uncommitted changes: the card reports files only, never "0 commits".
  const pending = await runtime.tool({ repo: 'octo/repo', head: 'feat/x', base: 'main', commits: 0, files_total: 1 });
  assert.equal(visibleText(runtime.lastCard(pending.reply.result.card_id).html)[2], `feat/x → main · ${zhCopy.prFileOne}`);
});


test('idle cards in different tasks stay interactive without automatically following', async () => {
  const runtime = createPrRuntime({ github: prGraphql(), kv: { prCard: { autoFollow: true, autoRename: true } } });
  const [first, second] = await Promise.all([
    runtime.tool({ repo: 'octo/repo', pr: 42 }),
    runtime.tool({ repo: 'octo/repo', pr: 42, session_context: { session_id: 's2' } }),
  ]);
  for (const card of [first, second]) {
    assert.equal(card.reply.ok, true);
    assert.equal(card.reply.result.disposition, undefined);
    assert.equal(card.reply.result.todo, undefined);
    assert.match(runtime.lastCard(card.callId).html, /data-ghost-action="pr:follow"/);
  }
  assert.notEqual(first.reply.result.card_id, second.reply.result.card_id);
  assert.equal(runtime.agentRuns.length, 0);
  assert.equal(runtime.files.size, 2);
});

test('concurrent follow claims reserve one task and render the other card as status plus task link', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const [first, second] = await Promise.all([
    runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true }),
    runtime.tool({ repo: 'OCTO/REPO', pr: 42, claim_follow: true, session_context: { session_id: 's2' } }),
  ]);
  assert.equal(first.reply.result.follow_claimed, true);
  assert.equal(second.reply.result.follow_claimed, false);
  assert.equal(second.reply.result.disposition, 'existing_task');
  assert.equal(second.reply.result.card_id, second.callId);
  assert.equal(second.reply.result.task_url, 'cindy://session/s1');
  assert.deepEqual(second.reply.result.todo, []);
  const html = runtime.lastCard(second.callId).html;
  assert.match(html, /其他任务正在开启跟进/);
  assert.match(html, /data-ghost-session-link="cindy:\/\/session\/s1"/);
  assert.match(html, /data-ghost-pr-status="octo\/repo#42"/);
  assert.deepEqual([...html.matchAll(/data-ghost-action="([^"]+)"/g)].map(match => match[1]), ['pr:open-task']);
  assert.doesNotMatch(html, /data-ghost-task-archive/);
});

test('simultaneous clicks on previously idle cards hand off once and redraw the stale card', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const a = await runtime.tool({ repo: 'octo/repo', pr: 42 });
  const b = await runtime.tool({ repo: 'octo/repo', pr: 42, session_context: { session_id: 's2' } });
  await Promise.all([
    runtime.click(b.callId, 'pr:follow', { sessionId: 's2' }),
    runtime.click(a.callId, 'pr:follow'),
  ]);
  assert.equal(runtime.agentRuns.length, 1);
  assert.equal(runtime.agentRuns[0].event.card_id, b.callId);
  assert.match(runtime.lastCard(a.callId).html, /data-ghost-session-link="cindy:\/\/session\/s2"/);
  assert.deepEqual([...runtime.lastCard(a.callId).html.matchAll(/data-ghost-action="([^"]+)"/g)].map(match => match[1]), ['pr:open-task']);
});

test('stopping retains the reservation; after confirmed stop the user can follow in a different task', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const a = await runtime.tool({ repo: 'octo/repo', pr: 42, following: true });
  await runtime.click(a.callId, 'pr:stop');
  const stopping = await runtime.tool({ card_id: a.callId, claim_follow: true });
  assert.equal(stopping.reply.result.follow_claimed, false);
  const b = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 's2' } });
  assert.equal(b.reply.result.follow_claimed, false);
  assert.match(runtime.lastCard(b.callId).html, /其他任务正在停止跟进/);
  // The agent reports false only after scheduler deletion has been confirmed.
  const stopped = await runtime.tool({ card_id: a.callId, following: false, claim_follow: true });
  assert.equal(stopped.reply.result.follow_claimed, false);
  const available = await runtime.tool({ card_id: b.callId, session_context: { session_id: 's2' } });
  assert.equal(available.reply.result.disposition, undefined);
  assert.match(runtime.lastCard(b.callId).html, /data-ghost-action="pr:follow"/);
  await runtime.click(b.callId, 'pr:follow', { sessionId: 's2' });
  assert.equal(runtime.agentRuns.length, 2); // stop in A, start in B
  await runtime.tool({ card_id: b.callId, following: true, session_context: { session_id: 's2' } });
  const old = await runtime.tool({ card_id: a.callId });
  assert.equal(old.reply.result.task_url, 'cindy://session/s2');
  assert.match(runtime.lastCard(a.callId).html, /其他任务正在跟进/);
});

test('same task reuses its card and foreign updates cannot change the active follower', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const first = await runtime.tool({ repo: 'octo/repo', pr: 42, following: true });
  const again = await runtime.tool({ repo: 'octo/repo', pr: 42 });
  assert.equal(again.reply.result.card_id, first.callId);
  const before = runtime.files.get(`pr-cards/${first.callId}.json`);
  const foreign = await runtime.tool({ card_id: first.callId, to_latest: true, following: false,
    session_context: { session_id: 's2' } });
  assert.equal(foreign.reply.result.disposition, 'existing_task');
  await runtime.click(first.callId, 'pr:stop', { sessionId: 's2' });
  assert.equal(runtime.agentRuns.length, 0);
  assert.equal(runtime.files.get(`pr-cards/${first.callId}.json`), before);
});

test('follow reservations survive restart and missing context cannot create cards', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true });
  const restarted = createPrRuntime({ files: runtime.files, github: prGraphql() });
  const foreign = await restarted.tool({ repo: 'octo/repo', pr: 42, session_context: { session_id: 's2' } });
  assert.equal(foreign.reply.result.disposition, 'existing_task');
  const missing = await restarted.tool({ repo: 'octo/repo', pr: 43, session_context: null });
  assert.equal(missing.reply.ok, false);
  assert.equal(restarted.files.size, 2);
});

test('legacy active follow-ups block new claims until refreshed explicitly in their original task', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const original = await runtime.tool({ repo: 'octo/repo', pr: 42, following: true });
  const path = `pr-cards/${original.callId}.json`;
  const legacy = JSON.parse(runtime.files.get(path));
  delete legacy.sessionId;
  runtime.files.set(path, JSON.stringify(legacy));
  const duplicate = await runtime.tool({ repo: 'octo/repo', pr: 42, session_context: { session_id: 's2' } });
  assert.equal(duplicate.reply.ok, false);
  const refresh = await runtime.tool({ card_id: original.callId });
  assert.equal(refresh.reply.ok, true);
  assert.equal(JSON.parse(runtime.files.get(path)).sessionId, 's1');
});

test('unpublished cards do not own a branch and corrupt history prevents follow claims', async () => {
  const runtime = createPrRuntime();
  await runtime.tool({ repo: 'octo/repo', head: 'feature' });
  const other = await runtime.tool({ repo: 'octo/repo', head: 'feature', session_context: { session_id: 's2' } });
  assert.equal(other.reply.ok, true);
  assert.equal(other.reply.result.disposition, undefined);
  runtime.files.set('pr-cards/broken.json', '{');
  const failed = await runtime.tool({ repo: 'octo/repo', head: 'another', claim_follow: true });
  assert.equal(failed.reply.ok, false);
  assert.equal(runtime.files.size, 3);
});

test('active follow reservations are not pruned when card history exceeds retention', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const first = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true });
  for (let i = 0; i < 205; i++) {
    runtime.files.set(`pr-cards/old-${i}.json`, JSON.stringify({ id: `old-${i}`, repo: 'other/repo', stage: 'closed' }));
  }
  await runtime.tool({ repo: 'other/repo', head: 'new' });
  assert.ok(runtime.files.has(`pr-cards/${first.callId}.json`));
  const other = await runtime.tool({ repo: 'octo/repo', pr: 42, session_context: { session_id: 's2' } });
  assert.equal(other.reply.result.disposition, 'existing_task');
});

test('other-task refresh reuses its local card and reads status without changing the follower', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const owner = await runtime.tool({ repo: 'octo/repo', pr: 42, following: true });
  const ownerPath = `pr-cards/${owner.callId}.json`;
  const before = runtime.files.get(ownerPath);
  const ref = await runtime.tool({ repo: 'octo/repo', pr: 42, session_context: { session_id: 's2' } });
  runtime.setGithub(prGraphql({ ci: 'FAILURE', threads: [false] }));
  const refresh = await runtime.tool({ card_id: ref.reply.result.card_id, following: true,
    to_latest: true, session_context: { session_id: 's2' } });
  assert.equal(refresh.reply.result.card_id, ref.callId);
  // The read-only card moves like any other card: the old place becomes a stub, the local card_id stays.
  assert.equal(runtime.lastCard(ref.callId).sourceCallId, refresh.callId);
  assert.equal(runtime.lastCard(ref.callId).supersededBy, refresh.callId);
  assert.match(runtime.lastCard(refresh.callId).html, /CI 未通过/);
  assert.equal(runtime.files.get(ownerPath), before);
  assert.equal(runtime.files.size, 3);
  await runtime.click(refresh.callId, 'pr:follow', { sessionId: 's2' });
  assert.equal(runtime.agentRuns.length, 0);
});

test('without a card surface, a follow claim still succeeds, blocks other tasks and can be released', async () => {
  const runtime = createPrRuntime({ github: prGraphql(), refuseCards: true });
  const claimed = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true });
  assert.equal(claimed.reply.ok, true);
  assert.equal(claimed.reply.result.follow_claimed, true);
  assert.equal(claimed.reply.result.card_shown, false);
  const other = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 's2' } });
  assert.equal(other.reply.ok, true);
  assert.equal(other.reply.result.disposition, 'existing_task');
  assert.equal(other.reply.result.card_shown, false);
  // Releasing without a card is not undone by the failed redraw.
  const released = await runtime.tool({ card_id: claimed.reply.result.card_id, following: false });
  assert.equal(released.reply.ok, true);
  const retaken = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 's2' } });
  assert.equal(retaken.reply.result.follow_claimed, true);
});

test('a refused card on a plain refresh still releases a reservation that call added', async () => {
  const options = { github: prGraphql(), kv: { prCard: { autoFollow: true } } };
  const runtime = createPrRuntime(options);
  const ask = await runtime.tool({ repo: 'octo/repo', head: 'feature' });
  options.refuseCards = true;
  const refused = await runtime.tool({ card_id: ask.callId, pr: 42 });
  assert.equal(refused.reply.ok, false);
  options.refuseCards = false;
  const other = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 's2' } });
  assert.equal(other.reply.result.follow_claimed, true);
});

test('merged cards cannot claim following and other-task references cannot archive the viewing task', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  await runtime.tool({ repo: 'octo/repo', pr: 42, following: true });
  runtime.setGithub(prGraphql({ merged: true }));
  const ref = await runtime.tool({ repo: 'octo/repo', pr: 42, session_context: { session_id: 's2' } });
  const html = runtime.lastCard(ref.callId).html;
  assert.match(html, /已合并/);
  assert.deepEqual([...html.matchAll(/data-ghost-action="([^"]+)"/g)].map(match => match[1]), ['pr:open-task']);
  assert.doesNotMatch(html, /data-ghost-task-archive/);
  const ended = createPrRuntime({ github: prGraphql({ merged: true }) });
  assert.equal((await ended.tool({ repo: 'octo/repo', pr: 42, claim_follow: true })).reply.result.follow_claimed, false);
});

test('publishing with auto-follow reserves the originating task before returning its todo', async () => {
  const runtime = createPrRuntime({ github: prGraphql(), kv: { prCard: { autoFollow: true } } });
  const ask = await runtime.tool({ repo: 'octo/repo', head: 'feature' });
  const published = await runtime.tool({ card_id: ask.callId, pr: 42 });
  assert.equal(published.reply.result.todo.length, 1);
  const other = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 's2' } });
  assert.equal(other.reply.result.disposition, 'existing_task');
  assert.equal(other.reply.result.follow_claimed, false);
});

test('a rejected handoff releases the reservation but an unknown handoff retains it', async () => {
  for (const unknown of [false, true]) {
    const runtime = createPrRuntime({ github: prGraphql(), agentRun: () => {
      if (unknown) throw new Error('transport disconnected');
      return { ok: false };
    } });
    const first = await runtime.tool({ repo: 'octo/repo', pr: 42 });
    await runtime.click(first.callId, 'pr:follow');
    const other = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 's2' } });
    assert.equal(other.reply.result.follow_claimed, !unknown);
    assert.equal(other.reply.result.disposition, unknown ? 'existing_task' : undefined);
  }
});

test('a stop report cannot reapply deferred post-publication auto-follow settings', async () => {
  const runtime = createPrRuntime({ github: prGraphql(), kv: { prCard: { autoFollow: true } } });
  const ask = await runtime.tool({ repo: 'octo/repo', head: 'feature' });
  const stopped = await runtime.tool({ card_id: ask.callId, pr: 42, following: false, claim_follow: true });
  assert.equal(stopped.reply.result.follow_claimed, false);
  assert.equal(stopped.reply.result.todo, undefined);
  const other = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 's2' } });
  assert.equal(other.reply.result.follow_claimed, true);
});

test('a task with its own legacy duplicate follow record can still stop it while another task is active', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const first = await runtime.tool({ repo: 'octo/repo', pr: 42, following: true });
  const dupId = '00000000-0000-4000-8000-0000000000aa';
  const dup = { ...JSON.parse(runtime.files.get(`pr-cards/${first.callId}.json`)), id: dupId, sessionId: 's2' };
  runtime.files.set(`pr-cards/${dupId}.json`, JSON.stringify(dup));
  const stopped = await runtime.tool({ card_id: dupId, following: false, session_context: { session_id: 's2' } });
  assert.equal(stopped.reply.result.disposition, undefined);
  assert.equal(JSON.parse(runtime.files.get(`pr-cards/${dupId}.json`)).following, false);
  // The other task's record is untouched and still excludes a third task.
  assert.equal(JSON.parse(runtime.files.get(`pr-cards/${first.callId}.json`)).following, true);
  const third = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 's3' } });
  assert.equal(third.reply.result.disposition, 'existing_task');
});

// IM has no PR card surface. Preferences must still be readable through the real tool dispatcher.
test('IM follow settings share card preferences and selected remote model without starting work', async () => {
  const model = { route: { agentKind: 'cc', providerId: 'example-provider', model: 'example-model', effort: 'high', fastMode: false, agentDeviceId: 'example-device' }, label: 'Example' };
  const runtime = createPrRuntime({ kv: { unrelated: 'keep', prCard: { autoRename: true, autoFollow: true, followModel: model } }, github: prGraphql() });
  const read = await runtime.tool({}, 'pr_follow_settings');
  assert.equal(read.reply.ok, true);
  assert.deepEqual(read.reply.result.settings, {
    auto_rename: true, auto_follow: true,
    follow_model: { model_agent_kind: 'claude-code', provider_id: 'example-provider', model: 'example-model', effort: 'high', fast_mode: false, agent_device_id: 'example-device', label: 'Example' },
  });
  assert.equal(runtime.cards(read.callId).length, 0);
  assert.equal(runtime.files.size, 0);
  assert.equal(runtime.agentRuns.length, 0);
  assert.equal(runtime.kv.unrelated, 'keep');
  // Publishing from an ask card applies the settings once; merely viewing an existing PR does not.
  const ask = await runtime.tool({ repo: 'octo/repo', head: 'feature' });
  const card = await runtime.tool({ card_id: ask.callId, pr: 42 });
  assert.deepEqual(card.reply.result.settings, read.reply.result.settings);
  // Card switch changes are immediately visible to the IM entry; the reader never consumes card todos.
  assert.ok(card.reply.result.todo.some((item) => item.includes('42')));
  await runtime.click(card.reply.result.card_id, 'prset:follow');
  assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.result.settings.auto_follow, false);
});

test('settings switch saves through the runtime and restores its stored value on failure', async () => {
  const kv = { prCard: { autoFollow: false }, unrelated: 1 };
  let failWrite = false;
  const runtime = createRuntime({ localFetch: async (url, init) => {
    assert.equal(url, '/kv');
    if (init?.method === 'PUT' && !failWrite) Object.assign(kv, JSON.parse(init.body));
    return { ok: init?.method !== 'PUT' || !failWrite, json: async () => structuredClone(kv) };
  } });
  class Channel extends EventTarget {
    constructor() {
      super();
      runtime.channel.postMessage = data => this.dispatchEvent(new MessageEvent('message', { data }));
    }
    postMessage(data) { runtime.channel.onmessage({ data }); }
  }
  const page = createSettings({ channel: Channel, kv });
  await flushAsync();
  const control = page.elements.get('follow-after-open');
  assert.equal(control.disabled, false);
  assert.equal(control.checked, false);
  control.checked = true;
  await control.listeners.change();
  await flushAsync();
  assert.equal((await runtime.tool('pr_follow_settings')).result.settings.auto_follow, true);
  failWrite = true;
  control.checked = false;
  await control.listeners.change();
  await flushAsync();
  assert.equal(control.checked, true);
  assert.equal(control.disabled, false);
  assert.ok(page.elements.get('follow-status').textContent);
});

test('settings switch waits for a delivered save that is queued behind another PR action', async () => {
  const kv = { prCard: { autoFollow: false } };
  const timers = [];
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const runtime = createRuntime({ localFetch: async (url, init) => {
    assert.equal(url, '/kv');
    if (init?.method === 'PUT') Object.assign(kv, JSON.parse(init.body));
    return { ok: true, json: async () => structuredClone(kv) };
  } });
  class Channel extends EventTarget {
    constructor() {
      super();
      runtime.channel.postMessage = data => this.dispatchEvent(new MessageEvent('message', { data }));
    }
    postMessage(data) { runtime.channel.onmessage({ data }); }
  }
  const page = createSettings({ channel: Channel, kv, setTimeout: (fn) => { timers.push(fn); return timers.length; } });
  await flushAsync();
  const control = page.elements.get('follow-after-open');
  // Another PR action (for example an open model picker) holds the shared queue.
  const held = runtime.context.enqueuePr(() => blocker);
  control.checked = true;
  await control.listeners.change();
  await flushAsync();
  for (const fn of timers.splice(0)) fn();
  assert.equal(control.checked, true);
  assert.equal(control.disabled, true);
  assert.equal(page.elements.get('follow-status').textContent, page.messages['zh-CN'].followPending);
  release();
  await held;
  await flushAsync();
  assert.equal(kv.prCard.autoFollow, true);
  assert.equal(control.checked, true);
  assert.equal(control.disabled, false);
  assert.equal(page.elements.get('follow-status').textContent, '');
});

test('setting auto-follow is explicit, preserves other preferences and never starts work', async () => {
  const runtime = createPrRuntime({ kv: { unrelated: 'keep', prCard: { autoArchive: true, futureKey: 1 } } });
  for (const enabled of [true, true, false]) {
    const { reply } = await runtime.tool({ auto_follow: enabled }, 'set_pr_follow_settings');
    assert.equal(reply.result.settings.auto_follow, enabled);
    assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.result.settings.auto_follow, enabled);
  }
  assert.equal((await runtime.tool({ auto_follow: 'true' }, 'set_pr_follow_settings')).reply.ok, false);
  assert.equal(runtime.kv.prCard.autoFollow, false);
  assert.equal(runtime.kv.prCard.futureKey, 1);
  assert.equal(runtime.kv.prCard.autoArchive, true);
  assert.equal(runtime.kv.unrelated, 'keep');
  assert.equal(runtime.agentRuns.length, 0);
});

test('IM preferences remain available when cards cannot be delivered; missing differs from unreadable', async () => {
  for (const autoFollow of [false, true]) {
    const runtime = createPrRuntime({ refuseCards: true, kv: { prCard: { autoFollow } } });
    const { reply, callId } = await runtime.tool({}, 'pr_follow_settings');
    assert.equal(reply.ok, true);
    assert.equal(reply.result.settings.auto_follow, autoFollow);
    assert.equal(runtime.cards(callId).length, 0);
    assert.equal(runtime.files.size, 0);
  }
  const options = { kvFails: true, kv: { prCard: { autoFollow: true } } };
  const runtime = createPrRuntime(options);
  const failed = (await runtime.tool({}, 'pr_follow_settings')).reply;
  assert.equal(failed.ok, false);
  assert.equal(failed.result, undefined);
  assert.match(failed.message, /无法读取.*设置/);
  options.kvFails = false;
  assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.result.settings.auto_follow, true);
  assert.deepEqual((await createPrRuntime().tool({}, 'pr_follow_settings')).reply.result.settings, { auto_rename: false, auto_follow: false });
});

test('releasing a source task reservation lets the dedicated task claim the follow-up', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const source = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true });
  const blocked = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 'dedicated' } });
  assert.equal(blocked.reply.result.disposition, 'existing_task');
  await runtime.tool({ card_id: source.reply.result.card_id, following: false });
  const claimed = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 'dedicated' } });
  assert.equal(claimed.reply.result.disposition, undefined);
  assert.equal(claimed.reply.result.follow_claimed, true);
});

// Legacy clients dispatch the ordinary action after stripping the optional native task link.
// Navigation must use the active task at click time without creating a second reservation.
test('legacy task-entry clicks return only a navigation handoff and retain follow ownership', async () => {
  const runtime = createPrRuntime({ github: prGraphql() });
  const owner = await runtime.tool({ repo: 'octo/repo', pr: 42, following: true });
  const ref = await runtime.tool({ repo: 'octo/repo', pr: 42, session_context: { session_id: 's2' } });
  const ownerBefore = runtime.files.get(`pr-cards/${owner.callId}.json`);
  await runtime.click(ref.callId, 'pr:open-task', { sessionId: 'foreign' });
  await runtime.click(ref.callId, 'pr:open-task', { sessionId: 's2', userActionToken: undefined });
  assert.equal(runtime.agentRuns.length, 0);
  await runtime.click(ref.callId, 'pr:open-task', { sessionId: 's2' });
  assert.equal(runtime.agentRuns.length, 1);
  const request = runtime.agentRuns[0];
  assert.equal(request.mode, 'continue');
  assert.equal(request.event.action, 'open-task');
  assert.equal(request.event.task_url, 'cindy://session/s1');
  assert.match(request.userMessage, /仅在当前回复中显示一个 Markdown 链接/);
  assert.equal(runtime.files.get(`pr-cards/${owner.callId}.json`), ownerBefore);
  const refState = [...runtime.files.values()].map(JSON.parse).find(card => card.id === ref.callId);
  assert.equal(!!refState.following, false);
  assert.equal(!!refState.pending, false);
  await runtime.tool({ card_id: owner.callId, following: false });
  await runtime.tool({ repo: 'octo/repo', pr: 42, following: true, session_context: { session_id: 's3' } });
  await runtime.click(ref.callId, 'pr:open-task', { sessionId: 's2' });
  assert.equal(runtime.agentRuns.at(-1).event.task_url, 'cindy://session/s3');
});

function followScheduler(options = {}) {
  const rows = new Map();
  const runs = new Map();
  const calls = [];
  const hostApi = {
    host: { async call(server, tool, args) {
      assert.equal(server, 'cindy_scheduler');
      assert.equal(args.device, 'local');
      calls.push(tool);
      let data;
      if (tool === 'schedule_create') {
        if (options.createRace) {
          data = { ...args, id: 'other-entry', status: 'active', updatedAt: 1000 };
          rows.set(data.id, data);
          if (options.createRace !== 'different-receipt') throw new Error('create receipt unavailable');
          data = { ...data, id: 'created-receipt' };
        } else {
        if (options.reject) throw new Error('scheduler unavailable');
        data = { ...args, id: 'sch-1', status: 'active', updatedAt: 1000 };
        rows.set(data.id, data);
        if (options.loseCreateReceipt) throw new Error('lost receipt');
        }
      } else if (tool === 'schedule_get') {
        if (options.failGet) throw new Error('cannot verify');
        if (options.beforeGet) options.beforeGet(rows, args.id);
        data = rows.get(args.id) ?? null;
      } else if (tool === 'schedule_list') {
        if (options.failList) throw new Error('cannot list schedules');
        data = [...rows.values()];
      } else if (tool === 'schedule_list_runs') {
        if (options.failListRuns) throw new Error('cannot list runs');
        const list = runs.get(args.scheduleId) || [];
        data = typeof args.limit === 'number' ? list.slice(0, args.limit) : list.slice();
      } else if (tool === 'schedule_delete') {
        data = { deleted: args.id };
        rows.delete(args.id);
      } else throw new Error('unexpected ' + tool);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
    } },
    node: { async request({ method }) {
      assert.equal(method, 'followSkillDir');
      if (options.failDir) throw new Error('skill directory temporarily unavailable');
      return { ok: true, result: '/approved skills/agent-skills/skills/_root__cindy-github--pr' };
    } },
  };
  return { hostApi, calls, rows, runs };
}

test('first card selection before publishing sets the model on the first follow-up', async () => {
  const { hostApi, rows } = followScheduler();
  const runtime = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } },
    pickModel: () => assert.fail('an inline choice must not open a second picker') });
  const route = { agentKind: 'codex', providerId: 'openai', model: 'sol', effort: 'high', fastMode: false };
  const { callId } = await runtime.tool({ repo: 'octo/repo', head: 'topic' });
  const html = runtime.lastCard(callId).html;
  assert.match(html, /data-ghost-action="prset:model"[^>]+data-ghost-model-select=""/);
  assert.ok(html.indexOf('data-ghost-action="prset:model"') < html.indexOf('data-ghost-action="pr:publish"'));
  await runtime.click(callId, 'prset:model', { modelSelection: route });
  assert.deepEqual(runtime.kv.prCard.followModel.route, route);
  assert.match(runtime.lastCard(callId).html, /data-ghost-action="prset:modelPick"[^>]+sol/);
  assert.equal(rows.size, 0);
  await runtime.tool({ card_id: callId, pr: 42, published: true });
  assert.equal(rows.size, 1);
  assert.equal(rows.get('sch-1').model, 'sol');
  assert.equal(rows.get('sch-1').effort, 'high');
  assert.doesNotMatch(runtime.lastCard(callId).html, /data-ghost-action="prset:model"/);
});

test('publication starts exactly one verified follow-up without a model turn and stop removes it', async () => {
  const { hostApi, calls, rows } = followScheduler();
  const runtime = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: {
    autoFollow: true, followModel: { route: { agentKind: 'cc', providerId: 'chosen', model: 'sonnet',
      effort: 'high', fastMode: false, agentDeviceId: 'remote' } },
  } } });
  const { callId } = await runtime.tool({ repo: 'octo/repo', head: 'topic' });
  const result = (await runtime.tool({ card_id: callId, pr: 42 })).reply.result;
  assert.equal(result.follow_state, 'active');
  assert.equal(result.todo, undefined);
  const schedule = rows.get('sch-1');
  assert.equal(schedule.targetSessionId, 's1');
  assert.equal(schedule.modelAgentKind, 'claude-code');
  assert.equal(schedule.modelAgentDeviceId, 'remote');
  assert.equal(schedule.providerId, 'chosen');
  assert.equal(schedule.model, 'sonnet');
  assert.equal(schedule.effort, 'high');
  assert.equal(schedule.intervalMs, 300000);
  assert.equal(schedule.prTrigger.url, 'https://github.com/octo/repo/pull/42');
  assert.match(schedule.preRunHook.command, /pr-node\.cjs" pr-heartbeat-gate\.mjs https:\/\/github\.com\/octo\/repo\/pull\/42$/);
  await runtime.tool({ card_id: callId, pr: 42, published: true });
  assert.equal(calls.filter(c => c === 'schedule_create').length, 1);
  await runtime.click(callId, 'pr:stop');
  assert.equal(rows.size, 0);
  await runtime.tool({ card_id: callId });
  assert.equal(rows.size, 0);
  assert.equal(runtime.agentRuns.length, 0);
});

test('native Stop authority requires a successful matching create receipt, not an empty initial list', async () => {
  for (const options of [{ loseCreateReceipt: true }, { createRace: 'rejected' }, { createRace: 'different-receipt' }]) {
    const { hostApi, calls, rows } = followScheduler(options);
    const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
    assert.equal(opened.reply.result.follow_state, 'active');
    const row = [...rows.values()][0];
    assert.equal(JSON.parse(rt.files.get(`pr-cards/${opened.callId}.json`)).scheduleId, row.id);
    assert.doesNotMatch(opened.reply.result.note || '', /已有调度请在自动化设置手动停止/);
    assert.doesNotMatch(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止/);
    assert.doesNotMatch(rt.lastCard(opened.callId).html, /<button data-ghost-action="pr:stop"/);
    await rt.click(opened.callId, 'pr:stop');
    assert.equal(calls.includes('schedule_delete'), false);
    assert.equal(rt.agentRuns.length, 0);
    assert.deepEqual(rows.get(row.id), row);
    assert.match(rt.lastCard(opened.callId).html, new RegExp(`已有调度请在自动化设置手动停止（ID：${row.id}）`));
  }
});

const oldFollowHook = (url, timeoutMs = 180000) => ({
  command: 'node "/approved skills/agent-skills/skills/_root__cindy-github--pr/scripts/pr-heartbeat-gate.mjs" ' + url,
  timeoutMs,
});

test('reuse identifies the exact old generated hook, preserves it and gives the manual repair command', async () => {
  const { hostApi, calls, rows } = followScheduler();
  const url = 'https://github.com/octo/repo/pull/42';
  const old = { id: 'old', targetSessionId: 's1', status: 'active', recurring: true,
    prompt: 'Follow ' + url, intervalMs: 600000, cronExpr: '*/10 * * * *',
    model: 'previous-choice', nextFireAt: 12345, preRunHook: oldFollowHook(url, 123456) };
  rows.set('old', old);
  const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
  assert.equal(opened.reply.result.follow_state, 'unverified');
  const repair = opened.reply.result.legacy_hook_repair;
  assert.equal(repair.schedule_id, old.id);
  assert.match(repair.command, /pr-node\.cjs" pr-heartbeat-gate\.mjs https:\/\/github\.com\/octo\/repo\/pull\/42$/);
  assert.deepEqual(rows.get(old.id), old);
  assert.equal(calls.some(c => ['schedule_create', 'schedule_update'].includes(c)), false);
  // The user explicitly changes the command in Automation settings.
  rows.set(old.id, { ...old, preRunHook: { ...old.preRunHook, command: repair.command } });
  const refreshed = await rt.tool({ card_id: opened.callId });
  assert.equal(refreshed.reply.result.follow_state, 'active');
  assert.equal(refreshed.reply.result.legacy_hook_repair, undefined);
  assert.equal(rows.get(old.id).preRunHook.timeoutMs, 123456);
  await rt.click(opened.callId, 'pr:stop');
  assert.equal(rows.size, 1);
  assert.equal(calls.includes('schedule_delete'), false);
});

test('a concurrent user command or timeout save during GitHub refresh is never overwritten', async () => {
  const url = 'https://github.com/octo/repo/pull/42';
  for (const change of [
    { command: 'node "/project/scripts/pr-heartbeat-gate.mjs" ' + url, timeoutMs: 98765 },
    { ...oldFollowHook(url), timeoutMs: 98765 },
  ]) {
    const { hostApi, calls, rows } = followScheduler();
    const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
    const before = { ...rows.get('sch-1'), preRunHook: oldFollowHook(url) };
    rows.set('sch-1', before);
    let saved = false;
    const callCount = calls.length;
    rt.setGithub(request => {
      // The last schedule read must happen after the GitHub response.
      assert.equal(calls.length, callCount);
      rows.set('sch-1', { ...before, preRunHook: change });
      saved = true;
      return prGraphql()(request);
    });
    const refreshed = await rt.tool({ card_id: opened.callId });
    assert.equal(refreshed.reply.ok, true);
    assert.equal(saved, true);
    assert.deepEqual(rows.get('sch-1').preRunHook, change);
    assert.equal(calls.includes('schedule_update'), false);
    assert.equal(refreshed.reply.result.legacy_hook_repair !== undefined, change.command === before.preRunHook.command);
  }
});

test('a saved PR card cannot be rebound to another repository with the same PR number', async () => {
  const { hostApi, calls, rows } = followScheduler();
  const rt = createPrRuntime({ github: prGraphql(), hostApi });
  const original = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
  const originalPath = `pr-cards/${original.callId}.json`;
  const other = { id: 'other', targetSessionId: 's1', status: 'active', recurring: true,
    preRunHook: oldFollowHook('https://github.com/other/repo/pull/42') };
  rows.set(other.id, other);
  const before = rt.files.get(originalPath);
  const callCount = calls.length;
  let fetched = false;
  rt.setGithub(() => { fetched = true; return prGraphql({ owner: 'other' })(); });
  for (const args of [
    { repo: 'other/repo' },
    { repo: 'other/repo', pr: 42 },
    { pr: 'https://github.com/other/repo/pull/42' },
    { repo: 'other/repo', session_context: { session_id: 's2' } },
    { repo: 'other/repo', pr: 'https://github.com/octo/repo/pull/42' },
  ]) {
    const result = await rt.tool({ card_id: original.callId, ...args });
    assert.equal(result.reply.ok, false);
  }
  assert.equal(fetched, false, 'reject before asking GitHub or the scheduler');
  assert.equal(calls.length, callCount);
  assert.equal(rt.files.get(originalPath), before);
  assert.deepEqual(rows.get(other.id), other);
  rt.setGithub(prGraphql());
  const same = await rt.tool({ card_id: original.callId, repo: 'OCTO/Repo' });
  assert.equal(same.reply.ok, true);
  assert.equal(JSON.parse(rt.files.get(originalPath)).repo, 'octo/repo');
  assert.ok(!JSON.parse(rt.files.get(originalPath)).scheduleId);
});

test('refresh uses the schedule state after GitHub returns: pause, delete or changed ownership', async () => {
  for (const action of ['pause', 'delete', 'rebind']) {
    const { hostApi, calls, rows } = followScheduler();
    const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
    rows.get('sch-1').preRunHook = oldFollowHook('https://github.com/octo/repo/pull/42');
    const count = calls.length;
    rt.setGithub(request => {
      assert.equal(calls.length, count, 'the schedule is read after the PR request');
      if (action === 'pause') rows.get('sch-1').status = 'paused';
      else if (action === 'delete') rows.delete('sch-1');
      else rows.get('sch-1').targetSessionId = 's2';
      return prGraphql()(request);
    });
    const refreshed = await rt.tool({ card_id: opened.callId });
    if (action === 'rebind') {
      assert.equal(refreshed.reply.ok, false);
      assert.equal(rows.get('sch-1').targetSessionId, 's2');
    } else {
      assert.equal(refreshed.reply.result.follow_state, action === 'pause' ? 'paused' : 'stopped');
      assert.equal(refreshed.reply.result.legacy_hook_repair, undefined);
      assert.equal(JSON.parse(rt.files.get(`pr-cards/${opened.callId}.json`)).following, false);
    }
    assert.deepEqual(calls.slice(count), ['schedule_get']);
  }
});

test('native Follow button shows a repair state, exact command and schedule ID for a mixed-case old PR URL', async () => {
  const { hostApi, calls, rows } = followScheduler();
  const rt = createPrRuntime({ github: prGraphql(), hostApi });
  const ask = await rt.tool({ repo: 'octo/repo', head: 'topic' });
  await rt.tool({ card_id: ask.callId, pr: 42, published: true });
  const old = { id: 'old-schedule', targetSessionId: 's1', status: 'active', recurring: true,
    preRunHook: oldFollowHook('https://github.com/OCTO/Repo/pull/42', 123456) };
  rows.set(old.id, old);
  await rt.click(ask.callId, 'pr:follow');
  const card = rt.lastCard(ask.callId);
  const text = visibleText(card.html).join('\n');
  assert.match(text, /跟进待修复/);
  assert.match(text, /调度 ID：old-schedule/);
  assert.match(text, /node "\/approved skills\/agent-skills\/skills\/_root__cindy-github--pr\/scripts\/pr-node\.cjs" pr-heartbeat-gate\.mjs https:\/\/github\.com\/octo\/repo\/pull\/42/);
  assert.match(card.html, /<pre[^>]*user-select:text/);
  assert.doesNotMatch(card.html, /data-ghost-live-label=/);
  assert.equal(rt.agentRuns.length, 0, 'native button must provide the repair without a model turn');
  assert.deepEqual(rows.get(old.id), old);
  assert.equal(calls.some(c => ['schedule_create', 'schedule_update'].includes(c)), false);
});

test('owning card reports an active old hook only, never rewrites it or touches paused/foreign schedules', async () => {
  const { hostApi, calls, rows } = followScheduler();
  const url = 'https://github.com/octo/repo/pull/42';
  const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
  rows.get('sch-1').preRunHook = oldFollowHook(url);
  const peer = await rt.tool({ repo: 'octo/repo', pr: 42, session_context: { session_id: 's2' } });
  assert.equal(peer.reply.result.disposition, 'existing_task');
  rows.get('sch-1').status = 'paused';
  assert.equal((await rt.tool({ card_id: opened.callId })).reply.result.follow_state, 'paused');
  rows.get('sch-1').status = 'active';
  const refreshed = await rt.tool({ card_id: opened.callId });
  assert.equal(refreshed.reply.result.follow_state, 'unverified');
  assert.equal(refreshed.reply.result.legacy_hook_repair.schedule_id, 'sch-1');
  assert.deepEqual(rows.get('sch-1').preRunHook, oldFollowHook(url));
  assert.equal(calls.includes('schedule_update'), false);
  await rt.click(opened.callId, 'pr:stop');
  assert.equal(rows.size, 0);
});

test('same-name project script, custom shell command and terminal PR remain untouched', async () => {
  const { hostApi, calls, rows } = followScheduler();
  const url = 'https://github.com/octo/repo/pull/42';
  const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
  for (const command of [
    'node "/project/scripts/pr-heartbeat-gate.mjs" ' + url,
    'PATH="/modern/bin" ' + oldFollowHook(url).command,
    oldFollowHook(url).command.replace('/approved skills/', '/Approved skills/'),
    oldFollowHook(url).command.replace('" https:', '"  https:'),
    oldFollowHook(url).command.replace('/pull/', '/Pull/'),
  ]) {
    const custom = { command, timeoutMs: 1000 };
    rows.get('sch-1').preRunHook = custom;
    const result = await rt.tool({ card_id: opened.callId });
    assert.equal(result.reply.result.follow_state, 'active');
    assert.equal(result.reply.result.legacy_hook_repair, undefined);
    assert.deepEqual(rows.get('sch-1').preRunHook, custom);
  }
  rows.get('sch-1').preRunHook = oldFollowHook(url);
  rt.setGithub(prGraphql({ merged: true }));
  const result = await rt.tool({ card_id: opened.callId });
  assert.equal(result.reply.result.stage, 'merged');
  assert.equal(result.reply.result.legacy_hook_repair, undefined);
  assert.equal(calls.includes('schedule_update'), false);
});

test('refresh of a pre-native following card discovers its sole active legacy hook and reports a manual repair', async () => {
  const { hostApi, calls, rows } = followScheduler();
  const url = 'https://github.com/octo/repo/pull/42';
  const rt = createPrRuntime({ github: prGraphql(), hostApi });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
  const path = `pr-cards/${opened.callId}.json`;
  assert.equal(JSON.parse(rt.files.get(path)).following, true);
  assert.ok(!JSON.parse(rt.files.get(path)).scheduleId);
  const old = { id: 'old', targetSessionId: 's1', status: 'active', recurring: true,
    intervalMs: 600000, nextFireAt: 12345, preRunHook: oldFollowHook(url, 123456) };
  rows.set(old.id, old);
  const peer = await rt.tool({ repo: 'octo/repo', pr: 42, session_context: { session_id: 's2' } });
  assert.equal(peer.reply.result.disposition, 'existing_task');
  assert.equal(calls.includes('schedule_update'), false);
  const refreshed = await rt.tool({ card_id: opened.callId });
  assert.equal(refreshed.reply.result.follow_state, 'unverified');
  assert.equal(refreshed.reply.result.legacy_hook_repair.schedule_id, old.id);
  assert.equal(JSON.parse(rt.files.get(path)).scheduleId, old.id);
  assert.deepEqual(rows.get(old.id), old);
  assert.equal(calls.some(c => ['schedule_create', 'schedule_update'].includes(c)), false);
  rows.set(old.id, { ...old, preRunHook: { ...old.preRunHook, command: refreshed.reply.result.legacy_hook_repair.command } });
  assert.equal((await rt.tool({ card_id: opened.callId })).reply.result.follow_state, 'active');
  await rt.click(opened.callId, 'pr:stop');
  assert.equal(rows.size, 1, 'adopted schedule must be stopped in Automation');
});

test('discovery of an ID-less legacy card reports the final read after an active list result without acquiring a custom hook', async () => {
  for (const action of ['pause', 'delete', 'rebind', 'pause-and-custom']) {
    const { hostApi, calls, rows } = followScheduler({ beforeGet(rows, id) {
      if (action === 'pause') rows.get(id).status = 'paused';
      else if (action === 'delete') rows.delete(id);
      else if (action === 'rebind') rows.get(id).targetSessionId = 's2';
      else {
        const row = rows.get(id);
        row.status = 'paused';
        row.preRunHook = { command: 'node "/project/scripts/pr-heartbeat-gate.mjs" https://github.com/octo/repo/pull/42', timeoutMs: 98765 };
      }
    } });
    const rt = createPrRuntime({ github: prGraphql(), hostApi });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
    rows.set('old', { id: 'old', targetSessionId: 's1', status: 'active', recurring: true,
      preRunHook: oldFollowHook('https://github.com/octo/repo/pull/42') });
    const refreshed = await rt.tool({ card_id: opened.callId, ...(action === 'pause-and-custom' ? { claim_follow: true } : {}) });
    const card = JSON.parse(rt.files.get(`pr-cards/${opened.callId}.json`));
    assert.equal(card.following, false);
    assert.equal(card.legacyHookRepair, null);
    if (action === 'rebind' || action === 'pause-and-custom') {
      assert.equal(refreshed.reply.result.follow_state, 'failed');
      assert.equal(card.scheduleId, null);
      if (action === 'rebind') assert.equal(rows.get('old').targetSessionId, 's2');
      else {
        assert.equal(rows.get('old').status, 'paused');
        assert.match(refreshed.reply.result.note, /无法确认这条调度仍使用插件生成的前置检查/);
        assert.equal(rows.get('old').preRunHook.timeoutMs, 98765);
        assert.equal(refreshed.reply.result.follow_claimed, false);
      }
    } else {
      assert.equal(refreshed.reply.result.follow_state, action === 'pause' ? 'paused' : 'stopped');
      assert.equal(refreshed.reply.result.legacy_hook_repair, undefined);
      assert.equal(card.scheduleId, action === 'pause' ? 'old' : null);
    }
    if (action !== 'pause') {
      assert.doesNotMatch(rt.lastCard(opened.callId).html, /<button data-ghost-action="pr:stop"/);
      const saved = JSON.stringify([...rows.values()]);
      await rt.click(opened.callId, 'pr:stop');
      assert.equal(rt.agentRuns.length, 0, 'no fallback Stop can reach an unverified schedule');
      assert.equal(JSON.stringify([...rows.values()]), saved);
    }
    assert.deepEqual(calls, ['schedule_list', 'schedule_get']);
  }
});

test('an ID-less old card reflects a pause before GitHub returns, not its saved following flag', async () => {
  const { hostApi, calls, rows } = followScheduler();
  const rt = createPrRuntime({ github: prGraphql(), hostApi });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
  const old = { id: 'old', targetSessionId: 's1', status: 'active', recurring: true,
    preRunHook: oldFollowHook('https://github.com/octo/repo/pull/42') };
  rows.set(old.id, old);
  rt.setGithub(request => {
    assert.deepEqual(calls, []);
    rows.get(old.id).status = 'paused';
    return prGraphql()(request);
  });
  const refreshed = await rt.tool({ card_id: opened.callId });
  assert.equal(refreshed.reply.result.follow_state, 'paused');
  const card = JSON.parse(rt.files.get(`pr-cards/${opened.callId}.json`));
  assert.equal(card.scheduleId, old.id);
  assert.equal(card.following, false);
  assert.equal(card.scheduleStatus, 'paused');
  assert.match(visibleText(rt.lastCard(opened.callId).html).join('\n'), /跟进已暂停/);
  assert.doesNotMatch(rt.lastCard(opened.callId).html, /data-ghost-live-label=/);
  assert.deepEqual(calls, ['schedule_list', 'schedule_get']);
  await rt.click(opened.callId, 'pr:stop');
  assert.equal(rows.size, 1, 'adopted paused schedule remains intact');
});

test('a previously verified card cannot delete a schedule changed to a custom same-name hook before Stop', async () => {
  const { hostApi, calls, rows } = followScheduler();
  const rt = createPrRuntime({ github: prGraphql(), hostApi });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
  const old = { id: 'old', targetSessionId: 's1', status: 'paused', recurring: true,
    preRunHook: oldFollowHook('https://github.com/octo/repo/pull/42') };
  rows.set(old.id, old);
  assert.equal((await rt.tool({ card_id: opened.callId })).reply.result.follow_state, 'paused');
  const custom = { ...old, preRunHook: { command: 'node "/project/scripts/pr-heartbeat-gate.mjs" https://github.com/octo/repo/pull/42', timeoutMs: 98765 } };
  rows.set(old.id, custom);
  await rt.click(opened.callId, 'pr:stop');
  assert.deepEqual(rows.get(old.id), custom);
  assert.equal(calls.includes('schedule_delete'), false);
  assert.equal(rt.agentRuns.length, 0);
});

test('ID-less discovery and native reuse accept the exact launcher, not a project script', async () => {
  const url = 'https://github.com/octo/repo/pull/42';
  for (const native of [false, true]) {
    for (const custom of [false, true]) {
      const { hostApi, calls, rows } = followScheduler();
      const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: native } } });
      const row = { id: 'old', targetSessionId: 's1', status: 'active', recurring: true, preRunHook: {
        command: custom ? 'node "/project/scripts/pr-heartbeat-gate.mjs" ' + url :
          oldFollowHook(url).command.replace('pr-heartbeat-gate.mjs"', 'pr-node.cjs" pr-heartbeat-gate.mjs'), timeoutMs: 98765 } };
      const opened = native ? null : await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
      rows.set(row.id, row);
      const result = native ? await rt.tool({ repo: 'octo/repo', pr: 42, published: true }) : await rt.tool({ card_id: opened.callId });
      const cardId = result.reply.result.card_id;
      assert.equal(result.reply.result.follow_state, custom ? 'failed' : 'active');
      assert.equal(JSON.parse(rt.files.get(`pr-cards/${cardId}.json`)).scheduleId || null, custom ? null : row.id);
      assert.deepEqual(rows.get(row.id), row);
      assert.equal(calls.some(c => ['schedule_update', 'schedule_create', 'schedule_delete'].includes(c)), false);
    }
  }
});

test('first GitHub read failure on an ID-less card retains the claim without opening Stop or a new claim', async () => {
  const { hostApi, calls, rows } = followScheduler();
  const rt = createPrRuntime({ github: prGraphql(), hostApi });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
  rows.set('old', { id: 'old', targetSessionId: 's1', status: 'active', recurring: true, preRunHook: oldFollowHook('https://github.com/octo/repo/pull/42') });
  rt.setGithub(() => jsonResponse({ message: 'GitHub unavailable' }, 503));
  const failed = await rt.tool({ card_id: opened.callId, claim_follow: true });
  assert.equal(failed.reply.result.follow_state, 'unverified');
  assert.equal(failed.reply.result.follow_claimed, false);
  await rt.click(opened.callId, 'pr:stop');
  await rt.click(opened.callId, 'pr:follow');
  assert.equal(rt.agentRuns.length, 0);
  assert.deepEqual(calls, []);
  rt.setGithub(prGraphql());
  assert.equal((await rt.tool({ card_id: opened.callId })).reply.result.legacy_hook_repair.schedule_id, 'old');
});

test('adopted legacy Stop never invokes a delete even if a prior read was valid', async () => {
  for (const change of ['hook','owner']) {
    const { hostApi, calls, rows } = followScheduler();
    const rt = createPrRuntime({ github: prGraphql(), hostApi });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
    const row = { id: 'old', targetSessionId: 's1', status: 'active', recurring: true, preRunHook: oldFollowHook('https://github.com/octo/repo/pull/42') };
    rows.set(row.id,row);
    await rt.tool({ card_id: opened.callId });
    const changed = change === 'hook' ? { ...row, preRunHook: {command:'node "/project/scripts/pr-heartbeat-gate.mjs" https://github.com/octo/repo/pull/42',timeoutMs: 12} } : {...row,targetSessionId:'s2'};
    rows.set(row.id,changed);
    await rt.click(opened.callId, 'pr:stop');
    assert.deepEqual(rows.get(row.id), changed);
    assert.equal(calls.includes('schedule_delete'), false);
    assert.equal(rt.agentRuns.length, 0);
  }
});

test('direct Stop on an upgraded unrefreshed old card verifies instead of handing deletion to the agent', async () => {
  for (const fault of [false, true]) {
    const { hostApi, calls, rows } = followScheduler({ failDir: fault });
    const rt = createPrRuntime({ github: prGraphql(), hostApi });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
    const row = { id: 'old', targetSessionId: 's1', status: 'active', recurring: true, preRunHook: oldFollowHook('https://github.com/octo/repo/pull/42') };
    rows.set(row.id, row);
    await rt.click(opened.callId, 'pr:stop');
    const card = JSON.parse(rt.files.get(`pr-cards/${opened.callId}.json`));
    assert.equal(card.scheduleId, fault ? null : row.id);
    assert.equal(calls.includes('schedule_delete'), false);
    assert.equal(rt.agentRuns.length, 0);
    assert.deepEqual(rows.get(row.id), row);
    assert.doesNotMatch(rt.lastCard(opened.callId).html, /<button data-ghost-action="pr:stop"/);
  }
});

test('an ID-less old card retries ordinary refresh after a temporarily unavailable Skill directory', async () => {
  const fault = { failDir: true };
  const { hostApi, calls, rows } = followScheduler(fault);
  const rt = createPrRuntime({ github: prGraphql(), hostApi });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
  const old = { id: 'old', targetSessionId: 's1', status: 'active', recurring: true,
    preRunHook: oldFollowHook('https://github.com/octo/repo/pull/42') };
  rows.set(old.id, old);
  const failed = await rt.tool({ card_id: opened.callId });
  assert.equal(failed.reply.result.follow_state, 'unverified');
  assert.doesNotMatch(rt.lastCard(opened.callId).html, /<button data-ghost-action="pr:(stop|follow)"/);
  assert.equal((await rt.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 's2' } })).reply.result.disposition, 'existing_task');
  assert.equal((await rt.tool({ card_id: opened.callId, claim_follow: true })).reply.result.follow_claimed, false);
  await rt.click(opened.callId, 'pr:stop');
  await rt.click(opened.callId, 'pr:follow');
  assert.equal(rt.agentRuns.length, 0);
  assert.equal(calls.some(c => ['schedule_create', 'schedule_delete', 'schedule_update'].includes(c)), false);
  fault.failDir = false;
  const recovered = await rt.tool({ card_id: opened.callId });
  assert.equal(recovered.reply.result.legacy_hook_repair.schedule_id, old.id);
  assert.equal(JSON.parse(rt.files.get(`pr-cards/${opened.callId}.json`)).scheduleId, old.id);
  assert.deepEqual(rows.get(old.id), old);
});

test('temporary old-card list/get failures preserve the same reservation; stopped or terminal cards never resume it', async () => {
  for (const faultKey of ['failList', 'failGet']) {
    for (const end of ['recover', 'stop', 'closed']) {
      const fault = { [faultKey]: true };
      const { hostApi, calls, rows } = followScheduler(fault);
      const rt = createPrRuntime({ github: prGraphql({ draft: true }), hostApi });
      const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
      rows.set('old', { id: 'old', targetSessionId: 's1', status: 'active', recurring: true, preRunHook: oldFollowHook('https://github.com/octo/repo/pull/42') });
      assert.equal((await rt.tool({ card_id: opened.callId })).reply.result.follow_state, 'unverified');
      assert.equal((await rt.tool({ card_id: opened.callId, following: true, claim_follow: true })).reply.result.follow_claimed, false);
      if (end === 'stop') { fault[faultKey] = false; rows.delete('old'); await rt.tool({ card_id: opened.callId, following: false }); }
      if (end === 'closed') {
        rt.setGithub(prGraphql({ state: 'CLOSED' }));
        assert.equal((await rt.tool({ card_id: opened.callId })).reply.result.follow_state, 'unverified');
        fault[faultKey] = false;
        assert.equal((await rt.tool({ card_id: opened.callId })).reply.result.follow_state, 'active');
        assert.equal(rows.get('old').status, 'active');
        rows.delete('old');
        assert.equal((await rt.tool({ card_id: opened.callId, following: false })).reply.result.follow_state, 'stopped');
        rt.setGithub(prGraphql());
      }
      fault[faultKey] = false;
      const count = calls.length;
      const result = await rt.tool({ card_id: opened.callId });
      if (end === 'recover') assert.equal(result.reply.result.legacy_hook_repair.schedule_id, 'old');
      else {
        assert.equal(result.reply.result.follow_state, 'stopped');
        assert.equal(calls.length, count);
      }
      assert.equal(calls.some(c => ['schedule_create', 'schedule_delete', 'schedule_update'].includes(c)), false);
    }
  }
});

test('existing authorized draft follow-ups are verified read-only, without starting ordinary draft cards', async () => {
  for (const bound of [false, true]) {
    const { hostApi, calls, rows } = followScheduler();
    const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: bound } } });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, ...(bound ? { published: true } : { following: true }) });
    const id = bound ? 'sch-1' : 'old';
    rows.set(id, { id, targetSessionId: 's1', status: 'active', recurring: true,
      preRunHook: oldFollowHook('https://github.com/octo/repo/pull/42') });
    rt.setGithub(prGraphql({ draft: true }));
    const refreshed = await rt.tool({ card_id: opened.callId });
    assert.equal(refreshed.reply.result.stage, 'draft');
    assert.equal(refreshed.reply.result.legacy_hook_repair.schedule_id, id);
    rows.get(id).status = 'paused';
    assert.equal((await rt.tool({ card_id: opened.callId })).reply.result.follow_state, 'paused');
    assert.equal(calls.filter(c => c === 'schedule_create').length, bound ? 1 : 0);
  }
  const { hostApi, calls } = followScheduler();
  const rt = createPrRuntime({ github: prGraphql({ draft: true }), hostApi, kv: { prCard: { autoFollow: true } } });
  await rt.tool({ repo: 'octo/repo', pr: 42 });
  assert.deepEqual(calls, []);
});

test('pre-native discovery never creates a schedule or changes an ambiguous, paused, foreign or custom hook', async () => {
  const url = 'https://github.com/octo/repo/pull/42';
  const old = { id: 'old', targetSessionId: 's1', status: 'active', recurring: true,
    preRunHook: oldFollowHook(url) };
  for (const [label, candidates, refresh] of [
    ['absent', [], {}],
    ['ambiguous', [old, { ...old, id: 'other' }], {}],
    ['paused', [{ ...old, status: 'paused' }], {}],
    ['foreign', [{ ...old, targetSessionId: 's2' }], {}],
    ['custom', [{ ...old, preRunHook: { ...old.preRunHook, command: 'node "/project/scripts/pr-heartbeat-gate.mjs" ' + url } }], {}],
    ['stopping', [old], { following: false }],
  ]) {
    const { hostApi, calls, rows } = followScheduler();
    const rt = createPrRuntime({ github: prGraphql(), hostApi });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
    for (const row of candidates) rows.set(row.id, row);
    const result = await rt.tool({ card_id: opened.callId, ...refresh });
    assert.equal(result.reply.ok, true, label);
    if (label !== 'stopping') assert.equal(result.reply.result.legacy_hook_repair, undefined, label);
    const card = JSON.parse(rt.files.get(`pr-cards/${opened.callId}.json`));
    assert.equal(card.following, label === 'stopping', label);
    assert.equal(card.scheduleId || null, ['paused','stopping'].includes(label) ? old.id : null, label);
    if (label !== 'stopping') assert.equal(result.reply.result.follow_state, label === 'paused' ? 'paused' : label === 'absent' ? 'stopped' : 'failed', label);
    assert.deepEqual([...rows.values()], candidates, label);
    assert.equal(calls.some(c => ['schedule_create', 'schedule_update', 'schedule_delete'].includes(c)), false, label);
  }
});

test('viewing an existing red PR does not start following; explicitly clicking hands its current failures to the owner', async () => {
  const { hostApi, rows } = followScheduler();
  const runtime = createPrRuntime({ github: prGraphql({ ci: 'FAILURE' }), hostApi, kv: { prCard: { autoFollow: true } } });
  const viewed = await runtime.tool({ repo: 'octo/repo', pr: 42 });
  assert.equal(rows.size, 0);
  assert.equal(runtime.agentRuns.length, 0);
  await runtime.click(viewed.callId, 'pr:follow');
  assert.equal(runtime.agentRuns.length, 1);
  assert.match(runtime.agentRuns[0].userMessage, /已有失败也必须接手.*首次检查.*归属任务处理并汇报/);
  const other = await runtime.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 's2' } });
  assert.equal(other.reply.result.disposition, 'existing_task');
});

test('publication without an ask card is distinct from viewing a PR or declining follow-up', async () => {
  for (const [args, enabled, expected] of [
    [{}, true, 0], [{ published: true }, false, 0], [{ published: true, following: false }, true, 0],
    [{ published: true }, true, 1],
  ]) {
    const { hostApi, rows } = followScheduler();
    const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: enabled } } });
    await rt.tool({ repo: 'octo/repo', pr: 42, ...args });
    assert.equal(rows.size, expected);
  }
});

test('rejected creation stays stopped and can be retried from the card', async () => {
  const fault = { reject: true };
  const { hostApi, rows } = followScheduler(fault);
  const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
  assert.equal(opened.reply.result.follow_state, 'failed');
  assert.match(opened.reply.result.note, /scheduler unavailable/);
  fault.reject = false;
  await rt.click(opened.callId, 'pr:follow');
  assert.equal(rows.size, 1);
  assert.equal(rt.agentRuns.length, 0);
});

test('restart after an unreadable receipt reconciles the existing schedule', async () => {
  const fault = { failGet: true };
  const { hostApi, calls } = followScheduler(fault);
  const kv = { prCard: { autoFollow: true } };
  const rt = createPrRuntime({ github: prGraphql(), hostApi, kv });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
  assert.equal(opened.reply.result.follow_state, 'unverified');
  fault.failGet = false;
  const restarted = createPrRuntime({ github: prGraphql(), hostApi, kv, files: rt.files });
  const result = await restarted.tool({ card_id: opened.callId });
  assert.equal(result.reply.result.follow_state, 'active');
  assert.equal(calls.filter(c => c === 'schedule_create').length, 1);
});

test('a foreign schedule blocks creation while a similarly numbered PR does not', async () => {
  for (const number of [42, 420]) {
    const { hostApi, rows, calls } = followScheduler();
    const url = 'https://github.com/octo/repo/pull/' + number;
    rows.set('foreign', { id: 'foreign', prompt: 'Follow ' + url, targetSessionId: 'other', status: 'active' });
    const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
    assert.equal(opened.reply.result.follow_state, number === 42 ? 'failed' : 'active');
    assert.equal(calls.includes('schedule_create'), number !== 42);
    assert.equal(rows.get('foreign').targetSessionId, 'other');
  }
});

test('an externally stopped follow-up stays stopped after refresh', async () => {
  const { hostApi, rows, calls } = followScheduler();
  const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
  rows.clear();
  const refreshed = await rt.tool({ card_id: opened.callId });
  assert.equal(refreshed.reply.result.follow_state, 'stopped');
  assert.equal(calls.filter(c => c === 'schedule_create').length, 1);
});

test('a persisted pre-upgrade Stop settles from a bound read without deleting the schedule', async () => {
  for (const status of ['active', 'paused', 'absent']) {
    const fault = {};
    const { hostApi, rows, calls } = followScheduler(fault);
    const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
    const key = `pr-cards/${opened.callId}.json`;
    const old = JSON.parse(rt.files.get(key));
    delete old.manualStop;
    old.pending = old.scheduleAction = 'stop';
    rt.files.set(key, JSON.stringify(old));
    if (status === 'absent') rows.clear();
    else rows.get('sch-1').status = status;
    fault.failGet = true;
    await rt.tool({ card_id: opened.callId });
    assert.equal(JSON.parse(rt.files.get(key)).scheduleAction, 'stop');
    fault.failGet = false;
    const refreshed = await rt.tool({ card_id: opened.callId });
    assert.equal(refreshed.reply.result.follow_state, status === 'absent' ? 'stopped' : status);
    assert.equal(JSON.parse(rt.files.get(key)).pending, null);
    assert.equal(JSON.parse(rt.files.get(key)).scheduleAction, null);
    assert.doesNotMatch(rt.lastCard(opened.callId).html, /正在停止/);
    if (status !== 'absent') {
      assert.equal(rows.get('sch-1').status, status);
      assert.match(rt.lastCard(opened.callId).html, /sch-1/);
      rows.clear();
      assert.equal((await rt.tool({ card_id: opened.callId })).reply.result.follow_state, 'stopped');
    }
    assert.equal(calls.includes('schedule_delete'), false);
  }
});

test('an ID-less pre-upgrade Stop is reconciled by ordinary refresh without touching the scheduler', async () => {
  const url = 'https://github.com/octo/repo/pull/42';
  for (const status of ['active', 'paused', 'absent', 'legacy-active']) {
    // Exercise the old-host button handoff to persist the actual old format.
    const old = createPrRuntime({ github: prGraphql() });
    const opened = await old.tool({ repo: 'octo/repo', pr: 42, following: true });
    await old.click(opened.callId, 'pr:stop');
    const key = `pr-cards/${opened.callId}.json`;
    const saved = JSON.parse(old.files.get(key));
    assert.equal(saved.pending, 'stop');
    assert.equal(saved.scheduleId || null, null);
    assert.equal(saved.scheduleAction || null, null);
    assert.equal(old.agentRuns.length, 1);

    const fault = { failList: true };
    const { hostApi, rows, calls } = followScheduler(fault);
    const hook = oldFollowHook(url, 123456);
    if (status !== 'legacy-active') hook.command = hook.command.replace('pr-heartbeat-gate.mjs"', 'pr-node.cjs" pr-heartbeat-gate.mjs');
    const row = { id: 'old', status: status === 'paused' ? 'paused' : 'active', targetSessionId: 's1',
      recurring: true, intervalMs: 600000, preRunHook: hook, runHistory: [{ id: 'previous-run', status: 'success' }] };
    if (status !== 'absent') rows.set(row.id, structuredClone(row));
    const before = structuredClone([...rows.values()]);
    const rt = createPrRuntime({ github: prGraphql(), hostApi, files: old.files, kv: { prCard: { autoFollow: true } } });
    const unreadable = await rt.tool({ card_id: opened.callId });
    assert.equal(unreadable.reply.result.follow_state, 'unverified', status);
    assert.equal((await rt.tool({ card_id: opened.callId, claim_follow: true })).reply.result.follow_claimed, false, status);
    fault.failList = false;
    const result = await rt.tool({ card_id: opened.callId });
    assert.equal(result.reply.result.follow_state, status === 'legacy-active' ? 'unverified' : status === 'absent' ? 'stopped' : status, status);
    const refreshed = JSON.parse(rt.files.get(key));
    assert.equal(refreshed.pending, null, status);
    assert.equal(refreshed.scheduleId || null, status === 'absent' ? null : 'old', status);
    assert.doesNotMatch(rt.lastCard(opened.callId).html, /正在停止/, status);
    if (status === 'absent') {
      assert.match(rt.lastCard(opened.callId).html, /data-ghost-action="pr:follow"/);
    } else {
      assert.match(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止（ID：old）/);
      assert.doesNotMatch(rt.lastCard(opened.callId).html, /<button data-ghost-action="pr:stop"/);
      if (status === 'legacy-active') assert.equal(result.reply.result.legacy_hook_repair.schedule_id, 'old');
    }
    assert.deepEqual([...rows.values()], before, status);
    assert.equal(calls.every(c => ['schedule_list', 'schedule_get', 'schedule_list_runs'].includes(c)), true, status);
    assert.equal(rt.agentRuns.length, 0, status);
  }
});

test('terminal PR shows the actual final schedule state, not an ended label while still present', async () => {
  for (const status of ['active', 'paused']) {
    const { hostApi, rows, calls } = followScheduler();
    const rt = createPrRuntime({ github: prGraphql(), hostApi });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
    rows.set('old', { id: 'old', targetSessionId: 's1', status, recurring: true,
      preRunHook: oldFollowHook('https://github.com/octo/repo/pull/42') });
    rt.setGithub(prGraphql({ state: 'CLOSED' }));
    assert.equal((await rt.tool({ card_id: opened.callId })).reply.result.follow_state, status);
    assert.match(rt.lastCard(opened.callId).html, status === 'active' ? /跟进中/ : /跟进已暂停/);
    assert.doesNotMatch(rt.lastCard(opened.callId).html, /跟进已结束/);
    rows.delete('old');
    assert.equal((await rt.tool({ card_id: opened.callId })).reply.result.follow_state, 'stopped');
    assert.match(rt.lastCard(opened.callId).html, /跟进已结束/);
    assert.equal(calls.includes('schedule_delete'), false);
  }
});

test('paused follow-up refreshes, retains its reservation and shows terminal PR status', async () => {
  const { hostApi, rows, calls } = followScheduler();
  const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
  rows.get('sch-1').status = 'paused';
  const paused = await rt.tool({ card_id: opened.callId, claim_follow: true });
  assert.equal(paused.reply.result.follow_state, 'paused');
  assert.equal(paused.reply.result.follow_claimed, false);
  assert.match(rt.lastCard(opened.callId).html, /跟进已暂停/);
  const peer = await rt.tool({ repo: 'octo/repo', pr: 42, claim_follow: true, session_context: { session_id: 's2' } });
  assert.equal(peer.reply.result.disposition, 'existing_task');
  assert.equal(calls.filter(c => c === 'schedule_create').length, 1);
  rt.setGithub(prGraphql({ merged: true }));
  const merged = await rt.tool({ card_id: opened.callId });
  assert.equal(merged.reply.result.stage, 'merged');
});

function statusWatchFixture(initial = {}, options = {}) {
  let failRead = options.failBoot;
  let accountStatus = null;
  let accountStatusFrom = 1;
  let accountLimited = null;
  let accountSwitchAt = null;
  let accountSwitchTo = null;
  let userHoldAt = null;
  let userHoldGate = null;
  let userCalls = 0;
  let limitedPath = null;
  let deniedPath = null;
  let missingPath = null;
  let holdKey = null;
  let holdGate = null;
  let kvGate = null;
  let heldKvGate = null;
  let putGate = null;
  let heldPutGate = null;
  let kv = structuredClone(initial);
  let account = 17;
  let rateLimited = false;
  const timers = [];
  const paths = [];
  const response = {
    '/pulls/1': { id: 21, number: 1, state: 'open', comments: 0, body: 'untrusted text' },
    '/issues/2': { id: 22, number: 2, state: 'open', comments: 1 },
    '/actions/runs/3': { id: 3, status: 'queued', run_attempt: 1 },
  };
  const runtime = createRuntime({
    setTimeout(fn, delay) {
      if (delay >= 60_000) timers.push({ fn, delay });
      return timers.length;
    },
    async localFetch(url, init) {
      assert.equal(url, '/kv');
      if (init?.method === 'PUT') {
        if (putGate) { heldPutGate = putGate; putGate = null; await heldPutGate.promise; }
        kv = JSON.parse(init.body);
      } else if (failRead) {
        failRead = false;
        throw new Error('temporary storage failure');
      } else if (kvGate) {
        heldKvGate = kvGate; kvGate = null;
        await heldKvGate.promise;
        return { ok: true, json: async () => structuredClone(heldKvGate.snapshot) };
      }
      return { ok: true, json: async () => structuredClone(kv) };
    },
    send: options.send,
    async github(request) {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://api.github.com');
      assert.equal(request.method, 'GET');
      paths.push(url.pathname);
      if (url.pathname === '/user') {
        userCalls++;
        if (userHoldGate && userCalls === userHoldAt) await userHoldGate.promise;
        if (accountStatus && userCalls >= accountStatusFrom) return jsonResponse({ message: 'credentials rejected' }, accountStatus);
        if (accountLimited !== null && userCalls >= accountLimited) return jsonResponse({ message: 'API rate limit exceeded' }, 403);
        if (accountSwitchAt !== null && userCalls >= accountSwitchAt) return jsonResponse({ id: accountSwitchTo });
        return jsonResponse({ id: account });
      }
      const key = url.pathname.replace('/repos/example/widget', '');
      if (key === holdKey) await holdGate.promise;
      if (rateLimited || key === limitedPath) return jsonResponse({ message: 'API rate limit exceeded' }, 403);
      if (key === deniedPath) return jsonResponse({ message: 'Resource not accessible by integration' }, 403);
      if (key === missingPath) return jsonResponse({ message: 'Not Found' }, 404);
      const object = response[key];
      return object ? jsonResponse(object) : jsonResponse({ message: 'forbidden' }, 403);
    },
  });
  const tool = (action, kind, id) => runtime.tool('status_watch', { action, kind, id, repo: 'Example/Widget' });
  const makeGate = (snapshot) => {
    let release;
    const gate = { promise: new Promise(resolve => { release = resolve; }), release };
    if (snapshot !== undefined) gate.snapshot = snapshot;
    return gate;
  };
  return { ...runtime, tool, timers, paths, response, saved: () => kv,
    useAccount: id => { account = id; },
    failAccount: (value = 401, from = 1) => { accountStatus = value === false ? null : value; accountStatusFrom = from; },
    switchAccountAt: (n, id) => { accountSwitchAt = n; accountSwitchTo = id; },
    holdUserAt: n => { userHoldAt = n; userHoldGate = makeGate(); },
    releaseUser: () => { assert.ok(userHoldGate, 'no held user read'); const gate = userHoldGate; userHoldAt = null; userHoldGate = null; gate.release(); },
    limitPath: p => { limitedPath = p; }, denyPath: p => { deniedPath = p; },
    missingPath: p => { missingPath = p; },
    limitAccountFrom: n => { accountLimited = n; }, limitRequests: () => { rateLimited = true; },
    holdPath: p => { holdKey = p; holdGate = makeGate(); },
    releasePath: () => { const gate = holdGate; holdKey = null; holdGate = null; gate.release(); },
    holdKv: () => { kvGate = makeGate(structuredClone(kv)); },
    releaseKv: () => { assert.ok(heldKvGate, 'no held KV read'); heldKvGate.release(); },
    holdPut: () => { putGate = makeGate(); },
    releasePut: () => { assert.ok(heldPutGate, 'no held KV write'); heldPutGate.release(); } };
}

test('status watches are opt-in, track three exact states and write before notifying', async () => {
  const f = statusWatchFixture({ prCard: { autoFollow: true } });
  await flushAsync();
  assert.deepEqual(f.paths, []);
  assert.equal(f.timers.length, 0);
  for (const [kind, id] of [['pr', 1], ['issue', 2], ['run', 3]]) {
    assert.equal((await f.tool('add', kind, id)).ok, true);
  }
  assert.equal(f.timers.length, 1);
  assert.equal(f.timers[0].delay, 300_000);
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 0);
  assert.equal(f.saved().prCard.autoFollow, true);
  assert.doesNotMatch(JSON.stringify(f.saved()), /untrusted text/);
  f.response['/pulls/1'].merged = true;
  f.response['/pulls/1'].state = 'closed';
  f.response['/issues/2'].comments++;
  Object.assign(f.response['/actions/runs/3'], { status: 'completed', conclusion: 'success' });
  await f.timers.shift().fn();
  assert.deepEqual(f.saved().githubStatusWatches.map(x => x.snapshot),
    ['merged:ready:0', 'open:ready:2', 'completed:success:1']);
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 1);
  await f.timers.shift().fn();
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 1);
  for (const [kind, id] of [['pr', 1], ['issue', 2], ['run', 3]]) {
    assert.equal((await f.tool('remove', kind, id)).ok, true);
  }
  const before = f.paths.length;
  await f.timers.shift().fn();
  assert.equal(f.paths.length, before);
  assert.equal(f.timers.length, 0);
});

test('status watches resume locally, skip changed GitHub accounts, report permission failures and back off', async () => {
  const a = statusWatchFixture();
  assert.equal((await a.tool('add', 'issue', 2)).ok, true);
  assert.equal((await a.tool('add', 'run', 99)).ok, false);
  assert.equal(a.saved().githubStatusWatches.length, 1);
  const f = statusWatchFixture(a.saved());
  await flushAsync();
  assert.equal(f.timers.length, 1);
  f.useAccount(88);
  await f.timers.shift().fn();
  assert.deepEqual(f.paths, ['/user', '/user']);
  assert.equal(f.saved().githubStatusWatches[0].problem, 'account_changed');
  assert.equal((await f.tool('list', 'issue', 2)).result.watches[0].problem, 'account_changed');
  assert.equal(f.timers[0].delay, 300_000);
  await f.timers.shift().fn();
  assert.deepEqual(f.paths, ['/user', '/user', '/user']);
  assert.equal(f.saved().githubStatusWatches[0].problem, 'account_changed');
  f.useAccount(17);
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, undefined);
  delete f.response['/issues/2'];
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, 'forbidden');
  assert.equal(f.saved().githubStatusWatches[0].snapshot, 'open:ready:1');
  f.limitRequests();
  await f.timers.shift().fn();
  assert.equal(f.timers[0].delay, 900_000);
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 0);
});

test('an account probe failure marks healthy watches unavailable until reads recover', async () => {
  const a = statusWatchFixture();
  assert.equal((await a.tool('add', 'issue', 2)).ok, true);
  const f = statusWatchFixture(a.saved());
  await flushAsync();
  assert.equal(f.timers.length, 1);
  f.failAccount(503);
  await f.timers.shift().fn();
  assert.deepEqual(f.paths, ['/user']);
  assert.equal(f.saved().githubStatusWatches[0].problem, 'unavailable');
  assert.equal(f.timers[0].delay, 900_000);
  assert.equal((await f.tool('list', 'issue', 2)).result.watches[0].problem, 'unavailable');
  f.failAccount(false);
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, undefined);
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 0);
});

test('a rate-limited round persists changes already read before backing off', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  assert.equal((await f.tool('add', 'pr', 1)).ok, true);
  f.response['/issues/2'].comments = 5;
  f.limitPath('/pulls/1');
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].snapshot, 'open:ready:5');
  assert.equal(f.saved().githubStatusWatches[0].noticePending, undefined);
  assert.equal(f.saved().githubStatusWatches[1].problem, 'unavailable');
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 1);
  assert.equal(f.timers[0].delay, 900_000);
});

test('a successful add supersedes a later backoff timer', async () => {
  const a = statusWatchFixture();
  assert.equal((await a.tool('add', 'issue', 2)).ok, true);
  const f = statusWatchFixture(a.saved(), { failBoot: true });
  await flushAsync();
  assert.equal(f.timers.length, 1);
  assert.equal(f.timers[0].delay, 900_000);
  assert.equal((await f.tool('add', 'pr', 1)).ok, true);
  assert.equal(f.timers.length, 2);
  const stale = f.timers.shift();
  assert.equal(stale.delay, 900_000);
  const before = f.paths.length;
  await stale.fn();
  assert.equal(f.paths.length, before);
  assert.equal(f.timers[0].delay, 300_000);
  const beforePoll = f.paths.length;
  await f.timers.shift().fn();
  assert.equal(f.paths.length, beforePoll + 3);
});

test('a rate-limited confirmation probe persists changes and backs off', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  f.response['/issues/2'].comments = 5;
  f.limitAccountFrom(4);
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].snapshot, 'open:ready:5');
  assert.equal(f.saved().githubStatusWatches[0].noticePending, undefined);
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 1);
  assert.equal(f.timers[0].delay, 900_000);
});

test('an add during an in-flight round keeps the five-minute deadline', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  f.holdPath('/issues/2');
  f.limitPath('/issues/2');
  const poll = f.timers.shift().fn();
  await flushAsync();
  assert.equal((await f.tool('add', 'pr', 1)).ok, true);
  assert.equal(f.timers.length, 0);
  await new Promise(resolve => setTimeout(resolve, 50));
  f.releasePath();
  await poll;
  assert.equal(f.timers.length, 1);
  // The armed delay is the remaining time to the add's absolute deadline.
  assert.ok(f.timers[0].delay < 300_000 && f.timers[0].delay > 290_000, `delay ${f.timers[0].delay}`);
});

test('an unauthorized account probe surfaces an actionable problem', async () => {
  const a = statusWatchFixture();
  assert.equal((await a.tool('add', 'issue', 2)).ok, true);
  const f = statusWatchFixture(a.saved());
  await flushAsync();
  assert.equal(f.timers.length, 1);
  f.failAccount(401);
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, 'auth_required');
  assert.equal((await f.tool('list', 'issue', 2)).result.watches[0].problem, 'auth_required');
  f.failAccount(false);
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, undefined);
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 0);
});

test('read failures map to the documented problem classes and clear on recovery', async () => {
  const cases = [[401, 'auth_required'], [403, 'forbidden'], [404, 'gone'], [410, 'gone'],
    [429, 'unavailable'], [503, 'unavailable']];
  for (const [status, expected] of cases) {
    const a = statusWatchFixture();
    assert.equal((await a.tool('add', 'issue', 2)).ok, true);
    const f = statusWatchFixture(a.saved());
    await flushAsync();
    f.failAccount(status);
    await f.timers.shift().fn();
    assert.equal(f.saved().githubStatusWatches[0].problem, expected, `probe ${status}`);
    f.failAccount(false);
    await f.timers.shift().fn();
    assert.equal(f.saved().githubStatusWatches[0].problem, undefined, `recovery ${status}`);
  }
});

test('targets after a rate-limit break cannot claim healthy polling', async () => {
  const f = statusWatchFixture({ githubStatusWatches: [
    { kind: 'pr', repo: 'example/widget', id: 1, account: 17, objectId: 21, snapshot: 'open:ready:0' },
    { kind: 'issue', repo: 'example/widget', id: 2, account: 17, objectId: 22, snapshot: 'open:ready:1' },
    { kind: 'run', repo: 'example/widget', id: 3, account: 17, objectId: 3, snapshot: 'queued:none:1', problem: 'gone' },
  ] });
  await flushAsync();
  f.limitPath('/pulls/1');
  await f.timers.shift().fn();
  const [pr, issue, run] = f.saved().githubStatusWatches;
  assert.equal(pr.problem, 'unavailable');
  assert.equal(issue.problem, 'unavailable');
  assert.equal(run.problem, 'gone');
  assert.equal(f.timers[0].delay, 900_000);
});

test('a concurrent modification does not discard an observed change', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  assert.equal((await f.tool('add', 'pr', 1)).ok, true);
  f.response['/issues/2'].comments = 5;
  f.holdUserAt(6);
  const round = f.timers.shift().fn();
  await flushAsync();
  assert.equal((await f.tool('remove', 'run', 99)).ok, true);
  f.releaseUser();
  await round;
  assert.equal(f.saved().githubStatusWatches.find(w => w.kind === 'issue').snapshot, 'open:ready:5');
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 1);
});

test('a concurrent modification during the reads does not abort the round', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  assert.equal((await f.tool('add', 'pr', 1)).ok, true);
  f.response['/issues/2'].comments = 5;
  f.holdPath('/issues/2');
  const round = f.timers.shift().fn();
  await flushAsync();
  assert.equal((await f.tool('remove', 'run', 99)).ok, true);
  f.releasePath();
  await round;
  assert.equal(f.saved().githubStatusWatches.find(w => w.kind === 'issue').snapshot, 'open:ready:5');
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 1);
});

test('a watch re-added during a round keeps its fresh baseline', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  f.response['/issues/2'].comments = 5;
  f.holdUserAt(4);
  const round = f.timers.shift().fn();
  await flushAsync();
  f.response['/issues/2'].comments = 7;
  assert.equal((await f.tool('remove', 'issue', 2)).ok, true);
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  f.releaseUser();
  await round;
  const row = f.saved().githubStatusWatches[0];
  assert.equal(row.snapshot, 'open:ready:7');
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 0);
});

test('a watch re-added during a failed probe is not marked stale', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  f.holdUserAt(3);
  const round = f.timers.shift().fn();
  await flushAsync();
  assert.equal((await f.tool('remove', 'issue', 2)).ok, true);
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  f.failAccount(503);
  f.releaseUser();
  await round;
  const row = f.saved().githubStatusWatches[0];
  assert.equal(row.problem, undefined);
  assert.equal(row.snapshot, 'open:ready:1');
});

test('a later remove wins over an add still reading its baseline', async () => {
  const f = statusWatchFixture();
  f.holdPath('/issues/2');
  const adding = f.tool('add', 'issue', 2);
  await flushAsync();
  const removing = f.tool('remove', 'issue', 2);
  await flushAsync();
  f.releasePath();
  assert.equal((await removing).ok, true);
  assert.equal((await adding).ok, true);
  assert.equal(f.saved().githubStatusWatches.length, 0);
});

test('an account switch at the final check persists account_changed', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  f.response['/issues/2'].comments = 5;
  f.switchAccountAt(4, 88);
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, 'account_changed');
  assert.equal(f.saved().githubStatusWatches[0].snapshot, 'open:ready:1');
  assert.equal(f.timers[0].delay, 900_000);
});

test('a failed final account check persists the failure class', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  f.response['/issues/2'].comments = 5;
  f.failAccount(401, 4);
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].snapshot, 'open:ready:5');
  assert.equal(f.saved().githubStatusWatches[0].problem, 'auth_required');
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 1);
  assert.equal(f.timers[0].delay, 900_000);
});

test('a newer failure class replaces an older one on the same watch', async () => {
  const a = statusWatchFixture();
  assert.equal((await a.tool('add', 'issue', 2)).ok, true);
  const f = statusWatchFixture(a.saved());
  await flushAsync();
  f.missingPath('/issues/2');
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, 'gone');
  f.missingPath(null);
  f.failAccount(401);
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, 'auth_required');
  f.failAccount(false);
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, undefined);
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 0);
});

test('a deleted or inaccessible target is reported as gone', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  f.missingPath('/issues/2');
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, 'gone');
  assert.equal((await f.tool('list', 'issue', 2)).result.watches[0].problem, 'gone');
  f.missingPath(null);
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, undefined);
});

test('a permission failure on a watched target is reported as forbidden', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  f.denyPath('/issues/2');
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, 'forbidden');
  assert.equal((await f.tool('list', 'issue', 2)).result.watches[0].problem, 'forbidden');
  f.denyPath(null);
  await f.timers.shift().fn();
  assert.equal(f.saved().githubStatusWatches[0].problem, undefined);
});

test('an add racing an empty round still schedules its check', async () => {
  const f = statusWatchFixture();
  assert.equal((await f.tool('add', 'issue', 2)).ok, true);
  assert.equal((await f.tool('remove', 'issue', 2)).ok, true);
  assert.equal(f.timers.length, 1);
  f.holdKv();
  const round = f.timers.shift().fn();
  await flushAsync();
  f.holdPut();
  const adding = f.tool('add', 'pr', 1);
  await flushAsync();
  assert.equal(f.timers.length, 0);
  // Step the empty read to its decision so the round still returns "no watches",
  // then release the add so its deadline is recorded before the round's finally.
  f.releaseKv();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  f.releasePut();
  await adding;
  await round;
  assert.equal(f.timers.length, 1);
  // The empty round must not drop the add's request; the delay is bounded by its deadline.
  assert.ok(f.timers[0].delay <= 300_000 && f.timers[0].delay > 0, `delay ${f.timers[0].delay}`);
});

test('status watches cap stored targets and reject a replaced object without advancing its state', async () => {
  const f = statusWatchFixture();
  for (let id = 10; id < 16; id++) {
    f.response['/issues/' + id] = { id: 100 + id, number: id, state: 'open', comments: 0 };
    assert.equal((await f.tool('add', 'issue', id)).ok, id < 15);
  }
  assert.equal(f.saved().githubStatusWatches.length, 5);
  f.response['/issues/10'] = { id: 200, number: 10, state: 'closed', comments: 1 };
  const before = f.paths.length;
  await f.timers.shift().fn();
  assert.ok(f.paths.length - before <= 7);
  assert.equal(f.saved().githubStatusWatches[0].snapshot, 'open:ready:0');
  assert.equal(f.saved().githubStatusWatches[0].problem, 'target_changed');
  assert.equal((await f.tool('add', 'issue', 10)).ok, false);
  assert.equal(f.sent.filter(m => m.type === 'notify').length, 0);
});

test('the Cindy Node bootstrap starts the PR follow worker when loading it via require', () => {
  const entry = fileURLToPath(new URL('../cindy-github/node/follow.cjs', import.meta.url));
  const request = { id: 1, method: 'unsupported', jsonrpc: '2.0' };
  const result = spawnSync(process.execPath, ['-e', 'globalThis.__CINDY_NODE__ = {}; require(process.argv[1]);', entry], {
    input: JSON.stringify(request) + '\n',
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    id: 1, jsonrpc: '2.0', error: { code: -32000, message: 'Unsupported method' },
  });
});

function verifiedNodeRun(scheduleId, {
  firedAt = 2000, status = 'skipped', hookStatus = 'skipped', exitCode = 2,
  checkSucceeded = true, stdoutTruncated = false, major = 22, stdout,
} = {}) {
  const defaultStdout = hookStatus === 'passed'
    ? `[pr-heartbeat-gate] PASS octo/repo#42 reason=changed (events=[remarks])\nCINDY_PRECHECK_OK\nCINDY_PR_NODE=${major}\n`
    : `[pr-heartbeat-gate] SKIP octo/repo#42 reason=unchanged (probe matches the last full read)\nCINDY_PRECHECK_OK\nCINDY_PR_NODE=${major}\n`;
  return {
    id: `run-${firedAt}`, scheduleId, firedAt, status,
    preRunHookResult: {
      status: hookStatus, checkSucceeded, exitCode, stdoutTruncated,
      stdout: stdout !== undefined ? stdout : defaultStdout,
      stderr: '',
    },
  };
}

test('legacy hook stays active without repair banner only after an actual post-update Node 18+ scheduler run', async () => {
  const url = 'https://github.com/octo/repo/pull/42';
  // 1. Bound schedule refresh after verified Node 18+ run
  {
    const { hostApi, rows, runs } = followScheduler();
    const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
    rows.set('sch-1', { ...rows.get('sch-1'), preRunHook: oldFollowHook(url), updatedAt: 1000, lastFiredAt: 2000 });
    runs.set('sch-1', [verifiedNodeRun('sch-1', { firedAt: 2000 })]);
    const refreshed = await rt.tool({ card_id: opened.callId });
    assert.equal(refreshed.reply.result.follow_state, 'active');
    assert.equal(refreshed.reply.result.legacy_hook_repair, undefined);
    assert.equal(refreshed.reply.result.note, undefined);
    const html = rt.lastCard(opened.callId).html;
    assert.match(html, /data-ghost-live-label="跟进中"/);
    assert.doesNotMatch(html, /跟进待修复|旧版前置检查未自动修改|pr-node\.cjs|已有调度请在自动化设置手动停止/);
  }
  // 2. ID-less legacy discovery after verified Node 18+ run
  {
    const { hostApi, rows, runs } = followScheduler();
    const rt = createPrRuntime({ github: prGraphql(), hostApi });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
    rows.set('old', { id: 'old', targetSessionId: 's1', status: 'active', recurring: true, updatedAt: 1000, lastFiredAt: 2000, preRunHook: oldFollowHook(url) });
    runs.set('old', [verifiedNodeRun('old', { firedAt: 2000, status: 'success', hookStatus: 'passed', exitCode: 0 })]);
    const refreshed = await rt.tool({ card_id: opened.callId });
    assert.equal(refreshed.reply.result.follow_state, 'active');
    assert.equal(refreshed.reply.result.legacy_hook_repair, undefined);
    assert.equal(refreshed.reply.result.note, undefined);
    const html = rt.lastCard(opened.callId).html;
    assert.match(html, /data-ghost-live-label="跟进中"/);
    assert.doesNotMatch(html, /跟进待修复|pr-node\.cjs|已有调度请在自动化设置手动停止/);
  }
  // 3. Native Follow reuse after verified Node 18+ run (including while a new firing is mid-flight)
  {
    const { hostApi, rows, runs } = followScheduler();
    const rt = createPrRuntime({ github: prGraphql(), hostApi });
    const ask = await rt.tool({ repo: 'octo/repo', head: 'topic' });
    await rt.tool({ card_id: ask.callId, pr: 42, published: true });
    rows.set('old', { id: 'old', targetSessionId: 's1', status: 'active', recurring: true, updatedAt: 1000, lastFiredAt: 3000, preRunHook: oldFollowHook(url) });
    runs.set('old', [
      { id: 'run-3000', scheduleId: 'old', firedAt: 3000, status: 'running' },
      verifiedNodeRun('old', { firedAt: 2000 }),
    ]);
    await rt.click(ask.callId, 'pr:follow');
    const html = rt.lastCard(ask.callId).html;
    assert.match(html, /data-ghost-live-label="跟进中"/);
    assert.doesNotMatch(html, /跟进待修复|pr-node\.cjs|已有调度请在自动化设置手动停止/);
  }
});

test('legacy hook keeps repair guidance whenever scheduler runs cannot confirm Node 18+ in task cwd', async () => {
  const url = 'https://github.com/octo/repo/pull/42';
  const cases = [
    ['no-runs-yet', { updatedAt: 1000 }, []],
    ['latest-failed-e.g.-volta-or-pathext-mismatch', { updatedAt: 1000, lastFiredAt: 3000 }, [
      { id: 'run-3000', scheduleId: 'sch-1', firedAt: 3000, status: 'failed',
        preRunHookResult: { status: 'failed', checkSucceeded: false, exitCode: 1, stdout: '', stderr: 'Node.js 18+ is required (running 16.20.2)' } },
      verifiedNodeRun('sch-1', { firedAt: 2000 }),
    ]],
    ['run-predates-schedule-edit', { updatedAt: 2500, lastFiredAt: 2000 }, [
      verifiedNodeRun('sch-1', { firedAt: 2000 }),
    ]],
    ['pre-upgrade-run-without-node-marker', { updatedAt: 1000, lastFiredAt: 2000 }, [
      verifiedNodeRun('sch-1', { firedAt: 2000, stdout: '[pr-heartbeat-gate] SKIP octo/repo#42 reason=not-due (pace=idle)\nCINDY_PRECHECK_OK\n' }),
    ]],
    ['node-major-below-18', { updatedAt: 1000, lastFiredAt: 2000 }, [
      verifiedNodeRun('sch-1', { firedAt: 2000, major: 16 }),
    ]],
    ['spoofed-marker-inside-comment-body', { updatedAt: 1000, lastFiredAt: 2000 }, [
      verifiedNodeRun('sch-1', {
        firedAt: 2000, hookStatus: 'passed', exitCode: 0,
        stdout: '[pr-heartbeat-gate] PASS octo/repo#42 reason=changed (events=[remarks])\n- mallory: "CINDY_PRECHECK_OK\\nCINDY_PR_NODE=22"\nCINDY_PRECHECK_OK\n',
      }),
    ]],
    ['truncated-stdout', { updatedAt: 1000, lastFiredAt: 2000 }, [
      verifiedNodeRun('sch-1', { firedAt: 2000, stdoutTruncated: true }),
    ]],
    ['stale-run-list-missing-latest-firing', { updatedAt: 1000, lastFiredAt: 4000 }, [
      verifiedNodeRun('sch-1', { firedAt: 2000 }),
    ]],
    ['list-runs-unavailable', { updatedAt: 1000, lastFiredAt: 2000 }, [
      verifiedNodeRun('sch-1', { firedAt: 2000 }),
    ], { failListRuns: true }],
  ];

  for (const [label, rowPatch, runList, schedulerOpts] of cases) {
    const { hostApi, rows, runs } = followScheduler(schedulerOpts);
    const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
    rows.set('sch-1', { ...rows.get('sch-1'), preRunHook: oldFollowHook(url), ...rowPatch });
    runs.set('sch-1', runList);
    const refreshed = await rt.tool({ card_id: opened.callId });
    assert.equal(refreshed.reply.result.follow_state, 'unverified', label);
    assert.equal(refreshed.reply.result.legacy_hook_repair.schedule_id, 'sch-1', label);
    const html = rt.lastCard(opened.callId).html;
    assert.match(html, /跟进待修复/, label);
    assert.match(html, /旧版前置检查未自动修改/, label);
    assert.match(html, /pr-node\.cjs/, label);
  }
});

test('refreshed legacy cards expose a visible read-only manual-stop entry across active, paused and terminal states', async () => {
  const url = 'https://github.com/octo/repo/pull/42';
  const { hostApi, rows, runs, calls } = followScheduler();
  const rt = createPrRuntime({ github: prGraphql(), hostApi });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
  const old = { id: 'old', targetSessionId: 's1', status: 'active', recurring: true, updatedAt: 1000, lastFiredAt: 2000, preRunHook: oldFollowHook(url) };
  rows.set('old', structuredClone(old));
  runs.set('old', [verifiedNodeRun('old', { firedAt: 2000 })]);

  // Active ordinary refresh: no permanent manual-stop line, no destructive pr:stop, HAS visible pr:manual-stop entry
  const active = await rt.tool({ card_id: opened.callId });
  assert.equal(active.reply.result.follow_state, 'active');
  assert.equal(active.reply.result.note, undefined);
  const activeHtml = rt.lastCard(opened.callId).html;
  assert.doesNotMatch(activeHtml, /已有调度请在自动化设置手动停止/);
  assert.doesNotMatch(activeHtml, /<button data-ghost-action="pr:stop"/);
  assert.match(activeHtml, /<button data-ghost-action="pr:manual-stop" aria-label="手动停止"/);

  // Clicking the rendered read-only entry on the refreshed card opens manual-stop guidance without deleting
  await rt.click(opened.callId, 'pr:manual-stop');
  assert.equal(calls.includes('schedule_delete'), false);
  assert.equal(rt.agentRuns.length, 0);
  assert.deepEqual(rows.get('old'), old);
  assert.match(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止（ID：old）/);

  // Toggling settings gear keeps manual-stop guidance visible (deduplicated inside PR settings)
  // and closing settings restores the standalone panel; clicking pr:manual-stop collapses it.
  await rt.click(opened.callId, 'prui:settings');
  const withSettings = rt.lastCard(opened.callId).html;
  assert.equal((withSettings.match(/已有调度请在自动化设置手动停止（ID：old）/g) || []).length, 1);
  await rt.click(opened.callId, 'prui:settings');
  assert.match(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止（ID：old）/);
  await rt.click(opened.callId, 'pr:manual-stop');
  assert.doesNotMatch(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止/);

  // Paused ordinary refresh: visible read-only entry works and preserves paused schedule
  rows.get('old').status = 'paused';
  const paused = await rt.tool({ card_id: opened.callId });
  assert.equal(paused.reply.result.follow_state, 'paused');
  assert.equal(paused.reply.result.note, undefined);
  assert.doesNotMatch(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止/);
  assert.match(rt.lastCard(opened.callId).html, /<button data-ghost-action="pr:manual-stop" aria-label="手动停止"/);
  await rt.click(opened.callId, 'pr:manual-stop');
  assert.match(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止（ID：old）/);
  assert.equal(rows.get('old').status, 'paused');
  await rt.click(opened.callId, 'pr:manual-stop');
  assert.doesNotMatch(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止/);

  // Stale pre-upgrade pr:stop click still shows manual-stop note once without deleting; ordinary refresh clears it
  await rt.click(opened.callId, 'pr:stop');
  assert.match(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止（ID：old）/);
  await rt.tool({ card_id: opened.callId });
  assert.doesNotMatch(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止/);

  // Terminal PR with lingering schedule still exposes visible read-only entry and clears once externally deleted
  rows.get('old').status = 'active';
  rt.setGithub(prGraphql({ merged: true }));
  await rt.tool({ card_id: opened.callId });
  assert.doesNotMatch(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止/);
  assert.match(rt.lastCard(opened.callId).html, /<button data-ghost-action="pr:manual-stop" aria-label="手动停止"/);
  await rt.click(opened.callId, 'pr:manual-stop');
  assert.match(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止（ID：old）/);
  assert.equal(rows.get('old').status, 'active');
  rows.delete('old');
  await rt.tool({ card_id: opened.callId });
  assert.doesNotMatch(rt.lastCard(opened.callId).html, /data-ghost-action="pr:manual-stop"|已有调度请在自动化设置手动停止/);
  assert.equal(calls.includes('schedule_delete'), false);
  assert.equal(rt.agentRuns.length, 0);

  // Native card-owned schedule renders pr:stop rather than pr:manual-stop
  const native = followScheduler();
  const nativeRt = createPrRuntime({ github: prGraphql(), hostApi: native.hostApi, kv: { prCard: { autoFollow: true } } });
  const created = await nativeRt.tool({ repo: 'octo/repo', pr: 42, published: true });
  assert.match(nativeRt.lastCard(created.callId).html, /<button data-ghost-action="pr:stop"/);
  assert.doesNotMatch(nativeRt.lastCard(created.callId).html, /data-ghost-action="pr:manual-stop"/);
});

function stripOpenOnlySubtrees(html) {
  let out = html;
  while (true) {
    const m = /<([a-z][a-z0-9]*)\b[^>]*\bdata-ghost-pr-open-only="[^"]+"[^>]*>/i.exec(out);
    if (!m) return out;
    const tag = m[1].toLowerCase();
    const re = new RegExp(`<(/?)(${tag})\\b[^>]*>`, 'gi');
    re.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = out.length;
    for (let next = re.exec(out); next; next = re.exec(out)) {
      depth += next[1] ? -1 : 1;
      if (depth === 0) { end = re.lastIndex; break; }
    }
    out = out.slice(0, m.index) + out.slice(end);
  }
}

function extractOpenOnlyActionsDiv(html) {
  const re = /<div\b[^>]*\bdata-ghost-pr-open-only="[^"]+"[^>]*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tagRe = /<(\/?)div\b[^>]*>/gi;
    tagRe.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = html.length;
    for (let next = tagRe.exec(html); next; next = tagRe.exec(html)) {
      depth += next[1] ? -1 : 1;
      if (depth === 0) { end = tagRe.lastIndex; break; }
    }
    const fragment = html.slice(m.index, end);
    if (!/data-ghost-action="prset:/.test(fragment) &&
        (/data-ghost-action="pr:/.test(fragment) || /margin-left:auto/.test(m[0]))) {
      return fragment;
    }
  }
  return null;
}

test('manual-stop guidance works in both host PR summary popovers and open cards after GitHub merge/close', async () => {
  const url = 'https://github.com/octo/repo/pull/42';
  const { hostApi, rows, runs, calls } = followScheduler();
  const rt = createPrRuntime({ github: prGraphql(), hostApi });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
  const old = { id: 'old', targetSessionId: 's1', status: 'active', recurring: true, updatedAt: 1000, lastFiredAt: 2000, preRunHook: oldFollowHook(url) };
  rows.set('old', structuredClone(old));
  runs.set('old', [verifiedNodeRun('old', { firedAt: 2000 })]);

  await rt.tool({ card_id: opened.callId });
  const openHtml = rt.lastCard(opened.callId).html;

  // Path 1: Host PR summary popover projection (projectPrCard)
  // - Open-only actions row projects live follow state without a dead pr:manual-stop button
  // - Clicking gear (prui:settings, as openCardSettings does) projects manual-stop guidance + ID inside settingsPanel
  const projectedActions = extractOpenOnlyActionsDiv(openHtml);
  assert.ok(projectedActions, 'host projectPrCard must still find the open-only actions div');
  assert.match(projectedActions, /data-ghost-live-label="跟进中"/);
  assert.doesNotMatch(projectedActions, /data-ghost-action="pr:manual-stop"/);
  assert.match(openHtml, /<button data-ghost-action="prui:settings"/);
  assert.equal((openHtml.match(/data-ghost-action="pr:manual-stop"/g) || []).length, 1, 'no duplicate mobile button');

  await rt.click(opened.callId, 'prui:settings');
  const settingsHtml = rt.lastCard(opened.callId).html;
  const panelStart = settingsHtml.lastIndexOf('display:flex;flex-direction:column;padding:8px 8px 10px');
  assert.ok(panelStart > 0, 'manualFollowStop settingsPanel must exist');
  const settingsPanelHtml = settingsHtml.slice(panelStart);
  assert.match(settingsPanelHtml, /<div style="display:none"><\/div><div style="order:2;/, 'empty first child protects manual guidance from projectPrCard heading.remove()');
  assert.match(settingsPanelHtml, /手动停止/);
  assert.match(settingsPanelHtml, /已有调度请在自动化设置手动停止（ID：old）/);
  assert.match(settingsPanelHtml, /data-ghost-action="prset:rename"/);
  assert.match(settingsHtml, /<button data-ghost-action="prui:settings" aria-label="PR 设置"/, 'gear aria-label stays PR 设置 so projectPrCard dialog title stays PR 设置');
  assert.deepEqual(rows.get('old'), old);
  await rt.click(opened.callId, 'prui:settings');

  // Path 2: PR merged/closed on GitHub BEFORE plugin card refresh (host applyOpenOnly / omitEndedPrOpenOnly)
  // - Stripping every data-ghost-pr-open-only subtree still leaves pr:manual-stop visible on the open card
  // - Clicking pr:manual-stop on that existing card opens the explanation + ID outside open-only, leaving schedule intact
  const mergedHostViewBeforeClick = stripOpenOnlySubtrees(rt.lastCard(opened.callId).html);
  assert.doesNotMatch(mergedHostViewBeforeClick, /data-ghost-live-label="跟进中"/);
  assert.match(mergedHostViewBeforeClick, /<button data-ghost-action="pr:manual-stop" aria-label="手动停止"/);

  await rt.click(opened.callId, 'pr:manual-stop');
  const mergedHostViewAfterClick = stripOpenOnlySubtrees(rt.lastCard(opened.callId).html);
  assert.match(mergedHostViewAfterClick, /<button data-ghost-action="pr:manual-stop" aria-label="手动停止"/);
  assert.match(mergedHostViewAfterClick, /已有调度请在自动化设置手动停止（ID：old）/);
  assert.deepEqual(rows.get('old'), old);
  assert.equal(calls.includes('schedule_delete'), false);
  assert.equal(rt.agentRuns.length, 0);
});

function projectMobileRichTextLines(html) {
  let source = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const cutMarked = (input, marker) => {
    const cuts = [];
    const tags = /<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi;
    for (let open = tags.exec(input); open; open = tags.exec(input)) {
      const name = open[2].toLowerCase();
      if (open[1] || ['br', 'hr', 'img'].includes(name) || !marker(name, open[3])) continue;
      const innerStart = tags.lastIndex;
      let depth = 1;
      for (let next = tags.exec(input); next; next = tags.exec(input)) {
        if (next[2].toLowerCase() !== name) continue;
        depth += next[1] ? -1 : 1;
        if (depth === 0) { cuts.push([innerStart, next.index]); break; }
      }
    }
    cuts.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    for (const [from, to] of cuts) {
      const last = merged.at(-1);
      if (last && from <= last[1]) last[1] = Math.max(last[1], to);
      else merged.push([from, to]);
    }
    let out = input;
    for (let i = merged.length - 1; i >= 0; i--) out = out.slice(0, merged[i][0]) + out.slice(merged[i][1]);
    return out;
  };
  source = cutMarked(source, (name, attrs) =>
    /data-ghost-toggle="(?:on|off)"/.test(attrs) ||
    /data-ghost-live-label="[^"]+"/.test(attrs) ||
    /data-ghost-pr-status="[^"]+"/.test(attrs) ||
    (name === 'button' && /data-ghost-action="[^"]+"/.test(attrs) && /aria-label="[^"]+"/.test(attrs)));
  const text = source
    .replace(/<[^>]+>/g, (tag) => /^(?:<br\b|<hr\b|<\/(?:p|div|h[1-4]|li|tr|section|header|footer|blockquote|pre)\b)/i.test(tag) ? '\n' : '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  return text.split('\n').map(l => l.trim()).filter(Boolean);
}

test('mobile settings projection preserves trailing heading and follow-model lines for default, custom and no-picker configs', async () => {
  const url = 'https://github.com/octo/repo/pull/42';
  for (const [label, kv, pickModel, expectedTail] of [
    ['default-model', {}, async () => ({ ok: false }), ['PR 设置', '自动跟进用的模型', '每次跟进用这个任务当时的模型']],
    ['custom-model', { prCard: { followModel: { label: 'Claude Sonnet', route: { agentKind: 'cc', providerId: 'p', model: 'sonnet', effort: 'high', fastMode: false } } } },
      async () => ({ ok: false }), ['PR 设置', '自动跟进用的模型']],
    ['no-model-picker', {}, undefined, ['PR 设置']],
  ]) {
    const { hostApi, rows, runs } = followScheduler();
    const rt = createPrRuntime({ github: prGraphql(), hostApi, kv, pickModel });
    const opened = await rt.tool({ repo: 'octo/repo', pr: 42, following: true });
    rows.set('old', { id: 'old', targetSessionId: 's1', status: 'active', recurring: true, updatedAt: 1000, lastFiredAt: 2000, preRunHook: oldFollowHook(url) });
    runs.set('old', [verifiedNodeRun('old', { firedAt: 2000 })]);
    await rt.tool({ card_id: opened.callId });
    await rt.click(opened.callId, 'prui:settings');

    const html = rt.lastCard(opened.callId).html;
    const projectedLines = projectMobileRichTextLines(html);
    const hasModelChoices = html.includes('data-ghost-action="prset:modelTask"') && html.includes('data-ghost-action="prset:model"');
    const hasModelPicker = html.includes('data-ghost-action="prset:modelPick"');
    const settingsLineCount = 1 + (hasModelChoices ? (hasModelPicker ? 1 : 2) : 0);
    const settingsLines = projectedLines.slice(-settingsLineCount);
    const bodyLines = projectedLines.slice(0, -settingsLineCount);

    assert.deepEqual(settingsLines, expectedTail, label);
    assert.ok(bodyLines.includes('手动停止'), `${label}: manual-stop title should stay in body lines`);
    assert.ok(bodyLines.some(line => line.includes('已有调度请在自动化设置手动停止（ID：old）')), `${label}: manual-stop guidance with ID should stay in body lines`);
  }
});

test('repair guidance survives settings clicks and non-complete chips avoid checkmark glyph', async () => {
  const url = 'https://github.com/octo/repo/pull/42';
  const CHECK_GLYPH_RE = /border-right:1\.6px solid currentColor;border-bottom:1\.6px solid currentColor;transform:rotate\(45deg\)/;
  const { hostApi, rows } = followScheduler();
  const rt = createPrRuntime({ github: prGraphql(), hostApi, kv: { prCard: { autoFollow: true } } });
  const opened = await rt.tool({ repo: 'octo/repo', pr: 42, published: true });
  rows.get('sch-1').preRunHook = oldFollowHook(url);
  await rt.tool({ card_id: opened.callId });
  const beforeClick = rt.lastCard(opened.callId).html;
  assert.match(beforeClick, /跟进待修复/);
  assert.match(beforeClick, /旧版前置检查未自动修改/);
  assert.match(beforeClick, /调度 ID：sch-1/);
  assert.match(beforeClick, /background:var\(--error-fg,#d93025\)/);
  assert.doesNotMatch(beforeClick, CHECK_GLYPH_RE, 'needs-repair chip must not render a checkmark');
  // Toggling settings clears transient card.note but must keep repair guidance + command intact
  await rt.click(opened.callId, 'prui:settings');
  await rt.click(opened.callId, 'prui:settings');
  const afterClick = rt.lastCard(opened.callId).html;
  assert.match(afterClick, /旧版前置检查未自动修改/);
  assert.match(afterClick, /调度 ID：sch-1/);
  assert.match(afterClick, /<pre[^>]*user-select:text/);
  // Paused chip uses neutral wait dot rather than checkmark
  rows.get('sch-1').status = 'paused';
  await rt.tool({ card_id: opened.callId });
  const pausedHtml = rt.lastCard(opened.callId).html;
  assert.match(pausedHtml, /跟进已暂停/);
  assert.doesNotMatch(pausedHtml, CHECK_GLYPH_RE, 'paused chip must not render a checkmark');
});

test('ID-less pre-upgrade Stop preserves manual-stop guidance when the PR is already merged or closed', async () => {
  const url = 'https://github.com/octo/repo/pull/42';
  for (const [label, prOpts, withFault, present] of [
    ['merged-direct', { merged: true }, false, true],
    ['closed-direct', { state: 'CLOSED' }, false, true],
    ['merged-after-outage', { merged: true }, true, true],
    ['closed-absent', { state: 'CLOSED' }, false, false],
  ]) {
    const old = createPrRuntime({ github: prGraphql() });
    const opened = await old.tool({ repo: 'octo/repo', pr: 42, following: true });
    await old.click(opened.callId, 'pr:stop');
    const key = `pr-cards/${opened.callId}.json`;
    assert.equal(JSON.parse(old.files.get(key)).pending, 'stop', label);

    const fault = { failList: withFault };
    const { hostApi, rows, calls } = followScheduler(fault);
    const hook = oldFollowHook(url);
    hook.command = hook.command.replace('pr-heartbeat-gate.mjs"', 'pr-node.cjs" pr-heartbeat-gate.mjs');
    if (present) {
      rows.set('old', { id: 'old', status: 'active', targetSessionId: 's1', recurring: true, preRunHook: hook });
    }
    const rt = createPrRuntime({ github: prGraphql(prOpts), hostApi, files: old.files });
    if (withFault) {
      const unreadable = await rt.tool({ card_id: opened.callId });
      assert.equal(unreadable.reply.result.follow_state, 'unverified', label);
      assert.equal(JSON.parse(rt.files.get(key)).pendingStopNotice, true, label);
      fault.failList = false;
    }
    const settled = await rt.tool({ card_id: opened.callId });
    const saved = JSON.parse(rt.files.get(key));
    assert.equal(saved.pending, null, label);
    assert.equal(saved.pendingStopNotice, undefined, label);
    assert.equal(settled.reply.result.stage, prOpts.merged ? 'merged' : 'closed', label);
    if (present) {
      assert.equal(settled.reply.result.follow_state, 'active', label);
      assert.equal(saved.scheduleId, 'old', label);
      assert.match(settled.reply.result.note || '', /已有调度请在自动化设置手动停止（ID：old）/, label);
      assert.match(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止（ID：old）/, label);
      // Next ordinary refresh clears the one-time stop notice while keeping the read-only entry available.
      const next = await rt.tool({ card_id: opened.callId });
      assert.equal(next.reply.result.note, undefined, label);
      assert.doesNotMatch(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止/, label);
      assert.match(rt.lastCard(opened.callId).html, /<button data-ghost-action="pr:manual-stop" aria-label="手动停止"/, label);
    } else {
      assert.equal(settled.reply.result.follow_state, 'stopped', label);
      assert.equal(settled.reply.result.note, undefined, label);
      assert.doesNotMatch(rt.lastCard(opened.callId).html, /已有调度请在自动化设置手动停止/, label);
    }
    assert.equal(calls.includes('schedule_delete'), false, label);
    assert.equal(rt.agentRuns.length, 0, label);
  }
});

test('saved status watches recover after the startup KV read fails', async () => {
  const first = statusWatchFixture();
  assert.equal((await first.tool('add', 'issue', 2)).ok, true);
  const restored = statusWatchFixture(first.saved(), { failBoot: true });
  await flushAsync();
  assert.equal(restored.timers[0].delay, 900_000);
  await restored.timers.shift().fn();
  assert.deepEqual(restored.paths, ['/user', '/repos/example/widget/issues/2']);
  assert.equal(restored.timers[0].delay, 300_000);
});

test('a refused status notification stays pending across restart until acknowledged', async () => {
  const first = statusWatchFixture({}, { send: message => ({ ok: message.type !== 'notify' }) });
  assert.equal((await first.tool('add', 'issue', 2)).ok, true);
  first.response['/issues/2'].state = 'closed';
  await first.timers.shift().fn();
  assert.equal(first.saved().githubStatusWatches[0].snapshot, 'closed:ready:1');
  assert.equal(first.saved().githubStatusWatches[0].noticePending, true);

  const restored = statusWatchFixture(first.saved());
  restored.response['/issues/2'].state = 'closed';
  await flushAsync();
  await restored.timers.shift().fn();
  assert.equal(restored.sent.filter(message => message.type === 'notify').length, 1);
  assert.equal(restored.saved().githubStatusWatches[0].noticePending, undefined);
  await restored.timers.shift().fn();
  assert.equal(restored.sent.filter(message => message.type === 'notify').length, 1);
});

test('status_watch descriptions define the status format and every problem value in four locales', () => {
  const states = ['open', 'closed', 'merged', 'draft', 'ready', 'queued', 'in_progress', 'completed', 'none',
    'success', 'failure', 'cancelled', 'neutral', 'skipped', 'timed_out', 'action_required', 'stale',
    'startup_failure', 'unknown', 'account_changed', 'target_changed', 'unavailable', 'auth_required',
    'forbidden', 'gone'];
  const manifestDescription = manifest.tools.find((tool) => tool.name === 'status_watch').description;
  assert.ok(manifestDescription.includes('account_changed'), 'ghost.json status_watch description omits account_changed');
  for (const locale of hostLocales) {
    const resource = JSON.parse(
      readFileSync(new URL(`../cindy-github/locales/${locale}.json`, import.meta.url), 'utf8'),
    );
    const text = resource.tools.status_watch.description;
    for (const token of states) {
      assert.ok(text.includes(token), `${locale} status_watch description omits ${token}`);
    }
    assert.match(text, /comment|댓글|コメント|评论/, `${locale} status_watch description omits the comment segment`);
    assert.match(text, /attempt|시도|回数|第几次/, `${locale} status_watch description omits the attempt segment`);
    assert.match(text, /remove/, `${locale} status_watch description omits the recovery action`);
  }
});
