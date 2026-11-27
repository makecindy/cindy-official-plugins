import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseArgs, runGate, stateFilePath, ciRetryFilePath, ciRetryDataDir } from '../../cindy-github/skills/pr/scripts/pr-heartbeat-gate.mjs';
import { createCiRetryReceiptIO } from '../../cindy-github/skills/pr/scripts/lib/ci-retry-receipts.mjs';

const gate = fileURLToPath(new URL('../../cindy-github/skills/pr/scripts/pr-heartbeat-gate.mjs', import.meta.url));
const url = 'https://github.com/example/repo/pull/42';
const prNodeId = 'PR_exampleImmutableId';
const oldHead = 'a'.repeat(40), newHead = 'b'.repeat(40);
const failure = { workflow: '.github/workflows/verify.yml', job: 'verify', step: 'install dependencies', cause: 'package store unavailable' };

// Probe the actual file-and-directory receipt contract. OS acknowledgements
// are native I/O observations, never proof of hardware power-loss durability.
const nativeReceiptSync = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-receipt-capability-'));
  try { createCiRetryReceiptIO().writeExclusive(path.join(dir, 'probe'), 'probe'); return { supported: true }; }
  catch (error) { return { supported: false, code: error.code }; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();
const quotaTest = nativeReceiptSync.supported ? test
  : (name, fn) => test(name, { skip: `native receipt sync unavailable: ${nativeReceiptSync.code}` }, fn);

test('every parsed CI-only parameter requests evidence preservation, including missing mode and values', () => {
  for (const flags of [
    ['--ci-retry-id', prNodeId], ['--ci-retry-failure', 'diagnosis.json'],
    ['--ci-retry-id'], ['--ci-retry-failure'],
    ['--ci-retry-id', '', '--ci-retry-failure', ''],
    ['--ci-retry-id', prNodeId, '--ci-retry-failure', 'diagnosis.json'],
    ['--ci-retry-failure', 'diagnosis.json', '--ci-retry-id', prNodeId, '--ack'],
  ]) {
    const parsed = parseArgs([url, ...flags, '--state-dir', '/example/final-state']);
    assert.equal(parsed.ciRetryRequested, true, JSON.stringify(flags));
    assert.equal(parsed.stateDir, '/example/final-state');
    assert.equal(parsed.ciRetryStatus, false, 'do not invent a status mode');
    assert.equal(parsed.reserveCiRetry, undefined, 'do not invent a reservation');
  }
  assert.equal(parseArgs([url, '--last-result']).ciRetryRequested, false);
});

test('CI requests reject absent or empty observation directories without falling back or consuming flags', async t => {
  for (const mode of ['--ci-retry-status', '--reserve-ci-retry']) {
    const fx = fixture(t);
    fs.mkdirSync(fx.stateDir);
    const cached = stateFilePath(fx.stateDir, 'example/repo', 42) + '.ci-retry';
    fs.writeFileSync(cached, '{original unknown receipt');
    const flags = [mode, ...(mode === '--reserve-ci-retry' ? [oldHead] : []), '--ci-retry-id', prNodeId, '--ci-retry-failure', fx.diagnosis];
    const env = { ...fx.env, CINDY_PR_STATE_DIR: fx.stateDir };
    for (const directory of [[], ['--state-dir', ''], ['--state-dir', '   '], ['--state-dir']]) {
      for (const argv of [[url, ...directory, ...flags], [url, ...flags, ...directory]]) {
        let stderr = '', stdout = '';
        assert.equal(await runGate(argv, {
          env, out: s => { stdout += s; }, err: s => { stderr += s; },
          runSnapshot: async () => { throw new Error('must not observe'); },
          runProbe: async () => { throw new Error('must not probe'); },
        }), 1);
        assert.match(stderr, /requires an explicit non-empty --state-dir/);
        assert.equal(stdout, '');
        assert.equal(fs.existsSync(fx.retryDir), false);
        assert.equal(fs.readFileSync(cached, 'utf8'), '{original unknown receipt');
        assert.deepEqual(fs.readdirSync(fx.stateDir), [path.basename(cached)]);
      }
    }
    assert.equal(parseArgs([url, '--state-dir', '--state-dir', fx.stateDir, ...flags], env).stateDir, fx.stateDir,
      'a missing value cannot swallow a later explicit directory');
  }
});

test('CI value options never consume short help or other option tokens as data', async t => {
  const fx = fixture(t);
  for (const option of ['--state-dir', '--ci-retry-id', '--ci-retry-failure', '--reserve-ci-retry']) {
    for (const help of ['-h', '--help']) {
      const argv = [url, '--state-dir', fx.stateDir, '--ci-retry-status', '--ci-retry-id', prNodeId,
        '--ci-retry-failure', fx.diagnosis, option, help];
      assert.deepEqual(parseArgs(argv, fx.env), { help: true }, option + ' ' + help);
      let stdout = '', stderr = '';
      assert.equal(await runGate(argv, { env: fx.env, out: s => { stdout += s; }, err: s => { stderr += s; } }), 0);
      assert.doesNotMatch(stdout + stderr, /ci-retry-reserved|"available"|CINDY_PRECHECK_OK/);
    }
    assert.throws(() => parseArgs([url, '--state-dir', fx.stateDir, option, '-unknown'], fx.env), /unknown option: -unknown/);
  }
  assert.equal(fs.existsSync(fx.stateDir), false);
  assert.equal(fs.existsSync(fx.retryDir), false);
  assert.equal(parseArgs([url, '--state-dir', './-h', '--ci-retry-status'], fx.env).stateDir, './-h',
    'a literal dash-prefixed path has an explicit relative-path prefix');
});

test('orphan CI parameters preserve before validation and never dispatch an implicit status or observer', async t => {
  for (const flags of [
    ['--ci-retry-id', prNodeId], ['--ci-retry-failure'],
    ['--ci-retry-id', prNodeId, '--ci-retry-failure', 'diagnosis.json'],
  ]) {
    const fx = fixture(t);
    fs.mkdirSync(fx.stateDir);
    const cached = stateFilePath(fx.stateDir, 'example/repo', 42) + '.ci-retry';
    const bytes = '{unknown original evidence';
    fs.writeFileSync(cached, bytes);
    const rejected = await fx.run(flags);
    assert.equal(rejected.code, 1);
    assert.equal(rejected.stdout, '');
    if (nativeReceiptSync.supported) {
      assert.equal(fs.readFileSync(path.join(fx.retryDir, path.basename(cached)), 'utf8'), bytes);
      assert.match(rejected.stderr, /requires --ci-retry-|requires exactly one mode|expects|separate command/);
    } else {
      assert.match(rejected.stderr, /durability could not be confirmed/);
      assert.equal(fs.existsSync(fx.retryDir), false);
    }
    assert.equal(fs.readFileSync(cached, 'utf8'), bytes);
    assert.deepEqual(fs.readdirSync(fx.stateDir), [path.basename(cached)]);
  }
  const fx = fixture(t);
  const rejected = await fx.run(['--ci-retry-id', prNodeId, '--ci-retry-failure', fx.diagnosis]);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /requires exactly one mode/);
  assert.equal(fs.existsSync(fx.stateDir), false);
  assert.equal(fs.existsSync(fx.retryDir), false);
});

test('unsupported native receipt sync refuses status, reservation and raw migration without quota success', {
  skip: nativeReceiptSync.supported ? 'this host supports its native receipt backend' : false,
}, t => {
  for (const mode of ['--ci-retry-status', '--reserve-ci-retry', 'legacy']) {
    const fx = fixture(t);
    if (mode === 'legacy') {
      fs.mkdirSync(fx.stateDir);
      fs.writeFileSync(stateFilePath(fx.stateDir, 'example/repo', 42) + '.ci-retry', '{unknown raw bytes');
    }
    const flags = mode === '--reserve-ci-retry' ? [mode, oldHead] : ['--ci-retry-status'];
    const result = spawnSync(process.execPath, [gate, ...fx.args(flags)], { env: fx.env, encoding: 'utf8' });
    assert.equal(result.status, 1, mode + ': must refuse recovery');
    assert.match(result.stderr, /durability could not be confirmed/);
    assert.doesNotMatch(result.stdout, /ci-retry-reserved|"available":true/);
    assert.equal(fs.existsSync(fx.retryDir), false, 'do not create receipts on an unsupported filesystem');
    if (mode === 'legacy') assert.equal(fs.readFileSync(stateFilePath(fx.stateDir, 'example/repo', 42) + '.ci-retry', 'utf8'), '{unknown raw bytes');
  }
});

function guideArguments(values) {
  const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8');
  const source = guide.match(/```js\n(\/\/ Argument lists for the existing task execution tool\.[\s\S]*?)\n```/)?.[1];
  assert.ok(source, 'the recovery guide must define argument lists, not shell command templates');
  return runInNewContext(source + '\n({ checkRefArgs, remoteArgs, reserveArgs, statusArgs, verifyArgs, pushArgs, amendArgs: typeof amendArgs === "undefined" ? undefined : amendArgs, originalObjectArgs: typeof originalObjectArgs === "undefined" ? undefined : originalObjectArgs, replacementObjectArgs: typeof replacementObjectArgs === "undefined" ? undefined : replacementObjectArgs, encodingConfigArgs: typeof encodingConfigArgs === "undefined" ? undefined : encodingConfigArgs, committerIdentArgs: typeof committerIdentArgs === "undefined" ? undefined : committerIdentArgs, pushSigningConfigArgs: typeof pushSigningConfigArgs === "undefined" ? undefined : pushSigningConfigArgs, hookConfigArgs: typeof hookConfigArgs === "undefined" ? undefined : hookConfigArgs, hookListArgs: typeof hookListArgs === "undefined" ? undefined : hookListArgs, hooksPathArgs: typeof hooksPathArgs === "undefined" ? undefined : hooksPathArgs, graftPathArgs: typeof graftPathArgs === "undefined" ? undefined : graftPathArgs, replaceRefsArgs: typeof replaceRefsArgs === "undefined" ? undefined : replaceRefsArgs, shallowStateArgs: typeof shallowStateArgs === "undefined" ? undefined : shallowStateArgs, shallowPathArgs: typeof shallowPathArgs === "undefined" ? undefined : shallowPathArgs, originalSignatureArgs: typeof originalSignatureArgs === "undefined" ? undefined : originalSignatureArgs, signatureArgs: typeof signatureArgs === "undefined" ? undefined : signatureArgs, lockPathArgs: typeof lockPathArgs === "undefined" ? undefined : lockPathArgs, refFormatArgs: typeof refFormatArgs === "undefined" ? undefined : refFormatArgs, urlRewriteConfigArgs: typeof urlRewriteConfigArgs === "undefined" ? undefined : urlRewriteConfigArgs })', values);
}

