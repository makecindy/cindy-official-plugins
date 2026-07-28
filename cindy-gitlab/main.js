/**
 * GitLab · 电子脑 —— 内置的 GitLab 服务意识(PAT 模式,自建 / 多实例)。
 *
 * id/指令保留 cindy- 官方命名空间；显示名直接使用 GitLab。
 *
 * 工作方式:
 * - 多连接动态白名单:ghost.json 声明 network.connections(key: gitlab_conn),
 *   没有静态 hosts——用户在设置页逐条添加「实例地址 + PAT」,每条连接由主机
 *   弹窗确认后放行该域名并把 token 存入保险库;cindy.fetch 打到某实例时主机按
 *   URL 命中的连接自动注入 PRIVATE-TOKEN,本文件没有也不可能有任何 token 字节;
 * - 实例选择:每个操作都可带 instance(连接 id 或实例地址),省略走默认连接,
 *   只配了一条时用它;连接列表每次 tool-call 现查 GET /connections(列表极小);
 * - 工具面 = 两段式目录(FORGE_GUIDE §3.5):只声明 list_tools / call_tool 两个
 *   元工具,107 个操作按 20 个类目放在本文件的 OPS 表里——与老 lizi_gitlab MCP
 *   的渐进式外形一致,主 agent 零学习成本;改工具只更新意识、不发应用版本;
 * - project 级操作必须显式传 project_path:沙箱无文件系统,不能像老 MCP 那样从
 *   会话 workdir 的 git remote 推导,由主 agent 自己推导后传入;
 * - 交卷护栏:默认递归剥掉响应里的 avatar_url 与 _links(GitLab 的 web_url 是
 *   人看的页面地址,保留);超 50KB(或调用方点名 out_file)时经 fs 槽把完整
 *   JSON 写进会话工作目录只交路径——老 MCP out_file 泄洪的等价回归(2026-07
 *   fs 槽上线后),写盘不可用(plan 模式 / SSH 远程工作区)才回落截断;
 *   call_tool 传 raw=true 拿原样 JSON(写盘内容与内联同口径,raw 决定剥不剥;
 *   list_project_variables 的 value 剥除是防泄密行为,raw 与落盘都不豁免);
 * - 仓库归档:老 MCP 只返 URL 让调用方自己带 token 下载,这里升级为真下载落盘
 *   (as:'file' + save_dir 票据);项目附件上传走用户附件过户的指纹通道。
 */

/* global cindy */

/** 交卷体量护栏(与 cindy-github 同款)。 */
var RESULT_MAX_CHARS = 50 * 1000;
/** ghost.json network.connections 里声明的连接槽 key。 */
var CONNECTION_KEY = 'gitlab_conn';

/* ── 基础工具 ───────────────────────────────────────────────────────── */

function fail(message) {
  return { ok: false, message: message };
}

/**
 * 查询串拼装。GitLab 的数组参数(如 assignee_username[])要求 `k[]=a&k[]=b`
 * 形式,不能像 GitHub 那样重复裸 k= —— 与老 GitlabClient.qs 对齐:key 已带
 * `[]` 就照原样多次 append,否则自动补 `[]`。
 */
function qs(params) {
  var parts = [];
  for (var k in params) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    var v = params[k];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      var ak = k.slice(-2) === '[]' ? k : k + '[]';
      for (var i = 0; i < v.length; i++) {
        var item = v[i];
        if (item === undefined || item === null || item === '') continue;
        parts.push(encodeURIComponent(ak) + '=' + encodeURIComponent(String(item)));
      }
      continue;
    }
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/** 分页参数透传(GitLab 通用 per_page / page)。 */
function pg(a) {
  return { per_page: a.per_page, page: a.page };
}

/** 从附件地址 / 指纹串里抽 64 位媒体总仓指纹(与 cindy-art 同款)。 */
function extractHash(s) {
  if (typeof s !== 'string') return null;
  var m = s.match(/[0-9a-f]{64}/);
  return m ? m[0] : null;
}

/** HTTP 状态 → 人话(401 到这里 = 该实例的 token 没填或已失效)。 */
function classifyStatus(status, bodySnippet) {
  if (status === 401) return 'GitLab token 未配置或已失效,请用户到主界面侧边栏「插件」→「GitLab」详情页重新填写该实例的 token(并确认实例地址无误)';
  if (status === 403) return '没有权限(HTTP 403,token scope 不够或无该项目权限):' + bodySnippet;
  if (status === 404) return '对象不存在或无访问权(HTTP 404;project_path 是否拼对?)';
  if (status === 409) return 'GitLab 资源冲突(HTTP 409):' + bodySnippet;
  if (status === 422) return 'GitLab 拒绝了请求参数(HTTP 422):' + bodySnippet;
  if (status === 429) return 'GitLab 接口限流(HTTP 429),请稍后重试';
  return 'GitLab API 返回 HTTP ' + status + ':' + bodySnippet;
}

/* ── 连接解析(多实例) ─────────────────────────────────────────────── */

/**
 * 解析本次操作要打的 GitLab 连接。优先级:args.instance(匹配连接 id 或
 * 实例地址)> 默认连接 > 只有一条时用它;都没有 → 结构化错误引导去设置页。
 * 连接列表每次现查(数据面 GET /connections,列表极小,不做跨调用缓存)。
 */
async function resolveInstance(a) {
  var list;
  try {
    list = await (await fetch('/connections')).json();
  } catch (e) {
    return { err: '读取 GitLab 连接配置失败:' + (e && e.message ? e.message : String(e)) };
  }
  var slot = null;
  if (Array.isArray(list)) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].key === CONNECTION_KEY) { slot = list[i]; break; }
    }
  }
  var conns = (slot && Array.isArray(slot.connections)) ? slot.connections : [];
  if (!conns.length) {
    return { err: '尚未添加任何 GitLab 实例——请用户到主界面侧边栏「插件」→「GitLab」详情页添加实例地址与 Personal Access Token' };
  }
  var hosts = conns.map(function (cn) { return cn.host; });
  if (a && a.instance) {
    // instance 既可传连接 id 也可传实例地址;地址侧容忍带协议/尾斜杠/大小写
    // 的写法(主机存储的 host 恒为小写)。
    var want = String(a.instance).replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    for (var j = 0; j < conns.length; j++) {
      if (conns[j].id === a.instance || conns[j].host === want) return conns[j];
    }
    return { err: '找不到 instance 对应的 GitLab 连接:' + a.instance + '(已配置:' + hosts.join(' / ') + ')' };
  }
  for (var d = 0; d < conns.length; d++) {
    if (conns[d].isDefault) return conns[d];
  }
  if (conns.length === 1) return conns[0];
  return { err: '配置了多个 GitLab 实例且没有默认连接——在 args 里传 instance 指定(已配置:' + hosts.join(' / ') + '),或到主界面侧边栏「插件」→「GitLab」详情页设默认' };
}

/** 实例级操作的 API base 解析(不需要 project_path)。 */
async function apiBase(a) {
  var inst = await resolveInstance(a);
  if (inst.err) return inst;
  return { base: 'https://' + inst.host + '/api/v4', inst: inst };
}

/**
 * project 级操作的校验与 base 拼装。GitLab 用整体 URL-encode 的 project path
 * 当路径段(group/sub/proj → group%2Fsub%2Fproj),与老 GitlabClient 同口径。
 */
async function projBase(a) {
  if (!a.project_path) {
    return { err: 'project 级操作必须显式传 project_path(如 "group/subgroup/project";在 git 仓库里工作时,主 agent 可用 `git remote get-url origin` 推导后传入)' };
  }
  var r = await apiBase(a);
  if (r.err) return r;
  return { base: r.base, proj: r.base + '/projects/' + encodeURIComponent(String(a.project_path)), inst: r.inst };
}

/* ── HTTP ───────────────────────────────────────────────────────────── */

/**
 * 统一的 GitLab REST 调用。PRIVATE-TOKEN 由主机按 URL 命中的连接自动注入,
 * 这里只管 URL / 方法 / 体。成功 { data, status, headers },失败 { err }。
 * - 304:幂等写端点(star 已 star / unstar 未 star)的"状态已一致"成功语义,
 *   GitLab 不返 body,视为成功 no-op(与老 GitlabClient 特判对齐);
 * - 空体成功(204 / Content-Length: 0)短路,避免 JSON.parse 抛错误报;
 * - opts.text = true:raw 文本端点(files/:path/raw、jobs/:id/trace)直接
 *   透传 body 字符串,不做 JSON 解析。
 */
