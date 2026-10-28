const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function fixture(width=1000,height=800,saved={}) {
  const storage=new Map(Object.entries(saved)),attrs={},styles={},events={},windowEvents={},classes=new Set();
  let resize,change,captured=null;
  const rect={width,height,left:20,top:30};
  const media={matches:width<=720,addEventListener:(_,fn)=>{change=fn;}};
  const hub={getBoundingClientRect:()=>rect,style:{setProperty:(k,v)=>{styles[k]=v;}},classList:{add:k=>classes.add(k),remove:k=>classes.delete(k)}};
  const handle={setAttribute:(k,v)=>{attrs[k]=v;},getAttribute:k=>attrs[k],addEventListener:(k,fn)=>{events[k]=fn;},
    focus(){},setPointerCapture:id=>{captured=id;},hasPointerCapture:id=>captured===id,releasePointerCapture:()=>{captured=null;}};
  const context={document:{getElementById:id=>id==='hub'?hub:handle,addEventListener(){}},window:{matchMedia:()=>media,addEventListener:(k,fn)=>{windowEvents[k]=fn;}},
    ResizeObserver:class {constructor(fn){resize=fn;}observe(){}},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    CindySimPages:{locale:()=>new Promise(()=>{})},CindySimModel:{}};
  vm.runInNewContext(fs.readFileSync('baguette-simulator/manage.js','utf8')+'\nsetupSplitter();',context);
  const fire=(name,data={})=>{let prevented=false;events[name]({pointerId:1,button:0,clientX:0,clientY:0,preventDefault(){prevented=true;},...data});return prevented;};
  return {attrs,styles,storage,classes,fire,blur:()=>windowEvents.blur(),captured:()=>captured,
    resize(w,h){rect.width=w;rect.height=h;const next=w<=720;if(next!==media.matches){media.matches=next;change();}resize();}};
}

test('stacked divider drags vertically without jumping at grab; preferences survive orientation and reopen',()=>{
  const f=fixture(400,800,{'cindy.hub.listWidth':'360'});
  assert.equal(f.attrs['aria-orientation'],'horizontal');
  f.fire('pointerdown',{clientY:355,clientX:100});
  f.fire('pointermove',{clientY:435,clientX:380});
  assert.equal(f.styles['--device-list-height'],'400px');
  f.fire('pointerup');assert.equal(f.captured(),null);assert.equal(f.classes.size,0);
  f.resize(1000,800);assert.equal(f.attrs['aria-orientation'],'vertical');assert.equal(f.styles['--device-list-width'],'360px');
  f.fire('keydown',{key:'ArrowRight'});assert.equal(f.storage.get('cindy.hub.listWidth'),'376');
  f.resize(400,800);assert.equal(f.styles['--device-list-height'],'400px');
  const reopened=fixture(400,800,Object.fromEntries(f.storage));assert.equal(reopened.styles['--device-list-height'],'400px');
});

test('active-axis keyboard, reset and resize preserve the other axis and unclamped preference',()=>{
  const f=fixture(400,800,{'cindy.hub.listWidth':'400','cindy.hub.listHeight':'500'});
  assert.equal(f.fire('keydown',{key:'ArrowRight'}),false);
  f.fire('keydown',{key:'ArrowUp'});assert.equal(f.attrs['aria-valuenow'],'484');
  f.resize(400,600);assert.equal(f.attrs['aria-valuenow'],'390');assert.equal(f.storage.get('cindy.hub.listHeight'),'484');
  f.resize(400,800);assert.equal(f.attrs['aria-valuenow'],'484');
  f.fire('keydown',{key:'Home'});assert.equal(f.attrs['aria-valuenow'],'180');
  f.fire('keydown',{key:'End'});assert.equal(f.attrs['aria-valuenow'],'590');
  f.fire('dblclick');assert.equal(f.attrs['aria-valuenow'],'320');assert.equal(f.storage.has('cindy.hub.listHeight'),false);
  f.resize(1000,800);assert.equal(f.attrs['aria-valuenow'],'400');
  f.fire('keydown',{key:'Enter'});assert.equal(f.attrs['aria-valuenow'],'300');
});

test('layout switch and interrupted gestures release pointer capture and ignore subsequent moves',()=>{
  const f=fixture();
  f.fire('pointerdown',{clientX:323});f.resize(400,800);
  assert.equal(f.captured(),null);assert.equal(f.classes.size,0);
  f.fire('pointermove',{clientY:500});assert.equal(f.attrs['aria-valuenow'],'320');
  for(const end of ['pointercancel','lostpointercapture','blur']) {
    f.fire('pointerdown',{clientY:355});
    if(end==='blur')f.blur();else f.fire(end);
    assert.equal(f.captured(),null);assert.equal(f.classes.size,0);
  }
});
