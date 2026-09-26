const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const udid='00000000-0000-4000-8000-000000000001';

function harness({coreDeviceFails=false,simctlFails=false,owned=true}={}) {
 const calls=[];
 const context={module:{exports:{}},__dirname:path.resolve('baguette-simulator/node'),process:{platform:'darwin',arch:'arm64'},require(name){
  if(name==='./viewer.cjs')return {};
  if(name==='./keys.cjs')return require('../../baguette-simulator/node/keys.cjs');
  if(name==='node:fs/promises')return {mkdir:async()=>{}};
  if(name==='node:child_process')return {execFile(file,args,options,callback){
   const call={file,args,options,input:undefined};calls.push(call);
   let output='',error=null;
   if(file==='/usr/bin/sw_vers')output='27.0';
   if(file==='/usr/bin/xcode-select')output='/Applications/Xcode.app/Contents/Developer';
   if(args.includes('--json'))output=JSON.stringify({devices:{runtime:owned?[{udid,state:'Booted'}]:[]}});
   if((args[0]==='devicectl'&&coreDeviceFails)||(args.includes('pbcopy')&&simctlFails))error=Error('unsupported command');
   queueMicrotask(()=>callback(error,output,''));
   return {stdin:{on(){},end(input){call.input=input;}}};
  }};
  return require(name);
 }};
 vm.runInNewContext(fs.readFileSync(path.resolve('baguette-simulator/node/core.cjs'),'utf8'),context);
 return {calls,dispatch:context.module.exports.dispatch};
}

test('paste prefers CoreDevice and keeps Unicode text out of command arguments',async()=>{
 const h=harness();await h.dispatch('type_text',{udid,text:'你好 Duo 🥖'});
 const write=h.calls.find(c=>c.args[0]==='devicectl');
 assert.deepEqual(Array.from(write.args),['devicectl','device','pasteboard','copy','--device',udid]);
 assert.equal(write.input,'你好 Duo 🥖');
 assert.ok(!h.calls.some(c=>c.args.includes('pbcopy')));
 assert.ok(h.calls.at(-1).file.endsWith('/native/keyboard'));
 assert.ok(h.calls.every(c=>!c.args.includes('你好 Duo 🥖')));
});

test('older Xcode or unknown CoreDevice falls back only to the private device set',async()=>{
 const h=harness({coreDeviceFails:true});await h.dispatch('type_text',{udid,text:'旧版 Xcode'});
 const fallback=h.calls.find(c=>c.args.includes('pbcopy'));
 assert.equal(fallback.args[0],'simctl');assert.equal(fallback.args[1],'--set');
 assert.ok(fallback.args[2].endsWith('/BaguetteCindy/devices'));
 assert.deepEqual(Array.from(fallback.args.slice(3)),['pbcopy',udid]);
 assert.equal(fallback.input,'旧版 Xcode');
 assert.equal(fallback.options.env.LC_ALL,'en_US.UTF-8');
});

test('failed clipboard writes never paste stale text, and foreign devices never mutate',async()=>{
 const h=harness({coreDeviceFails:true,simctlFails:true});
 await assert.rejects(h.dispatch('type_text',{udid,text:'new'}),e=>e.execution==='unknown');
 // The only keyboard call is the existing key-release step, before any write.
 assert.equal(h.calls.filter(c=>c.file.endsWith('/native/keyboard')).length,1);
 const foreign=harness({owned:false});
 await assert.rejects(foreign.dispatch('type_text',{udid,text:'new'}),e=>e.code==='DEVICE_NOT_OWNED');
 assert.ok(!foreign.calls.some(c=>c.args[0]==='devicectl'||c.args.includes('pbcopy')||c.file.endsWith('/native/keyboard')));
});
