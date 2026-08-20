import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, Script } from 'node:vm';

import adapter from '../taptap-maker/node/child-process-adapter.cjs';
import rootRouterModule from '../taptap-maker/node/mcp-root-router.cjs';

const pluginRoot = new URL('../taptap-maker/', import.meta.url);
const mainSource = readFileSync(new URL('main.js', pluginRoot), 'utf8');
const accountSource = readFileSync(new URL('node/account.cjs', pluginRoot), 'utf8');
const makerMcpSource = readFileSync(new URL('node/maker-mcp.cjs', pluginRoot), 'utf8');
const makerChildSource = readFileSync(new URL('node/maker-child.cjs', pluginRoot), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('ghost.json', pluginRoot), 'utf8'));
const skillMd = readFileSync(new URL('skills/taptap-maker/SKILL.md', pluginRoot), 'utf8');
const settingsHtml = readFileSync(new URL('settings.html', pluginRoot), 'utf8');
const settingsSource = readFileSync(new URL('settings.js', pluginRoot), 'utf8');
const provisioning = JSON.parse(readFileSync(new URL('../provisioning.json', import.meta.url), 'utf8'));
const vendorPackage = JSON.parse(
  readFileSync(new URL('vendor/taptap-maker/package.json', pluginRoot), 'utf8'),
);
const vendorBundleSource = readFileSync(
  new URL('vendor/taptap-maker/dist/maker.js', pluginRoot),
  'utf8',
);
const requireFromTest = createRequire(import.meta.url);

function readSettingsMessages() {
  const match = settingsSource.match(
    /var MESSAGES = (\{[\s\S]*?\n  \});\n  var currentLocale/,
  );
  assert.ok(match, 'settings.js must declare MESSAGES');
  const context = createContext({ messages: null });
  new Script(`messages = ${match[1]}`).runInContext(context);
  return context.messages;
}

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

function createMainHarness(nodeResponder) {
  FakeBroadcastChannel.instances.length = 0;
  const nodeRequests = [];
  const previewRequests = [];
  const pickRequests = [];
  const sentMessages = [];
  let handler;
  let resolveToolResult;

  const cindy = {
    node: {
      request: async (request) => {
        nodeRequests.push(request);
        return nodeResponder(request);
      },
    },
    preview: async (request) => {
      previewRequests.push(request);
      return { ok: true };
    },
    pick: async (request) => {
      pickRequests.push(request);
      return { ok: true, path: '/tmp/maker-projects' };
    },
    onHostMessage(nextHandler) {
      handler = nextHandler;
    },
    async send(message) {
      sentMessages.push(message);
      if (message.type === 'tool-result' && resolveToolResult) {
        const resolve = resolveToolResult;
        resolveToolResult = null;
        resolve(message);
      }
    },
  };

  new Script(mainSource, { filename: 'taptap-maker/main.js' }).runInContext(
    createContext({
      BroadcastChannel: FakeBroadcastChannel,
      URL,
      cindy,
      fetch: async () => ({ ok: true }),
      setTimeout: () => 1,
    }),
  );
  assert.equal(typeof handler, 'function');

  return {
    nodeRequests,
    previewRequests,
    pickRequests,
    sentMessages,
    settingsChannel: FakeBroadcastChannel.instances[0],
    call(tool, args = {}) {
      return new Promise((resolve) => {
        resolveToolResult = resolve;
        handler({
          type: 'tool-call',
          tool,
          callId: `call-${tool}`,
          args,
        });
      });
    },
  };
}

function fakeChildHandle() {
  const events = new EventEmitter();
  return {
    pid: 123,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
    on: events.on.bind(events),
    once: events.once.bind(events),
    off: events.off.bind(events),
    emit: events.emit.bind(events),
  };
}

function loadAccountInternals() {
  const readline = {
    createInterface() {
      return { on() {} };
    },
  };
  const context = createContext({
    Buffer,
    clearInterval,
    clearTimeout,
    process,
    require(id) {
      if (id === 'node:readline') return readline;
      if (id === './child-process-adapter.cjs') return adapter;
      return requireFromTest(id);
    },
    setInterval,
    setTimeout,
  });
  new Script(
    `${accountSource}\nglobalThis.__accountInternals = { ensureTargetAvailable, projectDirectoryName, projectSyncFailure };`,
    { filename: 'taptap-maker/node/account.cjs' },
  ).runInContext(context);
  return context.__accountInternals;
}

