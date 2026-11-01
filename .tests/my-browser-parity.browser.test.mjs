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
    ...(grantDebugger?{permissions:[...manifest.permissions,'debugger','tabGroups'],optional_permissions:[]}:{})}));
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
    if(req.url==='/crowded')return res.end(`<title>Crowded</title><nav>${Array.from({length:150},(_,i)=>`<a href="#n${i}">Nav ${i}</a>`).join(' ')}</nav>
<div role=main><h1>Edit provider</h1><textarea aria-label="Attribute condition"></textarea><my-field></my-field><div role=combobox aria-label="Region" tabindex=0>Region</div><button>Save</button></div>
<script>customElements.define('my-field',class extends HTMLElement{constructor(){super();this.attachShadow({mode:'open'}).innerHTML='<p>Shadow note text</p><input aria-label="Shadow field" id=sf><button onclick="document.title=&quot;shadow clicked&quot;" onmousedown="document.title=&quot;shadow down&quot;">Shadow save</button>';}});</script>`);
    if(req.url==='/frames')return res.end(`<title>Frames</title><h1>Top page</h1><button id=topb onclick="document.title='top clicked'">Top button</button>
<iframe id=same src="/frame-inner?who=same" width=500 height=300></iframe>
<iframe id=cross src="http://other.test/frame-inner?who=cross" width=500 height=300></iframe>
<iframe id=doc srcdoc="<p>Srcdoc text</p><button onclick='document.title=&quot;srcdoc clicked&quot;'>Srcdoc button</button>" width=300 height=100></iframe>
<iframe id=hidden src="/frame-inner?who=hidden" style="display:none"></iframe>`);
    if(req.url==='/shadow-text')return res.end(`<title>Shadow</title><p>Light text</p>
<div id=h1></div><div id=h2></div>
<script>
h1.attachShadow({mode:'open'}).textContent='Saved ok';
const inner=h2.attachShadow({mode:'open'});inner.innerHTML='<p>Outer shadow para</p><div id=deep></div>';inner.getElementById('deep').attachShadow({mode:'open'}).textContent='Deep shadow text';
</script>`);
    if(req.url==='/slow-frame')return res.end(`<title>Slow</title><div id=late>top ready</div><iframe src="/slow-inner" width=400 height=200></iframe>`);
    if(req.url==='/slow-inner')return res.end(`<title>SlowInner</title><button id=b>Early button</button><script>setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<div id=late>late</div>');},7000);</script>`);
    if(req.url==='/hidden-frames')return res.end(`<title>Hidden</title><h1>Hidden frames</h1>
<iframe src="/frame-inner?who=shown" width=300 height=100></iframe>
<iframe src="/frame-inner?who=vishidden" width=300 height=100 style="visibility:hidden"></iframe>
<div style="opacity:0"><iframe src="/frame-inner?who=faded" width=300 height=100></iframe></div>
<iframe src="/frame-outer" width=300 height=100 style="visibility:hidden"></iframe>
<iframe src="/frame-inner?who=twin" width=300 height=100 style="visibility:hidden"></iframe>
<iframe src="/frame-inner?who=twin" width=300 height=100></iframe>
<iframe srcdoc="<p>Srcdoc hidden text</p>" width=300 height=100 style="visibility:hidden"></iframe>
<iframe id=moves src="/frame-inner?who=start" width=300 height=100></iframe>
<iframe src="/frame-inner?who=moved" width=300 height=100 style="visibility:hidden"></iframe>
<script>setTimeout(()=>{document.getElementById('moves').src='/frame-inner?who=moved';},300);</script>`);
    if(req.url==='/frame-outer')return res.end('<title>Outer</title><p>Outer text</p><iframe src="/frame-inner?who=insidehidden" width=200 height=80></iframe>');
    if(req.url.startsWith('/frame-inner')){const who=new URL(req.url,'http://x').searchParams.get('who');return res.end(`<title>Inner</title><p>Inner text ${who}</p>
<label>Field ${who}<input id=field aria-label="Field ${who}"></label>
<button id=go onclick="document.title='clicked ${who}';parent.postMessage('clicked ${who}','*')">Go ${who}</button>
<input type=file id=f aria-label="File ${who}"><script>f.addEventListener('change',()=>{window.picked=[...f.files].map(x=>x.name+':'+x.size);document.title='picked '+window.picked[0];});</script>
${who==='cross'?'<iframe src="/frame-inner?who=nested" width=400 height=200></iframe>':''}`);}
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
  if(process.env.SW_DEBUG){const t0=Date.now();worker.on('console',m=>console.error('[sw '+(Date.now()-t0)+'ms]',m.type(),m.text().slice(0,300)));worker.on('close',()=>console.error('[sw closed at '+(Date.now()-t0)+'ms]'));context.on('serviceworker',w=>console.error('[new sw at '+(Date.now()-t0)+'ms]'));}
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
  const act=async(action,payload)=>{const t=Date.now();const r=await bridge.request('act',{action,payload});if(process.env.SW_DEBUG)console.error('[act]',action,payload.op||payload.method||'',Date.now()-t+'ms',r.ok?'ok':r.error);return r;};
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
  // Tab groups need an optional permission (it adds an install warning); without it the tab is simply not grouped.
  const ungrouped=await worker.evaluate(async id=>(await chrome.tabs.get(id)).groupId,opened.tabId);
  check('no tab group without the optional permission',ungrouped===-1,String(ungrouped));
  const winInfo=await worker.evaluate(async id=>{const w=await chrome.windows.get(id);return {focused:w.focused,state:w.state};},opened.window);
  const focusedAfter=await worker.evaluate(async()=>(await chrome.windows.getLastFocused()).id);
  // Headless Chrome still reports the new window as last focused; the window itself must be minimized and unfocused.
  check('agent window opens minimized and unfocused',!winInfo.focused && winInfo.state==='minimized',JSON.stringify({winInfo,focusedBefore,focusedAfter}));
  const userTabAfter=await worker.evaluate(async id=>chrome.tabs.get(id),userTab.id);
  check('user tab untouched by open',userTabAfter.active && userTabAfter.url==='http://parity.test/user');

  const snap=await act('snapshot',{...T,maxChars:6000});
  const ref=name=>{const line=String(snap.elements||'').split('\n').find(l=>l.includes(name));return line && /^\[([a-f0-9]{32})\]/.exec(line)?.[1];};
  check('snapshot by tabId',snap.ok && !!ref('Click me'),snap.error||'');
  const marked=await worker.evaluate(async id=>(await chrome.scripting.executeScript({target:{tabId:id},func:()=>!!document.querySelector('[data-cindy-agent-mark]')}))[0].result,opened.tabId);
  const markedPage=context.pages().find(p=>p.url()==='http://parity.test/');
  if(markedPage && process.env.CINDY_SCREENSHOTS){await markedPage.bringToFront();await new Promise(r=>setTimeout(r,400));await markedPage.screenshot({path:path.join(process.env.CINDY_SCREENSHOTS,'agent-mark.png')});}
  const unmarked=await act('unmark',{tabId:opened.tabId});
  await new Promise(r=>setTimeout(r,1200));
  const markGone=await worker.evaluate(async id=>(await chrome.scripting.executeScript({target:{tabId:id},func:()=>!!document.querySelector('[data-cindy-agent-mark]')}))[0].result,opened.tabId);
  check('unmark ends the mark right away',unmarked.ok && !markGone,JSON.stringify({unmarked,markGone}));
  // "Opened by Cindy" stays on a page Browser Use opened until the user acts on it with real input.
  const openedMarkOn=()=>worker.evaluate(async id=>(await chrome.scripting.executeScript({target:{tabId:id},func:()=>!!document.querySelector('[data-cindy-agent-tab]')}))[0].result,opened.tabId);
  const openedBefore=await openedMarkOn();
  await act('click',{...T,ref:ref('Click me')});
  const openedAfterAgent=await openedMarkOn();
  check('opened-by-Cindy label stays through agent actions',openedBefore && openedAfterAgent,JSON.stringify({openedBefore,openedAfterAgent}));
  check('acting on a page shows the Cindy mark, which page reads do not see',marked && !/working on this page|正在自动操作/.test(String(snap.text)+String(snap.elements)),JSON.stringify({marked}));
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
  const stillBehind=await worker.evaluate(async id=>!(await chrome.tabs.get(id)).active,userBehind);
  check('focus never switches a tab in the user window',fc.error==='USER_WINDOW' && stillBehind,JSON.stringify(fc));
  const takeoverPage=context.pages().find(p=>p.url().startsWith('http://parity.test/two'));
  if(takeoverPage){await takeoverPage.bringToFront();await takeoverPage.mouse.click(300,300);await new Promise(r=>setTimeout(r,500));}
  const openedGone=!(await openedMarkOn());
  check('a real click by the user removes the label',!!takeoverPage && openedGone,JSON.stringify({found:!!takeoverPage,openedGone}));
  const cl=await act('close',T);
  const gone=await act('text',T);
  check('close then TAB_CLOSED',cl.ok && gone.error==='TAB_CLOSED',gone.error);
  const tabsList=await act('tabs',{});
  check('tabs list marks Cindy window',tabsList.ok && tabsList.tabs.some(t=>t.cindyWindow),JSON.stringify(tabsList.tabs.map(t=>[t.id,t.window,t.cindyWindow||false,t.url])));
    // Without the debugger: explicit refusal or a visible-area fallback, and no page to go looking for.
    const access=await act('debuggerAccess',{});
    check('debugger reported off',access.ok && access.granted===false,JSON.stringify(access));
    const pdf=await act('pdf',{tabId:local.tabId,url:'http://127.0.0.1:'+server.address().port+'/'});
    check('pdf refuses without opening a page',pdf.error==='DEBUGGER_UNAVAILABLE',JSON.stringify(pdf));
    const grantTabs=await worker.evaluate(async()=>(await chrome.tabs.query({})).filter(t=>(t.url||'').includes('permissions.html')).length);
    check('no permission page opens',grantTabs===0,String(grantTabs));
    const optionsPage=await context.newPage();await optionsPage.goto('chrome-extension://'+new URL(worker.url()).host+'/permissions.html');
    const refused=await optionsPage.evaluate(()=>chrome.permissions.request({permissions:['debugger']}).then(v=>String(v),e=>e.message));
    await optionsPage.close();
    check('Chrome refuses the debugger at run time, as its documentation says',/manifest/.test(refused),refused);
    // A file too large for one job: in pieces, byte for byte, without the debugger.
    const big=Buffer.alloc(Number(process.env.CINDY_UPLOAD_TEST_BYTES)||12_345_678);for(let i=0;i<big.length;i+=4096)big[i]=(i>>>12)%251;
    const upTab=await act('open',{url:'http://parity.test/'});
    const upTarget={tabId:upTab.tabId,url:'http://parity.test/',selector:'#f'};
    const transfer='transfer-1';
    const begun=await act('upload',{...upTarget,op:'begin',transfer,chunkFiles:[{name:'big.bin',mimeType:'application/octet-stream'}]});
    let sentOk=begun.ok;
    for(let at=0;at<big.length;at+=4_000_000){const r=await act('upload',{...upTarget,op:'chunk',transfer,file:0,data:big.subarray(at,at+4_000_000).toString('base64')});sentOk=sentOk&&r.ok;}
    const untouched=await act('evaluate',{tabId:upTab.tabId,url:'http://parity.test/',fn:'()=>window.picked||null'});
    const finished=await act('upload',{...upTarget,op:'finish',transfer});
    const fnv=b=>{let h=2166136261;for(let i=0;i<b.length;i++){h^=b[i];h=Math.imul(h,16777619);}return h>>>0;};
    const digest=await act('evaluate',{tabId:upTab.tabId,url:'http://parity.test/',fn:"async()=>{const b=new Uint8Array(await document.getElementById('f').files[0].arrayBuffer());let h=2166136261;for(let i=0;i<b.length;i++){h^=b[i];h=Math.imul(h,16777619);}return {size:b.length,hash:h>>>0,picked:window.picked};}"});
    check('pieces build one identical file and fire change once',sentOk && untouched.result===null && finished.ok && finished.files?.[0]?.size===big.length && digest.result?.size===big.length && digest.result?.hash===fnv(big) && digest.result?.picked?.length===1,JSON.stringify({finished,digest,untouched}));
    const lateChunk=await act('upload',{...upTarget,op:'chunk',transfer,file:0,data:'AAAA'});
    check('a finished transfer takes no more pieces',lateChunk.error==='UPLOAD_EXPIRED',JSON.stringify(lateChunk));
    const aborted=await act('upload',{...upTarget,op:'begin',transfer:'transfer-2',chunkFiles:[{name:'x.bin'}]});
    await act('upload',{...upTarget,op:'chunk',transfer:'transfer-2',file:0,data:'AAAA'});
    await act('upload',{...upTarget,op:'abort',transfer:'transfer-2'});
    const afterAbort=await act('upload',{...upTarget,op:'finish',transfer:'transfer-2'});
    check('an aborted transfer leaves nothing behind',aborted.ok && afterAbort.error==='UPLOAD_EXPIRED',JSON.stringify(afterAbort));
    await act('close',{tabId:upTab.tabId,url:'http://parity.test/'});
    // Install-time warnings must match the previous release, so an update never disables the extension.
    const warnings=await worker.evaluate(async m=>{const now=JSON.parse(m);const before={...now,host_permissions:['http://*/*','https://*/*'],permissions:now.permissions};delete before.optional_permissions;delete before.options_ui;
      return {now:await chrome.management.getPermissionWarningsByManifest(JSON.stringify(now)),before:await chrome.management.getPermissionWarningsByManifest(JSON.stringify(before))};},JSON.stringify(manifest));
    check('install warnings unchanged',JSON.stringify(warnings.now)===JSON.stringify(warnings.before),JSON.stringify(warnings));
    const full=await act('screenshot',{tabId:local.tabId,url:'http://127.0.0.1:'+server.address().port+'/',fullPage:true});
    check('full page falls back to the visible area with a note',full.ok && /visible area/.test(full.note||''),full.error||'');
  }finally{await close();}
  assert.deepEqual(results.filter(r=>!r.ok),[]);
  assert.equal(results.length,41);
});

