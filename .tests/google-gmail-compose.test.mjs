import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const main = read('google-gmail/main.js');
const worker = read('google-gmail/node/gog.cjs').split('const input = readline.createInterface')[0];
const copy = value => JSON.parse(JSON.stringify(value));
const image = Buffer.from('synthetic attachment bytes');
const hash = createHash('sha256').update(image).digest('hex');
const url = `cindy-media://blobs/${hash}.jpg`;
const body = 'Thank you.\n\nOn Monday, sender@example.test wrote:\n> Original context';
const payload = {
  mimeType: 'multipart/mixed',
  headers: [['To', 'recipient@example.test'], ['Subject', 'Re: Example'], ['In-Reply-To', '<original@example.test>'],
    ['References', '<earlier@example.test> <original@example.test>']].map(([name, value]) => ({ name, value })),
  parts: [{ mimeType: 'multipart/alternative', parts: [
    { mimeType: 'text/plain', body: { data: Buffer.from(body).toString('base64url') } },
    { mimeType: 'text/html', body: { data: Buffer.from('<p>Thank you.</p><blockquote>Original context</blockquote>').toString('base64url') } },
  ] }, { filename: 'attachment-1.jpg', mimeType: 'image/jpeg', body: { attachmentId: 'image-part', size: image.length } }],
};

test('rich card edits and host-picked attachments reach the same adapter before its send', async t => {
  let stored;
  const f = fixture(t, { rich: true, node: async request => {
    if (request.method !== 'compose') return { ok: true, result: await f.ctx.handle({ ...request, cindy: { secrets: { gog_access_token: 'fixture-token' } } }, {}) };
    const p = request.params;
    stored = { ...stored, fingerprint: 'b'.repeat(64), headers: { ...stored.headers, to: p.fields.to },
      editor: { ...stored.editor, body: p.fields.body, bodyHtml: p.fields.bodyHtml, quoteHtml: p.fields.quoteHtml } };
    if (p.attachments?.length) stored.attachments.push({ key: 'new-file', filename: p.attachments[0].filename, bytes: p.attachments[0].bytes });
    return { ok: true, result: { ok: true, execution: 'executed', data: { draftId: stored.draftId, readBack: copy(stored), ...(p.send ? { sent: true, messageId: 'sent-rich' } : {}) } } };
  } });
  const first = await f.run(); stored = first.result.readBack;
  const card = f.replies.find(r => r.type === 'mail-draft-update' && r.draft).draft;
  assert.equal(card.fields.find(f => f.name === 'body').kind, 'hidden');
  assert.equal(card.fields.find(f => f.name === 'bodyHtml').kind, 'mail-html');
  const values = { ...Object.fromEntries(card.fields.map(f => [f.name, f.value])), bodyHtml: '<p><b>Latest</b></p>', body: 'Latest' };
  await f.action({ actionId: 'mail:attach:' + card.key, formValues: values, mailAttachment: { path: '/selected/file.pdf', filename: 'file.pdf', bytes: 10, sha256: 'a'.repeat(64) } });
  const sent = await f.run({ command: ['drafts', 'send'], arguments: [stored.draftId], options: {} });
  assert.equal(sent.ok, true);
  const writes = f.requests.filter(r => r.method === 'compose');
  assert.equal(writes[0].params.fields.bodyHtml, '<p><b>Latest</b></p>');
  assert.equal(writes[0].params.attachments[0].filename, 'file.pdf');
  assert.equal(writes[0].params.send, false);
  assert.equal(writes.at(-1).params.send, true);
  assert.deepEqual(writes.at(-1).params.attachments, []);
  assert.ok(JSON.parse(writes.at(-1).params.fields.attachmentItems).some(a => a.key === 'new-file'));
  assert.ok(f.replies.some(r => r.statusOnly?.pendingSend));
  // Tool runs and card writes both hand the Host locale to the worker.
  assert.ok(writes.length >= 2);
  assert.deepEqual([...new Set(f.requests.map(r => r.params.locale))], ['zh-CN']);
});

