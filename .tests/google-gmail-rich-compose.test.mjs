import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { updateRichDraft, keyFor } = require('../google-gmail/node/mailMime.cjs');
const source = fs.readFileSync(new URL('../google-gmail/node/gog.cjs', import.meta.url), 'utf8');
function fixture(t, inline = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-rich-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = new EventEmitter();
  let receive, listening = false;
  const ctx = createContext({ Buffer, __dirname: '/fixture',
    process: { env: {}, stdin: {}, on() {}, stdout: { write(line) { receive(JSON.parse(line)); } } },
    require: name => name === 'node:readline' ? { createInterface: () => input } : name === '../vendor/gog/binaries.json' ? {} : name === './mailMime.cjs' ? require('../google-gmail/node/mailMime.cjs') : require(name) });
  runInContext(source.split('const input = readline.createInterface')[0], ctx);
  const image = Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
  const part = { partId: '1', filename: '图.png', mimeType: 'image/png', headers: inline ? [{ name: 'Content-ID', value: '<photo@example.test>' }] : [], body: { size: image.length, data: image.toString('base64url') } };
  const payload = { mimeType: 'multipart/mixed', headers: [
    ['From', 'Self <self@example.test>'], ['To', 'Person <person@example.test>'], ['Subject', 'Hello'], ['In-Reply-To', '<original@example.test>'], ['References', '<original@example.test>'],
  ].map(([name, value]) => ({ name, value })), parts: [
    { mimeType: 'text/plain', body: { data: Buffer.from('Original').toString('base64url') } },
    { mimeType: 'text/html', body: { data: Buffer.from('<p>Original</p>' + (inline ? '<img src="cid:photo@example.test">' : '')).toString('base64url') } }, part,
  ] };
  const draft = { id: 'draft-test', message: { id: 'message-test', threadId: 'thread-test', payload } };
  const before = ctx.draftReadBack({ draft }, draft.id, 'zh-CN');
  const fields = { to: before.headers.to, cc: '', bcc: '', subject: '中文 subject', body: 'Edited\nMore', quote: '',
    bodyHtml: '<p><strong>Edited</strong></p><p>More</p><img src="cid:photo@example.test">', quoteHtml: '',
    attachmentItems: JSON.stringify([{ key: keyFor(part), filename: part.filename }]) };
  const p = { draftId: draft.id, fields, attachments: [], locale: 'zh-CN' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.headers.Authorization, 'Bearer fixture-token');
    assert.equal(init.redirect, 'error');
    return new Response(JSON.stringify(draft), { headers: { 'Content-Type': 'application/json' } });
  });
  // The Chinese assertions describe the zh-CN copy that main.js requests with
  // params.locale. Test entry points pin it; worker-internal calls stay real.
  const zh = message => ({ ...message, params: { locale: 'zh-CN', ...message.params } });
  return { ctx, before, draft, fields, p, calls, dir, image,
    handle: (message, execution) => ctx.handle(zh(message), execution),
    draftReadBack: (data, draftId) => ctx.draftReadBack(data, draftId, 'zh-CN'),
    readDraft: (data, draftId, token) => ctx.readDraft(data, draftId, token, 'zh-CN'),
    readSavedDraft: (result, command, token, cwd) => ctx.readSavedDraft(result, command, token, cwd, 'zh-CN'),
    rpc(message) {
      if (!listening) { runInContext(source.slice(source.indexOf('const input = readline.createInterface')), ctx); listening = true; }
      return new Promise(resolve => {
        receive = response => { assert.equal(response.id, 'encoding-test'); resolve(response.result); };
        input.emit('line', JSON.stringify({ ...zh(message), id: 'encoding-test' }));
      });
    },
    run: (execution = {}) => updateRichDraft(p, 'fixture-token', before, ctx, execution) };
}
test('HTML, existing CID bytes, new attachment and reply context survive a single draft PUT', async t => {
  const f = fixture(t), file = path.join(f.dir, '方案.pdf');
  fs.writeFileSync(file, 'synthetic-pdf');
  f.p.attachments.push({ path: file, filename: '方案.pdf', bytes: 13, sha256: createHash('sha256').update('synthetic-pdf').digest('hex') });
  const result = await f.run();
  assert.equal(result.ok, true);
  const writes = f.calls.filter(c => c.init.method === 'PUT');
  assert.equal(writes.length, 1);
  const sent = JSON.parse(writes[0].init.body);
  assert.equal(sent.message.threadId, 'thread-test');
  const raw = Buffer.from(sent.message.raw, 'base64url').toString();
  assert.match(raw, /Content-ID: <photo@example.test>/);
  assert.match(raw, /In-Reply-To: <original@example.test>/i);
  assert.match(raw, /filename\*=UTF-8''%E6%96%B9%E6%A1%88.pdf/);
  const decoded = [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n(?:[^\r]*\r\n)*?\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g)].map(m => Buffer.from(m[1], 'base64'));
  assert.ok(decoded.some(b => b.toString() === f.fields.bodyHtml));
  assert.ok(decoded.some(b => b.equals(f.image)));
  assert.ok(decoded.some(b => b.toString() === 'synthetic-pdf'));
  assert.equal(f.calls.some(c => /send/.test(c.url)), false);
});
// A body-only plain alternative can be generated by Host. A separately edited
// quote cannot: changing/removing it must supersede the hidden HTML snapshot.
test('rich quote edits and removals supersede stale HTML while untouched quotes retain formatting', async t => {
  for (const mode of ['unchanged', 'edited', 'removed', 'html-edited']) {
    const f = workerFixture(t);
    const quoteHtml = '<br><br><div class="gmail_quote"><a href="https://example.test">Older</a></div>';
    f.draft.message.payload.parts[0].body.data = Buffer.from('Original\n\nOn Monday, sender wrote:\n> Older').toString('base64url');
    f.draft.message.payload.parts[1].body.data = Buffer.from('<p>Original</p>' + quoteHtml).toString('base64url');
    const before = f.draftReadBack({ draft: f.draft }, f.draft.id);
    const fields = { to: before.headers.to, cc: '', bcc: '', subject: before.headers.subject,
      body: before.editor.body, quote: mode === 'removed' ? '' : mode === 'edited' ? '\n\nOn Monday, sender wrote:\n> Changed quote' : before.editor.quote,
      bodyHtml: before.editor.bodyHtml, quoteHtml, attachmentItems: JSON.stringify(before.attachments) };
    fields.to = 'other@example.test'; // Exercise preservation during other edits.
    if (mode === 'html-edited') fields.quoteHtml = quoteHtml.replace('Older', 'New HTML');
    const result = await f.handle({ method: 'compose', cindy: { secrets: { gog_access_token: 'fixture-token' } },
      params: { draftId: f.draft.id, fingerprint: before.fingerprint, fields, send: false } }, {});
    assert.equal(result.ok, true, result.message);
    const saved = result.data.readBack;
    if (mode === 'removed') {
      assert.equal(saved.bodyHtml, before.editor.bodyHtml);
      assert.equal(saved.bodyText, before.editor.body);
    } else if (mode === 'edited') {
      assert.match(saved.bodyHtml, /Changed quote/);
      assert.doesNotMatch(saved.bodyHtml, /Older/);
      assert.equal(saved.bodyText, fields.body + fields.quote);
    } else assert.equal(saved.editor.quoteHtml, fields.quoteHtml);
    assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
    assert.equal(f.calls.some(c => /send/.test(c.url)), false);
  }
});
test('removing an attachment preserves the body and removes its bytes', async t => {
  const f = fixture(t); f.fields.bodyHtml = '<p>Only text</p>'; f.fields.attachmentItems = '[]';
  assert.equal((await f.run()).files.length, 0);
  const raw = Buffer.from(JSON.parse(f.calls.at(-1).init.body).message.raw, 'base64url').toString();
  assert.doesNotMatch(raw, /Content-ID:/);
});
// A preview URL is not a draft edit. Empty-recipient preview drafts must also
// be saveable, without weakening the recipient check at send time (unit).
test('preview metadata and empty recipients do not rewrite an unchanged draft', async t => {
  const f = workerFixture(t);
  f.draft.message.payload.headers.find(h => h.name === 'To').value = '';
  const before = f.draftReadBack({ draft: f.draft }, f.draft.id);
  const fields = { to: '', cc: '', bcc: '', subject: before.headers.subject, body: before.editor.body, quote: before.editor.quote,
    bodyHtml: before.editor.bodyHtml, quoteHtml: before.editor.quoteHtml,
    attachmentItems: JSON.stringify(before.attachments.map(a => ({ ...a, previewUrl: `cindy-media://blobs/${'a'.repeat(64)}.png` }))) };
  const message = { method: 'compose', cindy: { secrets: { gog_access_token: 'fixture-token' } },
    params: { draftId: f.draft.id, fingerprint: before.fingerprint, fields, send: false } };
  assert.equal((await f.handle(message, {})).ok, true);
  assert.equal(f.calls.length, 0);
  message.params.send = true;
  assert.equal((await f.handle(message, {})).execution, 'not_executed');
  assert.equal(f.calls.length, 0);
});
test('a stale server draft is not overwritten', async t => {
  const f = fixture(t); f.before.fingerprint = 'stale';
  assert.equal((await f.run()).execution, 'not_executed');
  assert.equal(f.calls.length, 1);
});
test('a dangling CID is rejected before any write', async t => {
  const f = fixture(t); f.fields.attachmentItems = '[]';
  await assert.rejects(f.run(), /已移除/);
  assert.equal(f.calls.length, 1);
});
test('changed or symlinked local files are never uploaded', async t => {
  const f = fixture(t); const file = path.join(f.dir, 'file'); fs.writeFileSync(file, 'changed');
  f.p.attachments = [{ path: file, filename: 'file', bytes: 7, sha256: '0'.repeat(64) }];
  await assert.rejects(f.run(), /已变化/);
  if (process.platform !== 'win32') {
    fs.symlinkSync(file, file + '-link'); f.p.attachments[0].path = file + '-link';
    await assert.rejects(f.run());
  }
  assert.ok(f.calls.every(c => c.init.method !== 'PUT'));
});
test('network failure after PUT leaves execution unknown and does not retry', async t => {
  const f = fixture(t), original = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => { if (init.method === 'PUT') throw new Error('network'); return original(url, init); });
  const execution = {};
  await assert.rejects(f.run(execution), /network/);
  assert.equal(execution.started, true);
});

