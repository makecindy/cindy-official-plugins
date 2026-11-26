/* CLI maintenance controls shared by the plugin's local settings pages. */
window.createCliMaintenance = function (channel, refresh, refreshId) {
  const root = document.getElementById('cli-maintenance');
  const action = document.getElementById('cli-action');
  const status = document.getElementById('cli-status');
  const refreshButton = document.getElementById(refreshId);
  const meter = {
    box: document.getElementById('cli-progress'),
    step: document.getElementById('cli-progress-step'),
    percent: document.getElementById('cli-progress-percent'),
    bar: document.getElementById('cli-progress-bar'),
    fill: document.getElementById('cli-progress-fill'),
    detail: document.getElementById('cli-progress-detail'),
    rate: document.getElementById('cli-progress-rate'),
    log: document.getElementById('cli-log'),
    logTitle: document.getElementById('cli-log-title'),
    logLines: document.getElementById('cli-log-lines'),
  };
  const strings = {
    'zh-CN': {
      install: '从官方安装', check: '检测 CLI 版本和更新', update: '更新到 {version}', installing: '正在安装…',
      updating: '正在更新…', checking: '正在检查更新…', installed: '已安装 {version}',
      current: '已是最新版本', newer: '官方版本 {version} 可用', unknown: '官方版本 {version}，无法比较本机版本。',
      missing: '本机尚未安装。', source: '无法连接官方发布源，请稍后重试。',
      integrity: '下载文件校验失败，请重试。', unsupported: '官方源不提供适用于这台电脑的安装包。',
      busy: '操作正在另一处进行，请稍后重试。', verify: '安装后仍未检测到目标版本，请重新检测。',
      operation: '安装或更新未完成，请重试。', 'node-required': '请先安装 Node.js 24.9 或更高版本（含 npm），再重试。',
      timeout: '未收到操作结果，请先重新检测。',
      steps: {
        resolve: '获取官方最新版本', node: '检查 Node.js 和 npm', npm: '从 npm 下载并安装', download: '下载安装包',
        extract: '解压安装包', signature: '检查应用签名', probe: '检查新版本能否运行', activate: '启用新版本',
        wizard: '等待安装向导完成', native: '运行 CLI 自带的更新', confirm: '确认安装结果',
      },
      stepOf: '第 {index}/{count} 步 · {step}',
      notes: {
        versions: '官方最新版本 {latest}，本机版本 {current}', versionsMissing: '官方最新版本 {latest}，本机尚未安装',
        node: '使用 Node.js {version}', downloaded: '已下载 {size}，校验通过', probe: '新版本 {version} 可以运行',
        done: '已安装 {version}', current: '本机已是最新版本 {version}', failed: '未完成：{message}',
      },
      bytes: '已下载 {loaded} / {total}', bytesUnknown: '已下载 {loaded}', eta: '剩余 {time}', elapsed: '已用 {time}',
      log: '安装日志', logCount: '安装日志（{count} 行）', logRecent: '安装日志（最近 {count} 行）',
    },
    en: {
      install: 'Install from official source', check: 'Check CLI version and updates', update: 'Update to {version}', installing: 'Installing…',
      updating: 'Updating…', checking: 'Checking for updates…', installed: 'Installed {version}',
      current: 'Up to date', newer: 'Official version {version} is available', unknown: 'Official version: {version}. Could not compare the installed version.',
      missing: 'Not installed on this computer.', source: 'Could not reach the official release source. Try again.',
      integrity: 'The download failed verification. Try again.', unsupported: 'The official source has no installer for this computer.',
      busy: 'An operation is already running. Try again later.', verify: 'The expected version was not detected after installation. Check again.',
      operation: 'Installation or update did not finish. Try again.', 'node-required': 'Install Node.js 24.9 or later with npm, then try again.',
      timeout: 'No result was received. Check the local CLI again.',
      steps: {
        resolve: 'Getting the latest official version', node: 'Checking Node.js and npm', npm: 'Downloading and installing from npm',
        download: 'Downloading the package', extract: 'Extracting the package', signature: 'Checking the app signature',
        probe: 'Checking that the new version runs', activate: 'Switching to the new version',
        wizard: 'Waiting for the installer to finish', native: 'Running the CLI’s own updater', confirm: 'Confirming the installation',
      },
      stepOf: 'Step {index} of {count} · {step}',
      notes: {
        versions: 'Latest official version {latest}; installed {current}', versionsMissing: 'Latest official version {latest}; not installed yet',
        node: 'Using Node.js {version}', downloaded: 'Downloaded {size} and verified it', probe: 'New version {version} runs',
        done: 'Installed {version}', current: 'Already up to date ({version})', failed: 'Did not finish: {message}',
      },
      bytes: '{loaded} of {total}', bytesUnknown: '{loaded} downloaded', eta: '{time} left', elapsed: '{time} elapsed',
      log: 'Install log', logCount: 'Install log ({count} lines)', logRecent: 'Install log (last {count} lines)',
    },
  };
  let local = null;
  let locale = 'en';
  let result;
  let pending;
  let synchronized = false;
  let settledRequest;
  let retry;
  let timer;
  let detecting = true;
  let detected = false;
  let checkRequested = true;
  let progress = null;
  let progressAt = 0;
  let ticker;
  let shownLog = '';

  const fill = (template, values) => template.replace(/\{(\w+)\}/g, (match, key) => (values[key] ?? match));

  function formatBytes(bytes) {
    if (!(bytes > 0)) return '0 KB';
    const units = [[1024 * 1024 * 1024, 'GB'], [1024 * 1024, 'MB'], [1024, 'KB']];
    for (const [size, unit] of units) {
      const value = bytes / size;
      if (value >= 1 || unit === 'KB') return (value >= 10 ? Math.round(value) : Math.max(value, 0.1).toFixed(1)) + ' ' + unit;
    }
  }
  function formatClock(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function formatEta(seconds) {
    const total = Math.max(1, Math.round(seconds));
    const parts = total >= 3600 ? [[Math.floor(total / 3600), 'hour'], [Math.round((total % 3600) / 60), 'minute']] :
      total >= 600 ? [[Math.round(total / 60), 'minute']] :
        total >= 60 ? [[Math.floor(total / 60), 'minute'], [total % 60, 'second']] : [[total, 'second']];
    return parts.filter(([value], index) => index === 0 || value > 0)
      .map(([value, unit]) => new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value))
      .join(' ');
  }
  function noteText(entry) {
    const text = strings[locale];
    const vars = { ...entry.vars };
    if (entry.note === 'downloaded') vars.size = formatBytes(vars.size);
    if (entry.note === 'failed') vars.message = text[vars.code] || text.operation;
    const key = entry.note === 'versions' && !vars.current ? 'versionsMissing' : entry.note;
    return fill(text.notes[key] || '', vars);
  }
  const entryText = entry => (entry.note ? noteText(entry) : entry.text || '');

  function renderProgress() {
    if (!meter.box) return;
    const text = strings[locale];
    const live = pending && pending.action !== 'check' && progress?.reqId === pending.reqId ? progress : null;
    meter.box.hidden = !live;
    if (live) {
      const elapsed = live.elapsedMs + (Date.now() - progressAt);
      const stepName = text.steps[live.step];
      meter.step.textContent = !stepName ? text[{ install: 'installing', update: 'updating' }[live.action]] :
        live.index && live.count ? fill(text.stepOf, { index: live.index, count: live.count, step: stepName }) : stepName;
      const sized = live.loaded !== undefined && live.total > 0;
      const percent = sized ? Math.min(99, Math.floor((live.loaded / live.total) * 100)) : null;
      meter.percent.textContent = sized ? percent + '%' : '';
      meter.bar.hidden = !sized;
      if (sized) {
        if (meter.fill.style) meter.fill.style.width = percent + '%';
        meter.bar.setAttribute('aria-valuenow', String(percent));
        meter.bar.setAttribute('aria-valuetext', fill(text.bytes, { loaded: formatBytes(live.loaded), total: formatBytes(live.total) }));
      }
      const latest = live.log[live.log.length - 1];
      meter.detail.textContent = live.loaded !== undefined ?
        fill(sized ? text.bytes : text.bytesUnknown, { loaded: formatBytes(live.loaded), total: formatBytes(live.total) }) :
        live.step === 'wizard' && text.wizardHint ? text.wizardHint : latest ? entryText(latest) : '';
      const rate = live.loaded !== undefined && live.speed > 0 ? [formatBytes(live.speed) + '/s'] : [];
      if (rate.length && sized && live.total > live.loaded) rate.push(fill(text.eta, { time: formatEta((live.total - live.loaded) / live.speed) }));
      meter.rate.textContent = rate.length ? rate.join(' · ') : fill(text.elapsed, { time: formatClock(elapsed) });
    }
    if (live && !ticker) ticker = setInterval(renderProgress, 1000);
    if (!live && ticker) ticker = void clearInterval(ticker);

    const entries = progress?.log || [];
    meter.log.hidden = !entries.length;
    if (!entries.length) return;
    meter.logTitle.textContent = fill(progress.dropped ? text.logRecent : text.logCount, { count: entries.length });
    const lines = entries.map(entry => formatClock(entry.at) + '  ' + entryText(entry)).join('\n');
    if (lines === shownLog) return;
    const box = meter.logLines;
    const pinned = !(box.scrollHeight > 0) || box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    box.textContent = shownLog = lines;
    if (pinned && box.scrollHeight > 0) box.scrollTop = box.scrollHeight;
  }

  function render() {
    const text = strings[locale];
    const missing = local?.reason === 'not-installed' || (!local && result?.state === 'missing');
    const next = missing ? 'install' : ['newer', 'unknown'].includes(result?.state) ? 'update' : 'check';
    const key = pending ? { install: 'installing', check: 'checking', update: 'updating' }[pending.action] :
      result?.error || result?.state;
    const offer = !detecting && !pending && next !== 'check';
    const message = (pending ? text[key] : key === 'missing' || key === 'newer' || (missing && !result?.error) ? '' : text[key] || '').replace('{version}', result?.version || '');
    action.dataset.action = next;
    action.textContent = text[next].replace('{version}', result?.version || '');
    action.hidden = !offer;
    action.disabled = !channel || !synchronized || detecting || !!pending;
    refreshButton.title = text.check;
    refreshButton.setAttribute('aria-label', text.check);
    refreshButton.disabled = detecting || !!pending || !synchronized || !channel;
    status.textContent = message;
    root.hidden = !offer && !message;
    renderProgress();
  }

  function sendUntilState(message) {
    const send = () => channel.postMessage(message);
    void fetch('/wake').catch(() => {});
    send();
    retry = setInterval(send, 650);
    timer = setTimeout(() => {
      clearInterval(retry);
      pending = undefined;
      synchronized = true;
      result = { error: 'timeout' };
      render();
    }, 10000);
  }

  channel?.addEventListener('message', ({ data }) => {
    if (data?.type !== 'cli-state') return;
    clearInterval(retry);
    clearTimeout(timer);
    synchronized = true;
    if (data.progress && Array.isArray(data.progress.log)) {
      progress = data.progress;
      progressAt = Date.now();
    }
    pending = data.active ? data : undefined;
    if (pending) checkRequested = false;
    if (data.reqId !== settledRequest && !data.active) {
      settledRequest = data.reqId;
      result = data.result;
      render();
      if (result?.state === 'installed' || (data.action !== 'check' && result?.state === 'current')) refresh();
    } else render();
    checkWhenReady();
  });
  function start(operation) {
    pending = { type: 'cli-maintenance', reqId: crypto.randomUUID(), action: operation, version: result?.version };
    render();
    sendUntilState(pending);
  }
  function checkWhenReady() {
    if (!checkRequested || !synchronized || detecting || pending || !detected) return;
    checkRequested = false;
    if (local.reason !== 'not-installed') start('check');
  }
  function checkAgain() {
    if (pending || !channel) return;
    checkRequested = true;
    refresh();
  }
  action.addEventListener('click', () => {
    if (!action.disabled && !action.hidden) start(action.dataset.action);
  });
  refreshButton.addEventListener('click', checkAgain);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkAgain();
  });
  if (channel) sendUntilState({ type: 'cli-state-request' });

  return function renderMaintenance(status, language, checking) {
    detecting = checking;
    detected = Boolean(status);
    if (status && local && (status.version !== local.version || status.reason !== local.reason) && result?.state !== 'installed') {
      result = undefined;
    }
    if (status) local = status;
    locale = /^zh\b/i.test(language) ? 'zh-CN' : 'en';
    render();
    checkWhenReady();
  };
};