function fixture(t, overrides = {}) {
  const workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-compose-test-')));
  t.after(() => fs.rmSync(workdir, { recursive: true, force: true }));
  const calls = [], writes = [], requests = [], fetches = [], replies = [], rawMessages = [], httpCalls = [];
  const ctx = createContext({ __dirname: '/fixture', Buffer,
    require: name => name === './mailMime.cjs' ? { ...require('../google-gmail/node/mailMime.cjs'), gmailJson: async (token, resource, init) => {
      assert.equal(token, 'fixture-token');
      httpCalls.push({ resource, init });
      rawMessages.push(Buffer.from(JSON.parse(init.body).message.raw, 'base64url'));
      if (overrides.create) return overrides.create();
      return { id: 'draft-test' };
    } } : name === '../vendor/gog/binaries.json' ? {} : name === 'node:fs' && overrides.workerFs ? overrides.workerFs : require(name) });
  runInContext(worker, ctx);
  ctx.initialize = () => ({ directory: workdir });
  const leaf = (name, flags = []) => ({ name, flags: flags.map(name => ({ name, type: name === 'quote' ? 'bool' : 'string' })), subcommands: [] });
  const composeFlags = ['attach', 'from', 'to', 'cc', 'bcc', 'subject', 'reply-to', 'body', 'body-html', 'body-file', 'reply-to-message-id', 'quote', 'raw-file', 'thread-id'];
  ctx.schema = async () => ({ name: 'gmail', flags: [], subcommands: [leaf('send', composeFlags), leaf('search', ['page', 'max', 'all']),
    { name: 'drafts', flags: [], subcommands: ['create', 'update', 'reply', 'reply-all', 'forward', 'get', 'send', 'delete'].map(name => leaf(name, composeFlags)) }] });
  ctx.execute = async (...args) => {
    calls.push(args);
    const rawFile = args[0].find(arg => arg.startsWith('--raw-file='));
    if (rawFile) rawMessages.push(fs.readFileSync(rawFile.slice('--raw-file='.length)));
    if (overrides.execute) return overrides.execute(...args);
    const argv = args[0];
    if (argv[1] === 'drafts' && argv[2] === 'get') return { ok: true, data: { draft: { id: 'draft-test', message: { id: 'message-test', threadId: 'thread-original', payload: copy(payload) } } } };
    return { ok: true, execution: 'executed', data: { draftId: 'draft-test' } };
  };
  const handlers = [];
  const handler = async message => { for (const handle of handlers) await handle(message); };
  let kv = {};
  const locks = new Map(), continuations = [], timers = new Map();
  let timerId = 0;
  const sandbox = createContext({ crypto: webcrypto, Uint8Array, atob, btoa, Set, TextEncoder,
    setTimeout: (fn, delay) => { const id = ++timerId; if (delay === 10000) queueMicrotask(fn); else timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    navigator: { locks: { request(name, callback) {
      const pending = (locks.get(name) || Promise.resolve()).then(callback);
      locks.set(name, pending.catch(() => {}));
      return pending;
    } } },
    fetch: async (resource, options = {}) => {
      fetches.push(resource);
      if (resource === '/oauth') return { ok: true, json: async () => [{ key: 'gmail_account', clientConfigured: true,
        accounts: [{ id: 'account-test', label: 'self@example.test', status: 'connected' }] }] };
      if (resource === '/kv') {
        if (options.method === 'PUT') kv = JSON.parse(options.body);
        return { ok: true, json: async () => copy(kv) };
      }
      if (resource === '/app-context') return { ok: true, json: async () => ({ context: { locale: 'zh-CN' } }) };
      if (overrides.media) return overrides.media(resource);
      return new Response(resource === `/media/${hash}.jpg` ? image : null, { status: resource === `/media/${hash}.jpg` ? 200 : 404 });
    },
    // The Chinese assertions describe the zh-CN copy; pin the Host locale.
    cindy: { onHostMessage: fn => { handlers.push(fn); }, fetch: overrides.previewFetch,
      request: async request => (request.kind === 'app-context' ? { ok: true, context: { locale: overrides.locale || 'zh-CN' } } : { ok: false }),
      send: async result => { replies.push(copy(result)); return result.kind === 'deposit_media' ? { ok: true, url } : { ok: true }; },
      agent: { run: async request => { continuations.push(copy(request)); return overrides.continueResult || { ok: true }; } },
      fs: async request => {
        writes.push(request);
        if (overrides.fs) return overrides.fs(request);
        const target = path.join(workdir, request.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(request.content, 'base64'));
        return { ok: true, bytes: image.length, path: request.path };
      },
      node: { request: async request => {
        requests.push(copy(request));
        if (overrides.node) return overrides.node(request);
        return { ok: true, result: await ctx.handle({ ...request, cindy: { secrets: { gog_access_token: 'fixture-token' } } }, {}) };
      } },
    },
  });
  if (overrides.mailSdkVersion !== 0) runInContext(read('.tests/contracts/cindy-mail-runtime.js'), sandbox);
  // Existing transport fixtures exercise the v1 plain-text adapter. Rich MIME
  // updates have separate byte-preservation tests against the actual builder.
  if (overrides.mailSdkVersion !== 0 && !overrides.rich) runInContext('const originalRegister = cindyMail.register; cindyMail.register = adapter => originalRegister({...adapter, richText:false});', sandbox);
  if (overrides.mailSdkVersion) sandbox.cindyMail.version = overrides.mailSdkVersion;
  runInContext(main, sandbox);
  async function run(args = {}) {
    await handler({ type: 'tool-call', tool: 'gmail_run', callId: 'call-test', args: {
      session_context: { workdir, workdir_is_local: true, workdir_is_read_only: false },
      account_email: 'self@example.test', command: ['drafts', 'reply'], arguments: ['original-message'], options: { body: 'Thank you.' }, ...args,
    } });
    return replies.at(-1);
  }
  // MIME/attachment worker tests remain below the tool policy boundary. The
  // separate tool test proves direct send cannot bypass Cindy's grace period.
  async function runMime(args) {
    let requested = false;
    try {
      const selected = await sandbox.selectGoogleAccount(undefined);
      const prepared = await sandbox.prepareMailAttachments({ ...args, session_context: { workdir, workdir_is_local: true, workdir_is_read_only: false } }, 'call-test');
      const options = { ...prepared.options, ...(prepared.inline?.length ? { 'inline-images': prepared.inline } : {}) };
      requested = true;
      const result = await ctx.handle({ method: 'run', params: { ...args, options, workdir, readOnly: false, accountEmail: selected.accountEmail }, cindy: { secrets: { gog_access_token: 'fixture-token' } } }, {});
      return { ok: result.ok, ...(result.ok ? { result: result.data } : { message: '[' + result.execution + '] ' + result.message }) };
    } catch (error) { return { ok: false, message: '[' + (requested ? 'unknown' : 'not_executed') + '] ' + error.message }; }
  }
  return { run, runMime, calls, writes, requests, fetches, ctx, workdir, rawMessages, httpCalls, replies, continuations,
    flush: async () => { for (const [id, fn] of [...timers]) { timers.delete(id); await fn(); } },
    kv: () => copy(kv), action: message => handler({ type: 'event', name: 'card-action', callId: 'call-test', userActionToken: 'click-ticket', ...message }) };
}

for (const mailSdkVersion of [0, 2]) test('unsupported mail SDK blocks every draft mutation before the worker: ' + mailSdkVersion, async t => {
  const f = fixture(t, { mailSdkVersion });
  for (const operation of ['create', 'reply', 'reply-all', 'forward', 'update', 'send', 'delete']) {
    const result = await f.run({ command: ['drafts', operation], arguments: operation === 'create' ? [] : ['draft-test'], options: {} });
    assert.equal(result.ok, false, operation);
    assert.match(result.message, /\[not_executed\].*更新 Cindy/);
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(f.replies.some(r => r.type === 'mail-draft-update'), false);
  // Read-only tools still work on older hosts; no orphan draft is created.
  const readBack = await f.run({ command: ['drafts', 'get'], arguments: ['draft-test'], options: {},
    session_context: { workdir: f.workdir, workdir_is_local: true, workdir_is_read_only: true } });
  assert.equal(readBack.ok, true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].params.readOnly, true);
});

test('chat image → reply draft → read-back retains source thread, original quote and attachment bytes', async t => {
  const f = fixture(t);
  const result = await f.run({ attachments: [hash], options: { body: 'Thank you.', attach: [url] } });
  assert.equal(result.ok, true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].callId, 'call-test');
  assert.deepEqual(Buffer.from(f.writes[0].content, 'base64'), image);
  assert.equal(f.requests[0].authAccount, 'account-test');
  assert.deepEqual(copy(f.calls[0][0].slice(0, 4)), ['gmail', 'drafts', 'reply-all', 'original-message']);
  assert.ok(f.calls[0][0].includes('--account=self@example.test'));
  assert.ok(f.calls[0][0].some(arg => arg.startsWith('--attach=' + f.workdir)));
  assert.equal(f.calls[0][0].some(arg => arg.includes('no-quote')), false);
  assert.deepEqual(copy(f.calls[1][0]), ['gmail', 'drafts', 'get', 'draft-test', '--readonly']);
  assert.equal(f.calls[1][1], f.calls[0][1]);
  const actual = result.result.readBack;
  assert.equal(actual.status, 'read_back');
  assert.equal(actual.threadId, 'thread-original');
  assert.equal(actual.headers['in-reply-to'], '<original@example.test>');
  assert.equal(actual.headers.references, '<earlier@example.test> <original@example.test>');
  assert.equal(actual.headers.to, 'recipient@example.test');
  assert.equal(actual.headers.cc, '');
  assert.equal(actual.bodyText, body);
  assert.match(actual.bodyHtml, /blockquote/);
  assert.equal(actual.attachments[0].bytes, image.length);
  assert.equal(result.result.importedAttachments[0].hash, hash);
});

