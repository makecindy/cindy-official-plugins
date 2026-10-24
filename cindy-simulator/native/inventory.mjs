#!/usr/bin/env node
// vendor-inventory.json records every packaged upstream file with its size and
// SHA-256. `--write` regenerates it from vendor/; `--check` (default) fails when a
// tracked vendor file is missing from the record, differs from it, or a recorded
// file is neither tracked nor delivered by binary-dependencies.json.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD = join(PLUGIN, 'vendor-inventory.json');

function trackedVendorFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'vendor'], { cwd: PLUGIN, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function downloadedTargets() {
  const deps = JSON.parse(readFileSync(join(PLUGIN, 'binary-dependencies.json'), 'utf8'));
  return new Set(deps.dependencies.flatMap((dep) => dep.assets.flatMap((asset) => asset.files.map((file) => file.target))));
}

function describe(path) {
  const bytes = readFileSync(join(PLUGIN, path));
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function inventoryProblems() {
  const recorded = JSON.parse(readFileSync(RECORD, 'utf8'));
  const byPath = new Map(recorded.map((entry) => [entry.path, entry]));
  const tracked = trackedVendorFiles();
  const downloaded = downloadedTargets();
  const problems = [];
  for (const path of tracked) {
    const entry = byPath.get(path);
    if (!entry) { problems.push(`${path}: tracked but not recorded`); continue; }
    const actual = describe(path);
    if (actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes) problems.push(`${path}: content differs from the record`);
  }
  for (const entry of recorded) {
    if (tracked.includes(entry.path)) continue;
    if (!downloaded.has(entry.path)) { problems.push(`${entry.path}: recorded but neither tracked nor downloaded`); continue; }
    // Downloaded assets are verified by archive hash; check them too when present.
    if (existsSync(join(PLUGIN, entry.path)) && describe(entry.path).sha256 !== entry.sha256) problems.push(`${entry.path}: content differs from the record`);
  }
  return problems;
}

function write() {
  const paths = [...new Set([...trackedVendorFiles(), ...downloadedTargets()])].sort();
  const missing = paths.filter((path) => !existsSync(join(PLUGIN, path)));
  if (missing.length) throw new Error(`Fetch binary dependencies first; missing: ${missing.join(', ')}`);
  writeFileSync(RECORD, JSON.stringify(paths.map(describe), null, 2) + '\n');
  console.log(`Recorded ${paths.length} files in ${relative(process.cwd(), RECORD)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--write')) write();
  else {
    const problems = inventoryProblems();
    for (const problem of problems) console.error(problem);
    process.exit(problems.length ? 1 : 0);
  }
}
