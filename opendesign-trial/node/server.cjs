"use strict";
// Local-only workbench. Editor and generated pages use different origins and tokens.
const http = require("node:http"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  readline = require("node:readline");
const pkg = path.resolve(__dirname, ".."),
  editors = new Map(),
  readers = new Map(),
  bindings = new Map();
const feedback = require("./feedback.cjs");
const cardPreview = require("./card-preview.cjs");
const LIMIT = 12 * 1024 * 1024;
const mime = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};
const token = () => crypto.randomBytes(32).toString("hex");
function validName(name) {
  if (
    typeof name !== "string" ||
    name.length > 500 ||
    name.includes("\\") ||
    name.includes("\0") ||
    name
      .split("/")
      .some(
        (s) =>
          !s ||
          s.startsWith(".") ||
          /^(node_modules|private|credentials)$/i.test(s),
      )
  )
    throw Error("Invalid file path");
  return name;
}
async function safe(root, name, missing = false) {
  validName(name);
  let current = root;
  for (const part of name.split("/")) {
    current = path.join(current, part);
    try {
      const s = await fs.lstat(current);
      if (s.isSymbolicLink()) throw Error("Symbolic links are not served");
    } catch (e) {
      if (e.code === "ENOENT" && missing && current === path.join(root, name))
        return current;
      throw e;
    }
  }
  return current;
}
async function info(root, name) {
  const s = await fs.stat(await safe(root, name));
  const ext = path.extname(name).toLowerCase();
  return {
    name,
    path: name,
    type: "file",
    size: s.size,
    mtime: s.mtimeMs,
    kind: name.endsWith(".sketch.json")
      ? "sketch"
      : /\.html?$/.test(ext)
        ? "html"
        : /\.(png|jpe?g|gif|svg|webp)$/.test(ext)
          ? "image"
          : ext === ".mp4"
            ? "video"
            : ext === ".mp3"
              ? "audio"
              : ext === ".pdf"
                ? "binary"
                : "text",
    mime: mime[ext] || "application/octet-stream",
  };
}
async function files(root, dir = "") {
  let result = [];
  for (const ent of await fs.readdir(path.join(root, dir), {
    withFileTypes: true,
  })) {
    if (
      ent.name.startsWith(".") ||
      /^revision-[0-9a-f]{64}\.html$/.test(ent.name) ||
      ent.name === "node_modules" ||
      ent.isSymbolicLink()
    )
      continue;
    const name = dir ? dir + "/" + ent.name : ent.name;
    try {
      validName(name);
      if (ent.isDirectory()) {
        if (name.split("/").length < 6)
          result.push(...(await files(root, name)));
      } else if (ent.isFile()) result.push(await info(root, name));
    } catch {}
    if (result.length >= 500) break;
  }
  return result.slice(0, 500);
}
const writes = new Map();
async function serializeWrite(key, action) {
  const previous = writes.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  writes.set(key, next);
  try { return await next; }
  finally { if (writes.get(key) === next) writes.delete(key); }
}
async function write(b, name, data, expectedRevision) {
  validName(name);
  return serializeWrite(path.join(b.root, name), () => writeLocked(b, name, data, expectedRevision));
}
async function writeLocked(b, name, data, expectedRevision) {
  if (b.readOnly) throw Error("Read-only session");
  if (data.length > LIMIT) throw Error("File too large");
  const dest = await safe(b.root, name, true);
  if (/\.html?$/i.test(name)) {
    let current = null;
    try { current = revision(await fs.readFile(dest)); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    if (expectedRevision !== current)
      throw Object.assign(new Error("Draft changed. Read opendesign_context or refresh the viewer and reapply to its latest revision."), { status: 409, code: "REVISION_CONFLICT" });
  }
  if (/\.html?$/i.test(name) && !/^revision-[0-9a-f]{64}\.html$/.test(name)) {
    try {
      const old = await fs.readFile(dest);
      const backup = await safe(
        b.root,
        "revision-" + revision(old) + ".html",
        true,
      );
      await fs.writeFile(backup, old, { flag: "wx" });
    } catch (e) {
      if (!["ENOENT", "EEXIST"].includes(e.code)) throw e;
    }
  }
  const tmp = path.join(path.dirname(dest), ".od-" + token());
  try {
    await fs.writeFile(tmp, data, { flag: "wx" });
    await fs.rename(tmp, dest);
  } finally {
    await fs.rm(tmp, { force: true });
  }
  return info(b.root, name);
}
function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > LIMIT) throw Error("Request too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
function origin(server) {
  return `http://127.0.0.1:${server.address().port}`;
}
function headers(req, res, server) {
  if (req.headers.host !== `127.0.0.1:${server.address().port}`)
    throw Error("Invalid Host");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
}
const preview = http.createServer(async (req, res) => {
  try {
    headers(req, res, preview);
    res.setHeader("Content-Security-Policy", "default-src 'none'; base-uri 'none'; form-action 'none'");
    if (!["GET", "HEAD"].includes(req.method))
      return json(res, 405, { error: "Read-only preview" });
    const u = new URL(req.url, origin(preview));
    const parts = u.pathname.split("/");
    const b = readers.get(parts[2]);
    if (parts[1] !== "view" || !b)
      return json(res, 404, { error: "Not found" });
    const readBase = origin(preview) + "/view/" + b.read + "/";
    res.setHeader("Content-Security-Policy",
      `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: ${readBase}; style-src 'unsafe-inline' ${readBase}; img-src data: blob: ${readBase}; connect-src ${readBase}; font-src data: ${readBase}; media-src data: blob: ${readBase}; frame-src blob: ${readBase}; object-src 'none'; base-uri ${readBase}; form-action 'none'`);
    const name = parts.slice(3).map(decodeURIComponent).join("/");
    if (req.headers.origin === origin(editor))
      res.setHeader("Access-Control-Allow-Origin", origin(editor));
    if (name === "__version") {
      return json(res, 200, {
        version: (await files(b.root))
          .map((f) => f.name + ":" + f.mtime + ":" + f.size)
          .join("|"),
      });
    }
    if (name === "__live.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(
        `(()=>{if(window.top!==window)return;let version;setInterval(async()=>{try{const r=await fetch('/view/${b.read}/__version');const v=(await r.json()).version;if(version!==undefined&&v!==version)location.reload();version=v}catch{}},1600)})();`,
      );
    }
    const f = await safe(b.root, name);
    const stat = await fs.stat(f);
    if (!stat.isFile() || stat.size > LIMIT)
      return json(res, 413, { error: "Unsupported file size" });
    let data = await fs.readFile(f);
    const type =
      mime[path.extname(name).toLowerCase()] || "application/octet-stream";
    res.setHeader("Content-Type", type);
    if (type === "text/html" && !u.searchParams.has("source"))
      data = Buffer.concat([
        data,
        Buffer.from(`<script src="/view/${b.read}/__live.js"></script>`),
      ]);
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (e) {
    json(res, e.status || 400, { error: e.message, message: e.message, code: e.code });
  }
});
const editor = http.createServer(async (req, res) => {
  try {
    headers(req, res, editor);
    if (req.headers.origin && req.headers.origin !== origin(editor))
      return json(res, 403, { error: "Cross-origin editor access denied" });
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${origin(preview)}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${origin(preview)}; connect-src 'self' ${origin(preview)}; frame-src 'self' ${origin(preview)} blob:; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'self' ${origin(preview)}; form-action 'none'`,
    );
    const u = new URL(req.url, origin(editor));
    if (u.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (
      (u.pathname.startsWith("/assets/") ||
        u.pathname === "/remixicon.ttf" ||
        u.pathname === "/fonts/AlbertSans-VariableFont_wght.ttf") &&
      req.method === "GET"
    ) {
      const name =
        u.pathname === "/fonts/AlbertSans-VariableFont_wght.ttf"
          ? "AlbertSans.ttf"
          : path.basename(u.pathname);
      if (
        ![
          "studio.js",
          "studio.css",
          "icon.png",
          "remixicon.ttf",
          "AlbertSans.ttf",
        ].includes(name)
      )
        throw Error("Unknown asset");
      res.setHeader("Content-Type", mime[path.extname(name)] || "font/ttf");
      return res.end(await fs.readFile(path.join(pkg, "assets", name)));
    }
    let parts = u.pathname.split("/");
    if (parts[1] === "studio" && req.method === "GET") {
      const b = editors.get(parts[2]);
      if (!b) throw Error("Expired workspace");
      const cfg = {
        id: b.edit,
        sessionId: b.sessionId,
        previewBase: origin(preview) + "/view/" + b.read + "/",
        locale: b.locale,
        activeFile: u.searchParams.get("file") || null,
        projectDir: b.root,
      };
      res.setHeader("Content-Type", "text/html");
      return res.end(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenDesign</title><link rel="stylesheet" href="/assets/studio.css"></head><body><div id="root"></div><script>window.OD=${JSON.stringify(cfg).replace(/</g, "\\u003c")}</script><script src="/assets/studio.js"></script></body></html>`,
      );
    }
    const b = editors.get(parts[3]);
    if (parts[1] !== "api" || parts[2] !== "projects" || !b)
      return json(res, 404, { error: "Unknown workspace" });
    if (parts[4] === "deployments") return json(res, 200, { deployments: [] });
    if (parts[4] === "collab" && parts[5] === "status")
      return json(res, 200, { syncState: "local_only", ownerMemberId: null });
    if (["comments", "feedback"].includes(parts[4])) {
      let payload = null;
      try {
        payload = req.method === "POST" ? JSON.parse((await body(req)).toString()) : null;
        if (req.method === "POST" && (!payload || typeof payload !== "object" || Array.isArray(payload)))
          throw Error("Invalid feedback payload");
      } catch (e) {
        // No feedback handler or Agent dispatch has run at this point.
        if (parts[4] === "feedback" && req.method === "POST")
          return json(res, 400, {error:e.message, code:"FEEDBACK_REJECTED"});
        throw e;
      }
      const result = await feedback.handle(
        b,
        parts.slice(4).join("/"),
        req.method,
        payload,
        write,
      );
      return json(res, 200, result);
    }
    if (parts[4] === "files" && parts.length > 5 && parts.at(-1) === "versions")
      return json(res, 200, { versions: [] });
    if (parts[4] === "files" && req.method === "GET")
      return json(res, 200, { files: await files(b.root) });
    if (parts[4] === "files" && req.method === "POST") {
      const data = JSON.parse((await body(req)).toString());
      if (typeof data.content !== "string") throw Error("Missing content");
      return json(res, 200, {
        file: await write(
          b,
          data.name,
          Buffer.from(
            data.content,
            data.encoding === "base64" ? "base64" : "utf8",
          ),
          data.expectedRevision,
        ),
      });
    }
    if (parts[4] === "upload" && req.method === "POST") {
      const data = await body(req);
      const form = await new Request(origin(editor), {
        method: "POST",
        headers: { "Content-Type": req.headers["content-type"] },
        body: data,
      }).formData();
      const output = [];
      for (const file of form.getAll("files")) {
        const name = validName(file.name);
        try {
          await fs.access(await safe(b.root, name, true));
          throw Error("File already exists: " + name);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        output.push(
          await write(b, name, Buffer.from(await file.arrayBuffer()), null),
        );
      }
      return json(res, 200, { files: output });
    }
    if (parts[4] === "raw" && req.method === "DELETE") {
      if (b.readOnly) throw Error("Read-only session");
      await fs.unlink(
        await safe(b.root, parts.slice(5).map(decodeURIComponent).join("/")),
      );
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: "Unsupported operation" });
  } catch (e) {
    json(res, e.status || 400, { error: e.message, message: e.message, code: e.code });
  }
});
const listen = (s) =>
  new Promise((resolve, reject) => {
    s.once("error", reject);
    s.listen(0, "127.0.0.1", resolve);
  });
