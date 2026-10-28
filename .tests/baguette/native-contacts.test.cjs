const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

// Run the actual viewer source: stable finger identity, asymmetric motion,
// immediate reverse, liftoff/cancel and detach. No simulator or timed waits.
function harness(orientation='portrait'){
  const handlers=new Map(),calls=[],dots=[];
  const target={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener(){},getBoundingClientRect:()=>({left:30,top:50,width:200,height:400})};
  const window={...target};
  const screen={size:{width:400,height:800}};
  for(const name of ['touchDown','touchMove','touchUp'])screen[name]=(points,opts)=>calls.push([name,JSON.parse(JSON.stringify(points)),...(opts?[JSON.parse(JSON.stringify(opts))]:[])]);
  const dir=path.join(__dirname,'../../baguette-simulator/vendor/baguette/Baguette_Baguette.bundle/Web/baguette/gestures');
  for(const name of ['attachable-event-source','edge-bands','touch-gesture-source'])vm.runInNewContext(fs.readFileSync(path.join(dir,name+'.js'),'utf8'),{window});
  const source=new window.Baguette._TouchGestureSource(screen,{getOrientation:()=>orientation,overlay:{setFingers:p=>dots.push(JSON.parse(JSON.stringify(p))),clear:()=>dots.push([])}});
  source.attach(target);
  const emit=(type,touches)=>handlers.get(type)({type,touches,preventDefault(){}});
  const native=(phase,touches)=>handlers.get('cindy-trackpad')({detail:{phase,touches}});
  return {emit,native,calls,dots,source};
}
test('raw contacts keep finger identity and reverse on the next input frame',()=>{
  const h=harness(),a={identifier:3,clientX:80,clientY:200},b={identifier:7,clientX:180,clientY:200};
  h.emit('touchstart',[a,b]);
  h.emit('touchmove',[{...b,clientX:220,clientY:220},a]);
  assert.deepEqual(h.calls.at(-1)[1].map(p=>[p.x,p.y]),[[100,300],[380,340]]);
  h.emit('touchmove',[a,{...b,clientX:160}]);
  assert.deepEqual(h.calls.at(-1)[1].map(p=>[p.x,p.y]),[[100,300],[260,300]]);
  assert.deepEqual(h.dots.at(-1),[{x:50,y:150},{x:130,y:150}]);
  h.emit('touchend',[a]);assert.equal(h.calls.at(-2)[0],'touchUp');assert.equal(h.calls.at(-2)[1].length,2);
  assert.equal(h.calls.at(-1)[0],'touchDown');assert.equal(h.calls.at(-1)[1].length,1);
  h.emit('touchend',[]);assert.equal(h.calls.at(-1)[0],'touchUp');assert.deepEqual(h.dots.at(-1),[]);
});
test('raw cancel and detach always release both contacts',()=>{
  const h=harness(),p=[{identifier:1,clientX:80,clientY:200},{identifier:2,clientX:180,clientY:200}];
  h.emit('touchstart',p);h.emit('touchcancel',[]);assert.equal(h.calls.at(-1)[0],'touchUp');
  h.emit('touchstart',p);h.source.detach();assert.equal(h.calls.at(-1)[0],'touchUp');assert.equal(h.calls.at(-1)[1].length,2);
});
test('native sample starts one two-finger stream and reverses without a single-finger prelude',()=>{
  const h=harness(),a={id:0,x:80,y:200},b={id:1,x:180,y:200};
  h.native('begin',[a,b]);assert.deepEqual(h.calls.map(c=>[c[0],c[1].length]),[['touchDown',2]]);
  h.native('change',[a,{...b,x:220}]);h.native('change',[a,{...b,x:160}]);
  assert.deepEqual(h.calls.at(-1)[1].map(p=>[p.x,p.y]),[[100,300],[260,300]]);
  h.native('cancel',[]);assert.equal(h.calls.at(-1)[0],'touchUp');assert.equal(h.calls.at(-1)[1].length,2);
});

// Chromium's new path lost the legacy single-touch edge metadata. Test the
// actual source through start/move/end and cancellation, including orientation.
test('single-contact edge hints survive movement and every release path',()=>{
  for(const [orientation,x,y,edge] of [['portrait',130,60,'top'],['portrait',130,440,'bottom'],['landscape-left',130,60,'top'],['portrait-upside-down',35,200,'bottom'],['portrait-upside-down',225,200,'top']]){
    for(const end of ['touchend','touchcancel','blur','pagehide','detach']){
      const h=harness(orientation),finger={identifier:3,clientX:x,clientY:y};
      h.emit('touchstart',[finger]);h.emit('touchmove',[{...finger,clientX:130,clientY:250}]);
      if(end==='detach')h.source.detach();else h.emit(end,[]);
      assert.deepEqual(h.calls.map(c=>[c[0],c[2]]),[['touchDown',{edge}],['touchMove',{edge}],['touchUp',{edge}]]);
      assert.deepEqual(h.dots.at(-1),[]);
    }
  }
});

test('single-to-pair boundaries clear edge hints and do not classify an already-down survivor',()=>{
  const h=harness(),a={identifier:0,clientX:80,clientY:440},b={identifier:1,clientX:180,clientY:440};
  h.emit('touchstart',[a]);h.emit('touchstart',[a,b]);
  assert.deepEqual(h.calls[1][2],{edge:'bottom'});
  assert.equal(h.calls[2][2],undefined);
  h.emit('touchend',[a]);assert.equal(h.calls.at(-1)[2],undefined);
  h.emit('touchend',[]);h.emit('touchstart',[{...a,clientY:250}]);
  assert.equal(h.calls.at(-1)[2],undefined,'a later centre touch must not inherit the previous edge');
  h.emit('touchend',[]);
  h.native('begin',[{id:0,x:80,y:440},{id:1,x:180,y:440}]);
  assert.equal(h.calls.at(-1)[2],undefined,'an atomic pair must never get a single-finger edge hint');
  h.native('cancel',[]);
});
