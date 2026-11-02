'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const L=require('../../baguette-simulator/node/live-screen.cjs');
const {createTaskBindings}=require('../../baguette-simulator/node/tasks.cjs');
const ghost=require('../../baguette-simulator/ghost.json');

const PHONE='00000000-0000-4000-8000-0000000000A1',PAD='00000000-0000-4000-8000-0000000000A2',TV='00000000-0000-4000-8000-0000000000A3',
  VISION='00000000-0000-4000-8000-0000000000A4',DROID='00000000-0000-4000-8000-0000000000A5';
// avcC records from native/android-encoder (VideoToolbox), as Baguette sends them.
const AVCC={'1178x2556':'01640033ffe1001727640033ac1314100128050792e6a0404040f08042108001000428ee3cb0fdf8f800',
  '1080x2400':'01640033ffe1001627640033ac131411011004b7979a81010103c201084601000428ee3cb0fdf8f800',
  '2400x1080':'01640033ffe1001627640033ac13141100960227e59a81010103c201084601000428ee3cb0fdf8f800',
  '1920x1080':'0164002affe100152764002aac1314501e0089f966a0404040f080425801000428ee3cb0fdf8f800',
  '1206x2622':'01640033ffe1001627640033ac13143c04c0149e6a9a81010103c20108f801000428ee3cb0fdf8f800'};
const envelope=(type,bytes)=>Buffer.concat([Buffer.from([type]),Buffer.from(bytes)]);
const avcc=size=>envelope(1,Buffer.from(AVCC[size],'hex'));
const until=async(check,ms=2000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timed out');await new Promise(r=>setTimeout(r,5));}};
const list=()=>[
  {udid:PHONE,name:'iPhone 18 Pro',state:'Booted',runtime:'com.apple.CoreSimulator.SimRuntime.iOS-27-0',deviceType:'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro',platform:'ios'},
  {udid:PAD,name:'iPad Pro',state:'Booting',runtime:'com.apple.CoreSimulator.SimRuntime.iOS-27-0',deviceType:'com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5',platform:'ios'},
  {udid:TV,name:'Apple TV 4K','state':'Booted',runtime:'com.apple.CoreSimulator.SimRuntime.tvOS-27-0',deviceType:'com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation-4K',platform:'ios'},
  {udid:VISION,name:'Apple Vision Pro',state:'Shutdown',runtime:'com.apple.CoreSimulator.SimRuntime.xrOS-27-0',deviceType:'com.apple.CoreSimulator.SimDeviceType.Apple-Vision-Pro',platform:'ios'},
  {udid:DROID,name:'Android Phone',state:'Booted',runtime:'android:android-36:google_apis:arm64-v8a',deviceType:'android:phone',platform:'android'},
];
class FakeSocket{
  static all=[];
  constructor(url){this.url=url;this.sent=[];this.readyState=0;FakeSocket.all.push(this);setImmediate(()=>{this.readyState=1;this.onopen?.();});}
  send(text){this.sent.push(JSON.parse(text));}
  close(){if(this.readyState===3)return;this.readyState=3;this.onclose?.();}
  binary(buffer){this.onmessage?.({data:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.length)});}
  text(value){this.onmessage?.({data:JSON.stringify(value)});}
  // Baguette: an avcC on connect, then answers the orientation probe.
  answer(orientation){const probe=this.sent.find(m=>m.type==='describe_ui');if(probe)this.text({type:'describe_ui_result',ok:true,tree:{screen:{orientation}}});}
}
function fixture(t,{enabled=true,orientation='portrait',size='1178x2556',devices=list(),tasks=null,request=null}={}){
  const calls=[],touches=[],sendTouch=[];let on=enabled,offset=0;
  const state={enabled:()=>on,set:v=>{on=v;}};
  const runtime={
    assertEnabled:async()=>{if(!on)throw Object.assign(Error('paused'),{code:'RUNTIME_DISABLED'});},
    touch:()=>touches.push(Date.now()),
    request:async(method,params)=>{calls.push([method,params]);return request?request(method,params):{execution:'executed'};},
    exclusive:async(fn,key)=>{calls.push(['exclusive',key]);return fn();},
  };
  const agent={press:async(d,p)=>{calls.push(['android.press',p.button]);return {execution:'executed'};},typeText:async(d,p)=>{calls.push(['android.type',p]);return {execution:'executed'};},release:async()=>{calls.push(['android.release']);}};
  const model={width:1080,height:2400};
  let sink=null,control=null,streamed=null;
  const live=L.createLiveScreen({devices:async()=>devices,tasks,controls:()=>runtime,appleBase:async()=>'http://127.0.0.1:9',appleHost:true,now:()=>Date.now()+offset,
    android:()=>({devices:{target:async()=>({udid:DROID,model,endpoint:{port:1}})},agent}),
    serve:({sink:s,control:c,res,signal})=>{sink=s;control=c;s.begin('application/x-cindy-android-avcc');return new Promise(resolve=>{streamed=resolve;signal.addEventListener('abort',resolve,{once:true});});},
    rpc:async(endpoint,method,body)=>{sendTouch.push(body.touches);return {};},
    WebSocket:class extends FakeSocket{constructor(url){super(url);setImmediate(()=>{this.binary(avcc(size));this.answer(orientation);});}}});
  t.after(()=>live.stop());
  return {live,calls,touches,sendTouch,state,sink:()=>sink,control:()=>control,end:()=>streamed?.(),advance:ms=>{offset+=ms;}};
}
// Reads [u32 length][message] off the frame URL.
function fetchStream(url){
  return new Promise((resolve,reject)=>{
    const request=http.get(url,res=>{
      const chunks=[];let ended=false;
      res.on('data',c=>chunks.push(c));res.on('end',()=>{ended=true;});res.on('close',()=>{ended=true;});
      resolve({status:res.statusCode,headers:res.headers,ended:()=>ended,close:()=>request.destroy(),messages(){
        const all=Buffer.concat(chunks),out=[];for(let i=0;i+4<=all.length;){const n=all.readUInt32BE(i);if(i+4+n>all.length)break;out.push(all.subarray(i+4,i+4+n));i+=4+n;}return out;}});
    });
    request.on('error',reject);
  });
}
const screenOf=m=>m[0]===0x10?JSON.parse(m.subarray(1).toString('utf8')):null;
const code=async(promise,expected)=>{await assert.rejects(promise,e=>{assert.equal(e.code,expected,e.message);return true;});};

