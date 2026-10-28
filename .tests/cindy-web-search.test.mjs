import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const pluginDir = path.join(root, 'cindy-web-search');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'ghost.json'), 'utf8'));
const source = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(pluginDir, 'settings.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(pluginDir, 'settings.html'), 'utf8');
const locales = ['zh-CN', 'en', 'ja', 'ko'].map((locale) =>
  JSON.parse(fs.readFileSync(path.join(pluginDir, 'locales', `${locale}.json`), 'utf8')),
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

// Existing assertions check the original Simplified Chinese copy, so the
// harness host reports zh-CN unless a test picks another locale explicitly.
function createHarness(options = {}) {
  const kv = options.kv ?? {};
  const networkCalls = [];
  const cindyRequests = [];
  const appContextRequests = [];
  const toolResults = [];
  let handler = null;

  const cindy = {
    async request(message) {
      assert.deepEqual(JSON.parse(JSON.stringify(message)), { kind: 'app-context' });
      appContextRequests.push(message);
      if (options.appContext) return options.appContext();
      return { ok: true, context: { region: 'cn', locale: options.locale ?? 'zh-CN' } };
    },
    onHostMessage(fn) {
      handler = fn;
    },
    async fetch(request) {
      networkCalls.push(request);
      if (options.networkResult) return options.networkResult(request);
      throw new Error('unexpected network request');
    },
    async send(message) {
      if (message.type === 'cindy-request') {
        cindyRequests.push(message);
        if (options.cindyError) throw options.cindyError;
        return options.cindyResult ?? {
          ok: true,
          provider: 'cindy',
          results: [
            {
              title: 'Cindy',
              url: 'https://example.test/cindy',
              snippet: 'Managed result',
            },
          ],
        };
      }
      if (message.type === 'tool-result') {
        toolResults.push(message);
        return { ok: true };
      }
      throw new Error(`unexpected cindy.send type ${message.type}`);
    },
  };

  if (options.withoutRequest) delete cindy.request;
  const context = {
    cindy,
    fetch: async (url, init) => {
      if (options.kvFetch) return options.kvFetch(url, init);
      assert.equal(url, '/kv');
      return {
        ok: true,
        async json() {
          return kv;
        },
      };
    },
    encodeURIComponent,
    isFinite,
    JSON,
    String,
    Error,
    setTimeout: options.setTimeout ?? setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context);
  assert.equal(typeof handler, 'function');

  return {
    networkCalls,
    cindyRequests,
    appContextRequests,
    toolResults,
    messages: context.MESSAGES,
    async hostMessage(message) {
      await handler(message);
    },
    async search(args = {}) {
      await handler({
        type: 'tool-call',
        tool: 'search_web',
        callId: 'call-1',
        args: { query: 'Cindy', ...args },
      });
      return toolResults.at(-1);
    },
  };
}

function createSettingsHarness(options = {}) {
  function control(initial = {}) {
    const listeners = new Map();
    return {
      checked: initial.checked ?? false,
      value: initial.value ?? '',
      disabled: initial.disabled ?? false,
      textContent: '',
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      emit(type) {
        const listener = listeners.get(type);
        assert.ok(listener, `missing ${type} listener`);
        return listener();
      },
    };
  }

  const cindyAiEnabled = control({ checked: true, disabled: true });
  const byoDefaultProvider = control({ value: 'brave', disabled: true });
  const status = control();
  const elements = new Map([
    ['cindy-ai-enabled', cindyAiEnabled],
    ['byo-default-provider', byoDefaultProvider],
    ['status', status],
  ]);
  const fetchCalls = [];
  const copyNodes = options.copyNodes ?? {};
  const document = {
    documentElement: { lang: 'zh-CN' },
    getElementById(id) {
      return elements.get(id);
    },
    querySelectorAll(selector) {
      if (selector === '.secret') return options.secretNodes ?? [];
      const match = /^\[(data-i18n(?:-title|-aria-label)?)\]$/.exec(selector);
      assert.ok(match, `unexpected selector ${selector}`);
      return copyNodes[match[1]] ?? [];
    },
  };

  const context = {
    document,
    AbortController,
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url, init });
      if (url === '/app-context') {
        if (options.appContext) return options.appContext(init);
        return {
          ok: true,
          async json() {
            return { ok: true, context: { region: 'cn', locale: options.locale ?? 'zh-CN' } };
          },
        };
      }
      if (url === '/secrets') {
        return {
          ok: true,
          async json() {
            return [];
          },
        };
      }
      assert.equal(url, '/kv');
      if (init.method === 'PUT') {
        return options.writeKv ? options.writeKv(init) : { ok: true };
      }
      return options.readKv
        ? options.readKv()
        : {
            ok: true,
            async json() {
              return {};
            },
          };
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    JSON,
    Error,
  };
  vm.runInNewContext(settingsSource, context);

  return {
    cindyAiEnabled,
    byoDefaultProvider,
    status,
    fetchCalls,
    document,
    messages: context.MESSAGES,
  };
}

