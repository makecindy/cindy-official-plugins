import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

const pluginRoot = new URL('../icloud-mail/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ghost.json', pluginRoot), 'utf8'));
const mainSource = readFileSync(new URL('main.js', pluginRoot), 'utf8');
const settingsSource = readFileSync(new URL('settings.js', pluginRoot), 'utf8');
const settingsHtml = readFileSync(new URL('settings.html', pluginRoot), 'utf8');
const HOST_LOCALES = ['zh-CN', 'en', 'ja', 'ko'];
const require = createRequire(import.meta.url);
const worker = require('../icloud-mail/src/worker.cjs');

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

// appContext: 宿主 app-context 的 locale（字符串），或自定义 request 实现（函数），
// 或 null 表示宿主不提供 cindy.request。既有用例默认按 zh-CN 运行。
function createMainHarness(nodeResponder, initial = {}, appContext = 'zh-CN', options = {}) {
  FakeBroadcastChannel.instances.length = 0;
  const appContextRequests = [];
  const nodeRequests = [];
  const sent = [];
  const kv = {
    email: initial.email || 'user@icloud.com',
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
    ...(appContext === null ? {} : {
      async request(request) {
        appContextRequests.push(request);
        // 请求对象来自 vm 上下文（另一个 realm），比较序列化结果而不是原型。
        assert.equal(JSON.stringify(request), JSON.stringify({ kind: 'app-context' }));
        if (typeof appContext === 'function') return appContext(request);
        return { ok: true, context: { region: 'global', locale: appContext } };
      },
    }),
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
        { key: 'icloud_mail_app_password', saved: secretSaved.a },
        { key: 'icloud_mail_app_password_b', saved: secretSaved.b },
      ]);
    }
    return response(null, false);
  }
  const context = createContext({
    BroadcastChannel: FakeBroadcastChannel,
    Map,
    Number,
    Object,
    Promise,
    String,
    cindy,
    clearTimeout,
    fetch,
    isFinite,
    setTimeout: options.setTimeout || setTimeout,
  });
  new Script(mainSource, { filename: 'icloud-mail/main.js' }).runInContext(context);
  return {
    appContextRequests,
    context,
    channel: FakeBroadcastChannel.instances[0],
    hostMessage(message) {
      hostHandler(message);
    },
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
  assert.equal(manifest.id, 'icloud-mail');
  // Shape, not a pinned value: this test is about the secret bindings, and a
  // hardcoded version goes stale on every release bump.
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(Object.hasOwn(manifest, 'slots'), false);
  assert.deepEqual(manifest.node.secretBindings, [
    {
      key: 'icloud_mail_app_password',
      label: 'Apple 账户 App 专用密码 A',
      methods: ['account/connect-a', 'mail/action-a'],
      hint: '在 Apple 账户网站生成的 App 专用密码，不是 Apple 账户密码',
      url: 'https://account.apple.com/',
    },
    {
      key: 'icloud_mail_app_password_b',
      label: 'Apple 账户 App 专用密码 B',
      methods: ['account/connect-b', 'mail/action-b'],
      hint: '在 Apple 账户网站生成的 App 专用密码，不是 Apple 账户密码',
      url: 'https://account.apple.com/',
    },
  ]);
  manifest.node.secretBindings.forEach((binding) => {
    assert.match(binding.key, /^[a-z][a-z0-9_]{0,31}$/);
  });
  assert.match(manifest.description, /Cindy 安全保存/);
});