test('the manifest declares liveScreen with a node worker and keeps every liveScreen method out of Agent tools',()=>{
  assert.equal(ghost.liveScreen,true);assert.equal(ghost.node.entry,'node/worker.cjs');
  assert.ok(ghost.tools.every(t=>!/liveScreen/i.test(t.name)));
});

test('list returns this plugin’s devices with platform, state and bound tasks, without activity or boots',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'live-tasks-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const tasks=createTaskBindings(path.join(dir,'task-bindings.json'));
  await tasks.bind('task-old',PHONE,1000);await tasks.bind('task-new',PHONE.toLowerCase(),2000);await tasks.bind('task-droid',DROID,1500);
  const f=fixture(t,{tasks});
  const {screens}=await f.live.request('liveScreen.list',{_locale:'en'});
  assert.deepEqual(screens,[
    {id:PHONE,name:'iPhone 18 Pro',platform:'ios',state:'running',taskIds:['task-new','task-old']},
    {id:PAD,name:'iPad Pro',platform:'ipados',state:'starting',taskIds:[]},
    {id:TV,name:'Apple TV 4K',platform:'tvos',state:'running',taskIds:[]},
    {id:VISION,name:'Apple Vision Pro',platform:'visionos',state:'off',taskIds:[]},
    {id:DROID,name:'Android Phone',platform:'android',state:'running',taskIds:['task-droid']},
  ]);
  assert.deepEqual(f.calls,[],'no device operation');assert.equal(f.touches.length,0,'listing never renews activity');
  assert.equal(await tasks.latestForDevice(PHONE),'task-new','existing lookup keeps its answer');
  for(let i=0;i<40;i++)await tasks.bind('t'+i,PHONE,3000+i);
  assert.equal((await tasks.forDevice(PHONE,32)).length,32);
});

test('open returns a loopback URL with a 32-byte one-time token and the iPhone descriptor',async t=>{
  const f=fixture(t);
  const opened=await f.live.request('liveScreen.open',{id:PHONE,_locale:'zh-CN'});
  assert.match(opened.url,/^http:\/\/127\.0\.0\.1:\d+\/live-screen\/[0-9a-f]{64}$/);
  assert.deepEqual(opened.screen,{platform:'ios',width:1178,height:2556,cornerRadius:0.13,maxTouches:2,keyboard:true,buttons:[
    {id:'home',icon:'home',label:'主屏幕'},{id:'app-switcher',icon:'recents',label:'App 切换器'},{id:'lock',icon:'lock',label:'锁定'},
    {id:'volume-up',icon:'volume-up',label:'调高音量'},{id:'volume-down',icon:'volume-down',label:'调低音量'},
    {id:'rotate-left',icon:'rotate-left',label:'向左旋转'},{id:'rotate-right',icon:'rotate-right',label:'向右旋转'},{id:'shake',icon:'shake',label:'摇一摇'},
    {id:'orientation-portrait',icon:'rotate-right',label:'竖屏'},{id:'orientation-landscape',icon:'rotate-left',label:'横屏'}]});
  const ws=FakeSocket.all.at(-1);
  assert.equal(ws.url,`ws://127.0.0.1:9/simulators/${PHONE}/stream?format=avcc&version=v2&display=phone`);
  assert.deepEqual(ws.sent.slice(0,2),[{type:'set_fps',fps:60},{type:'force_idr'}]);
  assert.ok(f.touches.length>0,'opening is activity');
  const first=await fetchStream(opened.url);t.after(()=>first.close());
  assert.equal(first.status,200);assert.equal(first.headers['content-type'],'application/x-cindy-live-screen');
  const again=await fetchStream(opened.url);assert.equal(again.status,404,'the token accepts exactly one GET');
  assert.equal(f.live.viewing(),true,'an open stream is a viewer');
  // A second open for the same device ends the first stream and its token.
  const next=await f.live.request('liveScreen.open',{id:PHONE.toLowerCase()});
  await until(()=>first.ended());assert.equal(ws.readyState,3,'the previous device socket closes');
  assert.notEqual(next.url,opened.url);
  const second=await fetchStream(next.url);t.after(()=>second.close());assert.equal(second.status,200);
  assert.deepEqual(await f.live.request('liveScreen.close',{id:PHONE}),{closed:true});
  await until(()=>second.ended());assert.equal(f.live.viewing(),false);
  assert.equal((await fetchStream(next.url)).status,404);
  assert.deepEqual(await f.live.request('liveScreen.close',{id:PHONE}),{closed:false});
});

