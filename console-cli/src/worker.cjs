'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const INSTALL_URL = 'https://console.tapsvc.com/cli/console-cli/install.sh';
const CONTEXT_ARGS = ['--context=prod'];
const MAX_OUTPUT_BYTES = 768 * 1024;
const MAX_DIAGNOSTIC_CHARS = 600;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FIXED_COMMANDS = new Set([
  'auth',
  'completion',
  'deploy',
  'schema',
  'skill',
  'upgrade',
  'version',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(message, execution) {
  const result = { ok: false, message: String(message || 'Console CLI 操作失败') };
  if (execution) result.execution = execution;
  return result;
}

function installMessage() {
  return `未检测到本机 Console CLI。请先手动安装：${INSTALL_URL}`;
}

function commandParts(value, required) {
  if (typeof value !== 'string') throw new Error('command 必须是小写点分 CLI 命令路径');
  const command = value.trim();
  if (!required && command === '') return [];
  const parts = command.split('.');
  if (parts.length === 0 || parts.length > 8 || parts.some((part) => !/^[a-z][a-z0-9-]{0,63}$/.test(part))) {
    throw new Error('command 必须是 1–8 段小写点分路径，例如 deployment.logs');
  }
  return parts;
}

function commandString(parts) {
  return parts.join('.');
}

function cliCandidates() {
  const candidates = [];
  const home = typeof process.env.HOME === 'string' ? process.env.HOME.trim() : '';
  if (home) {
    candidates.push(path.join(home, '.local', 'bin', 'console-cli'));
    candidates.push(path.join(home, 'bin', 'console-cli'));
  }
  candidates.push('/opt/homebrew/bin/console-cli', '/usr/local/bin/console-cli', '/usr/bin/console-cli');
  const pathValue = typeof process.env.PATH === 'string' ? process.env.PATH : '';
  for (const entry of pathValue.split(path.delimiter)) {
    if (entry) candidates.push(path.join(entry, process.platform === 'win32' ? 'console-cli.exe' : 'console-cli'));
  }
  return [...new Set(candidates)];
}

function resolveCliPath() {
  for (const candidate of cliCandidates()) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_error) {
      // Continue through the fixed installation locations.
    }
  }
  return null;
}