test('hash-only grants import once, preserving existing local attachments', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.workdir, 'invoice.pdf'), 'synthetic invoice');
  const result = await f.run({ attachments: [hash, hash], options: { attach: ['invoice.pdf'] } });
  assert.equal(result.ok, true);
  assert.equal(f.writes.length, 1);
  assert.ok(f.fetches.includes(`/media/${hash}.jpg`));
  assert.equal(f.calls[0][0].filter(arg => arg.startsWith('--attach=')).length, 2);
});
test('ordinary image attachments receive managed previews and MIME metadata in the card', async t => {
  const fetches = [];
  const f = fixture(t, { rich: true, previewFetch: async request => {
    fetches.push(request);
    return { ok: true, status: 200, body: JSON.stringify({ data: image.toString('base64url') }) };
  } });
  assert.equal((await f.run({ command: ['drafts', 'get'], arguments: ['draft-test'], options: {} })).ok, true);
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].authAccount, 'account-test');
  const card = f.replies.find(r => r.type === 'mail-draft-update').draft;
  const attachment = JSON.parse(card.fields.find(f => f.name === 'attachmentItems').value)[0];
  assert.equal(attachment.mimeType, 'image/jpeg');
  assert.equal(attachment.previewUrl, url);
  assert.equal(card.fields.find(f => f.name === 'bodyHtml').kind, 'mail-html');
});

test('inline Gmail image bytes reach new and reread draft cards without an attachment fetch', async t => {
  const inlinePayload = copy(payload);
  const file = inlinePayload.parts[1];
  file.body = { data: image.toString('base64url'), size: image.length };
  file.headers = [{ name: 'Content-ID', value: '<photo@example.test>' }];
  for (const operation of ['get', 'create', 'reply']) {
    const f = fixture(t, { rich: true, execute: async argv => argv[2] === 'get'
      ? { ok: true, data: { draft: { id: 'draft-test', message: { id: 'message-test', payload: copy(inlinePayload) } } } }
      : { ok: true, execution: 'executed', data: { draftId: 'draft-test' } } });
    const result = await f.run({ command: ['drafts', operation], arguments: operation === 'create' ? [] : ['draft-test'], options: { body: 'Thank you.' } });
    assert.equal(result.ok, true, operation);
    const readBack = result.result.readBack;
    assert.equal(readBack.attachments[0].previewUrl, url, operation);
    assert.equal(readBack.attachments[0].inlineData, undefined);
    assert.deepEqual(readBack.images, [{ cid: 'photo@example.test', url }]);
    const deposited = f.replies.filter(r => r.kind === 'deposit_media');
    assert.equal(deposited.length, 1);
    assert.deepEqual(Buffer.from(deposited[0].data, 'base64'), image);
    const card = f.replies.find(r => r.type === 'mail-draft-update').draft;
    assert.equal(JSON.parse(card.fields.find(f => f.name === 'attachmentItems').value)[0].previewUrl, url);
    // Preview transport metadata must not become a draft revision or model output.
    const workerRead = f.ctx.draftReadBack({ draft: { id: 'draft-test', message: { id: 'message-test', payload: copy(inlinePayload) } } }, 'draft-test');
    assert.equal(workerRead.attachments[0].inlineData, image.toString('base64url'));
    const padded = copy(inlinePayload);
    padded.parts[1].body.data = image.toString('base64');
    const reread = f.ctx.draftReadBack({ draft: { id: 'draft-test', message: { id: 'message-test', payload: padded } } }, 'draft-test');
    assert.notEqual(reread.attachments[0].inlineData, workerRead.attachments[0].inlineData);
    assert.equal(reread.fingerprint, workerRead.fingerprint);
    const readonly = await f.run({ command: ['drafts', 'get'], arguments: ['draft-test'], options: {},
      session_context: { workdir: f.workdir, workdir_is_local: true, workdir_is_read_only: true } });
    assert.equal(readonly.ok, true);
    assert.equal(readonly.result.readBack.attachments[0].inlineData, undefined);
    assert.equal(f.replies.filter(r => r.kind === 'deposit_media').length, 1);
  }
});