test('an unfetched URL expires, and the frame server only answers GET for the exact loopback host',async t=>{
  const f=fixture(t);
  const opened=await f.live.request('liveScreen.open',{id:PHONE});
  const url=new URL(opened.url);
  const status=(options)=>new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port:url.port,path:url.pathname,...options},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});
  assert.equal(await status({method:'POST'}),404);
  assert.equal(await status({method:'GET',headers:{host:'localhost:'+url.port}}),404,'DNS-rebound hosts are refused');
  assert.equal(await status({method:'GET',path:url.pathname+'0'}),404);
  f.advance(31000);f.live.sweep();
  assert.equal(await status({method:'GET'}),404,'not fetched within 30 s');
});

test('the stream sends screen JSON before the first frame, starts on a keyframe and follows orientation',async t=>{
  const f=fixture(t,{orientation:'landscape-left'});
  const opened=await f.live.request('liveScreen.open',{id:PHONE});
  const ws=FakeSocket.all.at(-1),stream=await fetchStream(opened.url);t.after(()=>stream.close());
  await until(()=>stream.messages().length>=2);
  assert.ok(ws.sent.filter(m=>m.type==='force_idr').length>=2,'a keyframe is requested for the new viewer');
  ws.binary(envelope(3,[9]));// A delta before the keyframe cannot be decoded.
  ws.binary(envelope(2,[1,2,3]));ws.binary(envelope(3,[4]));
  await until(()=>stream.messages().length>=4);
  const messages=stream.messages();
  assert.deepEqual(screenOf(messages[0]),{type:'screen',width:1178,height:2556,rotation:1});
  assert.deepEqual(messages.slice(1).map(m=>m[0]),[1,2,3]);
  assert.deepEqual([...messages[2]],[2,1,2,3],'frames are Baguette envelopes as is');
  // Frames are followed by one orientation probe once they pause; a still screen sends nothing and is not probed.
  const probes=()=>ws.sent.filter(m=>m.type==='describe_ui').length,initial=probes();
  await until(()=>probes()>initial,2500);
  // A frame during the probe (a turn still moving) asks for one more as soon as it answers.
  ws.binary(envelope(3,[4]));await new Promise(r=>setTimeout(r,300));
  const during=probes();
  ws.text({type:'describe_ui_result',ok:true,tree:{screen:{orientation:'landscape-left'}}});
  assert.equal(probes(),during+1,'a change during a probe is probed again at once');
  ws.text({type:'describe_ui_result',ok:true,tree:{screen:{orientation:'landscape-left'}}});
  await until(()=>stream.messages().length>=5);
  const before=probes();
  await new Promise(r=>setTimeout(r,1200));assert.equal(probes(),before);assert.equal(stream.messages().length,5,'unchanged orientation sends nothing');
  ws.binary(envelope(3,[5]));await until(()=>probes()>before,2500);
  ws.text({type:'describe_ui_result',ok:true,tree:{screen:{orientation:'landscape-right'}}});
  ws.binary(envelope(3,[6]));
  await until(()=>stream.messages().length>=8);
  assert.deepEqual(screenOf(stream.messages()[6]),{type:'screen',width:1178,height:2556,rotation:3});
  ws.binary(avcc('1206x2622'));await until(()=>stream.messages().length>=10);
  assert.deepEqual(screenOf(stream.messages()[8]),{type:'screen',width:1206,height:2622,rotation:3},'a new picture size is announced first');
  ws.close();await until(()=>stream.ended());
  await code(f.live.request('liveScreen.input',{id:PHONE,events:[{kind:'release'}]}),'NOT_FOUND');
});

test('framing, picture sizes and backpressure helpers',()=>{
  assert.deepEqual([...L.message(0x10,Buffer.from('{}'))],[0,0,0,3,0x10,0x7b,0x7d]);
  for(const [size,hex] of Object.entries(AVCC)){const [width,height]=size.split('x').map(Number);assert.deepEqual(L.avccSize(Buffer.from(hex,'hex')),{width,height});}
  assert.equal(L.avccSize(Buffer.from('0164','hex')),null);
  const png=Buffer.alloc(24);png.writeUInt32BE(0x89504e47,0);png.write('IHDR',12,'latin1');png.writeUInt32BE(720,16);png.writeUInt32BE(1600,20);
  assert.deepEqual(L.pngSize(png),{width:720,height:1600});
  const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0,4,0,0,0xff,0xc0,0,11,8,0x0a,0x1c,0x04,0x9a,3,1,0x22,0]);
  assert.deepEqual(L.jpegSize(jpeg),{width:1178,height:2588});
});

