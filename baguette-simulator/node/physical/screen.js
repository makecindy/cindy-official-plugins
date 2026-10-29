'use strict';
(() => {
  const udid=location.pathname.split('/')[2],token=new URLSearchParams(location.search).get('cindyViewer');
  const $=id=>document.getElementById(id),canvas=$('display'),ctx=canvas.getContext('2d'),frame=$('nativeDeviceFrame'),keyboard=$('keyboard');
  const zh=parent.document.documentElement.lang==='zh-CN',t=(cn,en)=>zh?cn:en;
  canvas.setAttribute('aria-label',t('手机画面','Phone screen'));keyboard.setAttribute('aria-label',t('电脑键盘输入','Computer keyboard input'));
  const overlay=new window.Baguette._PinchOverlay($('screenArea'));
  const shell=window.PhysicalShell?new window.PhysicalShell(frame,$('screenArea'),()=>fit()):null;
  let screen=null,available=false,ready=false,preparing=false,closed=false,gesture=null,wheel=null,wheelTimer,epoch=0,queue=Promise.resolve(),queued=0,noticeTimer,fast=false,pendingText=null;
  function connection(error){
    const code=error?.errorCode||error?.code;
    const asleep=code==='DISPLAY_ASLEEP',waiting=asleep||code==='DISPLAY_UNAVAILABLE';
    const offline=['DEVICE_DISCONNECTED','DEVICE_NOT_FOUND','DEVICE_TUNNEL_UNAVAILABLE'].includes(code);
    $('message-title').textContent=asleep?t('手机屏幕已熄灭','Phone screen is off'):waiting?t('等待手机画面','Waiting for phone screen'):offline?t('手机连接已断开','Phone disconnected'):t('正在连接手机画面','Connecting to phone');
    $('message-body').textContent=waiting?t('请保持手机亮屏并解锁，画面会自动恢复。','Keep the phone awake and unlocked. The view will resume automatically.'):offline?t('请检查 USB 或网络连接，连接恢复后会自动继续。','Check USB or network connectivity. The view will resume when connected.'):t('正在获取画面，请稍候。','Retrieving the screen. Please wait.');
    $('message-retry-label').textContent=t('正在自动连接…','Connecting automatically…');
    $('message').hidden=false;frame.style.opacity='.18';
  }
  function notice(message,persistent=false){clearTimeout(noticeTimer);$('notice-text').textContent=message;$('notice').hidden=!message;if(!persistent)noticeTimer=setTimeout(()=>{$('notice').hidden=true;},5000);}
  let live=null;
  function cancel(){live?.input.cancel();gesture=null;wheel=null;clearTimeout(wheelTimer);overlay.clear();}
  function status(c){
    const wasPreparing=preparing;ready=!!c.ready;preparing=c.state==='running';
    if(preparing)notice(c.phase==='waiting_unlock'
      ?t('请解锁手机并保持亮屏，解锁后会继续连接控制。','Unlock the phone and keep it awake. Control setup will continue automatically.')
      :c.phase==='connecting'?t('正在连接手机控制…','Connecting phone control…')
      :t('正在准备手机操作，画面仍可查看…','Preparing phone control. Viewing remains available…'),true);
    else if(wasPreparing&&ready)notice(t('已可操作手机，请重新点击或输入。','Phone control is ready. Click or type again.'));
    else if(c.error)notice(c.error.message,true);
  }
  async function api(action,args={}){
    const response=await fetch('/physical-api',{method:'POST',headers:{'Content-Type':'application/json','X-Cindy-Clipboard':token},body:JSON.stringify({action,udid,...args}),signal:AbortSignal.timeout(action==='frame'?20000:action==='status'?12000:115000)});
    const r=await response.json();if(!response.ok||r.ok===false)throw Object.assign(Error(r.message||r.errorCode),r);return r;
  }
  function error(e){
    notice((e.message||String(e))+(e.execution==='unknown'?t(' 执行结果未确认，请先查看手机，勿重复发送。',' Result unconfirmed. Inspect the phone before repeating.'):''),true);
    $('teams').replaceChildren();
    for(const team of e.teams||[]){const b=document.createElement('button');b.textContent=team.name;b.title=team.id;b.onclick=()=>{$('teams').replaceChildren();perform('connect',{teamId:team.id});};$('teams').append(b);}
  }
  function perform(action,args={}){
    const textOnly=action==='type'&&typeof args.text==='string'&&!args.keys;
    if(textOnly&&pendingText?.epoch===epoch&&pendingText.args.text.length+args.text.length<=8000){pendingText.args.text+=args.text;return pendingText.promise;}
    pendingText=null;
    if(queued>=128){notice(t('输入尚在处理中，请稍候。','Input is still processing. Please wait.'));return;}
    const current=epoch;queued++;
    const batch=textOnly?{args:{...args},epoch:current}:null;if(batch){args=batch.args;pendingText=batch;}
    const next=queue.then(async()=>{
      if(pendingText===batch)pendingText=null;
      if(current!==epoch||closed)return;
      const progress=setTimeout(()=>notice(t('正在操作手机…','Sending input to phone…'),true),250);
      let r;try{r=await api(action,args);}finally{clearTimeout(progress);}
      if(r.execution==='executed')notice('');
      if(r.control)status(r.control);else if(action==='connect')status(r);
      if(r.preparing||action==='connect'){epoch++;cancel();}
    }).catch(e=>{epoch++;preparing=false;cancel();error(e);}).finally(()=>{queued--;});
    queue=next;if(batch)batch.promise=next;return next;
  }
  function canInput(){
    if(!screen||!available)return false;
    if(live)return live.ready;
    if(ready)return true;
    if(!preparing){preparing=true;notice(t('正在准备手机操作，画面仍可查看…','Preparing phone control. Viewing remains available…'),true);perform('connect');}return false;
  }
  const clamp=(n,max)=>Math.max(0,Math.min(max,n));
  function point(e){const r=canvas.getBoundingClientRect();return [clamp((e.clientX-r.left)/r.width*screen.width,screen.width),clamp((e.clientY-r.top)/r.height*screen.height,screen.height)];}
  function draw(points){const r=canvas.getBoundingClientRect();if(points.length<2){overlay.clear();return;}overlay.setFingers(points.map(([x,y])=>({x:x/screen.width*r.width,y:y/screen.height*r.height})));}
  function begin(points,kind){if(!live?.ready||!live.input.begin(points,{...screen}))return false;gesture={kind,screen:{...screen},last:points};draw(points);return true;}
  function sample(points){
    if(!gesture||points.length!==gesture.last.length)return;
    gesture.last=points;live.input.move(points);draw(points);
  }
  function finish(){
    const g=gesture;if(!g)return;
    live.input.end(g.last);gesture=null;wheel=null;clearTimeout(wheelTimer);overlay.clear();
  }
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0||gesture)return;e.preventDefault();keyboard.focus({preventScroll:true});if(!canInput())return;
    const p=point(e),pan=e.altKey&&e.shiftKey,spread=Math.min(80,screen.width/2);
    const points=pan?[[screen.width/2+spread,screen.height/2],[screen.width/2-spread,screen.height/2]]:e.altKey?[p,[screen.width-p[0],screen.height-p[1]]]:[p];
    if(!begin(points,'pointer'))return;Object.assign(gesture,{id:e.pointerId,pan,anchor:p,origin:points,alt:e.altKey});canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    const g=gesture;if(g?.kind!=='pointer'||g.id!==e.pointerId)return;const p=point(e);
    sample(g.pan?g.origin.map(q=>[clamp(q[0]+p[0]-g.anchor[0],screen.width),clamp(q[1]+p[1]-g.anchor[1],screen.height)]):g.alt?[p,[screen.width-p[0],screen.height-p[1]]]:[p]);
  });
  canvas.addEventListener('pointerup',e=>{if(gesture?.id===e.pointerId)finish();});
  for(const name of ['pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>{if(gesture?.id===e.pointerId)cancel();});
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();if(!canInput()||gesture&&gesture.kind!=='wheel')return;
    const r=canvas.getBoundingClientRect(),center=point(e),factor=e.deltaMode===1?16:e.deltaMode===2?r.height:1;
    if(wheel&&wheel.pinch!==e.ctrlKey)finish();
    if(!wheel){if(!begin([[clamp(center[0]+80,screen.width),center[1]],[clamp(center[0]-80,screen.width),center[1]]],'wheel'))return;wheel={pinch:e.ctrlKey,scale:1,center};}
    let points;
    if(wheel.pinch){const max=Math.min(6,Math.max(center[0],screen.width-center[0])/80);wheel.scale=clamp(wheel.scale*Math.exp(-e.deltaY*factor/200),max);wheel.scale=Math.max(.25,wheel.scale);points=[[clamp(center[0]+80*wheel.scale,screen.width),center[1]],[clamp(center[0]-80*wheel.scale,screen.width),center[1]]];}
    else{const p=gesture.last,dx=Math.max(-Math.min(...p.map(x=>x[0])),Math.min(screen.width-Math.max(...p.map(x=>x[0])),-e.deltaX*factor/r.width*screen.width)),dy=Math.max(-Math.min(...p.map(x=>x[1])),Math.min(screen.height-Math.max(...p.map(x=>x[1])),-e.deltaY*factor/r.height*screen.height));points=p.map(x=>[x[0]+dx,x[1]+dy]);}
    sample(points);clearTimeout(wheelTimer);wheelTimer=setTimeout(finish,120);
  },{passive:false});
  canvas.addEventListener('cindy-trackpad',e=>{
    const s=e.detail;if(s.phase==='cancel'){cancel();return;}
    if(s.phase==='begin'){if(gesture||s.touches.length<1||s.touches.length>2||!canInput())return;if(!begin(s.touches.map(p=>point({clientX:p.x,clientY:p.y})),'native'))return;gesture.ids=s.touches.map(p=>p.id);}
    if(gesture?.kind!=='native')return;
    const points=gesture.ids.map((id,i)=>{const p=s.touches.find(t=>t.id===id);return p?point({clientX:p.x,clientY:p.y}):gesture.last[i];});sample(points);
    if(s.phase==='end')finish();
  });
  keyboard.addEventListener('keydown',e=>{
    if(e.isComposing)return;
    if(['Enter','Tab','Backspace'].includes(e.key)){e.preventDefault();if(canInput())perform('type',{keys:[e.key]});}
  });
  const textInput=()=>{if(keyboard.value&&canInput())perform('type',{text:keyboard.value});keyboard.value='';};
  keyboard.addEventListener('input',e=>{if(!e.isComposing)textInput();});
  keyboard.addEventListener('compositionend',textInput);
  keyboard.addEventListener('paste',e=>{const text=e.clipboardData?.getData('text/plain');if(text){e.preventDefault();if(canInput())perform('type',{text});}});
  canvas.addEventListener('keydown',e=>{if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.length===1){e.preventDefault();keyboard.focus({preventScroll:true});if(canInput())perform('type',{text:e.key});}});
  window.__nativeHome=()=>{if(canInput()){if(live){cancel();void live.home().catch(error);}else perform('press',{button:'home'});}};
  // Physical orientation/folding follows the phone, never a simulator override.
  window.__nativeRelease=()=>{epoch++;cancel();keyboard.value='';};
  function fit(){
    if(!screen)return;
    const viewport=shell?.viewport||screen,scale=Math.min((innerWidth-24)/viewport.width,(innerHeight-24)/viewport.height);
    frame.style.width=Math.max(1,viewport.width*scale)+'px';frame.style.height=Math.max(1,viewport.height*scale)+'px';if(gesture)draw(gesture.last);
    const controller=parent.cindySim;
    if(controller?.state&&(controller.state.viewport?.width!==viewport.width||controller.state.viewport?.height!==viewport.height)){
      controller.state.viewport={width:viewport.width,height:viewport.height};
      void controller.measure?.();
    }
  }
  async function loop(){
    try{if(!document.hidden){
      const f=await api('frame');if(closed)return;
      if(JSON.stringify(screen)!==JSON.stringify(f.screen)){epoch++;cancel();}screen=f.screen;shell?.update(screen);fast=!!f.fast;status(f.control);
      const picture=new Image();picture.src='data:'+(f.mime||'image/jpeg')+';base64,'+f.image;await picture.decode();
      if(canvas.width!==picture.width||canvas.height!==picture.height){canvas.width=picture.width;canvas.height=picture.height;}ctx.drawImage(picture,0,0);available=true;frame.hidden=false;frame.style.opacity='';fit();$('message').hidden=true;
      // Shared zoom measures the complete body; input still uses the canvas.
    }}catch(e){available=false;connection(e);ready=false;epoch++;cancel();}
    finally{if(!closed)setTimeout(loop,available?(fast?30:100):1000);}
  }
  addEventListener('resize',fit);addEventListener('blur',cancel);
  addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='cindy-release-input')window.__nativeRelease();});
  addEventListener('pagehide',()=>{closed=true;epoch++;cancel();live?.close();});
  document.addEventListener?.('visibilitychange',()=>{if(document.hidden){cancel();live?.abort?.abort();}});
  connection();
  if(window.PhysicalLive){
    live=new window.PhysicalLive({udid,token,api,onstate:c=>{
      if(c.state==='running')notice(c.phase==='runtime'?t('首次连接，正在准备实时画面组件…','Preparing live video for the first connection…'):t('正在连接实时画面…','Connecting live video…'),true);
      else if(c.error)notice(c.error.message,true);
    },onframe:(picture,newScreen,count)=>{
      if(JSON.stringify(screen)!==JSON.stringify(newScreen)){epoch++;cancel();screen=newScreen;shell?.update(screen);}
      if(canvas.width!==picture.displayWidth||canvas.height!==picture.displayHeight){canvas.width=picture.displayWidth;canvas.height=picture.displayHeight;}
      ctx.drawImage(picture,0,0);canvas.dataset.frames=String(count);canvas.dataset.transport='continuous';available=true;ready=true;
      frame.hidden=false;frame.style.opacity='';fit();$('message').hidden=true;
      if(count===1)notice('');
    },onerror:e=>{available=false;ready=false;epoch++;cancel();connection(e);notice(e.message,true);}});
    void live.run();
  }else loop();
})();
