(function () {
  'use strict';

  var CHANNEL = 'qq-mail-settings';
  var SECRET_KEY = 'qq_mail_authorization_code';
  var channel = new BroadcastChannel(CHANNEL);
  var pending = {};

  function $(id) {
    return document.getElementById(id);
  }

  function requestId() {
    return typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : String(Date.now()) + '-' + String(Math.random()).slice(2);
  }

  function showStatus(message, error) {
    $('status').textContent = message || '';
    $('status').classList.toggle('error', Boolean(error));
  }

  function setBusy(busy) {
    $('connect').disabled = busy;
    $('disconnect').disabled = busy;
    $('email').disabled = busy;
    $('authorizationCode').disabled = busy;
    $('toggleSecret').disabled = busy;
  }

  function render(state) {
    var connected = Boolean(state && state.connected);
    $('stateBadge').textContent = connected ? '已连接' : '未连接';
    $('stateBadge').classList.toggle('connected', connected);
    $('connectedCard').hidden = !connected;
    $('connectForm').hidden = connected;
    $('connectedEmail').textContent = connected && state.email ? state.email : '';
  }

  async function readJson(path) {
    var response = await fetch(path);
    if (!response.ok) throw new Error('读取 QQ 邮箱配置失败');
    return response.json();
  }

  async function loadState() {
    var values = await Promise.all([readJson('/kv'), readJson('/secrets')]);
    var kv = values[0] && typeof values[0] === 'object' && !Array.isArray(values[0])
      ? values[0]
      : {};
    var secretItems = Array.isArray(values[1]) ? values[1] : [];
    var email = typeof kv.email === 'string' ? kv.email.trim().toLowerCase() : '';
    var secretSaved = secretItems.some(function hasSavedSecret(item) {
      return item && item.key === SECRET_KEY && item.saved === true;
    });
    return { connected: Boolean(email && secretSaved), email: email || null };
  }

  // Same lock as main.js and Cindy's mail SDK, which keeps draft-card records in this KV.
  async function saveEmail(email) {
    await navigator.locks.request('qq-mail-kv', async function () {
      var current = await readJson('/kv');
      var data = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
      data.email = email;
      var response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(data) });
      if (!response.ok) throw new Error('保存 QQ 邮箱地址失败');
    });
  }

  async function saveAuthorizationCode(value) {
    var response = await fetch('/secrets/' + SECRET_KEY, {
      method: 'PUT',
      body: JSON.stringify({ value: value }),
    });
    if (!response.ok) throw new Error('安全保存授权码失败');
  }

  async function removeAuthorizationCode() {
    var response = await fetch('/secrets/' + SECRET_KEY, { method: 'DELETE' });
    if (!response.ok) throw new Error('清除授权码失败');
  }

  function sendConnect(email, timeoutMs) {
    var reqId = requestId();
    var message = {
      type: 'settings-request',
      reqId: reqId,
      action: 'connect',
      payload: { email: email },
    };
    return new Promise(function (resolve, reject) {
      var settled = false;
      var retry = null;
      var deadline = setTimeout(function () {
        if (settled) return;
        settled = true;
        if (retry) clearInterval(retry);
        delete pending[reqId];
        reject(new Error('连接等待超时，请确认插件已启用后重试'));
      }, timeoutMs || 20000);
      pending[reqId] = function finish(response) {
        if (settled) return;
        settled = true;
        if (retry) clearInterval(retry);
        clearTimeout(deadline);
        delete pending[reqId];
        if (response.ok) resolve(response.result || {});
        else reject(new Error(response.message || 'QQ 邮箱操作失败'));
      };
      function beginPosting() {
        if (settled) return;
        channel.postMessage(message);
        retry = setInterval(function () {
          if (!settled) channel.postMessage(message);
        }, 400);
      }
      // 设置页先叫醒浏览器 main.js；消息只含邮箱地址，不含授权码。
      void fetch('/wake').then(beginPosting, beginPosting);
    });
  }

  channel.addEventListener('message', function (event) {
    var message = event && event.data;
    if (!message || message.type !== 'settings-result' || !pending[message.reqId]) return;
    pending[message.reqId](message);
  });

  async function connect(event) {
    event.preventDefault();
    var email = $('email').value.trim().toLowerCase();
    var authorizationCode = $('authorizationCode').value.replace(/\s+/g, '');
    if (!email || !authorizationCode) {
      showStatus('请填写邮箱地址和 IMAP/SMTP 授权码', true);
      return;
    }
    setBusy(true);
    showStatus('正在安全保存授权码并测试 IMAP 和 SMTP 连接…');
    $('authorizationCode').value = '';
    var secretStored = false;
    try {
      await saveEmail(email);
      await saveAuthorizationCode(authorizationCode);
      secretStored = true;
      authorizationCode = '';
      var state = await sendConnect(email, 50000);
      render(state);
      showStatus('连接成功。授权码已由 Cindy 安全保存。');
    } catch (error) {
      authorizationCode = '';
      // 测试未通过时不保留未经验证的授权码；清理失败不覆盖原始错误。
      if (secretStored) {
        try {
          await removeAuthorizationCode();
        } catch (_removeError) {
          // 后续可通过“断开并清除”再次移除。
        }
      }
      render({ connected: false });
      showStatus(error && error.message ? error.message : '连接失败，请重试', true);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    showStatus('');
    try {
      await removeAuthorizationCode();
      render({ connected: false });
      showStatus('已断开并从 Cindy 安全存储中清除授权码。');
    } catch (error) {
      showStatus(error && error.message ? error.message : '断开失败，请重试', true);
    } finally {
      setBusy(false);
    }
  }

  function toggleSecret() {
    var input = $('authorizationCode');
    var reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('toggleSecret').textContent = reveal ? '隐藏' : '显示';
    $('toggleSecret').setAttribute('aria-label', reveal ? '隐藏授权码' : '显示授权码');
  }

  $('connectForm').addEventListener('submit', function (event) { void connect(event); });
  $('disconnect').addEventListener('click', function () { void disconnect(); });
  $('toggleSecret').addEventListener('click', toggleSecret);

  void (async function init() {
    try {
      var state = await loadState();
      if (state.email) $('email').value = state.email;
      render(state);
    } catch (_error) {
      render({ connected: false });
      showStatus('暂时无法读取已保存的连接状态', true);
    }
  })();
})();
