import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve('international-organization-data');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ghost.json'), 'utf8'));
const runtimeSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function loadRuntime(fetchImpl) {
  let handler;
  const messages = [];
  vm.runInNewContext(runtimeSource, {
    isFinite,
    encodeURIComponent,
    String,
    Math,
    JSON,
    Date,
    Promise,
    setTimeout,
    cindy: {
      onHostMessage(callback) {
        handler = callback;
      },
      send(message) {
        messages.push(message);
      },
      fetch: fetchImpl,
    },
  });
  return {
    async call(tool, args) {
      messages.length = 0;
      await handler({ type: 'tool-call', callId: tool, tool, args });
      return messages[0];
    },
  };
}

test('international organization data manifest is read-only and allowlisted', () => {
  assert.equal(manifest.id, 'international-organization-data');
  assert.deepEqual(manifest.slots, ['tool', 'network']);
  assert.deepEqual(manifest.network.hosts, [
    'ghoapi.azureedge.net',
    'faostatservices.fao.org',
    'www.fao.org',
  ]);
  assert.equal(manifest.network.secrets.length, 1);
  assert.equal(manifest.network.secrets[0].key, 'faostat_api_token');
  assert.equal(manifest.network.secrets[0].inject.hosts[0], 'faostatservices.fao.org');
  assert.equal(manifest.tools.length, 3);
  assert.ok(manifest.tools.every((tool) => !/send|delete|write|update|create/i.test(tool.description)));
});

test('international organization data includes all four locale resources', () => {
  for (const locale of ['en', 'zh-CN', 'ja', 'ko']) {
    const file = path.join(root, 'locales', `${locale}.json`);
    const resource = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(resource.name.length > 0, true);
    for (const tool of ['international_org_catalog', 'who_health_data', 'fao_agriculture_data']) {
      assert.equal(typeof resource.tools[tool].description, 'string');
      assert.ok(resource.tools[tool].description.length > 20);
    }
  }
});

test('international organization data does not contain credentials or arbitrary network calls', () => {
  const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.equal(source.includes('globalThis.fetch'), false);
  assert.equal(source.includes('window.fetch'), false);
  assert.equal(source.includes('process.env'), false);
  assert.equal(source.includes('FAO_TOKEN'), false);
  assert.equal(source.includes('Authorization'), true);
  assert.equal(source.includes('ghoapi.azureedge.net'), true);
  assert.equal(source.includes('faostatservices.fao.org'), true);
});

test('WHO recent queries are ordered and scoped per country', () => {
  const requestedUrls = [];
  const runtime = loadRuntime(async ({ url }) => {
    requestedUrls.push(decodeURIComponent(url));
    const country = url.includes('CHN') ? 'CHN' : 'USA';
    return {
      ok: true,
      status: 200,
      body: JSON.stringify({
        value: [{
          IndicatorCode: 'WHOSIS_000001',
          SpatialDim: country,
          TimeDim: 2021,
          NumericValue: country === 'CHN' ? 77.6 : 76.4,
          Value: country === 'CHN' ? '77.6' : '76.4',
          Dim1Type: 'SEX',
          Dim1: 'SEX_BTSX',
        }],
      }),
    };
  });

  return runtime.call('who_health_data', {
    indicator: 'life_expectancy',
    countries: ['CHN', 'USA'],
    recent: 1,
    limit: 1,
  }).then((result) => {
    assert.equal(result.ok, true);
    assert.deepEqual(
      Array.from(result.result.rows, (row) => row.country),
      ['CHN', 'USA'],
    );
    assert.equal(requestedUrls.length, 2);
    assert.ok(requestedUrls.every((url) => url.includes('$orderby=TimeDim desc')));
    assert.equal(requestedUrls.filter((url) => url.includes("SpatialDim eq 'CHN'")).length, 1);
    assert.equal(requestedUrls.filter((url) => url.includes("SpatialDim eq 'USA'")).length, 1);
  });
});

test('FAOSTAT auth failures have actionable guidance', async () => {
  const runtime = loadRuntime(async () => ({
    ok: false,
    status: 403,
    body: '{"message":"Forbidden"}',
    message: 'HTTP 403',
  }));
  const result = await runtime.call('fao_agriculture_data', {
    domainCode: 'QCL',
    area: '351',
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /HTTP 403/);
  assert.match(result.message, /检查 Token 是否有效、权限是否已开通/);
});
