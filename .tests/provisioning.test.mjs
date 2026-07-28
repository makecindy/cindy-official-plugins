import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const pluginDirs = fs.readdirSync(root)
  .filter((name) => fs.existsSync(path.join(root, name, 'ghost.json')))
  .sort();
const provisioning = JSON.parse(
  fs.readFileSync(path.join(root, 'provisioning.json'), 'utf8'),
);

// The host treats an unregistered seed (and today also a missing `audience`)
// as "install for everyone". These tests pin the safe direction at merge time:
// every plugin must be registered explicitly, and an explicit audience must
// always parse to "install for no one" or "install for someone named" — never
// silently to "everyone".
const matchesAudience = (rule, identity) => {
  if (rule === 'all') return true;
  if (typeof rule !== 'object' || rule === null) return false;
  if (identity === null) return false;
  if (Array.isArray(rule.userIds) && rule.userIds.includes(identity.userId)) return true;
  if (Array.isArray(rule.emails) && identity.email !== null) {
    const emailFold = identity.email.toLowerCase();
    if (rule.emails.some((e) => typeof e === 'string' && e.toLowerCase() === emailFold)) {
      return true;
    }
  }
  return false;
};

test('every official plugin is registered in provisioning.json with an explicit audience', () => {
  assert.ok(pluginDirs.length > 0, 'no official plugins found');
  assert.ok(
    provisioning.ghosts && typeof provisioning.ghosts === 'object',
    'provisioning.json is missing the "ghosts" map',
  );
  for (const pluginDir of pluginDirs) {
    const entry = provisioning.ghosts[pluginDir];
    assert.ok(
      entry && typeof entry === 'object',
      `${pluginDir} is not registered in provisioning.json — merging it would ` +
        'seed the plugin to every user. Register it with an explicit ' +
        '"audience" ("all", or { "userIds": [...], "emails": [...] } for a ' +
        'staged rollout; both lists may be empty to stage the merge without ' +
        'installing for anyone).',
    );
    assert.ok(
      Object.hasOwn(entry, 'audience'),
      `${pluginDir} is registered without an "audience" field — the host ` +
        'currently defaults a missing audience to "all". Spell the audience ' +
        'out explicitly.',
    );
    if (Object.hasOwn(entry, 'tier')) {
      assert.ok(
        entry.tier === 'builtin' || entry.tier === 'enterprise',
        `${pluginDir} has an unknown tier ${JSON.stringify(entry.tier)}`,
      );
    }
  }
});

test('no registered audience is a dead rule', () => {
  const namedIdentity = { userId: 'u-any', email: 'someone@example.com' };
  for (const [pluginDir, entry] of Object.entries(provisioning.ghosts)) {
    const rule = entry?.audience;
    if (rule === undefined) continue; // reported by the registration test above
    assert.ok(
      rule === 'all' ||
        (typeof rule === 'object' && rule !== null && !Array.isArray(rule)) ||
        typeof rule === 'string',
      `${pluginDir}: audience must be "all" or { userIds, emails }, got ${JSON.stringify(rule)}`,
    );
    if (typeof rule === 'string') {
      assert.equal(
        rule,
        'all',
        `${pluginDir}: audience ${JSON.stringify(rule)} never matches anyone ` +
          '— the only supported string is "all"',
      );
    }
    if (typeof rule === 'object' && rule !== null && !Array.isArray(rule)) {
      assert.ok(
        Array.isArray(rule.userIds) || Array.isArray(rule.emails),
        `${pluginDir}: audience object has neither a userIds nor an emails ` +
          'list — it never matches anyone',
      );
      const total =
        (Array.isArray(rule.userIds) ? rule.userIds.length : 0) +
        (Array.isArray(rule.emails) ? rule.emails.length : 0);
      if (total === 0) continue; // deliberate empty audience: staged, matches no one
      assert.ok(
        matchesAudience(rule, namedIdentity) ||
          matchesAudience(rule, { userId: rule.userIds?.[0] ?? 'u-none', email: rule.emails?.[0] ?? null }),
        `${pluginDir}: audience lists are populated but never match`,
      );
    }
  }
});

test('stale provisioning entries point at real plugin directories', () => {
  for (const pluginDir of Object.keys(provisioning.ghosts)) {
    assert.ok(
      pluginDirs.includes(pluginDir),
      `provisioning.json registers "${pluginDir}", which has no ghost.json ` +
        'in this repository — remove the stale entry',
    );
  }
});
