'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { URL } = require('node:url');

const {
  createDeferredChild,
  isMakerCliOutputComplete,
} = require('./child-process-adapter.cjs');

const TOOL_NAME = 'cindy_maker_account';
const CHILD_ENTRY = 'node/maker-child.cjs';
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_PROJECTS = 5;
const MAX_RUN_MS = 14 * 60 * 1000;
const PAT_URL = 'https://maker.taptap.cn/pat-tokens';
const PROGRESS_HEARTBEAT_MS = 30 * 1000;
const PRODUCTION_GIT_BASE = 'https://maker.taptap.cn/git';
const RND_GIT_BASE = 'https://fuping.agnt.xd.com/git';

let mutationInFlight = false;
let nextProgressToken = 1;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function maskPat(value) {
  const pat = String(value || '').trim();
  if (!pat) return null;
  if (pat.length <= 2) return '*'.repeat(pat.length);
  if (pat.length <= 8) return `${pat[0]}${'*'.repeat(pat.length - 2)}${pat[pat.length - 1]}`;
  return `${pat.slice(0, 4)}********${pat.slice(-4)}`;
}

function makerHome() {
  return process.env.TAPTAP_MAKER_HOME || path.join(os.homedir(), '.taptap-maker');
}

async function readPatHint() {
  const environmentPat = process.env.MAKER_PAT || process.env.PAT;
  if (environmentPat) return maskPat(environmentPat);
  try {
    const stored = JSON.parse(await fs.promises.readFile(path.join(makerHome(), 'pat.json'), 'utf8'));
    if (stored && typeof stored.token === 'string') return maskPat(stored.token);
  } catch {
    // 继续兼容旧版路径。
  }
  try {
    return maskPat(await fs.promises.readFile(path.join(os.homedir(), '.maker-pat'), 'utf8'));
  } catch {
    return null;
  }
}

async function credentialExists() {
  if (process.env.MAKER_PAT || process.env.PAT || process.env.MAKER_JWT || process.env.JWT) {
    return true;
  }
  const candidates = [
    path.join(makerHome(), 'pat.json'),
    path.join(makerHome(), 'jwt.json'),
    path.join(os.homedir(), '.maker-pat'),
  ];
  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate, fs.constants.F_OK);
      return true;
    } catch {
      // 检查下一项。
    }
  }
  return false;
}

function makerErrorText(stdout, stderr) {
  const text = `${stderr || ''}\n${stdout || ''}`.trim();
  return text.slice(-2000) || 'TapTap Maker Runtime 执行失败';
}

function isMissingLogin(error) {
  const message = String(error && error.message ? error.message : error).toLowerCase();
  return message.includes('maker pat not found')
    || message.includes('maker pat missing')
    || message.includes('maker jwt not found')
    || message.includes('pat expired')
    || message.includes('http 401')
    || message.includes('http 403')
    || message.includes('unauthorized');
}

