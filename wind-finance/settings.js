/**
 * Wind Finance 设置页脚本。
 * 连接地址和 API token 通过 /connections 交给主机，页面只读取 host、
 * saved 状态和尾号指纹，永远拿不回 token 明文。
 */
(function () {
  'use strict';

  var KEY = 'wind_finance_conn';
  var bc = new BroadcastChannel('wind-finance');
  var currentConns = [];
  var statusTimer = null;

  function $(id) { return document.getElementById(id); }

  function showStatus(text, sticky) {
    $('status').textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(function () { $('status').textContent = ''; }, 4000);
  }

  function normalizeHost(raw) {
    var value = String(raw || '').trim();
    if (!value) return null;
    var host = value.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    if (!host || host.indexOf(':') >= 0 || host.indexOf('/') >= 0 || /\s/.test(host)) return null;
    return host;
  }

  function findByHost(host) {
    for (var i = 0; i < currentConns.length; i++) {
      if (currentConns[i].host === host) return currentConns[i];
    }
    return null;
  }

  function renderList(conns, users) {
    var box = $('list');
    box.textContent = '';
    if (!conns.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '尚未添加 Wind API 连接';
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
        var account = document.createElement('span');
        account.textContent = ' · ' + login;
        who.appendChild(account);
      }
      row.appendChild(who);
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = cn.tail ? '尾号 ' + cn.tail : '';
      row.appendChild(tag);
      if (cn.isDefault) {
        var badge = document.createElement('span');
        badge.className = 'default-badge';
        badge.textContent = '默认';
        row.appendChild(badge);
      } else {
        var defaultBtn = document.createElement('button');
        defaultBtn.className = 'mini';
        defaultBtn.type = 'button';
        defaultBtn.textContent = '设为默认';
        defaultBtn.addEventListener('click', function () { void setDefault(cn.id); });
        row.appendChild(defaultBtn);
      }
      var testBtn = document.createElement('button');
      testBtn.className = 'mini';
      testBtn.type = 'button';
      testBtn.textContent = '测试';
      testBtn.addEventListener('click', function () { void test(cn.id, testBtn); });
      row.appendChild(testBtn);
      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'mini';
      deleteBtn.type = 'button';
      deleteBtn.textContent = '删除';
      deleteBtn.addEventListener('click', function () { void remove(cn.id); });
      row.appendChild(deleteBtn);
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
      var users = {};
      try {
        var kv = await (await fetch('/kv')).json();
        if (kv && kv.connectedUsers && typeof kv.connectedUsers === 'object') users = kv.connectedUsers;
      } catch (err) {}
      renderList(conns, users);
    } catch (err) {
      showStatus('状态加载失败，请稍后重试', true);
    }
  }

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
    if (!host) { showStatus('请填写不带协议、端口或路径的 API 域名', true); return; }
    if (!token) { showStatus('请先粘贴 API token 或 app key', true); return; }
    var replacing = findByHost(host);
    $('add').disabled = true;
    showStatus(replacing ? '将更换该连接的凭证，请在系统弹窗中确认…' : '请在系统弹窗中确认添加连接…', true);
    try {
      var r = await fetch('/connections/' + KEY, {
        method: 'POST',
        body: JSON.stringify({ host: host, token: token }),
      });
      var data = null;
      try { data = await r.json(); } catch (err) {}
      if (data && data.ok === true) {
        $('host').value = '';
        $('token').value = '';
        syncEye();
        showStatus(replacing ? '已更换 ' + host + ' 的凭证' : '已添加 ' + host);
        await load();
        var added = findByHost(host);
        if (added) void test(added.id, null);
      } else {
        showStatus('添加失败，请确认系统弹窗已允许该域名并重试', true);
      }
    } catch (err) {
      showStatus('添加失败，请重试', true);
    } finally {
      $('add').disabled = false;
    }
  }

  var testSeq = 0;
  async function test(connectionId, button) {
    var reqId = 'test-' + Date.now() + '-' + (++testSeq);
    if (button) button.disabled = true;
    showStatus('正在测试 Wind API…', true);
    try { await fetch('/wake'); } catch (err) {}
    var settled = false;
    var timer = null;
    var deadline = setTimeout(function () {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      if (button) button.disabled = false;
      showStatus('测试超时——请确认 API 网关可访问并支持 /v1/status', true);
      void load();
    }, 15000);
    function onMessage(event) {
      var message = event && event.data;
      if (!message || message.type !== 'test-connection-result' || message.reqId !== reqId) return;
      if (settled) return;
      settled = true;
      bc.removeEventListener('message', onMessage);
      clearTimeout(deadline);
      if (timer) clearInterval(timer);
      if (button) button.disabled = false;
      showStatus(message.ok ? '' : (message.message || '连接失败'), !message.ok);
      void load();
    }
    bc.addEventListener('message', onMessage);
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
      showStatus('已删除');
    } catch (err) {
      showStatus('删除失败，请重试', true);
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
    } catch (err) {
      showStatus('设默认失败，请重试', true);
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
  $('token').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); void add(); }
  });
  $('host').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); $('token').focus(); }
  });
  syncEye();
  void load();
})();
