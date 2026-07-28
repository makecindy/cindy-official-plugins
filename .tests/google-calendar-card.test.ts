import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type HostMessageHandler = (message: Record<string, unknown>) => Promise<void>;

interface CindyMessage {
  type: string;
  callId?: string;
  ok?: boolean;
  html?: string;
  height?: number;
  state?: string;
  message?: string;
  result?: unknown;
}

interface CindyRequest {
  url: string;
  method?: string;
  body?: string;
}

interface ApiResponse {
  ok: boolean;
  status: number;
  body: string;
  headers: Record<string, string>;
}

const calendarSource = readFileSync(
  new URL('../google-calendar/main.js', import.meta.url),
  'utf8',
);

const manifest = JSON.parse(
  readFileSync(new URL('../google-calendar/ghost.json', import.meta.url), 'utf8'),
) as {
  slots: string[];
  version: string;
  network: { secrets: Array<{ url?: string; oauth?: { clientSecret?: string } }> };
  tools: Array<{
    name: string;
    parameters: { properties: Record<string, { type?: string }> };
  }>;
};

function response(body: unknown, status = 200): ApiResponse {
  return {
    ok: true,
    status,
    body: status === 204 ? '' : JSON.stringify(body),
    headers: {},
  };
}

function createCalendarHarness(
  responder: (request: CindyRequest) => ApiResponse | Promise<ApiResponse>,
) {
  let handler: HostMessageHandler | undefined;
  const messages: CindyMessage[] = [];
  const requests: CindyRequest[] = [];
  const cindy = {
    onHostMessage: vi.fn((nextHandler: HostMessageHandler) => {
      handler = nextHandler;
    }),
    send: vi.fn(async (message: CindyMessage) => {
      messages.push(message);
      return { ok: true };
    }),
    fetch: vi.fn(async (request: CindyRequest) => {
      requests.push(request);
      return responder(request);
    }),
  };

  new Script(calendarSource, {
    filename: 'official-plugins/google-calendar/main.js',
  }).runInContext(
    createContext({
      cindy,
      fetch: vi.fn(),
      Intl,
      Date,
      isNaN,
      isFinite,
      encodeURIComponent,
    }),
  );

  if (!handler) throw new Error('Google Calendar did not register its host-message handler');
  return { handler, messages, requests };
}

