/*
 * Antigravity - settings page.
 * Shows the detection result and asks the logic page (main.js) to check again when
 * the page opens, becomes visible again, or the user clicks "Check again".
 * Detection and publishing live in main.js; this page only displays the result.
 * Accounts are added and managed in Cindy's Model Providers; this page only points there, with a
 * button that opens that page where Cindy offers it (POST /harnesses/open-settings).
 */
(function () {
  'use strict';

  var CHANNEL_NAME = 'cindy-antigravity-acp';
  var RESEND_INTERVAL_MS = 500;
  var MAX_SENDS = 20;
  var RESULT_TIMEOUT_MS = 45000;

  var STRINGS = {
    'zh-CN': {
      checking: '检测中…',
      ready: '可以使用',
      notInstalled: '未安装',
      notRunnable: '无法运行',
      customPathUnavailable: '路径不可用',
      notSignedIn: '未登录',
      checkFailed: '检测失败',
      version: '版本',
      path: '位置',
      unsupported: '当前版本的 Cindy 还不能使用插件提供的执行引擎，请更新 Cindy。',
      notEnabled: 'Cindy 还没有启用这个执行引擎。请在插件详情中确认插件权限后再检测。',
      publishFailed: function (status) {
        return '检测结果没能同步给 Cindy' + (status ? '（HTTP ' + status + '）' : '') + '，请稍后重新检测。';
      },
      backgroundOff: '插件后台没有运行，请确认插件已启用后再检测。',
      timeout: '检测没有完成，请重新检测。',
      detectFailed: function (text) { return '无法完成检测' + (text ? '：' + text : '。'); },
      foot: '模型、思考深度与工作模式来自 Antigravity。订阅额度用完时不会使用付费的 Google AI 积分。',
      accountsTitle: '账号',
      accountsGuide: '账号在 Cindy 的「设置 → 模型供应商 → Antigravity」里添加和管理：可以登录多个 Google 账号，查看各自的用量，并设置任务怎样在账号之间分配。',
      accountsGuideSignedOut: '还没有已登录的账号。请到 Cindy 的「设置 → 模型供应商 → Antigravity」添加账号。',
      accountsOpen: '在模型供应商里管理',
      accountsOpenFailed: '没能直接打开，请按上面的路径在 Cindy 的设置里找到它。',
      customPath: '自定义路径',
      customPathPlaceholder: '留空自动检测 agy 可执行文件',
      customPathSave: '保存',
      customPathSaving: '保存中…',
      customPathReset: '恢复自动',
      customPathSaved: '已保存自定义路径。',
      customPathCleared: '已恢复自动检测。',
      customPathUnavailableNote: '当前自定义路径不可用，请修改路径或点「恢复自动」。',
      customPathErrors: {
        busy: '请等 CLI 安装或更新完成后再修改路径。',
        'not-absolute': '请填写有效的绝对路径。',
        'not-found': '找不到这个文件，请检查路径。',
        'not-executable': '这个文件不可执行，请检查权限。',
        'not-runnable': '找到了这个文件，但无法运行 agy --version。',
        'unsafe-path': '路径包含 Windows 批处理无法安全执行的字符。',
        'write-failed': '无法保存路径配置，请检查目录权限。',
        failed: '保存路径失败，请稍后重试。',
      },
      httpProxy: 'HTTP 代理',
      httpProxyPlaceholder: '留空则不为 agy 设置代理',
      httpProxyReset: '清除',
      httpProxySaved: '已保存，新开的 Antigravity 任务会通过这个代理连接。',
      httpProxyCleared: '已清除代理。',
      httpProxyErrors: {
        'invalid-proxy': '请填写 http:// 或 https:// 开头的地址，例如 http://127.0.0.1:7890，不支持账号密码。',
        'config-invalid': '配置文件无法读取，请重新保存自定义路径或点「恢复自动」。',
        'write-failed': '无法保存代理配置，请检查目录权限。',
        failed: '保存代理失败，请稍后重试。',
      },
    },
    en: {
      checking: 'Checking…',
      ready: 'Ready',
      notInstalled: 'Not installed',
      notRunnable: 'Can’t run',
      customPathUnavailable: 'Path unavailable',
      notSignedIn: 'Not signed in',
      checkFailed: 'Check failed',
      version: 'Version',
      path: 'Location',
      unsupported: 'This version of Cindy can’t use engines provided by plugins yet. Update Cindy to use Antigravity.',
      notEnabled: 'Cindy hasn’t enabled this engine yet. Confirm the plugin’s permissions in its details, then check again.',
      publishFailed: function (status) {
        return 'The result couldn’t be passed to Cindy' + (status ? ' (HTTP ' + status + ')' : '') + '. Check again later.';
      },
      backgroundOff: 'The plugin’s background page isn’t running. Make sure the plugin is enabled, then check again.',
      timeout: 'The check didn’t finish. Check again.',
      detectFailed: function (text) { return 'Couldn’t check' + (text ? ': ' + text : '.'); },
      foot: 'Models, reasoning levels and working modes come from Antigravity. Paid Google AI credits are never used when the subscription quota runs out.',
      accountsTitle: 'Accounts',
      accountsGuide: 'Add and manage accounts in Cindy under Settings → Model Providers → Antigravity: sign in to several Google accounts, see each one’s usage, and choose how tasks are shared between them.',
      accountsGuideSignedOut: 'No account is signed in yet. Add one in Cindy under Settings → Model Providers → Antigravity.',
      accountsOpen: 'Manage in Model Providers',
      accountsOpenFailed: 'Couldn’t open it from here. Follow the path above in Cindy’s settings.',
      customPath: 'Custom path',
      customPathPlaceholder: 'Leave blank to auto-detect agy',
      customPathSave: 'Save',
      customPathSaving: 'Saving…',
      customPathReset: 'Auto-detect',
      customPathSaved: 'Custom path saved.',
      customPathCleared: 'Switched back to auto-detect.',
      customPathUnavailableNote: 'The configured custom path is unavailable. Update it or switch back to auto-detect.',
      customPathErrors: {
        busy: 'Wait for the CLI install or update to finish before changing the path.',
        'not-absolute': 'Enter a valid absolute path to the agy executable.',
        'not-found': 'File not found. Check the path and try again.',
        'not-executable': 'This file is not executable. Check its permissions.',
        'not-runnable': 'This file was found, but agy --version could not run.',
        'unsafe-path': 'This path contains characters cmd.exe cannot run safely.',
        'write-failed': 'Could not save the path configuration.',
        failed: 'Could not save the custom path. Try again.',
      },
      httpProxy: 'HTTP proxy',
      httpProxyPlaceholder: 'Leave blank to set no proxy for agy',
      httpProxyReset: 'Clear',
      httpProxySaved: 'Saved. New Antigravity tasks connect through this proxy.',
      httpProxyCleared: 'Proxy cleared.',
      httpProxyErrors: {
        'invalid-proxy': 'Enter an address that starts with http:// or https://, such as http://127.0.0.1:7890. Credentials are not supported.',
        'config-invalid': 'The config file could not be read. Save the custom path again or switch back to auto-detect.',
        'write-failed': 'Could not save the proxy configuration.',
        failed: 'Could not save the proxy. Try again.',
      },
    },
  };

  var locale = 'en';
  var t = STRINGS.en;
  var channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
  var renderMaintenance = window.createCliMaintenance(channel, requestDetect, 'recheck');
  var snapshot = null;
  var error = null;
  var pending = null;
  var customPathPending = null;
  var customPathDirty = false;
  var customPathNote = null;
  var httpProxyPending = null;
  var httpProxyDirty = false;
  var httpProxyNote = null;
  var cliBusy = false;
  /** Cindy can open the engine's page in Model Providers for this page (see probeOpenProviders). */
  var canOpenProviders = false;
  var openProvidersFailed = false;

  function $(id) {
    return document.getElementById(id);
  }

  function show(id, visible) {
    $(id).hidden = !visible;
  }

  function loadLocale() {
    return fetch('/app-context')
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (body) {
        var context = body && body.context;
        locale = context && (context.uiLocale || context.locale) === 'zh-CN' ? 'zh-CN' : 'en';
      })
      .catch(function () { /* keep the current language */ })
      .then(function () {
        t = STRINGS[locale];
        document.documentElement.lang = locale;
        render();
      });
  }

  function wake() {
    return fetch('/wake')
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (body) { return body && typeof body.state === 'string' ? body.state : null; })
      .catch(function () { return null; });
  }

  function noteFor(currentError, publish) {
    if (currentError) {
      if (currentError.key === 'detectFailed') return t.detectFailed(currentError.text);
      return t[currentError.key];
    }
    if (!publish || publish.status === 'published') return '';
    if (publish.status === 'unsupported') return t.unsupported;
    if (publish.status === 'not-enabled') return t.notEnabled;
    return t.publishFailed(publish.httpStatus);
  }

  function render() {
    var result = snapshot && snapshot.result;
    renderMaintenance(error ? null : result, locale, !!pending);
    var badge = $('badge');
    var label = t.checking;
    var tone = 'neutral';
    // No signed-in account could list the models: accounts are added in Cindy's Model Providers.
    var signIn = Boolean(result && result.available && snapshot.signInRequired);
    if (result) {
      if (signIn) {
        label = t.notSignedIn;
        tone = 'warning';
      } else if (result.available) {
        label = t.ready;
        tone = 'success';
      } else if (result.reason === 'not-runnable') {
        label = t.notRunnable;
        tone = 'error';
      } else if (result.reason === 'custom-path-unavailable') {
        label = t.customPathUnavailable;
        tone = 'error';
      } else {
        label = t.notInstalled;
      }
    } else if (!pending && error) {
      label = t.checkFailed;
      tone = 'error';
    }
    badge.textContent = label;
    badge.setAttribute('data-tone', tone);

    var hasPath = Boolean(result && result.path);
    $('label-version').textContent = t.version;
    $('version').textContent = (result && result.version) || '—';
    $('label-path').textContent = t.path;
    $('path').textContent = (result && result.path) || '';
    show('label-path', hasPath);
    show('path', hasPath);

    var needsInstall = Boolean(result && !result.available);

    $('detail').textContent = (result && !result.available && result.detail) || '';
    show('detail', Boolean(needsInstall && result.detail));

    var note = noteFor(error, snapshot && snapshot.publish);
    $('note').textContent = note || '';
    $('note').setAttribute('data-tone', error ? 'error' : 'neutral');
    show('note', Boolean(note));

    $('foot').textContent = t.foot;
    renderCustomPath();
    renderHttpProxy();
    renderAccountsGuide(signIn);
  }

  function httpProxyNoteText(note) {
    if (!note) return '';
    if (note.key === 'saved') return t.httpProxySaved;
    if (note.key === 'cleared') return t.httpProxyCleared;
    return t.httpProxyErrors[note.key] || t[note.key] || t.httpProxyErrors.failed;
  }

  function renderHttpProxy() {
    var saved = (snapshot && snapshot.result && snapshot.result.httpProxy) || '';
    $('label-http-proxy').textContent = t.httpProxy;
    var input = $('http-proxy-input');
    input.placeholder = t.httpProxyPlaceholder;
    if (!httpProxyDirty && !httpProxyPending) input.value = saved;
    var locked = Boolean(httpProxyPending);
    input.disabled = locked;
    var saveBtn = $('http-proxy-save');
    saveBtn.textContent = httpProxyPending ? t.customPathSaving : t.customPathSave;
    saveBtn.disabled = locked || (input.value || '').trim() === saved;
    var resetBtn = $('http-proxy-reset');
    resetBtn.textContent = t.httpProxyReset;
    resetBtn.disabled = locked;
    show('http-proxy-reset', Boolean(saved));
    var noteEl = $('http-proxy-note');
    noteEl.textContent = httpProxyNoteText(httpProxyNote);
    noteEl.setAttribute('data-tone', httpProxyNote && httpProxyNote.tone === 'error' ? 'error' : 'neutral');
    show('http-proxy-note', Boolean(httpProxyNote));
  }

  function customPathNoteText(note) {
    if (!note) return '';
    if (note.key === 'saved') return t.customPathSaved;
    if (note.key === 'cleared') return t.customPathCleared;
    if (note.key === 'unavailable') return t.customPathUnavailableNote;
    var base = t.customPathErrors[note.key] || t[note.key] || t.customPathErrors.failed;
    return note.detail ? base + ' (' + note.detail + ')' : base;
  }

  function renderCustomPath() {
    var result = snapshot && snapshot.result;
    var activeCustom = (result && result.customPath) || '';
    var configured = Boolean(result && (result.customPath || result.customPathConfigured));
    $('label-custom-path').textContent = t.customPath;
    var input = $('custom-path-input');
    input.placeholder = t.customPathPlaceholder;
    if (!customPathDirty && !customPathPending) input.value = activeCustom;
    var locked = Boolean(customPathPending) || cliBusy;
    input.disabled = locked;
    var currentVal = (input.value || '').trim();
    var unchanged = currentVal === activeCustom && !(configured && !activeCustom);
    var saveBtn = $('custom-path-save');
    saveBtn.textContent = customPathPending ? t.customPathSaving : t.customPathSave;
    saveBtn.disabled = locked || unchanged;
    var resetBtn = $('custom-path-reset');
    resetBtn.textContent = t.customPathReset;
    resetBtn.disabled = locked;
    show('custom-path-reset', configured);
    var activeNote = customPathNote || (result && result.reason === 'custom-path-unavailable' ? { key: 'unavailable', tone: 'error' } : null);
    var noteEl = $('custom-path-note');
    noteEl.textContent = customPathNoteText(activeNote);
    noteEl.setAttribute('data-tone', activeNote && activeNote.tone === 'error' ? 'error' : 'neutral');
    show('custom-path-note', Boolean(activeNote));
  }

  /** Accounts live in Cindy's Model Providers; shown only while agy is installed and runs. */
  function renderAccountsGuide(signInRequired) {
    var available = Boolean(snapshot && snapshot.result && snapshot.result.available);
    show('accounts-guide', available);
    if (!available) return;
    $('accounts-guide-title').textContent = t.accountsTitle;
    $('accounts-guide-text').textContent = signInRequired ? t.accountsGuideSignedOut : t.accountsGuide;
    $('accounts-guide-text').setAttribute('data-tone', signInRequired ? 'warning' : 'neutral');
    $('accounts-open').textContent = t.accountsOpen;
    show('accounts-open', canOpenProviders);
    $('accounts-open-note').textContent = t.accountsOpenFailed;
    show('accounts-open-note', openProvidersFailed);
  }

  var OPEN_PROVIDERS_PATH = '/harnesses/open-settings';

  /**
   * A Cindy that opens the engine's settings answers a GET here with 405 (it only takes POST); an
   * older one, a phone or a remote view has no such path (404), and the page keeps the text alone.
   */
  function probeOpenProviders() {
    return fetch(OPEN_PROVIDERS_PATH)
      .then(function (response) { canOpenProviders = Boolean(response) && response.status === 405; })
      .catch(function () { canOpenProviders = false; })
      .then(render);
  }

  /** Asks Cindy to show Antigravity in Settings → Model Providers; Cindy only does so right after a click. */
  function openProviders() {
    fetch(OPEN_PROVIDERS_PATH, { method: 'POST', body: JSON.stringify({ id: 'agy' }) })
      .then(function (response) { return Boolean(response) && response.ok === true; }, function () { return false; })
      .then(function (opened) {
        openProvidersFailed = !opened;
        render();
      });
  }

  function settle(state, nextSnapshot, errorKey) {
    if (pending !== state) return;
    pending = null;
    clearInterval(state.resend);
    clearTimeout(state.deadline);
    if (nextSnapshot) {
      snapshot = nextSnapshot.result || !snapshot ? nextSnapshot : { ...snapshot, checkedAt: nextSnapshot.checkedAt };
      error = nextSnapshot.ok ? null : { key: 'detectFailed', text: nextSnapshot.error };
    } else {
      error = { key: errorKey };
    }
    render();
  }

  function requestDetect() {
    if (pending) return;
    var state = {
      reqId: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
      acked: false,
      sends: 0,
      resend: null,
      deadline: null,
    };
    pending = state;
    render();
    if (!channel) {
      settle(state, null, 'backgroundOff');
      return;
    }
    state.deadline = setTimeout(function () { settle(state, null, 'timeout'); }, RESULT_TIMEOUT_MS);
    var send = function () {
      if (pending !== state || state.acked) return;
      if (state.sends >= MAX_SENDS) {
        settle(state, null, 'backgroundOff');
        return;
      }
      state.sends += 1;
      channel.postMessage({ type: 'detect-request', reqId: state.reqId });
    };
    // The logic page is resident, but wake it in case it was restarted; /wake is idempotent.
    wake().then(function (wakeState) {
      if (pending !== state) return;
      if (wakeState === 'off' || wakeState === 'fused') {
        settle(state, null, 'backgroundOff');
        return;
      }
      send();
      // Bounded resend until main.js acknowledges (it may still be loading); not polling.
      state.resend = setInterval(send, RESEND_INTERVAL_MS);
    });
  }

  function settleCustomPath(state, message, fallbackErrorKey) {
    if (customPathPending !== state) return;
    customPathPending = null;
    clearInterval(state.resend);
    clearTimeout(state.deadline);
    if (message && message.ok && message.snapshot && typeof message.snapshot === 'object') {
      snapshot = message.snapshot;
      error = message.snapshot.ok ? null : { key: 'detectFailed', text: message.snapshot.error };
      customPathDirty = false;
      var saved = Boolean(message.snapshot.result && message.snapshot.result.customPath);
      customPathNote = { key: saved ? 'saved' : 'cleared', tone: 'neutral' };
      render();
      return;
    }
    var code = (message && message.error) || fallbackErrorKey || 'failed';
    customPathNote = { key: code, detail: message && message.detail, tone: 'error' };
    renderCustomPath();
  }

  function requestCustomPath(rawPath) {
    if (customPathPending) return;
    var state = {
      reqId: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
      path: typeof rawPath === 'string' ? rawPath : '',
      acked: false,
      sends: 0,
      resend: null,
      deadline: null,
    };
    customPathPending = state;
    customPathNote = null;
    renderCustomPath();
    if (!channel) {
      settleCustomPath(state, null, 'backgroundOff');
      return;
    }
    state.deadline = setTimeout(function () { settleCustomPath(state, null, 'timeout'); }, RESULT_TIMEOUT_MS);
    var send = function () {
      if (customPathPending !== state || state.acked) return;
      if (state.sends >= MAX_SENDS) {
        settleCustomPath(state, null, 'backgroundOff');
        return;
      }
      state.sends += 1;
      channel.postMessage({ type: 'custom-path-request', reqId: state.reqId, path: state.path });
    };
    wake().then(function (wakeState) {
      if (customPathPending !== state) return;
      if (wakeState === 'off' || wakeState === 'fused') {
        settleCustomPath(state, null, 'backgroundOff');
        return;
      }
      send();
      state.resend = setInterval(send, RESEND_INTERVAL_MS);
    });
  }

  function adoptHttpProxySnapshot(next) {
    snapshot = next;
    error = next.ok ? null : { key: 'detectFailed', text: next.error };
  }

  function settleHttpProxy(state, message, fallbackErrorKey) {
    if (httpProxyPending !== state) return;
    httpProxyPending = null;
    clearInterval(state.resend);
    clearTimeout(state.deadline);
    if (message && message.ok && message.snapshot && typeof message.snapshot === 'object') {
      adoptHttpProxySnapshot(message.snapshot);
      httpProxyDirty = false;
      var saved = Boolean(message.snapshot.result && message.snapshot.result.httpProxy);
      httpProxyNote = { key: saved ? 'saved' : 'cleared', tone: 'neutral' };
      render();
      return;
    }
    httpProxyNote = { key: (message && message.error) || fallbackErrorKey || 'failed', tone: 'error' };
    renderHttpProxy();
  }

  function requestHttpProxy(rawProxy) {
    if (httpProxyPending) return;
    var state = {
      reqId: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
      proxy: typeof rawProxy === 'string' ? rawProxy : '',
      acked: false,
      sends: 0,
      resend: null,
      deadline: null,
    };
    httpProxyPending = state;
    httpProxyNote = null;
    renderHttpProxy();
    if (!channel) {
      settleHttpProxy(state, null, 'backgroundOff');
      return;
    }
    state.deadline = setTimeout(function () { settleHttpProxy(state, null, 'timeout'); }, RESULT_TIMEOUT_MS);
    var send = function () {
      if (httpProxyPending !== state || state.acked) return;
      if (state.sends >= MAX_SENDS) {
        settleHttpProxy(state, null, 'backgroundOff');
        return;
      }
      state.sends += 1;
      channel.postMessage({ type: 'http-proxy-request', reqId: state.reqId, proxy: state.proxy });
    };
    wake().then(function (wakeState) {
      if (httpProxyPending !== state) return;
      if (wakeState === 'off' || wakeState === 'fused') {
        settleHttpProxy(state, null, 'backgroundOff');
        return;
      }
      send();
      state.resend = setInterval(send, RESEND_INTERVAL_MS);
    });
  }

  if (channel) {
    channel.onmessage = function (event) {
      var data = event && event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'detect-ack') {
        if (pending && data.reqId === pending.reqId) {
          pending.acked = true;
          clearInterval(pending.resend);
        }
        return;
      }
      if (data.type === 'detect-result' && data.snapshot && typeof data.snapshot === 'object') {
        if (pending && data.reqId === pending.reqId) {
          settle(pending, data.snapshot);
        } else if (!pending && data.snapshot.result) {
          // Another open settings view asked; its fresh result is valid here too.
          snapshot = data.snapshot;
          error = data.snapshot.ok ? null : { key: 'detectFailed', text: data.snapshot.error };
          render();
        }
        return;
      }
      if (data.type === 'http-proxy-ack') {
        if (httpProxyPending && data.reqId === httpProxyPending.reqId) {
          httpProxyPending.acked = true;
          clearInterval(httpProxyPending.resend);
        }
        return;
      }
      if (data.type === 'http-proxy-result') {
        if (httpProxyPending && data.reqId === httpProxyPending.reqId) {
          settleHttpProxy(httpProxyPending, data);
        } else if (data.ok && data.snapshot && data.snapshot.result) {
          // Saved from another window: that is the current proxy.
          adoptHttpProxySnapshot(data.snapshot);
          if (!httpProxyPending) httpProxyDirty = false;
          render();
        }
        return;
      }
      if (data.type === 'custom-path-ack') {
        if (customPathPending && data.reqId === customPathPending.reqId) {
          customPathPending.acked = true;
          clearInterval(customPathPending.resend);
        }
        return;
      }
      if (data.type === 'cli-state') {
        cliBusy = Boolean(data.active && data.action !== 'check');
        renderCustomPath();
        return;
      }
      if (data.type === 'custom-path-result') {
        if (customPathPending && data.reqId === customPathPending.reqId) {
          settleCustomPath(customPathPending, data);
        } else if (data.ok && data.snapshot && data.snapshot.result) {
          // Saved from another window: that is the current state, even while a save of our own waits for its answer.
          snapshot = data.snapshot;
          error = data.snapshot.ok ? null : { key: 'detectFailed', text: data.snapshot.error };
          if (!customPathPending) customPathDirty = false;
          render();
        }
        return;
      }
      if (data.type === 'locale-changed') loadLocale();
    };
  }

  $('custom-path-input').addEventListener('input', function () {
    customPathDirty = true;
    customPathNote = null;
    renderCustomPath();
  });
  $('custom-path-input').addEventListener('keydown', function (event) {
    if (event && event.key === 'Enter' && !event.isComposing && !$('custom-path-save').disabled) {
      requestCustomPath($('custom-path-input').value || '');
    }
  });
  $('custom-path-save').addEventListener('click', function () {
    if (!$('custom-path-save').disabled) requestCustomPath($('custom-path-input').value || '');
  });
  $('custom-path-reset').addEventListener('click', function () {
    if ($('custom-path-reset').disabled) return;
    $('custom-path-input').value = '';
    customPathDirty = false;
    requestCustomPath('');
  });

  $('accounts-open').addEventListener('click', openProviders);

  $('http-proxy-input').addEventListener('input', function () {
    httpProxyDirty = true;
    httpProxyNote = null;
    renderHttpProxy();
  });
  $('http-proxy-input').addEventListener('keydown', function (event) {
    if (event && event.key === 'Enter' && !event.isComposing && !$('http-proxy-save').disabled) {
      requestHttpProxy($('http-proxy-input').value || '');
    }
  });
  $('http-proxy-save').addEventListener('click', function () {
    if (!$('http-proxy-save').disabled) requestHttpProxy($('http-proxy-input').value || '');
  });
  $('http-proxy-reset').addEventListener('click', function () {
    if ($('http-proxy-reset').disabled) return;
    $('http-proxy-input').value = '';
    httpProxyDirty = false;
    requestHttpProxy('');
  });

  loadLocale().then(requestDetect);
  probeOpenProviders();
})();
