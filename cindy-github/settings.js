/**
 * GitHub 意识设置页脚本(CSP 禁内联,外挂加载)。
 * 数据面:
 *   GET  /secrets                → [{ key, saved, tail?, hostSource?, hostAvailable? }]
 *                                  (永远拿不回 gh/PAT 值)
 *   PUT  /secrets/github_pat     → { value } 一次性入库(204)
 *   DELETE /secrets/github_pat   → 清除
 *   GET  /wake                   → 叫醒电子脑(幂等)
 * 测试连接经 BroadcastChannel('cindy-github') 递活给电子脑:
 *   发 { type:'test-connection', reqId },按 reqId 每 400ms 重发直到收到
 *   { type:'test-connection-result', reqId, ok, login, message },15s 超时。
 */
/*
 * 设置页文案只跟随宿主语言(同源 GET /app-context),不读浏览器或操作系统语言;
 * 宿主语言不在表内或取不到时回退英文。宿主切换语言后会重载设置页,这里只读一次。
 * settings.html 用 data-i18n / data-i18n-title / data-i18n-placeholder 指向下表的键。
 */
var MESSAGES = {
  'zh-CN': {
    accountTitle: 'GitHub 账号',
    accountHint: '优先使用本机 GitHub 登录，也可以展开下方的其他连接方式。',
    otherMethods: '其他连接方式',
    fallbackHint: '备用 Token 仅在本机 GitHub 登录不可用时使用。',
    eyeTitle: '显示或隐藏',
    tokenFormat: 'ghp_… 或 github_pat_…',
    tokenLink: '获取备用 Token ↗',
    test: '测试当前连接',
    clear: '清除',
    save: '保存',
    replace: '更换',
    hostConnected: '已连接 GitHub，可直接使用',
    hostNotConnected: '尚未连接 GitHub',
    hostPreferred: '优先使用',
    fallbackUsable: '可使用备用 Token',
    fallbackSaved: '已保存备用 Token',
    tail: '尾号 {tail}',
    placeholderReplace: '粘贴新的备用 Token 以更换(覆盖当前)',
    placeholderNew: '粘贴备用 Token',
    loadFailed: '状态加载失败,请稍后重试',
    pasteFirst: '请先粘贴 token',
    saveFailedStatus: '保存失败({status}),请重试',
    savedGhPreferred: '备用 Token 已保存；当前仍优先使用本机 GitHub 登录',
    savedManaged: '备用 Token 已保存，连接状态见上方。',
    savedTestHint: '备用 Token 已保存；点击“测试连接”可检查当前 GitHub 连接',
    saveFailed: '保存失败,请重试',
    testing: '正在检查当前 GitHub 连接…',
    testTimeout: '测试超时——电子脑未响应,请稍后重试',
    testFailed: '连接失败',
    cleared: '已清除',
    clearFailed: '清除失败,请重试',
  },
  en: {
    accountTitle: 'GitHub account',
    accountHint: "This computer's GitHub login is used first. You can also expand the other connection methods below.",
    otherMethods: 'Other connection methods',
    fallbackHint: "The fallback token is used only when this computer's GitHub login is unavailable.",
    eyeTitle: 'Show or hide',
    tokenFormat: 'ghp_… or github_pat_…',
    tokenLink: 'Get a fallback token ↗',
    test: 'Test current connection',
    clear: 'Clear',
    save: 'Save',
    replace: 'Replace',
    hostConnected: 'GitHub is connected and ready to use',
    hostNotConnected: 'GitHub is not connected yet',
    hostPreferred: 'Used first',
    fallbackUsable: 'Fallback token available',
    fallbackSaved: 'Fallback token saved',
    tail: 'ending in {tail}',
    placeholderReplace: 'Paste a new fallback token to replace the current one',
    placeholderNew: 'Paste a fallback token',
    loadFailed: 'Could not load the status. Try again later.',
    pasteFirst: 'Paste a token first',
    saveFailedStatus: 'Save failed ({status}). Try again.',
    savedGhPreferred: "Fallback token saved. This computer's GitHub login is still used first.",
    savedManaged: 'Fallback token saved. See the connection status above.',
    savedTestHint: 'Fallback token saved. Click "Test current connection" to check the current GitHub connection.',
    saveFailed: 'Save failed. Try again.',
    testing: 'Checking the current GitHub connection…',
    testTimeout: 'Test timed out: the plugin did not respond. Try again later.',
    testFailed: 'Connection failed',
    cleared: 'Cleared',
    clearFailed: 'Clear failed. Try again.',
  },
  ja: {
    accountTitle: 'GitHub アカウント',
    accountHint: 'このコンピュータの GitHub ログインを優先して使います。下のほかの接続方法を開いて使うこともできます。',
    otherMethods: 'ほかの接続方法',
    fallbackHint: '予備トークンは、このコンピュータの GitHub ログインが使えないときだけ使われます。',
    eyeTitle: '表示/非表示',
    tokenFormat: 'ghp_… または github_pat_…',
    tokenLink: '予備トークンを取得 ↗',
    test: '現在の接続をテスト',
    clear: '消去',
    save: '保存',
    replace: '差し替え',
    hostConnected: 'GitHub に接続済みで、そのまま使えます',
    hostNotConnected: 'GitHub にまだ接続していません',
    hostPreferred: '優先して使用',
    fallbackUsable: '予備トークンを使用可能',
    fallbackSaved: '予備トークンを保存済み',
    tail: '末尾 {tail}',
    placeholderReplace: '新しい予備トークンを貼り付けて差し替え(現在のものを上書き)',
    placeholderNew: '予備トークンを貼り付け',
    loadFailed: '状態を読み込めませんでした。しばらくしてから再試行してください',
    pasteFirst: '先にトークンを貼り付けてください',
    saveFailedStatus: '保存に失敗しました({status})。再試行してください',
    savedGhPreferred: '予備トークンを保存しました。引き続きこのコンピュータの GitHub ログインが優先されます',
    savedManaged: '予備トークンを保存しました。接続状態は上に表示されています。',
    savedTestHint: '予備トークンを保存しました。「現在の接続をテスト」をクリックすると、現在の GitHub 接続を確認できます',
    saveFailed: '保存に失敗しました。再試行してください',
    testing: '現在の GitHub 接続を確認しています…',
    testTimeout: 'テストがタイムアウトしました。プラグインが応答しません。しばらくしてから再試行してください',
    testFailed: '接続に失敗しました',
    cleared: '消去しました',
    clearFailed: '消去に失敗しました。再試行してください',
  },
  ko: {
    accountTitle: 'GitHub 계정',
    accountHint: '이 컴퓨터의 GitHub 로그인을 우선 사용합니다. 아래의 다른 연결 방법을 펼쳐 사용할 수도 있습니다.',
    otherMethods: '다른 연결 방법',
    fallbackHint: '예비 토큰은 이 컴퓨터의 GitHub 로그인을 사용할 수 없을 때만 사용됩니다.',
    eyeTitle: '표시 또는 숨기기',
    tokenFormat: 'ghp_… 또는 github_pat_…',
    tokenLink: '예비 토큰 받기 ↗',
    test: '현재 연결 테스트',
    clear: '지우기',
    save: '저장',
    replace: '교체',
    hostConnected: 'GitHub에 연결되어 바로 사용할 수 있습니다',
    hostNotConnected: '아직 GitHub에 연결되지 않았습니다',
    hostPreferred: '우선 사용',
    fallbackUsable: '예비 토큰 사용 가능',
    fallbackSaved: '예비 토큰 저장됨',
    tail: '끝자리 {tail}',
    placeholderReplace: '새 예비 토큰을 붙여넣어 교체(현재 토큰을 덮어씀)',
    placeholderNew: '예비 토큰 붙여넣기',
    loadFailed: '상태를 불러오지 못했습니다. 잠시 후 다시 시도하세요',
    pasteFirst: '먼저 토큰을 붙여넣으세요',
    saveFailedStatus: '저장하지 못했습니다({status}). 다시 시도하세요',
    savedGhPreferred: '예비 토큰을 저장했습니다. 지금은 여전히 이 컴퓨터의 GitHub 로그인을 우선 사용합니다',
    savedManaged: '예비 토큰을 저장했습니다. 연결 상태는 위에서 확인하세요.',
    savedTestHint: '예비 토큰을 저장했습니다. ‘현재 연결 테스트’를 누르면 현재 GitHub 연결을 확인할 수 있습니다',
    saveFailed: '저장하지 못했습니다. 다시 시도하세요',
    testing: '현재 GitHub 연결을 확인하는 중…',
    testTimeout: '테스트 시간이 초과되었습니다. 플러그인이 응답하지 않습니다. 잠시 후 다시 시도하세요',
    testFailed: '연결 실패',
    cleared: '지웠습니다',
    clearFailed: '지우지 못했습니다. 다시 시도하세요',
  },
};

