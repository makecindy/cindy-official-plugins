'use strict';
/* ============================================================================
 * X Manager 设置页
 *
 * 凭证纪律(硬红线):
 *   - API key / client secret 只在用户按下「保存」的那一瞬间路过本页面,立刻经
 *     /secrets、/oauth/<key>/client 交给主机保险库,随后清空输入框。
 *   - 绝不写进 /kv、绝不打日志(本文件没有任何 console 调用)、绝不进
 *     BroadcastChannel。回查只读 { key, saved, tail } / 账号状态,拿不到值。
 *   - 所有 fetch 路径都写绝对形态(/kv、/secrets、/oauth、/app-context)。
 * ==========================================================================*/

var LOCALE = 'en';
var guideTouched = false; // 用户是否手动开合过 X app 教程折叠区
var guideProgrammatic = false; // 代码改 open 时压掉这一次 toggle 事件

/* ── 文案(插件语言只跟随宿主语言;绝不读浏览器或操作系统语言)───────────── */

var DICT = {
  'tab.search': { zh: '搜索', en: 'Search' },
  'tab.posting': { zh: '发帖', en: 'Posting' },
  'tab.usage': { zh: '用量', en: 'Usage' },
  'badge.recommended': { zh: '推荐', en: 'Recommended' },
  'badge.fallback': { zh: '兜底', en: 'Fallback' },

  'state.loading': { zh: '读取中…', en: 'Loading…' },
  'state.connected': { zh: '已连接', en: 'Connected' },
  'state.expired': { zh: '授权已过期', en: 'Authorization expired' },
  'state.absent': { zh: '未连接', en: 'Not connected' },
  'state.saved': { zh: '已保存', en: 'Saved' },
  'state.unsaved': { zh: '未配置', en: 'Not configured' },
  'state.noclient': { zh: '未填应用 Client ID', en: 'Client ID missing' },
  'state.unavailable': { zh: '状态读取失败', en: 'Status unavailable' },

  'action.save': { zh: '保存', en: 'Save' },
  'action.modify': { zh: '修改', en: 'Change' },
  'action.cancel': { zh: '取消', en: 'Cancel' },
  'action.clear': { zh: '清除', en: 'Clear' },
  'action.copy': { zh: '复制', en: 'Copy' },
  'action.copied': { zh: '已复制', en: 'Copied' },
  'action.copyfail': { zh: '复制失败,请手动选中', en: 'Copy failed, select manually' },
  'action.refresh': { zh: '刷新', en: 'Refresh' },
  'action.disconnect': { zh: '断开', en: 'Disconnect' },
  'action.setdefault': { zh: '设为默认', en: 'Set default' },
  'action.connecting': { zh: '正在等待浏览器授权…', en: 'Waiting for browser authorization…' },
  'tag.default': { zh: '默认', en: 'Default' },

  'grok.title': { zh: 'Grok 订阅', en: 'Grok subscription' },
  'grok.hint': {
    zh: '用你的 SuperGrok / X Premium+ 订阅额度搜索,不产生 API 费用。',
    en: 'Searches on your SuperGrok / X Premium+ subscription quota, with no API charges.',
  },
  'grok.connect': { zh: '连接 Grok 账号', en: 'Connect Grok account' },
  'grok.foldSummary': { zh: '连接说明与已知限制', en: 'How it connects, and known limits' },
  'grok.consent': {
    zh: '授权页由 xAI 托管,标题会显示为「Grok Build」——这是生态共用 OAuth 客户端所致,不是钓鱼。',
    en: 'The consent page is hosted by xAI and titled "Grok Build" — that is the shared ecosystem OAuth client, not phishing.',
  },
  'grok.risk': {
    zh: '已知限制:xAI 按订阅档位对 OAuth 通道做 403 门禁,登录成功不等于可用;搜索工具是否走该通道也未实测。这两种情况插件都会自动改用 xAI API key,所以建议两条都配。',
    en: 'Known limits: xAI gates the OAuth channel by subscription tier with 403, so a successful login does not guarantee access, and whether the search tool is served there is unverified. In both cases the plugin switches to the xAI API key, so configuring both is recommended.',
  },

  'key.title': { zh: 'xAI API Key', en: 'xAI API key' },
  'key.hint': {
    zh: '订阅通道不可用时自动改用它,按量付费。保存后只看得到尾号。',
    en: 'Used automatically when the subscription channel is unavailable; pay as you go. Only the last digits stay visible.',
  },
  'key.placeholder': { zh: '粘贴 xAI API key', en: 'Paste your xAI API key' },
  'key.console': { zh: '前往 xAI 控制台创建 API key ↗', en: 'Create an API key in the xAI console ↗' },

  'xapi.title': { zh: 'X 官方 API', en: 'X API' },
  'xapi.hint': {
    zh: '只有发帖需要,用你自己的 X developer app;不配也能搜索。发帖按条计费,由你的 X 账户承担。',
    en: 'Only needed for posting, using your own X developer app; search works without it. Posting is billed per post to your own X account.',
  },
  'xapi.guideSummary': { zh: '怎么拿到 Client ID(约 5 分钟)', en: 'How to get the Client ID (about 5 minutes)' },
  'xapi.step1': {
    zh: '打开 console.x.com(X 的新开发者后台,旧的 developer.x.com 后台已于 2026 年 2 月停用),用你要发帖的那个 X 账号登录。首次进入会让你先建一个 Project,按提示填完即可。',
    en: 'Open console.x.com — X\'s new developer console, which replaced the old developer.x.com portal in February 2026 — and sign in with the X account you want to post from. On first visit it asks you to create a Project; fill in the prompts.',
  },
  'xapi.step2': {
    zh: '左侧 Apps → Create App,填个名字,Environment 必须选 Production(Development / Staging 环境的 app 发帖会被 X 拒绝)。建完会弹出 Consumer Key / Secret Key / Bearer Token —— 那是 OAuth 1.0a 的凭证,本插件用不到,可以直接关掉。',
    en: 'In the left menu open Apps → Create App, give it a name, and set Environment to Production (apps in Development / Staging are rejected when posting). On creation X shows a Consumer Key / Secret Key / Bearer Token — those are OAuth 1.0a credentials that this plugin does not use, so you can close that dialog.',
  },
  'xapi.step3': {
    zh: '打开刚建的 app,找到 User authentication settings,点 Set up。这一步才会生成 Client ID:App permissions 选 Read and write;Type of App 选 Native App(桌面应用;选它就不会有 Client Secret);Website URL 随便填一个能打开的网址;Callback URI / Redirect URL 填下面这串(一字不差,不要用 localhost)。填完点 Save。',
    en: 'Open the app you just created, find User authentication settings and click Set up — this is the step that generates the Client ID. Set App permissions to Read and write, Type of App to Native App (a desktop app; this is why there is no Client Secret), Website URL to any reachable URL, and Callback URI / Redirect URL to the string below, character for character (do not use localhost). Then click Save.',
  },
  'xapi.step4': {
    zh: '保存后页面不会跳转、也没有任何提示。自己点回这个 app 的 Keys and tokens 页,滚到最底部的 OAuth 2.0 Keys 区,复制 Client ID 填到下面。Native App 只有 Client ID、没有 Client Secret,这是正常的。',
    en: 'After saving, the page does not navigate anywhere and shows no confirmation. Go back to the app\'s Keys and tokens page yourself, scroll to the OAuth 2.0 Keys section at the very bottom, and copy the Client ID into the field below. A Native App has only a Client ID and no Client Secret — that is expected.',
  },
  'xapi.step5': {
    zh: '左侧 Billing 充值。2026 年起 X API 没有免费额度:授权登录不花钱,但每发一条帖约 $0.015(带链接的帖约 $0.20),余额为 0 时发帖直接失败。',
    en: 'Top up under Billing in the left menu. Since 2026 the X API has no free tier: signing in is free, but each post costs about $0.015 (about $0.20 with a link), and posting fails outright at zero balance.',
  },
  'xapi.troubleTitle': { zh: '卡住了?', en: 'Stuck?' },
  'xapi.trouble': {
    zh: '找不到 Client ID —— 基本都是第 3 步没保存成功,回去确认 User authentication settings 已配好。授权页显示「Page doesn\'t exist」—— 先在浏览器里登录 x.com 再重试。发帖报 403 —— 检查 app 是否在 Production 环境、是否挂在 Project 下、权限是否为 Read and write(改过权限要重新授权一次)。后台页面 404 或点 Save 没反应 —— 这是 X 新后台的已知间歇故障,换个时间重试;另外只有 app 的创建者账号能改这些设置。',
    en: 'No Client ID anywhere — almost always step 3 did not save; check User authentication settings again. The authorization page shows "Page doesn\'t exist" — sign in to x.com in your browser first. Posting returns 403 — check that the app is in Production, attached to a Project, and set to Read and write (changing permissions requires re-authorizing). Console pages 404 or Save does nothing — a known intermittent fault in X\'s new console; retry later, and note only the account that created the app can change these settings.',
  },
  'xapi.clientId': { zh: 'Client ID', en: 'Client ID' },
  'xapi.clientSecret': { zh: 'Client Secret(Native App 没有,留空)', en: 'Client Secret (none for a Native App)' },
  'xapi.clientSaved': { zh: '应用身份已保存(Client ID 在主机保险库里,取不回来)', en: 'App identity saved (the Client ID lives in the host vault and cannot be read back)' },
  'xapi.connect': { zh: '连接 X 账号', en: 'Connect X account' },
  'xapi.connectMore': { zh: '连接另一个 X 账号', en: 'Connect another X account' },
  'xapi.needClientFirst': { zh: '先保存上面的 Client ID,才能连接账号。', en: 'Save the Client ID above before connecting an account.' },
  'xapi.portal': { zh: '打开 X 开发者后台 console.x.com ↗', en: 'Open the X developer console at console.x.com ↗' },

  'usage.title': { zh: '用量', en: 'Usage' },
  'usage.note': {
    zh: '「API」= xAI / X 接口回报的真实数字;「本地」= 本插件自己数的次数。X 的 credits 余额和 Grok 订阅剩余额度都没有可查接口,只能去各自控制台看。',
    en: '"API" values are real numbers reported by the xAI / X endpoints; "local" values are counts this plugin keeps itself. Neither the X credits balance nor the remaining Grok subscription quota is queryable — check the respective consoles.',
  },
  'usage.billed': { zh: 'xAI 实际扣费', en: 'xAI billed' },
  'usage.billedGap': {
    zh: '有 {n} 次调用未回报金额,未计入',
    en: '{n} call(s) reported no amount and are excluded',
  },
  'usage.postQuota': { zh: 'X 发帖余额(24 小时)', en: 'X posts left (24h)' },
  'usage.noData': { zh: '发过帖后才有', en: 'available after the first post' },
  'src.api': { zh: 'API', en: 'API' },
  'src.header': { zh: 'API', en: 'API' },
  'src.local': { zh: '本地', en: 'local' },
  'usage.month': { zh: '统计月份', en: 'Month' },
  'usage.searchCalls': { zh: '搜索次数', en: 'Searches' },
  'usage.postCalls': { zh: '发帖次数', en: 'Posts' },
  'usage.tokens': { zh: 'Token(入 / 出)', en: 'Tokens (in / out)' },
  'usage.byRoute': { zh: '通道分布', en: 'By channel' },
  'usage.last': { zh: '最近一次', en: 'Last call' },
  'usage.empty': { zh: '本月还没有经本插件发出的调用。', en: 'No calls made through this plugin this month.' },

  'msg.saved': { zh: '已交给主机保险库保管。', en: 'Handed to the host vault.' },
  'msg.cleared': { zh: '已清除。', en: 'Cleared.' },
  'msg.needValue': { zh: '请先填入内容。', en: 'Enter a value first.' },
  'msg.needClientId': { zh: '请先填 Client ID。', en: 'Enter the Client ID first.' },
  'msg.writeFailed': { zh: '保存失败,请稍后重试。', en: 'Saving failed, please retry.' },
  'msg.loadFailed': { zh: '读取状态失败,稍后重试。', en: 'Could not read the state; retry later.' },
  'msg.connected': { zh: '已连接。', en: 'Connected.' },
  'msg.disconnected': { zh: '已断开。', en: 'Disconnected.' },
  'msg.defaultSet': { zh: '已设为默认账号。', en: 'Set as the default account.' },

  'err.NO_CLIENT_CONFIG': {
    zh: '还没有可用的应用身份:请先填好 Client ID 并保存。',
    en: 'No app identity yet: enter and save the Client ID first.',
  },
  'err.ACCOUNT_LIMIT': { zh: '账号数量已达上限,请先断开一个再连。', en: 'Account limit reached; disconnect one first.' },
  'err.VAULT_WRITE_FAILED': { zh: '凭证写入失败,请重试。', en: 'Writing the credential failed; please retry.' },
  'err.INVALID_CONFIG': { zh: '应用配置不合法,请检查 Client ID / Secret 是否填错。', en: 'Invalid app configuration; check the Client ID / Secret.' },
  'err.LISTEN_FAILED': {
    zh: '本机回调端口被占用,授权无法完成。关掉占用端口的程序后重试(X API 的回调端口固定为 57126,不能改)。',
    en: 'The local callback port is in use, so authorization cannot complete. Close whatever is holding it and retry (the X API callback port is fixed at 57126 and cannot change).',
  },
  'err.TIMEOUT': { zh: '等待授权超时,请重新点击连接。', en: 'Timed out waiting for authorization; click connect again.' },
  'err.CANCELLED': { zh: '授权已取消。', en: 'Authorization cancelled.' },
  'err.CALLBACK_INVALID': { zh: '回调数据不合法,请重新授权。', en: 'The callback payload was invalid; authorize again.' },
  'err.EXCHANGE_FAILED': {
    zh: '换取令牌失败:多数是回调地址与后台登记的不一致,或应用类型/权限不对。',
    en: 'Token exchange failed: usually the callback URI does not match the registered one, or the app type / permissions are wrong.',
  },
  'err.SERVICE_UNAVAILABLE': { zh: '授权服务暂时不可用,稍后再试。', en: 'The authorization service is temporarily unavailable; try later.' },
  'err.NETWORK': { zh: '连不上授权服务,请检查网络后重试。', en: 'Cannot reach the authorization service; check the network and retry.' },
  'err.unknown': { zh: '授权失败。', en: 'Authorization failed.' },
};