test('manifest、手动安装策略和官方 Runtime 版本保持一致', () => {
  assert.equal(manifest.id, 'taptap-maker');
  assert.equal(manifest.author, 'Cindy');
  assert.equal(manifest.version, '2.1.11');
  assert.match(manifest.whenToUse, /不得通过 Shell、CLI、npx、直接 MCP 或通用浏览器绕行/);
  assert.match(
    manifest.tools.find((tool) => tool.name === 'maker_build').description,
    /user_facing_markdown/,
  );
  assert.match(
    manifest.tools.find((tool) => tool.name === 'maker_ads_guide').description,
    /不会修改项目/,
  );
  assert.match(
    manifest.tools.find((tool) => tool.name === 'maker_status').parameters.properties.detail.description,
    /完整诊断/,
  );
  assert.doesNotMatch(
    manifest.tools.find((tool) => tool.name === 'maker_call_tool').description,
    /素材能力优先使用 Maker/,
  );
  assert.deepEqual(
    manifest.slots,
    ['tool', 'card', 'node', 'session-context', 'pick', 'preview', 'skill'],
  );
  assert.deepEqual(manifest.skill, {
    items: [{
      dir: 'skills/taptap-maker',
      name: 'taptap-maker',
      description: '使用 Cindy 的 TapTap Maker 插件完成账号连接、项目检查或初始化、构建预览，以及调用官方 Maker 动态工具。用户要求创建、打开、检查、构建或预览 TapTap Maker 游戏，或使用 Maker 素材与调试能力时使用。',
    }],
  });
  assert.equal(/^name:\s*(.+)$/m.exec(skillMd)?.[1], manifest.skill.items[0].name);
  assert.equal(
    /^description:\s*(.+)$/m.exec(skillMd)?.[1],
    manifest.skill.items[0].description,
  );
  assert.match(skillMd, /ghost_call\(\{ ghost_id: "taptap-maker"/);
  assert.match(skillMd, /ghost_list/);
  assert.match(skillMd, /maker_ads_guide/);
  assert.deepEqual(manifest.card, { externalLinks: true });
  assert.deepEqual(manifest.node.entries, ['node/account.cjs', 'node/maker-child.cjs']);
  assert.equal(manifest.node.childSpawn, true);
  assert.deepEqual(manifest.preview.hosts, ['maker.taptap.cn']);
  assert.deepEqual(provisioning.ghosts['taptap-maker'], { audience: { emails: [] } });
  assert.equal(vendorPackage.name, '@taptap/maker');
  assert.equal(vendorPackage.version, '0.0.31');
  assert.match(vendorBundleSource, /TAPTAP_MAKER_DISTRIBUTION/);
});

test('Cindy 的 Maker Runtime 入口固定声明插件分发环境', () => {
  for (const source of [makerMcpSource, makerChildSource]) {
    assert.match(
      source,
      /process\.env\.TAPTAP_MAKER_DISTRIBUTION = 'cindy_plugin';/,
    );
  }
});

test('设置页跟随宿主四语言并以英文回退', () => {
  const messages = readSettingsMessages();
  const englishKeys = Object.keys(messages.en).sort();
  assert.deepEqual(Object.keys(messages).sort(), ['en', 'ja', 'ko', 'zh-CN']);
  for (const locale of ['zh-CN', 'ja', 'ko']) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), englishKeys, locale);
  }
  assert.match(settingsHtml, /<html lang="en">/);
  assert.match(settingsSource, /fetch\('\/app-context', \{ signal: controller\.signal \}\)/);
  assert.match(settingsSource, /new AbortController\(\)/);
  assert.match(settingsSource, /signal: controller\.signal/);
  assert.match(settingsSource, /controller\.abort\(\)/);
  assert.doesNotMatch(settingsSource, /navigator\.(?:language|languages)/);
  for (const locale of ['en', 'zh-CN', 'ja', 'ko']) {
    assert.match(settingsSource, new RegExp(`(?:^|\\n)    ['"]?${locale.replace('-', '\\-')}['"]?: \\{`));
  }
  assert.match(settingsSource, /currentLocale = 'en'/);
  assert.match(settingsSource, /document\.documentElement\.lang = currentLocale/);
  assert.match(mainSource, /errorCode: settingsErrorCode\(message\.action, error\)/);
  assert.match(settingsSource, /GIT_REQUIRED: 'syncGitMissing'/);
  assert.doesNotMatch(settingsSource, /response\.message\s*\|\|/);
  assert.doesNotMatch(settingsSource, /item\.message/);
});

test('项目目录名跨批次稳定，并用 project id 区分清洗后同名项目', () => {
  const { projectDirectoryName } = loadAccountInternals();
  const first = projectDirectoryName({ id: 'project-a', name: '同名 / 项目' });
  const firstAgain = projectDirectoryName({ id: 'project-a', name: '同名 / 项目' });
  const second = projectDirectoryName({ id: 'project-b', name: '同名 / 项目' });

  assert.equal(first, firstAgain);
  assert.notEqual(first.toLocaleLowerCase(), second.toLocaleLowerCase());
  assert.match(first, /^同名 - 项目-[a-f0-9]{16}$/);
  assert.match(second, /^同名 - 项目-[a-f0-9]{16}$/);

  const longName = projectDirectoryName({
    id: 'project-long',
    name: `${'a'.repeat(62)}. ${'b'.repeat(20)}`,
  });
  assert.ok(longName.length <= 80);
  assert.match(longName, /^[^. ]+-[a-f0-9]{16}$/);
});

