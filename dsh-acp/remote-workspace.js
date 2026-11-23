'use strict';

/**
 * Remote-workspace mode of the engine entry (`--cindy-remote-workspace`).
 *
 * Cindy passes that argument when the task's files and commands are on another computer of the
 * same account. dsh's own file and command tools would act on this computer, where the project
 * is not, so the entry starts dsh with an overlay that switches them off (see
 * remote-workspace.patch.yml) and leaves that work to the tools Cindy provides over MCP.
 *
 * Two rules keep this safe:
 *  - Nothing persistent changes. The overlay is a `--patch` argument of this one launch; the
 *    user's dsh profile, login and settings are untouched, and dsh started any other way keeps
 *    all of its tools.
 *  - It fails closed. Before the real launch the composed configuration is read back with
 *    `--dump-config`; if any tool that is not known to be harmless here is still enabled (for
 *    example a tool added by a newer dsh or by a plugin in the user's profile), the entry
 *    refuses to start instead of running with a tool that would touch this computer.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REMOTE_WORKSPACE_ARG = '--cindy-remote-workspace';
const GUEST_WORKSPACE_ARG = '--cindy-guest-workspace';
const PATCH_FILE = 'remote-workspace.patch.yml';
const GUEST_PATCH_FILE = 'guest-workspace.patch.yml';
/** dsh resolves `--patch` against its working directory, so the argument stays a package constant. */
const LAUNCH_ARGS = Object.freeze(['--profile', 'acp', '--patch', PATCH_FILE]);
const GUEST_LAUNCH_ARGS = Object.freeze(['--profile', 'acp', '--patch', GUEST_PATCH_FILE]);
const CHECK_ARGS = Object.freeze([...LAUNCH_ARGS, '--dump-config']);
const GUEST_CHECK_ARGS = Object.freeze([...GUEST_LAUNCH_ARGS, '--dump-config']);
const CHECK_TIMEOUT_MS = 10_000;
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;

/**
 * Tools that neither touch this computer's files nor run commands or code here: task lists and
 * goals, sub-agents and their shared task board (they get the same tools as the agent), web
 * access (network only), the skill catalogue (the user's own dsh skills, read-only) and the tool
 * plumbing itself. Checked against dsh 0.2.2-rc.1 and 0.2.2-rc.5.
 */
const SAFE_TOOL_IDS = new Set([
  'tool-skill',
  'tool-agent-team',
  'tool-subagent-control',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-result-pruner',
  'tool-todo',
  'tool-goal',
  'tool-web',
  'tool-executor-native',
]);

/**
 * In `--cindy-guest-workspace` mode (cross-account provider sharing), the sharer's local skills,
 * instructions, slash commands and local HTTP fetch must also be disabled.
 */
const GUEST_SAFE_TOOL_IDS = new Set([
  'tool-agent-team',
  'tool-subagent-control',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-result-pruner',
  'tool-todo',
  'tool-goal',
  'tool-executor-native',
]);
const GUEST_MUST_DISABLE_IDS = new Set([
  'plugin-manager',
  'agent-instructions',
  'skill',
  'skill-filesystem',
  'commands',
  'web-fetch-http',
]);

function isGuestWorkspaceLaunch(argv) {
  return Array.isArray(argv) && argv.slice(2).includes(GUEST_WORKSPACE_ARG);
}

function isRemoteWorkspaceLaunch(argv) {
  return Array.isArray(argv) && (argv.slice(2).includes(REMOTE_WORKSPACE_ARG) || argv.slice(2).includes(GUEST_WORKSPACE_ARG));
}

function patchFileFor(options) {
  return options && options.guest ? GUEST_PATCH_FILE : PATCH_FILE;
}

function launchArgsFor(options) {
  return options && options.guest ? GUEST_LAUNCH_ARGS : LAUNCH_ARGS;
}

/**
 * A private, empty directory dsh runs in for this task, holding a copy of the overlay. dsh takes
 * its default workspace root from the working directory; an empty directory of our own keeps
 * anything it might still do away from the user's files.
 */
