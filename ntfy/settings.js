/**
 * ntfy settings page script (loaded from settings.html; CSP blocks inline scripts).
 *
 * Data plane used here (same as cindy-gitlab):
 *   GET    /connections                    -> [{ key, connections: [{ id, host, label, isDefault, tail }] }]
 *   POST   /connections/ntfy_conn          -> { host, token }; the host asks the user to confirm,
 *                                             encrypts the token and answers { ok } or { ok:false, error }.
 *                                             Posting an existing host replaces its token.
 *   DELETE /connections/ntfy_conn/<id>     -> removes one server
 *   GET/PUT /kv                            -> { defaultTopics: { <connectionId>: topic } } (not secret)
 *   GET    /app-context                    -> { context: { locale } }, the only language source
 * The page never reads a token back; it only lists hosts.
 */

/*
 * Settings copy follows the host language only (same-origin GET /app-context),
 * never the browser or OS language; an unknown or unavailable host language
 * falls back to English. The host reloads this page after a language switch, so
 * the locale is read once. settings.html points at these keys through data-i18n,
 * data-i18n-title, data-i18n-aria-label and data-i18n-placeholder. Host error
 * codes from POST /connections map to the error_<CODE> keys.
 */
var MESSAGES = {
  en: {
    title: 'ntfy servers',
    badge: 'self-hosted',
    hint: 'https only, default port 443, ntfy served at the domain root.',
    hostLabel: 'Server URL',
    hostPlaceholder: 'Server URL, e.g. https://ntfy.example.com',
    tokenLabel: 'Access token',
    tokenPlaceholder: 'Access token (tk_...)',
    topicLabel: 'Default topic',
    topicPlaceholder: 'Default topic (optional)',
    eye: 'Show or hide token',
    add: 'Add',
    empty: 'No ntfy server added yet.',
    rowTopicLabel: 'Default topic for {host}',
    save: 'Save topic',
    remove: 'Remove',
    hostRequired: 'Enter the server URL first (for example https://ntfy.example.com).',
    httpNotSupported: 'Only https servers are supported. Use the https:// address of your ntfy server.',
    portNotSupported: 'Custom ports are not supported; the server must answer on https port 443.',
    pathNotSupported: 'Enter only the server address, without a path. ntfy must be served at the root of the domain.',
    invalidHost: 'That does not look like a valid server address.',
    tokenRequired: 'Paste the access token first.',
    invalidTopic: 'Topics may contain only letters, digits, - and _ (1 to 64 characters).',
    confirmAdd: 'Confirm adding the server in the system dialog...',
    confirmReplace: 'This server already exists; its token will be replaced. Confirm in the system dialog...',
    added: 'Added {host}',
    replaced: 'Replaced the token for {host}',
    addFailed: 'Could not add the server. Please try again.',
    topicSaved: 'Default topic saved.',
    topicCleared: 'Default topic cleared.',
    topicSaveFailed: 'Could not save the default topic. Please try again.',
    addedTopicFailed: 'The server was added, but its default topic could not be saved. Set it again in the list.',
    removed: 'Server removed.',
    removeFailed: 'Could not remove the server. Please try again.',
    loadFailed: 'Could not load the server list. Please try again later.',
    error_INVALID_HOST: 'The host rejected this address. Enter only the domain (for example ntfy.example.com), https on port 443.',
    error_INVALID_TOKEN: 'The token is empty or malformed. Paste it again.',
    error_TOKEN_TOO_LONG: 'The token is too long. Check what was pasted.',
    error_INVALID_LABEL: 'Invalid label.',
    error_LIMIT: 'Server limit reached (8). Remove one you no longer use first.',
    error_CONFIRM_DENIED: 'Cancelled: the system dialog was not confirmed.',
    error_VAULT_WRITE_FAILED: 'The token could not be saved. Please try again.',
  },
  'zh-CN': {
    title: 'ntfy 服务器',
    badge: '自建',
    hint: '仅支持 https，默认端口 443，ntfy 需部署在域名根路径。',
    hostLabel: '服务器地址',
    hostPlaceholder: '服务器地址，例如 https://ntfy.example.com',
    tokenLabel: '访问令牌',
    tokenPlaceholder: '访问令牌（tk_...）',
    topicLabel: '默认主题',
    topicPlaceholder: '默认主题（可选）',
    eye: '显示或隐藏令牌',
    add: '添加',
    empty: '尚未添加 ntfy 服务器。',
    rowTopicLabel: '{host} 的默认主题',
    save: '保存主题',
    remove: '移除',
    hostRequired: '请先输入服务器地址（例如 https://ntfy.example.com）。',
    httpNotSupported: '仅支持 https 服务器。请使用 ntfy 服务器的 https:// 地址。',
    portNotSupported: '不支持自定义端口；服务器必须在 https 的 443 端口上响应。',
    pathNotSupported: '只需输入服务器地址，不要带路径。ntfy 必须部署在域名根路径。',
    invalidHost: '这看起来不是有效的服务器地址。',
    tokenRequired: '请先粘贴访问令牌。',
    invalidTopic: '主题只能包含字母、数字、- 和 _（1 到 64 个字符）。',
    confirmAdd: '请在系统对话框中确认添加该服务器……',
    confirmReplace: '该服务器已存在，其令牌将被替换。请在系统对话框中确认……',
    added: '已添加 {host}',
    replaced: '已替换 {host} 的令牌',
    addFailed: '无法添加服务器，请重试。',
    topicSaved: '默认主题已保存。',
    topicCleared: '默认主题已清除。',
    topicSaveFailed: '无法保存默认主题，请重试。',
    addedTopicFailed: '服务器已添加，但默认主题未能保存。请在列表中重新设置。',
    removed: '服务器已移除。',
    removeFailed: '无法移除服务器，请重试。',
    loadFailed: '无法加载服务器列表，请稍后再试。',
    error_INVALID_HOST: 'Cindy 拒绝了这个地址。只需输入域名（例如 ntfy.example.com），使用 https 和 443 端口。',
    error_INVALID_TOKEN: '令牌为空或格式不正确，请重新粘贴。',
    error_TOKEN_TOO_LONG: '令牌过长，请检查粘贴的内容。',
    error_INVALID_LABEL: '标签无效。',
    error_LIMIT: '已达到服务器数量上限（8 个）。请先移除不再使用的服务器。',
    error_CONFIRM_DENIED: '已取消：系统对话框未获确认。',
    error_VAULT_WRITE_FAILED: '无法保存令牌，请重试。',
  },
  ja: {
    title: 'ntfy サーバー',
    badge: 'セルフホスト',
    hint: 'https のみ、既定ポート 443、ntfy はドメインのルートで公開してください。',
    hostLabel: 'サーバー URL',
    hostPlaceholder: 'サーバー URL（例：https://ntfy.example.com）',
    tokenLabel: 'アクセストークン',
    tokenPlaceholder: 'アクセストークン（tk_...）',
    topicLabel: '既定のトピック',
    topicPlaceholder: '既定のトピック（任意）',
    eye: 'トークンを表示／非表示',
    add: '追加',
    empty: 'ntfy サーバーはまだ追加されていません。',
    rowTopicLabel: '{host} の既定のトピック',
    save: 'トピックを保存',
    remove: '削除',
    hostRequired: '先にサーバー URL を入力してください（例：https://ntfy.example.com）。',
    httpNotSupported: '対応しているのは https のサーバーのみです。ntfy サーバーの https:// アドレスを使用してください。',
    portNotSupported: 'カスタムポートには対応していません。サーバーは https のポート 443 で応答する必要があります。',
    pathNotSupported: 'パスを含めず、サーバーのアドレスだけを入力してください。ntfy はドメインのルートで公開されている必要があります。',
    invalidHost: '有効なサーバーアドレスではないようです。',
    tokenRequired: '先にアクセストークンを貼り付けてください。',
    invalidTopic: 'トピックに使えるのは英字、数字、- と _ のみです（1～64 文字）。',
    confirmAdd: 'システムダイアログでサーバーの追加を確認してください…',
    confirmReplace: 'このサーバーはすでに登録されているため、トークンが置き換えられます。システムダイアログで確認してください…',
    added: '{host} を追加しました',
    replaced: '{host} のトークンを置き換えました',
    addFailed: 'サーバーを追加できませんでした。再試行してください。',
    topicSaved: '既定のトピックを保存しました。',
    topicCleared: '既定のトピックをクリアしました。',
    topicSaveFailed: '既定のトピックを保存できませんでした。再試行してください。',
    addedTopicFailed: 'サーバーは追加されましたが、既定のトピックを保存できませんでした。一覧でもう一度設定してください。',
    removed: 'サーバーを削除しました。',
    removeFailed: 'サーバーを削除できませんでした。再試行してください。',
    loadFailed: 'サーバー一覧を読み込めませんでした。しばらくしてから再試行してください。',
    error_INVALID_HOST: 'Cindy がこのアドレスを拒否しました。ドメインのみ（例：ntfy.example.com）を入力し、https とポート 443 を使用してください。',
    error_INVALID_TOKEN: 'トークンが空か、形式が正しくありません。もう一度貼り付けてください。',
    error_TOKEN_TOO_LONG: 'トークンが長すぎます。貼り付けた内容を確認してください。',
    error_INVALID_LABEL: 'ラベルが無効です。',
    error_LIMIT: 'サーバーの上限（8 件）に達しました。先に使わなくなったサーバーを削除してください。',
    error_CONFIRM_DENIED: 'キャンセルしました：システムダイアログで確認されませんでした。',
    error_VAULT_WRITE_FAILED: 'トークンを保存できませんでした。再試行してください。',
  },
  ko: {
    title: 'ntfy 서버',
    badge: '셀프 호스팅',
    hint: 'https만 지원하며 기본 포트는 443이고, ntfy는 도메인 루트에서 제공되어야 합니다.',
    hostLabel: '서버 URL',
    hostPlaceholder: '서버 URL(예: https://ntfy.example.com)',
    tokenLabel: '액세스 토큰',
    tokenPlaceholder: '액세스 토큰(tk_...)',
    topicLabel: '기본 토픽',
    topicPlaceholder: '기본 토픽(선택 사항)',
    eye: '토큰 표시 또는 숨기기',
    add: '추가',
    empty: '아직 추가된 ntfy 서버가 없습니다.',
    rowTopicLabel: '{host}의 기본 토픽',
    save: '토픽 저장',
    remove: '삭제',
    hostRequired: '먼저 서버 URL을 입력하세요(예: https://ntfy.example.com).',
    httpNotSupported: 'https 서버만 지원합니다. ntfy 서버의 https:// 주소를 사용하세요.',
    portNotSupported: '사용자 지정 포트는 지원하지 않습니다. 서버는 https 포트 443에서 응답해야 합니다.',
    pathNotSupported: '경로 없이 서버 주소만 입력하세요. ntfy는 도메인 루트에서 제공되어야 합니다.',
    invalidHost: '올바른 서버 주소가 아닌 것 같습니다.',
    tokenRequired: '먼저 액세스 토큰을 붙여넣으세요.',
    invalidTopic: '토픽에는 영문자, 숫자, -, _만 사용할 수 있습니다(1~64자).',
    confirmAdd: '시스템 대화상자에서 서버 추가를 확인하세요...',
    confirmReplace: '이미 있는 서버이므로 토큰이 교체됩니다. 시스템 대화상자에서 확인하세요...',
    added: '{host}을(를) 추가했습니다',
    replaced: '{host}의 토큰을 교체했습니다',
    addFailed: '서버를 추가하지 못했습니다. 다시 시도하세요.',
    topicSaved: '기본 토픽을 저장했습니다.',
    topicCleared: '기본 토픽을 지웠습니다.',
    topicSaveFailed: '기본 토픽을 저장하지 못했습니다. 다시 시도하세요.',
    addedTopicFailed: '서버는 추가했지만 기본 토픽을 저장하지 못했습니다. 목록에서 다시 설정하세요.',
    removed: '서버를 삭제했습니다.',
    removeFailed: '서버를 삭제하지 못했습니다. 다시 시도하세요.',
    loadFailed: '서버 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.',
    error_INVALID_HOST: 'Cindy가 이 주소를 거부했습니다. 도메인만 입력하세요(예: ntfy.example.com). https와 포트 443을 사용합니다.',
    error_INVALID_TOKEN: '토큰이 비어 있거나 형식이 잘못되었습니다. 다시 붙여넣으세요.',
    error_TOKEN_TOO_LONG: '토큰이 너무 깁니다. 붙여넣은 내용을 확인하세요.',
    error_INVALID_LABEL: '레이블이 올바르지 않습니다.',
    error_LIMIT: '서버 개수 한도(8개)에 도달했습니다. 먼저 더 이상 사용하지 않는 서버를 삭제하세요.',
    error_CONFIRM_DENIED: '취소됨: 시스템 대화상자에서 확인하지 않았습니다.',
    error_VAULT_WRITE_FAILED: '토큰을 저장하지 못했습니다. 다시 시도하세요.',
  },
};

