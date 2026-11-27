'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnAgy, killTree, SESSION_SETTINGS } = require('./resolve-agy.js');
const { usageFromReport } = require('./agy-usage.js');

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

async function checkAccount(agyPath) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cindy-agy-account-'));
  const log = path.join(dir, 'verification.log');
  try {
    const child = spawnAgy(agyPath, ['--settings', SESSION_SETTINGS, '--log-file', 'verification.log',
      '--output-format', 'json', '--print', '/usage'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
    let length = 0;
    const chunks = [];
    const stop = () => killTree(child, 'SIGKILL');
    process.once('exit', stop);
    const timer = setTimeout(stop, 12000);
    try {
      child.stdout.on('data', chunk => {
        length += chunk.length;
        if (length <= 131072) chunks.push(chunk);
        else stop();
      });
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      if ((await fs.stat(log)).size > 1048576) return { status: 'unknown' };
      const url = validationUrl(await fs.readFile(log, 'utf8'));
      if (url) return { status: 'required', url };
      if (code === 0 && length <= 131072 && usageFromReport(JSON.parse(Buffer.concat(chunks).toString()))) return { status: 'ready' };
    } finally {
      clearTimeout(timer);
      process.removeListener('exit', stop);
    }
    return { status: 'unknown' };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

module.exports = { checkAccount, validationUrl };
