import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

// CI runs only .tests/<plugin>.test.mjs for a changed plugin; the /pr Skill's script tests ride along here.
import './cindy-github-pr/cleanup-plan.test.mjs';
import './cindy-github-pr/ci-retry.test.mjs';
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
  // First Cindy release carrying makecindy/cindy#8244: 0.1.125-beta and earlier do not contain it, and a
  // stable release reuses its same-number beta's commit (so 0.1.125 stable would not either).
  assert.equal(manifest.minCindyVersion, '0.1.126');
  assert.equal('slots' in manifest, false);
  assert.equal(manifest.notify, true);
  assert.equal(manifest.fs, true);
  // PR card: the title links to the PR; agent turns only on clicks, no background runs.
  assert.deepEqual(manifest.card, { externalLinks: true });
  assert.deepEqual(manifest.agent, {});
  const auth = manifest.network?.secrets?.find((secret) => secret.key === 'github_pat');
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
    BroadcastChannel: options.BroadcastChannel ?? class { postMessage() {} addEventListener() {} removeEventListener() {} },
    setTimeout: options.setTimeout ?? (() => 0),
    clearTimeout: options.clearTimeout ?? (() => {}),
    clearInterval: options.clearInterval ?? (() => {}),
    setInterval: options.setInterval ?? (() => 0),
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url, init });
      if (url === '/app-context') {
        if (options.appContext) return options.appContext();
        return { ok: true, json: async () => ({ ok: true, context: { region: 'cn', locale: options.locale ?? 'zh-CN' } }) };
      }
      if (url === '/wake' && options.wake) return options.wake();
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
    assert.equal(page.fetchCalls.some(call => call.url === '/kv'), false, 'account settings do not access PR preferences');
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

