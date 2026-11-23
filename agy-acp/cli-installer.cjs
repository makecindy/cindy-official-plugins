'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createMaintenance, download, fail, json, run, versionPattern, watch } = require('./cli-maintenance.cjs');
const { detectAgy, killTree, readCustomAgyConfig, spawnAgy } = require('./resolve-agy.js');

const manifestHost = 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app';
const storage = 'https://storage.googleapis.com';
const win = process.platform === 'win32';

async function latest() {
  const osName = { darwin: 'darwin', win32: 'windows', linux: 'linux' }[process.platform];
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!osName || !arch) fail('unsupported');
  const musl = osName === 'linux' && !process.report.getReport().header.glibcVersionRuntime ? '_musl' : '';
  const release = await json(manifestHost + '/manifests/' + osName + '_' + arch + musl + '.json');
  if (!versionPattern.test(release.version) || !/^[a-f0-9]{128}$/.test(release.sha512) ||
      typeof release.url !== 'string' || !release.url.startsWith(storage + '/antigravity-public/antigravity-cli/')) fail('source');
  return release;
}

async function installed() {
  const check = await detectAgy({ timeoutMs: 10000 });
  const customPathConfigured = Boolean(check.customPathConfigured || readCustomAgyConfig().kind !== 'none');
  return { present: !!check.path, runnable: check.available, version: check.version, path: check.path, customPathConfigured };
}

/** agy's own updater; its output goes to the install log. */
function updateNative(file, report) {
  const child = spawnAgy(file, ['update'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return watch(child, { timeout: 240000, onLine: report.log, kill: target => killTree(target, 'SIGKILL') });
}

function installTarget() {
  const home = os.homedir();
  const bin = win ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'agy', 'bin') :
    path.join(home, '.local', 'bin');
  return { bin, target: path.join(bin, win ? 'agy.exe' : 'agy') };
}

// Respect package managers and alternate install locations.
function updatesInPlace(current) {
  const { target } = installTarget();
  return !!current?.path && (win ? current.path.toLowerCase() !== target.toLowerCase() : current.path !== target);
}

/** Settings-page steps between "get the official version" and "confirm". */
function plan(current) {
  if (updatesInPlace(current)) return ['native'];
  return win ? ['download', 'probe', 'activate'] : ['download', 'extract', 'probe', 'activate'];
}

async function install(release, current, report) {
  if (!current.present && (current.customPathConfigured || readCustomAgyConfig().kind !== 'none')) {
    fail('custom-path');
  }
  const { bin, target } = installTarget();
  if (updatesInPlace(current)) {
    report.step('native');
    return updateNative(current.path, report);
  }
  await fs.mkdir(bin, { recursive: true });
  const stage = await fs.mkdtemp(path.join(bin, '.agy-install-'));
  try {
    const file = path.join(stage, win ? 'agy.exe' : 'payload.tar.gz');
    report.step('download');
    const size = await download(release.url, [storage], file, 'sha512', release.sha512, 256 * 1024 * 1024, undefined,
      (loaded, total) => report.bytes(loaded, total));
    report.note('downloaded', { size });
    const archive = new URL(release.url).pathname.endsWith('.tar.gz');
    const executable = archive ? path.join(stage, 'antigravity') : file;
    if (archive) {
      report.step('extract');
      await run('/usr/bin/tar', ['-xzf', file, '-C', stage, 'antigravity']);
      if (!(await fs.lstat(executable)).isFile()) fail('integrity');
    }
    if (!win) await fs.chmod(executable, 0o755);
    report.step('probe');
    const { stdout, stderr } = await run(executable, ['--version'], {
      timeout: 15000, env: { ...process.env, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' },
    });
    if ((stdout.trim() || stderr.trim()).replace(/^(?:agy\s+)?v?/i, '') !== release.version) fail('verify');
    report.note('probe', { version: release.version });
    report.step('activate');
    await fs.rename(executable, target).catch(error => {
      if (['EBUSY', 'EPERM'].includes(error.code) && current.present) fail('close-agy');
      throw error;
    });
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = createMaintenance({ latest, installed, install, plan });
