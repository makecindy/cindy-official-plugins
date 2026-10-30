import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {compareVersions, validateVersionChange, plan, createClient, validateArtifact} from '../.github/scripts/chrome-webstore.mjs';

const item = 'a'.repeat(32), publisher = 'example-publisher';
const identity = {name: `publishers/${publisher}/items/${item}`, itemId: item};
const revision = (version, state = 'PUBLISHED') => ({state, distributionChannels: [{crxVersion: version}]});
const published = {publishedItemRevisionStatus: revision('0.4.22')};
function mock(responses) {
  const calls = [];
  const client = createClient({publisher, item, token: 'test-only', sleep: async () => {}, fetcher: async (url, options) => {
    calls.push({url, ...options});
    assert.equal(new URL(url).hostname, 'chromewebstore.googleapis.com');
    assert.equal(options.redirect, 'error');
    const next = responses.shift();
    assert.ok(next, 'Unexpected extra API request');
    if (next instanceof Error) throw next;
    return {ok: true, json: async () => ({...identity, ...next})};
  }});
  return {client, calls};
}

test('numeric Chrome versions; do not downgrade or duplicate a release', () => {
  assert.equal(compareVersions('0.4.100', '0.4.60'), 1);
  assert.equal(compareVersions('1.2', '1.2.0.0'), 0);
  for (const version of ['1.2-beta', '1.02', '1.65536', '0', '1.2.3.4.5', undefined]) assert.throws(() => compareVersions(version, '1'));
  assert.equal(plan(published, '0.4.60').publish, true);
  assert.equal(plan(published, '0.4.22').publish, false);
  assert.equal(plan(published, '0.4.21').publish, false);
});

test('package changes require a higher Chrome version; plugin-only changes do not', () => {
  for (const file of ['my-browser/extension/background.js', 'my-browser/extension/manifest.json', 'my-browser/binary-dependencies.json', 'my-browser/THIRD-PARTY-LICENSES.txt', 'scripts/build-my-browser.mjs', '.github/scripts/package-plugin.sh', '.github/scripts/binary-dependencies.py']) {
    assert.throws(() => validateVersionChange('0.4.60', '0.4.60', [file]), /bump/);
    assert.throws(() => validateVersionChange('0.4.60', '0.4.59', [file]), /bump/);
    assert.doesNotThrow(() => validateVersionChange('0.4.60', '0.4.61', [file]));
  }
  assert.doesNotThrow(() => validateVersionChange('0.4.60', '0.4.60', ['my-browser/ghost.json', 'my-browser/README.md', '.github/scripts/chrome-webstore.mjs']));
});

test('transitive dependency packagers also trigger Chrome publishing on main', async () => {
  const workflow = await fs.readFile(new URL('../.github/workflows/publish-chrome-extension.yml', import.meta.url), 'utf8');
  const pushPaths = workflow.split('    paths:\n')[1].split('  workflow_dispatch:')[0];
  for (const file of ['.github/scripts/package-plugin.sh', '.github/scripts/binary-dependencies.py']) {
    assert.ok(pushPaths.includes(`      - '${file}'\n`), `${file} must trigger a store version check`);
  }
});

test('pending reviews defer newer versions; staged/rejected/cancelled submissions stay under human control', () => {
  for (const version of ['0.4.30', '0.4.60', '0.4.80']) {
    assert.equal(plan({...published, submittedItemRevisionStatus: revision(version, 'PENDING_REVIEW')}, '0.4.60').publish, false);
  }
  for (const state of ['STAGED', 'REJECTED', 'CANCELLED', 'UNKNOWN']) {
    assert.throws(() => plan({...published, submittedItemRevisionStatus: revision('0.4.60', state)}, '0.4.60'));
  }
  assert.equal(plan({...published, submittedItemRevisionStatus: revision('0.4.59', 'REJECTED')}, '0.4.60').publish, true);
  assert.throws(() => plan({...published, warned: true}, '0.4.60'));
  assert.throws(() => plan({publishedItemRevisionStatus: {state: 'PUBLISHED'}}, '0.4.60'));
});

