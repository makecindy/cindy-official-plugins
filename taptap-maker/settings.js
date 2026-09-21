(function () {
  'use strict';

  var CHANNEL = 'taptap-maker-settings';
  var MESSAGES = {
    en: {
      imageEnabled: 'Allow Maker image generation',
      imageHint: 'On by default. Includes single images, batches and edits; may consume Maker credits. Turning off blocks future requests, not tasks already submitted.',
      videoEnabled: 'Allow Maker video generation',
      videoHint: 'On by default. Turning off blocks new video generation, but still allows querying submitted tasks.',
      audioEnabled: 'Allow Maker audio generation',
      audioHint: 'On by default. Includes music, sound effects, dialogue, voice previews and confirmation; may consume credits or voice slots. Submitted tasks are not canceled.',
      mediaSaving: 'Saving…', mediaSaved: 'Saved',
      mediaLoadFailed: 'Could not load the media settings. Reopen this page to retry.',
      mediaSaveFailed: 'Could not confirm the save. Reopen this page to check the settings.',
      accountTitle: 'TapTap Maker account', officialRuntime: 'Official Runtime',
      checkingStatus: 'Checking sign-in status...', browserAuthTitle: 'Option 1: Browser authorization',
      openBrowserAuth: 'Authorize in browser',
      browserAuthHint: 'The official CLI opens TapTap and connects automatically after authorization.',
      manualPatTitle: 'Option 2: Manual PAT', getPat: 'Get PAT', savePat: 'Save PAT',
      patPlaceholder: 'Paste TapTap Maker PAT',
      connectedPatPlaceholder: 'Connected. Paste a new PAT to replace it.',
      patHint: '"Get PAT" opens TapTap Maker in your default browser. The Runtime validates and stores the PAT; this page only shows a masked summary.',
      syncTitle: 'Sync Maker projects locally', refreshProjects: 'Refresh projects',
      syncHint: 'Filter and select up to 5 recent projects, then choose a parent folder. Each project is initialized in its own subfolder.',
      projectFilterPlaceholder: 'Filter by project name or ID',
      projectFilterAria: 'Filter TapTap Maker projects',
      chooseFolderAndSync: 'Choose parent folder and sync',
      disconnected: 'Not connected', connected: 'Connected to TapTap Maker',
      unknownStatus: 'Unable to verify sign-in status',
      selectedCount: '{count} selected', recentActivity: 'Last active {date}',
      connectToLoad: 'Connect an account to load projects', noProjects: 'No projects available',
      noMatches: 'No matching projects', maxProjects: 'You can sync up to 5 projects at a time.',
      loadingProjects: 'Loading projects...', projectListFailed: 'Could not load TapTap Maker projects. Try again.',
      completeAuth: 'Complete TapTap authorization in your browser...',
      loginFailed: 'TapTap Maker sign-in was not completed. Try again.',
      patPageOpened: 'Opened the TapTap Maker PAT page in your default browser.',
      patPageFailed: 'Could not open the TapTap Maker PAT page. Try again.',
      enterPat: 'Enter a TapTap Maker PAT.', savingPat: 'Validating and saving PAT...',
      patSaved: 'The TapTap Maker Runtime validated and saved the PAT.',
      patSaveFailed: 'Could not save the TapTap Maker PAT. Try again.',
      openConsole: 'Open Maker console',
      consoleHint: 'Starts a local service; does not build, submit, or install a game runtime. Closing the page does not stop the service; stop it in the console. Media switches apply to Agent tools, not manual console actions.',
      consoleReady: 'Console ready. Use the link if it did not open.',
      consoleFailed: 'Startup could not be confirmed. Check the existing console and system Node.js; do not automatically retry.',
      chooseParent: 'Choose a parent folder. The selected projects will then sync one by one.',
      syncCanceled: 'Sync canceled.', unknownProject: 'Unknown project',
      syncFailure: 'Sync failed. Try again.', syncSuccess: 'Synced {count} projects to {path}',
      syncPartial: 'Synced {success}; {failed} failed{details}',
      syncFailed: 'Could not sync TapTap Maker projects. Try again.',
      syncAuthRequired: 'TapTap Maker sign-in expired. Reconnect the account and try again.',
      syncTargetOccupied: 'The project folder already contains unrelated files. Choose another parent folder or resolve the folder manually.',
      syncGitMissing: 'Git was not found. Install Git, restart Cindy, and try again.',
      syncPythonSetupFailed: 'Maker could not prepare Python. Check the network, proxy, and folder permissions, then try again.',
      syncNetworkError: 'Could not connect to TapTap Maker. Check the network and try again.',
      operationFailed: 'TapTap Maker settings operation failed.',
      responseTimeout: 'The TapTap Maker plugin timed out. Try again.',
    },
    'zh-CN': {
      imageEnabled: '允许 Maker 生图',
      imageHint: '默认开启，包含单张生图、批量生图和改图，可能消耗 Maker 积分。关闭后拦截后续请求，不影响已提交任务。',
      videoEnabled: '允许 Maker 生视频',
      videoHint: '默认开启。关闭后拦截新的视频生成请求，仍可查询已提交任务。',
      audioEnabled: '允许 Maker 生音频',
      audioHint: '默认开启，包含音乐、音效、配音、音色试听及确认，可能消耗积分或音色名额；关闭不会取消已提交任务。',
      mediaSaving: '正在保存…', mediaSaved: '已保存',
      mediaLoadFailed: '素材设置加载失败，请重新打开页面重试',
      mediaSaveFailed: '未能确认保存结果，请重新打开页面核对设置',
      accountTitle: 'TapTap Maker 账号', officialRuntime: '官方 Runtime',
      checkingStatus: '正在检查登录状态…', browserAuthTitle: '方式一：浏览器授权',
      openBrowserAuth: '打开浏览器授权', browserAuthHint: '由官方 CLI 打开 TapTap 页面，授权完成后自动连接。',
      manualPatTitle: '方式二：手动 PAT', getPat: '获取 PAT', savePat: '保存 PAT',
      patPlaceholder: '粘贴 TapTap Maker PAT', connectedPatPlaceholder: '已连接，可粘贴新 PAT 覆盖',
      patHint: '“获取 PAT”会在系统默认浏览器打开 TapTap Maker 页面；PAT 由 TapTap Maker Runtime 验证和保存，设置页只显示脱敏摘要。',
      syncTitle: '同步 Maker 项目到本地', refreshProjects: '刷新项目',
      syncHint: '筛选并选择最近项目（最多 5 个），再选择一个父目录；每个项目会初始化到独立子目录。',
      projectFilterPlaceholder: '按项目名称或 ID 筛选', projectFilterAria: '筛选 TapTap Maker 项目',
      chooseFolderAndSync: '选择父目录并同步', disconnected: '尚未连接',
      connected: '已连接 TapTap Maker', unknownStatus: '暂时无法验证登录状态',
      selectedCount: '已选择 {count} 个', recentActivity: '最近活动 {date}',
      connectToLoad: '连接账号后加载项目', noProjects: '暂无可用项目', noMatches: '没有匹配的项目',
      maxProjects: '一次最多同步 5 个项目', loadingProjects: '正在加载项目…',
      projectListFailed: 'TapTap Maker 项目列表获取失败，请重试',
      completeAuth: '请在浏览器中完成 TapTap 授权…', loginFailed: 'TapTap Maker 登录未完成，请重试',
      patPageOpened: '已在系统默认浏览器打开 TapTap Maker PAT 页面',
      patPageFailed: '无法打开 TapTap Maker PAT 页面，请重试', enterPat: '请输入 TapTap Maker PAT',
      savingPat: '正在验证并保存 PAT…', patSaved: 'PAT 已由 TapTap Maker Runtime 验证并保存',
      patSaveFailed: 'TapTap Maker PAT 保存失败，请重试',
      openConsole: '打开 Maker 控制台',
      consoleHint: '启动本地服务，不自动构建或安装游戏运行环境。关闭页面不会停止服务，请在控制台停止。媒体开关只限制 Agent 工具，不限制控制台中的手动操作。',
      consoleReady: '控制台已就绪，未自动打开时请点击链接。',
      consoleFailed: '无法确认启动结果。请检查已有控制台及系统 Node.js，不要自动重试。',
      chooseParent: '请选择父目录，随后将逐个同步所选项目…', syncCanceled: '已取消同步',
      unknownProject: '未知项目', syncFailure: '同步失败，请重试',
      syncSuccess: '已同步 {count} 个项目到 {path}',
      syncPartial: '已同步 {success} 个，失败 {failed} 个{details}',
      syncFailed: 'TapTap Maker 项目同步失败，请重试',
      syncAuthRequired: 'TapTap Maker 登录已失效，请重新连接账号后重试',
      syncTargetOccupied: '目标子目录已有其他内容，请改选父目录或手动处理该子目录',
      syncGitMissing: '本机未检测到 Git，请安装 Git 并重启 Cindy 后重试',
      syncPythonSetupFailed: 'Maker 自动准备 Python 环境失败，请检查网络、代理和目录权限后重试',
      syncNetworkError: '连接 TapTap Maker 失败，请检查网络后重试',
      operationFailed: 'TapTap Maker 设置操作失败', responseTimeout: 'TapTap Maker 插件响应超时，请稍后重试',
    },
    ja: {
      imageEnabled: 'Maker の画像生成を許可',
      imageHint: '初期設定は有効です。単一・一括生成と画像編集を含み、Maker クレジットを消費する場合があります。無効化は今後のリクエストに適用され、送信済みのタスクには影響しません。',
      videoEnabled: 'Maker の動画生成を許可',
      videoHint: '初期設定は有効です。無効化すると新しい動画生成は停止しますが、送信済みタスクの照会は可能です。',
      audioEnabled: 'Maker の音声生成を許可',
      audioHint: '初期設定は有効です。音楽・効果音・台詞・声の試聴と確定を含み、クレジットや音声枠を消費する場合があります。送信済みタスクは取り消しません。',
      mediaSaving: '保存中…', mediaSaved: '保存しました',
      mediaLoadFailed: '素材設定を読み込めませんでした。ページを開き直してください。',
      mediaSaveFailed: '保存結果を確認できませんでした。ページを開き直して設定を確認してください。',
      accountTitle: 'TapTap Maker アカウント', officialRuntime: '公式 Runtime',
      checkingStatus: 'ログイン状態を確認しています…', browserAuthTitle: '方法 1：ブラウザ認証',
      openBrowserAuth: 'ブラウザで認証', browserAuthHint: '公式 CLI が TapTap を開き、認証完了後に自動接続します。',
      manualPatTitle: '方法 2：PAT を手動入力', getPat: 'PAT を取得', savePat: 'PAT を保存',
      patPlaceholder: 'TapTap Maker PAT を貼り付け', connectedPatPlaceholder: '接続済み。新しい PAT を貼り付けて更新できます。',
      patHint: '「PAT を取得」は既定のブラウザで TapTap Maker を開きます。PAT は Runtime が検証・保存し、このページにはマスク済みの概要のみ表示されます。',
      syncTitle: 'Maker プロジェクトをローカルに同期', refreshProjects: 'プロジェクトを更新',
      syncHint: '最近のプロジェクトを最大 5 件選択し、親フォルダを指定します。各プロジェクトは個別のサブフォルダに初期化されます。',
      projectFilterPlaceholder: 'プロジェクト名または ID で絞り込み', projectFilterAria: 'TapTap Maker プロジェクトを絞り込み',
      chooseFolderAndSync: '親フォルダを選択して同期', disconnected: '未接続',
      connected: 'TapTap Maker に接続済み', unknownStatus: 'ログイン状態を確認できません',
      selectedCount: '{count} 件選択中', recentActivity: '最終アクティビティ {date}',
      connectToLoad: 'アカウントを接続するとプロジェクトを読み込めます', noProjects: '利用可能なプロジェクトはありません',
      noMatches: '一致するプロジェクトはありません', maxProjects: '一度に同期できるのは最大 5 件です',
      loadingProjects: 'プロジェクトを読み込んでいます…', projectListFailed: 'プロジェクト一覧を取得できませんでした。再試行してください。',
      completeAuth: 'ブラウザで TapTap の認証を完了してください…', loginFailed: 'ログインが完了しませんでした。再試行してください。',
      patPageOpened: '既定のブラウザで TapTap Maker の PAT ページを開きました。',
      patPageFailed: 'PAT ページを開けませんでした。再試行してください。', enterPat: 'TapTap Maker PAT を入力してください。',
      savingPat: 'PAT を検証して保存しています…', patSaved: 'Runtime が PAT を検証して保存しました。',
      patSaveFailed: 'PAT を保存できませんでした。再試行してください。',
      openConsole: 'Maker コンソールを開く',
      consoleHint: 'ローカルサービスを起動します。ビルド、提出、ゲームランタイムのインストールは行いません。ページを閉じても停止しません。サービスはコンソールで停止してください。メディア設定は Agent ツールのみ対象で、手動操作には適用されません。',
      consoleReady: 'コンソールの準備ができました。開かない場合はリンクを使用してください。',
      consoleFailed: '起動を確認できません。既存のコンソールとシステム Node.js を確認し、自動再試行しないでください。',
      chooseParent: '親フォルダを選択すると、選択したプロジェクトを順番に同期します。',
      syncCanceled: '同期をキャンセルしました。', unknownProject: '不明なプロジェクト',
      syncFailure: '同期に失敗しました。再試行してください。', syncSuccess: '{count} 件を {path} に同期しました',
      syncPartial: '{success} 件を同期、{failed} 件が失敗しました{details}',
      syncFailed: 'プロジェクトを同期できませんでした。再試行してください。',
      syncAuthRequired: 'TapTap Maker のログインが期限切れです。アカウントを再接続してから再試行してください。',
      syncTargetOccupied: 'プロジェクトフォルダに別のファイルがあります。別の親フォルダを選ぶか、フォルダを手動で整理してください。',
      syncGitMissing: 'Git が見つかりません。Git をインストールし、Cindy を再起動してから再試行してください。',
      syncPythonSetupFailed: 'Maker が Python 環境を準備できませんでした。ネットワーク、プロキシ、フォルダ権限を確認して再試行してください。',
      syncNetworkError: 'TapTap Maker に接続できませんでした。ネットワークを確認して再試行してください。',
      operationFailed: 'TapTap Maker の設定操作に失敗しました。', responseTimeout: 'TapTap Maker プラグインがタイムアウトしました。再試行してください。',
    },
    ko: {
      imageEnabled: 'Maker 이미지 생성 허용',
      imageHint: '기본적으로 켜져 있습니다. 단일·일괄 생성 및 편집을 포함하며 Maker 크레딧이 사용될 수 있습니다. 끄면 이후 요청만 차단되며 이미 제출한 작업에는 영향을 주지 않습니다.',
      videoEnabled: 'Maker 동영상 생성 허용',
      videoHint: '기본적으로 켜져 있습니다. 끄면 새 동영상 생성은 차단되지만 제출한 작업은 조회할 수 있습니다.',
      audioEnabled: 'Maker 오디오 생성 허용',
      audioHint: '기본적으로 켜져 있습니다. 음악, 효과음, 대사, 음성 미리듣기 및 확정을 포함하며 크레딧이나 음성 슬롯이 사용될 수 있습니다. 제출한 작업은 취소되지 않습니다.',
      mediaSaving: '저장 중…', mediaSaved: '저장됨',
      mediaLoadFailed: '미디어 설정을 불러오지 못했습니다. 페이지를 다시 열어 주세요.',
      mediaSaveFailed: '저장 결과를 확인하지 못했습니다. 페이지를 다시 열어 설정을 확인하세요.',
      accountTitle: 'TapTap Maker 계정', officialRuntime: '공식 Runtime',
      checkingStatus: '로그인 상태를 확인하는 중...', browserAuthTitle: '방법 1: 브라우저 인증',
      openBrowserAuth: '브라우저에서 인증', browserAuthHint: '공식 CLI가 TapTap을 열고 인증이 끝나면 자동으로 연결합니다.',
      manualPatTitle: '방법 2: PAT 직접 입력', getPat: 'PAT 받기', savePat: 'PAT 저장',
      patPlaceholder: 'TapTap Maker PAT 붙여넣기', connectedPatPlaceholder: '연결됨. 새 PAT를 붙여넣어 교체할 수 있습니다.',
      patHint: '"PAT 받기"는 기본 브라우저에서 TapTap Maker를 엽니다. Runtime이 PAT를 검증하고 저장하며 이 페이지에는 마스킹된 요약만 표시됩니다.',
      syncTitle: 'Maker 프로젝트를 로컬에 동기화', refreshProjects: '프로젝트 새로고침',
      syncHint: '최근 프로젝트를 최대 5개 선택한 뒤 상위 폴더를 고르세요. 각 프로젝트는 별도 하위 폴더에 초기화됩니다.',
      projectFilterPlaceholder: '프로젝트 이름 또는 ID로 필터링', projectFilterAria: 'TapTap Maker 프로젝트 필터링',
      chooseFolderAndSync: '상위 폴더 선택 후 동기화', disconnected: '연결되지 않음',
      connected: 'TapTap Maker에 연결됨', unknownStatus: '로그인 상태를 확인할 수 없음',
      selectedCount: '{count}개 선택됨', recentActivity: '최근 활동 {date}',
      connectToLoad: '계정을 연결하면 프로젝트를 불러옵니다', noProjects: '사용 가능한 프로젝트 없음',
      noMatches: '일치하는 프로젝트 없음', maxProjects: '한 번에 최대 5개 프로젝트를 동기화할 수 있습니다.',
      loadingProjects: '프로젝트를 불러오는 중...', projectListFailed: '프로젝트 목록을 불러오지 못했습니다. 다시 시도하세요.',
      completeAuth: '브라우저에서 TapTap 인증을 완료하세요...', loginFailed: '로그인이 완료되지 않았습니다. 다시 시도하세요.',
      patPageOpened: '기본 브라우저에서 TapTap Maker PAT 페이지를 열었습니다.',
      patPageFailed: 'PAT 페이지를 열 수 없습니다. 다시 시도하세요.', enterPat: 'TapTap Maker PAT를 입력하세요.',
      savingPat: 'PAT를 검증하고 저장하는 중...', patSaved: 'Runtime이 PAT를 검증하고 저장했습니다.',
      patSaveFailed: 'PAT를 저장하지 못했습니다. 다시 시도하세요.',
      openConsole: 'Maker 콘솔 열기',
      consoleHint: '로컬 서비스를 엽니다. 빌드하거나 게임 런타임을 설치하지 않습니다. 페이지를 닫아도 서비스는 계속됩니다. 콘솔에서 서비스를 중지하세요. 미디어 설정은 Agent 도구에만 적용되며 수동 콘솔 작업에는 적용되지 않습니다.',
      consoleReady: '콘솔이 준비되었습니다. 열리지 않으면 링크를 사용하세요.',
      consoleFailed: '시작 여부를 확인할 수 없습니다. 기존 콘솔과 시스템 Node.js를 확인하고 자동으로 재시도하지 마세요.',
      chooseParent: '상위 폴더를 선택하면 선택한 프로젝트를 하나씩 동기화합니다.',
      syncCanceled: '동기화를 취소했습니다.', unknownProject: '알 수 없는 프로젝트',
      syncFailure: '동기화에 실패했습니다. 다시 시도하세요.', syncSuccess: '{count}개 프로젝트를 {path}에 동기화했습니다',
      syncPartial: '{success}개 동기화, {failed}개 실패{details}',
      syncFailed: '프로젝트를 동기화하지 못했습니다. 다시 시도하세요.',
      syncAuthRequired: 'TapTap Maker 로그인이 만료되었습니다. 계정을 다시 연결한 뒤 시도하세요.',
      syncTargetOccupied: '프로젝트 폴더에 관련 없는 파일이 있습니다. 다른 상위 폴더를 선택하거나 폴더를 직접 정리하세요.',
      syncGitMissing: 'Git을 찾을 수 없습니다. Git을 설치하고 Cindy를 다시 시작한 뒤 시도하세요.',
      syncPythonSetupFailed: 'Maker가 Python 환경을 준비하지 못했습니다. 네트워크, 프록시, 폴더 권한을 확인한 뒤 시도하세요.',
      syncNetworkError: 'TapTap Maker에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.',
      operationFailed: 'TapTap Maker 설정 작업에 실패했습니다.', responseTimeout: 'TapTap Maker 플러그인 응답 시간이 초과되었습니다. 다시 시도하세요.',
    },
  };
  var currentLocale = 'en';
  var bc = new BroadcastChannel(CHANNEL);
  var stateDot = document.getElementById('state-dot');
  var accountState = document.getElementById('account-state');
  var connectButton = document.getElementById('connect');
  var patForm = document.getElementById('pat-form');
  var getPatButton = document.getElementById('get-pat');
  var patInput = document.getElementById('pat');
  var savePatButton = document.getElementById('save-pat');
  var refreshProjectsButton = document.getElementById('refresh-projects');
  var projectFilter = document.getElementById('project-filter');
  var projectsElement = document.getElementById('projects');
  var selectedCount = document.getElementById('selected-count');
  var syncProjectsButton = document.getElementById('sync-projects');
  var message = document.getElementById('message');
  var projectMessage = document.getElementById('project-message');
  var openConsoleButton = document.getElementById('open-console');
  var consoleMessage = document.getElementById('console-message');
  var consoleLink = document.getElementById('console-link');

  var busy = false;
  var accountConnected = false;
  var projects = [];
  var selectedProjectIds = new Set();
  var nextRequestId = 1;
  var mediaControls = [
    { key: 'makerImageEnabled', toggle: document.getElementById('maker-image-enabled') },
    { key: 'makerVideoEnabled', toggle: document.getElementById('maker-video-enabled') },
    { key: 'makerAudioEnabled', toggle: document.getElementById('maker-audio-enabled') },
  ];
  var mediaMessage = document.getElementById('media-message');

  function disableMediaControls(disabled) {
    mediaControls.forEach(function disable(control) { control.toggle.disabled = disabled; });
  }

  async function readMediaPreferences() {
    var response = await fetch('/kv');
    if (!response.ok) throw new Error();
    var preferences = await response.json();
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)
      || mediaControls.some(function invalid(control) {
        return Object.prototype.hasOwnProperty.call(preferences, control.key)
          && typeof preferences[control.key] !== 'boolean';
      })) throw new Error();
    return preferences;
  }

  async function loadMediaPreferences() {
    try {
      var preferences = await readMediaPreferences();
      mediaControls.forEach(function apply(control) {
        control.saved = preferences[control.key] !== false;
        control.toggle.checked = control.saved;
      });
      disableMediaControls(false);
    } catch (_error) {
      disableMediaControls(true);
      mediaMessage.textContent = t('mediaLoadFailed');
    }
  }

  mediaControls.forEach(function wire(control) {
    control.toggle.addEventListener('change', async function saveMediaPreference() {
      if (control.toggle.disabled) return;
      var enabled = control.toggle.checked;
      disableMediaControls(true);
      mediaMessage.textContent = t('mediaSaving');
      try {
        var preferences = await readMediaPreferences();
        preferences[control.key] = enabled;
        var response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(preferences) });
        if (!response.ok) throw new Error();
        control.saved = enabled;
        mediaMessage.textContent = t('mediaSaved');
        disableMediaControls(false);
      } catch (_error) {
        control.toggle.checked = control.saved;
        mediaMessage.textContent = t('mediaSaveFailed');
      }
    });
  });

  function normalizeLocale(locale) {
    return Object.prototype.hasOwnProperty.call(MESSAGES, locale) ? locale : 'en';
  }

  function t(key, values) {
    var text = (MESSAGES[currentLocale] && MESSAGES[currentLocale][key]) || MESSAGES.en[key] || key;
    return text.replace(/\{(\w+)\}/g, function replace(_match, name) {
      return values && values[name] !== undefined ? String(values[name]) : '';
    });
  }

  function applyStaticTranslations() {
    document.documentElement.lang = currentLocale;
    document.querySelectorAll('[data-i18n]').forEach(function translate(element) {
      element.textContent = t(element.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function translatePlaceholder(element) {
      element.setAttribute('placeholder', t(element.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function translateAria(element) {
      element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria-label')));
    });
  }

  async function loadHostLocale() {
    var controller = new AbortController();
    var timeout = setTimeout(function abortLocaleRequest() {
      controller.abort();
    }, 2000);
    try {
      var response = await fetch('/app-context', { signal: controller.signal });
      if (!response.ok) throw new Error('Could not load app context');
      var result = await response.json();
      currentLocale = normalizeLocale(result && result.context && result.context.locale);
    } catch (_error) {
      currentLocale = 'en';
    } finally {
      clearTimeout(timeout);
    }
    applyStaticTranslations();
  }

  function requestFailureText(action, response) {
    var code = response && typeof response.errorCode === 'string' ? response.errorCode : '';
    var keysByCode = {
      STATUS_FAILED: 'unknownStatus',
      LOGIN_FAILED: 'loginFailed',
      PAT_PAGE_FAILED: 'patPageFailed',
      PAT_SAVE_FAILED: 'patSaveFailed',
      PROJECTS_FAILED: 'projectListFailed',
      PICK_FAILED: 'syncFailed',
      MISSING_PATH: 'syncFailed',
      SYNC_FAILED: 'syncFailed',
      UNKNOWN_ACTION: 'operationFailed',
    };
    var keysByAction = {
      status: 'unknownStatus',
      login: 'loginFailed',
      open_pat_page: 'patPageFailed',
      set_pat: 'patSaveFailed',
      projects: 'projectListFailed',
      sync_projects: 'syncFailed',
    };
    return t(keysByCode[code] || keysByAction[action] || 'operationFailed');
  }

  function syncFailureText(item) {
    var keysByCode = {
      AUTH_REQUIRED: 'syncAuthRequired',
      TARGET_OCCUPIED: 'syncTargetOccupied',
      GIT_NOT_FOUND: 'syncGitMissing',
      GIT_REQUIRED: 'syncGitMissing',
      PYTHON_SETUP_FAILED: 'syncPythonSetupFailed',
      NETWORK_ERROR: 'syncNetworkError',
    };
    return t(keysByCode[item && item.code] || 'syncFailure');
  }

  function request(action, payload, longRunning) {
    return new Promise(async function executor(resolve, reject) {
      var reqId = 'settings-' + Date.now() + '-' + nextRequestId++;
      var settled = false;
      var interval = null;
      var timeout = null;

      function cleanup() {
        if (interval) clearInterval(interval);
        if (timeout) clearTimeout(timeout);
        bc.removeEventListener('message', onMessage);
      }

      function onMessage(event) {
        var response = event && event.data;
        if (!response || response.type !== 'settings-result' || response.reqId !== reqId) return;
        if (settled) return;
        settled = true;
        cleanup();
        if (response.ok === true) resolve(response.result || {});
        else reject(new Error(requestFailureText(action, response)));
      }

      function post() {
        bc.postMessage({
          type: 'settings-request',
          reqId: reqId,
          action: action,
          payload: payload || {},
          locale: currentLocale,
        });
      }

      bc.addEventListener('message', onMessage);
      try {
        await fetch('/wake');
      } catch (_error) {
        // 重发机制会继续等待已在启动中的逻辑页。
      }
      post();
      interval = setInterval(post, 400);
      timeout = setTimeout(function onTimeout() {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(t('responseTimeout')));
      }, longRunning ? 15 * 60 * 1000 : 60 * 1000);
    });
  }

  function renderState(state, patHint) {
    stateDot.className = 'dot ' + state;
    accountConnected = state === 'connected';
    if (state === 'connected') {
      accountState.textContent = t('connected');
      patInput.placeholder = patHint || t('connectedPatPlaceholder');
    } else if (state === 'disconnected') {
      accountState.textContent = t('disconnected');
      patInput.placeholder = t('patPlaceholder');
    } else {
      accountState.textContent = t('unknownStatus');
      patInput.placeholder = t('patPlaceholder');
    }
    updateControls();
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    updateControls();
  }

  function updateControls() {
    connectButton.disabled = busy;
    getPatButton.disabled = busy;
    patInput.disabled = busy;
    savePatButton.disabled = busy;
    refreshProjectsButton.disabled = busy || !accountConnected;
    projectFilter.disabled = busy || !accountConnected;
    syncProjectsButton.disabled = busy || !accountConnected || selectedProjectIds.size === 0;
    Array.from(projectsElement.querySelectorAll('input[type="checkbox"]')).forEach(function disable(checkbox) {
      checkbox.disabled = busy;
    });
    selectedCount.textContent = t('selectedCount', { count: selectedProjectIds.size });
  }

  function projectActivityText(project) {
    if (!project.lastActiveAt) return project.id;
    var date = new Date(project.lastActiveAt);
    if (Number.isNaN(date.getTime())) return project.id;
    return project.id + ' · ' + t('recentActivity', { date: date.toLocaleDateString(currentLocale) });
  }

  function renderProjects() {
    projectsElement.replaceChildren();
    if (!accountConnected) {
      var disconnected = document.createElement('div');
      disconnected.className = 'empty';
      disconnected.textContent = t('connectToLoad');
      projectsElement.append(disconnected);
      updateControls();
      return;
    }

    var query = projectFilter.value.trim().toLocaleLowerCase();
    var visible = projects.filter(function matches(project) {
      return !query
        || project.name.toLocaleLowerCase().includes(query)
        || project.id.toLocaleLowerCase().includes(query);
    }).slice(0, 5);
    if (visible.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = projects.length === 0 ? t('noProjects') : t('noMatches');
      projectsElement.append(empty);
      updateControls();
      return;
    }

    visible.forEach(function renderProject(project) {
      var row = document.createElement('label');
      row.className = 'project-row';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedProjectIds.has(project.id);
      checkbox.addEventListener('change', function onChange() {
        if (checkbox.checked) {
          if (selectedProjectIds.size >= 5) {
            checkbox.checked = false;
            projectMessage.textContent = t('maxProjects');
            return;
          }
          selectedProjectIds.add(project.id);
        } else {
          selectedProjectIds.delete(project.id);
        }
        updateControls();
      });
      var main = document.createElement('span');
      main.className = 'project-main';
      var name = document.createElement('div');
      name.className = 'project-name';
      name.textContent = project.name;
      var meta = document.createElement('div');
      meta.className = 'project-meta';
      meta.textContent = projectActivityText(project);
      main.append(name, meta);
      row.append(checkbox, main);
      projectsElement.append(row);
    });
    updateControls();
  }

  async function refreshProjects() {
    if (!accountConnected) {
      projects = [];
      selectedProjectIds.clear();
      renderProjects();
      return;
    }
    projectsElement.replaceChildren();
    var loading = document.createElement('div');
    loading.className = 'empty';
    loading.textContent = t('loadingProjects');
    projectsElement.append(loading);
    try {
      var result = await request('projects', {}, false);
      projects = Array.isArray(result.projects)
        ? result.projects.filter(function valid(project) {
          return project && typeof project.id === 'string' && typeof project.name === 'string';
        })
        : [];
      var availableIds = new Set(projects.map(function id(project) { return project.id; }));
      Array.from(selectedProjectIds).forEach(function removeUnavailable(id) {
        if (!availableIds.has(id)) selectedProjectIds.delete(id);
      });
      renderProjects();
    } catch (error) {
      projects = [];
      selectedProjectIds.clear();
      renderProjects();
      projectMessage.textContent = error.message || t('projectListFailed');
    }
  }

  async function refreshAccount() {
    message.textContent = '';
    try {
      var result = await request('status', {}, false);
      renderState(result.state || 'unknown', result.patHint);
      await refreshProjects();
    } catch (_error) {
      renderState('unknown');
      await refreshProjects();
    }
  }

  connectButton.addEventListener('click', async function connect() {
    setBusy(true);
    accountState.textContent = t('completeAuth');
    message.textContent = '';
    try {
      var result = await request('login', {}, true);
      renderState('connected', result.patHint);
      await refreshProjects();
    } catch (error) {
      renderState('unknown');
      message.textContent = error.message || t('loginFailed');
    } finally {
      setBusy(false);
    }
  });

  getPatButton.addEventListener('click', async function openPatPage() {
    setBusy(true);
    message.textContent = '';
    try {
      await request('open_pat_page', {}, false);
      message.textContent = t('patPageOpened');
    } catch (error) {
      message.textContent = error.message || t('patPageFailed');
    } finally {
      setBusy(false);
    }
  });

  openConsoleButton.addEventListener('click', async function openConsole() {
    openConsoleButton.disabled = true;
    consoleLink.hidden = true;
    consoleMessage.textContent = '';
    try {
      var result = await request('console_open', {}, true);
      consoleLink.href = result.url;
      consoleLink.hidden = false;
      consoleMessage.textContent = t('consoleReady');
    } catch (_error) {
      consoleMessage.textContent = t('consoleFailed');
    } finally {
      openConsoleButton.disabled = false;
    }
  });

  patForm.addEventListener('submit', async function savePat(event) {
    event.preventDefault();
    var pat = patInput.value.trim();
    if (!pat) {
      message.textContent = t('enterPat');
      patInput.focus();
      return;
    }
    setBusy(true);
    accountState.textContent = t('savingPat');
    message.textContent = '';
    try {
      var result = await request('set_pat', { pat: pat }, true);
      patInput.value = '';
      renderState('connected', result.patHint);
      message.textContent = t('patSaved');
      await refreshProjects();
    } catch (error) {
      renderState('unknown');
      message.textContent = error.message || t('patSaveFailed');
    } finally {
      // 完整 PAT 不写入任何持久化状态，交给 Runtime 后立即丢弃页面引用。
      pat = '';
      setBusy(false);
    }
  });

  refreshProjectsButton.addEventListener('click', async function refresh() {
    setBusy(true);
    projectMessage.textContent = '';
    try {
      await refreshProjects();
    } finally {
      setBusy(false);
    }
  });

  projectFilter.addEventListener('input', renderProjects);

  syncProjectsButton.addEventListener('click', async function syncProjects() {
    if (selectedProjectIds.size === 0) return;
    setBusy(true);
    projectMessage.textContent = t('chooseParent');
    try {
      var result = await request('sync_projects', {
        projectIds: Array.from(selectedProjectIds),
      }, true);
      if (result.canceled) {
        projectMessage.textContent = t('syncCanceled');
        return;
      }
      var results = Array.isArray(result.results) ? result.results : [];
      var succeeded = results.filter(function success(item) { return item && item.ok === true; });
      var failed = results.filter(function failure(item) { return !item || item.ok !== true; });
      succeeded.forEach(function clearSelection(item) { selectedProjectIds.delete(item.id); });
      renderProjects();
      if (failed.length === 0) {
        projectMessage.textContent = t('syncSuccess', {
          count: succeeded.length,
          path: result.parentDir,
        });
      } else {
        var failures = failed.map(function failureText(item) {
          var name = item && typeof item.name === 'string' ? item.name : t('unknownProject');
          var separator = currentLocale === 'en' || currentLocale === 'ko' ? ': ' : '：';
          return name + separator + syncFailureText(item);
        }).join(currentLocale === 'en' || currentLocale === 'ko' ? '; ' : '；');
        projectMessage.textContent = t('syncPartial', {
          success: succeeded.length,
          failed: failed.length,
          details: failures
            ? (currentLocale === 'en' || currentLocale === 'ko' ? ': ' : '。') + failures
            : '',
        });
      }
    } catch (error) {
      projectMessage.textContent = error.message || t('syncFailed');
    } finally {
      setBusy(false);
    }
  });

  void loadHostLocale().then(function start() {
    accountState.textContent = t('checkingStatus');
    updateControls();
    return Promise.all([loadMediaPreferences(), refreshAccount()]);
  });
}());
