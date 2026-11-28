'use strict';

/**
 * Locate and launch the Antigravity CLI (`agy`) installed on this computer.
 *
 * Shared by worker.js (availability detection) and agy-acp.js (the ACP entry), so
 * both always agree on which executable is used: either the validated custom path
 * configured in the user's config file, or the first match in a fixed, documented
 * search order.
 *
 * Safety: the executable path is either auto-discovered on the file system or an
 * explicit absolute file path saved by the user (and checked for cmd.exe safety on
 * Windows `.cmd`/`.bat` shims); every argument is a constant from this package
 * (checked against SAFE_ARG, or one of CONSTANT_ARGS), and a shell is used only
 * where Windows requires it for `.cmd` / `.bat` shims.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { APP_DATA_DIR_NAME, accountDirProblem, geminiDirOf } = require('./agy-account-dir.js');

const INSTALL_PAGE = 'https://antigravity.google';
const VERSION_TIMEOUT_MS = 10_000;
const MAX_CAPTURE_BYTES = 64 * 1024;
const SAFE_ARG = /^[A-Za-z0-9._=-]+$/;
/**
 * Session-only agy settings for every session Cindy starts ("never saved" per `agy --help`):
 * no paid Google AI credits once the subscription quota is used up (user decision 2026-11-19).
 */
const SESSION_SETTINGS = JSON.stringify({ useG1Credits: false });
/** Arguments outside SAFE_ARG that are still constants of this package. */
const CONSTANT_ARGS = new Set([SESSION_SETTINGS, '/usage']);
// Through a cmd.exe shim a constant is passed quoted (cmdArg); it must hold nothing cmd.exe expands.
for (const arg of CONSTANT_ARGS) {
  if (/[%!^&|<>\\\r\n]/.test(arg)) throw new Error('Constant agy argument is not safe for cmd.exe');
}

/**
 * One argument on a cmd.exe command line for a `.cmd` shim: SAFE_ARG text as is; a constant in
 * double quotes with inner quotes as \" (the target's C runtime turns it back into the constant).
 */
function cmdArg(arg) {
  // The allowlisted constants contain no backslashes or control characters. JSON string
  // quoting generates exactly the enclosing quotes and escaped inner quotes they require.
  return SAFE_ARG.test(arg) ? arg : JSON.stringify(arg);
}
/** How Cindy starts agy: session settings (no paid credits), ACP mode, no telemetry. */
const ACP_ARGS = Object.freeze(['--settings', SESSION_SETTINGS, 'acp', '--disable-telemetry']);

/**
 * ACP arguments for the default login (unchanged `ACP_ARGS`) or for an isolated Cindy account
 * directory (`--gemini-dir <dir>/.gemini --app-data-dir antigravity-cli`), plus `--log-file <file>`
 * when the plugin's own sign-in check asks agy to write this run's log to a private file.
 */
function acpArgsFor(options) {
  const accountDir = options && options.accountDir;
  let args = ACP_ARGS;
  if (accountDir) {
    const problem = accountDirProblem(accountDir, options);
    if (problem) {
      const error = new Error(problem);
      error.code = 'INVALID_ACCOUNT_DIR';
      throw error;
    }
    args = [...ACP_ARGS, '--gemini-dir', geminiDirOf(accountDir, options), '--app-data-dir', APP_DATA_DIR_NAME];
  }
  const logFile = logFileOf(options);
  return logFile === null ? args : [...args, '--log-file', logFile];
}

/**
 * The log file of this run, chosen by this package (agy-account.js: a file in a private temporary
 * directory); null when none was asked for. Never a path from outside the package.
 */
function logFileOf(options) {
  const file = options && typeof options.logFile === 'string' && options.logFile ? options.logFile : null;
  if (file === null) return null;
  // eslint-disable-next-line no-control-regex
  if (!context(options).p.isAbsolute(file) || /[\u0000-\u001f\u007f]/.test(file)) {
    const error = new Error('The agy log file path is not usable');
    error.code = 'UNSAFE_PATH';
    throw error;
  }
  return file;
}
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'];
const MAX_NVM_VERSIONS = 16;
const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_CUSTOM_PATH_LENGTH = 1024;
const CONFIG_DIR_NAME = 'cindy-antigravity-acp';
const CONFIG_FILE_NAME = 'config.json';

