const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');const os=require('node:os');
const node=path.join(__dirname,'../../baguette-simulator/node');
const G=require(path.join(node,'geometry.cjs'));const input=require(path.join(node,'input.cjs'));

test('view points round-trip through every orientation, and frames turn with the screen',()=>{
 const W=402,H=874;
 for(const orientation of Object.keys(G.ROTATION)){
  const screen={width:W,height:H,orientation},view=G.viewSize(screen);
  assert.deepEqual(view,G.ROTATION[orientation]%180?{width:H,height:W}:{width:W,height:H});
  for(const [x,y] of [[0,0],[10,20],[view.width-1,view.height-5]]){
   const n=G.toNative(screen,x,y);assert.ok(n.x>=0&&n.x<=W&&n.y>=0&&n.y<=H,orientation);
   assert.deepEqual(G.toView(screen,n.x,n.y),{x,y},orientation);
  }
 }
 // landscape-left is the viewer's rotate(90deg): native top edge becomes the view's right edge.
 const ll={width:W,height:H,orientation:'landscape-left'};
 assert.deepEqual(G.toView(ll,201,0),{x:874,y:201});
 // Measured on iOS 27 Safari: the first paragraph's native frame sits near the view's top.
 assert.deepEqual(G.frameToView(ll,{x:119,y:230,width:46,height:414}),{x:230,y:119,width:414,height:46});
});

test('compact tree keeps actionable and readable elements in reading order, drops rotated status-bar sweep items',()=>{
 const screen={width:402,height:874,orientation:'portrait'};
 const tree={role:'AXApplication',frame:{x:0,y:0,width:402,height:874},children:[
  {role:'AXGroup',frame:{x:0,y:0,width:402,height:874},children:[
   {role:'AXButton',label:'Continue',frame:{x:150,y:600,width:100,height:44}},
   {role:'AXStaticText',label:'Welcome',frame:{x:20,y:100,width:200,height:30}},
   {role:'AXButton',label:'Hidden',hidden:true,frame:{x:0,y:0,width:10,height:10}},
   {role:'AXButton',label:'Offscreen',frame:{x:0,y:2000,width:10,height:10}},
   {role:'AXTextField',identifier:'email',value:'a@example.test',frame:{x:20,y:300,width:360,height:44}},
   {role:'AXGenericElement',label:'Dynamic Island',frame:{x:138,y:14,width:125,height:37}},
  ]}]};
 const {elements}=G.compactTree(tree,screen);
 assert.deepEqual(elements.map(e=>e.label||e.id),['Dynamic Island','Welcome','email','Continue']);
 assert.deepEqual(elements.find(e=>e.label==='Continue').center,[200,622]);
 const rotated=G.compactTree(tree,{...screen,orientation:'landscape-left'}).elements;
 assert.ok(!rotated.some(e=>e.label==='Dynamic Island'));
 assert.deepEqual(G.compactTree(tree,screen,{query:'cont'}).elements.map(e=>e.label),['Continue']);
});

test('element lookup prefers exact, then actionable, then reading order and nth',()=>{
 const els=[{role:'text',label:'Sign in to continue',center:[1,1]},{role:'button',label:'Sign in',center:[2,2]},{role:'button',label:'Sign in',center:[3,3]},{role:'text',label:'Sign in',center:[4,4]}];
 assert.deepEqual(G.findElement(els,{text:'sign in'}).element.center,[2,2]);
 assert.equal(G.findElement(els,{text:'sign in'}).matches,2);
 assert.deepEqual(G.findElement(els,{text:'sign in',nth:1}).element.center,[3,3]);
 assert.deepEqual(G.findElement(els,{text:'continue'}).element.center,[1,1]);
 assert.equal(G.findElement(els,{text:'nothing'}).element,null);
});

