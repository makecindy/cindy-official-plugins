import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  runGate,
  decide,
  evaluateWatch,
  eventReport,
  freshWatch,
  isHumanOnlyReviewPending,
  normalizeConflicting,
  parseTarget,
  passAdvisories,
  canSkipWithProbe,
  mustFullReadBeforeProbe,
  probeAllowsSkip,
  stateFilePath,
  adoptLegacyStateFile,
  snapshotFailurePlan,
} from '../../cindy-github/skills/pr/scripts/pr-heartbeat-gate.mjs';
import { classifyMergeQueue } from '../../cindy-github/skills/pr/scripts/lib/merge-queue.mjs';
import { pacingDue } from '../../cindy-github/skills/pr/scripts/lib/follow-pacing.mjs';

const gatePath = fileURLToPath(new URL('../../cindy-github/skills/pr/scripts/pr-heartbeat-gate.mjs', import.meta.url));

const PR_URL = 'https://github.com/acme/widgets/pull/42';
const REPO = 'acme/widgets';
const NUMBER = 42;
const T0 = Date.parse('2026-10-20T10:00:00Z');
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();

/**
 * 假 pr-snapshot:输出由 fixture 文件决定,退出码由环境变量决定。真快照要打网络 + gh,
 * 门禁行为必须能脱网测。探测默认失败(每轮都完整读取),探测用例自己给出探测结果。
 */
function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-heartbeat-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const stateDir = path.join(root, 'state');
  const outFile = path.join(root, 'snapshot.json');
  const fakeSnapshot = path.join(root, 'fake-pr-snapshot.mjs');
  fs.writeFileSync(
    fakeSnapshot,
    [
      "import fs from 'node:fs';",
      "if (process.argv.includes('--probe')) process.exit(1);",
      'const out = process.env.FAKE_SNAPSHOT_OUT;',
      "if (out && fs.existsSync(out)) process.stdout.write(fs.readFileSync(out, 'utf8'));",
    ].join('\n'),
    'utf8',
  );
  let clock = T0;
  let probe = null;
  let trigger = null;
  let snapshotRuns = 0;
  let probeRuns = 0;

  // 端到端用例按分钟推进时钟;默认关掉最小放行间隔判据,它有专门用例。
  const gateArgs = (extraArgs) => [
    PR_URL, '--state-dir', stateDir, '--snapshot', fakeSnapshot,
    ...(extraArgs.includes('--min-pass-spacing-minutes') ? [] : ['--min-pass-spacing-minutes', '0']),
    // 节奏有专门用例;其余用例每次都检查。
    '--no-pacing',
    ...extraArgs,
  ];

  return {
    root,
    stateFile: () => stateFilePath(stateDir, REPO, NUMBER),
    setSnapshot(snap) {
      fs.writeFileSync(outFile, `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
    },
    setProbe(value) {
      probe = value;
    },
    setTrigger(value) {
      trigger = value;
    },
    advance(minutes) {
      clock += minutes * MIN;
    },
    writeWait(plan) {
      const file = path.join(root, 'wait.json');
      fs.writeFileSync(file, JSON.stringify(plan));
      return file;
    },
    now: () => clock,
    snapshotRuns: () => snapshotRuns,
    probeRuns: () => probeRuns,
    readState() {
      return JSON.parse(fs.readFileSync(stateFilePath(stateDir, REPO, NUMBER), 'utf8'));
    },
    readRepoState() {
      return JSON.parse(fs.readFileSync(path.join(stateDir, 'acme__widgets.repo.json'), 'utf8'));
    },
    writeRepoState(value) {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, 'acme__widgets.repo.json'), JSON.stringify(value), 'utf8');
    },
    writeState(patch) {
      const file = stateFilePath(stateDir, REPO, NUMBER);
      const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, 'utf8');
    },
    /** 进程内跑同一个 CLI 入口(runGate),注入时钟、快照与探测。 */
    async run(extraArgs = [], env = {}) {
      let stdout = '';
      let stderr = '';
      const code = await runGate(gateArgs(extraArgs), {
        env: { ...process.env, ...env },
        now: () => clock,
        runSnapshot: async () => {
          snapshotRuns += 1;
          return {
            code: Number(env.FAKE_SNAPSHOT_EXIT || 0),
            stdout: env.FAKE_SNAPSHOT_STDOUT_RAW ?? (fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : ''),
            stderr: env.FAKE_SNAPSHOT_STDERR ?? '',
          };
        },
        runProbe: async () => {
          probeRuns += 1;
          return probe ? { code: 0, stdout: JSON.stringify(probe), stderr: '' } : { code: 1, stdout: '', stderr: '' };
        },
        readTrigger: async () => trigger,
        out: (text) => { stdout += text; },
        err: (text) => { stderr += text; },
      });
      return { code, stdout, stderr, json: () => JSON.parse(stdout) };
    },
    /** 真实子进程调用指定路径的脚本:只给软链入口用例用,验证 CLI 入口判据本身。 */
    runVia(scriptPath, extraArgs = [], hookPayload) {
      return new Promise((resolve) => {
        const child = execFile(process.execPath, [scriptPath, ...gateArgs(extraArgs)], {
          encoding: 'utf8',
          env: { ...process.env, FAKE_SNAPSHOT_OUT: outFile },
        }, (err, stdout, stderr) => {
          resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout ?? '', stderr: stderr ?? '' });
        });
        if (hookPayload) child.stdin.end(JSON.stringify(hookPayload));
      });
    },
  };
}

const check = (name, outcome = 'passed', extra = {}) => ({ name, outcome, detailsUrl: `https://ci/${name}`, ...extra });

/** 一个「必需检查已通过、没什么可做」的快照。我们自己的账号是 me。 */
function snap(overrides = {}) {
  return {
    repo: REPO,
    number: NUMBER,
    url: PR_URL,
    viewer: 'me',
    state: 'OPEN',
    closed: false,
    merged: false,
    isDraft: false,
    updatedAt: '2026-10-20T09:00:00Z',
    reviewDecision: 'APPROVED',
    mergeStateStatus: 'CLEAN',
    mergeable: true,
    baseRefName: 'main',
    latestCommitOid: 'aaa1111',
    verdict: 'READY',
    blockers: [],
    gate: { verdict: 'READY', truncated: false },
    checks: [check('build', 'passed', { required: true }), check('lint')],
    checksSummary: { total: 2, pending: 0, failed: 0, unavailable: false, truncated: false },
    reviewThreads: { totalCount: 0, unresolvedCount: 0, activeUnresolvedCount: 0, truncated: false, nodes: [] },
    reviews: [],
    comments: [],
    ...overrides,
  };
}

const comment = (id, author, at, body = 'please fix', extra = {}) => ({ id, author, body, createdAt: at, updatedAt: at, url: `https://gh/${id}`, ...extra });

/** 已确认处理完的基线:看过这个快照上的一切。 */
function seenWatch(s, now = T0) {
  const base = { ...freshWatch(s, now), remarksThrough: iso(now) };
  return evaluateWatch(base, s, now).next;
}

const kinds = (result) => result.events.map((e) => e.kind);

const waitPlan = (s, extra = {}) => ({
  kind: 'human', headSha: s.latestCommitOid, reason: 'A maintainer must handle the certificate finding.',
  afterMinutes: null, checks: [{ name: 'CodeQL' }], threads: ['security-thread'], ...extra,
});
const humanBlocked = (extra = {}) => snap({
  verdict: 'NEEDS_WORK', reviewDecision: 'REVIEW_REQUIRED',
  blockers: ['ci_failing', 'unresolved_review_threads', 'branch_protection_blocked'],
  baseCommitOid: 'base-0',
  checks: [check('build', 'passed', { required: true }), check('CodeQL', 'failed', { startedAt: iso(T0 - MIN) })],
  reviewThreads: { nodes: [{ id: 'security-thread', isResolved: false, comments: [] }] },
  ...extra,
});

async function startWait(fx, s, extra = {}) {
  fx.setSnapshot(s);
  await fx.run(['--json']);
  const result = await fx.run(['--wait', fx.writeWait(waitPlan(s, extra)), '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json().reason, 'wait-set');
  return result;
}

// ── 目标解析 ────────────────────────────────────────────────────────────────

test('parseTarget 接受完整 URL,裸 PR 号要求 --repo(不从 cwd 猜仓库)', () => {
  assert.deepEqual(parseTarget(PR_URL), { repo: REPO, number: 42 });
  assert.deepEqual(parseTarget('42', REPO), { repo: REPO, number: 42 });
  assert.throws(() => parseTarget('42'), /--repo/);
  assert.throws(() => parseTarget('not-a-pr'), /cannot parse/);
  assert.throws(() => parseTarget('https://evilgithub.com/acme/app/pull/12'), /cannot parse/);
  assert.deepEqual(parseTarget('https://github.com/acme/app/pull/12/files'), { repo: 'acme/app', number: 12 });
});

test('normalizeConflicting:两套字段域都认,未知窗口 carry-forward', () => {
  assert.equal(normalizeConflicting({ mergeable: 'CONFLICTING' }), true);
  assert.equal(normalizeConflicting({ mergeable: false }), true);
  assert.equal(normalizeConflicting({ mergeStateStatus: 'DIRTY' }), true);
  assert.equal(normalizeConflicting({ mergeable: 'MERGEABLE' }), false);
  assert.equal(normalizeConflicting({ mergeStateStatus: 'BLOCKED', mergeable: null }), false);
  assert.equal(normalizeConflicting({ mergeable: null, mergeStateStatus: 'UNKNOWN' }, true), true);
  assert.equal(normalizeConflicting({ mergeable: null, mergeStateStatus: 'UNKNOWN' }), false);
});

// ── 事件:检查 ──────────────────────────────────────────────────────────────

test('PR launcher selects a supported Node from PATH and preserves hook stdin, exit codes and child snapshot runtime', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-node-launcher-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const launcher = path.join(path.dirname(gatePath), 'pr-node.cjs');
  const stateDir = path.join(dir, 'state');
  const fakeSnapshot = path.join(dir, 'fake-snapshot.mjs');
  const red = snap({ verdict: 'NEEDS_WORK', blockers: ['ci_failing'],
    checks: [check('build', 'failed', { required: true })] });
  fs.writeFileSync(fakeSnapshot, `if (Number(process.versions.node.split('.')[0]) < 18) process.exit(9);
    if (process.argv.includes('--probe')) process.exit(1);
    process.stdout.write(${JSON.stringify(JSON.stringify(red))});`);
  // CI need not have an ancient Node installed. Simulate its reported version
  // and executable identity, while selecting and actually running a modern
  // executable from PATH. The real old binary is exercised by the dev-app test.
  const simulateOld = `Object.defineProperty(process.versions,'node',{value:'8.12.0'});
    Object.defineProperty(process,'execPath',{value:${JSON.stringify(path.join(dir, 'obsolete-node'))}});
    const file=process.argv[1]; process.argv=[process.execPath,file,...process.argv.slice(2)]; require(file);`;
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
  const invoke = (extra = [], payload, modernPath = path.dirname(process.execPath)) => spawnSync(process.execPath,
    ['-e', simulateOld, launcher, 'pr-heartbeat-gate.mjs', PR_URL,
      '--state-dir', stateDir, '--snapshot', fakeSnapshot, '--no-pacing', ...extra], {
      encoding: 'utf8', input: payload ? JSON.stringify(payload) : '', timeout: 15000,
      env: { ...cleanEnv, PATH: modernPath, CINDY_PR_TRACE: '0' },
    });
  const payload = { event: 'schedule-pre-run', scheduleId: 'first-schedule', runId: 'first', firedAt: T0 };
  const first = invoke([], payload);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /events=\[checks-failed\]/);
  const saved = () => JSON.parse(fs.readFileSync(stateFilePath(stateDir, REPO, NUMBER), 'utf8'));
  assert.equal(saved().followStartId, 'first-schedule', 'real hook stdin must reach the modern child');
  assert.equal(invoke(['--resume', 'Inspected the failed fixture check.']).status, 0);
  const skipped = invoke([], { ...payload, runId: 'second', lastFinishedAt: T0 });
  assert.equal(skipped.status, 2, skipped.stderr);
  assert.match(skipped.stdout, /SKIP/);
  const before = fs.readFileSync(stateFilePath(stateDir, REPO, NUMBER), 'utf8');
  const unsupported = invoke([], payload, dir);
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /needs Node\.js 18 or newer/);
  assert.equal(fs.readFileSync(stateFilePath(stateDir, REPO, NUMBER), 'utf8'), before);
  // A modern Node already running the launcher does not need PATH probing.
  const current = spawnSync(process.execPath, [launcher, 'pr-heartbeat-gate.mjs', '--help'], {
    encoding: 'utf8', env: { ...cleanEnv, PATH: dir }, timeout: 15000,
  });
  assert.equal(current.status, 0, current.stderr);
  assert.match(current.stderr, /Usage: node pr-heartbeat-gate/);
});

test('检查失败按名字每个 head 只报一次;换 head 后再失败会再报', () => {
  const red = snap({ checks: [check('build', 'failed', { required: true }), check('lint')] });
  const first = evaluateWatch(seenWatch(snap()), red, T0);
  assert.deepEqual(kinds(first), ['checks-failed']);
  assert.deepEqual(first.events[0].failed.map((c) => c.name), ['build']);
  // 同一个失败在同一个 head 上:不再唤起(本机实测一个红灯被反复唤起 91 次)
  assert.deepEqual(kinds(evaluateWatch(first.next, red, T0 + 30 * MIN)), []);
  // 推送(检查都在跑):不唤起
  const pushed = snap({ latestCommitOid: 'bbb2222', checks: [check('build', 'pending', { required: true }), check('lint', 'pending')] });
  const running = evaluateWatch(first.next, pushed, T0 + 40 * MIN);
  assert.deepEqual(kinds(running), []);
  // 新 head 上又失败:再报
  const redAgain = evaluateWatch(running.next, { ...pushed, checks: [check('build', 'failed', { required: true }), check('lint')] }, T0 + 50 * MIN);
  assert.deepEqual(kinds(redAgain), ['checks-failed']);
});

// Rule (from the retired personal git skill): while checks fail, a base commit may fix a baseline
// failure, so base progress wakes once; healthy PRs ignore the base's ordinary progress.
test('检查失败期间 base 前进报一次;健康时 base 前进不唤起;探测看到 base 变了就完整读取', () => {
  const red = (base, extra = {}) => snap({ baseCommitOid: base, checks: [check('build', 'failed', { required: true })], ...extra });
  let r = evaluateWatch(seenWatch(snap({ baseCommitOid: 'm1' })), red('m1'), T0);
  assert.deepEqual(kinds(r), ['checks-failed']);
  r = evaluateWatch(r.next, red('m2'), T0 + 10 * MIN);
  assert.deepEqual(r.events, [{ kind: 'base-moved', sha: 'm2' }]);
  assert.match(eventReport(r.events, red('m2')), /main moved to m2 while checks are failing/);
  assert.deepEqual(kinds(evaluateWatch(r.next, red('m2'), T0 + 20 * MIN)), [], '同一个 base 只报一次');
  const green = evaluateWatch(seenWatch(snap({ baseCommitOid: 'm1' })), snap({ baseCommitOid: 'm9' }), T0);
  assert.deepEqual(kinds(green), [], '健康 PR 不看 base');
  assert.equal(green.next.baseSha, null);
  const previous = { watch: r.next, probe: { status: 's', remarks: 'r', base: 'm2' }, lastFullReadAt: T0, lastPassAt: T0 };
  assert.equal(probeAllowsSkip(previous, { status: 's', remarks: 'r', base: 'm2' }, T0 + MIN), true);
  assert.equal(probeAllowsSkip(previous, { status: 's', remarks: 'r', base: 'm3' }, T0 + MIN), false);
});

test('必需检查全部通过报一次;还在跑的其它检查结束时再报一次,之后的增减不再唤起', () => {
  const pushed = (checks) => snap({ latestCommitOid: 'bbb2222', checks });
  let r = evaluateWatch(seenWatch(snap()), pushed([check('build', 'passed', { required: true }), check('codeql', 'pending')]), T0);
  assert.deepEqual(r.events, [{ kind: 'checks-passed', count: 1, required: true }]);
  r = evaluateWatch(r.next, pushed([check('build', 'passed', { required: true }), check('codeql', 'pending')]), T0 + 10 * MIN);
  assert.deepEqual(kinds(r), [], '必需检查通过后不重复');
  r = evaluateWatch(r.next, pushed([check('build', 'passed', { required: true }), check('codeql')]), T0 + 20 * MIN);
  assert.deepEqual(r.events, [{ kind: 'checks-passed', count: 2, required: false }], '欠的那一次');
  r = evaluateWatch(r.next, pushed([check('build', 'passed', { required: true }), check('codeql'), check('late', 'pending')]), T0 + 30 * MIN);
  assert.deepEqual(kinds(r), [], '后来冒出的非必需检查不唤起');
});

test('host test and self-test preview an existing wait and unacknowledged event without writing any follow state', async (t) => {
  const fx = createFixture(t);
  const red = snap({ verdict: 'NEEDS_WORK', blockers: ['ci_failing'],
    checks: [check('build', 'failed', { required: true })] });
  fx.setSnapshot(red);
  await startWait(fx, red, { kind: 'baseline', checks: [{ name: 'build' }], threads: [] });
  fx.advance(5);
  fx.setSnapshot({ ...red, checks: [...red.checks, check('lint', 'failed')] });
  assert.equal((await fx.run()).code, 0);
  assert.ok(fx.readState().wait && fx.readState().pendingWatch);
  const dir = path.dirname(fx.stateFile());
  const files = () => Object.fromEntries(fs.readdirSync(dir).sort().map(name =>
    [name, fs.readFileSync(path.join(dir, name), 'utf8')]));
  const before = files();
  // The actual Host uses these two pairs of IDs without lastFinishedAt.
  // A preview which sees new work must still not change the production state.
  fx.setSnapshot({ ...red, checks: [...red.checks, check('lint', 'failed'), check('package', 'failed')] });
  for (const id of ['test', 'self-test']) {
    const result = await fx.runVia(gatePath, [], { event: 'schedule-pre-run',
      scheduleId: id, scheduleName: 'PR #42', runId: id, firedAt: Date.now() });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /diagnostic only, follow-up state unchanged/);
    assert.deepEqual(files(), before, 'PR state, repository state and trace stay byte-identical');
  }
  const production = await fx.run();
  assert.equal(production.code, 0, 'the real schedule can still deliver its pending event');
  const first = createFixture(t);
  first.setSnapshot(red);
  assert.equal((await first.runVia(gatePath, [], { event: 'schedule-pre-run',
    scheduleId: 'test', runId: 'test', firedAt: Date.now() })).code, 0);
  assert.equal(fs.existsSync(first.stateFile()), false, 'diagnostics do not create a new follower');
});

test('a partially failed batch reports its final result once even with no new failure', async (t) => {
  const fx = createFixture(t);
  const red = snap({ verdict: 'NEEDS_WORK', blockers: ['ci_failing', 'pending_checks'],
    checks: [check('build', 'failed', { required: true }), check('lint', 'pending'), check('package', 'pending')] });
  fx.setSnapshot(red);
  let first = await fx.run();
  assert.equal(first.code, 0);
  assert.match(first.stdout, /checks-failed/);
  assert.match(first.stdout, /notify the user \(schedule_notify_current_run\)/);
  assert.equal((await fx.run(['--resume', 'Inspected the initial failure.'])).code, 0);
  fx.advance(5);
  fx.setSnapshot({ ...red, checks: [red.checks[0], check('lint'), red.checks[2]] });
  assert.equal((await fx.run()).code, 2);
  fx.advance(5);
  const finished = { ...red, blockers: ['ci_failing'], checks: [red.checks[0], check('lint'), check('package')] };
  fx.setSnapshot(finished);
  const final = await fx.run();
  assert.equal(final.code, 0);
  assert.match(final.stdout, /checks-finished/);
  assert.match(final.stdout, /All 3 checks finished.*1 still failed/);
  assert.match(final.stdout, /notify the user \(schedule_notify_current_run\)/);
  fx.advance(5);
  assert.match((await fx.run()).stdout, /retry-unacked/);
  assert.equal((await fx.run(['--resume', 'Reported the final failure.'])).code, 0);
  fx.advance(5);
  assert.equal((await fx.run()).code, 2);
  // A new follower's first snapshot is already final: exactly the failure event.
  const fresh = createFixture(t);
  fresh.setSnapshot(finished);
  assert.match((await fresh.run()).stdout, /events=\[checks-failed\]/);
  assert.equal((await fresh.run(['--resume', 'Reported the failure.'])).code, 0);
  fresh.advance(5);
  assert.equal((await fresh.run()).code, 2);
});

test('a new schedule observes an existing failure even if a stopped follower had acknowledged it', async (t) => {
  const fx = createFixture(t);
  const red = snap({ verdict: 'NEEDS_WORK', blockers: ['ci_failing'],
    checks: [check('build', 'failed', { required: true })] });
  fx.setSnapshot(red);
  await startWait(fx, red, { kind: 'baseline', reason: 'Previous follower investigated.', checks: [{ name: 'build' }], threads: [] });
  fx.advance(5);
  assert.equal((await fx.run()).code, 2, 'reusing a schedule preserves its recorded wait');
  fx.setTrigger({ firstScheduleId: 'new-schedule' });
  fx.advance(5);
  assert.match((await fx.run(['--pacing'])).stdout, /events=\[checks-failed\]/);
  assert.equal(fx.readState().wait, undefined, 'stopped follower wait must not suppress the initial failure');
  fx.advance(5);
  assert.match((await fx.run()).stdout, /retry-unacked/, 'repeated first hook does not reset pending watch');
  assert.equal((await fx.run(['--resume', 'Reported the existing failure.'])).code, 0);
  fx.advance(5);
  assert.equal((await fx.run()).code, 2);
});

test('a new follower reports green checks even when the old owner was waiting only for approval', async t => {
  const fx = createFixture(t);
  const approval = snap({
    verdict: 'NEEDS_WORK', blockers: ['unresolved_review_threads', 'branch_protection_blocked'],
    reviewThreads: { totalCount: 1, unresolvedCount: 1, activeUnresolvedCount: 1, truncated: false,
      nodes: [{ id: 'approval', isResolved: false, isOutdated: false,
        comments: [comment('A1', 'lead', '2026-10-20T09:00:00Z', 'This needs explicit approval from a designated maintainer.')] }] },
  });
  fx.setSnapshot(approval);
  assert.equal((await fx.run()).code, 0);
  assert.equal((await fx.run(['--resume', 'Old owner reported the approval blocker.'])).code, 0);
  const old = fx.readState();
  assert.equal(old.humanOnlyPending, true);
  fx.advance(5);
  assert.equal((await fx.run()).code, 2, 'same owner remains quiet');
  fx.setTrigger({ firstScheduleId: 'new-follower' });
  fx.advance(5);
  const first = await fx.run(['--pacing']);
  assert.equal(first.code, 0, first.stdout);
  assert.match(first.stdout, /events=\[checks-passed\]/);
  const next = fx.readState();
  assert.equal(next.headOid, old.headOid);
  assert.equal(next.roundCount, old.roundCount);
  assert.equal(next.lastAckAt, undefined, 'old confirmation must not constitute new owner acknowledgement');
  fx.advance(5);
  assert.match((await fx.run()).stdout, /retry-unacked/);
  assert.equal((await fx.run(['--resume', 'New owner reported the approval blocker.'])).code, 0);
  fx.advance(5);
  assert.equal((await fx.run()).code, 2, 'confirmed result is deduplicated again');
});

test('new follower retains actual CI registration history and the same-head deadline', async t => {
  for (const mode of ['same-head', 'new-head', 'previously-reminded', 'unacknowledged', 'unavailable', 'registered', 'never-had-checks']) {
    const fx = createFixture(t);
    const green = snap();
    const missing = snap({ latestCommitOid: 'bbb2222', verdict: 'NOT_READY', blockers: ['pending_checks'],
      checks: [], checksSummary: { total: 0, pending: 0, failed: 0, unavailable: false, truncated: false } });
    fx.setSnapshot(mode === 'never-had-checks' ? { ...missing, latestCommitOid: green.latestCommitOid } : green);
    await fx.run();
    await fx.run(['--resume', 'old owner observed']);
    fx.advance(5);
    fx.setSnapshot(missing);
    assert.equal((await fx.run()).code, 2);
    const started = fx.readState().watch.checksAwaitedSince;
    if (mode !== 'never-had-checks') assert.ok(started);
    if (mode === 'previously-reminded' || mode === 'unacknowledged') {
      fx.advance(15);
      assert.match((await fx.run()).stdout, /no-checks/);
      if (mode === 'previously-reminded') await fx.run(['--resume', 'old owner reported absent checks']);
    }
    if (mode === 'new-head') fx.setSnapshot({ ...missing, latestCommitOid: 'ccc3333' });
    if (mode === 'unavailable') fx.setSnapshot({ ...missing, checksSummary: { unavailable: true } });
    if (mode === 'registered') fx.setSnapshot({ ...missing, checks: [check('build', 'pending')] });
    fx.setTrigger({ firstScheduleId: 'new-follower' });
    fx.advance(15);
    const first = await fx.run();
    if (['same-head', 'unacknowledged'].includes(mode)) {
      assert.equal(first.code, 0, mode + ': ' + first.stdout);
      assert.match(first.stdout, /no-checks/);
      await fx.run(['--resume', 'new owner reported absent checks']);
    } else {
      assert.equal(first.code, 2, mode + ': ' + first.stdout);
      if (mode === 'unavailable') {
        assert.equal(fx.readState().watch.checksAwaitedSince, started);
        fx.setSnapshot(missing);
        fx.advance(5);
        assert.match((await fx.run()).stdout, /no-checks/);
        await fx.run(['--resume', 'new owner reported absent checks']);
      } else if (mode === 'registered') {
        assert.equal(fx.readState().watch.checksAwaitedSince, null);
      } else if (mode !== 'never-had-checks') {
        assert.equal(fx.readState().watch.checksAwaitedSince, iso(fx.now()), mode);
        fx.advance(15);
        assert.match((await fx.run()).stdout, /no-checks/);
        await fx.run(['--resume', 'new owner reported absent checks']);
      }
    }
    fx.advance(20);
    assert.equal((await fx.run()).code, 2, mode + ': no repeated reminder');
  }
});

test('first hook reads the actual scheduler stdin and re-observes a stopped follower\'s red check', async (t) => {
  const fx = createFixture(t);
  const red = snap({ verdict: 'NEEDS_WORK', blockers: ['ci_failing'],
    checks: [check('build', 'failed', { required: true })] });
  fx.setSnapshot(red);
  await startWait(fx, red, { kind: 'baseline', checks: [{ name: 'build' }], threads: [] });
  const payload = { event: 'schedule-pre-run', scheduleId: 'new-follow', runId: 'first', firedAt: Date.now() };
  const first = await fx.runVia(gatePath, [], payload);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /events=\[checks-failed\]/);
  assert.equal((await fx.runVia(gatePath, ['--resume', 'Reported the red result.'])).code, 0);
  const later = await fx.runVia(gatePath, [], { ...payload, runId: 'second', lastFinishedAt: Date.now() });
  assert.equal(later.code, 2, later.stderr);
});

