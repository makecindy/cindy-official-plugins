import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

function readPluginFile(filename: string) {
  return readFileSync(new URL(`../microsoft-outlook/${filename}`, import.meta.url), 'utf8');
}

function readManifest() {
  return JSON.parse(readPluginFile('ghost.json')) as {
    network: {
      hosts: string[];
      secrets: Array<{
        key: string;
        inject?: { hosts?: string[] };
        oauth?: {
          authorizeUrl?: string;
          tokenUrl?: string;
          clientId?: string;
          clientSecret?: string;
          scopes?: string[];
          pkce?: boolean;
          redirectPort?: number;
          identity?: { url?: string; labelPath?: string };
        };
      }>;
    };
    tools: Array<{
      name: string;
      parameters?: {
        properties?: {
          action?: { enum?: string[] };
        };
      };
    }>;
  };
}

function formatConnectError(error: string, detail: string) {
  const source = readPluginFile('settings.js');
  const match = source.match(
    /function connectError\(result\) \{([\s\S]*?)\n  \}\n  function render/,
  );
  if (!match) throw new Error('microsoft-outlook does not declare connectError');

  const context = createContext({
    input: { error, detail },
    output: '',
    String,
  });
  new Script(
    `function connectError(result) {${match[1]}\n  }\noutput = connectError(input);`,
    { filename: 'microsoft-outlook/settings.js' },
  ).runInContext(context);
  return context.output as string;
}

type CindyFetchRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  authAccount?: string;
};

async function runOutlookTool(
  args: Record<string, unknown>,
  response: { status: number; body: string },
) {
  const requests: CindyFetchRequest[] = [];
  let handler:
    | ((message: {
        type: string;
        tool: string;
        args: Record<string, unknown>;
        callId: string;
      }) => Promise<void>)
    | undefined;
  let toolResult: Record<string, unknown> | undefined;
  const context = createContext({
    cindy: {
      onHostMessage(
        nextHandler: (message: {
          type: string;
          tool: string;
          args: Record<string, unknown>;
          callId: string;
        }) => Promise<void>,
      ) {
        handler = nextHandler;
      },
      async fetch(request: CindyFetchRequest) {
        requests.push(request);
        return {
          ok: true,
          status: response.status,
          body: response.body,
        };
      },
      send(result: Record<string, unknown>) {
        toolResult = result;
      },
    },
    fetch: async () => {
      throw new Error('unexpected settings fetch');
    },
  });
  new Script(readPluginFile('main.js'), {
    filename: 'microsoft-outlook/main.js',
  }).runInContext(context);
  if (!handler) throw new Error('microsoft-outlook did not register a host message handler');

  await handler({
    type: 'tool-call',
    tool: 'outlook',
    args,
    callId: 'call-1',
  });
  return { requests, toolResult };
}

describe('Microsoft Outlook OAuth 配置', () => {
  it('使用 Filo Microsoft client、PKCE 和固定 loopback 回调', () => {
    const manifest = readManifest();
    const secret = manifest.network.secrets.find((item) => item.key === 'outlook_account');
    const oauth = secret?.oauth;

    expect(oauth?.clientId).toBe('93f8508e-04c6-4c69-b707-8f5cd45b17c5');
    expect(oauth?.clientSecret).toBeUndefined();
    expect(oauth?.pkce).toBe(true);
    expect(oauth?.redirectPort).toBe(53683);
    expect(oauth?.authorizeUrl).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(oauth?.tokenUrl).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    );
  });

  it('只向 Microsoft Graph 注入 OAuth token，并声明所需邮箱权限', () => {
    const manifest = readManifest();
    const secret = manifest.network.secrets.find((item) => item.key === 'outlook_account');
    const oauth = secret?.oauth;

    expect(manifest.network.hosts).toEqual(
      expect.arrayContaining(['login.microsoftonline.com', 'graph.microsoft.com']),
    );
    expect(secret?.inject?.hosts).toEqual(['graph.microsoft.com']);
    expect(oauth?.identity?.url).toContain('https://graph.microsoft.com/v1.0/me');
    expect(oauth?.identity?.labelPath).toBe('userPrincipalName');
    expect(oauth?.scopes).toEqual(
      expect.arrayContaining(['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send']),
    );
  });

  it('暴露与首版邮箱范围一致的动作', () => {
    const manifest = readManifest();
    const tool = manifest.tools.find((item) => item.name === 'outlook');

    expect(tool?.parameters?.properties?.action?.enum).toEqual([
      'search',
      'read',
      'send',
      'draft',
      'mark_read',
      'mark_unread',
      'move',
      'list_folders',
    ]);
  });

  it('设置页给出可行动的 Microsoft OAuth 错误', () => {
    const message = formatConnectError('EXCHANGE_FAILED', 'redirect_uri mismatch');
    expect(message).toContain('Microsoft token 交换失败');
    expect(message).toContain('Entra 应用的桌面回调配置');
    expect(message).toContain('redirect_uri mismatch');
  });

  it('search 调用 Microsoft Graph 并返回归一化邮件摘要', async () => {
    const { requests, toolResult } = await runOutlookTool(
      { action: 'search', query: 'invoice', max_results: 3, account: 'account-1' },
      {
        status: 200,
        body: JSON.stringify({
          value: [
            {
              id: 'message-1',
              conversationId: 'conversation-1',
              subject: 'Invoice',
              from: { emailAddress: { address: 'sender@example.com' } },
              toRecipients: [{ emailAddress: { address: 'me@example.com' } }],
              receivedDateTime: '2026-07-24T00:00:00Z',
              bodyPreview: 'Please review',
              isRead: false,
              hasAttachments: true,
              importance: 'high',
            },
          ],
        }),
      },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].authAccount).toBe('account-1');
    const url = new URL(requests[0].url);
    expect(url.origin).toBe('https://graph.microsoft.com');
    expect(url.pathname).toBe('/v1.0/me/messages');
    expect(url.searchParams.get('$search')).toBe('"invoice"');
    expect(url.searchParams.get('$top')).toBe('3');
    expect(toolResult).toMatchObject({
      type: 'tool-result',
      callId: 'call-1',
      ok: true,
      result: {
        messages: [
          {
            id: 'message-1',
            from: 'sender@example.com',
            subject: 'Invoice',
            is_read: false,
            has_attachments: true,
          },
        ],
      },
    });
  });

  it('send 只把用户明确提供的邮件提交到 Graph sendMail', async () => {
    const { requests, toolResult } = await runOutlookTool(
      {
        action: 'send',
        to: 'a@example.com, b@example.com',
        cc: 'copy@example.com',
        subject: 'Hello',
        body_text: 'Body',
      },
      { status: 202, body: '' },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://graph.microsoft.com/v1.0/me/sendMail',
      method: 'POST',
    });
    expect(JSON.parse(requests[0].body ?? '{}')).toEqual({
      message: {
        subject: 'Hello',
        body: { contentType: 'Text', content: 'Body' },
        toRecipients: [
          { emailAddress: { address: 'a@example.com' } },
          { emailAddress: { address: 'b@example.com' } },
        ],
        ccRecipients: [{ emailAddress: { address: 'copy@example.com' } }],
        bccRecipients: [],
      },
      saveToSentItems: true,
    });
    expect(toolResult).toMatchObject({
      type: 'tool-result',
      callId: 'call-1',
      ok: true,
      result: { sent: true },
    });
  });
});
