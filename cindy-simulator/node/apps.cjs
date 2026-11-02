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
  // Process-local receipts only. A receipt never replaces checking both complete
  // trees for changes (including ctime, so restored size/mtime cannot hide edits).
  const receipts = new Map();
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
  async function identity(appDir, deadline, hash = true) {
    const info = await plist(appDir, deadline);
    const executable = info.CFBundleExecutable;
    if (typeof info.CFBundleIdentifier !== 'string' || typeof executable !== 'string') throw failure('INVALID_APP', 'Info.plist has no bundle identifier or executable');
    const exe = path.join(appDir, executable), stat = await fsp.stat(exe);
    return {bundleId: info.CFBundleIdentifier, version: info.CFBundleShortVersionString ?? null, build: info.CFBundleVersion ?? null,
      executable, ...(hash ? {executableSha256: await sha256(exe, deadline)} : {}), executableModified: new Date(stat.mtimeMs).toISOString()};
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
    const {stdout} = await run(rsync, ['-ac', '--delete', '--dry-run', '--itemize-changes', from + '/', to + '/'], {...budget(1800000, deadline), maxBuffer: 32 * 1024 * 1024});
    // installd resets dylib permissions. Ignore attribute-only changes, but
    // retain checksum/size changes even when rsync marks no data transfer.
    return stdout.split('\n').filter(line => line && (!line.startsWith('.') || /[cs]/.test(line.slice(2, 4))));
  }

  async function treeStamp(directory, deadline) {
    const hash = crypto.createHash('sha256'), links = crypto.createHash('sha256');
    const pending = [''];
    let visited = 0;
    while (pending.length) {
      budget(1, deadline);
      const relative = pending.pop(), file = path.join(directory, relative), stat = fs.lstatSync(file, {bigint: true});
      hash.update(JSON.stringify([relative, ...['dev','ino','mode','size','mtimeNs','ctimeNs'].map(k => String(stat[k]))]));
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(file);
        hash.update(target); links.update(JSON.stringify([relative, target]));
      }
      else if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort().reverse()) pending.push(path.join(relative, name));
      else if (!stat.isFile()) throw failure('COMPARISON_UNAVAILABLE', 'Bundle contains a special file; full comparison required.');
      // Avoid one thread-pool round trip per entry in 100k-file game bundles,
      // while yielding every small batch so status and other devices can run.
      if (++visited % 128 === 0) await new Promise(setImmediate);
    }
    return {stamp: hash.digest('hex'), links: links.digest('hex')};
  }
  const receiptKey = (device, bundleId) => `${deviceId(device.udid)}:${bundleId}`;
  const stamps = async (source, container, deadline) => Promise.all([treeStamp(source, deadline), treeStamp(container, deadline)]);
  async function verify(device, source, container, deadline) {
    const before = await stamps(source, container, deadline);
    const [local, installed] = await Promise.all([identity(source, deadline), identity(container, deadline)]);
    // macOS openrsync can silently replace a symlink without reporting it in
    // dry-run itemization. Compare link targets independently of its output.
    const linksChanged = before[0].links !== before[1].links;
    const changes = await differences(source, container, deadline), changedFiles = changes.length;
    const after = await stamps(source, container, deadline);
    if (before.some((v, i) => v.stamp !== after[i].stamp)) throw failure('BUILD_CHANGED', 'A bundle changed during verification. Inspect the build before checking again.');
    const matchesLocal = changedFiles === 0 && !linksChanged && local.bundleId === installed.bundleId && local.version === installed.version && local.build === installed.build && local.executableSha256 === installed.executableSha256;
    const result = {matchesLocal, changedFiles, symlinkTargetsChanged: linksChanged, registrationChanged: linksChanged || changes.some(line => /(?:Info\.plist|embedded\.mobileprovision|_CodeSignature)(?:\/|$)/.test(line)), verification: 'confirmed', verificationScope: 'whole-bundle-content', verifiedAt: new Date(now()).toISOString(), executableSha256: installed.executableSha256.slice(0, 16), local};
    if (matchesLocal) receipts.set(receiptKey(device, local.bundleId), {source, container, stamps: after, at: now(), result});
    return result;
  }
  async function cachedVerification(device, bundleId, source, container, deadline) {
    const key = receiptKey(device, bundleId), receipt = receipts.get(key);
    if (!receipt) return null;
    if (receipt.source === source && receipt.container === container && now() - receipt.at < 3600000) {
      const current = await stamps(source, container, deadline);
      if (current.every((v, i) => v.stamp === receipt.stamps[i].stamp)) {
        // A writer may have changed an already-visited file while the first
        // traversal continued. Revisit both entire trees before reusing proof.
        const confirmed = await stamps(source, container, deadline);
        if (confirmed.every((v, i) => v.stamp === current[i].stamp) && now() - receipt.at < 3600000)
          return {...receipt.result, verificationReused: true, checkedAt: new Date(now()).toISOString()};
      }
    }
    receipts.delete(key);
    return null;
  }
  function stage(job, name) {
    const at = now();
    if (job.phase) job.phaseMs[job.phase] = (job.phaseMs[job.phase] || 0) + at - job.phaseStartedAt;
    job.phase = name; job.phaseStartedAt = at;
  }
  function newJob(device, source, kind) {
    const job = {id: crypto.randomUUID().slice(0, 8), udid: deviceId(device.udid), bundleId: null, appPath: source, kind, mode: 'checking', modeReason: 'comparing-build', state: 'running', startedAt: now(), phaseMs: {}};
    jobs.set(job.id, job);
    for (const [id, old] of jobs) if (old.state !== 'running' && now() - (old.finishedAt || 0) > 3600000) jobs.delete(id);
    stage(job, 'reading-metadata');
    return job;
  }
  function complete(job, result) { stage(job, 'complete'); Object.assign(job, {state: 'done', finishedAt: now(), result}); }
  async function info(device, p) {
    if (p.verify !== undefined && !['auto','full','none'].includes(p.verify)) throw failure('INVALID_ARGUMENT', 'verify must be auto, full or none');
    let local = null;
    const source = p.appPath === undefined ? null : await appPath(p.appPath);
    if (source) local = await identity(source, p._deadline, false);
    const bundleId = p.bundleId ?? local?.bundleId;
    if (typeof bundleId !== 'string' || !BUNDLE.test(bundleId)) throw failure('INVALID_ARGUMENT', 'Pass bundleId or appPath');
    const container = await installedAt(device, bundleId, p._deadline);
    if (!container) return {udid: device.udid, bundleId, installed: false, ...(local ? {local} : {})};
    const installed = await identity(container, p._deadline, false);
    const result = {udid: device.udid, bundleId, installed: true, version: installed.version, build: installed.build, executable: installed.executable,
      executableModified: installed.executableModified, verification: 'not_requested'};
    if (local) {
      Object.assign(result, {local, matchesLocal: null});
      if (local.bundleId !== bundleId) throw failure('INVALID_ARGUMENT', 'bundleId does not match appPath');
      if (p.verify === 'none') return result;
      const running = runningFor(device.udid);
      if (running) return {...result, verification: 'pending', ...describeJob(running), nextAction: 'Wait for this job, then query info for the requested build.'};
      const job = newJob(device, source, 'verification'); job.bundleId = bundleId;
      job.promise = (async () => {
        stage(job, 'checking-receipt');
        const cached = p.verify === 'full' ? null : await cachedVerification(device, bundleId, source, container);
        if (cached) return cached;
        stage(job, 'verifying-content');
        return verify(device, source, container);
      })().then(verified => complete(job, {...result, ...verified}), error => complete(job, {...result, matchesLocal: null, verification: 'unconfirmed', comparisonError: {code: error.code || 'COMPARISON_FAILED', message: error.message}, note: 'Comparison did not complete; do not reinstall on this evidence alone.'}));
      return {...result, verification: 'pending', ...await wait(job, p.wait ?? 5, p._deadline)};
    }
    return result;
  }

  function runningFor(udid) { return [...jobs.values()].find(j => j.udid === deviceId(udid) && j.state === 'running') || null; }

  async function install(device, p, {terminate}) {
    const source = await appPath(p.appPath);
    if (runningFor(device.udid)) throw failure('INSTALL_RUNNING', `An install is still running on this device (job ${runningFor(device.udid).id}). Poll it with app action=install_status.`);
    // Hashing and the multi-GB checksum comparison belong to the same existing
    // job as copying. The caller can poll it while preparation is still busy.
    const job = newJob(device, source, 'install');
    let execution = 'not_executed';
    job.promise = (async () => {
      const metadata = await plist(source), supported = metadata.CFBundleSupportedPlatforms;
      const allowed = {iOS: ['iPhoneSimulator'], tvOS: ['AppleTVSimulator'], visionOS: ['XRSimulator', 'iPhoneSimulator']}[platform(device)];
      if (Array.isArray(supported) && !supported.some(p => allowed.includes(p))) throw failure('APP_PLATFORM_MISMATCH', `This App was built for ${supported.join(', ')}; the device runs ${platform(device)}. Build for the matching simulator platform.`);
      const nativePlatform = Array.isArray(supported) && supported.includes(allowed[0]);
      stage(job, 'fingerprinting');
      const local = await identity(source);
      job.bundleId = local.bundleId;
      const container = p.mode === 'full' || (platform(device) === 'visionOS' && !nativePlatform) ? null : await installedAt(device, local.bundleId);
      let mode = 'full';
      job.modeReason = p.mode === 'full' ? 'requested-full' : 'not-installed';
      if (container) {
        stage(job, 'comparing-content');
        const cached = await cachedVerification(device, local.bundleId, source, container);
        if (cached) { job.mode = 'unchanged'; job.modeReason = 'verified-content-unchanged'; return {version: local.version, build: local.build, ...cached}; }
        const comparison = await verify(device, source, container).catch(() => null);
        const changed = comparison?.changedFiles ?? Infinity;
        if (comparison?.matchesLocal) {
          job.mode = 'unchanged';
          job.modeReason = 'identical-content';
          return {version: local.version, build: local.build, ...comparison};
        }
        // Registration and signing changes need installd, including nested bundles.
        const registrationChanged = comparison?.registrationChanged;
        job.modeReason = !comparison ? 'comparison-unavailable' : registrationChanged ? 'registration-or-signature-changed'
          : changed>SYNC_LIMIT ? 'many-files-changed' : 'few-files-changed';
        if (nativePlatform && changed <= SYNC_LIMIT && !registrationChanged) mode = 'sync';
        if (comparison) job.changedFiles=changed;
      }
      job.mode = mode;
      receipts.delete(receiptKey(device, local.bundleId));
      stage(job, mode === 'sync' ? 'syncing-files' : 'installing');
      if (mode === 'sync') {
        // The app must not run while its files are replaced.
        execution = 'unknown';
        await terminate(local.bundleId).catch(error => {
          if (!/not running|found nothing|No matching processes/i.test(error.message)) throw error;
        });
        await run(rsync, ['-ac', '--delete', source + '/', container + '/'], {timeout: 1800000, mutation: true});
      } else {
        execution = 'unknown';
        await sim(['install', device.udid, source], {timeout: 1800000, mutation: true});
      }
      execution = 'executed';
      stage(job, 'verifying-content');
      const destination = await installedAt(device, local.bundleId);
      if (!destination) throw failure('INSTALL_UNVERIFIED', 'Install completed but its bundle is absent. Inspect the device before retrying.', 'executed');
      const verified = await verify(device, source, destination);
      if (!verified.matchesLocal) throw failure('INSTALL_UNVERIFIED', 'The installed bundle does not match the build', 'executed');
      return {version: local.version, build: local.build, ...verified};
    })().then(result => complete(job, result),
      error => { stage(job, 'failed'); Object.assign(job, {state: 'failed', finishedAt: now(), error: {code: error.code || 'INSTALL_FAILED', message: error.message, execution: execution === 'executed' ? execution : error.execution || execution}}); });
    const remaining = p._deadline === undefined ? Infinity : Math.max(0, p._deadline - now() - 1000) / 1000;
    return wait(job, Math.min(p.wait ?? 80, remaining));
  }

  async function wait(job, seconds, deadline) {
    const limit = Math.min(Math.max(0, (deadline ?? Infinity) - now() - 1000), Math.max(0, Math.min(Number(seconds) || 0, 90)) * 1000);
    let timer;
    await Promise.race([job.promise, new Promise(resolve => { timer = setTimeout(resolve, limit); })]);
    clearTimeout(timer);
    return describeJob(job);
  }
  function describeJob(job) {
    const base = {udid: job.udid, bundleId: job.bundleId, job: job.id, kind: job.kind, mode: job.mode, modeReason:job.modeReason,
      phase: job.phase, phaseElapsedSeconds: Math.round(((job.finishedAt || now()) - job.phaseStartedAt) / 1000), phaseMs: {...job.phaseMs},
      ...(Number.isFinite(job.changedFiles)?{changedFiles:job.changedFiles}:{}), state: job.state, elapsedSeconds: Math.round(((job.finishedAt || now()) - job.startedAt) / 1000)};
    if (job.state === 'running') return {...base, execution: job.kind === 'verification' || job.mode === 'checking' ? 'not_executed' : 'unknown', recommendedWaitSeconds: 85, nextAction: `app action=install_status job=${job.id} wait=85`, note: 'Wait on this existing job; wait returns as soon as it finishes. Different devices can be waited on concurrently. Progress is the reported phase, not an estimated percentage.'};
    if (job.state === 'failed') { const error = new Failure(job.error.code, job.error.message, job.error.execution); throw error; }
    if (job.kind === 'verification') return {...base, execution: 'not_executed', ...job.result};
    if (job.mode === 'unchanged') return {...base, execution: 'not_executed', ...job.result, note: 'The installed app already matches this build; nothing was copied.'};
    return {...base, execution: 'executed', ...job.result, note: job.mode === 'sync' ? 'Changed files were synced into the installed app; App data was kept.' : 'Installed.'};
  }
  async function status(p) {
    const job = p.job !== undefined ? jobs.get(p.job) : [...jobs.values()].filter(j => j.udid === deviceId(p.udid)).sort((a, b) => b.startedAt - a.startedAt)[0];
    if (!job || (p.udid !== undefined && job.udid !== deviceId(p.udid))) throw failure('JOB_NOT_FOUND', 'No such install job for this device. Installs are forgotten when the plugin worker restarts; check with app action=info.');
    return wait(job, p.wait ?? 85, p._deadline);
  }

  const installing = () => [...jobs.values()].some(j => j.state === 'running');
  const pending = udid => {
    const promises = [...jobs.values()].filter(j => j.state === 'running' && (!udid || j.udid === deviceId(udid))).map(j => j.promise);
    return promises.length ? Promise.all(promises) : null;
  };
  return {install, status, info, identity, runningFor, installing, pending};
}

module.exports = {createApps};
