'use strict';

/**
 * Warm MCP connections for a task whose files are on another computer.
 *
 * agy gives the MCP servers of a new session five seconds to connect (checked against agy
 * 1.5.17: "Failed to preload the session's MCP servers: context deadline exceeded"). A server
 * that is not ready by then is not declared to the model: the session starts without Cindy's
 * file and command tools, and the model reports them as missing. Each server takes five round
 * trips in a row (server/discover, initialize, notifications/initialized, GET, tools/list). In a
 * remote-workspace task every round trip crosses the device link to the computer the project is
 * on, so a link at about one second per round trip already misses the deadline.
 *
 * So the handshake is done before agy starts its clock. While the session process starts, this
 * module sends each server the same requests agy will send and keeps the answers. Cindy's
 * `session/new` is passed on once that is done (or after WARMUP_DEADLINE_MS). agy then talks to a
 * loopback relay that answers those first requests from the kept answers at once and passes
 * everything else, tools/call included, to the server unchanged on the same MCP session.
 *
 * It only ever falls back to what happens without it. A server that could not be warmed in time
 * is given to agy at its own address. A handshake request that differs from the one sent ahead
 * (another agy version, mismatched auth, or different params such as a tools/list cursor) goes
 * to the server as it is; mismatched auth never returns or consumes the cache. Only servers on
 * this computer's loopback address are warmed (Cindy's tunnel to the other computer is one), so
 * the plugin itself reaches nothing beyond this computer. The relay listens on 127.0.0.1 behind
 * a random path segment, holds no credential of its own (agy sends the headers Cindy gave it)
 * and forwards only to the address Cindy named.
 */

const crypto = require('node:crypto');
const http = require('node:http');

/** The longest `session/new` waits for the handshakes; Cindy waits 60 s for its answer. */
const WARMUP_DEADLINE_MS = 20_000;
/** What agy 1.5.17+ sends; a request that does not match is not answered from the warm-up. */
const CLIENT_INFO = Object.freeze({ name: 'antigravity-client', version: 'v1.0.0' });
const CLIENT_CAPABILITIES = Object.freeze({ elicitation: { form: {}, url: {} }, roots: { listChanged: true } });
const INITIALIZE_PROTOCOL = '2025-11-25';
const DISCOVER_PROTOCOL = '2026-07-28';
const META = 'io.modelcontextprotocol/';
/** The params of the handshake requests sent ahead; agy's must be the same to get the kept answer. */
const DISCOVER_PARAMS = Object.freeze({ _meta: {
  [`${META}clientCapabilities`]: CLIENT_CAPABILITIES, [`${META}clientInfo`]: CLIENT_INFO, [`${META}protocolVersion`]: DISCOVER_PROTOCOL,
} });
const INITIALIZE_PARAMS = Object.freeze({ clientInfo: CLIENT_INFO, protocolVersion: INITIALIZE_PROTOCOL, capabilities: CLIENT_CAPABILITIES });
const EMPTY_PARAMS = Object.freeze({});
const ACCEPT = 'application/json, text/event-stream';
/** Request headers that describe this hop only. */
const HOP_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'proxy-connection']);
/** Answers larger than this are not kept (a tools/list of a few hundred KB is the largest expected). */
const MAX_KEPT_BYTES = 8 * 1024 * 1024;

/** Cindy's tunnel listens on the loopback address; nothing else is warmed. */
function isLoopback(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' && (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]');
  } catch {
    return false;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Whether the incoming request carries the exact authorization/headers used during warm-up. */
function sameAuth(reqHeaders, expectedAuth) {
  for (const [key, value] of Object.entries(expectedAuth)) {
    if (!sameString(reqHeaders[key], value)) return false;
  }
  if (!Object.prototype.hasOwnProperty.call(expectedAuth, 'authorization') && reqHeaders.authorization !== undefined) {
    return false;
  }
  return true;
}

/** Reads a whole answer to keep it; one larger than MAX_KEPT_BYTES ends the request instead. */
function keepAnswer(request, response, resolve, reject) {
  const chunks = [];
  let size = 0;
  response.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_KEPT_BYTES) {
      request.destroy(new Error('answer too large to keep'));
      return;
    }
    chunks.push(chunk);
  });
  response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks) }));
  response.on('error', reject);
}

/** One HTTP exchange with a server; the whole answer is read (none of these answers streams). */
function exchange(url, { method = 'POST', headers = {}, body, signal }) {
  return new Promise((resolve, reject) => {
    const request = http.request(new URL(url), { method, headers, signal }, (response) => keepAnswer(request, response, resolve, reject));
    request.on('error', reject);
    request.end(body);
  });
}

/**
 * Opens the event stream only to learn whether the server turns it down (Cindy's tunnel answers
 * requests, not streams). Decided on the status line: an accepted stream is closed at once, not read.
 */
function streamRefusal(url, headers, signal) {
  return new Promise((resolve) => {
    const request = http.request(new URL(url), { method: 'GET', headers, signal }, (response) => {
      const status = response.statusCode || 0;
      if (status < 400) {
        request.destroy();
        resolve(null);
        return;
      }
      keepAnswer(request, response, resolve, () => resolve(null));
    });
    request.on('error', () => resolve(null));
    request.end();
  });
}

