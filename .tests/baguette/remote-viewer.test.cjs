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
  assert.match(html,/src="\/device-shell.js"/);assert.match(html,/src="\/keys.js"/);
  const keySource=await fetch(`${page.origin}/keys.js`);assert.equal(keySource.status,200);assert.equal(await keySource.text(),await fs.readFile(path.join(__dirname,'../../cindy-simulator/node/keys.cjs'),'utf8'));
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

// Feed the real screen page its stream metadata, then drive DOM key events.
// Provider validation must accept every emitted batch, including mixed text/key input.
for(const platform of ['ios','android'])test(`remote ${platform} keyboard sends provider-compatible input and a readable reconnect title`,async()=>{
  const vm=require('node:vm'),{validEvents}=require('../../cindy-simulator/node/live-screen.cjs');
  const nodes=new Map(),events={},sent=[],poses=[],intervals=[];
  const get=id=>{if(!nodes.has(id))nodes.set(id,{style:{},value:'',listeners:{},setAttribute(){},removeAttribute(){},getContext:()=>({}),addEventListener(type,fn){this.listeners[type]=fn;}});return nodes.get(id);};
  const message=data=>{const bytes=Buffer.from(JSON.stringify(data)),packet=Buffer.alloc(5+bytes.length);packet.writeUInt32BE(bytes.length+1);packet[4]=0x10;bytes.copy(packet,5);return packet;};
  const initial=Buffer.concat([message({type:'device',platform,keyboard:true,maxTouches:2}),message({type:'screen',width:2736,height:1260}),message({type:'state',state:'reconnecting'}),message({type:'state',state:'live'})]);
  let first=true,controller;
  const context={URLSearchParams,location:{pathname:'/simulators/SIM-1',search:'?cindyViewer=token'},parent:{document:{documentElement:{lang:'zh-CN'}},cindySim:{state:{status:{device:{rotation:1}}}}},
    document:{hidden:false,getElementById:get,addEventListener(){}},innerWidth:500,innerHeight:900,
    addEventListener:(type,fn)=>events[type]=fn,setInterval:fn=>intervals.push(fn),setTimeout(){},clearTimeout(){},
    AbortController,AbortSignal,Uint8Array,DataView,TextDecoder,TextEncoder,VideoDecoder:class{},
    window:{Baguette:{_PinchOverlay:class{clear(){}},_PointerInterpreter:class{attach(){}cancel(){}detach(){}}},DeviceShell:class{update(pose){poses.push(JSON.parse(JSON.stringify(pose)));}}},
    fetch:async(url,options)=>{
      if(url==='/control-api'){sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})};}
      controller=options.signal;
      return {ok:true,body:{getReader:()=>({
        read:async()=>{if(first){first=false;return {value:initial,done:false};}return new Promise(resolve=>controller.addEventListener('abort',()=>resolve({done:true}),{once:true}));},
        cancel:async()=>{},
      })}};
    }};
  vm.createContext(context);vm.runInContext(await fs.readFile(path.join(__dirname,'../../cindy-simulator/node/keys.cjs'),'utf8'),context);vm.runInContext(await fs.readFile(path.join(__dirname,'../../cindy-simulator/node/remote/screen.js'),'utf8'),context);
  const settle=()=>new Promise(resolve=>setImmediate(resolve));await settle();
  assert.equal(get('message-title').textContent,'正在重新连接');
  assert.equal(poses.at(-1).rotation,1);
  context.parent.cindySim.state.status.device.rotation=3;intervals[0]();
  assert.deepEqual(poses.at(-1),{width:2736,height:1260,rotation:3});
  const codes=['Enter','Tab','Backspace','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
  if(platform==='android')codes.push('Delete');
  for(const key of codes)get('keyboard').listeners.keydown({key,preventDefault(){}});
  const chords=[
    {key:'ArrowLeft',code:'ArrowLeft',shiftKey:true,modifiers:['shift']},
    {key:'z',code:'KeyZ',ctrlKey:true,modifiers:['control']},
    {key:'a',code:'KeyA',metaKey:true,modifiers:['command']},
    {key:'ArrowRight',code:'ArrowRight',altKey:true,modifiers:['option']},
    {key:'Z',code:'KeyZ',metaKey:true,shiftKey:true,modifiers:['shift','command']},
  ];
  if(platform==='android')chords.push({key:'F5',code:'F5',ctrlKey:true,modifiers:['control']});
  for(const chord of chords)get('keyboard').listeners.keydown({...chord,preventDefault(){}});
  // Unsupported shortcuts and layout text must not poison a valid queued chord.
  const bypass=[
    ...(platform==='ios'?[{key:'F5',code:'F5',ctrlKey:true},{key:'Delete',code:'Delete'}]:[]),
    {key:'Dead',code:'KeyE',altKey:true}, {key:'é',code:'KeyE',altKey:true},
    {key:'€',code:'KeyE',ctrlKey:true,altKey:true,getModifierState:name=>name==='AltGraph'},
    {key:'1',code:'Numpad1',metaKey:true},
  ];
  for(const event of bypass)get('keyboard').listeners.keydown({...event,preventDefault(){assert.fail('browser must retain layout text and unsupported keys');}});
  get('keyboard').listeners.keydown({key:'Process',code:'KeyA',isComposing:true,preventDefault(){assert.fail('IME must remain on the text path');}});
  for(const modifier of ['metaKey','ctrlKey'])get('keyboard').listeners.keydown({key:'v',code:'KeyV',[modifier]:true,preventDefault(){assert.fail('browser must deliver paste');}});
  get('keyboard').listeners.paste({clipboardData:{getData:()=> 'pasted'},preventDefault(){}});
  get('keyboard').value='text';get('keyboard').listeners.input({});await settle();await settle();
  // Real page queue: mixed multi-byte text and JSON escaping across both HTTP limits.
  const longText=('中😀\\\"'.repeat(10001)+'\u0001'.repeat(10001));
  get('keyboard').listeners.paste({clipboardData:{getData:()=>longText},preventDefault(){}});
  for(let i=0;i<100;i++)await settle();
  const large=sent.filter(p=>p.action==='input');
  for(const packet of large){assert.ok(Buffer.byteLength(JSON.stringify(packet))<=60000);for(const event of packet.events)assert.ok(Buffer.byteLength(JSON.stringify({events:[event]}))<=16384);}
  assert.equal(large.flatMap(p=>p.events).filter(e=>e.kind==='text').map(e=>e.text).join(''),'pastedtext'+longText);
  events.pagehide();await settle();
  const batches=sent.filter(p=>p.action==='input').map(p=>p.events);
  for(const batch of batches){assert.doesNotThrow(()=>validEvents(batch,'en'));for(const event of batch)if(event.kind==='key')assert.doesNotThrow(()=>require('../../cindy-simulator/node/keys.cjs')[platform==='android'?'androidKey':'chord'](event.code,event.modifiers??[]));}
  assert.deepEqual(batches.flat().filter(e=>e.kind==='key'),[...codes.map(code=>({kind:'key',code})),...chords.map(({code,modifiers})=>({kind:'key',code,modifiers}))]);
  assert.ok(batches.flat().some(e=>e.kind==='text'&&e.text==='text'));
  assert.equal(batches.flat().filter(e=>e.kind==='text'&&e.text==='pasted').length,1);
});

