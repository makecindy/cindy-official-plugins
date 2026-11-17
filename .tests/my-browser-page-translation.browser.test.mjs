// Real content scripts and browser layout; only extension transport/model are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';

const require=createRequire(import.meta.url);
const extension=path.resolve(import.meta.dirname,'../my-browser/extension');

test('page translations are visible in named slots and restore cleanly',{
  skip:!process.env.PLAYWRIGHT_CORE,timeout:30000,
},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1000,height:800}});
  await page.route('https://reading.test/**',route=>route.fulfill({contentType:'text/html',body:`
    <style>body{font:20px/1.5 sans-serif}main{width:550px;padding:20px}reading-post{display:block;margin:15px 0}a{color:inherit}</style>
    <main><reading-post><a id="title" slot="title" href="/post">A readable post title</a>
    <p id="slotted" slot="body">A slotted paragraph.</p></reading-post>
    <p id="ordinary">An ordinary paragraph.</p></main>
    <script>customElements.define('reading-post',class extends HTMLElement{constructor(){super();this.attachShadow({mode:'open'}).innerHTML='<slot name="title"></slot><slot name="body"></slot>';}});</script>
  `}));
  await page.goto('https://reading.test/');
  await page.evaluate(()=>{
    globalThis.sentTexts=[];
    globalThis.browser={
      runtime:{id:'fixture',getURL:()=> 'data:image/png;base64,',onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},
        async sendMessage(m){
          if(m.type!=='cindy-learning')return {ok:true};
          if(m.request.op==='config')return {ok:true,locale:'zh-CN'};
          if(m.request.op==='translate'){
            sentTexts.push(...m.request.texts);
            return {ok:true,translations:m.request.texts.map(text=>'中文译文：'+text)};
          }
          throw Error('Unexpected request '+m.request.op);
        }},
      storage:{local:{async get(){return {cindyReadingPreferences:{webTarget:'zh-CN',autoVideo:false}};}},onChanged:{addListener(){},removeListener(){}}},
    };
  });
  for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])
    await page.addScriptTag({path:path.join(extension,file)});
  const command=action=>page.evaluate(action=>new Promise(resolve=>command({type:'cindy-ui',action},{id:'fixture'},resolve)),action);
  await command('translate-page');
  if(process.env.CINDY_SCREENSHOTS){
    await fs.mkdir(process.env.CINDY_SCREENSHOTS,{recursive:true});
    await page.screenshot({path:path.join(process.env.CINDY_SCREENSHOTS,'page-translations.png')});
  }
  const cdp=await page.context().newCDPSession(page);
  async function visibleTranslation(id){
    const details=await page.locator('#'+id).evaluate(n=>{
      const h=n.nextElementSibling,r=h?.getBoundingClientRect();
      return {tag:h?.tagName,width:r?.width,height:r?.height,slot:h?.assignedSlot?.name,original:n.innerText};
    });
    assert.equal(details.tag,'SPAN',id+' has an adjacent translation');
    assert.ok(details.width>0&&details.height>0,id+' translation must be rendered');
    // Closed-root content must contain the translated text, not merely an empty box.
    const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
    assert.ok(JSON.stringify(root).includes('中文译文：'+details.original));
    return details;
  }
  await t.test('named-slot paragraphs remain in the rendered slot',async()=>{
    assert.equal((await visibleTranslation('slotted')).slot,'body');
  });
  await t.test('Reddit-style title links are selected and rendered',async()=>{
    assert.ok((await page.evaluate(()=>sentTexts)).includes('A readable post title'));
    assert.equal((await visibleTranslation('title')).slot,'title');
    assert.equal(await page.locator('#title').getAttribute('href'),'/post');
  });
  await t.test('ordinary paragraphs retain visible translations',()=>visibleTranslation('ordinary'));
  await t.test('new posts are translated without translating the injected text',async()=>{
    await page.evaluate(()=>{
      const post=document.createElement('reading-post');
      post.innerHTML='<a id="new-title" slot="title" href="/next">A new post title</a>';
      document.querySelector('main').append(post);
    });
    await page.waitForFunction(()=>sentTexts.includes('A new post title'));
    await visibleTranslation('new-title');
    assert.ok((await page.evaluate(()=>sentTexts)).every(text=>!text.includes('中文译文')));
  });
  await command('translate-page');
  assert.equal(await page.locator('main span').count(),0,'restore removes every injected translation');
  assert.equal(await page.locator('#title').innerText(),'A readable post title');
});

