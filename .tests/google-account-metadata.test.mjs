import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const source = read('scripts/google-workspace/account-metadata.js');
const copy = (value) => JSON.parse(JSON.stringify(value));
const plugins = { 'google-gmail': 'gmail', 'google-drive': 'google_drive', 'google-calendar': 'google_calendar', 'google-sheets': 'google_sheets' };

function fixture(key = 'gmail_account') {
  let data = { unrelated: { retained: true } };
  let tail = Promise.resolve();
  const accounts = [
    { id: 'acc-work', label: 'work@example.test', status: 'connected', nickname: 'Host value is not authoritative' },
    { id: 'acc-personal', label: 'personal@example.test', status: 'expired' },
  ];
  const calls = [];
  const locks = { request(_name, action) {
    const pending = tail.then(action);
    tail = pending.catch(() => {});
    return pending;
  } };
  const env = {
    navigator: { locks },
    fetch: async (url, options = {}) => {
      calls.push({ url, ...options });
      if (url === '/oauth') return { ok: true, json: async () => [{ key, clientConfigured: true, accounts: copy(accounts) }] };
      if (url === '/app-context') return { ok: true, json: async () => ({ context: { locale: 'en' } }) };
      assert.equal(url, '/kv', 'labels must use only existing same-origin storage');
      if (options.method === 'PUT') data = JSON.parse(options.body);
      return { ok: true, json: async () => copy(data) };
    },
  };
  function context(extra = {}) {
    const ctx = createContext({ ...env, ...extra });
    runInContext(source, ctx);
    return ctx;
  }
  return { context, env, accounts, calls, data: () => copy(data) };
}

test('昵称保存、清空和断开清理只修改插件 KV，重新加载仍可读取', async () => {
  const f = fixture();
  const before = copy(f.accounts);
  await f.context().googleAccountMetadata.save('gmail_account', 'acc-work', '  公司邮箱  ');
  const api = f.context().googleAccountMetadata;
  assert.equal((await api.list('gmail_account', f.accounts))[0].nickname, '公司邮箱');
  assert.deepEqual(f.accounts, before);
  assert.deepEqual(f.data().unrelated, { retained: true });
  await api.save('gmail_account', 'acc-work', '');
  assert.equal((await api.list('gmail_account', f.accounts))[0].nickname, '');
  await api.save('gmail_account', 'acc-personal', '私人邮箱');
  await api.remove('gmail_account', 'acc-personal');
  assert.deepEqual(f.data().accountNicknames.gmail_account, {});
  assert.ok(f.calls.filter(call => call.method === 'PUT').every(call => call.url === '/kv'));
});

test('拒绝不存在的账号和非法昵称，不把昵称写成授权身份', async () => {
  const f = fixture();
  const api = f.context().googleAccountMetadata;
  for (const value of ['a'.repeat(81), '公司\n邮箱', 1]) {
    await assert.rejects(api.save('gmail_account', 'acc-work', value), /Invalid/);
  }
  await assert.rejects(api.save('gmail_account', 'missing', '公司'), /no longer connected/);
  await assert.rejects(api.save('other-key', 'acc-work', '公司'), /no longer connected/);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
});

test('跨页面并发修改不同账号不覆盖，插件间数据不共享', async () => {
  const f = fixture();
  await Promise.all([
    f.context().googleAccountMetadata.save('gmail_account', 'acc-work', '公司'),
    f.context().googleAccountMetadata.save('gmail_account', 'acc-personal', '私人'),
  ]);
  assert.deepEqual(f.data().accountNicknames.gmail_account, { 'acc-work': '公司', 'acc-personal': '私人' });
  const otherPlugin = fixture();
  assert.equal((await otherPlugin.context().googleAccountMetadata.list('gmail_account', otherPlugin.accounts))[0].nickname, '');
});

test('存储读写失败不报告成功，也不使用 Host 昵称兜底', async () => {
  for (const failedMethod of ['GET', 'PUT']) {
    const f = fixture();
    const api = f.context({ fetch: (url, options = {}) => url === '/kv' && (options.method || 'GET') === failedMethod
      ? Promise.resolve({ ok: false }) : f.env.fetch(url, options) }).googleAccountMetadata;
    await assert.rejects(api.save('gmail_account', 'acc-work', '公司'), /preferences/);
    assert.deepEqual(f.data(), { unrelated: { retained: true } });
    if (failedMethod === 'GET') {
      const accounts = await api.list('gmail_account', f.accounts);
      assert.equal(accounts.length, 2);
      assert.equal(accounts[0].id, 'acc-work');
      assert.equal(accounts[0].nickname, '');
    }
  }
});

