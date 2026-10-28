/**
 * Gitea settings page script (loaded externally; CSP forbids inline script).
 * Data plane, all same-origin:
 *   GET    /app-context                    -> { context: { locale } } (only language source)
 *   GET    /connections                    -> [{ key, connections: [{ id, host, isDefault, tail }] }]
 *   POST   /connections/gitea_conn         { host, token } -> host confirms and stores the token
 *   DELETE /connections/gitea_conn/<id>
 *   POST   /connections/gitea_conn/default { connectionId }
 *   GET/PUT /kv                            -> { connectedUsers: { <connectionId>: login } } display cache
 *   GET    /wake                           -> wake the logic page
 * "Test" posts { type: 'test-connection', reqId, connectionId } on the
 * BroadcastChannel and waits for the matching test-connection-result.
 */

/*
 * Settings copy follows the host locale only (same-origin GET /app-context),
 * never the browser or OS language; unknown locales and failed lookups fall
 * back to English. The host reloads this page when the language changes, so
 * the locale is read once. settings.html points at the keys below through
 * data-i18n / data-i18n-title / data-i18n-aria-label / data-i18n-placeholder.
 */
var MESSAGES = {
  en: {
    title: 'Gitea instances',
    badge: 'Self-hosted',
    help: 'Create a token in Gitea under Settings > Applications. Reads need read:user, read:repository, read:issue and read:notification; writes also need write:issue and write:repository. Only https on port 443 is supported.',
    hostPlaceholder: 'Instance, e.g. git.example.com or https://git.example.com',
    hostAria: 'Instance URL',
    tokenPlaceholder: 'Access token',
    tokenAria: 'Access token',
    toggleTitle: 'Show or hide',
    toggleAria: 'Show or hide token',
    add: 'Add',
    empty: 'No Gitea instance added yet.',
    tail: 'ends in {tail}',
    isDefault: 'Default',
    makeDefault: 'Make default',
    test: 'Test',
    remove: 'Remove',
    loadFailed: 'Could not load the instance list. Try again.',
    needHost: 'Enter the instance address first (for example git.example.com).',
    needToken: 'Paste an access token first.',
    onlyHttps: 'Only https instances are supported.',
    onlyPort443: 'Only the default https port 443 is supported.',
    noPath: 'Enter only the host. Gitea under a sub-path is not supported.',
    badHost: 'That does not look like a host name.',
    confirmAdd: 'Confirm adding the instance in the system dialog...',
    confirmReplace: 'This instance already exists; confirm replacing its token in the system dialog...',
    added: 'Added {host}',
    replaced: 'Replaced the token for {host}',
    addFailedCode: 'Could not add the instance ({code}).',
    addFailed: 'Could not add the instance.',
    testing: 'Contacting Gitea...',
    testOk: 'Connected as @{username} ({host})',
    testTimeout: 'Test timed out: the plugin did not answer. Try again.',
    testFailed: 'Connection failed.',
    removed: 'Removed.',
    removeFailed: 'Could not remove the instance. Try again.',
    removeFailedCode: 'Could not remove the instance ({code}). Try again.',
    defaultFailedCode: 'Could not change the default ({code}). Try again.',
    defaultFailed: 'Could not change the default. Try again.',
    error_INVALID_HOST: 'Invalid instance address: use a bare host such as git.example.com (https, port 443).',
    error_INVALID_TOKEN: 'The token is empty or malformed; paste it again.',
    error_TOKEN_TOO_LONG: 'The token is too long; check what was pasted.',
    error_INVALID_LABEL: 'Invalid label.',
    error_LIMIT: 'Instance limit reached (8). Remove one first.',
    error_CONFIRM_DENIED: 'Cancelled: the system dialog was not confirmed.',
    error_VAULT_WRITE_FAILED: 'Saving the token failed. Try again.',
  },
  'zh-CN': {
    title: 'Gitea 实例',
    badge: '自建',
    help: '在 Gitea 的 设置 > 应用 中创建令牌。读取需要 read:user、read:repository、read:issue 和 read:notification；写入还需要 write:issue 和 write:repository。仅支持端口 443 上的 https。',
    hostPlaceholder: '实例，例如 git.example.com 或 https://git.example.com',
    hostAria: '实例地址',
    tokenPlaceholder: '访问令牌',
    tokenAria: '访问令牌',
    toggleTitle: '显示或隐藏',
    toggleAria: '显示或隐藏令牌',
    add: '添加',
    empty: '尚未添加 Gitea 实例。',
    tail: '尾号 {tail}',
    isDefault: '默认',
    makeDefault: '设为默认',
    test: '测试',
    remove: '移除',
    loadFailed: '无法加载实例列表，请重试。',
    needHost: '请先输入实例地址（例如 git.example.com）。',
    needToken: '请先粘贴访问令牌。',
    onlyHttps: '仅支持 https 实例。',
    onlyPort443: '仅支持 https 默认端口 443。',
    noPath: '只需输入主机名，不支持部署在子路径下的 Gitea。',
    badHost: '这看起来不是有效的主机名。',
    confirmAdd: '请在系统对话框中确认添加实例……',
    confirmReplace: '该实例已存在，请在系统对话框中确认替换其令牌……',
    added: '已添加 {host}',
    replaced: '已替换 {host} 的令牌',
    addFailedCode: '无法添加实例（{code}）。',
    addFailed: '无法添加实例。',
    testing: '正在连接 Gitea……',
    testOk: '已连接为 @{username}（{host}）',
    testTimeout: '测试超时：插件没有响应，请重试。',
    testFailed: '连接失败。',
    removed: '已移除。',
    removeFailed: '无法移除实例，请重试。',
    removeFailedCode: '无法移除实例（{code}），请重试。',
    defaultFailedCode: '无法更改默认实例（{code}），请重试。',
    defaultFailed: '无法更改默认实例，请重试。',
    error_INVALID_HOST: '实例地址无效：请只填写主机名，例如 git.example.com（https，端口 443）。',
    error_INVALID_TOKEN: '令牌为空或格式不正确，请重新粘贴。',
    error_TOKEN_TOO_LONG: '令牌过长，请检查粘贴的内容。',
    error_INVALID_LABEL: '标签无效。',
    error_LIMIT: '已达到实例数量上限（8 个），请先移除一个。',
    error_CONFIRM_DENIED: '已取消：未在系统对话框中确认。',
    error_VAULT_WRITE_FAILED: '保存令牌失败，请重试。',
  },
  ja: {
    title: 'Gitea インスタンス',
    badge: 'セルフホスト',
    help: 'Gitea の 設定 > アプリケーション でトークンを作成してください。読み取りには read:user、read:repository、read:issue、read:notification が、書き込みにはさらに write:issue と write:repository が必要です。ポート 443 の https のみ対応しています。',
    hostPlaceholder: 'インスタンス（例：git.example.com または https://git.example.com）',
    hostAria: 'インスタンスの URL',
    tokenPlaceholder: 'アクセストークン',
    tokenAria: 'アクセストークン',
    toggleTitle: '表示／非表示',
    toggleAria: 'トークンの表示／非表示',
    add: '追加',
    empty: 'Gitea インスタンスはまだ追加されていません。',
    tail: '末尾 {tail}',
    isDefault: '既定',
    makeDefault: '既定にする',
    test: 'テスト',
    remove: '削除',
    loadFailed: 'インスタンス一覧を読み込めませんでした。再試行してください。',
    needHost: '先にインスタンスのアドレスを入力してください（例：git.example.com）。',
    needToken: '先にアクセストークンを貼り付けてください。',
    onlyHttps: 'https のインスタンスのみ対応しています。',
    onlyPort443: 'https の既定ポート 443 のみ対応しています。',
    noPath: 'ホスト名だけを入力してください。サブパスで公開されている Gitea には対応していません。',
    badHost: 'ホスト名として正しくないようです。',
    confirmAdd: 'システムダイアログでインスタンスの追加を確認してください…',
    confirmReplace: 'このインスタンスは既に追加されています。システムダイアログでトークンの置き換えを確認してください…',
    added: '{host} を追加しました',
    replaced: '{host} のトークンを置き換えました',
    addFailedCode: 'インスタンスを追加できませんでした（{code}）。',
    addFailed: 'インスタンスを追加できませんでした。',
    testing: 'Gitea に接続しています…',
    testOk: '@{username} として接続しました（{host}）',
    testTimeout: 'テストがタイムアウトしました：プラグインが応答しませんでした。再試行してください。',
    testFailed: '接続に失敗しました。',
    removed: '削除しました。',
    removeFailed: 'インスタンスを削除できませんでした。再試行してください。',
    removeFailedCode: 'インスタンスを削除できませんでした（{code}）。再試行してください。',
    defaultFailedCode: '既定の接続を変更できませんでした（{code}）。再試行してください。',
    defaultFailed: '既定の接続を変更できませんでした。再試行してください。',
    error_INVALID_HOST: 'インスタンスのアドレスが無効です：git.example.com のようなホスト名だけを入力してください（https、ポート 443）。',
    error_INVALID_TOKEN: 'トークンが空か、形式が正しくありません。もう一度貼り付けてください。',
    error_TOKEN_TOO_LONG: 'トークンが長すぎます。貼り付けた内容を確認してください。',
    error_INVALID_LABEL: 'ラベルが無効です。',
    error_LIMIT: 'インスタンス数の上限（8）に達しました。先に 1 つ削除してください。',
    error_CONFIRM_DENIED: 'キャンセルしました：システムダイアログで確認されませんでした。',
    error_VAULT_WRITE_FAILED: 'トークンを保存できませんでした。再試行してください。',
  },
  ko: {
    title: 'Gitea 인스턴스',
    badge: '자체 호스팅',
    help: 'Gitea의 설정 > 애플리케이션에서 토큰을 만드세요. 읽기에는 read:user, read:repository, read:issue, read:notification이 필요하고, 쓰기에는 write:issue와 write:repository도 필요합니다. 포트 443의 https만 지원합니다.',
    hostPlaceholder: '인스턴스(예: git.example.com 또는 https://git.example.com)',
    hostAria: '인스턴스 URL',
    tokenPlaceholder: '액세스 토큰',
    tokenAria: '액세스 토큰',
    toggleTitle: '표시 또는 숨기기',
    toggleAria: '토큰 표시 또는 숨기기',
    add: '추가',
    empty: '아직 추가된 Gitea 인스턴스가 없습니다.',
    tail: '끝자리 {tail}',
    isDefault: '기본',
    makeDefault: '기본으로 설정',
    test: '테스트',
    remove: '제거',
    loadFailed: '인스턴스 목록을 불러오지 못했습니다. 다시 시도하세요.',
    needHost: '먼저 인스턴스 주소를 입력하세요(예: git.example.com).',
    needToken: '먼저 액세스 토큰을 붙여넣으세요.',
    onlyHttps: 'https 인스턴스만 지원합니다.',
    onlyPort443: 'https 기본 포트 443만 지원합니다.',
    noPath: '호스트 이름만 입력하세요. 하위 경로에서 제공되는 Gitea는 지원하지 않습니다.',
    badHost: '올바른 호스트 이름이 아닌 것 같습니다.',
    confirmAdd: '시스템 대화상자에서 인스턴스 추가를 확인하세요...',
    confirmReplace: '이미 추가된 인스턴스입니다. 시스템 대화상자에서 토큰 교체를 확인하세요...',
    added: '{host}을(를) 추가했습니다',
    replaced: '{host}의 토큰을 교체했습니다',
    addFailedCode: '인스턴스를 추가하지 못했습니다({code}).',
    addFailed: '인스턴스를 추가하지 못했습니다.',
    testing: 'Gitea에 연결하는 중...',
    testOk: '@{username}(으)로 연결됨({host})',
    testTimeout: '테스트 시간이 초과되었습니다. 플러그인이 응답하지 않았습니다. 다시 시도하세요.',
    testFailed: '연결에 실패했습니다.',
    removed: '제거했습니다.',
    removeFailed: '인스턴스를 제거하지 못했습니다. 다시 시도하세요.',
    removeFailedCode: '인스턴스를 제거하지 못했습니다({code}). 다시 시도하세요.',
    defaultFailedCode: '기본 인스턴스를 변경하지 못했습니다({code}). 다시 시도하세요.',
    defaultFailed: '기본 인스턴스를 변경하지 못했습니다. 다시 시도하세요.',
    error_INVALID_HOST: '인스턴스 주소가 잘못되었습니다. git.example.com 같은 호스트 이름만 입력하세요(https, 포트 443).',
    error_INVALID_TOKEN: '토큰이 비어 있거나 형식이 잘못되었습니다. 다시 붙여넣으세요.',
    error_TOKEN_TOO_LONG: '토큰이 너무 깁니다. 붙여넣은 내용을 확인하세요.',
    error_INVALID_LABEL: '라벨이 잘못되었습니다.',
    error_LIMIT: '인스턴스 수 한도(8개)에 도달했습니다. 먼저 하나를 제거하세요.',
    error_CONFIRM_DENIED: '취소됨: 시스템 대화상자에서 확인하지 않았습니다.',
    error_VAULT_WRITE_FAILED: '토큰을 저장하지 못했습니다. 다시 시도하세요.',
  },
};

