'use strict';

const MAX_TRACKED_CALLS = 2_000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** agy connects to HTTP MCP servers without declaring it; Cindy only passes them if it does. */
function completeInitializeResult(result) {
  if (!isObject(result)) return result;
  const capabilities = isObject(result.agentCapabilities) ? result.agentCapabilities : {};
  const mcp = isObject(capabilities.mcpCapabilities) ? capabilities.mcpCapabilities : {};
  return { ...result, agentCapabilities: { ...capabilities, mcpCapabilities: { ...mcp, http: true } } };
}

function isSessionOpen(method) {
  return method === 'session/new' || method === 'session/load' || method === 'session/resume';
}

function clientSupportsElicitationForm(params) {
  if (!isObject(params)) return false;
  const caps = isObject(params.clientCapabilities)
    ? params.clientCapabilities
    : isObject(params.client_capabilities) ? params.client_capabilities : null;
  return Boolean(caps && isObject(caps.elicitation) && isObject(caps.elicitation.form));
}

function mapAgyStepStatus(status) {
  switch (typeof status === 'string' ? status.toLowerCase() : '') {
    case 'done':
    case 'completed':
    case 'skipped':
    case 'cancelled':
    case 'canceled':
    case 'failed':
      return 'completed';
    case 'in_progress':
    case 'inprogress':
    case 'running':
      return 'in_progress';
    default:
      return 'pending';
  }
}

/**
 * Adapts Antigravity's native UI-only tool updates into standard ACP / Cindy conventions when
 * the host negotiated `clientCapabilities.elicitation.form` (Cindy host support for native
 * question & plan cards; older hosts receive the raw `update_steps` / `ask_question` tool rows
 * unchanged so existing progress rows do not regress):
 *  - `update_steps` → standard ACP `plan` notification (deduplicated per toolCallId so
 *    the follow-up `completed` update neither duplicates nor renders a raw tool card;
 *    `status: "failed"` updates are always preserved).
 *  - `ask_question` → `AskUserQuestion`, so Cindy's native question card replaces the raw
 *    tool row cleanly.
 */
function adaptAgyNativeToolUpdate(toolCall, { elicitationForm = false, seenSteps } = {}) {
  if (!isObject(toolCall) || !elicitationForm) return null;
  const id = typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : null;
  const name = typeof toolCall.name === 'string' ? toolCall.name : '';
  const status = typeof toolCall.status === 'string' ? toolCall.status.toLowerCase() : '';

  if (name === 'update_steps' || (id && seenSteps && seenSteps.has(id))) {
    if (status === 'failed' || status === 'error') {
      if (id && seenSteps) seenSteps.delete(id);
      return null;
    }
    const rawSteps = Array.isArray(toolCall.rawInput?.steps)
      ? toolCall.rawInput.steps
      : Array.isArray(toolCall.args?.steps) ? toolCall.args.steps : null;
    if (!rawSteps) return seenSteps && id && seenSteps.has(id) ? { action: 'drop' } : null;
    const entries = rawSteps.flatMap((step) => {
      if (!isObject(step) || typeof step.title !== 'string' || !step.title.trim()) return [];
      return [{ content: step.title.trim(), priority: 'medium', status: mapAgyStepStatus(step.status) }];
    });
    const digest = JSON.stringify(entries);
    if (id && seenSteps) {
      if (seenSteps.get(id) === digest) return { action: 'drop' };
      if (seenSteps.size >= MAX_TRACKED_CALLS && !seenSteps.has(id)) {
        seenSteps.delete(seenSteps.keys().next().value);
      }
      seenSteps.set(id, digest);
    }
    return { action: 'replace', update: { sessionUpdate: 'plan', entries } };
  }

  if (name === 'ask_question') {
    return {
      action: 'replace',
      update: { ...toolCall, name: 'AskUserQuestion', title: 'AskUserQuestion' },
    };
  }

  return null;
}

function mcpArguments(input) {
  const value = input.Arguments;
  if (isObject(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return isObject(parsed) ? parsed : { value: parsed };
    } catch {
      return { value };
    }
  }
  return {};
}

/** Use the longest matching server name because server names can themselves contain underscores. */
function directMcpTool(name, serverNames) {
  if (typeof name !== 'string' || !name.startsWith('mcp_')) return null;
  let found = null;
  for (const server of serverNames) {
    const prefix = `mcp_${server.replace(/[^A-Za-z0-9_]/g, '_')}_`;
    if (name.startsWith(prefix) && name.length > prefix.length && (!found || server.length > found.server.length)) {
      found = { server, tool: name.slice(prefix.length) };
    }
  }
  return found;
}

/** Normalize agy's direct and nested MCP calls. Keep their identity on updates that omit it. */
function normalizeMcpToolCall(toolCall, seen, serverNames, { allowLegacyEnvelope = false, toolIdentity } = {}) {
  if (!isObject(toolCall)) return null;
  const id = typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : null;
  const input = toolCall.rawInput;
  let known = id ? seen.get(id) : undefined;
  const name = allowLegacyEnvelope ? toolCall.name : toolCall.name ?? known?.sourceName;
  const nested = isObject(input) && typeof input.ServerName === 'string' && typeof input.ToolName === 'string'
    && (allowLegacyEnvelope || (name === 'call_mcp_tool' && serverNames.includes(input.ServerName)))
    ? { server: input.ServerName, tool: input.ToolName }
    : null;
  const direct = nested ? null : directMcpTool(name, serverNames);
  const call = nested || direct;
  if (call) {
    const identity = toolIdentity?.(call) ?? { title: `mcp__${call.server}__${call.tool}`, kind: 'other' };
    known = { ...identity, sourceName: name, toolName: call.tool };
    if (id) {
      if (seen.size >= MAX_TRACKED_CALLS && !seen.has(id)) seen.delete(seen.keys().next().value);
      seen.set(id, known);
    }
  }
  const knownMatch = Boolean(known) && (
    allowLegacyEnvelope
    || name === known.sourceName
    || name === known.toolName
    || name === known.title
  );
  if (!knownMatch) return null;

  const next = { ...toolCall };
  if ('title' in next) next.title = known.title;
  if ('name' in next) next.name = known.title;
  if ('kind' in next) next.kind = known.kind;
  if (nested) next.rawInput = mcpArguments(input);
  else if (direct && isObject(input)) {
    // agy adds a one-line summary to direct calls. Cindy uses the actual tool arguments.
    const { toolSummary: _summary, ...rest } = input;
    next.rawInput = rest;
  }
  if (isObject(next.args) && (typeof next.args.ServerName === 'string' || direct)) delete next.args;
  return next;
}

module.exports = {
  adaptAgyNativeToolUpdate,
  clientSupportsElicitationForm,
  completeInitializeResult,
  isObject,
  isSessionOpen,
  normalizeMcpToolCall,
};
