const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const dir=path.resolve('baguette-simulator/node');
const udid='00000000-0000-4000-8000-000000000001';
function core(output,failAt=Infinity){
 let polls=0,mutations=0;
 const context={module:{exports:{}},__dirname:dir,process:{platform:'darwin',arch:'arm64'},setTimeout:fn=>fn(),require(name){
  if(name==='./viewer.cjs')return {};
  if(name==='node:fs/promises')return {mkdir:async()=>{}};
  if(name==='node:child_process')return {execFile(file,args,opts,cb){
   let data='',error=null;
   if(args.includes('--json'))data=JSON.stringify({devices:{runtime:[{udid,state:'Booted'}]}});
   else if(args[0]==='describe-ui')data=output;
   else if(args.includes('list')){polls++;if(polls===failAt)error=Error('simctl timeout');data=(polls===1?'100':'200')+' 0 com.apple.SpringBoard';}
   else mutations++;
   queueMicrotask(()=>cb(error,data,''));return {stdin:{on(){},end(){}}};
  }};
  return require(name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
 return {dispatch:context.module.exports.dispatch,mutations:()=>mutations};
}
test('describe_ui rejects empty/malformed trees and accepts observable descendants',async()=>{
 for(const value of ['[]','null','{}','{"children":[]}','{"role":"AXUnknown"}','invalid']) {
  await assert.rejects(core(value).dispatch('describe_ui',{udid}),e=>e.code===(value==='invalid'?'INVALID_OUTPUT':'EMPTY_UI'));
 }
 const tree={children:[{role:'AXButton',label:'Google',children:[]}]};
 assert.equal((await core(JSON.stringify(tree)).dispatch('describe_ui',{udid})).tree.children[0].label,'Google');
});
test('heal distinguishes preflight failure from post-restart polling failure',async()=>{
 const before=core('',1);await assert.rejects(before.dispatch('heal',{udid}),e=>e.execution==='not_executed');assert.equal(before.mutations(),0);
 const after=core('',2);await assert.rejects(after.dispatch('heal',{udid}),e=>e.execution==='unknown');assert.equal(after.mutations(),2);
 assert.equal((await core('').dispatch('heal',{udid})).execution,'executed');
});