// Production worker regression: AI edits to a CID draft used to be refused (or
// lose Content-ID through CLI). Exercise run -> compose -> raw PUT -> read-back
// with synthetic Gmail responses; no real provider or sending (unit tier).
function workerFixture(t, inline = true) {
  const f = fixture(t, inline);
  f.ctx.schema = async () => ({ subcommands: [{ name: 'drafts', subcommands: ['get', 'update'].map(name => ({ name, subcommands: [], flags: [] })) }] });
  f.ctx.execute = async argv => {
    assert.deepEqual(Array.from(argv.slice(0, 3)), ['gmail', 'drafts', 'get']);
    return { ok: true, data: { draft: f.draft } };
  };
  const original = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init.method === 'PUT') {
      const raw = Buffer.from(JSON.parse(init.body).message.raw, 'base64url').toString();
      const to = /^To: (.*)\r?$/m.exec(raw)?.[1]?.trim();
      if (to) f.draft.message.payload.headers.find(h => h.name === 'To').value = to;
      for (const part of f.draft.message.payload.parts.filter(p => /^text\//.test(p.mimeType))) {
        const mime = part.mimeType.replace('/', '\/');
        const match = raw.match(new RegExp('Content-Type: ' + mime + '; charset=UTF-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+?)(?=\\r\\n--)'));
        assert.ok(match, part.mimeType);
        const bytes = Buffer.from(match[1], 'base64');
        part.body = { data: bytes.toString('base64url'), size: bytes.length };
        part.headers = [{ name: 'Content-Type', value: part.mimeType + '; charset=UTF-8' }];
      }
      const files = [...raw.matchAll(/Content-Type: ([^\r\n]+)\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: (?:inline|attachment); filename\*=UTF-8''([^\r\n]+)\r\n(?:Content-ID: <([^>]+)>\r\n)?\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g)].map((m, index) => {
        const data = Buffer.from(m[4], 'base64');
        return { partId: String(index + 1), filename: decodeURIComponent(m[2]), mimeType: m[1],
          headers: m[3] ? [{ name: 'Content-ID', value: '<' + m[3] + '>' }] : [],
          body: { size: data.length, data: data.toString('base64url') } };
      });
      f.draft.message.payload.parts = f.draft.message.payload.parts.filter(p => !p.filename).concat(files);
    }
    return original(url, init);
  });
  return f;
}
// The actual worker and HTTP transport must preserve provider receipts across
// both raw POST creation and rich PUT updates (unit, synthetic responses).
test('draft writes distinguish rejection, successful unusable receipts and transport uncertainty', async t => {
  for (const operation of ['create', 'update']) for (const responseCase of [
    { status: 403, body: '{', execution: 'not_executed', cancelThrows: true },
    { status: 429, body: '{}', execution: 'not_executed' },
    { status: 500, body: '{}', execution: 'unknown' },
    { status: 408, body: '{}', execution: 'unknown' },
    { status: 200, body: '{', execution: 'executed' },
    { status: 200, oversized: true, execution: 'executed' },
    { status: 200, brokenStream: true, execution: 'executed' },
    { network: true, execution: 'unknown' },
    ...(operation === 'create' ? [{ status: 200, body: '{}', execution: 'executed' }] : []),
    ...(operation === 'update' ? [{ status: 200, body: '{', execution: 'not_executed', prewrite: true }] : []),
  ]) {
    const f = workerFixture(t), originalFetch = globalThis.fetch;
    const method = operation === 'create' ? 'POST' : 'PUT';
    let writes = 0;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      if (responseCase.prewrite ? init.method === method : init.method !== method) return originalFetch(url, init);
      if (init.method === method) writes++;
      if (responseCase.network) throw new Error('transport lost');
      const response = new Response(responseCase.oversized ? 'x'.repeat(300 * 1024 + 1) : responseCase.body ?? '{}', { status: responseCase.status });
      if (responseCase.cancelThrows) response.body.cancel = async () => { throw new Error('cancel failed'); };
      if (responseCase.brokenStream) return { ok: true, status: 200, body: { async *[Symbol.asyncIterator]() { throw new Error('receipt stream lost'); } } };
      return response;
    });
    let request;
    if (operation === 'create') {
      fs.writeFileSync(path.join(f.dir, 'photo.png'), f.image);
      f.ctx.schema = async () => ({ subcommands: [{ name: 'drafts', subcommands: [{ name: 'create', subcommands: [], flags: [] }] }] });
      request = { method: 'run', params: { command: ['drafts', 'create'], arguments: [], readOnly: false, workdir: f.dir,
        accountEmail: 'self@example.test', options: { to: 'person@example.test', subject: 'Hello', body: 'Photo',
          'body-html': '<img src="cid:img1@cindy.local">', 'inline-images': [{ path: 'photo.png',
            hash: createHash('sha256').update(f.image).digest('hex'), contentType: 'image/png' }] } } };
    } else {
      const before = f.draftReadBack({ draft: f.draft }, f.draft.id);
      request = { method: 'compose', params: { draftId: f.draft.id, fingerprint: before.fingerprint,
        fields: { ...f.fields, subject: 'Hello' }, send: true } };
    }
    request.cindy = { secrets: { gog_access_token: 'fixture-token' } };
    const result = await f.handle(request, {});
    assert.equal(result.ok, false, operation + JSON.stringify(responseCase));
    assert.equal(result.execution, responseCase.execution, operation + JSON.stringify(responseCase));
    if (result.execution === 'executed') assert.match(result.message, /已保存.*(?:未发送|尚未发送)/);
    assert.equal(writes, responseCase.prewrite ? 0 : 1);
    assert.equal(f.calls.some(c => /\/send(?:\?|$)/.test(c.url)), false);
  }
});
// The shared Host formatter supplies corrected names; the adapter must transport
// them even when HTML/CID/bytes are otherwise unchanged (unit, no real requests).
test('Host attachment rename is saved and read back without changing image bytes or CID', async t => {
  const f = workerFixture(t);
  const part = f.draft.message.payload.parts.find(p => p.filename);
  part.filename = 'image-1';
  const before = f.draftReadBack({ draft: f.draft }, f.draft.id);
  const fields = { to: before.headers.to, cc: '', bcc: '', subject: before.headers.subject,
    body: before.editor.body, quote: before.editor.quote, bodyHtml: before.editor.bodyHtml, quoteHtml: before.editor.quoteHtml,
    attachmentItems: JSON.stringify(before.attachments.map(a => ({ ...a, filename: 'image-1.png' }))) };
  const result = await f.handle({ method: 'compose', cindy: { secrets: { gog_access_token: 'fixture-token' } },
    params: { draftId: f.draft.id, fingerprint: before.fingerprint, fields, send: false } }, {});
  assert.equal(result.ok, true, result.message);
  assert.equal(result.data.readBack.attachments[0].filename, 'image-1.png');
  assert.equal(result.data.readBack.attachments[0].contentId, '<photo@example.test>');
  const writes = f.calls.filter(c => c.init.method === 'PUT');
  assert.equal(writes.length, 1);
  const raw = Buffer.from(JSON.parse(writes[0].init.body).message.raw, 'base64url').toString();
  assert.ok(raw.includes(f.image.toString('base64')));
});
test('a regular image attachment becomes a CID part in the same draft without uploading another file', async t => {
  const f = workerFixture(t, false);
  const before = f.draftReadBack({ draft: f.draft }, f.draft.id);
  const cid = 'image-1@cindy.local';
  const fields = { to: before.headers.to, cc: '', bcc: '', subject: before.headers.subject,
    body: before.editor.body, quote: '', bodyHtml: '<p>Original</p><img src="cid:' + cid + '" style="width:240px">', quoteHtml: '',
    attachmentItems: JSON.stringify(before.attachments.map(a => ({ key: a.key, filename: a.filename, contentId: cid }))) };
  const result = await f.handle({ method: 'compose', cindy: { secrets: { gog_access_token: 'fixture-token' } },
    params: { draftId: f.draft.id, fingerprint: before.fingerprint, fields, send: false } }, {});
  assert.equal(result.ok, true, result.message);
  assert.equal(result.data.readBack.attachments.length, 1);
  assert.equal(result.data.readBack.attachments[0].contentId, '<' + cid + '>');
  const writes = f.calls.filter(c => c.init.method === 'PUT');
  assert.equal(writes.length, 1);
  const raw = Buffer.from(JSON.parse(writes[0].init.body).message.raw, 'base64url').toString();
  assert.match(raw, /Content-Disposition: inline/);
  assert.equal(raw.split(f.image.toString('base64')).length - 1, 1);
  assert.equal(f.calls.some(c => /send/.test(c.url)), false);
});
test('forged image CID metadata cannot turn non-image bytes into an embedded image', async t => {
  const f = fixture(t, false), part = f.draft.message.payload.parts.find(p => p.filename);
  part.body.data = Buffer.from('not-an-image').toString('base64url'); part.body.size = 12;
  Object.assign(f.before, f.draftReadBack({ draft: f.draft }, f.draft.id));
  f.fields.attachmentItems = JSON.stringify([{ key: keyFor(part), contentId: 'image-1@cindy.local' }]);
  await assert.rejects(f.run(), /只能将图片/);
  assert.equal(f.calls.some(c => c.init.method === 'PUT'), false);
});
test('AI updates HTML through drafts update while preserving CID bytes and never sending', async t => {
  const f = workerFixture(t);
  const html = '<p><b>AI edited</b></p><img src="cid:photo@example.test">';
  const result = await f.handle({ method: 'run', cindy: { secrets: { gog_access_token: 'fixture-token' } },
    params: { command: ['drafts', 'update'], arguments: ['draft-test'], readOnly: false, options: { body: 'AI edited', 'body-html': html } } }, {});
  assert.equal(result.ok, true, result.message);
  assert.equal(result.data.readBack.editor.bodyHtml, html);
  assert.equal(result.data.readBack.editor.format, 'html');
  assert.equal(result.data.readBack.attachments[0].contentId, '<photo@example.test>');
  assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
  assert.equal(f.calls.some(c => /send/.test(c.url)), false);
});
// Gmail rotates attachment download IDs between reads even when messageId and
// content are unchanged. Both AI update and the card writer must accept this.
test('rotating attachment fetch IDs do not create a draft conflict, while real edits still do', async t => {
  const f = workerFixture(t), part = f.draft.message.payload.parts.find(p => p.filename);
  let sequence = 0;
  const rotate = () => { part.body.attachmentId = 'download-' + ++sequence; };
  rotate();
  const first = f.draftReadBack({ draft: f.draft }, f.draft.id);
  rotate();
  const second = f.draftReadBack({ draft: f.draft }, f.draft.id);
  assert.notEqual(first.attachments[0].attachmentId, second.attachments[0].attachmentId);
  assert.equal(first.fingerprint, second.fingerprint);
  const execute = f.ctx.execute, fetch = globalThis.fetch;
  f.ctx.execute = async (...args) => { rotate(); return execute(...args); };
  t.mock.method(globalThis, 'fetch', async (...args) => { rotate(); return fetch(...args); });
  const result = await f.handle({ method: 'run', cindy: { secrets: { gog_access_token: 'fixture-token' } },
    params: { command: ['drafts', 'update'], arguments: [f.draft.id], readOnly: false, options: { to: 'self@example.test' } } }, {});
  assert.equal(result.ok, true, result.message);
  const writes = f.calls.filter(c => c.init.method === 'PUT');
  assert.equal(writes.length, 1);
  const raw = Buffer.from(JSON.parse(writes[0].init.body).message.raw, 'base64url').toString();
  assert.match(raw, /To: self@example.test/);
  assert.match(raw, /Content-ID: <photo@example.test>/);
  assert.equal(f.calls.some(c => /send/.test(c.url)), false);
  const baseline = f.draftReadBack({ draft: f.draft }, f.draft.id).fingerprint;
  for (const change of [
    draft => { draft.message.id = 'changed-message'; },
    draft => { draft.message.payload.headers.find(h => h.name === 'To').value = 'other@example.test'; },
    draft => { draft.message.payload.parts[1].body.data = Buffer.from('<p>Changed HTML</p>').toString('base64url'); },
    draft => { draft.message.payload.parts.at(-1).body.size++; },
  ]) {
    const changed = structuredClone(f.draft); change(changed);
    assert.notEqual(f.draftReadBack({ draft: changed }, changed.id).fingerprint, baseline);
  }
});
test('plain card edits regenerate the HTML alternative instead of sending stale text', async t => {
  const f = workerFixture(t);
  f.draft.message.payload.parts = f.draft.message.payload.parts.filter(p => /^text\//.test(p.mimeType));
  f.draft.message.payload.parts[1].body.data = Buffer.from(f.ctx.mailBodyHtml('Original')).toString('base64url');
  const before = f.draftReadBack({ draft: f.draft }, 'draft-test');
  assert.equal(before.editor.format, 'text');
  const fields = { to: before.headers.to, cc: '', bcc: '', subject: 'Hello', body: 'User edited', quote: '',
    bodyHtml: before.editor.bodyHtml, quoteHtml: '', attachmentItems: '[]' };
  const result = await f.handle({ method: 'compose', cindy: { secrets: { gog_access_token: 'fixture-token' } },
    params: { draftId: 'draft-test', fingerprint: before.fingerprint, fields, send: false } }, {});
  assert.equal(result.ok, true, result.message);
  assert.equal(result.data.readBack.bodyText, 'User edited');
  assert.equal(result.data.readBack.bodyHtml, f.ctx.mailBodyHtml('User edited'));
  assert.equal(result.data.readBack.editor.format, 'text');
});

// Side-effect tri-state rule: a read failure after successful PUT is a saved,
// unsent draft, never a failed write to replay. Cover both read error shapes.
test('a successful rich save survives read-back failure without reporting not_executed or sending', async t => {
  for (const mode of ['not_executed', 'unknown', 'throw']) {
    const f = workerFixture(t), execute = f.ctx.execute;
    f.ctx.execute = async (...args) => {
      if (f.calls.some(c => c.init.method === 'PUT')) {
        if (mode === 'throw') throw new Error('read failed');
        return { ok: false, execution: mode, message: 'read failed' };
      }
      return execute(...args);
    };
    const result = await f.handle({ method: 'run', cindy: { secrets: { gog_access_token: 'fixture-token' } },
      params: { command: ['drafts', 'update'], arguments: ['draft-test'], readOnly: false, options: { body: 'Edited', 'body-html': '<p>Edited</p><img src="cid:photo@example.test">' } } }, {});
    assert.equal(result.ok, false);
    assert.equal(result.execution, 'executed');
    assert.match(result.message, /已保存.*未发送/);
    assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
    assert.equal(f.calls.some(c => /send/.test(c.url)), false);
  }
});
test('AI attach replaces ordinary files while preserving only CID images still referenced by the body', async t => {
  const f = workerFixture(t), file = path.join(f.dir, 'new.pdf');
  fs.writeFileSync(file, 'new-file');
  f.draft.message.payload.parts.push({ partId: 'old', filename: 'old.pdf', mimeType: 'application/pdf', body: { size: 8, data: Buffer.from('old-file').toString('base64url') } });
  const result = await f.handle({ method: 'run', cindy: { secrets: { gog_access_token: 'fixture-token' } },
    params: { command: ['drafts', 'update'], arguments: [f.draft.id], workdir: f.dir, readOnly: false, options: { attach: ['new.pdf'] } } }, {});
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(Array.from(result.data.readBack.attachments, a => a.filename), ['图.png', 'new.pdf']);
  assert.equal(result.data.readBack.attachments[0].contentId, '<photo@example.test>');
  const raw = Buffer.from(JSON.parse(f.calls.find(c => c.init.method === 'PUT').init.body).message.raw, 'base64url').toString();
  assert.ok(raw.includes(f.image.toString('base64')));
  assert.equal(raw.includes(Buffer.from('old-file').toString('base64')), false);
});
test('same-length changed attachment bytes after PUT prevent sending or claiming verified sync', async t => {
  const f = workerFixture(t), execute = f.ctx.execute;
  f.ctx.execute = async (...args) => {
    if (f.calls.some(c => c.init.method === 'PUT')) {
      const part = f.draft.message.payload.parts.find(p => p.filename);
      const changed = Buffer.from(f.image); changed[changed.length - 1] ^= 1;
      part.body.data = changed.toString('base64url');
    }
    return execute(...args);
  };
  const before = f.draftReadBack({ draft: f.draft }, f.draft.id);
  const result = await f.handle({ method: 'compose', cindy: { secrets: { gog_access_token: 'fixture-token' } }, params: {
    draftId: f.draft.id, fingerprint: before.fingerprint, fields: { ...f.fields, subject: 'Hello' }, send: true,
  } }, {});
  assert.equal(result.ok, false);
  assert.equal(result.execution, 'executed');
  assert.match(result.message, /附件/);
  assert.equal(f.calls.some(c => /send/.test(c.url)), false);
});
test('attachment read-back downloads server-only bytes and treats missing or changed bytes as saved but unverified', async t => {
  for (const mode of ['matching', 'changed', 'offline']) {
    const f = workerFixture(t), execute = f.ctx.execute, fetch = globalThis.fetch;
    let downloads = 0;
    f.ctx.execute = async (...args) => {
      if (f.calls.some(c => c.init.method === 'PUT')) {
        const part = f.draft.message.payload.parts.find(p => p.filename);
        delete part.body.data;
        part.body.attachmentId = 'stored-part';
      }
      return execute(...args);
    };
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      if (url.endsWith('/attachments/stored-part')) {
        downloads++;
        assert.equal(init.headers.Authorization, 'Bearer fixture-token');
        if (mode === 'offline') throw new Error('offline');
        const data = Buffer.from(f.image);
        if (mode === 'changed') data[data.length - 1] ^= 1;
        return new Response(JSON.stringify({ data: data.toString('base64url') }));
      }
      return fetch(url, init);
    });
    const result = await f.handle({ method: 'run', cindy: { secrets: { gog_access_token: 'fixture-token' } },
      params: { command: ['drafts', 'update'], arguments: ['draft-test'], readOnly: false,
        options: { body: 'Edited', 'body-html': '<p>Edited</p><img src="cid:photo@example.test">' } } }, {});
    assert.equal(downloads, 1);
    assert.equal(result.ok, mode === 'matching', result.message);
    assert.equal(result.execution, 'executed');
    if (mode !== 'matching') assert.match(result.message, /已保存.*未发送/);
    assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
    assert.equal(f.calls.some(c => /send/.test(c.url)), false);
  }
});
test('draft read-back decodes the declared charset before editing either body alternative', t => {
  const f = fixture(t), text = f.draft.message.payload.parts[0], html = f.draft.message.payload.parts[1];
  text.headers = [{ name: 'Content-Type', value: 'text/plain; charset=ISO-8859-1' }];
  text.body.data = Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('base64url');
  html.headers = [{ name: 'Content-Type', value: 'text/html; charset="Shift_JIS"' }];
  html.body.data = Buffer.from([0x3c, 0x70, 0x3e, 0x93, 0xfa, 0x96, 0x7b, 0x3c, 0x2f, 0x70, 0x3e]).toString('base64url');
  const saved = f.draftReadBack({ draft: f.draft }, f.draft.id);
  assert.equal(saved.bodyText, 'café');
  assert.equal(saved.editor.bodyHtml, '<p>日本</p>');
});

