const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function resolveWorkspacePath(workspace, input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Invalid workspace path');
  const root = await fs.realpath(workspace);
  const requested = path.resolve(workspace, input);
  if (!isWithin(workspace, requested) && !isWithin(root, requested)) {
    throw new Error('Path is outside the task workspace');
  }
  let current = requested;
  const missing = [];
  for (;;) {
    const exists = await fs.lstat(current).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (exists) break;
    missing.unshift(path.basename(current));
    current = path.dirname(current);
  }
  const resolved = path.join(await fs.realpath(current), ...missing);
  if (!isWithin(root, resolved)) throw new Error('Path resolves outside the task workspace');
  return resolved;
}

async function workspaceArguments(tool, args, workspace) {
  const checked = { ...args };
  const fields = tool === 'Artifact' ? ['folder'] : tool === 'ArtifactData' ? ['file_path', 'out_file'] : [];
  for (const field of fields) {
    if (Object.hasOwn(checked, field)) checked[field] = await resolveWorkspacePath(workspace, checked[field]);
  }
  if (tool === 'ArtifactData' && Array.isArray(checked.writes)) {
    checked.writes = await Promise.all(checked.writes.map(async write =>
      write && Object.hasOwn(write, 'file_path')
        ? { ...write, file_path: await resolveWorkspacePath(workspace, write.file_path) }
        : write));
  }
  if (tool === 'Artifact' && !checked.url && !checked.folder &&
      (checked.action === 'publish' || checked.action === undefined)) {
    await resolveWorkspacePath(workspace, 'artifacts');
  }
  return checked;
}

async function verifyRuntime(root, inventory) {
  const remaining = new Set(Object.keys(inventory));
  const directories = new Set([...remaining].flatMap(file => {
    const parts = file.split('/');
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
  }));
  const fail = () => { throw new Error('Open Artifact runtime integrity check failed'); };

  async function walk(folder, prefix = '') {
    for (const name of await fs.readdir(folder)) {
      const absolute = path.join(folder, name);
      const relative = prefix + name;
      const stat = await fs.lstat(absolute);
      if (stat.isDirectory() && !stat.isSymbolicLink() && directories.has(relative)) {
        await walk(absolute, relative + '/');
      } else {
        if (!stat.isFile() || stat.nlink !== 1 || !remaining.delete(relative)) fail();
        const hash = createHash('sha256').update(await fs.readFile(absolute)).digest('hex');
        if (hash !== inventory[relative]) fail();
      }
    }
  }

  if (!(await fs.lstat(root)).isDirectory()) fail();
  await walk(root);
  if (remaining.size) fail();
}

module.exports = { resolveWorkspacePath, verifyRuntime, workspaceArguments };
