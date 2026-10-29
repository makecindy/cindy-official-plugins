'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {normalize,createDevices}=require('../../baguette-simulator/node/physical/devices.cjs');
const {createAgent}=require('../../baguette-simulator/node/physical/agent.cjs');
const id='00000000-0000-4000-8000-000000000001';
const row=()=>({identifier:id,properties:{hardware:{reality:'physical',deviceType:'iPhone',udid:'00008160-0000000000000001'},state:{name:'Test phone',developerModeStatus:'enabled'},software:{osVersionNumber:{stringValue:'27.2'}},connection:{state:'connected',tunnelIPAddress:'fd00::1',transportType:'wired'}}});
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'physical-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('runner startup reports an explicit locked-phone diagnostic from the current log tail',async t=>{
 const {runnerLocked}=require('../../baguette-simulator/node/physical/wda.cjs'),root=await temporary(t),log=path.join(root,'runner.log');
 assert.equal(await runnerLocked(log),false);
 await fs.writeFile(log,'Xcode cannot launch WebDriverAgentRunner because the device is locked.');assert.equal(await runnerLocked(log),true);
 await fs.writeFile(log,'Unlock Test Phone to Continue');assert.equal(await runnerLocked(log),true);
 await fs.writeFile(log,'Unlock Test Phone to Continue\n'+'Normal output\n'.repeat(2000));assert.equal(await runnerLocked(log),false);
});
test('CoreDevice discovery separates paired physical phones, offline devices and simulators',()=>{
 const d=normalize(row());assert.equal(d.kind,'physical');assert.equal(d.state,'Booted');assert.equal(d.developerMode,true);assert.equal(d.runtime,'iOS 27.2');
 const offline=row();offline.properties.connection.state='disconnected';assert.equal(normalize(offline).isAvailable,false);
 const sim=row();sim.properties.hardware.reality='simulated';assert.equal(normalize(sim),null);
 const bad=row();bad.identifier='arbitrary host';assert.equal(normalize(bad),null);
 const devices=createDevices({root:'/unused',run:()=>{throw Error('not called');}});
 assert.equal(devices.endpoint(d,12345),'http://[fd00::1]:12345');
 for(const tunnelAddress of ['127.0.0.1','example.test','2001:db8::1','http://fd00::1'])assert.throws(()=>devices.endpoint({...d,tunnelAddress},12345),e=>e.code==='DEVICE_TUNNEL_UNAVAILABLE');
});
test('physical destructive simulator operations reject before any device write',async t=>{
 const root=await temporary(t),calls=[];
 // Exercise Mac discovery with mocked commands even on the Linux CI runner.
 // Do not change the production host guard or consult attached host devices.
 const filename=path.resolve('baguette-simulator/node/physical/index.cjs'),load=require('node:module').createRequire(filename);
 const context={module:{exports:{}},require(name){return name==='./devices.cjs'?{...load(name),createDevices:options=>createDevices({...options,host:'darwin'})}:load(name);}};
 require('node:vm').runInNewContext(await fs.readFile(filename,'utf8'),context,{filename});
 const adapter=context.module.exports.createPhysical({root,children:new Set(),run:async(file,args)=>{
  calls.push(args);assert.deepEqual(args.slice(0,3),['devicectl','list','devices']);
  await fs.writeFile(args[args.indexOf('--json-output')+1],JSON.stringify({info:{outcome:'success'},result:{devices:[row()]}}));return {stdout:''};
 }});
 for(const method of ['shutdown','boot','erase_device','delete_device','rename_device','heal'])await assert.rejects(adapter.dispatch(method,{udid:id}),e=>e.code==='PHYSICAL_DEVICE_PROTECTED'&&e.execution==='not_executed');
 assert.equal(calls.length,6);
});
test('global stop leaves physical phones running and ignores their discovery errors',async t=>{
 const root=await temporary(t),calls=[];
 const runtime=require('../../baguette-simulator/node/runtime.cjs').createRuntime({settingsFile:path.join(root,'settings.json'),dispatch:async method=>{
  calls.push(method);return method==='devices'?{devices:[normalize(row())],platformErrors:[{platform:'physical',message:'offline'}]}:{ok:true};
 }});
 const result=await runtime.request('settings_stop_all');assert.equal(result.ok,true);assert.equal(calls.includes('shutdown'),false);assert.ok(calls.includes('close_viewer'));
});
test('disconnect cancels a setup job while its device lock is held',async t=>{
 const root=await temporary(t);let resolve;const pending=new Promise(r=>resolve=r);
 const runtime=require('../../baguette-simulator/node/runtime.cjs').createRuntime({settingsFile:path.join(root,'settings.json'),pendingOperation:()=>pending,dispatch:async method=>{
  if(method==='physical_disconnect'){resolve();return {execution:'executed'};}return {state:'running'};
 }});
 await runtime.request('device',{udid:id,action:'connect'});
 assert.equal((await runtime.request('device',{udid:id,action:'disconnect'})).execution,'executed');
});
function fixture(){let width=400,orientation='PORTRAIT';const writes=[];
 const agent=createAgent({root:'/unused',run:()=>{},wda:{call:async(d,route,p,body)=>{
  if(body){writes.push({route,body});return null;}
  if(route==='/window/size')return {width,height:800};if(route==='/orientation')return orientation;
  if(route==='/source?format=json')return {type:'XCUIElementTypeButton',label:'Next',name:'next',rect:{x:10,y:20,width:60,height:30}};
 }}});return {agent,writes,rotate(){width=800;orientation='LANDSCAPE';}};
}
test('stale coordinates and unsupported input do not send mutations',async()=>{
 const f=fixture();await f.agent.describe({udid:id},{});f.rotate();
 await assert.rejects(f.agent.tap({udid:id},{x:20,y:20,observe:'none'}),e=>e.code==='SCREEN_CHANGED'&&e.execution==='not_executed');
 await assert.rejects(f.agent.typeText({udid:id},{text:'test',method:'paste'}),e=>e.code==='UNSUPPORTED_OPTION');
 await assert.rejects(f.agent.press({udid:id},{button:'home',duration:2}),e=>e.code==='UNSUPPORTED_OPTION');assert.equal(f.writes.length,0);
});
test('physical tap uses view points, Unicode input is preserved and observation failure does not undo input',async()=>{
 const f=fixture();await f.agent.tap({udid:id},{id:'next',observe:'none'});
 assert.equal(f.writes[0].body.actions[0].actions[0].x,40);assert.equal(f.writes[0].body.actions[0].actions[0].y,35);
 await f.agent.typeText({udid:id},{text:'你好 👋',observe:'none'});assert.deepEqual(f.writes[1].body,{value:['你好 👋']});
 const a=createAgent({wda:{call:async(d,route,p,body)=>{if(body)return null;if(route==='/window/size')return {width:400,height:800};if(route==='/orientation')return 'PORTRAIT';throw Error('observation offline');}}});
 const result=await a.typeText({udid:id},{text:'once',observe:'ui',settle:0});assert.equal(result.execution,'executed');assert.match(result.observationError.message,/offline/);
});
test('viewer requires exact origin, token and opened device; parallel opens share the server',async t=>{
 const {createViewer}=require('../../baguette-simulator/node/physical/viewer.cjs');const calls=[];
 const viewer=createViewer({devices:{target:async()=>normalize(row())},wda:{state:()=>({ready:true})},agent:{}});
 viewer.configure({assertEnabled:async()=>{},request:async(m,p)=>{calls.push([m,p]);return {execution:'executed'};}});t.after(()=>viewer.close());
 const [a,b]=await Promise.all([viewer.open(id,'en'),viewer.open(id,'en')]);assert.equal(a.url,b.url);
 const u=new URL(a.url),token=new URLSearchParams(u.hash.slice(1)).get('cindyClipboard').split('.')[1];
 const post=(headers={},body={action:'tap',udid:id,x:3,y:4})=>fetch(u.origin+'/physical-api',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await post()).status,403);
 assert.equal((await post({origin:'http://example.test','x-cindy-clipboard':token})).status,403);
 const headers={origin:u.origin,'x-cindy-clipboard':token};assert.equal((await post(headers,{action:'tap',udid:'foreign'})).status,404);
 assert.equal((await post(headers)).status,200);assert.equal(calls.length,1);assert.equal(calls[0][0],'tap');
});
test('physical viewing and screenshots use the shared controller without preparing signing or control',async t=>{
 const {PNG}=require('../../baguette-simulator/vendor/android/deps.cjs');
 const calls=[],screen={displayId:2,width:2,height:3,rotation:'rot0'},image=new PNG({width:2,height:3});
 const viewer=require('../../baguette-simulator/node/physical/viewer.cjs').createViewer({devices:{target:async()=>normalize(row()),screen:async()=>screen},wda:{state:()=>({ready:false,state:'disconnected'})},agent:{preview:async()=>({screen,image:'encoded',mime:'image/jpeg',fast:false}),screenshot:async()=>({path:'/test.png'})}});
 viewer.configure({assertEnabled:async()=>{},status:async()=>({devices:[normalize(row())],settings:{enabled:true}}),request:async(m,p)=>{calls.push([m,p]);return {state:'running',ready:false};}});t.after(()=>viewer.close());
 const u=new URL((await viewer.open(id,'zh-CN')).url),token=new URLSearchParams(u.hash.slice(1)).get('cindyClipboard').split('.')[1];
 const post=async(route,action)=>{const r=await fetch(u.origin+route,{method:'POST',headers:{Origin:u.origin,'Content-Type':'application/json','X-Cindy-Clipboard':token},body:JSON.stringify({action,udid:id,x:1,y:1})});return r.json();};
 assert.match(await (await fetch(u)).text(),/control.js/);
 assert.equal((await post('/control-api','status')).ready,true);
 assert.equal((await post('/physical-api','frame')).screen.displayId,2);
 assert.equal((await post('/control-api','screenshot')).path,'/test.png');assert.deepEqual(calls,[]);
 const r=await post('/physical-api','tap');assert.equal(r.preparing,true);assert.equal(r.execution,'not_executed');assert.equal(calls.length,1);assert.equal(calls[0][0],'physical_connect');assert.equal(calls[0][1].teamId,undefined);
});
test('native screenshot selects the active panel and deletes the temporary file even on screen change',async t=>{
 const root=await temporary(t),files=[],argsSeen=[];let displayId=2,reads=0,change=false;
 const devices=createDevices({root,host:'darwin',run:async(file,args)=>{
   argsSeen.push(args);let result;
   if(args.includes('displays')){reads++;if(change&&reads>1)displayId=1;result={displays:[{displayId,uniqueId:'inner-display',active:true,type:{integrated:{}},pointScale:2,bounds:[[0,0],[4,6]],currentOrientation:'rot0'}]};}
   else{const out=args[args.indexOf('--destination')+1];files.push(out);await fs.writeFile(out,'image');result={};}
   await fs.writeFile(args[args.indexOf('--json-output')+1],JSON.stringify({info:{outcome:'success'},result}));return {stdout:''};
 }});
 const f=await devices.capture({udid:id});assert.equal(f.bytes.toString(),'image');assert.equal(f.screen.displayId,2);
 assert.equal(argsSeen[1][argsSeen[1].indexOf('--display-unique-id')+1],'inner-display');
 change=true;reads=0;await assert.rejects(devices.capture({udid:id}),e=>e.code==='SCREEN_CHANGED');
 for(const file of files)await assert.rejects(fs.stat(file),e=>e.code==='ENOENT');
});
test('view-only frame never calls the control runner',async()=>{
 const {PNG}=require('../../baguette-simulator/vendor/android/deps.cjs'),image=new PNG({width:4,height:6}),screen={width:2,height:3,displayId:2,rotation:'rot0'};
 const agent=createAgent({devices:{capture:async()=>({bytes:PNG.sync.write(image),screen})},wda:{call:()=>{throw Error('must not connect');},state:()=>{throw Error('must not depend on control');}}});
 assert.equal((await agent.frame({udid:id})).screen.ratio,2);
});
test('signing chooses a single team or the installed runner; ambiguous teams require selection',()=>{
 const {choose}=require('../../baguette-simulator/node/physical/signing.cjs'),teams=[{id:'AAAAAAAAAA',name:'Team A'},{id:'BBBBBBBBBB',name:'Team B'}];
 assert.equal(choose(teams.slice(0,1)),teams[0].id);assert.equal(choose(teams),null);
 assert.equal(choose(teams,undefined,[{bundleIdentifier:'com.makecindy.WebDriverAgent.bbbbbbbbbb.xctrunner'}]),'BBBBBBBBBB');
 assert.equal(choose(teams,'AAAAAAAAAA',[{bundleIdentifier:'com.makecindy.WebDriverAgent.bbbbbbbbbb.xctrunner'}]),'AAAAAAAAAA');
 assert.equal(choose(teams,'INVALID'),null);
});
test('lost response after a physical write remains unknown, expired budget sends nothing',async t=>{
 let received=0;const server=http.createServer((req)=>{received++;req.resume();req.on('end',()=>req.socket.destroy());});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const {request}=require('../../baguette-simulator/node/physical/wda.cjs'),base=`http://127.0.0.1:${server.address().port}`;
 await assert.rejects(request(base,'/input',{body:{text:'once'},mutation:true,deadline:Date.now()-1}),e=>e.execution==='not_executed');assert.equal(received,0);
 await assert.rejects(request(base,'/input',{body:{text:'once'},mutation:true}),e=>e.execution==='unknown');assert.equal(received,1);
});
test('connected control holds the worker but merely attached phones do not',async t=>{
 const root=await temporary(t);let now=0,ready=false;
 const runtime=require('../../baguette-simulator/node/runtime.cjs').createRuntime({settingsFile:path.join(root,'settings.json'),now:()=>now,holdMs:20,holdPollMs:10,sleep:async ms=>{now+=ms;},dispatch:async()=>({devices:[{...normalize(row()),control:{ready}}]})});
 assert.equal((await runtime.request('device_hold')).running,false);ready=true;assert.equal((await runtime.request('device_hold')).running,true);
});
test('Duo chooses the active integrated display rather than its inactive primary panel',()=>{
 const {activeScreen}=require('../../baguette-simulator/node/physical/devices.cjs');
 const cover={displayId:1,active:false,primary:true,type:{integrated:{}},bounds:[[0,0],[1398,2034]],pointScale:3,currentOrientation:'rot0'};
 const inner={...cover,displayId:2,active:true,primary:false,bounds:[[0,0],[2007,2853]],currentOrientation:'rot180'};
 assert.deepEqual(activeScreen({displays:[cover,inner]}),{displayId:2,width:669,height:951,rotation:'rot180'});
 assert.equal(activeScreen({displays:[{...cover,active:true},{...inner,active:false}]}).displayId,1);
 assert.throws(()=>activeScreen({displays:[cover,{...inner,active:false}]}),e=>e.code==='DISPLAY_UNAVAILABLE');
});
test('display selection drives screenshot/input settings and a fold rejects previously observed coordinates',async()=>{
 let screen={displayId:2,width:669,height:951,rotation:'rot180'};const writes=[];
 const a=createAgent({devices:{screen:async()=>screen},wda:{call:async(d,route,p,body)=>{
  if(body){writes.push({route,body});return null;}if(route==='/wda/apps/list')return [{bundleId:'example.test'},{bundleId:'com.apple.springboard'}];
  if(route==='/orientation')return 'PORTRAIT';if(route==='/source?format=json')return {};
 }}});
 await a.describe({udid:id},{});assert.deepEqual(writes[0].body.settings,{cindyDisplayId:2,defaultActiveApplication:'example.test'});
 screen={...screen,displayId:1};await assert.rejects(a.tap({udid:id},{x:20,y:20,observe:'none'}),e=>e.code==='SCREEN_CHANGED');assert.equal(writes.some(x=>x.route==='/actions'),false);
});

