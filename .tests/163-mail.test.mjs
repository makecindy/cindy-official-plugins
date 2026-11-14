import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

const pluginRoot = new URL('../163-mail/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ghost.json', pluginRoot), 'utf8'));
const mainSource = readFileSync(new URL('main.js', pluginRoot), 'utf8');
const settingsSource = readFileSync(new URL('settings.js', pluginRoot), 'utf8');
const require = createRequire(import.meta.url);
const worker = require('../163-mail/src/worker.cjs');

class FakeBroadcastChannel {
  static instances = [];

  constructor(name) {
    this.name = name;
    this.messages = [];
    this.onmessage = null;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(message);
  }
}

function response(value, ok = true) {
  return {
    ok,
    async json() {
      return value;
    },
  };
}

function createMainHarness(nodeResponder, initial = {}) {
  FakeBroadcastChannel.instances.length = 0;
  const nodeRequests = [];
  const sent = [];
  const kv = {
    email: initial.email || 'user@163.com',
    credentialSlot: initial.credentialSlot || 'a',
  };
  const secretSaved = {
    a: initial.secretSaved !== false,
    b: initial.secretSavedB === true,
  };
  let hostHandler;
  let resolveToolResult;
  const fetchCalls = [];
  const cindy = {
    node: {
      async request(request) {
        nodeRequests.push(request);
        return nodeResponder(request);
      },
    },
    onHostMessage(handler) {
      hostHandler = handler;
    },
    async send(message) {
      sent.push(message);
      if (message.type === 'tool-result' && resolveToolResult) {
        const resolve = resolveToolResult;
        resolveToolResult = null;
        resolve(message);
      }
    },
  };
  async function fetch(path, options = {}) {
    fetchCalls.push({ path, options });
    if (path === '/kv') return response({ ...kv });
    if (path === '/secrets') {
      return response([
        { key: 'mail_163_authorization_code', saved: secretSaved.a },
        { key: 'mail_163_authorization_code_b', saved: secretSaved.b },
      ]);
    }
    return response(null, false);
  }
  new Script(mainSource, { filename: '163-mail/main.js' }).runInContext(createContext({
    BroadcastChannel: FakeBroadcastChannel,
    Map,
    Number,
    Object,
    Promise,
    String,
    cindy,
    fetch,
    isFinite,
    setTimeout,
  }));
  return {
    channel: FakeBroadcastChannel.instances[0],
    fetchCalls,
    nodeRequests,
    sent,
    setSecretSaved(slot, value) {
      secretSaved[slot] = value;
    },
    async settings(action, payload, reqId = `settings-${action}`) {
      const channel = FakeBroadcastChannel.instances[0];
      channel.onmessage({ data: { type: 'settings-request', reqId, action, payload } });
      for (let index = 0; index < 20; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        const result = channel.messages.find((message) => message.reqId === reqId);
        if (result) return result;
      }
      throw new Error('settings response timed out');
    },
    call(tool, args = {}) {
      return new Promise((resolve) => {
        resolveToolResult = resolve;
        hostHandler({ type: 'tool-call', tool, args, callId: `call-${tool}` });
      });
    },
  };
}

function createWorkerHarness(overrides = {}, parseMessage = async () => ({})) {
  const client = {
    async connect() {},
    async logout() {},
    async getMailboxLock() {
      return { release() {} };
    },
    ...overrides,
  };
  return {
    client,
    deps: {
      createImap() {
        return client;
      },
      createSmtp() {
        throw new Error('unexpected SMTP');
      },
      createComposer() {
        throw new Error('unexpected composer');
      },
      parseMessage,
    },
  };
}