async function api(opts) {
  var req = {
    url: opts.url,
    method: opts.method || 'GET',
    headers: { Accept: 'application/json' },
    callId: opts.callId,
  };
  if (opts.body !== undefined) {
    req.headers['Content-Type'] = 'application/json';
    req.body = JSON.stringify(opts.body);
  }
  var r = await cindy.fetch(req);
  if (!r.ok) return { err: r.message };
  if (r.status === 304) {
    return {
      data: { no_op: true, status: 304, note: 'GitLab 返回 304:状态已与目标一致(如已 star / 未 star),视为成功' },
      status: 304,
      headers: r.headers || {},
    };
  }
  if (r.status < 200 || r.status >= 300) {
    var snippet = typeof r.body === 'string' ? r.body.slice(0, 300) : '';
    return { err: classifyStatus(r.status, snippet) };
  }
  if (opts.text) return { data: typeof r.body === 'string' ? r.body : '', status: r.status, headers: r.headers || {} };
  var data = null;
  if (r.body) {
    try {
      data = JSON.parse(r.body);
    } catch (e) {
      data = r.body;
    }
  }
  return { data: data, status: r.status, headers: r.headers || {} };
}

/**
 * 瘦身:GitLab 响应比 GitHub 干净得多(没有满屏 API 链接字段),web_url 是
 * 人看的页面地址(等价 GitHub html_url)要保留——只递归剥掉 avatar_url 与
 * _links 对象(user / author / assignee 等嵌套里的头像同样被这条规则覆盖)。
 * raw=true 时跳过。
 */
function slim(value) {
  if (Array.isArray(value)) return value.map(slim);
  if (value && typeof value === 'object') {
    var out = {};
    for (var k in value) {
      if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
      if (k === 'avatar_url' || k === '_links') continue;
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
    var fileName = outFile || 'gitlab-result-' + String(callId).slice(0, 8) + '.json';
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

/** 下载文件(仓库归档)到用户目录:须 save_dir 票据。 */
async function downloadFile(url, a, callId, suggestedName) {
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
 * 参数记法:* = 必填;[proj] = project_path 必填;pp = per_page?/page?;
 * 所有操作都可带 instance?(连接 id 或实例地址,省略走默认连接)。
 * ──────────────────────────────────────────────────────────────────── */

var PROJ_DOC = 'project_path*:string(如 "group/subgroup/project",主 agent 可从 `git remote get-url origin` 推导后传入)';
var PP_DOC = 'per_page?:1-100, page?:int';

var CATEGORIES = {
  issues: 'issue 与评论 / label 增删 / 关联 MR / issue 链接',
  merge_requests: 'MR 全生命周期:创建 / diff 与 commit / 更新 / 合并 / rebase / 全实例列表',
  repo: '分支 / tag / label / 文件树 / 文件读写 / 多文件提交 / 保护分支 / 仓库归档下载',
  commits: 'commit 列表 / 详情 / diff / 两 ref 比较',
  events: '认证用户 / 指定用户 / 项目事件流',
  search: '全实例与项目内搜索(issue / MR / 代码 / commit / 用户等)',
  projects: '项目列表与元数据 / 成员 / 里程碑 / fork / star / 建项目 / 附件上传',
  users: '用户搜索与精确查询',
  pipelines: 'CI pipeline 列表 / 详情 / job 列表 / 定时计划',
  jobs: 'CI job 日志 / 重试 / 取消',
  discussions: 'MR discussion 线程(含行评定位 / resolve)',
  approvals: 'MR 审批状态 / approve / unapprove',
  draft_notes: 'MR 草稿评论(pending review):攒批 / 发布 / 删除',
  reactions: 'issue / MR / 评论(note)的 award emoji',
  groups: 'group 级里程碑 / 成员 / issue / MR',
  environments: '部署环境与 deployment',
  wiki: '项目 wiki 页',
  snippets: '项目 snippet',
  releases: 'release 列表与详情',
  meta: '当前 token 对应的用户',
};

var OPS = {};

function op(name, cat, desc, params, run) {
  OPS[name] = { cat: cat, desc: desc, params: params, run: run };
}

/* ── issues(11) ────────────────────────────────────────────────────── */

op('list_issues', 'issues', '列项目 issue(可按状态 / label / 作者 / 时间过滤)',
  PROJ_DOC + ', state?:opened|closed|all, labels?:string(逗号分隔), order_by?:created_at|updated_at, sort?:asc|desc, scope?:created_by_me|assigned_to_me|all, author_username?, assignee_username?, search?, created_after?:ISO, created_before?:ISO, updated_after?:ISO, updated_before?:ISO, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({
      url: r.proj + '/issues' + qs({
        state: a.state, labels: a.labels, order_by: a.order_by, sort: a.sort, scope: a.scope,
        author_username: a.author_username, assignee_username: a.assignee_username, search: a.search,
        created_after: a.created_after, created_before: a.created_before,
        updated_after: a.updated_after, updated_before: a.updated_before,
        per_page: a.per_page, page: a.page,
      }),
      callId: c,
    });
  });

op('get_issue', 'issues', '读单条 issue(iid 是项目内编号,不是全局 id)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/issues/' + a.iid, callId: c });
  });

op('list_issue_comments', 'issues', '列 issue 的评论(已滤掉 system note)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    var out = await api({ url: r.proj + '/issues/' + a.iid + '/notes?sort=asc&per_page=100', callId: c });
    if (out.err) return out;
    return { data: (Array.isArray(out.data) ? out.data : []).filter(function (n) { return !n.system; }) };
  });

op('add_issue_comment', 'issues', '给 issue 加评论(写操作)', PROJ_DOC + ', iid*:int, body*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.body) return { err: '需要 iid / body' };
    return api({ url: r.proj + '/issues/' + a.iid + '/notes', method: 'POST', body: { body: a.body }, callId: c });
  });

op('create_issue', 'issues', '建 issue(写操作,内容先给用户确认)',
  PROJ_DOC + ', title*:string, description?:string, labels?:string(逗号分隔), assignee_ids?:int[]',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.title) return { err: '需要 title' };
    return api({
      url: r.proj + '/issues', method: 'POST',
      body: { title: a.title, description: a.description, labels: a.labels, assignee_ids: a.assignee_ids },
      callId: c,
    });
  });

op('update_issue', 'issues', '改 issue(state_event 开关状态;labels 整表覆盖,增量用 add_labels / remove_labels;写操作)',
  PROJ_DOC + ', iid*:int, title?, description?, labels?:string(逗号分隔,整表覆盖), add_labels?:string, remove_labels?:string, assignee_ids?:int[], state_event?:close|reopen',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({
      url: r.proj + '/issues/' + a.iid, method: 'PUT',
      body: {
        title: a.title, description: a.description, labels: a.labels,
        add_labels: a.add_labels, remove_labels: a.remove_labels,
        assignee_ids: a.assignee_ids, state_event: a.state_event,
      },
      callId: c,
    });
  });

op('update_issue_labels', 'issues', '增量增删 issue label(GitLab 单次 PUT 原生支持 add_labels / remove_labels,无需读改写)',
  PROJ_DOC + ', iid*:int, add_labels?:string[], remove_labels?:string[]',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    var add = Array.isArray(a.add_labels) ? a.add_labels : [];
    var rm = Array.isArray(a.remove_labels) ? a.remove_labels : [];
    if (!add.length && !rm.length) return { err: 'add_labels / remove_labels 至少传一个非空数组' };
    var body = {};
    if (add.length) body.add_labels = add.join(',');
    if (rm.length) body.remove_labels = rm.join(',');
    return api({ url: r.proj + '/issues/' + a.iid, method: 'PUT', body: body, callId: c });
  });

op('list_issue_related_merge_requests', 'issues', '列引用了该 issue 的 MR("Closes #N" 等)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/issues/' + a.iid + '/related_merge_requests', callId: c });
  });

op('list_issue_links', 'issues', '列 issue 链接(relates_to / blocks / is_blocked_by)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/issues/' + a.iid + '/links', callId: c });
  });

