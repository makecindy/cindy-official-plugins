import fs from 'node:fs';
import path from 'node:path';

// One I/O boundary for the existing immutable receipts. No alternate store,
// fallback, deletion or retry: unsupported/uncertain sync must stop recovery.
// The injected filesystem is for tests; the CLI always uses Node's real fs.
export function createCiRetryReceiptIO(io = fs) {
  // Invocation-local observations, never a cached receipt or durable marker.
  const confirmedDirectories = new Map();
  function fileIdentity(stat) {
    if (!stat.isFile() || typeof stat.dev !== 'bigint' || typeof stat.ino !== 'bigint' || stat.ino === 0n) {
      throw new Error('receipt file identity is unknown');
    }
    return { dev: stat.dev, ino: stat.ino };
  }
  function confirmFile(file, fd, identity) {
    for (const stat of [io.fstatSync(fd, { bigint: true }), io.statSync(file, { bigint: true })]) {
      const current = fileIdentity(stat);
      if (current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('receipt file identity changed');
    }
  }
  function observeDirectory(dir, stat) {
    // Node may expose high-bit filesystem IDs as signed BigInts; compare them
    // losslessly as opaque values rather than imposing a positive-number range.
    if (!stat.isDirectory() || typeof stat.dev !== 'bigint' || typeof stat.ino !== 'bigint' || stat.ino === 0n) {
      throw new Error('receipt directory identity is unknown');
    }
    const known = confirmedDirectories.get(dir);
    if (known && (known.dev !== stat.dev || known.ino !== stat.ino)) throw new Error('receipt directory identity changed');
    confirmedDirectories.set(dir, { dev: stat.dev, ino: stat.ino });
  }
  function syncDirectories(dir) {
    const target = path.resolve(dir);
    for (let current = target;;) {
      const fd = io.openSync(current, 'r');
      try {
        observeDirectory(current, io.fstatSync(fd, { bigint: true }));
        io.fsyncSync(fd);
      } finally { io.closeSync(fd); }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    observeDirectory(target, io.statSync(target, { bigint: true }));
  }

  function confirmParent(dir) {
    let current = path.resolve(dir);
    for (;;) {
      try {
        observeDirectory(current, io.statSync(current, { bigint: true }));
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
        observeDirectory(current, io.statSync(current, { bigint: true }));
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
      try { io.statSync(file, { bigint: true }); }
      catch (check) { if (check.code === 'ENOENT') return null; throw check; }
      throw new Error('receipt appeared during absence confirmation');
    }
    try {
      const identity = fileIdentity(io.fstatSync(fd, { bigint: true }));
      const raw = io.readFileSync(fd, 'utf8'); io.fsyncSync(fd);
      // Keep the descriptor open through the full barrier and path recheck.
      syncDirectories(path.dirname(file));
      confirmFile(file, fd, identity);
      return raw;
    } finally { io.closeSync(fd); }
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
    try {
      const identity = fileIdentity(io.fstatSync(fd, { bigint: true }));
      io.writeFileSync(fd, raw); io.fsyncSync(fd);
      syncDirectories(path.dirname(file));
      confirmFile(file, fd, identity);
      return true;
    } finally { io.closeSync(fd); }
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
