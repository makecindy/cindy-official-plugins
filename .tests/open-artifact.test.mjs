import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../open-artifact/main.js', import.meta.url), 'utf8');

function harness({ accepted = true } = {}) {
  let onMessage;
  const calls = [];
  const cindy = {
    onHostMessage(fn) { onMessage = fn; },
    async send(frame) { calls.push(['result', frame]); },
    async preview(args) { calls.push(['preview', args]); return { ok: true }; },
    targets: {
      async resolve({ session }) { return { kind: 'task', id: session }; },
      async send(args) { calls.push(['send', args]); return { accepted }; },
    },
    node: {
      async request(frame) {
        calls.push(['node', frame]);
        if (frame.method === 'artifact/call') {
          await onMessage({
            type: 'event', name: 'node-notification', method: 'artifact/open',
            params: { id: 'open-one', session: frame.params.session, url: 'http://127.0.0.1:41000/a/one' },
          });
        }
        return { ok: true, result: { marker: 'done' } };
      },
    },
  };
  runInNewContext(source, {
    cindy, crypto: webcrypto,
    fetch: async () => ({ ok: true, json: async () => ({ runtimeScope: 'a-state' }) }),
  });
  return { calls, onMessage };
}

test('the tool uses the verified task and opens the work in that task with reuse', async () => {
  const { calls, onMessage } = harness();
  await onMessage({
    type: 'tool-call', tool: 'artifact', callId: 'tool-one',
    args: { action: 'open', session_context: { session_id: 'task-one', workdir: '/project', workdir_is_local: true } },
  });
  assert.equal(calls[0][1].params.session, 'task-one');
  assert.equal(calls[0][1].params.workspace, '/project');
  assert.equal(calls[0][1].params.args.session_context, undefined);
  assert.equal(calls[1][1].sessionId, 'task-one');
  assert.equal(calls[1][1].reuseExisting, true);
  assert.equal(calls.at(-1)[1].result.marker, 'done');
});

test('a remote or read-only task never starts the runtime', async () => {
  const { calls, onMessage } = harness();
  for (const session_context of [
    { session_id: 'task-one', workdir: '/project', workdir_is_local: false },
    { session_id: 'task-one', workdir: '/project', workdir_is_local: true, workdir_is_read_only: true },
  ]) {
    await onMessage({ type: 'tool-call', tool: 'artifact', callId: 'tool-one', args: { session_context } });
  }
  assert.deepEqual(calls.map(([type, frame]) => [type, frame.errorCode]), [
    ['result', 'LOCAL_WORKSPACE_REQUIRED'], ['result', 'LOCAL_WORKSPACE_REQUIRED'],
  ]);
});

test('a wake acknowledges queue acceptance and retains the same request key on retry', async () => {
  for (const accepted of [true, false]) {
    const { calls, onMessage } = harness({ accepted });
    const event = {
      type: 'event', name: 'node-notification', method: 'artifact/wake',
      params: { id: 'wake-one', session: 'task-one', requestKey: 'same-key', text: 'Change title' },
    };
    await onMessage(event);
    await onMessage(event);
    assert.deepEqual(calls.filter(([type]) => type === 'send').map(([, frame]) => frame.requestKey), ['same-key', 'same-key']);
    assert.equal(calls.at(-1)[1].params.answer, accepted ? 'queued' : 'failed');
  }
});

test('workspace paths resolve to authorized local files, including through symlinks', async () => {
  const { mkdtemp, mkdir, symlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { resolveWorkspacePath, workspaceArguments } = await import('../open-artifact/node/safety.cjs');
  const parent = await mkdtemp(join(tmpdir(), 'oa-path-test-'));
  const workspace = join(parent, 'task');
  await mkdir(workspace);
  assert.equal(await resolveWorkspacePath(workspace, 'artifacts/new'), join(await resolveWorkspacePath(workspace, '.'), 'artifacts/new'));
  await assert.rejects(resolveWorkspacePath(workspace, join(parent, 'elsewhere')));
  await symlink(parent, join(workspace, 'linked'), 'junction');
  await assert.rejects(workspaceArguments('ArtifactData', { writes: [{ file_path: 'linked/file.json' }] }, workspace));
  await assert.rejects(workspaceArguments('ArtifactData', { out_file: '../outside.json' }, workspace));
});

test('runtime cache rejects changed files, extra entries and links', async () => {
  const { mkdtemp, mkdir, writeFile, symlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { verifyRuntime } = await import('../open-artifact/node/safety.cjs');
  const digest = content => createHash('sha256').update(content).digest('hex');
  const inventory = { 'scripts/start.mjs': digest('original') };
  const folder = await mkdtemp(join(tmpdir(), 'oa-runtime-test-'));
  await mkdir(join(folder, 'scripts'));
  const entry = join(folder, 'scripts', 'start.mjs');
  await writeFile(entry, 'original');
  await verifyRuntime(folder, inventory);
  await writeFile(entry, 'changed');
  await assert.rejects(verifyRuntime(folder, inventory));
  await writeFile(entry, 'original');
  await symlink(join(folder, 'scripts'), join(folder, 'alias'), 'junction');
  await assert.rejects(verifyRuntime(folder, inventory));
});
