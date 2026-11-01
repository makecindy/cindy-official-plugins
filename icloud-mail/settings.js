/*
 * 设置页文案只跟随宿主语言(同源 GET /app-context),不读浏览器或操作系统语言;
 * 宿主语言不在表内或取不到时回退英文。宿主切换语言后会重载设置页,这里只读一次。
 * settings.html 用 data-i18n / data-i18n-aria-label 指向下表的键。
 */
var MESSAGES = {
  'zh-CN': {
    title: 'iCloud Mail 账号',
    subtle: '由 Cindy 安全保存',
    badgeConnected: '已连接',
    badgeDisconnected: '未连接',
    connectedNote: 'App 专用密码已加密保存在 Cindy 本机',
    disconnect: '断开',
    emailLabel: 'iCloud Mail 邮箱地址',
    passwordLabel: 'Apple 账户 App 专用密码',
    show: '显示',
    hide: '隐藏',
    showAria: '显示 App 专用密码',
    hideAria: '隐藏 App 专用密码',
    helpBefore: '请确认 Apple 账户已开启双重认证，然后前往 ',
    helpLink: 'Apple 账户网站',
    helpAfter: '，在“登录与安全 → App 专用密码”中生成密码。这里不要填写 Apple 账户密码。',
    connect: '连接并测试',
    privacyNote: 'App 专用密码不会进入 Agent 参数或插件 main.js，仅在执行邮箱请求时由 Cindy 临时提供给插件 Worker。邮件操作使用短连接，完成后会立即断开 IMAP/SMTP。',
    readConfigFailed: '读取 iCloud Mail 配置失败',
    saveStateFailed: '保存 iCloud Mail 连接状态失败',
    clearStateFailed: '清除 iCloud Mail 连接状态失败',
    savePasswordFailed: '安全保存 App 专用密码失败',
    removePasswordFailed: '清除 App 专用密码失败',
    connectTimeout: '连接等待超时，请确认插件已启用后重试',
    operationFailed: 'iCloud Mail 操作失败',
    missingFields: '请填写 iCloud Mail 地址和 App 专用密码',
    connecting: '正在安全保存 App 专用密码并测试 IMAP 和 SMTP 连接…',
    connected: '连接成功。App 专用密码已由 Cindy 安全保存。',
    connectFailed: '连接失败，请重试',
    disconnected: '已断开并从 Cindy 安全存储中清除 App 专用密码。',
    disconnectFailed: '断开失败，请重试',
    loadStateFailed: '暂时无法读取已保存的连接状态',
  },
  en: {
    title: 'iCloud Mail account',
    subtle: 'Stored securely by Cindy',
    badgeConnected: 'Connected',
    badgeDisconnected: 'Not connected',
    connectedNote: 'The app-specific password is stored encrypted by Cindy on this device',
    disconnect: 'Disconnect',
    emailLabel: 'iCloud Mail address',
    passwordLabel: 'Apple Account app-specific password',
    show: 'Show',
    hide: 'Hide',
    showAria: 'Show app-specific password',
    hideAria: 'Hide app-specific password',
    helpBefore: 'Make sure two-factor authentication is turned on for your Apple Account, then go to the ',
    helpLink: 'Apple Account website',
    helpAfter: ' and generate a password under "Sign-In and Security > App-Specific Passwords". Do not enter your Apple Account password here.',
    connect: 'Connect and test',
    privacyNote: 'The app-specific password never reaches Agent arguments or the plugin\'s main.js. Cindy hands it to the plugin Worker only while running a mail request. Mail operations use short-lived connections and close IMAP/SMTP as soon as they finish.',
    readConfigFailed: 'Failed to read the iCloud Mail configuration',
    saveStateFailed: 'Failed to save the iCloud Mail connection state',
    clearStateFailed: 'Failed to clear the iCloud Mail connection state',
    savePasswordFailed: 'Failed to securely save the app-specific password',
    removePasswordFailed: 'Failed to remove the app-specific password',
    connectTimeout: 'Timed out waiting for the connection. Make sure the plugin is enabled, then try again.',
    operationFailed: 'iCloud Mail operation failed',
    missingFields: 'Enter your iCloud Mail address and app-specific password',
    connecting: 'Securely saving the app-specific password and testing the IMAP and SMTP connections...',
    connected: 'Connected. Cindy has securely saved the app-specific password.',
    connectFailed: 'Connection failed. Try again.',
    disconnected: 'Disconnected and removed the app-specific password from Cindy secure storage.',
    disconnectFailed: 'Disconnect failed. Try again.',
    loadStateFailed: 'Could not read the saved connection state right now',
  },
  ja: {
    title: 'iCloudメールアカウント',
    subtle: 'Cindyが安全に保存します',
    badgeConnected: '接続済み',
    badgeDisconnected: '未接続',
    connectedNote: 'App用パスワードはこのデバイスのCindyに暗号化して保存されています',
    disconnect: '切断',
    emailLabel: 'iCloudメールアドレス',
    passwordLabel: 'Apple アカウントのApp用パスワード',
    show: '表示',
    hide: '非表示',
    showAria: 'App用パスワードを表示',
    hideAria: 'App用パスワードを非表示',
    helpBefore: 'Apple アカウントで2ファクタ認証が有効になっていることを確認してから、',
    helpLink: 'Apple アカウントの Web サイト',
    helpAfter: 'の「サインインとセキュリティ」>「App用パスワード」でパスワードを生成してください。ここには Apple アカウントのパスワードを入力しないでください。',
    connect: '接続してテスト',
    privacyNote: 'App用パスワードがAgentの引数やプラグインのmain.jsに渡されることはありません。Cindyはメール要求の実行中だけ、プラグインWorkerへ一時的に渡します。メール操作は短時間の接続を使い、完了するとすぐにIMAP/SMTPを切断します。',
    readConfigFailed: 'iCloudメールの設定を読み込めませんでした',
    saveStateFailed: 'iCloudメールの接続状態を保存できませんでした',
    clearStateFailed: 'iCloudメールの接続状態を消去できませんでした',
    savePasswordFailed: 'App用パスワードを安全に保存できませんでした',
    removePasswordFailed: 'App用パスワードを削除できませんでした',
    connectTimeout: '接続の待機がタイムアウトしました。プラグインが有効になっていることを確認してから再試行してください',
    operationFailed: 'iCloudメールの操作に失敗しました',
    missingFields: 'iCloudメールアドレスとApp用パスワードを入力してください',
    connecting: 'App用パスワードを安全に保存し、IMAPとSMTPの接続をテストしています…',
    connected: '接続しました。App用パスワードはCindyに安全に保存されました。',
    connectFailed: '接続に失敗しました。再試行してください',
    disconnected: '切断し、Cindyの安全なストレージからApp用パスワードを削除しました。',
    disconnectFailed: '切断に失敗しました。再試行してください',
    loadStateFailed: '保存済みの接続状態を現在読み込めません',
  },
  ko: {
    title: 'iCloud 메일 계정',
    subtle: 'Cindy가 안전하게 보관합니다',
    badgeConnected: '연결됨',
    badgeDisconnected: '연결 안 됨',
    connectedNote: '앱 전용 비밀번호는 이 기기의 Cindy에 암호화되어 저장됩니다',
    disconnect: '연결 해제',
    emailLabel: 'iCloud 메일 주소',
    passwordLabel: 'Apple 계정 앱 전용 비밀번호',
    show: '표시',
    hide: '숨기기',
    showAria: '앱 전용 비밀번호 표시',
    hideAria: '앱 전용 비밀번호 숨기기',
    helpBefore: 'Apple 계정에 이중 인증이 켜져 있는지 확인한 다음 ',
    helpLink: 'Apple 계정 웹사이트',
    helpAfter: '의 "로그인 및 보안 > 앱 전용 비밀번호"에서 비밀번호를 생성하세요. 여기에 Apple 계정 비밀번호를 입력하지 마세요.',
    connect: '연결 및 테스트',
    privacyNote: '앱 전용 비밀번호는 Agent 인수나 플러그인 main.js로 전달되지 않습니다. Cindy는 메일 요청을 실행하는 동안에만 플러그인 Worker에 임시로 제공합니다. 메일 작업은 짧은 연결을 사용하며 작업이 끝나면 IMAP/SMTP 연결을 즉시 종료합니다.',
    readConfigFailed: 'iCloud 메일 설정을 읽지 못했습니다',
    saveStateFailed: 'iCloud 메일 연결 상태를 저장하지 못했습니다',
    clearStateFailed: 'iCloud 메일 연결 상태를 지우지 못했습니다',
    savePasswordFailed: '앱 전용 비밀번호를 안전하게 저장하지 못했습니다',
    removePasswordFailed: '앱 전용 비밀번호를 삭제하지 못했습니다',
    connectTimeout: '연결 대기 시간이 초과되었습니다. 플러그인이 활성화되어 있는지 확인한 후 다시 시도하세요',
    operationFailed: 'iCloud 메일 작업에 실패했습니다',
    missingFields: 'iCloud 메일 주소와 앱 전용 비밀번호를 입력하세요',
    connecting: '앱 전용 비밀번호를 안전하게 저장하고 IMAP 및 SMTP 연결을 테스트하는 중…',
    connected: '연결되었습니다. 앱 전용 비밀번호가 Cindy에 안전하게 저장되었습니다.',
    connectFailed: '연결에 실패했습니다. 다시 시도하세요',
    disconnected: '연결을 해제하고 Cindy 보안 저장소에서 앱 전용 비밀번호를 삭제했습니다.',
    disconnectFailed: '연결 해제에 실패했습니다. 다시 시도하세요',
    loadStateFailed: '저장된 연결 상태를 지금 읽을 수 없습니다',
  },
};

