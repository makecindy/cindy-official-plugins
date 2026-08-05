/**
 * GitHub 意识设置页脚本(CSP 禁内联,外挂加载)。
 * 数据面:
 *   GET  /secrets                → [{ key, saved, tail?, hostSource?, hostAvailable? }]
 *                                  (永远拿不回 gh/PAT 值)
 *   PUT  /secrets/github_pat     → { value } 一次性入库(204)
 *   DELETE /secrets/github_pat   → 清除
 *   GET  /kv                     → { connectedLogin? } 上次测试成功的用户名(只读展示)
 *   GET  /wake                   → 叫醒电子脑(幂等)
 * 测试连接经 BroadcastChannel('cindy-github') 递活给电子脑:
 *   发 { type:'test-connection', reqId },按 reqId 每 400ms 重发直到收到
 *   { type:'test-connection-result', reqId, ok, login, message },15s 超时。
 */
(function () {
  'use strict';

  var KEY = 'github_pat';
  var bc = new BroadcastChannel('cindy-github');
  var ghAvailable = false;

  function $(id) { return document.getElementById(id); }

  var statusTimer = null;
  function showStatus(text, sticky) {
    $('status').textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(function () { $('status').textContent = ''; }, 4000);
  }

  /** 宿主 gh 状态卡:只展示可用布尔与上次测试用户名,拿不到 token/账号详情。 */
  function renderHostAccount(available, login) {
    var box = $('host-account');
    box.textContent = '';
    var row = document.createElement('div');
    row.className = 'account';
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = available ? '已连接 GitHub，可直接使用' : '尚未连接 GitHub';
    row.appendChild(who);
    var tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = login ? '最近验证 @' + login : (available ? '优先使用' : '可使用备用 Token');
    row.appendChild(tag);
    box.appendChild(row);
  }

  /** 渲染备用 PAT 保存状态(saved + tail 指纹)。 */
  function renderFallbackAccount(saved, tail) {
    var box = $('fallback-account');
    box.textContent = '';
    if (!saved) return;
    var row = document.createElement('div');
    row.className = 'account';
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = '已保存备用 Token';
    row.appendChild(who);
    var tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = tail ? '尾号 ' + tail : '';
    row.appendChild(tag);
    box.appendChild(row);
  }

  async function load() {
    try {
      var saved = false;
      var tail = '';
      var hostAvailable = false;
      var list = await (await fetch('/secrets')).json();
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].key === KEY) {
          saved = Boolean(list[i].saved);
          tail = list[i].tail || '';
          hostAvailable = list[i].hostSource === 'gh-cli' && Boolean(list[i].hostAvailable);
        }
      }
      ghAvailable = hostAvailable;
      var login = '';
      try {
        var kv = await (await fetch('/kv')).json();
        if ((hostAvailable || saved) && kv && typeof kv.connectedLogin === 'string') login = kv.connectedLogin;
      } catch (e) { /* kv 读失败只影响用户名展示 */ }
      renderHostAccount(hostAvailable, login);
      renderFallbackAccount(saved, tail);
      // 单凭证语义要在输入行上说破:已保存时空输入框容易被误读成"还能再绑
      // 一个",实际再存 = 覆盖唯一的一条。占位与按钮文案切成「更换」。
      $('token').placeholder = saved ? '粘贴新的备用 Token 以更换(覆盖当前)' : '粘贴备用 Token';
      $('save').textContent = saved ? '更换' : '保存';
      $('test').disabled = !hostAvailable && !saved;
      $('clear').disabled = !saved;
    } catch (e) {
      showStatus('状态加载失败,请稍后重试');
    }
  }

  /**
   * 眼睛按钮只服务「正在输入的新值」的核对——已存的值永远读不回,空框时
   * 点它必然没反应,干脆藏掉免得被误会成"看已存 token"的坏按钮;隐藏同时
   * 复位密文态,下次粘贴默认遮蔽。(交互与 xd-mivo 设置页一致。)
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

  async function save() {
    var input = $('token');
    var value = input.value.trim();
    if (!value) { showStatus('请先粘贴 token'); return; }
    $('save').disabled = true;
    try {
      var r = await fetch('/secrets/' + KEY, { method: 'PUT', body: JSON.stringify({ value: value }) });
      if (r.status !== 204) { showStatus('保存失败(' + r.status + '),请重试', true); return; }
      input.value = '';
      syncEye();
      await load();
      // gh 可用时真实请求会优先走 gh,不能把它的成功误报成备用 PAT 已验证。
      // 只有当前没有 gh 时才顺手验新 PAT。
      if (ghAvailable) showStatus('备用 Token 已保存；当前仍优先使用本机 GitHub 登录');
      else void test();
    } catch (e) {
      showStatus('保存失败,请重试', true);
    } finally {
      $('save').disabled = false;
    }
  }

  var testSeq = 0;
  async function test() {
    var reqId = 'test-' + Date.now() + '-' + (++testSeq);
    var btn = $('test');
    btn.disabled = true;
    showStatus('正在连接 GitHub 验证…', true);
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
    var send = function () { bc.postMessage({ type: 'test-connection', reqId: reqId }); };
    send();
    timer = setInterval(function () {
      if (settled) { clearInterval(timer); return; }
      send();
    }, 400);
  }

  async function clearToken() {
    $('clear').disabled = true;
    try {
      await fetch('/secrets/' + KEY, { method: 'DELETE' });
      try {
        // gh 仍可用时用户名属于当前有效认证,不应随备用 PAT 一起清掉。
        if (!ghAvailable) {
          var kv = await (await fetch('/kv')).json();
          if (kv && typeof kv === 'object') {
            delete kv.connectedLogin;
            await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
          }
        }
      } catch (e) { /* 展示缓存清不掉不影响主流程 */ }
      showStatus('已清除');
    } catch (e) {
      showStatus('清除失败,请重试');
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
  $('save').addEventListener('click', function () { void save(); });
  $('test').addEventListener('click', function () { void test(); });
  $('clear').addEventListener('click', function () { void clearToken(); });
  $('token').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); void save(); }
  });
  syncEye();
  void load();
})();
