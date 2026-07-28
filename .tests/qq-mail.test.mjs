import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

const pluginRoot = new URL('../qq-mail/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ghost.json', pluginRoot), 'utf8'));
const mainSource = readFileSync(new URL('main.js', pluginRoot), 'utf8');
const settingsHtml = readFileSync(new URL('settings.html', pluginRoot), 'utf8');
const settingsSource = readFileSync(new URL('settings.js', pluginRoot), 'utf8');
const require = createRequire(import.meta.url);
const worker = require('../qq-mail/src/worker.cjs');

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
  const kv = { email: initial.email || 'user@qq.com' };
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
      return response([{ key: 'qq_mail_authorization_code', saved: secretSaved }]);
    }
    return response(null, false);
  }
  new Script(mainSource, { filename: 'qq-mail/main.js' }).runInContext(createContext({
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
  assert.equal(manifest.id, 'qq-mail');
  // Shape, not a pinned value: this test is about the secret bindings, and a
  // hardcoded version goes stale on every release bump.
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(manifest.slots, ['tool', 'node']);
  assert.equal(manifest.settingsHtml, 'settings.html');
  assert.equal(
    Object.hasOwn(manifest, 'settingsHeight'),
    false,
    'QQ 邮箱设置页应由宿主按内容自适应高度',
  );
  assert.deepEqual(manifest.node.secretBindings, [{
    key: 'qq_mail_authorization_code',
    label: 'IMAP/SMTP 授权码',
    methods: ['account/connect', 'mail/action'],
    hint: 'QQ 邮箱生成的 IMAP/SMTP 授权码，不是 QQ 密码',
    url: 'https://wx.mail.qq.com/account',
  }]);
  assert.match(manifest.description, /Cindy 安全保存/);
});

test('设置页把授权码直接写入 /secrets，BroadcastChannel 只发送邮箱', () => {
  assert.match(settingsSource, /fetch\('\/secrets\/'\s*\+\s*SECRET_KEY/);
  assert.match(settingsSource, /body:\s*JSON\.stringify\(\{\s*value:\s*value\s*\}\)/);
  assert.match(settingsSource, /payload:\s*\{\s*email:\s*email\s*\}/);
  assert.doesNotMatch(mainSource, /authorizationCode/);
  assert.match(
    settingsSource,
    /fetch\('\/wake'\)\.then\(beginPosting,\s*beginPosting\)/,
    '设置页必须等 /wake 完成后再开始发送连接请求',
  );
});

test('设置页跟随宿主四语言并以英文回退', () => {
  assert.match(settingsHtml, /<html lang="en">/);
  assert.match(settingsSource, /fetch\('\/app-context'\)/);
  assert.doesNotMatch(settingsSource, /navigator\.(?:language|languages)/);
  for (const locale of ['en', 'zh-CN', 'ja', 'ko']) {
    assert.match(settingsSource, new RegExp(`(?:^|\\n)    ['"]?${locale.replace('-', '\\-')}['"]?: \\{`));
  }
  assert.match(settingsSource, /currentLocale = 'en'/);
  assert.match(settingsSource, /document\.documentElement\.lang = currentLocale/);
});

test('main.js 的连接与邮件请求都只携带非敏感邮箱地址', async () => {
  const harness = createMainHarness(async (request) => ({
    ok: true,
    result: request.method === 'account/connect'
      ? { connected: true, email: 'user@qq.com', persistence: 'cindy-safe-storage' }
      : { folder: 'INBOX', messages: [] },
  }));

  const connected = await harness.settings('connect', { email: 'USER@qq.com' });
  assert.equal(connected.ok, true);
  assert.equal(
    JSON.stringify(harness.nodeRequests[0].params),
    JSON.stringify({ email: 'user@qq.com' }),
  );

  const result = await harness.call('qq_mail', { action: 'search', text: '账单' });
  assert.equal(result.ok, true);
  assert.equal(harness.nodeRequests[1].method, 'mail/action');
  assert.equal(harness.nodeRequests[1].params.email, 'user@qq.com');
  assert.equal('credentials' in harness.nodeRequests[1].params, false);
  assert.equal('authorizationCode' in harness.nodeRequests[1].params, false);
});

test('状态取自 Cindy 持久存储，不依赖 Worker 是否仍在运行', async () => {
  const harness = createMainHarness(async () => {
    throw new Error('status 不应唤醒 Worker');
  });
  const connected = await harness.call('qq_mail_status');
  assert.equal(
    JSON.stringify(connected.result),
    JSON.stringify({
      connected: true,
      email: 'user@qq.com',
      persistence: 'cindy-safe-storage',
    }),
  );
  assert.equal(harness.nodeRequests.length, 0);

  harness.setSecretSaved(false);
  const disconnected = await harness.call('qq_mail_status');
  assert.equal(disconnected.result.connected, false);
  assert.equal(disconnected.result.email, 'user@qq.com');
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
      to: [{ address: 'user@qq.com' }],
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
      assert.equal(options.email, 'user@qq.com');
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
    method: 'account/connect',
    params: { email: 'user@qq.com' },
    cindy: { secrets: { qq_mail_authorization_code: 'abcdefghijklmnop' } },
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
  assert.equal(connectRequest.cindy.secrets.qq_mail_authorization_code, '');

  calls.length = 0;
  const actionRequest = {
    method: 'mail/action',
    params: {
      email: 'user@qq.com',
      action: { action: 'list_folders' },
    },
    cindy: { secrets: { qq_mail_authorization_code: 'abcdefghijklmnop' } },
  };
  const result = await worker.handleRequest(actionRequest, deps);
  assert.deepEqual(calls, ['connect', 'list', 'logout']);
  assert.equal(result.folders[0].path, 'INBOX');
  assert.equal(actionRequest.cindy.secrets.qq_mail_authorization_code, '');
  assert.equal(JSON.stringify(result).includes('abcdefghijklmnop'), false);
});

test('Worker 拒绝 params 伪造的授权码，只信任宿主注入字段', async () => {
  await assert.rejects(
    worker.handleRequest({
      method: 'mail/action',
      params: {
        email: 'user@qq.com',
        authorizationCode: 'forged-code',
        action: { action: 'list_folders' },
      },
    }),
    /授权码/,
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
      { email: 'user@qq.com', authorizationCode: 'abcdefghijklmnop' },
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
      { email: 'user@qq.com', authorizationCode: 'abcdefghijklmnop' },
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
      { email: 'user@qq.com', authorizationCode: 'abcdefghijklmnop' },
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
      { email: 'user@qq.com', authorizationCode: 'abcdefghijklmnop' },
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
      { email: 'user@qq.com', authorizationCode: 'abcdefghijklmnop' },
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
    { email: 'user@qq.com', authorizationCode: 'abcdefghijklmnop' },
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
      { email: 'user@qq.com', authorizationCode: 'abcdefghijklmnop' },
      { action: 'read', folder: 'INBOX', message_uid: 42 },
      harness.deps,
    ),
    /MESSAGE_TOO_LARGE/,
  );
  assert.equal(parseCalls, 0);
});

test('Worker 将认证、网络与频控错误转换成可行动文案', () => {
  assert.match(worker.humanizeError(Object.assign(new Error('Authentication failed'), { code: 'EAUTH' })), /授权码/);
  assert.match(worker.humanizeError(Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' })), /网络/);
  assert.match(worker.humanizeError(new Error('Too many simultaneous connections')), /稍后/);
  assert.match(worker.humanizeError(new Error('MESSAGE_MOVE_UNCONFIRMED')), /重新搜索/);
});