test('input validation rejects the whole batch before anything is sent',async t=>{
  const f=fixture(t);await f.live.request('liveScreen.open',{id:PHONE});const ws=FakeSocket.all.at(-1),sent=ws.sent.length;
  const bad=[
    'x',[{kind:'tap'}],[{kind:'touch',touches:[]}],[{kind:'touch',touches:[{id:10,x:0,y:0,phase:'began'}]}],
    [{kind:'touch',touches:[{id:0,x:1.1,y:0,phase:'began'}]}],[{kind:'touch',touches:[{id:0,x:0,y:0,phase:'down'}]}],
    [{kind:'touch',touches:[{id:0,x:0,y:0,phase:'began'},{id:0,x:1,y:1,phase:'began'}]}],
    [{kind:'touch',touches:[{id:0,x:0,y:0,phase:'moved'}],edge:'bottom'}],[{kind:'touch',touches:[{id:0,x:0,y:0,phase:'began'}],edge:'middle'}],
    [{kind:'touch',touches:[{id:0,x:0,y:0,phase:'began',pressure:1}]}],
    [{kind:'press',button:'Home'}],[{kind:'press',button:'back'}],[{kind:'text',text:''}],[{kind:'text',text:'a'.repeat(4097)}],
    [{kind:'key',code:'KeyA',modifiers:['meta']}],[{kind:'key',code:'Key-A'}],[{kind:'key',code:'F13'}],[{kind:'release',all:true}],
    [{kind:'press',button:'home'},{kind:'touch',touches:[{id:0,x:0,y:0,phase:'began'}],edge:'up'}],
    Array.from({length:65},()=>({kind:'release'})),
  ];
  for(const events of bad)await code(f.live.request('liveScreen.input',{id:PHONE,events}),'INVALID_ARGUMENT');
  assert.equal(ws.sent.length,sent);assert.deepEqual(f.calls,[],'no operation ran');
  await code(f.live.request('liveScreen.input',{id:TV,events:[{kind:'release'}]}),'NOT_FOUND');
  await code(f.live.request('liveScreen.input',{id:'../x',events:[]}),'INVALID_ARGUMENT');
  await code(f.live.request('liveScreen.control',{id:PHONE,fps:0}),'INVALID_ARGUMENT');
  await code(f.live.request('liveScreen.control',{id:PHONE,fps:61}),'INVALID_ARGUMENT');
  await code(f.live.request('liveScreen.control',{id:PHONE,keyframe:'yes'}),'INVALID_ARGUMENT');
  await code(f.live.request('liveScreen.nope',{}),'UNKNOWN_METHOD');
});

test('iOS touches map from the upright picture back to native portrait for every rotation',()=>{
  const size={width:1000,height:2000};
  const expected={0:[100,400],1:[200,1800],2:[900,1600],3:[800,200]};
  const edges={0:'bottom',1:'right',2:'right',3:'top'};
  for(const rotation of [0,1,2,3]){
    const st={mode:null,ids:[],last:new Map(),edge:null};
    const [down]=L.appleTouches(st,{kind:'touch',touches:[{id:0,x:0.1,y:0.2,phase:'began'}],edge:'bottom'},size,rotation);
    assert.deepEqual([down.type,Math.round(down.x),Math.round(down.y),down.width,down.height,down.edge],['touch1-down',...expected[rotation],1000,2000,edges[rotation]],`rotation ${rotation}`);
    const [up]=L.appleTouches(st,{kind:'touch',touches:[{id:0,x:0.1,y:0.2,phase:'ended'}]},size,rotation);
    assert.equal(up.type,'touch1-up');assert.equal(up.edge,edges[rotation],'the stroke keeps its edge');
  }
  assert.equal(L.portraitEdge('left',1),'left','only the bottom edge moves, as in Baguette’s page');
  for(const r of [0,1,2,3])for(const [x,y] of [[0,0],[0.3,0.7],[1,1]]){
    // Rotating the portrait point by `r` clockwise quarter turns gives the upright point back.
    let p=L.toPortrait(x,y,r);for(let i=0;i<r;i++)p={x:1-p.y,y:p.x};
    assert.deepEqual([p.x,p.y].map(v=>Math.round(v*1e9)/1e9),[x,y]);
  }
});

