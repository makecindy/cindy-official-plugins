const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{EventEmitter}=require('node:events');
test('new processes exiting during manual recovery count crashes and eventually park',async()=>{
 let launches=0;
 const context={module:{exports:{}},process:{stderr:{write(){}}},setTimeout:fn=>setImmediate(fn),clearTimeout:clearImmediate,require(name){
  if(name==='./clipboard.cjs')return {};
  if(name==='node:child_process')return {spawn(){launches++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=null;child.signalCode=null;setImmediate(()=>{child.exitCode=1;child.emit('close',1,null);});return child;}};
  return require(name);
 }};
 vm.runInNewContext(fs.readFileSync('baguette-simulator/node/viewer.cjs','utf8')+'\nmodule.exports.testRestart=c=>{active=c;return restartNative(c);};',context);
 const current={binary:'fixture',deviceSet:'fixture',children:new Set(),stopped:false,child:null,crashes:[],port:1};
 await assert.rejects(context.module.exports.testRestart(current),/crashed repeatedly/);
 assert.equal(launches,6);assert.equal(current.parked,true);assert.equal(current.crashes.length,6);assert.equal(current.restartPromise,null);
});
