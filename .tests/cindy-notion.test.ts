import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type HostMessageHandler = (message: Record<string, unknown>) => Promise<void>;

interface CindyFetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface CindyFetchResponse {
  ok: boolean;
  status: number;
  body?: string;
  message?: string;
  headers?: Record<string, string>;
}

interface CindyMessage {
  type: string;
  ok?: boolean;
  errorCode?: string;
  result?: Record<string, unknown>;
  message?: string;
}

const notionSource = readFileSync(
  new URL('../cindy-notion/main.js', import.meta.url),
  'utf8',
);
const settingsSource = readFileSync(
  new URL('../cindy-notion/settings.js', import.meta.url),
  'utf8',
);
const settingsHtml = readFileSync(
  new URL('../cindy-notion/settings.html', import.meta.url),
  'utf8',
);

class FakeBroadcastChannel {
  onmessage?: (event: { data?: unknown }) => void;
  readonly messages: Array<Record<string, unknown>> = [];

  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);
  }

  emit(message: Record<string, unknown>): void {
    this.onmessage?.({ data: message });
  }
}

type EventListener = (event: Record<string, unknown>) => void;

class FakeSettingsElement {
  textContent = '';
  className = '';
  hidden = false;
  disabled = false;
  value = '';
  type = 'text';
  placeholder = '';
  readonly attributes = new Map<string, string>();
  readonly children: FakeSettingsElement[] = [];
  readonly classNames = new Set<string>();
  readonly listeners = new Map<string, EventListener[]>();
  readonly queryResults = new Map<string, FakeSettingsElement>();
  parent?: FakeSettingsElement;

  readonly classList = {
    add: (...names: string[]) => names.forEach((name) => this.classNames.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classNames.delete(name)),
    toggle: (name: string, force?: boolean) => {
      const enabled = force ?? !this.classNames.has(name);
      if (enabled) this.classNames.add(name);
      else this.classNames.delete(name);
      return enabled;
    },
  };

  constructor(readonly id = '') {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: FakeSettingsElement): FakeSettingsElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  querySelector(selector: string): FakeSettingsElement | null {
    return this.queryResults.get(selector) ?? null;
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  closest(selector: string): FakeSettingsElement | null {
    return selector === '.step' ? this.parent ?? null : null;
  }

  focus(): void {}
}

class FakeSettingsBroadcastChannel {
  readonly listeners = new Set<EventListener>();
  readonly messages: Array<Record<string, unknown>> = [];
  removeCalls = 0;

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.removeCalls += 1;
      this.listeners.delete(listener);
    }
  }

  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);
  }

  emitMessage(message: Record<string, unknown>): void {
    for (const listener of [...this.listeners]) listener({ data: message });
  }
}

interface SettingsFetchResponse {
  status: number;
  json?: () => Promise<unknown>;
}

async function flushSettingsTasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

