'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMaintenance, fail, json, run, stream, versionPattern } = require('./cli-maintenance.cjs');
const { candidateDirs, detectDsh, managedDshRoot } = require('./resolve-dsh.js');
const { installIds, pruneRetired, readBootId } = require('./cli-retention.cjs');

const registry = 'https://registry.npmjs.org';
const win = process.platform === 'win32';

async function latest() {
  const release = await json(registry + '/@deepseek-ai%2Fdsh/latest');
  if (release.name !== '@deepseek-ai/dsh' || !versionPattern.test(release.version)) fail('source');
  return { version: release.version };
}

async function installed() {
  await pruneRetired(managedDshRoot()).catch(() => {});
  const check = await detectDsh({ timeoutMs: 10000 });
  return { present: !!check.path, runnable: check.available, version: check.version };
}

async function npmRuntime() {
  const systemNode = win && process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'nodejs') : null;
  const dirs = [...candidateDirs(), systemNode].filter(Boolean);
  for (const dir of new Set(dirs)) {
    const node = path.join(dir, win ? 'node.exe' : 'node');
    const npmPaths = [
      path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];
    for (const npm of npmPaths) {
      try {
        if (!(await fs.stat(npm)).isFile()) continue;
        const result = await run(node, ['--version'], { timeout: 3000 });
        const version = result.stdout.trim().replace(/^v/, '');
        const [major, minor] = version.split('.').map(Number);
        if (major > 24 || (major === 24 && minor >= 9)) return { node, npm, version };
      } catch { /* Try the next installed Node.js. */ }
    }
  }
  fail('node-required');
}

/** Settings-page steps between "get the official version" and "confirm". */
function plan() {
  return ['node', 'npm', 'probe', 'activate'];
}

async function install(release, current, report) {
  if (!['darwin', 'win32', 'linux'].includes(process.platform)) fail('unsupported');
  report.step('node');
  const runtime = await npmRuntime();
  report.note('node', { version: runtime.version });
  const root = managedDshRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stage = await fs.mkdtemp(path.join(root, '.install-'));
  const id = randomUUID();
  const marker = path.join(root, id + '.json');
  const destination = path.join(root, id);
  let activated = false;
  try {
    const userConfig = path.join(stage, 'user.npmrc');
    const globalConfig = path.join(stage, 'global.npmrc');
    await Promise.all([userConfig, globalConfig].map(file => fs.writeFile(file, '', { mode: 0o600, flag: 'wx' })));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_config_|NODE_OPTIONS$|NODE_PATH$)/i.test(key)));
    report.step('npm');
    // http log level lists each registry fetch, so the install log keeps moving while npm works.
    await stream(runtime.node, [runtime.npm, 'install', '--prefix', stage, '--userconfig', userConfig, '--globalconfig', globalConfig,
      '--registry', registry, '--ignore-scripts', '--no-save', '--no-package-lock', '--no-audit', '--no-fund',
      '--loglevel', 'http', '--color', 'false', '@deepseek-ai/dsh@' + release.version],
    { timeout: 240000, cwd: stage, env, onLine: report.log });
    report.step('probe');
    const entry = path.join(stage, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    const probe = await run(runtime.node, [entry, '--version'], { timeout: 15000, cwd: stage, env });
    if (![probe.stdout, probe.stderr].join(' ').includes(release.version)) fail('verify');
    report.note('probe', { version: release.version });
    report.step('activate');
    const boot = await readBootId().catch(() => '');
    const older = await installIds(root);
    await fs.rename(stage, destination);
    await fs.writeFile(marker, JSON.stringify({ id, node: runtime.node, boot, older }), { mode: 0o600, flag: 'wx' });
    await fs.rename(marker, path.join(root, 'current.json'));
    activated = true;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    await fs.rm(marker, { force: true }).catch(() => {});
    if (!activated) await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = createMaintenance({ latest, installed, install, plan });