test('设置页使用双凭证槽安全切换，BroadcastChannel 不发送 App 专用密码', () => {
  assert.match(settingsSource, /fetch\('\/secrets\/'\s*\+\s*SECRET_KEYS\[credentialSlot\]/);
  assert.match(settingsSource, /body:\s*JSON\.stringify\(\{\s*value:\s*value\s*\}\)/);
  assert.match(
    settingsSource,
    /payload:\s*\{\s*email:\s*email,\s*credentialSlot:\s*credentialSlot\s*\}/,
  );
  assert.doesNotMatch(mainSource, /appSpecificPassword/);
  assert.match(
    settingsSource,
    /fetch\('\/wake'\)\.then\(beginPosting,\s*beginPosting\)/,
    '设置页必须等 /wake 完成后再开始发送连接请求',
  );
  const stageIndex = settingsSource.indexOf(
    'await saveAppSpecificPassword(candidateSlot, appSpecificPassword)',
  );
  const validateIndex = settingsSource.indexOf(
    'await sendConnect(email, candidateSlot, 50000)',
  );
  const commitIndex = settingsSource.indexOf(
    'await saveAccountState(email, candidateSlot)',
  );
  const commitStartedIndex = settingsSource.indexOf('commitStarted = true');
  assert.ok(stageIndex >= 0 && stageIndex < validateIndex);
  assert.ok(validateIndex < commitStartedIndex && commitStartedIndex < commitIndex);
  assert.match(settingsSource, /candidateStored\s*&&\s*!commitStarted/);
  assert.doesNotMatch(settingsSource, /candidateStored\s*&&\s*!committed/);
  assert.match(settingsSource, /render\(previousState\s*\|\|\s*\{\s*connected:\s*false\s*\}\)/);
});

test('main.js 的连接与邮件请求只携带邮箱和非敏感凭证槽位', async () => {
  const harness = createMainHarness(async (request) => ({
    ok: true,
    result: request.method === 'account/connect-b'
      ? { connected: true, email: 'user@icloud.com', persistence: 'cindy-safe-storage' }
      : { folder: 'INBOX', messages: [] },
  }));

  const connected = await harness.settings('connect', {
    email: 'USER@ICLOUD.COM',
    credentialSlot: 'b',
  });
  assert.equal(connected.ok, true);
  assert.equal(harness.nodeRequests[0].method, 'account/connect-b');
  assert.equal(
    JSON.stringify(harness.nodeRequests[0].params),
    JSON.stringify({ email: 'user@icloud.com', credentialSlot: 'b', locale: 'zh-CN' }),
  );

  const result = await harness.call('icloud_mail', { action: 'search', text: '账单' });
  assert.equal(result.ok, true);
  assert.equal(harness.nodeRequests[1].method, 'mail/action-a');
  assert.equal(harness.nodeRequests[1].params.email, 'user@icloud.com');
  assert.equal(harness.nodeRequests[1].params.credentialSlot, 'a');
  assert.equal(harness.nodeRequests[1].params.locale, 'zh-CN');
  assert.deepEqual(
    Object.keys(harness.nodeRequests[1].params).sort(),
    ['action', 'credentialSlot', 'email', 'locale'],
  );
  assert.equal('credentials' in harness.nodeRequests[1].params, false);
  assert.equal('appSpecificPassword' in harness.nodeRequests[1].params, false);
});

test('状态取自 Cindy 持久存储，不依赖 Worker 是否仍在运行', async () => {
  const harness = createMainHarness(async () => {
    throw new Error('status 不应唤醒 Worker');
  });
  const connected = await harness.call('icloud_mail_status');
  assert.equal(
    JSON.stringify(connected.result),
    JSON.stringify({
      connected: true,
      email: 'user@icloud.com',
      persistence: 'cindy-safe-storage',
    }),
  );
  assert.equal(harness.nodeRequests.length, 0);

  harness.setSecretSaved('a', false);
  const disconnected = await harness.call('icloud_mail_status');
  assert.equal(disconnected.result.connected, false);
  assert.equal(disconnected.result.email, 'user@icloud.com');
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
      to: [{ address: 'user@icloud.com' }],
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

test('Worker 使用 Apple 官方 IMAP 与 SMTP STARTTLS 配置', () => {
  const credentials = {
    email: 'user@icloud.com',
    appSpecificPassword: 'abcd-efgh-ijkl-mnop',
  };
  assert.deepEqual(worker.ICLOUD, {
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
  });

  const imap = worker.imapOptions(credentials);
  assert.equal(imap.host, 'imap.mail.me.com');
  assert.equal(imap.port, 993);
  assert.equal(imap.secure, true);
  assert.equal(imap.auth.user, 'user@icloud.com');
  assert.equal(imap.auth.pass, 'abcd-efgh-ijkl-mnop');

  const smtp = worker.smtpOptions(credentials);
  assert.equal(smtp.host, 'smtp.mail.me.com');
  assert.equal(smtp.port, 587);
  assert.equal(smtp.secure, false);
  assert.equal(smtp.requireTLS, true);
  assert.equal(smtp.auth.user, 'user@icloud.com');
  assert.equal(smtp.auth.pass, 'abcd-efgh-ijkl-mnop');
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
      assert.equal(options.email, 'user@icloud.com');
      assert.equal(options.appSpecificPassword, 'abcd-efgh-ijkl-mnop');
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
    params: { email: 'user@icloud.com', credentialSlot: 'b' },
    cindy: {
      secrets: {
        icloud_mail_app_password_b: 'abcd-efgh-ijkl-mnop',
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
  assert.equal(connectRequest.cindy.secrets.icloud_mail_app_password_b, '');

  calls.length = 0;
  const actionRequest = {
    method: 'mail/action-a',
    params: {
      email: 'user@icloud.com',
      credentialSlot: 'a',
      action: { action: 'list_folders' },
    },
    cindy: {
      secrets: {
        icloud_mail_app_password: 'abcd-efgh-ijkl-mnop',
      },
    },
  };
  const result = await worker.handleRequest(actionRequest, deps);
  assert.deepEqual(calls, ['connect', 'list', 'logout']);
  assert.equal(result.folders[0].path, 'INBOX');
  assert.equal(actionRequest.cindy.secrets.icloud_mail_app_password, '');
  assert.equal(JSON.stringify(result).includes('abcd-efgh-ijkl-mnop'), false);
});

test('Worker 拒绝 params 伪造的 App 专用密码，只信任宿主注入字段', async () => {
  await assert.rejects(
    worker.handleRequest({
      method: 'mail/action-a',
      params: {
        email: 'user@icloud.com',
        appSpecificPassword: 'forged-code',
        action: { action: 'list_folders' },
        locale: 'zh-CN',
      },
    }),
    /App 专用密码/,
  );
});

test('Worker 拒绝方法绑定与参数声明不一致的凭证槽位', async () => {
  await assert.rejects(
    worker.handleRequest({
      method: 'mail/action-a',
      params: {
        email: 'user@icloud.com',
        credentialSlot: 'b',
        action: { action: 'list_folders' },
        locale: 'zh-CN',
      },
      cindy: {
        secrets: {
          icloud_mail_app_password: 'abcd-efgh-ijkl-mnop',
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
      { email: 'user@icloud.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop' },
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
      { email: 'user@icloud.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop' },
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
      { email: 'user@icloud.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop' },
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
      { email: 'user@icloud.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop' },
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
      { email: 'user@icloud.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop' },
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
    { email: 'user@icloud.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop' },
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
      { email: 'user@icloud.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop' },
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
      { email: 'user@icloud.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop' },
      { action: 'read', folder: 'INBOX', message_uid: 42 },
      harness.deps,
    ),
    /MESSAGE_TOO_LARGE/,
  );
  assert.equal(parseCalls, 0);
});

test('Worker 将认证、网络与频控错误转换成可行动文案', () => {
  assert.match(worker.humanizeError(Object.assign(new Error('Authentication failed'), { code: 'EAUTH' }), 'zh-CN'), /App 专用密码/);
  assert.match(worker.humanizeError(Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' }), 'zh-CN'), /网络/);
  assert.match(worker.humanizeError(new Error('Too many simultaneous connections'), 'zh-CN'), /稍后/);
  assert.match(worker.humanizeError(new Error('MESSAGE_MOVE_UNCONFIRMED'), 'zh-CN'), /重新搜索/);
  assert.match(worker.humanizeError(new Error('DRAFT_SAVE_FAILED'), 'zh-CN'), /草稿/);
});

// ---------------------------------------------------------------------------
// 运行时与设置页本地化（docs/localization.md：只跟随宿主语言，缺失或不支持时回退英文）
// ---------------------------------------------------------------------------

function assertCompleteDictionary(messages, label) {
  assert.deepEqual(Object.keys(messages).sort(), [...HOST_LOCALES].sort(), `${label} locales`);
  const expectedKeys = Object.keys(messages.en).sort();
  assert.ok(expectedKeys.length > 0, `${label} has no keys`);
  for (const locale of HOST_LOCALES) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), expectedKeys, `${label}/${locale} keys`);
    for (const key of expectedKeys) {
      assert.equal(typeof messages[locale][key], 'string', `${label}/${locale}.${key}`);
      assert.ok(messages[locale][key].trim(), `${label}/${locale}.${key} is empty`);
    }
  }
  // 同一键在四种语言里不能完全相同（漏翻会表现为复制英文或中文）。
  // 只由 ASCII 标识符组成的文案除外。
  for (const key of expectedKeys) {
    const values = HOST_LOCALES.map((locale) => messages[locale][key]);
    if (values.every((value) => /^[\x20-\x7e]*$/.test(value))) continue;
    assert.equal(new Set(values).size, HOST_LOCALES.length, `${label}.${key} is not translated in every locale`);
  }
  const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort();
  for (const key of expectedKeys) {
    for (const locale of HOST_LOCALES) {
      assert.deepEqual(
        placeholders(messages[locale][key]),
        placeholders(messages.en[key]),
        `${label}/${locale}.${key} placeholders`,
      );
    }
  }
}

const WORKER_ERROR_KEYS = [
  [new Error('INVALID_EMAIL'), 'invalidEmail'],
  [new Error('INVALID_APP_SPECIFIC_PASSWORD'), 'invalidAppSpecificPassword'],
  [new Error('NOT_CONFIGURED'), 'notConfigured'],
  [new Error('INVALID_CREDENTIAL_SLOT'), 'invalidCredentialSlot'],
  [Object.assign(new Error('Authentication failed'), { code: 'EAUTH' }), 'authRejected'],
  [Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' }), 'networkUnreachable'],
  [new Error('Too many simultaneous connections'), 'rateLimited'],
  [new Error('MESSAGE_NOT_FOUND'), 'messageNotFound'],
  [new Error('MESSAGE_TOO_LARGE'), 'messageTooLarge'],
  [new Error('DRAFT_FOLDER_NOT_FOUND'), 'draftFolderNotFound'],
  [new Error('DRAFT_SAVE_FAILED'), 'draftSaveFailed'],
  [new Error('TARGET_FOLDER_REQUIRED'), 'targetFolderRequired'],
  [new Error('TARGET_FOLDER_SAME'), 'targetFolderSame'],
  [new Error('MESSAGE_MOVE_UNCONFIRMED'), 'moveUnconfirmed'],
  [new Error('RECIPIENT_REQUIRED'), 'recipientRequired'],
  [new Error('INVALID_RECIPIENT'), 'invalidRecipient'],
  [new Error('INVALID_SUBJECT'), 'invalidSubject'],
  [new Error('INVALID_BODY'), 'invalidBody'],
  [new Error('INVALID_SINCE'), 'invalidSearchDate'],
  [new Error('INVALID_BEFORE'), 'invalidSearchDate'],
  [new Error('Mailbox does not exist'), 'folderUnavailable'],
  [new Error('something unexpected'), 'operationFailedRetry'],
];

test('Worker 四种语言文案键完全一致且无空值', () => {
  assert.equal(worker.DEFAULT_LOCALE, 'en');
  assertCompleteDictionary(worker.MESSAGES, 'worker');
});

test('Worker 每个错误码在四种语言下都映射到对应语言的文案', () => {
  for (const locale of HOST_LOCALES) {
    for (const [error, key] of WORKER_ERROR_KEYS) {
      assert.equal(worker.humanizeError(error, locale), worker.MESSAGES[locale][key], `${locale}/${key}`);
    }
  }
});

test('Worker 未传语言或语言不受支持时回退英文', () => {
  const error = Object.assign(new Error('Authentication failed'), { code: 'EAUTH' });
  for (const locale of [undefined, null, '', 'fr', 'zh-TW', 'EN', 'ja-JP', 42, {}]) {
    assert.equal(worker.humanizeError(error, locale), worker.MESSAGES.en.authRejected, String(locale));
    assert.equal(worker.resolveLocale(locale), 'en');
  }
  assert.match(worker.MESSAGES.en.authRejected, /app-specific password/);
});

test('Worker ja/ko 文案保留安全含义：App 专用密码不是 Apple 账户密码，需要双重认证', () => {
  assert.match(worker.MESSAGES.ja.authRejected, /App用パスワード/);
  assert.match(worker.MESSAGES.ja.authRejected, /2ファクタ認証/);
  assert.match(worker.MESSAGES.ja.authRejected, /Apple アカウントのパスワードではありません/);
  assert.match(worker.MESSAGES.ja.invalidAppSpecificPassword, /Apple アカウントのパスワードは入力しないでください/);
  assert.match(worker.MESSAGES.ko.authRejected, /앱 전용 비밀번호/);
  assert.match(worker.MESSAGES.ko.authRejected, /이중 인증/);
  assert.match(worker.MESSAGES.ko.authRejected, /Apple 계정 비밀번호 아님/);
  assert.match(worker.MESSAGES.ko.invalidAppSpecificPassword, /Apple 계정 비밀번호는 입력하지 마세요/);
  for (const locale of HOST_LOCALES) {
    // move 结果不确定时必须让用户先重新搜索，不能暗示已成功。
    assert.notEqual(worker.MESSAGES[locale].moveUnconfirmed, worker.MESSAGES[locale].messageNotFound);
  }
  assert.doesNotMatch(worker.MESSAGES.en.notConfigured, /\(Rui\)/);
});

test('Worker handleRequest 按 params.locale 返回错误文案', async () => {
  const request = (locale) => ({
    method: 'mail/action-a',
    params: {
      email: 'user@icloud.com',
      action: { action: 'list_folders' },
      ...(locale === undefined ? {} : { locale }),
    },
  });
  const expected = {
    'zh-CN': worker.MESSAGES['zh-CN'].invalidAppSpecificPassword,
    en: worker.MESSAGES.en.invalidAppSpecificPassword,
    ja: worker.MESSAGES.ja.invalidAppSpecificPassword,
    ko: worker.MESSAGES.ko.invalidAppSpecificPassword,
  };
  for (const [locale, message] of Object.entries(expected)) {
    await assert.rejects(worker.handleRequest(request(locale)), (error) => error.message === message);
  }
  await assert.rejects(
    worker.handleRequest(request(undefined)),
    (error) => error.message === expected.en,
  );
  await assert.rejects(
    worker.handleRequest(request('de')),
    (error) => error.message === expected.en,
  );
  await assert.rejects(
    worker.handleRequest({ method: 'mail/action-c', params: { locale: 'ko' } }),
    (error) => error.message === worker.MESSAGES.ko.operationFailedRetry,
  );
});

test('Worker 截断正文的提示跟随语言', async () => {
  const longText = 'x'.repeat(20001);
  const makeHarness = () => createWorkerHarness({
    async fetchOne() {
      return { uid: 7, envelope: {}, flags: new Set(), size: 10 };
    },
    async download() {
      return { meta: { expectedSize: 10 }, content: Readable.from([Buffer.from('raw')]) };
    },
  }, async () => ({ text: longText }));
  const credentials = { email: 'user@icloud.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop' };
  const action = { action: 'read', folder: 'INBOX', message_uid: 7 };
  for (const locale of HOST_LOCALES) {
    const result = await worker.performAction(credentials, action, makeHarness().deps, locale);
    assert.equal(result.body_text, `${'x'.repeat(20000)}\n${worker.MESSAGES[locale].bodyTruncated}`);
  }
  const fallback = await worker.performAction(credentials, action, makeHarness().deps);
  assert.ok(fallback.body_text.endsWith(worker.MESSAGES.en.bodyTruncated));
});

test('Worker 与服务器文本比对的中文字面量不随语言变化', async () => {
  // iCloud 可能以中文返回文件夹名和错误；这两处匹配的是服务器文本，不是界面文案。
  const harness = createWorkerHarness({
    async list() {
      return [{ path: 'INBOX' }, { path: '草稿箱' }];
    },
    async append(folder) {
      return { uid: 9, uidValidity: 1, folder };
    },
  });
  harness.deps.createComposer = () => ({
    async sendMail() {
      return { message: Buffer.from('Subject: Test\r\n\r\nDraft') };
    },
    close() {},
  });
  const saved = await worker.performAction(
    { email: 'user@icloud.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop' },
    { action: 'draft', to: 'recipient@example.test', subject: 'Test', body_text: 'Draft' },
    harness.deps,
    'en',
  );
  assert.equal(saved.folder, '草稿箱');
  for (const locale of HOST_LOCALES) {
    assert.equal(
      worker.humanizeError(new Error('NO 登录过于频繁'), locale),
      worker.MESSAGES[locale].rateLimited,
    );
  }
});

function runBundledWorker(lines) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL('node/worker.cjs', pluginRoot).pathname], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const replies = [];
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('bundled worker timed out'));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        replies.push(JSON.parse(buffer.slice(0, index)));
        buffer = buffer.slice(index + 1);
      }
      if (replies.length === lines.length) {
        clearTimeout(timer);
        child.kill();
        resolve(replies);
      }
    });
    child.on('error', reject);
    child.stdin.write(lines.map((line) => `${line}\n`).join(''));
  });
}

