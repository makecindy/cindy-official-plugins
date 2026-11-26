'use strict';

const { createHash } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { createWriteStream } = require('node:fs');
const os = require('node:os');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z.-]+)?$/;

function compareVersions(a, b) {
  if (!a || !b || !versionPattern.test(a) || !versionPattern.test(b)) return null;
  const split = value => value.split('+')[0].match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  const left = split(a), right = split(b);
  for (let i = 1; i <= 3; i++) {
    if (left[i] !== right[i]) return Number(left[i]) > Number(right[i]) ? 1 : -1;
  }
  if (!left[4] || !right[4]) return Number(!left[4]) - Number(!right[4]);
  const x = left[4].split('.'), y = right[4].split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x[i]), yn = /^\d+$/.test(y[i]);
    if (xn && yn) return Number(x[i]) > Number(y[i]) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

function fail(code) {
  throw Object.assign(new Error(code), { maintenanceCode: code });
}

async function fetchOfficial(url, origins, timeout, headers) {
  const signal = AbortSignal.timeout(timeout);
  for (let redirects = 0; redirects < 4; redirects++) {
    const target = new URL(url);
    if (!origins.includes(target.origin) || target.username || target.password) fail('source');
    const response = await fetch(target, { redirect: 'manual', signal, headers }).catch(() => fail('source'));
    if (response.ok && response.body) return response;
    await response.body?.cancel();
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.get('location')) fail('source');
    url = new URL(response.headers.get('location'), target).href;
  }
  fail('source');
}

async function json(url, headers) {
  const response = await fetchOfficial(url, [new URL(url).origin], 15000, headers);
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 256 * 1024) fail('source');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { fail('source'); }
}

/** onBytes(received, total?) follows the transfer; total is the declared size or Content-Length. */
async function download(url, origins, file, algorithm, digest, maxBytes, size, onBytes) {
  const response = await fetchOfficial(url, origins, 420000);
  const declared = Number(response.headers.get('content-length'));
  const total = size || (Number.isSafeInteger(declared) && declared > 0 && declared <= maxBytes ? declared : undefined);
  const hash = createHash(algorithm);
  let received = 0;
  onBytes?.(0, total);
  await pipeline(response.body, async function* (chunks) {
    for await (const chunk of chunks) {
      received += chunk.byteLength;
      if (received > maxBytes || (size && received > size)) fail('integrity');
      hash.update(chunk);
      onBytes?.(received, total);
      yield chunk;
    }
    if (!received || (size && received !== size) || hash.digest('hex') !== digest) fail('integrity');
  }, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
  return received;
}

function run(file, args, options = {}) {
  return promisify(execFile)(file, args, {
    encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true, timeout: 30000, ...options,
  });
}

/**
 * Waits for a child started with piped output and hands each output line to onLine, so long
 * installers can show what they are doing. Rejects like run() on a failed exit, with the last
 * output lines in error.output.
 */
function watch(child, { timeout = 30000, onLine, kill = target => target.kill() } = {}) {
  return new Promise((resolve, reject) => {
    const tail = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; kill(child); }, timeout);
    const emit = line => {
      if (!line.trim()) return;
      tail.push(line);
      if (tail.length > 20) tail.shift();
      onLine?.(line);
    };
    for (const output of [child.stdout, child.stderr]) {
      if (!output) continue;
      let rest = '';
      output.setEncoding('utf8');
      output.on('data', chunk => {
        const lines = (rest + chunk).split(/\r\n|\n|\r/);
        rest = lines.pop().slice(0, 64 * 1024);
        lines.forEach(emit);
      });
      output.on('end', () => { emit(rest); rest = ''; });
    }
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(Object.assign(new Error(timedOut ? 'Timed out' : 'Exited with ' + (code ?? signal)),
        { code, signal, killed: timedOut, output: tail }));
    });
  });
}

function stream(file, args, { timeout, onLine, ...options } = {}) {
  return watch(spawn(file, args, { windowsHide: true, ...options, stdio: ['ignore', 'pipe', 'pipe'] }), { timeout, onLine });
}

const home = os.homedir();
const homePattern = home && home.length > 3 ?
  new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), process.platform === 'win32' ? 'gi' : 'g') : null;

