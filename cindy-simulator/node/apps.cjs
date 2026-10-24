'use strict';
// Installing and identifying apps on a private device.
// - Unchanged builds are not reinstalled (identity = bundle id, version, build,
//   executable hash, then a dry-run diff of the whole bundle).
// - A build that changes only a few files is synced file by file into the
//   installed bundle (multi-GB games often change a handful per build);
//   otherwise simctl installs the whole bundle.
// - A first install runs in the background; the tool returns a job to poll
//   instead of timing out.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {commandBudget} = require('./budget.cjs');
const {deviceId} = require('./device-id.cjs');
const {appContainer} = require('./app-container.cjs');
const {platform} = require('./control-model.js');

const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9.-]+$/;
const SYNC_LIMIT = 300;

function createApps({sim, run, Failure, now = Date.now, rsync = '/usr/bin/rsync'}) {
  const jobs = new Map();
  const failure = (code, message, execution = 'not_executed') => new Failure(code, message, execution);

  const budget = (timeout, deadline) => commandBudget(timeout, deadline, now);
  async function plist(appDir, deadline) {
    const {stdout} = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(appDir, 'Info.plist')], budget(10000, deadline));
    try { return JSON.parse(stdout); } catch { throw failure('INVALID_APP', 'Info.plist is unreadable'); }
  }
  function sha256(file, deadline) {
    budget(1, deadline);
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(file);
      stream.on('data', chunk => { try { budget(1, deadline); hash.update(chunk); } catch (error) { stream.destroy(error); } })
        .on('error', reject).on('end', () => { try { budget(1, deadline); resolve(hash.digest('hex')); } catch (error) { reject(error); } });
    });
  }
  /** Who an app bundle is: what a tester means by "the same build". */
  async function identity(appDir, deadline) {
    const info = await plist(appDir, deadline);
    const executable = info.CFBundleExecutable;
    if (typeof info.CFBundleIdentifier !== 'string' || typeof executable !== 'string') throw failure('INVALID_APP', 'Info.plist has no bundle identifier or executable');
    const exe = path.join(appDir, executable), stat = await fsp.stat(exe);
    return {bundleId: info.CFBundleIdentifier, version: info.CFBundleShortVersionString ?? null, build: info.CFBundleVersion ?? null,
      executable, executableSha256: await sha256(exe, deadline), executableModified: new Date(stat.mtimeMs).toISOString()};
  }
  async function appPath(value) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || !value.replace(/\/$/, '').endsWith('.app')) throw failure('INVALID_ARGUMENT', 'appPath must be an absolute simulator .app bundle path');
    const real = await fsp.realpath(value).catch(() => { throw failure('INVALID_ARGUMENT', `No app bundle at ${value}`); });
    if (!(await fsp.stat(real)).isDirectory()) throw failure('INVALID_ARGUMENT', 'App bundle must be a directory');
    return real;
  }
  async function installedAt(device, bundleId, deadline) {
    return appContainer({sim, Failure}, device, bundleId, budget(10000, deadline));
  }
  /** Compare bytes, including resources whose size and timestamp were preserved. */
  async function differences(from, to, deadline) {
    const {stdout} = await run(rsync, ['-ac', '--delete', '--dry-run', '--itemize-changes', from + '/', to + '/'], {...budget(120000, deadline), maxBuffer: 32 * 1024 * 1024});
    // A line starting with "." changes attributes only (installd resets dylib permissions); count content changes.
    return stdout.split('\n').filter(line => line && !line.startsWith('.'));
  }

  async function info(device, p) {
    let local = null;
    if (p.appPath !== undefined) local = await identity(await appPath(p.appPath), p._deadline);
    const bundleId = p.bundleId ?? local?.bundleId;
    if (typeof bundleId !== 'string' || !BUNDLE.test(bundleId)) throw failure('INVALID_ARGUMENT', 'Pass bundleId or appPath');
    const container = await installedAt(device, bundleId, p._deadline);
    if (!container) return {udid: device.udid, bundleId, installed: false, ...(local ? {local} : {})};
    const installed = await identity(container, p._deadline);
    const result = {udid: device.udid, bundleId, installed: true, version: installed.version, build: installed.build, executable: installed.executable,
      executableSha256: installed.executableSha256.slice(0, 16), executableModified: installed.executableModified};
    if (local) {
      const sameExecutable = local.executableSha256 === installed.executableSha256;
      const changedFiles = sameExecutable ? await differences(await appPath(p.appPath), container, p._deadline).then(lines => lines.length).catch(error => {
        result.comparisonError = {code:error.code || 'COMPARISON_FAILED', message:error.message};
        result.verification = 'unconfirmed';
        result.note = 'Content comparison did not complete. matchesLocal=false does not prove a different build; do not reinstall on this evidence alone.';
        return null;
      }) : null;
      result.local = {version: local.version, build: local.build, executableSha256: local.executableSha256.slice(0, 16), executableModified: local.executableModified};
      result.matchesLocal = sameExecutable && local.version === installed.version && local.build === installed.build && changedFiles === 0;
      if (changedFiles) result.changedFiles = changedFiles;
    }
    return result;
  }

  function runningFor(udid) { return [...jobs.values()].find(j => j.udid === deviceId(udid) && j.state === 'running') || null; }

  async function install(device, p, {terminate}) {
    const source = await appPath(p.appPath);
    if (runningFor(device.udid)) throw failure('INSTALL_RUNNING', `An install is still running on this device (job ${runningFor(device.udid).id}). Poll it with app action=install_status.`);
    // Hashing and the multi-GB checksum comparison belong to the same existing
    // job as copying. The caller can poll it while preparation is still busy.
    const job = {id: crypto.randomUUID().slice(0, 8), udid: deviceId(device.udid), bundleId: null, appPath: source, mode: 'checking', modeReason:'comparing-build', state: 'running', startedAt: now()};
    jobs.set(job.id, job);
    for (const [id, old] of jobs) if (old.state !== 'running' && now() - (old.finishedAt || 0) > 3600000) jobs.delete(id);
    let execution = 'not_executed';
    job.promise = (async () => {
      const metadata = await plist(source), supported = metadata.CFBundleSupportedPlatforms;
      const allowed = {iOS: ['iPhoneSimulator'], tvOS: ['AppleTVSimulator'], visionOS: ['XRSimulator', 'iPhoneSimulator']}[platform(device)];
      if (Array.isArray(supported) && !supported.some(p => allowed.includes(p))) throw failure('APP_PLATFORM_MISMATCH', `This App was built for ${supported.join(', ')}; the device runs ${platform(device)}. Build for the matching simulator platform.`);
      const nativePlatform = Array.isArray(supported) && supported.includes(allowed[0]);
      const local = await identity(source);
      job.bundleId = local.bundleId;
      const container = p.mode === 'full' || !nativePlatform ? null : await installedAt(device, local.bundleId);
      let mode = 'full';
      job.modeReason = p.mode === 'full' ? 'requested-full' : 'not-installed';
      if (container) {
        const installed = await identity(container).catch(() => null);
        const changes = installed ? await differences(source, container).catch(() => null) : null;
        const changed = changes?.length ?? Infinity;
        if (changed === 0 && installed.executableSha256 === local.executableSha256 && installed.version === local.version && installed.build === local.build) {
          job.mode = 'unchanged';
          job.modeReason = 'identical-content';
          return {version: local.version, build: local.build};
        }
        // Registration and signing changes need installd, including nested bundles.
        const registrationChanged=changes?.some(line => /(?:Info\.plist|embedded\.mobileprovision|_CodeSignature)(?:\/|$)/.test(line));
        job.modeReason = !changes ? 'comparison-unavailable' : registrationChanged ? 'registration-or-signature-changed'
          : changed>SYNC_LIMIT ? 'many-files-changed' : 'few-files-changed';
        if (changed <= SYNC_LIMIT && !registrationChanged) mode = 'sync';
        if (changes) job.changedFiles=changed;
      }
      job.mode = mode;
      if (mode === 'sync') {
        // The app must not run while its files are replaced.
        execution = 'unknown';
        await terminate(local.bundleId).catch(error => {
          if (!/not running|found nothing|No matching processes/i.test(error.message)) throw error;
        });
        await run(rsync, ['-ac', '--delete', source + '/', container + '/'], {timeout: 1800000, mutation: true});
        const after = await identity(container);
        if (after.executableSha256 !== local.executableSha256 || (await differences(source, container)).length) throw failure('INSTALL_UNVERIFIED', 'The synced bundle does not match the build', 'unknown');
      } else {
        execution = 'unknown';
        await sim(['install', device.udid, source], {timeout: 1800000, mutation: true});
      }
      return {version: local.version, build: local.build};
    })().then(result => { Object.assign(job, {state: 'done', finishedAt: now(), result}); },
      error => { Object.assign(job, {state: 'failed', finishedAt: now(), error: {code: error.code || 'INSTALL_FAILED', message: error.message, execution: error.execution || execution}}); });
    const remaining = p._deadline === undefined ? Infinity : Math.max(0, p._deadline - now() - 1000) / 1000;
    return wait(job, Math.min(p.wait ?? 80, remaining));
  }

  async function wait(job, seconds) {
    const limit = Math.max(0, Math.min(Number(seconds) || 0, 90)) * 1000;
    let timer;
    await Promise.race([job.promise, new Promise(resolve => { timer = setTimeout(resolve, limit); })]);
    clearTimeout(timer);
    return describeJob(job);
  }
  function describeJob(job) {
    const base = {udid: job.udid, bundleId: job.bundleId, job: job.id, mode: job.mode, modeReason:job.modeReason,
      ...(Number.isFinite(job.changedFiles)?{changedFiles:job.changedFiles}:{}), state: job.state, elapsedSeconds: Math.round(((job.finishedAt || now()) - job.startedAt) / 1000)};
    if (job.state === 'running') return {...base, execution: 'unknown', note: `Still ${job.mode === 'checking' ? 'checking the build' : job.mode === 'sync' ? 'syncing changed files' : 'installing'}. Call app action=install_status job=${job.id} to wait for it; do not start another install.`};
    if (job.state === 'failed') { const error = new Failure(job.error.code, job.error.message, job.error.execution); throw error; }
    if (job.mode === 'unchanged') return {...base, execution: 'not_executed', ...job.result, note: 'The installed app already matches this build; nothing was copied.'};
    return {...base, execution: 'executed', ...job.result, note: job.mode === 'sync' ? 'Changed files were synced into the installed app; App data was kept.' : 'Installed.'};
  }
  async function status(p) {
    const job = p.job !== undefined ? jobs.get(p.job) : [...jobs.values()].filter(j => j.udid === deviceId(p.udid)).sort((a, b) => b.startedAt - a.startedAt)[0];
    if (!job || (p.udid !== undefined && job.udid !== deviceId(p.udid))) throw failure('JOB_NOT_FOUND', 'No such install job for this device. Installs are forgotten when the plugin worker restarts; check with app action=info.');
    return wait(job, p.wait ?? 85);
  }

  const installing = () => [...jobs.values()].some(j => j.state === 'running');
  const pending = udid => {
    const promises = [...jobs.values()].filter(j => j.state === 'running' && (!udid || j.udid === deviceId(udid))).map(j => j.promise);
    return promises.length ? Promise.all(promises) : null;
  };
  return {install, status, info, identity, runningFor, installing, pending};
}

module.exports = {createApps};