test('inline draft creation builds one raw RFC822 message and keeps the thread id', async t => {
  const f = fixture(t);
  const result = await f.runMime({ command: ['drafts', 'create'], arguments: [], attachments: [hash], options: {
    from: 'self@example.test', to: '', subject: 'Photo', body: 'See image', 'body-html': '<img src="cid:img1@cindy.local">',
    'thread-id': 'thread-original', 'in-reply-to': '<original@example.test>', references: '<original@example.test>', 'inline-images': [hash],
  } });
  assert.equal(result.ok, true);
  assert.equal(f.httpCalls.length, 1);
  assert.equal(f.httpCalls[0].resource, 'drafts');
  assert.equal(f.httpCalls[0].init.method, 'POST');
  assert.equal(f.calls.some(c => c[0].includes('send')), false);
  const raw = f.rawMessages[0];
  assert.deepEqual(Array.from(f.calls[0][0]), ['gmail', 'drafts', 'get', 'draft-test', '--readonly']);
  assert.ok(raw.includes(Buffer.from('Content-ID: <img1@cindy.local>')));
  assert.ok(raw.includes(Buffer.from('Content-Disposition: inline')));
  assert.ok(raw.includes(image.toString('base64')));
  assert.equal(JSON.parse(f.httpCalls[0].init.body).message.threadId, 'thread-original');
});

test('mixed inline draft round-trips international headers and every attachment through an independent MIME parser', async t => {
  const other = Buffer.from('second granted image');
  const otherHash = createHash('sha256').update(other).digest('hex');
  const f = fixture(t, { media: async resource => {
    const bytes = resource === `/media/${hash}.jpg` ? image : resource === `/media/${otherHash}.jpg` ? other : null;
    return new Response(bytes, { status: bytes ? 200 : 404, headers: { 'Content-Type': 'image/jpeg' } });
  } });
  const invoice = Buffer.from('synthetic invoice');
  fs.writeFileSync(path.join(f.workdir, '账单.pdf'), invoice);
  const subject = '中文日本語한국어照片😀'.repeat(12);
  const result = await f.runMime({ command: ['drafts', 'create'], arguments: [], attachments: [hash, otherHash], options: {
    from: '发送人 <self@example.test>', to: '"王, 小明" <recipient@example.test>, Second <second@example.test>',
    cc: '抄送 <cc@example.test>', bcc: '密送 <bcc@example.test>', 'reply-to': '回复 <reply@example.test>',
    subject, body: '请看附件', 'body-html': '<p>请看附件</p><img src="cid:img1@cindy.local">',
    attach: ['账单.pdf'], 'inline-images': [hash],
  } });
  assert.equal(result.ok, true, JSON.stringify(result));
  const parsed = JSON.parse(execFileSync('python3', ['-c', `
import email, email.policy, json, sys, base64
msg = email.message_from_binary_file(sys.stdin.buffer, policy=email.policy.default)
print(json.dumps({'subject': str(msg['Subject']), 'headers': {k: str(msg[k]) for k in ['From','To','Cc','Bcc','Reply-To']},
 'parts': [{'type': p.get_content_type(), 'name': p.get_filename(), 'cid': p['Content-ID'], 'data': base64.b64encode(p.get_payload(decode=True)).decode()} for p in msg.walk() if not p.is_multipart()],
 'defects': [str(d) for p in msg.walk() for d in p.defects]}))
`], { encoding: 'utf8', input: f.rawMessages[0] }));
  assert.equal(parsed.subject, subject);
  assert.match(parsed.headers.From, /发送人 <self@example.test>/);
  assert.match(parsed.headers.To, /王, 小明/);
  assert.match(parsed.headers.To, /second@example.test/);
  for (const [key, name] of [['Cc', '抄送'], ['Bcc', '密送'], ['Reply-To', '回复']]) assert.ok(parsed.headers[key].includes(name));
  assert.deepEqual(parsed.defects, []);
  assert.equal(parsed.parts.length, 5);
  assert.equal(parsed.parts.find(p => p.name === '账单.pdf').data, invoice.toString('base64'));
  assert.equal(parsed.parts.find(p => p.cid === '<img1@cindy.local>').data, image.toString('base64'));
  assert.ok(parsed.parts.some(p => p.data === other.toString('base64')));
});

test('inline drafts reject unsupported flags, header injection and invalid attachment paths before sending', async t => {
  for (const extra of [{ quote: true }, { 'raw-file': 'other.eml' }, { subject: 'Subject\r\nBcc: extra@example.test' }, { attach: ['../outside.pdf'] }]) {
    const f = fixture(t);
    const result = await f.runMime({ command: ['drafts', 'create'], arguments: [], attachments: [hash], options: {
      from: 'self@example.test', to: 'recipient@example.test', subject: 'Photo', body: 'See image',
      'body-html': '<img src="cid:img1@cindy.local">', 'inline-images': [hash], ...extra,
    } });
    assert.equal(result.ok, false);
    assert.equal(f.calls.length, 0);
  }
});

test('draft commands reject new inline images before any Gmail write', async t => {
  const f = fixture(t);
  const result = await f.run({ attachments: [hash], options: { 'inline-images': [hash], 'body-html': '<img src="cid:img1@cindy.local">' } });
  assert.equal(result.ok, false);
  assert.match(result.message, /Create an HTML draft/);
  assert.equal(f.calls.length, 0);
});

// Host grants include non-image media too. Inline placement restricts that
// existing import path without removing support for ordinary media attachments.
test('non-image grants remain ordinary attachments but cannot become inline images', async t => {
  for (const extension of ['mp4', 'mp3', 'glb']) for (const inline of [false, true]) {
    const f = fixture(t, { media: async resource => new Response(
      resource === `/media/${hash}.${extension}` ? image : null,
      { status: resource === `/media/${hash}.${extension}` ? 200 : 404 }) });
    const result = await f.run({ command: ['drafts', 'create'], arguments: [], attachments: [hash], options: {
      to: 'person@example.test', subject: 'Media', body: 'See attachment',
      ...(inline ? { 'inline-images': [hash], 'body-html': '<img src="cid:img1@cindy.local">' } : {}),
    } });
    assert.equal(result.ok, !inline, result.message);
    if (inline) {
      assert.match(result.message, /^\[not_executed\].*inline-images/);
      assert.equal(f.requests.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.httpCalls.length, 0);
    } else assert.ok(f.calls[0][0].some(arg => arg.endsWith('.' + extension)));
  }
});

