'use strict';

/**
 * DeepSeek API key through DSH's own credential store.
 *
 * DSH reads `DEEPSEEK_API_KEY` from its credential file (`$DSH_HOME/.credentials.yaml`, by default
 * `~/.dsh`), then the launch environment, then `.env` files. The plugin never edits that file by
 * hand: it loads the `@deepseek-ai/dsh-credentials-local` provider from the dsh installation it
 * found and calls describe / set / unset — the same path DSH's own settings use (cross-process
 * writer lock, owner-only file, comments and other entries kept). A saved key applies to the next
 * request of every dsh process, including the one Cindy runs, without a restart.
 *
 * Values never leave this module: results carry only { configured, source, writable }.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolveDsh } = require('./resolve-dsh.js');

const KEY_REF = 'DEEPSEEK_API_KEY';
const DSH_PACKAGE = '@deepseek-ai/dsh';
const READY_TIMEOUT_MS = 5000;
const MAX_KEY_LENGTH = 512;

function packageName(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name;
  } catch {
    return null;
  }
}

/** The installed `@deepseek-ai/dsh` package behind a dsh executable or shim, or null. */
function findDshPackageDir(dshPath) {
  const binDir = path.dirname(dshPath);
  const candidates = [];
  // POSIX global installs link the bin straight to `<pkg>/lib/bin.js`.
  try {
    candidates.push(path.resolve(path.dirname(fs.realpathSync(dshPath)), '..'));
  } catch { /* unreadable path: try the shims below */ }
  // npm on Windows: `<prefix>/dsh.cmd` next to `<prefix>/node_modules`.
  candidates.push(path.join(binDir, 'node_modules', '@deepseek-ai', 'dsh'));
  // npm prefix on POSIX: `<prefix>/bin` next to `<prefix>/lib/node_modules`.
  candidates.push(path.join(binDir, '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh'));
  // npm / pnpm shims name the script they run; follow it.
  try {
    const text = fs.readFileSync(dshPath, 'utf8').slice(0, 8192);
    const match = text.match(/[^"'\s]*@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js/);
    if (match) {
      const target = match[0]
        .replace(/^%~?dp0%?[\\/]?/i, binDir + path.sep)
        .replace(/^\$basedir[\\/]/, binDir + path.sep);
      candidates.push(path.resolve(binDir, path.dirname(path.dirname(target))));
    }
  } catch { /* binary or unreadable: no shim to follow */ }
  for (const dir of candidates) {
    if (packageName(dir) === DSH_PACKAGE) return path.resolve(dir);
  }
  return null;
}

/** `@deepseek-ai/<name>` as resolved from the dsh package (nested first, then hoisted). */
function findModule(pkgDir, name) {
  let dir = pkgDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function sourceOf(info) {
  if (!info || info.configured !== true) return undefined;
  if (info.source === 'file') return 'file';
  if (info.source === 'env') return 'env';
  return 'dotenv';
}

function statusOf(info) {
  const source = sourceOf(info);
  return {
    supported: true,
    configured: info && info.configured === true,
    ...(source ? { source } : {}),
    writable: info ? info.writable !== false : false,
  };
}

async function waitForStore(ctx, fiber) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (fiber && fiber.inertia) await fiber.inertia.catch(() => {});
    const store = (typeof ctx.get === 'function' ? ctx.get('credentials') : undefined) || ctx.credentials;
    if (store && typeof store.describe === 'function' && typeof store.set === 'function') return store;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Opens DSH's credential store for one operation and closes it again. Returns
 * `{ supported: false, reason }` when dsh or a compatible store cannot be found.
 */
async function withStore(options, operation) {
  const dshPath = resolveDsh(options);
  if (!dshPath) return { supported: false, reason: 'not-installed' };
  const pkgDir = findDshPackageDir(dshPath);
  if (!pkgDir) return { supported: false, reason: 'unknown-layout' };
  const files = ['cordis', 'dsh-credentials', 'dsh-credentials-local'].map((name) => findModule(pkgDir, name));
  if (files.some((file) => !file)) return { supported: false, reason: 'unsupported-version' };
  const [cordis, credentials, local] = await Promise.all(files.map((file) => import(pathToFileURL(file).href)));
  if (
    typeof cordis.Context !== 'function' ||
    typeof credentials.credentialRef !== 'function' ||
    typeof local.LocalCredentialProvider !== 'function'
  ) {
    return { supported: false, reason: 'unsupported-version' };
  }
  const ctx = new cordis.Context();
  // No file watcher: this store lives for one operation; running dsh processes watch the file.
  const fiber = ctx.plugin(local.LocalCredentialProvider, { watch: false });
  try {
    const store = await waitForStore(ctx, fiber);
    if (!store) return { supported: false, reason: 'unsupported-version' };
    return await operation(store, credentials.credentialRef(KEY_REF), credentials.credentialRef);
  } finally {
    if (fiber && typeof fiber.dispose === 'function') await fiber.dispose().catch(() => {});
  }
}

function keyStatus(options) {
  return withStore(options, async (store, ref) => statusOf(await store.describe(ref)));
}

/** The credential stays inside the DSH worker and is sent only to DeepSeek's fixed balance endpoint. */
async function readUsage(options, request = fetch) {
  const result = await withStore(options, async (store, ref, credentialRef) => {
    const endpoint = await store.resolve(credentialRef('DEEPSEEK_BASE_URL'));
    if (endpoint?.value && new URL(endpoint.value).origin !== 'https://api.deepseek.com') return null;
    const credential = await store.resolve(ref);
    if (!credential?.value) return null;
    const response = await request('https://api.deepseek.com/user/balance', {
      headers: { Authorization: 'Bearer ' + credential.value }, redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data.balance_infos)) return null;
    const balances = data.balance_infos.filter(row => row && ['CNY', 'USD'].includes(row.currency)
      && typeof row.total_balance === 'string' && /^-?\d{1,15}(?:\.\d{1,12})?$/.test(row.total_balance))
      .slice(0, 8).map(row => ({ currency: row.currency, amount: row.total_balance }));
    return balances.length ? { updatedAt: Date.now(), balances } : null;
  });
  return result?.balances ? result : null;
}

/** A DeepSeek key is one token: no whitespace inside, bounded length. */
function normalizeKey(raw) {
  if (typeof raw !== 'string') return null;
  const key = raw.trim();
  if (!key || key.length > MAX_KEY_LENGTH || /\s/.test(key)) return null;
  return key;
}

async function setKey(rawKey, options) {
  const key = normalizeKey(rawKey);
  if (!key) return { supported: true, error: 'invalid-key' };
  return withStore(options, async (store, ref) => {
    await store.set(ref, key);
    return statusOf(await store.describe(ref));
  });
}

function clearKey(options) {
  return withStore(options, async (store, ref) => {
    await store.unset(ref);
    return statusOf(await store.describe(ref));
  });
}

module.exports = { KEY_REF, clearKey, findDshPackageDir, findModule, keyStatus, normalizeKey, readUsage, setKey };
