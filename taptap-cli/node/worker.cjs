'use strict';

// TapTap CLI Cindy plugin worker.
//
// Protocol: JSON-RPC 2.0, one object per line on stdio. stdout is protocol-only;
// logs go to stderr. Methods:
//   taptap/list_tools  { category? }                        -> catalog / per-category detail + RULES
//   taptap/call_tool   { name, args?, callId? }             -> run the taptap-cli the user installed
//   ping                                                     -> liveness
//
// Every request may carry:
//   cli_path — the taptap-cli path saved in the plugin settings (optional
//              override). Only a file named taptap-cli is accepted, so the
//              setting cannot be turned into "run any local executable".
//   workdir  — the session workdir, used as the CLI's cwd so relative file
//              arguments (upload <file>, --output) resolve where the user expects
//
// The worker runs the user's own taptap-cli, so auth, risk gates and the --json
// envelopes of the CLI itself stay the single source of truth. The plugin never
// reads or stores credentials: they live in the CLI's own credential store.

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(PLUGIN_ROOT, 'bin');
const MAX_RESULT_BYTES = 900 * 1024; // single-line stdout protocol cap is 1MB
const DEFAULT_TIMEOUT_MS = 300 * 1000;
const MAX_TIMEOUT_MS = 870 * 1000;
const HEARTBEAT_MS = 25 * 1000;

// ---------------------------------------------------------------------------
// protocol helpers

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function log(message) {
  process.stderr.write('[taptap-cli-plugin] ' + message + '\n');
}

// ---------------------------------------------------------------------------
// CLI resolution
//
// The plugin does not bundle the CLI: the official npm package is ~95MB across
// seven platform binaries, far past the plugin package size cap. It runs the
// taptap-cli the user installed themselves, resolved in this order:
//   1. a path saved in the plugin settings (`cli_path`)
//   2. a binary bundled under bin/, when a local build shipped one
//   3. `taptap-cli` on the worker's PATH
//   4. common install locations (~/.local/bin, /usr/local/bin, Homebrew, npm prefix)
//
// Nothing here downloads or installs anything; a missing CLI is a setup
// failure the user resolves, not something the plugin works around.

const EXE_NAME = process.platform === 'win32' ? 'taptap-cli.exe' : 'taptap-cli';