test('real Chrome: an iframe reads and acts like the page around it',enabled,async()=>{
  const results=[];const check=(name,ok,detail='')=>results.push({name,ok,detail});
  const {act,worker,context,close}=await launch(false);
  try{
    const opened=await act('open',{url:'http://parity.test/frames'});
    const T={tabId:opened.tabId,url:'http://parity.test/frames'};
    let snap;for(let i=0;i<30;i++){snap=await act('snapshot',{...T,maxChars:30000});if(/nested/.test(snap.text||'')&&/Srcdoc text/.test(snap.text||''))break;await new Promise(r=>setTimeout(r,200));}
    check('snapshot keeps the tab as its address',snap.ok && snap.url==='http://parity.test/frames' && snap.title==='Frames',JSON.stringify({url:snap.url,title:snap.title}));
    for(const who of ['same','cross','nested'])check('snapshot reads frame '+who,snap.text.includes('Inner text '+who) && snap.elements.includes('Go '+who),snap.text);
    check('snapshot reads a srcdoc frame',snap.text.includes('Srcdoc text') && snap.elements.includes('Srcdoc button'),snap.elements);
    check('snapshot reads the top page too',snap.text.includes('Top page') && snap.elements.includes('Top button'),snap.text);
    check('a hidden frame stays out',!snap.text.includes('Inner text hidden') && !snap.elements.includes('Go hidden'),snap.text);
    const ref=name=>(new RegExp('\\[([a-f0-9]{32})\\] \\S+ '+name)).exec(snap.elements)?.[1];
    const titleOf=async pattern=>{const frames=await context.pages().find(p=>p.url()===T.url).frames();const hit=frames.find(f=>f.url().includes(pattern));return hit?hit.title():null;};
    for(const who of ['cross','nested','same']){
      const clicked=await act('click',{...T,ref:ref('Go '+who)});
      check('click reaches frame '+who,clicked.ok && (await titleOf('who='+who))==='clicked '+who,JSON.stringify(clicked));
      check('the reply keeps the tab address after clicking '+who,clicked.url===T.url,clicked.url);
    }
    const typed=await act('type',{...T,ref:ref('Field cross'),text:'hello frame'});
    const value=await context.pages().find(p=>p.url()===T.url).frames().find(f=>f.url().includes('who=cross')).evaluate(()=>document.getElementById('field').value);
    check('type reaches a cross-site frame',typed.ok && value==='hello frame',JSON.stringify({typed,value}));
    const srcdoc=await act('click',{...T,ref:ref('Srcdoc button')});
    check('click reaches a srcdoc frame',srcdoc.ok,JSON.stringify(srcdoc));
    const top=await act('click',{...T,ref:ref('Top button')});
    check('a top-page ref still acts on the top page',top.ok && context.pages().find(p=>p.url()===T.url)&&(await context.pages().find(p=>p.url()===T.url).title())==='top clicked',JSON.stringify(top));
    const stale=await act('click',{...T,ref:'0'.repeat(32)});
    check('an unknown ref is stale, not a click somewhere else',stale.error==='STALE_REF',JSON.stringify(stale));
    // A large file into a cross-site frame, addressed by ref.
    const big=Buffer.alloc(9_000_000,5);const up={...T,ref:ref('File cross')};
    const begun=await act('upload',{...up,op:'begin',transfer:'frame-1',chunkFiles:[{name:'big.bin'}]});
    const a1=await act('upload',{...up,op:'chunk',transfer:'frame-1',file:0,data:big.subarray(0,4_000_000).toString('base64')});
    const a2=await act('upload',{...up,op:'chunk',transfer:'frame-1',file:0,data:big.subarray(4_000_000,8_000_000).toString('base64')});
    await act('upload',{...up,op:'chunk',transfer:'frame-1',file:0,data:big.subarray(8_000_000).toString('base64')});
    const done=await act('upload',{...up,op:'finish',transfer:'frame-1'});
    check('pieces reach a file input in a cross-site frame',begun.ok&&a1.ok&&a2.ok&&done.ok&&done.files?.[0]?.size===big.length&&done.url===T.url&&(await titleOf('who=cross'))==='picked big.bin:9000000',JSON.stringify({begun,done,title:await titleOf('who=cross')}));
    const small=await act('upload',{...T,ref:ref('File same'),files:[{name:'s.txt',data:'AQID',mimeType:'text/plain'}]});
    check('a small file reaches a file input in a frame',small.ok&&small.files?.[0]?.size===3&&small.url===T.url,JSON.stringify(small));
    const bySelector=await act('upload',{...T,selector:'input[type=file]',files:[{name:'t.txt',data:'AQID'}]});
    check('a selector finds a file input that only exists in a frame',bySelector.ok&&bySelector.files?.[0]?.name==='t.txt',JSON.stringify(bySelector));
    const hid=await act('open',{url:'http://parity.test/hidden-frames'});
    let hs;for(let i=0;i<30;i++){hs=await act('snapshot',{tabId:hid.tabId,url:'http://parity.test/hidden-frames',maxChars:30000});if(/Inner text shown/.test(hs.text||'') && /Inner text moved/.test(hs.text||'') && /Go moved/.test(hs.elements||''))break;await new Promise(r=>setTimeout(r,200));}
    check('a shown frame is read',hs.text.includes('Inner text shown'),hs.text);
    for(const who of ['vishidden','faded','insidehidden'])check('a frame hidden by CSS ('+who+') stays out, nested ones too',!hs.text.includes('Inner text '+who) && !hs.elements.includes('Go '+who),hs.text);
    const count=(text,needle)=>text.split(needle).length-1;
    check('two frames at one address: only the visible one is read',count(hs.text,'Inner text twin')===1 && count(hs.elements,'Go twin')===1,hs.text);
    check('a hidden srcdoc frame stays out',!hs.text.includes('Srcdoc hidden text'),hs.text);
    check('a visible frame that moved to a hidden frame address is still read',count(hs.text,'Inner text moved')===1 && count(hs.elements,'Go moved')===1,hs.text);
    check('text of a hidden frame holding a frame stays out',!hs.text.includes('Outer text'),hs.text);
    await act('close',{tabId:hid.tabId,url:'http://parity.test/hidden-frames'});
    // One limit for the whole page, whatever the frames hold.
    const one=await act('snapshot',{...T,limit:1});
    check('limit 1 returns one element in all',one.elements.split('\n').filter(Boolean).length===1 && one.truncated===true,one.elements);
    const four=await act('snapshot',{...T,limit:4,maxChars:30000});
    check('limit 4 returns at most four and still reaches frames',four.elements.split('\n').filter(Boolean).length===4 && /Go (same|cross|nested)/.test(four.elements),four.elements);
    const tiny=await act('snapshot',{...T,maxChars:256});
    check('maxChars holds with frames in the page',(tiny.text||'').length<=256,String((tiny.text||'').length));
    // A new snapshot retires the refs of a frame it no longer reads. The ref comes from a fresh, full
    // snapshot, so only the clearing of every frame can make it stale.
    const fresh=await act('snapshot',{...T,maxChars:30000});
    const freshRef=name=>(new RegExp('\\[([a-f0-9]{32})\\] \\S+ '+name)).exec(fresh.elements)?.[1];
    const goSame=freshRef('Go same');
    check('the fresh snapshot lists the frame being hidden',!!goSame && !!freshRef('Go cross'),fresh.elements);
    await context.pages().find(p=>p.url()===T.url).evaluate(()=>{document.getElementById('same').style.display='none';});
    await act('snapshot',{...T,maxChars:30000});
    const retired=await act('click',{...T,ref:goSame});
    check('a frame hidden after a snapshot leaves its refs stale',retired.error==='STALE_REF',JSON.stringify(retired));
    // Refs of a frame that navigated are gone: taken fresh, so only the navigation can retire it.
    const again=await act('snapshot',{...T,maxChars:30000});
    const goCross=(new RegExp('\\[([a-f0-9]{32})\\] \\S+ Go cross')).exec(again.elements)?.[1];
    // Refs of a frame that navigated are gone.
    await context.pages().find(p=>p.url()===T.url).frames().find(f=>f.url().includes('who=cross')).evaluate(()=>{location.href='/frame-inner?who=moved';});
    await new Promise(r=>setTimeout(r,500));
    const moved=await act('click',{...T,ref:goCross});
    check('a frame that navigated leaves its refs stale',moved.error==='STALE_REF',JSON.stringify(moved));
  }finally{await close();}
  assert.deepEqual(results.filter(r=>!r.ok),[]);
});

