import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import retention from '../../dsh-acp/cli-retention.cjs';

test('retention protects running, active and concurrently published installs and handles older layouts', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-retention-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const makeInstall = async (name = '@deepseek-ai/dsh') => {
    const id = randomUUID();
    const pkg = path.join(root, id, 'node_modules', '@deepseek-ai', 'dsh');
    await fs.mkdir(pkg, { recursive: true });
    await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name }));
    return id;
  };
  const [previous, active, legacy, unrelated] = await Promise.all([
    makeInstall(), makeInstall(), makeInstall(), makeInstall('example'),
  ]);
  const marker = path.join(root, 'current.json');
  await fs.writeFile(marker, JSON.stringify({ id: previous, node: process.execPath }));
  await retention.pruneRetired(root);
  const first = randomUUID(), second = randomUUID();
  const older = await retention.installIds(root);
  await fs.writeFile(marker, JSON.stringify({ id: active, boot: first, older }));
  const publishing = await makeInstall();
  await retention.pruneRetired(root, async () => first);
  await retention.pruneRetired(root, async () => '');
  for (const id of [previous, legacy]) await fs.access(path.join(root, id, 'node_modules'));
  await retention.pruneRetired(root, async () => second);
  for (const id of [previous, legacy]) await assert.rejects(fs.access(path.join(root, id)), { code: 'ENOENT' });
  for (const id of [active, publishing, unrelated]) await fs.access(path.join(root, id, 'node_modules'));
});