// Exercise the actual worker get/update and MIME precondition paths, including
// Gmail's separate-body response; never accept a truncated snapshot (unit).
test('external draft body bytes are loaded before read-back and the second write precondition', async t => {
  const f = workerFixture(t), bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
  f.draft.message.payload.parts[0].headers = [{ name: 'Content-Type', value: 'text/plain; charset=ISO-8859-1' }];
  f.draft.message.payload.parts[0].body = { attachmentId: 'text-body', size: bytes.length };
  assert.throws(() => f.draftReadBack({ draft: f.draft }, f.draft.id), /正文/);
  const fetch = globalThis.fetch; let downloads = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/attachments/text-body')) {
      downloads++;
      assert.equal(init.headers.Authorization, 'Bearer fixture-token');
      return new Response(JSON.stringify({ size: bytes.length, data: bytes.toString('base64url') }));
    }
    return fetch(url, init);
  });
  f.ctx.execute = async () => ({ ok: true, data: { draft: structuredClone(f.draft) } });
  const auth = { secrets: { gog_access_token: 'fixture-token' } };
  const read = await f.handle({ method: 'run', cindy: auth,
    params: { command: ['drafts', 'get'], arguments: [f.draft.id] } }, {});
  const before = read.data.readBack;
  assert.equal(before.bodyText, 'café');
  const fields = { to: 'self@example.test', cc: '', bcc: '', subject: before.headers.subject,
    body: before.editor.body, quote: before.editor.quote, bodyHtml: before.editor.bodyHtml, quoteHtml: before.editor.quoteHtml,
    attachmentItems: JSON.stringify(before.attachments) };
  const result = await f.handle({ method: 'compose', cindy: auth,
    params: { draftId: f.draft.id, fingerprint: before.fingerprint, fields, send: false } }, {});
  assert.equal(result.ok, true, result.message);
  assert.equal(downloads, 3); // get, compose get, direct-API precondition
  assert.equal(result.data.readBack.bodyText, 'café');
  assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
});
test('unreadable external draft bodies prevent updates and preserve successful save receipts', async t => {
  const f = workerFixture(t);
  f.draft.message.payload.parts[1].body = { attachmentId: 'html-body', size: 8 };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ size: 8, data: 'AQI' })));
  const auth = { secrets: { gog_access_token: 'fixture-token' } };
  for (const command of ['get', 'update']) {
    await assert.rejects(f.handle({ method: 'run', cindy: auth,
      params: { command: ['drafts', command], arguments: [f.draft.id], readOnly: false, options: command === 'get' ? {} : { body: 'Replacement' } } }, {}), /正文/);
  }
  assert.equal(f.calls.some(c => c.init.method === 'PUT'), false);
  const receipt = await f.readSavedDraft({ ok: true, data: { draftId: f.draft.id } }, ['drafts', 'create'], 'fixture-token');
  assert.equal(receipt.ok, true); assert.equal(receipt.data.readBack.status, 'unavailable');
  assert.equal(receipt.data.draftId, f.draft.id);
});
test('Host-generated plain alternative preserves authored HTML-only styling, links and CID bytes', async t => {
  const f = workerFixture(t);
  const html = '<div style="color:#123456"><a href="https://example.test">Hello</a><img src="cid:photo@example.test" width="240"></div>';
  f.draft.message.payload.parts[0].body.data = '';
  f.draft.message.payload.parts[1].body.data = Buffer.from(html).toString('base64url');
  const before = f.draftReadBack({ draft: f.draft }, f.draft.id);
  assert.equal(before.editor.format, 'html');
  const fields = { to: before.headers.to, cc: '', bcc: '', subject: before.headers.subject,
    body: 'Hello', quote: '', bodyHtml: html, quoteHtml: '', attachmentItems: JSON.stringify(before.attachments) };
  const result = await f.handle({ method: 'compose', cindy: { secrets: { gog_access_token: 'fixture-token' } },
    params: { draftId: f.draft.id, fingerprint: before.fingerprint, fields, send: false } }, {});
  assert.equal(result.ok, true, result.message);
  assert.equal(result.data.readBack.bodyText, 'Hello');
  assert.equal(result.data.readBack.bodyHtml, html);
  assert.equal(result.data.readBack.attachments[0].sha256, before.attachments[0].sha256);
  assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
  assert.equal(f.calls.some(c => /send/.test(c.url)), false);
});

