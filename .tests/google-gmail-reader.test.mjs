import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
const source = readFileSync(new URL('../google-gmail/main.js', import.meta.url), 'utf8');
function fixture(accounts = [{ id: 'a', email: 'a@example.com', status: 'connected' }], locale = 'zh-CN') {
  const calls = [];
  let handler;
  const part = (type, text) => ({ mimeType: type, body: { data: Buffer.from(text).toString('base64url') } });
  const msg = { id: '12345678', payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: '中文主题' }, { name: 'From', value: 'sender@example.com' }], parts: [part('text/plain', '中文'), part('text/html', '<p>中文</p><img src="cid:photo">'),
    { partId: '2', mimeType: 'message/rfc822', filename: 'forward.eml', body: {}, parts: [part('text/plain', 'Do not append me')] },
    { partId: '3', mimeType: 'image/png', filename: 'image.png', headers: [{ name: 'Content-ID', value: '<photo>' }], body: { data: 'AQID', size: 3 } } ] } };
  const ctx = createContext({ URL, TextDecoder, Uint8Array, atob, cindy: { onHostMessage(fn) { handler = fn; },
    fetch: async r => { calls.push(r); return { ok: true, status: 200, body: JSON.stringify(msg) }; },
    send: async r => { assert.equal(r.kind, 'deposit_media'); return { ok: true, url: 'cindy-media://blobs/' + 'a'.repeat(64) + '.png' }; },
  }});
  runInContext(source, ctx);
  // The Chinese assertions describe the zh-CN copy; the Host announces it.
  void handler({ type: 'host-context-changed', context: { locale } });
  ctx.listAccounts = async () => ({ ok: true, result: { accounts } });
  const lookupPhotos = ctx.lookupMailParticipantPhotos;
  // Most tests isolate MIME/mark-read behavior from optional People enrichment.
  ctx.lookupMailParticipantPhotos = async () => [];
  return { ctx, calls, msg, lookupPhotos, invoke: message => handler(message), read: (url, options = {}) => ctx.readMailMessageLink({ url, ...options }) };
}
// Native-reader integration: only an exact email can supply a real photo. New
// permission failures remain optional and account caches must never cross mailboxes.
test('reader enriches exact participants, ignores defaults and caches within the selected account', async () => {
  const f = fixture([{ id: 'a', email: 'a@example.test', status: 'connected' }, { id: 'b', email: 'b@example.test', status: 'connected' }]);
  f.ctx.lookupMailParticipantPhotos = f.lookupPhotos;
  f.msg.payload.headers.push({ name: 'To', value: '"Quoted, Name" <recipient@example.test>' });
  const photo = 'https://lh3.googleusercontent.com/contact-photo';
  const people = [];
  f.ctx.cindy.fetch = async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'people.googleapis.com') return { ok: true, status: 200, body: JSON.stringify(f.msg) };
    people.push(request);
    const email = url.searchParams.get('query');
    const results = email === 'sender@example.com' ? [
      { person: { emailAddresses: [{ value: 'sender@example.com.extra' }], photos: [{ url: 'https://lh3.googleusercontent.com/wrong-person' }] } },
      { person: { emailAddresses: [{ value: 'SENDER@example.com' }], photos: [{ url: photo, default: true }, { url: 'https://tracker.example.test/photo' }, { url: photo }] } },
    ] : [];
    return { ok: true, status: 200, body: JSON.stringify({ results }) };
  };
  const url = 'https://mail.google.com/mail/#all/12345678';
  const result = await f.read(url, { account: 'a' });
  assert.deepEqual(JSON.parse(JSON.stringify(result.participantPhotos)), [{ email: 'sender@example.com', url: photo }]);
  assert.equal(people.length, 3, 'one warmup and two unique participants');
  assert.ok(people.every(r => r.authAccount === 'a' && r.timeoutMs <= 1000 && !r.method));
  await f.read(url, { account: 'a' });
  assert.equal(people.length, 3, 'same-account repeated read uses bounded memory cache');
  await f.read(url, { account: 'b' });
  assert.equal(people.length, 6);
  assert.ok(people.slice(3).every(r => r.authAccount === 'b'));
});
test('reader remains usable without contact permission or during a photo lookup failure', async () => {
  for (const mode of ['denied', 'timeout', 'malformed']) {
    const f = fixture(); f.ctx.lookupMailParticipantPhotos = f.lookupPhotos;
    f.ctx.cindy.fetch = async request => {
      if (!request.url.startsWith('https://people.googleapis.com/')) return { ok: true, status: 200, body: JSON.stringify(f.msg) };
      if (mode === 'timeout') throw new Error('timeout');
      return { ok: mode !== 'denied', status: mode === 'denied' ? 403 : 200, body: 'invalid' };
    };
    const result = await f.read('https://mail.google.com/mail/#all/12345678');
    assert.equal(result.bodyText, '中文');
    assert.equal(result.participantPhotos, undefined);
  }
});
// Tool-result transport is downstream of Gmail writes. A failed delivery must
// retain the same receipt across card, worker and mark-read paths, without replay.
test('result delivery failure preserves card and worker execution receipts', async () => {
  for (const operation of ['get', 'send', 'update', 'delete', 'worker']) {
    for (const execution of ['executed', 'unknown', 'not_executed']) {
      const f = fixture(), replies = [];
      let operations = 0, deliveries = 0;
      const run = async () => { operations++; return { ok: execution === 'executed', execution, data: { saved: true }, message: 'Fixture outcome' }; };
      f.ctx.gmailCompose = { beforeTool: run, resolveDraft: async () => ({}) };
      f.ctx.cindyMail = { sendGraceMs: 10000 };
      f.ctx.cindy.node = { request: async () => ({ ok: true, result: await run() }) };
      f.ctx.cindy.send = async reply => {
        if (++deliveries === 1) throw new Error('result transport unavailable');
        replies.push(reply);
      };
      await f.invoke({ type: 'tool-call', tool: 'gmail_run', callId: 'receipt-test', args: {
        command: operation === 'worker' ? ['search'] : ['drafts', operation], arguments: ['12345678'],
        session_context: { workdir_is_read_only: false },
      } });
      assert.equal(operations, 1, operation + ':' + execution);
      assert.equal(deliveries, 2);
      assert.equal(replies[0].ok, false);
      assert.ok(replies[0].message.startsWith('[' + execution + ']'), operation + ':' + replies[0].message);
      if (execution !== 'not_executed') assert.match(replies[0].message, /核对.*不要重复/);
    }
  }
});
test('result delivery after mark-read retains its receipt without repeating the write', async () => {
  for (const status of [200, 403, 503, 'timeout', 'no-write']) {
    const f = fixture(), replies = [];
    let writes = 0, deliveries = 0;
    f.msg.labelIds = ['UNREAD'];
    f.ctx.cindy.fetch = async request => {
      if (request.method === 'POST') {
        writes++;
        if (status === 'timeout') throw new Error('response lost');
        return { ok: status === 200, status };
      }
      return { ok: true, status: 200, body: JSON.stringify(f.msg) };
    };
    f.ctx.cindy.send = async reply => {
      if (reply.type !== 'tool-result') return { ok: true };
      if (++deliveries === 1) throw new Error('result transport unavailable');
      replies.push(reply);
    };
    await f.invoke({ type: 'tool-call', tool: 'gmail_read_message', callId: 'read-receipt-test',
      args: { url: 'https://mail.google.com/mail/#all/12345678', markRead: status !== 'no-write' } });
    const expected = status === 200 ? 'executed' : [403, 'no-write'].includes(status) ? 'not_executed' : 'unknown';
    assert.ok(replies[0].message.startsWith('[' + expected + ']'), status + ':' + replies[0].message);
    assert.equal(writes, status === 'no-write' ? 0 : 1);
    assert.equal(deliveries, 2);
  }
});
test('continuing after card autosave cannot erase an earlier uncertain write', async () => {
  for (const resultDeliveryFails of [false, true]) {
    const f = fixture(), replies = [];
    let preparations = 0, requests = 0, deliveries = 0;
    f.ctx.gmailCompose = { beforeTool: async () => { preparations++; return null; }, resolveDraft: async () => ({}) };
    f.ctx.cindy.node = { request: async () => {
      requests++;
      return { ok: true, result: { ok: false, execution: 'not_executed', message: 'Command rejected' } };
    } };
    f.ctx.cindy.send = async reply => {
      if (++deliveries === 1 && resultDeliveryFails) throw new Error('result transport unavailable');
      replies.push(reply);
    };
    await f.invoke({ type: 'tool-call', tool: 'gmail_run', callId: 'autosave-receipt-test', args: {
      command: ['drafts', 'update'], arguments: ['12345678'], session_context: { workdir_is_read_only: false },
    } });
    assert.equal(preparations, 1); assert.equal(requests, 1);
    assert.match(replies[0].message, /^\[unknown\]/);
  }
});
// Cross managed/unmanaged and writable/read-only preparation with rejection
// and result-transport failure. Only a writable, managed card can have autosaved.
test('side-effect-free draft preparation preserves actionable worker rejections', async () => {
  for (const managed of [false, true]) for (const readOnly of [false, true])
    for (const operation of ['get', 'update', 'delete']) for (const deliveryFails of [false, true]) {
      const f = fixture(), replies = [];
      let preparations = 0, deliveries = 0;
      f.ctx.gmailCompose = { resolveDraft: async () => managed ? {} : null,
        beforeTool: async () => { preparations++; return null; } };
      f.ctx.cindy.node = { request: async () => ({ ok: true, result: {
        ok: false, execution: 'not_executed', message: 'Missing bundled executable; reinstall plugin',
      } }) };
      f.ctx.cindy.send = async reply => {
        if (++deliveries === 1 && deliveryFails) throw new Error('delivery failed');
        replies.push(reply);
      };
      await f.invoke({ type: 'tool-call', tool: 'gmail_run', callId: 'read-only-receipt', args: {
        command: ['drafts', operation], arguments: ['12345678'], session_context: { workdir_is_read_only: readOnly },
      } });
      const uncertain = managed && !readOnly;
      assert.equal(preparations, managed ? 1 : 0);
      assert.match(replies[0].message, uncertain ? /^\[unknown\]/ : /^\[not_executed\]/);
      if (!uncertain && !deliveryFails) assert.match(replies[0].message, /reinstall plugin/);
    }
});
test('message, fallback conversation and external body authorization failures explain how to reconnect', async () => {
  for (const stage of ['message', 'conversation', 'body']) for (const status of [401, 403]) {
    const f = fixture();
    f.msg.payload.parts[0].body = { attachmentId: 'body', size: 3 };
    f.ctx.cindy.fetch = async request => {
      f.calls.push(request);
      if (stage === 'message' || request.url.includes('/threads/') || request.url.includes('/attachments/'))
        return { ok: false, status, body: '{}' };
      if (stage === 'conversation') return { ok: false, status: 404 };
      return { ok: true, status: 200, body: JSON.stringify(f.msg) };
    };
    await assert.rejects(f.read('https://mail.google.com/mail/#all/12345678'),
      status === 401 ? /授权.*失效.*插件详情页.*重新连接/ : /读取权限.*插件详情页.*重新连接/);
    assert.ok(f.calls.every(request => !request.method), 'authorization failure never marks read');
    assert.equal(f.calls.length, stage === 'message' ? 1 : 2);
  }
});
test('resolves a conversation link when the original draft message no longer exists', async () => {
  const f = fixture(), urls = [];
  f.ctx.cindy.fetch = async r => {
    urls.push(r.url); assert.equal(r.authAccount, 'a');
    if (urls.length === 1) return { ok: false, status: 404, body: '{}' };
    if (urls.length === 2) return { ok: true, status: 200, body: JSON.stringify({ messages: [
      { id: 'abcdef01', internalDate: '200', labelIds: ['SENT'] },
      { id: 'abcdef02', internalDate: '100', labelIds: ['INBOX'] },
      { id: 'abcdef03', internalDate: '300', labelIds: ['DRAFT'] },
    ] }) };
    return { ok: true, status: 200, body: JSON.stringify({ ...f.msg, id: 'abcdef01' }) };
  };
  const mail = await f.read('https://mail.google.com/mail/?authuser=a@example.com#all/12345678');
  assert.equal(mail.messageId, 'abcdef01'); assert.match(mail.bodyHtml, /cid:photo/);
  assert.deepEqual(urls, [
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/12345678?format=full',
    'https://gmail.googleapis.com/gmail/v1/users/me/threads/12345678?format=metadata',
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/abcdef01?format=full',
  ]);
});
test('does not reinterpret explicit message links or retry authorization failures as conversations', async () => {
  for (const [status, url] of [[401, 'https://mail.google.com/mail/#all/12345678'], [404, 'https://mail.google.com/mail/?permmsgid=12345678']]) {
    const f = fixture(); let calls = 0;
    f.ctx.cindy.fetch = async () => { calls++; return { ok: false, status, body: '{}' }; };
    await assert.rejects(f.read(url)); assert.equal(calls, 1);
  }
});
test('native reader preserves HTML/CID and UTF-8, excludes attached mail body, only reads Gmail', async () => {
  const f = fixture(), m = await f.read('https://mail.google.com/mail/?authuser=a@example.com#all/12345678');
  assert.equal(m.bodyText, '中文'); assert.match(m.bodyHtml, /cid:photo/);
  assert.equal(m.subject, '中文主题'); assert.equal(m.attachments.length, 2);
  assert.match(m.attachments[1].previewUrl, /^cindy-media:/);
  assert.equal(m.attachments[1].inlineData, undefined);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].authAccount, 'a');
  assert.equal(f.calls[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/12345678?format=full');
  assert.equal(f.calls[0].method, undefined);
});
// Reader regressions: MIME encodings belong to each body part; a failed image
// deposit must not discard a successfully fetched body (unit, synthetic bytes).
test('native reader decodes each declared body charset, including legacy encodings', async () => {
  const f = fixture();
  const text = f.msg.payload.parts[0], html = f.msg.payload.parts[1];
  text.headers = [{ name: 'Content-Type', value: 'text/plain; charset="ISO-8859-1"' }];
  text.body.data = Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('base64url');
  html.headers = [{ name: 'Content-Type', value: "text/html; charset='Shift_JIS'" }];
  html.body.data = Buffer.from([0x3c, 0x70, 0x3e, 0x93, 0xfa, 0x96, 0x7b, 0x3c, 0x2f, 0x70, 0x3e]).toString('base64url');
  const mail = await f.read('https://mail.google.com/mail/#all/12345678');
  assert.equal(mail.bodyText, 'café');
  assert.equal(mail.bodyHtml, '<p>日本</p>');
});
test('one failed inline image deposit preserves body, conversation and other previews', async () => {
  const f = fixture();
  f.msg.threadId = 'abcdef00';
  f.msg.messages = [{ id: f.msg.id }];
  const image = f.msg.payload.parts.at(-1);
  f.msg.payload.parts.push({ ...image, partId: '4', filename: 'other.png' });
  let deposits = 0;
  f.ctx.cindy.send = async () => {
    if (++deposits === 1) throw new Error('media unavailable');
    return { ok: true, url: 'cindy-media://blobs/' + 'b'.repeat(64) + '.png' };
  };
  const mail = await f.read('https://mail.google.com/mail/#all/12345678');
  assert.equal(mail.bodyText, '中文');
  assert.equal(mail.conversation.messages.length, 1);
  assert.equal(mail.attachments[1].previewUrl, undefined);
  assert.match(mail.attachments[2].previewUrl, /^cindy-media:/);
  assert.equal(deposits, 2);
});
test('reader prefers inline image bytes over a download id and deposits them only once', async () => {
  const f = fixture(), deposits = [];
  f.msg.payload.parts.at(-1).body.attachmentId = 'also-downloadable';
  f.ctx.cindy.send = async r => { deposits.push(r); return { ok: true, url: 'cindy-media://blobs/' + 'b'.repeat(64) + '.png' }; };
  const mail = await f.read('https://mail.google.com/mail/#all/12345678');
  assert.equal(deposits.length, 1);
  assert.deepEqual(Buffer.from(deposits[0].data, 'base64'), Buffer.from([1, 2, 3]));
  assert.match(mail.attachments[1].previewUrl, /^cindy-media:/);
  assert.equal(f.calls.length, 1);
});
test('inline and downloaded preview bytes share size and encoding checks without hiding the body', async () => {
  for (const storage of ['inline', 'download']) for (const bad of ['size', 'encoding', 'limit']) {
    const f = fixture(), file = f.msg.payload.parts.at(-1), deposits = [];
    const data = bad === 'encoding' ? '@@@@' : 'AQID';
    file.body = { size: bad === 'size' ? 4 : bad === 'limit' ? 16 * 1024 * 1024 + 1 : 3,
      ...(storage === 'inline' ? { data } : { attachmentId: 'image-part' }) };
    f.ctx.cindy.fetch = async r => { f.calls.push(r); return { ok: true, status: 200,
      body: JSON.stringify(r.url.includes('/attachments/') ? { data } : f.msg) }; };
    f.ctx.cindy.send = async r => { deposits.push(r); return { ok: true, url: 'cindy-media://blobs/' + 'b'.repeat(64) + '.png' }; };
    const mail = await f.read('https://mail.google.com/mail/#all/12345678');
    assert.equal(mail.bodyText, '中文');
    assert.equal(mail.attachments[1].previewUrl, undefined, storage + ':' + bad);
    assert.equal(mail.attachments[1].inlineData, undefined);
    assert.equal(deposits.length, 0, storage + ':' + bad);
  }
});
test('ambiguous accounts and foreign URLs never trigger mailbox requests', async () => {
  const f = fixture([{ id: 'a', email: 'a@example.com', status: 'connected' }, { id: 'b', email: 'b@example.com', status: 'connected' }]);
  for (const url of ['https://evil.com/mail/#all/12345678', 'https://mail.google.com.evil.com/mail/#all/12345678', 'https://mail.google.com/mail/#all/12345678', 'https://mail.google.com/mail/?authuser=missing@example.com#all/12345678'])
    await assert.rejects(f.read(url));
  assert.equal(f.calls.length, 0);
  assert.equal((await f.read('https://mail.google.com/mail/?authuser=b@example.com#all/12345678')).accountId, 'b');
});