(function () {
  'use strict';

  var KEY = 'gitea_conn';
  var bc = new BroadcastChannel('gitea');

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

  function $(id) { return document.getElementById(id); }

  var statusTimer = null;
  function showStatus(text, sticky) {
    $('status').textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(function () { $('status').textContent = ''; }, 4000);
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
      ['data-i18n-aria-label', function (el, text) { el.setAttribute('aria-label', text); }],
      ['data-i18n-placeholder', function (el, text) { el.setAttribute('placeholder', text); }],
    ];
    for (var b = 0; b < bindings.length; b++) {
      var nodes = document.querySelectorAll('[' + bindings[b][0] + ']');
      for (var n = 0; n < nodes.length; n++) {
        bindings[b][1](nodes[n], t(nodes[n].getAttribute(bindings[b][0])));
      }
    }
  }

  var currentConns = [];

  function miniButton(label, onClick) {
    var b = document.createElement('button');
    b.className = 'mini';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', function () { onClick(b); });
    return b;
  }

  function renderList(conns, users) {
    var box = $('list');
    box.textContent = '';
    if (!conns.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = t('empty');
      box.appendChild(empty);
      return;
    }
    conns.forEach(function (cn) {
      var row = document.createElement('div');
      row.className = 'account';
      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = cn.host;
      var user = users && users[cn.id];
      if (user) {
        var u = document.createElement('span');
        u.className = 'user';
        u.textContent = ' @' + user;
        who.appendChild(u);
      }
      row.appendChild(who);
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = cn.tail ? t('tail', { tail: cn.tail }) : '';
      row.appendChild(tag);
      if (cn.isDefault) {
        var badge = document.createElement('span');
        badge.className = 'default-badge';
        badge.textContent = t('isDefault');
        row.appendChild(badge);
      } else {
        row.appendChild(miniButton(t('makeDefault'), function () { void setDefault(cn.id); }));
      }
      row.appendChild(miniButton(t('test'), function (b) { void test(cn.id, b); }));
      row.appendChild(miniButton(t('remove'), function () { void remove(cn.id); }));
      box.appendChild(row);
    });
  }

  async function load() {
    try {
      var conns = [];
      var list = await (await fetch('/connections')).json();
      if (Array.isArray(list)) {
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].key === KEY) {
            conns = Array.isArray(list[i].connections) ? list[i].connections : [];
            break;
          }
        }
      }
      currentConns = conns;
      var users = null;
      try {
        var kv = await (await fetch('/kv')).json();
        if (kv && typeof kv.connectedUsers === 'object') users = kv.connectedUsers;
      } catch (e) { /* only affects the @login decoration */ }
      renderList(conns, users);
    } catch (e) {
      showStatus(t('loadFailed'));
    }
  }

  /**
   * Bare lowercase host, or { error }. Mirrors the logic page: https only,
   * port 443 only, no path.
   */
  function normalizeHost(raw) {
    var s = String(raw || '').trim();
    var scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
    if (scheme) {
      if (scheme[1].toLowerCase() !== 'https') return { error: t('onlyHttps') };
      s = s.slice(scheme[0].length);
    }
    s = s.replace(/\/+$/, '');
    if (!s) return { host: '' };
    if (/[\/?#@\s]/.test(s)) return { error: t('noPath') };
    var port = /:([^:]*)$/.exec(s);
    if (port) {
      if (port[1] !== '443') return { error: t('onlyPort443') };
      s = s.slice(0, s.length - port[0].length);
    }
    s = s.toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(s)) return { error: t('badHost') };
    return { host: s };
  }

  function findByHost(host) {
    for (var i = 0; i < currentConns.length; i++) {
      if (currentConns[i].host === host) return currentConns[i];
    }
    return null;
  }

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

  async function add() {
    var parsed = normalizeHost($('host').value);
    var token = $('token').value.trim();
    if (parsed.error) { showStatus(parsed.error, true); return; }
    var host = parsed.host;
    if (!host) { showStatus(t('needHost')); return; }
    if (!token) { showStatus(t('needToken')); return; }
    var replacing = findByHost(host);
    $('add').disabled = true;
    showStatus(t(replacing ? 'confirmReplace' : 'confirmAdd'), true);
    try {
      var r = await fetch('/connections/' + KEY, { method: 'POST', body: JSON.stringify({ host: host, token: token }) });
      var d = null;
      try { d = await r.json(); } catch (e) { /* non-JSON body counts as failure */ }
      if (d && d.ok === true) {
        $('host').value = '';
        $('token').value = '';
        syncEye();
        showStatus(t(replacing ? 'replaced' : 'added', { host: host }));
        await load();
        var added = findByHost(host);
        if (added) void test(added.id, null);
        return;
      }
      var code = (d && (d.error || d.errorCode)) || '';
      showStatus(code && hasOwn.call(MESSAGES.en, 'error_' + code) ? t('error_' + code) : t('addFailedCode', { code: code || r.status }), true);
    } catch (e) {
      showStatus(t('addFailed'), true);
    } finally {
      $('add').disabled = false;
    }
  }

  /*
   * The logic page answers only after its own Gitea request, which may run
   * for REQUEST_TIMEOUT_MS (30 s) after a wake and a locale lookup (up to 3 s).
   * Waiting longer than that keeps a slow but successful test from being
   * reported as a timeout.
   */
  var TEST_TIMEOUT_MS = 45000;

  /**
   * null when the host accepted the change (2xx and no { ok: false } or error
   * code in the body; an empty body counts as success), otherwise { code }
   * with the host error code or the HTTP status.
   */
  async function hostFailure(response) {
    if (!response || typeof response.status !== 'number' || response.status < 200 || response.status >= 300) {
      return { code: response && typeof response.status === 'number' ? String(response.status) : '' };
    }
    var d = null;
    try { d = await response.json(); } catch (e) { return null; }
    if (d && typeof d === 'object' && (d.ok === false || d.error || d.errorCode)) {
      return { code: String(d.error || d.errorCode || '') };
    }
    return null;
  }

  function failureText(failure, fallbackKey, codeKey) {
    if (failure.code && hasOwn.call(MESSAGES.en, 'error_' + failure.code)) return t('error_' + failure.code);
    return failure.code ? t(codeKey, { code: failure.code }) : t(fallbackKey);
  }

  var testSeq = 0;
  async function test(connectionId, btn) {
    var reqId = 'test-' + Date.now() + '-' + (++testSeq);
    if (btn) btn.disabled = true;
    showStatus(t('testing'), true);
    try { await fetch('/wake'); } catch (e) { /* resends below cover a slow wake */ }
    var settled = false;
    var timer = null;
    // Success and timeout both end here, so the listener and timers never outlive the test.
    var finish = function (text, sticky) {
      if (settled) return;
      settled = true;
      bc.removeEventListener('message', onMsg);
      clearTimeout(deadline);
      if (timer) clearInterval(timer);
      if (btn) btn.disabled = false;
      showStatus(text, sticky);
      void load();
    };
    var onMsg = function (ev) {
      var m = ev && ev.data;
      if (!m || m.type !== 'test-connection-result' || m.reqId !== reqId) return;
      finish(m.ok ? t('testOk', { username: m.username || '', host: m.host || '' }) : (m.message || t('testFailed')), !m.ok);
    };
    var deadline = setTimeout(function () { finish(t('testTimeout'), true); }, TEST_TIMEOUT_MS);
    bc.addEventListener('message', onMsg);
    var send = function () { bc.postMessage({ type: 'test-connection', reqId: reqId, connectionId: connectionId }); };
    send();
    timer = setInterval(function () {
      if (settled) { clearInterval(timer); return; }
      send();
    }, 400);
  }

  async function remove(connectionId) {
    try {
      var r = await fetch('/connections/' + KEY + '/' + encodeURIComponent(connectionId), { method: 'DELETE' });
      var failure = await hostFailure(r);
      if (failure) {
        // The host kept the connection: keep its cached login and let load() redraw the row.
        showStatus(failureText(failure, 'removeFailed', 'removeFailedCode'), true);
        return;
      }
      try {
        var kv = await (await fetch('/kv')).json();
        if (kv && typeof kv === 'object' && kv.connectedUsers && typeof kv.connectedUsers === 'object') {
          delete kv.connectedUsers[connectionId];
          await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
        }
      } catch (e) { /* stale display cache is harmless */ }
      showStatus(t('removed'));
    } catch (e) {
      showStatus(t('removeFailed'));
    } finally {
      void load();
    }
  }

  async function setDefault(connectionId) {
    try {
      var r = await fetch('/connections/' + KEY + '/default', { method: 'POST', body: JSON.stringify({ connectionId: connectionId }) });
      var failure = await hostFailure(r);
      if (failure) showStatus(failureText(failure, 'defaultFailed', 'defaultFailedCode'), true);
    } catch (e) {
      showStatus(t('defaultFailed'), true);
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
  $('add').addEventListener('click', function () { void add(); });
  $('token').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); void add(); }
  });
  $('host').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); $('token').focus(); }
  });
  syncEye();
  // Resolve the locale before any copy is shown: list rows and status lines use it too.
  void loadLocale().then(function renderLocalized() {
    applyStaticCopy();
    void load();
  });
})();
