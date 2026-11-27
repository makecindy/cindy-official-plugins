'use strict';

/**
 * Remote-workspace mode of the engine entry (`--cindy-remote-workspace`).
 *
 * Cindy passes that argument when the task's files and commands are on another computer of the
 * same account. Antigravity's own file and command tools would act on this computer, where the
 * project is not, so the session runs under a custom agent that has none of them and works only
 * through the tools Cindy provides over MCP (`cindy_exec` and Cindy's other servers), which run
 * on the task's computer.
 *
 * How (checked against agy 1.5.13):
 *  - agy's permission rules do not stop its own tools over ACP, so they are not used. The agent
 *    definition's `tools` allow-list does: with only `search_web` allowed, the file and command
 *    tools do not exist in the session.
 *  - A restricted agent can use an MCP server only when the server is named in its definition
 *    AND passed in `session/new`. The definition names the servers; their addresses and the task
 *    token stay in the `session/new` request and never reach a file.
 *  - The server names are known only once Cindy opens the session, so agy is started twice: a
 *    plain process answers `initialize`, then the process that runs the session starts with
 *    `--agent` after the definition has been written.
 *  - agy does not declare HTTP MCP support although it has it; the `initialize` answer is
 *    completed so Cindy hands its tools over.
 *  - agy gives the session's MCP servers five seconds to connect, and a server late for that is
 *    not declared to the model. Every handshake request here crosses the device link, so the
 *    handshakes are done before `session/new` reaches agy (mcp-warmup.js).
 *  - agy reports an MCP call in its own way: through a generic caller (`MCP Tool Bash`, arguments
 *    nested) in a new session, as a tool named `mcp_<server>_<tool>` in a resumed one. Both are
 *    passed to Cindy as the tool they are, so Cindy shows and checks its own Bash, Read, Write….
 *
 * Nothing persistent changes: the definition lives in a private directory of this one launch,
 * removed when the task ends. The user's Antigravity settings, sign-in and agents are untouched.
 *
 * It fails closed. An agy older than the checked version is refused. agy offers no way to read
 * the effective tool set back before a session, so the relay watches the session instead: the
 * first tool call that is not an MCP call but reads, edits or runs something on this computer
 * ends the task.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { completeInitializeResult, isObject, isSessionOpen, normalizeMcpToolCall } = require('./agy-mcp.js');
const { accountErrorRelay, classifyAccountErrorResponse } = require('./agy-account-errors.js');
const { warmMcpServers } = require('./mcp-warmup.js');

const REMOTE_WORKSPACE_ARG = '--cindy-remote-workspace';
const GUEST_WORKSPACE_ARG = '--cindy-guest-workspace';
const AGENT_NAME = 'cindy-remote';
/** The server that replaces the agent's own file and command tools; the task cannot run without it. */
const EXEC_SERVER = 'cindy_exec';
/** First agy version this mode was checked against. */
const MIN_VERSION = Object.freeze([1, 5, 13]);
/** Names that can be written into the definition's YAML as they are. */
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_SERVERS = 64;
/** Remote-workspace mode could not be established, or was broken by the agent; agy is not left running. */
const REMOTE_WORKSPACE_EXIT_CODE = 78;
const LAUNCH_DIR_PREFIX = 'cindy-agy-remote-';
/** A launch directory this old belongs to a task that ended without cleaning up (a crash, a hard kill). */
const STALE_LAUNCH_DIR_MS = 24 * 60 * 60 * 1000;

/** ACP tool kinds that mean "touched this computer" when the call is not an MCP call. */
const LOCAL_KINDS = new Set(['read', 'edit', 'delete', 'move', 'execute']);
/** agy's own file and command tools, by the name it reports. */
const LOCAL_TOOL_NAMES = new Set([
  'view_file', 'multimodal_view_file', 'read_file', 'list_dir', 'find_by_name', 'grep_search', 'code_search',
  'write_to_file', 'write_file', 'create_file', 'edit_file', 'replace_file_content', 'multi_replace_file_content',
  'run_command', 'command_status', 'send_command_input',
]);
/** How Cindy's file and command tools appear in the task, by ACP tool kind. */
const EXEC_TOOL_KINDS = Object.freeze({
  Bash: 'execute', BashOutput: 'execute', KillShell: 'execute',
  Read: 'read', Write: 'edit', Edit: 'edit', NotebookEdit: 'edit', WebFetch: 'fetch',
});

