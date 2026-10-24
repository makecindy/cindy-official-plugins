#!/usr/bin/env node
// Real-simulator smoke for the vendored Baguette. Upstream's own tests mock every
// private-API call, so this is the only check that frames, input and device
// controls still work on the installed Xcode. Run it on each Xcode / Baguette
// update (see VENDOR-REVIEW.md "Upgrade checklist"); it is not part of CI.
//
//   node .tests/baguette/real-simulator-smoke.mjs [--foldable] [--keep]
//
// It creates a throwaway device in a temporary device set (never the user's or
// the plugin's set), boots it, runs the checks, then shuts it down and deletes
// the set. --foldable also creates an iPhone Duo when the runtime offers one.
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '../../cindy-simulator');
const BAGUETTE = join(PLUGIN, 'vendor/baguette/Baguette');
const KEYBOARD = join(PLUGIN, 'native/keyboard');
const args = new Set(process.argv.slice(2));
const SET = mkdtempSync(join(tmpdir(), 'baguette-smoke-'));
const results = [];
let server = null;

const simctl = (...a) => run('/usr/bin/xcrun', ['simctl', '--set', SET, ...a], { timeout: 180000, maxBuffer: 1 << 24 });
const baguette = (...a) => run(BAGUETTE, a, { timeout: 60000, maxBuffer: 1 << 26 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) });
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error.stderr || error.message || error).trim().slice(0, 300) });
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function createDevice(match) {
  const runtimes = JSON.parse((await run('/usr/bin/xcrun', ['simctl', 'list', 'runtimes', '-j'])).stdout).runtimes
    .filter((r) => r.isAvailable && r.identifier.includes('.iOS-'))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  for (const runtime of runtimes) {
    const type = runtime.supportedDeviceTypes?.find((t) => match(t.name));
    if (type) {
      const udid = (await simctl('create', `Smoke ${type.name}`, type.identifier, runtime.identifier)).stdout.trim();
      return { udid, name: type.name, runtime: runtime.name };
    }
  }
  return null;
}

async function boot(udid) {
  await baguette('boot', '--udid', udid, '--device-set', SET, '--no-heal');
  await simctl('bootstatus', udid, '-b');
}

// Node's WebSocket client can fail a new handshake while the previous socket is
// still closing (the server answers 101 to a fresh upgrade); retry once.
async function streamFrames(port, udid, path, wantFrames, timeoutMs) {
  try { return await streamOnce(port, udid, path, wantFrames, timeoutMs); }
  catch (error) {
    if (!String(error.message).startsWith('socket error')) throw error;
    await sleep(500);
    return `${await streamOnce(port, udid, path, wantFrames, timeoutMs)} (after one client retry)`;
  }
}

