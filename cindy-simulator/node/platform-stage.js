'use strict';
// Rectangular displays do not have DeviceKit phone chrome. Reuse Baguette's
// decoder/stream lifecycle; input goes through Cindy's guarded control API.
(() => {
  const p = new URLSearchParams(location.search), udid = p.get('udid');
  const canvas = document.getElementById('display'), status = document.getElementById('status');
  const zh = p.get('lang') === 'zh-CN';
  const tv = p.get('platform') === 'tvOS';
  let session, stopped = false, down = null, inputQueue = Promise.resolve(), errorUntil = 0;
  const message = text => { status.textContent = text; status.hidden = !text; };
  const inputError = () => {errorUntil=Date.now()+5000;message(zh ? '输入未确认，请查看画面后重试。' : 'Input not confirmed. Check the view before retrying.');};
  let inputEpoch = 0, pendingInputs = 0;
  // Reserve the existing queue through a gesture's entire lifetime. Gesture
  // starts and discrete actions therefore have one ordering owner.
  const enqueueGesture=(start,done)=>{const previous=inputQueue;inputQueue=done;previous.then(start);};
  const input = action => {
    if (stopped || document.hidden) return;
    if (pendingInputs >= 16) { resetPointer(); inputError(); return; }
    const epoch = inputEpoch; pendingInputs++;
    // Close only gestures already accepted before this action, synchronously.
    // Waiting for the current gesture inside the queue could wait on its own tail.
    endPan();vision?.finish();
    inputQueue = inputQueue.then(async () => {
      if (!stopped && !document.hidden && epoch === inputEpoch) return action();
    }).catch(() => { resetPointer(); inputError(); }).finally(() => { pendingInputs--; });
    return inputQueue;
  };
  const vision=!tv&&globalThis.createVisionStage?globalThis.createVisionStage({canvas,api:(...args)=>parent.cindySim.api(...args),message:text=>{errorUntil=Date.now()+8000;message(text);},onError:inputError,onCancel:()=>{inputEpoch++;},enqueueGesture,zh}):null;
  const press=button=>input(()=>parent.cindySim.api('press',{button}));
  // Parent toolbar/shortcuts share this page's gesture ordering and cancellation.
  globalThis.cindyPlatform={press};
  const keyboardInput=action=>{
    const accepts=()=>!vision||vision.acceptsKeyboard();
    if(accepts())return input(()=>{if(accepts())return action();});
  };
  canvas.addEventListener('pointerdown', event => {
    if(vision)return;
    if(event.button !== 0 || event.ctrlKey || event.isPrimary === false){down=null;return;}
    canvas.focus(); down = {id:event.pointerId,at:Date.now(),x:event.clientX,y:event.clientY,moved:false}; canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {if(down?.id===event.pointerId && Math.hypot(down.x-event.clientX,down.y-event.clientY)>8)down.moved=true;});
  canvas.addEventListener('pointercancel', () => resetPointer());
  canvas.addEventListener('lostpointercapture', () => {down=null;});
  canvas.addEventListener('pointerup', event => {
    if(vision)return;
    const start=down; down=null;
    if(!start||start.id!==event.pointerId||event.button!==0)return;
    if(start.moved||Math.hypot(start.x-event.clientX,start.y-event.clientY)>8){if(!tv)message(zh?'当前支持点击和长按，暂不支持空间拖动。':'Tap and hold are supported; spatial dragging is not yet available.');return;}
    const r=canvas.getBoundingClientRect(),x=(event.clientX-r.left)/r.width,y=(event.clientY-r.top)/r.height;
    if(x<0||x>1||y<0||y>1)return;
    if(tv){press('select');return;}
    if(p.get('platform')!=='visionOS')return;
    const duration=Math.max(0.1,Math.min(10,(Date.now()-start.at)/1000));
    input(()=>parent.cindySim.api('tap',{x,y,duration}));
  });
  canvas.addEventListener('contextmenu', event => {
    if(!tv)return;
    event.preventDefault(); down=null; canvas.focus();
    press('back');
  });
  // A wheel stream is one native Siri Remote contact, not repeated arrow keys.
  // Keep the latest absolute point while a request is in flight: displacement
  // survives coalescing without an unbounded backlog of stale movements.
  let pan=null,panTimer=null,wheelAt=0,wheelFailed=false;
  const pans=new Set();
  const finishPan = contact => {contact.finished=true;pans.delete(contact);contact.resolve();if(pan===contact)pan=null;};
  const failPan = contact => {wheelFailed=true;finishPan(contact);resetPointer();inputError();};
  async function pumpPan(contact) {
    if(contact.busy||!contact.ready||contact.finished)return;
    const point=contact.pending;
    if(!point&&!contact.ending)return;
    contact.pending=null;contact.busy=true;
    const phase=point?'changed':'ended';
    try {
      await parent.cindySim.api('trackpad',{gesture:contact.id,phase,...(point||{x:contact.x,y:contact.y})});
      if(phase==='ended')finishPan(contact);
    } catch {
      failPan(contact); // Native idle/EOF also lifts the finger.
    } finally {contact.busy=false;if(!contact.finished)pumpPan(contact);}
  }
  function endPan(discard=false) {
    clearTimeout(panTimer);panTimer=null;
    const current=pan;
    for(const contact of discard?pans:current?[current]:[]){
      // Normal release drains accepted input; cancellation alone discards it.
      // An already cancelled contact must never become normally ending again.
      contact.ending=discard?'cancel':contact.ending||'finish';
      if(discard)contact.pending=null;pumpPan(contact);
    }
    return current?.done||Promise.resolve();
  }
  function beginPan(dx,dy) {
    // A relative desktop gesture has no absolute touchdown point. Leave room
    // in its initial direction, as a thumb starting near the opposite edge.
    const start={x:dx===0?.5:dx<0?.15:.85,y:dy===0?.5:dy<0?.15:.85};
    const contact={id:crypto.randomUUID(),...start,pending:null,ready:false,busy:false,ending:null,finished:false};
    contact.done=new Promise(resolve=>{contact.resolve=resolve;});pans.add(contact);pan=contact;
    enqueueGesture(async()=>{
      if(stopped||contact.ending==='cancel'||document.hidden){finishPan(contact);return;}
      try{await parent.cindySim.api('trackpad',{gesture:contact.id,phase:'began',...start});contact.ready=true;pumpPan(contact);}
      catch{failPan(contact);}
    },contact.done);
    return contact;
  }
  const resetPointer=()=>{inputEpoch++;down=null;endPan(true);vision?.cancel();};
  canvas.addEventListener('wheel', event => {
    if(!tv||event.ctrlKey||event.metaKey||event.altKey||stopped||document.hidden)return;
    event.preventDefault(); down=null; canvas.focus();
    const now=Date.now(),unit=event.deltaMode===1?16:event.deltaMode===2?canvas.getBoundingClientRect().height:1;
    if(now-wheelAt>180)wheelFailed=false;
    wheelAt=now;
    const dx=event.deltaX*unit,dy=event.deltaY*unit;
    if(wheelFailed||!Number.isFinite(dx)||!Number.isFinite(dy)||(!dx&&!dy))return;
    const contact=!pan||pan.ending?beginPan(dx,dy):pan;
    // Natural-scroll deltas are opposite physical finger motion. A 300 CSS-px
    // displacement spans the touch surface, independent of TV stream resolution.
    contact.x=Math.max(0,Math.min(1,contact.x-dx/300));
    contact.y=Math.max(0,Math.min(1,contact.y-dy/300));
    contact.pending={x:contact.x,y:contact.y};pumpPan(contact);
    clearTimeout(panTimer);panTimer=setTimeout(endPan,100);
  },{passive:false});
  addEventListener('blur',resetPointer);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)resetPointer();});
  canvas.addEventListener('paste', event => {
    const text=event.clipboardData?.getData('text/plain');if(!text)return;
    event.preventDefault();
    if(p.get('platform')==='tvOS'){errorUntil=Date.now()+5000;message(zh?'tvOS 不支持剪贴板，请使用键盘输入。':'tvOS does not support clipboard paste. Use keyboard input.');return;}
    keyboardInput(async()=>{const response=await fetch('/clipboard',{method:'POST',headers:{'Content-Type':'application/json','X-Cindy-Clipboard':p.get('cindyViewer')},body:JSON.stringify({udid,action:'paste',text})});if(!response.ok)throw Error('INPUT_FAILED');});
  });
  canvas.addEventListener('keydown', event => {
    if(vision?.key(event))return;
    if((event.metaKey||event.ctrlKey)&&event.code==='KeyV')return; // Let the paste event provide current text.
    if(event.repeat||!(/^(Key[A-Z]|Digit\d|Arrow(Up|Down|Left|Right))$/.test(event.code)||['Enter','Escape','Backspace','Tab','Space','Minus','Equal','BracketLeft','BracketRight','Backslash','Semicolon','Quote','Backquote','Comma','Period','Slash'].includes(event.code)))return;
    event.preventDefault();
    const modifiers=[['control',event.ctrlKey],['shift',event.shiftKey],['option',event.altKey],['command',event.metaKey]].filter(([,on])=>on).map(([key])=>key);
    keyboardInput(async()=>{const response=await fetch('/clipboard',{method:'POST',headers:{'Content-Type':'application/json','X-Cindy-Clipboard':p.get('cindyViewer')},body:JSON.stringify({udid,action:'key',code:event.code,modifiers})});if(!response.ok)throw Error('INPUT_FAILED');});
  });
  // H.264 like the iPhone page: an idle stream sends nothing, while MJPEG
  // re-sends whole images whenever the scene renders (Vision Pro renders
  // continuously). MJPEG remains for engines without WebCodecs and after
  // repeated decoder failures.
  let format = FrameDecoder.isHardwareAvailable() ? 'avcc' : 'mjpeg', decoderFailures = 0;
  // Like viewer-stage.js for iPhone: a hidden page keeps only a trickle.
  const pace = () => session?.send?.({type:'set_fps',fps:document.hidden?2:60});
  document.addEventListener('visibilitychange',pace);
  function start() {
    if (stopped) return;
    session?.stop();
    const url = new URL(StreamSession.buildWSUrl(udid, format, 'v2'));
    url.searchParams.set('cindyViewer', p.get('cindyViewer') || '');
    message(zh ? '正在连接画面…' : 'Connecting…');
    const current = session = new StreamSession({udid, format, url: url.href, canvas,
      onSize: (w,h) => {canvas.style.width=`min(100vw, ${100*w/h}vh)`;canvas.style.height='auto';},
      onOpen: pace,
      onPaint: () => {if(Date.now()>=errorUntil)message('');},
      // A failed decoder stays closed; reconnect for a fresh keyframe.
      onLog: (text, isError) => {
        if (!isError || !/^(decoder|config):/.test(text) || current !== session) return;
        if (++decoderFailures >= 2) format = 'mjpeg';
        setTimeout(start, 250);
      },
      onClose: () => { resetPointer(); if (!stopped) message(zh ? '画面已断开，正在重连…' : 'Reconnecting…'); },
      onError: () => {resetPointer();message(zh ? '画面连接失败，正在重连…' : 'Stream unavailable; reconnecting…');}});
    session.start();
  }
  addEventListener('pagehide', () => { stopped = true; resetPointer(); session?.stop(); });
  start();
})();
