import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const pluginRoot = path.join(root, 'ios-simulator');
const manifest = JSON.parse(
  fs.readFileSync(path.join(pluginRoot, 'ghost.json'), 'utf8'),
);
const zhCnLocale = JSON.parse(
  fs.readFileSync(path.join(pluginRoot, 'locales/zh-CN.json'), 'utf8'),
);
const localeResources = ['zh-CN', 'en', 'ja', 'ko'].map((locale) =>
  JSON.parse(fs.readFileSync(path.join(pluginRoot, `locales/${locale}.json`), 'utf8')),
);

test('manifest keeps privileged simulator runtime ownership in Cindy Host', () => {
  assert.equal(manifest.id, 'ios-simulator');
  assert.equal(manifest.version, '1.1.3');
  assert.equal(manifest.minCindyVersion, '0.1.45');
  assert.deepEqual(
    {
      name: manifest.name,
      description: manifest.description,
      whenToUse: manifest.whenToUse,
    },
    {
      name: zhCnLocale.name,
      description: zhCnLocale.description,
      whenToUse: zhCnLocale.whenToUse,
    },
    'top-level catalog copy must remain the zh-CN fallback for legacy clients',
  );
  assert.match(manifest.whenToUse, /清理/);
  assert.match(manifest.whenToUse, /lease/);
  assert.match(manifest.whenToUse, /generation 迁移/);
  assert.match(manifest.whenToUse, /外部工作流/);
  for (const resource of localeResources) {
    assert.doesNotMatch(
      resource.description,
      /\bWDA\b|H\.264|\bHID\b|\bruntime\b|\bsimctl\b|\badmission\b/i,
      'catalog descriptions should explain user value without implementation jargon',
    );
  }
  assert.equal(manifest.launch, 'on-demand');
  assert.deepEqual(manifest.slots, ['skill', 'ios-simulator']);
  assert.equal(manifest.panel, undefined);
  assert.equal(manifest.node, undefined);
  assert.equal(manifest.network, undefined);
  assert.equal(manifest.tools, undefined);
  assert.equal(manifest.command, undefined);

  for (const staleFile of [
    'panel.html',
    'panel.js',
    'panel.css',
  ]) {
    assert.equal(fs.existsSync(path.join(pluginRoot, staleFile)), false, staleFile);
  }

  const ignoreRules = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignoreRules, /^\*\.cindy$/m);
});

test('bundled skill requires the Host MCP and gates external fallbacks through the Host', () => {
  const item = manifest.skill.items[0];
  const source = fs.readFileSync(
    path.join(pluginRoot, item.dir, 'SKILL.md'),
    'utf8',
  );

  assert.match(source, new RegExp(`^---\\nname: ${item.name}\\n`, 'm'));
  assert.ok(source.includes(`description: ${item.description}`));
  assert.ok(source.includes('cindy_ios_simulator'));
  assert.ok(source.includes('Do not reproduce the embedded workflow with shell commands'));
  assert.ok(source.includes('Never call `cindy_computer`'));
  assert.ok(source.includes('external Simulator.app'));
  assert.ok(source.includes('Do not infer availability from generic MCP resource listing'));
  assert.ok(source.includes('list_simulator_devices'));
  assert.ok(source.includes('type_simulator_text'));
  assert.doesNotMatch(source, /`list_devices`/);
  assert.doesNotMatch(source, /`type_text`/);
  assert.ok(source.includes('instanceId'));
  assert.ok(source.includes('generation'));
  assert.ok(source.includes('leaseId'));
  assert.ok(source.includes('Host-authorized external fallback'));
  assert.ok(source.includes('runningInstanceCount'));
  assert.ok(source.includes('cleanup task'));
  assert.ok(source.includes('ownership state'));
  assert.ok(source.includes('Host-provided workflow name'));
  assert.ok(source.includes('exact device identity/UDID'));
  assert.ok(source.includes("user's\noriginal task unchanged"));
  assert.ok(source.includes('If the Host does not return\nall three handoff fields, stop'));
  assert.ok(source.includes('guessed shell commands'));
  assert.ok(source.includes('Only the Host-authorized external fallback'));
});

test('logic entry cannot proxy simulator control or read Host state', () => {
  const source = fs.readFileSync(path.join(pluginRoot, 'main.js'), 'utf8');
  assert.doesNotMatch(
    source,
    /cindy\.|BroadcastChannel|fetch\s*\(|XMLHttpRequest|WebSocket/,
  );
  assert.match(source, /stay inside|remain inside Cindy Host/i);
});

test('icon is a compact PNG and staged rollout is explicit', () => {
  const iconPath = path.join(pluginRoot, manifest.icon);
  const icon = fs.readFileSync(iconPath);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(icon.byteLength > 1024, 'icon is unexpectedly small');
  assert.ok(icon.byteLength < 512 * 1024, 'icon is unexpectedly large');

  const provisioning = JSON.parse(
    fs.readFileSync(path.join(root, 'provisioning.json'), 'utf8'),
  );
  assert.deepEqual(provisioning.ghosts['ios-simulator'], {
    audience: { emails: [] },
    tier: 'builtin',
  });
});