test('missing grants, unavailable media, corrupt bytes, size limits and denied file writes cannot create mail', async t => {
  const cases = [
    [{}, { options: { attach: [url] } }],
    [{}, { attachments: [hash], command: ['drafts', 'send'], arguments: ['draft-test'] }],
    [{}, { attachments: [hash], options: { 'clear-attachments': true } }],
    [{}, { attachments: [hash], session_context: { workdir_is_local: false } }],
    [{}, { attachments: [hash], session_context: { workdir_is_local: true, workdir_is_read_only: true } }],
    [{ media: async () => new Response(null, { status: 404 }) }, { attachments: [hash] }],
    [{ media: async () => new Response('corrupt') }, { attachments: [hash] }],
    [{ media: async () => ({ ok: true, blob: async () => ({ size: 16 * 1024 * 1024 + 1 }) }) }, { attachments: [hash] }],
    [{ fs: async () => ({ ok: false }) }, { attachments: [hash] }],
  ];
  for (const [overrides, args] of cases) {
    const f = fixture(t, overrides);
    const result = await f.run(args);
    assert.equal(result.ok, false);
    assert.match(result.message, /^\[not_executed\]/);
    assert.equal(f.calls.length, 0);
  }
});

test('forward uses original message and sends the confirmed draft ID, never reconstructing a fresh send', async t => {
  const f = fixture(t);
  const draft = await f.run({ command: ['drafts', 'forward'], arguments: ['invoice-original'], options: { to: 'finance@example.test' } });
  assert.equal(draft.result.draftId, 'draft-test');
  assert.equal(f.calls[0][0].some(arg => arg.includes('skip-attachments')), false);
  await f.run({ command: ['drafts', 'send'], arguments: [draft.result.draftId], options: {} });
  assert.deepEqual(copy(f.calls.at(-1)[0]), ['gmail', 'drafts', 'send', 'draft-test', '--force']);
  assert.equal(f.calls.filter(c => c[0][2] === 'send').length, 1);
});

test('a missing second image stops the entire mail operation after importing the first', async t => {
  const f = fixture(t);
  const result = await f.run({ attachments: [hash, '0'.repeat(64)] });
  assert.equal(result.ok, false);
  assert.match(result.message, /Chat attachment unavailable/);
  assert.equal(f.writes.length, 1);
  assert.equal(f.calls.length, 0);
});

test('card and model delete share the saved Gmail draft and never send or recreate it', async t => {
  for (const entry of ['card', 'model']) {
    const f = fixture(t);
    await f.run();
    const draft = f.replies.findLast(r => r.draft).draft;
    assert.equal(draft.deleteLabel, '删除草稿');
    if (entry === 'card') await f.action({ actionId: 'mail:delete:' + draft.key });
    else assert.equal((await f.run({ command: ['drafts', 'delete'], arguments: ['draft-test'], options: {} })).result.deleted, true);
    assert.equal(f.replies.findLast(r => r.statusOnly).statusOnly.state, 'deleted');
    assert.equal((await f.run({ command: ['drafts', 'delete'], arguments: ['draft-test'], options: {} })).result.alreadyDeleted, true);
    assert.equal((await f.run({ command: ['drafts', 'send'], arguments: ['draft-test'], options: {} })).ok, false);
    await f.flush();
    assert.equal(f.calls.filter(c => c[0][2] === 'delete').length, 1);
    assert.equal(f.calls.filter(c => c[0][2] === 'send' || c[0][2] === 'update').length, 0);
    assert.equal(f.requests.find(r => r.params?.command?.[1] === 'delete').authAccount, 'account-test');
  }
});

test('all draft save commands read back, while updating without attach preserves native attachment semantics', async t => {
  for (const command of ['create', 'update', 'reply', 'reply-all', 'forward']) {
    const f = fixture(t);
    const result = await f.run({ command: ['drafts', command], ...(command === 'update' ? { arguments: ['draft-test'] } : {}) });
    assert.equal(result.result.readBack.status, 'read_back');
    assert.equal(f.calls.length, command === 'update' ? 3 : 2);
    assert.equal(f.calls[0][0].some(arg => arg.startsWith('--attach') || arg.startsWith('--clear-')), false);
  }
});

test('a saved draft remains executed when read-back fails, throws or returns another draft', async t => {
  for (const read of [() => ({ ok: false, execution: 'unknown' }), () => { throw new Error('disconnected'); },
    () => ({ ok: true, data: { draft: { id: 'wrong' } } })]) {
    const f = fixture(t, { execute: async argv => argv[2] === 'get' ? read() : { ok: true, execution: 'executed', data: { draftId: 'saved-draft' } } });
    const result = await f.run();
    assert.equal(result.ok, true);
    assert.equal(result.result.draftId, 'saved-draft');
    assert.equal(result.result.readBack.status, 'unavailable');
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1][5], 10000);
  }
});

test('unknown mutations and transport loss never retry writes or claim success', async t => {
  for (const overrides of [
    { execute: async () => ({ ok: false, execution: 'unknown', message: 'Response lost' }) },
    { node: async () => { throw new Error('lost transport'); } },
  ]) {
    const f = fixture(t, overrides);
    const result = await f.run();
    assert.equal(result.ok, false);
    assert.match(result.message, /unknown/);
    assert.equal(f.requests.length, 1);
    assert.ok(f.calls.length <= 1);
  }
});

test('read-back reports CID resources separately from text and ordinary attachments', t => {
  const f = fixture(t);
  const value = copy(payload);
  value.parts.push({ mimeType: 'image/png', headers: [{ name: 'Content-ID', value: '<logo@example.test>' },
    { name: 'Content-Disposition', value: 'inline' }], body: { attachmentId: 'inline-part', size: 123 } });
  const result = f.ctx.draftReadBack({ draft: { id: 'draft-test', message: { id: 'message-test', payload: value } } }, 'draft-test');
  assert.equal(result.attachments.length, 2);
  assert.equal(result.attachments[1].contentId, '<logo@example.test>');
  assert.equal(result.attachments[1].disposition, 'inline');
  assert.equal(result.bodyText, body);
});

