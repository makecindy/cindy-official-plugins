'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createLiveAgent}=require('../../baguette-simulator/node/physical/live-agent.cjs');
const screen={width:400,height:800,displayId:1,rotation:'rot0'},d={udid:'00000000-0000-4000-8000-000000000001'};
function fixture(t){
 const calls=[];let leases=0,failed=false;
 const live={acquire:async()=>{leases++;return {screen,session:'generation',release:()=>leases--};},snapshot:async()=>({source:'live-video'}),input:async(id,p,owner)=>{calls.push({...p,owner});if(failed&&p.op==='move')throw Object.assign(Error('lost response'),{execution:'unknown'});return {execution:'dispatched'};}};
 const agent=createLiveAgent(live);t.after(()=>agent.close());return {agent,calls,leases:()=>leases,fail:()=>failed=true};
}
test('Agent observes and reverses a held contact across separate tool calls, then releases',async t=>{
 const f=fixture(t),began=await f.agent.touch(d,{phase:'begin',points:[[300,400]]});
 assert.equal(f.calls[0].op,'begin');assert.equal(f.leases(),1);
 await f.agent.touch(d,{phase:'move',gestureId:began.gestureId,points:[[200,400]]});
 assert.equal((await f.agent.snapshot(d)).source,'live-video');
 await f.agent.touch(d,{phase:'move',gestureId:began.gestureId,points:[[310,400]]});
 assert.deepEqual(f.calls.map(c=>c.op),['begin','move','move']);
 await f.agent.touch(d,{phase:'end',gestureId:began.gestureId});assert.equal(f.leases(),0);
 assert.deepEqual(f.calls.map(c=>c.op),['begin','move','move','end']);assert.ok(f.calls.every(c=>c.owner==='agent'));
 await assert.rejects(f.agent.touch(d,{phase:'move',gestureId:began.gestureId,points:[[2,3]]}),e=>e.code==='INPUT_EXPIRED');
});
test('full paths preflight every point and deadline before touching; unknown movement is cancelled, never replayed',async t=>{
 const f=fixture(t);
 await assert.rejects(f.agent.actions(d,{},[[[10,20],[500,20]]],100,0),e=>e.code==='INVALID_CONTACTS');assert.equal(f.calls.length,0);
 await assert.rejects(f.agent.actions(d,{_deadline:Date.now()},[[[10,20],[20,20]]],100,0),e=>e.code==='DEADLINE_EXCEEDED');assert.equal(f.calls.length,0);
 f.fail();await assert.rejects(f.agent.actions(d,{},[[[10,20],[20,20]]],100,0),e=>e.execution==='unknown');
 assert.deepEqual(f.calls.map(c=>c.op),['begin','move','cancel']);assert.equal(f.leases(),0);
});
test('text lookup still uses accessibility, input preserves Unicode, and snapshots use live frame provenance',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agent-live-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const {jpeg}=require('../../baguette-simulator/vendor/android/deps.cjs');
 const screen={width:2,height:3,displayId:1,rotation:'rot0'},calls=[];
 const live={actions:async(d,p,paths)=>{calls.push({paths});return {udid:d.udid,execution:'executed',transport:'continuous'};},snapshot:async()=>({image:jpeg.encode({width:2,height:3,data:Buffer.alloc(24,255)},90).data.toString('base64'),screen,source:'live-video',capturedAt:1000,frameAgeMs:30,sequence:9})};
 const agent=require('../../baguette-simulator/node/physical/agent.cjs').createAgent({root,live,devices:{screen:async()=>screen,capture:()=>{throw Error('must not capture separately');}},wda:{call:async(d,route,p,body)=>{
  if(route==='/wda/apps/list')return [];
  if(route==='/source?format=json')return {type:'XCUIElementTypeButton',label:'Next',name:'next',rect:{x:0,y:1,width:2,height:1}};
  if(route==='/cindy/keyboard-ready')return {ready:true};
  if(route==='/wda/keys'){calls.push(body);return;}
  assert.equal(route,'/appium/settings');
 }}});
 await agent.tap(d,{text:'Next',observe:'none'});assert.deepEqual(calls[0].paths,[[[1,1.5]]]);
 await agent.typeText(d,{text:'中文 👋',observe:'none'});assert.deepEqual(calls[1],{value:['中文 👋']});
 const shot=await agent.screenshot(d);assert.equal(shot.source,'live-video');assert.equal(shot.capturedAt,'1970-01-01T00:00:01.000Z');assert.equal(shot.sequence,9);assert.equal(shot.frameAgeMs,30);
});
