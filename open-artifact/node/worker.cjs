const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { artifactActionArguments, resolveWorkspacePath, verifyRuntime, workspaceArguments } = require('./safety.cjs');
const runtimeInventory = require('../vendor/runtime-integrity.json');

const version = '0.14.6';
const runtimeArchive = path.join(__dirname, '../vendor/open-artifact-runtime/runtime.tgz');
const pinnedIntegrity = 'ZxJs17HHSkH8+AOXx+CIgWfoIrTqaqJGTKVVRlyhtTZXWc7sdINlrV0sPrx5I/3ERXT880CEX+KUH74sv+Yz2g==';
const allowedTools = new Set(['Artifact', 'ArtifactData', 'ArtifactComments']);
const sessions = new Map();
const hostRequests = new Map();
let adapter;
let runtime;
let ownerScope;

function send(frame) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n');
}

function callHost(method, params, timedOutValue, timeoutMs = 20000) {
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      hostRequests.delete(id);
      resolve(timedOutValue);
    }, timeoutMs);
    hostRequests.set(id, answer => {
      clearTimeout(timer);
      hostRequests.delete(id);
      resolve(answer);
    });
    send({ method, params: { ...params, id } });
  });
}

async function prepareRuntime(home, kit) {
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const folder = path.join(home, `runtime-${version}`);
  const exists = await fs.lstat(folder).then(() => true, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (exists) {
    await verifyRuntime(folder, runtimeInventory);
    return folder;
  }

  const integrity = crypto.createHash('sha512').update(await fs.readFile(runtimeArchive)).digest('base64');
  if (integrity !== pinnedIntegrity) throw new Error('Open Artifact runtime integrity check failed');
  const stage = await fs.mkdtemp(path.join(home, 'extract-'));
  try {
    await kit.extractTar({
      file: runtimeArchive, cwd: stage, strip: 1, strict: true,
      filter: (_, entry) => ['File', 'Directory'].includes(entry.type),
    });
    await verifyRuntime(stage, runtimeInventory);
    await fs.rename(stage, folder);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
  return folder;
}

function onWake(params) {
  const { session, source, artifactId, text } = params;
  if (!session || !sessions.has(session) || source?.from?.kind !== 'owner' ||
      !['comment', 'request'].includes(source.reason) || !artifactId ||
      typeof text !== 'string' || text.length === 0 || text.length > 32768) return 'failed';
  const event = JSON.stringify([session, artifactId, source.reason, source.threads, source.requests, text]);
  const requestKey = 'open-artifact:' + crypto.createHash('sha256').update(event).digest('hex');
  return callHost('artifact/wake', { session, text, requestKey }, 'failed');
}

function onOpen({ session, viewUrl }) {
  if (!session || !sessions.has(session)) return false;
  const url = new URL(viewUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      url.username || url.password || !url.port || !url.pathname.startsWith('/a/')) return false;
  return callHost('artifact/open', { session, url: url.href }, false);
}

async function connect(scope) {
  if (typeof scope !== 'string' || !/^[a-f0-9-]{36}$/.test(scope)) throw new Error('Invalid runtime scope');
  if (ownerScope && scope !== ownerScope) throw new Error('Runtime scope changed');
  ownerScope = scope;
  runtime ??= (async () => {
    const home = path.join(os.homedir(), '.cindy-open-artifact', scope);
    adapter ??= import('../vendor/adapter.mjs');
    const kit = await adapter;
    const dir = await prepareRuntime(home, kit);
    return kit.createHarness({
      home, harness: 'cindy', agentName: 'Cindy', commands: ['artifacts'],
      runtime: { dir, version, update: 'bundled' },
      caps: { tools: 'native', wake: { resume: true } },
      embed: { origins: [], mode: 'view', remote: 'deny' },
      daemon: {
        bin: path.join(dir, 'scripts', 'open-artifact.mjs'),
        spawn: async () => {
          await verifyRuntime(dir, runtimeInventory);
          return globalThis.__CINDY_NODE__.spawnEntry('node/daemon.cjs', [home]);
        },
      },
      open: onOpen,
      wake: onWake,
    });
  })().catch(error => {
    runtime = undefined;
    throw error;
  });
  return runtime;
}

async function* artifactPages(harness, caller, scope) {
  let cursor;
  do {
    const page = await harness.call('Artifact', { action: 'list', scope, limit: 200, cursor }, caller);
    if (page?.error || !Array.isArray(page?.artifacts)) throw new Error('Artifact listing is unavailable');
    yield page.artifacts;
    cursor = page.next_cursor;
  } while (cursor);
}

async function workspaceArtifact(harness, url, caller) {
  for await (const items of artifactPages(harness, caller, 'mine')) {
    const artifact = items.find(item => item.url === url);
    if (artifact) return { ...artifact, root: await resolveWorkspacePath(caller.workspace, artifact.root) };
  }
  throw new Error('Artifact is unavailable in the task workspace');
}

async function adoptionTarget(harness, args, caller) {
  const root = args.url ? null : await resolveWorkspacePath(caller.workspace, args.folder);
  let found;
  // The upstream `mine` filter can omit another task's work at the exact workspace root.
  for await (const items of artifactPages(harness, caller, 'all')) {
    for (const item of items) {
      if (args.url && item.url !== args.url) continue;
      const resolved = await resolveWorkspacePath(caller.workspace, item.root).catch(error => {
        if (args.url || path.resolve(item.root) === root) throw error;
        return null;
      });
      if (!args.url && resolved !== root) continue;
      if (found || typeof item.url !== 'string' || !item.url || typeof item.owner !== 'string' || !item.owner.trim()) {
        throw new Error('Artifact ownership is unavailable or ambiguous');
      }
      found = { ...item, root: resolved };
      if (args.url) return found;
    }
  }
  if (args.url) throw new Error('Artifact is unavailable in the task workspace');
  return found ?? { root, url: null, owner: null, title: path.basename(root) };
}

async function adopt(harness, args, caller) {
  if (!args.url && !args.folder) return { error: { message: 'Choose a work or folder to adopt.' } };
  const before = await adoptionTarget(harness, args, caller);
  const answer = await callHost('artifact/confirm-adopt', {
    session: caller.session, title: before.title || path.basename(before.root), owner: before.owner,
  }, false, 95000);
  if (answer !== true) return { error: { message: 'Adoption was not confirmed.' } };

  const after = await adoptionTarget(harness, args, caller);
  if (after.root !== before.root || after.url !== before.url || after.owner !== before.owner ||
      sessions.get(caller.session) !== caller.workspace) {
    return { error: { message: 'The work or task changed while confirming. Reopen the work and try again if you still want to move it.' } };
  }
  const selection = after.url ? { url: after.url } : { folder: after.root };
  return harness.call('Artifact', { ...args, ...selection }, caller);
}

async function checkArtifactArguments(harness, tool, args, caller) {
  if (!args.url) return args;
  const artifact = await workspaceArtifact(harness, args.url, caller);
  if (tool !== 'Artifact') return args;
  const paths = [args.path, ...(Array.isArray(args.paths) ? args.paths : []),
    ...Object.keys(args.files ?? {})].filter(value => value !== undefined);
  await Promise.all(paths.map(file => resolveWorkspacePath(artifact.root, file)));
  if (args.action !== 'call') return args;
  const checked = await artifactActionArguments(args.name, args.args, caller.workspace, artifact);
  return { ...args, args: checked };
}

async function run({ method, params, id }) {
  try {
    if (method === 'host/complete') {
      hostRequests.get(params.id)?.(params.answer);
      send({ id, result: true });
      return;
    }
    if (method !== 'artifact/call' || !allowedTools.has(params?.tool) ||
        typeof params.session !== 'string' || typeof params.workspace !== 'string' ||
        !path.isAbsolute(params.workspace)) {
      send({ id, error: { code: -32602, message: 'Invalid Open Artifact request' } });
      return;
    }
    const caller = { session: params.session, workspace: params.workspace };
    let args;
    try {
      args = await workspaceArguments(params.tool, params.args, caller.workspace);
    } catch {
      send({ id, error: { code: -32602, message: 'Use files and directories inside the task workspace.' } });
      return;
    }
    const harness = await connect(params.scope);
    const adopting = params.tool === 'Artifact' && args.action === 'adopt';
    try {
      if (!adopting) args = await checkArtifactArguments(harness, params.tool, args, caller);
    } catch {
      send({ id, error: { code: -32602, message: 'The artifact or file is unavailable in the task workspace.' } });
      return;
    }
    if (sessions.get(caller.session) !== caller.workspace) {
      sessions.set(caller.session, caller.workspace);
      try {
        await harness.attach(caller);
      } catch (error) {
        sessions.delete(caller.session);
        throw error;
      }
    }
    const pulse = params.tool === 'ArtifactComments' && params.args?.action === 'wait'
      ? setInterval(() => send({ method: 'artifact/progress', params: {} }), 45000)
      : undefined;
    try {
      const result = adopting
        ? await adopt(harness, args, caller)
        : await harness.call(params.tool, args, caller);
      send({ id, result });
    } finally {
      if (pulse) clearInterval(pulse);
    }
  } catch (error) {
    const message = error.message === 'Open Artifact runtime integrity check failed'
      ? error.message : 'Open Artifact runtime or tool unavailable';
    send({ id, error: { code: -32000, message } });
  }
}

readline.createInterface({ input: process.stdin })
  .on('line', line => {
    try {
      const frame = JSON.parse(line);
      if (frame && Object.hasOwn(frame, 'id')) void run(frame);
    } catch {
      // An unparseable frame cannot be correlated with a host request.
    }
  })
  .on('close', () => { void runtime?.then(harness => harness.close()).catch(() => {}); });