test('inline CIDs follow requested order, including repeated hashes, rather than grant order', async t => {
  const other = Buffer.from('second image');
  const otherHash = createHash('sha256').update(other).digest('hex');
  const f = fixture(t, { media: async resource => {
    const bytes = resource === `/media/${hash}.jpg` ? image : resource === `/media/${otherHash}.jpg` ? other : null;
    return new Response(bytes, { status: bytes ? 200 : 404, headers: { 'Content-Type': 'image/jpeg' } });
  } });
  const result = await f.runMime({ command: ['drafts', 'create'], arguments: [], attachments: [hash, otherHash], options: {
    from: 'self@example.test', to: 'self@example.test', subject: 'Order', body: 'Order',
    'body-html': '<img src="cid:img1@cindy.local"><img src="cid:img2@cindy.local"><img src="cid:img3@cindy.local">',
    'inline-images': [otherHash, hash, otherHash],
  } });
  assert.equal(result.ok, true);
  const raw = f.rawMessages[0].toString();
  for (const [i, bytes] of [other, image, other].entries()) {
    const part = raw.split('Content-ID: <img' + (i + 1) + '@cindy.local>')[1].split('--cindy-')[0];
    assert.ok(part.includes(bytes.toString('base64')));
  }
});

// Inline draft creation uses a fixed API call, not temporary CLI raw files.
// Lost write receipts remain unknown and are never replayed (unit regression).
test('an inline draft POST with a lost response is not retried or sent', async t => {
  const f = fixture(t, { create: async () => { throw new Error('lost response'); } });
  const result = await f.runMime({ command: ['drafts', 'create'], arguments: [], attachments: [hash], options: {
    subject: 'Photo', body: 'See image', 'body-html': '<img src="cid:img1@cindy.local">', 'inline-images': [hash],
  } });
  assert.equal(result.ok, false);
  assert.match(result.message, /unknown/);
  assert.equal(f.httpCalls.length, 1);
  assert.equal(f.calls.length, 0);
});

test('pagination and all-results flags pass through without a ten-message cap', async t => {
  const f = fixture(t);
  await f.run({ command: ['search'], arguments: ['from:billing@example.test'], options: { page: 'next-page', max: 50 } });
  await f.run({ command: ['search'], arguments: ['from:billing@example.test'], options: { all: true } });
  assert.ok(f.calls[0][0].includes('--page=next-page'));
  assert.ok(f.calls[0][0].includes('--max=50'));
  assert.ok(f.calls[1][0].includes('--all=true'));
  assert.equal(f.calls.length, 2);
});

test('reply defaults to all; explicit sender-only and plain HTML paragraph formatting are deterministic', async t => {
  const f = fixture(t);
  await f.run({ options: { body: 'Hi <team> & all,\n\nRegards,\nSender', 'reply-mode': 'sender' } });
  assert.equal(f.calls[0][0][2], 'reply');
  assert.ok(f.calls[0][0].some(arg => arg.includes('Hi &lt;team&gt; &amp; all,')));
  assert.ok(f.calls[0][0].some(arg => arg.includes('<div><br></div><div>Regards,</div><div>Sender</div>')));
  assert.equal(f.calls[0][0].some(arg => arg.includes('--reply-mode')), false);
  assert.equal((await f.run({ options: { body: 'Test', 'reply-mode': 'invalid' } })).ok, false);
  assert.equal(f.calls.length, 2);
});

function fieldsFrom(draft) {
  return { to: draft.headers.to, cc: draft.headers.cc, bcc: draft.headers.bcc, subject: draft.headers.subject,
    body: draft.editor.body, quote: draft.editor.quote };
}
function latestCardAction(f, operation = 'send') {
  const card = f.replies.filter(r => r.type === 'mail-draft-update' && r.draft).at(-1);
  assert.ok(card, 'saved draft has a reviewable card');
  return `mail:${operation}:${card.draft.key}`;
}

test('card Send uses the saved draft once and continues the original task with the user-click ticket', async t => {
  const f = fixture(t);
  const result = await f.run();
  assert.equal(result.result.draftCard, true);
  const actionId = latestCardAction(f);
  const formValues = fieldsFrom(result.result.readBack);
  await Promise.all([f.action({ actionId, formValues }), f.action({ actionId, formValues })]);
  assert.equal(f.calls.filter(c => c[0][2] === 'send').length, 1);
  assert.equal(f.calls.find(c => c[0][2] === 'send')[0][3], 'draft-test');
  assert.equal(f.continuations.length, 1);
  assert.equal(f.continuations[0].mode, 'continue');
  assert.equal(f.continuations[0].userActionToken, 'click-ticket');
  assert.equal(f.continuations[0].event.draftId, 'draft-test');
  assert.equal(Object.values(f.kv().mailDraftCards)[0].state, 'sent');
  assert.doesNotMatch(JSON.stringify(f.kv()), /Thank you|fixture-token/);
});

test('unknown send never retries, while failed continuation can resume without a second send', async t => {
  for (const mode of ['unknown', 'continue']) {
    const f = fixture(t, mode === 'unknown' ? { execute: async argv => argv[2] === 'get'
      ? { ok: true, data: { draft: { id: 'draft-test', message: { id: 'message-test', payload: copy(payload) } } } }
      : argv[2] === 'send' ? { ok: false, execution: 'unknown', message: 'Check Sent before retrying' }
        : { ok: true, data: { draftId: 'draft-test' } } } : { continueResult: { ok: false } });
    const draft = (await f.run()).result.readBack;
    const actionId = latestCardAction(f), formValues = fieldsFrom(draft);
    await f.action({ actionId, formValues });
    await f.action({ actionId, formValues });
    assert.equal(f.calls.filter(c => c[0][2] === 'send').length, 1);
    if (mode === 'unknown') assert.equal(f.continuations.length, 0);
    else {
      await f.action({ actionId: actionId.replace(':send:', ':continue:') });
      assert.equal(f.continuations.length, 2);
      assert.equal(f.calls.filter(c => c[0][2] === 'send').length, 1);
    }
  }
});