test('real Chrome: a long navigation does not hide the form on a page',enabled,async()=>{
  const results=[];const check=(name,ok,detail='')=>results.push({name,ok,detail});
  const {act,context,close}=await launch(false);
  try{
    const opened=await act('open',{url:'http://parity.test/crowded'});
    const T={tabId:opened.tabId,url:'http://parity.test/crowded'};
    const snap=await act('snapshot',T);
    const lines=snap.elements.split('\n');
    check('the budget still holds',lines.length===80 && snap.truncated===true,String(lines.length));
    for(const name of ['Attribute condition','Region','Save','Shadow field','Shadow save'])check(name+' is listed before the navigation',lines.findIndex(l=>l.includes(name))>=0 && lines.findIndex(l=>l.includes(name))<lines.findIndex(l=>l.includes('Nav 0')),lines.slice(0,8).join(' | '));
    const more=await act('snapshot',{...T,limit:300,maxChars:30000});
    check('limit lifts the budget',more.elements.split('\n').length===155 && more.truncated===false,String(more.elements.split('\n').length));
    const ref=name=>(new RegExp('\\[([a-f0-9]{32})\\] \\S+ '+name)).exec(more.elements)?.[1];
    const page=context.pages().find(p=>p.url()===T.url);
    const clicked=await act('click',{...T,ref:ref('Shadow save')});
    check('a ref inside a shadow root can be clicked',clicked.ok && (await page.title())==='shadow clicked',JSON.stringify(clicked));
    const typed=await act('type',{...T,ref:ref('Shadow field'),text:'in shadow'});
    check('a ref inside a shadow root can be typed into',typed.ok && (await page.evaluate(()=>document.querySelector('my-field').shadowRoot.getElementById('sf').value))==='in shadow',JSON.stringify(typed));
    const area=await act('type',{...T,ref:ref('Attribute condition'),text:"assertion.sub == 'x'"});
    check('the long form field takes text',area.ok && (await page.evaluate(()=>document.querySelector('textarea').value))==="assertion.sub == 'x'",JSON.stringify(area));
    // Addressed by ref, a pointer action reaches that element, not the host the page reports at its point.
    await page.evaluate(()=>{document.title='reset';});
    const coords=await act('clickCoords',{...T,ref:ref('Shadow save')});
    check('clickCoords with a shadow ref reaches the inner button',coords.ok && (await page.title())==='shadow clicked',JSON.stringify({coords,title:await page.title()}));
    await page.evaluate(()=>{document.title='reset';});
    const dragged=await act('drag',{...T,startRef:ref('Shadow save'),endRef:ref('Attribute condition')});
    check('drag from a shadow ref starts on the inner button',dragged.ok && (await page.title())==='shadow down',JSON.stringify({dragged,title:await page.title()}));
    check('text inside an open shadow root is in the snapshot',more.text.includes('Shadow note text'),more.text);
    const scoped=await act('snapshot',{...T,selector:'[role=main]'});
    check('a selector narrows to the form',!scoped.elements.includes('Nav 0') && scoped.elements.includes('Shadow field') && scoped.truncated===false,scoped.elements);
  }finally{await close();}
  assert.deepEqual(results.filter(r=>!r.ok),[]);
});

