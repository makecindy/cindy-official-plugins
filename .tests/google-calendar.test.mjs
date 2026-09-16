import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import './google-account-metadata.test.mjs';
import './google-workspace-tool-schema.test.mjs';
import './google-workspace-worker-paths.test.mjs';

const source = readFileSync(new URL('../google-calendar/main.js', import.meta.url), 'utf8');
const event = { id: 'event-1', summary: '<产品评审>', location: '会议室',
  htmlLink: 'https://calendar.google.com/calendar/event?eid=abc&x=1',
  start: { date: '2026-09-17' }, end: { date: '2026-09-18' } };

async function call(command, data, options = {}) {
  const messages = [], requests = [];
  let handler;
  const ctx = createContext({
    fetch: async url => {
      assert.ok(url === '/oauth' || url === '/kv');
      return { ok: true, json: async () => url === '/kv' ? {} : [{ key: 'google_calendar_account',
        clientConfigured: true, accounts: [{ id: 'acc-1', label: 'work@example.test', status: 'connected' }] }] };
    },
    cindy: { onHostMessage: fn => { assert.equal(handler, undefined); handler = fn; },
      send: async message => {
        if (options.cardFailure && message.type === 'card-update') throw new Error('card unavailable');
        messages.push(JSON.parse(JSON.stringify(message)));
      },
      node: { request: async request => { requests.push(request);
        if (options.throw) throw new Error('worker stopped');
        return { ok: true, result: options.failure || { ok: true, data } };
      } },
    },
  });
  runInContext(source, ctx);
  await handler({ type: 'tool-call', tool: options.tool || 'google_calendar_run', callId: 'call-1',
    args: { command: [command], arguments: ['primary'], options: options.flags || {},
      session_context: { workdir_is_read_only: false, workdir_is_local: true, workdir: '/test-workdir' } } });
  assert.equal(messages.filter(m => m.type === 'tool-result').length, 1);
  return { messages, requests };
}

test('gog 原始日程输出生成卡片，不调用第二套 Google API', async () => {
  for (const [command, data, label] of [
    ['events', { events: [event] }, '日程'], ['event', { event }, '日程详情'],
    ['create', { event }, '日程已创建'], ['update', { event }, '日程已修改'],
  ]) {
    const { messages, requests } = await call(command, data, { flags: { location: '会议室' } });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].authAccount, 'acc-1');
    assert.equal(requests[0].params.options.location, '会议室');
    assert.equal(messages[0].type, 'card-update');
    assert.match(messages[0].html, new RegExp(label));
    assert.match(messages[0].html, /&lt;产品评审&gt;|全天/);
    assert.match(messages[0].html, /data-ghost-link=.*abc&amp;x=1/);
    assert.ok(messages[0].height >= 104 && messages[0].height <= 720);
    assert.deepEqual(messages.at(-1).result, data);
  }
});

test('空日历和删除回执真实展示，不捏造删除前详情', async () => {
  assert.match((await call('events', { events: [] })).messages[0].html, /这段时间没有日程/);
  const deleted = await call('delete', { deleted: true, eventId: 'event-1' });
  assert.match(deleted.messages[0].html, /日程已从 Google Calendar 删除/);
  assert.doesNotMatch(deleted.messages[0].html, /全天|data-ghost-link=/);
});

test('未识别结果、未知执行结果与卡片失败不伪造业务结果', async () => {
  assert.equal((await call('events', 'unexpected output')).messages.length, 1);
  assert.equal((await call('update', { event }, { cardFailure: true })).messages[0].ok, true);
  const failed = await call('update', null, { failure: { ok: false, execution: 'unknown', message: 'Check remote state before retrying' } });
  assert.equal(failed.messages.length, 1);
  assert.match(failed.messages[0].message, /\[unknown\]/);
  assert.equal((await call('update', null, { throw: true })).messages[0].ok, false);
});

test('旧工具不会再发起请求；schema 不需要账号凭证', async () => {
  const old = await call('events', {}, { tool: 'google_calendar' });
  assert.equal(old.requests.length, 0);
  assert.equal(old.messages[0].ok, false);
  const schema = await call('events', { name: 'events' }, { tool: 'google_calendar_schema' });
  assert.equal(schema.requests[0].method, 'schema');
  assert.equal(schema.requests[0].authAccount, undefined);
});
