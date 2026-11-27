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
  if (status === 401) return 'GitLab token 未配置或已失效,请到主界面侧边栏「插件」→「GitLab」详情页重新填写该实例的 token,或在本机运行 glab auth login 重新登录';
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
    return { err: '尚未连接任何 GitLab 实例——请用户到主界面侧边栏「插件」→「GitLab」详情页添加实例地址与 Personal Access Token,或在本机用 glab auth login 登录' };
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

/* ── 自动化事件(routineEvents) ─────────────────────────────────────────
 *
 * GitLab 没有推送给本机的通道,这里按自动化的订阅轮询。订阅(只有事件类型与
 * 「只看」条件)启动时向宿主取一次(routine-request subscriptions),之后用户改
 * 自动化时宿主主动推送(routine-subscriptions),插件不再反复询问;没有订阅时
 * 不轮询。只去盯被选中的对象——
 * - 条件里有 project + iid:只读这一个 MR / Issue(含流水线状态);
 * - 只有 project:先读一次项目动态,有新动态才读有更新的 MR / Issue 和流水线;
 *   动态不记录的改动(改标题、标签,重跑流水线等)每 5 分钟完整核对一次补上;
 * - 都没有:读与连接账号相关的 MR / Issue(我创建的、指派给我的、请我审阅的)。
 * 第一次看到的对象只记基线不发事件;之后按状态变化、新提交、新评论等发布事件。
 * 匹配和要不要处理仍由宿主与自动化决定,这里不替用户丢弃(包括自己发的评论,
 * 用 fromSelf 标出)。电脑休眠或插件停止期间的变化不补发。
 * 旧宿主不认识 subscriptions 时整段不运行。
 */

var EVENTS_POLL_MS = 60 * 1000;
/** 整个项目:每隔几个周期不看项目动态、完整核对一次。 */
var EVENTS_SWEEP_EVERY = 5;
/** 还没出结果的流水线状态:有这样的流水线时每个周期都看流水线。 */
var EVENTS_PIPELINE_ACTIVE = { created: 1, waiting_for_resource: 1, preparing: 1, pending: 1, running: 1 };
/** 每个周期最多发布多少条(宿主单插件 60 次/分钟),剩下的留到下个周期。 */
var EVENTS_PUBLISH_PER_CYCLE = 40;
var EVENTS_MAX_TARGETS = 50;
var EVENTS_MAX_CHANGED_PER_TARGET = 20;
var EVENTS_SNAPSHOT_LIMIT = 5000;
/** 流水线只在出结果时发事件(排队、运行中不发,避免一次流水线叫醒多轮)。 */
var EVENTS_PIPELINE_DONE = { success: 1, failed: 1, canceled: 1, skipped: 1 };
var EVENTS_PIPELINE_LOOKUPS = 10;
var EVENTS_LIST_PER_PAGE = 50;
var EVENTS_NOTES_PER_PAGE = 100;
var EVENTS_MAX_PAGES = 20;
var EVENTS_MAX_NOTE_PAGES = 1000;
var EVENTS_PENDING_LIMIT = 500;

var eventsState = {
  stopped: false, timer: null, running: false, status: null,
  snapshots: {}, cursors: {}, pending: [], users: {},
  subscriptions: null, wake: false, cycle: 0,
  activity: {}, pipelinesActive: {}, rechecked: {}, targetBacklog: {},
};

function eventsTimeMs(iso) {
  var t = iso ? Date.parse(iso) : NaN;
  return isFinite(t) ? t : 0;
}

function eventsTextHash(text) {
  var s = typeof text === 'string' ? text : '';
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return s.length + ':' + h;
}

function eventsGetSnap(cursorKey, itemId) {
  var map = eventsState.snapshots[cursorKey];
  return map ? (map.get(String(itemId)) || null) : null;
}

function eventsRemember(cursorKey, itemId, snap, protectFromMs) {
  var map = eventsState.snapshots[cursorKey];
  if (!map) { map = new Map(); eventsState.snapshots[cursorKey] = map; }
  var id = String(itemId);
  if (map.has(id)) map.delete(id);
  map.set(id, snap);
  if (map.size > EVENTS_SNAPSHOT_LIMIT) {
    var floor = typeof protectFromMs === 'number' ? protectFromMs : 0;
    for (var it = map.entries(), st = it.next(); !st.done && map.size > EVENTS_SNAPSHOT_LIMIT; st = it.next()) {
      var v = st.value[1];
      if (v && (v.notesIncomplete || v.pending || eventsTimeMs(v.updatedAt) >= floor)) continue;
      map.delete(st.value[0]);
    }
  }
}

/** 订阅 → 要盯的对象。只认 equals 条件里的 host / project / iid / kind。 */
function eventsTargetsFrom(subscriptions) {
  var byKey = {};
  var list = [];
  for (var i = 0; i < subscriptions.length; i++) {
    var sub = subscriptions[i] || {};
    var eq = {};
    var filters = Array.isArray(sub.filters) ? sub.filters : [];
    for (var j = 0; j < filters.length; j++) {
      var f = filters[j];
      if (f && f.operator === 'equals' && (f.field === 'host' || f.field === 'project' || f.field === 'iid' || f.field === 'kind')) {
        eq[f.field] = String(f.value).trim().toLowerCase();
      }
    }
    var events = Array.isArray(sub.events) ? sub.events : [];
    var pipelines = Boolean(eq.project) && (!events.length || events.indexOf('merge_request.pipeline') >= 0);
    var kinds = {};
    if (eq.kind === 'mr' || eq.kind === 'issue') kinds[eq.kind] = true;
    else if (events.length) {
      for (var k = 0; k < events.length; k++) {
        var ev = String(events[k]);
        if (ev === 'merge_request.pipeline' && !eq.project) continue;
        if (ev.indexOf('merge_request.') === 0) kinds.mr = true;
        else if (ev.indexOf('issue.') === 0) kinds.issue = true;
      }
    } else { kinds.mr = true; kinds.issue = true; }
    if (!kinds.mr && !kinds.issue) continue;
    var iid = eq.project && /^[1-9][0-9]{0,9}$/.test(eq.iid || '') ? eq.iid : '';
    var key = (eq.host || '*') + '|' + (eq.project || '@me') + '|' + iid;
    var target = byKey[key];
    if (!target) {
      if (list.length >= EVENTS_MAX_TARGETS) continue;
      target = { key: key, host: eq.host || '', project: eq.project || '', iid: iid, kinds: {}, pipelines: false };
      byKey[key] = target;
      list.push(target);
    }
    if (kinds.mr) target.kinds.mr = true;
    if (kinds.issue) target.kinds.issue = true;
    if (kinds.mr && pipelines && target.project) target.pipelines = true;
  }
  return list;
}

