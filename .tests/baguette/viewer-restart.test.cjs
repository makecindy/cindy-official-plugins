const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{EventEmitter}=require('node:events');
test('new processes exiting during manual recovery count crashes and eventually park',async()=>{
 let launches=0;
 const context={module:{exports:{}},process:{stderr:{write(){}}},setTimeout:fn=>setImmediate(fn),clearTimeout:clearImmediate,require(name){
  if(name==='./clipboard.cjs')return {};
  if(name==='node:child_process')return {spawn(){launches++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=null;child.signalCode=null;setImmediate(()=>{child.exitCode=1;child.emit('close',1,null);});return child;}};
  return require(name.startsWith('./')?require('node:path').resolve('cindy-simulator/node',name):name);
 }};
 vm.runInNewContext(fs.readFileSync('cindy-simulator/node/viewer.cjs','utf8')+'\nmodule.exports.testRestart=c=>{active=c;return restartNative(c);};',context);
 const current={binary:'fixture',deviceSet:'fixture',children:new Set(),stopped:false,child:null,crashes:[],port:1};
 await assert.rejects(context.module.exports.testRestart(current),/crashed repeatedly/);
 assert.equal(launches,6);assert.equal(current.parked,true);assert.equal(current.crashes.length,6);assert.equal(current.restartPromise,null);
});

test('a new worker reaps only its own orphaned viewer servers',()=>{
 // Real case: the host force-killed a stopping worker after 2 s while it was still
 // shutting devices down; its serve child lived on under launchd for hours.
 const {reapOrphans}=require('../../cindy-simulator/node/viewer.cjs');
 const bin='/x/vendor/baguette/Baguette',set='/Users/a/Library/Application Support/BaguetteCindy/devices';
 const listing=[
  `101 1 ${bin} serve --host 127.0.0.1 --port 61390 --device-set ${set} --no-plugins`,
  `102 900 ${bin} serve --host 127.0.0.1 --port 64286 --device-set ${set} --no-plugins`,
  `103 1 /other/Baguette serve --host 127.0.0.1 --port 1 --device-set ${set} --no-plugins`,
  `104 1 ${bin} serve --host 127.0.0.1 --port 2 --device-set /elsewhere --no-plugins`,
  `105 1 ${bin} screenshot --udid u --device-set ${set} --output o`,
 ].join('\n');
 const killed=[];
 assert.deepEqual(reapOrphans(bin,set,{list:()=>listing,kill:pid=>killed.push(pid)}),[101]);
 assert.deepEqual(killed,[101]);
 assert.deepEqual(reapOrphans(bin,set,{list:()=>{throw Error('ps failed');},kill:()=>assert.fail()}),[]);
});

test('an idle server past the memory budget restarts; a watched or small one is left alone',async()=>{
 // Real case: each closed 3D stream (foldables reconnect on every task-page load) kept ~33 MB;
 // a long session reached 12 GB.
 const launched=[];const sent=[];
 const context={module:{exports:{}},process:{stderr:{write(){}}},setTimeout:fn=>setImmediate(fn),clearTimeout:clearImmediate,Date,require(name){
  if(name==='./clipboard.cjs')return {};
  if(name==='node:child_process')return {execFileSync(){return '';},spawn(){const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=null;child.signalCode=null;child.pid=500+launched.length;child.kill=signal=>{sent.push(signal);child.signalCode=signal;setImmediate(()=>child.emit('close',null,signal));};launched.push(child);setImmediate(()=>{child.stdout.emit('data',Buffer.from('listening'));});return child;}};
  if(name==='node:http')return {get(url,options,cb){const res=new EventEmitter();res.statusCode=200;res.resume=()=>{};setImmediate(()=>{cb(res);res.emit('end');});const req=new EventEmitter();req.destroy=()=>{};return req;}};
  return require(name.startsWith('./')?require('node:path').resolve('cindy-simulator/node',name):name);
 }};
 vm.runInNewContext(fs.readFileSync('cindy-simulator/node/viewer.cjs','utf8')+'\nmodule.exports.testSetActive=c=>{active=c;launch(c);};',context);
 const {testSetActive,recycleIfBloated}=context.module.exports;
 let viewers=0;
 const current={binary:'fixture',deviceSet:'fixture',children:new Set(),stopped:false,child:null,crashes:[],port:1,base:'http://127.0.0.1:1',log:'',clipboard:{viewers:()=>viewers}};
 testSetActive(current);
 const later=Date.now()+120000;
 assert.equal(await recycleIfBloated({rssKb:()=>512*1024,now:later}),false,'under budget');
 viewers=1;
 assert.equal(await recycleIfBloated({rssKb:()=>4*1024*1024,now:later}),false,'someone is watching');
 viewers=0;
 assert.equal(await recycleIfBloated({rssKb:()=>4*1024*1024,now:later+120000}),true);
 assert.equal(sent[0],'SIGTERM');assert.equal(launched.length,2,'restarted once on the same port');
 assert.equal(current.child,launched[1]);
});
