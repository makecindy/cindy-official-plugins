/**
 * GitHub · 电子脑 —— 内置的 GitHub 服务意识(PAT 模式,仅 github.com)。
 *
 * id/指令保留 cindy- 官方命名空间；显示名直接使用 GitHub。
 *
 * 工作方式:
 * - 域名白名单代发:cindy.fetch 只能到 ghost.json 声明的域名,请求由主机代发,
 *   沙箱零直连;PAT 由主机保险库保管,只注入 api.github.com 的 Authorization,
 *   本文件没有也不可能有任何 token 字节;
 * - 工具面 = 两段式目录(FORGE_GUIDE §3.5):只声明 list_tools / call_tool 两个
 *   元工具,117 个操作按 15 个类目放在本文件的 OPS 表里——与老 lizi_github MCP
 *   的渐进式外形一致,主 agent 零学习成本;改工具只更新意识、不发应用版本;
 * - repo 级操作必须显式传 owner/repo:沙箱无文件系统,不能像老 MCP 那样从会话
 *   workdir 的 git remote 推导,由主 agent 自己推导后传入;
 * - 交卷护栏:默认递归剥掉 GitHub 响应里的 API 链接字段(url / *_url,保留
 *   html_url)压体量;超 50KB(或调用方点名 out_file)时经 fs 槽把完整 JSON 写进
 *   会话工作目录只交路径——老 MCP out_file 泄洪的等价回归(2026-07 fs 槽上线后),
 *   写盘不可用(plan 模式 / SSH 远程工作区)才回落截断;call_tool 传 raw=true
 *   拿原样 JSON(写盘内容与内联同口径,raw 决定剥不剥);
 * - Actions 产物 / 日志 zip:老 MCP 只返回 302 签名地址,这里升级为真下载落盘
 *   (as:'file' + save_dir 票据;GitHub 的下载跳转域已进白名单)。
 */

/* global cindy */

var API = 'https://api.github.com';
/** 交卷体量护栏(与 xd-atlassian 同款)。 */
var RESULT_MAX_CHARS = 50 * 1000;

/* ── 基础工具 ───────────────────────────────────────────────────────── */

function fail(message) {
  return { ok: false, message: message };
}

function qs(params) {
  var parts = [];
  for (var k in params) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    var v = params[k];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v[i])));
    } else {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/** 分页参数透传(GitHub 通用 per_page / page)。 */
function pg(a) {
  return { per_page: a.per_page, page: a.page };
}

/** path 里的多段路径逐段编码(get_contents 等 path 含 / 的场景)。 */
function encPath(p) {
  return String(p)
    .split('/')
    .map(function (seg) { return encodeURIComponent(seg); })
    .join('/');
}

/** HTTP 状态 → 人话(401 到这里 = token 没填或已失效)。 */
function classifyStatus(status, bodySnippet) {
  if (status === 401) return 'GitHub token 未配置或已失效,请用户到主界面侧边栏「插件」→「GitHub」详情页填入 Personal Access Token';
  if (status === 403) {
    if (bodySnippet && bodySnippet.indexOf('rate limit') >= 0) return 'GitHub 接口限流(HTTP 403 rate limit),请稍后重试';
    return '没有权限(HTTP 403,token scope 不够或无该仓库权限):' + bodySnippet;
  }
  if (status === 404) return '对象不存在或无访问权(HTTP 404)';
  if (status === 422) return 'GitHub 拒绝了请求参数(HTTP 422):' + bodySnippet;
  if (status === 429) return 'GitHub 接口限流(HTTP 429),请稍后重试';
  return 'GitHub API 返回 HTTP ' + status + ':' + bodySnippet;
}

/**
 * 统一的 GitHub REST 调用。凭证由主机注入,这里只管 URL / 方法 / 体。
 * 成功 { data, status, headers },失败 { err }。
 */
async function api(opts) {
  var req = {
    url: opts.url,
    method: opts.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    callId: opts.callId,
  };
  if (opts.body !== undefined) {
    req.headers['Content-Type'] = 'application/json';
    req.body = JSON.stringify(opts.body);
  }
  var r = await cindy.fetch(req);
  if (!r.ok) return { err: r.message };
  var data = null;
  if (r.body) {
    try {
      data = JSON.parse(r.body);
    } catch (e) {
      data = r.body;
    }
  }
  if (r.status < 200 || r.status >= 300) {
    var snippet = typeof r.body === 'string' ? r.body.slice(0, 300) : '';
    return { err: classifyStatus(r.status, snippet) };
  }
  return { data: data, status: r.status, headers: r.headers || {} };
}

/** GraphQL 调用(github.com 固定 /graphql;errors 非空视为失败)。 */
async function gql(query, variables, callId) {
  var r = await api({ url: API + '/graphql', method: 'POST', body: { query: query, variables: variables || {} }, callId: callId });
  if (r.err) return { err: r.err };
  var d = r.data;
  if (d && Array.isArray(d.errors) && d.errors.length) {
    return { err: 'GitHub GraphQL 错误:' + JSON.stringify(d.errors).slice(0, 500) };
  }
  if (!d || d.data === undefined) return { err: 'GitHub GraphQL 响应缺少 data' };
  return { data: d.data };
}

/**
 * 瘦身:GitHub 响应约一半体量是 API 链接字段,对 LLM 无用——递归剥掉 url /
 * *_url 与 gravatar_id。保留三个有真实用途的链接:html_url(人看的页面)、
 * download_url / browser_download_url(get_contents 大文件与 release 资产的
 * 下载地址,剥了操作自述就成空话)。raw=true 时跳过。
 */
var SLIM_KEEP_URLS = { html_url: 1, download_url: 1, browser_download_url: 1 };

function slim(value) {
  if (Array.isArray(value)) return value.map(slim);
  if (value && typeof value === 'object') {
    var out = {};
    for (var k in value) {
      if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
      if (k === 'gravatar_id') continue;
      if (k === 'url' || (k.length > 4 && k.slice(-4) === '_url' && !SLIM_KEEP_URLS[k])) continue;
      out[k] = slim(value[k]);
    }
    return out;
  }
  return value;
}

/**
 * 交卷:默认瘦身;超长(或调用方点名 out_file)时经 fs 槽把完整 JSON 写进会话
 * 工作目录,只交回文件路径——老 MCP out_file 泄洪的等价回归(agent 拿相对路径
 * 自己读/交给脚本)。写盘跟随会话权限模式(免批模式静默、逐条模式主机会弹
 * 确认卡),被拒/失败/远程工作区时回落截断 + 分页提示。
 */
async function deliver(data, raw, outFile, callId) {
  var payload = raw ? data : slim(data === undefined ? null : data);
  var text = JSON.stringify(payload === undefined ? null : payload);
  if (!outFile && text.length <= RESULT_MAX_CHARS) return { ok: true, result: { data: payload } };
  var spillNote = null;
  if (callId) {
    var fileName = outFile || 'github-result-' + String(callId).slice(0, 8) + '.json';
    var w = await cindy.send({
      type: 'fs-request', op: 'write', root: 'workdir',
      path: fileName, content: text, callId: callId,
    });
    if (w && w.ok) {
      return {
        ok: true,
        result: {
          saved_to: w.path,
          bytes: w.bytes,
          hint: '完整结果已写入会话工作目录的该相对路径,用文件工具读取或交给脚本处理',
        },
      };
    }
    spillNote = w && w.message ? '落盘未成功(' + w.message + ')' : '落盘未成功';
  }
  if (text.length <= RESULT_MAX_CHARS) {
    // 点名 out_file 但写盘被拒/失败,体量本身不超:内联交卷并如实附注。
    return { ok: true, result: { data: payload, note: spillNote } };
  }
  return {
    ok: true,
    result: {
      truncated: true,
      hint:
        (spillNote ? spillNote + ';' : '') +
        '响应过大已截断——用 per_page / page 分页,或换更窄的操作(如 get 单条)',
      preview: text.slice(0, RESULT_MAX_CHARS),
    },
  };
}

/** repo 级操作的 owner/repo 校验与 base 拼装。 */
function repoBase(a) {
  if (!a.owner || !a.repo) {
    return { err: 'repo 级操作必须显式传 owner 与 repo(在 git 仓库里工作时,主 agent 可用 `git remote get-url origin` 推导后传入)' };
  }
  return { base: API + '/repos/' + encodeURIComponent(a.owner) + '/' + encodeURIComponent(a.repo) };
}

/** 下载 zip(Actions 产物 / 日志)到用户目录:须 save_dir 票据。 */
async function downloadZip(url, a, callId, suggestedName) {
  if (!a.save_deposit || !a.save_deposit.token) {
    return { err: '下载需要落盘目录——请主 agent 调 ghost_call 时把目标目录绝对路径放在顶层 save_dir 参数' };
  }
  var r = await cindy.fetch({
    url: url,
    as: 'file',
    saveTo: { token: a.save_deposit.token, filename: a.filename || suggestedName },
    timeoutMs: 300000,
    callId: callId,
  });
  if (!r.ok) return { err: r.message };
  if (!r.file) {
    var snippet = typeof r.body === 'string' ? r.body.slice(0, 300) : '';
    return { err: classifyStatus(r.status, snippet) };
  }
  return {
    result: {
      downloaded: true,
      dir_name: a.save_deposit.dir_name,
      file_name: r.file.file_name,
      bytes: r.file.bytes,
      note: '已存到 ' + a.save_deposit.dir_name + '/' + r.file.file_name,
    },
  };
}

/* ── 操作目录 ───────────────────────────────────────────────────────────
 * 每个操作:{ cat, desc, params(参数说明,给 list_tools 与纠错回显), run }。
 * run(a, callId) 返回 { err } | { data } | { result }(result = 已定型交卷体)。
 * 参数记法:* = 必填;[repo] = owner 与 repo 成对必填;pp = per_page?/page?。
 * ──────────────────────────────────────────────────────────────────── */

var REPO_DOC = 'owner*:string, repo*:string(成对必填)';
var PP_DOC = 'per_page?:1-100, page?:int';

var CATEGORIES = {
  issues: 'issue 与评论 / label / assignee / 子 issue',
  pulls: 'PR 全生命周期:创建 / 文件与 commit / review 与行评 / 线程 / 合并',
  repo: '仓库元数据 / 分支 / 文件内容读写 / 协作者 / topics / 建仓',
  meta: '当前用户与 GraphQL 逃生口',
  events: '用户 / org / 仓库事件流',
  commits: 'commit 列表 / 详情 / 比较 / check runs',
  search: '全站搜索:仓库 / issue / commit / 代码 / 用户',
  users: '用户资料 / org / 可访问仓库',
  actions: 'GitHub Actions:workflow / run / job / artifact / 日志下载',
  releases: 'release 与资产',
  notifications: '通知',
  orgs: 'org 成员 / 团队',
  gists: 'gist',
  git_data: '底层 git 对象:ref / tree / commit / 原子多文件提交',
  reactions: 'issue / 评论 / 行评 reaction',
};

var OPS = {};

function op(name, cat, desc, params, run) {
  OPS[name] = { cat: cat, desc: desc, params: params, run: run };
}

/* ── issues(14) ────────────────────────────────────────────────────── */

op('list_issues', 'issues', '列 issue(注意 PR 也会出现在结果里,带 pull_request 字段)',
  REPO_DOC + ', state?:open|closed|all, labels?:string(逗号分隔), sort?:created|updated|comments, direction?:asc|desc, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/issues' + qs({ state: a.state, labels: a.labels, sort: a.sort, direction: a.direction, per_page: a.per_page, page: a.page }), callId: c });
  });