async function eventsConnections() {
  var list = await (await fetch('/connections')).json();
  for (var i = 0; Array.isArray(list) && i < list.length; i++) {
    if (list[i] && list[i].key === CONNECTION_KEY && Array.isArray(list[i].connections)) return list[i].connections;
  }
  return [];
}

function eventsConnectionsFor(target, conns) {
  if (target.host) return conns.filter(function (c) { return c.host === target.host; });
  if (!target.project) return conns;
  for (var i = 0; i < conns.length; i++) if (conns[i].isDefault) return [conns[i]];
  return conns.length === 1 ? [conns[0]] : [];
}

async function eventsMe(conn) {
  if (eventsState.users[conn.id]) return eventsState.users[conn.id];
  var r = await api({ url: 'https://' + conn.host + '/api/v4/user' });
  if (r.err) { if (/HTTP 40[134]/.test(r.err)) return null; throw new Error(r.err); }
  if (!r.data || !r.data.username) return null;
  eventsState.users[conn.id] = { id: r.data.id, username: String(r.data.username) };
  return eventsState.users[conn.id];
}

function eventsPendingHas(id) {
  for (var i = 0; i < eventsState.pending.length; i++) if (eventsState.pending[i].id === id) return true;
  return false;
}

function eventsTryQueue(event) {
  if (eventsPendingHas(event.id)) return true;
  if (eventsState.pending.length >= EVENTS_PENDING_LIMIT) return false;
  eventsState.pending.push(event);
  return true;
}

function eventsCanQueueAll(events) {
  var needed = 0;
  var seen = {};
  for (var i = 0; i < events.length; i++) {
    var id = events[i].id;
    if (!seen[id] && !eventsPendingHas(id)) { seen[id] = 1; needed++; }
  }
  return eventsState.pending.length + needed <= EVENTS_PENDING_LIMIT;
}

