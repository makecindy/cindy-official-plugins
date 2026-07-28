import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

const pluginRoot = new URL('../163-mail/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ghost.json', pluginRoot), 'utf8'));
const mainSource = readFileSync(new URL('main.js', pluginRoot), 'utf8');
const settingsHtml = readFileSync(new URL('settings.html', pluginRoot), 'utf8');
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
  assert.deepEqual(manifest.slots, ['tool', 'node']);
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
