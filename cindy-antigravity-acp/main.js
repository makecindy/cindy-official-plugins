/*
 * Antigravity - logic page (browser sandbox, launch: resident).
 *
 * On start, and whenever the settings page asks, it runs the Node worker's `detect`
 * and publishes the result with `PUT /harnesses` so Cindy's model picker can show
 * Antigravity as available or explain how to install / sign in. It never polls:
 * detection only runs on start, on settings-page open / visibility, on "Check again"
 * and when Cindy opens a model picker.
 *
 * Settings page protocol (BroadcastChannel 'cindy-antigravity-acp'):
 *   page -> { type: 'detect-request', reqId }   (resent until acknowledged)
 *   main -> { type: 'detect-ack', reqId }
 *   main -> { type: 'detect-result', reqId, snapshot }
 *   page -> { type: 'custom-path-request', reqId, path }   (resent until acknowledged)
 *   main -> { type: 'custom-path-ack', reqId }
 *   main -> { type: 'custom-path-result', reqId, ok, snapshot?, error?, detail? }
 *   main -> { type: 'locale-changed' }
 *   page -> { type: 'account-request', reqId, op: 'status' | 'login' | 'cancel' | 'logout', generation? }  (resent until acknowledged)
 *     generation is the snapshot.generation the page showed when the user asked (it is clock-seeded, so it survives a main.js restart);
 *     a login or logout asked for another one is answered with error 'stale'.
 *   main -> { type: 'account-ack', reqId }
 *   main -> { type: 'account-result', reqId, op, account, error?, detail? }
 *   main -> { type: 'account-changed', account }   (any change, e.g. a sign-in started from another view)
 *   account = { signedIn: true | false | null, tier?, canSignIn, canSignOut, busy: 'login' | 'logout' | null }
 *
 * Sign-in stays with agy (Google account in agy's own store, see agy-account.js); the plugin never
 * sees credentials or the email, only whether agy is signed in and its subscription tier name.
 * While agy is not signed in the engine is published as unavailable with a sign-in hint.
 */
