import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

test('changed-plugin detection uses the merge parents even when event base is stale', (t) => {
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
  const staleBase = commit();
  git('checkout', '-qb', 'feature');
  write('README.md', 'documentation-only PR');
  const head = commit();
  git('checkout', '-q', 'main');
  write('base-only/main.js', '// upstream-only change');
  const base = commit();
  git('checkout', '-q', 'feature');

  const step = prWorkflow.match(/      - name: Detect changed plugin directories\n([\s\S]*?)(?=\n      - name:)/)?.[1];
  assert.ok(step, 'workflow must contain the changed-plugin detector');
  const source = step.split('        run: |\n')[1];
  assert.ok(source, 'detector must contain an executable shell script');
  const script = source.split('\n').map((line) => line.replace(/^          /, '')).join('\n');
  let mergeNumber = 0;
  const detect = (prHead) => {
    git('checkout', '-qb', `merge-${++mergeNumber}`, base);
    git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'merge', '--no-ff', '-qm', 'PR merge result', prHead);
    const run = mkdtempSync(path.join(os.tmpdir(), 'cindy-plugin-pr-output-'));
    t.after(() => rmSync(run, { recursive: true, force: true }));
    const output = path.join(run, 'output');
    execFileSync('bash', ['-c', script], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, BASE_SHA: staleBase, HEAD_SHA: prHead, RUNNER_TEMP: run, GITHUB_OUTPUT: output },
    });
    git('checkout', '-q', 'feature');
    return JSON.parse(readFileSync(output, 'utf8').trim().replace(/^plugins=/, ''));
  };

  assert.deepEqual(detect(head), [], 'a documentation-only PR must not include a base-only plugin change');
  write('pr-changed/main.js', '// PR plugin change');
  assert.deepEqual(detect(commit()), [{ directory: 'pr-changed' }], 'a PR plugin change must still require verification');
  write('LICENSE', 'changed shared package license');
  assert.deepEqual(detect(commit()), [{ directory: 'base-only' }, { directory: 'pr-changed' }], 'shared packaged files must still select every plugin');

  const contractStep = prWorkflow.match(/      - name: Validate official plugin publish contract\n([\s\S]*?)(?=\n      - name:)/)?.[1];
  assert.ok(contractStep, 'workflow must contain the package contract gate');
  assert.ok(contractStep.includes('test "$(git rev-parse HEAD^2)" = "${HEAD_SHA}"'));
  assert.ok(contractStep.includes('export BASE_SHA="$(git rev-parse HEAD^1)"'));
  assert.doesNotMatch(prWorkflow, /github\.event\.pull_request\.base\.sha/);
});

test('pull request verification requires the Cindy device attestation', () => {
  assert.match(prWorkflow, /^      - edited$/m);
  assert.match(
    prWorkflow,
    /name: Require Cindy device verification attestation\n        if: \$\{\{ steps\.changes\.outputs\.plugins != '\[\]' \}\}/,
  );
  assert.match(prWorkflow, /Cindy device verification \/ Cindy 实机验证/);
  assert.match(prWorkflow, /\.pull_request\.body/);
  assert.match(prWorkflow, /GITHUB_EVENT_PATH/);
  assert.doesNotMatch(prWorkflow, /github\.event\.pull_request\.body/);
  assert.ok(
    prWorkflow.indexOf('name: Dry-run plugin packaging') <
      prWorkflow.indexOf('name: Require Cindy device verification attestation'),
    'package validation must run before a pending manual attestation blocks the job',
  );
});

