// Outlook adapter for Cindy's shared mail flow (cindyMail v1) and native reader.
// A fake Graph mailbox stands in for Microsoft; the SDK is the repository's
// contract snapshot. These tests do not prove delivery by a real mailbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';

const read = file => fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const main = read('outlook-mail/main.js');
const runtime = read('.tests/contracts/cindy-mail-runtime.js');
const copy = value => JSON.parse(JSON.stringify(value));
const BASE = 'https://graph.microsoft.com/v1.0';
const accountsFixture = [
  { key: 'outlook_global', clientConfigured: true, accounts: [{ id: 'g1', label: 'Global', status: 'connected', isDefault: true }] },
  { key: 'outlook_china', clientConfigured: false, accounts: [] },
];
const person = (address, name) => ({ emailAddress: { address, ...(name ? { name } : {}) } });
const QUOTE = '<div id="appendonsend"></div><hr style="display:inline-block;width:98%" tabindex="-1"><div id="divRplyFwdMsg" dir="ltr"><b>From:</b> Sender</div><div>Original context</div>';
const htmlToText = html => html.replace(/<hr[^>]*>/gi, '\r\n' + '_'.repeat(32) + '\r\n').replace(/<\/div>/gi, '\r\n').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

function mailbox() {
  let next = 0;
  const messages = new Map();
  const add = message => { const m = { isDraft: true, isRead: true, changeKey: 'ck' + (++next), conversationId: 'conv-1', internetMessageId: '<m' + next + '@example.test>',
    attachments: [], toRecipients: [], ccRecipients: [], bccRecipients: [], replyTo: [], from: null, subject: '', body: { contentType: 'text', content: '' }, ...message };
    m.webLink = m.webLink || 'https://outlook.office365.com/owa/?ItemID=' + encodeURIComponent(m.id) + '&exvsurl=1&viewmodel=ReadMessageItem';
    messages.set(m.id, m); return m; };
  const bump = m => { m.changeKey = 'ck' + (++next); };
  return { messages, add, bump, newId: prefix => prefix + 'AAMk' + (++next) + '=' };
}

