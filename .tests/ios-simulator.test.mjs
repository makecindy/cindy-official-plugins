import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validateGhostManifest } from './contracts/plugin-manifest.20ab276de16e.mjs';

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
const manualItem = manifest.manual?.items?.[0];

function readManualPages() {
  assert.ok(manualItem, 'the plugin must declare a Manual');
  const directory = path.join(pluginRoot, manualItem.dir);
  const pages = new Map();
  const walk = (relativeDir = '') => {
    const absoluteDir = path.join(directory, relativeDir);
    assert.ok(fs.lstatSync(absoluteDir).isDirectory(), 'Manual directories must not be symlinks');
    for (const name of fs.readdirSync(absoluteDir)) {
      const relative = path.posix.join(relativeDir, name);
      const absolute = path.join(directory, relative);
      const stat = fs.lstatSync(absolute);
      assert.equal(stat.isSymbolicLink(), false, `Manual symlink: ${relative}`);
      if (stat.isDirectory()) {
        walk(relative);
        continue;
      }
      assert.ok(stat.isFile(), `Manual must contain regular files: ${relative}`);
      assert.ok(relative.endsWith('.md'), `Manual must contain only Markdown: ${relative}`);
      assert.ok(stat.size > 0 && stat.size <= 64 * 1024, `Manual size: ${relative}`);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(absolute));
      assert.doesNotMatch(text, /^---(?:\r?\n|$)/, `Manual must not have Skill frontmatter: ${relative}`);
      assert.doesNotMatch(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/, relative);
      pages.set(`${manualItem.name}/${relative}`, text);
    }
  };
  walk();
  return pages;
}

