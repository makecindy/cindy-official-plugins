'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { run } = require('./cli-maintenance.cjs');

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const bootId = /^(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|[0-9]{16,20})$/i;

async function readBootId() {
  if (process.platform === 'linux') return (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  if (process.platform === 'darwin') return (await run('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { timeout: 3000 })).stdout.trim();
  if (process.platform === 'win32' && process.env.SystemRoot) {
    const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args = ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks'];
    return (await run(shell, args, { timeout: 5000 })).stdout.trim();
  }
  return '';
}

async function installIds(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter(entry => entry.isDirectory() && uuid.test(entry.name)).map(entry => entry.name);
}

// Each updater publishes a fresh UUID exactly once. When current.json still
// comes from a previous boot, only its current ID could have started a task
// this boot. Every other UUID seen before that activation is safe to retire.
// A second installer may already be staging a new UUID; it is outside that list.
async function pruneRetired(root, getBoot = readBootId) {
  const active = JSON.parse(await fs.readFile(path.join(root, 'current.json'), 'utf8'));
  if (!uuid.test(active.id) || !bootId.test(active.boot) || !Array.isArray(active.older) || !active.older.length) return;
  const boot = await getBoot();
  if (!bootId.test(boot) || boot === active.boot) return;
  const older = new Set(active.older);
  for (const id of await installIds(root)) {
    if (id === active.id || !older.has(id)) continue;
    const dir = path.join(root, id);
    try {
      const manifest = path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
      if (JSON.parse(await fs.readFile(manifest, 'utf8')).name === '@deepseek-ai/dsh') {
        await fs.rm(dir, { recursive: true, force: true });
      }
    } catch { /* A later check may retry files temporarily in use. */ }
  }
}

module.exports = { installIds, pruneRetired, readBootId };
