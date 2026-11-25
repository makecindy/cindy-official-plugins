import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCiRetryReceiptIO } from '../../cindy-github/skills/pr/scripts/lib/ci-retry-receipts.mjs';

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


test('replacement during ancestor flush is rejected before a receipt read succeeds', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-receipt-flush-swap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'store'), moved = path.join(root, 'moved'); fs.mkdirSync(dir);
  const file = path.join(dir, 'one.slot'); fs.writeFileSync(file, 'consumed one');
  const handles = new Map(); let armed = false, swapped = false;
  const io = createCiRetryReceiptIO({ ...fs,
    openSync(file, ...args) { const fd = fs.openSync(file, ...args); handles.set(fd, path.resolve(file)); return fd; },
    closeSync(fd) { fs.closeSync(fd); handles.delete(fd); },
    fsyncSync(fd) {
      if (armed && handles.get(fd) === path.parse(dir).root) {
        armed = false; swapped = true; fs.renameSync(dir, moved); fs.mkdirSync(dir);
      }
    },
  });
  io.confirmParent(dir); armed = true;
  assert.throws(() => io.read(file), /directory identity changed/);
  assert.equal(swapped, true);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(fs.readFileSync(path.join(moved, 'one.slot'), 'utf8'), 'consumed one');
  assert.equal(handles.size, 0);
});