test('config-only environment overrides cannot stand in for execution configuration', async t => {
  const guidePath = fileURLToPath(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url));
  for (const locked of [false, true]) await t.test(locked ? 'notes failure after HEAD moved' : 'notes silently copied', t => {
    const fx = fixture(t), work = path.join(fx.root, 'config-source-work'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'global'), alternate = path.join(fx.root, 'alternate');
    fs.writeFileSync(global, ''); fs.writeFileSync(alternate, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
    for (const key of Object.keys(env)) if (/^GIT_(?:CONFIG$|CONFIG_(?:COUNT|KEY_|VALUE_|PARAMETERS)|NOTES_)/i.test(key)) delete env[key];
    const invoke = (args, actualEnv = env) => spawnSync('git', args, { cwd: work, env: actualEnv, encoding: 'utf8', shell: false });
    const git = args => { const r = invoke(args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    git(['init', '-b', 'main']);
    for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false'], ['core.hooksPath', path.join(fx.root, 'no-hooks')]]) git(['config', key, value]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'original\n'); git(['add', '.']); git(['commit', '-s', '-m', 'original']);
    const original = git(['rev-parse', 'HEAD']); git(['notes', '--ref=commits', 'add', '-m', 'fixture note', original]);
    git(['config', 'notes.rewriteRef', 'refs/notes/commits']);
    const notesBefore = git(['rev-parse', 'refs/notes/commits']);
    if (locked) fs.writeFileSync(path.join(work, '.git', 'refs', 'notes', 'commits.lock'), 'occupied fixture');
    const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    const actualEnv = { ...env, GIT_CONFIG: alternate, GIT_COMMITTER_DATE: '2026-01-02T00:00:00Z' };
    const hidden = invoke(['--no-replace-objects', 'config', '--includes', '--null', '--show-origin', '--show-scope', '--get-regexp', '^notes[.]rewrite'], actualEnv);
    assert.equal(hidden.status, 1); assert.equal(hidden.stdout + hidden.stderr, '');
    assert.equal(git(['rev-parse', 'HEAD']), original); assert.equal(git(['rev-parse', 'refs/notes/commits']), notesBefore);
    assert.equal(fs.existsSync(fx.retryDir), false, 'read-only inspection never calls budget operations');
    // Native counterexample, not a recovery executor: the same environment
    // hides repo config from config(1) but not commit(1). No remote/quota call.
    const amended = invoke(plan.amendArgs, actualEnv), after = git(['rev-parse', 'HEAD']);
    assert.notEqual(after, original);
    if (locked) { assert.notEqual(amended.status, 0); assert.equal(git(['rev-parse', 'refs/notes/commits']), notesBefore); }
    else { assert.equal(amended.status, 0, amended.stderr); assert.notEqual(git(['rev-parse', 'refs/notes/commits']), notesBefore); assert.equal(git(['notes', '--ref=commits', 'show', after]), 'fixture note'); }
    assert.equal(fs.readFileSync(alternate, 'utf8'), ''); assert.equal(fs.existsSync(fx.retryDir), false);
    const guide = fs.readFileSync(guidePath, 'utf8').replace(/\s+/g, ' ');
    assert.ok(/Any defined GIT_CONFIG, including empty values, stops CI-only recovery/.test(guide), 'configuration-source boundary must be explicit');
    assert.ok(/before any Git configuration, status\/object or remote read, budget status\/reservation, amend and push/.test(guide), 'configuration-source boundary must be explicit');
  });
  await t.test('defined empty, case-insensitive names and unknown environment are excluded', () => {
    const guide = fs.readFileSync(guidePath, 'utf8').replace(/\s+/g, ' ');
    assert.ok(/case-insensitive environment names on Windows/.test(guide), 'configuration-source boundary must be explicit');
    assert.ok(/An unavailable or incomplete environment read stops; do not infer absence/.test(guide), 'configuration-source boundary must be explicit');
    assert.ok(/Do not unset GIT_CONFIG, replace its file, or add a config-only scope override to qualify/.test(guide), 'configuration-source boundary must be explicit');
    assert.ok(guide.indexOf('Any defined GIT_CONFIG') < guide.indexOf('const notesRewriteConfigArgs'), 'exclude source mismatch before the first config read plan');
  });
});

test('notes rewrite eligibility excludes auxiliary-ref writes before quota or amend', async t => {
  const guidePath = new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url);
  for (const source of ['local', 'included glob', 'command', 'environment', 'disabled environment', 'locked notes']) await t.test(source, t => {
    const fx = fixture(t), work = path.join(fx.root, 'notes-work'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
    for (const key of Object.keys(env)) if (/^GIT_(?:NOTES_|CONFIG_(?:COUNT|KEY_|VALUE_|PARAMETERS))/.test(key)) delete env[key];
    const invoke = (args, actualEnv = env) => spawnSync('git', args, { cwd: work, env: actualEnv, encoding: 'utf8', shell: false });
    const git = args => { const r = invoke(args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    git(['init', '-b', 'main']);
    for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false'], ['core.hooksPath', path.join(fx.root, 'no-hooks')]]) git(['config', key, value]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'original\n'); git(['add', '.']); git(['commit', '-s', '-m', 'original']);
    const original = git(['rev-parse', 'HEAD']);
    git(['notes', '--ref=commits', 'add', '-m', 'fixture note', original]);
    const notesBefore = git(['rev-parse', 'refs/notes/commits']);
    const actualEnv = { ...env, GIT_COMMITTER_DATE: '2026-01-02T00:00:00Z' };
    if (source === 'included glob') {
      const include = path.join(fx.root, 'notes-include');
      fs.writeFileSync(include, '[notes]\n rewriteRef = refs/notes/*\n rewriteRef = refs/notes/unused\n');
      git(['config', 'include.path', include]);
    } else if (source === 'command') {
      actualEnv.GIT_CONFIG_COUNT = '1'; actualEnv.GIT_CONFIG_KEY_0 = 'notes.rewriteRef'; actualEnv.GIT_CONFIG_VALUE_0 = 'refs/notes/commits';
    } else if (source === 'environment' || source === 'disabled environment') {
      if (source === 'disabled environment') git(['config', 'notes.rewrite.amend', 'false']);
      actualEnv.GIT_NOTES_REWRITE_REF = 'refs/notes/commits:refs/notes/unused';
      actualEnv.GIT_NOTES_REWRITE_MODE = 'concatenate';
    } else git(['config', 'notes.rewriteRef', 'refs/notes/commits']);
    if (source === 'locked notes') fs.writeFileSync(path.join(work, '.git', 'refs', 'notes', 'commits.lock'), 'occupied fixture');
    const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    // Counterexample only: execute the existing risky amend in an isolated Git
    // fixture, then check the Agent guide excludes this environment. No budget,
    // remote or simulated mechanical recovery guard is involved.
    const amended = invoke(plan.amendArgs, actualEnv), after = git(['rev-parse', 'HEAD']);
    assert.notEqual(after, original, 'HEAD moves even when the later notes update fails');
    if (source === 'locked notes') {
      assert.notEqual(amended.status, 0, amended.stderr);
      assert.equal(git(['rev-parse', 'refs/notes/commits']), notesBefore);
    } else if (source === 'disabled environment') {
      assert.equal(amended.status, 0, amended.stderr);
      assert.equal(git(['rev-parse', 'refs/notes/commits']), notesBefore,
        'this Git honors amend=false; the guide still excludes defined rewrite inputs');
    } else {
      assert.equal(amended.status, 0, amended.stderr);
      assert.notEqual(git(['rev-parse', 'refs/notes/commits']), notesBefore);
      assert.equal(git(['notes', '--ref=commits', 'show', after]), 'fixture note');
    }
    assert.equal(fs.existsSync(fx.retryDir), false, 'no quota operation in the native counterexample');
    const guide = fs.readFileSync(guidePath, 'utf8').replace(/\s+/g, ' ');
    assert.match(guide, /Any effective notes\.rewrite configuration stops CI-only recovery/);
    assert.match(guide, /GIT_NOTES_REWRITE_REF.*GIT_NOTES_REWRITE_MODE.*including empty values/);
    assert.match(guide, /before any Git status\/object work or budget status\/reservation, amend and push/);
  });
  await t.test('complete config read includes empty and nonmatching rules', t => {
    const fx = fixture(t), work = path.join(fx.root, 'config-work'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
    for (const key of Object.keys(env)) if (/^GIT_CONFIG_(?:COUNT|KEY_|VALUE_|PARAMETERS)/.test(key)) delete env[key];
    const git = args => spawnSync('git', args, { cwd: work, env, encoding: 'utf8', shell: false });
    assert.equal(git(['init', '-b', 'main']).status, 0);
    const guide = fs.readFileSync(guidePath, 'utf8');
    const source = guide.match(/```js\n(\/\/ Argument lists for the existing task execution tool\.[\s\S]*?)\n```/)[1];
    const read = runInNewContext(source + '\n(typeof notesRewriteConfigArgs === "undefined" ? undefined : notesRewriteConfigArgs)', {
      verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: oldHead, newSha: newHead, gatePath: gate,
      prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    assert.ok(read, 'guide must define the effective notes rewrite read');
    assert.deepEqual(Array.from(read), ['--no-replace-objects', 'config', '--includes', '--null', '--show-origin', '--show-scope', '--get-regexp', '^notes[.]rewrite']);
    const absent = git(read); assert.equal(absent.status, 1); assert.equal(absent.stdout + absent.stderr, '');
    for (const value of ['', 'refs/notes/not-present']) {
      assert.equal(git(['config', 'notes.rewriteRef', value]).status, 0);
      const found = git(read); assert.equal(found.status, 0); assert.match(found.stdout, /notes\.rewriteref/);
    }
  });
});

test('commit message file aliases are excluded before any budget or amend', async t => {
  for (const linked of [false, true]) for (const alias of ['hardlink', 'symlink']) await t.test(`${linked ? 'linked' : 'ordinary'} worktree / ${alias}`, t => {
    const fx = fixture(t), work = path.join(fx.root, 'work'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
    for (const k of Object.keys(env)) if (/^GIT_(?:DIR$|WORK_TREE$|COMMON_DIR$|INDEX_FILE$|NOTES_|CONFIG_(?:COUNT|KEY_|VALUE_|PARAMETERS))/.test(k)) delete env[k];
    let active = work;
    const invoke = (args, actualEnv = env) => spawnSync('git', args, { cwd: active, env: actualEnv, encoding: 'utf8', shell: false });
    const git = args => { const r = invoke(args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    git(['init', '-b', 'main']);
    for (const [k, v] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false'], ['core.hooksPath', path.join(fx.root, 'no-hooks')]]) git(['config', k, v]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'fixture code\n'); git(['add', '.']); git(['commit', '-s', '-m', 'original fixture message']);
    const original = git(['rev-parse', 'HEAD']);
    if (linked) { const next = path.join(fx.root, 'linked'); git(['worktree', 'add', '-b', 'feature', next]); active = next; assert.ok(fs.statSync(path.join(active, '.git')).isFile()); }
    const expected = ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', 'COMMIT_EDITMSG'];
    const target = git(expected), external = path.join(fx.root, 'external-fixture.txt'), bytes = 'fixture-owned original bytes\n';
    fs.writeFileSync(external, bytes);
    // Fixture construction only. Recovery must never unlink or repair a target
    // to make it eligible. No actual user file, quota or remote is touched.
    if (fs.existsSync(target)) fs.unlinkSync(target);
    try { if (alias === 'hardlink') fs.linkSync(external, target); else fs.symlinkSync(external, target, 'file'); }
    catch (error) { if (alias === 'symlink' && error.code === 'EPERM') { t.skip('native file symlink creation unavailable'); return; } throw error; }
    const st = fs.lstatSync(target, { bigint: true });
    if (alias === 'symlink') assert.equal(st.isSymbolicLink(), true);
    else { assert.equal(st.isFile(), true); assert.equal(st.nlink, 2n); }
    // The read-only evidence gathering itself leaves all fixture state intact.
    assert.equal(git(['rev-parse', 'HEAD']), original); assert.equal(fs.readFileSync(external, 'utf8'), bytes);
    assert.equal(fs.existsSync(fx.retryDir), false);
    const plan = guideArguments({ verifiedBranch: linked ? 'feature' : 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    // Native old-risk counterexample, not a production recovery attempt or a
    // claim that an Agent mechanically refused. There is no budget/push here.
    const amended = invoke(plan.amendArgs, { ...env, GIT_COMMITTER_DATE: '2026-01-02T00:00:00Z' });
    assert.equal(amended.status, 0, amended.stderr);
    assert.notEqual(git(['rev-parse', 'HEAD']), original);
    assert.notEqual(fs.readFileSync(external, 'utf8'), bytes, 'amend follows the alias and overwrites the outside fixture');
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.ok(guide.includes('COMMIT_EDITMSG must be absent or a private regular file'));
    assert.ok(guide.includes('nlink === 1n'));
    assert.ok(guide.includes('before any budget status/reservation, amend and push'));
    assert.ok(guide.includes('Never remove, replace or relink this file to qualify'));
  });
  await t.test('Git-resolved path and stable regular/absent observations', t => {
    const fx = fixture(t), work = path.join(fx.root, 'work'); fs.mkdirSync(work);
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(fx.root, 'empty-config') }; fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8');
    const source = guide.match(/```js\n(\/\/ Argument lists for the existing task execution tool\.[\s\S]*?)\n```/)[1];
    const args = runInNewContext(source + '\n(typeof commitMessagePathArgs === "undefined" ? undefined : commitMessagePathArgs)', {
      verifiedBranch: 'feature', verifiedRemote: 'origin', originalRemoteSha: oldHead, newSha: newHead,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    assert.ok(args, 'document one effective Git path read shared by all recovery paths');
    assert.deepEqual(Array.from(args), ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', 'COMMIT_EDITMSG']);
    execFileSync('git', ['init', '-b', 'main'], { cwd: work, env, stdio: 'pipe' });
    const target = execFileSync('git', args, { cwd: work, env, encoding: 'utf8' }).trim();
    assert.throws(() => fs.lstatSync(target), { code: 'ENOENT' }); assert.ok(fs.lstatSync(path.dirname(target)).isDirectory());
    fs.writeFileSync(target, 'private fixture'); const pinned = fs.lstatSync(target, { bigint: true });
    assert.equal(pinned.isFile(), true); assert.equal(pinned.nlink, 1n); assert.equal(typeof pinned.dev, 'bigint'); assert.notEqual(pinned.ino, 0n);
    fs.renameSync(target, target + '.old'); fs.writeFileSync(target, 'replacement fixture');
    const replacement = fs.lstatSync(target, { bigint: true });
    assert.notEqual(replacement.ino, pinned.ino, 'same path is not stable identity');
    assert.equal(fs.readFileSync(target + '.old', 'utf8'), 'private fixture');
    assert.equal(fs.existsSync(fx.retryDir), false);
    const flat = guide.replace(/\s+/g, ' ');
    assert.ok(flat.includes('absence becoming presence before amend stops'));
    assert.ok(flat.includes('These checks are not an atomic binding of Git'));
  });
});

test('recovery guide passes dynamic refs, remotes and paths as literal argument data', () => {
  const branches = ['feature/plain', 'topic$(id)', 'topic;whoami', "topic'quoted", 'topic"quoted', 'topic`whoami`', 'topic&whoami', 'topic/日本語'];
  for (const verifiedBranch of branches) {
    const values = {
      verifiedBranch,
      verifiedRemote: "remote'$(id);&`name`",
      originalRemoteSha: oldHead,
      newSha: newHead,
      gatePath: "/example/skill dir's $(id);&`path`/gate.mjs",
      prUrl: 'https://github.com/example/repo/pull/42',
      prNodeId: 'MDExOlB1bGxSZXF1ZXN0MTIzNDU2Nzg5MA==',
      diagnosisPath: "/example/diagnosis dir's $(id);&`path`/fault.json",
      observationStateDir: "/example/observation state's $(id);&`path`",
    };
    const plan = guideArguments(values);
    const exactRef = 'refs/heads/' + verifiedBranch;
    const expected = {
      checkRefArgs: ['check-ref-format', exactRef],
      remoteArgs: ['ls-remote', '--heads', '--', values.verifiedRemote, exactRef],
      reserveArgs: [values.gatePath, values.prUrl, '--state-dir', values.observationStateDir, '--reserve-ci-retry', oldHead, '--ci-retry-id', values.prNodeId, '--ci-retry-failure', values.diagnosisPath, '--json'],
      statusArgs: [values.gatePath, values.prUrl, '--state-dir', values.observationStateDir, '--ci-retry-status', '--ci-retry-id', values.prNodeId, '--ci-retry-failure', values.diagnosisPath, '--json'],
      hooksPathArgs: ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', 'hooks'],
      graftPathArgs: ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', 'info/grafts'],
      replaceRefsArgs: ['--no-replace-objects', 'for-each-ref', '--format=%(refname)', 'refs/replace/'],
      shallowStateArgs: ['--no-replace-objects', 'rev-parse', '--is-shallow-repository'],
      shallowPathArgs: ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', 'shallow'],
      originalObjectArgs: ['--no-replace-objects', 'cat-file', 'commit', oldHead],
      replacementObjectArgs: ['--no-replace-objects', 'cat-file', 'commit', newHead],
      amendArgs: ['--no-replace-objects', 'commit', '--amend', '--no-edit', '--cleanup=verbatim'],
      verifyArgs: ['--no-replace-objects', 'verify-commit', newHead],
      originalSignatureArgs: ['--no-replace-objects', 'show', '--no-patch', '--format=%G?%n%GF%n%GP%n%GS', oldHead],
      signatureArgs: ['--no-replace-objects', 'show', '--no-patch', '--format=%G?%n%GF%n%GP%n%GS', newHead],
      pushArgs: ['push', '--force-with-lease=' + exactRef + ':' + oldHead, '--no-follow-tags', '--recurse-submodules=no', '--', values.verifiedRemote, values.newSha + ':' + exactRef],
    };
    // Git accepts these refs; its format check cannot make a shell interpolation safe.
    execFileSync('git', plan.checkRefArgs, { stdio: 'pipe' });
    for (const [name, args] of Object.entries(expected)) {
      const received = execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--', ...plan[name]], { encoding: 'utf8', shell: false });
      assert.deepEqual(JSON.parse(received), args, name + ': preserve each argument without shell expansion');
    }
  }
  const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8');
  assert.doesNotMatch(guide, /git (?:ls-remote|push|verify-commit)[^\n]*<(?:branch|verified|exact|new-SHA)/);
});

quotaTest('recovery guide preserves the follower observation directory for reserve and status', t => {
  for (const command of ['statusArgs', 'reserveArgs']) {
    const fx = fixture(t);
    const observationStateDir = path.join(fx.root, "custom state's $(id);&");
    fs.mkdirSync(observationStateDir);
    const raw = JSON.stringify({ sourceHead: oldHead, reservedAt: 123 });
    fs.writeFileSync(stateFilePath(observationStateDir, 'example/repo', 42) + '.ci-retry', raw);
    const plan = guideArguments({
      verifiedBranch: 'feature', verifiedRemote: 'origin', originalRemoteSha: oldHead,
      newSha: newHead, gatePath: gate, prUrl: url, prNodeId,
      diagnosisPath: fx.diagnosis, observationStateDir,
    });
    // Keep even the broken-guide reproduction inside temporary directories.
    // The explicit follower directory must win over a different inherited default.
    const result = spawnSync(process.execPath, plan[command], {
      env: { ...process.env, XDG_STATE_HOME: path.join(fx.root, 'durable'), CINDY_PR_STATE_DIR: path.join(fx.root, 'unused-default') },
      encoding: 'utf8', shell: false,
    });
    assert.equal(result.status, 1, command + ': old unknown evidence must stop the first budget operation: ' + result.stdout + result.stderr);
    const files = fs.readdirSync(fx.retryDir);
    assert.ok(files.some(name => fs.readFileSync(path.join(fx.retryDir, name), 'utf8') === raw), 'preserve original receipt bytes');
    assert.ok(files.every(name => !name.endsWith('.slot')), 'do not allocate new quota');
    assert.equal(fs.readFileSync(stateFilePath(observationStateDir, 'example/repo', 42) + '.ci-retry', 'utf8'), raw);
  }
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-ci-retry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, 'state');
  const env = { ...process.env, XDG_STATE_HOME: path.join(root, 'durable') };
  const retryDir = ciRetryDataDir(env);
  const diagnosis = path.join(root, 'diagnosis.json');
  fs.writeFileSync(diagnosis, JSON.stringify(failure));
  const args = (flags, target = url) => [target, '--state-dir', stateDir, '--json', ...(flags.includes('--ci-retry-status') || flags.includes('--reserve-ci-retry') ? ['--ci-retry-id', prNodeId, '--ci-retry-failure', diagnosis] : []), ...flags];
  return {
    root, stateDir, retryDir, diagnosis, env, args,
    sentinel: ciRetryFilePath(retryDir, prNodeId, failure),
    async run(flags, target) {
      let stdout = '', stderr = '';
      const code = await runGate(args(flags, target), {
        env,
        now: () => 123456789,
        runSnapshot: async () => { throw new Error('reservation must not query GitHub or run a snapshot'); },
        runProbe: async () => { throw new Error('reservation must not probe GitHub'); },
        out: text => { stdout += text; }, err: text => { stderr += text; },
      });
      return { code, stdout, stderr, result: stdout ? JSON.parse(stdout) : null };
    },
    process(flags, target) {
      return new Promise(resolve => execFile(process.execPath, [gate, ...args(flags, target)], { env }, (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stdout, stderr });
      }));
    },
  };
}

quotaTest('same failure budget survives changed SHAs, observation resets, casing and follow-up restarts', async t => {
  const fx = fixture(t);
  const unused = (await fx.run(['--ci-retry-status'])).result;
  assert.equal(unused.available, true);
  assert.equal(unused.receipt_flush_confirmed, false);
  assert.equal(fs.existsSync(fx.stateDir), false, 'status is read-only');
  assert.equal(fs.existsSync(fx.retryDir), false, 'unused status creates no receipt or directory');
  const first = await fx.run(['--reserve-ci-retry', oldHead]);
  assert.equal(first.code, 0);
  assert.equal(first.result.reason, 'ci-retry-reserved');
  assert.equal(first.result.reservation.sourceHead, oldHead);
  assert.equal(first.result.reservation_only, true, 'budget does not assert safety or grant permission');
  assert.equal(first.result.receipt_flush_confirmed, true);
  const file = stateFilePath(fx.stateDir, 'example/repo', 42);
  fs.mkdirSync(fx.stateDir, { recursive: true });
  fs.writeFileSync(file, '{}');
  await fx.run(['--resume', 'observed a new head']);
  fs.unlinkSync(file);
  const repeated = await fx.process(['--reserve-ci-retry', newHead]);
  assert.equal(repeated.code, 1);
  assert.match(repeated.stderr, /already consumed/);
  assert.equal((await fx.run(['--reserve-ci-retry', newHead], 'https://github.com/EXAMPLE/REPO/pull/42')).code, 1);
  const consumed = (await fx.run(['--ci-retry-status'])).result;
  assert.equal(consumed.reservation.sourceHead, oldHead);
  assert.equal(consumed.receipt_flush_confirmed, true);
  assert.equal((await fx.run(['--ci-retry-status'], 'https://github.com/example/renamed/pull/42')).result.available, false, 'repository rename preserves PR identity');
  assert.equal((await fx.run(['--reserve-ci-retry', newHead], 'https://github.com/new-owner/transferred/pull/42')).code, 1, 'repository transfer cannot restore the budget');
  assert.notEqual(ciRetryFilePath(fx.stateDir, prNodeId, failure), ciRetryFilePath(fx.stateDir, 'PR_anotherImmutableId', failure));
});

test('empty quota status does not claim receipt flush support when file flush is unavailable', t => {
  const fx = fixture(t), loader = path.join(fx.root, 'no-file-flush.mjs');
  fs.writeFileSync(loader, `import fs from 'node:fs';
// Supported-directory model; the native unsupported-store test covers refusal.
fs.fsyncSync = fd => {
  if (fs.fstatSync(fd).isFile()) throw Object.assign(new Error('file flush unavailable'), { code: 'ENOTSUP' });
  return undefined;
};
const { runGate } = await import(process.argv[2]);
process.exitCode = await runGate(process.argv.slice(3));
`);
  const run = flags => spawnSync(process.execPath, [loader, pathToFileURL(gate).href, ...fx.args(flags)], { env: fx.env, encoding: 'utf8' });
  const initial = run(['--ci-retry-status']);
  assert.equal(initial.status, 0, initial.stderr);
  const status = JSON.parse(initial.stdout);
  assert.equal(status.pr_consumed, 0);
  assert.equal(status.available, true, 'availability describes quota only');
  assert.equal(status.receipt_flush_confirmed, false, 'no file was flushed; directory existence is not proof');
  assert.match(status.detail, /not.*confirmed|not.*exercised/i);
  assert.equal(fs.existsSync(fx.retryDir), false, 'status creates no probe or receipt');
  const reserved = run(['--reserve-ci-retry', oldHead]);
  assert.equal(reserved.status, 1);
  assert.match(reserved.stderr, /durability could not be confirmed/);
  assert.doesNotMatch(reserved.stdout, /ci-retry-reserved/);
  const rechecked = run(['--ci-retry-status']);
  assert.equal(rechecked.status, 1, 'stored but unflushable evidence cannot become confirmed');
  assert.doesNotMatch(rechecked.stdout, /"receipt_flush_confirmed":true/);
  assert.equal(fs.existsSync(fx.stateDir), false, 'no ordinary gate state or success trace');
});

quotaTest('two distinct failures consume the PR total and a third stops regardless of diagnosis', async t => {
  const fx = fixture(t);
  assert.equal((await fx.process(['--reserve-ci-retry', oldHead])).code, 0);
  fs.writeFileSync(fx.diagnosis, JSON.stringify({ ...failure, cause: 'runner network unavailable' }));
  assert.equal((await fx.run(['--ci-retry-status'])).result.available, true);
  assert.equal((await fx.process(['--reserve-ci-retry', newHead])).code, 0);
  assert.equal(fs.readdirSync(fx.retryDir).length, 2);
  // Changing head/run details or superficial spelling must not invent a new fault.
  fs.writeFileSync(fx.diagnosis, JSON.stringify({ cause: ' PACKAGE   STORE UNAVAILABLE ', step: failure.step, job: 'VERIFY', workflow: failure.workflow }));
  assert.equal((await fx.run(['--ci-retry-status'])).result.available, false);
  assert.equal((await fx.process(['--reserve-ci-retry', newHead])).code, 1);
  assert.equal((await fx.run(['--ci-retry-status'])).result.reservation.sourceHead, oldHead);
  fs.writeFileSync(fx.diagnosis, JSON.stringify({ ...failure, cause: 'runner disk unavailable' }));
  const exhausted = await fx.run(['--ci-retry-status']);
  assert.equal(exhausted.result.available, false);
  assert.equal(exhausted.result.pr_limit, 2);
  assert.equal(exhausted.result.pr_consumed, 2);
  assert.equal(exhausted.result.pr_remaining, 0);
  const third = await fx.process(['--reserve-ci-retry', newHead]);
  assert.equal(third.code, 1);
  assert.match(third.stderr, /PR total.*2/);
  assert.equal((await fx.run(['--ci-retry-status'], 'https://github.com/new-owner/transferred/pull/42')).result.available, false);
});

quotaTest('concurrent distinct failures cannot exceed two total reservations across processes', async t => {
  const fx = fixture(t);
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => {
    const diagnosis = path.join(fx.root, `fault-${i}.json`);
    fs.writeFileSync(diagnosis, JSON.stringify({ ...failure, cause: `isolated fixture fault ${i}` }));
    return fx.process(['--ci-retry-failure', diagnosis, '--reserve-ci-retry', oldHead]);
  }));
  assert.equal(results.filter(r => r.code === 0).length, 2);
  assert.equal((await fx.run(['--ci-retry-status'])).result.available, false);
});

quotaTest('earlier different-failure receipts count toward the total even when querying a new failure', async t => {
  const fx = fixture(t);
  fs.mkdirSync(fx.stateDir, { recursive: true });
  fs.mkdirSync(fx.retryDir, { recursive: true });
  for (const [dir, cause] of [[fx.stateDir, 'old cache fault'], [fx.retryDir, 'old durable fault']]) {
    const diagnosed = { ...failure, cause };
    fs.writeFileSync(ciRetryFilePath(dir, prNodeId, diagnosed), JSON.stringify({ prNodeId, failure: diagnosed, sourceHead: oldHead, reservedAt: 123 }));
  }
  const migrated = await fx.run(['--ci-retry-status']);
  assert.equal(migrated.result.available, false);
  assert.equal(migrated.result.pr_consumed, 2);
  assert.equal((await fx.process(['--reserve-ci-retry', newHead])).code, 1);
  fs.rmSync(fx.stateDir, { recursive: true });
  assert.equal((await fx.process(['--state-dir', path.join(fx.root, 'new-cache'), '--reserve-ci-retry', newHead])).code, 1);
});

quotaTest('one old receipt leaves only one slot; over-limit legacy history and damaged slots stop recovery', async t => {
  const fx = fixture(t);
  fs.mkdirSync(fx.retryDir, { recursive: true });
  const old = { ...failure, cause: 'old distinct fault' };
  fs.writeFileSync(ciRetryFilePath(fx.retryDir, prNodeId, old), JSON.stringify({ prNodeId, failure: old, sourceHead: oldHead, reservedAt: 123 }));
  assert.equal((await fx.run(['--ci-retry-status'])).result.pr_remaining, 1);
  assert.equal((await fx.process(['--reserve-ci-retry', newHead])).code, 0);
  const slot = fs.readdirSync(fx.retryDir).find(name => name.endsWith('.slot'));
  fs.writeFileSync(path.join(fx.retryDir, slot), '{');
  assert.equal((await fx.run(['--ci-retry-status'])).code, 1, 'partial write/crash cannot restore a slot');
});

quotaTest('legacy history beyond two fails closed and another PR has its own total', async t => {
  const fx = fixture(t);
  fs.mkdirSync(fx.retryDir, { recursive: true });
  for (let i = 0; i < 3; i++) {
    const old = { ...failure, cause: `old fault ${i}` };
    fs.writeFileSync(ciRetryFilePath(fx.retryDir, prNodeId, old), JSON.stringify({ prNodeId, failure: old, sourceHead: oldHead, reservedAt: 123 }));
  }
  const stopped = await fx.run(['--reserve-ci-retry', newHead]);
  assert.equal(stopped.code, 1);
  assert.match(stopped.stderr, /PR total.*2/);
  const other = await fx.process(['--ci-retry-id', 'PR_otherImmutableId', '--reserve-ci-retry', oldHead]);
  assert.equal(other.code, 0, 'separate immutable PR IDs have separate totals');
});

quotaTest('missing, invalid and legacy diagnosis evidence cannot start a new retry', async t => {
  const fx = fixture(t);
  let error = '';
  assert.equal(await runGate([url, '--state-dir', fx.stateDir, '--ci-retry-id', prNodeId, '--reserve-ci-retry', oldHead], { env: fx.env, out() {}, err: text => { error += text; } }), 1);
  assert.match(error, /requires --ci-retry-failure/);
  for (const value of [{ ...failure, runId: 123 }, { ...failure, cause: '' }, { ...failure, step: null }, []]) {
    fs.writeFileSync(fx.diagnosis, JSON.stringify(value));
    assert.equal((await fx.run(['--reserve-ci-retry', oldHead])).code, 1);
  }
  fs.writeFileSync(fx.diagnosis, '{');
  assert.equal((await fx.run(['--ci-retry-status'])).code, 1);
  fs.unlinkSync(fx.diagnosis);
  assert.equal((await fx.run(['--reserve-ci-retry', oldHead])).code, 1);
  assert.equal(fs.existsSync(fx.stateDir), false);
  fs.writeFileSync(fx.diagnosis, JSON.stringify(failure));
  fs.mkdirSync(fx.stateDir);
  fs.writeFileSync(ciRetryFilePath(fx.stateDir, prNodeId), JSON.stringify({ prNodeId, sourceHead: oldHead, reservedAt: 123 }));
  assert.equal((await fx.run(['--ci-retry-status'])).code, 1);
  assert.equal((await fx.run(['--reserve-ci-retry', newHead])).code, 1);
});

quotaTest('CI reservation is atomic across processes and never refunded after an interrupted operation', async t => {
  const fx = fixture(t);
  const results = await Promise.all([fx.process(['--reserve-ci-retry', oldHead]), fx.process(['--reserve-ci-retry', newHead])]);
  assert.deepEqual(results.map(r => r.code).sort(), [0, 1]);
  assert.equal((await fx.run(['--ci-retry-status'])).result.available, false);
  assert.equal((await fx.run(['--reserve-ci-retry', oldHead])).code, 1);
});

quotaTest('durable quota survives cache deletion and adopts earlier cache evidence without overwriting receipts', async t => {
  const fx = fixture(t);
  fs.mkdirSync(fx.stateDir);
  const cached = ciRetryFilePath(fx.stateDir, prNodeId, failure);
  const receipt = { prNodeId, failure, sourceHead: oldHead, reservedAt: 123 };
  fs.writeFileSync(cached, JSON.stringify(receipt));
  assert.equal((await fx.run(['--ci-retry-status'])).result.available, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(fx.sentinel, 'utf8')), receipt);
  // Simulate a cache cleaner. The irreversible budget evidence is outside cache.
  assert.equal(path.relative(fx.root, path.resolve(fx.stateDir)), 'state');
  fs.rmSync(fx.stateDir, { recursive: true });
  assert.equal((await fx.process(['--reserve-ci-retry', newHead])).code, 1);
  assert.equal((await fx.process(['--state-dir', path.join(fx.root, 'replacement-cache'), '--reserve-ci-retry', newHead])).code, 1);
  fs.mkdirSync(fx.stateDir);
  fs.writeFileSync(cached, JSON.stringify({ ...receipt, sourceHead: newHead }));
  assert.equal((await fx.run(['--ci-retry-status'])).result.reservation.sourceHead, oldHead);
});

test('CI quota cannot fall back to a mutable URL when the verified PR identity is missing', async t => {
  const fx = fixture(t);
  for (const option of [['--ci-retry-status'], ['--reserve-ci-retry', oldHead]]) {
    let error = '';
    const code = await runGate([url, '--state-dir', fx.stateDir, ...option], { env: fx.env, out() {}, err: text => { error += text; } });
    assert.equal(code, 1);
    assert.match(error, /requires --ci-retry-id/);
  }
  assert.equal(fs.existsSync(fx.stateDir), false);
});

quotaTest('unreconciled old evidence remains fail-closed after cache deletion and restart', async t => {
  for (const kind of ['no diagnosis', 'broken JSON', 'invalid diagnosis', 'URL receipt', 'encoded URL receipt', 'broken URL receipt']) await t.test(kind, async t => {
    const fx = fixture(t);
    fs.mkdirSync(fx.stateDir);
    const urlReceipt = kind.includes('URL');
    const repo = kind === 'encoded URL receipt' ? 'example/repo__name' : 'example/repo';
    const target = `https://github.com/${repo}/pull/42`;
    const oldFailure = kind === 'invalid diagnosis' ? { ...failure, cause: '' } : undefined;
    const cached = urlReceipt ? stateFilePath(fx.stateDir, repo, 42) + '.ci-retry' : ciRetryFilePath(fx.stateDir, prNodeId, oldFailure);
    // The first 1.5.14 writer stored only these two fields at a lower-case URL filename.
    const bytes = kind.startsWith('broken') ? '{' : JSON.stringify({ ...(urlReceipt ? {} : { prNodeId }), sourceHead: oldHead, reservedAt: 123, ...(oldFailure ? { failure: oldFailure } : {}) });
    fs.writeFileSync(cached, bytes);
    assert.equal((await fx.process(['--ci-retry-status'], target)).code, 1);
    assert.equal(fs.readFileSync(path.join(fx.retryDir, path.basename(cached)), 'utf8'), bytes, 'preserve raw evidence before rejecting it');
    fs.writeFileSync(cached, 'stale replacement');
    assert.equal((await fx.process(['--reserve-ci-retry', newHead], target)).code, 1);
    assert.equal(fs.readFileSync(path.join(fx.retryDir, path.basename(cached)), 'utf8'), bytes, 'stale cache must not overwrite durable unknown evidence');
    assert.equal(path.relative(fx.root, path.resolve(fx.stateDir)), 'state');
    fs.rmSync(fx.stateDir, { recursive: true });
    assert.equal((await fx.process(['--ci-retry-status'], target)).code, 1, 'a new process must not restore the quota');
    assert.equal((await fx.process(['--state-dir', path.join(fx.root, 'replacement-cache'), '--reserve-ci-retry', newHead], 'https://github.com/new-owner/renamed/pull/42')).code, 1);
    if (urlReceipt) assert.equal((await fx.process(['--ci-retry-id', 'PR_otherImmutableId', '--ci-retry-status'], target)).code, 1,
      'a URL-only receipt cannot be proved unrelated to another immutable ID');
    assert.equal(fs.readdirSync(fx.retryDir).some(name => name.endsWith('.slot')), false, 'unknown old outcomes cannot allocate new slots');
  });
});

quotaTest('legacy evidence survives invalid current diagnoses, cache cleanup and process restart', async t => {
  for (const command of [['--ci-retry-status'], ['--reserve-ci-retry', oldHead]]) {
    for (const diagnosis of ['missing file', 'broken JSON', 'invalid fields']) {
      for (const legacy of ['known failure', 'unknown URL receipt']) await t.test(`${command[0]} / ${diagnosis} / ${legacy}`, async t => {
        const fx = fixture(t);
        fs.mkdirSync(fx.stateDir);
        const known = legacy === 'known failure';
        const cached = known ? ciRetryFilePath(fx.stateDir, prNodeId, failure) : stateFilePath(fx.stateDir, 'example/repo', 42) + '.ci-retry';
        const bytes = JSON.stringify({ ...(known ? { prNodeId, failure } : {}), sourceHead: oldHead, reservedAt: 123 });
        fs.writeFileSync(cached, bytes);
        if (diagnosis === 'missing file') fs.unlinkSync(fx.diagnosis);
        else fs.writeFileSync(fx.diagnosis, diagnosis === 'broken JSON' ? '{' : JSON.stringify({ ...failure, cause: '' }));
        assert.equal((await fx.process(command)).code, 1, 'invalid diagnosis cannot start a reservation');
        assert.equal(fs.readFileSync(path.join(fx.retryDir, path.basename(cached)), 'utf8'), bytes,
          'persist raw legacy evidence before parsing this invocation diagnosis');
        assert.equal(fs.readFileSync(cached, 'utf8'), bytes, 'retain original cache evidence');
        assert.equal(path.relative(fx.root, path.resolve(fx.stateDir)), 'state');
        fs.rmSync(fx.stateDir, { recursive: true });
        fs.writeFileSync(fx.diagnosis, JSON.stringify(failure));
        const restarted = await fx.process(['--ci-retry-status']);
        if (known) {
          assert.equal(restarted.code, 0, restarted.stderr);
          const status = JSON.parse(restarted.stdout);
          assert.equal(status.available, false);
          assert.equal(status.pr_consumed, 1, 'retain the prior attempt, not a new reservation');
          assert.equal(status.reservation.sourceHead, oldHead);
        } else assert.equal(restarted.code, 1, 'unknown legacy outcome remains fail-closed');
        assert.equal((await fx.process(['--reserve-ci-retry', newHead])).code, 1);
        assert.equal(fs.readdirSync(fx.retryDir).filter(name => name.endsWith('.slot')).length, known ? 1 : 0);
      });
    }
  }
});

quotaTest('legacy evidence survives rejected budget arguments before cache cleanup and restart', async t => {
  for (const mode of ['status', 'reserve', 'missing mode']) {
    const command = mode === 'status' ? ['--ci-retry-status'] : mode === 'reserve' ? ['--reserve-ci-retry', oldHead] : [];
    const cases = [
      ...(mode === 'missing mode' ? [
        ['complete identity and diagnosis', (fx) => ['--ci-retry-id', prNodeId, '--ci-retry-failure', fx.diagnosis]],
      ] : []),
      ['omitted failure', (fx) => [...command, '--ci-retry-id', prNodeId]],
      ['empty failure at end', (fx) => [...command, '--ci-retry-id', prNodeId, '--ci-retry-failure']],
      ['empty failure before directory', (fx) => [...command, '--ci-retry-id', prNodeId, '--ci-retry-failure', '--state-dir', fx.stateDir]],
      ['missing identity', (fx) => [...command, '--ci-retry-failure', fx.diagnosis]],
      ['invalid identity', (fx) => [...command, '--ci-retry-id', '../invalid', '--ci-retry-failure', fx.diagnosis]],
      ['conflicting finish', (fx) => [...command, '--ci-retry-id', prNodeId, '--ci-retry-failure', fx.diagnosis, '--ack']],
      ['conflicting query', (fx) => [...command, '--ci-retry-id', prNodeId, '--ci-retry-failure', fx.diagnosis, '--last-result']],
      ...(mode === 'reserve' ? [
        ['missing source SHA', (fx) => ['--reserve-ci-retry', '--ci-retry-id', prNodeId, '--ci-retry-failure', fx.diagnosis]],
        ['invalid source SHA', (fx) => ['--reserve-ci-retry', 'invalid', '--ci-retry-id', prNodeId, '--ci-retry-failure', fx.diagnosis]],
      ] : []),
    ];
    for (const [kind, flags] of cases) for (const known of [true, false]) await t.test(`${mode} / ${kind} / ${known ? 'known' : 'unknown'}`, async t => {
      const fx = fixture(t);
      fs.mkdirSync(fx.stateDir);
      const cached = known ? ciRetryFilePath(fx.stateDir, prNodeId, failure) : stateFilePath(fx.stateDir, 'example/repo', 42) + '.ci-retry';
      const bytes = JSON.stringify({ ...(known ? { prNodeId, failure } : {}), sourceHead: oldHead, reservedAt: 123 });
      fs.writeFileSync(cached, bytes);
      // Put the directory after the malformed options as well: use the completed parse.
      const argv = kind === 'empty failure at end'
        ? [url, '--state-dir', fx.stateDir, '--json', ...flags(fx)]
        : [url, ...flags(fx), '--state-dir', fx.stateDir, '--json'];
      const rejected = spawnSync(process.execPath, [gate, ...argv], { env: fx.env, encoding: 'utf8' });
      assert.equal(rejected.status, 1, rejected.stderr);
      assert.equal(fs.readFileSync(path.join(fx.retryDir, path.basename(cached)), 'utf8'), bytes,
        'persist raw legacy evidence before rejecting this invocation arguments');
      assert.equal(fs.readFileSync(cached, 'utf8'), bytes);
      assert.deepEqual(fs.readdirSync(fx.stateDir), [path.basename(cached)], 'do not write follow-up state or traces for a rejected budget request');
      assert.equal(fs.readdirSync(fx.retryDir).some(name => name.endsWith('.slot')), false, 'bad arguments cannot allocate a slot');
      assert.equal(path.relative(fx.root, path.resolve(fx.stateDir)), 'state');
      fs.rmSync(fx.stateDir, { recursive: true });
      const restarted = await fx.process(['--ci-retry-status']);
      if (known) {
        assert.equal(restarted.code, 0, restarted.stderr);
        const status = JSON.parse(restarted.stdout);
        assert.equal(status.available, false);
        assert.equal(status.pr_consumed, 1);
        assert.equal(status.reservation.sourceHead, oldHead);
      } else assert.equal(restarted.code, 1, 'unknown history still blocks');
      assert.equal((await fx.process(['--reserve-ci-retry', newHead])).code, 1);
      assert.equal(fs.readdirSync(fx.retryDir).filter(name => name.endsWith('.slot')).length, known ? 1 : 0);
    });
  }
});

// Distinct fixture PR identities, not two node-ID aliases of the same PR.
// The CLI operates on exact keys; alias exclusion is an Agent preflight.
quotaTest('opaque legacy GitHub PR IDs work in CLI, old evidence adoption and durable slots', async t => {
  const fx = fixture(t);
  const legacy = 'MDExOlB1bGxSZXF1ZXN0MQ==';
  const flags = ['--ci-retry-id', legacy];
  const initial = await fx.process([...flags, '--ci-retry-status']);
  assert.equal(initial.code, 0, initial.stderr);
  assert.equal(JSON.parse(initial.stdout).available, true);
  fs.mkdirSync(fx.stateDir);
  fs.writeFileSync(ciRetryFilePath(fx.stateDir, legacy, failure), JSON.stringify({ prNodeId: legacy, failure, sourceHead: oldHead, reservedAt: 123 }));
  const adopted = await fx.process([...flags, '--ci-retry-status']);
  assert.equal(adopted.code, 0, adopted.stderr);
  assert.equal(JSON.parse(adopted.stdout).pr_consumed, 1);
  assert.equal(JSON.parse(adopted.stdout).available, false);
  assert.equal((await fx.process([...flags, '--reserve-ci-retry', newHead])).code, 1);
  fs.writeFileSync(fx.diagnosis, JSON.stringify({ ...failure, cause: 'different fixture fault' }));
  assert.equal((await fx.process([...flags, '--reserve-ci-retry', newHead])).code, 0);
  assert.equal((await fx.run(['--ci-retry-status'])).result.pr_consumed, 0, 'another opaque PR ID has its own quota');
});

quotaTest('invalid, damaged and unwritable CI evidence fails closed without consuming ordinary gate state', async t => {
  const fx = fixture(t);
  for (const flags of [
    ['--reserve-ci-retry', 'not-a-SHA'], ['--reserve-ci-retry', oldHead, '--ack'],
    ['--reserve-ci-retry', oldHead, '--last-result'], ['--ci-retry-status', '--reserve-ci-retry', oldHead],
  ]) assert.equal((await fx.run(flags)).code, 1);
  assert.equal(fs.existsSync(fx.stateDir), false);
  fs.mkdirSync(fx.stateDir);
  fs.mkdirSync(fx.retryDir, { recursive: true });
  const stateFile = stateFilePath(fx.stateDir, 'example/repo', 42);
  const state = JSON.stringify({ headOid: oldHead, roundCount: 5 });
  fs.writeFileSync(stateFile, state);
  fs.writeFileSync(fx.sentinel, '{');
  assert.equal((await fx.run(['--ci-retry-status'])).code, 1);
  assert.equal((await fx.run(['--reserve-ci-retry', oldHead])).code, 1);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), state);
  fs.unlinkSync(fx.sentinel);
  fs.mkdirSync(fx.sentinel);
  assert.equal((await fx.run(['--reserve-ci-retry', oldHead])).code, 1);
});

// Real local Git transport; not a simulated GitHub/Cindy end-to-end follow-up.
// Exercise the documented amend/tree/DCO and explicit lease mechanics without
// touching a real user's PR, branch, credentials or persisted plugin preference.
quotaTest('isolated Git fixture pins the verified source despite HEAD movement and refuses a stale lease', async t => {
  const fx = fixture(t);
  const remote = path.join(fx.root, "remote dir's $(id);&.git"), work = path.join(fx.root, 'work'), other = path.join(fx.root, 'other');
  const branch = "ci$(id);'&", ref = 'refs/heads/' + branch;
  const plan = (originalRemoteSha, newSha) => guideArguments({
    verifiedBranch: branch, verifiedRemote: 'origin', originalRemoteSha, newSha,
    gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir,
  });
  const git = (cwd, argv, env = {}) => execFileSync('git', argv, {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git(fx.root, ['init', '--bare', '-b', 'main', remote]);
  git(fx.root, ['clone', remote, work]);
  for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(work, ['config', key, value]);
  fs.writeFileSync(path.join(work, 'code.txt'), 'original tree\n');
  git(work, ['add', 'code.txt']);
  git(work, ['commit', '-s', '-m', 'fixture intent'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' });
  git(work, ['switch', '-c', branch]);
  git(work, ['push', '--', 'origin', 'HEAD:' + ref]);
  const before = git(work, ['rev-parse', 'HEAD']);
  const tree = git(work, ['rev-parse', 'HEAD^{tree}']);
  const authorAndMessage = git(work, ['show', '-s', '--format=%an%n%ae%n%aI%n%P%n%B', 'HEAD']);
  assert.equal(git(work, plan(before, before).remoteArgs).split(/\s/)[0], before);
  assert.equal((await fx.run(['--reserve-ci-retry', before])).code, 0);
  git(work, ['commit', '--amend', '--no-edit'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
  const after = git(work, ['rev-parse', 'HEAD']);
  assert.notEqual(after, before);
  assert.equal(git(work, ['rev-parse', 'HEAD^{tree}']), tree);
  assert.equal(git(work, ['show', '-s', '--format=%an%n%ae%n%aI%n%P%n%B', 'HEAD']), authorAndMessage);
  assert.match(authorAndMessage, /Signed-off-by: Ada Example <ada@example\.test>/);
  const pushArgs = plan(before, after).pushArgs;
  // Model an unobserved local edit after the final checks/argv binding, before Git starts.
  fs.writeFileSync(path.join(work, 'code.txt'), 'unverified later tree\n');
  git(work, ['add', 'code.txt']);
  git(work, ['commit', '-s', '-m', 'later local work']);
  const later = git(work, ['rev-parse', 'HEAD']);
  assert.notEqual(later, after);
  assert.notEqual(git(work, ['rev-parse', 'HEAD^{tree}']), tree);
  git(work, pushArgs);
  assert.equal(git(work, plan(before, after).remoteArgs).split(/\s/)[0], after, 'push exactly the verified new SHA');
  assert.equal(git(remote, ['rev-parse', ref + '^{tree}']), tree, 'do not send the later unverified tree');
  assert.equal(git(work, ['rev-parse', 'HEAD']), later, 'leave concurrent local work intact');
  assert.throws(() => git(work, plan(after, 'f'.repeat(40)).pushArgs), /src refspec|bad object|not a valid object/);
  assert.equal(git(work, plan(after, after).remoteArgs).split(/\s/)[0], after, 'missing source never falls back to HEAD');
  assert.equal((await fx.run(['--reserve-ci-retry', after])).code, 1);

  // A collaborator advances the ref; reusing the original verified SHA must fail.
  git(fx.root, ['clone', '--branch', branch, '--', remote, other]);
  for (const [key, value] of [['user.name', 'Other Example'], ['user.email', 'other@example.test'], ['commit.gpgsign', 'false']]) git(other, ['config', key, value]);
  fs.writeFileSync(path.join(other, 'other.txt'), 'collaborator\n');
  git(other, ['add', 'other.txt']);
  git(other, ['commit', '-s', '-m', 'intervening work']);
  git(other, ['push', '--', 'origin', 'HEAD:' + ref]);
  const intervening = git(other, ['rev-parse', 'HEAD']);
  assert.throws(() => git(work, plan(after, after).pushArgs), /stale info|rejected/);
  assert.equal(git(work, plan(after, after).remoteArgs).split(/\s/)[0], intervening);
});

quotaTest('signed Git fixture verifies one-off signing, configured amend and unavailable-key failure', async t => {
  const fx = fixture(t);
  const work = path.join(fx.root, 'signed');
  const key = path.join(fx.root, 'fixture-signing-key');
  const git = (argv, env = {}) => execFileSync('git', argv, { cwd: work, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  fs.mkdirSync(work);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ada@example.test', '-f', key], { stdio: ['ignore', 'pipe', 'pipe'] });
  const allowed = path.join(fx.root, 'allowed-signers');
  fs.writeFileSync(allowed, 'ada@example.test ' + fs.readFileSync(key + '.pub', 'utf8'));
  git(['init', '-b', 'main']);
  for (const [name, value] of [
    ['user.name', 'Ada Example'], ['user.email', 'ada@example.test'],
    ['gpg.format', 'ssh'], ['user.signingkey', key], ['gpg.ssh.allowedSignersFile', allowed],
    ['commit.gpgsign', 'false'],
  ]) git(['config', name, value]);
  fs.writeFileSync(path.join(work, 'code.txt'), 'signed fixture\n');
  git(['add', 'code.txt']);
  git(['commit', '-S', '-s', '-m', 'signed intent'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' });
  const original = git(['rev-parse', 'HEAD']);
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  assert.match(git(['cat-file', 'commit', 'HEAD']), /^gpgsig /m);
  git(['verify-commit', 'HEAD']);
  assert.equal(git(['config', '--type=bool', '--get', 'commit.gpgsign']), 'false');
  // A one-off -S is not automatic signing: leave the original and budget intact.
  assert.equal((await fx.run(['--ci-retry-status'])).result.available, true);
  assert.equal(git(['rev-parse', 'HEAD']), original);
  assert.equal(fs.existsSync(fx.stateDir), false);

  // Model the separate, already-configured signing environment in the workflow.
  git(['config', 'commit.gpgsign', 'true']);
  assert.equal((await fx.run(['--reserve-ci-retry', original])).code, 0);
  git(['commit', '--amend', '--no-edit'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
  const amended = git(['rev-parse', 'HEAD']);
  assert.notEqual(amended, original);
  assert.equal(git(['rev-parse', 'HEAD^{tree}']), tree);
  assert.match(git(['cat-file', 'commit', 'HEAD']), /^gpgsig /m);
  git(['verify-commit', amended]);
  // Unavailable key: Git must fail, without producing an unsigned replacement.
  git(['config', 'user.signingkey', path.join(fx.root, 'unavailable-key')]);
  assert.throws(() => git(['commit', '--amend', '--no-edit']));
  assert.equal(git(['rev-parse', 'HEAD']), amended);
});

test('URL rewriting can redirect an exact leased push despite a successful original read', async t => {
  for (const key of ['pushInsteadOf', 'insteadOf']) for (const scope of ['local', 'global include', 'command']) await t.test(`${key} / ${scope}`, t => {
    const fx = fixture(t), work = path.join(fx.root, 'work'), allowed = path.join(fx.root, 'allowed.git'), redirected = path.join(fx.root, 'redirected.git'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'global'), included = path.join(fx.root, 'included'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0' };
    const git = (cwd, args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    for (const repo of [allowed, redirected]) git(fx.root, ['init', '--bare', '-b', 'main', repo]);
    git(work, ['init', '-b', 'main']);
    for (const [name, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(work, ['config', name, value]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'original'); git(work, ['add', 'code.txt']); git(work, ['commit', '-m', 'original']);
    const original = git(work, ['rev-parse', 'HEAD']), a = pathToFileURL(allowed).href, b = pathToFileURL(redirected).href;
    for (const repo of [a, b]) git(work, ['push', '--no-follow-tags', '--', repo, original + ':refs/heads/feature']);
    fs.writeFileSync(path.join(work, 'code.txt'), 'changed'); git(work, ['add', 'code.txt']); git(work, ['commit', '-m', 'verified change']);
    const next = git(work, ['rev-parse', 'HEAD']), rewrite = 'url.' + b + '.' + key;
    if (scope === 'command') { env.GIT_CONFIG_COUNT = '1'; env.GIT_CONFIG_KEY_0 = rewrite; env.GIT_CONFIG_VALUE_0 = a; }
    else if (scope === 'global include') {
      git(work, ['config', '--file', global, 'include.path', included]); git(work, ['config', '--file', included, rewrite, a]);
    } else git(work, ['config', rewrite, a]);
    const plan = guideArguments({ verifiedBranch: 'feature', verifiedRemote: a, originalRemoteSha: original, newSha: next,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    assert.equal(git(work, plan.remoteArgs).split(/\s/)[0], original);
    // Counterexample only: both fixture remotes share the old SHA, so the lease
    // succeeds on the wrong target. No real GitHub branch, quota or recovery.
    git(work, plan.pushArgs);
    assert.equal(git(allowed, ['rev-parse', 'refs/heads/feature']), original);
    assert.equal(git(redirected, ['rev-parse', 'refs/heads/feature']), next);
    assert.equal(fs.existsSync(fx.retryDir), false);
    const inspect = git(work, plan.urlRewriteConfigArgs ?? ['config', '--includes', '--null', '--show-origin', '--show-scope', '--get-regexp', '^url[.].*[.](pushinsteadof|insteadof)$']);
    assert.ok(inspect.toLowerCase().includes(key.toLowerCase()));
    assert.ok(inspect.includes(scope === 'command' ? 'command' : scope === 'local' ? 'local' : 'global'));
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.ok(/Any effective url\.\*\.pushInsteadOf or url\.\*\.insteadOf entry stops/.test(guide));
    assert.ok(/including empty or nonmatching values/.test(guide));
    assert.ok(/before any remote read, budget status\/reservation, amend and push/.test(guide));
    assert.ok(plan.urlRewriteConfigArgs);
  });
});

test('named-remote push URLs must not diverge or fan out from the verified read target', async t => {
  for (const multiple of [false, true]) await t.test(multiple ? 'multiple push URLs' : 'different push URL', t => {
    const fx = fixture(t), work = path.join(fx.root, 'work'), allowed = path.join(fx.root, 'allowed.git'), other = path.join(fx.root, 'other.git'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
    const git = (cwd, args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    for (const repo of [allowed, other]) git(fx.root, ['init', '--bare', '-b', 'main', repo]);
    git(work, ['init', '-b', 'main']);
    for (const [name, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(work, ['config', name, value]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'original'); git(work, ['add', 'code.txt']); git(work, ['commit', '-m', 'original']);
    const original = git(work, ['rev-parse', 'HEAD']);
    for (const repo of [allowed, other]) git(work, ['push', '--', repo, original + ':refs/heads/feature']);
    git(work, ['remote', 'add', 'origin', allowed]);
    if (multiple) git(work, ['config', '--add', 'remote.origin.pushurl', allowed]);
    git(work, ['config', '--add', 'remote.origin.pushurl', other]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'changed'); git(work, ['add', 'code.txt']); git(work, ['commit', '-m', 'change']);
    const next = git(work, ['rev-parse', 'HEAD']);
    const plan = guideArguments({ verifiedBranch: 'feature', verifiedRemote: 'origin', originalRemoteSha: original, newSha: next,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    assert.equal(git(work, plan.remoteArgs).split(/\s/)[0], original); git(work, plan.pushArgs);
    assert.equal(git(other, ['rev-parse', 'refs/heads/feature']), next);
    assert.equal(git(allowed, ['rev-parse', 'refs/heads/feature']), multiple ? next : original);
    assert.equal(fs.existsSync(fx.retryDir), false);
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.ok(/exactly one identical fetch\/push URL/.test(guide));
  });
});

test('recovery push never follows annotated tags, including when the branch lease fails', async t => {
  for (const stale of [false, true]) await t.test(stale ? 'stale lease' : 'successful branch push', t => {
    const fx = fixture(t), remote = path.join(fx.root, 'remote.git'), work = path.join(fx.root, 'work');
    const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd,
      env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(fx.root, ['init', '--bare', '-b', 'main', remote]);
    git(fx.root, ['clone', remote, work]);
    for (const [name, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'],
      ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'], ['push.followTags', 'true']]) git(work, ['config', name, value]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'unchanged recovery tree\n');
    git(work, ['add', 'code.txt']);
    git(work, ['commit', '-s', '-m', 'original'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' });
    const original = git(work, ['rev-parse', 'HEAD']);
    git(work, ['push', '--no-follow-tags', '--', 'origin', original + ':refs/heads/feature']);
    git(work, ['tag', '-a', 'unpublished', '-m', 'must remain local']);
    git(work, ['commit', '--amend', '--no-edit'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
    const verified = git(work, ['rev-parse', 'HEAD']);
    // Tag the verified object so it is relevant to --follow-tags.
    git(work, ['tag', '-a', 'reachable-local', '-m', 'must also remain local', verified]);
    if (stale) {
      git(work, ['checkout', '-b', 'independent', original]);
      fs.writeFileSync(path.join(work, 'other.txt'), 'remote advancement\n');
      git(work, ['add', 'other.txt']);
      git(work, ['commit', '-s', '-m', 'independent remote change']);
      git(work, ['push', '--no-follow-tags', '--', 'origin', 'HEAD:refs/heads/feature']);
    }
    const before = git(remote, ['for-each-ref', '--format=%(refname) %(objectname)']);
    const plan = guideArguments({ verifiedBranch: 'feature', verifiedRemote: 'origin',
      originalRemoteSha: original, newSha: verified, gatePath: gate, prUrl: url,
      prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    if (stale) assert.throws(() => git(work, plan.pushArgs), /stale info|rejected/);
    else git(work, plan.pushArgs);
    const after = git(remote, ['for-each-ref', '--format=%(refname) %(objectname)']);
    assert.equal(git(remote, ['for-each-ref', 'refs/tags']), '', 'no annotated tag may escape via configuration');
    assert.equal(after, stale ? before : 'refs/heads/feature ' + verified, 'only the exact authorized branch can change');
    assert.equal(git(work, ['config', '--get', 'push.followTags']), 'true', 'do not change user/repository defaults');
    assert.equal(git(work, ['tag', '--list']).split('\n').length, 2, 'keep local tags');
  });
});

// A parent lease protects neither a child repository nor its earlier recursive push.
// Use real Git and separate disposable remotes; never call a live GitHub recovery.
// A changed Gitlink makes the child a candidate for transfer: this tests the push
// argument boundary, not the separate unchanged-tree/CI-recovery eligibility gate.
test('recovery push limits writes to the parent ref despite inherited submodule recursion', async t => {
  for (const mode of ['on-demand', 'only', 'check']) for (const stale of [false, true]) {
    await t.test(mode + (stale ? ': stale lease' : ': successful parent push'), t => {
      const fx = fixture(t), remote = path.join(fx.root, 'parent.git'), work = path.join(fx.root, 'parent');
      const childRemote = path.join(fx.root, 'child.git'), seed = path.join(fx.root, 'child-seed');
      // No access to or mutation of the user's global Git configuration.
      const globalConfig = path.join(fx.root, 'global-config');
      fs.writeFileSync(globalConfig, '[push]\n\trecurseSubmodules = ' + mode + '\n');
      const env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' };
      const git = (cwd, args, extra = {}) => execFileSync('git', args, { cwd,
        env: { ...env, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      const configure = cwd => {
        for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'],
          ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false']]) git(cwd, ['config', key, value]);
      };
      const pushSetup = (cwd, sha) => git(cwd, ['push', '--no-follow-tags', '--recurse-submodules=no', '--', 'origin', sha + ':refs/heads/main']);
      const refs = cwd => git(cwd, ['for-each-ref', '--format=%(refname) %(objectname)']);
      git(fx.root, ['init', '--bare', '-b', 'main', childRemote]);
      git(fx.root, ['clone', childRemote, seed]); configure(seed);
      fs.writeFileSync(path.join(seed, 'lib.txt'), 'published child\n');
      git(seed, ['add', 'lib.txt']); git(seed, ['commit', '-s', '-m', 'published child']);
      const childOriginal = git(seed, ['rev-parse', 'HEAD']); pushSetup(seed, childOriginal);
      git(fx.root, ['init', '--bare', '-b', 'main', remote]);
      git(fx.root, ['clone', remote, work]); configure(work);
      git(work, ['-c', 'protocol.file.allow=always', 'submodule', 'add', childRemote, 'lib']);
      const child = path.join(work, 'lib'); configure(child);
      git(work, ['add', '.gitmodules', 'lib']);
      git(work, ['commit', '-s', '-m', 'original']);
      const original = git(work, ['rev-parse', 'HEAD']); pushSetup(work, original);
      fs.writeFileSync(path.join(child, 'lib.txt'), 'unpublished child\n');
      git(child, ['add', 'lib.txt']); git(child, ['commit', '-s', '-m', 'must remain local']);
      const childLocal = git(child, ['rev-parse', 'HEAD']);
      git(work, ['add', 'lib']);
      git(work, ['commit', '-s', '-m', 'verified transport object']);
      git(work, ['tag', '-a', 'unpublished', '-m', 'keep tag local']);
      git(work, ['config', 'push.followTags', 'true']);
      git(work, ['config', 'submodule.recurse', 'true']);
      if (stale) git(work, ['config', 'push.recurseSubmodules', mode]);
      git(work, ['config', 'push.default', 'matching']);
      git(work, ['config', 'remote.origin.push', 'refs/heads/unrelated:refs/heads/unrelated']);
      git(work, ['branch', 'unrelated']);
      const verified = git(work, ['rev-parse', 'HEAD']);
      if (stale) {
        git(work, ['checkout', '--no-recurse-submodules', '-b', 'independent', original]);
        fs.writeFileSync(path.join(work, 'other.txt'), 'independent remote change\n');
        git(work, ['add', 'other.txt']); git(work, ['commit', '-s', '-m', 'independent']);
        pushSetup(work, 'HEAD');
      }
      const beforeParent = refs(remote), beforeChild = refs(childRemote);
      const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin',
        originalRemoteSha: original, newSha: verified, gatePath: gate, prUrl: url,
        prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
      // Gather both inventories even on failure: a parent error must not hide child writes.
      const result = spawnSync('git', plan.pushArgs, { cwd: work, env, encoding: 'utf8' });
      assert.equal(refs(childRemote), beforeChild, 'child remote must stay untouched even if parent lease fails');
      assert.equal(result.status, stale ? 1 : 0, result.stderr);
      if (stale) assert.match(result.stderr, /stale info|rejected/);
      assert.equal(refs(remote), stale ? beforeParent : 'refs/heads/main ' + verified);
      assert.equal(git(childRemote, ['rev-parse', 'refs/heads/main']), childOriginal);
      assert.equal(git(child, ['rev-parse', 'HEAD']), childLocal, 'keep unpublished child work');
      assert.equal(git(work, ['config', '--get', 'push.recurseSubmodules']), mode);
      assert.equal(git(work, ['config', '--get', 'submodule.recurse']), 'true');
      assert.equal(git(work, ['config', '--get', 'push.followTags']), 'true');
      assert.equal(git(work, ['tag', '--list']), 'unpublished');
    });
  }
});

test('recovery amend preserves exact raw messages despite local or global cleanup settings', async t => {
  for (const scope of ['local', 'global']) for (const cleanup of ['strip', 'scissors']) for (const commentChar of ['#', '@']) {
    await t.test(`${scope}/${cleanup}/${commentChar}`, t => {
      const fx = fixture(t), work = path.join(fx.root, 'message-work');
      fs.mkdirSync(work);
      const global = path.join(fx.root, 'isolated-global'); fs.writeFileSync(global, '');
      const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
      const git = (args, extra = {}) => execFileSync('git', args, { cwd: work, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
      git(['init', '-b', 'main']);
      for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(['config', key, value]);
      fs.writeFileSync(path.join(work, 'code.txt'), 'unchanged code\n'); git(['add', 'code.txt']);
      const message = 'original intent\n\n# intentional hash\n@ intentional at\ntrailing spaces  \n\n' +
        commentChar + ' ------------------------ >8 ------------------------\nkeep after scissors\n\nSigned-off-by: Ada Example <ada@example.test>\n';
      const messageFile = path.join(fx.root, 'message.txt'); fs.writeFileSync(messageFile, message);
      git(['commit', '--cleanup=verbatim', '-F', messageFile]);
      const original = git(['rev-parse', 'HEAD']).toString().trim();
      const before = git(['cat-file', 'commit', original]);
      for (const [key, value] of [['commit.cleanup', cleanup], ['core.commentChar', commentChar]]) git(['config', '--' + scope, key, value]);
      const plan = guideArguments({ verifiedBranch: 'feature', verifiedRemote: work, gatePath: gate, prUrl: url,
        observationStateDir: fx.stateDir, originalRemoteSha: original, prNodeId, diagnosisPath: fx.diagnosis, newSha: original });
      git(plan.amendArgs, { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
      const next = git(['rev-parse', 'HEAD']).toString().trim();
      assert.notEqual(next, original);
      const after = git(['cat-file', 'commit', next]);
      const payload = raw => raw.subarray(raw.indexOf('\n\n') + 2);
      assert.deepEqual(payload(after), payload(before), 'comments, scissors suffix, spaces and DCO must remain byte-identical');
      const headers = raw => raw.toString().split('\n\n')[0].split('\n').filter(line => /^(tree|parent|author) /.test(line));
      assert.deepEqual(headers(after), headers(before));
      assert.equal(git(['config', '--get', 'commit.cleanup']).toString().trim(), cleanup);
      assert.equal(fs.existsSync(fx.retryDir), false, 'local mechanics test allocates no recovery quota');
    });
  }
});

test('recovery binds signature identity even when two different SSH keys both verify', async t => {
  const fx = fixture(t);
  const work = path.join(fx.root, 'two-signers');
  fs.mkdirSync(work);
  const git = (args, env = {}) => execFileSync('git', args, { cwd: work,
    env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const keys = ['a', 'b'].map(name => path.join(fx.root, 'key-' + name));
  for (const key of keys) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ada@example.test', '-f', key], { stdio: 'pipe' });
  const allowed = path.join(fx.root, 'both-trusted');
  fs.writeFileSync(allowed, keys.map(key => 'ada@example.test ' + fs.readFileSync(key + '.pub', 'utf8')).join(''));
  git(['init', '-b', 'main']);
  for (const [name, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'],
    ['gpg.format', 'ssh'], ['gpg.ssh.allowedSignersFile', allowed], ['user.signingkey', keys[1]], ['commit.gpgsign', 'true']]) git(['config', name, value]);
  fs.writeFileSync(path.join(work, 'code.txt'), 'two trusted signers\n');
  git(['add', 'code.txt']);
  git(['commit', '-S' + keys[0], '-s', '-m', 'original A'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' });
  const original = git(['rev-parse', 'HEAD']);
  git(['verify-commit', original]);
  const values = { verifiedBranch: 'feature', verifiedRemote: work, gatePath: gate, prUrl: url,
    observationStateDir: fx.stateDir, originalRemoteSha: original, prNodeId, diagnosisPath: fx.diagnosis, newSha: original };
  const plan = guideArguments(values);
  assert.ok(plan.originalSignatureArgs && plan.signatureArgs, 'record original and replacement identities using exact object arguments');
  const oldIdentity = git(plan.originalSignatureArgs);
  const configuredFingerprint = execFileSync('ssh-keygen', ['-lf', keys[1] + '.pub'], { encoding: 'utf8' }).split(/\s+/)[1];
  assert.ok(!oldIdentity.includes(configuredFingerprint), 'configured signer B must stop before quota, even with automatic signing enabled');
  assert.equal(fs.existsSync(fx.retryDir), false);
  // Separate disposable reproduction of the rejected path, not an authorized recovery.
  git(['commit', '--amend', '--no-edit'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
  const replacement = git(['rev-parse', 'HEAD']);
  git(['verify-commit', replacement]);
  const next = guideArguments({ ...values, newSha: replacement });
  assert.notEqual(git(next.signatureArgs), oldIdentity, 'valid signature B cannot preserve signer A');
  git(['config', 'user.signingkey', keys[0]]);
  git(['commit', '--amend', '--no-edit'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:02Z' });
  const same = git(['rev-parse', 'HEAD']);
  git(['verify-commit', same]);
  assert.equal(git(guideArguments({ ...values, newSha: same }).signatureArgs), oldIdentity);
  const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8');
  assert.match(guide, /full signing-key fingerprint/);
  assert.match(guide.replace(/\*\*/g, '').replace(/\s+/g, ' '), /same signature identity before consuming budget/);
});

// These are native demonstrations of excluded configurations, not recovery
// execution or a mechanical implementation of the Agent's eligibility judgment.
test('standard enabled LFS and DCO hooks stop recovery before quota or amend', async t => {
  for (const kind of ['DCO', 'LFS']) await t.test(kind, {
    skip: kind === 'LFS' && spawnSync('git', ['lfs', 'version'], { encoding: 'utf8' }).status !== 0 ? 'Git LFS unavailable' : false,
  }, t => {
    const fx = fixture(t), work = path.join(fx.root, 'work');
    const global = path.join(fx.root, 'isolated-global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
    const git = args => execFileSync('git', args, { cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    fs.mkdirSync(work); git(['init', '-b', 'main']);
    for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(['config', key, value]);
    git(['commit', '--allow-empty', '-s', '-m', 'original']);
    const original = git(['rev-parse', 'HEAD']), raw = git(['cat-file', 'commit', original]);
    const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    const directory = git(plan.hooksPathArgs);
    if (kind === 'LFS') git(['lfs', 'install', '--local']);
    else {
      const file = path.join(directory, 'prepare-commit-msg');
      fs.writeFileSync(file, '#!/bin/sh\ngit interpret-trailers --if-exists addIfDifferent --if-missing add --trailer "Signed-off-by: Ada Example <ada@example.test>" --in-place "$1"\n');
      fs.chmodSync(file, 0o755);
    }
    const hooks = fs.readdirSync(directory).filter(n => !n.endsWith('.sample'));
    assert.ok(hooks.includes(kind === 'LFS' ? 'pre-push' : 'prepare-commit-msg'));
    const bytes = hooks.map(n => [n, fs.readFileSync(path.join(directory, n))]);
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    // Native recognition + Agent contract, not a mechanical recovery executor:
    // the forbidden reserve/amend/push operations are never invoked here.
    assert.match(guide, /Any effective Git hook, including standard Git LFS and DCO, stops recovery before quota or amend/);
    assert.doesNotMatch(guide, /Inspected standard Git LFS and DCO hooks may run normally/);
    assert.equal(git(['rev-parse', 'HEAD']), original);
    assert.equal(git(['cat-file', 'commit', original]), raw);
    assert.equal(fs.existsSync(fx.retryDir), false);
    for (const [name, content] of bytes) assert.deepEqual(fs.readFileSync(path.join(directory, name)), content);
  });
});

test('CI recovery excludes hooks with extra remote writes before quota and amend', async t => {
  for (const custom of [false, true]) for (const hook of ['post-commit', 'post-rewrite']) {
    await t.test((custom ? 'custom' : 'default') + '/' + hook, t => {
      const fx = fixture(t), work = path.join(fx.root, 'work'), parent = path.join(fx.root, 'parent.git'), extra = path.join(fx.root, 'extra.git');
      const global = path.join(fx.root, 'isolated-global'); fs.writeFileSync(global, '');
      const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
      const git = (cwd, args, vars = {}) => execFileSync('git', args, { cwd, env: { ...env, ...vars }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      for (const remote of [parent, extra]) git(fx.root, ['init', '--bare', '-b', 'main', remote]);
      git(fx.root, ['clone', parent, work]);
      for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(work, ['config', key, value]);
      git(work, ['remote', 'add', 'hook-sink', extra]);
      fs.writeFileSync(path.join(work, 'code.txt'), 'unchanged tree\n'); git(work, ['add', 'code.txt']);
      git(work, ['commit', '-s', '-m', 'original'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' });
      const original = git(work, ['rev-parse', 'HEAD']);
      git(work, ['push', '--no-follow-tags', '--recurse-submodules=no', '--', 'origin', original + ':refs/heads/main']);
      if (custom) git(work, ['config', 'core.hooksPath', '../custom-hooks']);
      const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
        gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
      const hookDir = git(work, plan.hooksPathArgs ?? ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
      assert.equal(path.resolve(hookDir), custom ? path.join(fx.root, 'custom-hooks') : path.join(work, '.git/hooks'));
      fs.mkdirSync(hookDir, { recursive: true });
      const hookPath = path.join(hookDir, hook);
      fs.writeFileSync(hookPath, '#!/bin/sh\ngit push --no-follow-tags --recurse-submodules=no hook-sink HEAD:refs/heads/hook-effect\n');
      fs.chmodSync(hookPath, 0o755);
      const hookBytes = fs.readFileSync(hookPath);
      // Deliberately run the old, ineligible sequence ONLY in this disposable
      // fixture: either post hook writes before any final recovery push exists.
      git(work, ['commit', '--amend', '--no-edit'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
      assert.equal(git(extra, ['rev-parse', 'refs/heads/hook-effect']), git(work, ['rev-parse', 'HEAD']));
      assert.equal(git(parent, ['rev-parse', 'refs/heads/main']), original);
      assert.deepEqual(fs.readFileSync(hookPath), hookBytes, 'never disable or rewrite a user hook');
      assert.equal(fs.existsSync(fx.retryDir), false, 'demonstration must not consume real or simulated recovery quota');
      const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
      assert.ok(/Any effective Git hook, including standard Git LFS and DCO, stops recovery before quota or amend/.test(guide));
      assert.ok(/post-commit.*post-rewrite.*reference-transaction/.test(guide), 'scope must include all amend/ref hooks');
    });
  }
});

test('configuration-registered hooks are discovered even with an empty traditional hook directory', {
  skip: (() => { const result = spawnSync('git', ['hook', '-h'], { encoding: 'utf8' }); return (result.stdout + result.stderr).includes('git hook list') ? false : 'Git hook list unavailable'; })(),
}, t => {
  const fx = fixture(t), work = path.join(fx.root, 'work'), remote = path.join(fx.root, 'extra.git');
  const global = path.join(fx.root, 'global'), included = path.join(fx.root, 'included');
  fs.writeFileSync(global, ''); fs.writeFileSync(included, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (cwd, args, vars = {}) => execFileSync('git', args, { cwd, env: { ...env, ...vars }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(fx.root, ['init', '--bare', '-b', 'main', remote]);
  fs.mkdirSync(work); git(work, ['init', '-b', 'main']);
  for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(work, ['config', key, value]);
  git(work, ['remote', 'add', 'hook-sink', remote]);
  fs.writeFileSync(path.join(work, 'code.txt'), 'unchanged tree\n');
  git(work, ['add', 'code.txt']); git(work, ['commit', '-s', '-m', 'original'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' });
  const original = git(work, ['rev-parse', 'HEAD']);
  git(work, ['config', '--file', included, 'hook.configured-push.event', 'post-commit']);
  git(work, ['config', '--file', included, 'hook.configured-push.command', 'git push --no-follow-tags --recurse-submodules=no hook-sink HEAD:refs/heads/hook-effect']);
  git(work, ['config', '--file', global, 'include.path', included]);
  const directory = git(work, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
  assert.equal(fs.readdirSync(directory).some(n => !n.endsWith('.sample')), false);
  assert.match(git(work, ['hook', 'list', '--show-scope', 'post-commit']), /global\s+configured-push/);
  // Native counterexample only: the old directory-only audit misses an extra
  // write during amend. All destinations here are this test's disposable files.
  git(work, ['commit', '--amend', '--no-edit'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
  assert.notEqual(git(work, ['rev-parse', 'HEAD']), original);
  assert.equal(git(remote, ['rev-parse', 'refs/heads/hook-effect']), git(work, ['rev-parse', 'HEAD']));
  const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
    gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
  assert.ok(Array.isArray(plan.hookListArgs), 'enumerate effective hooks instead of only scanning a directory');
  for (const event of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'post-rewrite', 'reference-transaction', 'post-index-change', 'pre-auto-gc', 'pre-push']) {
    assert.ok(plan.hookListArgs.some(argv => argv.at(-1) === event), event);
  }
  const listed = git(work, plan.hookListArgs.find(argv => argv.at(-1) === 'post-commit'));
  assert.match(listed, /configured-push/);
  assert.match(git(work, plan.hookConfigArgs), /configured-push/);
  assert.equal(fs.existsSync(fx.retryDir), false, 'counterexample never consumes quota');
});

test('recovery rejects declared or mismatched message encodings before quota or amend', async t => {
  for (const originalEncoding of ['ISO-8859-1', 'UTF-8']) await t.test(originalEncoding, t => {
    const fx = fixture(t), work = path.join(fx.root, 'work'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
    const git = (args, vars = {}, encoding = 'utf8') => execFileSync('git', args, { cwd: work, env: { ...env, ...vars }, encoding, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-b', 'main']);
    for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false'], ['i18n.commitEncoding', originalEncoding]]) git(['config', key, value]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'unchanged\n'); git(['add', 'code.txt']);
    const message = path.join(fx.root, 'message');
    fs.writeFileSync(message, Buffer.from('intent caf\u00e9\n', originalEncoding === 'UTF-8' ? 'utf8' : 'latin1'));
    git(['commit', '-s', '-F', message], { GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' });
    const original = git(['rev-parse', 'HEAD']).trim(), before = git(['cat-file', 'commit', original], {}, 'buffer');
    git(['config', 'i18n.commitEncoding', originalEncoding === 'UTF-8' ? 'ISO-8859-1' : 'UTF-8']);
    const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    // Counterexample of the old flow only. Never consumes quota or pushes.
    assert.match(git(plan.encodingConfigArgs), /i18n[.]commitencoding/i);
    git(plan.amendArgs, { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
    const after = git(['cat-file', 'commit', 'HEAD'], {}, 'buffer');
    const rawMessage = bytes => bytes.subarray(bytes.indexOf(Buffer.from('\n\n')) + 2);
    assert.notDeepEqual(rawMessage(after), rawMessage(before), 'no-edit/verbatim alone does not prevent recoding');
    assert.equal(fs.existsSync(fx.retryDir), false);
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.ok(/Before consuming quota or amending, reject any encoding header/.test(guide), 'declared encodings stop before quota');
    assert.ok(/strictly valid UTF-8/.test(guide), 'raw message must be valid UTF-8');
    assert.ok(/i18n\.commitEncoding.*i18n\.logOutputEncoding/.test(guide), 'inspect both commit and display encodings');
  });
});

test('CI recovery uses raw objects and excludes replace refs and legacy grafts', async t => {
  for (const kind of ['replace', 'legacy graft']) await t.test(kind, t => {
    const fx = fixture(t), work = path.join(fx.root, 'work'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'isolated-global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
    const git = (args, vars = {}) => execFileSync('git', args, { cwd: work, env: { ...env, ...vars }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '-b', 'main']);
    for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(['config', key, value]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'base\n'); git(['add', 'code.txt']); git(['commit', '-s', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(work, 'code.txt'), 'original\n'); git(['add', 'code.txt']);
    git(['commit', '-s', '-m', 'original'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' });
    const original = git(['rev-parse', 'HEAD']), rawBefore = git(['--no-replace-objects', 'cat-file', 'commit', original]);
    const tree = rawBefore.match(/^tree (.+)$/m)[1];
    const alternative = git(['commit-tree', git(['rev-parse', base + '^{tree}']), '-m', 'different root']);
    const parents = raw => [...raw.split('\n\n', 1)[0].matchAll(/^parent (.+)$/gm)].map(m => m[1]);
    assert.deepEqual(parents(rawBefore), [base]);
    if (kind === 'replace') git(['replace', '--graft', original, alternative]);
    else {
      const graft = git(['rev-parse', '--path-format=absolute', '--git-path', 'info/grafts']);
      fs.mkdirSync(path.dirname(graft), { recursive: true }); fs.writeFileSync(graft, original + ' ' + alternative + '\n');
    }
    assert.equal(git(['status', '--porcelain']), '', 'ordinary status cannot detect this history overlay');
    assert.equal(git(['show', '-s', '--format=%P', original]), alternative);
    const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    if (kind === 'replace') {
      assert.equal(git(plan.originalObjectArgs ?? ['cat-file', 'commit', original]), rawBefore, 'baseline must be the raw object, not a replacement');
      // Raw-view defense is demonstrated counterfactually even though this
      // checkout is excluded by policy; no remote or quota is involved.
      git(plan.amendArgs ?? ['commit', '--amend', '--no-edit'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
      const next = git(['rev-parse', 'HEAD']);
      const nextPlan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: next,
        gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
      const rawAfter = git(nextPlan.replacementObjectArgs ?? ['cat-file', 'commit', next]);
      assert.equal(rawAfter, git(['--no-replace-objects', 'cat-file', 'commit', next]));
      assert.deepEqual(parents(rawAfter), parents(rawBefore));
    } else {
      // Legacy grafts are rejected, never repaired/converted to make recovery
      // eligible. Ordinary amend shows why raw payload comparison is necessary.
      git(['commit', '--amend', '--no-edit'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
      assert.deepEqual(parents(git(['--no-replace-objects', 'cat-file', 'commit', 'HEAD'])), [alternative]);
    }
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.ok(/Any replace ref or legacy graft makes this checkout ineligible before quota/.test(guide), 'history overlays must be excluded before quota');
    assert.equal(fs.existsSync(fx.retryDir), false);
  });
});

// Scope-policy assertions plus native counterexamples, not an executable Agent
// refusal guard or a real Cindy/GitHub recovery. All clones/remotes are private.
test('CI recovery excludes shallow head and ancestor boundaries before quota or amend', async t => {
  for (const depth of [1, 2, null]) await t.test(depth === null ? 'complete history control' : 'depth ' + depth, t => {
    const fx = fixture(t), source = path.join(fx.root, 'source'), remote = path.join(fx.root, 'remote.git'), work = path.join(fx.root, 'work');
    fs.mkdirSync(source);
    const global = path.join(fx.root, 'isolated-global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
    const git = (cwd, args, vars = {}) => execFileSync('git', args, { cwd, env: { ...env, ...vars }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const configure = cwd => {
      for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(cwd, ['config', key, value]);
    };
    const parents = raw => [...raw.split('\n\n', 1)[0].matchAll(/^parent (.+)$/gm)].map(m => m[1]);
    git(source, ['init', '-b', 'main']); configure(source);
    for (const n of [1, 2, 3]) {
      fs.writeFileSync(path.join(source, 'code.txt'), 'revision ' + n + '\n'); git(source, ['add', 'code.txt']);
      git(source, ['commit', '-s', '-m', 'revision ' + n], { GIT_COMMITTER_DATE: '2026-01-01T00:00:0' + n + 'Z' });
    }
    const original = git(source, ['rev-parse', 'HEAD']);
    const rawBefore = git(source, ['--no-replace-objects', 'cat-file', 'commit', original]);
    assert.equal(parents(rawBefore).length, 1);
    git(fx.root, ['clone', '--bare', source, remote]);
    // A file URL is necessary: --depth is ignored for ordinary local-path clones.
    git(fx.root, ['clone', ...(depth === null ? [] : ['--depth', String(depth)]), '--', pathToFileURL(remote).href, work]); configure(work);
    const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    const state = git(work, plan.shallowStateArgs ?? ['rev-parse', '--is-shallow-repository']);
    const shallowPath = git(work, plan.shallowPathArgs ?? ['rev-parse', '--path-format=absolute', '--git-path', 'shallow']);
    assert.equal(state, depth === null ? 'false' : 'true');
    assert.equal(fs.existsSync(shallowPath), depth !== null);
    const boundary = depth === null ? null : fs.readFileSync(shallowPath, 'utf8');
    assert.equal(git(work, ['rev-parse', 'HEAD']), original);
    assert.equal(git(work, ['status', '--porcelain']), '');
    assert.equal(git(work, plan.originalObjectArgs), rawBefore, 'raw payload still contains the true parent');
    // Demonstrate the old ineligible amend in this disposable clone only. At
    // depth 1 even --no-replace-objects drops the stored parent; the later raw
    // check is too late to prevent local mutation/quota consumption in recovery.
    git(work, plan.amendArgs, { GIT_COMMITTER_DATE: '2026-01-02T00:00:00Z' });
    const rawAfter = git(work, ['--no-replace-objects', 'cat-file', 'commit', 'HEAD']);
    assert.deepEqual(parents(rawAfter), depth === 1 ? [] : parents(rawBefore));
    assert.equal(git(remote, ['rev-parse', 'refs/heads/main']), original, 'no fixture push occurred');
    if (boundary !== null) assert.equal(fs.readFileSync(shallowPath, 'utf8'), boundary, 'never remove or rewrite a shallow boundary');
    assert.equal(fs.existsSync(fx.retryDir), false);
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    if (depth !== null) assert.ok(/Any shallow checkout makes this checkout ineligible before quota or amend/.test(guide), 'all shallow histories must be rejected before mutation');
  });
});


test('inherited signed-push requirements are rejected before quota and amend', t => {
  const fx = fixture(t), work = path.join(fx.root, 'work'), remote = path.join(fx.root, 'parent.git');
  const global = path.join(fx.root, 'isolated-global'); fs.writeFileSync(global, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (cwd, args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(fx.root, ['init', '--bare', '-b', 'main', remote]);
  git(fx.root, ['clone', remote, work]);
  for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(work, ['config', key, value]);
  git(work, ['commit', '--allow-empty', '-s', '-m', 'original']);
  const original = git(work, ['rev-parse', 'HEAD']), raw = git(work, ['cat-file', 'commit', 'HEAD']);
  const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
    gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
  git(work, ['config', '--file', global, 'push.gpgSign', 'true']);
  // Native counterexample: same original SHA, no reservation or amend. A local
  // bare receiver lacks signed-push capability, so the inherited request fails.
  assert.throws(() => git(work, plan.pushArgs), /does not support --signed push/);
  assert.deepEqual(Array.from(plan.pushSigningConfigArgs ?? []), ['--no-replace-objects', 'config', '--includes', '--type=bool', '--get', 'push.gpgSign']);
  assert.equal(git(work, plan.pushSigningConfigArgs), 'true');
  git(work, ['config', '--file', global, 'push.gpgSign', 'if-asked']);
  assert.throws(() => git(work, plan.pushSigningConfigArgs), /bad boolean/);
  const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(guide, /Before quota or amend, require push.gpgSign unset or false/);
  assert.match(guide, /if-asked.*unknown.*stop/i);
  assert.equal(git(work, ['rev-parse', 'HEAD']), original);
  assert.equal(git(work, ['cat-file', 'commit', 'HEAD']), raw);
  assert.equal(git(remote, ['for-each-ref']), '');
  assert.equal(fs.existsSync(fx.retryDir), false);
  assert.equal(git(work, ['config', '--get', 'push.gpgSign']), 'if-asked', 'no bypass or configuration rewrite by recovery');
});


test('occupied index and branch locks stop recovery before reservation in ordinary and linked checkouts', async t => {
  for (const linked of [false, true]) for (const locked of ['index', 'ref']) await t.test(`${linked ? 'linked' : 'ordinary'} / ${locked}`, t => {
    const fx = fixture(t), source = path.join(fx.root, 'repo'); fs.mkdirSync(source);
    const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
    const git = (cwd, args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(source, ['init', '-b', 'main']);
    for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(source, ['config', key, value]);
    for (const content of ['base', 'nonempty change']) {
      fs.writeFileSync(path.join(source, 'code.txt'), content); git(source, ['add', 'code.txt']); git(source, ['commit', '-m', content]);
    }
    if (!linked && locked === 'index') {
      const originalIndex = git(source, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
      env.GIT_INDEX_FILE = path.join(fx.root, 'alternate-index'); fs.copyFileSync(originalIndex, env.GIT_INDEX_FILE);
    }
    const work = linked ? path.join(fx.root, 'work') : source, branch = linked ? 'recovery' : 'main';
    if (linked) git(source, ['worktree', 'add', '-b', branch, work]);
    const original = git(work, ['rev-parse', 'HEAD']);
    const plan = guideArguments({ verifiedBranch: branch, verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    const paths = plan.lockPathArgs ?? ['index', 'HEAD', 'refs/heads/' + branch, 'packed-refs'].map(name => ['--no-replace-objects', 'rev-parse', '--path-format=absolute', '--git-path', name]);
    const lock = git(work, paths[locked === 'index' ? 0 : 2]) + '.lock';
    fs.writeFileSync(lock, 'fixture-held');
    assert.equal(git(work, ['status', '--porcelain=v1']), '', 'clean status is not lock readiness');
    const amend = spawnSync('git', plan.amendArgs, { cwd: work, env, encoding: 'utf8' });
    assert.notEqual(amend.status, 0); assert.match(amend.stderr, /lock|File exists/i);
    assert.equal(git(work, ['rev-parse', 'HEAD']), original);
    assert.equal(fs.readFileSync(lock, 'utf8'), 'fixture-held');
    assert.equal(fs.existsSync(fx.retryDir), false);
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.ok(/Any occupied or unreadable Git lock path stops before budget status\/reservation/.test(guide));
    assert.ok(/Never delete, replace or wait out a lock/.test(guide));
    assert.ok(plan.lockPathArgs, 'resolve Git paths instead of assuming a .git directory');
    assert.deepEqual(Array.from(plan.refFormatArgs), ['--no-replace-objects', 'rev-parse', '--show-ref-format']);
    assert.ok(/other\/unknown ref backends are outside this route/.test(guide));
  });
});

test('node-ID migration is excluded before quota instead of treating an alias as a fresh PR', () => {
  const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.ok(/Inventory every existing durable slot and legacy receipt/.test(guide));
  assert.ok(/historical: node\(id: \$storedId\)/.test(guide));
  assert.ok(/fullDatabaseId/.test(guide));
  assert.ok(/same fullDatabaseId but a different opaque ID.*stop before any budget command/.test(guide));
  assert.ok(/The receipt CLI does not discover aliases/.test(guide));
  assert.ok(/Do not decode IDs, create an alias registry, rename\/merge receipts/.test(guide));
});

test('empty root and single-parent heads are excluded before quota or amend', async t => {
  for (const kind of ['root', 'single-parent']) await t.test(kind, t => {
    const fx = fixture(t), work = path.join(fx.root, 'empty-head'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
    const git = args => execFileSync('git', args, { cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '-b', 'main']);
    for (const [name, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(['config', name, value]);
    if (kind === 'single-parent') {
      fs.writeFileSync(path.join(work, 'code.txt'), 'original code\n'); git(['add', 'code.txt']); git(['commit', '-s', '-m', 'parent']);
    }
    git(['commit', '--allow-empty', '-s', '-m', 'existing empty head']);
    const original = git(['rev-parse', 'HEAD']), raw = git(['--no-replace-objects', 'cat-file', 'commit', original]);
    const tree = raw.match(/^tree ([a-f0-9]+)/m)[1], parents = [...raw.matchAll(/^parent ([a-f0-9]+)/gm)].map(m => m[1]);
    if (kind === 'root') assert.equal(git(['--no-replace-objects', 'cat-file', '-s', tree]), '0');
    else assert.equal(git(['--no-replace-objects', 'cat-file', 'commit', parents[0]]).match(/^tree ([a-f0-9]+)/m)[1], tree);
    const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    const amend = spawnSync('git', plan.amendArgs, { cwd: work, env, encoding: 'utf8' });
    assert.notEqual(amend.status, 0, 'native counterexample: default amend refuses the empty head');
    assert.equal(git(['rev-parse', 'HEAD']), original);
    assert.equal(git(['cat-file', 'commit', original]), raw);
    assert.equal(fs.existsSync(fx.retryDir), false);
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.match(guide, /Before quota or amend, reject an empty root or single-parent head/);
    assert.match(guide, /sole parent's raw tree/);
    assert.match(guide, /root.*cat-file.*-s.*zero/i);
  });
});

test('empty and whitespace-only raw messages are excluded before quota or amend', async t => {
  for (const [label, message] of [['empty', ''], ['blank lines', '\n\n'], ['ASCII whitespace', ' \t\r\n'], ['ordinary control', 'original intent\n'], ['verbatim comment control', '# literal intent\n']]) await t.test(label, t => {
    const fx = fixture(t), work = path.join(fx.root, 'message-head'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
    const git = (args, encoding = 'utf8') => execFileSync('git', args, { cwd: work, env, encoding, stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-b', 'main']);
    for (const [name, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(['config', name, value]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'base\n'); git(['add', 'code.txt']); git(['commit', '-m', 'base']);
    fs.writeFileSync(path.join(work, 'code.txt'), 'nonempty change\n'); git(['add', 'code.txt']);
    const messageFile = path.join(fx.root, 'message'); fs.writeFileSync(messageFile, message);
    git(['commit', '--allow-empty-message', '--cleanup=verbatim', '-F', messageFile]);
    const original = git(['rev-parse', 'HEAD']).trim(), raw = git(['--no-replace-objects', 'cat-file', 'commit', original], 'buffer');
    const rawMessage = bytes => bytes.subarray(bytes.indexOf(Buffer.from('\n\n')) + 2);
    assert.deepEqual(rawMessage(raw), Buffer.from(message));
    const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    // Native counterexample/control only: no quota operation, remote or DCO repair.
    const amend = spawnSync('git', plan.amendArgs, { cwd: work, env: { ...env, GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' }, encoding: 'utf8' });
    if (message.trim() === '') {
      assert.notEqual(amend.status, 0);
      assert.match(amend.stderr, /empty commit message/);
      assert.equal(git(['rev-parse', 'HEAD']).trim(), original);
    } else {
      assert.equal(amend.status, 0, amend.stderr);
      assert.notEqual(git(['rev-parse', 'HEAD']).trim(), original);
      assert.deepEqual(rawMessage(git(['cat-file', 'commit', 'HEAD'], 'buffer')), rawMessage(raw));
    }
    assert.equal(fs.existsSync(fx.retryDir), false);
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.ok(/Before quota or amend, reject an empty or whitespace-only original raw message/.test(guide));
    assert.ok(/even when DCO trailers would be added/.test(guide));
    assert.ok(/Do not add `--allow-empty-message`/.test(guide));
    assert.ok(/Recheck the pinned raw message before budget status\/reservation, amend and push/.test(guide));
  });
});

test('NUL-bearing raw messages are excluded before quota rather than discovered after amend', async t => {
  for (const message of ['\0intent\n', 'foo\0bar\n', 'intent\n\0']) await t.test(JSON.stringify(message), t => {
    const fx = fixture(t), work = path.join(fx.root, 'nul-head'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
    const git = (args, input, encoding = 'utf8') => execFileSync('git', args, { cwd: work, env, input, encoding, stdio: ['pipe', 'pipe', 'pipe'] });
    git(['init', '-b', 'main']);
    for (const [name, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(['config', name, value]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'base\n'); git(['add', 'code.txt']); git(['commit', '-m', 'base']);
    fs.writeFileSync(path.join(work, 'code.txt'), 'nonempty change\n'); git(['add', 'code.txt']); git(['commit', '-m', 'intent']);
    const raw = git(['cat-file', 'commit', 'HEAD'], undefined, 'buffer');
    const rawMessage = bytes => bytes.subarray(bytes.indexOf(Buffer.from('\n\n')) + 2);
    const originalBytes = Buffer.concat([raw.subarray(0, raw.indexOf(Buffer.from('\n\n')) + 2), Buffer.from(message)]);
    const original = git(['hash-object', '--literally', '-t', 'commit', '-w', '--stdin'], originalBytes).trim(); git(['update-ref', 'refs/heads/main', original]);
    assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(rawMessage(originalBytes)), message, 'UTF-8 validation alone accepts NUL');
    assert.ok(/\S/u.test(message), 'non-whitespace validation alone accepts NUL');
    const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    // Counterexample only, not a recovery: no quota, remote, push or message repair.
    const amend = spawnSync('git', plan.amendArgs, { cwd: work, env: { ...env, GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' }, encoding: 'utf8' });
    if (message.startsWith('\0')) {
      assert.notEqual(amend.status, 0); assert.equal(git(['rev-parse', 'HEAD']).trim(), original);
    } else {
      assert.equal(amend.status, 0, amend.stderr);
      const next = git(['cat-file', 'commit', 'HEAD'], undefined, 'buffer');
      assert.notDeepEqual(rawMessage(next), Buffer.from(message), 'verbatim/no-edit still truncates at NUL');
      assert.equal(rawMessage(next).includes(0), false);
    }
    assert.deepEqual(git(['cat-file', 'commit', original], undefined, 'buffer'), originalBytes);
    assert.equal(fs.existsSync(fx.retryDir), false);
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.ok(/reject any NUL \(U\+0000\/0x00\) anywhere in the original raw message/.test(guide));
    assert.ok(/Never strip, replace or truncate a NUL/.test(guide));
  });
});

test('CI-only recovery excludes every other open consumer of the exact head ref', () => {
  const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.ok(/Only the current PR may be an open consumer of the exact head repository\/ref/.test(guide));
  const query = guide.match(/```graphql (query HeadConsumers[\s\S]*?) ```/)?.[1];
  assert.ok(query, 'use the head Ref connection, not current-base PR listings or commit associations');
  for (const field of ['associatedPullRequests(first: 100, after: $cursor, states: [OPEN])', 'totalCount', 'hasNextPage endCursor', 'id state headRefName headRefOid headRepository { id }']) assert.ok(query.includes(field), field);
  assert.equal(/baseRefName:|labels:|headRefName:/.test(query), false, 'do not exclude consumers by base or labels');
  assert.ok(/Another open PR always stops recovery/.test(guide));
  assert.ok(/Incomplete visibility, GraphQL errors or partial data/.test(guide));
  assert.ok(/Re-read all consumer pages before budget status\/reservation, amend and push/.test(guide));
});

test('unsigned heads cannot inherit automatic signing before quota or amend', t => {
  const fx = fixture(t), work = path.join(fx.root, 'unsigned'); fs.mkdirSync(work);
  const key = path.join(fx.root, 'key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ada@example.test', '-f', key], { stdio: 'pipe' });
  const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  const git = args => execFileSync('git', args, { cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-b', 'main']);
  for (const [name, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'true'], ['gpg.format', 'ssh'], ['user.signingkey', key]]) git(['config', name, value]);
  fs.writeFileSync(path.join(work, 'code.txt'), 'original code\n'); git(['add', 'code.txt']); git(['commit', '--no-gpg-sign', '-s', '-m', 'unsigned original']);
  const original = git(['rev-parse', 'HEAD']);
  assert.doesNotMatch(git(['cat-file', 'commit', original]), /^gpgsig(?:-sha256)? /m);
  const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
    gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
  // Native counterexample only, no real recovery: inherited signing changes provenance.
  git(plan.amendArgs); assert.match(git(['cat-file', 'commit', 'HEAD']), /^gpgsig /m);
  assert.equal(git(['config', '--type=bool', '--get', 'commit.gpgSign']), 'true');
  assert.equal(fs.existsSync(fx.retryDir), false);
  const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(guide, /For an unsigned original, require commit.gpgSign unset or false before quota or amend/);
  assert.match(guide, /unsigned original.*replacement.*gpgsig.*stop.*unpushed/i);
});

test('a surviving higher slot makes an earlier receipt hole fail closed across status, reserve and migration', async t => {
  for (const legacy of [false, true]) for (const mode of ['--ci-retry-status', '--reserve-ci-retry']) for (const sameFailure of [false, true]) await t.test(`${legacy ? 'legacy' : 'no legacy'} / ${mode} / ${sameFailure ? 'surviving diagnosis' : 'new diagnosis'}`, t => {
    const fx = fixture(t), loader = path.join(fx.root, 'supported-sync.mjs');
    // Only sync acknowledgements are modeled; all receipt/CLI operations use
    // real isolated files. This is not native durability or Cindy recovery.
    fs.writeFileSync(loader, `import fs from 'node:fs';
fs.fsyncSync = () => {};
const { runGate } = await import(process.argv[2]);
process.exitCode = await runGate(process.argv.slice(3));
`);
    const run = (flags, stateDir = fx.stateDir) => {
      const argv = fx.args(flags); argv[argv.indexOf('--state-dir') + 1] = stateDir;
      return spawnSync(process.execPath, [loader, pathToFileURL(gate).href, ...argv], { env: fx.env, encoding: 'utf8' });
    };
    const first = run(['--reserve-ci-retry', oldHead]); assert.equal(first.status, 0, first.stderr);
    const firstFile = ciRetryFilePath(fx.retryDir, prNodeId) + '-1.slot', secondFile = ciRetryFilePath(fx.retryDir, prNodeId) + '-2.slot';
    const firstRaw = fs.readFileSync(firstFile, 'utf8');
    const secondFailure = { ...failure, cause: 'second independent fault' };
    fs.writeFileSync(fx.diagnosis, JSON.stringify(secondFailure));
    const second = run(['--reserve-ci-retry', newHead]); assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).pr_consumed, 2);
    const secondRaw = fs.readFileSync(secondFile, 'utf8');
    fs.mkdirSync(fx.stateDir, { recursive: true });
    const observation = stateFilePath(fx.stateDir, 'example/repo', 42), originalState = '{"headOid":"ordinary-observation"}';
    fs.writeFileSync(observation, originalState);
    if (legacy) fs.writeFileSync(ciRetryFilePath(fx.stateDir, prNodeId, failure), firstRaw);
    // Test-only partial erasure. Never touches the user's receipts or quota.
    fs.unlinkSync(firstFile);
    fs.writeFileSync(fx.diagnosis, JSON.stringify(sameFailure ? secondFailure : { ...failure, cause: 'third independent fault' }));
    const flags = [mode, ...(mode === '--reserve-ci-retry' ? ['c'.repeat(40)] : [])];
    for (const stateDir of [fx.stateDir, path.join(fx.root, 'new-cache')]) {
      const result = run(flags, stateDir); // fresh process on each invocation
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /non-contiguous CI retry receipts.*reconcile/i);
      assert.doesNotMatch(result.stdout, /ci-retry-reserved|"available":true/);
      assert.equal(fs.existsSync(firstFile), false, 'never refill the missing earlier slot');
      assert.equal(fs.readFileSync(secondFile, 'utf8'), secondRaw, 'keep the proof of both consumed attempts');
      assert.equal(fs.readFileSync(observation, 'utf8'), originalState);
    }
    if (legacy) {
      assert.equal(fs.readFileSync(ciRetryFilePath(fx.stateDir, prNodeId, failure), 'utf8'), firstRaw);
      assert.equal(fs.readFileSync(ciRetryFilePath(fx.retryDir, prNodeId, failure), 'utf8'), firstRaw, 'raw legacy copy remains preserved without repairing slots');
    }
  });
});

test('alternate-root absence never follows a visible ancestor link to grant quota', async t => {
  for (const mode of ['--ci-retry-status', '--reserve-ci-retry']) for (const location of ['namespace parent', 'selected base', 'base ancestor']) await t.test(`${mode} / ${location}`, t => {
    const fx = fixture(t), base = path.join(fx.root, 'durable');
    const selected = location === 'base ancestor' ? path.join(base, 'child') : base;
    const link = location === 'namespace parent' ? path.join(base, 'cindy-pr') : base;
    const missing = path.join(fx.root, 'unavailable-storage'), stored = path.join(fx.root, 'preserved-storage');
    const legacy = path.join(stored, ...(location === 'namespace parent' ? [] : location === 'selected base' ? ['cindy-pr'] : ['child', 'cindy-pr']), 'ci-retry');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.mkdirSync(legacy, { recursive: true });
    const raw = '{old result is unknown; retain original bytes';
    fs.writeFileSync(path.join(legacy, 'old-receipt'), raw);
    fs.symlinkSync(missing, link, process.platform === 'win32' ? 'junction' : 'dir');
    const originalLink = fs.readlinkSync(link);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.existsSync(link), false, 'native dangling directory link, not a missing directory');
    fs.mkdirSync(fx.stateDir);
    const observation = stateFilePath(fx.stateDir, 'example/repo', 42), observed = '{"headOid":"ordinary-state"}';
    fs.writeFileSync(observation, observed);
    const loader = path.join(fx.root, 'supported-link-root.mjs');
    fs.writeFileSync(loader, `import fs from 'node:fs';
// Native fixture links/files; sync acknowledgements modeled on Windows.
fs.fsyncSync = () => {};
const { runGate } = await import(process.argv[2]);
process.exitCode = await runGate(process.argv.slice(3));
`);
    const canonical = path.join(selected, 'Cindy', 'pr-recovery');
    const invoke = () => spawnSync(process.execPath, [loader, pathToFileURL(gate).href, ...fx.args([mode, ...(mode === '--reserve-ci-retry' ? [oldHead] : [])])],
      { env: { ...fx.env, XDG_STATE_HOME: selected }, encoding: 'utf8' });
    for (const restored of [false, true]) {
      if (restored) fs.renameSync(stored, missing); // test-only storage becomes visible
      const result = invoke(); // separate process rechecks the same visible link
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /alternate CI retry root.*reconcile/i);
      assert.doesNotMatch(result.stdout, /ci-retry-reserved|"available":true/);
      assert.equal(fs.existsSync(canonical), false, 'no new canonical store or slot');
      assert.equal(fs.readlinkSync(link), originalLink, 'never remove or repair the link');
      assert.equal(fs.readFileSync(observation, 'utf8'), observed);
      const kept = restored ? path.join(missing, path.relative(stored, legacy), 'old-receipt') : path.join(legacy, 'old-receipt');
      assert.equal(fs.readFileSync(kept, 'utf8'), raw);
      assert.deepEqual(fs.readdirSync(fx.stateDir), [path.basename(observation)], 'no trace or legacy copy');
    }
  });
});

test('equivalent default XDG settings share quota and old alternate roots fail closed', async t => {
  for (const initialExplicit of [false, true]) await t.test(initialExplicit ? 'explicit to implicit' : 'implicit to explicit', t => {
  const fx = fixture(t), loader = path.join(fx.root, 'supported-roots.mjs');
  fs.writeFileSync(loader, `import fs from 'node:fs';
import os from 'node:os';
// Supported-filesystem model, not Linux or power-loss runtime evidence.
Object.defineProperty(process, 'platform', { value: 'linux' });
os.homedir = () => process.env.RECEIPT_TEST_HOME;
fs.fsyncSync = () => {};
const { runGate } = await import(process.argv[2]);
process.exitCode = await runGate(process.argv.slice(3));
`);
  const base = path.join(fx.root, '.local', 'state'), canonical = path.join(base, 'Cindy', 'pr-recovery'), alternate = path.join(base, 'cindy-pr', 'ci-retry');
  const run = (xdg, flags) => {
    const env = { ...fx.env, RECEIPT_TEST_HOME: fx.root }; if (xdg) env.XDG_STATE_HOME = base; else delete env.XDG_STATE_HOME;
    return spawnSync(process.execPath, [loader, pathToFileURL(gate).href, ...fx.args(flags)], { env, encoding: 'utf8' });
  };
  const reserved = run(initialExplicit, ['--reserve-ci-retry', oldHead]); assert.equal(reserved.status, 0, reserved.stderr);
  const before = fs.readdirSync(canonical).map(n => [n, fs.readFileSync(path.join(canonical, n), 'utf8')]);
  const status = run(!initialExplicit, ['--ci-retry-status']); assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).pr_consumed, 1); assert.equal(JSON.parse(status.stdout).available, false);
  assert.equal(run(!initialExplicit, ['--reserve-ci-retry', oldHead]).status, 1);
  for (const [name, raw] of before) assert.equal(fs.readFileSync(path.join(canonical, name), 'utf8'), raw);
  // Earlier explicit-default versions used another namespace. Never treat even
  // an empty or malformed alternate directory as proof of fresh quota.
  fs.mkdirSync(alternate, { recursive: true });
  assert.equal(run(initialExplicit, ['--ci-retry-status']).status, 1, 'even an empty old namespace is uncertain');
  fs.writeFileSync(path.join(alternate, 'unknown.slot'), 'unknown earlier outcome');
  for (const xdg of [false, true]) {
    const blocked = run(xdg, ['--ci-retry-status']); assert.equal(blocked.status, 1); assert.match(blocked.stderr, /alternate CI retry root.*reconcile/i);
    assert.doesNotMatch(blocked.stdout, /"available":true/);
  }
  assert.equal(fs.readFileSync(path.join(alternate, 'unknown.slot'), 'utf8'), 'unknown earlier outcome');
  });
});


test('lost confirmed receipt directory stops actual status and reservation instead of granting quota', async t => {
  for (const mode of ['--ci-retry-status', '--reserve-ci-retry']) await t.test(mode, t => {
    const fx = fixture(t), moved = path.join(fx.root, 'moved-receipts'); fs.mkdirSync(fx.retryDir, { recursive: true });
    const name = path.basename(ciRetryFilePath(fx.retryDir, prNodeId)) + '-1.slot';
    const raw = JSON.stringify({ prNodeId, failure, sourceHead: oldHead, reservedAt: 123 });
    fs.writeFileSync(path.join(fx.retryDir, name), raw);
    const loader = path.join(fx.root, 'lose-parent.mjs');
    fs.writeFileSync(loader, `import fs from 'node:fs';
// Supported-filesystem model; never alters real user receipts.
fs.fsyncSync = () => {};
const open = fs.openSync; let moved = false;
fs.openSync = (file, ...rest) => {
  if (!moved && String(file).endsWith('.slot')) { moved = true; fs.renameSync(process.env.TEST_RECEIPT_DIR, process.env.TEST_MOVED_DIR); }
  return open(file, ...rest);
};
const { runGate } = await import(process.argv[2]);
process.exitCode = await runGate(process.argv.slice(3));
`);
    const result = spawnSync(process.execPath, [loader, pathToFileURL(gate).href, ...fx.args([mode, ...(mode === '--reserve-ci-retry' ? [oldHead] : [])])], {
      env: { ...fx.env, TEST_RECEIPT_DIR: fx.retryDir, TEST_MOVED_DIR: moved }, encoding: 'utf8',
    });
    assert.equal(result.status, 1); assert.match(result.stderr, /confirmed.*directory disappeared/);
    assert.doesNotMatch(result.stdout, /"available":true|ci-retry-reserved/);
    assert.equal(fs.existsSync(fx.retryDir), false);
    assert.equal(fs.readFileSync(path.join(moved, name), 'utf8'), raw);
    assert.equal(fs.readdirSync(moved).length, 1);
  });
});

test('missing committer identity is rejected read-only before reservation', t => {
  const fx = fixture(t), work = path.join(fx.root, 'identity'); fs.mkdirSync(work);
  const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete env[key];
  const identity = { GIT_AUTHOR_NAME: 'Ada Example', GIT_AUTHOR_EMAIL: 'ada@example.test', GIT_COMMITTER_NAME: 'Ada Example', GIT_COMMITTER_EMAIL: 'ada@example.test' };
  const git = (args, extra = {}) => spawnSync('git', args, { cwd: work, env: { ...env, ...extra }, encoding: 'utf8' });
  assert.equal(git(['init', '-b', 'main']).status, 0);
  assert.equal(git(['config', 'user.useConfigOnly', 'true']).status, 0);
  assert.equal(git(['config', 'commit.gpgSign', 'false']).status, 0);
  fs.writeFileSync(path.join(work, 'code.txt'), 'original code\n'); assert.equal(git(['add', 'code.txt']).status, 0);
  assert.equal(git(['commit', '-s', '-m', 'original'], identity).status, 0);
  const original = git(['rev-parse', 'HEAD']).stdout.trim();
  const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
    gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
  const expected = ['--no-replace-objects', 'var', 'GIT_COMMITTER_IDENT'];
  assert.notEqual(git(expected).status, 0);
  const amend = git(plan.amendArgs); assert.notEqual(amend.status, 0); assert.match(amend.stderr, /identity unknown|empty ident|unable to auto-detect/i);
  assert.equal(git(['rev-parse', 'HEAD']).stdout.trim(), original);
  assert.equal(git(expected, identity).status, 0, 'environment-only identity is supported without changing config');
  assert.notEqual(git(expected, { ...identity, GIT_COMMITTER_DATE: 'invalid date' }).status, 0);
  assert.equal(git(['config', '--get', 'user.name']).status, 1);
  assert.equal(fs.existsSync(fx.retryDir), false);
  assert.deepEqual(Array.from(plan.committerIdentArgs ?? []), expected);
  const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(guide, /Before quota or amend, resolve the committer identity with committerIdentArgs/);
});


test('second reservation stops if prepare loses the already-consumed store before mkdir', t => {
  const fx = fixture(t), moved = path.join(fx.root, 'moved-after-read'); fs.mkdirSync(fx.retryDir, { recursive: true });
  const name = path.basename(ciRetryFilePath(fx.retryDir, prNodeId)) + '-1.slot';
  const raw = JSON.stringify({ prNodeId, failure, sourceHead: oldHead, reservedAt: 123 }); fs.writeFileSync(path.join(fx.retryDir, name), raw);
  fs.writeFileSync(fx.diagnosis, JSON.stringify({ ...failure, cause: 'different runner network timeout' }));
  const loader = path.join(fx.root, 'lose-prepare.mjs');
  fs.writeFileSync(loader, `import fs from 'node:fs';
import path from 'node:path';
const handles = new Map(), open = fs.openSync, close = fs.closeSync, read = fs.readFileSync, stat = fs.statSync;
let sawFirst = false, preparing = false, moved = false;
fs.openSync = (file, ...args) => { const fd = open(file, ...args); handles.set(fd, String(file)); return fd; };
fs.closeSync = fd => { close(fd); handles.delete(fd); };
fs.readFileSync = (file, ...args) => { const result = read(file, ...args); if (handles.get(file)?.endsWith('-1.slot')) sawFirst = true; return result; };
fs.statSync = (file, ...args) => { const result = stat(file, ...args); if (sawFirst && path.resolve(String(file)) === path.resolve(process.env.TEST_RECEIPT_DIR) && new Error().stack.includes('at prepare (')) preparing = true; return result; };
// Arm only inside prepare after first-slot read, independent of stat count.
// Root is prepare confirmation's last flush, immediately before mkdir.
fs.fsyncSync = fd => { if (preparing && !moved && handles.get(fd) === path.parse(process.env.TEST_RECEIPT_DIR).root) { moved = true; fs.renameSync(process.env.TEST_RECEIPT_DIR, process.env.TEST_MOVED_DIR); } };
const { runGate } = await import(process.argv[2]);
process.exitCode = await runGate(process.argv.slice(3));
`);
  const result = spawnSync(process.execPath, [loader, pathToFileURL(gate).href, ...fx.args(['--reserve-ci-retry', newHead])], {
    env: { ...fx.env, TEST_RECEIPT_DIR: fx.retryDir, TEST_MOVED_DIR: moved }, encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /durability could not be confirmed/);
  assert.doesNotMatch(result.stdout, /ci-retry-reserved|"pr_remaining":1/);
  assert.equal(fs.existsSync(fx.retryDir), false);
  assert.equal(fs.readFileSync(path.join(moved, name), 'utf8'), raw);
  assert.deepEqual(fs.readdirSync(moved), [name]);
});


test('same-path store replacement stops actual status and reservation without new quota', async t => {
  for (const mode of ['--ci-retry-status', '--reserve-ci-retry']) await t.test(mode, t => {
    const fx = fixture(t), moved = path.join(fx.root, 'replaced-store'); fs.mkdirSync(fx.retryDir, { recursive: true });
    const name = path.basename(ciRetryFilePath(fx.retryDir, prNodeId)) + '-1.slot';
    const raw = JSON.stringify({ prNodeId, failure, sourceHead: oldHead, reservedAt: 123 }); fs.writeFileSync(path.join(fx.retryDir, name), raw);
    const loader = path.join(fx.root, 'replace-store.mjs');
    fs.writeFileSync(loader, `import fs from 'node:fs';
fs.fsyncSync = () => {}; // supported-sync model, no real user receipts
const open = fs.openSync; let swapped = false;
fs.openSync = (file, ...args) => {
  if (!swapped && String(file).endsWith('.slot')) { swapped = true; fs.renameSync(process.env.TEST_RECEIPT_DIR, process.env.TEST_MOVED_DIR); fs.mkdirSync(process.env.TEST_RECEIPT_DIR); }
  return open(file, ...args);
};
const { runGate } = await import(process.argv[2]);
process.exitCode = await runGate(process.argv.slice(3));
`);
    const result = spawnSync(process.execPath, [loader, pathToFileURL(gate).href, ...fx.args([mode, ...(mode === '--reserve-ci-retry' ? [oldHead] : [])])], {
      env: { ...fx.env, TEST_RECEIPT_DIR: fx.retryDir, TEST_MOVED_DIR: moved }, encoding: 'utf8',
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /directory identity changed/);
    assert.doesNotMatch(result.stdout, /"available":true|ci-retry-reserved/);
    assert.deepEqual(fs.readdirSync(fx.retryDir), []);
    assert.equal(fs.readFileSync(path.join(moved, name), 'utf8'), raw);
  });
});

test('a pinned original committer line is rejected before consuming a no-op amend attempt', async t => {
  for (const same of [true, false]) await t.test(same ? 'same complete ident' : 'new committer date', t => {
    const fx = fixture(t), work = path.join(fx.root, 'pinned-date'); fs.mkdirSync(work);
    const global = path.join(fx.root, 'global'); fs.writeFileSync(global, '');
    const originalDate = '2026-01-02T00:00:00Z';
    const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_DATE: originalDate, GIT_COMMITTER_DATE: originalDate };
    const git = (args, extra = {}) => execFileSync('git', args, { cwd: work, env: { ...env, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '-b', 'main']);
    for (const [name, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgSign', 'false']]) git(['config', name, value]);
    fs.writeFileSync(path.join(work, 'code.txt'), 'parent\n'); git(['add', 'code.txt']); git(['commit', '-s', '-m', 'parent'], { GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' });
    fs.writeFileSync(path.join(work, 'code.txt'), 'nonempty head\n'); git(['add', 'code.txt']); git(['commit', '-s', '-m', 'original']);
    const original = git(['rev-parse', 'HEAD']), raw = git(['--no-replace-objects', 'cat-file', 'commit', original]);
    const header = raw.slice(0, raw.indexOf('\n\n')).match(/^committer (.+)$/m)[1];
    const plan = guideArguments({ verifiedBranch: 'main', verifiedRemote: 'origin', originalRemoteSha: original, newSha: original,
      gatePath: gate, prUrl: url, prNodeId, diagnosisPath: fx.diagnosis, observationStateDir: fx.stateDir });
    const actualEnv = same ? {} : { GIT_COMMITTER_DATE: '2026-01-02T00:01:00Z' };
    assert.equal(git(plan.committerIdentArgs, actualEnv) === header, same);
    git(plan.amendArgs, actualEnv); // native counterexample/contrast, no reservation or remote
    assert.equal(git(['rev-parse', 'HEAD']) === original, same);
    assert.equal(git(['config', '--get', 'user.name']), 'Ada Example');
    assert.equal(env.GIT_COMMITTER_DATE, originalDate, 'never mutate caller environment');
    assert.equal(fs.existsSync(fx.retryDir), false);
    const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.match(guide, /Require the complete resolved committer line to differ from the original raw committer header before quota or amend/);
  });
});
