'use strict';

/**
 * Locate and launch the DeepSeek Harness CLI (`dsh`) installed on this computer.
 *
 * Shared by worker.js (availability detection) and dsh-acp.js (the ACP entry), so
 * both always agree on which executable is used: the first match in a fixed,
 * documented search order.
 *
 * Safety: the executable path comes only from the file system, every argument is a
 * constant from this package (checked against SAFE_ARG), and a shell is used only
 * where Windows requires it for `.cmd` / `.bat` shims.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const INSTALL_COMMAND = 'npm i -g @deepseek-ai/dsh';
const VERSION_TIMEOUT_MS = 10_000;
const MAX_CAPTURE_BYTES = 64 * 1024;
const SAFE_ARG = /^[A-Za-z0-9._=-]+$/;
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'];
const MAX_NVM_VERSIONS = 16;

const MESSAGES = Object.freeze({
  'not-installed': Object.freeze({
    'zh-CN': '未找到 DeepSeek Harness。请先安装：npm i -g @deepseek-ai/dsh（需要 Node.js 24.9 或更高版本）',
    en: 'DeepSeek Harness was not found. Install it first: npm i -g @deepseek-ai/dsh (requires Node.js 24.9 or later)',
  }),
  'not-runnable': Object.freeze({
    'zh-CN': '找到了 DeepSeek Harness，但无法运行。请确认已安装 Node.js 24.9 或更高版本，然后重新安装：npm i -g @deepseek-ai/dsh',
    en: 'DeepSeek Harness was found but could not run. Make sure Node.js 24.9 or later is installed, then reinstall: npm i -g @deepseek-ai/dsh',
  }),
});

/** Only zh-CN has its own text; every other host language uses English. */
function pickLocale(locale) {
  return locale === 'zh-CN' ? 'zh-CN' : 'en';
}

function context(options) {
  const env = (options && options.env) || process.env;
  const platform = (options && options.platform) || process.platform;
  const win = platform === 'win32';
  return { env, platform, win, p: win ? path.win32 : path.posix };
}