op('create_issue_link', 'issues', '建两条 issue 之间的链接(可跨项目;写操作)',
  PROJ_DOC + ', iid*:int(源 issue), target_project_id*:int|string(目标项目 id 或 path), target_issue_iid*:int, link_type?:relates_to|blocks|is_blocked_by',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.target_project_id || !a.target_issue_iid) return { err: '需要 iid / target_project_id / target_issue_iid' };
    return api({
      url: r.proj + '/issues/' + a.iid + '/links', method: 'POST',
      body: { target_project_id: a.target_project_id, target_issue_iid: a.target_issue_iid, link_type: a.link_type },
      callId: c,
    });
  });

op('delete_issue_link', 'issues', '删 issue 链接(link_id 来自 list_issue_links)', PROJ_DOC + ', iid*:int, link_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.link_id) return { err: '需要 iid / link_id' };
    return api({ url: r.proj + '/issues/' + a.iid + '/links/' + a.link_id, method: 'DELETE', callId: c });
  });

/* ── merge_requests(12) ────────────────────────────────────────────── */

var MR_LIST_QS_DOC = 'state?:opened|closed|merged|all, labels?:string(逗号分隔), order_by?:created_at|updated_at, sort?:asc|desc, scope?:created_by_me|assigned_to_me|all, author_username?, reviewer_username?, assignee_username?:string[](GitLab 声明为数组,单人也传单元素数组), approved_by_usernames?:string[](Premium), search?, created_after?, created_before?, updated_after?, updated_before?, ' + PP_DOC;

function mrListQs(a) {
  return qs({
    state: a.state, labels: a.labels, order_by: a.order_by, sort: a.sort, scope: a.scope,
    source_branch: a.source_branch, target_branch: a.target_branch,
    author_username: a.author_username, reviewer_username: a.reviewer_username,
    assignee_username: a.assignee_username, approved_by_usernames: a.approved_by_usernames,
    search: a.search,
    created_after: a.created_after, created_before: a.created_before,
    updated_after: a.updated_after, updated_before: a.updated_before,
    per_page: a.per_page, page: a.page,
  });
}

op('list_merge_requests', 'merge_requests', '列项目 MR',
  PROJ_DOC + ', source_branch?, target_branch?, ' + MR_LIST_QS_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/merge_requests' + mrListQs(a), callId: c });
  });

op('list_merge_requests_globally', 'merge_requests', '跨项目列认证用户可见的 MR(scope=all + author_username 可拉某人的全实例时间线,不用逐项目遍历)',
  MR_LIST_QS_DOC,
  async function (a, c) {
    var r = await apiBase(a); if (r.err) return r;
    return api({ url: r.base + '/merge_requests' + mrListQs(a), callId: c });
  });

op('get_merge_request', 'merge_requests', '读单条 MR(含 merge_status / draft / 分支信息)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/merge_requests/' + a.iid, callId: c });
  });

op('list_merge_request_comments', 'merge_requests', '列 MR 的评论(已滤掉 system note)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    var out = await api({ url: r.proj + '/merge_requests/' + a.iid + '/notes?sort=asc&per_page=100', callId: c });
    if (out.err) return out;
    return { data: (Array.isArray(out.data) ? out.data : []).filter(function (n) { return !n.system; }) };
  });

op('add_merge_request_comment', 'merge_requests', '给 MR 加评论(写操作)', PROJ_DOC + ', iid*:int, body*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.body) return { err: '需要 iid / body' };
    return api({ url: r.proj + '/merge_requests/' + a.iid + '/notes', method: 'POST', body: { body: a.body }, callId: c });
  });

op('create_merge_request', 'merge_requests', '建 MR(写操作;GitLab 创建端点没有 draft 参数,draft=true 时给 title 补 "Draft: " 前缀,已带 Draft:/WIP: 不重复补)',
  PROJ_DOC + ', title*:string, source_branch*:string, target_branch*:string, description?:string, draft?:bool',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.title || !a.source_branch || !a.target_branch) return { err: '需要 title / source_branch / target_branch' };
    var title = a.title;
    if (a.draft && !/^(draft|wip):/i.test(title)) title = 'Draft: ' + title;
    return api({
      url: r.proj + '/merge_requests', method: 'POST',
      body: { source_branch: a.source_branch, target_branch: a.target_branch, title: title, description: a.description },
      callId: c,
    });
  });

op('list_merge_request_commits', 'merge_requests', '列 MR 包含的 commit(按顺序)', PROJ_DOC + ', iid*:int, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/merge_requests/' + a.iid + '/commits' + qs(pg(a)), callId: c });
  });

op('list_merge_request_changes', 'merge_requests', '取 MR 的 per-file diff(MR 元信息 + changes[] 数组,old_path / new_path / diff)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/merge_requests/' + a.iid + '/changes', callId: c });
  });

op('merge_merge_request', 'merge_requests', '合并 MR(写操作,先给用户确认;sha 传了会校验 head 防并发误合)',
  PROJ_DOC + ', iid*:int, merge_commit_message?, squash?:bool, should_remove_source_branch?:bool, sha?:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({
      url: r.proj + '/merge_requests/' + a.iid + '/merge', method: 'PUT',
      body: {
        merge_commit_message: a.merge_commit_message, squash: a.squash,
        should_remove_source_branch: a.should_remove_source_branch, sha: a.sha,
      },
      callId: c,
    });
  });

op('update_merge_request', 'merge_requests', '改 MR(标题/正文/开关/label/assignee/reviewer/目标分支等;写操作)',
  PROJ_DOC + ', iid*:int, title?, description?, state_event?:close|reopen, labels?:string(整表覆盖), add_labels?:string, remove_labels?:string, assignee_ids?:int[], reviewer_ids?:int[], target_branch?, milestone_id?:int, remove_source_branch?:bool, squash?:bool, discussion_locked?:bool',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({
      url: r.proj + '/merge_requests/' + a.iid, method: 'PUT',
      body: {
        title: a.title, description: a.description, state_event: a.state_event,
        labels: a.labels, add_labels: a.add_labels, remove_labels: a.remove_labels,
        assignee_ids: a.assignee_ids, reviewer_ids: a.reviewer_ids,
        target_branch: a.target_branch, milestone_id: a.milestone_id,
        remove_source_branch: a.remove_source_branch, squash: a.squash,
        discussion_locked: a.discussion_locked,
      },
      callId: c,
    });
  });

op('list_merge_request_pipelines', 'merge_requests', '列 MR 触发过的 pipeline', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/merge_requests/' + a.iid + '/pipelines', callId: c });
  });

op('rebase_merge_request', 'merge_requests', '异步 rebase MR 源分支到目标分支(返 rebase_in_progress;写操作)',
  PROJ_DOC + ', iid*:int, skip_ci?:bool',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({
      url: r.proj + '/merge_requests/' + a.iid + '/rebase', method: 'PUT',
      body: a.skip_ci !== undefined ? { skip_ci: a.skip_ci } : {},
      callId: c,
    });
  });

/* ── repo(19) ──────────────────────────────────────────────────────── */

op('list_branches', 'repo', '列分支(单页 100)', PROJ_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/repository/branches?per_page=100', callId: c });
  });

op('list_labels', 'repo', '列项目 label(单页 100)', PROJ_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/labels?per_page=100', callId: c });
  });

op('ensure_labels', 'repo', '确保 label 存在(缺的按默认色创建,已有的跳过)', PROJ_DOC + ', names*:string[]',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!Array.isArray(a.names) || !a.names.length) return { err: '需要 names(至少一个)' };
    var cur = await api({ url: r.proj + '/labels?per_page=100', callId: c });
    if (cur.err) return cur;
    var have = {};
    (Array.isArray(cur.data) ? cur.data : []).forEach(function (l) { have[l.name] = 1; });
    var created = [];
    for (var i = 0; i < a.names.length; i++) {
      var n = a.names[i];
      if (have[n]) continue;
      var made = await api({ url: r.proj + '/labels', method: 'POST', body: { name: n, color: '#428BCA' }, callId: c });
      // 409 = 并发下已存在,视同成功跳过;其它错误如实反馈。
      if (made.err && made.err.indexOf('409') < 0) return made;
      if (!made.err) created.push(n);
    }
    return { data: { ensured: a.names, created: created } };
  });