test('iOS touch sequences become Baguette one- and two-finger envelopes',()=>{
  const size={width:100,height:200},st={mode:null,ids:[],last:new Map(),edge:null};
  const step=touches=>L.appleTouches(st,{kind:'touch',touches},size,0).map(e=>e.type);
  assert.deepEqual(step([{id:3,x:.1,y:.1,phase:'began'}]),['touch1-down']);
  assert.deepEqual(step([{id:3,x:.2,y:.1,phase:'moved'}]),['touch1-move']);
  assert.deepEqual(step([{id:3,x:.2,y:.1,phase:'stationary'}]),[]);
  assert.deepEqual(step([{id:3,x:.2,y:.1,phase:'moved'},{id:5,x:.8,y:.9,phase:'began'}]),['touch1-up','touch2-down'],'a second finger starts a pinch');
  assert.deepEqual(step([{id:3,x:.25,y:.1,phase:'moved'},{id:5,x:.8,y:.9,phase:'stationary'}]),['touch2-move']);
  assert.deepEqual(step([{id:3,x:.25,y:.1,phase:'moved'},{id:5,x:.8,y:.9,phase:'stationary'},{id:7,x:.5,y:.5,phase:'began'}]),['touch2-move'],'a third finger is ignored');
  assert.deepEqual(step([{id:3,x:.25,y:.1,phase:'ended'},{id:5,x:.8,y:.9,phase:'moved'},{id:7,x:.5,y:.5,phase:'moved'}]),['touch2-up']);
  assert.deepEqual(step([{id:5,x:.8,y:.9,phase:'moved'},{id:7,x:.5,y:.5,phase:'moved'}]),[],'remaining fingers wait until they lift');
  assert.deepEqual(step([{id:5,x:.8,y:.9,phase:'ended'},{id:7,x:.5,y:.5,phase:'ended'}]),[]);
  assert.deepEqual(step([{id:1,x:.1,y:.1,phase:'began'}]),['touch1-down']);
  assert.deepEqual(step([{id:1,x:.1,y:.1,phase:'ended'},{id:2,x:.9,y:.9,phase:'began'}]),['touch1-up','touch1-down'],'quick alternate taps stay single taps');
  assert.deepEqual(L.appleRelease(st,size).map(e=>e.type),['touch1-up']);assert.deepEqual(L.appleRelease(st,size),[]);
});

test('iOS input sends touches on the stream socket and buttons, text and keys through guarded operations',async t=>{
  const f=fixture(t,{orientation:'landscape-left'});await f.live.request('liveScreen.open',{id:PHONE});const ws=FakeSocket.all.at(-1);
  const result=await f.live.request('liveScreen.input',{id:PHONE,events:[
    {kind:'touch',touches:[{id:0,x:0.5,y:0.25,phase:'began'}]},{kind:'touch',touches:[{id:0,x:0.5,y:0.25,phase:'ended'}]},
    {kind:'press',button:'home'},{kind:'press',button:'rotate-right'},{kind:'press',button:'rotate-right'},
    {kind:'text',text:'你好'},{kind:'key',code:'KeyZ',modifiers:['command','shift']},{kind:'release'}]});
  assert.deepEqual(result,{execution:'executed',completed:8});
  const touches=ws.sent.filter(m=>/^touch/.test(m.type));
  assert.deepEqual(touches[0],{type:'touch1-down',x:0.25*1178,y:0.5*2556,width:1178,height:2556});
  assert.deepEqual(f.calls,[['press',{udid:PHONE,button:'home'}],['set_state',{udid:PHONE,orientation:'landscape-right'}],['set_state',{udid:PHONE,orientation:'portrait'}],
    ['type_text',{udid:PHONE,text:'你好',method:'paste'}],['type_text',{udid:PHONE,keys:['command+shift+KeyZ']}]],'rotation steps from the last request when the App does not turn, never upside down on an iPhone');
  const {parseKey}=require('../../baguette-simulator/node/keys.cjs');assert.deepEqual(parseKey('command+shift+KeyZ'),{code:'KeyZ',modifiers:['command','shift']});
  await code(f.live.request('liveScreen.input',{id:PHONE,events:[{kind:'press',button:'menu'}]}),'INVALID_ARGUMENT');
  // A failing later event keeps the completed prefix and reports unknown.
  const failing=fixture(t,{request:()=>{throw Object.assign(Error('busy'),{code:'BUSY',execution:'not_executed'});}});await failing.live.request('liveScreen.open',{id:PHONE});
  const error=await failing.live.request('liveScreen.input',{id:PHONE,events:[{kind:'touch',touches:[{id:0,x:0,y:0,phase:'began'}]},{kind:'press',button:'home'}]}).catch(e=>e);
  assert.equal(error.code,'BUSY');assert.equal(error.execution,'unknown');assert.equal(error.completed,1);
  const first=await failing.live.request('liveScreen.input',{id:PHONE,events:[{kind:'press',button:'lock'}]}).catch(e=>e);
  assert.equal(first.execution,'not_executed');assert.equal(first.completed,0);
  const refused=fixture(t,{request:()=>({ok:false,errorCode:'DEVICE_NOT_BOOTED',message:'Boot this device first',execution:'not_executed'})});await refused.live.request('liveScreen.open',{id:PHONE});
  await code(refused.live.request('liveScreen.input',{id:PHONE,events:[{kind:'press',button:'home'}]}),'DEVICE_NOT_BOOTED');
});

test('orientation buttons set an absolute pose, so later relative turns start from it',async t=>{
  const f=fixture(t);await f.live.request('liveScreen.open',{id:PHONE});
  await f.live.request('liveScreen.input',{id:PHONE,events:[{kind:'press',button:'orientation-landscape'},{kind:'press',button:'orientation-landscape'},
    {kind:'press',button:'rotate-right'},{kind:'press',button:'orientation-portrait'}]});
  assert.deepEqual(f.calls,[['set_state',{udid:PHONE,orientation:'landscape-left'}],['set_state',{udid:PHONE,orientation:'landscape-left'}],
    ['set_state',{udid:PHONE,orientation:'landscape-right'}],['set_state',{udid:PHONE,orientation:'portrait'}]]);
});

