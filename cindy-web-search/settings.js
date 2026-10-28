/**
 * Web Search 设置页脚本(CSP 禁内联,外挂加载)。
 * 普通偏好通过 /kv 保存偏离代码默认值的 override。
 * 凭证数据面继续使用主机 /secrets 只写通道(绝对路径,协议保留路径)——
 *   GET /secrets           → [{ key, saved, tail? }](只有状态 + 尾 4 位指纹,永远没有值)
 *   PUT /secrets/<key>     → { value } 单向入库(主机 OS 级加密保管)
 *   DELETE /secrets/<key>  → 清除
 * 各凭证(Brave / Tavily / DeepSeek)同构:行结构与文案由 settings.html 的 data-* 驱动,
 * 本脚本按 .secret 容器统一接线。收单不存值:保存成功后清空输入框、点亮
 * 「已保存」;明文读不回来,想换 key 直接粘贴新值覆盖。
 */

/*
 * 设置页文案只跟随宿主语言(同源 GET /app-context),不读浏览器或操作系统语言;
 * 宿主语言不在表内或取不到时回退英文。宿主切换语言后会重载设置页,这里只读一次。
 * settings.html 用 data-i18n / data-i18n-title / data-i18n-aria-label /
 * data-empty-ph-key 指向下表的键。
 */