test('a pre-upgrade partially failing watch still reports completion after unavailable data', () => {
  const red = snap({ checks: [check('build', 'failed', { required: true }), check('lint', 'pending')] });
  const old = seenWatch(red);
  delete old.failureCompletionOwed;
  const unavailable = evaluateWatch(old, snap({ checks: [], checksSummary: { unavailable: true } }), T0 + MIN);
  assert.deepEqual(kinds(unavailable), []);
  const done = evaluateWatch(unavailable.next, snap({ checks: [red.checks[0], check('lint')] }), T0 + 2 * MIN);
  assert.deepEqual(kinds(done), ['checks-finished']);
});

test('a timed baseline wait still reports a partial batch becoming final without extending its deadline', async (t) => {
  const fx = createFixture(t);
  const red = snap({ verdict: 'NEEDS_WORK', blockers: ['ci_failing', 'pending_checks'],
    checks: [check('build', 'failed', { required: true }), check('lint', 'pending')] });
  fx.setSnapshot(red);
  await startWait(fx, red, { kind: 'baseline', checks: [{ name: 'build' }], threads: [] });
  const deadline = fx.readState().wait.until;
  fx.advance(5);
  fx.setSnapshot({ ...red, blockers: ['ci_failing'], checks: [red.checks[0], check('lint')] });
  const result = await fx.run();
  assert.equal(result.code, 0);
  assert.match(result.stdout, /events=\[checks-finished\]/);
  assert.equal(fx.readState().wait.until, deadline);
  // A new commit must not carry this old completion obligation.
  const nextHead = evaluateWatch(seenWatch(red), snap({ latestCommitOid: 'new-head', checks: [red.checks[0], check('lint')] }), T0 + MIN);
  assert.deepEqual(kinds(nextHead), ['checks-failed']);
});

test('读不到检查时保留原状态,不把「没读到」当成「全部通过」或「没有检查」', () => {
  const red = evaluateWatch(seenWatch(snap()), snap({ checks: [check('build', 'failed', { required: true })] }), T0);
  const unavailable = snap({ checks: [], checksSummary: { unavailable: true } });
  const r = evaluateWatch(red.next, unavailable, T0 + 60 * MIN);
  assert.deepEqual(kinds(r), []);
  assert.deepEqual(r.next.failedChecks, ['build']);
});

test('新 head 15 分钟没有任何检查上报时说一次;从没跑过检查的 PR 不说', () => {
  const pushed = snap({ latestCommitOid: 'bbb2222', checks: [] });
  let r = evaluateWatch(seenWatch(snap()), pushed, T0);
  assert.deepEqual(kinds(r), []);
  r = evaluateWatch(r.next, pushed, T0 + 16 * MIN);
  assert.deepEqual(r.events, [{ kind: 'no-checks', minutes: 16 }]);
  assert.deepEqual(kinds(evaluateWatch(r.next, pushed, T0 + 40 * MIN)), [], '只说一次');

  const never = snap({ checks: [] });
  const quiet = evaluateWatch(seenWatch(never), { ...never, latestCommitOid: 'bbb2222' }, T0);
  assert.deepEqual(kinds(evaluateWatch(quiet.next, { ...never, latestCommitOid: 'bbb2222' }, T0 + 60 * MIN)), []);
});

test('新 head 的第一次检查读不到,恢复读取后仍按推送时刻起算 no-checks,且只说一次', () => {
  const pushed = (extra = {}) => snap({ latestCommitOid: 'bbb2222', checks: [], ...extra });
  const unreadable = pushed({ checksSummary: { unavailable: true } });
  let r = evaluateWatch(seenWatch(snap()), unreadable, T0);
  assert.deepEqual(kinds(r), [], '读不到时不报');
  assert.equal(r.next.headSha, 'bbb2222');
  assert.ok(r.next.checksAwaitedSince, '计时已在推送时刻起算');
  r = evaluateWatch(r.next, unreadable, T0 + 5 * MIN);
  assert.deepEqual(kinds(r), [], '仍读不到:不报,计时也不被清掉');
  r = evaluateWatch(r.next, pushed(), T0 + 16 * MIN);
  assert.deepEqual(r.events, [{ kind: 'no-checks', minutes: 16 }]);
  assert.deepEqual(kinds(evaluateWatch(r.next, pushed(), T0 + 40 * MIN)), [], '只说一次');

  // 读取恢复后检查其实在跑:计时清掉,不误报
  const ok = evaluateWatch(evaluateWatch(seenWatch(snap()), unreadable, T0).next,
    pushed({ checks: [check('build', 'pending', { required: true })] }), T0 + 20 * MIN);
  assert.equal(ok.next.checksAwaitedSince, null);
  assert.ok(!kinds(ok).includes('no-checks'));
});

// ── 事件:留言 ──────────────────────────────────────────────────────────────

test('只有别人的新留言唤起:自己的回复、看过的、内容为空的 COMMENTED review 都不算', () => {
  const base = snap({ comments: [comment('C1', 'alice', '2026-10-20T09:00:00Z')] });
  const watch = seenWatch(base);
  const later = '2026-10-20T10:05:00Z';
  const next = snap({
    comments: [comment('C1', 'alice', '2026-10-20T09:00:00Z'), comment('C2', 'ME', later, 'done')],
    reviews: [
      { id: 'R1', author: 'bot', state: 'COMMENTED', body: '', submittedAt: later },
      { id: 'R2', author: 'bob', state: 'APPROVED', body: '', submittedAt: later, url: 'https://gh/R2' },
    ],
    reviewThreads: { totalCount: 1, nodes: [{ id: 'T1', path: 'src/a.ts', comments: [comment('TC1', 'bot', later, 'null check missing')] }] },
  });
  const r = evaluateWatch(watch, next, T0 + 10 * MIN);
  assert.deepEqual(kinds(r), ['remarks']);
  assert.deepEqual(r.events[0].remarks.map((x) => x.id).sort(), ['R2', 'TC1']);
  const report = eventReport(r.events, next);
  assert.match(report, /2 new comments:/);
  assert.match(report, /bob: approved https:\/\/gh\/R2/);
  assert.match(report, /bot on src\/a\.ts: "null check missing" https:\/\/gh\/TC1/);
  // 看过之后不再唤起;同一秒的新留言按 id 区分
  assert.deepEqual(kinds(evaluateWatch(r.next, next, T0 + 20 * MIN)), []);
  const sameSecond = { ...next, comments: [...next.comments, comment('C3', 'carol', later, 'one more')] };
  assert.deepEqual(evaluateWatch(r.next, sameSecond, T0 + 20 * MIN).events[0].remarks.map((x) => x.id), ['C3']);
});

test('机器人改写自己的状态评论不唤起,人改评论仍算新留言;摘要去掉看不见的元数据', () => {
  const posted = '2026-10-20T09:00:00Z';
  const edited = '2026-10-20T10:05:00Z';
  const vercel = (updatedAt) => comment('V1', 'vercel', posted, '[vc]: #P3wob:eyJpc01vbm9yZXBvIjp0cnVl\nDeployment ready', { updatedAt, authorIsBot: true });
  const watch = seenWatch(snap({ comments: [vercel(posted), comment('H1', 'alice', posted)] }));
  // 一次部署后两条都被改过:只有人的那条算
  const r = evaluateWatch(watch, snap({ comments: [vercel(edited), comment('H1', 'alice', posted, 'please fix', { updatedAt: edited })] }), T0 + 10 * MIN);
  assert.deepEqual(r.events[0].remarks.map((x) => x.id), ['H1']);
  // 机器人的新评论仍然算,摘要里不带它藏的元数据
  const fresh = vercel(edited);
  fresh.id = 'V2';
  fresh.createdAt = edited;
  const report = eventReport(evaluateWatch(watch, snap({ comments: [fresh] }), T0 + 10 * MIN).events, snap());
  assert.match(report, /vercel: "Deployment ready"/);
});

test('连续 10 次只有评论的唤起后要求停止跟进;推送或检查消息清零', () => {
  let watch = seenWatch(snap());
  let r;
  for (let i = 1; i <= 10; i += 1) {
    const at = T0 + i * MIN;
    r = evaluateWatch(watch, snap({ comments: [comment(`C${i}`, 'bot', iso(at))] }), at);
    watch = r.next;
  }
  assert.equal(r.next.wakes, 10);
  assert.equal(r.exhausted, true);
  assert.match(eventReport(r.events, snap(), true), /Stop following: delete this schedule/);
  const pushed = evaluateWatch(watch, snap({ latestCommitOid: 'bbb2222', checks: [check('build', 'pending', { required: true })], comments: [comment('C11', 'bot', iso(T0 + 11 * MIN))] }), T0 + 11 * MIN);
  assert.equal(pushed.exhausted, false);
  assert.equal(pushed.next.wakes, 1);
});

// ── 事件:冲突、草稿、合并队列 ──────────────────────────────────────────────

test('只在开始冲突时唤起;合并态重算(UNKNOWN)既不报新冲突也不清除旧冲突', () => {
  const dirty = snap({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
  const unknown = snap({ mergeable: null, mergeStateStatus: 'UNKNOWN' });
  assert.deepEqual(kinds(evaluateWatch(seenWatch(snap()), unknown, T0)), []);
  const conflict = evaluateWatch(seenWatch(snap()), dirty, T0);
  assert.deepEqual(kinds(conflict), ['conflicting']);
  const recomputing = evaluateWatch(conflict.next, unknown, T0 + MIN);
  assert.equal(recomputing.next.conflicting, true);
  assert.deepEqual(kinds(evaluateWatch(recomputing.next, dirty, T0 + 2 * MIN)), []);
});

test('草稿转换与合并队列出问题各唤起一次', () => {
  const draft = evaluateWatch(seenWatch(snap()), snap({ isDraft: true }), T0);
  assert.deepEqual(kinds(draft), ['draft-entered']);
  assert.deepEqual(kinds(evaluateWatch(draft.next, snap({ isDraft: false }), T0)), ['draft-exited']);

  const removed = { __typename: 'RemovedFromMergeQueueEvent', id: 'rm', reason: 'failed_checks' };
  const evicted = classifyMergeQueue({ event: removed, containsHead: true, checks: { failed: 1 } });
  const queued = classifyMergeQueue({ entry: { id: 'q', state: 'AWAITING_CHECKS' }, event: null, checks: { pending: 1 } });
  assert.deepEqual(kinds(evaluateWatch(seenWatch(snap()), snap({ mergeQueue: queued }), T0)), [], '排队等待不唤起');
  const r = evaluateWatch(seenWatch(snap()), snap({ mergeQueue: evicted }), T0);
  assert.deepEqual(kinds(r), ['merge-queue']);
  assert.match(eventReport(r.events, snap()), /merge_queue_ci_failing.*reason: failed_checks/);
  assert.deepEqual(kinds(evaluateWatch(r.next, snap({ mergeQueue: evicted }), T0 + MIN)), []);
});

test('唤起说明列出检查名、提交、链接;长留言截断、超过 10 条只列前 10 条', () => {
  const red = snap({ latestCommitOid: 'abcdef1234', checks: [check('build', 'failed', { required: true, conclusion: 'TIMED_OUT' })] });
  const r = evaluateWatch(seenWatch(snap()), red, T0);
  assert.equal(eventReport(r.events, red), '- Checks failed on abcdef1:\n  - build (timed_out) https://ci/build');
  const many = Array.from({ length: 12 }, (_, i) => comment(`C${i}`, 'bot', iso(T0 + i * 1000), `${'x'.repeat(250)} <!-- hidden -->`));
  const lines = eventReport([{ kind: 'remarks', remarks: many }], snap()).split('\n');
  assert.equal(lines.length, 12);
  assert.equal(lines.at(-1), '  - and 2 more');
  assert.ok(lines[1].length < 260 && lines[1].includes('...'));
});

// ── 决策 ────────────────────────────────────────────────────────────────────

test('decide:推送、检查在跑、自己的评论直接并入基线,不唤起 agent', () => {
  const s0 = snap();
  const previous = { watch: seenWatch(s0), lastPassAt: T0 };
  const pushed = snap({
    latestCommitOid: 'bbb2222',
    checks: [check('build', 'pending', { required: true })],
    comments: [comment('C9', 'me', iso(T0 + 5 * MIN), 'fixed in bbb2222')],
  });
  const d = decide({ snap: pushed, previous, now: T0 + 10 * MIN });
  assert.equal(d.exitCode, 2);
  assert.equal(d.reason, 'idle');
  assert.equal(d.nextWatch.headSha, 'bbb2222', '基线前进');
  assert.equal(d.nextPendingWatch, null);
});

test('decide:有新事件放行并附上清单;未确认时同一批事件重试,快速重试用尽后退避', () => {
  const red = snap({ checks: [check('build', 'failed', { required: true })] });
  let previous = { watch: seenWatch(snap()) };
  const at = (m) => T0 + m * MIN;
  const d1 = decide({ snap: red, previous, now: at(0), maxPassAttempts: 2, retryBackoffMs: 30 * MIN });
  assert.equal(d1.exitCode, 0);
  assert.equal(d1.reason, 'changed');
  assert.match(d1.detail, /events=\[checks-failed\]; verdict=READY; attempt=1\/2/);
  assert.match(d1.report, /Checks failed on aaa1111/);
  assert.equal(d1.nextWatch, previous.watch, '放行不推进已确认基线');
  previous = { ...previous, pendingWatch: d1.nextPendingWatch, pendingKey: d1.nextPendingKey, pendingPassCount: d1.nextPendingCount, lastPassAt: at(0) };
  const d2 = decide({ snap: red, previous, now: at(10), maxPassAttempts: 2, retryBackoffMs: 30 * MIN });
  assert.equal(d2.reason, 'retry-unacked');
  previous = { ...previous, pendingPassCount: d2.nextPendingCount, lastPassAt: at(10) };
  const d3 = decide({ snap: red, previous, now: at(20), maxPassAttempts: 2, retryBackoffMs: 30 * MIN });
  assert.equal(d3.reason, 'retry-backoff-attempt');
  previous = { ...previous, pendingPassCount: d3.nextPendingCount, retryBackoffUntil: d3.nextRetryBackoffUntil, lastPassAt: at(20) };
  const d4 = decide({ snap: red, previous, now: at(30), maxPassAttempts: 2, retryBackoffMs: 30 * MIN });
  assert.equal(d4.exitCode, 2);
  assert.equal(d4.reason, 'retry-backoff');
  // 没确认的放行期间问题被修掉(新 head 在跑):事件消失,pending 一并清掉
  const fixed = decide({ snap: snap({ latestCommitOid: 'bbb2222', checks: [check('build', 'pending', { required: true })] }), previous, now: at(31) });
  assert.equal(fixed.reason, 'idle');
  assert.equal(fixed.nextPendingWatch, null);
});

test('decide:空放行(宿主顺延、agent 没跑)照常放行但不消耗重试额度', () => {
  const red = snap({ checks: [check('build', 'failed', { required: true })] });
  const watch = seenWatch(snap());
  const d1 = decide({ snap: red, previous: { watch }, now: T0 });
  const previous = { watch, pendingWatch: d1.nextPendingWatch, pendingKey: d1.nextPendingKey, pendingPassCount: 1 };
  const empty = decide({ snap: red, previous: { ...previous, lastPassAt: T0 - 90_000 }, now: T0 });
  assert.equal(empty.exitCode, 0);
  assert.equal(empty.nextPendingCount, 1);
  assert.match(empty.detail, /not counted/);
  assert.equal(decide({ snap: red, previous: { ...previous, lastPassAt: T0 - 11 * MIN }, now: T0 }).nextPendingCount, 2);
});

test('decide:merged / closed 前 N 次快速放行后进入递增退避且跨 --ack 保留，重开后清零;截断的快照放行且不推进基线', () => {
  const at = (m) => T0 + m * MIN;
  const watch = seenWatch(snap());
  const mergedSnap = snap({ merged: true });
  const d1 = decide({ snap: mergedSnap, previous: { watch }, now: at(0), maxPassAttempts: 2, retryBackoffMs: 30 * MIN });
  assert.equal(d1.exitCode, 0);
  assert.equal(d1.reason, 'terminal');
  assert.equal(d1.nextTerminalPassCount, 1);

  // Host-deferred empty pass (< minPassSpacingMs) does not consume a terminal cleanup attempt.
  const empty = decide({
    snap: mergedSnap,
    previous: { watch, pendingWatch: d1.nextPendingWatch, pendingKey: 'terminal', pendingPassCount: 1, terminalPassCount: 1, lastPassAt: at(0) },
    now: at(1.5),
    maxPassAttempts: 2,
    retryBackoffMs: 30 * MIN,
  });
  assert.equal(empty.exitCode, 0);
  assert.equal(empty.reason, 'terminal');
  assert.equal(empty.nextTerminalPassCount, 1);

  const d2 = decide({
    snap: mergedSnap,
    previous: { watch, pendingWatch: d1.nextPendingWatch, pendingKey: 'terminal', pendingPassCount: 1, terminalPassCount: 1, lastPassAt: at(0) },
    now: at(5),
    maxPassAttempts: 2,
    retryBackoffMs: 30 * MIN,
  });
  assert.equal(d2.exitCode, 0);
  assert.equal(d2.reason, 'terminal');
  assert.equal(d2.nextTerminalPassCount, 2);

  // Even after --ack cleared pending*, terminalPassCount survives and enters 30m backoff on next tick.
  const d3 = decide({
    snap: mergedSnap,
    previous: { watch, terminalPassCount: 2, lastPassAt: at(5) },
    now: at(10),
    maxPassAttempts: 2,
    retryBackoffMs: 30 * MIN,
  });
  assert.equal(d3.exitCode, 2);
  assert.equal(d3.reason, 'terminal-backoff');
  assert.equal(d3.nextTerminalPassCount, 2);
  assert.equal(d3.nextTerminalBackoffUntil, at(35));

  // Once backoff expires, wakes with user-notification guidance and escalates to 2h.
  const d4 = decide({
    snap: mergedSnap,
    previous: { watch, terminalPassCount: 2, terminalBackoffUntil: at(35), lastPassAt: at(5) },
    now: at(35),
    maxPassAttempts: 2,
    retryBackoffMs: 30 * MIN,
  });
  assert.equal(d4.exitCode, 0);
  assert.equal(d4.reason, 'terminal-backoff-attempt');
  assert.match(d4.detail, /schedule_notify_current_run/);
  assert.equal(d4.nextTerminalPassCount, 3);
  assert.equal(d4.nextTerminalBackoffUntil, at(35 + 120));

  // Host-deferred retry of an unacknowledged terminal-backoff-attempt keeps notify guidance & backoff deadline.
  const d4Retry = decide({
    snap: mergedSnap,
    previous: {
      watch,
      merged: true,
      pendingWatch: d4.nextPendingWatch,
      pendingKey: 'terminal',
      pendingPassCount: d4.nextPendingCount,
      lastDecisionReason: 'terminal-backoff-attempt',
      terminalPassCount: d4.nextTerminalPassCount,
      terminalBackoffUntil: d4.nextTerminalBackoffUntil,
      lastPassAt: at(35),
    },
    now: at(36.5),
    maxPassAttempts: 2,
    retryBackoffMs: 30 * MIN,
  });
  assert.equal(d4Retry.exitCode, 0);
  assert.equal(d4Retry.reason, 'terminal-backoff-attempt');
  assert.match(d4Retry.detail, /schedule_notify_current_run/);
  assert.equal(d4Retry.nextTerminalPassCount, 3);
  assert.equal(d4Retry.nextTerminalBackoffUntil, at(35 + 120));

  // Once acknowledged (pendingWatch cleared), even a tick within minPassSpacingMs stays in terminal-backoff.
  const d4AfterAck = decide({
    snap: mergedSnap,
    previous: {
      watch,
      merged: true,
      lastDecisionReason: 'terminal-backoff-attempt',
      terminalPassCount: d4.nextTerminalPassCount,
      terminalBackoffUntil: d4.nextTerminalBackoffUntil,
      lastPassAt: at(35),
    },
    now: at(36.5),
    maxPassAttempts: 2,
    retryBackoffMs: 30 * MIN,
  });
  assert.equal(d4AfterAck.exitCode, 2);
  assert.equal(d4AfterAck.reason, 'terminal-backoff');
  assert.equal(d4AfterAck.nextPendingWatch, null);
  assert.equal(d4AfterAck.nextTerminalPassCount, 3);
  assert.equal(d4AfterAck.nextTerminalBackoffUntil, at(35 + 120));

  // Reopening a closed PR clears terminal backoff state.
  const reopened = decide({
    snap: snap({ closed: false, merged: false }),
    previous: { watch, closed: true, terminalPassCount: 3, terminalBackoffUntil: at(35 + 120), lastPassAt: at(35) },
    now: at(40),
    maxPassAttempts: 2,
    retryBackoffMs: 30 * MIN,
  });
  assert.equal(reopened.nextTerminalPassCount, undefined);
  assert.equal(reopened.nextTerminalBackoffUntil, undefined);

  const truncated = decide({ snap: snap({ gate: { truncated: true } }), previous: { watch }, now: T0 });
  assert.equal(truncated.reason, 'truncated');
  assert.equal(truncated.nextPendingWatch, watch);
});

test('decide:只剩人工批准时吸收外部变化;保底巡检;defer 未到点跳过、到点唤起一次', () => {
  const approvalThread = { id: 'T-approval', isResolved: false, isOutdated: false, comments: [comment('A1', 'lead', '2026-10-20T09:00:00Z', 'This needs explicit approval from a designated maintainer.')] };
  const humanOnly = snap({
    verdict: 'NEEDS_WORK',
    blockers: ['unresolved_review_threads', 'branch_protection_blocked'],
    reviewThreads: { totalCount: 1, unresolvedCount: 1, activeUnresolvedCount: 1, truncated: false, nodes: [approvalThread] },
  });
  assert.equal(isHumanOnlyReviewPending(humanOnly), true);
  const watch = seenWatch(humanOnly);
  const nudged = { ...humanOnly, comments: [comment('C1', 'lead', iso(T0 + MIN), 'still waiting')] };
  const held = decide({ snap: nudged, previous: { watch, humanOnlyPending: true, lastPassAt: T0 }, now: T0 + 2 * MIN });
  assert.equal(held.reason, 'changed', '新留言交给 agent 判断,不沿用旧线程的等批准分类');
  assert.equal(decide({ snap: nudged, previous: { watch, lastPassAt: T0 }, now: T0 + 2 * MIN }).reason, 'changed', '第一次也唤起');

  // 只有检查通过这类变化被吸收;上一轮还没确认的更新则保留重试。
  const running = { ...humanOnly, checks: [check('build', 'pending', { required: true })] };
  const greenOnly = { ...humanOnly, checks: [check('build', 'passed', { required: true })] };
  const runningWatch = seenWatch(running);
  assert.deepEqual(kinds(evaluateWatch(runningWatch, greenOnly, T0 + MIN)), ['checks-passed']);
  const absorbed = decide({ snap: greenOnly, previous: { watch: runningWatch, humanOnlyPending: true, lastPassAt: T0 }, now: T0 + 2 * MIN });
  assert.equal(absorbed.reason, 'blocked-human');
  const kept = decide({ snap: greenOnly, previous: { watch: runningWatch, humanOnlyPending: true, pendingWatch: runningWatch, pendingKey: 'k', pendingPassCount: 1, lastPassAt: T0 - 11 * MIN }, now: T0 + 2 * MIN });
  assert.notEqual(kept.reason, 'blocked-human', '未确认的更新不被吸收');
  assert.ok(kept.nextPendingWatch, '待确认的那一份保留');

  // 保底巡检只对还有技术活的 PR 叫醒(只等人审或合并的见专门用例)。
  const busy = snap({ verdict: 'NEEDS_WORK', blockers: ['review_threads_open'] });
  const quiet = { watch: seenWatch(snap()), lastPassAt: T0 };
  const day = 24 * 60 * MIN;
  assert.equal(decide({ snap: snap(), previous: quiet, now: T0 + day - MIN }).reason, 'idle');
  const guard = decide({ snap: busy, previous: quiet, now: T0 + day });
  assert.equal(guard.reason, 'silence-guard');
  assert.equal(guard.nextPendingWatch, null);
  assert.equal(decide({ snap: snap(), previous: { ...quiet, nextAllowAt: T0 + 2 * day }, now: T0 + day }).reason, 'deferred');
  const expired = decide({ snap: snap(), previous: { ...quiet, nextAllowAt: T0 + 15 * MIN }, now: T0 + 20 * MIN });
  assert.equal(expired.reason, 'defer-expired', '到点再唤起一次(等机器人 review 的那 15 分钟)');
  assert.equal(expired.keepNextAllowAt, undefined, '放行即消费');
  assert.equal(probeAllowsSkip({ watch: quiet.watch, probe: { status: 's', remarks: 'r' }, lastFullReadAt: T0 + 19 * MIN, lastPassAt: T0, nextAllowAt: T0 + 15 * MIN }, { status: 's', remarks: 'r' }, T0 + 20 * MIN), false, '探测不跳过到点的 defer');
  // Review (Codex P2, Greptile P2 on #287): while news is held for the bots, an identical probe must
  // not skip the full read, or the hold would outlive its 20-minute deadline.
  const holding = { watch: quiet.watch, probe: { status: 's', remarks: 'r' }, lastFullReadAt: T0 + 5 * MIN, lastPassAt: T0, settleUntil: T0 + 20 * MIN };
  assert.equal(probeAllowsSkip(holding, { status: 's', remarks: 'r' }, T0 + 10 * MIN), false, '收齐期间探测不跳过');
  assert.equal(probeAllowsSkip({ ...holding, settleUntil: undefined }, { status: 's', remarks: 'r' }, T0 + 10 * MIN), true);
  const red = snap({ checks: [check('build', 'failed', { required: true })] });
  assert.equal(decide({ snap: red, previous: { ...quiet, nextAllowAt: T0 + 2 * day }, now: T0 + MIN }).reason, 'changed', '新事件穿透 defer');
});

test('decide:旧版状态升级时不补报旧事;有未确认的旧放行时只再唤起一次', () => {
  const red = snap({ checks: [check('build', 'failed', { required: true })], comments: [comment('C1', 'alice', '2026-10-01T00:00:00Z')] });
  const quiet = decide({ snap: red, previous: { fingerprint: 'old', lastPassAt: T0 }, now: T0 });
  assert.equal(quiet.reason, 'idle');
  assert.deepEqual(quiet.nextWatch.failedChecks, ['build']);
  const unacked = decide({ snap: red, previous: { fingerprint: 'old', pendingFingerprint: 'older' }, now: T0 });
  assert.equal(unacked.reason, 'upgraded');
  assert.equal(unacked.exitCode, 0);
});

// ── 端到端(同一个 CLI 入口) ────────────────────────────────────────────────

test('新跟进:必需检查通过与失败各报一次,确认后安静;我们自己的推送不唤起', async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap({ checks: [check('build', 'pending', { required: true })] }));
  let r = await fx.run();
  assert.equal(r.code, 2, r.stdout);
  assert.match(r.stdout, /SKIP .*reason=idle/);

  fx.advance(10);
  fx.setSnapshot(snap({ checks: [check('build', 'failed', { required: true })] }));
  r = await fx.run();
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /PASS .*reason=changed \(events=\[checks-failed\]/);
  assert.match(r.stdout, /\n- Checks failed on aaa1111:\n {2}- build https:\/\/ci\/build\n/);
  assert.equal(fx.readState().lastResult.report, '- Checks failed on aaa1111:\n  - build https://ci/build');
  assert.equal((await fx.run(['--resume', 'Pushed the build fix.'])).code, 0);

  fx.advance(10);
  fx.setSnapshot(snap({ latestCommitOid: 'bbb2222', checks: [check('build', 'pending', { required: true })], comments: [comment('C1', 'me', iso(fx.now()), 'pushed a fix')] }));
  r = await fx.run();
  assert.equal(r.code, 2, '自己的推送和回复不唤起');

  fx.advance(10);
  fx.setSnapshot(snap({ latestCommitOid: 'bbb2222', checks: [check('build', 'passed', { required: true })] }));
  r = await fx.run();
  assert.match(r.stdout, /events=\[checks-passed\]/);
  assert.match(r.stdout, /All 1 required check passed on bbb2222\./);
  assert.equal((await fx.run(['--ack'])).code, 0);
  fx.advance(10);
  assert.equal((await fx.run()).code, 2);
});