function fixture(t, options = {}) {
  const box = mailbox();
  const requests = [], replies = [], continuations = [];
  const faults = [];
  let kv = {};
  const locks = new Map(), timers = new Map();
  let timerId = 0;
  const reply = (status, data) => ({ ok: true, status, body: data === undefined ? '' : JSON.stringify(data) });
  const view = (m, prefer) => {
    const { attachments, ...rest } = copy(m);
    let body = rest.body;
    if (prefer === 'text' && body.contentType === 'html') body = { contentType: 'text', content: htmlToText(body.content.replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/gi, '')) };
    if (prefer === 'html' && body.contentType === 'text') body = { contentType: 'html', content: '<html><body>' + body.content + '</body></html>' };
    return { ...rest, body, '@odata.etag': 'W/"' + m.changeKey + '"' };
  };
  async function graph(req) {
    requests.push(copy(req));
    for (const fault of faults) { const r = fault(req); if (r) return r instanceof Error ? Promise.reject(r) : r; }
    const url = new URL(req.url);
    assert.equal(url.origin + '/v1.0', BASE);
    assert.equal(req.authAccount, 'g1');
    const path = decodeURIComponent(url.pathname.slice('/v1.0'.length));
    const prefer = /body-content-type="(\w+)"/.exec(req.headers?.Prefer || '')?.[1];
    const body = req.body ? JSON.parse(req.body) : undefined;
    let m;
    if (path === '/me') return reply(200, { mail: 'self@example.test', userPrincipalName: 'self@example.test', proxyAddresses: ['SMTP:self@example.test', 'smtp:alias@example.test'] });
    if (path === '/me/messages' && req.method === 'POST') {
      m = box.add({ id: box.newId('draft'), subject: body.subject, body: { contentType: body.body.contentType.toLowerCase(), content: body.body.content },
        toRecipients: body.toRecipients, ccRecipients: body.ccRecipients, bccRecipients: body.bccRecipients });
      return reply(201, view(m));
    }
    if (path === '/me/messages' && req.method === 'GET') {
      const conv = /conversationId eq '([^']+)'/.exec(url.searchParams.get('$filter') || '')?.[1];
      return reply(200, { value: [...box.messages.values()].filter(x => x.conversationId === conv).map(x => view(x)) });
    }
    let match = /^\/me\/messages\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (!match) return reply(404, { error: { code: 'NotFound' } });
    m = box.messages.get(match[1]);
    if (!m) return reply(404, { error: { code: 'ErrorItemNotFound' } });
    const rest = match[2];
    if (!rest && req.method === 'GET') return reply(200, view(m, prefer));
    if (!rest && req.method === 'PATCH') {
      if (req.headers?.['If-Match'] && req.headers['If-Match'] !== 'W/"' + m.changeKey + '"') return reply(412, { error: { code: 'ErrorIrresolvableConflict' } });
      for (const [k, v] of Object.entries(body)) m[k] = k === 'body' ? { contentType: v.contentType.toLowerCase(), content: v.content } : v;
      box.bump(m); return reply(200, view(m));
    }
    if (!rest && req.method === 'DELETE') { box.messages.delete(m.id); return reply(204); }
    if (/^create(Reply|ReplyAll|Forward)$/.test(rest)) {
      const all = rest === 'createReplyAll', forward = rest === 'createForward';
      const draft = box.add({ id: box.newId('reply'), subject: (forward ? 'FW: ' : 'RE: ') + m.subject, conversationId: m.conversationId,
        toRecipients: forward ? [] : [m.from, ...(all ? m.toRecipients : [])], ccRecipients: all ? m.ccRecipients : [],
        body: { contentType: 'html', content: '<html><head><style>p{margin:0}</style></head><body dir="ltr">' + QUOTE + (m.longQuote ? '<div>' + 'x'.repeat(m.longQuote) + '</div>' : '') + (m.longLines ? '<div>x</div><div></div><div></div>'.repeat(m.longLines) : '') + '</body></html>' },
        attachments: forward ? copy(m.attachments) : [] });
      return reply(201, view(draft));
    }
    if (rest === 'send') { m.isDraft = false; m.sent = (m.sent || 0) + 1; return reply(202); }
    if (rest === 'attachments' && req.method === 'GET') return reply(200, { value: m.attachments.map(a => ({ '@odata.type': '#microsoft.graph.fileAttachment', id: a.id, name: a.name, contentType: a.contentType, size: a.size, isInline: a.isInline })) });
    if (rest === 'attachments' && req.method === 'POST') {
      const a = { id: box.newId('att'), name: body.name, contentType: body.contentType, contentBytes: body.contentBytes, size: Buffer.from(body.contentBytes, 'base64').length, isInline: body.isInline, contentId: body.contentId || null };
      m.attachments.push(a); box.bump(m); return reply(201, a);
    }
    match = /^attachments\/(.+)$/.exec(rest || '');
    if (match) {
      const a = m.attachments.find(x => x.id === match[1]);
      if (!a) return reply(404, { error: { code: 'NotFound' } });
      if (req.method === 'DELETE') { m.attachments = m.attachments.filter(x => x !== a); box.bump(m); return reply(204); }
      return reply(200, { '@odata.type': '#microsoft.graph.fileAttachment', ...a });
    }
    return reply(400, { error: { code: 'Unsupported' } });
  }
  const handlers = [];
  const sandbox = createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, btoa, atob, crypto: webcrypto, Set, Map, JSON, Promise,
    setTimeout: (fn, delay) => { const id = ++timerId; if (delay === 10000 && !options.holdCountdown) queueMicrotask(fn); else timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    navigator: { locks: { request(name, callback) {
      const pending = (locks.get(name) || Promise.resolve()).then(callback);
      locks.set(name, pending.catch(() => {}));
      return pending;
    } } },
    fetch: async (resource, init = {}) => {
      if (resource === '/oauth') return { ok: true, json: async () => copy(options.accounts || accountsFixture) };
      if (resource === '/kv') { if (init.method === 'PUT') kv = JSON.parse(init.body); return { ok: true, json: async () => copy(kv) }; }
      if (resource === '/app-context') return { ok: true, json: async () => ({ context: { locale: 'zh-CN' } }) };
      throw new Error('unexpected local fetch ' + resource);
    },
    cindy: { onHostMessage: fn => handlers.push(fn), fetch: graph,
      request: async r => (r.kind === 'app-context' ? { ok: true, context: { locale: 'zh-CN' } } : { ok: false }),
      send: async message => { replies.push(copy(message)); return message.kind === 'deposit_media' ? { ok: true, url: 'cindy-media://blobs/' + 'a'.repeat(64) + '.png' } : { ok: true }; },
      agent: { run: async r => { continuations.push(copy(r)); return { ok: true }; } } },
  });
  if (options.sdk !== false) runInContext(runtime, sandbox);
  runInContext(main, sandbox);
  const dispatch = async message => { for (const h of handlers) await h(message); };
  let calls = 0;
  async function tool(args, { tool: name = 'outlook_mail', readOnly = false } = {}) {
    const callId = 'call-' + (++calls);
    await dispatch({ type: 'tool-call', tool: name, callId, args: { ...args, session_context: { workdir: '/w', workdir_is_local: true, workdir_is_read_only: readOnly } } });
    return replies.filter(r => r.type === 'tool-result' && r.callId === callId).at(-1);
  }
  const cards = () => replies.filter(r => r.type === 'mail-draft-update' && r.draft);
  const statuses = () => replies.filter(r => r.type === 'mail-draft-update' && r.statusOnly).map(r => r.statusOnly);
  const values = card => Object.fromEntries(card.fields.map(f => [f.name, f.value]));
  return { box, requests, replies, continuations, faults, tool, cards, statuses, values, kv: () => copy(kv),
    action: (card, kind, extra = {}) => dispatch({ type: 'event', name: 'card-action', callId: card.callId, actionId: 'mail:' + kind + ':' + card.draft.key,
      userActionToken: 'click', ...(kind === 'change' ? { formChange: true } : {}), ...extra }),
    flush: async () => { for (const [id, { fn, delay }] of [...timers]) if (delay !== 3000) { timers.delete(id); await fn(); } },
    countdown: async () => { for (const [id, { fn, delay }] of [...timers]) if (delay === 10000) { timers.delete(id); await fn(); } },
    writes: () => requests.filter(r => r.method !== 'GET') };
}
const sends = f => f.requests.filter(r => r.url.endsWith('/send'));

