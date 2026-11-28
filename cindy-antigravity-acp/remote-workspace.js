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
 *  - From agy 1.5.18 the allow-list also holds timers and subagents (checked with the real CLI on
 *    2026-11-27). A subagent runs under a definition the agent names in `agents`, which is this
 *    same restricted agent. With `inheritCustomizations: false` agy refuses every other one: the
 *    user's own agents, whose tools would run here, and the built-in `browser`, `pro`, `self`,
 *    `image-generator`…. This has to hold inside agy because agy does not report a subagent's own
 *    tool calls over ACP, only its MCP calls and permission requests: the relay check below would
 *    not see a subagent read a file here. Tools that run code or make agents here stay out:
 *    `define_subagent` (its agents may have any tool), `run_workflow` (a Python script on this
 *    computer) and `swarm`.
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
 *  - agy does not declare ACP's `systemPrompt` (client instructions; checked up to 1.5.17), but the
 *    body of an agent definition is that agent's system prompt. The entry answers ACP's `systemPrompt` itself (append mode only): the
 *    client's text goes at the end of the definition, so subagents get it too, and the field never
 *    reaches agy. The text may come from a friend the model is shared with: `@[label](path)`, which
 *    agy expands into the file at `path` in rule text, is made inert so it cannot pull a file of this
 *    computer into the conversation.
 *
 * From agy 1.5.19 on macOS with the default account, the session runs under agy's default agent, held in by
 * lifecycle hooks. Since agy 1.5.17 a session under a custom agent, its subagents included, uses up
 * the Gemini quota four times as fast as one under the default agent (google-antigravity/
 * antigravity-cli#1890: intended, not a regression). Measured with the real CLI on 2026-11-28 and
 * 2026-11-29: the same task took about a third of the quota under the default agent, although its
 * built-in prompt is larger. How the hooks hold the session in (checked against agy 1.5.19):
 *  - A `PreToolUse` hook that answers `deny` stops the tool before it runs, in the session and in
 *    every subagent of it (whose own tool calls agy still does not report). When several hooks
 *    answer, `deny` wins over `allow`, so a hook of the user's own cannot let a tool through.
 *  - A hook that fails (non-zero exit, timeout, output that is not JSON) also stops the tool, but a
 *    hook that prints nothing lets it run. The hook therefore only prints a file of this launch
 *    whose content is fixed (`cat`, run in `.agents/`, where agy runs hooks); without the file
 *    `cat` fails and the tool is stopped. No program of the plugin runs: in Cindy this entry runs
 *    inside Cindy's own process, which cannot run a script, and the computer may have no Node.
 *  - The hook's `matcher` is matched against the whole tool name. It is built to match every name
 *    except the tools of this task's MCP servers (`mcp_<server>_…`) and agy's own tools that touch
 *    no computer, so a tool agy adds later is stopped as well.
 *  - Rule text (`AGENTS.md`) would expand `@[label](path)` into a file of this computer, so the
 *    instructions come from a `SessionStart` hook instead, whose text agy does not expand. It runs
 *    at the first prompt of a new session (not on resume, where the text is already in the
 *    conversation) and leaves a marker: model output in a new session without that marker means
 *    agy did not load the hooks, and the task is stopped before any tool can run.
 *  - A resumed session loads the hooks of the directory its process starts in. New instructions
 *    on resume are prepended to its first prompt, since SessionStart does not fire on resume.
 *  - The default agent uses a private Gemini directory, so the host account's configured MCP
 *    servers and plugins are not loaded. The macOS keychain still authenticates this session.
 * Not hidden in either mode: agy names the skills of its home directory (`~/.agents/skills`; for
 * the default account the user's own) to the model, with their descriptions. `skills.json` cannot
 * filter them, and another home directory breaks the default account's sign-in (macOS keychain).
 *
 * Nothing persistent changes: the definition or hooks live in a private directory of this one
 * launch, removed when the task ends. The user's Antigravity settings, sign-in and agents are untouched.
 *
 * It fails closed. An agy older than the checked version is refused. agy offers no way to read
 * the effective tool set back before a session, so the relay watches the session instead: the
 * first tool call that is not an MCP call but reads, edits or runs something on this computer
 * ends the task, and so does a subagent that agy started under any agent but the restricted one.
 * Under hooks agy reports the calls its hook stopped (they end `failed`); those are not passed on,
 * and only one that agy reports as `completed` ends the task.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  adaptAgyNativeToolUpdate,
  clientSupportsElicitationForm,
  completeInitializeResult,
  isObject,
  isSessionOpen,
  normalizeMcpToolCall,
} = require('./agy-mcp.js');
const { createSteeringRelay } = require('./agy-steering.js');
const { accountErrorRelay, classifyAccountErrorResponse, isolationViolationLine } = require('./agy-account-errors.js');
const { CLOSE_BUDGET_MS, warmMcpServers } = require('./mcp-warmup.js');

const REMOTE_WORKSPACE_ARG = '--cindy-remote-workspace';
const GUEST_WORKSPACE_ARG = '--cindy-guest-workspace';
const AGENT_NAME = 'cindy-remote';
/** The server that replaces the agent's own file and command tools; the task cannot run without it. */
const EXEC_SERVER = 'cindy_exec';
/** First agy version this mode was checked against. */
const MIN_VERSION = Object.freeze([1, 5, 13]);
/** First agy version the full tool set was checked against; an older agy keeps the basic set. */
const FULL_TOOLS_MIN_VERSION = Object.freeze([1, 5, 18]);
/** agy's own tools that touch no computer: they run at the model service or inside agy's session. */
const BASIC_TOOLS = Object.freeze(['search_web', 'ask_question', 'update_steps']);
const FULL_TOOLS = Object.freeze([
  ...BASIC_TOOLS, 'schedule', 'invoke_subagent', 'manage_subagents', 'send_message',
]);
const SUBAGENT_TOOL = 'invoke_subagent';
/** First agy version the hooks were checked against; an older agy runs under the restricted agent. */
const HOOKS_MIN_VERSION = Object.freeze([1, 5, 19]);
/** The built-in subagent type that keeps the session's MCP servers (checked against agy 1.5.19). */
const HOOKS_SUBAGENT_TYPE = 'self';
const HOOK_NAME = 'cindy-remote-workspace';
/** Files in the launch directory's `.agents/`, where agy runs the hooks. */
const HOOK_DENY_FILE = 'cindy-deny.json';
const HOOK_START_FILE = 'cindy-start.json';
const HOOK_MARKER_FILE = 'cindy-hooks-loaded';
/** Seconds agy gives a hook; one that takes longer stops the tool. */
const HOOK_TIMEOUT_SECONDS = 10;
const HOOK_DENY_REASON =
  "This tool of Antigravity's own is turned off: the project of this task is on another computer. "
  + 'Use the tools of the cindy_exec MCP server (Bash, Read, Write, Edit) instead.';
/** `session/update` kinds that are the model's own output (a turn is under way). */
const MODEL_OUTPUT_UPDATES = new Set(['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan']);
/** Names that can be written into the definition's YAML as they are. */
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_SERVERS = 64;
/** Remote-workspace mode could not be established, or was broken by the agent; agy is not left running. */
const REMOTE_WORKSPACE_EXIT_CODE = 78;
const LAUNCH_DIR_PREFIX = 'cindy-agy-remote-';
const LOG_DIR_PREFIX = 'cindy-agy-log-';
/**
 * How long ending the task waits for the warmed MCP sessions agy did not take over to be ended: the
 * whole budget of the warm-up's close(). Cindy ends anything left when the remote run ends.
 */
const WARMUP_CLOSE_GRACE_MS = CLOSE_BUDGET_MS + 250;
/** A launch directory this old belongs to a task that ended without cleaning up (a crash, a hard kill). */
const STALE_LAUNCH_DIR_MS = 24 * 60 * 60 * 1000;
/**
 * Largest client `systemPrompt` taken, in UTF-8 bytes. Cindy keeps at most 8,000 characters of
 * personal instructions, at most 4 bytes each; anything larger is refused rather than cut short.
 */
const MAX_SYSTEM_PROMPT_BYTES = 32 * 1024;

/** Non-local agy tools explicitly allow-listed in `agentDefinition` (never touch host files or shell). */
const REMOTE_SAFE_NATIVE_TOOLS = new Set(FULL_TOOLS);
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
const HOOKS_NOT_LOADED_MESSAGE =
  'Antigravity 没有载入 Cindy 为这个任务设置的工具限制，任务已停止。这个任务的文件在另一台电脑上，没有这些限制时它可能使用这台电脑上的工具。\n\n'
  + 'Antigravity did not load the tool restrictions Cindy set for this task, so the task was stopped. '
  + "This task's files are on another computer; without these restrictions it could use tools on this computer.";

function isGuestWorkspaceLaunch(argv) {
  return Array.isArray(argv) && argv.slice(2).includes(GUEST_WORKSPACE_ARG);
}

function isRemoteWorkspaceLaunch(argv) {
  return Array.isArray(argv) && (argv.slice(2).includes(REMOTE_WORKSPACE_ARG) || argv.slice(2).includes(GUEST_WORKSPACE_ARG));
}

/** `1.5.13`, `agy 1.6.0-beta.2`, … at or above `min`. Unreadable versions are not. */
function versionAtLeast(version, min) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(typeof version === 'string' ? version : '');
  if (!match) return false;
  for (let index = 0; index < 3; index += 1) {
    const part = Number(match[index + 1]);
    if (part !== min[index]) return part > min[index];
  }
  return true;
}

