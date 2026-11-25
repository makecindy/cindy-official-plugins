import fs from 'node:fs';
import path from 'node:path';

// One I/O boundary for the existing immutable receipts. No alternate store,
// fallback, deletion or retry: unsupported/uncertain sync must stop recovery.
// The injected filesystem is for tests; the CLI always uses Node's real fs.
export function createCiRetryReceiptIO(io = fs) {
  // Invocation-local observations, never a cached receipt or durable marker.
  const confirmedDirectories = new Set();
  function syncDirectories(dir) {
    for (let current = path.resolve(dir);;) {
      const fd = io.openSync(current, 'r');
      try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
      confirmedDirectories.add(current);
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
        if (error.code === 'ENOENT' && confirmedDirectories.has(current)) {
          throw new Error('previously confirmed receipt directory disappeared');
        }
        const parent = path.dirname(current);
        if (error.code !== 'ENOENT' || parent === current) throw error;
        current = parent;
      }
    }
    syncDirectories(current);
    return current;
  }

  function prepare(file) {
    const dir = path.resolve(path.dirname(file));
    let current = confirmParent(dir);
    // Existing directories need no mkdir. Create only the missing suffix,
    // one non-recursive link at a time: a lost parent must cause ENOENT,
    // never recursive reconstruction of an already-confirmed store.
    for (const part of path.relative(current, dir).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      try { io.mkdirSync(current); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!io.statSync(current).isDirectory()) throw new Error('receipt parent is not a directory');
      }
      syncDirectories(current);
    }
  }

  function read(file) {
    let fd;
    try { fd = io.openSync(file, 'r+'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      confirmParent(path.dirname(file));
      return null;
    }
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
    try { fd = io.openSync(file, 'wx', 0o600); }
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
