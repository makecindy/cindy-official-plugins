'use strict';

const { Transform } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');
const {
  adaptAgyNativeToolUpdate,
  clientSupportsElicitationForm,
  completeInitializeResult,
  isObject,
  isSessionOpen,
  normalizeMcpToolCall,
} = require('./agy-mcp.js');

function lineTransform(handle) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  function drain(stream) {
    let start = 0;
    let end;
    while ((end = pending.indexOf('\n', start)) !== -1) {
      const line = pending.slice(start, end + 1);
      const forwarded = handle(line);
      if (forwarded !== null) stream.push(forwarded);
      start = end + 1;
    }
    pending = pending.slice(start);
    if (Buffer.byteLength(pending) > 16 * 1024 * 1024) throw new Error('ACP line exceeds 16 MiB');
  }
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        pending += decoder.write(chunk);
        drain(this);
        callback();
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      pending += decoder.end();
      callback(null, pending);
    },
  });
}

const encode = (message) => JSON.stringify(message) + '\n';
function parse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function supportsSteering(agentVersion) {
  const version = /^1\.(\d+)\.\d+$/.exec(agentVersion);
  return !!version && Number(version[1]) >= 5;
}

/**
 * agy accepts concurrent session/prompt requests. The previous request may end
 * as soon as a new one takes over. Keep Cindy's original request open until
 * the newest prompt finishes and relay all of the session's streamed updates.
 */
function attachSteering(input, output, child, stop) {
  const turns = new Map();
  const requests = new Map();
  const openingSessions = new Map();
  const mcpSessions = new Map();
  let nextSteerId = 0;
  let initializeId;
  let isAntigravity = false;
  let elicitationForm = false;
  let offered = false;

  function normalizeToolMessage(message) {
    const { method, params } = message;
    const updateKind = params?.update?.sessionUpdate;
    let key;
    if (method === 'session/request_permission' && message.id !== undefined) key = 'toolCall';
    if (method === 'session/update' && (updateKind === 'tool_call' || updateKind === 'tool_call_update')) key = 'update';
    if (!key || typeof params?.sessionId !== 'string') return undefined;
    const { sessionId } = params;
    // agy can replay updates while it loads a known session, before its open response.
    const opening = [...openingSessions.values()].find((session) => session.sessionId === sessionId);
    const session = opening ?? mcpSessions.get(sessionId);
    if (!session) return undefined;
    const toolCall = normalizeMcpToolCall(params[key], session.seen, session.serverNames);
    if (toolCall) return { ...message, params: { ...params, [key]: toolCall } };
    if (key === 'update') {
      const adapted = adaptAgyNativeToolUpdate(params.update, { elicitationForm, seenSteps: session.seenSteps });
      if (adapted?.action === 'drop') return null;
      if (adapted?.action === 'replace') return { ...message, params: { ...params, update: adapted.update } };
    }
    return undefined;
  }

  const toClient = lineTransform((line) => {
    const message = parse(line);
    if (!message) return line;
    if (message.method) {
      if (!isAntigravity) return line;
      const normalized = normalizeToolMessage(message);
      if (normalized === null) return null;
      return normalized ? encode(normalized) : line;
    }
    if (message.id === undefined) return line;
    if (message.id === initializeId) {
      initializeId = undefined;
      const { agentInfo } = message.result ?? {};
      isAntigravity = agentInfo?.name === 'Antigravity ACP Server';
      if (isAntigravity) {
        const result = completeInitializeResult(message.result);
        offered = supportsSteering(agentInfo.version);
        if (offered) result._meta = { ...result._meta, steering: { ...result._meta?.steering, supported: true } };
        return encode({ ...message, result });
      }
    }
    const opening = openingSessions.get(message.id);
    if (opening) {
      openingSessions.delete(message.id);
      const sessionId = opening.sessionId ?? message.result?.sessionId;
      if (isObject(message.result) && typeof sessionId === 'string') mcpSessions.set(sessionId, opening);
    }

    const turn = requests.get(message.id);
    if (!turn) return line;
    requests.delete(message.id);
    if (message.id === turn.latestId) turn.result = message;
    if (--turn.pending !== 0) return null;
    turns.delete(turn.sessionId);
    return encode({ ...turn.result, id: turn.originalId });
  });

  const toAgent = lineTransform((line) => {
    const message = parse(line);
    if (!message?.method || message.id === undefined) return line;
    const params = message.params;
    if (message.method === 'initialize') {
      initializeId = message.id;
      elicitationForm = clientSupportsElicitationForm(params);
    }
    if (isAntigravity && isSessionOpen(message.method)) {
      const servers = Array.isArray(params?.mcpServers) ? params.mcpServers : [];
      const serverNames = servers.map((server) => server?.name).filter((name) => typeof name === 'string' && name);
      openingSessions.set(message.id, { sessionId: params?.sessionId, serverNames, seen: new Map(), seenSteps: new Map() });
    }
    if (!offered) return line;
    if (message.method === 'session/prompt' && typeof params?.sessionId === 'string' && !turns.has(params.sessionId)) {
      const turn = { sessionId: params.sessionId, originalId: message.id, latestId: message.id, pending: 1 };
      turns.set(params.sessionId, turn);
      requests.set(message.id, turn);
    }
    if (message.method !== '_session/steering') return line;
    const turn = turns.get(params?.sessionId);
    if (!turn || turn.result) {
      toClient.push(encode({ jsonrpc: '2.0', id: message.id, result: {
        outcome: 'promptRequired', reason: 'noRunningTurn',
      } }));
      return null;
    }
    const id = 'cindy-steer-' + ++nextSteerId;
    turn.latestId = id;
    turn.pending++;
    requests.set(id, turn);
    // Acknowledge the bridge accepting input before agy can emit its output.
    // Native submission failures then surface on the original prompt.
    toClient.push(encode({ jsonrpc: '2.0', id: message.id, result: { outcome: 'injected' } }));
    return encode({ jsonrpc: '2.0', id, method: 'session/prompt', params: {
      sessionId: turn.sessionId, prompt: params.prompt,
    } });
  });
  toAgent.on('error', stop);
  toClient.on('error', stop);
  input.pipe(toAgent).pipe(child.stdin);
  child.stdout.pipe(toClient).pipe(output, { end: false });
  // `relay` ends once everything agy wrote has been handed to `output`.
  return { detach: () => input.unpipe(toAgent), relay: toClient };
}

module.exports = { attachSteering };
