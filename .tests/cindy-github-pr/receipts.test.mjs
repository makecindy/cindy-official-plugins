import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCiRetryReceiptIO } from '../../cindy-github/skills/pr/scripts/lib/ci-retry-receipts.mjs';

test('receipt paths still name the opened file after the full directory barrier', async t => {
  for (const operation of ['read', 'write', 'collision', 'copy', 'copy collision']) for (const change of ['unlink', 'replace']) await t.test(`${operation} / ${change}`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-receipt-file-binding-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'receipt'), source = path.join(root, 'source'), moved = path.join(root, 'old');
    fs.writeFileSync(source, 'legacy');
    if (['read', 'collision', 'copy collision'].includes(operation)) fs.writeFileSync(file, 'consumed');
    const handles = new Map(); let fileSynced = false, changed = false;
    const io = createCiRetryReceiptIO({ ...fs,
      openSync(name, ...args) { const fd = fs.openSync(name, ...args); handles.set(fd, path.resolve(name)); return fd; },
      closeSync(fd) { fs.closeSync(fd); handles.delete(fd); },
      fsyncSync(fd) {
        if (handles.get(fd) === file) fileSynced = true;
        if (!fileSynced || changed || handles.get(fd) !== path.parse(root).root) return;
        changed = true;
        if (change === 'unlink') fs.unlinkSync(file);
        else { fs.renameSync(file, moved); fs.writeFileSync(file, 'replacement'); }
      }, // successful-sync model, never a native durability claim
    });
    const perform = () => operation === 'read' ? io.read(file)
      : operation === 'write' || operation === 'collision' ? io.writeExclusive(file, 'new')
        : io.copyExclusive(source, file);
    assert.throws(perform, /durability could not be confirmed/);
    assert.equal(changed, true);
    assert.equal(handles.size, 0);
    assert.equal(fs.readFileSync(source, 'utf8'), 'legacy');
    if (change === 'replace') assert.equal(fs.readFileSync(file, 'utf8'), 'replacement');
    else assert.equal(fs.existsSync(file), false, 'do not recreate lost evidence');
  });
});

test('a receipt appearing during absent-file confirmation is not reported unused', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-receipt-appeared-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'receipt'); let created = false;
  const io = createCiRetryReceiptIO({ ...fs, fsyncSync() { if (!created) { created = true; fs.writeFileSync(file, 'consumed'); } } });
  assert.throws(() => io.read(file), /durability could not be confirmed/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'consumed');
});

function fixture(t, failAt = Infinity, failureCode = 'EIO') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-receipt-io-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = [], handles = new Set();
  let syncs = 0;
  const io = createCiRetryReceiptIO({ ...fs,
    openSync(file, ...args) { const fd = fs.openSync(file, ...args); handles.add(fd); events.push(['open', file, fd]); return fd; },
    closeSync(fd) { fs.closeSync(fd); handles.delete(fd); },
    fsyncSync(fd) {
      const type = fs.fstatSync(fd).isDirectory() ? 'directory' : 'file';
      events.push(['sync', type, fd]);
      if (++syncs === failAt) throw Object.assign(new Error('injected sync failure'), { code: failureCode });
      // Supported-filesystem model only, not Windows or power-loss evidence.
    },
  });
  return { root, io, events, handles };
}

