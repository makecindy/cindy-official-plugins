'use strict';

// Settings page for the TapTap CLI plugin.
//
// The only configurable value is an optional absolute path to taptap-cli, used
// when the worker cannot find it on PATH. Nothing here touches credentials:
// those live in the CLI's own credential store, never in the plugin.

(function () {
  var CHANNEL = 'taptap-cli';

  var MESSAGES = {
    en: {
      intro: 'This plugin runs the official taptap-cli you installed on this machine; it does not bundle a binary. Install and authorize it in a terminal first:',
      installCommands: 'npm install -g @taptap/cli               # install (package ~37 MB)\ntaptap-cli update --skills-layout suite  # install AI Skills, merged into one taptap-suite\ntaptap-cli auth login                    # authorize',
      installNote1: 'The plugin auto-searches PATH and version-manager global directories (nvm / proto / volta etc.), so it usually works right after install without configuring PATH.',
      installNote2: 'Merging AI Skills into one taptap-suite minimizes overlap with this plugin\'s manuals; use --skills-layout separate if you want those skills individually.',
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

  function setStatus(text) {
    status.textContent = text;
  }

  button.addEventListener('click', function () {
    var value = input.value.trim();
    var body = value ? { cli_path: value } : {};
    fetch('/kv', { method: 'PUT', body: JSON.stringify(body) })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        setStatus(value ? t('saved') : t('cleared'));
        try {
          new BroadcastChannel(CHANNEL).postMessage({ type: 'settings-changed' });
        } catch (_) {
          // The brain re-reads /kv on its next wake; a missing channel is fine.
        }
      })
      .catch(function (error) {
        setStatus(t('saveFailed') + ((error && error.message) || String(error)));
      });
  });

  Promise.all([
    loadHostLocale(),
    fetch('/kv')
      .then(function (response) { return response.json(); })
      .catch(function () { return {}; })
  ]).then(function (results) {
    var cfg = results[1] || {};
    input.value = typeof cfg.cli_path === 'string' ? cfg.cli_path : '';
    applyStaticTranslations();
  });
})();
