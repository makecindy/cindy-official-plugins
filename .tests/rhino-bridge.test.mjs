import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const plugin = path.join(root, 'rhino-bridge');
const manifest = JSON.parse(fs.readFileSync(path.join(plugin, 'ghost.json'), 'utf8'));
const official = require(path.join(plugin, 'node', 'official.cjs'));
const worker = require(path.join(plugin, 'node', 'worker.cjs'));

test('manifest preserves the minimal Rhino bridge capability boundary', () => {
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.version, '0.2.4');
  assert.equal(manifest.author, 'Cindy');
  assert.deepEqual(manifest.setup, { requires: [] });
  assert.equal(manifest.node.lifecycle, 'on-demand');
  assert.deepEqual(manifest.node.secretBindings[0].methods, ['rhino/request']);
  assert.deepEqual(manifest.cindy, { media: ['deposit'] });
  assert.equal(manifest.tools.length, 9);
});

test('official Router path accepts only the fixed executable basename and supported versions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rhino-bridge-'));
  const executable = path.join(directory, process.platform === 'win32' ? 'rhino-mcp-router.exe' : 'rhino-mcp-router');
  fs.writeFileSync(executable, 'fixture');
  assert.deepEqual(official.validateConfig({ routerPath: executable, version: '8' }), { file: executable, version: '8' });
  assert.throws(() => official.validateConfig({ routerPath: path.join(directory, 'other.exe'), version: '8' }), /Router/);
  assert.throws(() => official.validateConfig({ routerPath: executable, version: '10' }), /Rhino 8/);
  assert.throws(() => official.validateConfig({ routerPath: 'rhino-mcp-router.exe', version: '8' }), /绝对路径/);
});

test('official tool filtering blocks slot lifecycle control and requires a slot contract', () => {
  assert.equal(official.usable({ name: 'spawn_slot', inputSchema: { properties: { slot: {} } } }), false);
  assert.equal(official.usable({ name: 'close_slot', inputSchema: { properties: { slot: {} } } }), false);
  assert.equal(official.usable({ name: 'list_slots', inputSchema: { properties: {} } }), true);
  assert.equal(official.usable({ name: 'make_box', inputSchema: { properties: { slot: {} } } }), true);
  assert.equal(official.usable({ name: 'unscoped', inputSchema: { properties: {} } }), undefined);
});

test('nested MCP business errors remain structured failures', () => {
  const nested = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ error: 'failed' }) }] });
  const result = official.inspectResult({ content: [{ type: 'text', text: nested }] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'OFFICIAL_TOOL');
  assert.equal(result.mcp.isError, true);
});

test('official write requests report unknown outcome after invalid Router output', async () => {
  const stdout = new EventEmitter();
  const child = new EventEmitter();
  child.stdout = stdout;
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.write = () => stdout.emit('data', Buffer.from('not-json\n'));
  child.stdin.end = () => {};
  child.kill = () => {};
  const router = new official.Router(child);
  await assert.rejects(
    router.request('tools/call', { name: 'make_box', arguments: { slot: 'slot-1' } }),
    error => error.code === 'OFFICIAL_PROTOCOL' && /结果可能已经执行/.test(error.message) && /不要直接重做/.test(error.message),
  );
});

test('legacy transport rejects missing credentials and invalid ports before opening a socket', async () => {
  let opened = false;
  const transport = { createConnection() { opened = true; throw new Error('must not open'); } };
  const missing = await worker.requestRhino({ action: 'status', args: {}, port: 19986 }, '', transport);
  assert.equal(missing.code, 'BRIDGE_PAIRING');
  const badPort = await worker.requestRhino({ action: 'status', args: {}, port: 80 }, 'a'.repeat(64), transport);
  assert.equal(badPort.code, 'BRIDGE_PORT');
  assert.equal(opened, false);
});

test('Python engine regression cases run in the PR gate', () => {
  const script = path.join(root, '.tests', 'rhino-bridge-engine.test.py');
  const candidates = process.platform === 'win32'
    ? [['py', ['-3', script]], ['python', [script]]]
    : [['python3', [script]], ['python', [script]]];
  let result;
  for (const [command, args] of candidates) {
    const candidate = spawnSync(command, args, { encoding: 'utf8' });
    if (!candidate.error) { result = candidate; break; }
  }
  assert.ok(result, 'Python 3 is required to run the Rhino engine regression tests.');
  assert.equal(result.status, 0, `${result.stdout || ''}${result.stderr || ''}`);
});

test('settings localization follows app-context and never reads browser locale', () => {
  const source = fs.readFileSync(path.join(plugin, 'settings.js'), 'utf8');
  const dictionaries = fs.readFileSync(path.join(plugin, 'settings-i18n.js'), 'utf8');
  assert.match(source, /app-context/);
  assert.doesNotMatch(source + dictionaries, /navigator\.(?:language|languages)/);
  for (const locale of ['zh-CN', 'en', 'ja', 'ko']) assert.ok(dictionaries.includes(locale));
});
