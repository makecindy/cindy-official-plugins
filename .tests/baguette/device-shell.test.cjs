'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../cindy-simulator/node/physical/shell.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(options){
  const requests=[],mounted=[],area={},frame={replaceChildren:child=>assert.equal(child,area),removeAttribute(){},setAttribute(){}};
  let now=0;
  const context={window:{Baguette:{_Bezel:class{constructor(def){this.def=def;this.canvas={replaceWith:child=>assert.equal(child,area)};this.wrapper={};this.frameImg={};}mount(){mounted.push(this.def);}}}},
    URL,location:{href:'http://example.test/simulators/phone?cindyViewer=secret'},AbortSignal,
    Date:{now:()=>now},Image:class{async decode(){}},fetch:url=>new Promise(resolve=>requests.push({url:String(url),resolve}))};
  vm.runInNewContext(source,context);
  const shell=new context.window.DeviceShell(frame,area,()=>{},options);
  const respond=(i,size,valid=true)=>requests[i].resolve({ok:true,json:async()=>({deviceScreen:size,...(valid?{screen:{viewport:size,bezelImage:{rest:'image'}}}:{})})});
  return {shell,requests,mounted,respond,advance:ms=>{now+=ms;}};
}
for(const remote of [false,true])test(`${remote?'remote':'local'} shell rejects stale orientation, preserves canvas and reuses loaded bodies`,async()=>{
  const f=setup(remote?{definitionURL:s=>`http://example.test/definition?w=${s.width}&h=${s.height}`,retryMs:3000}:undefined);
  const portrait={width:400,height:800},landscape={width:800,height:400};
  f.shell.update(portrait);f.shell.update(portrait);assert.equal(f.requests.length,1);
  assert.match(f.requests[0].url,remote?/w=400&h=800/:/definition.json\?cindyViewer=secret/);
  f.shell.update(landscape);f.respond(1,landscape);await tick();f.respond(0,portrait);await tick();
  assert.equal(f.mounted.length,1);assert.deepEqual(f.shell.viewport,landscape);
  f.shell.update(portrait);await tick();assert.deepEqual(f.shell.viewport,portrait);assert.equal(f.requests.length,2);
  if(remote){
    for(const rotation of [0,1,2,3]){const pose={...landscape,rotation};f.shell.update(pose);f.respond(f.requests.length-1,pose);await tick();}
    assert.equal(f.requests.length,6,'equal dimensions with opposite rotations load separate bodies');
    f.shell.update({...landscape,rotation:1});await tick();assert.equal(f.requests.length,6,'known pose reuses its existing body');
  }
});
test('missing or mismatched bodies keep the plain frame and retry after the delay',async()=>{
  const f=setup({retryMs:3000}),size={width:400,height:800};
  f.shell.update(size);f.respond(0,size,false);await tick();
  f.shell.update(size);assert.equal(f.requests.length,1);assert.equal(f.shell.viewport,null);
  f.advance(3001);f.shell.update(size);f.respond(1,{width:800,height:400});await tick();
  assert.equal(f.mounted.length,0);
  f.advance(3001);f.shell.update(size);f.respond(2,size);await tick();assert.deepEqual(f.shell.viewport,size);
});
