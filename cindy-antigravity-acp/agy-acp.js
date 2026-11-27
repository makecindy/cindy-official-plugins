'use strict';

/**
 * ACP engine entry for Cindy (`harnesses[].entry`).
 *
 * Cindy starts this file in raw-stdio mode, one process per task. It starts the
 * locally installed `agy acp` (session settings: no paid credits, no telemetry) and relays ACP,
 * adapting Antigravity's HTTP MCP support and adding steering on compatible versions.
 *   stdin  -> agy stdin    (ACP JSON-RPC from Cindy)
 *   agy stdout -> stdout   (ACP JSON-RPC to Cindy)
 *   agy stderr -> stderr   (diagnostics, ends up in the plugin log)
 * When Cindy closes stdin, agy's stdin is closed and agy exits on its own; when agy
 * exits, this process exits with the same code. When this process is asked to stop,
 * agy (and on Windows its whole process tree) is stopped first so nothing is orphaned.
 *
 * Started with `--cindy-remote-workspace` (the task's files and commands are on another
 * computer), the session runs under an agent without Antigravity's own file and command
 * tools, and the ACP messages are relayed by remote-workspace.js instead of byte for byte.
 * Nothing in the user's Antigravity settings is changed.
 */

const os = require('node:os');
const { attachSteering } = require('./agy-steering.js');
const { accountErrorRelay } = require('./agy-account-errors.js');
const { ACP_ARGS, detectAgy, readCustomAgyConfig, resolveAgy, spawnAgy, killTree } = require('./resolve-agy.js');
const remoteWorkspace = require('./remote-workspace.js');

/** agy normally exits right after stdin closes; force it if it lingers. */
const STDIN_END_GRACE_MS = 5_000;
/** Cindy escalates to a hard kill 2 s after asking us to stop; stay inside that. */
const SIGNAL_GRACE_MS = 1_500;
const FLUSH_TIMEOUT_MS = 2_000;
const NOT_FOUND_EXIT_CODE = 127;

function exitAfterStderr(line, code) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    process.exit(code);
  };
  try {
    process.stderr.write(line + '\n', finish);
  } catch {
    finish();
  }
  setTimeout(finish, 1_000);
}

function describe(error) {
  if (!error) return 'unknown error';
  return error.code ? `${error.code}: ${error.message}` : String(error.message || error);
}

function exitCodeFor(code, signal) {
  if (typeof code === 'number') return code;
  if (signal && os.constants.signals[signal]) return 128 + os.constants.signals[signal];
  return 1;
}