/** `headers` of an ACP MCP server entry as an HTTP header object. */
function serverHeaders(server) {
  const out = {};
  for (const header of Array.isArray(server.headers) ? server.headers : []) {
    if (isObject(header) && typeof header.name === 'string' && typeof header.value === 'string') out[header.name.toLowerCase()] = header.value;
  }
  return out;
}

/** The answer with the JSON-RPC id of the request it now answers (JSON or event-stream bodies). */
function withId(kept, id) {
  const type = String(kept.headers['content-type'] || '');
  const text = kept.body.toString('utf8');
  if (type.includes('application/json')) {
    const message = parseJson(text);
    return isObject(message) && 'id' in message ? Buffer.from(JSON.stringify({ ...message, id })) : kept.body;
  }
  if (type.includes('text/event-stream')) {
    return Buffer.from(text.split('\n').map((line) => {
      if (!line.startsWith('data:')) return line;
      const message = parseJson(line.slice(5).trim());
      return isObject(message) && 'id' in message && !('method' in message) ? `data: ${JSON.stringify({ ...message, id })}` : line;
    }).join('\n'));
  }
  return kept.body;
}

/** The first JSON-RPC response in an answer body. */
function firstResponse(kept) {
  const type = String(kept.headers['content-type'] || '');
  const text = kept.body.toString('utf8');
  const candidates = type.includes('text/event-stream')
    ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())
    : [text];
  for (const candidate of candidates) {
    const message = parseJson(candidate);
    if (isObject(message) && 'id' in message && !('method' in message)) return message;
  }
  return undefined;
}

/** JSON with object keys in a fixed order, so equal values compare equal. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Whether agy's request is exactly the one sent ahead (client, version and capabilities included). */
function sameParams(params, sent) {
  return canonical(params) === canonical(sent);
}

function sameEmptyParams(params) {
  return params === undefined || sameParams(params, EMPTY_PARAMS);
}

/**
 * Sends one server the handshake agy will send. Resolves with the kept answers, or null when the
 * server cannot be warmed (it is then given to agy at its own address). A session the server opened
 * for a handshake that did not finish is ended.
 */
async function warmServer(server, signal) {
  if (!isLoopback(server.url)) return null;
  const auth = serverHeaders(server);
  let sessionId = null;
  const post = (message, extra = {}) => exchange(server.url, {
    headers: { ...auth, accept: ACCEPT, 'content-type': 'application/json', ...extra },
    body: JSON.stringify(message),
    signal,
  });
  const handshake = async () => {
    const discover = post({ jsonrpc: '2.0', id: 'cindy-warm-discover', method: 'server/discover', params: DISCOVER_PARAMS },
      { 'mcp-method': 'server/discover', 'mcp-protocol-version': DISCOVER_PROTOCOL }).catch(() => null);
    const initialize = await post({ jsonrpc: '2.0', id: 'cindy-warm-initialize', method: 'initialize', params: INITIALIZE_PARAMS });
    if (typeof initialize.headers['mcp-session-id'] === 'string') sessionId = initialize.headers['mcp-session-id'];
    const result = firstResponse(initialize);
    if (initialize.status !== 200 || !sessionId || !isObject(result) || !isObject(result.result)) return null;
    const protocol = typeof result.result.protocolVersion === 'string' ? result.result.protocolVersion : INITIALIZE_PROTOCOL;
    const session = { ...auth, 'mcp-session-id': sessionId, 'mcp-protocol-version': protocol };
    const initialized = await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, session);
    if (initialized.status < 200 || initialized.status >= 300) return null;
    const [stream, tools] = await Promise.all([
      streamRefusal(server.url, { ...session, accept: 'text/event-stream' }, signal),
      post({ jsonrpc: '2.0', id: 'cindy-warm-tools', method: 'tools/list', params: {} }, session),
    ]);
    const listed = firstResponse(tools);
    if (tools.status !== 200 || !isObject(listed) || !isObject(listed.result)) return null;
    return { sessionId, discover: await discover, initialize, stream, tools };
  };
  const warm = await handshake().catch(() => null);
  if (!warm && sessionId) closeWarmSession(server, { sessionId });
  return warm;
}

/** Ends a warmed MCP session nobody will use. */
function closeWarmSession(server, warm) {
  exchange(server.url, { method: 'DELETE', headers: { ...serverHeaders(server), 'mcp-session-id': warm.sessionId } }).catch(() => {});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function reply(res, kept, body) {
  const headers = {};
  for (const name of ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'allow']) {
    if (kept.headers[name] !== undefined) headers[name] = kept.headers[name];
  }
  res.writeHead(kept.status, headers);
  res.end(body);
}