test('manifest declares Cindy Web Search and keeps BYO providers explicit', () => {
  assert.equal(manifest.version, '1.5.0');
  assert.equal(manifest.minCindyVersion, '0.1.64');
  assert.equal(manifest.schemaVersion, 3);
  assert.deepEqual(manifest.cindy, { search: ['web'] });
  assert.equal(Object.hasOwn(manifest, 'slots'), false);
  assert.deepEqual(manifest.network.hosts, ['api.search.brave.com', 'api.tavily.com', 'api.deepseek.com']);
  assert.deepEqual(manifest.setup, { requires: [] });
  const provider = manifest.tools[0].parameters.properties.provider;
  assert.deepEqual(provider.enum, ['cindy', 'brave', 'tavily', 'deepseek']);
  assert.equal(provider.enum.includes('auto'), false);
  const query = manifest.tools[0].parameters.properties.query;
  assert.equal(query.maxLength, 2000);
  assert.match(manifest.tools[0].description, /2000/);
  assert.match(query.description, /2000/);
  for (const locale of locales) {
    assert.match(locale.tools.search_web.description, /2000/);
  }
});

test('missing provider uses Cindy AI by default and does not touch BYO network', async () => {
  const harness = createHarness();
  const result = await harness.search();

  assert.equal(harness.networkCalls.length, 0);
  assert.equal(harness.cindyRequests.length, 1);
  const request = harness.cindyRequests[0];
  assert.equal(request.type, 'cindy-request');
  assert.equal(request.kind, 'search_web');
  assert.equal(request.query, 'Cindy');
  assert.equal(request.limit, 5);
  assert.equal(request.provider, 'cindy');
  assert.equal(request.callId, 'call-1');
  assert.equal(request.callerTool, 'search_web');
  assert.equal(result.ok, true);
  assert.equal(result.result.provider, 'cindy');
});

test('disabled Cindy AI uses the configured BYO default only', async () => {
  const harness = createHarness({
    kv: { cindyAiEnabled: false, byoDefaultProvider: 'tavily' },
    networkResult(request) {
      assert.equal(request.url, 'https://api.tavily.com/search');
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          results: [
            {
              title: 'Tavily',
              url: 'https://example.test/tavily',
              content: 'BYO result',
            },
          ],
        }),
      };
    },
  });
  const result = await harness.search();

  assert.equal(harness.cindyRequests.length, 0);
  assert.equal(harness.networkCalls.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.result.provider, 'tavily');
});

test('missing provider fails closed when preferences cannot be read', async () => {
  const harness = createHarness({
    kvFetch: async () => {
      throw new Error('kv unavailable');
    },
  });
  const result = await harness.search();

  assert.equal(harness.cindyRequests.length, 0);
  assert.equal(harness.networkCalls.length, 0);
  assert.equal(result.ok, false);
  assert.match(result.message, /搜索偏好读取失败/);
});

test('Cindy transport failures return an actionable service error', async () => {
  const harness = createHarness({
    cindyError: new Error('Failed to fetch'),
  });
  const result = await harness.search({ provider: 'cindy' });

  assert.equal(harness.cindyRequests.length, 1);
  assert.equal(harness.networkCalls.length, 0);
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Cindy AI 搜索服务暂时不可用，请稍后再试');
  assert.equal(result.errorCode, 'INTERNAL');
  assert.doesNotMatch(result.message, /Failed to fetch/);
});

test('explicit provider wins over settings and provider failures never fall back', async () => {
  const brave = createHarness({
    kvFetch: async () => {
      throw new Error('explicit provider must not read kv');
    },
    networkResult(request) {
      assert.match(request.url, /^https:\/\/api\.search\.brave\.com\//);
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          web: {
            results: [
              {
                title: 'Brave',
                url: 'https://example.test/brave',
                description: 'BYO result',
              },
            ],
          },
        }),
      };
    },
  });
  const braveResult = await brave.search({ provider: 'brave' });
  assert.equal(brave.cindyRequests.length, 0);
  assert.equal(brave.networkCalls.length, 1);
  assert.equal(braveResult.result.provider, 'brave');

  const failedCindy = createHarness({
    cindyResult: {
      ok: false,
      errorCode: 'QUOTA_EXHAUSTED',
      message: 'Cindy AI quota exhausted',
    },
  });
  const failedResult = await failedCindy.search({ provider: 'cindy' });
  assert.equal(failedCindy.cindyRequests.length, 1);
  assert.equal(failedCindy.networkCalls.length, 0);
  assert.equal(failedResult.ok, false);
  assert.equal(failedResult.message, 'Cindy AI quota exhausted');
  assert.equal(failedResult.errorCode, 'QUOTA_EXHAUSTED');
});

