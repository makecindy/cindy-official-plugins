/**
 * Web Search 设置页脚本(CSP 禁内联,外挂加载)。
 * 数据面:主机 /secrets 只写通道(绝对路径,协议保留路径)——
 *   GET /secrets           → [{ key, saved, tail? }](只有状态 + 尾 4 位指纹,永远没有值)
 *   PUT /secrets/<key>     → { value } 单向入库(主机 OS 级加密保管)
 *   DELETE /secrets/<key>  → 清除
 * 双凭证(Brave / Tavily)同构:行结构与文案由 settings.html 的 data-* 驱动,
 * 本脚本按 .secret 容器统一接线。收单不存值:保存成功后清空输入框、点亮
 * 「已保存」;明文读不回来,想换 key 直接粘贴新值覆盖。
 */
(function () {
  'use strict';

  var MESSAGES = {
    en: {
      savedBadge: '✓ Saved', toggleKey: 'Show or hide key', save: 'Save', clear: 'Clear',
      openConsole: 'Get a key from the provider ↗', bravePlaceholder: 'Paste a key beginning with BSA',
      tavilyPlaceholder: 'Paste a key beginning with tvly-', savedTail: '{prefix}{tail}; paste a new value to replace it',
      savedPlaceholder: 'Saved; paste a new value to replace it', pasteFirst: 'Paste a key before saving.',
      saved: 'Credential saved.', saveHttpFailed: 'Could not save (HTTP {status}). Try again.',
      saveFailed: 'Could not save the credential. Try again.', cleared: 'Credential cleared.',
      clearHttpFailed: 'Could not clear (HTTP {status}). Try again.',
      clearFailed: 'Could not clear the credential. Try again.',
    },
    'zh-CN': {
      savedBadge: '✓ 已保存', toggleKey: '显示或隐藏 key', save: '保存', clear: '清除',
      openConsole: '前往控制台获取 ↗', bravePlaceholder: '粘贴 BSA 开头的 key',
      tavilyPlaceholder: '粘贴 tvly- 开头的 key', savedTail: '{prefix}{tail}；粘贴新值可覆盖',
      savedPlaceholder: '已保存；粘贴新值可覆盖', pasteFirst: '先粘贴 key 再保存',
      saved: '凭证已保存', saveHttpFailed: '保存失败（HTTP {status}），请重试',
      saveFailed: '保存失败，请重试', cleared: '凭证已清除',
      clearHttpFailed: '清除失败（HTTP {status}），请重试', clearFailed: '清除失败，请重试',
    },
    ja: {
      savedBadge: '✓ 保存済み', toggleKey: 'キーの表示／非表示', save: '保存', clear: '削除',
      openConsole: 'プロバイダーでキーを取得 ↗', bravePlaceholder: 'BSA で始まるキーを貼り付け',
      tavilyPlaceholder: 'tvly- で始まるキーを貼り付け', savedTail: '{prefix}{tail}；新しい値を貼り付けて変更',
      savedPlaceholder: '保存済み；新しい値を貼り付けて変更', pasteFirst: '先にキーを貼り付けてください。',
      saved: '認証情報を保存しました。', saveHttpFailed: '保存できませんでした（HTTP {status}）。再試行してください。',
      saveFailed: '認証情報を保存できませんでした。再試行してください。', cleared: '認証情報を削除しました。',
      clearHttpFailed: '削除できませんでした（HTTP {status}）。再試行してください。',
      clearFailed: '認証情報を削除できませんでした。再試行してください。',
    },
    ko: {
      savedBadge: '✓ 저장됨', toggleKey: '키 표시 또는 숨기기', save: '저장', clear: '삭제',
      openConsole: '제공자에서 키 받기 ↗', bravePlaceholder: 'BSA로 시작하는 키 붙여넣기',
      tavilyPlaceholder: 'tvly-로 시작하는 키 붙여넣기', savedTail: '{prefix}{tail}; 새 값을 붙여넣어 교체',
      savedPlaceholder: '저장됨; 새 값을 붙여넣어 교체', pasteFirst: '먼저 키를 붙여넣으세요.',
      saved: '자격 증명을 저장했습니다.', saveHttpFailed: '저장하지 못했습니다(HTTP {status}). 다시 시도하세요.',
      saveFailed: '자격 증명을 저장하지 못했습니다. 다시 시도하세요.', cleared: '자격 증명을 삭제했습니다.',
      clearHttpFailed: '삭제하지 못했습니다(HTTP {status}). 다시 시도하세요.',
      clearFailed: '자격 증명을 삭제하지 못했습니다. 다시 시도하세요.',
    },
  };
  var currentLocale = 'en';

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
  function showStatus(text) {
    var el = document.getElementById('status');
    el.textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { el.textContent = ''; }, 2500);
  }

  /** 每行凭证的接线上下文(DOM 引用 + data-* 文案)。 */
  function wireRow(root) {
    var key = root.getAttribute('data-key');
    var tailPrefix = root.getAttribute('data-tail-prefix') || '…';
    var emptyKey = root.getAttribute('data-empty-key') || '';
    var input = root.querySelector('.key-input');
    var eye = root.querySelector('.eye');
    var badge = root.querySelector('.badge');

    /**
     * saved = 是否已入库;tail = 主机截存的尾 4 位指纹(帮回忆填的是哪个 key)。
     * 指纹直接进输入框占位文案;值太短不产指纹时退回纯「已保存」文案。
     */
    function setSaved(saved, tail) {
      badge.className = saved ? 'badge on' : 'badge';
      input.placeholder = saved
        ? (tail
          ? t('savedTail', { prefix: tailPrefix, tail: tail })
          : t('savedPlaceholder'))
        : t(emptyKey);
    }

    /**
     * 眼睛只服务「正在输入的新值」的核对——已存的值永远读不回,空框时
     * 点它必然没反应,干脆藏掉;隐藏同时复位密文态,下次粘贴默认遮蔽。
     */
    function syncEye() {
      var empty = input.value.length === 0;
      eye.classList.toggle('hidden', empty);
      if (empty) {
        input.type = 'password';
        eye.classList.remove('revealed');
      }
    }

    eye.addEventListener('click', function () {
      var reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      eye.classList.toggle('revealed', reveal);
    });
    input.addEventListener('input', syncEye);
    root.querySelector('.save').addEventListener('click', function () {
      var value = input.value.trim();
      if (!value) {
        showStatus(t('pasteFirst'));
        return;
      }
      fetch('/secrets/' + key, { method: 'PUT', body: JSON.stringify({ value: value }) })
        .then(function (r) {
          if (r.status === 204) {
            // 收单即焚:值已单向入库,页面不留明文;尾指纹从 /secrets 回查。
            input.value = '';
            syncEye();
            setSaved(true, null);
            void load();
            showStatus(t('saved'));
          } else {
            showStatus(t('saveHttpFailed', { status: r.status }));
          }
        })
        .catch(function () { showStatus(t('saveFailed')); });
    });
    root.querySelector('.clear').addEventListener('click', function () {
      fetch('/secrets/' + key, { method: 'DELETE' })
        .then(function (r) {
          if (r.status === 204) {
            input.value = '';
            syncEye();
            setSaved(false, null);
            showStatus(t('cleared'));
          } else {
            showStatus(t('clearHttpFailed', { status: r.status }));
          }
        })
        .catch(function () { showStatus(t('clearFailed')); });
    });
    syncEye();
    return { key: key, setSaved: setSaved };
  }

  var rows = [];

  async function load() {
    var list = null;
    try {
      var r = await fetch('/secrets');
      list = await r.json();
    } catch (e) {
      list = null;
    }
    for (var i = 0; i < rows.length; i++) {
      var entry = Array.isArray(list)
        ? list.filter(function (s) { return s && s.key === rows[i].key; })[0]
        : null;
      rows[i].setSaved(
        Boolean(entry && entry.saved),
        entry && typeof entry.tail === 'string' ? entry.tail : null,
      );
    }
  }

  void loadHostLocale().then(function () {
    var nodes = document.querySelectorAll('.secret');
    for (var i = 0; i < nodes.length; i++) rows.push(wireRow(nodes[i]));
    return load();
  });
})();