var MESSAGES = {
  'zh-CN': {
    cindyAiTitle: '默认使用 Cindy AI 搜索',
    cindyAiHint: '也可关闭并使用自己的 Brave / Tavily / DeepSeek Key。',
    cindyAiAria: '使用 Cindy AI 搜索',
    byoTitle: '自备搜索渠道',
    byoHint: '关闭 Cindy AI 搜索后使用。',
    badgeSaved: '✓ 已保存',
    toggleVisibility: '显示或隐藏',
    save: '保存',
    clear: '清除',
    consoleLink: '前往控制台获取 ↗',
    deepSeekHint: '查询最多 128 个 Unicode 字符。搜索按成功请求计费，使用你的 DeepSeek 账户余额。',
    emptyPhBrave: '粘贴 BSA 开头的 key',
    emptyPhTavily: '粘贴 tvly- 开头的 key',
    emptyPhDeepSeek: '粘贴 DeepSeek API Key',
    emptyPhDefault: '粘贴 key',
    savedWithTail: '{fingerprint};粘贴新值可覆盖',
    savedNoTail: '已保存;粘贴新值可覆盖',
    prefsLoadFailed: '搜索偏好加载失败，请重新打开设置页',
    prefsSaved: '搜索偏好已保存',
    prefsSaveFailed: '搜索偏好保存失败，请重试',
    pasteFirst: '先粘贴 key 再保存',
    credentialSaved: '凭证已保存',
    saveFailedStatus: '保存失败({status}),请重试',
    saveFailed: '保存失败,请重试',
    credentialCleared: '凭证已清除',
    clearFailedStatus: '清除失败({status}),请重试',
    clearFailed: '清除失败,请重试',
  },
  en: {
    cindyAiTitle: 'Use Cindy AI search by default',
    cindyAiHint: 'Or turn it off and use your own Brave / Tavily / DeepSeek key.',
    cindyAiAria: 'Use Cindy AI search',
    byoTitle: 'Your own search provider',
    byoHint: 'Used when Cindy AI search is off.',
    badgeSaved: '✓ Saved',
    toggleVisibility: 'Show or hide',
    save: 'Save',
    clear: 'Clear',
    consoleLink: 'Get it from the console ↗',
    deepSeekHint: 'Queries are limited to 128 Unicode characters. Searches are billed per successful request against your DeepSeek account balance.',
    emptyPhBrave: 'Paste a key starting with BSA',
    emptyPhTavily: 'Paste a key starting with tvly-',
    emptyPhDeepSeek: 'Paste DeepSeek API Key',
    emptyPhDefault: 'Paste key',
    savedWithTail: '{fingerprint}; paste a new value to replace',
    savedNoTail: 'Saved; paste a new value to replace',
    prefsLoadFailed: 'Failed to load search preferences. Please reopen the settings page.',
    prefsSaved: 'Search preferences saved',
    prefsSaveFailed: 'Failed to save search preferences. Please try again.',
    pasteFirst: 'Paste a key before saving',
    credentialSaved: 'Credential saved',
    saveFailedStatus: 'Save failed ({status}). Please try again.',
    saveFailed: 'Save failed. Please try again.',
    credentialCleared: 'Credential cleared',
    clearFailedStatus: 'Clear failed ({status}). Please try again.',
    clearFailed: 'Clear failed. Please try again.',
  },
  ja: {
    cindyAiTitle: '既定で Cindy AI 検索を使用',
    cindyAiHint: 'オフにして、自分の Brave / Tavily / DeepSeek キーを使うこともできます。',
    cindyAiAria: 'Cindy AI 検索を使用',
    byoTitle: '自分で用意する検索プロバイダー',
    byoHint: 'Cindy AI 検索をオフにしたときに使用します。',
    badgeSaved: '✓ 保存済み',
    toggleVisibility: '表示／非表示',
    save: '保存',
    clear: 'クリア',
    consoleLink: 'コンソールで取得 ↗',
    deepSeekHint: 'クエリは最大 128 文字（Unicode 文字単位）です。検索は成功したリクエストごとに課金され、DeepSeek アカウントの残高から支払われます。',
    emptyPhBrave: 'BSA で始まるキーを貼り付け',
    emptyPhTavily: 'tvly- で始まるキーを貼り付け',
    emptyPhDeepSeek: 'DeepSeek API キーを貼り付け',
    emptyPhDefault: 'キーを貼り付け',
    savedWithTail: '{fingerprint}; 新しい値を貼り付けると上書きされます',
    savedNoTail: '保存済み; 新しい値を貼り付けると上書きされます',
    prefsLoadFailed: '検索設定を読み込めませんでした。設定ページを開き直してください。',
    prefsSaved: '検索設定を保存しました',
    prefsSaveFailed: '検索設定を保存できませんでした。再試行してください。',
    pasteFirst: '保存する前にキーを貼り付けてください',
    credentialSaved: '認証情報を保存しました',
    saveFailedStatus: '保存に失敗しました ({status})。再試行してください。',
    saveFailed: '保存に失敗しました。再試行してください。',
    credentialCleared: '認証情報を削除しました',
    clearFailedStatus: '削除に失敗しました ({status})。再試行してください。',
    clearFailed: '削除に失敗しました。再試行してください。',
  },
  ko: {
    cindyAiTitle: '기본으로 Cindy AI 검색 사용',
    cindyAiHint: '끄고 자신의 Brave / Tavily / DeepSeek 키를 사용할 수도 있습니다.',
    cindyAiAria: 'Cindy AI 검색 사용',
    byoTitle: '직접 준비한 검색 공급자',
    byoHint: 'Cindy AI 검색을 끄면 사용됩니다.',
    badgeSaved: '✓ 저장됨',
    toggleVisibility: '표시 또는 숨기기',
    save: '저장',
    clear: '지우기',
    consoleLink: '콘솔에서 발급받기 ↗',
    deepSeekHint: '검색어는 Unicode 문자 기준 최대 128자입니다. 검색은 성공한 요청마다 과금되며 DeepSeek 계정 잔액에서 차감됩니다.',
    emptyPhBrave: 'BSA로 시작하는 키 붙여넣기',
    emptyPhTavily: 'tvly-로 시작하는 키 붙여넣기',
    emptyPhDeepSeek: 'DeepSeek API 키 붙여넣기',
    emptyPhDefault: '키 붙여넣기',
    savedWithTail: '{fingerprint}; 새 값을 붙여넣으면 덮어씁니다',
    savedNoTail: '저장됨; 새 값을 붙여넣으면 덮어씁니다',
    prefsLoadFailed: '검색 설정을 불러오지 못했습니다. 설정 페이지를 다시 여세요.',
    prefsSaved: '검색 설정이 저장되었습니다',
    prefsSaveFailed: '검색 설정을 저장하지 못했습니다. 다시 시도하세요.',
    pasteFirst: '저장하기 전에 키를 붙여넣으세요',
    credentialSaved: '자격 증명이 저장되었습니다',
    saveFailedStatus: '저장하지 못했습니다({status}). 다시 시도하세요.',
    saveFailed: '저장하지 못했습니다. 다시 시도하세요.',
    credentialCleared: '자격 증명이 삭제되었습니다',
    clearFailedStatus: '삭제하지 못했습니다({status}). 다시 시도하세요.',
    clearFailed: '삭제하지 못했습니다. 다시 시도하세요.',
  },
};

