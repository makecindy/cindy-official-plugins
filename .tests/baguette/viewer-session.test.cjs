const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {createClipboard}=require('../../cindy-simulator/node/clipboard.cjs');
const {createRuntime}=require('../../cindy-simulator/node/runtime.cjs');
const udid='00000000-0000-4000-8000-000000000001';
const control={port:1,status:async()=>({ready:true})};
const freePort=()=>new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});

test('a restarted viewer reuses the saved address and capability, so an open tab keeps working',async()=>{
 const first=await createClipboard('http://127.0.0.1:1',async()=>{},control);
 const saved=first.session;first.close();
 const again=await createClipboard('http://127.0.0.1:1',async()=>{},control,saved);again.devices.add(udid);
 try{
  assert.deepEqual(again.session,saved);
  const r=await fetch(again.base+'/control-api',{method:'POST',headers:{Origin:again.base,'X-Cindy-Clipboard':saved.token},body:JSON.stringify({action:'status',udid})});
  assert.equal(r.status,200,'the capability from before the restart is accepted');
 }finally{again.close();}
});

test('a taken port falls back to a new one; a malformed saved capability is never used',async()=>{
 const port=await freePort();const squatter=net.createServer();await new Promise(r=>squatter.listen(port,'127.0.0.1',r));
 const token='a'.repeat(64);
 const moved=await createClipboard('http://127.0.0.1:1',async()=>{},control,{port,token});
 try{assert.notEqual(moved.session.port,port);assert.equal(moved.session.token,token);}finally{moved.close();squatter.close();}
 const fresh=await createClipboard('http://127.0.0.1:1',async()=>{},control,{port:80,token:'short'});
 try{assert.notEqual(fresh.session.token,'short');assert.match(fresh.session.token,/^[0-9a-f]{64}$/);assert.notEqual(fresh.session.port,80);}finally{fresh.close();}
});

test('the viewer status preserves screen health and reports only the unreadable App record separately',async t=>{
 const vm=require('node:vm'),syncFs=require('node:fs'),{EventEmitter}=require('node:events');
 for(const broken of ['{','directory']){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bag-view-record-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const settingsFile=path.join(dir,'settings.json'),record=settingsFile+'.apps.json';
  if(broken==='directory')await fs.mkdir(record);else await fs.writeFile(record,broken);
  const runtime=createRuntime({settingsFile,dispatch:async()=>({devices:[{udid,state:'Booted'}]})});
  let bridge,ready=true;
  const context={module:{exports:{}},process:{pid:process.pid},require(name){
   if(name==='./clipboard.cjs')return {createClipboard:async(_origin,_perform,control)=>{bridge=control;return {session:{port:12345,token:'a'.repeat(64)}};}};
   if(name==='node:http')return {get(_url,_opts,callback){const request=new EventEmitter(),response=new EventEmitter();request.destroy=()=>{};response.statusCode=ready?200:503;response.resume=()=>{};queueMicrotask(()=>{callback(response);response.emit('end');});return request;}};
   return require(name.startsWith('./')?path.resolve('cindy-simulator/node',name):name);
  }};
  vm.runInNewContext(syncFs.readFileSync('cindy-simulator/node/viewer.cjs','utf8')+'\nmodule.exports.testBridge=initializeBridge;',context);
  context.module.exports.configureControls(runtime);
  await context.module.exports.testBridge({base:'http://example.test',port:12345,generation:1},path.join(dir,'devices'),async()=>{});
  const status=await bridge.status({udid});
  assert.equal(status.ready,true);assert.equal(status.device.state,'Booted');assert.equal(status.currentAppError.code,'APP_CONTEXT_UNREADABLE');
  await assert.rejects(runtime.currentApp(udid),e=>e.code==='APP_CONTEXT_UNREADABLE','the underlying record access still refuses damaged data');
  ready=false;assert.equal((await bridge.status({udid})).ready,false,'record errors do not mask an actual service failure');
  if(broken==='directory')await fs.rmdir(record);else assert.equal(await fs.readFile(record,'utf8'),broken);
  await fs.writeFile(record,JSON.stringify({[udid]:'test.example.app'}));ready=true;
  const restored=await bridge.status({udid});assert.equal(restored.ready,true);assert.equal(restored.currentApp,'test.example.app');assert.equal(restored.currentAppError,undefined);
 }
});

test('turning simulators off retires the saved viewer address',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'baguette-session-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let forgotten=0,state='Booted';
 const runtime=createRuntime({settingsFile:path.join(dir,'s.json'),forgetViewer:()=>forgotten++,
  dispatch:async(method)=>{if(method==='devices')return {devices:[{udid,state}]};if(method==='shutdown')state='Shutdown';return {ok:true};}});
 await runtime.request('settings_save',{enabled:true,idleMinutes:15});assert.equal(forgotten,0);
 await runtime.request('settings_save',{enabled:false,idleMinutes:15});assert.equal(forgotten,1);assert.equal(state,'Shutdown');
});
