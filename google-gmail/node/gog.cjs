'use strict';

// This is a trusted Node worker, not an OS sandbox. Credentials are request-local.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { workerMessage, updateRichDraft, keyFor, isAttachmentPart, referencedContentIds, gmailJson, decodeMimeBody, draftBodyErrorMessage, loadMessageBodies, verifyDraftAttachmentBytes } = require('./mailMime.cjs');
const SERVICE = 'gmail';
const root = path.resolve(__dirname, '..');
const binaries = require('../vendor/gog/binaries.json');
const MAX_OUTPUT = 300 * 1024;
const children = new Set();
let runtime;
let schemaPromise;

function failure(message, execution = 'not_executed') { return { ok: false, execution, message }; }
function commandFailure(error, state, locale) {
  return failure(draftBodyErrorMessage(error, locale) || (error?.code === 'GOG_BINARY_MISSING' ? error.message
    : 'Unable to execute command; check its schema and workspace paths'), state?.started ? 'unknown' : 'not_executed');
}
// Only the write phase may consume a transport execution receipt. A failed
// pre-write GET, even with HTTP 200, does not mean the draft was saved.
function draftWriteFailure(error, state, locale) {
  const outcome = !state.started ? 'not_executed'
    : ['not_executed', 'executed', 'unknown'].includes(error?.execution) ? error.execution : 'unknown';
  const message = workerMessage(locale, {
    not_executed: 'draftNotSaved',
    executed: 'draftSavedReceiptUnverified',
    unknown: 'draftSaveUnknown',
  }[outcome]);
  const detail = draftBodyErrorMessage(error, locale);
  return failure(detail ? (outcome === 'not_executed' ? detail : message + ' ' + detail) : message, outcome);
}
function cleanup(directory, result) {
  try { fs.rmSync(directory, { recursive: true, force: true }); }
  catch (_) {
    const warning = 'Temporary mail files could not be removed; they remain in the private worker directory until cleanup succeeds. Do not repeat a write to clean up files.';
    // Housekeeping must never replace the known business-operation receipt.
    if (result.ok) {
      const data = result.data;
      result = { ...result, data: { ...(data && typeof data === 'object' && !Array.isArray(data) ? data : { output: data }), cleanupWarning: warning } };
    } else result = { ...result, message: result.message + ' ' + warning };
  }
  return result;
}
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function initialize() {
  if (runtime) return runtime;
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const key = platform + '-' + arch;
  const expected = binaries[key];
  if (!expected) throw new Error('Unsupported operating system or architecture');
  let bytes;
  try { bytes = fs.readFileSync(path.join(root, 'vendor/gog', key + (platform === 'windows' ? '.exe' : ''))); }
  catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('Gmail plugin package is missing its bundled gog executable. Install a complete plugin package; reloading cannot repair it.'), { code: 'GOG_BINARY_MISSING' });
    throw error;
  }
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
    } catch (_) { resolve(cleanup(home, failure('Unable to start gog'))); return; }
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
      const redact = (value) => token ? value.split(token).join('[REDACTED]') : value;
      if (reason || code !== 0) {
        resolve(cleanup(home, failure(redact(reason || stderr || 'gog failed'), started ? 'unknown' : 'not_executed'))); return;
      }
      let data;
      try { data = JSON.parse(redact(stdout)); }
      catch (_) { data = redact(stdout); }
      resolve(cleanup(home, { ok: true, execution: 'executed', data }));
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
  if (command.join(' ') === 'reply' || command.join(' ') === 'drafts reply') {
    result.help = 'Reply to all by default. Use reply-mode=sender only when the user explicitly requests sender-only.';
    result.flags.push({ name: 'reply-mode', type: 'string', help: 'all (default) or sender. Bcc is never copied.' });
  }
  if (command.join(' ') === 'drafts create') result.flags.push({ name: 'inline-images', type: 'strings', help: 'Granted chat image hashes in CID order: img1@cindy.local, img2@cindy.local. Save only; never sends. Supply body and body-html; to may be empty for preview.' });
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