test('draft creation reads back the saved draft and presents the shared card', async t => {
  const f = fixture(t);
  const r = await f.tool({ action: 'draft', to: 'reader@example.test', subject: 'Hello', body_text: 'Line one\nLine two' });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.result.readBack.status, 'read_back');
  assert.equal(r.result.draftCard, true);
  assert.equal(r.result.readBack.editor.format, 'text');
  const [card] = f.cards();
  assert.equal(card.callId, 'call-1');
  assert.equal(card.draft.from, 'self@example.test');
  assert.equal(f.values(card.draft).to, 'reader@example.test');
  assert.equal(f.values(card.draft).body, 'Line one\nLine two');
  const records = Object.values(f.kv().mailDraftCards);
  assert.equal(records.length, 1);
  assert.equal(records[0].draftId, r.result.draft_id);
  assert.equal(records[0].fingerprint, f.box.messages.get(r.result.draft_id).changeKey);
  // Records hold routing only, never bodies or tokens.
  assert.doesNotMatch(JSON.stringify(f.kv()), /Line one|Bearer/);
  // Search results carry links bound to the account for the native reader.
  assert.match(r.result.readBack.webLink, /^https:\/\/outlook\.office365\.com\/owa\/\?ItemID=.*cindy_account=g1/);
});

test('card edits autosave with If-Match and keep plain-text drafts plain', async t => {
  const f = fixture(t);
  const r = await f.tool({ action: 'draft', to: 'reader@example.test', subject: 'Hello', body_text: 'Draft' });
  const card = f.cards()[0];
  await f.action(card, 'change', { formValues: { ...f.values(card.draft), body: 'Edited body', to: '"Reader" <reader@example.test>, second@example.test' } });
  await f.flush();
  const patch = f.writes().find(w => w.method === 'PATCH');
  assert.ok(patch, 'autosave wrote the draft');
  assert.equal(patch.headers['If-Match'], 'W/"' + Object.values(f.kv().mailDraftCards)[0].fingerprint.replace(/\d+$/, n => n - 1) + '"');
  const body = JSON.parse(patch.body);
  assert.deepEqual(body.body, { contentType: 'Text', content: 'Edited body' });
  assert.deepEqual(body.toRecipients, [person('reader@example.test', 'Reader'), person('second@example.test')]);
  assert.equal(body.subject, undefined, 'unchanged fields are not rewritten');
  const stored = f.box.messages.get(r.result.draft_id);
  assert.equal(stored.body.content, 'Edited body');
  assert.equal(Object.values(f.kv().mailDraftCards)[0].fingerprint, stored.changeKey);
  assert.equal(sends(f).length, 0);
});

