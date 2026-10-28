(function () {
  'use strict';
  var connecting = false;
  var KEY = 'google_calendar_account';
  var LABEL = 'Google Calendar';
  var $ = function (id) { return document.getElementById(id); };
  // Copy follows only the host locale from GET /app-context; English is the fallback.
  // The host reloads this page after a language switch, so the locale is read once.
  var MESSAGES = {
    'zh-CN': { title: '已连接的账户', scopeHint: '只授权 Google Calendar 权限，不会同时取得 Gmail、Drive 或 Sheets 权限。', connect: '连接账户', reauth: 'Google 授权已失效，请重新连接账号。',
      connectUnknown: '无法确认连接结果，请重新打开插件详情核对账号状态，再决定是否重试。',
      error_NO_CLIENT_CONFIG: '插件缺少 OAuth 客户端配置，请更新插件',
      error_INVALID_CONFIG: 'OAuth 配置无效，请更新插件',
      error_CALLBACK_INVALID: '授权回调校验失败，请重试',
      error_EXCHANGE_FAILED: 'Google token 交换失败，请检查插件版本',
      error_NETWORK: '连接 Google 失败，请检查网络后重试',
      error_TIMEOUT: '授权等待超时，请重试',
      error_CANCELLED: '授权已取消',
      error_ACCOUNT_LIMIT: '已达到账号数量上限',
      error_VAULT_WRITE_FAILED: '账号保存失败，请重试',
      errorDetail: '{message}（{detail}）',
      loadFailed: '账号状态加载失败，请重试',
      reauthTarget: '请在浏览器中选择 {account}，重新授权此账号。',
      browserOpened: '已打开浏览器，请完成 {plugin} 授权…',
      connectedOther: '已连接 {connected}；这不是所选账号，{target} 仍需重新连接。',
      connected: '已连接 {account}',
      accountFallback: '账号',
    },
    en: { title: 'Connected accounts', scopeHint: 'Only Google Calendar access is authorized; Gmail, Drive, and Sheets access is not requested.', connect: 'Connect account', reauth: 'Your Google authorization has expired. Please reconnect your account.',
      connectUnknown: 'Connection outcome is unknown. Reopen plugin details and check the account status before deciding whether to retry.',
      error_NO_CLIENT_CONFIG: 'The plugin is missing its OAuth client configuration. Update the plugin.',
      error_INVALID_CONFIG: 'Invalid OAuth configuration. Update the plugin.',
      error_CALLBACK_INVALID: 'Authorization callback verification failed. Try again.',
      error_EXCHANGE_FAILED: 'Google token exchange failed. Check the plugin version.',
      error_NETWORK: 'Could not connect to Google. Check your network and try again.',
      error_TIMEOUT: 'Timed out waiting for authorization. Try again.',
      error_CANCELLED: 'Authorization cancelled',
      error_ACCOUNT_LIMIT: 'Account limit reached',
      error_VAULT_WRITE_FAILED: 'Could not save the account. Try again.',
      errorDetail: '{message} ({detail})',
      loadFailed: 'Could not load the account status. Try again.',
      reauthTarget: 'In the browser, select {account} to reauthorize this account.',
      browserOpened: 'Browser opened. Complete the {plugin} authorization...',
      connectedOther: 'Connected {connected}, but that is not the selected account; {target} still needs to be reconnected.',
      connected: 'Connected {account}',
      accountFallback: 'account',
    },
    ja: { title: '接続済みアカウント', scopeHint: 'Google Calendar の権限だけを許可し、Gmail、Drive、Sheets の権限は要求しません。', connect: 'アカウントを接続', reauth: 'Google の認証が期限切れです。アカウントを再接続してください。',
      connectUnknown: '接続結果を確認できません。プラグインの詳細を開き直してアカウントの状態を確認してから、再試行するか判断してください。',
      error_NO_CLIENT_CONFIG: 'プラグインに OAuth クライアント設定がありません。プラグインを更新してください。',
      error_INVALID_CONFIG: 'OAuth の設定が無効です。プラグインを更新してください。',
      error_CALLBACK_INVALID: '認証コールバックの検証に失敗しました。再試行してください。',
      error_EXCHANGE_FAILED: 'Google トークンの交換に失敗しました。プラグインのバージョンを確認してください。',
      error_NETWORK: 'Google に接続できませんでした。ネットワークを確認して再試行してください。',
      error_TIMEOUT: '認証の待機がタイムアウトしました。再試行してください。',
      error_CANCELLED: '認証がキャンセルされました',
      error_ACCOUNT_LIMIT: 'アカウント数の上限に達しました',
      error_VAULT_WRITE_FAILED: 'アカウントを保存できませんでした。再試行してください。',
      errorDetail: '{message}（{detail}）',
      loadFailed: 'アカウントの状態を読み込めませんでした。再試行してください。',
      reauthTarget: 'ブラウザで {account} を選択し、このアカウントを再認証してください。',
      browserOpened: 'ブラウザを開きました。{plugin} の認証を完了してください…',
      connectedOther: '{connected} を接続しましたが、選択したアカウントではありません。{target} はまだ再接続が必要です。',
      connected: '{account} を接続しました',
      accountFallback: 'アカウント',
    },
    ko: { title: '연결된 계정', scopeHint: 'Google Calendar 권한만 승인하며 Gmail, Drive 또는 Sheets 권한은 요청하지 않습니다.', connect: '계정 연결', reauth: 'Google 인증이 만료되었습니다. 계정을 다시 연결하세요.',
      connectUnknown: '연결 결과를 확인할 수 없습니다. 플러그인 상세 페이지를 다시 열어 계정 상태를 확인한 후 재시도 여부를 결정하세요.',
      error_NO_CLIENT_CONFIG: '플러그인에 OAuth 클라이언트 설정이 없습니다. 플러그인을 업데이트하세요.',
      error_INVALID_CONFIG: 'OAuth 설정이 올바르지 않습니다. 플러그인을 업데이트하세요.',
      error_CALLBACK_INVALID: '인증 콜백 검증에 실패했습니다. 다시 시도하세요.',
      error_EXCHANGE_FAILED: 'Google 토큰 교환에 실패했습니다. 플러그인 버전을 확인하세요.',
      error_NETWORK: 'Google에 연결하지 못했습니다. 네트워크를 확인한 후 다시 시도하세요.',
      error_TIMEOUT: '인증 대기 시간이 초과되었습니다. 다시 시도하세요.',
      error_CANCELLED: '인증이 취소되었습니다',
      error_ACCOUNT_LIMIT: '계정 수 한도에 도달했습니다',
      error_VAULT_WRITE_FAILED: '계정을 저장하지 못했습니다. 다시 시도하세요.',
      errorDetail: '{message} ({detail})',
      loadFailed: '계정 상태를 불러오지 못했습니다. 다시 시도하세요.',
      reauthTarget: '브라우저에서 {account} 계정을 선택해 이 계정을 다시 인증하세요.',
      browserOpened: '브라우저를 열었습니다. {plugin} 인증을 완료하세요…',
      connectedOther: '{connected} 계정을 연결했지만 선택한 계정이 아닙니다. {target} 계정은 아직 다시 연결해야 합니다.',
      connected: '{account} 연결됨',
      accountFallback: '계정',
    },
  };
  var hasOwn = Object.prototype.hasOwnProperty;
  // English until /app-context answers; settings.html ships with lang="zh-CN".
  var pageLocale = 'en';
  function t(key, vars) {
    var table = MESSAGES[pageLocale];
    var template = hasOwn.call(table, key) ? table[key] : MESSAGES.en[key];
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      return hasOwn.call(vars, name) ? String(vars[name]) : match;
    });
  }
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
      if (typeof requested === 'string' && hasOwn.call(MESSAGES, requested)) locale = requested;
    } catch (_err) {
      locale = 'en';
    } finally {
      clearTimeout(timeout);
    }
    pageLocale = locale;
    document.documentElement.lang = locale;
    $('settings-title').textContent = MESSAGES[locale].title;
    $('scope-hint').textContent = MESSAGES[locale].scopeHint;
    $('connect').textContent = MESSAGES[locale].connect;
    $('reauth').textContent = MESSAGES[locale].reauth;
  }
  function status(text) { $('status').textContent = text; }
  function connectionUnknownMessage() {
    return t('connectUnknown');
  }
  function connectError(result) {
    var code = result && result.error ? String(result.error) : '';
    // Error codes are host protocol; unknown codes keep the "outcome unknown" copy.
    var message = hasOwn.call(MESSAGES.en, 'error_' + code) ? t('error_' + code) : connectionUnknownMessage();
    var detail = result && result.detail ? String(result.detail).trim() : '';
    return detail ? t('errorDetail', { message: message, detail: detail }) : message;
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
      status(t('loadFailed'));
    }
  }
  async function connect(target) {
      if (connecting) return;
      connecting = true;
      $('connect').disabled = true;
      status(target ? t('reauthTarget', { account: target.label || target.id }) : t('browserOpened', { plugin: LABEL }));
      try {
        var response = await fetch('/oauth/' + KEY + '/connect', { method: 'POST' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var result = await response.json();
      if (result.ok) {
        if (target && result.account && result.account.id !== target.id) {
          status(t('connectedOther', { connected: result.account.label || result.account.id, target: target.label || target.id }));
        } else {
          status(t('connected', { account: result.account && result.account.label ? result.account.label : t('accountFallback') }));
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