op('list_repository_tree', 'repo', '列仓库某路径下的文件树(recursive=true 递归全子树,默认只列直接子项)',
  PROJ_DOC + ', path?:string(默认仓库根), ref?:string(分支/tag/sha,默认默认分支), recursive?:bool, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({
      url: r.proj + '/repository/tree' + qs({ path: a.path, ref: a.ref, recursive: a.recursive, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('get_file_raw', 'repo', '读文件 raw 文本内容(二进制文件可能解不成 UTF-8)',
  PROJ_DOC + ', path*:string, ref?:string(分支/tag/sha,默认默认分支)',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.path) return { err: '需要 path' };
    return api({
      url: r.proj + '/repository/files/' + encodeURIComponent(String(a.path)) + '/raw' + qs({ ref: a.ref }),
      text: true,
      callId: c,
    });
  });

op('list_tags', 'repo', '列仓库 tag(search 子串过滤)',
  PROJ_DOC + ', search?, order_by?:name|updated|version, sort?:asc|desc, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({
      url: r.proj + '/repository/tags' + qs({ search: a.search, order_by: a.order_by, sort: a.sort, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

var FILE_COMMIT_DOC = ', encoding?:text|base64, author_email?, author_name?, start_branch?, last_commit_id?';

op('create_file', 'repo', '在仓库建新文件(写操作)',
  PROJ_DOC + ', path*, branch*, content*, commit_message*' + FILE_COMMIT_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.path || !a.branch || typeof a.content !== 'string' || !a.commit_message) return { err: '需要 path / branch / content / commit_message' };
    return api({
      url: r.proj + '/repository/files/' + encodeURIComponent(String(a.path)), method: 'POST',
      body: {
        branch: a.branch, content: a.content, commit_message: a.commit_message, encoding: a.encoding,
        author_email: a.author_email, author_name: a.author_name,
        start_branch: a.start_branch, last_commit_id: a.last_commit_id,
      },
      callId: c,
    });
  });

op('update_file', 'repo', '改仓库已有文件(写操作)',
  PROJ_DOC + ', path*, branch*, content*, commit_message*' + FILE_COMMIT_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.path || !a.branch || typeof a.content !== 'string' || !a.commit_message) return { err: '需要 path / branch / content / commit_message' };
    return api({
      url: r.proj + '/repository/files/' + encodeURIComponent(String(a.path)), method: 'PUT',
      body: {
        branch: a.branch, content: a.content, commit_message: a.commit_message, encoding: a.encoding,
        author_email: a.author_email, author_name: a.author_name,
        start_branch: a.start_branch, last_commit_id: a.last_commit_id,
      },
      callId: c,
    });
  });

op('delete_file', 'repo', '删仓库单文件(写操作;GitLab 该端点是 DELETE 带 JSON body)',
  PROJ_DOC + ', path*, branch*, commit_message*, author_email?, author_name?, start_branch?, last_commit_id?',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.path || !a.branch || !a.commit_message) return { err: '需要 path / branch / commit_message' };
    return api({
      url: r.proj + '/repository/files/' + encodeURIComponent(String(a.path)), method: 'DELETE',
      body: {
        branch: a.branch, commit_message: a.commit_message,
        author_email: a.author_email, author_name: a.author_name,
        start_branch: a.start_branch, last_commit_id: a.last_commit_id,
      },
      callId: c,
    });
  });

op('list_project_protected_branches', 'repo', '列分支保护规则(单页 100)', PROJ_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/protected_branches?per_page=100', callId: c });
  });

var ARCHIVE_FORMATS = { zip: 1, 'tar.gz': 1, 'tar.bz2': 1, tar: 1, tb2: 1, tbz: 1, tbz2: 1, tb: 1 };

op('get_repository_archive', 'repo', '下载仓库归档到用户本地目录(需要主 agent 调 ghost_call 时把目标目录绝对路径放在顶层 save_dir 参数)',
  PROJ_DOC + ', sha?:string(分支/tag/commit,默认默认分支), format?:zip|tar.gz|tar.bz2|tar|tb2|tbz|tbz2|tb(默认 zip), filename?:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    var format = a.format || 'zip';
    if (!ARCHIVE_FORMATS[format]) return { err: 'format 只认 ' + Object.keys(ARCHIVE_FORMATS).join(' / ') + ',收到:' + format };
    var baseName = String(a.project_path).split('/').pop();
    var refPart = (a.sha ? String(a.sha) : 'default').replace(/[^0-9A-Za-z._-]/g, '-');
    var done = await downloadFile(
      r.proj + '/repository/archive.' + format + qs({ sha: a.sha }),
      a, c, baseName + '-' + refPart + '.' + format,
    );
    if (done.err) return done;
    return { result: done.result };
  });

op('commit_multiple_files', 'repo', '单 commit 提交多个文件动作(create/update/delete/move/chmod;GitLab 单端点原生支持,写操作)',
  PROJ_DOC + ', branch*, commit_message*, actions*:[{action*:create|update|delete|move|chmod, file_path*, previous_path?, content?, encoding?:text|base64, last_commit_id?, execute_filemode?:bool}], start_branch?, start_sha?, author_email?, author_name?, stats?:bool',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.branch || !a.commit_message || !Array.isArray(a.actions) || !a.actions.length) return { err: '需要 branch / commit_message / actions(至少一条)' };
    return api({
      url: r.proj + '/repository/commits', method: 'POST',
      body: {
        branch: a.branch, commit_message: a.commit_message, actions: a.actions,
        start_branch: a.start_branch, start_sha: a.start_sha,
        author_email: a.author_email, author_name: a.author_name, stats: a.stats,
      },
      callId: c,
    });
  });

op('create_branch', 'repo', '建分支(ref 是已有分支名或 commit sha;写操作)', PROJ_DOC + ', branch*:string(新分支名), ref*:string(起点)',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.branch || !a.ref) return { err: '需要 branch / ref' };
    return api({ url: r.proj + '/repository/branches', method: 'POST', body: { branch: a.branch, ref: a.ref }, callId: c });
  });

op('delete_branch', 'repo', '删分支(写操作)', PROJ_DOC + ', branch*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.branch) return { err: '需要 branch' };
    var out = await api({ url: r.proj + '/repository/branches/' + encodeURIComponent(String(a.branch)), method: 'DELETE', callId: c });
    if (out.err) return out;
    return { data: { deleted: true, branch: a.branch } };
  });

op('get_branch', 'repo', '读单个分支', PROJ_DOC + ', branch*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.branch) return { err: '需要 branch' };
    return api({ url: r.proj + '/repository/branches/' + encodeURIComponent(String(a.branch)), callId: c });
  });

op('create_tag', 'repo', '在 ref 上建 tag(message = 注解 tag;release_description 顺带建 release;写操作)',
  PROJ_DOC + ', tag_name*, ref*, message?, release_description?',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.tag_name || !a.ref) return { err: '需要 tag_name / ref' };
    return api({
      url: r.proj + '/repository/tags', method: 'POST',
      body: { tag_name: a.tag_name, ref: a.ref, message: a.message, release_description: a.release_description },
      callId: c,
    });
  });

op('delete_tag', 'repo', '删 tag(写操作)', PROJ_DOC + ', tag_name*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.tag_name) return { err: '需要 tag_name' };
    var out = await api({ url: r.proj + '/repository/tags/' + encodeURIComponent(String(a.tag_name)), method: 'DELETE', callId: c });
    if (out.err) return out;
    return { data: { deleted: true, tag_name: a.tag_name } };
  });

op('get_tag', 'repo', '读单个 tag', PROJ_DOC + ', tag_name*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.tag_name) return { err: '需要 tag_name' };
    return api({ url: r.proj + '/repository/tags/' + encodeURIComponent(String(a.tag_name)), callId: c });
  });

op('get_label', 'repo', '读单个 label(数字 id 或名字)', PROJ_DOC + ', label*:int|string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (a.label === undefined || a.label === null || a.label === '') return { err: '需要 label(数字 id 或名字)' };
    return api({ url: r.proj + '/labels/' + encodeURIComponent(String(a.label)), callId: c });
  });

/* ── commits(4) ────────────────────────────────────────────────────── */

op('list_commits', 'commits', '列 commit(可按分支/路径/作者/时间过滤;all=true 含所有分支)',
  PROJ_DOC + ', ref_name?:string(分支或 tag), since?:ISO, until?:ISO, path?, author?:string(名字或邮箱), all?:bool, with_stats?:bool, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({
      url: r.proj + '/repository/commits' + qs({
        ref_name: a.ref_name, since: a.since, until: a.until, path: a.path, author: a.author,
        all: a.all, with_stats: a.with_stats, per_page: a.per_page, page: a.page,
      }),
      callId: c,
    });
  });

