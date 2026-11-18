import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { runGate, stateFilePath, ciRetryFilePath, ciRetryDataDir } from '../../cindy-github/skills/pr/scripts/pr-heartbeat-gate.mjs';

const gate = fileURLToPath(new URL('../../cindy-github/skills/pr/scripts/pr-heartbeat-gate.mjs', import.meta.url));
const url = 'https://github.com/example/repo/pull/42';
const prNodeId = 'PR_exampleImmutableId';
const oldHead = 'a'.repeat(40), newHead = 'b'.repeat(40);
const failure = { workflow: '.github/workflows/verify.yml', job: 'verify', step: 'install dependencies', cause: 'package store unavailable' };

function guideArguments(values) {
  const guide = fs.readFileSync(new URL('../../cindy-github/skills/pr/references/ci-retry.md', import.meta.url), 'utf8');
  const source = guide.match(/```js\n(\/\/ Argument lists for the existing task execution tool\.[\s\S]*?)\n```/)?.[1];
  assert.ok(source, 'the recovery guide must define argument lists, not shell command templates');
  return runInNewContext(source + '\n({ checkRefArgs, remoteArgs, reserveArgs, statusArgs, verifyArgs, pushArgs })', values);
}

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
      verifyArgs: ['verify-commit', newHead],
      pushArgs: ['push', '--force-with-lease=' + exactRef + ':' + oldHead, '--', values.verifiedRemote, 'HEAD:' + exactRef],
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

test('recovery guide preserves the follower observation directory for reserve and status', t => {
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
    process(flags, target) {
      return new Promise(resolve => execFile(process.execPath, [gate, ...args(flags, target)], { env }, (error, stdout, stderr) => {
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

test('legacy evidence survives invalid current diagnoses, cache cleanup and process restart', async t => {
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
  const remote = path.join(fx.root, "remote dir's $(id);&.git"), work = path.join(fx.root, 'work'), other = path.join(fx.root, 'other');
  const branch = "ci$(id);'&", ref = 'refs/heads/' + branch;
  const plan = originalRemoteSha => guideArguments({
    verifiedBranch: branch, verifiedRemote: 'origin', originalRemoteSha, newSha: newHead,
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
  assert.equal(git(work, plan(before).remoteArgs).split(/\s/)[0], before);
  assert.equal((await fx.run(['--reserve-ci-retry', before])).code, 0);
  git(work, ['commit', '--amend', '--no-edit'], { GIT_COMMITTER_DATE: '2026-01-01T00:00:01Z' });
  const after = git(work, ['rev-parse', 'HEAD']);
  assert.notEqual(after, before);
  assert.equal(git(work, ['rev-parse', 'HEAD^{tree}']), tree);
  assert.equal(git(work, ['show', '-s', '--format=%an%n%ae%n%aI%n%P%n%B', 'HEAD']), authorAndMessage);
  assert.match(authorAndMessage, /Signed-off-by: Ada Example <ada@example\.test>/);
  git(work, plan(before).pushArgs);
  assert.equal(git(work, plan(before).remoteArgs).split(/\s/)[0], after);
  assert.equal((await fx.run(['--reserve-ci-retry', after])).code, 1);

  // A collaborator advances the ref; reusing the original verified SHA must fail.
  git(fx.root, ['clone', '--branch', branch, '--', remote, other]);
  for (const [key, value] of [['user.name', 'Other Example'], ['user.email', 'other@example.test'], ['commit.gpgsign', 'false']]) git(other, ['config', key, value]);
  fs.writeFileSync(path.join(other, 'other.txt'), 'collaborator\n');
  git(other, ['add', 'other.txt']);
  git(other, ['commit', '-s', '-m', 'intervening work']);
  git(other, ['push', '--', 'origin', 'HEAD:' + ref]);
  const intervening = git(other, ['rev-parse', 'HEAD']);
  assert.throws(() => git(work, plan(after).pushArgs), /stale info|rejected/);
  assert.equal(git(work, plan(after).remoteArgs).split(/\s/)[0], intervening);
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
