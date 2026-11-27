// Run: node --test
//
// Why: agy gives a session's MCP servers five seconds to connect and leaves out any server that is
// late. In a task whose files are on another computer every handshake request crosses the device
// link, so on a slow link the session started without Cindy's file and command tools (checked with
// agy 1.5.17 against servers answering after 1.5 s: "Failed to preload the session's MCP servers",
// and the model answered that cindy_exec had no tools). mcp-warmup.js does the handshake before
// agy starts and answers agy's handshake locally. These cases use a server shaped like Cindy's
// bridge behind the tunnel (stateful sessions, event-stream answers, GET turned down, server/discover
// refused without a session) and check what agy would see, what reaches the server, and that every
// way it cannot help ends in the behaviour without it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const official = new URL(import.meta.url).searchParams.has('official');
const pluginId = official ? 'cindy-antigravity-acp' : 'agy-acp';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', pluginId);
const { warmMcpServers } = createRequire(import.meta.url)(path.join(root, 'mcp-warmup.js'));

const TOKEN = `Bearer ${crypto.randomUUID()}`;
// What agy 1.5.17 sends (captured from a real session).
const CLIENT_INFO = { name: 'antigravity-client', version: 'v1.0.0' };
const CAPABILITIES = { elicitation: { form: {}, url: {} }, roots: { listChanged: true } };
const DISCOVER = { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: {
  'io.modelcontextprotocol/clientCapabilities': CAPABILITIES,
  'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
} } };
const INITIALIZE = { jsonrpc: '2.0', id: 2, method: 'initialize', params: { clientInfo: CLIENT_INFO, protocolVersion: '2025-11-25', capabilities: CAPABILITIES } };

/** A server like Cindy's bridge behind the tunnel; `log` lists what reached it. */
async function bridgeServer(t, { delayMs = 0, hang = false, failTools = false, acceptStream = false, breakCall = false, hugeRefusal = false, paginate = false, failInitialize = false, failInitializeJsonRpc = false, initializeResponse = null, onRequest = null } = {}) {
  const sessions = new Map();
  const log = [];
  let activeToken = TOKEN;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (hang) return;
      const incoming = body ? JSON.parse(body) : {};
      onRequest?.({ method: req.method, rpc: incoming.method, sid: req.headers['mcp-session-id'], id: incoming.id });
      setTimeout(() => {
        if (res.destroyed) return;
        const sid = req.headers['mcp-session-id'];
        const message = incoming;
        log.push({ method: req.method, rpc: message.method, sid, id: message.id });
        if (req.headers.authorization !== activeToken) return res.writeHead(401).end();
        if (req.method === 'GET' && acceptStream) {
          // A server that keeps an event stream open and sends nothing on it.
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.flushHeaders();
          return;
        }
        if (req.method === 'GET' && hugeRefusal) return res.writeHead(405).end(Buffer.alloc(9 * 1024 * 1024, 0x61));
        if (req.method === 'GET') return res.writeHead(405, { allow: 'POST, DELETE' }).end();
        if (req.method === 'DELETE') {
          sessions.delete(sid);
          return res.writeHead(200).end();
        }
        if (!sid) {
          if (message.method !== 'initialize') return res.writeHead(400).end('Expected initialize request');
          if (initializeResponse) return initializeResponse(message, req, res, sessions);
          // A failing initialize that still echoes a session header belonging to another caller.
          if (failInitialize) {
            sessions.set('foreign-session', 'other');
            return res.writeHead(500, { 'mcp-session-id': 'foreign-session' }).end();
          }
          if (failInitializeJsonRpc) {
            sessions.set('foreign-jsonrpc-session', 'other');
            res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'foreign-jsonrpc-session' });
            return res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'rejected' } }));
          }
          const id = crypto.randomUUID();
          sessions.set(id, message.params.clientInfo.name);
          res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': id });
          return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id,
            result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'cindy_exec', version: '1' } } })}\n\n`);
        }
        if (!sessions.has(sid)) return res.writeHead(404).end();
        if (message.id === undefined) return res.writeHead(202).end();
        if (message.method === 'tools/list' && failTools) return res.writeHead(500).end();
        if (message.method === 'tools/call' && breakCall) {
          // The connection to the other computer drops after the answer has started.
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write(': started\n\n', () => setTimeout(() => res.socket.destroy(), 20));
          return;
        }
        let result;
        if (message.method === 'tools/list') {
          if (paginate && message.params?.cursor === 'p2') {
            result = { tools: [{ name: 'Read', description: 'Read a file.', inputSchema: { type: 'object' } }] };
          } else {
            result = {
              tools: [{ name: 'Bash', description: 'Run a command.', inputSchema: { type: 'object' } }],
              ...(paginate ? { nextCursor: 'p2' } : {}),
            };
          }
        } else {
          result = { content: [{ type: 'text', text: `${message.params.name} ran for ${sessions.get(sid)}` }] };
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`);
      }, delayMs);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  server.unref();
  const entry = { type: 'http', name: 'cindy_exec', url: `http://127.0.0.1:${server.address().port}/mcp/cindy_exec`, headers: [{ name: 'Authorization', value: TOKEN }] };
  return { entry, log, sessions, setToken: (next) => { activeToken = next; } };
}

