const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const {createClipboard}=require('../../cindy-simulator/node/clipboard.cjs');
const udid='00000000-0000-4000-8000-000000000001';
test('browser paste/copy reach scoped bridge; focus and capability checks prevent accidental actions',async()=>{
 const actions=[],origin='http://127.0.0.1:49111';
 const bridge=await createClipboard(origin,async p=>actions.push(p));bridge.devices.add(udid);
 try{
  const [port,token]=bridge.fragment.split('=')[1].split('.');const endpoint=`http://127.0.0.1:${port}/clipboard`;
  const headers={'Origin':origin,'Content-Type':'application/json','X-Cindy-Clipboard':token};
  for(const change of [{Origin:'https://example.test'},{'X-Cindy-Clipboard':'bad'}]){
   const response=await fetch(endpoint,{method:'POST',headers:{...headers,...change},body:JSON.stringify({action:'copy',udid})});assert.equal(response.status,403);
  }
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({action:'copy',udid:'other-device'})})).status,400);assert.equal(actions.length,0);
  const el={},document={activeElement:el},alerts=[],requests=[];
  const context={window:{alert:m=>alerts.push(m)},document,location:{hash:'#'+bridge.fragment.replace(/=\d+\./,'=1.'),pathname:'/simulators/'+udid},URLSearchParams,AbortSignal,
   fetch:(url,options)=>{assert.equal(url,'/clipboard','fragment port must never select a network destination');const promise=fetch(new URL(url,bridge.base),{...options,headers:{...options.headers,Origin:origin}});requests.push(promise);return promise;}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../../cindy-simulator/vendor/baguette/Baguette_Baguette.bundle/Web/baguette/parts/keyboard.js'),'utf8'),context);
  const keyboard=new context.window.Baguette._Keyboard({}, {_dispatch(){throw Error('Must not reach broken upstream path');}});keyboard._el=el;
  let prevented=false;keyboard._handlePaste({clipboardData:{getData:()=> '测试 clipboard 🙂\nsecond line'},preventDefault(){prevented=true;}});
  await requests[0];while(keyboard._inputPending)await new Promise(r=>setImmediate(r));assert.equal(prevented,true);assert.deepEqual(actions[0],{action:'paste',text:'测试 clipboard 🙂\nsecond line',udid});
  keyboard._handle({metaKey:true,code:'KeyC',preventDefault(){}});await requests[1];while(keyboard._inputPending)await new Promise(r=>setImmediate(r));assert.equal(actions[1].action,'copy');
  document.activeElement={};keyboard._handlePaste({clipboardData:{getData(){throw Error('Wrong focus must not read clipboard');}}});assert.equal(actions.length,2);
  assert.equal(alerts.length,0);
 }finally{bridge.close();}
});
test('failures are explicit and bridge stays usable',async()=>{
 const origin='http://127.0.0.1:49112';let fail=true;
 const bridge=await createClipboard(origin,async()=>{if(fail)throw Error('private data not exposed');});bridge.devices.add(udid);
 try{const [port,token]=bridge.fragment.split('=')[1].split('.');
 const send=()=>fetch(`http://127.0.0.1:${port}/clipboard`,{method:'POST',headers:{Origin:origin,'X-Cindy-Clipboard':token},body:JSON.stringify({action:'copy',udid})});
 const error=await send();assert.equal(error.status,500);assert.equal((await error.json()).execution,'unknown');fail=false;assert.equal((await send()).status,200);
 }finally{bridge.close();}
});

test('viewer clipboard requests share the runtime device lock without blocking another device',async t=>{
 const a='AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',b='BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
 const path=require('node:path'),os=require('node:os'),fsp=require('node:fs/promises');
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'bag-bridge-lock-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));
 const {createRuntime}=require('../../cindy-simulator/node/runtime.cjs');
 const runtime=createRuntime({settingsFile:path.join(root,'settings.json'),dispatch:async()=>({ok:true})});
 let release,started;const entered=new Promise(resolve=>started=resolve),held=new Promise(resolve=>release=resolve),keys=[];
 const bridge=await createClipboard('http://127.0.0.1:49113',async p=>{if(p.udid.toUpperCase()===a){started();await held;}},{
  port:1,guard:runtime.assertEnabled,run:(fn,id)=>{const key='device:'+id.toUpperCase();keys.push(key);return runtime.exclusive(fn,key);}
 });
 bridge.devices.add(a);bridge.devices.add(b);
 const token=bridge.session.token;
 const send=udid=>fetch(bridge.base+'/clipboard',{method:'POST',headers:{Origin:'http://127.0.0.1:49113','X-Cindy-Clipboard':token},body:JSON.stringify({udid,action:'key',code:'KeyA'})});
 const first=send(a);await entered;
 try{
  assert.equal((await send(a.toLowerCase())).status,409);
  await assert.rejects(runtime.request('tap',{udid:a.toLowerCase()}),e=>e.code==='BUSY');
  assert.equal((await send(b)).status,200);
  assert.equal((await runtime.request('tap',{udid:b})).ok,true);
  assert.deepEqual(keys,['device:'+a,'device:'+b]);
 }finally{release();await first;bridge.close();}
 await runtime.request('tap',{udid:a});
});
