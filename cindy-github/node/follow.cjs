// Locate only this installation's approved, update-stable PR Skill. The scheduler
// must lose access to the hook if the user disables or removes this plugin.
const path = require('node:path');
const fs = require('node:fs');
const childProcess = require('node:child_process');
const readline = require('node:readline');

const MIN_NODE_MAJOR = 18;

function supportedNodeVersion(version) {
  return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) &&
    Number(version.split('.')[0]) >= MIN_NODE_MAJOR;
}

function envValue(env, name, caseInsensitive) {
  if (!env || typeof env !== 'object') return '';
  if (!caseInsensitive) return env[name] || '';
  const target = name.toLowerCase();
  const key = Object.keys(env).find(k => k.toLowerCase() === target);
  return key ? env[key] || '' : '';
}

// Resolve the exact first executable `node` that a shell would run on PATH
// without executing relative paths or invoking a shell.
function firstNodeOnPath(env = process.env, platform = process.platform) {
  const win = platform === 'win32';
  const rawPath = envValue(env, 'PATH', win);
  const delimiter = win ? ';' : ':';
  const pathImpl = win ? path.win32 : path.posix;
  const entries = String(rawPath).split(delimiter);
  const rawExts = win
    ? String(envValue(env, 'PATHEXT', true) || '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map(e => e.trim().toLowerCase())
        .filter(e => e.startsWith('.'))
    : [''];
  const exts = rawExts.length ? rawExts : ['.com', '.exe', '.bat', '.cmd'];
  for (let i = 0; i < entries.length; i++) {
    const dir = entries[i].replace(/^"|"$/g, '');
    if (!dir || !pathImpl.isAbsolute(dir)) continue;
    for (let j = 0; j < exts.length; j++) {
      const ext = exts[j];
      const candidate = path.join(dir, 'node' + ext);
      try {
        const real = fs.realpathSync(candidate);
        if (!fs.statSync(real).isFile()) continue;
        if (!win) fs.accessSync(real, fs.constants.X_OK);
        // On Windows, cmd.exe resolves PATHEXT in order; stay conservative if a
        // .cmd/.bat/.com wrapper precedes node.exe rather than spawning a shell.
        if (win && ext !== '.exe') return null;
        return candidate;
      } catch (_) {}
    }
  }
  return null;
}

function defaultNodeSupported(env = process.env, platform = process.platform) {
  const binary = firstNodeOnPath(env, platform);
  if (!binary) return false;
  try {
    const probe = childProcess.spawnSync(binary, ['-p', 'process.versions.node'], {
      encoding: 'utf8', timeout: 2000, windowsHide: true, shell: false,
    });
    return probe.status === 0 && supportedNodeVersion(String(probe.stdout || '').trim());
  } catch (_) {
    return false;
  }
}

function followSkillDir(installation) {
  const id = path.basename(installation);
  const namespace = path.basename(path.dirname(installation));
  const namespaced = path.basename(path.dirname(path.dirname(installation))) === '_ns';
  const brain = namespaced ? path.resolve(installation, '../../..') : path.dirname(installation);
  if (id !== 'cindy-github' || path.basename(brain) !== 'cindy-brain') throw new Error('Unknown plugin installation');
  const state = path.join(path.dirname(brain), 'ghost-install-state');
  const storage = namespaced ? (namespace === '_root' ? '_root' : '_ns__' + namespace) + '__' + id : id;
  const dir = path.join(state, 'agent-skills', 'skills', storage + '--pr');
  const snapshots = path.join(state, 'skill-snapshots', ...(namespaced ? ['_ns', namespace] : []), id);
  const target = fs.realpathSync(dir);
  const relative = path.relative(snapshots, target).split(path.sep);
  if (relative.length !== 3 || relative[0] === '..' || relative[1] !== 'skills' || relative[2] !== 'pr')
    throw new Error('Approved PR Skill unavailable');
  fs.accessSync(path.join(dir, 'scripts', 'pr-heartbeat-gate.mjs'), fs.constants.R_OK);
  fs.accessSync(path.join(dir, 'scripts', 'pr-node.cjs'), fs.constants.R_OK);
  return dir;
}

// Cindy loads this entry through its own bootstrap instead of running it as Node main.
if (require.main === module || globalThis.__CINDY_NODE__) {
  readline.createInterface({ input: process.stdin }).on('line', line => {
    let req;
    try { req = JSON.parse(line); } catch { return; }
    if (!req || req.id == null) return;
    const reply = { jsonrpc: '2.0', id: req.id };
    try {
      if (req.method === 'followSkillDir') {
        reply.result = followSkillDir(path.resolve(__dirname, '..'));
      } else if (req.method === 'defaultNodeSupported') {
        reply.result = defaultNodeSupported();
      } else {
        throw new Error('Unsupported method');
      }
    } catch (error) {
      reply.error = { code: -32000, message: error.message };
    }
    process.stdout.write(JSON.stringify(reply) + '\n');
  });
}
module.exports = { followSkillDir, defaultNodeSupported, firstNodeOnPath };