function prepareLaunchDir(tmpRoot, options) {
  const patchFile = patchFileFor(options);
  const dir = fs.mkdtempSync(path.join(tmpRoot || os.tmpdir(), 'cindy-dsh-remote-'));
  try {
    fs.copyFileSync(path.join(__dirname, patchFile), path.join(dir, patchFile));
  } catch (error) {
    removeLaunchDir(dir);
    throw error;
  }
  return dir;
}

function removeLaunchDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort: an empty directory in the temp folder
  }
}

function unquote(value) {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Reads the composed tree printed by `--dump-config` (a YAML list of `- id: …` entries) and
 * returns what must stop a remote-workspace launch: the ids of `tool-*` entries that are still
 * enabled and not known to be harmless (plus sharer-private modules in guest mode). A module
 * counts as off only when its entry says `disabled: true` literally; a computed `disabled` could
 * turn out true or false.
 * `entries` is the number of entries seen, so a caller can tell an unreadable dump from a clean one.
 */
function inspectComposedConfig(text, options) {
  const guest = Boolean(options && options.guest);
  const safeTools = guest ? GUEST_SAFE_TOOL_IDS : SAFE_TOOL_IDS;
  const offenders = [];
  let entries = 0;
  let current = null;
  const flush = () => {
    if (current && !current.disabled && !safeTools.has(current.id)) offenders.push(current.id);
    current = null;
  };
  for (const line of String(text).split(/\r?\n/)) {
    const start = /^- id:\s*(\S+)\s*$/.exec(line);
    if (start) {
      flush();
      entries += 1;
      const id = unquote(start[1]);
      const tracked = id.startsWith('tool-') || (guest && GUEST_MUST_DISABLE_IDS.has(id));
      current = tracked ? { id, disabled: false } : null;
      continue;
    }
    if (/^- /.test(line)) {
      // An entry without a readable id: nothing can be said about it.
      flush();
      entries += 1;
      offenders.push('(unreadable entry)');
      continue;
    }
    if (current && /^ {2}disabled:\s*true\s*$/.test(line)) current.disabled = true;
  }
  flush();
  return { entries, offenders };
}

/**
 * Runs the check launch and resolves to `{ ok: true }` or `{ ok: false, detail }`. `spawnDsh` is
 * the launcher from resolve-dsh.js (constant arguments only).
 */
function verifyRemoteWorkspace(spawnDsh, dshPath, cwd, timeoutMs, options) {
  const guest = Boolean(options && options.guest);
  const checkArgs = guest ? GUEST_CHECK_ARGS : CHECK_ARGS;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnDsh(dshPath, checkArgs, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    } catch (error) {
      resolve({ ok: false, detail: `could not run dsh (${error && error.message ? error.message : error})` });
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      settle({ ok: false, detail: 'dsh did not print its configuration in time' });
    }, timeoutMs || CHECK_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_CONFIG_BYTES) {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        settle({ ok: false, detail: 'dsh printed an unexpectedly large configuration' });
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', () => { /* diagnostics of the check run are not relayed */ });
    child.on('error', (error) => settle({ ok: false, detail: `could not run dsh (${error.message})` }));
    child.on('close', (code) => {
      if (code !== 0) {
        settle({ ok: false, detail: `this dsh version does not accept the remote-workspace overlay (exit code ${code})` });
        return;
      }
      const { entries, offenders } = inspectComposedConfig(Buffer.concat(chunks).toString('utf8'), { guest });
      if (entries === 0) {
        settle({ ok: false, detail: 'the configuration dsh printed could not be read' });
      } else if (offenders.length > 0) {
        settle({ ok: false, detail: `these dsh tools would still act on this computer: ${[...new Set(offenders)].join(', ')}` });
      } else {
        settle({ ok: true });
      }
    });
  });
}

module.exports = {
  GUEST_LAUNCH_ARGS,
  GUEST_PATCH_FILE,
  GUEST_WORKSPACE_ARG,
  LAUNCH_ARGS,
  PATCH_FILE,
  REMOTE_WORKSPACE_ARG,
  inspectComposedConfig,
  isGuestWorkspaceLaunch,
  isRemoteWorkspaceLaunch,
  launchArgsFor,
  patchFileFor,
  prepareLaunchDir,
  removeLaunchDir,
  verifyRemoteWorkspace,
};
