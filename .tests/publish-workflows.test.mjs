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

test('CN and Global plugin publishers are operationally independent', () => {
  assert.match(cnWorkflow, /^name: Publish Cindy Plugins \(CN\)$/m);
  assert.match(globalWorkflow, /^name: Publish Cindy Plugins \(Global\)$/m);
  assert.match(cnWorkflow, /group: cindy-plugin-publish-\$\{\{.*inputs\.deployment.*cn-prod/);
  assert.match(globalWorkflow, /group: cindy-plugin-publish-global-prod-/);

  assert.match(cnWorkflow, /CINDY_PLUGIN_SERVER_URL_CN/);
  assert.doesNotMatch(cnWorkflow, /CINDY_PLUGIN_SERVER_URL_GLOBAL/);
  assert.match(globalWorkflow, /CINDY_PLUGIN_SERVER_URL_GLOBAL/);
  assert.doesNotMatch(globalWorkflow, /CINDY_PLUGIN_SERVER_URL_CN/);
});

test('both regional publishers support main pushes and full manual republish', () => {
  for (const workflow of [cnWorkflow, globalWorkflow]) {
    assert.match(workflow, /push:\n    branches:\n      - main/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /(?:process\.env\.EVENT_NAME|eventName) === 'workflow_dispatch'/);
    assert.match(workflow, /Publishing all Cindy plugins:/);
    assert.match(workflow, /id-token: write/);
    assert.match(workflow, /audience=cindy-plugin/);
  }
  assert.match(globalWorkflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(
    cnWorkflow,
    /if: github\.event_name == 'workflow_dispatch' \|\| github\.ref == 'refs\/heads\/main'/,
  );
});

test('CN publisher has an isolated single-plugin dev validation path', () => {
  assert.match(cnWorkflow, /deployment:/);
  assert.match(cnWorkflow, /plugin_directory:/);
  assert.match(cnWorkflow, /plugin_directory is required for dev publishing/);
  assert.match(cnWorkflow, /Manual production publishing is only supported from main/);
  assert.match(
    cnWorkflow,
    /https:\/\/platform-dev\.cindy\.com\.cn\/api\/platform\/v1\/plugin-publish\/publish/,
  );
  assert.doesNotMatch(globalWorkflow, /platform-dev\.cindy\.com\.cn/);
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