test('a draft changed in Outlook merges with card edits instead of being overwritten', async t => {
  const f = fixture(t);
  const r = await f.tool({ action: 'draft', to: 'reader@example.test', subject: 'Original subject', body_text: 'Original body' });
  const card = f.cards()[0];
  const stored = f.box.messages.get(r.result.draft_id);
  stored.subject = 'Subject edited in Outlook'; f.box.bump(stored);
  await f.action(card, 'change', { formValues: { ...f.values(card.draft), body: 'Body edited in card' } });
  await f.flush();
  assert.equal(stored.subject, 'Subject edited in Outlook');
  assert.equal(stored.body.content, 'Body edited in card');
  assert.equal(sends(f).length, 0);
});

test('a write rejected by the If-Match precondition is a definite stale non-execution', async t => {
  const f = fixture(t);
  const r = await f.tool({ action: 'draft', to: 'reader@example.test', subject: 'S', body_text: 'B' });
  const stored = f.box.messages.get(r.result.draft_id);
  let raced = false;
  // Outlook changes the draft between the version check and the PATCH.
  f.faults.push(req => { if (req.method === 'PATCH' && !raced) { raced = true; stored.subject = 'Changed meanwhile'; f.box.bump(stored); } });
  const card = f.cards()[0];
  await f.action(card, 'change', { formValues: { ...f.values(card.draft), body: 'Card body' } });
  await f.flush();
  assert.equal(stored.subject, 'Changed meanwhile');
  assert.equal(stored.body.content, 'Card body');
  assert.equal(f.writes().filter(w => w.method === 'PATCH').length, 2, 'one rejected precondition, one merged retry');
});

test('send_draft waits for the countdown and sends exactly once', async t => {
  const f = fixture(t);
  const r = await f.tool({ action: 'draft', to: 'reader@example.test', subject: 'S', body_text: 'B' });
  const sent = await f.tool({ action: 'send_draft', draft_id: r.result.draft_id });
  assert.equal(sent.ok, true, sent.message);
  assert.equal(sent.result.sent, true);
  assert.equal(sent.result.receipt.delivery_confirmed, false);
  assert.equal(sends(f).length, 1);
  assert.ok(f.statuses().some(s => s.pendingSend), 'the card showed the undo countdown');
  const again = await f.tool({ action: 'send_draft', draft_id: r.result.draft_id });
  assert.equal(again.ok, true);
  assert.equal(again.result.alreadySent, true);
  assert.equal(sends(f).length, 1);
  assert.equal(f.continuations.length, 0, 'a model send returns to the current turn');
});

test('card send can be undone; send now sends once and continues the task', async t => {
  const f = fixture(t, { holdCountdown: true });
  await f.tool({ action: 'draft', to: 'reader@example.test', subject: 'S', body_text: 'B' });
  const card = f.cards()[0];
  const first = f.action(card, 'send', { formValues: f.values(card.draft) });
  await new Promise(r => setTimeout(r, 20));
  await f.action(card, 'cancel');
  await first;
  assert.equal(sends(f).length, 0);
  const second = f.action(card, 'send', { formValues: f.values(card.draft) });
  await new Promise(r => setTimeout(r, 20));
  await f.action(card, 'now');
  await second;
  assert.equal(sends(f).length, 1);
  assert.equal(f.continuations.length, 1);
  assert.equal(f.continuations[0].event.provider, 'Outlook');
});

test('direct send never reaches Graph; drafts require the shared flow and a writable task', async t => {
  const f = fixture(t);
  const direct = await f.tool({ action: 'send', to: 'reader@example.test', subject: 'S', body_text: 'B' });
  assert.equal(direct.ok, false);
  assert.match(direct.message, /not_executed.*send_draft/);
  const readOnly = await f.tool({ action: 'draft', to: 'reader@example.test', subject: 'S', body_text: 'B' }, { readOnly: true });
  assert.equal(readOnly.ok, false);
  assert.match(readOnly.message, /not_executed.*只读/);
  // A draft without a presented card cannot be sent by the model.
  const loose = f.box.add({ id: 'looseAAMk1=', toRecipients: [person('reader@example.test')] });
  const blocked = await f.tool({ action: 'send_draft', draft_id: loose.id });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /not_executed/);
  assert.equal(f.writes().length, 0);
});

test('older hosts without the mail SDK keep read-only draft inspection only', async t => {
  const f = fixture(t, { sdk: false });
  const loose = f.box.add({ id: 'looseAAMk1=', subject: 'Saved', body: { contentType: 'text', content: 'Body' } });
  for (const args of [{ action: 'draft', subject: '', body_text: '' }, { action: 'reply_all', message_id: loose.id },
    { action: 'update_draft', draft_id: loose.id, subject: 'x' }, { action: 'send_draft', draft_id: loose.id }, { action: 'delete_draft', draft_id: loose.id }]) {
    const r = await f.tool(args);
    assert.equal(r.ok, false, args.action);
    assert.match(r.message, /not_executed.*更新 Cindy/);
  }
  assert.equal(f.writes().length, 0);
  const got = await f.tool({ action: 'get_draft', draft_id: loose.id });
  assert.equal(got.ok, true);
  assert.equal(got.result.readBack.headers.subject, 'Saved');
  assert.equal(got.result.draftCard, false);
});