test('manifest keeps privileged simulator runtime ownership in Cindy Host', () => {
  assert.equal(manifest.id, 'ios-simulator');
  assert.equal(manifest.schemaVersion, 3);
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  const baseVersion = [1n, 1n, 4n];
  const parts = manifest.version.split('.').map(BigInt);
  const difference = parts.findIndex((part, index) => part !== baseVersion[index]);
  assert.ok(difference >= 0 && parts[difference] > baseVersion[difference], 'version must exceed main 1.1.4');
  assert.equal(manifest.minCindyVersion, '0.1.83', 'minimum supported Cindy release for Manual-only discovery');
  const validated = validateGhostManifest(manifest);
  assert.equal(validated.ok, true, validated.reason);
  assert.equal(validated.manifest.kind, 'chip', 'preserve the legacy default kind');
  assert.equal(manifest.entry, 'main.js');
  assert.equal(manifest.author, 'Cindy');
  assert.equal(manifest.icon, 'assets/icon.png');
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
  assert.equal(Object.hasOwn(manifest, 'slots'), false);
  assert.equal(manifest.iosSimulator, true);
  assert.deepEqual(Object.keys(manifest).sort(), [
    'schemaVersion', 'id', 'name', 'description', 'whenToUse', 'version',
    'minCindyVersion', 'author', 'icon', 'entry', 'launch', 'iosSimulator',
    'manual', 'locales',
  ].sort(), 'the migration must not add undeclared or invented capabilities');
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

test('bundled Manual requires the Host MCP and gates external fallbacks through the Host', () => {
  const source = [...readManualPages().values()].join('\n');

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

test('Manual index resolves every bundled page through shallow logical paths', () => {
  assert.equal(manifest.manual.items.length, 1, 'keep the top-level index lightweight');
  assert.deepEqual(Object.keys(manualItem).sort(), ['description', 'dir', 'name']);
  assert.equal(manualItem.name, 'ios-simulator');
  assert.equal(manualItem.dir, 'manual/ios-simulator');
  assert.ok(manualItem.description.length > 0);
  assert.match(manualItem.description, /Host-authorized fallback/);
  const pages = readManualPages();
  assert.deepEqual([...pages.keys()].sort(), [
    'ios-simulator/MANUAL.md',
    'ios-simulator/build-and-run.md',
    'ios-simulator/external-fallback.md',
  ]);
  const entryPath = `${manualItem.name}/MANUAL.md`;
  const visited = new Set();
  const visit = (logicalPath) => {
    assert.ok(!visited.has(logicalPath), `Manual navigation must not cycle: ${logicalPath}`);
    const source = pages.get(logicalPath);
    assert.ok(source, `Manual call points at a missing page: ${logicalPath}`);
    visited.add(logicalPath);
    assert.doesNotMatch(source, /ghost_call\s*\(/, 'Host MCP tools must not be invented as plugin tools');
    for (const [, ghostId, target] of source.matchAll(/ghost_manual\(\{ ghost_id: "([^"]+)", path: "([^"]+)" \}\)/g)) {
      assert.equal(ghostId, manifest.id);
      assert.ok(target.startsWith(`${manualItem.name}/`), 'call paths use the logical Manual name');
      assert.doesNotMatch(target, /(?:^|\/)\.\.?\//);
      visit(target);
    }
  };
  visit(entryPath);
  assert.deepEqual([...visited].sort(), [...pages.keys()].sort(), 'all bundled pages must be reachable');
});

test('Manual-only migration removes the user-level Skill contribution', () => {
  const manual = [...readManualPages().values()].join('\n');
  assert.equal(manifest.skill, undefined);
  assert.equal(
    fs.existsSync(path.join(pluginRoot, 'skills/cindy-ios-simulator/SKILL.md')),
    false,
  );
  assert.doesNotMatch(manual, /This skill belongs|This skill only governs|name: cindy-ios-simulator/);
});

test('Manual retains build boundaries, exact artifacts, and Host recovery', () => {
  const normalize = (text) => text.replace(/\s+/g, ' ');
  const source = normalize([...readManualPages().values()].join('\n'));
  for (const required of [
    'The Host derives `worktreeRoot` from the current Cindy session',
    'do not pass `worktreeRoot`, `projectRoot`, arbitrary build-output paths',
    'does not prove Git checkout identity or sandbox Xcode build scripts',
    'Build only a trusted project',
    '`build_app.projectDir` if the Host\'s current tool schema supports that argument',
    'Use an absolute directory or a path relative to the current task\'s worktree',
    'Pass `projectDir` on every rebuild of B: omitting it selects A\'s directory again',
    'The summary\'s fingerprint identifies the directory, not a source revision',
    'Do not silently build A, copy B into A, or use shell commands to bypass the embedded route',
    'existing `.xcworkspace` or `.xcodeproj` directory inside the selected project directory',
    'An absolute path is allowed only when its resolved target is still inside that directory',
    '`..` or symlink traversal must not escape it',
    'Do not guess an external checkout or change the task\'s working directory to bypass a path rejection',
    '`AMBIGUOUS_XCODE_PROJECT`', '`INVALID_ARGS`', '`INVALID_ARGUMENT`', '`PROJECT_NOT_FOUND`',
    '`read_build_diagnostics`', '`diagnosticsId`',
    'Host-returned `artifactId` to `install_app` and then `launch_app` in the same Cindy session',
    'Never substitute an arbitrary `.app` path or another instance\'s artifact',
    'do not claim runtime success from build success alone',
    'After a stale generation, expired lease, ownership conflict, or Host restart, stop mutations',
    'Refresh `get_screen_map` before using old snapshot or element identifiers again',
    'inspect current state before repeating an action with an uncertain outcome',
  ]) assert.ok(source.includes(required), `Manual must retain: ${required}`);
});

test('release notes retain the supported Host and production verification boundaries', () => {
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const source = fs.readFileSync(path.join(pluginRoot, file), 'utf8');
    assert.doesNotMatch(source, /\bDraft\b|\bprovisional\b|暂定/, `${file} must not retain pre-acceptance status`);
    for (const evidence of [
      `minCindyVersion: ${manifest.minCindyVersion}`, '#4440',
      'b201f1f663a1199c1e296ee0b6ddca7d465d4e9d',
      'ghost_info', 'ghost_manual', 'ghost_call', 'TOOL_NOT_FOUND',
      'WDA/JPEG', 'Native H.264/HID',
      'https://github.com/makecindy/cindy-official-plugins/pull/111',
    ]) assert.ok(source.includes(evidence), `${file} must explain ${evidence}`);
    // These assertions protect the documentation contract, not runtime acceptance.
    // Installed-package results and artifact identities are recorded in the PR.
    assert.doesNotMatch(source, /\bTODO\b|\bTBD\b/);
  }
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