test('ready preview uses supplied metadata and rejects a fold mismatch',async()=>{
 let reads=0,displayId=2,mismatch=false;const calls=[];
 const agent=createAgent({devices:{screen:async()=>{reads++;return {width:669,height:951,displayId,rotation:'rot0'};},capture:()=>{throw Error('slow capture must not run');}},wda:{state:()=>({ready:true}),call:async(_d,route)=>{calls.push(route);return {image:'jpeg',width:mismatch?951:669,height:mismatch?669:951};}}});
 const d={udid:id};assert.equal((await agent.preview(d)).fast,true);await agent.preview(d,{}, {width:669,height:951,displayId:2,rotation:'rot0'});
 assert.equal(reads,1);assert.deepEqual(calls,['/cindy/frame/2','/cindy/frame/2']);
 mismatch=true;await assert.rejects(agent.preview(d),e=>e.code==='SCREEN_CHANGED');
 mismatch=false;displayId=1;await agent.preview(d);assert.equal(reads,3);assert.equal(calls.at(-1),'/cindy/frame/1');
});

test('lost preview transport falls back to unsigned viewing without sending or replaying input',async()=>{
 const {PNG}=require('../../baguette-simulator/vendor/android/deps.cjs');const img=new PNG({width:2,height:3}),screen={width:2,height:3,displayId:2,rotation:'rot0'};let ready=true,captures=0,calls=0;
 const agent=createAgent({devices:{screen:async()=>screen,capture:async()=>{captures++;return {bytes:PNG.sync.write(img),screen};}},wda:{state:()=>({ready}),call:async()=>{calls++;ready=false;throw Error('connection closed');}}});
 const f=await agent.preview({udid:id});assert.equal(f.fast,false);assert.equal(captures,1);assert.equal(calls,1);assert.equal(f.screen.displayId,2);
});