(function () {
  'use strict';

  var CHANNEL = 'icloud-mail-settings';
  var SECRET_KEYS = {
    a: 'icloud_mail_app_password',
    b: 'icloud_mail_app_password_b',
  };
  var channel = new BroadcastChannel(CHANNEL);
  var pending = {};

  var hasOwn = Object.prototype.hasOwnProperty;
  var locale = 'en';

  function t(key) {
    var table = MESSAGES[locale];
    return hasOwn.call(table, key) ? table[key] : MESSAGES.en[key];
  }

  async function loadLocale() {
    var next = 'en';
    var controller = new AbortController();
    var timeout = setTimeout(function abortLocaleRequest() {
      controller.abort();
    }, 2000);
    try {
      var response = await fetch('/app-context', { signal: controller.signal });
      if (!response.ok) throw new Error('app-context read failed');
      var result = await response.json();
      var requested = result && result.context && result.context.locale;
      if (typeof requested === 'string' && hasOwn.call(MESSAGES, requested)) next = requested;
    } catch (_error) {
      next = 'en';
    } finally {
      clearTimeout(timeout);
    }
    locale = next;
  }

  function applyStaticCopy() {
    document.documentElement.lang = locale;
    var bindings = [
      ['data-i18n', function (el, text) { el.textContent = text; }],
      ['data-i18n-aria-label', function (el, text) { el.setAttribute('aria-label', text); }],
    ];
    for (var b = 0; b < bindings.length; b++) {
      var nodes = document.querySelectorAll('[' + bindings[b][0] + ']');
      for (var n = 0; n < nodes.length; n++) {
        bindings[b][1](nodes[n], t(nodes[n].getAttribute(bindings[b][0])));
      }
    }
  }

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
    $('appSpecificPassword').disabled = busy;
    $('toggleSecret').disabled = busy;
  }

  function render(state) {
    var connected = Boolean(state && state.connected);
    $('stateBadge').textContent = connected ? t('badgeConnected') : t('badgeDisconnected');
    $('stateBadge').classList.toggle('connected', connected);
    $('connectedCard').hidden = !connected;
    $('connectForm').hidden = connected;
    $('connectedEmail').textContent = connected && state.email ? state.email : '';
  }

  async function readJson(path) {
    var response = await fetch(path);
    if (!response.ok) throw new Error(t('readConfigFailed'));
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
    if (!response.ok) throw new Error(t('savePasswordFailed'));
  }

  async function removeAppSpecificPassword(credentialSlot) {
    var response = await fetch('/secrets/' + SECRET_KEYS[credentialSlot], { method: 'DELETE' });
    if (!response.ok) throw new Error(t('removePasswordFailed'));
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
        reject(new Error(t('connectTimeout')));
      }, timeoutMs || 20000);
      pending[reqId] = function finish(response) {
        if (settled) return;
        settled = true;
        if (retry) clearInterval(retry);
        clearTimeout(deadline);
        delete pending[reqId];
        if (response.ok) resolve(response.result || {});
        else reject(new Error(response.message || t('operationFailed')));
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
      showStatus(t('connected'));

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
      showStatus(error && error.message ? error.message : t('connectFailed'), true);
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
      showStatus(t('disconnected'));
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
      reveal ? t('hideAria') : t('showAria'),
    );
  }

  $('connectForm').addEventListener('submit', function (event) { void connect(event); });
  $('disconnect').addEventListener('click', function () { void disconnect(); });
  $('toggleSecret').addEventListener('click', toggleSecret);

  // 先定语言再出文案:连接状态和提示都要用宿主语言。
  void loadLocale().then(async function init() {
    applyStaticCopy();
    try {
      var state = await loadState();
      if (state.email) $('email').value = state.email;
      render(state);
    } catch (_error) {
      render({ connected: false });
      showStatus(t('loadStateFailed'), true);
    }
  });
})();