test('touch plans: double tap is two finger touches on one session, drag holds first, edges follow rotation, all in native points',()=>{
 const screen={width:402,height:874,orientation:'portrait'};
 const dbl=input.plan(screen,{kind:'tap',x:100,y:200,count:2}).map(s=>s.envelope.type);
 assert.deepEqual(dbl,['touch1-down','touch1-up','touch1-down','touch1-up']);
 const drag=input.plan(screen,{kind:'drag',from:[10,10],to:[100,100],hold:0.6});
 assert.equal(drag[0].envelope.type,'touch1-down');assert.equal(drag[0].waitMs,600);assert.equal(drag.at(-1).envelope.type,'touch1-up');
 assert.ok(drag.every(s=>s.envelope.width===402&&s.envelope.height===874));
 const ll={width:402,height:874,orientation:'landscape-left'};
 const tap=input.plan(ll,{kind:'tap',x:874,y:201})[0].envelope;
 assert.deepEqual([tap.x,tap.y],[201,0]);
 assert.equal(input.nativeEdgeOf(ll,'bottom'),'right');assert.equal(input.nativeEdgeOf({orientation:'landscape-right'},'bottom'),'left');
 assert.equal(input.nativeEdgeOf({orientation:'portrait-upside-down'},'bottom'),'top');
 const edge=input.plan(screen,{kind:'edge',edge:'bottom',view:{width:402,height:874}});
 assert.ok(edge.every(s=>s.envelope.edge==='bottom'));
 const pinch=input.plan(screen,{kind:'pinch',center:[200,400],from:60,to:240,duration:0.2}).map(s=>s.envelope.type);
 assert.equal(pinch[0],'touch2-down');assert.equal(pinch.at(-1),'touch2-up');
});

test('a rejected touch releases the finger and reports whether anything was delivered',async()=>{
 const sent=[];
 const session={send:async e=>{sent.push(e.type);return e.type==='touch1-move'?{ok:false,error:'screen target changed'}:{ok:true};}};
 const steps=input.plan({width:402,height:874,orientation:'portrait'},{kind:'drag',from:[10,10],to:[50,50],hold:0,duration:0.05});
 await assert.rejects(input.perform(session,steps),e=>e.code==='INPUT_FAILED'&&e.execution==='unknown');
 assert.deepEqual(sent.slice(0,3),['touch1-down','touch1-move','touch1-up']);
});

function fakeApps({installed,changed=0,platforms=['iPhoneSimulator']}){
 let copiedFull=false;
 const calls=[];
 const plists={'/build/Game.app':{CFBundleSupportedPlatforms:platforms,CFBundleIdentifier:'com.example.game',CFBundleExecutable:'Game',CFBundleShortVersionString:'1.0',CFBundleVersion:'7'},
  '/sim/Game.app':installed&&{CFBundleSupportedPlatforms:platforms,CFBundleIdentifier:'com.example.game',CFBundleExecutable:'Game',CFBundleShortVersionString:'1.0',CFBundleVersion:installed.build||'7'}};
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'apps-'));
 for(const [dir,content] of [['build','new'],['sim',installed?.same?'new':'old']]){fs.mkdirSync(path.join(tmp,dir,'Game.app'),{recursive:true});fs.writeFileSync(path.join(tmp,dir,'Game.app','Game'),content);}
 const real=p=>p.replace(/^\/(build|sim)/,m=>path.join(tmp,m.slice(1)));
 class Failure extends Error{constructor(c,m,e){super(m);this.code=c;this.execution=e;}}
 const run=async(file,args)=>{calls.push([path.basename(file),...args]);
  if(file.endsWith('plutil')){const app=path.dirname(args.at(-1));const key=Object.keys(plists).find(k=>fs.realpathSync(real(k))===fs.realpathSync(app));return {stdout:JSON.stringify(plists[key])};}
  if(file.endsWith('rsync'))return {stdout:args.includes('--dry-run')&&!copiedFull?Array.from({length:changed},(_,i)=>`>f.st.... f${i}`).join('\n'):''};
  return {stdout:''};};
 const sim=async args=>{calls.push(['simctl',...args]);if(args[0]==='install'){copiedFull=true;installed={same:true};plists['/sim/Game.app']=plists['/build/Game.app'];fs.copyFileSync(real('/build/Game.app/Game'),real('/sim/Game.app/Game'));}if(args[0]==='get_app_container'){if(!installed)throw new Failure('COMMAND_FAILED','An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=2):\nNo such file or directory');return {stdout:fs.realpathSync(real('/sim/Game.app'))};}return {stdout:''};};
 const apps=require(path.join(node,'apps.cjs')).createApps({sim,run,Failure});
 return {apps,calls,app:real('/build/Game.app')};
}

