// Trusted release helper. Never imports or executes extension/dependency code.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function compareVersions(a, b) {
  const parts = value => {
    if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(value)) throw new Error('Invalid Chrome version');
    const numbers = value.split('.').map(Number);
    if (numbers.some(n => n > 65535) || numbers.every(n => n === 0)) throw new Error('Invalid Chrome version');
    return [...numbers, ...Array(4 - numbers.length).fill(0)];
  };
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 4; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

export function validateVersionChange(before, after, files) {
  const packageChanged = files.some(file => file.startsWith('my-browser/extension/') || [
    'my-browser/binary-dependencies.json', 'my-browser/THIRD-PARTY-LICENSES.txt', 'scripts/build-my-browser.mjs',
    '.github/scripts/package-plugin.sh', '.github/scripts/binary-dependencies.py',
  ].includes(file));
  if (packageChanged && compareVersions(after, before) <= 0) {
    throw new Error('Chrome package changed: bump my-browser/extension/manifest.json version above the base branch');
  }
}

function versions(revision) {
  const values = revision?.distributionChannels?.map(channel => channel.crxVersion);
  if (!values?.length) throw new Error('Store revision has no version; inspect the developer dashboard');
  for (const value of values) compareVersions(value, value);
  return values;
}

export function plan(status, version) {
  compareVersions(version, version);
  if (status.takenDown || status.warned) throw new Error('Store warning or takedown requires dashboard review');
  const published = status.publishedItemRevisionStatus;
  if (published && versions(published).some(v => compareVersions(v, version) >= 0)) {
    return {publish: false, reason: 'This version or a newer version is already published'};
  }
  const submitted = status.submittedItemRevisionStatus;
  if (submitted) {
    const current = versions(submitted);
    switch (submitted.state) {
      case 'PENDING_REVIEW':
        return {publish: false, reason: 'A review is pending; a later scheduled run will check again'};
      case 'PUBLISHED':
      case 'PUBLISHED_TO_TESTERS':
        if (current.some(v => compareVersions(v, version) >= 0)) return {publish: false, reason: 'Version already submitted/published'};
        break;
      case 'STAGED':
        throw new Error('A staged release requires an explicit dashboard decision');
      case 'REJECTED':
      case 'CANCELLED':
        if (current.some(v => compareVersions(v, version) >= 0)) throw new Error('Rejected/cancelled version requires a fix and a version bump');
        break;
      default:
        throw new Error('Unrecognized submitted revision state');
    }
  }
  if (['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(status.lastAsyncUploadState)) {
    return {publish: false, reason: 'Another upload is still processing'};
  }
  return {publish: true, reason: 'A newer extension version is ready'};
}

export function createClient({publisher, item, token, fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  if (!/^[a-zA-Z0-9-]+$/.test(publisher) || !/^[a-p]{32}$/.test(item) || !token) throw new Error('Missing/invalid Chrome Web Store configuration');
  const name = `publishers/${publisher}/items/${item}`;
  const origin = 'https://chromewebstore.googleapis.com';
  async function request(path, method = 'GET', body, contentType = 'application/json') {
    let response;
    try {
      response = await fetcher(`${origin}/${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(120_000),
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': contentType}, body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (data.name !== name || data.itemId !== item) throw new Error('Store response identity mismatch');
      return data;
    } catch (error) {
      // Do not echo remote bodies or credentials, and never blindly retry writes.
      const detail = /^HTTP \d+$/.test(error.message) ? error.message : 'transport or response validation failure';
      throw new Error(`${method} ${path.split(':').at(-1)}: ${detail}. ${method === 'GET' ? 'Read failed; earlier writes, if any, may have completed. Inspect the dashboard before retrying.' : 'Outcome may be unknown; inspect the dashboard before retrying.'}`);
    }
  }
  const status = () => request(`v2/${name}:fetchStatus`);
  async function publish(zip, version) {
    const decision = plan(await status(), version);
    if (!decision.publish) return decision;
    const uploaded = await request(`upload/v2/${name}:upload`, 'POST', zip, 'application/zip');
    let uploadState = uploaded.uploadState;
    if (uploaded.crxVersion && uploaded.crxVersion !== version) throw new Error('Uploaded version mismatch; review was not requested');
    for (let n = 0; ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(uploadState) && n < 30; n++) {
      await sleep(10_000);
      uploadState = (await status()).lastAsyncUploadState;
    }
    if (uploadState !== 'SUCCEEDED') throw new Error(`Upload did not finish successfully (${uploadState}); review was not requested`);
    const result = await request(`v2/${name}:publish`, 'POST', JSON.stringify({
      publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true,
    }));
    if (!['PENDING_REVIEW', 'PUBLISHED'].includes(result.state)) throw new Error('Publish did not return an accepted review/publication state; inspect the dashboard');
    // A successful publish response alone does not prove the intended version.
    for (let n = 0; n < 6; n++) {
      const current = await status();
      const revisions = [current.submittedItemRevisionStatus, current.publishedItemRevisionStatus];
      if (revisions.some(r => r && ['PENDING_REVIEW', 'PUBLISHED'].includes(r.state) && versions(r).includes(version))) {
        return {publish: true, reason: `Version ${version}: ${result.state}; automatic publication after approval`};
      }
      await sleep(5_000);
    }
    throw new Error('Publish accepted but version readback is not confirmed; inspect the dashboard before retrying');
  }
  return {status, publish};
}

export async function validateArtifact(directory, {sha, version}) {
  const receipt = JSON.parse(await fs.readFile(`${directory}/source.json`, 'utf8'));
  const zip = await fs.readFile(`${directory}/extension.zip`);
  if (receipt.sha !== sha || receipt.version !== version || receipt.sha256 !== createHash('sha256').update(zip).digest('hex')) {
    throw new Error('Artifact source/version/hash mismatch');
  }
  const entries = execFileSync('unzip', ['-Z1', `${directory}/extension.zip`], {encoding: 'utf8'}).trim().split('\n');
  if (entries.filter(entry => entry === 'manifest.json').length !== 1) throw new Error('Artifact must contain exactly one root manifest');
  const manifest = JSON.parse(execFileSync('unzip', ['-p', `${directory}/extension.zip`, 'manifest.json'], {encoding: 'utf8'}));
  if (manifest.version !== version || 'key' in manifest) throw new Error('Artifact manifest version/key mismatch');
  return zip;
}

async function main() {
  const [command, directory] = process.argv.slice(2);
  if (!['check', 'receipt', 'publish', 'validate-version'].includes(command)) throw new Error('Usage: chrome-webstore.mjs check|receipt|publish|validate-version [directory|base-sha]');
  const version = JSON.parse(await fs.readFile('my-browser/extension/manifest.json', 'utf8')).version;
  compareVersions(version, version);
  if (command === 'validate-version') {
    if (!/^[a-f0-9]{40}$/.test(directory || '')) throw new Error('Expected full base commit SHA');
    const before = JSON.parse(execFileSync('git', ['show', `${directory}:my-browser/extension/manifest.json`], {encoding: 'utf8'})).version;
    const files = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', directory, 'HEAD'], {encoding: 'utf8'}).split('\0');
    validateVersionChange(before, version, files);
    console.log('Chrome extension version gate passed');
    return;
  }
  const sha = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Missing source commit');
  if (command === 'receipt') {
    await fs.copyFile(`${directory}/my-browser-chrome-${version}.zip`, `${directory}/extension.zip`);
    const zip = await fs.readFile(`${directory}/extension.zip`);
    await fs.writeFile(`${directory}/source.json`, JSON.stringify({sha, version, sha256: createHash('sha256').update(zip).digest('hex')}) + '\n');
    await validateArtifact(directory, {sha, version});
    return;
  }
  const distribution = JSON.parse(await fs.readFile('my-browser/distribution.json', 'utf8'));
  if (distribution.chrome.extensionId !== process.env.CWS_EXTENSION_ID) throw new Error('Configured extension differs from distribution.json');
  // Validate the package before using the credential or making any API request.
  const zip = command === 'publish' ? await validateArtifact(directory, {sha, version}) : undefined;
  const client = createClient({publisher: process.env.CWS_PUBLISHER_ID, item: process.env.CWS_EXTENSION_ID, token: process.env.CWS_ACCESS_TOKEN});
  const result = command === 'check' ? plan(await client.status(), version) : await client.publish(zip, version);
  console.log(result.reason);
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `publish=${result.publish}\nversion=${version}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `Chrome Web Store: ${result.reason}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