test('放行后没 ack → 下一轮重试;慢 agent 的 ack 不会确认它没见过的新留言', async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap());
  await fx.run();
  assert.equal((await fx.run(['--ack'])).code, 0);

  fx.advance(10);
  const c1 = comment('C1', 'alice', iso(fx.now()), 'first');
  fx.setSnapshot(snap({ comments: [c1] }));
  assert.match((await fx.run()).stdout, /reason=changed/);
  fx.advance(10);
  assert.match((await fx.run()).stdout, /reason=retry-unacked/, '没确认就重试');

  // agent 还在跑时又来一条;agent 随后 ack 只确认它被告知过的那一条
  fx.advance(5);
  const c2 = comment('C2', 'bob', iso(fx.now()), 'second');
  fx.setSnapshot(snap({ comments: [c1, c2] }));
  assert.equal((await fx.run(['--ack'])).code, 0);
  fx.advance(5);
  const r = await fx.run();
  assert.equal(r.code, 0);
  assert.match(r.stdout, /1 new comment:\n {2}- bob: "second"/);
});

test('--defer 隐含 ack 并压住保底巡检;新事件照常穿透并消费掉 defer', async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap({ checks: [check('build', 'failed', { required: true })] }));
  await fx.run();
  await fx.run(['--defer', '240']);
  const state = fx.readState();
  assert.equal(state.pendingWatch, undefined);
  assert.deepEqual(state.watch.failedChecks, ['build']);
  fx.advance(10);
  assert.match((await fx.run()).stdout, /reason=deferred/);
  assert.ok(fx.readState().nextAllowAt > fx.now(), 'defer 跨轮保留');
  fx.setSnapshot(snap({ checks: [check('build', 'failed', { required: true })], comments: [comment('C1', 'alice', iso(fx.now()))] }));
  assert.match((await fx.run()).stdout, /PASS .*reason=changed/);
  assert.equal(fx.readState().nextAllowAt, undefined);
});

test('合并后每轮放行直到收口;状态文件损坏时按新跟进处理', async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap({ merged: true, verdict: 'MERGED_CLEANUP_READY' }));
  await fx.run();
  const again = await fx.run(['--json']);
  assert.equal(again.code, 0);
  assert.equal(again.json().reason, 'terminal');
  assert.doesNotMatch(again.json().detail, /round=/, '收口轮只有收口指令');

  fs.writeFileSync(fx.stateFile(), '{ broken', 'utf8');
  fx.setSnapshot(snap());
  const r = await fx.run();
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /events=\[checks-passed\]/);
});

test('低成本探测:与上次完整读取一致时不做完整快照;有理由时照常完整读取', async (t) => {
  const fx = createFixture(t);
  const probe = { status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2', remarks: '0  0  0' };
  fx.setProbe(probe);
  fx.setSnapshot(snap());
  await fx.run();
  assert.equal((await fx.run(['--ack'])).code, 0);
  fx.advance(10);
  const reads = fx.snapshotRuns();
  let r = await fx.run();
  assert.equal(r.code, 2);
  assert.match(r.stdout, /reason=unchanged/);
  assert.match(r.stdout, /CINDY_PRECHECK_OK/);
  assert.equal(fx.snapshotRuns(), reads, '跳过时不调完整快照');

  fx.setProbe({ ...probe, remarks: '1 2026-10-20T10:20:00Z 0  0' });
  fx.setSnapshot(snap({ comments: [comment('C1', 'alice', iso(fx.now()))] }));
  r = await fx.run();
  assert.match(r.stdout, /reason=changed/);
  assert.equal(fx.snapshotRuns(), reads + 1);

  const previous = fx.readState();
  const now = fx.now();
  const settled = { ...previous, pendingWatch: undefined };
  assert.equal(probeAllowsSkip(settled, previous.probe, now + MIN), true);
  assert.equal(probeAllowsSkip(previous, previous.probe, now + MIN), false, '有未确认的放行');
  assert.equal(probeAllowsSkip({ ...settled, inFlight: true }, previous.probe, now + MIN), false, '检查在跑');
  assert.equal(probeAllowsSkip(settled, previous.probe, now + 31 * MIN), false, '30 分钟完整读一次');
  assert.equal(probeAllowsSkip(settled, { ...previous.probe, status: 'x' }, now + MIN), false);
  assert.equal(probeAllowsSkip(settled, null, now + MIN), false, '探测失败');
  assert.equal(probeAllowsSkip({ ...settled, verdict: 'NEEDS_WORK', blockers: ['ci_failing'], lastPassAt: now - 24 * 60 * MIN }, previous.probe, now + MIN), false, '保底巡检到点');
  // 当保底巡检在 decide() 中被人工等待/活跃 wait/defer 抑制时，探测一致不应丢弃结果强拉完整快照。
  assert.equal(probeAllowsSkip({ ...settled, verdict: 'READY', lastPassAt: now - 48 * 60 * MIN }, previous.probe, now + MIN), true, 'READY 等合并超过 24 小时仍可走探测');
  assert.equal(probeAllowsSkip({ ...settled, verdict: 'BLOCKED_HUMAN', blockers: ['approval_required'], lastPassAt: now - 48 * 60 * MIN }, previous.probe, now + MIN), true, '仅等人工审批超过 24 小时仍可走探测');
  assert.equal(probeAllowsSkip({ ...settled, verdict: 'NEEDS_WORK', blockers: ['approval_required'], humanOnlyPending: true, lastPassAt: now - 48 * 60 * MIN }, previous.probe, now + MIN), true, 'humanOnlyPending 超过 24 小时仍可走探测');
  const activeHumanWait = { kind: 'human', headSha: 'aaa1111', reason: 'wait merge', createdAt: now - 48 * 60 * MIN, until: null, checks: [], threads: [] };
  assert.equal(probeAllowsSkip({ ...settled, verdict: 'NEEDS_WORK', blockers: ['ci_failing'], wait: activeHumanWait, lastPassAt: now - 48 * 60 * MIN }, previous.probe, now + MIN), true, '未到点的 wait 不应被静默门禁强拉完整快照');
  assert.equal(probeAllowsSkip({ ...settled, verdict: 'NEEDS_WORK', blockers: ['ci_failing'], nextAllowAt: now + 30 * MIN, lastPassAt: now - 48 * 60 * MIN }, previous.probe, now + MIN), true, '未到点的 defer 不应被静默门禁强拉完整快照');
  // Base-branch churn briefly flips mergeable to UNKNOWN while GitHub recalculates; keep skipping
  // when everything else matches, while real transitions (CONFLICTING / UNKNOWN->MERGEABLE) still miss.
  const knownProbe = { status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2 ', remarks: '0  0  0', base: 'base-1' };
  const transientUnknown = { ...knownProbe, status: 'OPEN false UNKNOWN aaa1111  SUCCESS:2 ', base: 'base-2' };
  const conflicted = { ...knownProbe, status: 'OPEN false CONFLICTING aaa1111  SUCCESS:2 ', base: 'base-2' };
  const settledKnown = { ...settled, probe: knownProbe };
  assert.equal(probeAllowsSkip(settledKnown, transientUnknown, now + MIN), true, '瞬态 UNKNOWN 不应打穿已知 MERGEABLE 探测');
  assert.equal(probeAllowsSkip(settledKnown, conflicted, now + MIN), false, 'MERGEABLE → CONFLICTING 必须完整读取');
  assert.equal(probeAllowsSkip({ ...settledKnown, probe: transientUnknown }, knownProbe, now + MIN), false, '上次未知变为已知必须完整读取');
  assert.equal(
    probeAllowsSkip({ ...settledKnown, watch: { ...settledKnown.watch, baseSha: 'base-1' } }, transientUnknown, now + MIN),
    false,
    '失败期间 base 前进仍须完整读取',
  );
});

test('终态退避端到端: 复用调度 --ack 后不每 5 分钟空转，且退避期内零 API 调用', async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap({ merged: true, verdict: 'MERGED_CLEANUP_READY' }));
  for (let i = 0; i < 3; i += 1) {
    const r = await fx.run(['--json']);
    assert.equal(r.code, 0);
    assert.equal(r.json().reason, 'terminal');
    assert.equal((await fx.run(['--ack'])).code, 0);
    fx.advance(5);
  }
  // 4th tick enters terminal-backoff (30 min from 3rd pass), skipping without waking agent.
  const b1 = await fx.run(['--json']);
  assert.equal(b1.code, 2);
  assert.equal(b1.json().reason, 'terminal-backoff');

  // With pacing enabled (production default), ticks inside terminalBackoffUntil skip with zero GitHub calls.
  fx.advance(5);
  assert.equal(pacingDue(fx.readState(), fx.now()).due, false);
  assert.equal(pacingDue(fx.readState(), fx.now()).reason, 'terminal-backoff');
  assert.equal(pacingDue(fx.readState(), fx.now(), { triggered: true }).due, true, '宿主事件触发仍可穿透以检测重开');

  // Even with --no-pacing, decide() stays in terminal-backoff without waking the agent.
  const b2 = await fx.run(['--json']);
  assert.equal(b2.code, 2);
  assert.equal(b2.json().reason, 'terminal-backoff');

  // Once the 30-minute window passes, pacing becomes due and gate emits terminal-backoff-attempt with notify directive, escalating to 2h.
  fx.advance(25);
  assert.equal(pacingDue(fx.readState(), fx.now()).due, true);
  const b3 = await fx.run(['--pacing', '--json']);
  assert.equal(b3.code, 0);
  assert.equal(b3.json().reason, 'terminal-backoff-attempt');
  assert.match(b3.json().detail, /schedule_notify_current_run/);
  assert.equal(fx.readState().terminalPassCount, 4);
  const nextDeadline = fx.now() + 120 * MIN;
  assert.equal(fx.readState().terminalBackoffUntil, nextDeadline);

  // If the host defers that terminal-backoff-attempt (e.g. user-active) and retries ~90s later
  // with pacing enabled (default minPassSpacingMinutes=5), pacing must let it through so decide()
  // replays the unexecuted reminder with the notify directive and unchanged deadline.
  fx.advance(1.5);
  const retryArgs = ['--pacing', '--min-pass-spacing-minutes', '5', '--json'];
  assert.equal(pacingDue(fx.readState(), fx.now()).due, true);
  const b3Retry = await fx.run(retryArgs);
  assert.equal(b3Retry.code, 0);
  assert.equal(b3Retry.json().reason, 'terminal-backoff-attempt');
  assert.match(b3Retry.json().detail, /schedule_notify_current_run/);
  assert.equal(fx.readState().terminalPassCount, 4);
  assert.equal(fx.readState().terminalBackoffUntil, nextDeadline);

  // Once the agent actually runs and acknowledges (--ack), even a tick 90s later stays in
  // terminal-backoff with zero GitHub calls.
  assert.equal((await fx.run(['--ack'])).code, 0);
  fx.advance(1.5);
  const readsBeforeAckSkip = fx.snapshotRuns();
  const b3PostAck = await fx.run(retryArgs);
  assert.equal(b3PostAck.code, 2);
  assert.equal(b3PostAck.json().reason, 'not-due');
  assert.match(b3PostAck.json().detail, /pace=terminal-backoff/);
  assert.equal(fx.snapshotRuns(), readsBeforeAckSkip, '已确认后在退避期内不得调用 GitHub');
});