(function () {
  'use strict';

  var KEY = 'github_pat';
  var bc = new BroadcastChannel('cindy-github');
  var ghAvailable = false;
  var hostManagedSetup = false;

  function $(id) { return document.getElementById(id); }

  var hasOwn = Object.prototype.hasOwnProperty;
  var locale = 'en';

  function t(key, vars) {
    var table = MESSAGES[locale];
    var template = hasOwn.call(table, key) ? table[key] : MESSAGES.en[key];
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      return hasOwn.call(vars, name) ? String(vars[name]) : match;
    });
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
    } catch (e) {
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
      ['data-i18n-title', function (el, text) { el.setAttribute('title', text); }],
      ['data-i18n-placeholder', function (el, text) { el.setAttribute('placeholder', text); }],
    ];
    for (var b = 0; b < bindings.length; b++) {
      var nodes = document.querySelectorAll('[' + bindings[b][0] + ']');
      for (var n = 0; n < nodes.length; n++) {
        bindings[b][1](nodes[n], t(nodes[n].getAttribute(bindings[b][0])));
      }
    }
  }

  var statusTimer = null;
  function showStatus(text, sticky) {
    $('status').textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(function () { $('status').textContent = ''; }, 4000);
  }

  /** 宿主状态卡只展示可用布尔；不缓存展示账号，避免本机切号后的旧身份误导。 */
  function renderHostAccount(available) {
    var box = $('host-account');
    box.textContent = '';
    var row = document.createElement('div');
    row.className = 'account';
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = available ? t('hostConnected') : t('hostNotConnected');
    row.appendChild(who);
    var tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = available ? t('hostPreferred') : t('fallbackUsable');
    row.appendChild(tag);
    box.appendChild(row);
  }

  /** 渲染备用 PAT 保存状态(saved + tail 指纹)。 */
  function renderFallbackAccount(saved, tail) {
    var box = $('fallback-account');
    box.textContent = '';
    if (!saved) return;
    var row = document.createElement('div');
    row.className = 'account';
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = t('fallbackSaved');
    row.appendChild(who);
    var tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = tail ? t('tail', { tail: tail }) : '';
    row.appendChild(tag);
    box.appendChild(row);
  }

  async function load() {
    try {
      var saved = false;
      var tail = '';
      var hostAvailable = false;
      var managedSetup = false;
      var list = await (await fetch('/secrets')).json();
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].key === KEY) {
          saved = Boolean(list[i].saved);
          tail = list[i].tail || '';
          hostAvailable = list[i].hostSource === 'gh-cli' && Boolean(list[i].hostAvailable);
          managedSetup = Boolean(list[i].hostManagedSetup);
        }
      }
      ghAvailable = hostAvailable;
      hostManagedSetup = managedSetup;
      $('legacy-account').hidden = managedSetup;
      $('test').hidden = managedSetup;
      if (!hostAvailable && saved) $('other-methods').open = true;
      renderHostAccount(hostAvailable);
      renderFallbackAccount(saved, tail);
      // 单凭证语义要在输入行上说破:已保存时空输入框容易被误读成"还能再绑
      // 一个",实际再存 = 覆盖唯一的一条。占位与按钮文案切成「更换」。
      $('token').placeholder = saved ? t('placeholderReplace') : t('placeholderNew');
      $('save').textContent = saved ? t('replace') : t('save');
      $('test').disabled = !hostAvailable && !saved;
      $('clear').disabled = !saved;
    } catch (e) {
      showStatus(t('loadFailed'));
    }
  }

  /**
   * 眼睛按钮只服务「正在输入的新值」的核对——已存的值永远读不回,空框时
   * 点它必然没反应,干脆藏掉免得被误会成"看已存 token"的坏按钮;隐藏同时
   * 复位密文态,下次粘贴默认遮蔽。(交互与 xd-mivo 设置页一致。)
   */
  function syncEye() {
    var input = $('token');
    var eye = $('eye');
    var empty = input.value.length === 0;
    eye.classList.toggle('hidden', empty);
    if (empty) {
      input.type = 'password';
      eye.classList.remove('revealed');
    }
  }

  async function save() {
    var input = $('token');
    var value = input.value.trim();
    if (!value) { showStatus(t('pasteFirst')); return; }
    $('save').disabled = true;
    try {
      var r = await fetch('/secrets/' + KEY, { method: 'PUT', body: JSON.stringify({ value: value }) });
      if (r.status !== 204) { showStatus(t('saveFailedStatus', { status: r.status }), true); return; }
      input.value = '';
      syncEye();
      await load();
      // 保存只确认凭证已写入；认证来源可能在异步窗口内切换，不能把
      // 「当前连接」的成功误报成刚保存的备用 Token 已验证。
      if (ghAvailable) showStatus(t('savedGhPreferred'));
      else if (hostManagedSetup) showStatus(t('savedManaged'));
      else showStatus(t('savedTestHint'));
    } catch (e) {
      showStatus(t('saveFailed'), true);
    } finally {
      $('save').disabled = false;
    }
  }

  var testSeq = 0;
  async function test() {
    var reqId = 'test-' + Date.now() + '-' + (++testSeq);
    var btn = $('test');
    btn.disabled = true;
    showStatus(t('testing'), true);
    try {
      await fetch('/wake');
    } catch (e) { /* 叫不醒也让重发兜底 */ }
    var settled = false;
    var timer = null;
    var deadline = setTimeout(function () {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      showStatus(t('testTimeout'), true);
      void load();
    }, 15000);
    bc.addEventListener('message', function onMsg(ev) {
      var m = ev && ev.data;
      if (!m || m.type !== 'test-connection-result' || m.reqId !== reqId) return;
      if (settled) return;
      settled = true;
      bc.removeEventListener('message', onMsg);
      clearTimeout(deadline);
      if (timer) clearInterval(timer);
      if (m.ok) {
        // 成功由系统提示(notify)宣告,页内不重复挂灰字,只清掉「正在连接…」。
        showStatus('');
      } else {
        // 失败保留页内:toast 几秒就消失,失败原因要留在页上照着修;
        // 且 notify 有 5s 限速,快速重试失败时页内是唯一反馈。
        showStatus(m.message || t('testFailed'), true);
      }
      void load();
    });
    var send = function () { bc.postMessage({ type: 'test-connection', reqId: reqId }); };
    send();
    timer = setInterval(function () {
      if (settled) { clearInterval(timer); return; }
      send();
    }, 400);
  }

  async function clearToken() {
    $('clear').disabled = true;
    try {
      var response = await fetch('/secrets/' + KEY, { method: 'DELETE' });
      if (response.status !== 204) throw new Error('clear-failed');
      showStatus(t('cleared'));
    } catch (e) {
      showStatus(t('clearFailed'));
    } finally {
      void load();
    }
  }

  $('eye').addEventListener('click', function () {
    var input = $('token');
    var reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('eye').classList.toggle('revealed', reveal);
  });
  $('token').addEventListener('input', syncEye);
  $('save').addEventListener('click', function () { void save(); });
  $('test').addEventListener('click', function () { void test(); });
  $('clear').addEventListener('click', function () { void clearToken(); });
  $('token').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); void save(); }
  });
  syncEye();
  // 先定语言再出文案:账号状态与保存提示都要用宿主语言。
  void loadLocale().then(function renderLocalized() {
    applyStaticCopy();
    void load();
  });
})();
