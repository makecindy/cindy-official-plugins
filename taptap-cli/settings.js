'use strict';

// Settings page for the TapTap CLI plugin.
//
// Two jobs: show whether the user's own taptap-cli is installed, which version
// it is and whether they are signed in; and store an optional absolute path to
// the CLI for when the worker cannot find it on PATH.
//
// The page decides none of those facts itself. It asks the brain over the
// shared channel, and the worker answers — so "installed" and "signed in" are
// computed in exactly one place. Nothing here touches credentials: those live
// in the CLI's own credential store, never in the plugin.

(function () {
  var CHANNEL = 'taptap-cli';
  var PROBE_TIMEOUT_MS = 30000;
  var RESEND_INTERVAL_MS = 400;
  var AUTO_PROBE_DELAY_MS = 1200;

  var MESSAGES = {
    en: {
      intro: 'This plugin runs the official taptap-cli you installed on this machine; it does not bundle a binary. Install and authorize it in a terminal first:',
      installCommands: 'npm install -g @taptap/cli               # install (package ~37 MB)\ntaptap-cli update --skills-layout suite  # install AI Skills, merged into one taptap-suite\ntaptap-cli auth login                    # authorize',
      installNote1: 'The plugin auto-searches PATH and version-manager global directories (nvm / proto / volta etc.), so it usually works right after install without configuring PATH.',
      installNote2: 'Merging AI Skills into one taptap-suite minimizes overlap with this plugin\'s manuals; use --skills-layout separate if you want those skills individually.',
      check: 'Check status',
      checking: 'Checking the local taptap-cli…',
      cliLabel: 'CLI',
      loginLabel: 'Sign-in',
      notInstalled: 'Not installed',
      unknown: 'Unknown',
      loggedIn: 'Signed in',
      loggedOut: 'Not signed in',
      versionUnavailable: 'Version unavailable',
      probeTimeout: 'Status check timed out.',
      probeFailed: 'Status check failed: ',
      pathLabel: 'CLI path (optional)',
      pathPlaceholder: 'Leave empty to auto-detect PATH, ~/.local/bin, and other common locations',
      save: 'Save',
      pathHint: 'Fill this in only when auto-detection fails, for example /opt/homebrew/bin/taptap-cli. Only a program named taptap-cli is accepted, and a wrong path reports an error.',
      saved: 'Saved.',
      cleared: 'Cleared; auto-detection will be used.',
      saveFailed: 'Could not save: '
    },
    'zh-CN': {
      intro: '本插件调用你本机已安装的官方 taptap-cli,不随包分发二进制。先在终端完成安装与授权:',
      installCommands: 'npm install -g @taptap/cli               # 安装（包约 37MB）\ntaptap-cli update --skills-layout suite  # 安装 AI Skills，并合并为单个 taptap-suite\ntaptap-cli auth login                    # 授权',
      installNote1: '插件会自动搜索 PATH 以及 nvm / proto / volta 等版本管理器下的全局目录，装完即可用，通常不需要手动配置 PATH。',
      installNote2: 'AI Skills 合并为单个 taptap-suite 后，它与本插件手册的重叠面最小；若你还要单独使用那些 skill，把 --skills-layout 换成 separate 即可。',
      check: '检查状态',
      checking: '正在检查本机 taptap-cli…',
      cliLabel: 'CLI',
      loginLabel: '登录',
      notInstalled: '未安装',
      unknown: '未知',
      loggedIn: '已登录',
      loggedOut: '未登录',
      versionUnavailable: '版本不可用',
      probeTimeout: '状态检查超时。',
      probeFailed: '状态检查失败:',
      pathLabel: 'CLI 路径(可选)',
      pathPlaceholder: '留空则自动查找 PATH、~/.local/bin 等常见位置',
      save: '保存',
      pathHint: '仅当自动查找失败时填写,例如 /opt/homebrew/bin/taptap-cli。只接受以 taptap-cli 命名的程序,填错会直接报错。',
      saved: '已保存。',
      cleared: '已清空,将使用自动查找。',
      saveFailed: '保存失败:'
    },
    ja: {
      intro: 'このプラグインは、このマシンにインストール済みの公式 taptap-cli を実行します。バイナリは同梱しません。先にターミナルでインストールと認証を済ませてください:',
      installCommands: 'npm install -g @taptap/cli               # インストール（約 37MB）\ntaptap-cli update --skills-layout suite  # AI Skills をインストールし、1 つの taptap-suite に統合\ntaptap-cli auth login                    # 認証',
      installNote1: 'プラグインは PATH とバージョンマネージャ（nvm / proto / volta など）のグローバルディレクトリを自動検索するため、通常は PATH を手動設定しなくてもそのまま使えます。',
      installNote2: 'AI Skills を 1 つの taptap-suite に統合すると、本プラグインのマニュアルとの重複が最小になります。個別の skill を使いたい場合は --skills-layout を separate にしてください。',
      check: '状態を確認',
      checking: 'ローカルの taptap-cli を確認しています…',
      cliLabel: 'CLI',
      loginLabel: 'ログイン',
      notInstalled: '未インストール',
      unknown: '不明',
      loggedIn: 'ログイン済み',
      loggedOut: '未ログイン',
      versionUnavailable: 'バージョン不明',
      probeTimeout: '状態確認がタイムアウトしました。',
      probeFailed: '状態確認に失敗しました:',
      pathLabel: 'CLI パス(任意)',
      pathPlaceholder: '空欄なら PATH や ~/.local/bin などから自動検出します',
      save: '保存',
      pathHint: '自動検出に失敗した場合のみ入力してください(例: /opt/homebrew/bin/taptap-cli)。taptap-cli という名前のプログラムのみ受け付け、誤ったパスはエラーになります。',
      saved: '保存しました。',
      cleared: 'クリアしました。自動検出を使用します。',
      saveFailed: '保存できませんでした:'
    },
    ko: {
      intro: '이 플러그인은 이 컴퓨터에 설치된 공식 taptap-cli 를 실행하며, 바이너리를 함께 배포하지 않습니다. 먼저 터미널에서 설치와 인증을 완료하세요:',
      installCommands: 'npm install -g @taptap/cli               # 설치（약 37MB）\ntaptap-cli update --skills-layout suite  # AI Skills 설치 후 하나의 taptap-suite 로 통합\ntaptap-cli auth login                    # 인증',
      installNote1: '플러그인은 PATH 와 버전 관리자(nvm / proto / volta 등)의 전역 디렉터리를 자동으로 검색하므로, 보통 설치 후 PATH 를 수동 설정하지 않아도 바로 사용할 수 있습니다.',
      installNote2: 'AI Skills 를 하나의 taptap-suite 로 통합하면 이 플러그인 매뉴얼과의 중복이 최소화됩니다. 개별 skill 을 사용하려면 --skills-layout 을 separate 로 바꾸세요.',
      check: '상태 확인',
      checking: '로컬 taptap-cli 를 확인하는 중…',
      cliLabel: 'CLI',
      loginLabel: '로그인',
      notInstalled: '설치되지 않음',
      unknown: '알 수 없음',
      loggedIn: '로그인됨',
      loggedOut: '로그인되지 않음',
      versionUnavailable: '버전 확인 불가',
      probeTimeout: '상태 확인 시간이 초과되었습니다.',
      probeFailed: '상태 확인 실패:',
      pathLabel: 'CLI 경로(선택)',
      pathPlaceholder: '비워 두면 PATH, ~/.local/bin 등에서 자동으로 찾습니다',
      save: '저장',
      pathHint: '자동 검색이 실패할 때만 입력하세요(예: /opt/homebrew/bin/taptap-cli). taptap-cli 라는 이름의 프로그램만 허용하며, 잘못된 경로는 오류로 알려줍니다.',
      saved: '저장했습니다.',
      cleared: '지웠습니다. 자동 검색을 사용합니다.',
      saveFailed: '저장하지 못했습니다: '
    }
  };

  var currentLocale = 'en';
  var requestSequence = 0;

  function normalizeLocale(locale) {
    return Object.prototype.hasOwnProperty.call(MESSAGES, locale) ? locale : 'en';
  }

  function t(key) {
    return (MESSAGES[currentLocale] && MESSAGES[currentLocale][key]) || MESSAGES.en[key] || key;
  }

  function applyStaticTranslations() {
    document.documentElement.lang = currentLocale;
    document.querySelectorAll('[data-i18n]').forEach(function (element) {
      element.textContent = t(element.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (element) {
      element.setAttribute('placeholder', t(element.getAttribute('data-i18n-placeholder')));
    });
  }

  function loadHostLocale() {
    return fetch('/app-context')
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (result) {
        currentLocale = normalizeLocale(result && result.context && result.context.locale);
      })
      .catch(function () { currentLocale = 'en'; });
  }

  var input = document.getElementById('cli_path');
  var button = document.getElementById('save');
  var status = document.getElementById('status');
  var check = document.getElementById('check');
  var cliValue = document.getElementById('cliValue');
  var loginValue = document.getElementById('loginValue');
  var probeStatus = document.getElementById('probeStatus');

  function setStatus(text) {
    status.textContent = text;
  }

  // One channel carries both the saved-path announcement and the status probe.
  var channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
  } catch (_) {
    // Without it the page cannot reach the brain; the probe reports the timeout.
  }

  function requestStatus() {
    return new Promise(function (resolve, reject) {
      if (!channel) {
        reject(new Error(t('probeFailed') + 'BroadcastChannel'));
        return;
      }
      requestSequence += 1;
      var reqId = 'status-' + Date.now() + '-' + requestSequence;
      var settled = false;
      var interval = null;
      var timer = null;

      function cleanup() {
        if (interval) clearInterval(interval);
        if (timer) clearTimeout(timer);
        channel.removeEventListener('message', onMessage);
      }

      function onMessage(event) {
        var response = event && event.data;
        if (!response || response.type !== 'settings-result' || response.reqId !== reqId) return;
        if (settled) return;
        settled = true;
        cleanup();
        if (response.ok === true) resolve(response.result || {});
        else reject(new Error(response.message || t('probeFailed')));
      }

      function post() {
        channel.postMessage({ type: 'settings-request', reqId: reqId, action: 'status', payload: {} });
      }

      function beginPosting() {
        if (settled) return;
        post();
        interval = setInterval(post, RESEND_INTERVAL_MS);
      }

      channel.addEventListener('message', onMessage);
      // The brain may still be waking, in which case the first message is lost;
      // resending until it answers keeps a wake race from looking like a timeout.
      fetch('/wake').then(beginPosting, beginPosting);
      timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(t('probeTimeout')));
      }, PROBE_TIMEOUT_MS);
    });
  }

  // "We could not tell" is not "not installed": a probe that never reached the
  // worker says nothing about whether the CLI exists, and reporting it as
  // missing would send the user off to reinstall something they already have.
  function renderUnknown() {
    cliValue.textContent = t('unknown');
    loginValue.textContent = t('unknown');
  }

  function renderStatus(data) {
    if (!data || data.installed !== true) {
      cliValue.textContent = t('notInstalled');
      loginValue.textContent = t('unknown');
      return;
    }
    cliValue.textContent = data.version || t('versionUnavailable');
    if (data.logged_in === true) loginValue.textContent = t('loggedIn');
    else if (data.logged_in === false) loginValue.textContent = t('loggedOut');
    else loginValue.textContent = t('unknown');
  }

  function checkStatus() {
    check.disabled = true;
    probeStatus.textContent = t('checking');
    return requestStatus()
      .then(function (data) {
        renderStatus(data);
        probeStatus.textContent = data && data.message ? data.message : '';
      })
      .catch(function (error) {
        renderUnknown();
        probeStatus.textContent = (error && error.message) || t('probeTimeout');
      })
      .then(function () { check.disabled = false; });
  }

  button.addEventListener('click', function () {
    var value = input.value.trim();
    var body = value ? { cli_path: value } : {};
    fetch('/kv', { method: 'PUT', body: JSON.stringify(body) })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        setStatus(value ? t('saved') : t('cleared'));
        try {
          if (channel) channel.postMessage({ type: 'settings-changed' });
        } catch (_) {
          // The brain re-reads /kv on its next wake; a missing channel is fine.
        }
        // The new path changes what "installed" resolves to, so re-probe.
        return checkStatus();
      })
      .catch(function (error) {
        setStatus(t('saveFailed') + ((error && error.message) || String(error)));
      });
  });

  check.addEventListener('click', function () { void checkStatus(); });

  Promise.all([
    loadHostLocale(),
    fetch('/kv')
      .then(function (response) { return response.json(); })
      .catch(function () { return {}; })
  ]).then(function (results) {
    var cfg = results[1] || {};
    input.value = typeof cfg.cli_path === 'string' ? cfg.cli_path : '';
    applyStaticTranslations();
    // Nothing is known until the first probe answers, and "unknown" is the
    // honest thing to show in the meantime.
    renderUnknown();
    setTimeout(function () { void checkStatus(); }, AUTO_PROBE_DELAY_MS);
  });
})();