test('real Chrome: shadow text is read whole, and a late snapshot cannot take refs back',enabled,async()=>{
  const results=[];const check=(name,ok,detail='')=>results.push({name,ok,detail});
  const {act,context,close}=await launch(false);
  try{
    const sh=await act('open',{url:'http://parity.test/shadow-text'});
    const S={tabId:sh.tabId,url:'http://parity.test/shadow-text'};
    const count=(text,needle)=>text.split(needle).length-1;
    const whole=await act('snapshot',{...S,maxChars:30000});
    for(const t of ['Light text','Saved ok','Outer shadow para','Deep shadow text'])check('"'+t+'" is in the snapshot once',count(whole.text,t)===1,whole.text);
    const host=await act('snapshot',{...S,selector:'#h1',maxChars:30000});
    check('a selected host reads its own shadow text, text node included',host.ok && count(host.text,'Saved ok')===1,JSON.stringify(host).slice(0,300));
    const nested=await act('snapshot',{...S,selector:'#h2',maxChars:30000});
    check('a selected host reads nested shadow roots',count(nested.text,'Outer shadow para')===1 && count(nested.text,'Deep shadow text')===1,nested.text);
    // A frame read that outlives its deadline must not overwrite the refs of the snapshot taken after it.
    const slow=await act('open',{url:'http://parity.test/slow-frame'});
    const W={tabId:slow.tabId,url:'http://parity.test/slow-frame'};
    const t0=Date.now();
    const first=await act('snapshot',{...W,selector:'#late',waitMs:12000,maxChars:30000});
    const second=await act('snapshot',{...W,maxChars:30000});
    const goRef=(new RegExp('\\[([a-f0-9]{32})\\] \\S+ Early button')).exec(second.elements)?.[1];
    check('the second snapshot lists the frame button',first.ok && !!goRef,second.elements);
    await new Promise(r=>setTimeout(r,Math.max(0,9000-(Date.now()-t0))));
    const slept=Date.now()-t0;
    const clicked=await act('click',{...W,ref:goRef});
    check('the ref of the newest snapshot survives the late frame read ('+slept+' ms in)',clicked.ok,JSON.stringify(clicked));
  }finally{await close();}
  assert.deepEqual(results.filter(r=>!r.ok),[]);
});