function projectSyncFailure(error) {
  const message = String(error && error.message ? error.message : error);
  if (isMissingLogin(error)) {
    return {
      code: 'AUTH_REQUIRED',
      message: 'TapTap Maker 登录已失效，请重新连接账号后重试',
    };
  }
  if (/目标路径已被占用|目标目录已被其他内容占用/.test(message)) {
    return {
      code: 'TARGET_OCCUPIED',
      message: '目标子目录已有内容，且无法安全确认属于同一 Maker 项目；请改选父目录或手动处理该子目录',
    };
  }
  if (/Git is required|Git.*not found|未检测到可用的 Git/i.test(message)) {
    return {
      code: 'GIT_REQUIRED',
      message: '本机未检测到 Git，请安装 Git 并重启 Cindy 后重试',
    };
  }
  if (/Python.*(?:setup failed|准备失败)|blocking_prerequisite["']?\s*:\s*["']?python/i.test(message)) {
    return {
      code: 'PYTHON_SETUP_FAILED',
      message: 'Maker 自动准备 Python 环境失败，请检查网络、代理和目录权限后重试',
    };
  }
  if (/timed?\s*out|timeout|Could not resolve host|Network is unreachable|ECONNRESET|ENOTFOUND/i.test(message)) {
    return {
      code: 'NETWORK_ERROR',
      message: '连接 TapTap Maker 超时，请检查网络后重试',
    };
  }
  return {
    code: 'INIT_FAILED',
    message: 'Maker 项目初始化失败；请重试，若仍失败可在 Cindy 中打开目标目录后运行 Maker 诊断',
  };
}

function runMaker(args, input) {
  return new Promise(function run(resolve, reject) {
    const childApi = globalThis.__CINDY_NODE__;
    if (!childApi || typeof childApi.spawnEntry !== 'function') {
      reject(new Error('Cindy node.childSpawn 能力不可用'));
      return;
    }

    const child = createDeferredChild(childApi.spawnEntry(CHILD_ENTRY, args), {});
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const progressToken = `cindy-maker-account-${nextProgressToken++}`;

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(progressHeartbeat);
      if (error) reject(error);
      else resolve(result);
    }

    function collect(target, chunk, stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stream === 'stdout') stdoutBytes += buffer.length;
      else stderrBytes += buffer.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES || stderrBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new Error(`TapTap Maker ${stream} 输出超限`));
        return;
      }
      target.push(buffer);
    }

    child.stdout.on('data', function onStdout(chunk) {
      collect(stdout, chunk, 'stdout');
      if (settled) return;
      const stdoutText = Buffer.concat(stdout).toString('utf8');
      if (!isMakerCliOutputComplete(args, stdoutText)) return;
      const stderrText = Buffer.concat(stderr).toString('utf8');
      child.kill();
      finish(null, { stdout: stdoutText, stderr: stderrText });
    });
    child.stderr.on('data', function onStderr(chunk) {
      collect(stderr, chunk, 'stderr');
    });
    child.once('error', function onError(error) {
      finish(error);
    });
    child.once('close', function onClose(code) {
      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        finish(new Error(makerErrorText(stdoutText, stderrText)));
        return;
      }
      finish(null, { stdout: stdoutText, stderr: stderrText });
    });
    const timer = setTimeout(function onTimeout() {
      child.kill();
      finish(new Error('TapTap Maker CLI 执行超时'));
    }, MAX_RUN_MS);
    timer.unref?.();
    const progressHeartbeat = setInterval(function reportProgress() {
      send({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: {
          progressToken,
          progress: 0,
          message: 'TapTap Maker CLI 仍在执行',
        },
      });
    }, PROGRESS_HEARTBEAT_MS);
    progressHeartbeat.unref?.();

    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

async function withMutation(operation) {
  if (mutationInFlight) throw new Error('另一项 TapTap Maker 账号操作正在进行');
  mutationInFlight = true;
  try {
    return await operation();
  } finally {
    mutationInFlight = false;
  }
}

function parseJsonOutput(output) {
  const text = output.stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.split(/\r?\n/).filter(Boolean).map(function parseLine(line) {
      try {
        return JSON.parse(line);
      } catch {
        return line;
      }
    });
  }
}

function parseProjects(output) {
  const parsed = parseJsonOutput(output);
  if (!Array.isArray(parsed)) throw new Error('TapTap Maker 返回的项目列表格式无效');
  return parsed
    .map(function project(value, index) {
      if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null;
      if (value.archivedAt != null || value.deletedAt != null) return null;
      const activity = [value.lastConversationAt, value.lastAccessedAt, value.createdAt]
        .find(function first(candidate) {
          return typeof candidate === 'string' && candidate.trim();
        });
      return {
        id: value.id.trim(),
        name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : value.id.trim(),
        lastActiveAt: activity || null,
        index,
      };
    })
    .filter(Boolean)
    .sort(function newestFirst(left, right) {
      const leftTime = left.lastActiveAt ? Date.parse(left.lastActiveAt) : 0;
      const rightTime = right.lastActiveAt ? Date.parse(right.lastActiveAt) : 0;
      const diff = (Number.isNaN(rightTime) ? 0 : rightTime)
        - (Number.isNaN(leftTime) ? 0 : leftTime);
      return diff || left.index - right.index;
    })
    .map(function withoutIndex(project) {
      return { id: project.id, name: project.name, lastActiveAt: project.lastActiveAt };
    });
}

function projectDirectoryName(project) {
  const printable = Array.from(project.name.normalize('NFKC'))
    .map(function replaceControl(character) {
      return character.charCodeAt(0) < 32 ? '-' : character;
    })
    .join('');
  const cleaned = printable
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80);
  const fallback = project.id.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
  const name = cleaned || fallback || 'maker-project';
  const safeName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)
    ? `maker-${name}`
    : name;
  const projectKey = crypto.createHash('sha256').update(project.id).digest('hex').slice(0, 16);
  const keyedName = safeName
    .slice(0, 80 - projectKey.length - 1)
    .replace(/[. ]+$/g, '') || 'maker-project';
  return `${keyedName}-${projectKey}`;
}

function makerGitBase() {
  return process.env.TAPTAP_MAKER_GIT_BASE
    || process.env.MAKER_GIT_BASE
    || (process.env.TAPTAP_MCP_ENV === 'rnd' ? RND_GIT_BASE : PRODUCTION_GIT_BASE);
}

