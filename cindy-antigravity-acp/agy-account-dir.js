'use strict';

/**
 * Isolated per-account directory layout for Antigravity accounts added in Cindy.
 *
 * When Cindy runs a task or account operation for an account it added, it passes
 * `--cindy-account-dir <dir>` (or `accountDir` to worker methods). Antigravity stores its
 * per-account data in `<dir>/.gemini/antigravity-cli`:
 *   - `agy acp` receives `--gemini-dir <dir>/.gemini --app-data-dir antigravity-cli` and
 *     `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`, keeping tokens, settings and history inside `<dir>`
 *     without changing the user's HOME or touching the OS keyring.
 *   - `agy --print /usage` receives `HOME=<dir>` (and `USERPROFILE=<dir>` on Windows) plus
 *     `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1` so it reads the exact same token file.
 *
 * The original (default) Antigravity login has no `accountDir` and continues using agy's
 * standard OS keyring and `~/.gemini` untouched.
 *
 * The plugin never opens agy's credential files: the account's identity comes from agy's own log of
 * the sign-in check (agy-account.js).
 */

const fs = require('node:fs');
const path = require('node:path');

const ACCOUNT_DIR_ARG = '--cindy-account-dir';
/** Account directory was missing or unusable; entry never falls back to the original login. */
const ACCOUNT_DIR_EXIT_CODE = 77;
const APP_DATA_DIR_NAME = 'antigravity-cli';
const MODEL_SESSION_FILE_NAME = 'cindy-model-session.json';

const MAX_DIR_LENGTH = 1024;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
/** Files agy or the OS may create in appDataDir without a sign-in (verified with agy 1.5.18). */
const NON_STORE_APPDATA_NAMES = new Set([
  'installation_id',
  'jetski_state.pbtxt',
  'last_check.timestamp',
  'cli.log',
  'conversation_summaries.db',
  'conversation_summaries.db-wal',
  'conversation_summaries.db-shm',
  'conversation_summaries.db-journal',
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
]);

function pathLib(options) {
  return (options && options.platform) === 'win32' || (!options?.platform && process.platform === 'win32')
    ? path.win32
    : path.posix;
}

/**
 * Parses `--cindy-account-dir <path>` from an entry's `process.argv`.
 * @returns {{ present: false } | { present: true, accountDir: string } | { present: true, error: string }}
 */
function parseAccountDirArg(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  let found;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== ACCOUNT_DIR_ARG) continue;
    if (found !== undefined) {
      return { present: true, error: `${ACCOUNT_DIR_ARG} was passed more than once` };
    }
    const next = args[index + 1];
    if (typeof next !== 'string' || !next.trim()) {
      return { present: true, error: `${ACCOUNT_DIR_ARG} requires an absolute directory path` };
    }
    found = next;
    index += 1;
  }
  return found === undefined ? { present: false } : { present: true, accountDir: found };
}

/**
 * Validates an account directory Cindy provided. Returns null when usable, or a short reason.
 */
function accountDirProblem(dir, options) {
  if (typeof dir !== 'string' || !dir.trim()) return 'account directory path is empty';
  if (dir.length > MAX_DIR_LENGTH || CONTROL_CHARS.test(dir)) return 'account directory path is invalid';
  const p = pathLib(options);
  if (!p.isAbsolute(dir)) return 'account directory must be an absolute path';
  if (options && options.skipFsCheck) return null;
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch (error) {
    return `account directory is not accessible (${error && error.code ? error.code : 'stat failed'})`;
  }
  if (!stat.isDirectory()) return 'account directory path is not a directory';
  try {
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    return `account directory is not readable and writable (${error && error.code ? error.code : 'access denied'})`;
  }
  return null;
}

function geminiDirOf(accountDir, options) {
  return pathLib(options).join(accountDir, '.gemini');
}

function appDataDirOf(accountDir, options) {
  return pathLib(options).join(accountDir, '.gemini', APP_DATA_DIR_NAME);
}

function accountModelSessionFileOf(accountDir, options) {
  return pathLib(options).join(accountDir, MODEL_SESSION_FILE_NAME);
}

function ensureAccountSubdirs(accountDir) {
  fs.mkdirSync(appDataDirOf(accountDir), { recursive: true, mode: 0o700 });
}

function isNonStoreAppDataName(name) {
  const lower = name.toLowerCase();
  return NON_STORE_APPDATA_NAMES.has(lower)
    || lower.endsWith('.log')
    || lower.startsWith('cindy-');
}

/**
 * Metadata-only snapshot (`readdir` + `lstat`, never opening or reading any file) of non-empty
 * regular files agy placed directly in `<accountDir>/.gemini/antigravity-cli`, excluding known
 * startup/log metadata files. Used to detect whether agy actually wrote isolated sign-in state
 * instead of silently falling back to the OS keyring.
 */
function snapshotIsolatedStoreFiles(accountDir, options) {
  const files = new Map();
  const dir = appDataDirOf(accountDir, options);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return files;
  }
  const p = pathLib(options);
  for (const name of names) {
    if (isNonStoreAppDataName(name)) continue;
    try {
      const stat = fs.lstatSync(p.join(dir, name));
      if (stat.isFile() && stat.size > 0) {
        files.set(name, { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino });
      }
    } catch {
      // entry disappeared or is inaccessible
    }
  }
  return files;
}

function hasIsolatedStoreFile(accountDir, options) {
  return snapshotIsolatedStoreFiles(accountDir, options).size > 0;
}

function hasUpdatedIsolatedStoreFile(before, after) {
  for (const [name, stat] of after.entries()) {
    const prev = before.get(name);
    if (!prev || prev.size !== stat.size || prev.mtimeMs !== stat.mtimeMs
      || prev.ctimeMs !== stat.ctimeMs || prev.ino !== stat.ino) {
      return true;
    }
  }
  return false;
}

module.exports = {
  ACCOUNT_DIR_ARG,
  ACCOUNT_DIR_EXIT_CODE,
  APP_DATA_DIR_NAME,
  MODEL_SESSION_FILE_NAME,
  accountDirProblem,
  accountModelSessionFileOf,
  appDataDirOf,
  ensureAccountSubdirs,
  geminiDirOf,
  hasIsolatedStoreFile,
  hasUpdatedIsolatedStoreFile,
  parseAccountDirArg,
  snapshotIsolatedStoreFiles,
};
