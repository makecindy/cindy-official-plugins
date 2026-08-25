import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