test('device attestation accepts current and legacy checked labels, but not unchecked claims', (t) => {
  const step = prWorkflow.match(/      - name: Require Cindy device verification attestation\n([\s\S]*?)(?=\n      - name:|$)/)?.[1];
  assert.ok(step, 'workflow must contain the device attestation gate');
  const source = step.split('        run: |\n')[1];
  assert.ok(source, 'attestation gate must contain an executable shell script');
  const script = source.split('\n').map((line) => line.replace(/^          /, '')).join('\n');
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'cindy-attestation-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const event = path.join(fixture, 'event.json');
  const template = readFileSync(new URL('../.github/PULL_REQUEST_TEMPLATE.md', import.meta.url), 'utf8');
  assert.match(template, /or Beta Cindy build/);
  assert.match(template, /Either channel is sufficient/);
  assert.match(template, /Dev\/local builds do not qualify/);
  for (const [body, expected] of [
    ['- [x] **Cindy device verification / Cindy 实机验证** — stable 0.1.82', 0],
    ['- [X] **Cindy device verification / Cindy 实机验证** — Beta 0.1.82', 0],
    ['- [x] **Production Cindy verification / 生产版 Cindy 验证**', 0],
    ['- [ ] **Cindy device verification / Cindy 实机验证**', 1],
    ['- [ ] **Production Cindy verification / 生产版 Cindy 验证**', 1],
    ['Beta 0.1.82 verified, without checking the attestation', 1],
    ['', 1],
  ]) {
    writeFileSync(event, JSON.stringify({ pull_request: { body } }));
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: event } });
    assert.equal(result.status, expected, result.stderr || result.stdout);
  }
});

