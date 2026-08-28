(function () {
  'use strict';

  var INSTALL_URL = 'https://console.tapsvc.com/cli/console-cli/install.sh';
  var INSTALL_COMMAND = 'curl -fsSL ' + INSTALL_URL + ' | sh';
  var STATUS_REQUEST_TIMEOUT_MS = 15000;
  var channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('console-cli-settings')
    : null;
  var sequence = 0;
  var statusSequence = 0;
  var pending = Object.create(null);

  function $(id) { return document.getElementById(id); }

  function showMessage(text, error) {
    var node = $('message');
    node.textContent = text || '';
    node.classList.toggle('error', Boolean(error));
  }

  function isMissingCliError(error) {
    var message = error && error.message ? String(error.message) : '';
    return message.indexOf(INSTALL_URL) !== -1 || message.indexOf('未检测到本机 Console CLI') !== -1;
  }

  function setInstallGuideVisible(visible) {
    $('install-guide').hidden = !visible;
  }

  function copyUnsupportedError() {
    return new Error('当前客户端不支持复制，请手动复制安装命令');
  }

  function copyText(text) {
    var input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    var copied = false;
    try { copied = document.execCommand('copy'); } catch (_error) { copied = false; }
    input.remove();
    if (copied) return Promise.resolve();

    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        return Promise.resolve(navigator.clipboard.writeText(text)).catch(function () {
          throw copyUnsupportedError();
        });
      } catch (_error) {
        return Promise.reject(copyUnsupportedError());
      }
    }
    return Promise.reject(copyUnsupportedError());
  }

  async function copyInstallCommand(button) {
    button.disabled = true;
    try {
      await copyText(INSTALL_COMMAND);
      showMessage('安装命令已复制，请在本机终端执行后重新检查。');
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function showAccount(value) {
    var box = $('account');
    box.textContent = '';
    if (!value || value.installed !== true) {
      box.hidden = true;
      return;
    }
    var rows = [
      ['CLI', value.cli_version || '已安装'],
      ['登录', value.logged_in ? '已登录' : '未登录'],
    ];
    if (value.email) rows.push(['账号', value.email]);
    if (value.permission_level) rows.push(['权限级别', value.permission_level]);
    if (value.permission_profile) rows.push(['权限 profile', value.permission_profile]);
    rows.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'account-row';
      var key = document.createElement('span');
      key.className = 'key';
      key.textContent = item[0];
      var valueNode = document.createElement('span');
      valueNode.className = 'value';
      valueNode.textContent = item[1];
      row.appendChild(key);
      row.appendChild(valueNode);
      box.appendChild(row);
    });
    box.hidden = false;
  }

  function request(action, payload, timeoutMs) {
    if (!channel) return Promise.reject(new Error('当前 Cindy 客户端不支持插件设置操作'));
    sequence += 1;
    var reqId = 'settings-' + sequence;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        delete pending[reqId];
        reject(new Error(action === 'login' ? '登录等待超时，请调用状态检查登录结果' : '状态检查超时'));
      }, timeoutMs);
      pending[reqId] = { resolve: resolve, reject: reject, timer: timer };
      void fetch('/wake').catch(function () {});
      channel.postMessage({ type: 'settings-request', reqId: reqId, action: action, payload: payload || {} });
    });
  }

  channel && (channel.onmessage = function onMessage(event) {
    var message = event && event.data;
    if (!message || message.type !== 'settings-result' || !pending[message.reqId]) return;
    var item = pending[message.reqId];
    delete pending[message.reqId];
    clearTimeout(item.timer);
    if (message.ok) item.resolve(message.result);
    else item.reject(new Error(message.message || 'Console CLI 操作失败'));
  });

  async function checkStatus() {
    var requestSequence = ++statusSequence;
    $('status-button').disabled = true;
    showMessage('正在检查本机 Console CLI…');
    try {
      var result = await request('status', {}, STATUS_REQUEST_TIMEOUT_MS);
      if (requestSequence !== statusSequence) return;
      showAccount(result);
      setInstallGuideVisible(false);
      showMessage(result.logged_in ? 'Console 已登录' : 'CLI 已安装，请点击“登录 Console”');
    } catch (error) {
      if (requestSequence !== statusSequence) return;
      showAccount(null);
      if (isMissingCliError(error)) {
        setInstallGuideVisible(true);
        showMessage('未检测到 Console CLI，请先安装。', true);
      } else {
        setInstallGuideVisible(false);
        showMessage(error.message, true);
      }
    } finally {
      if (requestSequence === statusSequence) $('status-button').disabled = false;
    }
  }

  async function login() {
    $('login-button').disabled = true;
    showMessage('正在调用 Console CLI，浏览器授权完成后会自动返回…', false);
    try {
      var result = await request('login', {}, 660000);
      showAccount(result);
      setInstallGuideVisible(false);
      showMessage('Console 已登录');
    } catch (error) {
      if (isMissingCliError(error)) {
        setInstallGuideVisible(true);
        showMessage('未检测到 Console CLI，请先安装。', true);
      } else {
        setInstallGuideVisible(false);
        showMessage(error.message, true);
      }
    } finally {
      $('login-button').disabled = false;
    }
  }

  $('status-button').addEventListener('click', function () { void checkStatus(); });
  $('login-button').addEventListener('click', function () { void login(); });
  $('copy-install-command').addEventListener('click', function (event) { void copyInstallCommand(event.currentTarget); });
  $('retry-install').addEventListener('click', function () { void checkStatus(); });
  void checkStatus();
}());