describe('Google Calendar 自绘卡', () => {
  it('身份卡声明 card 槽、地点参数和版本', () => {
    const calendarTool = manifest.tools.find((tool) => tool.name === 'google_calendar');

    expect(manifest.slots).toContain('card');
    expect(manifest.version).toBe('1.3.13');
    expect(calendarTool?.parameters.properties.location?.type).toBe('string');
    expect(
      manifest.network.secrets.some((secret) => secret.url === 'https://calendar.google.com/'),
    ).toBe(true);
    expect(manifest.network.secrets[0]?.oauth?.clientSecret).toBeTruthy();
  });

  it('事件列表先发送紧凑过程态，再发送可点击的最终卡和工具结果', async () => {
    const harness = createCalendarHarness(() =>
      response({
        items: [
          {
            id: 'evt-1',
            summary: '产品评审',
            location: 'A3 会议室',
            htmlLink: 'https://www.google.com/calendar/event?eid=abc&x=1',
            start: { dateTime: '2026-07-24T10:00:00+08:00' },
            end: { dateTime: '2026-07-24T11:00:00+08:00' },
          },
          {
            id: 'evt-2',
            summary: '跨午夜同步',
            start: { dateTime: '2026-07-24T23:00:00+08:00' },
            end: { dateTime: '2026-07-25T01:00:00+08:00' },
          },
        ],
      }),
    );

    await harness.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-1',
      args: { action: 'list_events' },
    });

    expect(harness.messages.map((message) => message.type)).toEqual([
      'card-update',
      'card-update',
      'tool-result',
    ]);
    expect(harness.messages[0]).toMatchObject({
      state: 'working',
      height: 72,
    });
    expect(harness.messages[0].html).toContain('正在查询日程');

    const card = harness.messages[1];
    expect(card.state).toBe('done');
    expect(card.html).toContain('产品评审');
    expect(card.html).toContain('10:00–11:00');
    expect(card.html).toContain('A3 会议室');
    expect(card.html).toContain('23:00 → 7月25日 01:00');
    expect(card.html).toContain(
      'data-ghost-link="https://www.google.com/calendar/event?eid=abc&amp;x=1"',
    );
    expect(card.html).toContain('background:rgba(255,255,255,.6)');
    expect(card.html).toContain('width:4px');
    expect(card.html).not.toContain('data-ghost-action=');
    expect(card.height).toBeGreaterThanOrEqual(104);
    expect(card.height).toBeLessThanOrEqual(720);
  });

  it('全天、动态文本、空结果和 API 错误都有明确状态', async () => {
    const escaped = createCalendarHarness(() =>
      response({
        items: [
          {
            id: 'evt-x',
            summary: '<script>alert("x")</script>',
            location: '<b>大宁</b>',
            start: { date: '2026-07-25' },
            end: { date: '2026-07-26' },
          },
        ],
      }),
    );
    await escaped.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-x',
      args: { action: 'list_events' },
    });
    expect(escaped.messages[1].html).toContain('全天');
    expect(escaped.messages[1].html).toContain('&lt;script&gt;');
    expect(escaped.messages[1].html).toContain('&lt;b&gt;大宁&lt;/b&gt;');
    expect(escaped.messages[1].html).not.toContain('<script>alert');

    const empty = createCalendarHarness(() => response({ items: [] }));
    await empty.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-empty',
      args: { action: 'list_events' },
    });
    expect(empty.messages[1].html).toContain('这段时间没有日程');

    const failed = createCalendarHarness(() =>
      response({ error: { message: 'Quota exceeded' } }, 429),
    );
    await failed.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-fail',
      args: { action: 'list_events' },
    });
    expect(failed.messages.map((message) => message.type)).toEqual([
      'card-update',
      'card-update',
      'tool-result',
    ]);
    expect(failed.messages[1].html).toContain('操作未完成');
    expect(failed.messages[1].state).toBe('done');
    expect(failed.messages[2].ok).toBe(false);
  });

  it('修改日程会把地点与时间真实写入 Google PATCH', async () => {
    const harness = createCalendarHarness(() =>
      response({
        id: 'evt-1',
        summary: '约会',
        location: '大宁',
        htmlLink: 'https://www.google.com/calendar/event?eid=evt-1',
        start: { dateTime: '2026-07-25T20:00:00+08:00' },
        end: { dateTime: '2026-07-25T21:00:00+08:00' },
        status: 'confirmed',
      }),
    );

    await harness.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-update',
      args: {
        action: 'update_event',
        event_id: 'evt-1',
        location: '大宁',
        start: '2026-07-25T20:00:00+08:00',
        end: '2026-07-25T21:00:00+08:00',
      },
    });

    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0].method).toBe('PATCH');
    expect(JSON.parse(harness.requests[0].body ?? '{}')).toEqual({
      location: '大宁',
      start: { dateTime: '2026-07-25T20:00:00+08:00' },
      end: { dateTime: '2026-07-25T21:00:00+08:00' },
    });
    expect(harness.messages[1].html).toContain('日程已修改');
    expect(harness.messages[1].html).toContain('大宁');
  });

  it('删除结果保留灰色划线详情，但不挂失效外链', async () => {
    const harness = createCalendarHarness(() => response(null, 204));

    await harness.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-delete',
      args: {
        action: 'delete_event',
        event_id: 'evt-delete',
        summary: '已取消约会',
        location: '大宁',
        start: '2026-07-25T20:00:00+08:00',
        end: '2026-07-25T21:00:00+08:00',
      },
    });

    expect(harness.requests.map((request) => request.method ?? 'GET')).toEqual(['DELETE']);
    expect(harness.messages[1].html).toContain('日程已删除');
    expect(harness.messages[1].html).toContain('已取消约会');
    expect(harness.messages[1].html).toContain('background:#c6c9cc');
    expect(harness.messages[1].html).toContain('text-decoration-line:line-through');
    expect(harness.messages[1].html).not.toContain('data-ghost-link=');

    const withoutSnapshot = createCalendarHarness(() => response(null, 204));
    await withoutSnapshot.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-delete-generic',
      args: { action: 'delete_event', event_id: 'evt-delete' },
    });
    expect(withoutSnapshot.messages[1].html).toContain(
      '日程已从 Google Calendar 删除。',
    );
    expect(withoutSnapshot.messages[1].html).not.toContain('这段时间没有日程');

    const partialSnapshot = createCalendarHarness(() => response(null, 204));
    await partialSnapshot.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-delete-partial',
      args: {
        action: 'delete_event',
        event_id: 'evt-delete',
        summary: '缺少时间的旧日程',
        location: '大宁',
      },
    });
    expect(partialSnapshot.messages[1].html).toContain(
      '日程已从 Google Calendar 删除。',
    );
    expect(partialSnapshot.messages[1].html).not.toContain('全天');
    expect(partialSnapshot.messages[1].html).not.toContain('缺少时间的旧日程');

    const invalidSnapshot = createCalendarHarness(() => response(null, 204));
    await invalidSnapshot.handler({
      type: 'tool-call',
      tool: 'google_calendar',
      callId: 'call-delete-invalid',
      args: {
        action: 'delete_event',
        event_id: 'evt-delete',
        summary: '时间格式错误的旧日程',
        start: '2026-02-31T20:00:00+08:00',
      },
    });
    expect(invalidSnapshot.messages[1].html).toContain(
      '日程已从 Google Calendar 删除。',
    );
    expect(invalidSnapshot.messages[1].html).not.toContain('2026-02-31');
    expect(invalidSnapshot.messages[1].html).not.toContain('时间格式错误的旧日程');

    const inconsistentRanges = [
      ['2026-07-25', '2026-07-26T20:00:00+08:00'],
      ['2026-07-25T20:00:00+08:00', '2026-07-26'],
      ['2026-07-25T21:00:00+08:00', '2026-07-25T20:00:00+08:00'],
    ];
    for (const [start, end] of inconsistentRanges) {
      const inconsistentSnapshot = createCalendarHarness(() => response(null, 204));
      await inconsistentSnapshot.handler({
        type: 'tool-call',
        tool: 'google_calendar',
        callId: 'call-delete-inconsistent',
        args: {
          action: 'delete_event',
          event_id: 'evt-delete',
          summary: '区间不一致的旧日程',
          start,
          end,
        },
      });
      expect(inconsistentSnapshot.messages[1].html).toContain(
        '日程已从 Google Calendar 删除。',
      );
      expect(inconsistentSnapshot.messages[1].html).not.toContain(
        '区间不一致的旧日程',
      );
    }
  });
});