op('get_issue', 'issues', '读单条 issue', REPO_DOC + ', issue_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: '需要 issue_number' };
    return api({ url: r.base + '/issues/' + a.issue_number, callId: c });
  });

op('create_issue', 'issues', '建 issue(写操作,内容先给用户确认)',
  REPO_DOC + ', title*:string, body?:string, labels?:string[], assignees?:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.title) return { err: '需要 title' };
    return api({ url: r.base + '/issues', method: 'POST', body: { title: a.title, body: a.body, labels: a.labels, assignees: a.assignees }, callId: c });
  });

op('list_issue_comments', 'issues', '列 issue/PR 的评论', REPO_DOC + ', issue_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: '需要 issue_number' };
    return api({ url: r.base + '/issues/' + a.issue_number + '/comments?per_page=100', callId: c });
  });

op('add_issue_comment', 'issues', '给 issue/PR 加评论(写操作)', REPO_DOC + ', issue_number*:int, body*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !a.body) return { err: '需要 issue_number / body' };
    return api({ url: r.base + '/issues/' + a.issue_number + '/comments', method: 'POST', body: { body: a.body }, callId: c });
  });

op('update_issue_labels', 'issues', '增量增删 label(先读现有再合并写回)',
  REPO_DOC + ', issue_number*:int, add_labels?:string[], remove_labels?:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: '需要 issue_number' };
    var cur = await api({ url: r.base + '/issues/' + a.issue_number, callId: c });
    if (cur.err) return cur;
    var names = {};
    var labels = (cur.data && cur.data.labels) || [];
    for (var i = 0; i < labels.length; i++) names[typeof labels[i] === 'string' ? labels[i] : labels[i].name] = 1;
    (a.add_labels || []).forEach(function (n) { names[n] = 1; });
    (a.remove_labels || []).forEach(function (n) { delete names[n]; });
    return api({ url: r.base + '/issues/' + a.issue_number, method: 'PATCH', body: { labels: Object.keys(names) }, callId: c });
  });

op('update_issue', 'issues', '改 issue(标题/正文/开关/label/assignee;写操作)',
  REPO_DOC + ', issue_number*:int, title?, body?, state?:open|closed, state_reason?:completed|not_planned|reopened, labels?:string[], assignees?:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: '需要 issue_number' };
    return api({
      url: r.base + '/issues/' + a.issue_number, method: 'PATCH',
      body: { title: a.title, body: a.body, state: a.state, state_reason: a.state_reason, labels: a.labels, assignees: a.assignees },
      callId: c,
    });
  });

op('add_issue_assignees', 'issues', '加 assignee', REPO_DOC + ', issue_number*:int, assignees*:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !Array.isArray(a.assignees) || !a.assignees.length) return { err: '需要 issue_number / assignees' };
    return api({ url: r.base + '/issues/' + a.issue_number + '/assignees', method: 'POST', body: { assignees: a.assignees }, callId: c });
  });

op('remove_issue_assignees', 'issues', '移除 assignee', REPO_DOC + ', issue_number*:int, assignees*:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !Array.isArray(a.assignees) || !a.assignees.length) return { err: '需要 issue_number / assignees' };
    return api({ url: r.base + '/issues/' + a.issue_number + '/assignees', method: 'DELETE', body: { assignees: a.assignees }, callId: c });
  });

op('add_issue_labels', 'issues', '加 label(不动现有的)', REPO_DOC + ', issue_number*:int, labels*:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !Array.isArray(a.labels) || !a.labels.length) return { err: '需要 issue_number / labels' };
    return api({ url: r.base + '/issues/' + a.issue_number + '/labels', method: 'POST', body: { labels: a.labels }, callId: c });
  });

