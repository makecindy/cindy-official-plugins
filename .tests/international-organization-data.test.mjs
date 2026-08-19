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
  ]);
  assert.equal(manifest.network.secrets.length, 1);
  assert.equal(manifest.network.secrets[0].key, 'faostat_api_token');
  assert.equal(manifest.network.secrets[0].inject.hosts[0], 'faostatservices.fao.org');
  assert.equal(manifest.tools.length, 3);
  assert.equal(manifest.version, '0.1.1');
  assert.equal(manifest.tools[1].parameters.properties.countries.maxItems, 25);
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
    assert.ok(requestedUrls.every((url) => url.includes("Dim1 eq 'SEX_BTSX'")));
    assert.ok(requestedUrls.every((url) => url.includes('(NumericValue ne null or Value ne null)')));
    assert.equal(requestedUrls.filter((url) => url.includes("SpatialDim eq 'CHN'")).length, 1);
    assert.equal(requestedUrls.filter((url) => url.includes("SpatialDim eq 'USA'")).length, 1);
    assert.equal(Object.hasOwn(result.result.rows[0], 'unit'), false);
    assert.equal(result.result.rows[0].dimensionType, 'SEX');
  });
});

test('WHO recent queries do not let empty newer observations consume the result', async () => {
  const runtime = loadRuntime(async () => ({
    ok: true,
    status: 200,
    body: JSON.stringify({
      value: [
        {
          IndicatorCode: 'WHOSIS_000001', SpatialDim: 'CHN', TimeDim: 2022,
          NumericValue: null, Value: null, Dim1Type: 'SEX', Dim1: 'SEX_BTSX',
        },
        {
          IndicatorCode: 'WHOSIS_000001', SpatialDim: 'CHN', TimeDim: 2021,
          NumericValue: 77.6, Value: '77.6', Dim1Type: 'SEX', Dim1: 'SEX_BTSX',
        },
      ],
    }),
  }));

  const result = await runtime.call('who_health_data', {
    indicator: 'life_expectancy',
    countries: ['CHN'],
    recent: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.rows.length, 1);
  assert.equal(result.result.rows[0].year, 2021);
  assert.equal(result.result.rows[0].value, 77.6);
});

test('WHO rejects country lists above the declared limit instead of truncating them', async () => {
  let fetchCalls = 0;
  const runtime = loadRuntime(async () => {
    fetchCalls += 1;
    throw new Error('fetch should not run');
  });
  const countries = Array.from({ length: 26 }, (_, index) => `C${String(index).padStart(2, '0')}`);
  const result = await runtime.call('who_health_data', {
    indicator: 'life_expectancy',
    countries,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /最多支持 25 个国家/);
  assert.match(result.message, /拆分为多次查询/);
  assert.equal(fetchCalls, 0);
});

test('WHO year-range queries are ordered and disclose server-side truncation', async () => {
  let requestedUrl = '';
  const runtime = loadRuntime(async ({ url }) => {
    requestedUrl = decodeURIComponent(url);
    return {
      ok: true,
      status: 200,
      body: JSON.stringify({
        '@odata.count': 392,
        value: [
          { IndicatorCode: 'WHOSIS_000001', SpatialDim: 'CHN', TimeDim: 2021, NumericValue: 77.6, Value: '77.6' },
          { IndicatorCode: 'WHOSIS_000001', SpatialDim: 'USA', TimeDim: 2021, NumericValue: 76.4, Value: '76.4' },
        ],
      }),
    };
  });
  const result = await runtime.call('who_health_data', {
    indicator: 'life_expectancy',
    startYear: 2020,
    endYear: 2021,
    limit: 2,
  });
  assert.equal(result.ok, true);
  assert.match(requestedUrl, /\$orderby=TimeDim desc/);
  assert.match(requestedUrl, /\$count=true/);
  assert.equal(result.result.responseTruncated, true);
  assert.equal(result.result.totalMatched, 392);
  assert.equal(result.result.recordsAvailableInPage, 2);
  assert.equal(result.result.recordsReturned, 2);
  assert.match(result.result.hint, /缩小年份范围/);
});

test('settings page follows the host locale with an English fallback', () => {
  const html = fs.readFileSync(path.join(root, 'settings.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
  assert.match(html, /data-i18n="tokenTitle"/);
  assert.match(html, /data-i18n-placeholder="tokenPlaceholder"/);
  assert.match(source, /fetch\('\/app-context'/);
  for (const locale of ['en', 'zh-CN', 'ja', 'ko']) {
    assert.ok(source.includes(locale));
  }
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
