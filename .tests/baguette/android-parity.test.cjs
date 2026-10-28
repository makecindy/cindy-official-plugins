'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const base=path.resolve('baguette-simulator/node/android'),id='00000000-0000-4000-8000-000000000001';
async function temp(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'android-parity-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('media import uses generated guest paths, verifies bytes and preserves copied outcomes',async t=>{
 const root=await temp(t),file=path.join(root,'photo; $(ignored).png');await fs.writeFile(file,'test');
 const {importMedia}=require(path.join(base,'files.cjs')),calls=[];
 const devices={adb:async(d,args)=>{calls.push(args);return {stdout:args.includes('stat')?'4':''};}};
 const result=await importMedia(devices,{udid:id},{path:file});assert.equal(result.copied,true);assert.equal(result.scanRequested,true);assert.match(result.path,/^\/sdcard\/Download\/cindy-[a-f0-9-]+\.png$/);assert.equal(calls[0][1],await fs.realpath(file));
 const partial=await importMedia({adb:async(d,args)=>{if(args.includes('stat'))return {stdout:'4'};if(args.includes('broadcast'))throw Error('scan unavailable');return {stdout:''};}},{udid:id},{path:file});
 assert.equal(partial.execution,'executed');assert.equal(partial.copied,true);assert.equal(partial.outcome,'partial');assert.match(partial.nextAction,/do not copy/);
 await assert.rejects(importMedia(devices,{udid:id},{path:'relative.png'}),e=>e.code==='INVALID_ARGUMENT');
});
test('partial Android state changes retain completed fields and do not run later fields',async()=>{
 const calls=[],setState=require(path.join(base,'state.cjs')).createState({devices:{adb:async(d,args)=>{calls.push(args);if(args.includes('high_text_contrast_enabled'))throw Object.assign(Error('not allowed'),{code:'DENIED',execution:'unknown'});return {stdout:''};}},agent:{frame:async()=>{throw Error('must not observe after failure');}}});
 const result=await setState({udid:id},{appearance:'dark',contrast:true,text_size:'large'});
 assert.deepEqual(result.applied,['appearance']);assert.equal(result.stateError.field,'contrast');assert.equal(result.execution,'unknown');assert.equal(calls.length,2);
});
test('APK install jobs retain the actual write outcome across every verification phase',async t=>{
 const source=await fs.readFile(path.join(base,'apps.cjs'),'utf8'),hash='b'.repeat(64);
 for(const mode of ['auto','full'])for(const phase of ['inspect','before-query','comparison','unchanged','offline','identity','budget','transport','timeout','unclassified','unconfirmed','after-query','after-hash','hash-mismatch','success'])await t.test(mode+' '+phase,async()=>{
  let queried=0,started=0,attempted=0;const codes={offline:'DEVICE_NOT_BOOTED',identity:'DEVICE_NOT_OWNED',budget:'TIME_BUDGET_EXHAUSTED',transport:'COMMAND_FAILED',timeout:'COMMAND_FAILED'};
  const devices={adb:async(_d,args,options)=>{
   if(args[0]==='install'){
    attempted++;assert.equal(options.mutation,true);assert.equal(options.deadline,undefined,'background install outlives the foreground wait');
    if(['offline','identity','budget'].includes(phase))throw Object.assign(Error(phase),{code:codes[phase],execution:'not_executed'});
    started++;
    if(['transport','timeout'].includes(phase))throw Object.assign(Error(phase),{code:codes[phase],execution:'unknown'});
    if(phase==='unclassified')throw Error('unclassified install failure');
    return {stdout:phase==='unconfirmed'?'Failure [INSTALL_FAILED]':'Success'};
   }
   if(args.includes('dumpsys')){
    queried++;if((queried===1&&phase==='before-query')||(queried>1&&phase==='after-query'))throw Object.assign(Error('query failed'),{code:'COMMAND_FAILED',execution:'not_executed'});
    return {stdout:'versionCode=12\nversionName=1.2'};
   }
   if(args.includes('path'))return {stdout:'package:/data/app/test/base.apk'};
   assert.ok(args.includes('sha256sum'));
   if((queried===1&&phase==='comparison')||(queried>1&&phase==='after-hash'))throw Object.assign(Error('fingerprint failed'),{code:'COMMAND_FAILED',execution:'not_executed'});
   return {stdout:(queried===1?(phase==='unchanged'?hash:'a'.repeat(64)):phase==='hash-mismatch'?'a'.repeat(64):hash)+'  /data/app/test/base.apk'};
  }};
  const context={module:{exports:{}},setTimeout,clearTimeout,require:n=>require(n.startsWith('.')?path.resolve(base,n):n)};vm.runInNewContext(source,context);
  context.inspect=async()=>{if(phase==='inspect')throw Error('invalid APK');return {appPath:'/fixture.apk',bundleId:'test.example.app',fingerprint:hash};};
  const apps=context.module.exports.createApps({devices});const first=await apps.install({udid:id},{appPath:'/fixture.apk',mode,wait:0,_deadline:0});await apps.pending(id);
  const result=await apps.status({udid:id,job:first.job,wait:0});
  const unchanged=phase==='unchanged'&&mode==='auto',before=['inspect','before-query'].includes(phase)||(phase==='comparison'&&mode==='auto');
  const preflight=['offline','identity','budget'].includes(phase),success=phase==='success'||(mode==='full'&&['unchanged','comparison'].includes(phase));
  assert.equal(result.execution,unchanged||before||preflight?'not_executed':success?'executed':'unknown');
  assert.equal(result.state,unchanged||success?'done':'failed');assert.equal(started,before||unchanged||preflight?0:1);assert.equal(attempted,before||unchanged?0:1);
  if(unchanged)assert.equal(result.mode,'unchanged');if(preflight)assert.equal(result.errorCode,codes[phase]);
  assert.ok(result.finishedAt);assert.equal(apps.runningFor(id),null);assert.equal(apps.pending(id),undefined);
 });
});
test('APK status polling preserves a single pending install and its eventual execution evidence',async t=>{
 const source=await fs.readFile(path.join(base,'apps.cjs'),'utf8'),hash='b'.repeat(64);
 for(const rejected of [false,true])await t.test(rejected?'preflight rejection':'completed',async()=>{
  let settle,attempts=0,queried=0;const blocked=new Promise((resolve,reject)=>{settle=()=>rejected?reject(Object.assign(Error('identity changed'),{code:'DEVICE_NOT_OWNED',execution:'not_executed'})):resolve({stdout:'Success'});});
  const context={module:{exports:{}},setTimeout,clearTimeout,require:n=>require(n.startsWith('.')?path.resolve(base,n):n)};vm.runInNewContext(source,context);context.inspect=async()=>({appPath:'/fixture.apk',bundleId:'test.example.app',fingerprint:hash});
  const apps=context.module.exports.createApps({devices:{adb:async(_d,args)=>{
   if(args[0]==='install'){attempts++;return blocked;}
   if(args.includes('dumpsys')){queried++;return {stdout:'versionCode=1'};}
   if(args.includes('path'))return {stdout:'package:/data/app/base.apk'};
   return {stdout:(queried===1?'a'.repeat(64):hash)+'  base.apk'};
  }}});
  const first=await apps.install({udid:id},{appPath:'/fixture.apk',wait:0});assert.equal(first.state,'running');assert.equal(first.execution,'unknown');assert.equal(apps.runningFor(id).job,first.job);
  const poll=await apps.status({udid:id,job:first.job,wait:0});assert.equal(poll.job,first.job);assert.equal(poll.state,'running');
  await assert.rejects(apps.install({udid:id},{appPath:'/fixture.apk'}),e=>e.code==='INSTALL_RUNNING');assert.equal(attempts,1);
  settle();await apps.pending(id);const result=await apps.status({udid:id,job:first.job,wait:0});assert.equal(result.execution,rejected?'not_executed':'executed');assert.equal(result.state,rejected?'failed':'done');assert.equal(attempts,1);assert.equal(apps.runningFor(id),null);
 });
});
test('failed APK fingerprint reads are unconfirmed, never evidence for reinstall',async()=>{
 const {createApps}=require(path.join(base,'apps.cjs'));
 const apps=createApps({devices:{adb:async(d,args)=>{if(args.includes('dumpsys'))return {stdout:'versionCode=12\nversionName=1.2'};throw Object.assign(Error('permission denied'),{code:'ADB_FAILED'});}}});
 const result=await apps.info({udid:id},{bundleId:'test.example.app'});assert.equal(result.installed,true);assert.equal(result.verification,'unconfirmed');assert.equal(result.comparisonError.code,'ADB_FAILED');assert.equal(result.fingerprint,null);
});
test('viewer upload requires origin, capability, opened device and a supported file type',async t=>{
 const requests=[],viewer=require(path.join(base,'viewer.cjs')).createViewer({root:await temp(t),devices:{target:async()=>({udid:id})},agent:{}});t.after(()=>viewer.close());
 viewer.configure({assertEnabled:async()=>{},request:async(method,p)=>{requests.push({method,p,bytes:await fs.readFile(p.path)});return {copied:true,execution:'executed'};}});
 const u=new URL((await viewer.open(id)).url),token=new URLSearchParams(u.hash.slice(1)).get('cindyClipboard').split('.')[1];
 const upload=(headers,name='photo.png',device=id)=>fetch(u.origin+'/android-file?udid='+device+'&name='+name,{method:'POST',headers,body:'image'});
 assert.equal((await upload({Origin:u.origin})).status,403);
 assert.equal((await upload({'X-Cindy-Clipboard':token,Origin:'https://example.test'})).status,403);
 assert.equal((await upload({'X-Cindy-Clipboard':token,Origin:u.origin},'script.sh')).status,409);
 assert.equal((await upload({'X-Cindy-Clipboard':token,Origin:u.origin},'photo.png','unknown')).status,404);
 assert.equal(requests.length,0);
 assert.equal((await upload({'X-Cindy-Clipboard':token,Origin:u.origin})).status,200);assert.equal(requests[0].method,'import_media');assert.equal(requests[0].bytes.toString(),'image');await assert.rejects(fs.stat(requests[0].p.path),e=>e.code==='ENOENT');
});
test('wheel motion survives a slow initial touch and releases after intermediate moves',async()=>{
 const handlers={},nodes={},pointers=new Map(),sent=[];
 const node=()=>({hidden:true,addEventListener(){},getBoundingClientRect:()=>({left:0,top:0,width:400,height:800}),getAnimations:()=>[],focus(){}});
 const canvas=node();canvas.addEventListener=(name,fn)=>{handlers[name]=fn;};
 const context={window:{},document:{getElementById:id=>nodes[id]||(nodes[id]=node()),addEventListener(){}},location:{pathname:'/simulators/'+id,search:'?cindyViewer=test'},URLSearchParams,setTimeout,clearTimeout,setInterval,clearInterval,addEventListener(){}};
 vm.runInNewContext(await fs.readFile(path.join(base,'screen-actions.js'),'utf8'),context);
 context.window.androidScreenActions({canvas,frame:node(),pointers,screenSize:()=>({width:400,height:800}),zh:false,input:async()=>{},flush:async start=>{sent.push([...pointers.values()].map(p=>({...p})));await new Promise(r=>setTimeout(r,start?180:5));for(const [key,p] of pointers)if(p.pressure===0)pointers.delete(key);}});
 handlers.wheel({preventDefault(){},stopPropagation(){},clientX:200,clientY:400,deltaY:160,deltaX:0,deltaMode:0,ctrlKey:false});
 for(let i=0;i<100&&(!sent.length||pointers.size);i++)await new Promise(r=>setTimeout(r,20));
 assert.ok(sent.length>=5);assert.equal(sent[0][0].y,.5);assert.ok(sent.some(t=>t[0]?.pressure===1024&&t[0].y<.5&&t[0].y>.3));assert.equal(sent.at(-1)[0].pressure,0);assert.equal(pointers.size,0);
 for(const touches of sent){assert.equal(touches.length,2);assert.equal(touches[0].y,touches[1].y);assert.ok(Math.abs(touches[0].x-touches[1].x-.4)<1e-9);}
});
