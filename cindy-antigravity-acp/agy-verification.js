'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnAgy, killTree, SESSION_SETTINGS } = require('./resolve-agy.js');
const { hasIsolatedStoreFile } = require('./agy-account-dir.js');
const { usageEnvironment, usageFromReport } = require('./agy-usage.js');

// The challenge belongs to this account. Only inspect an isolated, fresh /usage invocation.
// No model turn, shared log search, or reuse of a link from a different request.
function validationUrl(log) {
  for (const match of log.matchAll(/\{\s*"error"\s*:\s*\{[\s\S]*?\n\s*\}\s*\n\}/g)) {
    let error;
    try { ({ error } = JSON.parse(match[0])); } catch { continue; }
    if (error?.code !== 403 || error.status !== 'PERMISSION_DENIED' || !Array.isArray(error.details)) continue;
    for (const detail of error.details) {
      if (detail?.reason !== 'VALIDATION_REQUIRED' || detail.domain !== 'cloudcode-pa.googleapis.com' || detail['@type'] !== 'type.googleapis.com/google.rpc.ErrorInfo') continue;
      const raw = detail.metadata?.validation_url;
      if (typeof raw !== 'string' || raw.length > 2048) continue;
      try {
        const url = new URL(raw);
        if (url.origin === 'https://accounts.google.com' && !url.username && !url.password &&
            url.pathname === '/v3/signin/continue' && url.searchParams.get('plt') &&
            url.searchParams.get('continue') === 'https://developers.google.com/gemini-code-assist/auth/auth_success_gemini') return url.href;
      } catch { /* Unrecognized provider response. */ }
    }
  }
  return null;
}

// agy 1.5.18 records the authenticated principal in its own OAuth diagnostic. At session
// open the native ACP process has not received a prompt. Store only an in-memory digest.
function accountInLog(log) {
  let account;
  for (const match of log.matchAll(/^I\d{4} [\d:.]+\s+\d+ server_oauth\.go:\d+\] OAuth: authenticated successfully as ([^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+)\r?$/gm)) {
    if (match[1].length > 254) return null;
    const digest = createHash('sha256').update(match[1].toLowerCase()).digest('hex');
    if (account && account !== digest) return null;
    account = digest;
  }
  return account ?? null;
}

function readLog(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size > 1024 * 1024) return '';
    const buf = Buffer.alloc(size);
    return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, size, 0));
  } finally {
    fs.closeSync(fd);
  }
}

// One owner for both the source session's log and its in-flight probes. Exit handlers
// cannot await promises: stop processes and remove their files synchronously on teardown.
function createVerification(agyPath, options) {
  const temp = os.tmpdir();
  // A Windows shim cannot safely quote these characters even inside double quotes.
  // If the user's temp path cannot be passed, leave ordinary ACP sessions available.
  if ((options?.platform ?? process.platform) === 'win32' && /["%!^&|<>]/.test(temp)) return null;
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(temp, 'cindy-agy-account-'));
  } catch { return null; }
  const taskLog = path.join(dir, 'session.log');
  const children = new Set();
  const remove = folder => fs.rmSync(folder, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  let closed = false;
  return {
    taskLog,
    sessionAccount() {
      try { return accountInLog(readLog(taskLog)); } catch { return null; }
    },
    async check(account) {
      if (closed || !account) return { status: 'unknown' };
      const accountDir = options && typeof options.accountDir === 'string' && options.accountDir ? options.accountDir : undefined;
      if (accountDir && !hasIsolatedStoreFile(accountDir, options)) return { status: 'unknown' };
      const cwd = fs.mkdtempSync(path.join(dir, 'probe-'));
      let child, timer;
      try {
        child = spawnAgy(agyPath, ['--settings', SESSION_SETTINGS, '--log-file', 'verification.log',
          '--output-format', 'json', '--print', '/usage'], {
          ...options,
          cwd,
          env: usageEnvironment(options),
          ...(accountDir ? { accountDir, accountHome: true } : {}),
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        children.add(child);
        const stop = () => killTree(child, 'SIGKILL');
        timer = setTimeout(stop, 12000);
        let length = 0;
        const chunks = [];
        child.stdout.on('data', chunk => {
          length += chunk.length;
          if (length <= 131072) chunks.push(chunk);
          else stop();
        });
        const code = await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('close', resolve);
        });
        if (closed) return { status: 'unknown' };
        const log = readLog(path.join(cwd, 'verification.log'));
        if (accountInLog(log) !== account) return { status: 'unknown' };
        const url = validationUrl(log);
        if (url) return { status: 'required', url };
        if (code === 0 && length <= 131072 && usageFromReport(JSON.parse(Buffer.concat(chunks).toString()))) return { status: 'ready' };
      } catch { /* No confirmed result from this account. */ }
      finally {
        clearTimeout(timer);
        children.delete(child);
        if (!closed) remove(cwd);
      }
      return { status: 'unknown' };
    },
    dispose() {
      closed = true;
      for (const child of children) killTree(child, 'SIGKILL');
      remove(dir);
    },
  };
}

module.exports = { createVerification, validationUrl };
