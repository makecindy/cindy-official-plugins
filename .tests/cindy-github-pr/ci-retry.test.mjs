import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runGate, stateFilePath, ciRetryFilePath, ciRetryDataDir } from '../../cindy-github/skills/pr/scripts/pr-heartbeat-gate.mjs';

const gate = fileURLToPath(new URL('../../cindy-github/skills/pr/scripts/pr-heartbeat-gate.mjs', import.meta.url));
const url = 'https://github.com/example/repo/pull/42';
const prNodeId = 'PR_exampleImmutableId';
const oldHead = 'a'.repeat(40), newHead = 'b'.repeat(40);
const failure = { workflow: '.github/workflows/verify.yml', job: 'verify', step: 'install dependencies', cause: 'package store unavailable' };

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
    root, stateDir, retryDir, diagnosis,
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
    process(flags) {
      return new Promise(resolve => execFile(process.execPath, [gate, ...args(flags)], { env }, (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stdout, stderr });
      }));
    },
  };
}

test('same failure budget survives changed SHAs, observation resets, casing and follow-up restarts', async t => {
  const fx = fixture(t);
  assert.equal((await fx.run(['--ci-retry-status'])).result.available, true);
  assert.equal(fs.existsSync(fx.stateDir), false, 'status is read-only');
  assert.equal(fs.existsSync(fx.retryDir), false, 'unused status creates no receipt or directory');
  const first = await fx.run(['--reserve-ci-retry', oldHead]);
  assert.equal(first.code, 0);
  assert.equal(first.result.reason, 'ci-retry-reserved');
  assert.equal(first.result.reservation.sourceHead, oldHead);
  assert.equal(first.result.reservation_only, true, 'budget does not assert safety or grant permission');
  const file = stateFilePath(fx.stateDir, 'example/repo', 42);
  fs.mkdirSync(fx.stateDir, { recursive: true });
  fs.writeFileSync(file, '{}');
  await fx.run(['--resume', 'observed a new head']);
  fs.unlinkSync(file);
  const repeated = await fx.process(['--reserve-ci-retry', newHead]);
  assert.equal(repeated.code, 1);
  assert.match(repeated.stderr, /already consumed/);
  assert.equal((await fx.run(['--reserve-ci-retry', newHead], 'https://github.com/EXAMPLE/REPO/pull/42')).code, 1);
  assert.equal((await fx.run(['--ci-retry-status'])).result.reservation.sourceHead, oldHead);
  assert.equal((await fx.run(['--ci-retry-status'], 'https://github.com/example/renamed/pull/42')).result.available, false, 'repository rename preserves PR identity');
  assert.equal((await fx.run(['--reserve-ci-retry', newHead], 'https://github.com/new-owner/transferred/pull/42')).code, 1, 'repository transfer cannot restore the budget');
  assert.notEqual(ciRetryFilePath(fx.stateDir, prNodeId, failure), ciRetryFilePath(fx.stateDir, 'PR_anotherImmutableId', failure));
});

test('two distinct failures consume the PR total and a third stops regardless of diagnosis', async t => {
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

test('concurrent distinct failures cannot exceed two total reservations across processes', async t => {
  const fx = fixture(t);
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => {
    const diagnosis = path.join(fx.root, `fault-${i}.json`);
    fs.writeFileSync(diagnosis, JSON.stringify({ ...failure, cause: `isolated fixture fault ${i}` }));
    return fx.process(['--ci-retry-failure', diagnosis, '--reserve-ci-retry', oldHead]);
  }));
  assert.equal(results.filter(r => r.code === 0).length, 2);
  assert.equal((await fx.run(['--ci-retry-status'])).result.available, false);
});