test('reply_all excludes this mailbox, duplicates and Bcc, and keeps Outlook\'s quote', async t => {
  const f = fixture(t);
  const original = f.box.add({ id: 'origAAMk1=', isDraft: false, subject: 'Plan', from: person('sender@example.test', 'Sender'),
    toRecipients: [person('Self@example.test'), person('teammate@example.test')], ccRecipients: [person('alias@example.test'), person('TEAMMATE@example.test'), person('cc@example.test')] });
  const r = await f.tool({ action: 'reply_all', message_id: original.id, body_text: 'Sounds good' });
  assert.equal(r.ok, true, r.message);
  const draft = f.box.messages.get(r.result.draft_id);
  assert.deepEqual(draft.toRecipients.map(x => x.emailAddress.address), ['sender@example.test', 'teammate@example.test']);
  assert.deepEqual(draft.ccRecipients.map(x => x.emailAddress.address), ['cc@example.test']);
  assert.match(draft.body.content, /^<html><head><style>p\{margin:0\}<\/style><\/head><body dir="ltr"><div>Sounds good<\/div><div id="appendonsend">/);
  assert.ok(draft.body.content.endsWith(QUOTE + '</body></html>'));
  const editor = r.result.readBack.editor;
  assert.equal(editor.format, 'html');
  assert.equal(editor.bodyHtml, '<div>Sounds good</div>');
  assert.equal(editor.quoteHtml, QUOTE);
  assert.match(editor.quote, /^\s*_{10,}/);
  const reply = await f.tool({ action: 'reply', message_id: original.id });
  assert.deepEqual(f.box.messages.get(reply.result.draft_id).toRecipients.map(x => x.emailAddress.address), ['sender@example.test']);
});

test('HTML card edits replace only the body content of the stored document', async t => {
  const f = fixture(t);
  const original = f.box.add({ id: 'origAAMk1=', isDraft: false, subject: 'Plan', from: person('sender@example.test') });
  const r = await f.tool({ action: 'reply_all', message_id: original.id });
  const card = f.cards().at(-1);
  await f.action(card, 'change', { formValues: { ...f.values(card.draft), bodyHtml: '<p><b>Bold</b> reply</p>' } });
  await f.flush();
  const stored = f.box.messages.get(r.result.draft_id);
  assert.equal(stored.body.content, '<html><head><style>p{margin:0}</style></head><body dir="ltr"><p><b>Bold</b> reply</p>' + QUOTE + '</body></html>');
  // update_draft from the model edits the same document.
  const updated = await f.tool({ action: 'update_draft', draft_id: stored.id, body_text: 'Plain <reply>' });
  assert.equal(updated.ok, true, updated.message);
  assert.ok(stored.body.content.includes('<div>Plain &lt;reply&gt;</div>' + QUOTE));
});

test('attachments: removal deletes, renaming re-creates bytes, new local files are refused before writing', async t => {
  const f = fixture(t);
  const r = await f.tool({ action: 'draft', to: 'reader@example.test', subject: 'S', body_text: 'B' });
  const stored = f.box.messages.get(r.result.draft_id);
  stored.attachments.push({ id: 'img1', name: 'chart.png', contentType: 'image/png', contentBytes: PNG, size: 16, isInline: true, contentId: 'chart@example.test' },
    { id: 'doc1', name: 'notes.txt', contentType: 'text/plain', contentBytes: Buffer.from('notes').toString('base64'), size: 5, isInline: false, contentId: null });
  f.box.bump(stored);
  const got = await f.tool({ action: 'get_draft', draft_id: stored.id });
  const image = got.result.readBack.attachments.find(a => a.key === 'img1');
  assert.equal(image.contentId, 'chart@example.test');
  assert.match(image.previewUrl, /^cindy-media:/);
  assert.deepEqual(copy(got.result.readBack.images), [{ cid: 'chart@example.test', url: image.previewUrl }]);
  assert.equal(JSON.stringify(got).includes(PNG), false, 'attachment bytes never reach the model');
  const card = f.cards().at(-1);
  const items = JSON.parse(f.values(card.draft).attachmentItems);
  const refused = await (async () => {
    await f.action(card, 'attach', { formValues: f.values(card.draft), mailAttachment: { path: '/picked/file.pdf', filename: 'file.pdf', bytes: 10, sha256: 'a'.repeat(64) } });
    await f.flush();
    return f.cards().at(-1).draft.status;
  })();
  assert.match(refused, /暂不支持新增附件/);
  assert.equal(f.writes().filter(w => w.url.includes('/attachments')).length, 0);
  const latest = f.cards().at(-1);
  const kept = items.filter(a => a.key === 'img1').map(a => ({ ...a, filename: 'renamed.png' }));
  await f.action(latest, 'change', { formValues: { ...f.values(latest.draft), attachmentItems: JSON.stringify(kept) } });
  await f.flush();
  assert.deepEqual(stored.attachments.map(a => [a.name, a.contentId, a.contentBytes]), [['renamed.png', 'chart@example.test', PNG]]);
  const order = f.writes().filter(w => w.url.includes('/attachments')).map(w => w.method + ' ' + w.url.split('/attachments')[1]);
  assert.deepEqual(order.slice(0, 2), ['POST ', 'DELETE /img1'], 'the replacement exists before the original is removed');
});

