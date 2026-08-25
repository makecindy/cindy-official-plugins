#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const input = process.argv[2];

if (!input) {
  console.error('usage: node scripts/validate-plugin-manifest.mjs <plugin-directory-or-ghost.json>');
  process.exit(2);
}

const inputPath = path.resolve(process.cwd(), input);
const manifestPath = fs.statSync(inputPath).isDirectory()
  ? path.join(inputPath, 'ghost.json')
  : inputPath;
const contractDir = path.join(root, '.tests', 'contracts');
const validators = fs.readdirSync(contractDir)
  .filter((name) => /^plugin-manifest\.[a-f0-9]+\.mjs$/.test(name));

if (validators.length !== 1) {
  throw new Error(`expected exactly one pinned Cindy manifest validator, found ${validators.length}`);
}

const { validateGhostManifest } = await import(pathToFileURL(path.join(contractDir, validators[0])).href);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const result = validateGhostManifest(manifest);

if (!result.ok) {
  console.error(`${path.relative(process.cwd(), manifestPath)}: ${result.reason}`);
  process.exit(1);
}

console.log(`${path.relative(process.cwd(), manifestPath)}: valid Cindy plugin manifest`);
