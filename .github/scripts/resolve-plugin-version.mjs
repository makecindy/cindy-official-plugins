#!/usr/bin/env node
// Deterministic, strictly monotonic plugin version resolver.
//
// Decouples routine PRs from manual `ghost.json.version` bumps:
// - At AUTO_VERSION_EPOCH (the commit introducing auto-versioning on `main`),
//   every existing plugin starts at its exact committed `ghost.json.version`.
// - For each subsequent first-parent commit touching the plugin directory or
//   shared root package files (LICENSE, NOTICE, TRADEMARKS*.md):
//     * If the commit's declared `ghost.json.version` is strictly greater than
//       the previous effective version (e.g. explicit minor/major bump), use it.
//     * Otherwise, auto-increment the patch component by +1.
//
// This guarantees every distinct packaged build on `main` has a unique,
// monotonically increasing SemVer without forcing parallel PRs to edit and
// collide on `ghost.json.version`.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const AUTO_VERSION_EPOCH = '0f8a244773a1ebcf71865b545ae87d7ceaa0f403';
export const SHARED_PACKAGE_FILES = [
  'LICENSE',
  'NOTICE',
  'TRADEMARKS.md',
  'TRADEMARKS.zh-CN.md',
];

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tryGit(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

export function parseStableSemver(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(version ?? ''));
  if (!match) return null;
  return match.slice(1).map((part) => BigInt(part));
}

export function compareStableSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function bumpPatch([major, minor, patch]) {
  return [major, minor, patch + 1n];
}

function formatSemver(parts) {
  return parts.map(String).join('.');
}

function collectDirectoryLineage(pluginDirectory, ref, cwd) {
  const raw = tryGit(['show', `${ref}:plugin-id-migrations.json`], cwd);
  if (!raw) return [pluginDirectory];
  let migrations;
  try {
    migrations = JSON.parse(raw);
  } catch {
    return [pluginDirectory];
  }
  if (!Array.isArray(migrations)) return [pluginDirectory];
  const byTarget = new Map();
  for (const entry of migrations) {
    if (entry && typeof entry.from === 'string' && typeof entry.to === 'string') {
      byTarget.set(entry.to, entry.from);
    }
  }
  const chain = [pluginDirectory];
  const seen = new Set(chain);
  let current = pluginDirectory;
  while (byTarget.has(current)) {
    const prev = byTarget.get(current);
    if (!prev || seen.has(prev)) break;
    chain.push(prev);
    seen.add(prev);
    current = prev;
  }
  return chain;
}

function readManifestAtCommit(sha, lineage, cwd) {
  for (const dir of lineage) {
    const raw = tryGit(['show', `${sha}:${dir}/ghost.json`], cwd);
    if (raw === null) continue;
    try {
      return JSON.parse(raw);
    } catch {
      continue;
    }
  }
  return null;
}

export function resolvePluginVersion(pluginDirectory, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const ref = options.ref ?? 'HEAD';
  const epoch = options.epoch ?? AUTO_VERSION_EPOCH;
  const requireFullHistoryInCi = options.requireFullHistoryInCi ?? (process.env.GITHUB_ACTIONS === 'true');

  const manifestRaw = git(['show', `${ref}:${pluginDirectory}/ghost.json`], cwd);
  const manifest = JSON.parse(manifestRaw);
  if (typeof manifest.version !== 'string') {
    return { declared: null, effective: null, changed: false, manifest };
  }
  const declaredParts = parseStableSemver(manifest.version);
  if (!declaredParts) {
    throw new Error(`${pluginDirectory}: ghost.json.version must use major.minor.patch SemVer (got ${manifest.version})`);
  }

  const lineage = collectDirectoryLineage(pluginDirectory, ref, cwd);
  let effective = null;
  let commitRange = ref;

  const hasEpoch = epoch && tryGit(['merge-base', '--is-ancestor', epoch, ref], cwd) !== null;
  if (hasEpoch) {
    const epochManifest = readManifestAtCommit(epoch, lineage, cwd);
    if (epochManifest) {
      const epochParts = parseStableSemver(epochManifest.version);
      if (epochParts) effective = epochParts;
    }
    commitRange = `${epoch}..${ref}`;
  } else {
    const isShallow = (tryGit(['rev-parse', '--is-shallow-repository'], cwd) ?? '').trim() === 'true';
    if (isShallow && requireFullHistoryInCi) {
      throw new Error(
        `Shallow clone is missing AUTO_VERSION_EPOCH (${epoch}); check out with fetch-depth: 0 before packaging ${pluginDirectory}`,
      );
    }
  }

  const commits = git(
    ['rev-list', '--first-parent', '--reverse', commitRange, '--', ...lineage, ...SHARED_PACKAGE_FILES],
    cwd,
  )
    .trim()
    .split('\n')
    .filter(Boolean);

  for (const sha of commits) {
    const parsed = readManifestAtCommit(sha, lineage, cwd);
    if (!parsed) continue;
    const parts = parseStableSemver(parsed.version);
    if (!parts) continue;
    if (effective === null) {
      effective = parts;
    } else if (compareStableSemver(parts, effective) > 0) {
      effective = parts;
    } else {
      effective = bumpPatch(effective);
    }
  }

  if (effective === null) {
    effective = declaredParts;
  }

  const effectiveString = formatSemver(effective);
  return {
    declared: manifest.version,
    effective: effectiveString,
    changed: effectiveString !== manifest.version,
    manifest,
  };
}

function main(argv) {
  const pluginDirectory = argv[0];
  if (!pluginDirectory) {
    console.error('usage: resolve-plugin-version.mjs <plugin-directory> [--write-manifest <output-path>]');
    process.exit(1);
  }
  let writePath = null;
  const writeIdx = argv.indexOf('--write-manifest');
  if (writeIdx >= 0) {
    writePath = argv[writeIdx + 1];
    if (!writePath) {
      console.error('--write-manifest requires an output path');
      process.exit(1);
    }
  }

  const result = resolvePluginVersion(pluginDirectory);
  if (result.effective === null) {
    process.exit(0);
  }
  if (writePath && result.changed) {
    const updated = { ...result.manifest, version: result.effective };
    writeFileSync(writePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${result.effective}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