(function () {
  'use strict';

  var KEY = 'ntfy_conn';
  var TOPIC_RE = /^[-_A-Za-z0-9]{1,64}$/;

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
    statusTimer = null;
    if (!sticky && text) statusTimer = setTimeout(function () { $('status').textContent = ''; }, 4000);
  }

  async function loadLocale() {
    var next = 'en';
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function abortLocaleRequest() { controller.abort(); }, 2000) : null;
    try {
      var response = await fetch('/app-context', controller ? { signal: controller.signal } : undefined);
      if (!response || response.ok === false) throw new Error('app-context read failed');
      var data = await response.json();
      var requested = data && data.context && data.context.locale;
      if (typeof requested === 'string' && hasOwn.call(MESSAGES, requested)) next = requested;
    } catch (e) {
      next = 'en';
    } finally {
      if (timer) clearTimeout(timer);
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

  /**
   * Accepts "ntfy.example.com" or "https://ntfy.example.com[/]" and returns the bare
   * lowercase host. The host only supports https on port 443 for connections, and
   * ntfy cannot be served under a sub-path, so http, ports and paths are refused here.
   */
  function parseServerUrl(raw) {
    var text = String(raw || '').trim();
    if (!text) return { error: 'hostRequired' };
    if (/^http:\/\//i.test(text)) return { error: 'httpNotSupported' };
    var rest = text.replace(/^https:\/\//i, '');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rest)) return { error: 'invalidHost' };
    rest = rest.replace(/\/+$/, '');
    if (/[\/?#]/.test(rest)) return { error: 'pathNotSupported' };
    if (rest.indexOf('@') >= 0) return { error: 'invalidHost' };
    rest = rest.replace(/:443$/, '');
    if (rest.indexOf(':') >= 0) return { error: 'portNotSupported' };
    var host = rest.toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
      return { error: 'invalidHost' };
    }
    return { host: host };
  }

  async function readKv() {
    var response = await fetch('/kv');
    if (!response || response.ok === false) throw new Error('kv read failed');
    var data = await response.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }

  /*
   * Every read-modify-write of /kv (topic save, add, remove) runs through this one
   * queue and reads the latest KV inside its turn, so two saves started together
   * (for example for servers A and B) both persist instead of the last PUT winning.
   */
  var kvQueue = Promise.resolve();

  /** Read-modify-write of the whole KV object, keeping unrelated keys. */
  function writeTopic(connectionId, topic) {
    var run = kvQueue.then(async function writeTopicTurn() {
      var kv = await readKv();
      var topics = kv.defaultTopics && typeof kv.defaultTopics === 'object' && !Array.isArray(kv.defaultTopics)
        ? kv.defaultTopics : {};
      if (topic) topics[connectionId] = topic;
      else delete topics[connectionId];
      kv.defaultTopics = topics;
      var response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
      if (!response || response.ok === false) throw new Error('kv write failed');
    });
    // A failed write is reported to its caller; it must not block later writes.
    kvQueue = run.catch(function () {});
    return run;
  }

  var currentConns = [];

  function findByHost(host) {
    for (var i = 0; i < currentConns.length; i++) {
      if (String(currentConns[i].host).toLowerCase() === host) return currentConns[i];
    }
    return null;
  }

  function renderList(conns, topics) {
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
      row.className = 'server';

      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = cn.host;
      row.appendChild(who);

      var topicInput = document.createElement('input');
      topicInput.className = 'topic';
      topicInput.type = 'text';
      topicInput.placeholder = t('topicPlaceholder');
      topicInput.setAttribute('aria-label', t('rowTopicLabel', { host: cn.host }));
      topicInput.value = typeof topics[cn.id] === 'string' ? topics[cn.id] : '';
      row.appendChild(topicInput);

      var saveBtn = document.createElement('button');
      saveBtn.className = 'mini';
      saveBtn.type = 'button';
      saveBtn.textContent = t('save');
      saveBtn.addEventListener('click', function () { void saveTopic(cn.id, topicInput, saveBtn); });
      row.appendChild(saveBtn);

      var removeBtn = document.createElement('button');
      removeBtn.className = 'mini';
      removeBtn.type = 'button';
      removeBtn.textContent = t('remove');
      removeBtn.addEventListener('click', function () { void remove(cn.id, removeBtn); });
      row.appendChild(removeBtn);

      box.appendChild(row);
    });
  }

  async function load() {
    try {
      var list = await (await fetch('/connections')).json();
      var conns = [];
      if (Array.isArray(list)) {
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].key === KEY) {
            conns = Array.isArray(list[i].connections) ? list[i].connections : [];
            break;
          }
        }
      }
      currentConns = conns;
      var topics = {};
      try {
        var kv = await readKv();
        if (kv.defaultTopics && typeof kv.defaultTopics === 'object') topics = kv.defaultTopics;
      } catch (e) {
        /* topics are only a display convenience here */
      }
      renderList(conns, topics);
    } catch (e) {
      showStatus(t('loadFailed'), true);
    }
  }

  async function saveTopic(connectionId, input, btn) {
    var topic = String(input.value || '').trim();
    if (topic && !TOPIC_RE.test(topic)) { showStatus(t('invalidTopic'), true); return; }
    btn.disabled = true;
    try {
      await writeTopic(connectionId, topic);
      showStatus(topic ? t('topicSaved') : t('topicCleared'));
    } catch (e) {
      showStatus(t('topicSaveFailed'), true);
    } finally {
      btn.disabled = false;
    }
  }

  // Shared by the Add button and the Enter key: one add at a time.
  var adding = false;

  async function add() {
    if (adding) return;
    var parsed = parseServerUrl($('host').value);
    if (parsed.error) { showStatus(t(parsed.error), true); return; }
    var host = parsed.host;
    var token = String($('token').value || '').trim();
    if (!token) { showStatus(t('tokenRequired'), true); return; }
    var topic = String($('topic').value || '').trim();
    if (topic && !TOPIC_RE.test(topic)) { showStatus(t('invalidTopic'), true); return; }

    var replacing = findByHost(host);
    adding = true;
    $('add').disabled = true;
    showStatus(replacing ? t('confirmReplace') : t('confirmAdd'), true);
    try {
      var response = await fetch('/connections/' + KEY, {
        method: 'POST',
        body: JSON.stringify({ host: host, token: token }),
      });
      var data = null;
      try { data = await response.json(); } catch (e) { data = null; }
      if (!data || data.ok !== true) {
        var code = (data && (data.error || data.errorCode)) || '';
        var errorKey = 'error_' + code;
        showStatus(typeof code === 'string' && hasOwn.call(MESSAGES.en, errorKey) ? t(errorKey) : t('addFailed'), true);
        return;
      }
      $('host').value = '';
      $('token').value = '';
      $('topic').value = '';
      syncEye();
      await load();
      var added = findByHost(host);
      if (topic && added) {
        try {
          await writeTopic(added.id, topic);
          await load();
        } catch (e) {
          showStatus(t('addedTopicFailed'), true);
          return;
        }
      } else if (topic) {
        showStatus(t('addedTopicFailed'), true);
        return;
      }
      showStatus(t(replacing ? 'replaced' : 'added', { host: host }));
    } catch (e) {
      showStatus(t('addFailed'), true);
    } finally {
      adding = false;
      $('add').disabled = false;
    }
  }

  async function remove(connectionId, btn) {
    btn.disabled = true;
    try {
      var response = await fetch('/connections/' + KEY + '/' + encodeURIComponent(connectionId), { method: 'DELETE' });
      if (response && response.ok === false) throw new Error('delete failed');
      try {
        await writeTopic(connectionId, '');
      } catch (e) {
        /* a stale topic entry is harmless: it is keyed by a connection id that no longer exists */
      }
      showStatus(t('removed'));
    } catch (e) {
      showStatus(t('removeFailed'), true);
      btn.disabled = false;
    } finally {
      void load();
    }
  }

  /** The eye only reveals what is being typed; a saved token can never be read back. */
  function syncEye() {
    var input = $('token');
    var eye = $('eye');
    var empty = String(input.value || '').length === 0;
    eye.classList.toggle('hidden', empty);
    if (empty) {
      input.type = 'password';
      eye.classList.remove('revealed');
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
  $('host').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); $('token').focus(); }
  });
  $('token').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); $('topic').focus(); }
  });
  $('topic').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); void add(); }
  });
  syncEye();
  // Resolve the language before any copy is shown, list and status text included.
  void loadLocale().then(function renderLocalized() {
    applyStaticCopy();
    void load();
  });
})();
