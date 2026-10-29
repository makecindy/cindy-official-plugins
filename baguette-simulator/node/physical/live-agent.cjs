'use strict';
const {randomUUID}=require('node:crypto');
const {fail}=require('./devices.cjs');
const {coordinates}=require('./realtime.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Agent steps and the viewer share the same generation and contact owner.
// A bounded held contact permits observe/move calls without replaying a path.
function createLiveAgent(live){
  const held=new Map();
  function deadline(p){if(p._deadline&&Date.now()>=p._deadline)throw fail('DEADLINE_EXCEEDED','操作时间已用尽，尚未发送新的触点。');}
  const send=(id,p)=>live.input(id,p,'agent');
  function forget(h){clearInterval(h.timer);if(held.get(h.udid)===h)held.delete(h.udid);h.release();}
  async function cancel(h){
    try{await send(h.udid,{session:h.session,op:'cancel',gesture:h.id});}
    finally{forget(h);}
  }
  function check(h,p){
    if(!h||h.id!==p.gestureId||Date.now()>=h.expiresAt)throw fail('INPUT_EXPIRED','触摸已结束或超时，请重新观察手机；旧动作不会重发。');
    deadline(p);
  }
  async function begin(d,p,points,expected){
    if(held.has(d.udid))throw fail('INPUT_BUSY','Agent 已有按住的触点，请先结束或取消。');
    const lease=await live.acquire(d,p),id=randomUUID();
    try{
      deadline(p);
      if(expected&&JSON.stringify(expected)!==JSON.stringify(lease.screen))throw fail('SCREEN_CHANGED','屏幕已变化，请重新观察后操作。');
      coordinates(points,lease.screen);
      await send(d.udid,{session:lease.session,op:'begin',gesture:id,screen:lease.screen,points});
    }catch(error){lease.release();throw error;}
    const h={...lease,id,udid:d.udid,points,expiresAt:Date.now()+30000,busy:false};held.set(d.udid,h);
    h.timer=setInterval(async()=>{
      if(h.busy)return;h.busy=true;
      try{
        if(Date.now()>=h.expiresAt)await cancel(h);
        else await send(h.udid,{session:h.session,op:'heartbeat',gesture:h.id});
      }catch{forget(h);}finally{h.busy=false;}
    },500);
    return h;
  }
  async function touch(d,p,expected){
    let h=held.get(d.udid);
    if(p.phase==='begin')h=await begin(d,p,p.points,expected);
    else{
      check(h,p);
      if(!['move','end','cancel'].includes(p.phase))throw fail('INVALID_OPERATION','触摸阶段无效。');
      if(p.phase==='move'&&!p.points)throw fail('INVALID_CONTACTS','移动触点需要 points 坐标。');
      const points=p.points||h.points;coordinates(points,h.screen);
      if(points.length!==h.points.length)throw fail('INVALID_CONTACTS','同一次触摸不能改变触点数量。');
      try{await send(d.udid,{session:h.session,op:p.phase,gesture:h.id,screen:h.screen,points});}
      catch(error){await cancel(h).catch(()=>{});throw error;}
      if(p.phase==='end'||p.phase==='cancel')forget(h);
      else{h.points=points;h.expiresAt=Date.now()+30000;}
    }
    return {udid:d.udid,execution:'executed',transport:'continuous',gestureId:h.id,
      phase:p.phase,screen:h.screen,inputFinishedAt:Date.now(),
      ...(['begin','move'].includes(p.phase)?{expiresAt:new Date(h.expiresAt).toISOString(),leaseMs:30000}:{})};
  }
  async function actions(d,p,paths,duration,hold,expected){
    if(!Array.isArray(paths)||!paths.length||paths.length>2||paths.some(a=>!Array.isArray(a)||!a.length||a.length>100))throw fail('INVALID_CONTACTS','触摸路径无效。');
    // Preflight the entire path before touch-down, including later samples.
    const lease=await live.acquire(d,p);
    try{for(const path of paths)for(const point of path)coordinates([point],lease.screen);expected ||= lease.screen;}
    finally{lease.release();}
    let h,started=false;
    try{
      if(p._deadline&&Date.now()+hold+duration+500>p._deadline)throw fail('DEADLINE_EXCEEDED','剩余时间不足以完成手势。');
      h=await begin(d,p,paths.map(a=>a[0]),expected);started=true;
      if(hold)await pause(hold);
      const start=Date.now();
      while(duration>0){
        check(h,{...p,gestureId:h.id});
        const fraction=Math.min(1,(Date.now()-start)/duration);
        const points=paths.map(path=>{
          const at=fraction*(path.length-1),i=Math.floor(at),a=path[i],b=path[Math.min(i+1,path.length-1)],f=at-i;
          return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
        });
        await send(d.udid,{session:h.session,op:'move',gesture:h.id,screen:h.screen,points});h.points=points;
        if(fraction===1)break;await pause(16);
      }
      await send(d.udid,{session:h.session,op:'end',gesture:h.id,screen:h.screen,points:paths.map(a=>a[a.length-1])});
      return {udid:d.udid,execution:'executed',transport:'continuous',inputFinishedAt:Date.now()};
    }catch(error){if(started)error.execution='unknown';throw error;}
    finally{if(h)await cancel(h).catch(()=>{});}
  }
  async function home(d,p){
    const lease=await live.acquire(d,p);
    try{
      deadline(p);
      if(held.has(d.udid))await cancel(held.get(d.udid));
      deadline(p);
      await send(d.udid,{session:lease.session,op:'home',exclusive:true});
      return {udid:d.udid,execution:'executed',transport:'continuous',inputFinishedAt:Date.now()};
    }finally{lease.release();}
  }
  return {actions,touch,home,snapshot:live.snapshot,
    async screen(d,p){const lease=await live.acquire(d,p);try{return lease.screen;}finally{lease.release();}},
    async release(id){const h=held.get(id);if(h)await cancel(h);return {udid:id,execution:h?'executed':'not_executed'};},
    async close(){await Promise.all([...held.values()].map(h=>cancel(h).catch(()=>{})));}};
}
module.exports={createLiveAgent};
