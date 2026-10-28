'use strict';
// Local, real-device replay adapter. No Host installation or shared worker.
// node replay-worker.cjs <plugin-source> <dedicated-state-directory>
// JSON lines: {id, method, params}. Only ROOT is substituted, identically for
// both revisions; all device, input, observation and job code is unchanged.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const readline = require('node:readline');
const childProcess = require('node:child_process');
const {EventEmitter} = require('node:events');
let fault = null, trace = {};
const originalSpawn = childProcess.spawn;
// Faults affect observation only. Native App launch and touch stay real.
childProcess.spawn = function(file, args, options) {
  const child = originalSpawn(file, args, options);
  if (args?.[0] === 'input' && child.stdin) {
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = function(chunk, ...rest) {
      try { const event = JSON.parse(String(chunk)); if (event.type) trace.touchEvents = (trace.touchEvents || 0) + 1; } catch {}
      return write(chunk, ...rest);
    };
  }
  return child;
};
const [plugin, root] = process.argv.slice(2).map(p => path.resolve(p));
if (!plugin || !root || !fs.existsSync(path.join(root, 'replay-only'))) throw Error('Create replay-only in a dedicated state directory first.');
const filename = path.join(plugin, 'node/core.cjs');
const source = fs.readFileSync(filename, 'utf8');
const start = source.indexOf('const ROOT ='), end = source.indexOf('const DEVICE_SET =', start);
if (start < 0 || end < 0) throw Error('Unrecognized core; inspect isolation before replay.');
const isolated = new Module(filename, module);
isolated.filename = filename;
isolated.paths = Module._nodeModulePaths(path.dirname(filename));
const originalRequire = isolated.require.bind(isolated);
isolated.require = name => {
  const value = originalRequire(name);
  if (name === './viewer.cjs') return {...value, openViewer: (...args) => fault === 'viewer'
    ? new Promise((_, reject) => setTimeout(() => reject(Error('Injected viewer readiness failure')), 12000))
    : value.openViewer(...args)};
  if (name === 'node:child_process') return {...value, execFile(file, args, options, callback) {
    if (file.endsWith('xcrun') && args.includes('launch')) trace.appLaunches = (trace.appLaunches || 0) + 1;
    if (args[0] === 'screenshot') {
      trace.screenAttempts = (trace.screenAttempts || 0) + 1;
      if (fault === 'capture') {
        const child = new EventEmitter(); child.stdin = {on(){}, end(){}};
        const timer = setTimeout(() => callback(Error('Injected capture timeout'), '', 'Injected capture timeout'), options.timeout);
        child.kill = () => clearTimeout(timer);
        return child;
      }
    }
    return value.execFile(file, args, options, callback);
  }};
  return value;
};
isolated._compile(source.slice(0, start) + `const ROOT = ${JSON.stringify(root)};\n` + source.slice(end), filename);
const core = isolated.exports;
const runtime = require(path.join(plugin, 'node/runtime.cjs')).createRuntime({
  dispatch: core.dispatch, settingsFile: path.join(root, 'runtime-settings.json'),
});
const input = readline.createInterface({input: process.stdin});
const pending = new Set();
async function requestLine(line) {
  const request = JSON.parse(line), started = performance.now();
  if (request.fault && !['viewer','capture'].includes(request.fault)) throw Error('Unknown observation fault');
  fault = request.fault || null; trace = {};
  try {
    const result = await runtime.request(request.method, request.params);
    process.stdout.write(JSON.stringify({id: request.id, ms: performance.now() - started, ok: true, result, trace}) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({id: request.id, ms: performance.now() - started, ok: false,
      error: {code: error.code, message: error.message, execution: error.execution}, trace}) + '\n');
  }
}
input.on('line', line => { const work = requestLine(line); pending.add(work); work.finally(() => pending.delete(work)); });
input.on('close', async () => {
  await Promise.allSettled([...pending]);
  await require(path.join(plugin, 'node/viewer.cjs')).stopViewer();
  process.exit(0);
});
