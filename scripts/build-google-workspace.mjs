#!/usr/bin/env node
// Reproducible vendoring: unmodified official gog releases, pinned SHA-256.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'scripts/google-workspace');
const lock = JSON.parse(await fs.readFile(path.join(source, 'gog-lock.json'), 'utf8'));
const plugins = { 'google-gmail': ['gmail', 'gmail_account'], 'google-drive': ['drive', 'google_drive_account'], 'google-calendar': ['calendar', 'google_calendar_account'], 'google-sheets': ['sheets', 'google_sheets_account'] };
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const binarySource = path.join(root, 'google-gmail/vendor/gog');
await fs.mkdir(binarySource, { recursive: true });
const records = {};
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cindy-gog-vendor-'));
try {
  for (const [platform, expected] of Object.entries(lock.assets)) {
    const target = path.join(binarySource, platform + '.br');
    const parts = platform.split('-');
    const filename = 'gogcli_' + lock.version + '_' + parts.join('_') + (parts[0] === 'windows' ? '.zip' : '.tar.gz');
    const response = await fetch('https://github.com/openclaw/gogcli/releases/download/v' + lock.version + '/' + filename);
    if (!response.ok) throw new Error('Download failed: ' + filename);
    const archive = Buffer.from(await response.arrayBuffer());
    if (sha(archive) !== expected) throw new Error('Release checksum mismatch: ' + filename);
    const archivePath = path.join(temp, filename);
    await fs.writeFile(archivePath, archive);
    const directory = path.join(temp, platform);
    await fs.mkdir(directory);
    if (parts[0] === 'windows') execFileSync('unzip', ['-q', archivePath, '-d', directory]);
    else execFileSync('tar', ['-xzf', archivePath, '-C', directory]);
    const binary = await fs.readFile(path.join(directory, parts[0] === 'windows' ? 'gog.exe' : 'gog'));
    const compressed = await promisify(zlib.brotliCompress)(binary, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } });
    await fs.writeFile(target, compressed);
    records[platform] = { sha256: sha(binary), compressedSha256: sha(compressed), releaseSha256: expected };
    console.log(platform + ': verified upstream v' + lock.version + ', ' + compressed.length + ' bundled bytes');
  }
  await fs.writeFile(path.join(binarySource, 'binaries.json'), JSON.stringify(records, null, 2) + '\n');
  const total = (await Promise.all(Object.keys(records).map(async (key) => (await fs.stat(path.join(binarySource, key + '.br'))).size))).reduce((a, b) => a + b, 0);
  if (total > 62 * 1024 * 1024) throw new Error('Bundled binaries exceed the existing 64 MiB package contract');
  for (const [id, [service]] of Object.entries(plugins)) {
    const destination = path.join(root, id);
    await fs.mkdir(path.join(destination, 'node'), { recursive: true });
    if (id !== 'google-gmail') await fs.cp(binarySource, path.join(destination, 'vendor/gog'), { recursive: true });
    await fs.copyFile(path.join(source, 'gog-lock.json'), path.join(destination, 'vendor/gog/release.json'));
    await fs.writeFile(path.join(destination, 'node/gog.cjs'), (await fs.readFile(path.join(source, 'worker.cjs'), 'utf8')).replaceAll('__SERVICE__', service));
  }
} finally { await fs.rm(temp, { recursive: true, force: true }); }
