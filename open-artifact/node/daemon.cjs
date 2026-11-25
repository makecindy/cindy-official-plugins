const path = require('node:path');
const { pathToFileURL } = require('node:url');

const home = process.argv[2];
if (typeof home !== 'string' || !path.isAbsolute(home)) throw new Error('Missing Open Artifact home');
const entry = path.join(home, 'runtime-0.14.6-cindy.3', 'scripts', 'open-artifact.mjs');
process.env.OPEN_ARTIFACT_HOME = home;
process.env.OPEN_ARTIFACT_RUNTIME_UPDATE = 'off';
process.env.OPEN_ARTIFACT_NODE_CHILDREN = 'threads';
process.env.OPEN_ARTIFACT_PUBLISH = 'manual';
process.env.OPEN_ARTIFACT_PORT = '0';
process.env.OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY = '1';
process.argv = [process.argv[0], entry, 'daemon', 'run'];
import(pathToFileURL(entry).href).catch(() => {
  process.stderr.write('Open Artifact daemon failed to start.\n');
  process.exitCode = 1;
});