test('项目目标只允许空目录或同一 Maker 项目的安全重试', async (t) => {
  const { ensureTargetAvailable } = loadAccountInternals();
  const root = await mkdtemp(path.join(os.tmpdir(), 'cindy-maker-target-'));
  t.after(() => rm(root, { force: true, recursive: true }));

  const empty = path.join(root, 'empty');
  await mkdir(empty);
  await assert.doesNotReject(ensureTargetAvailable(empty, 'project-a'));

  const unrelated = path.join(root, 'unrelated');
  await mkdir(unrelated);
  await writeFile(path.join(unrelated, 'local-change.txt'), 'keep');
  await assert.rejects(
    ensureTargetAvailable(unrelated, 'project-a'),
    /目标目录已被其他内容占用/,
  );

  const bound = path.join(root, 'bound');
  await mkdir(path.join(bound, '.maker-mcp'), { recursive: true });
  await writeFile(
    path.join(bound, '.maker-mcp', 'config.json'),
    JSON.stringify({ project_id: 'project-a' }),
  );
  await writeFile(path.join(bound, 'local-change.txt'), 'keep');
  await assert.rejects(
    ensureTargetAvailable(bound, 'project-a'),
    /目标目录已被其他内容占用/,
  );
  await assert.rejects(
    ensureTargetAvailable(bound, 'project-b'),
    /目标目录已被其他内容占用/,
  );

  const makerRepo = path.join(root, 'maker-repo');
  await mkdir(path.join(makerRepo, '.maker-mcp'), { recursive: true });
  await mkdir(path.join(makerRepo, '.git'), { recursive: true });
  await writeFile(
    path.join(makerRepo, '.maker-mcp', 'config.json'),
    JSON.stringify({ project_id: 'project-a' }),
  );
  await writeFile(
    path.join(makerRepo, '.git', 'config'),
    [
      '[remote "origin"]',
      '\turl = https://git:secret@maker.taptap.cn/git/project-a.git',
    ].join('\n'),
  );
  await assert.doesNotReject(ensureTargetAvailable(makerRepo, 'project-a'));

  const noOrigin = path.join(root, 'no-origin');
  await mkdir(path.join(noOrigin, '.maker-mcp'), { recursive: true });
  await mkdir(path.join(noOrigin, '.git'), { recursive: true });
  await writeFile(
    path.join(noOrigin, '.maker-mcp', 'config.json'),
    JSON.stringify({ project_id: 'project-a' }),
  );
  await writeFile(path.join(noOrigin, '.git', 'config'), '[core]\n\tbare = false\n');
  await assert.rejects(
    ensureTargetAvailable(noOrigin, 'project-a'),
    /目标目录已被其他内容占用/,
  );

  for (const origin of [
    'https://maker.taptap.cn/git/project-b.git',
    'https://github.com/example/project-a.git',
  ]) {
    await writeFile(
      path.join(makerRepo, '.git', 'config'),
      `[remote "origin"]\n\turl = ${origin}\n`,
    );
    await assert.rejects(
      ensureTargetAvailable(makerRepo, 'project-a'),
      /目标目录已被其他内容占用/,
    );
  }

  const occupied = path.join(root, 'occupied');
  await writeFile(occupied, 'not a directory');
  await assert.rejects(ensureTargetAvailable(occupied, 'project-a'), /目标路径已被占用/);
});

test('项目同步失败返回可行动原因且不回显底层敏感信息', () => {
  const { projectSyncFailure } = loadAccountInternals();
  assert.deepEqual(
    { ...projectSyncFailure(new Error('Maker PAT not found: token=secret')) },
    {
      code: 'AUTH_REQUIRED',
      message: 'TapTap Maker 登录已失效，请重新连接账号后重试',
    },
  );
  for (const loginError of [
    'Maker PAT missing. Run `taptap-maker login`.',
    'Maker PAT expired',
    'Maker API returned HTTP 403 Forbidden',
  ]) {
    assert.equal(projectSyncFailure(new Error(loginError)).code, 'AUTH_REQUIRED');
  }
  assert.deepEqual(
    { ...projectSyncFailure(new Error('目标目录已被其他内容占用：/Users/example/private')) },
    {
      code: 'TARGET_OCCUPIED',
      message: '目标子目录已有内容，且无法安全确认属于同一 Maker 项目；请改选父目录或手动处理该子目录',
    },
  );
  assert.deepEqual(
    { ...projectSyncFailure(new Error('TapTap Maker 初始化已暂停：Python 环境准备失败。')) },
    {
      code: 'PYTHON_SETUP_FAILED',
      message: 'Maker 自动准备 Python 环境失败，请检查网络、代理和目录权限后重试',
    },
  );
  assert.deepEqual(
    { ...projectSyncFailure(new Error('Could not resolve host: maker.taptap.cn')) },
    {
      code: 'NETWORK_ERROR',
      message: '连接 TapTap Maker 超时，请检查网络后重试',
    },
  );
  assert.doesNotMatch(
    JSON.stringify(projectSyncFailure(new Error('unexpected token=secret at /Users/example/private'))),
    /secret|\/Users/,
  );
});

test('主工具只使用宿主注入的本地 workdir，并为长构建开启续命与右侧预览', async () => {
  const buildResult = {
    content: [{
      type: 'text',
      text: '- maker_url: https://maker.taptap.cn/app/demo?localDev=1',
    }],
  };
  const harness = createMainHarness(async (request) => {
    if (request.entry === 'node/account.cjs') {
      return {
        ok: true,
        result: { structuredContent: { ok: true } },
      };
    }
    return { ok: true, result: buildResult };
  });

  const init = await harness.call('maker_init', {
    app_id: 'app-1',
    workdir: '/tmp/untrusted',
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
      session_id: 'session-1',
    },
  });
  assert.equal(init.ok, true);
  assert.equal(
    harness.nodeRequests[0].params.arguments.workdir,
    '/tmp/trusted-maker',
  );

  const build = await harness.call('maker_build', {
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
      session_id: 'session-1',
    },
  });
  assert.equal(build.ok, true);
  assert.equal(harness.nodeRequests[1].timeoutMs, 60_000);
  assert.equal(harness.nodeRequests[1].maxTotalMs, 900_000);
  assert.match(
    harness.nodeRequests[1].params._meta.progressToken,
    /^cindy-maker-\d+$/,
  );
  assert.equal(
    harness.nodeRequests[1].params.arguments.target_dir,
    '/tmp/trusted-maker',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(harness.previewRequests)), [{
    url: 'https://maker.taptap.cn/app/demo?localDev=1&hide_chat=1',
    sessionId: 'session-1',
  }]);
  assert.equal(
    build.result.user_facing_markdown,
    '[打开 TapTap Maker 预览](https://maker.taptap.cn/app/demo?localDev=1&hide_chat=1)',
  );
  const card = harness.sentMessages.find((message) => message.type === 'card-update');
  assert.equal(card.callId, 'call-maker_build');
  assert.equal(card.state, 'done');
  assert.match(
    card.html,
    /href="https:\/\/maker\.taptap\.cn\/app\/demo\?localDev=1&amp;hide_chat=1"/,
  );
});

