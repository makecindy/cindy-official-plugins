/* Session-owned artifacts. Native Cindy conversation is the only model executor. */
(() => {
  let queue = Promise.resolve();
  let locale = "en";
  async function hostLocale() {
    try {
      const r = await cindy.request({ kind: "app-context" });
      locale = ["zh-CN", "en", "ja", "ko"].includes(r.context?.locale)
        ? r.context.locale
        : "en";
    } catch {}
    return locale;
  }
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  async function node(method, params) {
    const r = await cindy.node.request({ method, params });
    if (!r.ok) throw Error(r.message || "Local workbench failed");
    return r.result;
  }
  async function read(key) {
    const r = await cindy.send({
      type: "fs-request",
      root: "data",
      op: "read",
      path: key,
    });
    if (r.ok) return JSON.parse(r.content);
    if (
      ["NOT_FOUND", "FILE_NOT_FOUND", "ENOENT"].includes(r.errorCode) ||
      r.message === "文件不存在:" + key
    )
      return null;
    throw Error(r.message || "Cannot read artifact binding");
  }
  async function save(key, data) {
    const r = await cindy.send({
      type: "fs-request",
      root: "data",
      op: "write",
      path: key,
      content: JSON.stringify(data),
    });
    if (!r.ok) throw Error(r.message || "Cannot save artifact binding");
  }
  const stateKey = (id) => "sessions/" + id + ".json";
  const instructions =
    "This session is editing the current OpenDesign draft. For follow-up requests such as change this, colors or layout, call opendesign_context first, read its latest html, saved sketches and feedback (including local screenshot paths), then opendesign_update with expectedRevision and the complete revised HTML. Keep the same draft/session/file. Do not start a new session, directory, model or errand. Tool results produce preview cards; only user card clicks open the right sidebar. If editing files with native tools, call opendesign_open afterwards to publish the updated card.";
  async function bind(d) {
    return node("bind", {
      sessionId: d.sessionId,
      root: d.root,
      readOnly: false,
      locale: await hostLocale(),
    });
  }
  async function context(d) {
    await bind(d);
    return node("draft-read", { sessionId: d.sessionId, file: d.file });
  }
  function card(d, c, note = "") {
    const body =
      c.cardHtml || '<p style="padding:24px">' + esc(d.title) + "</p>";
    return `<div style="border:1px solid #d9ddd3;border-radius:14px;overflow:hidden"><div style="height:220px;overflow:hidden;pointer-events:none;background:#fff"><div style="width:960px;zoom:.46;transform-origin:top left">${body}</div></div><div style="padding:14px;background:#f5f5f1;color:#242b20;font-family:system-ui,sans-serif"><strong style="font:600 15px/1.4 system-ui">${esc(d.title)}</strong><p style="font-size:12px">OpenDesign · 稿件 ${esc(d.id.slice(0, 8))} · ${esc((c.revision || "未保存").slice(0, 8))}</p><button style="border:0;border-radius:8px;background:#252c21;color:white;padding:9px 14px;font:500 12px system-ui" data-ghost-action="open">${locale === "zh-CN" ? "打开稿件" : "Open design"}</button> <button style="border:1px solid #d2d7ca;border-radius:8px;background:transparent;color:#252c21;padding:9px 14px;font:500 12px system-ui" data-ghost-action="canvas">${locale === "zh-CN" ? "选区与画板" : "Annotate / canvas"}</button>${note ? "<p>" + esc(note) + "</p>" : ""}</div></div>`;
  }
  async function publish(msg, d, c) {
    await save("cards/" + msg.callId + ".json", {
      sessionId: d.sessionId,
      draftId: d.id,
    });
    await cindy.send({
      type: "card-update",
      callId: msg.callId,
      v: 2,
      state: "done",
      height: 330,
      html: card(d, c),
    });
  }
  async function action(msg) {
    const ref = await read("cards/" + msg.callId + ".json");
    if (!ref || !msg.sessionId || ref.sessionId !== msg.sessionId)
      throw Error("Card session binding mismatch; preview was not opened.");
    const d = await read(stateKey(ref.sessionId));
    if (!d || d.id !== ref.draftId)
      throw Error(
        "Draft binding unavailable. Reopen from its original conversation.",
      );
    if (!["open", "canvas"].includes(msg.actionId))
      throw Error("Unknown card action");
    const b = await bind(d),
      c = await context(d);
    const url = b.url + "?file=" + encodeURIComponent(d.file);
    const r = await cindy.preview({ url, sessionId: d.sessionId });
    await cindy.send({
      type: "card-update",
      callId: msg.callId,
      v: 2,
      state: "done",
      height: 330,
      html: card(d, c, r.ok ? "" : r.message || "打开失败，请稍后点击重试"),
    });
    // Settle the host's spawned activity slot too; no Agent is launched.
    if (msg.spawnCallId)
      await cindy.send({
        type: "card-update",
        callId: msg.spawnCallId,
        v: 2,
        state: "done",
        height: 120,
        html:
          "<p>" +
          esc(r.ok ? "稿件已在所属会话的右侧打开。" : r.message || "打开失败") +
          "</p>",
      });
  }
  async function tool(msg) {
    const a = msg.args || {},
      ctx = a.session_context;
    if (
      !ctx?.session_id ||
      !ctx.workdir ||
      !ctx.workdir_is_local ||
      !/^[a-zA-Z0-9-]{1,64}$/.test(ctx.session_id)
    )
      throw Error("Trusted local session required");
    if (ctx.workdir_is_read_only) throw Error("This session is read-only");
    let d = await read(stateKey(ctx.session_id));
    if (msg.tool === "opendesign_new") {
      if (d && d.initialization !== "pending")
        throw Error(
          "This session already owns a draft. Call opendesign_context, then opendesign_update to continue it.",
        );
      if (typeof a.html !== "string" || !a.html.trim())
        throw Error("Provide generated HTML to create a draft card.");
      const recovering = !!d;
      if (!d) {
        const p = await node("prepare", { workdir: ctx.workdir });
        d = {
          id: crypto.randomUUID(),
          sessionId: ctx.session_id,
          root: p.dir,
          file: "design.html",
          title: String(a.title || "新设计").slice(0, 100),
          initialization: "pending",
        };
        // Reserve the same project across failures/restarts, without claiming
        // that a manuscript already exists. Recovery never allocates another.
        await save(stateKey(d.sessionId), d);
      }
      if (d.sessionId !== ctx.session_id) throw Error("Session binding mismatch");
      await bind(d);
      const existing = recovering
        ? await node("draft-read", { sessionId: d.sessionId, file: d.file })
        : null;
      // A write may have completed before its receipt/final state was saved.
      // Preserve that file; only create if the server proves it is absent.
      if (!recovering || existing?.revision === null) {
        await node("draft-write", {
          sessionId: d.sessionId,
          file: d.file,
          html: a.html,
          expectedRevision: null,
        });
      } else if (typeof existing?.revision !== "string" || !existing.revision) {
        throw Error("Draft initialization result is unknown; inspect the existing project before continuing.");
      }
      d = { ...d, initialization: "ready" };
      await save(stateKey(d.sessionId), d);
    } else if (
      ![
        "opendesign_context",
        "opendesign_update",
        "opendesign_open",
        "opendesign_preview",
      ].includes(msg.tool)
    )
      throw Error("Unknown tool");
    if (!d) {
      // Adopt only an already-marked v0.2 project owned by this exact session.
      const b = await node("bind", {
        sessionId: ctx.session_id,
        root: ctx.workdir,
        readOnly: false,
      });
      const choices = b.files.filter((f) => f.kind === "html");
      const f = a.file
        ? choices.find((f) => f.name === a.file)
        : choices.length === 1
          ? choices[0]
          : null;
      if (!f)
        throw Error(
          "No current draft. Generate HTML with opendesign_new, or select a legacy HTML file with opendesign_open.",
        );
      d = {
        id: crypto.randomUUID(),
        sessionId: ctx.session_id,
        root: ctx.workdir,
        file: f.name,
        title: f.name,
      };
      await save(stateKey(d.sessionId), d);
    }
    if (d.sessionId !== ctx.session_id) throw Error("Session binding mismatch");
    await bind(d);
    if (msg.tool === "opendesign_update")
      await node("draft-write", {
        sessionId: d.sessionId,
        file: d.file,
        html: a.html,
        expectedRevision: a.expectedRevision,
      });
    const c = await context(d);
    if (msg.tool !== "opendesign_context") await publish(msg, d, c);
    await cindy.send({
      type: "tool-result",
      callId: msg.callId,
      ok: true,
      result: {
        draftId: d.id,
        sessionId: d.sessionId,
        title: d.title,
        file: d.file,
        projectDir: d.root,
        revision: c.revision,
        ...(msg.tool === "opendesign_context"
          ? { html: c.html, sketches: c.sketches, feedback: c.feedback }
          : {}),
        entry:
          "Click the artifact card to open this draft in its fixed session sidebar.",
        instructions,
      },
    });
  }
  async function feedbackEvent(msg) {
    const { requestId, sessionId } = msg.params || {};
    const request = await node("feedback-claim", { requestId, sessionId });
    let d;
    try {
      d = await read(stateKey(sessionId));
      if (!d || d.sessionId !== sessionId) throw Error("稿件尚未绑定此会话");
    } catch (e) {
      await node("feedback-result", {
        requestId,
        sessionId,
        status: "rejected",
        message: e.message,
      });
      return;
    }
    if (request.projectDir !== d.root || request.file !== d.file) {
      await node("feedback-result", {
        requestId,
        sessionId,
        status: "rejected",
        message: "反馈与当前稿件不一致，未发送",
      });
      return;
    }
    let result;
    try {
      result = await cindy.agent.run({
        mode: "continue",
        trigger: "background",
        sessionId: d.sessionId,
        promptTemplate:
          "用户在 OpenDesign 稿件中提交修改：{{user_message}}\n稿件与选区：{{event_json}}\n先读取 opendesign_context 的最新 HTML、草图和 feedback。阅读附带的本地截图文件，然后修改同一稿件，用 opendesign_update 保存结果。不要新建会话或稿件。",
        userMessage:
          request.note ||
          request.attachments
            .map((a) => a.comment)
            .filter(Boolean)
            .join("\n") ||
          "请按 OpenDesign 中提交的选区或绘制标注修改稿件。",
        event: { draftId: d.id, file: d.file, projectDir: d.root, request },
      });
    } catch (e) {
      await node("feedback-result", {
        requestId,
        sessionId,
        status: "unknown",
        message: "提交结果未知，请先核对原会话，不要重复发送",
      });
      return;
    }
    const matching = result?.sessionId === d.sessionId;
    await node("feedback-result", {
      requestId,
      sessionId,
      status:
        result?.ok === true && matching
          ? result.disposition === "queued"
            ? "queued"
            : "accepted"
          : result?.ok === false
            ? "rejected"
            : "unknown",
      message:
        result?.ok === true && matching
          ? undefined
          : result?.ok !== false
            ? "宿主返回未确认结果或会话不一致；请先核对相关会话，勿重复发送"
            : result.message || "宿主未接受本次提交",
    });
  }
  cindy.onHostMessage((msg) => {
    if (
      msg.type !== "tool-call" &&
      !(
        msg.type === "event" &&
        ["card-action", "node-notification"].includes(msg.name)
      )
    )
      return;
    if (
      msg.name === "node-notification" &&
      msg.method !== "opendesign-feedback"
    )
      return;
    const run = async () => {
      try {
        await (msg.type === "tool-call"
          ? tool(msg)
          : msg.name === "node-notification"
            ? feedbackEvent(msg)
            : action(msg));
      } catch (e) {
        if (msg.type === "tool-call")
          await cindy.send({
            type: "tool-result",
            callId: msg.callId,
            ok: false,
            errorCode: "OPENDESIGN_ERROR",
            message: e.message,
          });
        else if (msg.name === "card-action")
          await cindy.send({
            type: "card-update",
            callId: msg.spawnCallId || msg.callId,
            v: 2,
            state: "done",
            height: 120,
            html: "<p>" + esc(e.message) + "</p>",
          });
      }
    };
    queue = queue.then(run, run);
    return queue;
  });
})();
