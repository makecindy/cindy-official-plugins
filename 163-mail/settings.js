(function () {
  'use strict';

  var CHANNEL = '163-mail-settings';
  var SECRET_KEYS = {
    a: 'mail_163_authorization_code',
    b: 'mail_163_authorization_code_b',
  };
  var MESSAGES = {
    en: {
      accountTitle: '163 Mail account',
      securedByCindy: 'Secured by Cindy',
      connected: 'Connected',
      disconnected: 'Not connected',
      storedLocally: 'The authorization password is encrypted and stored locally by Cindy',
      disconnect: 'Disconnect',
      emailLabel: '163 Mail address',
      secretLabel: 'Authorization password',
      secretPlaceholder: '16-character authorization password',
      show: 'Show',
      hide: 'Hide',
      showSecret: 'Show authorization password',
      hideSecret: 'Hide authorization password',
      setupHelp: 'In 163 Mail on the web, open "Settings → POP3/SMTP/IMAP", enable IMAP/SMTP, and generate a 16-character authorization password. Do not enter your mailbox login password here.',
      connect: 'Connect and test',
      securityNotice: 'The authorization password is never included in Agent parameters or plugin main.js. Cindy provides it to the plugin Worker only while a mail request is running. IMAP/SMTP connections close immediately after each operation.',
      readFailed: 'Could not read the 163 Mail settings.',
      saveStateFailed: 'Could not save the 163 Mail connection.',
      clearStateFailed: 'Could not clear the 163 Mail connection.',
      saveSecretFailed: 'Could not securely save the authorization password.',
      clearSecretFailed: 'Could not clear the authorization password.',
      timeout: 'The connection timed out. Make sure the plugin is enabled and try again.',
      operationFailed: 'The 163 Mail connection failed. Try again.',
      missingFields: 'Enter your 163 Mail address and authorization password.',
      connecting: 'Securely saving the authorization password and testing IMAP and SMTP...',
      connectionSucceeded: 'Connected. The authorization password is securely stored by Cindy.',
      disconnectedStatus: 'Disconnected and removed the authorization password from Cindy secure storage.',
      disconnectFailed: 'Could not disconnect. Try again.',
      stateUnavailable: 'Could not read the saved connection status.',
    },
    'zh-CN': {
      accountTitle: '163 邮箱账号', securedByCindy: '由 Cindy 安全保存',
      connected: '已连接', disconnected: '未连接',
      storedLocally: '客户端授权密码已加密保存在 Cindy 本机', disconnect: '断开',
      emailLabel: '163 邮箱地址', secretLabel: '客户端授权密码',
      secretPlaceholder: '16 位客户端授权密码', show: '显示', hide: '隐藏',
      showSecret: '显示客户端授权密码', hideSecret: '隐藏客户端授权密码',
      setupHelp: '请先在 163 邮箱网页版进入“设置 → POP3/SMTP/IMAP”，开启 IMAP/SMTP，并生成 16 位客户端授权密码。这里不要填写邮箱登录密码。',
      connect: '连接并测试',
      securityNotice: '客户端授权密码不会进入 Agent 参数或插件 main.js，仅在执行邮箱请求时由 Cindy 临时提供给插件 Worker。邮件操作使用短连接，完成后会立即断开 IMAP/SMTP。',
      readFailed: '读取 163 邮箱配置失败', saveStateFailed: '保存 163 邮箱连接状态失败',
      clearStateFailed: '清除 163 邮箱连接状态失败', saveSecretFailed: '安全保存客户端授权密码失败',
      clearSecretFailed: '清除客户端授权密码失败',
      timeout: '连接等待超时，请确认插件已启用后重试', operationFailed: '163 邮箱连接失败，请重试',
      missingFields: '请填写 163 邮箱地址和客户端授权密码',
      connecting: '正在安全保存客户端授权密码并测试 IMAP 和 SMTP 连接…',
      connectionSucceeded: '连接成功。客户端授权密码已由 Cindy 安全保存。',
      disconnectedStatus: '已断开并从 Cindy 安全存储中清除客户端授权密码。',
      disconnectFailed: '断开失败，请重试', stateUnavailable: '暂时无法读取已保存的连接状态',
    },
    ja: {
      accountTitle: '163メールアカウント', securedByCindy: 'Cindy が安全に保存',
      connected: '接続済み', disconnected: '未接続',
      storedLocally: '認証パスワードは暗号化され、Cindy によってローカルに保存されています',
      disconnect: '切断', emailLabel: '163メールアドレス', secretLabel: '認証パスワード',
      secretPlaceholder: '16文字の認証パスワード', show: '表示', hide: '非表示',
      showSecret: '認証パスワードを表示', hideSecret: '認証パスワードを非表示',
      setupHelp: '163メールのWeb版で「設定 → POP3/SMTP/IMAP」を開き、IMAP/SMTPを有効にして16文字の認証パスワードを生成してください。メールのログインパスワードは入力しないでください。',
      connect: '接続してテスト',
      securityNotice: '認証パスワードは Agent のパラメータや plugin main.js には含まれません。メールリクエストの実行中にのみ Cindy がプラグイン Worker に提供し、IMAP/SMTP 接続は各操作の完了後すぐに切断されます。',
      readFailed: '163メールの設定を読み込めませんでした。',
      saveStateFailed: '163メールの接続情報を保存できませんでした。',
      clearStateFailed: '163メールの接続情報を消去できませんでした。',
      saveSecretFailed: '認証パスワードを安全に保存できませんでした。',
      clearSecretFailed: '認証パスワードを消去できませんでした。',
      timeout: '接続がタイムアウトしました。プラグインが有効か確認して再試行してください。',
      operationFailed: '163メールに接続できませんでした。再試行してください。',
      missingFields: '163メールアドレスと認証パスワードを入力してください。',
      connecting: '認証パスワードを安全に保存し、IMAP と SMTP の接続をテストしています…',
      connectionSucceeded: '接続しました。認証パスワードは Cindy に安全に保存されました。',
      disconnectedStatus: '切断し、Cindy の安全なストレージから認証パスワードを削除しました。',
      disconnectFailed: '切断できませんでした。再試行してください。',
      stateUnavailable: '保存済みの接続状態を読み込めませんでした。',
    },
    ko: {
      accountTitle: '163 메일 계정', securedByCindy: 'Cindy가 안전하게 저장',
      connected: '연결됨', disconnected: '연결되지 않음',
      storedLocally: '인증 비밀번호는 암호화되어 Cindy가 로컬에 저장합니다',
      disconnect: '연결 해제', emailLabel: '163 메일 주소', secretLabel: '인증 비밀번호',
      secretPlaceholder: '16자리 인증 비밀번호', show: '표시', hide: '숨기기',
      showSecret: '인증 비밀번호 표시', hideSecret: '인증 비밀번호 숨기기',
      setupHelp: '163 메일 웹에서 "설정 → POP3/SMTP/IMAP"을 열고 IMAP/SMTP를 활성화한 뒤 16자리 인증 비밀번호를 생성하세요. 메일 로그인 비밀번호는 입력하지 마세요.',
      connect: '연결 및 테스트',
      securityNotice: '인증 비밀번호는 Agent 매개변수나 plugin main.js에 포함되지 않습니다. 메일 요청을 실행하는 동안에만 Cindy가 플러그인 Worker에 제공하며, 각 작업 후 IMAP/SMTP 연결은 즉시 종료됩니다.',
      readFailed: '163 메일 설정을 읽을 수 없습니다.',
      saveStateFailed: '163 메일 연결을 저장할 수 없습니다.',
      clearStateFailed: '163 메일 연결을 지울 수 없습니다.',
      saveSecretFailed: '인증 비밀번호를 안전하게 저장할 수 없습니다.',
      clearSecretFailed: '인증 비밀번호를 지울 수 없습니다.',
      timeout: '연결 시간이 초과되었습니다. 플러그인이 활성화되어 있는지 확인하고 다시 시도하세요.',
      operationFailed: '163 메일 연결에 실패했습니다. 다시 시도하세요.',
      missingFields: '163 메일 주소와 인증 비밀번호를 입력하세요.',
      connecting: '인증 비밀번호를 안전하게 저장하고 IMAP 및 SMTP 연결을 테스트하는 중...',
      connectionSucceeded: '연결되었습니다. 인증 비밀번호는 Cindy가 안전하게 저장했습니다.',
      disconnectedStatus: '연결을 해제하고 Cindy 보안 저장소에서 인증 비밀번호를 삭제했습니다.',
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

  async function saveAuthorizationCode(credentialSlot, value) {
    var response = await fetch('/secrets/' + SECRET_KEYS[credentialSlot], {
      method: 'PUT',
      body: JSON.stringify({ value: value }),
    });
    if (!response.ok) throw new Error(t('saveSecretFailed'));
  }

  async function removeAuthorizationCode(credentialSlot) {
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
      // 设置页先叫醒浏览器 main.js；消息只含邮箱地址，不含客户端授权密码。
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
    var previousState = null;
    var candidateSlot = 'a';
    var candidateStored = false;
    var committed = false;
    try {
      previousState = await loadState();
      candidateSlot = previousState.savedSlots[previousState.credentialSlot]
        ? (previousState.credentialSlot === 'a' ? 'b' : 'a')
        : previousState.credentialSlot;
      await saveAuthorizationCode(candidateSlot, authorizationCode);
      candidateStored = true;
      authorizationCode = '';
      var state = await sendConnect(email, candidateSlot, 50000);
      await saveAccountState(email, candidateSlot);
      committed = true;
      render({ connected: true, email: state.email || email });
      showStatus(t('connectionSucceeded'));

      // 新凭证验证并提交成功后，再尽力清除旧槽位；清理失败不会影响新连接。
      if (
        previousState.credentialSlot !== candidateSlot
        && previousState.savedSlots[previousState.credentialSlot]
      ) {
        try {
          await removeAuthorizationCode(previousState.credentialSlot);
        } catch (_removeOldError) {
          // 旧槽位已不再被引用，下次连接或断开时会再次清理。
        }
      }
    } catch (error) {
      authorizationCode = '';
      // 测试或提交未通过时只清理候选槽位，原有邮箱和有效凭证保持不变。
      if (candidateStored && !committed) {
        try {
          await removeAuthorizationCode(candidateSlot);
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
      if (state.savedSlots[inactiveSlot]) await removeAuthorizationCode(inactiveSlot);
      if (state.savedSlots[state.credentialSlot]) {
        await removeAuthorizationCode(state.credentialSlot);
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
    var input = $('authorizationCode');
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
