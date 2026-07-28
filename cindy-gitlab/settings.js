/**
 * GitLab 意识设置页脚本(CSP 禁内联,外挂加载)。多连接管理版。
 * 数据面:
 *   GET  /connections                       → [{ key, label, maxConnections, connections: [{ id, host, label, isDefault, tail }] }]
 *   POST /connections/gitlab_conn           → { host, token };主机弹确认框(域名放行 + token 入库),
 *                                             失败返回结构化错误码(INVALID_HOST / LIMIT / CONFIRM_DENIED / VAULT_WRITE_FAILED);
 *                                             同 host 再次提交 = 更换该实例的 token
 *   DELETE /connections/gitlab_conn/<id>    → 删除一条连接(幂等)
 *   POST /connections/gitlab_conn/default   → { connectionId } 设默认连接
 *   GET  /kv                                → { connectedUsers?: { <connectionId>: username } } 上次测试成功的用户名(只读展示)
 *   GET  /wake                              → 叫醒电子脑(幂等)
 * 每行「测试」经 BroadcastChannel('cindy-gitlab') 递活给电子脑:
 *   发 { type:'test-connection', reqId, connectionId },按 reqId 每 400ms 重发直到收到
 *   { type:'test-connection-result', reqId, ok, username, host, message },15s 超时。
 */
