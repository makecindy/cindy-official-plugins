#!/usr/bin/env node

// Maintainer-only refresh from committed Host source. CI consumes the pinned
// output and never needs another checkout, network access or a new dependency.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [checkout, revision] = process.argv.slice(2);
if (!checkout || !revision) {
  console.error('usage: node scripts/refresh-plugin-contract.mjs <cindy-checkout> <commit-or-ref>');
  process.exit(2);
}
const client = path.resolve(checkout);
const root = path.resolve(import.meta.dirname, '..');
const git = args => execFileSync('git', args, { cwd: client, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const commit = git(['rev-parse', '--verify', `${revision}^{commit}`]).trim();
const { build, version: esbuildVersion } = createRequire(path.join(client, 'package.json'))('esbuild');
const sources = new Map();
const output = await build({
  absWorkingDir: client,
  entryPoints: ['packages/plugin-protocol/src/manifest.ts'],
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', write: false,
  plugins: [{ name: 'committed-host-source', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const file = args.kind === 'entry-point' ? path.posix.normalize(args.path)
        : path.posix.join(path.posix.dirname(args.importer), args.path).replace(/\.js$/, '.ts');
      if (!file.startsWith('packages/plugin-protocol/src/')) throw new Error(`unexpected contract import: ${file}`);
      return { path: file, namespace: 'host' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'host' }, args => {
      const contents = git(['show', `${commit}:${args.path}`]);
      sources.set(args.path, contents);
      return { contents, loader: 'ts' };
    });
  } }],
});
const hash = createHash('sha256').update(esbuildVersion);
for (const [file, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) hash.update(`\0${file}\0${source}`);
const digest = hash.digest('hex');
const name = `plugin-manifest.${digest.slice(0, 12)}.mjs`;
const contracts = path.join(root, '.tests', 'contracts');
const previous = fs.readdirSync(contracts).filter(file => /^plugin-manifest\.[a-f0-9]+\.mjs$/.test(file));
if (previous.length !== 1) throw new Error(`expected one pinned validator, found ${previous.length}`);
const banner = `// Generated from committed Cindy packages/plugin-protocol/src/manifest.ts and its local imports.
// Source: makecindy/cindy@${commit}; esbuild ${esbuildVersion}
// Input sha256 (esbuild version, sorted paths and source bytes): ${digest}
// Refresh: node scripts/refresh-plugin-contract.mjs <cindy-checkout> ${commit}
// Do not edit by hand. Licensed under Apache-2.0; see NOTICE.
\n`;
if (previous[0] !== name) fs.renameSync(path.join(contracts, previous[0]), path.join(contracts, name));
fs.writeFileSync(path.join(contracts, name), banner + output.outputFiles[0].text);
for (const test of fs.readdirSync(path.join(root, '.tests')).filter(file => file.endsWith('.mjs'))) {
  const file = path.join(root, '.tests', test);
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(previous[0])) fs.writeFileSync(file, source.replaceAll(previous[0], name));
}
console.log(`${name}: ${sources.size} committed source files from ${commit}`);