test('提交的 node/worker.cjs 构建产物包含本地化后的错误文案', async () => {
  const replies = await runBundledWorker([
    'not json',
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'mail/action-a', params: { email: 'user@icloud.com', locale: 'ja' } }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'mail/action-a', params: { email: 'user@icloud.com' } }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'mail/action-a', params: { email: 'user@icloud.com', locale: 'zh-CN' } }),
  ]);
  const byId = new Map(replies.map((reply) => [reply.id, reply]));
  assert.equal(byId.get(null).error.message, worker.MESSAGES.en.invalidRequestFormat);
  assert.equal(byId.get(1).error.message, worker.MESSAGES.ja.invalidAppSpecificPassword);
  assert.equal(byId.get(2).error.message, worker.MESSAGES.en.invalidAppSpecificPassword);
  assert.equal(byId.get(3).error.message, worker.MESSAGES['zh-CN'].invalidAppSpecificPassword);
});

test('main.js 四种语言文案键完全一致且无空值', () => {
  const harness = createMainHarness(async () => ({ ok: true, result: {} }));
  assert.equal(harness.context.DEFAULT_LOCALE, 'en');
  assertCompleteDictionary(JSON.parse(JSON.stringify(harness.context.MESSAGES)), 'main');
});

test('main.js 按宿主 app-context 语言返回错误，并把语言传给 Worker', async () => {
  for (const locale of HOST_LOCALES) {
    const harness = createMainHarness(async (request) => ({
      ok: true,
      result: { method: request.method },
    }), {}, locale);
    const messages = harness.context.MESSAGES[locale];

    const badUid = await harness.call('icloud_mail', { action: 'read', message_uid: -1 });
    assert.equal(badUid.ok, false);
    assert.equal(badUid.message, messages.invalidUid);

    const unknownAction = await harness.call('icloud_mail', { action: 'delete_all' });
    assert.equal(unknownAction.message, messages.unknownAction.replace('{action}', 'delete_all'));

    const compose = await harness.call('icloud_mail', { action: 'send', to: 'a@example.test' });
    assert.equal(compose.message, messages.composeNeedsFields.replace('{action}', 'send'));

    const unknownTool = await harness.call('icloud_mail_purge');
    assert.equal(unknownTool.message, messages.unknownTool.replace('{tool}', 'icloud_mail_purge'));

    const ok = await harness.call('icloud_mail', { action: 'list_folders' });
    assert.equal(ok.ok, true);
    assert.equal(harness.nodeRequests.at(-1).params.locale, locale);

    const settings = await harness.settings('connect', { email: 'not-an-email' }, `bad-${locale}`);
    assert.equal(settings.ok, false);
    assert.equal(settings.message, messages.invalidEmail);
    // 语言只查询一次，后续调用复用。
    assert.equal(harness.appContextRequests.length, 1);
  }
});