op('get_commit', 'commits', '读单个 commit(stats=true 带增删行数)', PROJ_DOC + ', sha*:string, stats?:bool',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.sha) return { err: '需要 sha' };
    return api({ url: r.proj + '/repository/commits/' + encodeURIComponent(String(a.sha)) + qs({ stats: a.stats }), callId: c });
  });

op('get_commit_diff', 'commits', '取单个 commit 的 per-file diff', PROJ_DOC + ', sha*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.sha) return { err: '需要 sha' };
    return api({ url: r.proj + '/repository/commits/' + encodeURIComponent(String(a.sha)) + '/diff', callId: c });
  });

op('compare_refs', 'commits', '比较两个 ref(straight=true 纯 diff,默认 merge-base 语义;返 commits + diffs)',
  PROJ_DOC + ', from*:string(base), to*:string(head), straight?:bool',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.from || !a.to) return { err: '需要 from / to' };
    return api({ url: r.proj + '/repository/compare' + qs({ from: a.from, to: a.to, straight: a.straight }), callId: c });
  });

/* ── events(3) ─────────────────────────────────────────────────────── */

var EVENT_QS_DOC = 'action?, target_type?, before?:ISO日期上界, after?:ISO日期下界, sort?:asc|desc, ' + PP_DOC;

function eventQs(a) {
  return qs({
    action: a.action, target_type: a.target_type, before: a.before, after: a.after,
    sort: a.sort, per_page: a.per_page, page: a.page,
  });
}

op('list_events', 'events', '认证用户自己的事件流', EVENT_QS_DOC,
  async function (a, c) {
    var r = await apiBase(a); if (r.err) return r;
    return api({ url: r.base + '/events' + eventQs(a), callId: c });
  });

op('list_user_events', 'events', '指定用户的事件流(按 after/before 拉工作活动时间线;GitLab 该端点只认数字 user id,传 username 时自动先解析成 id)',
  'user*:int|string(数字 id 或 username), ' + EVENT_QS_DOC,
  async function (a, c) {
    if (a.user === undefined || a.user === null || a.user === '') return { err: '需要 user(数字 id 或 username)' };
    var r = await apiBase(a); if (r.err) return r;
    var user = a.user;
    if (typeof user !== 'number' && !/^\d+$/.test(String(user))) {
      var found = await api({ url: r.base + '/users' + qs({ username: String(user) }), callId: c });
      if (found.err) return found;
      var u0 = (Array.isArray(found.data) && found.data[0]) || null;
      if (!u0) return { err: '找不到用户:' + user + '(当前 token 可见范围内无此 username)' };
      user = u0.id;
    }
    return api({ url: r.base + '/users/' + encodeURIComponent(String(user)) + '/events' + eventQs(a), callId: c });
  });

op('list_project_events', 'events', '单个项目的事件流', PROJ_DOC + ', ' + EVENT_QS_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/events' + eventQs(a), callId: c });
  });

/* ── search(2) ─────────────────────────────────────────────────────── */

var GLOBAL_SCOPES = { projects: 1, issues: 1, merge_requests: 1, milestones: 1, snippet_titles: 1, users: 1, wiki_blobs: 1, commits: 1, blobs: 1, notes: 1 };
var PROJECT_SCOPES = { issues: 1, merge_requests: 1, milestones: 1, users: 1, wiki_blobs: 1, commits: 1, blobs: 1, notes: 1 };

op('search_globally', 'search', '全实例搜索(不同 scope 返回结构不同,按 scope 消费)',
  'scope*:projects|issues|merge_requests|milestones|snippet_titles|users|wiki_blobs|commits|blobs|notes, search*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.scope || !a.search) return { err: '需要 scope / search' };
    if (!GLOBAL_SCOPES[a.scope]) return { err: '未知 scope:' + a.scope + '(可用:' + Object.keys(GLOBAL_SCOPES).join(' / ') + ')' };
    var r = await apiBase(a); if (r.err) return r;
    return api({ url: r.base + '/search' + qs({ scope: a.scope, search: a.search, per_page: a.per_page, page: a.page }), callId: c });
  });

op('search_in_project', 'search', '项目内搜索(projects / snippet_titles 是全局独有 scope,项目内不可用,改走 search_globally)',
  PROJ_DOC + ', scope*:issues|merge_requests|milestones|users|wiki_blobs|commits|blobs|notes, search*:string, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.scope || !a.search) return { err: '需要 scope / search' };
    if (!PROJECT_SCOPES[a.scope]) return { err: 'scope ' + a.scope + ' 在项目内搜索不可用(可用:' + Object.keys(PROJECT_SCOPES).join(' / ') + ';projects / snippet_titles 用 search_globally)' };
    return api({ url: r.proj + '/search' + qs({ scope: a.scope, search: a.search, per_page: a.per_page, page: a.page }), callId: c });
  });

/* ── projects(13) ──────────────────────────────────────────────────── */

op('list_projects', 'projects', '列认证用户可见的项目(membership / owned / starred / search 过滤)',
  'membership?:bool, owned?:bool, starred?:bool, search?, order_by?:id|name|path|created_at|updated_at|last_activity_at, sort?:asc|desc, visibility?:public|internal|private, simple?:bool, archived?:bool, ' + PP_DOC,
  async function (a, c) {
    var r = await apiBase(a); if (r.err) return r;
    return api({
      url: r.base + '/projects' + qs({
        membership: a.membership, owned: a.owned, starred: a.starred, search: a.search,
        order_by: a.order_by, sort: a.sort, visibility: a.visibility, simple: a.simple,
        archived: a.archived, per_page: a.per_page, page: a.page,
      }),
      callId: c,
    });
  });

op('get_project', 'projects', '项目元信息(default_branch / visibility / star 数等)', PROJ_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj, callId: c });
  });

op('list_group_projects', 'projects', '列 group(或子 group)下的项目(include_subgroups=true 下钻子 group)',
  'group*:int|string(group id 或完整 path), search?, include_subgroups?:bool, archived?:bool, ' + PP_DOC,
  async function (a, c) {
    if (a.group === undefined || a.group === null || a.group === '') return { err: '需要 group(id 或完整 path)' };
    var r = await apiBase(a); if (r.err) return r;
    return api({
      url: r.base + '/groups/' + encodeURIComponent(String(a.group)) + '/projects' + qs({
        search: a.search, include_subgroups: a.include_subgroups, archived: a.archived,
        per_page: a.per_page, page: a.page,
      }),
      callId: c,
    });
  });

op('list_project_milestones', 'projects', '列项目里程碑', PROJ_DOC + ', state?:active|closed, search?, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/milestones' + qs({ state: a.state, search: a.search, per_page: a.per_page, page: a.page }), callId: c });
  });

op('list_project_members', 'projects', '列项目直接成员', PROJ_DOC + ', query?, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/members' + qs({ query: a.query, per_page: a.per_page, page: a.page }), callId: c });
  });

op('list_project_hooks', 'projects', '列项目 webhook(需要 maintainer;单页 100)', PROJ_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/hooks?per_page=100', callId: c });
  });

op('list_project_variables', 'projects', '列 CI/CD 变量的 metadata(key / 类型 / protected / masked / scope;需要 maintainer)。value 永不返回——防止明文凭据流进对话,raw=true 也不豁免',
  PROJ_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    var out = await api({ url: r.proj + '/variables?per_page=100', callId: c });
    if (out.err) return out;
    // 防泄密:CI 变量的 value 可能是明文凭据(masked 只影响 job log 显示,
    // API 仍返原文),逐条剥掉,只留 metadata——与老 MCP stripVariableValues
    // 行为对齐,且在 run 层剥、raw 逃生口也拿不到。
    var vars = Array.isArray(out.data) ? out.data : [];
    for (var i = 0; i < vars.length; i++) {
      if (vars[i] && typeof vars[i] === 'object') delete vars[i].value;
    }
    return { data: vars };
  });

op('list_project_forks', 'projects', '列项目的 fork', PROJ_DOC + ', ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/forks' + qs(pg(a)), callId: c });
  });

op('fork_project', 'projects', 'fork 项目到认证用户或指定 namespace(写操作)',
  PROJ_DOC + ', namespace?:int|string, namespace_id?:int, namespace_path?, name?, path?, description?, visibility?:private|internal|public',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({
      url: r.proj + '/fork', method: 'POST',
      body: {
        namespace: a.namespace, namespace_id: a.namespace_id, namespace_path: a.namespace_path,
        name: a.name, path: a.path, description: a.description, visibility: a.visibility,
      },
      callId: c,
    });
  });

