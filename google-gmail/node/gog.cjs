'use strict';

// This is a trusted Node worker, not an OS sandbox. Credentials are request-local.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const SERVICE = 'gmail';
const root = path.resolve(__dirname, '..');
const binaries = require('../vendor/gog/binaries.json');
const MAX_OUTPUT = 300 * 1024;
const children = new Set();
let runtime;
let schemaPromise;

function failure(message, execution = 'not_executed') { return { ok: false, execution, message }; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function initialize() {
  if (runtime) return runtime;
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const key = platform + '-' + arch;
  const expected = binaries[key];
  if (!expected) throw new Error('Unsupported operating system or architecture');
  const compressed = fs.readFileSync(path.join(root, 'vendor/gog', key + '.br'));
  if (digest(compressed) !== expected.compressedSha256) throw new Error('Bundled gog checksum mismatch');
  const bytes = zlib.brotliDecompressSync(compressed, { maxOutputLength: 128 * 1024 * 1024 });
  if (digest(bytes) !== expected.sha256) throw new Error('Bundled gog executable checksum mismatch');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-gog-'));
  fs.chmodSync(directory, 0o700);
  const binary = path.join(directory, process.platform === 'win32' ? 'gog.exe' : 'gog');
  fs.writeFileSync(binary, bytes, { mode: 0o700, flag: 'wx' });
  runtime = { directory, binary };
  return runtime;
}

function environment(home, token) {
  // Allow only OS necessities. In particular no inherited gog/Google credentials,
  // hook settings, LD_PRELOAD, DYLD_*, or user gog configuration.
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, { HOME: home, USERPROFILE: home, TMPDIR: home, TEMP: home, TMP: home, GOG_HOME: home, GOG_ACCESS_TOKEN: token || '' });
  return env;
}

