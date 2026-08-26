(function () {
  'use strict';

  var KEY = 'console_conn';
  var bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('console-cli') : null;
  var current = [];
  var statusTimer = null;

  function $(id) { return document.getElementById(id); }
  function status(text, sticky) {
    $('status').textContent = text || '';
    if (statusTimer) clearTimeout(statusTimer);
    if (!sticky && text) statusTimer = setTimeout(function () { $('status').textContent = ''; }, 4000);
  }
  function normalizeHost(raw) {
    var host = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;
    var labels = host.split('.');
    if (labels.some(function (label) {
      return !label || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
    })) return null;
    return host;
  }
  function findHost(host) {
    return current.find(function (item) { return item && item.host === host; }) || null;
  }
  function render(connections) {
    current = connections;
    var box = $('list');
    box.textContent = '';
    if (!connections.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '尚未添加 Console 实例';
      box.appendChild(empty);
      return;
    }
    connections.forEach(function (connection) {
      var row = document.createElement('div');
      row.className = 'account';
      var host = document.createElement('span');
      host.className = 'host';
      host.textContent = connection.host;
      row.appendChild(host);
      var tail = document.createElement('span');
      tail.className = 'tail';
      tail.textContent = connection.tail ? '尾号 ' + connection.tail : '';
      row.appendChild(tail);
      if (connection.isDefault) {
        var badge = document.createElement('span');
        badge.className = 'default-badge';
        badge.textContent = '默认';
        row.appendChild(badge);
      } else {
        var defaultButton = document.createElement('button');
        defaultButton.className = 'mini';
        defaultButton.type = 'button';
        defaultButton.textContent = '设为默认';
        defaultButton.addEventListener('click', function () { void setDefault(connection.id); });
        row.appendChild(defaultButton);
      }
      var testButton = document.createElement('button');
      testButton.className = 'mini';
      testButton.type = 'button';
      testButton.textContent = '测试';
      testButton.addEventListener('click', function () { void test(connection.id, testButton); });
      row.appendChild(testButton);
      var deleteButton = document.createElement('button');
      deleteButton.className = 'mini';
      deleteButton.type = 'button';
      deleteButton.textContent = '删除';
      deleteButton.addEventListener('click', function () { void remove(connection.id); });
      row.appendChild(deleteButton);
      box.appendChild(row);
    });
  }
  async function load() {
    try {
      var response = await fetch('/connections');
      if (!response.ok) throw new Error('connections');
      var rows = await response.json();
      var entry = Array.isArray(rows) && rows.find(function (item) { return item && item.key === KEY; });
      render(entry && Array.isArray(entry.connections) ? entry.connections : []);
    } catch (_error) {
      status('连接列表加载失败，请稍后重试', true);
    }
  }
  async function add() {
    var host = normalizeHost($('host').value);
    var token = $('token').value.trim();
    if (!host) { status('请填写不带端口和路径的 HTTPS 域名'); return; }
    if (!token) { status('请填写 API Token / PAT'); return; }
    $('add').disabled = true;
    status(findHost(host) ? '正在更新 Token，请确认系统弹窗…' : '正在添加，请确认系统弹窗…', true);
    try {
      var response = await fetch('/connections/' + KEY, { method: 'POST', body: JSON.stringify({ host: host, token: token }) });
      var result = null;
      try { result = await response.json(); } catch (_error) {}
      if (!result || result.ok !== true) {
        status('保存失败: ' + ((result && (result.error || result.errorCode)) || response.status || '请重试'), true);
        return;
      }
      $('host').value = '';
      $('token').value = '';
      syncEye();
      status('已保存 ' + host);
      await load();
      var saved = findHost(host);
      if (saved) void test(saved.id, null);
    } catch (_error) {
      status('保存失败，请重试', true);
    } finally {
      $('add').disabled = false;
    }
  }
  var testSeq = 0;
  async function test(connectionId, button) {
    if (!bc) { status('当前客户端不支持连接测试', true); return; }
    var reqId = 'test-' + Date.now() + '-' + (++testSeq);
    if (button) button.disabled = true;
    status('正在读取 Console CLI manifest…', true);
    try { await fetch('/wake'); } catch (_error) {}
    var settled = false;
    var timer;
    var deadline = setTimeout(function () {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      if (button) button.disabled = false;
      status('测试超时，请稍后重试', true);
    }, 15000);
    function onMessage(event) {
      var message = event && event.data;
      if (!message || message.type !== 'test-connection-result' || message.reqId !== reqId || settled) return;
      settled = true;
      bc.removeEventListener('message', onMessage);
      clearTimeout(deadline);
      if (timer) clearInterval(timer);
      if (button) button.disabled = false;
      status(message.ok ? '连接成功: 已读取 ' + message.count + ' 个操作' : (message.message || '连接失败'), !message.ok);
    }
    bc.addEventListener('message', onMessage);
    var send = function () { bc.postMessage({ type: 'test-connection', reqId: reqId, instance: connectionId }); };
    send();
    timer = setInterval(function () { if (!settled) send(); }, 400);
  }
  async function remove(connectionId) {
    try {
      await fetch('/connections/' + KEY + '/' + encodeURIComponent(connectionId), { method: 'DELETE' });
      status('已删除');
    } catch (_error) {
      status('删除失败，请重试', true);
    } finally {
      void load();
    }
  }
  async function setDefault(connectionId) {
    try {
      await fetch('/connections/' + KEY + '/default', { method: 'POST', body: JSON.stringify({ connectionId: connectionId }) });
      status('已设为默认');
    } catch (_error) {
      status('设置默认实例失败，请重试', true);
    } finally {
      void load();
    }
  }
  function syncEye() {
    var input = $('token');
    var eye = $('eye');
    var empty = !input.value;
    eye.classList.toggle('hidden', empty);
    if (empty) { input.type = 'password'; eye.classList.remove('revealed'); }
  }
  $('eye').addEventListener('click', function () {
    var input = $('token');
    var reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('eye').classList.toggle('revealed', reveal);
  });
  $('token').addEventListener('input', syncEye);
  $('add').addEventListener('click', function () { void add(); });
  $('token').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); void add(); } });
  $('host').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); $('token').focus(); } });
  syncEye();
  void load();
}());
