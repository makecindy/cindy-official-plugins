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
