'use strict';

const { randomUUID } = require('node:crypto');
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

const STEERING_METHOD = '_session/steering';
const INTERNAL_ERROR = -32603;
const METHOD_NOT_FOUND = -32601;
const USAGE_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cachedReadTokens',
  'cachedWriteTokens',
  'thoughtTokens',
  'totalTokens',
];

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
  const version = typeof agentVersion === 'string' ? /^(\d+)\.(\d+)\.\d+$/.exec(agentVersion) : null;
  return !!version && (Number(version[1]) > 1 || (Number(version[1]) === 1 && Number(version[2]) >= 5));
}

function isFiniteCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function mergeUsage(accumulated, nextUsage) {
  if (!isObject(nextUsage)) return accumulated;
  const hasAny = USAGE_FIELDS.some((field) => isFiniteCount(nextUsage[field]));
  if (!hasAny) return accumulated;
  const merged = accumulated ? { ...accumulated } : {};
  for (const field of USAGE_FIELDS) {
    if (isFiniteCount(nextUsage[field])) {
      merged[field] = (merged[field] || 0) + nextUsage[field];
    }
  }
  return merged;
}

function withMergedUsage(response, accumulatedUsage) {
  if (!accumulatedUsage || !isObject(response) || response.error || !isObject(response.result)) {
    return response;
  }
  const merged = mergeUsage(accumulatedUsage, response.result.usage);
  if (!merged) return response;
  const baseUsage = isObject(response.result.usage) ? response.result.usage : {};
  return {
    ...response,
    result: {
      ...response.result,
      usage: { ...baseUsage, ...merged },
    },
  };
}

function sanitizeSteerError(error, fallbackMessage) {
  const code = typeof error?.code === 'number' && error.code !== METHOD_NOT_FOUND
    ? error.code
    : INTERNAL_ERROR;
  const message = typeof error?.message === 'string' && error.message.trim()
    ? error.message
    : fallbackMessage;
  return {
    code,
    message,
    ...(error && error.data !== undefined ? { data: error.data } : {}),
  };
}

function makeError(id, message, rawError) {
  return {
    jsonrpc: '2.0',
    id,
    error: rawError ? sanitizeSteerError(rawError, message) : { code: INTERNAL_ERROR, message },
  };
}

/**
 * agy accepts concurrent session/prompt requests. The previous request may end
 * as soon as a new one takes over. Keep Cindy's original request open until
 * the newest prompt finishes, serialize queued steering handoffs, aggregate
 * segmented token usage, block steering while waiting for interactive/permission
 * replies, and guard against cancellation and rejection races.
 */
