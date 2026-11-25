/*
 * Antigravity - settings page.
 * Shows the detection result and asks the logic page (main.js) to check again when
 * the page opens, becomes visible again, or the user clicks "Check again".
 * Detection and publishing live in main.js; this page only displays the result.
 * The Account section shows whether agy is signed in (and its subscription tier) and asks
 * main.js to sign in with Google (agy opens the browser) or, after a confirmation, to sign out.
 */
(function () {
  'use strict';

  var CHANNEL_NAME = 'cindy-antigravity-acp';
  var RESEND_INTERVAL_MS = 500;
  var MAX_SENDS = 20;
  var RESULT_TIMEOUT_MS = 45000;
  /** How long each account request may take before the page gives up waiting for its result. */
  var ACCOUNT_DEADLINES = { status: 75000, login: 360000, cancel: 20000, logout: 75000 };

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
      foot: '模型、思考深度与工作模式来自 Antigravity，账号由 agy 自己管理。订阅额度用完时不会使用付费的 Google AI 积分。',
      accountTitle: '账号',
      accountChecking: '检查中…',
      accountSignedIn: '已登录',
      accountSignedInTier: function (tier) { return '已登录 · ' + tier; },
      accountSignedOut: '未登录',
      accountSigningIn: '等待浏览器登录…',
      accountSigningOut: '正在退出…',
      accountLogin: '用 Google 登录',
      accountCancel: '取消登录',
      accountLogout: '退出登录',
      accountHelpSignedIn: '登录信息由 agy 自己保存，Cindy 不保存。终端里的 agy 用的也是这个账号。',
      accountHelpSignedOut: '点「用 Google 登录」会打开浏览器，在浏览器里完成登录即可。登录信息由 agy 自己保存，Cindy 不保存。',
      accountHelpSigningIn: '请在弹出的浏览器窗口里完成 Google 登录，最多等 5 分钟。浏览器没有打开的话，可以取消后在终端运行 agy 登录。',
      accountHelpNoSignIn: '这个版本的 agy 不支持在这里登录，请在终端运行 agy 登录，然后点「重新检测」。',
      accountConfirm: '退出后，Cindy 里的 Antigravity 和终端里的 agy 都要重新登录才能用。确定退出吗？',
      accountConfirmYes: '退出登录',
      accountConfirmNo: '取消',
      accountCancelled: '已取消登录。',
      accountTimedOut: '5 分钟内没有完成登录，请重试。',
      accountSignedOutNote: '已退出登录。',
      accountBusy: '上一个登录操作还没有结束，请稍候。',
      accountStale: 'Antigravity 可执行文件已更改，请重新检查登录状态后再试。',
      accountUnsupported: '这个版本的 agy 不支持这个操作，请在终端里用 agy 完成。',
      accountWorkerFailed: '插件后台没有响应，请稍后重试。',
      accountStatusFailed: '没能检查登录状态，请点「重新检测」。',
      loginFailed: function (detail) { return '没能完成登录' + (detail ? '：' + detail : '，请重试。'); },
      logoutFailed: function (detail) { return '没能退出登录' + (detail ? '：' + detail : '，请重试。'); },
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
      foot: 'Models, reasoning levels and working modes come from Antigravity; agy manages your account. Paid Google AI credits are never used when the subscription quota runs out.',
      accountTitle: 'Account',
      accountChecking: 'Checking…',
      accountSignedIn: 'Signed in',
      accountSignedInTier: function (tier) { return 'Signed in · ' + tier; },
      accountSignedOut: 'Not signed in',
      accountSigningIn: 'Waiting for the browser sign-in…',
      accountSigningOut: 'Signing out…',
      accountLogin: 'Sign in with Google',
      accountCancel: 'Cancel sign-in',
      accountLogout: 'Sign out',
      accountHelpSignedIn: 'agy keeps your sign-in; Cindy doesn’t store it. agy in a terminal uses the same account.',
      accountHelpSignedOut: '“Sign in with Google” opens your browser; finish signing in there. agy keeps your sign-in; Cindy doesn’t store it.',
      accountHelpSigningIn: 'Finish signing in with Google in the browser window that opened (up to 5 minutes). If no browser opened, cancel and run agy in a terminal to sign in.',
      accountHelpNoSignIn: 'This version of agy can’t sign in from here. Run agy in a terminal to sign in, then click “Check again”.',
      accountConfirm: 'After signing out, Antigravity in Cindy and agy in a terminal both need a new sign-in. Sign out?',
      accountConfirmYes: 'Sign out',
      accountConfirmNo: 'Cancel',
      accountCancelled: 'Sign-in cancelled.',
      accountTimedOut: 'Sign-in didn’t finish within 5 minutes. Try again.',
      accountSignedOutNote: 'Signed out.',
      accountBusy: 'The previous sign-in action hasn’t finished yet. Please wait.',
      accountStale: 'The Antigravity executable changed. Check the sign-in again, then retry.',
      accountUnsupported: 'This version of agy can’t do that from here. Use agy in a terminal instead.',
      accountWorkerFailed: 'The plugin’s background process didn’t respond. Try again later.',
      accountStatusFailed: 'Couldn’t check the sign-in. Click “Check again”.',
      loginFailed: function (detail) { return 'Couldn’t sign in' + (detail ? ': ' + detail : '. Try again.'); },
      logoutFailed: function (detail) { return 'Couldn’t sign out' + (detail ? ': ' + detail : '. Try again.'); },
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
  var cliBusy = false;
  /** Last account view from main.js: { signedIn, tier?, canSignIn, canSignOut, busy }. */
  var accountState = null;
  /** Account requests waiting for main.js, by reqId: { reqId, op, acked, sends, resend, deadline }. */
  var accountRequests = {};
  var accountNote = null;
  var confirmingLogout = false;

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
    // The latest sign-in state (account-changed) is newer than the last detection snapshot.
    var knownSignIn = accountState && typeof accountState.signedIn === 'boolean' ? !accountState.signedIn : null;
    var signIn = Boolean(result && result.available && (knownSignIn !== null ? knownSignIn : snapshot.signInRequired));
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
    renderAccount();
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

  function accountInFlight(op) {
    for (var id in accountRequests) {
      if (Object.prototype.hasOwnProperty.call(accountRequests, id) && accountRequests[id].op === op) return true;
    }
    return false;
  }

  /** The Account section exists only while agy is installed and runs. */
  function renderAccount() {
    var available = Boolean(snapshot && snapshot.result && snapshot.result.available);
    show('account', available);
    if (!available) return;
    var state = accountState || {};
    var busy = state.busy || (accountInFlight('login') ? 'login' : accountInFlight('logout') ? 'logout' : null);
    var signedIn = state.signedIn;
    $('account-title').textContent = t.accountTitle;

    var label = t.accountChecking;
    var tone = 'neutral';
    var help = '';
    if (busy === 'login') {
      label = t.accountSigningIn;
      help = t.accountHelpSigningIn;
    } else if (busy === 'logout') {
      label = t.accountSigningOut;
    } else if (signedIn === true) {
      label = state.tier ? t.accountSignedInTier(state.tier) : t.accountSignedIn;
      tone = 'success';
      help = t.accountHelpSignedIn;
    } else if (signedIn === false) {
      label = t.accountSignedOut;
      tone = 'warning';
      help = state.canSignIn === false ? t.accountHelpNoSignIn : t.accountHelpSignedOut;
    }
    $('account-status').textContent = label;
    $('account-status').setAttribute('data-tone', tone);
    $('account-help').textContent = help;
    show('account-help', Boolean(help));

    var confirming = confirmingLogout && signedIn === true && !busy;
    $('account-login').textContent = t.accountLogin;
    $('account-cancel').textContent = t.accountCancel;
    $('account-cancel').disabled = accountInFlight('cancel');
    $('account-logout').textContent = t.accountLogout;
    show('account-login', signedIn === false && !busy && state.canSignIn !== false);
    show('account-cancel', busy === 'login');
    show('account-logout', signedIn === true && !busy && !confirming && state.canSignOut !== false);
    show('account-actions', !confirming);
    $('account-confirm-text').textContent = t.accountConfirm;
    $('account-confirm-yes').textContent = t.accountConfirmYes;
    $('account-confirm-no').textContent = t.accountConfirmNo;
    show('account-confirm', confirming);

    $('account-note').textContent = accountNote ? accountNote.text : '';
    $('account-note').setAttribute('data-tone', accountNote && accountNote.tone === 'error' ? 'error' : 'neutral');
    show('account-note', Boolean(accountNote));
  }

  function accountNoteFor(op, message) {
    var error = message.error;
    if (!error) return op === 'logout' ? { text: t.accountSignedOutNote, tone: 'neutral' } : null;
    if (error === 'cancelled') return { text: t.accountCancelled, tone: 'neutral' };
    if (error === 'timeout') return { text: t.accountTimedOut, tone: 'error' };
    // A busy note only describes the moment of the refusal: it goes once the save has ended or a check has succeeded.
    if (error === 'busy') return { text: t.accountBusy, tone: 'error', transient: true };
    if (error === 'stale') return { text: t.accountStale, tone: 'error' };
    if (error === 'unsupported') return { text: t.accountUnsupported, tone: 'error' };
    if (error === 'not-installed') return null;
    if (op === 'login') return { text: t.loginFailed(message.detail), tone: 'error' };
    if (op === 'logout') return { text: t.logoutFailed(message.detail), tone: 'error' };
    return { text: t.accountStatusFailed, tone: 'error' };
  }

  function settleAccount(state, message, errorKey) {
    if (accountRequests[state.reqId] !== state) return;
    delete accountRequests[state.reqId];
    clearInterval(state.resend);
    clearTimeout(state.deadline);
    if (message) {
      if (message.account && typeof message.account === 'object') accountState = message.account;
      var note = accountNoteFor(state.op, message);
      if (note || state.op !== 'status' || (accountNote && accountNote.transient)) accountNote = note;
    } else {
      accountNote = { text: t[errorKey], tone: 'error' };
    }
    render();
    // What the page shows belongs to a replaced executable (or to a main.js that restarted): read it again.
    if (message && message.error === 'stale') requestDetect();
  }

  /** The executable generation the page's state describes (main.js counts path switches). */
  function displayedGeneration() {
    return snapshot && typeof snapshot.generation === 'number' ? snapshot.generation : undefined;
  }

  /** Same bounded resend-until-acknowledged handshake as detection. */
  function requestAccount(op) {
    if (accountInFlight(op)) return;
    var state = {
      reqId: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
      op: op,
      // The state the user acted on: kept for every resend, even if the page shows another one by then.
      generation: displayedGeneration(),
      acked: false,
      sends: 0,
      resend: null,
      deadline: null,
    };
    accountRequests[state.reqId] = state;
    if (op !== 'status' && op !== 'cancel') accountNote = null;
    renderAccount();
    if (!channel) {
      settleAccount(state, null, 'accountWorkerFailed');
      return;
    }
    state.deadline = setTimeout(function () {
      settleAccount(state, null, op === 'login' ? 'accountTimedOut' : 'accountWorkerFailed');
    }, ACCOUNT_DEADLINES[op]);
    var send = function () {
      if (accountRequests[state.reqId] !== state || state.acked) return;
      if (state.sends >= MAX_SENDS) {
        settleAccount(state, null, 'accountWorkerFailed');
        return;
      }
      state.sends += 1;
      channel.postMessage({ type: 'account-request', reqId: state.reqId, op: op, generation: state.generation });
    };
    wake().then(function (wakeState) {
      if (accountRequests[state.reqId] !== state) return;
      if (wakeState === 'off' || wakeState === 'fused') {
        settleAccount(state, null, 'accountWorkerFailed');
        return;
      }
      send();
      state.resend = setInterval(send, RESEND_INTERVAL_MS);
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
      if (nextSnapshot.account && typeof nextSnapshot.account === 'object') accountState = nextSnapshot.account;
    } else {
      error = { key: errorKey };
    }
    render();
    // Each check also asks agy whether it is signed in (it may have changed in a terminal).
    if (snapshot && snapshot.result && snapshot.result.available) requestAccount('status');
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

  function clearAccountRequests() {
    for (var id in accountRequests) {
      if (!Object.prototype.hasOwnProperty.call(accountRequests, id)) continue;
      clearInterval(accountRequests[id].resend);
      clearTimeout(accountRequests[id].deadline);
      delete accountRequests[id];
    }
    accountNote = null;
    confirmingLogout = false;
  }

  function settleCustomPath(state, message, fallbackErrorKey) {
    if (customPathPending !== state) return;
    customPathPending = null;
    clearInterval(state.resend);
    clearTimeout(state.deadline);
    var droppedNote = Boolean(accountNote && accountNote.transient);
    if (droppedNote) accountNote = null;
    if (message && message.ok && message.snapshot && typeof message.snapshot === 'object') {
      clearAccountRequests();
      snapshot = message.snapshot;
      error = message.snapshot.ok ? null : { key: 'detectFailed', text: message.snapshot.error };
      if (message.snapshot.account && typeof message.snapshot.account === 'object') accountState = message.snapshot.account;
      customPathDirty = false;
      var saved = Boolean(message.snapshot.result && message.snapshot.result.customPath);
      customPathNote = { key: saved ? 'saved' : 'cleared', tone: 'neutral' };
      render();
      if (snapshot.result && snapshot.result.available) requestAccount('status');
      return;
    }
    var code = (message && message.error) || fallbackErrorKey || 'failed';
    customPathNote = { key: code, detail: message && message.detail, tone: 'error' };
    renderCustomPath();
    if (droppedNote) renderAccount();
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
          if (data.snapshot.account && typeof data.snapshot.account === 'object') accountState = data.snapshot.account;
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
          clearAccountRequests();
          snapshot = data.snapshot;
          error = data.snapshot.ok ? null : { key: 'detectFailed', text: data.snapshot.error };
          if (data.snapshot.account && typeof data.snapshot.account === 'object') accountState = data.snapshot.account;
          if (!customPathPending) customPathDirty = false;
          render();
        } else if (!customPathPending && accountNote && accountNote.transient) {
          // A save started in another window ended without changing anything: the refusal it caused no longer applies.
          accountNote = null;
          renderAccount();
        }
        return;
      }
      if (data.type === 'account-ack') {
        var acked = accountRequests[data.reqId];
        if (acked) {
          acked.acked = true;
          clearInterval(acked.resend);
        }
        return;
      }
      if (data.type === 'account-result') {
        if (accountRequests[data.reqId]) settleAccount(accountRequests[data.reqId], data);
        return;
      }
      if (data.type === 'account-changed' && data.account && typeof data.account === 'object') {
        accountState = data.account;
        render();
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

  $('account-login').addEventListener('click', function () {
    confirmingLogout = false;
    requestAccount('login');
  });
  $('account-cancel').addEventListener('click', function () { requestAccount('cancel'); });
  $('account-logout').addEventListener('click', function () {
    confirmingLogout = true;
    accountNote = null;
    renderAccount();
    $('account-confirm-no').focus();
  });
  $('account-confirm-no').addEventListener('click', function () {
    confirmingLogout = false;
    renderAccount();
    $('account-logout').focus();
  });
  $('account-confirm-yes').addEventListener('click', function () {
    confirmingLogout = false;
    requestAccount('logout');
  });

  loadLocale().then(requestDetect);
})();