test('main.js 在未配置账号时给出对应语言的提示', async () => {
  const harness = createMainHarness(async () => {
    throw new Error('未配置时不应调用 Worker');
  }, { secretSaved: false }, 'ko');
  const result = await harness.call('icloud_mail', { action: 'list_folders' });
  assert.equal(result.ok, false);
  assert.equal(result.message, harness.context.MESSAGES.ko.notConfigured);
  assert.equal(harness.nodeRequests.length, 0);
});

test('main.js 在宿主语言缺失、不受支持或查询失败时回退英文', async () => {
  const cases = [
    ['unsupported', 'fr'],
    ['malformed', async () => ({ ok: true, context: {} })],
    ['not ok', async () => ({ ok: false, error: 'DENIED' })],
    ['throws', async () => { throw new Error('host unavailable'); }],
    ['no request API', null],
  ];
  for (const [label, appContext] of cases) {
    const harness = createMainHarness(async () => ({ ok: true, result: {} }), {}, appContext);
    const result = await harness.call('icloud_mail', { action: 'read', message_uid: 0 });
    assert.equal(result.message, harness.context.MESSAGES.en.invalidUid, label);
    await harness.call('icloud_mail', { action: 'list_folders' });
    assert.equal(harness.nodeRequests.at(-1).params.locale, 'en', label);
  }
});