op('star_project', 'projects', 'star 项目(已 star 时 GitLab 返 304,视为成功 no-op;写操作)', PROJ_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/star', method: 'POST', body: {}, callId: c });
  });

op('unstar_project', 'projects', '取消 star(未 star 时 GitLab 返 304,视为成功 no-op;写操作)', PROJ_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/unstar', method: 'POST', body: {}, callId: c });
  });

op('create_project', 'projects', '建项目(归认证用户,或经 namespace_id 建到指定 namespace;写操作)',
  'name*, path?, namespace_id?:int, description?, visibility?:private|internal|public, initialize_with_readme?:bool, default_branch?',
  async function (a, c) {
    if (!a.name) return { err: '需要 name' };
    var r = await apiBase(a); if (r.err) return r;
    return api({
      url: r.base + '/projects', method: 'POST',
      body: {
        name: a.name, path: a.path, namespace_id: a.namespace_id, description: a.description,
        visibility: a.visibility, initialize_with_readme: a.initialize_with_readme,
        default_branch: a.default_branch,
      },
      callId: c,
    });
  });

op('upload_project_file', 'projects', '把用户随消息发给插件的图片附件上传到项目附件区(POST /uploads,不进 git 仓库、不产生 commit),返回可直接嵌入 issue / MR 描述或评论的 markdown(图片渲染为 ![](url))。用法:用户发图 → 主 agent 调 ghost_call 时把图片地址放顶层 attachments 过户 → 本操作按 attachment_index 取第几张上传',
  PROJ_DOC + ', attachment_index?:int(取过户附件的第几张,默认 0)',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    var granted = Array.isArray(a.attachments) ? a.attachments : [];
    var hashes = [];
    for (var i = 0; i < granted.length; i++) {
      var h = extractHash(granted[i]);
      if (h && hashes.indexOf(h) === -1) hashes.push(h);
    }
    if (!hashes.length) {
      return { err: '没有可上传的附件——需要用户随消息发图,且主 agent 调 ghost_call 时把图片地址放在顶层 attachments 参数过户给本插件' };
    }
    var idx = a.attachment_index || 0;
    if (idx < 0 || idx >= hashes.length) return { err: 'attachment_index 越界:本次共过户 ' + hashes.length + ' 张附件(0 起数)' };
    var res = await cindy.fetch({
      url: r.proj + '/uploads',
      method: 'POST',
      upload: { hashes: [hashes[idx]], field: 'file' },
      callId: c,
    });
    if (!res.ok) return { err: res.message };
    if (res.status < 200 || res.status >= 300) {
      var snippet = typeof res.body === 'string' ? res.body.slice(0, 300) : '';
      return { err: classifyStatus(res.status, snippet) };
    }
    var data = null;
    if (res.body) {
      try { data = JSON.parse(res.body); } catch (e) { data = res.body; }
    }
    return { data: data };
  });

/* ── users(2) ──────────────────────────────────────────────────────── */

op('search_users', 'users', '按名字 / username / 邮箱搜用户', 'query*:string, per_page?:1-100',
  async function (a, c) {
    if (!a.query) return { err: '需要 query' };
    var r = await apiBase(a); if (r.err) return r;
    return api({ url: r.base + '/users' + qs({ search: a.query, per_page: a.per_page }), callId: c });
  });

op('get_user_by_username', 'users', '按精确 username 查单个用户(查不到返回 null)', 'username*:string',
  async function (a, c) {
    if (!a.username) return { err: '需要 username' };
    var r = await apiBase(a); if (r.err) return r;
    var out = await api({ url: r.base + '/users' + qs({ username: a.username }), callId: c });
    if (out.err) return out;
    return { data: (Array.isArray(out.data) && out.data[0]) || null };
  });

/* ── pipelines(4) ──────────────────────────────────────────────────── */

op('list_pipelines', 'pipelines', '列 CI pipeline(scope / status / ref / sha / username 过滤)',
  PROJ_DOC + ', scope?:running|pending|finished|branches|tags, status?, ref?, sha?, username?, updated_after?, updated_before?, order_by?:id|status|ref|updated_at|user_id, sort?:asc|desc, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({
      url: r.proj + '/pipelines' + qs({
        scope: a.scope, status: a.status, ref: a.ref, sha: a.sha, username: a.username,
        updated_after: a.updated_after, updated_before: a.updated_before,
        order_by: a.order_by, sort: a.sort, per_page: a.per_page, page: a.page,
      }),
      callId: c,
    });
  });

op('get_pipeline', 'pipelines', '读单个 pipeline', PROJ_DOC + ', pipeline_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.pipeline_id) return { err: '需要 pipeline_id' };
    return api({ url: r.proj + '/pipelines/' + a.pipeline_id, callId: c });
  });

op('list_pipeline_jobs', 'pipelines', '列 pipeline 里的 job(scope 可按状态过滤,如 failed)', PROJ_DOC + ', pipeline_id*:int, scope?, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.pipeline_id) return { err: '需要 pipeline_id' };
    return api({ url: r.proj + '/pipelines/' + a.pipeline_id + '/jobs' + qs({ scope: a.scope, per_page: a.per_page, page: a.page }), callId: c });
  });

op('list_pipeline_schedules', 'pipelines', '列 pipeline 定时计划(单页 100)', PROJ_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/pipeline_schedules?per_page=100', callId: c });
  });

/* ── jobs(3) ───────────────────────────────────────────────────────── */

op('get_job_log', 'jobs', '取 CI job 的 raw 日志(纯文本;大日志会按交卷护栏截断)', PROJ_DOC + ', job_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.job_id) return { err: '需要 job_id' };
    return api({ url: r.proj + '/jobs/' + a.job_id + '/trace', text: true, callId: c });
  });

op('retry_job', 'jobs', '重试 CI job(写操作)', PROJ_DOC + ', job_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.job_id) return { err: '需要 job_id' };
    return api({ url: r.proj + '/jobs/' + a.job_id + '/retry', method: 'POST', body: {}, callId: c });
  });

op('cancel_job', 'jobs', '取消运行中的 CI job(写操作)', PROJ_DOC + ', job_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.job_id) return { err: '需要 job_id' };
    return api({ url: r.proj + '/jobs/' + a.job_id + '/cancel', method: 'POST', body: {}, callId: c });
  });

/* ── discussions(3) ────────────────────────────────────────────────── */

var POSITION_DOC = 'position?:{base_sha*, start_sha*, head_sha*, position_type*:text|image|file, old_path?, new_path?, old_line?:int, new_line?:int}';

op('list_merge_request_discussions', 'discussions', '列 MR 的 discussion 线程(含 note 与 diff 定位;单页 100)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/merge_requests/' + a.iid + '/discussions?per_page=100', callId: c });
  });

op('create_merge_request_discussion', 'discussions', '在 MR 上开新 discussion(传 position 锚到 diff 行;写操作)',
  PROJ_DOC + ', iid*:int, body*:string, commit_id?, ' + POSITION_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.body) return { err: '需要 iid / body' };
    return api({
      url: r.proj + '/merge_requests/' + a.iid + '/discussions', method: 'POST',
      body: { body: a.body, position: a.position, commit_id: a.commit_id },
      callId: c,
    });
  });

op('resolve_merge_request_discussion', 'discussions', 'resolve / unresolve 一条 discussion(写操作)',
  PROJ_DOC + ', iid*:int, discussion_id*:string, resolved*:bool',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.discussion_id || typeof a.resolved !== 'boolean') return { err: '需要 iid / discussion_id / resolved(bool)' };
    return api({
      url: r.proj + '/merge_requests/' + a.iid + '/discussions/' + encodeURIComponent(String(a.discussion_id)),
      method: 'PUT', body: { resolved: a.resolved }, callId: c,
    });
  });

/* ── approvals(3) ──────────────────────────────────────────────────── */

op('list_merge_request_approvals', 'approvals', '读 MR 审批状态(需要几个 / 还差几个 / 谁批了)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/merge_requests/' + a.iid + '/approvals', callId: c });
  });