test('动态工具列表携带可信项目 root，并过滤固定工具', async () => {
  const harness = createMainHarness(async () => ({
    ok: true,
    result: {
      tools: [
        { name: 'maker_status_lite' },
        { name: 'generate_image', inputSchema: { type: 'object' } },
      ],
    },
  }));

  const result = await harness.call('maker_list_tools', {
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.result.tools, [{
    name: 'generate_image',
    inputSchema: { type: 'object' },
  }]);
  assert.equal(harness.nodeRequests[0].method, 'cindy/tools-list');
  assert.deepEqual(JSON.parse(JSON.stringify(harness.nodeRequests[0].params)), {
    target_dir: '/tmp/trusted-maker',
  });
});

test('广告指南只读取官方固定 MCP resource，且允许只读会话调用', async () => {
  const guide = {
    contents: [{
      uri: 'maker://ads-integration-guide',
      mimeType: 'text/plain',
      text: 'TapTap Maker ads integration guide',
    }],
  };
  const harness = createMainHarness(async () => ({
    ok: true,
    result: guide,
  }));

  const result = await harness.call('maker_ads_guide', {
    session_context: {
      workdir_is_local: true,
      workdir_is_read_only: true,
      workdir: '/tmp/trusted-maker',
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.result)), guide);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.nodeRequests[0])), {
    method: 'resources/read',
    params: { uri: 'maker://ads-integration-guide' },
    timeoutMs: 30000,
  });
});

test('Maker 状态保留登录结论但不暴露本地绝对路径', async () => {
  const harness = createMainHarness(async () => ({
    ok: true,
    result: {
      content: [{
        type: 'text',
        text: [
          'TapTap Maker MCP status',
          '- pat: found (/Users/example/.taptap-maker/pat.json)',
          '- python: /opt/homebrew/bin/python3',
          '- target_dir: /private/tmp/maker-project',
          '- next_action: reconnect in /mcp',
        ].join('\n'),
      }],
      structuredContent: {
        pat: true,
        configPath: 'C:\\Users\\example\\.taptap-maker\\config.json',
      },
    },
  }));

  const result = await harness.call('maker_status', {
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
    },
  });
  assert.match(result.result.content[0].text, /pat: found \(<local-path>\)/);
  assert.match(result.result.content[0].text, /python: <local-path>/);
  assert.match(result.result.content[0].text, /target_dir: <local-path>/);
  assert.match(result.result.content[0].text, /reconnect in \/mcp/);
  assert.equal(result.result.structuredContent.configPath, '<local-path>');
  assert.doesNotMatch(JSON.stringify(result.result), /\/Users|\/private\/tmp|\/opt\/homebrew/);
});

test('账号工具不向模型返回 PAT 提示和 CLI 本地保存路径', async () => {
  const harness = createMainHarness(async () => ({
    ok: true,
    result: {
      structuredContent: {
        ok: true,
        patHint: 'abcd********wxyz',
        result: {
          tap_auth_path: '/Users/example/.taptap-maker/tap-auth.json',
        },
      },
    },
  }));

  const result = await harness.call('maker_login');
  assert.equal(result.result.ok, true);
  assert.equal(result.result.patHint, undefined);
  assert.equal(result.result.result.tap_auth_path, '<local-path>');
  assert.doesNotMatch(JSON.stringify(result.result), /abcd|wxyz|\/Users/);
});

test('Maker 明确要求恢复身份时会自动创建身份并重试原调用一次', async () => {
  let feedbackCalls = 0;
  const calledTools = [];
  const harness = createMainHarness(async (request) => {
    if (request.method === 'cindy/tools-list') {
      return {
        ok: true,
        result: { tools: [{ name: 'get_debug_feedbacks' }] },
      };
    }
    calledTools.push(request.params.name);
    if (request.params.name === 'generate_test_qrcode') {
      return { ok: true, result: { content: [{ type: 'text', text: 'created' }] } };
    }
    feedbackCalls += 1;
    if (feedbackCalls === 1) {
      return {
        ok: true,
        result: {
          isError: true,
          content: [{
            type: 'text',
            text: [
              'Maker project initialization',
              '- status: missing_taptap_identity',
              '- missing_fields: app_id',
              '- next_action: call generate_test_qrcode',
            ].join('\n'),
          }],
        },
      };
    }
    return { ok: true, result: { content: [{ type: 'text', text: 'feedbacks' }] } };
  });

  const result = await harness.call('maker_call_tool', {
    name: 'get_debug_feedbacks',
    args: {},
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calledTools, [
    'get_debug_feedbacks',
    'generate_test_qrcode',
    'get_debug_feedbacks',
  ]);
  assert.equal(result.result.content[0].text, 'feedbacks');
});

test('兼容 Maker JSON 文本中的缺失身份信号并重试原调用一次', async () => {
  let adConfigCalls = 0;
  const calledTools = [];
  const harness = createMainHarness(async (request) => {
    if (request.method === 'cindy/tools-list') {
      return {
        ok: true,
        result: { tools: [{ name: 'get_ad_config' }] },
      };
    }
    calledTools.push(request.params.name);
    if (request.params.name === 'generate_test_qrcode') {
      return { ok: true, result: { content: [{ type: 'text', text: 'created' }] } };
    }
    adConfigCalls += 1;
    if (adConfigCalls === 1) {
      return {
        ok: true,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: [
                '项目配置中缺少 app_id 或 developer_id。',
                '请先调用 generate_test_qrcode 生成这些字段。',
              ].join('\n'),
            }),
          }],
        },
      };
    }
    return { ok: true, result: { content: [{ type: 'text', text: 'ad config ready' }] } };
  });

  const result = await harness.call('maker_call_tool', {
    name: 'get_ad_config',
    args: {},
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
    },
  });
  assert.deepEqual(calledTools, [
    'get_ad_config',
    'generate_test_qrcode',
    'get_ad_config',
  ]);
  assert.equal(result.result.content[0].text, 'ad config ready');
});

