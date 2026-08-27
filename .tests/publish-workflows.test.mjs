import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const workflowRoot = new URL('../.github/workflows/', import.meta.url);
const cnWorkflow = readFileSync(
  new URL('publish-cindy-plugins.yml', workflowRoot),
  'utf8',
);
const globalWorkflow = readFileSync(
  new URL('publish-cindy-plugins-global.yml', workflowRoot),
  'utf8',
);
const prWorkflow = readFileSync(new URL('pr-verify.yml', workflowRoot), 'utf8');

test('changed-plugin detection excludes base-only changes but includes PR package changes', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'cindy-plugin-pr-diff-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8' }).trim();
  const commit = () => {
    git('add', '.');
    git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const write = (file, content) => {
    const target = path.join(fixture, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  write('base-only/ghost.json', '{}');
  write('pr-changed/ghost.json', '{}');
  write('LICENSE', 'fixture license');
  commit();
  git('checkout', '-qb', 'feature');
  write('README.md', 'documentation-only PR');
  const head = commit();
  git('checkout', '-q', 'main');
  write('base-only/main.js', '// upstream-only change');
  const base = commit();
  git('checkout', '-q', 'feature');
  git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'merge', '--no-ff', '-qm', 'PR merge result', 'main');

  const step = prWorkflow.match(/      - name: Detect changed plugin directories\n([\s\S]*?)(?=\n      - name:)/)?.[1];
  assert.ok(step, 'workflow must contain the changed-plugin detector');
  const source = step.split('        run: |\n')[1];
  assert.ok(source, 'detector must contain an executable shell script');
  const script = source.split('\n').map((line) => line.replace(/^          /, '')).join('\n');
  const detect = (prHead) => {
    const run = mkdtempSync(path.join(os.tmpdir(), 'cindy-plugin-pr-output-'));
    t.after(() => rmSync(run, { recursive: true, force: true }));
    const output = path.join(run, 'output');
    execFileSync('bash', ['-c', script], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, BASE_SHA: base, HEAD_SHA: prHead, RUNNER_TEMP: run, GITHUB_OUTPUT: output },
    });
    return JSON.parse(readFileSync(output, 'utf8').trim().replace(/^plugins=/, ''));
  };

  assert.deepEqual(detect(head), [], 'a documentation-only PR must not include a base-only plugin change');
  write('pr-changed/main.js', '// PR plugin change');
  assert.deepEqual(detect(commit()), [{ directory: 'pr-changed' }], 'a PR plugin change must still require verification');
  write('LICENSE', 'changed shared package license');
  assert.deepEqual(detect(commit()), [{ directory: 'base-only' }, { directory: 'pr-changed' }], 'shared packaged files must still select every plugin');
});

test('pull request verification requires the production Cindy attestation', () => {
  assert.match(prWorkflow, /^      - edited$/m);
  assert.match(
    prWorkflow,
    /name: Require production Cindy verification attestation\n        if: \$\{\{ steps\.changes\.outputs\.plugins != '\[\]' \}\}/,
  );
  assert.match(prWorkflow, /Production Cindy verification \/ 生产版 Cindy 验证/);
  assert.match(prWorkflow, /\.pull_request\.body/);
  assert.match(prWorkflow, /GITHUB_EVENT_PATH/);
  assert.doesNotMatch(prWorkflow, /github\.event\.pull_request\.body/);
  assert.ok(
    prWorkflow.indexOf('name: Dry-run plugin packaging') <
      prWorkflow.indexOf('name: Require production Cindy verification attestation'),
    'package validation must run before a pending manual attestation blocks the job',
  );
});

test('CN and Global plugin publishers are operationally independent', () => {
  assert.match(cnWorkflow, /^name: Publish Cindy Plugins \(CN\)$/m);
  assert.match(globalWorkflow, /^name: Publish Cindy Plugins \(Global\)$/m);
  assert.match(cnWorkflow, /group: cindy-plugin-publish-cn-prod-/);
  assert.match(globalWorkflow, /group: cindy-plugin-publish-global-prod-/);

  assert.match(cnWorkflow, /secrets\.CINDY_PLUGIN_PLATFORM_URL_CN/);
  assert.doesNotMatch(cnWorkflow, /CINDY_PLUGIN_PLATFORM_URL_GLOBAL/);
  assert.match(globalWorkflow, /secrets\.CINDY_PLUGIN_PLATFORM_URL_GLOBAL/);
  assert.doesNotMatch(globalWorkflow, /CINDY_PLUGIN_PLATFORM_URL_CN/);
});

test('both production publishers route through protected Platform endpoints', () => {
  for (const workflow of [cnWorkflow, globalWorkflow]) {
    assert.doesNotMatch(workflow, /CINDY_PLUGIN_SERVER_URL_/);
    assert.doesNotMatch(workflow, /api\/publisher\/releases/);
    assert.doesNotMatch(workflow, /https:\/\/(?:plugin|platform)\./);
  }
});

test('both regional publishers support main pushes and full manual republish', () => {
  for (const workflow of [cnWorkflow, globalWorkflow]) {
    assert.match(workflow, /push:\n    branches:\n      - main/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /EVENT_NAME === 'workflow_dispatch'/);
    assert.match(workflow, /Publishing all Cindy plugins:/);
    assert.match(workflow, /id-token: write/);
    assert.match(workflow, /audience=cindy-plugin/);
    assert.match(workflow, /node --test \.tests\/plugin-contract\.test\.mjs/);
    assert.match(workflow, /const sharedPackageFiles = new Set/);
    assert.match(workflow, /'LICENSE', 'NOTICE', 'TRADEMARKS\.md', 'TRADEMARKS\.zh-CN\.md'/);
    assert.doesNotMatch(workflow, /repository: (?:makecindy\/cindy|xindong\/cindy-server)/);
    assert.doesNotMatch(workflow, /\.ci-contracts/);
  }
});

test('both regional publishers pin actions in the OIDC publishing chain', () => {
  const checkoutRef = '3d3c42e5aac5ba805825da76410c181273ba90b1';
  const githubScriptRef = '3a2844b7e9c422d3c10d287c895573f7108da1b3';
  for (const workflow of [cnWorkflow, globalWorkflow]) {
    assert.match(workflow, new RegExp(`actions/checkout@${checkoutRef}`));
    assert.doesNotMatch(workflow, /actions\/checkout@v\d+/);
    assert.match(
      workflow,
      new RegExp(`actions/github-script@${githubScriptRef}`),
    );
    assert.doesNotMatch(workflow, /actions\/github-script@v\d+/);
  }
});
