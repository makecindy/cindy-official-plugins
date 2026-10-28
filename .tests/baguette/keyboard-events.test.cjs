const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('window focus loss cancels unsent input and detach removes every listener',async()=>{
 const target=()=>({listeners:new Map(),addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);},removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);},fire(name,e){for(const fn of this.listeners.get(name)||[])fn(e);}});
 const window=target(),document=target(),el=target(),calls=[],pending=[];
 window.alert=()=>assert.fail('unexpected input error');el.tabIndex=-1;el.focus=()=>document.activeElement=el;
 const context={window,document,URLSearchParams,AbortSignal,location:{origin:'http://example.test',pathname:'/simulators/00000000-0000-4000-8000-000000000001',hash:'#cindyClipboard=1234.'+'a'.repeat(64)},fetch:(_url,opts)=>{calls.push(JSON.parse(opts.body));return new Promise(resolve=>pending.push(()=>resolve({ok:true,json:async()=>({ok:true})})));}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../../baguette-simulator/vendor/baguette/Baguette_Baguette.bundle/Web/baguette/parts/keyboard.js'),'utf8'),context);
 const keyboard=new window.Baguette._Keyboard({},{});
 keyboard.attach(el);keyboard.attach(el);assert.equal(el.listeners.get('mousedown').size,1);
 for(const event of ['blur','pagehide']){
  keyboard.key('KeyA',[]);keyboard.key('KeyB',[]);const count=calls.length;
  window.fire(event);pending.shift()();await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,count,'late completion must not send queued keys after losing focus');
 }
 keyboard.detach();
 for(const node of [window,document,el])for(const listeners of node.listeners.values())assert.equal(listeners.size,0);
});
test('held paste produces no request; duplicate pending paste suppressed; ordinary keys serialized and blur cancels queued keys',async()=>{
 const el={},calls=[],pending=[],document={activeElement:el};
 const context={window:{alert(){throw Error('Unexpected failure');}},document,URLSearchParams,AbortSignal,location:{pathname:'/simulators/00000000-0000-4000-8000-000000000001',hash:'#cindyClipboard=1234.'+'a'.repeat(64)},fetch:(_url,opts)=>{calls.push(JSON.parse(opts.body));return new Promise(r=>pending.push(()=>r({ok:true,json:async()=>({ok:true})})));}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../../baguette-simulator/vendor/baguette/Baguette_Baguette.bundle/Web/baguette/parts/keyboard.js'),'utf8'),context);
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
 vm.runInNewContext(fs.readFileSync(require.resolve('../../baguette-simulator/vendor/baguette/Baguette_Baguette.bundle/Web/baguette/parts/keyboard.js'),'utf8'),context);
 const k=new context.window.Baguette._Keyboard({},{});
 k.key('KeyA',[]);k.paste('Google');k.paste('Google');k.paste('Other');k.copy();
 for(let i=0;i<4;i++){pending.shift()();await new Promise(r=>setImmediate(r));}
 assert.deepEqual(calls.map(x=>x.action),['key','paste','paste','copy']);assert.deepEqual(calls.filter(x=>x.action==='paste').map(x=>x.text),['Google','Other']);assert.equal(alerts.length,0);
 k.key('KeyA',[]);for(let i=0;i<33;i++)k.copy();assert.equal(alerts.length,1);assert.match(alerts[0],/Input queue is full/);k._inputQueue.length=0;pending.shift()();await new Promise(r=>setImmediate(r));
});
