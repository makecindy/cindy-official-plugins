(function () {
  'use strict';
  var connecting = false;
  var KEY = 'gmail_account';
  var LABEL = 'Gmail';
  var $ = function (id) { return document.getElementById(id); };
  var REAUTH_MESSAGES = {
    'zh-CN': 'Google 授权已失效，请重新连接账号。',
    en: 'Your Google authorization has expired. Please reconnect your account.',
    ja: 'Google の認証が期限切れです。アカウントを再接続してください。',
    ko: 'Google 인증이 만료되었습니다. 계정을 다시 연결하세요.',
  };
  var CONNECT_UNKNOWN_MESSAGES = {
    'zh-CN': '无法确认连接结果，请重新打开插件详情核对账号状态，再决定是否重试。',
    en: 'Connection outcome is unknown. Reopen plugin details and check the account status before deciding whether to retry.',
    ja: '接続結果を確認できません。プラグインの詳細を開き直してアカウントの状態を確認してから、再試行するか判断してください。',
    ko: '연결 결과를 확인할 수 없습니다. 플러그인 상세 페이지를 다시 열어 계정 상태를 확인한 후 재시도 여부를 결정하세요.',
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
  function connectionUnknownMessage() {
    return CONNECT_UNKNOWN_MESSAGES[document.documentElement.lang] || CONNECT_UNKNOWN_MESSAGES.en;
  }
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
    var message = labels[code] || connectionUnknownMessage();
    var detail = result && result.detail ? String(result.detail).trim() : '';
    return detail ? message + '（' + detail + '）' : message;
  }
  function render(entry) {
    window.renderGoogleAccounts(KEY, (entry && entry.accounts) || [], load, connect);
  }
  async function load() {
    try {
      var response = await fetch('/oauth');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var list = await response.json();
      if (!Array.isArray(list)) throw new Error('invalid response');
      var entry = list.find(function (item) { return item && item.key === KEY; });
      var accounts = await googleAccountMetadata.list(KEY, (entry && entry.accounts) || []);
      render({ accounts: accounts });
    } catch (_err) {
      render(null);
      status('账号状态加载失败，请重试');
    }
  }
  async function connect(target) {
      if (connecting) return;
      connecting = true;
      $('connect').disabled = true;
      status(target ? '请在浏览器中选择 ' + (target.label || target.id) + '，重新授权此账号。' : '已打开浏览器，请完成 ' + LABEL + ' 授权…');
      try {
        var response = await fetch('/oauth/' + KEY + '/connect', { method: 'POST' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var result = await response.json();
      if (result.ok) {
        if (target && result.account && result.account.id !== target.id) {
          status('已连接 ' + (result.account.label || result.account.id) + '；这不是所选账号，' + (target.label || target.id) + ' 仍需重新连接。');
        } else {
          status('已连接 ' + (result.account && result.account.label ? result.account.label : '账号'));
        }
      } else {
        status(connectError(result));
      }
      await load();
    } catch (_err) {
      status(connectionUnknownMessage());
    } finally {
      connecting = false;
      $('connect').disabled = false;
    }
  }
  $('connect').onclick = function () { void connect(); };
  void loadLocale().then(load);
})();
