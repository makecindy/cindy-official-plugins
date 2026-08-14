(function () {
  'use strict';
  var KEY = 'google_calendar_account';
  var LABEL = 'Google Calendar';
  var $ = function (id) { return document.getElementById(id); };
  var REAUTH_MESSAGES = {
    'zh-CN': 'Google 授权已失效，请重新连接账号。',
    en: 'Your Google authorization has expired. Please reconnect your account.',
    ja: 'Google の認証が期限切れです。アカウントを再接続してください。',
    ko: 'Google 인증이 만료되었습니다. 계정을 다시 연결하세요.',
  };
  async function loadLocale() {
    var locale = 'en';
    var controller = new AbortController();
    var timeout = setTimeout(function abortLocaleRequest() {
      controller.abort();
    }, 2000);
    try {
      var response = await fetch('/app-context', { signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var result = await response.json();
      var requested = result && result.context && result.context.locale;
      if (Object.prototype.hasOwnProperty.call(REAUTH_MESSAGES, requested)) locale = requested;
    } catch (_err) {
      locale = 'en';
    } finally {
      clearTimeout(timeout);
    }
    document.documentElement.lang = locale;
    $('reauth').textContent = REAUTH_MESSAGES[locale];
  }
  function status(text) { $('status').textContent = text; }
  function connectError(result) {
    var labels = {
      NO_CLIENT_CONFIG: '插件缺少 OAuth 客户端配置，请更新插件',
      INVALID_CONFIG: 'OAuth 配置无效，请更新插件',
      CALLBACK_INVALID: '授权回调校验失败，请重试',
      EXCHANGE_FAILED: 'Google token 交换失败，请检查插件版本',
      NETWORK: '连接 Google 失败，请检查网络后重试',
      TIMEOUT: '授权等待超时，请重试',
      CANCELLED: '授权已取消',
      ACCOUNT_LIMIT: '已达到账号数量上限',
      VAULT_WRITE_FAILED: '账号保存失败，请重试',
    };
    var code = result && result.error ? String(result.error) : '';
    var message = labels[code] || '连接失败，请重试';
    var detail = result && result.detail ? String(result.detail).trim() : '';
    return detail ? message + '（' + detail + '）' : message;
  }
  function render(entry) {
    var box = $('accounts');
    box.textContent = '';
    var accounts = (entry && entry.accounts) || [];
    $('reauth').hidden = !accounts.some(function (account) { return account.status === 'expired'; });
    accounts.forEach(function (account) {
      var row = document.createElement('div');
      row.className = 'account';
      var email = document.createElement('span');
      email.className = 'email';
      email.textContent = account.label || account.id;
      row.appendChild(email);
      var tag = document.createElement('span');
      tag.className = 'tag' + (account.status === 'expired' ? ' expired' : '');
      tag.textContent = account.status === 'expired' ? '需重新连接' : account.isDefault ? '默认' : '';
      row.appendChild(tag);
      if (!account.isDefault && account.status !== 'expired') {
        var makeDefault = document.createElement('button');
        makeDefault.textContent = '设为默认';
        makeDefault.onclick = function () {
          void fetch('/oauth/' + KEY + '/default', { method: 'POST', body: JSON.stringify({ accountId: account.id }) }).then(load);
        };
        row.appendChild(makeDefault);
      }
      var disconnect = document.createElement('button');
      disconnect.textContent = '断开';
      disconnect.onclick = function () {
        void fetch('/oauth/' + KEY + '/accounts/' + encodeURIComponent(account.id), { method: 'DELETE' }).then(load);
      };
      row.appendChild(disconnect);
      box.appendChild(row);
    });
  }
  async function load() {
    try {
      var response = await fetch('/oauth');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var list = await response.json();
      if (!Array.isArray(list)) throw new Error('invalid response');
      render(list.find(function (item) { return item && item.key === KEY; }));
    } catch (_err) {
      render(null);
      status('账号状态加载失败，请重试');
    }
  }
  async function connect() {
    $('connect').disabled = true;
    status('已打开浏览器，请完成 ' + LABEL + ' 授权…');
    try {
      var response = await fetch('/oauth/' + KEY + '/connect', { method: 'POST' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var result = await response.json();
      if (result.ok) {
        status('已连接 ' + (result.account && result.account.label ? result.account.label : '账号'));
      } else {
        status(connectError(result));
      }
      await load();
    } catch (_err) {
      status('连接失败，请重试');
    } finally {
      $('connect').disabled = false;
    }
  }
  $('connect').onclick = function () { void connect(); };
  void loadLocale().then(load);
})();