test('receipt owner confirms file and the complete newly-created parent chain before success', t => {
  const f = fixture(t), file = path.join(f.root, 'new', 'nested', 'one.slot');
  assert.equal(f.io.writeExclusive(file, 'original'), true);
  const fileSync = f.events.findIndex(e => e[0] === 'sync' && e[1] === 'file');
  assert.ok(fileSync > 0);
  assert.ok(f.events.slice(fileSync + 1).some(e => e[0] === 'sync' && e[1] === 'directory'));
  const dirs = f.events.slice(fileSync + 1).filter(e => e[0] === 'open').map(e => e[1]);
  for (let dir = path.dirname(file);;) {
    assert.ok(dirs.includes(dir), dir);
    const parent = path.dirname(dir); if (parent === dir) break; dir = parent;
  }
  assert.equal(f.io.writeExclusive(file, 'replacement'), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.equal(f.handles.size, 0);
});

test('slot and raw legacy-copy confirmation fail closed at every file or directory sync', async t => {
  for (const operation of ['write', 'copy', 'read']) {
    const perform = f => {
      const target = path.join(f.root, 'new', 'nested', 'receipt');
      if (operation === 'write') return f.io.writeExclusive(target, 'unknown raw bytes');
      fs.writeFileSync(path.join(f.root, 'old'), 'unknown raw bytes');
      if (operation === 'copy') return f.io.copyExclusive(path.join(f.root, 'old'), target);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(f.root, 'old'), target);
      return f.io.read(target);
    };
    const baseline = fixture(t); perform(baseline);
    const count = baseline.events.filter(e => e[0] === 'sync').length;
    for (let at = 1; at <= count; at++) await t.test(`${operation} sync ${at}`, t => {
      const f = fixture(t, at, at % 2 ? 'EPERM' : 'EIO');
      assert.throws(() => perform(f), /durability could not be confirmed.*stop recovery/);
      assert.equal(f.handles.size, 0);
      if (operation !== 'write') assert.equal(fs.readFileSync(path.join(f.root, 'old'), 'utf8'), 'unknown raw bytes');
    });
  }
});

test('an absent receipt differs from lost directory confirmation and copies never overwrite a winner', t => {
  const f = fixture(t), file = path.join(f.root, 'receipt'), source = path.join(f.root, 'old');
  assert.equal(f.io.read(file), null);
  fs.writeFileSync(file, 'winner'); fs.writeFileSync(source, 'stale');
  f.io.copyExclusive(source, file);
  assert.equal(f.io.read(file), 'winner');
  const broken = createCiRetryReceiptIO({ ...fs, fsyncSync() { throw Object.assign(new Error('lost'), { code: 'ENOENT' }); } });
  assert.throws(() => broken.read(file), /durability could not be confirmed/);
  assert.equal(fs.readFileSync(source, 'utf8'), 'stale');
});

test('unsupported directory confirmation stops before creating quota directories or slots', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-receipt-unsupported-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'new', 'nested', 'slot');
  const io = createCiRetryReceiptIO({ ...fs,
    openSync(file, flags, ...rest) {
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        throw Object.assign(new Error('directory sync unsupported'), { code: 'EPERM' });
      }
      return fs.openSync(file, flags, ...rest);
    },
  });
  assert.throws(() => io.confirmParent(path.dirname(target)), /durability could not be confirmed.*stop recovery/);
  assert.throws(() => io.writeExclusive(target, 'consumed'), /durability could not be confirmed.*stop recovery/);
  assert.equal(fs.existsSync(path.join(root, 'new')), false);
});


test('a confirmed receipt parent or ancestor disappearing never becomes fresh storage', async t => {
  for (const leafExists of [true, false]) await t.test(leafExists ? 'receipt directory' : 'nearest existing ancestor', t => {
    const f = fixture(t), parent = path.join(f.root, 'parent'), dir = path.join(parent, 'receipts'), file = path.join(dir, 'one.slot');
    fs.mkdirSync(leafExists ? dir : parent, { recursive: true });
    if (leafExists) fs.writeFileSync(file, 'already consumed');
    f.io.confirmParent(dir);
    const moved = path.join(f.root, 'moved'); fs.renameSync(parent, moved);
    assert.throws(() => f.io.read(file), /durability could not be confirmed.*disappeared/);
    assert.throws(() => f.io.writeExclusive(file, 'fresh attempt'), /durability could not be confirmed.*disappeared/);
    assert.equal(fs.existsSync(parent), false, 'do not recreate a lost confirmed directory');
    if (leafExists) assert.equal(fs.readFileSync(path.join(moved, 'receipts', 'one.slot'), 'utf8'), 'already consumed');
    assert.equal(f.handles.size, 0);
  });
  const fresh = fixture(t); assert.equal(fresh.io.read(path.join(fresh.root, 'never-created', 'one.slot')), null);
  assert.equal(fs.existsSync(path.join(fresh.root, 'never-created')), false, 'fresh status remains read-only');
});