function createSteeringRelay() {
  const turns = new Map();
  const backendIds = new Map();
  const agentRequestSessions = new Map();
  const sessionPendingAgentRequests = new Map();
  let offered = false;
  let nativeSteering = false;

  const idKeyOf = (id) => typeof id + ':' + String(id);

  function trackAgentRequest(message) {
    const sid = message.params?.sessionId;
    if (typeof sid !== 'string' || !sid) return;
    const reqKey = idKeyOf(message.id);
    agentRequestSessions.set(reqKey, sid);
    let set = sessionPendingAgentRequests.get(sid);
    if (!set) {
      set = new Set();
      sessionPendingAgentRequests.set(sid, set);
    }
    set.add(reqKey);
  }

  function untrackAgentRequest(id) {
    const reqKey = idKeyOf(id);
    const sid = agentRequestSessions.get(reqKey);
    if (!sid) return;
    agentRequestSessions.delete(reqKey);
    const set = sessionPendingAgentRequests.get(sid);
    if (!set) return;
    set.delete(reqKey);
    if (set.size === 0) sessionPendingAgentRequests.delete(sid);
  }

  function hasPendingAgentRequest(sessionId) {
    const set = sessionPendingAgentRequests.get(sessionId);
    return Boolean(set && set.size > 0);
  }

  function clearSessionPendingRequests(sessionId) {
    const set = sessionPendingAgentRequests.get(sessionId);
    if (!set) return;
    for (const reqKey of set) agentRequestSessions.delete(reqKey);
    sessionPendingAgentRequests.delete(sessionId);
  }

  function closeTurn(turn, response, actions) {
    if (turn.closed) return;
    turn.closed = true;
    turns.delete(turn.sessionId);
    clearSessionPendingRequests(turn.sessionId);
    for (const [key, item] of backendIds) {
      if (item.turn === turn) backendIds.delete(key);
    }
    for (const item of turn.queue) {
      if (turn.cancelled) {
        actions.toClient.push(makeError(item.id, 'Turn was cancelled; steering was not sent'));
      } else {
        actions.toClient.push({
          jsonrpc: '2.0',
          id: item.id,
          result: { outcome: 'promptRequired', reason: 'noRunningTurn' },
        });
      }
    }
    turn.queue = [];
    if (turn.injection && turn.injection.hostId !== undefined) {
      if (turn.cancelled) {
        actions.toClient.push(makeError(turn.injection.hostId, 'Turn was cancelled; steering was not injected'));
      } else {
        actions.toClient.push({
          jsonrpc: '2.0',
          id: turn.injection.hostId,
          result: { outcome: 'promptRequired', reason: 'noRunningTurn' },
        });
      }
      turn.injection.hostId = undefined;
    }
    turn.injection = null;
    const finalResponse = withMergedUsage(response, turn.usage);
    actions.turnResponse = { ...finalResponse, id: turn.hostId };
  }

  function drainQueue(turn, actions) {
    if (turn.closed || turn.injection || turn.cancelled || !turn.queue.length) return;
    if (hasPendingAgentRequest(turn.sessionId)) {
      const blocked = turn.queue.splice(0);
      for (const item of blocked) {
        actions.toClient.push(makeError(item.id, 'Cannot steer while waiting for a permission or interactive confirmation'));
      }
      return;
    }
    const item = turn.queue.shift();
    const backendId = 'cindy-steer-' + randomUUID();
    turn.injection = {
      hostId: item.id,
      backendId,
      previousId: turn.currentId,
      previousResponse: null,
      replacementResponse: null,
      abortReason: null,
      followUpCancelSent: false,
    };
    backendIds.set(idKeyOf(backendId), { turn, role: 'replacement' });
    actions.toAgent.push({
      jsonrpc: '2.0',
      id: backendId,
      method: 'session/prompt',
      params: { sessionId: turn.sessionId, prompt: item.prompt },
    });
  }

  function settleAbortingInjection(turn, actions) {
    const inj = turn.injection;
    if (!inj || !inj.previousResponse || !inj.replacementResponse) return;
    if (inj.hostId !== undefined) {
      const reason = inj.abortReason === 'cancelled'
        ? 'Turn was cancelled; steering was not injected'
        : 'Original turn failed; steering was not injected';
      actions.toClient.push(makeError(inj.hostId, reason));
      inj.hostId = undefined;
    }
    if (inj.previousResponse.result?.usage) {
      turn.usage = mergeUsage(turn.usage, inj.previousResponse.result.usage);
    }
    let primary;
    if (inj.previousResponse.error) {
      primary = inj.previousResponse;
    } else if (inj.abortReason === 'cancelled') {
      primary = inj.replacementResponse.result?.stopReason === 'cancelled'
        ? inj.replacementResponse
        : (inj.previousResponse.result?.stopReason === 'cancelled'
          ? inj.previousResponse
          : { jsonrpc: '2.0', result: { stopReason: 'cancelled' } });
    } else {
      primary = inj.replacementResponse.error ? inj.replacementResponse : inj.previousResponse;
    }
    closeTurn(turn, primary, actions);
  }

  function markSessionCancelling(sessionId) {
    const toClient = [];
    const turn = turns.get(sessionId);
    if (!turn || turn.closed) return toClient;
    turn.cancelled = true;
    const queued = turn.queue.splice(0);
    for (const item of queued) {
      toClient.push(makeError(item.id, 'Turn was cancelled; steering was not sent'));
    }
    if (turn.injection) {
      turn.injection.abortReason = 'cancelled';
    }
    return toClient;
  }

  return {
    get offered() {
      return offered;
    },

    get nativeSteering() {
      return nativeSteering;
    },

    completeInitializeResult(result) {
      if (!isObject(result)) return result;
      if (result._meta?.steering?.supported === true) {
        nativeSteering = true;
        offered = true;
        return result;
      }
      const { agentInfo } = result;
      if (agentInfo?.name !== 'Antigravity ACP Server' || !supportsSteering(agentInfo.version)) {
        offered = false;
        nativeSteering = false;
        return result;
      }
      offered = true;
      nativeSteering = false;
      const meta = isObject(result._meta) ? result._meta : {};
      const steering = isObject(meta.steering) ? meta.steering : {};
      return {
        ...result,
        _meta: { ...meta, steering: { ...steering, supported: true } },
      };
    },

    handleAgentRequest(message) {
      if (!isObject(message) || typeof message.method !== 'string' || message.id === undefined) return;
      trackAgentRequest(message);
    },

    handleClientMessage(message) {
      if (!isObject(message)) return null;

      // Host replying to an agent-initiated request (e.g. session/request_permission).
      if (message.id !== undefined && message.method === undefined) {
        untrackAgentRequest(message.id);
        return null;
      }

      if (typeof message.method !== 'string') return null;
      const params = message.params;

      if (message.method === 'session/cancel' || message.method === 'session/close') {
        if (typeof params?.sessionId === 'string') {
          const toClient = markSessionCancelling(params.sessionId);
          if (message.method === 'session/close') clearSessionPendingRequests(params.sessionId);
          if (toClient.length > 0) return { forward: true, toClient };
        }
        return null;
      }

      if (message.method === 'session/load' || message.method === 'session/resume') {
        if (typeof params?.sessionId === 'string') {
          const toClient = markSessionCancelling(params.sessionId);
          if (toClient.length > 0) return { forward: true, toClient };
        }
        return null;
      }

      if (!offered || nativeSteering || message.id === undefined) return null;

      if (message.method === 'session/prompt') {
        const sid = params?.sessionId;
        if (typeof sid !== 'string' || !sid) return null;
        if (turns.has(sid)) {
          return { toClient: [makeError(message.id, 'Session already has an active prompt')] };
        }
        const turn = {
          sessionId: sid,
          hostId: message.id,
          currentId: message.id,
          queue: [],
          injection: null,
          cancelled: false,
          closed: false,
          usage: null,
        };
        turns.set(sid, turn);
        backendIds.set(idKeyOf(message.id), { turn, role: 'active' });
        return null;
      }

      if (message.method !== STEERING_METHOD) return null;

      const sid = params?.sessionId;
      const turn = typeof sid === 'string' ? turns.get(sid) : undefined;
      if (!turn || turn.closed) {
        return {
          toClient: [{
            jsonrpc: '2.0',
            id: message.id,
            result: { outcome: 'promptRequired', reason: 'noRunningTurn' },
          }],
        };
      }
      if (turn.cancelled) {
        return { toClient: [makeError(message.id, 'Turn is cancelling; steering was not sent')] };
      }
      if (!Array.isArray(params?.prompt) || params.prompt.length === 0) {
        return { toClient: [makeError(message.id, 'Steering prompt is empty')] };
      }
      if (!turn.injection && hasPendingAgentRequest(turn.sessionId)) {
        return { toClient: [makeError(message.id, 'Cannot steer while waiting for a permission or interactive confirmation')] };
      }

      const actions = { toClient: [], toAgent: [] };
      turn.queue.push({ id: message.id, prompt: params.prompt });
      drainQueue(turn, actions);
      return actions;
    },

    handleAgentResponse(message) {
      if (!isObject(message) || message.method !== undefined || message.id === undefined) {
        return { action: 'passthrough' };
      }
      const idKey = idKeyOf(message.id);
      const tracked = backendIds.get(idKey);
      if (!tracked) return { action: 'passthrough' };

      const { turn } = tracked;
      const inj = turn.injection;
      const actions = { action: 'handled', toClient: [], toAgent: [], turnResponse: null };

      if (!inj) {
        backendIds.delete(idKey);
        if (idKey === idKeyOf(turn.currentId)) {
          closeTurn(turn, message, actions);
          return actions;
        }
        return { action: 'passthrough' };
      }

      const prevKey = idKeyOf(inj.previousId);
      const nextKey = idKeyOf(inj.backendId);

      // Response for the previous (pre-steering) prompt.
      if (idKey === prevKey) {
        backendIds.delete(idKey);
        inj.previousResponse = message;

        const prevFailed = Boolean(message.error);
        const prevCancelled = !prevFailed && message.result?.stopReason === 'cancelled';

        if (turn.cancelled || prevFailed || prevCancelled) {
          inj.abortReason = (turn.cancelled || prevCancelled) ? 'cancelled' : 'previousError';
          if (inj.replacementResponse) {
            settleAbortingInjection(turn, actions);
          } else if (!inj.followUpCancelSent) {
            // Ensure the in-flight replacement prompt is also cancelled so it never runs orphaned.
            inj.followUpCancelSent = true;
            actions.toAgent.push({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: turn.sessionId } });
          }
          return actions;
        }

        // Normal handoff (or natural end_turn right as steering arrived):
        // accumulate pre-steer usage and confirm steering injection to host.
        if (message.result?.usage) {
          turn.usage = mergeUsage(turn.usage, message.result.usage);
        }

        if (inj.replacementResponse?.error) {
          if (inj.hostId !== undefined) {
            actions.toClient.push(makeError(inj.hostId, 'Steering request was rejected', inj.replacementResponse.error));
            inj.hostId = undefined;
          }
          turn.injection = null;
          closeTurn(turn, message, actions);
          return actions;
        }

        if (inj.hostId !== undefined) {
          actions.toClient.push({ jsonrpc: '2.0', id: inj.hostId, result: { outcome: 'injected' } });
          inj.hostId = undefined;
        }
        turn.currentId = inj.backendId;
        const alreadyFinished = inj.replacementResponse;
        turn.injection = null;

        if (alreadyFinished) {
          backendIds.delete(nextKey);
          closeTurn(turn, alreadyFinished, actions);
        } else {
          drainQueue(turn, actions);
        }
        return actions;
      }

      // Response for the replacement (steering) prompt.
      if (idKey === nextKey) {
        backendIds.delete(idKey);
        inj.replacementResponse = message;

        if (turn.cancelled || inj.abortReason) {
          if (inj.previousResponse) settleAbortingInjection(turn, actions);
          return actions;
        }

        // Agent explicitly rejected the steering prompt while the previous prompt is still running.
        // Keep the previous prompt intact and surface the sanitized error to the steering caller.
        if (message.error && !inj.previousResponse) {
          if (inj.hostId !== undefined) {
            actions.toClient.push(makeError(inj.hostId, 'Steering request failed', message.error));
            inj.hostId = undefined;
          }
          turn.injection = null;
          drainQueue(turn, actions);
          return actions;
        }

        // Replacement settled before previous response arrived on wire;
        // wait for previous response so ordering and handoff stay deterministic.
        return actions;
      }

      return { action: 'passthrough' };
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
  let toAgent;
  let toClient;

  const pushToClient = (message) => {
    if (!toClient || toClient.destroyed || toClient.readableEnded) return;
    toClient.push(encode(message));
  };
  const pushToAgent = (message) => {
    if (!toAgent || toAgent.destroyed || toAgent.readableEnded || child.stdin.destroyed || child.stdin.writableEnded) return;
    toAgent.push(encode(message));
  };

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

  toClient = lineTransform((line) => {
    const message = parse(line);
    if (!message) return line;
    if (message.method) {
      if (message.id !== undefined) steering.handleAgentRequest(message);
      const normalized = isAntigravity ? normalizeToolMessage(message) : undefined;
      if (normalized === null) return null;
      const outgoing = normalized || message;
      if (errorRelay) {
        const action = errorRelay.notification(outgoing);
        if (action) {
          if (action.flush) {
            for (const item of action.flush) pushToClient(item);
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
    if (handled.action === 'handled') {
      for (const item of handled.toClient) pushToClient(item);
      for (const item of handled.toAgent) pushToAgent(item);
      if (handled.turnResponse) {
        const classified = errorRelay ? errorRelay.response(handled.turnResponse, pushToClient) : handled.turnResponse;
        return encode(classified);
      }
      return null;
    }
    if (errorRelay) {
      const classified = errorRelay.response(message, pushToClient);
      if (classified !== message) return encode(classified);
    }
    return line;
  });

  toAgent = lineTransform((line) => {
    const message = parse(line);
    if (!isObject(message)) return line;
    if (message.method === undefined) {
      steering.handleClientMessage(message);
      return line;
    }
    const params = message.params;
    if (message.id !== undefined) {
      if (message.method === '_cindy/checkAccountVerification' && isAntigravity && verification &&
          typeof params?.sessionId === 'string' && mcpSessions.has(params.sessionId)) {
        void verification.check(mcpSessions.get(params.sessionId).account).catch(() => ({ status: 'unknown' })).then(result => {
          pushToClient({ jsonrpc: '2.0', id: message.id, result });
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
    }
    if (message.method === 'session/close' && typeof params?.sessionId === 'string') {
      mcpSessions.delete(params.sessionId);
    }
    const handled = steering.handleClientMessage(message);
    if (!handled) return line;
    if (handled.toClient) {
      for (const item of handled.toClient) pushToClient(item);
    }
    if (handled.toAgent) {
      for (const item of handled.toAgent) pushToAgent(item);
    }
    return handled.forward ? line : null;
  });
  toAgent.on('error', stop);
  toClient.on('error', stop);
  input.pipe(toAgent).pipe(child.stdin);
  child.stdout.pipe(toClient).pipe(output, { end: false });
  // `relay` ends once everything agy wrote has been handed to `output`.
  return { detach: () => input.unpipe(toAgent), relay: toClient };
}

module.exports = { attachSteering, createSteeringRelay, mergeUsage, supportsSteering };