/** Passes one request to the server as it is and streams the answer back. */
function forward(req, res, server, body) {
  const target = new URL(server.url);
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) if (!HOP_HEADERS.has(name)) headers[name] = value;
  if (body.length) headers['content-length'] = String(body.length);
  const upstream = http.request(target, { method: req.method, headers }, (answer) => {
    const out = {};
    for (const [name, value] of Object.entries(answer.headers)) if (!HOP_HEADERS.has(name)) out[name] = value;
    res.writeHead(answer.statusCode || 502, out);
    answer.pipe(res);
    // The server dropped the connection mid-answer: agy must see it broken, as it would directly.
    answer.on('error', () => res.destroy());
    answer.on('close', () => {
      if (!answer.complete) res.destroy();
    });
  });
  upstream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502);
    res.end();
  });
  // agy gave up on the request (a cancelled tool call): the server hears it the same way.
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy();
  });
  upstream.end(body);
}

/**
 * Starts warming `servers` (the HTTP entries of `session/new`). `ready` resolves with the entries to
 * give agy: a warmed server at the relay, any other at its own address. `close` stops the relay.
 */
function warmMcpServers(servers, { deadlineMs = WARMUP_DEADLINE_MS, log = () => {} } = {}) {
  const token = crypto.randomBytes(24).toString('base64url');
  const abort = new AbortController();
  /** Per server: the kept answers not given yet, and whether agy left the warmed session. */
  const states = servers.map((server) => ({
    server,
    auth: serverHeaders(server),
    warm: null,
    live: false,
    pending: { discover: true, initialize: true, initialized: true, stream: true, tools: true },
  }));
  let closed = false;

  const relay = http.createServer((req, res) => {
    void (async () => {
      const match = /^\/([A-Za-z0-9_-]+)\/(\d+)$/.exec(req.url || '');
      const state = match && sameString(match[1], token) ? states[Number(match[2])] : undefined;
      if (!state || !state.warm) {
        res.writeHead(404);
        res.end();
        return;
      }
      const body = await readBody(req);
      const answer = state.live ? null : keptAnswer(state, req, body);
      if (answer) reply(res, answer.kept, answer.body);
      else forward(req, res, state.server, body);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  /** The kept answer for agy's request, or null to pass it on (and everything after it). */
  const keptAnswer = (state, req, body) => {
    // Mismatched authorization must neither receive nor consume any cached warm-up response.
    if (!sameAuth(req.headers, state.auth)) return null;
    const { warm, pending } = state;
    const sameSession = req.headers['mcp-session-id'] === warm.sessionId;
    const message = req.method === 'POST' ? parseJson(body.toString('utf8')) : undefined;
    const method = isObject(message) ? message.method : undefined;
    let key = null;
    // agy 1.5.17 opens the event stream without its session id; the server turned it down either way.
    if (req.method === 'GET' && (sameSession || !req.headers['mcp-session-id']) && pending.stream && warm.stream) key = 'stream';
    else if (method === 'server/discover' && !req.headers['mcp-session-id'] && pending.discover && warm.discover && sameParams(message.params, DISCOVER_PARAMS)) key = 'discover';
    else if (method === 'initialize' && pending.initialize && !req.headers['mcp-session-id'] && sameParams(message.params, INITIALIZE_PARAMS)) key = 'initialize';
    else if (method === 'notifications/initialized' && sameSession && pending.initialized && sameEmptyParams(message.params)) key = 'initialized';
    else if (method === 'tools/list' && sameSession && pending.tools && sameEmptyParams(message.params)) key = 'tools';
    if (key === 'initialized') {
      pending.initialized = false;
      return { kept: { status: 202, headers: {}, body: Buffer.alloc(0) }, body: undefined };
    }
    if (!key) {
      // agy opened an MCP session of its own (another agy version): the warmed one is not used, and
      // from here on the server sees agy's requests only.
      if (method === 'initialize') {
        if (pending.initialize) closeWarmSession(state.server, warm);
        state.live = true;
      }
      return null;
    }
    pending[key] = false;
    const kept = warm[key];
    return { kept, body: key === 'stream' ? kept.body : withId(kept, message.id) };
  };

  const ready = new Promise((resolve) => {
    relay.on('error', (error) => {
      log(`MCP warm-up is not available (${error.message}); the servers are given to Antigravity as they are.`);
      resolve(servers);
    });
    relay.listen(0, '127.0.0.1', () => {
      const { port } = relay.address();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const warmed = states.filter((state) => state.warm).length;
        if (warmed < states.length) log(`MCP warm-up finished for ${warmed} of ${states.length} servers; the others connect directly.`);
        if (warmed === 0 && relay.listening) relay.close();
        resolve(states.map((state, index) => (state.warm ? { ...state.server, url: `http://127.0.0.1:${port}/${token}/${index}` } : state.server)));
      };
      const timer = setTimeout(() => {
        abort.abort();
        finish();
      }, deadlineMs);
      Promise.all(states.map((state) => warmServer(state.server, abort.signal).then((warm) => {
        if (!warm) return;
        // A late warm-up after the deadline is not used: the server was already given at its own address.
        if (abort.signal.aborted || closed) closeWarmSession(state.server, warm);
        else state.warm = warm;
      }, () => {}))).then(finish);
    });
  });
  return {
    ready,
    close() {
      closed = true;
      abort.abort();
      if (relay.listening) relay.close();
    },
  };
}

module.exports = { WARMUP_DEADLINE_MS, warmMcpServers };
