(function () {
  'use strict';
  var connecting = false;
  var KEY = 'gmail_account';
  var LABEL = 'Gmail';
  var $ = function (id) { return document.getElementById(id); };
  // Copy follows only the host locale from GET /app-context; English is the fallback.
  // The host reloads this page after a language switch, so the locale is read once.
  var MESSAGES = {
    'zh-CN': { title: '已连接的账户', scopeHint: '连接 Gmail 和 Google 通讯录：读写个人联系人，读取账号资料、其他联系人及可见的企业目录。已有账号需重新连接补充授权；未补充时原邮件功能仍可使用。', connect: '连接账户', reauth: 'Google 授权已失效，请重新连接账号。',
      connectUnknown: '无法确认连接结果，请重新打开插件详情核对账号状态，再决定是否重试。',
      loadFailed: '账号状态加载失败，请重试',
      reconnectPrompt: '请在浏览器中选择 {account}，重新授权此账号。',
      browserOpened: '已打开浏览器，请完成 {label} 授权…',
      connectedOther: '已连接 {connected}；这不是所选账号，{target} 仍需重新连接。',
      connected: '已连接 {account}',
      accountFallback: '账号',
      withDetail: '{message}（{detail}）',
      errors: {
        NO_CLIENT_CONFIG: '插件缺少 OAuth 客户端配置，请更新插件',
        INVALID_CONFIG: 'OAuth 配置无效，请更新插件',
        CALLBACK_INVALID: '授权回调校验失败，请重试',
        EXCHANGE_FAILED: 'Google token 交换失败，请检查插件版本',
        NETWORK: '连接 Google 失败，请检查网络后重试',
        TIMEOUT: '授权等待超时，请重试',
        CANCELLED: '授权已取消',
        ACCOUNT_LIMIT: '已达到账号数量上限',
        VAULT_WRITE_FAILED: '账号保存失败，请重试',
      },
    },
    en: { title: 'Connected accounts', scopeHint: 'Connect Gmail and Google Contacts: manage personal contacts and read your profile, other contacts and visible Workspace directory. Reconnect existing accounts to grant the new permissions; existing mail access remains usable.', connect: 'Connect account', reauth: 'Your Google authorization has expired. Please reconnect your account.',
      connectUnknown: 'Connection outcome is unknown. Reopen plugin details and check the account status before deciding whether to retry.',
      loadFailed: 'Could not load the account status. Try again.',
      reconnectPrompt: 'In the browser, select {account} to reauthorize this account.',
      browserOpened: 'Browser opened. Complete the {label} authorization…',
      connectedOther: 'Connected {connected}, but that is not the selected account; {target} still needs to be reconnected.',
      connected: 'Connected {account}',
      accountFallback: 'account',
      withDetail: '{message} ({detail})',
      errors: {
        NO_CLIENT_CONFIG: 'The plugin is missing its OAuth client configuration. Update the plugin.',
        INVALID_CONFIG: 'Invalid OAuth configuration. Update the plugin.',
        CALLBACK_INVALID: 'Authorization callback verification failed. Try again.',
        EXCHANGE_FAILED: 'Google token exchange failed. Check the plugin version.',
        NETWORK: 'Could not connect to Google. Check your network and try again.',
        TIMEOUT: 'Timed out waiting for authorization. Try again.',
        CANCELLED: 'Authorization cancelled',
        ACCOUNT_LIMIT: 'Account limit reached',
        VAULT_WRITE_FAILED: 'Could not save the account. Try again.',
      },
    },
    ja: { title: '接続済みアカウント', scopeHint: 'Gmail と Google コンタクトを接続：個人の連絡先を管理し、プロフィール、その他の連絡先、閲覧可能な組織ディレクトリを読み取ります。既存アカウントは再接続で権限を追加できます。追加前も既存のメール権限は使用できます。', connect: 'アカウントを接続', reauth: 'Google の認証が期限切れです。アカウントを再接続してください。',
      connectUnknown: '接続結果を確認できません。プラグインの詳細を開き直してアカウントの状態を確認してから、再試行するか判断してください。',
      loadFailed: 'アカウントの状態を読み込めませんでした。再試行してください。',
      reconnectPrompt: 'ブラウザで {account} を選び、このアカウントを再認証してください。',
      browserOpened: 'ブラウザを開きました。{label} の認証を完了してください…',
      connectedOther: '{connected} を接続しました。ただし選択したアカウントではないため、{target} はまだ再接続が必要です。',
      connected: '{account} を接続しました',
      accountFallback: 'アカウント',
      withDetail: '{message}（{detail}）',
      errors: {
        NO_CLIENT_CONFIG: 'プラグインに OAuth クライアント設定がありません。プラグインを更新してください。',
        INVALID_CONFIG: 'OAuth 設定が無効です。プラグインを更新してください。',
        CALLBACK_INVALID: '認証コールバックの検証に失敗しました。再試行してください。',
        EXCHANGE_FAILED: 'Google トークンの交換に失敗しました。プラグインのバージョンを確認してください。',
        NETWORK: 'Google に接続できませんでした。ネットワークを確認してから再試行してください。',
        TIMEOUT: '認証の待機がタイムアウトしました。再試行してください。',
        CANCELLED: '認証がキャンセルされました',
        ACCOUNT_LIMIT: 'アカウント数の上限に達しました',
        VAULT_WRITE_FAILED: 'アカウントを保存できませんでした。再試行してください。',
      },
    },
    ko: { title: '연결된 계정', scopeHint: 'Gmail 및 Google 연락처 연결: 개인 연락처를 관리하고 프로필, 기타 연락처 및 열람 가능한 조직 디렉터리를 읽습니다. 기존 계정은 재연결하여 권한을 추가하세요. 추가 전에도 기존 메일 권한은 사용할 수 있습니다.', connect: '계정 연결', reauth: 'Google 인증이 만료되었습니다. 계정을 다시 연결하세요.',
      connectUnknown: '연결 결과를 확인할 수 없습니다. 플러그인 상세 페이지를 다시 열어 계정 상태를 확인한 후 재시도 여부를 결정하세요.',
      loadFailed: '계정 상태를 불러오지 못했습니다. 다시 시도하세요.',
      reconnectPrompt: '브라우저에서 {account}을(를) 선택해 이 계정을 다시 승인하세요.',
      browserOpened: '브라우저를 열었습니다. {label} 승인을 완료하세요…',
      connectedOther: '{connected}을(를) 연결했지만 선택한 계정이 아닙니다. {target}은(는) 여전히 다시 연결해야 합니다.',
      connected: '{account}을(를) 연결했습니다',
      accountFallback: '계정',
      withDetail: '{message} ({detail})',
      errors: {
        NO_CLIENT_CONFIG: '플러그인에 OAuth 클라이언트 설정이 없습니다. 플러그인을 업데이트하세요.',
        INVALID_CONFIG: 'OAuth 설정이 올바르지 않습니다. 플러그인을 업데이트하세요.',
        CALLBACK_INVALID: '승인 콜백 검증에 실패했습니다. 다시 시도하세요.',
        EXCHANGE_FAILED: 'Google 토큰 교환에 실패했습니다. 플러그인 버전을 확인하세요.',
        NETWORK: 'Google에 연결하지 못했습니다. 네트워크를 확인한 후 다시 시도하세요.',
        TIMEOUT: '승인 대기 시간이 초과되었습니다. 다시 시도하세요.',
        CANCELLED: '승인이 취소되었습니다',
        ACCOUNT_LIMIT: '계정 수 한도에 도달했습니다',
        VAULT_WRITE_FAILED: '계정을 저장하지 못했습니다. 다시 시도하세요.',
      },
    },
  };
  function messages() {
    return MESSAGES[document.documentElement.lang] || MESSAGES.en;
  }
  function t(key, values) {
    return messages()[key].replace(/\{(\w+)\}/g, function (_all, name) { return String((values || {})[name]); });
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
      if (Object.prototype.hasOwnProperty.call(MESSAGES, requested)) locale = requested;
    } catch (_err) {
      locale = 'en';
    } finally {
      clearTimeout(timeout);
    }
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
    var labels = messages().errors;
    var code = result && result.error ? String(result.error) : '';
    var message = Object.prototype.hasOwnProperty.call(labels, code) ? labels[code] : connectionUnknownMessage();
    var detail = result && result.detail ? String(result.detail).trim() : '';
    return detail ? t('withDetail', { message: message, detail: detail }) : message;
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
      status(target ? t('reconnectPrompt', { account: target.label || target.id }) : t('browserOpened', { label: LABEL }));
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