op('approve_merge_request', 'approvals', '以认证用户身份 approve MR(sha 传了防并发 push 后误批;写操作)', PROJ_DOC + ', iid*:int, sha?:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/merge_requests/' + a.iid + '/approve', method: 'POST', body: a.sha ? { sha: a.sha } : {}, callId: c });
  });

op('unapprove_merge_request', 'approvals', '撤回认证用户对 MR 的 approve(写操作)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    var out = await api({ url: r.proj + '/merge_requests/' + a.iid + '/unapprove', method: 'POST', body: {}, callId: c });
    if (out.err) return out;
    return { data: { unapproved: true } };
  });

/* ── draft_notes(6) ────────────────────────────────────────────────── */

op('list_draft_notes', 'draft_notes', '列 MR 上未发布的草稿评论(pending review,只有作者本人可见)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/merge_requests/' + a.iid + '/draft_notes', callId: c });
  });

op('create_draft_note', 'draft_notes', '建一条草稿评论(position 锚 diff 行;in_reply_to_discussion_id 在已有线程里回复;写操作)',
  PROJ_DOC + ', iid*:int, note*:string, resolve_discussion?:bool, in_reply_to_discussion_id?:string, ' + POSITION_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.note) return { err: '需要 iid / note' };
    return api({
      url: r.proj + '/merge_requests/' + a.iid + '/draft_notes', method: 'POST',
      body: {
        note: a.note, position: a.position,
        resolve_discussion: a.resolve_discussion,
        in_reply_to_discussion_id: a.in_reply_to_discussion_id,
      },
      callId: c,
    });
  });

op('update_draft_note', 'draft_notes', '改草稿评论(发布前改正文 / 锚点)', PROJ_DOC + ', iid*:int, draft_note_id*:int, note?, ' + POSITION_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.draft_note_id) return { err: '需要 iid / draft_note_id' };
    return api({
      url: r.proj + '/merge_requests/' + a.iid + '/draft_notes/' + a.draft_note_id,
      method: 'PUT', body: { note: a.note, position: a.position }, callId: c,
    });
  });

op('publish_draft_note', 'draft_notes', '发布单条草稿评论(写操作)', PROJ_DOC + ', iid*:int, draft_note_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.draft_note_id) return { err: '需要 iid / draft_note_id' };
    var out = await api({
      url: r.proj + '/merge_requests/' + a.iid + '/draft_notes/' + a.draft_note_id + '/publish',
      method: 'PUT', body: {}, callId: c,
    });
    if (out.err) return out;
    return { data: { published: true, draft_note_id: a.draft_note_id } };
  });

op('bulk_publish_draft_notes', 'draft_notes', '一次发布 MR 上全部草稿评论(写操作)', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    var out = await api({
      url: r.proj + '/merge_requests/' + a.iid + '/draft_notes/bulk_publish',
      method: 'POST', body: {}, callId: c,
    });
    if (out.err) return out;
    return { data: { published: true } };
  });

op('delete_draft_note', 'draft_notes', '删未发布的草稿评论', PROJ_DOC + ', iid*:int, draft_note_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.draft_note_id) return { err: '需要 iid / draft_note_id' };
    var out = await api({
      url: r.proj + '/merge_requests/' + a.iid + '/draft_notes/' + a.draft_note_id,
      method: 'DELETE', callId: c,
    });
    if (out.err) return out;
    return { data: { deleted: true, draft_note_id: a.draft_note_id } };
  });

/* ── reactions(9,award emoji) ─────────────────────────────────────── */

var EMOJI_DOC = 'name 是 emoji 名,如 thumbsup / thumbsdown / heart / rocket';

op('list_issue_award_emoji', 'reactions', '列 issue 的 award emoji', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/issues/' + a.iid + '/award_emoji', callId: c });
  });

op('add_issue_award_emoji', 'reactions', '给 issue 加 award emoji(' + EMOJI_DOC + ')', PROJ_DOC + ', iid*:int, name*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.name) return { err: '需要 iid / name' };
    return api({ url: r.proj + '/issues/' + a.iid + '/award_emoji', method: 'POST', body: { name: a.name }, callId: c });
  });

op('remove_issue_award_emoji', 'reactions', '删 issue 上自己的 award emoji(award_id 来自 list)', PROJ_DOC + ', iid*:int, award_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.award_id) return { err: '需要 iid / award_id' };
    var out = await api({ url: r.proj + '/issues/' + a.iid + '/award_emoji/' + a.award_id, method: 'DELETE', callId: c });
    if (out.err) return out;
    return { data: { removed: true, award_id: a.award_id } };
  });

op('list_merge_request_award_emoji', 'reactions', '列 MR 的 award emoji', PROJ_DOC + ', iid*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid) return { err: '需要 iid' };
    return api({ url: r.proj + '/merge_requests/' + a.iid + '/award_emoji', callId: c });
  });

op('add_merge_request_award_emoji', 'reactions', '给 MR 加 award emoji(' + EMOJI_DOC + ')', PROJ_DOC + ', iid*:int, name*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.name) return { err: '需要 iid / name' };
    return api({ url: r.proj + '/merge_requests/' + a.iid + '/award_emoji', method: 'POST', body: { name: a.name }, callId: c });
  });

op('remove_merge_request_award_emoji', 'reactions', '删 MR 上自己的 award emoji', PROJ_DOC + ', iid*:int, award_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.iid || !a.award_id) return { err: '需要 iid / award_id' };
    var out = await api({ url: r.proj + '/merge_requests/' + a.iid + '/award_emoji/' + a.award_id, method: 'DELETE', callId: c });
    if (out.err) return out;
    return { data: { removed: true, award_id: a.award_id } };
  });

function noteableSeg(a) {
  if (a.noteable !== 'issues' && a.noteable !== 'merge_requests') {
    return { err: 'noteable 只认 issues / merge_requests' };
  }
  if (!a.iid || !a.note_id) return { err: '需要 iid / note_id' };
  return { seg: '/' + a.noteable + '/' + a.iid + '/notes/' + a.note_id + '/award_emoji' };
}

op('list_note_award_emoji', 'reactions', '列 issue / MR 某条评论(note)的 award emoji',
  PROJ_DOC + ', noteable*:issues|merge_requests, iid*:int, note_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    var n = noteableSeg(a); if (n.err) return n;
    return api({ url: r.proj + n.seg, callId: c });
  });

op('add_note_award_emoji', 'reactions', '给评论(note)加 award emoji(' + EMOJI_DOC + ')',
  PROJ_DOC + ', noteable*:issues|merge_requests, iid*:int, note_id*:int, name*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    var n = noteableSeg(a); if (n.err) return n;
    if (!a.name) return { err: '需要 name' };
    return api({ url: r.proj + n.seg, method: 'POST', body: { name: a.name }, callId: c });
  });

op('remove_note_award_emoji', 'reactions', '删评论(note)上自己的 award emoji',
  PROJ_DOC + ', noteable*:issues|merge_requests, iid*:int, note_id*:int, award_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    var n = noteableSeg(a); if (n.err) return n;
    if (!a.award_id) return { err: '需要 award_id' };
    var out = await api({ url: r.proj + n.seg + '/' + a.award_id, method: 'DELETE', callId: c });
    if (out.err) return out;
    return { data: { removed: true, award_id: a.award_id } };
  });

/* ── groups(4) ─────────────────────────────────────────────────────── */

var GROUP_DOC = 'group_id*:int|string(group id 或完整 path,如 "smash" / "smash/sub")';

