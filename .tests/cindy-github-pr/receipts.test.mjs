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