test('宿主触发完整快照会用 snap.probe 刷新探测基线，下一轮普通巡检直接命中 unchanged', async (t) => {
  const fx = createFixture(t);
  const freshProbe = { status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2 ', remarks: '0  0  0', base: 'base-1' };
  fx.setProbe(freshProbe);
  fx.setSnapshot({ ...snap(), probe: freshProbe });
  // Triggered run skips runProbe(), yet persists snap.probe into state.
  assert.equal((await fx.run(['--triggered'])).code, 0);
  assert.equal((await fx.run(['--ack'])).code, 0);
  assert.deepEqual(fx.readState().probe, freshProbe);

  fx.advance(10);
  const reads = fx.snapshotRuns();
  const next = await fx.run(['--json']);
  assert.equal(next.code, 2);
  assert.equal(next.json().reason, 'unchanged');
  assert.equal(fx.snapshotRuns(), reads, '命中刷新后的 probe，不再补拉完整快照');
});

test('快照检查与 GraphQL 探测错位 (probe: null) 时不缓存新探针且下轮按 5 分钟强制完整重读', async (t) => {
  const fx = createFixture(t);
  const greenProbe = { status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2 ', remarks: '0  0  0', base: 'base-1' };
  const failedProbe = { status: 'OPEN false MERGEABLE aaa1111  FAILURE:1,SUCCESS:2 ', remarks: '0  0  0', base: 'base-1' };
  const greenSnap = snap({ verdict: 'READY' });
  fx.setProbe(greenProbe);
  fx.setSnapshot({ ...greenSnap, probe: greenProbe });
  assert.equal((await fx.run(['--pacing'])).code, 0);
  assert.equal((await fx.run(['--ack'])).code, 0);
  // Cool down past 1h so the PR is in waiting pace (30 min).
  fx.writeState({ lastPassAt: fx.now() - 120 * MIN });

  // A check reruns and fails between gh pr view and GraphQL: probe already sees FAILURE:1,
  // while snap.checks still carries the older green rollup, so pr-snapshot emits probe: null.
  fx.advance(30);
  fx.setProbe(failedProbe);
  fx.setSnapshot({ ...greenSnap, probe: null });
  const skewed = await fx.run(['--pacing', '--json']);
  assert.equal(skewed.code, 2);
  assert.equal(fx.readState().probe, undefined, '错位快照不得缓存新的或旧的 probe 基线');
  assert.equal(fx.readState().inFlight, true, '错位快照标记 inFlight，促使下一轮 5 分钟完整重读');

  // 5 minutes later (not 30 minutes!), pacing is due and forces a full snapshot that catches the failure.
  fx.advance(5);
  fx.setSnapshot({
    ...snap({ checks: [check('build', 'passed', { required: true }), check('lint', 'failed', { required: true })], verdict: 'NEEDS_WORK', blockers: ['ci_failing'] }),
    probe: failedProbe,
  });
  const readsBefore = fx.snapshotRuns();
  const caught = await fx.run(['--pacing', '--json']);
  assert.equal(caught.code, 0, caught.stdout);
  assert.equal(fx.snapshotRuns(), readsBefore + 1);
  assert.match(caught.json().detail, /events=\[checks-failed\]/);
  assert.deepEqual(fx.readState().probe, failedProbe);
  assert.equal(fx.readState().inFlight, false);

  // Unavailable checks must also never cache a probe baseline even on legacy snapshots without snap.probe.
  const fx2 = createFixture(t);
  fx2.setProbe(failedProbe);
  fx2.setSnapshot(snap({ checksSummary: { unavailable: true } }));
  await fx2.run();
  assert.equal(fx2.readState().probe, undefined, 'checks unavailable 不得持久化 probe 基线');
});

test('超过 24 小时的人工等待在探测一致时跳过完整快照；首次 gh api 未登录报错仍诊断为 auth', async (t) => {
  const fx = createFixture(t);
  const probe = { status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2', remarks: '0  0  0' };
  fx.setProbe(probe);
  fx.setSnapshot(snap({ verdict: 'READY' }));
  await fx.run();
  const wait = { kind: 'human', headSha: 'aaa1111', reason: 'waiting for maintainer merge', afterMinutes: null, checks: [], threads: [] };
  assert.equal((await fx.run(['--wait', fx.writeWait(wait)])).code, 0);
  // 模拟静默超过 48 小时，但最近刚做过一次完整读取（10 分钟前）
  fx.advance(10);
  fx.writeState({ lastPassAt: fx.now() - 48 * 60 * MIN });
  const reads = fx.snapshotRuns();
  const skipped = await fx.run(['--json']);
  assert.equal(skipped.code, 2);
  assert.equal(skipped.json().reason, 'unchanged');
  assert.equal(fx.snapshotRuns(), reads, '探测匹配时不应强跑完整快照');

  const noCredsPlan = snapshotFailurePlan(
    { code: 1, stderr: '[gh] fatal on repos/acme/widgets/pulls/42: To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n' },
    null,
    fx.now(),
    1,
  );
  assert.equal(noCredsPlan.diagnosis.kind, 'auth');
  const badCredsPlan = snapshotFailurePlan(
    { code: 1, stderr: '[gh] fatal on repos/acme/widgets/pulls/42: gh: Bad credentials (HTTP 401)\n' },
    null,
    fx.now(),
    1,
  );
  assert.equal(badCredsPlan.diagnosis.kind, 'auth');
});

test('探针收到明确限流时直接进入退避、保留 retryAt，且零次调用完整快照', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-probe-rate-limit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateDir = path.join(dir, 'state');
  const fakeSnapshot = path.join(dir, 'fake-snapshot.mjs');
  fs.writeFileSync(fakeSnapshot, '// placeholder for existsSync check\n', 'utf8');

  let clock = T0;
  let probeCalls = 0;
  let snapshotCalls = 0;
  let probeReply = { code: 0, stdout: JSON.stringify({ status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2', remarks: '0  0  0' }), stderr: '' };
  const currentSnap = snap({ verdict: 'READY' });
  const run = async (extra = []) => {
    let stdout = '';
    let stderr = '';
    const code = await runGate([PR_URL, '--state-dir', stateDir, '--snapshot', fakeSnapshot, '--min-pass-spacing-minutes', '0', '--no-pacing', ...extra], {
      now: () => clock,
      runProbe: async () => { probeCalls += 1; return probeReply; },
      runSnapshot: async () => { snapshotCalls += 1; return { code: 0, stdout: JSON.stringify(currentSnap), stderr: '' }; },
      readTrigger: async () => null,
      out: (text) => { stdout += text; },
      err: (text) => { stderr += text; },
    });
    return { code, stdout, stderr };
  };

  // Seed baseline and acknowledge so the next tick uses probe first.
  assert.equal((await run()).code, 0);
  assert.equal((await run(['--ack'])).code, 0);
  const readsBefore = snapshotCalls;

  // Probe receives explicit rate limit with retryAt: must enter backoff directly with 0 full snapshots.
  clock += 5 * MIN;
  const resetAt = clock + 45 * MIN;
  probeReply = {
    code: 1,
    stdout: '',
    stderr: `[gh-rate-limit] retryAt=${resetAt}\n[gh] fatal on graphql: gh: API rate limit already exceeded (HTTP 403)\n`,
  };
  const blocked = await run();
  assert.equal(blocked.code, 1, 'first rate-limit failure notifies once');
  assert.match(blocked.stderr, /GitHub API rate limit reached/);
  assert.equal(snapshotCalls, readsBefore, 'probe rate limit must not trigger a full snapshot');
  const diagMatch = /CINDY_PR_CHECK_DIAGNOSIS (\{[^\n]+\})/.exec(blocked.stdout);
  assert.ok(diagMatch, blocked.stdout);
  assert.deepEqual(JSON.parse(diagMatch[1]), { kind: 'rate-limit', failures: 1, retryAt: resetAt + 1000 });
  const saved = JSON.parse(fs.readFileSync(stateFilePath(stateDir, REPO, NUMBER), 'utf8'));
  assert.equal(saved.snapshotFailureBackoffUntil, resetAt + 1000);
  assert.equal(saved.consecutiveSnapshotFailures, 1);

  // Before retryAt, scheduled ticks skip immediately with 0 probes and 0 snapshots.
  const probesBeforeBackoff = probeCalls;
  clock += 10 * MIN;
  const skipped = await run(['--json']);
  assert.equal(skipped.code, 2);
  assert.equal(JSON.parse(skipped.stdout).reason, 'snapshot-failure-backoff');
  assert.equal(probeCalls, probesBeforeBackoff);
  assert.equal(snapshotCalls, readsBefore);

  // After retryAt passes, gate recovers via full snapshot and clears failure state.
  clock = resetAt + 2000;
  probeReply = { code: 0, stdout: JSON.stringify({ status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2', remarks: '0  0  0' }), stderr: '' };
  const recovered = await run(['--json']);
  assert.equal(recovered.code, 2);
  assert.equal(snapshotCalls, readsBefore + 1);
  assert.equal(JSON.parse(fs.readFileSync(stateFilePath(stateDir, REPO, NUMBER), 'utf8')).consecutiveSnapshotFailures, 0);
});

test('从未放行过的跟进也能数满静默时长:起点固定在首次检查,不随每轮刷新', async (t) => {
  const fx = createFixture(t);
  const probe = { status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2', remarks: '0  0  0' };
  fx.setProbe(probe);
  fx.setSnapshot(snap({ verdict: 'NEEDS_WORK', blockers: ['review_threads_open'] }));
  await fx.run();
  assert.equal((await fx.run(['--resume', 'Handled the reported threads.'])).code, 0);
  // 模拟「从未放行过」:状态里没有 lastPassAt(例如没有 CI、没有评论、没有冲突)
  fx.writeState({ lastPassAt: undefined, silenceSince: undefined });
  assert.equal(fx.readState().lastPassAt, undefined);

  fx.advance(31); // 超过 30 分钟的完整读取间隔:这一轮走完整读取并跳过
  let r = await fx.run();
  assert.equal(r.code, 2, r.stdout);
  const anchor = fx.readState().silenceSince;
  assert.ok(anchor > 0, '首次跳过时写下计时起点');
  assert.equal(fx.readState().lastPassAt, undefined);

  // 每 10 分钟一轮、每 30 分钟完整读取一次(lastCheckedAt 随之刷新),连续跑 23 小时:起点不变,仍未到点
  for (let i = 0; i < 6 * 23; i++) {
    fx.advance(10);
    r = await fx.run();
    assert.equal(r.code, 2, `第 ${i} 轮不该放行: ${r.stdout}`);
  }
  assert.equal(fx.readState().silenceSince, anchor, '起点不随检查刷新');

  // 满 24 小时:保底巡检放行,并从此以 lastPassAt 为准
  fx.advance(70);
  r = await fx.run(['--json']);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json().reason, 'silence-guard');
  assert.ok(fx.readState().lastPassAt > 0);
});

test('保底巡检起点:最近放行 > 首次检查 > 旧版状态里的上次检查', () => {
  const day = 24 * 60 * MIN;
  const busy = snap({ verdict: 'NEEDS_WORK', blockers: ['review_threads_open'] });
  const quiet = { watch: seenWatch(busy) };
  assert.equal(decide({ snap: busy, previous: { ...quiet, silenceSince: T0, lastCheckedAt: T0 + day - MIN }, now: T0 + day }).reason, 'silence-guard');
  assert.equal(decide({ snap: busy, previous: { ...quiet, lastCheckedAt: T0 + day - MIN }, now: T0 + day }).reason, 'idle', '旧版状态只能按上次检查算');
  assert.equal(decide({ snap: busy, previous: { ...quiet, silenceSince: T0 - 2 * day, lastPassAt: T0 }, now: T0 + day - MIN }).reason, 'idle', '放行过就以最近放行为准');
});

test('快照失败先容忍瞬时抖动,连续到阈值才 fail-closed —— 绝不静默跳过', async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap());
  await fx.run();
  assert.equal((await fx.run(['--ack'])).code, 0);
  const failEnv = { FAKE_SNAPSHOT_EXIT: '2', FAKE_SNAPSHOT_STDERR: '[pr-snapshot] gh auth expired\n' };
  assert.equal((await fx.run([], failEnv)).code, 2);
  assert.match(fx.readState().lastResult.detail, /failures=1\/3/);
  assert.equal((await fx.run([], failEnv)).code, 2);
  const r3 = await fx.run([], failEnv);
  assert.equal(r3.code, 1, '连续第 3 轮失败必须 fail-closed 让用户看见');
  assert.match(r3.stderr, /3 consecutive rounds.*gh auth expired/s);
  assert.equal(fx.readState().lastResult.reason, 'snapshot-failed');
  assert.equal((await fx.run()).code, 2);
  assert.equal(fx.readState().lastResult.reason, 'snapshot-failure-backoff');
  fx.writeState({ snapshotFailureBackoffUntil: 0 });
  const ok = await fx.run();
  assert.equal(ok.code, 2, ok.stderr);
  assert.equal(fx.readState().consecutiveSnapshotFailures, 0);
});

test('blocked snapshot reports its underlying cause and scheduled probe', async (t) => {
  for (const [stderr, kind] of [
    ['- To re-authenticate, run: gh auth refresh -h github.com\n- Error: Get "https://api.github.com/": dial tcp: lookup api.github.com: no such host', 'dns'],
    ['The token in keyring is invalid.\nError: dial tcp: lookup api.github.com on 127.0.0.1:53: i/o timeout', 'dns'],
    ['HTTP 401: Bad credentials', 'auth'],
    ['HTTP 429', 'rate-limit'],
    ['[gh-rate-limit] retryAt=0\nHTTP 429\ndial tcp: lookup api.github.com: i/o timeout', 'rate-limit'],
    ['dial tcp: i/o timeout', 'timeout'],
    ['unexpected response\n- To re-authenticate, run: gh auth refresh', 'unknown'],
  ]) {
    const fx = createFixture(t);
    const result = await fx.run(['--max-snapshot-failures', '1'], { FAKE_SNAPSHOT_EXIT: '1', FAKE_SNAPSHOT_STDERR: stderr });
    assert.equal(result.code, 1);
    const marker = result.stdout.split('\n').find(line => line.startsWith('CINDY_PR_CHECK_DIAGNOSIS '));
    const diagnosis = JSON.parse(marker.slice('CINDY_PR_CHECK_DIAGNOSIS '.length));
    assert.equal(diagnosis.kind, kind);
    assert.equal(diagnosis.retryAt, fx.readState().snapshotFailureBackoffUntil);
    assert.equal(diagnosis.failures, 1);
    if (kind === 'dns') assert.equal(diagnosis.host, 'api.github.com');
    assert.ok(!result.stderr.split('\n')[0].includes('gh auth refresh'));
    assert.ok(result.stderr.includes(stderr));
  }
});

test('new follower reports an inherited snapshot outage once without bypassing its retry deadline', async (t) => {
  const fx = createFixture(t);
  const fail = { FAKE_SNAPSHOT_EXIT: '1', FAKE_SNAPSHOT_STDERR: 'HTTP 429' };
  const args = ['--max-snapshot-failures', '1'];
  assert.equal((await fx.run(args, fail)).code, 1);
  const deadline = fx.readState().snapshotFailureBackoffUntil;
  const reads = fx.snapshotRuns();
  fx.setTrigger({ firstScheduleId: 'new-follower' });
  const next = await fx.run(args, fail);
  assert.equal(next.code, 1);
  assert.match(next.stderr, /rate limit/i);
  assert.equal(fx.snapshotRuns(), reads);
  assert.equal(fx.readState().snapshotFailureBackoffUntil, deadline);
  assert.equal((await fx.run(args, fail)).code, 2);
  assert.equal(fx.snapshotRuns(), reads);
  fx.advance(31);
  assert.equal((await fx.run(args, fail)).code, 2);
  assert.equal(fx.snapshotRuns(), reads+1);
});

test('new follower reads the 1.5.35 failure state and deduplicates it through expiry', async (t) => {
  const fx = createFixture(t);
  const fail = { FAKE_SNAPSHOT_EXIT: '1', FAKE_SNAPSHOT_STDERR: 'HTTP 429' };
  const args = ['--max-snapshot-failures', '1'];
  assert.equal((await fx.run(args, fail)).code, 1);
  const old = fx.readState();
  fx.writeState({ snapshotFailureSummary: undefined });
  assert.equal(Object.hasOwn(fx.readState(), 'snapshotFailureSummary'), false);
  const reads = fx.snapshotRuns();
  fx.setTrigger({ firstScheduleId: 'new-follower' });
  const result = await fx.run(args, fail);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /rate limit/i);
  assert.equal(fx.snapshotRuns(), reads);
  assert.equal(fx.readState().snapshotFailureBackoffUntil, old.snapshotFailureBackoffUntil);
  assert.ok(fx.readState().snapshotFailureReports[old.snapshotFailureFingerprint]);
  fx.advance(31);
  assert.equal((await fx.run(args, fail)).code, 2);
  assert.equal(fx.snapshotRuns(), reads + 1);
});

test('a change to the watched PR retries a network failure without moving the scheduled retry', async (t) => {
  const fx = createFixture(t);
  const fail = { FAKE_SNAPSHOT_EXIT: '1', FAKE_SNAPSHOT_STDERR: 'lookup api.github.com: i/o timeout' };
  const args = ['--max-snapshot-failures', '1'];
  const watch = { kind: 'watch', source: 'pr-status', detail: PR_URL };
  fx.setSnapshot(snap());
  assert.equal((await fx.run(args, fail)).code, 1);
  const retryAt = fx.readState().snapshotFailureBackoffUntil;
  fx.advance(1);
  for (const trigger of [null, { ...watch, detail: PR_URL + '0' }, { ...watch, source: 'other' }]) {
    fx.setTrigger(trigger);
    assert.match((await fx.run()).stdout, /snapshot-failure-backoff/);
  }
  assert.equal(fx.snapshotRuns(), 1);
  fx.setTrigger(watch);
  const early = await fx.run(args, { ...fail, FAKE_SNAPSHOT_STDERR: 'lookup api.github.com: no such host' });
  assert.equal(fx.snapshotRuns(), 2, 'the change allows one fresh snapshot');
  assert.equal(early.code, 2, 'the same DNS outage does not notify twice');
  assert.doesNotMatch(early.stdout, /CINDY_PRECHECK_OK/);
  assert.equal(fx.readState().snapshotFailureBackoffUntil, retryAt);
  assert.match((await fx.run()).stdout, /snapshot-failure-backoff/);
  assert.equal(fx.snapshotRuns(), 2, 'a burst of changes does not repeat a failed read');
  fx.advance(5);
  fx.setTrigger(null);
  assert.match((await fx.run()).stdout, /snapshot-failure-backoff/);
  fx.setTrigger(watch);
  assert.match((await fx.run()).stdout, /CINDY_PRECHECK_OK/);
  assert.equal(fx.snapshotRuns(), 3);
  assert.equal(fx.readState().consecutiveSnapshotFailures, 0);
});

test('PR changes leave rate limits, sign-in errors and old unclassified backoff alone', async (t) => {
  for (const error of ['HTTP 429', 'HTTP 401: Bad credentials', null]) {
    const fx = createFixture(t);
    if (error) {
      assert.equal((await fx.run(['--max-snapshot-failures', '1'], { FAKE_SNAPSHOT_EXIT: '1', FAKE_SNAPSHOT_STDERR: error })).code, 1);
    } else {
      fx.writeState({ consecutiveSnapshotFailures: 3, snapshotFailureBackoffUntil: T0 + 30 * MIN });
    }
    fx.setTrigger({ kind: 'watch', source: 'pr-status', detail: PR_URL });
    const reads = fx.snapshotRuns();
    assert.match((await fx.run()).stdout, /snapshot-failure-backoff/);
    assert.equal(fx.snapshotRuns(), reads);
  }
});

test('recovery requires a complete snapshot even if pacing or an unchanged probe could skip', async (t) => {
  const fx = createFixture(t);
  const healthy = snap({ isDraft: true });
  fx.setSnapshot(healthy);
  fx.setProbe({ status: 'unchanged', remarks: 'unchanged' });
  await fx.run();
  await fx.run(['--ack']);
  fx.setTrigger({ kind: 'watch', source: 'pr-status', detail: PR_URL });
  assert.equal((await fx.run(['--max-snapshot-failures', '1'], { FAKE_SNAPSHOT_EXIT: '1', FAKE_SNAPSHOT_STDERR: 'dial tcp: i/o timeout' })).code, 1);
  fx.advance(1);
  fx.setSnapshot({ ...healthy, checksSummary: { unavailable: true } });
  const reads = fx.snapshotRuns();
  const partial = await fx.run();
  assert.equal(fx.snapshotRuns(), reads + 1);
  assert.doesNotMatch(partial.stdout, /CINDY_PRECHECK_OK/);
  fx.setTrigger(null);
  assert.match((await fx.run(['--pacing'])).stdout, /snapshot-failure-backoff/);
  fx.advance(29);
  assert.doesNotMatch((await fx.run(['--pacing'])).stdout, /CINDY_PRECHECK_OK/);
  assert.equal(fx.snapshotRuns(), reads + 2);
  const idle = await fx.run(['--pacing']);
  assert.match(idle.stdout, /not-due/);
  assert.doesNotMatch(idle.stdout, /CINDY_PRECHECK_OK/);
  assert.equal(fx.snapshotRuns(), reads + 2, 'an incomplete read does not introduce extra polling');
  fx.setSnapshot(healthy);
  fx.setTrigger({ kind: 'watch', source: 'pr-status', detail: PR_URL });
  assert.match((await fx.run(['--pacing'])).stdout, /CINDY_PRECHECK_OK/);
  assert.equal(fx.readState().consecutiveSnapshotFailures, 0);
});

test('rate limits respect reset, deduplicate the episode, and remind after one day', () => {
  const now = 10_000_000;
  const run = { code: 1, stderr: `[gh-rate-limit] retryAt=${now + 600_000}\nAPI rate limit already exceeded` };
  const first = snapshotFailurePlan(run, {}, now);
  assert.equal(first.block, true);
  assert.equal(first.until, now + 601_000);
  const previous = { snapshotFailureReports: first.reports, consecutiveSnapshotFailures: 1 };
  assert.equal(snapshotFailurePlan(run, previous, now + 700_000).block, false);
  assert.equal(snapshotFailurePlan(run, previous, now + 24 * 60 * 60_000).block, true);
  const different = snapshotFailurePlan({ code: 1, stderr: 'auth expired' }, previous, now + 700_000, 1);
  assert.equal(different.block, true);
});

test('无效 JSON 与缺失的快照脚本都 fail-closed;快照不全时不打健康标记', async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap());
  await fx.run();
  const invalid = await fx.run(['--max-snapshot-failures', '1'], { FAKE_SNAPSHOT_STDOUT_RAW: 'not json at all' });
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /not valid JSON|consecutive rounds/);
  const missing = await fx.run(['--snapshot', path.join(fx.root, 'nope.mjs')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /snapshot script not found/);
  fx.writeState({ snapshotFailureBackoffUntil: 0 });
  fx.setSnapshot(snap({ checksSummary: { unavailable: true } }));
  assert.doesNotMatch((await fx.run()).stdout, /CINDY_PRECHECK_OK/);
});

test('只读查询:--last-result 带事件清单且不改状态;--suggest 兼容输出;混用写命令 fail-closed', async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap({ checks: [check('build', 'failed', { required: true })] }));
  await fx.run();
  const before = fs.readFileSync(fx.stateFile(), 'utf8');
  const last = await fx.run(['--last-result', '--json', '--snapshot', path.join(fx.root, 'nope.mjs')]);
  assert.equal(last.code, 0, last.stderr);
  assert.equal(last.json().lastResult.decision, 'run');
  assert.match(last.json().lastResult.report, /Checks failed/);
  const suggest = await fx.run(['--suggest']);
  assert.match(suggest.stdout, /paces itself/);
  for (const extra of [['--suggest', '--ack'], ['--last-result', '--defer', '60'], ['--suggest', '--last-result']]) {
    const r = await fx.run(extra);
    assert.equal(r.code, 1, `应拒绝: ${extra.join(' ')}`);
  }
  assert.equal(fs.readFileSync(fx.stateFile(), 'utf8'), before);

  const legacy = createFixture(t);
  legacy.writeState({ lastDecision: 'pass', lastDecisionReason: 'legacy-pass', lastCheckedAt: 123 });
  assert.deepEqual((await legacy.run(['--last-result', '--json'])).json().lastResult, { decision: 'run', reason: 'legacy-pass', checkedAt: 123 });
});

test('旧调度 hook 上已退役的选项被接受并忽略,不让跟进 fail-closed', async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap());
  const r = await fx.run(['--draft-reminder-hours', '0', '--max-work-pending-passes', '3', '--no-cadence-throttle']);
  assert.ok([0, 2].includes(r.code), r.stderr);
});

test('经软链调用时 main 照跑(退出码 0 不等于真跑过)', { skip: process.platform === 'win32' ? 'POSIX-only: symlink' : false }, async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap({ checks: [check('build', 'failed', { required: true })] }));
  const linked = path.join(fx.root, 'gate-via-symlink.mjs');
  fs.symlinkSync(gatePath, linked);
  const viaLink = await fx.runVia(linked);
  assert.equal(viaLink.code, 0, viaLink.stderr);
  assert.match(viaLink.stdout, /PASS .*events=\[checks-failed\]/, '软链调用必须真的做出判定');
  assert.ok(fx.readState().pendingWatch, '状态文件必须真的写了');
  const acked = await fx.runVia(linked, ['--resume', 'Pushed the build fix.']);
  assert.equal(acked.code, 0, acked.stderr);
  assert.match(acked.stdout, /reason=resumed/);
  assert.equal(fx.readState().pendingWatch, undefined, '软链调用的收尾必须真的提升基线');
});

// ── 机判提示(回合止损 / 临门一脚 / 无底洞 / 范围膨胀) ─────────────────────

test('passAdvisories:回合数每轮报数,过检查点/硬止损线时给行动指令', () => {
  const s = snap({ verdict: 'NEEDS_WORK', blockers: ['unresolved_review_threads'] });
  assert.deepEqual(passAdvisories(s, 3), ['round=3']);
  assert.match(passAdvisories(s, 5)[0], /round=5 ⚠️ past the convergence checkpoint/);
  const hard = passAdvisories(s, 25);
  assert.match(hard[0], /not a stop condition.*stop patching comment by comment.*land one verifiable fix/);
});

test('passAdvisories:只剩人类 blocker 且 thread 将尽时提示临门一脚,有硬活时不提示', () => {
  const nearMerge = snap({
    verdict: 'NEEDS_WORK',
    blockers: ['unresolved_review_threads', 'branch_protection_blocked'],
    reviewThreads: { ...snap().reviewThreads, unresolvedCount: 2 },
  });
  const notes = passAdvisories(nearMerge, 3);
  assert.equal(notes.length, 2);
  assert.match(notes[1], /almost there.*user must decide, notify and ask again this round.*only when no user decision remains/);
  assert.equal(passAdvisories({ ...nearMerge, blockers: [...nearMerge.blockers, 'ci_failing'] }, 3).length, 1);
});

