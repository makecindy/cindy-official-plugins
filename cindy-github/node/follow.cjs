// Locate only this installation's approved, update-stable PR Skill, and sync
// explicit user-authorized auto-merge policies for the pre-run gate. The
// scheduler must lose access to the hook if the user disables or removes this plugin.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const readline = require('node:readline');

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ACTOR_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const MERGE_METHODS = new Set(['merge', 'squash', 'rebase']);
const POLICY_VERSION = 1;
const POLICY_FILENAME = '.auto-merge-policy.json';

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

function defaultPrStateDir(env = process.env) {
  const configured = typeof env.CINDY_PR_STATE_DIR === 'string' ? env.CINDY_PR_STATE_DIR.trim() : '';
  return configured || path.join(os.homedir(), '.cache', 'cindy-pr');
}

function autoMergePolicyPath(stateDir = defaultPrStateDir()) {
  return path.join(stateDir, POLICY_FILENAME);
}

function emptyPolicy() {
  return { version: POLICY_VERSION, prs: {}, repos: {} };
}

function readAutoMergePolicy(stateDir = defaultPrStateDir()) {
  try {
    const raw = JSON.parse(fs.readFileSync(autoMergePolicyPath(stateDir), 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyPolicy();
    return {
      version: POLICY_VERSION,
      prs: raw.prs && typeof raw.prs === 'object' && !Array.isArray(raw.prs) ? { ...raw.prs } : {},
      repos: raw.repos && typeof raw.repos === 'object' && !Array.isArray(raw.repos) ? { ...raw.repos } : {},
    };
  } catch {
    return emptyPolicy();
  }
}

function writePolicyAtomic(file, policy) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(policy, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function normalizeRepo(value) {
  const repo = typeof value === 'string' ? value.trim() : '';
  if (!REPO_RE.test(repo)) throw new Error('Invalid repo');
  return repo.toLowerCase();
}

function normalizeActor(value) {
  const actor = typeof value === 'string' ? value.trim() : '';
  if (!ACTOR_RE.test(actor)) throw new Error('Invalid actor');
  return actor.toLowerCase();
}

function normalizeBase(value) {
  const base = typeof value === 'string' ? value.trim() : '';
  if (!base || base.length > 255 || /[\r\n\s]/.test(base)) throw new Error('Invalid base branch');
  return base;
}

function updateAutoMergePolicyFile(params, stateDir = defaultPrStateDir()) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('Invalid policy update');
  }
  const op = params.op;
  const repo = normalizeRepo(params.repo);
  const policy = readAutoMergePolicy(stateDir);
  const authorizedAt = Number.isFinite(Number(params.authorizedAt)) ? Number(params.authorizedAt) : Date.now();

  if (op === 'set-pr') {
    const number = Number(params.number);
    if (!Number.isInteger(number) || number <= 0) throw new Error('Invalid PR number');
    const actor = normalizeActor(params.actor);
    const base = normalizeBase(params.base);
    const method = typeof params.method === 'string' && MERGE_METHODS.has(params.method.toLowerCase())
      ? params.method.toLowerCase()
      : undefined;
    policy.prs[`${repo}#${number}`] = {
      repo,
      number,
      actor,
      base,
      ...(method ? { method } : {}),
      authorizedAt,
    };
  } else if (op === 'clear-pr') {
    const number = Number(params.number);
    if (!Number.isInteger(number) || number <= 0) throw new Error('Invalid PR number');
    delete policy.prs[`${repo}#${number}`];
  } else if (op === 'set-repo') {
    const actor = normalizeActor(params.actor);
    policy.repos[repo] = { repo, actor, authorizedAt };
  } else if (op === 'clear-repo') {
    delete policy.repos[repo];
  } else {
    throw new Error('Unsupported policy operation');
  }

  writePolicyAtomic(autoMergePolicyPath(stateDir), policy);
  return { ok: true, op, repo };
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
        reply.result = { dir: followSkillDir(path.resolve(__dirname, '..')), platform: process.platform };
      } else if (req.method === 'syncAutoMergePolicy') {
        reply.result = updateAutoMergePolicyFile(req.params);
      } else {
        throw new Error('Unsupported method');
      }
    } catch (error) {
      reply.error = { code: -32000, message: error.message };
    }
    process.stdout.write(JSON.stringify(reply) + '\n');
  });
}

module.exports = {
  followSkillDir,
  defaultPrStateDir,
  autoMergePolicyPath,
  readAutoMergePolicy,
  updateAutoMergePolicyFile,
};
