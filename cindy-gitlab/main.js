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
    return { err: classifyStatus(r.status, snippet), status: r.status };
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

var LOCALE_FALLBACK = 'en';
/* null = 尚未从宿主拿到语言;此时按英文回退,下次调用再取。 */
var hostLocale = null;
var localeRequest = null;

function normalizeLocale(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, value) ? value : LOCALE_FALLBACK;
}

function currentLocale() {
  return hostLocale || LOCALE_FALLBACK;
}

async function requestHostLocale() {
  if (typeof cindy.request !== 'function') return null;
  var timer = null;
  try {
    // 宿主不回应时不能卡住工具调用:3 秒取不到就按英文,下次调用再试。
    var r = await Promise.race([
      cindy.request({ kind: 'app-context' }),
      new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, 3000); }),
    ]);
    var locale = r && r.ok && r.context && r.context.locale;
    return typeof locale === 'string' ? normalizeLocale(locale) : null;
  } catch (e) {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/* 并发的 tool-call 共享同一个请求;成功后缓存,之后靠 host-context-changed 更新。 */
function ensureLocale() {
  if (hostLocale) return Promise.resolve(hostLocale);
  if (!localeRequest) {
    localeRequest = requestHostLocale().then(function (locale) {
      localeRequest = null;
      // 请求途中若已收到 host-context-changed,以事件里的新语言为准。
      if (!hostLocale && locale) hostLocale = locale;
      return currentLocale();
    });
  }
  return localeRequest;
}

var MESSAGES = {
  "zh-CN": {
    "status404": "对象不存在或无访问权(HTTP 404)",
    "prAskTitle": "要发 MR 吗？",
    "prCommitOne": "1 个提交",
    "prCommitMany": "{count} 个提交",
    "prFileOne": "1 个文件",
    "prFileMany": "{count} 个文件",
    "prPublish": "发 MR",
    "prPublishDraft": "发成草稿",
    "prPublishingTitle": "正在发 MR",
    "prPublishingDraftTitle": "正在发草稿 MR",
    "prPublishingMeta": "完成后会在这里显示 MR",
    "prQueuedMeta": "已排队，当前回复结束后开始",
    "prStateOpen": "已发布",
    "prStateDraft": "草稿",
    "prFollowPaused": "跟进已暂停",
    "prStateFollowing": "跟进中",
    "prStateMerged": "已合并",
    "prStateClosed": "已关闭",
    "prFollowEnded": "跟进已结束",
    "prFollow": "自动跟进到合并",
    "prFollowStarting": "正在开启跟进",
    "prMarkReady": "转为正式 MR",
    "prMerge": "合并",
    "prMergeConfirm": "确认合并",
    "prMergeCancel": "取消",
    "prMergePrompt": "将提交 {sha} 合并到 {base}？",
    "prMergeMethod_squash": "压缩合并",
    "prMergeChanged": "未发送合并请求：提交、目标分支、账号或可合并状态已变化，或现在无法核实。",
    "prMergeRejected": "平台拒绝了合并，本次未合并。请在原站查看状态。",
    "prMergeUnknown": "无法确认上次合并结果，请核对状态。不会自动重试。",
    "prMergeRecheck": "核对状态",
    "prMarkingReady": "正在转为正式 MR",
    "prScheduleFailed": "未能确认后台跟进状态（{detail}）",
    "prReadyFailed": "没能转为正式 MR：{detail}",
    "prReadyUnknown": "不确定是否已转为正式 MR，请先到 GitLab 核对，不要重复点",
    "prSaveFailed": "卡片状态没能保存，请稍后重试",
    "prSettingsLater": "卡片设置暂时读不到，改名和跟进的待办留到下次调用 mr_card 时再给",
    "prSettingsReadFailed": "无法读取 MR 跟进设置，请稍后重试；当前不能判断自动跟进是否开启。",
    "prSettingsUnreadable": "卡片设置暂时读不到，没有发出。请稍后再点一次",
    "prOwnershipUnknown": "无法确认 MR 卡片所属任务，请先回原任务刷新已有卡片，不要新建自动跟进。",
    "prOtherTask": "已展示只读 MR 状态卡片。跳转入口已在卡片内，不要在回复中重复显示 task_url；不要改名、操作原卡片或在当前任务启动自动跟进。",
    "prReadOnly": "其他任务正在跟进",
    "prOtherStarting": "其他任务正在开启跟进",
    "prOtherStopping": "其他任务正在停止跟进",
    "prOpenTask": "打开跟进任务",
    "prCardNotDelivered": "卡片没能显示到对话里，请用同一个 card_id 再调用一次 mr_card",
    "prCardNotShown": "卡片没能显示（例如 IM 渠道），状态已保存；跟进申请、开启和停止的报告仍然有效",
    "prThreadsTruncated": "评审线程太多，未能读完，无法确认未解决数量",
    "prHandedOffSaveFailed": "已交给 Agent，但卡片状态没能保存。请先看对话，不要重复点",
    "prStop": "停止",
    "prStopping": "正在停止跟进",
    "prSettings": "MR 设置",
    "prCopyLink": "复制链接",
    "prHideSettings": "收起 MR 设置",
    "prAutoRename": "发完自动改名",
    "prAutoRenameHint": "任务标题改成 !编号 简短主题",
    "prAutoFollow": "发完自动跟进",
    "prAutoFollowHint": "后台修 CI 和 review 意见，需要你时再通知",
    "prAutoArchive": "合并后自动归档",
    "prAutoArchiveHint": "你看过已合并的卡片、离开这个任务后归档；有未提交的改动时保留",
    "prArchiveTask": "归档任务",
    "prTurnOn": "开启「{name}」",
    "prFollowModel": "自动跟进用的模型",
    "prFollowModelTask": "跟随当前任务",
    "prFollowModelTaskHint": "每次跟进用这个任务当时的模型",
    "prFollowModelCustom": "指定模型",
    "prChoiceCurrent": "{name}（当前）",
    "prFollowModelChangeTo": "更换模型（当前：{name}）",
    "prEffortMinimal": "最低",
    "prEffortLow": "低",
    "prEffortMedium": "中",
    "prEffortHigh": "高",
    "prEffortXhigh": "超高",
    "prEffortMax": "最高",
    "prFastMode": "快速",
    "prUltrafastMode": "超快",
    "prFollowModelFailed": "没能打开模型选择：{detail}",
    "prFollowModelFallback": "当前宿主不支持为绑定任务指定该插件引擎，本次跟进已沿用当前任务模型",
    "prTurnOff": "关闭「{name}」",
    "prCiPassed": "CI 通过",
    "prCiFailed": "CI 未通过",
    "prCiRunning": "CI 运行中",
    "prThreadsOpen": "{count} 条意见待处理",
    "prThreadsNone": "没有待处理意见",
    "prMergeReady": "可以合并",
    "prMergeConflict": "有冲突",
    "prMergeBehind": "需要同步 {base}",
    "prMergeApproval": "等待审批",
    "prMergeChanges": "需要修改",
    "prMergeWaiting": "等待合并",
    "prHandoffFailed": "没能交给 Agent，请直接在对话里告诉它",
    "prHandoffUnknown": "不确定是否已交给 Agent，请先看对话，不要重复点",
    "prSettingFailed": "设置没有保存，请稍后再试",
    "prNeedRepo": "需要 project_path(group/project 形式)",
    "prNeedHead": "询问卡片需要 head(改动所在的分支)",
    "prBadPr": "mr 需要是 GitLab MR 链接或编号",
    "prBadCardId": "card_id 无效",
    "prCardNotFound": "找不到 card_id 对应的卡片，已新建一张",
    "prMovedBelow": "最新状态在下方",
    "prFetchFailed": "读取 MR 信息失败({detail})，卡片按已知信息显示",
    "prNextAsk": "卡片已显示。等用户点击或在对话里明确说要发，不要再用文字重复询问；点击会以本插件代发的消息送达。创建 MR 后用 card_id 和 mr 再调用 mr_card，renamed / following 只填已经完成的动作。",
    "prNextApply": "卡片设置要求发完后做 todo 里的事。做完还没做的，再用 card_id 调用 mr_card，带上 renamed / following。",
    "prNextUpdated": "卡片已更新。",
    "prTodoRename": "根据「{title}」提炼简短主题，用 cindy_helper 的 set_current_session_title 把当前任务改名为「!编号 简短主题」；保留编号和核心含义，去掉 MR、跟进等流程前缀及冗余描述，不照搬完整 MR 标题",
    "prTodoFollow": "按 mr 技能开始后台跟进 {url}",
    "prClickPublish": "用户在 MR 卡片上点了「发 MR」。按 mr 技能现在提交、推送并创建这个 MR；创建后按事件里的 settings 处理改名和跟进，再用 card_id 调用 mr_card 更新卡片。",
    "prClickPublishDraft": "用户在 MR 卡片上点了「发成草稿」。按 mr 技能现在提交、推送并创建 draft MR；创建后按事件里的 settings 处理改名，再用 card_id 调用 mr_card 更新卡片。",
    "prClickFollow": "用户在 MR 卡片上点了「自动跟进到合并」。按 mr 技能开始后台跟进 {url}，再用 card_id 调用 mr_card，following=true。",
    "prReadyFollow": "用户在 MR 卡片上把草稿转成了正式 MR，卡片设置是发完自动跟进。按 mr 技能开始后台跟进 {url}，再用 card_id 调用 mr_card，following=true。",
    "prClickOpenTask": "用户点击了旧版卡片的任务入口。请仅在当前回复中显示一个 Markdown 链接：[打开跟进任务]({url})。这是导航请求，不要启动、停止或转移跟进，不要改名、修改卡片或创建定时任务。",
    "prClickStop": "用户在 MR 卡片上点了「停止」跟进。删除 {url} 的跟进定时任务，再用 card_id 调用 mr_card，following=false。"
  },
  "en": {
    "status404": "Not found or no access (HTTP 404)",
    "prAskTitle": "Open a merge request?",
    "prCommitOne": "1 commit",
    "prCommitMany": "{count} commits",
    "prFileOne": "1 file",
    "prFileMany": "{count} files",
    "prPublish": "Open MR",
    "prPublishDraft": "Open as draft",
    "prPublishingTitle": "Opening the merge request",
    "prPublishingDraftTitle": "Opening a draft merge request",
    "prPublishingMeta": "The merge request will appear here when it is ready.",
    "prQueuedMeta": "Queued. It starts after the current reply.",
    "prStateOpen": "Open",
    "prStateDraft": "Draft",
    "prFollowPaused": "Follow-up paused",
    "prStateFollowing": "Following",
    "prStateMerged": "Merged",
    "prStateClosed": "Closed",
    "prFollowEnded": "Following ended",
    "prFollow": "Auto-follow until merged",
    "prFollowStarting": "Starting to follow",
    "prMarkReady": "Mark ready for review",
    "prMerge": "Merge",
    "prMergeConfirm": "Confirm merge",
    "prMergeCancel": "Cancel",
    "prMergePrompt": "Merge commit {sha} into {base}?",
    "prMergeMethod_squash": "Squash and merge",
    "prMergeChanged": "Merge not sent: the commit, target branch, account or eligibility changed or could not be verified.",
    "prMergeRejected": "The platform rejected the merge. Check the status on the original site.",
    "prMergeUnknown": "Could not confirm the merge result. Check the status. No automatic retry.",
    "prMergeRecheck": "Check status",
    "prMarkingReady": "Marking ready for review",
    "prScheduleFailed": "Could not verify background follow-up ({detail})",
    "prReadyFailed": "Could not mark it ready for review: {detail}",
    "prReadyUnknown": "Not sure the MR was marked ready. Check it on GitLab before clicking again.",
    "prSaveFailed": "Could not save the card state. Try again in a moment.",
    "prSettingsLater": "The card settings could not be read, so the rename and follow to-do list will come with the next mr_card call.",
    "prSettingsReadFailed": "Could not read MR follow-up settings. Try again later; whether auto-follow is enabled is currently unknown.",
    "prSettingsUnreadable": "The card settings could not be read, so nothing was sent. Try again in a moment.",
    "prOwnershipUnknown": "Cannot verify the MR card task. Refresh the existing card in its original task before starting any follow-up.",
    "prOtherTask": "A read-only MR status card is shown. The card contains the task link; do not repeat task_url in your reply; do not rename, operate the original card, or start following here.",
    "prReadOnly": "Following in another task",
    "prOtherStarting": "Starting follow-up in another task",
    "prOtherStopping": "Stopping follow-up in another task",
    "prOpenTask": "Open follow-up task",
    "prCardNotDelivered": "The card could not be shown in the conversation. Call mr_card again with the same card_id.",
    "prCardNotShown": "The card could not be shown (for example in an IM channel); the state is saved, so follow claims and start/stop reports still count.",
    "prThreadsTruncated": "Too many review threads to read them all, so the unresolved count is unknown",
    "prHandedOffSaveFailed": "Handed to the agent, but the card state could not be saved. Check the conversation and do not click again.",
    "prStop": "Stop",
    "prStopping": "Stopping",
    "prSettings": "MR settings",
    "prCopyLink": "Copy link",
    "prHideSettings": "Hide MR settings",
    "prAutoRename": "Rename after opening",
    "prAutoRenameHint": "Retitle the task as !number short topic",
    "prAutoFollow": "Follow after opening",
    "prAutoFollowHint": "Fix CI and review feedback in the background and notify you only when needed",
    "prAutoArchive": "Archive after merge",
    "prAutoArchiveHint": "Archive the task after you have seen it merged and moved on; kept while anything is uncommitted",
    "prArchiveTask": "Archive task",
    "prTurnOn": "Turn on \"{name}\"",
    "prFollowModel": "Model for auto-follow",
    "prFollowModelTask": "Follow this task",
    "prFollowModelTaskHint": "Each round uses the model this task has at the time",
    "prFollowModelCustom": "Choose a model",
    "prChoiceCurrent": "{name} (current)",
    "prFollowModelChangeTo": "Change model (now {name})",
    "prEffortMinimal": "Minimal",
    "prEffortLow": "Low",
    "prEffortMedium": "Medium",
    "prEffortHigh": "High",
    "prEffortXhigh": "Extra high",
    "prEffortMax": "Max",
    "prFastMode": "Fast",
    "prUltrafastMode": "Ultra fast",
    "prFollowModelFailed": "Could not open the model picker: {detail}",
    "prFollowModelFallback": "This host does not support an explicit plugin-engine override on a bound task; follow-up started with this task's current model",
    "prTurnOff": "Turn off \"{name}\"",
    "prCiPassed": "CI passed",
    "prCiFailed": "CI failed",
    "prCiRunning": "CI running",
    "prThreadsOpen": "Open review threads: {count}",
    "prThreadsNone": "No open review threads",
    "prMergeReady": "Ready to merge",
    "prMergeConflict": "Has conflicts",
    "prMergeBehind": "Behind {base}",
    "prMergeApproval": "Waiting for approval",
    "prMergeChanges": "Changes requested",
    "prMergeWaiting": "Waiting to merge",
    "prHandoffFailed": "Could not hand this to the agent. Tell it in the conversation instead.",
    "prHandoffUnknown": "Not sure the agent received this. Check the conversation before clicking again.",
    "prSettingFailed": "The setting was not saved. Try again later.",
    "prNeedRepo": "project_path is required (group/project)",
    "prNeedHead": "An ask card needs head (the branch with the changes)",
    "prBadPr": "mr must be a GitLab merge request URL or number",
    "prBadCardId": "Invalid card_id",
    "prCardNotFound": "No card matches card_id, so a new one was created",
    "prMovedBelow": "Latest status is below",
    "prFetchFailed": "Could not read the merge request ({detail}); the card shows what is known",
    "prNextAsk": "The card is shown. Wait for the user to click or explicitly ask to open it, and do not ask again in text; clicks arrive as messages sent by this plugin. After creating the MR, call mr_card again with card_id and mr; set renamed / following only for actions already done.",
    "prNextApply": "The card settings ask for the todo items after opening. Do any not done yet, then call mr_card with card_id, renamed and following.",
    "prNextUpdated": "Card updated.",
    "prTodoRename": "Condense \"{title}\" into \"!number short topic\" and rename the current task with cindy_helper set_current_session_title; preserve the number and core meaning, omit workflow prefixes such as MR or Follow and redundant wording, and do not copy the full MR title",
    "prTodoFollow": "Start following {url} in the background with the mr workflow",
    "prClickPublish": "The user clicked \"Open MR\" on the MR card. Commit, push and open this merge request now with the mr workflow; afterwards handle renaming and following as the event settings say, then call mr_card with card_id to update the card.",
    "prClickPublishDraft": "The user clicked \"Open as draft\" on the MR card. Commit, push and open a draft merge request now with the mr workflow; afterwards handle renaming as the event settings say, then call mr_card with card_id to update the card.",
    "prClickFollow": "The user clicked \"Auto-follow until merged\" on the MR card. Start following {url} in the background with the mr workflow, then call mr_card with card_id and following=true.",
    "prReadyFollow": "The user marked the draft ready for review on the MR card, and the card setting says to follow it automatically. Start following {url} in the background with the mr workflow, then call mr_card with card_id and following=true.",
    "prClickOpenTask": "The user clicked the legacy task entry. Reply only with one Markdown link: [Open follow-up task]({url}). This is navigation only: do not start, stop or transfer following, rename tasks, modify cards, or create schedules.",
    "prClickStop": "The user clicked \"Stop\" following on the MR card. Delete the follow-up schedule for {url}, then call mr_card with card_id and following=false."
  },
  "ja": {
    "status404": "対象が存在しないか、アクセス権がありません(HTTP 404)",
    "prAskTitle": "MR を作成しますか？",
    "prCommitOne": "1 件のコミット",
    "prCommitMany": "{count} 件のコミット",
    "prFileOne": "1 個のファイル",
    "prFileMany": "{count} 個のファイル",
    "prPublish": "MR を作成",
    "prPublishDraft": "下書きで作成",
    "prPublishingTitle": "MR を作成しています",
    "prPublishingDraftTitle": "下書き MR を作成しています",
    "prPublishingMeta": "作成が完了すると、ここに MR が表示されます",
    "prQueuedMeta": "キューに追加しました。現在の返信が終わると始まります",
    "prStateOpen": "公開済み",
    "prStateDraft": "下書き",
    "prFollowPaused": "フォローを一時停止中",
    "prStateFollowing": "フォロー中",
    "prStateMerged": "マージ済み",
    "prStateClosed": "クローズ済み",
    "prFollowEnded": "フォロー終了",
    "prFollow": "マージまで自動フォロー",
    "prFollowStarting": "フォローを開始しています",
    "prMarkReady": "正式な MR にする",
    "prMerge": "マージ",
    "prMergeConfirm": "マージを確認",
    "prMergeCancel": "キャンセル",
    "prMergePrompt": "コミット {sha} を {base} にマージしますか？",
    "prMergeMethod_squash": "スカッシュしてマージ",
    "prMergeChanged": "コミット、対象ブランチ、アカウントまたはマージ可否が変わったか確認できないため、マージを要求しませんでした。",
    "prMergeRejected": "プラットフォームがマージを拒否しました。元のサイトで状態を確認してください。",
    "prMergeUnknown": "マージ結果を確認できません。状態を確認してください。自動再試行は行いません。",
    "prMergeRecheck": "状態を確認",
    "prMarkingReady": "正式な MR に切り替えています",
    "prScheduleFailed": "バックグラウンドフォローを確認できませんでした（{detail}）",
    "prReadyFailed": "正式な MR にできませんでした：{detail}",
    "prReadyUnknown": "MR が正式になったか分かりません。もう一度押す前に GitLab で確認してください",
    "prSaveFailed": "カードの状態を保存できませんでした。しばらくしてからもう一度お試しください",
    "prSettingsLater": "カードの設定を読み込めなかったため、改名とフォローの作業は次回の mr_card 呼び出しでお知らせします",
    "prSettingsReadFailed": "MR のフォロー設定を読み取れません。後で再試行してください。自動フォローが有効かどうかは現在不明です。",
    "prSettingsUnreadable": "カードの設定を読み込めなかったため、何も送信していません。しばらくしてからもう一度お試しください",
    "prOwnershipUnknown": "MR カードの所属タスクを確認できません。元のタスクで既存カードを更新してからフォローしてください。",
    "prOtherTask": "読み取り専用の MR 状態カードを表示しました。タスクへのリンクはカード内にあるため返信で task_url を繰り返さず、改名・元のカードの操作・ここでのフォローは行わないでください。",
    "prReadOnly": "別のタスクでフォロー中",
    "prOtherStarting": "別のタスクでフォロー開始中",
    "prOtherStopping": "別のタスクでフォロー停止中",
    "prOpenTask": "フォロー中のタスクを開く",
    "prCardNotDelivered": "カードを会話に表示できませんでした。同じ card_id でもう一度 mr_card を呼んでください",
    "prCardNotShown": "カードを表示できませんでした（IM チャンネルなど）。状態は保存済みで、フォローの申請と開始・停止の報告は有効です",
    "prThreadsTruncated": "レビュースレッドが多すぎて読み切れず、未解決の数を確認できません",
    "prHandedOffSaveFailed": "エージェントに渡しましたが、カードの状態を保存できませんでした。会話を確認し、もう一度押さないでください",
    "prStop": "フォロー停止",
    "prStopping": "フォローを停止しています",
    "prSettings": "MR 設定",
    "prCopyLink": "リンクをコピー",
    "prHideSettings": "MR 設定を閉じる",
    "prAutoRename": "作成後に自動で改名",
    "prAutoRenameHint": "タスク名を「!番号 短いテーマ」に変更します",
    "prAutoFollow": "作成後に自動でフォロー",
    "prAutoFollowHint": "バックグラウンドで CI とレビュー指摘を直し、必要なときだけ通知します",
    "prAutoArchive": "マージ後に自動でアーカイブ",
    "prAutoArchiveHint": "マージ済みのカードを見てこのタスクを離れたらアーカイブします。未コミットの変更があるときは残します",
    "prArchiveTask": "タスクをアーカイブ",
    "prTurnOn": "「{name}」をオン",
    "prFollowModel": "自動フォローに使うモデル",
    "prFollowModelTask": "タスクに合わせる",
    "prFollowModelTaskHint": "毎回、その時点のこのタスクのモデルを使います",
    "prFollowModelCustom": "モデルを指定",
    "prChoiceCurrent": "{name}（現在）",
    "prFollowModelChangeTo": "モデルを変更（現在：{name}）",
    "prEffortMinimal": "最小",
    "prEffortLow": "低",
    "prEffortMedium": "中",
    "prEffortHigh": "高",
    "prEffortXhigh": "超高",
    "prEffortMax": "最高",
    "prFastMode": "高速",
    "prUltrafastMode": "超高速",
    "prFollowModelFailed": "モデルの選択を開けませんでした：{detail}",
    "prFollowModelFallback": "このホストは紐付け済みタスクへのプラグインエンジン指定に対応していないため、現在のタスクのモデルでフォローを開始しました",
    "prTurnOff": "「{name}」をオフ",
    "prCiPassed": "CI 成功",
    "prCiFailed": "CI 失敗",
    "prCiRunning": "CI 実行中",
    "prThreadsOpen": "未解決のレビュー {count} 件",
    "prThreadsNone": "未解決のレビューなし",
    "prMergeReady": "マージ可能",
    "prMergeConflict": "コンフリクトあり",
    "prMergeBehind": "{base} との同期が必要",
    "prMergeApproval": "承認待ち",
    "prMergeChanges": "修正依頼あり",
    "prMergeWaiting": "マージ待ち",
    "prHandoffFailed": "エージェントに渡せませんでした。会話で直接伝えてください",
    "prHandoffUnknown": "エージェントに届いたか分かりません。もう一度押す前に会話を確認してください",
    "prSettingFailed": "設定を保存できませんでした。しばらくしてから再試行してください",
    "prNeedRepo": "project_path(group/project 形式)が必要です",
    "prNeedHead": "確認カードには head(変更のあるブランチ)が必要です",
    "prBadPr": "mr には GitLab の MR URL か番号を指定してください",
    "prBadCardId": "card_id が無効です",
    "prCardNotFound": "card_id に対応するカードがないため、新しく作成しました",
    "prMovedBelow": "最新の状態は下にあります",
    "prFetchFailed": "MR 情報を取得できませんでした({detail})。分かっている情報でカードを表示します",
    "prNextAsk": "カードを表示しました。ユーザーのクリックか会話での明確な依頼を待ち、テキストで重ねて確認しないでください。クリックはこのプラグインが送るメッセージとして届きます。MR を作成したら card_id と mr を付けて mr_card を再度呼び、renamed / following には完了済みの操作だけを指定してください。",
    "prNextApply": "カード設定により、作成後に todo の操作が必要です。未完了のものを済ませてから、card_id・renamed・following を付けて mr_card を呼んでください。",
    "prNextUpdated": "カードを更新しました。",
    "prTodoRename": "「{title}」から短いテーマをまとめ、cindy_helper の set_current_session_title で現在のタスク名を「!番号 短いテーマ」に変更する。番号と核心を保ち、MR・フォローなどの手順の接頭辞や冗長な説明を省き、MR タイトル全体をそのまま使わない",
    "prTodoFollow": "MR ワークフローで {url} のバックグラウンドフォローを開始する",
    "prClickPublish": "ユーザーが MR カードの「MR を作成」を押しました。MR ワークフローに従って今すぐコミット・プッシュし、この MR をレビュー可能な状態で作成してください。作成後はイベントの settings に従って改名とフォローを処理し、card_id を付けて mr_card でカードを更新してください。",
    "prClickPublishDraft": "ユーザーが MR カードの「下書きで作成」を押しました。MR ワークフローに従って今すぐコミット・プッシュし、下書き MR を作成してください。作成後はイベントの settings に従って改名を処理し、card_id を付けて mr_card でカードを更新してください。",
    "prClickFollow": "ユーザーが MR カードの「マージまで自動フォロー」を押しました。MR ワークフローで {url} のバックグラウンドフォローを開始し、card_id と following=true を付けて mr_card を呼んでください。",
    "prReadyFollow": "ユーザーが MR カードで下書きを正式な MR にしました。カードの設定は作成後に自動フォローです。MR ワークフローで {url} のバックグラウンドフォローを開始し、card_id と following=true を付けて mr_card を呼んでください。",
    "prClickOpenTask": "旧版カードのタスク入口が押されました。返信には Markdown リンク [フォロー中のタスクを開く]({url}) を1つだけ表示してください。移動のみの要求です。フォローの開始・停止・移管、名前やカードの変更、スケジュールの作成はしないでください。",
    "prClickStop": "ユーザーが MR カードの「フォロー停止」を押しました。{url} のフォロー用スケジュールを削除し、card_id と following=false を付けて mr_card を呼んでください。"
  },
  "ko": {
    "status404": "대상이 없거나 접근 권한이 없습니다(HTTP 404)",
    "prAskTitle": "MR을 만들까요?",
    "prCommitOne": "커밋 1개",
    "prCommitMany": "커밋 {count}개",
    "prFileOne": "파일 1개",
    "prFileMany": "파일 {count}개",
    "prPublish": "MR 만들기",
    "prPublishDraft": "초안으로 만들기",
    "prPublishingTitle": "MR을 만드는 중",
    "prPublishingDraftTitle": "초안 MR을 만드는 중",
    "prPublishingMeta": "생성이 완료되면 여기에 MR이 표시됩니다",
    "prQueuedMeta": "대기열에 추가했습니다. 현재 응답이 끝나면 시작합니다",
    "prStateOpen": "게시됨",
    "prStateDraft": "초안",
    "prFollowPaused": "팔로우 일시 중지됨",
    "prStateFollowing": "팔로우 중",
    "prStateMerged": "병합됨",
    "prStateClosed": "닫힘",
    "prFollowEnded": "팔로우 종료됨",
    "prFollow": "병합까지 자동 팔로우",
    "prFollowStarting": "팔로우 시작 중",
    "prMarkReady": "정식 MR로 전환",
    "prMerge": "병합",
    "prMergeConfirm": "병합 확인",
    "prMergeCancel": "취소",
    "prMergePrompt": "커밋 {sha}을(를) {base}에 병합할까요?",
    "prMergeMethod_squash": "스쿼시 후 병합",
    "prMergeChanged": "커밋, 대상 브랜치, 계정 또는 병합 가능 여부가 변경되었거나 확인되지 않아 병합을 요청하지 않았습니다.",
    "prMergeRejected": "플랫폼에서 병합을 거부했습니다. 원본 사이트에서 상태를 확인하세요.",
    "prMergeUnknown": "병합 결과를 확인할 수 없습니다. 상태를 확인하세요. 자동으로 재시도하지 않습니다.",
    "prMergeRecheck": "상태 확인",
    "prMarkingReady": "정식 MR로 전환 중",
    "prScheduleFailed": "백그라운드 팔로우를 확인하지 못했습니다 ({detail})",
    "prReadyFailed": "정식 MR로 전환하지 못했습니다: {detail}",
    "prReadyUnknown": "정식 MR로 전환됐는지 확실하지 않습니다. 다시 누르기 전에 GitLab에서 확인하세요",
    "prSaveFailed": "카드 상태를 저장하지 못했습니다. 잠시 후 다시 시도하세요",
    "prSettingsLater": "카드 설정을 읽지 못해 이름 변경과 팔로우 할 일은 다음 mr_card 호출 때 알려 드립니다",
    "prSettingsReadFailed": "MR 팔로우 설정을 읽을 수 없습니다. 나중에 다시 시도하세요. 자동 팔로우 활성화 여부는 현재 알 수 없습니다.",
    "prSettingsUnreadable": "카드 설정을 읽지 못해 아무것도 보내지 않았습니다. 잠시 후 다시 시도하세요",
    "prOwnershipUnknown": "MR 카드의 작업을 확인할 수 없습니다. 팔로우를 시작하기 전에 원래 작업에서 기존 카드를 새로 고치세요.",
    "prOtherTask": "읽기 전용 MR 상태 카드가 표시되었습니다. 작업 링크는 카드 안에 있으므로 답변에 task_url을 반복하지 마세요. 이름 변경, 원래 카드 조작 또는 여기서 팔로우를 시작하지 마세요.",
    "prReadOnly": "다른 작업에서 팔로우 중",
    "prOtherStarting": "다른 작업에서 팔로우 시작 중",
    "prOtherStopping": "다른 작업에서 팔로우 중지 중",
    "prOpenTask": "팔로우 작업 열기",
    "prCardNotDelivered": "카드를 대화에 표시하지 못했습니다. 같은 card_id로 mr_card를 다시 호출하세요",
    "prCardNotShown": "카드를 표시하지 못했습니다(예: IM 채널). 상태는 저장되었으며 팔로우 신청과 시작·중지 보고는 유효합니다",
    "prThreadsTruncated": "리뷰 스레드가 너무 많아 모두 읽지 못했고 미해결 수를 확인할 수 없습니다",
    "prHandedOffSaveFailed": "에이전트에게 전달했지만 카드 상태를 저장하지 못했습니다. 대화를 확인하고 다시 누르지 마세요",
    "prStop": "중지",
    "prStopping": "팔로우 중지 중",
    "prSettings": "MR 설정",
    "prCopyLink": "링크 복사",
    "prHideSettings": "MR 설정 닫기",
    "prAutoRename": "만든 뒤 자동으로 이름 변경",
    "prAutoRenameHint": "작업 제목을 !번호 짧은 주제로 바꿉니다",
    "prAutoFollow": "만든 뒤 자동으로 팔로우",
    "prAutoFollowHint": "백그라운드에서 CI와 리뷰 의견을 고치고 필요할 때만 알립니다",
    "prAutoArchive": "병합 후 자동 보관",
    "prAutoArchiveHint": "병합된 카드를 보고 이 작업을 떠나면 보관합니다. 커밋하지 않은 변경이 있으면 남겨 둡니다",
    "prArchiveTask": "작업 보관",
    "prTurnOn": "\"{name}\" 켜기",
    "prFollowModel": "자동 팔로우에 쓸 모델",
    "prFollowModelTask": "현재 작업 따르기",
    "prFollowModelTaskHint": "매번 그 시점의 이 작업 모델을 사용합니다",
    "prFollowModelCustom": "모델 지정",
    "prChoiceCurrent": "{name} (현재)",
    "prFollowModelChangeTo": "모델 변경 (현재: {name})",
    "prEffortMinimal": "최소",
    "prEffortLow": "낮음",
    "prEffortMedium": "중간",
    "prEffortHigh": "높음",
    "prEffortXhigh": "매우 높음",
    "prEffortMax": "최대",
    "prFastMode": "빠름",
    "prUltrafastMode": "초고속",
    "prFollowModelFailed": "모델 선택을 열지 못했습니다: {detail}",
    "prFollowModelFallback": "이 호스트는 연결된 작업에 플러그인 엔진 지정을 지원하지 않아 현재 작업의 모델로 팔로우를 시작했습니다",
    "prTurnOff": "\"{name}\" 끄기",
    "prCiPassed": "CI 통과",
    "prCiFailed": "CI 실패",
    "prCiRunning": "CI 실행 중",
    "prThreadsOpen": "처리할 리뷰 의견 {count}개",
    "prThreadsNone": "처리할 리뷰 의견 없음",
    "prMergeReady": "병합 가능",
    "prMergeConflict": "충돌 있음",
    "prMergeBehind": "{base} 동기화 필요",
    "prMergeApproval": "승인 대기 중",
    "prMergeChanges": "수정 요청됨",
    "prMergeWaiting": "병합 대기 중",
    "prHandoffFailed": "에이전트에게 전달하지 못했습니다. 대화에서 직접 말해 주세요",
    "prHandoffUnknown": "에이전트에게 전달됐는지 확실하지 않습니다. 다시 누르기 전에 대화를 확인하세요",
    "prSettingFailed": "설정을 저장하지 못했습니다. 잠시 후 다시 시도하세요",
    "prNeedRepo": "project_path(group/project 형식)가 필요합니다",
    "prNeedHead": "확인 카드에는 head(변경이 있는 브랜치)가 필요합니다",
    "prBadPr": "mr은 GitLab MR URL이나 번호여야 합니다",
    "prBadCardId": "card_id가 올바르지 않습니다",
    "prCardNotFound": "card_id에 해당하는 카드가 없어 새로 만들었습니다",
    "prMovedBelow": "최신 상태는 아래에 있습니다",
    "prFetchFailed": "MR 정보를 읽지 못했습니다({detail}). 알고 있는 정보로 카드를 표시합니다",
    "prNextAsk": "카드를 표시했습니다. 사용자가 클릭하거나 대화에서 분명히 요청할 때까지 기다리고, 텍스트로 다시 묻지 마세요. 클릭은 이 플러그인이 보낸 메시지로 도착합니다. MR을 만든 뒤 card_id와 mr로 mr_card를 다시 호출하고, renamed / following에는 이미 완료한 작업만 넣으세요.",
    "prNextApply": "카드 설정에 따라 MR을 만든 뒤 todo 항목을 처리해야 합니다. 아직 하지 않은 항목을 마친 뒤 card_id, renamed, following으로 mr_card를 호출하세요.",
    "prNextUpdated": "카드를 업데이트했습니다.",
    "prTodoRename": "\"{title}\"을 \"!번호 짧은 주제\"로 요약하고 cindy_helper의 set_current_session_title로 현재 작업 이름을 변경하세요. 번호와 핵심 의미를 유지하고 MR·팔로우 등의 절차 접두사와 중복 설명은 빼며 전체 MR 제목을 그대로 복사하지 마세요",
    "prTodoFollow": "MR 절차로 {url} 백그라운드 팔로우 시작",
    "prClickPublish": "사용자가 MR 카드에서 \"MR 만들기\"를 눌렀습니다. MR 절차에 따라 지금 커밋·푸시하고 이 MR을 리뷰 가능한 상태로 만드세요. 만든 뒤 이벤트의 settings에 따라 이름 변경과 팔로우를 처리하고, card_id로 mr_card를 호출해 카드를 업데이트하세요.",
    "prClickPublishDraft": "사용자가 MR 카드에서 \"초안으로 만들기\"를 눌렀습니다. MR 절차에 따라 지금 커밋·푸시하고 초안 MR을 만드세요. 만든 뒤 이벤트의 settings에 따라 이름 변경을 처리하고, card_id로 mr_card를 호출해 카드를 업데이트하세요.",
    "prClickFollow": "사용자가 MR 카드에서 \"병합까지 자동 팔로우\"를 눌렀습니다. MR 절차로 {url} 백그라운드 팔로우를 시작하고, card_id와 following=true로 mr_card를 호출하세요.",
    "prReadyFollow": "사용자가 MR 카드에서 초안을 정식 MR로 전환했고, 카드 설정은 만든 뒤 자동 팔로우입니다. MR 절차로 {url} 백그라운드 팔로우를 시작하고, card_id와 following=true로 mr_card를 호출하세요.",
    "prClickOpenTask": "사용자가 이전 버전 카드의 작업 진입점을 눌렀습니다. 답변에 Markdown 링크 [팔로우 작업 열기]({url}) 하나만 표시하세요. 이동 요청일 뿐이므로 팔로우 시작·중지·이전, 이름·카드 변경 또는 일정 생성을 하지 마세요.",
    "prClickStop": "사용자가 MR 카드에서 팔로우 \"중지\"를 눌렀습니다. {url}의 팔로우 일정을 삭제하고, card_id와 following=false로 mr_card를 호출하세요."
  }
};

function t(key, vars) {
  var table = MESSAGES[currentLocale()];
  var text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : MESSAGES[LOCALE_FALLBACK][key];
  return String(text).replace(/\{(\w+)\}/g, function (match, name) {
    return vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match;
  });
}

var PR_CARD_DIR = 'mr-cards';
/** 私有目录最多保留多少张卡片的状态;超出删最旧的(被删的旧卡片点击后不再响应)。 */
var PR_CARD_KEEP = 200;
var PR_CARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
var PR_REPO_RE = /^(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+$/;
var PR_FILES_KEPT = 50;
var PR_TITLE_MAX = 120;
var PR_TRIGGER = '[UI_ACTION_TRIGGER]';

/* 同一张卡片可能同时收到工具调用和按钮点击;全部串行,状态不互相覆盖。 */
var prQueue = Promise.resolve();

function enqueuePr(fn) {
  var run = prQueue.then(fn);
  prQueue = run.catch(function () {});
  return run;
}

function prEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ── 卡片状态(私有数据目录)与设置(/kv) ── */

function prCardPath(id) {
  return PR_CARD_DIR + '/' + id + '.json';
}

async function readPrCard(id, viaAlias) {
  var r = await cindy.send({ type: 'fs-request', root: 'data', op: 'read', path: prCardPath(id) });
  if (!r || !r.ok) return null;
  var card;
  try {
    card = JSON.parse(r.content);
  } catch (e) {
    return null;
  }
  if (!card || card.id !== id) return null;
  // 挪过位置的卡片:新位置的点击带的是别名,只跟一层。
  if (card.alias) return !viaAlias && PR_CARD_ID_RE.test(card.alias) ? readPrCard(card.alias, true) : null;
  return card;
}

/** 卡片现在显示在哪次调用上:挪过位置的是 anchor,否则是 card_id 本身。 */
function prAnchor(card) {
  return card.anchor || card.id;
}

async function savePrCard(card) {
  var r = await cindy.send({
    type: 'fs-request', root: 'data', op: 'write',
    path: prCardPath(card.id), content: JSON.stringify(card),
  });
  return Boolean(r && r.ok);
}

/** The record must stop saying "following is starting" once the handoff clearly failed: try a few times. */
async function savePrCardRetry(card) {
  for (var attempt = 0; attempt < 3; attempt++) {
    if (await savePrCard(card)) return true;
  }
  return false;
}

// Runs inside enqueuePr: reserving a follow-up and saving its card are serialized.
// An idle card never permanently owns a PR; active reservations survive restarts.
function prFollowActive(card) {
  return card.following === true || !!card.scheduleId || card.pending === 'follow' || card.pending === 'stop';
}

async function findPrCardOwner(repo, number, head, explicitId, sessionId, localOnly) {
  var listing = await cindy.send({ type: 'fs-request', root: 'data', op: 'list', path: PR_CARD_DIR });
  if (listing && !listing.ok && listing.errorCode === 'NOT_FOUND') return null;
  if (!listing || !listing.ok || !Array.isArray(listing.entries)) throw new Error(t('prOwnershipUnknown'));
  var candidates = [];
  for (var i = 0; i < listing.entries.length; i++) {
    var path = listing.entries[i].path;
    var match = /^mr-cards\/([A-Za-z0-9_-]{1,64})\.json$/.exec(path);
    if (!match) continue;
    var saved = await cindy.send({ type: 'fs-request', root: 'data', op: 'read', path: path });
    if (!saved || !saved.ok) throw new Error(t('prOwnershipUnknown'));
    var record = JSON.parse(saved.content);
    if (record.alias) continue;
    if (String(record.repo).toLowerCase() !== repo.toLowerCase()) continue;
    if (number ? record.pr && record.pr.number === number : !record.pr && record.head === head) candidates.push(record);
  }
  // Only an active (or starting/stopping) follow-up excludes other tasks.
  // A task's own active record wins, so records duplicated before this rule existed can still be stopped by their own task.
  return (!localOnly && (candidates.find(function (c) { return prFollowActive(c) && c.sessionId === sessionId; }) ||
    candidates.find(prFollowActive))) || candidates.find(function (c) { return c.sessionId === sessionId; }) ||
    candidates.find(function (c) { return !c.sessionId && c.id === explicitId; }) || null;
}

async function prOtherTask(owner, callId, sessionId, localCard, toLatest, stateOp) {
  var local = localCard && localCard.sessionId === sessionId ? localCard : newPrCard(callId, owner.repo);
  var updating = local.id !== callId;
  local.sessionId = sessionId;
  local.pr = owner.pr;
  local.stage = owner.stage;
  local.head = owner.head;
  local.base = owner.base;
  local.settingsApplied = true;
  // Never copy the other task's pending or following state into this task.
  if (local.pr) {
    var status = await fetchPrStatus(local.repo, local.pr.number, callId);
    if (status.err) local.note = t('prFetchFailed', { detail: status.err });
    else { local.pr = status.pr; local.stage = status.pr.state; local.note = null; }
  }
  // The read-only card moves like any other card; its local card_id stays.
  var movedFrom = updating && toLatest && prAnchor(local) !== callId ? await movePrCard(local, callId) : null;
  if (!(await savePrCard(local))) return fail(t('prSaveFailed'));
  if (movedFrom) await sendPrMovedStub(local, movedFrom, callId);
  var shown = await sendPrCard(local, await readPrSettings(), updating && !movedFrom ? callId : null);
  // A claim or stop report still needs the answer when no card can be shown (IM).
  if (!shown && !stateOp) return fail(t('prCardNotDelivered'));
  var other = {
    disposition: 'existing_task', card_id: local.id, owner_card_id: owner.id, owner_session_id: owner.sessionId,
    task_url: 'cindy://session/' + encodeURIComponent(owner.sessionId), follow_claimed: false, todo: [], next: t('prOtherTask'),
  };
  if (!shown) { other.card_shown = false; other.note = t('prCardNotShown'); }
  return { ok: true, result: other };
}

async function prunePrCards() {
  var r = await cindy.send({ type: 'fs-request', root: 'data', op: 'list', path: PR_CARD_DIR });
  if (!r || !r.ok || !Array.isArray(r.entries) || r.entries.length <= PR_CARD_KEEP) return;
  var stale = r.entries
    .slice()
    .sort(function (a, b) { return a.mtime - b.mtime; })
    .slice(0, r.entries.length - PR_CARD_KEEP);
  for (var i = 0; i < stale.length; i++) {
    var saved = await cindy.send({ type: 'fs-request', root: 'data', op: 'read', path: stale[i].path });
    if (!saved || !saved.ok) continue;
    try {
      var record = JSON.parse(saved.content);
      if (prFollowActive(record)) continue;
      // Preserve the visible buttons of an active card. Superseded aliases can age out.
      if (typeof record.alias === 'string' && PR_CARD_ID_RE.test(record.alias)) {
        var savedOwner = await cindy.send({ type: 'fs-request', root: 'data', op: 'read', path: prCardPath(record.alias) });
        if (!savedOwner || (!savedOwner.ok && savedOwner.errorCode !== 'NOT_FOUND')) continue;
        if (savedOwner.ok) {
          var owner = JSON.parse(savedOwner.content);
          if (prFollowActive(owner) && prAnchor(owner) === record.id) continue;
        }
      }
    } catch (e) { continue; }
    await cindy.send({ type: 'fs-request', root: 'data', op: 'delete', path: stale[i].path });
  }
}

/* 读失败时不写:/kv 是整体替换,读不到就写会抹掉别的键。 */
async function readKv(requireObject) {
  var r = await fetch('/kv');
  if (!r || r.ok === false) throw new Error('kv unavailable');
  var kv = await r.json();
  if (kv && typeof kv === 'object' && !Array.isArray(kv)) return kv;
  if (requireObject) throw new Error('invalid kv data');
  return {};
}

// Keep this in sync with the Host scheduler routes accepted by the model picker.
var PR_AGENT_KINDS = { acp: 1, cc: 1, codex: 1, pi: 1 };
var PR_ACP_PROVIDER_PREFIX = 'acp-plugin:';

/**
 * 宿主选择器返回的完整组合(引擎、来源、模型、档位、速度),只认合法形状。卡内下拉框还可能带运行位置
 * agentDeviceId:同账号另一台电脑,或分享来的供应商(share:<id>);没有 = 插件运行的这台电脑。
 */
function prFollowModelFrom(value) {
  var v = value && typeof value === 'object' ? value : null;
  var r = v && v.route && typeof v.route === 'object' ? v.route : null;
  if (!r || !PR_AGENT_KINDS[r.agentKind] || typeof r.providerId !== 'string' || typeof r.model !== 'string' || !r.model ||
      typeof r.effort !== 'string' || !(typeof r.fastMode === 'boolean' || r.fastMode === 'ultrafast')) return null;
  if (r.agentKind === 'acp' && (
    r.providerId.indexOf(PR_ACP_PROVIDER_PREFIX) !== 0 ||
    r.providerId.length <= PR_ACP_PROVIDER_PREFIX.length ||
    r.fastMode !== false
  )) return null;
  var device = typeof r.agentDeviceId === 'string' && r.agentDeviceId && r.agentDeviceId.length <= 128 && r.agentDeviceId !== 'local'
    ? r.agentDeviceId : null;
  if (r.agentDeviceId !== undefined && !device) return null;
  return {
    route: Object.assign({ agentKind: r.agentKind, providerId: r.providerId, model: r.model, effort: r.effort, fastMode: r.fastMode },
      device ? { agentDeviceId: device } : {}),
    label: typeof v.label === 'string' && v.label ? v.label.slice(0, 120) : r.model,
  };
}

function prSettingsFrom(kv) {
  var s = kv && kv.prCard && typeof kv.prCard === 'object' ? kv.prCard : {};
  // lastFollowModel:切回「跟随当前任务」时记住上次指定的模型,再切回「指定模型」直接用它。
  return {
    autoRename: s.autoRename === true, autoFollow: s.autoFollow === true, autoArchive: s.autoArchive === true,
    followModel: prFollowModelFrom(s.followModel), lastFollowModel: prFollowModelFrom(s.lastFollowModel),
  };
}

/** 交给 Agent 的设置:跟进模型按定时任务参数的写法给出,没选就不带(沿用当前任务)。 */
function prSettingsForAgent(settings, autoFollow) {
  var out = { auto_rename: settings.autoRename, auto_follow: autoFollow };
  var m = settings.followModel;
  if (m) {
    out.follow_model = {
      model_agent_kind: m.route.agentKind === 'cc' ? 'claude-code' : m.route.agentKind,
      provider_id: m.route.providerId, model: m.route.model, effort: m.route.effort, fast_mode: m.route.fastMode, label: m.label,
    };
    if (m.route.agentDeviceId) out.follow_model.agent_device_id = m.route.agentDeviceId;
  }
  return out;
}

async function readPrSettings() {
  try {
    return prSettingsFrom(await readKv());
  } catch (e) {
    // Unreadable is not the same as "everything off": callers that hand settings to the agent must not use these.
    return Object.assign(prSettingsFrom(null), { unreadable: true });
  }
}

async function writePrSettings(change) {
  var kv = await readKv();
  var next = prSettingsFrom(kv);
  change(next);
  kv.prCard = { autoRename: next.autoRename, autoFollow: next.autoFollow };
  if (next.autoArchive) kv.prCard.autoArchive = true;
  if (next.followModel) kv.prCard.followModel = next.followModel;
  if (next.lastFollowModel) kv.prCard.lastFollowModel = next.lastFollowModel;
  var r = await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
  if (!r || r.ok === false) throw new Error('kv write failed');
  return next;
}
function togglePrSetting(key) {
  return writePrSettings(function (next) { next[key] = !next[key]; });
}

/** 用宿主统一的模型选择器选跟进模型;名字从同源模型目录取,取不到就显示模型 id。 */
async function pickPrFollowModel(settings, msg) {
  // 通用选择器只认本机组合:带运行位置的旧选择不作为初始值。
  var initial = settings.followModel && !settings.followModel.route.agentDeviceId ? settings.followModel.route : null;
  var picked = await cindy.pickModel(Object.assign(
    initial ? { initial: initial } : {},
    msg.mobilePageId ? { mobilePageId: msg.mobilePageId } : {}
  ));
  if (!picked || picked.ok !== true) {
    return picked && picked.errorCode === 'CANCELLED' ? { settings: settings } : { settings: settings, error: (picked && picked.message) || 'UNAVAILABLE' };
  }
  return savePrFollowModel(settings, picked.route);
}

/** 记下选中的跟进模型(卡内下拉框或选择器选的都走这里)。 */
async function savePrFollowModel(settings, route) {
  var label = '';
  var device = route && typeof route.agentDeviceId === 'string' ? route.agentDeviceId : '';
  try {
    var res = await fetch('/agent-models' + (device ? '?agent_device_id=' + encodeURIComponent(device) : ''));
    var list = res && res.ok !== false ? (await res.json()).models : null;
    var hit = Array.isArray(list) && list.find(function (m) { return m && m.id === route.model && m.providerId === route.providerId; });
    if (hit) label = hit.name + (hit.providerName ? ' · ' + hit.providerName : '');
    if (hit && device) {
      // 写上在哪里运行:电脑名;分享的位置名本身就是「供应商 · 分享者」,替换掉供应商那一段
      var where = await fetch('/agent-models');
      var locations = where && where.ok !== false ? (await where.json()).locations : null;
      var place = Array.isArray(locations) && locations.find(function (l) { return l && l.agentDeviceId === device; });
      if (place && place.name) label = device.indexOf('share:') === 0 ? hit.name + ' · ' + place.name : label + ' · ' + place.name;
    }
  } catch (e) { /* 名字只是展示,取不到用模型 id */ }
  var value = prFollowModelFrom({ route: route, label: label });
  if (!value) return { settings: settings, error: 'INVALID_ROUTE' };
  return { settings: await writePrSettings(function (next) { next.followModel = value; next.lastFollowModel = value; }) };
}

/* ── PR 状态(GitLab REST,按实例取卡片状态) ── */


function parseMrUrl(value) {
  var match = /^https:\/\/([a-z\d][a-z\d.-]*)\/((?:[a-z\d_.-]+\/)+[a-z\d_.-]+)\/-\/merge_requests\/([1-9]\d*)\/?(?:[?#].*)?$/i.exec(String(value));
  if (!match || !Number.isSafeInteger(Number(match[3])) ||
      match[2].split('/').some(function (segment) { return segment === '.' || segment === '..'; })) return null;
  return { repo: match[1].toLowerCase() + '/' + match[2], number: Number(match[3]) };
}

function mrApiArgs(repo, number) {
  var slash = repo.indexOf('/');
  return { instance: repo.slice(0, slash), project_path: repo.slice(slash + 1), iid: number };
}

async function fetchPrMergeTarget(args, mr, callId) {
  if (mr.state !== 'opened' || (mr.draft !== false && mr.work_in_progress !== false) ||
      mr.draft === true || mr.work_in_progress === true || mr.has_conflicts === true ||
      mr.detailed_merge_status !== 'mergeable' || !mr.user || mr.user.can_merge !== true ||
      !Number.isSafeInteger(mr.id) || !mr.target_branch || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(mr.sha)) return null;
  var viewer = await OPS.get_current_user.run({ instance: args.instance }, callId);
  return !viewer.err && viewer.data && Number.isSafeInteger(viewer.data.id) ? {
    id: mr.id, actor: viewer.data.id, base: mr.target_branch, sha: mr.sha, squash: mr.squash === true,
  } : null;
}

async function fetchPrStatus(repo, number, callId) {
  var args = mrApiArgs(repo, number);
  var result = await OPS.get_merge_request.run(args, callId);
  if (result.err) return result;
  var mr = result.data;
  if (!mr || mr.iid !== number || ['opened', 'merged', 'closed', 'locked'].indexOf(mr.state) < 0)
    return { err: t('status404') };
  var pipeline = mr.head_pipeline && mr.head_pipeline.status;
  var merge = await fetchPrMergeTarget(args, mr, callId).catch(function () { return null; });
  return { pr: {
    number: number, title: mr.title, url: 'https://' + repo + '/-/merge_requests/' + number,
    state: mr.state === 'opened' ? 'open' : mr.state === 'merged' ? 'merged' : 'closed',
    draft: mr.draft === true || mr.work_in_progress === true, base: mr.target_branch, head: mr.source_branch,
    ci: pipeline === 'success' ? 'SUCCESS' : pipeline === 'failed' || pipeline === 'canceled' ? 'FAILURE' :
      /^(running|pending|created|preparing|waiting_for_resource)$/.test(pipeline) ? 'PENDING' : null,
    openThreads: null, // The REST blocking flag does not count every unresolved discussion.
    mergeState: mr.has_conflicts === true ? 'DIRTY' : mr.detailed_merge_status === 'mergeable' ? 'CLEAN' : null,
    merge: merge,
  } };
}

function parsePrRef(value, repo) {
  var full = parseMrUrl(value);
  if (full) return full;
  var match = /^!?([1-9]\d*)$/.exec(String(value));
  return match && repo && Number.isSafeInteger(Number(match[1])) ? { repo: repo, number: Number(match[1]) } : null;
}

function prCount(value) {
  var n = Number(value);
  return value !== null && value !== '' && Number.isInteger(n) && n >= 0 && n < 1e7 ? n : null;
}

function prFiles(list) {
  if (!Array.isArray(list)) return null;
  var out = [];
  for (var i = 0; i < list.length && out.length < PR_FILES_KEPT; i++) {
    var f = list[i];
    var p = f && typeof f === 'object' ? f.path : f;
    if (typeof p !== 'string' || !p.trim()) continue;
    out.push({
      path: p.trim().slice(0, 300),
      additions: f && typeof f === 'object' ? prCount(f.additions) : null,
      deletions: f && typeof f === 'object' ? prCount(f.deletions) : null,
    });
  }
  return out;
}

function prText(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 255) : '';
}

/** 提供给 Agent 精简的标题素材；最终任务名遵循 #编号 简短主题。 */
function prTaskTitle(card) {
  return ('!' + card.pr.number + ' ' + (card.pr.title || card.repo)).slice(0, PR_TITLE_MAX);
}

function newPrCard(id, repo) {
  return {
    id: id, repo: repo, head: '', base: '', commits: null, files: null, filesTotal: null,
    stage: 'ask', publishingDraft: false, queued: false, pr: null,
    renamed: false, following: false, followedEver: false, pending: null,
    settingsOpen: false, note: null, followNotice: null, settingsApplied: false,
  };
}

/* ── 渲染 ───────────────────────────────────────────────────────────────
 * 颜色全部取宿主注入的主题变量;PR 状态色不在宿主变量里,用 light-dark() 按
 * 宿主声明的 color-scheme 取浅/深两套值(与客户端 PR 状态色一致)。
 * ──────────────────────────────────────────────────────────────────── */

var PR_GREEN = 'light-dark(#2ea043,#3fb950)';
var PR_BLUE = '#417cdd';
var PR_HOVER = 'color-mix(in srgb,transparent,var(--text-primary) 7%)';
var PR_BASE_CSS =
  '*{box-sizing:border-box}' +
  'button{font:inherit;color:inherit;margin:0;padding:0;border:0;background:var(--bg,transparent);cursor:pointer;' +
  '-webkit-user-select:none;user-select:none;transition:background-color var(--motion-fast,120ms) var(--motion-ease-out,ease-out)}' +
  'button:hover:not(:disabled){background:var(--hover,var(--bg,transparent))}' +
  'button:disabled{cursor:default;opacity:.5}' +
  'button:focus-visible{outline:2px solid var(--focus-ring,#417cdd);outline-offset:2px}';
var PR_CSS = '<style>' + PR_BASE_CSS +
  'button[data-ghost-action^="pr:"]::before,button[data-ghost-task-archive]::before{content:attr(aria-label)}' +
  'a{color:inherit;text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:2px}' +
  'button[data-ghost-action="pr:stop"]{opacity:0;visibility:hidden;transition:opacity var(--motion-fast,120ms) var(--motion-ease-out,ease-out),visibility 0s linear var(--motion-fast,120ms)}' +
  'div:hover>div>button[data-ghost-action="pr:stop"],div:focus-within>div>button[data-ghost-action="pr:stop"]{opacity:1;visibility:visible;transition-delay:0s}' +
  '@keyframes prspin{to{transform:rotate(360deg)}}' +
  '</style>';

function prSpan(style) {
  return '<span style="position:absolute;' + style + '"></span>';
}

function prRing(cx, cy) {
  return prSpan('left:' + (cx - 2.4) + 'px;top:' + (cy - 2.4) + 'px;width:4.8px;height:4.8px;border:1.6px solid currentColor;border-radius:50%');
}

function prVLine(x, y1, y2) {
  return prSpan('left:' + (x - 0.8) + 'px;top:' + y1 + 'px;width:1.6px;height:' + (y2 - y1) + 'px;border-radius:1px;background:currentColor');
}

function prHLine(y, x1, x2) {
  return prSpan('left:' + x1 + 'px;top:' + (y - 0.8) + 'px;width:' + (x2 - x1) + 'px;height:1.6px;border-radius:1px;background:currentColor');
}

/** 16px 的 git 图形(分支 / PR / 草稿 / 已合并 / 已关闭 / 进行中),按 Lucide 的几何画。 */
function prGlyph(kind) {
  var stroke = '1.6px solid currentColor';
  var parts;
  if (kind === 'branch') {
    parts = prVLine(4, 2, 9.6) + prRing(12, 4) + prRing(4, 12) +
      prSpan('left:6.4px;top:6.4px;width:6.4px;height:6.4px;border-right:' + stroke + ';border-bottom:' + stroke + ';border-bottom-right-radius:6px');
  } else if (kind === 'spinner') {
    parts = prSpan('left:1px;top:1px;width:14px;height:14px;border:' + stroke + ';border-top-color:transparent;border-radius:50%;animation:prspin var(--motion-spinner-cycle,900ms) linear infinite');
  } else if (kind === 'merged') {
    parts = prRing(4, 4) + prVLine(4, 6.4, 14.4) + prRing(12, 12) +
      prSpan('left:3.2px;top:6px;width:6.4px;height:6.8px;border-left:' + stroke + ';border-bottom:' + stroke + ';border-bottom-left-radius:6px');
  } else {
    parts = prRing(4, 4) + prVLine(4, 6.4, 14.4) + prRing(12, 12);
    if (kind === 'draft') {
      parts += prVLine(12, 2.2, 4) + prVLine(12, 5.8, 7.6);
    } else if (kind === 'closed') {
      parts += prVLine(12, 6.8, 9.6) +
        prSpan('left:11.2px;top:0.8px;width:1.6px;height:4.6px;border-radius:1px;background:currentColor;transform:rotate(45deg)') +
        prSpan('left:11.2px;top:0.8px;width:1.6px;height:4.6px;border-radius:1px;background:currentColor;transform:rotate(-45deg)');
    } else {
      parts += prSpan('left:7.6px;top:3.2px;width:5.2px;height:6.4px;border-top:' + stroke + ';border-right:' + stroke + ';border-top-right-radius:2.4px');
    }
  }
  return '<span style="position:relative;display:block;width:16px;height:16px">' + parts + '</span>';
}

/**
 * 设置按钮的齿轮。新版宿主认 data-ghost-icon="settings",换成 App 里同一个设置图标;
 * 旧版宿主显示里面用 CSS 拼的兜底齿轮(描边外圈 + 中心孔,8 个齿绕中心旋转排布)。
 */
function prGearGlyph() {
  var teeth = '';
  for (var i = 0; i < 8; i++) {
    teeth += prSpan('left:6.8px;top:0.6px;width:2.4px;height:2.8px;border-radius:0.6px;background:currentColor;' +
      'transform-origin:1.2px 7.4px;transform:rotate(' + (i * 45) + 'deg)');
  }
  return '<span data-ghost-icon="settings" style="position:relative;display:block;width:16px;height:16px">' + teeth +
    prSpan('left:2.6px;top:2.6px;width:10.8px;height:10.8px;border:1.6px solid currentColor;border-radius:50%') +
    prRing(8, 8) + '</span>';
}

function prCheckGlyph() {
  return '<span style="display:inline-block;width:5px;height:9px;margin:-3px 3px 0 2px;' +
    'border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg)"></span>';
}

function prMiniSpinner() {
  return '<span style="display:inline-block;width:11px;height:11px;margin-right:2px;border:1.5px solid currentColor;' +
    'border-top-color:transparent;border-radius:50%;animation:prspin var(--motion-spinner-cycle,900ms) linear infinite"></span>';
}

function prTile(glyph, tone) {
  var color = 'var(--text-secondary)';
  var bg = 'var(--surface-chip)';
  if (tone === 'open') {
    color = PR_GREEN;
    bg = 'color-mix(in srgb,' + PR_GREEN + ' 14%,transparent)';
  } else if (tone === 'merged') {
    color = PR_BLUE;
    bg = 'color-mix(in srgb,' + PR_BLUE + ' 16%,transparent)';
  } else if (tone === 'muted') {
    color = 'var(--text-tertiary)';
  }
  return '<div style="display:grid;flex:none;place-items:center;width:36px;height:36px;border-radius:8px;color:' + color + ';background:' + bg + '">' +
    prGlyph(glyph) + '</div>';
}

var PR_SEP = '<span style="color:var(--text-tertiary)"> · </span>';

/** 上层:图标、标题、仓库或进度说明,设置按钮靠右。 */
function prHeader(tile, titleHtml, metaParts, pr, gear) {
  return '<div style="display:flex;align-items:center;gap:12px;padding:14px 12px 14px 16px">' +
    tile +
    '<div style="flex:1;min-width:0">' +
    '<div style="display:flex;align-items:center;gap:2px">' +
    '<span style="min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:14px;line-height:20px;font-weight:500">' + titleHtml + '</span>' +
    prCopyButton(pr) + '</div>' +
    '<div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-top:2px;font-size:12px;line-height:16px;color:var(--text-secondary)">' +
    metaParts.join(PR_SEP) + '</div>' +
    '</div>' + (gear || '') + '</div>';
}

/** 下层:左边分支或状态,右边按钮;窄的时候按钮换到下一行。 */
function prFooter(leftHtml, actionsHtml, openOnly, archiveHtml) {
  return '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;min-height:52px;padding:10px 16px;border-top:1px solid var(--border-default)">' +
    '<div style="flex:1 1 220px;min-width:0;font-size:12px;line-height:16px;color:var(--text-secondary)">' + leftHtml + '</div>' +
    (actionsHtml ? '<div' + (openOnly || '') + ' style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-left:auto">' + actionsHtml + '</div>' : '') +
    // 归档按钮不放进 open-only 的那一组:PR 在卡片之外合并后,那一组被藏起,这颗正好露出来。
    (archiveHtml ? '<div style="display:flex;align-items:center;margin-left:auto">' + archiveHtml + '</div>' : '') +
    '</div>';
}

/**
 * 归档任务按钮(data-ghost-task-archive):点击由 Cindy 走标准归档流程,插件收不到这次点击。
 * 写成 display:none,新版 Cindy 在 PR 已合并或关闭时把它露出来(包括在卡片之外合并的情况),
 * 旧版 Cindy 和手机不认这个标记,一直藏着。开了「合并后自动归档」时加 -auto,由 Cindy 自己确认
 * 已合并、用户看过并离开、归档不会丢东西后才归档。
 */
function prArchiveButton(card, settings) {
  if (!card.pr) return '';
  var ended = card.stage === 'merged' || card.stage === 'closed';
  return '<button data-ghost-task-archive="' + prEsc(card.pr.url) + '"' +
    (ended ? ' data-ghost-task-archive-state="' + card.stage + '"' : '') +
    (settings.autoArchive ? ' data-ghost-task-archive-auto' : '') +
    ' aria-label="' + prEsc(t('prArchiveTask')) + '" style="' + PR_PILL.replace('display:inline-flex;', 'display:none;') +
    'border:1px solid var(--border-default);--bg:var(--surface-elevated);--hover:color-mix(in srgb,var(--surface-elevated),var(--text-primary) 8%)"></button>';
}

/**
 * data-ghost-pr-open-only:只在 PR 还开着时成立的部分(跟进中、操作按钮、「开放中」)。
 * 卡片是调用时的快照;PR 在卡片之外被合并或关闭时(有人在 GitLab 上手动合并,Agent 没被叫醒),
 * 宿主按标题栏同一份状态把这些藏起来,卡片不会继续说「跟进中」。旧版宿主不认这个属性,照常显示。
 */
function prOpenOnly(card) {
  return card.pr ? ' data-ghost-pr-open-only="' + prEsc(card.pr.url) + '"' : '';
}

var PR_PILL = 'display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:9999px;font-size:13px;font-weight:500;white-space:nowrap;';

function prButton(action, label, style, inner, extraAttrs) {
  return '<button data-ghost-action="' + action + '" aria-label="' + prEsc(label) + '"' + (extraAttrs || '') + ' style="' + style + '">' + (inner || '') + '</button>';
}

// data-ghost-primary:手机端把它画成主按钮(电脑端靠这里的样式)。
function prCtaButton(action, label) {
  return prButton(action, label, PR_PILL + 'border:1px solid transparent;color:var(--accent-pure-cta-fg,#fff);' +
    '--bg:var(--accent-cta-bg,#000);--hover:color-mix(in srgb,var(--accent-cta-bg,#000),var(--surface-elevated) 18%)', '', ' data-ghost-primary');
}

function prPillButton(action, label) {
  return prButton(action, label, PR_PILL + 'border:1px solid var(--border-default);' +
    '--bg:var(--surface-elevated);--hover:color-mix(in srgb,var(--surface-elevated),var(--text-primary) 8%)');
}

function prQuietButton(action, label, extra, inner) {
  return prButton(action, label, 'display:inline-flex;align-items:center;height:32px;padding:0 10px;border-radius:9999px;' +
    'font-size:12px;font-weight:500;color:var(--text-secondary);--hover:' + PR_HOVER + (extra || ''), inner);
}

/** 跟进中:按钮原地换成一行安静的状态(小绿点 + 次级文字),圆点由宿主播呼吸光环(data-ghost-live)。 */
function prFollowingPill() {
  // data-ghost-live-label:手机端据此把这一项画成带呼吸点的状态。
  return '<div data-ghost-live-label="' + prEsc(t('prStateFollowing')) + '" style="display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 4px;font-size:13px;color:var(--text-secondary);white-space:nowrap">' +
    '<span style="position:relative;flex:none;width:6px;height:6px">' +
    // 宿主按 data-ghost-live 给这层播呼吸光环;旧版宿主不认这个属性时它只是叠在圆点下的同色圆。
    '<span data-ghost-live style="position:absolute;inset:0;border-radius:50%;background:' + PR_GREEN + '"></span>' +
    '<span style="position:absolute;inset:0;border-radius:50%;background:' + PR_GREEN + '"></span></span>' +
    prEsc(t('prStateFollowing')) + '</div>';
}

function prChip(label, pending) {
  return '<div style="display:inline-flex;align-items:center;height:32px;padding:0 2px;font-size:13px;color:var(--text-secondary);white-space:nowrap">' +
    '<span style="display:inline-flex;align-items:center;color:var(--text-tertiary)">' + (pending ? prMiniSpinner() : prCheckGlyph()) + '</span>' +
    '<span style="margin-left:4px">' + prEsc(label) + '</span></div>';
}

function prStatusItem(tone, label) {
  var dot = tone === 'good'
    ? 'background:' + PR_GREEN
    : tone === 'bad'
      ? 'background:var(--error-fg,#d93025)'
      : 'border:1.5px solid var(--text-tertiary)';
  return '<div style="display:inline-flex;align-items:center;gap:6px;' + (tone === 'good' ? 'color:var(--text-primary)' : '') + '">' +
    '<span style="flex:none;width:7px;height:7px;border-radius:50%;' + dot + '"></span>' + prEsc(label) + '</div>';
}

function prStatusStrip(pr) {
  var items = '';
  if (pr.ci === 'SUCCESS') items += prStatusItem('good', t('prCiPassed'));
  else if (pr.ci === 'FAILURE' || pr.ci === 'ERROR') items += prStatusItem('bad', t('prCiFailed'));
  else if (pr.ci) items += prStatusItem('wait', t('prCiRunning'));
  if (pr.openThreads != null) items += pr.openThreads > 0
    ? prStatusItem('wait', t('prThreadsOpen', { count: pr.openThreads }))
    : prStatusItem('good', t('prThreadsNone'));
  if (pr.mergeState === 'DIRTY') items += prStatusItem('bad', t('prMergeConflict'));
  else if (pr.mergeState === 'BEHIND') items += prStatusItem('wait', t('prMergeBehind', { base: pr.base || 'base' }));
  else if (pr.mergeState === 'CLEAN') items += prStatusItem('good', t('prMergeReady'));
  else if (pr.review === 'CHANGES_REQUESTED') items += prStatusItem('wait', t('prMergeChanges'));
  else if (pr.review === 'REVIEW_REQUIRED') items += prStatusItem('wait', t('prMergeApproval'));
  else items += prStatusItem('wait', t('prMergeWaiting'));
  return '<div style="display:flex;flex-wrap:wrap;gap:6px 16px">' + items + '</div>';
}

/** 分支与改动概况(下层左边)。 */
function prContextLine(card) {
  var head = card.head || (card.pr && card.pr.head) || '';
  var base = card.base || (card.pr && card.pr.base) || '';
  var parts = head ? [prEsc(head) + (base ? ' → ' + prEsc(base) : '')] : [];
  parts = parts.concat(prStatsParts(card));
  return '<div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + parts.join(PR_SEP) + '</div>';
}

function prSettingRow(action, label, hint, on) {
  // data-ghost-toggle:手机端把这一行画成原生开关(文字取按钮里的标题和说明)。
  return '<button data-ghost-action="' + action + '" data-ghost-toggle="' + (on ? 'on' : 'off') + '" aria-label="' + prEsc(on ? t('prTurnOff', { name: label }) : t('prTurnOn', { name: label })) + '" ' +
    'style="display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;padding:8px;border-radius:8px;text-align:left;--hover:' + PR_HOVER + '">' +
    '<div style="min-width:0"><div style="font-size:13px;line-height:18px;font-weight:500">' + prEsc(label) + '</div>' +
    '<div style="font-size:12px;line-height:16px;color:var(--text-secondary)">' + prEsc(hint) + '</div></div>' +
    '<span style="position:relative;flex:none;width:36px;height:20px;border-radius:9999px;background:' + (on ? PR_BLUE : 'light-dark(#808080,#787878)') + '">' +
    '<span style="position:absolute;top:2px;left:' + (on ? 18 : 2) + 'px;width:16px;height:16px;border-radius:50%;background:#fcfcfc"></span></span></button>';
}

// 手机端只看得到按钮的名字(aria-label),选中的那一段在名字里注明「当前」;电脑端显示里面的文字。
function prSegment(action, label, active, inner) {
  return prButton(action, active ? t('prChoiceCurrent', { name: label }) : label, 'display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:9999px;' +
    'font-size:12px;font-weight:500;white-space:nowrap;' + (active
      ? 'color:var(--text-primary);--bg:var(--surface-elevated);box-shadow:0 0 0 1px var(--border-default)'
      : 'color:var(--text-secondary);--hover:' + PR_HOVER), inner);
}

/** 推理档位与速度的显示名(和输入框旁的模型选择器一样跟在模型名后面)。 */
function prRouteExtras(route) {
  var effort = { minimal: t('prEffortMinimal'), low: t('prEffortLow'), medium: t('prEffortMedium'), high: t('prEffortHigh'),
    xhigh: t('prEffortXhigh'), max: t('prEffortMax') }[route.effort] || route.effort;
  var parts = effort ? [effort] : [];
  if (route.fastMode === 'ultrafast') parts.push(t('prUltrafastMode'));
  else if (route.fastMode === true) parts.push(t('prFastMode'));
  return parts;
}

/** 下拉箭头(卡内没有 SVG,用描边拼)。 */
function prChevron() {
  return '<span style="flex:none;display:inline-block;width:6px;height:6px;margin:0 2px -1px 8px;' +
    'border-right:1.5px solid var(--text-tertiary);border-bottom:1.5px solid var(--text-tertiary);transform:translateY(-2px) rotate(45deg)"></span>';
}

/**
 * 跟进模型二选一:跟随当前任务(默认),或指定一个模型。指定时下面单独一行是模型下拉框
 * (模型名 · 档位 ⌄)。新版宿主认 data-ghost-model-select,点它在框下方弹出模型列表;
 * 手机和旧版宿主照常派发动作,由这里打开 Cindy 的模型选择器;切回「跟随」再切回
 * 「指定」直接恢复上次的模型。旧版宿主没有统一选择器时不显示这一行。
 */
function prModelRow(settings) {
  if (typeof cindy.pickModel !== 'function') return '';
  var m = settings.followModel;
  var head = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">' +
    '<div style="flex:1;min-width:0"><div style="font-size:13px;line-height:18px;font-weight:500">' + prEsc(t('prFollowModel')) + '</div>' +
    (m ? '' : '<div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;line-height:16px;color:var(--text-secondary)">' +
      prEsc(t('prFollowModelTaskHint')) + '</div>') + '</div>' +
    '<div style="display:flex;flex:none;gap:2px;padding:2px;border-radius:9999px;background:var(--surface-chip)">' +
    prSegment('prset:modelTask', t('prFollowModelTask'), !m, prEsc(t('prFollowModelTask'))) +
    prSegment('prset:model', t('prFollowModelCustom'), !!m, prEsc(t('prFollowModelCustom'))) +
    '</div></div>';
  var picker = m
    ? '<div style="margin-top:8px">' + prButton('prset:modelPick', t('prFollowModelChangeTo', { name: m.label }),
      'display:inline-flex;align-items:center;max-width:100%;height:32px;padding:0 10px;border-radius:8px;font-size:13px;' +
      'border:1px solid var(--border-default);--bg:var(--surface-elevated);--hover:color-mix(in srgb,var(--surface-elevated),var(--text-primary) 6%)',
      '<span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:500">' + prEsc(m.label) + '</span>' +
      prRouteExtras(m.route).map(function (x) { return '<span style="flex:none;margin-left:8px;color:var(--text-secondary)">' + prEsc(x) + '</span>'; }).join('') +
      prChevron(), ' data-ghost-model-select="' + prEsc(JSON.stringify(m.route)) + '"') + '</div>'
    : '';
  return '<div style="padding:8px">' + head + picker + '</div>';
}

function prSettingsPanel(settings) {
  return '<div style="padding:8px 8px 10px;border-top:1px solid var(--border-default)">' +
    '<div style="padding:4px 8px;font-size:12px;line-height:16px;font-weight:600;color:var(--text-tertiary)">' + prEsc(t('prSettings')) + '</div>' +
    prSettingRow('prset:rename', t('prAutoRename'), t('prAutoRenameHint'), settings.autoRename) +
    prSettingRow('prset:follow', t('prAutoFollow'), t('prAutoFollowHint'), settings.autoFollow) +
    prSettingRow('prset:archive', t('prAutoArchive'), t('prAutoArchiveHint'), settings.autoArchive) +
    prModelRow(settings) +
    '</div>';
}

function prGearButton(open) {
  return prButton('prui:settings', open ? t('prHideSettings') : t('prSettings'),
    'display:grid;flex:none;align-self:flex-start;place-items:center;width:32px;height:32px;border-radius:9999px;' +
    'color:' + (open ? 'var(--text-primary);--bg:' + PR_HOVER : 'var(--text-tertiary)') + ';--hover:' + PR_HOVER,
    prGearGlyph());
}

/** 两张叠放的圆角方块,与 App 的复制图标同形;新版宿主按 data-ghost-icon="copy" 换成 App 图标。 */
function prCopyGlyph() {
  return '<span data-ghost-icon="copy" style="position:relative;display:block;width:14px;height:14px">' +
    prSpan('left:5px;top:5px;width:8px;height:8px;border:1.4px solid currentColor;border-radius:2px') +
    prSpan('left:1px;top:1px;width:8px;height:8px;border-top:1.4px solid currentColor;border-left:1.4px solid currentColor;border-top-left-radius:2px') +
    '</span>';
}

/**
 * 复制 PR 链接按钮(data-ghost-copy-link),与标题栏 PR 浮窗里的复制按钮对应:点击由 Cindy 写剪贴板,
 * 插件收不到这次点击。写成 display:none,新版 Cindy 认得才露出来;旧版和手机一直藏着。
 */
function prCopyButton(pr) {
  if (!pr || !parseMrUrl(pr.url || '')) return '';
  return '<button data-ghost-copy-link="' + prEsc(pr.url) + '" aria-label="' + prEsc(t('prCopyLink')) + '"' +
    ' style="display:none;flex:none;align-items:center;justify-content:center;width:24px;height:24px;border-radius:4px;' +
    'color:var(--text-tertiary);--hover:' + PR_HOVER + '">' + prCopyGlyph() + '</button>';
}

function prStatsParts(card) {
  var parts = [];
  // 改动还没提交时只报文件数,不显示「0 个提交」。
  if (card.commits) parts.push(prEsc(card.commits === 1 ? t('prCommitOne') : t('prCommitMany', { count: card.commits })));
  var files = card.filesTotal != null ? card.filesTotal : card.files ? card.files.length : null;
  if (files != null && files > 0) parts.push(prEsc(files === 1 ? t('prFileOne') : t('prFileMany', { count: files })));
  return parts;
}

function renderPrReference(card, owner) {
  owner = owner || card;
  var pr = card.pr;
  var title = pr ? '!' + pr.number + ' ' + (pr.title || card.repo) : t('prAskTitle');
  var tile = !pr ? prTile('branch') : card.stage === 'merged' ? prTile('merged', 'merged') :
    card.stage === 'closed' ? prTile('closed', 'muted') : pr.draft ? prTile('draft', 'muted') : prTile('pr', 'open');
  var status = !pr ? prContextLine(card) :
    '<div data-ghost-pr-status="' + prEsc(pr.url) + '">' +
    (card.stage === 'merged' ? prEsc(t('prStateMerged')) : card.stage === 'closed' ? prEsc(t('prStateClosed')) : prStatusStrip(pr)) + '</div>';
  if (card.note) status += '<div style="margin-top:4px;color:var(--text-secondary)">' + prEsc(card.note) + '</div>';
  var taskLink = '<button data-ghost-action="pr:open-task" data-ghost-session-link="cindy://session/' + prEsc(encodeURIComponent(owner.sessionId)) +
    '" style="display:inline-flex;align-items:center;padding:5px 10px;border:1px solid var(--border-default);' +
    'border-radius:9999px;background:transparent;color:var(--text-primary);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer">' +
    prEsc(t('prOpenTask')) + ' ↗</button>';
  return '<style>' + PR_BASE_CSS + '</style><div data-ghost-width="full" style="overflow:hidden;border:1px solid var(--border-default);border-radius:12px;' +
    'background:var(--surface-elevated);color:var(--text-primary);font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:1.5">' +
    prHeader(tile, prEsc(title), [prEsc(card.repo), prEsc(owner.pending === 'follow' ? t('prOtherStarting') : owner.pending === 'stop' ? t('prOtherStopping') : t('prReadOnly'))], pr) + prFooter(status, taskLink, '', '') + '</div>';
}

function prHasSettings(card) {
  return card.stage === 'ask' || card.stage === 'open' || card.stage === 'merged' || card.stage === 'closed';
}


function prCanFollow(card) {
  return card.stage === 'open' && !!card.pr && !card.pr.draft;
}

function prCanStartFollow(card) {
  return prCanFollow(card) && card.pending !== 'stop' && !card.following && !card.scheduleId;
}

function prShouldAutoFollow(card, settings) {
  return settings.autoFollow && !card.skipPublishedFollow && prCanStartFollow(card);
}

function prShouldStopSchedule(card, verified) {
  return hasCardScheduler() && (card.scheduleAction === 'stop' ||
    (verified && !prCanFollow(card) && (card.scheduleAction === 'start' || !!card.scheduleId)));
}

function prMayMerge(card) {
  return prCanFollow(card) && card.pr.merge && !card.pending && !card.mergeUncertain;
}

function samePrMerge(left, right) {
  return !!left && !!right && JSON.stringify(left) === JSON.stringify(right);
}

function updatePrMergeStatus(card, status) {
  if (status.pr) card.pr = status.pr;
  else if (card.pr) card.pr.merge = null;
  if (card.mergeConfirmation && !samePrMerge(card.mergeConfirmation.target, card.pr.merge)) card.mergeConfirmation = null;
  if (status.pr && status.pr.state !== 'open') card.mergeUncertain = false;
}

async function readPrMergeStatus(card) {
  var latest = await fetchPrStatus(card.repo, card.pr.number).catch(function () { return {}; });
  updatePrMergeStatus(card, latest);
  if (latest.pr) card.stage = latest.pr.state;
  return !!latest.pr;
}

async function prMergeAction(card, settings, msg, action) {
  if (!msg.userActionToken || !card.pr || card.stage !== 'open') return;
  var confirmation = card.mergeConfirmation;
  var attempted = false;
  var verified = false;
  if (action === 'pr:merge' && prMayMerge(card) && !confirmation) {
    card.mergeRevision = (card.mergeRevision || 0) + 1;
    card.mergeConfirmation = { revision: card.mergeRevision, target: card.pr.merge };
    card.note = null;
  } else if (confirmation && action === 'pr:merge-cancel:' + confirmation.revision) {
    card.mergeConfirmation = null;
  } else if (confirmation && prMayMerge(card) && action === 'pr:merge-confirm:' + confirmation.revision) {
    card.mergeConfirmation = null;
    verified = await readPrMergeStatus(card);
    if (!prMayMerge(card) || !samePrMerge(confirmation.target, card.pr.merge)) {
      if (card.stage === 'open') card.note = t('prMergeChanged');
    } else {
      card.mergeUncertain = true;
      if (!await savePrCard(card)) {
        card.mergeUncertain = false;
        card.note = t('prSaveFailed');
      } else {
        attempted = true;
        var result = await OPS.merge_merge_request.run(Object.assign(mrApiArgs(card.repo, card.pr.number), { sha: confirmation.target.sha })).catch(function () { return {}; });
        if (result.data && result.data.state === 'merged' && result.data.iid === card.pr.number) {
          verified = true;
          card.stage = card.pr.state = 'merged';
          card.pr.merge = null;
          card.mergeUncertain = false;
          card.note = null;
        } else if (/^(400|401|403|404|405|409|422|429)$/.test(result.status)) {
          card.mergeUncertain = false;
          card.pr.merge = null;
          card.note = t('prMergeRejected');
        } else {
          verified = await readPrMergeStatus(card);
        }
      }
    }
  } else if (action === 'pr:merge-recheck' && card.mergeUncertain) {
    verified = await readPrMergeStatus(card);
  } else {
    return;
  }
  if (prShouldStopSchedule(card, verified)) {
    var mergeNote = card.note;
    await syncCardSchedule(card, settings, false);
    if (!card.note) card.note = mergeNote;
  }
  if (await savePrCardRetry(card) || attempted) await sendPrCard(card, settings, null);
}

function renderPrCard(card, settings) {
  var tile, title, meta, left, actions = '';
  var gear = prHasSettings(card);
  if (card.stage === 'ask') {
    tile = prTile('branch');
    title = prEsc(t('prAskTitle'));
    meta = [prEsc(card.repo)];
    left = prContextLine(card);
    // 看改动交给宿主的审查面板(真实 diff、可撤销),卡片只管发不发。
    actions = prPillButton('pr:draft', t('prPublishDraft')) + prCtaButton('pr:publish', t('prPublish'));
  } else if (card.stage === 'publishing') {
    tile = prTile('spinner');
    title = prEsc(card.publishingDraft ? t('prPublishingDraftTitle') : t('prPublishingTitle'));
    meta = [prEsc(card.queued ? t('prQueuedMeta') : t('prPublishingMeta'))];
    left = prContextLine(card);
  } else {
    var pr = card.pr;
    title = '<span style="margin-right:2px;color:var(--text-secondary);font-weight:500">!' + pr.number + '</span> ' + prEsc(pr.title || card.repo);
    // 标题即 PR 链接:宿主确认后用系统浏览器打开(需 card.externalLinks)。
    if (parseMrUrl(pr.url)) {
      title = '<a href="' + prEsc(pr.url) + '">' + title + '</a>';
    }
    if (card.stage === 'open') {
      tile = pr.draft ? prTile('draft', 'muted') : prTile('pr', 'open');
      // 跟进中由下层的「● 跟进中」表达,标题行不再重复。
      meta = card.following
        ? [prEsc(card.repo)]
        : [prEsc(card.repo), '<span' + prOpenOnly(card) + '>' + prEsc(pr.draft ? t('prStateDraft') : t('prStateOpen')) + '</span>'];
      // 跟进中的检查状态交给宿主按标题栏同一份数据实时填写;这里画的是兜底快照
      // (旧版宿主、手机,或宿主还没查到这条 PR 时显示)。
      left = card.following
        ? '<div data-ghost-pr-status="' + prEsc(pr.url) + '">' + prStatusStrip(pr) + '</div>'
        : prContextLine(card);
      // 停止排在状态左边:悬停这一行才出现,出现时不推动「跟进中」。
      // 草稿不提供自动跟进(还在改,Agent 后台推提交会撞车),主操作是转为正式。
      actions = card.pending === 'follow'
        ? prChip(t('prFollowStarting'), true)
        : card.pending === 'stop'
          ? prChip(t('prStopping'), true)
          : card.pending === 'ready'
            ? prChip(t('prMarkingReady'), true)
            : card.following
              ? prQuietButton('pr:stop', t('prStop')) + prFollowingPill()
              : card.scheduleId
                ? prQuietButton('pr:stop', t('prStop')) + prChip(card.scheduleStatus === 'paused' ? t('prFollowPaused') : t('prFollowEnded'))
                : pr.draft
                  ? (card.readyUncertain ? '' : prCtaButton('pr:ready', t('prMarkReady')))
                  : prPillButton('pr:follow', t('prFollow'));
      if (card.mergeUncertain) {
        left += '<div>' + prEsc(t('prMergeUnknown')) + '</div>';
        actions += prPillButton('pr:merge-recheck', t('prMergeRecheck'));
      } else if (prMayMerge(card)) {
        var confirmation = card.mergeConfirmation;
        if (confirmation) {
          var target = confirmation.target;
          left += '<div style="overflow-wrap:anywhere">' + prEsc(t('prMergePrompt', { base: target.base, sha: target.sha.slice(0, 12) })) +
            (target.squash ? ' · ' + prEsc(t('prMergeMethod_squash')) : '') + '</div>';
          actions = prPillButton('pr:merge-cancel:' + confirmation.revision, t('prMergeCancel')) +
            prCtaButton('pr:merge-confirm:' + confirmation.revision, t('prMergeConfirm'));
        } else {
          actions += prCtaButton('pr:merge', t('prMerge'));
        }
      }
    } else {
      tile = card.stage === 'merged' ? prTile('merged', 'merged') : prTile('closed', 'muted');
      meta = [prEsc(card.repo), prEsc(card.stage === 'merged' ? t('prStateMerged') : t('prStateClosed'))];
      if (card.followedEver) meta.push(prEsc(t('prFollowEnded')));
      left = prContextLine(card);
    }
  }
  if (card.followNotice && card.stage === 'open' && card.following && !card.note) {
    left += '<div style="margin-top:4px;color:var(--text-secondary)">' + prEsc(card.followNotice) + '</div>';
  }
  if (card.note) {
    left += '<div style="margin-top:4px;color:var(--error-fg,#d93025)">' + prEsc(card.note) + '</div>';
  }
  var openOnly = card.stage === 'open' ? prOpenOnly(card) : '';
  var body = prHeader(tile, title, meta, card.pr, gear ? prGearButton(card.settingsOpen) : '') + prFooter(left, actions, openOnly, prArchiveButton(card, settings));
  // Settings remain available after merge/close, including when the host updates an open snapshot.
  if (gear && card.settingsOpen) body += prSettingsPanel(settings);
  // 排到本轮末尾、铺满消息列:宿主把卡放在「已更改 N 个文件」卡之后,与它同宽。
  return PR_CSS +
    '<div data-ghost-placement="turn-end" data-ghost-width="full" style="display:flex;flex-direction:column;justify-content:space-between;' +
    'min-height:120px;overflow:hidden;border:1px solid var(--border-default);border-radius:12px;background:var(--surface-elevated);' +
    'color:var(--text-primary);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5">' +
    body + '</div>';
}

/** 声明高度宁低勿高:宿主按实际内容量高只会往上调,声明偏高会在卡片下方留白。 */
function prCardHeight(card) {
  var h = 120;
  if (card.note || (card.followNotice && card.stage === 'open' && card.following)) h += 22;
  if (card.settingsOpen && prHasSettings(card)) h += 160;
  return Math.min(900, h);
}

async function sendPrCard(card, settings, sourceCallId) {
  var active = await findPrCardOwner(card.repo, card.pr && card.pr.number, card.head, card.id, card.sessionId);
  var other = active && prFollowActive(active) && active.sessionId !== card.sessionId ? active : null;
  return deliverPrCard(card, settings, sourceCallId, other);
}

async function deliverPrCard(card, settings, sourceCallId, other) {
  var msg = {
    // 正在发、正在开启或停止跟进时报 working:宿主才播卡内转圈(静态版会剥掉动画),
    // Agent 用 mr_card 更新结果时换回 done。
    type: 'card-update', callId: prAnchor(card), v: 2,
    state: !other && (card.stage === 'publishing' || card.pending) ? 'working' : 'done',
    html: other ? renderPrReference(card, other) : renderPrCard(card, settings), height: prCardHeight(card),
  };
  // 后续工具调用改的是之前那张卡片:带上当前调用作凭证,宿主才会重开旧卡片。
  if (sourceCallId) msg.sourceCallId = sourceCallId;
  // Resolves true when the host took the update, false when it refused it (so the caller can say so).
  try { await cindy.send(msg); return true; } catch (e) { return false; }
}

/** 挪走后留在原处的一行:PR 号和标题,提示最新状态在下方。没有按钮,点击不会落到这里。 */
function renderPrMovedStub(card) {
  var label = card.pr ? '!' + card.pr.number + ' ' + (card.pr.title || card.repo) : card.repo;
  return '<div data-ghost-placement="turn-end" data-ghost-width="full" style="display:flex;align-items:center;gap:6px;' +
    'padding:10px 14px;border:1px solid var(--border-default);border-radius:12px;color:var(--text-secondary);' +
    'font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;font-size:13px;line-height:1.5">' +
    '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + prEsc(label) + '</span> ' +
    '<span style="flex:none">· ' + prEsc(t('prMovedBelow')) + '</span></div>';
}

/** 挪卡第一步:新位置记别名并改 anchor(卡片状态保存成功后再用 sendPrMovedStub 收口旧位置)。返回旧位置,别名写不进去时返回 null。 */
async function movePrCard(card, callId) {
  var from = prAnchor(card);
  var alias = await cindy.send({
    type: 'fs-request', root: 'data', op: 'write',
    path: prCardPath(callId), content: JSON.stringify({ id: callId, alias: card.id }),
  });
  // 别名写不进去时不挪:新位置的按钮会找不回卡片。
  if (!alias || !alias.ok) return null;
  card.anchor = callId;
  return from;
}

/** 收口旧位置(凭这次调用重开旧卡片):supersededBy 让认得它的 Cindy 整张藏起旧卡,旧版 Cindy 和手机显示这一行提示。 */
function sendPrMovedStub(card, from, callId) {
  return Promise.resolve(cindy.send({
    type: 'card-update', callId: from, v: 2, state: 'done',
    html: renderPrMovedStub(card), height: 44, sourceCallId: callId, supersededBy: callId,
  })).catch(function () {});
}

/* ── mr_card 工具 ── */

function hasCardScheduler() {
  return !!(cindy.host && typeof cindy.host.call === 'function');
}

async function prSchedule(tool, args) {
  var result = await cindy.host.call('cindy_scheduler', tool, Object.assign({ device: 'local' }, args));
  var block = result && result.content && result.content.find(function (item) { return item.type === 'text'; });
  var body = block && JSON.parse(block.text);
  if (!body || result.isError || body.ok !== true) {
    var detail = body && (body.message || body.code || body.errorCode);
    var verr = body && body.data && Array.isArray(body.data.validation_errors) && body.data.validation_errors[0];
    if (verr && verr.message) {
      var vpath = Array.isArray(verr.path) && verr.path.length ? verr.path.join('.') + ': ' : '';
      detail = (detail ? detail + ': ' : '') + vpath + verr.message;
    }
    throw new Error(detail || tool);
  }
  return body.data;
}

function followUrl(card) {
  return card.pr.url.toLowerCase();
}

function mentionsPr(row, url) {
  return !!row.prTrigger && String(row.prTrigger.url).toLowerCase() === url;
}

function ownedFollowSchedule(row, card) {
  return !!row && row.targetSessionId === card.sessionId && row.recurring &&
    mentionsPr(row, followUrl(card)) && String(row.prompt).endsWith('MR card: ' + card.id);
}

async function schedulesForPr(card) {
  var url = followUrl(card);
  var rows = await prSchedule('schedule_list', { query: url });
  if (!Array.isArray(rows)) throw new Error('schedule_list');
  return rows.filter(function (row) { return mentionsPr(row, url); });
}

async function readOwnedFollowSchedule(card) {
  if (card.scheduleId) {
    var known = await prSchedule('schedule_get', { id: card.scheduleId });
    if (known && (!ownedFollowSchedule(known, card) || known.id !== card.scheduleId))
      throw new Error(t('prOwnershipUnknown'));
    if (known) return known;
  }
  // A failed start read-back may leave a real schedule without a saved ID.
  var owned = (await schedulesForPr(card)).filter(function (row) { return ownedFollowSchedule(row, card); });
  if (!owned.length) return null;
  if (owned.length !== 1 || !owned[0].id) throw new Error(t('prOwnershipUnknown'));
  var id = owned[0].id;
  var saved = await prSchedule('schedule_get', { id: id });
  if (saved && (!ownedFollowSchedule(saved, card) || saved.id !== id)) throw new Error(t('prOwnershipUnknown'));
  return saved;
}

function buildCardScheduleInput(card, model) {
  var url = followUrl(card);
  var input = {
    name: 'MR !' + card.pr.number, targetSessionId: card.sessionId,
    prompt: 'Follow ' + url + ' using the GitLab plugin in this task. Read the MR, pipeline and unresolved discussions. ' +
      'Address actionable feedback and failed checks within the task permissions. Respect the user’s merge instructions. ' +
      'Refresh mr_card with card_id after the round, including on merge or close so the card stops its schedule. MR card: ' + card.id,
    // The bound session supplies its live engine unless a model override is present.
    agentKind: model ? model.model_agent_kind : 'codex',
    recurring: true, cronExpr: '*/5 * * * *', intervalMs: 300000,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    prTrigger: { url: url, change: 'any' }, silentWhenIdle: true, notify: { desktop: true, feishu: false },
  };
  if (model) {
    input.modelAgentKind = model.model_agent_kind;
    input.model = model.model;
    input.providerId = model.provider_id;
    input.modelAgentDeviceId = model.agent_device_id || '';
    input.fastMode = model.fast_mode;
    if (model.effort) input.effort = model.effort;
  }
  return input;
}

function isUnsupportedBoundPluginEngineOverride(err) {
  var msg = String(err && (err.message || err) || '');
  return /A plugin engine schedule starts a new task each run|Plugin engines run on the automation host only|Explicit scheduled model Harness requires a supported Harness and model|A plugin engine schedule must choose the plugin engine as its model|SSH automation targets must keep their current Harness|Collaborative tasks cannot switch to or from a plugin engine|This task cannot switch to or from a plugin engine|INVALID_ARGS[^\n]*\b(?:modelAgentKind|agentKind)\b|Invalid (?:enum value|option)[^\n]*\bacp\b/i.test(msg);
}

async function createCardSchedule(card, settings) {
  var model = prSettingsForAgent(settings, true).follow_model;
  try {
    return { schedule: await prSchedule('schedule_create', buildCardScheduleInput(card, model)), usedTaskModelFallback: false };
  } catch (err) {
    if (!model || model.model_agent_kind !== 'acp' || !isUnsupportedBoundPluginEngineOverride(err)) throw err;
    var existing = await schedulesForPr(card);
    if (existing.length > 0) throw err;
    // Older hosts or tasks that disallow explicit bound ACP overrides still accept
    // a bound schedule without model override fields, using the task's current model.
    return { schedule: await prSchedule('schedule_create', buildCardScheduleInput(card, null)), usedTaskModelFallback: true };
  }
}

// Save the intent first. After a lost receipt or a restart, look up the schedule
// before creating one. All local card operations already share the same queue.
async function syncCardSchedule(card, settings, start) {
  card.pending = start ? 'follow' : 'stop';
  card.scheduleAction = start ? 'start' : 'stop';
  card.managedFollow = true;
  if (!(await savePrCard(card))) { card.note = t('prSaveFailed'); return; }
  try {
    var rows = start ? await schedulesForPr(card) : [];
    var requestedModel = start ? prSettingsForAgent(settings, true).follow_model : null;
    var usedTaskModelFallback = false;
    if (start && rows.length === 0) {
      var creationError;
      try {
        var created = await createCardSchedule(card, settings);
        usedTaskModelFallback = Boolean(created && created.usedTaskModelFallback);
      } catch (err) { creationError = err; }
      rows = await schedulesForPr(card);
      if (!rows.length) throw creationError || new Error('schedule_create');
    }
    if (start) {
      var row = rows.length === 1 && rows[0];
      if (!ownedFollowSchedule(row, card) || !row.id || row.status !== 'active') {
        card.pending = card.scheduleAction = null;
        throw new Error(t('prOwnershipUnknown'));
      }
      var saved = await prSchedule('schedule_get', { id: row.id });
      if (!ownedFollowSchedule(saved, card) || saved.status !== 'active' || saved.id !== row.id) throw new Error('schedule_get');
      card.scheduleId = row.id;
      card.scheduleStatus = null;
      card.followedEver = true;
      card.followNotice = (usedTaskModelFallback ||
        (requestedModel && requestedModel.model_agent_kind === 'acp' && !saved.modelAgentKind && !saved.model))
        ? t('prFollowModelFallback')
        : null;
    } else {
      var owned = await readOwnedFollowSchedule(card);
      if (owned) {
        await prSchedule('schedule_delete', { id: owned.id });
        if (await prSchedule('schedule_get', { id: owned.id })) throw new Error('schedule_delete');
      }
      card.scheduleId = null;
      card.scheduleStatus = null;
      card.followNotice = null;
    }
    card.following = start;
    card.pending = card.scheduleAction = null;
    card.scheduleError = null;
    card.note = null;
  } catch (err) {
    card.note = t('prScheduleFailed', { detail: String(err.message || err).slice(0, 160) });
    card.scheduleError = card.note;
    card.followNotice = null;
    // Stop stays pending until absence is verified, including when the delete receipt is lost.
    if (start) {
      try {
        var remaining = await schedulesForPr(card);
        if (!remaining.some(function (row) { return ownedFollowSchedule(row, card); })) {
          card.pending = card.scheduleAction = null;
        }
      } catch (_) {}
    }
  }
  await savePrCardRetry(card);
}

async function prCardTool(args, callId) {
  var a = args && typeof args === 'object' ? args : {};
  var sessionId = a.session_context && a.session_context.session_id;
  if (typeof sessionId !== 'string' || !sessionId) return fail(t('prOwnershipUnknown'));
  var repo = '';
  if (a.project_path) {
    if (typeof a.project_path !== 'string' || !PR_REPO_RE.test(a.project_path) ||
        a.project_path.split('/').some(function (part) { return part === '.' || part === '..'; })) return fail(t('prNeedRepo'));
    var connection = await resolveInstance(a);
    if (connection.err) return fail(connection.err);
    repo = connection.host + '/' + a.project_path;
  }
  var cardId = a.card_id !== undefined && a.card_id !== null && a.card_id !== '' ? String(a.card_id) : '';
  if (cardId && !PR_CARD_ID_RE.test(cardId)) return fail(t('prBadCardId'));

  var notes = [];
  var card = cardId ? await readPrCard(cardId) : null;
  if (cardId && !card) notes.push(t('prCardNotFound'));
  var updating = Boolean(card);
  var ref = null;
  if (a.mr !== undefined && a.mr !== null && a.mr !== '') {
    // 只给编号时,仓库取参数或卡片上记的那个。
    ref = parsePrRef(a.mr, repo || (card ? card.repo : ''));
    if (!ref || (repo && ref.repo.toLowerCase() !== repo.toLowerCase())) return fail(t('prBadPr'));
  }
  if (card && card.sessionId && card.sessionId !== sessionId) {
    if (!ref && card.pr) ref = { repo: card.repo, number: card.pr.number };
    if (!repo) repo = card.repo;
    card = null;
    updating = false;
  }
  if (card && repo && card.repo.toLowerCase() !== repo.toLowerCase()) return fail(t('prBadCardId'));
  if (card && ref && card.pr && (card.repo.toLowerCase() !== ref.repo.toLowerCase() || card.pr.number !== ref.number)) {
    return fail(t('prBadCardId'));
  }
  var owner = await findPrCardOwner(ref ? ref.repo : repo || (card && card.repo) || '',
    ref ? ref.number : card && card.pr ? card.pr.number : null,
    prText(a.head) || (card && card.head), card && card.id, sessionId);
  if (owner) {
    if (!owner.sessionId && (!card || card.id !== owner.id)) return fail(t('prOwnershipUnknown'));
    if (owner.sessionId && owner.sessionId !== sessionId) {
      // Reuse a local card even when a different task currently holds the follow-up.
      var local = card || await findPrCardOwner(owner.repo, owner.pr && owner.pr.number,
        owner.head, null, sessionId, true);
      return prOtherTask(owner, callId, sessionId, local, a.to_latest === true,
        a.claim_follow === true || typeof a.following === 'boolean');
    }
    card = owner;
    updating = true;
  }
  if (card && !card.pr && ref && card.repo.toLowerCase() !== ref.repo.toLowerCase()) return fail(t('prBadCardId'));
  if (!card) {
    if (!repo && !ref) return fail(t('prNeedRepo'));
    if (!ref && !prText(a.head)) return fail(t('prNeedHead'));
    card = newPrCard(callId, repo);
  }
  card.sessionId = sessionId;
  if (ref) card.repo = ref.repo;
  else if (repo) card.repo = repo;
  if (prText(a.head)) card.head = prText(a.head);
  if (prText(a.base)) card.base = prText(a.base);
  if (a.commits !== undefined) card.commits = prCount(a.commits);
  if (a.files !== undefined) card.files = prFiles(a.files);
  if (a.files_total !== undefined) card.filesTotal = prCount(a.files_total);
  if (typeof a.renamed === 'boolean') {
    card.renamed = a.renamed;
  }
  card.note = card.scheduleError || null;

  var number = ref ? ref.number : card.pr ? card.pr.number : null;
  if (number) {
    var status = await fetchPrStatus(card.repo, number, callId);
    if (status.err) {
      // 读不到这条 PR 的状态又没有旧快照时不凭空画一张「开放、非草稿」的卡:状态未知,让 Agent 稍后重试。
      if (!card.pr || card.pr.number !== number) return fail(t('prFetchFailed', { detail: status.err }));
      notes.push(t('prFetchFailed', { detail: status.err }));
    }
    updatePrMergeStatus(card, status);
    if (status.pr) {
      card.readyUncertain = false;
      // The PR was read: a 'ready' left by a mark-ready flow whose last save was lost is over (nothing runs concurrently).
      if (card.pending === 'ready') card.pending = null;
    }
    card.stage = card.pr.state === 'merged' ? 'merged' : card.pr.state === 'closed' ? 'closed' : 'open';
    card.queued = false;
    if (ref && a.published === true) card.publishedHere = true;
  } else if (card.stage === 'publishing') {
    // 发布没成功,Agent 不带 pr 再调一次:卡片回到询问。
    card.stage = 'ask';
  }

  var canFollow = prCanFollow(card);
  var stopSchedule = prShouldStopSchedule(card, !!status && !status.err);
  if (card.stage !== 'open' && !card.scheduleAction && !stopSchedule) card.pending = null;
  if (!stopSchedule && card.scheduleId && hasCardScheduler() && !card.scheduleAction) {
    try {
      var currentSchedule = await prSchedule('schedule_get', { id: card.scheduleId });
      if (currentSchedule && !ownedFollowSchedule(currentSchedule, card))
        return fail(t('prScheduleFailed', { detail: t('prOwnershipUnknown') }));
      if (currentSchedule && a.following === false) return fail(t('prScheduleFailed', { detail: currentSchedule.status }));
      if (currentSchedule && a.following === true && currentSchedule.status !== 'active')
        return fail(t('prScheduleFailed', { detail: currentSchedule.status }));
      card.following = !!currentSchedule && currentSchedule.status === 'active';
      card.scheduleStatus = currentSchedule && !card.following ? currentSchedule.status : null;
      if (!card.following || (currentSchedule && currentSchedule.modelAgentKind)) card.followNotice = null;
      if (!currentSchedule) {
        card.scheduleId = null;
        if (a.following === true) return fail(t('prScheduleFailed', { detail: 'schedule_get' }));
      }
    } catch (err) { return fail(t('prScheduleFailed', { detail: String(err.message || err) })); }
  }
  if (!stopSchedule && hasCardScheduler() && typeof a.following === 'boolean' &&
      (card.scheduleAction || (a.following && !card.scheduleId))) {
    return fail(t('prScheduleFailed', { detail: 'schedule_get' }));
  }
  if (!stopSchedule && typeof a.following === 'boolean') {
    card.following = a.following;
    card.scheduleAction = null;
    if (!a.following) { card.scheduleId = card.scheduleStatus = null; card.followNotice = null; }
    if (a.following) card.followedEver = true;
    if (card.pending === 'follow' || card.pending === 'stop') card.pending = null;
  }

  // A claim is permission to create a schedule, not a report that one already exists.
  // Keep stop reservations until deletion is confirmed; contradictory requests never reacquire.
  var pendingBefore = card.pending;
  if (a.claim_follow === true && a.following !== false && canFollow && !card.scheduleAction &&
      card.pending !== 'stop' && !card.following && !card.scheduleId) {
    card.pending = 'follow';
  }

  var settings = await readPrSettings();
  var todo = [];
  var nativeStart = false;
  var settingsAppliedBefore = card.settingsApplied;
  var applyPublishedSettings = card.publishedHere === true && card.stage === 'open' && !card.settingsApplied;
  if (applyPublishedSettings && a.following === false) card.skipPublishedFollow = true;
  if (applyPublishedSettings && settings.unreadable) {
    // Unreadable settings are not "all off": keep the one-time to-do list for the next call.
    notes.push(t('prSettingsLater'));
  }
  if (applyPublishedSettings && !settings.unreadable && !status.err) {
    card.settingsApplied = true;
    card.renameRequested = settings.autoRename;
    if (prShouldAutoFollow(card, settings)) {
      card.pending = 'follow';
      nativeStart = hasCardScheduler();
      if (!nativeStart) todo.push(t('prTodoFollow', { url: card.pr.url }));
    }
  }

  if (card.renameRequested && !card.renamed && card.stage === 'open' && !settings.unreadable && settings.autoRename) {
    todo.push(t('prTodoRename', { title: prTaskTitle(card) }));
  }

  if (stopSchedule) {
    await syncCardSchedule(card, settings, false);
  } else if (hasCardScheduler() && (nativeStart || card.scheduleAction === 'start')) {
    if (settings.unreadable || status.err) {
      card.note = settings.unreadable ? t('prSettingsUnreadable') : t('prFetchFailed', { detail: status.err });
      notes.push(card.note);
      card.scheduleAction = 'start';
    } else if (canFollow) {
      await syncCardSchedule(card, settings, true);
    }
  }
  if (card.stage !== 'open') card.followNotice = null;
  var activeFollowNotice = card.stage === 'open' && card.following ? card.followNotice : null;
  if (activeFollowNotice && !notes.includes(activeFollowNotice)) notes.push(activeFollowNotice);
  if (card.note && !notes.includes(card.note)) notes.push(card.note);
  var movedFrom = updating && a.to_latest === true && prAnchor(card) !== callId ? await movePrCard(card, callId) : null;
  // 状态没存上时按钮点了找不到记录:不显示卡片,让 Agent 稍后重试。
  if (!(await savePrCard(card))) return fail(t('prSaveFailed'));
  if (movedFrom) await sendPrMovedStub(card, movedFrom, callId);
  var delivered = await sendPrCard(card, settings, updating && !movedFrom ? callId : null);
  if (!updating) await prunePrCards();
  // A follow claim or a start/stop report is a state operation: its answer matters even where no card can be shown (IM).
  var stateOp = a.claim_follow === true || typeof a.following === 'boolean';
  // The state is saved but the card did not reach the conversation: do not report a card the user cannot see.
  if (!delivered && !stateOp && !nativeStart && !card.managedFollow) {
    // The retry must produce the same to-do list again, so the one-time settings are not used up by this call.
    // No permission to follow was handed out either, so a reservation added by this call must not keep other tasks out.
    var released = card.pending !== pendingBefore;
    if (released) card.pending = pendingBefore;
    if (card.settingsApplied !== settingsAppliedBefore || released) {
      card.settingsApplied = settingsAppliedBefore;
      await savePrCardRetry(card);
    }
    return fail(t('prCardNotDelivered'));
  }

  var result = {
    card_id: card.id,
    stage: card.stage === 'open' && card.pr.draft ? 'draft' : card.stage,
    settings: prSettingsForAgent(settings, settings.autoFollow),
  };
  if (nativeStart || card.scheduleId || card.scheduleAction || card.managedFollow) {
    if (card.scheduleAction) result.follow_state = 'unverified';
    else if (card.following) result.follow_state = 'active';
    else if (card.scheduleStatus === 'paused') result.follow_state = 'paused';
    else result.follow_state = card.scheduleError ? 'failed' : 'stopped';
  }
  if (activeFollowNotice) result.follow_model_fallback = true;
  if (!delivered) { result.card_shown = false; notes.push(t('prCardNotShown')); }
  if (a.claim_follow === true) result.follow_claimed = a.following !== false && canFollow &&
    !card.scheduleAction && !card.scheduleId && card.pending === 'follow';
  if (card.pr) {
    result.mr = { number: card.pr.number, title: card.pr.title, url: card.pr.url, state: card.pr.state, draft: card.pr.draft };
  }
  if (todo.length) {
    result.todo = todo;
    result.next = t('prNextApply');
  } else {
    result.next = card.stage === 'ask' ? t('prNextAsk') : t('prNextUpdated');
  }
  if (notes.length) result.note = notes.join(' ');
  return { ok: true, result: result };
}

/* ── 卡片按钮 ── */

var PR_AGENT_ACTIONS = {
  'pr:publish': function (card) { return card.stage === 'ask'; },
  'pr:draft': function (card) { return card.stage === 'ask'; },
  'pr:follow': function (card) { return prCanStartFollow(card) && !card.pending; },
  'pr:stop': function (card) { return card.stage === 'open' && (card.following || card.scheduleId) && !card.pending; },
};

/**
 * 把点击交给本任务的 Agent。返回 ok=true 已交出;ok=false 未交出;
 * unknown=true 宿主没给明确结果(可能已交出),卡片据此提示用户先看对话、别重复点。
 */
async function handOffPr(card, action, settings, msg, taskUrl) {
  if (!msg.userActionToken || !cindy.agent || typeof cindy.agent.run !== 'function') return { ok: false };
  var url = card.pr ? card.pr.url : '';
  var text;
  if (action === 'pr:publish') text = t('prClickPublish');
  else if (action === 'pr:draft') text = t('prClickPublishDraft');
  else if (action === 'pr:follow') text = msg.afterReady ? t('prReadyFollow', { url: url }) : t('prClickFollow', { url: url });
  else if (action === 'pr:open-task') text = t('prClickOpenTask', { url: taskUrl });
  else text = t('prClickStop', { url: url });
  var event = Object.assign({ card_id: card.id, action: action.slice(3) }, mrApiArgs(card.repo, card.pr && card.pr.number));
  if (action === 'pr:open-task') event.task_url = taskUrl;
  if (card.pr) {
    event.mr_number = card.pr.number;
    event.mr_url = url;
    // 插件替用户把草稿转了正式:告诉 Agent,免得它以为是用户在 GitLab 上改的。
    if (card.markedReady) event.marked_ready_on_card = true;
    if (action === 'pr:follow' && settings.followModel) event.follow_model = prSettingsForAgent(settings, true).follow_model;
  } else {
    event.head = card.head;
    if (card.base) event.base = card.base;
    event.settings = prSettingsForAgent(settings, settings.autoFollow && action === 'pr:publish');
  }
  var r;
  try {
    r = await cindy.agent.run({
      mode: 'continue',
      userActionToken: msg.userActionToken,
      promptTemplate: PR_TRIGGER + '{{user_message}}\n{{event_json}}',
      userMessage: text,
      event: event,
    });
  } catch (e) {
    return { ok: false, unknown: true };
  }
  if (r && r.ok === true) return { ok: true, queued: r.disposition === 'queued' };
  return r && r.ok === false ? { ok: false } : { ok: false, unknown: true };
}

/**
 * 草稿转正式:插件直接调 GitLab,不经过 Agent。成功后按卡片设置决定是否把跟进交给 Agent。
 * 写操作失败时重读一次状态,以 GitLab 上的实际结果为准(请求可能已生效、只是回包丢了)。
 */
async function markPrReady(card, settings, msg) {
  var progress = { sent: false, rejected: false, handedOff: false };
  try {
    await markPrReadyInner(card, settings, msg, progress);
  } catch (e) {
    // An exception after the write went out (network, re-read, save) says nothing about whether GitLab did it.
    // If the follow-up was already handed to the agent, the card stays in that in-progress state.
    card.pending = progress.handedOff ? 'follow' : null;
    card.readyUncertain = !progress.handedOff && progress.sent && !progress.rejected;
    card.note = progress.handedOff ? t('prHandedOffSaveFailed') : progress.sent && !progress.rejected
      ? t('prReadyUnknown')
      : t('prReadyFailed', { detail: String(e && e.message ? e.message : e).slice(0, 160) });
    try { await savePrCard(card); } catch (e2) { /* the card is redrawn below either way */ }
    await sendPrCard(card, settings, null);
  }
}

async function markPrReadyInner(card, settings, msg, progress) {
  card.pending = 'ready';
  // 记不下「进行中」就不发外部写操作:之后无从核对结果。
  if (!(await savePrCard(card))) {
    card.pending = null;
    card.note = t('prSaveFailed');
    await sendPrCard(card, settings, null);
    return;
  }
  await sendPrCard(card, settings, null);
  var current = await fetchPrStatus(card.repo, card.pr.number);
  var err = current.err;
  var confirmedReady = current.pr && !current.pr.draft;
  var sent = false, rejected = false;
  if (current.pr && current.pr.state === 'open' && current.pr.draft) {
    // GitLab's quick action edits the draft flag server-side, preserving concurrent title edits.
    var args = mrApiArgs(card.repo, card.pr.number);
    args.body = '/ready';
    sent = progress.sent = true;
    var mutation = await OPS.add_merge_request_comment.run(args);
    err = mutation.err;
  }
  var fresh = await fetchPrStatus(card.repo, card.pr.number);
  if (fresh.pr) {
    card.pr = fresh.pr;
    card.stage = card.pr.state === 'merged' ? 'merged' : card.pr.state === 'closed' ? 'closed' : 'open';
  } else if (confirmedReady) {
    // 重读失败,但写请求的回包已经确认转成了正式:按回包记下,不沿用旧的草稿快照。
    card.pr.draft = false;
  }
  card.pending = null;
  card.readyUncertain = false;
  if (!card.pr.draft) card.markedReady = true;
  if (card.pr.draft) {
    // 重读到的状态才算准;读不到时,写请求发出过又没被服务端明确拒绝就是不确定,要用户先核对。
    var uncertain = !fresh.pr && sent && !rejected;
    // Not sure whether GitLab did it: no button to press again until the PR has been read successfully.
    card.readyUncertain = uncertain;
    card.note = uncertain
      ? t('prReadyUnknown')
      : t('prReadyFailed', { detail: String(err || fresh.err || '').slice(0, 160) });
  } else if (prShouldAutoFollow(card, settings) && hasCardScheduler()) {
    await syncCardSchedule(card, settings, true);
  } else if (prShouldAutoFollow(card, settings)) {
    // Record "following is starting" before handing it to the agent, as the first step does for "ready":
    // if that cannot be saved, nothing is sent, so a later click can never send it a second time.
    card.pending = 'follow';
    if (!(await savePrCard(card))) {
      card.pending = null;
      card.note = t('prSaveFailed');
    } else {
      var handoff = await handOffPr(card, 'pr:follow', settings, Object.assign({}, msg, { afterReady: true }));
      // An unclear result may still have been delivered: treat it as handed off, never as "not sent".
      progress.handedOff = handoff.ok || handoff.unknown === true;
      if (!progress.handedOff) {
        // A clear refusal: the saved 'follow' is wrong now, so write it back before anything else can fail.
        card.pending = null;
        await savePrCardRetry(card);
      }
      if (handoff.unknown) card.note = t('prHandoffUnknown');
      else if (!handoff.ok) card.note = t('prHandoffFailed');
    }
  }
  if (!(await savePrCard(card))) {
    // The record may still say 'ready' or 'follow'. 'ready' is stale (nothing runs concurrently) and is refreshed
    // from GitLab at the next click or update; a 'follow' that was handed off is cleared by the agent's update.
    card.note = t('prSaveFailed');
  }
  await sendPrCard(card, settings, null);
}

async function prCardAction(msg) {
  var id = String(msg.callId || '');
  if (!PR_CARD_ID_RE.test(id)) return;
  var card = await readPrCard(id);
  if (!card) return;
  if (card.sessionId && card.sessionId !== msg.sessionId) return;
  var action = String(msg.actionId || '');
  var settings = await readPrSettings();
  var active = await findPrCardOwner(card.repo, card.pr && card.pr.number, card.head, card.id, card.sessionId);
  if (active && prFollowActive(active) && active.sessionId !== card.sessionId) {
    // Legacy clients use the existing click handoff to provide a normal task link.
    // Re-resolve the active task at click time; never start/stop or transfer follow-up.
    if (action === 'pr:open-task' && active.sessionId) {
      var navigation = await handOffPr(card, action, settings, msg, 'cindy://session/' + encodeURIComponent(active.sessionId));
      card.note = navigation.unknown ? t('prHandoffUnknown') : navigation.ok ? null : t('prHandoffFailed');
      await savePrCard(card);
    }
    await sendPrCard(card, settings, null);
    return;
  }
  if (action.startsWith('pr:merge')) return prMergeAction(card, settings, msg, action);
  // Card actions run one at a time, so a mark-ready flow cannot be running now: a 'ready' left in the record
  // means its final save was lost. Read the PR again to find the real state before acting.
  if (card.pending === 'ready' && card.pr) {
    var current = await fetchPrStatus(card.repo, card.pr.number);
    if (current.pr) {
      card.pr = current.pr;
      card.stage = card.pr.state === 'merged' ? 'merged' : card.pr.state === 'closed' ? 'closed' : 'open';
      card.pending = null;
      card.readyUncertain = false;
    }
  }
  card.note = null;
  var handedOff = false;
  var nextUpdateAt = 0;
  if (action === 'prui:settings' && prHasSettings(card)) {
    card.settingsOpen = !card.settingsOpen;
  } else if (action === 'prset:rename' || action === 'prset:follow' || action === 'prset:archive') {
    try {
      settings = await togglePrSetting(action === 'prset:rename' ? 'autoRename' : action === 'prset:follow' ? 'autoFollow' : 'autoArchive');
    } catch (e) {
      card.note = t('prSettingFailed');
    }
  } else if (action === 'prset:model' && settings.followModel) {
    // 已经是「指定模型」:不重复打开选择器,换模型点下面的模型名。
  } else if (action === 'prset:model' && settings.lastFollowModel) {
    try {
      settings = await writePrSettings(function (next) { next.followModel = next.lastFollowModel; });
    } catch (e) {
      card.note = t('prSettingFailed');
    }
  } else if (action === 'prset:modelPick' && msg.modelSelection) {
    // 新版宿主在卡内下拉框里已选好(并核对过可用),直接记下。
    try {
      var chosen = await savePrFollowModel(settings, msg.modelSelection);
      settings = chosen.settings;
      if (chosen.error) card.note = t('prFollowModelFailed', { detail: chosen.error });
    } catch (e) {
      card.note = t('prSettingFailed');
    }
  } else if ((action === 'prset:model' || action === 'prset:modelPick') && typeof cindy.pickModel === 'function') {
    try {
      var picked = await pickPrFollowModel(settings, msg);
      settings = picked.settings;
      if (picked.error) card.note = t('prFollowModelFailed', { detail: String(picked.error).slice(0, 120) });
    } catch (e) {
      card.note = t('prSettingFailed');
    }
  } else if (action === 'prset:modelTask') {
    try {
      settings = await writePrSettings(function (next) { next.followModel = null; });
    } catch (e) {
      card.note = t('prSettingFailed');
    }
  } else if (action === 'pr:ready' && card.stage === 'open' && card.pr.draft && !card.following && !card.pending && !card.readyUncertain) {
    await markPrReady(card, settings, msg);
    return;
  } else if (msg.userActionToken && hasCardScheduler() && (action === 'pr:follow' ||
      action === 'pr:stop' && card.scheduleId) && PR_AGENT_ACTIONS[action](card)) {
    if (settings.unreadable && action === 'pr:follow') card.note = t('prSettingsUnreadable');
    else if (action === 'pr:stop') await syncCardSchedule(card, settings, false);
    else {
      var latest = await fetchPrStatus(card.repo, card.pr.number);
      if (latest.err) card.note = t('prFetchFailed', { detail: latest.err });
      else {
        card.pr = latest.pr;
        card.stage = latest.pr.state;
        if (prCanFollow(card)) await syncCardSchedule(card, settings, true);
      }
    }
  } else if (PR_AGENT_ACTIONS[action] && PR_AGENT_ACTIONS[action](card)) {
    var publishing = action === 'pr:publish' || action === 'pr:draft';
    if ((publishing || action === 'pr:follow') && settings.unreadable) {
      // The settings (and the chosen follow model) travel with the request; sending "everything off" for a read
      // that failed would be wrong.
      card.note = t('prSettingsUnreadable');
    } else {
      // Record the in-progress state before handing the click to the agent: if it cannot be saved nothing is sent,
      // and if the handoff then goes through and a later save is lost, the record already blocks a second send.
      var before = { stage: card.stage, publishingDraft: card.publishingDraft, queued: card.queued, settingsOpen: card.settingsOpen, pending: card.pending };
      var restoreCard = function () { Object.assign(card, before); };
      if (publishing) {
        card.stage = 'publishing';
        card.publishingDraft = action === 'pr:draft';
        card.settingsOpen = false;
      } else {
        card.pending = action === 'pr:follow' ? 'follow' : 'stop';
      }
      if (!(await savePrCard(card))) {
        restoreCard();
        card.note = t('prSaveFailed');
      } else {
        // The phone's delivery receipt only covers dispatch to this plugin. Show the saved
        // state while the task is waking up. Ownership was checked in this serialized action.
        if (publishing && await deliverPrCard(card, settings, null, null)) {
          // The host accepts one update per second on the same click.
          nextUpdateAt = Date.now() + 1000;
        }
        var handoff = await handOffPr(card, action, settings, msg);
        // An unclear result (the call threw, or no verdict) may still have reached the agent: keep the in-progress
        // state with its note, so the same action cannot be sent twice. Only a clear refusal restores the buttons.
        handedOff = handoff.ok || handoff.unknown === true;
        if (!handedOff) {
          restoreCard();
          await savePrCardRetry(card);
        } else if (publishing) {
          card.queued = handoff.queued === true;
        }
        if (handoff.unknown) card.note = t('prHandoffUnknown');
        else if (!handoff.ok) card.note = t('prHandoffFailed');
      }
    }
  }
  var recorded = await savePrCard(card);
  // A normal handoff leaves the working card exactly as shown.
  if (recorded && nextUpdateAt && handedOff && !card.queued && !card.note) return;
  var wait = nextUpdateAt - Date.now();
  if (wait > 0) await new Promise(function (resolve) { setTimeout(resolve, wait); });
  if (!recorded) {
    if (handedOff) {
      // 点击已经交给 Agent:卡片不能退回有按钮的旧状态,否则用户会把同一件事再派一遍。
      // 画交出后的进行中状态(没有操作按钮)并提示先看对话;Agent 之后用 card_id 回写时仍读到旧记录,照常更新。
      card.note = t('prHandedOffSaveFailed');
      await sendPrCard(card, settings, null);
      return;
    }
    // 没存上就不显示新状态(按钮会和记录对不上):重画已保存的那一版并提示。
    var saved = await readPrCard(id);
    if (!saved) return;
    saved.note = t('prSaveFailed');
    await sendPrCard(saved, settings, null);
    return;
  }
  // 原地更新被点的卡片:交给 Agent 的动作报 working 直到它用 mr_card 回写结果,其余点击报 done 立即结束。
  await sendPrCard(card, settings, null);
}


/* ── 设置页测试连接(BroadcastChannel;settings.js 先 /wake 再广播) ── */

var bc = new BroadcastChannel('cindy-gitlab');
var seenTestReqs = {};

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
      void cindy.send({ type: 'notify', text: 'GitLab 连接测试失败:' + String(inst.err).slice(0, 150), tone: 'error' });
      return;
    }
    var r = await api({ url: 'https://' + inst.host + '/api/v4/user' });
    if (r.err) {
      bc.postMessage({ type: 'test-connection-result', reqId: m.reqId, ok: false, message: r.err });
      // 结果同时走系统提示(notify 槽,主机画壳带身份头):失败也报,tone 区分。
      // 限速 5 秒内的重复点击会被主机拒(ok:false),页面内 status 仍在,不补救。
      void cindy.send({ type: 'notify', text: 'GitLab 连接测试失败:' + String(r.err).slice(0, 150), tone: 'error' });
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
    void cindy.send({ type: 'notify', text: '连接成功:@' + username + '(' + inst.host + ')', tone: 'success' });
  })();
};

