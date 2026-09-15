#!/usr/bin/env node
// Explicit maintenance command; CI uses only the committed snapshot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const client = path.resolve(process.argv[2] || '../cindy');
const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(client, 'packages/plugin-protocol/src/manifest.ts'), 'utf8');
const hash = crypto.createHash('sha256').update(source).digest('hex');
const esbuild = createRequire(path.join(client, 'package.json'))('esbuild');
const built = await esbuild.build({ entryPoints: [path.join(client, 'packages/plugin-protocol/src/manifest.ts')], bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022', legalComments: 'inline' });
const output = built.outputFiles[0].text;
const name = 'plugin-manifest.' + hash.slice(0, 7) + '.mjs';
fs.writeFileSync(path.join(root, '.tests/contracts', name), '// Generated from Cindy packages/plugin-protocol/src/manifest.ts\n// source sha256: ' + hash + '\n// Do not edit this snapshot by hand. Licensed under Apache-2.0; see NOTICE.\n' + output);
console.log(name);