test('explicit account must match the link account before any read or mark-read request', async () => {
  const f = fixture([{ id: 'a', email: 'a@example.test', status: 'connected' }, { id: 'b', email: 'b@example.test', status: 'connected' }]);
  f.msg.labelIds = ['UNREAD'];
  for (const markRead of [false, true]) {
    for (const account of ['b', 'missing']) {
      await assert.rejects(f.read('https://mail.google.com/mail/?authuser=a%40example.test#all/12345678', { account, markRead }), /账号不一致/);
    }
    await assert.rejects(f.read('https://mail.google.com/mail/?authuser=missing%40example.test#all/12345678', { account: 'a', markRead }));
  }
  assert.equal(f.calls.length, 0);
  const mail = await f.read('https://mail.google.com/mail/?authuser=A%40EXAMPLE.TEST#all/12345678', { account: 'a', markRead: true });
  assert.equal(mail.accountId, 'a');
  assert.ok(f.calls.some(r => r.method === 'POST'));
  assert.ok(f.calls.every(r => r.authAccount === 'a'));
});

// Conversation support: one selected body + chronological metadata, never eagerly read other bodies.
test('keeps the selected mail and exposes account-bound links for the whole conversation', async () => {
  const f = fixture(), calls = [];
  const members = ['abcdef03', '12345678', 'abcdef01'].map((id, i) => ({
    id, internalDate: String(300 - i * 100), snippet: 'Snippet ' + id,
    payload: { headers: [{ name: 'From', value: id + '@example.test' }] },
  }));
  f.ctx.cindy.fetch = async r => {
    calls.push(r); assert.equal(r.authAccount, 'a');
    return { ok: true, status: 200, body: JSON.stringify(r.url.includes('/threads/')
      ? { id: 'abcdef00', messages: [...members, { id: 'abcdef04', labelIds: ['DRAFT'] }] }
      : { ...f.msg, threadId: 'abcdef00' }) };
  };
  const mail = await f.read('https://mail.google.com/mail/?authuser=a@example.com#all/12345678');
  assert.equal(mail.messageId, '12345678');
  assert.deepEqual(Array.from(mail.conversation.messages, m => m.messageId), ['abcdef01', '12345678', 'abcdef03']);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /threads\/abcdef00\?format=metadata$/);
  for (const member of mail.conversation.messages) {
    const url = new URL(member.url);
    assert.equal(url.searchParams.get('authuser'), 'a@example.com');
    assert.equal(url.searchParams.get('permmsgid'), member.messageId);
  }
});
test('a conversation failure retains the selected body and reports incomplete history', async () => {
  const f = fixture();
  f.ctx.cindy.fetch = async r => r.url.includes('/threads/')
    ? { ok: false, status: 503, body: '{}' }
    : { ok: true, status: 200, body: JSON.stringify({ ...f.msg, threadId: 'abcdef00' }) };
  const mail = await f.read('https://mail.google.com/mail/#all/12345678');
  assert.equal(mail.bodyText, '中文');
  assert.equal(mail.conversationUnavailable, true);
  assert.equal(mail.conversation, undefined);
});