function versionSupported(version) {
  return versionAtLeast(version, MIN_VERSION);
}

/** Whether a task on this agy gets the full tool set, subagents included. */
function fullToolsSupported(version) {
  return versionAtLeast(version, FULL_TOOLS_MIN_VERSION);
}

/** Whether the isolated default-agent mode has been checked on this platform. */
function hooksSupported(version, platform = process.platform) {
  return platform === 'darwin' && versionAtLeast(version, HOOKS_MIN_VERSION);
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

/** A private temp directory outside the agent's cwd holding agy's session log. */
function prepareSessionLog(tmpRoot) {
  const root = tmpRoot || os.tmpdir();
  // Windows `.cmd` shims cannot safely quote these characters even inside double quotes.
  if (process.platform === 'win32' && /["%!^&|<>\r\n]/.test(root)) return null;
  try {
    const dir = fs.mkdtempSync(path.join(root, LOG_DIR_PREFIX));
    return { dir, file: path.join(dir, 'session.log') };
  } catch {
    return null;
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
    if (!name.startsWith(LAUNCH_DIR_PREFIX) && !name.startsWith(LOG_DIR_PREFIX)) continue;
    const dir = path.join(root, name);
    try {
      if (now - fs.statSync(dir).mtimeMs > STALE_LAUNCH_DIR_MS) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // someone else's, or still in use
    }
  }
}

/**
 * The agent the session runs under. `tools` is an allow-list of agy's own tools, all of which
 * touch no computer. With the full set, `agents` makes this same definition the one subagent
 * there is, and `inheritCustomizations: false` keeps every other agent out. `mcpServers` only
 * names the servers the agent may use; where they are comes with `session/new`. `instructions`, the
 * client's `systemPrompt` text, ends the body.
 */
function agentDefinition(serverNames, { fullTools = false, instructions = '' } = {}) {
  return [
    '---',
    `name: ${AGENT_NAME}`,
    'description: Works on a project that is on another computer, through the tools Cindy provides.',
    ...(fullTools ? ['inheritCustomizations: false'] : []),
    'tools:',
    ...(fullTools ? FULL_TOOLS : BASIC_TOOLS).map((tool) => `  - ${tool}`),
    ...(fullTools ? ['agents:', `  - ${AGENT_NAME}.md`] : []),
    'mcpServers:',
    ...serverNames.map((name) => `  - name: ${name}`),
    '---',
    remoteInstructions(serverNames, { subagentType: fullTools ? AGENT_NAME : null, instructions }),
  ].join('\n');
}

/**
 * What the model is told in this mode: the body of the restricted agent, or the text the
 * `SessionStart` hook adds. `subagentType` is the subagent type that keeps the MCP servers (none
 * when the agent cannot start subagents); `instructions` is the client's `systemPrompt` text.
 */
function remoteInstructions(serverNames, { subagentType = null, instructions = '' } = {}) {
  const others = serverNames.filter((name) => name !== EXEC_SERVER);
  return [
    'You are a coding agent running inside Cindy. The project you are working on is on another computer, not on this one.',
    '',
    `You have no file or shell tools of your own in this task. Everything that reads or changes files, or runs commands, goes through the MCP server \`${EXEC_SERVER}\` (Bash, BashOutput, KillShell, Read, Write, Edit, NotebookEdit). Those tools run on the computer the project is on.`,
    ...(others.length
      ? [`The other MCP servers of this task (${others.map((name) => `\`${name}\``).join(', ')}) are Cindy's own tools on that computer. List a server's tools before you use them.`]
      : []),
    ...(subagentType
      ? [`To delegate, start a subagent with ${SUBAGENT_TOOL} and the type \`${subagentType}\`; it works the same way, through the same MCP servers.`]
      : []),
    '',
    '- Use the workspace path given in the conversation for file paths and as the directory of commands. Paths on this computer mean nothing for the project.',
    '- Search files with Bash (rg, find, ls). Read a file before you edit it, and make the smallest change that does the job.',
    '- Never say you read, changed or ran something unless the tool call for it succeeded. If a tool is refused or missing, say so instead of guessing.',
    '- Keep answers short and concrete: what you changed, and how you checked it.',
    '',
    ...(instructions ? ['## Additional instructions', '', inertClientText(instructions), ''] : []),
  ].join('\n');
}

