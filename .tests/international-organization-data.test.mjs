import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('international-organization-data');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ghost.json'), 'utf8'));

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