test('main.js 在 app-context 超时时回退英文且下一次调用重新查询', async () => {
  let attempts = 0;
  const harness = createMainHarness(async () => ({ ok: true, result: {} }), {}, () => {
    attempts += 1;
    if (attempts === 1) return new Promise(() => {});
    return { ok: true, context: { locale: 'ja' } };
  }, {
    // 只把语言查询的 3 秒超时缩短为立即触发，其余定时器保持原样。
    setTimeout(callback, ms) {
      return setTimeout(callback, ms === 3000 ? 0 : ms);
    },
  });
  const first = await harness.call('icloud_mail', { action: 'list_folders' });
  assert.equal(first.ok, true);
  assert.equal(harness.nodeRequests.at(-1).params.locale, 'en');
  await harness.call('icloud_mail', { action: 'list_folders' });
  assert.equal(harness.nodeRequests.at(-1).params.locale, 'ja');
  assert.equal(attempts, 2);
});

test('main.js 收到 host-context-changed 后立即切换语言', async () => {
  const harness = createMainHarness(async () => ({ ok: true, result: {} }), {}, 'zh-CN');
  await harness.call('icloud_mail', { action: 'list_folders' });
  assert.equal(harness.nodeRequests.at(-1).params.locale, 'zh-CN');

  harness.hostMessage({ type: 'host-context-changed', context: { region: 'global', locale: 'ko' } });
  const switched = await harness.call('icloud_mail', { action: 'read', message_uid: 'x' });
  assert.equal(switched.message, harness.context.MESSAGES.ko.invalidUid);
  await harness.call('icloud_mail', { action: 'list_folders' });
  assert.equal(harness.nodeRequests.at(-1).params.locale, 'ko');

  harness.hostMessage({ type: 'host-context-changed', context: { locale: 'xx-YY' } });
  await harness.call('icloud_mail', { action: 'list_folders' });
  assert.equal(harness.nodeRequests.at(-1).params.locale, 'en');

  // 格式不对的消息不改变当前语言。
  harness.hostMessage({ type: 'host-context-changed' });
  harness.hostMessage({ type: 'host-context-changed', context: { locale: 7 } });
  await harness.call('icloud_mail', { action: 'list_folders' });
  assert.equal(harness.nodeRequests.at(-1).params.locale, 'en');
  assert.equal(harness.appContextRequests.length, 1);
});

test('main.js 首次语言查询未返回前收到语言切换时，以切换后的语言为准', async () => {
  let release;
  const harness = createMainHarness(async () => ({ ok: true, result: {} }), {}, () => new Promise((resolve) => {
    release = () => resolve({ ok: true, context: { locale: 'zh-CN' } });
  }));
  const pending = harness.call('icloud_mail', { action: 'list_folders' });
  await new Promise((resolve) => setImmediate(resolve));
  harness.hostMessage({ type: 'host-context-changed', context: { locale: 'ja' } });
  release();
  await pending;
  await harness.call('icloud_mail', { action: 'list_folders' });
  assert.equal(harness.nodeRequests.at(-1).params.locale, 'ja');
});

class FakeElement {
  constructor(id, attributes = {}) {
    this.id = id;
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.type = id === 'appSpecificPassword' ? 'password' : '';
    this.attributes = { ...attributes };
    this.listeners = {};
    this.classes = new Set();
    this.classList = {
      toggle: (name, force) => {
        if (force) this.classes.add(name);
        else this.classes.delete(name);
      },
    };
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }
}

// 按 settings.html 的真实标签建元素：带 id 的可 getElementById，带 data-i18n* 的可被
// querySelectorAll 选中，二者是同一个对象（比如 #stateBadge 也带 data-i18n）。
function settingsElementsFromHtml() {
  const byId = new Map();
  const all = [];
  for (const match of settingsHtml.matchAll(/<([a-z0-9]+)\b([^>]*)>/g)) {
    const attributes = {};
    for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) attributes[attr[1]] = attr[2];
    const element = new FakeElement(attributes.id || null, attributes);
    all.push(element);
    if (attributes.id) byId.set(attributes.id, element);
  }
  return { byId, all };
}