const MESSAGES = Object.freeze({
  'not-installed': Object.freeze({
    'zh-CN': '未找到 Antigravity 命令行（agy）。请先从 https://antigravity.google 安装，然后点「重新检测」。',
    en: 'The Antigravity CLI (agy) was not found. Install it from https://antigravity.google, then select Check again.',
  }),
  'custom-path-unavailable': Object.freeze({
    'zh-CN': '自定义的 Antigravity 命令行路径不可用。请打开 Antigravity 插件设置修改路径或恢复自动检测。',
    en: 'The configured Antigravity CLI path is unavailable. Open the Antigravity plugin settings to update it or switch back to auto-detect.',
  }),
  'not-runnable': Object.freeze({
    'zh-CN': '找到了 Antigravity 命令行（agy），但无法运行。请重新安装后点「重新检测」。',
    en: 'The Antigravity CLI (agy) was found but could not run. Reinstall it, then select Check again.',
  }),
  'not-signed-in': Object.freeze({
    'zh-CN': 'Antigravity 还没有登录。请在终端运行 agy，用 Google 账号登录后点「重新检测」。',
    en: 'Antigravity is not signed in. Run agy in a terminal, sign in with your Google account, then select Check again.',
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
    const agyHome = envGet(ctx.env, 'LOCALAPPDATA', true);
    // Where the Antigravity installer puts agy on Windows (verified with agy 1.5.12).
    if (agyHome) dirs.push(ctx.p.join(agyHome, 'agy', 'bin'));
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
    dirs.push(ctx.p.join(home, '.agy', 'bin'));
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

/** Directories searched for agy, in order: PATH first, then well-known install locations. */
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

/** All existing agy executables in search order. */
function findAgyCandidates(options) {
  const ctx = context(options);
  const names = ctx.win ? windowsExtensions(ctx).map((ext) => 'agy' + ext) : ['agy'];
  const found = [];
  for (const dir of candidateDirs(options)) {
    for (const name of names) {
      const file = ctx.p.join(dir, name);
      if (isExecutable(file, ctx.win)) found.push(file);
    }
  }
  return found;
}

/** Per-user machine-local config file shared by worker.js and agy-acp.js (survives plugin updates). */
function configFilePath(options) {
  const ctx = context(options);
  if (ctx.win) {
    const base = envGet(ctx.env, 'LOCALAPPDATA', true);
    if (base && isWindowsFullAbsolute(base)) return ctx.p.join(base, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
    const home = homeDir(ctx);
    return home && isWindowsFullAbsolute(home) ? ctx.p.join(home, 'AppData', 'Local', CONFIG_DIR_NAME, CONFIG_FILE_NAME) : null;
  }
  const xdg = envGet(ctx.env, 'XDG_CONFIG_HOME', false);
  if (xdg && ctx.p.isAbsolute(xdg)) return ctx.p.join(xdg, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
  const home = homeDir(ctx);
  return home && ctx.p.isAbsolute(home) ? ctx.p.join(home, '.config', CONFIG_DIR_NAME, CONFIG_FILE_NAME) : null;
}

/** Windows drive-qualified (C:\...) or UNC (\\server\share...) absolute path — never drive-relative (\bin\agy). */
function isWindowsFullAbsolute(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value);
}

/** Normalizes and syntactically checks a user-supplied custom agy executable path. */
function normalizeCustomPath(raw, options) {
  if (typeof raw !== 'string') return { ok: false, error: 'not-absolute' };
  let value = raw.trim();
  const quoted = /^(["'])(.*)\1$/.exec(value);
  if (quoted) value = quoted[2].trim();
  if (!value) return { ok: true, path: null };
  // eslint-disable-next-line no-control-regex
  if (value.length > MAX_CUSTOM_PATH_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, error: 'not-absolute' };
  }
  const ctx = context(options);
  if (value === '~' || value.startsWith('~/') || (ctx.win && value.startsWith('~\\'))) {
    const home = homeDir(ctx);
    if (!home) return { ok: false, error: 'not-absolute' };
    value = home + value.slice(1);
  }
  if (ctx.win ? !isWindowsFullAbsolute(value) : !ctx.p.isAbsolute(value)) {
    return { ok: false, error: 'not-absolute' };
  }
  const normalized = ctx.p.normalize(value);
  if (ctx.win && /\.(?:cmd|bat)$/i.test(normalized) && /["%!\r\n]/.test(normalized)) {
    return { ok: false, error: 'unsafe-path' };
  }
  return { ok: true, path: normalized };
}

/** Validates a user-supplied custom agy executable path (empty string resets to auto-discovery). */
function validateCustomPath(raw, options) {
  const norm = normalizeCustomPath(raw, options);
  if (!norm.ok || norm.path === null) return norm;
  const ctx = context(options);
  if (!isFile(norm.path)) return { ok: false, error: 'not-found' };
  if (!isExecutable(norm.path, ctx.win)) return { ok: false, error: 'not-executable' };
  return norm;
}

/**
 * Reads the custom path configuration state:
 * - `{ kind: 'none' }` when no config file exists (auto-discovery active)
 * - `{ kind: 'configured', path }` when a valid custom path is saved
 * - `{ kind: 'invalid' }` when config.json exists but is unreadable, corrupt, oversized, or invalid
 */
function readCustomAgyConfig(options) {
  const file = configFilePath(options);
  if (!file) return { kind: 'none' };
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    return error && error.code === 'ENOENT' ? { kind: 'none' } : { kind: 'invalid' };
  }
  if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) return { kind: 'invalid' };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { kind: 'invalid' };
  }
  if (!data || typeof data !== 'object' || typeof data.customPath !== 'string') return { kind: 'invalid' };
  const norm = normalizeCustomPath(data.customPath, options);
  if (!norm.ok || !norm.path) return { kind: 'invalid' };
  return { kind: 'configured', path: norm.path };
}

/** Reads the user-configured custom agy path, or null when not validly configured. */
function readCustomAgyPath(options) {
  const cfg = readCustomAgyConfig(options);
  return cfg.kind === 'configured' ? cfg.path : null;
}

/** Validates and atomically saves (or clears when empty) the custom agy path. */
function writeCustomAgyPath(raw, options) {
  const checked = validateCustomPath(raw, options);
  if (!checked.ok) return checked;
  const file = configFilePath(options);
  if (!file) return { ok: false, error: 'write-failed' };
  if (checked.path === null) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      return { ok: false, error: 'write-failed' };
    }
    return { ok: true, customPath: null };
  }
  const ctx = context(options);
  const dir = ctx.p.dirname(file);
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, JSON.stringify({ customPath: checked.path }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
    return { ok: true, customPath: checked.path };
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore cleanup error */ }
    return { ok: false, error: 'write-failed' };
  }
}

/**
 * The agy executable Cindy will use, or null when none is available.
 * When a custom path config file exists (valid or corrupt), auto-discovery is never used as a fallback.
 */
function resolveAgy(options) {
  const ctx = context(options);
  const cfg = readCustomAgyConfig(options);
  if (cfg.kind === 'invalid') return null;
  if (cfg.kind === 'configured') return isExecutable(cfg.path, ctx.win) ? cfg.path : null;
  return findAgyCandidates(options)[0] || null;
}

/**
 * Environment for agy: the inherited one, with the directory that holds agy first on
 * PATH. npm puts `node` next to global bins (Homebrew, nvm, the official installers),
 * so `#!/usr/bin/env node` and the Windows `.cmd` shim can find it even when Cindy was
 * launched from the GUI with a minimal PATH. Existing well-known Node locations are
 * appended as a last resort.
 */
function childEnv(agyPath, options) {
  const ctx = context(options);
  const accountDir = options && typeof options.accountDir === 'string' && options.accountDir ? options.accountDir : null;
  const accountHome = Boolean(accountDir && options && options.accountHome);
  const out = {};
  for (const [key, value] of Object.entries(ctx.env)) {
    if (value === undefined) continue;
    const upper = ctx.win ? key.toUpperCase() : key;
    if (upper === 'PATH') continue;
    if (accountDir && upper === 'AGY_CLI_FORCE_FILE_TOKEN_STORAGE') continue;
    if (accountHome && (upper === 'HOME' || (ctx.win && upper === 'USERPROFILE'))) continue;
    out[key] = value;
  }
  if (accountDir) {
    out.AGY_CLI_FORCE_FILE_TOKEN_STORAGE = '1';
    if (accountHome) {
      out.HOME = accountDir;
      if (ctx.win) out.USERPROFILE = accountDir;
    }
  }
  const parts = [ctx.p.dirname(agyPath), ...splitPathList(envGet(ctx.env, 'PATH', ctx.win), ctx.win)];
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
 * Start agy with constant arguments (plus the validated `--gemini-dir <dir>/.gemini` pair when an
 * isolated account directory is configured, and the package's own `--log-file <file>` pair). Windows `.cmd` / `.bat` shims (what npm creates) can
 * only run through cmd.exe; paths are quoted and rejected if they contain characters cmd.exe would
 * still expand inside quotes.
 */
function spawnAgy(agyPath, args, options) {
  const ctx = context(options);
  const accountDir = options && typeof options.accountDir === 'string' && options.accountDir ? options.accountDir : null;
  let allowedGeminiDir = null;
  if (accountDir) {
    const problem = accountDirProblem(accountDir, options);
    if (problem) {
      const error = new Error(problem);
      error.code = 'INVALID_ACCOUNT_DIR';
      throw error;
    }
    allowedGeminiDir = geminiDirOf(accountDir, options);
  } else if (options && options.isolatedGeminiDir) {
    // Remote-workspace hooks use an empty per-launch Gemini directory so the default agent
    // cannot load this computer's global MCP servers or plugins. Only this launch owns it.
    const expected = options.cwd && ctx.p.join(options.cwd, '.gemini');
    if (!expected || options.isolatedGeminiDir !== expected) throw new Error('Invalid isolated Gemini directory');
    allowedGeminiDir = expected;
  }
  const allowedLogFile = logFileOf(options);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const constant = typeof arg === 'string' && (SAFE_ARG.test(arg) || CONSTANT_ARGS.has(arg));
    const isGeminiDirArg = allowedGeminiDir !== null && index > 0 && args[index - 1] === '--gemini-dir' && arg === allowedGeminiDir;
    const isLogFileArg = allowedLogFile !== null && index > 0 && args[index - 1] === '--log-file' && arg === allowedLogFile;
    if (!constant && !isGeminiDirArg && !isLogFileArg) throw new Error('Refusing to pass a non-constant argument to agy');
  }
  // Created by the relay in a private temp directory. Keep the task's original working directory.
  const logFile = allowedLogFile;
  if (logFile !== null && !args.includes('--log-file')) {
    if (ctx.win && /["%!^&|<>]/.test(logFile)) {
      const error = new Error('The agy log file path contains characters that cmd.exe cannot run safely');
      error.code = 'UNSAFE_PATH';
      throw error;
    }
    args = ['--log-file', logFile, ...args];
  }
  const base = {
    env: childEnv(agyPath, options),
    stdio: (options && options.stdio) || 'pipe',
    windowsHide: true,
  };
  // A working directory chosen by this package (never by a caller outside it).
  if (options && typeof options.cwd === 'string' && options.cwd) base.cwd = options.cwd;
  if (ctx.win && /\.(?:cmd|bat)$/i.test(agyPath)) {
    if (/["%!\r\n]/.test(agyPath)) {
      const error = new Error('The agy path contains characters that cmd.exe cannot run safely');
      error.code = 'UNSAFE_PATH';
      throw error;
    }
    if (allowedGeminiDir !== null && /["%!^&|<>\r\n]/.test(allowedGeminiDir)) {
      const error = new Error('The account directory path contains characters that cmd.exe cannot run safely');
      error.code = 'UNSAFE_PATH';
      throw error;
    }
    if (allowedLogFile !== null && /["%!^&|<>\r\n]/.test(allowedLogFile)) {
      const error = new Error('The agy log file path contains characters that cmd.exe cannot run safely');
      error.code = 'UNSAFE_PATH';
      throw error;
    }
    const shell = windowsSystemExe(ctx.env, 'cmd.exe') || true;
    const formatArg = (arg) => (arg === allowedGeminiDir || arg === allowedLogFile ? '"' + arg + '"' : cmdArg(arg));
    return spawn(['"' + agyPath + '"', ...args.map(formatArg)].join(' '), { ...base, shell });
  }
  return spawn(agyPath, args, base);
}

function isRunning(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null;
}

/**
 * Stop agy. On Windows the whole tree goes (cmd.exe shim -> node -> tools), since
 * killing only the shim would orphan agy. On POSIX the signal goes to agy itself.
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

/** Run `agy --version` (10 s limit) and report whether it works. */
function runVersion(agyPath, options) {
  const timeoutMs = (options && options.timeoutMs) || VERSION_TIMEOUT_MS;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnAgy(agyPath, ['--version'], {
          ...options, env: { ...(options?.env || process.env), AGY_CLI_DISABLE_AUTO_UPDATE: 'true' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
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
      settle({ ok: false, detail: `agy --version did not finish within ${Math.round(timeoutMs / 1000)} s` });
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
      settle({ ok: false, detail: cleanText(`could not start agy (${error.code || error.message})`, 200) });
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
 * { available, path?, customPath?, customPathConfigured?, version?,
 *   reason?: 'not-installed' | 'custom-path-unavailable' | 'not-runnable',
 *   message?, messages?: { 'zh-CN', en }, detail? }
 */
async function detectAgy(options) {
  const ctx = context(options);
  const locale = options && options.locale;
  const cfg = readCustomAgyConfig(options);
  if (cfg.kind === 'invalid') {
    return {
      ...unavailable('custom-path-unavailable', locale),
      customPathConfigured: true,
      detail: 'Custom path configuration could not be read. Save a new path or switch back to auto-detect.',
    };
  }
  const customPath = cfg.kind === 'configured' ? cfg.path : null;
  const agyPath = customPath
    ? (isExecutable(customPath, ctx.win) ? customPath : null)
    : (findAgyCandidates(options)[0] || null);
  if (!agyPath) {
    if (customPath) {
      return {
        ...unavailable('custom-path-unavailable', locale),
        customPath,
        customPathConfigured: true,
        detail: cleanText(`Configured path was not found or is not executable: ${customPath}`, 200),
      };
    }
    return unavailable('not-installed', locale);
  }
  const run = await runVersion(agyPath, options);
  if (!run.ok) {
    return {
      ...unavailable('not-runnable', locale),
      path: agyPath,
      ...(customPath ? { customPath, customPathConfigured: true } : {}),
      detail: run.detail,
    };
  }
  return {
    available: true,
    path: agyPath,
    ...(customPath ? { customPath, customPathConfigured: true } : {}),
    ...(run.version ? { version: run.version } : {}),
  };
}

module.exports = {
  ACP_ARGS,
  INSTALL_PAGE,
  MESSAGES,
  SESSION_SETTINGS,
  acpArgsFor,
  candidateDirs,
  childEnv,
  configFilePath,
  detectAgy,
  findAgyCandidates,
  killTree,
  pickLocale,
  readCustomAgyConfig,
  readCustomAgyPath,
  resolveAgy,
  runVersion,
  spawnAgy,
  validateCustomPath,
  writeCustomAgyPath,
};