test('write preparation cannot recreate a confirmed directory lost after its final sync', async t => {
  for (const operation of ['slot', 'copy', 'missing-chain']) await t.test(operation, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-receipt-prepare-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const parent = path.join(root, 'confirmed'), moved = path.join(root, 'moved'); fs.mkdirSync(parent);
    const first = path.join(parent, 'one.slot'); fs.writeFileSync(first, 'consumed one');
    const source = path.join(root, 'legacy'); fs.writeFileSync(source, 'old evidence');
    const target = operation === 'missing-chain' ? path.join(parent, 'new', 'nested', 'two.slot') : path.join(parent, 'two.slot');
    const handles = new Map(); let armed = false, injected = false;
    const io = createCiRetryReceiptIO({ ...fs,
      openSync(file, ...args) { const fd = fs.openSync(file, ...args); handles.set(fd, path.resolve(file)); return fd; },
      closeSync(fd) { fs.closeSync(fd); handles.delete(fd); },
      fsyncSync(fd) {
        // Supported-filesystem model. Root is the last flush of confirmParent;
        // move the already-read store immediately after that acknowledgment.
        if (armed && handles.get(fd) === path.parse(parent).root) {
          armed = false; injected = true; fs.renameSync(parent, moved);
        }
      },
    });
    assert.equal(io.read(first), 'consumed one'); armed = true;
    assert.throws(() => operation === 'copy' ? io.copyExclusive(source, target) : io.writeExclusive(target, 'second consumption'), /durability could not be confirmed/);
    assert.equal(injected, true);
    assert.equal(fs.existsSync(parent), false, 'never recreate the confirmed parent or its children');
    assert.equal(fs.readFileSync(path.join(moved, 'one.slot'), 'utf8'), 'consumed one');
    assert.deepEqual(fs.readdirSync(moved), ['one.slot']);
    assert.equal(fs.readFileSync(source, 'utf8'), 'old evidence');
    assert.equal(handles.size, 0);
  });
});


test('same-path replacement of a confirmed store or ancestor cannot grant empty receipts', async t => {
  for (const target of ['store', 'ancestor']) await t.test(target, t => {
    const f = fixture(t), parent = path.join(f.root, 'parent'), dir = path.join(parent, 'store'), file = path.join(dir, 'one.slot');
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, 'consumed one');
    const source = path.join(f.root, 'legacy'); fs.writeFileSync(source, 'old bytes');
    assert.equal(f.io.read(file), 'consumed one');
    const replaced = target === 'store' ? dir : parent, moved = path.join(f.root, 'moved');
    const original = fs.statSync(replaced, { bigint: true });
    fs.renameSync(replaced, moved); fs.mkdirSync(dir, { recursive: true });
    const next = fs.statSync(replaced, { bigint: true });
    assert.notDeepEqual([next.dev, next.ino], [original.dev, original.ino]);
    assert.throws(() => f.io.read(file), /directory identity changed/);
    assert.throws(() => f.io.writeExclusive(file, 'new consumption'), /directory identity changed/);
    assert.throws(() => f.io.copyExclusive(source, file), /directory identity changed/);
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.equal(fs.readFileSync(path.join(moved, target === 'store' ? '' : 'store', 'one.slot'), 'utf8'), 'consumed one');
    assert.equal(f.handles.size, 0);
  });
});

test('unknown directory identity stops before any receipt write', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-receipt-unknown-id-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const io = createCiRetryReceiptIO({ ...fs,
    fstatSync(fd, options) {
      const stat = fs.fstatSync(fd, options);
      return Object.assign(Object.create(stat), { ino: 0n });
    },
    fsyncSync() {}, // supported-sync model with unavailable identity
  });
  assert.throws(() => io.writeExclusive(path.join(root, 'new', 'one.slot'), 'consumed'), /directory identity.*unknown/);
  assert.equal(fs.existsSync(path.join(root, 'new')), false);
});

