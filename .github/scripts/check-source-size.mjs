// Bound directly tracked binaries per plugin, across every platform. Unchanged
// legacy binaries do not force a migration when only source/docs are edited.
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';

const base = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(base ?? '')) throw new Error('Pass the verified base commit SHA');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const changed = new Set(git('diff', '--name-only', '--no-renames', '--diff-filter=AM', '-z', base, 'HEAD', '--').split('\0'));
const files = git('ls-tree', '-r', '-l', '-z', 'HEAD').split('\0').filter(Boolean).map(record => {
  const tab = record.indexOf('\t');
  const [, type, oid, size] = record.slice(0, tab).trim().split(/\s+/);
  return { path: record.slice(tab + 1), type, oid, size: Number(size) };
}).filter(file => file.type === 'blob');
const oldManifests = new Set(git('ls-tree', '-r', '--name-only', '-z', base).split('\0'));
const plugins = files.filter(file => /^[^/]+\/ghost\.json$/.test(file.path));
const binaryByOid = new Map();

async function isBinary(file) {
  if (binaryByOid.has(file.oid)) return binaryByOid.get(file.oid);
  // Inspect committed bytes, not extensions or editable .gitattributes. Stream
  // the full blob so a text prefix cannot hide a binary tail; never execute it.
  const child = spawn('git', ['cat-file', 'blob', file.oid], { stdio: ['ignore', 'pipe', 'inherit'] });
  const closed = once(child, 'close');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let binary = false;
  for await (const chunk of child.stdout) {
    if (binary) continue;
    try {
      binary = chunk.includes(0);
      if (!binary) decoder.decode(chunk, { stream: true });
    } catch {
      binary = true;
    }
  }
  const [code] = await closed;
  if (code !== 0) throw new Error(`Cannot inspect Git blob ${file.oid}`);
  if (!binary) {
    try { decoder.decode(); } catch { binary = true; }
  }
  binaryByOid.set(file.oid, binary);
  return binary;
}

for (const manifest of plugins) {
  const plugin = manifest.path.slice(0, -'/ghost.json'.length);
  const entries = files.filter(file => file.path.startsWith(`${plugin}/`));
  let check = !oldManifests.has(manifest.path);
  if (!check) {
    for (const file of entries) {
      if (changed.has(file.path) && await isBinary(file)) { check = true; break; }
    }
  }
  if (!check) continue;
  let total = 0;
  for (const file of entries) {
    if (await isBinary(file)) total += file.size;
  }
  if (total > 10 * 1024 * 1024) {
    throw new Error(`${JSON.stringify(plugin)} has ${total} bytes of tracked binaries across all platforms, exceeding the 10 MiB per-plugin total. Move large dependencies to binary-dependencies.json; downloaded build inputs do not count toward this Git limit.`);
  }
}