/** One request as agy sends it; the answer as agy reads it. */
async function agyRequest(url, { method = 'POST', message, sid, authorization = TOKEN, extraHeaders = {} } = {}) {
  const headers = { ...(authorization ? { authorization } : {}), ...(sid ? { 'mcp-session-id': sid } : {}), ...extraHeaders };
  if (message) Object.assign(headers, { accept: 'application/json, text/event-stream', 'content-type': 'application/json' });
  const response = await fetch(url, { method, headers, body: message ? JSON.stringify(message) : undefined });
  const text = await response.text();
  const data = text.split('\n').find((line) => line.startsWith('data:'));
  return { status: response.status, sid: response.headers.get('mcp-session-id'), body: data ? JSON.parse(data.slice(5)) : text };
}

describe('Antigravity MCP warm-up', { concurrency: true, timeout: 20_000 }, () => {
  test('agy finds the handshake done and its tool calls reach the server on the same session', async (t) => {
    const { entry, log } = await bridgeServer(t, { delayMs: 200 });
    const warmup = warmMcpServers([entry]);
    t.after(() => warmup.close());
    const [given] = await warmup.ready;
    assert.match(given.url, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32}\/0$/, 'agy is given the relay');
    assert.deepEqual(given.headers, entry.headers, 'agy sends the headers Cindy gave it');
    const warmed = log.length;
    // Some are sent side by side, so only the set is fixed.
    assert.deepEqual(log.map((item) => item.rpc ?? item.method).sort(),
      ['GET', 'initialize', 'notifications/initialized', 'server/discover', 'tools/list'], 'the warm-up sent agy’s five handshake requests');

    // agy's handshake, in agy's order, with agy's own ids: answered at once, nothing reaches the server.
    const started = Date.now();
    const discover = await agyRequest(given.url, { message: DISCOVER });
    assert.equal(discover.status, 400);
    const init = await agyRequest(given.url, { message: INITIALIZE });
    assert.equal(init.status, 200);
    assert.equal(init.body.id, 2);
    assert.equal(init.body.result.protocolVersion, '2025-11-25');
    const sid = init.sid;
    assert.ok(sid, 'agy gets the warmed session');
    assert.equal((await agyRequest(given.url, { message: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sid })).status, 202);
    assert.equal((await agyRequest(given.url, { method: 'GET' })).status, 405, 'agy opens the event stream without its session id');
    const list = await agyRequest(given.url, { message: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, sid });
    assert.equal(list.body.id, 3);
    assert.deepEqual(list.body.result.tools.map((tool) => tool.name), ['Bash']);
    assert.ok(Date.now() - started < 200, 'the handshake does not wait for the server');
    assert.equal(log.length, warmed, 'no handshake request reached the server again');

    const call = await agyRequest(given.url, { message: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'Bash', arguments: { command: 'pwd' } } }, sid });
    assert.equal(call.body.id, 4);
    assert.equal(call.body.result.content[0].text, 'Bash ran for antigravity-client', 'the call runs on the session the server knows as agy’s');
    assert.deepEqual(log.at(-1), { method: 'POST', rpc: 'tools/call', sid, id: 4 });
  });

  // Why: the cached handshake and first tools/list page belong strictly to the credentials and
  // empty params used during warm-up. Wrong credentials or a paginated tools/list cursor must
  // forward upstream without leaking, consuming, or invalidating the warmed session.
  test('mismatched authorization and paginated tools/list bypass the cache without consuming or closing the warmed session', async (t) => {
    const { entry, log, sessions } = await bridgeServer(t, { delayMs: 20, paginate: true });
    const warmup = warmMcpServers([entry]);
    t.after(() => warmup.close());
    const [given] = await warmup.ready;
    const warmedSession = [...sessions.keys()][0];
    const wrongToken = `Bearer ${crypto.randomUUID()}`;

    // Unauthorized requests must fail at upstream (401) and leave the warmed session and cache intact.
    assert.equal((await agyRequest(given.url, { message: DISCOVER, authorization: '' })).status, 401);
    assert.equal((await agyRequest(given.url, { message: INITIALIZE, authorization: wrongToken })).status, 401);
    assert.equal((await agyRequest(given.url, { method: 'GET', authorization: wrongToken })).status, 401);
    assert.equal((await agyRequest(given.url, {
      message: { jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} },
      sid: warmedSession,
      authorization: wrongToken,
    })).status, 401);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(sessions.has(warmedSession), 'unauthorized initialize did not close the warmed session');

    // Legitimate agy handshake still hits the kept answers without reaching upstream again.
    const beforeAuth = log.length;
    assert.equal((await agyRequest(given.url, { message: DISCOVER })).status, 400);
    const init = await agyRequest(given.url, { message: INITIALIZE });
    assert.equal(init.status, 200);
    assert.equal(init.sid, warmedSession);
    assert.equal((await agyRequest(given.url, { message: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sid: init.sid })).status, 202);
    assert.equal((await agyRequest(given.url, { method: 'GET' })).status, 405);
    assert.equal(log.length, beforeAuth, 'authorized handshake still served from cache');

    // A paginated tools/list request bypasses upstream and does not consume page 1 from the cache.
    const page2Early = await agyRequest(given.url, {
      message: { jsonrpc: '2.0', id: 12, method: 'tools/list', params: { cursor: 'p2' } },
      sid: init.sid,
    });
    assert.equal(page2Early.status, 200);
    assert.deepEqual(page2Early.body.result.tools.map((tool) => tool.name), ['Read']);
    assert.equal(log.length, beforeAuth + 1, 'paginated tools/list went to upstream');

    // Unpaginated tools/list still hits the kept page-1 answer.
    const page1 = await agyRequest(given.url, {
      message: { jsonrpc: '2.0', id: 13, method: 'tools/list', params: {} },
      sid: init.sid,
    });
    assert.equal(page1.status, 200);
    assert.equal(page1.body.id, 13);
    assert.deepEqual(page1.body.result.tools.map((tool) => tool.name), ['Bash']);
    assert.equal(page1.body.result.nextCursor, 'p2');
    assert.equal(log.length, beforeAuth + 1, 'unpaginated tools/list served from cache');

    // Subsequent paginated tools/list still reaches upstream on the same warmed session.
    const page2Followup = await agyRequest(given.url, {
      message: { jsonrpc: '2.0', id: 14, method: 'tools/list', params: { cursor: 'p2' } },
      sid: init.sid,
    });
    assert.equal(page2Followup.status, 200);
    assert.deepEqual(page2Followup.body.result.tools.map((tool) => tool.name), ['Read']);
    assert.equal(log.length, beforeAuth + 2);
  });

  test('close ends unhanded warmed sessions exactly once and leaves handed-off sessions untouched', async (t) => {
    // 1. Unhanded session (e.g., restricted agy failed initialize or session open): close() sends DELETE once.
    const unhanded = await bridgeServer(t);
    const w1 = warmMcpServers([unhanded.entry]);
    await w1.ready;
    const unhandedSid = [...unhanded.sessions.keys()][0];
    assert.ok(unhandedSid, 'warm-up created an upstream session');
    await w1.close();
    await w1.close();
    const unhandedDeletes = unhanded.log.filter((item) => item.method === 'DELETE' && item.sid === unhandedSid);
    assert.equal(unhandedDeletes.length, 1, 'unhanded warmed session was deleted exactly once');
    assert.equal(unhanded.sessions.size, 0, 'no unhanded session remains on upstream');

    // 2. Handed-off session (agy consumed warmed initialize): close() never sends DELETE for it.
    const handed = await bridgeServer(t);
    const w2 = warmMcpServers([handed.entry]);
    const [given] = await w2.ready;
    const init = await agyRequest(given.url, { message: INITIALIZE });
    assert.equal(init.status, 200);
    await w2.close();
    await w2.close();
    const handedDeletes = handed.log.filter((item) => item.method === 'DELETE');
    assert.equal(handedDeletes.length, 0, 'handed-off session is owned by agy and untouched by close()');
    assert.ok(handed.sessions.has(init.sid), 'handed-off session stays active on upstream');

    // 3. Mismatched initialize already closed the warmed session: subsequent close() does not DELETE a second time.
    const mismatched = await bridgeServer(t);
    const w3 = warmMcpServers([mismatched.entry]);
    const [given3] = await w3.ready;
    const mismatchedSid = [...mismatched.sessions.keys()][0];
    const other = { ...INITIALIZE, params: { ...INITIALIZE.params, capabilities: { roots: { listChanged: true } } } };
    await agyRequest(given3.url, { message: other });
    await w3.close();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const mismatchedDeletes = mismatched.log.filter((item) => item.method === 'DELETE' && item.sid === mismatchedSid);
    assert.equal(mismatchedDeletes.length, 1, 'mismatched warmed session was deleted only once across mismatch + close()');
  });

  // Why: only a session confirmed created by a valid HTTP 200 JSON-RPC 2.0 initialize result belongs to
  // this warm-up; HTTP errors, JSON-RPC errors, and malformed/invalid responses must never trigger DELETE
  // and must fall back to connecting agy directly.
  test('failed or malformed initialize responses never close another session and fall back to direct connection', async (t) => {
    const cases = [
      {
        name: 'HTTP 500 with foreign session header',
        sid: 'foreign-http-500',
        respond: (_message, _req, res) => res.writeHead(500, { 'mcp-session-id': 'foreign-http-500' }).end(),
      },
      {
        name: 'JSON-RPC error with foreign session header',
        sid: 'foreign-jsonrpc-error',
        respond: (message, _req, res) => {
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'foreign-jsonrpc-error' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'rejected' } }));
        },
      },
      {
        name: 'malformed JSON body with foreign session header',
        sid: 'foreign-malformed-json',
        respond: (_message, _req, res) => {
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'foreign-malformed-json' });
          res.end('{"jsonrpc":"2.0","result":');
        },
      },
      {
        name: 'missing jsonrpc 2.0 field',
        sid: 'foreign-no-jsonrpc',
        respond: (message, _req, res) => {
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'foreign-no-jsonrpc' });
          res.end(JSON.stringify({ id: message.id, result: { protocolVersion: '2025-11-25' } }));
        },
      },
      {
        name: 'mismatched JSON-RPC response id',
        sid: 'foreign-wrong-id',
        respond: (_message, _req, res) => {
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'foreign-wrong-id' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 'other-request', result: { protocolVersion: '2025-11-25' } }));
        },
      },
      {
        name: 'both result and error in JSON-RPC payload',
        sid: 'foreign-both-result-error',
        respond: (message, _req, res) => {
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'foreign-both-result-error' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {}, error: { code: -32000, message: 'ambiguous' } }));
        },
      },
      {
        name: 'non-MCP text/plain response carrying JSON',
        sid: 'foreign-text-plain',
        respond: (message, _req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain', 'mcp-session-id': 'foreign-text-plain' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-11-25' } }));
        },
      },
      {
        name: 'malformed SSE payload with foreign session header',
        sid: 'foreign-bad-sse',
        respond: (_message, _req, res) => {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'foreign-bad-sse' });
          res.end('event: message\ndata: not-json\n\n');
        },
      },
    ];
    for (const item of cases) {
      const server = await bridgeServer(t, {
        initializeResponse: (message, req, res, sessions) => {
          sessions.set(item.sid, 'other');
          item.respond(message, req, res);
        },
      });
      const warmup = warmMcpServers([server.entry]);
      assert.deepEqual(await warmup.ready, [server.entry], `${item.name}: agy connects directly`);
      await warmup.close();
      assert.ok(server.sessions.has(item.sid), `${item.name}: foreign session stays untouched`);
      assert.equal(server.log.some((entry) => entry.method === 'DELETE'), false, `${item.name}: no DELETE sent`);
    }

    // Even if close() arrives while a delayed invalid initialize is still in flight, no DELETE is sent.
    let resolveReceived;
    const initReceived = new Promise((resolve) => { resolveReceived = resolve; });
    const delayedBad = await bridgeServer(t, {
      delayMs: 150,
      onRequest: (item) => { if (item.rpc === 'initialize') resolveReceived(); },
      initializeResponse: (_message, _req, res, sessions) => {
        sessions.set('foreign-delayed-invalid', 'other');
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'foreign-delayed-invalid' });
        res.end('{broken');
      },
    });
    const warmup = warmMcpServers([delayedBad.entry]);
    await initReceived;
    await warmup.close();
    assert.deepEqual(await warmup.ready, [delayedBad.entry], 'cancelled invalid initialize falls back to direct');
    assert.ok(delayedBad.sessions.has('foreign-delayed-invalid'), 'delayed invalid initialize leaves foreign session untouched');
    assert.equal(delayedBad.log.some((entry) => entry.method === 'DELETE'), false, 'no DELETE for delayed invalid initialize');
  });

  // Why: close() can arrive before the loopback relay finishes listening; no handshake may start afterwards.
  test('closing before the relay is listening starts no handshake', async (t) => {
    const { entry, log } = await bridgeServer(t);
    const warmup = warmMcpServers([entry]);
    const closing = warmup.close();
    assert.deepEqual(await warmup.ready, [entry], 'agy connects directly');
    await closing;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(log.length, 0, 'no handshake request reached the server');
  });

  // Why: if close() fires after initialize was already sent to upstream but before its reply arrives,
  // warm-up must keep waiting within INITIALIZE_GRACE_MS to confirm ownership and DELETE the created session.
  test('closing while initialize is in flight before its reply arrives still confirms and deletes the created session', async (t) => {
    let resolveReceived;
    const initReceived = new Promise((resolve) => { resolveReceived = resolve; });
    const { entry, log, sessions } = await bridgeServer(t, {
      delayMs: 300,
      onRequest: (item) => { if (item.rpc === 'initialize') resolveReceived(); },
    });
    const warmup = warmMcpServers([entry]);
    await initReceived;
    assert.equal(sessions.size, 0, 'server has not replied to initialize yet when close() fires');
    await warmup.close();
    assert.deepEqual(await warmup.ready, [entry], 'agy connects directly after close');
    assert.equal(sessions.size, 0, 'session created by in-flight initialize was deleted before close() resolved');
    assert.equal(log.filter((item) => item.rpc === 'initialize').length, 1);
    assert.equal(log.filter((item) => item.rpc === 'notifications/initialized').length, 0, 'did not continue handshake after close');
    assert.equal(log.filter((item) => item.rpc === 'tools/list').length, 0, 'did not call tools/list after close');
    assert.equal(log.filter((item) => item.method === 'DELETE').length, 1, 'confirmed session was deleted once');
  });

  // Why: if close() fires while warmServer already confirmed initialize and is still awaiting tools/list,
  // close() must wait for the interrupted handshake to DELETE its opened upstream session before resolving.
  test('closing while warm-up is still in flight deletes the opened session before close() resolves', async (t) => {
    const { entry, log, sessions } = await bridgeServer(t, { delayMs: 120 });
    const warmup = warmMcpServers([entry]);
    // Wait until notifications/initialized reaches the server, proving warmServer already received and
    // confirmed initialize's 200 JSON-RPC result and is now in flight on notifications/initialized / tools/list.
    const deadline = Date.now() + 4_000;
    while (!log.some((item) => item.rpc === 'notifications/initialized') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    assert.equal(sessions.size, 1, 'initialize opened a session before close()');
    const openedSid = [...sessions.keys()][0];
    await warmup.close();
    assert.equal(sessions.size, 0, 'interrupted handshake session was already deleted before close() resolved');
    assert.equal(log.filter((item) => item.method === 'DELETE' && item.sid === openedSid).length, 1);
  });

  // Why: the loopback relay must enforce the upstream server's auth boundary — rejecting non-loopback hosts,
  // cross-origin browser requests, guessed paths, extra credential headers, and revoking remaining cached answers
  // once upstream rejects the warmed credentials (e.g., auth rotation/revocation).
  test('relay enforces host/origin/token boundaries and respects upstream authentication changes', async (t) => {
    const { entry, log, setToken } = await bridgeServer(t, { paginate: true });
    const warmup = warmMcpServers([entry]);
    t.after(() => warmup.close());
    const [given] = await warmup.ready;
    const url = new URL(given.url);
    const rawSend = (pathName, headers) => new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port: url.port, path: pathName, method: 'POST', headers },
        (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      request.on('error', reject);
      request.end(JSON.stringify(INITIALIZE));
    });
    const baseHeaders = {
      host: url.host,
      authorization: TOKEN,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    const beforeBoundary = log.length;
    assert.equal(await rawSend(url.pathname, { ...baseHeaders, host: `evil.example.test:${url.port}` }), 421);
    assert.equal(await rawSend(url.pathname, { ...baseHeaders, host: '127.0.0.1:9' }), 421);
    assert.equal(await rawSend(url.pathname, { ...baseHeaders, origin: 'https://evil.example.test' }), 403);
    assert.equal(await rawSend(url.pathname.replace(/\/[^/]+\/0$/, '/not-the-token/0'), baseHeaders), 404);
    assert.equal(log.length, beforeBoundary, 'boundary rejections never reached upstream');

    // Extra credential header alongside matching Authorization bypasses the cache to upstream.
    const extraCred = await agyRequest(given.url, {
      message: INITIALIZE,
      extraHeaders: { 'x-api-key': crypto.randomUUID() },
    });
    assert.equal(extraCred.status, 200);
    assert.equal(log.length, beforeBoundary + 1, 'request with extra credential header bypassed cache to upstream');

    // Legitimate initialize still hits the warmed session (previous bypass did not consume cache).
    const init = await agyRequest(given.url, { message: INITIALIZE });
    assert.equal(init.status, 200);
    assert.equal(log.length, beforeBoundary + 1, 'warmed initialize still served from cache');

    // Upstream rotates/revokes the warm-up token: a forwarded same-auth request gets 401 and invalidates
    // remaining cached answers so subsequent tools/list also sees 401 instead of stale cached tools.
    const rotatedToken = `Bearer ${crypto.randomUUID()}`;
    setToken(rotatedToken);
    const revokedPage2 = await agyRequest(given.url, {
      message: { jsonrpc: '2.0', id: 20, method: 'tools/list', params: { cursor: 'p2' } },
      sid: init.sid,
    });
    assert.equal(revokedPage2.status, 401);
    const staleTools = await agyRequest(given.url, {
      message: { jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} },
      sid: init.sid,
    });
    assert.equal(staleTools.status, 401, 'revoked warm-up credentials no longer receive stale cached tools/list');
    // The new token still works directly through the relay.
    const newAuthTools = await agyRequest(given.url, {
      message: { jsonrpc: '2.0', id: 22, method: 'tools/list', params: {} },
      sid: init.sid,
      authorization: rotatedToken,
    });
    assert.equal(newAuthTools.status, 200);
    assert.deepEqual(newAuthTools.body.result.tools.map((tool) => tool.name), ['Bash']);
  });

  // Only the client's capabilities differ: the server may answer such a client differently.
  test('a handshake that differs from the warm-up goes to the server, and the warmed session is closed', async (t) => {
    const { entry, log, sessions } = await bridgeServer(t);
    const warmup = warmMcpServers([entry]);
    t.after(() => warmup.close());
    const [given] = await warmup.ready;
    const warmedSession = [...sessions.keys()][0];
    const other = { ...INITIALIZE, params: { ...INITIALIZE.params, capabilities: { roots: { listChanged: true } } } };
    const init = await agyRequest(given.url, { message: other });
    assert.notEqual(init.sid, warmedSession);
    const list = await agyRequest(given.url, { message: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, sid: init.sid });
    assert.deepEqual(list.body.result.tools.map((tool) => tool.name), ['Bash']);
    assert.deepEqual(log.slice(-1)[0], { method: 'POST', rpc: 'tools/list', sid: init.sid, id: 3 }, 'tools/list was not answered from the warm-up');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(!sessions.has(warmedSession), 'the unused warmed session was ended');
  });

  test('a handshake that fails after the server opened a session ends that session', async (t) => {
    const { entry, log, sessions } = await bridgeServer(t, { failTools: true });
    const warmup = warmMcpServers([entry]);
    t.after(() => warmup.close());
    assert.deepEqual(await warmup.ready, [entry], 'agy connects directly');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sessions.size, 0, 'no session is left open on the other computer');
    assert.equal(log.at(-1).method, 'DELETE');
  });

  test('a server that keeps the event stream open does not hold up the task', async (t) => {
    const { entry } = await bridgeServer(t, { acceptStream: true });
    const warmup = warmMcpServers([entry], { deadlineMs: 5_000 });
    t.after(() => warmup.close());
    const started = Date.now();
    const [given] = await warmup.ready;
    assert.ok(Date.now() - started < 1_000, 'the warm-up does not wait for the stream to end');
    assert.notDeepEqual(given, entry, 'the handshake was still warmed');
    // Forwarded idle SSE streams must flush their 200 response headers immediately without waiting for events.
    const controller = new AbortController();
    t.after(() => controller.abort());
    const response = await Promise.race([
      fetch(given.url, { headers: { authorization: TOKEN, accept: 'text/event-stream' }, signal: controller.signal }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('idle SSE headers did not flush in time')), 2_000)),
    ]);
    assert.equal(response.status, 200);
    controller.abort();
  });

  // Why: the refusal is read to replay it; an abnormal server must not make this process keep megabytes.
  test('an oversized event-stream refusal is not kept, and agy gets the server’s own answer', async (t) => {
    const { entry, log } = await bridgeServer(t, { hugeRefusal: true });
    const warmup = warmMcpServers([entry]);
    t.after(() => warmup.close());
    const [given] = await warmup.ready;
    assert.notDeepEqual(given, entry, 'the rest of the handshake was still warmed');
    const before = log.length;
    const stream = await agyRequest(given.url, { method: 'GET' });
    assert.equal(stream.status, 405);
    assert.equal(log.length, before + 1, 'the event stream request went to the server');
  });

  test('a tool call whose connection drops is reported to agy as broken', async (t) => {
    const { entry } = await bridgeServer(t, { breakCall: true });
    const warmup = warmMcpServers([entry]);
    t.after(() => warmup.close());
    const [given] = await warmup.ready;
    const init = await agyRequest(given.url, { message: INITIALIZE });
    const response = await fetch(given.url, { method: 'POST', headers: { authorization: TOKEN, 'mcp-session-id': init.sid,
      accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'Bash', arguments: {} } }) });
    await assert.rejects(Promise.race([response.text(), new Promise((resolve) => setTimeout(() => resolve('still waiting'), 3_000))]),
      'the answer ends in an error instead of hanging');
  });

  test('a server that is not warmed in time, or not on this computer, is given to agy at its own address', async (t) => {
    const { entry, log } = await bridgeServer(t, { hang: true });
    const unreachable = { ...entry, name: 'cindy', url: 'http://127.0.0.1:9/mcp/cindy' };
    // Only Cindy's loopback tunnel is warmed; the plugin itself never reaches another host.
    const elsewhere = { ...entry, name: 'custom', url: 'https://mcp.example.test/mcp' };
    const warmup = warmMcpServers([entry, unreachable, elsewhere], { deadlineMs: 300 });
    t.after(() => warmup.close());
    const started = Date.now();
    assert.deepEqual(await warmup.ready, [entry, unreachable, elsewhere]);
    assert.ok(Date.now() - started < 2_000, 'session/new is held no longer than the deadline');
    assert.equal(log.length, 0, 'the hanging server never answered');
  });
});
