import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const plugin = path.join(root, 'google-gmail');
const json = filename => JSON.parse(fs.readFileSync(path.join(plugin, filename), 'utf8'));
const declaration = json('binary-dependencies.json');
const binaries = json('vendor/gog/binaries.json');
const release = json('vendor/gog/release.json');
const tracked = execFileSync('git', ['ls-files', '-z', '--', 'google-gmail'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('Gmail declares all pinned gog assets without tracking payloads', () => {
  assert.equal(declaration.dependencies.length, 1);
  const dependency = declaration.dependencies[0];
  assert.equal(dependency.version, release.version);
  assert.equal(dependency.assets.length, 6);
  assert.equal(tracked.filter(file => file.endsWith('.br')).length, 0);
  for (const asset of dependency.assets) {
    assert.equal(asset.platforms.length, 1);
    const [platform] = asset.platforms;
    const key = platform.replace('x64', 'amd64');
    assert.equal(asset.sha256, release.assets[key]);
    assert.equal(asset.sha256, binaries[key].releaseSha256);
    assert.equal(asset.files[0].target, `vendor/gog/${key}.br`);
    assert.equal(asset.files[0].encoding, 'brotli');
  }
});

test('Gmail source → real downloads → package → native worker schema', {
  skip: process.env.CINDY_GMAIL_BINARY_SMOKE !== '1', timeout: 1_800_000,
}, async () => {
  // Snapshot the tracked working file set into an isolated test repository. No commits,
  // branches, installed plugins or user credentials in the real repo change.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-gmail-package-'));
  const fixture = path.join(directory, 'source');
  fs.mkdirSync(fixture);
  const git = (...args) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8' }).trim();
  git('init', '-q');
  const commit = () => git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Packaging Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'fixture');
  commit();
  const base = git('rev-parse', 'HEAD');
  for (const file of [...tracked, 'LICENSE', 'NOTICE', 'TRADEMARKS.md', 'TRADEMARKS.zh-CN.md']) {
    const target = path.join(fixture, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  git('add', '.'); commit();
  execFileSync('node', [path.join(root, '.github/scripts/check-source-size.mjs'), base], { cwd: fixture, stdio: 'inherit' });
  const output = path.join(directory, 'google-gmail-1.3.1.cindy');
  console.log(`Gmail smoke output: ${output}`);
  execFileSync('bash', [path.join(root, '.github/scripts/package-plugin.sh'), 'google-gmail', output], {
    cwd: fixture, stdio: 'inherit', timeout: 1_700_000,
  });
  const unzipped = path.join(directory, 'unpacked');
  execFileSync('unzip', ['-q', output, '-d', unzipped]);
  for (const [key, expected] of Object.entries(binaries)) {
    const compressed = fs.readFileSync(path.join(unzipped, 'vendor/gog', `${key}.br`));
    assert.equal(digest(compressed), expected.compressedSha256, key);
    assert.equal(digest(brotliDecompressSync(compressed)), expected.sha256, key);
  }
  const worker = spawn(process.execPath, [path.join(unzipped, 'node/gog.cjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(worker, 'close');
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => worker.kill('SIGKILL'), 30_000);
  worker.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  worker.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
    if (stdout.includes('\n')) worker.stdin.end();
  });
  worker.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'schema', params: {} }) + '\n');
  try {
    const [code] = await closed;
    assert.equal(code, 0, stderr);
    const response = JSON.parse(stdout.trim());
    assert.equal(response.result.ok, true, stdout);
    const commands = response.result.data.subcommands.map(command => command.name);
    assert.ok(commands.includes('attachment'), JSON.stringify(commands));
    assert.ok(commands.includes('send'), JSON.stringify(commands));
    const evidence = { package: output, bytes: fs.statSync(output).size, sha256: digest(fs.readFileSync(output)),
      verifiedPlatforms: Object.keys(binaries), runtimePlatform: `${process.platform}-${process.arch}`,
      gmailCommands: commands, realAccountAccessed: false };
    fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally {
    clearTimeout(timer);
    if (worker.exitCode === null) worker.kill('SIGKILL');
  }
});