test('YouTube opens while config is pending and reports denied pages and missing captions',{
  skip:!process.env.PLAYWRIGHT_CORE,timeout:30000,
},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:900}});
  await page.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:
    '<style>body{background:#111;color:white}#movie_player{position:relative;width:1000px;height:700px}video{width:100%;height:100%}</style><div id="movie_player"><video></video><div class="ytp-right-controls"></div></div>'}));
  await page.goto('https://www.youtube.com/watch?v=fixture');
  await page.clock.install();
  await page.evaluate(()=>{
    globalThis.configPending=true;globalThis.captionReads=0;
    globalThis.browser={runtime:{id:'fixture',getURL:()=> 'data:image/png;base64,',
      onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},
      async sendMessage(m){
        if(m.type==='cindy-captions'){captionReads++;return globalThis.captionError?{ok:false,error:captionError}:{ok:true,cues:[]};}
        if(m.type!=='cindy-learning')return {ok:true};
        if(m.request.op==='config')return configPending?new Promise(resolve=>{globalThis.resolveConfig=resolve;}):{ok:true,locale:'zh-CN'};
        throw Error('Unexpected request '+m.request.op);
      }},storage:{local:{async get(){return {cindyReadingPreferences:{webTarget:'zh-CN',autoVideo:false}};}},onChanged:{addListener(){},removeListener(){}}}};
  });
  for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])
    await page.addScriptTag({path:path.join(extension,file)});
  const cdp=await page.context().newCDPSession(page);
  const tree=async()=>JSON.stringify((await cdp.send('DOM.getDocument',{depth:-1,pierce:true})).root);
  await page.evaluate(()=>{globalThis.openResult=new Promise(resolve=>command({type:'cindy-ui',action:'open'},{id:'fixture'},resolve));});
  assert.ok(await page.locator('[data-cindy-panel]').isVisible(),'click is acknowledged before config responds');
  assert.ok((await tree()).includes('Working'));
  await page.evaluate(async()=>{resolveConfig({ok:false,error:'ADDRESS_UNVERIFIED',reason:'DOCUMENT_UNAVAILABLE'});await openResult;});
  assert.ok((await tree()).includes('DOCUMENT_UNAVAILABLE'),'denial is visible instead of silently swallowed');
  assert.equal(await page.locator('[data-cindy-captions]').count(),0,'denied page is not read');
  await page.evaluate(async()=>{configPending=false;await new Promise(resolve=>command({type:'cindy-ui',action:'open'},{id:'fixture'},resolve));});
  await page.clock.runFor(16000);
  assert.ok(await page.evaluate(()=>captionReads>=3));
  const ui=await tree();
  assert.ok(ui.includes('此视频暂无可用字幕'),'empty caption result is surfaced');
  // The preparation header must stop implying ongoing subtitle work.
  assert.ok(!ui.includes('"nodeValue":"读取字幕"'));
  if(process.env.CINDY_SCREENSHOTS)
    await page.screenshot({path:path.join(process.env.CINDY_SCREENSHOTS,'youtube-empty-captions.png')});
  await page.evaluate(()=>{globalThis.captionError='SUBTITLE_EMPTY';});
  await page.clock.runFor(30000);
  const failure=await tree();
  assert.ok(failure.includes('字幕内容为空'));
  assert.ok(failure.includes('需重试'));
  assert.ok(!failure.includes('UNKNOWN_ERROR'));
  const reads=await page.evaluate(()=>captionReads);
  await page.clock.runFor(30000);
  assert.equal(await page.evaluate(()=>captionReads),reads,'empty payload is not retried indefinitely');
  if(process.env.CINDY_SCREENSHOTS)
    await page.screenshot({path:path.join(process.env.CINDY_SCREENSHOTS,'youtube-caption-error.png')});
});

