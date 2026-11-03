/**
 * /pr pre-push checks in a throwaway Git repository (no network). The rules must hold in any
 * repository: DCO is checked only when the repository declares it, merge commits are skipped
 * as the DCO check skips them, and the default branch is never a PR source.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { preflight } from '../../cindy-github/skills/pr/scripts/pr-preflight.mjs';

function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git'), work = path.join(root, 'work');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, work);
  for (const [k, v] of [['user.name', 'Ada'], ['user.email', 'ada@example.com'], ['commit.gpgsign', 'false']]) git(work, 'config', k, v);
  const commit = (file, ...flags) => { fs.writeFileSync(path.join(work, file), file); git(work, 'add', file); git(work, 'commit', '-q', ...flags, '-m', file); };
  commit('README.md');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'remote', 'set-head', 'origin', 'main');
  return { work, git, commit };
}

test('blocks the default branch, checks DCO only when declared, and skips merge commits', (t) => {
  const { work, git, commit } = repo(t);
  assert.match(preflight(work).blocks.join('\n'), /default branch main/);

  git(work, 'checkout', '-q', '-b', 'fix');
  commit('a.txt');
  assert.deepEqual(preflight(work).blocks, [], 'no DCO file: unsigned commits are fine');

  fs.writeFileSync(path.join(work, 'DCO'), 'dco');
  git(work, 'add', 'DCO');
  git(work, 'commit', '-q', '-s', '-m', 'dco');
  assert.match(preflight(work).blocks.join('\n'), /DCO sign-off.*: [0-9a-f]{8}\./, 'the unsigned a.txt commit');

  git(work, 'reset', '-q', '--hard', 'origin/main');
  fs.writeFileSync(path.join(work, 'DCO'), 'dco');
  git(work, 'add', 'DCO');
  git(work, 'commit', '-q', '-s', '-m', 'dco');
  git(work, 'checkout', '-q', '-b', 'side', 'origin/main');
  commit('b.txt', '-s');
  git(work, 'checkout', '-q', 'fix');
  git(work, 'merge', '-q', '--no-ff', '--no-edit', 'side');
  const result = preflight(work);
  assert.deepEqual(result.blocks, [], 'a merge commit needs no sign-off');
  assert.ok(result.notes.some((n) => /not pushed/.test(n)));
});

test('runs when launched directly from a path with spaces and non-ASCII characters', (t) => {
  const { work, git } = repo(t);
  git(work, 'checkout', '-q', '-b', 'fix');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr skill 目录 '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'pr-preflight.mjs');
  fs.copyFileSync(new URL('../../cindy-github/skills/pr/scripts/pr-preflight.mjs', import.meta.url), script);
  const out = execFileSync('node', [script, work, '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(out).branch, 'fix', 'the check must print its result, not exit silently');
});

test('accepts a remediation commit only where the repository allows it, for that author and sha', (t) => {
  const { work, git, commit } = repo(t);
  git(work, 'checkout', '-q', '-b', 'fix');
  commit('a.txt');
  const unsigned = git(work, 'rev-parse', 'HEAD').trim();
  const remediate = (sha, name = 'Ada', email = 'ada@example.com') => git(work, 'commit', '-q', '--allow-empty', '-s', '-m',
    `remediation\n\nI, ${name} <${email}>, hereby add my Signed-off-by to this commit: ${sha}`);

  fs.mkdirSync(path.join(work, '.github'));
  fs.writeFileSync(path.join(work, '.github', 'dco.yml'), 'allowRemediationCommits:\n  individual: true\n');
  git(work, 'add', '.github');
  git(work, 'commit', '-q', '-s', '-m', 'dco config');
  remediate('0'.repeat(40));
  assert.match(preflight(work).blocks.join('\n'), new RegExp(unsigned.slice(0, 8)), 'a line naming another sha does not count');
  remediate(unsigned, 'Ada', 'other@example.com');
  assert.match(preflight(work).blocks.join('\n'), new RegExp(unsigned.slice(0, 8)), 'a line naming another author does not count');
  remediate(unsigned);
  assert.deepEqual(preflight(work).blocks, [], 'the allowed remediation signs the old commit off');

  fs.writeFileSync(path.join(work, '.github', 'dco.yml'), 'require:\n  members: true\n');
  git(work, 'commit', '-q', '-a', '-s', '-m', 'dco config without remediation');
  assert.match(preflight(work).blocks.join('\n'), new RegExp(unsigned.slice(0, 8)), 'not allowed by this repository');
});

test('remediation follows the repository policy and the identities on the line', (t) => {
  const scenario = ({ yaml, line, by = ['Ada', 'ada@example.com'] }) => {
    const { work, git, commit } = repo(t);
    git(work, 'checkout', '-q', '-b', 'fix');
    commit('a.txt');
    const unsigned = git(work, 'rev-parse', 'HEAD').trim();
    fs.mkdirSync(path.join(work, '.github'), { recursive: true });
    fs.writeFileSync(path.join(work, '.github', 'dco.yml'), yaml);
    git(work, 'add', '.github');
    git(work, 'commit', '-q', '-s', '-m', 'dco policy');
    git(work, 'config', 'user.name', by[0]);
    git(work, 'config', 'user.email', by[1]);
    git(work, 'commit', '-q', '--allow-empty', '-s', '-m', `remediation\n\n${line(unsigned)}`);
    return !new RegExp(unsigned.slice(0, 8)).test(preflight(work).blocks.join('\n'));
  };
  const own = (sha) => `I, Ada <ada@example.com>, hereby add my Signed-off-by to this commit: ${sha}`;
  const behalf = (sha) => `On behalf of Ada <ada@example.com>, I, Bob <bob@example.com>, hereby add my Signed-off-by to this commit: ${sha}`;
  const both = 'allowRemediationCommits:\n  individual: true\n  thirdParty: true\n';

  assert.equal(scenario({ yaml: both, line: own }), true, 'baseline: allowed, own statement');
  assert.equal(scenario({ yaml: 'allowRemediationCommits:\n  individual: false\n  thirdParty: false\n', line: own }), false, 'switched off');
  assert.equal(scenario({ yaml: 'allowRemediationCommits: false\n', line: own }), false, 'switched off inline');
  assert.equal(scenario({ yaml: both, line: own, by: ['Bob', 'bob@example.com'] }), false, 'Bob signing Ada\'s statement himself');
  assert.equal(scenario({ yaml: 'allowRemediationCommits:\n  individual: true\n  thirdParty: false\n', line: behalf, by: ['Bob', 'bob@example.com'] }), false, 'third party switched off');
  assert.equal(scenario({ yaml: both, line: behalf, by: ['Bob', 'bob@example.com'] }), true, 'third party allowed');
});

test('compares against the base branch of a PR that does not target the default branch', (t) => {
  const { work, git, commit } = repo(t);
  git(work, 'checkout', '-q', '-b', 'release');
  commit('release.txt');
  git(work, 'push', '-q', 'origin', 'release');
  git(work, 'checkout', '-q', '-b', 'feature');
  commit('feature.txt');
  const against = (options) => preflight(work, options);
  assert.match(against({ base: 'release' }).notes.join('\n'), /1 commit|not pushed/, 'one commit beyond origin/release');
  assert.equal(against({ base: 'release' }).base, 'release');
  assert.equal(against({}).base, 'main');
  assert.match(against({ base: 'nope' }).error, /origin\/nope does not exist/);
  const out = execFileSync('node', [fileURLToPath(new URL('../../cindy-github/skills/pr/scripts/pr-preflight.mjs', import.meta.url)), work, '--base', 'release', '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(out).base, 'release');
});

test('still refuses to start from the default branch when the PR targets another branch', (t) => {
  const { work, git } = repo(t);
  git(work, 'checkout', '-q', '-b', 'release');
  git(work, 'push', '-q', 'origin', 'release');
  git(work, 'checkout', '-q', 'main');
  assert.match(preflight(work, { base: 'release' }).blocks.join('\n'), /default branch main/);
  git(work, 'checkout', '-q', 'release');
  assert.match(preflight(work, { base: 'release' }).blocks.join('\n'), /default branch release/);
});