function eventsBase(conn, kind, item, me) {
  var project = String((item.references && item.references.full ? item.references.full.replace(/[!#][0-9]+$/, '') : '') ||
    (item.web_url ? item.web_url.replace(/^https?:\/\/[^/]+\//, '').replace(/\/-\/.*$/, '') : '')).toLowerCase();
  var data = { host: conn.host, project: project, iid: Number(item.iid), kind: kind, state: String(item.state || ''), url: String(item.web_url || '') };
  if (item.author && item.author.username) {
    data.author = String(item.author.username);
    if (me) data.authorIsSelf = data.author === me.username;
  }
  if (Array.isArray(item.labels) && item.labels.length) data.labels = item.labels.join(',').slice(0, 500);
  if (kind === 'mr') {
    if (item.source_branch) data.sourceBranch = String(item.source_branch);
    if (item.target_branch) data.targetBranch = String(item.target_branch);
    if (item.sha) data.sha = String(item.sha);
    data.draft = Boolean(item.draft || item.work_in_progress);
  }
  return data;
}

function eventsRef(data) { return data.project + (data.kind === 'mr' ? '!' : '#') + data.iid; }

function eventsBuildEvent(type, idSuffix, verb, item, data, extra, occurredAt) {
  var payload = Object.assign({}, data, extra || {});
  var title = String(item.title || '').slice(0, 120);
  return {
    id: data.host + '/' + eventsRef(data) + ':' + idSuffix,
    type: (data.kind === 'mr' ? 'merge_request.' : 'issue.') + type,
    occurredAt: occurredAt || Date.now(),
    subject: (eventsRef(data) + ' ' + verb + (title ? ':' + title : '')).slice(0, 200),
    data: payload,
  };
}

function eventsItemUnchanged(prev, item) {
  if (!prev || prev.notesIncomplete || prev.updatedAt !== String(item.updated_at || '')) return false;
  if (item.head_pipeline && prev.pipeline !== String(item.head_pipeline.id) + ':' + String(item.head_pipeline.status)) return false;
  return true;
}

function eventsNoteWatermark(prev, baselineAt) {
  if (!prev) return { at: baselineAt, ids: null };
  if (typeof prev.noteAt === 'number') return { at: prev.noteAt, ids: Array.isArray(prev.noteIds) ? prev.noteIds : null };
  return { at: eventsTimeMs(prev.updatedAt), ids: null };
}

function eventsGetCursor(cursorKey, cycleStart) {
  if (!Object.prototype.hasOwnProperty.call(eventsState.cursors, cursorKey)) {
    return { firstRun: true, baselineAt: cycleStart, resumeAt: cycleStart, pages: null, verify: false };
  }
  var cur = eventsState.cursors[cursorKey];
  if (typeof cur === 'number') return { firstRun: false, baselineAt: cur, resumeAt: cur, pages: null, verify: false };
  return { firstRun: false, baselineAt: cur.baselineAt, resumeAt: cur.resumeAt, pages: cur.pages || null, verify: Boolean(cur.verify) };
}

function eventsSetCursor(cursorKey, baselineAt, resumeAt, pages, verify) {
  eventsState.cursors[cursorKey] = { baselineAt: baselineAt, resumeAt: resumeAt, pages: pages || null, verify: Boolean(verify) };
}

function eventsPeopleKey(list, single, ids) {
  var arr = Array.isArray(list) ? list : (single ? [single] : []);
  var out = [];
  for (var i = 0; i < arr.length; i++) if (arr[i]) out.push(String(arr[i].username || arr[i].id || arr[i]));
  if (!out.length && Array.isArray(ids)) for (var j = 0; j < ids.length; j++) out.push(String(ids[j]));
  return out.sort().join(',');
}

var EVENTS_DIFF_FIELDS = [
  ['sha', 'commits'], ['title', 'title'], ['desc', 'description'], ['labels', 'labels'],
  ['draft', 'draft'], ['targetBranch', 'targetBranch'], ['assignees', 'assignees'],
  ['reviewers', 'reviewers'], ['milestone', 'milestone'], ['flags', 'options'],
];

/** 一个对象的变化 → 待入队事件(不含评论)。prev 为空时结合 baselineAt 与系统记录还原基线后的首次更新。 */
function eventsDiff(conn, kind, item, me, prev, baselineAt, notesInfo) {
  var data = eventsBase(conn, kind, item, me);
  var updatedAt = eventsTimeMs(item.updated_at);
  var snap = {
    state: data.state,
    updatedAt: String(item.updated_at || ''),
    sha: data.sha || '',
    title: String(item.title || ''),
    desc: eventsTextHash(item.description),
    labels: Array.isArray(item.labels) ? item.labels.slice().sort().join(',') : '',
    draft: Boolean(data.draft),
    targetBranch: data.targetBranch || '',
    assignees: eventsPeopleKey(item.assignees, item.assignee, item.assignee_ids),
    reviewers: kind === 'mr' ? eventsPeopleKey(item.reviewers, null, item.reviewer_ids) : '',
    milestone: item.milestone ? String(item.milestone.id || item.milestone.iid || item.milestone.title || '') : String(item.milestone_id || ''),
    flags: [item.squash, item.discussion_locked, item.force_remove_source_branch, item.confidential, item.due_date]
      .map(function (v) { return v === undefined || v === null ? '' : String(v); }).join('|'),
    notes: Number(item.user_notes_count) || 0,
    pipeline: item.head_pipeline ? String(item.head_pipeline.id) + ':' + String(item.head_pipeline.status) : (prev ? prev.pipeline : ''),
    noteAt: prev && typeof prev.noteAt === 'number' ? prev.noteAt : updatedAt,
    noteIds: prev && Array.isArray(prev.noteIds) ? prev.noteIds.slice() : null,
    notesIncomplete: false,
  };
  var staged = [];
  var emit = function (type, idSuffix, verb, extra, occurredAt) {
    staged.push(eventsBuildEvent(type, idSuffix, verb, item, data, extra, occurredAt));
  };
  var actor = function (who) {
    var extra = {};
    if (who && who.username) { extra.actor = String(who.username); if (me) extra.fromSelf = extra.actor === me.username; }
    return extra;
  };
  if (!prev) {
    var opened = eventsTimeMs(item.created_at) >= baselineAt;
    if (opened) emit('opened', 'opened', '新建', actor(item.author), eventsTimeMs(item.created_at));
    var stateHandled = false;
    if (data.state === 'merged' && eventsTimeMs(item.merged_at) >= baselineAt) {
      emit('merged', 'merged', '已合并', actor(item.merged_by || item.merge_user), eventsTimeMs(item.merged_at));
      stateHandled = true;
    } else if (data.state === 'closed' && eventsTimeMs(item.closed_at) >= baselineAt) {
      emit('closed', 'closed:' + item.closed_at, '已关闭', actor(item.closed_by), eventsTimeMs(item.closed_at));
      stateHandled = true;
    } else if (!opened && data.state === 'opened' && notesInfo && notesInfo.reopenedAt >= baselineAt) {
      emit('reopened', 'reopened:' + item.updated_at, '重新打开', {}, notesInfo.reopenedAt);
      stateHandled = true;
    }
    if (!opened && !stateHandled && updatedAt >= baselineAt) {
      var pipeFinished = kind === 'mr' && item.head_pipeline && EVENTS_PIPELINE_DONE[String(item.head_pipeline.status)] &&
        eventsTimeMs(item.head_pipeline.updated_at || item.head_pipeline.finished_at || '') >= baselineAt;
      if (pipeFinished) {
        emit('pipeline', 'pipeline:' + snap.pipeline, '流水线' + String(item.head_pipeline.status), {
          pipelineId: Number(item.head_pipeline.id), pipelineStatus: String(item.head_pipeline.status),
        }, updatedAt);
      }
      if (!notesInfo || notesInfo.actionableCount === 0 || notesInfo.hasSystemChange) {
        emit('updated', 'updated:' + item.updated_at, '有更新', {}, updatedAt);
      }
    }
    return { snap: snap, events: staged };
  }
  if (prev.state !== data.state) {
    if (data.state === 'merged') emit('merged', 'merged', '已合并', actor(item.merged_by || item.merge_user), eventsTimeMs(item.merged_at) || updatedAt);
    else if (data.state === 'closed') emit('closed', 'closed:' + (item.closed_at || item.updated_at), '已关闭', actor(item.closed_by), eventsTimeMs(item.closed_at) || updatedAt);
    else if (data.state === 'opened' && prev.state === 'closed') emit('reopened', 'reopened:' + item.updated_at, '重新打开', {}, updatedAt);
  } else {
    var changes = [];
    for (var df = 0; df < EVENTS_DIFF_FIELDS.length; df++) {
      if (prev[EVENTS_DIFF_FIELDS[df][0]] !== snap[EVENTS_DIFF_FIELDS[df][0]]) changes.push(EVENTS_DIFF_FIELDS[df][1]);
    }
    if (changes.length || (prev.updatedAt !== snap.updatedAt && notesInfo && notesInfo.hasSystemChange)) {
      emit('updated', 'updated:' + item.updated_at, prev.sha !== snap.sha ? '有新提交' : '有更新', changes.length ? { changes: changes.join(',') } : {}, updatedAt);
    }
  }
  if (kind === 'mr' && snap.pipeline && snap.pipeline !== prev.pipeline && item.head_pipeline && EVENTS_PIPELINE_DONE[String(item.head_pipeline.status)]) {
    emit('pipeline', 'pipeline:' + snap.pipeline, '流水线' + String(item.head_pipeline.status), {
      pipelineId: Number(item.head_pipeline.id), pipelineStatus: String(item.head_pipeline.status),
    }, updatedAt);
  }
  return { snap: snap, events: staged };
}

/** 持续翻页读取 watermark 之后的全部评论记录(绝不中途静默截断);请求或分页异常直接抛出以保留重试位点。 */
async function eventsNotes(conn, kind, item, me, watermark) {
  var data = eventsBase(conn, kind, item, me);
  var seg = kind === 'mr' ? 'merge_requests' : 'issues';
  var collected = [];
  var reopenedAt = 0;
  var hasSystemChange = false;
  var prevTailKey = '';
  for (var page = 1; page <= EVENTS_MAX_NOTE_PAGES; page++) {
    var r = await api({
      url: 'https://' + conn.host + '/api/v4/projects/' + encodeURIComponent(item.project_id) + '/' + seg + '/' + item.iid +
        '/notes' + qs({ sort: 'desc', order_by: 'created_at', per_page: EVENTS_NOTES_PER_PAGE, page: page }),
    });
    if (r.err || !Array.isArray(r.data)) throw new Error(r.err || '读取评论失败');
    if (!r.data.length) break;
    var tail = r.data[r.data.length - 1];
    var tailKey = tail ? String(tail.id) + ':' + String(tail.created_at) : '';
    if (page > 1 && tailKey && tailKey === prevTailKey) break;
    prevTailKey = tailKey;
    var reachedWatermark = false;
    for (var i = 0; i < r.data.length; i++) {
      var raw = r.data[i];
      if (!raw) continue;
      var rawAt = eventsTimeMs(raw.created_at);
      var rawId = Number(raw.id) || 0;
      if (rawAt < watermark.at || (watermark.ids === null && rawAt <= watermark.at)) { reachedWatermark = true; break; }
      if (rawAt === watermark.at && watermark.ids && watermark.ids.indexOf(rawId) >= 0) continue;
      collected.push({ note: raw, at: rawAt, id: rawId });
    }
    if (reachedWatermark || r.data.length < EVENTS_NOTES_PER_PAGE) break;
    if (page === EVENTS_MAX_NOTE_PAGES) throw new Error('评论分页超出单轮上限');
  }
  var entries = [];
  var actionableCount = 0;
  var mkNote = function (id, type, at, subject, extra) {
    return { id: conn.host + ':note:' + id, type: type, occurredAt: at, subject: subject.slice(0, 200), data: Object.assign({}, data, extra) };
  };
  for (var j = collected.length - 1; j >= 0; j--) {
    var note = collected[j].note;
    var at = collected[j].at;
    var id = collected[j].id;
    var author = note.author && note.author.username ? String(note.author.username) : '';
    var extra = { noteId: id, actor: author };
    if (me) extra.fromSelf = author === me.username;
    if (note.system) {
      var sysBody = String(note.body || '');
      if (kind === 'mr' && /^approved this merge request/i.test(sysBody)) {
        actionableCount++;
        entries.push({ at: at, id: id, event: mkNote(note.id, 'merge_request.approved', at, eventsRef(data) + ' 已批准(' + author + ')', extra) });
      } else {
        if (/^reopened\b/i.test(sysBody) && (!reopenedAt || at > reopenedAt)) reopenedAt = at;
        else if (!/^(reopened|closed|merged|mentioned in)\b/i.test(sysBody)) hasSystemChange = true;
        entries.push({ at: at, id: id, event: null });
      }
    } else {
      actionableCount++;
      extra.body = String(note.body || '').slice(0, 1000);
      var prefix = (kind === 'mr' ? 'merge_request.' : 'issue.') + 'comment';
      entries.push({ at: at, id: id, event: mkNote(note.id, prefix, at, eventsRef(data) + ' 新评论(' + author + '):' + String(note.body || '').replace(/\s+/g, ' '), extra) });
    }
  }
  return { entries: entries, actionableCount: actionableCount, reopenedAt: reopenedAt, hasSystemChange: hasSystemChange };
}

/** 处理单个对象:返回 true 表示全部事件已入队并提交完整快照,返回 false 表示待发队列已满、保留续读位点。 */
async function eventsHandle(conn, kind, item, me, baselineAt, cursorKey, protectFromMs) {
  var prev = eventsGetSnap(cursorKey, item.id);
  if (eventsItemUnchanged(prev, item)) return true;
  var resumingNotesOnly = Boolean(prev && prev.notesIncomplete && prev.updatedAt === String(item.updated_at || '') &&
    !(item.head_pipeline && prev.pipeline !== String(item.head_pipeline.id) + ':' + String(item.head_pipeline.status)));
  var shouldReadNotes = !prev ? eventsTimeMs(item.updated_at) >= baselineAt : (Boolean(prev.notesIncomplete) || prev.updatedAt !== String(item.updated_at || ''));
  var watermark = eventsNoteWatermark(prev, baselineAt);
  var notesInfo = shouldReadNotes ? await eventsNotes(conn, kind, item, me, watermark) : null;
  var diff = resumingNotesOnly ? { snap: Object.assign({}, prev, { notesIncomplete: false }), events: [] } : eventsDiff(conn, kind, item, me, prev, baselineAt, notesInfo);
  if (!eventsCanQueueAll(diff.events)) return false;
  for (var i = 0; i < diff.events.length; i++) eventsTryQueue(diff.events[i]);

  var noteAt = watermark.at;
  var noteIds = watermark.ids ? watermark.ids.slice() : null;
  var notesIncomplete = false;
  for (var j = 0; notesInfo && j < notesInfo.entries.length; j++) {
    var entry = notesInfo.entries[j];
    if (entry.event && !eventsTryQueue(entry.event)) { notesIncomplete = true; break; }
    // 同一毫秒内保留全部已处理评论 ID(无截断);一旦推进到更新的时间戳即自然重置为单元素数组。
    if (noteIds === null || entry.at > noteAt) { noteAt = entry.at; noteIds = entry.id ? [entry.id] : []; }
    else if (entry.at === noteAt && entry.id && noteIds.indexOf(entry.id) < 0) noteIds.push(entry.id);
  }
  diff.snap.noteAt = noteAt;
  diff.snap.noteIds = noteIds;
  diff.snap.notesIncomplete = notesIncomplete;
  eventsRemember(cursorKey, item.id, diff.snap, protectFromMs);
  return !notesIncomplete;
}

async function eventsList(url) {
  var r = await api({ url: url });
  if (r.err) throw new Error(r.err);
  return Array.isArray(r.data) ? r.data : [];
}

function eventsTargetStreams(base, target, kind, me) {
  var seg = kind === 'mr' ? 'merge_requests' : 'issues';
  if (target.project) return [{ url: base + '/projects/' + encodeURIComponent(target.project) + '/' + seg, params: { scope: 'all' } }];
  var list = [{ url: base + '/' + seg, params: { scope: 'created_by_me' } }, { url: base + '/' + seg, params: { scope: 'assigned_to_me' } }];
  if (kind === 'mr' && me) list.push({ url: base + '/' + seg, params: { scope: 'all', reviewer_username: me.username } });
  return list;
}

/** 一个对象(project + iid)或一组对象(项目 / 与我相关)。返回是否仍有未处理完的对象留待下一轮继续。 */
async function eventsPollTarget(target, conn, me) {
  var base = 'https://' + conn.host + '/api/v4';
  var kinds = (target.kinds.mr ? ['mr'] : []).concat(target.kinds.issue ? ['issue'] : []);
  var anyRemaining = false;
  for (var i = 0; i < kinds.length; i++) {
    var kind = kinds[i];
    var seg = kind === 'mr' ? 'merge_requests' : 'issues';
    var cursorKey = conn.host + '|' + target.key + '|' + kind;
    var cycleStart = Date.now();
    var cur = eventsGetCursor(cursorKey, cycleStart);
    var protectFromMs = cur.resumeAt - 1000;
    if (target.iid) {
      var one = await api({ url: base + '/projects/' + encodeURIComponent(target.project) + '/' + seg + '/' + target.iid });
      if (one.err) {
        if (/HTTP 404|不存在/.test(one.err)) { eventsSetCursor(cursorKey, cur.baselineAt, cycleStart); continue; }
        throw new Error(one.err);
      }
      if (cur.firstRun) {
        eventsRemember(cursorKey, one.data.id, eventsDiff(conn, kind, one.data, me, null, Infinity, null).snap, protectFromMs);
        eventsSetCursor(cursorKey, cur.baselineAt, cycleStart);
      } else if (await eventsHandle(conn, kind, one.data, me, cur.baselineAt, cursorKey, protectFromMs)) {
        eventsSetCursor(cursorKey, cur.baselineAt, cycleStart);
      } else {
        anyRemaining = true;
      }
      continue;
    }
    var streams = eventsTargetStreams(base, target, kind, me);
    var seen = {};
    var items = [];
    if (cur.firstRun) {
      for (var is = 0; is < streams.length; is++) {
        var initPage = await eventsList(streams[is].url + qs(Object.assign({}, streams[is].params, { order_by: 'updated_at', sort: 'desc', per_page: EVENTS_LIST_PER_PAGE })));
        for (var ip = 0; ip < initPage.length; ip++) {
          if (initPage[ip] && initPage[ip].id !== undefined && !seen[initPage[ip].id]) { seen[initPage[ip].id] = 1; items.push(initPage[ip]); }
        }
      }
      for (var b = 0; b < items.length; b++) {
        eventsRemember(cursorKey, items[b].id, eventsDiff(conn, kind, items[b], me, null, Infinity, null).snap, protectFromMs);
      }
      eventsSetCursor(cursorKey, cur.baselineAt, cycleStart);
      continue;
    }
    var after = new Date(protectFromMs).toISOString();
    var stoppedEarly = false;
    var scopeCutoff = Infinity;
    var nextPages = {};
    var usedPageOffset = false;
    for (var s = 0; s < streams.length; s++) {
      var startPage = (cur.pages && cur.pages[s]) || 1;
      if (startPage > 1) usedPageOffset = true;
      var streamChanged = 0;
      var firstChangedPage = 0;
      var hitStreamCap = false;
      for (var offset = 0; offset < EVENTS_MAX_PAGES; offset++) {
        var sp = startPage + offset;
        var sPage = await eventsList(streams[s].url + qs(Object.assign({}, streams[s].params, { updated_after: after, order_by: 'updated_at', sort: 'asc', per_page: EVENTS_LIST_PER_PAGE, page: sp })));
        for (var p = 0; p < sPage.length; p++) {
          var cand = sPage[p];
          if (!cand || cand.id === undefined) continue;
          if (!eventsItemUnchanged(eventsGetSnap(cursorKey, cand.id), cand)) {
            if (!firstChangedPage) firstChangedPage = sp;
            streamChanged++;
          }
          if (!seen[cand.id]) { seen[cand.id] = 1; items.push(cand); }
        }
        if (sPage.length < EVENTS_LIST_PER_PAGE) break;
        if (streams.length === 1 && streamChanged > EVENTS_MAX_CHANGED_PER_TARGET) { stoppedEarly = true; hitStreamCap = true; break; }
        if (offset === EVENTS_MAX_PAGES - 1) {
          stoppedEarly = true;
          hitStreamCap = true;
          var tailAt = eventsTimeMs(sPage[sPage.length - 1] && sPage[sPage.length - 1].updated_at);
          if (tailAt && tailAt < scopeCutoff) scopeCutoff = tailAt;
        }
      }
      if (firstChangedPage) nextPages[s] = firstChangedPage;
      else if (hitStreamCap) nextPages[s] = startPage + Math.floor(EVENTS_MAX_PAGES / 2);
    }
    if (streams.length > 1) items.sort(function (a, b) { return eventsTimeMs(a.updated_at) - eventsTimeMs(b.updated_at); });
    var handled = 0;
    var lastHandledAt = cur.resumeAt;
    for (var n = 0; n < items.length; n++) {
      var item = items[n];
      if (eventsTimeMs(item.updated_at) > scopeCutoff) { stoppedEarly = true; break; }
      if (eventsItemUnchanged(eventsGetSnap(cursorKey, item.id), item)) continue;
      if (handled >= EVENTS_MAX_CHANGED_PER_TARGET || eventsState.pending.length >= EVENTS_PENDING_LIMIT) { stoppedEarly = true; break; }
      handled++;
      if (!(await eventsHandle(conn, kind, item, me, cur.baselineAt, cursorKey, protectFromMs))) { stoppedEarly = true; break; }
      var itemAt = eventsTimeMs(item.updated_at);
      if (itemAt > lastHandledAt) lastHandledAt = itemAt;
    }
    if (stoppedEarly) {
      var nextResume = lastHandledAt > cur.resumeAt ? lastHandledAt : cur.resumeAt;
      var keepVerify = cur.verify && handled === 0 && nextResume === cur.resumeAt;
      eventsSetCursor(cursorKey, cur.baselineAt, nextResume, nextResume > cur.resumeAt ? null : nextPages, keepVerify);
      anyRemaining = true;
    } else if (usedPageOffset && (!cur.verify || handled > 0)) {
      eventsSetCursor(cursorKey, cur.baselineAt, cur.resumeAt, null, true);
      anyRemaining = true;
    } else {
      eventsSetCursor(cursorKey, cur.baselineAt, cycleStart);
    }
  }
  return anyRemaining;
}

/** 整个项目:读有更新的流水线,出结果的找到对应 MR 后发「流水线」事件。返回是否仍有未查完的流水线。 */
async function eventsPollPipelines(target, conn, me) {
  var base = 'https://' + conn.host + '/api/v4/projects/' + encodeURIComponent(target.project);
  var cursorKey = conn.host + '|' + target.key + '|pipelines';
  var cycleStart = Date.now();
  var cur = eventsGetCursor(cursorKey, cycleStart);
  var protectFromMs = cur.resumeAt - 1000;
  if (cur.firstRun) {
    var initPipes = await eventsList(base + '/pipelines' + qs({ order_by: 'updated_at', sort: 'desc', per_page: EVENTS_LIST_PER_PAGE }));
    var initActive = false;
    for (var ip = 0; ip < initPipes.length; ip++) {
      if (!initPipes[ip] || initPipes[ip].id === undefined) continue;
      var s0 = String(initPipes[ip].status || '');
      if (EVENTS_PIPELINE_ACTIVE[s0]) initActive = true;
      eventsRemember(cursorKey, initPipes[ip].id, { status: s0, updatedAt: String(initPipes[ip].updated_at || '') }, protectFromMs);
    }
    eventsState.pipelinesActive[cursorKey] = initActive;
    eventsSetCursor(cursorKey, cur.baselineAt, cycleStart);
    return false;
  }
  var after = new Date(protectFromMs).toISOString();
  var startPage = (cur.pages && cur.pages[0]) || 1;
  var rechecked = eventsState.rechecked[cursorKey] || (eventsState.rechecked[cursorKey] = {});
  var rotatedSkipped = 0;
  var unrecheckedLeft = 0;
  var lookups = 0;
  var recheckLookups = 0;
  var active = false;
  var stoppedEarly = false;
  var hasUnconfirmed = false;
  var unconfirmedMinAt = Infinity;
  var firstPendingPage = 0;
  var hitPageCap = false;
  var lastHandledAt = cur.resumeAt;
  for (var offset = 0; offset < EVENTS_MAX_PAGES; offset++) {
    var page = startPage + offset;
    var pipelines = await eventsList(base + '/pipelines' + qs({ updated_after: after, order_by: 'updated_at', sort: 'asc', per_page: EVENTS_LIST_PER_PAGE, page: page }));
    for (var i = 0; i < pipelines.length; i++) {
      var p = pipelines[i];
      if (!p || p.id === undefined) continue;
      var status = String(p.status || '');
      var prev = eventsGetSnap(cursorKey, p.id);
      var pAt = eventsTimeMs(p.updated_at);
      if (EVENTS_PIPELINE_ACTIVE[status]) {
        active = true;
        eventsRemember(cursorKey, p.id, { status: status, updatedAt: String(p.updated_at || '') }, protectFromMs);
        if (pAt > lastHandledAt) lastHandledAt = pAt;
        continue;
      }
      if ((prev && prev.status === status && !prev.pending) || !EVENTS_PIPELINE_DONE[status] || (!prev && pAt < cur.baselineAt)) {
        if (!prev || prev.status !== status) eventsRemember(cursorKey, p.id, { status: status, updatedAt: String(p.updated_at || '') }, protectFromMs);
        if (pAt > lastHandledAt) lastHandledAt = pAt;
        continue;
      }
      var isRecheck = Boolean(prev && prev.status === status && prev.pending);
      if (isRecheck && rechecked[p.id]) {
        rotatedSkipped++;
        hasUnconfirmed = true;
        var rAt = pAt || cur.resumeAt;
        if (rAt < unconfirmedMinAt) unconfirmedMinAt = rAt;
        continue;
      }
      if (!firstPendingPage) firstPendingPage = page;
      if (eventsState.pending.length >= EVENTS_PENDING_LIMIT || (!isRecheck && lookups >= EVENTS_PIPELINE_LOOKUPS)) { stoppedEarly = true; break; }
      if (isRecheck && recheckLookups >= EVENTS_PIPELINE_LOOKUPS) {
        unrecheckedLeft++;
        hasUnconfirmed = true;
        var holdAt = pAt || cur.resumeAt;
        if (holdAt < unconfirmedMinAt) unconfirmedMinAt = holdAt;
        continue;
      }
      if (isRecheck) { recheckLookups++; rechecked[p.id] = 1; } else lookups++;
      var deliveredIids = (isRecheck && prev.iids) ? Object.assign({}, prev.iids) : {};
      var matchedMrs = [];
      var uncertain = false;
      var m = /^refs\/merge-requests\/([0-9]+)\//.exec(String(p.ref || ''));
      if (m) {
        var one = await api({ url: base + '/merge_requests/' + m[1] });
        if (one.err && !/HTTP 404|不存在/.test(one.err)) throw new Error(one.err);
        if (!one.err && one.data && one.data.iid !== undefined) matchedMrs.push(one.data);
      } else if (p.ref) {
        var pBranch = String(p.ref);
        var pSha = String(p.sha || '').trim();
        if (!pSha) {
          uncertain = true;
        } else {
          for (var mp = 1; mp <= EVENTS_MAX_PAGES; mp++) {
            var found = await eventsList(base + '/merge_requests' + qs({ source_branch: pBranch, state: 'opened', per_page: 100, page: mp }));
            for (var fi = 0; fi < found.length; fi++) {
              var cand = found[fi];
              if (!cand || cand.iid === undefined) continue;
              var candBranch = cand.source_branch !== undefined ? String(cand.source_branch) : '';
              if (candBranch && candBranch !== pBranch) continue;
              var candSha = String(cand.sha || '').trim();
              if (candSha && candSha !== pSha) continue;
              var targetProj = cand.target_project_id !== undefined ? cand.target_project_id : cand.project_id;
              if (cand.source_project_id !== undefined && targetProj !== undefined && String(cand.source_project_id) !== String(targetProj)) continue;
              if (!candBranch || !candSha || cand.source_project_id === undefined || targetProj === undefined) { uncertain = true; continue; }
              matchedMrs.push(cand);
            }
            if (found.length < 100) break;
            if (mp === EVENTS_MAX_PAGES) uncertain = true;
          }
        }
      }
      var queueBlocked = false;
      for (var mi = 0; mi < matchedMrs.length; mi++) {
        var mrItem = matchedMrs[mi];
        if (deliveredIids[mrItem.iid]) continue;
        var data = eventsBase(conn, 'mr', mrItem, me);
        var pipeEvent = eventsBuildEvent('pipeline', 'pipeline:' + p.id + ':' + status, '流水线' + status, mrItem, data, {
          pipelineId: Number(p.id), pipelineStatus: status,
        }, pAt || cycleStart);
        if (!eventsTryQueue(pipeEvent)) { queueBlocked = true; break; }
        deliveredIids[mrItem.iid] = 1;
      }
      eventsRemember(cursorKey, p.id, { status: status, updatedAt: String(p.updated_at || ''), pending: queueBlocked || uncertain, iids: deliveredIids }, protectFromMs);
      if (queueBlocked) { stoppedEarly = true; break; }
      if (uncertain) {
        hasUnconfirmed = true;
        var uAt = pAt || cur.resumeAt;
        if (uAt < unconfirmedMinAt) unconfirmedMinAt = uAt;
        continue;
      }
      if (pAt > lastHandledAt) lastHandledAt = pAt;
    }
    if (stoppedEarly || pipelines.length < EVENTS_LIST_PER_PAGE) break;
    if (offset === EVENTS_MAX_PAGES - 1) { stoppedEarly = true; hitPageCap = true; }
  }
  if (!stoppedEarly && !hitPageCap && unrecheckedLeft === 0 && (rotatedSkipped > 0 || recheckLookups > 0)) {
    eventsState.rechecked[cursorKey] = {};
  }
  var incomplete = stoppedEarly || hasUnconfirmed;
  eventsState.pipelinesActive[cursorKey] = incomplete ? true : active;
  if (incomplete) {
    var nextPipeResume = lastHandledAt > cur.resumeAt ? lastHandledAt : cur.resumeAt;
    if (unconfirmedMinAt < nextPipeResume) nextPipeResume = unconfirmedMinAt < cur.resumeAt ? cur.resumeAt : unconfirmedMinAt;
    var nextPipePage = firstPendingPage || (hitPageCap ? startPage + Math.floor(EVENTS_MAX_PAGES / 2) : startPage);
    var keepPipeVerify = cur.verify && lookups === 0 && recheckLookups === 0 && nextPipeResume === cur.resumeAt;
    eventsSetCursor(cursorKey, cur.baselineAt, nextPipeResume, nextPipeResume > cur.resumeAt ? null : { 0: nextPipePage }, keepPipeVerify);
    return true;
  }
  if (startPage > 1 && (!cur.verify || lookups > 0 || recheckLookups > 0)) {
    eventsSetCursor(cursorKey, cur.baselineAt, cur.resumeAt, null, true);
    eventsState.pipelinesActive[cursorKey] = true;
    return true;
  }
  eventsSetCursor(cursorKey, cur.baselineAt, cycleStart);
  return false;
}

/** 项目动态最新一条有没有变;仅在整轮处理完且无积压时提交新动态 ID,避免中途报错或限额截断后不再续跑。 */
async function eventsProjectProbe(target, conn) {
  var key = conn.host + '|' + target.key;
  var r = await api({
    url: 'https://' + conn.host + '/api/v4/projects/' + encodeURIComponent(target.project) + '/events' + qs({ per_page: 1 }),
  });
  if (r.err) throw new Error(r.err);
  var top = Array.isArray(r.data) && r.data[0] ? String(r.data[0].id) : '';
  var known = Object.prototype.hasOwnProperty.call(eventsState.activity, key);
  return {
    changed: !known || eventsState.activity[key] !== top,
    commit: function () { eventsState.activity[key] = top; },
  };
}

async function eventsReport(status) {
  if (eventsState.status === status) return;
  var r = await cindy.send({ type: 'routine-request', action: 'status', status: status });
  if (r && r.ok) eventsState.status = status;
}

async function eventsFlush(budget) {
  while (eventsState.pending.length && budget.left > 0) {
    var r = await cindy.send({ type: 'routine-request', action: 'publish', event: eventsState.pending[0] });
    if (!r || !r.ok) return false; // 保留投递 ID,下个周期重试
    eventsState.pending.shift();
    budget.left--;
  }
  return true;
}

/**
 * 一个轮询周期;返回下次间隔。null:宿主不支持订阅,停止;'idle':没有订阅,
 * 等宿主推送新订阅再开始。
 */
async function eventsCycle() {
  var budget = { left: EVENTS_PUBLISH_PER_CYCLE };
  if (eventsState.subscriptions === null) {
    var res = await cindy.send({ type: 'routine-request', action: 'subscriptions' });
    if (!res || !res.ok) {
      if (res && /Unknown routine operation|not declared/.test(String(res.message || ''))) return null;
      return EVENTS_POLL_MS;
    }
    // 宿主在这之后推送的订阅更新,优先于这次取到的(异步期间可能已经到了)。
    if (eventsState.subscriptions === null) eventsState.subscriptions = Array.isArray(res.subscriptions) ? res.subscriptions : [];
  }
  var targets = eventsTargetsFrom(eventsState.subscriptions);
  if (!targets.length) {
    await eventsFlush(budget);
    return eventsState.pending.length ? EVENTS_POLL_MS : 'idle';
  }
  if (eventsState.pending.length) {
    var flushed = await eventsFlush(budget);
    if (!flushed || eventsState.pending.length >= EVENTS_PENDING_LIMIT) {
      if (!flushed) await eventsReport('error');
      return EVENTS_POLL_MS;
    }
  }
  var sweep = eventsState.cycle++ % EVENTS_SWEEP_EVERY === 0;
  var conns = await eventsConnections();
  if (!conns.length) {
    await eventsReport('disconnected');
    return EVENTS_POLL_MS;
  }
  var failed = 0;
  var attempted = 0;
  for (var i = 0; i < targets.length; i++) {
    var picked = eventsConnectionsFor(targets[i], conns);
    for (var j = 0; j < picked.length; j++) {
      attempted++;
      try {
        var me = await eventsMe(picked[j]);
        var target = targets[i];
        var whole = Boolean(target.project && !target.iid);
        var probe = whole ? await eventsProjectProbe(target, picked[j]) : { changed: true, commit: null };
        var backlogKey = picked[j].host + '|' + target.key;
        var targetHasMore = false;
        if (probe.changed || sweep || eventsState.targetBacklog[backlogKey]) {
          targetHasMore = await eventsPollTarget(target, picked[j], me);
          eventsState.targetBacklog[backlogKey] = targetHasMore;
        }
        var pipelineKey = picked[j].host + '|' + target.key + '|pipelines';
        var pipeHasMore = false;
        if (whole && target.pipelines && (probe.changed || sweep || eventsState.pipelinesActive[pipelineKey])) {
          pipeHasMore = await eventsPollPipelines(target, picked[j], me);
        }
        if (probe.commit && !targetHasMore && !pipeHasMore) probe.commit();
      } catch (e) {
        failed++;
      }
    }
  }
  var flushOk = await eventsFlush(budget);
  await eventsReport(attempted === 0 ? 'disconnected' : (failed > 0 || !flushOk) ? 'error' : 'listening');
  return EVENTS_POLL_MS;
}

function eventsSchedule(delay) {
  if (eventsState.stopped) return;
  if (eventsState.timer) clearTimeout(eventsState.timer);
  eventsState.timer = setTimeout(function () {
    eventsState.timer = null;
    if (eventsState.running) { eventsState.wake = true; return; }
    eventsState.running = true;
    eventsState.wake = false;
    var done = function (next) {
      eventsState.running = false;
      if (next === null) { eventsState.stopped = true; return; }
      // 运行期间宿主推来了新订阅:马上按新订阅再跑一轮。
      if (eventsState.wake) return eventsSchedule(0);
      if (next !== 'idle') eventsSchedule(next);
    };
    eventsCycle().then(done, function () { done(EVENTS_POLL_MS); });
  }, delay);
}

/** 宿主推送的订阅(用户新建、修改、暂停或删除了相关自动化)。 */
function eventsSubscriptionsChanged(subscriptions) {
  eventsState.subscriptions = subscriptions;
  if (eventsState.running) eventsState.wake = true;
  else eventsSchedule(0);
}

if (typeof cindy !== 'undefined' && cindy && typeof cindy.send === 'function' && typeof setTimeout === 'function') eventsSchedule(3000);


/* ── 派单 ──────────────────────────────────────────────────────────── */

cindy.onHostMessage(async function (msg) {
  if (msg && msg.type === 'routine-subscriptions' && Array.isArray(msg.subscriptions)) {
    eventsSubscriptionsChanged(msg.subscriptions);
    return;
  }
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
