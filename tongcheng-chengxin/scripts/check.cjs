'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ghost.json'), 'utf8'));
const required = [manifest.entry, manifest.settingsHtml, manifest.node.entry, 'README.md'];
for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error('missing ' + file);
for (const file of [manifest.entry, manifest.node.entry, 'settings.js', 'node/tongcheng.cjs', 'test/core.test.cjs', 'scripts/check.cjs', 'scripts/package-check.cjs', 'scripts/build.cjs']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(file + ': syntax check failed\n' + result.stderr);
}
const text = fs.readFileSync(path.join(root, 'node/tongcheng.cjs'), 'utf8');
if (/Bearer\s+[A-Za-z0-9._-]{12,}/.test(text) || /CHENGXIN_API_KEY\s*=/.test(text)) throw new Error('credential-like material found');
if (text.includes('../tiktok-business') || text.includes('../shared')) throw new Error('cross-plugin business import found');
console.log('tc-chengxin check: PASS');
