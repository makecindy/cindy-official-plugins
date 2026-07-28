(function () {
  'use strict';
  var KEY = 'gmail_account';
  var LABEL = 'Gmail';
  var MESSAGES = {
    en: {
      accountTitle: 'Gmail account',
      separateAuthorization: 'Separate authorization',
      permissionHint: 'Only requests Gmail access and does not grant Calendar, Drive, or Sheets access.',
      connectAccount: 'Connect account',
      reconnectRequired: 'Reconnect required',
      defaultAccount: 'Default',
      setAsDefault: 'Set as default',
      disconnect: 'Disconnect',
      accountLoadFailed: 'Could not load account status. Try again.',
      completeAuthorization: 'A browser window has opened. Complete {label} authorization...',
      connectedAccount: 'Connected: {account}',
      accountFallback: 'account',
      connectFailed: 'Connection failed. Try again.',
    },
    'zh-CN': {
      accountTitle: 'Gmail 账号',
      separateAuthorization: '独立授权',
      permissionHint: '只授权 Gmail 权限，不会同时取得 Calendar、Drive 或 Sheets 权限。',
      connectAccount: '连接账号',
      reconnectRequired: '需重新连接',
      defaultAccount: '默认',
      setAsDefault: '设为默认',
      disconnect: '断开',
      accountLoadFailed: '账号状态加载失败，请重试',
      completeAuthorization: '已打开浏览器，请完成 {label} 授权…',
      connectedAccount: '已连接 {account}',
      accountFallback: '账号',
      connectFailed: '连接失败，请重试',
    },
    ja: {
      accountTitle: 'Gmail アカウント',
      separateAuthorization: '個別認証',
      permissionHint: 'Gmail の権限のみをリクエストし、Calendar、Drive、Sheets の権限は取得しません。',
      connectAccount: 'アカウントを接続',
      reconnectRequired: '再接続が必要',
      defaultAccount: 'デフォルト',
      setAsDefault: 'デフォルトに設定',
      disconnect: '切断',
      accountLoadFailed: 'アカウントの状態を読み込めませんでした。再試行してください。',
      completeAuthorization: 'ブラウザを開きました。{label} の認証を完了してください...',
      connectedAccount: '接続済み: {account}',
      accountFallback: 'アカウント',
      connectFailed: '接続できませんでした。再試行してください。',
    },
    ko: {
      accountTitle: 'Gmail 계정',
      separateAuthorization: '개별 인증',
      permissionHint: 'Gmail 권한만 요청하며 Calendar, Drive 또는 Sheets 권한은 요청하지 않습니다.',
      connectAccount: '계정 연결',
      reconnectRequired: '다시 연결 필요',
      defaultAccount: '기본',
      setAsDefault: '기본값으로 설정',
      disconnect: '연결 해제',
      accountLoadFailed: '계정 상태를 불러오지 못했습니다. 다시 시도하세요.',
      completeAuthorization: '브라우저를 열었습니다. {label} 인증을 완료하세요...',
      connectedAccount: '연결됨: {account}',
      accountFallback: '계정',
      connectFailed: '연결하지 못했습니다. 다시 시도하세요.',
    },
  };
  var currentLocale = 'en';
  var $ = function (id) { return document.getElementById(id); };
  function normalizeLocale(locale) {
    return Object.prototype.hasOwnProperty.call(MESSAGES, locale) ? locale : 'en';
  }
  function t(key, values) {
    var text = MESSAGES[currentLocale][key] || MESSAGES.en[key] || key;
    return text.replace(/\{(\w+)\}/g, function (_match, name) {
      return values && values[name] !== undefined ? String(values[name]) : '';
    });
  }
  function applyTranslations() {
    document.documentElement.lang = currentLocale;
    document.querySelectorAll('[data-i18n]').forEach(function (element) {
      element.textContent = t(element.getAttribute('data-i18n'));
    });
  }
  async function loadHostLocale() {
    try {
      var response = await fetch('/app-context');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var result = await response.json();
      currentLocale = normalizeLocale(result && result.context && result.context.locale);
    } catch (_err) {
      currentLocale = 'en';
    }
    applyTranslations();
  }
  function status(text) { $('status').textContent = text; }
  function connectError(result) {
    var locale = typeof currentLocale === 'string' ? currentLocale : 'zh-CN';
    if (['en', 'zh-CN', 'ja', 'ko'].indexOf(locale) < 0) locale = 'en';
    var labels = {
      en: {
        NO_CLIENT_CONFIG: 'The plugin is missing OAuth client configuration. Update the plugin.',
        INVALID_CONFIG: 'The OAuth configuration is invalid. Update the plugin.',
        CALLBACK_INVALID: 'Authorization callback validation failed. Try again.',
        EXCHANGE_FAILED: 'Google token exchange failed. Check the plugin version.',
        NETWORK: 'Could not connect to Google. Check your network and try again.',
        TIMEOUT: 'Authorization timed out. Try again.',
        CANCELLED: 'Authorization was canceled.',
        ACCOUNT_LIMIT: 'The account limit has been reached.',
        VAULT_WRITE_FAILED: 'Could not save the account. Try again.',
        DEFAULT: 'Connection failed. Try again.',
      },
      'zh-CN': {
        NO_CLIENT_CONFIG: '插件缺少 OAuth 客户端配置，请更新插件',
        INVALID_CONFIG: 'OAuth 配置无效，请更新插件',
        CALLBACK_INVALID: '授权回调校验失败，请重试',
        EXCHANGE_FAILED: 'Google token 交换失败，请检查插件版本',
        NETWORK: '连接 Google 失败，请检查网络后重试',
        TIMEOUT: '授权等待超时，请重试',
        CANCELLED: '授权已取消',
        ACCOUNT_LIMIT: '已达到账号数量上限',
        VAULT_WRITE_FAILED: '账号保存失败，请重试',
        DEFAULT: '连接失败，请重试',
      },
      ja: {
        NO_CLIENT_CONFIG: 'OAuth クライアント設定がありません。プラグインを更新してください。',
        INVALID_CONFIG: 'OAuth 設定が無効です。プラグインを更新してください。',
        CALLBACK_INVALID: '認証コールバックの検証に失敗しました。再試行してください。',
        EXCHANGE_FAILED: 'Google トークンの交換に失敗しました。プラグインのバージョンを確認してください。',
        NETWORK: 'Google に接続できませんでした。ネットワークを確認して再試行してください。',
        TIMEOUT: '認証がタイムアウトしました。再試行してください。',
        CANCELLED: '認証がキャンセルされました。',
        ACCOUNT_LIMIT: 'アカウント数の上限に達しました。',
        VAULT_WRITE_FAILED: 'アカウントを保存できませんでした。再試行してください。',
        DEFAULT: '接続できませんでした。再試行してください。',
      },
      ko: {
        NO_CLIENT_CONFIG: 'OAuth 클라이언트 설정이 없습니다. 플러그인을 업데이트하세요.',
        INVALID_CONFIG: 'OAuth 설정이 올바르지 않습니다. 플러그인을 업데이트하세요.',
        CALLBACK_INVALID: '인증 콜백 검증에 실패했습니다. 다시 시도하세요.',
        EXCHANGE_FAILED: 'Google 토큰 교환에 실패했습니다. 플러그인 버전을 확인하세요.',
        NETWORK: 'Google에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.',
        TIMEOUT: '인증 시간이 초과되었습니다. 다시 시도하세요.',
        CANCELLED: '인증이 취소되었습니다.',
        ACCOUNT_LIMIT: '계정 수 제한에 도달했습니다.',
        VAULT_WRITE_FAILED: '계정을 저장하지 못했습니다. 다시 시도하세요.',
        DEFAULT: '연결하지 못했습니다. 다시 시도하세요.',
      },
    };
    var code = result && result.error ? String(result.error) : '';
    var message = labels[locale][code] || labels[locale].DEFAULT;
    var detail = result && result.detail ? String(result.detail).trim() : '';
    var detailText = locale === 'zh-CN' || locale === 'ja'
      ? '（' + detail + '）'
      : ' (' + detail + ')';
    return detail ? message + detailText : message;
  }
  function render(entry) {
    var box = $('accounts');
    box.textContent = '';
    ((entry && entry.accounts) || []).forEach(function (account) {
      var row = document.createElement('div');
      row.className = 'account';
      var email = document.createElement('span');
      email.className = 'email';
      email.textContent = account.label || account.id;
      row.appendChild(email);
      var tag = document.createElement('span');
      tag.className = 'tag' + (account.status === 'expired' ? ' expired' : '');
      tag.textContent = account.status === 'expired'
        ? t('reconnectRequired')
        : account.isDefault ? t('defaultAccount') : '';
      row.appendChild(tag);
      if (!account.isDefault && account.status !== 'expired') {
        var makeDefault = document.createElement('button');
        makeDefault.textContent = t('setAsDefault');
        makeDefault.onclick = function () {
          void fetch('/oauth/' + KEY + '/default', {
            method: 'POST',
            body: JSON.stringify({ accountId: account.id }),
          }).then(load);
        };
        row.appendChild(makeDefault);
      }
      var disconnect = document.createElement('button');
      disconnect.textContent = t('disconnect');
      disconnect.onclick = function () {
        void fetch('/oauth/' + KEY + '/accounts/' + encodeURIComponent(account.id), {
          method: 'DELETE',
        }).then(load);
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
      status(t('accountLoadFailed'));
    }
  }
  async function connect() {
    $('connect').disabled = true;
    status(t('completeAuthorization', { label: LABEL }));
    try {
      var response = await fetch('/oauth/' + KEY + '/connect', { method: 'POST' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var result = await response.json();
      if (result.ok) {
        status(t('connectedAccount', {
          account: result.account && result.account.label ? result.account.label : t('accountFallback'),
        }));
      } else {
        status(connectError(result));
      }
      await load();
    } catch (_err) {
      status(t('connectFailed'));
    } finally {
      $('connect').disabled = false;
    }
  }
  $('connect').onclick = function () { void connect(); };
  void loadHostLocale().then(load);
})();