function streamOnce(port, udid, path, wantFrames, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/simulators/${udid}/${path}`);
    ws.binaryType = 'arraybuffer';
    let frames = 0;
    const errors = [];
    const timer = setTimeout(() => { ws.close(); reject(new Error(`${frames} frames in ${timeoutMs} ms ${errors.join(' ')}`)); }, timeoutMs);
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') { if (e.data.includes('"ok":false')) errors.push(e.data.slice(0, 120)); return; }
      if (++frames >= wantFrames) { clearTimeout(timer); ws.close(); resolve(`${frames} frames`); }
    };
    ws.onerror = () => { clearTimeout(timer); upgradeStatus(port, `/simulators/${udid}/${path}`).then((status) => reject(new Error(`socket error; a fresh upgrade answers: ${status}`))); };
  });
}

function upgradeStatus(port, path) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    socket.once('data', (chunk) => { socket.destroy(); resolve(chunk.toString().split('\r\n')[0]); });
    socket.once('error', (error) => resolve(error.message));
    setTimeout(() => { socket.destroy(); resolve('no answer'); }, 3000);
  });
}

async function http(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, ...(body ? { body, headers: { 'Content-Type': 'application/json' } } : {}) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
  return text;
}

async function phoneChecks(device, port) {
  const { udid } = device;
  await check('stream: flat H.264 delivers frames', () => streamFrames(port, udid, 'stream?format=avcc', 5, 15000));
  await check('stream: flat MJPEG delivers a frame', () => streamFrames(port, udid, 'stream?format=mjpeg', 1, 15000));
  await check('describe-ui returns a non-empty tree', async () => {
    const out = (await baguette('describe-ui', '--udid', udid, '--device-set', SET)).stdout;
    if (out.trim().length < 50) throw new Error('empty tree');
    return `${out.length} bytes`;
  });
  await check('screenshot writes a JPEG', async () => {
    const file = join(SET, 'shot.jpg');
    await baguette('screenshot', '--udid', udid, '--device-set', SET, '--format', 'jpg', '--quality', '0.8', '--output', file);
    const { size } = statSync(file);
    if (size < 10000) throw new Error(`${size} bytes`);
    return `${size} bytes`;
  });
  await check('tap and swipe are accepted', async () => {
    await baguette('tap', '--udid', udid, '--device-set', SET, '--x', '200', '--y', '400', '--width', '402', '--height', '874');
    await baguette('swipe', '--udid', udid, '--device-set', SET, '--start-x', '300', '--start-y', '500', '--end-x', '100', '--end-y', '500', '--width', '402', '--height', '874', '--duration', '0.2');
  });
  await check('home button is accepted', () => baguette('press', '--udid', udid, '--device-set', SET, '--button', 'home'));
  await check('keyboard helper releases keys', async () => {
    const developer = (await run('/usr/bin/xcode-select', ['-p'])).stdout.trim();
    await run(KEYBOARD, [SET, udid, developer, '0', '0'], { timeout: 15000 });
  });
  await check('clipboard round trip in the private set', async () => {
    const text = `smoke ${Date.now()} 你好`;
    const child = spawn('/usr/bin/xcrun', ['simctl', '--set', SET, 'pbcopy', udid], { env: { ...process.env, LC_ALL: 'en_US.UTF-8' } });
    child.stdin.end(text);
    await new Promise((resolve, reject) => child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`pbcopy ${code}`)))));
    const back = (await run('/usr/bin/xcrun', ['simctl', '--set', SET, 'pbpaste', udid], { env: { ...process.env, LC_ALL: 'en_US.UTF-8' } })).stdout;
    if (back !== text) throw new Error(`read back ${JSON.stringify(back)}`);
  });
  // These shell out to simctl inside Baguette: they regress when --set is dropped.
  await check('server: shake', () => http(port, 'POST', `/simulators/${udid}/shake`));
  await check('server: status bar read', () => http(port, 'GET', `/simulators/${udid}/status-bar`));
  await check('server: rotate and back', async () => {
    await http(port, 'POST', `/simulators/${udid}/orientation?value=landscape-left`);
    await sleep(800);
    await http(port, 'POST', `/simulators/${udid}/orientation?value=portrait`);
  });
}

async function foldableChecks(device, port) {
  const { udid } = device;
  await check('foldable: hinge reads an angle', () => http(port, 'GET', `/simulators/${udid}/hinge`));
  await check('foldable: hinge opens and closes', async () => {
    await http(port, 'POST', `/simulators/${udid}/hinge?pose=open`);
    await http(port, 'POST', `/simulators/${udid}/hinge?pose=closed`);
  });
  await check('foldable: 3D stream delivers frames', () => streamFrames(port, udid, 'stream.3d.avcc?width=640&height=640', 5, 30000));
}

async function main() {
  const version = (await baguette('--version')).stdout.trim();
  const xcode = (await run('/usr/bin/xcodebuild', ['-version'])).stdout.split('\n').join(' ').trim();
  const devices = [];
  const phone = await createDevice((name) => /^iPhone \d+( Pro)?$/.test(name));
  if (!phone) throw new Error('No iOS runtime with a regular iPhone device type');
  devices.push(phone);
  if (args.has('--foldable')) {
    const duo = await createDevice((name) => /Duo/i.test(name));
    if (duo) devices.push({ ...duo, foldable: true });
    else results.push({ name: 'foldable: no iPhone Duo device type on this Xcode', ok: true, skipped: true });
  }
  for (const device of devices) await check(`boot ${device.name} (${device.runtime})`, () => boot(device.udid));
  const port = await freePort();
  server = spawn(BAGUETTE, ['serve', '--host', '127.0.0.1', '--port', String(port), '--device-set', SET, '--no-plugins'], { stdio: 'ignore' });
  await check('server starts', async () => {
    for (let i = 0; i < 80; i++) {
      try { await http(port, 'GET', '/simulators.json'); return; } catch { await sleep(150); }
    }
    throw new Error('server did not answer');
  });
  for (const device of devices) {
    if (device.foldable) await foldableChecks(device, port);
    else await phoneChecks(device, port);
  }
  return { version, xcode, devices: devices.map(({ name, runtime }) => `${name} · ${runtime}`) };
}

let summary = {};
try {
  summary = await main();
} catch (error) {
  results.push({ name: 'setup', ok: false, error: String(error.message || error) });
} finally {
  server?.kill('SIGTERM');
  if (!args.has('--keep')) {
    try { await simctl('shutdown', 'all'); } catch { /* none booted */ }
    try { await simctl('delete', 'all'); } catch { /* nothing created */ }
    rmSync(SET, { recursive: true, force: true });
  }
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ ...summary, set: args.has('--keep') ? SET : '(deleted)', results }, null, 2));
console.log(failed.length ? `FAILED ${failed.length} of ${results.length}` : `PASSED ${results.length}`);
process.exit(failed.length ? 1 : 0);