// One MIME matrix crosses all three adapter walks: external-body hydration,
// draft read-back and file collection before PUT. Container metadata must not
// swallow body parts, while attached messages/containers remain opaque files.
test('inline and CID containers retain external bodies and real attachments through read and PUT', async t => {
  for (const headers of [
    [{ name: 'Content-Disposition', value: 'inline' }],
    [{ name: 'Content-ID', value: '<body@example.test>' }],
  ]) {
    const f = fixture(t), bytes = Buffer.from('<p>Container body</p>');
    const [plain, html, image] = f.draft.message.payload.parts;
    html.body = { attachmentId: 'container-body', size: bytes.length };
    // Even an inline text alternative with CID belongs to the outer body.
    plain.headers = headers;
    const attached = { mimeType: 'message/rfc822', filename: 'mail.eml',
      body: { data: Buffer.from('attached-mail').toString('base64url'), size: 13 },
      parts: [{ mimeType: 'text/html', body: { attachmentId: 'never-load', size: 999 } }] };
    const attachedContainer = { ...attached, filename: '', mimeType: 'multipart/mixed',
      headers: [{ name: 'Content-Disposition', value: 'attachment' }] };
    f.draft.message.payload.parts = [{ mimeType: 'multipart/related', headers, parts: [plain, html, image] }, attached, attachedContainer];
    const fetch = globalThis.fetch; let downloads = 0;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url.includes('never-load'), false);
      if (url.endsWith('/attachments/container-body')) {
        downloads++;
        return new Response(JSON.stringify({ data: bytes.toString('base64url'), size: bytes.length }));
      }
      return fetch(url, init);
    });
    const saved = await f.readDraft({ draft: f.draft }, f.draft.id, 'fixture-token');
    assert.equal(saved.bodyText, 'Original'); assert.equal(saved.bodyHtml, bytes.toString());
    assert.deepEqual(Array.from(saved.attachments, a => a.mimeType), ['image/png', 'message/rfc822', 'multipart/mixed']);
    Object.assign(f.before, saved);
    Object.assign(f.fields, { body: saved.bodyText, bodyHtml: saved.bodyHtml,
      attachmentItems: JSON.stringify(saved.attachments) });
    const result = await f.run();
    assert.equal(result.ok, true); assert.equal(result.files.length, 3);
    assert.equal(downloads, 1);
    const raw = Buffer.from(JSON.parse(f.calls.at(-1).init.body).message.raw, 'base64url').toString();
    assert.ok(raw.includes(bytes.toString('base64')));
    assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
  }
});

