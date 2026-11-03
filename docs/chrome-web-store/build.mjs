// Render the archived store layouts. Optional --capture-ui refreshes sample UI
// from a local extension checkout; it never contacts Cindy or a model provider.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const out = path.join(repo, ".build/chrome-web-store");
const ext = path.resolve(
  process.env.EXTENSION_SOURCE || path.join(repo, "my-browser/extension"),
);
const iconSource = path.join(here, "assets/icon.svg");
await fs.mkdir(out, { recursive: true });
for (const directory of ["assets", "source", "copy"])
  await fs.cp(path.join(here, directory), path.join(out, directory), {
    recursive: true,
  });
for (const file of [
  "index.html",
  "README.md",
  "README.zh-CN.md",
  "submission.json",
])
  await fs.copyFile(path.join(here, file), path.join(out, file));
await fs.mkdir(path.join(out, "screenshots"), { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
    : {}),
});
try {
  if (process.argv.includes("--capture-ui")) {
    const translations = {
      "A little more room to think.": "给思考，多留一点空间。",
      "A quieter way to work": "让工作从容一点",
      "Good ideas need room. A useful assistant helps us spend less time moving information and more time making sense of it.":
        "好想法需要空间。一个得力的助手，让我们少花时间搬运信息，把更多精力留给理解和思考。",
      "Start with the page in front of you. Read the important details, collect the next steps, and keep the original context close at hand.":
        "从眼前的网页开始，读懂关键细节、梳理下一步，让原始上下文始终在手边。",
      "One small step at a time": "一次，做好一小步",
      "Choose one thing to move forward today. Make the next action clear, give it a little attention, and leave enough space for a better question.":
        "今天，选一件想推进的事。明确下一步，投入一点专注，也留出提出更好问题的余地。",
    };
    const article = `<!doctype html><meta charset="utf-8"><title>A quieter way to work · Fieldnotes</title><style>*{box-sizing:border-box}body{margin:0;background:#fbfaf7;color:#262725;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}.nav{height:72px;border-bottom:1px solid #e5e2db;display:flex;align-items:center;padding:0 40px;gap:28px;font-size:13px;color:#73756c}.logo{font-family:Georgia,serif;font-size:28px;color:#292b28;margin-right:auto}.active{color:#242824}.wrap{padding:42px 42px 70px;max-width:770px}small{font-size:11px;letter-spacing:2px;color:#79806c}.eyebrow{margin-bottom:18px}.cover{height:130px;border-radius:5px;background:#e6ebdf;position:relative;overflow:hidden;margin:26px 0}.cover:before,.cover:after{content:'';position:absolute;border-radius:50%;border:1px solid #98a58b;width:340px;height:340px;left:55%;top:-140px}.cover:after{left:67%;top:-90px;border-color:#b6bda9}.cover span{position:absolute;left:25px;top:22px;font:italic 28px/1.1 Georgia;width:220px;color:#4a5a45}h1{font:46px/1.07 Georgia,serif;letter-spacing:-1px;margin:14px 0 20px;max-width:600px}h2{font:25px/1.2 Georgia;margin:27px 0 15px}p{font:17px/1.65 Georgia,'PingFang SC',serif;margin:0 0 20px;color:#50544b;max-width:590px}.by{font-size:12px;color:#87897f}.demo{position:fixed;bottom:16px;left:24px;font:10px -apple-system,sans-serif;letter-spacing:1px;color:#8f9387}</style><nav class="nav"><span class="logo">Fieldnotes.</span><span class="active">Ideas</span><span>Work</span><span>Life</span><span>About</span></nav><main class="wrap"><div class="eyebrow"><small>WORK & ATTENTION</small></div><h1>A quieter way to work</h1><div class="by">Fieldnotes Studio · 4 min read</div><div class="cover"><span>A little more<br>room to think.</span></div><p id="selection">Good ideas need room. A useful assistant helps us spend less time moving information and more time making sense of it.</p><p>Start with the page in front of you. Read the important details, collect the next steps, and keep the original context close at hand.</p><h2>One small step at a time</h2><p>Choose one thing to move forward today. Make the next action clear, give it a little attention, and leave enough space for a better question.</p></main><div class="demo">DEMO ARTICLE · 示例文章</div>`;
    await fs.writeFile(path.join(out, "source/article.html"), article);
    async function pageFor(locale) {
      const page = await browser.newPage({
        viewport: { width: 1120, height: 780 },
        deviceScaleFactor: 1,
        locale,
        colorScheme: "light",
      });
      await page.route("https://fieldnotes.test/**", (r) =>
        r.fulfill({ contentType: "text/html", body: article }),
      );
      await page.goto("https://fieldnotes.test/ideas/a-quieter-way-to-work");
      await page.evaluate(
        ({ locale, translations }) => {
          globalThis.storeDemo = { locale, translations };
          let prefs = { webTarget: "zh-CN", autoVideo: false, theme: "light" };
          globalThis.browser = {
            runtime: {
              id: "store-demo",
              getURL: () => "",
              onMessage: {
                addListener(fn) {
                  globalThis.extensionCommand = fn;
                },
                removeListener() {},
              },
              async sendMessage(m) {
                if (m.type === "connection-status")
                  return { ok: true, connection: { connected: true } };
                if (m.type === "cindy-agent-tab")
                  return { ok: true, opened: false };
                if (m.type !== "cindy-learning") return { ok: true };
                const r = m.request;
                if (r.op === "config")
                  return { ok: true, locale, features: ["language-target-v1"] };
                if (r.op === "preferences")
                  return { ok: true, target: "zh-CN" };
                if (r.op === "translate")
                  return {
                    ok: true,
                    translations: (r.texts || [r.text]).map(
                      (t) => translations[t] || t,
                    ),
                  };
                if (r.op === "explain")
                  return {
                    ok: true,
                    text:
                      locale === "zh-CN"
                        ? "这里的 “making sense of it” 是指理解信息的含义、理清它们之间的关系。作者强调，助手的价值在于减少机械搬运，让我们把注意力留给真正的思考。"
                        : "“Making sense of it” means understanding information and how it fits together. The author suggests that an assistant should reduce repetitive work so we can focus on thinking.",
                  };
                throw Error("Unsupported demo request: " + r.op);
              },
            },
            storage: {
              local: {
                async get() {
                  return { cindyReadingPreferences: prefs };
                },
                async set(v) {
                  prefs = v.cindyReadingPreferences;
                },
              },
              onChanged: { addListener() {}, removeListener() {} },
            },
          };
        },
        { locale, translations },
      );
      for (const file of [
        "brand-icon.js",
        "learning-core.js",
        "subtitle-playback.js",
        "ui.js",
        "reading-ui.js",
        "content.js",
      ])
        await page.addScriptTag({ path: path.join(ext, file) });
      return page;
    }
    async function command(page, action) {
      return page.evaluate(
        (action) =>
          new Promise((resolve) =>
            extensionCommand(
              { type: "cindy-ui", action },
              { id: "store-demo" },
              resolve,
            ),
          ),
        action,
      );
    }
    async function closedNode(page, tag, label, fn, arg) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("DOM.enable");
      const { root } = await cdp.send("DOM.getDocument", {
        depth: -1,
        pierce: true,
      });
      let found;
      function walk(n) {
        if (
          n.nodeName === tag &&
          (!label ||
            n.children?.some((c) => c.nodeValue === label) ||
            n.attributes?.includes(label))
        )
          found = n;
        for (const c of [...(n.children || []), ...(n.shadowRoots || [])])
          walk(c);
      }
      walk(root);
      if (!found) throw Error(`No ${tag} ${label}`);
      const { object } = await cdp.send("DOM.resolveNode", {
        nodeId: found.nodeId,
      });
      const r = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: fn,
        arguments: [{ value: arg }],
        returnByValue: true,
      });
      await cdp.detach();
      return r.result.value;
    }
    async function clickClosed(page, tag, label) {
      const p = await closedNode(
        page,
        tag,
        label,
        'function(){this.scrollIntoView({block:"nearest"});const r=this.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}',
      );
      await page.mouse.click(p.x, p.y);
    }
    for (const locale of ["zh-CN", "en"]) {
      let page = await pageFor(locale);
      await command(page, "open");
      await page.screenshot({
        path: path.join(out, `source/reading-${locale}.png`),
      });
      await page.evaluate(() => {
        document.querySelector(".cover").remove();
        document.querySelector(".wrap").style.paddingTop = "24px";
        document.querySelector(".nav").style.height = "48px";
      });
      await command(page, "translate-page");
      await page.screenshot({
        path: path.join(out, `source/bilingual-${locale}.png`),
      });
      await page.close();
      page = await pageFor(locale);
      await command(page, "open");
      await page.evaluate(() => {
        const r = document.createRange();
        r.selectNodeContents(document.querySelector("#selection"));
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      });
      await command(page, "selection");
      await clickClosed(page, "SUMMARY", locale === "zh-CN" ? "更多" : "More");
      const instruction =
        locale === "zh-CN"
          ? "根据这段内容，整理三个今天就能实践的工作建议。"
          : "Turn this passage into three practical ideas I can try at work today.";
      const box = await closedNode(
        page,
        "TEXTAREA",
        null,
        "function(){const r=this.getBoundingClientRect();return {x:r.x+20,y:r.y+20}}",
      );
      await page.mouse.click(box.x, box.y);
      await page.keyboard.insertText(instruction);
      await page.mouse.click(800, 600);
      await page.screenshot({
        path: path.join(out, `source/handoff-${locale}.png`),
      });
      await page.close();
      const permissions = await browser.newPage({
        viewport: { width: 780, height: 760 },
        locale,
        colorScheme: "light",
      });
      await permissions.route("https://extension-demo.test/**", async (r) => {
        const name =
          new URL(r.request().url()).pathname.slice(1) || "permissions.html";
        await r.fulfill({
          contentType: name.endsWith(".js") ? "text/javascript" : "text/html",
          body: await fs.readFile(path.join(ext, name)),
        });
      });
      await permissions.addInitScript(
        ({ locale }) => {
          globalThis.chrome = {
            runtime: {
              async sendMessage() {
                return { ok: true, locale };
              },
            },
            permissions: {
              async contains() {
                return false;
              },
              onAdded: { addListener() {} },
              onRemoved: { addListener() {} },
            },
          };
        },
        { locale },
      );
      await permissions.goto("https://extension-demo.test/permissions.html");
      await permissions.waitForFunction(
        () => document.querySelector("#group-title").textContent.length > 0,
      );
      await permissions.screenshot({
        path: path.join(out, `source/permissions-${locale}.png`),
      });
      await permissions.close();
    }
  }
  const copy = {
    "zh-CN": [
      [
        "浏览器里的 AI 助手",
        "从这页开始，\n让 Cindy 接着做。",
        "带上当前网页的上下文，\n让 Cindy 继续处理。",
        "使用 Cindy 桌面端 · 示例内容",
      ],
      [
        "把下一步，交给 Cindy",
        "不止看网页，\n还能帮你办事。",
        "沿用你的浏览器登录状态，查资料、整理信息、操作网页。",
        "示例指令 · 按任务权限执行",
      ],
      [
        "双语网页阅读",
        "世界很大，\n读起来可以很近。",
        "原文与译文一起读，重要的上下文不会丢。",
        "实际扩展界面 · 示例文章与译文",
      ],
      [
        "视频双语字幕",
        "跟上内容，\n也跟上每一句。",
        "在播放器里看双语字幕，把注意力留给视频。",
        "AI 生成示意画面 · 双语字幕示例",
      ],
      [
        "可选能力，由你开启",
        "需要更多能力时，\n由你点头。",
        "导出 PDF、整页截图等能力，按需申请 Chrome 权限。",
        "实际扩展选项页 · 未开启状态",
      ],
    ],
    en: [
      [
        "YOUR AI ASSISTANT, IN CHROME",
        "Start here.\nLet Cindy take it on.",
        "Give your AI assistant the context of the page you’re on.",
        "Requires Cindy desktop · Example content",
      ],
      [
        "PUT THE NEXT STEP IN MOTION",
        "Beyond browsing.\nHelp getting it done.",
        "Research, organize, and act on webpages using your browser session.",
        "Example requests · Subject to task permissions",
      ],
      [
        "BILINGUAL WEB READING",
        "A wider world.\nA closer read.",
        "Read the original and the translation, together in context.",
        "Actual extension UI · Sample article and translation",
      ],
      [
        "BILINGUAL VIDEO SUBTITLES",
        "Stay with the story.\nFollow every line.",
        "Read bilingual subtitles right inside the video player.",
        "AI-generated scene · Bilingual subtitle example",
      ],
      [
        "OPTIONAL CAPABILITIES",
        "More capabilities.\nYour choice.",
        "Enable Chrome permissions when you need PDF export, full-page captures, and more.",
        "Actual extension options · Permissions not enabled",
      ],
    ],
  };
  const common = `*{box-sizing:border-box}body{margin:0;color:#1d2025;background:#f6f4f0;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif}.slide{position:relative;width:1280px;height:800px;overflow:hidden;padding:48px 64px}.brand{display:flex;align-items:center;gap:13px;font-size:22px;font-weight:650;letter-spacing:-.7px}.brand img{width:45px;height:45px}.brand small{font-size:11px;letter-spacing:1.8px;font-weight:500;color:#84827e;border-left:1px solid #d4d0ca;padding-left:15px;margin-left:5px}.eyebrow{font-size:12px;color:#d62339;letter-spacing:2px;font-weight:650;margin-top:44px}.headline{white-space:pre-line;font-size:62px;line-height:1.13;font-weight:650;letter-spacing:-2.5px;margin:18px 0 20px}.sub{font-size:19px;line-height:1.65;color:#74716b;max-width:420px;margin:0}.foot{position:absolute;bottom:30px;left:64px;right:64px;display:flex;justify-content:space-between;font-size:10px;color:#98938a;letter-spacing:.5px}.number{font-size:12px;font-variant-numeric:tabular-nums}.browser{position:absolute;background:#fff;border:1px solid #dedbd4;border-radius:16px;overflow:hidden;box-shadow:0 24px 90px #26221d16}.chrome{height:38px;display:flex;align-items:center;gap:5px;padding:0 15px;background:#f5f3ef;border-bottom:1px solid #e7e3dc}.chrome i{width:7px;height:7px;border-radius:50%;background:#d8d3cb}.chrome span{font-size:10px;color:#88847d;margin-left:14px;background:#fff;border-radius:5px;padding:4px 12px;min-width:65%}.browser>img{display:block;width:100%}.hero .copy{position:relative;z-index:1;width:475px}.hero .headline{font-size:60px}.hero .browser{left:590px;top:130px;width:780px;transform:rotate(-2deg)}.hero .browser>img{width:900px;max-width:none;transform:translateX(-125px);margin-bottom:-2px}.hero .sub{max-width:390px}.hero .stamp{margin-top:42px;padding-top:20px;border-top:1px solid #dedbd4;width:330px;display:flex;gap:20px;align-items:center;color:#73706a;font-size:13px}.stamp img{width:64px;height:64px}.wide .eyebrow{margin-top:29px}.wide .headline{font-size:44px;line-height:1.15;white-space:normal;margin:12px 0}.wide .sub{max-width:none;font-size:16px}.wide .browser{left:64px;top:282px;width:1152px;height:458px}.wide .browser>img{width:1152px}.translation .browser{top:270px;height:470px}.video{background:#17191e;color:#fff}.video .brand small{color:#93959c;border-color:#3b3d43}.video .eyebrow{color:#ff727f}.video .sub{color:#a5a7ae}.video .browser{border-color:#393b41;background:#0d0d12;top:277px;height:465px;left:255px;width:960px;box-shadow:0 30px 75px #0005}.video .browser>img{width:960px}.video .chrome{display:none}.video .side{position:absolute;top:376px;left:64px;width:160px;font-size:15px;color:#b8b9c0;line-height:1.8}.video .side b{font-size:28px;display:block;color:#fff;letter-spacing:-.7px;font-weight:500;margin-bottom:14px}.video .foot{color:#7e8189}.permissions .browser{left:620px;top:125px;width:580px;height:610px}.permissions .browser>img{width:630px;transform:translateX(-25px)}.permissions .copy{width:510px}.permissions .headline{font-size:57px}.permissions .sub{max-width:400px}.permission-tags{display:flex;flex-wrap:wrap;gap:8px;max-width:390px;margin-top:32px}.permission-tags span{border:1px solid #ddd9d1;border-radius:30px;padding:9px 16px;font-size:13px;color:#6c6861}.action .headline{font-size:55px}.action .sub{max-width:730px}.requests{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:40px}.request{background:#fff;border:1px solid #e1ddd7;border-radius:18px;padding:25px;height:240px;position:relative}.request .ordinal{font:12px ui-monospace,monospace;color:#c8c2b9;letter-spacing:2px}.request h2{font-size:21px;letter-spacing:-.7px;font-weight:550;margin:20px 0 15px}.request p{font-size:15px;color:#817c75;line-height:1.7;max-width:270px}.request .arrow{position:absolute;right:22px;bottom:20px;color:#e31c35;font-size:24px}.action .workflow{margin-top:28px;display:flex;align-items:center;gap:20px;font-size:13px;color:#938b81}.workflow img{width:42px;height:42px}.workflow b{font-weight:500;color:#5a544d}.accent{color:#ed1835}.en .headline{letter-spacing:-3px;font-weight:600}.en.hero .headline{font-size:56px}.en.permissions .headline{font-size:56px}.en .sub{line-height:1.5}`;
  function slide(locale, index) {
    const [tag, title, desc, note] = copy[locale][index];
    const zh = locale === "zh-CN";
    const cls = [
      "hero",
      "action",
      "wide translation",
      "wide video",
      "permissions",
    ][index];
    let media = "";
    const chrome = `<div class="chrome"><i></i><i></i><i></i><span>${index === 4 ? "Cindy · " + (zh ? "扩展选项" : "Extension options") : "fieldnotes.test / ideas"}</span></div>`;
    if (index === 0)
      media = `<div class="browser">${chrome}<img src="source/handoff-${locale}.png"></div>`;
    if (index === 1) {
      const cards = zh
        ? [
            ["资料不用来回搬", "“把这几页资料整理成一份对比，保留来源链接。”"],
            [
              "下一步，直接说",
              "“在这个网页里填好活动报名信息，提交前让我看一下。”",
            ],
            [
              "用熟悉的浏览器",
              "“在我已经登录的网站里，找到这周要处理的事项。”",
            ],
          ]
        : [
            [
              "Less copying around",
              "“Compare these pages and keep the source links.”",
            ],
            [
              "Say what comes next",
              "“Fill in this registration form. Let me review it before submitting.”",
            ],
            [
              "Your familiar browser",
              "“Find this week’s action items on the site I’m already signed into.”",
            ],
          ];
      media = `<div class="requests">${cards.map((c, i) => `<div class="request"><div class="ordinal">0${i + 1}</div><h2>${c[0]}</h2><p>${c[1]}</p><span class="arrow">↗</span></div>`).join("")}</div><div class="workflow"><img src="assets/icon.svg"><b>${zh ? "在 Cindy 里提出任务" : "Ask in Cindy"}</b><span>→</span><b>${zh ? "在你的 Chrome 中处理" : "Work in your Chrome"}</b><span>→</span><b>${zh ? "回到任务看结果" : "Review in your task"}</b></div>`;
    }
    if (index === 2)
      media = `<div class="browser">${chrome}<img src="source/bilingual-${locale}.png"></div>`;
    if (index === 3)
      media = `<div class="side"><b>${zh ? "原文\n＋ 译文" : "Original<br>+ translation"}</b>${zh ? "双语 / 仅译文 / 仅原文" : "Bilingual / translated / original"}</div><div class="browser"><img src="assets/video-space-breakfast.png"><div class="video-shade"></div><div class="demo-subtitles"><span>Breakfast is taking off.</span><strong>早餐，准备起飞。</strong></div><div class="video-controls"><span>Ⅱ</span><span class="video-progress"><i></i></span><span>00:24 / 01:52</span><span class="cc">CC</span><span>⛶</span></div></div>`;
    if (index === 4)
      media = `<div class="permission-tags"><span>${zh ? "网页 PDF" : "Page PDF"}</span><span>${zh ? "完整截图" : "Full-page capture"}</span><span>${zh ? "标签分组" : "Tab groups"}</span></div><div class="browser">${chrome}<img src="source/permissions-${locale}.png"></div>`;
    const stamp =
      index === 0
        ? `<div class="stamp"><img src="assets/icon.svg"><span>${zh ? "你的浏览器。<br>你的 AI 助手。" : "Your browser.<br>Your AI assistant."}</span></div>`
        : "";
    const heading = `<div class="eyebrow">${tag}</div><h1 class="headline">${title}</h1><p class="sub">${desc}</p>${stamp}`;
    const refinements =
      ".hero .browser{left:560px;top:125px;width:656px;transform:none}.hero .browser>img{width:840px;transform:translateX(-184px)}.hero .headline{font-size:54px}.hero .sub{white-space:pre-line;max-width:425px}.hero .copy{width:470px}.en.hero .headline{font-size:52px}.video .browser>img{width:100%;height:100%;object-fit:cover;object-position:center;transform:none}.video-shade{position:absolute;inset:45% 0 0;background:linear-gradient(transparent,rgba(8,11,18,.88))}.demo-subtitles{position:absolute;bottom:54px;left:20px;right:20px;text-align:center;color:white;text-shadow:0 2px 8px #000;line-height:1.35}.demo-subtitles span{display:block;font-size:24px;font-weight:500;letter-spacing:.1px}.demo-subtitles strong{display:block;font-size:23px;font-weight:600;margin-top:4px;letter-spacing:.3px}.video-controls{position:absolute;bottom:14px;left:24px;right:24px;display:flex;align-items:center;gap:15px;color:#ddd;font-size:11px;font-variant-numeric:tabular-nums}.video-controls>span:first-child{font-size:19px;font-weight:650}.video-progress{height:3px;background:#ffffff35;flex:1;border-radius:3px}.video-progress i{display:block;background:#ff5d70;width:22%;height:3px;border-radius:3px}.cc{border:1px solid #ddd;padding:0 3px;border-radius:3px;font-size:9px;line-height:14px}";
    return `<!doctype html><html lang="${locale}"><meta charset="utf-8"><style>${common}${refinements}</style><div class="slide ${cls} ${zh ? "zh" : "en"}"><div class="brand"><img src="assets/icon.svg">Cindy <small>FOR CHROME</small></div>${index === 0 || index === 4 ? '<div class="copy">' + heading + "</div>" : heading}${media}<div class="foot"><span>${note}</span><span class="number">0${index + 1} / 05</span></div></div></html>`;
  }
  const render = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  for (const locale of ["zh-CN", "en"])
    for (let i = 0; i < 5; i++) {
      const file = path.join(out, `slide-${locale}-${i + 1}.html`);
      await fs.writeFile(file, slide(locale, i));
      await render.goto(pathToFileURL(file).href);
      await render.evaluate(() => document.fonts.ready);
      await render.screenshot({
        path: path.join(out, `screenshots/${locale}-${i + 1}.png`),
      });
    }
  const svg = await fs.readFile(iconSource, "utf8");
  await fs.writeFile(
    path.join(out, "assets/store-icon.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><g transform="translate(16 16) scale(.1875)">${svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</g></svg>`,
  );
  await render.setViewportSize({ width: 128, height: 128 });
  await render.setContent(
    `<style>body{margin:0;background:transparent}</style>${await fs.readFile(path.join(out, "assets/store-icon.svg"), "utf8")}`,
  );
  await render.screenshot({
    path: path.join(out, "assets/store-icon-128.png"),
    omitBackground: true,
  });
  for (const [name, w, h] of [
    ["promo-small", 440, 280],
    ["promo-marquee", 1400, 560],
  ]) {
    const large = w > 500;
    const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:${w}px;height:${h}px;background:#f70121;overflow:hidden;font-family:-apple-system,sans-serif}.tile{position:absolute;width:${large ? 330 : 150}px;height:${large ? 330 : 150}px;background:white;left:${large ? 140 : 145}px;top:${large ? 115 : 45}px;border-radius:${large ? 64 : 32}px;box-shadow:0 22px 60px #79000b33;overflow:hidden}.tile img{width:100%;height:100%}.brand{position:absolute;left:${large ? 565 : 0}px;top:${large ? 188 : 212}px;width:${large ? "auto" : "440px"};text-align:${large ? "left" : "center"};font-size:${large ? 105 : 27}px;color:white;letter-spacing:${large ? -5 : -1}px;font-weight:650}.brand span{font-size:${large ? 24 : 10}px;display:${large ? "block" : "none"};font-weight:400;letter-spacing:${large ? 8 : 1}px;margin-top:14px}.orbit{position:absolute;border:1px solid #ffffff24;border-radius:50%;width:${large ? 1100 : 550}px;height:${large ? 1100 : 550}px;right:${large ? -330 : -240}px;top:${large ? -300 : -100}px}.orbit.two{transform:translateX(-100px)}</style><div class="orbit"></div><div class="orbit two"></div><div class="tile"><img src="assets/icon.svg"></div><div class="brand">Cindy<span>FOR CHROME</span></div>`;
    await fs.writeFile(path.join(out, name + ".html"), html);
    await render.setViewportSize({ width: w, height: h });
    await render.goto(pathToFileURL(path.join(out, name + ".html")).href);
    await render.screenshot({ path: path.join(out, "assets", name + ".png") });
  }
} finally {
  await browser.close();
}
console.log(
  "Rendered 10 screenshots, 2 promotional images and the store icon to " + out,
);
