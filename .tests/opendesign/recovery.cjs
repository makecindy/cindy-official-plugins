const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { once } = require('node:events');

// Exercise the packaged JSON-RPC worker, including a real process restart.
function worker() {
  const child = spawn(process.execPath, [path.resolve(__dirname, '../../opendesign-trial/node/worker.cjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let id = 0;
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line), receipt = pending.get(msg.id);
    if (!receipt) return;
    pending.delete(msg.id);
    if (msg.error) receipt.reject(new Error(msg.error.message));
    else receipt.resolve(msg.result);
  });
  let errors = '';
  child.stderr.on('data', (data) => { errors += data; });
  child.on('exit', () => {
    for (const receipt of pending.values()) receipt.reject(new Error('Worker exited: ' + errors));
    pending.clear();
  });
  return {
    invoke(method, params) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        pending.set(requestId, { resolve, reject });
        child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
      });
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.stdin.end();
      await exited;
    },
  };
}

test('opaque host session IDs retain draft ownership and revisions across worker restart', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesign-session-id-'));
  let w = worker();
  try {
    const sessionId = 'exampleCindySession123456', other = 'anotherCindySession654321';
    const { dir: root } = await w.invoke('prepare', { workdir: temp });
    const file = 'design.html', html = '<h1>Existing design</h1>';
    const marker = path.join(root, '.opendesign-project.json');
    const originalMarker = await fs.readFile(marker, 'utf8');
    for (const invalid of [undefined, null, 123, {}, [], [sessionId], '', '../outside', 'a/b', 'a_b', 'a b', 'a'.repeat(65)]) {
      await assert.rejects(w.invoke('bind', { sessionId: invalid, root }), /Trusted session required/);
      assert.equal(await fs.readFile(marker, 'utf8'), originalMarker);
    }
    await w.invoke('bind', { sessionId, root });
    const saved = await w.invoke('draft-write', { sessionId, file, html, expectedRevision: null });
    assert.deepEqual(JSON.parse(await fs.readFile(marker, 'utf8')), { version: 1, sessionId });
    await assert.rejects(w.invoke('bind', { sessionId: other, root }), /different Cindy session/);
    await w.close();
    w = worker();
    await assert.rejects(w.invoke('bind', { sessionId: other, root }), /different Cindy session/);
    const opened = await w.invoke('bind', { sessionId, root, registeredDraft: { id: crypto.randomUUID(), sessionId, root, file } });
    assert.equal(opened.sessionId, sessionId);
    assert.equal((await w.invoke('draft-read', { sessionId, file })).revision, saved.revision);
    assert.equal(await (await fetch(opened.previewBase + file + '?source=1')).text(), html);
    await assert.rejects(w.invoke('draft-write', { sessionId, file, html: 'stale', expectedRevision: null }), /Draft changed/);
    await w.invoke('bind', { sessionId, root, readOnly: true });
    await assert.rejects(w.invoke('draft-write', { sessionId, file, html: 'readonly', expectedRevision: saved.revision }));
    assert.equal(await fs.readFile(path.join(root, file), 'utf8'), html);
  } finally {
    await w.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('old registered draft recovers a lost marker after restart and retains edits, assets and revisions', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesign-recovery-'));
  let w = worker();
  try {
    const sessionId = crypto.randomUUID();
    const { dir: root } = await w.invoke('prepare', { workdir: temp });
    const d = { id: crypto.randomUUID(), sessionId, root, file: 'design.html' };
    const bind = { sessionId, root, registeredDraft: d };
    await w.invoke('bind', { sessionId, root });
    const first = await w.invoke('draft-write', { sessionId, file: d.file, html: '<h1>Original</h1>', expectedRevision: null });
    await fs.writeFile(path.join(root, 'asset.txt'), 'keep asset');
    await fs.writeFile(path.join(root, 'notes.sketch.json'), '{"items":[]}');
    const html = '<h1>Latest manual edit</h1>';
    const latest = await w.invoke('draft-write', { sessionId, file: d.file, html, expectedRevision: first.revision });
    await w.close();
    await fs.unlink(path.join(root, '.opendesign-project.json'));
    w = worker();
    // The plain legacy/discovery bind cannot manufacture ownership.
    await assert.rejects(w.invoke('bind', { sessionId, root }), /ownership file is missing/);
    const opened = await w.invoke('bind', bind);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, '.opendesign-project.json'), 'utf8')), { version: 1, sessionId });
    const read = await w.invoke('draft-read', { sessionId, file: d.file });
    assert.equal(read.html, html);
    assert.equal(read.revision, latest.revision);
    assert.equal(read.sketches[0].file, 'notes.sketch.json');
    assert.equal(await fs.readFile(path.join(root, 'asset.txt'), 'utf8'), 'keep asset');
    assert.equal(await fs.readFile(path.join(root, 'revision-' + first.revision + '.html'), 'utf8'), first.html);
    assert.equal(await (await fetch(opened.previewBase + d.file + '?source=1')).text(), html);
    await assert.rejects(w.invoke('draft-write', { sessionId, file: d.file, html: 'stale', expectedRevision: first.revision }), /Draft changed/);
    const next = await w.invoke('draft-write', { sessionId, file: d.file, html: '<h1>Continued</h1>', expectedRevision: latest.revision });
    await w.close();
    w = worker();
    await w.invoke('bind', bind);
    assert.equal((await w.invoke('draft-read', { sessionId, file: d.file })).revision, next.revision);
  } finally {
    await w.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('recovery never overrides conflicting/corrupt ownership, follows symlinks, or creates a missing draft', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'opendesign-recovery-'));
  const w = worker();
  try {
    const sessionId = crypto.randomUUID(), other = crypto.randomUUID();
    const { dir: root } = await w.invoke('prepare', { workdir: temp });
    const marker = path.join(root, '.opendesign-project.json');
    const d = { id: crypto.randomUUID(), sessionId, root, file: 'design.html' };
    const bind = { sessionId, root, registeredDraft: d };
    await fs.writeFile(path.join(root, d.file), '<h1>Keep</h1>');
    for (const invalid of [JSON.stringify({ version: 1, sessionId: other }), '{broken', 'null', '{"version":2}']) {
      await fs.writeFile(marker, invalid);
      await assert.rejects(w.invoke('bind', bind));
      assert.equal(await fs.readFile(marker, 'utf8'), invalid);
    }
    await fs.unlink(marker);
    await assert.rejects(w.invoke('bind', { ...bind, registeredDraft: { ...d, sessionId: other } }), /does not match/);
    await assert.rejects(w.invoke('bind', { ...bind, registeredDraft: { ...d, root: temp } }), /does not match/);
    await fs.symlink(path.join(root, d.file), marker);
    await assert.rejects(w.invoke('bind', bind), /Unsafe project marker/);
    await fs.unlink(marker);
    await fs.unlink(path.join(root, d.file));
    await assert.rejects(w.invoke('bind', { ...bind, locale: 'zh-CN' }), /HTML 文件已缺失/);
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
    await fs.writeFile(path.join(temp, 'outside.html'), '<h1>Outside</h1>');
    await fs.symlink(path.join(temp, 'outside.html'), path.join(root, d.file));
    await assert.rejects(w.invoke('bind', bind), /Symbolic links/);
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
    await fs.unlink(path.join(root, d.file));
    await fs.writeFile(path.join(root, d.file), '<h1>Keep</h1>');
    await w.invoke('bind', bind);
    await fs.unlink(marker);
    await assert.rejects(w.invoke('bind', { ...bind, sessionId: other, registeredDraft: { ...d, sessionId: other } }), /different Cindy session/);
    await fs.rm(root, { recursive: true });
    await assert.rejects(w.invoke('bind', { ...bind, locale: 'zh-CN' }), /原项目目录/);
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  } finally {
    await w.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
