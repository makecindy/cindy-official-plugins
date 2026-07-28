/**
 * GitHub 意识设置页脚本(CSP 禁内联,外挂加载)。
 * 数据面:
 *   GET  /secrets                → [{ key, saved, tail? }](永远拿不回值)
 *   PUT  /secrets/github_pat     → { value } 一次性入库(204)
 *   DELETE /secrets/github_pat   → 清除
 *   GET  /kv                     → { connectedLogin? } 上次测试成功的用户名(只读展示)
 *   GET  /wake                   → 叫醒电子脑(幂等)
 * 测试连接经 BroadcastChannel('cindy-github') 递活给电子脑:
 *   发 { type:'test-connection', reqId },按 reqId 每 400ms 重发直到收到
 *   { type:'test-connection-result', reqId, ok, login, message },15s 超时。
 */
(function () {
  'use strict';

  var KEY = 'github_pat';
  var MESSAGES = {
    en: {
      accountTitle: 'GitHub account', toggleToken: 'Show or hide token', save: 'Save',
      replace: 'Replace', testConnection: 'Test connection', clear: 'Clear',
      openConsole: 'Get a token from GitHub ↗', savedToken: 'Saved token',
      tail: 'Ends in {tail}', replacePlaceholder: 'Paste a new token to replace the current one',
      emptyPlaceholder: 'ghp_… or github_pat_…', loadFailed: 'Could not load the connection status. Try again.',
      pasteToken: 'Paste a token first.', saveHttpFailed: 'Could not save (HTTP {status}). Try again.',
      saveFailed: 'Could not save the token. Try again.', connecting: 'Connecting to GitHub...',
      timeout: 'The connection test timed out. Try again.', connectionFailed: 'Connection failed.',
      cleared: 'Token cleared.', clearFailed: 'Could not clear the token. Try again.',
    },
    'zh-CN': {
      accountTitle: 'GitHub 账号', toggleToken: '显示或隐藏 token', save: '保存', replace: '更换',
      testConnection: '测试连接', clear: '清除', openConsole: '前往控制台获取 ↗',
      savedToken: '已保存 token', tail: '尾号 {tail}', replacePlaceholder: '粘贴新 token 以更换（覆盖当前）',
      emptyPlaceholder: 'ghp_… 或 github_pat_…', loadFailed: '状态加载失败，请稍后重试',
      pasteToken: '请先粘贴 token', saveHttpFailed: '保存失败（HTTP {status}），请重试',
      saveFailed: '保存失败，请重试', connecting: '正在连接 GitHub 验证…',
      timeout: '测试超时——电子脑未响应，请稍后重试', connectionFailed: '连接失败',
      cleared: '已清除', clearFailed: '清除失败，请重试',
    },
    ja: {
      accountTitle: 'GitHub アカウント', toggleToken: 'トークンの表示／非表示', save: '保存',
      replace: '変更', testConnection: '接続をテスト', clear: '削除',
      openConsole: 'GitHub でトークンを取得 ↗', savedToken: '保存済みトークン',
      tail: '末尾 {tail}', replacePlaceholder: '新しいトークンを貼り付けて現在のトークンを変更',
      emptyPlaceholder: 'ghp_… または github_pat_…', loadFailed: '接続状態を読み込めませんでした。再試行してください。',
      pasteToken: '先にトークンを貼り付けてください。', saveHttpFailed: '保存できませんでした（HTTP {status}）。再試行してください。',
      saveFailed: 'トークンを保存できませんでした。再試行してください。', connecting: 'GitHub への接続を確認しています…',
      timeout: '接続テストがタイムアウトしました。再試行してください。', connectionFailed: '接続に失敗しました。',
      cleared: 'トークンを削除しました。', clearFailed: 'トークンを削除できませんでした。再試行してください。',
    },
    ko: {
      accountTitle: 'GitHub 계정', toggleToken: '토큰 표시 또는 숨기기', save: '저장',
      replace: '교체', testConnection: '연결 테스트', clear: '삭제',
      openConsole: 'GitHub에서 토큰 받기 ↗', savedToken: '저장된 토큰',
      tail: '끝자리 {tail}', replacePlaceholder: '새 토큰을 붙여넣어 현재 토큰 교체',
      emptyPlaceholder: 'ghp_… 또는 github_pat_…', loadFailed: '연결 상태를 불러오지 못했습니다. 다시 시도하세요.',
      pasteToken: '먼저 토큰을 붙여넣으세요.', saveHttpFailed: '저장하지 못했습니다(HTTP {status}). 다시 시도하세요.',
      saveFailed: '토큰을 저장하지 못했습니다. 다시 시도하세요.', connecting: 'GitHub 연결을 확인하는 중...',
      timeout: '연결 테스트 시간이 초과되었습니다. 다시 시도하세요.', connectionFailed: '연결에 실패했습니다.',
      cleared: '토큰을 삭제했습니다.', clearFailed: '토큰을 삭제하지 못했습니다. 다시 시도하세요.',
    },
  };
  var currentLocale = 'en';
  var bc = new BroadcastChannel('cindy-github');

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

  /** 渲染已保存状态卡片(saved + tail 指纹 + 上次测试到的用户名)。 */
  function renderAccount(saved, tail, login) {
    var box = $('account');
    box.textContent = '';
    if (!saved) return;
    var row = document.createElement('div');
    row.className = 'account';
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = login ? '@' + login : t('savedToken');
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
      var list = await (await fetch('/secrets')).json();
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].key === KEY) { saved = Boolean(list[i].saved); tail = list[i].tail || ''; }
      }
      var login = '';
      try {
        var kv = await (await fetch('/kv')).json();
        if (saved && kv && typeof kv.connectedLogin === 'string') login = kv.connectedLogin;
      } catch (e) { /* kv 读失败只影响用户名展示 */ }
      renderAccount(saved, tail, login);
      // 单凭证语义要在输入行上说破:已保存时空输入框容易被误读成"还能再绑
      // 一个",实际再存 = 覆盖唯一的一条。占位与按钮文案切成「更换」。
      $('token').placeholder = saved ? t('replacePlaceholder') : t('emptyPlaceholder');
      $('save').textContent = saved ? t('replace') : t('save');
      $('test').disabled = !saved;
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
    if (!value) { showStatus(t('pasteToken')); return; }
    $('save').disabled = true;
    try {
      var r = await fetch('/secrets/' + KEY, { method: 'PUT', body: JSON.stringify({ value: value }) });
      if (r.status !== 204) { showStatus(t('saveHttpFailed', { status: r.status }), true); return; }
      input.value = '';
      syncEye();
      await load();
      // 保存成功顺手验一次,让用户当场看到 token 是否可用。
      void test();
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
        showStatus(m.message || t('connectionFailed'), true);
      }
      void load();
    });
    var send = function () {
      bc.postMessage({ type: 'test-connection', reqId: reqId, locale: currentLocale });
    };
    send();
    timer = setInterval(function () {
      if (settled) { clearInterval(timer); return; }
      send();
    }, 400);
  }

  async function clearToken() {
    $('clear').disabled = true;
    try {
      await fetch('/secrets/' + KEY, { method: 'DELETE' });
      try {
        // 顺手清掉缓存的用户名展示,避免"清了 token 还挂着 @login"。
        var kv = await (await fetch('/kv')).json();
        if (kv && typeof kv === 'object') {
          delete kv.connectedLogin;
          await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
        }
      } catch (e) { /* 展示缓存清不掉不影响主流程 */ }
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
  void loadHostLocale().then(load);
})();