test('unknown writes are never replayed, by autosave or by a later send', async t => {
  const f = fixture(t);
  const r = await f.tool({ action: 'draft', to: 'reader@example.test', subject: 'S', body_text: 'B' });
  f.faults.push(req => (req.method === 'PATCH' ? { ok: true, status: 503, body: '{}' } : undefined));
  const card = f.cards()[0];
  await f.action(card, 'change', { formValues: { ...f.values(card.draft), body: 'Changed' } });
  await f.flush();
  assert.equal(f.writes().filter(w => w.method === 'PATCH').length, 1);
  const sent = await f.tool({ action: 'send_draft', draft_id: r.result.draft_id });
  assert.equal(sent.ok, false);
  assert.match(sent.message, /execution_status=unknown/);
  await f.flush();
  assert.equal(f.writes().filter(w => w.method === 'PATCH').length, 1);
  assert.equal(sends(f).length, 0);
});

test('a send whose outcome is unknown is reported unknown and blocks resending', async t => {
  const f = fixture(t);
  const r = await f.tool({ action: 'draft', to: 'reader@example.test', subject: 'S', body_text: 'B' });
  f.faults.push(req => (req.url.endsWith('/send') ? new Error('socket hang up') : undefined));
  const sent = await f.tool({ action: 'send_draft', draft_id: r.result.draft_id });
  assert.equal(sent.ok, false);
  assert.match(sent.message, /execution_status=unknown/);
  f.faults.length = 0;
  const again = await f.tool({ action: 'send_draft', draft_id: r.result.draft_id });
  assert.equal(again.ok, false);
  assert.equal(sends(f).length, 1);
});

test('card deletion removes the draft from Outlook once', async t => {
  const f = fixture(t);
  const r = await f.tool({ action: 'draft', to: 'reader@example.test', subject: 'S', body_text: 'B' });
  const card = f.cards()[0];
  assert.ok(card.draft.deleteLabel);
  await f.action(card, 'delete');
  assert.equal(f.box.messages.has(r.result.draft_id), false);
  assert.equal(Object.values(f.kv().mailDraftCards)[0].state, 'deleted');
  const again = await f.tool({ action: 'delete_draft', draft_id: r.result.draft_id });
  assert.equal(again.ok, true);
  assert.equal(again.result.alreadyDeleted, true);
  assert.equal(f.writes().filter(w => w.method === 'DELETE').length, 1);
});

