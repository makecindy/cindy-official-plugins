/**
 * GitLab 意识设置页脚本(CSP 禁内联,外挂加载)。多连接管理版。
 * 数据面:
 *   GET  /connections                       → [{ key, label, maxConnections, connections: [{ id, host, label, isDefault, tail }] }]
 *   POST /connections/gitlab_conn           → { host, token };主机弹确认框(域名放行 + token 入库),
 *                                             失败返回结构化错误码(INVALID_HOST / LIMIT / CONFIRM_DENIED / VAULT_WRITE_FAILED);
 *                                             同 host 再次提交 = 更换该实例的 token
 *   DELETE /connections/gitlab_conn/<id>    → 删除一条连接(幂等)
 *   POST /connections/gitlab_conn/default   → { connectionId } 设默认连接
 *   GET  /kv                                → { connectedUsers?: { <connectionId>: username } } 上次测试成功的用户名(只读展示)
 *   GET  /wake                              → 叫醒电子脑(幂等)
 * 每行「测试」经 BroadcastChannel('cindy-gitlab') 递活给电子脑:
 *   发 { type:'test-connection', reqId, connectionId },按 reqId 每 400ms 重发直到收到
 *   { type:'test-connection-result', reqId, ok, username, host, message },15s 超时。
 */
(function () {
  'use strict';

  var KEY = 'gitlab_conn';
  var bc = new BroadcastChannel('cindy-gitlab');

  function $(id) { return document.getElementById(id); }

  var statusTimer = null;
  function showStatus(text, sticky) {
    $('status').textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(function () { $('status').textContent = ''; }, 4000);
  }

  /** POST /connections 的结构化错误码 → 人话。 */
  var ADD_ERRORS = {
    INVALID_HOST: '实例地址无效——只填域名(如 git.example.com),不带 https://、端口与路径;仅支持 https 默认端口(443)',
    INVALID_TOKEN: 'token 为空或形态不对,请重新粘贴',
    TOKEN_TOO_LONG: 'token 过长,请确认粘贴内容',
    INVALID_LABEL: '备注名不合法(最长 64 字)',
    LIMIT: '连接数已达上限(最多 8 个实例),请先删除不用的',
    CONFIRM_DENIED: '已取消——未在系统弹窗中确认添加',
    VAULT_WRITE_FAILED: 'token 保存失败,请重试',
  };

  /** 内存里的最新连接列表(load 时刷新;add/test 用它做同 host 检测与定位)。 */
  var currentConns = [];

  /** 渲染连接列表:每条一行(host + @username + 尾号 + 默认/设默认 + 测试 + 删除)。 */
  function renderList(conns, users) {
    var box = $('list');
    box.textContent = '';
    if (!conns.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '尚未添加 GitLab 实例';
      box.appendChild(empty);
      return;
    }
    conns.forEach(function (cn) {
      var row = document.createElement('div');
      row.className = 'account';

      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = cn.host;
      var login = users && users[cn.id];
      if (login) {
        var user = document.createElement('span');
        user.className = 'user';
        user.textContent = ' @' + login;
        who.appendChild(user);
      }
      row.appendChild(who);

      var fromGlab = cn.source === 'glab-cli';
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = fromGlab ? '本机 glab 已登录 · 自动使用' : (cn.tail ? '尾号 ' + cn.tail : '');
      row.appendChild(tag);

      if (cn.isDefault) {
        var badge = document.createElement('span');
        badge.className = 'default-badge';
        badge.textContent = '默认';
        row.appendChild(badge);
      } else if (!fromGlab) {
        var mkDefault = document.createElement('button');
        mkDefault.className = 'mini';
        mkDefault.type = 'button';
        mkDefault.textContent = '设为默认';
        mkDefault.addEventListener('click', function () { void setDefault(cn.id); });
        row.appendChild(mkDefault);
      }

      var testBtn = document.createElement('button');
      testBtn.className = 'mini';
      testBtn.type = 'button';
      testBtn.textContent = '测试';
      testBtn.addEventListener('click', function () { void test(cn.id, testBtn); });
      row.appendChild(testBtn);

      if (!fromGlab) {
        var delBtn = document.createElement('button');
        delBtn.className = 'mini';
        delBtn.type = 'button';
        delBtn.textContent = '删除';
        delBtn.addEventListener('click', function () { void remove(cn.id); });
        row.appendChild(delBtn);
      }

      box.appendChild(row);
    });
  }

  async function load() {
    try {
      var conns = [];
      var list = await (await fetch('/connections')).json();
      if (Array.isArray(list)) {
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].key === KEY) {
            conns = Array.isArray(list[i].connections) ? list[i].connections : [];
            break;
          }
        }
      }
      currentConns = conns;
      var users = null;
      try {
        var kv = await (await fetch('/kv')).json();
        if (kv && typeof kv.connectedUsers === 'object') users = kv.connectedUsers;
      } catch (e) { /* kv 读失败只影响用户名展示 */ }
      renderList(conns, users);
    } catch (e) {
      showStatus('状态加载失败,请稍后重试');
    }
  }

  /**
   * 输入的实例地址归一化:剥协议与尾斜杠、小写化,只留裸域名。
   * 带端口直接返回 null 让调用方报错——主机出网通道仅支持 https 默认端口
   * (443),放进去也连不上,在入口就说清楚。
   */
  function normalizeHost(raw) {
    var host = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    if (host.indexOf(':') >= 0) return null;
    return host;
  }

  function findByHost(host) {
    for (var i = 0; i < currentConns.length; i++) {
      if (currentConns[i].host === host && currentConns[i].source !== 'glab-cli') return currentConns[i];
    }
    return null;
  }

  /**
   * 眼睛按钮只服务「正在输入的新值」的核对——已存的 token 永远读不回,空框时
   * 点它必然没反应,干脆藏掉免得被误会成"看已存 token"的坏按钮;隐藏同时
   * 复位密文态,下次粘贴默认遮蔽。(交互与 cindy-github 设置页一致。)
   */
  function syncEye() {
    var input = $('token');
    var eye = $('eye');
    var empty = input.value.length === 0;
    eye.classList.toggle('hidden', empty);
    if (empty) {
      input.type = 'password';
      eye.classList.remove('revealed');
    }
  }

  async function add() {
    var host = normalizeHost($('host').value);
    var token = $('token').value.trim();
    if (host === null) { showStatus('暂不支持带端口的实例——出网通道仅支持 https 默认端口(443)', true); return; }
    if (!host) { showStatus('请先填实例地址(如 git.example.com)'); return; }
    if (!token) { showStatus('请先粘贴 token'); return; }
    var replacing = findByHost(host);
    $('add').disabled = true;
    // POST 后主机会弹系统确认框,等待期把状态说破,免得用户以为卡死。
    showStatus(replacing ? '该实例已存在,将更换其 token——请在系统弹窗中确认…' : '请在系统弹窗中确认添加…', true);
    try {
      var r = await fetch('/connections/' + KEY, { method: 'POST', body: JSON.stringify({ host: host, token: token }) });
      // 成败以 body 的 ok 为准:确认框被拒 / 超上限 / 入库失败也是 200,
      // 只是 { ok:false, error:'CODE' }(参数类错误才走 400/413)。
      var d = null;
      try { d = await r.json(); } catch (e) { /* 非 JSON 体,按失败处理 */ }
      if (d && d.ok === true) {
        $('host').value = '';
        $('token').value = '';
        syncEye();
        showStatus(replacing ? '已更换 ' + host + ' 的 token' : '已添加 ' + host);
        await load();
        // 添加/换 token 成功顺手验一次,让用户当场看到 token 是否可用。
        var added = findByHost(host);
        if (added) void test(added.id, null);
        return;
      }
      var code = (d && (d.error || d.errorCode)) || '';
      showStatus(ADD_ERRORS[code] || ('添加失败(' + (code || r.status) + '),请重试'), true);
    } catch (e) {
      showStatus('添加失败,请重试', true);
    } finally {
      $('add').disabled = false;
    }
  }

  var testSeq = 0;
  async function test(connectionId, btn) {
    var reqId = 'test-' + Date.now() + '-' + (++testSeq);
    if (btn) btn.disabled = true;
    showStatus('正在连接 GitLab 验证…', true);
    try {
      await fetch('/wake');
    } catch (e) { /* 叫不醒也让重发兜底 */ }
    var settled = false;
    var timer = null;
    var deadline = setTimeout(function () {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      showStatus('测试超时——电子脑未响应,请稍后重试', true);
      if (btn) btn.disabled = false;
      void load();
    }, 15000);
    bc.addEventListener('message', function onMsg(ev) {
      var m = ev && ev.data;
      if (!m || m.type !== 'test-connection-result' || m.reqId !== reqId) return;
      if (settled) return;
      settled = true;
      bc.removeEventListener('message', onMsg);
      clearTimeout(deadline);
      if (timer) clearInterval(timer);
      if (btn) btn.disabled = false;
      if (m.ok) {
        // 成功由系统提示(notify)宣告,页内不重复挂灰字,只清掉「正在连接…」。
        showStatus('');
      } else {
        // 失败保留页内:toast 几秒就消失,失败原因要留在页上照着修;
        // 且 notify 有 5s 限速,快速重试失败时页内是唯一反馈。
        showStatus(m.message || '连接失败', true);
      }
      void load();
    });
    var send = function () { bc.postMessage({ type: 'test-connection', reqId: reqId, connectionId: connectionId }); };
    send();
    timer = setInterval(function () {
      if (settled) { clearInterval(timer); return; }
      send();
    }, 400);
  }

  async function remove(connectionId) {
    try {
      await fetch('/connections/' + KEY + '/' + encodeURIComponent(connectionId), { method: 'DELETE' });
      try {
        // 顺手清掉该连接缓存的用户名展示,避免残留脏数据。
        var kv = await (await fetch('/kv')).json();
        if (kv && typeof kv === 'object' && kv.connectedUsers && typeof kv.connectedUsers === 'object') {
          delete kv.connectedUsers[connectionId];
          await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
        }
      } catch (e) { /* 展示缓存清不掉不影响主流程 */ }
      showStatus('已删除');
    } catch (e) {
      showStatus('删除失败,请重试');
    } finally {
      void load();
    }
  }

  async function setDefault(connectionId) {
    try {
      await fetch('/connections/' + KEY + '/default', {
        method: 'POST',
        body: JSON.stringify({ connectionId: connectionId }),
      });
    } catch (e) {
      showStatus('设默认失败,请重试');
    } finally {
      void load();
    }
  }

  $('eye').addEventListener('click', function () {
    var input = $('token');
    var reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('eye').classList.toggle('revealed', reveal);
  });
  $('token').addEventListener('input', syncEye);
  $('add').addEventListener('click', function () { void add(); });
  $('token').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); void add(); }
  });
  $('host').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); $('token').focus(); }
  });
  syncEye();
  void load();
})();
