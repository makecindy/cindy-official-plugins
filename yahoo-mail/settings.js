(function () {
  'use strict';

  var CHANNEL = 'yahoo-mail-settings';
  var SECRET_KEYS = {
    a: 'yahoo_mail_app_password',
    b: 'yahoo_mail_app_password_b',
  };
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
    $('appPassword').disabled = busy;
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
    if (!response.ok) throw new Error('读取 Yahoo Mail 配置失败');
    return response.json();
  }

  async function loadState() {
    var values = await Promise.all([readJson('/kv'), readJson('/secrets')]);
    var kv = values[0] && typeof values[0] === 'object' && !Array.isArray(values[0])
      ? values[0]
      : {};
    var secretItems = Array.isArray(values[1]) ? values[1] : [];
    var email = typeof kv.email === 'string' ? kv.email.trim().toLowerCase() : '';
    var credentialSlot = kv.credentialSlot === 'b' ? 'b' : 'a';
    var savedSlots = { a: false, b: false };
    secretItems.forEach(function recordSavedSecret(item) {
      if (!item || item.saved !== true) return;
      if (item.key === SECRET_KEYS.a) savedSlots.a = true;
      if (item.key === SECRET_KEYS.b) savedSlots.b = true;
    });
    return {
      connected: Boolean(email && savedSlots[credentialSlot]),
      email: email || null,
      credentialSlot: credentialSlot,
      savedSlots: savedSlots,
    };
  }

  async function saveAccountState(email, credentialSlot) {
    var current = await readJson('/kv');
    var data = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    data.email = email;
    data.credentialSlot = credentialSlot;
    var response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(data) });
    if (!response.ok) throw new Error('保存 Yahoo Mail 连接状态失败');
  }

  async function clearAccountState() {
    var current = await readJson('/kv');
    var data = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    delete data.email;
    delete data.credentialSlot;
    var response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(data) });
    if (!response.ok) throw new Error('清除 Yahoo Mail 连接状态失败');
  }

  async function saveAppPassword(credentialSlot, value) {
    var response = await fetch('/secrets/' + SECRET_KEYS[credentialSlot], {
      method: 'PUT',
      body: JSON.stringify({ value: value }),
    });
    if (!response.ok) throw new Error('安全保存 Yahoo 应用密码失败');
  }

  async function removeAppPassword(credentialSlot) {
    var response = await fetch('/secrets/' + SECRET_KEYS[credentialSlot], { method: 'DELETE' });
    if (!response.ok) throw new Error('清除 Yahoo 应用密码失败');
  }

  function sendConnect(email, credentialSlot, timeoutMs) {
    var reqId = requestId();
    var message = {
      type: 'settings-request',
      reqId: reqId,
      action: 'connect',
      payload: { email: email, credentialSlot: credentialSlot },
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
        else reject(new Error(response.message || 'Yahoo Mail 操作失败'));
      };
      function beginPosting() {
        if (settled) return;
        channel.postMessage(message);
        retry = setInterval(function () {
          if (!settled) channel.postMessage(message);
        }, 400);
      }
      // 设置页先叫醒浏览器 main.js；消息只含邮箱地址，不含应用密码。
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
    var appPassword = $('appPassword').value.replace(/\s+/g, '');
    if (!email || !appPassword) {
      showStatus('请填写 Yahoo 邮箱地址和应用密码', true);
      return;
    }
    setBusy(true);
    showStatus('正在安全保存应用密码并测试 IMAP 和 SMTP 连接…');
    $('appPassword').value = '';
    var previousState = null;
    var candidateSlot = 'a';
    var candidateStored = false;
    var commitStarted = false;
    try {
      previousState = await loadState();
      candidateSlot = previousState.savedSlots[previousState.credentialSlot]
        ? (previousState.credentialSlot === 'a' ? 'b' : 'a')
        : previousState.credentialSlot;
      await saveAppPassword(candidateSlot, appPassword);
      candidateStored = true;
      appPassword = '';
      var state = await sendConnect(email, candidateSlot, 50000);
      // PUT 的响应可能丢失；从开始提交起，候选槽位就可能已被 KV 引用，不能再删除。
      commitStarted = true;
      await saveAccountState(email, candidateSlot);
      render({ connected: true, email: state.email || email });
      showStatus('连接成功。Yahoo 应用密码已由 Cindy 安全保存。');

      // 新密码验证并提交成功后，再尽力清除旧槽位；清理失败不会影响新连接。
      if (
        previousState.credentialSlot !== candidateSlot
        && previousState.savedSlots[previousState.credentialSlot]
      ) {
        try {
          await removeAppPassword(previousState.credentialSlot);
        } catch (_removeOldError) {
          // 旧槽位已不再被引用，下次连接或断开时会再次清理。
        }
      }
    } catch (error) {
      appPassword = '';
      // 只有提交开始前失败才能安全清理候选槽位。即使清理失败，因为 KV 尚未引用
      // 候选槽位，设置页和状态工具也不会把未经验证的密码误报为已连接。
      if (candidateStored && !commitStarted) {
        try {
          await removeAppPassword(candidateSlot);
        } catch (_removeError) {
          // 清理失败不覆盖原始错误；候选槽位未被 KV 引用。
        }
      }
      render(previousState || { connected: false });
      showStatus(error && error.message ? error.message : '连接失败，请重试', true);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    showStatus('');
    try {
      var state = await loadState();
      var inactiveSlot = state.credentialSlot === 'a' ? 'b' : 'a';
      if (state.savedSlots[inactiveSlot]) await removeAppPassword(inactiveSlot);
      if (state.savedSlots[state.credentialSlot]) {
        await removeAppPassword(state.credentialSlot);
      }
      await clearAccountState();
      render({ connected: false });
      showStatus('已断开并从 Cindy 安全存储中清除 Yahoo 应用密码。');
    } catch (error) {
      showStatus(error && error.message ? error.message : '断开失败，请重试', true);
    } finally {
      setBusy(false);
    }
  }

  function toggleSecret() {
    var input = $('appPassword');
    var reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('toggleSecret').textContent = reveal ? '隐藏' : '显示';
    $('toggleSecret').setAttribute('aria-label', reveal ? '隐藏应用密码' : '显示应用密码');
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
