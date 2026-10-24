import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const plugins = { 'google-gmail': 'gmail' };

for (const [id, prefix] of Object.entries(plugins)) {
  test(`${id}: gog parameters are visible through the Cindy tool contract`, () => {
    const manifest = JSON.parse(readFileSync(new URL(`../${id}/ghost.json`, import.meta.url), 'utf8'));
    assert.equal(manifest.schemaVersion, 3);
    // Cindy 0.1.112 is the first released client with the shared mail flow
    // and native reader from makecindy/cindy#6404.
    assert.equal(manifest.minCindyVersion, '0.1.112');
    assert.equal(Object.hasOwn(manifest, 'slots'), false);
    assert.equal(manifest.sessionContext, true);
    const secret = manifest.network.secrets.find(secret => secret.source === 'oauth');
    assert.equal(secret.oauth.clientId, '948713214926-onmd8lp4prlfl78qppbfjpl568mc504r.apps.googleusercontent.com');
    assert.equal(manifest.node.secretBindings[0].oauthSecret, secret.key);
    assert.deepEqual(secret.oauth.scopes, ['openid', 'https://www.googleapis.com/auth/userinfo.email',
      ...(id === 'google-gmail' ? ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.modify']
        : ['https://www.googleapis.com/auth/' + (id === 'google-calendar' ? 'calendar' : 'drive')]),
      'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/contacts',
      'https://www.googleapis.com/auth/contacts.other.readonly', 'https://www.googleapis.com/auth/directory.readonly']);
    assert.equal(secret.oauth.identity.avatarPath, 'picture');
    assert.ok(secret.inject.hosts.includes('people.googleapis.com'));
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
    assert.deepEqual(tools.map(tool => tool.name), [`${prefix}_read_message`, `${prefix}_schema`, `${prefix}_run`, `${prefix}_accounts`, `${prefix}_contacts`]);
    const reader = tools.find(tool => tool.name === manifest.mailReader.tool);
    assert.equal(reader.parameters.properties.url.type, 'string');
    assert.deepEqual(reader.parameters.required, ['url']);
    assert.equal(reader.parameters.additionalProperties, false);
    const main = readFileSync(new URL(`../${id}/main.js`, import.meta.url), 'utf8');
    // Host-managed attachment preview fetches are allowed; credentials remain
    // Host-owned. The compose tests verify the selected authAccount at runtime.
    assert.doesNotMatch(main, /gog_access_token|Bearer\s|Authorization\s*:/);
    assert.match(main, /cindy\.node\.request/);
    assert.match(run.parameters.properties.account.description, /Multiple accounts require an explicit choice/);
  });
}

import './google-gmail-accounts.test.mjs';
import './google-gmail-worker.test.mjs';
import './google-gmail-packaging.test.mjs';
import './google-gmail-compose.test.mjs';
import './google-gmail-contacts.test.mjs';