/** Environment lookup; names are case-insensitive on Windows. */
function envGet(env, name, win) {
  if (!win) return typeof env[name] === 'string' ? env[name] : undefined;
  const upper = name.toUpperCase();
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === upper && typeof env[key] === 'string') return env[key];
  }
  return undefined;
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isExecutable(file, win) {
  if (!isFile(file)) return false;
  if (win) return true;
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function splitPathList(value, win) {
  if (typeof value !== 'string' || value === '') return [];
  return value
    .split(win ? ';' : ':')
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

function homeDir(ctx) {
  if (ctx.win) {
    const profile = envGet(ctx.env, 'USERPROFILE', true);
    if (profile) return profile;
    const drive = envGet(ctx.env, 'HOMEDRIVE', true);
    const homePath = envGet(ctx.env, 'HOMEPATH', true);
    return drive && homePath ? drive + homePath : undefined;
  }
  return envGet(ctx.env, 'HOME', false);
}

/** `prefix=` from the user's ~/.npmrc (where `npm i -g` puts executables). */
function npmPrefixFromRc(ctx, home) {
  if (!home) return undefined;
  let text;
  try {
    const file = ctx.p.join(home, '.npmrc');
    if (fs.statSync(file).size > 64 * 1024) return undefined;
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const match = /^[ \t]*prefix[ \t]*=[ \t]*(.+?)[ \t]*$/m.exec(text);
  if (!match) return undefined;
  let value = match[1].replace(/^(["'])(.*)\1$/, '$2');
  value = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => envGet(ctx.env, name, ctx.win) || '');
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) value = home + value.slice(1);
  return ctx.p.isAbsolute(value) ? value : undefined;
}

function compareVersionNamesDesc(a, b) {
  const pa = a.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
}

/** bin directories of nvm-managed Node versions, newest first. */
function nvmBinDirs(ctx, home) {
  const nvmDir = envGet(ctx.env, 'NVM_DIR', false) || (home ? ctx.p.join(home, '.nvm') : undefined);
  if (!nvmDir) return [];
  const versionsDir = ctx.p.join(nvmDir, 'versions', 'node');
  let names;
  try {
    names = fs.readdirSync(versionsDir).filter((name) => /^v\d+\.\d+\.\d+$/.test(name));
  } catch {
    return [];
  }
  return names
    .sort(compareVersionNamesDesc)
    .slice(0, MAX_NVM_VERSIONS)
    .map((name) => ctx.p.join(versionsDir, name, 'bin'));
}

/** Well-known global-install locations that a GUI-launched Cindy may not have on PATH. */
function extraDirs(ctx) {
  const home = homeDir(ctx);
  const dirs = [];
  const prefix = npmPrefixFromRc(ctx, home);
  if (prefix) dirs.push(ctx.win ? prefix : ctx.p.join(prefix, 'bin'));
  if (ctx.win) {
    const appData = envGet(ctx.env, 'APPDATA', true);
    if (appData) dirs.push(ctx.p.join(appData, 'npm'));
    const localAppData = envGet(ctx.env, 'LOCALAPPDATA', true);
    if (localAppData) {
      dirs.push(ctx.p.join(localAppData, 'Volta', 'bin'));
      dirs.push(ctx.p.join(localAppData, 'pnpm'));
    }
    return dirs;
  }
  if (home) {
    dirs.push(ctx.p.join(home, '.npm-global', 'bin'));
    dirs.push(ctx.p.join(home, '.local', 'bin'));
    dirs.push(ctx.p.join(home, '.volta', 'bin'));
  }
  dirs.push('/usr/local/bin', '/opt/homebrew/bin');
  if (home) {
    dirs.push(...nvmBinDirs(ctx, home));
    dirs.push(ctx.p.join(home, 'Library', 'pnpm'));
    dirs.push(ctx.p.join(home, '.local', 'share', 'pnpm'));
    dirs.push(ctx.p.join(home, '.bun', 'bin'));
  }
  return dirs;
}

function uniqueAbsolute(ctx, dirs) {
  const seen = new Set();
  const out = [];
  for (const dir of dirs) {
    // Relative PATH entries would resolve against the temp working directory: skip them.
    if (typeof dir !== 'string' || !ctx.p.isAbsolute(dir)) continue;
    const normalized = ctx.p.normalize(dir).replace(/[\\/]+$/, '') || ctx.p.sep;
    const key = ctx.win ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function managedDshRoot(options) {
  const ctx = context(options);
  const home = homeDir(ctx);
  const local = ctx.win && envGet(ctx.env, 'LOCALAPPDATA', true);
  return ctx.p.join(local || (ctx.win ? ctx.p.join(home, 'AppData', 'Local') : ctx.p.join(home, '.local', 'share')), 'cindy-dsh', 'cli');
}

function managedDsh(options) {
  const ctx = context(options);
  try {
    const root = managedDshRoot(options);
    const active = JSON.parse(fs.readFileSync(ctx.p.join(root, 'current.json'), 'utf8'));
    if (!/^[a-f0-9-]{36}$/.test(active.id) || typeof active.node !== 'string' || !ctx.p.isAbsolute(active.node)) return null;
    const entry = ctx.p.join(root, active.id, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    return isFile(entry) && isExecutable(active.node, ctx.win) ? { entry, node: active.node } : null;
  } catch { return null; }
}

/** Directories searched for dsh, in order: PATH first, then well-known install locations. */
function candidateDirs(options) {
  const ctx = context(options);
  return uniqueAbsolute(ctx, [...splitPathList(envGet(ctx.env, 'PATH', ctx.win), ctx.win), ...extraDirs(ctx)]);
}

function windowsExtensions(ctx) {
  const declared = splitPathList(envGet(ctx.env, 'PATHEXT', true), true).map((ext) => ext.toLowerCase());
  const ordered = declared.filter((ext) => WINDOWS_EXTENSIONS.includes(ext));
  for (const ext of WINDOWS_EXTENSIONS) if (!ordered.includes(ext)) ordered.push(ext);
  return ordered;
}

/** All existing dsh executables in search order. */
function findDshCandidates(options) {
  const ctx = context(options);
  const names = ctx.win ? windowsExtensions(ctx).map((ext) => 'dsh' + ext) : ['dsh'];
  const found = [];
  for (const dir of candidateDirs(options)) {
    for (const name of names) {
      const file = ctx.p.join(dir, name);
      if (isExecutable(file, ctx.win)) found.push(file);
    }
  }
  return found;
}

/** The dsh executable Cindy will use, or null when none is installed. */
function resolveDsh(options) {
  return managedDsh(options)?.entry || findDshCandidates(options)[0] || null;
}

/**
 * Environment for dsh: the inherited one, with the directory that holds dsh first on
 * PATH. npm puts `node` next to global bins (Homebrew, nvm, the official installers),
 * so `#!/usr/bin/env node` and the Windows `.cmd` shim can find it even when Cindy was
 * launched from the GUI with a minimal PATH. Existing well-known Node locations are
 * appended as a last resort.
 */
function childEnv(dshPath, options) {
  const ctx = context(options);
  const out = {};
  for (const [key, value] of Object.entries(ctx.env)) {
    if (value === undefined) continue;
    if (ctx.win ? key.toUpperCase() === 'PATH' : key === 'PATH') continue;
    out[key] = value;
  }
  const parts = [ctx.p.dirname(dshPath), ...splitPathList(envGet(ctx.env, 'PATH', ctx.win), ctx.win)];
  if (!ctx.win) {
    const home = homeDir(ctx);
    const fallbacks = ['/usr/local/bin', '/opt/homebrew/bin'];
    if (home) fallbacks.push(ctx.p.join(home, '.volta', 'bin'), ...nvmBinDirs(ctx, home).slice(0, 1));
    parts.push(...fallbacks.filter(isDirectory));
  }
  out.PATH = uniqueAbsolute(ctx, parts).join(ctx.win ? ';' : ':');
  return out;
}

function windowsSystemExe(env, name) {
  const root = envGet(env, 'SystemRoot', true) || envGet(env, 'windir', true) || 'C:\\Windows';
  const file = path.win32.join(root, 'System32', name);
  return isFile(file) ? file : null;
}

/**
 * Start dsh with constant arguments. Windows `.cmd` / `.bat` shims (what npm creates)
 * can only run through cmd.exe; the path is quoted and rejected if it contains
 * characters cmd.exe would still expand inside quotes.
 */
function spawnDsh(dshPath, args, options) {
  const ctx = context(options);
  for (const arg of args) {
    if (typeof arg !== 'string' || !SAFE_ARG.test(arg)) throw new Error('Refusing to pass a non-constant argument to dsh');
  }
  const base = {
    env: childEnv(dshPath, options),
    stdio: (options && options.stdio) || 'pipe',
    windowsHide: true,
  };
  // A working directory chosen by this package (never by a caller outside it).
  if (options && typeof options.cwd === 'string' && options.cwd) base.cwd = options.cwd;
  const managed = managedDsh(options);
  if (managed?.entry === dshPath) return spawn(managed.node, [dshPath, ...args], base);
  if (ctx.win && /\.(?:cmd|bat)$/i.test(dshPath)) {
    if (/["%!\r\n]/.test(dshPath)) {
      const error = new Error('The dsh path contains characters that cmd.exe cannot run safely');
      error.code = 'UNSAFE_PATH';
      throw error;
    }
    const shell = windowsSystemExe(ctx.env, 'cmd.exe') || true;
    return spawn(['"' + dshPath + '"', ...args].join(' '), { ...base, shell });
  }
  return spawn(dshPath, args, base);
}

function isRunning(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null;
}

/**
 * Stop dsh. On Windows the whole tree goes (cmd.exe shim -> node -> tools), since
 * killing only the shim would orphan dsh. On POSIX the signal goes to dsh itself.
 */
function killTree(child, signal) {
  if (!isRunning(child)) return;
  if (process.platform === 'win32' && child.pid) {
    const taskkill = windowsSystemExe(process.env, 'taskkill.exe');
    if (taskkill) {
      try {
        const result = spawnSync(taskkill, ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 5_000,
        });
        if (result.status === 0) return;
      } catch {
        // fall through to a direct kill
      }
    }
    try {
      child.kill();
    } catch {
      // already gone
    }
    return;
  }
  try {
    child.kill(signal || 'SIGTERM');
  } catch {
    // already gone
  }
}

function cleanText(text, max) {
  // eslint-disable-next-line no-control-regex
  const flat = String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

function firstLine(text) {
  return String(text).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

/** Run `dsh --version` (10 s limit) and report whether it works. */
function runVersion(dshPath, options) {
  const timeoutMs = (options && options.timeoutMs) || VERSION_TIMEOUT_MS;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnDsh(dshPath, ['--version'], { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, detail: cleanText(error.message, 200) });
      return;
    }
    const out = [];
    const err = [];
    let outBytes = 0;
    let errBytes = 0;
    let settled = false;
    const onProcessExit = () => killTree(child, 'SIGKILL');
    process.once('exit', onProcessExit);
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.removeListener('exit', onProcessExit);
      resolve(result);
    };
    const timer = setTimeout(() => {
      killTree(child, 'SIGKILL');
      settle({ ok: false, detail: `dsh --version did not finish within ${Math.round(timeoutMs / 1000)} s` });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      if (outBytes < MAX_CAPTURE_BYTES) out.push(chunk);
      outBytes += chunk.length;
    });
    child.stderr.on('data', (chunk) => {
      if (errBytes < MAX_CAPTURE_BYTES) err.push(chunk);
      errBytes += chunk.length;
    });
    child.on('error', (error) => {
      settle({ ok: false, detail: cleanText(`could not start dsh (${error.code || error.message})`, 200) });
    });
    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`;
        const line = firstLine(stderr) || firstLine(stdout);
        settle({ ok: false, detail: cleanText(line ? `${reason}: ${line}` : reason, 200) });
        return;
      }
      const text = firstLine(stdout) || firstLine(stderr);
      const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(text);
      settle({ ok: true, version: match ? match[1].slice(0, 32) : undefined });
    });
  });
}

function unavailable(reason, locale) {
  const messages = MESSAGES[reason];
  return { available: false, reason, message: messages[pickLocale(locale)], messages: { ...messages } };
}

/**
 * Detection result for the logic page:
 * { available, path?, version?, reason?: 'not-installed' | 'not-runnable',
 *   message?, messages?: { 'zh-CN', en }, detail? }
 */
async function detectDsh(options) {
  const locale = options && options.locale;
  const dshPath = resolveDsh(options);
  if (!dshPath) return unavailable('not-installed', locale);
  const run = await runVersion(dshPath, options);
  if (!run.ok) return { ...unavailable('not-runnable', locale), path: dshPath, detail: run.detail };
  return { available: true, path: dshPath, ...(run.version ? { version: run.version } : {}) };
}

module.exports = {
  INSTALL_COMMAND,
  MESSAGES,
  candidateDirs,
  childEnv,
  detectDsh,
  findDshCandidates,
  killTree,
  managedDshRoot,
  pickLocale,
  resolveDsh,
  spawnDsh,
};
