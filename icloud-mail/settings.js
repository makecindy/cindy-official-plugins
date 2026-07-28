(function () {
  'use strict';

  var CHANNEL = 'icloud-mail-settings';
  var SECRET_KEYS = {
    a: 'icloud_mail_app_password',
    b: 'icloud_mail_app_password_b',
  };
  var MESSAGES = {
    en: {
      accountTitle: 'iCloud Mail account', securedByCindy: 'Secured by Cindy',
      connected: 'Connected', disconnected: 'Not connected',
      storedLocally: 'The app-specific password is encrypted and stored locally by Cindy',
      disconnect: 'Disconnect', emailLabel: 'iCloud Mail address',
      secretLabel: 'Apple Account app-specific password', show: 'Show', hide: 'Hide',
      showSecret: 'Show app-specific password', hideSecret: 'Hide app-specific password',
      setupHelpBefore: 'Make sure two-factor authentication is enabled for your Apple Account, then visit the',
      appleAccountWebsite: 'Apple Account website',
      setupHelpAfter: ' and generate a password under "Sign-In and Security → App-Specific Passwords". Do not enter your Apple Account password here.',
      connect: 'Connect and test',
      securityNotice: 'The app-specific password is never included in Agent parameters or plugin main.js. Cindy provides it to the plugin Worker only while a mail request is running. IMAP/SMTP connections close immediately after each operation.',
      readFailed: 'Could not read the iCloud Mail settings.',
      saveStateFailed: 'Could not save the iCloud Mail connection.',
      clearStateFailed: 'Could not clear the iCloud Mail connection.',
      saveSecretFailed: 'Could not securely save the app-specific password.',
      clearSecretFailed: 'Could not clear the app-specific password.',
      timeout: 'The connection timed out. Make sure the plugin is enabled and try again.',
      operationFailed: 'The iCloud Mail connection failed. Try again.',
      missingFields: 'Enter your iCloud Mail address and app-specific password.',
      connecting: 'Securely saving the app-specific password and testing IMAP and SMTP...',
      connectionSucceeded: 'Connected. The app-specific password is securely stored by Cindy.',
      disconnectedStatus: 'Disconnected and removed the app-specific password from Cindy secure storage.',
      disconnectFailed: 'Could not disconnect. Try again.',
      stateUnavailable: 'Could not read the saved connection status.',
    },
    'zh-CN': {
      accountTitle: 'iCloud Mail 账号', securedByCindy: '由 Cindy 安全保存',
      connected: '已连接', disconnected: '未连接',
      storedLocally: 'App 专用密码已加密保存在 Cindy 本机', disconnect: '断开',
      emailLabel: 'iCloud Mail 邮箱地址', secretLabel: 'Apple 账户 App 专用密码',
      show: '显示', hide: '隐藏', showSecret: '显示 App 专用密码', hideSecret: '隐藏 App 专用密码',
      setupHelpBefore: '请确认 Apple 账户已开启双重认证，然后前往',
      appleAccountWebsite: 'Apple 账户网站',
      setupHelpAfter: '，在“登录与安全 → App 专用密码”中生成密码。这里不要填写 Apple 账户密码。',
      connect: '连接并测试',
      securityNotice: 'App 专用密码不会进入 Agent 参数或插件 main.js，仅在执行邮箱请求时由 Cindy 临时提供给插件 Worker。邮件操作使用短连接，完成后会立即断开 IMAP/SMTP。',
      readFailed: '读取 iCloud Mail 配置失败', saveStateFailed: '保存 iCloud Mail 连接状态失败',
      clearStateFailed: '清除 iCloud Mail 连接状态失败',
      saveSecretFailed: '安全保存 App 专用密码失败', clearSecretFailed: '清除 App 专用密码失败',
      timeout: '连接等待超时，请确认插件已启用后重试',
      operationFailed: 'iCloud Mail 连接失败，请重试',
      missingFields: '请填写 iCloud Mail 地址和 App 专用密码',
      connecting: '正在安全保存 App 专用密码并测试 IMAP 和 SMTP 连接…',
      connectionSucceeded: '连接成功。App 专用密码已由 Cindy 安全保存。',
      disconnectedStatus: '已断开并从 Cindy 安全存储中清除 App 专用密码。',
      disconnectFailed: '断开失败，请重试', stateUnavailable: '暂时无法读取已保存的连接状态',
    },
    ja: {
      accountTitle: 'iCloud Mail アカウント', securedByCindy: 'Cindy が安全に保存',
      connected: '接続済み', disconnected: '未接続',
      storedLocally: 'アプリ用パスワードは暗号化され、Cindy によってローカルに保存されています',
      disconnect: '切断', emailLabel: 'iCloud Mail アドレス',
      secretLabel: 'Apple Account のアプリ用パスワード', show: '表示', hide: '非表示',
      showSecret: 'アプリ用パスワードを表示', hideSecret: 'アプリ用パスワードを非表示',
      setupHelpBefore: 'Apple Account で2ファクタ認証が有効になっていることを確認し、',
      appleAccountWebsite: 'Apple Account のWebサイト',
      setupHelpAfter: 'を開いて「サインインとセキュリティ → アプリ用パスワード」からパスワードを生成してください。Apple Account のパスワードは入力しないでください。',
      connect: '接続してテスト',
      securityNotice: 'アプリ用パスワードは Agent のパラメータや plugin main.js には含まれません。メールリクエストの実行中にのみ Cindy がプラグイン Worker に提供し、IMAP/SMTP 接続は各操作の完了後すぐに切断されます。',
      readFailed: 'iCloud Mail の設定を読み込めませんでした。',
      saveStateFailed: 'iCloud Mail の接続情報を保存できませんでした。',
      clearStateFailed: 'iCloud Mail の接続情報を消去できませんでした。',
      saveSecretFailed: 'アプリ用パスワードを安全に保存できませんでした。',
      clearSecretFailed: 'アプリ用パスワードを消去できませんでした。',
      timeout: '接続がタイムアウトしました。プラグインが有効か確認して再試行してください。',
      operationFailed: 'iCloud Mail に接続できませんでした。再試行してください。',
      missingFields: 'iCloud Mail アドレスとアプリ用パスワードを入力してください。',
      connecting: 'アプリ用パスワードを安全に保存し、IMAP と SMTP の接続をテストしています…',
      connectionSucceeded: '接続しました。アプリ用パスワードは Cindy に安全に保存されました。',
      disconnectedStatus: '切断し、Cindy の安全なストレージからアプリ用パスワードを削除しました。',
      disconnectFailed: '切断できませんでした。再試行してください。',
      stateUnavailable: '保存済みの接続状態を読み込めませんでした。',
    },
    ko: {
      accountTitle: 'iCloud Mail 계정', securedByCindy: 'Cindy가 안전하게 저장',
      connected: '연결됨', disconnected: '연결되지 않음',
      storedLocally: '앱 전용 암호는 암호화되어 Cindy가 로컬에 저장합니다',
      disconnect: '연결 해제', emailLabel: 'iCloud Mail 주소',
      secretLabel: 'Apple Account 앱 전용 암호', show: '표시', hide: '숨기기',
      showSecret: '앱 전용 암호 표시', hideSecret: '앱 전용 암호 숨기기',
      setupHelpBefore: 'Apple Account에서 이중 인증이 활성화되어 있는지 확인한 뒤',
      appleAccountWebsite: 'Apple Account 웹사이트',
      setupHelpAfter: '에서 "로그인 및 보안 → 앱 전용 암호"를 열어 암호를 생성하세요. Apple Account 암호는 입력하지 마세요.',
      connect: '연결 및 테스트',
      securityNotice: '앱 전용 암호는 Agent 매개변수나 plugin main.js에 포함되지 않습니다. 메일 요청을 실행하는 동안에만 Cindy가 플러그인 Worker에 제공하며, 각 작업 후 IMAP/SMTP 연결은 즉시 종료됩니다.',
      readFailed: 'iCloud Mail 설정을 읽을 수 없습니다.',
      saveStateFailed: 'iCloud Mail 연결을 저장할 수 없습니다.',
      clearStateFailed: 'iCloud Mail 연결을 지울 수 없습니다.',
      saveSecretFailed: '앱 전용 암호를 안전하게 저장할 수 없습니다.',
      clearSecretFailed: '앱 전용 암호를 지울 수 없습니다.',
      timeout: '연결 시간이 초과되었습니다. 플러그인이 활성화되어 있는지 확인하고 다시 시도하세요.',
      operationFailed: 'iCloud Mail 연결에 실패했습니다. 다시 시도하세요.',
      missingFields: 'iCloud Mail 주소와 앱 전용 암호를 입력하세요.',
      connecting: '앱 전용 암호를 안전하게 저장하고 IMAP 및 SMTP 연결을 테스트하는 중...',
      connectionSucceeded: '연결되었습니다. 앱 전용 암호는 Cindy가 안전하게 저장했습니다.',
      disconnectedStatus: '연결을 해제하고 Cindy 보안 저장소에서 앱 전용 암호를 삭제했습니다.',
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
    $('appSpecificPassword').disabled = busy;
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
    if (!response.ok) throw new Error(t('saveStateFailed'));
  }

  async function clearAccountState() {
    var current = await readJson('/kv');
    var data = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    delete data.email;
    delete data.credentialSlot;
    var response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(data) });
    if (!response.ok) throw new Error(t('clearStateFailed'));
  }

  async function saveAppSpecificPassword(credentialSlot, value) {
    var response = await fetch('/secrets/' + SECRET_KEYS[credentialSlot], {
      method: 'PUT',
      body: JSON.stringify({ value: value }),
    });
    if (!response.ok) throw new Error(t('saveSecretFailed'));
  }

  async function removeAppSpecificPassword(credentialSlot) {
    var response = await fetch('/secrets/' + SECRET_KEYS[credentialSlot], { method: 'DELETE' });
    if (!response.ok) throw new Error(t('clearSecretFailed'));
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
      // 设置页先叫醒浏览器 main.js；消息只含邮箱地址，不含 App 专用密码。
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
    var appSpecificPassword = $('appSpecificPassword').value.replace(/\s+/g, '');
    if (!email || !appSpecificPassword) {
      showStatus(t('missingFields'), true);
      return;
    }
    setBusy(true);
    showStatus(t('connecting'));
    $('appSpecificPassword').value = '';
    var previousState = null;
    var candidateSlot = 'a';
    var candidateStored = false;
    var commitStarted = false;
    try {
      previousState = await loadState();
      candidateSlot = previousState.savedSlots[previousState.credentialSlot]
        ? (previousState.credentialSlot === 'a' ? 'b' : 'a')
        : previousState.credentialSlot;
      await saveAppSpecificPassword(candidateSlot, appSpecificPassword);
      candidateStored = true;
      appSpecificPassword = '';
      var state = await sendConnect(email, candidateSlot, 50000);
      // PUT 的响应可能丢失；从开始提交起，候选槽位就可能已被 KV 引用，不能再删除。
      commitStarted = true;
      await saveAccountState(email, candidateSlot);
      render({ connected: true, email: state.email || email });
      showStatus(t('connectionSucceeded'));

      // 新密码验证并提交成功后，再尽力清除旧槽位；清理失败不会影响新连接。
      if (
        previousState.credentialSlot !== candidateSlot
        && previousState.savedSlots[previousState.credentialSlot]
      ) {
        try {
          await removeAppSpecificPassword(previousState.credentialSlot);
        } catch (_removeOldError) {
          // 旧槽位已不再被引用，下次连接或断开时会再次清理。
        }
      }
    } catch (error) {
      appSpecificPassword = '';
      // 只有提交开始前失败才能安全清理候选槽位。提交结果不确定时保留两个槽位，
      // 下次成功连接或断开时会清理未使用的槽位。
      if (candidateStored && !commitStarted) {
        try {
          await removeAppSpecificPassword(candidateSlot);
        } catch (_removeError) {
          // 清理失败不覆盖原始错误；候选槽位未被 KV 引用。
        }
      }
      render(previousState || { connected: false });
      showStatus(error && error.message ? error.message : t('operationFailed'), true);
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
      if (state.savedSlots[inactiveSlot]) await removeAppSpecificPassword(inactiveSlot);
      if (state.savedSlots[state.credentialSlot]) {
        await removeAppSpecificPassword(state.credentialSlot);
      }
      await clearAccountState();
      render({ connected: false });
      showStatus(t('disconnectedStatus'));
    } catch (error) {
      showStatus(error && error.message ? error.message : t('disconnectFailed'), true);
    } finally {
      setBusy(false);
    }
  }

  function toggleSecret() {
    var input = $('appSpecificPassword');
    var reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('toggleSecret').textContent = reveal ? t('hide') : t('show');
    $('toggleSecret').setAttribute(
      'aria-label',
      reveal ? t('hideSecret') : t('showSecret'),
    );
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