test('昵称 KV JSON 损坏不影响账号列表，但保存仍拒绝覆盖', async () => {
  const f = fixture();
  const api = f.context({ fetch: (url, options = {}) => url === '/kv'
    ? Promise.resolve({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } })
    : f.env.fetch(url, options) }).googleAccountMetadata;
  const accounts = await api.list('gmail_account', f.accounts);
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].nickname, '');
  await assert.rejects(api.save('gmail_account', 'acc-work', '公司'), /invalid JSON/);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
});

for (const [plugin, prefix] of Object.entries(plugins)) {
  test(`${plugin}: 打包源和昵称读写契约不依赖客户端专用接口`, () => {
    assert.equal(read(plugin + '/account-metadata.js'), source);
    assert.ok(read(plugin + '/main.js').includes(source));
    assert.match(read(plugin + '/settings.html'), /account-metadata\.js[\s\S]*account-nickname\.js[\s\S]*settings\.js/);
    const editor = read(plugin + '/account-nickname.js');
    assert.equal(editor, read('scripts/google-workspace/account-nickname.js'));
    assert.match(editor, /googleAccountMetadata\.save\(key, account\.id,/);
    assert.match(editor, /googleAccountMetadata\.remove\(key, account\.id\)/);
    assert.doesNotMatch(editor, /\/nickname|unsupported/);
  });

  test(`${plugin}: 模型读取插件昵称，执行仍用账号 ID，不默选其他账号`, async () => {
    const key = prefix + '_account';
    const f = fixture(key);
    await f.context().googleAccountMetadata.save(key, 'acc-work', '公司邮箱');
    const handlers = [], replies = [], requests = [];
    const ctx = f.context({ cindy: {
      onHostMessage: handler => handlers.push(handler),
      send: async reply => replies.push(copy(reply)),
      node: { request: async request => { requests.push(copy(request)); return { ok: true, result: { ok: true, data: {} } }; } },
    } });
    runInContext(read(plugin + '/main.js'), ctx);
    const call = async (tool, args = {}) => {
      replies.length = 0;
      for (const handler of handlers) await handler({ type: 'tool-call', tool, args, callId: 'test-call' });
      assert.equal(replies.length, 1);
      return replies[0];
    };
    assert.equal((await call(prefix + '_accounts')).result.accounts[0].nickname, '公司邮箱');
    await f.context().googleAccountMetadata.save(key, 'acc-work', '工作');
    assert.equal((await call(prefix + '_accounts')).result.accounts[0].nickname, '工作');
    assert.equal((await call(prefix + '_run', { command: ['list'] })).ok, false);
    assert.equal((await call(prefix + '_run', { account: '公司邮箱', command: ['list'] })).ok, false);
    assert.equal((await call(prefix + '_run', { account: 'acc-personal', command: ['list'] })).ok, false);
    assert.equal(requests.length, 0);
    f.accounts[0].scopeStale = true;
    assert.equal((await call(prefix + '_run', { account: 'acc-work', command: ['list'] })).ok, false);
    assert.equal(requests.length, 0);
    f.accounts[0].scopeStale = false;
    assert.equal((await call(prefix + '_run', { account: 'acc-work', command: ['list'], session_context: { workdir_is_local: true, workdir_is_read_only: false, workdir: '/test-workdir' } })).ok, true);
    assert.equal(requests[0].authAccount, 'acc-work');
    assert.equal(JSON.stringify(requests[0]).includes('工作'), false);
  });

  test(`${plugin}: 设置页先合并插件昵称再渲染，保存后重新读取`, async () => {
    const key = prefix + '_account';
    const f = fixture(key);
    await f.context().googleAccountMetadata.save(key, 'acc-work', '公司');
    const nodes = {};
    const renders = [];
    let refresh;
    const ctx = f.context({
      AbortController, setTimeout, clearTimeout,
      document: { documentElement: { lang: 'en' }, getElementById: id => nodes[id] ||= {} },
      window: { renderGoogleAccounts: (_key, accounts, reload) => { renders.push(copy(accounts)); refresh = reload; } },
    });
    runInContext(read(plugin + '/settings.js'), ctx);
    await new Promise(setImmediate);
    assert.equal(renders.length, 1);
    assert.equal(renders[0][0].nickname, '公司');
    await f.context().googleAccountMetadata.save(key, 'acc-work', '工作');
    await refresh();
    assert.equal(renders.at(-1)[0].nickname, '工作');
  });
}