for (const operation of ['change', 'send']) test('editing recipients and body preserves quote, headers and attachments: ' + operation, async t => {
  const stored = copy(payload);
  const quoteText = '\r\n\r\nOn Monday, Sender wrote:\r\n> Original context\r\n';
  stored.headers.push({ name: 'From', value: 'Sender <alias@example.test>' }, { name: 'Reply-To', value: 'reply@example.test' });
  const quoteHtml = '<br><br><div class="gmail_quote"><blockquote>Original <b>context</b></blockquote></div>';
  stored.parts[0].parts[0].body.data = Buffer.from('Thank you.' + quoteText).toString('base64url');
  stored.parts[0].parts[1].body.data = Buffer.from('<p>Thank you.</p>' + quoteHtml).toString('base64url');
  let revision = 1;
  const f = fixture(t, { execute: async argv => {
    if (argv[2] === 'get') return { ok: true, data: { draft: { id: 'draft-test', message: { id: 'm' + revision, payload: copy(stored) } } } };
    if (argv[2] === 'update') {
      const flag = name => argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
      for (const name of ['to', 'cc', 'bcc', 'subject']) {
        stored.headers = stored.headers.filter(h => h.name.toLowerCase() !== name);
        stored.headers.push({ name, value: flag(name) });
      }
      stored.parts[0].parts[0].body.data = Buffer.from(flag('body')).toString('base64url');
      stored.parts[0].parts[1].body.data = Buffer.from(flag('body-html')).toString('base64url');
      revision++;
    }
    return { ok: true, execution: 'executed', data: { draftId: 'draft-test', messageId: 'sent-test' } };
  } });
  const draft = (await f.run()).result.readBack;
  assert.equal(draft.editor.quote, quoteText);
  const values = { ...fieldsFrom(draft), body: 'Changed\n\nSender', cc: 'copy@example.test' };
  await f.action({ actionId: latestCardAction(f, operation), formValues: values, formChange: operation === 'change' });
  if (operation === 'change') await f.flush();
  const update = f.calls.find(c => c[0][2] === 'update')[0];
  assert.ok(update.includes('--cc=copy@example.test'));
  assert.ok(update.includes('--from=alias@example.test'));
  assert.ok(update.includes('--reply-to=reply@example.test'));
  assert.ok(update.some(a => a.startsWith('--body-html=') && a.endsWith(quoteHtml)));
  assert.equal(update.some(a => /--(?:attach|clear-)/.test(a)), false);
  assert.equal(f.calls.filter(c => c[0][2] === 'send').length, operation === 'send' ? 1 : 0);
  assert.equal(f.continuations.length, operation === 'send' ? 1 : 0);
});

test('editing an inline-image draft cannot strip its CID metadata', async t => {
  const stored = copy(payload);
  stored.parts[1].headers = [{ name: 'Content-ID', value: '<logo@example.test>' }];
  const f = fixture(t, { execute: async () => ({ ok: true, data: { draft: { id: 'draft-test', message: { id: 'message-test', payload: stored } }, draftId: 'draft-test' } }) });
  const draft = (await f.run()).result.readBack;
  await f.action({ actionId: latestCardAction(f), formValues: { ...fieldsFrom(draft), body: 'Changed' } });
  assert.equal(f.calls.filter(c => c[0][2] === 'send' || c[0][2] === 'update').length, 0);
  assert.match(f.replies.filter(r => r.type === 'mail-draft-update').at(-1).draft.status, /原草稿未更改/);
});

test('stale drafts and invalid recipients do not send and remain reviewable', async t => {
  const f = fixture(t);
  const draft = (await f.run()).result.readBack;
  await f.action({ actionId: latestCardAction(f), formValues: { ...fieldsFrom(draft), to: 'invalid' } });
  assert.equal(f.calls.filter(c => c[0][2] === 'send').length, 0);
  const next = latestCardAction(f);
  const key = next.split(':').at(-1);
  const stale = await f.ctx.composeDraft({ params: { draftId: 'draft-test', fingerprint: '0'.repeat(64), fields: fieldsFrom(draft), send: true }, cindy: { secrets: { gog_access_token: 'fixture-token' } } }, {});
  assert.equal(stale.execution, 'not_executed');
  assert.equal(stale.stale.draftId, 'draft-test');
  assert.equal(f.kv().mailDraftCards[key].state, 'draft');
});

// Production tool/event entry points with a mutable fake Gmail mailbox. This
// covers the old failure: the model sent a draft before local edits were saved.
function editableMailbox(t, beforeUpdate, initial = payload) {
  const stored = copy(initial);
  let revision = 1;
  const f = fixture(t, { execute: async argv => {
    if (argv[2] === 'get') return { ok: true, data: { draft: { id: 'draft-test', message: { id: 'm' + revision, payload: copy(stored) } } } };
    if (argv[2] === 'update') {
      if (beforeUpdate) await beforeUpdate();
      const flag = name => argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3);
      for (const name of ['to', 'cc', 'bcc', 'subject']) {
        stored.headers = stored.headers.filter(h => h.name.toLowerCase() !== name);
        stored.headers.push({ name, value: flag(name) });
      }
      stored.parts[0].parts[0].body.data = Buffer.from(flag('body')).toString('base64url');
      stored.parts[0].parts[1].body.data = Buffer.from(flag('body-html')).toString('base64url');
      revision++;
    }
    return { ok: true, execution: 'executed', data: { draftId: 'draft-test', messageId: 'sent-test' } };
  } });
  return { ...f, stored };
}