test('passAdvisories:单文件 thread 累计超阈值时点名无底洞;diff 显著膨胀时提示范围膨胀', () => {
  const mkThread = (i, p) => ({ id: `T${i}`, path: p, isResolved: i % 2 === 0, isOutdated: false, comments: [] });
  const hot = snap({
    verdict: 'NEEDS_WORK',
    blockers: ['unresolved_review_threads'],
    reviewThreads: { ...snap().reviewThreads, unresolvedCount: 4, nodes: Array.from({ length: 8 }, (_, i) => mkThread(i, 'src/quote.ts')) },
  });
  assert.match(passAdvisories(hot, 2)[1], /hotspot: src\/quote\.ts has accumulated 8 review threads/);
  const grown = snap({ verdict: 'NEEDS_WORK', blockers: ['unresolved_review_threads'], additions: 2400 });
  assert.match(passAdvisories(grown, 3, { initialAdditions: 1100 })[1], /scope growth: the diff grew from \+1100 to \+2400 lines/);
  assert.equal(passAdvisories({ ...grown, additions: 1350 }, 3, { initialAdditions: 1100 }).length, 1);
  assert.equal(passAdvisories({ ...grown, additions: 2400 }, 3, { initialAdditions: 2000 }).length, 1);
});

test('回合状态:首次建档用可见 review 窗口播种,换 head 进新回合、清等待额度;提示随放行带出', async (t) => {
  const fx = createFixture(t);
  const reviews = ['h1', 'h2', 'h3'].map((oid, i) => ({ id: `R${i}`, author: 'greptile', state: 'COMMENTED', body: '', submittedAt: '2026-10-19T08:00:00Z', commitOid: oid }));
  fx.setSnapshot(snap({ latestCommitOid: 'h3', reviews, additions: 900 }));
  await fx.run();
  let st = fx.readState();
  assert.equal(st.roundCount, 3);
  assert.equal(st.initialAdditions, 900);
  assert.deepEqual(st.reviewersSeen, ['greptile']);
  await fx.run(['--defer', '15']);
  assert.equal(fx.readState().deferredHeadOid, 'h3');

  fx.advance(10);
  fx.setSnapshot(snap({ latestCommitOid: 'h4', reviews, additions: 2400, checks: [check('build', 'failed', { required: true })] }));
  const r = await fx.run(['--json']);
  assert.match(r.json().detail, /round=4.*scope growth: the diff grew from \+900 to \+2400 lines/);
  st = fx.readState();
  assert.equal(st.roundCount, 4);
  assert.equal(st.deferredHeadOid, undefined, '新回合的等待额度必须重置');
  assert.equal(st.initialAdditions, 900, '膨胀不改基线');
});

// ── 合并队列分类 ────────────────────────────────────────────────────────────

const removal = { __typename: 'RemovedFromMergeQueueEvent', id: 'removed-54', createdAt: '2026-10-09T01:56:40Z', reason: 'failed_checks' };
const failed = { failed: 1, pending: 0, failingRuns: [{ name: 'arm64-build', status: 'COMPLETED', conclusion: 'FAILURE' }] };
const queue = (overrides = {}) => ({ entry: null, event: removal, containsHead: true, checks: failed, ...overrides });

test('PR head green does not hide a failed merge-group eviction', () => {
  const q = classifyMergeQueue(queue());
  assert.equal(q.status, 'REMOVED');
  assert.ok(q.blockers.includes('merge_queue_removed'));
  assert.ok(q.blockers.includes('merge_queue_ci_failing'));
});

test('new head and later requeue supersede the old failure', () => {
  assert.deepEqual(classifyMergeQueue(queue({ containsHead: false })).blockers, []);
  const q = classifyMergeQueue(queue({ entry: { id: 'next', state: 'AWAITING_CHECKS' }, checks: { pending: 1 } }));
  assert.equal(q.status, 'ENQUEUED');
  assert.deepEqual(q.blockers, ['merge_queue_pending']);
});

test('missing evidence cannot be READY; terminal PR ignores old queue failure', () => {
  assert.deepEqual(classifyMergeQueue(queue({ containsHead: null })).blockers, ['merge_queue_unavailable']);
  assert.deepEqual(classifyMergeQueue(queue({ terminal: true })).blockers, []);
  assert.deepEqual(classifyMergeQueue(queue({ entry: { id: 'q' }, checks: { truncated: true } })).blockers, ['merge_queue_unavailable']);
});

test('manual/unknown removal still wakes investigation, not automatic reenqueuing', () => {
  for (const reason of ['manually_removed', 'unknown']) {
    const q = classifyMergeQueue(queue({ event: { ...removal, reason }, checks: {} }));
    assert.deepEqual(q.blockers, ['merge_queue_removed']);
  }
});

test('state files of different repositories never share a name, and ordinary names keep the old form', () => {
  const dir = '/state';
  assert.equal(stateFilePath(dir, 'acme/app', 12), '/state/acme__app-12.json');
  assert.notEqual(stateFilePath(dir, 'acme__tools/app', 12), stateFilePath(dir, 'acme/tools__app', 12));
  assert.ok(path.basename(stateFilePath(dir, 'acme__tools/app', 12)).startsWith('~'));
});

test('a followed PR whose repository name contains __ keeps its old state file under the new name, if it is its own', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-gate-state-'));
  try {
    const repo = 'acme__tools/app';
    const legacy = path.join(dir, 'acme__tools__app-12.json');
    const state = (url) => JSON.stringify({ watch: {}, url });
    // Written by the other repository that maps to the same old name: not adopted.
    fs.writeFileSync(legacy, state('https://github.com/acme/tools__app/pull/12'));
    const file = stateFilePath(dir, repo, 12);
    adoptLegacyStateFile(dir, repo, 12, file);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(legacy), true);
    // Its own PR URL: adopted.
    fs.writeFileSync(legacy, state('https://github.com/Acme__Tools/app/pull/12'));
    adoptLegacyStateFile(dir, repo, 12, file);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).url, 'https://github.com/Acme__Tools/app/pull/12');
    assert.equal(fs.existsSync(legacy), false);
    // An existing new file is never overwritten, and ordinary names are left alone.
    fs.writeFileSync(legacy, state('https://github.com/acme__tools/app/pull/12'));
    adoptLegacyStateFile(dir, repo, 12, file);
    assert.equal(fs.existsSync(legacy), true);
    fs.writeFileSync(path.join(dir, 'acme__app-1.json'), 'plain');
    adoptLegacyStateFile(dir, 'acme/app', 1, stateFilePath(dir, 'acme/app', 1));
    assert.equal(fs.readFileSync(path.join(dir, 'acme__app-1.json'), 'utf8'), 'plain');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unacknowledged failure in one workflow and a new one in another get different event keys', () => {
  const failA = snap({ checks: [check('test', 'failed', { workflowName: 'A', required: true })] });
  const failB = snap({ checks: [check('test', 'failed', { workflowName: 'B', required: true })] });
  const a = decide({ snap: failA, previous: { watch: seenWatch(snap()) }, now: T0 });
  const b = decide({ snap: failB, previous: { watch: seenWatch(snap()) }, now: T0 });
  assert.notEqual(a.nextPendingKey, b.nextPendingKey);
});

// ── 推送后收齐、按阶段节奏、宿主触发 ────────────────────────────────────────

const botReview = (id, author, commitOid, at, body = 'P2: tighten this') =>
  ({ id, author, authorIsBot: true, state: 'COMMENTED', body, submittedAt: at, url: `https://gh/${id}`, commitOid });

test('推送后先收齐:bot 与检查的新事件压到要等的 bot 都在新提交上给出结果', async (t) => {
  const fx = createFixture(t);
  // 第一个提交上 Codex 和 Greptile 都审过:之后的推送要等它们两个。
  const first = snap({ reviews: [botReview('R1', 'chatgpt-codex-connector', 'aaa1111', iso(T0 - 5 * MIN)), botReview('R2', 'greptile-apps', 'aaa1111', iso(T0 - 4 * MIN))] });
  fx.setSnapshot(first);
  await fx.run();
  assert.equal((await fx.run(['--ack'])).code, 0);

  // 推送新提交,CI 很快失败:先不叫醒。
  fx.advance(2);
  const red = { latestCommitOid: 'bbb2222', checks: [check('build', 'failed', { required: true })], verdict: 'NEEDS_WORK' };
  fx.setSnapshot(snap({ ...first, ...red }));
  let r = await fx.run(['--json']);
  assert.equal(r.code, 2, r.stdout);
  assert.equal(r.json().reason, 'settling');
  assert.match(r.json().detail, /chatgpt-codex-connector, greptile-apps/);
  assert.ok(fx.readState().settleUntil > fx.now());

  // Codex 只点 👍,Greptile 还没动:继续压。
  fx.advance(4);
  const thumbs = [{ content: 'THUMBS_UP', at: iso(fx.now()), author: 'chatgpt-codex-connector[bot]' }];
  fx.setSnapshot(snap({ ...first, ...red, reactions: thumbs }));
  r = await fx.run(['--json']);
  assert.equal(r.json().reason, 'settling');
  assert.match(r.json().detail, /held until greptile-apps answer/);

  // Greptile 在新提交上提了意见:收齐,一次叫醒,报出失败和意见。
  fx.advance(4);
  const greptile = botReview('R3', 'greptile-apps', 'bbb2222', iso(fx.now()));
  fx.setSnapshot(snap({ ...first, ...red, reactions: thumbs, reviews: [...first.reviews, greptile] }));
  r = await fx.run(['--json']);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.json().detail, /events=\[checks-failed,remarks\]/);
});

test('收齐窗口最多 20 分钟;人的留言不等,立刻叫醒', async (t) => {
  const fx = createFixture(t);
  const first = snap({ reviews: [botReview('R1', 'chatgpt-codex-connector', 'aaa1111', iso(T0 - 5 * MIN))] });
  fx.setSnapshot(first);
  await fx.run();
  assert.equal((await fx.run(['--ack'])).code, 0);
  fx.advance(2);
  const red = { latestCommitOid: 'bbb2222', checks: [check('build', 'failed', { required: true })], verdict: 'NEEDS_WORK' };
  fx.setSnapshot(snap({ ...first, ...red }));
  assert.equal((await fx.run(['--json'])).json().reason, 'settling');
  fx.advance(19);
  assert.equal((await fx.run(['--json'])).json().reason, 'settling');
  fx.advance(2);
  const late = await fx.run(['--json']);
  assert.equal(late.code, 0, '超过 20 分钟就不再等');
  assert.match(late.json().detail, /checks-failed/);

  // 新一轮:人留言时不压。
  assert.equal((await fx.run(['--resume', 'Pushed the next fix.'])).code, 0);
  fx.advance(2);
  const next = { latestCommitOid: 'ccc3333', checks: [check('build', 'failed', { required: true })], verdict: 'NEEDS_WORK' };
  fx.setSnapshot(snap({ ...first, ...next }));
  assert.equal((await fx.run(['--json'])).json().reason, 'settling');
  fx.advance(2);
  fx.setSnapshot(snap({ ...first, ...next, comments: [comment('C9', 'alice', iso(fx.now()), 'why this?')] }));
  const human = await fx.run(['--json']);
  assert.equal(human.code, 0);
  assert.match(human.json().detail, /remarks/);
});

test('仓库里常见的 bot reviewer 也要等;没有见过任何 bot 的仓库不等', async (t) => {
  const fx = createFixture(t);
  // 本 PR 还没被 bot 审过,但仓库记录里 Codex 最近审过别的 PR。
  fx.writeRepoState({ reviewerBots: { 'chatgpt-codex-connector': T0 - 60 * MIN } });
  fx.setSnapshot(snap());
  await fx.run();
  assert.equal((await fx.run(['--ack'])).code, 0);
  fx.advance(2);
  fx.setSnapshot(snap({ latestCommitOid: 'bbb2222', checks: [check('build', 'failed', { required: true })], verdict: 'NEEDS_WORK' }));
  assert.equal((await fx.run(['--json'])).json().reason, 'settling');

  const plain = createFixture(t);
  plain.setSnapshot(snap());
  await plain.run();
  assert.equal((await plain.run(['--ack'])).code, 0);
  plain.advance(2);
  plain.setSnapshot(snap({ latestCommitOid: 'bbb2222', checks: [check('build', 'failed', { required: true })], verdict: 'NEEDS_WORK' }));
  assert.equal((await plain.run(['--json'])).code, 0, '没有要等的 bot,照常立刻叫醒');
  assert.deepEqual(Object.keys(plain.readRepoState().reviewerBots), []);
});

test('按阶段节奏:只等人审时 30 分钟才看一次,不到时间不调用 GitHub;宿主触发立刻看', async (t) => {
  const fx = createFixture(t);
  const probe = { status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2', remarks: '0  0  0 0' };
  fx.setProbe(probe);
  fx.setSnapshot(snap({ verdict: 'READY' }));
  await fx.run(['--pacing']);
  assert.equal((await fx.run(['--ack'])).code, 0);
  // 上一轮叫醒 agent 已是很久以前(否则一小时内按活跃节奏看)。
  fx.writeState({ lastPassAt: T0 - 120 * MIN });
  const reads = fx.snapshotRuns();
  fx.advance(10);
  let r = await fx.run(['--pacing', '--json']);
  assert.equal(r.code, 2);
  assert.equal(r.json().reason, 'not-due');
  assert.match(r.json().detail, /pace=waiting/);
  assert.equal(fx.snapshotRuns(), reads, '不到时间不读快照');

  // 宿主看到变化而提前触发:跳过节奏和探测,直接完整读取。
  fx.setTrigger({ kind: 'watch', source: 'github-pr-status', detail: PR_URL });
  fx.setSnapshot(snap({ verdict: 'READY', comments: [comment('C1', 'alice', iso(fx.now()))] }));
  r = await fx.run(['--pacing', '--json']);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(fx.snapshotRuns(), reads + 1);
  fx.setTrigger(null);
  assert.equal((await fx.run(['--ack'])).code, 0);
  fx.writeState({ lastPassAt: T0 - 120 * MIN });

  fx.advance(31);
  r = await fx.run(['--pacing', '--json']);
  assert.notEqual(r.json().reason, 'not-due', '满 30 分钟照常看');
});

test('只等人工批准时保底巡检不叫醒 agent', () => {
  const approval = snap({ verdict: 'BLOCKED_HUMAN', blockers: ['approval_required'], reviewDecision: 'REVIEW_REQUIRED' });
  const quiet = { watch: seenWatch(approval), lastPassAt: T0 };
  const day = 24 * 60 * MIN;
  const result = decide({ snap: approval, previous: quiet, now: T0 + 2 * day });
  assert.equal(result.exitCode, 2);
  assert.equal(result.reason, 'waiting-human');
  // 还有技术活(检查失败)时照常保底巡检。
  const red = snap({ verdict: 'NEEDS_WORK', blockers: ['ci_failing'] });
  assert.equal(decide({ snap: red, previous: { watch: seenWatch(red), lastPassAt: T0 }, now: T0 + 2 * day }).reason, 'silence-guard');
});

// Historical scenario replays: real gate entry, persisted state, controlled clock / GitHub facts.
// No calls to the live PR, scheduler or model are made by these tests.
test('replay: an old task using plain ack must finish its blocker before base churn can stay quiet', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  fx.setSnapshot(s);
  const event = await fx.run(['--json']);
  assert.match(event.json().finish, /--wait.*--resume.*--ack/);
  const before = fs.readFileSync(fx.stateFile(), 'utf8');
  const reads = fx.snapshotRuns();
  const legacy = await fx.run(['--ack']);
  assert.equal(legacy.code, 1);
  assert.match(legacy.stderr, /finish decision required.*--wait/);
  assert.equal(fs.readFileSync(fx.stateFile(), 'utf8'), before, 'do not ack, clear waits or schedule an extra wake');
  assert.equal(fx.snapshotRuns(), reads, 'finish is local; no extra GitHub poll');
  const receipt = await fx.run(['--wait', fx.writeWait(waitPlan(s)), '--json']);
  assert.equal(receipt.code, 0, receipt.stderr);
  assert.equal(receipt.json().reason, 'wait-set');
  assert.equal(fx.readState().pendingWatch, undefined);
  for (let tick = 1; tick <= 72; tick++) {
    fx.advance(5);
    fx.setSnapshot({ ...s, baseCommitOid: `base-${tick}` });
    assert.equal((await fx.run(['--triggered'])).code, 2);
  }
});

test('finish: plain ack cannot guess missing observations or classify blockers as human-only', async (t) => {
  const cases = [
    null,
    snap({ checks: [check('build', 'failed')] }),
    snap({ checks: [check('build', 'pending')] }),
    snap({ reviewThreads: { nodes: [{ id: 'thread', isResolved: false }] } }),
    snap({ blockers: ['approval_required'] }),
    snap({ blockers: ['merge_conflict'] }),
    snap({ checksSummary: { unavailable: true } }),
  ];
  for (const s of cases) {
    const fx = createFixture(t);
    if (s) { fx.setSnapshot(s); await fx.run(); }
    else fx.writeState({ watch: { headSha: 'legacy-head' }, pendingFingerprint: 'legacy' });
    const before = fx.readState();
    const result = await fx.run(['--ack']);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, /finish decision required/);
    assert.deepEqual(fx.readState(), before);
    assert.equal(fx.readState().wait, undefined, 'do not infer an indefinite human wait');
  }
});

test('finish: clean ack needs no extra poll or model wake', async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap());
  await fx.run();
  const reads = fx.snapshotRuns();
  assert.equal((await fx.run(['--ack'])).code, 0);
  assert.equal(fx.snapshotRuns(), reads);
  const idle = await fx.run();
  assert.equal(idle.code, 2);
  assert.doesNotMatch(idle.stdout, /Finish:/);
});

test('finish: ack and defer preserve a recorded wait; resume explicitly clears waits and timers', async (t) => {
  const fx = createFixture(t);
  await startWait(fx, humanBlocked());
  fx.writeState({ nextAllowAt: T0 + 60 * MIN });
  const before = fx.readState();
  for (const args of [
    ['--ack'], ['--defer', '10'], ['--resume'], ['--resume', ' '],
    ['--resume', 'x'.repeat(2001)], ['--resume', 'handled', '--ack'],
    ['--resume', 'handled', '--defer', '10'], ['--resume', 'handled', '--last-result'],
    ['--resume', 'handled', '--suggest'], ['--resume', 'handled', '--wait', 'unused.json'],
  ]) {
    assert.equal((await fx.run(args)).code, 1, args.join(' '));
    assert.deepEqual(fx.readState(), before);
  }
  const resumed = await fx.run(['--resume', 'Fixed the certificate check and pushed.', '--json']);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(resumed.json().reason, 'resumed');
  assert.equal(fx.readState().wait, undefined);
  assert.equal(fx.readState().nextAllowAt, undefined);
});

test('replay: replacing an expired wait acknowledges it without a separate retry round', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  await startWait(fx, s, { kind: 'baseline', afterMinutes: 10 });
  fx.advance(10);
  assert.equal((await fx.run(['--json'])).json().reason, 'wait-expired');
  const before = fx.readState();
  assert.equal((await fx.run(['--ack'])).code, 1);
  assert.deepEqual(fx.readState(), before);
  assert.equal((await fx.run(['--wait', fx.writeWait(waitPlan(s, { kind: 'baseline', afterMinutes: 30 }))])).code, 0);
  fx.advance(5);
  fx.setSnapshot({ ...s, baseCommitOid: 'another-unrelated-commit' });
  assert.equal((await fx.run(['--triggered'])).code, 2);
  fx.advance(25);
  assert.equal((await fx.run(['--json'])).json().reason, 'wait-expired');
});

test('replay: resume confirms the earliest round and preserves a newer failure', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  fx.setSnapshot(s);
  await fx.run();
  fx.advance(5);
  fx.setSnapshot({ ...s, checks: [...s.checks, check('later', 'failed')] });
  await fx.run();
  assert.equal((await fx.run(['--resume', 'Handled the originally reported finding.'])).code, 0);
  const next = await fx.run(['--json']);
  assert.equal(next.code, 0);
  assert.match(next.json().report, /later/);
});

test('replay: human-only CodeQL wait absorbs 72 base updates and host triggers without model wakes', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  await startWait(fx, s);
  let modelWakes = 0;
  for (let tick = 1; tick <= 72; tick += 1) {
    fx.advance(5);
    fx.setSnapshot({ ...s, baseCommitOid: `base-${tick}` });
    fx.setTrigger({ kind: 'watch' });
    const result = await fx.run(['--pacing', '--json']);
    if (result.code === 0) modelWakes += 1;
    assert.equal(result.json().reason, 'waiting');
  }
  assert.equal(modelWakes, 0, 'six hours of unrelated main commits must cost zero model calls');
  assert.ok(fx.readState().wait);
});

test('replay: a failure set aside for a human is rechecked daily and the user is told on entry and every renewal', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  const entered = (await startWait(fx, s)).json();
  assert.equal(entered.notice, 'entered');
  assert.match(entered.detail, /tell the user now who has to act/);
  assert.equal(entered.wait.until, T0 + 24 * 60 * MIN, 'afterMinutes: null is capped at one day');
  const told = [];
  for (let day = 1; day <= 7; day += 1) {
    fx.advance(24 * 60 - 5);
    assert.equal((await fx.run(['--json'])).json().reason, 'waiting');
    fx.advance(5);
    const due = (await fx.run(['--json'])).json();
    assert.equal(due.reason, 'wait-expired');
    assert.match(due.detail, /set aside for a human .* ago: recheck that it still holds/);
    const renewed = (await fx.run(['--wait', fx.writeWait(waitPlan(s)), '--json'])).json();
    assert.equal(renewed.wait.since, T0, 'the same head keeps one waiting period');
    if (renewed.notice) {
      told.push(day);
      assert.equal(renewed.notice, 'reminder');
      assert.match(renewed.detail, /ask for that specific decision again with a recommendation/);
    }
  }
  assert.deepEqual(told, [1, 2, 3, 4, 5, 6, 7], 'each actual renewal reminds the user');
});

test('replay: same-day human wait renewals remind each round without waking idle polls', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  await startWait(fx, s, { afterMinutes: 5 });
  for (let round = 1; round <= 2; round += 1) {
    fx.advance(5);
    assert.equal((await fx.run(['--json'])).json().reason, 'wait-expired');
    const renewed = (await fx.run(['--wait', fx.writeWait(waitPlan(s, { afterMinutes: 5 })), '--json'])).json();
    assert.equal(renewed.notice, 'reminder');
    assert.equal(renewed.wait.since, T0);
    assert.match(renewed.detail, /ask for that specific decision again/);
    assert.equal((await fx.run(['--json'])).json().reason, 'waiting');
  }
});

test('replay: an events-only wait recorded before the daily review is rechecked and reported once', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  await startWait(fx, s);
  const { since, told, toldAt, ...legacy } = fx.readState().wait;
  fx.writeState({ wait: { ...legacy, until: null } });
  fx.advance(24 * 60 - 5);
  assert.equal((await fx.run(['--json'])).json().reason, 'waiting');
  fx.advance(5);
  assert.equal((await fx.run(['--pacing', '--json'])).json().reason, 'wait-expired');
  const renewed = (await fx.run(['--wait', fx.writeWait(waitPlan(s)), '--json'])).json();
  assert.equal(renewed.notice, 'entered', 'the user was never told about the old wait');
  assert.equal(renewed.wait.since, T0);
});

test('replay: a plain approval wait stays events-only and silent; a shorter review time is kept', async (t) => {
  const fx = createFixture(t);
  const approval = snap({ verdict: 'BLOCKED_HUMAN', blockers: ['approval_required'], reviewDecision: 'REVIEW_REQUIRED' });
  const plain = (await startWait(fx, approval, { reason: 'await approval', checks: [], threads: [] })).json();
  assert.equal(plain.wait.until, null);
  assert.equal(plain.notice, undefined);
  fx.advance(7 * 24 * 60);
  assert.equal((await fx.run(['--json'])).json().reason, 'waiting');

  const fx2 = createFixture(t);
  const timed = (await startWait(fx2, humanBlocked(), { afterMinutes: 60 })).json();
  assert.equal(timed.wait.until, T0 + 60 * MIN);
  assert.equal(timed.notice, 'entered');
});