test('earlier different-failure receipts count toward the total even when querying a new failure', async t => {
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

test('one old receipt leaves only one slot; over-limit legacy history and damaged slots stop recovery', async t => {
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

test('legacy history beyond two fails closed and another PR has its own total', async t => {
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

test('missing, invalid and legacy diagnosis evidence cannot start a new retry', async t => {
  const fx = fixture(t);
  let error = '';
  assert.equal(await runGate([url, '--ci-retry-id', prNodeId, '--reserve-ci-retry', oldHead], { out() {}, err: text => { error += text; } }), 1);
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

test('CI reservation is atomic across processes and never refunded after an interrupted operation', async t => {
  const fx = fixture(t);
  const results = await Promise.all([fx.process(['--reserve-ci-retry', oldHead]), fx.process(['--reserve-ci-retry', newHead])]);
  assert.deepEqual(results.map(r => r.code).sort(), [0, 1]);
  assert.equal((await fx.run(['--ci-retry-status'])).result.available, false);
  assert.equal((await fx.run(['--reserve-ci-retry', oldHead])).code, 1);
});

test('durable quota survives cache deletion and adopts earlier cache evidence without overwriting receipts', async t => {
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
    const code = await runGate([url, '--state-dir', fx.stateDir, ...option], { out() {}, err: text => { error += text; } });
    assert.equal(code, 1);
    assert.match(error, /requires --ci-retry-id/);
  }
  assert.equal(fs.existsSync(fx.stateDir), false);
});

test('unreconciled old evidence remains fail-closed after cache deletion and restart', async t => {
  for (const kind of ['no diagnosis', 'broken JSON', 'invalid diagnosis']) await t.test(kind, async t => {
    const fx = fixture(t);
    fs.mkdirSync(fx.stateDir);
    const oldFailure = kind === 'invalid diagnosis' ? { ...failure, cause: '' } : undefined;
    const cached = ciRetryFilePath(fx.stateDir, prNodeId, oldFailure);
    const bytes = kind === 'broken JSON' ? '{' : JSON.stringify({ prNodeId, sourceHead: oldHead, reservedAt: 123, ...(oldFailure ? { failure: oldFailure } : {}) });
    fs.writeFileSync(cached, bytes);
    assert.equal((await fx.process(['--ci-retry-status'])).code, 1);
    assert.equal(fs.readFileSync(path.join(fx.retryDir, path.basename(cached)), 'utf8'), bytes, 'preserve raw evidence before rejecting it');
    assert.equal(path.relative(fx.root, path.resolve(fx.stateDir)), 'state');
    fs.rmSync(fx.stateDir, { recursive: true });
    assert.equal((await fx.process(['--ci-retry-status'])).code, 1, 'a new process must not restore the quota');
    assert.equal((await fx.process(['--state-dir', path.join(fx.root, 'replacement-cache'), '--reserve-ci-retry', newHead])).code, 1);
  });
});

test('opaque legacy GitHub PR IDs work in CLI, old evidence adoption and durable slots', async t => {
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

test('invalid, damaged and unwritable CI evidence fails closed without consuming ordinary gate state', async t => {
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
test('isolated Git fixture preserves tree/author/DCO and an exact lease refuses an intervening commit', async t => {
  const fx = fixture(t);
  const remote = path.join(fx.root, 'remote.git'), work = path.join(fx.root, 'work'), other = path.join(fx.root, 'other');
  const git = (cwd, argv, env = {}) => execFileSync('git', argv, {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git(fx.root, ['init', '--bare', '-b', 'main', remote]);
  git(fx.root, ['clone', remote, work]);
  for (const [key, value] of [['user.name', 'Ada Example'], ['user.email', 'ada@example.test'], ['commit.gpgsign', 'false']]) git(work, ['config', key, value]);
  fs.writeFileSync(path.join(work, 'code.txt'), 'original tree\n');
  git(work, ['add', 'code.txt']);
  git(work, ['commit', '-s', '-m', 'fixture intent'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' });
  git(work, ['switch', '-c', 'ci-fixture']);
  git(work, ['push', 'origin', 'HEAD:refs/heads/ci-fixture']);
  const before = git(work, ['rev-parse', 'HEAD']);
  const tree = git(work, ['rev-parse', 'HEAD^{tree}']);
  const authorAndMessage = git(work, ['show', '-s', '--format=%an%n%ae%n%aI%n%P%n%B', 'HEAD']);
  assert.equal(git(work, ['ls-remote', '--heads', 'origin', 'refs/heads/ci-fixture']).split(/\s/)[0], before);
  assert.equal((await fx.run(['--reserve-ci-retry', before])).code, 0);
  git(work, ['commit', '--amend', '--no-edit'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
  const after = git(work, ['rev-parse', 'HEAD']);
  assert.notEqual(after, before);
  assert.equal(git(work, ['rev-parse', 'HEAD^{tree}']), tree);
  assert.equal(git(work, ['show', '-s', '--format=%an%n%ae%n%aI%n%P%n%B', 'HEAD']), authorAndMessage);
  assert.match(authorAndMessage, /Signed-off-by: Ada Example <ada@example\.test>/);
  git(work, ['push', `--force-with-lease=refs/heads/ci-fixture:${before}`, 'origin', 'HEAD:refs/heads/ci-fixture']);
  assert.equal(git(work, ['ls-remote', '--heads', 'origin', 'refs/heads/ci-fixture']).split(/\s/)[0], after);
  assert.equal((await fx.run(['--reserve-ci-retry', after])).code, 1);

  // A collaborator advances the ref; reusing the original verified SHA must fail.
  git(fx.root, ['clone', '--branch', 'ci-fixture', remote, other]);
  for (const [key, value] of [['user.name', 'Other Example'], ['user.email', 'other@example.test'], ['commit.gpgsign', 'false']]) git(other, ['config', key, value]);
  fs.writeFileSync(path.join(other, 'other.txt'), 'collaborator\n');
  git(other, ['add', 'other.txt']);
  git(other, ['commit', '-s', '-m', 'intervening work']);
  git(other, ['push', 'origin', 'HEAD:refs/heads/ci-fixture']);
  const intervening = git(other, ['rev-parse', 'HEAD']);
  assert.throws(() => git(work, ['push', `--force-with-lease=refs/heads/ci-fixture:${after}`, 'origin', 'HEAD:refs/heads/ci-fixture']), /stale info|rejected/);
  assert.equal(git(work, ['ls-remote', '--heads', 'origin', 'refs/heads/ci-fixture']).split(/\s/)[0], intervening);
});

test('signed Git fixture verifies one-off signing, configured amend and unavailable-key failure', async t => {
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
