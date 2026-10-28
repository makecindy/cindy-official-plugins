const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const udid='00000000-0000-4000-8000-000000000001';

function harness({simctlFails=false,readFails=false,stale=false,owned=true,runtime='runtime',timers}={}) {
 const calls=[];let clipboard="";
 const context={module:{exports:{}},setTimeout:timers?fn=>{const timer={fn};timers.add(timer);return timer;}:setTimeout,clearTimeout:timers?t=>timers.delete(t):clearTimeout,__dirname:path.resolve('baguette-simulator/node'),process:{platform:'darwin',arch:'arm64'},require(name){
  if(name==='./viewer.cjs')return {};
  if(name==='./keys.cjs')return require('../../baguette-simulator/node/keys.cjs');
  if(name==='node:fs/promises')return {mkdir:async()=>{}};
  if(name==='node:child_process')return {execFile(file,args,options,callback){
   const call={file,args,options,input:undefined};calls.push(call);
   let output='',error=null;
   if(file==='/usr/bin/sw_vers')output='27.0';
   if(file==='/usr/bin/xcode-select')output='/Applications/Xcode.app/Contents/Developer';
   if(args.includes('--json'))output=JSON.stringify({devices:{[runtime]:owned?[{udid,state:'Booted'}]:[]}});
   if(args.includes('pbcopy')&&simctlFails)error=Error('unsupported command');
   queueMicrotask(()=>{
    if(args.includes('pbcopy')&&!error&&!stale)clipboard=call.input;
    if(args.includes('pbpaste')){output=clipboard;if(readFails)error=Error('read failed');}
    callback(error,output,'');
   });
   return {stdin:{on(){},end(input){call.input=input;}}};
  }};
  return require(name.startsWith('./')?path.resolve('baguette-simulator/node',name):name);
 }};
 vm.runInNewContext(fs.readFileSync(path.resolve('baguette-simulator/node/core.cjs'),'utf8'),context);
 return {calls,dispatch:context.module.exports.dispatch,clipboard:vm.runInContext('clipboardAction',context)};
}

test('viewer key input restores the soft-keyboard record after the last chord; touch paste does not',async()=>{
 const timers=new Set(),h=harness({timers,runtime:'com.apple.CoreSimulator.SimRuntime.iOS-27-0'});
 await h.clipboard({udid,action:'key',code:'KeyA'});
 const first=[...timers][0];assert.ok(first);
 await h.clipboard({udid,action:'key',code:'KeyB'});
 assert.equal(timers.size,1);assert.ok(!timers.has(first),'new input replaces the pending restoration');
 [...timers][0].fn();timers.clear();await new Promise(r=>setImmediate(r));
 const cleanup=h.calls.find(c=>c.args.includes('HardwareKeyboardLastSeen'));
 assert.ok(cleanup);assert.ok(cleanup.args.includes(udid));assert.ok(cleanup.args.includes('--set'));
 await h.clipboard({udid,action:'paste',text:'hello',touch:true});assert.equal(timers.size,0);
});

test('paste writes the private device set with simctl and keeps Unicode text out of command arguments',async()=>{
 // CoreDevice cannot see a private device set (devicectl: "device was not found"), so it is never tried.
 const h=harness();await h.dispatch('type_text',{udid,text:'你好 Duo 🥖',method:'paste'});
 assert.ok(!h.calls.some(c=>c.args[0]==='devicectl'));
 const write=h.calls.find(c=>c.args.includes('pbcopy'));
 assert.equal(write.args[0],'simctl');assert.equal(write.args[1],'--set');
 assert.ok(write.args[2].endsWith('/BaguetteCindy/devices'));
 assert.deepEqual(Array.from(write.args.slice(3)),['pbcopy',udid]);
 assert.equal(write.input,'你好 Duo 🥖');
 assert.equal(write.options.env.LC_ALL,'en_US.UTF-8');
 assert.ok(h.calls.at(-1).file.endsWith('/native/keyboard'));
 assert.ok(h.calls.every(c=>!c.args.includes('你好 Duo 🥖')));
});

test('failed clipboard writes never paste stale text, and foreign devices never mutate',async()=>{
 const h=harness({simctlFails:true});
 await assert.rejects(h.dispatch('type_text',{udid,text:'new',method:'paste'}),e=>e.execution==='unknown');
 // The only keyboard call is the existing key-release step, before any write.
 assert.equal(h.calls.filter(c=>c.file.endsWith('/native/keyboard')).length,1);
 const foreign=harness({owned:false});
 await assert.rejects(foreign.dispatch('type_text',{udid,text:'new',method:'paste'}),e=>e.code==='DEVICE_NOT_OWNED');
 assert.ok(!foreign.calls.some(c=>c.args[0]==='devicectl'||c.args.includes('pbcopy')||c.file.endsWith('/native/keyboard')));
});