const STOPPED_MESSAGE =
  'Antigravity 试图使用这台电脑上的工具，任务已停止。这个任务的文件在另一台电脑上，它只能使用那台电脑提供的工具。\n\n'
  + 'Antigravity tried to use a tool on this computer, so the task was stopped. '
  + "This task's files are on another computer; it may only use the tools that computer provides.";

function isGuestWorkspaceLaunch(argv) {
  return Array.isArray(argv) && argv.slice(2).includes(GUEST_WORKSPACE_ARG);
}

function isRemoteWorkspaceLaunch(argv) {
  return Array.isArray(argv) && (argv.slice(2).includes(REMOTE_WORKSPACE_ARG) || argv.slice(2).includes(GUEST_WORKSPACE_ARG));
}

/** `1.5.13`, `agy 1.6.0-beta.2`, … at or above the checked version. Unreadable versions are not. */
function versionSupported(version) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(typeof version === 'string' ? version : '');
  if (!match) return false;
  for (let index = 0; index < 3; index += 1) {
    const part = Number(match[index + 1]);
    if (part !== MIN_VERSION[index]) return part > MIN_VERSION[index];
  }
  return true;
}

/** A private, otherwise empty directory agy runs in for this task; it holds the agent definition. */
function prepareLaunchDir(tmpRoot) {
  const root = tmpRoot || os.tmpdir();
  removeStaleLaunchDirs(root);
  return fs.mkdtempSync(path.join(root, LAUNCH_DIR_PREFIX));
}

function removeLaunchDir(dir) {
  try {
    // agy may need a moment to let go of its working directory (Windows keeps it locked until then).
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // best effort: a small directory in the temp folder, swept by a later launch
  }
}

/** Directories left by tasks that could not clean up. They hold one small file and no secret. */
function removeStaleLaunchDirs(root, now = Date.now()) {
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(LAUNCH_DIR_PREFIX)) continue;
    const dir = path.join(root, name);
    try {
      if (now - fs.statSync(dir).mtimeMs > STALE_LAUNCH_DIR_MS) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // someone else's, or still in use
    }
  }
}

/**
 * The agent the session runs under. `tools` is an allow-list of agy's own tools: `search_web`
 * runs at the model service and touches no computer. `mcpServers` only names the servers the
 * agent may use; where they are comes with `session/new`.
 */