test('项目尚未构建时只返回前置约束，不自动构建或生成二维码', async () => {
  const calledTools = [];
  const harness = createMainHarness(async (request) => {
    if (request.method === 'cindy/tools-list') {
      return {
        ok: true,
        result: { tools: [{ name: 'get_ad_config' }] },
      };
    }
    calledTools.push(request.params.name);
    return {
      ok: true,
      result: {
        isError: true,
        content: [{
          type: 'text',
          text: [
            'Maker project structure',
            '- status: not_initialized',
            '- can_generate_test_qrcode: no',
            '- issue: missing_project_json: /Users/example/project/.project/project.json',
            '- next_action: 仅当用户明确要求构建、提交或预览时调用 maker_build_current_directory。',
          ].join('\n'),
        }],
      },
    };
  });

  const result = await harness.call('maker_call_tool', {
    name: 'get_ad_config',
    args: {},
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
    },
  });
  assert.deepEqual(calledTools, ['get_ad_config']);
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /status: not_initialized/);
  assert.match(result.result.content[0].text, /明确要求构建、提交或预览/);
  assert.doesNotMatch(result.result.content[0].text, /\/Users\/example/);
});

test('二维码缺构建信息时引导用户主动构建，不泄露凭证、路径和调用栈', async () => {
  const calledTools = [];
  const harness = createMainHarness(async (request) => {
    if (request.method === 'cindy/tools-list') {
      return {
        ok: true,
        result: { tools: [{ name: 'get_ad_config' }] },
      };
    }
    calledTools.push(request.params.name);
    if (request.params.name === 'get_ad_config') {
      return {
        ok: true,
        result: {
          structuredContent: { status: 'missing_taptap_identity' },
          content: [{
            type: 'text',
            text: '- status: missing_taptap_identity\n- next_action: generate_test_qrcode',
          }],
        },
      };
    }
    return {
      ok: true,
      result: {
        isError: true,
        content: [{
          type: 'text',
          text: [
            '✗ Maker MCP tool failed',
            '- tool: generate_test_qrcode',
            '- error_name: McpError',
            '- message: MCP error -32603: 无效的游戏类型 token=secret',
            'debug:',
            '  at Client.file:///Users/example/private/runtime.js:1:1',
          ].join('\n'),
        }],
      },
    };
  });
  const result = await harness.call('maker_call_tool', {
    name: 'get_ad_config',
    args: {},
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
    },
  });
  assert.deepEqual(calledTools, ['get_ad_config', 'generate_test_qrcode']);
  assert.equal(result.result.isError, true);
  assert.match(
    result.result.content[0].text,
    /请先明确执行一次构建或预览，并按提示完成游戏类型、屏幕方向等选择/,
  );
  assert.doesNotMatch(
    result.result.content[0].text,
    /secret|\/Users|runtime\.js|debug|无效的游戏类型/i,
  );
  assert.equal(result.result.structuredContent.step, 'generate_test_qrcode');
  assert.equal(result.result.structuredContent.errorCode, -32603);
});

test('普通 Maker 工具失败也会统一脱敏并保留积分不足信号', async () => {
  const harness = createMainHarness(async (request) => {
    if (request.method === 'cindy/tools-list') {
      return {
        ok: true,
        result: { tools: [{ name: 'generate_image' }] },
      };
    }
    return {
      ok: true,
      result: {
        isError: true,
        content: [{
          type: 'text',
          text: [
            '✗ Maker MCP tool failed',
            '- tool: generate_image',
            '- message: MCP error -32600: INSUFFICIENT_BALANCE',
            'debug:',
            '  Authorization: Bearer secret-token',
            '  at file:///private/tmp/maker.js:1:1',
          ].join('\n'),
        }],
      },
    };
  });
  const result = await harness.call('maker_call_tool', {
    name: 'generate_image',
    args: {},
    session_context: {
      workdir_is_local: true,
      workdir: '/tmp/trusted-maker',
    },
  });
  assert.equal(result.result.isError, true);
  assert.equal(result.result.content[0].text, 'MCP error -32600: INSUFFICIENT_BALANCE');
  assert.equal(result.result.structuredContent.errorCode, -32600);
  assert.equal(result.result.structuredContent.reason, 'INSUFFICIENT_BALANCE');
  assert.doesNotMatch(JSON.stringify(result.result), /secret-token|\/private\/tmp|debug/i);
});