for (const provider of ['cindy', 'brave', 'tavily']) {
  for (const errorCode of ['RATE_LIMITED', 'QUOTA_EXHAUSTED', 'INVALID_INPUT', 'PERMISSION_DENIED']) {
    test(`${provider} preserves Host error ${errorCode} without retry or fallback`, async () => {
      const failure = { ok: false, errorCode, message: 'Host failure details' };
      const harness = createHarness({ cindyResult: failure, networkResult: () => failure });
      const result = await harness.search({ provider });

      assert.equal(result.ok, false);
      assert.equal(result.errorCode, errorCode);
      assert.equal(result.message, failure.message);
      assert.equal(result.callId, 'call-1');
      assert.equal(harness.toolResults.length, 1);
      assert.equal(harness.cindyRequests.length, provider === 'cindy' ? 1 : 0);
      assert.equal(harness.networkCalls.length, provider === 'cindy' ? 0 : 1);
    });
  }

  test(`${provider} preserves structured exceptions`, async () => {
    const failure = Object.assign(new Error('Search quota exhausted; check your balance'), {
      errorCode: 'QUOTA_EXHAUSTED',
    });
    const harness = createHarness({
      cindyError: failure,
      networkResult: () => { throw failure; },
    });
    const result = await harness.search({ provider });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'QUOTA_EXHAUSTED');
    assert.ok(result.message.includes(failure.message));
    assert.equal(harness.toolResults.length, 1);
    assert.equal(harness.cindyRequests.length, provider === 'cindy' ? 1 : 0);
    assert.equal(harness.networkCalls.length, provider === 'cindy' ? 0 : 1);
  });

  test(`${provider} classifies unstructured exceptions as INTERNAL`, async () => {
    const failure = new Error('Unexpected failure');
    const harness = createHarness({
      cindyError: failure,
      networkResult: () => { throw failure; },
    });
    const result = await harness.search({ provider });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'INTERNAL');
    assert.equal(harness.toolResults.length, 1);
  });
}

test('legacy failures without errorCode remain failures without guessing their category', async () => {
  const harness = createHarness({ cindyResult: { ok: false, message: 'Legacy failure' } });
  const result = await harness.search({ provider: 'cindy' });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, undefined);
  assert.equal(result.message, 'Legacy failure');
});

test('settings controls stay disabled until initial preferences load', async () => {
  const pendingKv = deferred();
  const harness = createSettingsHarness({
    readKv: () => pendingKv.promise,
  });

  assert.equal(harness.cindyAiEnabled.disabled, true);
  assert.equal(harness.byoDefaultProvider.disabled, true);

  pendingKv.resolve({
    ok: true,
    async json() {
      return { cindyAiEnabled: false, byoDefaultProvider: 'tavily' };
    },
  });
  await flushAsync();

  assert.equal(harness.cindyAiEnabled.checked, false);
  assert.equal(harness.byoDefaultProvider.value, 'tavily');
  assert.equal(harness.cindyAiEnabled.disabled, false);
  assert.equal(harness.byoDefaultProvider.disabled, false);
});

test('settings remain disabled when initial preferences fail to load', async () => {
  const harness = createSettingsHarness({
    readKv: async () => {
      throw new Error('kv unavailable');
    },
  });
  await flushAsync();

  assert.equal(harness.cindyAiEnabled.disabled, true);
  assert.equal(harness.byoDefaultProvider.disabled, true);
  assert.match(harness.status.textContent, /搜索偏好加载失败/);
  assert.match(settingsHtml, /id="cindy-ai-enabled"[^>]*disabled/);
  assert.match(settingsHtml, /id="byo-default-provider"[^>]*disabled/);
});

test('settings save failure restores the last successfully loaded preferences', async () => {
  const harness = createSettingsHarness({
    readKv: async () => ({
      ok: true,
      async json() {
        return { cindyAiEnabled: false, byoDefaultProvider: 'tavily' };
      },
    }),
    writeKv: async () => ({ ok: false }),
  });
  await flushAsync();

  harness.cindyAiEnabled.checked = true;
  harness.cindyAiEnabled.emit('change');
  await flushAsync();

  assert.equal(harness.cindyAiEnabled.checked, false);
  assert.equal(harness.byoDefaultProvider.value, 'tavily');
  assert.equal(harness.cindyAiEnabled.disabled, false);
  assert.equal(harness.byoDefaultProvider.disabled, false);
  assert.match(harness.status.textContent, /搜索偏好保存失败/);
});

function deepSeekResponse(results = []) {
  return { ok: true, status: 200, body: JSON.stringify({ results }) };
}

function deepSeekItem(overrides = {}) {
  return {
    title: 'Example page', url: 'https://example.test/page',
    summary: 'Long summary for the model', snippet: 'Short display snippet',
    content: '', ...overrides,
  };
}