(function () {
  'use strict';

  var CHANNEL_NAME = 'cindy-antigravity-acp';
  var HARNESS_ID = 'agy';
  var DETECT_TIMEOUT_MS = 30000;
  var MAX_REMEMBERED_REQUESTS = 32;
  // Listing starts agy and switches its probe session through every model; Cindy asks at most
  // every 10 minutes per plugin.
  var MODELS_TIMEOUT_MS = 90000;
  var MODELS_MIN_INTERVAL_MS = 60000;
  var MAX_MODELS = 200;
  /** Cindy reasoning levels, low → high; the same set agy-models.js reports. */
  var EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  /** Cindy permission modes agy's own modes stand for; Full access is always Cindy's. */
  var MODES = ['default', 'acceptEdits', 'auto', 'plan'];
  var ACCOUNT_METHOD_LABELS = {
    'zh-CN': 'Google 账号',
    en: 'Google account',
  };
  var ACCOUNT_TIMEOUT_MS = 60000;
  // Sign-in waits for the user in the browser. The worker reports progress every 10 s, so Cindy keeps
  // the request alive up to 5.5 minutes; agy-account.js itself gives up after 5.
  var LOGIN_SILENCE_MS = 30000;
  var LOGIN_MAX_TOTAL_MS = 330000;
  var ACCOUNT_ERRORS = ['busy', 'not-installed', 'unsupported', 'cancelled', 'timeout', 'failed'];

  var locale = 'en';
  var lastResult = null;
  var lastPublish = null;
  var lastError = null;
  var lastCheckedAt = 0;
  var inflight = null;
  // Counts path switches. Seeded from the clock so a restarted main.js never reuses a generation a page may still hold.
  var pathGeneration = Date.now();
  var customPathQueue = Promise.resolve();
  var customPathPending = 0;
  var seenRequests = [];
  var channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
  // Coalesce settings checks. Drop a read
  // from the previous account if sign-in or credentials change mid-request.
  let usage = null;
  let usageWanted = false;
  let usageCheck = 0;
  let usageGeneration = 0;
  let usagePending = null;
  function announceUsage(checking = false) {
    if (channel) channel.postMessage({ type: 'harness-usage', usage, checking });
  }
  function clearUsage() {
    usageGeneration++;
    usageCheck = 0;
    usagePending = null;
    usage = null;
    announceUsage();
  }
  function refreshUsage() {
    if (!usageAvailable()) {
      usageWanted = true;
      return Promise.resolve();
    }
    usageWanted = false;
    if (usagePending) return usagePending;
    if (Date.now() - usageCheck < 60000) return Promise.resolve();
    usageCheck = Date.now();
    const generation = usageGeneration;
    usagePending = (async () => {
      let next = null;
      try {
        const response = await cindy.node.request({ method: 'usage', params: {}, timeoutMs: 26000 });
        if (response?.ok && (response.result?.windows?.length || response.result?.balances?.length)) next = response.result;
      } catch { /* Absence of billing data does not affect the engine. */ }
      if (generation !== usageGeneration || !usageAvailable()) return;
      usage = next;
      announceUsage();

    })().finally(() => { if (generation === usageGeneration) usagePending = null; });
    return usagePending;
  }
  function usageAvailable() { return !!(lastResult && lastResult.available && !signInRequired); }

  /**
   * agy's model list and working modes (published with the engine status, shown by Cindy like a
   * provider's models) and the plugin's one dedicated agy session used to read them. Kept in the
   * plugin's /kv so a restart republishes the last list without starting agy.
   */
  var models = null;
  var modes = null;
  var defaultMode = null;
  var signInRequired = false;
  var modelSessionId = null;
  var modelsListedAt = 0;
  var modelsInflight = null;

  /**
   * agy's sign-in as last seen (by a listing, a status check, a sign-in or a sign-out); kept in
   * memory only. signedIn is null until checked. accountOp is the sign-in or sign-out running.
   */
  var account = { signedIn: null, tier: null, canSignIn: true, canSignOut: true };
  var accountOp = null;
  var accountOpToken = null;
  var accountCheck = null;
  /** When agy's sign-in state was last learned, and when the user last signed in or out here. */
  var accountSeenAt = 0;
  var accountActionAt = 0;
  var ACCOUNT_FRESH_MS = 10000;

  function sanitizeModels(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    var seen = {};
    for (var i = 0; i < raw.length && out.length < MAX_MODELS; i++) {
      var item = raw[i] || {};
      var id = shortString(item.id, 256);
      var name = shortString(item.name, 200);
      if (!id || !name || seen[id]) continue;
      seen[id] = true;
      var model = { id: id, name: name };
      var description = shortString(item.description, 200);
      var group = shortString(item.group, 200);
      if (description) model.description = description;
      if (group) model.group = group;
      var efforts = Array.isArray(item.efforts)
        ? EFFORTS.filter(function (level) { return item.efforts.indexOf(level) !== -1; })
        : [];
      if (efforts.length) {
        model.efforts = efforts;
        if (efforts.indexOf(item.defaultEffort) !== -1) model.defaultEffort = item.defaultEffort;
      }
      out.push(model);
    }
    return out;
  }

  function sanitizeModes(raw) {
    if (!Array.isArray(raw)) return [];
    return MODES.filter(function (mode) { return raw.indexOf(mode) !== -1; })
      .sort(function (a, b) { return raw.indexOf(a) - raw.indexOf(b); });
  }

  var stateLoaded = fetch('/kv')
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (saved) {
      if (!saved || typeof saved !== 'object') return;
      if (Array.isArray(saved.models)) models = sanitizeModels(saved.models);
      if (typeof saved.modelSessionId === 'string') modelSessionId = saved.modelSessionId.slice(0, 128);
      if (typeof saved.modelsListedAt === 'number') modelsListedAt = saved.modelsListedAt;
      if (Array.isArray(saved.modes)) modes = sanitizeModes(saved.modes);
      if (modes && modes.indexOf(saved.defaultMode) !== -1) defaultMode = saved.defaultMode;
    })
    .catch(function () { /* start without a saved list */ });

  function saveState() {
    var state = { models: models || [], modes: modes || [], modelsListedAt: modelsListedAt };
    if (defaultMode) state.defaultMode = defaultMode;
    if (modelSessionId) state.modelSessionId = modelSessionId;
    return fetch('/kv', { method: 'PUT', body: JSON.stringify(state) }).catch(function () { /* best effort */ });
  }

  function pickLocale(context) {
    var value = context && (context.uiLocale || context.locale);
    return value === 'zh-CN' ? 'zh-CN' : 'en';
  }

  function refreshLocale() {
    return Promise.resolve()
      .then(function () { return cindy.request({ kind: 'app-context' }); })
      .then(function (response) {
        if (response && response.ok && response.context) locale = pickLocale(response.context);
      })
      .catch(function () { /* keep the previous language */ });
  }

  function shortString(value, max) {
    return typeof value === 'string' && value ? value.slice(0, max) : undefined;
  }

  /**
   * agy-acp.js can run a task whose files are on another computer from this agy version on
   * (remote-workspace.js checks the same version again before it starts agy).
   */
  var REMOTE_WORKSPACE_MIN_VERSION = [1, 5, 13];
  function supportsRemoteWorkspace(version) {
    var match = /(\d+)\.(\d+)\.(\d+)/.exec(typeof version === 'string' ? version : '');
    if (!match) return false;
    for (var index = 0; index < 3; index += 1) {
      var part = Number(match[index + 1]);
      if (part !== REMOTE_WORKSPACE_MIN_VERSION[index]) return part > REMOTE_WORKSPACE_MIN_VERSION[index];
    }
    return true;
  }

  /** Only metadata leaves the plugin: never the executable path or a command. */
  function harnessEntry(result) {
    var entry = { id: HARNESS_ID, available: result.available === true };
    if (entry.available) {
      entry.reportsUsage = true;
      // Cindy may manage the original agy login and add more isolated Google accounts in the pool.
      // Keeping the engine available even while the default login is signed out lets users sign in
      // or add accounts directly in Cindy's Model Providers view and keeps other accounts usable.
      entry.accounts = {
        methods: [{
          id: 'oauth-personal',
          label: ACCOUNT_METHOD_LABELS[locale] || ACCOUNT_METHOD_LABELS.en,
          kind: 'browser',
        }],
      };
    }
    if (entry.available && supportsRemoteWorkspace(result.version)) {
      entry.remoteWorkspace = true;
      entry.guestWorkspace = true;
    }

    if (!entry.available) {
      entry.reason = result.reason === 'not-runnable' ? 'not-runnable' : 'not-installed';
      var messages = result.messages || {};
      var message = shortString(messages[locale], 200) || shortString(messages.en, 200) || shortString(result.message, 200);
      if (message) entry.message = message;
    }
    var version = shortString(result.version, 64);
    if (version) entry.version = version;
    if (entry.available && models && models.length) entry.models = models;
    if (entry.available && modes && modes.length) {
      entry.modes = modes;
      if (defaultMode) entry.defaultMode = defaultMode;
    }
    return entry;
  }

  function publish(result) {
    return fetch('/harnesses', {
      method: 'PUT',
      body: JSON.stringify({ harnesses: [harnessEntry(result)] }),
    }).then(function (response) {
      if (response.ok) return { status: 'published' };
      // Older Cindy: no /harnesses endpoint, the request falls through to static files.
      if (response.status === 404 || response.status === 405 || response.status === 501) {
        return { status: 'unsupported', httpStatus: response.status };
      }
      // This Cindy knows the endpoint but has not enabled the harnesses declaration
      // for this install (not approved yet, or the field is not recognized).
      if (response.status === 403) return { status: 'not-enabled', httpStatus: 403 };
      return { status: 'failed', httpStatus: response.status };
    }, function () {
      return { status: 'failed' };
    });
  }

  var CUSTOM_PATH_ERRORS = ['busy', 'not-absolute', 'not-found', 'not-executable', 'not-runnable', 'unsafe-path', 'write-failed'];

  function sanitizeResult(raw) {
    var result = {
      available: raw.available === true,
      path: shortString(raw.path, 1024),
      customPath: shortString(raw.customPath, 1024),
      customPathConfigured: raw.customPathConfigured === true,
      version: shortString(raw.version, 64),
    };
    if (!result.available) {
      result.reason = raw.reason === 'not-runnable'
        ? 'not-runnable'
        : raw.reason === 'custom-path-unavailable'
          ? 'custom-path-unavailable'
          : 'not-installed';
      result.message = shortString(raw.message, 200);
      result.messages = raw.messages && typeof raw.messages === 'object'
        ? { 'zh-CN': shortString(raw.messages['zh-CN'], 200), en: shortString(raw.messages.en, 200) }
        : undefined;
      result.detail = shortString(raw.detail, 300);
    }
    return result;
  }

  function accountView() {
    return {
      signedIn: account.signedIn,
      tier: account.tier || undefined,
      canSignIn: account.canSignIn,
      canSignOut: account.canSignOut,
      busy: accountOp,
    };
  }

  function announceAccount() {
    if (channel) channel.postMessage({ type: 'account-changed', account: accountView() });
  }

  /** Records the default agy login's state for the plugin settings page. */
  function applySignedIn(signedIn, tier) {
    account.signedIn = signedIn;
    accountSeenAt = Date.now();
    var name = tier && typeof tier === 'object' ? shortString(tier.name, 200) : undefined;
    if (!signedIn) account.tier = null;
    else if (name) account.tier = name;
    var changed = signInRequired !== !signedIn;
    signInRequired = !signedIn;
    if (!signedIn) clearUsage();
    else if (changed) void refreshUsage();
    return Promise.resolve();
  }

  function snapshot() {
    return {
      ok: lastError === null && lastResult !== null,
      result: lastResult,
      signInRequired: signInRequired,
      account: accountView(),
      publish: lastPublish,
      error: lastError,
      checkedAt: lastCheckedAt,
      generation: pathGeneration,
    };
  }

  function detect() {
    if (inflight) return inflight;
    var gen = pathGeneration;
    var run = Promise.resolve()
      .then(function () {
        return cindy.node.request({ method: 'detect', params: { locale: locale }, timeoutMs: DETECT_TIMEOUT_MS });
      })
      .catch(function (error) {
        return { ok: false, message: String((error && error.message) || error) };
      })
      .then(function (response) {
        if (gen !== pathGeneration) return snapshot();
        lastCheckedAt = Date.now();
        if (!response || response.ok !== true || !response.result || typeof response.result !== 'object') {
          // Detection itself failed (e.g. the Node runtime is unavailable). Publish
          // nothing: Cindy keeps the last state or "unknown" instead of a wrong answer.
          lastError = shortString(response && (response.message || response.errorCode), 300) || 'detect failed';
          return snapshot();
        }
        lastError = null;
        lastResult = sanitizeResult(response.result);
        if (!lastResult.available) clearUsage();
        else if (usageWanted) void refreshUsage();
        return publish(lastResult).then(function (published) {
          if (gen !== pathGeneration) return snapshot();
          lastPublish = published;
          return snapshot();
        });
      })
      .then(function (value) {
        if (inflight === run) inflight = null;
        return value;
      }, function (error) {
        if (inflight === run) inflight = null;
        if (gen === pathGeneration) lastError = String((error && error.message) || error);
        return snapshot();
      });
    inflight = run;
    return run;
  }

  function runSetCustomPath(rawPath) {
    if (cliState.active && cliState.action !== 'check') {
      return Promise.resolve({ ok: false, error: 'busy' });
    }
    return Promise.resolve()
      .then(function () {
        return cindy.node.request({
          method: 'setCustomPath',
          params: { path: rawPath, locale: locale },
          timeoutMs: DETECT_TIMEOUT_MS,
        });
      })
      .catch(function (error) {
        return { ok: false, message: String((error && error.message) || error) };
      })
      .then(function (response) {
        if (!response || response.ok !== true || !response.result || typeof response.result !== 'object') {
          return {
            ok: false,
            error: 'failed',
            detail: shortString(response && (response.message || response.errorCode), 300),
          };
        }
        if (response.result.ok !== true || !response.result.detection || typeof response.result.detection !== 'object') {
          var code = CUSTOM_PATH_ERRORS.indexOf(response.result.error) !== -1 ? response.result.error : 'failed';
          var out = { ok: false, error: code };
          var detail = shortString(response.result.detail, 300);
          if (detail) out.detail = detail;
          return out;
        }
        // Invalidate every in-flight detect / model-list / account action from the previous executable.
        var hadLogin = accountOp === 'login';
        pathGeneration += 1;
        inflight = null;
        modelsInflight = null;
        accountCheck = null;
        accountOp = null;
        accountOpToken = null;
        models = null;
        modes = null;
        defaultMode = null;
        modelsListedAt = 0;
        modelSessionId = null;
        signInRequired = false;
        account = { signedIn: null, tier: null, canSignIn: true, canSignOut: true };
        accountSeenAt = 0;
        accountActionAt = Date.now();
        lastCheckedAt = Date.now();
        lastError = null;
        lastResult = sanitizeResult(response.result.detection);
        clearUsage();
        saveState();
        if (hadLogin) void nodeCall('cancelLogin', { timeoutMs: 10000 });
        if (!cliState.active) {
          cliState = {};
          cliProgress = null;
          announceCliState();
        }
        announceAccount();
        if (lastResult.available) void refreshUsage();
        var gen = pathGeneration;
        return publish(lastResult).then(function (published) {
          if (gen === pathGeneration) lastPublish = published;
          return { ok: true, snapshot: snapshot() };
        });
      });
  }

  function setCustomPath(rawPath) {
    if (typeof rawPath !== 'string') return Promise.resolve({ ok: false, error: 'not-absolute' });
    customPathPending += 1;
    var run = customPathQueue.then(function () { return runSetCustomPath(rawPath); });
    customPathQueue = run.catch(function () {});
    return run.then(function (value) {
      customPathPending -= 1;
      return value;
    }, function (error) {
      customPathPending -= 1;
      throw error;
    });
  }

  /**
   * Reads agy's models and modes (agy-models.js) and republishes the engine status when they or the
   * sign-in state changed. mode: 'force' (settings "Check again" after a sign-in hint), 'if-stale'
   * (Cindy's picker refresh; at most once a minute here, Cindy itself waits 10 minutes per plugin),
   * 'if-missing' (start-up: only when no list was saved). Only while agy is detected as available.
   */
  function refreshModels(mode) {
    if (!lastResult || !lastResult.available) return Promise.resolve();
    if (modelsInflight) return modelsInflight;
    if (mode === 'if-missing' && models && models.length) return Promise.resolve();
    if (mode === 'if-stale' && models && Date.now() - modelsListedAt < MODELS_MIN_INTERVAL_MS) return Promise.resolve();
    var startedAt = Date.now();
    var gen = pathGeneration;
    var run = Promise.resolve()
      .then(function () {
        return cindy.node.request({
          method: 'listModels',
          params: modelSessionId ? { sessionId: modelSessionId } : {},
          timeoutMs: MODELS_TIMEOUT_MS,
        });
      })
      .then(function (response) {
        if (gen !== pathGeneration) return undefined;
        var result = response && response.ok === true ? response.result : null;
        // A sign-in or sign-out made while this listing ran is newer than what the listing saw.
        var fresh = accountActionAt < startedAt;
        if (result && result.supported === false && result.reason === 'not-signed-in') {
          return fresh ? applySignedIn(false).then(announceAccount) : undefined;
        }
        if (!result || result.supported !== true || !Array.isArray(result.models)) return undefined;
        var next = sanitizeModels(result.models);
        var nextModes = sanitizeModes(result.modes);
        var nextDefault = nextModes.indexOf(result.defaultMode) !== -1 ? result.defaultMode : null;
        var changed = (fresh && !result.defaultSignedOut && signInRequired)
          || JSON.stringify(next) !== JSON.stringify(models || [])
          || JSON.stringify(nextModes) !== JSON.stringify(modes || [])
          || nextDefault !== defaultMode;
        if (fresh) {
          if (result.defaultSignedOut === true) {
            signInRequired = true;
            account.signedIn = false;
            account.tier = null;
            accountSeenAt = Date.now();
          } else {
            signInRequired = false;
            account.signedIn = true;
            accountSeenAt = Date.now();
            if (result.tier && shortString(result.tier.name, 200)) account.tier = shortString(result.tier.name, 200);
          }
          announceAccount();
        }
        models = next;
        modes = nextModes;
        defaultMode = nextDefault;
        modelsListedAt = Date.now();
        if (!result.defaultSignedOut && typeof result.sessionId === 'string') {
          modelSessionId = result.sessionId.slice(0, 128);
        }
        saveState();
        if (!changed || !lastResult) return undefined;
        return publish(lastResult).then(function (published) {
          if (gen === pathGeneration) lastPublish = published;
        });
      })
      .catch(function () { /* keep the previous list */ })
      .then(function () { if (modelsInflight === run) modelsInflight = null; });
    modelsInflight = run;
    return run;
  }

  /** cindy.node.request -> the worker's result, or null when the request itself failed. */
  function nodeCall(method, request) {
    return Promise.resolve()
      .then(function () { return cindy.node.request(Object.assign({ method: method, params: {} }, request)); })
      .then(function (response) {
        return response && response.ok === true && response.result && typeof response.result === 'object' ? response.result : null;
      }, function () { return null; });
  }

  function failure(result) {
    var outcome = { error: result && ACCOUNT_ERRORS.indexOf(result.error) !== -1 ? result.error : 'failed' };
    var detail = result && shortString(result.detail, 300);
    if (detail) outcome.detail = detail;
    return outcome;
  }

  /** Asks agy whether it is signed in (settings page opened or "Check again"); never while signing in / out. */
  function checkAccount() {
    if (accountOp) return Promise.resolve({});
    if (accountCheck) return accountCheck;
    if (!lastResult || !lastResult.available) return Promise.resolve({});
    var startedAt = Date.now();
    var gen = pathGeneration;
    // After a model listing (it resumes the same agy session): a listing that just finished already
    // told us whether agy is signed in.
    var run = Promise.resolve(modelsInflight)
      .then(function () {
        if (gen !== pathGeneration) return { stale: true };
        if (account.signedIn !== null && Date.now() - accountSeenAt < ACCOUNT_FRESH_MS) return { fresh: true };
        return nodeCall('account', { params: modelSessionId ? { sessionId: modelSessionId } : {}, timeoutMs: ACCOUNT_TIMEOUT_MS });
      })
      .then(function (result) {
        if (gen !== pathGeneration || (result && (result.fresh || result.stale))) return {};
        if (!result || result.supported !== true || typeof result.signedIn !== 'boolean') return failure(null);
        if (accountActionAt >= startedAt) return {};
        account.canSignIn = result.canSignIn !== false;
        account.canSignOut = result.canSignOut !== false;
        return applySignedIn(result.signedIn, result.tier).then(function () { return {}; });
      })
      .then(function (outcome) {
        if (accountCheck === run) accountCheck = null;
        if (gen === pathGeneration) announceAccount();
        return outcome;
      });
    accountCheck = run;
    return run;
  }

  /** agy's Google sign-in (agy opens the browser); then the models are read again. */
  function runLogin() {
    // A path save is swapping the executable this request would reach: refuse until it has answered.
    if (accountOp || customPathPending > 0) return Promise.resolve({ error: 'busy' });
    var gen = pathGeneration;
    var token = {};
    accountOp = 'login';
    accountOpToken = token;
    announceAccount();
    return nodeCall('login', { timeoutMs: LOGIN_SILENCE_MS, maxTotalMs: LOGIN_MAX_TOTAL_MS })
      .then(function (result) {
        if (gen !== pathGeneration) return { error: 'cancelled', stale: true };
        if (!result || result.ok !== true) return failure(result);
        accountActionAt = Date.now();
        return applySignedIn(true, result.tier).then(function () {
          if (gen !== pathGeneration) return { error: 'cancelled', stale: true };
          // Read the models again for the signed-in account, after any listing still running.
          Promise.resolve(modelsInflight).then(function () {
            if (gen === pathGeneration) return refreshModels('force');
          });
          return {};
        });
      })
      .then(function (outcome) {
        if (accountOpToken === token) {
          accountOp = null;
          accountOpToken = null;
        }
        if (gen === pathGeneration) announceAccount();
        return outcome && outcome.stale ? { error: 'cancelled' } : outcome;
      });
  }

  function runCancel() {
    if (accountOp !== 'login') return Promise.resolve({});
    return nodeCall('cancelLogin', { timeoutMs: 10000 }).then(function () { return {}; });
  }

  /** Signs agy out; the settings page sends this only after the user confirmed. */
  function runLogout() {
    // The account on screen belongs to the executable being replaced; never sign out the new one by mistake.
    if (accountOp || customPathPending > 0) return Promise.resolve({ error: 'busy' });
    var gen = pathGeneration;
    var token = {};
    accountOp = 'logout';
    accountOpToken = token;
    announceAccount();
    return nodeCall('logout', { timeoutMs: ACCOUNT_TIMEOUT_MS })
      .then(function (result) {
        if (gen !== pathGeneration) return { error: 'cancelled', stale: true };
        if (!result || result.ok !== true) return failure(result);
        accountActionAt = Date.now();
        return applySignedIn(false).then(function () { return {}; });
      })
      .then(function (outcome) {
        if (accountOpToken === token) {
          accountOp = null;
          accountOpToken = null;
        }
        if (gen === pathGeneration) announceAccount();
        return outcome && outcome.stale ? { error: 'cancelled' } : outcome;
      });
  }

  var ACCOUNT_OPS = { status: checkAccount, login: runLogin, cancel: runCancel, logout: runLogout };

  function remember(reqId) {
    if (seenRequests.indexOf(reqId) !== -1) return false;
    seenRequests.push(reqId);
    if (seenRequests.length > MAX_REMEMBERED_REQUESTS) seenRequests.shift();
    return true;
  }

  // CLI install / update. The worker reports steps, byte counts and cleaned installer output as
  // `cli-progress` notifications; only the fields checked below reach the settings page. The
  // last install log stays here (memory only) so reopening settings shows it again.
  const CLI_STEPS = ['resolve', 'node', 'npm', 'download', 'extract', 'signature', 'probe', 'activate',
    'wizard', 'native', 'confirm'];
  const CLI_NOTES = ['versions', 'node', 'downloaded', 'probe', 'done', 'current', 'failed'];
  const CLI_LOG_LIMIT = 300;
  const cliRequests = new Set();
  let cliState = {};
  let cliProgress = null;
  let cliAnnounceTimer;
  function announceCliState() {
    clearTimeout(cliAnnounceTimer);
    cliAnnounceTimer = undefined;
    if (!channel) return;
    let progress;
    if (cliProgress) {
      const { startedAt, endedAt, rateAt, rateFrom, ...rest } = cliProgress;
      progress = { ...rest, log: cliProgress.log.slice(), elapsedMs: (endedAt || Date.now()) - startedAt };
    }
    channel.postMessage({ type: 'cli-state', ...cliState, ...(progress ? { progress } : {}) });
  }
  function announceCliStateSoon() {
    cliAnnounceTimer ??= setTimeout(announceCliState, 250);
  }
  const cliCount = value => (Number.isSafeInteger(value) && value >= 0 ? value : undefined);
  function cliVars(vars) {
    const clean = {};
    for (const key of ['version', 'latest', 'current', 'size', 'code']) {
      const value = vars?.[key];
      if (typeof value === 'string' && value.length <= 64) clean[key] = value;
      else if (cliCount(value) !== undefined) clean[key] = value;
    }
    return clean;
  }
  function addCliLog(entry) {
    cliProgress.log.push({ at: Date.now() - cliProgress.startedAt, ...entry });
    if (cliProgress.log.length > CLI_LOG_LIMIT) {
      cliProgress.log.shift();
      cliProgress.dropped = (cliProgress.dropped || 0) + 1;
    }
  }
  function applyCliProgress(params) {
    if (!cliProgress || params?.op !== cliProgress.reqId || !Array.isArray(params.events)) return;
    // A late batch can arrive after the result: keep its log lines, not its step or bytes.
    const running = cliState.active && cliState.reqId === cliProgress.reqId;
    for (const event of params.events.slice(0, 200)) {
      if (!event || typeof event !== 'object') continue;
      if (CLI_STEPS.includes(event.step)) {
        if (!running) continue;
        Object.assign(cliProgress, { step: event.step, index: cliCount(event.index), count: cliCount(event.count),
          loaded: undefined, total: undefined, speed: undefined, rateAt: undefined, rateFrom: undefined });
      } else if (cliCount(event.loaded) !== undefined) {
        if (!running) continue;
        // Speed over at least half a second, smoothed, so it does not jump with each batch.
        const now = Date.now();
        if (!cliProgress.rateAt || event.loaded < cliProgress.rateFrom) {
          Object.assign(cliProgress, { rateAt: now, rateFrom: event.loaded, speed: undefined });
        } else if (now - cliProgress.rateAt >= 500) {
          const rate = (event.loaded - cliProgress.rateFrom) * 1000 / (now - cliProgress.rateAt);
          cliProgress.speed = Math.round(cliProgress.speed === undefined ? rate : cliProgress.speed * 0.6 + rate * 0.4);
          Object.assign(cliProgress, { rateAt: now, rateFrom: event.loaded });
        }
        cliProgress.loaded = event.loaded;
        cliProgress.total = cliCount(event.total) || undefined;
      } else if (CLI_NOTES.includes(event.note)) {
        addCliLog({ note: event.note, vars: cliVars(event.vars) });
      } else if (typeof event.log === 'string' && event.log) {
        addCliLog({ text: event.log.slice(0, 240) });
      }
    }
    announceCliStateSoon();
  }
  // Only this plugin's install progress; other worker notifications (e.g. sign-in links) pass through.
  function handleCliProgress(message) {
    if (message?.type !== 'event' || message.name !== 'node-notification' || message.method !== 'cli-progress') return false;
    applyCliProgress(message.params);
    return true;
  }
  function handleCliMaintenance(data) {
    if (data?.type === 'cli-state-request') {
      announceCliState();
      return true;
    }
    if (data?.type !== 'cli-maintenance') return false;
    if (typeof data.reqId !== 'string' || data.reqId.length > 64 ||
        !['check', 'install', 'update'].includes(data.action)) return true;
    const { reqId, action } = data;
    if (cliState.active || cliRequests.has(reqId)) {
      announceCliState();
      return true;
    }
    if (action !== 'check' && customPathPending > 0) {
      if (channel) channel.postMessage({ type: 'cli-state', reqId, action, result: { error: 'busy' } });
      return true;
    }
    cliRequests.add(reqId);
    if (cliRequests.size > 64) cliRequests.delete(cliRequests.values().next().value);
    const version = typeof data.version === 'string' ? data.version.slice(0, 64) : undefined;
    const gen = pathGeneration;
    cliState = { active: true, reqId, action };
    if (action !== 'check') cliProgress = { reqId, action, startedAt: Date.now(), log: [] };
    announceCliState();
    void (async () => {
      let result;
      try {
        const response = await cindy.node.request({
          method: 'cliMaintenance', params: { action, version, op: reqId },
          timeoutMs: action === 'check' ? 50000 : 60000,
          ...(action === 'check' ? {} : { maxTotalMs: 840000 }),
        });
        if (response?.ok) result = response.result;
        if (gen !== pathGeneration) {
          cliState = {};
          if (action !== 'check' && cliProgress?.reqId === reqId) cliProgress = null;
          announceCliState();
          return;
        }
        if (result?.state === 'installed') void detect();
      } catch { /* The install log already holds what the installer printed. */ }
      if (gen !== pathGeneration) {
        cliState = {};
        if (action !== 'check' && cliProgress?.reqId === reqId) cliProgress = null;
        announceCliState();
        return;
      }
      cliState = { reqId, action, result: result || { error: 'operation' } };
      if (action !== 'check' && cliProgress?.reqId === reqId) {
        const outcome = cliState.result;
        if (outcome.state === 'installed') addCliLog({ note: 'done', vars: cliVars({ version: outcome.version }) });
        else if (outcome.state === 'current') addCliLog({ note: 'current', vars: cliVars({ version: outcome.version }) });
        else if (outcome.error) addCliLog({ note: 'failed', vars: cliVars({ code: outcome.error }) });
        cliProgress.endedAt = Date.now();
      }
      announceCliState();
    })();
    return true;
  }
  if (channel) {
    channel.onmessage = function (event) {
      var data = event && event.data;
      if (handleCliMaintenance(data)) return;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'harness-usage-request') {
        announceUsage(usageAvailable() && !usage && (!usageCheck || !!usagePending));
        void refreshUsage();
        return;
      }
      if (typeof data.reqId !== 'string' || data.reqId.length > 64) return;
      if (data.type === 'detect-request') {
        channel.postMessage({ type: 'detect-ack', reqId: data.reqId });
        if (!remember(data.reqId)) return;
        detect().then(function (result) {
          channel.postMessage({ type: 'detect-result', reqId: data.reqId, snapshot: result });
          // "Check again" / settings opened: also re-read the model list (in the background),
          // at most once a minute so reopening the page does not keep starting agy; right away
          // while a sign-in hint is shown, so signing in and checking again clears it.
          refreshModels(signInRequired ? 'force' : 'if-stale').then(function () {
            if (signInRequired !== result.signInRequired) {
              channel.postMessage({ type: 'detect-result', reqId: data.reqId, snapshot: snapshot() });
            }
          });
        });
        return;
      }
      if (data.type === 'custom-path-request') {
        channel.postMessage({ type: 'custom-path-ack', reqId: data.reqId });
        if (!remember(data.reqId)) return;
        setCustomPath(data.path).then(function (outcome) {
          var message = { type: 'custom-path-result', reqId: data.reqId, ok: outcome.ok === true };
          if (outcome.snapshot) message.snapshot = outcome.snapshot;
          if (outcome.error) message.error = outcome.error;
          if (outcome.detail) message.detail = outcome.detail;
          channel.postMessage(message);
          if (outcome.ok && lastResult && lastResult.available) {
            var gen = pathGeneration;
            refreshModels('force').then(function () {
              if (gen === pathGeneration && outcome.snapshot && signInRequired !== outcome.snapshot.signInRequired) {
                channel.postMessage({ type: 'detect-result', reqId: data.reqId, snapshot: snapshot() });
              }
            });
          }
        });
        return;
      }
      if (data.type === 'account-request' && Object.prototype.hasOwnProperty.call(ACCOUNT_OPS, data.op)) {
        channel.postMessage({ type: 'account-ack', reqId: data.reqId });
        if (!remember(data.reqId)) return;
        // The page asked about the account of an executable that has since been replaced: never act on the new one.
        var stale = (data.op === 'login' || data.op === 'logout') && typeof data.generation === 'number' && data.generation !== pathGeneration;
        (stale ? Promise.resolve({ error: 'stale' }) : ACCOUNT_OPS[data.op]()).then(function (outcome) {
          var message = { type: 'account-result', reqId: data.reqId, op: data.op, account: accountView() };
          if (outcome && outcome.error) message.error = outcome.error;
          if (outcome && outcome.detail) message.detail = outcome.detail;
          channel.postMessage(message);
        });
      }
    };
  }

  cindy.onHostMessage(function (message) {
    if (handleCliProgress(message)) return;
    if (message && message.type === 'event' && message.name === 'node-notification' && message.method === 'account-ready') {
      stateLoaded.then(function () {
        if (lastResult && lastResult.available && (!models || !models.length)) return refreshModels('force');
      });
      return;
    }
    // Cindy opened a model picker (its provider-style refresh, with its own cooldown).
    if (message && message.type === 'harnesses-refresh-requested') {
      stateLoaded.then(detect).then(function () { return refreshModels('if-stale'); });
      return;
    }
    if (!message || message.type !== 'host-context-changed' || !message.context) return;
    var next = pickLocale(message.context);
    if (channel) channel.postMessage({ type: 'locale-changed' });
    if (next === locale) return;
    locale = next;
    // Republish so the install hint or account method label follows Cindy's language; no new detection needed.
    if (lastResult) {
      publish(lastResult).then(function (published) { lastPublish = published; });
    }
  });

  // Restore the saved probe session before publishing the engine so its first account read can use it.
  function shareModelSession() {
    if (!modelSessionId) return;
    return nodeCall('adoptModelSession', { params: { sessionId: modelSessionId }, timeoutMs: 10000 });
  }

  // Start-up: republish with the saved model list; list from agy only when none was saved yet.
  stateLoaded
    .then(refreshLocale)
    .then(shareModelSession)
    .then(detect)
    .then(function () { return refreshModels('if-missing'); });
})();
