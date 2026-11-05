// End-to-end checks for the shared IMAP mail-card adapter: Cindy's mail SDK
// snapshot + the plugin's main.js + its real Node worker, against in-memory
// IMAP/SMTP doubles. Each IMAP plugin's own test file runs this suite, so the
// per-plugin CI job covers it. Mock mailboxes do not prove real delivery.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import { FakeMailbox } from './fixtures/fake-imap.mjs';

const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const sdk = read('.tests/contracts/cindy-mail-runtime.js');
const copy = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const PLUGINS = ['qq-mail', '163-mail', 'icloud-mail', 'yahoo-mail'];
const BLOCK = /\/\* BEGIN cindy-imap-compose[\s\S]*?\/\* END cindy-imap-compose \*\//;

const SOURCE = [
  'From: Alice <alice@example.test>',
  'To: {self}, Bob <bob@example.test>',
  'Cc: carol@example.test, {self}',
  'Bcc: hidden@example.test',
  'Subject: Plan',
  'Message-ID: <source-1@example.test>',
  'Date: Mon, 02 Nov 2026 10:00:00 +0000',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hello team',
  '',
].join('\r\n');

function harness(plugin, { email, kv: extraKv = {}, secretKeys, locale = 'en', readOnly = false } = {}) {
  const require = createRequire(new URL('../' + plugin + '/src/worker.cjs', import.meta.url));
  const worker = require('./worker.cjs');
  const box = new FakeMailbox();
  box.add('INBOX', SOURCE.replace(/\{self\}/g, email));
  let kv = { email, ...extraKv };
  let clock = 100000;
  let timerId = 0;
  const timers = new Map();
  const locks = new Map();
  const handlers = [];
  const sent = [];
  const results = new Map();
  const nodeRequests = [];
  const continuations = [];
  const deposits = [];
  const deps = { ...worker.createRuntimeDeps(), createImap: () => box.client(), createSmtp: () => box.smtp() };
  const context = createContext({
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    URL,
    Date: class extends Date { static now() { return clock; } },
    setTimeout(fn, delay) {
      const id = ++timerId;
      timers.set(id, { fn, at: clock + (delay || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    BroadcastChannel: undefined,
    navigator: { locks: { request(name, fn) {
      const next = (locks.get(name) || Promise.resolve()).then(fn);
      locks.set(name, next.catch(() => {}));
      return next;
    } } },
    async fetch(url, options = {}) {
      if (url === '/app-context') return { ok: true, json: async () => ({ context: { locale } }) };
      if (url === '/secrets') return { ok: true, json: async () => secretKeys.map((key) => ({ key, saved: true })) };
      assert.equal(url, '/kv');
      if (options.method === 'PUT') kv = JSON.parse(options.body);
      return { ok: true, json: async () => copy(kv) };
    },
    cindy: {
      onHostMessage(handler) { handlers.push(handler); },
      request: async () => ({ ok: true, context: { locale } }),
      async send(message) {
        sent.push(copy(message));
        if (message.type === 'tool-result') { results.get(message.callId)?.(copy(message)); return { ok: true }; }
        if (message.type === 'mail-draft-read') {
          const card = sent.findLast((item) => item.type === 'mail-draft-update' && item.draft && item.callId === message.callId);
          return card ? { ok: true, draft: copy(card.draft) } : { ok: false };
        }
        if (message.type === 'cindy-request' && message.kind === 'deposit_media') {
          deposits.push(message.label);
          return { ok: true, url: 'cindy-media://blobs/' + sha256(message.data) + '.png' };
        }
        return { ok: true };
      },
      agent: { async run(event) { continuations.push(copy(event)); return { ok: true }; } },
      node: {
        async request(request) {
          nodeRequests.push(copy(request));
          const secrets = Object.fromEntries(secretKeys.map((key) => [key, 'test-only-secret']));
          try {
            const result = await worker.handleRequest({ method: request.method, params: copy(request.params), cindy: { secrets } }, deps);
            return { ok: true, result };
          } catch (error) {
            return { ok: false, message: error.message, data: { execution_state: error.executionState } };
          }
        },
      },
    },
  });
  runInContext(sdk, context);
  runInContext(read(plugin + '/main.js'), context, { filename: plugin + '/main.js' });
  const tool = plugin === 'qq-mail' ? 'qq_mail' : plugin === '163-mail' ? 'mail_163' : plugin.replace('-', '_');
  const settle = async (rounds = 60) => { for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve)); };
  let calls = 0;
  const api = {
    box, timers, sent, nodeRequests, continuations, deposits, kv: () => copy(kv),
    readOnly,
    async call(args, callId = 'call-' + ++calls) {
      const done = new Promise((resolve) => results.set(callId, resolve));
      const message = { type: 'tool-call', tool, callId, args: { session_context: { workdir_is_read_only: api.readOnly, workdir_is_local: true }, ...args } };
      handlers.forEach((handler) => handler(message));
      const result = await done;
      await settle();
      return result;
    },
    lastCard: () => sent.findLast((item) => item.type === 'mail-draft-update' && item.draft),
    lastStatus: () => sent.findLast((item) => item.type === 'mail-draft-update'),
    values() {
      return Object.fromEntries(api.lastCard().draft.fields.map((field) => [field.name, field.value]));
    },
    async card(operation, values = api.values(), extra = {}) {
      const card = api.lastCard();
      handlers.forEach((handler) => handler({ type: 'event', name: 'card-action', actionId: 'mail:' + operation + ':' + card.draft.key,
        callId: card.callId, formChange: operation === 'change', formValues: values, userActionToken: 'host-click-token', ...extra }));
      await settle();
    },
    async advance(ms) {
      clock += ms;
      for (let pass = 0; pass < 5; pass++) {
        for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); await timer.fn(); await settle(); }
      }
      await settle();
    },
    drafts: () => box.drafts(),
    draftSource: () => box.drafts()[0]?.[1].raw.toString(),
  };
  return api;
}