op('remove_issue_label', 'issues', '删单个 label', REPO_DOC + ', issue_number*:int, name*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !a.name) return { err: '需要 issue_number / name' };
    return api({ url: r.base + '/issues/' + a.issue_number + '/labels/' + encodeURIComponent(a.name), method: 'DELETE', callId: c });
  });

op('get_label', 'issues', '取仓库里单个 label 定义', REPO_DOC + ', name*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.name) return { err: '需要 name' };
    return api({ url: r.base + '/labels/' + encodeURIComponent(a.name), callId: c });
  });

op('list_sub_issues', 'issues', '列子 issue', REPO_DOC + ', issue_number*:int, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: '需要 issue_number' };
    return api({ url: r.base + '/issues/' + a.issue_number + '/sub_issues' + qs(pg(a)), callId: c });
  });

op('add_sub_issue', 'issues', '挂子 issue(sub_issue_id 是 issue 的全局 id,不是 number)',
  REPO_DOC + ', issue_number*:int, sub_issue_id*:int, replace_parent?:bool',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !a.sub_issue_id) return { err: '需要 issue_number / sub_issue_id' };
    return api({ url: r.base + '/issues/' + a.issue_number + '/sub_issues', method: 'POST', body: { sub_issue_id: a.sub_issue_id, replace_parent: a.replace_parent }, callId: c });
  });

/* ── pulls(25) ─────────────────────────────────────────────────────── */

op('list_pull_requests', 'pulls', '列 PR',
  REPO_DOC + ', state?:open|closed|all, base?:string, head?:string, sort?:created|updated|popularity|long-running, direction?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/pulls' + qs({ state: a.state, base: a.base, head: a.head, sort: a.sort, direction: a.direction, per_page: a.per_page, page: a.page }), callId: c });
  });

op('get_pull_request', 'pulls', '读单条 PR(含 merged / draft / mergeable 状态)', REPO_DOC + ', pr_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({ url: r.base + '/pulls/' + a.pr_number, callId: c });
  });

op('create_pull_request', 'pulls', '建 PR(写操作;跨 fork 的 head 写 "owner:branch")',
  REPO_DOC + ', title*:string, head*:string, base*:string, body?:string, draft?:bool',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.title || !a.head || !a.base) return { err: '需要 title / head / base' };
    return api({ url: r.base + '/pulls', method: 'POST', body: { title: a.title, head: a.head, base: a.base, body: a.body, draft: a.draft }, callId: c });
  });

op('list_pull_request_files', 'pulls', '列 PR 变更文件(含 patch,大 PR 记得分页)',
  REPO_DOC + ', pr_number*:int, per_page?:1-100(默认100), page?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/files' + qs({ per_page: a.per_page || 100, page: a.page }), callId: c });
  });

op('list_pull_request_commits', 'pulls', '列 PR 的 commit', REPO_DOC + ', pr_number*:int, per_page?(默认100), page?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/commits' + qs({ per_page: a.per_page || 100, page: a.page }), callId: c });
  });

op('list_pull_request_reviews', 'pulls', '列 review(approve / request_changes / comment;node_id 供 pending review 行评用)',
  REPO_DOC + ', pr_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/reviews?per_page=100', callId: c });
  });

op('list_pull_request_review_comments', 'pulls', '列 inline 代码评论', REPO_DOC + ', pr_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/comments?per_page=100', callId: c });
  });

op('merge_pull_request', 'pulls', '合并 PR(写操作,先给用户确认)',
  REPO_DOC + ', pr_number*:int, merge_method?:merge|squash|rebase, commit_title?, commit_message?, sha?:string(head 校验)',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({
      url: r.base + '/pulls/' + a.pr_number + '/merge', method: 'PUT',
      body: { commit_title: a.commit_title, commit_message: a.commit_message, sha: a.sha, merge_method: a.merge_method },
      callId: c,
    });
  });

op('update_pull_request', 'pulls', '改 PR(标题/正文/开关/base;写操作)',
  REPO_DOC + ', pr_number*:int, title?, body?, state?:open|closed, base?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({ url: r.base + '/pulls/' + a.pr_number, method: 'PATCH', body: { title: a.title, body: a.body, state: a.state, base: a.base }, callId: c });
  });

op('create_pull_request_review', 'pulls', '一次性提交 review(可带 inline comments;写操作)',
  REPO_DOC + ', pr_number*:int, event*:APPROVE|REQUEST_CHANGES|COMMENT, body?, commit_id?, comments?:[{path*, line?, side?:LEFT|RIGHT, position?, body*}]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.event) return { err: '需要 pr_number / event' };
    return api({
      url: r.base + '/pulls/' + a.pr_number + '/reviews', method: 'POST',
      body: { event: a.event, body: a.body, commit_id: a.commit_id, comments: a.comments },
      callId: c,
    });
  });

op('create_pull_request_review_comment', 'pulls', '建单条 inline 评论(写操作)',
  REPO_DOC + ', pr_number*:int, body*, commit_id*, path*, line*:int, side?:LEFT|RIGHT, start_line?:int, start_side?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.body || !a.commit_id || !a.path || !a.line) return { err: '需要 pr_number / body / commit_id / path / line' };
    return api({
      url: r.base + '/pulls/' + a.pr_number + '/comments', method: 'POST',
      body: { body: a.body, commit_id: a.commit_id, path: a.path, line: a.line, side: a.side, start_line: a.start_line, start_side: a.start_side },
      callId: c,
    });
  });

op('reply_pull_request_review_comment', 'pulls', '回复某条 inline 评论(自动定位线程根)',
  REPO_DOC + ', pr_number*:int, comment_id*:int, body*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.comment_id || !a.body) return { err: '需要 pr_number / comment_id / body' };
    var got = await api({ url: r.base + '/pulls/comments/' + a.comment_id, callId: c });
    if (got.err) return got;
    var rootId = (got.data && got.data.in_reply_to_id) || a.comment_id;
    return api({ url: r.base + '/pulls/' + a.pr_number + '/comments/' + rootId + '/replies', method: 'POST', body: { body: a.body }, callId: c });
  });

op('request_pull_request_reviewers', 'pulls', '请求 reviewer', REPO_DOC + ', pr_number*:int, reviewers?:string[], team_reviewers?:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/requested_reviewers', method: 'POST', body: { reviewers: a.reviewers, team_reviewers: a.team_reviewers }, callId: c });
  });

op('remove_pull_request_reviewers', 'pulls', '移除已请求的 reviewer', REPO_DOC + ', pr_number*:int, reviewers?:string[], team_reviewers?:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/requested_reviewers', method: 'DELETE', body: { reviewers: a.reviewers, team_reviewers: a.team_reviewers }, callId: c });
  });

op('list_pull_request_requested_reviewers', 'pulls', '列已请求还没 review 的 reviewer', REPO_DOC + ', pr_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/requested_reviewers', callId: c });
  });

op('create_pending_pull_request_review', 'pulls', '开一个 pending review(之后用 add_pending_pull_request_review_comment 攒行评,最后 submit)',
  REPO_DOC + ', pr_number*:int, body?, commit_id?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/reviews', method: 'POST', body: { body: a.body, commit_id: a.commit_id }, callId: c });
  });

op('add_pending_pull_request_review_comment', 'pulls', '往 pending review 加 inline 评论(GraphQL;review_node_id 是 review 的 node_id,PRR_ 开头)',
  REPO_DOC + ', review_node_id*:string, body*, path*, line*:int, side?:LEFT|RIGHT, start_line?, start_side?, subject_type?:LINE|FILE',
  async function (a, c) {
    if (!a.review_node_id || !a.body || !a.path) return { err: '需要 review_node_id / body / path' };
    if (a.subject_type !== 'FILE' && !a.line) return { err: 'LINE 级评论需要 line' };
    var input = {
      pullRequestReviewId: a.review_node_id,
      body: a.body,
      path: a.path,
    };
    if (a.subject_type) input.subjectType = a.subject_type;
    if (a.line) input.line = a.line;
    if (a.side) input.side = a.side;
    if (a.start_line) input.startLine = a.start_line;
    if (a.start_side) input.startSide = a.start_side;
    return gql(
      'mutation($input: AddPullRequestReviewThreadInput!) { addPullRequestReviewThread(input: $input) { thread { id } } }',
      { input: input }, c,
    );
  });

