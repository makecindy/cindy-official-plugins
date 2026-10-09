'use strict';
const { spawnSync } = require('node:child_process');
for (const args of [['run', 'check'], ['test'], ['run', 'package:check']]) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: 'inherit', cwd: process.cwd() });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('No compile step: the Cindy source is shipped as JavaScript/CJS. Run ghost_forge_pack on this directory to create the .cindy file.');