function t(key) {
  var entry = DICT[key];
  if (!entry) return key;
  return LOCALE === 'zh-CN' ? entry.zh : entry.en;
}

/* ── DOM 小工具 ─────────────────────────────────────────────────────────── */

function $(sel) {
  return document.querySelector(sel);
}

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function say(id, key, isError) {
  var node = $(id);
  if (!node) return;
  node.textContent = typeof key === 'string' && DICT[key] ? t(key) : String(key || '');
  node.className = 'feedback' + (isError ? ' err' : ' ok');
}

function setPill(id, key, tone, suffix) {
  var node = $(id);
  if (!node) return;
  node.textContent = t(key) + (suffix ? ' ' + suffix : '');
  node.className = 'pill' + (tone ? ' ' + tone : '');
}

function applyI18n() {
  var labelled = document.querySelectorAll('[data-i18n]');
  for (var i = 0; i < labelled.length; i += 1) {
    var node = labelled[i];
    var key = node.getAttribute('data-i18n');
    if (DICT[key]) node.textContent = t(key);
  }
  var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
  for (var j = 0; j < placeholders.length; j += 1) {
    var input = placeholders[j];
    var pkey = input.getAttribute('data-i18n-placeholder');
    if (DICT[pkey]) input.setAttribute('placeholder', t(pkey));
  }
}