// User opening is the only automatic write. Exercise the real adapter to ensure
// background reads never remove UNREAD, and failure never hides readable mail.
test('marks only the selected unread message in its resolved account on explicit opening', async () => {
  const f = fixture(); f.msg.labelIds = ['INBOX', 'UNREAD'];
  await f.read('https://mail.google.com/mail/#all/12345678');
  assert.equal(f.calls.filter(r => r.method === 'POST').length, 0);
  await f.read('https://mail.google.com/mail/#all/12345678', { markRead: true });
  const writes = f.calls.filter(r => r.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/12345678/modify');
  assert.equal(writes[0].authAccount, 'a');
  assert.deepEqual(JSON.parse(writes[0].body), { removeLabelIds: ['UNREAD'] });
  for (const labels of [['INBOX'], ['DRAFT', 'UNREAD']]) {
    f.msg.labelIds = labels;
    await f.read('https://mail.google.com/mail/#all/12345678', { markRead: true });
  }
  assert.equal(f.calls.filter(r => r.method === 'POST').length, 1);
});
test('mark-read results distinguish rejection from unknown and confirmed writes without retrying', async () => {
  for (const status of [200, 400, 401, 403, 404, 429, 500, 503, 0, 'timeout']) {
    const f = fixture(); let writes = 0;
    f.ctx.cindy.fetch = async r => {
      if (r.method === 'POST') { writes++; if (status === 'timeout') throw new Error('response lost after write'); return { ok: status === 200, status, truncated: true }; }
      return { ok: true, status: 200, body: JSON.stringify({ ...f.msg, labelIds: ['UNREAD'] }) };
    };
    const mail = await f.read('https://mail.google.com/mail/#all/12345678', { markRead: true });
    const expected = status === 200 ? 'executed' : typeof status === 'number' && status >= 400 && status < 500 ? 'not_executed' : 'unknown';
    assert.equal(mail.bodyText, '中文'); assert.equal(writes, 1);
    assert.equal(mail.markReadResult.execution, expected);
    assert.equal(mail.markReadFailed, expected === 'not_executed' ? true : undefined);
    if (expected === 'unknown') assert.match(mail.markReadResult.message, /核对.*不要盲目重试/);
  }
});

test('reader traverses inline and CID body containers while keeping attached messages opaque', async () => {
  for (const headers of [
    [{ name: 'Content-Disposition', value: 'inline' }],
    [{ name: 'Content-ID', value: '<body@example.test>' }],
  ]) {
    const f = fixture();
    const [plain, html, attached, image] = f.msg.payload.parts;
    delete attached.filename; // MIME alone identifies an opaque attached message.
    plain.headers = headers;
    html.body = { attachmentId: 'html-body', size: 10 };
    f.msg.payload.parts = [{ mimeType: 'multipart/related', headers, parts: [plain, html, image] }, attached];
    const fetch = f.ctx.cindy.fetch;
    f.ctx.cindy.fetch = async r => r.url.endsWith('/attachments/html-body')
      ? { ok: true, status: 200, body: JSON.stringify({ data: Buffer.from('<p>new</p>').toString('base64url'), size: 10 }) }
      : fetch(r);
    const mail = await f.read('https://mail.google.com/mail/#all/12345678');
    assert.equal(mail.bodyText, '中文'); assert.equal(mail.bodyHtml, '<p>new</p>');
    assert.deepEqual(Array.from(mail.attachments, a => a.mimeType), ['image/png', 'message/rfc822']);
  }
});
test('an explicit conversation opening marks the resolved member, never the thread or replaced draft', async () => {
  const f = fixture(), writes = [];
  f.ctx.cindy.fetch = async r => {
    if (r.method === 'POST') { writes.push(r); return { ok: true, status: 200 }; }
    if (r.url.includes('/messages/12345678')) return { ok: false, status: 404 };
    if (r.url.includes('/threads/')) return { ok: true, status: 200, body: JSON.stringify({ messages: [{ id: 'abcdef01', internalDate: '200', labelIds: ['UNREAD'] }] }) };
    return { ok: true, status: 200, body: JSON.stringify({ ...f.msg, id: 'abcdef01', labelIds: ['UNREAD'] }) };
  };
  await f.read('https://mail.google.com/mail/#all/12345678', { markRead: true });
  assert.equal(writes.length, 1); assert.match(writes[0].url, /messages\/abcdef01\/modify$/);
});

// Gmail's attachment endpoint also holds text MIME parts. Load both alternatives
// with their own charsets before returning a message or marking it read (unit).
test('external text bodies are decoded before mark-read without becoming attachments', async () => {
  const f = fixture(), encoded = [Buffer.from([0x63, 0x61, 0x66, 0xe9]), Buffer.from('<p>正文</p>')];
  f.msg.labelIds = ['UNREAD'];
  f.msg.payload.parts.slice(0, 2).forEach((part, index) => {
    part.body = { data: '', attachmentId: 'body-' + index, size: encoded[index].length };
    part.headers = [{ name: 'Content-Type', value: part.mimeType + '; charset=' + (index ? 'UTF-8' : 'ISO-8859-1') }];
  });
  const fetch = f.ctx.cindy.fetch;
  f.ctx.cindy.fetch = async r => {
    if (!r.url.includes('/attachments/')) return fetch(r);
    f.calls.push(r);
    assert.equal(r.authAccount, 'a');
    const bytes = encoded[Number(r.url.at(-1))];
    return { ok: true, status: 200, body: JSON.stringify({ data: bytes.toString('base64url'), size: bytes.length }) };
  };
  const mail = await f.read('https://mail.google.com/mail/#all/12345678', { markRead: true });
  assert.equal(mail.bodyText, 'café'); assert.equal(mail.bodyHtml, '<p>正文</p>');
  assert.equal(mail.attachments.length, 2);
  assert.equal(f.calls.filter(r => r.url.includes('/attachments/')).length, 2);
  assert.equal(f.calls.at(-1).method, 'POST');
});
test('external body failures never return partial mail or mark it read', async () => {
  for (const mode of ['http', 'truncated', 'wrong-size', 'oversized']) {
    const f = fixture(); f.msg.labelIds = ['UNREAD'];
    f.msg.payload.parts[1].body = { attachmentId: 'html-body', size: mode === 'oversized' ? 26 * 1024 * 1024 : 3 };
    const fetch = f.ctx.cindy.fetch;
    f.ctx.cindy.fetch = async r => {
      if (!r.url.includes('/attachments/')) return fetch(r);
      f.calls.push(r);
      return { ok: mode !== 'http', status: mode === 'http' ? 403 : 200, truncated: mode === 'truncated',
        body: JSON.stringify({ data: 'AQI', size: 3 }) };
    };
    await assert.rejects(f.read('https://mail.google.com/mail/#all/12345678', { markRead: true }));
    assert.equal(f.calls.some(r => r.method === 'POST'), false);
    assert.equal(f.calls.filter(r => r.url.includes('/attachments/')).length, mode === 'oversized' ? 0 : 1);
  }
});

// Exercise the actual tool boundary: parser errors must not echo provider data.
test('reader JSON and body decoding failures return fixed guidance before marking read', async () => {
  for (const stage of ['message', 'thread-fallback', 'external-body', 'inline-body']) {
    const f = fixture(), replies = [], secret = 'PRIVATE_MAIL_FRAGMENT';
    f.msg.labelIds = ['UNREAD'];
    if (stage === 'external-body') f.msg.payload.parts[1].body = { attachmentId: 'html-body', size: 3 };
    if (stage === 'inline-body') f.msg.payload.parts[1].body.data = '*' + secret;
    const fetch = f.ctx.cindy.fetch;
    f.ctx.cindy.fetch = async r => {
      f.calls.push(r);
      if (stage === 'thread-fallback' && r.url.includes('/messages/')) return { ok: false, status: 404 };
      if (stage === 'message' || stage === 'thread-fallback' || (stage === 'external-body' && r.url.includes('/attachments/')))
        return { ok: true, status: 200, body: '{"' + secret + '":' };
      return fetch(r);
    };
    f.ctx.cindy.send = async reply => { replies.push(reply); };
    await f.invoke({ type: 'tool-call', tool: 'gmail_read_message', callId: 'parse-test',
      args: { url: 'https://mail.google.com/mail/#all/12345678', markRead: true } });
    assert.equal(replies.length, 1, stage);
    assert.equal(replies[0].ok, false, stage);
    assert.match(replies[0].message, /无法解析.*请.*重新打开/, stage);
    assert.equal(JSON.stringify(replies).includes(secret), false, stage);
    assert.equal(f.calls.some(r => r.method === 'POST'), false, stage);
  }
});
test('malformed optional conversation and image JSON only omit optional presentation', async () => {
  const f = fixture(); f.msg.threadId = 'abcdef01';
  const image = f.msg.payload.parts.at(-1);
  image.body = { attachmentId: 'image-bytes', size: 3 };
  const fetch = f.ctx.cindy.fetch;
  f.ctx.cindy.fetch = async r => /\/(threads|attachments)\//.test(r.url)
    ? { ok: true, status: 200, body: '{"PRIVATE_MAIL_FRAGMENT":' } : fetch(r);
  const mail = await f.read('https://mail.google.com/mail/#all/12345678');
  assert.equal(mail.bodyText, '中文');
  assert.equal(mail.conversationUnavailable, true);
  assert.equal(mail.attachments.at(-1).previewUrl, undefined);
  assert.equal(JSON.stringify(mail).includes('PRIVATE_MAIL_FRAGMENT'), false);
});
