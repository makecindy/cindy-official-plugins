(function () {
  'use strict';

  var MESSAGES = {
    en: {
      tokenTitle: 'FAOSTAT API Token (optional)', savedBadge: '✓ Saved',
      tokenHint: 'WHO needs no setup. Add a token to query FAOSTAT agriculture, food, and food-security data.',
      getToken: 'Get a FAOSTAT token ↗', tokenPlaceholder: 'Paste FAOSTAT API token',
      toggleVisibility: 'Show or hide', save: 'Save', clear: 'Clear',
      savedWithTail: 'Saved (ending in {tail}). Paste a new value to replace it.',
      savedReplace: 'Saved. Paste a new value to replace it.', enterToken: 'Paste a token before saving.',
      tokenSaved: 'Token saved securely.', saveFailed: 'Could not save the token. Try again.',
      tokenCleared: 'Token cleared.', clearFailed: 'Could not clear the token. Try again.'
    },
    'zh-CN': {
      tokenTitle: 'FAOSTAT API Token（可选）', savedBadge: '✓ 已保存',
      tokenHint: 'WHO 数据无需配置；配置 Token 后可查询 FAOSTAT 农业、粮食与食品安全数据。',
      getToken: '获取 FAOSTAT Token ↗', tokenPlaceholder: '粘贴 FAOSTAT API Token',
      toggleVisibility: '显示或隐藏', save: '保存', clear: '清除',
      savedWithTail: '已保存（尾号 {tail}），粘贴新值可覆盖', savedReplace: '已保存，粘贴新值可覆盖',
      enterToken: '先粘贴 Token 再保存', tokenSaved: 'Token 已安全保存',
      saveFailed: '保存失败，请重试', tokenCleared: 'Token 已清除', clearFailed: '清除失败，请重试'
    },
    ja: {
      tokenTitle: 'FAOSTAT API トークン（任意）', savedBadge: '✓ 保存済み',
      tokenHint: 'WHO は設定不要です。FAOSTAT の農業・食料・食料安全保障データを検索するにはトークンを追加してください。',
      getToken: 'FAOSTAT トークンを取得 ↗', tokenPlaceholder: 'FAOSTAT API トークンを貼り付け',
      toggleVisibility: '表示／非表示', save: '保存', clear: '削除',
      savedWithTail: '保存済み（末尾 {tail}）。新しい値を貼り付けると更新できます。',
      savedReplace: '保存済み。新しい値を貼り付けると更新できます。',
      enterToken: '保存する前にトークンを貼り付けてください。', tokenSaved: 'トークンを安全に保存しました。',
      saveFailed: 'トークンを保存できませんでした。再試行してください。', tokenCleared: 'トークンを削除しました。',
      clearFailed: 'トークンを削除できませんでした。再試行してください。'
    },
    ko: {
      tokenTitle: 'FAOSTAT API 토큰(선택 사항)', savedBadge: '✓ 저장됨',
      tokenHint: 'WHO는 설정이 필요 없습니다. FAOSTAT 농업, 식량 및 식량안보 데이터를 조회하려면 토큰을 추가하세요.',
      getToken: 'FAOSTAT 토큰 받기 ↗', tokenPlaceholder: 'FAOSTAT API 토큰 붙여넣기',
      toggleVisibility: '표시 또는 숨기기', save: '저장', clear: '삭제',
      savedWithTail: '저장됨(끝자리 {tail}). 새 값을 붙여넣어 교체할 수 있습니다.',
      savedReplace: '저장됨. 새 값을 붙여넣어 교체할 수 있습니다.',
      enterToken: '저장하기 전에 토큰을 붙여넣으세요.', tokenSaved: '토큰을 안전하게 저장했습니다.',
      saveFailed: '토큰을 저장하지 못했습니다. 다시 시도하세요.', tokenCleared: '토큰을 삭제했습니다.',
      clearFailed: '토큰을 삭제하지 못했습니다. 다시 시도하세요.'
    }
  };
  var currentLocale = 'en';
  var input = document.getElementById('token');
  var eye = document.getElementById('eye');
  var badge = document.getElementById('badge');
  var status = document.getElementById('status');
  var timer = null;

  function normalizeLocale(locale) {
    if (typeof locale !== 'string') return 'en';
    if (locale.indexOf('zh') === 0) return 'zh-CN';
    if (locale.indexOf('ja') === 0) return 'ja';
    if (locale.indexOf('ko') === 0) return 'ko';
    return 'en';
  }

  function t(key, values) {
    var message = (MESSAGES[currentLocale] && MESSAGES[currentLocale][key]) || MESSAGES.en[key] || key;
    return message.replace(/\{(\w+)\}/g, function (_match, name) {
      return values && values[name] !== undefined ? String(values[name]) : '';
    });
  }

  function applyTranslations() {
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
  }

  async function loadHostLocale() {
    try {
      var response = await fetch('/app-context');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var payload = await response.json();
      currentLocale = normalizeLocale(payload && payload.context && payload.context.locale);
    } catch (_error) {
      currentLocale = 'en';
    }
    applyTranslations();
  }

  function showStatus(message) {
    status.textContent = message;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { status.textContent = ''; }, 2500);
  }

  function syncEye() {
    var empty = input.value.length === 0;
    eye.classList.toggle('hidden', empty);
    if (empty) {
      input.type = 'password';
      eye.classList.remove('revealed');
    }
  }

  function setSaved(saved, tail) {
    badge.className = saved ? 'badge on' : 'badge';
    input.placeholder = saved
      ? (tail ? t('savedWithTail', { tail: tail }) : t('savedReplace'))
      : t('tokenPlaceholder');
  }

  eye.addEventListener('click', function () {
    var revealed = input.type === 'password';
    input.type = revealed ? 'text' : 'password';
    eye.classList.toggle('revealed', revealed);
  });
  input.addEventListener('input', syncEye);

  document.getElementById('save').addEventListener('click', function () {
    var value = input.value.trim();
    if (!value) {
      showStatus(t('enterToken'));
      return;
    }
    fetch('/secrets/faostat_api_token', {
      method: 'PUT',
      body: JSON.stringify({ value: value })
    }).then(function (response) {
      if (response.status !== 204) throw new Error('HTTP ' + response.status);
      input.value = '';
      syncEye();
      setSaved(true, null);
      void load();
      showStatus(t('tokenSaved'));
    }).catch(function () {
      showStatus(t('saveFailed'));
    });
  });

  document.getElementById('clear').addEventListener('click', function () {
    fetch('/secrets/faostat_api_token', { method: 'DELETE' })
      .then(function (response) {
        if (response.status !== 204) throw new Error('HTTP ' + response.status);
        input.value = '';
        syncEye();
        setSaved(false, null);
        showStatus(t('tokenCleared'));
      }).catch(function () {
        showStatus(t('clearFailed'));
      });
  });

  async function load() {
    try {
      var response = await fetch('/secrets');
      var entries = await response.json();
      var entry = Array.isArray(entries)
        ? entries.filter(function (item) {
          return item && item.key === 'faostat_api_token';
        })[0]
        : null;
      setSaved(Boolean(entry && entry.saved), entry && entry.tail ? entry.tail : null);
    } catch (error) {
      setSaved(false, null);
    }
  }

  void (async function boot() {
    await loadHostLocale();
    syncEye();
    await load();
  })();
})();
