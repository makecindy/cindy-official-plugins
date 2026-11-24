/*
 * DeepSeek Harness - settings page.
 * Shows the detection result and asks the logic page (main.js) to check again when
 * the page opens, becomes visible again, or the user clicks "Check again".
 * Detection and publishing live in main.js; this page only displays the result.
 */
(function () {
  'use strict';

  var CHANNEL_NAME = 'dsh-acp';
  var RESEND_INTERVAL_MS = 500;
  var MAX_SENDS = 20;
  var RESULT_TIMEOUT_MS = 45000;

  var STRINGS = {
    'zh-CN': {
      checking: '检测中…',
      ready: '可以使用',
      notInstalled: '未安装',
      notRunnable: '无法运行',
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
      foot: 'DeepSeek 的模型由 DSH 自己的配置决定。',
      keyTitle: 'DeepSeek API Key',
      keyReading: '读取中…',
      keyMissing: '未配置',
      keyFile: '已保存',
      keyEnv: '来自环境变量',
      keyDotenv: '来自 .env 文件',
      keyUnreadable: '无法读取',
      keySave: '保存',
      keySaving: '保存中…',
      keyClear: '清除',
      keyClearing: '清除中…',
      keyPlaceholder: 'sk-…',
      keyPlaceholderReplace: '输入新的 Key 替换当前的',
      keyHelp: 'Key 保存在 DSH 自己的凭证文件（~/.dsh/.credentials.yaml）里，保存后立即生效，终端里的 dsh 也会用它。Cindy 不保存这个 Key。',
      keyHelpMissing: '还没有 Key？可以在 DeepSeek 开放平台（platform.deepseek.com）创建。',
      keyHelpEnv: '现在用的是环境变量或 .env 文件里的 Key。在这里保存的 Key 会优先使用。',
      keySaved: '已保存，从下一条消息开始生效。',
      keyCleared: '已清除。',
      keyClearedFallback: '已清除保存的 Key，现在用的是环境变量或 .env 文件里的 Key。',
      keyInvalid: 'Key 不能为空，也不能包含空格。',
      keyStoreFailed: function (detail) { return '没能读写 DSH 的凭证文件' + (detail ? '：' + detail : '。'); },
      keyWorkerFailed: '插件后台没有响应，请稍后重试。',
      keyUnsupported: '这个版本的 DSH 不支持在这里设置 Key，请按 DSH 自己的说明配置。',
      keyTimeout: '操作没有完成，请重试。',
    },
    en: {
      checking: 'Checking…',
      ready: 'Ready',
      notInstalled: 'Not installed',
      notRunnable: 'Can’t run',
      checkFailed: 'Check failed',
      version: 'Version',
      path: 'Location',
      unsupported: 'This version of Cindy can’t use engines provided by plugins yet. Update Cindy to use DeepSeek Harness.',
      notEnabled: 'Cindy hasn’t enabled this engine yet. Review the plugin’s permissions in its details, then check again.',
      publishFailed: function (status) {
        return 'The result couldn’t be shared with Cindy' + (status ? ' (HTTP ' + status + ')' : '') + '. Try checking again later.';
      },
      backgroundOff: 'The plugin isn’t running in the background. Make sure it’s enabled, then check again.',
      timeout: 'The check didn’t finish. Try again.',
      detectFailed: function (text) { return 'Couldn’t check' + (text ? ': ' + text : '.'); },
      foot: 'DeepSeek models come from DSH’s own configuration.',
      keyTitle: 'DeepSeek API key',
      keyReading: 'Reading…',
      keyMissing: 'Not set',
      keyFile: 'Saved',
      keyEnv: 'From an environment variable',
      keyDotenv: 'From a .env file',
      keyUnreadable: 'Couldn’t read',
      keySave: 'Save',
      keySaving: 'Saving…',
      keyClear: 'Clear',
      keyClearing: 'Clearing…',
      keyPlaceholder: 'sk-…',
      keyPlaceholderReplace: 'Enter a new key to replace the current one',
      keyHelp: 'The key is saved in DSH’s own credential file (~/.dsh/.credentials.yaml). It takes effect right away, and dsh in your terminal uses it too. Cindy doesn’t store it.',
      keyHelpMissing: 'No key yet? Create one on the DeepSeek Platform (platform.deepseek.com).',
      keyHelpEnv: 'DSH is using a key from an environment variable or a .env file. A key saved here takes priority.',
      keySaved: 'Saved. It applies from your next message.',
      keyCleared: 'Cleared.',
      keyClearedFallback: 'The saved key was cleared. DSH now uses the key from an environment variable or a .env file.',
      keyInvalid: 'The key can’t be empty or contain spaces.',
      keyStoreFailed: function (detail) { return 'Couldn’t read or write DSH’s credential file' + (detail ? ': ' + detail : '.'); },
      keyWorkerFailed: 'The plugin’s background process didn’t respond. Try again later.',
      keyUnsupported: 'This version of DSH can’t have its key set here. Set it up as described in DSH’s own instructions.',
      keyTimeout: 'That didn’t finish. Try again.',
    },
  };

  var locale = 'en';
  var t = STRINGS.en;
  var channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
  var renderMaintenance = window.createCliMaintenance(channel, requestDetect, 'recheck');
  var snapshot = null;
  var error = null;
  var pending = null;
  /** Last key status from the worker: { supported, configured, source?, writable } or { supported: false, reason }. */
  var keyStatus = null;
  var keyPending = null;
  var keyNote = null;

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
    if (result) {
      if (result.available) {
        label = t.ready;
        tone = 'success';
      } else if (result.reason === 'not-runnable') {
        label = t.notRunnable;
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
    renderKey();
  }

  function keyStatusLabel() {
    if (!keyStatus) return { text: t.keyReading, tone: 'neutral' };
    if (keyStatus.supported === false) return { text: t.keyUnreadable, tone: 'neutral' };
    if (!keyStatus.configured) return { text: t.keyMissing, tone: 'warning' };
    if (keyStatus.source === 'file') return { text: t.keyFile, tone: 'success' };
    if (keyStatus.source === 'env') return { text: t.keyEnv, tone: 'success' };
    return { text: t.keyDotenv, tone: 'success' };
  }

  /** The key section exists only once dsh was found; the key itself is never shown. */
  function renderKey() {
    var available = Boolean(snapshot && snapshot.result && snapshot.result.available);
    show('key-section', available);
    if (!available) return;
    $('key-title').textContent = t.keyTitle;
    var label = keyStatusLabel();
    $('key-status').textContent = label.text;
    $('key-status').setAttribute('data-tone', label.tone);
    var unsupported = Boolean(keyStatus && keyStatus.supported === false);
    show('key-form', !unsupported);
    var busy = Boolean(keyPending);
    var input = $('key-input');
    input.disabled = busy;
    input.placeholder = keyStatus && keyStatus.configured ? t.keyPlaceholderReplace : t.keyPlaceholder;
    input.setAttribute('aria-label', t.keyTitle);
    $('key-save').textContent = keyPending && keyPending.op === 'set' ? t.keySaving : t.keySave;
    $('key-save').disabled = busy;
    $('key-clear').textContent = keyPending && keyPending.op === 'clear' ? t.keyClearing : t.keyClear;
    $('key-clear').disabled = busy;
    show('key-clear', Boolean(keyStatus && keyStatus.source === 'file'));
    var help = unsupported ? t.keyUnsupported : t.keyHelp;
    if (!unsupported && keyStatus) {
      if (!keyStatus.configured) help += ' ' + t.keyHelpMissing;
      else if (keyStatus.source !== 'file') help += ' ' + t.keyHelpEnv;
    }
    $('key-help').textContent = help;
    $('key-note').textContent = keyNote ? keyNote.text : '';
    $('key-note').setAttribute('data-tone', keyNote && keyNote.tone === 'error' ? 'error' : 'neutral');
    show('key-note', Boolean(keyNote));
  }

  function keyFailureText(result) {
    if (result.error === 'invalid-key') return t.keyInvalid;
    if (result.error === 'store-failed') return t.keyStoreFailed(result.detail);
    return t.keyWorkerFailed;
  }

  function settleKey(state, result, errorKey) {
    if (keyPending !== state) return;
    keyPending = null;
    clearInterval(state.resend);
    clearTimeout(state.deadline);
    if (!result) {
      keyNote = { text: t[errorKey], tone: 'error' };
    } else if (result.supported === false) {
      keyStatus = result;
      keyNote = null;
    } else if (result.error) {
      // Keep the last known status; only this attempt failed.
      keyNote = { text: keyFailureText(result), tone: 'error' };
    } else {
      keyStatus = result;
      if (state.op === 'set') {
        $('key-input').value = '';
        keyNote = { text: t.keySaved, tone: 'neutral' };
      } else if (state.op === 'clear') {
        keyNote = { text: result.configured ? t.keyClearedFallback : t.keyCleared, tone: 'neutral' };
      }
    }
    renderKey();
  }

  /** Same bounded resend-until-acknowledged handshake as detection; `key` only for 'set'. */
  function requestKey(op, key) {
    if (keyPending) return;
    var state = {
      reqId: 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
      op: op,
      acked: false,
      sends: 0,
      resend: null,
      deadline: null,
    };
    keyPending = state;
    if (op !== 'status') keyNote = null;
    renderKey();
    if (!channel) {
      settleKey(state, null, 'keyWorkerFailed');
      return;
    }
    state.deadline = setTimeout(function () { settleKey(state, null, 'keyTimeout'); }, RESULT_TIMEOUT_MS);
    var send = function () {
      if (keyPending !== state || state.acked) return;
      if (state.sends >= MAX_SENDS) {
        settleKey(state, null, 'keyWorkerFailed');
        return;
      }
      state.sends += 1;
      var message = { type: 'key-request', reqId: state.reqId, op: op };
      if (op === 'set') message.key = key;
      channel.postMessage(message);
    };
    wake().then(function (wakeState) {
      if (keyPending !== state) return;
      if (wakeState === 'off' || wakeState === 'fused') {
        settleKey(state, null, 'keyWorkerFailed');
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
    } else {
      error = { key: errorKey };
    }
    render();
    // Each check also re-reads where the key comes from (it may have been set in a terminal).
    if (snapshot && snapshot.result && snapshot.result.available) requestKey('status');
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
      if (data.type === 'key-ack') {
        if (keyPending && data.reqId === keyPending.reqId) {
          keyPending.acked = true;
          clearInterval(keyPending.resend);
        }
        return;
      }
      if (data.type === 'key-result' && data.result && typeof data.result === 'object') {
        if (keyPending && data.reqId === keyPending.reqId) settleKey(keyPending, data.result);
        return;
      }
      if (data.type === 'locale-changed') loadLocale();
    };
  }

  $('key-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var value = $('key-input').value.trim();
    if (!value || /\s/.test(value)) {
      keyNote = { text: t.keyInvalid, tone: 'error' };
      renderKey();
      return;
    }
    requestKey('set', value);
  });
  $('key-clear').addEventListener('click', function () { requestKey('clear'); });

  loadLocale().then(requestDetect);
})();