test('signed high-bit directory identities remain opaque and detect replacement', async t => {
  for (const signedDevice of [false, true]) await t.test(signedDevice ? 'device and inode' : 'inode', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-receipt-signed-id-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dir = path.join(root, 'store'), moved = path.join(root, 'moved'); fs.mkdirSync(dir);
    const file = path.join(dir, 'one.slot'), copy = path.join(dir, 'legacy'), source = path.join(root, 'source');
    fs.writeFileSync(source, 'old evidence');
    const handles = new Set(), highBit = 1n << 63n;
    const signed = stat => Object.assign(Object.create(stat), {
      ino: BigInt.asIntN(64, stat.ino | highBit),
      dev: signedDevice ? BigInt.asIntN(64, stat.dev | highBit) : stat.dev,
    });
    const io = createCiRetryReceiptIO({ ...fs,
      statSync(file, options) { return signed(fs.statSync(file, options)); },
      fstatSync(fd, options) { return signed(fs.fstatSync(fd, options)); },
      openSync(file, ...args) { const fd = fs.openSync(file, ...args); handles.add(fd); return fd; },
      closeSync(fd) { fs.closeSync(fd); handles.delete(fd); },
      fsyncSync() {}, // signed-ID/supported-sync model, not native Linux or power-loss evidence
    });
    assert.ok(signed(fs.statSync(dir, { bigint: true })).ino < 0n);
    io.confirmParent(dir);
    assert.equal(io.read(file), null);
    assert.equal(io.writeExclusive(file, 'consumed one'), true);
    assert.equal(io.writeExclusive(file, 'do not replace'), false);
    assert.equal(io.read(file), 'consumed one');
    io.copyExclusive(source, copy); assert.equal(io.read(copy), 'old evidence');
    fs.renameSync(dir, moved); fs.mkdirSync(dir);
    assert.throws(() => io.read(file), /directory identity changed/);
    assert.throws(() => io.writeExclusive(file, 'new consumption'), /directory identity changed/);
    assert.throws(() => io.copyExclusive(source, copy), /directory identity changed/);
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.equal(fs.readFileSync(path.join(moved, 'one.slot'), 'utf8'), 'consumed one');
    assert.equal(fs.readFileSync(path.join(moved, 'legacy'), 'utf8'), 'old evidence');
    assert.equal(handles.size, 0);
  });
});


test('replacement during ancestor flush is rejected before a receipt read succeeds', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-receipt-flush-swap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'store'), moved = path.join(root, 'moved'); fs.mkdirSync(dir);
  const file = path.join(dir, 'one.slot'); fs.writeFileSync(file, 'consumed one');
  const handles = new Map(); let armed = false, swapped = false, blocked = false;
  const io = createCiRetryReceiptIO({ ...fs,
    openSync(file, ...args) { const fd = fs.openSync(file, ...args); handles.set(fd, path.resolve(file)); return fd; },
    closeSync(fd) { fs.closeSync(fd); handles.delete(fd); },
    fsyncSync(fd) {
      if (armed && handles.get(fd) === path.parse(dir).root) {
        armed = false; swapped = true;
        try { fs.renameSync(dir, moved); }
        catch (error) {
          if (process.platform === 'win32' && error.code === 'EPERM') blocked = true;
          throw error;
        }
        fs.mkdirSync(dir);
      }
    },
  });
  io.confirmParent(dir); armed = true;
  assert.throws(() => io.read(file), /directory identity changed|EPERM/);
  assert.equal(swapped, true);
  if (blocked) {
    assert.equal(fs.existsSync(moved), false, 'open file descriptor prevents the Windows ancestor rename');
    assert.equal(fs.readFileSync(file, 'utf8'), 'consumed one');
  } else {
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.equal(fs.readFileSync(path.join(moved, 'one.slot'), 'utf8'), 'consumed one');
  }
  assert.equal(handles.size, 0);
});