async function createSettingsHarness(appContext, options = {}) {
  FakeBroadcastChannel.instances.length = 0;
  const { byId: elements, all } = settingsElementsFromHtml();
  const documentElement = { lang: 'zh-CN' };
  const fetchCalls = [];
  async function fetch(path, init) {
    fetchCalls.push(path);
    if (path === '/app-context') {
      if (typeof appContext === 'function') return appContext(init);
      if (appContext instanceof Error) throw appContext;
      if (appContext === 'http-error') return response(null, false);
      return response({ ok: true, context: { region: 'global', locale: appContext } });
    }
    if (path === '/kv') return response(options.kv || {});
    if (path === '/secrets') return options.secrets === 'http-error' ? response(null, false) : response(options.secrets || []);
    return response(null, false);
  }
  const FakeBroadcast = class extends FakeBroadcastChannel {
    addEventListener() {}
  };
  const context = createContext({
    AbortController,
    BroadcastChannel: FakeBroadcast,
    Object,
    Promise,
    String,
    clearInterval,
    clearTimeout,
    crypto: { randomUUID: () => 'req-1' },
    document: {
      documentElement,
      getElementById(id) {
        const element = elements.get(id);
        if (!element) throw new Error(`settings.html has no #${id}`);
        return element;
      },
      querySelectorAll(selector) {
        const match = /^\[(data-i18n(?:-aria-label)?)\]$/.exec(selector);
        assert.ok(match, `unexpected selector ${selector}`);
        return all.filter((element) => element.getAttribute(match[1]) !== null);
      },
    },
    fetch,
    setInterval,
    setTimeout: options.setTimeout || setTimeout,
  });
  new Script(settingsSource, { filename: 'icloud-mail/settings.js' }).runInContext(context);
  // 缩短后的超时是 setTimeout(0)，至少要过一个 timers 阶段才会触发。
  if (options.setTimeout) await new Promise((resolve) => setTimeout(resolve, 5));
  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return {
    all,
    documentElement,
    elements,
    fetchCalls,
    messages: context.MESSAGES,
    text: (id) => elements.get(id).textContent,
  };
}

const settingsMessages = () => createSettingsHarness('zh-CN').then((page) => page.messages);

test('设置页四种语言文案键完全一致且无空值', async () => {
  assertCompleteDictionary(JSON.parse(JSON.stringify(await settingsMessages())), 'settings');
});

test('设置页静态 HTML 不再内置中文文案，全部由宿主语言填充', () => {
  const visibleText = settingsHtml.replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(visibleText, /[぀-ヿ㐀-鿿가-힯]/);
  assert.doesNotMatch(settingsHtml, /(?:aria-label|title|placeholder)="[^"]*[぀-ヿ㐀-鿿가-힯]/);
});

test('设置页 data-i18n 引用的键都存在，表里没有用不到的键', async () => {
  const messages = await settingsMessages();
  const htmlKeys = [...settingsHtml.matchAll(/data-i18n(?:-aria-label)?="(\w+)"/g)].map((m) => m[1]);
  const codeKeys = [...settingsSource.matchAll(/\bt\('(\w+)'\)/g)].map((m) => m[1]);
  assert.ok(htmlKeys.length >= 12);
  assert.ok(codeKeys.length >= 15);
  for (const key of [...htmlKeys, ...codeKeys]) assert.ok(Object.hasOwn(messages.en, key), `settings ${key}`);
  const used = new Set([...htmlKeys, ...codeKeys]);
  for (const key of Object.keys(messages.en)) assert.ok(used.has(key), `unused settings key ${key}`);
});

test('设置页按 /app-context 的语言渲染全部文案', async () => {
  for (const locale of HOST_LOCALES) {
    const page = await createSettingsHarness(locale);
    const T = page.messages[locale];
    assert.equal(page.documentElement.lang, locale);
    const textNodes = page.all.filter((element) => element.getAttribute('data-i18n') !== null);
    assert.ok(textNodes.length >= 12);
    for (const element of textNodes) {
      const key = element.getAttribute('data-i18n');
      // stateBadge 和 toggleSecret 之后会被 render/toggle 改写成同语言的另一个键。
      if (element.id === 'stateBadge' || element.id === 'toggleSecret') continue;
      assert.equal(element.textContent, T[key], `${locale} data-i18n=${key}`);
    }
    assert.equal(page.text('stateBadge'), T.badgeDisconnected);
    assert.equal(page.text('toggleSecret'), T.show);
    assert.equal(page.elements.get('toggleSecret').getAttribute('aria-label'), T.showAria);

    page.elements.get('toggleSecret').listeners.click();
    assert.equal(page.text('toggleSecret'), T.hide);
    assert.equal(page.elements.get('toggleSecret').getAttribute('aria-label'), T.hideAria);

    page.elements.get('connectForm').listeners.submit({ preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.text('status'), T.missingFields);
    assert.equal(page.fetchCalls[0], '/app-context');
  }
});

test('设置页已连接状态与读取失败提示同样跟随宿主语言', async () => {
  for (const locale of HOST_LOCALES) {
    const connected = await createSettingsHarness(locale, {
      kv: { email: 'user@icloud.com', credentialSlot: 'a' },
      secrets: [{ key: 'icloud_mail_app_password', saved: true }],
    });
    assert.equal(connected.text('stateBadge'), connected.messages[locale].badgeConnected);
    assert.equal(connected.text('connectedEmail'), 'user@icloud.com');
  }
  for (const locale of HOST_LOCALES) {
    const broken = await createSettingsHarness(locale, { secrets: 'http-error' });
    assert.equal(broken.text('stateBadge'), broken.messages[locale].badgeDisconnected);
    assert.equal(broken.text('status'), broken.messages[locale].loadStateFailed);
    assert.ok(broken.elements.get('status').classes.has('error'));
  }
});

test('设置页在语言不受支持或 /app-context 不可用时回退英文', async () => {
  const hang = {
    // 让 2 秒的 /app-context 超时立刻触发；其他定时器不受影响。
    setTimeout(callback, ms) {
      return setTimeout(callback, ms === 2000 ? 0 : ms);
    },
  };
  const cases = [
    ['unsupported', 'pt-BR', {}],
    ['missing', undefined, {}],
    ['http error', 'http-error', {}],
    ['offline', new Error('offline'), {}],
    ['malformed', async () => response({ ok: true }), {}],
    // 宿主不回应时只有 2 秒超时触发的 abort 能结束请求，页面随后按英文渲染。
    ['hangs', (init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }), hang],
  ];
  for (const [label, appContext, options] of cases) {
    const page = await createSettingsHarness(appContext, options);
    assert.equal(page.documentElement.lang, 'en', label);
    assert.equal(page.text('stateBadge'), page.messages.en.badgeDisconnected, label);
    assert.ok(page.all.some((element) => element.textContent === page.messages.en.title), label);
  }
});

