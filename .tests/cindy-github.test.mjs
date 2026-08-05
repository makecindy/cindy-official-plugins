import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

const githubSource = readFileSync(
  new URL('../cindy-github/main.js', import.meta.url),
  'utf8',
);
const settingsSource = readFileSync(
  new URL('../cindy-github/settings.js', import.meta.url),
  'utf8',
);
const manifest = JSON.parse(
  readFileSync(new URL('../cindy-github/ghost.json', import.meta.url), 'utf8'),
);

function jsonResponse(data, status = 200) {
  return { ok: true, status, body: JSON.stringify(data), headers: {} };
}

async function testConnection() {
  let channel;
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });

  class FakeBroadcastChannel {
    constructor() { channel = this; }

    postMessage(message) {
      if (message?.type === 'test-connection-result') resolveResult(message);
    }
  }

  const fetch = async (url) => { throw new Error(`unexpected fetch: ${url}`); };

  const cindy = {
    onHostMessage() {},
    send() {},
    fetch: async (request) => {
      assert.equal(request.url, 'https://api.github.com/user');
      return jsonResponse({ login: 'octocat' });
    },
  };

  new Script(githubSource, { filename: 'cindy-github/main.js' }).runInContext(
    createContext({
      cindy,
      BroadcastChannel: FakeBroadcastChannel,
      fetch,
      setTimeout,
      clearTimeout,
      URL,
      encodeURIComponent,
    }),
  );

  await channel.onmessage({ data: { type: 'test-connection', reqId: 'req-1' } });
  const message = await result;
  assert.equal(message.ok, true);
}

test('manifest pins host GitHub login injection to the GitHub API', () => {
  const auth = manifest.network?.secrets?.find((secret) => secret.key === 'github_pat');
  assert.equal(manifest.version, '1.2.5');
  assert.deepEqual(auth, {
    key: 'github_pat',
    label: 'GitHub 登录',
    source: 'gh-cli',
    hint: '宿主优先使用本机 GitHub 登录；不可用时可粘贴备用 Token',
    url: 'https://github.com/settings/tokens',
    inject: {
      header: 'Authorization',
      format: 'Bearer {value}',
      hosts: ['api.github.com'],
    },
  });
});

test('connection tests never cache an identity that the plugin cannot attribute atomically', async () => {
  await testConnection();
  assert.doesNotMatch(githubSource, /connectedLogin|connectedSource/);
});

test('settings show only host availability and fallback-token storage state', () => {
  assert.match(settingsSource, /function renderHostAccount\(available\)/);
  assert.doesNotMatch(settingsSource, /renderHostAccount\(hostAvailable,\s*\w+/);
  assert.doesNotMatch(settingsSource, /connectedLogin|connectedSource|fetch\(['"]\/kv/);
  assert.doesNotMatch(settingsSource, /gh auth token/);
});
