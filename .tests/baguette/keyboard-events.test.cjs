const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('held paste produces no request; duplicate pending paste suppressed; ordinary keys serialized and blur cancels queued keys',async()=>{
 const el={},calls=[],pending=[],document={activeElement:el};
 const context={window:{alert(){throw Error('Unexpected failure');}},document,URLSearchParams,AbortSignal,location:{pathname:'/simulators/00000000-0000-4000-8000-000000000001',hash:'#cindyClipboard=1234.'+'a'.repeat(64)},fetch:(_url,opts)=>{calls.push(JSON.parse(opts.body));return new Promise(r=>pending.push(()=>r({ok:true,json:async()=>({ok:true})})));}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../../baguette-simulator/vendor/baguette-v0.1.98-macOS-arm64/Baguette_Baguette.bundle/Web/baguette/parts/keyboard.js'),'utf8'),context);
 const keyboard=new context.window.Baguette._Keyboard({},{});keyboard._el=el;let prevented=false;
 keyboard._handle({code:'KeyV',metaKey:true,repeat:true,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(calls.length,0);
 keyboard.paste('Google');keyboard.paste('Google');assert.equal(calls.length,1);pending.shift()();await new Promise(r=>setImmediate(r));
 keyboard.key('KeyA',[]);keyboard.key('KeyB',[]);keyboard.key('KeyC',[]);assert.equal(calls.length,2);
 pending.shift()();await new Promise(r=>setImmediate(r));assert.equal(calls[2].code,'KeyB');keyboard._onBlur();pending.shift()();await new Promise(r=>setImmediate(r));assert.equal(calls.length,3);
 keyboard.paste('Google');assert.equal(calls.length,4);pending.shift()();await new Promise(r=>setImmediate(r));
});
test('paste and copy queue behind a key; only identical adjacent paste is suppressed',async()=>{
 const calls=[],pending=[],alerts=[];
 const context={window:{alert:s=>alerts.push(s)},document:{},URLSearchParams,AbortSignal,location:{pathname:'/simulators/00000000-0000-4000-8000-000000000001',hash:'#cindyClipboard=1234.'+'a'.repeat(64)},fetch:(_url,opts)=>{calls.push(JSON.parse(opts.body));return new Promise(r=>pending.push(()=>r({ok:true,json:async()=>({ok:true})})));}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../../baguette-simulator/vendor/baguette-v0.1.98-macOS-arm64/Baguette_Baguette.bundle/Web/baguette/parts/keyboard.js'),'utf8'),context);
 const k=new context.window.Baguette._Keyboard({},{});
 k.key('KeyA',[]);k.paste('Google');k.paste('Google');k.paste('Other');k.copy();
 for(let i=0;i<4;i++){pending.shift()();await new Promise(r=>setImmediate(r));}
 assert.deepEqual(calls.map(x=>x.action),['key','paste','paste','copy']);assert.deepEqual(calls.filter(x=>x.action==='paste').map(x=>x.text),['Google','Other']);assert.equal(alerts.length,0);
 k.key('KeyA',[]);for(let i=0;i<33;i++)k.copy();assert.equal(alerts.length,1);k._inputQueue.length=0;pending.shift()();await new Promise(r=>setImmediate(r));
});
