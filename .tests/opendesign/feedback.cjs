const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const feedback = require("../../opendesign-trial/node/feedback.cjs");
test("feedback belongs to one session, sends once, stays pending in flight and settles explicitly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "od-feedback-"));
  const b = { root, sessionId: "owner", edit: "editor" };
  let event;
  feedback.setEmitter((e) => (event = e));
  try {
    const created = await feedback.handle(
      b,
      "feedback",
      "POST",
      { file: "design.html", note: "change title", action: "send" },
      () => {},
    );
    assert.equal(event.params.sessionId, "owner");
    await assert.rejects(feedback.claim(created.requestId, "other"));
    const r = await feedback.claim(created.requestId, "owner");
    assert.equal(r.note, "change title");
    await assert.rejects(feedback.claim(created.requestId, "owner"));
    assert.equal(
      (await feedback.handle(b, "feedback/" + created.requestId, "GET")).status,
      "pending",
    );
    await assert.rejects(
      feedback.finish(created.requestId, "other", "accepted"),
    );
    await feedback.finish(
      created.requestId,
      "owner",
      "unknown",
      "dispatch outcome unknown",
    );
    assert.equal(
      (await feedback.handle(b, "feedback/" + created.requestId, "GET")).status,
      "unknown",
    );
    await assert.rejects(feedback.claim(created.requestId, "owner"));
    event = null;
    const saved = await feedback.handle(
      b,
      "feedback",
      "POST",
      { file: "design.html", note: "save only", action: "draft" },
      () => {},
    );
    assert.equal(saved.status, "draft");
    assert.equal(event, null);
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        feedback.handle(
          b,
          "comments",
          "POST",
          { target: { selector: "#item" + i }, note: "note" + i },
          () => {},
        ),
      ),
    );
    assert.equal((await feedback.read(b)).comments.length, 6);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("attachment validation proves rejection before dispatch; post-dispatch failures do not", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "od-feedback-reject-"));
  const b = {root,sessionId:"owner-reject",edit:"editor"};
  let emitted = 0;
  feedback.setEmitter(() => {emitted++;throw Error("receipt lost after dispatch");});
  try {
    for (const images of [Array(13).fill({}),[{type:"text/plain",base64:"eA=="}],[{type:"image/png",base64:Buffer.alloc(8*1024*1024+1).toString("base64")}]]) {
      await assert.rejects(feedback.handle(b,"feedback","POST",{action:"send",images},async()=>{}),{code:"FEEDBACK_REJECTED",status:400});
      assert.equal(emitted,0);
      assert.equal((await feedback.read(b)).requests.length,0);
    }
    await assert.rejects(feedback.handle(b,"feedback","POST",{action:"send"},async()=>{}),e=>e.message==="receipt lost after dispatch" && !e.code);
    assert.equal(emitted,1);
    assert.equal((await feedback.read(b)).requests.length,1);
  } finally {feedback.setEmitter(()=>{});await fs.rm(root,{recursive:true,force:true});}
});