op('submit_pending_pull_request_review', 'pulls', '提交 pending review(写操作)',
  REPO_DOC + ', pr_number*:int, review_id*:int, event*:APPROVE|REQUEST_CHANGES|COMMENT, body?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.review_id || !a.event) return { err: '需要 pr_number / review_id / event' };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/reviews/' + a.review_id + '/events', method: 'POST', body: { event: a.event, body: a.body }, callId: c });
  });

op('delete_pending_pull_request_review', 'pulls', '删 pending review', REPO_DOC + ', pr_number*:int, review_id*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.review_id) return { err: '需要 pr_number / review_id' };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/reviews/' + a.review_id, method: 'DELETE', callId: c });
  });

op('dismiss_pull_request_review', 'pulls', 'dismiss 一条已提交的 review(写操作)',
  REPO_DOC + ', pr_number*:int, review_id*:int, message*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.review_id || !a.message) return { err: '需要 pr_number / review_id / message' };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/reviews/' + a.review_id + '/dismissals', method: 'PUT', body: { message: a.message }, callId: c });
  });

op('list_pull_request_review_threads', 'pulls', '列 review 线程(GraphQL;含 resolved/outdated、path/line、每线程前 50 条评论、分页 cursor)',
  REPO_DOC + ', pr_number*:int, first?:int(默认50,≤100), after?:string(上一页 endCursor)',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    var first = Math.min(100, Math.max(1, a.first || 50));
    var out = await gql(
      'query($owner: String!, $repo: String!, $number: Int!, $first: Int!, $after: String) {' +
      ' repository(owner: $owner, name: $repo) { pullRequest(number: $number) {' +
      '  reviewThreads(first: $first, after: $after) {' +
      '   pageInfo { hasNextPage endCursor }' +
      '   nodes { id isResolved isOutdated path line startLine diffSide' +
      '    comments(first: 50) { totalCount nodes { id databaseId author { login } body createdAt url } } } } } } }',
      { owner: a.owner, repo: a.repo, number: a.pr_number, first: first, after: a.after || null }, c,
    );
    if (out.err) return out;
    var repo = out.data && out.data.repository;
    var pr = repo && repo.pullRequest;
    if (!pr) return { err: '对象不存在或无访问权(HTTP 404)' };
    return { data: pr.reviewThreads };
  });

op('resolve_review_thread', 'pulls', 'resolve 一条 review 线程(GraphQL;thread_id 是 PRRT_ 开头的 node id)', 'thread_id*:string',
  async function (a, c) {
    if (!a.thread_id) return { err: '需要 thread_id(list_pull_request_review_threads 可查)' };
    return gql('mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }', { id: a.thread_id }, c);
  });

op('unresolve_review_thread', 'pulls', 'unresolve 一条 review 线程(GraphQL)', 'thread_id*:string',
  async function (a, c) {
    if (!a.thread_id) return { err: '需要 thread_id' };
    return gql('mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }', { id: a.thread_id }, c);
  });

op('update_pull_request_branch', 'pulls', '把 base 最新代码合入 PR head 分支(202 受理)',
  REPO_DOC + ', pr_number*:int, expected_head_sha?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    var out = await api({ url: r.base + '/pulls/' + a.pr_number + '/update-branch', method: 'PUT', body: a.expected_head_sha ? { expected_head_sha: a.expected_head_sha } : {}, callId: c });
    if (out.err) return out;
    return { data: out.data || { updated: true } };
  });

op('request_copilot_review', 'pulls', '把 Copilot bot 加为 reviewer', REPO_DOC + ', pr_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: '需要 pr_number' };
    return api({
      url: r.base + '/pulls/' + a.pr_number + '/requested_reviewers', method: 'POST',
      body: { reviewers: ['copilot-pull-request-reviewer[bot]'] }, callId: c,
    });
  });

/* ── repo(22) ──────────────────────────────────────────────────────── */

op('list_branches', 'repo', '列分支(单页 100)', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/branches?per_page=100', callId: c });
  });

op('list_labels', 'repo', '列仓库 label(单页 100)', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/labels?per_page=100', callId: c });
  });

op('ensure_labels', 'repo', '确保 label 存在(缺的按默认色创建,已有的跳过)', REPO_DOC + ', names*:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!Array.isArray(a.names) || !a.names.length) return { err: '需要 names(至少一个)' };
    var cur = await api({ url: r.base + '/labels?per_page=100', callId: c });
    if (cur.err) return cur;
    var have = {};
    (cur.data || []).forEach(function (l) { have[l.name] = 1; });
    var created = [];
    for (var i = 0; i < a.names.length; i++) {
      var n = a.names[i];
      if (have[n]) continue;
      var made = await api({ url: r.base + '/labels', method: 'POST', body: { name: n, color: '428BCA' }, callId: c });
      // 422 = 并发下已存在,视同成功跳过;其它错误如实反馈。
      if (made.err && made.err.indexOf('422') < 0) return made;
      if (!made.err) created.push(n);
    }
    return { data: { ensured: a.names, created: created } };
  });

op('get_repo', 'repo', '仓库元信息(默认分支/可见性/权限等)', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base, callId: c });
  });

op('list_tags', 'repo', '列 tag', REPO_DOC + ', ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/tags' + qs(pg(a)), callId: c });
  });

op('get_readme', 'repo', '读 README(content 为 base64)', REPO_DOC + ', ref?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/readme' + qs({ ref: a.ref }), callId: c });
  });

op('list_deployments', 'repo', '列 deployment', REPO_DOC + ', sha?, ref?, task?, environment?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/deployments' + qs({ sha: a.sha, ref: a.ref, task: a.task, environment: a.environment, per_page: a.per_page, page: a.page }), callId: c });
  });

op('get_contents', 'repo', '读文件内容(base64)或目录列表;大文件(>1MB)只回 download_url 元数据',
  REPO_DOC + ', path?:string(默认仓库根), ref?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/contents/' + (a.path ? encPath(a.path) : '') + qs({ ref: a.ref }), callId: c });
  });

op('list_repo_topics', 'repo', '列 topics', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/topics', callId: c });
  });

op('replace_repo_topics', 'repo', '整表替换 topics(写操作,传空数组=清空)', REPO_DOC + ', names*:string[](可空数组)',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!Array.isArray(a.names)) return { err: '需要 names(数组,可为空)' };
    return api({ url: r.base + '/topics', method: 'PUT', body: { names: a.names }, callId: c });
  });

op('list_repo_contributors', 'repo', '列贡献者', REPO_DOC + ', anon?:bool, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/contributors' + qs({ anon: a.anon, per_page: a.per_page, page: a.page }), callId: c });
  });

op('list_repo_languages', 'repo', '语言字节统计', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/languages', callId: c });
  });

op('list_stargazers', 'repo', '列 star 用户', REPO_DOC + ', ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/stargazers' + qs(pg(a)), callId: c });
  });

op('list_forks', 'repo', '列 fork', REPO_DOC + ', sort?:newest|oldest|stargazers|watchers, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/forks' + qs({ sort: a.sort, per_page: a.per_page, page: a.page }), callId: c });
  });

