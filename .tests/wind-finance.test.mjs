import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

const loadPlugin = () => {
  globalThis.cindy = {
    onHostMessage() {},
    fetch: async () => ({ ok: true, status: 200, body: '{}' }),
    send: async () => ({ ok: true }),
  };
  return require('../wind-finance/main.js');
};

test('Wind Finance validates connection selection and bounded lists', () => {
  const plugin = loadPlugin();
  assert.deepEqual(
    plugin.resolveRequestedConnection(
      [
        { id: 'one', host: 'wind.example.com', isDefault: true },
        { id: 'two', host: 'other.example.com', isDefault: false },
      ],
      'other.example.com',
    ),
    { id: 'two', host: 'other.example.com', isDefault: false },
  );
  assert.equal(
    plugin.resolveRequestedConnection(
      [{ id: 'one', host: 'wind.example.com', isDefault: true }],
      'missing.example.com',
    ).err,
    '找不到指定的万得 API 连接:missing.example.com',
  );
  assert.deepEqual(plugin.stringList('600000.SH, 000001.SZ', 'symbols', 50), {
    values: ['600000.SH', '000001.SZ'],
  });
  assert.match(plugin.stringList([], 'symbols', 50).err, /不能为空/);
});

test('Wind Finance normalizes optional fields and limits response size', () => {
  const plugin = loadPlugin();
  assert.deepEqual(plugin.normalizeFields(undefined), { values: undefined });
  assert.deepEqual(plugin.normalizeFields(['last', 'volume']), {
    values: ['last', 'volume'],
  });
  assert.equal(plugin.slimResult({ ok: true }).data.ok, true);
  const huge = plugin.slimResult('x'.repeat(50 * 1000 + 1));
  assert.equal(huge.truncated, true);
  assert.equal(huge.preview.length, 50 * 1000);
});

test('Wind Finance maps actionable HTTP errors', () => {
  const plugin = loadPlugin();
  assert.match(plugin.classifyStatus(401, ''), /凭证/);
  assert.match(plugin.classifyStatus(403, ''), /数据权限/);
  assert.match(plugin.classifyStatus(404, ''), /接口路径不兼容/);
  assert.match(plugin.classifyStatus(429, ''), /限流/);
});