test('preview refresh does not block fresh frames, shares captures and bounds stale metadata',async()=>{
 const {createPreview}=require('../../baguette-simulator/node/physical/preview.cjs');let now=0,targets=0,frames=0,resolveRefresh,resolveFrame;
 const preview=createPreview({now:()=>now,devices:{target:async()=>{targets++;return {udid:id};},screen:async()=>targets===1?{displayId:1}:new Promise(r=>resolveRefresh=r)},wda:{state:()=>({ready:true})},agent:{preview:async(d,p,screen)=>{frames++;return resolveFrame===false?new Promise(r=>resolveFrame=r):{displayId:screen.displayId};}}});
 assert.equal((await preview.frame(id)).displayId,1);assert.equal(targets,1);
 now=800;assert.equal((await preview.frame(id)).displayId,1,'refresh must not pause a usable frame');assert.equal(targets,2);
 now=2100;let settled=false;const waiting=preview.frame(id).then(r=>{settled=true;return r;});await new Promise(r=>setImmediate(r));assert.equal(settled,false,'expired metadata must wait');
 resolveRefresh({displayId:2});assert.equal((await waiting).displayId,2);
 now=2101; // The completed refresh started at 800; next refresh is allowed in the background.
 resolveFrame=false;const a=preview.frame(id),b=preview.frame(id);assert.equal(a,b,'two viewers share the same in-flight image');
 await new Promise(r=>setImmediate(r));resolveFrame({displayId:2});await a;resolveRefresh({displayId:2});await new Promise(r=>setImmediate(r));
 preview.clear();assert.equal(frames,4);
});