/** `@[label](path)` stays text: agy would otherwise read the file at `path` on this computer into the prompt. */
function inertClientText(text) {
  return text.replace(/@\[/g, '@\\[');
}

/**
 * The client's `systemPrompt` of a session open request, as ACP defines it, in the one mode this
 * entry applies (`append`): `{ text }`, empty when there is none, or `{ error }` when it cannot be
 * applied. Then the session must not open (ACP: answer -32602 instead of dropping the text).
 */
function clientSystemPrompt(params) {
  const prompt = isObject(params) ? params.systemPrompt : undefined;
  if (prompt === undefined || prompt === null) return { text: '' };
  if (!isObject(prompt)) return { error: 'systemPrompt must be an object' };
  if (prompt.mode !== 'append') {
    return { error: `systemPrompt mode ${JSON.stringify(prompt.mode)} is not supported; Antigravity only appends ("append")` };
  }
  if (!Array.isArray(prompt.content) || prompt.content.length === 0) {
    return { error: 'systemPrompt content must be a non-empty array' };
  }
  const parts = [];
  for (const block of prompt.content) {
    if (!isObject(block) || block.type !== 'text' || typeof block.text !== 'string') {
      return { error: 'systemPrompt content may only hold text blocks' };
    }
    parts.push(block.text);
  }
  const text = parts.join('\n\n').trim();
  if (Buffer.byteLength(text, 'utf8') > MAX_SYSTEM_PROMPT_BYTES) {
    return { error: `systemPrompt is longer than ${MAX_SYSTEM_PROMPT_BYTES} bytes` };
  }
  return { text };
}

/** The session open request as agy gets it: the entry applies `systemPrompt` itself. */
function withoutSystemPrompt(params) {
  if (!isObject(params) || !('systemPrompt' in params)) return params;
  const rest = { ...params };
  delete rest.systemPrompt;
  return rest;
}

/**
 * The `initialize` answer Cindy gets: `systemPrompt` in append mode, applied by this entry whatever
 * agy itself declares (this mode never hands the field to agy).
 */
function advertiseSystemPrompt(result) {
  if (!isObject(result)) return result;
  const capabilities = isObject(result.agentCapabilities) ? result.agentCapabilities : {};
  const session = isObject(capabilities.sessionCapabilities) ? capabilities.sessionCapabilities : {};
  return {
    ...result,
    agentCapabilities: { ...capabilities, sessionCapabilities: { ...session, systemPrompt: {} } },
  };
}

function writeAgentDefinition(dir, serverNames, options) {
  const agents = path.join(dir, '.agents', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, `${AGENT_NAME}.md`), agentDefinition(serverNames, options), 'utf8');
}