let started;
async function start() {
  if (!started) started = Promise.all([listen(editor), listen(preview)]);
  await started;
}
const revision = (html) =>
  crypto.createHash("sha256").update(html).digest("hex");
async function draftRead(b, file) {
  let html;
  try {
    html = await fs.readFile(await safe(b.root, file), "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    html = null;
  }
  const sketches = [];
  for (const f of (await files(b.root))
    .filter((f) => f.kind === "sketch")
    .slice(0, 20)) {
    if (f.size < 200000)
      sketches.push({
        file: f.name,
        content: await fs.readFile(await safe(b.root, f.name), "utf8"),
      });
  }
  return {
    html: html ?? "",
    cardHtml: cardPreview(html ?? ""),
    revision: html === null ? null : revision(html),
    sketches,
    feedback: await feedback.read(b),
  };
}
async function invoke(method, p) {
  if (method === "feedback-claim")
    return feedback.claim(p.requestId, p.sessionId);
  if (method === "feedback-result")
    return feedback.finish(p.requestId, p.sessionId, p.status, p.message);
  if (method === "draft-read" || method === "draft-write") {
    const b = bindings.get(p.sessionId);
    if (!b) throw Error("Session is not bound");
    if (!/\.html?$/i.test(p.file)) throw Error("HTML draft required");
    if (method === "draft-read") return draftRead(b, p.file);
    if (
      typeof p.html !== "string" ||
      !p.html.trim() ||
      Buffer.byteLength(p.html) > 1024 * 1024
    )
      throw Error("Provide 1–1048576 bytes of complete HTML");
    await write(b, p.file, Buffer.from(p.html), p.expectedRevision);
    return draftRead(b, p.file);
  }
  if (method === "prepare") {
    if (!p.workdir || !path.isAbsolute(p.workdir))
      throw Error("Local workspace required");
    const parent = await fs.realpath(p.workdir);
    const container = path.join(parent, "opendesign-projects");
    await fs.mkdir(container, { recursive: true });
    if ((await fs.lstat(container)).isSymbolicLink())
      throw Error("Unsafe project container");
    const dir = path.join(container, crypto.randomUUID());
    await fs.mkdir(dir);
    await fs.writeFile(
      path.join(dir, ".opendesign-project.json"),
      JSON.stringify({ version: 1 }),
    );
    await fs.writeFile(
      path.join(dir, "AGENTS.md"),
      "# OpenDesign project\nThis is a dedicated Cindy design workspace. Use Cindy native conversation and tools; never launch plugin errands or configure a separate model. Write interactive HTML, CSS, JS and assets here. OpenDesign watches files for updates. Before every follow-up edit, use opendesign_context for the current draft and revision, then opendesign_update. Keep the same draft and session. opendesign_open publishes a clickable artifact card. Read user-saved *.sketch.json before applying canvas changes. Native webpage annotations arrive in this same session.\n",
    );
    return { dir };
  }
  if (method === "bind") {
    if (!/^[0-9a-f-]{36}$/i.test(p.sessionId))
      throw Error("Trusted session required");
    const root = await fs.realpath(p.root);
    const markerPath = path.join(root, ".opendesign-project.json");
    if ((await fs.lstat(markerPath)).isSymbolicLink())
      throw Error("Unsafe project marker");
    const marker = JSON.parse(await fs.readFile(markerPath, "utf8"));
    if (marker.sessionId && marker.sessionId !== p.sessionId)
      throw Error("Project belongs to a different Cindy session");
    if (marker.version !== 1)
      throw Error(
        "Not an OpenDesign project; create a dedicated session first",
      );
    if (!path.isAbsolute(root)) throw Error("Local directory required");
    if (bindings.has(p.sessionId) && bindings.get(p.sessionId).root !== root)
      throw Error("Session already bound elsewhere");
    if (!marker.sessionId)
      await fs.writeFile(
        markerPath,
        JSON.stringify({ version: 1, sessionId: p.sessionId }),
      );
    await start();
    let b = bindings.get(p.sessionId);
    if (!b) {
      b = {
        root,
        sessionId: p.sessionId,
        readOnly: !!p.readOnly,
        locale: p.locale || "en",
        edit: token(),
        read: token(),
      };
      bindings.set(p.sessionId, b);
      editors.set(b.edit, b);
      readers.set(b.read, b);
    } else {
      b.readOnly = !!p.readOnly;
      b.locale = p.locale || "en";
    }
    return {
      sessionId: b.sessionId,
      projectDir: root,
      url: origin(editor) + "/studio/" + b.edit + "/",
      previewBase: origin(preview) + "/view/" + b.read + "/",
      files: await files(root),
    };
  }
  throw Error("Unknown method");
}
function run() {
  feedback.setEmitter((m) => process.stdout.write(JSON.stringify(m) + "\n"));
  readline
    .createInterface({ input: process.stdin })
    .on("line", async (line) => {
      let m;
      try {
        m = JSON.parse(line);
        const result = await invoke(m.method, m.params || {});
        process.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\n",
        );
      } catch (e) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: m?.id ?? null,
            error: { code: -32000, message: e.message },
          }) + "\n",
        );
      }
    });
  process.stdin.on("end", () => {
    editor.close();
    preview.close();
    process.exit(0);
  });
}
module.exports = {
  run,
  invoke,
  safe,
  close: () =>
    Promise.all([
      new Promise((r) => editor.close(r)),
      new Promise((r) => preview.close(r)),
    ]),
};
