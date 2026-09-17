const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
test('recovery stays clickable, restarts once and restores frame; status polling does not repeatedly reload live stream',async()=>{
 const els={screen:{contentDocument:{querySelector:()=>null}},status:{},recover:{},release:{},notice:{style:{}}};let loads=0,src='';Object.defineProperty(els.screen,'src',{get:()=>src,set:v=>{loads++;src=v;}});
 let poll,generation=1;const calls=[];let fail=false;
 const context={URLSearchParams,AbortSignal,location:{search:'?udid=test',hash:'#cindyClipboard=123.token'},document:{getElementById:id=>els[id],addEventListener(){}},setInterval:f=>{poll=f;},fetch:async(_url,opts)=>{const action=JSON.parse(opts.body).action;calls.push(action);if(fail)throw Error('Offline');if(action==='restart')generation++;return {ok:true,json:async()=>({ready:true,generation})};}};
 const script=fs.readFileSync(require.resolve('../../baguette-simulator/node/control.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];vm.runInNewContext(script,context);await new Promise(r=>setImmediate(r));assert.equal(loads,1);
 generation++;await poll();assert.equal(loads,1,'service generation alone must not tear down recovered stream');
 await els.recover.onclick();assert.equal(calls.filter(x=>x==='restart').length,1);assert.equal(els.recover.disabled,false);assert.match(src,/simulators/);
 fail=true;await els.recover.onclick();assert.equal(els.recover.disabled,false);assert.match(els.notice.textContent,/retry/);
});