test('a requested turn the picture follows shows at once; one the App refuses does not',async t=>{
  const f=fixture(t);
  const opened=await f.live.request('liveScreen.open',{id:PHONE});
  const ws=FakeSocket.all.at(-1),stream=await fetchStream(opened.url);t.after(()=>stream.close());
  await until(()=>stream.messages().length>=1);
  const rotations=()=>stream.messages().filter(m=>m[0]===0x10).map(m=>screenOf(m).rotation);
  const probes=()=>ws.sent.filter(m=>m.type==='describe_ui').length,connected=probes();
  ws.binary(envelope(2,[1]));await until(()=>stream.messages().length>=2);
  // The pause after this frame sends a probe; it is still unanswered when the turn starts.
  await until(()=>probes()>connected,2500);
  const early=probes();
  // The App turns with the device: its frames follow the request, so the picture turns now.
  await f.live.request('liveScreen.input',{id:PHONE,events:[{kind:'press',button:'orientation-landscape'}]});
  // A keyframe (asked for by a resized viewer) and a handful of changes are not a turn yet.
  const before=rotations().length;
  ws.binary(envelope(2,[2]));for(let i=0;i<11;i++)ws.binary(envelope(3,[2]));
  await new Promise(r=>setTimeout(r,50));
  assert.equal(rotations().length,before);
  ws.binary(envelope(3,[2]));
  await until(()=>rotations().at(-1)===1);
  // A probe asked before the turn still reads portrait: it is ignored and asked again.
  ws.text({type:'describe_ui_result',ok:true,tree:{screen:{orientation:'portrait'}}});
  assert.equal(rotations().at(-1),1);
  assert.ok(probes()>early,'probed again after the turn');
  ws.text({type:'describe_ui_result',ok:true,tree:{screen:{orientation:'landscape-left'}}});
  assert.equal(rotations().at(-1),1);
  // The Home Screen refuses portrait-to-landscape: no frames follow, nothing turns.
  const shown=rotations().length;
  await f.live.request('liveScreen.input',{id:PHONE,events:[{kind:'press',button:'orientation-portrait'}]});
  f.advance(2000);for(let i=0;i<14;i++)ws.binary(envelope(3,[3]));
  await new Promise(r=>setTimeout(r,50));
  assert.equal(rotations().length,shown,'a frame long after the request does not turn the picture');
});

test('moves of a finger in one batch reach the device as the latest position only',async t=>{
  const f=fixture(t);await f.live.request('liveScreen.open',{id:PHONE});const ws=FakeSocket.all.at(-1);
  const at=(phase,x)=>({kind:'touch',touches:[{id:0,x,y:0.5,phase}]});
  const result=await f.live.request('liveScreen.input',{id:PHONE,events:[at('began',0.1),at('moved',0.2),at('moved',0.3),at('moved',0.4),at('moved',0.5),at('ended',0.5)]});
  assert.deepEqual(result,{execution:'executed',completed:6});
  const touches=ws.sent.filter(m=>/^touch/.test(m.type));
  assert.deepEqual(touches.map(m=>m.type),['touch1-down','touch1-move','touch1-up']);
  assert.equal(touches[1].x,0.5*1178,'the move carries the latest position');
});

test('a run of keys becomes one keyboard operation, up to 40 keys each',async t=>{
  const f=fixture(t);await f.live.request('liveScreen.open',{id:PHONE});
  const keys=Array.from({length:42},()=>({kind:'key',code:'KeyA'}));
  const result=await f.live.request('liveScreen.input',{id:PHONE,events:[{kind:'key',code:'KeyQ',modifiers:['shift']},...keys.slice(0,1),{kind:'press',button:'home'},...keys]});
  assert.deepEqual(result,{execution:'executed',completed:45});
  assert.deepEqual(f.calls.map(c=>[c[0],c[1].keys?.length??c[1].button]),[['type_text',2],['press','home'],['type_text',40],['type_text',2]]);
  assert.deepEqual(f.calls[0][1].keys,['shift+KeyQ','KeyA']);
});

test('Apple TV and Vision Pro forward H.264 without touches and offer their basic buttons',async t=>{
  const f=fixture(t,{size:'1920x1080'});
  const opened=await f.live.request('liveScreen.open',{id:TV,_locale:'en'});
  assert.equal(FakeSocket.all.at(-1).url,`ws://127.0.0.1:9/simulators/${TV}/stream?format=avcc&version=v2`);
  assert.deepEqual({...opened.screen,buttons:opened.screen.buttons.map(b=>b.id)},{platform:'tvos',width:1920,height:1080,cornerRadius:0,maxTouches:0,keyboard:false,buttons:['home','menu','play-pause']});
  await code(f.live.request('liveScreen.input',{id:TV,events:[{kind:'touch',touches:[{id:0,x:0,y:0,phase:'began'}]}]}),'UNSUPPORTED');
  await code(f.live.request('liveScreen.input',{id:TV,events:[{kind:'text',text:'a'}]}),'UNSUPPORTED');
  await f.live.request('liveScreen.input',{id:TV,events:[{kind:'press',button:'menu'},{kind:'press',button:'play-pause'}]});
  assert.deepEqual(f.calls,[['press',{udid:TV,button:'menu'}],['press',{udid:TV,button:'play-pause'}]]);
  assert.equal(FakeSocket.all.at(-1).sent.filter(m=>m.type==='describe_ui').length,0,'TV has no interface rotation to probe');
  await code(f.live.request('liveScreen.open',{id:VISION}),'NOT_RUNNING');
  await code(f.live.request('liveScreen.open',{id:PAD}),'NOT_RUNNING');
  await code(f.live.request('liveScreen.open',{id:'00000000-0000-4000-8000-0000000000FF'}),'NOT_FOUND');
});

