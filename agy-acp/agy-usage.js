'use strict';

const { resolveAgy, spawnAgy, SESSION_SETTINGS, killTree } = require('./resolve-agy.js');

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
      windows.push({ label, remainingPercent: Math.round(fraction * 10000) / 100,
        ...(Number.isFinite(resetsAt) && resetsAt > 0 ? { resetsAt } : {}) });
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

module.exports = { readUsage, usageFromReport };
