const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const actionPathFields = new Map([
  ['upload', ['file']],
  ['import', ['file']],
  ['export', ['file', 'out']],
  ['widget', ['codeFile']],
]);

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
  return checked;
}

async function artifactFileArguments(args, root) {
  const checked = { ...args };
  async function relativeFile(input) {
    if (typeof input !== 'string' || input.includes('\0')) throw new Error('Invalid artifact file path');
    // Match the bundled runtime's relative-path interpretation before resolving filesystem links.
    const file = input.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!file.trim()) throw new Error('Invalid artifact file path');
    await resolveWorkspacePath(root, file);
    return file;
  }
  async function fileMap(input) {
    const entries = await Promise.all(Object.entries(input).map(async ([file, value]) =>
      [await relativeFile(file), value]));
    const result = Object.fromEntries(entries);
    if (Object.keys(result).length !== entries.length) throw new Error('Duplicate artifact file path');
    return result;
  }

  if (Object.hasOwn(checked, 'path')) checked.path = await relativeFile(checked.path);
  if (Array.isArray(checked.paths)) checked.paths = await Promise.all(checked.paths.map(relativeFile));
  if (Array.isArray(checked.files)) {
    checked.files = await Promise.all(checked.files.map(async file => ({ ...file, path: await relativeFile(file?.path) })));
  } else if (checked.files && typeof checked.files === 'object') {
    checked.files = await fileMap(checked.files);
  }
  if (checked.if_match && typeof checked.if_match === 'object' && !Array.isArray(checked.if_match)) {
    checked.if_match = await fileMap(checked.if_match);
  }
  return checked;
}

function exportFilename(title, part, extension) {
  const stem = [title, part].filter(Boolean).join(' - ')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120);
  return `${stem || 'Artifact'}.${extension}`;
}

async function sheetExportPath(args, workspace, artifact) {
  if (args.file !== undefined) {
    const stat = await fs.stat(args.file).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!stat?.isDirectory()) return args.file;
  }
  const directory = args.file ?? path.join(artifact.root, 'exports');
  const csv = args.csv === true || /\.csv$/i.test(directory);
  const filename = exportFilename(artifact.title, csv && args.sheet, csv ? 'csv' : 'xlsx');
  return resolveWorkspacePath(workspace, path.join(directory, filename));
}

async function artifactActionArguments(name, args, workspace, artifact) {
  if (args != null && (typeof args !== 'object' || Array.isArray(args))) return args;
  const checked = { ...args };
  for (const field of actionPathFields.get(name) ?? []) {
    if (Object.hasOwn(checked, field)) checked[field] = await resolveWorkspacePath(workspace, checked[field]);
  }
  if (name === 'batch' && Array.isArray(checked.calls)) {
    checked.calls = await Promise.all(checked.calls.map(async call => {
      const payload = call?.payload;
      if (!payload || !Object.hasOwn(payload, 'codeFile')) return call;
      const codeFile = await resolveWorkspacePath(workspace, payload.codeFile);
      return { ...call, payload: { ...payload, codeFile } };
    }));
  }
  // Pass an explicit, checked output file when the runtime would choose its own filename.
  if (name === 'export' && artifact.type === 'sheets') {
    checked.file = await sheetExportPath(checked, workspace, artifact);
  } else if (name === 'export' && artifact.type === 'docs' && checked.out === undefined &&
      ['docx', 'pdf', 'html'].includes(checked.format)) {
    const file = exportFilename(artifact.title, checked.tab, checked.format);
    checked.out = await resolveWorkspacePath(workspace, path.join(artifact.root, 'exports', file));
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

module.exports = { artifactActionArguments, artifactFileArguments, resolveWorkspacePath, verifyRuntime, workspaceArguments };