function agentDefinition(serverNames) {
  const others = serverNames.filter((name) => name !== EXEC_SERVER);
  return [
    '---',
    `name: ${AGENT_NAME}`,
    'description: Works on a project that is on another computer, through the tools Cindy provides.',
    'tools:',
    '  - search_web',
    'mcpServers:',
    ...serverNames.map((name) => `  - name: ${name}`),
    '---',
    'You are a coding agent running inside Cindy. The project you are working on is on another computer, not on this one.',
    '',
    `You have no file or shell tools of your own in this task. Everything that reads or changes files, or runs commands, goes through the MCP server \`${EXEC_SERVER}\` (Bash, BashOutput, KillShell, Read, Write, Edit, NotebookEdit). Those tools run on the computer the project is on.`,
    ...(others.length
      ? [`The other MCP servers of this task (${others.map((name) => `\`${name}\``).join(', ')}) are Cindy's own tools on that computer. List a server's tools before you use them.`]
      : []),
    '',
    '- Use the workspace path given in the conversation for file paths and as the directory of commands. Paths on this computer mean nothing for the project.',
    '- Search files with Bash (rg, find, ls). Read a file before you edit it, and make the smallest change that does the job.',
    '- Never say you read, changed or ran something unless the tool call for it succeeded. If a tool is refused or missing, say so instead of guessing.',
    '- Keep answers short and concrete: what you changed, and how you checked it.',
    '',
  ].join('\n');
}

function writeAgentDefinition(dir, serverNames) {
  const agents = path.join(dir, '.agents', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, `${AGENT_NAME}.md`), agentDefinition(serverNames), 'utf8');
}

/** The HTTP MCP servers of a session request that the agent can be given, in order, by unique name. */
function usableServers(params) {
  const list = isObject(params) && Array.isArray(params.mcpServers) ? params.mcpServers : [];
  const servers = [];
  const dropped = [];
  for (const server of list) {
    const name = isObject(server) && typeof server.name === 'string' ? server.name : '';
    const usable = isObject(server) && server.type === 'http' && typeof server.url === 'string'
      && SERVER_NAME.test(name) && !servers.some((item) => item.name === name) && servers.length < MAX_SERVERS;
    if (usable) servers.push(server);
    else dropped.push(name || '(unnamed)');
  }
  return { servers, dropped };
}

function remoteToolIdentity({ server, tool }) {
  if (server === EXEC_SERVER) return { title: tool, kind: EXEC_TOOL_KINDS[tool] || 'other' };
}

/** Keep the remote restriction on native file and command tools after normalizing MCP calls. */
function inspectToolCall(toolCall, seen, serverNames = []) {
  if (!isObject(toolCall)) return { type: 'other' };
  const mcpCall = normalizeMcpToolCall(toolCall, seen, serverNames, {
    allowLegacyEnvelope: true, toolIdentity: remoteToolIdentity,
  });
  if (mcpCall) return { type: 'mcp', toolCall: mcpCall };
  const name = typeof toolCall.name === 'string' ? toolCall.name : '';
  const kind = typeof toolCall.kind === 'string' ? toolCall.kind : '';
  if (LOCAL_TOOL_NAMES.has(name) || LOCAL_KINDS.has(kind)) return { type: 'local', tool: name || kind };
  return { type: 'other' };
}

/** Calls `onLine` with each complete line (without the newline) of a byte stream. */
function lineSplitter(onLine) {
  let pending = [];
  return (chunk) => {
    let start = 0;
    let index;
    while ((index = chunk.indexOf(0x0a, start)) !== -1) {
      const piece = chunk.subarray(start, index);
      const line = pending.length ? Buffer.concat([...pending, piece]) : piece;
      pending = [];
      start = index + 1;
      if (line.length) onLine(line);
    }
    if (start < chunk.length) pending.push(chunk.subarray(start));
  };
}

function parseLine(line) {
  try {
    const message = JSON.parse(line.toString('utf8'));
    return isObject(message) ? message : null;
  } catch {
    return null;
  }
}

const NEWLINE = Buffer.from('\n');

/**
 * Runs one task in remote-workspace mode. `host` carries the launcher and the process helpers of
 * agy-acp.js: { acpArgs, spawnAgy, killTree, exitAfterStderr, describe, exitCodeFor, timings }.
 */
function startRemoteWorkspace(agyPath, host) {
  const { acpArgs, spawnAgy, killTree, exitAfterStderr, describe, exitCodeFor, timings } = host;
  let dir;
  try {
    dir = prepareLaunchDir();
  } catch (error) {
    exitAfterStderr(`[agy-acp] Could not prepare the remote-workspace launch (${describe(error)}). Antigravity was not started.`, REMOTE_WORKSPACE_EXIT_CODE);
    return;
  }

  /**
   * `handshake` → `ready` (initialize answered) → `opening` (session process starting) →
   * `warming` (MCP handshakes finishing) → `session`.
   */
  let phase = 'handshake';
  let initRequest = null;
  let probe = null;
  let agent = null;
  let agentExited = false;
  let sessionRequest = null;
  let warmup = null;
  let finished = false;
  let stopCode = null;
  let forceTimer = null;
  let stdinEnded = false;
  const queued = [];
  const seenCalls = new Map();
  let serverNames = [];

  const running = (child) => Boolean(child) && child.exitCode === null && child.signalCode === null;

  /** Writes with back-pressure: the source pauses until the destination has drained. */
  const pipeWrite = (destination, data, source) => {
    let accepted = true;
    try {
      accepted = destination.write(data);
    } catch {
      return;
    }
    if (!accepted && source && !source.isPaused()) {
      source.pause();
      destination.once('drain', () => source.resume());
    }
  };
  const toClientLine = (line, source) => pipeWrite(process.stdout, Buffer.concat([line, NEWLINE]), source);
  const toClient = (message, source) => pipeWrite(process.stdout, JSON.stringify(message) + '\n', source);
  const toAgentLine = (line) => pipeWrite(agent.stdin, Buffer.concat([line, NEWLINE]), process.stdin);
  const toAgent = (message) => pipeWrite(agent.stdin, JSON.stringify(message) + '\n', process.stdin);
  const refuse = (id, code, message) => toClient({ jsonrpc: '2.0', id, error: { code, message } });

  const finish = (code) => {
    if (finished) return;
    finished = true;
    clearTimeout(forceTimer);
    const done = () => process.exit(code);
    if (process.stdout.writableLength > 0) {
      process.stdout.once('drain', done);
      setTimeout(done, timings.flush);
    } else {
      done();
    }
  };

  const terminate = () => {
    for (const child of [probe, agent]) {
      if (!running(child)) continue;
      if (process.platform === 'win32') {
        killTree(child);
        continue;
      }
      killTree(child, 'SIGTERM');
      setTimeout(() => killTree(child, 'SIGKILL'), timings.signalGrace).unref();
    }
  };

  const stop = (signal) => {
    if (stopCode !== null) return;
    stopCode = 128 + (os.constants.signals[signal] || os.constants.signals.SIGTERM);
    terminate();
    setTimeout(() => finish(stopCode), timings.signalGrace + 300).unref();
  };

  /** Ends the task with a reason; nothing of agy is left running. */
  const abandon = (line, sessionId) => {
    if (stopCode !== null || finished) return;
    stopCode = REMOTE_WORKSPACE_EXIT_CODE;
    if (sessionId) {
      toClient({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: STOPPED_MESSAGE } } },
      });
    }
    try {
      process.stderr.write(line + '\n');
    } catch {
      // ignore
    }
    terminate();
    setTimeout(() => finish(stopCode), timings.signalGrace + 300).unref();
  };

  const errorRelay = accountErrorRelay();

  const launch = (args) => {
    const child = spawnAgy(agyPath, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });
    child.stderr.pipe(process.stderr, { end: false });
    child.stdin.on('error', () => {
      // EPIPE after agy exited; its exit handler takes care of shutting down.
    });
    return child;
  };

  /* ── first process: answers `initialize` ─────────────────────────────── */

  const startProbe = (request, line) => {
    initRequest = request;
    let answered = false;
    try {
      probe = launch(acpArgs);
    } catch (error) {
      exitAfterStderr(`[agy-acp] Could not start Antigravity at ${agyPath} (${describe(error)}).`, host.notFoundExitCode);
      return;
    }
    const current = probe;
    current.on('error', (error) => {
      if (!answered && current.pid === undefined) {
        finished = true;
        exitAfterStderr(`[agy-acp] Could not start Antigravity at ${agyPath} (${describe(error)}).`, host.notFoundExitCode);
      }
    });
    current.on('exit', (code, signal) => {
      if (answered || stopCode !== null) return;
      // No answer will come: let Cindy see the endpoint end, like a plain launch that died.
      finish(exitCodeFor(code, signal) || 1);
    });
    current.stdout.on('data', lineSplitter((answer) => {
      if (answered) return;
      const message = parseLine(answer);
      if (!message || message.id !== request.id || message.method !== undefined) return;
      answered = true;
      phase = 'ready';
      toClient(message.result !== undefined ? { ...message, result: completeInitializeResult(message.result) } : message);
      try {
        current.stdin.end();
      } catch {
        // already closed
      }
      killTree(current, process.platform === 'win32' ? undefined : 'SIGTERM');
    }));
    pipeWrite(current.stdin, Buffer.concat([line, NEWLINE]));
  };

  /* ── second process: runs the session under the restricted agent ─────── */

  const openSession = (request) => {
    const { servers, dropped } = usableServers(request.params);
    if (!servers.some((server) => server.name === EXEC_SERVER)) {
      refuse(request.id, -32602, `Antigravity can only run this task with Cindy's file and command tools (${EXEC_SERVER}), and they were not provided.`);
      return;
    }
    if (dropped.length) {
      process.stderr.write(`[agy-acp] These MCP servers cannot be given to Antigravity and were left out: ${dropped.join(', ')}\n`);
    }
    try {
      writeAgentDefinition(dir, servers.map((server) => server.name));
      // Warms while agy starts; session/new waits for it (see onAgentLine).
      warmup = warmMcpServers(servers, { log: (text) => process.stderr.write(`[agy-acp] ${text}\n`) });
      agent = launch([...acpArgs, '--agent', AGENT_NAME]);
    } catch (error) {
      refuse(request.id, -32603, `Antigravity could not be started for a task on another computer (${describe(error)}).`);
      return;
    }
    phase = 'opening';
    serverNames = servers.map((server) => server.name);
    sessionRequest = { ...request, params: { ...request.params, mcpServers: servers } };
    const current = agent;
    current.on('error', (error) => {
      if (current.pid === undefined) {
        agentExited = true;
        finished = true;
        exitAfterStderr(`[agy-acp] Could not start Antigravity at ${agyPath} (${describe(error)}).`, host.notFoundExitCode);
        return;
      }
      process.stderr.write(`[agy-acp] Antigravity process error: ${describe(error)}\n`);
    });
    current.on('exit', (code, signal) => {
      agentExited = true;
      const status = stopCode !== null ? stopCode : exitCodeFor(code, signal);
      const closeTimer = setTimeout(() => finish(status), timings.flush);
      current.once('close', () => {
        clearTimeout(closeTimer);
        finish(status);
      });
    });
    current.stdout.on('data', lineSplitter(onAgentLine));
    // The session process has not seen Cindy's `initialize` yet; its answer stays here.
    toAgent(initRequest);
    if (stdinEnded) endAgentInput();
  };

  const onAgentLine = (line) => {
    const message = parseLine(line);
    if (!message) {
      toClientLine(line, agent.stdout);
      return;
    }
    if (phase === 'opening' && message.id === initRequest.id && message.method === undefined) {
      const startSession = (mcpServers) => {
        if (finished || stopCode !== null) return;
        if (message.error) {
          toClient(classifyAccountErrorResponse({ jsonrpc: '2.0', id: sessionRequest.id, error: message.error }), agent.stdout);
        } else {
          const opened = { ...sessionRequest, params: { ...sessionRequest.params, mcpServers } };
          errorRelay.request(opened);
          toAgent(opened);
        }
        phase = 'session';
        for (const pending of queued.splice(0)) {
          const queuedMessage = parseLine(pending);
          if (queuedMessage) errorRelay.request(queuedMessage);
          toAgentLine(pending);
        }
      };
      if (message.error) {
        startSession(sessionRequest.params.mcpServers);
        return;
      }
      phase = 'warming';
      warmup.ready.then(startSession, () => startSession(sessionRequest.params.mcpServers));
      return;
    }
    if (message.method === undefined && message.id !== undefined) {
      const classified = errorRelay.response(message);
      if (classified !== message) {
        toClient(classified, agent.stdout);
        return;
      }
    }
    const params = isObject(message.params) ? message.params : null;
    const isPermission = message.method === 'session/request_permission' && message.id !== undefined;
    const update = message.method === 'session/update' && params && isObject(params.update) ? params.update : null;
    const isToolUpdate = Boolean(update) && (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update');
    if (!params || (!isPermission && !isToolUpdate)) {
      if (update) {
        const action = errorRelay.notification(message);
        if (action) {
          if (action.flush) {
            for (const item of action.flush) toClient(item, agent.stdout);
          }
          if (action.hold) return;
        }
      }
      toClientLine(line, agent.stdout);
      return;
    }
    const verdict = inspectToolCall(isPermission ? params.toolCall : update, seenCalls, serverNames);
    if (verdict.type === 'local') {
      if (isPermission) {
        const options = Array.isArray(params.options) ? params.options : [];
        const reject = options.find((option) => isObject(option) && option.kind === 'reject_once');
        toAgent({ jsonrpc: '2.0', id: message.id, result: { outcome: reject ? { outcome: 'selected', optionId: reject.optionId } : { outcome: 'cancelled' } } });
      }
      abandon(
        `[agy-acp] Antigravity used its own tool "${verdict.tool}" in a task whose files are on another computer. The task was stopped.`,
        typeof params.sessionId === 'string' ? params.sessionId : null,
      );
      return;
    }
    const outgoing = verdict.type === 'mcp'
      ? { ...message, params: isPermission ? { ...params, toolCall: verdict.toolCall } : { ...params, update: verdict.toolCall } }
      : message;
    if (isToolUpdate) {
      const action = errorRelay.notification(outgoing);
      if (action?.flush) {
        for (const item of action.flush) toClient(item, agent.stdout);
      }
    }
    if (verdict.type === 'mcp') {
      toClient(outgoing, agent.stdout);
      return;
    }
    toClientLine(line, agent.stdout);
  };

  /* ── Cindy's side ────────────────────────────────────────────────────── */

  const onClientLine = (line) => {
    if (finished || stopCode !== null) return;
    const message = parseLine(line);
    if (host.guest && message && message.method === 'session/list') {
      if (message.id !== undefined) refuse(message.id, -32601, 'session/list is not available for shared sessions');
      return;
    }
    if (phase === 'session') {
      if (message) errorRelay.request(message);
      toAgentLine(line);
      return;
    }
    if (phase === 'opening' || phase === 'warming') {
      queued.push(line);
      return;
    }
    if (!message || typeof message.method !== 'string') return;
    if (message.method === 'initialize' && message.id !== undefined && !initRequest) {
      startProbe(message, line);
    } else if (isSessionOpen(message.method) && message.id !== undefined && phase === 'ready') {
      openSession(message);
    } else if (message.id !== undefined) {
      refuse(message.id, -32600, 'Open a session first');
    }
  };

  const endAgentInput = () => {
    if (!agent || agentExited || forceTimer) return;
    try {
      agent.stdin.end();
    } catch {
      // already closed
    }
    forceTimer = setTimeout(terminate, timings.stdinEndGrace);
    forceTimer.unref();
  };

  process.stdin.on('data', lineSplitter(onClientLine));
  process.stdin.on('end', () => {
    stdinEnded = true;
    if (agent) {
      endAgentInput();
      return;
    }
    // Cindy went away before a session existed.
    terminate();
    finish(0);
  });
  process.stdout.on('error', () => stop('SIGTERM'));

  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  if (process.platform === 'win32') signals.push('SIGBREAK');
  for (const signal of signals) process.on(signal, () => stop(signal));
  process.on('disconnect', () => stop('SIGTERM'));
  process.on('uncaughtException', (error) => {
    try {
      process.stderr.write(`[agy-acp] internal error: ${describe(error)}\n`);
    } catch {
      // ignore
    }
    stop('SIGTERM');
  });
  // Last line of defence for any exit path: never leave agy running, never leave the directory.
  process.on('exit', () => {
    warmup?.close();
    for (const child of [probe, agent]) if (running(child)) killTree(child, 'SIGKILL');
    removeLaunchDir(dir);
  });
}

module.exports = {
  AGENT_NAME,
  EXEC_SERVER,
  GUEST_WORKSPACE_ARG,
  MIN_VERSION,
  REMOTE_WORKSPACE_ARG,
  REMOTE_WORKSPACE_EXIT_CODE,
  agentDefinition,
  completeInitializeResult,
  inspectToolCall,
  isGuestWorkspaceLaunch,
  isRemoteWorkspaceLaunch,
  startRemoteWorkspace,
  usableServers,
  versionSupported,
};
