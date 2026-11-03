'use strict';
// Preview-only metadata. Input/export continue to discover the phone and its
// geometry afresh. No timer survives a viewer; refresh is driven by frame reads.
function createPreview({devices,wda,agent,now=Date.now}){
  const entries=new Map();
  function refresh(e,id){
    if(e.refresh)return e.refresh;
    const at=now(),p={_deadline:Date.now()+5000};
    e.refresh=(async()=>{
      const device=await devices.target({udid:id,...p}),screen=await devices.screen(device,p);
      e.snapshot={device,screen,at};e.error=null;
    })().catch(error=>{e.snapshot=null;e.error=error;throw error;}).finally(()=>{e.refresh=null;});
    return e.refresh;
  }
  async function capture(e,id){
    const p={_deadline:Date.now()+15000};
    if(!wda.state(id).ready){e.snapshot=null;return agent.preview(await devices.target({udid:id,...p}),p);}
    if(!e.snapshot||now()-e.snapshot.at>=2000)await refresh(e,id);
    else if(now()-e.snapshot.at>=750)void refresh(e,id).catch(()=>{});
    if(e.error)throw e.error;
    const snapshot=e.snapshot;
    try{return await agent.preview(snapshot.device,p,snapshot.screen);}
    catch(error){e.snapshot=null;throw error;}
  }
  return {frame(id){
    let e=entries.get(id);if(!e){e={};entries.set(id,e);}
    // Sidebar and device management share a capture, never a queue of old frames.
    if(!e.frame)e.frame=capture(e,id).finally(()=>{e.frame=null;});
    return e.frame;
  },clear(){entries.clear();}};
}
module.exports={createPreview};