test('远程 workdir 在启动 Node Runtime 前即被拒绝', async () => {
  const harness = createMainHarness(async () => {
    throw new Error('不应调用 Node Runtime');
  });
  const result = await harness.call('maker_status', {
    session_context: {
      workdir_is_local: false,
      workdir: '/remote/project',
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /没有可用的本地工作目录/);
  assert.equal(harness.nodeRequests.length, 0);
});

test('计划或只读会话拒绝可能写工作区的操作，但仍允许状态检查', async () => {
  for (const [tool, args] of [
    ['maker_init', { app_id: 'app-1' }],
    ['maker_build', {}],
    ['maker_call_tool', { name: 'generate_image', args: {} }],
    ['maker_call_tool', { name: 'query_video_task', args: { task_id: 'video-1' } }],
    ['maker_call_tool', {
      name: 'get_debug_feedbacks',
      args: { fetch_and_mark_processed: false },
    }],
  ]) {
    const harness = createMainHarness(async () => {
      throw new Error('只读门禁应在 Node Runtime 前拒绝');
    });
    const result = await harness.call(tool, {
      ...args,
      session_context: {
        workdir_is_local: true,
        workdir_is_read_only: true,
        workdir: '/tmp/trusted-maker',
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /计划或只读模式/);
    assert.equal(harness.nodeRequests.length, 0);
  }

  const readHarness = createMainHarness(async () => ({
    ok: true,
    result: { content: [{ type: 'text', text: 'status ok' }] },
  }));
  const status = await readHarness.call('maker_status', {
    session_context: {
      workdir_is_local: true,
      workdir_is_read_only: true,
      workdir: '/tmp/trusted-maker',
    },
  });
  assert.equal(status.ok, true);
  assert.equal(readHarness.nodeRequests.length, 1);
});

test('设置页重发同一 reqId 不会重复执行长任务', async () => {
  let resolveNode;
  const nodeResult = new Promise((resolve) => {
    resolveNode = resolve;
  });
  const harness = createMainHarness(async () => nodeResult);
  const request = {
    type: 'settings-request',
    reqId: 'settings-1',
    action: 'status',
    payload: {},
  };

  harness.settingsChannel.onmessage({ data: request });
  harness.settingsChannel.onmessage({ data: request });
  await Promise.resolve();
  assert.equal(harness.nodeRequests.length, 1);

  resolveNode({
    ok: true,
    result: { structuredContent: { ok: true, state: 'connected' } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.settingsChannel.messages.length, 1);
  assert.equal(harness.settingsChannel.messages[0].reqId, 'settings-1');
  assert.equal(harness.settingsChannel.messages[0].result.state, 'connected');

  harness.settingsChannel.onmessage({ data: request });
  assert.equal(harness.nodeRequests.length, 1);
  assert.equal(harness.settingsChannel.messages.length, 2);
  assert.deepEqual(
    harness.settingsChannel.messages[1],
    harness.settingsChannel.messages[0],
  );
});

test('MCP root router 只为当前 tools/list 暴露一个可信 file root', () => {
  const hostLines = [];
  const runtimeLines = [];
  const router = rootRouterModule.createMcpRootRouter({
    writeHost: (line) => hostLines.push(JSON.parse(line)),
    writeRuntime: (line) => runtimeLines.push(JSON.parse(line)),
  });

  router.handleHostLine(JSON.stringify({
    jsonrpc: '2.0',
    id: '1',
    method: 'initialize',
    params: { capabilities: {} },
  }));
  assert.deepEqual(runtimeLines.shift().params.capabilities.roots, {
    listChanged: false,
  });

  router.handleHostLine(JSON.stringify({
    jsonrpc: '2.0',
    id: '2',
    method: 'cindy/tools-list',
    params: { target_dir: '/tmp/trusted-maker' },
  }));
  assert.equal(runtimeLines.shift().method, 'tools/list');

  router.handleRuntimeLine(JSON.stringify({
    jsonrpc: '2.0',
    id: 'root-1',
    method: 'roots/list',
    params: {},
  }));
  // Derive the expected URI rather than hardcoding a POSIX one: on Windows
  // pathToFileURL('/tmp/...') resolves against the current drive and yields
  // file:///C:/tmp/..., so a literal file:///tmp/... only passes on POSIX.
  assert.deepEqual(runtimeLines.shift().result.roots, [{
    uri: pathToFileURL('/tmp/trusted-maker').href,
    name: 'trusted-maker',
  }]);

  router.handleRuntimeLine(JSON.stringify({
    jsonrpc: '2.0',
    id: '2',
    result: { tools: [{ name: 'maker_status_lite' }] },
  }));
  assert.deepEqual(hostLines, [{
    jsonrpc: '2.0',
    id: '2',
    result: { tools: [{ name: 'maker_status_lite' }] },
  }]);
});

test('MCP root router 超时后拒绝陈旧响应并触发进程重建', async () => {
  const hostLines = [];
  const runtimeLines = [];
  const fatalErrors = [];
  const router = rootRouterModule.createMcpRootRouter({
    writeHost: (line) => hostLines.push(JSON.parse(line)),
    writeRuntime: (line) => runtimeLines.push(JSON.parse(line)),
    listTimeoutMs: 10,
    onFatal: (error) => fatalErrors.push(error),
  });

  router.handleHostLine(JSON.stringify({
    jsonrpc: '2.0',
    id: 'stale-list',
    method: 'cindy/tools-list',
    params: { target_dir: '/tmp/stale-maker' },
  }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(hostLines[0].id, 'stale-list');
  assert.match(hostLines[0].error.message, /响应超时/);
  assert.equal(fatalErrors.length, 1);

  router.handleRuntimeLine(JSON.stringify({
    jsonrpc: '2.0',
    id: 'stale-list',
    result: { tools: [{ name: 'stale' }] },
  }));
  assert.equal(hostLines.length, 1);
});

test('真实 Maker Runtime 可经插件入口完成 initialize 与 roots-aware tools/list', {
  timeout: 15_000,
}, async () => {
  const makerMcpEntry = fileURLToPath(new URL('node/maker-mcp.cjs', pluginRoot));
  const bootstrap = [
    'globalThis.__CINDY_NODE__ = {',
    '  spawnEntry() { return Promise.reject(new Error("unexpected child spawn")); }',
    '};',
    `require(${JSON.stringify(makerMcpEntry)});`,
  ].join('\n');
  const child = childProcess.spawn(process.execPath, ['-e', bootstrap], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let stdoutBuffer = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newline = stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(String(message.id))) {
        pending.get(String(message.id))(message);
        pending.delete(String(message.id));
      }
    }
  });

  function request(id, method, params) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(new Error(`Maker Runtime 请求超时：${method}\n${stderr}`));
      }, 10_000);
      pending.set(String(id), (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      })}\n`);
    });
  }

  try {
    const initialized = await request('1', 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    assert.equal(initialized.result.serverInfo.name, 'taptap-maker');
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    })}\n`);

    const listed = await request('2', 'cindy/tools-list', {
      target_dir: '/tmp/cindy-taptap-maker-unbound-test',
    });
    assert.equal(listed.error, undefined, stderr);
    assert.equal(listed.result.tools.length, 18);
    assert.ok(listed.result.tools.some((tool) => tool.name === 'maker_status_lite'));
    assert.ok(listed.result.tools.some((tool) => tool.name === 'maker_build_current_directory'));
    assert.ok(listed.result.tools.some((tool) => tool.name === 'generate_image'));
    assert.ok(listed.result.tools.some((tool) => tool.name === 'get_debug_feedbacks'));

    const guide = await request('3', 'resources/read', {
      uri: 'maker://ads-integration-guide',
    });
    assert.equal(guide.error, undefined, stderr);
    assert.match(guide.result.contents[0].text, /TapTap Maker ads integration guide/);
    assert.match(guide.result.contents[0].text, /get_ad_config/);
    assert.match(guide.result.contents[0].text, /engine-docs\/recipes\/sdk\.md/);

    const status = await request('4', 'tools/call', {
      name: 'maker_status_lite',
      arguments: {
        target_dir: '/tmp/cindy-taptap-maker-unbound-test',
        detail: true,
        skip_remote_sync: true,
      },
    });
    assert.equal(status.error, undefined, stderr);
    assert.match(status.result.content[0].text, /- status: managed_by_plugin/);
  } finally {
    child.kill();
    await once(child, 'close');
  }
});