test('DeepSeek uses the independent Search API with Host-only credential injection', async () => {
  const harness = createHarness({
    kvFetch: () => { throw new Error('explicit selection must not read preferences'); },
    networkResult: () => deepSeekResponse([
      deepSeekItem(), deepSeekItem({ summary: '', snippet: 'Fallback snippet' }),
      deepSeekItem({ title: 'Extra result' }),
    ]),
  });
  const result = await harness.search({ provider: 'deepseek', query: '  示例 site:example.test  ', limit: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.result.provider, 'deepseek');
  assert.deepEqual(JSON.parse(JSON.stringify(result.result.results)), [
    { title: 'Example page', url: 'https://example.test/page', snippet: 'Long summary for the model' },
    { title: 'Example page', url: 'https://example.test/page', snippet: 'Fallback snippet' },
  ]);
  assert.equal(harness.networkCalls.length, 1);
  assert.equal(harness.cindyRequests.length, 0);
  assert.equal(harness.toolResults.length, 1);
  const request = harness.networkCalls[0];
  assert.equal(request.url, 'https://api.deepseek.com/v1/tools/search');
  assert.equal(request.method, 'POST');
  assert.equal(request.callId, 'call-1');
  assert.deepEqual(JSON.parse(JSON.stringify(request.headers)), { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(request.body), { query: '示例 site:example.test', count: 2, need_content: false });
});

test('DeepSeek may be the BYO default while Cindy AI remains the initial default', async () => {
  const configured = { cindyAiEnabled: false, byoDefaultProvider: 'deepseek' };
  const harness = createHarness({ kv: configured, networkResult: () => deepSeekResponse() });
  const result = await harness.search();
  assert.equal(result.ok, true);
  assert.equal(result.result.provider, 'deepseek');
  assert.equal(result.result.results.length, 0);
  assert.equal(JSON.parse(harness.networkCalls[0].body).count, 5);
  assert.equal(harness.cindyRequests.length, 0);

  const enabled = createHarness({ kv: { ...configured, cindyAiEnabled: true } });
  assert.equal((await enabled.search()).result.provider, 'cindy');
  assert.equal(enabled.networkCalls.length, 0);
});

test('DeepSeek limit respects the shared 1–10 result contract', async () => {
  for (const [limit, count] of [[0, 1], [2.9, 2], [50, 10]]) {
    const harness = createHarness({ networkResult: () => deepSeekResponse() });
    assert.equal((await harness.search({ provider: 'deepseek', limit })).ok, true);
    assert.equal(JSON.parse(harness.networkCalls[0].body).count, count);
  }
});

test('DeepSeek validates 128 Unicode code points without truncation for both routing paths', async () => {
  for (const unit of ['中', '😀']) {
    const query = unit.repeat(128);
    const harness = createHarness({ networkResult: () => deepSeekResponse() });
    assert.equal((await harness.search({ provider: 'deepseek', query })).ok, true);
    assert.equal(JSON.parse(harness.networkCalls[0].body).query, query);
    for (const provider of ['deepseek', undefined]) {
      const rejected = createHarness({ kv: { cindyAiEnabled: false, byoDefaultProvider: 'deepseek' } });
      const result = await rejected.search({ provider, query: query + unit });
      assert.equal(result.ok, false);
      assert.equal(result.errorCode, 'INVALID_INPUT');
      assert.match(result.message, /128/);
      assert.equal(rejected.networkCalls.length, 0);
      assert.equal(rejected.cindyRequests.length, 0);
    }
  }
  const existing = createHarness();
  assert.equal((await existing.search({ provider: 'cindy', query: 'a'.repeat(2000) })).ok, true);
  assert.equal(existing.cindyRequests[0].query.length, 2000);
  const empty = createHarness();
  assert.equal((await empty.search({ provider: 'deepseek', query: ' \n ' })).ok, false);
  assert.equal(empty.networkCalls.length, 0);
});

for (const [status, code, guidance] of [
  [400, 'INVALID_INPUT', /查询/], [401, 'AUTH_REJECTED', /更新 Key/],
  [402, 'QUOTA_EXHAUSTED', /充值/], [403, 'PERMISSION_DENIED', /权限/],
  [404, 'UPSTREAM_REJECTED', /账号权限/], [408, 'UPSTREAM_UNAVAILABLE', /稍后重试/],
  [413, 'INVALID_INPUT', /查询/], [429, 'RATE_LIMITED', /稍后重试/],
  [500, 'UPSTREAM_UNAVAILABLE', /稍后重试/], [504, 'UPSTREAM_UNAVAILABLE', /稍后重试/],
  [302, 'UPSTREAM_REJECTED', /账号权限/], [422, 'UPSTREAM_REJECTED', /账号权限/],
]) {
  test(`DeepSeek HTTP ${status} gives actionable ${code} without retry, fallback or body disclosure`, async () => {
    for (const locale of ['zh-CN', 'en', 'ja', 'ko']) {
      const harness = createHarness({ locale, networkResult: () => ({ ok: true, status, body: 'upstream-private-detail' }) });
      const result = await harness.search({ provider: 'deepseek' });
      assert.equal(result.ok, false);
      assert.equal(result.errorCode, code);
      if (locale === 'zh-CN') assert.match(result.message, guidance);
      assert.equal(result.message, harness.messages[locale][`deepSeek_${code}`], locale);
      assert.doesNotMatch(result.message, /upstream-private-detail|HTTP|\b[345]\d\d\b/, locale);
      assert.equal(harness.networkCalls.length, 1);
      assert.equal(harness.cindyRequests.length, 0);
      assert.equal(harness.toolResults.length, 1);
    }
  });
}

test('DeepSeek preserves structured Host error codes with safe, actionable messages', async () => {
  for (const [errorCode, guidance] of [
    ['NOT_CONFIGURED', /配置 DeepSeek API Key/], ['AUTH_REJECTED', /更新 Key/],
    ['PERMISSION_DENIED', /授权/], ['QUOTA_EXHAUSTED', /充值/],
    ['RATE_LIMITED', /稍后重试/], ['INVALID_INPUT', /128/], ['HOST_NETWORK_FAILURE', /网络连接/],
  ]) {
    for (const throws of [false, true]) {
      const harness = createHarness({ networkResult: () => {
        if (throws) throw Object.assign(new Error('private-host-detail'), { errorCode });
        return { ok: false, errorCode, message: 'private-host-detail' };
      } });
      const result = await harness.search({ provider: 'deepseek' });
      assert.equal(result.errorCode, errorCode);
      assert.match(result.message, guidance);
      assert.doesNotMatch(result.message, /private-host-detail/);
      assert.equal(harness.networkCalls.length, 1);
      assert.equal(harness.cindyRequests.length, 0);
      assert.equal(harness.toolResults.length, 1);
    }
  }
});

test('DeepSeek handles legacy Host failures and exceptions without exposing diagnostics', async () => {
  for (const failure of [null, { ok: false, message: 'private-host-detail' }, new Error('private-host-detail')]) {
    const harness = createHarness({ networkResult: () => {
      if (failure instanceof Error) throw failure;
      return failure;
    } });
    const result = await harness.search({ provider: 'deepseek' });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'INTERNAL');
    assert.match(result.message, /网络连接/);
    assert.match(result.message, /DeepSeek API Key/);
    assert.doesNotMatch(result.message, /private-host-detail/);
    assert.equal(harness.networkCalls.length, 1);
  }
});

test('DeepSeek rejects malformed, truncated and oversized results instead of returning empty success', async () => {
  const bodies = ['invalid-json', 'null', '{}', '{"results":{}}', '{"results":[null]}',
    JSON.stringify({ results: [deepSeekItem({ title: null })] }),
    JSON.stringify({ results: [deepSeekItem({ summary: null })] }),
    JSON.stringify({ results: [deepSeekItem({ url: 42 })] }),
    JSON.stringify({ results: [deepSeekItem({ snippet: null })] }),
    ' '.repeat(1000001), null,
  ];
  for (const response of [
    ...bodies.map(body => ({ ok: true, status: 200, body })),
    { ...deepSeekResponse(), truncated: true },
  ]) {
    const harness = createHarness({ networkResult: () => response });
    const result = await harness.search({ provider: 'deepseek' });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'RESPONSE_INVALID');
    assert.equal(harness.networkCalls.length, 1);
    assert.equal(harness.cindyRequests.length, 0);
  }
});