test('failed metadata refresh stops stale viewing and never sends device input',async()=>{
 const {createPreview}=require('../../baguette-simulator/node/physical/preview.cjs');let now=0,offline=false,frames=0;
 const preview=createPreview({now:()=>now,devices:{target:async()=>{if(offline)throw Error('offline');return {udid:id};},screen:async()=>({displayId:1})},wda:{state:()=>({ready:true})},agent:{preview:async()=>{frames++;return {};}}});
 await preview.frame(id);offline=true;now=2100;await assert.rejects(preview.frame(id),/offline/);assert.equal(frames,1);
});

test('keyboard readiness precedes text and timeout reports not_executed without sending keys',async()=>{
 for(const ready of [false,true]){
  const routes=[];const agent=createAgent({devices:{screen:async()=>({displayId:1,width:466,height:678,rotation:'rot0'})},wda:{call:async(d,route,p,body)=>{
   routes.push(route);if(route==='/wda/apps/list')return [{bundleId:'example.test'}];if(route==='/cindy/keyboard-ready')return {ready};return null;
  }}});
  if(ready)assert.equal((await agent.typeText({udid:id},{text:'first'})).execution,'executed');
  else await assert.rejects(agent.typeText({udid:id},{text:'first'}),e=>e.code==='KEYBOARD_NOT_READY'&&e.execution==='not_executed');
  assert.equal(routes.includes('/wda/keys'),ready);if(ready)assert.ok(routes.indexOf('/cindy/keyboard-ready')<routes.indexOf('/wda/keys'));
 }
});

