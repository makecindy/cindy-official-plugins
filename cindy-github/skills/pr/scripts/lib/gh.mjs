// gh CLI wrapper. JSON-only mode. Hard-fails on auth / rate-limit. Single retry on transient.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Buffer cap: 50MB is enough for any single PR-level response we expect.
const MAX_BUFFER = 50 * 1024 * 1024;
const RETRY_BACKOFF_MS = 3000;

function looksFatal(stderrStr) {
  return /HTTP 40[13]/.test(stderrStr)
    || /authentication required/i.test(stderrStr)
    || /requires authentication/i.test(stderrStr)
    || /rate limit|HTTP 429/i.test(stderrStr)
    || /bad credentials/i.test(stderrStr)
    || /gh auth login|populate the GH_TOKEN|not logged into any(?: GitHub)? hosts|no oauth token found/i.test(stderrStr);
}

async function runOnce(args) {
  const { stdout } = await exec('gh', args, { maxBuffer: MAX_BUFFER, encoding: 'utf8' });
  return stdout;
}

// Parse the stdout of `gh api` as JSON. Throws on non-JSON output.
function parseJson(stdout, context) {
  try { return JSON.parse(stdout); }
  catch (e) {
    throw new Error(`gh ${context}: stdout is not valid JSON (${e.message}); first 200 chars: ${stdout.slice(0, 200)}`);
  }
}

/** Only response metadata is exported; never echo headers that may carry credentials. */
export function splitHttpResponse(stdout) {
  const match = /^HTTP\/[^\r\n]+\r?\n([\s\S]*?)\r?\n\r?\n/.exec(stdout);
  if (!match) return { statusCode: null, headers: '', body: stdout };
  const statusMatch = /^HTTP\/\S+\s+(\d{3})\b/.exec(match[0]);
  return {
    statusCode: statusMatch ? Number(statusMatch[1]) : null,
    headers: match[1],
    body: stdout.slice(match[0].length),
  };
}

export function extractHeader(headers, name) {
  if (!headers || !name) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, 'im').exec(headers);
  return match ? match[1].trim() : null;
}

function isHttp304Error(error) {
  const { statusCode } = splitHttpResponse(String(error?.stdout ?? ''));
  if (statusCode === 304) return true;
  return /\bHTTP 304\b/.test(String(error?.stderr ?? ''));
}

export function rateLimitRetryAt(headers, now = Date.now()) {
  const reset = /^x-ratelimit-reset:\s*(\d+)\s*$/im.exec(headers);
  const remaining = /^x-ratelimit-remaining:\s*(\d+)\s*$/im.exec(headers)?.[1];
  const retry = /^retry-after:\s*(.+)$/im.exec(headers)?.[1]?.trim();
  const retryAt = retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry ?? '');
  // A primary-window reset constrains retries only when its quota is exhausted.
  // Without remaining metadata, prefer an explicit secondary-limit Retry-After.
  const validRetry = Number.isFinite(retryAt) && retryAt > now;
  if (validRetry && remaining !== '0') return retryAt;
  const resetAt = reset && (remaining === undefined || remaining === '0') ? Number(reset[1]) * 1000 : 0;
  const value = Math.max(Number.isFinite(retryAt) ? retryAt : 0, resetAt);
  return Number.isFinite(value) && value > now ? value : null;
}

function reportRateLimit(error) {
  if (!/rate limit|HTTP 429/i.test(`${error.stderr ?? ''} ${error.message ?? ''}`)) return;
  const retryAt = rateLimitRetryAt(splitHttpResponse(String(error.stdout ?? '')).headers);
  process.stderr.write(`[gh-rate-limit] retryAt=${retryAt ?? 0}\n`);
}

// Run `gh --version` and exit(1) if not installed / not on PATH.
export async function ensureBinary() {
  try {
    await exec('gh', ['--version'], { encoding: 'utf8' });
  } catch (e) {
    process.stderr.write(`[gh] binary not found on PATH. Install gh and re-run.\n`);
    process.exit(1);
  }
}