test('DeepSeek credentials are declared only for the API host and have a settings row', () => {
  const secret = manifest.network.secrets.find(item => item.key === 'deepseek_api_key');
  assert.deepEqual(secret.inject, {
    header: 'Authorization', format: 'Bearer {value}', hosts: ['api.deepseek.com'],
  });
  assert.equal(secret.url, 'https://platform.deepseek.com/api_keys');
  assert.equal(manifest.network.hosts.includes('platform.deepseek.com'), false);
  assert.match(settingsHtml, /data-key="deepseek_api_key"/);
  assert.match(settingsHtml, /href="https:\/\/platform\.deepseek\.com\/api_keys"/);
  assert.match(settingsHtml, /<option value="deepseek">DeepSeek<\/option>/);
  for (const locale of locales) {
    assert.match(locale.description, /DeepSeek/);
    assert.match(locale.whenToUse, /DeepSeek/);
    assert.match(locale.tools.search_web.description, /128/);
  }
});

test('settings load and persist DeepSeek as the BYO default without losing other preferences', async () => {
  const original = { cindyAiEnabled: false, byoDefaultProvider: 'deepseek', unrelated: 'keep' };
  const harness = createSettingsHarness({ readKv: async () => ({ ok: true, json: async () => original }) });
  await flushAsync();
  assert.equal(harness.byoDefaultProvider.value, 'deepseek');
  harness.byoDefaultProvider.emit('change');
  await flushAsync();
  const write = harness.fetchCalls.find(call => call.init.method === 'PUT');
  assert.deepEqual(JSON.parse(write.init.body), original);
  assert.match(harness.status.textContent, /已保存/);
});

// ── Runtime and settings localization ──────────────────────────────────────

const hostLocales = ['zh-CN', 'en', 'ja', 'ko'];
const placeholdersOf = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const hanRe = /[\u4e00-\u9fff]/;
// Japanese legitimately shares a few kanji words with Chinese.
const sharedWithZh = new Set(['settings.js ja.save']);

function assertParity(messages, label) {
  assert.deepEqual(Object.keys(messages).sort(), [...hostLocales].sort(), `${label} locales`);
  const keys = Object.keys(messages.en).sort();
  for (const locale of hostLocales) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys, `${label} ${locale} keys`);
    for (const key of keys) {
      const text = messages[locale][key];
      assert.equal(typeof text, 'string', `${label} ${locale}.${key}`);
      assert.ok(text.trim(), `${label} ${locale}.${key} is empty`);
      assert.deepEqual(placeholdersOf(text), placeholdersOf(messages.en[key]), `${label} ${locale}.${key} placeholders`);
      if (locale !== 'zh-CN' && locale !== 'ja') {
        assert.doesNotMatch(text, hanRe, `${label} ${locale}.${key} still contains Chinese`);
      }
      if (locale !== 'zh-CN' && !sharedWithZh.has(`${label} ${locale}.${key}`)) {
        assert.notEqual(text, messages['zh-CN'][key], `${label} ${locale}.${key} copied from zh-CN`);
      }
    }
  }
}

test('runtime and settings message tables have identical keys and placeholders in all four locales', () => {
  assertParity(createHarness().messages, 'main.js');
  assertParity(createSettingsHarness().messages, 'settings.js');
});