test('Apple devices are unsupported where Baguette cannot run',async t=>{
  const live=L.createLiveScreen({devices:async()=>list(),controls:()=>({assertEnabled:async()=>{},touch(){}}),appleHost:false,WebSocket:FakeSocket});t.after(()=>live.stop());
  await code(live.request('liveScreen.open',{id:PHONE}),'UNSUPPORTED');
});

test('Android streams the shared encoder output in the same framing with screen JSON on every size change',async t=>{
  const f=fixture(t);
  const opened=await f.live.request('liveScreen.open',{id:DROID,_locale:'en'});
  assert.deepEqual({...opened.screen,buttons:opened.screen.buttons.map(b=>b.id)},{platform:'android',width:1080,height:2400,cornerRadius:0,maxTouches:10,keyboard:true,
    buttons:['back','home','recents','power','volume-up','volume-down','rotate-left','rotate-right','orientation-portrait','orientation-landscape']});
  const stream=await fetchStream(opened.url);t.after(()=>stream.close());
  await until(()=>f.sink());assert.equal(stream.status,200);assert.equal(stream.headers['content-type'],'application/x-cindy-live-screen');
  const sink=f.sink();
  sink.frame({display:0,device:0,width:1080,height:2400},avcc('1080x2400'));sink.frame({display:0,device:0,width:1080,height:2400},envelope(2,[7]));
  sink.frame({display:1,device:1,width:2400,height:1080},avcc('2400x1080'));sink.frame({display:1,device:1,width:2400,height:1080},envelope(2,[8]));
  sink.frame({display:1,device:1,width:2400,height:1080},envelope(3,[9]));
  await until(()=>stream.messages().length>=7);
  const m=stream.messages();
  assert.deepEqual(m.map(x=>x[0]),[0x10,1,2,0x10,1,2,3]);
  assert.deepEqual([screenOf(m[0]),screenOf(m[3])],[{type:'screen',width:1080,height:2400,rotation:0},{type:'screen',width:2400,height:1080,rotation:0}],'the emulator turns its own picture');
  // Fallback PNG becomes a whole-image 0x06 message.
  const png=Buffer.alloc(24);png.writeUInt32BE(0x89504e47,0);png.write('IHDR',12,'latin1');png.writeUInt32BE(720,16);png.writeUInt32BE(1600,20);
  sink.frame({display:0,device:0,png:true},png);await until(()=>stream.messages().length>=9);
  assert.deepEqual(stream.messages().slice(7).map(x=>x[0]),[0x10,0x06]);assert.deepEqual(stream.messages()[8].subarray(1),png);
  // control: rate and keyframe reach the encoder pump.
  const control=f.control();let fps=null,keys=0;control.fps=n=>{fps=n;};control.keyframe=()=>{keys++;};
  await f.live.request('liveScreen.control',{id:DROID,fps:15,keyframe:true});assert.equal(fps,15);assert.equal(keys,1);
  f.end();await until(()=>stream.ended());
});

test('Android touches follow the device pose into native panel coordinates, up to ten fingers',async t=>{
  const f=fixture(t);const opened=await f.live.request('liveScreen.open',{id:DROID});
  const stream=await fetchStream(opened.url);t.after(()=>stream.close());await until(()=>f.sink());
  await f.live.request('liveScreen.input',{id:DROID,events:[{kind:'touch',touches:[{id:0,x:0.25,y:0.5,phase:'began'},{id:9,x:1,y:1,phase:'began'}]},{kind:'touch',touches:[{id:0,x:0.25,y:0.5,phase:'ended'},{id:9,x:1,y:1,phase:'cancelled'}]}]});
  assert.deepEqual(f.sendTouch[0],[{identifier:0,pressure:1024,x:270,y:1200},{identifier:9,pressure:1024,x:1079,y:2399}]);
  assert.deepEqual(f.sendTouch[1].map(t=>t.pressure),[0,0]);
  // Landscape (device rotation 1): a 2400×1080 picture.
  f.sink().frame({display:1,device:1,width:2400,height:1080},avcc('2400x1080'));
  await f.live.request('liveScreen.input',{id:DROID,events:[{kind:'touch',touches:[{id:1,x:0.25,y:0.5,phase:'began'}]}]});
  const {toNative}=require('../../baguette-simulator/node/android/geometry.cjs');
  assert.deepEqual(f.sendTouch[2],[{identifier:1,pressure:1024,...toNative({width:1080,height:2400},1,600,540)}]);
  assert.deepEqual(f.sendTouch[2][0],{identifier:1,pressure:1024,x:539,y:600});
  f.calls.length=0;
  await f.live.request('liveScreen.input',{id:DROID,events:[{kind:'press',button:'recents'},{kind:'press',button:'back'},{kind:'press',button:'rotate-right'},
    {kind:'text',text:'héllo'},{kind:'key',code:'KeyA',modifiers:['command']},{kind:'key',code:'Enter'},{kind:'release'}]});
  assert.deepEqual(f.calls.filter(c=>c[0]!=='exclusive'),[['android.press','app-switcher'],['android.press','back'],['set_state',{udid:DROID,orientation:'portrait'}],
    ['android.type',{text:'héllo',method:'paste',observe:'none'}],['android.type',{keys:'cmd+a',method:'paste',observe:'none'}],['android.type',{keys:'Enter',method:'paste',observe:'none'}],['android.release']]);
  assert.ok(f.calls.filter(c=>c[0]==='exclusive').every(c=>c[1]==='device:'+DROID),'each step holds the device lock');
  assert.equal(L.androidKey('Digit7',['shift']),'shift+7');assert.equal(L.androidKey('Space',[]),'space');assert.equal(L.androidKey('Slash',[]),'/');
  assert.throws(()=>L.androidKey('IntlRo',[]));
});