test('install skips an identical build, syncs a few changed files, installs whole otherwise',async()=>{
 const device={udid:'00000000-0000-4000-8000-000000000001'},terminate=async()=>{};
 let f=fakeApps({installed:{same:true}});
 assert.equal((await f.apps.install(device,{appPath:f.app},{terminate})).mode,'unchanged');
 assert.ok(!f.calls.some(c=>c[0]==='simctl'&&c[1]==='install'));
 f=fakeApps({installed:{same:false},changed:3});
 const synced=await f.apps.install(device,{appPath:f.app},{terminate:async()=>{}}).catch(e=>e);
 // The fake rsync does not copy, so the synced executable cannot match: that must fail loudly, not pass.
 assert.equal(synced.code,'INSTALL_UNVERIFIED');
 assert.ok(f.calls.some(c=>c[0]==='rsync'&&!c.includes('--dry-run')));
 f=fakeApps({installed:{same:false},changed:5000});
 assert.equal((await f.apps.install(device,{appPath:f.app},{terminate})).mode,'full');
 assert.ok(f.calls.some(c=>c[0]==='simctl'&&c[1]==='install'));
 f=fakeApps({installed:null});
 assert.equal((await f.apps.install(device,{appPath:f.app},{terminate})).mode,'full');
 f=fakeApps({installed:{same:false,build:'6'}});
 const info=await f.apps.info(device,{appPath:f.app});
 assert.equal(info.matchesLocal,false);assert.equal(info.build,'6');assert.equal(info.local.build,'7');
});

test('grouped tools route to worker operations; one device busy does not block another',async()=>{
 const {createRuntime}=require(path.join(node,'runtime.cjs'));
 const seen=[];let release;const gate=new Promise(r=>release=r);
 const dispatch=async(method,params)=>{seen.push([method,params.udid]);if(method==='devices')return {devices:[]};if(method==='tap'&&params.udid==='A')await gate;return {ok:true};};
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rt-')),'settings.json');
 const rt=createRuntime({dispatch,settingsFile:file});
 await rt.request('device',{action:'boot',udid:'A'});
 await rt.request('viewer',{action:'close'});
 await rt.request('app',{action:'terminate',udid:'A',bundleId:'com.example.a'});
 assert.deepEqual(seen.map(s=>s[0]),['boot','close_viewer','app_terminate']);
 await assert.rejects(rt.request('device',{action:'explode'}),e=>e.code==='INVALID_ARGUMENT');
 const slow=rt.request('tap',{udid:'A',x:1,y:1});
 await assert.rejects(rt.request('tap',{udid:'A',x:1,y:1}),e=>e.code==='BUSY');
 assert.deepEqual(await rt.request('tap',{udid:'B',x:1,y:1}),{ok:true});
 // Reading never waits for input on the same device.
 assert.deepEqual(await rt.request('describe_ui',{udid:'A'}),{ok:true});
 release();await slow;
});

