const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile);
const {createAudio,playbackStatus}=require('../../baguette-simulator/node/audio.cjs');
class Failure extends Error {constructor(code,message,execution='not_executed'){super(message);Object.assign(this,{code,execution});}}
test('Apple cold boot preparation mutes before clients start and preserves routing and per-device volume',{skip:process.platform!=='darwin'},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cindy-audio-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const audio=createAudio({deviceSet:root,run:async(file,args)=>exec(file,args),Failure}),a={udid:'a'},b={udid:'b'};
  assert.equal((await audio.prepare(a,false)).enabled,false);
  const file=path.join(root,'a/data/var/run/simulatoraudio/audiosettings.plist');
  await exec('/usr/bin/plutil',['-replace','sim_output_device_uid','-string','fixture-output',file]);
  await exec('/usr/bin/plutil',['-replace','sim_volume','-integer','35',file]);
  assert.equal((await audio.set(a,false)).enabled,false);
  assert.equal((await audio.set(a,true)).volume,35);
  assert.equal((await audio.prepare(b,false)).enabled,false);
  assert.equal((await audio.set(b,true)).volume,60);
  assert.equal((await audio.status(a)).volume,35);
  assert.equal((await exec('/usr/bin/plutil',['-extract','sim_output_device_uid','raw','-o','-',file])).stdout.trim(),'fixture-output');
  assert.equal((await audio.prepare(a,false)).volume,0,'the next cold boot is muted again');
  await assert.rejects(audio.set(a,'yes'),{code:'INVALID_ARGUMENT'});
});
test('unconfirmed readback never reports a successful mute or breaks the rest of the viewer',async()=>{
  let reads=0,writes=0;
  const audio=createAudio({deviceSet:'/fixture',Failure,run:async(_file,args)=>{
    if(args[0]==='-replace'){writes++;return {stdout:''};}
    if(++reads===2)throw new Failure('READ_FAILED','unreadable');
    return {stdout:'{"sim_volume":60}'};
  }});
  await assert.rejects(audio.set({udid:'a'},false),e=>e.code==='READ_FAILED'&&e.execution==='unknown');
  assert.equal(writes,1);
  assert.deepEqual(await playbackStatus({request:async()=>{throw new Failure('READ_FAILED','unreadable');}},{udid:'a',state:'Booted'}),{enabled:null,errorCode:'READ_FAILED'});
  assert.equal(await playbackStatus(null,{state:'Shutdown'}),null);
});
