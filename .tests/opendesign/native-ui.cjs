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
    page.setDefaultTimeout(10000);
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
    await page.route("**/api/projects/*/feedback", route => route.continue({
      postData: JSON.stringify({...route.request().postDataJSON(), images:[{type:'text/plain',base64:'eA=='}]}),
    }));
    await page.getByRole("button", {name: "发送到聊天", exact: true}).click();
    await page.getByRole('alert').filter({hasText:'Unsupported annotation image'}).waitFor();
    assert.equal(sent.length,1);
    assert.equal(await page.getByPlaceholder("评论此元素…").inputValue(), "Keep uncertain feedback");
    await page.unroute("**/api/projects/*/feedback");
    for (const response of ['abort','server-error']) {
      await page.route("**/api/projects/*/feedback", route => response==='abort' ? route.abort() : route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({code:'FEEDBACK_REJECTED',error:'not a reliable rejection'})}));
      await page.getByRole("button", {name:"发送到聊天",exact:true}).click();
      await page.getByRole('alert').filter({hasText:'提交结果未确认'}).waitFor();
      assert.equal(sent.length,1);
      await page.unroute("**/api/projects/*/feedback");
    }
    await page.waitForTimeout(2000); // exceed the 1.8s background refresh
    await page.getByRole('alert').filter({hasText:'提交结果未确认'}).waitFor();

    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const artifact = page.frameLocator('[data-testid=artifact-preview-frame]');
    async function canvasClick(selector, double = false) {
      await artifact.locator('html[data-od-edit-mode]').waitFor();
      await page.getByTestId('manual-canvas-input').waitFor();
      await page.waitForTimeout(150);
      const box = await artifact.locator(selector).boundingBox();
      assert.ok(box);
      await page.mouse[double ? 'dblclick' : 'click'](box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(100);
    }

    const beforeForgery = await fs.readFile(path.join(p.dir, 'design.html'), 'utf8');
    async function forgeCommit(value) {
      await artifact.locator('#hero').evaluate((el, text) => {
        const id = el.getAttribute('data-od-source-path') || el.getAttribute('data-od-id') || el.getAttribute('data-od-runtime-id');
        parent.postMessage({type:'od-edit-text-session', id, active:true}, '*');
        parent.postMessage({type:'od-edit-text-commit', id, value:text}, '*');
        parent.postMessage({type:'od-edit-text-session', id, active:false}, '*');
      }, value);
      await page.waitForTimeout(150);
    }
    await artifact.locator('#hero').evaluate(el => {
      const id=el.getAttribute('data-od-source-path') || el.getAttribute('data-od-id');
      parent.postMessage({type:'od-edit-text-request',target:{id,rect:{x:0,y:0,width:1000,height:1000}}},'*');
      parent.postMessage({type:'od-edit-drag-commit',id,transform:'translate(999px,999px)',display:'none'},'*');
    });
    await page.waitForTimeout(150);
    assert.equal(await page.getByTestId('manual-inline-editor').count(),0);
    console.log('Forgery rejected; leaving edit');
    await page.getByRole('button',{name:'注释',exact:true}).click();
    assert.equal(await fs.readFile(path.join(p.dir,'design.html'),'utf8'),beforeForgery);
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    await forgeCommit('Injected before a real edit');
    assert.equal(await fs.readFile(path.join(p.dir, 'design.html'), 'utf8'), beforeForgery);
    await canvasClick('#hero', true);
    const inline = page.getByTestId('manual-inline-editor').locator('textarea');
    await inline.waitFor();
    // Script-created input events cannot authorize the trusted editor either.
    await inline.evaluate(el => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, 'Synthetic input');
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}));
    });
    await forgeCommit('Injected during an active edit');
    assert.equal(await fs.readFile(path.join(p.dir, 'design.html'), 'utf8'), beforeForgery);
    await inline.fill('Trusted inline text');
    await forgeCommit('Injected after trusted typing');
    await inline.press('Enter');
    await page.getByTestId('manual-inline-editor').waitFor({state:'hidden'});
    const afterInline = await fs.readFile(path.join(p.dir, 'design.html'), 'utf8');
    assert.match(afterInline, /Trusted inline text/);
    assert.doesNotMatch(afterInline, /Injected|Synthetic input/);
    await forgeCommit('Replayed after commit');
    assert.equal(await fs.readFile(path.join(p.dir, 'design.html'), 'utf8'), afterInline);
    await canvasClick('#hero', true);
    await inline.fill('Unsaved inline conflict');
    const currentInline = await w.invoke('draft-read', {sessionId:sid,file:'design.html'});
    await w.invoke('draft-write', {sessionId:sid,file:'design.html',html:currentInline.html+'<!-- changed outside inline -->',expectedRevision:currentInline.revision});
    await inline.press('Enter');
    await page.waitForTimeout(300);
    assert.equal(await inline.inputValue(), 'Unsaved inline conflict');
    assert.doesNotMatch(await fs.readFile(path.join(p.dir, 'design.html'), 'utf8'), /Unsaved inline conflict/);
    await inline.press('Escape');
    await page.getByTestId('manual-inline-editor').waitFor({state:'hidden'});


    await canvasClick('#hero');
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
    // Real parent pointer capture preserves drag editing; forged iframe
    // commits cannot replace its displacement before exit flushes the edit.
    const dragBox = await artifact.locator('#hero').boundingBox();
    await page.mouse.move(dragBox.x+dragBox.width/2,dragBox.y+dragBox.height/2);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(dragBox.x+dragBox.width/2+40,dragBox.y+dragBox.height/2+20,{steps:5});
    await page.mouse.up();
    await artifact.locator('#hero').evaluate(el => {
      const id=el.getAttribute('data-od-source-path') || el.getAttribute('data-od-id');
      parent.postMessage({type:'od-edit-drag-commit',id,transform:'translate(999px,999px)',display:'none'},'*');
    });
    await page.getByRole('button',{name:'注释',exact:true}).click();
    await page.waitForTimeout(200);
    const dragged = await fs.readFile(path.join(p.dir,'design.html'),'utf8');
    const moved = /translate\(([\d.]+)px, ([\d.]+)px\)/.exec(dragged);
    assert.ok(moved);
    // The canvas scale can introduce fractional CSS pixels after resizing.
    assert.ok(Math.abs(Number(moved[1])-40)<0.1 && Math.abs(Number(moved[2])-20)<0.1);
    assert.doesNotMatch(dragged,/999px/);
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    console.log('Parent-owned drag persisted; forged iframe drag did not');
    // Interleave an Agent update after the UI checks its source but before POST.
    await canvasClick('#hero');
    await page.locator("textarea").fill("Stale manual edit must not overwrite");
    await page.route("**/api/projects/*/files", async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const current = await w.invoke('draft-read', {sessionId:sid,file:'design.html'});
      await w.invoke('draft-write', {sessionId:sid,file:'design.html',html:current.html + '<!-- agent won -->',expectedRevision:current.revision});
      await route.continue();
    });
    await page.getByRole("button", {name:"保存",exact:true}).click();
    await page.getByText(/Could not save the edited file.*409/).waitFor();
    const afterRace = await fs.readFile(path.join(p.dir, 'design.html'), 'utf8');
    assert.match(afterRace, /agent won/);
    assert.doesNotMatch(afterRace, /Stale manual edit must not overwrite/);
    await page.unroute("**/api/projects/*/files");
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
    // Exercise the actual URL-load response, not only a policy string assertion.
    let externalRequests = 0;
    const probe = require('node:http').createServer((req,res) => { externalRequests++; res.end('probe'); });
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const forbidden = 'http://127.0.0.1:' + probe.address().port;
    const isolated = await browser.newPage();
    try {
      await fs.writeFile(path.join(p.dir,'data.json'),JSON.stringify({value:'project-data'}));
      await fs.writeFile(path.join(p.dir,'module.js'),"import {value} from './dependency.js'; window.moduleValue=value;");
      await fs.writeFile(path.join(p.dir,'dependency.js'),"export const value='project-module';");
      await w.invoke('draft-write',{sessionId:sid,file:'cors.html',expectedRevision:null,
        html:`<h1>CORS fixture</h1><script type="module" src="./module.js"></script><script>
        Promise.all([fetch('./data.json').then(r=>r.json()),import('./dependency.js')]).then(([data,module])=>{
          document.body.dataset.result=data.value+':'+module.value;
        });</script>`});
      await isolated.goto(b.url+'?file=cors.html');
      const cors=isolated.frameLocator('[data-testid=artifact-preview-frame]');
      await cors.locator('body[data-result="project-data:project-module"]').waitFor();
      assert.equal(await cors.locator('body').evaluate(()=>window.moduleValue),'project-module');
      assert.equal(await cors.locator('body').evaluate(()=>self.origin),'null');
      await fs.writeFile(path.join(p.dir, 'allowed.js'), 'window.localScriptWorked = true');
      await w.invoke('draft-write', {sessionId:sid,file:'network.html',expectedRevision:null,
        html: `<h1>Network fixture</h1><img src="${forbidden}/image"><script src="${forbidden}/script"></script><script src="allowed.js"></script><script>fetch('${forbidden}/fetch').catch(()=>window.fetchBlocked=true)</script>`});
      await isolated.goto(b.previewBase + 'network.html');
      await isolated.waitForFunction(() => window.localScriptWorked && window.fetchBlocked);
      await isolated.waitForTimeout(200);
      assert.equal(externalRequests, 0);
      // The real editor uses srcdoc (and Electron's blob bootstrap), which
      // inherits the editor response CSP rather than the raw preview response.
      await isolated.goto(b.url + '?file=network.html');
      const networkFrame = isolated.frameLocator('[data-testid=artifact-preview-frame]');
      await networkFrame.getByText('Network fixture', {exact:true}).waitFor();
      await networkFrame.locator('body').evaluate(async () => {
        const deadline = Date.now() + 5000;
        while (!(window.localScriptWorked && window.fetchBlocked)) {
          if (Date.now() > deadline) throw new Error('Expected local script and blocked fetch in actual srcdoc');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      });
      assert.equal(externalRequests, 0);
      console.log('Actual editor srcdoc inherits CSP: local script works, external img/script/fetch blocked');
      for (const kind of ['assign','replace','meta','anchor']) {
        await isolated.goto(b.url + '?file=network.html');
        const navFrame = isolated.frameLocator('[data-testid=artifact-preview-frame]');
        await navFrame.getByText('Network fixture',{exact:true}).waitFor();
        await navFrame.locator('body').evaluate((el, {kind,url}) => {
          if (kind==='assign') location.href=url;
          if (kind==='replace') location.replace(url);
          if (kind==='meta') {const meta=document.createElement('meta');meta.httpEquiv='refresh';meta.content='0;url='+url;document.head.append(meta);}
          if (kind==='anchor') {const a=document.createElement('a');a.href=url;el.append(a);a.click();}
        },{kind,url:forbidden+'/navigation?draft=fixture'});
        await isolated.waitForTimeout(200);
        assert.equal(externalRequests,0,kind+' must not send an external navigation');
      }

      const downloads=[];
      isolated.on('download',d=>downloads.push(d));
      await w.invoke('draft-write',{sessionId:sid,file:'download-payload.html',expectedRevision:null,html:'download-fixture'});
      for (const kind of ['data','blob','local']) {
        await w.invoke('draft-write',{sessionId:sid,file:'download-'+kind+'.html',expectedRevision:null,
          html:`<h1>Download fixture</h1><script>addEventListener('DOMContentLoaded',()=>{const a=document.createElement('a');a.download='fixture-${kind}.txt';a.href=${kind==='local' ? JSON.stringify(b.previewBase+'download-payload.html?source=1') : kind==='data' ? "'data:text/plain,download-fixture'" : "URL.createObjectURL(new Blob(['download-fixture'],{type:'text/plain'}))"};document.body.append(a);a.click();})</script>`});
        await isolated.goto(b.url+'?file=download-'+kind+'.html');
        const proposal=isolated.getByTestId('artifact-download-request');
        await proposal.waitFor();
        const count=downloads.length;
        // Bypass the proposal listener entirely: only the browser sandbox
        // may enforce this case, not our cooperative click bridge.
        await isolated.frameLocator('[data-testid=artifact-preview-frame]').locator('body').evaluate(el=>{
          window.addEventListener('click',e=>e.stopImmediatePropagation(),true);
          const a=document.createElement('a');a.download='bypass.txt';
          a.href=URL.createObjectURL(new Blob(['must not save']));el.append(a);a.click();
        });
        await isolated.waitForTimeout(250);
        assert.equal(downloads.length,count,'script must not download automatically');
        await proposal.getByRole('button',{name:'保存文件',exact:true}).evaluate(el=>el.click());
        await isolated.waitForTimeout(100);
        assert.equal(downloads.length,count,'synthetic parent clicks do not authorize saving');
        const waiting=isolated.waitForEvent('download');
        await proposal.getByRole('button',{name:'保存文件',exact:true}).click();
        const downloaded=await waiting;
        assert.equal(downloaded.suggestedFilename(),'fixture-'+kind+'.txt');
        assert.equal(await fs.readFile(await downloaded.path(),'utf8'),'download-fixture');
        await downloaded.delete();
      }

      // Exercise the actual presentation UI, not a synthetic replacement frame.
      await isolated.goto(b.url+'?file=download-data.html');
      await isolated.getByTestId('artifact-download-request').getByRole('button',{name:'取消',exact:true}).click();
      await isolated.getByRole('button',{name:'演示',exact:true}).click();
      await isolated.getByText('在当前标签页',{exact:true}).click();
      const presented=isolated.locator('.present-overlay');
      await presented.locator('iframe').waitFor();
      const confirm=presented.getByTestId('artifact-download-request');
      await confirm.waitFor();
      const saving=isolated.waitForEvent('download');
      await confirm.getByRole('button',{name:'保存文件',exact:true}).click();
      const saved=await saving;
      assert.equal(await fs.readFile(await saved.path(),'utf8'),'download-fixture');
      await saved.delete();
    } finally { await isolated.close(); await new Promise(resolve => probe.close(resolve)); }

  } finally {
    await browser?.close();
    await w.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
