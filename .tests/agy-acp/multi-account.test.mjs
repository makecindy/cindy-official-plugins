// Multi-account isolation, auth, usage, ACP error classification, and remote-workspace tests.
// Run: node --test .tests/cindy-antigravity-acp.test.mjs

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'cindy-antigravity-acp');
const isWin = process.platform === 'win32';

const {
  ACCOUNT_DIR_EXIT_CODE,
  accountDirProblem,
  parseAccountDirArg,
} = require(path.join(root, 'agy-account-dir.js'));
const { emailFromAgyLog } = require(path.join(root, 'agy-account.js'));
const { accountErrorRelay, classifyAccountErrorResponse } = require(path.join(root, 'agy-account-errors.js'));

/** Where the fake agy keeps an isolated account's sign-in. The plugin itself never opens it. */
const tokenFileOf = (accountDir) => path.join(accountDir, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');

/**
 * Fake `agy` supporting isolated `--gemini-dir` + `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`,
 * file-based OAuth tokens, per-account `/usage`, ACP error simulation, and `--agent cindy-remote`.
 * Like agy 1.5.18, it names the signed-in account only in its log (`--log-file`), never over ACP.
 */
const MULTI_FAKE_AGY = `'use strict';
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('agy 1.5.18\\n');
  process.exit(0);
}

const forceFile = process.env.AGY_CLI_FORCE_FILE_TOKEN_STORAGE === '1';
const geminiIdx = args.indexOf('--gemini-dir');
const geminiDir = geminiIdx !== -1 ? args[geminiIdx + 1] : null;
const appDataIdx = args.indexOf('--app-data-dir');
const appDataName = appDataIdx !== -1 ? args[appDataIdx + 1] : 'antigravity-cli';
const logIdx = args.indexOf('--log-file');
const logFile = logIdx !== -1 ? args[logIdx + 1] : null;
function logSignedIn(tok) {
  if (!logFile || !tok || !tok.id_token_email) return;
  fs.appendFileSync(logFile, 'I1127 15:13:05.876398      68 server_oauth.go:221] applyAuthResult: email=' + tok.id_token_email + ', authMethod=consumer, quotaProject=\\n'
    + 'I1127 15:13:05.876413      68 server_oauth.go:226] OAuth: authenticated successfully as ' + tok.id_token_email + '\\n');
}

function tokenPath() {
  if (forceFile && process.env.FAKE_IGNORE_FILE_STORAGE !== '1') {
    const gemRoot = geminiDir || path.join(process.env.HOME || process.env.USERPROFILE || '', '.gemini');
    return path.join(gemRoot, appDataName, 'antigravity-oauth-token');
  }
  return process.env.FAKE_DEFAULT_TOKEN_FILE;
}

function readToken() {
  const file = tokenPath();
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

if (args.at(-1) === '/usage') {
  // Record stdin closed check and env for assertions.
  const tok = readToken();
  if (process.env.FAKE_USAGE_RECORD_FILE) {
    fs.appendFileSync(process.env.FAKE_USAGE_RECORD_FILE, JSON.stringify({
      forceFile,
      home: process.env.HOME,
      userProfile: process.env.USERPROFILE,
      tokenPath: tokenPath(),
      email: tok && tok.id_token_email,
    }) + '\\n');
  }
  if (!tok) {
    process.stderr.write('Authentication required. Please visit the URL to log in:\\n');
    process.exit(1);
  }
  const rem = typeof tok.fake_remaining === 'number' ? tok.fake_remaining : 0.75;
  process.stdout.write(JSON.stringify({
    status: 'SUCCESS',
    num_turns: 0,
    command: {
      name: 'usage',
      data: {
        groups: [{
          name: 'Gemini Models',
          buckets: [{ window: '5h', remaining_fraction: rem, reset_time: '2030-01-01T00:00:00Z' }],
        }],
      },
    },
  }));
  process.exit(0);
}

if (process.env.FAKE_LAUNCH_LOG) {
  fs.appendFileSync(process.env.FAKE_LAUNCH_LOG, JSON.stringify({
    args,
    cwd: process.cwd(),
    home: process.env.HOME,
    forceFile,
    geminiDir,
    appDataName,
  }) + '\\n');
}
if (process.env.FAKE_PIDFILE) fs.writeFileSync(process.env.FAKE_PIDFILE, String(process.pid));

const send = (msg) => process.stdout.write(JSON.stringify(Object.assign({ jsonrpc: '2.0' }, msg)) + '\\n');
let lines = '';
process.stdin.on('data', (chunk) => {
  lines += chunk.toString('utf8');
  let idx;
  while ((idx = lines.indexOf('\\n')) !== -1) {
    const line = lines.slice(0, idx).trim();
    lines = lines.slice(idx + 1);
    if (!line) continue;
    const { id, method, params } = JSON.parse(line);
    if (method === 'initialize') {
      send({
        id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'Antigravity ACP Server', version: '1.5.18' },
          authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }],
          agentCapabilities: { auth: { logout: {} }, sessionCapabilities: { list: {}, resume: {}, close: {} } },
        },
      });
    } else if (method === 'authenticate') {
      if (process.env.FAKE_LOGIN_HANG === '1') continue;
      const spec = process.env.FAKE_NEXT_LOGIN_FILE && fs.existsSync(process.env.FAKE_NEXT_LOGIN_FILE)
        ? JSON.parse(fs.readFileSync(process.env.FAKE_NEXT_LOGIN_FILE, 'utf8'))
        : { email: 'added@example.test', tier: 'Google AI Pro', remaining: 0.6 };
      const file = tokenPath();
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, JSON.stringify({
        access_token: 'secret-access-should-never-leak',
        refresh_token: 'secret-refresh-should-never-leak',
        id_token_email: spec.email,
        tier_display_name: spec.tier,
        fake_remaining: spec.remaining,
      }), { mode: 0o600 });
      if (process.env.FAKE_WRITE_DECOY_ON_AUTH === '1' && geminiDir) {
        const decoyDir = path.join(geminiDir, appDataName);
        fs.mkdirSync(decoyDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(decoyDir, 'decoy-state'), 'non-empty', { mode: 0o600 });
      }
      send({ id, result: { _meta: { antigravity: { tier: { name: spec.tier } } } } });
    } else if (method === 'logout') {
      const file = tokenPath();
      if (file) fs.rmSync(file, { force: true });
      send({ id, result: {} });
    } else if (method === 'session/list' || method === 'session/resume') {
      const tok = readToken();
      if (!tok) {
        send({ id, error: { code: -32000, message: 'Authentication required' } });
      } else {
        logSignedIn(tok);
        send({ id, result: method === 'session/list' ? { sessions: [] }
          : { _meta: { antigravity: { tier: { name: tok.tier_display_name || 'Google AI Pro' } } } } });
      }
    } else if (method === 'session/new') {
      const tok = readToken();
      if (process.env.FAKE_SESSION_NEW_ERROR) {
        send({ id, error: JSON.parse(process.env.FAKE_SESSION_NEW_ERROR) });
      } else if (!tok) {
        send({ id, error: { code: -32000, message: 'Authentication required' } });
      } else {
        send({
          id,
          result: {
            sessionId: 'sess-' + (tok.id_token_email || 'default'),
            _meta: { antigravity: { tier: { name: tok.tier_display_name || 'Google AI Pro' } } },
            configOptions: [
              { id: 'model', category: 'model', type: 'select', currentValue: 'gemini-4-neon',
                options: [{ value: 'gemini-4-neon', name: 'Gemini 4 Neon' }] },
              { id: 'mode', category: 'mode', type: 'select', currentValue: 'default',
                options: [{ value: 'default', name: 'Default' }, { value: 'plan', name: 'Plan' }] },
            ],
          },
        });
      }
    } else if (method === 'session/prompt') {
      if (process.env.FAKE_PROMPT_ERROR) {
        send({ id, error: JSON.parse(process.env.FAKE_PROMPT_ERROR) });
      } else {
        send({ id, result: { stopReason: 'end_turn' } });
      }
    } else {
      send({ id, result: {} });
    }
  }
});
process.stdin.on('end', () => process.stdout.write('', () => process.exit(0)));
`;

function makeMultiFixture(t, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-multi-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const binDir = path.join(dir, 'bin');
  const homeDir = path.join(dir, 'home');
  const configDir = path.join(dir, 'config');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });

  const scriptPath = path.join(binDir, 'fake-agy.cjs');
  fs.writeFileSync(scriptPath, MULTI_FAKE_AGY, 'utf8');
  let agyPath;
  if (isWin) {
    agyPath = path.join(binDir, 'agy.cmd');
    fs.writeFileSync(agyPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8');
  } else {
    agyPath = path.join(binDir, 'agy');
    fs.writeFileSync(agyPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, { mode: 0o755 });
  }

  const defaultTokenFile = path.join(dir, 'default-keychain-token.json');
  const nextLoginFile = path.join(dir, 'next-login.json');
  const launchLog = path.join(dir, 'launches.jsonl');
  const usageLog = path.join(dir, 'usage.jsonl');
  const pidFile = path.join(dir, 'agy.pid');

  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: configDir,
    APPDATA: configDir,
    LOCALAPPDATA: configDir,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    FAKE_DEFAULT_TOKEN_FILE: defaultTokenFile,
    FAKE_NEXT_LOGIN_FILE: nextLoginFile,
    FAKE_LAUNCH_LOG: launchLog,
    FAKE_USAGE_RECORD_FILE: usageLog,
    FAKE_PIDFILE: pidFile,
    ...extraEnv,
  };
  // Pin the custom agy path so a real system agy never interferes.
  const cfgDir = path.join(configDir, 'cindy-antigravity-acp');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({ customPath: agyPath }) + '\n', 'utf8');

  return { dir, homeDir, agyPath, defaultTokenFile, nextLoginFile, launchLog, usageLog, pidFile, env };
}