test('PR verification artifacts are scoped, pinned and uploaded before attestation', () => {
  const upload = prWorkflow.split('      - name: Upload PR verification packages\n')[1]?.split('\n      - name: ')[0];
  assert.ok(upload);
  assert.match(upload, /if: \$\{\{ steps\.changes\.outputs\.plugins != '\[\]' \}\}/);
  assert.match(upload, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(upload, /path: \$\{\{ steps\.packages\.outputs\.directory \}\}\//);
  assert.match(upload, /name: pr-plugins-.*pull_request\.number.*pull_request\.head\.sha.*github\.run_id.*github\.run_attempt/);
  assert.match(upload, /if-no-files-found: error/);
  assert.match(upload, /retention-days: 7/);
  assert.match(upload, /compression-level: 0/);
  assert.doesNotMatch(upload, /always\(|continue-on-error/);
  assert.ok(prWorkflow.indexOf('name: Dry-run plugin packaging') < prWorkflow.indexOf('name: Upload PR verification packages'));
  assert.ok(prWorkflow.indexOf('name: Upload PR verification packages') < prWorkflow.indexOf('name: Require Cindy device verification attestation'));
  assert.doesNotMatch(prWorkflow, /pull_request_target|id-token: write|secrets\./);
  for (const publisher of [cnWorkflow, globalWorkflow]) {
    assert.doesNotMatch(publisher, /pr-plugins-|workflow_run:/);
  }
});

test('PR packaging stages only complete packages with matching hash and merge identity', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'cindy-pr-artifact-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const build = path.join(fixture, 'build');
  mkdirSync(build);
  cpSync(new URL('../.github/scripts', import.meta.url), path.join(build, '.github/scripts'), { recursive: true });
  for (const name of ['LICENSE', 'NOTICE', 'TRADEMARKS.md', 'TRADEMARKS.zh-CN.md']) {
    writeFileSync(path.join(build, name), 'fixture legal text');
  }
  for (const directory of ['first-plugin', 'second-plugin']) {
    mkdirSync(path.join(build, directory));
    writeFileSync(path.join(build, directory, 'ghost.json'), JSON.stringify({ id: directory, entry: 'main.js' }));
    writeFileSync(path.join(build, directory, 'main.js'), '// base');
  }
  const git = (...args) => execFileSync('git', args, { cwd: build, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  const commit = () => {
    git('add', '.');
    git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const base = commit();
  git('checkout', '-qb', 'feature');
  writeFileSync(path.join(build, 'first-plugin/main.js'), '// changed');
  const head = commit();
  git('checkout', '-q', 'main');
  git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'merge', '--no-ff', '-qm', 'merge fixture', head);
  const merge = git('rev-parse', 'HEAD');
  const step = prWorkflow.split('      - name: Dry-run plugin packaging\n')[1].split('\n      - name: ')[0];
  const script = step.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  // A similarly named unrelated temp file must never be included in the upload root.
  writeFileSync(path.join(fixture, 'unrelated.cindy'), 'unrelated');
  const output = path.join(fixture, 'output');
  const env = { ...process.env, RUNNER_TEMP: fixture, GITHUB_OUTPUT: output, HEAD_SHA: head,
    PLUGINS: JSON.stringify([{ directory: 'first-plugin' }, { directory: 'second-plugin' }]) };
  const run = () => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { cwd: build, env, encoding: 'utf8' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const staged = readFileSync(output, 'utf8').trim().replace(/^directory=/, '');
  assert.deepEqual(readdirSync(staged).sort(), ['first-plugin', 'second-plugin']);
  for (const directory of ['first-plugin', 'second-plugin']) {
    const dir = path.join(staged, directory);
    assert.deepEqual(readdirSync(dir).sort(), ['plugin.cindy', 'plugin.cindy.sha256', 'source.json']);
    const hash = createHash('sha256').update(readFileSync(path.join(dir, 'plugin.cindy'))).digest('hex');
    assert.equal(readFileSync(path.join(dir, 'plugin.cindy.sha256'), 'utf8'), `${hash}  plugin.cindy\n`);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'source.json'), 'utf8')), {
      pluginDirectory: directory, prHeadSha: head, baseSha: base, buildCommit: merge,
    });
    const packed = execFileSync('unzip', ['-p', path.join(dir, 'plugin.cindy'), 'main.js'], { encoding: 'utf8' });
    assert.equal(packed, directory === 'first-plugin' ? '// changed' : '// base');
  }
  env.GITHUB_OUTPUT = path.join(fixture, 'failed-output');
  env.PLUGINS = JSON.stringify([{ directory: 'first-plugin' }, { directory: 'missing-plugin' }]);
  assert.notEqual(run().status, 0);
  assert.equal(existsSync(env.GITHUB_OUTPUT), false, 'partial packaging must not expose an upload directory');
  env.HEAD_SHA = base;
  assert.notEqual(run().status, 0, 'wrong PR head must be rejected');
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

test('dependency collection cannot use the publishing job credentials', () => {
  for (const workflow of [cnWorkflow, globalWorkflow]) {
    const packaging = workflow.split('\n  package:\n')[1]?.split('\n  publish:\n')[0];
    const publishing = workflow.split('\n  publish:\n')[1];
    assert.ok(packaging && publishing);
    assert.match(packaging, /contents: read/);
    assert.match(packaging, /persist-credentials: false/);
    assert.match(packaging, /package-plugin\.sh/);
    assert.match(packaging, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
    assert.doesNotMatch(packaging, /id-token: write|secrets\./);
    assert.match(publishing, /needs: \[detect, package\]/);
    assert.match(publishing, /actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/);
    assert.match(publishing, /sha256sum plugin\.cindy/);
    assert.match(publishing, /cat commit\.txt/);
    assert.match(publishing, /cat plugin\.txt/);
    assert.doesNotMatch(publishing, /actions\/checkout@|package-plugin\.sh|binary-dependencies\.py/);
    assert.ok(publishing.indexOf('name: Verify package identity') < publishing.indexOf('name: Publish plugin'));
  }
  assert.match(prWorkflow, /node --test \.tests\/binary-dependencies\.test\.mjs/);
  assert.match(prWorkflow, /node \.github\/scripts\/check-source-size\.mjs/);
});

test('regional workflow scripts package, transfer, verify and publish the same bytes locally', (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'cindy-publish-local-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const build = path.join(fixture, 'build');
  mkdirSync(path.join(build, 'fixture'), { recursive: true });
  cpSync(new URL('../.github/scripts', import.meta.url), path.join(build, '.github/scripts'), { recursive: true });
  writeFileSync(path.join(build, 'fixture/ghost.json'), JSON.stringify({ id: 'fixture', entry: 'main.js' }));
  writeFileSync(path.join(build, 'fixture/main.js'), '// fixture');
  for (const name of ['LICENSE', 'NOTICE', 'TRADEMARKS.md', 'TRADEMARKS.zh-CN.md']) {
    writeFileSync(path.join(build, name), 'fixture legal text');
  }
  const git = (...args) => execFileSync('git', args, { cwd: build, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  const bin = path.join(fixture, 'bin');
  mkdirSync(bin);
  // Replace only network calls; execute the actual YAML run scripts with real
  // git/archive/hash tools. No external endpoint or real credential is used.
  writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env node
const fs = require('node:fs');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const url = args.at(-1);
if (url === 'https://oidc.example.test/token?request=1&audience=cindy-plugin') {
  assert.ok(args.includes('Authorization: bearer fixture-request-token'));
  process.stdout.write(JSON.stringify({ value: 'fixture-oidc-token' }));
} else {
  assert.equal(url, 'https://platform.example.test/publish');
  assert.ok(args.includes('Authorization: Bearer fixture-oidc-token'));
  const file = args[args.indexOf('--data-binary') + 1];
  assert.equal(file, '@' + process.env.RUNNER_TEMP + '/plugin.cindy');
  fs.copyFileSync(file.slice(1), process.env.DELIVERED_PACKAGE);
  process.stdout.write('{}');
}
`, { mode: 0o755 });
  const script = (workflow, name) => {
    const step = workflow.split('      - name: ' + name + '\n')[1]?.split('\n      - name: ')[0];
    const run = step?.split('        run: |\n')[1];
    assert.ok(run, 'missing workflow script: ' + name);
    return run.split('\n').map(line => line.replace(/^          /, '')).join('\n');
  };
  for (const [region, workflow] of [['CN', cnWorkflow], ['GLOBAL', globalWorkflow]]) {
    const built = path.join(fixture, region + '-built');
    const publish = path.join(fixture, region + '-publish');
    mkdirSync(built);
    mkdirSync(publish);
    const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      GITHUB_SHA: sha, PLUGIN_DIRECTORY: 'fixture', RUNNER_TEMP: built,
      GITHUB_OUTPUT: path.join(built, 'output'), ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture-request-token',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example.test/token?request=1',
      ['CINDY_PLUGIN_PLATFORM_URL_' + region]: 'https://platform.example.test/publish',
      DELIVERED_PACKAGE: path.join(fixture, region + '-delivered.cindy') };
    const run = (name, cwd = build) => execFileSync('bash', ['-e', '-o', 'pipefail', '-c', script(workflow, name)], { cwd, env, encoding: 'utf8', stdio: 'pipe' });
    run('Package plugin');
    run('Record package identity');
    const recorded = readFileSync(env.GITHUB_OUTPUT, 'utf8');
    // Model upload/download artifact hand-off into a job without a checkout.
    for (const name of ['plugin.cindy', 'plugin.cindy.sha256', 'commit.txt', 'plugin.txt']) {
      cpSync(path.join(built, name), path.join(publish, name));
    }
    env.RUNNER_TEMP = publish;
    env.GITHUB_OUTPUT = path.join(publish, 'output');
    run("Select this run's package", publish);
    assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), recorded);
    run('Verify package identity', publish);
    run('Publish plugin', publish);
    assert.deepEqual(readFileSync(env.DELIVERED_PACKAGE), readFileSync(path.join(built, 'plugin.cindy')));
    for (const [file, bad] of [['commit.txt', 'wrong-commit'], ['plugin.txt', 'wrong-plugin'], ['plugin.cindy', 'corrupt-package'], ['plugin.cindy.sha256', 'invalid-digest']]) {
      const target = path.join(publish, file);
      const original = readFileSync(target);
      writeFileSync(target, bad);
      assert.throws(() => run('Verify package identity', publish), undefined, file + ' must reject mismatches');
      writeFileSync(target, original);
    }
  }
});