function run(agyPath) {
  let child;
  try {
    child = spawnAgy(agyPath, ACP_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    exitAfterStderr(`[agy-acp] Could not start Antigravity at ${agyPath} (${describe(error)}).`, NOT_FOUND_EXIT_CODE);
    return;
  }

  let childExited = false;
  let finished = false;
  let stopCode = null;
  let forceTimer = null;

  const finish = (code) => {
    if (finished) return;
    finished = true;
    clearTimeout(forceTimer);
    detachSteering();
    const done = () => process.exit(code);
    const flushStdout = () => {
      if (process.stdout.writableLength > 0) process.stdout.write('', done);
      else done();
    };
    setTimeout(done, FLUSH_TIMEOUT_MS);
    // When agy exits by itself, Cindy gets everything it wrote first: part of it can still be
    // inside the relay. After a stop nobody is waiting for it any more.
    if (stopCode !== null || stdoutRelay.readableEnded) flushStdout();
    else stdoutRelay.once('end', flushStdout);
  };

  const terminate = () => {
    if (childExited) return;
    if (process.platform === 'win32') {
      killTree(child);
      return;
    }
    killTree(child, 'SIGTERM');
    setTimeout(() => {
      if (!childExited) killTree(child, 'SIGKILL');
    }, SIGNAL_GRACE_MS).unref();
  };

  const stop = (signal) => {
    if (stopCode !== null) return;
    stopCode = 128 + (os.constants.signals[signal] || os.constants.signals.SIGTERM);
    terminate();
    setTimeout(() => finish(stopCode), SIGNAL_GRACE_MS + 300).unref();
  };

  child.on('error', (error) => {
    if (child.pid === undefined) {
      // Never started (missing file, permission denied): there will be no exit event.
      childExited = true;
      finished = true;
      exitAfterStderr(`[agy-acp] Could not start Antigravity at ${agyPath} (${describe(error)}).`, NOT_FOUND_EXIT_CODE);
      return;
    }
    process.stderr.write(`[agy-acp] Antigravity process error: ${describe(error)}\n`);
  });

  child.on('exit', (code, signal) => {
    childExited = true;
    const status = stopCode !== null ? stopCode : exitCodeFor(code, signal);
    // Let the remaining stdout bytes reach Cindy, but don't wait forever for pipes
    // that a grandchild may still hold open.
    const closeTimer = setTimeout(() => finish(status), FLUSH_TIMEOUT_MS);
    child.once('close', () => {
      clearTimeout(closeTimer);
      finish(status);
    });
  });

  const { detach: detachSteering, relay: stdoutRelay } = attachSteering(
    process.stdin,
    process.stdout,
    child,
    () => stop('SIGTERM'),
    accountErrorRelay(),
  );
  child.stdin.on('error', () => {
    // EPIPE after agy exited; the exit handler takes care of shutting down.
  });
  child.stderr.pipe(process.stderr, { end: false });

  process.stdin.on('end', () => {
    // pipe() has already ended agy's stdin; agy treats that as disconnect.
    if (childExited || forceTimer) return;
    forceTimer = setTimeout(terminate, STDIN_END_GRACE_MS);
    forceTimer.unref();
  });
  process.stdout.on('error', () => {
    // Cindy stopped reading: nobody can receive ACP output any more.
    stop('SIGTERM');
  });

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
  // Last line of defence for any exit path: never leave agy running.
  process.on('exit', () => {
    if (!childExited) killTree(child, 'SIGKILL');
  });
}

const NOT_FOUND_MESSAGE =
  '[agy-acp] The Antigravity CLI (agy) was not found on this computer. Install it from https://antigravity.google, then start the task again.';

function missingAgyMessage() {
  const cfg = readCustomAgyConfig();
  if (cfg.kind === 'configured') {
    return `[agy-acp] The configured Antigravity CLI path (${cfg.path}) was not found or is not executable. Update or clear the custom path in Antigravity plugin settings.`;
  }
  if (cfg.kind === 'invalid') {
    return '[agy-acp] The Antigravity custom path configuration could not be read. Update or clear the custom path in Antigravity plugin settings.';
  }
  return NOT_FOUND_MESSAGE;
}

/**
 * The project is on another computer: only an agy that is known to honour the restricted agent
 * may run the task. Any doubt ends here, before agy sees a single message.
 */
async function runRemoteWorkspace() {
  const found = await detectAgy();
  if (!found.path) {
    exitAfterStderr(missingAgyMessage(), NOT_FOUND_EXIT_CODE);
    return;
  }
  if (!found.available) {
    exitAfterStderr(`[agy-acp] The Antigravity CLI at ${found.path} could not be run (${found.detail || 'unknown reason'}).`, NOT_FOUND_EXIT_CODE);
    return;
  }
  if (!remoteWorkspace.versionSupported(found.version)) {
    exitAfterStderr(
      `[agy-acp] Antigravity ${found.version || '(unknown version)'} cannot run a task whose files are on another computer; it needs ${remoteWorkspace.MIN_VERSION.join('.')} or later. It was not started.`,
      remoteWorkspace.REMOTE_WORKSPACE_EXIT_CODE,
    );
    return;
  }
  remoteWorkspace.startRemoteWorkspace(found.path, {
    acpArgs: ACP_ARGS,
    guest: remoteWorkspace.isGuestWorkspaceLaunch(process.argv),
    spawnAgy,
    killTree,
    exitAfterStderr,
    describe,
    exitCodeFor,
    notFoundExitCode: NOT_FOUND_EXIT_CODE,
    timings: { stdinEndGrace: STDIN_END_GRACE_MS, signalGrace: SIGNAL_GRACE_MS, flush: FLUSH_TIMEOUT_MS },
  });
}

if (remoteWorkspace.isRemoteWorkspaceLaunch(process.argv)) {
  runRemoteWorkspace();
} else {
  const agyPath = resolveAgy();
  if (agyPath) run(agyPath);
  else exitAfterStderr(missingAgyMessage(), NOT_FOUND_EXIT_CODE);
}
