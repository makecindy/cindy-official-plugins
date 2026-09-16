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

test("editing annotation text retains persisted images and appends new screenshots", async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"od-comment-images-"));
  const b={root,sessionId:"owner",edit:"editor"};
  const writes=[];
  const write=async (binding,name,bytes)=>{writes.push(name);await fs.writeFile(path.join(binding.root,name),bytes);};
  const image={type:"image/png",base64:Buffer.from("fixture").toString("base64")};
  try {
    const first=(await feedback.handle(b,"comments","POST",{target:{selector:"#title"},note:"original",images:[image]},write)).comment;
    const edit={id:first.id,target:{selector:"#title"},note:"edited"};
    for(const images of [undefined,[]]) {
      const result=(await feedback.handle(b,"comments","POST",{...edit,images},write)).comment;
      assert.deepEqual(result.attachments,first.attachments);
      assert.deepEqual((await feedback.read(b)).comments[0].attachments,first.attachments);
      assert.equal(writes.length,1);
    }
    const appended=(await feedback.handle(b,"comments","POST",{...edit,images:[image]},write)).comment;
    assert.equal(appended.attachments.length,2);
    assert.deepEqual(appended.attachments[0],first.attachments[0]);
    assert.notEqual(appended.attachments[1].path,first.attachments[0].path);
    assert.equal(await fs.readFile(path.join(root,first.attachments[0].path),"utf8"),"fixture");
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test("invalid trailing images reject the whole batch before any file writes", async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"od-image-batch-"));
  const b={root,sessionId:"batch-owner",edit:"editor"};
  let writes=0,emitted=0;
  feedback.setEmitter(()=>{emitted++;});
  const valid={type:"image/png",base64:"eA=="};
  try {
    for(const route of ["comments","feedback"]) {
      for(const invalid of [{type:"text/plain",base64:"eA=="},{type:"image/png",base64:Buffer.alloc(8*1024*1024+1).toString("base64")}]) {
        await assert.rejects(feedback.handle(b,route,"POST",{
          target:{selector:"#title"},note:"fixture",action:"send",images:[valid,invalid]
        },async(binding,name,bytes)=>{writes++;await fs.writeFile(path.join(binding.root,name),bytes);}),
        {code:"FEEDBACK_REJECTED",status:400});
        assert.equal(writes,0);
        assert.equal(emitted,0);
        assert.deepEqual(await fs.readdir(root),[]);
        assert.deepEqual(await feedback.read(b),{comments:[],requests:[]});
      }
    }
    const saved=(await feedback.handle(b,"comments","POST",{target:{selector:"#title"},note:"valid",images:[valid,valid]},
      async(binding,name,bytes)=>{writes++;await fs.writeFile(path.join(binding.root,name),bytes);})).comment;
    assert.equal(writes,2);
    assert.equal(saved.attachments.length,2);
    assert.notEqual(saved.attachments[0].path,saved.attachments[1].path);
  } finally {feedback.setEmitter(()=>{});await fs.rm(root,{recursive:true,force:true});}
});
