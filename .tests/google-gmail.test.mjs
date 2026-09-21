import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const plugins = { 'google-gmail': 'gmail' };

for (const [id, prefix] of Object.entries(plugins)) {
  test(`${id}: gog parameters are visible through the Cindy tool contract`, () => {
    const manifest = JSON.parse(readFileSync(new URL(`../${id}/ghost.json`, import.meta.url), 'utf8'));
    assert.equal(manifest.schemaVersion, 3);
    assert.equal(manifest.minCindyVersion, '0.1.82');
    assert.equal(Object.hasOwn(manifest, 'slots'), false);
    assert.equal(manifest.sessionContext, true);
    const secret = manifest.network.secrets.find(secret => secret.source === 'oauth');
    assert.equal(secret.oauth.clientId, '948713214926-onmd8lp4prlfl78qppbfjpl568mc504r.apps.googleusercontent.com');
    assert.equal(manifest.node.secretBindings[0].oauthSecret, secret.key);
    assert.deepEqual(secret.oauth.scopes, ['openid', 'https://www.googleapis.com/auth/userinfo.email',
      ...(id === 'google-gmail' ? ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']
        : ['https://www.googleapis.com/auth/' + (id === 'google-calendar' ? 'calendar' : 'drive')])]);
    // ghost_info projects only name, description and parameters to the model.
    const tools = manifest.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
    const schema = tools.find(tool => tool.name === `${prefix}_schema`);
    const run = tools.find(tool => tool.name === `${prefix}_run`);
    assert.equal(schema.parameters.properties.command.type, 'array');
    assert.deepEqual(Object.keys(run.parameters.properties).sort(), ['account', 'arguments', 'command', 'options']);
    assert.deepEqual(run.parameters.required, ['command']);
    assert.equal(run.parameters.additionalProperties, false);
    assert.equal(run.parameters.properties.arguments.items.type, 'string');
    for (const name of [`${prefix}_schema`, `${prefix}_run`]) {
      assert.equal(Object.hasOwn(manifest.tools.find(tool => tool.name === name), 'inputSchema'), false);
    }
    assert.deepEqual(tools.map(tool => tool.name), [`${prefix}_schema`, `${prefix}_run`, `${prefix}_accounts`]);
    const main = readFileSync(new URL(`../${id}/main.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(main, /cindy\.fetch|async function api\(|https:\/\/.*googleapis\.com/);
    assert.match(main, /cindy\.node\.request/);
    assert.match(run.parameters.properties.account.description, /Multiple accounts require an explicit choice/);
  });
}

import './google-gmail-accounts.test.mjs';
import './google-gmail-worker.test.mjs';
import './google-gmail-packaging.test.mjs';
