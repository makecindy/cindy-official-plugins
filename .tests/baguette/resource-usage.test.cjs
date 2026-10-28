const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resourceUsage}=require('../../baguette-simulator/node/resource-usage.cjs');
const directory='/private/Sim Devices/device-one',device={udid:'one',state:'Booted'};
const processes=`10 1 100 launchd_sim ${directory}/data/var/run/launchd_bootstrap.plist
11 10 200 /runtime/SpringBoard
12 11 300 /device/App
20 1 400 launchd_sim /other/devices/device-one/data/var/run/launchd_bootstrap.plist
21 20 500 /other/App
30 1 600 /viewer/Baguette
31 1 700 /bin/echo launchd_sim ${directory}/data/var/run/launchd_bootstrap.plist`;
function measure(over={}){return resourceUsage({device,directory,host:'linux',run:async(file)=>({stdout:file.endsWith('/ps')?processes:`5120\t${directory}`}),...over});}

test('resources attribute only the exact private launchd tree; disk measures allocated blocks',async()=>{
 const calls=[];
 const r=await measure({run:async(file,args,options)=>{calls.push({file,args,options});return {stdout:file.endsWith('/ps')?processes:`5120\t${directory}`};}});
 assert.deepEqual(r.memory,{bytes:600*1024,status:'ok',processCount:3,method:'rss'});
 assert.deepEqual(r.disk,{bytes:5120*1024,status:'ok'});
 assert.equal(r.udid,'one');assert.ok(Number.isFinite(Date.parse(r.sampledAt)));
 assert.deepEqual(calls[1].args,['-sk','-P','-x',directory]);
 assert.ok(calls.every(c=>c.options.timeout>0&&c.options.timeout<=10000));
});
test('Android uses its owned endpoint PID, independent of shared ADB and other emulators',async()=>{
 const r=await measure({device:{...device,platform:'android'},pid:20,host:'linux'});
 assert.equal(r.memory.bytes,900*1024);assert.equal(r.memory.processCount,2);
 assert.equal((await measure({device:{...device,platform:'android'},pid:999})).memory.bytes,null);
});
test('macOS uses physical footprint and one fresh process tree, not duplicated shared-library RSS',async()=>{
 const output='PID PPID MEM COMMAND\n10 1 1M launchd_sim\n11 10 512K SpringBoard\n15 10 1.5M NewApp\n20 1 8G other';
 const r=await measure({host:'darwin',run:async file=>({stdout:file.endsWith('/ps')?processes:file.endsWith('/top')?output:`2\t${directory}`})});
 assert.equal(r.memory.bytes,3*1024**2);assert.equal(r.memory.processCount,3);assert.equal(r.memory.method,'physical-footprint');
 for(const bad of ['PID PPID MEM COMMAND','10 1 N/A launchd_sim','10 1 1M AnotherProcess']){
  const missing=await measure({host:'darwin',run:async file=>({stdout:file.endsWith('/ps')?processes:file.endsWith('/top')?bad:`2\t${directory}`})});
  assert.equal(missing.memory.bytes,null);assert.equal(missing.disk.bytes,2048);
 }
});
test('unknown, malformed and failed measurements never become zero or erase the other metric',async()=>{
 for(const text of ['', 'not a ps table', '10 1 invalid launchd_sim x']){
  const r=await measure({run:async file=>({stdout:file.endsWith('/ps')?text:`2\t${directory}`})});
  assert.equal(r.memory.bytes,null);assert.equal(r.disk.bytes,2048);
 }
 const missing=await measure({directory:'/not-running'});assert.equal(missing.memory.status,'unattributed');assert.equal(missing.memory.bytes,null);
 const off=await measure({directory:'/not-running',device:{...device,state:'Shutdown'}});assert.equal(off.memory.bytes,0);
 for(const failed of ['/ps','/du']){
  const r=await measure({run:async file=>{if(file.endsWith(failed))throw Error('timeout or denied');return {stdout:file.endsWith('/ps')?processes:`2\t${directory}`};}});
  assert.equal(r[failed==='/ps'?'memory':'disk'].bytes,null);assert.equal(r[failed==='/ps'?'disk':'memory'].status,'ok');
 }
 const malformed=await measure({run:async file=>({stdout:file.endsWith('/ps')?processes:'partial output'})});assert.equal(malformed.disk.bytes,null);
 const unsupported=await measure({host:'win32',run:()=>{throw Error('Must not run Unix tools');}});
 assert.equal(unsupported.memory.status,'unsupported');assert.equal(unsupported.disk.status,'unsupported');
});
test('expired budget starts no resource subprocess',async()=>{
 let calls=0;const r=await measure({deadline:Date.now()-1,run:async()=>{calls++;}});
 assert.equal(calls,0);assert.equal(r.memory.bytes,null);assert.equal(r.disk.bytes,null);
});