// The same opaque-file rule must hold for hydration, editable snapshots and
// saving, including parts without names/CID/disposition and external bytes.
test('unnamed non-body MIME parts preserve their own bytes instead of flattening children', async t => {
  for (const mimeType of ['message/rfc822', 'application/pdf', 'image/png']) for (const external of [false, true]) {
    const f = fixture(t), bytes = Buffer.from('Opaque attached file');
    const attached = { partId: 'opaque', mimeType,
      body: { size: bytes.length, ...(external ? { attachmentId: 'opaque-bytes' } : { data: bytes.toString('base64url') }) },
      parts: [{ mimeType: 'text/plain', body: { attachmentId: 'never-load', size: 999 } }] };
    f.draft.message.payload.parts.push(attached);
    const fetch = globalThis.fetch;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url.includes('never-load'), false);
      if (url.endsWith('/attachments/opaque-bytes')) return new Response(JSON.stringify({ data: bytes.toString('base64url'), size: bytes.length }));
      return fetch(url, init);
    });
    const before = await f.readDraft({ draft: f.draft }, f.draft.id, 'fixture-token');
    assert.equal(before.bodyText, 'Original'); assert.equal(before.attachments.length, 2);
    Object.assign(f.before, before);
    f.fields.attachmentItems = JSON.stringify(before.attachments);
    const result = await f.run();
    assert.equal(result.ok, true); assert.equal(result.files.length, 2);
    const file = result.files.find(file => file.mimeType === mimeType && file.sha256 === createHash('sha256').update(bytes).digest('hex'));
    assert.ok(file, mimeType + ':' + external);
    const raw = Buffer.from(JSON.parse(f.calls.at(-1).init.body).message.raw, 'base64url').toString();
    assert.ok(raw.includes('Content-Type: ' + mimeType)); assert.ok(raw.includes(bytes.toString('base64')));
  }
});

