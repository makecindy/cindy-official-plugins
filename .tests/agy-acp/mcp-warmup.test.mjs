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

const TOKEN = 'Bearer task-secret';
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
async function bridgeServer(t, { delayMs = 0, hang = false, failTools = false, acceptStream = false, breakCall = false, hugeRefusal = false } = {}) {
  const sessions = new Map();
  const log = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (hang) return;
      setTimeout(() => {
        const sid = req.headers['mcp-session-id'];
        const message = body ? JSON.parse(body) : {};
        log.push({ method: req.method, rpc: message.method, sid, id: message.id });
        if (req.headers.authorization !== TOKEN) return res.writeHead(401).end();
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
        // Two pages: the first names the second with nextCursor.
        const result = message.method === 'tools/list' && message.params?.cursor === 'page-2'
          ? { tools: [{ name: 'Read', description: 'Read a file.', inputSchema: { type: 'object' } }] }
          : message.method === 'tools/list'
          ? { tools: [{ name: 'Bash', description: 'Run a command.', inputSchema: { type: 'object' } }], nextCursor: 'page-2' }
          : { content: [{ type: 'text', text: `${message.params.name} ran for ${sessions.get(sid)}` }] };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`);
      }, delayMs);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  server.unref();
  const entry = { type: 'http', name: 'cindy_exec', url: `http://127.0.0.1:${server.address().port}/mcp/cindy_exec`, headers: [{ name: 'Authorization', value: TOKEN }] };
  return { entry, log, sessions };
}

/** One request as agy sends it; the answer as agy reads it. */
async function agyRequest(url, { method = 'POST', message, sid, auth = TOKEN } = {}) {
  const headers = { authorization: auth, ...(sid ? { 'mcp-session-id': sid } : {}) };
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

  // Why: the relay holds answers fetched with Cindy's authorization for the server. A request without that
  // authorization must neither receive them nor use them up, and a request for another page must get that page.
  test('kept answers go only to the same authorization and the same request', async (t) => {
    const { entry, log, sessions } = await bridgeServer(t);
    const warmup = warmMcpServers([entry]);
    t.after(() => warmup.close());
    const [given] = await warmup.ready;
    const warmedSession = [...sessions.keys()][0];
    const warmed = log.length;

    const stranger = await agyRequest(given.url, { message: INITIALIZE, auth: 'Bearer someone-else' });
    assert.equal(stranger.status, 401, 'the server, not the relay, answered the wrong authorization');
    assert.equal(log.length, warmed + 1);
    assert.ok(sessions.has(warmedSession), 'the warmed session was not given up');

    const init = await agyRequest(given.url, { message: INITIALIZE });
    assert.equal(init.sid, warmedSession, 'the right authorization still gets the kept initialize answer');
    assert.equal(log.length, warmed + 1, 'without asking the server');

    const listMessage = { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} };
    const strangerList = await agyRequest(given.url, { message: listMessage, sid: init.sid, auth: 'Bearer someone-else' });
    assert.equal(strangerList.status, 401);

    const second = await agyRequest(given.url, { message: { jsonrpc: '2.0', id: 4, method: 'tools/list', params: { cursor: 'page-2' } }, sid: init.sid });
    assert.deepEqual(second.body.result.tools.map((tool) => tool.name), ['Read'], 'another page comes from the server');
    const before = log.length;
    const first = await agyRequest(given.url, { message: listMessage, sid: init.sid });
    assert.equal(first.body.id, 3);
    assert.deepEqual(first.body.result.tools.map((tool) => tool.name), ['Bash'], 'the kept first page was still there');
    assert.equal(first.body.result.nextCursor, 'page-2');
    assert.equal(log.length, before, 'the first page was not asked for again');
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
