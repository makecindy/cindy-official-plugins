(function () {
  'use strict';

  var KEY = 'notion_token';
  var MESSAGES = {
    en: {
      pageIntro: 'Once connected, Cindy can read and edit the Notion pages you authorize.',
      connectionAria: 'Connection status', clear: 'Clear', stepsTitle: 'Connection steps',
      createTitle: 'Create an Internal connection', createHint: 'Create "Notion" in the Notion developer portal',
      createPanel: 'Open Internal connections, create the integration, then copy the Installation access token from Configuration.',
      openInternal: 'Open Internal connections ↗', saveTokenTitle: 'Save the token',
      saveTokenHint: 'Copy the access token beginning with ntn_', tokenPlaceholder: 'Paste ntn_…',
      toggleToken: 'Show or hide token', saveAndCheck: 'Save and check',
      vaultHint: 'The token is stored only in the Cindy vault and cannot be read back by this page.',
      authorizeTitle: 'Authorize pages', authorizeHint: 'Choose what Cindy can access under Content access',
      authorizePanel: "Select the integration you created (usually Notion for new integrations; older ones may show Cindy Notion), then open Content access → Edit access to authorize pages in bulk. You can also add it from a page's Connections menu.",
      openContentAccess: 'Open Content access ↗', checkPages: 'Check pages',
      notConnected: 'Not connected', completeThreeSteps: 'Complete the three steps below to get started',
      notComplete: 'Not completed', rebindStatus: 'Reconnect Notion',
      rebindMeta: 'Paste and save a new access token', rebinding: 'Reconnecting',
      tokenSaved: 'Token saved', checkVisibleMeta: 'Run a check to see which pages Cindy can access',
      awaitingCheck: 'Awaiting check', accessNeedsAttention: 'Connected, but page access needs attention',
      visibilityFailedMeta: 'Token valid · Page check failed', needsPageAccess: 'Page access needs attention',
      noAuthorizedPages: 'Connected, but no pages are authorized', zeroVisibleMeta: 'Token valid · 0 visible pages',
      twoOfThreeComplete: '2 / 3 completed', connectedTo: 'Connected to {workspace}',
      visibleMeta: '{count} pages/databases · Checked just now', allComplete: 'All 3 steps completed',
      rebind: 'Reconnect', checkConnection: 'Check connection', startConnection: 'Start connection',
      complete: 'Completed', currentStep: 'Current step', pending: 'Pending', needsAuthorization: 'Authorization needed',
      pendingCheck: 'Pending check', collapseSteps: 'Collapse steps', viewSteps: 'View steps',
      pageCheckFailed: 'Page check failed: {error}', validNoVisibleTitle: 'The token is valid, but 0 pages are visible',
      validNoVisibleHint: 'Select pages under Content access in Notion, then check again.',
      visibleFound: '{count} accessible items found', untitled: 'Untitled',
      replaceTokenPlaceholder: 'Paste a new token to replace the current connection',
      loadFailed: 'Could not load the connection status. Try again.', show: 'Show', hide: 'Hide',
      pasteToken: 'Paste a Notion Integration Token first.', savingToken: 'Saving the token securely...',
      saveHttpFailed: 'Could not save (HTTP {status}). Try again.', saveFailed: 'Could not save the token. Try again.',
      checkingPages: 'Validating the token and checking accessible pages...',
      timeout: 'The check timed out. Try again.', invalidToken: 'The token is invalid. Check it and save again.',
      validVisibilityFailed: 'The token is valid, but the page check failed: {error}',
      validNoAuthorized: 'The token is valid, but no Notion pages are authorized yet.',
      connectedSuccess: 'Connected. Cindy can now read the authorized content.',
      cleared: 'Notion connection cleared.', clearFailed: 'Could not clear the connection. Try again.',
    },
    'zh-CN': {
      pageIntro: '连接后，Cindy 可以读取和编辑你授权的 Notion 页面。',
      connectionAria: '连接状态', clear: '清除', stepsTitle: '连接步骤',
      createTitle: '创建 Internal connection', createHint: '在 Notion Developer portal 中创建 “Notion”',
      createPanel: '进入 Internal connections，创建连接后在 Configuration 中复制 Installation access token。',
      openInternal: '打开 Internal connections ↗', saveTokenTitle: '保存 Token',
      saveTokenHint: '复制以 ntn_ 开头的访问令牌', tokenPlaceholder: '粘贴 ntn_…',
      toggleToken: '显示或隐藏 Token', saveAndCheck: '保存并检查',
      vaultHint: 'Token 只保存在 Cindy 保险库，无法被页面读回。',
      authorizeTitle: '授权页面', authorizeHint: '在 Content access 中选择 Cindy 可以访问的内容',
      authorizePanel: '选择此前创建的 integration（新建时通常为 Notion，旧版可能显示 Cindy Notion）→ Content access → Edit access，可批量授权页面；也可以在单个页面的 Connections 菜单中添加。',
      openContentAccess: '打开 Content access ↗', checkPages: '检查页面',
      notConnected: '尚未连接', completeThreeSteps: '完成下面 3 个步骤后即可使用',
      notComplete: '尚未完成', rebindStatus: '重新绑定 Notion', rebindMeta: '粘贴新的访问令牌后保存',
      rebinding: '正在重新绑定', tokenSaved: 'Token 已保存', checkVisibleMeta: '点击检查，确认 Cindy 能看到哪些页面',
      awaitingCheck: '等待检查', accessNeedsAttention: '连接正常，但页面授权需要处理',
      visibilityFailedMeta: 'Token 有效 · 页面检查失败', needsPageAccess: '需要处理页面授权',
      noAuthorizedPages: '连接正常，但尚未授权页面', zeroVisibleMeta: 'Token 有效 · 当前可见页面为 0',
      twoOfThreeComplete: '2 / 3 已完成', connectedTo: '已连接到 {workspace}',
      visibleMeta: '{count} 个页面/数据库 · 刚刚检查', allComplete: '3 个步骤已完成',
      rebind: '重新绑定', checkConnection: '检查连接', startConnection: '开始连接',
      complete: '已完成', currentStep: '当前步骤', pending: '待完成', needsAuthorization: '需要授权',
      pendingCheck: '待检查', collapseSteps: '收起步骤', viewSteps: '查看步骤',
      pageCheckFailed: '页面检查失败：{error}', validNoVisibleTitle: 'Token 有效，但当前可见页面为 0',
      validNoVisibleHint: '回到 Notion 的 Content access 中选择页面后，再次检查。',
      visibleFound: '已发现 {count} 项可见内容', untitled: '未命名内容',
      replaceTokenPlaceholder: '粘贴新 token 以更换当前连接', loadFailed: '连接状态加载失败，请稍后重试',
      show: '显示', hide: '隐藏', pasteToken: '请先粘贴 Notion Integration Token',
      savingToken: '正在安全保存 Token…', saveHttpFailed: '保存失败（HTTP {status}），请重试',
      saveFailed: '保存失败，请重试', checkingPages: '正在验证 Token 并检查可见页面…',
      timeout: '检查超时——请稍后重试', invalidToken: 'Token 无效，请检查后重新保存',
      validVisibilityFailed: 'Token 有效，但页面检查失败：{error}',
      validNoAuthorized: 'Token 有效，但还没有授权任何 Notion 页面。',
      connectedSuccess: '连接完成，Cindy 已能读取授权内容', cleared: 'Notion 连接已清除',
      clearFailed: '清除失败，请重试',
    },
    ja: {
      pageIntro: '接続すると、Cindy は許可された Notion ページを読み書きできます。',
      connectionAria: '接続状態', clear: '削除', stepsTitle: '接続手順',
      createTitle: 'Internal connection を作成', createHint: 'Notion 開発者ポータルで「Notion」を作成',
      createPanel: 'Internal connections を開いて integration を作成し、Configuration から Installation access token をコピーします。',
      openInternal: 'Internal connections を開く ↗', saveTokenTitle: 'トークンを保存',
      saveTokenHint: 'ntn_ で始まるアクセストークンをコピー', tokenPlaceholder: 'ntn_… を貼り付け',
      toggleToken: 'トークンの表示／非表示', saveAndCheck: '保存して確認',
      vaultHint: 'トークンは Cindy の保管庫にのみ保存され、このページから読み戻すことはできません。',
      authorizeTitle: 'ページを許可', authorizeHint: 'Content access で Cindy がアクセスできる内容を選択',
      authorizePanel: '作成した integration（新規では通常 Notion、旧版では Cindy Notion の場合があります）を選び、Content access → Edit access からページをまとめて許可します。各ページの Connections メニューから追加することもできます。',
      openContentAccess: 'Content access を開く ↗', checkPages: 'ページを確認',
      notConnected: '未接続', completeThreeSteps: '以下の 3 手順を完了すると利用できます',
      notComplete: '未完了', rebindStatus: 'Notion を再接続', rebindMeta: '新しいアクセストークンを貼り付けて保存',
      rebinding: '再接続中', tokenSaved: 'トークン保存済み', checkVisibleMeta: 'Cindy がアクセスできるページを確認してください',
      awaitingCheck: '確認待ち', accessNeedsAttention: '接続済みですが、ページの許可を確認してください',
      visibilityFailedMeta: 'トークン有効 · ページ確認に失敗', needsPageAccess: 'ページの許可を確認',
      noAuthorizedPages: '接続済みですが、許可されたページがありません', zeroVisibleMeta: 'トークン有効 · 表示可能なページ 0',
      twoOfThreeComplete: '2 / 3 完了', connectedTo: '{workspace} に接続済み',
      visibleMeta: '{count} 件のページ／データベース · 今確認しました', allComplete: '3 手順すべて完了',
      rebind: '再接続', checkConnection: '接続を確認', startConnection: '接続を開始',
      complete: '完了', currentStep: '現在の手順', pending: '未完了', needsAuthorization: '許可が必要',
      pendingCheck: '確認待ち', collapseSteps: '手順を閉じる', viewSteps: '手順を表示',
      pageCheckFailed: 'ページ確認に失敗しました：{error}', validNoVisibleTitle: 'トークンは有効ですが、表示できるページがありません',
      validNoVisibleHint: 'Notion の Content access でページを選択してから、もう一度確認してください。',
      visibleFound: '{count} 件のアクセス可能な内容が見つかりました', untitled: '無題',
      replaceTokenPlaceholder: '新しいトークンを貼り付けて現在の接続を変更',
      loadFailed: '接続状態を読み込めませんでした。再試行してください。', show: '表示', hide: '非表示',
      pasteToken: 'Notion Integration Token を貼り付けてください。', savingToken: 'トークンを安全に保存しています…',
      saveHttpFailed: '保存できませんでした（HTTP {status}）。再試行してください。',
      saveFailed: 'トークンを保存できませんでした。再試行してください。',
      checkingPages: 'トークンを検証し、アクセス可能なページを確認しています…',
      timeout: '確認がタイムアウトしました。再試行してください。',
      invalidToken: 'トークンが無効です。確認して保存し直してください。',
      validVisibilityFailed: 'トークンは有効ですが、ページ確認に失敗しました：{error}',
      validNoAuthorized: 'トークンは有効ですが、Notion ページがまだ許可されていません。',
      connectedSuccess: '接続しました。Cindy は許可された内容を読み取れます。',
      cleared: 'Notion 接続を削除しました。', clearFailed: '接続を削除できませんでした。再試行してください。',
    },
    ko: {
      pageIntro: '연결하면 Cindy가 허용된 Notion 페이지를 읽고 편집할 수 있습니다.',
      connectionAria: '연결 상태', clear: '삭제', stepsTitle: '연결 단계',
      createTitle: 'Internal connection 만들기', createHint: 'Notion 개발자 포털에서 "Notion" 만들기',
      createPanel: 'Internal connections를 열어 integration을 만든 뒤 Configuration에서 Installation access token을 복사하세요.',
      openInternal: 'Internal connections 열기 ↗', saveTokenTitle: '토큰 저장',
      saveTokenHint: 'ntn_으로 시작하는 액세스 토큰 복사', tokenPlaceholder: 'ntn_… 붙여넣기',
      toggleToken: '토큰 표시 또는 숨기기', saveAndCheck: '저장 후 확인',
      vaultHint: '토큰은 Cindy 보관소에만 저장되며 이 페이지에서 다시 읽을 수 없습니다.',
      authorizeTitle: '페이지 권한 부여', authorizeHint: 'Content access에서 Cindy가 접근할 콘텐츠 선택',
      authorizePanel: '만든 integration(새 항목은 보통 Notion, 이전 항목은 Cindy Notion으로 표시될 수 있음)을 선택한 뒤 Content access → Edit access에서 페이지를 일괄 허용하세요. 각 페이지의 Connections 메뉴에서도 추가할 수 있습니다.',
      openContentAccess: 'Content access 열기 ↗', checkPages: '페이지 확인',
      notConnected: '연결되지 않음', completeThreeSteps: '아래 3단계를 완료하면 사용할 수 있습니다',
      notComplete: '완료되지 않음', rebindStatus: 'Notion 다시 연결', rebindMeta: '새 액세스 토큰을 붙여넣고 저장',
      rebinding: '다시 연결하는 중', tokenSaved: '토큰 저장됨', checkVisibleMeta: 'Cindy가 볼 수 있는 페이지를 확인하세요',
      awaitingCheck: '확인 대기', accessNeedsAttention: '연결되었지만 페이지 권한을 확인해야 합니다',
      visibilityFailedMeta: '토큰 유효 · 페이지 확인 실패', needsPageAccess: '페이지 권한 확인 필요',
      noAuthorizedPages: '연결되었지만 허용된 페이지가 없습니다', zeroVisibleMeta: '토큰 유효 · 표시 가능한 페이지 0',
      twoOfThreeComplete: '2 / 3 완료', connectedTo: '{workspace}에 연결됨',
      visibleMeta: '페이지/데이터베이스 {count}개 · 방금 확인함', allComplete: '3단계 모두 완료',
      rebind: '다시 연결', checkConnection: '연결 확인', startConnection: '연결 시작',
      complete: '완료', currentStep: '현재 단계', pending: '대기', needsAuthorization: '권한 필요',
      pendingCheck: '확인 대기', collapseSteps: '단계 접기', viewSteps: '단계 보기',
      pageCheckFailed: '페이지 확인 실패: {error}', validNoVisibleTitle: '토큰은 유효하지만 표시 가능한 페이지가 없습니다',
      validNoVisibleHint: 'Notion의 Content access에서 페이지를 선택한 뒤 다시 확인하세요.',
      visibleFound: '접근 가능한 콘텐츠 {count}개를 찾았습니다', untitled: '제목 없음',
      replaceTokenPlaceholder: '새 토큰을 붙여넣어 현재 연결 교체',
      loadFailed: '연결 상태를 불러오지 못했습니다. 다시 시도하세요.', show: '표시', hide: '숨기기',
      pasteToken: 'Notion Integration Token을 붙여넣으세요.', savingToken: '토큰을 안전하게 저장하는 중...',
      saveHttpFailed: '저장하지 못했습니다(HTTP {status}). 다시 시도하세요.',
      saveFailed: '토큰을 저장하지 못했습니다. 다시 시도하세요.',
      checkingPages: '토큰을 검증하고 접근 가능한 페이지를 확인하는 중...',
      timeout: '확인 시간이 초과되었습니다. 다시 시도하세요.',
      invalidToken: '토큰이 잘못되었습니다. 확인한 뒤 다시 저장하세요.',
      validVisibilityFailed: '토큰은 유효하지만 페이지 확인에 실패했습니다: {error}',
      validNoAuthorized: '토큰은 유효하지만 아직 허용된 Notion 페이지가 없습니다.',
      connectedSuccess: '연결되었습니다. Cindy가 허용된 콘텐츠를 읽을 수 있습니다.',
      cleared: 'Notion 연결을 삭제했습니다.', clearFailed: '연결을 삭제하지 못했습니다. 다시 시도하세요.',
    },
  };
  var currentLocale = 'en';
  var bc = new BroadcastChannel('cindy-notion');
  var statusTimer = null;
  var testSeq = 0;
  var cancelActiveTest = null;
  var saved = false;
  var tail = '';
  var identity = null;
  var stepsExpanded = true;
  var openStepId = 'step-create';
  var rebindMode = false;

  function $(id) {
    return document.getElementById(id);
  }

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

  function showStatus(text, sticky) {
    $('status').textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    if (!sticky && text) {
      statusTimer = setTimeout(function () {
        $('status').textContent = '';
      }, 6000);
    }
  }

  function hasVisibleContent() {
    return Boolean(
      saved &&
      identity &&
      identity.botId &&
      identity.visibilityChecked &&
      !identity.visibilityError &&
      identity.visibleCount > 0
    );
  }

  function currentState() {
    if (!saved) {
      return {
        status: t('notConnected'),
        meta: t('completeThreeSteps'),
        complete: false,
        summary: t('notComplete'),
      };
    }
    if (rebindMode) {
      return {
        status: t('rebindStatus'),
        meta: t('rebindMeta'),
        complete: false,
        summary: t('rebinding'),
      };
    }
    if (!identity || !identity.botId) {
      return {
        status: t('tokenSaved'),
        meta: t('checkVisibleMeta'),
        complete: false,
        summary: t('awaitingCheck'),
      };
    }
    if (identity.visibilityError) {
      return {
        status: t('accessNeedsAttention'),
        meta: t('visibilityFailedMeta'),
        complete: false,
        summary: t('needsPageAccess'),
      };
    }
    if (identity.visibilityChecked && identity.visibleCount === 0) {
      return {
        status: t('noAuthorizedPages'),
        meta: t('zeroVisibleMeta'),
        complete: false,
        summary: t('twoOfThreeComplete'),
      };
    }
    if (hasVisibleContent()) {
      return {
        status: t('connectedTo', { workspace: identity.workspaceName || 'Notion' }),
        meta: t('visibleMeta', {
          count: identity.visibleCount + (identity.visibleHasMore ? '+' : ''),
        }),
        complete: true,
        summary: t('allComplete'),
      };
    }
    return {
      status: t('tokenSaved'),
      meta: t('checkVisibleMeta'),
      complete: false,
      summary: t('awaitingCheck'),
    };
  }

  function setStep(step, state, result, expanded) {
    step.classList.remove('is-complete', 'is-active', 'is-pending', 'is-open');
    step.classList.add(state);
    step.querySelector('.step-result').textContent = result;
    step.querySelector('.step-head').setAttribute('aria-expanded', expanded ? 'true' : 'false');
    step.querySelector('.chevron').textContent = expanded ? '⌃' : '⌄';
    if (expanded) step.classList.add('is-open');
  }

  function renderVisibleList(nextIdentity) {
    var box = $('visible-list');
    box.textContent = '';
    if (!nextIdentity || !nextIdentity.visibilityChecked) {
      if (nextIdentity && nextIdentity.visibilityError) {
        box.className = 'visible-list show';
        box.textContent = t('pageCheckFailed', { error: nextIdentity.visibilityError });
      } else {
        box.className = 'visible-list';
      }
      return;
    }
    box.className = 'visible-list show';
    if (!nextIdentity.visibleCount) {
      var emptyTitle = document.createElement('strong');
      emptyTitle.textContent = t('validNoVisibleTitle');
      box.appendChild(emptyTitle);
      var emptyText = document.createElement('p');
      emptyText.textContent = t('validNoVisibleHint');
      box.appendChild(emptyText);
      return;
    }
    var title = document.createElement('strong');
    title.textContent = t('visibleFound', {
      count: nextIdentity.visibleCount + (nextIdentity.visibleHasMore ? '+' : ''),
    });
    box.appendChild(title);
    var samples = Array.isArray(nextIdentity.visibleSamples) ? nextIdentity.visibleSamples : [];
    if (samples.length) {
      var list = document.createElement('ul');
      samples.forEach(function (sample) {
        var item = document.createElement('li');
        item.textContent = (sample.title || t('untitled')) +
          (sample.object ? ' · ' + sample.object : '');
        list.appendChild(item);
      });
      box.appendChild(list);
    }
  }

  function render() {
    var state = currentState();
    var attention = !state.complete;
    $('connection-row').classList.toggle('needs-attention', attention);
    $('hero-status').textContent = state.status;
    $('workspace-meta').textContent = state.meta;
    $('steps-summary').textContent = state.summary;
    $('clear').hidden = !saved;
    $('clear').disabled = !saved;
    $('rebind').textContent = state.complete ? t('rebind') : (saved ? t('checkConnection') : t('startConnection'));
    $('test').disabled = !saved;

    var createState = saved ? ['is-complete', t('complete')] : ['is-active', t('currentStep')];
    var tokenState = saved ? ['is-complete', t('complete')] : ['is-pending', t('pending')];
    var accessState = ['is-pending', t('pending')];

    if (saved && !state.complete) {
      accessState = ['is-active', identity && identity.visibilityChecked && !identity.visibleCount ? t('needsAuthorization') : t('currentStep')];
    }
    if (rebindMode) {
      tokenState = ['is-active', t('currentStep')];
      accessState = ['is-pending', t('pendingCheck')];
    } else if (state.complete) {
      accessState = ['is-complete', t('complete')];
    }

    setStep($('step-create'), createState[0], createState[1], openStepId === 'step-create');
    setStep($('step-token'), tokenState[0], tokenState[1], openStepId === 'step-token');
    setStep($('step-access'), accessState[0], accessState[1], openStepId === 'step-access');

    var section = document.querySelector('.steps-section');
    section.classList.toggle('expanded', stepsExpanded);
    $('steps-toggle').setAttribute('aria-expanded', stepsExpanded ? 'true' : 'false');
    $('toggle-copy').textContent = stepsExpanded ? t('collapseSteps') : t('viewSteps');
    document.querySelector('.toggle-chevron').textContent = stepsExpanded ? '⌃' : '⌄';
    renderVisibleList(identity);
  }

  async function load() {
    try {
      var nextSaved = false;
      var nextTail = '';
      var secrets = await (await fetch('/secrets')).json();
      for (var i = 0; i < secrets.length; i++) {
        if (secrets[i] && secrets[i].key === KEY) {
          nextSaved = Boolean(secrets[i].saved);
          nextTail = secrets[i].tail || '';
        }
      }
      saved = nextSaved;
      tail = nextTail;
      identity = null;
      try {
        var kv = await (await fetch('/kv')).json();
        if (saved && kv && kv.notionIdentity && typeof kv.notionIdentity === 'object') {
          identity = kv.notionIdentity;
        }
      } catch (e) {
        /* 缓存读取失败不影响 token 状态。 */
      }
      if (!saved) {
        rebindMode = false;
        openStepId = 'step-create';
        stepsExpanded = true;
      } else if (!rebindMode && hasVisibleContent()) {
        stepsExpanded = false;
        openStepId = '';
      } else if (!rebindMode) {
        stepsExpanded = true;
        openStepId = 'step-access';
      }
      $('token').placeholder = saved ? t('replaceTokenPlaceholder') : t('tokenPlaceholder');
      render();
    } catch (e) {
      showStatus(t('loadFailed'), true);
    }
  }

  function syncEye() {
    var input = $('token');
    var eye = $('eye');
    var empty = input.value.length === 0;
    eye.hidden = empty;
    if (empty) {
      input.type = 'password';
      eye.textContent = t('show');
    }
  }

  async function save() {
    var value = $('token').value.trim();
    if (!value) {
      showStatus(t('pasteToken'));
      return;
    }
    $('save').disabled = true;
    showStatus(t('savingToken'), true);
    try {
      var response = await fetch('/secrets/' + KEY, {
        method: 'PUT',
        body: JSON.stringify({ value: value }),
      });
      if (response.status !== 204) {
        showStatus(t('saveHttpFailed', { status: response.status }), true);
        return;
      }
      $('token').value = '';
      syncEye();
      rebindMode = false;
      openStepId = 'step-access';
      stepsExpanded = true;
      await load();
      await test();
    } catch (e) {
      showStatus(t('saveFailed'), true);
    } finally {
      $('save').disabled = false;
    }
  }

  async function test() {
    var generation = ++testSeq;
    var reqId = 'notion-test-' + Date.now() + '-' + generation;
    if (cancelActiveTest) cancelActiveTest();
    $('test').disabled = true;
    showStatus(t('checkingPages'), true);
    try {
      await fetch('/wake');
    } catch (e) {
      /* 广播重发与超时会提供最终反馈。 */
    }
    if (generation !== testSeq) return;

    var settled = false;
    var resendTimer = null;
    var deadline = null;

    function cleanup() {
      bc.removeEventListener('message', onMessage);
      if (deadline) clearTimeout(deadline);
      if (resendTimer) clearInterval(resendTimer);
      if (cancelActiveTest === cancel) cancelActiveTest = null;
    }

    function cancel() {
      if (settled) return;
      settled = true;
      cleanup();
    }

    cancelActiveTest = cancel;
    deadline = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
      showStatus(t('timeout'), true);
      void load();
    }, 15000);

    function onMessage(event) {
      var message = event && event.data;
      if (!message || message.type !== 'test-connection-result' || message.reqId !== reqId) return;
      if (settled) return;
      settled = true;
      cleanup();

      if (!message.ok) {
        showStatus(message.message || t('invalidToken'), true);
      } else if (message.visibilityError) {
        showStatus(t('validVisibilityFailed', { error: message.visibilityError }), true);
      } else if (!message.visibleCount) {
        showStatus(t('validNoAuthorized'), true);
      } else {
        showStatus(t('connectedSuccess'));
      }
      void load();
    }

    bc.addEventListener('message', onMessage);
    var send = function () {
      bc.postMessage({ type: 'test-connection', reqId: reqId, locale: currentLocale });
    };
    send();
    resendTimer = setInterval(function () {
      if (settled) {
        clearInterval(resendTimer);
        return;
      }
      send();
    }, 400);
  }

  async function clearConnection() {
    $('clear').disabled = true;
    try {
      var response = await fetch('/secrets/' + KEY, { method: 'DELETE' });
      if (response.status !== 204) {
        throw new Error('secret delete failed');
      }
      try {
        var kv = await (await fetch('/kv')).json();
        if (kv && typeof kv === 'object') {
          delete kv.notionIdentity;
          await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
        }
      } catch (e) {
        /* 展示缓存清理失败不影响凭证清除。 */
      }
      showStatus(t('cleared'));
    } catch (e) {
      showStatus(t('clearFailed'), true);
    } finally {
      await load();
    }
  }

  $('steps-toggle').addEventListener('click', function () {
    stepsExpanded = !stepsExpanded;
    render();
  });

  $('rebind').addEventListener('click', function () {
    if (!saved) {
      stepsExpanded = true;
      openStepId = 'step-create';
      render();
      return;
    }
    if (!hasVisibleContent()) {
      stepsExpanded = true;
      openStepId = 'step-access';
      void test();
      render();
      return;
    }
    rebindMode = true;
    stepsExpanded = true;
    openStepId = 'step-token';
    render();
    $('token').focus();
  });

  $('eye').addEventListener('click', function () {
    var input = $('token');
    var reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('eye').textContent = reveal ? t('hide') : t('show');
  });
  $('token').addEventListener('input', syncEye);
  $('token').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    }
  });
  $('save').addEventListener('click', function () {
    void save();
  });
  $('test').addEventListener('click', function () {
    void test();
  });
  $('clear').addEventListener('click', function () {
    void clearConnection();
  });

  document.querySelectorAll('.step-head').forEach(function (head) {
    head.addEventListener('click', function () {
      var step = head.closest('.step');
      openStepId = step.id;
      stepsExpanded = true;
      render();
    });
  });

  void loadHostLocale().then(function () {
    syncEye();
    return load();
  });
})();