function redactDiagnostic(value) {
  return String(value || '')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer <redacted>')
    .replace(/\b(?:token|access[_-]?token|refresh[_-]?token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '<credential>=<redacted>')
    .replace(/(?:\/Users|\/home|\/private|\/tmp|[A-Za-z]:\\)[^\s"']+/g, '<local-path>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DIAGNOSTIC_CHARS);
}

function runCli(args, options = {}) {
  const executable = resolveCliPath();
  if (!executable) return Promise.resolve({ ok: false, kind: 'missing', started: false, diagnostic: '' });

  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 60000;
  const heartbeatMs = Number.isInteger(options.heartbeatMs) ? options.heartbeatMs : 0;
  return new Promise((resolve) => {
    let heartbeat = null;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (heartbeat) clearInterval(heartbeat);
      resolve(result);
    };
    try {
      execFile(executable, args, {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        shell: false,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (!error) {
          finish({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || ''), started: true });
          return;
        }
        const timedOut = error.code === 'ETIMEDOUT' || error.killed === true || error.signal === 'SIGTERM';
        const tooLarge = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        finish({
          ok: false,
          kind: tooLarge ? 'output_limit' : timedOut ? 'timeout' : 'exit',
          started: true,
          code: error.code,
          signal: error.signal,
          diagnostic: redactDiagnostic(`${stderr || ''}\n${stdout || ''}`),
        });
      });
      if (heartbeatMs > 0) {
        heartbeat = setInterval(() => {
          process.stderr.write('console-cli is still running; waiting for completion\n');
        }, heartbeatMs);
        heartbeat.unref?.();
      }
    } catch (error) {
      finish({
        ok: false,
        kind: error && error.code === 'ENOENT' ? 'missing' : 'exit',
        started: false,
        diagnostic: redactDiagnostic(error && error.message),
      });
    }
  });
}

function parseOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

function failureMessage(run, fallback) {
  if (run.kind === 'missing') return installMessage();
  if (run.kind === 'timeout') return 'Console CLI 执行超时；登录可能仍在等待浏览器授权，请先调用 console_cli_status 确认状态。';
  if (run.kind === 'output_limit') return 'Console CLI 返回内容过大，已停止读取；请缩小查询范围后重试。';
  const detail = run.diagnostic;
  const lower = detail.toLowerCase();
  if (/not logged in|api token is required|run `console-cli auth login`|cached access token has expired/.test(lower)) {
    return 'Console CLI 尚未登录，请在用户明确要求后调用 console_cli_login。';
  }
  if (/unknown command|unknown flag|parse --params|parse --json|request body is required|schema .* not found|manifest .* unavailable/.test(lower)) {
    return detail || fallback;
  }
  if (/401|unauthorized/.test(lower)) return 'Console CLI 登录已失效，请调用 console_cli_login 重新授权。';
  if (/403|forbidden|permission denied/.test(lower)) return 'Console CLI 当前账号没有执行该操作所需的 Console 权限。';
  return detail ? `${fallback}: ${detail}` : fallback;
}

function failureResult(run, fallback, execution) {
  return fail(failureMessage(run, fallback), execution);
}

function classifyExecution(run, method) {
  if (!MUTATING_METHODS.has(method)) return undefined;
  const lower = String(run.diagnostic || '').toLowerCase();
  if (/not logged in|api token is required|cached access token has expired|unknown command|unknown flag|parse --params|parse --json|request body is required|401|unauthorized|403|forbidden|permission denied/.test(lower)) {
    return 'not_executed';
  }
  return 'unknown';
}

function normalizeLoginArgs(params) {
  const input = isObject(params) ? params : {};
  const hasLevel = input.permission_level !== undefined;
  const hasProfile = input.permission_profile !== undefined;
  if (hasLevel && hasProfile) throw new Error('permission_level 和 permission_profile 不能同时传');
  const result = {};
  if (hasLevel) {
    if (!['readonly', 'low-risk', 'sensitive'].includes(input.permission_level)) {
      throw new Error('permission_level 必须是 readonly、low-risk 或 sensitive');
    }
    result.permission_level = input.permission_level;
  }
  if (hasProfile) {
    if (typeof input.permission_profile !== 'string' || !/^[^\u0000-\u001F\u007F]{1,128}$/.test(input.permission_profile.trim())) {
      throw new Error('permission_profile 必须是 1–128 位非空 profile 名称');
    }
    result.permission_profile = input.permission_profile.trim();
  }
  return result;
}

async function status() {
  const version = await runCli(['version', ...CONTEXT_ARGS]);
  if (!version.ok) return failureResult(version, 'Console CLI 状态查询失败');
  const auth = await runCli(['auth', 'status', ...CONTEXT_ARGS]);
  if (!auth.ok) return failureResult(auth, 'Console CLI 登录状态查询失败');
  const versionData = parseOutput(version.stdout);
  const authData = parseOutput(auth.stdout);
  const loggedIn = isObject(authData) && typeof authData.email === 'string' || isObject(authData) && typeof authData.authorization_mode === 'string';
  const result = {
    installed: true,
    context: 'prod',
    cli_version: isObject(versionData) && typeof versionData.version === 'string' ? versionData.version : String(versionData || 'unknown'),
    logged_in: loggedIn,
  };
  if (loggedIn && isObject(authData)) {
    for (const key of ['email', 'authorization_mode', 'permission_level', 'permission_profile']) {
      if (typeof authData[key] === 'string' && authData[key]) result[key] = authData[key];
    }
  }
  return { ok: true, result };
}

async function login(params) {
  let loginArgs;
  try {
    loginArgs = normalizeLoginArgs(params);
  } catch (error) {
    return fail(error.message, 'not_executed');
  }
  const args = ['auth', 'login', ...CONTEXT_ARGS];
  if (loginArgs.permission_level) args.push('--permission-level', loginArgs.permission_level);
  if (loginArgs.permission_profile) args.push('--permission-profile', loginArgs.permission_profile);
  const run = await runCli(args, { timeoutMs: LOGIN_TIMEOUT_MS, heartbeatMs: 10000 });
  if (!run.ok) {
    if (run.kind === 'missing') return failureResult(run, 'Console CLI 登录失败', 'not_executed');
    return failureResult(run, 'Console CLI 登录失败', 'unknown');
  }
  const current = await status();
  if (!current.ok) return fail('Console CLI 登录命令已结束，但登录状态无法确认；请调用 console_cli_status。', 'unknown');
  if (!current.result.logged_in) return fail('Console CLI 登录命令已结束，但当前仍未登录；请调用 console_cli_status。', 'unknown');
  return current;
}

async function discover(params) {
  const mode = isObject(params) && params.mode !== undefined ? params.mode : 'overview';
  if (mode !== 'overview' && mode !== 'skills') return fail('mode 必须是 overview 或 skills', 'not_executed');
  const command = mode === 'skills' ? ['skill', 'list'] : ['skill', 'show', 'overview'];
  const run = await runCli([...command, ...CONTEXT_ARGS]);
  if (!run.ok) return failureResult(run, 'Console CLI discovery 失败');
  return { ok: true, result: { mode, content: parseOutput(run.stdout) } };
}

async function help(params) {
  let parts;
  try {
    parts = commandParts(isObject(params) ? params.command || '' : '', false);
  } catch (error) {
    return fail(error.message, 'not_executed');
  }
  const run = await runCli([...parts, '--help', ...CONTEXT_ARGS]);
  if (!run.ok) return failureResult(run, 'Console CLI 帮助查询失败', 'not_executed');
  return { ok: true, result: { command: commandString(parts), content: parseOutput(run.stdout) } };
}

async function schema(params) {
  let parts;
  try {
    parts = commandParts(isObject(params) ? params.command : undefined, true);
  } catch (error) {
    return fail(error.message, 'not_executed');
  }
  const input = isObject(params) ? params : {};
  if (input.resolve_refs !== undefined && typeof input.resolve_refs !== 'boolean') return fail('resolve_refs 必须是 boolean', 'not_executed');
  const args = ['schema', commandString(parts)];
  if (input.resolve_refs === true) args.push('--resolve-refs');
  args.push(...CONTEXT_ARGS);
  const run = await runCli(args);
  if (!run.ok) return failureResult(run, 'Console CLI schema 查询失败', 'not_executed');
  return { ok: true, result: parseOutput(run.stdout) };
}

async function call(params) {
  let parts;
  try {
    parts = commandParts(isObject(params) ? params.command : undefined, true);
  } catch (error) {
    return fail(error.message, 'not_executed');
  }
  if (FIXED_COMMANDS.has(parts[0])) return fail(`console_cli_call 只允许 manifest-backed 命令，不能调用 ${parts[0]}；请使用对应的专用 discovery/login 工具。`, 'not_executed');
  const input = isObject(params) ? params : {};
  const command = commandString(parts);
  const schemaRun = await runCli(['schema', command, ...CONTEXT_ARGS]);
  if (!schemaRun.ok) return failureResult(schemaRun, '调用前无法读取 Console CLI schema', 'not_executed');
  const schemaData = parseOutput(schemaRun.stdout);
  const method = isObject(schemaData) && typeof schemaData.httpMethod === 'string'
    ? schemaData.httpMethod.toUpperCase()
    : 'GET';
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) return fail('Console CLI schema 返回了不支持的 HTTP method', 'not_executed');
  const cliArgs = [...parts];
  const cliParams = input.params === undefined ? {} : input.params;
  if (!isObject(cliParams)) return fail('params 必须是对象', 'not_executed');
  let paramsJson;
  try {
    paramsJson = JSON.stringify(cliParams);
  } catch (_error) {
    return fail('params 不是合法 JSON', 'not_executed');
  }
  cliArgs.push('--params', paramsJson);
  if (input.body !== undefined) {
    let bodyJson;
    try {
      bodyJson = JSON.stringify(input.body);
    } catch (_error) {
      return fail('body 不是合法 JSON', 'not_executed');
    }
    if (bodyJson === undefined) return fail('body 不是合法 JSON', 'not_executed');
    cliArgs.push('--json', bodyJson);
  }
  cliArgs.push(...CONTEXT_ARGS);
  const run = await runCli(cliArgs, { timeoutMs: 120000, heartbeatMs: 10000 });
  if (!run.ok) return failureResult(run, `Console CLI ${command} 执行失败`, classifyExecution(run, method));
  return {
    ok: true,
    result: {
      command,
      execution: MUTATING_METHODS.has(method) ? 'executed' : 'not_applicable',
      data: parseOutput(run.stdout),
    },
  };
}

async function handleRequest(request) {
  if (!request || typeof request !== 'object') throw new Error('请求格式无效');
  switch (request.method) {
    case 'console/status': return status();
    case 'console/login': return login(request.params);
    case 'console/discover': return discover(request.params);
    case 'console/help': return help(request.params);
    case 'console/schema': return schema(request.params);
    case 'console/call': return call(request.params);
    default: return fail('未知 Console CLI Worker 方法', 'not_executed');
  }
}

function writeReply(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function startStdio() {
  readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch (_error) {
      writeReply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '请求格式无效' } });
      return;
    }
    void handleRequest(request)
      .then((result) => writeReply({ jsonrpc: '2.0', id: request.id, result }))
      .catch((error) => writeReply({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error.message } }));
  });
}

if (require.main === module) startStdio();

module.exports = {
  FIXED_COMMANDS,
  classifyExecution,
  commandParts,
  handleRequest,
  normalizeLoginArgs,
  parseOutput,
  redactDiagnostic,
  resolveCliPath,
  startStdio,
};
