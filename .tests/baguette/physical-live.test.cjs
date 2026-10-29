'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {TouchStream,VideoWatchdog}=require('../../baguette-simulator/node/physical/realtime.js');
const {Packets,coordinates,createRealtime}=require('../../baguette-simulator/node/physical/realtime.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const screen={width:400,height:800,displayId:1,rotation:'rot0'};
test('quiet video allows a first input to respond, but repeated input cannot postpone recovery forever',()=>{
 let now=0;const clock=new VideoWatchdog(()=>now);
 now=24000;assert.equal(clock.expired(),false);now=26000;assert.equal(clock.expired(),true);
 clock.frame();now+=30000;assert.equal(clock.expired(),false);
 clock.input();assert.equal(clock.expired(true),false);
 now+=4000;clock.input();assert.equal(clock.expired(),false);
 now+=1001;assert.equal(clock.expired(),true);
 clock.frame();assert.equal(clock.expired(),false);
 now+=5001;assert.equal(clock.expired(true),true);assert.equal(clock.expired(),false);
 now+=35000;assert.equal(clock.expired(),true);
});
test('continuous down is sent before release, backpressure coalesces moves and reversal precedes up',async t=>{
 const sent=[],pending=[];const input=new TouchStream(p=>{sent.push(p);return new Promise(resolve=>pending.push(resolve));},e=>{throw e;});t.after(()=>input.current&&input.clear(input.current));
 input.begin([[300,400]],screen);assert.equal(sent[0].op,'begin');
 for(let n=0;n<1000;n++)input.move([[n%200,400]]);
 assert.equal(sent.length,1);pending.shift()();await tick();assert.deepEqual(sent[1].points,[[199,400]]);
 input.move([[310,400]]);pending.shift()();await tick();assert.deepEqual(sent[2].points,[[310,400]]);assert.equal(sent[2].op,'move');
 input.end([[310,400]]);pending.shift()();await tick();assert.equal(sent[3].op,'end');pending.shift()();await tick();assert.equal(input.current,null);
});
test('cancel drops unsent movement and never starts a new contact after a lost acknowledgement',async t=>{
 let release;const sent=[],errors=[];const input=new TouchStream(p=>{sent.push(p);return sent.length===1?new Promise(r=>release=r):Promise.resolve();},e=>errors.push(e));t.after(()=>input.current&&input.clear(input.current));
 input.begin([[10,20],[30,40]],screen);input.move([[50,60],[70,80]]);input.cancel();release();await tick();assert.deepEqual(sent.map(p=>p.op),['begin','cancel']);assert.equal(input.current,null);
 const failed=[],bad=new TouchStream(p=>{failed.push(p.op);return p.op==='cancel'?Promise.resolve():Promise.reject(Error('lost'));},e=>errors.push(e));bad.begin([[1,2]],screen);await tick();assert.deepEqual(failed,['begin','cancel']);assert.equal(bad.current,null);assert.equal(errors.length,1);
});
test('video parser handles split headers/access units and rejects oversized packets',()=>{
 const packets=[],decoder=new Packets(p=>packets.push(p)),one=Buffer.from([0,0,0,3,0,9,8]),two=Buffer.from([0,0,0,2,1,7]);
 decoder.push(one.subarray(0,2));decoder.push(Buffer.concat([one.subarray(2),two]));assert.deepEqual(packets,[one,two]);
 assert.throws(()=>decoder.push(Buffer.from([127,255,255,255])),/Invalid video/);
 assert.deepEqual(coordinates([[0,0],[400,800]],screen),[[0,0],[65535,65535]]);
 for(const points of [[[401,1]],[[NaN,2]],[],[[1,2],[3,4],[5,6]]])assert.throws(()=>coordinates(points,screen));
});
test('live backend binds input to an open video generation and bounds contact ownership',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'physical-live-')),sent=[];let child;
 const packet=data=>{const bytes=Buffer.from(JSON.stringify(data)),head=Buffer.alloc(5);head.writeUInt32BE(bytes.length+1);head[4]=3;return Buffer.concat([head,bytes]);};
 const live=createRealtime({root,run:async()=>{},devices:{endpoint(){},screen:async()=>screen},spawnImpl:()=>{
  child=new EventEmitter();Object.assign(child,{exitCode:null,signalCode:null,stdout:new PassThrough(),stderr:new PassThrough(),kill(){this.exitCode=0;this.emit('close');}});
  child.stdin=new Writable({write(chunk,encoding,done){const p=JSON.parse(chunk);if(p.serial)setImmediate(()=>child.stdout.write(packet({type:'codec',codec:'test',screen})));else{sent.push(p);setImmediate(()=>child.stdout.write(packet({type:'ack',id:p.id,ok:true,execution:'dispatched'})));}done();}});return child;
 }});t.after(async()=>{await live.close();await fs.rm(root,{recursive:true,force:true});});
 const d={udid:'test',hardwareUdid:'hardware',developerMode:true};await live.start(d);for(let n=0;n<100&&!live.state('test').ready;n++)await new Promise(r=>setTimeout(r,5));
 const {session}=live.state('test'),g=crypto.randomUUID();
 await assert.rejects(live.input('test',{session,op:'begin',gesture:g,screen,points:[[3,4]]}),e=>e.code==='LIVE_EXPIRED');
 const res=new EventEmitter();Object.assign(res,{writeHead(){},write(){return true;},writableLength:0,destroy(){this.emit('close');}});live.pipe('test',session,res);await tick();
 await assert.rejects(live.input('test',{session:'stale',op:'begin',gesture:g}),e=>e.code==='LIVE_EXPIRED');
 await live.input('test',{session,op:'begin',gesture:g,screen,points:[[3,4]]});
 await assert.rejects(live.input('test',{session,op:'begin',gesture:crypto.randomUUID(),screen,points:[[3,4]]}),e=>e.code==='INPUT_BUSY');
 await assert.rejects(live.input('test',{session,op:'move',gesture:crypto.randomUUID(),screen,points:[[8,9]]}),e=>e.code==='INPUT_EXPIRED');
 await live.input('test',{session,op:'move',gesture:g,screen,points:[[10,20]]});
 res.destroy();await tick();assert.deepEqual(sent.map(p=>p.op),['start','begin','move','cancel']);
 // Buffered output from an already stopped helper cannot resurrect readiness.
 child.stdout.write(packet({type:'codec',codec:'stale',screen}));await tick();assert.equal(live.state('test').ready,false);assert.equal(live.state('test').state,'disconnected');
});
test('Agent media works without a viewer and viewer closure preserves held Agent input; snapshots await post-input frames',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'physical-agent-media-')),sent=[];let child,frame={capturedAt:100,sequence:1};
 const emit=data=>{const bytes=Buffer.from(JSON.stringify(data)),head=Buffer.alloc(5);head.writeUInt32BE(bytes.length+1);head[4]=3;child.stdout.write(Buffer.concat([head,bytes]));};
 const live=createRealtime({root,run:async()=>{},devices:{endpoint(){},screen:async()=>screen},spawnImpl:()=>{
  child=new EventEmitter();Object.assign(child,{exitCode:null,signalCode:null,stdout:new PassThrough(),stderr:new PassThrough(),kill(){this.exitCode=0;this.emit('close');}});
  child.stdin=new Writable({write(chunk,encoding,done){const p=JSON.parse(chunk);if(!p.serial){sent.push(p);setImmediate(()=>{if(p.op==='start')emit({type:'frame',...frame});else emit({type:'ack',id:p.id,ok:true,execution:'dispatched',...(p.op==='snapshot'?{...frame,image:'fixture',screen}:{})});});}done();}});return child;
 }});t.after(async()=>{await live.close();await fs.rm(root,{recursive:true,force:true});});
 const d={udid:'test',hardwareUdid:'hardware',developerMode:true},lease=await live.acquire(d),gesture=crypto.randomUUID();
 await live.input(d.udid,{session:lease.session,op:'begin',gesture,screen,points:[[3,4]]},'agent');
 const res=new EventEmitter();Object.assign(res,{writeHead(){},write(){return true;},writableLength:0,destroy(){this.emit('close');}});live.pipe(d.udid,lease.session,res);res.destroy();await tick();
 assert.equal(child.exitCode,null);assert.equal(sent.some(p=>p.op==='cancel'),false);
 const pending=live.snapshot(d,{_frameAfter:200});await new Promise(r=>setTimeout(r,40));assert.equal(sent.some(p=>p.op==='snapshot'),false);
 frame={capturedAt:210,sequence:2};emit({type:'frame',...frame});const shot=await pending;
 assert.equal(shot.source,'live-video');assert.equal(shot.sequence,2);assert.equal(shot.capturedAt,210);
 await live.input(d.udid,{session:lease.session,op:'end',gesture,screen,points:[[3,4]]},'agent');lease.release();
 await live.disconnect(d.udid);await assert.rejects(live.input(d.udid,{session:lease.session,op:'begin',gesture,screen,points:[[3,4]]},'agent'),e=>e.code==='LIVE_EXPIRED');
});