function draftReadBack(data, draftId, locale) {
  const draft = data && data.draft;
  const message = draft && draft.message;
  if (!draft || draft.id !== draftId || !message || !message.id || !message.payload) throw new Error('Incomplete draft read-back');
  const header = (part, name) => (part.headers || []).filter(h => h.name.toLowerCase() === name).map(h => h.value).join('\n');
  const headers = {};
  for (const name of ['from', 'to', 'cc', 'bcc', 'subject', 'reply-to', 'message-id', 'in-reply-to', 'references']) headers[name] = header(message.payload, name);
  const bodies = { 'text/plain': [], 'text/html': [] };
  const attachments = [];
  function walk(part) {
    const body = part.body || {};
    const disposition = header(part, 'content-disposition');
    const contentId = header(part, 'content-id');
    if (isAttachmentPart(part)) {
      const bytes = typeof body.data === 'string' ? Buffer.from(body.data, 'base64url') : null;
      attachments.push({ key: keyFor(part), filename: part.filename || '', mimeType: part.mimeType, bytes: body.size,
        attachmentId: body.attachmentId || null, disposition, contentId,
        ...(bytes ? { sha256: digest(bytes) } : {}),
        // Small Gmail parts have no attachmentId. Carry bounded image bytes to
        // the same media preview path used for downloaded attachments.
        ...(bytes && /^image\/(png|jpeg|gif|webp)$/.test(part.mimeType) && bytes.length === body.size
          && bytes.length <= 16 * 1024 * 1024 && body.data.length <= 4 * Math.ceil(16 * 1024 * 1024 / 3)
          ? { inlineData: body.data } : {}) });
      return;
    } else if (bodies[part.mimeType]) {
      if ((body.attachmentId || body.size > 0) && (!body.data && body.size !== 0)) throw new Error(workerMessage(locale, 'draftBodyIncomplete'));
      if (typeof body.data === 'string') bodies[part.mimeType].push(decodeMimeBody(part, locale));
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(message.payload);
  const result = { status: 'read_back', draftId, messageId: message.id, threadId: message.threadId || null,
    headers, bodyText: bodies['text/plain'].join('\n'), bodyHtml: bodies['text/html'].join('\n'), attachments };
  // Gmail can rotate attachment download IDs on every read of an unchanged
  // message. Keep fetch IDs and inline preview bytes out of the revision.
  // messageId still changes when Gmail replaces the draft's underlying message.
  result.fingerprint = digest(Buffer.from(JSON.stringify({ ...result,
    attachments: attachments.map(({ attachmentId, inlineData, ...content }) => content) })));
  result.editor = draftEditor(result);
  return result;
}

async function readDraft(data, draftId, token, locale) {
  await loadMessageBodies(data?.draft?.message, token, locale);
  return draftReadBack(data, draftId, locale);
}

function draftEditor(draft) {
  // Only split the paired quote produced by the pinned gog runtime. Unknown
  // layouts stay intact; never guess away part of an HTML-only message.
  const htmlAt = draft.bodyHtml.indexOf('<br><br><div class="gmail_quote">');
  const textMatch = /\r?\n\r?\n(?:[^\r\n]+ wrote:|Original message:)\r?\n> /.exec(draft.bodyText);
  const split = htmlAt >= 0 && textMatch;
  const body = split ? draft.bodyText.slice(0, textMatch.index) : draft.bodyText;
  const html = split ? draft.bodyHtml.slice(0, htmlAt) : draft.bodyHtml;
  return { format: !html || html === mailBodyHtml(body) ? 'text' : 'html', body: split ? draft.bodyText.slice(0, textMatch.index) : draft.bodyText,
    quote: split ? draft.bodyText.slice(textMatch.index) : '',
    bodyHtml: split ? draft.bodyHtml.slice(0, htmlAt) : draft.bodyHtml,
    quoteHtml: split ? draft.bodyHtml.slice(htmlAt) : '',
    editable: Boolean(draft.bodyText || !draft.bodyHtml) };
}

async function composeDraft(message, execution) {
  const p = message.params || {};
  const text = key => workerMessage(p.locale, key);
  const fields = p.fields;
  const names = ['to', 'cc', 'bcc', 'subject', 'body', 'quote'];
  const rich = fields && typeof fields.bodyHtml === 'string';
  if (rich) names.push('bodyHtml', 'quoteHtml', 'attachmentItems');
  if (typeof p.draftId !== 'string' || !p.draftId || p.draftId.startsWith('-') || /[\r\n\0]/.test(p.draftId)
    || typeof p.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(p.fingerprint)
    || !fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length !== names.length
    || names.some(name => typeof fields[name] !== 'string' || fields[name].length > (name.endsWith('Html') ? 64000 : 16000) || fields[name].includes('\0'))
    || typeof p.send !== 'boolean') return failure(text('composeFieldsIncomplete'));
  const run = (command, options = {}, state = {}) => handle({ method: 'run', cindy: message.cindy,
    params: { command, arguments: [p.draftId], options, readOnly: false, accountEmail: p.accountEmail, locale: p.locale } }, state);
  const fetched = await run(['drafts', 'get']);
  if (!fetched.ok || !fetched.data.readBack) return failure(text('composeReadFailed'));
  const before = fetched.data.readBack;
  if (before.fingerprint !== p.fingerprint) return { ok: false, execution: 'not_executed', stale: before,
    message: text('draftChangedReview') };
  try {
    if (p.send && !fields.to.trim() && !fields.cc.trim() && !fields.bcc.trim()) throw new Error('recipient');
    for (const name of ['to', 'cc', 'bcc']) if (fields[name].trim()) addressHeader(fields[name]);
    encodeHeader(fields.subject);
  } catch (_) { return { ...failure(text('composeHeadersInvalid')), readBack: before }; }
  if (!rich && !before.editor.editable) return failure(text('composeHtmlDraft'));
  const original = { to: before.headers.to, cc: before.headers.cc, bcc: before.headers.bcc, subject: before.headers.subject,
    body: before.editor.body, quote: before.editor.quote,
    ...(rich ? { bodyHtml: before.editor.bodyHtml || mailBodyHtml(before.editor.body), quoteHtml: before.editor.quoteHtml,
      attachmentItems: JSON.stringify(before.attachments.map(a => ({ key: a.key, filename: a.filename, bytes: a.bytes, contentId: a.contentId || '' }))) } : {}) };
  let saved = before;
  let sameAttachments = true;
  if (rich) {
    try {
      const wanted = JSON.parse(fields.attachmentItems);
      if (!Array.isArray(wanted) || wanted.some(a => !a || typeof a.key !== 'string')) throw new Error('attachments');
      // MIME bytes are identified by server part keys. Preview URLs/types are
      // display metadata and must never cause a rewrite on every read/send.
      const facts = items => JSON.stringify(items.map(a => {
        const original = before.attachments.find(b => b.key === a.key);
        return [a.key, (a.contentId ?? original?.contentId ?? '').replace(/^<|>$/g, ''), a.filename ?? original?.filename ?? ''];
      }).sort());
      sameAttachments = facts(wanted) === facts(before.attachments);
    } catch (_) { return failure(text('attachmentListInvalid')); }
  }
  if (names.some(name => name === 'attachmentItems' ? !sameAttachments : original[name] !== fields[name]) || p.attachments?.length) {
    // The pinned CLI carries attachment bytes forward but does not retain CID
    // metadata on update. Never damage an inline image while editing a reply.
    if (!rich && before.attachments.some(item => item.contentId || /^inline\b/i.test(item.disposition)))
      return { ...failure(text('inlineImagesNotPreserved')), readBack: before };
    const bodyHtml = rich && (before.editor.format === 'html' || fields.bodyHtml !== original.bodyHtml || fields.body === original.body) ? fields.bodyHtml
      : fields.body === original.body ? before.editor.bodyHtml : mailBodyHtml(fields.body);
    // The quote is a separately editable plain field, even in an HTML draft.
    // Only an explicit HTML quote edit or unchanged plain quote keeps its HTML.
    const quoteHtml = rich && (fields.quoteHtml !== original.quoteHtml || fields.quote === original.quote) ? fields.quoteHtml
      : fields.quote === original.quote ? before.editor.quoteHtml : fields.quote
      ? '<br><br><div class="gmail_quote"><blockquote style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">' + mailBodyHtml(fields.quote) + '</blockquote></div>' : '';
    const from = /<([^<>]+)>$/.exec(before.headers.from);
    let richReceipt;
    if (rich) {
      try {
        richReceipt = await updateRichDraft({ ...p, fields: { ...fields, bodyHtml, quoteHtml } }, message.cindy?.secrets?.gog_access_token, before,
          { draftReadBack, addressHeader, encodeWords, encodeHeader, wrap }, execution);
        if (!richReceipt.ok) return richReceipt;
      } catch (error) { return draftWriteFailure(error, execution, p.locale); }
    }
    const savedButUnverified = () => failure(text('draftSavedReadBackUnverified'), 'executed');
    let updated;
    try { updated = rich ? await run(['drafts', 'get']) : await run(['drafts', 'update'], { to: fields.to, cc: fields.cc, bcc: fields.bcc, subject: fields.subject,
      ...(before.headers.from ? { from: from ? from[1] : before.headers.from } : {}),
      ...(before.headers['reply-to'] ? { 'reply-to': before.headers['reply-to'] } : {}),
      body: fields.body + fields.quote, 'body-html': bodyHtml + quoteHtml }, execution); }
    catch (_) {
      if (rich) return savedButUnverified(); // The preceding PUT has a successful receipt.
      return failure(text('draftSaveUnconfirmed'), execution.started ? 'unknown' : 'not_executed');
    }
    if (!updated.ok) return rich ? savedButUnverified() : updated;
    saved = updated.data?.readBack;
    if (!saved || saved.status !== 'read_back') return { ok: false, execution: 'executed',
      message: text('draftSavedNoReadBack') };
    // Verify the saved content before sending. Keep reply
    // headers and attachments via gog update's existing preservation behavior.
    try {
      const normalized = text => text.replace(/\r\n?/g, '\n');
      const addresses = text => text.trim() ? addressHeader(text).split(',\r\n ').map(value => {
        const match = /<([^<>]+)>$/.exec(value);
        return (match ? match[1] : value).toLowerCase();
      }).sort().join(',') : '';
      const attachmentFacts = items => JSON.stringify(items.map(a => [a.filename, a.mimeType, a.bytes, (a.contentId || '').replace(/^<|>$/g, '')]).sort());
      if (normalized(saved.bodyText) !== normalized(fields.body + fields.quote) || normalized(saved.bodyHtml) !== normalized(bodyHtml + quoteHtml)
        || ['to', 'cc', 'bcc'].some(name => addresses(saved.headers[name]) !== addresses(fields[name]))
        || saved.headers.subject !== fields.subject.trim() || addresses(saved.headers.from) !== addresses(before.headers.from)
        || addresses(saved.headers['reply-to']) !== addresses(before.headers['reply-to'])
        || saved.threadId !== before.threadId || saved.headers['in-reply-to'] !== before.headers['in-reply-to']
        || saved.headers.references !== before.headers.references || attachmentFacts(saved.attachments) !== attachmentFacts(richReceipt ? richReceipt.files : before.attachments))
        return { ok: false, execution: 'executed', message: text('draftSavedMismatch') };
      if (richReceipt && !await verifyDraftAttachmentBytes(message.cindy?.secrets?.gog_access_token, saved, richReceipt.files, p.locale)) return savedButUnverified();
    } catch (_) { return savedButUnverified(); }
  }
  if (!p.send) return { ok: true, execution: 'executed', data: { draftId: p.draftId, readBack: saved } };
  const sent = await run(['drafts', 'send'], {}, execution);
  if (!sent.ok) return sent;
  return { ...sent, data: { ...sent.data, sent: true, draftId: p.draftId, readBack: saved } };
}

// Plain text is not Markdown. A Gmail-style HTML alternative keeps paragraph
// breaks and the signature proportional, separate from the quoted history.
function mailBodyHtml(text) {
  const escaped = text.replace(/\r\n?/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:small">'
    + escaped.split('\n').map(line => '<div>' + (line || '<br>') + '</div>').join('') + '</div>';
}

async function readSavedDraft(result, command, token, cwd, locale) {
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
      if (fetched.ok) readBack = await readDraft(fetched.data, draftId, token, locale);
    }
  } catch (_) { /* The write already succeeded; retain its receipt. */ }
  return { ...result, data: { ...data, readBack } };
}

function encodeHeader(value) {
  const text = String(value || '');
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error('Mail headers cannot contain control characters');
  return text.trim();
}
// RFC 2047 words stay below 75 bytes and never split a UTF-8 character.
function encodeWords(value) {
  const text = encodeHeader(value);
  if (!/[^\x20-\x7e]/.test(text) && text.length <= 60) return text;
  const chunks = [];
  let chunk = '';
  for (const character of text) {
    if (Buffer.byteLength(chunk + character) > 42) { chunks.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(item => '=?UTF-8?B?' + Buffer.from(item).toString('base64') + '?=').join('\r\n ');
}
function addressHeader(value) {
  const text = encodeHeader(value);
  const addresses = [];
  let start = 0, quoted = false, escaped = false;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && ch === '\\') { escaped = true; continue; }
    if (ch === '"') quoted = !quoted;
    if ((ch === ',' && !quoted) || i === text.length) {
      const item = text.slice(start, i).trim();
      const match = /^(.*?)<([^<>]+)>$/.exec(item);
      const address = match ? match[2].trim() : item;
      // Display names can be international; mailbox syntax remains unambiguous.
      if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(address)) {
        throw new Error('Use comma-separated mailboxes, optionally Name <address>');
      }
      let name = match ? match[1].trim() : '';
      if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/\\(.)/g, '$1');
      const phrase = /[^\x20-\x7e]/.test(name) || name.length > 60 ? encodeWords(name) : '"' + name.replace(/["\\]/g, '\\$&') + '"';
      addresses.push(name ? phrase + ' <' + address + '>' : address);
      start = i + 1;
    }
  }
  if (quoted || escaped) throw new Error('Unclosed recipient display name');
  return addresses.join(',\r\n ');
}
function wrap(value) { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"); return bytes.toString("base64").replace(/(.{76})/g, "$1" + String.fromCharCode(13,10)); }
function buildInlineMessage(options, cwd, draft = false, locale) {
  const images = options['inline-images'];
  if (!Array.isArray(images) || !images.length) return null;
  const supported = new Set(['inline-images', 'from', 'to', 'cc', 'bcc', 'reply-to', 'subject', 'body', 'body-html', 'in-reply-to', 'references', 'thread-id', 'attach']);
  for (const key of Object.keys(options)) {
    if (!supported.has(key)) throw new Error('Unsupported inline-send option: ' + key);
  }
  const from = addressHeader(options.from);
  const to = draft && !options.to ? '' : addressHeader(options.to);
  const subject = encodeWords(options.subject);
  const html = String(options['body-html'] || '');
  const body = String(options.body || '');
  if (!from || (!draft && !to) || !subject || !html || !body) throw new Error('Inline mail requires from, subject, body and body-html; sending also requires to');
  const boundary = 'cindy-' + crypto.randomUUID();
  const lines = ['From: ' + from, 'To: ' + to];
  for (const [name, header] of [['cc', 'Cc'], ['bcc', 'Bcc'], ['reply-to', 'Reply-To']]) {
    if (options[name]) lines.push(header + ': ' + addressHeader(options[name]));
  }
  lines.push('Subject: ' + subject);
  if (options['in-reply-to']) lines.push('In-Reply-To: ' + encodeHeader(options['in-reply-to']));
  if (options.references) lines.push('References: ' + encodeHeader(options.references));
  const attachments = options.attach === undefined ? [] : Array.isArray(options.attach) ? options.attach : [options.attach];
  lines.push('MIME-Version: 1.0');
  if (attachments.length) lines.push('Content-Type: multipart/mixed; boundary="mixed-' + boundary + '"', '', '--mixed-' + boundary);
  lines.push('Content-Type: multipart/related; boundary="' + boundary + '"', '');
  lines.push('--' + boundary, 'Content-Type: multipart/alternative; boundary="alt-' + boundary + '"', '',
    '--alt-' + boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(body,'utf8')), '',
    '--alt-' + boundary, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(html,'utf8')), '',
    '--alt-' + boundary + '--');
  images.forEach((image, index) => {
    if (!image || typeof image.path !== 'string' || typeof image.hash !== 'string') throw new Error('Invalid inline image');
    const cid = 'img' + (index + 1) + '@cindy.local';
    if (!referencedContentIds(html, locale).has(cid)) throw new Error('body-html must reference cid:' + cid + ' in inline-images order');
    const file = localPath(image.path, cwd);
    const bytes = fs.readFileSync(file);
    if (digest(bytes) !== image.hash) throw new Error('Inline image changed before send');
    const type = typeof image.contentType === 'string' && /^image\/[a-z0-9.+-]+$/i.test(image.contentType) ? image.contentType : 'application/octet-stream';
    lines.push('', '--' + boundary, 'Content-Type: ' + type, 'Content-Transfer-Encoding: base64',
      'Content-ID: <' + cid + '>', 'Content-Disposition: inline; filename="image-' + (index + 1) + '"', '', wrap(bytes));
  });
  lines.push('', '--' + boundary + '--', '');
  for (const attachment of attachments) {
    const file = localPath(attachment, cwd);
    const filename = encodeURIComponent(path.basename(file)).replace(/['()*]/g, ch => '%' + ch.charCodeAt(0).toString(16));
    lines.push('--mixed-' + boundary, 'Content-Type: application/octet-stream', 'Content-Transfer-Encoding: base64',
      "Content-Disposition: attachment; filename*=UTF-8''" + filename, '', wrap(fs.readFileSync(file)), '');
  }
  if (attachments.length) lines.push('--mixed-' + boundary + '--', '');
  return lines.join(String.fromCharCode(13,10));
}

async function handle(message, execution) {
  if (message.method === 'compose') return composeDraft(message, execution);
  const params = message.params || {};
  const text = key => workerMessage(params.locale, key);
  const tree = await schema();
  let command = params.command || [];
  let node = locate(tree, command);
  if (message.method === 'schema') return { ok: true, data: node };
  if (message.method !== 'run') return failure('Unknown method');
  if (!command.length || node.subcommands.length) return failure('Select a concrete command');
  const token = message.cindy && message.cindy.secrets && message.cindy.secrets.gog_access_token;
  if (typeof token !== 'string' || !token) return failure('No Host-issued account token');
  const values = params.arguments || [];
  if (!Array.isArray(values) || values.length > 100 || values.some((value) => typeof value !== 'string' || value.startsWith('-') || value.includes('\0'))) return failure('Invalid positional arguments');
  let options = params.options || {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) return failure('Invalid options');
  options = { ...options };
  if (command.join(' ') === 'reply' || command.join(' ') === 'drafts reply') {
    const mode = options['reply-mode'] === undefined ? 'all' : options['reply-mode'];
    if (!['all', 'sender'].includes(mode)) return failure('reply-mode must be all or sender');
    delete options['reply-mode'];
    if (mode === 'all') { command = [...command.slice(0, -1), 'reply-all']; node = locate(tree, command); }
  }
  const cwd = typeof params.workdir === 'string' && path.isAbsolute(params.workdir) ? params.workdir : undefined;
  if (command.join(' ') === 'drafts update' && params.readOnly === false && values[0]) {
    const current = await execute([SERVICE, 'drafts', 'get', values[0], '--readonly'], token, undefined, MAX_OUTPUT, undefined, 10000);
    if (!current.ok) return failure(text('draftAttachmentsUnverified'));
    const checked = await readDraft(current.data, values[0], token, params.locale);
    if (checked.attachments.some(a => a.contentId || /^inline\b/i.test(a.disposition))) {
      // AI uses the same verified MIME writer as the card. The old CLI updater
      // loses Content-ID; never send this draft through it.
      const allowed = new Set(['to', 'cc', 'bcc', 'subject', 'body', 'body-file', 'body-html', 'body-html-file', 'attach', 'clear-attachments']);
      if (values.length !== 1 || Object.keys(options).some(key => !allowed.has(key))) return failure(text('htmlDraftFieldsOnly'));
      const textOption = (key, fallback) => {
        if (options[key] !== undefined && options[key + '-file'] !== undefined) throw new Error('Duplicate body input');
        const value = options[key + '-file'] !== undefined ? fs.readFileSync(localPath(options[key + '-file'], cwd), 'utf8') : options[key] ?? fallback;
        if (typeof value !== 'string') throw new Error('Invalid draft field');
        return value;
      };
      const bodyChanged = options.body !== undefined || options['body-file'] !== undefined;
      const htmlChanged = options['body-html'] !== undefined || options['body-html-file'] !== undefined;
      if (bodyChanged !== htmlChanged) return failure(text('richDraftBodyPair'));
      const fields = Object.fromEntries(['to', 'cc', 'bcc', 'subject'].map(name => [name, textOption(name, checked.headers[name])]));
      const html = textOption('body-html', checked.editor.bodyHtml) + checked.editor.quoteHtml;
      const referenced = referencedContentIds(html, params.locale);
      // attach replaces ordinary files. Only inline parts still referenced by
      // the replacement body survive implicitly; omission preserves all files.
      const retained = options['clear-attachments'] === true ? [] : options.attach === undefined ? checked.attachments
        : checked.attachments.filter(a => {
          const cid = (a.contentId || '').replace(/^<|>$/g, '');
          return cid && referenced.has(cid);
        });
      Object.assign(fields, { body: textOption('body', checked.editor.body), bodyHtml: textOption('body-html', checked.editor.bodyHtml),
        quote: checked.editor.quote, quoteHtml: checked.editor.quoteHtml,
        attachmentItems: JSON.stringify(retained.map(a => ({ key: a.key, filename: a.filename, bytes: a.bytes, contentId: a.contentId || '' }))) });
      const inputs = options.attach === undefined ? [] : Array.isArray(options.attach) ? options.attach : [options.attach];
      if (inputs.length > 20) return failure(text('tooManyAttachments'));
      const attachments = inputs.map(input => {
        const filePath = localPath(input, cwd);
        const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const stat = fs.fstatSync(fd);
          if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid attachment');
          const bytes = fs.readFileSync(fd);
          return { path: filePath, filename: path.basename(filePath), bytes: bytes.length, sha256: digest(bytes) };
        } finally { fs.closeSync(fd); }
      });
      return composeDraft({ method: 'compose', cindy: message.cindy, params: { draftId: values[0], fingerprint: checked.fingerprint,
        accountEmail: params.accountEmail, locale: params.locale, fields, attachments, send: false } }, execution);
    }
  }
  const compose = ['send', 'reply', 'reply-all', 'drafts create', 'drafts update', 'drafts reply', 'drafts reply-all'].includes(command.join(' '));
  if (compose && options['body-html'] === undefined && options['body-html-file'] === undefined && options['raw-file'] === undefined) {
    const body = typeof options.body === 'string' ? options.body : typeof options['body-file'] === 'string'
      ? fs.readFileSync(localPath(options['body-file'], cwd), 'utf8') : undefined;
    if (body !== undefined && node.flags.some(flag => flag.name === 'body-html')) options['body-html'] = mailBodyHtml(body);
  }
  let inlineMessage;
  if (options['inline-images']) {
    if (command.join(' ') !== 'drafts create' || params.readOnly !== false) return failure('Inline images require a writable draft create; sending must use the common draft workflow');
    for (const name of ['body', 'body-html']) if (options[name + '-file'] !== undefined) {
      if (options[name] !== undefined) return failure('Duplicate body input');
      options[name] = fs.readFileSync(localPath(options[name + '-file'], cwd), 'utf8');
      delete options[name + '-file'];
    }
    inlineMessage = buildInlineMessage({ from: params.accountEmail, ...options }, cwd, true, params.locale);
    // The pinned CLI has no drafts create --raw-file. Use the same fixed Gmail
    // API transport as rich draft updates, then read the exact saved draft back.
    if (Buffer.byteLength(inlineMessage) > 35 * 1024 * 1024) return failure(text('messageTooLarge'));
    const requestBody = JSON.stringify({ message: {
      raw: Buffer.from(inlineMessage).toString('base64url'),
      ...(options['thread-id'] ? { threadId: encodeHeader(options['thread-id']) } : {}),
    } });
    try {
      execution.started = true;
      const created = await gmailJson(token, 'drafts', { method: 'POST', body: requestBody }, MAX_OUTPUT, params.locale);
      if (typeof created?.id !== 'string' || !created.id) throw Object.assign(new Error('Missing draft receipt'), { execution: 'executed' });
      return readSavedDraft({ ok: true, execution: 'executed', data: { draftId: created.id } }, command, token, cwd, params.locale);
    } catch (error) { return draftWriteFailure(error, execution, params.locale); }
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
  // gog requires the selected mailbox identity for raw mail with direct tokens.
  // This comes from the same Host OAuth account used by authAccount, not From
  // or caller options (which cannot override account/global flags).
  if (inlineMessage !== undefined || options['raw-file'] !== undefined || ['reply', 'reply-all'].includes(command.at(-1))) {
    if (typeof params.accountEmail !== 'string' || !/^[^\s<>@]+@[^\s<>@]+$/.test(params.accountEmail)) {
      return failure('Selected account email unavailable; reconnect this Gmail account');
    }
    argv.push('--account=' + params.accountEmail);
  }
  let temporaryDirectory;
  let result;
  try {
    if (inlineMessage !== undefined) {
      // The existing runtime directory also has a process-exit cleanup handler.
      temporaryDirectory = fs.mkdtempSync(path.join(initialize().directory, 'inline-'));
      const rawPath = path.join(temporaryDirectory, 'message.eml');
      fs.writeFileSync(rawPath, inlineMessage, { mode: 0o600, flag: 'wx' });
      argv.push('--raw-file=' + rawPath);
    }
    result = await execute(argv, token, cwd, MAX_OUTPUT, execution);
  } catch (error) {
    result = commandFailure(error, execution, params.locale);
  } finally {
    if (temporaryDirectory) result = cleanup(temporaryDirectory, result);
  }
  if (result.ok && command.join(' ') === 'drafts get') {
    return { ...result, data: { ...result.data, readBack: await readDraft(result.data, values[0], token, params.locale) } };
  }
  return readSavedDraft(result, command, token, cwd, params.locale);
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch (_) { return; }
  if (message.id === undefined) return;
  const execution = { started: false };
  void handle(message, execution).catch((error) => commandFailure(error, execution, message.params?.locale)).then((result) => {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  });
});
function stop() { for (const child of children) child.kill('SIGKILL'); }
input.on('close', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
process.on('exit', () => { stop(); if (runtime) fs.rmSync(runtime.directory, { recursive: true, force: true }); });
