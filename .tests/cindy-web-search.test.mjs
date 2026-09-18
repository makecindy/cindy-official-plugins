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

function createHarness(options = {}) {
  const kv = options.kv ?? {};
  const networkCalls = [];
  const cindyRequests = [];
  const toolResults = [];
  let handler = null;

  const cindy = {
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

  vm.runInNewContext(source, {
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
  });
  assert.equal(typeof handler, 'function');

  return {
    networkCalls,
    cindyRequests,
    toolResults,
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
  const document = {
    getElementById(id) {
      return elements.get(id);
    },
    querySelectorAll(selector) {
      assert.equal(selector, '.secret');
      return [];
    },
  };

  vm.runInNewContext(settingsSource, {
    document,
    fetch: async (url, init = {}) => {
      fetchCalls.push({ url, init });
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
  });

  return {
    cindyAiEnabled,
    byoDefaultProvider,
    status,
    fetchCalls,
  };
}

test('manifest declares Cindy Web Search and keeps BYO providers explicit', () => {
  assert.equal(manifest.version, '1.4.0');
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.minCindyVersion, '0.1.64');
  assert.equal(Object.hasOwn(manifest, 'slots'), false);
  assert.deepEqual(manifest.cindy, { search: ['web'] });
  assert.deepEqual(manifest.setup, { requires: [] });
  const provider = manifest.tools[0].parameters.properties.provider;
  assert.deepEqual(provider.enum, ['cindy', 'brave', 'tavily', 'search1api']);
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
});

test('manifest scopes the Search1API credential to its own host only', () => {
  const secret = manifest.network.secrets.find((item) => item.key === 'search1api_api_key');
  assert.ok(secret);
  assert.deepEqual(secret.inject, {
    header: 'Authorization',
    format: 'Bearer {value}',
    hosts: ['api.search1api.com'],
  });
  assert.ok(manifest.network.hosts.includes('api.search1api.com'));
  assert.equal(manifest.network.hosts.includes('dashboard.search1api.com'), false);
  assert.ok(settingsHtml.includes(`href="${secret.url}"`));
  assert.match(settingsHtml, /<option value="search1api">/);
});

test('Search1API keeps the shared tool contract and maps link to url', async () => {
  const harness = createHarness({
    kvFetch: async () => {
      throw new Error('explicit provider must not read kv');
    },
    networkResult(request) {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          results: [
            {
              title: 'Search1API',
              link: 'https://example.test/search1api',
              snippet: 'BYO result',
            },
          ],
        }),
      };
    },
  });
  const result = await harness.search({ provider: 'search1api', limit: 3 });

  assert.equal(harness.cindyRequests.length, 0);
  assert.equal(harness.networkCalls.length, 1);
  const request = harness.networkCalls[0];
  assert.equal(request.url, 'https://api.search1api.com/search');
  assert.equal(request.method, 'POST');
  // 凭证由主机按声明注入，插件自己不得写 Authorization。
  assert.equal(request.headers.Authorization, undefined);
  const body = JSON.parse(request.body);
  assert.equal(body.query, 'Cindy');
  assert.equal(body.max_results, 3);
  assert.equal(body.crawl_results, 0);
  assert.equal(body.search_service, undefined);
  assert.equal(result.ok, true);
  assert.equal(result.result.provider, 'search1api');
  assert.equal(result.result.results.length, 1);
  assert.equal(result.result.results[0].title, 'Search1API');
  assert.equal(result.result.results[0].url, 'https://example.test/search1api');
  assert.equal(result.result.results[0].snippet, 'BYO result');
});

test('disabled Cindy AI honours Search1API as the BYO default', async () => {
  const harness = createHarness({
    kv: { cindyAiEnabled: false, byoDefaultProvider: 'search1api' },
    networkResult() {
      return { ok: true, status: 200, body: JSON.stringify({ results: [] }) };
    },
  });
  const result = await harness.search();

  assert.equal(harness.cindyRequests.length, 0);
  assert.equal(harness.networkCalls[0].url, 'https://api.search1api.com/search');
  assert.equal(result.result.provider, 'search1api');
});

