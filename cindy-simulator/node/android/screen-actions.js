'use strict';
window.androidScreenActions=({canvas,frame,input,pointers,flush,zh})=>{
  const status=document.getElementById('action-status'),recordButton=document.getElementById('recording');
  const say=(text)=>{status.hidden=false;status.textContent=text;};
  let wheel=null,wheelTimer,uploading=false,recorder=null,recordingTimer,paintTimer;
  function endWheel(){clearTimeout(wheelTimer);if(wheel)wheel.ending=true;}
  async function moveWheel(current){
    await flush(true);
    while(wheel===current&&pointers.has('wheel')){
      const touch=pointers.get('wheel'),dx=current.x-touch.x,dy=current.y-touch.y;
      if(Math.abs(dx)+Math.abs(dy)<.001){if(current.ending)break;await new Promise(r=>setTimeout(r,16));continue;}
      // Android starts scrolling after touch slop; a single jump followed by
      // up can be consumed entirely by interception. Send intermediate moves.
      const steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/.04));
      touch.x+=dx/steps;touch.y+=dy/steps;
      if(current.pinch)Object.assign(pointers.get('wheel-mirror'),{x:1-touch.x,y:touch.y});
      await flush();await new Promise(r=>setTimeout(r,16));
    }
    for(const key of ['wheel','wheel-mirror']){const p=pointers.get(key);if(p)p.pressure=0;}
    await flush();if(wheel===current)wheel=null;
  }
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();e.stopPropagation();canvas.focus();
    if(frame.getAnimations().some(a=>a.playState==='running')||(!wheel&&pointers.size))return;
    const bounds=canvas.getBoundingClientRect(),pinch=e.ctrlKey;
    if(wheel&&wheel.pinch!==pinch){endWheel();return;}
    if(!wheel){
      wheel={pinch,x:pinch?.35:.5,y:.5,ending:false};
      pointers.set('wheel',{identifier:0,pressure:1024,x:wheel.x,y:.5});
      if(pinch)pointers.set('wheel-mirror',{identifier:1,pressure:1024,x:.65,y:.5});
      moveWheel(wheel).catch(()=>{wheel=null;input('release').catch(()=>{});});
    }
    wheel.ending=false;
    const factor=e.deltaMode===1?16:e.deltaMode===2?bounds.height:1;
    if(pinch)wheel.x=Math.max(.05,Math.min(.48,wheel.x+e.deltaY*factor/bounds.height));
    else{
      wheel.x=Math.max(.03,Math.min(.97,wheel.x-e.deltaX*factor/bounds.width));
      wheel.y=Math.max(.03,Math.min(.97,wheel.y-e.deltaY*factor/bounds.height));
    }
    clearTimeout(wheelTimer);wheelTimer=setTimeout(endWheel,120);
    if(!pinch&&(wheel.x===.03||wheel.x===.97||wheel.y===.03||wheel.y===.97))endWheel();
  },{passive:false});
  async function copy(selection=false){
    canvas.focus();
    try{const result=await input('clipboard',{copy:selection});await navigator.clipboard.writeText(result.text||'');say(zh?'已复制到电脑剪贴板':'Copied to computer clipboard');}
    catch{say(zh?'复制未完成，请重新选择文字后再复制。':'Copy failed. Select text and try again.');}
  }
  canvas.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='c'){e.preventDefault();e.stopImmediatePropagation();copy(true);}},true);
  const token=new URLSearchParams(location.search).get('cindyViewer'),udid=location.pathname.split('/')[2];
  const headers={'X-Cindy-Clipboard':token};
  async function upload(files){
    if(uploading)return;uploading=true;
    try{
      for(const file of files){
        if(!/\.(apk|png|jpe?g|gif|webp|mp4|webm)$/i.test(file.name)||file.size>128*1024*1024||!file.size)throw Error(zh?'请选择不超过 128 MiB 的 APK、图片或视频。':'Choose an APK, image or video up to 128 MiB.');
        say((zh?'正在导入：':'Importing: ')+file.name);
        const response=await fetch(`/android-file?udid=${encodeURIComponent(udid)}&name=${encodeURIComponent(file.name)}`,{method:'POST',headers,body:file});
        let result=await response.json();if(!response.ok||result.ok===false)throw Error(result.message||result.error||'Import failed');
        while(result.job&&result.state==='running'){
          await new Promise(r=>setTimeout(r,800));
          const r=await fetch('/control-api',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({action:'install_status',udid,job:result.job})});
          result=await r.json();if(!r.ok||result.ok===false)throw Error(result.message||'Install status unavailable');
        }
        if(result.state==='failed'||result.importError)throw Error(result.message||result.importError?.message||'Install failed');
        say((zh?'已完成：':'Completed: ')+file.name);
      }
    }catch(e){say((zh?'导入未完成：':'Import not completed: ')+e.message);}
    finally{uploading=false;}
  }
  for(const name of ['dragenter','dragover'])document.addEventListener(name,e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';frame.dataset.drop='true';}});
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget)delete frame.dataset.drop;});
  document.addEventListener('drop',e=>{e.preventDefault();delete frame.dataset.drop;upload([...e.dataTransfer.files]);});
  document.getElementById('file-input').addEventListener('change',e=>{upload([...e.target.files]);e.target.value='';});
  function stopRecording(){if(recorder?.state==='recording')recorder.stop();}
  function record(){
    canvas.focus();
    if(recorder)return stopRecording();
    if(!canvas.width||!window.MediaRecorder)return say(zh?'画面尚未就绪，暂时不能录屏。':'Wait for the screen before recording.');
    const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!mime)return say(zh?'当前浏览器不支持录像导出。':'This browser cannot export recordings.');
    const output=document.createElement('canvas');output.width=canvas.width;output.height=canvas.height;
    const context=output.getContext('2d'),stream=output.captureStream(30),chunks=[];let bytes=0;
    const paint=()=>{context.fillStyle='#000';context.fillRect(0,0,output.width,output.height);const scale=Math.min(output.width/canvas.width,output.height/canvas.height),w=canvas.width*scale,h=canvas.height*scale;context.drawImage(canvas,(output.width-w)/2,(output.height-h)/2,w,h);};
    const started=Date.now();
    try{recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4000000});}
    catch{stream.getTracks().forEach(t=>t.stop());return say(zh?'无法启动录像，请重试。':'Could not start recording. Try again.');}
    paint();paintTimer=setInterval(paint,33);
    recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>=128*1024*1024)stopRecording();}};
    recorder.onstop=()=>{
      clearInterval(paintTimer);clearInterval(recordingTimer);stream.getTracks().forEach(t=>t.stop());recorder=null;recordButton.hidden=true;
      if(!chunks.length)return say(zh?'未生成录像，请重试。':'No video was recorded. Try again.');
      const blob=new Blob(chunks,{type:mime}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`Android-${new Date().toISOString().replace(/[:.]/g,'-')}.webm`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      say(zh?'录像已导出（无音频）':'Recording exported (no audio)');
    };
    recorder.onerror=()=>{say(zh?'录像中断，将尝试保存已录内容。':'Recording interrupted; saving available video.');stopRecording();};
    try{recorder.start(1000);}
    catch{clearInterval(paintTimer);stream.getTracks().forEach(t=>t.stop());recorder=null;return say(zh?'无法启动录像，请重试。':'Could not start recording. Try again.');}
    recordButton.hidden=false;
    const tick=()=>{const seconds=Math.floor((Date.now()-started)/1000);recordButton.textContent=`● ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · ${zh?'停止并保存':'Stop & save'}`;if(seconds>=300)stopRecording();};
    tick();recordingTimer=setInterval(tick,500);
  }
  recordButton.onclick=stopRecording;
  addEventListener('beforeunload',e=>{if(recorder){e.preventDefault();e.returnValue='';}});
  addEventListener('pagehide',()=>{endWheel();stopRecording();});
  window.__nativeCopy=()=>copy(false);window.__nativeImport=()=>document.getElementById('file-input').click();window.__nativeRecord=record;window.__nativeRecording=()=>!!recorder;
  return {release:endWheel};
};
