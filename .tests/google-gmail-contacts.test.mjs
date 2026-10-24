import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../google-gmail/main.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const person = { resourceName: 'people/c123', metadata: { sources: [{ type: 'CONTACT', id: '123', etag: 'version-one' }] },
  names: [{ givenName: 'Test' }], emailAddresses: [{ value: 'person@example.test' }],
  photos: [{ url: 'https://photos.example.test/contact.jpg' }] };
const json = (data, status = 200) => ({ ok: true, status, body: JSON.stringify(data) });

function fixture(options = {}) {
  let handler;
  const requests = [], replies = [];
  const accounts = options.accounts || [{ id: 'account-one', label: 'owner@example.test', status: 'connected', scopeStale: true }];
  const ctx = createContext({ URLSearchParams,
    fetch: async url => {
      if (url === '/kv') return { ok: true, json: async () => ({}) };
      assert.equal(url, '/oauth');
      return { ok: true, json: async () => [{ key: 'gmail_account', clientConfigured: true, accounts }] };
    },
    cindy: {
      onHostMessage: fn => { handler = fn; },
      send: async result => {
        if (options.failDelivery && replies.length === 0) { replies.push('lost'); throw new Error('delivery lost'); }
        replies.push(copy(result));
      },
      fetch: async request => {
        requests.push(copy(request));
        assert.equal(new URL(request.url).origin, 'https://people.googleapis.com');
        assert.equal(request.authAccount, options.expectedAccount || 'account-one');
        assert.equal(request.callId, 'contacts-call');
        assert.equal(request.headers?.Authorization, undefined);
        return options.reply ? options.reply(request, requests.length) : json(person);
      },
    },
  });
  runInContext(source, ctx);
  return { requests, replies, async call(args) {
    await handler({ type: 'tool-call', tool: 'gmail_contacts', callId: 'contacts-call', args: {
      session_context: { workdir_is_read_only: false }, ...args,
    } });
    return replies.at(-1);
  } };
}

test('contacts: search warms cache, retains photos, encodes queries and preserves selected account', async () => {
  const f = fixture({ reply: () => json({ results: [{ person }] }) });
  const result = await f.call({ action: 'search', query: 'person+tag@example.test', pageSize: 100 });
  assert.equal(result.ok, true);
  assert.equal(f.requests.length, 2);
  assert.equal(new URL(f.requests[0].url).searchParams.get('query'), '');
  assert.equal(new URL(f.requests[1].url).searchParams.get('query'), 'person+tag@example.test');
  assert.equal(new URL(f.requests[1].url).searchParams.get('pageSize'), '30');
  assert.deepEqual(result.result.data.results[0].person.photos, person.photos);
  assert.equal(result.result.execution, 'not_executed', 'reads do not claim mutations');
});

test('contacts: paged personal, other and directory lookups expose continuation tokens', async () => {
  for (const action of ['list', 'other_contacts', 'directory']) {
    const f = fixture({ reply: () => json({ nextPageToken: 'next+page' }) });
    const result = await f.call({ action, query: 'Test', pageToken: 'page+/=', pageSize: 25 });
    assert.equal(result.result.data.nextPageToken, 'next+page');
    const url = new URL(f.requests[0].url);
    assert.equal(url.searchParams.get('pageToken'), 'page+/=');
    assert.equal(url.searchParams.get('pageSize'), '25');
    if (action === 'directory') assert.deepEqual(url.searchParams.getAll('sources'), ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE', 'DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT']);
  }
});

test('contacts: never falls back from ambiguous, missing or expired accounts', async () => {
  const accounts = [{ id: 'account-one', status: 'connected' }, { id: 'account-two', status: 'expired' }];
  for (const account of [undefined, 'missing', 'account-two']) {
    const f = fixture({ accounts });
    const result = await f.call({ action: 'create', account, person: { names: [{ givenName: 'Test' }] } });
    assert.equal(result.ok, false);
    assert.match(result.message, /\[not_executed\]/);
    assert.equal(f.requests.length, 0);
  }
  const f = fixture({ accounts, expectedAccount: 'account-one' });
  assert.equal((await f.call({ action: 'list', account: 'account-one' })).ok, true);
});

test('contacts: rejects invalid writes and readonly sessions before network access', async () => {
  for (const args of [
    { action: 'create', person: {} },
    { action: 'create', person: { names: [] } },
    { action: 'create', person: { photos: [{ url: 'https://example.test' }] } },
    { action: 'create', person: { names: [{ givenName: 'A' }, { givenName: 'B' }] } },
    { action: 'create', person: { emailAddresses: [{ type: 'work' }] } },
    { action: 'update', resourceName: 'people/c123', person: { names: [] } },
    { action: 'delete', resourceName: 'people/me' },
    { action: 'delete', resourceName: 'people/../../other' },
    { action: 'delete', resourceName: 'people/c123?key=other' },
    { action: 'delete', resourceName: 'people/c123', session_context: undefined },
    { action: 'delete', resourceName: 'people/c123', session_context: { workdir_is_read_only: true } },
    { action: 'list', pageSize: 101 },
    { action: 'directory', query: '' },
  ]) {
    const f = fixture();
    const result = await f.call(args);
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.match(result.message, /\[not_executed\]/);
    assert.equal(f.requests.length, 0);
  }
});

test('contacts: create performs exactly one mutation and returns observed receipt', async () => {
  const f = fixture();
  const input = { names: [{ givenName: 'Test' }], emailAddresses: [{ value: 'person@example.test', type: 'work' }] };
  const result = await f.call({ action: 'create', person: input });
  assert.equal(result.result.execution, 'executed');
  assert.equal(result.result.data.resourceName, 'people/c123');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, 'POST');
  assert.deepEqual(JSON.parse(f.requests[0].body), input);
});