test('pending setup closes permanently and pending model never blocks restore or settings',{
  skip:!process.env.PLAYWRIGHT_CORE,timeout:30000,
},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.route('https://reading.test/**',r=>r.fulfill({contentType:'text/html',body:'<main><p>A readable paragraph for pending translation.</p></main>'}));
  await page.goto('https://reading.test/');
  await page.evaluate(()=>{
    const attach=Element.prototype.attachShadow;globalThis.roots=[];
    Element.prototype.attachShadow=function(opts){const root=attach.call(this,opts);roots.push(root);return root;};
    globalThis.modelCalls=0;globalThis.cancels=[];globalThis.replies=[];globalThis.pendingConfig=true;
    globalThis.browser={runtime:{id:'fixture',getURL:()=> 'data:image/png;base64,',
      onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},
      async sendMessage(m){
        if(m.type==='cindy-cancel'){cancels.push(m.id);return {ok:true};}
        if(m.type==='cindy-open-sidepanel'){globalThis.openedPanel=m;return {ok:true};}
        if(m.type!=='cindy-learning')return {enabled:false};
        if(m.request.op==='config')return pendingConfig?new Promise(r=>{globalThis.resolveConfig=r;}):{ok:true,locale:'en'};
        if(m.request.op==='translate'){modelCalls++;return new Promise(r=>{globalThis.resolveModel=r;});}
        throw Error('Unexpected request '+m.request.op);
      }},storage:{local:{async get(){return {cindyReadingPreferences:{webTarget:'zh-CN',autoVideo:false}};}},onChanged:{addListener(){},removeListener(){}}}};
    globalThis.sendAction=(action,label)=>command({type:'cindy-ui',action},{id:'fixture'},r=>replies.push({label,...r}));
  });
  for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])await page.addScriptTag({path:path.join(extension,file)});
  await page.evaluate(()=>{sendAction('open','open');sendAction('translate-page','discarded');});
  await page.waitForFunction(()=>typeof resolveConfig==='function');
  const point=await page.evaluate(()=>{const b=roots.flatMap(r=>[...r.querySelectorAll('button')]).find(b=>['Close','关闭'].includes(b.getAttribute('aria-label')));const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(point.x,point.y);
  await page.evaluate(()=>{pendingConfig=false;resolveConfig({ok:true,locale:'en'});});
  await page.waitForFunction(()=>replies.length===2);
  assert.equal(await page.locator('[data-cindy-panel]').isVisible(),false);
  assert.equal(await page.evaluate(()=>modelCalls),0);
  await page.evaluate(()=>sendAction('translate-page','model'));
  await page.waitForFunction(()=>modelCalls===1);
  await page.evaluate(()=>{sendAction('translate-page','restore');sendAction('settings','settings');});
  await page.waitForFunction(()=>replies.some(r=>r.label==='restore')&&replies.some(r=>r.label==='settings'));
  assert.ok(await page.evaluate(()=>cancels.length>0));
  assert.equal(await page.evaluate(()=>replies.some(r=>r.label==='model')),false,'model is still pending');
  await page.evaluate(()=>resolveModel({ok:true,translations:['Late translation must not appear']}));
  await page.waitForFunction(()=>replies.some(r=>r.label==='model'));
  assert.equal(await page.locator('[data-cindy-translation]').count(),0);
  // Settings live in the side panel now; the page panel's settings opens them there.
  assert.deepEqual(await page.evaluate(()=>globalThis.openedPanel),{type:'cindy-open-sidepanel',view:'settings'});
  if(process.env.CINDY_SCREENSHOTS){await fs.mkdir(process.env.CINDY_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.CINDY_SCREENSHOTS,'pending-model-settings.png')});}
});