test('manifest 声明 Cindy 持久凭证及其最小 Node 注入范围', () => {
  assert.equal(manifest.id, '163-mail');
  // Shape, not a pinned value: this test is about the secret bindings, and a
  // hardcoded version goes stale on every release bump.
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(Object.hasOwn(manifest, 'slots'), false);
  assert.deepEqual(manifest.node.secretBindings, [
    {
      key: 'mail_163_authorization_code',
      label: '客户端授权密码 A',
      methods: ['account/connect-a', 'mail/action-a'],
      hint: '163 邮箱生成的 16 位客户端授权密码，不是邮箱登录密码',
      url: 'https://help.mail.163.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4b8f4f8e49998b374173cfe9171305fa1ce630d7f67ac2a5feb28b66796d3b',
    },
    {
      key: 'mail_163_authorization_code_b',
      label: '客户端授权密码 B',
      methods: ['account/connect-b', 'mail/action-b'],
      hint: '163 邮箱生成的 16 位客户端授权密码，不是邮箱登录密码',
      url: 'https://help.mail.163.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4b8f4f8e49998b374173cfe9171305fa1ce630d7f67ac2a5feb28b66796d3b',
    },
  ]);
  assert.match(manifest.description, /Cindy 安全保存/);
  assert.equal(worker.MAIL_163.imapHost, 'imap.163.com');
  assert.equal(worker.MAIL_163.imapPort, 993);
  assert.equal(worker.MAIL_163.smtpHost, 'smtp.163.com');
  assert.equal(worker.MAIL_163.smtpPort, 465);
});