// Reject lossy decode on every editable entry, before any remote save/send.
// Existing ISO-8859-1/Shift_JIS positives prove supported legacy mail still works.
test('unsupported or malformed body encodings cannot produce editable snapshots or writes', async t => {
  for (const mimeType of ['text/plain', 'text/html']) for (const charset of ['x-unknown-charset', '', 'UTF-8', 'Shift_JIS']) {
    const f = workerFixture(t), part = f.draft.message.payload.parts.find(p => p.mimeType === mimeType);
    part.headers = [{ name: 'Content-Type', value: mimeType + '; charset="' + charset + '"' }];
    part.body = { data: Buffer.from([0xff]).toString('base64url'), size: 1 };
    assert.throws(() => f.draftReadBack({ draft: f.draft }, f.draft.id), /字符编码|无损解码/);
    const cindy = { secrets: { gog_access_token: 'fixture-token' } };
    for (const operation of ['get', 'update']) await assert.rejects(f.handle({ method: 'run', cindy,
      params: { command: ['drafts', operation], arguments: [f.draft.id], readOnly: false, options: {} } }, {}), /字符编码|无损解码/);
    for (const send of [false, true]) await assert.rejects(f.handle({ method: 'compose', cindy,
      params: { draftId: f.draft.id, fingerprint: f.before.fingerprint, fields: f.fields, send } }, {}), /字符编码|无损解码/);
    assert.equal(f.calls.some(c => ['PUT', 'POST'].includes(c.init.method)), false);
  }
});

