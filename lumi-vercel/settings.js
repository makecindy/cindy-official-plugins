(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const texts = {
    en: { connection: 'Connect Vercel', intro: 'Connect once to manage your Vercel projects from a conversation.', token: 'Vercel access token', tokenHelp: 'Lumi stores the token securely and sends it only to api.vercel.com. It is never sent to the AI.', getToken: 'Create a token in Vercel ↗', saveToken: 'Save token', test: 'Test connection', clear: 'Disconnect', defaults: 'Defaults', defaultsHelp: 'Optional shortcuts for reads. Changes still name their project explicitly.', team: 'Team ID', teamHelp: 'Ask Lumi to list your Vercel teams to find the exact ID.', project: 'Default project', saveDefaults: 'Save defaults', independent: 'Independent Lumi plugin. Not affiliated with or endorsed by Vercel.', saved: 'Token saved', missing: 'Not connected', savedHint: 'Token saved securely. Test the connection to verify access.', cleared: 'Token removed.', defaultsSaved: 'Defaults saved.', connected: 'Connected as ', testing: 'Checking connection…', tokenEmpty: 'Enter a Vercel token first.', clearConfirm: 'Disconnect this Vercel token from the plugin?', tokenPlaceholder: 'Paste a Vercel token', teamPlaceholder: 'Blank = personal account', projectPlaceholder: 'Project name or ID' },
    'zh-CN': { connection: '连接 Vercel', intro: '连接一次，就能在对话里管理 Vercel 项目。', token: 'Vercel 访问令牌', tokenHelp: '令牌由 Lumi 安全保存，只发送给 api.vercel.com，不会交给 AI。', getToken: '到 Vercel 创建令牌 ↗', saveToken: '保存令牌', test: '测试连接', clear: '断开连接', defaults: '默认范围', defaultsHelp: '可选，方便查询。执行修改时仍需明确指定项目。', team: '团队 ID', teamHelp: '可以让 Lumi 列出你的 Vercel 团队，找到准确的 ID。', project: '默认项目', saveDefaults: '保存默认范围', independent: '独立的 Lumi 插件，与 Vercel 无隶属或背书关系。', saved: '已保存令牌', missing: '尚未连接', savedHint: '令牌已安全保存。请测试连接，核对访问权限。', cleared: '令牌已移除。', defaultsSaved: '默认范围已保存。', connected: '已连接：', testing: '正在检查连接…', tokenEmpty: '请先填写 Vercel 令牌。', clearConfirm: '要从插件中移除这份 Vercel 令牌吗？', tokenPlaceholder: '粘贴 Vercel 令牌', teamPlaceholder: '留空使用个人账号', projectPlaceholder: '项目名称或 ID' }
  };
  Object.assign(texts, {
  "ja": {
    "connection": "Vercel に接続",
    "intro": "一度接続すると、会話から Vercel プロジェクトを管理できます。",
    "token": "Vercel アクセストークン",
    "tokenHelp": "トークンは Lumi が安全に保管し、api.vercel.com にのみ送信します。AI には渡しません。",
    "getToken": "Vercel でトークンを作成 ↗",
    "saveToken": "トークンを保存",
    "test": "接続を確認",
    "clear": "接続を解除",
    "defaults": "既定の範囲",
    "defaultsHelp": "読み取り用の任意設定です。変更時はプロジェクトを明示します。",
    "team": "チーム ID",
    "teamHelp": "Lumi に Vercel チームの一覧を頼み、正確な ID を確認してください。",
    "project": "既定のプロジェクト",
    "saveDefaults": "既定値を保存",
    "independent": "独立した Lumi プラグインです。Vercel との提携や推奨関係はありません。",
    "saved": "トークン保存済み",
    "missing": "未接続",
    "savedHint": "トークンを安全に保存しました。接続確認でアクセス権を検証してください。",
    "cleared": "トークンを削除しました。",
    "defaultsSaved": "既定値を保存しました。",
    "connected": "接続先: ",
    "testing": "接続を確認中…",
    "tokenEmpty": "Vercel トークンを入力してください。",
    "clearConfirm": "この Vercel トークンの接続を解除しますか？",
    "tokenPlaceholder": "Vercel トークンを貼り付け",
    "teamPlaceholder": "空欄は個人アカウント",
    "projectPlaceholder": "プロジェクト名または ID"
  },
  "ko": {
    "connection": "Vercel 연결",
    "intro": "한 번 연결하면 대화에서 Vercel 프로젝트를 관리할 수 있습니다.",
    "token": "Vercel 액세스 토큰",
    "tokenHelp": "Lumi가 토큰을 안전하게 보관하고 api.vercel.com에만 전송합니다. AI에는 전달하지 않습니다.",
    "getToken": "Vercel에서 토큰 만들기 ↗",
    "saveToken": "토큰 저장",
    "test": "연결 확인",
    "clear": "연결 해제",
    "defaults": "기본 범위",
    "defaultsHelp": "조회용 선택 설정입니다. 변경할 때는 프로젝트를 명시해야 합니다.",
    "team": "팀 ID",
    "teamHelp": "Lumi에 Vercel 팀 목록을 요청해 정확한 ID를 확인하세요.",
    "project": "기본 프로젝트",
    "saveDefaults": "기본값 저장",
    "independent": "독립 Lumi 플러그인입니다. Vercel과 제휴하거나 보증받지 않습니다.",
    "saved": "토큰 저장됨",
    "missing": "연결되지 않음",
    "savedHint": "토큰을 안전하게 저장했습니다. 연결 확인으로 접근 권한을 검증하세요.",
    "cleared": "토큰을 삭제했습니다.",
    "defaultsSaved": "기본값을 저장했습니다.",
    "connected": "연결된 계정: ",
    "testing": "연결 확인 중…",
    "tokenEmpty": "Vercel 토큰을 입력하세요.",
    "clearConfirm": "이 Vercel 토큰의 연결을 해제할까요?",
    "tokenPlaceholder": "Vercel 토큰 붙여 넣기",
    "teamPlaceholder": "비워 두면 개인 계정",
    "projectPlaceholder": "프로젝트 이름 또는 ID"
  }
});
  let language = 'en', checking = false;
  const t = key => (texts[language] || texts.en)[key] || texts.en[key];
  const channel = new BroadcastChannel('lumi-vercel-settings');
  const waiting = new Map();
  function feedback(selector, message, error = false) { const el = $(selector); el.textContent = message; el.dataset.state = error ? 'error' : 'ok'; }
  async function checkedFetch(path, init) { const r = await fetch(path, init); if (!r.ok) throw Error('Could not save plugin settings. Reopen the settings and try again.'); return r; }
  async function refreshCredentials() {
    const list = await (await checkedFetch('/secrets')).json(), item = list.find(v => v.key === 'vercel_token');
    $('#credential-state').textContent = item?.saved ? t('saved') + (item.tail ? ' · …' + item.tail : '') : t('missing');
    $('#test').disabled = !item?.saved;
    $('#clear-token').disabled = !item?.saved;
  }
  channel.onmessage = event => {
    const m = event.data;
    if (m?.type === 'host-context-changed') { applyLocale().then(refreshCredentials).catch(() => {}); return; }
    if (!['connection-result', 'pong'].includes(m?.type)) return;
    const w = waiting.get(m.id); if (!w) return;
    waiting.delete(m.id); clearTimeout(w.timer); if (w.ping) clearInterval(w.ping); w.resolve(m);
  };
  async function testConnection() {
    if (checking) return;
    checking = true; $('#test').disabled = true; feedback('#connection-result', t('testing'));
    try {
      await checkedFetch('/wake');
      const readyId = crypto.randomUUID();
      await new Promise((resolve, reject) => {
        const ping = setInterval(() => channel.postMessage({ type: 'ping', id: readyId }), 250);
        const timer = setTimeout(() => { clearInterval(ping); waiting.delete(readyId); reject(Error('Plugin did not start. Reopen its settings and try again.')); }, 10000);
        waiting.set(readyId, { resolve, timer, ping });
        channel.postMessage({ type: 'ping', id: readyId });
      });
      const id = crypto.randomUUID();
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(id); reject(Error('Connection check timed out. Reopen plugin settings and try again.')); }, 35000);
        waiting.set(id, { resolve, timer });
        channel.postMessage({ type: 'connection-check', id });
      });
      if (!result.ok) throw Error(result.message);
      const user = result.user || {}; feedback('#connection-result', t('connected') + (user.name || user.username || user.email || user.id || 'Vercel'));
    } catch (e) { feedback('#connection-result', e.message || 'Could not check Vercel. Check your token and network, then try again.', true); }
    finally { checking = false; await refreshCredentials().catch(() => {}); }
  }
  $('#token-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('#token'), button = $('#save-token');
    if (!input.value.trim()) { feedback('#connection-result', t('tokenEmpty'), true); return; }
    button.disabled = true;
    try {
      // The token goes directly into the Host vault. Never write it to KV, channels or logs.
      await checkedFetch('/secrets/vercel_token', { method: 'PUT', body: JSON.stringify({ value: input.value.trim() }) });
      input.value = ''; await refreshCredentials(); feedback('#connection-result', t('savedHint'));
    } catch (e) { feedback('#connection-result', e.message, true); }
    finally { button.disabled = false; }
  });
  $('#test').addEventListener('click', testConnection);
  $('#clear-token').addEventListener('click', async () => {
    try { await checkedFetch('/secrets/vercel_token', { method: 'DELETE' }); $('#token').value = ''; await refreshCredentials(); feedback('#connection-result', t('cleared')); }
    catch (e) { feedback('#connection-result', e.message, true); }
  });
  $('#defaults-form').addEventListener('submit', async event => {
    event.preventDefault();
    const defaultTeamId = $('#team').value.trim(), defaultProject = $('#project').value.trim();
    if (defaultTeamId.length > 128 || defaultProject.length > 128) { feedback('#defaults-result', 'Use a team ID and project name of at most 128 characters.', true); return; }
    try {
      await checkedFetch('/kv', { method: 'PUT', body: JSON.stringify({ defaultTeamId, defaultProject }) }); feedback('#defaults-result', t('defaultsSaved'));
    } catch (e) { feedback('#defaults-result', e.message, true); }
  });
  async function applyLocale() {
    const context = await (await checkedFetch('/app-context')).json();
    const locale = context.context?.uiLocale ?? context.context?.locale;
    language = texts[locale] ? locale : 'en'; document.documentElement.lang = language;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    $('#token').placeholder = t('tokenPlaceholder'); $('#team').placeholder = t('teamPlaceholder'); $('#project').placeholder = t('projectPlaceholder');
  }
  async function init() {
    await applyLocale();
    const cfg = await (await checkedFetch('/kv')).json(); $('#team').value = cfg.defaultTeamId || ''; $('#project').value = cfg.defaultProject || '';
    await refreshCredentials();
  }
  init().catch(() => feedback('#connection-result', 'Could not load plugin settings. Close and reopen them to try again.', true));
})();