function prGraphql({ number = 42, title = 'Built-in PR skill', ci = 'SUCCESS', threads = [], mergeState = 'CLEAN', merged = false, state = merged ? 'MERGED' : 'OPEN' } = {}) {
  return (request) => {
    assert.equal(request.url, 'https://api.github.com/graphql');
    assert.deepEqual(JSON.parse(request.body).variables, { owner: 'octo', name: 'repo', number });
    return jsonResponse({ data: { repository: { pullRequest: {
      number, title, url: `https://github.com/octo/repo/pull/${number}`, state,
      isDraft: false, merged, mergeStateStatus: mergeState, reviewDecision: null, baseRefName: 'main',
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
    BroadcastChannel: options.BroadcastChannel ?? class { postMessage() {} },
    fetch: async (url, init = {}) => {
      if (options.preferences && url === '/kv') return options.preferences(url, init);
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
    setTimeout,
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
    card_id: cardId, stage: 'ask', settings: { auto_rename: false, auto_follow: false, ci_retry_repush: false }, next: zhCopy.prNextAsk,
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
      settings: { auto_rename: false, auto_follow: false, ci_retry_repush: false },
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
  assert.deepEqual(opened.reply.result.settings, { auto_rename: false, auto_follow: true, ci_retry_repush: false });
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
  const button = runtime.lastCard(cardId).html.match(/<button data-ghost-copy-link=[^>]*>/)?.[0] ?? '';
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
    assert.equal(runtime.lastCard(cardId).height, 520);
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
    auto_rename: true, auto_follow: true, ci_retry_repush: false,
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
  assert.deepEqual((await createPrRuntime().tool({}, 'pr_follow_settings')).reply.result.settings, { auto_rename: false, auto_follow: false, ci_retry_repush: false });
});

test('two PR cards serialize other preference saves with a later CI disable', async () => {
  let kv = { untouched: 'keep', prCard: { ciRetryRepush: true } };
  const blocked = deferred(), release = deferred();
  let held = false, writing = 0, maxWriting = 0;
  const preferences = async (_, init) => {
    if (init.method === 'PUT') {
      writing++; maxWriting = Math.max(maxWriting, writing);
      const next = JSON.parse(init.body);
      if (next.prCard.autoRename && !held) { held = true; blocked.resolve(); await release.promise; }
      kv = next; writing--; return { ok: true, status: 204 };
    }
    return { ok: true, json: async () => structuredClone(kv) };
  };
  const runtime = createPrRuntime({ preferences });
  const first = await runtime.tool({ repo: 'example/repo', head: 'feature' });
  const second = await runtime.tool({ repo: 'example/other', head: 'feature' });
  const rename = runtime.click(first.callId, 'prset:rename');
  await blocked.promise;
  const disable = runtime.click(second.callId, 'prset:ciRetry:off');
  release.resolve();
  await Promise.all([rename, disable]);
  assert.equal(kv.prCard.ciRetryRepush === true, false);
  assert.equal(kv.prCard.autoRename, true);
  assert.equal(kv.untouched, 'keep');
  assert.equal(maxWriting, 1);
});

test('account settings and retired preference messages cannot change CI authorization', async () => {
  const page = createSettings();
  await flushAsync();
  assert.equal(page.elements.has('ci-retry'), false);
  assert.equal(page.fetchCalls.some(call => call.url === '/kv'), false);
  let channel, writes = 0;
  const runtime = createPrRuntime({
    BroadcastChannel: class { constructor() { channel = this; } postMessage() {} },
    preferences: async (_, init) => {
      if (init.method === 'PUT') writes++;
      return { ok: true, json: async () => ({ prCard: { ciRetryRepush: false } }) };
    },
  });
  channel.onmessage({ data: { type: 'pr-preference-ready', reqId: 'a'.repeat(32) } });
  channel.onmessage({ data: { type: 'pr-preference-write', reqId: 'a'.repeat(32), ciRetryRepush: true } });
  await flushAsync();
  assert.equal(writes, 0);
  assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.result.settings.ci_retry_repush, false);
});

test('stale CI card actions express their displayed target and never invert a fresh disable', async () => {
  const runtime = createPrRuntime({ kv: { prCard: { ciRetryRepush: true } } });
  const first = await runtime.tool({ repo: 'example/repo', head: 'feature' });
  const second = await runtime.tool({ repo: 'example/other', head: 'feature' });
  await runtime.click(first.callId, 'prui:settings');
  assert.match(runtime.lastCard(first.callId).html, /prset:ciRetry:off" data-ghost-toggle="on"/);
  await runtime.click(second.callId, 'prset:ciRetry:off');
  await runtime.click(first.callId, 'prset:ciRetry:off');
  await runtime.click(first.callId, 'prset:ciRetry:off');
  assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.result.settings.ci_retry_repush, false);
  // Pre-upgrade cards carry no target; refresh them, without interpreting them as consent.
  await runtime.click(first.callId, 'prset:ciRetry');
  assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.result.settings.ci_retry_repush, false);
  await runtime.click(first.callId, 'prset:ciRetry:on');
  assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.result.settings.ci_retry_repush, true);
});

test('CI repush preference defaults off, stays independent of follow, and treats only true as enabled', async () => {
  for (const value of [undefined, false, 'true', 1, null, true]) {
    const runtime = createPrRuntime({ kv: { prCard: { autoFollow: true, ciRetryRepush: value } } });
    const settings = (await runtime.tool({}, 'pr_follow_settings')).reply.result.settings;
    assert.equal(settings.auto_follow, true);
    assert.equal(settings.ci_retry_repush, value === true);
    assert.equal(runtime.agentRuns.length, 0);
    assert.equal(runtime.files.size, 0);
  }
});

test('PR cards persist one live CI preference across reloads, repositories and follow rounds', async () => {
  const original = { unrelated: { keep: 1 }, prCard: { autoFollow: true, autoRename: true, autoArchive: true,
    lastFollowModel: { route: { agentKind: 'codex', providerId: '', model: 'example-model', effort: '', fastMode: false }, label: 'Example' },
    futurePreference: 'keep' } };
  let kv = structuredClone(original);
  let writes = 0;
  const preferences = async (url, init) => {
    assert.equal(url, '/kv');
    if (init.method === 'PUT') { kv = JSON.parse(init.body); writes++; return { ok: true, status: 204 }; }
    return { ok: true, json: async () => structuredClone(kv) };
  };
  const runtime = createPrRuntime({ preferences, github: prGraphql() });
  const entry = await runtime.tool({ repo: 'example/repo', head: 'feature' });
  assert.equal(entry.reply.result.settings.ci_retry_repush, false);
  assert.equal(writes, 0, 'displaying a PR card does not change preferences');
  await runtime.click(entry.callId, 'prset:ciRetry:on');
  assert.deepEqual(kv, { ...original, prCard: { ...original.prCard, ciRetryRepush: true } });

  const first = await runtime.tool({ repo: 'octo/repo', pr: 42, following: true });
  const id = first.reply.result.card_id;
  assert.equal(first.reply.result.settings.ci_retry_repush, true);
  await runtime.click(id, 'prui:settings');
  assert.match(runtime.lastCard(id).html, /prset:ciRetry:off" data-ghost-toggle="on"/);
  const restarted = createPrRuntime({ preferences });
  assert.equal((await restarted.tool({}, 'pr_follow_settings')).reply.result.settings.ci_retry_repush, true);
  const otherRepo = await restarted.tool({ repo: 'example/another', head: 'feature' });
  assert.equal(otherRepo.reply.result.settings.ci_retry_repush, true);

  // An already-running follow-up reads again rather than treating its first card result as a grant.
  await runtime.click(id, 'prset:ciRetry:off');
  assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.result.settings.ci_retry_repush, false);
  assert.equal((await runtime.tool({ card_id: id })).reply.result.settings.ci_retry_repush, false);
  const reloaded = createPrRuntime({ preferences });
  assert.equal((await reloaded.tool({}, 'pr_follow_settings')).reply.result.settings.ci_retry_repush, false);
  assert.equal(kv.prCard.autoFollow, true);
  const { ciRetryRepush, ...otherPreferences } = kv.prCard;
  assert.deepEqual(otherPreferences, original.prCard, 'changing CI authorization preserves other preferences');
  assert.deepEqual(kv.unrelated, original.unrelated);
  assert.equal(runtime.agentRuns.length, 0, 'changing this switch never starts follow-up or Git');
});

test('disabling from another PR card applies to the existing card and next follow handoff', async () => {
  const runtime = createPrRuntime({ kv: { prCard: { ciRetryRepush: true } }, github: prGraphql() });
  const card = await runtime.tool({ repo: 'octo/repo', pr: 42 });
  assert.equal(card.reply.result.settings.ci_retry_repush, true);
  const other = await runtime.tool({ repo: 'example/another', head: 'feature' });
  await runtime.click(other.callId, 'prset:ciRetry:off');
  await runtime.click(card.callId, 'pr:follow');
  assert.equal(runtime.agentRuns.at(-1).event.settings.ci_retry_repush, false);
  assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.result.settings.ci_retry_repush, false);
});

test('CI preference read failures and uncertain card writes do not enable or blindly retry recovery', async () => {
  let writes = 0;
  const preferences = async (_, init) => {
    if (init.method === 'PUT') { writes++; throw new Error('unknown write outcome'); }
    return { ok: true, json: async () => ({ prCard: { ciRetryRepush: false } }) };
  };
  const runtime = createPrRuntime({ preferences });
  const card = await runtime.tool({ repo: 'example/repo', head: 'feature' });
  await runtime.click(card.callId, 'prset:ciRetry:on');
  assert.equal(writes, 1, 'no blind retry after a possibly completed write');
  assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.result.settings.ci_retry_repush, false);
  assert.ok(visibleText(runtime.lastCard(card.callId).html).includes(zhCopy.prSettingFailed));
  const unreadable = createPrRuntime({ github: prGraphql(), kvFails: true });
  const failed = await unreadable.tool({ repo: 'octo/repo', pr: 42 });
  assert.deepEqual(failed.reply.result.settings, { unreadable: true });
  await unreadable.click(failed.callId, 'prset:ciRetry:on');
  assert.equal((await unreadable.tool({}, 'pr_follow_settings')).reply.ok, false);
});

test('failed preference reads display unknown instead of an enabled authorization as off', async () => {
  let fail = false, writes = 0;
  const runtime = createPrRuntime({ preferences: async (_, init) => {
    if (init.method === 'PUT') writes++;
    return fail ? { ok: false } : { ok: true, json: async () => ({ prCard: { ciRetryRepush: true } }) };
  } });
  const entry = await runtime.tool({ repo: 'example/repo', head: 'feature' });
  await runtime.click(entry.callId, 'prui:settings');
  fail = true;
  const failed = await runtime.tool({ card_id: entry.callId });
  assert.deepEqual(failed.reply.result.settings, { unreadable: true });
  const html = runtime.lastCard(entry.callId).html;
  assert.doesNotMatch(html, /data-ghost-action="prset:/, 'unknown must not manufacture toggle/model choices');
  assert.ok(visibleText(html).includes(zhCopy.prSettingsUnknown));
  assert.match(html, /data-ghost-action="prui:settingsRefresh"/);
  fail = false;
  await runtime.click(entry.callId, 'prui:settingsRefresh');
  assert.match(runtime.lastCard(entry.callId).html, /prset:ciRetry:off" data-ghost-toggle="on"/);
  assert.equal(writes, 0, 'refresh only reads, never grants or revokes authorization');
});

test('uncertain preference mutations read back actual state without replaying the write', async () => {
  for (const action of ['prset:ciRetry:on', 'prset:ciRetry:off', 'prset:rename']) {
    for (const mode of ['throw', 'rejected', 'readback-fails', 'accepted-readback-fails']) {
      let kv = { prCard: { ciRetryRepush: action !== 'prset:ciRetry:on' } }, writes = 0, readbacks = 0, unavailable = false;
      const runtime = createPrRuntime({ preferences: async (_, init) => {
        if (init.method === 'PUT') {
          kv = JSON.parse(init.body); writes++;
          if (mode === 'rejected') return { ok: false };
          unavailable = mode === 'readback-fails' || mode === 'accepted-readback-fails';
          if (mode === 'accepted-readback-fails') return { ok: true };
          throw new Error('response lost after persistence');
        }
        if (writes) readbacks++;
        return unavailable ? { ok: false } : { ok: true, json: async () => structuredClone(kv) };
      } });
      const card = await runtime.tool({ repo: 'example/repo', head: 'feature' });
      await runtime.click(card.callId, 'prui:settings');
      await runtime.click(card.callId, action);
      assert.ok(readbacks > 0, 'a failed PUT result must be reconciled with a read');
      const html = runtime.lastCard(card.callId).html;
      if (unavailable) {
        assert.doesNotMatch(html, /data-ghost-action="prset:/);
        assert.ok(visibleText(html).includes(zhCopy.prSettingsUnknown));
      } else {
        assert.ok(visibleText(html).includes(zhCopy.prSettingFailed));
        assert.match(html, kv.prCard.ciRetryRepush ? /prset:ciRetry:off" data-ghost-toggle="on"/ : /prset:ciRetry:on" data-ghost-toggle="off"/);
      }
      unavailable = false;
      await runtime.click(card.callId, 'prui:settingsRefresh');
      assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.result.settings.ci_retry_repush, kv.prCard.ciRetryRepush === true);
      assert.equal(writes, 1, 'read-back and refresh cannot repeat an uncertain mutation');
    }
  }
});

test('malformed preference storage is unknown and cannot overwrite unrelated data', async () => {
  for (const kv of [null, [], 1, 'invalid']) {
    let writes = 0;
    const runtime = createPrRuntime({ preferences: async (_, init) => {
      if (init.method === 'PUT') writes++;
      return { ok: true, json: async () => kv };
    } });
    const card = await runtime.tool({ repo: 'example/repo', head: 'feature' });
    assert.deepEqual(card.reply.result.settings, { unreadable: true });
    await runtime.click(card.callId, 'prset:ciRetry:on');
    assert.equal(writes, 0);
    assert.equal((await runtime.tool({}, 'pr_follow_settings')).reply.ok, false);
  }
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