export function runImapComposeSuite(plugin, options) {
  const h = (extra) => harness(plugin, { ...options, ...extra });
  const self = options.email;

  test(plugin + ': every IMAP plugin carries the identical shared compose code', () => {
    const engine = read(plugin + '/src/mail-compose.cjs');
    const block = BLOCK.exec(read(plugin + '/main.js'));
    assert.ok(block, 'main.js includes the shared compose block');
    for (const other of PLUGINS) {
      assert.equal(read(other + '/src/mail-compose.cjs'), engine, other + ' mail-compose.cjs differs');
      assert.equal(BLOCK.exec(read(other + '/main.js'))?.[0], block[0], other + ' compose block differs');
    }
    const manifest = JSON.parse(read(plugin + '/ghost.json'));
    assert.equal(manifest.mail, true);
    assert.deepEqual(manifest.agent, {});
    assert.equal(manifest.sessionContext, true);
    assert.deepEqual(manifest.cindy, { media: ['deposit'] });
    assert.equal(manifest.minCindyVersion, '0.1.112');
    const actions = manifest.tools.find((item) => item.parameters?.properties?.action?.enum).parameters.properties.action.enum;
    assert.ok(!actions.includes('send'));
    for (const action of ['draft', 'reply', 'reply_all', 'forward', 'get_draft', 'update_draft', 'send_draft', 'delete_draft']) assert.ok(actions.includes(action), action);
    assert.match(read(plugin + '/node/worker.cjs'), /cindy_quote/, 'bundled worker is rebuilt from src');
  });

  test(plugin + ': reply_all drafts exclude this account, duplicates and Bcc, then show the shared card', async () => {
    const t = h();
    const result = await t.call({ action: 'reply_all', folder: 'INBOX', message_uid: 1, body_text: 'Thanks, all.' });
    assert.equal(result.ok, true, result.message);
    assert.match(result.result.draft_id, /^<[^@]+@[^>]+>$/);
    assert.equal(result.result.draftCard, true);
    assert.ok(!JSON.stringify(result).includes('inlineData'));
    const values = t.values();
    assert.equal(values.to, 'Alice <alice@example.test>');
    assert.equal(values.cc, 'Bob <bob@example.test>, carol@example.test');
    assert.equal(values.bcc, '');
    assert.equal(values.subject, 'Re: Plan');
    assert.equal(values.body, 'Thanks, all.');
    assert.match(values.quote, /^\n\nOn .+ Alice <alice@example\.test> wrote:\n> Hello team/);
    const source = t.draftSource();
    assert.match(source, /^In-Reply-To: <source-1@example\.test>\r?$/m);
    assert.match(source, /^References: <source-1@example\.test>\r?$/m);
    assert.equal(t.drafts().length, 1);
    assert.equal(t.box.sent.length, 0);
  });

  test(plugin + ': reply answers only the sender when asked', async () => {
    const t = h();
    await t.call({ action: 'reply', folder: 'INBOX', message_uid: 1, body_text: 'Thanks.' });
    assert.equal(t.values().to, 'Alice <alice@example.test>');
    assert.equal(t.values().cc, '');
  });

  test(plugin + ': card edits autosave a new revision and the card send countdown sends once', async () => {
    const t = h();
    await t.call({ action: 'draft', to: 'dave@example.test', bcc: 'secret@example.test', subject: 'Hello', body_text: 'First line' });
    const firstUid = t.drafts()[0][0];
    await t.card('change', { ...t.values(), body: 'First line\nSecond line' });
    await t.advance(2000);
    assert.equal(t.drafts().length, 1, 'old revision removed');
    assert.notEqual(t.drafts()[0][0], firstUid);
    assert.match(t.draftSource(), /^Bcc: secret@example\.test\r?$/m);
    assert.equal(t.lastStatus().draft?.status ?? t.lastStatus().statusOnly?.status, 'Synced to ' + options.providerName);
    await t.card('send');
    assert.equal(t.box.sent.length, 0, 'nothing sent before the grace period');
    assert.ok(t.lastStatus().statusOnly.pendingSend, 'countdown shown');
    await t.advance(10000);
    assert.equal(t.box.sent.length, 1);
    const [mail] = t.box.sent;
    assert.deepEqual(mail.envelope.to.sort(), ['dave@example.test', 'secret@example.test']);
    assert.doesNotMatch(mail.raw.toString(), /^Bcc:/mi);
    assert.match(mail.raw.toString(), /Second line/);
    assert.equal(t.drafts().length, 0, 'sent draft removed');
    assert.equal(t.continuations.length, 1);
    assert.equal(t.continuations[0].event.receipt.delivery_confirmed, false);
    await t.card('send');
    await t.advance(10000);
    assert.equal(t.box.sent.length, 1, 'never sent twice');
  });

  test(plugin + ': undo keeps the draft and send_draft from the model uses the same countdown', async () => {
    const t = h();
    const created = await t.call({ action: 'draft', to: 'dave@example.test', subject: 'Hello', body_text: 'Body' });
    await t.card('send');
    await t.card('cancel');
    await t.advance(10000);
    assert.equal(t.box.sent.length, 0);
    assert.equal(t.drafts().length, 1);
    const pending = t.call({ action: 'send_draft', draft_id: created.result.draft_id }, 'model-send');
    for (let i = 0; i < 20 && !t.timers.size; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.box.sent.length, 0);
    await t.advance(10000);
    const sent = await pending;
    assert.equal(sent.ok, true, sent.message);
    assert.equal(sent.result.sent, true);
    assert.equal(t.box.sent.length, 1);
    assert.equal(t.continuations.length, 0, 'model sends do not start another turn');
  });

  test(plugin + ': send_draft without a card, direct send and read-only writes are refused', async () => {
    const t = h();
    const direct = await t.call({ action: 'send', to: 'dave@example.test', subject: 'x', body_text: 'y' });
    assert.equal(direct.ok, false);
    assert.match(direct.message, /^\[not_executed\]/);
    t.readOnly = true;
    const refusedDraft = await t.call({ action: 'draft', to: 'dave@example.test', subject: 'Hi', body_text: 'Body' });
    assert.equal(refusedDraft.ok, false);
    assert.equal(t.drafts().length, 0);
    t.readOnly = false;
    const draft = await t.call({ action: 'draft', to: 'dave@example.test', subject: 'Hi', body_text: 'Body' });
    assert.equal(draft.ok, true);
    t.readOnly = true;
    for (const action of ['update_draft', 'send_draft', 'delete_draft']) {
      const refused = await t.call({ action, draft_id: draft.result.draft_id, body_text: 'changed' });
      assert.equal(refused.ok, false, action);
      assert.match(refused.message, /^\[not_executed\]/);
    }
    const read = await t.call({ action: 'get_draft', draft_id: draft.result.draft_id });
    assert.equal(read.ok, true, read.message);
    assert.equal(read.result.readBack.editor.body, 'Body');
    assert.equal(t.box.sent.length, 0);
    assert.equal(t.drafts().length, 1);
    // A draft that never had a card cannot be sent by the model.
    const other = h();
    other.box.folders.Drafts.messages = new Map(t.box.folders.Drafts.messages);
    other.readOnly = false;
    const noCard = await other.call({ action: 'send_draft', draft_id: draft.result.draft_id });
    assert.equal(noCard.ok, false);
    assert.equal(other.box.sent.length, 0);
  });

  test(plugin + ': a mailbox change is merged with card edits instead of overwritten', async () => {
    const t = h();
    await t.call({ action: 'draft', to: 'dave@example.test', subject: 'Hello', body_text: 'Body' });
    // Another client replaces the stored draft with a new subject.
    const [[uid, stored]] = t.drafts();
    t.box.folders.Drafts.messages.delete(uid);
    t.box.add('Drafts', stored.raw.toString().replace(/^Subject: Hello/m, 'Subject: Hello from phone'), ['\\Draft']);
    await t.card('change', { ...t.values(), body: 'Body edited in Cindy' });
    await t.advance(2000);
    const source = t.draftSource();
    assert.equal(t.drafts().length, 1);
    assert.match(source, /^Subject: Hello from phone\r?$/m);
    assert.match(source, /Body edited in Cindy/);
  });

  test(plugin + ': an unconfirmed append is unknown and never replayed', async () => {
    const t = h();
    await t.call({ action: 'draft', to: 'dave@example.test', subject: 'Hello', body_text: 'Body' });
    t.box.failures.append = Object.assign(new Error('socket closed'), { code: 'ECONNRESET' });
    await t.card('change', { ...t.values(), body: 'Edited' });
    await t.advance(2000);
    const appends = t.box.calls.filter((call) => call === 'append').length;
    await t.card('change', { ...t.values(), body: 'Edited again' });
    await t.advance(2000);
    await t.card('send');
    await t.advance(10000);
    assert.equal(t.box.calls.filter((call) => call === 'append').length, appends);
    assert.equal(t.box.sent.length, 0);
  });

  test(plugin + ': SMTP rejecting every recipient is not executed and keeps the draft', async () => {
    const t = h();
    const created = await t.call({ action: 'draft', to: 'dave@example.test', subject: 'Hello', body_text: 'Body' });
    t.box.failures.smtp = Object.assign(new Error('All recipients were rejected'), { code: 'EENVELOPE' });
    const pending = t.call({ action: 'send_draft', draft_id: created.result.draft_id }, 'model-send');
    for (let i = 0; i < 20 && !t.timers.size; i++) await new Promise((resolve) => setImmediate(resolve));
    await t.advance(10000);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.message, /^\[not_executed\]/);
    assert.equal(t.drafts().length, 1);
  });

  test(plugin + ': delete from the card removes every stored copy', async () => {
    const t = h();
    await t.call({ action: 'draft', to: 'dave@example.test', subject: 'Hello', body_text: 'Body' });
    await t.card('delete');
    assert.equal(t.drafts().length, 0);
    assert.equal(t.lastStatus().statusOnly.state, 'deleted');
  });

  test(plugin + ': update_draft and forward keep MIME attachments; inline images preview without leaking bytes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'imap-compose-'));
    try {
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201c2a3b5d30000000049454e44ae426082', 'hex');
      const report = path.join(dir, 'report.pdf');
      writeFileSync(report, Buffer.from('%PDF-1.4 synthetic'));
      const picture = path.join(dir, 'chart.png');
      writeFileSync(picture, png);
      const t = h();
      const created = await t.call({ action: 'draft', to: 'dave@example.test', subject: 'Report', body_text: 'See attached',
        attachment_paths: [report] });
      assert.equal(created.ok, true, created.message);
      assert.deepEqual(created.result.readBack.attachments.map((item) => item.filename), ['report.pdf']);
      // A host-picked inline picture from the card.
      await t.card('image', t.values(), { mailAttachment: { path: picture, filename: 'chart.png', bytes: png.length, sha256: sha256(png), contentId: 'image-1@cindy.local' } });
      await t.advance(2000);
      const source = t.draftSource();
      assert.match(source, /Content-ID: <image-1@cindy\.local>/);
      assert.match(source, /report\.pdf/);
      const card = t.lastCard().draft;
      assert.deepEqual(card.images?.map((item) => item.cid), ['image-1@cindy.local']);
      assert.ok(t.deposits.includes('chart.png'));
      const leaked = t.sent.filter((item) => item.type !== 'cindy-request' && JSON.stringify(item).includes(png.toString('base64')));
      assert.deepEqual(leaked.map((item) => item.type), [], 'image bytes reach only the Host media deposit');
      const draftId = created.result.draft_id;
      const updated = await t.call({ action: 'update_draft', draft_id: draftId, subject: 'Report v2' });
      assert.equal(updated.ok, true, updated.message);
      assert.equal(updated.result.readBack.headers.subject, 'Report v2');
      assert.equal(updated.result.readBack.attachments.length, 2);
      // Forwarding an inbox message carries its attachments.
      t.box.add('INBOX', t.draftSource().replace(/^Message-ID: .+$/m, 'Message-ID: <fwd-source@example.test>'));
      const forward = await t.call({ action: 'forward', folder: 'INBOX', message_uid: 2, to: 'erin@example.test', body_text: 'FYI' });
      assert.equal(forward.ok, true, forward.message);
      assert.equal(forward.result.readBack.headers.subject, 'Fwd: Report v2');
      assert.equal(forward.result.readBack.attachments.length, 2);
      assert.match(forward.result.readBack.editor.quote, /Forwarded message/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(plugin + ': card records keep only routing and receipts in plugin KV', async () => {
    const t = h();
    const created = await t.call({ action: 'draft', to: 'dave@example.test', subject: 'Hello', body_text: 'Body' });
    const record = Object.values(t.kv().mailDraftCards || {})[0];
    assert.equal(record.draftId, created.result.draft_id);
    assert.equal(record.account, self);
    assert.equal(record.locator.folder, 'Drafts');
    assert.ok(!JSON.stringify(t.kv()).includes('Body'), 'KV holds routing only');
  });
}