test('translation restart and mode switches discard stale work without blocking new work',{
  skip:!process.env.PLAYWRIGHT_CORE,timeout:30000,
},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.route('https://reading.test/**',r=>r.fulfill({contentType:'text/html',body:'<main><p id="source">A readable paragraph for restarting translation.</p></main>'}));
  await page.goto('https://reading.test/');
  await page.evaluate(()=>{
    const attach=Element.prototype.attachShadow;globalThis.roots=[];
    Element.prototype.attachShadow=function(opts){const root=attach.call(this,opts);roots.push(root);return root;};
    globalThis.models=[];globalThis.replies=[];
    globalThis.browser={runtime:{id:'fixture',getURL:()=> 'data:image/png;base64,',
      onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},
      async sendMessage(m){
        if(m.type!=='cindy-learning')return {enabled:false};
        if(m.request.op==='config')return {ok:true,locale:'en'};
        if(m.request.op==='translate')return new Promise(resolve=>models.push({request:m.request,resolve}));
        throw Error('Unexpected request '+m.request.op);
      }},storage:{local:{async get(){return {cindyReadingPreferences:{webTarget:'zh-CN',autoVideo:false}};}},onChanged:{addListener(){},removeListener(){}}}};
    globalThis.sendAction=(action,label)=>command({type:'cindy-ui',action},{id:'fixture'},r=>replies.push({label,...r}));
  });
  for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])await page.addScriptTag({path:path.join(extension,file)});
  await t.test('restart sends new work before the cancelled model settles',async()=>{
    await page.evaluate(()=>sendAction('translate-page','first'));
    await page.waitForFunction(()=>models.length===1);
    await page.evaluate(()=>sendAction('translate-page','restore'));
    await page.waitForFunction(()=>replies.some(r=>r.label==='restore'));
    await page.evaluate(()=>sendAction('translate-page','restart'));
    await page.waitForFunction(()=>models.length===2,{},{timeout:3000});
    await page.evaluate(()=>models[0].resolve({ok:true,translations:['Stale page translation']}));
    await page.waitForFunction(()=>replies.some(r=>r.label==='first'));
    // The previous request must not release the new run's lock.
    await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(()=>models.length),2);
    await page.evaluate(()=>models[1].resolve({ok:true,translations:['Current page translation']}));
    await page.waitForFunction(()=>replies.some(r=>r.label==='restart'));
    assert.equal(await page.locator('[data-cindy-translation]').count(),1);
    assert.ok(await page.evaluate(()=>roots.some(r=>r.host.isConnected&&r.textContent.includes('Current page translation'))));
  });
  for(const failure of [false,true])await t.test('selection '+(failure?'failure':'reply')+' cannot overwrite the page view',async()=>{
    await page.evaluate(()=>sendAction('translate-page','restore-selection'));
    await page.waitForFunction(()=>document.querySelectorAll('[data-cindy-translation]').length===0);
    const start=await page.evaluate(()=>models.length);
    const completed=await page.evaluate(()=>replies.filter(r=>r.label==='selection').length);
    await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#source'));const s=getSelection();s.removeAllRanges();s.addRange(range);sendAction('selection','selection');});
    await page.waitForFunction(n=>models.length===n+1,start);
    await page.evaluate(()=>sendAction('translate-page','page'));
    await page.waitForFunction(n=>models.length===n+2,start);
    await page.evaluate(({start,failure})=>models[start].resolve(failure?{ok:false,error:'MODEL_UNAVAILABLE'}:{ok:true,translations:['Stale selection translation']}),{start,failure});
    await page.waitForFunction(n=>replies.filter(r=>r.label==='selection').length===n+1,completed);
    assert.ok(await page.evaluate(()=>replies.filter(r=>r.label==='selection').every(r=>r.ok)));
    assert.equal(await page.evaluate(()=>roots.filter(r=>r.host.isConnected).some(r=>r.querySelector('.status.error'))),false);
    await page.evaluate(n=>models[n+1].resolve({ok:true,translations:['Current page translation']}),start);
    await page.waitForFunction(()=>document.querySelectorAll('[data-cindy-translation]').length===1);
  });
});