test('Search1API zero results arrive as an empty 200 result set', async () => {
  const harness = createHarness({
    networkResult() {
      return { ok: true, status: 200, body: JSON.stringify({ results: [] }) };
    },
  });
  const result = await harness.search({ provider: 'search1api' });

  assert.equal(result.ok, true);
  assert.equal(result.result.provider, 'search1api');
  assert.equal(result.result.results.length, 0);
});

for (const status of [400, 401, 402, 403, 404, 409, 422, 429, 500, 502, 503, 302]) {
  test(`Search1API ${status} returns an actionable error without a raw status code`, async () => {
    const harness = createHarness({
      networkResult() {
        return { ok: true, status, body: 'upstream secret detail' };
      },
    });
    const result = await harness.search({ provider: 'search1api' });

    assert.equal(result.ok, false);
    assert.match(result.message, /Search1API/);
    assert.doesNotMatch(result.message, /HTTP\s*\d{3}|\(\d{3}\)/);
    assert.doesNotMatch(result.message, /upstream/);
    assert.doesNotMatch(result.message, /secret detail/);
  });
}

test('Search1API transport failures return an actionable network error', async () => {
  const thrown = createHarness({
    networkResult() {
      throw new Error('getaddrinfo ENOTFOUND api.search1api.com');
    },
  });
  const thrownResult = await thrown.search({ provider: 'search1api' });
  assert.equal(thrownResult.ok, false);
  assert.match(thrownResult.message, /Search1API/);
  assert.doesNotMatch(thrownResult.message, /ENOTFOUND|搜索失败/);

  const network = createHarness({
    networkResult() {
      return { ok: false, errorCode: 'NETWORK_UNREACHABLE', message: 'connect ETIMEDOUT 1.2.3.4:443' };
    },
  });
  const networkResult = await network.search({ provider: 'search1api' });
  assert.equal(networkResult.ok, false);
  assert.match(networkResult.message, /检查网络/);
  assert.doesNotMatch(networkResult.message, /ETIMEDOUT|1\.2\.3\.4/);
});

test('Search1API host credential failures point at the key, not the network', async () => {
  const harness = createHarness({
    networkResult() {
      return { ok: false, errorCode: 'SECRET_MISSING', message: 'secret search1api_api_key is not configured' };
    },
  });
  const result = await harness.search({ provider: 'search1api' });

  assert.equal(result.ok, false);
  assert.match(result.message, /Key/);
  assert.match(result.message, /插件详情页/);
  assert.doesNotMatch(result.message, /检查网络/);
  assert.doesNotMatch(result.message, /search1api_api_key/);
});

test('Search1API unclassifiable host failures give both remedies and leak no diagnostics', async () => {
  const harness = createHarness({
    networkResult() {
      return { ok: false, message: 'HostFetchError: proxy pipeline aborted (trace 0xdeadbeef)' };
    },
  });
  const result = await harness.search({ provider: 'search1api' });

  assert.equal(result.ok, false);
  assert.match(result.message, /Key/);
  assert.match(result.message, /网络/);
  assert.doesNotMatch(result.message, /HostFetchError|proxy pipeline|0xdeadbeef|搜索失败/);
});

test('Search1API malformed responses fail without leaking raw bodies', async () => {
  const badJson = createHarness({
    networkResult() {
      return { ok: true, status: 200, body: 'upstream secret detail' };
    },
  });
  const badJsonResult = await badJson.search({ provider: 'search1api' });
  assert.equal(badJsonResult.ok, false);
  assert.doesNotMatch(badJsonResult.message, /upstream/);

  const badShape = createHarness({
    networkResult() {
      return { ok: true, status: 200, body: JSON.stringify({ results: 'nope' }) };
    },
  });
  const badShapeResult = await badShape.search({ provider: 'search1api' });
  assert.equal(badShapeResult.ok, false);
  assert.doesNotMatch(badShapeResult.message, /nope/);
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
