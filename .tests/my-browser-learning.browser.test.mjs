// Isolated Chromium + actual MV3/bridge/learning code. The paid model and Cindy
// storage are explicit fixtures; this does not claim installed Cindy validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {createLearningService} from '../my-browser/learning-service.js';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../my-browser');
const {createBridge}=require('../my-browser/node/bridge.cjs'),core=require('../my-browser/extension/learning-core.js');
test('Chrome reading: compact UI, independent subtitle modes/languages, auto YouTube, buffer, PDF/OCR',{skip:!process.env.PLAYWRIGHT_CORE,timeout:120000},async t=>{
 const {chromium}=require(process.env.PLAYWRIGHT_CORE),profile=await fs.mkdtemp(path.join(os.tmpdir(),'cindy-learning-'));let context,bridge;
 t.after(async()=>{await context?.close();await bridge?.close();await fs.rm(profile,{recursive:true,force:true,maxRetries:3});});
 const extension=path.join(profile,'extension');await fs.cp(path.join(root,'extension'),extension,{recursive:true});
 const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'der'}}),extensionId=createHash('sha256').update(publicKey).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
 const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));manifest.key=publicKey.toString('base64');await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 const files=new Map(),modelCalls=[];let subtitleMismatch=false,allowBroken=false,transientFailures=0;const prefetchGates=new Map(),prefetchStarted=[];
 const service=createLearningService({core,locale:()=> 'zh-CN',model:async r=>{
  modelCalls.push(r);const material=JSON.parse(r.prompt.split('\n').at(-1));
  if(material.transcript)return {ok:true,text:'Editorial brief: preserve the source meaning and produce consistent natural Chinese prose.'};
  if(material.text==='BrokenSubtitle'&&!allowBroken)return {ok:true,text:''};
  if(material.turns){
    const text=material.turns.map(t=>t.text).join(' ');
    if(text.includes('TransientSubtitle')&&transientFailures++===0)return {ok:false,errorCode:'TIMEOUT'};
    if(text.includes('UnavailableSubtitle'))return {ok:false,errorCode:'INTERNAL'};
    if(text.includes('and I think you can relate to this,')&&!subtitleMismatch){subtitleMismatch=true;return {ok:true,text:'{"turns":[]}'};}
    const turns=material.turns.map(t=>{
      const words=t.text.split(' '),captions=[];let start=0;
      for(let i=0;i<words.length;i++)if(words[i]==='subtitle'||i===words.length-1||words[0].startsWith('Buffer')&&(i+1)%10===0){const text=words.slice(start,i+1).join(' ');captions.push({text,paragraphEnd:i===words.length-1,translation:text==='BrokenSubtitle'&&!allowBroken?'':text==='and I think you can relate to this,'?'而且我觉得你也能对此产生共鸣，':words[0].startsWith('Buffer')?'连续字幕 '+i:'译文：'+text});start=i+1;}
      return {id:t.id,captions};
    });
    if(text.startsWith('Buffer')){const first=text.split(' ')[0];prefetchStarted.push(first);return new Promise(resolve=>prefetchGates.set(first,()=>resolve({ok:true,text:JSON.stringify({turns})})));}
    return {ok:true,text:JSON.stringify({turns})};
  }
  return {ok:true,text:r.expectJson?JSON.stringify({translations:material.texts.map(x=>'译文：'+x)}):'这是结合上下文的解释。'};
 },library:async r=>r.op==='open'?{ok:true}:r.op==='read'?(files.has(r.path)?{ok:true,content:files.get(r.path)}:{ok:false,errorCode:'NOT_FOUND'}):(files.set(r.path,r.content),{ok:true})});

 bridge=createBridge({ports:[18819],extensionId,notify:(_method,p)=>{service.handle(p.clientId,p.request,async()=> (await bridge.request('learningActive',{id:p.id})).active,progress=>bridge.request('learningProgress',{id:p.id,progress})).then(result=>bridge.request('learningResult',{id:p.id,result}),e=>bridge.request('learningResult',{id:p.id,result:{ok:false,error:e.message}}));}});await bridge.request('status');
 const fixture='<title>Reading fixture</title><main style="max-width:600px;padding:40px;font:20px/1.8 sans-serif"><h1>Learning with Cindy</h1><p>Hello world. Reading gives us new ideas.</p><p>Practice makes progress.</p><div id="movie_player" class="html5-video-player" style="position:relative;width:960px;height:540px;background:linear-gradient(125deg,#977c66,#293d3d)"><video controls style="width:100%;height:100%;display:block"></video><div class="ytp-caption-window-container" style="position:absolute;bottom:30px;left:25%;color:white">Original YouTube caption</div></div></main>';
 const proxy=http.createServer((req,res)=>{let url;try{url=new URL(req.url);}catch{res.writeHead(403);return res.end();}if(['example.test','www.youtube.com'].includes(url.hostname)){res.setHeader('content-type','text/html');return res.end(fixture);}if(url.hostname!=='127.0.0.1'||url.port!=='18819'){res.writeHead(403);return res.end();}const upstream=http.request({hostname:'127.0.0.1',port:18819,path:url.pathname,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);});
 proxy.on('connect',(_r,s)=>s.end('HTTP/1.1 403 Forbidden\r\n\r\n'));await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{proxy.closeAllConnections();proxy.close();});
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',executablePath:process.env.CHROMIUM_PATH,headless:true,viewport:{width:1280,height:900},args:['--proxy-server=http://127.0.0.1:'+proxy.address().port,'--proxy-bypass-list=<-loopback>','--disable-extensions-except='+extension,'--load-extension='+extension]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();
 for(let i=0;i<50;i++){if((await bridge.request('status')).extension_connected)break;await page.waitForTimeout(100);}
 await page.goto('http://example.test/');await page.waitForTimeout(200);
 const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'http://example.test/*'}))[0].id);
 const opened=await worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'open'}),tabId);assert.equal(opened.ok,true);
 // CDP can inspect closed roots without changing the production isolation boundary.
 const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');
 async function element(tag,text){const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});let found;function walk(n){if(n.nodeName===tag&&(!text||n.children?.some(c=>c.nodeValue===text)||n.attributes?.includes(text)))found=n;for(const c of [...(n.children||[]),...(n.shadowRoots||[])])walk(c);}walk(root);assert.ok(found,tag+' '+text+' '+JSON.stringify(root).slice(-3000));return (await cdp.send('DOM.resolveNode',{nodeId:found.nodeId})).object.objectId;}
 async function click(text){const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true}),matches=[];function walk(n){if(n.nodeName==='BUTTON'&&(n.children?.some(c=>c.nodeValue===text)||n.attributes?.includes(text)))matches.push(n);for(const c of [...(n.children||[]),...(n.shadowRoots||[])])walk(c);}walk(root);for(const n of matches.reverse()){const {object}=await cdp.send('DOM.resolveNode',{nodeId:n.nodeId});const r=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'async function(){const r=this.getBoundingClientRect();if(!r.width||!r.height)return null;this.scrollIntoView({block:"nearest"});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const b=this.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=this.getRootNode().elementFromPoint(x,y);if(hit!==this&&!this.contains(hit))return null;return {x,y}}',awaitPromise:true,returnByValue:true});if(r.result.value){await page.mouse.click(r.result.value.x,r.result.value.y);return;}}assert.fail('No visible button '+text);}
 async function panelText(){const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});return JSON.stringify(root);}

 const screenshots=process.env.CINDY_SCREENSHOTS;if(screenshots)await fs.mkdir(screenshots,{recursive:true});
 async function readNode(tag,name,fn){return (await cdp.send('Runtime.callFunctionOn',{objectId:await element(tag,name),functionDeclaration:fn,returnByValue:true})).result.value;}
 async function waitText(text){for(let i=0;i<70&&!(await panelText()).includes(text);i++)await page.waitForTimeout(100);assert.ok((await panelText()).includes(text),'missing '+text);}
 async function summary(label){const r=await readNode('SUMMARY',label,'function(){this.scrollIntoView({block:"nearest"});const r=this.getBoundingClientRect();return {x:r.x+12,y:r.y+r.height/2}}');await page.mouse.click(r.x,r.y);}
 async function appearance(){return readNode('SECTION','Cindy','function(){const s=getComputedStyle(this);return {width:this.getBoundingClientRect().width,color:s.color,background:s.backgroundColor,theme:this.dataset.theme}}');}
 assert.equal((await appearance()).width,336);assert.equal((await appearance()).theme,'light');
 assert.doesNotMatch(await panelText(),/"nodeValue":"(?:口语|收藏)"/);
 await page.emulateMedia({colorScheme:'dark'});assert.equal((await appearance()).theme,'light');
 await page.addStyleTag({content:'html{--text:red;--surface:red;font:32px serif;color:red}html>div{font:40px serif!important;color:black!important;background:red!important;position:static!important;width:900px!important}'});
 assert.equal((await appearance()).color,'rgb(38, 38, 38)');assert.equal((await appearance()).width,336);
 if(screenshots)await page.screenshot({path:path.join(screenshots,'web-light.png')});
 await click('翻译此页面');await waitText('译文：Practice');await click('关闭');assert.match(await panelText(),/译文：Practice/,'closing panel retains translated page');
 await worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'open'}),tabId);await click('恢复原文');assert.doesNotMatch(await panelText(),/译文：Practice/);
 // Selection opens next to the text and translates without a manual submit or save controls.
 await page.evaluate(()=>{const p=document.querySelector('main>p'),r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r)});
 await worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'selection'}),tabId);await waitText('译文：Hello world');assert.doesNotMatch(await panelText(),/"nodeValue":"收藏"/);
 await click('解释');await waitText('这是结合上下文的解释。');await click('关闭');
 await worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'settings'}),tabId);
 await waitText('在 Cindy 的「浏览器翻译」任务中选择模型和思考强度');
 await readNode('SELECT','外观','function(){this.value="dark";this.dispatchEvent(new Event("change"))}');assert.equal((await appearance()).theme,'dark');
 if(screenshots)await page.screenshot({path:path.join(screenshots,'settings-dark.png')});
 await readNode('SELECT','外观','function(){this.value="light";this.dispatchEvent(new Event("change"))}');await click('返回');
 const wav=Buffer.alloc(44+8000*2*3);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 await page.evaluate(async data=>{const v=document.querySelector('video');v.src='data:audio/wav;base64,'+data;await new Promise(r=>v.onloadedmetadata=r);const track=v.addTextTrack('captions','English','en');track.mode='showing';track.addCue(new VTTCue(0,.4,'First'));track.addCue(new VTTCue(.4,1,'subtitle'));track.addCue(new VTTCue(1,1.4,'and I think'));track.addCue(new VTTCue(1.4,1.7,'you can relate'));track.addCue(new VTTCue(1.7,2,'to this,'));v.currentTime=1.4},wav.toString('base64'));
 await worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'video'}),tabId);await waitText('而且我觉得你也能对此产生共鸣，');
 async function captions(){return readNode('DIV','caption-box','function(){const r=this.getBoundingClientRect();return {original:this.querySelector(".caption-original").textContent,translation:this.querySelector(".caption-translation").textContent,originalHidden:this.querySelector(".caption-original").hidden,translationHidden:this.querySelector(".caption-translation").hidden,hidden:this.hidden,bottom:r.bottom,x:r.x,width:r.width,settingsHidden:this.getRootNode().querySelector(".caption-settings").hidden}}');}
 assert.equal((await captions()).original,'and I think you can relate to this,');assert.equal(await page.locator('.ytp-caption-window-container').evaluate(n=>getComputedStyle(n).visibility),'hidden');
 await click('仅译文');assert.equal((await captions()).originalHidden,true);await click('仅原文');assert.equal((await captions()).translationHidden,true);const count=modelCalls.length;await page.waitForTimeout(1300);assert.equal(modelCalls.length,count,'original-only does not call translation');
 await click('关闭字幕');assert.equal((await captions()).hidden,true);await click('双语');await click('大');
 // Extra languages require explicit expansion and are not labeled supported.
 await click('翻译为');await click('尝试其他语言');await waitText('语言目录不代表所选模型已验证支持。');
 await readNode('INPUT','搜索语言名称或代码','function(){this.value="fr";this.dispatchEvent(new Event("input"))}');await click('法语');
 let prefs=await worker.evaluate(async()=> (await chrome.storage.local.get('cindyReadingPreferences')).cindyReadingPreferences);assert.equal(prefs.videoTarget,'fr');assert.equal(prefs.webTarget,'zh-CN');
 await click('字幕设置');assert.equal((await captions()).settingsHidden,true);
 await page.locator('#movie_player').evaluate(n=>n.requestFullscreen());await page.waitForTimeout(150);assert.ok((await captions()).bottom<900);await click('字幕设置');assert.equal((await captions()).settingsHidden,false);
 if(screenshots)await page.screenshot({path:path.join(screenshots,'player-fullscreen.png')});
 await page.evaluate(()=>document.exitFullscreen());await page.waitForTimeout(100);await click('双语');await click('翻译为');await readNode('INPUT','搜索语言名称或代码','function(){this.value="zh-CN";this.dispatchEvent(new Event("input"))}');await click('zh-CN');await click('字幕设置');
 if(screenshots)await page.locator('#movie_player').screenshot({path:path.join(screenshots,'player-bilingual.png')});
 // Hard speaker/pause boundaries are isolated before generation, in a single contextual batch.
 await page.evaluate(()=>{const track=document.querySelector('video').textTracks[0];for(const c of [...track.cues])track.removeCue(c);track.addCue(new VTTCue(0,1,'Repairfirst phrase.'));track.addCue(new VTTCue(2.3,2.8,'Repairsecond phrase.'));document.querySelector('video').currentTime=2.5;});
 for(let i=0;i<60&&!(await panelText()).includes('译文：Repairsecond phrase.');i++)await page.waitForTimeout(100);
 assert.equal((await captions()).original,'Repairsecond phrase.');assert.equal((await captions()).translation,'译文：Repairsecond phrase.');
 const repairedCalls=modelCalls.map(r=>JSON.parse(r.prompt.split('\n').at(-1))).filter(m=>m.turns&&m.turns.map(t=>t.text).join(' ').includes('Repair'));
 assert.equal(repairedCalls.length,1);assert.equal(repairedCalls[0].turns.length,2);
 // Persistent malformed output stops automatic model retries and exposes a local retry.
 await page.evaluate(()=>{const track=document.querySelector('video').textTracks[0];for(const c of [...track.cues])track.removeCue(c);track.addCue(new VTTCue(0,1,'BrokenSubtitle'));track.addCue(new VTTCue(2.3,2.8,'HealthySubtitle'));document.querySelector('video').currentTime=.5;});
 for(let i=0;i<60&&!(await panelText()).includes('部分字幕译文为空或无法读取');i++)await page.waitForTimeout(100);
 assert.match(await panelText(),/部分字幕译文为空或无法读取/);
 const brokenCalls=()=>modelCalls.filter(r=>{const m=JSON.parse(r.prompt.split('\n').at(-1));return m.turns&&m.turns.map(t=>t.text).join(' ').includes('BrokenSubtitle');}).length;
 await page.locator('video').evaluate(v=>{v.currentTime=2.5;});
 for(let i=0;i<40&&(await captions()).translation!=='译文：HealthySubtitle';i++)await page.waitForTimeout(100);assert.equal((await captions()).translation,'译文：HealthySubtitle');assert.equal(brokenCalls(),4);await page.evaluate(()=>{document.querySelector('video').currentTime=.5;});await page.waitForTimeout(100);assert.equal((await captions()).original,'BrokenSubtitle');assert.equal((await captions()).translation,'');await page.waitForTimeout(1400);assert.equal(brokenCalls(),4);
 allowBroken=true;await click('字幕设置');if(screenshots)await page.screenshot({path:path.join(screenshots,'retry-before.png')});await click('重试字幕翻译');if(screenshots)await page.screenshot({path:path.join(screenshots,'retry-after.png')});
 for(let i=0;i<40&&!(await panelText()).includes('译文：BrokenSubtitle');i++)await page.waitForTimeout(100);
 assert.match(await panelText(),/译文：BrokenSubtitle/);assert.equal(modelCalls.filter(r=>{const m=JSON.parse(r.prompt.split('\n').at(-1));return m.turns?.some(t=>t.text==='HealthySubtitle');}).length,1,'manual retry preserves already translated passages');
 // Leaving player mode restores original caption containers and tracks.
 await worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'open'}),tabId);assert.equal(await page.locator('.ytp-caption-window-container').evaluate(n=>getComputedStyle(n).visibility),'visible');assert.equal(await page.locator('video').evaluate(v=>v.textTracks[0].mode),'showing');
 // Automatic YouTube initialization, full transcript, native control bar and SPA navigation.
 await worker.evaluate(()=>{const originalFetch=globalThis.fetch;globalThis.fixtureCaptionReads=0;globalThis.fetch=(input,init)=>{
  if(String(input).startsWith('https://www.youtube.com/api/timedtext?fixture=full')){globalThis.fixtureCaptionReads++;return Promise.resolve(new Response(JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'Entire transcript ',tOffsetMs:0},{utf8:'from the beginning.',tOffsetMs:400}]},{tStartMs:1000,dDurationMs:1200,segs:[{utf8:'A complete phrase outside the native window.'}]}]}),{status:200}));}return originalFetch(input,init)};});
 await page.goto('http://www.youtube.com/watch?v=fixture');
 await page.evaluate(async data=>{const controls=document.createElement('div');controls.className='ytp-right-controls';controls.style.cssText='position:absolute;bottom:0;right:0;height:40px';const chromeBottom=document.createElement('div');chromeBottom.className='ytp-chrome-bottom';chromeBottom.style.cssText='position:absolute;bottom:0;left:0;width:100%;height:56px';chromeBottom.append(controls);document.querySelector('#movie_player').append(chromeBottom);globalThis.ytInitialPlayerResponse={captions:{playerCaptionsTracklistRenderer:{captionTracks:[{baseUrl:'https://www.youtube.com/api/timedtext?fixture=full',languageCode:'en'}]}}};const v=document.querySelector('video');v.style.position='absolute';v.style.top='-540px';v.src='data:audio/wav;base64,'+data;await new Promise(r=>v.onloadedmetadata=r);const track=v.addTextTrack('captions','English','en');track.mode='showing';track.addCue(new VTTCue(1,2,'Partial native fragment'));v.currentTime=1.4;document.dispatchEvent(new Event('yt-navigate-finish'));},wav.toString('base64'));
 await waitText('译文：Entire transcript');assert.equal((await captions()).settingsHidden,true);assert.doesNotMatch((await captions()).original,/Partial native/);
 // Real YouTube can position its video a full player-height above the player
 // during initialization, then move it back without a size/metadata event.
 await page.locator('video').evaluate(v=>{v.style.top='0px';});
 const playerBounds=await page.locator('#movie_player').boundingBox();
 const overlayBounds=await page.locator('[data-cindy-captions]').boundingBox();
 assert.ok(Math.abs(overlayBounds.y-playerBounds.y)<1,'subtitle layer stays inside the player after video repositioning');
 const visibleCaption=await captions();assert.equal(visibleCaption.hidden,false);
 assert.ok(visibleCaption.bottom>playerBounds.y&&visibleCaption.bottom<=playerBounds.y+playerBounds.height,'rendered captions are in the visible player');
 await click('字幕设置');assert.equal((await captions()).settingsHidden,false,'native player menu opens with a real pointer click');
 const menuBounds=await readNode('SECTION','字幕设置','function(){const r=this.getBoundingClientRect();return {top:r.top,bottom:r.bottom}}');
 assert.ok(menuBounds.top>=playerBounds.y&&menuBounds.bottom<=playerBounds.y+playerBounds.height,'settings remain inside player');
 await click('关闭设置');assert.equal((await captions()).settingsHidden,true);
 // Ready details never float over the picture; captions follow YouTube's
 // own auto-hide state even without pointer events (keyboard/pause/fullscreen).
 assert.equal(await readNode('DIV','caption-notice','function(){return !!this.closest(".caption-settings")&&!this.getClientRects().length}'),true);
 await page.waitForTimeout(220);const raised=(await captions()).bottom;
 await page.locator('#movie_player').evaluate(n=>n.classList.add('ytp-autohide'));await page.waitForTimeout(220);
 const lowered=(await captions()).bottom;assert.ok(lowered-raised>25,'captions descend when native controls hide');
 if(screenshots)await page.locator('#movie_player').screenshot({path:path.join(screenshots,'player-controls-hidden.png')});
 await page.locator('#movie_player').evaluate(n=>n.classList.remove('ytp-autohide'));await page.waitForTimeout(220);
 assert.ok(Math.abs((await captions()).bottom-raised)<2,'captions clear the control bar when it returns');
 if(screenshots)await page.locator('#movie_player').screenshot({path:path.join(screenshots,'player-controls-visible.png')});
 await click('字幕设置');
 assert.equal(await readNode('DIV','preparation-track','function(){return this.getAttribute("aria-valuenow")}'),'100');
 assert.equal(await readNode('DIV','preparation-heading','function(){return this.textContent.includes("已就绪")&&!this.textContent.includes("%")}'),true);
 if(screenshots)await page.locator('#movie_player').screenshot({path:path.join(screenshots,'player-ready-menu-light.png')});
 // Stress the real player UI with a narrow viewport, long labels and scrolling.
 const previousLayout=await page.evaluate(()=>({main:document.querySelector('main').style.cssText,player:document.querySelector('#movie_player').style.cssText}));
 await page.setViewportSize({width:360,height:640});
 await page.evaluate(()=>{document.querySelector('main').style.cssText='padding:8px;width:100%';const p=document.querySelector('#movie_player');p.style.width='100%';p.style.height='230px';
   const left=document.createElement('div');left.className='ytp-left-controls';left.style.cssText='width:100px;height:40px;position:absolute;bottom:0;left:0';p.querySelector('.ytp-chrome-bottom').append(left);
   const native=document.createElement('button');native.dataset.fixtureControl='';native.textContent='YouTube';native.style.cssText='width:100px;height:40px;vertical-align:top';p.querySelector('.ytp-right-controls').append(native);
 });await page.waitForTimeout(150);
 await readNode('BUTTON','翻译为','function(){this.textContent="VeryLongLanguageName".repeat(4)}');
 const menuLayout=await readNode('SECTION','字幕设置','function(){const r=this.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:this.scrollWidth-this.clientWidth,captionVisibility:getComputedStyle(this.getRootNode().querySelector(".caption-box")).visibility}}');
 assert.ok(menuLayout.left>=0&&menuLayout.right<=360&&menuLayout.top>=0&&menuLayout.bottom<=640,JSON.stringify(menuLayout));assert.ok(menuLayout.overflow<=1,JSON.stringify(menuLayout));assert.equal(menuLayout.captionVisibility,'hidden','settings and subtitles never overprint');
 const controlWidth=await readNode('BUTTON','字幕设置','function(){return this.getBoundingClientRect().width}');assert.ok(controlWidth<=112,'Cindy leaves room for native controls');
 for(const theme of ['light','dark']){await readNode('DIV','cindy-root captions-root',`function(){this.dataset.theme="${theme}"}`);if(screenshots)await page.locator('#movie_player').screenshot({path:path.join(screenshots,'player-narrow-'+theme+'.png')});}
 await readNode('DIV','cindy-root captions-root','function(){this.dataset.theme="light"}');
 await readNode('SECTION','字幕设置','function(){this.scrollTop=this.scrollHeight}');
 await click('关闭设置');assert.equal((await captions()).settingsHidden,true,'close remains clickable after scrolling a short menu');
 // Valid maximum-length captions must fit the small player, even at the large size.
 const longCaption=await readNode('DIV','caption-box','function(){const root=this.getRootNode();root.querySelector(".caption-original").textContent="Long caption ".repeat(8);root.querySelector(".caption-translation").textContent="这是用于检查小播放器长字幕换行的文本".repeat(5);window.dispatchEvent(new Event("resize"));const b=this.getBoundingClientRect(),p=root.host.getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,playerTop:p.top,playerBottom:p.bottom,playerLeft:p.left,playerRight:p.right}}');
 assert.ok(longCaption.top>=longCaption.playerTop&&longCaption.bottom<=longCaption.playerBottom&&longCaption.left>=longCaption.playerLeft&&longCaption.right<=longCaption.playerRight,JSON.stringify(longCaption));
 if(screenshots)await page.locator('#movie_player').screenshot({path:path.join(screenshots,'player-narrow-long-caption.png')});
 await click('字幕设置');await page.evaluate(()=>scrollTo(0,130));await page.waitForTimeout(100);
 const scrolled=await readNode('SECTION','字幕设置','function(){const r=this.getBoundingClientRect();return {top:r.top,bottom:r.bottom}}');assert.ok(scrolled.top>=0&&scrolled.bottom<=640,JSON.stringify(scrolled));
 await click('关闭设置');
 await page.evaluate(previous=>{scrollTo(0,0);document.querySelector('.ytp-left-controls').remove();document.querySelector('[data-fixture-control]').remove();document.querySelector('main').style.cssText=previous.main;document.querySelector('#movie_player').style.cssText=previous.player;},previousLayout);
 await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(150);await click('字幕设置');
 await click('关闭设置');
 assert.equal(await page.locator('.ytp-right-controls [data-cindy-player-control]').count(),1);
 const beforeMenu=modelCalls.length;await worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'open'}),tabId);assert.equal((await captions()).settingsHidden,false);assert.equal(modelCalls.length,beforeMenu,'opening player settings keeps prepared subtitles');await click('字幕设置');
 await click('字幕设置');await click('仅原文');const beforeOriginal=modelCalls.length;
 await page.evaluate(()=>{history.pushState({},'', '/watch?v=second');document.dispatchEvent(new Event('yt-navigate-finish'))});await page.waitForTimeout(2500);assert.equal(modelCalls.length,beforeOriginal);assert.equal((await captions()).translationHidden,true);assert.equal((await captions()).settingsHidden,true);
 await click('字幕设置');await click('双语');await click('选项');await click('自动应用到 YouTube');await page.waitForTimeout(100);assert.equal(await readNode('BUTTON','自动应用到 YouTube','function(){return this.getAttribute("aria-checked")}'),'false');assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('cindyReadingPreferences')).cindyReadingPreferences.autoVideo),false);
 await page.goto('http://www.youtube.com/watch?v=third');await page.waitForTimeout(800);assert.equal(await page.locator('[data-cindy-captions]').count(),0,'auto preference survives navigation');
 // Slow requests: play current prepared window, prefetch next; seeking prioritizes the new place.
 await page.goto('http://example.test/buffer');await page.waitForTimeout(100);
 const longWav=Buffer.alloc(44+8000*2*150);wav.copy(longWav,0,0,44);longWav.writeUInt32LE(longWav.length-8,4);longWav.writeUInt32LE(longWav.length-44,40);
 await page.evaluate(async data=>{const v=document.querySelector('video');v.src='data:audio/wav;base64,'+data;v.muted=true;await new Promise(r=>v.onloadedmetadata=r);const track=v.addTextTrack('captions','English','en');track.mode='showing';for(let i=0;i<72;i++)track.addCue(new VTTCue(i*2,(i+1)*2,Array.from({length:10},(_,j)=>'Buffer'+(i*10+j)).join(' ')));await v.play()},longWav.toString('base64'));
 await worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'video'}),tabId);
 // Waiting for subtitles before playback is opt-in: turn it on for the buffering checks below.
 await click('选项');await click('字幕准备好再播放');assert.equal(await readNode('BUTTON','字幕准备好再播放','function(){return this.getAttribute("aria-checked")}'),'true');
 for(let i=0;i<60&&prefetchStarted.length<2;i++)await page.waitForTimeout(100);
 await waitText('翻译任务执行中');assert.equal(await readNode('DIV','preparation-track','function(){return this.getAttribute("aria-valuenow")}'),'0');
 if(screenshots){
   await page.screenshot({path:path.join(screenshots,'subtitle-progress-waiting.png')});
   await click('模型设置');
   await readNode('SELECT','外观','function(){this.value="dark";this.dispatchEvent(new Event("change"))}');
   assert.equal(await readNode('DIV','caption-notice','function(){return getComputedStyle(this).backgroundColor}'),'rgb(31, 31, 30)');
   await click('返回');await page.screenshot({path:path.join(screenshots,'subtitle-progress-dark.png')});
   await click('模型设置');
   await readNode('SELECT','外观','function(){this.value="light";this.dispatchEvent(new Event("change"))}');await click('返回');
 }
 assert.deepEqual(prefetchStarted,['Buffer0','Buffer180']);assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
 prefetchGates.get('Buffer0')();for(let i=0;i<40&&await page.locator('video').evaluate(v=>v.paused);i++)await page.waitForTimeout(100);assert.equal(await page.locator('video').evaluate(v=>v.paused),false);
 assert.equal(await readNode('DIV','preparation-track','function(){return this.getAttribute("aria-valuenow")}'),'100','one ready passage completes playback preparation without translating the entire video');
 assert.ok(prefetchStarted.length<5,'readiness does not submit the whole video');
 await click('关闭设置');
 assert.equal(await readNode('DIV','caption-notice','function(){return this.getClientRects().length}'),0,'partial whole-video completion cannot leave a floating progress card');await click('字幕设置');

 await page.locator('video').evaluate(v=>{v.currentTime=120});
 // Host model calls cannot be aborted. Finish an old provider call before the
 // seek can consume its slot; the obsolete result must never reach the captions.
 await waitText('等待先前模型请求结束');assert.equal(prefetchStarted.includes('Buffer540'),false,'seeking cannot bypass occupied provider slots');
 if(screenshots)await page.screenshot({path:path.join(screenshots,'subtitle-progress-previous.png')});
 prefetchGates.get('Buffer180')();for(let i=0;i<40&&!prefetchStarted.includes('Buffer540');i++)await page.waitForTimeout(100);assert.ok(prefetchStarted.includes('Buffer540'));
 await click('字幕');await click('仅原文');for(let i=0;i<30&&await page.locator('video').evaluate(v=>v.paused);i++)await page.waitForTimeout(100);assert.equal(await page.locator('video').evaluate(v=>v.paused),false,'original mode releases Cindy-owned buffer pause');
 assert.equal(modelCalls.some(r=>JSON.parse(r.prompt.split('\n').at(-1)).transcript),false);
 for(const release of prefetchGates.values())release();await page.waitForTimeout(100);
 // Recover one model timeout on a smaller passage; a permanent failure must
 // release the buffering pause while preserving source captions and its code.
 await page.goto('http://example.test/recovery');await page.waitForTimeout(100);
 await page.evaluate(async data=>{const v=document.querySelector('video');v.src='data:audio/wav;base64,'+data;v.muted=true;await new Promise(r=>v.onloadedmetadata=r);const track=v.addTextTrack('captions','English','en');track.mode='showing';track.addCue(new VTTCue(0,1,'TransientSubtitle'));track.addCue(new VTTCue(1.5,2.8,'RecoveryHealthy'));await v.play()},wav.toString('base64'));
 await worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'video'}),tabId);await click('双语');
 await waitText('译文：TransientSubtitle');assert.equal(transientFailures,2,'the timed-out passage retries only its missing part');
 await page.evaluate(async()=>{const v=document.querySelector('video'),track=v.textTracks[0];for(const c of [...track.cues])track.removeCue(c);track.addCue(new VTTCue(0,2.8,'UnavailableSubtitle'));v.currentTime=.2;await v.play();});
 await waitText('(INTERNAL)');if(screenshots)await page.screenshot({path:path.join(screenshots,'subtitle-progress-error.png')});assert.equal(await page.locator('video').evaluate(v=>v.paused),false,'failed translation cannot strand the buffering pause');
 await worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'close'}),tabId);
 const reader=await context.newPage();await reader.goto('chrome-extension://'+extensionId+'/library.html');await reader.getByRole('button',{name:'打开 PDF / 文本 / Markdown'}).waitFor();assert.equal(await reader.getByRole('button',{name:'收藏',exact:true}).count(),0);
 const ocr=await reader.evaluate(async()=>{const {createOCR}=await import('./ocr.js');const c=document.createElement('canvas');c.width=1000;c.height=180;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='60px Arial';x.fillText('CINDY READING TEST',25,100);const o=createOCR();try{return await o.recognize(c,'eng')}finally{o.close()}});assert.match(ocr,/CINDY READING TEST/);
 const printPage=await context.newPage();await printPage.setContent('<h1>Cindy PDF reading</h1><p>Hello from the PDF text layer.</p>');const pdf=await printPage.pdf();await printPage.close();const choosing=reader.waitForEvent('filechooser');await reader.getByRole('button',{name:'打开 PDF / 文本 / Markdown'}).click();await(await choosing).setFiles({name:'fixture.pdf',mimeType:'application/pdf',buffer:pdf});await reader.locator('canvas').waitFor();await reader.getByText('1 / 1',{exact:true}).waitFor();await worker.evaluate(()=>{const original=globalThis.fetch;let dropped=false;globalThis.fetch=(...args)=>{if(!dropped&&String(args[0]).endsWith('/learning/result')){dropped=true;return Promise.reject(new TypeError('fixture lost response'));}return original(...args);};});
 await reader.getByRole('button',{name:'翻译',exact:true}).last().click();await reader.getByText('译文：Hello from the PDF text layer.',{exact:false}).waitFor();
 assert.equal(modelCalls.filter(r=>JSON.parse(r.prompt.split('\n').at(-1)).texts?.includes('Hello from the PDF text layer.')).length,1,'a lost result poll never resubmits the model request');
 // Finish a slow old PDF after a new text file is selected: its UI must stay detached.
 await reader.evaluate(()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){if(this.name==='slow.pdf')await new Promise(r=>setTimeout(r,400));return original.call(this);};});
 const chooseFile=async file=>{const choosing=reader.waitForEvent('filechooser');await reader.getByRole('button',{name:'打开 PDF / 文本 / Markdown'}).click();await(await choosing).setFiles(file);};
 await chooseFile({name:'slow.pdf',mimeType:'application/pdf',buffer:pdf});
 await chooseFile({name:'latest.txt',mimeType:'text/plain',buffer:Buffer.from('Latest reader document')});await reader.waitForTimeout(700);
 assert.equal(await reader.locator('textarea').inputValue(),'Latest reader document');assert.equal(await reader.locator('canvas').count(),0);
 if(screenshots)await reader.screenshot({path:path.join(screenshots,'pdf.png')});
 // Real extension reload: old content scripts remain in SPA documents but their
 // APIs are invalid. They must release the player and stop URL polling quietly.
 await worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'video'}),tabId);
 assert.equal(await page.locator('[data-cindy-captions]').count(),1);
 const exceptions=[];await cdp.send('Runtime.enable');cdp.on('Runtime.exceptionThrown',event=>exceptions.push(event.exceptionDetails.exception?.description||event.exceptionDetails.text));
 await worker.evaluate(()=>{setTimeout(()=>chrome.runtime.reload(),50);});
 await page.waitForTimeout(1500);
 for(let i=0;i<3;i++){await page.evaluate(i=>history.pushState({},'', '/photo/'+i),i);await page.waitForTimeout(1100);}
 assert.deepEqual(exceptions,[],'extension reload and SPA navigation produce no uncaught errors');
 assert.equal(await page.locator('[data-cindy-captions],[data-cindy-panel],[data-cindy-player-control]').count(),0,'old subtitle and panel DOM are removed');
 assert.equal(await page.locator('.ytp-caption-window-container').evaluate(n=>n.style.visibility),'','native subtitles are restored');
 await page.reload();await page.waitForTimeout(250);
 const nextWorker=context.serviceWorkers().find(w=>w!==worker)||context.serviceWorkers()[0];
 const reopened=await nextWorker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'cindy-ui',action:'open'}),tabId);
 assert.equal(reopened.ok,true,'fresh document reconnects after extension reload');
});