// 2026-11-17 manual tests on a div-built feed (xueqiu.com): only the single <p> was translated
// ("Translated 1"); hot lists and cards built from divs, and everything outside the first
// <article>, were skipped.
test('div-built feeds translate their text blocks inside each block without breaking rows',{
  skip:!process.env.PLAYWRIGHT_CORE,timeout:30000,
},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1000,height:800}});
  await page.route('https://feed.test/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`
    <style>body{font:16px/1.5 sans-serif}.row{display:flex;gap:12px}.card{width:200px}</style>
    <article><p id="post">A feed post written by someone you follow.</p></article>
    <p id="linked">Read <a id="doc" href="/docs">the documentation</a> before you start.</p>
    <p id="hint"><span hidden>Tip</span>Visible article text for readers.</p>
    <aside id="hot"><div class="row"><span class="rank">1</span><a id="topic" style="display:block" href="/t">Index opens above 3600 points</a></div></aside>
    <div class="row"><div class="card"><div id="value">3584.58</div><div id="name">Shanghai composite</div></div>
      <div class="card"><div id="same">已经是中文的标题</div></div></div>`}));
  await page.goto('https://feed.test/');
  await page.evaluate(()=>{
    globalThis.sentTexts=[];
    globalThis.browser={runtime:{id:'fixture',getURL:()=> 'data:image/png;base64,',onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},
      async sendMessage(m){
        if(m.type!=='cindy-learning')return {ok:true};
        if(m.request.op==='config')return {ok:true,locale:'zh-CN'};
        if(m.request.op==='translate'){sentTexts.push(...m.request.texts);return {ok:true,translations:m.request.texts.map(text=>/[一-鿿]/.test(text)?text:'译文：'+text)};}
        throw Error('Unexpected request '+m.request.op);
      }},storage:{local:{async get(){return {cindyReadingPreferences:{webTarget:'zh-CN',autoVideo:false}};}},onChanged:{addListener(fn){globalThis.prefsChanged=fn;},removeListener(){}}}};
  });
  for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])await page.addScriptTag({path:path.join(extension,file)});
  const command=action=>page.evaluate(action=>new Promise(resolve=>command({type:'cindy-ui',action},{id:'fixture'},resolve)),action);
  const rowTop=await page.locator('#topic').evaluate(n=>n.parentElement.getBoundingClientRect().height);
  await command('translate-page');
  await page.waitForFunction(()=>document.querySelectorAll('[data-cindy-translation]').length>=2);
  const sent=await page.evaluate(()=>sentTexts);
  // Feed items are <article>s; the hot list and cards outside the first one are translated too.
  assert.ok(sent.includes('A feed post written by someone you follow.'));
  assert.ok(sent.includes('Index opens above 3600 points')&&sent.includes('Shanghai composite'));
  assert.ok(!sent.includes('3584.58'),'numbers alone are not sent');
  // Translations sit inside the text block; the flex row keeps one line of columns.
  assert.equal(await page.locator('#topic [data-cindy-translation]').count(),1);
  assert.equal(await page.locator('#name [data-cindy-translation]').count(),1);
  assert.equal(await page.locator('.row > [data-cindy-translation]').count(),0);
  assert.ok((await page.locator('#topic').evaluate(n=>n.parentElement.getBoundingClientRect().height))>rowTop);
  assert.equal(await page.locator('#same [data-cindy-translation]').count(),0,'same-language text is not duplicated');
  if(process.env.CINDY_SCREENSHOTS){await fs.mkdir(process.env.CINDY_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.CINDY_SCREENSHOTS,'div-feed-translation.png')});}
  // Translation only replaces the text in place (links kept) from the translations already made.
  const requests=await page.evaluate(()=>sentTexts.length);
  const setMode=webMode=>page.evaluate(webMode=>prefsChanged({cindyReadingPreferences:{newValue:{webTarget:'zh-CN',webMode},oldValue:{webTarget:'zh-CN'}}},'local'),webMode);
  await setMode('translation');
  assert.equal(await page.locator('#topic').innerText(),'译文：Index opens above 3600 points');
  assert.equal(await page.locator('#topic').getAttribute('href'),'/t');
  assert.equal(await page.locator('#name').innerText(),'译文：Shanghai composite');
  // 2026-11-17 review: in-place replacement emptied inline links and wrote into hidden text.
  // A block with a link stays bilingual so the link keeps its label; hidden text is skipped.
  assert.equal(await page.locator('#doc').innerText(),'the documentation');
  assert.equal(await page.locator('#linked + [data-cindy-translation]').count(),1);
  assert.equal(await page.locator('#hint').innerText(),'译文：Visible article text for readers.');
  assert.equal(await page.locator('#hint span').textContent(),'Tip');
  assert.equal(await page.locator('[data-cindy-translation]').count(),1,'only the linked block stays bilingual');
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(()=>sentTexts.length),requests,'switching the display makes no new model requests');
  await setMode('both');
  assert.equal(await page.locator('#topic [data-cindy-translation]').count(),1);
  await setMode('translation');
  await command('translate-page');
  assert.equal(await page.locator('[data-cindy-translation]').count(),0,'restore removes every injected translation');
  assert.equal(await page.locator('#name').innerText(),'Shanghai composite','restore puts the original text back');
  assert.equal(await page.locator('#topic').innerText(),'Index opens above 3600 points');
  assert.equal(await page.locator('#hint').innerText(),'Visible article text for readers.');
  // From the side panel the page translates in place without opening the page panel.
  const panelCommand=action=>page.evaluate(action=>new Promise(resolve=>command({type:'cindy-page',action},{id:'fixture'},resolve)),action);
  const panelsBefore=await page.locator('[data-cindy-panel]:visible').count();
  assert.deepEqual(await panelCommand('translate'),{ok:true,translated:true});
  assert.ok(await page.locator('[data-cindy-translation]').count()>=2);
  assert.equal(await page.locator('[data-cindy-panel]:visible').count(),panelsBefore);
  assert.deepEqual(await panelCommand('state'),{ok:true,translated:true});
  assert.deepEqual(await panelCommand('translate'),{ok:true,translated:false});
  assert.equal(await page.locator('[data-cindy-translation]').count(),0);
});

// 2026-11-17 manual test: pressing the selection button removed it on mousedown (it was not
// recognised as Cindy's own UI), so the click never landed and nothing was translated.
test('selection toolbar translates and explains with real mouse presses',{
  skip:!process.env.PLAYWRIGHT_CORE,timeout:30000,
},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1000,height:700}});
  await page.route('https://select.test/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<p id="p" style="margin:420px 20px 0;font:20px sans-serif">Markets still hope the founder will come back to lead the company.</p>'}));
  await page.goto('https://select.test/');
  await page.evaluate(()=>{
    const attach=Element.prototype.attachShadow;globalThis.roots=[];
    Element.prototype.attachShadow=function(o){const r=attach.call(this,o);roots.push(r);return r;};
    globalThis.ops=[];
    globalThis.browser={runtime:{id:'fixture',getURL:()=> 'data:image/png;base64,',onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},
      async sendMessage(m){if(m.type!=='cindy-learning')return {ok:true};ops.push(m.request.op);
        if(m.request.op==='config')return {ok:true,locale:'zh-CN'};
        if(m.request.op==='translate')return {ok:true,translations:['市场仍希望创始人回来领导公司。']};
        if(m.request.op==='explain')return {ok:true,text:'这句话是说……\n'+'很长的解释。'.repeat(120)+'\n最后一行'};
        throw Error('Unexpected request '+m.request.op);}},
      storage:{local:{async get(){return {cindyReadingPreferences:{webTarget:'zh-CN',autoVideo:false,selectionButton:true}};}},onChanged:{addListener(){},removeListener(){}}}};
  });
  for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])await page.addScriptTag({path:path.join(extension,file)});
  await page.waitForTimeout(200);
  const select=async()=>{await page.mouse.click(900,650);const b=await page.locator('#p').boundingBox();await page.mouse.move(b.x+4,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+400,b.y+b.height/2,{steps:6});await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector('[data-cindy-selection-entry]'));};
  const press=async label=>{const point=await page.evaluate(label=>{const button=roots.flatMap(r=>[...r.querySelectorAll('button')]).find(b=>b.isConnected&&b.textContent===label);const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},label);await page.mouse.click(point.x,point.y);};
  const result=()=>page.evaluate(()=>roots.map(r=>r.querySelector('.result')?.textContent).find(Boolean));
  await select();
  // The toolbar sits above the selection so it does not cover the selected line.
  const [bar,line]=await Promise.all([page.locator('[data-cindy-selection-entry]').boundingBox(),page.locator('#p').boundingBox()]);
  assert.ok(bar.y+bar.height<=line.y+2);
  // Before Cindy reports its language the toolbar follows the browser (English here); afterwards Cindy's (zh-CN).
  await press('Translate');
  await page.waitForFunction(()=>ops.includes('translate'));
  await page.waitForFunction(()=>roots.some(r=>r.querySelector('.result')?.textContent));
  assert.equal(await result(),'市场仍希望创始人回来领导公司。');
  await select();await press('解释');
  await page.waitForFunction(()=>ops.includes('explain'));
  await page.waitForFunction(()=>roots.some(r=>r.querySelector('.result')?.textContent.endsWith('最后一行')));
  // A long result stays inside the window and scrolls to its last line; the card has no "more" section.
  const card=await page.evaluate(()=>{const root=roots.find(r=>r.querySelector('.result')?.textContent);const main=root.querySelector('main'),panel=root.querySelector('.panel');
    main.scrollTop=main.scrollHeight;const last=root.querySelector('.selection-actions').getBoundingClientRect(),box=panel.getBoundingClientRect();
    return {bottom:box.bottom,height:innerHeight,scrolls:main.scrollHeight>main.clientHeight,actionsVisible:last.bottom<=box.bottom,details:root.querySelectorAll('details').length,actions:[...root.querySelectorAll('.selection-actions button')].map(b=>b.textContent)};});
  assert.ok(card.bottom<=card.height,'card stays inside the window');
  assert.ok(card.scrolls&&card.actionsVisible,'the end of a long result can be scrolled to');
  assert.equal(card.details,0);
  assert.deepEqual(card.actions,['翻译','解释','复制']);
  const [panel,selectedLine]=await Promise.all([page.locator('[data-cindy-panel]').boundingBox(),page.locator('#p').boundingBox()]);
  assert.ok(panel.y+panel.height<=selectedLine.y+1||panel.y>=selectedLine.y+selectedLine.height-1,'the card does not cover the selected line');
  if(process.env.CINDY_SCREENSHOTS){await fs.mkdir(process.env.CINDY_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.CINDY_SCREENSHOTS,'selection-explain.png')});}
});