test('iPhone Duo unfolded: SpringBoard frames are turned a quarter, app frames are not (measured on iOS 27.1)',()=>{
 const screen={width:669,height:951,orientation:'landscape-left',target:{litPanel:'secondary'}};
 // SpringBoard: blank root label, frames past the native width. The Settings icon is at the top centre on screen.
 const springboard={role:'AXApplication',label:' ',frame:{x:0,y:485,width:678,height:466},children:[
  {role:'AXButton',label:'Settings',frame:{x:376.33,y:812.33,width:64,height:86.67}},
  {role:'AXButton',label:'Battery',frame:{x:730.25,y:714.33,width:162,height:184.67}}]};
 assert.equal(G.axTurned(springboard,screen),true);
 const icon=G.compactTree(springboard,screen).elements.find(e=>e.label==='Settings');
 assert.deepEqual(icon.frame.map(Math.round),[511,52,64,87]);
 // Safari: a normal app root; its back button is at the top left on screen.
 const safari={role:'AXApplication',label:'Safari',frame:{x:0,y:282,width:951,height:669},children:[{role:'AXButton',label:'Back',frame:{x:26,y:891,width:44,height:44}}]};
 assert.equal(G.axTurned(safari,screen),false);
 assert.deepEqual(G.compactTree(safari,screen).elements[0].frame,[16,26,44,44]);
 // Hit tests address the same turned space.
 assert.deepEqual(G.nativeToAx(screen,90,410,true),{x:410,y:861});
 assert.equal(G.axTurned(springboard,{...screen,target:{litPanel:'primary'}}),false);
});

// Replay of a game task: models wrote "shift+T", "t" and "cmd+A"; only W3C codes were accepted and the error named none.
test('keys accept what models write and name the accepted forms when one is unknown',()=>{
 const {parseKey,typeable}=require(path.join(node,'keys.cjs'));
 assert.deepEqual(parseKey('t'),{code:'KeyT',modifiers:[]});
 assert.deepEqual(parseKey('T'),{code:'KeyT',modifiers:['shift']});
 assert.deepEqual(parseKey('shift+T'),{code:'KeyT',modifiers:['shift']});
 assert.deepEqual(parseKey('cmd+A'),{code:'KeyA',modifiers:['command']});
 assert.deepEqual(parseKey('Ctrl+Space'),{code:'Space',modifiers:['control']});
 assert.deepEqual(parseKey('esc'),{code:'Escape',modifiers:[]});
 assert.deepEqual(parseKey('return'),{code:'Enter',modifiers:[]});
 assert.deepEqual(parseKey('up'),{code:'ArrowUp',modifiers:[]});
 assert.deepEqual(parseKey('KeyA'),{code:'KeyA',modifiers:[]});
 assert.deepEqual(parseKey('?'),{code:'Slash',modifiers:['shift']});
 assert.equal(parseKey('cmd++').code,'Equal');assert.deepEqual(parseKey('cmd++').modifiers.sort(),['command','shift']);
 assert.throws(()=>parseKey('F13'),e=>e.code==='INVALID_ARGUMENT'&&/cmd\+a/.test(e.message));
 assert.throws(()=>parseKey('hyper+a'),e=>e.code==='INVALID_ARGUMENT'&&/cmd, ctrl, option or shift/.test(e.message));
 assert.equal(typeable('Test Hero 2\n'),true);assert.equal(typeable('王五'),false);
});

// Minimal PNG writer using every row filter, so the decoder is checked against real encodings.
function png(width,height,pixel){
 const zlib=require('node:zlib'),rows=[];
 for(let y=0;y<height;y++){
  const filter=y%5,line=Buffer.alloc(width*4),prev=Buffer.alloc(width*4),out=Buffer.alloc(width*4);
  for(let x=0;x<width;x++){line.set(pixel(x,y),x*4);if(y)prev.set(pixel(x,y-1),x*4);}
  for(let i=0;i<line.length;i++){
   const a=i>=4?line[i-4]:0,b=y?prev[i]:0,c=y&&i>=4?prev[i-4]:0;
   const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
   out[i]=(line[i]-[0,a,b,(a+b)>>1,pa<=pb&&pa<=pc?a:pb<=pc?b:c][filter])&0xff;
  }
  rows.push(Buffer.from([filter]),out);
 }
 const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);return Buffer.concat([len,Buffer.from(type,'latin1'),data,Buffer.alloc(4)]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
}

