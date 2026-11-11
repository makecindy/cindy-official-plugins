'use strict';
// The device page for a device on another computer. The picture arrives from
// Cindy re-encoded in this plugin's own stream format; gestures are the very
// modules the local simulator page uses (mouse, Option pinch and pan, wheel,
// real touches, the Mac trackpad), bound to a screen that sends touches to
// that computer instead of to a local device.
(() => {
  const udid=decodeURIComponent(location.pathname.split('/')[2]),token=new URLSearchParams(location.search).get('cindyViewer');
  const $=id=>document.getElementById(id),canvas=$('display'),ctx=canvas.getContext('2d'),frame=$('nativeDeviceFrame'),area=$('screenArea'),keyboard=$('keyboard');
  const zh=parent.document.documentElement.lang==='zh-CN',t=(cn,en)=>zh?cn:en;
  canvas.setAttribute('aria-label',t('设备画面','Device screen'));keyboard.setAttribute('aria-label',t('电脑键盘输入','Computer keyboard input'));
  let device=null,picture=null,points=null,live=false,closed=false,drawn=false,noticeTimer,abort=null;

  // ---- messages ----
  const FAILURES={
    connectionBusy:[t('设备正在别处查看','The device is being viewed elsewhere'),t('那台电脑上的画面正被另一台设备查看。','Another device is viewing that computer.')],
    controlUnavailable:[t('暂时不能操作这台设备','The device cannot be operated right now'),t('那台电脑暂时不接受操作，正在重试。','That computer is not accepting input. Retrying.')],
    DESKTOP_VIDEO_UNSUPPORTED:[t('这台电脑无法显示设备画面','This computer cannot show the device'),t('这台电脑不支持所需的视频编码。','This computer lacks the required video encoder.')],
  };
  function connection(state,error){
    const [title,body]=FAILURES[error]||(state==='ended'
      ?[t('画面已断开','Disconnected'),t('与那台电脑的连接已结束，正在重新连接。','The connection to that computer ended. Reconnecting.')]
      :state==='reconnecting'
        ?[t('正在重新连接','Reconnecting'),t('与那台电脑的连接暂时中断，会自动恢复。','The connection to that computer was interrupted. It will resume automatically.')]
        :[t('正在连接设备画面','Connecting to the device'),t('正在从另一台电脑获取画面，请稍候。','Retrieving the screen from the other computer. Please wait.')]);
    $('message-title').textContent=title;$('message-body').textContent=body;
    $('message-retry-label').textContent=t('正在自动连接…','Connecting automatically…');
    $('message').hidden=false;frame.style.opacity=drawn?'.18':'0';
    // Viewed on another of the user's devices: they decide whether to bring it here.
    const busy=error==='connectionBusy';
    $('message-retry').style.display=busy?'none':'';$('takeover').hidden=!busy;
  }
  $('takeover').textContent=t('在这里查看','View here');
  $('takeover').addEventListener('click',()=>{
    $('takeover').hidden=true;$('message-retry').style.display='';
    void fetch('/control-api',{method:'POST',headers:{'Content-Type':'application/json','X-Cindy-Clipboard':token},body:JSON.stringify({action:'retry',udid}),signal:AbortSignal.timeout(15000)}).catch(()=>{});
  });
  function notice(message){clearTimeout(noticeTimer);$('notice-text').textContent=message;$('notice').hidden=!message;if(message)noticeTimer=setTimeout(()=>{$('notice').hidden=true;},5000);}

  // ---- input ----
  // One request at a time, in order. Positions that only move replace the one
  // still waiting, so a slow link never plays a drag back late.
  let waiting=[],sending=false;
  const movesOnly=e=>e.kind==='touch'&&!e.edge&&e.touches.every(p=>p.phase==='moved');
  function queue(event){
    if(!live||closed)return;
    const tail=waiting[waiting.length-1];
    if(tail&&movesOnly(tail)&&movesOnly(event)&&tail.touches.length===event.touches.length)waiting[waiting.length-1]=event;
    else waiting.push(event);
    if(waiting.length>256){waiting=[];release();notice(t('输入太多，已中断当前操作。','Too much input; the current gesture was cancelled.'));return;}
    void flush();
  }
  async function flush(){
    if(sending)return;sending=true;
    try{
      while(waiting.length&&!closed){
        const events=waiting.splice(0,64);
        const response=await fetch('/control-api',{method:'POST',headers:{'Content-Type':'application/json','X-Cindy-Clipboard':token},body:JSON.stringify({action:'input',udid,events}),signal:AbortSignal.timeout(15000)});
        const result=await response.json().catch(()=>({}));
        if(!response.ok||result.ok===false)throw Object.assign(Error(result.errorCode||'REMOTE_INPUT_FAILED'),result);
      }
    }catch(error){
      // What was not delivered is dropped, never replayed late; the fingers still down are lifted.
      if(!closed){waiting=[];release();if(error.errorCode!=='VIEW_NOT_READY')notice(t('操作没有送达那台电脑，请重试。','Input did not reach the other computer. Try again.'));}
    }finally{sending=false;if(waiting.length&&!closed)void flush();}
  }
  // The fingers currently down, so a cancelled gesture lifts exactly those.
  const held=new Map();
  let tapTimer=null,tapUp=null;
  const unit=(value,size)=>Math.max(0,Math.min(1,size>0?value/size:0));
  function touch(phase,fingers,opts){
    if(!points)return;
    if(phase==='began'&&tapUp){clearTimeout(tapTimer);const up=tapUp;tapUp=null;up();}
    const touches=fingers.slice(0,Math.max(1,device?.maxTouches||2)).map((p,id)=>({id,x:unit(p.x,points.width),y:unit(p.y,points.height),phase}));
    for(const p of touches){if(phase==='ended')held.delete(p.id);else held.set(p.id,p);}
    queue({kind:'touch',touches,...(phase==='began'&&touches.length===1&&opts?.edge?{edge:opts.edge}:{})});
  }
  // The gesture modules' screen: the same verbs as the local simulator's.
  const screen={
    get size(){return points||{width:0,height:0};},
    tap(point,opts){this.touchDown([point],opts);tapUp=()=>this.touchUp([point],opts);tapTimer=setTimeout(()=>{const up=tapUp;tapUp=null;up?.();},60);},
    touchDown(fingers,opts){touch('began',fingers,opts);},
    touchMove(fingers,opts){touch('moved',fingers,opts);},
    touchUp(fingers,opts){touch('ended',fingers,opts);},
    swipe(){},
  };
  const overlay=new window.Baguette._PinchOverlay(area);
  const interpreter=new window.Baguette._PointerInterpreter(screen,{overlay,getOrientation:()=>'portrait',log:()=>{}});
  let bound=false;
  function bind(){
    const touches=(device?.maxTouches||0)>0;
    if(touches===bound)return;bound=touches;
    if(touches){area.setAttribute('data-cindy-trackpad','contacts');interpreter.attach(area);}
    else{area.removeAttribute('data-cindy-trackpad');interpreter.detach();}
  }
  // Ends whatever gesture is in progress, in order: the modules lift their own
  // fingers first, then anything still down is cancelled.
  function release(){
    clearTimeout(tapTimer);if(tapUp){const up=tapUp;tapUp=null;up();}
    interpreter.cancel();overlay.clear();keyboard.value='';
    if(held.size){const touches=[...held.values()].map(p=>({...p,phase:'cancelled'}));held.clear();queue({kind:'touch',touches});}
  }
  // Typing goes to the device: keep the hidden field focused, as the local pages do.
  area.addEventListener('mousedown',e=>{if(device?.keyboard){e.preventDefault();keyboard.focus({preventScroll:true});}});
  const KEYS={Enter:'Enter',Tab:'Tab',Backspace:'Backspace',Escape:'Escape',Delete:'Delete',ArrowLeft:'ArrowLeft',ArrowRight:'ArrowRight',ArrowUp:'ArrowUp',ArrowDown:'ArrowDown'};
  const key=code=>queue({kind:'key',code});
  const text=value=>{for(let i=0;i<value.length;i+=4000)queue({kind:'text',text:value.slice(i,i+4000)});};
  keyboard.addEventListener('keydown',e=>{
    if(e.isComposing||!device?.keyboard||e.metaKey||e.ctrlKey)return;
    if(Object.hasOwn(KEYS,e.key)){e.preventDefault();key(KEYS[e.key]);}
  });
  const typed=()=>{if(keyboard.value&&device?.keyboard)text(keyboard.value);keyboard.value='';};
  keyboard.addEventListener('input',e=>{if(!e.isComposing)typed();});
  keyboard.addEventListener('compositionend',typed);
  keyboard.addEventListener('paste',e=>{const value=e.clipboardData?.getData('text/plain');if(value){e.preventDefault();if(device?.keyboard)text(value);}});

  // ---- what the controller page calls ----
  const has=id=>!!device?.buttons?.some(b=>b.id===id);
  const press=id=>{if(live&&has(id)){release();queue({kind:'press',button:id});return true;}return false;};
  window.__nativeHome=()=>press('home');
  window.__nativeRotateBy=step=>press(step<0?'rotate-left':'rotate-right');
  window.__nativeShake=()=>press('shake');
  window.__nativeAppSwitcher=()=>press('app-switcher')||press('recents');
  window.__nativeBack=()=>press('back');
  window.__nativeRelease=release;
  window.__remoteButtons=()=>(device?.buttons||[]).map(b=>b.id);
  window.cindyPlatform={press:async id=>{if(!press(id))throw Object.assign(Error('INPUT_NOT_READY'),{code:'INPUT_NOT_READY'});}};
  // The picture as shown, for the controller's screenshot button.
  window.__nativeCapture=()=>drawn?canvas.toDataURL('image/png').split(',')[1]:null;

  // ---- layout ----
  // Pixels per point: this plugin's devices draw phones at 3× (2× the small
  // ones), iPads at 2×, and an Android phone about 411 points wide.
  function scale(){
    if(!picture||!device)return 1;
    const short=Math.min(picture.width,picture.height);
    return device.platform==='ios'?(short>=1000?3:2):device.platform==='ipados'?2:device.platform==='android'?Math.max(1,short/411):1;
  }
  // The device's own body (bezel, screen position and corner shape), made by
  // the computer that runs it from the same artwork as for a device shown
  // there. It arrives a little after the picture; until then, and for models
  // that computer has no artwork for, the plain rounded body stays.
  const shell=new window.DeviceShell(frame,area,fit,{
    definitionURL:screen=>`${location.pathname}/definition.json?cindyViewer=${encodeURIComponent(token)}&w=${screen.width}&h=${screen.height}`,
    retryMs:3000,
  });
  function fit(){
    if(!picture)return;
    const s=scale();points={width:picture.width/s,height:picture.height/s};
    // With its body the whole device is fitted, as for a device shown locally; touches still map to the screen only.
    const viewport=shell.viewport||points;
    const ratio=Math.min((innerWidth-24)/viewport.width,(innerHeight-24)/viewport.height);
    const width=Math.max(1,viewport.width*ratio),height=Math.max(1,viewport.height*ratio);
    frame.style.width=width+'px';frame.style.height=height+'px';
    frame.style.borderRadius=shell.viewport?'':Math.round((device?.cornerRadius||0)*Math.min(width,height))+'px';
    const controller=parent.cindySim;
    if(controller?.state&&(controller.state.viewport?.width!==viewport.width||controller.state.viewport?.height!==viewport.height)){
      controller.state.viewport={width:viewport.width,height:viewport.height};
      void controller.measure?.();
    }
    shell.update(picture);
  }
  setInterval(()=>{if(!closed&&!document.hidden&&picture)shell.update(picture);},2000);

  // ---- picture ----
  const hex=n=>n.toString(16).padStart(2,'0');
  async function run(){
    while(!closed){
      if(document.hidden){await new Promise(resolve=>setTimeout(resolve,500));continue;}
      let reader,decoder,ended=false;
      try{
        if(typeof VideoDecoder==='undefined')throw Error('UNSUPPORTED');
        abort=new AbortController();
        const response=await fetch(`/remote-stream?udid=${encodeURIComponent(udid)}`,{headers:{'X-Cindy-Clipboard':token},signal:abort.signal});
        if(!response.ok)throw Error('CLOSED');
        reader=response.body.getReader();
        let bytes=new Uint8Array(0),stamp=0,needsKey=true,config=null;
        const rebuild=()=>{
          if(decoder&&decoder.state!=='closed')decoder.close();
          decoder=new VideoDecoder({output:image=>{
            try{
              if(closed||document.hidden)return;
              if(canvas.width!==image.displayWidth||canvas.height!==image.displayHeight){canvas.width=image.displayWidth;canvas.height=image.displayHeight;}
              ctx.drawImage(image,0,0);drawn=true;canvas.dataset.frames=String(Number(canvas.dataset.frames||0)+1);
              if(!picture){picture={width:image.displayWidth,height:image.displayHeight};fit();}
              frame.hidden=false;if(live){frame.style.opacity='';$('message').hidden=true;}
            }finally{image.close();}
          },error:()=>abort.abort()});
          decoder.configure(config);
        };
        while(!closed){
          const {value,done}=await reader.read();if(done)break;
          const merged=new Uint8Array(bytes.length+value.length);merged.set(bytes);merged.set(value,bytes.length);bytes=merged;
          while(bytes.length>=5){
            const size=new DataView(bytes.buffer,bytes.byteOffset,4).getUint32(0);
            if(size<1||size>8*1024*1024)throw Error('INVALID');if(bytes.length<size+4)break;
            const type=bytes[4],data=bytes.slice(5,size+4);bytes=bytes.subarray(size+4);
            if(type===0x10){
              let m;try{m=JSON.parse(new TextDecoder().decode(data));}catch{continue;}
              if(m.type==='device'){device=m;bind();fit();}
              else if(m.type==='screen'&&m.width>0&&m.height>0){
                if(picture&&(picture.width!==m.width||picture.height!==m.height))release();
                picture={width:m.width,height:m.height};fit();
              }else if(m.type==='state'){
                const was=live;live=m.state==='live';
                if(was&&!live)release();
                if(live&&drawn){frame.style.opacity='';$('message').hidden=true;}
                else if(!live)connection(m.state,m.error);
                if(m.state==='ended'){ended=true;break;}
              }
              continue;
            }
            if(type===0x01){
              config={codec:`avc1.${hex(data[1])}${hex(data[2])}${hex(data[3])}`,description:data,optimizeForLatency:true};
              if(!(await VideoDecoder.isConfigSupported(config)).supported)throw Error('UNSUPPORTED');
              rebuild();needsKey=true;continue;
            }
            if(!decoder||(type!==0x02&&type!==0x03))continue;
            if(type===0x03&&needsKey)continue;
            // A burst after a pause: wait for the decoder rather than drop its keyframe.
            if(decoder.decodeQueueSize>3)await new Promise(resolve=>{
              const timer=setTimeout(done,250);
              function done(){clearTimeout(timer);decoder.removeEventListener('dequeue',next);resolve();}
              function next(){if(decoder.decodeQueueSize<=1)done();}
              decoder.addEventListener('dequeue',next);next();
            });
            needsKey=false;
            decoder.decode(new EncodedVideoChunk({type:type===0x02?'key':'delta',timestamp:stamp+=16667,data}));
          }
          if(ended)break;
        }
      }catch(error){
        if(error?.message==='UNSUPPORTED'){connection('connecting','DESKTOP_VIDEO_UNSUPPORTED');closed=true;}
      }finally{
        const was=live;live=false;if(was)release();
        abort?.abort();await reader?.cancel().catch(()=>{});
        if(decoder&&decoder.state!=='closed')decoder.close();
      }
      if(closed)return;
      // The task page renews the address behind this stream; ask again shortly.
      connection('ended');parent.parent?.postMessage({type:'cindy-simulator-remote-ended',udid},'*');
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
  }
  addEventListener('resize',fit);addEventListener('blur',release);
  addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='cindy-release-input')release();});
  addEventListener('pagehide',()=>{release();closed=true;abort?.abort();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){release();abort?.abort();}});
  connection('connecting');void run();
})();