// The page/provider and host wire have deliberately different key contracts.
// Exercise the real HTTP bridge; counting page emissions alone misses this gap.
test('remote key chords cross the host wire in bounded batches without lost modifiers',async t=>{
  const {api,upstream}=await opened(t);
  const keys=Array.from({length:64},()=>({kind:'key',code:'ArrowLeft',modifiers:['shift','command']}));
  assert.equal((await api({action:'input',events:keys})).body.ok,true);
  const packets=upstream.posts.map(p=>p.body.events);
  assert.ok(packets.length>1);assert.ok(packets.every(events=>events.length<=64));
  const chord=[['ShiftLeft',true],['MetaLeft',true],['ArrowLeft',true],['ArrowLeft',false],['MetaLeft',false],['ShiftLeft',false]].map(([code,down])=>({kind:'key',code,down}));
  assert.deepEqual(packets.flat(),keys.flatMap(()=>chord));
  upstream.posts.length=0;
  const bad=await api({action:'input',events:[{kind:'key',code:'KeyA',modifiers:['invalid']}]});
  assert.equal(bad.body.errorCode,'INVALID_ARGUMENT');assert.equal(upstream.posts.length,0);
  // A later refused batch does not erase the earlier batch's execution.
  const failed=await api({action:'input',events:[...Array.from({length:32},()=>({kind:'key',code:'Enter'})),{kind:'press',button:'refused'}]});
  assert.equal(failed.body.execution,'unknown');assert.equal(upstream.posts.length,2);
});