test('replay: baseline CI failure batches main updates until the paced time, then runs once', async (t) => {
  const fx = createFixture(t);
  const s = snap({ checks: [check('build', 'failed')], baseCommitOid: 'base-0', verdict: 'NEEDS_WORK', blockers: ['ci_failing'] });
  const set = (await startWait(fx, s, { kind: 'baseline', afterMinutes: 30, checks: [{ name: 'build' }], threads: [], reason: 'The same test fails on main; recheck whether its fix has landed.' })).json();
  assert.equal(set.wait.until, T0 + 15 * MIN, 'the first wait on a blocker looks again after 15 minutes, not later');
  for (let tick = 1; tick <= 2; tick += 1) {
    fx.advance(5);
    fx.setSnapshot({ ...s, baseCommitOid: `base-${tick}` });
    assert.equal((await fx.run(['--json', '--triggered'])).code, 2);
  }
  fx.advance(5);
  fx.setSnapshot({ ...s, baseCommitOid: 'base-fixed' });
  const due = await fx.run(['--json']);
  assert.equal(due.code, 0);
  assert.equal(due.json().reason, 'wait-expired');
  assert.equal((await fx.run(['--resume', 'Merged the baseline fix and pushed.'])).code, 0);
  assert.equal(fx.readState().wait, undefined);
  // Model merges fixed main and pushes; the old wait must not delay new CI or replay the old failure.
  fx.setSnapshot(snap({ latestCommitOid: 'new-head', baseCommitOid: 'base-fixed', checks: [check('build', 'pending')] }));
  assert.equal((await fx.run(['--json'])).code, 2);
  fx.advance(5);
  fx.setSnapshot(snap({ latestCommitOid: 'new-head', baseCommitOid: 'base-fixed' }));
  assert.equal((await fx.run(['--json'])).code, 0);
  assert.equal((await fx.run(['--ack'])).code, 0);
  assert.equal((await fx.run(['--json'])).code, 2, 'CI result handled exactly once');
});

const baselineBlocked = (extra = {}) => snap({
  checks: [check('build', 'failed'), check('lint', 'passed')], baseCommitOid: 'base-0',
  verdict: 'NEEDS_WORK', blockers: ['ci_failing'], ...extra,
});
const baselinePlan = (s, extra = {}) => waitPlan(s, {
  kind: 'baseline', afterMinutes: null, checks: [{ name: 'build' }], threads: [],
  reason: 'The dependency install fails on shared CI tooling; wait for the fix on main.', ...extra,
});

test('replay: renewing the same baseline blocker backs off from 15 minutes to 12 hours', async (t) => {
  const fx = createFixture(t);
  const s = baselineBlocked();
  fx.setSnapshot(s);
  await fx.run(['--json']);
  const paced = [];
  for (let round = 0; round < 9; round += 1) {
    const set = (await fx.run(['--wait', fx.writeWait(baselinePlan(s)), '--json'])).json();
    assert.equal(set.reason, 'wait-set');
    assert.match(set.detail, /backoff step \d\/7/);
    const minutes = (set.wait.until - fx.now()) / MIN;
    paced.push(minutes);
    fx.advance(minutes - 5);
    assert.equal((await fx.run(['--json'])).json().reason, 'waiting');
    fx.advance(5);
    assert.equal((await fx.run(['--json'])).json().reason, 'wait-expired');
  }
  assert.deepEqual(paced, [15, 30, 60, 120, 240, 480, 720, 720, 720]);
});

test('replay: baseline backoff clamps a longer request, keeps a shorter one and restarts on new blockers', async (t) => {
  const fx = createFixture(t);
  const s = baselineBlocked();
  fx.setSnapshot(s);
  await fx.run(['--json']);
  const wait = async (plan) => {
    const set = (await fx.run(['--wait', fx.writeWait(plan), '--json'])).json();
    assert.equal(set.reason, 'wait-set', set.detail);
    return [set.wait.step, (set.wait.until - fx.now()) / MIN];
  };
  assert.deepEqual(await wait(baselinePlan(s, { afterMinutes: 600 })), [0, 15], 'a longer request is clamped');
  assert.deepEqual(await wait(baselinePlan(s, { afterMinutes: 10 })), [1, 10], 'a shorter request is kept');
  assert.deepEqual(await wait(baselinePlan(s, { kind: 'retry' })), [2, 60], 'retry and baseline share the streak');
  // Another failing check is a different blocker: start frequent again.
  const wider = baselineBlocked({ checks: [check('build', 'failed'), check('lint', 'failed')] });
  fx.setSnapshot(wider);
  await fx.run(['--json']);
  assert.deepEqual(await wait(baselinePlan(wider, { checks: [{ name: 'build' }, { name: 'lint' }] })), [0, 15]);
  assert.deepEqual(await wait(baselinePlan(wider, { checks: [{ name: 'build' }, { name: 'lint' }] })), [1, 30]);
  // A new head (after merging main and pushing) restarts the pace too.
  assert.equal((await fx.run(['--resume', 'Merged main and pushed.'])).code, 0);
  const pushed = baselineBlocked({ latestCommitOid: 'new-head' });
  fx.setSnapshot(pushed);
  await fx.run(['--json']);
  assert.deepEqual(await wait(baselinePlan(pushed)), [0, 15]);
});

test('replay: a base commit brings a long baseline wait forward to within the hour and batches the rest', async (t) => {
  const fx = createFixture(t);
  const s = baselineBlocked();
  fx.setSnapshot(s);
  await fx.run(['--json']);
  // Walk the backoff up to the 12-hour step.
  for (let round = 0; round < 6; round += 1) {
    const set = (await fx.run(['--wait', fx.writeWait(baselinePlan(s)), '--json'])).json();
    fx.advance((set.wait.until - fx.now()) / MIN);
    assert.equal((await fx.run(['--json'])).json().reason, 'wait-expired');
  }
  const long = (await fx.run(['--wait', fx.writeWait(baselinePlan(s)), '--json'])).json();
  assert.equal(long.wait.until - fx.now(), 720 * MIN);
  const setAt = fx.now();
  fx.advance(30);
  fx.setSnapshot({ ...s, baseCommitOid: 'base-fix' });
  const absorbed = (await fx.run(['--triggered', '--json'])).json();
  assert.equal(absorbed.reason, 'waiting', 'a base commit alone does not wake the model at once');
  assert.equal(fx.readState().wait.until, setAt + 90 * MIN);
  // Later base commits do not push the review further out.
  for (let tick = 1; tick <= 6; tick += 1) {
    fx.advance(5);
    fx.setSnapshot({ ...s, baseCommitOid: `base-later-${tick}` });
    assert.equal((await fx.run(['--json'])).json().reason, 'waiting');
  }
  assert.equal(fx.readState().wait.until, setAt + 90 * MIN);
  fx.advance(30);
  const due = (await fx.run(['--json'])).json();
  assert.equal(due.reason, 'wait-expired');
  assert.match(due.detail, /the base moved .* ago: look for the fix there first/);
  // Renewing (no fix found) keeps the slow step and drops the base marker.
  const renewed = (await fx.run(['--wait', fx.writeWait(baselinePlan(s)), '--json'])).json();
  assert.equal(renewed.wait.until - fx.now(), 720 * MIN);
  assert.equal(renewed.wait.baseMovedAt, undefined);
});

test('replay: important new events pierce a human wait immediately, even through a host trigger', async (t) => {
  const cases = [
    ['new failing check', (s) => ({ ...s, checks: [...s.checks, check('new-test', 'failed')] }), /Checks failed/],
    ['new human feedback', (s) => ({ ...s, comments: [comment('new', 'reviewer', iso(T0 + MIN), 'Please fix a regression.')] }), /regression/],
    ['new bot feedback', (s) => ({ ...s, comments: [comment('new', 'review-bot', iso(T0 + MIN), 'P1: regression', { authorIsBot: true })] }), /regression/],
    ['conflict', (s) => ({ ...s, mergeable: false, mergeStateStatus: 'DIRTY' }), /conflict/i],
    ['merge queue eviction', (s) => ({ ...s, mergeQueue: { blockers: ['merge_queue_removed'] } }), /queue/i],
    ['approval', (s) => ({ ...s, reviewDecision: 'APPROVED' }), /review decision/],
    ['thread resolved', (s) => ({ ...s, reviewThreads: { nodes: [{ id: 'security-thread', isResolved: true }] } }), /thread security-thread/],
    ['optional CodeQL passed', (s) => ({ ...s, checks: s.checks.map((c) => c.name === 'CodeQL' ? { ...c, outcome: 'passed' } : c) }), /check CodeQL/],
    ['rerun failed with same name', (s) => ({ ...s, checks: s.checks.map((c) => c.name === 'CodeQL' ? { ...c, startedAt: iso(T0 + MIN) } : c) }), /check CodeQL/],
    ['base required by protection', (s) => ({ ...s, blockers: [...s.blockers, 'branch_behind_base'] }), /updated base/],
    ['draft conversion', (s) => ({ ...s, isDraft: true }), /draft/i],
    ['merged', (s) => ({ ...s, merged: true }), /merged/],
    ['closed', (s) => ({ ...s, closed: true }), /closed/],
  ];
  for (const [name, mutate, report] of cases) await t.test(name, async (t) => {
    const fx = createFixture(t);
    const s = humanBlocked();
    await startWait(fx, s);
    fx.advance(1);
    fx.setTrigger({ kind: 'watch' });
    fx.setSnapshot(mutate(s));
    const result = await fx.run(['--pacing', '--json']);
    assert.equal(result.code, 0, result.stdout);
    assert.match(`${result.json().report ?? ''} ${result.json().detail}`, report);
    const before = fx.readState();
    assert.equal((await fx.run(['--ack'])).code, 1, 'an empty ack cannot discard the wait');
    assert.deepEqual(fx.readState(), before, 'reassess and finish explicitly in this round');
  });
});

test('replay: a resolved thread reopened later wakes a human wait', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked({
    reviewThreads: { nodes: [
      { id: 'security-thread', isResolved: false, comments: [] },
      { id: 'old-thread', isResolved: true, comments: [] },
    ] },
  });
  await startWait(fx, s);
  fx.advance(1);
  fx.setTrigger({ kind: 'watch' });
  fx.setSnapshot({ ...s, reviewThreads: { nodes: [
    { id: 'security-thread', isResolved: false, comments: [] },
    { id: 'old-thread', isResolved: false, comments: [] },
  ] } });
  const result = await fx.run(['--pacing', '--json']);
  assert.equal(result.code, 0, result.stdout);
  assert.match(`${result.json().report ?? ''} ${result.json().detail}`, /thread old-thread/);
});

test('replay: a second reopened thread breaks the backoff of an unacknowledged first one', async (t) => {
  const fx = createFixture(t);
  const node = (id, isResolved) => ({ id, isResolved, comments: [] });
  const s = humanBlocked({ reviewThreads: { nodes: [node('security-thread', false), node('old-a', true), node('old-b', true)] } });
  await startWait(fx, s);
  const reopen = (...ids) => fx.setSnapshot({ ...s, reviewThreads: { nodes: [
    node('security-thread', false), node('old-a', !ids.includes('old-a')), node('old-b', !ids.includes('old-b'))] } });
  reopen('old-a');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    fx.advance(5);
    assert.equal((await fx.run(['--json'])).code, 0);
  }
  fx.advance(5);
  assert.equal((await fx.run(['--json'])).json().reason, 'retry-backoff');
  reopen('old-a', 'old-b');
  const second = await fx.run(['--json']);
  assert.equal(second.code, 0, 'a different reopened thread is not the old event');
  assert.match(second.json().report ?? '', /thread old-b/);
});

test('replay: wait is bound to the released head; own push clears it and keeps the bot settle window', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked({ reviews: [{ author: 'review-bot', authorIsBot: true, commitOid: 'aaa1111', submittedAt: iso(T0 - MIN), state: 'COMMENTED' }] });
  await startWait(fx, s);
  fx.advance(5);
  fx.setSnapshot({ ...s, latestCommitOid: 'new-head', checks: [check('build', 'pending')], reviewThreads: { nodes: [] } });
  assert.equal((await fx.run(['--json'])).code, 2);
  assert.equal(fx.readState().wait, undefined);
  fx.advance(5);
  fx.setSnapshot({ ...s, latestCommitOid: 'new-head', checks: [check('build', 'failed')], reviewThreads: { nodes: [] } });
  assert.equal((await fx.run(['--json'])).json().reason, 'settling');
  fx.advance(15);
  assert.equal((await fx.run(['--json'])).code, 0);
});

test('replay: model-selected deadline survives a crash; base churn cannot defeat retry backoff', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  await startWait(fx, s, { kind: 'baseline', afterMinutes: 10 });
  fx.advance(10);
  assert.equal((await fx.run(['--json'])).json().reason, 'wait-expired');
  for (let attempt = 2; attempt <= 3; attempt += 1) {
    fx.advance(5);
    fx.setSnapshot({ ...s, baseCommitOid: `base-${attempt}` });
    assert.equal((await fx.run(['--json'])).json().reason, 'retry-unacked');
  }
  fx.advance(5);
  assert.equal((await fx.run(['--json'])).json().reason, 'retry-backoff-attempt');
  fx.advance(5);
  fx.setSnapshot({ ...s, baseCommitOid: 'still-more-base' });
  assert.equal((await fx.run(['--json'])).json().reason, 'retry-backoff');
  // A different actual failure must not wait for the crashed deadline's backoff.
  fx.setSnapshot({ ...s, checks: [...s.checks, check('new-test', 'failed')] });
  assert.equal((await fx.run(['--json'])).code, 0);
});

test('replay: slow acknowledgement cannot wait on or acknowledge a newer unseen head', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  fx.setSnapshot(s);
  await fx.run(['--json']);
  fx.advance(5);
  fx.setSnapshot({ ...s, latestCommitOid: 'new-head', comments: [comment('fresh', 'reviewer', iso(T0 + MIN))] });
  await fx.run(['--json']);
  const before = fx.readState();
  assert.equal((await fx.run(['--wait', fx.writeWait(waitPlan({ ...s, latestCommitOid: 'new-head' }))])).code, 1);
  assert.deepEqual(fx.readState(), before, 'rejected plan must not ack anything');
  assert.equal((await fx.run(['--wait', fx.writeWait(waitPlan(s))])).code, 0);
  const next = await fx.run(['--json']);
  assert.equal(next.code, 0, 'new head and its unseen human comment remain actionable');
  assert.match(next.json().report, /fresh|please fix/);
});

test('replay: incomplete data cannot silently extend a human wait', async (t) => {
  for (const patch of [{ gate: { truncated: true } }, { checksSummary: { unavailable: true } }, { reviewThreads: { truncated: true } }]) {
    const fx = createFixture(t);
    const s = humanBlocked();
    await startWait(fx, s);
    fx.setSnapshot({ ...s, ...patch });
    const result = await fx.run(['--json']);
    assert.equal(result.code, 0);
    assert.match(result.json().reason, /truncated|wait-unavailable/);
  }
});

test('wait validation: reject unknown scope, unhandled work, stale head and unsafe durations without ack', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  fx.setSnapshot(s);
  await fx.run(['--json']);
  const before = fx.readState();
  for (const extra of [
    { headSha: 'wrong-head' }, { afterMinutes: 0 }, { afterMinutes: 1441 }, { afterMinutes: '30' },
    { kind: 'checks', afterMinutes: null }, { reason: '' }, { arbitraryField: true },
    { checks: [] }, { threads: [] }, { checks: [{ name: 'unknown' }] }, { threads: ['unknown'] },
  ]) {
    const result = await fx.run(['--wait', fx.writeWait(waitPlan(s, extra))]);
    assert.equal(result.code, 1, JSON.stringify(extra));
    assert.deepEqual(fx.readState(), before);
  }
  for (const arg of ['--defer', '--last-result', '--suggest']) {
    const result = await fx.run(['--wait', fx.writeWait(waitPlan(s)), arg, ...(arg === '--defer' ? ['10'] : [])]);
    assert.equal(result.code, 1);
  }
  const readback = (await fx.run(['--last-result', '--json'])).json();
  assert.equal(readback.waitContext.headSha, s.latestCommitOid);
  assert.equal(readback.wait, null);
});

test('replay: cheap polling continues during a wait; a deadline is not hidden by an unchanged probe', async (t) => {
  const fx = createFixture(t);
  const s = snap();
  fx.setProbe({ status: 'same', remarks: 'same', base: 'base-0' });
  await startWait(fx, s, { kind: 'retry', afterMinutes: 10, checks: [], threads: [], reason: 'Recheck an external service.' });
  const calls = fx.snapshotRuns();
  fx.advance(5);
  assert.equal((await fx.run(['--pacing', '--json'])).json().reason, 'unchanged');
  assert.equal(fx.snapshotRuns(), calls, 'one small probe, no full snapshot or model');
  fx.advance(5);
  assert.equal((await fx.run(['--pacing', '--json'])).json().reason, 'wait-expired');
  assert.equal(fx.snapshotRuns(), calls + 1);
});

test('real CLI: --wait reads a file, persists it, and suppresses irrelevant base changes', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  fx.setSnapshot(s);
  assert.equal((await fx.runVia(gatePath, ['--json'])).code, 0);
  const before = fs.readFileSync(fx.stateFile(), 'utf8');
  const empty = await fx.runVia(gatePath, ['--ack']);
  assert.equal(empty.code, 1);
  assert.match(empty.stderr, /finish decision required.*--wait/);
  assert.equal(fs.readFileSync(fx.stateFile(), 'utf8'), before);
  const result = await fx.runVia(gatePath, ['--wait', fx.writeWait(waitPlan(s)), '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).wait.until - JSON.parse(result.stdout).wait.createdAt, 24 * 60 * MIN);
  fx.setSnapshot({ ...s, baseCommitOid: 'base-new' });
  assert.equal((await fx.runVia(gatePath, ['--triggered', '--json'])).code, 2);
  const resumed = await fx.runVia(gatePath, ['--resume', 'Handled the finding and pushed.', '--json']);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).reason, 'resumed');
  assert.equal(fx.readState().wait, undefined);
});

test('replay: same-count check reruns and inline resolutions are discovered on the next five-minute poll', async (t) => {
  for (const mutate of [
    (s) => ({ ...s, checks: s.checks.map((c) => c.name === 'CodeQL' ? { ...c, startedAt: iso(T0 + MIN) } : c) }),
    (s) => ({ ...s, reviewThreads: { nodes: [{ id: 'security-thread', isResolved: true }] } }),
  ]) {
    const fx = createFixture(t);
    const s = humanBlocked();
    fx.setProbe({ status: 'same', remarks: 'same', base: 'base-0' });
    await startWait(fx, s);
    fx.setSnapshot(mutate(s));
    fx.advance(5);
    assert.equal((await fx.run(['--pacing', '--json'])).code, 0, 'must not wait for the old 30-minute full-read fallback');
  }
});

test('replay: workflow names scope waits; a known but unlisted failure still watches the base', async (t) => {
  const fx = createFixture(t);
  const s = snap({ baseCommitOid: 'base-0', checks: [
    check('test', 'failed', { workflowName: 'Linux' }), check('test', 'failed', { workflowName: 'Windows' }),
  ] });
  fx.setSnapshot(s);
  await fx.run(['--json']);
  const plan = waitPlan(s, { kind: 'baseline', afterMinutes: 30, checks: [{ name: 'test' }], threads: [] });
  const rejected = await fx.run(['--wait', fx.writeWait(plan)]);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /ambiguous/);
  plan.checks[0].workflowName = 'Linux';
  assert.equal((await fx.run(['--wait', fx.writeWait(plan)])).code, 0);
  fx.setSnapshot({ ...s, baseCommitOid: 'base-1' });
  const next = await fx.run(['--json']);
  assert.equal(next.code, 0, 'Windows failure is outside this wait');
  assert.match(next.json().report, /base-1/);
});

test('replay: starting a rerun does not wake a human wait; its completed result does', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  await startWait(fx, s);
  fx.setSnapshot({ ...s, checks: s.checks.map((c) => c.name === 'CodeQL' ? { ...c, outcome: 'pending', startedAt: iso(T0 + MIN) } : c) });
  assert.equal((await fx.run(['--json'])).code, 2);
  fx.setSnapshot({ ...s, checks: s.checks.map((c) => c.name === 'CodeQL' ? { ...c, outcome: 'passed', startedAt: iso(T0 + MIN) } : c) });
  assert.equal((await fx.run(['--json'])).code, 0);
});

test('replay: explicit wait does not mistake bot status edits or own replies for new work', async (t) => {
  const fx = createFixture(t);
  const old = comment('deploy', 'deploy-bot', iso(T0 - MIN), 'Deploying', { authorIsBot: true });
  const s = humanBlocked({ comments: [old] });
  await startWait(fx, s);
  fx.advance(5);
  fx.setSnapshot({ ...s, comments: [{ ...old, body: 'Deployed', updatedAt: iso(fx.now()) }, comment('own', 'me', iso(fx.now()), 'Handled.')] });
  assert.equal((await fx.run(['--json'])).code, 2);
});

test('replay: timed CI wait wakes on completion and never grants an indefinite wait to running CI', async (t) => {
  const fx = createFixture(t);
  const s = snap({ checks: [check('build', 'pending', { required: true })] });
  fx.setSnapshot(s);
  await fx.run(['--json']);
  const plan = waitPlan(s, { checks: [{ name: 'build' }], threads: [] });
  assert.equal((await fx.run(['--wait', fx.writeWait(plan)])).code, 1);
  assert.equal((await fx.run(['--wait', fx.writeWait({ ...plan, kind: 'checks', afterMinutes: 20 })])).code, 0);
  fx.advance(5);
  fx.setSnapshot(snap());
  assert.equal((await fx.run(['--json'])).code, 0);
});

test('replay: a new result of the awaited check breaks an older unacknowledged result backoff', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  await startWait(fx, s);
  const rerun = { ...s, checks: s.checks.map((c) => c.name === 'CodeQL' ? { ...c, startedAt: iso(T0 + MIN) } : c) };
  fx.setSnapshot(rerun);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    fx.advance(5);
    assert.equal((await fx.run(['--json'])).code, 0);
  }
  fx.advance(5);
  assert.equal((await fx.run(['--json'])).json().reason, 'retry-backoff');
  fx.setSnapshot({ ...rerun, checks: rerun.checks.map((c) => c.name === 'CodeQL' ? { ...c, outcome: 'passed' } : c) });
  assert.equal((await fx.run(['--json'])).code, 0, 'new success is not the old failed attempt');
});

test('replay: slow wait acknowledgement preserves a new failure arriving on the same head', async (t) => {
  const fx = createFixture(t);
  const s = humanBlocked();
  fx.setSnapshot(s);
  await fx.run(['--json']);
  fx.setSnapshot({ ...s, checks: [...s.checks, check('new-test', 'failed')] });
  await fx.run(['--json']);
  // Plan acknowledges only the first released observation, where new-test did not exist.
  assert.equal((await fx.run(['--wait', fx.writeWait(waitPlan(s))])).code, 0);
  const next = await fx.run(['--json']);
  assert.equal(next.code, 0);
  assert.match(next.json().report, /new-test/);
});