test('reader resolves account-bound links, conversations and a three-state read mark', async t => {
  const f = fixture(t);
  const first = f.box.add({ id: 'firstAAMk1=', isDraft: false, subject: 'Plan', from: person('a@example.test'), receivedDateTime: '2026-11-01T00:00:00Z', bodyPreview: 'first' });
  const second = f.box.add({ id: 'secondAAMk2=', isDraft: false, isRead: false, subject: 'RE: Plan', from: person('b@example.test', 'Bee'), toRecipients: [person('self@example.test')],
    receivedDateTime: '2026-11-02T00:00:00Z', body: { contentType: 'html', content: '<html><body><p>Hi &amp; bye</p></body></html>' } });
  f.box.add({ id: 'hiddenDraftAAMk3=', subject: 'RE: Plan', receivedDateTime: '2026-11-03T00:00:00Z' });
  const link = 'https://outlook.office365.com/owa/?ItemID=' + encodeURIComponent(second.id) + '&exvsurl=1&cindy_account=g1';
  const plain = await f.tool({ url: link }, { tool: 'outlook_read_message' });
  assert.equal(plain.ok, true, plain.message);
  assert.equal(plain.result.accountId, 'g1');
  assert.equal(plain.result.from, '"Bee" <b@example.test>');
  assert.match(plain.result.bodyHtml, /<p>Hi &amp; bye<\/p>/);
  assert.match(plain.result.bodyText, /Hi & bye/);
  assert.deepEqual(plain.result.conversation.messages.map(m => m.messageId), [first.id, second.id]);
  assert.ok(plain.result.conversation.messages.every(m => m.url.includes('cindy_account=g1')));
  assert.equal(plain.result.markReadResult, undefined);
  assert.equal(second.isRead, false, 'AI reads never mark read');
  f.faults.push(req => (req.method === 'PATCH' ? { ok: true, status: 403, body: '{}' } : undefined));
  let opened = await f.tool({ url: link, markRead: true }, { tool: 'outlook_read_message' });
  assert.deepEqual([opened.result.markReadResult.execution, opened.result.markReadFailed], ['not_executed', true]);
  f.faults[0] = req => (req.method === 'PATCH' ? { ok: true, status: 503, body: '{}' } : undefined);
  opened = await f.tool({ url: link, markRead: true }, { tool: 'outlook_read_message' });
  assert.equal(opened.result.markReadResult.execution, 'unknown');
  assert.equal(opened.result.markReadFailed, undefined);
  assert.match(opened.result.bodyText, /Hi & bye/, 'the body survives an unknown read mark');
  f.faults.length = 0;
  opened = await f.tool({ url: link, markRead: true }, { tool: 'outlook_read_message' });
  assert.equal(opened.result.markReadResult.execution, 'executed');
  assert.equal(second.isRead, true);
  // Conversation failures keep the selected message readable.
  f.faults.push(req => (req.url.includes('%24filter=') || req.url.includes('$filter=') ? { ok: true, status: 500, body: '{}' } : undefined));
  const lonely = await f.tool({ url: link }, { tool: 'outlook_read_message' });
  assert.equal(lonely.result.conversationUnavailable, true);
  assert.equal(lonely.result.conversation, undefined);
});

test('an Outlook quote beyond the draft card limits is shortened so the card can show and send it', async t => {
  const f = fixture(t);
  const original = f.box.add({ id: 'bigAAMk1=', isDraft: false, subject: 'Big', longQuote: 17000, from: person('sender@example.test', 'Sender'), toRecipients: [person('self@example.test')] });
  const r = await f.tool({ action: 'reply', message_id: original.id, body_text: 'ok' });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.result.draftCard, true);
  const editor = r.result.readBack.editor;
  assert.ok(editor.quote.length <= 16000 && editor.quote.trimEnd().endsWith('…'));
  assert.equal(editor.bodyHtml, '<div>ok</div>');
  assert.match(f.box.messages.get(r.result.draft_id).body.content, /id="appendonsend"/);
});

test('many short quoted lines are shortened by their HTML size, and a body whose HTML cannot fit is refused', async t => {
  const f = fixture(t);
  const original = f.box.add({ id: 'linesAAMk1=', isDraft: false, subject: 'Lines', longLines: 3000, from: person('sender@example.test', 'Sender'), toRecipients: [person('self@example.test')] });
  const r = await f.tool({ action: 'reply', message_id: original.id, body_text: 'ok' });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.result.draftCard, true);
  assert.ok(r.result.readBack.editor.quoteHtml.length <= 64000);
  const before = f.writes().length;
  const refused = await f.tool({ action: 'draft', to: 'dave@example.test', subject: 'Lines', body_text: 'x\n'.repeat(6000) });
  assert.equal(refused.ok, false);
  assert.equal(f.writes().length, before);
  // HTML within 64,000 characters whose plain-text form exceeds the card's 16,000.
  const longHtml = await f.tool({ action: 'draft', to: 'dave@example.test', subject: 'Html', body_html: '<p>' + 'x'.repeat(17000) + '</p>' });
  assert.equal(longHtml.ok, false);
  assert.equal(f.writes().length, before);
  // Adjacent inline tags do not add characters to the plain text, so this fits (14,001 characters).
  const spans = await f.tool({ action: 'draft', to: 'dave@example.test', subject: 'Spans', body_html: '<span>x</span>'.repeat(2000) + 'x'.repeat(12001) });
  assert.equal(spans.ok, true, spans.message);
  assert.equal(spans.result.draftCard, true);
  const okHtml = await f.tool({ action: 'draft', to: 'dave@example.test', subject: 'Html', body_html: '<p>' + 'x'.repeat(15000) + '</p>' });
  assert.equal(okHtml.ok, true, okHtml.message);
  assert.equal(okHtml.result.draftCard, true);
});