// `gh api <path>` returning parsed JSON. One retry with backoff on transient failure.
// Auth / rate-limit failures exit(1) immediately.
export async function ghJson(path, { retries = 1, includeHeaders = false, fatalExit = true } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const stdout = await runOnce(['api', path, ...(includeHeaders ? ['--include'] : [])]);
      return parseJson(includeHeaders ? splitHttpResponse(stdout).body : stdout, path);
    } catch (e) {
      lastErr = e;
      const errStr = String(e.stderr || '') + String(e.message || '');
      if (looksFatal(errStr)) {
        if (includeHeaders) reportRateLimit(e);
        process.stderr.write(`[gh] fatal on ${path}: ${errStr.slice(0, 500)}\n`);
        if (fatalExit) process.exit(1);
        throw e;
      }
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      }
    }
  }
  throw lastErr;
}

// Conditional `gh api <path> --include` with optional ETag (`If-None-Match`).
// HTTP 304 Not Modified returns `{ notModified: true, data: null, etag, headers }` without
// consuming GitHub REST rate-limit quota or retrying.
export async function ghJsonConditional(
  path,
  { etag = null, retries = 1, includeHeaders = true, fatalExit = true } = {},
) {
  const safeEtag = typeof etag === 'string' && etag.trim() && !/[\r\n]/.test(etag) ? etag.trim() : null;
  const args = ['api', path, ...(includeHeaders || safeEtag ? ['--include'] : [])];
  if (safeEtag) args.push('-H', `If-None-Match: ${safeEtag}`);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const stdout = await runOnce(args);
      const { headers, body } = includeHeaders || safeEtag
        ? splitHttpResponse(stdout)
        : { headers: '', body: stdout };
      return {
        notModified: false,
        data: parseJson(body, path),
        etag: extractHeader(headers, 'etag'),
        headers,
      };
    } catch (e) {
      if (safeEtag && isHttp304Error(e)) {
        const { headers } = splitHttpResponse(String(e.stdout ?? ''));
        return {
          notModified: true,
          data: null,
          etag: extractHeader(headers, 'etag') || safeEtag,
          headers,
        };
      }
      lastErr = e;
      const errStr = String(e.stderr || '') + String(e.message || '');
      if (looksFatal(errStr)) {
        if (includeHeaders || safeEtag) reportRateLimit(e);
        process.stderr.write(`[gh] fatal on ${path}: ${errStr.slice(0, 500)}\n`);
        if (fatalExit) process.exit(1);
        throw e;
      }
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      }
    }
  }
  throw lastErr;
}

// `gh api graphql -f query=...` returning parsed JSON.
export async function ghGraphQL(query, variables = {}, { retries = 1, includeHeaders = false } = {}) {
  const args = ['api', 'graphql', ...(includeHeaders ? ['--include'] : []), '-f', `query=${query}`];
  for (const [k, v] of Object.entries(variables)) {
    // Strings go through -f (raw): -F would turn a repo named `2048`, `true` or `null` into a
    // number/boolean/null, or read a file for a value starting with `@`. Other types need -F's typing.
    if (typeof v === 'string') args.push('-f', `${k}=${v}`);
    else args.push('-F', `${k}=${JSON.stringify(v)}`);
  }
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const stdout = await runOnce(args);
      return parseJson(includeHeaders ? splitHttpResponse(stdout).body : stdout, 'graphql');
    } catch (e) {
      lastErr = e;
      const errStr = String(e.stderr || '') + String(e.message || '');
      if (looksFatal(errStr)) {
        if (includeHeaders) reportRateLimit(e);
        process.stderr.write(`[gh] fatal on graphql: ${errStr.slice(0, 500)}\n`);
        process.exit(1);
      }
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      }
    }
  }
  throw lastErr;
}

// Bounded concurrency runner: run async fns with at most `concurrency` in flight.
export async function pMap(items, fn, concurrency = 6) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { __error: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
