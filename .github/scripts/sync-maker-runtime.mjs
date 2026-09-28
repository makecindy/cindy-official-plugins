import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function applyPatches(source, recipe) {
  if (sha256(source) !== recipe.originalSha256) throw new Error('Unreviewed upstream bundle: SHA-256 mismatch');
  for (const patch of recipe.patches) {
    for (const edit of patch.edits) {
      const matches = source.split(edit.before).length - 1;
      if (!edit.before || matches !== edit.count) throw new Error('Patch mismatch: ' + patch.id);
      source = source.split(edit.before).join(edit.after);
    }
  }
  if (sha256(source) !== recipe.patchedSha256) throw new Error('Patched bundle SHA-256 mismatch');
  return source;
}

export function fileHashes(directory, prefix = '') {
  const hashes = {};
  for (const name of readdirSync(directory).sort()) {
    const filename = path.join(directory, name);
    const relative = prefix + name;
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink()) throw new Error('Symlink not allowed: ' + relative);
    if (stat.isDirectory()) Object.assign(hashes, fileHashes(filename, relative + '/'));
    else if (stat.isFile()) hashes[relative] = sha256(readFileSync(filename));
    else throw new Error('Unsupported file: ' + relative);
  }
  return hashes;
}

export function verifyVendor(directory, recipe) {
  const actual = fileHashes(directory);
  if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(recipe.vendorHashes).sort())) {
    throw new Error('Vendor inventory differs from the reviewed package and patches');
  }
}

export function validateArchiveEntries(pathListing, detailListing) {
  const entries = pathListing.trim().split(/\r?\n/).filter(Boolean);
  if (entries.some((entry) => !entry.startsWith('package/') || entry.includes('..') || entry.includes('\\'))) {
    throw new Error('Unsafe archive path');
  }
  const details = detailListing.trim().split(/\r?\n/).filter(Boolean);
  if (details.some((entry) => !['-', 'd'].includes(entry[0]))) {
    throw new Error('Unsafe archive entry');
  }
}

async function main() {
  const [version, mode] = process.argv.slice(2);
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || !['--check', undefined].includes(mode) || process.argv.length > 4) {
    throw new Error('Usage: node .github/scripts/sync-maker-runtime.mjs <reviewed-version> [--check]');
  }
  const recipe = JSON.parse(readFileSync(path.join(root, '.github/maker-runtime', version + '.json'), 'utf8'));
  if (recipe.version !== version || recipe.package !== '@taptap/maker') throw new Error('Invalid recipe identity');
  const vendor = path.join(root, 'taptap-maker/vendor/taptap-maker');
  if (mode === '--check') {
    verifyVendor(vendor, recipe);
    console.log('Verified Maker ' + version + ': complete vendor inventory and compatibility patches');
    return;
  }
  const staging = mkdtempSync(path.join(path.dirname(vendor), '.maker-upgrade-'));
  const backup = path.join(staging, 'previous');
  let installed = false;
  try {
    const response = await fetch('https://registry.npmjs.org/@taptap/maker/-/maker-' + version + '.tgz', {
      redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error('Package download failed: ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== recipe.integrity) throw new Error('Package integrity mismatch');
    const archive = path.join(staging, 'maker.tgz');
    writeFileSync(archive, bytes);
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    const details = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' });
    validateArchiveEntries(entries, details);
    execFileSync('tar', ['-xzf', archive, '-C', staging]);
    const next = path.join(staging, 'package');
    const metadata = JSON.parse(readFileSync(path.join(next, 'package.json'), 'utf8'));
    if (metadata.name !== recipe.package || metadata.version !== version) throw new Error('Package identity mismatch');
    fileHashes(next);
    const bundle = path.join(next, 'dist/maker.js');
    writeFileSync(bundle, applyPatches(readFileSync(bundle, 'utf8'), recipe));
    cpSync(path.join(vendor, 'LICENSE'), path.join(next, 'LICENSE'));
    verifyVendor(next, recipe);
    execFileSync(process.execPath, ['--check', bundle]);
    renameSync(vendor, backup);
    try {
      renameSync(next, vendor);
      installed = true;
    } catch (error) {
      renameSync(backup, vendor);
      throw error;
    }
    console.log('Installed Maker ' + version + '; run tests and review licenses/version/docs before packaging.');
  } finally {
    if (installed || !existsSync(backup)) rmSync(staging, { recursive: true, force: true });
    else console.error('Previous vendor preserved at ' + backup);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