op('create_fork', 'repo', 'fork 仓库(写操作)', REPO_DOC + ', organization?, name?, default_branch_only?:bool',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/forks', method: 'POST', body: { organization: a.organization, name: a.name, default_branch_only: a.default_branch_only }, callId: c });
  });

op('list_repo_collaborators', 'repo', '列协作者', REPO_DOC + ', affiliation?:outside|direct|all, permission?:pull|triage|push|maintain|admin, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/collaborators' + qs({ affiliation: a.affiliation, permission: a.permission, per_page: a.per_page, page: a.page }), callId: c });
  });

op('list_repo_hooks', 'repo', '列 webhook(单页 100)', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/hooks?per_page=100', callId: c });
  });

op('list_branch_protection', 'repo', '读分支保护设置(未保护返回 404)', REPO_DOC + ', branch*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.branch) return { err: '需要 branch' };
    return api({ url: r.base + '/branches/' + encodeURIComponent(a.branch) + '/protection', callId: c });
  });

op('create_or_update_file_contents', 'repo', '建/改单文件(content 必须是 base64;改文件必须带当前 blob sha;写操作)',
  REPO_DOC + ', path*, message*, content*:base64, sha?(改文件必填), branch?, committer?:{name*,email*}, author?:{name*,email*}',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.path || !a.message || !a.content) return { err: '需要 path / message / content(base64)' };
    return api({
      url: r.base + '/contents/' + encPath(a.path), method: 'PUT',
      body: { message: a.message, content: a.content, sha: a.sha, branch: a.branch, committer: a.committer, author: a.author },
      callId: c,
    });
  });

op('delete_file', 'repo', '删单文件(必须带当前 blob sha;写操作)',
  REPO_DOC + ', path*, message*, sha*, branch?, committer?, author?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.path || !a.message || !a.sha) return { err: '需要 path / message / sha' };
    return api({
      url: r.base + '/contents/' + encPath(a.path), method: 'DELETE',
      body: { message: a.message, sha: a.sha, branch: a.branch, committer: a.committer, author: a.author },
      callId: c,
    });
  });

op('create_repository', 'repo', '建仓库(写操作;org 参数存在时建在该 org 下)',
  'name*, description?, private?:bool, auto_init?:bool, org?, homepage?, has_issues?, has_projects?, has_wiki?, gitignore_template?, license_template?',
  async function (a, c) {
    if (!a.name) return { err: '需要 name' };
    var body = {
      name: a.name, description: a.description, private: a.private, auto_init: a.auto_init,
      homepage: a.homepage, has_issues: a.has_issues, has_projects: a.has_projects, has_wiki: a.has_wiki,
      gitignore_template: a.gitignore_template, license_template: a.license_template,
    };
    var url = a.org ? API + '/orgs/' + encodeURIComponent(a.org) + '/repos' : API + '/user/repos';
    return api({ url: url, method: 'POST', body: body, callId: c });
  });

op('get_tag', 'repo', '取 tag 的 ref 对象', REPO_DOC + ', tag*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.tag) return { err: '需要 tag' };
    // 与 get_ref/create_branch 同口径用 encPath:tag 名带 / 时逐段编码才打得到。
    return api({ url: r.base + '/git/ref/tags/' + encPath(a.tag), callId: c });
  });

/* ── meta(2) ───────────────────────────────────────────────────────── */

op('get_current_user', 'meta', '当前 token 对应的用户(login / id / 主页)', '无参数',
  async function (a, c) {
    return api({ url: API + '/user', callId: c });
  });

op('graphql', 'meta', '通用 GraphQL 逃生口(REST 覆盖不到的查询/变更用它)', 'query*:string, variables?:object',
  async function (a, c) {
    if (!a.query) return { err: '需要 query' };
    return gql(a.query, a.variables, c);
  });

/* ── events(5) ─────────────────────────────────────────────────────── */

op('list_user_events', 'events', '某用户的事件(认证用户可见范围,含自己的私有事件)', 'username*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.username) return { err: '需要 username' };
    return api({ url: API + '/users/' + encodeURIComponent(a.username) + '/events' + qs(pg(a)), callId: c });
  });

op('list_user_public_events', 'events', '某用户的公开事件', 'username*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.username) return { err: '需要 username' };
    return api({ url: API + '/users/' + encodeURIComponent(a.username) + '/events/public' + qs(pg(a)), callId: c });
  });

op('list_org_events', 'events', 'org 的公开事件流', 'org*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.org) return { err: '需要 org' };
    return api({ url: API + '/orgs/' + encodeURIComponent(a.org) + '/events' + qs(pg(a)), callId: c });
  });

op('list_authenticated_user_org_events', 'events', '认证用户在某 org 内可见的事件(含私有仓库)', 'org*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.org) return { err: '需要 org' };
    var me = await api({ url: API + '/user', callId: c });
    if (me.err) return me;
    return api({
      url: API + '/users/' + encodeURIComponent(me.data.login) + '/events/orgs/' + encodeURIComponent(a.org) + qs(pg(a)),
      callId: c,
    });
  });

op('list_repo_events', 'events', '仓库事件', REPO_DOC + ', ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/events' + qs(pg(a)), callId: c });
  });

/* ── commits(4) ────────────────────────────────────────────────────── */