test('resource cache shares in-flight work and separates memory and disk expiry across owned devices',async()=>{
 const {createResourceCache}=require('../../baguette-simulator/node/resource-usage.cjs');let now=1000;const calls=[];
 const cache=createResourceCache({now:()=>now,measure:async p=>{calls.push([p.device.udid,p.metrics[0]]);return {[p.metrics[0]]:{bytes:123,status:'ok'}};}});
 const options={device,directory};
 await Promise.all([cache.read(options),cache.read(options),cache.read({...options,refresh:true})]);
 assert.deepEqual(calls,[['one','memory'],['one','disk']]);
 now+=14999;await cache.read(options);assert.equal(calls.length,2);
 now+=1;const next=await cache.read(options);assert.deepEqual(calls.at(-1),['one','memory']);assert.equal(calls.length,3);
 assert.notEqual(next.memory.sampledAt,next.disk.sampledAt);
 now=301000;await cache.read(options);assert.equal(calls.length,5);
 await cache.read({...options,refresh:true});assert.equal(calls.length,7);
 await cache.read({...options,device:{...device,udid:'two'},directory:'/other'});assert.equal(calls.length,9);
 await cache.read({...options,device:{...device,state:'Shutdown'}});assert.equal(calls.length,10);assert.deepEqual(calls.at(-1),['one','memory']);
});
test('failed cache refresh retains the last known value with its original timestamp and a bounded retry',async()=>{
 const {createResourceCache}=require('../../baguette-simulator/node/resource-usage.cjs');let now=1000,fail=false,count=0;
 const cache=createResourceCache({now:()=>now,measure:async p=>{count++;if(fail)throw Error('timeout');return {[p.metrics[0]]:{bytes:456,status:'ok'}};}});
 const options={device,directory};const first=await cache.read(options);fail=true;now+=16000;
 const stale=await cache.read(options);assert.equal(stale.memory.bytes,456);assert.equal(stale.memory.stale,true);assert.equal(stale.memory.sampledAt,first.memory.sampledAt);
 assert.equal(stale.disk.stale,undefined);assert.equal(count,3);
 await cache.read(options);assert.equal(count,3);
 now+=30000;fail=false;const recovered=await cache.read(options);assert.equal(count,4);assert.equal(recovered.memory.stale,undefined);
});
test('lifecycle changes cannot let a late memory sample overwrite the new state',async()=>{
 const {createResourceCache}=require('../../baguette-simulator/node/resource-usage.cjs');const pending=[];
 const cache=createResourceCache({measure:p=>new Promise(resolve=>pending.push({p,resolve}))});
 const old=cache.read({device,directory});await Promise.resolve();
 const current=cache.read({device:{...device,state:'Shutdown'},directory});await Promise.resolve();
 pending.find(x=>x.p.metrics[0]==='disk').resolve({disk:{status:'ok',bytes:100}});
 pending.find(x=>x.p.device.state==='Shutdown').resolve({memory:{status:'ok',bytes:0}});
 assert.equal((await current).memory.bytes,0);
 pending.find(x=>x.p.device.state==='Booted'&&x.p.metrics[0]==='memory').resolve({memory:{status:'ok',bytes:999}});await old;
 assert.equal((await cache.read({device:{...device,state:'Shutdown'},directory})).memory.bytes,0);
});
