import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyPatches, sha256, validateArchiveEntries, verifyVendor, fileHashes } from '../.github/scripts/sync-maker-runtime.mjs';

const recipe = JSON.parse(readFileSync(new URL('../.github/maker-runtime/0.0.34.json', import.meta.url)));
const vendor = fileURLToPath(new URL('../taptap-maker/vendor/taptap-maker/', import.meta.url));

test('reviewed upstream can be reconstructed and patched reproducibly', () => {
  const patched = readFileSync(path.join(vendor, 'dist/maker.js'), 'utf8');
  let original = patched;
  for (const patch of [...recipe.patches].reverse()) {
    for (const edit of [...patch.edits].reverse()) {
      if (!edit.after) {
        const anchor = 'async function startMakerMcpServer() {\n  startMakerPackageUpdateCheck({ currentVersion: VERSION });\n';
        assert.equal(original.split(anchor).length - 1, 1);
        original = original.replace(anchor, anchor + edit.before);
      } else {
        assert.equal(original.split(edit.after).length - 1, edit.count, patch.id);
        original = original.split(edit.after).join(edit.before);
      }
    }
  }
  assert.equal(sha256(original), recipe.originalSha256);
  assert.equal(applyPatches(original, recipe), patched);
  assert.throws(() => applyPatches(original + '\n', recipe), /SHA-256 mismatch/);
  assert.throws(() => applyPatches(patched, recipe), /SHA-256 mismatch/);
  const broken = structuredClone(recipe);
  broken.patches[0].edits[0].count += 1;
  assert.throws(() => applyPatches(original, broken), /Patch mismatch/);
  verifyVendor(vendor, recipe);
});

test('inventory rejects missing, changed and unexpected vendor files', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'maker-inventory-'));
  try {
    writeFileSync(path.join(directory, 'example.txt'), 'original');
    const fixture = { vendorHashes: fileHashes(directory) };
    verifyVendor(directory, fixture);
    writeFileSync(path.join(directory, 'example.txt'), 'changed');
    assert.throws(() => verifyVendor(directory, fixture), /inventory differs/);
    writeFileSync(path.join(directory, 'example.txt'), 'original');
    writeFileSync(path.join(directory, 'unexpected.txt'), 'extra');
    assert.throws(() => verifyVendor(directory, fixture), /inventory differs/);
    rmSync(path.join(directory, 'unexpected.txt'));
    rmSync(path.join(directory, 'example.txt'));
    assert.throws(() => verifyVendor(directory, fixture), /inventory differs/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('archive preflight rejects links and special files before extraction', () => {
  const regular = 'drwxr-xr-x root/root package/\n-rw-r--r-- root/root package/index.js\n';
  assert.doesNotThrow(() => validateArchiveEntries('package/\npackage/index.js\n', regular));
  for (const type of ['l', 'h', 'b', 'c', 'p', 's']) {
    assert.throws(
      () => validateArchiveEntries('package/entry\n', `${type}rwxr-xr-x root/root package/entry\n`),
      /Unsafe archive entry/,
    );
  }
  assert.throws(
    () => validateArchiveEntries('package/../escape\n', '-rw-r--r-- root/root package/../escape\n'),
    /Unsafe archive path/,
  );
});

test('added bundled dependencies have license texts', () => {
  const notices = readFileSync(new URL('../taptap-maker/THIRD-PARTY-LICENSES.txt', import.meta.url), 'utf8');
  for (const name of ['long', 'marked', 'protobufjs', 'ws', 'Lucide / Feather icon snapshot']) {
    assert.ok(notices.includes('\n' + name + '\n'), name);
  }
  assert.match(notices, /Apache License/);
});