async function execute(argv, token, cwd, maxOutput = MAX_OUTPUT, execution, timeoutMs = 100000) {
  const state = initialize();
  const home = fs.mkdtempSync(path.join(state.directory, 'call-'));
  return new Promise((resolve) => {
    let child;
    let started = false;
    let reason;
    let stdout = '';
    let stderr = '';
    let size = 0;
    try {
      child = spawn(state.binary, ['--home', home, '--json', '--no-input', ...argv], {
        cwd: cwd || home, env: environment(home, token), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
    } catch (_) { fs.rmSync(home, { recursive: true, force: true }); resolve(failure('Unable to start gog')); return; }
    children.add(child);
    child.once('spawn', () => { started = true; if (execution) execution.started = true; });
    const timer = setTimeout(() => { reason = 'gog timed out; do not retry a write without checking its result'; child.kill('SIGKILL'); }, timeoutMs);
    function read(chunk, error) {
      size += Buffer.byteLength(chunk);
      if (size > maxOutput) { reason = 'Result too large; narrow the query. A write may already have completed.'; child.kill('SIGKILL'); return; }
      if (error) stderr += chunk; else stdout += chunk;
    }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => read(chunk, false));
    child.stderr.on('data', (chunk) => read(chunk, true));
    child.once('error', () => { reason = 'Unable to run gog'; });
    child.once('close', (code) => {
      clearTimeout(timer); children.delete(child);
      fs.rmSync(home, { recursive: true, force: true });
      const redact = (value) => token ? value.split(token).join('[REDACTED]') : value;
      if (reason || code !== 0) {
        resolve(failure(redact(reason || stderr || 'gog failed'), started ? 'unknown' : 'not_executed')); return;
      }
      try { resolve({ ok: true, execution: 'executed', data: JSON.parse(redact(stdout)) }); }
      catch (_) { resolve({ ok: true, execution: 'executed', data: redact(stdout) }); }
    });
  });
}

// These commands configure persistent services, execute external hooks, or use
// additional providers. They are not Google business operations of this plugin.
function allowed(command) {
  const name = command.join(' ');
  return !/^(?:settings watch|track|changes (?:poll|serve|watch)|sync|alias|propose-time)(?: |$)/.test(name);
}
const blockedOptions = new Set(['track', 'track-split', 'with-zoom', 'regenerate-zoom', 'location-search', 'place-id', 'include-passwords']);
function cleanSchema(node, globals, command = []) {
  const result = { name: node.name, help: node.help, positionals: node.positionals || [], flags: (node.flags || []).filter((flag) => !globals.has(flag.name) && !blockedOptions.has(flag.name)) };
  result.subcommands = (node.subcommands || []).filter((child) => allowed([...command, child.name])).map((child) => cleanSchema(child, globals, [...command, child.name]));
  return result;
}
async function schema() {
  if (!schemaPromise) schemaPromise = (async () => {
    const response = await execute(['schema', SERVICE], '', undefined, 4 * 1024 * 1024);
    if (!response.ok || !response.data.command) throw new Error('Unable to inspect bundled gog schema');
    return cleanSchema(response.data.command, new Set(response.data.command.flags.map((f) => f.name)));
  })().catch((error) => { schemaPromise = undefined; throw error; });
  return schemaPromise;
}
function locate(tree, command) {
  if (!Array.isArray(command) || command.length > 8 || command.some((part) => typeof part !== 'string')) throw new Error('command must be a canonical command path');
  let node = tree;
  for (const part of command) {
    node = node.subcommands.find((item) => item.name === part);
    if (!node) throw new Error('Command unavailable; inspect gog_schema first');
  }
  return node;
}
function localPath(value, directory) {
  if (!directory || typeof value !== 'string' || value === '-') throw new Error('Local files require an explicit local workspace path');
  const base = fs.realpathSync(directory);
  const target = path.resolve(base, value);
  const relative = path.relative(base, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('File must be inside the current workspace');
  // Resolve symlinks for both inputs and output parents; do not follow an
  // existing output symlink to an unrelated directory.
  const resolved = fs.existsSync(target) ? fs.realpathSync(target) : path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
  const resolvedRelative = path.relative(base, resolved);
  if (resolvedRelative === '..' || resolvedRelative.startsWith('..' + path.sep) || path.isAbsolute(resolvedRelative)) throw new Error('File escapes the current workspace');
  return target;
}
function optionValue(key, item, directory) {
  const fileFlag = key === 'attach' || key === 'out' || key === 'out-dir' || key.endsWith('-file');
  if (fileFlag) return localPath(item, directory);
  // gog's JSON input resolver trims whitespace and expands @file references.
  // Validate the referenced path before forwarding it, just like --body-file.
  if (key.endsWith('-json') && typeof item === 'string' && item.trim().startsWith('@')) {
    return '@' + localPath(item.trim().slice(1).trim(), directory);
  }
  return item;
}

function draftReadBack(data, draftId) {
  const draft = data && data.draft;
  const message = draft && draft.message;
  if (!draft || draft.id !== draftId || !message || !message.id || !message.payload) throw new Error('Incomplete draft read-back');
  const header = (part, name) => (part.headers || []).filter(h => h.name.toLowerCase() === name).map(h => h.value).join('\n');
  const headers = {};
  for (const name of ['from', 'to', 'cc', 'bcc', 'subject', 'message-id', 'in-reply-to', 'references']) headers[name] = header(message.payload, name);
  const bodies = { 'text/plain': [], 'text/html': [] };
  const attachments = [];
  function walk(part) {
    const body = part.body || {};
    const disposition = header(part, 'content-disposition');
    const contentId = header(part, 'content-id');
    if (part.filename || /^(attachment|inline)\b/i.test(disposition) || contentId) {
      attachments.push({ filename: part.filename || '', mimeType: part.mimeType, bytes: body.size,
        attachmentId: body.attachmentId || null, disposition, contentId });
    } else if (bodies[part.mimeType] && typeof body.data === 'string') {
      bodies[part.mimeType].push(Buffer.from(body.data, 'base64url').toString('utf8'));
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(message.payload);
  return { status: 'read_back', draftId, messageId: message.id, threadId: message.threadId || null,
    headers, bodyText: bodies['text/plain'].join('\n'), bodyHtml: bodies['text/html'].join('\n'), attachments };
}

async function readSavedDraft(result, command, token, cwd) {
  if (!result.ok || command.length !== 2 || command[0] !== 'drafts' ||
      !['create', 'update', 'reply', 'reply-all', 'forward'].includes(command[1])) return result;
  const data = result.data;
  const draftId = data && data.draftId;
  // Preserve the successful write receipt even when its subsequent read fails.
  // Never rerun a mutation to recover a missing/oversized read-back.
  let readBack = { status: 'unavailable', message: 'Draft saved, but read-back unavailable. Read drafts get before reporting it verified; do not recreate it.' };
  try {
    if (typeof draftId === 'string' && draftId && !draftId.startsWith('-') && !draftId.includes('\0')) {
      const fetched = await execute([SERVICE, 'drafts', 'get', draftId, '--readonly'], token, cwd, MAX_OUTPUT, undefined, 10000);
      if (fetched.ok) readBack = draftReadBack(fetched.data, draftId);
    }
  } catch (_) { /* The write already succeeded; retain its receipt. */ }
  return { ...result, data: { ...data, readBack } };
}

function encodeHeader(value) {
  const text = String(value || '').split(String.fromCharCode(13)).join(' ').split(String.fromCharCode(10)).join(' ').trim();
  if ([...text].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126)) throw new Error('Inline mail headers must already be ASCII-safe');
  return text;
}
function wrap(value) { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"); return bytes.toString("base64").replace(/(.{76})/g, "$1" + String.fromCharCode(13,10)); }
function buildInlineMessage(options, cwd) {
  const images = options['inline-images'];
  if (!Array.isArray(images) || !images.length) return null;
  const from = encodeHeader(options.from);
  const to = encodeHeader(options.to);
  const subject = encodeHeader(options.subject);
  const html = String(options['body-html'] || '');
  const body = String(options.body || '');
  if (!from || !to || !subject || !html || !body) throw new Error('Inline send requires from, to, subject, body and body-html');
  const boundary = 'cindy-' + crypto.randomUUID();
  const lines = ['From: ' + from, 'To: ' + to];
  for (const [name, header] of [['cc', 'Cc'], ['bcc', 'Bcc'], ['reply-to', 'Reply-To']]) {
    if (options[name]) lines.push(header + ': ' + encodeHeader(options[name]));
  }
  lines.push('Subject: ' + subject);
  if (options['in-reply-to']) lines.push('In-Reply-To: ' + encodeHeader(options['in-reply-to']));
  if (options.references) lines.push('References: ' + encodeHeader(options.references));
  lines.push('MIME-Version: 1.0', 'Content-Type: multipart/related; boundary="' + boundary + '"', '');
  lines.push('--' + boundary, 'Content-Type: multipart/alternative; boundary="alt-' + boundary + '"', '',
    '--alt-' + boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(body,'utf8')), '',
    '--alt-' + boundary, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(html,'utf8')), '',
    '--alt-' + boundary + '--');
  images.forEach((image, index) => {
    if (!image || typeof image.path !== 'string' || typeof image.hash !== 'string') throw new Error('Invalid inline image');
    const cid = 'img' + (index + 1) + '@cindy.local';
    if (!html.includes('cid:' + cid)) throw new Error('body-html must reference cid:' + cid + ' in inline-images order');
    const file = localPath(image.path, cwd);
    const bytes = fs.readFileSync(file);
    if (digest(bytes) !== image.hash) throw new Error('Inline image changed before send');
    const type = typeof image.contentType === 'string' && image.contentType.startsWith('image/') ? image.contentType : 'application/octet-stream';
    lines.push('', '--' + boundary, 'Content-Type: ' + type, 'Content-Transfer-Encoding: base64',
      'Content-ID: <' + cid + '>', 'Content-Disposition: inline; filename="' + path.basename(file) + '"', '', wrap(bytes));
  });
  lines.push('', '--' + boundary + '--', '');
  const target = path.join(path.dirname(localPath(images[0].path, cwd)), 'inline-message.eml');
  fs.writeFileSync(target, lines.join(String.fromCharCode(13,10)), { flag: 'wx' });
  return { 'raw-file': path.relative(cwd, target), 'thread-id': options['thread-id'] };
}

async function handle(message, execution) {
  const params = message.params || {};
  const tree = await schema();
  const command = params.command || [];
  const node = locate(tree, command);
  if (message.method === 'schema') return { ok: true, data: node };
  if (message.method !== 'run') return failure('Unknown method');
  if (!command.length || node.subcommands.length) return failure('Select a concrete command');
  const token = message.cindy && message.cindy.secrets && message.cindy.secrets.gog_access_token;
  if (typeof token !== 'string' || !token) return failure('No Host-issued account token');
  const values = params.arguments || [];
  if (!Array.isArray(values) || values.length > 100 || values.some((value) => typeof value !== 'string' || value.startsWith('-') || value.includes('\0'))) return failure('Invalid positional arguments');
  let options = params.options || {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) return failure('Invalid options');
  const cwd = typeof params.workdir === 'string' && path.isAbsolute(params.workdir) ? params.workdir : undefined;
  if (options['inline-images']) {
    if (command.join(' ') !== 'send' || params.readOnly !== false) return failure('Inline images require an explicitly writable send');
    const raw = buildInlineMessage(options, cwd);
    options = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
  }
  const positionals = [...values];
  if ((SERVICE === 'drive' && command[0] === 'upload') || (SERVICE === 'gmail' && command[0] === 'import')) positionals[0] = localPath(positionals[0], cwd);
  const needsOutput = (SERVICE === 'drive' && command[0] === 'download') || (SERVICE === 'sheets' && command[0] === 'export') || (SERVICE === 'gmail' && command[0] === 'attachment' && options.inline !== true);
  if (params.readOnly !== false && (needsOutput || options.out !== undefined || options['out-dir'] !== undefined || options.download === true)) return failure('File writes are disabled in a readonly session');
  if (needsOutput && typeof options.out !== 'string') return failure('An explicit workspace output file is required');
  if (options.download === true && !options['out-dir']) return failure('An explicit workspace out-dir is required');
  const argv = [SERVICE, ...command, ...positionals];
  for (const [key, value] of Object.entries(options)) {
    const flag = node.flags.find((item) => item.name === key);
    if (!flag) return failure('Unsupported option: ' + key);
    if (flag.type === 'bool' && typeof value !== 'boolean') return failure('Boolean option must be true or false: ' + key);
    const items = Array.isArray(value) ? value : [value];
    if (items.length > 100) return failure('Too many flag values');
    for (const item of items) {
      if (!['string', 'number', 'boolean'].includes(typeof item) || String(item).includes('\0')) return failure('Invalid option value');
      const resolved = optionValue(key, item, cwd);
      argv.push('--' + key + '=' + String(resolved));
    }
  }
  // Native --force only after the Agent's invocation is approved by Cindy.
  argv.push('--force');
  if (params.readOnly !== false) argv.push('--readonly');
  const result = await execute(argv, token, cwd, MAX_OUTPUT, execution);
  return readSavedDraft(result, command, token, cwd);
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch (_) { return; }
  if (message.id === undefined) return;
  const execution = { started: false };
  void handle(message, execution).catch(() => failure('Unable to execute command; check its schema and workspace paths', execution.started ? 'unknown' : 'not_executed')).then((result) => {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  });
});
function stop() { for (const child of children) child.kill('SIGKILL'); }
input.on('close', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
process.on('exit', () => { stop(); if (runtime) fs.rmSync(runtime.directory, { recursive: true, force: true }); });
