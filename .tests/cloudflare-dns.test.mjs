import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL('../cloudflare-dns/' + name, import.meta.url), 'utf8');
const zone_id = 'a'.repeat(32);
const id = 'b'.repeat(32);
const record = {type: 'A', name: 'app.example.test', content: '192.0.2.1', ttl: 1, proxied: false};
const before = {...record, content: '192.0.2.2', id};
const args = {zone_id, before, record};
const success = result => ({ok: true, status: 200, body: JSON.stringify({success: true, result})});
const missing = {ok: true, status: 404, body: JSON.stringify({success: false, errors: [{code: 81044}]})};

async function invoke(tool, responses, approval = {ok: true, confirmed: true}, input = args) {
  const requests = [];
  const dialogs = [];
  let handler, reply;
  vm.runInNewContext(read('main.js'), {cindy: {
    onHostMessage(fn) { handler = fn; },
    send(value) { reply = value; },
    confirm(spec) { dialogs.push(spec); return approval; },
    fetch(spec) {
      requests.push(spec);
      assert.equal(spec.callId, 'test-call');
      assert.equal(new URL(spec.url).origin, 'https://api.cloudflare.com');
      assert.equal(spec.headers?.Authorization, undefined);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  }});
  await handler({type: 'tool-call', tool, args: input, callId: 'test-call'});
  return {reply, requests, dialogs};
}

test('only the provider API receives host-injected credentials', () => {
  const {network} = JSON.parse(read('ghost.json'));
  assert.deepEqual(network.hosts, ['api.cloudflare.com']);
  assert.deepEqual(network.secrets[0].inject, {header: 'Authorization', format: 'Bearer {value}', hosts: network.hosts});
});

for (const tool of ['create_dns_record', 'update_dns_record', 'delete_dns_record']) {
  test(tool + ' requires explicit approval before any request', async () => {
    for (const approval of [{ok: true, confirmed: false}, {ok: false, confirmed: true}, {}]) {
      const {reply, requests, dialogs} = await invoke(tool, [], approval);
      assert.equal(reply.errorCode, 'not_executed');
      assert.equal(requests.length, 0);
      assert.equal(dialogs.length, 1);
      if (tool !== 'create_dns_record') assert.ok(dialogs[0].body.includes(before.content));
      if (tool !== 'delete_dns_record') assert.ok(dialogs[0].body.includes(record.content));
    }
  });
  test(tool + ' reads back the target after a confirmed mutation', async () => {
    const update = tool === 'update_dns_record';
    const del = tool === 'delete_dns_record';
    const responses = [success({id}), del ? missing : success({...record, id})];
    if (del || update) responses.unshift(success(before));
    const {reply, requests} = await invoke(tool, responses);
    assert.equal(reply.result?.verified, true);
    assert.deepEqual(requests.map(r => r.method), del ? ['GET', 'DELETE', 'GET'] :
      update ? ['GET', 'PATCH', 'GET'] : ['POST', 'GET']);
    assert.ok(requests.at(-1).url.endsWith('/dns_records/' + id));
    if (!del) assert.deepEqual(JSON.parse(requests.at(-2).body), record);
  });
}

test('read tools paginate and project response fields', async () => {
  for (const tool of ['list_zones', 'list_dns_records']) {
    const {reply, requests, dialogs} = await invoke(tool, [success([{...before, account: 'private'}])],
      undefined, {zone_id, page: 2, name: record.name});
    assert.equal(dialogs.length, 0);
    assert.equal(reply.result.items[0].name, record.name);
    assert.equal(reply.result.items[0].account, undefined);
    assert.ok(requests[0].url.endsWith('?per_page=25&page=2&name=app.example.test'));
  }
});

test('stale snapshot blocks the mutation', async () => {
  const {reply, requests} = await invoke('delete_dns_record', [success({...before, ttl: 60})]);
  assert.equal(reply.errorCode, 'not_executed');
  assert.deepEqual(requests.map(r => r.method), ['GET']);
});

test('raw transport errors and API error bodies stay private', async () => {
  for (const failure of [new Error('sensitive-marker'), {ok: true, status: 403, body: '{"success":false,"message":"sensitive-marker"}'}]) {
    const {reply, requests} = await invoke('create_dns_record', [failure]);
    assert.equal(reply.errorCode, 'unknown');
    assert.equal(requests.length, 1);
    assert.doesNotMatch(JSON.stringify(reply), /sensitive-marker/);
  }
});

test('successful write with failed verification retains executed outcome', async () => {
  const {reply} = await invoke('create_dns_record', [success({id}), success(before)]);
  assert.equal(reply.errorCode, 'executed');
  assert.match(reply.message, /Read-back differs/);
});

test('settings clears the password and sends it only to the host secret store', async () => {
  for (const ok of [true, false]) {
    let submit;
    const input = {value: 'fake-test-marker'};
    const status = {};
    const form = {
      addEventListener(event, fn) { assert.equal(event, 'submit'); submit = fn; },
      querySelector() { return {}; },
    };
    const document = {getElementById: id => ({token: input, status, settings: form})[id]};
    const requests = [];
    vm.runInNewContext(read('settings.js'), {document, fetch: async (path, spec) => {
      requests.push({path, method: spec.method, value: JSON.parse(spec.body).value});
      assert.equal(input.value, '');
      return {ok};
    }});
    await submit({preventDefault() {}});
    assert.deepEqual(requests, [{path: '/secrets/cloudflare_token', method: 'PUT', value: 'fake-test-marker'}]);
    assert.doesNotMatch(status.textContent, /fake-test-marker/);
    assert.equal(status.textContent, ok ? 'Token saved.' : 'Could not save token.');
  }
});
