'use strict';
(() => {
  const udid=location.pathname.split('/')[2],token=new URLSearchParams(location.search).get('cindyViewer');
  const canvas=document.getElementById('display'),ctx=canvas.getContext('2d'),frame=document.getElementById('nativeDeviceFrame'),message=document.getElementById('message');
  const zh=parent.document.documentElement.lang==='zh-CN';let closed=false,rotation=0,deviceRotation=0,busy=false;const pointers=new Map();
  let paintedRotation=null,lastRotationStep=1;
  const overlay=new window.Baguette._PinchOverlay(frame);
  let modifierDrag=null;
  function screenSize(){
    const v=parent.cindySim?.state.viewport;
    if(!v?.width||!v.height||!canvas.width)return null;
    const short=Math.min(v.width,v.height),long=Math.max(v.width,v.height);
    return canvas.width>canvas.height?{width:long,height:short}:{width:short,height:long};
  }
  function drawTouches(){
    const active=[...pointers.values()].filter(t=>t.pressure>0);
    if(active.length<2){overlay.clear();return;}
    const r=canvas.getBoundingClientRect();
    overlay.setFingers(active.map(t=>({x:t.x*r.width,y:t.y*r.height})));
  }
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let queue=Promise.resolve(),queued=0,epoch=0;
  function input(action,extra={}){
    if(queued>=128&&action!=='release')return Promise.reject(Error('Input queue full'));
    const current=epoch;queued++;
    const next=queue.then(()=>{if(current===epoch)return send(action,extra);}).finally(()=>{queued--;});queue=next.catch(()=>{});return next;
  }
  async function send(action,extra={}){
    const r=await fetch('/android-input',{method:'POST',headers:{'Content-Type':'application/json','X-Cindy-Clipboard':token},body:JSON.stringify({udid,action,...extra}),signal:AbortSignal.timeout(20000)});
    const result=await r.json();if(!r.ok||result.ok===false)throw Error(result.message||'Input failed');return result;
  }
  function error(){message.hidden=false;message.textContent=zh?'操作未确认，请查看设备状态。':'Action not confirmed. Check the device state.';}
  function fit(){
    if(!canvas.width)return;
    const width=innerWidth-24,height=innerHeight-24,landscape=canvas.width>canvas.height;
    const ratio=Math.min(canvas.width,canvas.height)/Math.max(canvas.width,canvas.height);
    // Like the iPhone bezel, size the portrait body first. Turning it must
    // not enlarge it to fill extra horizontal space; only cap an overflow.
    const length=Math.min(height,width/ratio,landscape?width:Infinity);
    frame.style.width=(landscape?length:length*ratio)+'px';
    frame.style.height=(landscape?length*ratio:length)+'px';
    drawTouches();
  }
  // Draw one frame and follow the device pose it was captured in.
  function paint(image,width,height,nextRotation,nextDeviceRotation){
    const turned=paintedRotation!==null&&nextDeviceRotation!==paintedRotation;
    const currentTransform=turned?getComputedStyle(frame).transform:null;
    if((nextRotation!==rotation||turned)&&pointers.size){extras?.release();epoch++;pointers.clear();modifierDrag=null;drawTouches();dirty=false;input('release').catch(error);}
    rotation=nextRotation;deviceRotation=nextDeviceRotation;
    // The stream already follows the physical device. A portrait-locked
    // activity must not force the whole device frame back to portrait.
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    ctx.drawImage(image,0,0);fit();message.hidden=true;
    if(turned){
      let turns=(nextDeviceRotation-paintedRotation+4)%4;
      if(turns===3)turns=-1;else if(turns===2)turns=-2*Math.sign(lastRotationStep);
      // Preserve the visible pose across the stream's pixel rotation,
      // then turn frame and screen together with the iPhone's easing.
      const from=new DOMMatrix(currentTransform==='none'?undefined:currentTransform).rotate(turns*90);
      for(const animation of frame.getAnimations())animation.cancel();
      if(!reducedMotion.matches)frame.animate([{transform:from.toString()},{transform:'none'}],{duration:320,easing:'cubic-bezier(0.32, 0.72, 0, 1)'});
    }
    paintedRotation=nextDeviceRotation;
  }
  // H.264 (Baguette's AVCC envelope) when WebCodecs works, else PNG. Each
  // message is [u32 length][display rotation][device rotation][payload].
  let decoderFailures=0;
  async function stream(){
    while(!closed){
      let decoder=null,controller=null;
      try{
        const wanted=typeof VideoDecoder==='function'&&decoderFailures<2?'avcc':'png';
        controller=new AbortController();
        const r=await fetch(`/android-stream?udid=${encodeURIComponent(udid)}&format=${wanted}`,{headers:{'X-Cindy-Clipboard':token},signal:controller.signal});if(!r.ok)throw Error('Disconnected');
        const poses=new Map();let sequence=0,failure=null;
        if(/avcc/.test(r.headers.get('content-type')||''))decoder=new VideoDecoder({
          output:image=>{const pose=poses.get(image.timestamp);poses.delete(image.timestamp);if(pose&&!closed)paint(image,image.displayWidth,image.displayHeight,pose[0],pose[1]);image.close();},
          error:e=>{failure=e;controller.abort();}});
        const reader=r.body.getReader();let buffer=new Uint8Array();
        for(;;){const {done,value}=await reader.read();if(done)break;if(failure)throw failure;const next=new Uint8Array(buffer.length+value.length);next.set(buffer);next.set(value,buffer.length);buffer=next;
          while(buffer.length>=6){const length=new DataView(buffer.buffer,buffer.byteOffset,4).getUint32(0);if(length<2||length>32e6)throw Error('Invalid frame');if(buffer.length<length+4)break;
            const pose=[buffer[4],buffer[5]],payload=buffer.slice(6,4+length);buffer=buffer.slice(4+length);
            if(!decoder){const bitmap=await createImageBitmap(new Blob([payload],{type:'image/png'}));paint(bitmap,bitmap.width,bitmap.height,pose[0],pose[1]);bitmap.close();continue;}
            if(payload[0]===1){const description=payload.slice(1);decoder.configure({codec:'avc1.'+[...description.slice(1,4)].map(b=>b.toString(16).padStart(2,'0')).join(''),description,optimizeForLatency:true,hardwareAcceleration:'prefer-hardware'});}
            else if((payload[0]===2||payload[0]===3)&&decoder.state==='configured'){poses.set(sequence,pose);decoder.decode(new EncodedVideoChunk({type:payload[0]===2?'key':'delta',timestamp:sequence++,data:payload.subarray(1)}));}
          }
        }
      }catch(e){
        // A failed decoder cannot resume mid-stream; reconnect for a keyframe.
        if(decoder&&e?.name!=='TypeError')decoderFailures++;
        message.hidden=false;message.textContent=zh?'正在连接设备画面…':'Connecting to device…';
      }finally{controller?.abort();try{decoder?.close();}catch{}}
      if(!closed)await new Promise(r=>setTimeout(r,500));
    }
  }
  const position=e=>{const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
  // Coalesce pointer moves, but always flush releases. A slow screen cannot
  // build an unbounded queue of stale input behind the user's finger.
  let dirty=false,flushing=null;
  function flush(start=false){
    drawTouches();
    const boundary=start||[...pointers.values()].some(t=>t.pressure===0);
    if(busy&&!boundary){dirty=true;return flushing;}
    dirty=false;
    const touches=[...pointers.values()].map(t=>({...t}));
    if(!touches.length)return flushing||Promise.resolve();
    // Starts and releases are immutable samples in the existing input queue.
    // Retire released records now, so a new gesture can reuse their IDs while
    // transport is pending. Moves alone still coalesce to the latest position.
    for(const [id,t]of pointers)if(t.pressure===0)pointers.delete(id);
    busy=true;
    const current=epoch;
    const completion=input('touch',{touches,rotation,deviceRotation,start}).catch(async()=>{
      if(current!==epoch)return;
      epoch++;extras?.release();pointers.clear();modifierDrag=null;dirty=false;
      await input('release').catch(()=>{});error();
    }).finally(()=>{
      if(flushing!==completion)return;
      busy=false;flushing=null;drawTouches();
      if(dirty)return flush();
    });
    flushing=completion;return completion;
  }
  canvas.addEventListener('pointerdown',e=>{
    e.preventDefault();canvas.focus();
    if(pointers.size>=10||pointers.has('wheel')||pointers.has('mirror')||frame.getAnimations().some(a=>a.playState==='running'))return;
    const used=new Set([...pointers.values()].map(t=>t.identifier));let identifier=0;while(used.has(identifier))identifier++;
    const pos=position(e),size=screenSize();
    if(e.altKey&&e.shiftKey&&!pointers.size&&!size)return;
    pointers.set(e.pointerId,{identifier,pressure:1024,...pos});
    if(e.altKey&&pointers.size===1){
      modifierDrag={id:e.pointerId,pan:e.shiftKey,start:pos,spread:size?80/size.width:0};
      const first=pointers.get(e.pointerId);
      if(modifierDrag.pan)Object.assign(first,{x:.5+modifierDrag.spread,y:.5});
      pointers.set('mirror',{identifier:identifier===0?1:0,pressure:1024,x:1-first.x,y:1-first.y});
    }
    canvas.setPointerCapture(e.pointerId);flush(true);
  });
  canvas.addEventListener('pointermove',e=>{
    const t=pointers.get(e.pointerId);if(!t)return;
    const pos=position(e),mirror=pointers.get('mirror'),clamp=n=>Math.max(0,Math.min(1,n));
    if(mirror&&modifierDrag?.id===e.pointerId&&modifierDrag.pan){
      const x=.5+pos.x-modifierDrag.start.x,y=clamp(.5+pos.y-modifierDrag.start.y);
      Object.assign(t,{x:clamp(x+modifierDrag.spread),y});Object.assign(mirror,{x:clamp(x-modifierDrag.spread),y});
    }else{Object.assign(t,pos);if(mirror)Object.assign(mirror,{x:1-t.x,y:1-t.y});}
    flush();
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>{const t=pointers.get(e.pointerId);if(t){t.pressure=0;if(modifierDrag?.id===e.pointerId){pointers.get('mirror').pressure=0;modifierDrag=null;}flush();}});
  canvas.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v')return;
    if(e.key.length===1||['Enter','Tab','Backspace','Delete','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){
      e.preventDefault();const modifiers=[e.ctrlKey||e.metaKey?'ctrl':null,e.altKey?'alt':null,e.shiftKey&&e.key.length>1?'shift':null].filter(Boolean);input('type',{keys:[...modifiers,e.key].join('+')}).catch(error);
    }
  });
  canvas.addEventListener('paste',e=>{const text=e.clipboardData?.getData('text/plain');if(text){e.preventDefault();input('type',{text}).catch(error);}});
  window.__nativeHome=()=>input('press',{button:'home'}).catch(error);
  window.__nativeAppSwitcher=()=>input('press',{button:'app-switcher'}).catch(error);
  window.__nativeBack=()=>input('press',{button:'back'}).catch(error);
  window.__nativeShake=()=>input('press',{button:'shake'}).catch(error);
  window.__nativeRotateBy=step=>{lastRotationStep=step;deviceRotation=(deviceRotation-step+4)%4;input('rotate',{orientation:['portrait','landscape-left','portrait-upside-down','landscape-right'][deviceRotation]}).catch(error);};
  window.__nativeOrientation=()=>['portrait','landscape-left','portrait-upside-down','landscape-right'][deviceRotation];
  const extras=window.androidScreenActions?.({canvas,frame,input,pointers,flush,screenSize,zh});
  addEventListener('resize',fit);addEventListener('blur',()=>{extras?.release();epoch++;pointers.clear();modifierDrag=null;drawTouches();dirty=false;input('release').catch(()=>{});});
  addEventListener('pagehide',()=>{closed=true;epoch++;pointers.clear();modifierDrag=null;overlay.clear();fetch('/android-input',{method:'POST',headers:{'Content-Type':'application/json','X-Cindy-Clipboard':token},body:JSON.stringify({udid,action:'release'}),keepalive:true}).catch(()=>{});});
  stream();
})();