test('replay: twenty CI successes batch into one wake, including required checks and host triggers', async (t) => {
  const fx = createFixture(t);
  const s = snap({ checks: Array.from({ length: 20 }, (_, i) => check(`test-${i}`, 'pending', { required: i === 0 })), verdict: 'WAITING_CI' });
  await startWait(fx, s, { kind: 'checks', afterMinutes: 30, checks: s.checks.map(({ name }) => ({ name })), threads: [] });
  const until = fx.readState().wait.until;
  for (let i = 0; i < 20; i++) {
    fx.advance(1);
    s.checks[i] = { ...s.checks[i], outcome: 'passed' };
    fx.setSnapshot(s);
    const r = await fx.run(['--json', '--triggered']);
    assert.equal(r.code, i === 19 ? 0 : 2, `success ${i + 1}: ${r.stdout}`);
    assert.equal(fx.readState().wait.until, until, 'progress never extends the original deadline');
  }
  assert.equal((await fx.run(['--resume', 'All CI results inspected.'])).code, 0);
  assert.equal((await fx.run(['--triggered'])).code, 2, 'completion is not reported twice');
});

test('replay: batching CI successes preserves failures, feedback, reopened threads, deadlines and terminal events', async (t) => {
  const cases = [
    ['failure', s => { s.checks[1].outcome = 'failed'; }],
    ['feedback', s => { s.comments = [comment('new', 'reviewer', iso(T0 + MIN))]; }],
    ['bot feedback', s => { s.comments = [comment('new', 'review-bot', iso(T0 + MIN), 'Fix this race', { authorIsBot: true })]; }],
    ['thread reopened', s => { s.reviewThreads.nodes[0].isResolved = false; }],
    ['conflict', s => { s.mergeable = false; s.mergeStateStatus = 'DIRTY'; }],
    ['missing check', s => { s.checks.pop(); }],
    ['incomplete', s => { s.checksSummary.unavailable = true; }],
    ['merged', s => { s.merged = true; }],
    ['closed', s => { s.closed = true; }],
    ['deadline', () => {}],
  ];
  for (const [label, mutate] of cases) {
    const fx = createFixture(t);
    const s = snap({ checks: [check('first', 'pending', { required: true }), check('second', 'pending')], reviewThreads: { nodes: [{ id: 'old', isResolved: true }] } });
    await startWait(fx, s, { kind: 'checks', afterMinutes: 10, checks: s.checks.map(({ name }) => ({ name })), threads: [] });
    fx.advance(1);
    s.checks[0].outcome = 'passed';
    fx.setSnapshot(s);
    assert.equal((await fx.run(['--triggered'])).code, 2, label);
    fx.advance(label === 'deadline' ? 9 : 1);
    mutate(s);
    fx.setSnapshot(s);
    const r = await fx.run(['--json', '--triggered']);
    assert.equal(r.code, 0, `${label}: ${r.stdout}`);
  }
});

test('settle: an approval without a comment joins the bot batch; a human comment still wakes at once', async (t) => {
  const fx = createFixture(t);
  const first = snap({ reviews: [botReview('R1', 'chatgpt-codex-connector', 'aaa1111', iso(T0 - 5 * MIN))] });
  fx.setSnapshot(first);
  await fx.run();
  assert.equal((await fx.run(['--ack'])).code, 0);
  fx.advance(2);
  const pushed = { latestCommitOid: 'bbb2222', checks: [check('build', 'failed', { required: true })], verdict: 'NEEDS_WORK' };
  const approval = { id: 'A1', author: 'alice', authorIsBot: false, state: 'APPROVED', body: '', submittedAt: iso(fx.now()), url: 'https://gh/A1', commitOid: 'bbb2222' };
  fx.setSnapshot(snap({ ...first, ...pushed, reviews: [...first.reviews, approval] }));
  assert.equal((await fx.run(['--json'])).json().reason, 'settling', 'nothing to do until the bots answer');
  fx.advance(2);
  const answered = botReview('R2', 'chatgpt-codex-connector', 'bbb2222', iso(fx.now()));
  fx.setSnapshot(snap({ ...first, ...pushed, reviews: [...first.reviews, approval, answered] }));
  const batch = await fx.run(['--json']);
  assert.equal(batch.code, 0);
  assert.match(batch.json().report, /alice: approved/);
  assert.match(batch.json().report, /tighten this/);

  const fx2 = createFixture(t);
  fx2.setSnapshot(first);
  await fx2.run();
  assert.equal((await fx2.run(['--ack'])).code, 0);
  fx2.advance(2);
  const withNote = { ...approval, body: 'Approved, but please rename the flag.', submittedAt: iso(fx2.now()) };
  fx2.setSnapshot(snap({ ...first, ...pushed, reviews: [...first.reviews, withNote] }));
  assert.equal((await fx2.run(['--json'])).code, 0, 'an approval that asks for something is feedback');
});

test('settle: following a PR opened minutes ago waits for the repository bots; an older PR is read at once', async (t) => {
  const fx = createFixture(t);
  fx.writeRepoState({ reviewerBots: { 'chatgpt-codex-connector': T0 - 60 * MIN } });
  const approval = { id: 'A1', author: 'alice', authorIsBot: false, state: 'APPROVED', body: '', submittedAt: iso(T0 - MIN), url: 'https://gh/A1', commitOid: 'aaa1111' };
  const opened = snap({ createdAt: iso(T0 - 3 * MIN), reviews: [approval], checks: [check('build', 'pending', { required: true })], verdict: 'WAITING_CI' });
  fx.setSnapshot(opened);
  assert.equal((await fx.run(['--json'])).json().reason, 'settling', 'no first round with nothing to do');
  fx.advance(4);
  fx.setSnapshot({ ...opened, reviews: [approval, botReview('R1', 'chatgpt-codex-connector', 'aaa1111', iso(fx.now()))] });
  const batch = await fx.run(['--json']);
  assert.equal(batch.code, 0);
  assert.match(batch.json().report, /tighten this/);

  const late = createFixture(t);
  late.writeRepoState({ reviewerBots: { 'chatgpt-codex-connector': T0 - 60 * MIN } });
  late.setSnapshot({ ...opened, createdAt: iso(T0 - 17 * MIN) });
  assert.equal((await late.run(['--json'])).json().reason, 'settling');
  late.advance(4);
  assert.equal((await late.run(['--json'])).code, 0, 'the window ends 20 minutes after the PR was opened');

  const old = createFixture(t);
  old.writeRepoState({ reviewerBots: { 'chatgpt-codex-connector': T0 - 60 * MIN } });
  old.setSnapshot({ ...opened, createdAt: iso(T0 - 3 * 60 * MIN) });
  assert.equal((await old.run(['--json'])).code, 0, 'taking over an existing PR does not wait');
});

test('replay: reruns of failures a wait already accounts for wake once, when the whole batch has finished', async (t) => {
  const fx = createFixture(t);
  const failed = (name, n = 0) => check(name, 'failed', { startedAt: iso(T0 + n * MIN), detailsUrl: `https://ci/${name}/${n}` });
  const s = snap({
    verdict: 'NEEDS_WORK', blockers: ['ci_failing'], baseCommitOid: 'base-0',
    checks: [check('build', 'passed', { required: true }), failed('bundle'), failed('aggregate'), failed('windows')],
  });
  const named = { checks: [{ name: 'bundle' }, { name: 'aggregate' }, { name: 'windows' }], threads: [] };
  await startWait(fx, s, { kind: 'baseline', afterMinutes: 60, reason: 'bundle and aggregate fail on main too; windows was rerun once.', ...named });
  const withChecks = (...checks) => ({ ...s, checks: [s.checks[0], ...checks] });
  const wakes = [];
  const tick = async (label, next) => {
    fx.advance(1);
    fx.setSnapshot(next);
    const result = await fx.run(['--json']);
    if (result.code === 0) wakes.push(label);
    return result.json();
  };
  const running = (name) => check(name, 'pending');
  await tick('rerun started', withChecks(running('bundle'), running('aggregate'), running('windows')));
  await tick('aggregate passed', withChecks(running('bundle'), check('aggregate', 'passed'), running('windows')));
  await tick('bundle failed again', withChecks(failed('bundle', 3), check('aggregate', 'passed'), running('windows')));
  await tick('aggregate failed again', withChecks(failed('bundle', 3), failed('aggregate', 4), running('windows')));
  assert.deepEqual(wakes, [], 'one job still runs: nothing for the model to decide yet');
  const done = await tick('windows passed', withChecks(failed('bundle', 3), failed('aggregate', 4), check('windows', 'passed')));
  assert.deepEqual(wakes, ['windows passed']);
  assert.match(done.report, /check bundle, check aggregate, check windows/);
  assert.doesNotMatch(done.report, /Checks failed/, 'the handled failures are the wait\'s news, not new failures');

  // A failure the wait does not account for is still reported at once, mid-batch.
  const fx2 = createFixture(t);
  await startWait(fx2, s, { kind: 'baseline', afterMinutes: 60, reason: 'same', ...named });
  fx2.advance(1);
  fx2.setSnapshot({ ...s, checks: [s.checks[0], check('bundle', 'pending'), failed('aggregate'), failed('windows'), failed('lint')] });
  const fresh = await fx2.run(['--json']);
  assert.equal(fresh.code, 0);
  assert.match(fresh.json().report, /Checks failed[^\n]*\n\s+- lint/);
});

test('replay: bot progress and partial inline comments do not end the settle window', async (t) => {
  const fx = createFixture(t);
  const first = snap({ reviews: [botReview('R1', 'chatgpt-codex-connector', 'aaa1111', iso(T0 - MIN))] });
  fx.setSnapshot(first);
  await fx.run();
  await fx.run(['--ack']);
  fx.advance(2);
  const next = snap({ ...first, latestCommitOid: 'bbb2222', checks: [check('build', 'failed')],
    comments: [comment('progress', 'chatgpt-codex-connector', iso(fx.now()), 'Codex Review Summary: Running', { authorIsBot: true })],
    reactions: [{ author: 'chatgpt-codex-connector[bot]', content: 'EYES', at: iso(fx.now()) }],
    reviewThreads: { nodes: [{ id: 'partial', isResolved: false, comments: [comment('partial', 'chatgpt-codex-connector', iso(fx.now()), 'One finding', { authorIsBot: true })] }] },
  });
  fx.setSnapshot(next);
  assert.equal((await fx.run(['--json'])).json().reason, 'settling');
  fx.advance(3);
  next.reviews.push(botReview('R2', 'chatgpt-codex-connector', 'bbb2222', iso(fx.now())));
  fx.setSnapshot(next);
  const done = await fx.run(['--json']);
  assert.equal(done.code, 0);
  assert.match(done.json().report, /build/);
  assert.match(done.json().report, /One finding/);
});

test('CLI: persisted CI wait batches successes and keeps feedback arriving during an unfinished round', async (t) => {
  const fx = createFixture(t);
  const s = snap({ checks: [check('one', 'pending', { required: true }), check('two', 'pending')] });
  fx.setSnapshot(s);
  assert.equal((await fx.runVia(gatePath, ['--json'])).code, 2);
  const plan = waitPlan(s, { kind: 'checks', afterMinutes: 15, checks: s.checks.map(({ name }) => ({ name })), threads: [] });
  assert.equal((await fx.runVia(gatePath, ['--wait', fx.writeWait(plan)])).code, 0);
  s.checks[0].outcome = 'passed';
  fx.setSnapshot(s);
  assert.equal((await fx.runVia(gatePath, ['--triggered'])).code, 2);
  s.checks[1].outcome = 'passed';
  fx.setSnapshot(s);
  assert.equal((await fx.runVia(gatePath, ['--triggered'])).code, 0);
  const pending = fx.readState().pendingWatch;
  s.comments = [comment('late', 'reviewer', new Date(Date.now() + 1000).toISOString(), 'Late feedback must survive')];
  fx.setSnapshot(s);
  assert.equal((await fx.runVia(gatePath, ['--triggered'])).code, 0);
  assert.deepEqual(fx.readState().pendingWatch, pending, 'slow turn only owns the earliest observation');
  assert.equal((await fx.runVia(gatePath, ['--resume', 'Inspected completed checks.'])).code, 0);
  const late = await fx.runVia(gatePath, ['--json', '--triggered']);
  assert.equal(late.code, 0);
  assert.match(JSON.parse(late.stdout).report, /Late feedback must survive/);
});

 test('missing required check keeps the existing fifteen-minute registration watchdog', () => {
  const s = snap({ checks:[check('fast','passed',{required:true}),check('late','pending',{required:true,expected:true})] });
  let result = evaluateWatch(freshWatch(s,T0),s,T0);
  assert.equal(result.events.some(e=>e.kind==='checks-passed'),false);
  result = evaluateWatch(result.next,s,T0+15*MIN);
  assert.equal(result.events.some(e=>e.kind==='no-checks'),true);
  const again = evaluateWatch(result.next,s,T0+20*MIN);
  assert.equal(again.events.some(e=>e.kind==='no-checks'),false);
});

test('replay: late aggregate registration preserves the CI batch deadline', async t => {
  const fx=createFixture(t);
  const waiting=snap({verdict:'WAITING_CI',blockers:['pending_checks'],comments:[comment('start','human',iso(T0))],checks:[
    check('shard','pending',{workflowName:'ci'}),check('aggregate','pending',{expected:true,workflowName:'required-app:42',required:true})]});
  fx.setSnapshot(waiting);assert.equal((await fx.run()).code,0);
  const plan=fx.writeWait({kind:'checks',headSha:waiting.latestCommitOid,reason:'CI batch',afterMinutes:30,checks:[{name:'shard',workflowName:'ci'},{name:'aggregate',workflowName:'required-app:42'}],threads:[]});
  assert.equal((await fx.run(['--wait',plan])).code,0);
  const until=fx.readState().wait.until;
  for(let n=0;n<4;n++){fx.advance(5);assert.equal((await fx.run()).code,2);}
  fx.setSnapshot({...waiting,checks:[check('shard','pending',{workflowName:'ci'}),check('aggregate','passed',{workflowName:'ci',required:true})]});
  fx.advance(5);assert.equal((await fx.run()).code,2);assert.equal(fx.readState().wait.until,until);
  fx.advance(5);assert.equal((await fx.run()).code,0,'original deadline still applies');
});

test('inventory failure survives resume; new CI failures still wake', async t => {
  const fx=createFixture(t);
  const s=snap({verdict:'NEEDS_WORK',blockers:['required_checks_unavailable'],gate:{requiredChecksUnavailable:true}});
  fx.setSnapshot(s);assert.equal((await fx.run()).code,0);
  assert.equal((await fx.run(['--resume','observed API failure'])).code,0);
  fx.advance(5); assert.equal((await fx.run()).code,0,'second failure gets one notice');
  await fx.run(['--resume','noted persistent rules failure']);
  for(let n=0;n<12;n++){fx.advance(5);assert.equal((await fx.run()).code,2);}
  fx.setSnapshot({...s,checks:[check('new-failure','failed')]});fx.advance(5);
  assert.equal((await fx.run()).code,0);
});

test('new follower gets the persistent inventory failure without inheriting the old notice window', async t => {
  const fx = createFixture(t);
  fx.setSnapshot(snap({ verdict: 'NEEDS_WORK', blockers: ['required_checks_unavailable'],
    gate: { requiredChecksUnavailable: true }, checks: [] }));
  await fx.run();
  await fx.run(['--resume', 'observed']);
  fx.advance(5);
  assert.match((await fx.run()).stdout, /required-checks-unavailable/);
  await fx.run(['--resume', 'noted persistent outage']);
  fx.advance(5);
  assert.equal((await fx.run()).code, 2);
  fx.setTrigger({ firstScheduleId: 'new-follower' });
  fx.advance(5);
  assert.match((await fx.run()).stdout, /required-checks-unavailable/);
  await fx.run(['--resume', 'new owner informed']);
  fx.advance(5);
  assert.equal((await fx.run()).code, 2);
});

test('trace records continuous decisions and receipts without comment or resume text', async t => {
  const fx=createFixture(t);
  fx.setSnapshot(snap({comments:[comment('private','human',iso(T0),'private comment should never be recorded')]}));
  await fx.run();await fx.run(['--resume','private model explanation']);fx.advance(5);await fx.run();
  const file=fx.stateFile()+'.trace.jsonl';const text=fs.readFileSync(file,'utf8');
  assert.ok(!text.includes('private comment should never'));assert.ok(!text.includes('private model explanation'));
  const rows=text.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,3);assert.equal(rows[1].decision,'resume');assert.ok(rows[2].before.watch);
  const script=path.join(path.dirname(gatePath),'pr-follow-replay.mjs');
  const run=await new Promise(resolve=>execFile(process.execPath,[script,file],{encoding:'utf8'},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
  assert.equal(run.error,null,run.stderr);
  const result=JSON.parse(run.stdout);assert.equal(result.complete,true);assert.deepEqual(result.differences,[]);
});

 test('rules outage does not swallow CI green and intermittent failures preserve human wait', async t => {
  const fx=createFixture(t);
  const green=snap({verdict:'BLOCKED_HUMAN',blockers:['approval_required'],reviewDecision:'REVIEW_REQUIRED'});
  const outage={...green,gate:{requiredChecksUnavailable:true},blockers:[...green.blockers,'required_checks_unavailable']};
  fx.setSnapshot({...outage,checks:[check('build','pending',{required:true})]});
  assert.equal((await fx.run()).code,2);
  fx.advance(5);assert.equal((await fx.run()).code,0);await fx.run(['--resume','noted']);
  fx.setSnapshot(outage);fx.advance(10);
  const completed=await fx.run();assert.equal(completed.code,0);assert.match(completed.stdout,/checks-passed/);
  const plan=fx.writeWait({kind:'human',headSha:outage.latestCommitOid,reason:'await approval',afterMinutes:null,checks:[],threads:[]});
  assert.equal((await fx.run(['--wait',plan])).code,0);
  for(let n=1;n<=16;n++){fx.advance(30);fx.setSnapshot(n%4===0?outage:green);assert.equal((await fx.run()).code,2);assert.equal(fx.readState().wait.kind,'human');}
 });
 test('permanent rules outage allows human waits with at most daily acknowledged reminders', async t => {
  const fx=createFixture(t);
  const s=snap({verdict:'BLOCKED_HUMAN',reviewDecision:'REVIEW_REQUIRED',blockers:['approval_required','required_checks_unavailable'],gate:{requiredChecksUnavailable:true}});
  fx.setSnapshot(s);let notices=[];
  for(let i=0;i<=144;i++){
    const r=await fx.run([], {CINDY_PR_TRACE:'0'});
    if(r.code===0){
      if(r.stdout.includes('required-checks-unavailable'))notices.push(fx.now());
      const plan=fx.writeWait({kind:'human',headSha:s.latestCommitOid,reason:'await approval',afterMinutes:null,checks:[],threads:[]});
      assert.equal((await fx.run(['--wait',plan],{CINDY_PR_TRACE:'0'})).code,0);
    }
    fx.advance(30);
  }
  assert.equal(notices.length,3);for(let i=1;i<notices.length;i++)assert.ok(notices[i]-notices[i-1]>=24*60*MIN);
 });

test('transient inventory failure preserves an existing defer deadline',async t=>{
 const fx=createFixture(t);const s=snap();fx.setSnapshot(s);await fx.run();await fx.run(['--defer','30']);
 const due=fx.readState().nextAllowAt;
 fx.advance(10);fx.setSnapshot({...s,verdict:'NOT_READY',blockers:['required_checks_unavailable'],gate:{requiredChecksUnavailable:true}});
 assert.equal((await fx.run()).code,2);assert.equal(fx.readState().nextAllowAt,due);
 fx.setSnapshot(s);fx.advance(20);const r=await fx.run();assert.equal(r.code,0);assert.match(r.stdout,/defer-expired/);
});

test('ready withheld during an outage is delivered on recovery and survives missing ack',async t=>{
 const fx=createFixture(t);const s=snap();
 fx.setSnapshot({...s,verdict:'NOT_READY',blockers:['required_checks_unavailable'],gate:{requiredChecksUnavailable:true}});
 assert.equal((await fx.run()).code,0);await fx.run(['--resume','cannot confirm ready']);
 fx.advance(5);fx.setSnapshot(s);const recovered=await fx.run();assert.equal(recovered.code,0);assert.match(recovered.stdout,/rules-recovered/);
 fx.advance(5);assert.equal((await fx.run()).code,0,'unacknowledged recovery remains pending');
 await fx.run(['--ack']);fx.advance(5);assert.equal((await fx.run()).code,2,'confirmed recovery does not repeat');
});

test('a required check added on the same head starts the registration watchdog once', () => {
  const done = snap({ checks: [check('fast', 'passed', { required: true })] });
  const added = snap({ checks: [check('fast', 'passed', { required: true }), check('late', 'pending', { required: true, expected: true })] });
  let r = evaluateWatch(seenWatch(done), added, T0);
  assert.equal(r.events.some(e => e.kind === 'no-checks'), false);
  assert.ok(r.next.checksAwaitedSince, 'timer starts at first sight');
  r = evaluateWatch(r.next, added, T0 + 16 * MIN);
  assert.deepEqual(r.events.filter(e => e.kind === 'no-checks'), [{ kind: 'no-checks', minutes: 16, missing: ['late'] }]);
  for (const m of [20, 40, 120]) {
    r = evaluateWatch(r.next, added, T0 + m * MIN);
    assert.equal(r.events.some(e => e.kind === 'no-checks'), false, 'no repeat after the reminder');
  }
  // The missing item registers and later a different one goes missing: a new reminder is allowed.
  r = evaluateWatch(r.next, done, T0 + 130 * MIN);
  const other = snap({ checks: [check('fast', 'passed', { required: true }), check('later', 'pending', { required: true, expected: true })] });
  r = evaluateWatch(r.next, other, T0 + 131 * MIN);
  r = evaluateWatch(r.next, other, T0 + 150 * MIN);
  assert.equal(r.events.some(e => e.kind === 'no-checks'), true);
});

test('a rules-outage reminder that was never acknowledged still owes the recovery review', async t => {
  const fx = createFixture(t); const s = snap();
  fx.setSnapshot(s); assert.equal((await fx.run()).code, 0); await fx.run(['--ack']);
  const outage = { ...s, verdict: 'NOT_READY', blockers: ['required_checks_unavailable'], gate: { requiredChecksUnavailable: true } };
  fx.setSnapshot(outage); fx.advance(5); await fx.run(); fx.advance(5);
  const reminded = await fx.run(); assert.equal(reminded.code, 0); assert.match(reminded.stdout, /required-checks-unavailable/);
  fx.setSnapshot(s); fx.advance(5);
  const recovered = await fx.run(); assert.equal(recovered.code, 0); assert.match(recovered.stdout, /rules-recovered/);
  // Resuming confirms only the earliest release (the outage reminder); recovery is then delivered again.
  await fx.run(['--resume', 'noted']); fx.advance(5);
  const again = await fx.run(); assert.equal(again.code, 0); assert.match(again.stdout, /rules-recovered/);
  await fx.run(['--ack']); fx.advance(5);
  const last = await fx.run(); assert.equal(last.code, 2, `delivered once: ${last.stdout}`);
});

test('replay refuses to call a trace complete when a recorded round is missing', async t => {
  const fx = createFixture(t);
  fx.setSnapshot(snap({ comments: [comment('c1', 'human', iso(T0), 'first')] })); await fx.run(); await fx.run(['--ack']);
  fx.advance(5); fx.setSnapshot(snap({ comments: [comment('c2', 'human', iso(T0 + 5 * MIN), 'second')] })); await fx.run(); await fx.run(['--ack']);
  const file = fx.stateFile() + '.trace.jsonl';
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.deepEqual(lines.map(l => JSON.parse(l).seq), [1, 2, 3, 4]);
  const script = path.join(path.dirname(gatePath), 'pr-follow-replay.mjs');
  const replay = lines => new Promise(resolve => {
    const copy = file + '.copy'; fs.writeFileSync(copy, lines.join('\n') + '\n');
    execFile(process.execPath, [script, copy], { encoding: 'utf8' }, (error, stdout) => resolve(JSON.parse(stdout)));
  });
  assert.equal((await replay(lines)).complete, true);
  const holed = await replay([lines[0], lines[1], lines[3]]);
  assert.equal(holed.complete, false); assert.equal(holed.gaps, 1);
});

test('gate requires Node 18+ before skipping and appends CINDY_PR_NODE after CINDY_PRECHECK_OK', async (t) => {
  const fx = createFixture(t);
  fx.setSnapshot(snap());
  const first = await fx.run();
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /CINDY_PRECHECK_OK\nCINDY_PR_NODE=\d+\n$/);
  await fx.run(['--ack']);

  // Pacing not-due tick still fails closed on Node < 18 instead of emitting CINDY_PRECHECK_OK
  let oldOut = '';
  let oldErr = '';
  const blocked = await runGate([PR_URL, '--state-dir', path.join(fx.root, 'state'), '--snapshot', path.join(fx.root, 'fake-pr-snapshot.mjs'), '--pacing'], {
    now: () => fx.now(),
    readTrigger: async () => null,
    out: (s) => { oldOut += s; },
    err: (s) => { oldErr += s; },
    nodeVersion: '16.20.2',
  });
  assert.equal(blocked, 1);
  assert.match(oldErr, /Node\.js 18\+ is required \(running 16\.20\.2\)/);
  assert.equal(oldOut, '');

  // Healthy not-due skip on Node 18+ emits both CINDY_PRECHECK_OK and CINDY_PR_NODE
  let okOut = '';
  const skipped = await runGate([PR_URL, '--state-dir', path.join(fx.root, 'state'), '--snapshot', path.join(fx.root, 'fake-pr-snapshot.mjs'), '--pacing'], {
    now: () => fx.now(),
    readTrigger: async () => null,
    out: (s) => { okOut += s; },
    err: () => {},
    nodeVersion: '22.14.0',
  });
  assert.equal(skipped, 2);
  assert.match(okOut, /CINDY_PRECHECK_OK\nCINDY_PR_NODE=22\n$/);
});