op('list_commits', 'commits', '列 commit(可按作者/路径/时间过滤)',
  REPO_DOC + ', sha?:string(分支或起点), path?, author?, committer?, since?:ISO, until?:ISO, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({
      url: r.base + '/commits' + qs({ sha: a.sha, path: a.path, author: a.author, committer: a.committer, since: a.since, until: a.until, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('get_commit', 'commits', '读单个 commit(含 stats 与 files diff)', REPO_DOC + ', sha*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.sha) return { err: '需要 sha' };
    return api({ url: r.base + '/commits/' + encodeURIComponent(a.sha), callId: c });
  });

op('compare_commits', 'commits', '比较两个 ref(base...head)', REPO_DOC + ', base*:string, head*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.base || !a.head) return { err: '需要 base / head' };
    return api({ url: r.base + '/compare/' + encodeURIComponent(a.base) + '...' + encodeURIComponent(a.head), callId: c });
  });

op('list_check_runs_for_ref', 'commits', '列某 ref 的 check runs(CI 状态)',
  REPO_DOC + ', ref*:string, check_name?, status?:queued|in_progress|completed, filter?:latest|all, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.ref) return { err: '需要 ref' };
    return api({
      url: r.base + '/commits/' + encodeURIComponent(a.ref) + '/check-runs' + qs({ check_name: a.check_name, status: a.status, filter: a.filter, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

/* ── search(5) ─────────────────────────────────────────────────────── */

op('search_repos', 'search', '搜仓库(GitHub search 语法)', 'q*:string, sort?:stars|forks|help-wanted-issues|updated, order?:asc|desc, ' + PP_DOC,
  async function (a, c) {
    if (!a.q) return { err: '需要 q' };
    return api({ url: API + '/search/repositories' + qs({ q: a.q, sort: a.sort, order: a.order, per_page: a.per_page, page: a.page }), callId: c });
  });

op('search_issues_and_prs', 'search', '搜 issue 与 PR(q 里用 is:pr / is:issue / repo:owner/name 收窄)',
  'q*:string, sort?, order?:asc|desc, ' + PP_DOC,
  async function (a, c) {
    if (!a.q) return { err: '需要 q' };
    return api({ url: API + '/search/issues' + qs({ q: a.q, sort: a.sort, order: a.order, per_page: a.per_page, page: a.page }), callId: c });
  });

op('search_commits', 'search', '搜 commit', 'q*:string, sort?:author-date|committer-date, order?, ' + PP_DOC,
  async function (a, c) {
    if (!a.q) return { err: '需要 q' };
    return api({ url: API + '/search/commits' + qs({ q: a.q, sort: a.sort, order: a.order, per_page: a.per_page, page: a.page }), callId: c });
  });

op('search_code', 'search', '搜代码(q 里用 repo: / path: / language: 收窄)', 'q*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.q) return { err: '需要 q' };
    return api({ url: API + '/search/code' + qs({ q: a.q, per_page: a.per_page, page: a.page }), callId: c });
  });

op('search_users', 'search', '搜用户', 'q*:string, sort?:followers|repositories|joined, order?, ' + PP_DOC,
  async function (a, c) {
    if (!a.q) return { err: '需要 q' };
    return api({ url: API + '/search/users' + qs({ q: a.q, sort: a.sort, order: a.order, per_page: a.per_page, page: a.page }), callId: c });
  });

/* ── users(4) ──────────────────────────────────────────────────────── */

op('get_user', 'users', '用户公开资料', 'username*:string',
  async function (a, c) {
    if (!a.username) return { err: '需要 username' };
    return api({ url: API + '/users/' + encodeURIComponent(a.username), callId: c });
  });

op('list_user_orgs', 'users', '用户的公开 org(单页 100)', 'username*:string',
  async function (a, c) {
    if (!a.username) return { err: '需要 username' };
    return api({ url: API + '/users/' + encodeURIComponent(a.username) + '/orgs?per_page=100', callId: c });
  });

op('list_authenticated_user_repos', 'users', '认证用户可访问的仓库',
  'visibility?:all|public|private, type?:all|owner|public|private|member, sort?:created|updated|pushed|full_name, direction?, ' + PP_DOC,
  async function (a, c) {
    return api({
      url: API + '/user/repos' + qs({ visibility: a.visibility, type: a.type, sort: a.sort, direction: a.direction, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('list_org_repos', 'users', 'org 的仓库', 'org*:string, type?:all|public|private|forks|sources|member, sort?, direction?, ' + PP_DOC,
  async function (a, c) {
    if (!a.org) return { err: '需要 org' };
    return api({
      url: API + '/orgs/' + encodeURIComponent(a.org) + '/repos' + qs({ type: a.type, sort: a.sort, direction: a.direction, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

/* ── actions(10) ───────────────────────────────────────────────────── */

op('list_workflow_runs', 'actions', '列 workflow run',
  REPO_DOC + ', branch?, event?, status?:completed|success|failure|in_progress|queued|…, actor?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({
      url: r.base + '/actions/runs' + qs({ branch: a.branch, event: a.event, status: a.status, actor: a.actor, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('get_workflow_run', 'actions', '读单个 run', REPO_DOC + ', run_id*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: '需要 run_id' };
    return api({ url: r.base + '/actions/runs/' + a.run_id, callId: c });
  });

op('list_workflow_run_jobs', 'actions', '列 run 里的 job(含 steps 状态)', REPO_DOC + ', run_id*:int, filter?:latest|all, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: '需要 run_id' };
    return api({ url: r.base + '/actions/runs/' + a.run_id + '/jobs' + qs({ filter: a.filter, per_page: a.per_page, page: a.page }), callId: c });
  });

op('list_workflows', 'actions', '列 workflow 定义', REPO_DOC + ', ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/actions/workflows' + qs(pg(a)), callId: c });
  });

op('dispatch_workflow', 'actions', '触发 workflow_dispatch(写操作;workflow 可传文件名或数字 id)',
  REPO_DOC + ', workflow*:string|int, ref*:string, inputs?:object(值须 string)',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.workflow || !a.ref) return { err: '需要 workflow / ref' };
    var out = await api({
      url: r.base + '/actions/workflows/' + encodeURIComponent(String(a.workflow)) + '/dispatches',
      method: 'POST', body: { ref: a.ref, inputs: a.inputs }, callId: c,
    });
    if (out.err) return out;
    return { data: { dispatched: true } };
  });

op('rerun_workflow_run', 'actions', '重跑 run(写操作)', REPO_DOC + ', run_id*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: '需要 run_id' };
    var out = await api({ url: r.base + '/actions/runs/' + a.run_id + '/rerun', method: 'POST', callId: c });
    if (out.err) return out;
    return { data: { rerun: true } };
  });

op('cancel_workflow_run', 'actions', '取消 run(写操作)', REPO_DOC + ', run_id*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: '需要 run_id' };
    var out = await api({ url: r.base + '/actions/runs/' + a.run_id + '/cancel', method: 'POST', callId: c });
    if (out.err) return out;
    return { data: { cancelled: true } };
  });

op('list_workflow_run_artifacts', 'actions', '列 run 的 artifact', REPO_DOC + ', run_id*:int, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: '需要 run_id' };
    return api({ url: r.base + '/actions/runs/' + a.run_id + '/artifacts' + qs(pg(a)), callId: c });
  });

op('download_artifact', 'actions', '下载 artifact zip 到用户本地目录(需要主 agent 调 ghost_call 时把目标目录绝对路径放在顶层 save_dir 参数)',
  REPO_DOC + ', artifact_id*:int, filename?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.artifact_id) return { err: '需要 artifact_id' };
    var done = await downloadZip(r.base + '/actions/artifacts/' + a.artifact_id + '/zip', a, c, 'artifact-' + a.artifact_id + '.zip');
    if (done.err) return done;
    return { result: done.result };
  });

op('download_run_logs', 'actions', '下载 run 全量日志 zip 到用户本地目录(需要 ghost_call 顶层 save_dir 参数)',
  REPO_DOC + ', run_id*:int, filename?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: '需要 run_id' };
    var done = await downloadZip(r.base + '/actions/runs/' + a.run_id + '/logs', a, c, 'run-' + a.run_id + '-logs.zip');
    if (done.err) return done;
    return { result: done.result };
  });

/* ── releases(5) ───────────────────────────────────────────────────── */

op('list_releases', 'releases', '列 release', REPO_DOC + ', ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/releases' + qs(pg(a)), callId: c });
  });

op('get_release_by_tag', 'releases', '按 tag 读 release', REPO_DOC + ', tag*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.tag) return { err: '需要 tag' };
    return api({ url: r.base + '/releases/tags/' + encodeURIComponent(a.tag), callId: c });
  });

op('create_release', 'releases', '建 release(写操作)',
  REPO_DOC + ', tag_name*, target_commitish?, name?, body?, draft?:bool, prerelease?:bool, generate_release_notes?:bool',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.tag_name) return { err: '需要 tag_name' };
    return api({
      url: r.base + '/releases', method: 'POST',
      body: { tag_name: a.tag_name, target_commitish: a.target_commitish, name: a.name, body: a.body, draft: a.draft, prerelease: a.prerelease, generate_release_notes: a.generate_release_notes },
      callId: c,
    });
  });

op('get_latest_release', 'releases', '最新已发布 release', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/releases/latest', callId: c });
  });

op('list_release_assets', 'releases', '列 release 的资产', REPO_DOC + ', release_id*:int, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.release_id) return { err: '需要 release_id' };
    return api({ url: r.base + '/releases/' + a.release_id + '/assets' + qs(pg(a)), callId: c });
  });

/* ── notifications(2) ──────────────────────────────────────────────── */