// Exercise the production JSON-RPC dispatcher, not just handle() rejection.
// Both pre-write decoding passes and post-write verification retain safe guidance
// without forwarding a raw exception or weakening the execution receipt.
test('worker JSON-RPC preserves safe encoding guidance across draft entry points', async t => {
  for (const mimeType of ['text/plain', 'text/html']) for (const charset of ['x-unknown-charset', '', 'UTF-8', 'Shift_JIS']) {
    const f = workerFixture(t), part = f.draft.message.payload.parts.find(p => p.mimeType === mimeType);
    part.headers = [{ name: 'Content-Type', value: mimeType + '; charset="' + charset + '"' }];
    part.body = { data: Buffer.from([0xff]).toString('base64url'), size: 1 };
    const cindy = { secrets: { gog_access_token: 'fixture-token' } };
    const requests = ['get', 'update'].map(operation => ({ method: 'run', cindy,
      params: { command: ['drafts', operation], arguments: [f.draft.id], readOnly: false, options: {} } }));
    for (const send of [false, true]) requests.push({ method: 'compose', cindy,
      params: { draftId: f.draft.id, fingerprint: f.before.fingerprint, fields: f.fields, send } });
    for (const message of requests) {
      const result = await f.rpc(message);
      assert.equal(result.ok, false);
      assert.equal(result.execution, 'not_executed');
      assert.match(result.message, /字符编码|无损解码/);
      assert.match(result.message, /请在邮箱中编辑此草稿/);
      assert.doesNotMatch(result.message, /fixture-token|x-unknown-charset|workspace paths/);
    }
    assert.equal(f.calls.some(c => ['PUT', 'POST'].includes(c.init.method)), false);
  }
  // The second GET can change independently after the initial valid snapshot.
  for (const charset of ['x-unknown-charset', 'UTF-8']) {
    const f = workerFixture(t), remote = structuredClone(f.draft);
    remote.message.payload.parts[0].headers = [{ name: 'Content-Type', value: 'text/plain; charset=' + charset }];
    remote.message.payload.parts[0].body = { data: Buffer.from([0xff]).toString('base64url'), size: 1 };
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(init.method === 'PUT' || init.method === 'POST', false);
      return new Response(JSON.stringify(remote));
    });
    const result = await f.rpc({ method: 'compose', cindy: { secrets: { gog_access_token: 'fixture-token' } },
      params: { draftId: f.draft.id, fingerprint: f.before.fingerprint, fields: f.fields, send: true } });
    assert.equal(result.execution, 'not_executed'); // Failed pre-write GET.
    assert.match(result.message, /字符编码|无损解码/);
    assert.match(result.message, /请在邮箱中编辑/);
    assert.doesNotMatch(result.message, /private path|token|raw body|重试/);
  }
  // Once PUT succeeds, a failed read-back must retain the successful receipt
  // and forbid replay rather than claiming the draft was never changed.
  const f = workerFixture(t), fetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const response = await fetch(url, init);
    if (init.method === 'PUT') f.draft.message.payload.parts[0].body.data = Buffer.from([0xff]).toString('base64url');
    return response;
  });
  const result = await f.rpc({ method: 'compose', cindy: { secrets: { gog_access_token: 'fixture-token' } },
    params: { draftId: f.draft.id, fingerprint: f.before.fingerprint, fields: f.fields, send: true } });
  assert.equal(result.execution, 'executed');
  assert.match(result.message, /草稿已保存但未发送.*Gmail.*不要重复/);
  assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
  assert.equal(f.calls.some(c => c.url.endsWith('/send')), false);
});

