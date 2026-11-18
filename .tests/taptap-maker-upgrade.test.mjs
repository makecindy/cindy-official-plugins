import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyPatches, applyVendorFilePatches, sha256, validateArchiveEntries, verifyVendor, fileHashes } from '../.github/scripts/sync-maker-runtime.mjs';
import { assemble } from '../taptap-maker/vendor/taptap-maker/skills/maker-ui-workflow/scripts/assemble-ui.mjs';

const recipe = JSON.parse(readFileSync(new URL('../.github/maker-runtime/0.0.41.json', import.meta.url)));
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

test('workflow file patches reconstruct the reviewed upstream and reject changed inputs', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'maker-file-patches-'));
  try {
    for (const file of recipe.filePatches) {
      const patched = readFileSync(path.join(vendor, file.path), 'utf8');
      let original = patched;
      for (const patch of [...file.patches].reverse()) {
        for (const edit of [...patch.edits].reverse()) {
          assert.equal(original.split(edit.after).length - 1, edit.count, patch.id);
          original = original.split(edit.after).join(edit.before);
        }
      }
      assert.equal(sha256(original), file.originalSha256);
      assert.equal(applyPatches(original, file), patched);
      const fixture = { ...file, path: 'workflow.txt' };
      const inventory = { vendorHashes: { 'workflow.txt': sha256(patched) }, filePatches: [fixture] };
      writeFileSync(path.join(directory, fixture.path), original);
      applyVendorFilePatches(directory, inventory);
      assert.equal(readFileSync(path.join(directory, fixture.path), 'utf8'), patched);
      assert.throws(() => applyVendorFilePatches(directory, inventory), /SHA-256 mismatch/);
    }
    for (const unsafe of ['../escape', '/absolute', 'nested/../escape', 'nested\\escape', '']) {
      assert.throws(() => applyVendorFilePatches(directory, {
        vendorHashes: { [unsafe]: 'unused' }, filePatches: [{ path: unsafe }],
      }), /Unsafe vendor patch path/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('explicit UI positioning disables inferred anchors only on its own axis', () => {
  const layout = (props) => ({
    version: 1, coordinateSpace: 'design-pixels', rectBasis: 'asset-canvas',
    provenance: 'recognition', design: { sha256: 'a'.repeat(64), width: 1000, height: 1000 },
    elements: [
      { id: 'root', parentId: null, type: 'Panel', render: 'container', rect: [0, 0, 1000, 1000], props: {} },
      { id: 'child', parentId: 'root', type: 'Panel', render: 'container', rect: [400, 400, 200, 200], props: {} },
    ],
    assets: [], adaptation: { mode: 'screen', safeArea: false, nodes: { child: props } },
  });
  const render = (props) => assemble(layout(props)).ui.children[0];
  const left = render({ left: 24, right: null });
  assert.equal(left.left, 24);
  assert.equal(left.right, undefined);
  assert.equal(left.marginLeft, undefined);
  assert.equal(left.top, '50%');
  assert.equal(left.marginTop, -100);
  const bottom = render({ bottom: 24, top: null });
  assert.equal(bottom.bottom, 24);
  assert.equal(bottom.top, undefined);
  assert.equal(bottom.marginTop, undefined);
  assert.equal(bottom.left, '50%');
  assert.equal(bottom.marginLeft, -100);
  const both = render({ left: 24, top: 30, right: null, bottom: null, marginLeft: 5 });
  assert.equal(both.left, 24);
  assert.equal(both.top, 30);
  assert.equal(both.marginLeft, 5);
  assert.equal(both.marginTop, undefined);
});

test('console furniture guide points to a bundled file', () => {
  const docs = readFileSync(path.join(vendor, 'docs/MAKER_CONSOLE.md'), 'utf8');
  const target = docs.match(/\[家具弹性入场工作流\]\(([^)]+)\)/)?.[1];
  assert.equal(target, '../skills/maker-scene-furniture-workflow/SKILL.md');
  assert.match(readFileSync(path.resolve(vendor, 'docs', target), 'utf8'), /maker-scene-furniture-workflow/);
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
  for (const name of ['long', 'marked', 'protobufjs', 'ws', 'Lucide / Feather icon snapshot',
    'pngjs', 'archiver', 'minimatch', 'glob', 'buffer-crc32', 'Urhox UI Editor',
    'Yoga layout (embedded UI editor)', 'fengari', 'sprintf-js']) {
    assert.ok(notices.includes('\n' + name + '\n'), name);
  }
  assert.match(notices, /Apache License/);
});
