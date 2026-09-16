// Optional real-Chromium integration suite. Supply PLAYWRIGHT_CORE (module path)
// and install its Chromium at development time; no runtime plugin dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,'../my-browser');
const {createBridge}=require('../my-browser/node/bridge.cjs');
const P=require('../my-browser/extension/policy.js');
const enabled=!!process.env.PLAYWRIGHT_CORE;
test('real Chrome: sandbox messages → Node → MV3 → DOM, settings and negative paths',{skip:!enabled,timeout:120000},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'my-browser-test-'));let context;
  t.after(async()=>{await context?.close();await fs.rm(profile,{recursive:true,force:true,maxRetries:3});});
  const extensionDir=path.join(profile,'unpacked-extension');await fs.cp(path.join(root,'extension'),extensionDir,{recursive:true});
  // Fixture transport uses loopback/proxy interception. Simulate PUBLIC peer evidence
  // only for named positive fixtures at the browser API boundary; private.test keeps
  // the real loopback address. Production guard and document binding run unchanged.
  const networkShim=`const nativeCompleted=chrome.webRequest.onCompleted.addListener.bind(chrome.webRequest.onCompleted);
  chrome.webRequest.onCompleted.addListener=(fn,...args)=>nativeCompleted(d=>fn(['example.test','blocked.test','redirect.test','x.com'].includes(new URL(d.url).hostname)?{...d,ip:'8.8.8.8'}:d),...args);\n`;
  const backgroundPath=path.join(extensionDir,'background.js');
  await fs.writeFile(backgroundPath,networkShim+await fs.readFile(backgroundPath,'utf8'));
  const {generateKeyPairSync,createHash}=require('node:crypto');
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'der'}});
  const extensionId=createHash('sha256').update(publicKey).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
  const extensionManifest=JSON.parse(await fs.readFile(path.join(extensionDir,'manifest.json'),'utf8'));
  await fs.writeFile(path.join(extensionDir,'manifest.json'),JSON.stringify({...extensionManifest,key:publicKey.toString('base64')}));
  const bridge=createBridge({ports:[18819],extensionId});t.after(()=>bridge.close());
  await bridge.request('status'); // Fail before launching Chrome if the isolated test port is occupied.
  const installCalls=[];
  const installation=require('../my-browser/node/installation.cjs').createInstallation({platform:'darwin',exists:p=>p.includes('Chrome') || p.includes('Safari') || p.endsWith('.zip'),run:async(...args)=>installCalls.push(args)});
  let cfg={policy:{read:{block:[]},interact:{allow:[],block:[]}}};const faults={read:false,save:false};
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.headers.host?.startsWith('example.test') || req.headers.host?.startsWith('private.test')){res.setHeader('Content-Type','text/html');return res.end(fixture);}
      if(req.headers.host?.startsWith('blocked.test')){res.setHeader('Content-Type','text/html');return res.end('<h1>Blocked fixture</h1>');}
      if(req.headers.host?.startsWith('redirect.test')){res.writeHead(302,{Location:'http://blocked.test/'});return res.end();}
      let data='';for await(const c of req)data+=c;
      const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
      if(req.url==='/node-request'){const v=JSON.parse(data);return json({ok:true,result:v.method==='installation'?{ok:true,...installation.status()}:v.method==='openInstallation'?await installation.open(v.params.browser,v.params.mode):await bridge.request(v.method,v.params)});}
      if(req.url==='/kv'){
        if((req.method==='GET'&&faults.read)||(req.method==='PUT'&&faults.save)){res.statusCode=503;return json({});}
        if(req.method==='PUT'){cfg=JSON.parse(data);res.statusCode=204;return res.end();}return json(cfg);
      }
      if(req.url==='/wake')return json({ok:true});
      if(req.url==='/app-context')return json({ok:true,context:{locale:'zh-CN'}});
      if(req.url==='/logic.html'){
        res.setHeader('Content-Type','text/html');return res.end(`<!doctype html><script>
        window.answers={};window.confirmAllowed=false;window.confirmCount=0;
        window.cindy={onHostMessage:fn=>window.deliver=fn,node:{request:async v=>(await fetch('/node-request',{method:'POST',body:JSON.stringify(v)})).json()},
        confirm:async()=>{window.confirmCount++;return {ok:true,confirmed:window.confirmAllowed};},send:async v=>{window.answers[v.callId]=v;}};
        </script><script src='/main.js'></script>`);
      }
      const relative=req.url==='/'?'settings.html':decodeURIComponent(req.url.split('?')[0].slice(1));
      if(relative.includes('..')){res.statusCode=403;return res.end();}
      const types={'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'};
      res.setHeader('Content-Type',types[path.extname(relative)]||'application/octet-stream');res.end(await fs.readFile(path.join(root,relative)));
    }catch{res.statusCode=500;res.end('test server error');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  // A transport fence prevents this test extension from ever discovering the user's live Cindy bridge.
  // Permit only the fixture server and dedicated test bridge; never change production discovery code.
  const proxy=http.createServer((req,res)=>{
    let target;try{target=new URL(req.url);}catch{res.writeHead(403);return res.end();}
    const fixtureHost=target.hostname.endsWith('.test');
    if(target.protocol!=='http:' || (!fixtureHost && (target.hostname!=='127.0.0.1' || ![String(server.address().port),'18819'].includes(target.port)))){res.writeHead(403);return res.end();}
    const upstream=http.request({hostname:'127.0.0.1',port:fixtureHost?server.address().port:Number(target.port),path:target.pathname+target.search,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);
  });
  proxy.on('connect',(_req,socket)=>{socket.on('error',()=>{});socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{proxy.closeAllConnections();proxy.close();});
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--proxy-server=http://127.0.0.1:'+proxy.address().port,'--proxy-bypass-list=<-loopback>','--disable-extensions-except='+extensionDir,'--load-extension='+extensionDir]});
  const fixture=await fs.readFile(path.join(import.meta.dirname,'fixtures/my-browser-page.html'),'utf8');
  await context.route('http://example.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
  await context.route('http://blocked.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<h1>Blocked fixture</h1>'}));
  await context.route('http://redirect.test/**',route=>route.fulfill({status:302,headers:{location:'http://blocked.test/'},body:''}));
  await context.route('https://x.com/notifications/mentions',route=>route.fulfill({status:200,contentType:'text/html',body:`<main>Loading…</main><script>setTimeout(()=>{document.querySelector('main').innerHTML=Array.from({length:20},(_,i)=>'<article data-testid="tweet"><span data-testid="User-Name">Example user</span><p data-testid="tweetText">Fixture reply '+i+'</p><a href="https://example.test/post/'+i+'"><time datetime="2026-01-01T00:00:00Z">Jan 1</time></a></article>').join('')},700)</script>`}));
  const logic=await context.newPage();const errors=[];logic.on('pageerror',e=>errors.push(e.message));await logic.goto(base+'/logic.html');await logic.waitForFunction(()=>typeof window.deliver==='function');
  async function tool(name,args={}){
    if(process.env.MY_BROWSER_TRACE)console.error('Starting tool',name);
    const id=crypto.randomUUID();await logic.evaluate(({id,name,args})=>{window.deliver({type:'tool-call',tool:name,args,callId:id});},{id,name,args});
    await logic.waitForFunction(id=>window.answers[id],id,{timeout:70000});
    const result=await logic.evaluate(id=>{const r=window.answers[id];delete window.answers[id];return r.result;},id);
    if(process.env.MY_BROWSER_TRACE)console.error('Finished tool',name,result.ok,result.error || '');
    return result;
  }
  await tool('browser_status');
  const until=Date.now()+15000;let status;
  do{status=await tool('browser_status');if(status.extension_connected)break;await new Promise(r=>setTimeout(r,300));}while(Date.now()<until);
  assert.equal(status.extension_connected,true,'MV3 connected: '+JSON.stringify({status,workers:await Promise.all(context.serviceWorkers().map(sw=>sw.evaluate(async()=>({connection:await chrome.storage.session.get('connection'),id:chrome.runtime.id}))))}));
  assert.equal('policy' in status,false);assert.equal('extension_dir' in status,false);assert.equal('port' in status,false);
  assert.equal('origin' in status.clients[0],false);assert.equal('extensionId' in status.clients[0],false);
  assert.ok(status.clients[0].id);assert.equal(status.installation.browsers[0].browser,'chrome');
  const popup=await context.newPage();await popup.goto('chrome-extension://'+extensionId+'/popup.html');await popup.getByText('Ready · chrome connected',{exact:true}).waitFor();await popup.close();
  // Establish interception before this page's first request (extension-created targets may navigate before Playwright attaches).
  const xPage=await context.newPage();await xPage.goto('https://x.com/notifications/mentions');
  const started=Date.now();const mentions=await tool('browser_read',{recipe:'x_mentions',limit:5,maxChars:2000});
  assert.equal(mentions.ok,true,JSON.stringify(mentions));assert.equal(mentions.records.length,5);assert.equal(mentions.truncated,true);assert.equal(mentions.records[0].text,'Fixture reply 0');
  const bytes=Buffer.byteLength(JSON.stringify(mentions));assert.ok(bytes<3000);
  t.diagnostic('X mentions fixture: '+JSON.stringify({browserReadCalls:1,elapsedMs:Date.now()-started,resultBytes:bytes,records:mentions.count}));
  const incremental=await tool('browser_read',{recipe:'x_mentions',after:'https://example.test/post/2',limit:5});assert.equal(incremental.records.length,2);assert.equal(incremental.cursorFound,true);
  const privatePage=await context.newPage();await privatePage.goto('http://private.test/');
  const denied=await tool('browser_read',{url:'http://private.test/',mode:'text'});
  assert.equal(denied.error,'ADDRESS_UNVERIFIED',JSON.stringify(denied));assert.equal(denied.text,undefined);
  assert.deepEqual((await tool('browser_tabs',{host:'private.test'})).tabs,[]);await privatePage.close();
  const url='http://example.test/';
  const page=await context.newPage();await page.goto(url);
  let r=await tool('browser_read',{url,mode:'text'});assert.equal(r.ok,true,JSON.stringify(r));assert.match(r.text,/Visible fixture text/);
  const beforeRefreshIds=(await tool('browser_tabs',{host:'example.test',limit:10})).tabs.map(t=>t.id);
  const beforeRefreshPages=context.pages().length;
  for(let i=0;i<3;i++) {
    await page.reload();
    assert.equal((await tool('browser_read',{url,mode:'text'})).ok,true);
    assert.deepEqual((await tool('browser_tabs',{host:'example.test',limit:10})).tabs.map(t=>t.id),beforeRefreshIds);
    assert.equal(context.pages().length,beforeRefreshPages);
  }
  t.diagnostic('Three page reload/read cycles: same tab ids, no added pages.');
  r=await tool('browser_read',{url,mode:'extract',fields:{token:{selector:'#readable',attr:'data-csrf-token'}}});
  assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/fixture-not-a-real-token/);
  r=await tool('browser_read',{url,mode:'extract',fields:{label:{selector:'#readable',attr:'title'}}});assert.equal(r.record.label,'Fixture title');
  r=await tool('browser_read',{url,mode:'extract',multiple:true,from:'.row',fields:{label:'a',link:{selector:'a',attr:'href'}}});
  assert.equal(r.records.length,2);assert.equal(r.records[0].link,url+'one');
  r=await tool('browser_read',{url});assert.equal(r.ok,true);assert.equal(r.elements,undefined,'default reading does not create refs');
  r=await tool('browser_read',{url,mode:'extract',multiple:true,from:'.row',fields:{label:'a',link:{selector:'a',attr:'href'}},after:url+'two'});
  assert.equal(r.records.length,1);assert.equal(r.cursorFound,true);
  await page.evaluate(()=>setTimeout(()=>{const p=document.createElement('p');p.id='late';p.textContent='Ready after hydration';document.body.append(p);},900));
  r=await tool('browser_read',{url,mode:'text',selector:'#late',waitMs:3000});assert.equal(r.text,'Ready after hydration');assert.ok(r.timing.waitMs>100);
  r=await tool('browser_read',{url,mode:'extract',multiple:true,from:'.absent',fields:{text:':self'},waitMs:100});assert.equal(r.error,'CONTENT_NOT_READY');
  r=await tool('browser_tabs',{host:'example.test',limit:1});assert.equal(r.tabs.length,1);assert.equal(r.tabs[0].url,url);
  // OAuth callbacks, magic links and reset links must not hand their credentials to the model.
  const FAKE_CODE='11111111-1111-4111-8111-111111111111',FAKE_STATE='22222222-2222-4222-8222-222222222222',FAKE_FRAGMENT='33333333-3333-4333-8333-333333333333';
  const tokenPage=await context.newPage();
  await tokenPage.goto(`http://example.test/callback?q=cats&code=${FAKE_CODE}&state=${FAKE_STATE}#access_token=${FAKE_FRAGMENT}`);
  const tokenTabs=await tool('browser_tabs',{host:'example.test',limit:100});
  const tokenRow=tokenTabs.tabs.find(t=>/callback/.test(t.url || ''));assert.ok(tokenRow,'the callback tab must still be listed');
  assert.equal(tokenRow.url.includes(FAKE_CODE),false,'an OAuth code must never reach the model');
  assert.equal(tokenRow.url.includes(FAKE_STATE),false,'an OAuth state must never reach the model');
  assert.equal(JSON.stringify(tokenTabs).includes(FAKE_FRAGMENT),false,'a fragment token must never reach the model');
  assert.match(tokenRow.url,/q=cats/,'innocuous query parameters are preserved for identification');
  const tokenRead=await tool('browser_read',{url:tokenPage.url(),mode:'text'});assert.equal(tokenRead.ok,true);
  assert.equal(tokenRead.url.includes(FAKE_CODE),false,'a read result URL must not carry the credential');
  await tokenPage.close();
  const contentLinks=await tool('browser_read',{url,mode:'content',limit:20});assert.equal(contentLinks.ok,true,JSON.stringify(contentLinks));
  const resetLink=contentLinks.links.find(l=>/\/reset/.test(l.url));assert.ok(resetLink,'the credential-bearing link must still be listed');
  assert.equal(JSON.stringify(contentLinks.links).includes('44444444-4444-4444-8444-444444444444'),false,'a magic-link token in a page link must never reach the model');
  assert.ok(contentLinks.links.some(l=>l.url===url+'one'),'ordinary links stay usable');
  assert.equal(JSON.stringify(contentLinks.links).includes('55555555-5555-4555-8555-555555555555'),false,'a magic link whose token is a path segment must never reach the model');
  assert.equal(/66666666-6666-4666-8666-666666666666|77777777-7777-4777-8777-777777777777/.test(JSON.stringify(contentLinks.links)),false,'URL userinfo credentials in a page link must never reach the model');
  r=await tool('browser_read',{url,mode:'snapshot'});assert.equal(r.ok,true,JSON.stringify(r));assert.match(r.elements,/Increment/);assert.equal(r.text.includes('11111111-1111-4111-8111-111111111111'),false);const ref=r.elements.match(/\[([^\]]+)\] button Increment/)[1];
  r=await tool('browser_act',{url,kind:'click',ref});assert.equal(r.error,'INTERACT_NOT_ALLOWED');
  r=await tool('browser_policy',{action:'allow_interact',host:'example.test'});assert.equal(r.error,'PERMISSION_NOT_GRANTED');assert.equal((await tool('browser_policy',{action:'get'})).policy.interact.allow.length,0);
  await logic.evaluate(()=>window.confirmAllowed=true);
  r=await tool('browser_policy',{action:'allow_interact',host:'example.test'});assert.equal(r.ok,true);
  r=await tool('browser_act',{url,kind:'click',ref});assert.equal(r.execution,'executed');assert.equal(await page.locator('#count').textContent(),'1');
  r=await tool('browser_act',{url,kind:'type',selector:'#query',text:'',submit:true});assert.equal(r.execution,'executed');assert.equal(await page.locator('#query').inputValue(),'');assert.equal(await page.locator('#submits').textContent(),'1');
  await tool('browser_act',{url,kind:'select',selector:'#choice',values:['two']});assert.equal(await page.locator('#choice').inputValue(),'two');
  await tool('browser_act',{url,kind:'type',selector:'#editable',text:'Updated'});assert.equal(await page.locator('#editable').textContent(),'Updated');
  r=await tool('browser_act',{url,kind:'type',selector:'#password',text:'x'});assert.equal(r.error,'SENSITIVE_FIELD');
  // Standard checkout/OTP markup uses a multi-token autocomplete value; exact attribute matching
  // would let those fields stay actionable and visible as refs.
  r=await tool('browser_act',{url,kind:'type',selector:'#card',text:'4111111111111111'});assert.equal(r.error,'SENSITIVE_FIELD');
  r=await tool('browser_act',{url,kind:'type',selector:'#otp',text:'123456'});assert.equal(r.error,'SENSITIVE_FIELD');
  // Fields that omit standard autocomplete but name themselves must be blocked too.
  r=await tool('browser_act',{url,kind:'type',selector:'#otp-plain',text:'123456'});assert.equal(r.error,'SENSITIVE_FIELD');
  r=await tool('browser_act',{url,kind:'type',selector:'#card-plain',text:'4111111111111111'});assert.equal(r.error,'SENSITIVE_FIELD');
  assert.equal(/Verification digits/.test((await tool('browser_read',{url,mode:'snapshot'})).elements),false,'a field named otp must not be exposed as a ref');
  assert.equal(/Payment card/.test((await tool('browser_read',{url,mode:'snapshot'})).elements),false,'a field named card-number must not be exposed as a ref');
  // The naming heuristic must stay scoped to fields: a button that merely mentions a card stays usable.
  assert.equal(/Gift card/.test((await tool('browser_read',{url,mode:'snapshot'})).elements),true,'a non-field control mentioning a card must remain actionable');
  assert.equal(/Card number/.test((await tool('browser_read',{url,mode:'snapshot'})).elements),false,'payment field must not be exposed as an actionable ref');
  assert.equal(/One-time code/.test((await tool('browser_read',{url,mode:'snapshot'})).elements),false,'OTP field must not be exposed as an actionable ref');
  await tool('browser_read',{url,mode:'snapshot'});r=await tool('browser_act',{url,kind:'click',ref});assert.equal(r.error,'STALE_REF');assert.equal(await page.locator('#count').textContent(),'1');
  await tool('browser_policy',{action:'block_read',host:'blocked.test'});
  r=await tool('browser_read',{url:'http://redirect.test/',mode:'text'});assert.equal(r.error,'REDIRECT_BLOCKED',JSON.stringify(r));assert.equal(r.text,undefined);
  const redirectsBefore=await context.serviceWorkers()[0].evaluate(async()=> (await chrome.tabs.query({})).filter(t=>t.url==='http://blocked.test/').length);
  for(let i=0;i<3;i++)assert.equal((await tool('browser_read',{url:'http://redirect.test/',mode:'text'})).error,'REDIRECT_BLOCKED');
  assert.equal(await context.serviceWorkers()[0].evaluate(async()=> (await chrome.tabs.query({})).filter(t=>t.url==='http://blocked.test/').length),redirectsBefore);
  const blocked=await context.newPage();await blocked.goto('http://blocked.test/');
  r=await tool('browser_tabs');assert.equal(r.tabs.some(t=>t.url==='http://blocked.test/'),false);assert.ok(r.tabs.some(t=>t.redacted));
  for(let i=1;i<=5;i++){const r=await tool('browser_read',{url:url+'owned'+i,mode:'text'});assert.equal(r.ok,true,JSON.stringify(r));}
  const sw=context.serviceWorkers()[0];const owned=await sw.evaluate(async()=>Object.values((await chrome.storage.session.get('ownedTabs')).ownedTabs));assert.ok(owned.filter(([,r])=>r.created).length<=3);assert.equal(page.isClosed(),false);
  assert.ok(await sw.evaluate(async()=> (await chrome.tabs.query({})).filter(t=>t.url?.startsWith('http://example.test/owned')).length)<=3);
  const settings=await context.newPage();await settings.goto(base+'/');await settings.getByText('浏览器已连接',{exact:true}).waitFor();
  const beforeSettingsRefresh=context.pages().length;
  for(let i=0;i<3;i++) {
    await settings.locator('#refresh').click();
    await settings.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  }
  await settings.reload();await settings.getByText('浏览器已连接',{exact:true}).waitFor();
  assert.equal(context.pages().length,beforeSettingsRefresh);
  assert.equal(installCalls.length,0,'status refresh must never launch an installer or browser');
  t.diagnostic('Three settings refreshes and one reload: no browser launch, no added pages.');
  assert.equal(await settings.locator('.browser-card').count(),1);
  assert.equal(await settings.locator('#install').getByText('Safari',{exact:true}).count(),0);
  assert.equal(await settings.locator('#install').getByText('Edge',{exact:true}).count(),0);
  assert.doesNotMatch(await settings.locator('#install').textContent(),/等待发布方上架|尚未配置审核通过/);
  assert.equal(await settings.locator('#developer').getAttribute('open'),null);
  assert.ok(await settings.locator('#extdir').inputValue());assert.match(await settings.locator('#read-list').textContent(),/blocked.test/);
  await settings.getByText('禁止读取的网站',{exact:true}).click();
  await settings.locator('#read-input').fill('new-block.test');await settings.locator('#read-add').click();faults.save=true;
  await settings.locator('#save').click();await settings.locator('#hint.error').waitFor();assert.equal(cfg.policy.read.block.includes('new-block.test'),false);faults.save=false;
  await settings.locator('#save').click();await settings.getByText('已保存',{exact:true}).waitFor();assert.ok(cfg.policy.read.block.includes('new-block.test'));
  const before=(await page.locator('#count').textContent());faults.read=true;r=await tool('browser_act',{url,kind:'click',selector:'#increment'});assert.equal(r.ok,false);assert.equal(await page.locator('#count').textContent(),before);faults.read=false;
  await settings.setViewportSize({width:330,height:740});assert.equal(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.MY_BROWSER_SCREENSHOT)await settings.screenshot({path:process.env.MY_BROWSER_SCREENSHOT,fullPage:true});
  const candidate={id:crypto.randomUUID(),origin:'safari-web-extension://'+crypto.randomUUID(),extensionId};
  await fetch('http://127.0.0.1:'+(await bridge.request('status')).port+'/health',{headers:{'X-My-Browser-Extension':candidate.extensionId,'X-My-Browser-Origin':candidate.origin,'X-My-Browser-Client':candidate.id,'X-My-Browser-Version':status.version,'X-My-Browser-Family':'safari'}});
  await logic.evaluate(()=>window.confirmAllowed=false);await settings.locator('#refresh').click();await settings.getByRole('button',{name:'确认连接',exact:true}).click();await settings.getByText('No browser was authorized.',{exact:true}).waitFor();assert.equal(cfg.pairedClients,undefined);
  await logic.evaluate(()=>window.confirmAllowed=true);await settings.getByRole('button',{name:'确认连接',exact:true}).click();await settings.waitForFunction(()=>!document.querySelector('#profiles button'));assert.equal(cfg.pairedClients[0].id,candidate.id);assert.ok(cfg.policy.read.block.includes('new-block.test'));
  await settings.locator('.browser-card').filter({has:settings.getByText('Chrome',{exact:true})}).getByRole('button',{name:'打开 ZIP 安装'}).click();
  await settings.getByText('请把选中的 ZIP 拖入扩展管理页，本页会自动检查连接。',{exact:true}).waitFor();
  assert.equal(installCalls.length,2);assert.ok(installCalls[1][1][1].endsWith('my-browser-chromium.zip'));
  await logic.evaluate(()=>window.confirmAllowed=false);
  await settings.locator('#all-sites').check();await settings.locator('#save').click();await settings.locator('#hint.error').waitFor();
  assert.equal(cfg.policy.interact.allow.includes('*'),false);
  await logic.evaluate(()=>window.confirmAllowed=true);await settings.locator('#save').click();await settings.getByText('已保存',{exact:true}).waitFor();
  assert.equal(cfg.policy.interact.allow.includes('*'),true);assert.ok(cfg.policy.read.block.includes('new-block.test'));
  assert.equal(await settings.locator('#site-selection').isVisible(),false);
  assert.equal((await tool('browser_policy',{action:'remove',host:'*'})).ok,true);
  assert.equal((await tool('browser_policy',{action:'get'})).policy.interact.allow.includes('*'),false);
  const saved=cfg;cfg={};await settings.locator('#refresh').click();await settings.waitForFunction(()=>document.querySelector('#all-sites').checked);
  assert.deepEqual((await tool('browser_policy',{action:'get'})).policy,P.defaults());cfg=saved;
  assert.deepEqual(errors,[]);
});
