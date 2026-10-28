// Parity with Cindy's dedicated browser, end to end: the real MV3 extension in an isolated Chromium,
// the real node bridge and fixture pages behind a fenced proxy (the extension can never reach the
// user's live Cindy). Checks every action the agent gains and that none of them disturbs the user's
// own window. Not an installed-Cindy or live-site acceptance claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {generateKeyPairSync,createHash} from 'node:crypto';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../my-browser');
const {createBridge}=require('../my-browser/node/bridge.cjs');
async function launch(grantDebugger){
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'parity-e2e-'));
  const cleanup=[];
  const close=async()=>{for(const fn of cleanup){try{await fn();}catch{}}await fs.rm(profile,{recursive:true,force:true,maxRetries:3});};
  try{
  const extensionDir=path.join(profile,'unpacked-extension');await fs.cp(path.join(root,'extension'),extensionDir,{recursive:true});
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'der'}});
  const extensionId=createHash('sha256').update(publicKey).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
  const manifest=JSON.parse(await fs.readFile(path.join(extensionDir,'manifest.json'),'utf8'));
  await fs.writeFile(path.join(extensionDir,'manifest.json'),JSON.stringify({...manifest,key:publicKey.toString('base64'),
    // The debugger is an optional permission the user grants by a click on a Chrome prompt; the
    // granted variant declares it up front so the debugger paths run without that prompt.
    ...(grantDebugger?{permissions:[...manifest.permissions,'debugger'],optional_permissions:[]}:{})}));
  const nativeProfiles=[profile,...['Google/Chrome','Google/Chrome for Testing'].map(p=>path.join(profile,'Library/Application Support',p))];
  for(const p of nativeProfiles)await fs.mkdir(p,{recursive:true});
  const native=require(root+'/node/native-binding.cjs').createNativeBinding({root:path.join(profile,'native'),profiles:nativeProfiles,binary:process.env.CINDY_NATIVE_TEST_BINARY});
  const bridge=createBridge({ports:[18819],extensionId,nativeToken:native.token});cleanup.push(async()=>{await bridge.close();await native.close();});
  await bridge.request('status');assert.equal((await native.install(18819,[extensionId])).ok,true);

  const page=`<!doctype html><title>Parity</title><h1>Parity fixture</h1>
<button id="b" onclick="document.title='clicked'">Click me</button>
<div id="ctx" style="width:120px;height:30px" oncontextmenu="event.preventDefault();this.textContent='right-clicked'">ctx</div>
<div id="dbl" style="width:120px;height:30px" ondblclick="this.textContent='double'">dbl</div>
<div id="src" draggable="true" style="width:120px;height:30px">drag me</div><div id="dst" style="width:120px;height:60px;border:1px solid">drop here</div>
<input type="file" id="f" multiple aria-label="Files">
<button id="al" onclick="window.res=confirm('Sure?')">confirm</button>
<script>
dst.addEventListener('dragover',e=>e.preventDefault());dst.addEventListener('drop',e=>{e.preventDefault();dst.textContent='dropped';});
f.addEventListener('change',()=>{window.picked=[...f.files].map(x=>x.name+':'+x.size);});
setTimeout(()=>document.body.insertAdjacentHTML('beforeend','<p id=late>Late text</p>'),1500);
fetch('/api/data').then(r=>r.json()).then(j=>window.api=j);
</script>`;
  const server=http.createServer((req,res)=>{
    const host=(req.headers.host||'').split(':')[0];
    if(req.url==='/api/data'){res.setHeader('Content-Type','application/json');return res.end('{"hello":"world"}');}
    res.setHeader('Content-Type','text/html');
    if(host==='csp.test'){res.setHeader('Content-Security-Policy',"script-src 'self'");return res.end('<title>CSP</title><p>Strict page</p>');}
    if(host==='127.0.0.1')return res.end('<title>Local</title><p>Local service page</p>');
    if(req.url==='/user')return res.end('<title>User page</title><p>The user is reading this.</p>');
    if(req.url==='/two')return res.end('<title>Two</title><p>Second page</p>');
    if(req.url==='/tall'){res.setHeader('Set-Cookie','visit=1; Path=/');return res.end('<title>Tall</title><button id=small style="width:80px;height:24px">Small</button><div style="height:3000px">tall</div><p>End</p>');}
    res.end(page);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));cleanup.push(()=>{server.closeAllConnections();server.close();});
  const proxy=http.createServer((req,res)=>{
    let target;try{target=new URL(req.url);}catch{res.writeHead(403);return res.end();}
    const fixtureHost=target.hostname.endsWith('.test');
    if(target.protocol!=='http:' || (!fixtureHost && (target.hostname!=='127.0.0.1' || ![String(server.address().port),'18819'].includes(target.port)))){res.writeHead(403);return res.end();}
    const upstream=http.request({hostname:'127.0.0.1',port:fixtureHost?server.address().port:Number(target.port),path:target.pathname+target.search,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
    res.on('close',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);
  });
  proxy.on('connect',(_q,s)=>{s.on('error',()=>{});s.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));cleanup.push(()=>{proxy.closeAllConnections();proxy.close();});
  const context=await chromium.launchPersistentContext(profile,{channel:'chromium',...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:process.env.HEADED?false:true,env:{...process.env,HOME:profile,CFFIXED_USER_HOME:profile},
    args:['--proxy-server=http://127.0.0.1:'+proxy.address().port,'--proxy-bypass-list=<-loopback>','--disable-extensions-except='+extensionDir,'--load-extension='+extensionDir]});
  cleanup.unshift(()=>context.close());
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  // The user's own tab: open and looking at it.
  const user=context.pages()[0]||await context.newPage();await user.goto('http://parity.test/user');
  // A locally downloaded Chromium may be ad-hoc signed, so the native host cannot verify it; pin the
  // test profile's key instead (the existing pairing path), as a verified native binding would.
  for(let i=0;i<300;i++){
    const st=await bridge.request('status');if(st.extension_connected)break;
    const c=st.clients.find(c=>c.publicKey);if(c)await bridge.request('setTrustedClients',{clients:[{id:c.id,origin:c.origin,extensionId:c.extensionId,publicKey:c.publicKey}]});
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal((await bridge.request('status')).extension_connected,true,'extension connected');
  const act=(action,payload)=>bridge.request('act',{action,payload});
    return {act,worker,bridge,server,user,context,manifest,close};
  }catch(e){await close();throw e;}
}
const enabled={skip:!process.env.PLAYWRIGHT_CORE,timeout:120000};
test('real Chrome: agent actions match the dedicated browser without disturbing the user',enabled,async()=>{
  const results=[];const check=(name,ok,detail='')=>results.push({name,ok,detail});
  const {act,worker,server,context,manifest,close}=await launch(false);
  try{
  const userTab=await worker.evaluate(async()=>(await chrome.tabs.query({url:'http://parity.test/user'}))[0]);
  const focusedBefore=await worker.evaluate(async()=>(await chrome.windows.getLastFocused()).id);

  const opened=await act('open',{url:'http://parity.test/'});
  check('open returns a tab in a separate window',opened.ok && opened.window!==userTab.windowId,JSON.stringify({tab:opened.tabId,window:opened.window,user:userTab.windowId}));
  const T={tabId:opened.tabId,url:'http://parity.test/'};
  const winInfo=await worker.evaluate(async id=>{const w=await chrome.windows.get(id);return {focused:w.focused,state:w.state};},opened.window);
  const focusedAfter=await worker.evaluate(async()=>(await chrome.windows.getLastFocused()).id);
  check('agent window does not take focus',!winInfo.focused && focusedAfter===focusedBefore,JSON.stringify({winInfo,focusedBefore,focusedAfter}));
  const userTabAfter=await worker.evaluate(async id=>chrome.tabs.get(id),userTab.id);
  check('user tab untouched by open',userTabAfter.active && userTabAfter.url==='http://parity.test/user');

  const snap=await act('snapshot',{...T,maxChars:6000});
  const ref=name=>{const line=String(snap.elements||'').split('\n').find(l=>l.includes(name));return line && /^\[([a-f0-9]{32})\]/.exec(line)?.[1];};
  check('snapshot by tabId',snap.ok && !!ref('Click me'),snap.error||'');
  const clicked=await act('click',{...T,ref:ref('Click me')});
  const ev=await act('evaluate',{...T,fn:'() => document.title'});
  check('click + evaluate',clicked.ok && ev.ok && ev.result==='clicked',JSON.stringify(ev));
  const c1=await act('console',T);await act('evaluate',{...T,fn:"() => console.warn('hello from agent')"});const c2=await act('console',T);
  check('console capture',c1.ok && c2.ok && JSON.stringify(c2.messages).includes('hello from agent'),JSON.stringify(c2.messages));
  const reqs=await act('requests',{...T,filter:'/api/'});
  check('requests from resource timing',reqs.ok && reqs.requests?.some(r=>r.url.includes('/api/data')),JSON.stringify(reqs.requests));
  const body=await act('responseBody',{...T,requestUrl:'http://parity.test/api/data'});
  check('responseBody refetch',body.ok && body.response?.body?.includes('world'),JSON.stringify(body.response));
  const armed=await act('dialog',{...T,accept:true});
  const conf=await act('click',{...T,ref:ref('confirm')});
  const confRes=await act('evaluate',{...T,fn:'() => window.res'});
  check('dialog armed answers next confirm',armed.ok && armed.armed && conf.ok && confRes.result===true,JSON.stringify({armed,confRes}));
  // Elements without accessible names: address them by selector.
  const right=await act('clickCoords',{...T,selector:'#ctx',button:'right'});
  const dbl=await act('clickCoords',{...T,selector:'#dbl',doubleClick:true});
  const texts=await act('evaluate',{...T,fn:'() => [ctx.textContent, dbl.textContent]'});
  check('right click and double click',right.ok && dbl.ok && JSON.stringify(texts.result)==='["right-clicked","double"]',JSON.stringify(texts.result));
  const xy=await act('evaluate',{...T,fn:"() => { const r=b.getBoundingClientRect(); document.title='reset'; return [r.left+r.width/2, r.top+r.height/2]; }"});
  const coords=await act('clickCoords',{...T,x:xy.result[0],y:xy.result[1]});
  const t2=await act('evaluate',{...T,fn:'() => document.title'});
  check('coordinate click',coords.ok && t2.result==='clicked',JSON.stringify(t2));
  const drag=await act('drag',{...T,startSelector:'#src',endSelector:'#dst'});
  const dropped=await act('evaluate',{...T,fn:'() => dst.textContent'});
  check('drag and drop',drag.ok && dropped.result==='dropped',JSON.stringify({drag,dropped:dropped.result}));
  const up=await act('upload',{...T,selector:'#f',files:[{name:'a.txt',data:Buffer.from('hello').toString('base64'),mimeType:'text/plain'},{name:'b.bin',data:Buffer.from([1,2,3]).toString('base64')}]});
  const picked=await act('evaluate',{...T,fn:'() => window.picked'});
  check('upload into file input',up.ok && JSON.stringify(picked.result)==='["a.txt:5","b.bin:3"]',JSON.stringify({up,picked:picked.result}));
  const w1=await act('wait',{...T,text:'Late text',timeoutMs:5000});
  const w2=await act('wait',{...T,textGone:'Nothing like this',loadState:'load',timeoutMs:3000});
  const w3=await act('wait',{...T,urlIncludes:'/never',timeoutMs:600});
  check('wait for text / textGone+load / timeout',w1.ok && w2.ok && w3.error==='WAIT_TIMEOUT',JSON.stringify({w1:w1.error,w2:w2.error,w3:w3.error}));
  const shot=await act('screenshot',T);
  const png=shot.ok && Buffer.from(shot.data,'base64').subarray(0,8).toString('hex')==='89504e470d0a1a0a';
  check('screenshot of agent tab',png,shot.ok?shot.bytes+' bytes':JSON.stringify(shot));
  const jpg=await act('screenshot',{...T,type:'jpeg'});
  check('jpeg screenshot',jpg.ok && jpg.mimeType==='image/jpeg',jpg.error||'');
  const rz=await act('resize',{...T,width:900,height:700});
  const rzUser=await act('resize',{tabId:userTab.id,url:'http://parity.test/user',width:900,height:700});
  check('resize only the Cindy window',rz.ok && rzUser.error==='USER_WINDOW',JSON.stringify({rz:rz.error,rzUser:rzUser.error}));
  const nav=await act('navigate',{...T,url:'http://parity.test/two'});
  check('navigate keeps the tab',nav.ok && nav.tabId===T.tabId && nav.url==='http://parity.test/two',JSON.stringify(nav));
  const after=await act('text',{tabId:T.tabId,url:'http://parity.test/two'});
  check('page read after navigation by tabId',after.ok && String(after.text).includes('Second page'),after.error||'');
  const local=await act('open',{url:'http://127.0.0.1:'+server.address().port+'/'});
  const localText=local.ok && await act('text',{tabId:local.tabId,url:'http://127.0.0.1:'+server.address().port+'/'});
  check('local address page opens and reads',local.ok && String(localText.text).includes('Local service page'),JSON.stringify(local.error||localText.error||''));
  const csp=await act('open',{url:'http://csp.test/'});
  const cspEval=await act('evaluate',{tabId:csp.tabId,url:'http://csp.test/',fn:'() => 1+1'});
  check('CSP page refuses evaluate explicitly',cspEval.error==='EVAL_BLOCKED_BY_PAGE',JSON.stringify(cspEval));
  const cspSnap=await act('text',{tabId:csp.tabId,url:'http://csp.test/'});
  check('CSP page still readable',cspSnap.ok && String(cspSnap.text).includes('Strict page'));
  const userBehind=await worker.evaluate(async uid=>{const t=await chrome.tabs.create({windowId:(await chrome.tabs.get(uid)).windowId,url:'http://parity.test/two',active:false});return t.id;},userTab.id);
  await new Promise(r=>setTimeout(r,800));
  const behindShot=await act('screenshot',{tabId:userBehind,url:'http://parity.test/two'});
  const userStill=await worker.evaluate(async id=>(await chrome.tabs.get(id)).active,userTab.id);
  check('background tab in a user window is not captured and view stays',behindShot.error==='TAB_NOT_VISIBLE' && userStill,behindShot.error);
  const userShot=await act('screenshot',{tabId:userTab.id,url:'http://parity.test/user'});
  check('visible user tab can be captured',userShot.ok,userShot.error||'');
  const fc=await act('focus',{tabId:userBehind,url:'http://parity.test/two'});
  const nowActive=await worker.evaluate(async id=>(await chrome.tabs.get(id)).active,userBehind);
  check('focus switches tab within its window',fc.ok && nowActive);
  const cl=await act('close',T);
  const gone=await act('text',T);
  check('close then TAB_CLOSED',cl.ok && gone.error==='TAB_CLOSED',gone.error);
  const tabsList=await act('tabs',{});
  check('tabs list marks Cindy window',tabsList.ok && tabsList.tabs.some(t=>t.cindyWindow),JSON.stringify(tabsList.tabs.map(t=>[t.id,t.window,t.cindyWindow||false,t.url])));
    // Without the on-demand debugger: explicit refusal or a visible-area fallback, never a prompt loop.
    const access=await act('debuggerAccess',{});
    check('debugger reported off',access.ok && access.granted===false,JSON.stringify(access));
    const pdf=await act('pdf',{tabId:local.tabId,url:'http://127.0.0.1:'+server.address().port+'/'});
    check('pdf needs the debugger and opens its page',pdf.error==='DEBUGGER_NOT_ALLOWED' && pdf.grantPageOpened===true,JSON.stringify(pdf));
    await new Promise(r=>setTimeout(r,800));
    const grantTabs=await worker.evaluate(async()=>(await chrome.tabs.query({})).filter(t=>(t.url||'').includes('permissions.html')).map(t=>({windowId:t.windowId,active:t.active})));
    check('grant page opens in the user window, in front',grantTabs.length===1 && grantTabs[0].windowId===userTab.windowId && grantTabs[0].active,JSON.stringify(grantTabs));
    const grantPage=context.pages().find(p=>p.url().includes('permissions.html'));
    if(grantPage && process.env.CINDY_SCREENSHOTS)await grantPage.screenshot({path:path.join(process.env.CINDY_SCREENSHOTS,'debugger-grant.png')});
    const pdfAgain=await act('pdf',{tabId:local.tabId,url:'http://127.0.0.1:'+server.address().port+'/'});
    const grantTabsAgain=await worker.evaluate(async()=>(await chrome.tabs.query({})).filter(t=>(t.url||'').includes('permissions.html')).length);
    check('a retry does not open the page again',pdfAgain.error==='DEBUGGER_NOT_ALLOWED' && pdfAgain.grantPageOpened===false && grantTabsAgain===1,JSON.stringify({pdfAgain,grantTabsAgain}));
    // Install-time warnings must match the previous release, so an update never disables the extension.
    const warnings=await worker.evaluate(async m=>{const now=JSON.parse(m);const before={...now,host_permissions:['http://*/*','https://*/*']};delete before.optional_permissions;delete before.options_ui;
      return {now:await chrome.management.getPermissionWarningsByManifest(JSON.stringify(now)),before:await chrome.management.getPermissionWarningsByManifest(JSON.stringify(before))};},JSON.stringify(manifest));
    check('install warnings unchanged',JSON.stringify(warnings.now)===JSON.stringify(warnings.before),JSON.stringify(warnings));
    const full=await act('screenshot',{tabId:local.tabId,url:'http://127.0.0.1:'+server.address().port+'/',fullPage:true});
    check('full page falls back to the visible area with a note',full.ok && /visible area/.test(full.note||''),full.error||'');
  }finally{await close();}
  assert.deepEqual(results.filter(r=>!r.ok),[]);
  assert.equal(results.length,33);
});

const pngSize=b64=>{const b=Buffer.from(b64,'base64');return {png:b.subarray(0,8).toString('hex')==='89504e470d0a1a0a',width:b.readUInt32BE(16),height:b.readUInt32BE(20)};};
test('real Chrome: debugger-only actions run on demand and detach right after',enabled,async()=>{
  const results=[];const check=(name,ok,detail='')=>results.push({name,ok,detail});
  const {act,worker,close}=await launch(true);
  try{
    const access=await act('debuggerAccess',{});
    check('debugger reported on',access.ok && access.granted===true,JSON.stringify(access));
    const userTab=await worker.evaluate(async()=>(await chrome.tabs.query({url:'http://parity.test/user'}))[0]);
    const opened=await act('open',{url:'http://parity.test/tall'});
    const T={tabId:opened.tabId,url:'http://parity.test/tall'};
    const viewport=await act('evaluate',{...T,fn:'() => innerHeight'});
    const full=await act('screenshot',{...T,fullPage:true});
    const fullSize=full.ok && pngSize(full.data);
    check('full-page screenshot is taller than the viewport',full.ok && full.viaDebugger && fullSize.png && fullSize.height>viewport.result+1000,JSON.stringify({error:full.error,message:full.message,fullSize,viewport:viewport.result}));
    const snap=await act('snapshot',{...T,maxChars:6000});
    const ref=/^\[([a-f0-9]{32})\] button Small/m.exec(String(snap.elements||''))?.[1];
    const element=await act('screenshot',{...T,ref});
    const elementSize=element.ok && pngSize(element.data);
    check('element screenshot is the element only',element.ok && elementSize.width<200 && elementSize.height<100,JSON.stringify({error:element.error,message:element.message,elementSize}));
    const behind=await worker.evaluate(async id=>(await chrome.tabs.create({windowId:(await chrome.tabs.get(id)).windowId,url:'http://parity.test/two',active:false})).id,userTab.id);
    await new Promise(r=>setTimeout(r,800));
    const behindShot=await act('screenshot',{tabId:behind,url:'http://parity.test/two'});
    const userStill=await worker.evaluate(async id=>(await chrome.tabs.get(id)).active,userTab.id);
    check('background tab captured without switching the user view',behindShot.ok && behindShot.viaDebugger && userStill,JSON.stringify({error:behindShot.error,message:behindShot.message,userStill}));
    const pdf=await act('pdf',T);
    check('pdf export',pdf.ok && Buffer.from(pdf.data,'base64').subarray(0,4).toString()==='%PDF',pdf.error||pdf.message||'');
    check('one-shot actions detach right after',(await act('debuggerAccess',{})).attachedTabs===0);
    const begun=await act('cdp',{...T,op:'begin'});
    const enabledNet=await act('cdp',{...T,op:'command',method:'Network.enable',params:{}});
    await act('evaluate',{...T,fn:"() => fetch('/api/data?probe=1').then(r => r.text())"});
    const cookies=await act('cdp',{...T,op:'command',method:'Network.getCookies',params:{urls:['http://parity.test/tall']}});
    const events=[...(cookies.events||[]),...((await act('cdp',{...T,op:'events'})).events||[])];
    check('protocol session: commands, cookies and network events',begun.ok && enabledNet.ok && cookies.ok && cookies.result.cookies.some(c=>c.name==='visit') && events.some(([m,p])=>m==='Network.requestWillBeSent' && p.request.url.includes('probe=1')),JSON.stringify({begun:begun.error,net:enabledNet.error,cookies:cookies.error||cookies.result,events:events.map(e=>e[0]).slice(0,10)}));
    await act('cdp',{...T,op:'end'});
    check('session end detaches',(await act('debuggerAccess',{})).attachedTabs===0);
    const after=await act('cdp',{...T,op:'command',method:'Network.getCookies',params:{}});
    check('commands after the session ends are refused',after.error==='DEBUGGER_DETACHED',after.error);
  }finally{await close();}
  assert.deepEqual(results.filter(r=>!r.ok),[]);
  assert.equal(results.length,9);
});