test('a WDA application error does not masquerade as a broken transport',async t=>{
 const server=http.createServer((req,res)=>{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({value:{error:'invalid argument',message:'invalid display'}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const {request}=require('../../baguette-simulator/node/physical/wda.cjs');
 await assert.rejects(request(`http://127.0.0.1:${server.address().port}`,'/frame'),e=>e.execution==='not_executed'&&!e.transport);
});

test('viewer batches only adjacent unsent text and cancellation never replays it',async t=>{
 const vm=require('node:vm'),nodes=new Map(),timers=new Set(),calls=[],events={};let release;
 const element=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:true,style:{},handlers:{},setAttribute(){},addEventListener(n,fn){this.handlers[n]=fn;},getContext(){return {drawImage(){}};},replaceChildren(){},getBoundingClientRect(){return {left:0,top:0,width:400,height:800};},focus(){},append(){}});return nodes.get(id);};
 const context={URLSearchParams,AbortSignal,performance,Image:class{width=400;height=800;async decode(){}},innerWidth:500,innerHeight:900,
  location:{pathname:'/simulators/'+id,search:'?cindyViewer=test',origin:'http://example.test'},
  document:{hidden:false,getElementById:element,createElement:()=>element('button')},parent:{document:{documentElement:{lang:'en'}},cindySim:{state:{}}},
  Baguette:{_PinchOverlay:class{clear(){}setFingers(){}}},addEventListener(n,fn){events[n]=fn;},
  setTimeout(fn,ms){const timer=setTimeout(fn,ms);timers.add(timer);return timer;},clearTimeout,
  async fetch(_url,options){const p=JSON.parse(options.body);if(p.action==='frame'){context.document.hidden=true;return {ok:true,json:async()=>({image:'jpeg',screen:{width:400,height:800,displayId:1,rotation:'rot0'},control:{state:'ready',ready:true},fast:true})};}
   calls.push(p);if(calls.length===1)await new Promise(r=>release=r);return {ok:true,json:async()=>({execution:'executed'})};}
 };context.window=context;t.after(()=>{for(const timer of timers)clearTimeout(timer);});
 vm.runInNewContext(await fs.readFile(path.resolve('baguette-simulator/node/physical/screen.js'),'utf8'),context);
 const settle=()=>new Promise(r=>setImmediate(r));await settle();
 const text=value=>{const k=element('keyboard');k.value=value;k.handlers.input({isComposing:false});};
 text('a');await settle();text('你');text('好');context.__nativeHome();text('d');text('e');
 assert.equal(calls.length,1);release();await settle();await settle();
 assert.deepEqual(calls.map(c=>[c.action,c.text||c.button]),[['type','a'],['type','你好'],['press','home'],['type','de']]);
 // A new document epoch cancels queued input, rather than submitting it later.
 calls.length=0;text('first');await settle();text('stale');context.__nativeRelease();release();await settle();await settle();assert.equal(calls.length,1);
});

test('physical chrome selects the panel by its native size, never the CoreDevice display ID',()=>{
 const {selectPanel,rotationFor,turnRect}=require('../../baguette-simulator/node/physical/chrome.cjs');
 const cover={displayType:'integrated',deviceName:'primary',width:1398,height:2034,scale:3};
 const inner={...cover,deviceName:'primary-1',width:2007,height:2853};
 assert.equal(selectPanel([cover,inner],{width:951,height:669,displayId:1}),inner);
 assert.equal(selectPanel([cover,inner],{width:466,height:678,displayId:2}),cover);
 assert.equal(selectPanel([cover,inner],{width:400,height:800}),undefined);
 const rect={x:10,y:20,width:200,height:400},viewport={width:230,height:450};
 assert.equal(rotationFor(rect,{width:400,height:200,rotation:'rot270'}),270);
 assert.equal(rotationFor(rect,{width:200,height:400,rotation:'rot180'}),180);
 assert.deepEqual(turnRect(rect,viewport,90),{x:30,y:10,width:400,height:200});
 assert.deepEqual(turnRect(rect,viewport,180),{x:20,y:30,width:200,height:400});
 assert.deepEqual(turnRect(rect,viewport,270),{x:20,y:20,width:400,height:200});
});

test('bezel pixels and mask alpha rotate with the screen cutout',()=>{
 const {PNG}=require('../../baguette-simulator/vendor/android/deps.cjs'),{turnPNG}=require('../../baguette-simulator/node/physical/chrome.cjs');
 const src=new PNG({width:2,height:3});for(let i=0;i<6;i++){src.data[i*4]=i+1;src.data[i*4+3]=i*40;}
 const bytes=PNG.sync.write(src);
 for(const [angle,expected] of [[90,[5,3,1,6,4,2]],[180,[6,5,4,3,2,1]],[270,[2,4,6,1,3,5]]]){
  const image=PNG.sync.read(turnPNG(bytes,angle));assert.equal(image.width,angle===180?2:3);
  assert.deepEqual(Array.from({length:6},(_,i)=>image.data[i*4]),expected);
  assert.deepEqual(Array.from({length:6},(_,i)=>image.data[i*4+3]),expected.map(x=>(x-1)*40));
 }
});

test('single-screen Air wakes without optional active or uniqueId fields; foldables never guess a panel',async t=>{
 const {activeScreen}=require('../../baguette-simulator/node/physical/devices.cjs');
 const air={displayId:1,primary:true,type:{integrated:{}},bounds:[[0,0],[1260,2736]],pointScale:3,currentOrientation:'rot0',backlightState:'activeOn'};
 assert.deepEqual(activeScreen({displays:[air]}),{displayId:1,width:420,height:912,rotation:'rot0'});
 assert.throws(()=>activeScreen({displays:[{...air,active:false}]}),e=>e.code==='DISPLAY_UNAVAILABLE');
 assert.throws(()=>activeScreen({displays:[air,{...air,displayId:2,primary:false}]}),e=>e.code==='DISPLAY_UNAVAILABLE');
 assert.throws(()=>activeScreen({displays:[{...air,backlightState:'off'}]}),e=>e.code==='DISPLAY_ASLEEP');
 const root=await temporary(t);let awake=false,primary=true,captures=0;
 const devices=createDevices({root,host:'darwin',run:async(file,args)=>{
  let result={};if(args.includes('displays'))result={displays:[{...air,primary,backlightState:awake?'activeOn':'off'}]};
  else{captures++;assert.equal(args.includes('--display-unique-id'),false);await fs.writeFile(args[args.indexOf('--destination')+1],'image');}
  await fs.writeFile(args[args.indexOf('--json-output')+1],JSON.stringify({info:{outcome:'success'},result}));return {stdout:''};
 }});
 await assert.rejects(devices.capture({udid:id}),e=>e.code==='DISPLAY_ASLEEP');assert.equal(captures,0);
 awake=true;assert.equal((await devices.capture({udid:id})).screen.width,420);assert.equal(captures,1);
 primary=false;await assert.rejects(devices.capture({udid:id}),e=>e.code==='DISPLAY_UNAVAILABLE');assert.equal(captures,1);
});

test('preview resumes after screen-off metadata failure without reconnecting control',async()=>{
 const {createPreview}=require('../../baguette-simulator/node/physical/preview.cjs');let awake=false;
 const preview=createPreview({devices:{target:async()=>({udid:id}),screen:async()=>{if(!awake)throw Object.assign(Error('off'),{code:'DISPLAY_ASLEEP'});return {displayId:1};}},wda:{state:()=>({ready:true})},agent:{preview:async(d,p,screen)=>({screen,image:'new'})}});
 await assert.rejects(preview.frame(id),e=>e.code==='DISPLAY_ASLEEP');awake=true;
 assert.equal((await preview.frame(id)).image,'new');
});