test('宿主钉死 stdio 时插件入口仍完成 initialize 与 roots-aware tools/list', {
  timeout: 20_000,
}, async () => {
  const makerMcpEntry = fileURLToPath(new URL('node/maker-mcp.cjs', pluginRoot));
  // 复刻 Electron 在 Windows 上给 utilityProcess 的 stdio：process.stdin 是
  // configurable: false 的 getter，宿主靠 stub.push 喂字节；宿主先宣布 ready、
  // 再 require 本入口，所以第一条 initialize 已经落进流缓冲。stdout 一并钉死，
  // 把 write 劫持路径也覆盖到。
  const bootstrap = [
    'const { Readable } = require("node:stream");',
    'const pipeStdin = process.stdin;',
    'const pipeStdout = process.stdout;',
    'const stubStdin = new Readable({ read() {} });',
    'pipeStdin.on("data", (chunk) => { stubStdin.push(chunk); });',
    'pipeStdin.on("end", () => { stubStdin.push(null); });',
    'Object.defineProperty(process, "stdin", {',
    '  configurable: false,',
    '  enumerable: true,',
    '  get() { return stubStdin; },',
    '});',
    'Object.defineProperty(process, "stdout", {',
    '  configurable: false,',
    '  enumerable: true,',
    '  get() { return pipeStdout; },',
    '});',
    'globalThis.__CINDY_NODE__ = {',
    '  spawnEntry() { return Promise.reject(new Error("unexpected child spawn")); }',
    '};',
    'stubStdin.push(JSON.stringify({',
    '  jsonrpc: "2.0",',
    '  id: "buffered-init",',
    '  method: "initialize",',
    '  params: {',
    '    protocolVersion: "2024-11-05",',
    '    capabilities: {},',
    '    clientInfo: { name: "test", version: "1" },',
    '  },',
    '}) + "\\n");',
    `require(${JSON.stringify(makerMcpEntry)});`,
  ].join('\n');
  const child = childProcess.spawn(process.execPath, ['-e', bootstrap], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let stdoutBuffer = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newline = stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(String(message.id))) {
        pending.get(String(message.id))(message);
        pending.delete(String(message.id));
      }
    }
  });

  function expect(id, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(String(id));
        reject(new Error(`Maker Runtime 请求超时：${label}\n${stderr}`));
      }, 15_000);
      pending.set(String(id), (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  try {
    // 装劫持前落进缓冲的 initialize 也必须经 router，否则动态 tools/list 会残废。
    const initialized = await expect('buffered-init', 'initialize');
    assert.equal(initialized.result.serverInfo.name, 'taptap-maker');
    assert.doesNotMatch(stderr, /Cannot redefine property/);

    const listed = expect('pinned-list', 'cindy/tools-list');
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    })}\n`);
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'pinned-list',
      method: 'cindy/tools-list',
      params: { target_dir: '/tmp/cindy-taptap-maker-pinned-stdio-test' },
    })}\n`);

    const tools = await listed;
    assert.equal(tools.error, undefined, stderr);
    assert.ok(tools.result.tools.some((tool) => tool.name === 'maker_status_lite'));
    assert.ok(tools.result.tools.some((tool) => tool.name === 'maker_build_current_directory'));
  } finally {
    child.kill();
    await once(child, 'close');
  }
});

