'use strict';

const { resolveAgy, spawnAgy, SESSION_SETTINGS, killTree } = require('./resolve-agy.js');

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

/** agy's /usage command is answered by the CLI itself, outside a model turn. */
function usageFromReport(report) {
  if (report?.status !== 'SUCCESS' || report.command?.name !== 'usage' || report.num_turns !== 0) return null;
  const groups = report.command.data?.groups;
  if (!Array.isArray(groups)) return null;
  const windows = [];
  for (const group of groups) {
    if (typeof group?.name !== 'string' || !Array.isArray(group.buckets)) continue;
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
        ...(Number.isFinite(resetsAt) && resetsAt > 0 ? { resetsAt } : {}),
        ...(windowMinutes ? { windowMinutes } : {}) });
      if (windows.length === 24) break;
    }
    if (windows.length === 24) break;
  }
  return windows.length ? { updatedAt: Date.now(), windows } : null;
}

async function readUsage(options) {
  const executable = resolveAgy(options);
  if (!executable) return null;
  // The Windows updater can open a terminal of its own even when agy is hidden.
  const env = options?.env ?? process.env;
  const usageEnv = (options?.platform ?? process.platform) === 'win32'
    ? { ...env, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' }
    : env;
  const child = spawnAgy(executable, ['--settings', SESSION_SETTINGS, '--output-format', 'json', '--print', '/usage'],
    { ...options, env: usageEnv, stdio: ['ignore', 'pipe', 'ignore'] });
  const chunks = [];
  let length = 0;
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
    });
    return code === 0 && length <= 128 * 1024 ? usageFromReport(JSON.parse(Buffer.concat(chunks).toString('utf8'))) : null;
  } finally {
    clearTimeout(timer);
    process.removeListener('exit', stop);
  }
}

module.exports = { readUsage, usageFromReport, windowMinutesOf };
