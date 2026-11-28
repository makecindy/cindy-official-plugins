'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { configFilePath, resolveAgy, spawnAgy, SESSION_SETTINGS, killTree } = require('./resolve-agy.js');
const { accountDirProblem, hasVerifiedIsolatedSignIn } = require('./agy-account-dir.js');

const { listModels, readModelSession, rememberModelSession } = require('./agy-models.js');

const NAMED_PERIODS = { hourly: 60, daily: 1440, weekly: 10080 };
const PERIOD_UNITS = {
  m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
  h: 60, hr: 60, hrs: 60, hour: 60, hours: 60,
  d: 1440, day: 1440, days: 1440,
  w: 10080, wk: 10080, week: 10080, weeks: 10080,
};
/** Cindy accepts window lengths up to a leap year. */
const MAX_WINDOW_MINUTES = 527040;

/**
 * The length of a quota window from its period as agy reports it (`5h` → 300, `weekly` → 10080), so
 * Cindy can tell which quota resets soonest. Anything else (e.g. `monthly`, whose length varies) has none.
 */
function windowMinutesOf(period) {
  const key = period.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_PERIODS, key)) return NAMED_PERIODS[key];
  const match = /^(\d{1,6})\s*([a-z]+)$/.exec(key);
  const unit = match && Object.prototype.hasOwnProperty.call(PERIOD_UNITS, match[2]) ? PERIOD_UNITS[match[2]] : 0;
  const minutes = unit * (match ? Number(match[1]) : 0);
  return minutes >= 1 && minutes <= MAX_WINDOW_MINUTES ? minutes : undefined;
}

// agy names quota pools by family while ACP supplies the selectable IDs for this account.
const GEMINI_IDS = /^gemini-/i;
const THIRD_PARTY_IDS = /^(?:claude|gpt)-/i;

function familyForGroup(name) {
  if (/^gemini(?: models)?$/i.test(name)) return GEMINI_IDS;
  if (/^claude(?: and |\/)gpt(?: models)?$/i.test(name)) return THIRD_PARTY_IDS;
}