function startWorker(env) {
  const child = spawn(process.execPath, [path.join(root, 'worker.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  const notifications = [];
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.id !== undefined && message.method === undefined && pending.has(message.id)) {
      const { resolve } = pending.get(message.id);
      pending.delete(message.id);
      resolve(message);
    } else if (message.method) {
      notifications.push(message);
    }
  });
  let nextId = 1;
  return {
    child,
    notifications,
    call(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout calling ${method}`)); }, 15_000);
        pending.set(id, { resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    async close() {
      rl.close();
      try { child.stdin.end(); } catch { /* ignore */ }
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3_000);
        child.once('exit', () => { clearTimeout(t); resolve(); });
      });
    },
  };
}

async function waitFor(predicate, timeoutMs = 4_000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('agy-account-dir helpers', () => {
  test('parseAccountDirArg handles absent, valid, missing value, and duplicate flags', () => {
    assert.deepEqual(parseAccountDirArg(['node', 'agy-acp.js']), { present: false });
    assert.deepEqual(
      parseAccountDirArg(['node', 'agy-acp.js', '--cindy-remote-workspace', '--cindy-account-dir', '/tmp/a']),
      { present: true, accountDir: '/tmp/a' },
    );
    assert.equal(parseAccountDirArg(['node', 'agy-acp.js', '--cindy-account-dir']).present, true);
    assert.ok(parseAccountDirArg(['node', 'agy-acp.js', '--cindy-account-dir']).error);
    assert.ok(parseAccountDirArg(['node', 'agy-acp.js', '--cindy-account-dir', '/a', '--cindy-account-dir', '/b']).error);
  });

  test('accountDirProblem rejects relative, missing, file, and control-char paths, and accepts writable dir', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-dir-check-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'not-a-dir');
    fs.writeFileSync(file, 'x');
    assert.equal(accountDirProblem(dir), null);
    assert.ok(accountDirProblem('relative/dir'));
    assert.ok(accountDirProblem(path.join(dir, 'missing')));
    assert.ok(accountDirProblem(file));
    assert.ok(accountDirProblem(`${dir}\nnewline`));
  });

  test('emailFromAgyLog reads the signed-in email agy logs and nothing that is not a plain address', () => {
    const log = [
      'I1127 15:13:05.100000      68 server.go:10] starting',
      'I1127 15:13:05.876398      68 server_oauth.go:221] applyAuthResult: email=Alice@Example.test, authMethod=consumer, quotaProject=',
      'I1127 15:13:05.876413      68 server_oauth.go:226] OAuth: authenticated successfully as Alice@Example.test',
    ].join('\n');
    assert.equal(emailFromAgyLog(log), 'Alice@Example.test');
    // The last sign-in line wins; either line alone is enough.
    assert.equal(emailFromAgyLog(log + '\nI1127 15:14:00.000000 68 server_oauth.go:226] OAuth: authenticated successfully as bob@example.test\n'), 'bob@example.test');
    assert.equal(emailFromAgyLog('x] applyAuthResult: email=carol@example.test, authMethod=consumer'), 'carol@example.test');
    // A changed log format means no identity, never a wrong one.
    for (const text of ['', 'OAuth: authenticated successfully', 'OAuth: authenticated successfully as <redacted>',
      'OAuth: authenticated successfully as not-an-address', 'OAuth: authenticated successfully as a@b', undefined, null]) {
      assert.equal(emailFromAgyLog(text), undefined);
    }
    // The plugin has no code that opens agy's credential files.
    const accountDirModule = require(path.join(root, 'agy-account-dir.js'));
    assert.equal(accountDirModule.readAccountTokenMeta, undefined);
    assert.equal(accountDirModule.tokenFileOf, undefined);
    for (const file of ['agy-account.js', 'agy-account-dir.js', 'agy-account-errors.js', 'agy-acp.js', 'agy-usage.js', 'agy-verification.js', 'remote-workspace.js', 'worker.js']) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /antigravity-oauth-token|id_token|refresh_token|access_token/, file);
    }
  });
});

describe('agy-account-errors classification', () => {
  test('classifies auth-required, usage-limit (with future reset), and overloaded responses', () => {
    const futureMs = Date.now() + 3_600_000;
    const auth = classifyAccountErrorResponse({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Authentication required' } });
    assert.deepEqual(auth.error.data._meta.cindy, { kind: 'auth-required' });

    const quota = classifyAccountErrorResponse({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32001, message: 'You have exhausted your quota on this model.', data: { resetTime: new Date(futureMs).toISOString() } },
    });
    assert.deepEqual(quota.error.data._meta.cindy, { kind: 'usage-limit', resetsAt: futureMs });

    const prepaid = classifyAccountErrorResponse({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32001, message: "Your organization's prepaid balance is insufficient. Contact your administrator to add funds." },
    });
    assert.deepEqual(prepaid.error.data._meta.cindy, { kind: 'usage-limit' });

    const capacity = classifyAccountErrorResponse({
      jsonrpc: '2.0',
      id: 4,
      error: { code: -32001, message: 'MODEL_CAPACITY_EXHAUSTED: try again later' },
    });
    assert.deepEqual(capacity.error.data._meta.cindy, { kind: 'overloaded' });

    const generic = { jsonrpc: '2.0', id: 5, error: { code: -32602, message: 'Invalid params' } };
    assert.equal(classifyAccountErrorResponse(generic), generic);
  });

  test('accountErrorRelay only classifies responses to session open and session/prompt requests', () => {
    const relay = accountErrorRelay();
    relay.request({ id: 1, method: 'initialize' });
    relay.request({ id: 2, method: 'session/prompt' });
    const initErr = { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Authentication required' } };
    assert.equal(relay.response(initErr), initErr);
    const promptErr = { jsonrpc: '2.0', id: 2, error: { code: -32001, message: 'You have exhausted your quota on this model.' } };
    assert.deepEqual(relay.response(promptErr).error.data._meta.cindy, { kind: 'usage-limit' });
  });
});

describe('multi-account worker, ACP entry, remote workspace, and main.js', () => {
  test('worker signs in two isolated accounts independently, deduplicates same email via fingerprint, and reads per-account usage', async (t) => {
    const fx = makeMultiFixture(t);
    const acct1 = path.join(fx.dir, 'acct 1');
    const acct2 = path.join(fx.dir, 'acct-2');
    fs.mkdirSync(acct1, { recursive: true });
    fs.mkdirSync(acct2, { recursive: true });

    const worker = startWorker(fx.env);
    t.after(() => worker.close());

    // Initially default and both added accounts are signed out.
    assert.deepEqual((await worker.call('accountStatus', { harnessId: 'agy' })).result, { state: 'signed-out' });
    assert.deepEqual((await worker.call('accountStatus', { harnessId: 'agy', accountDir: acct1 })).result, { state: 'signed-out' });
    assert.deepEqual((await worker.call('accountStatus', { harnessId: 'agy', accountDir: acct2 })).result, { state: 'signed-out' });

    // Validation guards on accountLogin.
    assert.deepEqual((await worker.call('accountLogin', { harnessId: 'other', methodId: 'oauth-personal' })).result,
      { ok: false, error: 'unsupported' });
    assert.deepEqual((await worker.call('accountLogin', { harnessId: 'agy', methodId: 'api-key' })).result,
      { ok: false, error: 'unsupported' });
    assert.deepEqual((await worker.call('accountLogin', { harnessId: 'agy', methodId: 'oauth-personal', secret: 'nope' })).result,
      { ok: false, error: 'invalid-secret' });
    assert.equal((await worker.call('accountLogin', { harnessId: 'agy', accountDir: path.join(fx.dir, 'missing'), methodId: 'oauth-personal' })).result.ok, false);

    // Sign in Account 1 (default stays signed out!).
    fs.writeFileSync(fx.nextLoginFile, JSON.stringify({ email: 'one@example.test', tier: 'Google AI Ultra', remaining: 0.9 }));
    assert.deepEqual((await worker.call('accountLogin', { harnessId: 'agy', accountDir: acct1, methodId: 'oauth-personal' })).result, { ok: true });
    assert.ok(worker.notifications.some((n) => n.method === 'account-ready'), 'worker notifies main.js on account login');

    const statusDefault = (await worker.call('accountStatus', { harnessId: 'agy' })).result;
    const status1 = (await worker.call('accountStatus', { harnessId: 'agy', accountDir: acct1 })).result;
    assert.deepEqual(statusDefault, { state: 'signed-out' });
    assert.equal(status1.state, 'signed-in');
    assert.deepEqual(status1.identity, { email: 'one@example.test' });
    assert.equal(status1.plan, 'Google AI Ultra');
    assert.match(status1.fingerprint, /^[a-f0-9]{32}$/);

    // Sign in Account 2 with a DIFFERENT Google account.
    fs.writeFileSync(fx.nextLoginFile, JSON.stringify({ email: 'two@example.test', tier: 'Google AI Pro', remaining: 0.25 }));
    assert.deepEqual((await worker.call('accountLogin', { harnessId: 'agy', accountDir: acct2, methodId: 'oauth-personal' })).result, { ok: true });
    const status2 = (await worker.call('accountStatus', { harnessId: 'agy', accountDir: acct2 })).result;
    assert.equal(status2.state, 'signed-in');
    assert.deepEqual(status2.identity, { email: 'two@example.test' });
    assert.equal(status2.plan, 'Google AI Pro');
    assert.notEqual(status2.fingerprint, status1.fingerprint);

    // agy's original login names its account the same way, so Cindy can tell that one Google account is
    // both the original login and an added one (same fingerprint, whatever the letter case).
    fs.writeFileSync(fx.defaultTokenFile, JSON.stringify({ id_token_email: 'One@Example.test' }));
    const original = (await worker.call('accountStatus', { harnessId: 'agy' })).result;
    assert.equal(original.state, 'signed-in');
    assert.deepEqual(original.identity, { email: 'One@Example.test' });
    assert.equal(original.fingerprint, status1.fingerprint);
    assert.equal(JSON.stringify([original, status1, status2]).includes('secret-'), false, 'no credential leaves the worker');
    fs.rmSync(fx.defaultTokenFile);

    // Per-account usage reads distinct remaining quotas without leaking across accounts.
    const uDefault = (await worker.call('usage', { harnessId: 'agy' })).result;
    const u1 = (await worker.call('usage', { harnessId: 'agy', accountDir: acct1 })).result;
    const u2 = (await worker.call('usage', { harnessId: 'agy', accountDir: acct2 })).result;
    assert.equal(uDefault, null);
    assert.equal(u1.windows[0].remainingPercent, 90);
    assert.equal(u2.windows[0].remainingPercent, 25);

    // listModels falls back to a signed-in added account when default login is signed out.
    const catalog = (await worker.call('listModels', {})).result;
    assert.equal(catalog.supported, true);
    assert.equal(catalog.defaultSignedOut, true);
    assert.equal(catalog.sessionId, undefined);
    assert.deepEqual(catalog.models.map((m) => m.id), ['gemini-4-neon']);
    assert.deepEqual(catalog.modes, ['default', 'plan']);

    // Verify agy acp launches for added accounts preserved real HOME while setting --gemini-dir and AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1.
    const launches = fs.readFileSync(fx.launchLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const acct1Launches = launches.filter((l) => l.geminiDir === path.join(acct1, '.gemini'));
    assert.ok(acct1Launches.length > 0);
    assert.ok(acct1Launches.every((l) => l.forceFile === true && l.home === fx.homeDir && l.appDataName === 'antigravity-cli'));
    const defaultLaunches = launches.filter((l) => l.geminiDir === null);
    assert.ok(defaultLaunches.every((l) => l.forceFile === false));

    // Each sign-in check had agy write its log to a private temporary file of its own, removed afterwards.
    const statusLogs = launches.filter((l) => l.args.includes('--log-file')).map((l) => l.args[l.args.indexOf('--log-file') + 1]);
    assert.ok(statusLogs.length >= 4);
    assert.equal(new Set(statusLogs).size, statusLogs.length);
    assert.ok(statusLogs.every((file) => path.basename(path.dirname(file)).startsWith('cindy-agy-status-')));
    await waitFor(() => statusLogs.every((file) => !fs.existsSync(path.dirname(file))), 8_000, 'status logs removed');
  });

  test('worker accountLoginCancel cancels a hanging sign-in for the matching account directory', async (t) => {
    const fx = makeMultiFixture(t, { FAKE_LOGIN_HANG: '1' });
    const acct = path.join(fx.dir, 'acct-cancel');
    fs.mkdirSync(acct, { recursive: true });
    const worker = startWorker(fx.env);
    t.after(() => worker.close());

    const pendingLogin = worker.call('accountLogin', { harnessId: 'agy', accountDir: acct, methodId: 'oauth-personal' });
    await waitFor(() => fs.existsSync(fx.pidFile), 4_000, 'agy started');
    // Cancelling another account dir does not cancel this one.
    await worker.call('accountLoginCancel', { harnessId: 'agy', accountDir: path.join(fx.dir, 'other') });
    assert.equal(fs.existsSync(fx.pidFile), true);
    // Cancelling the matching account dir settles the login as cancelled.
    assert.deepEqual((await worker.call('accountLoginCancel', { harnessId: 'agy', accountDir: acct })).result, { ok: true });
    assert.deepEqual((await pendingLogin).result, { ok: false, error: 'cancelled' });
  });

  test('agy-acp passes --gemini-dir + file token storage for --cindy-account-dir and classifies quota errors', async (t) => {
    const fx = makeMultiFixture(t, {
      FAKE_PROMPT_ERROR: JSON.stringify({ code: -32001, message: 'You have exhausted your quota on this model.' }),
    });
    const acct = path.join(fx.dir, 'acct-acp');
    fs.mkdirSync(acct, { recursive: true });
    const tokFile = tokenFileOf(acct);
    fs.mkdirSync(path.dirname(tokFile), { recursive: true });
    fs.writeFileSync(tokFile, JSON.stringify({ id_token_email: 'acp@example.test', tier_display_name: 'Google AI Pro' }));

    const child = spawn(process.execPath, [path.join(root, 'agy-acp.js'), '--cindy-account-dir', acct], {
      env: fx.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses = [];
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => { if (line.trim()) responses.push(JSON.parse(line)); });

    const send = (obj) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
    send({ id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    await waitFor(() => responses.some((m) => m.id === 1), 4_000, 'initialize');
    send({ id: 2, method: 'session/new', params: { cwd: fx.dir, mcpServers: [] } });
    await waitFor(() => responses.some((m) => m.id === 2), 4_000, 'session/new');
    const sessionId = responses.find((m) => m.id === 2).result.sessionId;
    send({ id: 3, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: 'hi' }] } });
    await waitFor(() => responses.some((m) => m.id === 3), 4_000, 'session/prompt');

    const promptResp = responses.find((m) => m.id === 3);
    assert.deepEqual(promptResp.error.data._meta.cindy, { kind: 'usage-limit' });

    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));
    rl.close();

    const launches = fs.readFileSync(fx.launchLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(launches[0].geminiDir, path.join(acct, '.gemini'));
    assert.equal(launches[0].forceFile, true);
    assert.equal(launches[0].home, fx.homeDir);
  });

  test('agy-acp exits 77 and refuses to fall back when --cindy-account-dir is missing or invalid', async (t) => {
    const fx = makeMultiFixture(t);
    const missing = path.join(fx.dir, 'does-not-exist');
    const child = spawn(process.execPath, [path.join(root, 'agy-acp.js'), '--cindy-account-dir', missing], {
      env: fx.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    const code = await new Promise((resolve) => child.once('exit', resolve));
    assert.equal(code, ACCOUNT_DIR_EXIT_CODE);
    assert.match(stderr, /refusing to fall back/i);
    assert.equal(fs.existsSync(fx.launchLog), false, 'agy was never launched');
  });

  test('remote-workspace mode honours --cindy-account-dir for both probe and agent and classifies auth errors', async (t) => {
    const fx = makeMultiFixture(t);
    const acct = path.join(fx.dir, 'acct-remote');
    fs.mkdirSync(acct, { recursive: true });
    // Leave acct signed out while default login is signed in to prove zero fallback!
    fs.writeFileSync(fx.defaultTokenFile, JSON.stringify({ id_token_email: 'default@example.test' }));

    const child = spawn(
      process.execPath,
      [path.join(root, 'agy-acp.js'), '--cindy-remote-workspace', '--cindy-guest-workspace', '--cindy-account-dir', acct],
      { env: fx.env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const responses = [];
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => { if (line.trim()) responses.push(JSON.parse(line)); });

    const send = (obj) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
    send({ id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
    await waitFor(() => responses.some((m) => m.id === 1), 4_000, 'remote initialize');
    send({
      id: 2,
      method: 'session/new',
      params: { cwd: fx.dir, mcpServers: [{ name: 'cindy_exec', type: 'http', url: 'http://127.0.0.1:9999/mcp' }] },
    });
    await waitFor(() => responses.some((m) => m.id === 2), 4_000, 'remote session/new');

    const resp = responses.find((m) => m.id === 2);
    assert.equal(resp.error.code, -32000);
    assert.deepEqual(resp.error.data._meta.cindy, { kind: 'auth-required' });

    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));
    rl.close();

    const launches = fs.readFileSync(fx.launchLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(launches.length, 2, 'probe + restricted agent');
    assert.ok(launches.every((l) => l.geminiDir === path.join(acct, '.gemini') && l.forceFile === true));
    assert.ok(launches[1].args.includes('--agent') && launches[1].args.includes('cindy-remote'));
  });

  test('main.js publishes models from an added account on account-ready even when default is signed out, and updates method label on locale change', async () => {
    class Channel { constructor() { this.onmessage = null; } postMessage() {} }
    const puts = [];
    const hostListeners = [];
    let addedSignedIn = false;
    const context = vm.createContext({
      BroadcastChannel: Channel,
      setTimeout,
      clearTimeout,
      cindy: {
        request: async () => ({ ok: true, context: { locale: 'zh-CN', uiLocale: 'zh-CN' } }),
        node: {
          request: async (request) => {
            if (request.method === 'detect') return { ok: true, result: { available: true, version: '1.5.18' } };
            if (request.method === 'listModels') {
              if (!addedSignedIn) return { ok: true, result: { supported: false, reason: 'not-signed-in' } };
              return {
                ok: true,
                result: {
                  supported: true,
                  defaultSignedOut: true,
                  models: [{ id: 'gemini-4-neon', name: 'Gemini 4 Neon' }],
                  modes: ['default', 'plan'],
                  defaultMode: 'default',
                },
              };
            }
            return { ok: false };
          },
        },
        onHostMessage: (listener) => { hostListeners.push(listener); return () => {}; },
      },
      fetch: async (url, init) => {
        if (url === '/kv' && !init) return { ok: true, json: async () => ({}) };
        if (url === '/harnesses') puts.push(JSON.parse(init.body).harnesses[0]);
        return { ok: true, status: 200 };
      },
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });

    await waitFor(() => puts.length >= 1, 3_000, 'initial publish');
    assert.equal(puts[0].available, true);
    assert.deepEqual(puts[0].accounts, { methods: [{ id: 'oauth-personal', label: 'Google 账号', kind: 'browser' }] });

    // An added account signs in while default remains signed out -> worker emits account-ready -> models published.
    addedSignedIn = true;
    hostListeners[0]({ type: 'event', name: 'node-notification', method: 'account-ready', params: {} });
    await waitFor(() => puts.some((e) => e.models && e.models.length === 1), 3_000, 'models published after account-ready');
    assert.equal(puts.at(-1).available, true);
    assert.deepEqual(puts.at(-1).models, [{ id: 'gemini-4-neon', name: 'Gemini 4 Neon' }]);

    // Locale switch updates the account method label.
    hostListeners[0]({ type: 'host-context-changed', ok: true, context: { locale: 'en', uiLocale: 'en' } });
    await waitFor(() => puts.at(-1).accounts.methods[0].label === 'Google account', 3_000, 'locale updated method label');
  });

  // Why: account-ready used to join a listing already in flight. When that listing had started before the
  // sign-in and answered "not signed in", the new account's models were never read.
  test('main.js lists the models again when an account signs in while an older listing is still running', async () => {
    class Channel {
      static all = [];
      constructor(name) { this.name = name; this.onmessage = null; Channel.all.push(this); }
      postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        for (const other of Channel.all) {
          if (other !== this && other.name === this.name && other.onmessage) setTimeout(() => other.onmessage({ data: copy }), 0);
        }
      }
    }
    const puts = [];
    const nodeCalls = [];
    const hostListeners = [];
    let finishFirstListing = null;
    const context = vm.createContext({
      BroadcastChannel: Channel,
      setTimeout,
      clearTimeout,
      cindy: {
        request: async () => ({ ok: true, context: { locale: 'en', uiLocale: 'en' } }),
        node: {
          request: async (request) => {
            nodeCalls.push(request.method);
            if (request.method === 'detect') return { ok: true, result: { available: true, version: '1.5.18' } };
            if (request.method === 'listModels' && !finishFirstListing) {
              // The start-up listing began before any account was signed in and answers late.
              return new Promise((resolve) => {
                finishFirstListing = () => resolve({ ok: true, result: { supported: false, reason: 'not-signed-in' } });
              });
            }
            if (request.method === 'listModels') {
              return { ok: true, result: { supported: true, defaultSignedOut: true, models: [{ id: 'gemini-4-neon', name: 'Gemini 4 Neon' }] } };
            }
            return { ok: false };
          },
        },
        onHostMessage: (listener) => { hostListeners.push(listener); return () => {}; },
      },
      fetch: async (url, init) => {
        if (url === '/kv' && !init) return { ok: true, json: async () => ({}) };
        if (url === '/harnesses') puts.push(JSON.parse(init.body).harnesses[0]);
        return { ok: true, status: 200 };
      },
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: 'main.js' });
    await waitFor(() => finishFirstListing, 3_000, 'start-up listing in flight');

    // The account signs in while that listing is still running; only then does the listing answer.
    hostListeners[0]({ type: 'event', name: 'node-notification', method: 'account-ready', params: {} });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(nodeCalls.filter((method) => method === 'listModels').length, 1, 'no second listing joins the one in flight');
    finishFirstListing();
    await waitFor(() => puts.some((entry) => entry.models && entry.models.length === 1), 3_000, 'models listed again after the stale answer');
    assert.equal(nodeCalls.filter((method) => method === 'listModels').length, 2);
    assert.deepEqual(puts.at(-1).models, [{ id: 'gemini-4-neon', name: 'Gemini 4 Neon' }]);

    // The settings page learns from the next check that an account is signed in, and is offered no account action.
    const page = new Channel('cindy-antigravity-acp');
    const received = [];
    page.onmessage = (event) => received.push(event.data);
    page.postMessage({ type: 'detect-request', reqId: 'r1' });
    page.postMessage({ type: 'account-request', reqId: 'a1', op: 'logout' });
    page.postMessage({ type: 'harness-usage-request' });
    await waitFor(() => received.some((message) => message.type === 'detect-result'), 3_000, 'detect result');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const snapshot = received.find((message) => message.type === 'detect-result').snapshot;
    assert.equal(snapshot.signInRequired, false);
    assert.equal(snapshot.account, undefined);
    assert.deepEqual(received.filter((message) => /^account-|^harness-usage/.test(message.type)), []);
    assert.ok(!nodeCalls.some((method) => ['login', 'logout', 'cancelLogin', 'account', 'usage'].includes(method)));
  });

  test('isolation guard aborts login before overwriting default keyring when agy ignores file storage', async (t) => {
    const fx = makeMultiFixture(t, { FAKE_IGNORE_FILE_STORAGE: '1' });
    const originalDefault = JSON.stringify({ id_token_email: 'default@example.test', tier_display_name: 'Google AI Ultra' });
    fs.writeFileSync(fx.defaultTokenFile, originalDefault);
    fs.writeFileSync(fx.nextLoginFile, JSON.stringify({ email: 'new@example.test', tier: 'Google AI Pro' }));
    const acct = path.join(fx.dir, 'acct-ignored');
    fs.mkdirSync(acct, { recursive: true });

    const worker = startWorker(fx.env);
    t.after(() => worker.close());

    // Pre-login probe catches that the empty isolated directory sees the default login, and aborts before authenticate.
    const loginResult = (await worker.call('accountLogin', { harnessId: 'agy', accountDir: acct, methodId: 'oauth-personal' })).result;
    assert.equal(loginResult.ok, false);
    assert.equal(loginResult.error, 'failed');
    assert.match(loginResult.message, /ignored isolated account storage/i);
    assert.equal(fs.readFileSync(fx.defaultTokenFile, 'utf8'), originalDefault, 'default keyring login was not overwritten');
    assert.equal(worker.notifications.some((n) => n.method === 'account-ready'), false);

    // accountStatus and usage refuse to attribute the default login or quota to an isolated dir with no isolated store files.
    assert.deepEqual((await worker.call('accountStatus', { harnessId: 'agy', accountDir: acct })).result, { state: 'signed-out' });
    assert.equal((await worker.call('usage', { harnessId: 'agy', accountDir: acct })).result, null);
  });

  test('isolation guard rejects login when default was signed out and agy writes outside accountDir', async (t) => {
    // Even if agy writes a decoy file in appDataDir, the post-login empty-dir probe catches global keyring leakage.
    const fx = makeMultiFixture(t, { FAKE_IGNORE_FILE_STORAGE: '1', FAKE_WRITE_DECOY_ON_AUTH: '1' });
    fs.writeFileSync(fx.nextLoginFile, JSON.stringify({ email: 'leaked@example.test', tier: 'Google AI Pro' }));
    const acct = path.join(fx.dir, 'acct-leaked');
    fs.mkdirSync(acct, { recursive: true });

    const worker = startWorker(fx.env);
    t.after(() => worker.close());

    const loginResult = (await worker.call('accountLogin', { harnessId: 'agy', accountDir: acct, methodId: 'oauth-personal' })).result;
    assert.equal(loginResult.ok, false);
    assert.equal(loginResult.error, 'failed');
    assert.match(loginResult.message, /leaked the sign-in outside/i);
    assert.equal(worker.notifications.some((n) => n.method === 'account-ready'), false);
  });

  test('isolation guard rejects login when agy writes no sign-in file into accountDir', async (t) => {
    const fx = makeMultiFixture(t, { FAKE_IGNORE_FILE_STORAGE: '1' });
    fs.writeFileSync(fx.nextLoginFile, JSON.stringify({ email: 'nofile@example.test', tier: 'Google AI Pro' }));
    const acct = path.join(fx.dir, 'acct-nofile');
    fs.mkdirSync(acct, { recursive: true });

    const worker = startWorker(fx.env);
    t.after(() => worker.close());

    const loginResult = (await worker.call('accountLogin', { harnessId: 'agy', accountDir: acct, methodId: 'oauth-personal' })).result;
    assert.equal(loginResult.ok, false);
    assert.equal(loginResult.error, 'failed');
    assert.match(loginResult.message, /did not store the sign-in inside the isolated account directory/i);
  });

  test('agy-acp and remote-workspace block leaked session/new on empty accountDir when agy falls back to default login', async (t) => {
    const fx = makeMultiFixture(t, { FAKE_IGNORE_FILE_STORAGE: '1' });
    fs.writeFileSync(fx.defaultTokenFile, JSON.stringify({ id_token_email: 'default@example.test', tier_display_name: 'Google AI Ultra' }));

    for (const extraArgs of [[], ['--cindy-remote-workspace']]) {
      const acct = path.join(fx.dir, extraArgs.length ? 'acct-leak-remote' : 'acct-leak-local');
      fs.mkdirSync(acct, { recursive: true });
      const child = spawn(process.execPath, [path.join(root, 'agy-acp.js'), ...extraArgs, '--cindy-account-dir', acct], {
        env: fx.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const exited = new Promise((resolve) => child.once('exit', resolve));
      const responses = [];
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line) => { if (line.trim()) responses.push(JSON.parse(line)); });

      const send = (obj) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
      send({ id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
      await waitFor(() => responses.some((m) => m.id === 1), 4_000, 'initialize');
      send({
        id: 2,
        method: 'session/new',
        params: {
          cwd: fx.dir,
          mcpServers: extraArgs.length ? [{ name: 'cindy_exec', type: 'http', url: 'http://127.0.0.1:9999/mcp' }] : [],
        },
      });
      await waitFor(() => responses.some((m) => m.id === 2), 4_000, 'blocked session/new');

      const resp = responses.find((m) => m.id === 2);
      assert.equal(resp.result, undefined, 'leaked session result must never reach Cindy');
      assert.equal(resp.error.code, -32000);
      assert.deepEqual(resp.error.data._meta.cindy, { kind: 'auth-required' });

      await exited;
      rl.close();
      assert.match(stderr, /without isolated sign-in files/i);
    }
  });
});
