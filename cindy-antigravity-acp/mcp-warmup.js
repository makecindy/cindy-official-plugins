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
/** After the deadline or close(), how long an initialize already sent may still take to confirm its session. */
const INITIALIZE_GRACE_MS = 3_000;
/** How long one DELETE of a confirmed warmed session may take. */
const DELETE_TIMEOUT_MS = 2_000;
/**
 * The longest close() takes: a late initialize confirming ownership, then the DELETE of the session it named.
 * Anything still open after this budget is ended by Cindy on the task's computer when the remote run ends.
 */
const CLOSE_BUDGET_MS = INITIALIZE_GRACE_MS + DELETE_TIMEOUT_MS + 250;
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
/** Standard transport and MCP headers a legitimate agy client may send alongside `server.headers`. */
const ALLOWED_EXTRA_HEADERS = new Set([
  'host', 'user-agent', 'accept', 'accept-encoding', 'accept-language',
  'content-type', 'content-length', 'transfer-encoding', 'connection', 'keep-alive',
  'te', 'expect', 'cache-control', 'pragma', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest',
  'mcp-session-id', 'mcp-protocol-version', 'mcp-method',
]);
/** The Host header of a request agy sends to the loopback relay. */
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/i;
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

/** Whether the incoming request matches the exact warm-up auth/custom headers with no extra credential headers. */
function sameAuth(reqHeaders, expectedAuth) {
  for (const [key, value] of Object.entries(expectedAuth)) {
    if (!sameString(reqHeaders[key], value)) return false;
  }
  for (const key of Object.keys(reqHeaders)) {
    if (!Object.prototype.hasOwnProperty.call(expectedAuth, key) && !ALLOWED_EXTRA_HEADERS.has(key)) {
      return false;
    }
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
      // Never cache accepted streams, auth errors (401/403), or server errors (5xx).
      if (status < 400 || status === 401 || status === 403 || status >= 500) {
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

/** `headers` of an ACP MCP server entry as an HTTP header object (excluding hop-by-hop headers). */
function serverHeaders(server) {
  const out = {};
  for (const header of Array.isArray(server.headers) ? server.headers : []) {
    if (isObject(header) && typeof header.name === 'string' && typeof header.value === 'string') {
      const key = header.name.toLowerCase();
      if (!HOP_HEADERS.has(key)) out[key] = header.value;
    }
  }
  return out;
}

function mediaTypeOf(headers) {
  return String(headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
}

/** The answer with the JSON-RPC id of the request it now answers (JSON or event-stream bodies). */
function withId(kept, id) {
  const mediaType = mediaTypeOf(kept.headers);
  const text = kept.body.toString('utf8');
  if (mediaType === 'application/json') {
    const message = parseJson(text);
    return isObject(message) && 'id' in message ? Buffer.from(JSON.stringify({ ...message, id })) : kept.body;
  }
  if (mediaType === 'text/event-stream') {
    return Buffer.from(text.split(/\r?\n/).map((line) => {
      if (!line.startsWith('data:')) return line;
      const message = parseJson(line.slice(5).trim());
      return isObject(message) && 'id' in message && !('method' in message) ? `data: ${JSON.stringify({ ...message, id })}` : line;
    }).join('\n'));
  }
  return kept.body;
}

/** The first JSON-RPC response in a valid JSON or SSE answer body. */
function firstResponse(kept) {
  const mediaType = mediaTypeOf(kept.headers);
  const text = kept.body.toString('utf8');
  if (mediaType === 'application/json') {
    const message = parseJson(text);
    return isObject(message) && 'id' in message && !('method' in message) ? message : undefined;
  }
  if (mediaType === 'text/event-stream') {
    for (const rawEvent of text.split(/\r?\n\r?\n/)) {
      const dataLines = rawEvent.split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''));
      if (!dataLines.length) continue;
      const message = parseJson(dataLines.join('\n').trim());
      if (isObject(message) && 'id' in message && !('method' in message)) return message;
    }
  }
  return undefined;
}

/** Only a valid JSON-RPC 2.0 success response matching `expectedId` with an object result and no error. */
function isJsonRpcResult(message, expectedId) {
  return isObject(message)
    && message.jsonrpc === '2.0'
    && message.id === expectedId
    && !('method' in message)
    && !('error' in message)
    && isObject(message.result);
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
async function warmServer(server, signal, closing, initializeSignal) {
  if (!isLoopback(server.url)) return null;
  const auth = serverHeaders(server);
  /** Set only once the server confirmed creating this session for our initialize; only it may be ended here. */
  let sessionId = null;
  const post = (message, extra = {}, requestSignal = signal) => exchange(server.url, {
    headers: { ...auth, accept: ACCEPT, 'content-type': 'application/json', ...extra },
    body: JSON.stringify(message),
    signal: requestSignal,
  });
  const handshake = async () => {
    const discover = post({ jsonrpc: '2.0', id: 'cindy-warm-discover', method: 'server/discover', params: DISCOVER_PARAMS },
      { 'mcp-method': 'server/discover', 'mcp-protocol-version': DISCOVER_PROTOCOL }).catch(() => null);
    // An initialize already sent is bounded by `initializeSignal` so close()/deadline lets upstream confirm
    // ownership and immediately DELETE the created session instead of abandoning it on the remote host.
    const initialize = await post({ jsonrpc: '2.0', id: 'cindy-warm-initialize', method: 'initialize', params: INITIALIZE_PARAMS },
      {}, initializeSignal);
    const result = firstResponse(initialize);
    const created = initialize.headers['mcp-session-id'];
    // Only a confirmed HTTP 200 JSON-RPC 2.0 success response proves ownership; failed or malformed
    // responses leave sessionId unset so nothing is ended for them and agy connects directly.
    if (initialize.status !== 200 || typeof created !== 'string' || !created.trim()
      || !isJsonRpcResult(result, 'cindy-warm-initialize')) return null;
    sessionId = created;
    // Deadline or close() already fired while initialize was in flight: skip the rest and DELETE now.
    if (signal.aborted) return null;
    const protocol = typeof result.result.protocolVersion === 'string' ? result.result.protocolVersion : INITIALIZE_PROTOCOL;
    const session = { ...auth, 'mcp-session-id': sessionId, 'mcp-protocol-version': protocol };
    const initialized = await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, session);
    if (initialized.status < 200 || initialized.status >= 300) return null;
    const [stream, tools] = await Promise.all([
      streamRefusal(server.url, { ...session, accept: 'text/event-stream' }, signal),
      post({ jsonrpc: '2.0', id: 'cindy-warm-tools', method: 'tools/list', params: {} }, session),
    ]);
    const listed = firstResponse(tools);
    if (tools.status !== 200 || !isJsonRpcResult(listed, 'cindy-warm-tools')) return null;
    const discoverRes = await discover;
    const keptDiscover = discoverRes && discoverRes.status !== 401 && discoverRes.status !== 403 && discoverRes.status < 500
      ? discoverRes : null;
    return { sessionId, discover: keptDiscover, initialize, stream, tools };
  };
  const warm = await handshake().catch(() => null);
  if (!warm && sessionId) closeWarmSession(server, { sessionId }, closing);
  return warm;
}

/** Ends a warmed MCP session nobody will use; `closing` tracks DELETEs still in flight. */
function closeWarmSession(server, warm, closing) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), DELETE_TIMEOUT_MS);
  timer.unref();
  const done = exchange(server.url, {
    method: 'DELETE',
    headers: { ...serverHeaders(server), 'mcp-session-id': warm.sessionId },
    signal: abort.signal,
  })
    .catch(() => {})
    .finally(() => {
      clearTimeout(timer);
      closing?.delete(done);
    });
  closing?.add(done);
  return done;
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
function forward(req, res, state, body) {
  const target = new URL(state.server.url);
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) if (!HOP_HEADERS.has(name)) headers[name] = value;
  if (body.length) headers['content-length'] = String(body.length);
  const upstream = http.request(target, { method: req.method, headers }, (answer) => {
    // If upstream now rejects the warm-up credentials, invalidate any remaining kept answers.
    if ((answer.statusCode === 401 || answer.statusCode === 403) && sameAuth(req.headers, state.auth)) {
      state.live = true;
    }
    const out = {};
    for (const [name, value] of Object.entries(answer.headers)) if (!HOP_HEADERS.has(name)) out[name] = value;
    res.writeHead(answer.statusCode || 502, out);
    // An event stream may stay quiet for a while; agy must see it open as soon as the server does.
    res.flushHeaders();
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
 * give agy: a warmed server at the relay, any other at its own address. `close` stops the relay
 * and resolves once every unhanded warmed session (including any interrupted handshake) is deleted.
 */
function warmMcpServers(servers, { deadlineMs = WARMUP_DEADLINE_MS, log = () => {} } = {}) {
  const token = crypto.randomBytes(24).toString('base64url');
  const abort = new AbortController();
  /** Bounds initialize requests already sent: aborted INITIALIZE_GRACE_MS after deadline or close(). */
  const initializeAbort = new AbortController();
  let initializeGraceTimer = null;
  let deadlineTimer = null;
  let finishWarmup = null;
  let closePromise = null;
  const armInitializeGrace = () => {
    if (initializeGraceTimer || initializeAbort.signal.aborted) return;
    initializeGraceTimer = setTimeout(() => initializeAbort.abort(), INITIALIZE_GRACE_MS);
    initializeGraceTimer.unref();
  };
  /** Per server: kept answers, whether warm-up still owns the upstream session, and whether agy left it. */
  const states = servers.map((server) => ({
    server,
    auth: serverHeaders(server),
    warm: null,
    owned: false,
    live: false,
    pending: { discover: true, initialize: true, initialized: true, stream: true, tools: true },
  }));
  let closed = false;
  let relayPort = 0;
  let warming = Promise.resolve();
  /** DELETEs of warmed sessions still in flight; close() waits for them within CLOSE_BUDGET_MS. */
  const closing = new Set();

  /** Ends a warmed upstream session that warm-up still owns (never handed to agy), at most once. */
  const releaseOwned = (state) => {
    if (!state.owned || !state.warm) return null;
    state.owned = false;
    return closeWarmSession(state.server, state.warm, closing);
  };

  const relay = http.createServer((req, res) => {
    void (async () => {
      // Only local non-browser agy requests to this exact loopback listener may reach the relay.
      const hostMatch = LOOPBACK_HOST.exec(String(req.headers.host || ''));
      if (!hostMatch || (hostMatch[2] && Number(hostMatch[2]) !== relayPort)) {
        res.writeHead(421);
        res.end();
        return;
      }
      if (req.headers.origin !== undefined) {
        res.writeHead(403);
        res.end();
        return;
      }
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
      else forward(req, res, state, body);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  /** The kept answer for agy's request, or null to pass it on (and everything after it). */
  const keptAnswer = (state, req, body) => {
    // Mismatched authorization or unexpected credential headers must neither receive nor consume any cached answer.
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
        releaseOwned(state);
        state.live = true;
      }
      return null;
    }
    if (key === 'initialize') state.owned = false;
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
      relayPort = port;
      if (closed) {
        if (relay.listening) relay.close();
        resolve(servers);
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(deadlineTimer);
        const warmed = closed ? 0 : states.filter((state) => state.warm).length;
        if (warmed < states.length) log(`MCP warm-up finished for ${warmed} of ${states.length} servers; the others connect directly.`);
        if (warmed === 0 && relay.listening) relay.close();
        resolve(states.map((state, index) => (!closed && state.warm ? { ...state.server, url: `http://127.0.0.1:${port}/${token}/${index}` } : state.server)));
      };
      finishWarmup = finish;
      deadlineTimer = setTimeout(() => {
        abort.abort();
        armInitializeGrace();
        finish();
      }, deadlineMs);
      warming = Promise.all(states.map((state) => warmServer(state.server, abort.signal, closing, initializeAbort.signal).then((warm) => {
        if (!warm) return;
        // A late warm-up after the deadline or close is not used: the server was already given at its own address.
        if (abort.signal.aborted || closed) closeWarmSession(state.server, warm, closing);
        else {
          state.warm = warm;
          state.owned = true;
        }
      }, () => {}))).finally(() => {
        clearTimeout(initializeGraceTimer);
      });
      warming.then(finish);
    });
  });
  return {
    ready,
    close() {
      if (!closed) {
        closed = true;
        clearTimeout(deadlineTimer);
        abort.abort();
        armInitializeGrace();
        finishWarmup?.();
        if (relay.listening) relay.close();
        for (const state of states) releaseOwned(state);
      }
      if (!closePromise) {
        let budgetTimer = null;
        const reclaimed = warming
          .then(() => Promise.all([...closing]))
          .then(() => {})
          .finally(() => {
            clearTimeout(budgetTimer);
            clearTimeout(initializeGraceTimer);
          });
        closePromise = Promise.race([
          reclaimed,
          new Promise((resolve) => {
            budgetTimer = setTimeout(resolve, CLOSE_BUDGET_MS);
            budgetTimer.unref();
          }),
        ]);
      }
      return closePromise;
    },
  };
}

module.exports = { CLOSE_BUDGET_MS, DELETE_TIMEOUT_MS, INITIALIZE_GRACE_MS, WARMUP_DEADLINE_MS, warmMcpServers };