function isExpectedMakerOrigin(origin, projectId) {
  try {
    const actual = new URL(origin);
    actual.username = '';
    actual.password = '';
    const expected = new URL(`${makerGitBase().replace(/\/$/, '')}/${projectId}.git`);
    expected.username = '';
    expected.password = '';
    return actual.href === expected.href;
  } catch {
    return false;
  }
}

async function ensureGitOriginSafe(targetDir, projectId) {
  const gitDir = path.join(targetDir, '.git');
  let stat;
  try {
    stat = await fs.promises.lstat(gitDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`目标目录缺少可验证的 Git 元数据：${targetDir}`);
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`目标目录的 Git 元数据不可安全验证：${targetDir}`);
  }

  const config = await fs.promises.readFile(path.join(gitDir, 'config'), 'utf8');
  let inOrigin = false;
  const origins = [];
  for (const line of config.split(/\r?\n/)) {
    const section = line.match(/^\s*\[\s*remote\s+"([^"]+)"\s*]\s*$/i);
    if (section) {
      inOrigin = section[1] === 'origin';
      continue;
    }
    if (/^\s*\[/.test(line)) {
      inOrigin = false;
      continue;
    }
    if (!inOrigin) continue;
    const url = line.match(/^\s*url\s*=\s*(.*?)\s*$/i);
    if (url && url[1]) origins.push(url[1]);
  }
  if (origins.length === 0 || origins.some(function unexpected(origin) {
    return !isExpectedMakerOrigin(origin, projectId);
  })) {
    throw new Error(`目标目录已绑定其他 Git 远端：${targetDir}`);
  }
}

async function ensureTargetAvailable(targetDir, projectId) {
  let stat;
  try {
    stat = await fs.promises.lstat(targetDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`目标路径已被占用：${targetDir}`);
  }
  if ((await fs.promises.readdir(targetDir)).length === 0) return;
  try {
    const configDir = path.join(targetDir, '.maker-mcp');
    const configPath = path.join(configDir, 'config.json');
    const configDirStat = await fs.promises.lstat(configDir);
    const configStat = await fs.promises.lstat(configPath);
    if (
      configDirStat.isSymbolicLink()
      || !configDirStat.isDirectory()
      || configStat.isSymbolicLink()
      || !configStat.isFile()
    ) {
      throw new Error('Maker 项目配置不可安全验证');
    }
    const config = JSON.parse(
      await fs.promises.readFile(configPath, 'utf8'),
    );
    if (isRecord(config) && config.project_id === projectId) {
      await ensureGitOriginSafe(targetDir, projectId);
      return;
    }
  } catch {
    // 非空目录只有 Maker Runtime 的同项目绑定可以证明是可安全重试的目标。
  }
  throw new Error(`目标目录已被其他内容占用：${targetDir}`);
}