test('设置页 zh-CN 文案与迁移前的界面文字一致', async () => {
  const messages = await settingsMessages();
  const zh = messages['zh-CN'];
  const original = {
    title: 'iCloud Mail 账号',
    subtle: '由 Cindy 安全保存',
    badgeConnected: '已连接',
    badgeDisconnected: '未连接',
    connectedNote: 'App 专用密码已加密保存在 Cindy 本机',
    disconnect: '断开',
    emailLabel: 'iCloud Mail 邮箱地址',
    passwordLabel: 'Apple 账户 App 专用密码',
    show: '显示',
    hide: '隐藏',
    showAria: '显示 App 专用密码',
    hideAria: '隐藏 App 专用密码',
    helpLink: 'Apple 账户网站',
    connect: '连接并测试',
    readConfigFailed: '读取 iCloud Mail 配置失败',
    saveStateFailed: '保存 iCloud Mail 连接状态失败',
    clearStateFailed: '清除 iCloud Mail 连接状态失败',
    savePasswordFailed: '安全保存 App 专用密码失败',
    removePasswordFailed: '清除 App 专用密码失败',
    connectTimeout: '连接等待超时，请确认插件已启用后重试',
    operationFailed: 'iCloud Mail 操作失败',
    missingFields: '请填写 iCloud Mail 地址和 App 专用密码',
    connecting: '正在安全保存 App 专用密码并测试 IMAP 和 SMTP 连接…',
    connected: '连接成功。App 专用密码已由 Cindy 安全保存。',
    connectFailed: '连接失败，请重试',
    disconnected: '已断开并从 Cindy 安全存储中清除 App 专用密码。',
    disconnectFailed: '断开失败，请重试',
    loadStateFailed: '暂时无法读取已保存的连接状态',
  };
  for (const [key, text] of Object.entries(original)) assert.equal(zh[key], text, key);
  // 原 HTML 里跨行的段落：去掉源码换行缩进后逐字一致。
  assert.equal(
    zh.helpBefore + zh.helpLink + zh.helpAfter,
    '请确认 Apple 账户已开启双重认证，然后前往 Apple 账户网站，在“登录与安全 → App 专用密码”中生成密码。这里不要填写 Apple 账户密码。',
  );
  assert.equal(
    zh.privacyNote,
    'App 专用密码不会进入 Agent 参数或插件 main.js，仅在执行邮箱请求时由 Cindy 临时提供给插件 Worker。邮件操作使用短连接，完成后会立即断开 IMAP/SMTP。',
  );
  assert.match(messages.ja.helpAfter, /Apple アカウントのパスワードを入力しないでください/);
  assert.match(messages.ko.helpAfter, /Apple 계정 비밀번호를 입력하지 마세요/);
  assert.match(messages.en.helpAfter, /Do not enter your Apple Account password here/);
});

// ---------------------------------------------------------------------------
// 跨文件守门：中文只出现在 zh-CN / ja 表和注释里；zh-CN 输出与迁移前逐字一致
// ---------------------------------------------------------------------------

const hanRe = /[一-鿿]/;
const workerSource = readFileSync(new URL('src/worker.cjs', pluginRoot), 'utf8');

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

test('main.js、settings.js、settings.html、Worker 源码在文案表之外没有中文', () => {
  // zh-CN 和 ja 表允许汉字（日文与中文共用汉字）。Worker 表用 Object.freeze 包了一层。
  const cjkTables = /\n {2}(?:'zh-CN'|ja): (?:Object\.freeze\()?\{[\s\S]*?\n {2}\}\)?,(?=\n)/g;
  // Worker 里这两处比对的是 iCloud 服务器返回的文本，不是界面文案，必须保留中文。
  const serverText = [
    "/(^|[/])drafts?$|草稿箱/i",
    "combined.includes('频繁')",
  ];
  for (const literal of serverText) assert.ok(workerSource.includes(literal), literal);
  for (const [label, text] of [
    ['main.js', mainSource],
    ['settings.js', settingsSource],
    ['settings.html', settingsHtml],
    ['src/worker.cjs', workerSource],
  ]) {
    let outside = stripComments(text).replace(cjkTables, '');
    for (const literal of serverText) outside = outside.split(literal).join('');
    const offenders = outside.split('\n').filter((line) => hanRe.test(line));
    assert.deepEqual(offenders, [], label);
  }
});

test('main.js 和 Worker 的 en/ko 表不含汉字，ja/ko/en 没有照抄 zh-CN', () => {
  const main = JSON.parse(JSON.stringify(createMainHarness(async () => ({ ok: true, result: {} })).context.MESSAGES));
  for (const [label, messages] of [['main', main], ['worker', worker.MESSAGES]]) {
    for (const locale of ['en', 'ko']) {
      for (const [key, text] of Object.entries(messages[locale])) {
        assert.doesNotMatch(text, hanRe, `${label}/${locale}.${key}`);
      }
    }
  }
});

