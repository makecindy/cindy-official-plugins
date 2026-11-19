// Locate only this installation's approved, update-stable PR Skill. The scheduler
// must lose access to the hook if the user disables or removes this plugin.
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

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
  return dir;
}

if (require.main === module) {
  readline.createInterface({ input: process.stdin }).on('line', line => {
    let req;
    try { req = JSON.parse(line); } catch { return; }
    if (!req || req.id == null) return;
    const reply = { jsonrpc: '2.0', id: req.id };
    try {
      if (req.method !== 'followSkillDir') throw new Error('Unsupported method');
      reply.result = followSkillDir(path.resolve(__dirname, '..'));
    } catch (error) {
      reply.error = { code: -32000, message: error.message };
    }
    process.stdout.write(JSON.stringify(reply) + '\n');
  });
}
module.exports = { followSkillDir };
