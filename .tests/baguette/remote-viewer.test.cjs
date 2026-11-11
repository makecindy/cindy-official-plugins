'use strict';
// A device on another of the account's computers, shown with this plugin's own
// controller: the worker wraps the address Cindy hands over, forwards only the
// device's picture and input, and never offers operations that belong to the
// computer running the device.
const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createRemoteViewer}=require('../../cindy-simulator/node/remote/viewer.cjs');

const TOKEN='a'.repeat(64);
// Stands in for Cindy's loopback address: one stream message, then it records what is posted.
async function host(){
  const posts=[];
  const server=http.createServer((req,res)=>{
    if(req.url===`/${TOKEN}/stream`){res.writeHead(200);res.write(Buffer.from([0,0,0,3,0x10,0x7b,0x7d]));return;}
    // An address that is no longer open, as Cindy answers it.
    if(req.method!=='POST'||!req.url.startsWith(`/${TOKEN}/`)){res.writeHead(404,{'Content-Type':'application/json'});res.end('{"ok":false,"errorCode":"VIEW_CLOSED"}');return;}
    const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
      posts.push({url:req.url,body:JSON.parse(Buffer.concat(chunks).toString()||'{}')});
      const refused=req.url.endsWith('/input')&&posts.at(-1).body.events?.[0]?.button==='refused';
      res.writeHead(refused?409:200,{'Content-Type':'application/json'});res.end(JSON.stringify(refused?{ok:false,errorCode:'VIEW_NOT_READY'}:{ok:true}));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}/${TOKEN}`,posts,close:()=>{server.close();server.closeAllConnections();}};
}
async function opened(t,extra={}){
  const desktop=await fs.mkdtemp(path.join(os.tmpdir(),'remote-shot-'));
  const upstream=await host(),viewer=createRemoteViewer({desktop:()=>desktop,now:()=>new Date(2026,10,11,19,10,32)});
  t.after(async()=>{await viewer.close();upstream.close();await fs.rm(desktop,{recursive:true,force:true});});
  const {url}=await viewer.open({id:'SIM-1',url:upstream.url,name:'iPhone Air',platform:'ios',locale:'zh-CN',task:'task-1',...extra});
  const page=new URL(url),token=page.hash.split('.')[1];
  const api=async(body)=>{const r=await fetch(page.origin+'/control-api',{method:'POST',headers:{'Content-Type':'application/json','X-Cindy-Clipboard':token,Origin:page.origin},body:JSON.stringify({udid:'SIM-1',...body})});return {status:r.status,body:await r.json()};};
  return {viewer,upstream,page,token,api,desktop};
}

test('the remote device opens in the plugin controller with its own device page and stream',async t=>{
  const {page,token,upstream,viewer}=await opened(t);
  assert.equal(page.pathname,'/control');assert.equal(page.searchParams.get('udid'),'SIM-1');assert.equal(page.searchParams.get('task'),'task-1');
  const control=await fetch(page);assert.equal(control.status,200);assert.match(await control.text(),/control\.js/);
  // The device page sits inside the controller, which sits inside Cindy's task page.
  assert.match(control.headers.get('content-security-policy'),/frame-ancestors 'self' cindy-ghost:\/\/cindy-simulator/);
  const stage=await fetch(`${page.origin}/simulators/SIM-1?cindyViewer=${token}`);
  assert.equal(stage.status,200);const html=await stage.text();
  // The same gesture modules as the local simulator page, and the Mac trackpad's real contacts.
  for(const name of ['pointer-interpreter','mouse-gesture-source','wheel-gesture-source','touch-gesture-source','option-hover-preview','pinch-overlay'])assert.ok(html.includes(`/gestures/${name}.js`),name);
  assert.match(html,/cindy-native-trackpad/);
  assert.match(html,/src="\/device-shell.js"/);
  const shell=await fetch(`${page.origin}/device-shell.js`);
  assert.equal(shell.status,200);
  assert.equal(await shell.text(),await fs.readFile(path.join(__dirname,'../../cindy-simulator/node/physical/shell.js'),'utf8'));
  assert.equal((await fetch(`${page.origin}/gestures/pointer-interpreter.js`)).status,200);
  assert.equal((await fetch(`${page.origin}/simulators/SIM-1?cindyViewer=wrong`)).status,403);
  assert.equal((await fetch(`${page.origin}/simulators/OTHER?cindyViewer=${token}`)).status,404);
  const stream=await fetch(`${page.origin}/remote-stream?udid=SIM-1`,{headers:{'X-Cindy-Clipboard':token}});
  assert.equal(stream.status,200);
  const {value}=await stream.body.getReader().read();assert.deepEqual([...value],[0,0,0,3,0x10,0x7b,0x7d]);
  assert.equal((await fetch(`${page.origin}/remote-stream?udid=SIM-1`)).status,403);
  assert.equal(viewer.viewing(),true);
  // Cindy renews the address behind the same page; a closed one says so instead of hanging.
  const next=await viewer.open({id:'SIM-1',url:upstream.url.replace(TOKEN,'b'.repeat(64)),name:'iPhone Air',platform:'ios',locale:'zh-CN',task:'task-1'});
  assert.equal(next.url,page.href);
  assert.equal((await fetch(`${page.origin}/remote-stream?udid=SIM-1`,{headers:{'X-Cindy-Clipboard':token}})).status,410);
});

test('status describes a running remote device and only device input is forwarded',async t=>{
  const {api,upstream}=await opened(t);
  const status=(await api({action:'status'})).body;
  assert.equal(status.viewerPlatform,'remote');assert.equal(status.ready,true);
  assert.deepEqual({kind:status.device.kind,state:status.device.state,name:status.device.name},{kind:'remote',state:'Booted',name:'iPhone Air'});
  // Without a list from that computer's plugin, the device shown is the only one, and it cannot be managed.
  assert.deepEqual(status.devices.map(d=>d.udid),['SIM-1']);assert.deepEqual(status.remote,{computer:'',manage:false});
  const touch={kind:'touch',touches:[{id:0,x:.5,y:.5,phase:'began'}]};
  assert.equal((await api({action:'input',events:[touch]})).body.ok,true);
  assert.equal((await api({action:'press',button:'home'})).body.ok,true);
  assert.equal((await api({action:'retry'})).body.ok,true);
  assert.deepEqual(upstream.posts,[
    {url:`/${TOKEN}/input`,body:{events:[touch]}},
    {url:`/${TOKEN}/input`,body:{events:[{kind:'press',button:'home'}]}},
    {url:`/${TOKEN}/retry`,body:{}},
  ]);
  // What Cindy refuses is reported as not executed, never retried here.
  const refused=await api({action:'press',button:'refused'});
  assert.deepEqual({status:refused.status,code:refused.body.errorCode,execution:refused.body.execution},{status:409,code:'VIEW_NOT_READY',execution:'not_executed'});
  assert.equal(upstream.posts.length,4);
  // Starting, stopping, creating and renaming stay with the computer that runs the device.
  for(const action of ['boot','shutdown','create','rename','switch','catalog','resources','open'])
    assert.equal((await api({action})).body.errorCode,'REMOTE_UNSUPPORTED',action);
  assert.equal((await api({action:'input',events:[]})).body.errorCode,'INVALID_ARGUMENT');
});

test('the controller is told which computer runs the device and what else that computer has',async t=>{
  const {api}=await opened(t,{computer:'Mac Studio',manage:true,devices:[
    {udid:'SIM-2',name:'iPad mini',state:'Shutdown',runtime:'iOS-27-3',productFamily:'iPad',dataPath:'/private'},
    {udid:'SIM-1',name:'iPhone Air',state:'Booted',runtime:'iOS-27-3'},{udid:'bad id',name:'x'},{name:'no id'},'junk']});
  const status=(await api({action:'status'})).body;
  assert.deepEqual(status.remote,{computer:'Mac Studio',manage:true});
  // The device shown first, then that computer's others; all marked as not this computer's.
  assert.deepEqual(status.devices.map(d=>[d.udid,d.state,d.kind]),[['SIM-1','Booted','remote'],['SIM-2','Shutdown','remote']]);
  assert.equal(status.device.runtime,'iOS-27-3');assert.equal(JSON.stringify(status).includes('private'),false);
  // Managing them is the task page's business with that computer, never this worker's.
  for(const action of ['switch','create','shutdown','boot'])assert.equal((await api({action})).body.errorCode,'REMOTE_UNSUPPORTED',action);
});

test('a screenshot is the picture shown here, saved like a local one or handed to the clipboard',async t=>{
  const {api,desktop}=await opened(t);
  const png=Buffer.from('not really a png').toString('base64');
  const saved=(await api({action:'screenshot',to:'desktop',png})).body;
  assert.equal(saved.path,path.join(desktop,'iPhone Air 2026-11-11 19.10.32.png'));
  assert.equal((await fs.readFile(saved.path)).toString(),'not really a png');
  // The same second again never overwrites.
  assert.equal((await api({action:'screenshot',to:'desktop',png})).body.path,path.join(desktop,'iPhone Air 2026-11-11 19.10.32 (2).png'));
  assert.equal((await api({action:'screenshot',to:'clipboard',png})).body.clipboardPng,png);
  assert.equal((await api({action:'screenshot',to:'desktop',png:'../etc'})).body.errorCode,'INVALID_ARGUMENT');
  assert.equal((await api({action:'screenshot_destination',destination:'clipboard'})).body.destination,'clipboard');
  assert.equal((await api({action:'status'})).body.settings.screenshotDestination,'clipboard');
});

test('only an address Cindy could have issued is accepted',async()=>{
  const viewer=createRemoteViewer();
  for(const url of ['https://127.0.0.1:1234/'+TOKEN,'http://example.com:1234/'+TOKEN,'http://127.0.0.1:1234/short','http://127.0.0.1:1234/'+TOKEN+'/x'])
    await assert.rejects(viewer.open({id:'SIM-1',url,name:'x',platform:'ios'}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(viewer.open({id:'bad id',url:'http://127.0.0.1:1234/'+TOKEN,name:'x',platform:'ios'}),{code:'INVALID_ARGUMENT'});
  await assert.rejects(viewer.open({id:'SIM-1',url:'http://127.0.0.1:1234/'+TOKEN,name:'x',platform:'windows'}),{code:'INVALID_ARGUMENT'});
  await viewer.close();
});
