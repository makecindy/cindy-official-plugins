const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const {createClipboard}=require('../../baguette-simulator/node/clipboard.cjs');
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
  vm.runInNewContext(fs.readFileSync(require.resolve('../../baguette-simulator/vendor/baguette/Baguette_Baguette.bundle/Web/baguette/parts/keyboard.js'),'utf8'),context);
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