test('contacts: update checks source etag, replaces only supplied fields, and can clear a field', async () => {
  const f = fixture();
  const result = await f.call({ action: 'update', resourceName: 'people/c123', etag: 'version-one', person: { phoneNumbers: [] } });
  assert.equal(result.result.execution, 'executed');
  assert.deepEqual(f.requests.map(r => r.method), ['GET', 'PATCH']);
  const body = JSON.parse(f.requests[1].body);
  assert.deepEqual(body.phoneNumbers, []);
  assert.equal(body.emailAddresses, undefined);
  assert.deepEqual(body.metadata.sources, person.metadata.sources);
  assert.equal(new URL(f.requests[1].url).searchParams.get('updatePersonFields'), 'phoneNumbers');
  const stale = fixture();
  const failed = await stale.call({ action: 'update', resourceName: 'people/c123', etag: 'old-version', person: { phoneNumbers: [] } });
  assert.match(failed.message, /\[not_executed\].*已变化/);
  assert.equal(stale.requests.length, 1);
});

test('contacts: failed pre-write read never claims the contact was modified', async () => {
  const f = fixture({ reply: () => ({ ok: true, status: 200, body: 'broken' }) });
  const result = await f.call({ action: 'update', resourceName: 'people/c123', etag: 'version-one', person: { phoneNumbers: [] } });
  assert.match(result.message, /\[not_executed\]/);
  assert.equal(f.requests.length, 1);
});

test('contacts: update returns a changed server resource name for subsequent operations', async () => {
  const updated = { ...person, resourceName: 'people/c456' };
  const f = fixture({ reply: (_, count) => json(count === 1 ? person : updated) });
  const result = await f.call({ action: 'update', resourceName: person.resourceName, etag: 'version-one',
    person: { emailAddresses: [{ value: 'new@example.test' }] } });
  assert.equal(result.ok, true);
  assert.equal(result.result.execution, 'executed');
  assert.equal(result.result.data.resourceName, updated.resourceName);
  assert.equal(new URL(f.requests[1].url).pathname, '/v1/people/c123:updateContact');
  const next = await f.call({ action: 'get', resourceName: result.result.data.resourceName });
  assert.equal(next.ok, true);
  assert.equal(new URL(f.requests[2].url).pathname, '/v1/people/c456');
  assert.deepEqual(f.requests.map(request => request.method), ['GET', 'PATCH', 'GET']);
});

test('contacts: update still rejects malformed successful receipts without retrying the write', async () => {
  for (const resourceName of [undefined, '', 'groups/123', 'people/../../other', 'people/c456?key=other']) {
    const f = fixture({ reply: (_, count) => json(count === 1 ? person : { resourceName }) });
    const result = await f.call({ action: 'update', resourceName: person.resourceName, etag: 'version-one',
      person: { emailAddresses: [{ value: 'new@example.test' }] } });
    assert.equal(result.ok, false);
    assert.match(result.message, /\[executed\].*回执不完整/);
    assert.deepEqual(f.requests.map(request => request.method), ['GET', 'PATCH']);
  }
});

test('contacts: delete accepts empty successful response and does not retry', async () => {
  const f = fixture({ reply: () => ({ ok: true, status: 200, body: '' }) });
  const result = await f.call({ action: 'delete', resourceName: 'people/c123' });
  assert.equal(result.result.execution, 'executed');
  assert.equal(result.result.data.deleted, true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body, undefined);
});

for (const [title, reply, expected] of [
  ['permission denied', () => json({}, 403), 'not_executed'],
  ['etag conflict', () => json({}, 400), 'not_executed'],
  ['server failure', () => json({}, 503), 'unknown'],
  ['transport failure', () => ({ ok: false, message: 'timeout' }), 'unknown'],
  ['thrown transport failure', () => { throw new Error('lost'); }, 'unknown'],
  ['truncated success', () => ({ ...json(person), truncated: true }), 'executed'],
  ['malformed success', () => ({ ok: true, status: 200, body: 'broken' }), 'executed'],
  ['incomplete receipt', () => json({}), 'executed'],
]) test('contacts: ' + title + ' preserves mutation outcome through result delivery failure', async () => {
  for (const failDelivery of [false, true]) {
    const f = fixture({ reply, failDelivery });
    const result = await f.call({ action: 'create', person: { names: [{ givenName: 'Test' }] } });
    assert.equal(result.ok, false);
    assert.ok(result.message.startsWith('[' + expected + ']'), result.message);
    assert.equal(f.requests.length, 1, 'no automatic write retry');
  }
});

test('contacts: successful mutation stays executed if final IPC delivery fails', async () => {
  const f = fixture({ failDelivery: true });
  const result = await f.call({ action: 'create', person: { names: [{ givenName: 'Test' }] } });
  assert.equal(result.ok, false);
  assert.match(result.message, /\[executed\]/);
});