test('worker JSON-RPC hides unrecognized errors and preserves uncertain command outcomes', async t => {
  for (const entry of ['schema', 'execute']) for (const code of ['DRAFT_BODY_DECODE', 'DRAFT_BODY_CHARSET', 'UNRECOGNIZED', 'toString']) for (const started of [false, true]) {
    const f = workerFixture(t);
    f.ctx[entry] = async () => { throw Object.assign(new Error('private path / fixture-token / raw body'), { code }); };
    // Simulate a command that failed before/after launch at the actual outlet.
    const handle = f.ctx.handle;
    f.ctx.handle = (message, state) => { state.started = started; return handle(message, state); };
    const result = await f.rpc({ method: 'run', cindy: { secrets: { gog_access_token: 'fixture-token' } },
      params: { command: ['drafts', 'get'], arguments: [f.draft.id] } });
    assert.equal(result.execution, started ? 'unknown' : 'not_executed');
    assert.doesNotMatch(result.message, /private path|fixture-token|raw body/);
    if (code.startsWith('DRAFT_BODY_')) assert.match(result.message, /请在邮箱中编辑此草稿/);
    else assert.match(result.message, /check its schema and workspace paths/);
  }
});

// Same CID interpretation for retention, validation and initial inline creation.
test('AI attachment replacement retains CID scheme variants and percent-encoded identifiers', async t => {
  for (const reference of ['CID:photo@example.test', 'CiD:photo%40example.test']) {
    const f = workerFixture(t), file = path.join(f.dir, 'new.pdf');
    fs.writeFileSync(file, 'new-file');
    f.draft.message.payload.parts[1].body.data = Buffer.from('<img src="' + reference + '">').toString('base64url');
    const result = await f.handle({ method: 'run', cindy: { secrets: { gog_access_token: 'fixture-token' } },
      params: { command: ['drafts', 'update'], arguments: [f.draft.id], workdir: f.dir, readOnly: false, options: { attach: ['new.pdf'] } } }, {});
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(Array.from(result.data.readBack.attachments, a => a.filename), ['图.png', 'new.pdf']);
    const raw = Buffer.from(JSON.parse(f.calls.find(c => c.init.method === 'PUT').init.body).message.raw, 'base64url').toString();
    assert.ok(raw.includes('Content-ID: <photo@example.test>'));
    assert.ok(raw.includes(f.image.toString('base64')));
  }
});
test('CID validation rejects missing variants, case-mismatched IDs and malformed escapes before PUT', async t => {
  for (const reference of ['CID:missing@example.test', 'CiD:Photo@example.test', 'cid:photo%ZZexample.test']) {
    const f = fixture(t);
    f.fields.bodyHtml = '<img src="' + reference + '">';
    await assert.rejects(f.run(), /图片/);
    assert.equal(f.calls.some(c => c.init.method === 'PUT'), false, reference);
  }
});
test('inline creation and CSS references use the same CID normalization', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'photo.png'), f.image);
  const html = '<div style="background-image:url(CID:img1%40cindy.local)">Photo</div>';
  const raw = f.ctx.buildInlineMessage({ from: 'self@example.test', to: 'person@example.test', subject: 'Photo', body: 'Photo',
    'body-html': html, 'inline-images': [{ path: 'photo.png', hash: createHash('sha256').update(f.image).digest('hex') }] }, f.dir, true);
  assert.ok(raw.includes('Content-ID: <img1@cindy.local>'));
  assert.ok(raw.includes(f.image.toString('base64')));
  f.fields.bodyHtml = '<div style="background-image:url(CID:photo%40example.test)">Photo</div>';
  assert.equal((await f.run()).ok, true);
});

// Cross the real save/create boundary: literal CID examples must neither block
// an ordinary edit nor count as a reference authorizing an inline attachment.
test('CID examples in text, comments and non-URL fields do not block saving or satisfy inline creation', async t => {
  const f = fixture(t);
  const examples = '<p>CID:12345 and cid:bad%ZZ</p><!-- <img src="cid:hidden"> -->'
    + '<code>&lt;img src="cid:example"&gt;</code><div title="cid:title > src=cid:fake" data-example="cid:data">Text</div>'
    + '<textarea><img src="cid:textarea"></textarea><script>"<img src=cid:script>"</script>'
    + '<style>/* url(cid:comment) */ .x::after { content:"url(cid:content)" }</style>'
    + '<img srcset="data:image/svg+xml,cid:bad%ZZ 1x">';
  f.fields.bodyHtml = examples; f.fields.attachmentItems = '[]';
  assert.equal((await f.run()).ok, true);
  assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
  fs.writeFileSync(path.join(f.dir, 'photo.png'), f.image);
  assert.throws(() => f.ctx.buildInlineMessage({ from: 'self@example.test', to: 'person@example.test', subject: 'Example', body: 'Example',
    'body-html': examples + '<p>cid:img1@cindy.local</p>',
    'inline-images': [{ path: 'photo.png', hash: createHash('sha256').update(f.image).digest('hex') }] }, f.dir, true), /must reference/);
});
test('all supported URL locations retain inline bytes while attachment lists are replaced', async t => {
  for (const markup of ['<img SRC="CiD:photo%40example.test">', "<img src='cid:photo@example.test'>",
    '<table background=cid:photo@example.test>', '<img srcset="https://example.test/normal.png 1x, CID:photo%40example.test 2x">',
    '<img srcset="data:image/png;base64,YQ== 1x, CID:photo%40example.test 2x">',
    '<div title="a > b" style="background:url(&quot;cid:photo&#64;example.test&quot;)">Photo</div>',
    '<style>.photo{background:url(\'CID:photo@example.test\')}</style>', '<a href="cid:photo@example.test">Photo</a>']) {
    const f = workerFixture(t), file = path.join(f.dir, 'new.pdf');
    fs.writeFileSync(file, 'new-file');
    f.draft.message.payload.parts[1].body.data = Buffer.from(markup).toString('base64url');
    const result = await f.handle({ method: 'run', cindy: { secrets: { gog_access_token: 'fixture-token' } },
      params: { command: ['drafts', 'update'], arguments: [f.draft.id], workdir: f.dir, readOnly: false, options: { attach: ['new.pdf'] } } }, {});
    assert.equal(result.ok, true, markup + ': ' + result.message);
    assert.deepEqual(Array.from(result.data.readBack.attachments, a => a.filename), ['图.png', 'new.pdf']);
    assert.equal(result.data.readBack.bodyHtml, markup);
    const raw = Buffer.from(JSON.parse(f.calls.find(c => c.init.method === 'PUT').init.body).message.raw, 'base64url').toString();
    assert.ok(raw.includes(f.image.toString('base64')));
  }
});