/** One plain line for the settings page: no colour codes, home folder as ~, credentials masked. */
function cleanLine(text) {
  let line = String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
  if (homePattern) line = line.replace(homePattern, '~');
  line = line
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    // Multi-part Authorization values must be removed before generic key/value masking.
    .replace(/(\bauthorization["']?\s*[:=]\s*).*/gi, '$1***')
    .replace(/\b(?:Bearer|Basic)\s+[\w.~+/=-]+/gi, '***')
    .replace(/((?:auth|token|password|passwd|secret|api[_-]?key)[\w-]*["']?\s*[:=]\s*)("?)[^\s"',;]+/gi, '$1$2***')
    .replace(/\b(?:npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|sk-[A-Za-z0-9_-]{16,})/g, '***');
  return line.length > 240 ? line.slice(0, 239) + '…' : line;
}

/**
 * Install progress for the settings page. Steps go out at once; byte counts and log lines are
 * batched every 200 ms. Events never carry commands, paths chosen by the page, or secrets.
 */
function createReporter(send) {
  let plan = [];
  let current;
  const queue = [];
  let timer;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (queue.length) send({ events: queue.splice(0) });
  };
  const push = event => {
    queue.push(event);
    if (queue.length >= 100) flush();
    else timer ??= setTimeout(flush, 200);
  };
  const stepEvent = () => ({ step: current, index: plan.indexOf(current) + 1, count: plan.length });
  return {
    plan(steps) {
      plan = steps;
      if (current) push(stepEvent());
    },
    step(id) {
      current = id;
      push(stepEvent());
      flush();
    },
    bytes(loaded, total) {
      const event = total ? { loaded, total } : { loaded };
      const last = queue[queue.length - 1];
      if (last && 'loaded' in last) queue[queue.length - 1] = event;
      else push(event);
    },
    note(key, vars) { push(vars ? { note: key, vars } : { note: key }); },
    log(text) {
      const line = cleanLine(text);
      if (line) push({ log: line });
    },
    flush,
  };
}

/** What a failed step printed, for the install log. Maintenance codes have their own message. */
function logFailure(report, error) {
  if (!error || error.maintenanceCode) return;
  const output = Array.isArray(error.output) ? error.output :
    [error.stderr, error.stdout].filter(text => typeof text === 'string').join('\n').split(/\r?\n/);
  for (const line of output.filter(text => text.trim()).slice(-8)) report.log(line);
  if (error.message) report.log(error.message);
}

const noSteps = () => [];

// One operation at a time per worker. The browser never supplies a command, URL or path.
// send(method, params?) writes a JSON-RPC notification: 'progress' keeps the request alive,
// 'cli-progress' carries { op, events } for the settings page.
function createMaintenance({ latest, installed, install, plan = noSteps }) {
  let pending;
  return function maintain(params, send = () => {}) {
    const action = params?.action;
    if (!['check', 'install', 'update'].includes(action)) return { error: 'unsupported' };
    if (pending) return { error: 'busy' };
    const op = typeof params.op === 'string' ? params.op.slice(0, 64) : undefined;
    const report = createReporter(data => send('cli-progress', { op, ...data }));
    const stages = current => ['resolve', ...plan(current), 'confirm'];
    const timer = action === 'check' ? null : setInterval(() => send('progress'), 10000);
    pending = (async () => {
      if (action !== 'check') {
        report.plan(stages());
        report.step('resolve');
      }
      const current = await installed();
      const release = await latest();
      if (!versionPattern.test(release.version)) fail('source');
      const comparison = compareVersions(release.version, current.version);
      if (action === 'check') {
        return { version: comparison < 0 ? current.version : release.version, state: !current.present ? 'missing' :
          comparison === null ? 'unknown' : comparison > 0 ? 'newer' : 'current' };
      }
      report.note('versions', { latest: release.version, ...(current.version ? { current: current.version } : {}) });
      if (comparison !== null && comparison < 0) return { version: current.version, state: 'current' };
      if (comparison === 0 && current.runnable) return { version: current.version, state: 'current' };
      if (action === 'update' && params.version !== release.version) {
        return { version: release.version, state: comparison === null ? 'unknown' : 'newer' };
      }
      report.plan(stages(current));
      await install(release, current, report);
      report.step('confirm');
      const after = await installed();
      if (!after.runnable || compareVersions(after.version, release.version) !== 0) fail('verify');
      return { version: after.version, state: 'installed' };
    })().catch(error => {
      logFailure(report, error);
      return { error: error.maintenanceCode || 'operation' };
    }).finally(() => {
      report.flush();
      clearInterval(timer);
      pending = undefined;
    });
    return pending;
  };
}

module.exports = { cleanLine, compareVersions, createMaintenance, download, fail, json, run, stream, versionPattern, watch };