op('list_group_milestones', 'groups', '列 group 里程碑', GROUP_DOC + ', state?:active|closed, search?, ' + PP_DOC,
  async function (a, c) {
    if (a.group_id === undefined || a.group_id === null || a.group_id === '') return { err: '需要 group_id' };
    var r = await apiBase(a); if (r.err) return r;
    return api({
      url: r.base + '/groups/' + encodeURIComponent(String(a.group_id)) + '/milestones' + qs({ state: a.state, search: a.search, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('list_group_members', 'groups', '列 group 成员', GROUP_DOC + ', query?, ' + PP_DOC,
  async function (a, c) {
    if (a.group_id === undefined || a.group_id === null || a.group_id === '') return { err: '需要 group_id' };
    var r = await apiBase(a); if (r.err) return r;
    return api({
      url: r.base + '/groups/' + encodeURIComponent(String(a.group_id)) + '/members' + qs({ query: a.query, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('list_group_issues', 'groups', '列 group 下所有项目的 issue',
  GROUP_DOC + ', state?:opened|closed|all, labels?, scope?, author_username?, assignee_username?, search?, milestone?, created_after?, created_before?, updated_after?, updated_before?, order_by?:created_at|updated_at, sort?, ' + PP_DOC,
  async function (a, c) {
    if (a.group_id === undefined || a.group_id === null || a.group_id === '') return { err: '需要 group_id' };
    var r = await apiBase(a); if (r.err) return r;
    return api({
      url: r.base + '/groups/' + encodeURIComponent(String(a.group_id)) + '/issues' + qs({
        state: a.state, labels: a.labels, scope: a.scope,
        author_username: a.author_username, assignee_username: a.assignee_username,
        search: a.search, milestone: a.milestone,
        created_after: a.created_after, created_before: a.created_before,
        updated_after: a.updated_after, updated_before: a.updated_before,
        order_by: a.order_by, sort: a.sort, per_page: a.per_page, page: a.page,
      }),
      callId: c,
    });
  });

op('list_group_merge_requests', 'groups', '列 group 下所有项目的 MR',
  GROUP_DOC + ', ' + MR_LIST_QS_DOC,
  async function (a, c) {
    if (a.group_id === undefined || a.group_id === null || a.group_id === '') return { err: '需要 group_id' };
    var r = await apiBase(a); if (r.err) return r;
    return api({
      url: r.base + '/groups/' + encodeURIComponent(String(a.group_id)) + '/merge_requests' + mrListQs(a),
      callId: c,
    });
  });

/* ── environments(2) ───────────────────────────────────────────────── */

op('list_project_environments', 'environments', '列部署环境', PROJ_DOC + ', name?, search?, states?:available|stopping|stopped, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({
      url: r.proj + '/environments' + qs({ name: a.name, search: a.search, states: a.states, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('list_project_deployments', 'environments', '列 deployment',
  PROJ_DOC + ', environment?, status?:created|running|success|failed|canceled|blocked, updated_after?, updated_before?, order_by?:id|iid|created_at|updated_at|ref, sort?, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({
      url: r.proj + '/deployments' + qs({
        environment: a.environment, status: a.status,
        updated_after: a.updated_after, updated_before: a.updated_before,
        order_by: a.order_by, sort: a.sort, per_page: a.per_page, page: a.page,
      }),
      callId: c,
    });
  });

/* ── wiki(2) ───────────────────────────────────────────────────────── */

op('list_wiki_pages', 'wiki', '列项目 wiki 页(with_content=true 带正文)', PROJ_DOC + ', with_content?:bool',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/wikis' + qs({ with_content: a.with_content }), callId: c });
  });

op('get_wiki_page', 'wiki', '按 slug 读单个 wiki 页', PROJ_DOC + ', slug*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.slug) return { err: '需要 slug' };
    return api({ url: r.proj + '/wikis/' + encodeURIComponent(String(a.slug)), callId: c });
  });

/* ── snippets(2) ───────────────────────────────────────────────────── */

op('list_snippets', 'snippets', '列项目 snippet(单页 100)', PROJ_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/snippets?per_page=100', callId: c });
  });

op('get_snippet', 'snippets', '读单个 snippet', PROJ_DOC + ', snippet_id*:int',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.snippet_id) return { err: '需要 snippet_id' };
    return api({ url: r.proj + '/snippets/' + a.snippet_id, callId: c });
  });

/* ── releases(2) ───────────────────────────────────────────────────── */

op('list_releases', 'releases', '列 release', PROJ_DOC + ', order_by?:released_at|created_at, sort?:asc|desc, ' + PP_DOC,
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    return api({ url: r.proj + '/releases' + qs({ order_by: a.order_by, sort: a.sort, per_page: a.per_page, page: a.page }), callId: c });
  });

op('get_release', 'releases', '按 tag 名读单个 release', PROJ_DOC + ', tag_name*:string',
  async function (a, c) {
    var r = await projBase(a); if (r.err) return r;
    if (!a.tag_name) return { err: '需要 tag_name' };
    return api({ url: r.proj + '/releases/' + encodeURIComponent(String(a.tag_name)), callId: c });
  });

/* ── meta(1) ───────────────────────────────────────────────────────── */

op('get_current_user', 'meta', '当前 token 对应的用户(username / id / 主页)', '无必填参数(instance? 选实例)',
  async function (a, c) {
    var r = await apiBase(a); if (r.err) return r;
    return api({ url: r.base + '/user', callId: c });
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
        hint: '传 category 看该类目下的操作明细;执行用 call_tool({name, args})。project 级操作必须显式传 project_path;配了多个 GitLab 实例时在 args 里带 instance(连接 id 或实例地址)选实例。',
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
    result: { category: category, tools: tools, hint: '执行用 call_tool({name, args});参数记法:* 必填,pp = per_page/page;所有操作可带 instance? 选 GitLab 实例。' },
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
  // save_dir / dir 票据与附件指纹由主机注入在 call_tool 这一层,下传给具体操作。
  if (args.save_deposit) inner.save_deposit = args.save_deposit;
  if (args.dir_deposit) inner.dir_deposit = args.dir_deposit;
  if (args.attachments && inner.attachments === undefined) inner.attachments = args.attachments;
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

var bc = new BroadcastChannel('cindy-gitlab');
var seenTestReqs = {};
var SETTINGS_MESSAGES = {
  en: { failed: 'GitLab connection test failed: ', success: 'Connected: @' },
  'zh-CN': { failed: 'GitLab 连接测试失败：', success: '连接成功：@' },
  ja: { failed: 'GitLab 接続テストに失敗しました：', success: '接続しました：@' },
  ko: { failed: 'GitLab 연결 테스트 실패: ', success: '연결됨: @' },
};

function settingsMessage(locale, key) {
  var messages = SETTINGS_MESSAGES[locale] || SETTINGS_MESSAGES.en;
  return messages[key];
}

bc.onmessage = function (ev) {
  var m = ev && ev.data;
  if (!m || m.type !== 'test-connection' || !m.reqId) return;
  if (seenTestReqs[m.reqId]) return;
  // 去重表只为吸收 settings 页的重发风暴,超量直接清零重来(常驻期不泄漏)。
  if (Object.keys(seenTestReqs).length > 200) seenTestReqs = {};
  seenTestReqs[m.reqId] = 1;
  void (async function () {
    // 按 connectionId 找连接(settings 页每行的「测试」带 id;缺省走默认连接)。
    var inst = await resolveInstance(m.connectionId ? { instance: m.connectionId } : {});
    if (inst.err) {
      bc.postMessage({ type: 'test-connection-result', reqId: m.reqId, ok: false, message: inst.err });
      void cindy.send({
        type: 'notify',
        text: settingsMessage(m.locale, 'failed') + String(inst.err).slice(0, 150),
        tone: 'error',
      });
      return;
    }
    var r = await api({ url: 'https://' + inst.host + '/api/v4/user' });
    if (r.err) {
      bc.postMessage({ type: 'test-connection-result', reqId: m.reqId, ok: false, message: r.err });
      // 结果同时走系统提示(notify 槽,主机画壳带身份头):失败也报,tone 区分。
      // 限速 5 秒内的重复点击会被主机拒(ok:false),页面内 status 仍在,不补救。
      void cindy.send({
        type: 'notify',
        text: settingsMessage(m.locale, 'failed') + String(r.err).slice(0, 150),
        tone: 'error',
      });
      return;
    }
    var username = (r.data && r.data.username) || '';
    try {
      // 按连接 id 缓存测试成功的用户名,供设置页每行展示 @username。
      var kv = await (await fetch('/kv')).json();
      kv = kv && typeof kv === 'object' ? kv : {};
      var users = kv.connectedUsers && typeof kv.connectedUsers === 'object' ? kv.connectedUsers : {};
      users[inst.id] = username;
      kv.connectedUsers = users;
      await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
    } catch (e) {
      /* 缓存写失败不影响测试结果 */
    }
    bc.postMessage({
      type: 'test-connection-result', reqId: m.reqId, ok: true,
      username: username, name: (r.data && r.data.name) || '', host: inst.host,
    });
    void cindy.send({
      type: 'notify',
      text: settingsMessage(m.locale, 'success') + username + ' (' + inst.host + ')',
      tone: 'success',
    });
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
      message: 'GitLab 工具执行失败:' + (err && err.message ? err.message : String(err)),
    });
  }
});
