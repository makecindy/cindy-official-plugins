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
    known = { ...identity, sourceName: name };
    if (id) {
      if (seen.size >= MAX_TRACKED_CALLS && !seen.has(id)) seen.delete(seen.keys().next().value);
      seen.set(id, known);
    }
  }
  if (!known || (!allowLegacyEnvelope && name !== known.sourceName)) return null;

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

module.exports = { completeInitializeResult, isObject, isSessionOpen, normalizeMcpToolCall };