// A game menu animates about 5 % of its pixels every frame, so "no byte changed" never came (60 s timeout in the replay).
test('frames decode, small animation stays under a tolerance, a launch frame of one colour reads as blank',()=>{
 const P=require(path.join(node,'pixels.cjs'));
 const scene=t=>(x,y)=>[(x*7+y*3)%256,(x*y)%256,y<4&&x<4?(t*90)%256:(x+y)%256,255];
 const a=P.decodePng(png(20,20,scene(0))),b=P.decodePng(png(20,20,scene(1)));
 assert.deepEqual(Array.from(a.data.subarray(0,4)),[0,0,90*0,255]);
 assert.deepEqual(Array.from(a.data.subarray((19*20+19)*4,(19*20+19)*4+4)),[(19*7+19*3)%256,(19*19)%256,38,255]);
 assert.equal(P.changedShare(a,b),16/400);
 assert.equal(P.changedShare(a,b,{x:10,y:10,width:10,height:10}),0);
 assert.equal(P.isBlank(P.decodePng(png(20,20,()=>[0,0,0,255]))),true);
 assert.equal(P.isBlank(a),false);
 assert.equal(P.decodePng(Buffer.from('not a png')),null);
});

function fakeAgent(){
 const state={orientation:'portrait',t:0,inputs:[]};
 const screen=()=>({width:402,height:874,orientation:state.orientation,target:{litPanel:'primary',pixelSize:{width:1206,height:2622},screenId:1}});
 class Failure extends Error{constructor(c,m,e){super(m);this.code=c;this.execution=e;}}
 const run=async(file,args)=>{
  if(args[0]==='describe-ui')return {stdout:JSON.stringify({role:'AXApplication',frame:{x:0,y:0,width:402,height:874},screen:screen(),children:[{role:'AXButton',label:'OK',frame:{x:100,y:100,width:50,height:40}}]})};
  if(args[0]==='input'){const pin=JSON.parse(args[args.indexOf('--expected-screen')+1]);if(pin.orientation!==state.orientation)throw new Failure('COMMAND_FAILED','display bind failed: changed');return {stdout:''};}
  return {stdout:''};
 };
 // An input session: pinned to a screen that no longer matches, Baguette exits before reading anything.
 const spawnImpl=(file,args)=>{
  const {EventEmitter}=require('node:events');const child=new EventEmitter();
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  const pin=JSON.parse(args[args.indexOf('--expected-screen')+1]);
  const stale=pin.orientation!==state.orientation;
  child.stdin={on(){},end(){},write(line){
   if(stale){setImmediate(()=>{child.stderr.emit('data','[baguette] display bind failed: changed\n');child.emit('exit',1);});return;}
   state.inputs.push(JSON.parse(line));setImmediate(()=>child.stdout.emit('data','{"ok":true}\n'));}};
  child.kill=()=>{};return child;
 };
 const agent=require(path.join(node,'agent.cjs')).createAgent({binary:'/bag',deviceSet:'/set',root:os.tmpdir(),run,sim:run,Failure,spawnImpl,now:()=>state.t});
 return {agent,state,device:{udid:'00000000-0000-4000-8000-000000000001'}};
}

