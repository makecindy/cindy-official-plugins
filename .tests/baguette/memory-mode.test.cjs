const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createMemoryModes,profiles,validateMode}=require('../../baguette-simulator/node/memory-mode.cjs');
const udid='00000000-0000-4000-8000-000000000001',device={udid,state:'Shutdown'};
class Failure extends Error{constructor(code,message,execution='not_executed'){super(message);this.code=code;this.execution=execution;}}
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cindy-memory-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const dir=path.join(root,'com.apple.CoreSimulator.SimDevice.'+udid),file=path.join(dir,'disabled.plist');
 const run=async(file,args,{input})=>{assert.equal(file,'/usr/bin/plutil');assert.deepEqual(args.slice(-3),['-o','-','-']);return {stdout:JSON.stringify(JSON.parse(String(input)))};};
 let live='disabled services = {\n}',calls=0;
 const memory=createMemoryModes({storeRoot:root,run,Failure,sim:async args=>{calls++;assert.deepEqual(args,['spawn',udid,'launchctl','print-disabled','system']);return {stdout:live};}});
 return {root,dir,file,memory,live:value=>live=value,calls:()=>calls,seed:async entries=>{await fs.mkdir(dir,{mode:0o700,recursive:true});await fs.writeFile(file,JSON.stringify(entries));},read:async()=>JSON.parse(await fs.readFile(file,'utf8'))};
}
test('memory profiles match tested counts and preserve required services',()=>{
 assert.equal(profiles.saving.length,56);assert.equal(profiles.minimal.length,168);
 for(const l of ['com.apple.assistantd','com.apple.gamed','com.apple.sharingd'])assert.ok(!profiles.minimal.includes(l));
 for(const l of ['com.apple.assetsd','com.apple.liveactivitiesd','com.apple.storekitd','com.apple.apsd','com.apple.swcd'])assert.ok(!profiles.saving.includes(l));
 for(const mode of [null,{},['saving'],'toString','',42])assert.throws(()=>validateMode(mode,Failure),e=>e.code==='INVALID_ARGUMENT');
});
test('cold boots default to saving; switching minimal to standard restores only managed labels',async t=>{
 const f=await fixture(t);await f.seed({'example.test.keep-disabled':true,'example.test.keep-enabled':false});
 let checks=0;const check=async()=>checks++;
 const initial=await f.memory.configure(device,undefined,check);assert.equal(initial.mode,'saving');assert.equal(initial.disabledServices,56);assert.equal(initial.verified,false);
 for(const [mode,count] of [['minimal',168],['standard',0],['saving',56]]){
  const r=await f.memory.configure(device,mode,check);assert.equal(r.mode,mode);assert.equal(r.disabledServices,count);
  const entries=await f.read();assert.equal(entries['example.test.keep-disabled'],true);assert.equal(entries['example.test.keep-enabled'],false);
 }
 assert.equal(checks,4);assert.deepEqual(await fs.readdir(f.dir),['disabled.plist']);
});
test('booted devices never rewrite stores; explicit changes require shutdown',async t=>{
 const f=await fixture(t);await f.memory.configure(device,'minimal',async()=>{});const before=await fs.readFile(f.file);
 const booted={...device,state:'Booted'},never=()=>assert.fail('no live mutation');
 assert.equal((await f.memory.configure(booted,undefined,never)).mode,'minimal');
 assert.equal((await f.memory.configure(booted,'minimal',never)).mode,'minimal');
 await assert.rejects(f.memory.configure(booted,'saving',never),e=>e.code==='MEMORY_MODE_REQUIRES_SHUTDOWN');
 assert.deepEqual(await fs.readFile(f.file),before);
});
test('external startup and invalid/symlink stores cannot replace launchd overrides',async t=>{
 const f=await fixture(t);await f.seed({'example.test.keep-disabled':true});const before=await fs.readFile(f.file);
 await assert.rejects(f.memory.configure(device,'minimal',async()=>{throw new Failure('DEVICE_TRANSITIONING','started');}),e=>e.code==='DEVICE_TRANSITIONING');
 assert.deepEqual(await fs.readFile(f.file),before);assert.deepEqual(await fs.readdir(f.dir),['disabled.plist']);
 await f.seed({unexpected:'not boolean'});await assert.rejects(f.memory.configure(device,undefined,async()=>{}),e=>e.code==='MEMORY_STORE_INVALID');
 await fs.rm(f.file);const other=path.join(f.root,'other');await fs.writeFile(other,'{}');await fs.symlink(other,f.file);
 await assert.rejects(f.memory.configure(device,undefined,async()=>{}));assert.equal(await fs.readFile(other,'utf8'),'{}');
 await fs.rm(f.dir,{recursive:true});await fs.mkdir(other+'dir');await fs.symlink(other+'dir',f.dir);
 await assert.rejects(f.memory.configure(device,undefined,async()=>{}),e=>e.code==='MEMORY_STORE_UNSAFE');
});
test('verification reads active overrides and does not confuse malformed output with standard',async t=>{
 const f=await fixture(t);
 f.live('disabled services = {\n'+profiles.saving.map(l=>`"${l}" => disabled`).join('\n')+'\n}');
 const actual=await f.memory.verify(device);assert.equal(actual.mode,'saving');assert.equal(actual.verified,true);
 f.live('not supported');await assert.rejects(f.memory.verify(device),e=>e.code==='MEMORY_MODE_UNVERIFIED');
});
test('device reads opt into fresh memory evidence without mutating devices; a failed probe retains the list',async()=>{
 const dir=path.resolve('baguette-simulator/node'),calls=[];
 let mode='saving',fail=false;
 const context={module:{exports:{}},__dirname:dir,process:{platform:'darwin',arch:'arm64'},require(name){
  if(name==='./viewer.cjs')return {};
  if(name==='./android/index.cjs')return {createAndroid:()=>({dispatch:async()=>({devices:[]})})};
  if(name==='./memory-mode.cjs')return {createMemoryModes:()=>({verify:async(d,timeout)=>{
   calls.push(d.udid);assert.equal(timeout,1500);if(fail)throw Error('unavailable');return {mode,verified:true};
  }})};
  if(name==='node:child_process')return {execFile(file,args,opts,cb){
   let output;
   if(file.endsWith('sw_vers'))output='27.0';
   else {assert.deepEqual(Array.from(args.slice(-3)),['list','devices','--json']);output=JSON.stringify({devices:{
    'com.apple.CoreSimulator.SimRuntime.iOS-27-0':[{udid,state:'Booted'},{udid:'stopped',state:'Shutdown'}],
    'com.apple.CoreSimulator.SimRuntime.tvOS-27-0':[{udid:'tv',state:'Booted'}],
   }});}
   queueMicrotask(()=>cb(null,output,''));return {stdin:{on(){},end(){}}};
  }};
  return require(name.startsWith('./')?path.join(dir,name):name);
 }};
 vm.runInNewContext(require('node:fs').readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
 const dispatch=context.module.exports.dispatch;
 await dispatch('devices');assert.deepEqual(calls,[]);
 for(const value of ['saving','minimal','standard']){
  mode=value;const {devices}=await dispatch('devices',{includeMemoryModes:true});
  assert.equal(devices[0].memoryMode.mode,value);assert.equal(devices[0].memoryMode.verified,true);
  assert.equal(devices[1].memoryMode,undefined);assert.equal(devices[2].memoryMode,undefined);
 }
 fail=true;const {devices}=await dispatch('devices',{includeMemoryModes:true});
 assert.equal(devices.length,3);assert.equal(devices[0].memoryMode.mode,'unknown');
 assert.equal(devices[0].memoryMode.verified,false);assert.deepEqual(calls,[udid,udid,udid,udid]);
});
test('core boot owns mode application, preserves partial evidence and rejects unsupported platforms',async()=>{
 const dir=path.resolve('baguette-simulator/node');
 for(const outcome of ['success','timeout','unverified','unsupported','invalid']){
  const calls=[];let state='Shutdown';
  const runtime=outcome==='unsupported'?'com.apple.CoreSimulator.SimRuntime.tvOS-27-0':'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
  const context={module:{exports:{}},__dirname:dir,process:{platform:'darwin',arch:'arm64'},require(name){
   if(name==='./viewer.cjs')return {};
   if(name==='./android/index.cjs')return {createAndroid:()=>({owns:async()=>false})};
   if(name==='node:fs/promises')return {mkdir:async()=>{}};
   if(name==='./memory-mode.cjs')return {validateMode,createMemoryModes:()=>({
    configure:async(d,mode,check)=>{calls.push('configure');assert.equal(d.udid,udid);await check();return {mode:mode??'saving',verified:false};},
    verify:async()=>{calls.push('verify');if(outcome==='unverified')throw Error('unreadable');return {mode:'saving',verified:true};}})};
   if(name==='node:child_process')return {execFile(file,args,opts,cb){let output='',error=null;
    if(file.endsWith('sw_vers'))output='27.0';
    else if(args.includes('--json'))output=JSON.stringify({devices:{[runtime]:[{udid,state}]}});
    else if(args[0]==='boot'){calls.push('boot');state='Booted';}
    else if(args.includes('bootstatus')){calls.push('ready');if(outcome==='timeout')error=Error('timeout');}
    queueMicrotask(()=>cb(error,output,''));return {stdin:{on(){},end(){}}};}};
   return require(name.startsWith('./')?path.join(dir,name):name);
  }};
  vm.runInNewContext(require('node:fs').readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
  const result=await context.module.exports.dispatch('boot',{udid,...(['unsupported','invalid'].includes(outcome)?{memoryMode:outcome==='invalid'?'invalid':'saving'}:{})}).catch(e=>e);
  if(['unsupported','invalid'].includes(outcome)){assert.equal(calls.length,0);assert.equal(result.execution,'not_executed');}
  else if(outcome==='timeout'){assert.equal(result.execution,'unknown');assert.match(result.message,/Memory overrides were configured/);}
  else {assert.equal(result.state,'Booted');assert.equal(result.memoryMode.verified,outcome==='success');assert.deepEqual(calls,['configure','boot','ready','verify']);}
 }
});
