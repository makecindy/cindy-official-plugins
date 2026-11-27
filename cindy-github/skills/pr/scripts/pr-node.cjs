#!/usr/bin/env node
// Keep this launcher compatible with the old system Node that may appear first
// on the desktop scheduler's PATH. The actual PR scripts require Node 18+.
// Do not use xdt-node: released Electron builds disable the RunAsNode fuse.
'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var MIN_NODE_MAJOR = 18;
var PR_SCRIPTS = [
  'pr-heartbeat-gate.mjs', 'pr-snapshot.mjs', 'pr-preflight.mjs',
  'pr-cleanup-plan.mjs', 'pr-follow-replay.mjs'
];

function supported(version) {
  return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) &&
    Number(version.split('.')[0]) >= MIN_NODE_MAJOR;
}

function resolveNode() {
  if (supported(process.versions.node)) return process.execPath;

  var name = process.platform === 'win32' ? 'node.exe' : 'node';
  var visited = new Set();
  try { visited.add(fs.realpathSync(process.execPath)); } catch (_) {}
  var entries = (process.env.PATH || process.env.Path || '').split(path.delimiter);
  for (var i = 0; i < entries.length; i++) {
    var dir = entries[i].replace(/^"|"$/g, '');
    // Do not interpret an empty/relative PATH entry as a path in the PR checkout.
    if (!path.isAbsolute(dir)) continue;
    var binary = path.join(dir, name);
    try {
      var real = fs.realpathSync(binary);
      if (visited.has(real)) continue;
      visited.add(real);
      if (!fs.statSync(real).isFile()) continue;
      fs.accessSync(real, fs.constants.X_OK);
      var probe = childProcess.spawnSync(binary, ['-p', 'process.versions.node'], {
        encoding: 'utf8', timeout: 2000, windowsHide: true
      });
      if (probe.status === 0 && supported(String(probe.stdout || '').trim())) return binary;
    } catch (_) {}
  }
  return null;
}

function main() {
  var script = process.argv[2];
  if (PR_SCRIPTS.indexOf(script) < 0) {
    process.stderr.write('[pr-node] Expected one of the bundled PR scripts.\n');
    return 1;
  }
  var node = resolveNode();
  if (!node) {
    process.stderr.write('[pr-node] PR follow-up needs Node.js 18 or newer. Install a supported Node.js version and make it available on PATH.\n');
    return 1;
  }
  // Inherit stdin (the scheduler's JSON), stdout/stderr and exit code so the
  // hook protocol is unchanged. The child also uses its modern process.execPath
  // for snapshot/probe subprocesses.
  var result = childProcess.spawnSync(node, [path.join(__dirname, script)].concat(process.argv.slice(3)), {
    stdio: 'inherit', windowsHide: true
  });
  if (typeof result.status === 'number') return result.status;
  process.stderr.write('[pr-node] Could not complete the PR script: ' + (result.error && result.error.message || result.signal || 'unknown error') + '\n');
  return 1;
}

process.exitCode = main();
