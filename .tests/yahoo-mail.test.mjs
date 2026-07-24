import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

const pluginRoot = new URL('../yahoo-mail/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ghost.json', pluginRoot), 'utf8'));
const mainSource = readFileSync(new URL('main.js', pluginRoot), 'utf8');
const settingsSource = readFileSync(new URL('settings.js', pluginRoot), 'utf8');
const require = createRequire(import.meta.url);
const worker = require('../yahoo-mail/src/worker.cjs');

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
  const kv = { email: initial.email || 'user@yahoo.com' };
  let secretSaved = initial.secretSaved !== false;
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
      return response([{ key: 'yahoo_mail_app_password', saved: secretSaved }]);
    }
    return response(null, false);
  }
  new Script(mainSource, { filename: 'yahoo-mail/main.js' }).runInContext(createContext({
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
    setSecretSaved(value) {
      secretSaved = value;
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
  assert.equal(manifest.id, 'yahoo-mail');
  assert.equal(manifest.version, '0.1.0');
  assert.deepEqual(manifest.slots, ['tool', 'node']);
  assert.deepEqual(manifest.node.secretBindings, [{
    key: 'yahoo_mail_app_password',
    label: 'Yahoo 应用密码',
    methods: ['account/connect', 'mail/action'],
    hint: 'Yahoo 账户安全页面生成的应用密码，不是 Yahoo 账户密码',
    url: 'https://help.yahoo.com/kb/account/access-yahoo-mail-third-party-apps-sln15241.html',
  }]);
  assert.match(manifest.description, /Cindy 安全保存/);
});

test('Worker 使用 Yahoo 官方 IMAP/SMTP SSL 端点', () => {
  assert.deepEqual(worker.YAHOO, {
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
  });
});

test('设置页把 Yahoo 应用密码直接写入 /secrets，BroadcastChannel 只发送邮箱', () => {
  assert.match(settingsSource, /fetch\('\/secrets\/'\s*\+\s*SECRET_KEY/);
  assert.match(settingsSource, /body:\s*JSON\.stringify\(\{\s*value:\s*value\s*\}\)/);
  assert.match(settingsSource, /payload:\s*\{\s*email:\s*email\s*\}/);
  assert.doesNotMatch(mainSource, /appPassword/);
  assert.match(
    settingsSource,
    /fetch\('\/wake'\)\.then\(beginPosting,\s*beginPosting\)/,
    '设置页必须等 /wake 完成后再开始发送连接请求',
  );
});

test('main.js 的连接与邮件请求都只携带非敏感邮箱地址', async () => {
  const harness = createMainHarness(async (request) => ({
    ok: true,
    result: request.method === 'account/connect'
      ? { connected: true, email: 'user@yahoo.com', persistence: 'cindy-safe-storage' }
      : { folder: 'INBOX', messages: [] },
  }));

  const connected = await harness.settings('connect', { email: 'USER@yahoo.com' });
  assert.equal(connected.ok, true);
  assert.equal(
    JSON.stringify(harness.nodeRequests[0].params),
    JSON.stringify({ email: 'user@yahoo.com' }),
  );

  const result = await harness.call('yahoo_mail', { action: 'search', text: '账单' });
  assert.equal(result.ok, true);
  assert.equal(harness.nodeRequests[1].method, 'mail/action');
  assert.equal(harness.nodeRequests[1].params.email, 'user@yahoo.com');
  assert.equal('credentials' in harness.nodeRequests[1].params, false);
  assert.equal('appPassword' in harness.nodeRequests[1].params, false);
});

test('状态取自 Cindy 持久存储，不依赖 Worker 是否仍在运行', async () => {
  const harness = createMainHarness(async () => {
    throw new Error('status 不应唤醒 Worker');
  });
  const connected = await harness.call('yahoo_mail_status');
  assert.equal(
    JSON.stringify(connected.result),
    JSON.stringify({
      connected: true,
      email: 'user@yahoo.com',
      persistence: 'cindy-safe-storage',
    }),
  );
  assert.equal(harness.nodeRequests.length, 0);

  harness.setSecretSaved(false);
  const disconnected = await harness.call('yahoo_mail_status');
  assert.equal(disconnected.result.connected, false);
  assert.equal(disconnected.result.email, 'user@yahoo.com');
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
      to: [{ address: 'user@yahoo.com' }],
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
      assert.equal(options.email, 'user@yahoo.com');
      assert.equal(options.appPassword, 'abcdefghijklmnop');
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
    method: 'account/connect',
    params: { email: 'user@yahoo.com' },
    cindy: { secrets: { yahoo_mail_app_password: 'abcdefghijklmnop' } },
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
  assert.equal(connectRequest.cindy.secrets.yahoo_mail_app_password, '');

  calls.length = 0;
  const actionRequest = {
    method: 'mail/action',
    params: {
      email: 'user@yahoo.com',
      action: { action: 'list_folders' },
    },
    cindy: { secrets: { yahoo_mail_app_password: 'abcdefghijklmnop' } },
  };
  const result = await worker.handleRequest(actionRequest, deps);
  assert.deepEqual(calls, ['connect', 'list', 'logout']);
  assert.equal(result.folders[0].path, 'INBOX');
  assert.equal(actionRequest.cindy.secrets.yahoo_mail_app_password, '');
  assert.equal(JSON.stringify(result).includes('abcdefghijklmnop'), false);
});

test('Worker 拒绝 params 伪造的应用密码，只信任宿主注入字段', async () => {
  await assert.rejects(
    worker.handleRequest({
      method: 'mail/action',
      params: {
        email: 'user@yahoo.com',
        appPassword: 'forged-code',
        action: { action: 'list_folders' },
      },
    }),
    /应用密码/,
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
      { email: 'user@yahoo.com', appPassword: 'abcdefghijklmnop' },
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
      { email: 'user@yahoo.com', appPassword: 'abcdefghijklmnop' },
      { action: 'mark_read', folder: 'INBOX', message_uid: 42 },
      unchanged.deps,
    ),
    /MESSAGE_NOT_FOUND/,
  );
  assert.equal(mutationCalls, 1);
});

test('Worker 仅在服务器返回目标 UID 映射时报告移动成功', async () => {
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
      { email: 'user@yahoo.com', appPassword: 'abcdefghijklmnop' },
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
      { email: 'user@yahoo.com', appPassword: 'abcdefghijklmnop' },
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
  await assert.rejects(
    worker.performAction(
      { email: 'user@yahoo.com', appPassword: 'abcdefghijklmnop' },
      { action: 'move', folder: 'INBOX', target_folder: 'Archive', message_uid: 42 },
      withoutCopyUid.deps,
    ),
    /MESSAGE_MOVE_UNCONFIRMED/,
  );

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
    { email: 'user@yahoo.com', appPassword: 'abcdefghijklmnop' },
    { action: 'move', folder: 'INBOX', target_folder: 'Archive', message_uid: 42 },
    withCopyUid.deps,
  );
  assert.equal(result.moved, true);
  assert.equal(result.destination_uid, 142);
  assert.equal(moveCalls, 3);
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
      { email: 'user@yahoo.com', appPassword: 'abcdefghijklmnop' },
      { action: 'read', folder: 'INBOX', message_uid: 42 },
      harness.deps,
    ),
    /MESSAGE_TOO_LARGE/,
  );
  assert.equal(parseCalls, 0);
});

test('Worker 将认证、网络与频控错误转换成可行动文案', () => {
  assert.match(worker.humanizeError(Object.assign(new Error('Authentication failed'), { code: 'EAUTH' })), /应用密码/);
  assert.match(worker.humanizeError(Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' })), /网络/);
  assert.match(worker.humanizeError(new Error('Too many simultaneous connections')), /稍后/);
  assert.match(worker.humanizeError(new Error('MESSAGE_MOVE_UNCONFIRMED')), /重新搜索/);
});