(function () {
  'use strict';

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
      ['data-i18n-aria-label', function (el, text) { el.setAttribute('aria-label', text); }],
    ];
    for (var b = 0; b < bindings.length; b++) {
      var nodes = document.querySelectorAll('[' + bindings[b][0] + ']');
      for (var n = 0; n < nodes.length; n++) {
        bindings[b][1](nodes[n], t(nodes[n].getAttribute(bindings[b][0])));
      }
    }
  }

  var statusTimer = null;
  var preferenceWriteQueue = Promise.resolve();
  var preferencesReady = false;
  var lastSavedPreferences = null;

  function showStatus(text) {
    var el = document.getElementById('status');
    el.textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { el.textContent = ''; }, 2500);
  }

  async function readKv() {
    var response = await fetch('/kv');
    if (!response.ok) throw new Error('kv read failed');
    var value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('kv response invalid');
    }
    return value;
  }

  function isByoProvider(value) {
    return value === 'brave' || value === 'tavily' || value === 'deepseek';
  }

  function normalizePreferences(kv) {
    return {
      cindyAiEnabled: typeof kv.cindyAiEnabled === 'boolean' ? kv.cindyAiEnabled : true,
      byoDefaultProvider: isByoProvider(kv.byoDefaultProvider) ? kv.byoDefaultProvider : 'brave',
    };
  }

  function setPreferenceControlsDisabled(disabled) {
    document.getElementById('cindy-ai-enabled').disabled = disabled;
    document.getElementById('byo-default-provider').disabled = disabled;
  }

  function applyPreferences(preferences) {
    document.getElementById('cindy-ai-enabled').checked = preferences.cindyAiEnabled;
    document.getElementById('byo-default-provider').value = preferences.byoDefaultProvider;
  }

  async function loadPreferences() {
    try {
      var preferences = normalizePreferences(await readKv());
      applyPreferences(preferences);
      lastSavedPreferences = preferences;
      preferencesReady = true;
      setPreferenceControlsDisabled(false);
    } catch (e) {
      preferencesReady = false;
      setPreferenceControlsDisabled(true);
      showStatus(t('prefsLoadFailed'));
    }
  }

  function persistPreferences() {
    if (!preferencesReady) return;
    var nextPreferences = {
      cindyAiEnabled: document.getElementById('cindy-ai-enabled').checked,
      byoDefaultProvider: document.getElementById('byo-default-provider').value,
    };
    preferencesReady = false;
    setPreferenceControlsDisabled(true);
    preferenceWriteQueue = preferenceWriteQueue
      .then(async function savePreferences() {
        var kv = await readKv();
        if (nextPreferences.cindyAiEnabled) delete kv.cindyAiEnabled;
        else kv.cindyAiEnabled = false;
        if (nextPreferences.byoDefaultProvider === 'brave') delete kv.byoDefaultProvider;
        else kv.byoDefaultProvider = nextPreferences.byoDefaultProvider;
        var response = await fetch('/kv', {
          method: 'PUT',
          body: JSON.stringify(kv),
        });
        if (!response.ok) throw new Error('kv write failed');
        lastSavedPreferences = nextPreferences;
        showStatus(t('prefsSaved'));
      })
      .catch(function preferenceSaveFailed() {
        showStatus(t('prefsSaveFailed'));
        if (lastSavedPreferences) applyPreferences(lastSavedPreferences);
      })
      .finally(function preferenceSaveFinished() {
        preferencesReady = true;
        setPreferenceControlsDisabled(false);
      });
  }

  /** 每行凭证的接线上下文(DOM 引用 + data-* 文案)。 */
  function wireRow(root) {
    var key = root.getAttribute('data-key');
    var tailPrefix = root.getAttribute('data-tail-prefix') || '…';
    var emptyPhKey = root.getAttribute('data-empty-ph-key') || 'emptyPhDefault';
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
        ? (tail ? t('savedWithTail', { fingerprint: tailPrefix + tail }) : t('savedNoTail'))
        : t(emptyPhKey);
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
            showStatus(t('credentialSaved'));
          } else {
            showStatus(t('saveFailedStatus', { status: r.status }));
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
            showStatus(t('credentialCleared'));
          } else {
            showStatus(t('clearFailedStatus', { status: r.status }));
          }
        })
        .catch(function () { showStatus(t('clearFailed')); });
    });
    syncEye();
    return { key: key, setSaved: setSaved };
  }

  var rows = [];
  var nodes = document.querySelectorAll('.secret');
  for (var i = 0; i < nodes.length; i++) rows.push(wireRow(nodes[i]));

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

  document.getElementById('cindy-ai-enabled').addEventListener('change', persistPreferences);
  document.getElementById('byo-default-provider').addEventListener('change', persistPreferences);

  // 先定语言再出文案:偏好/凭证状态里的提示都要用宿主语言。
  void loadLocale().then(function renderLocalized() {
    applyStaticCopy();
    void loadPreferences();
    void load();
  });
})();
