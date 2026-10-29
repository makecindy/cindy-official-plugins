'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID,createHash}=require('node:crypto');
const {fail}=require('./devices.cjs');

// Framed HEVC access units plus private JSON control messages. Bound both the
// helper pipe and browser queues; slow consumers reconnect at a fresh keyframe.
class Packets {
  constructor(receive){this.bytes=Buffer.alloc(0);this.receive=receive;}
  push(chunk){
    this.bytes=Buffer.concat([this.bytes,chunk]);
    while(this.bytes.length>=4){
      const length=this.bytes.readUInt32BE(0);
      if(length<1||length>8*1024*1024)throw Error('Invalid video packet');
      if(this.bytes.length<length+4)return;
      const packet=this.bytes.subarray(0,length+4);this.bytes=this.bytes.subarray(length+4);this.receive(packet);
    }
  }
}
function coordinates(points,screen){
  if(!Array.isArray(points)||points.length<1||points.length>2||points.some(p=>!Array.isArray(p)||p.length!==2||p.some((v,i)=>!Number.isFinite(v)||v<0||v>(i?screen.height:screen.width))))throw fail('INVALID_CONTACTS','触点坐标无效。');
  return points.map(([x,y])=>[Math.round(x/screen.width*65535),Math.round(y/screen.height*65535)]);
}
function createRealtime({root,run,devices,children=new Set(),spawnImpl=spawn}){
  const entries=new Map(),starts=new Map();let preparingRuntime;
  async function runtime(){
    if(preparingRuntime)return preparingRuntime;
    preparingRuntime=(async()=>{
      const requirements=path.join(__dirname,'realtime-requirements.txt'),hash=createHash('sha256').update(await fs.readFile(requirements)).digest('hex');
      const dir=path.join(root,'realtime',hash.slice(0,16)),python=path.join(dir,'bin/python'),stamp=path.join(dir,'ready');
      if(await fs.readFile(stamp,'utf8').catch(()=>'')===hash)return python;
      await fs.mkdir(dir,{recursive:true,mode:0o700});
      // Xcode's Python, in an isolated environment. No global packages, shell,
      // user pip configuration, unpinned dependency or source-build execution.
      await run('/usr/bin/python3',['-m','venv',dir],{timeout:30000});
      await run(python,['-I','-m','pip','--isolated','--disable-pip-version-check','install','--index-url','https://pypi.org/simple','--only-binary=:all:','--require-hashes','-r',requirements],{timeout:240000,maxBuffer:4*1024*1024});
      await run(python,['-I','-c','import av; from pymobiledevice3.remote.core_device.screen_stream import ScreenStreamServer; from pymobiledevice3.remote.native_tunnel import NativeRemotedTunnel'],{timeout:15000});
      await fs.writeFile(stamp,hash,{mode:0o600});return python;
    })().catch(e=>{preparingRuntime=null;throw e;});return preparingRuntime;
  }
  const state=id=>{const e=entries.get(id);return e&&!e.stopped?{revision:2,state:e.state,phase:e.phase,ready:e.state==='ready',session:e.session,screen:e.screen,...(e.error?{error:e.error}:{}),stream:e.health,transport:'continuous'}:{revision:2,ready:false,state:'disconnected',transport:'continuous'};};
  function rejectPending(e){for(const p of e.pending.values()){clearTimeout(p.timer);p.reject(fail('LIVE_DISCONNECTED','实时连接已中断，正在重新连接。',p.mutation?'unknown':'not_executed'));}e.pending.clear();}
  function stop(e){
    if(e.stopping)return e.stopping;
    e.stopped=true;e.state='disconnected';clearTimeout(e.idle);rejectPending(e);
    for(const res of e.subscribers.keys())res.destroy();e.subscribers.clear();
    e.stopping=(async()=>{
      // Shared runtime preparation may continue; the stopped generation checks
      // its flag after every await and cannot spawn a late helper.
      const child=e.child;if(!child||child.exitCode!==null||child.signalCode)return;
      const closed=new Promise(resolve=>child.once('close',resolve));child.stdin.end();child.kill('SIGTERM');
      let timer;await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);clearTimeout(timer);
      if(child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');
    })();return e.stopping;
  }
  function command(e,body,mutation=false,timeout=2500){
    if(e.stopped||!e.child||e.child.exitCode!==null)return Promise.reject(fail('LIVE_DISCONNECTED','实时连接已中断，请等待画面恢复。'));
    if(e.pending.size>=8)return Promise.reject(fail('INPUT_BUSY','输入尚在处理中。'));
    return new Promise((resolve,reject)=>{
      const id=randomUUID(),timer=setTimeout(()=>{e.pending.delete(id);reject(fail('LIVE_TIMEOUT','实时连接响应超时，已停止本次操作。',mutation?'unknown':'not_executed'));void stop(e);},timeout);
      e.pending.set(id,{resolve,reject,timer,mutation});
      e.child.stdin.write(JSON.stringify({...body,id})+'\n',error=>{if(error){void stop(e);}});
    });
  }
  async function startDevice(d){
    let e=entries.get(d.udid);
    if(e&&!e.stopped&&['running','ready'].includes(e.state))return state(d.udid);
    if(!d.developerMode)throw fail('DEVELOPER_MODE_REQUIRED','请在手机上开启开发者模式，并在 Xcode 中完成设备准备。');
    devices.endpoint(d,1);
    const previous=e;
    e={session:randomUUID(),state:'running',phase:'runtime',pending:new Map(),subscribers:new Map(),stopped:false,gesture:null,agents:0};entries.set(d.udid,e);
    e.starting=(async()=>{
      if(previous)await stop(previous);if(e.stopped)return;
      const screen=await devices.screen(d);if(e.stopped)return;e.screen=screen;
      const python=await runtime();if(e.stopped)return;e.phase='connecting';
      const child=spawnImpl(python,['-I','-u',path.join(__dirname,'realtime.py')],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:'en_US.UTF-8'}});e.child=child;children.add(child);let errors='';
      const decoder=new Packets(packet=>{
        if(e.stopped||child.exitCode!==null)return;
        const type=packet[4];
        if(type===3){
          const data=JSON.parse(packet.subarray(5));
          if(data.type==='health'){e.health={...data,forwarded:e.frames||0};return;}
          if(data.type==='frame'){e.frame=data;return;}
          if(data.type==='frame-invalid'){e.frame=null;return;}
          if(data.type==='released'){if(e.gesture===data.gesture)e.gesture=null;return;}
          if(data.type==='ack'){
            const pending=e.pending.get(data.id);if(!pending)return;e.pending.delete(data.id);clearTimeout(pending.timer);
            if(data.ok)pending.resolve(data);else pending.reject(fail('LIVE_INPUT_FAILED',data.message,data.execution));return;
          }
          if(data.type==='codec'){e.codec=packet;e.state='ready';e.phase='ready';e.lastFrame=Date.now();}
        }else if(type<=2){e.lastFrame=Date.now();e.frames=(e.frames||0)+1;}else throw Error('Invalid packet type');
        for(const [res,subscriber] of e.subscribers){
          if(type===3){res.write(packet);continue;}
          if(subscriber.needsKey&&type===1)continue;
          subscriber.needsKey=false;
          if(res.writableLength>1024*1024)res.destroy();else res.write(packet);
        }
      });
      child.stdout.on('data',chunk=>{try{decoder.push(chunk);}catch{void stop(e);}});
      child.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-4000);});
      child.stdin.on('error',()=>{});
      child.on('error',error=>{e.error={message:'无法启动实时连接组件：'+error.message};void stop(e);});
      let finished=false;const finishedChild=()=>{
        if(finished)return;finished=true;
        if(errors)void fs.writeFile(path.join(root,'realtime',d.udid+'.log'),errors,{mode:0o600}).catch(()=>{});
        children.delete(child);rejectPending(e);for(const res of e.subscribers.keys())res.destroy();e.subscribers.clear();
        if(!e.stopped){e.state='failed';e.error={message:/DISPLAY_ASLEEP|locked/i.test(errors)?'请唤醒并解锁手机，画面会自动恢复。':/SCREEN_CHANGED/.test(errors)?'屏幕已变化，正在重新连接。':'实时连接已中断，正在重新连接。'};}
      };
      child.once('exit',finishedChild);child.once('close',finishedChild);
      child.stdin.write(JSON.stringify({serial:d.hardwareUdid,screen})+'\n');e.state='ready';
      e.idle=setTimeout(()=>{if(!e.subscribers.size&&!e.agents)void stop(e);},35000);
    })().catch(error=>{if(!e.stopped){e.state='failed';e.error={message:'实时连接准备失败：'+error.message};}});
    return state(d.udid);
  }
  function start(d){
    if(starts.has(d.udid))return starts.get(d.udid);
    const pending=startDevice(d).finally(()=>starts.delete(d.udid));starts.set(d.udid,pending);return pending;
  }
  function entry(id,session){const e=entries.get(id);if(!e||e.stopped||e.session!==session||e.state!=='ready')throw fail('LIVE_EXPIRED','实时连接正在恢复，请等待画面更新。');return e;}
  function startMedia(e){if(!e.started){e.started=true;e.child.stdin.write(JSON.stringify({op:'start'})+'\n');}}
  async function wait(e,p,predicate){
    const end=Math.min(p._deadline||Infinity,Date.now()+30000);
    while(!predicate()){
      if(e.stopped||e.state==='failed')throw fail('LIVE_DISCONNECTED',e.error?.message||'实时连接已中断，请重新观察手机。');
      if(Date.now()>=end)throw fail('LIVE_PREPARING','实时画面尚未就绪，请稍后重新观察；不要因此重复输入。');
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    if(e.stopped||e.state==='failed')throw fail('LIVE_DISCONNECTED','实时连接已中断，请重新观察手机。');
    if(Date.now()>=end)throw fail('LIVE_PREPARING','实时画面等待已超时，请重新观察；不要因此重复输入。');
  }
  async function acquire(d,p={}){
    await start(d);const e=entries.get(d.udid);e.agents++;clearTimeout(e.idle);
    let released=false;
    const release=()=>{if(released)return;released=true;e.agents--;if(!e.stopped&&!e.agents){clearTimeout(e.idle);e.idle=setTimeout(()=>{if(!e.agents&&!e.subscribers.size)void stop(e);},30000);}};
    try{
      await wait(e,p,()=>e.state==='ready');clearTimeout(e.idle);startMedia(e);
      await wait(e,p,()=>!!e.frame);
      return {session:e.session,screen:e.screen,release};
    }catch(error){release();throw error;}
  }
  async function snapshot(d,p={}){
    const lease=await acquire(d,p);
    try{
      const e=entry(d.udid,lease.session);
      await wait(e,{...p,_deadline:Math.min(p._deadline||Infinity,Date.now()+5000)},()=>e.frame&&(!p._frameAfter||e.frame.capturedAt>=p._frameAfter));
      const shot=await command(e,{op:'snapshot'},false,Math.max(1,Math.min(5000,(p._deadline||Infinity)-Date.now())));
      if(p._frameAfter&&shot.capturedAt<p._frameAfter)throw fail('STALE_FRAME','尚未收到操作后的新画面，请重新观察；不要重复操作。');
      return {...shot,source:'live-video',session:e.session,frameAgeMs:Math.max(0,Date.now()-shot.capturedAt)};
    }finally{lease.release();}
  }
  function pipe(id,session,res){
    const e=entry(id,session);clearTimeout(e.idle);
    res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store'});res.flushHeaders?.();if(e.codec)res.write(e.codec);
    const subscriber={needsKey:true};e.subscribers.set(res,subscriber);
    if(!e.started)startMedia(e);
    else if(e.codec)void command(e,{op:'keyframe'}).catch(()=>res.destroy());
    // Some device encoders ignore PLI. A new viewer must not remain frozen on
    // metadata forever. Retire the generation only when no contact is held.
    const bootstrap=setInterval(()=>{if(!subscriber.needsKey){clearInterval(bootstrap);return;}if(e.codec&&!e.gesture)void stop(e);},4000);
    res.once('close',()=>{
      clearInterval(bootstrap);e.subscribers.delete(res);
      if(!e.stopped&&!e.subscribers.size){
        if(e.owner!=='agent'){void command(e,{op:'cancel'}).catch(()=>{});e.gesture=null;}
        if(!e.agents)void stop(e);
      }
    });
  }
  async function input(id,p,owner='viewer'){
    const e=entry(id,p.session);
    if(!e.subscribers.size&&!e.agents)throw fail('LIVE_EXPIRED','请等待实时画面恢复后再操作。');
    if(!['begin','move','end','cancel','heartbeat','keyframe','home'].includes(p.op))throw fail('INVALID_OPERATION','输入类型无效。');
    if(p.op==='keyframe')return command(e,{op:p.op});
    if(p.op==='home'){if(p.exclusive&&e.gesture)throw fail('INPUT_BUSY','手机已有按住的触点，请先结束当前触摸。');e.gesture=null;return command(e,{op:'home'},true);}
    if(typeof p.gesture!=='string'||!/^[a-f0-9-]{36}$/i.test(p.gesture))throw fail('INVALID_CONTACTS','触点标识无效。');
    if(p.op==='begin'&&e.gesture)throw fail('INPUT_BUSY','已有触点正在操作。');
    if(p.op!=='begin'&&e.gesture!==p.gesture){if(p.op==='move')throw fail('INPUT_EXPIRED','本次触摸已结束，请重新操作。');return {execution:'not_executed'};}
    if(['begin','move','end'].includes(p.op)&&JSON.stringify(p.screen)!==JSON.stringify(e.screen))throw fail('SCREEN_CHANGED','屏幕已变化，请等待画面刷新。');
    const points=['begin','move','end'].includes(p.op)?coordinates(p.points,e.screen):undefined;
    if(p.op==='begin'){e.gesture=p.gesture;e.owner=owner;}
    try{return await command(e,{op:p.op,gesture:p.gesture,points,screen:e.screen},!['heartbeat','keyframe'].includes(p.op));}
    catch(error){void stop(e);throw error;}
    finally{if(['cancel','end'].includes(p.op))e.gesture=null;}
  }
  return {start,state,pipe,input,acquire,snapshot,async disconnect(id){const e=entries.get(id);if(e)await stop(e);},
    async closeViewers(){for(const e of entries.values())for(const res of e.subscribers.keys())res.destroy();await Promise.all([...entries.values()].filter(e=>!e.agents).map(stop));},
    async close(){await Promise.all([...entries.values()].map(stop));entries.clear();}};
}
module.exports={createRealtime,Packets,coordinates};