test('every message key referenced by code or settings.html exists in the tables', () => {
  const mainMessages = createHarness().messages;
  const settingsMessages = createSettingsHarness().messages;
  const mainKeys = [...source.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(mainKeys.length >= 10);
  for (const key of mainKeys) assert.ok(Object.hasOwn(mainMessages.en, key), `main.js ${key}`);
  // Codes deepSeekFailure maps from HTTP status or structured Host errors.
  for (const code of ['NOT_CONFIGURED', 'AUTH_REJECTED', 'PERMISSION_DENIED', 'QUOTA_EXHAUSTED',
    'RATE_LIMITED', 'INVALID_INPUT', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_REJECTED', 'RESPONSE_INVALID']) {
    assert.ok(Object.hasOwn(mainMessages.en, `deepSeek_${code}`), code);
  }
  const settingsKeys = [
    ...settingsSource.matchAll(/\bt\('(\w+)'/g),
    ...settingsHtml.matchAll(/data-(?:i18n(?:-title|-aria-label)?|empty-ph-key)="(\w+)"/g),
  ].map((m) => m[1]);
  assert.ok(settingsKeys.length >= 20);
  for (const key of settingsKeys) assert.ok(Object.hasOwn(settingsMessages.en, key), `settings ${key}`);
  const used = new Set([...settingsKeys, 'emptyPhDefault']);
  for (const key of Object.keys(settingsMessages.en)) assert.ok(used.has(key), `unused settings key ${key}`);
});

test('no hardcoded Chinese copy remains outside comments and the message tables', () => {
  const stripComments = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  // Only the zh-CN and ja tables may contain Han characters (ja shares kanji).
  const cjkTables = /\n {2}(?:'zh-CN'|ja): \{[\s\S]*?\n {2}\},(?=\n)/g;
  for (const [label, text] of [['main.js', source], ['settings.js', settingsSource], ['settings.html', settingsHtml]]) {
    const outside = stripComments(text).replace(cjkTables, '');
    const offenders = outside.split('\n').filter((line) => hanRe.test(line));
    assert.deepEqual(offenders, [], label);
  }
});

test('zh-CN copy is the original Simplified Chinese text, unchanged for Chinese users', () => {
  const main = createHarness().messages['zh-CN'];
  assert.equal(main.cindyUnavailable, 'Cindy AI 搜索服务暂时不可用，请稍后再试');
  assert.equal(main.deepSeek_NOT_CONFIGURED, '请在「插件」→「Web Search」详情页配置 DeepSeek API Key。');
  assert.equal(main.deepSeek_INVALID_INPUT, 'DeepSeek 搜索参数无效，请使用 1–128 个 Unicode 字符的查询后重试。');
  assert.equal(main.prefsUnavailable, '搜索偏好读取失败，请稍后重试或显式选择搜索源');
  const settings = createSettingsHarness().messages['zh-CN'];
  assert.equal(settings.cindyAiTitle, '默认使用 Cindy AI 搜索');
  assert.equal(settings.deepSeekHint, '查询最多 128 个 Unicode 字符。搜索按成功请求计费，使用你的 DeepSeek 账户余额。');
  assert.equal(settings.saveFailedStatus, '保存失败({status}),请重试');
});

test('zh-CN runtime output is byte-identical to the previous hardcoded strings', async () => {
  const brave = createHarness({ networkResult: () => ({ ok: true, status: 500, body: 'oops' }) });
  assert.equal((await brave.search({ provider: 'brave' })).message, 'Brave 返回 HTTP 500:oops');
  const tavily = createHarness({ networkResult: () => ({ ok: true, status: 429, body: 'slow' }) });
  assert.equal((await tavily.search({ provider: 'tavily' })).message, 'Tavily 返回 HTTP 429:slow');
  const ok = createHarness();
  assert.equal((await ok.search()).result.note, '经 cindy 搜索到 1 条结果');
  assert.equal((await ok.search({ query: '' })).message, 'query 不能为空');
  assert.equal((await ok.search({ query: 'x'.repeat(2001) })).message, 'query 过长(上限 2000 字符)');
  assert.equal((await ok.search({ provider: 'bing' })).message, 'provider 只支持 cindy / brave / tavily / deepseek');
  await ok.hostMessage({ type: 'tool-call', tool: 'nope', callId: 'call-2', args: {} });
  assert.equal(ok.toolResults.at(-1).message, '未知工具:nope');
});

test('runtime copy falls back to English for unsupported or unavailable host locales', async () => {
  const english = 'Configure a DeepSeek API Key in "Plugins" > "Web Search" details.';
  const variants = {
    unsupported: { locale: 'fr' },
    legacyTag: { locale: 'zh-TW' },
    notOk: { appContext: () => ({ ok: false }) },
    missingLocale: { appContext: () => ({ ok: true, context: {} }) },
    throws: { appContext: () => { throw new Error('host unavailable'); } },
    noRequestApi: { withoutRequest: true },
    hangs: {
      appContext: () => new Promise(() => {}),
      setTimeout: (fn) => { setImmediate(fn); return 1; },
    },
  };
  for (const [label, options] of Object.entries(variants)) {
    const harness = createHarness({
      ...options,
      networkResult: () => ({ ok: false, errorCode: 'NOT_CONFIGURED', message: 'private-host-detail' }),
    });
    const result = await harness.search({ provider: 'deepseek' });
    assert.equal(result.errorCode, 'NOT_CONFIGURED', label);
    assert.equal(result.message, english, label);
    assert.doesNotMatch(result.message, hanRe, label);
  }
});

test('English runtime copy uses the official plugin name', () => {
  const en = createHarness().messages.en;
  for (const text of Object.values(en)) assert.doesNotMatch(text, /\(Rui\)|ruivalim/i);
  assert.match(en.deepSeek_AUTH_REJECTED, /"Plugins" > "Web Search"/);
});

for (const locale of ['ja', 'ko']) {
  test(`${locale} runtime copy is used for tool results and keeps protocol values intact`, async () => {
    const harness = createHarness({ locale, networkResult: () => deepSeekResponse([deepSeekItem()]) });
    const messages = harness.messages[locale];
    const success = await harness.search({ provider: 'deepseek' });
    assert.equal(success.result.provider, 'deepseek');
    assert.equal(success.result.note, messages.resultNote.replace('{provider}', 'deepseek').replace('{count}', '1'));

    const invalid = await harness.search({ provider: 'deepseek', query: 'a'.repeat(129) });
    assert.equal(invalid.errorCode, 'INVALID_INPUT');
    assert.equal(invalid.message, messages.deepSeek_INVALID_INPUT);
    assert.match(invalid.message, /128/);

    const unknown = createHarness({
      locale,
      networkResult: () => ({ ok: false, errorCode: 'HOST_NETWORK_FAILURE', message: 'private-host-detail' }),
    });
    const fallback = await unknown.search({ provider: 'deepseek' });
    assert.equal(fallback.errorCode, 'HOST_NETWORK_FAILURE');
    assert.equal(fallback.message, messages.deepSeekFallback);
    assert.match(fallback.message, /DeepSeek API/);

    const brave = createHarness({ locale, networkResult: () => ({ ok: true, status: 503, body: 'down' }) });
    const braveResult = await brave.search({ provider: 'brave' });
    assert.ok(braveResult.message.includes('Brave') && braveResult.message.includes('503') && braveResult.message.includes('down'));
    assert.doesNotMatch(braveResult.message, /返回/);

    const cindyDown = createHarness({ locale, cindyError: new Error('Failed to fetch') });
    const cindyResult = await cindyDown.search({ provider: 'cindy' });
    assert.equal(cindyResult.errorCode, 'INTERNAL');
    assert.equal(cindyResult.message, messages.cindyUnavailable);

    const structured = createHarness({
      locale,
      cindyError: Object.assign(new Error('Host localized detail'), { errorCode: 'QUOTA_EXHAUSTED' }),
    });
    const structuredResult = await structured.search({ provider: 'cindy' });
    assert.equal(structuredResult.errorCode, 'QUOTA_EXHAUSTED');
    assert.equal(structuredResult.message, 'Host localized detail');
  });
}

test('host-context-changed switches runtime copy without another app-context request', async () => {
  const harness = createHarness({
    locale: 'zh-CN',
    networkResult: () => ({ ok: false, errorCode: 'QUOTA_EXHAUSTED', message: 'private-host-detail' }),
  });
  assert.match((await harness.search({ provider: 'deepseek' })).message, /充值/);
  assert.equal(harness.appContextRequests.length, 1);

  await harness.hostMessage({ type: 'host-context-changed', context: { region: 'global', locale: 'ko' } });
  assert.equal((await harness.search({ provider: 'deepseek' })).message, harness.messages.ko.deepSeek_QUOTA_EXHAUSTED);
  await harness.hostMessage({ type: 'host-context-changed', context: { locale: 'ja' } });
  assert.equal((await harness.search({ provider: 'deepseek' })).message, harness.messages.ja.deepSeek_QUOTA_EXHAUSTED);
  await harness.hostMessage({ type: 'host-context-changed', context: { locale: 'xx' } });
  assert.equal((await harness.search({ provider: 'deepseek' })).message, harness.messages.en.deepSeek_QUOTA_EXHAUSTED);
  await harness.hostMessage({ type: 'host-context-changed' });
  assert.equal((await harness.search({ provider: 'deepseek' })).message, harness.messages.en.deepSeek_QUOTA_EXHAUSTED);
  assert.equal(harness.appContextRequests.length, 1);
  assert.equal(harness.toolResults.length, 5);
});

test('a locale change that arrives during the app-context request wins over the stale reply', async () => {
  const pending = deferred();
  const harness = createHarness({
    appContext: () => pending.promise,
    networkResult: () => ({ ok: false, errorCode: 'RATE_LIMITED', message: 'private-host-detail' }),
  });
  const searching = harness.search({ provider: 'deepseek' });
  await flushAsync();
  await harness.hostMessage({ type: 'host-context-changed', context: { locale: 'ja' } });
  pending.resolve({ ok: true, context: { locale: 'zh-CN' } });
  assert.equal((await searching).message, harness.messages.ja.deepSeek_RATE_LIMITED);
  assert.equal((await harness.search({ provider: 'deepseek' })).message, harness.messages.ja.deepSeek_RATE_LIMITED);
});

test('concurrent tool calls share one app-context request and all use the host locale', async () => {
  const pending = deferred();
  const harness = createHarness({
    appContext: () => pending.promise,
    networkResult: () => ({ ok: false, errorCode: 'AUTH_REJECTED', message: 'private-host-detail' }),
  });
  const calls = [1, 2, 3].map((n) => harness.hostMessage({
    type: 'tool-call', tool: 'search_web', callId: `call-${n}`, args: { query: 'Cindy', provider: 'deepseek' },
  }));
  await flushAsync();
  assert.equal(harness.appContextRequests.length, 1);
  assert.equal(harness.networkCalls.length, 0, 'no search before the locale is known');
  pending.resolve({ ok: true, context: { locale: 'ko' } });
  await Promise.all(calls);
  assert.equal(harness.toolResults.length, 3);
  for (const result of harness.toolResults) {
    assert.equal(result.message, harness.messages.ko.deepSeek_AUTH_REJECTED);
  }
});

test('a failed app-context lookup is retried on the next call instead of pinning English', async () => {
  let attempts = 0;
  const harness = createHarness({
    appContext: () => {
      attempts += 1;
      if (attempts === 1) throw new Error('host busy');
      return { ok: true, context: { locale: 'zh-CN' } };
    },
    networkResult: () => ({ ok: false, errorCode: 'QUOTA_EXHAUSTED', message: 'private-host-detail' }),
  });
  assert.equal((await harness.search({ provider: 'deepseek' })).message, harness.messages.en.deepSeek_QUOTA_EXHAUSTED);
  assert.match((await harness.search({ provider: 'deepseek' })).message, /充值/);
  assert.match((await harness.search({ provider: 'deepseek' })).message, /充值/);
  assert.equal(attempts, 2);
});

function copyNode(attribute, key) {
  const attributes = new Map([[attribute, key]]);
  return {
    textContent: '',
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

function settingsCopyNodes() {
  const nodes = {};
  for (const attribute of ['data-i18n', 'data-i18n-title', 'data-i18n-aria-label']) {
    const re = new RegExp(`\\s${attribute}="(\\w+)"`, 'g');
    nodes[attribute] = [...settingsHtml.matchAll(re)].map((m) => copyNode(attribute, m[1]));
  }
  return nodes;
}

for (const locale of hostLocales) {
  test(`settings page renders ${locale} copy from /app-context`, async () => {
    const copyNodes = settingsCopyNodes();
    const harness = createSettingsHarness({
      locale,
      copyNodes,
      readKv: async () => { throw new Error('kv unavailable'); },
    });
    await flushAsync();
    const messages = harness.messages[locale];
    assert.equal(harness.document.documentElement.lang, locale);
    assert.ok(copyNodes['data-i18n'].length >= 15);
    for (const node of copyNodes['data-i18n']) {
      assert.equal(node.textContent, messages[node.getAttribute('data-i18n')]);
    }
    for (const node of copyNodes['data-i18n-title']) {
      assert.equal(node.getAttribute('title'), messages.toggleVisibility);
    }
    assert.equal(copyNodes['data-i18n-aria-label'].length, 1);
    assert.equal(copyNodes['data-i18n-aria-label'][0].getAttribute('aria-label'), messages.cindyAiAria);
    assert.equal(harness.status.textContent, messages.prefsLoadFailed);
    assert.equal(harness.fetchCalls[0].url, '/app-context', 'locale is resolved before any status copy');
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
    const harness = createSettingsHarness({
      appContext,
      readKv: async () => { throw new Error('kv unavailable'); },
    });
    await flushAsync();
    assert.equal(harness.document.documentElement.lang, 'en');
    assert.equal(harness.status.textContent, 'Failed to load search preferences. Please reopen the settings page.');
  }
});

test('settings secret rows localize placeholders and status in the host locale', async () => {
  function element() {
    const listeners = new Map();
    return {
      value: '', type: 'password', placeholder: '', className: '',
      classList: { toggle() {}, remove() {} },
      addEventListener(type, listener) { listeners.set(type, listener); },
      click() { return listeners.get('click')(); },
    };
  }
  function row(dataKey, emptyKey, tailPrefix) {
    const parts = { '.key-input': element(), '.eye': element(), '.badge': element(), '.save': element(), '.clear': element() };
    const attrs = { 'data-key': dataKey, 'data-empty-ph-key': emptyKey, 'data-tail-prefix': tailPrefix };
    return { parts, getAttribute: (name) => attrs[name] ?? null, querySelector: (sel) => parts[sel] };
  }
  for (const locale of ['ko', 'en']) {
    const brave = row('brave_api_key', 'emptyPhBrave', 'BSA…');
    const deepseek = row('deepseek_api_key', 'emptyPhDeepSeek', '…');
    const harness = createSettingsHarness({ locale, secretNodes: [brave, deepseek] });
    await flushAsync();
    const messages = harness.messages[locale];
    assert.equal(brave.parts['.key-input'].placeholder, messages.emptyPhBrave);
    assert.equal(deepseek.parts['.key-input'].placeholder, messages.emptyPhDeepSeek);
    brave.parts['.save'].click();
    assert.equal(harness.status.textContent, messages.pasteFirst);
  }
  // Every row in the real page names a key that exists in the table.
  const rowKeys = [...settingsHtml.matchAll(/data-empty-ph-key="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(rowKeys, ['emptyPhBrave', 'emptyPhTavily', 'emptyPhDeepSeek']);
});

test('settings.html ships no hardcoded copy before the host locale is known', () => {
  const body = settingsHtml.slice(settingsHtml.indexOf('<body>'));
  assert.doesNotMatch(body.replace(/<!--[\s\S]*?-->/g, ''), hanRe);
  assert.doesNotMatch(settingsHtml, /data-empty-ph="/);
});
