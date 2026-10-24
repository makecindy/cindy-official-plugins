const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createTrackpad}=require('../../cindy-simulator/node/trackpad.cjs');
const gesture='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sample=(phase,extra={})=>({gesture,phase,x:.5,y:.5,...extra});
function setup(){
 const children=new Set(),spawned=[];
 class Failure extends Error{constructor(code,message,execution){super(message);this.code=code;this.execution=execution;}}
 const manager=createTrackpad({binary:'trackpad',deviceSet:'/owned',children,Failure,spawnProcess(file,args){
  const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),writes:[],args});
  child.stdin.on('data',data=>child.writes.push(data.toString()));
  child.kill=()=>child.emit('close',1);spawned.push(child);return child;
 }});
 return {manager,children,spawned};
}
test('trackpad rejects malformed contacts without spawning and isolates gesture ownership',async()=>{
 const s=setup();
 for(const p of [sample('bad'),sample('began',{x:NaN}),sample('began',{y:1.1}),sample('began',{gesture:'bad'})])await assert.rejects(s.manager.send('device',p,'/Xcode'),e=>e.code==='INVALID_ARGUMENT');
 assert.equal(s.spawned.length,0);
 await assert.rejects(s.manager.send('device',sample('changed')),e=>e.code==='INPUT_EXPIRED');
 const start=s.manager.send('device',sample('began'),'/Xcode'),child=s.spawned[0];
 assert.deepEqual(child.args,['/owned','device','/Xcode']);
 await assert.rejects(s.manager.send('device',sample('began'),'/Xcode'),e=>e.code==='INPUT_BUSY');
 await assert.rejects(s.manager.send('device',sample('changed')),e=>e.code==='INPUT_BUSY');
 child.stdout.write('ready\n');await tick();assert.deepEqual(child.writes,['0 0.5 0.5\n']);child.stdout.write('ok\n');await start;
 await assert.rejects(s.manager.send('device',sample('changed',{gesture:other})),e=>e.code==='INPUT_EXPIRED');
 const end=s.manager.stop();assert.equal(child.stdin.writableEnded,true);child.emit('close',0);await end;assert.equal(s.children.size,0);
});
test('trackpad ends only on native release acknowledgement and reuses the warm connection',async()=>{
 const s=setup(),start=s.manager.send('device',sample('began'),'/Xcode'),child=s.spawned[0];
 child.stdout.write('ready\n');await tick();child.stdout.write('ok\n');assert.equal((await start).execution,'executed');
 const move=s.manager.send('device',sample('changed',{y:.8}));await tick();assert.equal(child.writes.at(-1),'1 0.5 0.8\n');child.stdout.write('ok\n');await move;
 let finished=false;const end=s.manager.send('device',sample('ended',{y:.8})).then(()=>{finished=true;});await tick();
 assert.equal(finished,false);child.stdout.write('ok\n');await end;assert.equal(s.children.size,1);
 await assert.rejects(s.manager.send('device',sample('changed')),e=>e.code==='INPUT_EXPIRED');
 await s.manager.cancel('device');assert.equal(child.stdin.writableEnded,false,'idle input connection does not block keyboard input');
 const again=s.manager.send('device',sample('began'),'/Xcode');await tick();assert.equal(s.spawned.length,1);child.stdout.write('ok\n');await again;
 let closed=false;const stop=s.manager.stop().then(()=>{closed=true;});await tick();assert.equal(closed,false);assert.equal(child.stdin.writableEnded,true);
 child.emit('close',0);await stop;assert.equal(s.children.size,0);
});
test('trackpad lost acknowledgement is unknown, closes stdin, and never replays the motion',async()=>{
 const s=setup(),start=s.manager.send('device',sample('began'),'/Xcode'),child=s.spawned[0];
 child.stdout.write('ready\n');await tick();child.emit('close',1);
 await assert.rejects(start,e=>e.code==='INPUT_FAILED'&&e.execution==='unknown');
 assert.equal(child.stdin.writableEnded,true);assert.equal(child.writes.length,1);assert.equal(s.spawned.length,1);
});
test('trackpad unavailable before ready is not executed and cleans up child ownership',async()=>{
 const s=setup(),start=s.manager.send('device',sample('began'),'/Xcode'),child=s.spawned[0];
 child.emit('error',Error('ENOENT'));child.emit('close',-2);
 await assert.rejects(start,e=>e.execution==='not_executed');assert.equal(child.writes.length,0);assert.equal(s.children.size,0);
});

test('preparing the viewer opens the channel without sending a contact',async()=>{
 const s=setup(),ready=s.manager.prepare('device','/Xcode'),child=s.spawned[0];
 child.stdout.write('ready\n');await ready;assert.equal(child.writes.length,0);assert.equal(s.manager.has('device'),true);
 await s.manager.prepare('device','/Xcode');assert.equal(s.spawned.length,1);
 const stopped=s.manager.stop();child.emit('close',0);await stopped;assert.equal(s.manager.has('device'),false);
});