const escapeLiteral = (ch) => (/[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch);
const escapeInClass = (ch) => (/[\\\]^[-]/.test(ch) ? `\\${ch}` : ch);

/**
 * A regular expression (RE2, the syntax agy uses) matching every whole string except the exact
 * `names` and those starting with one of `prefixes`. RE2 has no lookahead, so it walks a trie of
 * the allowed strings: at each point a string leaves the trie (a character no allowed string has
 * there, or an end where none ends) it is matched; below a prefix nothing is.
 */
function everythingExcept(names, prefixes) {
  const node = () => ({ children: new Map(), end: false, open: false });
  const root = node();
  const add = (word, open) => {
    let at = root;
    for (const ch of word) {
      if (at.open) return;
      if (!at.children.has(ch)) at.children.set(ch, node());
      at = at.children.get(ch);
    }
    if (open) {
      at.open = true;
      at.children.clear();
    } else {
      at.end = true;
    }
  };
  for (const prefix of prefixes) add(prefix, true);
  for (const name of names) add(name, false);
  const build = (at) => {
    const keys = [...at.children.keys()];
    const branches = [keys.length ? `[^${keys.map(escapeInClass).join('')}].*` : '.+'];
    for (const [ch, child] of at.children) {
      if (!child.open) branches.push(`${escapeLiteral(ch)}${build(child)}`);
    }
    if (!at.end) branches.push('');
    return `(?:${branches.join('|')})`;
  };
  return `(?s)^${build(root)}$`;
}

/** The tools the hook stops: all but those of the task's MCP servers and agy's harmless own tools. */
function hookMatcher(serverNames) {
  return everythingExcept(FULL_TOOLS, serverNames.map((name) => `mcp_${name.replace(/[^A-Za-z0-9_]/g, '_')}_`));
}

/**
 * The hooks of a session under the default agent (see the top of this file): `PreToolUse` prints a
 * fixed `deny` for every tool `hookMatcher` names, `SessionStart` prints the instructions and leaves
 * the marker. Both only print files written here, from `.agents/`, where agy runs them.
 */
function writeRemoteHooks(dir, serverNames, { instructions = '' } = {}) {
  const agents = path.join(dir, '.agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, HOOK_DENY_FILE), `${JSON.stringify({ decision: 'deny', reason: HOOK_DENY_REASON })}\n`, 'utf8');
  const text = remoteInstructions(serverNames, { subagentType: HOOKS_SUBAGENT_TYPE, instructions });
  fs.writeFileSync(path.join(agents, HOOK_START_FILE), `${JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: text } }] })}\n`, 'utf8');
  const hooks = {
    [HOOK_NAME]: {
      SessionStart: [{ type: 'command', command: `cat ${HOOK_START_FILE} && : > ${HOOK_MARKER_FILE}`, timeout: HOOK_TIMEOUT_SECONDS }],
      PreToolUse: [{
        matcher: hookMatcher(serverNames),
        hooks: [{ type: 'command', command: `cat ${HOOK_DENY_FILE}`, timeout: HOOK_TIMEOUT_SECONDS }],
      }],
    },
  };
  fs.writeFileSync(path.join(agents, 'hooks.json'), `${JSON.stringify(hooks, null, 2)}\n`, 'utf8');
  return path.join(agents, HOOK_MARKER_FILE);
}

/** The HTTP MCP servers of a session request that the agent can be given, in order, by unique name. */
function usableServers(params) {
  const list = isObject(params) && Array.isArray(params.mcpServers) ? params.mcpServers : [];
  const servers = [];
  const dropped = [];
  const normalizedNames = new Set();
  for (const server of list) {
    const name = isObject(server) && typeof server.name === 'string' ? server.name : '';
    const normalized = name.replace(/[^A-Za-z0-9_]/g, '_');
    const usable = isObject(server) && server.type === 'http' && typeof server.url === 'string'
      && SERVER_NAME.test(name) && !normalizedNames.has(normalized) && servers.length < MAX_SERVERS;
    if (usable) { servers.push(server); normalizedNames.add(normalized); }
    else dropped.push(name || '(unnamed)');
  }
  return { servers, dropped };
}

function remoteToolIdentity({ server, tool }) {
  if (server === EXEC_SERVER) return { title: tool, kind: EXEC_TOOL_KINDS[tool] || 'other' };
}

/**
 * A subagent that agy started under another agent than the restricted one. agy refuses those
 * (the call ends `failed`); one that `completed` means it was let through.
 */
function foreignSubagent(toolCall) {
  const input = isObject(toolCall.rawInput) ? toolCall.rawInput : null;
  if (toolCall.name !== SUBAGENT_TOOL || toolCall.status !== 'completed' || !input) return null;
  const type = typeof input.TypeName === 'string' ? input.TypeName : '';
  return type === AGENT_NAME ? null : `${SUBAGENT_TOOL} ${type || '(no type)'}`;
}

/**
 * Keep the remote restriction on native file and command tools after normalizing MCP calls. Under
 * hooks (`options.hooks`) any subagent type may run: the hooks hold its tools in as well.
 */
function inspectToolCall(toolCall, seen, serverNames = [], seenSafeTools = null, options = {}) {
  if (!isObject(toolCall)) return { type: 'other' };
  const mcpCall = normalizeMcpToolCall(toolCall, seen, serverNames, {
    allowLegacyEnvelope: true, toolIdentity: remoteToolIdentity,
  });
  if (mcpCall) return { type: 'mcp', toolCall: mcpCall };
  const subagent = options.hooks ? null : foreignSubagent(toolCall);
  if (subagent) return { type: 'local', tool: subagent };
  const id = typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : null;
  const name = typeof toolCall.name === 'string' ? toolCall.name : '';
  if (REMOTE_SAFE_NATIVE_TOOLS.has(name)) {
    if (id && seenSafeTools) {
      if (seenSafeTools.size >= 2_000 && !seenSafeTools.has(id)) {
        seenSafeTools.delete(seenSafeTools.values().next().value);
      }
      seenSafeTools.add(id);
    }
    return { type: 'other' };
  }
  if (!name && id && seenSafeTools && seenSafeTools.has(id)) return { type: 'other' };
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
 * Runs one task in remote-workspace mode. `host` carries the launcher, the version of the agy it
 * checked and the process helpers of agy-acp.js:
 * { acpArgs, agyVersion, spawnAgy, killTree, exitAfterStderr, describe, exitCodeFor, timings }.
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
  const sessionLog = prepareSessionLog();

  /**
   * `handshake` → `ready` (initialize answered) → `opening` (session process starting) →
   * `warming` (MCP handshakes finishing) → `opening-session` (session open) → `session` (or terminal `failed`).
   */
  let phase = 'handshake';
  let initRequest = null;
  let probe = null;
  let agent = null;
  let agentExited = false;
  let sessionRequest = null;
  let warmup = null;
  /** Ends the warmed sessions agy has not taken over; finish() waits for the same promise. */
  let warmupRelease = null;
  const releaseWarmup = () => {
    if (warmup && !warmupRelease) warmupRelease = warmup.close();
    return warmupRelease || Promise.resolve();
  };
  let finished = false;
  let stopCode = null;
  let forceTimer = null;
  let agentCloseTimer = null;
  let stdinEnded = false;
  const queued = [];
  const seenCalls = new Map();
  const seenSteps = new Map();
  const seenSafeTools = new Set();
  let serverNames = [];
  const steering = createSteeringRelay();
  /** The session runs under the default agent and the hooks (instead of the restricted agent). */
  let hooked = false;
  let resumeInstructions = '';
  /** Under hooks: the marker the `SessionStart` hook leaves; checked once in a new session. */
  let hookMarker = null;
  let promptSent = false;
  /** Under hooks: calls of agy's own tools that its hook stopped, not passed on to Cindy. */
  const heldLocalCalls = new Map();

  const running = (child) => Boolean(child) && child.exitCode === null && child.signalCode === null;

  const stopChild = (child) => {
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      // already closed
    }
    if (!running(child)) return;
    if (process.platform === 'win32') {
      killTree(child);
      return;
    }
    killTree(child, 'SIGTERM');
    setTimeout(() => killTree(child, 'SIGKILL'), timings.signalGrace).unref();
  };

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
  const forwardClientLine = (line, parsed) => {
    const message = parsed === undefined ? parseLine(line) : parsed;
    if (message) {
      const handled = steering.handleClientMessage(message);
      if (handled) {
        if (handled.toClient) {
          for (const item of handled.toClient) toClient(item);
        }
        if (handled.toAgent) {
          for (const item of handled.toAgent) toAgent(item);
        }
        if (!handled.forward) return;
      }
      if (message.method === 'session/prompt') {
        promptSent = true;
        if (resumeInstructions) {
          const params = isObject(message.params) ? message.params : {};
          const prompt = Array.isArray(params.prompt) ? params.prompt : [];
          const instructions = resumeInstructions.replace(/@\[/g, '@\\[');
          resumeInstructions = '';
          const amended = { ...message, params: { ...params, prompt: [
            { type: 'text', text: `Additional instructions for this resumed task:\n${instructions}\n` }, ...prompt,
          ] } };
          errorRelay.request(amended);
          toAgent(amended);
          return;
        }
      }
      errorRelay.request(message);
    }
    toAgentLine(line);
  };

  const finish = (code) => {
    if (finished) return;
    finished = true;
    clearTimeout(forceTimer);
    clearTimeout(agentCloseTimer);
    let exiting = false;
    const done = () => {
      if (exiting) return;
      exiting = true;
      // Warmed MCP sessions agy never took over are ended on the other computer before the process goes.
      const reclaimed = releaseWarmup();
      Promise.race([reclaimed, new Promise((resolve) => setTimeout(resolve, WARMUP_CLOSE_GRACE_MS))])
        .finally(() => process.exit(code));
    };
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
    releaseWarmup();
    terminate();
    if (!running(probe) && !running(agent)) {
      finish(stopCode);
      return;
    }
    setTimeout(() => finish(stopCode), timings.signalGrace + 300).unref();
  };

  /** Ends the task with a reason; nothing of agy is left running. */
  const abandon = (line, sessionId, text = STOPPED_MESSAGE) => {
    if (stopCode !== null || finished) return;
    stopCode = REMOTE_WORKSPACE_EXIT_CODE;
    releaseWarmup();
    if (sessionId) {
      toClient({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } },
      });
    }
    try {
      process.stderr.write(line + '\n');
    } catch {
      // ignore
    }
    terminate();
    if (!running(probe) && !running(agent)) {
      finish(stopCode);
      return;
    }
    setTimeout(() => finish(stopCode), timings.signalGrace + 300).unref();
  };

  const errorRelay = accountErrorRelay(Date.now, {
    ...(sessionLog ? { taskLog: sessionLog.file } : {}),
    ...(host.accountDir ? {
      accountDir: host.accountDir,
      onIsolationViolation: (violation) => {
        try {
          process.stderr.write(isolationViolationLine(violation));
        } catch { /* ignore */ }
        setImmediate(() => stop('SIGTERM'));
      },
    } : {}),
  });

  const launch = (args, launchOptions) => {
    const isolate = !host.accountDir && hooksSupported(host.agyVersion);
    const geminiDir = path.join(dir, '.gemini');
    if (isolate) {
      // Keep conversation history available when Cindy resumes in a fresh launch directory.
      // Configuration and plugins stay in the private Gemini directory.
      const appData = path.join(geminiDir, 'antigravity-cli');
      const original = path.join(os.homedir(), '.gemini', 'antigravity-cli');
      fs.mkdirSync(appData, { recursive: true });
      for (const name of ['conversations', 'brain']) {
        const source = path.join(original, name);
        fs.mkdirSync(source, { recursive: true });
        const link = path.join(appData, name);
        if (!fs.existsSync(link)) fs.symlinkSync(source, link, 'dir');
      }
    }
    const child = spawnAgy(agyPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: dir,
      ...(isolate ? { isolatedGeminiDir: geminiDir } : {}),
      ...(host.accountDir ? { accountDir: host.accountDir } : {}),
      ...(launchOptions?.logFile ? { logFile: launchOptions.logFile } : {}),
    });
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
      toClient(message.result !== undefined
        ? { ...message, result: advertiseSystemPrompt(steering.completeInitializeResult(completeInitializeResult(message.result))) }
        : message);
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
    const instructions = clientSystemPrompt(request.params);
    if (instructions.error) {
      // ACP: instructions that cannot be applied fail the request; agy is not started for it.
      refuse(request.id, -32602, `Antigravity cannot use these instructions: ${instructions.error}.`);
      return;
    }
    const { servers, dropped } = usableServers(request.params);
    if (!servers.some((server) => server.name === EXEC_SERVER)) {
      refuse(request.id, -32602, `Antigravity can only run this task with Cindy's file and command tools (${EXEC_SERVER}), and they were not provided.`);
      return;
    }
    if (dropped.length) {
      process.stderr.write(`[agy-acp] These MCP servers cannot be given to Antigravity and were left out: ${dropped.join(', ')}\n`);
    }
    try {
      const names = servers.map((server) => server.name);
      // The empty Gemini directory was verified with the macOS keychain login. Other account
      // storage and Linux have not been checked; they retain the restricted custom agent.
      hooked = !host.accountDir && hooksSupported(host.agyVersion);
      if (hooked) {
        const marker = writeRemoteHooks(dir, names, { instructions: instructions.text });
        // Only a new session runs `SessionStart`; a resumed one already has the instructions.
        hookMarker = request.method === 'session/new' ? marker : null;
        if (request.method !== 'session/new') resumeInstructions = instructions.text;
      } else {
        writeAgentDefinition(dir, names, { fullTools: fullToolsSupported(host.agyVersion), instructions: instructions.text });
      }
      const hookArgs = hooked ? [...acpArgs, '--gemini-dir', path.join(dir, '.gemini')] : [...acpArgs, '--agent', AGENT_NAME];
      agent = launch(hookArgs, sessionLog ? { logFile: sessionLog.file } : undefined);
      // Started only once agy is: a launch that throws leaves no warm-up running. session/new waits for
      // it (see onAgentLine).
      warmup = warmMcpServers(servers, { log: (text) => process.stderr.write(`[agy-acp] ${text}\n`) });
    } catch (error) {
      releaseWarmup();
      stopChild(agent);
      agent = null;
      refuse(request.id, -32603, `Antigravity could not be started for a task on another computer (${describe(error)}).`);
      return;
    }
    phase = 'opening';
    serverNames = servers.map((server) => server.name);
    sessionRequest = { ...request, params: { ...withoutSystemPrompt(request.params), mcpServers: servers } };
    const current = agent;
    current.on('error', (error) => {
      if (phase === 'failed') return;
      if (current.pid === undefined) {
        agentExited = true;
        finished = true;
        // agy never ran: the warmed sessions are ended (within the same budget as any exit) before leaving.
        Promise.race([releaseWarmup(), new Promise((resolve) => setTimeout(resolve, WARMUP_CLOSE_GRACE_MS))])
          .finally(() => exitAfterStderr(`[agy-acp] Could not start Antigravity at ${agyPath} (${describe(error)}).`, host.notFoundExitCode));
        return;
      }
      process.stderr.write(`[agy-acp] Antigravity process error: ${describe(error)}\n`);
    });
    current.on('exit', (code, signal) => {
      if (phase === 'failed') return;
      agentExited = true;
      const status = stopCode !== null ? stopCode : exitCodeFor(code, signal);
      const endIfActive = () => {
        clearTimeout(agentCloseTimer);
        agentCloseTimer = null;
        if (phase === 'failed') return;
        finish(status);
      };
      agentCloseTimer = setTimeout(endIfActive, timings.flush);
      current.once('close', endIfActive);
    });
    current.stdout.on('data', lineSplitter(onAgentLine));
    // The session process has not seen Cindy's `initialize` yet; its answer stays here.
    toAgent(initRequest);
    if (stdinEnded) endAgentInput();
  };

  const failOpen = (error) => {
    const failedId = sessionRequest.id;
    phase = 'failed';
    sessionRequest = null;
    serverNames = [];
    seenCalls.clear();
    seenSteps.clear();
    seenSafeTools.clear();
    heldLocalCalls.clear();
    hookMarker = null;
    // agy could not open the session: end warmed sessions it never took over at once.
    releaseWarmup();
    clearTimeout(forceTimer);
    forceTimer = null;
    clearTimeout(agentCloseTimer);
    agentCloseTimer = null;
    const rawFailure = { jsonrpc: '2.0', id: failedId, error };
    const trackedFailure = errorRelay.response(rawFailure, (item) => toClient(item));
    toClient(trackedFailure !== rawFailure ? trackedFailure : classifyAccountErrorResponse(rawFailure));
    for (const pending of queued.splice(0)) {
      const pendingMessage = parseLine(pending);
      if (pendingMessage && typeof pendingMessage.method === 'string' && pendingMessage.id !== undefined) {
        refuse(pendingMessage.id, -32600, 'Session failed to open; start a new connection');
      }
    }
    stopChild(agent);
    if (stdinEnded) finish(0);
  };

  const onAgentLine = (line) => {
    if (phase === 'failed') return;
    const message = parseLine(line);
    if (!message) {
      toClientLine(line, agent.stdout);
      return;
    }
    if (phase === 'opening' && message.id === initRequest.id && message.method === undefined) {
      if (message.error) {
        failOpen(message.error);
        return;
      }
      if (finished || stopCode !== null || stdinEnded || agentExited) return;
      phase = 'warming';
      const sendSessionOpen = (mcpServers) => {
        if (finished || stopCode !== null || stdinEnded || agentExited || phase !== 'warming') return;
        const opened = { ...sessionRequest, params: { ...sessionRequest.params, mcpServers } };
        errorRelay.request(opened);
        toAgent(opened);
        phase = 'opening-session';
      };
      warmup.ready.then(sendSessionOpen, () => sendSessionOpen(sessionRequest.params.mcpServers));
      return;
    }
    if (phase === 'opening-session' && message.id === sessionRequest.id && message.method === undefined) {
      if (message.error) {
        failOpen(message.error);
        return;
      }
      const classified = errorRelay.response(message, (item) => toClient(item, agent.stdout));
      if (classified !== message) toClient(classified, agent.stdout);
      else toClientLine(line, agent.stdout);
      sessionRequest = null;
      phase = 'session';
      for (const pending of queued.splice(0)) forwardClientLine(pending);
      return;
    }
    if (message.method === undefined && message.id !== undefined) {
      const flushHeld = (item) => toClient(item, agent.stdout);
      const handled = steering.handleAgentResponse(message);
      if (handled.action === 'handled') {
        for (const item of handled.toClient) toClient(item, agent.stdout);
        for (const item of handled.toAgent) toAgent(item);
        if (handled.turnResponse) {
          toClient(errorRelay.response(handled.turnResponse, flushHeld), agent.stdout);
        }
        return;
      }
      const classified = errorRelay.response(message, flushHeld);
      if (classified !== message) {
        toClient(classified, agent.stdout);
        return;
      }
      toClientLine(line, agent.stdout);
      return;
    }
    const params = isObject(message.params) ? message.params : null;
    const isPermission = message.method === 'session/request_permission' && message.id !== undefined;
    const update = message.method === 'session/update' && params && isObject(params.update) ? params.update : null;
    const isToolUpdate = Boolean(update) && (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update');
    const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : null;
    if (hookMarker && promptSent && (isPermission || (update && MODEL_OUTPUT_UPDATES.has(update.sessionUpdate)))) {
      // The first turn of a new session is under way, so `SessionStart` has run: no marker, no hooks.
      if (!fs.existsSync(hookMarker)) {
        abandon('[agy-acp] Antigravity did not load the hooks that keep its own tools off in a task whose files are on another computer. The task was stopped.',
          sessionId, HOOKS_NOT_LOADED_MESSAGE);
        return;
      }
      hookMarker = null;
    }
    const callId = isToolUpdate && typeof update.toolCallId === 'string' ? update.toolCallId : null;
    if (hooked && callId && heldLocalCalls.has(callId)) {
      if (update.status === 'completed') {
        abandon(`[agy-acp] Antigravity ran its own tool "${update.name || heldLocalCalls.get(callId)}" in a task whose files are on another computer although its hook should have stopped it. The task was stopped.`, sessionId);
      } else if (update.status === 'failed') {
        heldLocalCalls.delete(callId);
      }
      return;
    }
    if (!params || (!isPermission && !isToolUpdate)) {
      if (message.method && message.id !== undefined) steering.handleAgentRequest(message);
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
    const verdict = inspectToolCall(isPermission ? params.toolCall : update, seenCalls, serverNames, seenSafeTools, { hooks: hooked });
    if (verdict.type === 'local' && hooked && !isPermission && update.status !== 'completed') {
      // agy reports the call before its hook answers. The hook stops it (the call ends `failed` and the
      // model is told to use Cindy's tools), so Cindy is not shown it; one that completes ends the task.
      if (callId && update.status !== 'failed') {
        if (heldLocalCalls.size >= 2_000) heldLocalCalls.delete(heldLocalCalls.values().next().value);
        heldLocalCalls.set(callId, verdict.tool);
      }
      return;
    }
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
    if (isPermission) steering.handleAgentRequest(message);
    let outgoing = message;
    let adapted = null;
    if (verdict.type === 'mcp') {
      outgoing = { ...message, params: isPermission ? { ...params, toolCall: verdict.toolCall } : { ...params, update: verdict.toolCall } };
    } else if (isToolUpdate) {
      adapted = adaptAgyNativeToolUpdate(update, {
        elicitationForm: clientSupportsElicitationForm(initRequest?.params),
        seenSteps,
      });
      if (adapted?.action === 'drop') return;
      if (adapted?.action === 'replace') {
        outgoing = { ...message, params: { ...params, update: adapted.update } };
      }
    }
    if (isToolUpdate) {
      const action = errorRelay.notification(outgoing);
      if (action?.flush) {
        for (const item of action.flush) toClient(item, agent.stdout);
      }
    }
    if (verdict.type === 'mcp' || adapted?.action === 'replace') {
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
      forwardClientLine(line, message);
      return;
    }
    if (phase === 'opening' || phase === 'warming' || phase === 'opening-session') {
      if (message && message.method === undefined && message.id !== undefined) {
        steering.handleClientMessage(message);
        toAgentLine(line);
        return;
      }
      queued.push(line);
      return;
    }
    if (!message || typeof message.method !== 'string') return;
    if (message.method === 'initialize' && message.id !== undefined && !initRequest) {
      startProbe(message, line);
    } else if (isSessionOpen(message.method) && message.id !== undefined && phase === 'ready') {
      openSession(message);
    } else if (message.id !== undefined) {
      refuse(message.id, -32600, phase === 'failed' ? 'Session failed to open; start a new connection' : 'Open a session first');
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
    if (phase === 'opening' || phase === 'warming') releaseWarmup();
    if (agent && phase !== 'failed') {
      endAgentInput();
      return;
    }
    // Cindy went away before a session existed or after opening failed.
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
    releaseWarmup();
    for (const child of [probe, agent]) if (running(child)) killTree(child, 'SIGKILL');
    removeLaunchDir(dir);
    if (sessionLog) removeLaunchDir(sessionLog.dir);
  });
}

module.exports = {
  AGENT_NAME,
  EXEC_SERVER,
  FULL_TOOLS,
  FULL_TOOLS_MIN_VERSION,
  GUEST_WORKSPACE_ARG,
  HOOKS_MIN_VERSION,
  MIN_VERSION,
  REMOTE_WORKSPACE_ARG,
  REMOTE_WORKSPACE_EXIT_CODE,
  agentDefinition,
  completeInitializeResult,
  everythingExcept,
  fullToolsSupported,
  hookMatcher,
  hooksSupported,
  inspectToolCall,
  isGuestWorkspaceLaunch,
  isRemoteWorkspaceLaunch,
  startRemoteWorkspace,
  usableServers,
  versionSupported,
};