for(const behavior of [{stale:true},{readFails:true}])test('an unconfirmed clipboard write never sends Command-V '+JSON.stringify(behavior),async()=>{
 const h=harness({...behavior});
 await assert.rejects(h.dispatch('type_text',{udid,text:'new',method:'paste'}),e=>e.code==='CLIPBOARD_UNVERIFIED'&&e.execution==='unknown');
 assert.equal(h.calls.filter(c=>c.file.endsWith('/native/keyboard')).length,1);
});
test('clipboard verification preserves leading/trailing whitespace and Unicode',async()=>{
 const h=harness();await h.dispatch('type_text',{udid,text:' 你好 🥖\n',method:'paste'});
 const read=h.calls.find(c=>c.args.includes('pbpaste'));
 assert.deepEqual(Array.from(read.args.slice(0,3)),Array.from(h.calls.find(c=>c.args.includes('pbcopy')).args.slice(0,3)));
 assert.ok(h.calls.at(-1).file.endsWith('/native/keyboard'));
});

test('input tri-state follows completed steps, preserving busy and preflight rejection before any input',async()=>{
 for(const mode of ['busy','first-preflight','expired','first-unknown','after-key','after-clipboard']){
  let release;const blocked=new Promise(resolve=>release=resolve);
  // run() uses the existing commandBudget helper; replace only the executor
  // through a fresh core VM so failures remain in the production input path.
  let keyboardCalls=0,queries=0,clipboard='',clock=0;
  const context={module:{exports:{}},__dirname:path.resolve('baguette-simulator/node'),setTimeout,clearTimeout,Date:{now:()=>clock},process:{platform:'darwin',arch:'arm64',env:{}},require(name){
   if(name==='./budget.cjs')return {commandBudget:(ms,deadline)=>require('../../baguette-simulator/node/budget.cjs').commandBudget(ms,deadline,()=>clock)};
   if(name==='./viewer.cjs')return {};
   if(name==='node:fs/promises')return {mkdir:async()=>{}};
   if(name==='node:child_process')return {execFile(file,args,_options,callback){
    let stdout='',error=null;
    if(file.endsWith('sw_vers'))stdout='27.0';
    else if(args.includes('--json')){queries++;stdout=JSON.stringify({devices:{r:[{udid,state:'Booted'}]}});if(mode==='expired')clock=110000;if((mode==='first-preflight'&&queries===2)||(mode==='after-key'&&queries===3))error=Error('device query failed');}
    else if(file.endsWith('xcode-select')){stdout='/Xcode';if(mode==='after-clipboard'&&clipboard)error=Error('xcode query failed');}
    else if(file.endsWith('/keyboard')){keyboardCalls++;if(mode==='first-unknown')error=Error('ack lost');}
    if(mode==='busy'&&file.endsWith('/keyboard')&&keyboardCalls===1)blocked.then(()=>callback(null,'',''));
    else queueMicrotask(()=>callback(error,args.includes('pbpaste')?clipboard:stdout,''));
    return {stdin:{on(){},end(text){if(args.includes('pbcopy'))clipboard=text;}}};
   }};
   return require(name.startsWith('./')?path.resolve('baguette-simulator/node',name):name);
  }};
  vm.runInNewContext(fs.readFileSync(path.resolve('baguette-simulator/node/core.cjs'),'utf8'),context);
  let other;
  if(mode==='busy'){
   other=vm.runInContext('clipboardAction',context)({udid,action:'key',code:'KeyA'});
   while(!keyboardCalls)await new Promise(resolve=>setImmediate(resolve));
  }
  const params=mode==='after-clipboard'?{text:'new',method:'paste'}:{keys:['a','b']};
  await assert.rejects(context.module.exports.dispatch('type_text',{udid,...params}),e=>e.execution===(['busy','first-preflight','expired'].includes(mode)?'not_executed':'unknown'),mode);
  if(mode==='busy'){assert.equal(keyboardCalls,1);release();await other;}
  if(['first-preflight','expired'].includes(mode))assert.equal(keyboardCalls,0);
  if(mode==='after-key')assert.equal(keyboardCalls,1);
  if(mode==='after-clipboard'){assert.equal(clipboard,'new');assert.equal(keyboardCalls,1,'no paste key was sent after the Xcode lookup failed');}
 }
});