test('the run switch: DISABLED for open, input and control, and open streams close when turned off',async t=>{
  const f=fixture(t,{enabled:false});
  await code(f.live.request('liveScreen.open',{id:PHONE,_locale:'zh-CN'}),'DISABLED');
  f.state.set(true);
  const opened=await f.live.request('liveScreen.open',{id:PHONE});const stream=await fetchStream(opened.url);t.after(()=>stream.close());
  f.state.set(false);
  await code(f.live.request('liveScreen.input',{id:PHONE,events:[{kind:'release'}]}),'DISABLED');
  await code(f.live.request('liveScreen.control',{id:PHONE}),'DISABLED');
  assert.equal(FakeSocket.all.at(-1).sent.filter(m=>/^touch/.test(m.type)).length,0);
  f.live.sweep();await until(()=>stream.ended());assert.equal(f.live.viewing(),false);
  assert.ok((await f.live.request('liveScreen.list',{})).screens.length,'listing still works while paused');
});

test('control is the keepalive: activity, set_fps and keyframes; a silent viewer is dropped after a minute',async t=>{
  const f=fixture(t);const opened=await f.live.request('liveScreen.open',{id:PHONE});const ws=FakeSocket.all.at(-1);
  const stream=await fetchStream(opened.url);t.after(()=>stream.close());
  const before=f.touches.length;
  assert.deepEqual(await f.live.request('liveScreen.control',{id:PHONE,fps:2,keyframe:true}),{});
  assert.equal(f.touches.length,before+1);
  assert.deepEqual(ws.sent.slice(-2),[{type:'set_fps',fps:2},{type:'force_idr'}]);
  f.advance(59000);f.live.sweep();await new Promise(r=>setTimeout(r,20));assert.equal(stream.ended(),false);
  f.advance(2000);f.live.sweep();
  await until(()=>stream.ended());
});

test('a slow reader drops deltas, then resumes from a keyframe requested once the backlog drains; oversized messages are never sent',async t=>{
  const f=fixture(t);const opened=await f.live.request('liveScreen.open',{id:PHONE});const ws=FakeSocket.all.at(-1);
  const types=[];let paused=null,buffer=Buffer.alloc(0);
  const request=http.get(opened.url,res=>{paused=res;res.pause();res.on('data',c=>{buffer=Buffer.concat([buffer,c]);while(buffer.length>=5){const n=buffer.readUInt32BE(0);if(buffer.length<4+n)break;types.push(buffer[4]);buffer=buffer.subarray(4+n);}});});
  t.after(()=>request.destroy());
  await until(()=>paused);
  const keyframes=()=>ws.sent.filter(m=>m.type==='force_idr').length,start=keyframes();
  ws.binary(envelope(2,[1]));
  for(let i=0;i<24;i++)ws.binary(envelope(3,Buffer.alloc(1024*1024)));
  ws.binary(envelope(3,[2]));// After the backlog: not decodable any more.
  assert.equal(keyframes(),start,'no keyframe is requested while the backlog lasts');
  paused.resume();
  await until(()=>keyframes()>start,5000);
  ws.binary(envelope(3,[3]));ws.binary(envelope(2,[4]));ws.binary(envelope(3,[5]));
  await until(()=>types.length&&types.at(-1)===3&&types.filter(x=>x===2).length===2,5000);
  const sent=types.filter(x=>x===3).length;
  assert.ok(sent<24,`deltas were dropped (${sent} sent)`);
  assert.deepEqual(types.slice(-2),[2,3],'the stream resumes at the requested keyframe');
  const before=keyframes(),count=types.length;
  ws.binary(envelope(3,Buffer.alloc(8*1024*1024)));
  assert.equal(keyframes(),before+1,'an oversized frame asks for a new keyframe at once');
  ws.binary(envelope(3,[6]));ws.binary(envelope(2,[7]));
  await until(()=>types.length===count+1);assert.equal(types.at(-1),2);
});