test('reconcile watch trigger bypasses pacing but runs lightweight probe first; real status watch still reads in full', async (t) => {
  const fx = createFixture(t);
  const s = snap();
  const baseProbe = { status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2 ', remarks: '0  0  0 0', base: 'base-1' };
  fx.setSnapshot(s);
  fx.setProbe(baseProbe);
  assert.equal((await fx.run(['--json'])).code, 0);
  assert.equal((await fx.run(['--ack', '--json'])).code, 0);
  // Seed lastProbe so probeAllowsSkip can match.
  fx.writeState({ probe: baseProbe });
  const runsAfterAck = fx.snapshotRuns();

  // Within the 30-min waiting pace (5 min later), an ordinary tick would be not-due.
  // A host `reconcile` watch trigger bypasses pacing, runs --probe, sees unchanged, and skips with 0 full snapshots.
  fx.advance(5);
  fx.setTrigger({ kind: 'watch', source: 'pr-status', detail: PR_URL, reason: 'reconcile' });
  const unchanged = await fx.run(['--pacing', '--json']);
  assert.equal(unchanged.code, 2);
  assert.equal(unchanged.json().reason, 'unchanged');
  assert.equal(fx.snapshotRuns(), runsAfterAck, 'unchanged reconcile trigger must not run a full snapshot');

  // If the probe actually changed (e.g. a new comment arrived during webhook overflow), reconcile runs the full snapshot.
  fx.advance(5);
  fx.setProbe({ ...baseProbe, remarks: '1 2026-10-20T10:09:00Z 0  0 0' });
  fx.setSnapshot(snap({ comments: [comment('C-missed', 'reviewer', iso(fx.now()), 'missed comment')] }));
  const changed = await fx.run(['--pacing', '--json']);
  assert.equal(changed.code, 0);
  assert.equal(fx.snapshotRuns(), runsAfterAck + 1);
  assert.match(changed.json().report, /missed comment/);
  assert.equal((await fx.run(['--ack', '--json'])).code, 0);
  const updatedProbe = { ...baseProbe, remarks: '1 2026-10-20T10:09:00Z 0  0 0' };
  fx.writeState({ probe: updatedProbe });

  // A non-reconcile watch trigger (explicit pr-status change such as mergeStateStatus -> BEHIND)
  // still skips the probe and runs a full snapshot even when the probe fingerprint is unchanged.
  fx.advance(5);
  fx.setTrigger({ kind: 'watch', source: 'pr-status', detail: PR_URL });
  const runsBeforeWatch = fx.snapshotRuns();
  fx.setSnapshot(snap({
    comments: [comment('C-missed', 'reviewer', iso(fx.now() - 5 * MIN), 'missed comment')],
    mergeStateStatus: 'BEHIND',
  }));
  const explicitWatch = await fx.run(['--pacing', '--json']);
  assert.equal(explicitWatch.code, 2);
  assert.equal(fx.snapshotRuns(), runsBeforeWatch + 1, 'real pr-status change must still read full snapshot');
});

test('real CLI preserves trigger.reason=reconcile, keeps legacy snapshot argv, and passes CINDY_PR_STATE_DIR via env', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-gate-reconcile-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateDir = path.join(dir, 'state');
  const argvLog = path.join(dir, 'snap-argv.log');
  const fakeSnap = path.join(dir, 'fake-snap.mjs');
  const s = snap();
  const baseProbe = { status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2 ', remarks: '0  0  0 0', base: 'base-1' };
  // Strict legacy parser mirroring the previous official pr-snapshot.mjs:
  // rejects any unknown option such as `--state-dir`.
  fs.writeFileSync(fakeSnap, `
import fs from 'node:fs';
const argv = process.argv.slice(2);
let prArg = null;
let probe = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--repo') { i++; continue; }
  if (a === '--probe') { probe = true; continue; }
  if (a === '--strict-exit') continue;
  if (a === '--expect-head') { i++; continue; }
  if (!prArg && !a.startsWith('-')) { prArg = a; continue; }
  throw new Error('Unexpected argument: ' + a);
}
fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify({ argv, stateDirEnv: process.env.CINDY_PR_STATE_DIR ?? null }) + '\\n');
if (probe) {
  process.stdout.write(${JSON.stringify(JSON.stringify(baseProbe))});
} else {
  process.stdout.write(${JSON.stringify(JSON.stringify(s))});
}
`, 'utf8');

  const invoke = (extra = [], payload = null, envExtra = {}) => spawnSync(
    process.execPath,
    [gatePath, PR_URL, '--state-dir', stateDir, '--snapshot', fakeSnap, '--min-pass-spacing-minutes', '0', ...extra],
    { encoding: 'utf8', input: payload ? JSON.stringify(payload) : '', env: { ...process.env, CINDY_PR_TRACE: '0', ...envExtra } },
  );

  // First full snapshot must keep the legacy argv (no --state-dir) and pass CINDY_PR_STATE_DIR via env.
  const first = invoke(['--no-pacing', '--json']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(invoke(['--ack', '--json']).status, 0);
  const firstCalls = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const fullCall = firstCalls.find(call => !call.argv.includes('--probe'));
  assert.ok(fullCall, 'expected a full snapshot invocation');
  assert.deepEqual(fullCall.argv, [String(NUMBER), '--repo', REPO], 'must preserve legacy snapshot CLI argv');
  assert.equal(fullCall.stateDirEnv, stateDir, 'full snapshot must receive stateDir via CINDY_PR_STATE_DIR');

  // PR_SNAPSHOT_SCRIPT env override also works with the strict legacy parser.
  fs.writeFileSync(argvLog, '');
  const viaEnv = spawnSync(
    process.execPath,
    [gatePath, PR_URL, '--state-dir', stateDir, '--triggered', '--no-pacing', '--json'],
    { encoding: 'utf8', env: { ...process.env, CINDY_PR_TRACE: '0', PR_SNAPSHOT_SCRIPT: fakeSnap } },
  );
  assert.equal(viaEnv.status, 2, viaEnv.stderr);
  const envCalls = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(envCalls[0].argv, [String(NUMBER), '--repo', REPO]);
  assert.equal(envCalls[0].stateDirEnv, stateDir);

  // Seed probe to match fakeSnap's probe output, then send host reconcile trigger via stdin.
  const statePath = stateFilePath(stateDir, REPO, NUMBER);
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  saved.probe = baseProbe;
  fs.writeFileSync(statePath, JSON.stringify(saved));
  fs.writeFileSync(argvLog, '');

  const rec = invoke(['--pacing', '--json'], {
    event: 'schedule-pre-run',
    scheduleId: 'sched-1',
    runId: 'run-2',
    lastFinishedAt: Date.now() - 60_000,
    firedAt: Date.now(),
    trigger: { kind: 'watch', source: 'pr-status', detail: PR_URL, reason: 'reconcile' },
  });
  assert.equal(rec.status, 2, rec.stderr);
  assert.equal(JSON.parse(rec.stdout).reason, 'unchanged');
  const recCalls = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(recCalls.length, 1, 'reconcile trigger should only run --probe when unchanged');
  assert.ok(recCalls[0].argv.includes('--probe'));
});

test('diagnostic test-run disables snapshot cache writes even with --state-dir and inherited CINDY_PR_STATE_DIR', { skip: process.platform === 'win32' ? 'POSIX-only: fake gh shim' : false }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-gate-diag-readonly-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateDir = path.join(dir, 'state');
  const freshDir = path.join(dir, 'fresh-state');
  const cfgFile = path.join(dir, 'cfg.json');
  const prUrl = 'https://github.com/acme/game/pull/54';

  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(process.env.CFG_FILE, 'utf8'));
if (args[0] === '--version') process.exit(0);
if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({
    headRefOid: cfg.headSha,
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  }));
  process.exit(0);
}
if (args[0] === 'api' && args[1] === 'graphql') {
  process.stdout.write(JSON.stringify({
    data: {
      viewer: { login: 'alice' },
      repository: {
        pullRequest: {
          state: 'OPEN', headRefOid: cfg.headSha, mergeStateStatus: 'CLEAN', baseRefName: 'main',
          baseRef: { target: { oid: 'base-1' }, branchProtectionRule: null },
          reviewThreads: { nodes: [] }, mergeQueueEntry: null, timelineItems: { nodes: [] },
        },
      },
    },
  }));
  process.exit(0);
}
if (args[0] === 'api' && args[1] === 'repos/acme/game/pulls/54') {
  process.stdout.write(
    'HTTP/2.0 200 OK\\nETag: ' + cfg.pullEtag + '\\n\\n' +
    JSON.stringify({
      base: { sha: 'base-1' }, head: { sha: cfg.headSha }, mergeable: true, state: 'open',
      html_url: 'https://github.com/acme/game/pull/54',
    }),
  );
  process.exit(0);
}
if (args[0] === 'api' && args[1].includes('/rules/branches/')) {
  process.stdout.write('HTTP/2.0 200 OK\\nETag: ' + cfg.rulesEtag + '\\n\\n' + JSON.stringify(cfg.rules));
  process.exit(0);
}
process.stderr.write('Unexpected gh call: ' + args.join(' ') + '\\n');
process.exit(2);
`, { mode: 0o755 });

  const baseEnv = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, CFG_FILE: cfgFile };

  // 1. Prime an existing production stateDir with gate state + snapshot ETag caches.
  fs.writeFileSync(cfgFile, JSON.stringify({ headSha: 'head-1', pullEtag: 'W/"pull-v1"', rulesEtag: 'W/"rules-v1"', rules: [] }));
  const primed = spawnSync(
    process.execPath,
    [gatePath, prUrl, '--state-dir', stateDir, '--no-pacing', '--json'],
    { encoding: 'utf8', env: baseEnv },
  );
  assert.equal(primed.status, 0, primed.stderr);
  const filesBefore = fs.readdirSync(stateDir).sort();
  assert.ok(filesBefore.some(f => f.endsWith('.rest-cache.json')), 'normal run should prime pull REST cache');
  assert.ok(filesBefore.some(f => f.endsWith('.rules-cache.json')), 'normal run should prime rules cache');
  const snapshotDirState = (targetDir) => Object.fromEntries(
    fs.readdirSync(targetDir).sort().map(name => {
      const full = path.join(targetDir, name);
      const st = fs.statSync(full);
      return [name, { content: fs.readFileSync(full, 'utf8'), mtimeMs: st.mtimeMs }];
    }),
  );
  const before = snapshotDirState(stateDir);

  // 2. Change upstream ETags/data and run a diagnostic hook with BOTH --state-dir AND inherited CINDY_PR_STATE_DIR.
  fs.writeFileSync(cfgFile, JSON.stringify({
    headSha: 'head-2',
    pullEtag: 'W/"pull-v2"',
    rulesEtag: 'W/"rules-v2"',
    rules: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }] } }],
  }));
  const diagPayload = JSON.stringify({ event: 'schedule-pre-run', scheduleId: 'test', runId: 'test', firedAt: Date.now() });
  const diag = spawnSync(
    process.execPath,
    [gatePath, prUrl, '--state-dir', stateDir, '--json'],
    { encoding: 'utf8', input: diagPayload, env: { ...baseEnv, CINDY_PR_STATE_DIR: stateDir } },
  );
  assert.equal(diag.status, 0, diag.stderr);
  assert.match(JSON.parse(diag.stdout).detail, /diagnostic only, follow-up state unchanged/);
  assert.deepEqual(snapshotDirState(stateDir), before, 'diagnostic run must not create or modify any state or cache file');

  // 3. Diagnostic run with only inherited CINDY_PR_STATE_DIR pointing at a non-existent directory creates nothing.
  const diagFresh = spawnSync(
    process.execPath,
    [gatePath, prUrl, '--json'],
    { encoding: 'utf8', input: diagPayload, env: { ...baseEnv, CINDY_PR_STATE_DIR: freshDir } },
  );
  assert.equal(diagFresh.status, 0, diagFresh.stderr);
  assert.equal(fs.existsSync(freshDir), false, 'diagnostic run must not create inherited CINDY_PR_STATE_DIR');
});

test('replay: settled baseline wait paces at 15m, uses probe, absorbs subsequent base commits, and wakes on news or deadline', async (t) => {
  const fx = createFixture(t);
  const s = baselineBlocked();
  const baseProbe = { status: 'OPEN false MERGEABLE aaa1111  FAILURE:1,SUCCESS:1', remarks: '0  0  0 0', base: 'base-0' };
  fx.setProbe(baseProbe);
  fx.setSnapshot(s);
  assert.equal((await fx.run(['--pacing', '--json'])).code, 0);
  // Step 0 (15m) -> expire -> Step 1 (30m) -> expire -> Step 2 (60m) -> expire -> Step 3 (120m)
  for (let step = 0; step < 3; step += 1) {
    const set = (await fx.run(['--wait', fx.writeWait(baselinePlan(s)), '--json'])).json();
    fx.advance((set.wait.until - fx.now()) / MIN);
    assert.equal((await fx.run(['--pacing', '--json'])).json().reason, 'wait-expired');
  }
  const long = (await fx.run(['--wait', fx.writeWait(baselinePlan(s)), '--json'])).json();
  assert.equal(long.wait.until - fx.now(), 120 * MIN);
  // Ensure we have a fresh probe baseline after the wait-expired full read (which skipped probe).
  fx.writeState({ probe: baseProbe, lastFullReadAt: fx.now() });

  // 5m and 10m ticks are skipped immediately with 0 probes and 0 snapshots.
  let snaps = fx.snapshotRuns();
  let probes = fx.probeRuns();
  for (const step of [5, 5]) {
    fx.advance(step);
    const r = await fx.run(['--pacing', '--json']);
    assert.equal(r.code, 2);
    assert.equal(r.json().reason, 'not-due');
    assert.match(r.json().detail, /pace=backoff/);
  }
  assert.equal(fx.probeRuns(), probes, 'not-due ticks must not call probe');
  assert.equal(fx.snapshotRuns(), snaps, 'not-due ticks must not call snapshot');

  // 15m tick: unchanged probe skips full snapshot (1 probe, 0 snapshots).
  fx.advance(5);
  let r = await fx.run(['--pacing', '--json']);
  assert.equal(r.code, 2);
  assert.equal(r.json().reason, 'unchanged');
  assert.equal(fx.probeRuns(), probes + 1);
  assert.equal(fx.snapshotRuns(), snaps);

  // First base commit arrives on the next 15m tick: must pierce probe so baseMovedAt & 60m clamp are recorded.
  fx.advance(10);
  assert.equal((await fx.run(['--pacing', '--json'])).json().reason, 'not-due');
  fx.advance(5);
  fx.setProbe({ ...baseProbe, base: 'base-1' });
  fx.setSnapshot({ ...s, baseCommitOid: 'base-1' });
  snaps = fx.snapshotRuns();
  probes = fx.probeRuns();
  r = await fx.run(['--pacing', '--json']);
  assert.equal(r.code, 2);
  assert.equal(r.json().reason, 'waiting');
  assert.equal(fx.snapshotRuns(), snaps + 1, 'first base move reads in full to record baseMovedAt');
  assert.ok(fx.readState().wait.baseMovedAt, 'baseMovedAt recorded on first base move');
  const clampedUntil = fx.readState().wait.until;
  assert.equal(clampedUntil, fx.now() + 60 * MIN, '120m wait pulled within 60m of first base move');

  // Subsequent base commit 15m later is absorbed right at the probe without a full snapshot.
  fx.advance(15);
  fx.setProbe({ ...baseProbe, base: 'base-2' });
  fx.setSnapshot({ ...s, baseCommitOid: 'base-2' });
  snaps = fx.snapshotRuns();
  probes = fx.probeRuns();
  r = await fx.run(['--pacing', '--json']);
  assert.equal(r.code, 2);
  assert.equal(r.json().reason, 'unchanged');
  assert.equal(fx.probeRuns(), probes + 1);
  assert.equal(fx.snapshotRuns(), snaps, 'subsequent base commit absorbed at probe');

  // New human comment still pierces probe immediately at the next 15m tick and wakes the agent.
  fx.advance(15);
  fx.setProbe({ ...baseProbe, base: 'base-2', remarks: '1 2026-10-20T15:00:00Z 0  0 0' });
  fx.setSnapshot({ ...s, baseCommitOid: 'base-2', comments: [comment('c-new', 'reviewer', iso(fx.now()), 'Please rebase now')] });
  r = await fx.run(['--pacing', '--json']);
  assert.equal(r.code, 0);
  assert.equal(r.json().reason, 'changed');
  assert.match(r.json().report, /Please rebase now/);
});

test('replay: skips redundant probe when state already requires a full read', async (t) => {
  const fx = createFixture(t);
  const p0 = { status: 'OPEN false MERGEABLE aaa1111  SUCCESS:2', remarks: '0  0  0 0', base: 'base-0' };
  fx.setProbe(p0);

  // 1. inFlight (checks running): skips probe on subsequent ticks while CI runs.
  const running = snap({ checks: [check('build', 'pending', { required: true })], verdict: 'WAITING_CI' });
  fx.setSnapshot({ ...running, probe: p0 });
  await fx.run(['--json']);
  assert.equal(fx.readState().inFlight, true);
  assert.equal(fx.readState().snapshotProvidesProbe, true);
  let probes = fx.probeRuns();
  let snaps = fx.snapshotRuns();
  fx.advance(5);
  assert.equal((await fx.run(['--pacing', '--json'])).code, 2);
  assert.equal(fx.probeRuns(), probes, 'inFlight must skip redundant probe');
  assert.equal(fx.snapshotRuns(), snaps + 1);

  // 2. pendingWatch (unacked event): skips probe on retry.
  const green = snap({ verdict: 'READY', probe: p0 });
  fx.setSnapshot(green);
  fx.advance(5);
  assert.equal((await fx.run(['--pacing', '--json'])).code, 0);
  assert.ok(fx.readState().pendingWatch);
  probes = fx.probeRuns();
  snaps = fx.snapshotRuns();
  fx.advance(5);
  assert.equal((await fx.run(['--pacing', '--json'])).json().reason, 'retry-unacked');
  assert.equal(fx.probeRuns(), probes, 'pendingWatch retry must skip redundant probe');
  assert.equal(fx.snapshotRuns(), snaps + 1);
  assert.equal((await fx.run(['--ack'])).code, 0);

  // 3. 30m full reread when snapshot embeds snap.probe: skips probe AND refreshes probe baseline.
  const p1 = { ...p0, status: 'OPEN false MERGEABLE aaa1111  SUCCESS:3' };
  fx.setProbe(p1);
  fx.setSnapshot({ ...green, probe: p1 });
  probes = fx.probeRuns();
  snaps = fx.snapshotRuns();
  fx.advance(31);
  assert.equal((await fx.run(['--pacing', '--json'])).code, 2);
  assert.equal(fx.probeRuns(), probes, '30m reread skips probe when snapshotProvidesProbe is true');
  assert.equal(fx.snapshotRuns(), snaps + 1);
  assert.deepEqual(fx.readState().probe, p1, 'probe baseline refreshed from snap.probe');

  // Next tick within 30m still uses probe and skips full snapshot.
  fx.writeState({ lastPassAt: fx.now() - 10 * MIN }); // active window so 5m tick is due
  probes = fx.probeRuns();
  snaps = fx.snapshotRuns();
  fx.advance(5);
  const skipped = await fx.run(['--pacing', '--json']);
  assert.equal(skipped.code, 2);
  assert.equal(skipped.json().reason, 'unchanged');
  assert.equal(fx.probeRuns(), probes + 1);
  assert.equal(fx.snapshotRuns(), snaps);

  // 4. Open bot settle window: skips probe.
  fx.writeState({ settleUntil: fx.now() + 15 * MIN });
  probes = fx.probeRuns();
  snaps = fx.snapshotRuns();
  fx.advance(5);
  await fx.run(['--pacing', '--json']);
  assert.equal(fx.probeRuns(), probes, 'settling window must skip redundant probe');
  assert.equal(fx.snapshotRuns(), snaps + 1);

  // 5. Due wait deadline: skips probe and goes straight to full snapshot.
  fx.writeState({ settleUntil: undefined, wait: { kind: 'retry', headSha: 'aaa1111', reason: 'recheck', createdAt: fx.now() - 15 * MIN, until: fx.now(), checks: [], threads: [], reviewDecision: green.reviewDecision, blockers: green.blockers, threadStates: [] } });
  probes = fx.probeRuns();
  snaps = fx.snapshotRuns();
  const expired = await fx.run(['--pacing', '--json']);
  assert.equal(expired.json().reason, 'wait-expired');
  assert.equal(fx.probeRuns(), probes, 'due wait must skip redundant probe');
  assert.equal(fx.snapshotRuns(), snaps + 1);

  // 6. Pure unit checks on mustFullReadBeforeProbe / canSkipWithProbe.
  const quiet = { watch: freshWatch(green, T0), probe: p1, lastFullReadAt: T0, lastPassAt: T0 };
  assert.equal(mustFullReadBeforeProbe(quiet, T0 + 5 * MIN), false);
  assert.equal(canSkipWithProbe(quiet, T0 + 5 * MIN), true);
  assert.equal(mustFullReadBeforeProbe({ ...quiet, merged: true }, T0 + 5 * MIN), true);
  assert.equal(canSkipWithProbe(quiet, T0 + 31 * MIN), false);
  assert.equal(mustFullReadBeforeProbe(quiet, T0 + 31 * MIN), false, '30m reread handled separately so legacy snapshots keep refreshing probe');
});
