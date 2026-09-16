const { test, after } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const w = require("../../opendesign-trial/node/server.cjs");
let temp;
after(async () => {
  await w.close();
  if (temp) await fs.rm(temp, { recursive: true, force: true });
});
test("session roots, editor/read isolation, traversal, saves and live JS", async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "opendesign-test-"));
  await assert.rejects(
    w.invoke("bind", { root: temp, sessionId: crypto.randomUUID() }),
  );
  console.log("prepare");
  const a = await w.invoke("prepare", { workdir: temp }),
    b = await w.invoke("prepare", { workdir: temp });
  console.log("bind");
  const sid = crypto.randomUUID();
  const one = await w.invoke("bind", { root: a.dir, sessionId: sid });
  const two = await w.invoke("bind", {
    root: b.dir,
    sessionId: crypto.randomUUID(),
  });
  await assert.rejects(w.invoke("bind", { root: b.dir, sessionId: sid }));
  await assert.rejects(
    w.invoke("bind", { root: a.dir, sessionId: crypto.randomUUID() }),
  );
  const base = new URL(one.url).origin,
    token = one.url.split("/")[4];
  const api = base + "/api/projects/" + token;
  const content =
    "<!doctype html><h1>Design</h1><button onclick=\"this.textContent='Clicked'\">Try</button>";
  console.log("write");
  let r = await fetch(api + "/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "index.html", content, expectedRevision: null }),
  });
  assert.equal(r.status, 200);
  console.log("read");
  assert.match(
    await (await fetch(one.previewBase + "index.html")).text(),
    /onclick/,
  );
  assert.equal((await fetch(two.previewBase + "index.html")).status, 400);
  assert.equal(
    (await fetch(one.previewBase + "index.html", { method: "DELETE" })).status,
    405,
  );
  assert.equal(
    (
      await fetch(api + "/files", {
        headers: { Origin: new URL(one.previewBase).origin },
      })
    ).status,
    403,
  );
  await fs.symlink(path.join(temp, "outside"), path.join(a.dir, "escape"));
  await assert.rejects(w.safe(a.dir, "escape"));
  for (const name of ["../outside", ".env", "nested/../../outside"]) {
    r = await fetch(api + "/files", {
      method: "POST",
      body: JSON.stringify({ name, content: "bad" }),
    });
    assert.equal(r.status, 400);
  }
  r = await fetch(api + "/files", {
    method: "POST",
    body: JSON.stringify({
      name: "test.sketch.json",
      content: JSON.stringify({ version: 1, items: [] }),
    }),
  });
  assert.equal(r.status, 200);
  assert.equal(
    (await (await fetch(api + "/files")).json()).files.find(
      (f) => f.name === "test.sketch.json",
    ).kind,
    "sketch",
  );
  console.log("browser");
  const first = await w.invoke("draft-read", {
    sessionId: sid,
    file: "index.html",
  });
  await w.invoke("draft-write", {
    sessionId: sid,
    file: "index.html",
    html: content + "<!--revision-->",
    expectedRevision: first.revision,
  });
  await assert.rejects(
    w.invoke("draft-write", {
      sessionId: sid,
      file: "index.html",
      html: "stale",
      expectedRevision: first.revision,
    }),
  );
  assert.ok((await fs.readdir(a.dir)).some((f) => f.startsWith("revision-")));
  const fresh = await w.invoke("draft-read", {
    sessionId: sid,
    file: "index.html",
  });
  assert.notEqual(fresh.revision, first.revision);
  assert.equal(fresh.sketches[0].file, "test.sketch.json");
  const stale = await fetch(api + '/files', {method:'POST',body:JSON.stringify({name:'index.html',content:'stale manual',expectedRevision:first.revision})});
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'REVISION_CONFLICT');
  assert.equal((await fetch(api + '/files', {method:'POST',body:JSON.stringify({name:'index.html',content:'missing revision'})})).status, 409);
  const racers = await Promise.all(Array.from({length:8}, async (_, i) => {
    if (i % 2) {
      try { await w.invoke('draft-write', {sessionId:sid,file:'index.html',html:'<h1>Agent '+i+'</h1>',expectedRevision:fresh.revision}); return true; }
      catch (e) { assert.match(e.message, /Draft changed/); return false; }
    }
    return (await fetch(api + '/files', {method:'POST',body:JSON.stringify({name:'index.html',content:'<h1>Manual '+i+'</h1>',expectedRevision:fresh.revision})})).ok;
  }));
  assert.equal(racers.filter(Boolean).length, 1);
  const raw = await fetch(one.previewBase + 'index.html');
  const policy = raw.headers.get('Content-Security-Policy');
  assert.ok(policy.includes('connect-src ' + one.previewBase));
  assert.ok(!policy.includes('127.0.0.1:*'));

});
