import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileViewer } from "../latest/apps/web/src/components/FileViewer";
import { I18nProvider } from "../latest/apps/web/src/i18n";
import { ANNOTATION_EVENT } from "../latest/apps/web/src/components/PreviewDrawOverlay";
import { SketchEditor } from "./upstream/components/SketchEditor";
import { I18nProvider as SketchI18n } from "./upstream/i18n";
import "../latest/apps/web/src/index.css";
import "./studio.css";
const ui = (zh: string, en: string) =>
  (window as any).OD?.locale === "zh-CN" ? zh : en;
const cfg = (window as any).OD,
  api = "/api/projects/" + cfg.id;
async function request(route: string, body?: any) {
  const r = await fetch(
    api + route,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await r.json();
  if (!r.ok)
    throw Error(data.error || data.message || ui("请求失败", "Request failed"));
  return data;
}
async function serializeImages(images: File[] = []) {
  return Promise.all(
    images.map(async (f) => ({
      name: f.name,
      type: f.type,
      base64: await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(f);
      }),
    })),
  );
}
function Studio() {
  const [files, setFiles] = useState<any[]>([]),
    [comments, setComments] = useState<any[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [active, setActive] = useState(cfg.activeFile || ""),
    [sketch, setSketch] = useState(false),
    [items, setItems] = useState<any[]>([]);
  async function refresh() {
    try {
      const r = await request("/files");
      setFiles(r.files);
      setComments((await request("/comments")).comments);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 1800);
    return () => clearInterval(id);
  }, []);
  async function send(payload: any, images: File[] = []) {
    setError("");
    setNotice("");
    let submitted = false;
    let outcome: "rejected" | "unknown" = "rejected";
    try {
      const serialized = await serializeImages(images);
      submitted = true;
      outcome = "unknown";
      let result = await request("/feedback", {
        ...payload,
        images: serialized,
        file: active,
      });
      const deadline = Date.now() + 55000;
      while (result.status === "pending") {
        if (Date.now() > deadline)
          throw Error(
            ui(
              "提交尚未确认，请先查看原会话，不要重复发送",
              "Submission is not confirmed. Check the original conversation before resending.",
            ),
          );
        await new Promise((r) => setTimeout(r, 600));
        result = await request("/feedback/" + result.requestId);
      }
      if (result.status === "unknown")
        throw Error(
          ui(
            "提交结果未确认，请先查看本会话，勿重复发送",
            "Unknown submission outcome. Check this conversation before resending.",
          ),
        );
      if (result.status === "rejected") {
        outcome = "rejected";
        throw Error(
          result.message ||
            ui("Cindy 未接受本次修改", "Cindy did not accept this revision."),
        );
      }
      if (!["accepted", "queued", "draft"].includes(result.status))
        throw Error("Unknown feedback response");
      setNotice(
        result.status === "draft"
          ? ui(
              "修改意见已保存在稿件中；在左侧继续对话时会读取。",
              "Feedback saved with the manuscript for your next conversation turn.",
            )
          : ui(
              "已提交到本稿件所属 Cindy 会话",
              "Submitted to this manuscript’s Cindy conversation.",
            ),
      );
      await refresh();
      return result;
    } catch (e: any) {
      const status = submitted ? outcome : "rejected";
      const message = status === "unknown" ? ui(
        "提交结果未确认，请先查看本会话，勿重复发送",
        "Unknown submission outcome. Check this conversation before resending.",
      ) : e?.message || ui("提交前处理失败", "Failed before submission.");
      setError(message);
      throw Object.assign(new Error(message), { status });
    }
  }
  useEffect(() => {
    const handler = (e: any) => {
      const d = e.detail;
      void send(
        {
          note: d.note,
          target: d.target,
          markKind: d.markKind,
          bounds: d.bounds,
          action: d.action,
        },
        [d.file, ...(d.extraFiles || [])].filter(Boolean),
      ).then(
        () => d.ack({ ok: true }),
        (err) => d.ack({ ok: false, message: err.message }),
      );
    };
    window.addEventListener(ANNOTATION_EVENT, handler);
    return () => window.removeEventListener(ANNOTATION_EVENT, handler);
  }, [active]);
  const file =
    files.find((f) => f.name === active) ||
    files.find((f) => f.kind === "html");
  useEffect(() => {
    if (file && !active) setActive(file.name);
  }, [file?.name]);
  return (
    <div className="od-shell">
      <header className="od-header">
        <img src="/assets/icon.png" />
        <strong>OpenDesign</strong>
        <span>Cindy · {cfg.sessionId.slice(0, 8)}</span>
        <select
          aria-label="当前稿件"
          value={file?.name || ""}
          onChange={(e) => {
            setActive(e.target.value);
            setSketch(false);
          }}
        >
          {files
            .filter((f) => f.kind === "html")
            .map((f) => (
              <option key={f.name}>{f.name}</option>
            ))}
        </select>
        <button
          onClick={async () => {
            try {
              const r = await fetch(
                cfg.previewBase + "canvas.sketch.json?source=1",
              );
              if (r.ok) setItems((await r.json()).items || []);
            } catch {}
            setSketch(!sketch);
          }}
        >
          {ui("草图", "Sketch")}
        </button>
      </header>
      <div
        id="app-chrome-file-actions"
        className="app-chrome-file-actions"
        data-app-chrome-file-actions="true"
      />
      {error && (
        <div className="od-hint" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="od-hint" role="status">
          {notice}
        </div>
      )}
      {sketch ? (
        <SketchI18n initial={cfg.locale}>
          <SketchEditor
            items={items}
            onItemsChange={setItems}
            fileName="canvas.sketch.json"
            dirty={true}
            onSave={async () => {
              await request("/files", {
                name: "canvas.sketch.json",
                content: JSON.stringify({ version: 1, items }),
              });
              setNotice(
                ui(
                  "草图已保存，继续对话时 Cindy 会读取。",
                  "Sketch saved for the next conversation turn.",
                ),
              );
            }}
            onCancel={() => setSketch(false)}
          />
        </SketchI18n>
      ) : file ? (
        <FileViewer
          key={file.name}
          projectId={cfg.id}
          projectKind="web"
          file={file}
          filesRefreshKey={file.mtime}
          projectName={file.name}
          projectDir={cfg.projectDir}
          previewComments={comments}
          onFileSaved={refresh}
          onFileWritten={refresh}
          onSavePreviewComment={async (target, note, _attach, images, id) => {
            try {
              const r = await request("/comments", {
                target,
                note,
                id,
                images: await serializeImages(images),
              });
              await refresh();
              return r.comment;
            } catch (e: any) {
              setError(e.message);
              return null;
            }
          }}
          onRemovePreviewComment={async (id) => {
            await request("/comments", { remove: id });
            await refresh();
            return true;
          }}
          onReorderPreviewComment={async (id, sortKey) => {
            await request("/comments", { id, sortKey });
            await refresh();
          }}
          onSendBoardCommentAttachments={async (attachments, images) => {
            try {
              const r = await send({ attachments, action: "send" }, images);
              return {
                status: r.status === "queued" ? "queued" : "accepted",
                commentIds: attachments.map((a) => a.id),
              };
            } catch (e: any) {
              return { status: e.status === "rejected" ? "rejected" : "unknown", commentIds: [] };
            }
          }}
        />
      ) : (
        <p className="od-hint">
          {ui(
            "在左侧 Cindy 对话中描述设计，生成后会显示在这里。",
            "Describe a design in the Cindy conversation to display it here.",
          )}
        </p>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <I18nProvider initial={cfg.locale}>
    <Studio />
  </I18nProvider>,
);
