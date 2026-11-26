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
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ACCOUNT_DIR_ARG = '--cindy-account-dir';
/** Account directory was missing or unusable; entry never falls back to the original login. */
const ACCOUNT_DIR_EXIT_CODE = 77;
const APP_DATA_DIR_NAME = 'antigravity-cli';
const TOKEN_FILE_NAME = 'antigravity-oauth-token';
const MODEL_SESSION_FILE_NAME = 'cindy-model-session.json';

const MAX_DIR_LENGTH = 1024;
const MAX_TOKEN_FILE_BYTES = 64 * 1024;
const MAX_EMAIL = 254;
const MAX_NAME = 80;
const MAX_PLAN = 64;
const MAX_SUB = 128;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pathLib(options) {
  return (options && options.platform) === 'win32' || (!options?.platform && process.platform === 'win32')
    ? path.win32
    : path.posix;
}

function cleanPlainText(value, max) {
  if (typeof value !== 'string' || CONTROL_CHARS.test(value)) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  return trimmed;
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

function tokenFileOf(accountDir, options) {
  return pathLib(options).join(accountDir, '.gemini', APP_DATA_DIR_NAME, TOKEN_FILE_NAME);
}

function accountModelSessionFileOf(accountDir, options) {
  return pathLib(options).join(accountDir, MODEL_SESSION_FILE_NAME);
}

function ensureAccountSubdirs(accountDir) {
  fs.mkdirSync(appDataDirOf(accountDir), { recursive: true, mode: 0o700 });
}

function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sha256Prefix(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/**
 * Reads only non-secret account display metadata (`email`, `name`, `plan`, `fingerprint`)
 * from agy's isolated file-based token store (`<accountDir>/.gemini/antigravity-cli/antigravity-oauth-token`).
 * Never returns or logs OAuth credentials.
 */
function readAccountTokenMeta(accountDir) {
  if (typeof accountDir !== 'string' || !accountDir) return {};
  const file = tokenFileOf(accountDir);
  let data;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_TOKEN_FILE_BYTES) return {};
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const claims = decodeJwtPayload(data.id_token);
  const rawEmail = cleanPlainText(data.id_token_email, MAX_EMAIL)
    || cleanPlainText(claims && claims.email, MAX_EMAIL);
  const email = rawEmail && EMAIL_SHAPE.test(rawEmail) ? rawEmail : undefined;
  const name = cleanPlainText(claims && claims.name, MAX_NAME);
  const sub = cleanPlainText(claims && claims.sub, MAX_SUB);
  const plan = cleanPlainText(data.tier_display_name, MAX_PLAN);
  const fingerprint = email
    ? sha256Prefix(`antigravity-google:${email.toLowerCase()}`)
    : sub
      ? sha256Prefix(`antigravity-google-sub:${sub}`)
      : undefined;
  return {
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(plan ? { plan } : {}),
    ...(fingerprint ? { fingerprint } : {}),
  };
}

module.exports = {
  ACCOUNT_DIR_ARG,
  ACCOUNT_DIR_EXIT_CODE,
  APP_DATA_DIR_NAME,
  MODEL_SESSION_FILE_NAME,
  TOKEN_FILE_NAME,
  accountDirProblem,
  accountModelSessionFileOf,
  appDataDirOf,
  ensureAccountSubdirs,
  geminiDirOf,
  parseAccountDirArg,
  readAccountTokenMeta,
  tokenFileOf,
};