/** agy's /usage command is answered by the CLI itself, outside a model turn. */
function usageFromReport(report, catalog) {
  if (report?.status !== 'SUCCESS' || report.command?.name !== 'usage' || report.num_turns !== 0) return null;
  const groups = report.command.data?.groups;
  if (!Array.isArray(groups)) return null;
  const windows = [];
  for (const group of groups) {
    if (typeof group?.name !== 'string' || !Array.isArray(group.buckets)) continue;
    const family = familyForGroup(group.name.trim());
    const models = [];
    if (family && catalog) {
      for (const model of catalog) {
        const declared = familyForGroup(model.group || '');
        if ((declared ? declared === family : family.test(model.id)) && !/[\x00-\x1f\x7f-\x9f]/.test(model.id)) {
          models.push(model.id);
        }
      }
    }
    for (const bucket of group.buckets) {
      const fraction = bucket?.remaining_fraction;
      if (bucket?.disabled || typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue;
      const period = bucket.window || bucket.name;
      if (typeof period !== 'string') continue;
      const label = (group.name + ' · ' + period).trim();
      if (!label || label.length > 120 || /[\x00-\x1f\x7f]/.test(label)) continue;
      const resetsAt = Date.parse(bucket.reset_time);
      const windowMinutes = windowMinutesOf(period);
      windows.push({ label, remainingPercent: Math.round(fraction * 10000) / 100,
        ...(models.length ? { models } : {}),
        ...(Number.isFinite(resetsAt) && resetsAt > 0 ? { resetsAt } : {}),
        ...(windowMinutes ? { windowMinutes } : {}) });
      if (windows.length === 24) break;
    }
    if (windows.length === 24) break;
  }
  return windows.length ? { updatedAt: Date.now(), windows } : null;
}

function usageEnvironment(options) {
  // The Windows updater can open a terminal of its own even when agy is hidden.
  const env = options?.env ?? process.env;
  return (options?.platform ?? process.platform) === 'win32'
    ? { ...env, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' }
    : env;
}

async function readUsage(options) {
  const accountDir = options && typeof options.accountDir === 'string' && options.accountDir ? options.accountDir : undefined;
  if (accountDir && (accountDirProblem(accountDir, options) || !hasVerifiedIsolatedSignIn(accountDir, options))) return null;
  const executable = resolveAgy(options);
  if (!executable) return null;
  const launchOptions = {
    ...options,
    env: usageEnvironment(options),
    ...(accountDir ? { accountDir, accountHome: true } : {}),
    stdio: ['pipe', 'pipe', 'pipe'],
  };
  const deadline = Date.now() + 12000;
  const child = spawnAgy(executable, ['--settings', SESSION_SETTINGS, '--output-format', 'json', '--print', '/usage'], launchOptions);
  try { child.stdin.end(); } catch { /* already closed */ }
  const chunks = [];
  let length = 0;
  let stderrTail = '';
  const stop = () => killTree(child, 'SIGKILL');
  const timer = setTimeout(stop, 12000);
  process.once('exit', stop);
  try {
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
      child.stdout.on('data', chunk => {
        length += chunk.length;
        if (length > 128 * 1024) stop();
        else chunks.push(chunk);
      });
      child.stderr.on('data', chunk => {
        if (stderrTail.length < 2048) stderrTail += chunk.toString('utf8');
        if (/Authentication required/i.test(stderrTail)) stop();
      });
    });
    if (code !== 0 || length > 128 * 1024) return null;
    const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const usage = usageFromReport(report);
    if (!usage || !report.command.data.groups.some(group => typeof group?.name === 'string' && familyForGroup(group.name.trim()))) return usage;

    // Reuse the account's dedicated model-list session without switching models to probe efforts.
    const remaining = deadline - Date.now();
    if (remaining <= 0) return usage;
    let catalogTimer;
    try {
      const catalog = await listModels({ sessionId: readModelSession(options) }, {
        ...options,
        env: launchOptions.env,
        catalogOnly: true,
        onSpawn: probe => { catalogTimer = setTimeout(() => killTree(probe, 'SIGKILL'), remaining); },
      });
      if (catalog.sessionId) rememberModelSession(catalog.sessionId, options);
      return usageFromReport(report, catalog.models);
    } catch {
      return usage;
    } finally {
      clearTimeout(catalogTimer);
    }
  } finally {
    clearTimeout(timer);
    process.removeListener('exit', stop);
  }
}

// The on-demand worker may be recycled before the next poll. Store only the
// failure delay and its expiry, never the account or its usage report.
const MIN_RETRY_MS = 60_000;
const MAX_RETRY_MS = 15 * 60_000;
function retryFile() {
  const config = configFilePath();
  return config && path.join(path.dirname(config), 'usage-retry.json');
}

function loadRetry() {
  try {
    const file = retryFile();
    if (!file || fs.statSync(file).size > 256) return null;
    const { delay, until } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Number.isSafeInteger(delay) && delay >= MIN_RETRY_MS && delay <= MAX_RETRY_MS &&
        Number.isSafeInteger(until) && until <= Date.now() + MAX_RETRY_MS) return { delay, until };
  } catch { /* Missing or invalid state starts a new retry sequence. */ }
  return null;
}

let retry = loadRetry();
function setRetry(next) {
  if (!next && !retry) return;
  retry = next;
  const file = retryFile();
  if (!file) return;
  try {
    if (!next) {
      fs.rmSync(file, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = file + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
    try { fs.renameSync(tmp, file); }
    finally { fs.rmSync(tmp, { force: true }); }
  } catch { /* Keep the in-memory cooldown if local storage is unavailable. */ }
}

function defaultUsageCoolingDown() {
  return retry && Date.now() < retry.until;
}

function recordDefaultUsage(result) {
  if (result) setRetry(null);
  else {
    const delay = Math.min(MAX_RETRY_MS, retry ? retry.delay * 2 : MIN_RETRY_MS);
    setRetry({ delay, until: Date.now() + delay });
  }
}

function resetDefaultUsage() { setRetry(null); }

module.exports = { usageEnvironment, readUsage, usageFromReport, windowMinutesOf,
  defaultUsageCoolingDown, recordDefaultUsage, resetDefaultUsage };