function expandHome(value) {
  if (typeof value !== 'string' || !value) return '';
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isExecutableFile(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch (_) {
    return false;
  }
}

function findOnPath(name) {
  // `name` already carries the platform extension (EXE_NAME is taptap-cli.exe
  // on win32), so do not append another one — that would probe taptap-cli.exe.EXE.
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function bundledBinaryPath() {
  const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const archMap = { x64: 'amd64', arm64: 'arm64' };
  const platform = platformMap[process.platform];
  const arch = archMap[process.arch];
  if (!platform || !arch) return null;
  return path.join(BIN_DIR, 'taptap-cli-' + platform + '-' + arch + (process.platform === 'win32' ? '.exe' : ''));
}

// A global npm install lands in the active Node version's prefix. Under a
// version manager that prefix is not on PATH — only the manager's shim
// directory is — so the CLI can be installed successfully and still not be
// found by name. The npm prefix is not exposed to this worker through the
// environment (npm_config_prefix/PREFIX are unset here), so enumerate the
// per-version bin directories the common managers use.
function versionManagerBinDirs() {
  const home = os.homedir();
  const bases = [
    [path.join(home, '.proto', 'tools', 'node'), 'bin'],
    [path.join(home, '.nvm', 'versions', 'node'), 'bin'],
    [path.join(home, '.fnm', 'node-versions'), path.join('installation', 'bin')],
    [path.join(home, '.asdf', 'installs', 'nodejs'), 'bin'],
    [path.join(home, '.nodenv', 'versions'), 'bin'],
    [path.join(home, '.local', 'share', 'mise', 'installs', 'node'), 'bin'],
  ];
  const dirs = [];
  for (const [base, suffix] of bases) {
    let entries;
    try {
      entries = fs.readdirSync(base);
    } catch (_) {
      continue; // manager not installed
    }
    for (const entry of entries) dirs.push(path.join(base, entry, suffix));
  }
  // Managers that keep a single flat bin directory.
  dirs.push(path.join(home, '.volta', 'bin'));
  return dirs;
}

function commonInstallDirs() {
  const dirs = [path.join(os.homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin'];
  const prefix = process.env.npm_config_prefix || process.env.PREFIX;
  if (prefix) dirs.push(process.platform === 'win32' ? prefix : path.join(prefix, 'bin'));
  dirs.push(path.join(os.homedir(), '.npm-global', 'bin'));
  return dirs.concat(versionManagerBinDirs());
}

// A configured path is a user-writable string that ends up in execFile, so
// constrain it to the CLI's own name instead of accepting any executable.
const CLI_BASENAME_RE = /^taptap-cli(?:\.(?:exe|cmd|bat))?$/i;

function resolutionError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function resolveCli(override) {
  const explicit = expandHome(override);
  if (explicit) {
    if (!CLI_BASENAME_RE.test(path.basename(explicit))) {
      return {
        cmd: null,
        source: null,
        error: resolutionError('CLI_PATH_REJECTED',
          '插件设置里的路径指向的不是 taptap-cli 本身(当前文件名:' + path.basename(explicit) +
          ')。为避免执行任意可执行文件,该字段只接受以 taptap-cli 命名的程序,例如 ' +
          '/opt/homebrew/bin/taptap-cli。请在插件设置页更正或清空该字段后重试。'),
      };
    }
    if (isExecutableFile(explicit)) return { cmd: explicit, source: 'settings' };
    return {
      cmd: null,
      source: null,
      error: resolutionError('CLI_PATH_INVALID',
        '插件设置里配置的 taptap-cli 路径不可执行:' + explicit +
        ';请在插件设置页更正或清空该字段后重试。'),
    };
  }

  const bundled = bundledBinaryPath();
  if (bundled && isExecutableFile(bundled)) return { cmd: bundled, source: 'bundled' };

  const onPath = findOnPath(EXE_NAME);
  if (onPath) return { cmd: onPath, source: 'path' };

  for (const dir of commonInstallDirs()) {
    const candidate = path.join(dir, EXE_NAME);
    if (isExecutableFile(candidate)) return { cmd: candidate, source: 'common-path' };
  }

  const err = new Error(
    '本机没有找到 taptap-cli。请先在终端安装并登录官方 CLI,然后重试:\n' +
    '  npm install -g @taptap/cli               # 安装(包约 37MB)\n' +
    '  taptap-cli update --skills-layout suite  # 安装 AI Skills,并合并为单个 taptap-suite\n' +
    '  taptap-cli auth login                    # 授权\n' +
    '插件会自动搜索 PATH 以及 nvm / proto / volta 等版本管理器下的全局目录,装完即可用,通常不需要手动配置 PATH。\n' +
    '若你还要单独使用那些 skill,把 --skills-layout 换成 separate 即可。\n' +
    '若已安装但仍找不到,可在插件设置页填写 taptap-cli 的绝对路径。' +
    (process.platform === 'win32'
      ? '\n(Windows 上插件只会直接执行 taptap-cli.exe;仅存在 .cmd 包装脚本时无法调用。)'
      : '')
  );
  err.code = 'CLI_NOT_INSTALLED';
  return { cmd: null, source: null, error: err };
}

function childEnv(source) {
  const env = Object.assign({}, process.env);
  // Only a bundled binary needs to be pointed at the package's own skills.
  // An installed CLI resolves its skills from its own install location.
  if (source === 'bundled') env.TAPTAP_CLI_BUNDLED_SKILLS_ROOT = PLUGIN_ROOT;
  return env;
}

function clip(text, maxBytes) {
  const limit = maxBytes || MAX_RESULT_BYTES;
  if (Buffer.byteLength(text, 'utf8') <= limit) return text;
  return Buffer.from(text, 'utf8').slice(0, limit).toString('utf8');
}

// The CLI writes its envelope to stdout on success and to stderr on failure
// (with a non-zero exit code), so a reader that only looks at stdout loses
// every structured error. Callers pass whichever stream is expected first and
// the other as a fallback.
function parseEnvelope(primary, fallback) {
  for (const stream of [primary, fallback]) {
    const text = (stream || '').trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {
      // not the envelope; try the next stream
    }
  }
  return null;
}

// Run the CLI binary with a keep-alive heartbeat. `callId` (when present) is
// echoed in progress notifications so main.js can keep the host tool-call
// window alive for long tasks (uploads, login polling).
function runBinary(argv, opts) {
  const options = opts || {};
  const timeoutMs = Math.min(Math.max(options.timeoutMs || DEFAULT_TIMEOUT_MS, 10 * 1000), MAX_TIMEOUT_MS);
  const resolved = resolveCli(options.cliPath);
  if (!resolved.cmd) {
    return Promise.resolve({
      code: -1,
      err: resolved.error,
      killed: false,
      maxBufferExceeded: false,
      stdout: '',
      stderr: '',
      durationMs: 0,
      cliUnavailable: true,
      cliErrorCode: (resolved.error && resolved.error.code) || 'CLI_NOT_INSTALLED',
      message: (resolved.error && resolved.error.message) || 'taptap-cli 不可用。',
    });
  }
  // A requested working directory that cannot be used is refused, never
  // silently dropped: falling back to the worker's own directory would let the
  // CLI resolve a relative path (`upload ./x`, `--output x`) somewhere the
  // session never authorized. Callers that read no file do not pass one.
  if (options.cwd && !fs.existsSync(options.cwd)) {
    return Promise.resolve({
      code: -1,
      err: null,
      killed: false,
      maxBufferExceeded: false,
      stdout: '',
      stderr: '',
      durationMs: 0,
      cliUnavailable: true,
      cliErrorCode: 'WORKDIR_REQUIRED',
      message: '会话工作目录已不可用:' + options.cwd
        + ';CLI 以它为基准限定本地文件路径,不能在其它目录下代替执行。请在有效的会话工作目录里重试。',
    });
  }
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile(resolved.cmd, argv, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      cwd: options.cwd || undefined,
      env: childEnv(resolved.source),
    }, (err, stdout, stderr) => {
      clearInterval(timer);
      const code = err
        ? (typeof err.code === 'number' ? err.code : -1)
        : 0;
      resolve({
        code,
        err,
        killed: Boolean(err && err.killed),
        maxBufferExceeded: Boolean(err && err.code === 'ENOBUFS'),
        stdout: stdout || '',
        stderr: stderr || '',
        durationMs: Date.now() - started,
      });
    });
    const timer = setInterval(() => {
      const elapsed = Math.round((Date.now() - started) / 1000);
      if (options.callId) {
        notify('progress', { callId: options.callId, message: (options.label || '命令执行中') + ',已运行 ' + elapsed + ' 秒' });
      }
      log((options.label || argv.join(' ')) + ' still running (' + elapsed + 's)');
    }, HEARTBEAT_MS);
  });
}

// ---------------------------------------------------------------------------
// command catalog (from the CLI's own OpenAPI snapshot)

// Cached per resolved CLI, so switching the configured path re-reads the catalog.
const catalogCache = new Map();

function getCatalog(runOpts) {
  const options = runOpts || {};
  const key = options.cliPath || '';
  if (!catalogCache.has(key)) {
    const promise = (async () => {
      const res = await runBinary(['schema'], {
        timeoutMs: 120 * 1000,
        label: '读取命令目录',
        cliPath: options.cliPath,
      });
      if (res.cliUnavailable) {
        const err = new Error(res.message);
        err.code = res.cliErrorCode;
        throw err;
      }
      if (res.code !== 0) {
        throw new Error('读取 CLI 命令目录失败(exit ' + res.code + '):' + clip(res.stderr, 500));
      }
      const env = parseEnvelope(res.stdout, res.stderr);
      if (!env || env.ok !== true || !Array.isArray(env.data)) {
        throw new Error('CLI 命令目录格式异常');
      }
      const services = new Map();
      for (const item of env.data) {
        const name = item && typeof item.name === 'string' ? item.name : null;
        if (!name || name.indexOf(' ') < 0) continue;
        const service = name.split(' ')[0];
        if (EXCLUDED_SERVICES.has(service)) continue;
        if (!services.has(service)) services.set(service, []);
        services.get(service).push(item);
      }
      return services;
    })().catch((err) => {
      catalogCache.delete(key);
      throw err;
    });
    catalogCache.set(key, promise);
  }
  return catalogCache.get(key);
}

const aliasesCache = new Map();

// The CLI's friendly shortcut allowlist (`taptap-cli aliases`). Each alias maps
// to a canonical service operation; reading it live keeps list_tools/call_tool
// in sync with the CLI instead of a hand-maintained shortcut table. The data
// query service is filtered the same way as the catalog.
function getAliases(runOpts) {
  const options = runOpts || {};
  const key = options.cliPath || '';
  if (!aliasesCache.has(key)) {
    const promise = (async () => {
      const res = await runBinary(['aliases'], {
        timeoutMs: 120 * 1000,
        label: '读取快捷命令',
        cliPath: options.cliPath,
      });
      if (res.cliUnavailable) {
        const err = new Error(res.message);
        err.code = res.cliErrorCode;
        throw err;
      }
      if (res.code !== 0) {
        throw new Error('读取 CLI 快捷命令失败(exit ' + res.code + '):' + clip(res.stderr, 500));
      }
      const env = parseEnvelope(res.stdout, res.stderr);
      if (!env || env.ok !== true || !env.data || !Array.isArray(env.data.aliases)) {
        throw new Error('CLI 快捷命令格式异常');
      }
      // Split rather than filter: callers need both the usable aliases and the
      // names that were dropped, so the exclusion also covers the alias route
      // into the data-query service.
      const list = [];
      const excluded = [];
      for (const alias of env.data.aliases) {
        const canonical = alias && typeof alias.canonical === 'string' ? alias.canonical : '';
        if (EXCLUDED_SERVICES.has(canonical.split(' ')[0])) excluded.push(alias && alias.alias);
        else list.push(alias);
      }
      return { list, excluded };
    })().catch((err) => {
      aliasesCache.delete(key);
      throw err;
    });
    aliasesCache.set(key, promise);
  }
  return aliasesCache.get(key);
}

// ---------------------------------------------------------------------------
// live command tree (the CLI's own completion interface)
//
// `taptap-cli __complete <path> ""` answers with the children of <path>, one
// `name<TAB>description` per line. It is the only source that knows about the
// commands the OpenAPI schema does not list (the `+` subcommands such as
// `app +list` and the third-level `asset-library ai-image +plan`), which is why
// the listing is built from it instead of from a hand-written table.
//
// The last argument is the partial word being completed, so an empty string
// means "everything at this level" and a prefix turns the call into a search.

const treeCache = new Map();

function parseComplete(stdout) {
  const children = [];
  for (const line of String(stdout || '').split('\n')) {
    if (!line || line.startsWith(':') || line.startsWith('Completion ended')) continue;
    const tab = line.indexOf('\t');
    const name = (tab >= 0 ? line.slice(0, tab) : line).trim();
    if (!name) continue;
    children.push({ name, description: tab >= 0 ? line.slice(tab + 1).trim() : '' });
  }
  return children;
}

async function completePath(runOpts, tokens, partial) {
  const options = runOpts || {};
  const suffix = partial === undefined ? '' : partial;
  const key = (options.cliPath || '') + ' ' + tokens.join(' ') + ' ' + suffix;
  if (!treeCache.has(key)) {
    const promise = (async () => {
      // No cwd: reading the command tree touches no file, and leaving it out
      // keeps discovery working when the session workdir has gone away.
      const res = await runBinary(['__complete'].concat(tokens, [suffix]), {
        label: '读取命令树',
        cliPath: options.cliPath,
      });
      if (res.cliUnavailable) {
        const err = new Error(res.message);
        err.code = res.cliErrorCode;
        throw err;
      }
      // A completion that fails is not fatal for the caller: the tree only
      // widens discovery, so an unknown path simply has no children.
      if (res.code !== 0) return [];
      return parseComplete(res.stdout);
    })().catch((err) => {
      treeCache.delete(key);
      throw err;
    });
    treeCache.set(key, promise);
  }
  return treeCache.get(key);
}

// ---------------------------------------------------------------------------
// per-command risk (from the CLI's own help output)
//
// Every command prints a `Risk: read|write|high-risk-write` line in `--help`
// (the CLI documents this contract in `taptap-cli app --help`), including the
// `+` subcommands the OpenAPI schema does not cover. Reading risk here is what
// keeps the write gate working for commands that have no `_meta.risk`, without
// a hand-maintained table that drifts every time the CLI gains a command.

const riskCache = new Map();

async function helpRisk(runOpts, tokens) {
  const options = runOpts || {};
  const key = (options.cliPath || '') + ' ' + tokens.join(' ');
  if (!riskCache.has(key)) {
    const promise = (async () => {
      // No cwd: printing help reads no file either.
      const res = await runBinary(tokens.concat(['--help']), {
        timeoutMs: 60 * 1000,
        label: '读取命令风险级别',
        cliPath: options.cliPath,
      });
      if (res.cliUnavailable) {
        const err = new Error(res.message);
        err.code = res.cliErrorCode;
        throw err;
      }
      const match = String(res.stdout || '').match(/^Risk:\s*([a-z-]+)/mi);
      return match ? match[1].toLowerCase() : null;
    })().catch((err) => {
      riskCache.delete(key);
      throw err;
    });
    riskCache.set(key, promise);
  }
  return riskCache.get(key);
}

// ---------------------------------------------------------------------------
// static surface: descriptions, rules

// Services this plugin refuses to offer. It is currently empty: data querying
// (dashboard-stats) used to be denied here and is now served like any other read
// domain. The denylist stays as the single entry point so a future exclusion
// still lands in one place: the catalog filter drops the service before it is
// listed, the alias filter drops its aliases, the tree filter drops it from
// discovery, and call_tool rejects it outright rather than relying on the
// listing to hide it.
const EXCLUDED_SERVICES = new Set([]);

// Commands the agent must not run through the plugin: updating the user's own
// installation is a machine-level action the user performs in a terminal, not
// part of a TapTap business operation.
const EXCLUDED_COMMANDS = new Set(['update']);

const SERVICE_DESCRIPTIONS = {
  app: '游戏资料、包体槽位、版本生命周期、审核与发布',
  'asset-library': '图片/视频素材库检索、收录与上传',
  'dashboard-stats': '下载、曝光、转化、预约、订单、评分等数据表现查询',
  developer: '开发者账号与厂商列表',
  'package-management': '包体库、线上/待处理包、自测入口与小游戏能力',
  qualification: '上架资质分析、非敏感材料草稿、资质增量审核',
  'test-plan': 'CBT/OBT 测试计划、招募、资格批次与激活码',
};

// Chinese display descriptions for the commands an agent reaches most often.
// Display-only: nothing here decides access or risk, a missing entry falls back
// to the CLI's own description, and an entry the CLI no longer ships is never
// shown. Discovery, risk and the write gate all come from the CLI at runtime.
const DESCRIPTION_OVERLAY = {
  overview: '一次查看登录态、可见厂商、游戏样例和下一步建议',
  doctor: '检查 CLI 配置、凭证与连通性',
  status: '检查 Capability API 可达性',
  config: '查看本地 CLI 配置与运行策略',
  profile: '查看/切换服务器 profile',
  event: '消费与管理实时事件',
  version: '查看 CLI 版本',
  aliases: '列出友好快捷命令允许清单',
  schema: '查看某个操作的输入输出 schema(如 schema app save-changes)',
  'test-qr-code': '生成自测二维码 PNG(--output 指定文件路径)',
  upload: '上传一张图片并收录进素材库(需 idempotency_key)',
  'upload-video': '上传视频(scene 决定回填目标字段)',
  'upload-apk': '上传 APK 并创建包体记录',
  'upload-pc-package': '上传 Windows 包(不带槽位绑定)',
  'upload-h5-package': '上传 H5 zip 并创建 H5 版本',
  materials: '只读盘点本地目录/压缩包中的可上传物料(+inspect)',
  task: '查看/恢复长任务上传(+list / +get / +resume)',
  auth: '登录授权、登录态与凭证管理',
  skills: '读取 CLI 内嵌的官方手册(list / read)',
  help: '查看任意命令的帮助',
};

// Command-path tokens: the head may carry a colon (`game:create`), the `+`
// subcommands start with `+`, and everything is space-separated.
const TOKEN_RE = /^[a-z0-9+][a-z0-9+._:-]*$/i;

const GLOBAL_RULES = [
  '写门禁:risk 为 write / high-risk-write 的操作,必须先向用户说明参数与影响并取得明确同意;先用 dry_run:true 预览,再用完全相同的参数加 yes:true 执行。既没有 dry_run 也没有 yes 的写调用会被拒绝,只读会话里的写调用一律拒绝;取得用户同意是你的职责,yes 是执行开关而不是同意本身。例外:插件编排的 auth login-start / auth login-wait 是登录流程本身(用户在浏览器里完成授权),不走这道确认门禁,但只读会话仍然拒绝。--yes 不代表用户同意协议;遇到服务端要求额外确认时只展示响应实际返回的 blockers / warnings,协议签署走独立的 agree-sce-agreement(先展示协议名称与 URL,用户明确同意后加 yes:true 执行,再重查确认 blocker 消失)。',
  '参数:scope 字段(developer_id / app_id)直接传,worker 映射成 --dev-id / --app-id;其余业务字段必须放进 args.data(JSON 对象);除 scope 和 data 外的键都是控制 flag,透传成 --flag,合法性由 CLI 按各命令自己的 schema 校验(未知 flag 由 CLI 拒绝);位置参数(如文件路径)放 args._positional 数组。本地文件路径必须是相对会话工作目录的路径:CLI 以会话工作目录为基准校验并拒绝绝对路径与 ../ 越界。',
  '发现命令:list_tools() 给顶层命令;list_tools(category:"<命令路径>") 逐层下钻(如 category:"asset-library",再 category:"asset-library ai-image");不确定命令名时直接传前缀搜索(如 category:"up")。某命令的完整帮助(含全部 flag)用 call_tool(name:"<命令>", args:{_help:true}),也可以用 call_tool(name:"help", args:{_positional:["<命令>"]})。list_tools 下钻不含 outputSchema,需要某操作的输出结构时用 call_tool(name:"schema", args:{_positional:[service, method]}) 查完整输入输出。',
  '调用示例:先 list_tools(category) 看该域操作与参数(enum=可选值、pattern=格式、required=true=必填),再 call_tool。例——创建冒险游戏:call_tool(name:"app create-app", args:{developer_id:"1001", data:{title:"我的游戏", category:"adventure", package_type:"apk", developer_role:"developer"}, dry_run:true});用户确认后同参数加 yes:true。务必按 inputSchema 的 enum 取值、按 pattern 校验格式,不要猜值。',
  '输出:成功返回的 data 是 CLI 的 JSON envelope(顶层 ok / data / error)。业务失败以 ok:false 返回,message 含 error.type / error.message / error.hint。不要手动传 json / format flag,输出已默认结构化(默认文本的命令如 auth status 由插件自动补 --json)。',
  '失败三态:失败结果带 `execution_state` 字段,只有两个取值。`not_executed` 表示操作没有生效,可按 message 修正参数后重试;`unknown` 表示写操作可能已经在服务端生效,必须先核对实际状态(上传类用 task +list 查看已有任务)再决定是否重试,禁止直接重跑。',
  '身份:缺 developer_id / app_id 时先用 overview 或 developer 命令查询候选,多候选让用户选,不要猜 ID。',
  '手册:完整业务流程与领域规范用 ghost_manual({ghost_id:"taptap-cli", path:...}) 读取,入口见 taptap-suite——这是本插件的执行纪律层。需要 CLI 自带的官方原文(随 CLI 版本内置)时用 call_tool(name:"skills", args:{_positional:["list"]}) 看清单、call_tool(name:"skills", args:{_positional:["read","<手册名>"]}) 读取,作为深入参考;两者冲突时以本插件手册的执行纪律为准。',
];

const AUTH_RULES = [
  '未登录时:先 call_tool(name:"auth login-start"),把返回的 verification_url 按两行原样提供给用户(第一行仅写"请完成授权:",第二行仅写 URL);不要用 Markdown 链接语法,也不要重复展示 URL。',
  '紧接着立即 call_tool(name:"auth login-wait", args:{login_handle:...}) 持续轮询,不要等待用户回复;不要只用 device_code 重建命令,不要输出/记录/上报 access token;登录成功后向用户只回复"登录成功"。',
  'auth status 只在用户询问当前身份、登录失败或错误要求重登时运行,不作为每个任务的固定前置。',
];

// ---------------------------------------------------------------------------
// list_tools

function runOptions(params) {
  return {
    cliPath: params && params.cli_path,
    cwd: params && params.workdir,
  };
}

function catalogFailure(err) {
  return {
    ok: false,
    errorCode: (err && err.code) || 'CATALOG_UNAVAILABLE',
    message: (err && err.message) || String(err),
  };
}

// The category drill-down keeps everything the agent needs to pick an operation
// and fill its args — inputSchema, affordance (use_when / avoid_when / examples),
// risk, and description — but drops outputSchema, which is only needed after
// execution and is the single largest part of the catalogue (22% of the full
// schema). An agent that wants the output shape queries it per-operation with
// call_tool(name:"schema", args:{_positional:[service, method]}).
function trimOutputSchema(op) {
  if (!op || typeof op !== 'object') return op;
  const { outputSchema, ...rest } = op;
  return rest;
}

function overlayDescription(name, fallback) {
  return DESCRIPTION_OVERLAY[name] || fallback || '';
}

// Commands the plugin refuses to surface, by command name or by the canonical
// target of an alias (`stats:get` -> dashboard-stats).
async function exclusionIndex(runOpts) {
  const index = {
    names: new Set([].concat([...EXCLUDED_SERVICES], [...EXCLUDED_COMMANDS])),
    aliases: new Map(),
    // An alias maps to a canonical operation, and the canonical target is what
    // decides whether it is excluded (`stats:get` -> dashboard-stats). Without
    // that mapping an alias cannot be classified at all, so the index records
    // the failure and every alias call is refused rather than let through.
    aliasListLoaded: false,
  };
  try {
    const aliases = await getAliases(runOpts);
    for (const alias of aliases.list) {
      if (alias && alias.alias) index.aliases.set(alias.alias, alias.canonical || '');
    }
    for (const name of aliases.excluded) index.names.add(name);
    index.aliasListLoaded = true;
  } catch (_) {
    // A missing alias list must not take down discovery; it only closes the
    // alias route (see the caller).
  }
  return index;
}

function isExcluded(index, name) {
  if (index.names.has(name)) return true;
  const canonical = index.aliases.get(name);
  return Boolean(canonical) && EXCLUDED_SERVICES.has(canonical.split(' ')[0]);
}

// Children of a command path. An exact path answers with its children; a path
// the CLI does not recognise is retried as a prefix search on the last token,
// so `list_tools(category:"up")` finds the upload* commands. `exact` tells the
// caller whether the entries are children of the path (which need it prefixed
// to form a callable name) or top-level commands in their own right.
async function childrenAt(runOpts, tokens) {
  const children = await completePath(runOpts, tokens);
  if (children.length || !tokens.length) return { children, exact: true };
  // Nothing at this path. It may still be a real command that simply has no
  // subcommands — asking for its flag completions is the way to tell that
  // apart from a path the CLI does not know.
  const prefix = tokens[tokens.length - 1];
  const siblings = await completePath(runOpts, tokens.slice(0, -1));
  if (siblings.some((child) => child.name === prefix)) {
    return { children: await completePath(runOpts, tokens, '--'), exact: true };
  }
  // A prefix the CLI has no exact match for: search the parent level with it.
  return { children: siblings.filter((child) => child.name.startsWith(prefix)), exact: false };
}

async function listTools(params) {
  const runOpts = runOptions(params);
  const category = params && typeof params.category === 'string' ? params.category.trim() : '';
  const rules = category === 'auth' ? AUTH_RULES.concat(GLOBAL_RULES) : GLOBAL_RULES.slice();

  let index;
  try {
    index = await exclusionIndex(runOpts);
  } catch (err) {
    return catalogFailure(err);
  }

  // No category: the CLI's own top level, minus the excluded commands. The
  // listing is read live, so a command the CLI gains shows up without a plugin
  // release.
  if (!category) {
    let children;
    try {
      children = await completePath(runOpts, []);
    } catch (err) {
      return catalogFailure(err);
    }
    return {
      ok: true,
      data: {
        categories: children
          .filter((child) => child.name && !isExcluded(index, child.name))
          .map((child) => {
            const entry = {
              category: child.name,
              description: overlayDescription(child.name, child.description),
            };
            if (SERVICE_DESCRIPTIONS[child.name]) entry.kind = 'service';
            if (index.aliases.has(child.name)) entry.alias_of = index.aliases.get(child.name);
            return entry;
          }),
        rules,
        hint: '传 category 下钻:先看子命令,再逐层深入(如 category:"asset-library",然后 category:"asset-library ai-image")。' +
          '不确定命令名时可直接传前缀搜索(如 category:"up")。' +
          '某命令的完整帮助用 call_tool(name:"<命令>", args:{_help:true})。',
      },
    };
  }

  const tokens = category.split(/\s+/);
  if (!tokens.every((t) => TOKEN_RE.test(t))) {
    return {
      ok: false,
      errorCode: 'UNKNOWN_CATEGORY',
      message: '未知命令路径 "' + category + '";命令名不能包含空格以外的特殊字符。用 list_tools() 看顶层命令。',
    };
  }
  if (isExcluded(index, tokens[0])) {
    return {
      ok: false,
      errorCode: 'UNKNOWN_CATEGORY',
      message: '"' + tokens[0] + '" 不在本插件提供的范围内(数据查询与 CLI 自更新不由本插件提供)。用 list_tools() 看可用命令。',
    };
  }

  let found;
  try {
    found = await childrenAt(runOpts, tokens);
  } catch (err) {
    return catalogFailure(err);
  }
  const subcommands = found.children.filter(
    (child) => child.name && child.name.charAt(0) !== '-' && !isExcluded(index, child.name)
      // `auth login` hands the device code back to its caller; the worker
      // redirects it to the orchestrated pair, so it is not offered here.
      && !(tokens[0] === 'auth' && child.name === 'login'),
  );
  const flags = found.children
    .filter((child) => child.name && child.name.charAt(0) === '-')
    .map((child) => ({ flag: child.name, description: child.description }));

  // Service levels also carry the OpenAPI schema (inputSchema + risk), which the
  // completion tree does not know about. Merge both, schema first, no duplicates.
  let operations = [];
  if (tokens.length === 1 && SERVICE_DESCRIPTIONS[tokens[0]]) {
    try {
      const services = await getCatalog(runOpts);
      operations = (services.get(tokens[0]) || []).map(trimOutputSchema);
    } catch (err) {
      return catalogFailure(err);
    }
  }
  if (tokens[0] === 'auth') {
    // The two heads the worker orchestrates always exist; the ordinary auth
    // commands are only advertised when this CLI actually has them, or the
    // listing would offer a name call_tool then rejects as UNKNOWN_TOOL.
    const listed = new Set(subcommands.map((child) => 'auth ' + child.name));
    operations = AUTH_OPERATIONS.filter((op) => ORCHESTRATED_RISKS.has(op.name) || listed.has(op.name));
  }

  if (!subcommands.length && !operations.length) {
    return {
      ok: true,
      data: {
        category,
        rules,
        operations: [],
        flags,
        hint: '该命令没有子命令,flags 是它接受的选项。参数不确定时用 call_tool(name:"' + category + '", args:{_help:true}) 查看完整帮助。',
      },
    };
  }

  const covered = new Set(operations.map((op) => op.name.split(' ').pop()));
  const childrenOps = subcommands
    .filter((child) => !covered.has(child.name))
    .map((child) => ({
      // A child of the requested path needs that path to be callable; a
      // prefix-search hit is already a full command name.
      name: found.exact ? category + ' ' + child.name : child.name,
      description: overlayDescription(child.name, child.description),
    }));

  return {
    ok: true,
    data: {
      category,
      rules,
      operations: operations.concat(childrenOps),
      hint: '任意条目都可以继续下钻:传它的完整命令(category:"<命令>")会返回它的子命令,'
        + '没有子命令时返回它接受的 flag。参数细节用 call_tool(name:"<命令>", args:{_help:true}) 看完整帮助。',
    },
  };
}

const AUTH_OPERATIONS = [
  { name: 'auth login-start', risk: 'write', description: '发起链接授权,返回用户需打开的 verification_url 和 login_handle(不返回设备码)。' },
  { name: 'auth login-wait', risk: 'write', description: '用 login_handle 持续轮询直到授权完成或设备码过期;login-start 后立即调用。' },
  { name: 'auth status', risk: 'read', description: '查看登录态、账号、profile 与服务器状态。' },
  { name: 'auth logout', risk: 'write', description: '清除本机保存的登录凭证。' },
  { name: 'auth qrcode', risk: 'read', description: '生成授权二维码。' },
];

// ---------------------------------------------------------------------------
// login orchestration

// The CLI's device-code flow is stateless: `auth login --no-wait` returns a
// device code, and `auth login --device-code` resumes polling with it. The code
// must survive the gap between login-start and login-wait without being
// persisted to a file (forbidden by the repository) or returned to the agent
// (where a base64 blob could be decoded). It is held in-process under an opaque
// random handle; if the worker idles out between the two calls the handle is
// lost and the agent must re-run login-start.
const loginHandles = new Map();

function newLoginHandle(deviceCode, expiresAt, interval) {
  const id = 'login_' + crypto.randomBytes(16).toString('hex');
  loginHandles.set(id, {
    device_code: deviceCode,
    expires_at_unix: expiresAt || undefined,
    interval_seconds: interval,
    created_at_unix: Math.floor(Date.now() / 1000),
  });
  // Drop stale handles so the map cannot grow without bound.
  const nowUnix = Math.floor(Date.now() / 1000);
  for (const [key, value] of loginHandles) {
    if (!value || !value.created_at_unix || nowUnix - value.created_at_unix > 3600) loginHandles.delete(key);
  }
  return id;
}

function getLoginHandle(id) {
  if (typeof id !== 'string' || !id) return null;
  return loginHandles.get(id) || null;
}

function deleteLoginHandle(id) {
  if (typeof id === 'string') loginHandles.delete(id);
}

async function authLoginStart(params) {
  const runOpts = runOptions(params);
  const res = await runBinary(['auth', 'login', '--no-wait', '--json'], {
    timeoutMs: 60 * 1000,
    label: '发起授权',
    cliPath: runOpts.cliPath,
    cwd: runOpts.cwd,
  });
  if (res.cliUnavailable) {
    return { ok: false, errorCode: res.cliErrorCode || 'CLI_NOT_INSTALLED', message: res.message };
  }
  const env = parseEnvelope(res.stdout, res.stderr);
  const data = env && env.ok === true && env.data ? env.data : null;
  if (!data || !data.verification_url || !data.device_code) {
    return {
      ok: false,
      errorCode: 'LOGIN_START_FAILED',
      message: '发起授权失败:' + briefFailure(res, env),
    };
  }
  const interval = Number(data.interval) > 0 ? Number(data.interval) : 5;
  return {
    ok: true,
    data: {
      verification_url: data.verification_url,
      expires_at_unix: data.expires_at || undefined,
      interval_seconds: interval,
      login_handle: newLoginHandle(data.device_code, data.expires_at, interval),
      display_contract: '把 verification_url 按两行原样展示给用户(第一行仅"请完成授权:",第二行仅 URL),然后立即用 login_handle 调用 auth login-wait,不要等待用户回复。',
    },
  };
}

async function authLoginWait(params) {
  const handle = getLoginHandle(params && params.login_handle);
  if (!handle) {
    return {
      ok: false,
      errorCode: 'LOGIN_HANDLE_INVALID',
      message: 'login_handle 无效、已过期或 worker 已重启;请重新调用 auth login-start 换取新的授权链接。',
    };
  }
  const argv = ['auth', 'login', '--json', '--device-code', handle.device_code];
  if (handle.expires_at_unix) argv.push('--expires-at-unix', String(handle.expires_at_unix));
  argv.push('--interval-seconds', String(handle.interval_seconds || 5));
  const runOpts = runOptions(params);
  const res = await runBinary(argv, {
    timeoutMs: MAX_TIMEOUT_MS,
    callId: params && params.callId,
    label: '等待用户完成授权',
    cliPath: runOpts.cliPath,
    cwd: runOpts.cwd,
  });
  // A timeout leaves the device code usable, so keep the handle and let the
  // agent resume polling. Any completed run (success or a hard CLI failure)
  // consumes it.
  if (!res.killed) deleteLoginHandle(params && params.login_handle);
  if (res.cliUnavailable) {
    return { ok: false, errorCode: res.cliErrorCode || 'CLI_NOT_INSTALLED', message: res.message };
  }
  if (res.killed) {
    return {
      ok: false,
      errorCode: 'LOGIN_PENDING',
      message: '授权仍在等待中(本次轮询已到时限,用户尚未完成)。可用同一个 login_handle 再次调用 auth login-wait 继续等待。',
    };
  }
  const env = parseEnvelope(res.stdout, res.stderr);
  if (env && env.ok === true) {
    return { ok: true, data: { status: 'authorized' } };
  }
  return {
    ok: false,
    errorCode: 'LOGIN_WAIT_FAILED',
    // The device-code exchange may have completed (and the credential been
    // stored) before the process exited non-zero, so the outcome is unknown
    // rather than not-executed: check the login state before starting over.
    execution_state: 'unknown',
    message: '授权未完成:' + briefFailure(res, env)
      + ';该轮询是否已经换到凭证无法确定:请先 call_tool(name:"auth status") 核对登录态,'
      + '确认未登录后再调用 auth login-start 换新链接。',
  };
}

function briefFailure(res, env) {
  const parts = [];
  const err = env && env.error ? env.error : null;
  if (err && err.type) parts.push(err.type + (err.subtype ? '/' + err.subtype : ''));
  if (err && err.message) parts.push(err.message);
  if (err && err.hint) parts.push(err.hint);
  if (!parts.length && res && res.stderr) parts.push(clip(res.stderr.trim(), 300));
  if (!parts.length) parts.push('exit=' + (res ? res.code : '?'));
  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// call_tool

// The CLI's input model (cmd/openapi/openapi.go): a service operation exposes
// only `--dev-id` and `--app-id` as scope flags (with those short names), and
// every business field goes inside one `--data` JSON. The two scope names are
// the CLI's fixed convention (matching the schema's developer_id / app_id),
// not something the plugin invents. Every other top-level key is a control flag
// mirrored as `--<flag>`: the CLI validates flags against the operation's own
// schema and rejects anything it does not define (`unknown flag "--x"`), so the
// plugin does not keep a second, drift-prone copy of that vocabulary.
const SCOPE_FLAG = {
  developer_id: 'dev-id',
  dev_id: 'dev-id',
  app_id: 'app-id',
};

// The two heads the worker orchestrates itself (see login orchestration below),
// so their risk is not discoverable from any `--help` output.
const ORCHESTRATED_RISKS = new Map([
  ['auth login-start', 'write'],
  ['auth login-wait', 'write'],
]);

// Command paths whose whole job is to print reference material: a command's
// help and the two read-only `skills` subcommands. They are not operations, so
// their own `--help` carries no `Risk:` line and the fail-closed default would
// drag a doc dump through the confirmation gate. Keyed by the full path — a
// `skills` subcommand that does something else goes through the ordinary risk
// lookup instead of inheriting this exemption.
const DOCUMENTATION_PATHS = new Set(['help', 'skills list', 'skills read']);

// Heads whose positional operands are identifiers — a service and method, a
// manual name, a command name, a profile, an event key, a task id, a URL —
// rather than local files. Everything else that takes an operand is assumed to
// name a file, so the workdir requirement below fails closed for a head this
// list has not met. This is separate from the risk exemption above: a `skills`
// subcommand still goes through the ordinary risk lookup.
const IDENTIFIER_OPERAND_HEADS = new Set([
  'auth', 'event', 'help', 'profile', 'schema', 'skills', 'task',
]);

// The command a call actually names. Container commands (`materials`, `task`,
// `skills`) print no risk of their own — it lives on the subcommand — so a
// leading positional that names one of the container's children belongs to the
// risk path. That is what tells `task +resume` (write) from `task +list`, and
// `skills list` from the bare `skills` container.
async function riskPathTokens(runOpts, tokens, args) {
  const path = tokens.slice();
  // `help` prints another command's documentation and executes nothing, but the
  // CLI completes every command name as its "child" — so walking further would
  // swallow the target command into the path and misreport the risk.
  if (path[0] === 'help') return path;
  const positional = Array.isArray(args._positional) ? args._positional.map(String) : [];
  for (const item of positional) {
    if (!item || item.startsWith('-')) break;
    if (!item.startsWith('+')) {
      // A `+` marker is a subcommand by construction; anything else has to be
      // one the CLI actually lists at this level, or it is an operand.
      const children = await childrenAt(runOpts, path);
      if (!children.children.some((child) => child.name === item)) break;
    }
    path.push(item);
  }
  return path;
}

// Local file inputs need a confinement root. The CLI confines every local path
// (positional uploads, `--output`, `--output-dir`, `--data @file`) to its own
// working directory, resolving `..` and symlinks — which is why the session
// workdir is passed as the CLI's cwd. Without a workdir there is no root to
// confine to, so calls that carry local file arguments are refused.
function needsLocalFiles(args) {
  if (Array.isArray(args._positional)) {
    // `-` is a flag and `+` is a subcommand marker; everything else is an
    // operand the CLI may resolve as a local path (a file, a directory, a zip).
    if (args._positional.some((p) => {
      const value = typeof p === 'string' ? p : String(p);
      return value && !value.startsWith('-') && !value.startsWith('+');
    })) return true;
  }
  if (typeof args.data === 'string' && args.data.startsWith('@')) return true;
  for (const key of ['output', 'output_dir', 'output-dir']) {
    if (typeof args[key] === 'string' && args[key]) return true;
  }
  return false;
}

function buildArgv(tokens, args) {
  const argv = tokens.slice();
  if (Array.isArray(args._positional)) {
    for (const p of args._positional) {
      const s = String(p);
      if (s.startsWith('-')) {
        return { error: '位置参数不能以 - 开头(' + s + ');选项请用结构化 flag 键传。' };
      }
      argv.push(s);
    }
  }
  if (args._help === true) argv.push('--help');

  const dataObj = {};
  let hasData = false;
  let rawData = null;

  // Reject duplicate flags so a second key cannot override a scope/data value or
  // another flag. JSON keys are unique, but two keys can map to the same flag
  // (developer_id and dev_id both -> --dev-id).
  const seenFlags = new Set(['--help']);
  for (const [key, value] of Object.entries(args)) {
    if (key === 'callId' || key.charAt(0) === '_') continue;
    if (value === undefined || value === null) continue;

    if (SCOPE_FLAG[key]) {
      const flag = '--' + SCOPE_FLAG[key];
      if (seenFlags.has(flag)) return { error: '重复参数 ' + key + ',与 scope 字段冲突;请只传一个。' };
      seenFlags.add(flag);
      argv.push(flag, String(value));
      continue;
    }
    if (key === 'data') {
      if (typeof value === 'string') { rawData = value; hasData = true; }
      else if (typeof value === 'object') { Object.assign(dataObj, value); hasData = true; }
      continue;
    }
    // Any other key is a control flag, mirrored to the CLI as `--<flag>`. The
    // CLI rejects flags an operation does not declare, so the vocabulary is
    // validated where it actually lives rather than in a copy here.
    const flagName = key.replace(/_/g, '-');
    const flag = '--' + flagName;
    if (seenFlags.has(flag)) return { error: '重复 flag ' + flag + ';请只传一个。' };
    seenFlags.add(flag);
    if (value === true) argv.push(flag);
    else if (value !== false) argv.push(flag, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }

  if (hasData) {
    if (rawData !== null) argv.push('--data', rawData);
    else if (Object.keys(dataObj).length > 0) argv.push('--data', JSON.stringify(dataObj));
  }

  return { argv };
}

async function callTool(params) {
  const runOpts = runOptions(params);
  const name = params && typeof params.name === 'string' ? params.name.trim() : '';
  const args = params && typeof params.args === 'object' && params.args !== null ? params.args : {};
  if (!name) {
    return { ok: false, errorCode: 'INVALID_ARGS', message: '缺少 name;操作名来自 list_tools,如 "app get-app-module"。' };
  }
  const tokens = name.split(/\s+/);
  if (!tokens.every((t) => TOKEN_RE.test(t))) {
    return {
      ok: false,
      errorCode: 'UNKNOWN_TOOL',
      message: '未知操作 "' + name + '";先用 list_tools() 看顶层命令,或传 category:"<命令路径>" 逐层下钻。',
    };
  }
  // Login is orchestrated in the worker so the device code never reaches the
  // model. It is a write, so a read-only session must not start one.
  if (name === 'auth login-start' || name === 'auth login-wait') {
    if (params.read_only === true) {
      return {
        ok: false,
        errorCode: 'SESSION_READ_ONLY',
        execution_state: 'not_executed',
        message: '当前会话处于只读/计划模式,不能执行 ' + name + '。请退出只读模式后再试。',
      };
    }
    const merged = Object.assign({}, params.args, {
      callId: params.callId,
      cli_path: params.cli_path,
      workdir: params.workdir,
    });
    return name === 'auth login-start' ? authLoginStart(merged) : authLoginWait(merged);
  }
  // The raw device-code flow would hand the code to the model, so the direct
  // command stays closed in favour of the orchestrated pair above.
  if (name === 'auth login') {
    return {
      ok: false,
      errorCode: 'UNKNOWN_TOOL',
      execution_state: 'not_executed',
      message: '登录请用 call_tool(name:"auth login-start"),完成授权链接展示后立即用 auth login-wait 轮询;'
        + '插件的登录编排不把设备码交给模型。',
    };
  }

  const index = await exclusionIndex(runOpts);
  // An alias whose canonical operation cannot be resolved is unclassifiable:
  // it might be the very route into an excluded service, so it fails closed.
  if (tokens[0].indexOf(':') >= 0 && !index.aliasListLoaded) {
    return {
      ok: false,
      errorCode: 'CATALOG_UNAVAILABLE',
      execution_state: 'not_executed',
      message: '无法读取 CLI 的别名清单,因此无法确认 "' + tokens[0] + '" 指向的操作是否在本插件范围内;'
        + '请稍后重试,或改用 list_tools() 列出的完整命令名。',
    };
  }
  if (index.names.has(tokens[0]) || isExcluded(index, tokens[0])) {
    return {
      ok: false,
      errorCode: 'UNKNOWN_TOOL',
      execution_state: 'not_executed',
      message: '"' + tokens[0] + '" 不在本插件提供的范围内(数据查询与 CLI 自更新不由本插件提供)。用 list_tools() 看可用命令。',
    };
  }

  let alias = null;
  if (index.aliases.has(tokens[0])) {
    try {
      const aliases = await getAliases(runOpts);
      alias = aliases.list.find((a) => a.alias === tokens[0]) || null;
    } catch (err) {
      return catalogFailure(err);
    }
  }
  // Membership is decided by the CLI's own command tree, so a command the CLI
  // gained is callable without a plugin release. `_help` is exempt: asking for
  // help never executes anything, and it must stay available even for a command
  // the cached tree does not know yet.
  if (args._help !== true && !alias) {
    let found = false;
    try {
      if (tokens.length === 1) {
        const top = await childrenAt(runOpts, []);
        found = top.children.some((child) => child.name === tokens[0]);
      } else {
        const siblings = await childrenAt(runOpts, tokens.slice(0, -1));
        found = siblings.children.some((child) => child.name === tokens[tokens.length - 1]);
      }
    } catch (err) {
      return catalogFailure(err);
    }
    if (!found) {
      return {
        ok: false,
        errorCode: 'UNKNOWN_TOOL',
        message: '未知操作 "' + name + '";先用 list_tools() 看顶层命令,或传 category 逐层下钻(如 category:"asset-library ai-image")。',
      };
    }
  }

  // auth status defaults to human-readable text; its documented agent contract
  // is structured JSON, so append --json unless explicitly suppressed.
  if (name === 'auth status' && args.json === undefined) args.json = true;

  // Risk resolution, in order: the operations the worker orchestrates itself,
  // then the CLI's own metadata (aliases resolve through their canonical
  // operation), then the `Risk:` line of the command's `--help`. Anything still
  // unknown fails closed to a write, so the confirmation gate never silently
  // opens for a command nobody could classify.
  let risk = null;
  let riskTokens = tokens;
  if (ORCHESTRATED_RISKS.has(name)) {
    risk = ORCHESTRATED_RISKS.get(name);
  } else {
    try {
      riskTokens = await riskPathTokens(runOpts, tokens, args);
    } catch (err) {
      if (err && err.code) return catalogFailure(err);
    }
  }
  const pathKey = riskTokens.join(' ');
  const referenceOnly = DOCUMENTATION_PATHS.has(pathKey);
  if (referenceOnly) {
    // Printing documentation is the whole of what these paths do.
    risk = 'read';
  } else if (ORCHESTRATED_RISKS.has(name)) {
    risk = ORCHESTRATED_RISKS.get(name);
  } else if (alias) {
    try {
      const services = await getCatalog(runOpts);
      const op = services.get(alias.canonical.split(' ')[0]);
      const found = op && op.find((item) => item.name === alias.canonical);
      risk = (found && found._meta && found._meta.risk) || null;
    } catch (err) {
      return catalogFailure(err);
    }
  } else {
    try {
      const services = await getCatalog(runOpts);
      const op = services.get(tokens[0]);
      const found = op && op.find((item) => item.name === name);
      risk = (found && found._meta && found._meta.risk) || null;
    } catch (err) {
      return catalogFailure(err);
    }
    if (!risk) {
      try {
        risk = await helpRisk(runOpts, riskTokens);
      } catch (err) {
        if (err && err.code) return catalogFailure(err);
        risk = null;
      }
    }
  }
  if (!risk) risk = 'write';
  if (risk !== 'read' && params.read_only === true) {
    return {
      ok: false,
      errorCode: 'SESSION_READ_ONLY',
      execution_state: 'not_executed',
      message: '当前会话处于只读/计划模式,不能执行 ' + name + '(' + risk + ')。请退出只读模式后再试。',
    };
  }
  // `_help` only prints the command's own documentation: it never executes the
  // operation, so neither the confirmation gate nor the workdir requirement
  // applies to it.
  const helpOnly = args._help === true;
  // The workdir check runs before the confirmation gate: a call that cannot run
  // here at all should say so, rather than ask the user to approve it first.
  // Only heads that can actually name a local file need the confinement root,
  // and it has to be usable — a directory that was deleted or unmounted since
  // the session started is no root at all.
  const workdirUsable = Boolean(runOpts.cwd) && fs.existsSync(runOpts.cwd);
  const noFileOperands = referenceOnly || IDENTIFIER_OPERAND_HEADS.has(tokens[0]);
  if (!helpOnly && !noFileOperands && needsLocalFiles(args) && !workdirUsable) {
    return {
      ok: false,
      errorCode: 'WORKDIR_REQUIRED',
      execution_state: 'not_executed',
      message: '该调用包含本地文件参数,但当前会话没有可用的本地工作目录'
        + (runOpts.cwd ? '(' + runOpts.cwd + ' 不存在或已卸载)' : '')
        + ';CLI 以会话工作目录为基准限定文件路径,没有它就无法安全执行。请在带本地工作目录的会话里重试。',
    };
  }
  if (!helpOnly && risk !== 'read' && args.yes !== true && args.dry_run !== true) {
    return {
      ok: false,
      errorCode: 'CONFIRM_REQUIRED',
      execution_state: 'not_executed',
      message: '操作 ' + name + ' 的风险级别是 ' + risk + ',需要先取得用户明确同意:先用 dry_run:true 预览,用户确认后再用相同参数加 yes:true 执行。',
    };
  }
  // Reject any plugin control key other than the documented ones, so an agent
  // cannot smuggle arbitrary CLI arguments through an undocumented channel.
  for (const k of Object.keys(args)) {
    if (k === 'callId' || k === '_positional' || k === '_help' || k === '_timeout_seconds') continue;
    if (k.charAt(0) === '_') {
      return {
        ok: false,
        errorCode: 'INVALID_ARGS',
        execution_state: 'not_executed',
        message: '不支持的控制参数 ' + k + ';请用结构化参数(scope / data / flag 键)或 _positional 传参。',
      };
    }
  }

  const built = buildArgv(tokens, args);
  if (built.error) {
    return {
      ok: false,
      errorCode: 'INVALID_ARGS',
      execution_state: 'not_executed',
      message: built.error,
    };
  }
  const argv = built.argv;
  const timeoutMs = args._timeout_seconds ? Number(args._timeout_seconds) * 1000 : DEFAULT_TIMEOUT_MS;
  const res = await runBinary(argv, {
    timeoutMs,
    callId: params && params.callId,
    label: name,
    cliPath: runOpts.cliPath,
    cwd: runOpts.cwd,
  });

  const env = parseEnvelope(res.stdout, res.stderr);
  // Every failure path states whether the operation reached the server, because
  // several external operations here (uploads, review submission, publishing)
  // cannot be undone. Not-run is safe to retry; unknown must be checked first.
  const isWrite = Boolean(risk && risk !== 'read');
  const unknownForWrite = isWrite ? 'unknown' : 'not_executed';

  if (res.cliUnavailable) {
    return {
      ok: false,
      errorCode: res.cliErrorCode || 'CLI_NOT_INSTALLED',
      execution_state: 'not_executed',
      message: res.message,
    };
  }
  if (res.maxBufferExceeded) {
    return {
      ok: false,
      errorCode: 'RESULT_TOO_LARGE',
      execution_state: unknownForWrite,
      message: '命令输出超过单次返回上限' + (isWrite
        ? ',且本次是写操作,是否已在服务端生效不确定:请先用只读方式核对实际状态,确认未生效再重试,不要直接重跑。'
        : ';请收窄查询(如减小 page_size、指定更短时间范围或更精确的过滤条件)后重试。'),
    };
  }
  if (res.killed) {
    return {
      ok: false,
      errorCode: 'TIMEOUT',
      execution_state: unknownForWrite,
      message: '命令在 ' + Math.round(timeoutMs / 1000) + ' 秒后超时。' + (isWrite
        ? '该写操作可能已经在服务端生效,结果不确定:请先用只读方式核对实际状态(上传类可用 task +list 查看已有任务),确认未生效再重试,不要直接重跑;也可用 args._timeout_seconds(最大 870)放宽超时后重试。'
        : '只读操作没有副作用,可用 args._timeout_seconds(最大 870)放宽超时后重试。'),
      data: env || undefined,
    };
  }
  if (res.code === 10) {
    return {
      ok: false,
      errorCode: 'CONFIRM_REQUIRED',
      execution_state: 'not_executed',
      message: 'CLI 确认门禁(exit 10):该写操作需要用户明确同意后,以相同参数加 yes:true 重试;--yes 不代表用户同意协议。',
      data: env || undefined,
    };
  }
  if (res.code !== 0) {
    // A structured CLI error usually means the CLI decided the outcome (safe to
    // treat as not-executed). But the CLI can also report an ambiguous outcome —
    // e.g. subtype "ambiguous_outcome" on a 409 — where it does not know whether
    // a write was applied; those must stay unknown so the agent verifies first.
    // A bare non-zero exit with no envelope (crash, signal, killed helper) is
    // likewise indeterminate for a write.
    const err = env && env.ok === false && env.error ? env.error : null;
    let ambiguous = Boolean(err) && /ambiguous|unknown|indeterminate/i.test(String(err.subtype || '') + String(err.type || ''));
    // A batch can fail after some items already succeeded: the manual tells the
    // agent to keep the handles that came back and retry only the items without
    // one. Calling that "not executed" would invite a full re-run and duplicate
    // uploads, so any failure payload that still carries results stays unknown.
    const carriesResults = Boolean(env && env.data) && typeof env.data === 'object'
      && Object.keys(env.data).length > 0;
    if (isWrite && carriesResults) ambiguous = true;
    const state = (err && !ambiguous) ? 'not_executed' : unknownForWrite;
    return {
      ok: false,
      // The envelope says the operation was refused; without one, all the CLI
      // told us is that it exited non-zero.
      errorCode: err ? 'BUSINESS_ERROR' : 'CLI_FAILED',
      exit_code: res.code,
      execution_state: state,
      message: briefFailure(res, env) + (state === 'unknown'
        ? ';该写操作是否已在服务端生效不确定:请先核对实际状态再决定是否重试,不要直接重跑。'
        : ''),
      data: env || { raw: clip(res.stdout + res.stderr, 20 * 1024) },
    };
  }
  return {
    ok: true,
    data: {
      name,
      duration_ms: res.durationMs,
      envelope: env || { raw: clip(res.stdout) },
      stderr: res.stderr ? clip(res.stderr.trim(), 4000) : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// settings-page status probe
//
// The settings page shows whether the CLI is installed, which version it is,
// and whether the user is logged in. This function is the only place that
// decides those three, so main.js relays and settings.js renders without
// re-deriving any of them.
//
// `auth status --offline --json` reads the local credential store without
// network access, which is what a panel that runs on page load needs — the
// online form would make the panel fail whenever the machine is offline.

function envelopeData(res) {
  if (res.cliUnavailable) return { error: res.message || 'taptap-cli 不可用。' };
  const env = parseEnvelope(res.stdout, res.stderr);
  if (!env) return { error: 'CLI 返回了无法解析的输出。' };
  if (env.ok !== true) {
    return { error: (env.error && (env.error.message || env.error.type)) || 'CLI 返回了失败结果。' };
  }
  return { data: env.data };
}

async function cliStatus(params) {
  const cliPath = (params || {}).cli_path;
  const resolved = resolveCli(cliPath);
  if (!resolved.cmd) {
    const err = resolved.error || {};
    return {
      ok: true,
      data: {
        installed: false,
        errorCode: err.code || 'CLI_NOT_INSTALLED',
        message: err.message || 'taptap-cli 不可用。',
      },
    };
  }

  // Both probes must run the same binary the check above resolved, so a
  // configured path cannot report "installed" while the version and sign-in
  // rows are read from a different taptap-cli on PATH.
  const [versionRes, authRes] = await Promise.all([
    runBinary(['version'], { timeoutMs: 30000, label: '读取 CLI 版本', cliPath: cliPath }),
    runBinary(['auth', 'status', '--offline', '--json'], { timeoutMs: 30000, label: '读取登录态', cliPath: cliPath }),
  ]);

  // A field that cannot be read is reported as null plus its own reason, so a
  // failing version probe never blanks out the login row.
  const result = { installed: true, version: null, logged_in: null };

  const version = envelopeData(versionRes);
  if (version.data && typeof version.data.version === 'string') result.version = version.data.version;
  else result.version_error = version.error || 'CLI 未返回版本号。';

  const auth = envelopeData(authRes);
  if (auth.data && typeof auth.data === 'object') {
    // Offline status describes the local credential store: a token that exists
    // and has not expired is what the panel means by "logged in".
    result.logged_in = auth.data.hasAccessToken === true && auth.data.accessTokenExpired === false;
  } else {
    result.login_error = auth.error || 'CLI 未返回登录态。';
  }

  return { ok: true, data: result };
}

// ---------------------------------------------------------------------------
// main loop

function handle(req, fn) {
  Promise.resolve()
    .then(() => fn(req.params || {}))
    .then((result) => reply(req.id, result))
    .catch((err) => {
      log('error: ' + ((err && err.stack) || err));
      reply(req.id, {
        ok: false,
        errorCode: 'INTERNAL',
        // An exception thrown while running call_tool may have happened before
        // or after the CLI started (execFile rejecting an argument, for
        // example), so the outcome is unknown; listing reads nothing.
        execution_state: req.method === 'taptap/call_tool' ? 'unknown' : 'not_executed',
        message: 'worker 内部错误:' + ((err && err.message) || String(err)),
      });
    });
}

readline.createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let req;
  try {
    req = JSON.parse(text);
  } catch (_) {
    log('ignoring non-JSON line');
    return;
  }
  if (!req || typeof req.method !== 'string') return;
  if (req.method === 'taptap/list_tools') return handle(req, listTools);
  if (req.method === 'taptap/call_tool') return handle(req, callTool);
  if (req.method === 'taptap/cli_status') return handle(req, cliStatus);
  if (req.method === 'ping') return reply(req.id, { ok: true, pong: true });
  reply(req.id, { ok: false, errorCode: 'METHOD_NOT_FOUND', message: '未知方法 ' + req.method });
});

log('worker ready, plugin root: ' + PLUGIN_ROOT);
