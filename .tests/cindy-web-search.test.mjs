import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'cindy-web-search');
const source = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');

async function invoke(args, fetchImpl) {
  let hostHandler = null;
  let result = null;
  const requests = [];
  const context = {
    cindy: {
      async fetch(request) {
        requests.push(request);
        return fetchImpl(request, requests.length - 1);
      },
      onHostMessage(handler) {
        hostHandler = handler;
      },
      send(message) {
        result = message;
      },
    },
  };

  vm.runInNewContext(source, context, { filename: 'main.js' });
  assert.equal(typeof hostHandler, 'function');
  await hostHandler({ type: 'tool-call', tool: 'search_web', callId: 'test-call', args });
  return { requests, result };
}

test('Search1API request keeps the shared tool contract and maps link to url', async () => {
  const { requests, result } = await invoke(
    { query: 'cindy plugins', provider: 'search1api', limit: 3 },
    async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        results: [{ title: 'Cindy', link: 'https://example.test/cindy', snippet: 'Plugin docs' }],
      }),
    }),
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.search1api.com/search');
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].body), {
    query: 'cindy plugins',
    max_results: 3,
    crawl_results: 0,
  });
  assert.equal(requests[0].headers.Authorization, undefined, 'credential must be host-injected');
  assert.equal(JSON.parse(requests[0].body).search_service, undefined, 'use Search1API default source selection');
  assert.deepEqual(JSON.parse(JSON.stringify(result.result.results)), [
    { title: 'Cindy', url: 'https://example.test/cindy', snippet: 'Plugin docs' },
  ]);
  assert.equal(result.result.provider, 'search1api');
});

test('missing Brave and Tavily keys fall back to Search1API', async () => {
  const { requests, result } = await invoke({ query: 'fallback', limit: 2 }, async (_request, index) => {
    if (index < 2) return { ok: false, message: '凭证尚未配置，请前往插件详情页填写' };
    return { ok: true, status: 200, body: JSON.stringify({ results: [] }) };
  });

  assert.deepEqual(requests.map((request) => new URL(request.url).hostname), [
    'api.search.brave.com',
    'api.tavily.com',
    'api.search1api.com',
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.result.provider, 'search1api');
});

test('missing all search keys returns provider-neutral setup guidance', async () => {
  const { requests, result } = await invoke(
    { query: 'missing keys' },
    async () => ({ ok: false, message: '凭证尚未配置，请前往插件详情页填写' }),
  );

  assert.equal(requests.length, 3);
  assert.equal(result.ok, false);
  assert.match(result.message, /Web Search 插件详情页/);
  assert.match(result.message, /Brave、Tavily 或 Search1API/);
});

test('Search1API documented no-results 404 is a successful empty search', async () => {
  const { result } = await invoke(
    { query: 'no results', provider: 'search1api' },
    async () => ({ ok: true, status: 404, body: '{"message":"not found"}' }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.result.provider, 'search1api');
  assert.equal(result.result.results.length, 0);
});

for (const [status, expected] of [
  [401, /插件详情页.*Key/],
  [402, /付款或补充 credits.*控制台/],
  [403, /账号权限或套餐/],
  [429, /稍后再试/],
  [409, /账号状态.*支持/],
  [302, /无法处理.*支持/],
  [500, /服务暂时不可用/],
]) {
  test(`Search1API ${status} returns an actionable error`, async () => {
    const { result } = await invoke(
      { query: 'error', provider: 'search1api' },
      async () => ({ ok: true, status, body: '{"message":"upstream"}' }),
    );

    assert.equal(result.ok, false);
    assert.match(result.message, expected);
    assert.doesNotMatch(result.message, /upstream/);
    assert.doesNotMatch(result.message, /HTTP\s*\d{3}|\(\d{3}\)/);
  });
}

test('Search1API malformed and unexpected responses fail without leaking raw bodies', async (t) => {
  await t.test('malformed JSON', async () => {
    const { result } = await invoke(
      { query: 'bad json', provider: 'search1api' },
      async () => ({ ok: true, status: 200, body: '<html>upstream secret detail</html>' }),
    );
    assert.equal(result.ok, false);
    assert.match(result.message, /无法解析/);
    assert.doesNotMatch(result.message, /secret detail/);
  });

  await t.test('missing results array', async () => {
    const { result } = await invoke(
      { query: 'bad shape', provider: 'search1api' },
      async () => ({ ok: true, status: 200, body: '{"results":null}' }),
    );
    assert.equal(result.ok, false);
    assert.match(result.message, /结果格式不符合预期/);
  });
});

test('manifest uses minimal Search1API host injection and the settings link matches exactly', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'ghost.json'), 'utf8'));
  const settingsHtml = fs.readFileSync(path.join(pluginDir, 'settings.html'), 'utf8');
  const secret = manifest.network.secrets.find((item) => item.key === 'search1api_api_key');

  assert.deepEqual(secret.inject, {
    header: 'Authorization',
    format: 'Bearer {value}',
    hosts: ['api.search1api.com'],
  });
  assert.ok(manifest.network.hosts.includes('api.search1api.com'));
  assert.ok(settingsHtml.includes(`href="${secret.url}"`));
});
