const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  crypto = require("node:crypto");
const source = fs.readFileSync(
  __dirname + "/../../opendesign-trial/main.js",
  "utf8",
);
const sid = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const ctx = {
  session_id: sid,
  workdir: "/project",
  workdir_is_local: true,
  workdir_is_read_only: false,
};
function runtime(disk = new Map(), reply = { ok: true, sessionId: sid }) {
  let handler;
  const calls = [],
    sent = [];
  const cindy = {
    onHostMessage: (h) => (handler = h),
    agent: { run: async (args) => { calls.push({ agent: args }); return reply; } },
    node: {
      request: async (x) => {
        calls.push(x);
        return {
          ok: true,
          result:
            x.method === "feedback-claim"
              ? { projectDir: "/project/new", file: "design.html", note: "change", attachments: [] }
              : x.method === "prepare"
              ? { dir: "/project/new" }
              : x.method === "bind"
                ? {
                    url: "http://127.0.0.1:1234/studio/token/",
                    previewBase: "http://127.0.0.1:1235/view/read/",
                    files: [],
                  }
                : {
                    cardHtml: "<h1>Actual draft</h1>",
                    html: "<html><body><h1>Actual draft</h1></body></html>",
                    revision: "abc123456",
                    sketches: [],
                  },
        };
      },
    },
    preview: async (x) => {
      calls.push({ preview: x });
      return { ok: true };
    },
    send: async (x) => {
      sent.push(x);
      if (x.type === "fs-request") {
        if (x.op === "read")
          return disk.has(x.path)
            ? { ok: true, content: disk.get(x.path) }
            : { ok: false, errorCode: "NOT_FOUND" };
        disk.set(x.path, x.content);
      }
      return { ok: true };
    },
  };
  vm.runInNewContext(source, { cindy, crypto: crypto.webcrypto });
  return {
    calls,
    sent,
    disk,
    run: (m) => handler(m),
    tool: (tool, args = {}, callId = "call-one") =>
      handler({
        type: "tool-call",
        tool,
        callId,
        args: { session_context: ctx, ...args },
      }),
  };
}
test("create publishes actual markup card, no auto preview or workspace API", async () => {
  const r = runtime();
  await r.tool("opendesign_new", { html: "<h1>draft</h1>" });
  assert.equal(r.sent.at(-1).ok, true);
  assert.match(
    r.sent.find((x) => x.type === "card-update").html,
    /Actual draft/,
  );
  assert.equal(r.calls.filter((x) => x.preview).length, 0);
});
test("persisted card opens fixed session HTML after restart; wrong/missing session rejected", async () => {
  const r = runtime();
  await r.tool("opendesign_new", { html: "x" });
  for (const sessionId of [sid, other, undefined]) {
    const q = runtime(r.disk);
    await q.run({
      type: "event",
      name: "card-action",
      callId: "call-one",
      actionId: "open",
      sessionId,
    });
    const p = q.calls.find((x) => x.preview)?.preview;
    if (sessionId === sid) {
      assert.equal(p.sessionId, sid);
      assert.match(p.url, /\/studio\/token\/\?file=design.html$/);
    } else assert.equal(p, undefined);
  }
});
test("follow-up keeps draft and file, duplicate creation rejected", async () => {
  const r = runtime();
  await r.tool("opendesign_new", { html: "x" });
  const id = r.sent.at(-1).result.draftId;
  await r.tool("opendesign_context", {}, "read");
  assert.match(r.sent.at(-1).result.html, /Actual draft/);
  await r.tool(
    "opendesign_update",
    { html: "changed", expectedRevision: "abc123456" },
    "update",
  );
  assert.equal(r.sent.at(-1).result.draftId, id);
  assert.equal(
    r.calls.findLast((x) => x.method === "draft-write").params.file,
    "design.html",
  );
  await r.tool("opendesign_new", { html: "new" }, "duplicate");
  assert.equal(r.sent.at(-1).ok, false);
  assert.equal(r.calls.filter((x) => x.method === "prepare").length, 1);
});
test("untrusted, remote and readonly contexts do nothing", async () => {
  for (const context of [
    undefined,
    { ...ctx, workdir_is_local: false },
    { ...ctx, workdir_is_read_only: true },
  ]) {
    const r = runtime();
    await r.tool("opendesign_open", { session_context: context });
    assert.equal(r.calls.length, 0);
    assert.equal(r.sent.at(-1).ok, false);
  }
});

test("accepted dispatch to a different session stays unknown without retry", async () => {
  for (const [reply, expected] of [[{ok:true}, 'unknown'], [{ok:true,sessionId:''}, 'unknown'], [{ok:true,sessionId:sid}, 'accepted'], [{ok:true,sessionId:sid,disposition:'queued'}, 'queued'], [{ok:true,sessionId:other}, 'unknown'], [null, 'unknown'], [{ok:false,message:'denied'}, 'rejected']]) {
    const r = runtime(new Map(), reply);
    await r.tool('opendesign_new', {html:'<h1>Example</h1>'});
    await r.run({type:'event',name:'node-notification',method:'opendesign-feedback',params:{requestId:'request-one',sessionId:sid}});
    assert.equal(r.calls.findLast(x => x.method === 'feedback-result').params.status, expected);
    assert.equal(r.calls.filter(x => x.agent).length, 1);
    assert.equal(r.calls.find(x => x.agent).agent.sessionId, sid);
  }
});