test('a paged conversation is reported unavailable, never presented as the whole thread', async t => {
  const f = fixture(t);
  const only = f.box.add({ id: 'onlyAAMk1=', isDraft: false, subject: 'Plan', from: person('a@example.test'), receivedDateTime: '2026-11-01T00:00:00Z', body: { contentType: 'html', content: '<p>x</p>' } });
  const link = 'https://outlook.office365.com/owa/?ItemID=' + encodeURIComponent(only.id) + '&exvsurl=1&cindy_account=g1';
  f.faults.push(req => (req.url.includes('$filter=') || req.url.includes('%24filter=') ? { ok: true, status: 200,
    body: JSON.stringify({ value: [{ id: only.id, isDraft: false, subject: 'Plan', webLink: only.webLink, receivedDateTime: only.receivedDateTime }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=next' }) } : undefined));
  const read = await f.tool({ url: link }, { tool: 'outlook_read_message' });
  assert.equal(read.ok, true, read.message);
  assert.equal(read.result.conversationUnavailable, true);
  assert.equal(read.result.conversation, undefined);
  assert.match(read.result.bodyHtml, /<p>x<\/p>/);
});

test('a draft longer than the draft card can hold is refused before Graph is written', async t => {
  const f = fixture(t);
  const result = await f.tool({ action: 'draft', to: 'dave@example.test', subject: 'Long', body_text: 'x'.repeat(16001) });
  assert.equal(result.ok, false);
  assert.equal(f.writes().length, 0);
  const fits = await f.tool({ action: 'draft', to: 'dave@example.test', subject: 'Fits', body_text: 'x'.repeat(16000) });
  assert.equal(fits.ok, true, fits.message);
  assert.equal(fits.result.draftCard, true);
});

test('reader never guesses between accounts or follows foreign links', async t => {
  const two = copy(accountsFixture);
  two[0].accounts.push({ id: 'g2', label: 'Second', status: 'connected', isDefault: false });
  const f = fixture(t, { accounts: two });
  f.box.add({ id: 'msgAAMk1=', isDraft: false });
  const unbound = await f.tool({ url: 'https://outlook.office365.com/owa/?ItemID=msgAAMk1%3D' }, { tool: 'outlook_read_message' });
  assert.equal(unbound.ok, false);
  assert.match(unbound.message, /account/);
  const mismatch = await f.tool({ url: 'https://outlook.office365.com/owa/?ItemID=msgAAMk1%3D&cindy_account=g1', account: 'g2' }, { tool: 'outlook_read_message' });
  assert.equal(mismatch.ok, false);
  for (const url of ['https://outlook.example.test/owa/?ItemID=msgAAMk1%3D', 'http://outlook.office365.com/owa/?ItemID=msgAAMk1%3D', 'https://outlook.office365.com/owa/']) {
    const r = await f.tool({ url, account: 'g1' }, { tool: 'outlook_read_message' });
    assert.equal(r.ok, false, url);
  }
  assert.equal(f.requests.length, 0);
});

test('manifest declares the shared mail flow, reader hosts and media deposit', () => {
  const manifest = JSON.parse(read('outlook-mail/ghost.json'));
  assert.equal(manifest.mail, true);
  assert.deepEqual(manifest.agent, {});
  assert.equal(manifest.sessionContext, true);
  assert.deepEqual(manifest.cindy, { media: ['deposit'] });
  assert.equal(manifest.mailReader.tool, 'outlook_read_message');
  assert.equal(manifest.mailReader.markRead, true);
  assert.ok(manifest.tools.some(tool => tool.name === manifest.mailReader.tool));
  for (const host of manifest.mailReader.hosts) assert.match(host, /^(?:outlook\.(?:office365\.com|office\.com|live\.com|cloud\.microsoft)|partner\.outlook\.cn)$/);
  // Mail flow requests reuse the existing Graph hosts and OAuth scopes.
  assert.deepEqual(manifest.network.hosts, ['login.microsoftonline.com', 'graph.microsoft.com', 'login.chinacloudapi.cn', 'microsoftgraph.chinacloudapi.cn']);
  assert.equal(manifest.network.secrets[0].oauth.scopes.length, 5);
  assert.doesNotMatch(main, /cardHtml|<form/);
});