test('spawn adapter 只改道固定 Maker 入口并用参数传递 proxy 配置', async () => {
  const makerEntry = path.resolve('/tmp/vendor/maker.js');
  const calls = [];
  const handle = fakeChildHandle();
  const restore = adapter.installMakerSpawnAdapter({
    makerEntry,
    childEntry: 'node/maker-child.cjs',
    spawnEntry: async (entry, args) => {
      calls.push({ entry, args });
      return handle;
    },
  });

  try {
    const child = childProcess.spawn(
      process.execPath,
      [makerEntry, '__maker-proxy'],
      { env: { PROXY_CONFIG: '{"server":{"url":"https://example.test"}}' } },
    );
    assert.equal(child.unref(), child);
    assert.equal(child.ref(), child);
    await once(child, 'spawn');
    assert.deepEqual(calls, [{
      entry: 'node/maker-child.cjs',
      args: [
        '__maker-proxy',
        '{"server":{"url":"https://example.test"}}',
      ],
    }]);
  } finally {
    restore();
  }
});

test('logs watch 在 Cindy 中使用系统 Node 且不调用 spawnEntry', () => {
  const makerEntry = path.resolve('/tmp/vendor/maker.js');
  const originalSpawn = childProcess.spawn;
  const nativeChild = fakeChildHandle();
  const nativeCalls = [];
  let spawnEntryCalls = 0;
  childProcess.spawn = function fakeNativeSpawn(command, args, options) {
    nativeCalls.push({ command, args, options });
    return nativeChild;
  };
  syncBuiltinESMExports();
  let restore;

  try {
    restore = adapter.installMakerSpawnAdapter({
      makerEntry,
      childEntry: 'node/maker-child.cjs',
      spawnEntry: async () => {
        spawnEntryCalls += 1;
        return fakeChildHandle();
      },
    });
    const spawnOptions = {
      cwd: '/tmp/project',
      detached: true,
      stdio: ['ignore', 7, 8],
    };
    const child = childProcess.spawn(
      process.execPath,
      [makerEntry, 'logs', 'watch', '--target-dir', '/tmp/project'],
      spawnOptions,
    );

    assert.equal(child, nativeChild);
    assert.equal(spawnEntryCalls, 0);
    assert.deepEqual(nativeCalls, [{
      command: 'node',
      args: [makerEntry, 'logs', 'watch', '--target-dir', '/tmp/project'],
      options: spawnOptions,
    }]);
  } finally {
    if (restore) restore();
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

test('logs watch 系统 Node 启动失败只报错一次且不影响其他 Maker 子进程', async () => {
  const makerEntry = path.resolve('/tmp/vendor/maker.js');
  const originalSpawn = childProcess.spawn;
  const failedWatcher = fakeChildHandle();
  failedWatcher.pid = undefined;
  let nativeSpawnCalls = 0;
  let spawnEntryCalls = 0;
  childProcess.spawn = function fakeNativeSpawn() {
    nativeSpawnCalls += 1;
    return failedWatcher;
  };
  syncBuiltinESMExports();
  let restore;

  try {
    restore = adapter.installMakerSpawnAdapter({
      makerEntry,
      childEntry: 'node/maker-child.cjs',
      spawnEntry: async () => {
        spawnEntryCalls += 1;
        return fakeChildHandle();
      },
    });
    const watcher = childProcess.spawn(
      process.execPath,
      [makerEntry, 'logs', 'watch', '--target-dir', '/tmp/project'],
      {},
    );
    const watcherErrors = [];
    watcher.on('error', (error) => watcherErrors.push(error));
    failedWatcher.emit('error', new Error('spawn node ENOENT'));

    assert.equal(nativeSpawnCalls, 1);
    assert.equal(spawnEntryCalls, 0);
    assert.equal(watcherErrors.length, 1);
    assert.match(watcherErrors[0].message, /ENOENT/);

    const proxy = childProcess.spawn(
      process.execPath,
      [makerEntry, '__maker-proxy'],
      { env: { PROXY_CONFIG: '{}' } },
    );
    await once(proxy, 'spawn');
    assert.equal(nativeSpawnCalls, 1);
    assert.equal(spawnEntryCalls, 1);
  } finally {
    if (restore) restore();
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
});

test('只在 Maker CLI 最终 JSON 到达后判定完成', () => {
  assert.equal(adapter.isMakerCliOutputComplete(
    ['apps', '--json'],
    '[{"id":"app-1"}]\n',
  ), true);
  assert.equal(adapter.isMakerCliOutputComplete(
    ['login', '--json'],
    '{"step":"login","status":"ok","message":"Opening Maker PAT page"}\n',
  ), false);
  assert.equal(adapter.isMakerCliOutputComplete(
    ['login', '--json'],
    '{"step":"login","status":"ok","data":{"tap_auth_path":"/tmp/tap-auth.json"}}\n',
  ), true);
  assert.equal(adapter.isMakerCliOutputComplete(
    ['init', '--json'],
    '{"step":"clone","status":"progress"}\n',
  ), false);
  assert.equal(adapter.isMakerCliOutputComplete(
    ['init', '--json'],
    '{"step":"clone","status":"progress"}\n{"step":"done","status":"ok"}\n',
  ), true);
  assert.equal(adapter.isMakerCliOutputComplete(
    ['doctor', '--json'],
    '{"env":"production","git":{"ready":true}}\n',
  ), true);
});

test('deferred child 会保留宿主答复前写入 stdin 的 PAT 字节', async () => {
  let resolveHandle;
  const handle = fakeChildHandle();
  const received = [];
  handle.stdin.on('data', (chunk) => received.push(Buffer.from(chunk)));
  const ended = once(handle.stdin, 'end');
  const child = adapter.createDeferredChild(new Promise((resolve) => {
    resolveHandle = resolve;
  }), {});

  child.stdin.end('pat-secret\n');
  resolveHandle(handle);
  await once(child, 'spawn');
  await ended;
  assert.equal(Buffer.concat(received).toString('utf8'), 'pat-secret\n');
});