// New-mail cards omit quote in the UI, but must still sync and send the full
// current draft through both production entry points (not a reconstructed send).
for (const entry of ['card', 'model']) test('new message edits sync and send without a quote section: ' + entry, async t => {
  const initial = copy(payload);
  initial.headers = [{ name: 'To', value: 'first@example.test' }, { name: 'Subject', value: '' }];
  initial.parts[0].parts[0].body.data = Buffer.from('New message').toString('base64url');
  initial.parts[0].parts[1].body.data = Buffer.from('<div>New message</div>').toString('base64url');
  const f = editableMailbox(t, undefined, initial);
  const created = await f.run({ command: ['drafts', 'create'], arguments: [], options: { to: 'first@example.test', body: 'New message' } });
  assert.equal(created.result.draftCard, true);
  const fields = f.replies.find(r => r.type === 'mail-draft-update' && r.draft).draft.fields;
  assert.equal(fields.some(field => field.name === 'quote'), false);
  assert.equal(fields.find(field => field.name === 'to').kind, 'recipients');
  const values = { ...Object.fromEntries(fields.map(field => [field.name, field.value])),
    to: 'second@example.test', cc: 'copy@example.test', subject: 'New subject', body: 'Latest body\n\nSignature' };
  const send = latestCardAction(f);
  await f.action({ actionId: latestCardAction(f, 'change'), formChange: true, formValues: values });
  const read = await f.run({ command: ['drafts', 'get'], arguments: ['draft-test'], options: {} });
  assert.equal(read.result.readBack.headers.to, values.to);
  assert.equal(read.result.readBack.editor.body, values.body);
  if (entry === 'card') {
    await f.action({ actionId: send, formValues: values });
    assert.equal(f.calls.filter(c => c[0][2] === 'send').length, 0, 'old view cannot send');
    await f.action({ actionId: latestCardAction(f), formValues: values });
  }
  else await f.run({ command: ['drafts', 'send'], arguments: ['draft-test'], options: {} });
  const calls = f.calls.filter(c => c[0][2] === 'send');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0][3], 'draft-test');
  assert.equal(f.continuations.length, entry === 'card' ? 1 : 0);
  assert.equal(f.stored.headers.some(h => ['In-Reply-To', 'References'].includes(h.name)), false);
  assert.equal(f.calls.filter(c => c[0][2] === 'update').length, 1);
});

test('a card submission without editable fields never sends an unseen draft', async t => {
  const f = fixture(t);
  await f.run();
  await f.action({ actionId: latestCardAction(f) });
  assert.equal(f.calls.filter(c => c[0][2] === 'send').length, 0);
});

test('card edits auto-sync to Gmail; model reads the edits and both send paths share one receipt', async t => {
  const f = editableMailbox(t);
  const draft = (await f.run()).result.readBack;
  const send = latestCardAction(f), change = latestCardAction(f, 'change');
  const values = { ...fieldsFrom(draft), body: 'Meeting at 3 pm', cc: 'copy@example.test' };
  await f.action({ actionId: change, formChange: true, formValues: values });
  assert.equal(f.calls.filter(c => c[0][2] === 'update').length, 0);
  await f.flush();
  assert.equal(f.calls.filter(c => c[0][2] === 'update').length, 1);
  assert.equal(f.continuations.length, 0);
  assert.match(f.replies.filter(r => r.type === 'mail-draft-update').at(-1).draft.status, /已同步到 Gmail/);
  const readBack = await f.run({ command: ['drafts', 'get'], arguments: ['draft-test'], options: {} });
  assert.equal(readBack.result.readBack.editor.body, values.body);
  assert.equal(readBack.result.readBack.headers.cc, values.cc);
  await Promise.all([
    f.run({ command: ['drafts', 'send'], arguments: ['draft-test'], options: {} }),
    f.action({ actionId: send, formValues: values }),
  ]);
  assert.equal(f.calls.filter(c => c[0][2] === 'send').length, 1);
  assert.equal(Object.values(f.kv().mailDraftCards)[0].state, 'sent');
});

test('model send waits for in-flight autosave and includes a newer edit typed during that save', async t => {
  let release, started;
  const writing = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let updates = 0;
  const f = editableMailbox(t, async () => { if (++updates === 1) { started(); await gate; } });
  const draft = (await f.run()).result.readBack;
  const actionId = latestCardAction(f, 'change');
  const values = { ...fieldsFrom(draft), body: 'First edit' };
  await f.action({ actionId, formChange: true, formValues: values });
  const save = f.flush();
  await writing;
  await f.action({ actionId, formChange: true, formValues: { ...values, body: 'Latest edit' } });
  const send = f.run({ command: ['drafts', 'send'], arguments: ['draft-test'], options: {} });
  release();
  await save;
  const result = await send;
  assert.equal(result.ok, true);
  assert.equal(result.result.readBack.bodyText, 'Latest edit');
  assert.equal(f.calls.filter(c => c[0][2] === 'send').length, 1);
  assert.equal(f.continuations.length, 0, 'model send does not start a second Agent turn');
});

test('failed sync blocks sending; independent Gmail edits merge into the actual sent draft', async t => {
  const f = editableMailbox(t);
  const draft = (await f.run()).result.readBack;
  await f.action({ actionId: latestCardAction(f, 'change'), formChange: true,
    formValues: { ...fieldsFrom(draft), to: 'invalid', body: 'Keep my edit' } });
  await f.flush();
  assert.equal((await f.run({ command: ['drafts', 'send'], arguments: ['draft-test'], options: {} })).ok, false);
  assert.equal(f.calls.filter(c => c[0][2] === 'send').length, 0);
  // Explicit re-read recovers from a validation error. A remote Cc change and
  // local body edit must both reach the provider rather than reporting conflict.
  const read = await f.run({ command: ['drafts', 'get'], arguments: ['draft-test'], options: {} });
  f.stored.headers.push({ name: 'Cc', value: 'external@example.test' });
  await f.action({ actionId: latestCardAction(f, 'change'), formChange: true,
    formValues: { ...fieldsFrom(read.result.readBack), body: 'Local change' } });
  await f.flush();
  const sent = await f.run({ command: ['drafts', 'send'], arguments: ['draft-test'], options: {} });
  assert.equal(sent.ok, true);
  assert.equal(sent.result.readBack.headers.cc, 'external@example.test');
  assert.equal(sent.result.readBack.editor.body, 'Local change');
  assert.equal(f.calls.filter(c => c[0][2] === 'send').length, 1);
  assert.equal(f.calls.filter(c => c[0][2] === 'update').length, 1);
});

test('tool direct-send commands cannot bypass the draft countdown', async t => {
  for (const command of [['send'], ['reply'], ['reply-all']]) {
    const f = fixture(t);
    const result = await f.run({ command, arguments: [], options: { to: 'self@example.test', body: 'Test' } });
    assert.equal(result.ok, false);
    assert.match(result.message, /not_executed.*10 秒/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.calls.length, 0);
  }
});
