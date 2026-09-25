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

function fixture(t, overrides = {}) {
  const workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-compose-test-')));
  t.after(() => fs.rmSync(workdir, { recursive: true, force: true }));
  const calls = [], writes = [], requests = [], fetches = [], replies = [];
  const ctx = createContext({ __dirname: '/fixture', Buffer,
    require: name => name === '../vendor/gog/binaries.json' ? {} : require(name) });
  runInContext(worker, ctx);
  const leaf = (name, flags = []) => ({ name, flags: flags.map(name => ({ name, type: name === 'quote' ? 'bool' : 'string' })), subcommands: [] });
  const composeFlags = ['attach', 'to', 'body', 'reply-to-message-id', 'quote', 'raw-file', 'thread-id'];
  ctx.schema = async () => ({ name: 'gmail', flags: [], subcommands: [leaf('send', composeFlags), leaf('search', ['page', 'max', 'all']),
    { name: 'drafts', flags: [], subcommands: ['create', 'update', 'reply', 'reply-all', 'forward', 'get', 'send'].map(name => leaf(name, composeFlags)) }] });
  ctx.execute = async (...args) => {
    calls.push(args);
    if (overrides.execute) return overrides.execute(...args);
    const argv = args[0];
    if (argv[1] === 'drafts' && argv[2] === 'get') return { ok: true, data: { draft: { id: 'draft-test', message: { id: 'message-test', threadId: 'thread-original', payload: copy(payload) } } } };
    return { ok: true, execution: 'executed', data: { draftId: 'draft-test' } };
  };
  let handler;
  const sandbox = createContext({ crypto: webcrypto, Uint8Array, btoa, Set,
    fetch: async resource => {
      fetches.push(resource);
      if (resource === '/oauth') return { ok: true, json: async () => [{ key: 'gmail_account', clientConfigured: true,
        accounts: [{ id: 'account-test', label: 'self@example.test', status: 'connected' }] }] };
      if (resource === '/kv') return { ok: true, json: async () => ({}) };
      if (overrides.media) return overrides.media(resource);
      return new Response(resource === `/media/${hash}.jpg` ? image : null, { status: resource === `/media/${hash}.jpg` ? 200 : 404 });
    },
    cindy: { onHostMessage: fn => { handler = fn; }, send: async result => { replies.push(copy(result)); },
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
  runInContext(main, sandbox);
  async function run(args = {}) {
    await handler({ type: 'tool-call', tool: 'gmail_run', callId: 'call-test', args: {
      session_context: { workdir, workdir_is_local: true, workdir_is_read_only: false },
      account_email: 'self@example.test', command: ['drafts', 'reply'], arguments: ['original-message'], options: { body: 'Thank you.' }, ...args,
    } });
    return replies.at(-1);
  }
  return { run, calls, writes, requests, fetches, ctx, workdir };
}

test('chat image → reply draft → read-back retains source thread, original quote and attachment bytes', async t => {
  const f = fixture(t);
  const result = await f.run({ attachments: [hash], options: { body: 'Thank you.', attach: [url] } });
  assert.equal(result.ok, true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].callId, 'call-test');
  assert.deepEqual(Buffer.from(f.writes[0].content, 'base64'), image);
  assert.equal(f.requests[0].authAccount, 'account-test');
  assert.deepEqual(copy(f.calls[0][0].slice(0, 4)), ['gmail', 'drafts', 'reply', 'original-message']);
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

test('explicit inline send builds one raw RFC822 message and keeps the thread id', async t => {
  const f = fixture(t);
  const result = await f.run({ command: ['send'], arguments: [], attachments: [hash], options: {
    from: 'self@example.test', to: 'recipient@example.test', subject: 'Photo', body: 'See image', 'body-html': '<img src="cid:img1@cindy.local">',
    'thread-id': 'thread-original', 'in-reply-to': '<original@example.test>', references: '<original@example.test>', 'inline-images': [hash],
  } });
  assert.equal(result.ok, true);
  const argv = f.calls[0][0];
  assert.equal(argv.some(arg => arg.startsWith('--attach=')), false);
  const rawArg = argv.find(arg => arg.startsWith('--raw-file='));
  assert.ok(rawArg);
  const raw = fs.readFileSync(rawArg.slice('--raw-file='.length));
  assert.ok(raw.includes(Buffer.from('Content-ID: <img1@cindy.local>')));
  assert.ok(raw.includes(Buffer.from('Content-Disposition: inline')));
  assert.ok(raw.includes(image.toString('base64')));
  assert.ok(argv.includes('--thread-id=thread-original'));
  assert.equal(argv.some(arg => arg.startsWith('--body')), false);
});

test('mixed inline send round-trips international headers and every attachment through an independent MIME parser', async t => {
  const other = Buffer.from('second granted image');
  const otherHash = createHash('sha256').update(other).digest('hex');
  const f = fixture(t, { media: async resource => {
    const bytes = resource === `/media/${hash}.jpg` ? image : resource === `/media/${otherHash}.jpg` ? other : null;
    return new Response(bytes, { status: bytes ? 200 : 404, headers: { 'Content-Type': 'image/jpeg' } });
  } });
  const invoice = Buffer.from('synthetic invoice');
  fs.writeFileSync(path.join(f.workdir, '账单.pdf'), invoice);
  const subject = '中文日本語한국어照片😀'.repeat(12);
  const result = await f.run({ command: ['send'], arguments: [], attachments: [hash, otherHash], options: {
    from: '发送人 <self@example.test>', to: '"王, 小明" <recipient@example.test>, Second <second@example.test>',
    cc: '抄送 <cc@example.test>', bcc: '密送 <bcc@example.test>', 'reply-to': '回复 <reply@example.test>',
    subject, body: '请看附件', 'body-html': '<p>请看附件</p><img src="cid:img1@cindy.local">',
    attach: ['账单.pdf'], 'inline-images': [hash],
  } });
  assert.equal(result.ok, true, JSON.stringify(result));
  const filename = f.calls[0][0].find(arg => arg.startsWith('--raw-file=')).slice('--raw-file='.length);
  const parsed = JSON.parse(execFileSync('python3', ['-c', `
import email, email.policy, json, sys, base64
with open(sys.argv[1], 'rb') as f: msg = email.message_from_binary_file(f, policy=email.policy.default)
print(json.dumps({'subject': str(msg['Subject']), 'headers': {k: str(msg[k]) for k in ['From','To','Cc','Bcc','Reply-To']},
 'parts': [{'type': p.get_content_type(), 'name': p.get_filename(), 'cid': p['Content-ID'], 'data': base64.b64encode(p.get_payload(decode=True)).decode()} for p in msg.walk() if not p.is_multipart()],
 'defects': [str(d) for p in msg.walk() for d in p.defects]}))
`, filename], { encoding: 'utf8' }));
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

test('inline sends reject unsupported flags, header injection and invalid attachment paths before sending', async t => {
  for (const extra of [{ quote: true }, { 'raw-file': 'other.eml' }, { subject: 'Subject\r\nBcc: extra@example.test' }, { attach: ['../outside.pdf'] }]) {
    const f = fixture(t);
    const result = await f.run({ command: ['send'], arguments: [], attachments: [hash], options: {
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
  assert.match(result.message, /Draft commands cannot embed/);
  assert.equal(f.calls.length, 0);
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
  assert.deepEqual(copy(f.calls[2][0]), ['gmail', 'drafts', 'send', 'draft-test', '--force']);
  assert.equal(f.calls.length, 3);
});

test('a missing second image stops the entire mail operation after importing the first', async t => {
  const f = fixture(t);
  const result = await f.run({ attachments: [hash, '0'.repeat(64)] });
  assert.equal(result.ok, false);
  assert.match(result.message, /Chat attachment unavailable/);
  assert.equal(f.writes.length, 1);
  assert.equal(f.calls.length, 0);
});

test('all draft save commands read back, while updating without attach preserves native attachment semantics', async t => {
  for (const command of ['create', 'update', 'reply', 'reply-all', 'forward']) {
    const f = fixture(t);
    const result = await f.run({ command: ['drafts', command] });
    assert.equal(result.result.readBack.status, 'read_back');
    assert.equal(f.calls.length, 2);
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

test('pagination and all-results flags pass through without a ten-message cap', async t => {
  const f = fixture(t);
  await f.run({ command: ['search'], arguments: ['from:billing@example.test'], options: { page: 'next-page', max: 50 } });
  await f.run({ command: ['search'], arguments: ['from:billing@example.test'], options: { all: true } });
  assert.ok(f.calls[0][0].includes('--page=next-page'));
  assert.ok(f.calls[0][0].includes('--max=50'));
  assert.ok(f.calls[1][0].includes('--all=true'));
  assert.equal(f.calls.length, 2);
});