const pngSize=b64=>{const b=Buffer.from(b64,'base64');return {png:b.subarray(0,8).toString('hex')==='89504e470d0a1a0a',width:b.readUInt32BE(16),height:b.readUInt32BE(20)};};
test('real Chrome: debugger-only actions run on demand and detach right after',enabled,async()=>{
  const results=[];const check=(name,ok,detail='')=>results.push({name,ok,detail});
  const {act,worker,close}=await launch(true);
  try{
    const access=await act('debuggerAccess',{});
    check('debugger reported on',access.ok && access.granted===true,JSON.stringify(access));
    const userTab=await worker.evaluate(async()=>(await chrome.tabs.query({url:'http://parity.test/user'}))[0]);
    const t0=Date.now();
    const opened=await act('open',{url:'http://parity.test/tall'});
    console.error('tall open ms',Date.now()-t0,JSON.stringify({ok:opened.ok,error:opened.error,status:opened.status}));
    const T={tabId:opened.tabId,url:'http://parity.test/tall'};
    const group=await worker.evaluate(async id=>{const t=await chrome.tabs.get(id);return t.groupId>=0?await chrome.tabGroups.get(t.groupId):null;},opened.tabId);
    check('with the permission, agent tabs carry a red Cindy tab group',group && /^Cindy/.test(group.title) && group.color==='red',JSON.stringify(group));
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
    // A page whose CSP forbids Cindy's scripts still runs evaluate through the allowed debugger.
    const csp=await act('open',{url:'http://csp.test/'});
    if(!csp.tabId)console.error('csp open',JSON.stringify(csp));
    if(!csp.tabId){const ws=context.serviceWorkers();console.error('workers',ws.length);try{console.error('sw state',JSON.stringify(await ws[ws.length-1].evaluate(async()=>({conn:(await chrome.storage.session.get('connection')).connection,debugged:typeof debugged!=='undefined'?debugged.size:null}))));}catch(e){console.error('sw eval failed',e.message);}}
    const cspEval=await act('evaluate',{tabId:csp.tabId,url:'http://csp.test/',fn:'() => document.title + 1'});
    check('CSP page evaluates through the debugger',cspEval.ok && cspEval.result==='CSP1' && cspEval.viaDebugger===true,JSON.stringify(cspEval));
    const handoff=await act('focus',{tabId:csp.tabId,url:'http://csp.test/'});
    check('focus in Cindy window hands the page over without taking focus',handoff.ok && handoff.handoff===true,JSON.stringify(handoff));
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
    const after=await act('cdp',{...T,op:'command',method:'Network.getCookies',params:{urls:['http://parity.test/tall']}});
    check('commands after the session ends are refused',after.error==='DEBUGGER_DETACHED',after.error);
  }finally{await close();}
  assert.deepEqual(results.filter(r=>!r.ok),[]);
  assert.equal(results.length,12);
});
