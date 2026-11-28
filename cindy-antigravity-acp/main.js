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
 *   page -> { type: 'http-proxy-request', reqId, proxy }   (resent until acknowledged; '' clears it)
 *   main -> { type: 'http-proxy-ack', reqId }
 *   main -> { type: 'http-proxy-result', reqId, ok, snapshot?, error? }
 *   main -> { type: 'locale-changed' }
 *
 * Accounts are managed in Cindy's Model Providers: the engine publishes agy's Google sign-in as its
 * account method and Cindy signs accounts in through the worker (see worker.js). Neither this page
 * nor the settings page signs in or out; the settings page only points to Model Providers, and
 * snapshot.signInRequired tells it that no signed-in account could list the models.
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
  var ORCHESTRATOR_MODEL_ID = /(?:^|-)orchestrator(?:$|-)/i;
  var ORCHESTRATOR_DESCRIPTIONS = {
    'zh-CN': '内置编排模式（无思考档位），建议直选模型或用 Cindy Orca',
    en: 'Built-in orchestrator (no reasoning levels); prefer direct models or Cindy Orca',
  };

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

  /**
   * agy's model list and working modes (published with the engine status, shown by Cindy like a
   * provider's models) and the plugin's one dedicated agy session used to read them. Kept in the
   * plugin's /kv so a restart republishes the last list without starting agy.
   */
  var models = null;
  var modes = null;
  var defaultMode = null;
  /** No signed-in account could list the models; the settings page then points to Model Providers. */
  var signInRequired = false;
  var modelSessionId = null;
  var modelsListedAt = 0;
  var modelsInflight = null;

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

  function isOrchestratorModel(model) {
    return Boolean(model && typeof model.id === 'string' && ORCHESTRATOR_MODEL_ID.test(model.id));
  }

  /**
   * Projects sanitized models for Cindy's picker: keeps direct models ahead of Antigravity's
   * built-in Orchestrator modes (even for older lists loaded from /kv) and attaches a localized
   * fallback description when agy itself omitted one, without mutating the cached list.
   */
  function publishedModels(list) {
    if (!Array.isArray(list) || !list.length) return [];
    var direct = [];
    var orchestrators = [];
    var hint = ORCHESTRATOR_DESCRIPTIONS[locale] || ORCHESTRATOR_DESCRIPTIONS.en;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (isOrchestratorModel(item)) {
        orchestrators.push(item.description ? item : Object.assign({}, item, { description: hint }));
      } else {
        direct.push(item);
      }
    }
    return direct.concat(orchestrators);
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
    if (entry.available && models && models.length) entry.models = publishedModels(models);
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
      httpProxy: shortString(raw.httpProxy, 256),
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

  function snapshot() {
    return {
      ok: lastError === null && lastResult !== null,
      result: lastResult,
      signInRequired: signInRequired,
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
        // Invalidate every in-flight detect / model-list from the previous executable. The worker itself
        // cancels a sign-in Cindy started for it.
        pathGeneration += 1;
        inflight = null;
        modelsInflight = null;
        models = null;
        modes = null;
        defaultMode = null;
        modelsListedAt = 0;
        modelSessionId = null;
        signInRequired = false;
        lastCheckedAt = Date.now();
        lastError = null;
        lastResult = sanitizeResult(response.result.detection);
        saveState();
        if (!cliState.active) {
          cliState = {};
          cliProgress = null;
          announceCliState();
        }
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

  var HTTP_PROXY_ERRORS = ['invalid-proxy', 'config-invalid', 'write-failed'];

  /** Saves the proxy newly started agy processes use and updates the detection result the settings pages show. */
  function setHttpProxy(rawProxy) {
    if (typeof rawProxy !== 'string') return Promise.resolve({ ok: false, error: 'invalid-proxy' });
    return nodeCall('setHttpProxy', { params: { proxy: rawProxy }, timeoutMs: 10000 }).then(function (result) {
      if (!result || result.ok !== true) {
        return { ok: false, error: result && HTTP_PROXY_ERRORS.indexOf(result.error) !== -1 ? result.error : 'failed' };
      }
      if (!lastResult) return detect().then(function (current) { return { ok: true, snapshot: current }; });
      lastResult = Object.assign({}, lastResult, { httpProxy: shortString(result.httpProxy, 256) });
      return { ok: true, snapshot: snapshot() };
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
        if (result && result.supported === false && result.reason === 'not-signed-in') {
          // No signed-in account to list with: the settings page points to Cindy's Model Providers.
          signInRequired = true;
          return undefined;
        }
        if (!result || result.supported !== true || !Array.isArray(result.models)) return undefined;
        var next = sanitizeModels(result.models);
        var nextModes = sanitizeModes(result.modes);
        var nextDefault = nextModes.indexOf(result.defaultMode) !== -1 ? result.defaultMode : null;
        var changed = JSON.stringify(next) !== JSON.stringify(models || [])
          || JSON.stringify(nextModes) !== JSON.stringify(modes || [])
          || nextDefault !== defaultMode;
        signInRequired = false;
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
      if (data.type === 'http-proxy-request') {
        channel.postMessage({ type: 'http-proxy-ack', reqId: data.reqId });
        if (!remember(data.reqId)) return;
        setHttpProxy(data.proxy).then(function (outcome) {
          var message = { type: 'http-proxy-result', reqId: data.reqId, ok: outcome.ok === true };
          if (outcome.snapshot) message.snapshot = outcome.snapshot;
          if (outcome.error) message.error = outcome.error;
          channel.postMessage(message);
        });
        return;
      }
    };
  }

  cindy.onHostMessage(function (message) {
    if (handleCliProgress(message)) return;
    if (message && message.type === 'event' && message.name === 'node-notification' && message.method === 'account-ready') {
      // An account just signed in. A listing still running may have started before that sign-in and
      // answer "not signed in", so list again once it has ended instead of joining it.
      stateLoaded.then(function () { return modelsInflight; }).then(function () {
        if (lastResult && lastResult.available && (signInRequired || !models || !models.length)) return refreshModels('force');
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
