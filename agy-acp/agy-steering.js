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
  const version = typeof agentVersion === 'string' ? /^1\.(\d+)\.\d+$/.exec(agentVersion) : null;
  return !!version && Number(version[1]) >= 5;
}

/**
 * agy accepts concurrent session/prompt requests. The previous request may end
 * as soon as a new one takes over. Keep Cindy's original request open until
 * the newest prompt finishes and relay all of the session's streamed updates.
 */
function createSteeringRelay() {
  const turns = new Map();
  const requests = new Map();
  let nextSteerId = 0;
  let offered = false;

  return {
    get offered() {
      return offered;
    },

    completeInitializeResult(result) {
      if (!isObject(result)) return result;
      const { agentInfo } = result;
      if (agentInfo?.name !== 'Antigravity ACP Server' || !supportsSteering(agentInfo.version)) {
        offered = false;
        return result;
      }
      offered = true;
      const meta = isObject(result._meta) ? result._meta : {};
      const steering = isObject(meta.steering) ? meta.steering : {};
      return {
        ...result,
        _meta: { ...meta, steering: { ...steering, supported: true } },
      };
    },

    handleClientMessage(message) {
      if (!offered || !message?.method || message.id === undefined) return null;
      const params = message.params;
      if (message.method === 'session/prompt' && typeof params?.sessionId === 'string' && !turns.has(params.sessionId)) {
        const turn = { sessionId: params.sessionId, originalId: message.id, latestId: message.id, pending: 1 };
        turns.set(params.sessionId, turn);
        requests.set(message.id, turn);
        return null;
      }
      if (message.method !== '_session/steering') return null;
      const turn = turns.get(params?.sessionId);
      if (!turn || turn.result) {
        return {
          toClient: {
            jsonrpc: '2.0',
            id: message.id,
            result: { outcome: 'promptRequired', reason: 'noRunningTurn' },
          },
        };
      }
      const id = 'cindy-steer-' + ++nextSteerId;
      turn.latestId = id;
      turn.pending++;
      requests.set(id, turn);
      return {
        // Acknowledge the bridge accepting input before agy can emit its output.
        // Native submission failures then surface on the original prompt.
        toClient: { jsonrpc: '2.0', id: message.id, result: { outcome: 'injected' } },
        toAgent: {
          jsonrpc: '2.0',
          id,
          method: 'session/prompt',
          params: { sessionId: turn.sessionId, prompt: params.prompt },
        },
      };
    },

    handleAgentResponse(message) {
      if (message.method !== undefined || message.id === undefined) return { action: 'passthrough' };
      const turn = requests.get(message.id);
      if (!turn) return { action: 'passthrough' };
      requests.delete(message.id);
      if (message.id === turn.latestId) turn.result = message;
      if (--turn.pending !== 0) return { action: 'drop' };
      turns.delete(turn.sessionId);
      return { action: 'reply', message: { ...turn.result, id: turn.originalId } };
    },
  };
}

function attachSteering(input, output, child, stop, errorRelay, verification) {
  const steering = createSteeringRelay();
  const openingSessions = new Map();
  const mcpSessions = new Map();
  let initializeId;
  let isAntigravity = false;
  let elicitationForm = false;

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
      const id = typeof params.update?.toolCallId === 'string' ? params.update.toolCallId : null;
      if (id && session.seen.has(id)) return undefined;
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
      const normalized = isAntigravity ? normalizeToolMessage(message) : undefined;
      if (normalized === null) return null;
      const outgoing = normalized || message;
      if (errorRelay) {
        const action = errorRelay.notification(outgoing);
        if (action) {
          if (action.flush) {
            for (const item of action.flush) toClient.push(encode(item));
          }
          if (action.hold) return null;
        }
      }
      return normalized ? encode(normalized) : line;
    }
    if (message.id === undefined) return line;
    if (message.id === initializeId) {
      initializeId = undefined;
      const { agentInfo } = message.result ?? {};
      isAntigravity = agentInfo?.name === 'Antigravity ACP Server';
      if (isAntigravity) {
        const result = steering.completeInitializeResult(completeInitializeResult(message.result));
        return encode({ ...message, result });
      }
    }
    const opening = openingSessions.get(message.id);
    if (opening) {
      openingSessions.delete(message.id);
      const sessionId = opening.sessionId ?? message.result?.sessionId;
      if (isObject(message.result) && typeof sessionId === 'string') {
        if (verification) {
          const previous = mcpSessions.get(sessionId);
          opening.account = previous ? previous.account : verification.sessionAccount();
        }
        mcpSessions.set(sessionId, opening);
      }
    }

    const handled = steering.handleAgentResponse(message);
    if (handled.action === 'drop') return null;
    const flushHeld = (item) => toClient.push(encode(item));
    if (handled.action === 'reply') {
      const classified = errorRelay ? errorRelay.response(handled.message, flushHeld) : handled.message;
      return encode(classified);
    }
    if (errorRelay) {
      const classified = errorRelay.response(message, flushHeld);
      if (classified !== message) return encode(classified);
    }
    return line;
  });

  const toAgent = lineTransform((line) => {
    const message = parse(line);
    if (!message?.method || message.id === undefined) return line;
    const params = message.params;
    if (message.method === '_cindy/checkAccountVerification' && isAntigravity && verification &&
        typeof params?.sessionId === 'string' && mcpSessions.has(params.sessionId)) {
      void verification.check(mcpSessions.get(params.sessionId).account).catch(() => ({ status: 'unknown' })).then(result => {
        if (!toClient.destroyed && !toClient.readableEnded) toClient.push(encode({ jsonrpc: '2.0', id: message.id, result }));
      });
      return null;
    }
    if (errorRelay) errorRelay.request(message);
    if (message.method === 'initialize') {
      initializeId = message.id;
      elicitationForm = clientSupportsElicitationForm(params);
    }
    if (isAntigravity && isSessionOpen(message.method)) {
      const servers = Array.isArray(params?.mcpServers) ? params.mcpServers : [];
      const serverNames = servers.map((server) => server?.name).filter((name) => typeof name === 'string' && name);
      openingSessions.set(message.id, { sessionId: params?.sessionId, serverNames, seen: new Map(), seenSteps: new Map() });
    }
    const handled = steering.handleClientMessage(message);
    if (!handled) return line;
    if (handled.toClient) toClient.push(encode(handled.toClient));
    return handled.toAgent ? encode(handled.toAgent) : null;
  });
  toAgent.on('error', stop);
  toClient.on('error', stop);
  input.pipe(toAgent).pipe(child.stdin);
  child.stdout.pipe(toClient).pipe(output, { end: false });
  // `relay` ends once everything agy wrote has been handed to `output`.
  return { detach: () => input.unpipe(toAgent), relay: toClient };
}

module.exports = { attachSteering, createSteeringRelay, supportsSteering };
