'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ghost.json'), 'utf8'));
const files = new Set(fs.readdirSync(root, { recursive: true }).filter((file) => !file.includes('node_modules')));
for (const file of [manifest.entry, manifest.settingsHtml, manifest.node.entry, 'ghost.json', 'README.md', 'package.json']) if (!files.has(file)) throw new Error('package member missing: ' + file);
for (const file of files) if (/(^|\/)(\.env|credentials|secrets?)($|\.)/i.test(file)) throw new Error('forbidden package member: ' + file);
console.log('tc-chengxin package check: PASS (' + files.size + ' files; no .cindy written)');
