const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { artifactActionArguments, artifactFileArguments, resolveWorkspacePath, verifyRuntime, workspaceArguments } = require('./safety.cjs');
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

async function* artifactPages(call) {
  let cursor;
  do {
    // The upstream `mine` filter can omit another task's work at the exact workspace root.
    const page = await call('Artifact', { action: 'list', scope: 'all', limit: 200, cursor });
    if (page?.error || !Array.isArray(page?.artifacts)) throw new Error('Artifact listing is unavailable');
    yield page.artifacts;
    cursor = page.next_cursor;
  } while (cursor);
}

async function workspaceArtifact(call, url, caller) {
  for await (const items of artifactPages(call)) {
    const artifact = items.find(item => item.url === url);
    if (artifact) return { ...artifact, root: await resolveWorkspacePath(caller.workspace, artifact.root) };
  }
  throw new Error('Artifact is unavailable in the task workspace');
}

function requireAdoptionOwner(artifact) {
  const owner = artifact.owner;
  if (typeof artifact.url !== 'string' || !artifact.url ||
      (owner !== null && (typeof owner !== 'string' || !owner.trim()))) {
    throw new Error('Artifact ownership is unavailable');
  }
  return artifact;
}

async function adoptionTarget(call, args, caller) {
  if (args.url) return requireAdoptionOwner(await workspaceArtifact(call, args.url, caller));
  const root = await resolveWorkspacePath(caller.workspace, args.folder);
  let found;
  for await (const items of artifactPages(call)) {
    for (const item of items) {
      const resolved = await resolveWorkspacePath(caller.workspace, item.root).catch(error => {
        if (path.resolve(item.root) === root) throw error;
        return null;
      });
      if (resolved !== root) continue;
      if (found) throw new Error('Artifact ownership is ambiguous');
      found = requireAdoptionOwner({ ...item, root: resolved });
    }
  }
  return found ?? { root, url: null, owner: null, title: path.basename(root) };
}

async function adopt(call, args, caller) {
  if (!args.url && !args.folder) return { error: { message: 'Choose a work or folder to adopt.' } };
  const before = await adoptionTarget(call, args, caller);
  const answer = await callHost('artifact/confirm-adopt', {
    session: caller.session, title: before.title || path.basename(before.root), owner: before.owner,
  }, false, 95000);
  if (answer !== true) return { error: { message: 'Adoption was not confirmed.' } };

  const after = await adoptionTarget(call, args, caller);
  if (after.root !== before.root || after.url !== before.url || after.owner !== before.owner ||
      sessions.get(caller.session) !== caller.workspace) {
    return { error: { message: 'The work or task changed while confirming. Reopen the work and try again if you still want to move it.' } };
  }
  const selection = after.url ? { url: after.url } : { folder: after.root };
  return call('Artifact', { ...args, ...selection });
}

async function checkArtifactArguments(call, tool, args, caller) {
  if (!args.url) return args;
  const artifact = await workspaceArtifact(call, args.url, caller);
  if (tool !== 'Artifact') return args;
  const checked = await artifactFileArguments(args, artifact.root);
  if (checked.action === 'call') {
    checked.args = await artifactActionArguments(checked.name, checked.args, caller.workspace, artifact);
  }
  return checked;
}

async function run({ method, params, id }) {
  const statusField = params?.statusField;
  const messages = [];
  let dispatched = false;
  function fail(code, message) {
    const data = messages.length ? { messages } : {};
    if (statusField === 'publicationStatus' || statusField === 'executionStatus') {
      data[statusField] = dispatched ? 'unknown' : 'not_executed';
    }
    send({ id, error: { code, message, ...(Object.keys(data).length ? { data } : {}) } });
  }
  try {
    if (method === 'host/complete') {
      hostRequests.get(params.id)?.(params.answer);
      send({ id, result: true });
      return;
    }
    if (method !== 'artifact/call' || !allowedTools.has(params?.tool) ||
        typeof params.session !== 'string' || typeof params.workspace !== 'string' ||
        !path.isAbsolute(params.workspace)) {
      fail(-32602, 'Invalid Open Artifact request');
      return;
    }
    const caller = { session: params.session, workspace: params.workspace };
    let args;
    try {
      args = await workspaceArguments(params.tool, params.args, caller.workspace);
    } catch {
      fail(-32602, 'Use files and directories inside the task workspace.');
      return;
    }
    if (statusField === 'publicationStatus' && !args.url) {
      fail(-32602, 'Choose an artifact to publish.');
      return;
    }
    const harness = await connect(params.scope);
    // Each upstream tool call can drain the task inbox, including the internal listing pages.
    const call = async (tool, input) => {
      const result = await harness.call(tool, input, caller);
      if (Array.isArray(result?.messages)) messages.push(...result.messages);
      return result;
    };
    const adopting = params.tool === 'Artifact' && args.action === 'adopt';
    try {
      if (!adopting) args = await checkArtifactArguments(call, params.tool, args, caller);
    } catch {
      fail(-32602, 'The artifact or file is unavailable in the task workspace.');
      return;
    }
    if (sessions.get(caller.session) !== caller.workspace) {
      sessions.set(caller.session, caller.workspace);
      try {
        const { inbox } = await harness.attach(caller);
        for (const item of inbox) {
          if (typeof item?.text === 'string') messages.push(item.text);
        }
      } catch (error) {
        sessions.delete(caller.session);
        throw error;
      }
    }
    const waitingForComments = params.tool === 'ArtifactComments' && args.action === 'wait';
    if (waitingForComments && messages.length) {
      send({ id, result: { messages } });
      return;
    }
    const pulse = waitingForComments
      ? setInterval(() => send({ method: 'artifact/progress', params: {} }), 45000)
      : undefined;
    try {
      dispatched = true;
      const result = adopting
        ? await adopt(call, args, caller)
        : await call(params.tool, args);
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid Open Artifact result');
      send({ id, result: messages.length ? { ...result, messages } : result });
    } finally {
      if (pulse) clearInterval(pulse);
    }
  } catch (error) {
    const message = error.message === 'Open Artifact runtime integrity check failed'
      ? error.message : 'Open Artifact runtime or tool unavailable';
    fail(-32000, message);
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