test('async upload completes before submission, then verifies the submitted version', async () => {
  const {client, calls} = mock([published, {uploadState: 'IN_PROGRESS'}, {lastAsyncUploadState: 'SUCCEEDED'}, {state: 'PENDING_REVIEW'}, {...published, submittedItemRevisionStatus: revision('0.4.60', 'PENDING_REVIEW')}]);
  assert.equal((await client.publish(Buffer.from('zip'), '0.4.60')).publish, true);
  const writes = calls.filter(call => call.method === 'POST');
  assert.equal(writes.length, 2);
  assert.match(writes[0].url, /\/upload\/v2\//);
  assert.deepEqual(JSON.parse(writes[1].body), {publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true});
});

test('status is rechecked before upload; a competing review prevents writes', async () => {
  const {client, calls} = mock([{...published, submittedItemRevisionStatus: revision('0.4.59', 'PENDING_REVIEW')}]);
  assert.equal((await client.publish(Buffer.from('zip'), '0.4.60')).publish, false);
  assert.equal(calls.length, 1);
});

test('failed, timed out, or mismatched uploads never request publication', async () => {
  for (const reply of [{uploadState: 'FAILED'}, {uploadState: 'SUCCEEDED', crxVersion: '9.0'}, new Error('Connection lost')]) {
    const {client, calls} = mock([published, reply]);
    await assert.rejects(client.publish(Buffer.from('zip'), '0.4.60'));
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  }
});

test('unknown publish outcome is not retried; credentials/remote bodies stay out of errors', async () => {
  const {client, calls} = mock([published, {uploadState: 'SUCCEEDED', crxVersion: '0.4.60'}, new Error('secret remote content')]);
  await assert.rejects(client.publish(Buffer.from('zip'), '0.4.60'), error => /Outcome may be unknown/.test(error.message) && !/secret/.test(error.message));
  assert.equal(calls.filter(call => call.method === 'POST').length, 2);
});

test('wrong identity fails before upload', async () => {
  const {client, calls} = mock([{...published, itemId: 'b'.repeat(32)}]);
  await assert.rejects(client.publish(Buffer.from('zip'), '0.4.60'));
  assert.equal(calls.length, 1);
});

test('an upload still processing after the polling limit is never published', async () => {
  const {client, calls} = mock([published, {uploadState: 'IN_PROGRESS'}, ...Array(30).fill({lastAsyncUploadState: 'IN_PROGRESS'})]);
  await assert.rejects(client.publish(Buffer.from('zip'), '0.4.60'), /review was not requested/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('a failed read after publication does not claim no side effect occurred', async () => {
  const {client} = mock([published, {uploadState: 'SUCCEEDED'}, {state: 'PENDING_REVIEW'}, new Error('Network failed')]);
  await assert.rejects(client.publish(Buffer.from('zip'), '0.4.60'), /earlier writes, if any, may have completed/);
});

test('publish acceptance without matching version readback is not success', async () => {
  const {client} = mock([published, {uploadState: 'SUCCEEDED'}, {state: 'PENDING_REVIEW'}, ...Array(6).fill(published)]);
  await assert.rejects(client.publish(Buffer.from('zip'), '0.4.60'), /readback is not confirmed/);
});

test('artifact validates source, digest and actual ZIP manifest before API use', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cws-test-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({manifest_version: 3, version: '1.2.3'}));
  execFileSync('zip', ['-q', 'extension.zip', 'manifest.json'], {cwd: directory});
  const zip = await fs.readFile(path.join(directory, 'extension.zip'));
  const receipt = {sha: 'a'.repeat(40), version: '1.2.3', sha256: createHash('sha256').update(zip).digest('hex')};
  await fs.writeFile(path.join(directory, 'source.json'), JSON.stringify(receipt));
  assert.deepEqual(await validateArtifact(directory, receipt), zip);
  await assert.rejects(validateArtifact(directory, {...receipt, sha: 'b'.repeat(40)}), /mismatch/);
  await assert.rejects(validateArtifact(directory, {...receipt, version: '1.2.4'}), /mismatch/);
  await fs.appendFile(path.join(directory, 'extension.zip'), 'tampered');
  await assert.rejects(validateArtifact(directory, receipt), /mismatch/);
});