/* ── 派单 ──────────────────────────────────────────────────────────── */

cindy.onHostMessage(async function (msg) {
  if (msg && msg.type === 'host-context-changed') {
    hostLocale = normalizeLocale(msg.context && msg.context.locale);
    return;
  }
  if (msg && msg.type === 'event' && msg.name === 'card-action') {
    try {
      await ensureLocale();
      await enqueuePr(function () { return prCardAction(msg); });
    } catch (e) {
      // 点击没有回执通道;卡片保持上一版,宿主的「运行中」由超时兜底收口。
    }
    return;
  }
  if (!msg || msg.type !== 'tool-call') return;
  try {
    if (msg.tool === 'mr_card' || msg.tool === 'mr_follow_settings') await ensureLocale();
    var r;
    if (msg.tool === 'list_tools') {
      r = listTools(msg.args || {});
    } else if (msg.tool === 'call_tool') {
      r = await callTool(msg.args || {}, msg.callId);
    } else if (msg.tool === 'mr_follow_settings') {
      var settings = await readPrSettings();
      r = settings.unreadable
        ? fail(t('prSettingsReadFailed'))
        : { ok: true, result: { settings: prSettingsForAgent(settings, settings.autoFollow) } };
    } else if (msg.tool === 'mr_card') {
      r = await enqueuePr(function () { return prCardTool(msg.args || {}, msg.callId); });
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