test('tool and viewer keyboard input excludes only the same normalized device and releases after every outcome',async()=>{
 const a='AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',b='BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
 for(const action of ['key','paste','copy','release','tool-keys','tool-release'])for(const failed of [false,true]){
  let finish,started;const entered=new Promise(resolve=>started=resolve),held=new Promise(resolve=>finish=resolve),calls=[],clipboards=new Map();let heldOnce=false;
  const context={module:{exports:{}},__dirname:path.resolve('baguette-simulator/node'),setTimeout,clearTimeout,process:{platform:'darwin',arch:'arm64',env:{}},require(name){
   if(name==='./viewer.cjs')return {};
   if(name==='node:fs/promises')return {mkdir:async()=>{}};
   if(name==='node:child_process')return {execFile(file,args,options,callback){
    const call={file,args,input:''};calls.push(call);let output='';
    if(file.endsWith('sw_vers'))output='27.0';
    if(file.endsWith('xcode-select'))output='/Xcode';
    if(args.includes('--json'))output=JSON.stringify({devices:{r:[a,b].map(udid=>({udid,state:'Booted'}))}});
    const device=file.endsWith('/keyboard')?args[1]:args[4];
    if(file.endsWith('/keyboard')&&device===a&&!heldOnce){heldOnce=true;started();held.then(()=>callback(failed?Error('ACK lost'):null,'',''));}
    else queueMicrotask(()=>{if(args.includes('pbcopy'))clipboards.set(device,call.input);callback(null,args.includes('pbpaste')?clipboards.get(device):output,'');});
    return {stdin:{on(){},end(value){call.input=value;}}};
   }};
   return require(name.startsWith('./')?path.resolve('baguette-simulator/node',name):name);
  }};
  vm.runInNewContext(fs.readFileSync(path.resolve('baguette-simulator/node/core.cjs'),'utf8'),context);
  const input=vm.runInContext('clipboardAction',context),dispatch=context.module.exports.dispatch;
  const first=action==='tool-keys'?dispatch('type_text',{udid:a,keys:['a']}):action==='tool-release'?dispatch('press',{udid:a,button:'release-input'}):input({udid:a,action,code:'KeyA',text:'test'});
  const settled=first.then(value=>({value}),error=>({error}));await entered;
  try{
   await assert.rejects(input({udid:a.toLowerCase(),action:'release'}),e=>e.code==='INPUT_BUSY'&&e.execution==='not_executed');
   await input({udid:b,action:'key',code:'KeyB'});
   assert.equal(calls.filter(c=>c.file.endsWith('/keyboard')&&c.args[1]===b).length,1,'another device proceeds while the first is held');
  }finally{finish();}
  const result=await settled;assert.equal(!!result.error,failed);
  await input({udid:a.toLowerCase(),action:'release'});
 }
});

test('tvOS auto types with the remote adapter, validates unsupported text before clearing, and never accesses the pasteboard',async()=>{
 const h=harness({runtime:'com.apple.CoreSimulator.SimRuntime.tvOS-27-0'});
 const r=await h.dispatch('type_text',{udid,text:'Ab 1',observe:'none'});
 assert.equal(r.method,'type');
 const send=h.calls.find(c=>c.file.endsWith('/native/remote')&&c.args[3]==='keys');
 assert.deepEqual(JSON.parse(send.args[4]),[[4,2],[5,0],[44,0],[30,0]]);
 assert.ok(!h.calls.some(c=>c.args.includes('pbcopy')));
 for(const params of [{text:'new',method:'paste'},{text:'\u4e2d\u6587'},{text:'a'.repeat(301)}]){
  const f=harness({runtime:'tvOS-27-0'});
  await assert.rejects(f.dispatch('type_text',{udid,...params,clear:true,observe:'none'}),e=>['INVALID_ARGUMENT','UNSUPPORTED_INPUT'].includes(e.code)&&e.execution==='not_executed');
  assert.ok(!f.calls.some(c=>c.file.includes('/native/')||c.args.includes('pbcopy')));
 }
});
test('TV remote buttons and Vision crown are platform-specific and keep the owned set',async()=>{
 const tv=harness({runtime:'tvOS-27-0'});await tv.dispatch('press',{udid,button:'right'});
 const sent=tv.calls.find(c=>c.file.endsWith('/native/remote'));
 assert.ok(sent.args[0].endsWith('/BaguetteCindy/devices'));assert.equal(sent.args[1],udid);
 assert.deepEqual(Array.from(sent.args.slice(3)),['key','79','0','0']);
 const vision=harness({runtime:'xrOS-27-0'});await vision.dispatch('press',{udid,button:'home'});
 assert.ok(vision.calls.some(c=>c.args.includes('digital-crown')));
 await assert.rejects(vision.dispatch('press',{udid,button:'swipe-to-home'}),e=>e.code==='INVALID_ARGUMENT');
});
