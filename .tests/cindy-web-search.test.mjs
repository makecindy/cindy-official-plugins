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
    URL,
  });
  assert.equal(typeof handler, 'function');

  return {
    networkCalls,
    cindyRequests,
    toolResults,
    async tool(tool, args = {}) {
      await handler({
        type: 'tool-call',
        tool,
        callId: 'call-1',
        args,
      });
      return toolResults.at(-1);
    },
    async search(args = {}) {
      return this.tool('search_web', { query: 'Cindy', ...args });
    },
    async fetchPage(args = {}) {
      return this.tool('fetch_page', { url: 'https://example.test/article', ...args });
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
  assert.equal(manifest.minCindyVersion, '0.1.37');
  assert.deepEqual(manifest.cindy, { search: ['web'] });
  assert.ok(manifest.slots.includes('cindy'));
  assert.deepEqual(manifest.setup, { requires: [] });
  const searchTool = manifest.tools.find((tool) => tool.name === 'search_web');
  const fetchTool = manifest.tools.find((tool) => tool.name === 'fetch_page');
  assert.ok(searchTool);
  assert.ok(fetchTool);
  const provider = searchTool.parameters.properties.provider;
  assert.deepEqual(provider.enum, ['cindy', 'brave', 'tavily']);
  assert.equal(provider.enum.includes('auto'), false);
  const query = searchTool.parameters.properties.query;
  assert.equal(query.maxLength, 2000);
  assert.match(searchTool.description, /2000/);
  assert.match(query.description, /2000/);
  assert.equal(fetchTool.parameters.properties.url.maxLength, 2048);
  assert.deepEqual(fetchTool.parameters.properties.extract_depth.enum, ['basic', 'advanced']);
  assert.match(fetchTool.description, /50000/);
  assert.match(fetchTool.description, /不可信/);
  assert.match(fetchTool.description, /响应过大/);
  for (const locale of locales) {
    assert.match(locale.tools.search_web.description, /2000/);
    assert.match(locale.tools.fetch_page.description, /50000/);
  }
});

test('fetch_page calls Tavily Extract without handling credentials in the sandbox', async () => {
  const harness = createHarness({
    networkResult(request) {
      assert.equal(request.url, 'https://api.tavily.com/extract');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers['Content-Type'], 'application/json');
      assert.equal(request.headers.Accept, 'application/json');
      assert.equal(request.timeoutMs, 55000);
      assert.equal(request.callId, 'call-1');
      assert.equal('Authorization' in request.headers, false);
      assert.deepEqual(JSON.parse(request.body), {
        urls: 'https://example.test/article',
        extract_depth: 'basic',
        include_images: false,
        include_favicon: false,
        format: 'markdown',
        timeout: 20,
      });
      return {
        ok: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          results: [{ url: 'https://example.test/article', raw_content: '# Article\n\nBody' }],
          failed_results: [],
        }),
      };
    },
  });

  const result = await harness.fetchPage();

  assert.equal(harness.networkCalls.length, 1);
  assert.equal(harness.cindyRequests.length, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.result)), {
    provider: 'tavily',
    url: 'https://example.test/article',
    content: '# Article\n\nBody',
    format: 'markdown',
    extract_depth: 'basic',
    content_chars: 15,
    truncated: false,
    content_is_untrusted: true,
  });
});

test('fetch_page supports advanced extraction and marks content truncation explicitly', async () => {
  const content = 'x'.repeat(50001);
  const harness = createHarness({
    networkResult(request) {
      const body = JSON.parse(request.body);
      assert.equal(body.extract_depth, 'advanced');
      assert.equal(body.timeout, 45);
      return {
        ok: true,
        status: 200,
        headers: {},
        body: JSON.stringify({
          results: [{ url: 'https://example.test/dynamic', raw_content: content }],
          failed_results: [],
        }),
      };
    },
  });

  const result = await harness.fetchPage({
    url: 'https://example.test/dynamic',
    extract_depth: 'advanced',
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.extract_depth, 'advanced');
  assert.equal(result.result.content.length, 50000);
  assert.equal(result.result.content_chars, 50001);
  assert.equal(result.result.truncated, true);
});

test('fetch_page rejects invalid URLs before any network request', async (t) => {
  const invalidUrls = [
    '',
    '/relative',
    'file:///etc/passwd',
    'ftp://example.test/file',
    'https://user:pass@example.test/',
    'https:\\example.test\\article',
    ' https://example.test/article',
    'http://localhost/admin',
    'http://127.0.0.1/admin',
    'http://10.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/admin',
    'http://[::1]/admin',
    'http://[fd00::1]/admin',
    'http://[::ffff:127.0.0.1]/admin',
    `https://example.test/${'x'.repeat(2048)}`,
  ];
  for (const url of invalidUrls) {
    await t.test(JSON.stringify(url).slice(0, 80), async () => {
      const harness = createHarness();
      const result = await harness.fetchPage({ url });
      assert.equal(result.ok, false);
      assert.match(result.message, /HTTP\(S\)/);
      assert.equal(harness.networkCalls.length, 0);
    });
  }
});

test('fetch_page returns actionable errors without exposing upstream response bodies', async (t) => {
  const cases = [
    [401, /API Key/],
    [403, /权限|账户/],
    [429, /频繁|限流/],
    [432, /额度|账户/],
    [433, /额度|账户/],
    [500, /暂时不可用/],
  ];
  for (const [status, expected] of cases) {
    await t.test(String(status), async () => {
      const harness = createHarness({
        networkResult() {
          return {
            ok: true,
            status,
            headers: {},
            body: 'sensitive upstream response',
          };
        },
      });
      const result = await harness.fetchPage();
      assert.equal(result.ok, false);
      assert.match(result.message, expected);
      assert.doesNotMatch(result.message, /sensitive/);
    });
  }
});

test('fetch_page fails closed on transport and malformed provider responses', async (t) => {
  const cases = [
    {
      name: 'missing key',
      response: { ok: false, message: 'secret not configured: sensitive-name' },
      expected: /API Key 未配置/,
    },
    {
      name: 'host truncation',
      response: { ok: true, status: 200, headers: {}, body: '{', truncated: true },
      expected: /数据过大/,
    },
    {
      name: 'oversized response',
      response: { ok: true, status: 200, headers: {}, body: 'x'.repeat(1000001) },
      expected: /数据过大/,
    },
    {
      name: 'invalid json',
      response: { ok: true, status: 200, headers: {}, body: '<html>upstream</html>' },
      expected: /无法解析/,
    },
    {
      name: 'failed result',
      response: {
        ok: true,
        status: 200,
        headers: {},
        body: JSON.stringify({ results: [], failed_results: [{ url: 'https://example.test/article' }] }),
      },
      expected: /无法读取/,
    },
    {
      name: 'unsafe result url',
      response: {
        ok: true,
        status: 200,
        headers: {},
        body: JSON.stringify({
          results: [{ url: 'file:///etc/passwd', raw_content: 'bad' }],
          failed_results: [],
        }),
      },
      expected: /格式异常/,
    },
    {
      name: 'empty content',
      response: {
        ok: true,
        status: 200,
        headers: {},
        body: JSON.stringify({
          results: [{ url: 'https://example.test/article', raw_content: '   ' }],
          failed_results: [],
        }),
      },
      expected: /没有可读取/,
    },
  ];
  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const harness = createHarness({ networkResult: () => testCase.response });
      const result = await harness.fetchPage();
      assert.equal(result.ok, false);
      assert.match(result.message, testCase.expected);
      assert.doesNotMatch(result.message, /sensitive-name|upstream/);
    });
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