test('main.js zh-CN 运行时输出与迁移前的硬编码字符串逐字一致', async () => {
  const harness = createMainHarness(async () => ({ ok: true, result: {} }));
  assert.equal((await harness.call('icloud_mail', { action: 'read', message_uid: 0 })).message, 'message_uid 必须是有效的正整数');
  assert.equal((await harness.call('icloud_mail', { action: 'nuke' })).message, '未知 action：nuke');
  assert.equal((await harness.call('icloud_mail', { action: 'move', message_uid: 1 })).message, 'move 需要 target_folder；请先调用 list_folders');
  assert.equal((await harness.call('icloud_mail', { action: 'draft', to: 'a@b.c' })).message, 'draft 需要 to、subject 和 body_text');
  assert.equal((await harness.call('icloud_mail_x')).message, '未知工具：icloud_mail_x');
  assert.equal((await harness.settings('connect', { email: 'bad' })).message, '请输入有效的 iCloud Mail 邮箱地址');
  assert.equal((await harness.settings('reset', {})).message, '未知设置动作');
  assert.equal(
    (await harness.settings('connect', { email: 'user@icloud.com', credentialSlot: 'z' }, 'slot')).message,
    'iCloud Mail 凭证槽位无效，请重新连接',
  );

  const zh = harness.context.MESSAGES['zh-CN'];
  const original = {
    invalidEmail: '请输入有效的 iCloud Mail 邮箱地址',
    readConfigFailed: '读取 iCloud Mail 配置失败',
    invalidCredentialSlot: 'iCloud Mail 凭证槽位无效，请重新连接',
    notConfigured: '尚未配置 iCloud Mail，请到「iCloud Mail」插件详情页完成连接',
    workerFailed: 'iCloud Mail Worker 调用失败，请稍后重试',
    unknownSettingsAction: '未知设置动作',
    connectFailed: 'iCloud Mail 连接失败，请重试',
    invalidUid: 'message_uid 必须是有效的正整数',
    moveNeedsTarget: 'move 需要 target_folder；请先调用 list_folders',
    invalidArgs: 'iCloud Mail 参数无效',
    operationFailed: 'iCloud Mail 操作失败，请稍后重试',
    statusFailed: 'iCloud Mail 连接状态查询失败',
    toolFailed: 'iCloud Mail 工具执行失败',
  };
  for (const [key, text] of Object.entries(original)) assert.equal(zh[key], text, key);

  const unconfigured = createMainHarness(async () => ({ ok: true, result: {} }), { secretSaved: false });
  assert.equal(
    (await unconfigured.call('icloud_mail', { action: 'list_folders' })).message,
    '尚未配置 iCloud Mail，请到「iCloud Mail」插件详情页完成连接',
  );
  const workerDown = createMainHarness(async () => ({ ok: false }));
  assert.equal(
    (await workerDown.call('icloud_mail', { action: 'list_folders' })).message,
    'iCloud Mail Worker 调用失败，请稍后重试',
  );
});

test('Worker zh-CN 错误文案与迁移前的硬编码字符串逐字一致', () => {
  const original = {
    invalidEmail: '请输入有效的 iCloud Mail 邮箱地址',
    invalidAppSpecificPassword: '请输入 Apple 账户网站生成的 App 专用密码，不要输入 Apple 账户密码',
    notConfigured: '尚未配置 iCloud Mail，请到「iCloud Mail」插件详情页输入邮箱和 App 专用密码',
    invalidCredentialSlot: 'iCloud Mail 凭证状态无效，请在插件详情页重新连接',
    authRejected: 'iCloud Mail 拒绝登录。请确认 Apple 账户已开启双重认证，并使用生成的 App 专用密码（不是 Apple 账户密码）',
    networkUnreachable: '无法连接 iCloud Mail 服务器，请检查网络后重试',
    rateLimited: 'iCloud Mail 暂时限制了频繁访问，请稍后再试',
    messageNotFound: '没有在指定文件夹找到这封邮件，请重新搜索',
    messageTooLarge: '邮件内容过大，当前版本暂时无法处理',
    draftFolderNotFound: '没有找到 iCloud Mail 草稿箱，请先调用 list_folders 确认服务器文件夹',
    draftSaveFailed: 'iCloud Mail 未能保存草稿，请稍后重试',
    targetFolderRequired: 'move 需要目标文件夹',
    targetFolderSame: '目标文件夹不能与当前文件夹相同',
    moveUnconfirmed: '无法确认邮件是否已移动，请重新搜索邮箱后再操作',
    recipientRequired: '请至少填写一个收件人',
    invalidRecipient: '收件人、抄送或密送地址格式不正确',
    invalidSubject: '邮件主题格式不正确',
    invalidBody: '邮件正文格式不正确',
    invalidSearchDate: '搜索日期格式无效，请使用 ISO 日期或日期时间',
    folderUnavailable: 'iCloud Mail 文件夹不存在或不可用，请先调用 list_folders 获取准确名称',
    operationFailedRetry: 'iCloud Mail 操作失败，请稍后重试',
    operationFailed: 'iCloud Mail 操作失败',
    invalidRequestFormat: '请求格式无效',
    bodyTruncated: '…（正文过长，已截断）',
  };
  assert.deepEqual(Object.keys(original).sort(), Object.keys(worker.MESSAGES['zh-CN']).sort());
  for (const [key, text] of Object.entries(original)) assert.equal(worker.MESSAGES['zh-CN'][key], text, key);
  for (const [error, key] of WORKER_ERROR_KEYS) {
    assert.equal(worker.humanizeError(error, 'zh-CN'), original[key], key);
  }
});

test('main.js 引用的文案键都存在，表里没有用不到的键', () => {
  const messages = createMainHarness(async () => ({ ok: true, result: {} })).context.MESSAGES;
  const used = [...mainSource.matchAll(/\bt\(locale, '(\w+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 15);
  for (const key of used) assert.ok(Object.hasOwn(messages.en, key), key);
  for (const key of Object.keys(messages.en)) assert.ok(used.includes(key), `unused main key ${key}`);
});

test('Worker 引用的文案键都存在，表里没有用不到的键', () => {
  const used = [...workerSource.matchAll(/\bt\((?:locale|requestLocale\(request\)|DEFAULT_LOCALE), '(\w+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length >= 20);
  for (const key of used) assert.ok(Object.hasOwn(worker.MESSAGES.en, key), key);
  for (const key of Object.keys(worker.MESSAGES.en)) assert.ok(used.includes(key), `unused worker key ${key}`);
});

test('插件代码不读取 navigator.language', () => {
  for (const [label, text] of [['main.js', mainSource], ['settings.js', settingsSource], ['settings.html', settingsHtml], ['src/worker.cjs', workerSource]]) {
    assert.doesNotMatch(text, /navigator\s*\.\s*languages?\b/, label);
  }
});
