(function () {
  'use strict';

  var CHANNEL = 'qq-mail-settings';
  var SECRET_KEY = 'qq_mail_authorization_code';
  var MESSAGES = {
    en: {
      accountTitle: 'QQ Mail account', securedByCindy: 'Secured by Cindy',
      connected: 'Connected', disconnected: 'Not connected',
      storedLocally: 'The authorization code is encrypted and stored locally by Cindy',
      disconnect: 'Disconnect', emailLabel: 'QQ Mail address',
      secretLabel: 'IMAP/SMTP authorization code', secretPlaceholder: 'Usually a 16-character code',
      show: 'Show', hide: 'Hide', showSecret: 'Show authorization code',
      hideSecret: 'Hide authorization code',
      setupHelp: 'In QQ Mail on the web, open "Settings → Account and Security → Security Settings", enable IMAP/SMTP, and generate an authorization code. Do not enter your QQ password here.',
      connect: 'Connect and test',
      securityNotice: 'The authorization code is never included in Agent parameters or plugin main.js. Cindy provides it to the plugin Worker only while a mail request is running. IMAP/SMTP connections close immediately after each operation.',
      readFailed: 'Could not read the QQ Mail settings.',
      saveEmailFailed: 'Could not save the QQ Mail address.',
      saveSecretFailed: 'Could not securely save the authorization code.',
      clearSecretFailed: 'Could not clear the authorization code.',
      timeout: 'The connection timed out. Make sure the plugin is enabled and try again.',
      operationFailed: 'The QQ Mail connection failed. Try again.',
      missingFields: 'Enter your QQ Mail address and IMAP/SMTP authorization code.',
      connecting: 'Securely saving the authorization code and testing IMAP and SMTP...',
      connectionSucceeded: 'Connected. The authorization code is securely stored by Cindy.',
      disconnectedStatus: 'Disconnected and removed the authorization code from Cindy secure storage.',
      disconnectFailed: 'Could not disconnect. Try again.',
      stateUnavailable: 'Could not read the saved connection status.',
    },
    'zh-CN': {
      accountTitle: 'QQ 邮箱账号', securedByCindy: '由 Cindy 安全保存',
      connected: '已连接', disconnected: '未连接',
      storedLocally: '授权码已加密保存在 Cindy 本机', disconnect: '断开',
      emailLabel: 'QQ 邮箱地址', secretLabel: 'IMAP/SMTP 授权码',
      secretPlaceholder: '通常为 16 位授权码', show: '显示', hide: '隐藏',
      showSecret: '显示授权码', hideSecret: '隐藏授权码',
      setupHelp: '请先在 QQ 邮箱网页版的“设置 → 账号与安全 → 安全设置”中开启 IMAP/SMTP，并生成授权码。这里不要填写 QQ 密码。',
      connect: '连接并测试',
      securityNotice: '授权码不会进入 Agent 参数或插件 main.js，仅在执行邮箱请求时由 Cindy 临时提供给插件 Worker。邮件操作使用短连接，完成后会立即断开 IMAP/SMTP。',
      readFailed: '读取 QQ 邮箱配置失败', saveEmailFailed: '保存 QQ 邮箱地址失败',
      saveSecretFailed: '安全保存授权码失败', clearSecretFailed: '清除授权码失败',
      timeout: '连接等待超时，请确认插件已启用后重试',
      operationFailed: 'QQ 邮箱连接失败，请重试',
      missingFields: '请填写邮箱地址和 IMAP/SMTP 授权码',
      connecting: '正在安全保存授权码并测试 IMAP 和 SMTP 连接…',
      connectionSucceeded: '连接成功。授权码已由 Cindy 安全保存。',
      disconnectedStatus: '已断开并从 Cindy 安全存储中清除授权码。',
      disconnectFailed: '断开失败，请重试', stateUnavailable: '暂时无法读取已保存的连接状态',
    },
    ja: {
      accountTitle: 'QQメールアカウント', securedByCindy: 'Cindy が安全に保存',
      connected: '接続済み', disconnected: '未接続',
      storedLocally: '認証コードは暗号化され、Cindy によってローカルに保存されています',
      disconnect: '切断', emailLabel: 'QQメールアドレス',
      secretLabel: 'IMAP/SMTP 認証コード', secretPlaceholder: '通常は16文字の認証コード',
      show: '表示', hide: '非表示', showSecret: '認証コードを表示', hideSecret: '認証コードを非表示',
      setupHelp: 'QQメールのWeb版で「設定 → アカウントとセキュリティ → セキュリティ設定」を開き、IMAP/SMTPを有効にして認証コードを生成してください。QQパスワードは入力しないでください。',
      connect: '接続してテスト',
      securityNotice: '認証コードは Agent のパラメータや plugin main.js には含まれません。メールリクエストの実行中にのみ Cindy がプラグイン Worker に提供し、IMAP/SMTP 接続は各操作の完了後すぐに切断されます。',
      readFailed: 'QQメールの設定を読み込めませんでした。',
      saveEmailFailed: 'QQメールアドレスを保存できませんでした。',
      saveSecretFailed: '認証コードを安全に保存できませんでした。',
      clearSecretFailed: '認証コードを消去できませんでした。',
      timeout: '接続がタイムアウトしました。プラグインが有効か確認して再試行してください。',
      operationFailed: 'QQメールに接続できませんでした。再試行してください。',
      missingFields: 'QQメールアドレスとIMAP/SMTP認証コードを入力してください。',
      connecting: '認証コードを安全に保存し、IMAP と SMTP の接続をテストしています…',
      connectionSucceeded: '接続しました。認証コードは Cindy に安全に保存されました。',
      disconnectedStatus: '切断し、Cindy の安全なストレージから認証コードを削除しました。',
      disconnectFailed: '切断できませんでした。再試行してください。',
      stateUnavailable: '保存済みの接続状態を読み込めませんでした。',
    },
    ko: {
      accountTitle: 'QQ 메일 계정', securedByCindy: 'Cindy가 안전하게 저장',
      connected: '연결됨', disconnected: '연결되지 않음',
      storedLocally: '인증 코드는 암호화되어 Cindy가 로컬에 저장합니다',
      disconnect: '연결 해제', emailLabel: 'QQ 메일 주소',
      secretLabel: 'IMAP/SMTP 인증 코드', secretPlaceholder: '일반적으로 16자리 인증 코드',
      show: '표시', hide: '숨기기', showSecret: '인증 코드 표시', hideSecret: '인증 코드 숨기기',
      setupHelp: 'QQ 메일 웹에서 "설정 → 계정 및 보안 → 보안 설정"을 열고 IMAP/SMTP를 활성화한 뒤 인증 코드를 생성하세요. QQ 비밀번호는 입력하지 마세요.',
      connect: '연결 및 테스트',
      securityNotice: '인증 코드는 Agent 매개변수나 plugin main.js에 포함되지 않습니다. 메일 요청을 실행하는 동안에만 Cindy가 플러그인 Worker에 제공하며, 각 작업 후 IMAP/SMTP 연결은 즉시 종료됩니다.',
      readFailed: 'QQ 메일 설정을 읽을 수 없습니다.',
      saveEmailFailed: 'QQ 메일 주소를 저장할 수 없습니다.',
      saveSecretFailed: '인증 코드를 안전하게 저장할 수 없습니다.',
      clearSecretFailed: '인증 코드를 지울 수 없습니다.',
      timeout: '연결 시간이 초과되었습니다. 플러그인이 활성화되어 있는지 확인하고 다시 시도하세요.',
      operationFailed: 'QQ 메일 연결에 실패했습니다. 다시 시도하세요.',
      missingFields: 'QQ 메일 주소와 IMAP/SMTP 인증 코드를 입력하세요.',
      connecting: '인증 코드를 안전하게 저장하고 IMAP 및 SMTP 연결을 테스트하는 중...',
      connectionSucceeded: '연결되었습니다. 인증 코드는 Cindy가 안전하게 저장했습니다.',
      disconnectedStatus: '연결을 해제하고 Cindy 보안 저장소에서 인증 코드를 삭제했습니다.',
      disconnectFailed: '연결을 해제할 수 없습니다. 다시 시도하세요.',
      stateUnavailable: '저장된 연결 상태를 읽을 수 없습니다.',
    },
  };
  var currentLocale = 'en';
  var channel = new BroadcastChannel(CHANNEL);
  var pending = {};

  function $(id) {
    return document.getElementById(id);
  }

  function normalizeLocale(locale) {
    return Object.prototype.hasOwnProperty.call(MESSAGES, locale) ? locale : 'en';
  }

  function t(key) {
    return (MESSAGES[currentLocale] && MESSAGES[currentLocale][key]) || MESSAGES.en[key] || key;
  }

  function applyStaticTranslations() {
    document.documentElement.lang = currentLocale;
    document.querySelectorAll('[data-i18n]').forEach(function translate(element) {
      element.textContent = t(element.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function translatePlaceholder(element) {
      element.setAttribute('placeholder', t(element.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function translateAria(element) {
      element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria-label')));
    });
  }

  async function loadHostLocale() {
    try {
      var response = await fetch('/app-context');
      var result = await response.json();
      currentLocale = normalizeLocale(result && result.context && result.context.locale);
    } catch (_error) {
      currentLocale = 'en';
    }
    applyStaticTranslations();
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
    $('stateBadge').textContent = connected ? t('connected') : t('disconnected');
    $('stateBadge').classList.toggle('connected', connected);
    $('connectedCard').hidden = !connected;
    $('connectForm').hidden = connected;
    $('connectedEmail').textContent = connected && state.email ? state.email : '';
  }

  async function readJson(path) {
    var response = await fetch(path);
    if (!response.ok) throw new Error(t('readFailed'));
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

  async function saveEmail(email) {
    var current = await readJson('/kv');
    var data = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    data.email = email;
    var response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(data) });
    if (!response.ok) throw new Error(t('saveEmailFailed'));
  }

  async function saveAuthorizationCode(value) {
    var response = await fetch('/secrets/' + SECRET_KEY, {
      method: 'PUT',
      body: JSON.stringify({ value: value }),
    });
    if (!response.ok) throw new Error(t('saveSecretFailed'));
  }

  async function removeAuthorizationCode() {
    var response = await fetch('/secrets/' + SECRET_KEY, { method: 'DELETE' });
    if (!response.ok) throw new Error(t('clearSecretFailed'));
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
        reject(new Error(t('timeout')));
      }, timeoutMs || 20000);
      pending[reqId] = function finish(response) {
        if (settled) return;
        settled = true;
        if (retry) clearInterval(retry);
        clearTimeout(deadline);
        delete pending[reqId];
        if (response.ok) resolve(response.result || {});
        else reject(new Error(t('operationFailed')));
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
      showStatus(t('missingFields'), true);
      return;
    }
    setBusy(true);
    showStatus(t('connecting'));
    $('authorizationCode').value = '';
    var secretStored = false;
    try {
      await saveEmail(email);
      await saveAuthorizationCode(authorizationCode);
      secretStored = true;
      authorizationCode = '';
      var state = await sendConnect(email, 50000);
      render(state);
      showStatus(t('connectionSucceeded'));
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
      showStatus(error && error.message ? error.message : t('operationFailed'), true);
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
      showStatus(t('disconnectedStatus'));
    } catch (error) {
      showStatus(error && error.message ? error.message : t('disconnectFailed'), true);
    } finally {
      setBusy(false);
    }
  }

  function toggleSecret() {
    var input = $('authorizationCode');
    var reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('toggleSecret').textContent = reveal ? t('hide') : t('show');
    $('toggleSecret').setAttribute('aria-label', reveal ? t('hideSecret') : t('showSecret'));
  }

  $('connectForm').addEventListener('submit', function (event) { void connect(event); });
  $('disconnect').addEventListener('click', function () { void disconnect(); });
  $('toggleSecret').addEventListener('click', toggleSecret);

  void loadHostLocale().then(async function init() {
    try {
      var state = await loadState();
      if (state.email) $('email').value = state.email;
      render(state);
    } catch (_error) {
      render({ connected: false });
      showStatus(t('stateUnavailable'), true);
    }
  });
})();