/* ── 主机端点 ──────────────────────────────────────────────────────────── */

async function getJson(path) {
  try {
    var res = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function sendJson(path, method, payload) {
  try {
    var init = { method: method };
    if (payload !== undefined) init.body = JSON.stringify(payload);
    var res = await fetch(path, init);
    if (!res) return { ok: false };
    if (res.status === 204) return { ok: true };
    var text = await res.text();
    if (!text) return { ok: res.ok };
    try {
      var json = JSON.parse(text);
      if (json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'ok')) return json;
      return { ok: res.ok, data: json };
    } catch (_) {
      return { ok: res.ok };
    }
  } catch (_) {
    return { ok: false };
  }
}

function findEntry(list, key) {
  if (!Array.isArray(list)) return null;
  for (var i = 0; i < list.length; i += 1) if (list[i] && list[i].key === key) return list[i];
  return null;
}

/* ── 账号列表渲染 ──────────────────────────────────────────────────────── */

function renderAccounts(containerId, secretKey, entry, feedbackId) {
  var box = $(containerId);
  if (!box) return;
  box.textContent = '';
  var accounts = entry && Array.isArray(entry.accounts) ? entry.accounts : [];
  for (var i = 0; i < accounts.length; i += 1) {
    (function (account) {
      var row = el('div', 'account');
      if (account.avatarDataUrl) {
        var img = el('img', 'avatar');
        img.src = account.avatarDataUrl;
        img.alt = '';
        row.appendChild(img);
      } else {
        var label = String(account.label || '?');
        row.appendChild(el('span', 'avatar-fallback', label.replace(/^@/, '').slice(0, 1) || '?'));
      }
      row.appendChild(el('span', 'account-label', account.label || account.id));
      row.appendChild(el('span', 'tag', account.status === 'connected' ? t('state.connected') : t('state.expired')));
      if (account.isDefault) row.appendChild(el('span', 'tag', t('tag.default')));

      /* 只有已连接的账号能设为默认:请求不带 authAccount 时用的就是默认账号,
       * 把过期账号设成默认会让发帖直接失败、搜索莫名降级到计费路由。 */
      if (accounts.length > 1 && !account.isDefault && account.status === 'connected') {
        var mk = el('button', 'btn tiny', t('action.setdefault'));
        mk.addEventListener('click', async function () {
          mk.disabled = true;
          var r = await sendJson('/oauth/' + secretKey + '/default', 'POST', { accountId: account.id });
          say(feedbackId, r.ok ? 'msg.defaultSet' : 'msg.writeFailed', !r.ok);
          await refreshCredentials();
        });
        row.appendChild(mk);
      }

      var cut = el('button', 'btn tiny', t('action.disconnect'));
      cut.addEventListener('click', async function () {
        cut.disabled = true;
        var r = await sendJson('/oauth/' + secretKey + '/accounts/' + encodeURIComponent(account.id), 'DELETE');
        say(feedbackId, r.ok ? 'msg.disconnected' : 'msg.writeFailed', !r.ok);
        await refreshCredentials();
      });
      row.appendChild(cut);

      box.appendChild(row);
    })(accounts[i] || {});
  }
}

/* 顶部徽标按**默认账号**判定:请求不带 authAccount,主机用的就是默认账号。
 * 若按"任一账号已连接"判定,默认账号过期时徽标会显示已连接,与实际能力矛盾
 * (与 main.js 的 oauthStatusOf 同一口径)。 */
function oauthTone(entry) {
  var accounts = entry && Array.isArray(entry.accounts) ? entry.accounts : [];
  if (!accounts.length) return { key: 'state.absent', tone: 'off' };
  var target = null;
  for (var i = 0; i < accounts.length; i += 1) {
    if (accounts[i] && accounts[i].isDefault) {
      target = accounts[i];
      break;
    }
  }
  if (!target) target = accounts[0]; // 主机没标默认时按首条,取确定值而非乐观值
  return target && target.status === 'connected'
    ? { key: 'state.connected', tone: 'on' }
    : { key: 'state.expired', tone: 'warn' };
}

/* ── 应用身份(X API client)两态渲染 ──────────────────────────────────
 * 未配置 → 只给输入框,连接按钮禁用(初始 HTML 就带 disabled,不等状态回来);
 * 已配置 → 收起输入框,显示「应用身份已保存 + 修改」,连接按钮才可点。
 * 点「修改」进入编辑态(带取消),保存或取消后回到已保存态。
 * -------------------------------------------------------------------------*/

var xapiEditing = false;

function renderClientState(hasClient, hasAccounts) {
  var view = $('#xapi-client-view');
  var form = $('#xapi-client-form');
  var cancel = $('#xapi-client-cancel');
  var connect = $('#xapi-connect');
  if (!view || !form) return;
  var showForm = !hasClient || xapiEditing;
  form.classList.toggle('is-hidden', !showForm);
  view.classList.toggle('is-hidden', showForm || !hasClient);
  if (cancel) cancel.classList.toggle('is-hidden', !hasClient);
  if (connect) {
    connect.disabled = !hasClient;
    connect.textContent = t(hasAccounts ? 'xapi.connectMore' : 'xapi.connect');
    connect.title = hasClient ? '' : t('xapi.needClientFirst');
  }
}

/* ── 状态刷新 ─────────────────────────────────────────────────────────── */

async function refreshCredentials() {
  var oauthList = await getJson('/oauth');
  var secretList = await getJson('/secrets');

  if (oauthList === null) {
    setPill('#grok-pill', 'state.unavailable', 'off');
    setPill('#xapi-pill', 'state.unavailable', 'off');
    say('#grok-feedback', 'msg.loadFailed', true);
    renderClientState(false, false); // 状态读不到时保持"未配置"呈现,连接按钮不放行
  } else {
    var grokEntry = findEntry(oauthList, 'grok_oauth');
    var grokState = oauthTone(grokEntry);
    setPill('#grok-pill', grokState.key, grokState.tone);
    renderAccounts('#grok-accounts', 'grok_oauth', grokEntry, '#grok-feedback');

    var xapiEntry = findEntry(oauthList, 'x_api_oauth');
    var hasClient = !!(xapiEntry && xapiEntry.clientConfigured);
    var xapiState = oauthTone(xapiEntry);
    if (!hasClient) xapiState = { key: 'state.noclient', tone: 'off' };
    setPill('#xapi-pill', xapiState.key, xapiState.tone);
    renderAccounts('#xapi-accounts', 'x_api_oauth', xapiEntry, '#xapi-feedback');
    renderClientState(hasClient, (xapiEntry && xapiEntry.accounts ? xapiEntry.accounts.length : 0) > 0);
    // 没配应用身份时把教程摊开,配好了收起;用户手动动过就不再代管
    var guide = $('#xapi-guide');
    if (guide && !guideTouched && guide.open !== !hasClient) {
      guideProgrammatic = true;
      guide.open = !hasClient;
    }
  }

  if (secretList === null) {
    setPill('#key-pill', 'state.unavailable', 'off');
  } else {
    var keyEntry = findEntry(secretList, 'xai_api_key');
    if (keyEntry && keyEntry.saved) {
      setPill('#key-pill', 'state.saved', 'on', keyEntry.tail ? '····' + keyEntry.tail : '');
    } else {
      setPill('#key-pill', 'state.unsaved', 'off');
    }
  }
}

async function refreshUsage() {
  var box = $('#usage-stats');
  if (!box) return;
  box.textContent = '';
  var kv = await getJson('/kv');
  var usage = kv && typeof kv.usage === 'object' ? kv.usage : null;
  if (!usage || !usage.month) {
    box.appendChild(el('dt', null, ''));
    box.appendChild(el('dd', null, t('usage.empty')));
    return;
  }
  var routes = usage.calls_by_route || {};
  var billed = typeof usage.billed_usd === 'number' ? usage.billed_usd : 0;
  var unknown = usage.billed_unknown_calls || 0;
  var quota = usage.x_post_quota;

  /* 每一行都带一枚来源徽标,把"API 真实数字"和"本地计数"分清楚 */
  var rows = [
    { label: t('usage.month'), value: String(usage.month), tag: null },
    {
      label: t('usage.billed'),
      value: '$' + (Math.round(billed * 1000000) / 1000000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') ,
      tag: 'src.api',
      sub: unknown ? t('usage.billedGap').replace('{n}', String(unknown)) : '',
    },
    {
      label: t('usage.postQuota'),
      value: quota
        ? (quota.remaining === null ? '?' : String(quota.remaining)) + ' / ' + (quota.limit === null ? '?' : String(quota.limit))
        : t('usage.noData'),
      tag: quota ? 'src.header' : null,
      sub: quota && quota.at ? String(quota.at).slice(0, 16).replace('T', ' ') : '',
    },
    { label: t('usage.searchCalls'), value: String(usage.x_search_calls || 0), tag: 'src.local' },
    { label: t('usage.postCalls'), value: String(usage.x_post_calls || 0), tag: 'src.local' },
    { label: t('usage.tokens'), value: (usage.tokens_in || 0) + ' / ' + (usage.tokens_out || 0), tag: 'src.api' },
    {
      label: t('usage.byRoute'),
      value: 'Grok ' + (routes.oauth || 0) + ' · API key ' + (routes.api_key || 0),
      tag: 'src.local',
    },
    {
      label: t('usage.last'),
      value: (usage.last_route || '—') + (usage.last_at ? ' · ' + String(usage.last_at).slice(0, 16).replace('T', ' ') : ''),
      tag: null,
    },
  ];
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    box.appendChild(el('dt', null, row.label));
    var dd = el('dd', null, null);
    dd.appendChild(el('span', 'stat-value', row.value));
    if (row.tag) dd.appendChild(el('span', 'tag', t(row.tag)));
    if (row.sub) dd.appendChild(el('span', 'stat-sub', row.sub));
    box.appendChild(dd);
  }
}

/* ── 连接流程 ─────────────────────────────────────────────────────────── */

async function connect(secretKey, buttonId, feedbackId, idleLabelKey) {
  var btn = $(buttonId);
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = t('action.connecting');
  say(feedbackId, '', false);
  var result = await sendJson('/oauth/' + secretKey + '/connect', 'POST');
  btn.textContent = t(idleLabelKey);
  btn.disabled = false;
  if (result && result.ok) {
    say(feedbackId, 'msg.connected', false);
  } else {
    var code = (result && result.error) || 'unknown';
    var text = DICT['err.' + code] ? t('err.' + code) : t('err.unknown') + ' (' + code + ')';
    if (result && result.detail) text += ' ' + String(result.detail).slice(0, 200);
    say(feedbackId, text, true);
  }
  await refreshCredentials();
}

/* ── 事件绑定 ─────────────────────────────────────────────────────────── */

/* ── 标签切换(纯 display 切换,高度由宿主自动跟随)────────────────────── */

var TABS = ['search', 'posting', 'usage'];

function showTab(name) {
  for (var i = 0; i < TABS.length; i += 1) {
    var isTarget = TABS[i] === name;
    var panel = $('#panel-' + TABS[i]);
    var tab = $('#tab-' + TABS[i]);
    if (panel) panel.className = 'tabpanel' + (isTarget ? '' : ' is-hidden');
    if (tab) tab.className = 'tab' + (isTarget ? ' is-active' : '');
  }
  if (name === 'usage') refreshUsage();
}

function wire() {
  for (var i = 0; i < TABS.length; i += 1) {
    (function (name) {
      var tab = $('#tab-' + name);
      if (tab) {
        tab.addEventListener('click', function () {
          showTab(name);
        });
      }
    })(TABS[i]);
  }

  var guide = $('#xapi-guide');
  if (guide) {
    guide.addEventListener('toggle', function () {
      if (guideProgrammatic) {
        guideProgrammatic = false;
        return;
      }
      guideTouched = true;
    });
  }

  $('#grok-connect').addEventListener('click', function () {
    connect('grok_oauth', '#grok-connect', '#grok-feedback', 'grok.connect');
  });

  $('#key-save').addEventListener('click', async function () {
    var input = $('#key-input');
    var value = input.value.trim();
    if (!value) {
      say('#key-feedback', 'msg.needValue', true);
      return;
    }
    var res = await sendJson('/secrets/xai_api_key', 'PUT', { value: value });
    input.value = ''; // 收单即交,页面不留驻明文
    say('#key-feedback', res.ok ? 'msg.saved' : 'msg.writeFailed', !res.ok);
    await refreshCredentials();
  });

  $('#key-clear').addEventListener('click', async function () {
    var res = await sendJson('/secrets/xai_api_key', 'DELETE');
    $('#key-input').value = '';
    say('#key-feedback', res.ok ? 'msg.cleared' : 'msg.writeFailed', !res.ok);
    await refreshCredentials();
  });

  $('#xapi-copy').addEventListener('click', async function () {
    var field = $('#xapi-callback');
    field.select();
    var done = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(field.value);
        done = true;
      }
    } catch (_) {
      done = false;
    }
    say('#xapi-feedback', done ? 'action.copied' : 'action.copyfail', !done);
  });

  $('#xapi-client-save').addEventListener('click', async function () {
    var idField = $('#xapi-client-id');
    var secretField = $('#xapi-client-secret');
    var clientId = idField.value.trim();
    var clientSecret = secretField.value.trim();
    if (!clientId) {
      say('#xapi-feedback', 'msg.needClientId', true);
      return;
    }
    var payload = { clientId: clientId };
    if (clientSecret) payload.clientSecret = clientSecret;
    var res = await sendJson('/oauth/x_api_oauth/client', 'PUT', payload);
    idField.value = '';
    secretField.value = ''; // 收单即交
    if (res.ok) xapiEditing = false; // 存成功即收起输入框,回到「已保存」态
    say('#xapi-feedback', res.ok ? 'msg.saved' : 'msg.writeFailed', !res.ok);
    await refreshCredentials();
  });

  $('#xapi-client-edit').addEventListener('click', async function () {
    xapiEditing = true;
    say('#xapi-feedback', '', false);
    await refreshCredentials();
  });

  $('#xapi-client-cancel').addEventListener('click', async function () {
    xapiEditing = false;
    $('#xapi-client-id').value = '';
    $('#xapi-client-secret').value = '';
    say('#xapi-feedback', '', false);
    await refreshCredentials();
  });

  $('#xapi-connect').addEventListener('click', function () {
    connect('x_api_oauth', '#xapi-connect', '#xapi-feedback', 'xapi.connect');
  });

  $('#usage-refresh').addEventListener('click', function () {
    refreshUsage();
  });
}

/* ── 启动 ─────────────────────────────────────────────────────────────── */

(async function boot() {
  var ctx = await getJson('/app-context');
  if (ctx && ctx.context && typeof ctx.context.locale === 'string') LOCALE = ctx.context.locale;
  applyI18n();
  wire();
  await refreshCredentials();
  await refreshUsage();
})();