op('list_notifications', 'notifications', '列通知', 'all?:bool, participating?:bool, since?:ISO, before?:ISO, ' + PP_DOC,
  async function (a, c) {
    return api({
      url: API + '/notifications' + qs({ all: a.all, participating: a.participating, since: a.since, before: a.before, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('mark_notification_read', 'notifications', '标记某条通知线程为已读', 'thread_id*:string',
  async function (a, c) {
    if (!a.thread_id) return { err: '需要 thread_id' };
    var out = await api({ url: API + '/notifications/threads/' + encodeURIComponent(a.thread_id), method: 'PATCH', callId: c });
    if (out.err) return out;
    return { data: { marked_read: true } };
  });

/* ── orgs(4) ───────────────────────────────────────────────────────── */

op('list_org_members', 'orgs', 'org 成员', 'org*:string, filter?:2fa_disabled|all, role?:all|admin|member, ' + PP_DOC,
  async function (a, c) {
    if (!a.org) return { err: '需要 org' };
    return api({ url: API + '/orgs/' + encodeURIComponent(a.org) + '/members' + qs({ filter: a.filter, role: a.role, per_page: a.per_page, page: a.page }), callId: c });
  });

op('list_org_teams', 'orgs', 'org 团队', 'org*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.org) return { err: '需要 org' };
    return api({ url: API + '/orgs/' + encodeURIComponent(a.org) + '/teams' + qs(pg(a)), callId: c });
  });

op('list_team_members', 'orgs', '团队成员', 'org*:string, team_slug*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.org || !a.team_slug) return { err: '需要 org / team_slug' };
    return api({ url: API + '/orgs/' + encodeURIComponent(a.org) + '/teams/' + encodeURIComponent(a.team_slug) + '/members' + qs(pg(a)), callId: c });
  });

op('list_team_repos', 'orgs', '团队可访问的仓库', 'org*:string, team_slug*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.org || !a.team_slug) return { err: '需要 org / team_slug' };
    return api({ url: API + '/orgs/' + encodeURIComponent(a.org) + '/teams/' + encodeURIComponent(a.team_slug) + '/repos' + qs(pg(a)), callId: c });
  });

/* ── gists(2) ──────────────────────────────────────────────────────── */

op('list_gists', 'gists', '列认证用户的 gist', 'since?:ISO, ' + PP_DOC,
  async function (a, c) {
    return api({ url: API + '/gists' + qs({ since: a.since, per_page: a.per_page, page: a.page }), callId: c });
  });

op('get_gist', 'gists', '读单个 gist(含文件内容)', 'id*:string',
  async function (a, c) {
    if (!a.id) return { err: '需要 id' };
    return api({ url: API + '/gists/' + encodeURIComponent(a.id), callId: c });
  });

/* ── git_data(7) ───────────────────────────────────────────────────── */

op('get_ref', 'git_data', '取单个 ref(如 heads/main、tags/v1.0.0)', REPO_DOC + ', ref*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.ref) return { err: '需要 ref(如 heads/main)' };
    return api({ url: r.base + '/git/ref/' + encPath(a.ref), callId: c });
  });

op('create_branch', 'git_data', '建分支(from_sha 或 from_ref 二选一,都省略时从仓库默认分支拉)',
  REPO_DOC + ', branch*:string, from_sha?:string, from_ref?:string(默认仓库 default_branch)',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.branch) return { err: '需要 branch' };
    var sha = a.from_sha;
    if (!sha) {
      var fromRef = a.from_ref;
      if (!fromRef) {
        var repo = await api({ url: r.base, callId: c });
        if (repo.err) return repo;
        fromRef = repo.data && repo.data.default_branch;
        if (!fromRef) return { err: '取不到仓库默认分支' };
      }
      var got = await api({ url: r.base + '/git/ref/heads/' + encPath(fromRef), callId: c });
      if (got.err) return got;
      sha = got.data && got.data.object && got.data.object.sha;
      if (!sha) return { err: '取不到起点分支的 sha' };
    }
    return api({ url: r.base + '/git/refs', method: 'POST', body: { ref: 'refs/heads/' + a.branch, sha: sha }, callId: c });
  });

op('create_ref', 'git_data', '建原始 ref(refs/heads/… 或 refs/tags/…)', REPO_DOC + ', ref*:string, sha*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.ref || !a.sha) return { err: '需要 ref / sha' };
    return api({ url: r.base + '/git/refs', method: 'POST', body: { ref: a.ref, sha: a.sha }, callId: c });
  });

op('get_tree', 'git_data', '取 git tree(recursive=true 拉全树,注意 truncated 标记)', REPO_DOC + ', tree_sha*:string, recursive?:bool',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.tree_sha) return { err: '需要 tree_sha' };
    return api({ url: r.base + '/git/trees/' + encodeURIComponent(a.tree_sha) + qs({ recursive: a.recursive ? 1 : undefined }), callId: c });
  });

op('create_tree', 'git_data', '建 git tree', REPO_DOC + ', base_tree?, tree*:[{path*, mode*:100644|100755|040000|160000|120000, type*:blob|tree|commit, sha?, content?}]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!Array.isArray(a.tree) || !a.tree.length) return { err: '需要 tree(条目数组)' };
    return api({ url: r.base + '/git/trees', method: 'POST', body: { base_tree: a.base_tree, tree: a.tree }, callId: c });
  });

op('create_commit', 'git_data', '建 commit 对象(不动 ref;要更新分支再用 create_ref / push_files)',
  REPO_DOC + ', message*, tree*:string, parents*:string[], author?:{name*,email*,date?}, committer?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.message || !a.tree || !Array.isArray(a.parents)) return { err: '需要 message / tree / parents' };
    return api({
      url: r.base + '/git/commits', method: 'POST',
      body: { message: a.message, tree: a.tree, parents: a.parents, author: a.author, committer: a.committer },
      callId: c,
    });
  });

op('push_files', 'git_data', '原子多文件单 commit 推到分支(读 head → 建 blob/tree/commit → 快进 ref;写操作)',
  REPO_DOC + ', branch*, message*, files*:[{path*, content*, encoding?:utf-8|base64}]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.branch || !a.message || !Array.isArray(a.files) || !a.files.length) return { err: '需要 branch / message / files' };
    var head = await api({ url: r.base + '/git/ref/heads/' + encPath(a.branch), callId: c });
    if (head.err) return head;
    var headSha = head.data && head.data.object && head.data.object.sha;
    if (!headSha) return { err: '取不到分支 head sha' };
    var headCommit = await api({ url: r.base + '/git/commits/' + headSha, callId: c });
    if (headCommit.err) return headCommit;
    var baseTree = headCommit.data && headCommit.data.tree && headCommit.data.tree.sha;
    // base_tree 缺失时不能继续:GitHub 会建出只含本次文件的孤儿树,等效删光分支其余文件。
    if (!baseTree) return { err: '取不到 head commit 的 base tree,拒绝继续(避免建出丢失其余文件的孤儿树)' };
    var entries = [];
    for (var i = 0; i < a.files.length; i++) {
      var f = a.files[i];
      if (!f || !f.path || typeof f.content !== 'string') return { err: 'files 每项需要 path / content' };
      // 拼错的 encoding(如 'Base64')按 utf-8 提交会静默写坏文件,收严成枚举。
      if (f.encoding !== undefined && f.encoding !== 'utf-8' && f.encoding !== 'base64') {
        return { err: 'files[].encoding 只认 utf-8 / base64,收到:' + f.encoding };
      }
      if (f.encoding === 'base64') {
        var blob = await api({ url: r.base + '/git/blobs', method: 'POST', body: { content: f.content, encoding: 'base64' }, callId: c });
        if (blob.err) return blob;
        entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.data.sha });
      } else {
        entries.push({ path: f.path, mode: '100644', type: 'blob', content: f.content });
      }
    }
    var tree = await api({ url: r.base + '/git/trees', method: 'POST', body: { base_tree: baseTree, tree: entries }, callId: c });
    if (tree.err) return tree;
    var commit = await api({
      url: r.base + '/git/commits', method: 'POST',
      body: { message: a.message, tree: tree.data.sha, parents: [headSha] }, callId: c,
    });
    if (commit.err) return commit;
    var moved = await api({
      url: r.base + '/git/refs/heads/' + encPath(a.branch), method: 'PATCH',
      body: { sha: commit.data.sha, force: false }, callId: c,
    });
    if (moved.err) return moved;
    return { data: { pushed: true, commit_sha: commit.data.sha, files: a.files.length } };
  });

