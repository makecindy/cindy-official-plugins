const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function harness(safari=false){
  const target=()=>{
    const listeners=new Map();
    return {listeners,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
      removeEventListener(name,fn){listeners.get(name)?.delete(fn);},
      emit(name,extra={}){for(const fn of [...listeners.get(name)||[]])fn({type:name,clientX:130,clientY:250,scale:1,rotation:0,deltaX:0,deltaY:10,preventDefault(){},...extra});}};
  };
  const el=target(),document=target(),window=target(),timers=new Map();let timerId=0,dots=[];
  document.getElementById=()=>true;document.hidden=false;
  window.document=document;window.location={origin:'http://example.test'};window.parent={};
  if(safari)window.GestureEvent=function(){};
  el.getBoundingClientRect=()=>({left:30,top:50,width:200,height:400});
  const calls=[],copy=x=>JSON.parse(JSON.stringify(x));
  const screen={size:{width:400,height:800}};
  for(const name of ['touchDown','touchMove','touchUp','tap'])screen[name]=(points,opts)=>calls.push({name,points:copy(points),opts:opts&&copy(opts)});
  const context={window,document,performance:{now:()=>1000},setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  const dir=path.join(__dirname,'../../baguette-simulator/vendor/baguette/Baguette_Baguette.bundle/Web/baguette/gestures');
  for(const name of ['attachable-event-source','edge-bands','mouse-gesture-source','touch-gesture-source','wheel-gesture-source','safari-gesture-event-source','option-hover-preview','pointer-interpreter'])
    vm.runInNewContext(fs.readFileSync(path.join(dir,name+'.js'),'utf8'),context);
  window.Baguette._MouseGestureSource.prototype._ripple=()=>{};
  const source=new window.Baguette._PointerInterpreter(screen,{overlay:{setFingers:p=>dots=copy(p),clear:()=>dots=[]}});
  source.attach(el);
  const advance=ms=>{for(const [id,timer]of [...timers])if(timer.ms<=ms){timers.delete(id);timer.fn();}};
  const release=reason=>{
    if(reason==='detach'){source.detach();return;}
    if(reason==='hidden'){document.hidden=true;document.emit('visibilitychange');return;}
    if(reason==='message'){window.emit('message',{origin:window.location.origin,source:window.parent,data:{type:'cindy-release-input'}});return;}
    window.emit(reason);
  };
  return {source,el,window,document,calls,timers,advance,release,dots:()=>dots};
}

function begin(h,kind){
  const {el}=h;
  if(['pending','drag','hold','edge','pinch','pan'].includes(kind)){
    el.emit('mousedown',{clientY:kind==='edge'?55:250,altKey:kind==='pinch'||kind==='pan',shiftKey:kind==='pan'});
    if(kind==='drag')el.emit('mousemove',{clientX:160});
    if(kind==='hold')h.advance(250);
  }else if(kind==='hover'){
    el.emit('mouseenter');h.window.emit('keydown',{key:'Alt'});
  }else if(kind==='wheel'||kind==='wheelPinch')el.emit('wheel',{ctrlKey:kind==='wheelPinch'});
  else if(kind==='safariGesture')el.emit('gesturestart');
  else if(kind==='native')el.emit('cindy-trackpad',{detail:{phase:'begin',touches:[{id:0,x:80,y:200},{id:1,x:180,y:200}]}});
  else{
    const touches=[{identifier:0,clientX:80,clientY:kind==='safariEdge'?55:200}];
    if(kind==='rawPair')touches.push({identifier:1,clientX:180,clientY:200});
    el.emit('touchstart',{touches});
  }
}

test('every iOS source cancels through the same lifecycle without tapping, stale moves or hold timers',()=>{
  for(const kind of ['pending','drag','hold','edge','pinch','pan','hover','wheel','wheelPinch','rawSingle','rawPair','native','safariTouch','safariEdge','safariGesture']){
    for(const reason of ['message','hidden','blur','pagehide','detach']){
      const h=harness(kind.startsWith('safari')),label=kind+'/'+reason;
      begin(h,kind);
      const downs=h.calls.filter(c=>c.name==='touchDown').length;
      assert.equal(downs,['pending','hover'].includes(kind)?0:1,label);
      h.release(reason);h.release(reason);
      assert.equal(h.calls.filter(c=>c.name==='touchUp').length,downs,label+' releases exactly once');
      assert.equal(h.calls.filter(c=>c.name==='tap').length,0,label+' cancellation never taps');
      assert.deepEqual(h.dots(),[],label+' clears preview');
      assert.equal(h.timers.size,0,label+' clears delayed hold/idle callbacks');
      const count=h.calls.length;
      h.advance(1000);
      h.el.emit('mousemove',{clientX:170});h.el.emit('mouseup');
      h.el.emit('touchmove',{touches:[{identifier:0,clientX:160,clientY:200}]});
      h.el.emit('touchend',{touches:[],changedTouches:[]});
      h.el.emit('cindy-trackpad',{detail:{phase:'change',touches:[{id:0,x:170,y:200}]}});
      h.el.emit('gesturechange');h.el.emit('gestureend');
      assert.equal(h.calls.length,count,label+' ignores the old gesture tail');
      assert.deepEqual(h.dots(),[],label+' does not repaint old modifier preview');
      if(reason==='detach')h.source.attach(h.el);
      h.document.hidden=false;
      begin(h,kind);
      if(kind==='pending')assert.equal(h.timers.size,1,label+' fresh hold can start');
      else if(kind==='hover')assert.equal(h.dots().length,2,label+' fresh preview can start');
      else assert.equal(h.calls.filter(c=>c.name==='touchDown').length,downs+1,label+' fresh begin works');
      h.source.detach();
      for(const target of [h.el,h.window,h.document])assert.ok([...target.listeners.values()].every(set=>set.size===0),label+' detach removes listeners');
    }
  }
});

test('release messages require the parent and same origin; unrelated messages leave the mouse hold alive',()=>{
  const h=harness();begin(h,'pending');
  const message={origin:h.window.location.origin,source:h.window.parent,data:{type:'cindy-release-input'}};
  h.window.emit('message',{...message,source:{}});
  h.window.emit('message',{...message,origin:'http://other.test'});
  h.window.emit('message',{...message,data:{type:'other'}});
  h.document.emit('visibilitychange'); // visible is not a cancellation
  assert.equal(h.timers.size,1);
  h.advance(250);assert.equal(h.calls.at(-1).name,'touchDown');
  h.release('message');assert.equal(h.calls.at(-1).name,'touchUp');h.source.detach();
});

test('ordinary mouse completion still taps or releases a drag once',()=>{
  for(const kind of ['pending','drag','hold','edge','pinch','pan']){
    const h=harness();begin(h,kind);h.el.emit('mouseup');
    assert.equal(h.calls.filter(c=>c.name==='tap').length,kind==='pending'?1:0,kind);
    assert.equal(h.calls.filter(c=>c.name==='touchUp').length,kind==='pending'?0:1,kind);
    const count=h.calls.length;h.release('message');h.advance(1000);
    assert.equal(h.calls.length,count,kind+' completed gestures are not released again');h.source.detach();
  }
});

test('Safari touch-to-pinch handoff releases an edge stream and cancels the pair once',()=>{
  const h=harness(true),a={identifier:0,clientX:80,clientY:55},b={identifier:1,clientX:180,clientY:200};
  h.el.emit('touchstart',{touches:[a]});
  h.el.emit('touchstart',{touches:[a,b]});
  assert.deepEqual(h.calls.map(c=>c.name),['touchDown','touchUp']);
  assert.equal(h.calls.at(-1).opts.edge,'top');
  h.el.emit('gesturestart');h.release('message');
  assert.deepEqual(h.calls.map(c=>[c.name,c.points.length]),[['touchDown',1],['touchUp',1],['touchDown',2],['touchUp',2]]);
  assert.deepEqual(h.dots(),[]);h.source.detach();
});