test('设置页使用双凭证槽安全切换，BroadcastChannel 不发送客户端授权密码', () => {
  assert.match(settingsSource, /fetch\('\/secrets\/'\s*\+\s*SECRET_KEYS\[credentialSlot\]/);
  assert.match(settingsSource, /body:\s*JSON\.stringify\(\{\s*value:\s*value\s*\}\)/);
  assert.match(
    settingsSource,
    /payload:\s*\{\s*email:\s*email,\s*credentialSlot:\s*credentialSlot\s*\}/,
  );
  assert.doesNotMatch(mainSource, /authorizationCode/);
  assert.match(
    settingsSource,
    /fetch\('\/wake'\)\.then\(beginPosting,\s*beginPosting\)/,
    '设置页必须等 /wake 完成后再开始发送连接请求',
  );
  const stageIndex = settingsSource.indexOf(
    'await saveAuthorizationCode(candidateSlot, authorizationCode)',
  );
  const validateIndex = settingsSource.indexOf(
    'await sendConnect(email, candidateSlot, 50000)',
  );
  const commitIndex = settingsSource.indexOf(
    'await saveAccountState(email, candidateSlot)',
  );
  assert.ok(stageIndex >= 0 && stageIndex < validateIndex);
  assert.ok(validateIndex < commitIndex);
  assert.match(settingsSource, /render\(previousState\s*\|\|\s*\{\s*connected:\s*false\s*\}\)/);
});

test('Worker 仅接受 @163.com 地址和去空格后 16 位的客户端授权密码', () => {
  assert.deepEqual(
    worker.normalizeCredentials({
      email: 'USER@163.COM',
      authorizationCode: 'abcd efgh ijkl mnop',
    }),
    {
      email: 'user@163.com',
      authorizationCode: 'abcdefghijklmnop',
    },
  );
  assert.deepEqual(
    worker.normalizeCredentials({
      email: 'user@163.com',
      authorizationCode: 'Ab1c Def2 Gh3i Jk4l',
    }),
    {
      email: 'user@163.com',
      authorizationCode: 'Ab1cDef2Gh3iJk4l',
    },
  );
  assert.throws(
    () => worker.normalizeCredentials({
      email: 'user@example.com',
      authorizationCode: 'abcdefghijklmnop',
    }),
    /INVALID_EMAIL/,
  );
  assert.throws(
    () => worker.normalizeCredentials({
      email: 'user@163.com',
      authorizationCode: 'not-a-login-password',
    }),
    /INVALID_AUTHORIZATION_CODE/,
  );
});

test('main.js 的连接与邮件请求只携带邮箱和非敏感凭证槽位', async () => {
  const harness = createMainHarness(async (request) => ({
    ok: true,
    result: request.method === 'account/connect-b'
      ? { connected: true, email: 'user@163.com', persistence: 'cindy-safe-storage' }
      : { folder: 'INBOX', messages: [] },
  }));

  const connected = await harness.settings('connect', {
    email: 'USER@163.com',
    credentialSlot: 'b',
  });
  assert.equal(connected.ok, true);
  assert.equal(harness.nodeRequests[0].method, 'account/connect-b');
  assert.equal(
    JSON.stringify(harness.nodeRequests[0].params),
    JSON.stringify({ email: 'user@163.com', credentialSlot: 'b' }),
  );

  const result = await harness.call('mail_163', { action: 'search', text: '账单' });
  assert.equal(result.ok, true);
  assert.equal(harness.nodeRequests[1].method, 'mail/action-a');
  assert.equal(harness.nodeRequests[1].params.email, 'user@163.com');
  assert.equal(harness.nodeRequests[1].params.credentialSlot, 'a');
  assert.equal('credentials' in harness.nodeRequests[1].params, false);
  assert.equal('authorizationCode' in harness.nodeRequests[1].params, false);
});

test('状态取自 Cindy 持久存储，不依赖 Worker 是否仍在运行', async () => {
  const harness = createMainHarness(async () => {
    throw new Error('status 不应唤醒 Worker');
  });
  const connected = await harness.call('mail_163_status');
  assert.equal(
    JSON.stringify(connected.result),
    JSON.stringify({
      connected: true,
      email: 'user@163.com',
      persistence: 'cindy-safe-storage',
    }),
  );
  assert.equal(harness.nodeRequests.length, 0);

  harness.setSecretSaved('a', false);
  const disconnected = await harness.call('mail_163_status');
  assert.equal(disconnected.result.connected, false);
  assert.equal(disconnected.result.email, 'user@163.com');
});

test('Worker 构造安全的搜索条件并保留 IMAP folder + UID 身份', () => {
  const criteria = worker.buildSearchCriteria({
    text: 'project',
    unread: true,
    from: 'alice@example.com',
    since: '2026-07-01',
  });
  assert.equal(criteria.seen, false);
  assert.equal(criteria.from, 'alice@example.com');
  assert.equal(criteria.since instanceof Date, true);
  assert.deepEqual(criteria.or, [
    { subject: 'project' },
    { from: 'project' },
    { to: 'project' },
    { body: 'project' },
  ]);
  const summary = worker.summaryFromMessage({
    uid: 42,
    envelope: {
      from: [{ name: 'Alice', address: 'alice@example.com' }],
      to: [{ address: 'user@163.com' }],
      subject: 'Hello',
      date: new Date('2026-07-24T08:00:00Z'),
    },
    flags: new Set(),
    size: 100,
  }, 'INBOX');
  assert.equal(summary.uid, 42);
  assert.equal(summary.folder, 'INBOX');
  assert.equal(summary.unread, true);
});

test('Worker 每次只消费宿主注入凭证，并让 IMAP 操作 connect + logout', async () => {
  const calls = [];
  class FakeImap {
    async connect() { calls.push('connect'); }
    async logout() { calls.push('logout'); }
    close() { calls.push('close'); }
    async list() {
      calls.push('list');
      return [{ path: 'INBOX', name: 'INBOX', delimiter: '/', specialUse: '\\Inbox', flags: new Set() }];
    }
  }
  const deps = {
    createImap(options) {
      assert.equal(options.email, 'user@163.com');
      assert.equal(options.authorizationCode, 'abcdefghijklmnop');
      return new FakeImap();
    },
    createSmtp() {
      throw new Error('unexpected SMTP');
    },
    createComposer() {
      throw new Error('unexpected composer');
    },
    parseMessage() {
      throw new Error('unexpected parser');
    },
  };
  const connectRequest = {
    method: 'account/connect-b',
    params: { email: 'user@163.com', credentialSlot: 'b' },
    cindy: {
      secrets: {
        mail_163_authorization_code_b: 'abcdefghijklmnop',
      },
    },
  };
  const connected = await worker.handleRequest(connectRequest, {
    ...deps,
    createSmtp() {
      return {
        async verify() { calls.push('smtp-verify'); },
        close() { calls.push('smtp-close'); },
      };
    },
  });
  assert.equal(connected.persistence, 'cindy-safe-storage');
  assert.equal(connectRequest.cindy.secrets.mail_163_authorization_code_b, '');

  calls.length = 0;
  const actionRequest = {
    method: 'mail/action-a',
    params: {
      email: 'user@163.com',
      credentialSlot: 'a',
      action: { action: 'list_folders' },
    },
    cindy: {
      secrets: {
        mail_163_authorization_code: 'abcdefghijklmnop',
      },
    },
  };
  const result = await worker.handleRequest(actionRequest, deps);
  assert.deepEqual(calls, ['connect', 'list', 'logout']);
  assert.equal(result.folders[0].path, 'INBOX');
  assert.equal(actionRequest.cindy.secrets.mail_163_authorization_code, '');
  assert.equal(JSON.stringify(result).includes('abcdefghijklmnop'), false);
});

test('Worker 拒绝 params 伪造的客户端授权密码，只信任宿主注入字段', async () => {
  await assert.rejects(
    worker.handleRequest({
      method: 'mail/action-a',
      params: {
        email: 'user@163.com',
        authorizationCode: 'forged-code',
        action: { action: 'list_folders' },
      },
    }),
    /客户端授权密码/,
  );
});

test('Worker 拒绝方法绑定与参数声明不一致的凭证槽位', async () => {
  await assert.rejects(
    worker.handleRequest({
      method: 'mail/action-a',
      params: {
        email: 'user@163.com',
        credentialSlot: 'b',
        action: { action: 'list_folders' },
      },
      cindy: {
        secrets: {
          mail_163_authorization_code: 'abcdefghijklmnop',
        },
      },
    }),
    /凭证状态无效/,
  );
});

test('Worker 不会把不存在或未更新的 UID 误报为标记成功', async () => {
  let mutationCalls = 0;
  const missing = createWorkerHarness({
    async fetchOne() {
      return false;
    },
    async messageFlagsAdd() {
      mutationCalls += 1;
      return true;
    },
  });
  await assert.rejects(
    worker.performAction(
      { email: 'user@163.com', authorizationCode: 'abcdefghijklmnop' },
      { action: 'mark_read', folder: 'INBOX', message_uid: 404 },
      missing.deps,
    ),
    /MESSAGE_NOT_FOUND/,
  );
  assert.equal(mutationCalls, 0);

  const unchanged = createWorkerHarness({
    async fetchOne() {
      return { uid: 42, flags: new Set() };
    },
    async messageFlagsAdd() {
      mutationCalls += 1;
      return false;
    },
  });
  await assert.rejects(
    worker.performAction(
      { email: 'user@163.com', authorizationCode: 'abcdefghijklmnop' },
      { action: 'mark_read', folder: 'INBOX', message_uid: 42 },
      unchanged.deps,
    ),
    /MESSAGE_NOT_FOUND/,
  );
  assert.equal(mutationCalls, 1);
});

test('Worker 以 messageMove 结果判断移动成功，COPYUID 映射为可选信息', async () => {
  let moveCalls = 0;
  const missing = createWorkerHarness({
    async fetchOne() {
      return false;
    },
    async messageMove() {
      moveCalls += 1;
      return { path: 'INBOX', destination: 'Archive' };
    },
  });
  await assert.rejects(
    worker.performAction(
      { email: 'user@163.com', authorizationCode: 'abcdefghijklmnop' },
      { action: 'move', folder: 'INBOX', target_folder: 'Archive', message_uid: 404 },
      missing.deps,
    ),
    /MESSAGE_NOT_FOUND/,
  );
  assert.equal(moveCalls, 0);

  const unchanged = createWorkerHarness({
    async fetchOne() {
      return { uid: 42 };
    },
    async messageMove() {
      moveCalls += 1;
      return false;
    },
  });
  await assert.rejects(
    worker.performAction(
      { email: 'user@163.com', authorizationCode: 'abcdefghijklmnop' },
      { action: 'move', folder: 'INBOX', target_folder: 'Archive', message_uid: 42 },
      unchanged.deps,
    ),
    /MESSAGE_NOT_FOUND/,
  );
  assert.equal(moveCalls, 1);

  const withoutCopyUid = createWorkerHarness({
    async fetchOne() {
      return { uid: 42 };
    },
    async messageMove() {
      moveCalls += 1;
      return { path: 'INBOX', destination: 'Archive' };
    },
  });
  const withoutCopyUidResult = await worker.performAction(
    { email: 'user@163.com', authorizationCode: 'abcdefghijklmnop' },
    { action: 'move', folder: 'INBOX', target_folder: 'Archive', message_uid: 42 },
    withoutCopyUid.deps,
  );
  assert.equal(withoutCopyUidResult.moved, true);
  assert.equal(withoutCopyUidResult.destination_uid, null);

  const withCopyUid = createWorkerHarness({
    async fetchOne() {
      return { uid: 42 };
    },
    async messageMove() {
      moveCalls += 1;
      return { uidMap: new Map([[42, 142]]) };
    },
  });
  const result = await worker.performAction(
    { email: 'user@163.com', authorizationCode: 'abcdefghijklmnop' },
    { action: 'move', folder: 'INBOX', target_folder: 'Archive', message_uid: 42 },
    withCopyUid.deps,
  );
  assert.equal(result.moved, true);
  assert.equal(result.destination_uid, 142);
  assert.equal(moveCalls, 3);
});

test('Worker 不会把 IMAP append 返回 false 误报为草稿保存成功', async () => {
  const harness = createWorkerHarness({
    async list() {
      return [{ path: 'Drafts', specialUse: '\\Drafts' }];
    },
    async append() {
      return false;
    },
  });
  harness.deps.createComposer = () => ({
    async sendMail() {
      return { message: Buffer.from('Subject: Test\r\n\r\nDraft') };
    },
    close() {},
  });

  await assert.rejects(
    worker.performAction(
      { email: 'user@163.com', authorizationCode: 'abcdefghijklmnop' },
      {
        action: 'draft',
        to: 'recipient@example.com',
        subject: 'Test',
        body_text: 'Draft',
      },
      harness.deps,
    ),
    /DRAFT_SAVE_FAILED/,
  );
});

test('Worker 分块读取邮件，并在解析前拒绝超过 12 MiB 的内容', async () => {
  const maxSourceBytes = 12 * 1024 * 1024;
  let parseCalls = 0;
  const harness = createWorkerHarness({
    async fetchOne(_uid, query) {
      assert.equal(query.source, undefined);
      return {
        uid: 42,
        envelope: {},
        flags: new Set(),
        size: null,
      };
    },
    async download(_uid, part, options) {
      assert.equal(part, undefined);
      assert.equal(options.uid, true);
      assert.equal(options.maxBytes, maxSourceBytes + 1);
      return {
        meta: { expectedSize: null },
        content: Readable.from([Buffer.alloc(maxSourceBytes + 1)]),
      };
    },
  }, async () => {
    parseCalls += 1;
    return {};
  });

  await assert.rejects(
    worker.performAction(
      { email: 'user@163.com', authorizationCode: 'abcdefghijklmnop' },
      { action: 'read', folder: 'INBOX', message_uid: 42 },
      harness.deps,
    ),
    /MESSAGE_TOO_LARGE/,
  );
  assert.equal(parseCalls, 0);
});

test('Worker 将认证、网络与频控错误转换成可行动文案', () => {
  assert.match(
    worker.humanizeError(Object.assign(new Error('Authentication failed'), { code: 'EAUTH' })),
    /客户端授权密码/,
  );
  assert.match(worker.humanizeError(Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' })), /网络/);
  assert.match(worker.humanizeError(new Error('Too many simultaneous connections')), /稍后/);
  assert.match(worker.humanizeError(new Error('DRAFT_SAVE_FAILED')), /草稿/);
});

// Shared common-mail-card adapter, exercised end to end with Cindy's SDK.
import { runImapComposeSuite } from './imap-mail-compose.test.mjs';
runImapComposeSuite('163-mail', { email: 'user@163.com', kv: { credentialSlot: 'a' }, secretKeys: ['mail_163_authorization_code'], providerName: '163 邮箱' });

// Regression tests for issue #277: 163 IMAP silently returns an empty result for
// any criteria-based SEARCH. The worker must fall back to a bounded SEARCH ALL
// scan with client-side filtering, without changing the no-filter path.

function createSearchHarness(messages, searchImpl, harnessOptions = {}) {
  const searchCalls = [];
  const fetchCalls = [];
  class FakeImap {
    async connect() {}
    async logout() {}
    close() {}
    async getMailboxLock() { return { release() {} }; }
    async search(criteria, options) {
      searchCalls.push({ criteria, options });
      return searchImpl(criteria, options);
    }
    async fetchAll(uids) {
      fetchCalls.push(uids);
      const wanted = new Set(uids);
      const found = messages.filter((message) => wanted.has(message.uid));
      return harnessOptions.shuffleFetch ? found.slice().reverse() : found;
    }
  }
  return {
    searchCalls,
    fetchCalls,
    deps: {
      createImap() { return new FakeImap(); },
      createSmtp() { throw new Error('unexpected SMTP'); },
      createComposer() { throw new Error('unexpected composer'); },
      parseMessage() { throw new Error('unexpected parser'); },
    },
  };
}

// fixture 邮箱一律使用保留域名 example.test；登录账号因 worker 强制校验
// @163.com，沿用仓库既有测试里的 user@163.com。
const SENT_AT = new Date('2026-07-24T08:00:00Z');
const RECEIVED_AT = new Date('2026-07-25T09:00:00Z');

function mailFixture(uid, subject, overrides = {}) {
  return {
    uid,
    envelope: {
      from: [{ name: 'Alice', address: overrides.from || 'alice@example.test' }],
      to: [{ address: 'recipient@example.test' }],
      subject,
      date: overrides.sentDate || SENT_AT,
      messageId: `<${uid}@example.test>`,
    },
    flags: new Set(['\\Seen']),
    size: 1024,
    internalDate: overrides.internalDate || RECEIVED_AT,
  };
}

function callSearch(deps, filters) {
  return worker.handleRequest({
    method: 'mail/action-a',
    params: {
      email: 'user@163.com',
      credentialSlot: 'a',
      action: { action: 'search', folder: '已发送', max_results: 10, ...filters },
    },
    cindy: { secrets: { mail_163_authorization_code: 'abcdefghijklmnop' } },
  }, deps);
}

const fallbackMessages = [
  mailFixture(1, '周报'),
  mailFixture(2, 'BH016 邮件预览测试'),
  mailFixture(3, 'BH016 长邮件滚动测试', { from: 'sender@example.test' }),
  mailFixture(4, '无关邮件'),
];
const allUids = fallbackMessages.map((message) => message.uid);
const emptyOnCriteria = (criteria) => (criteria.all ? allUids : []);

test('163-mail: 条件型 SEARCH 返回空时回退 SEARCH ALL 并按 envelope 过滤', async () => {
  const h = createSearchHarness(fallbackMessages, emptyOnCriteria);
  const result = await callSearch(h.deps, { subject: 'BH016' });
  assert.equal(result.folder, '已发送');
  assert.equal(result.total, 2);
  assert.deepEqual(result.messages.map((message) => message.uid), [3, 2]);
  assert.equal(h.searchCalls.length, 2);
  assert.deepEqual(h.searchCalls[0].criteria, { subject: 'BH016' });
  assert.deepEqual(h.searchCalls[0].options, { uid: true });
  assert.deepEqual(h.searchCalls[1].criteria, { all: true });
});

test('163-mail: 回退路径同样覆盖 from 与 text 条件', async () => {
  const h1 = createSearchHarness(fallbackMessages, emptyOnCriteria);
  const r1 = await callSearch(h1.deps, { from: 'sender' });
  assert.equal(r1.total, 1);
  assert.equal(r1.messages[0].uid, 3);

  const h2 = createSearchHarness(fallbackMessages, emptyOnCriteria);
  const r2 = await callSearch(h2.deps, { text: 'BH016' });
  assert.equal(r2.total, 2);
});

test('163-mail: 服务端正常命中与无条件搜索都不触发回退', async () => {
  const hit = createSearchHarness(fallbackMessages, () => [2, 3]);
  const r1 = await callSearch(hit.deps, { subject: 'BH016' });
  assert.equal(r1.total, 2);
  assert.equal(hit.searchCalls.length, 1);

  const plain = createSearchHarness(fallbackMessages, () => allUids);
  const r2 = await callSearch(plain.deps, {});
  assert.equal(r2.total, 4);
  assert.equal(plain.searchCalls.length, 1);
  assert.deepEqual(plain.searchCalls[0].criteria, { all: true });
});

test('163-mail: 回退后仍不匹配时返回 0，不产生假阳性', async () => {
  const h = createSearchHarness(fallbackMessages, emptyOnCriteria);
  const r = await callSearch(h.deps, { subject: 'NOT-PRESENT' });
  assert.equal(r.total, 0);
  assert.deepEqual(r.messages, []);
  assert.equal(h.searchCalls.length, 2);
});

// 审查反馈：发信日与收信日不同、BEFORE 边界、以及 FETCH 乱序返回。
const dateMessages = [
  mailFixture(11, 'BH016 发信日早于收信日', {
    sentDate: new Date('2026-07-24T08:00:00Z'),
    internalDate: new Date('2026-07-25T10:00:00Z'),
  }),
  mailFixture(12, 'BH016 收信日落在截止日', {
    internalDate: new Date('2026-07-26T00:00:00Z'),
  }),
];
const emptyOnDateCriteria = (criteria) => (criteria.all ? [11, 12] : []);

test('163-mail: 回退的 SINCE 按收信日而非邮件头发信日比较', async () => {
  const h = createSearchHarness(dateMessages, emptyOnDateCriteria);
  const r = await callSearch(h.deps, { since: '2026-07-25' });
  assert.equal(r.total, 2);
  assert.deepEqual(r.messages.map((message) => message.uid), [12, 11]);
});

test('163-mail: 回退的 BEFORE 不含截止当天，带时刻时按 imapflow 顺延一天', async () => {
  const h1 = createSearchHarness(dateMessages, emptyOnDateCriteria);
  const r1 = await callSearch(h1.deps, { before: '2026-07-26' });
  assert.equal(r1.total, 1);
  assert.equal(r1.messages[0].uid, 11);

  const h2 = createSearchHarness(dateMessages, emptyOnDateCriteria);
  const r2 = await callSearch(h2.deps, { before: '2026-07-25T12:00:00Z' });
  assert.equal(r2.total, 1);
  assert.equal(r2.messages[0].uid, 11);

  const h3 = createSearchHarness(dateMessages, emptyOnDateCriteria);
  const r3 = await callSearch(h3.deps, { before: '2026-07-25' });
  assert.equal(r3.total, 0);
});

test('163-mail: fetchAll 乱序返回时仍按 UID 取最近的匹配项', async () => {
  const h = createSearchHarness(fallbackMessages, emptyOnCriteria, { shuffleFetch: true });
  const r = await callSearch(h.deps, { subject: 'BH016' });
  assert.equal(r.total, 2);
  assert.deepEqual(r.messages.map((message) => message.uid), [3, 2]);
});
