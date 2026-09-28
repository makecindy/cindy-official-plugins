"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const pending = new Map();
let emit = () => {};
async function read(b) {
  try {
    const file = path.join(b.root, ".opendesign-feedback.json");
    if ((await fs.lstat(file)).isSymbolicLink())
      throw Error("Unsafe feedback path");
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return { comments: [], requests: [] };
  }
}
async function save(b, data) {
  const dest = path.join(b.root, ".opendesign-feedback.json");
  try {
    if ((await fs.lstat(dest)).isSymbolicLink())
      throw Error("Unsafe metadata path");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const tmp = dest + "." + crypto.randomUUID();
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, dest);
}
function rejected(message) { return Object.assign(new Error(message), {status:400, code:"FEEDBACK_REJECTED"}); }
async function images(b, input, write) {
  if (!Array.isArray(input) || input.length > 12)
    throw rejected("Too many images");
  // Validate the complete batch before creating any project files.
  const decoded = input.map((image) => {
    if (
      !image || !["image/png", "image/jpeg", "image/webp"].includes(image.type) ||
      typeof image.base64 !== "string"
    )
      throw rejected("Unsupported annotation image");
    const bytes = Buffer.from(image.base64, "base64");
    if (bytes.length > 8 * 1024 * 1024) throw rejected("Image too large");
    return {type:image.type,bytes};
  });
  const out = [];
  for (const {type,bytes} of decoded) {
    const name =
      "annotation-" +
      crypto.randomUUID() +
      "." +
      { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[
        type
      ];
    await write(b, name, bytes);
    out.push({ name, path: name, mime: type });
  }
  return out;
}
async function handleUnlocked(b, route, method, body, write) {
  const data = await read(b);
  if (route === "comments" && method === "GET")
    return { comments: data.comments };
  if (route === "comments" && method === "POST") {
    if (b.readOnly) throw rejected("Read-only session");
    if (body.remove) {
      data.comments = data.comments.filter((c) => c.id !== body.remove);
      await save(b, data);
      return { ok: true };
    }
    const found = data.comments.find((c) => c.id === body.id);
    if (found && typeof body.sortKey === "number") {
      found.sortKey = body.sortKey;
      await save(b, data);
      return { comment: found };
    }
    if (
      typeof body.note !== "string" ||
      body.note.length > 12000 ||
      !body.target?.selector
    )
      throw Error("Invalid comment");
    const c = {
      ...body.target,
      id: found?.id || crypto.randomUUID(),
      projectId: b.edit,
      conversationId: b.sessionId,
      note: body.note,
      status: "open",
      createdAt: found?.createdAt || Date.now(),
      updatedAt: Date.now(),
      pinSeq: found?.pinSeq || data.comments.length + 1,
      attachments: [...(found?.attachments || []), ...await images(b, body.images || [], write)],
    };
    data.comments = data.comments.filter((x) => x.id !== c.id);
    data.comments.push(c);
    await save(b, data);
    return { comment: c };
  }
  if (route === "feedback" && method === "POST") {
    if (b.readOnly) throw rejected("Read-only session");
    if (!["send", "queue", "draft"].includes(body.action))
      throw rejected("Unknown send action");
    const r = {
      id: crypto.randomUUID(),
      sessionId: b.sessionId,
      file: body.file,
      note: body.note || "",
      target: body.target || null,
      attachments: body.attachments || [],
      markKind: body.markKind,
      bounds: body.bounds,
      images: await images(b, body.images || [], write),
      status: body.action === "draft" ? "draft" : "pending",
      createdAt: Date.now(),
    };
    data.requests.push(r);
    data.requests = data.requests.slice(-100);
    await save(b, data);
    if (r.status === "pending") {
      pending.set(r.id, { b, r, claimed: false });
      emit({
        jsonrpc: "2.0",
        method: "opendesign-feedback",
        params: { requestId: r.id, sessionId: b.sessionId },
      });
    }
    return { requestId: r.id, status: r.status };
  }
  if (route.startsWith("feedback/") && method === "GET") {
    const id = route.slice(9),
      r = data.requests.find((x) => x.id === id);
    if (!r) throw Error("Unknown feedback request");
    return {
      requestId: id,
      status: pending.has(id)
        ? "pending"
        : r.status === "pending"
          ? "unknown"
          : r.status,
      message: r.message,
    };
  }
  return null;
}
async function claimUnlocked(id, sessionId) {
  const entry = pending.get(id);
  if (!entry || entry.claimed || entry.b.sessionId !== sessionId)
    throw Error("Feedback already claimed or session mismatch");
  entry.claimed = true;
  const data = await read(entry.b),
    r = data.requests.find((x) => x.id === id);
  r.status = "unknown";
  await save(entry.b, data);
  return { ...r, projectDir: entry.b.root };
}
async function finishUnlocked(id, sessionId, status, message) {
  const entry = pending.get(id);
  if (!entry || entry.b.sessionId !== sessionId)
    throw Error("Feedback session mismatch");
  const data = await read(entry.b),
    r = data.requests.find((x) => x.id === id);
  r.status = ["accepted", "queued", "rejected"].includes(status)
    ? status
    : "unknown";
  r.message = message;
  await save(entry.b, data);
  pending.delete(id);
  return { ok: true };
}
const locks = new Map();
function serial(root, fn) {
  const before = locks.get(root) || Promise.resolve();
  const next = before.then(fn, fn);
  locks.set(root, next);
  void next
    .finally(() => {
      if (locks.get(root) === next) locks.delete(root);
    })
    .catch(() => {});
  return next;
}
function handle(b, ...args) {
  return serial(b.root, () => handleUnlocked(b, ...args));
}
function claim(id, sessionId) {
  const entry = pending.get(id);
  if (!entry) return Promise.reject(Error("Unknown feedback"));
  return serial(entry.b.root, () => claimUnlocked(id, sessionId));
}
function finish(id, sessionId, status, message) {
  const entry = pending.get(id);
  if (!entry) return Promise.reject(Error("Unknown feedback"));
  return serial(entry.b.root, () =>
    finishUnlocked(id, sessionId, status, message),
  );
}
module.exports = {
  handle,
  claim,
  finish,
  read,
  setEmitter: (fn) => (emit = fn),
};