(function () {
  'use strict';

  var KEY = 'gitlab_conn';
  var MESSAGES = {
    en: {
      instancesTitle: 'GitLab instances', instancesBadge: 'Self-hosted / multiple instances',
      hostPlaceholder: 'Instance URL, e.g. git.example.com', hostAria: 'GitLab instance URL',
      tokenPlaceholder: 'glpat-… Personal Access Token with api scope', tokenAria: 'GitLab Personal Access Token',
      toggleToken: 'Show or hide token', add: 'Add', noInstances: 'No GitLab instances added',
      tail: 'Ends in {tail}', defaultBadge: 'Default', setDefault: 'Set as default', test: 'Test', remove: 'Remove',
      loadFailed: 'Could not load the connection status. Try again.',
      portUnsupported: 'Custom ports are not supported. Use an HTTPS instance on the default port (443).',
      enterHost: 'Enter an instance address, such as git.example.com.', pasteToken: 'Paste a token first.',
      replaceConfirm: 'This instance already exists. Confirm replacing its token in the system dialog...',
      addConfirm: 'Confirm adding this instance in the system dialog...',
      replaced: 'Replaced the token for {host}.', added: 'Added {host}.',
      addFailed: 'Could not add ({reason}). Try again.', addRequestFailed: 'Could not add the instance. Try again.',
      connecting: 'Connecting to GitLab...', timeout: 'The connection test timed out. Try again.',
      connectionFailed: 'Connection failed.', removed: 'Instance removed.',
      removeFailed: 'Could not remove the instance. Try again.',
      defaultFailed: 'Could not set the default instance. Try again.',
      INVALID_HOST: 'The instance address is invalid. Enter only a domain such as git.example.com; HTTPS port 443 is required.',
      INVALID_TOKEN: 'The token is empty or invalid. Paste it again.',
      TOKEN_TOO_LONG: 'The token is too long. Check the pasted value.',
      INVALID_LABEL: 'The label is invalid (maximum 64 characters).',
      LIMIT: 'The connection limit has been reached (maximum 8). Remove an unused instance first.',
      CONFIRM_DENIED: 'Canceled because the system confirmation was not approved.',
      VAULT_WRITE_FAILED: 'Could not save the token. Try again.',
    },
    'zh-CN': {
      instancesTitle: 'GitLab 实例', instancesBadge: '自建 / 多实例',
      hostPlaceholder: '实例地址，例如 git.example.com', hostAria: 'GitLab 实例地址',
      tokenPlaceholder: 'glpat-…（具有 api scope 的 Personal Access Token）', tokenAria: 'GitLab Personal Access Token',
      toggleToken: '显示或隐藏 token', add: '添加', noInstances: '尚未添加 GitLab 实例',
      tail: '尾号 {tail}', defaultBadge: '默认', setDefault: '设为默认', test: '测试', remove: '删除',
      loadFailed: '状态加载失败，请稍后重试',
      portUnsupported: '暂不支持带端口的实例——出网通道仅支持 HTTPS 默认端口（443）',
      enterHost: '请先填实例地址（如 git.example.com）', pasteToken: '请先粘贴 token',
      replaceConfirm: '该实例已存在，将更换其 token——请在系统弹窗中确认…',
      addConfirm: '请在系统弹窗中确认添加…', replaced: '已更换 {host} 的 token', added: '已添加 {host}',
      addFailed: '添加失败（{reason}），请重试', addRequestFailed: '添加失败，请重试',
      connecting: '正在连接 GitLab 验证…', timeout: '测试超时——电子脑未响应，请稍后重试',
      connectionFailed: '连接失败', removed: '已删除', removeFailed: '删除失败，请重试',
      defaultFailed: '设默认失败，请重试',
      INVALID_HOST: '实例地址无效——只填域名（如 git.example.com），仅支持 HTTPS 默认端口（443）',
      INVALID_TOKEN: 'token 为空或形态不对，请重新粘贴', TOKEN_TOO_LONG: 'token 过长，请确认粘贴内容',
      INVALID_LABEL: '备注名不合法（最长 64 字）',
      LIMIT: '连接数已达上限（最多 8 个实例），请先删除不用的',
      CONFIRM_DENIED: '已取消——未在系统弹窗中确认添加', VAULT_WRITE_FAILED: 'token 保存失败，请重试',
    },
    ja: {
      instancesTitle: 'GitLab インスタンス', instancesBadge: 'セルフホスト／複数インスタンス',
      hostPlaceholder: 'インスタンス URL（例：git.example.com）', hostAria: 'GitLab インスタンス URL',
      tokenPlaceholder: 'api スコープ付き glpat-… Personal Access Token', tokenAria: 'GitLab Personal Access Token',
      toggleToken: 'トークンの表示／非表示', add: '追加', noInstances: 'GitLab インスタンスは未登録です',
      tail: '末尾 {tail}', defaultBadge: '既定', setDefault: '既定に設定', test: 'テスト', remove: '削除',
      loadFailed: '接続状態を読み込めませんでした。再試行してください。',
      portUnsupported: 'カスタムポートには対応していません。HTTPS の既定ポート（443）を使用してください。',
      enterHost: 'git.example.com のようなインスタンスアドレスを入力してください。',
      pasteToken: '先にトークンを貼り付けてください。',
      replaceConfirm: 'このインスタンスは登録済みです。システムダイアログでトークンの変更を確認してください…',
      addConfirm: 'システムダイアログでインスタンスの追加を確認してください…',
      replaced: '{host} のトークンを変更しました。', added: '{host} を追加しました。',
      addFailed: '追加できませんでした（{reason}）。再試行してください。',
      addRequestFailed: 'インスタンスを追加できませんでした。再試行してください。',
      connecting: 'GitLab への接続を確認しています…', timeout: '接続テストがタイムアウトしました。再試行してください。',
      connectionFailed: '接続に失敗しました。', removed: 'インスタンスを削除しました。',
      removeFailed: 'インスタンスを削除できませんでした。再試行してください。',
      defaultFailed: '既定のインスタンスを設定できませんでした。再試行してください。',
      INVALID_HOST: 'インスタンスアドレスが無効です。git.example.com のようなドメインのみ入力してください。',
      INVALID_TOKEN: 'トークンが空か無効です。貼り付け直してください。',
      TOKEN_TOO_LONG: 'トークンが長すぎます。貼り付けた内容を確認してください。',
      INVALID_LABEL: 'ラベルが無効です（最大 64 文字）。',
      LIMIT: '接続数の上限（8 件）に達しました。不要なインスタンスを削除してください。',
      CONFIRM_DENIED: 'システム確認が承認されなかったためキャンセルしました。',
      VAULT_WRITE_FAILED: 'トークンを保存できませんでした。再試行してください。',
    },
    ko: {
      instancesTitle: 'GitLab 인스턴스', instancesBadge: '자체 호스팅 / 여러 인스턴스',
      hostPlaceholder: '인스턴스 URL(예: git.example.com)', hostAria: 'GitLab 인스턴스 URL',
      tokenPlaceholder: 'api 범위가 있는 glpat-… Personal Access Token', tokenAria: 'GitLab Personal Access Token',
      toggleToken: '토큰 표시 또는 숨기기', add: '추가', noInstances: '추가된 GitLab 인스턴스가 없습니다',
      tail: '끝자리 {tail}', defaultBadge: '기본', setDefault: '기본으로 설정', test: '테스트', remove: '삭제',
      loadFailed: '연결 상태를 불러오지 못했습니다. 다시 시도하세요.',
      portUnsupported: '사용자 지정 포트는 지원하지 않습니다. HTTPS 기본 포트(443)를 사용하세요.',
      enterHost: 'git.example.com과 같은 인스턴스 주소를 입력하세요.', pasteToken: '먼저 토큰을 붙여넣으세요.',
      replaceConfirm: '이미 등록된 인스턴스입니다. 시스템 대화상자에서 토큰 교체를 확인하세요...',
      addConfirm: '시스템 대화상자에서 인스턴스 추가를 확인하세요...',
      replaced: '{host}의 토큰을 교체했습니다.', added: '{host}을(를) 추가했습니다.',
      addFailed: '추가하지 못했습니다({reason}). 다시 시도하세요.',
      addRequestFailed: '인스턴스를 추가하지 못했습니다. 다시 시도하세요.',
      connecting: 'GitLab 연결을 확인하는 중...', timeout: '연결 테스트 시간이 초과되었습니다. 다시 시도하세요.',
      connectionFailed: '연결에 실패했습니다.', removed: '인스턴스를 삭제했습니다.',
      removeFailed: '인스턴스를 삭제하지 못했습니다. 다시 시도하세요.',
      defaultFailed: '기본 인스턴스를 설정하지 못했습니다. 다시 시도하세요.',
      INVALID_HOST: '인스턴스 주소가 잘못되었습니다. git.example.com과 같은 도메인만 입력하세요.',
      INVALID_TOKEN: '토큰이 비어 있거나 잘못되었습니다. 다시 붙여넣으세요.',
      TOKEN_TOO_LONG: '토큰이 너무 깁니다. 붙여넣은 내용을 확인하세요.',
      INVALID_LABEL: '레이블이 잘못되었습니다(최대 64자).',
      LIMIT: '연결 한도(최대 8개)에 도달했습니다. 사용하지 않는 인스턴스를 먼저 삭제하세요.',
      CONFIRM_DENIED: '시스템 확인을 승인하지 않아 취소했습니다.',
      VAULT_WRITE_FAILED: '토큰을 저장하지 못했습니다. 다시 시도하세요.',
    },
  };
  var currentLocale = 'en';
  var bc = new BroadcastChannel('cindy-gitlab');

  function $(id) { return document.getElementById(id); }

  function normalizeLocale(locale) {
    return Object.prototype.hasOwnProperty.call(MESSAGES, locale) ? locale : 'en';
  }

  function t(key, values) {
    var text = MESSAGES[currentLocale][key] || MESSAGES.en[key] || key;
    return text.replace(/\{(\w+)\}/g, function (_match, name) {
      return values && values[name] !== undefined ? String(values[name]) : '';
    });
  }

  function applyStaticTranslations() {
    document.documentElement.lang = currentLocale;
    document.querySelectorAll('[data-i18n]').forEach(function (element) {
      element.textContent = t(element.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (element) {
      element.setAttribute('placeholder', t(element.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (element) {
      element.setAttribute('title', t(element.getAttribute('data-i18n-title')));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (element) {
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

  var statusTimer = null;
  function showStatus(text, sticky) {
    $('status').textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(function () { $('status').textContent = ''; }, 4000);
  }

  /** POST /connections 的结构化错误码 → 人话。 */
  /** 内存里的最新连接列表(load 时刷新;add/test 用它做同 host 检测与定位)。 */
  var currentConns = [];

  /** 渲染连接列表:每条一行(host + @username + 尾号 + 默认/设默认 + 测试 + 删除)。 */
  function renderList(conns, users) {
    var box = $('list');
    box.textContent = '';
    if (!conns.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = t('noInstances');
      box.appendChild(empty);
      return;
    }
    conns.forEach(function (cn) {
      var row = document.createElement('div');
      row.className = 'account';

      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = cn.host;
      var login = users && users[cn.id];
      if (login) {
        var user = document.createElement('span');
        user.className = 'user';
        user.textContent = ' @' + login;
        who.appendChild(user);
      }
      row.appendChild(who);

      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = cn.tail ? t('tail', { tail: cn.tail }) : '';
      row.appendChild(tag);

      if (cn.isDefault) {
        var badge = document.createElement('span');
        badge.className = 'default-badge';
        badge.textContent = t('defaultBadge');
        row.appendChild(badge);
      } else {
        var mkDefault = document.createElement('button');
        mkDefault.className = 'mini';
        mkDefault.type = 'button';
        mkDefault.textContent = t('setDefault');
        mkDefault.addEventListener('click', function () { void setDefault(cn.id); });
        row.appendChild(mkDefault);
      }

      var testBtn = document.createElement('button');
      testBtn.className = 'mini';
      testBtn.type = 'button';
      testBtn.textContent = t('test');
      testBtn.addEventListener('click', function () { void test(cn.id, testBtn); });
      row.appendChild(testBtn);

      var delBtn = document.createElement('button');
      delBtn.className = 'mini';
      delBtn.type = 'button';
      delBtn.textContent = t('remove');
      delBtn.addEventListener('click', function () { void remove(cn.id); });
      row.appendChild(delBtn);

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
      } catch (e) { /* kv 读失败只影响用户名展示 */ }
      renderList(conns, users);
    } catch (e) {
      showStatus(t('loadFailed'));
    }
  }

  /**
   * 输入的实例地址归一化:剥协议与尾斜杠、小写化,只留裸域名。
   * 带端口直接返回 null 让调用方报错——主机出网通道仅支持 https 默认端口
   * (443),放进去也连不上,在入口就说清楚。
   */
  function normalizeHost(raw) {
    var host = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    if (host.indexOf(':') >= 0) return null;
    return host;
  }

  function findByHost(host) {
    for (var i = 0; i < currentConns.length; i++) {
      if (currentConns[i].host === host) return currentConns[i];
    }
    return null;
  }

  /**
   * 眼睛按钮只服务「正在输入的新值」的核对——已存的 token 永远读不回,空框时
   * 点它必然没反应,干脆藏掉免得被误会成"看已存 token"的坏按钮;隐藏同时
   * 复位密文态,下次粘贴默认遮蔽。(交互与 cindy-github 设置页一致。)
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

  async function add() {
    var host = normalizeHost($('host').value);
    var token = $('token').value.trim();
    if (host === null) { showStatus(t('portUnsupported'), true); return; }
    if (!host) { showStatus(t('enterHost')); return; }
    if (!token) { showStatus(t('pasteToken')); return; }
    var replacing = findByHost(host);
    $('add').disabled = true;
    // POST 后主机会弹系统确认框,等待期把状态说破,免得用户以为卡死。
    showStatus(replacing ? t('replaceConfirm') : t('addConfirm'), true);
    try {
      var r = await fetch('/connections/' + KEY, { method: 'POST', body: JSON.stringify({ host: host, token: token }) });
      // 成败以 body 的 ok 为准:确认框被拒 / 超上限 / 入库失败也是 200,
      // 只是 { ok:false, error:'CODE' }(参数类错误才走 400/413)。
      var d = null;
      try { d = await r.json(); } catch (e) { /* 非 JSON 体,按失败处理 */ }
      if (d && d.ok === true) {
        $('host').value = '';
        $('token').value = '';
        syncEye();
        showStatus(replacing ? t('replaced', { host: host }) : t('added', { host: host }));
        await load();
        // 添加/换 token 成功顺手验一次,让用户当场看到 token 是否可用。
        var added = findByHost(host);
        if (added) void test(added.id, null);
        return;
      }
      var code = (d && (d.error || d.errorCode)) || '';
      showStatus(MESSAGES[currentLocale][code] || t('addFailed', { reason: code || r.status }), true);
    } catch (e) {
      showStatus(t('addRequestFailed'), true);
    } finally {
      $('add').disabled = false;
    }
  }

  var testSeq = 0;
  async function test(connectionId, btn) {
    var reqId = 'test-' + Date.now() + '-' + (++testSeq);
    if (btn) btn.disabled = true;
    showStatus(t('connecting'), true);
    try {
      await fetch('/wake');
    } catch (e) { /* 叫不醒也让重发兜底 */ }
    var settled = false;
    var timer = null;
    var deadline = setTimeout(function () {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      showStatus(t('timeout'), true);
      if (btn) btn.disabled = false;
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
      if (btn) btn.disabled = false;
      if (m.ok) {
        // 成功由系统提示(notify)宣告,页内不重复挂灰字,只清掉「正在连接…」。
        showStatus('');
      } else {
        // 失败保留页内:toast 几秒就消失,失败原因要留在页上照着修;
        // 且 notify 有 5s 限速,快速重试失败时页内是唯一反馈。
        showStatus(m.message || t('connectionFailed'), true);
      }
      void load();
    });
    var send = function () {
      bc.postMessage({
        type: 'test-connection',
        reqId: reqId,
        connectionId: connectionId,
        locale: currentLocale,
      });
    };
    send();
    timer = setInterval(function () {
      if (settled) { clearInterval(timer); return; }
      send();
    }, 400);
  }

  async function remove(connectionId) {
    try {
      await fetch('/connections/' + KEY + '/' + encodeURIComponent(connectionId), { method: 'DELETE' });
      try {
        // 顺手清掉该连接缓存的用户名展示,避免残留脏数据。
        var kv = await (await fetch('/kv')).json();
        if (kv && typeof kv === 'object' && kv.connectedUsers && typeof kv.connectedUsers === 'object') {
          delete kv.connectedUsers[connectionId];
          await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
        }
      } catch (e) { /* 展示缓存清不掉不影响主流程 */ }
      showStatus(t('removed'));
    } catch (e) {
      showStatus(t('removeFailed'));
    } finally {
      void load();
    }
  }

  async function setDefault(connectionId) {
    try {
      await fetch('/connections/' + KEY + '/default', {
        method: 'POST',
        body: JSON.stringify({ connectionId: connectionId }),
      });
    } catch (e) {
      showStatus(t('defaultFailed'));
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
  void loadHostLocale().then(load);
})();
