import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

const source = await readFile(new URL('../open-artifact/main.js', import.meta.url), 'utf8');

test('the three runtime replacements match the installed integrity inventory', async () => {
  const vendor = new URL('../open-artifact/vendor/', import.meta.url);
  const inventory = JSON.parse(await readFile(new URL('runtime-integrity.json', vendor), 'utf8'));
  for (const file of ['vendor/open-artifact.mjs', 'vendor/frame-host/frame-host.mjs', 'vendor/type-server/cli.mjs']) {
    const packed = await readFile(new URL(`runtime-overlay/${file}.gz`, vendor));
    const bundle = gunzipSync(packed, { maxOutputLength: 8 * 1024 * 1024 });
    assert.equal(createHash('sha256').update(bundle).digest('hex'), inventory[file], file);
  }
});

function harness({ accepted = true, openDuringCall = true, confirmation = { ok: true, confirmed: true }, nodeResponse } = {}) {
  let onMessage;
  const calls = [];
  const cindy = {
    onHostMessage(fn) { onMessage = fn; },
    async send(frame) { calls.push(['result', frame]); },
    async preview(args) { calls.push(['preview', args]); return { ok: true }; },
    async confirm(args) { calls.push(['confirm', args]); return confirmation; },
    targets: {
      async resolve({ session }) { return { kind: 'task', id: session }; },
      async send(args) { calls.push(['send', args]); return { accepted }; },
    },
    node: {
      async request(frame) {
        calls.push(['node', frame]);
        if (frame.method === 'artifact/call' && nodeResponse) return nodeResponse();
        if (frame.method === 'artifact/call' && openDuringCall) {
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

test('cloud publishing reports only a confirmed remote receipt as published', async () => {
  for (const [nodeResponse, status] of [
    [() => { throw new Error('Runtime disconnected'); }, 'unknown'],
    [() => ({ ok: false, errorCode: 'TIMEOUT' }), 'unknown'],
    [() => ({ ok: false, message: 'Workspace unavailable', data: { publicationStatus: 'not_executed' } }), 'not_executed'],
    [() => ({ ok: true, result: { error: { message: 'Remote unavailable' } } }), 'unknown'],
    [() => ({ ok: true, result: { cloud: { remote: 'other', view_url: 'https://example.test/work' } } }), 'unknown'],
    [() => ({ ok: true, result: { cloud: { remote: 'my-cloud', view_url: 'https://example.test/work' } } }), 'published'],
  ]) {
    const { calls, onMessage } = harness({ nodeResponse });
    await onMessage({
      type: 'tool-call', tool: 'artifact', callId: 'share', args: {
        action: 'share', cloud: 'my-cloud', url: 'open-artifact://artifact/art_test',
        session_context: { session_id: 'task-one', workdir: '/project', workdir_is_local: true },
      },
    });
    const reply = calls.at(-1)[1];
    assert.equal(reply.result?.publicationStatus, status);
    assert.equal(reply.ok, status === 'published');
    if (status === 'unknown') {
      assert.equal(reply.errorCode, 'ARTIFACT_SHARE_UNKNOWN');
      assert.match(reply.message, /check the remote/i);
    }
    assert.equal(calls.filter(([type]) => type === 'node').length, 1);
  }
});

test('artifact writes preserve uncertain outcomes and pending feedback', async () => {
  const url = 'open-artifact://artifact/art_test';
  const feedback = 'A comment is waiting for the task.';
  for (const [tool, args] of [
    ['artifact_data', { action: 'str_replace', url }],
    ['artifact_comments', { action: 'reply', url }],
    ['artifact', { action: 'call', name: 'update', url }],
  ]) {
    for (const [nodeResponse, status, hasFeedback] of [
      [() => { throw new Error('Runtime disconnected'); }, 'unknown'],
      [() => ({ ok: true, result: null }), 'unknown'],
      [() => ({ ok: false, data: { messages: [feedback] } }), 'unknown', true],
      [() => ({ ok: false, message: 'Workspace unavailable', data: { executionStatus: 'not_executed', messages: [feedback] } }), 'not_executed', true],
      [() => ({ ok: true, result: { error: { code: 'connect_failed', fix: 'Try the write again.' }, messages: [feedback] } }), 'unknown', true],
      [() => ({ ok: true, result: { changed: true, messages: [feedback] } }), 'completed', true],
    ]) {
      const { calls, onMessage } = harness({ nodeResponse });
      await onMessage({
        type: 'tool-call', tool, callId: 'write', args: {
          ...args, session_context: { session_id: 'task-one', workdir: '/project', workdir_is_local: true },
        },
      });
      const reply = calls.at(-1)[1];
      assert.equal(reply.result?.executionStatus, status);
      assert.equal(reply.ok, status === 'completed');
      if (status === 'unknown') {
        assert.match(reply.message, /check .* before trying again/i);
        assert.equal(reply.result.error, undefined);
      }
      assert.deepEqual(reply.result.messages, hasFeedback ? [feedback] : undefined);
      const node = calls.filter(([type]) => type === 'node');
      assert.equal(node.length, 1);
      assert.equal(node[0][1].params.statusField, 'executionStatus');
    }
  }
});

test('a read that fails after lookup still returns pending feedback', async () => {
  const messages = ['A comment is waiting for the task.'];
  const { calls, onMessage } = harness({ nodeResponse: () => ({
    ok: false, message: 'Artifact unavailable', data: { messages },
  }) });
  await onMessage({
    type: 'tool-call', tool: 'artifact', callId: 'read', args: {
      action: 'read', url: 'open-artifact://artifact/art_test',
      session_context: { session_id: 'task-one', workdir: '/project', workdir_is_local: true },
    },
  });
  const reply = calls.at(-1)[1];
  assert.equal(reply.ok, false);
  assert.deepEqual(reply.result.messages, messages);
});

test('a local file conflict retains the current content for resolving the edit', async () => {
  const url = 'open-artifact://artifact/art_test';
  const current = { 'Draft.md': { sha256: 'current', content: 'Edited draft' } };
  const { calls, onMessage } = harness({ nodeResponse: () => ({
    ok: true, result: { url, current, executionStatus: 'not_executed', error: { code: 'conflict', message: 'The draft changed.' } },
  }) });
  await onMessage({
    type: 'tool-call', tool: 'artifact', callId: 'patch-files', args: {
      action: 'publish', url, files: { 'Draft.md': 'Next draft' },
      session_context: { session_id: 'task-one', workdir: '/project', workdir_is_local: true },
    },
  });
  const reply = calls.at(-1)[1];
  assert.equal(reply.ok, false);
  assert.equal(reply.result?.executionStatus, 'not_executed');
  assert.deepEqual(reply.result.current, current);
});

test('a confirmed data conflict preserves the current version and pending feedback', async () => {
  const url = 'open-artifact://artifact/art_test';
  const current = { 'datasets/sample': { exists: true, sha256: 'new', data: { title: 'Page edit' } } };
  const error = { code: 'conflict', message: 'The data changed.', fix: 'Read the current version.' };
  const messages = ['The task has a waiting comment.'];
  for (const action of ['set', 'update', 'delete', 'str_replace', 'batch']) {
    for (const executionStatus of ['not_executed', undefined]) {
      const { calls, onMessage } = harness({ nodeResponse: () => ({
        ok: true, result: { url, error, current, messages, executionStatus },
      }) });
      await onMessage({ type: 'tool-call', tool: 'artifact_data', callId: 'patch-data', args: {
        action, url, session_context: { session_id: 'task-one', workdir: '/project', workdir_is_local: true },
      } });
      const reply = calls.at(-1)[1];
      assert.equal(reply.ok, false);
      assert.equal(reply.result.executionStatus, executionStatus ?? 'unknown');
      assert.deepEqual(reply.result.current, executionStatus ? current : undefined);
      assert.deepEqual(reply.result.error, executionStatus ? error : undefined);
      assert.deepEqual(reply.result.messages, messages);
    }
  }
});

test('an adoption requires a positive host confirmation for the destination task', async () => {
  for (const [confirmation, expected] of [
    [{ ok: true, confirmed: false }, false],
    [{ ok: false, confirmed: true }, false],
    [{ ok: true, confirmed: true }, true],
  ]) {
    const { calls, onMessage } = harness({ confirmation });
    await onMessage({
      type: 'event', name: 'node-notification', method: 'artifact/confirm-adopt',
      params: { id: 'confirm-one', session: 'task-b', title: 'Design draft', owner: 'cindy:task-a' },
    });
    const request = calls.find(([type]) => type === 'confirm')?.[1];
    assert.match(request?.body, /Design draft/);
    assert.match(request.body, /from task task-a to task task-b/);
    assert.equal(calls.at(-1)[1].method, 'host/complete');
    assert.equal(calls.at(-1)[1].params.answer, expected);
  }
});

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

test('the first write opens the work in the original task after creation returns', async () => {
  const { calls, onMessage } = harness({ openDuringCall: false });
  await onMessage({
    type: 'tool-call', tool: 'artifact', callId: 'create-one',
    args: {
      action: 'publish', open: 'after_first_write',
      session_context: { session_id: 'task-one', workdir: '/project', workdir_is_local: true },
    },
  });
  assert.equal(calls.at(-1)[1].result.marker, 'done');
  await onMessage({
    type: 'event', name: 'node-notification', method: 'artifact/open',
    params: { id: 'first-write', session: 'task-one', url: 'http://127.0.0.1:41000/a/one' },
  });
  const preview = calls.find(([type]) => type === 'preview')?.[1];
  assert.equal(preview?.sessionId, 'task-one');
  assert.equal(preview?.reuseExisting, true);
  assert.equal(calls.at(-1)[1].params.answer, true);
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

test('the worker returns pending comments immediately and waits only when none are available', { timeout: 5000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { copyFile, mkdir, mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createInterface } = await import('node:readline');
  const plugin = new URL('../open-artifact/', import.meta.url);
  const { dependencies: [{ version }] } = JSON.parse(await readFile(new URL('binary-dependencies.json', plugin), 'utf8'));
  const fixture = await mkdtemp(join(tmpdir(), 'oa-wait-test-'));
  const scope = '00000000-0000-4000-8000-000000000000';
  await mkdir(join(fixture, '.cindy-open-artifact', scope, `runtime-${version}-cindy.3`), { recursive: true });
  await mkdir(join(fixture, 'node'));
  await mkdir(join(fixture, 'vendor'));
  for (const file of ['node/worker.cjs', 'node/safety.cjs']) {
    await copyFile(new URL(file, plugin), join(fixture, file));
  }
  await writeFile(join(fixture, 'vendor', 'runtime-integrity.json'), '{}');
  await writeFile(join(fixture, 'vendor', 'adapter.mjs'), `
    export function createHarness() {
      return {
        async call(tool, args, caller) {
          if (tool === 'Artifact') {
            const artifact = { url: 'open-artifact://artifact/art_test', root: caller.workspace };
            if (caller.session !== 'lookup') return { artifacts: [artifact] };
            return args.cursor
              ? { artifacts: [artifact], messages: ['Second page comment'] }
              : { artifacts: [], next_cursor: '1', messages: ['First page comment'] };
          }
          return caller.session === 'later'
            ? { messages: ['New comment'] }
            : { messages: [], timedOut: true };
        },
        async attach({ session }) {
          return { inbox: ['lookup', 'attach'].includes(session) ? [{ text: 'Attached comment' }] : [] };
        },
        close() {},
      };
    }
  `);
  const worker = spawn(process.execPath, [join(fixture, 'node', 'worker.cjs')], {
    env: { ...process.env, HOME: fixture, USERPROFILE: fixture },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = createInterface({ input: worker.stdout });
  t.after(() => {
    lines.close();
    worker.stdin.end();
    worker.kill();
  });
  const replies = lines[Symbol.asyncIterator]();
  let requestId = 0;
  async function wait(session, url) {
    const id = ++requestId;
    const params = { scope, session, workspace: fixture, tool: 'ArtifactComments', args: { action: 'wait', url } };
    worker.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'artifact/call', params }) + '\n');
    const reply = await replies.next();
    assert.equal(reply.done, false);
    const frame = JSON.parse(reply.value);
    assert.equal(frame.id, id);
    assert.equal(frame.error, undefined);
    return frame.result;
  }
  const url = 'open-artifact://artifact/art_test';
  assert.deepEqual(await wait('lookup', url), { messages: ['First page comment', 'Second page comment', 'Attached comment'] });
  assert.deepEqual(await wait('attach'), { messages: ['Attached comment'] });
  assert.deepEqual(await wait('empty', url), { messages: [], timedOut: true });
  assert.deepEqual(await wait('later'), { messages: ['New comment'] });
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

test('artifact file arguments use the same relative paths for validation and forwarding', async () => {
  const { mkdtemp, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { artifactFileArguments } = await import('../open-artifact/node/safety.cjs');
  const parent = await mkdtemp(join(tmpdir(), 'oa-relative-files-'));
  const root = join(parent, 'artifact');
  await mkdir(root);

  const checked = await artifactFileArguments({
    path: 'notes\\Draft.md', paths: ['/notes/Readme.md'],
    files: { 'notes\\Draft.md': 'draft' }, if_match: { 'notes\\Metadata.md': null },
  }, root);
  assert.equal(checked.path, 'notes/Draft.md');
  assert.deepEqual(checked.paths, ['notes/Readme.md']);
  assert.deepEqual(checked.files, { 'notes/Draft.md': 'draft' });
  assert.deepEqual(checked.if_match, { 'notes/Metadata.md': null });
  await assert.rejects(artifactFileArguments({ if_match: { '': null } }, root), /Invalid artifact file path/);
  await assert.rejects(artifactFileArguments({ files: { 'A.md': 'one', '/A.md': 'two' } }, root), /Duplicate artifact file path/);
});

test('artifact actions resolve import, upload and export paths within the task workspace', async () => {
  const { mkdtemp, mkdir, symlink, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { artifactActionArguments, resolveWorkspacePath } = await import('../open-artifact/node/safety.cjs');
  const parent = await mkdtemp(join(tmpdir(), 'oa-action-path-test-'));
  const workspace = join(parent, 'task');
  const root = join(workspace, 'artifact');
  await mkdir(root, { recursive: true });
  await symlink(parent, join(workspace, 'linked'), 'junction');
  const artifact = { root, type: 'docs', title: 'Notes' };
  const checkedRoot = await resolveWorkspacePath(workspace, '.');

  const copy = await artifactActionArguments('duplicate', { name: 'Notes copy' }, workspace, { ...artifact, root: checkedRoot });
  assert.deepEqual(copy, { name: 'Notes copy' });

  for (const name of ['import', 'upload']) {
    const input = await artifactActionArguments(name, { file: 'notes.md' }, workspace, artifact);
    assert.equal(input.file, join(checkedRoot, 'notes.md'));
    await assert.rejects(artifactActionArguments(name, { file: join(parent, 'fixture.md') }, workspace, artifact));
  }
  await assert.rejects(artifactActionArguments('export', { out: 'linked/notes.md' }, workspace, artifact));
  const explicit = await artifactActionArguments('export', { format: 'markdown', out: 'new/notes.md' }, workspace, artifact);
  assert.equal(explicit.out, join(checkedRoot, 'new', 'notes.md'));
  assert.equal((await artifactActionArguments('export', { format: 'markdown' }, workspace, artifact)).out, undefined);
  const doc = await artifactActionArguments('export', { format: 'docx' }, workspace, artifact);
  assert.equal(doc.out, join(checkedRoot, 'artifact', 'exports', 'Notes.docx'));
  await symlink(parent, join(root, 'exports'), 'junction');
  await assert.rejects(artifactActionArguments('export', { format: 'docx' }, workspace, artifact));

  const sheet = { ...artifact, type: 'sheets', title: 'Budget' };
  const batch = { calls: [{ payload: { codeFile: 'linked/chart.jsx' } }] };
  await assert.rejects(artifactActionArguments('widget', { codeFile: 'linked/chart.jsx' }, workspace, sheet));
  await assert.rejects(artifactActionArguments('batch', batch, workspace, sheet));
  const validBatch = { calls: [{ payload: { codeFile: 'chart.jsx' } }] };
  const chart = await artifactActionArguments('batch', validBatch, workspace, sheet);
  assert.equal(chart.calls[0].payload.codeFile, join(checkedRoot, 'chart.jsx'));
  const exports = join(workspace, 'downloads');
  await mkdir(exports);
  const csvArgs = { csv: true, file: exports, sheet: 'Sales/West' };
  const csv = await artifactActionArguments('export', csvArgs, workspace, sheet);
  assert.equal(csv.file, join(checkedRoot, 'downloads', 'Budget - Sales West.csv'));
  const outside = join(parent, 'fixture.csv');
  await writeFile(outside, 'fixture\n');
  await symlink(outside, csv.file);
  await assert.rejects(artifactActionArguments('export', csvArgs, workspace, sheet));
  await assert.rejects(artifactActionArguments('export', { file: 'linked/book.xlsx' }, workspace, sheet));
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