test('coordinates are pinned to the screen they were read on; a turned screen is refused, never tapped elsewhere',async()=>{
 const {agent,state,device}=fakeAgent();
 await agent.describe(device,{});
 await agent.tap(device,{x:120,y:120,observe:'none'});
 assert.equal(state.inputs.length,1);
 // Turned within the cache window: Baguette refuses the pinned session, nothing is sent.
 state.orientation='landscape-left';
 await assert.rejects(agent.tap(device,{x:120,y:120,observe:'none'}),e=>e.code==='SCREEN_CHANGED'&&e.execution==='not_executed');
 // Later, the turned screen is detected first and the model is asked to look again.
 state.t+=60000;
 await assert.rejects(agent.tap(device,{x:120,y:120,observe:'none'}),e=>e.code==='SCREEN_CHANGED'&&/874×402 landscape-left/.test(e.message));
 assert.equal(state.inputs.length,1);
 // After looking at the new screen, the same point is accepted.
 await agent.describe(device,{});
 await agent.tap(device,{x:120,y:120,observe:'none'});
 assert.equal(state.inputs.length,2);
});

// Replay: models guessed settle=2–3 s after each tap and then took a screenshot to see whether the page changed.
test('tap until returns as soon as the expected text is on screen, without a fixed settle or a screenshot',async()=>{
 const {agent,state,device}=fakeAgent();
 const started=Date.now();
 const result=await agent.tap(device,{x:120,y:120,until:'OK'});
 assert.equal(result.until.met,true);assert.equal(result.until.element.label,'OK');
 assert.equal(result.ui,undefined);assert.equal(result.screenshot,undefined);
 assert.ok(Date.now()-started<500);assert.equal(state.inputs.length,1);
});

// Regression: a shadowed variable made every log line fail to parse, so `logs` always returned 0 lines.
test('logs returns the app lines, without colour codes, and match sees subsystem and category',async()=>{
 class Failure extends Error{constructor(c,m,e){super(m);this.code=c;this.execution=e;}}
 const entries=[{timestamp:'2026-10-22 03:00:00.123456+0800',messageType:'Error',subsystem:'com.facebook.react.log',category:'native',eventMessage:'\u001b[31mUnable to resolve module\u001b[0m x'},
  {timestamp:'2026-10-22 03:00:01.000000+0800',messageType:'Default',subsystem:'com.apple.CFBundle',category:'',eventMessage:'loaded'}];
 const sim=async args=>{
  if(args[0]==='get_app_container')return {stdout:'/apps/Cindy.app'};
  if(args.includes('show'))return {stdout:'getpwuid_r did not find a match for uid 501\n'+entries.map(e=>JSON.stringify(e)).join('\n')};
  return {stdout:''};
 };
 const run=async(file)=>file.endsWith('plutil')?{stdout:'Cindy'}:{stdout:''};
 const agent=require(path.join(node,'agent.cjs')).createAgent({binary:'/bag',deviceSet:'/set',root:os.tmpdir(),run,sim,Failure});
 const device={udid:'00000000-0000-4000-8000-000000000001'};
 const all=await agent.logs(device,{bundleId:'com.xd.cindy',crashes:false});
 assert.equal(all.total,2);assert.equal(all.process,'Cindy');
 assert.equal(all.level,'default');assert.ok(all.lines.some(line=>line.includes('loaded')),'iOS default retains ordinary Default messages');
 assert.ok(!all.lines[0].includes('\u001b'));assert.match(all.lines[0],/\[error\] com\.facebook\.react\.log\/native: Unable to resolve module x/);
 assert.equal((await agent.logs(device,{bundleId:'com.xd.cindy',crashes:false,match:'react\\.log'})).total,1);
});

test('install rejects a wrong simulator platform before mutation and fully installs compatible iPad apps on Vision Pro',async()=>{
 const f=fakeApps({installed:null});
 await assert.rejects(f.apps.install({udid:'test-device',runtime:'tvOS-27-0'},{appPath:f.app},{terminate:async()=>{throw Error('must not terminate');}}),e=>e.code==='APP_PLATFORM_MISMATCH');
 assert.ok(!f.calls.some(c=>c[0]==='simctl'&&c[1]==='install'));
 const compatible=fakeApps({installed:{same:true}});
 assert.equal((await compatible.apps.install({udid:'test-device',runtime:'xrOS-27-0'},{appPath:compatible.app},{terminate:async()=>{}})).mode,'full');
});