async function flushNotionTasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function createSettingsHarness(
  respond?: (url: string, method: string) => SettingsFetchResponse | undefined,
) {
  const elements = new Map<string, FakeSettingsElement>();
  const stepHeads: FakeSettingsElement[] = [];
  const add = (id: string) => {
    const element = new FakeSettingsElement(id);
    elements.set(id, element);
    return element;
  };
  const addStep = (id: string) => {
    const step = add(id);
    const head = new FakeSettingsElement();
    const result = new FakeSettingsElement();
    const chevron = new FakeSettingsElement();
    head.parent = step;
    step.queryResults.set('.step-head', head);
    step.queryResults.set('.step-result', result);
    step.queryResults.set('.chevron', chevron);
    stepHeads.push(head);
  };

  [
    'status',
    'connection-row',
    'hero-status',
    'workspace-meta',
    'steps-summary',
    'clear',
    'rebind',
    'test',
    'steps-toggle',
    'toggle-copy',
    'visible-list',
    'token',
    'eye',
    'save',
  ].forEach(add);
  addStep('step-create');
  addStep('step-token');
  addStep('step-access');
  elements.get('token')!.type = 'password';

  const stepsSection = new FakeSettingsElement();
  const toggleChevron = new FakeSettingsElement();
  const channel = new FakeSettingsBroadcastChannel();
  const requests: Array<{ url: string; method: string }> = [];
  const fetchMock = vi.fn(async (input: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    requests.push({ url: input, method });
    const custom = respond?.(input, method);
    if (custom) return custom;
    if (input === '/secrets') {
      return {
        status: 200,
        json: async () => [{ key: 'notion_token', saved: true, tail: '1234' }],
      };
    }
    if (input === '/app-context') {
      return {
        status: 200,
        json: async () => ({ ok: true, context: { locale: 'zh-CN' } }),
      };
    }
    if (input === '/kv') {
      return {
        status: 200,
        json: async () => ({
          notionIdentity: {
            botId: 'bot-id',
            workspaceName: 'Acme',
            visibilityChecked: true,
            visibilityError: '',
            visibleCount: 1,
            visibleHasMore: false,
            visibleSamples: [],
          },
        }),
      };
    }
    return { status: 204, json: async () => ({}) };
  });
  const document = {
    documentElement: new FakeSettingsElement('html'),
    getElementById: (id: string) => elements.get(id) ?? null,
    querySelector: (selector: string) => {
      if (selector === '.steps-section') return stepsSection;
      if (selector === '.toggle-chevron') return toggleChevron;
      return null;
    },
    querySelectorAll: (selector: string) => selector === '.step-head' ? stepHeads : [],
    createElement: () => new FakeSettingsElement(),
  };

  new Script(settingsSource, {
    filename: 'builtin-ghosts/official/cindy-notion/settings.js',
  }).runInContext(
    createContext({
      document,
      BroadcastChannel: class {
        constructor() {
          return channel;
        }
      },
      fetch: fetchMock,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Boolean,
      Array,
      JSON,
    }),
  );
  await flushSettingsTasks();

  return { channel, elements, fetchMock, requests };
}

function jsonResponse(data: unknown, status = 200): CindyFetchResponse {
  return {
    ok: true,
    status,
    body: JSON.stringify(data),
    headers: {},
  };
}

function createNotionHarness(
  respond: (request: CindyFetchRequest) => CindyFetchResponse | Promise<CindyFetchResponse>,
  options?: {
    hostRespond?: (
      input: string,
      init?: { method?: string; body?: string },
    ) => SettingsFetchResponse | Promise<SettingsFetchResponse> | undefined;
  },
) {
  let handler: HostMessageHandler | undefined;
  const requests: CindyFetchRequest[] = [];
  const messages: CindyMessage[] = [];
  const channel = new FakeBroadcastChannel();
  let kvState: Record<string, unknown> = {};
  const hostFetch = vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
    const custom = await options?.hostRespond?.(input, init);
    if (custom) return custom;
    if (input !== '/kv') throw new Error(`unexpected host request: ${input}`);
    if ((init?.method ?? 'GET') === 'PUT') {
      kvState = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      return { status: 204, json: async () => ({}) };
    }
    return {
      status: 200,
      json: async () => JSON.parse(JSON.stringify(kvState)) as Record<string, unknown>,
    };
  });
  const cindy = {
    onHostMessage: vi.fn((nextHandler: HostMessageHandler) => {
      handler = nextHandler;
    }),
    send: vi.fn((message: CindyMessage) => {
      messages.push(message);
      if (message.type === 'fs-request') {
        return Promise.resolve({ ok: false, message: 'test harness does not write files' });
      }
      return Promise.resolve({ ok: true });
    }),
    fetch: vi.fn(async (request: CindyFetchRequest) => {
      requests.push(request);
      return respond(request);
    }),
  };

  new Script(notionSource, {
    filename: 'builtin-ghosts/official/cindy-notion/main.js',
  }).runInContext(
    createContext({
      cindy,
      BroadcastChannel: class {
        constructor() {
          return channel;
        }
      },
      fetch: hostFetch,
      setTimeout,
      clearTimeout,
      Number,
      Object,
      Array,
      String,
      Boolean,
      JSON,
      Math,
      Date,
      RegExp,
      encodeURIComponent,
      decodeURIComponent,
    }),
  );

  if (!handler) throw new Error('Cindy Notion did not register its host-message handler');

  return {
    requests,
    channel,
    hostFetch,
    getKv: () => JSON.parse(JSON.stringify(kvState)) as Record<string, unknown>,
    async call(tool: string, args: Record<string, unknown> = {}): Promise<CindyMessage> {
      messages.length = 0;
      await handler!({
        type: 'tool-call',
        tool,
        callId: 'call-12345678',
        args,
      });
      const result = messages.findLast((message) => message.type === 'tool-result');
      if (!result) throw new Error(`Cindy Notion did not return a result for ${tool}`);
      return JSON.parse(JSON.stringify(result)) as CindyMessage;
    },
  };
}