/* ── reactions(6) ──────────────────────────────────────────────────── */

var REACTION_DOC = 'content 枚举:+1|-1|laugh|confused|heart|hooray|rocket|eyes';

op('list_issue_reactions', 'reactions', '列 issue 的 reaction(' + REACTION_DOC + ')', REPO_DOC + ', issue_number*:int, content?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: '需要 issue_number' };
    return api({ url: r.base + '/issues/' + a.issue_number + '/reactions' + qs({ content: a.content, per_page: a.per_page, page: a.page }), callId: c });
  });

op('add_issue_reaction', 'reactions', '给 issue 加 reaction', REPO_DOC + ', issue_number*:int, content*(' + REACTION_DOC + ')',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !a.content) return { err: '需要 issue_number / content' };
    return api({ url: r.base + '/issues/' + a.issue_number + '/reactions', method: 'POST', body: { content: a.content }, callId: c });
  });

op('list_issue_comment_reactions', 'reactions', '列 issue 评论的 reaction', REPO_DOC + ', comment_id*:int, content?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.comment_id) return { err: '需要 comment_id' };
    return api({ url: r.base + '/issues/comments/' + a.comment_id + '/reactions' + qs({ content: a.content, per_page: a.per_page, page: a.page }), callId: c });
  });

op('add_issue_comment_reaction', 'reactions', '给 issue 评论加 reaction', REPO_DOC + ', comment_id*:int, content*',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.comment_id || !a.content) return { err: '需要 comment_id / content' };
    return api({ url: r.base + '/issues/comments/' + a.comment_id + '/reactions', method: 'POST', body: { content: a.content }, callId: c });
  });

op('list_pull_request_review_comment_reactions', 'reactions', '列 PR 行评的 reaction', REPO_DOC + ', comment_id*:int, content?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.comment_id) return { err: '需要 comment_id' };
    return api({ url: r.base + '/pulls/comments/' + a.comment_id + '/reactions' + qs({ content: a.content, per_page: a.per_page, page: a.page }), callId: c });
  });

op('add_pull_request_review_comment_reaction', 'reactions', '给 PR 行评加 reaction', REPO_DOC + ', comment_id*:int, content*',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.comment_id || !a.content) return { err: '需要 comment_id / content' };
    return api({ url: r.base + '/pulls/comments/' + a.comment_id + '/reactions', method: 'POST', body: { content: a.content }, callId: c });
  });

/* ── list_tools / call_tool 元工具 ─────────────────────────────────── */

function listTools(args) {
  var category = args && args.category ? String(args.category) : '';
  if (!category) {
    var overview = {};
    for (var cat in CATEGORIES) {
      if (!Object.prototype.hasOwnProperty.call(CATEGORIES, cat)) continue;
      overview[cat] = { count: 0, description: CATEGORIES[cat] };
    }
    for (var name in OPS) {
      if (!Object.prototype.hasOwnProperty.call(OPS, name)) continue;
      overview[OPS[name].cat].count++;
    }
    return {
      ok: true,
      result: {
        categories: overview,
        hint: '传 category 看该类目下的操作明细;执行用 call_tool({name, args})。repo 级操作必须显式传 owner/repo。',
      },
    };
  }
  if (!CATEGORIES[category]) {
    return { ok: false, message: '未知类目:' + category + '(可用:' + Object.keys(CATEGORIES).join(' / ') + ')' };
  }
  var tools = [];
  for (var n in OPS) {
    if (!Object.prototype.hasOwnProperty.call(OPS, n)) continue;
    if (OPS[n].cat !== category) continue;
    tools.push({ name: n, description: OPS[n].desc, params: OPS[n].params });
  }
  return {
    ok: true,
    result: { category: category, tools: tools, hint: '执行用 call_tool({name, args});参数记法:* 必填,pp = per_page/page。' },
  };
}

async function callTool(args, callId) {
  var name = args && args.name ? String(args.name) : '';
  if (!name) return fail('需要 name(list_tools 可查)');
  var entry = OPS[name];
  if (!entry) {
    return fail('未知操作:' + name + '——用 list_tools 查目录(类目:' + Object.keys(CATEGORIES).join(' / ') + ')');
  }
  var inner = args.args && typeof args.args === 'object' ? args.args : {};
  // save_dir / dir 票据由主机注入在 call_tool 这一层,下传给具体操作。
  if (args.save_deposit) inner.save_deposit = args.save_deposit;
  if (args.dir_deposit) inner.dir_deposit = args.dir_deposit;
  var out = await entry.run(inner, callId);
  if (out.err) {
    // 失败带上参数说明,供 AI 自纠重试(两段式约定)。
    return fail(out.err + '\n该操作参数:' + entry.params);
  }
  if (out.result) return { ok: true, result: out.result };
  var outFile = typeof args.out_file === 'string' && args.out_file ? args.out_file : null;
  return deliver(out.data, Boolean(args.raw), outFile, callId);
}

/* ── 设置页测试连接(BroadcastChannel;settings.js 先 /wake 再广播) ── */

var bc = new BroadcastChannel('cindy-github');
var seenTestReqs = {};

bc.onmessage = function (ev) {
  var m = ev && ev.data;
  if (!m || m.type !== 'test-connection' || !m.reqId) return;
  if (seenTestReqs[m.reqId]) return;
  // 去重表只为吸收 settings 页的重发风暴,超量直接清零重来(常驻期不泄漏)。
  if (Object.keys(seenTestReqs).length > 200) seenTestReqs = {};
  seenTestReqs[m.reqId] = 1;
  void (async function () {
    var r = await api({ url: API + '/user' });
    if (r.err) {
      bc.postMessage({ type: 'test-connection-result', reqId: m.reqId, ok: false, message: r.err });
      // 结果同时走系统提示(notify 槽,主机画壳带身份头):失败也报,tone 区分。
      // 限速 5 秒内的重复点击会被主机拒(ok:false),页面内 status 仍在,不补救。
      void cindy.send({ type: 'notify', text: 'GitHub 连接测试失败:' + String(r.err).slice(0, 150), tone: 'error' });
      return;
    }
    // 注:scope 信息在 X-OAuth-Scopes 响应头里,但主机响应头白名单不透传
    // 自定义头,沙箱拿不到——只报用户名,不做 scope 展示。
    var login = (r.data && r.data.login) || '';
    bc.postMessage({
      type: 'test-connection-result', reqId: m.reqId, ok: true,
      login: login, name: (r.data && r.data.name) || '',
    });
    void cindy.send({ type: 'notify', text: '连接成功:@' + login, tone: 'success' });
  })();
};

/* ── 派单 ──────────────────────────────────────────────────────────── */

cindy.onHostMessage(async function (msg) {
  if (!msg || msg.type !== 'tool-call') return;
  try {
    var r;
    if (msg.tool === 'list_tools') {
      r = listTools(msg.args || {});
    } else if (msg.tool === 'call_tool') {
      r = await callTool(msg.args || {}, msg.callId);
    } else {
      r = fail('未知工具:' + msg.tool);
    }
    if (r.ok) {
      cindy.send({ type: 'tool-result', callId: msg.callId, ok: true, result: r.result });
    } else {
      cindy.send({ type: 'tool-result', callId: msg.callId, ok: false, message: r.message });
    }
  } catch (err) {
    cindy.send({
      type: 'tool-result',
      callId: msg.callId,
      ok: false,
      message: 'GitHub 工具执行失败:' + (err && err.message ? err.message : String(err)),
    });
  }
});
