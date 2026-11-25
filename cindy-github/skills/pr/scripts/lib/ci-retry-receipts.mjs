import fs from 'node:fs';
import path from 'node:path';

// Node omits fs.constants.O_SYNC on Windows. Numeric open flags are forwarded
// to libuv, whose Windows UV_FS_O_SYNC requests FILE_FLAG_WRITE_THROUGH.
// Verified against the executing Node 22.22.3 / libuv 1.51.0:
// https://github.com/libuv/libuv/blob/v1.51.0/include/uv/win.h
const WINDOWS_WRITE_THROUGH = 0x08000000;

// One I/O boundary for the existing immutable receipts. No alternate store,
// deletion or retry: a failed file flush must stop recovery. POSIX also syncs
// every parent directory. Windows uses write-through file handles plus fsync;
// it does not claim POSIX-style confirmation of the complete parent chain.
// The injected filesystem is for tests; the CLI always uses Node's real fs.
export function createCiRetryReceiptIO(io = fs, { platform = process.platform } = {}) {
  const windows = platform === 'win32';
  function syncDirectories(dir) {
    if (windows) return;
    for (let current = path.resolve(dir);;) {
      const fd = io.openSync(current, 'r');
      try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
      const parent = path.dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }

  function confirmParent(dir) {
    let current = path.resolve(dir);
    for (;;) {
      try {
        if (!io.statSync(current).isDirectory()) throw new Error('receipt parent is not a directory');
        break;
      }
      catch (error) {
        const parent = path.dirname(current);
        if (error.code !== 'ENOENT' || parent === current) throw error;
        current = parent;
      }
    }
    syncDirectories(current);
  }

  function prepare(file) {
    const dir = path.dirname(file);
    confirmParent(dir);
    io.mkdirSync(dir, { recursive: true });
    // Includes ancestors: a recursive mkdir can introduce several new links.
    syncDirectories(dir);
  }

  function read(file) {
    let fd;
    try { fd = io.openSync(file, windows ? io.constants.O_RDWR | WINDOWS_WRITE_THROUGH : 'r+'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    let raw;
    try { raw = io.readFileSync(fd, 'utf8'); io.fsyncSync(fd); }
    finally { io.closeSync(fd); }
    // An ENOENT here is not an absent receipt and must not become fresh quota.
    syncDirectories(path.dirname(file));
    return raw;
  }

  function writeExclusive(file, raw) {
    prepare(file);
    let fd;
    const flags = windows
      ? io.constants.O_WRONLY | io.constants.O_CREAT | io.constants.O_EXCL | WINDOWS_WRITE_THROUGH
      : 'wx';
    try { fd = io.openSync(file, flags, 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (read(file) === null) throw new Error('CI retry receipt disappeared after exclusive collision');
      return false;
    }
    try { io.writeFileSync(fd, raw); io.fsyncSync(fd); }
    finally { io.closeSync(fd); }
    syncDirectories(path.dirname(file));
    return true;
  }

  function copyExclusive(source, target) {
    if (windows) {
      // copyFile cannot request a write-through destination handle. Keep the
      // same exclusive winner and raw bytes through the existing write owner.
      writeExclusive(target, io.readFileSync(source));
      return;
    }
    prepare(target);
    try { io.copyFileSync(source, target, io.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    // Sync the actual winning file, including an earlier exclusive copy.
    if (read(target) === null) throw new Error('CI retry receipt disappeared during preservation');
  }

  function checked(fn) {
    return (...args) => {
      try { return fn(...args); }
      catch (error) {
        throw new Error(`CI retry receipt durability could not be confirmed (${error.code || error.message}); stop recovery. Keep receipts and observation cache; do not amend, push, refund or retry with another data directory.`, { cause: error });
      }
    };
  }
  return Object.fromEntries(Object.entries({ confirmParent, read, writeExclusive, copyExclusive })
    .map(([name, fn]) => [name, checked(fn)]));
}