describe('Cindy Notion', () => {
  it('验证连接时调用 /users/me 并使用 data source 版 API header', async () => {
    const harness = createNotionHarness((request) => {
      if (request.url === 'https://api.notion.com/v1/users/me') {
        return jsonResponse({
          id: 'bot-id',
          name: 'Cindy Bot',
          type: 'bot',
          bot: { workspace_name: 'Acme Workspace' },
        });
      }
      if (request.url === 'https://api.notion.com/v1/search') {
        return jsonResponse({
          results: [{
            object: 'page',
            id: 'page-id',
            properties: {
              title: {
                type: 'title',
                title: [{ plain_text: 'Roadmap' }],
              },
            },
          }],
          has_more: false,
        });
      }
      throw new Error(`unexpected request: ${request.url}`);
    });

    const result = await harness.call('notion_status');

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({
      connected: true,
      bot: {
        id: 'bot-id',
        name: 'Cindy Bot',
        type: 'bot',
        workspace_name: 'Acme Workspace',
      },
      visible_content: {
        check_ok: true,
        visible_count_in_first_page: 1,
        has_more: false,
        samples: [{
          id: 'page-id',
          object: 'page',
          title: 'Roadmap',
        }],
        authorization_required: false,
        guidance: 'Token 与页面授权均正常。',
      },
    });
    expect(harness.requests[0].headers).toMatchObject({
      Accept: 'application/json',
      'Notion-Version': '2025-09-03',
    });
    expect(harness.requests).toHaveLength(2);
  });

  it('并发连接检查只允许最新请求写入身份缓存和回传结果', async () => {
    const firstUser = deferred<CindyFetchResponse>();
    const firstVisibility = deferred<CindyFetchResponse>();
    const secondUser = deferred<CindyFetchResponse>();
    const secondVisibility = deferred<CindyFetchResponse>();
    let userCalls = 0;
    let searchCalls = 0;
    const harness = createNotionHarness((request) => {
      if (request.url.endsWith('/users/me')) {
        userCalls += 1;
        return userCalls === 1 ? firstUser.promise : secondUser.promise;
      }
      if (request.url.endsWith('/search')) {
        searchCalls += 1;
        return searchCalls === 1 ? firstVisibility.promise : secondVisibility.promise;
      }
      throw new Error(`unexpected request: ${request.url}`);
    });

    harness.channel.emit({ type: 'test-connection', reqId: 'check-a' });
    await flushNotionTasks();
    firstUser.resolve(jsonResponse({
      id: 'bot-a',
      name: 'Integration A',
      bot: { workspace_name: 'Workspace A' },
    }));
    await flushNotionTasks();

    harness.channel.emit({ type: 'test-connection', reqId: 'check-b' });
    await flushNotionTasks();
    secondUser.resolve(jsonResponse({
      id: 'bot-b',
      name: 'Integration B',
      bot: { workspace_name: 'Workspace B' },
    }));
    await flushNotionTasks();
    secondVisibility.resolve(jsonResponse({
      results: [{ object: 'page', id: 'page-b', properties: {} }],
      has_more: false,
    }));
    await flushNotionTasks();

    firstVisibility.resolve(jsonResponse({
      results: [{ object: 'page', id: 'page-a', properties: {} }],
      has_more: false,
    }));
    await flushNotionTasks();

    expect(harness.getKv().notionIdentity).toMatchObject({
      botId: 'bot-b',
      workspaceName: 'Workspace B',
      visibleCount: 1,
    });
    expect(
      harness.hostFetch.mock.calls.filter(([, init]) => init?.method === 'PUT'),
    ).toHaveLength(1);
    expect(harness.channel.messages).toHaveLength(1);
    expect(harness.channel.messages[0]).toMatchObject({
      type: 'test-connection-result',
      reqId: 'check-b',
      ok: true,
      workspaceName: 'Workspace B',
    });
  });

  it('新检查失败时会在旧 PUT 完成后清除过期身份', async () => {
    const firstPutStarted = deferred<boolean>();
    const releaseFirstPut = deferred<boolean>();
    let userCalls = 0;
    let putCalls = 0;
    let kvState: Record<string, unknown> = {};
    const harness = createNotionHarness((request) => {
      if (request.url.endsWith('/users/me')) {
        userCalls += 1;
        if (userCalls === 1) {
          return jsonResponse({
            id: 'bot-a',
            name: 'Integration A',
            bot: { workspace_name: 'Workspace A' },
          });
        }
        return jsonResponse({ object: 'error', message: 'invalid token' }, 401);
      }
      if (request.url.endsWith('/search')) {
        return jsonResponse({
          results: [{ object: 'page', id: 'page-a', properties: {} }],
          has_more: false,
        });
      }
      throw new Error(`unexpected request: ${request.url}`);
    }, {
      hostRespond: async (input, init) => {
        expect(input).toBe('/kv');
        if ((init?.method ?? 'GET') === 'PUT') {
          putCalls += 1;
          if (putCalls === 1) {
            firstPutStarted.resolve(true);
            await releaseFirstPut.promise;
          }
          kvState = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
          return { status: 204, json: async () => ({}) };
        }
        return {
          status: 200,
          json: async () => JSON.parse(JSON.stringify(kvState)) as Record<string, unknown>,
        };
      },
    });

    harness.channel.emit({ type: 'test-connection', reqId: 'check-a' });
    await firstPutStarted.promise;

    harness.channel.emit({ type: 'test-connection', reqId: 'check-b' });
    await flushNotionTasks();
    expect(harness.channel.messages).toHaveLength(0);

    releaseFirstPut.resolve(true);
    await flushNotionTasks();
    await flushNotionTasks();

    expect(kvState).not.toHaveProperty('notionIdentity');
    expect(putCalls).toBe(2);
    expect(harness.channel.messages).toHaveLength(1);
    expect(harness.channel.messages[0]).toMatchObject({
      type: 'test-connection-result',
      reqId: 'check-b',
      ok: false,
    });
  });

  it('搜索请求正确构造 filter、sort 和 cursor', async () => {
    const harness = createNotionHarness(() =>
      jsonResponse({ results: [], has_more: false, next_cursor: null }),
    );

    const result = await harness.call('notion_search', {
      query: 'Roadmap',
      object_type: 'page',
      sort_direction: 'ascending',
      page_size: 25,
      cursor: 'next-page',
    });

    expect(result.ok).toBe(true);
    expect(harness.requests).toHaveLength(1);
    expect(JSON.parse(harness.requests[0].body ?? '{}')).toEqual({
      page_size: 25,
      sort: {
        direction: 'ascending',
        timestamp: 'last_edited_time',
      },
      query: 'Roadmap',
      filter: {
        property: 'object',
        value: 'page',
      },
      start_cursor: 'next-page',
    });
  });

  it('无关键词搜索为空时返回明确的页面授权诊断', async () => {
    const harness = createNotionHarness(() =>
      jsonResponse({ results: [], has_more: false, next_cursor: null }),
    );

    const result = await harness.call('notion_search');

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      authorization_diagnostic: {
        request_authenticated: true,
        message: expect.stringContaining('Content access'),
      },
    });
  });

  it('读取 page 时同时取元数据和 2026-03-11 Markdown', async () => {
    const id = '12345678-1234-1234-1234-1234567890ab';
    const harness = createNotionHarness((request) => {
      if (request.url.endsWith(`/pages/${id}`)) {
        return jsonResponse({ object: 'page', id, properties: {} });
      }
      if (request.url.endsWith(`/pages/${id}/markdown?include_transcript=true`)) {
        return jsonResponse({ object: 'page_markdown', id, markdown: '# Hello' });
      }
      throw new Error(`unexpected request: ${request.url}`);
    });

    const result = await harness.call('notion_fetch', {
      id: `https://www.notion.so/Hello-${id.replaceAll('-', '')}`,
      object_type: 'page',
      include_transcript: true,
    });

    expect(result.ok).toBe(true);
    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[0].headers?.['Notion-Version']).toBe('2025-09-03');
    expect(harness.requests[1].headers?.['Notion-Version']).toBe('2026-03-11');
    expect(result.result).toMatchObject({
      content_format: 'markdown',
      content: { markdown: '# Hello' },
    });
  });

  it('在 data source 建页前先读 schema，并自动填写 title 与 Markdown blocks', async () => {
    const dataSourceId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const harness = createNotionHarness((request) => {
      if (request.url.endsWith(`/data_sources/${dataSourceId}`)) {
        return jsonResponse({
          id: dataSourceId,
          properties: {
            Name: { id: 'title', type: 'title' },
            Status: { id: 'status', type: 'status' },
          },
        });
      }
      if (request.url.endsWith('/pages') && request.method === 'POST') {
        return jsonResponse({ object: 'page', id: 'new-page-id' });
      }
      throw new Error(`unexpected request: ${request.url}`);
    });

    const result = await harness.call('notion_create_page', {
      parent_id: dataSourceId,
      parent_type: 'data_source',
      title: 'Launch Plan',
      properties: {
        Status: { status: { name: 'Draft' } },
      },
      markdown: '# Goal\n\n- Ship Cindy Notion',
    });

    expect(result.ok).toBe(true);
    expect(harness.requests.map((request) => request.method ?? 'GET')).toEqual([
      'GET',
      'POST',
    ]);
    const body = JSON.parse(harness.requests[1].body ?? '{}');
    expect(body.parent).toEqual({
      type: 'data_source_id',
      data_source_id: dataSourceId,
    });
    expect(body.properties.Name.title[0].text.content).toBe('Launch Plan');
    expect(body.properties.Status).toEqual({ status: { name: 'Draft' } });
    expect(body.children.map((block: { type: string }) => block.type)).toEqual([
      'heading_1',
      'bulleted_list_item',
    ]);
  });

  it('整页覆盖未确认时拒绝，且不发出任何 API 请求', async () => {
    const harness = createNotionHarness(() => {
      throw new Error('request should not happen');
    });

    const result = await harness.call('notion_update_page', {
      page_id: '12345678-1234-1234-1234-1234567890ab',
      replace_markdown: '# New content',
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('CONFIRM_REQUIRED');
    expect(result.message).toContain('confirm:true');
    expect(harness.requests).toHaveLength(0);
  });

  it('确认后用 2026-03-11 Markdown endpoint 覆盖正文', async () => {
    const id = '12345678-1234-1234-1234-1234567890ab';
    const harness = createNotionHarness((request) => {
      expect(request.url).toBe(`https://api.notion.com/v1/pages/${id}/markdown`);
      return jsonResponse({ object: 'page_markdown', id, markdown: '# New content' });
    });

    const result = await harness.call('notion_update_page', {
      page_id: id,
      replace_markdown: '# New content',
      confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(harness.requests[0].method).toBe('PATCH');
    expect(harness.requests[0].headers?.['Notion-Version']).toBe('2026-03-11');
    expect(JSON.parse(harness.requests[0].body ?? '{}')).toEqual({
      type: 'replace_content',
      replace_content: {
        new_str: '# New content',
        allow_deleting_content: false,
      },
    });
  });

  it('追加 Markdown 使用 block children API 且不覆盖现有内容', async () => {
    const id = '12345678-1234-1234-1234-1234567890ab';
    const harness = createNotionHarness(() =>
      jsonResponse({ object: 'list', results: [] }),
    );

    const result = await harness.call('notion_append_content', {
      block_id: id,
      markdown: '- [x] Checked\n\n```js\nconsole.log("ok")\n```',
    });

    expect(result.ok).toBe(true);
    expect(harness.requests[0].url).toBe(
      `https://api.notion.com/v1/blocks/${id}/children`,
    );
    expect(harness.requests[0].method).toBe('PATCH');
    const body = JSON.parse(harness.requests[0].body ?? '{}');
    expect(body.children.map((block: { type: string }) => block.type)).toEqual([
      'to_do',
      'code',
    ]);
    expect(body.children[1].code.language).toBe('javascript');
  });

  it('401 错误映射为可执行的重新连接指引', async () => {
    const harness = createNotionHarness(() =>
      jsonResponse({ object: 'error', message: 'API token is invalid.' }, 401),
    );

    const result = await harness.call('notion_status');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('重新连接');
    expect(result.message).not.toContain('API token is invalid');
  });
});

describe('Cindy Notion settings', () => {
  it('授权指引同时兼容新旧 integration 名称', () => {
    expect(settingsHtml).toContain('usually Notion for new integrations');
    expect(settingsHtml).toContain('older ones may show Cindy Notion');
    expect(settingsSource).toContain('新建时通常为 Notion');
    expect(settingsSource).toContain('旧版可能显示 Cindy Notion');
  });

  it('跟随宿主四语言并以英文回退', () => {
    expect(settingsHtml).toContain('<html lang="en">');
    expect(settingsSource).toContain("fetch('/app-context')");
    expect(settingsSource).toContain("currentLocale = 'en'");
    expect(settingsSource).toContain('document.documentElement.lang = currentLocale');
    expect(settingsSource).not.toMatch(/\bnavigator\.(?:language|languages)\b/);
    for (const locale of ['en', 'zh-CN', 'ja', 'ko']) {
      expect(settingsSource).toContain(`${locale.includes('-') ? `'${locale}'` : locale}: {`);
    }
    expect(settingsSource).toContain('locale: currentLocale');
    expect(notionSource).toContain('SETTINGS_MESSAGES');
  });

  it('密钥删除失败时保留身份缓存并显示失败', async () => {
    const harness = await createSettingsHarness((url, method) => {
      if (url === '/secrets/notion_token' && method === 'DELETE') {
        return { status: 500, json: async () => ({}) };
      }
      return undefined;
    });

    harness.elements.get('clear')!.emit('click');
    await flushSettingsTasks();

    expect(harness.elements.get('status')!.textContent).toBe('清除失败，请重试');
    expect(harness.requests).not.toContainEqual({ url: '/kv', method: 'PUT' });
  });

  it('连接检查超时时注销本次 BroadcastChannel 监听器', async () => {
    vi.useFakeTimers();
    try {
      const harness = await createSettingsHarness();

      harness.elements.get('test')!.emit('click');
      await flushSettingsTasks();
      expect(harness.channel.listeners.size).toBe(1);

      await vi.advanceTimersByTimeAsync(15_000);
      await flushSettingsTasks();

      expect(harness.channel.removeCalls).toBe(1);
      expect(harness.channel.listeners.size).toBe(0);
      expect(harness.elements.get('status')!.textContent).toBe('检查超时——请稍后重试');
    } finally {
      vi.useRealTimers();
    }
  });

  it('新连接检查会取消旧检查，旧超时不会覆盖新结果', async () => {
    vi.useFakeTimers();
    try {
      const harness = await createSettingsHarness();

      harness.elements.get('test')!.emit('click');
      await flushSettingsTasks();
      await vi.advanceTimersByTimeAsync(1_000);

      harness.elements.get('test')!.emit('click');
      await flushSettingsTasks();
      const latestRequest = harness.channel.messages.findLast(
        (message) => message.type === 'test-connection',
      );
      expect(harness.channel.listeners.size).toBe(1);

      harness.channel.emitMessage({
        type: 'test-connection-result',
        reqId: latestRequest?.reqId,
        ok: true,
        visibleCount: 1,
      });
      await flushSettingsTasks();
      expect(harness.elements.get('status')!.textContent).toBe(
        '连接完成，Cindy 已能读取授权内容',
      );

      await vi.advanceTimersByTimeAsync(14_000);
      await flushSettingsTasks();

      expect(harness.channel.listeners.size).toBe(0);
      expect(harness.elements.get('status')!.textContent).not.toBe(
        '检查超时——请稍后重试',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
