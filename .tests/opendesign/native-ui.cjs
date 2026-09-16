const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const w = require("../../opendesign-trial/node/server.cjs"),
  feedback = require("../../opendesign-trial/node/feedback.cjs"),
  vm = require("node:vm");
const {
  chromium,
} = require("../../opendesign-trial/source/build/node_modules/playwright");
test("upstream OpenDesign viewer renders and exposes native interaction tools", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "opendesign-native-"));
  let browser;
  try {
    const p = await w.invoke("prepare", { workdir: temp });
    const sid = crypto.randomUUID();
    const b = await w.invoke("bind", {
      root: p.dir,
      sessionId: sid,
      locale: "zh-CN",
    });
    await w.invoke("draft-write", {
      sessionId: sid,
      file: "design.html",
      expectedRevision: null,
      html: '<!doctype html><html><head><style>body{font-family:system-ui;padding:60px}h1{color:#8c4310}button{padding:16px}</style></head><body><h1 id="hero">Coffee for everyone</h1><p id="intro">Fresh every morning.</p><button id="order" onclick="this.textContent=\'Ordered\'">Order coffee</button></body></html>',
    });
    let handler;
    const sent = [];
    const disk = new Map([
      [
        "sessions/" + sid + ".json",
        JSON.stringify({
          sessionId: sid,
          id: "draft-test",
          root: p.dir,
          file: "design.html",
          title: "Design",
        }),
      ],
    ]);
    vm.runInNewContext(
      await fs.readFile(
        path.join(__dirname, "../../opendesign-trial/main.js"),
        "utf8",
      ),
      {
        crypto: crypto.webcrypto,
        cindy: {
          request: async () => ({ context: { locale: "zh-CN" } }),
          onHostMessage: (h) => (handler = h),
          node: {
            request: async (x) => ({
              ok: true,
              result: await w.invoke(x.method, x.params),
            }),
          },
          send: async (x) =>
            x.type === "fs-request"
              ? { ok: true, content: disk.get(x.path) }
              : { ok: true },
          agent: {
            run: async (x) => {
              sent.push(x);
              return { ok: true, sessionId: sid, disposition: "queued" };
            },
          },
        },
      },
    );
    feedback.setEmitter((n) =>
      handler({
        type: "event",
        name: "node-notification",
        method: n.method,
        params: n.params,
      }),
    );
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.OPENDESIGN_CHROMIUM_PATH || undefined,
    });
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
    });
    const errors = [],
      failed = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) failed.push(r.url() + ":" + r.status());
    });
    page.on("console", (m) => {
      if (m.type() === "error") console.log("console", m.text().slice(0, 180));
    });
    await page.goto(b.url + "?file=design.html");
    await page.waitForTimeout(1800);
    await page
      .frameLocator("[data-testid=artifact-preview-frame]")
      .getByRole("button", { name: "Order coffee", exact: true })
      .click();
    await page
      .frameLocator("[data-testid=artifact-preview-frame]")
      .getByRole("button", { name: "Ordered", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "注释", exact: true }).click();
    await page
      .frameLocator("[data-testid=artifact-preview-frame]")
      .locator("#hero")
      .click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder("评论此元素…").fill("把标题改成 Good morning");
    await page.getByRole("button", { name: "发送到聊天", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "已提交" }).waitFor();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].sessionId, sid);
    assert.equal(sent[0].mode, "continue");
    assert.match(sent[0].userMessage, /Good morning/);
    assert.ok(sent[0].event.request.attachments[0].selector);
    console.log("Native annotation send passed");
    await page.route("**/api/projects/*/feedback", route => route.fulfill({
      contentType: "application/json", body: JSON.stringify({status: "unknown"}),
    }));
    await page.frameLocator("[data-testid=artifact-preview-frame]").locator("#hero").click();
    await page.getByPlaceholder("评论此元素…").fill("Keep uncertain feedback");
    await page.getByRole("button", {name: "发送到聊天", exact: true}).click();
    await page.getByRole("alert").filter({hasText: "提交结果未确认"}).waitFor();
    assert.equal(await page.getByPlaceholder("评论此元素…").inputValue(), "Keep uncertain feedback");
    assert.equal(sent.length, 1);
    await page.unroute("**/api/projects/*/feedback");

    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page
      .frameLocator("[data-testid=artifact-preview-frame]")
      .locator("#hero")
      .click();
    await page.waitForTimeout(500);
    await page.locator("textarea").fill("Morning coffee");
    await page
      .locator(".cc-row")
      .filter({ has: page.locator(".cc-label", { hasText: /^文本颜色$/ }) })
      .locator("input")
      .first()
      .fill("#112233");
    await page
      .locator(".cc-row")
      .filter({ has: page.locator(".cc-label", { hasText: /^背景$/ }) })
      .locator("input")
      .first()
      .fill("#abcdef");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForTimeout(600);
    assert.match(
      await fs.readFile(path.join(p.dir, "design.html"), "utf8"),
      /Morning coffee/,
    );
    assert.ok(
      !(await fs.readFile(path.join(p.dir, "design.html"), "utf8")).includes(
        "od:comment",
      ),
    );
    const savedHtml = await fs.readFile(
      path.join(p.dir, "design.html"),
      "utf8",
    );
    assert.match(savedHtml, /#112233|rgb\(17, 34, 51\)/);
    assert.match(savedHtml, /#abcdef|rgb\(171, 205, 239\)/);
    console.log(
      "Native manual edit and exact text/background hex values persisted",
    );
    await page.getByRole("button", { name: "标记", exact: true }).click();
    await page.waitForTimeout(300);
    const box = await page.locator("canvas").boundingBox();
    await page.mouse.move(box.x + 60, box.y + 70);
    await page.mouse.down();
    await page.mouse.move(box.x + 390, box.y + 155, { steps: 8 });
    await page.mouse.up();
    await page.getByPlaceholder("为这个标记添加说明").fill("放大框选区域");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForFunction(() =>
      document.body.innerText.includes("已提交"),
    );
    for (let i = 0; i < 80 && sent.length < 2; i++)
      await page.waitForTimeout(100);
    assert.equal(sent.length, 2);
    assert.equal(sent[1].sessionId, sid);
    assert.ok(sent[1].event.request.images.length > 0);
    const imageFile = sent[1].event.request.images[0].path;
    assert.ok((await fs.stat(path.join(p.dir, imageFile))).size > 100);
    console.log("Native draw screenshot reached same-session model adapter");
    await w.invoke("draft-write", {
      sessionId: sid,
      file: "design.html",
      html: "<h1 id=hero>Updated by Cindy</h1>",
      expectedRevision: (
        await w.invoke("draft-read", { sessionId: sid, file: "design.html" })
      ).revision,
    });
    await page
      .frameLocator("[data-testid=artifact-preview-frame]")
      .getByText("Updated by Cindy")
      .waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await w.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