function requireAbsoluteDir(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label}必须是本地绝对目录`);
  }
  return value;
}

function openPatPage() {
  let command;
  let args;
  if (process.platform === 'darwin') {
    command = 'open';
    args = [PAT_URL];
  } else if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/d', '/s', '/c', 'start', '', PAT_URL];
  } else {
    command = 'xdg-open';
    args = [PAT_URL];
  }
  return new Promise(function open(resolve, reject) {
    const child = childProcess.spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', function opened() {
      child.unref();
      resolve({ ok: true });
    });
  });
}

async function executeAction(args) {
  const action = args.action;
  if (action === 'console_open') return require('./console.cjs').openConsole(args.workdir);
  if (action === 'status') {
    if (!(await credentialExists())) return { ok: true, state: 'disconnected' };
    try {
      await runMaker(['apps', '--json']);
      const patHint = await readPatHint();
      return { ok: true, state: 'connected', ...(patHint ? { patHint } : {}) };
    } catch (error) {
      if (isMissingLogin(error)) return { ok: true, state: 'disconnected' };
      return { ok: true, state: 'unknown' };
    }
  }
  if (action === 'login') {
    const output = await withMutation(function login() {
      return runMaker(['login', '--json']);
    });
    const patHint = await readPatHint();
    return {
      ok: true,
      result: parseJsonOutput(output),
      ...(patHint ? { patHint } : {}),
    };
  }
  if (action === 'open_pat_page') return openPatPage();
  if (action === 'set_pat') {
    if (typeof args.pat !== 'string' || !args.pat.trim()) {
      return { ok: false, message: '请输入有效的 TapTap Maker PAT' };
    }
    const pat = args.pat.trim();
    try {
      await withMutation(function setPat() {
        return runMaker(['pat', 'set', '--pat-stdin', '--json'], `${pat}\n`);
      });
      return { ok: true, patHint: maskPat(pat) };
    } catch {
      return { ok: false, message: 'TapTap Maker PAT 验证或保存失败，请检查后重试' };
    }
  }
  if (action === 'apps') {
    return { ok: true, result: parseJsonOutput(await runMaker(['apps', '--json'])) };
  }
  if (action === 'projects') {
    return { ok: true, projects: parseProjects(await runMaker(['apps', '--json'])) };
  }
  if (action === 'init') {
    const workdir = requireAbsoluteDir(args.workdir, '当前工作目录');
    const cliArgs = ['init', '--target-dir', workdir, '--skip-confirm', '--skip-mcp-install', '--json'];
    if (typeof args.app_id === 'string' && args.app_id.trim() && args.create !== true && args.name === undefined) {
      cliArgs.push('--app-id', args.app_id.trim());
    } else if (args.create === true && typeof args.name === 'string' && args.name.trim() && args.app_id === undefined) {
      cliArgs.push('--create', '--name', args.name.trim());
    } else {
      return { ok: false, message: 'Maker init 参数不合法：已有项目传 app_id；新项目传 create=true 与 name' };
    }
    return { ok: true, result: parseJsonOutput(await runMaker(cliArgs)) };
  }
  if (action === 'doctor') {
    const workdir = requireAbsoluteDir(args.workdir, '当前工作目录');
    return {
      ok: true,
      result: parseJsonOutput(await runMaker(['doctor', '--target-dir', workdir, '--json'])),
    };
  }
  if (action === 'sync_projects') {
    const parentDir = await fs.promises.realpath(requireAbsoluteDir(args.parentDir, '父目录'));
    if (!(await fs.promises.stat(parentDir)).isDirectory()) {
      return { ok: false, message: '选择的父目录不存在或不可访问' };
    }
    if (
      !Array.isArray(args.projectIds)
      || args.projectIds.length === 0
      || args.projectIds.length > MAX_PROJECTS
      || args.projectIds.some(function invalidId(id) {
        return typeof id !== 'string' || !id.trim() || id.length > 128;
      })
      || new Set(args.projectIds).size !== args.projectIds.length
    ) {
      return { ok: false, message: `一次请选择 1–${MAX_PROJECTS} 个不同项目` };
    }

    const projects = parseProjects(await runMaker(['apps', '--json']));
    const byId = new Map(projects.map(function pair(project) {
      return [project.id, project];
    }));
    const selected = args.projectIds.map(function selectedProject(id) {
      return byId.get(id);
    });
    if (selected.some(function unavailable(project) { return !project; })) {
      return { ok: false, message: '所选项目已不可用，请刷新列表后重试' };
    }

    const targets = selected.map(function target(project) {
      return { project, targetDir: path.join(parentDir, projectDirectoryName(project)) };
    });

    const results = await withMutation(async function syncProjects() {
      const synced = [];
      for (const target of targets) {
        try {
          await ensureTargetAvailable(target.targetDir, target.project.id);
          await runMaker([
            'init',
            '--target-dir',
            target.targetDir,
            '--skip-confirm',
            '--skip-mcp-install',
            '--json',
            '--app-id',
            target.project.id,
          ]);
          synced.push({
            id: target.project.id,
            name: target.project.name,
            ok: true,
            targetDir: target.targetDir,
          });
        } catch (error) {
          const failure = projectSyncFailure(error);
          synced.push({
            id: target.project.id,
            name: target.project.name,
            ok: false,
            targetDir: target.targetDir,
            code: failure.code,
            message: failure.message,
          });
        }
      }
      return synced;
    });
    return { ok: true, parentDir, results };
  }
  return { ok: false, message: `未知 TapTap Maker 账号动作：${String(action)}` };
}

async function handleRequest(request) {
  if (request.method === 'initialize') {
    return {
      protocolVersion: request.params && request.params.protocolVersion
        ? request.params.protocolVersion
        : '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'cindy-taptap-maker-account', version: '1.0.0' },
    };
  }
  if (request.method === 'tools/list') {
    return {
      tools: [{
        name: TOOL_NAME,
        description: 'Cindy TapTap Maker 插件内部固定账号与 CLI 动作。',
        inputSchema: { type: 'object', additionalProperties: true },
      }],
    };
  }
  if (request.method === 'tools/call') {
    const params = isRecord(request.params) ? request.params : {};
    if (params.name !== TOOL_NAME || !isRecord(params.arguments)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, message: '账号工具参数不合法' }) }],
        isError: true,
      };
    }
    let result;
    try {
      result = await executeAction(params.arguments);
    } catch (error) {
      result = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      ...(result.ok === false ? { isError: true } : {}),
    };
  }
  throw new Error(`Method not found: ${request.method}`);
}

readline.createInterface({ input: process.stdin }).on('line', async function onLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (!isRecord(request) || request.jsonrpc !== '2.0') return;
  if (request.id === undefined) return;
  try {
    send({ jsonrpc: '2.0', id: request.id, result: await handleRequest(request) });
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32601,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
