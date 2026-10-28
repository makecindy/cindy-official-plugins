'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {PNG,jpeg,XMLParser}=require('../../vendor/android/deps.cjs');
const {rpc}=require('./grpc.cjs'),G=require('../geometry.cjs'),pixels=require('../pixels.cjs');
const {commandBudget}=require('../budget.cjs');
const {displayRotation,normalizeFrame}=require('./geometry.cjs');
const XML=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',parseTagValue:false,processEntities:true});
const fail=(code,message,execution='not_executed')=>Object.assign(Error(message),{code,execution});
const number=(v,name,min,max,fallback)=>{if(v===undefined)return fallback;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(['count','max_swipes','max_frames','limit','fps'].includes(name)&&!Number.isInteger(v)))throw fail('INVALID_ARGUMENT',`${name} must be ${min}–${max}.`);return v;};
const point=(p,name)=>{if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))throw fail('INVALID_ARGUMENT',`${name} must contain two finite coordinates.`);return p;};
const sleep=async(ms,deadline)=>{if(commandBudget(ms,deadline).timeout<ms)throw fail('TIME_BUDGET_EXHAUSTED','The input time budget is exhausted. Observe the device before continuing.');await new Promise(r=>setTimeout(r,ms));};
const keyNames={Enter:'Enter',Return:'Enter',Escape:'Escape',Tab:'Tab',Backspace:'Backspace',Delete:'Delete',up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',space:' '};
function createAgent({root,devices,run}){
  const seen=new Map(),saved=new Set();
  const call=(d,m,v,p={})=>rpc(d.endpoint,m,v,{deadline:p._deadline});
  // One per-operation owner for every RPC input: synchronous preflight errors
  // precede dispatch; a returned Promise means the request may have executed.
  function inputFor(d,p){
    let sent=false;
    return {get sent(){return sent;},send(method,value,options=p){const pending=call(d,method,value,options);sent=true;return pending;}};
  }
  async function frame(d,p={}){
    const rotation=await displayRotation(devices,d,p);
    const image=await call(d,'getScreenshot',{format:0},p);
    if(rotation!==await displayRotation(devices,d,p))throw fail('SCREEN_CHANGED','Android display orientation changed during capture. Observe again.');
    if(!image.image?.length)throw fail('SCREEN_UNAVAILABLE','Android has not produced a frame yet. Wait for startup and retry.');
    const normalized=normalizeFrame(image,rotation),decoded=normalized.image,ratio=d.model.density/160;
    return {...normalized,screen:{width:decoded.width/ratio,height:decoded.height/ratio,orientation:['portrait','landscape-left','portrait-upside-down','landscape-right'][rotation],ratio,rotation}};
  }
  async function tree(d,p={}){
    const {stdout}=await devices.adb(d,['exec-out','uiautomator','dump','/dev/tty'],{deadline:p._deadline,timeout:18000});
    const start=stdout.indexOf('<?xml'),end=stdout.lastIndexOf('</hierarchy>');
    if(start<0||end<0)throw fail('UI_UNAVAILABLE','Android accessibility is unavailable on this screen. Use screenshot and coordinates.');
    const source=stdout.slice(start,end+12);if(/<!DOCTYPE|<!ENTITY/i.test(source))throw fail('UI_UNAVAILABLE','Invalid Android accessibility output.');
    return XML.parse(source).hierarchy;
  }
  async function describe(d,p={}){
    let accessibilityError=null;
    const f=await frame(d,p),raw=await tree(d,p).catch(e=>{if(e.code==='TIME_BUDGET_EXHAUSTED')throw e;accessibilityError=e.message;return {node:[]};}),elements=[];
    if(raw.rotation!==undefined&&Number(raw.rotation)!==f.screen.rotation)throw fail('SCREEN_CHANGED','The screen turned while reading its elements. Observe again.');
    const visit=node=>{for(const n of Array.isArray(node)?node:[node]){
      if(!n||typeof n!=='object')continue;
      const b=/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(n.bounds||'');
      if(b){const [x,y,right,bottom]=b.slice(1).map(Number).map(v=>v/f.screen.ratio),label=n.text||n['content-desc']||'',id=n['resource-id'];
        const role=/EditText/.test(n.class)?'field':/Switch|CheckBox/.test(n.class)?'switch':n.clickable==='true'?'button':/TextView/.test(n.class)?'text':'element';
        if((label||id||role==='field'||role==='button')&&right>x&&bottom>y)elements.push({role,...(label?{label}:{}),...(id?{id}:{}),enabled:n.enabled!=='false',focused:n.focused==='true',frame:[x,y,right-x,bottom-y],center:[(x+right)/2,(y+bottom)/2]});
      }visit(n.node);
    }};visit(raw.node);
    let source='accessibility';
    if(p._ocr||!elements.some(e=>e.label||e.role==='field'||e.role==='button')){elements.splice(0,elements.length,...await require('./ocr.cjs').recognize(f.bytes,f.screen.ratio,p._deadline));source='ocr';}
    let filtered=elements.filter(e=>(!p.role||e.role===p.role)&&(!p.query||[e.id,e.label].some(s=>s?.toLowerCase().includes(p.query.toLowerCase()))));
    if(p.x!==undefined||p.y!==undefined){const x=number(p.x,'x',0,f.screen.width),y=number(p.y,'y',0,f.screen.height);filtered=filtered.filter(e=>x>=e.frame[0]&&y>=e.frame[1]&&x<=e.frame[0]+e.frame[2]&&y<=e.frame[1]+e.frame[3]);}
    const limit=number(p.limit,'limit',1,1000,250);seen.set(d.udid,JSON.stringify(f.screen));
    return {udid:d.udid,source,screen:f.screen,elements:filtered.slice(0,limit).map((e,i)=>({i,...e})),total:filtered.length,truncated:filtered.length>limit,...(accessibilityError?{accessibilityError}:{}),...(p.mode==='full'?{tree:raw}:{})};
  }
  async function find(d,p){
    let ui=await describe(d,p),match=G.findElement(ui.elements,{...p,view:ui.screen});
    if(!match.element&&p.text&&!p.id&&!p.role&&ui.source!=='ocr'){ui=await describe(d,{...p,_ocr:true});match=G.findElement(ui.elements,{...p,view:ui.screen});}
    return {...match,ui};
  }
  async function screenshot(d,p={}){
    if(p.corners!==undefined&&p.corners!==false)throw fail('INVALID_ARGUMENT','corners=true is iOS-only. Android returns the rectangular framebuffer without an added corner or cutout mask; omit corners or use false.');
    const f=await frame(d,p),scale=number(p.scale,'scale',1,3,1),r=p.region||{x:0,y:0,width:f.screen.width,height:f.screen.height};
    for(const [key,max] of [['x',f.screen.width],['y',f.screen.height],['width',f.screen.width-r.x],['height',f.screen.height-r.y]])number(r[key],key,key==='width'||key==='height'?1:0,max);
    const width=Math.max(1,Math.round(r.width*scale)),height=Math.max(1,Math.round(r.height*scale)),out=new PNG({width,height});
    const grid=p.grid===true?100:number(p.grid,'grid',0,1000,0);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const sx=Math.min(f.image.width-1,Math.floor((r.x+x/scale)*f.screen.ratio)),sy=Math.min(f.image.height-1,Math.floor((r.y+y/scale)*f.screen.ratio));
      const dest=(y*width+x)*4,src=(sy*f.image.width+sx)*4;f.image.data.copy(out.data,dest,src,src+4);
      if(grid&&(Math.floor(r.x+x/scale)%grid===0||Math.floor(r.y+y/scale)%grid===0)){out.data[dest]=255;out.data[dest+1]=70;out.data[dest+2]=70;}
    }
    if(grid){const {label}=require('./labels.cjs');for(let x=Math.ceil(r.x/grid)*grid;x<r.x+r.width;x+=grid)label(out,Math.round(x),Math.round((x-r.x)*scale)+3,4,Math.max(1,scale));for(let y=Math.ceil(r.y/grid)*grid;y<r.y+r.height;y+=grid)label(out,Math.round(y),4,Math.round((y-r.y)*scale)+3,Math.max(1,scale));}
    const png=p.format==='png'||p.destination,bytes=png?PNG.sync.write(out):jpeg.encode(out,82).data;
    const directory=p.destination==='desktop'?path.join(os.homedir(),'Desktop'):await require('./artifacts.cjs').directory(root,'screenshots');await fs.mkdir(directory,{recursive:true,mode:0o700});
    const file=path.join(directory,`${d.name.replace(/[^\p{L}\p{N} ._-]/gu,'_')}-${randomUUID()}.${png?'png':'jpg'}`);await fs.writeFile(file,bytes,{mode:0o600});saved.add(file);if(saved.size>100)saved.delete(saved.values().next().value);seen.set(d.udid,JSON.stringify(f.screen));
    let inline=null;if(p._inline){for(const quality of [82,62,45]){const b=jpeg.encode(out,quality).data;if(b.length<=130000){inline=[{data:b.toString('base64')}];break;}}}
    if(p.destination==='clipboard'){
      // Browser ClipboardItem is the cross-platform clipboard owner. Return
      // bytes only to the trusted viewer request; Agent screenshots use files.
      return {udid:d.udid,path:file,mimeType:'image/png',clipboardPng:bytes.toString('base64'),execution:'executed'};
    }
    return {udid:d.udid,path:file,mimeType:png?'image/png':'image/jpeg',pixels:{width,height},screen:f.screen,scale,capturedAt:new Date().toISOString(),screenshotAttached:!!inline,...(p.region?{region:r}:{}),... (inline?{_modelImages:inline}:{}),note:'Android rectangular framebuffer, without an added corner or cutout mask; this does not verify physical screen occlusion. Image pixels divided by scale are view points; add the region origin when cropped. Use those coordinates for tap and gesture.'};
  }
  async function after(d,p,result){
    const started=Date.now(),callDeadline=p._deadline??Infinity;
    p={...p,_deadline:Math.min(callDeadline,started+(p.until?27000:12000))};
    try{
      if(p.until){result.wait=await waitFor(d,{text:p.until,timeout:15,_deadline:p._deadline});p._deadline=Math.min(callDeadline,Date.now()+12000);}
      else if(p.observe!=='none')await sleep(number(p.settle,'settle',0,5,0.6)*1000,p._deadline);
      if(['ui','both'].includes(p.observe??'ui'))result.ui=await describe(d,p);
      if(['screenshot','both'].includes(p.observe)){const {_modelImages,...shot}=await screenshot(d,p);result.screenshot=shot;if(_modelImages)result._modelImages=_modelImages;}
    }catch(e){result.observationError={code:e.code,message:e.message};result.nextAction='Observe with screenshot or wait_for; do not repeat delivered input.';}
    result.timing={...(p._startedAt===undefined?{}:{inputMs:started-p._startedAt}),observationMs:Date.now()-started};
    return result;
  }
  const releasedTouches=()=>Array.from({length:10},(_,identifier)=>({identifier,pressure:0}));
  async function release(d){return call(d,'sendTouch',{touches:releasedTouches()},{_deadline:Date.now()+3000});}
  async function gesture(d,p){
    if(p.kind==='scroll_to'){
      const maximum=number(p.max_swipes,'max_swipes',1,30,10);let performed=0;
      try{
        for(let i=0;i<=maximum;i++){const found=await find(d,p);if(found.element&&found.element.frame[1]>=0&&found.element.frame[1]+found.element.frame[3]<=found.ui.screen.height)return after(d,p,{udid:d.udid,execution:performed?'executed':'not_executed',element:found.element,swipes:performed});if(i<maximum){await gesture(d,{...p,kind:'swipe',direction:p.direction||'up',observe:'none'});performed++;}}
        throw fail('ELEMENT_NOT_FOUND','The element was not found after scrolling. Take a screenshot.',performed?'executed':'not_executed');
      }catch(e){
        e.swipes=performed;
        if(performed){if(e.execution!=='unknown')e.execution='executed';e.message=`${performed} swipe(s) completed. ${e.message} Observe the current screen before continuing; do not replay the scroll request.`;}
        throw e;
      }
    }
    const f=await frame(d,p),screen=f.screen;
    if(seen.has(d.udid)&&seen.get(d.udid)!==JSON.stringify(screen))throw fail('SCREEN_CHANGED','The Android screen changed size or orientation. Observe it again before using coordinates.');
    const duration=number(p.duration,'duration',0.01,10,p.kind==='tap'?0.05:0.4),hold=number(p.hold,'hold',0,10,0.6),count=number(p.count,'count',1,3,1);
    let paths=[];
    if(p.kind==='tap'){
      let at=[p.x,p.y];if(p.text||p.id||p.role){const match=await find(d,p);if(!match.element)throw fail('ELEMENT_NOT_FOUND','No matching Android element is visible. Take a screenshot.');if(JSON.stringify(match.ui.screen)!==JSON.stringify(screen))throw fail('SCREEN_CHANGED','The screen turned while locating the element. Observe again.');at=match.element.center;}
      paths=[[point(at,'tap'),at]];
    }else if(p.kind==='pinch'){
      const c=point(p.center||[screen.width/2,screen.height/2],'center'),a=number(p.from_spread,'from_spread',1,screen.width,60),b=number(p.to_spread,'to_spread',1,screen.width,240);
      paths=[[[c[0]-a/2,c[1]],[c[0]-b/2,c[1]]],[[c[0]+a/2,c[1]],[c[0]+b/2,c[1]]]];
    }else{
      let from=p.from,to=p.to;
      if(p.kind==='edge'){const edge=p.edge||'bottom';from=edge==='bottom'?[screen.width/2,screen.height-1]:edge==='top'?[screen.width/2,1]:edge==='left'?[1,screen.height/2]:[screen.width-1,screen.height/2];to=to||[screen.width/2,screen.height/2];}
      if(p.direction){const v={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[p.direction];if(!v)throw fail('INVALID_ARGUMENT','Invalid swipe direction.');const dist=number(p.distance,'distance',1,Math.max(screen.width,screen.height),Math.min(screen.width,screen.height)*0.6);from=from||p.within||[screen.width/2-v[0]*dist/2,screen.height/2-v[1]*dist/2];to=[from[0]+v[0]*dist,from[1]+v[1]*dist];}
      if(p.kind==='pan')from=from||[screen.width/2,screen.height/2];
      from=point(from,'from');
      if(p.kind==='pan'){const by=point(p.by,'by');paths=[[[from[0]-20,from[1]],[from[0]-20+by[0],from[1]+by[1]]],[[from[0]+20,from[1]],[from[0]+20+by[0],from[1]+by[1]]]];}
      else{if(!['swipe','drag','edge'].includes(p.kind))throw fail('INVALID_ARGUMENT','Unknown gesture.');paths=[[from,point(to,'to')]];}
    }
    for(const pair of paths)for(const at of pair){number(at[0],'x',0,screen.width);number(at[1],'y',0,screen.height);}
    const at=t=>paths.map(([a,b],identifier)=>({identifier,...require('./geometry.cjs').toNative(d.model,screen.rotation,(a[0]+(b[0]-a[0])*t)*screen.ratio,(a[1]+(b[1]-a[1])*t)*screen.ratio),pressure:1024}));
    const input=inputFor(d,p);
    try{for(let repeat=0;repeat<(p.kind==='tap'?count:1);repeat++){
      await input.send('sendTouch',{touches:at(0)});if(p.kind==='drag')await sleep(hold*1000,p._deadline);
      const steps=p.kind==='tap'?1:Math.max(2,Math.ceil(duration*30));
      for(let i=1;i<=steps;i++){await sleep(duration*1000/steps,p._deadline);if(p.kind!=='tap')await input.send('sendTouch',{touches:at(i/steps)});}
      await input.send('sendTouch',{touches:at(1).map(t=>({...t,pressure:0}))});if(repeat+1<count)await sleep(90,p._deadline);
    }}catch(e){if(input.sent)e.execution='unknown';throw e;}finally{if(input.sent)await release(d).catch(()=>{});}
    return after(d,p,{udid:d.udid,execution:'executed'});
  }
  async function typeText(d,p){
    const raw=p.keys===undefined?[]:Array.isArray(p.keys)?p.keys:[p.keys];if(raw.length>40||raw.some(k=>typeof k!=='string'))throw fail('INVALID_ARGUMENT','At most 40 key names are allowed.');
    if(p.text!==undefined&&(typeof p.text!=='string'||!p.text.length||p.text.length>8000||p.text.includes('\0')))throw fail('INVALID_ARGUMENT','Text must contain 1–8000 characters.');
    const parsed=raw.map(k=>{const parts=k==='+'?['+']:k.split('+'),base=parts.pop();const modifiers=parts.map(m=>({cmd:'Control',command:'Control',ctrl:'Control',control:'Control',shift:'Shift',alt:'Alt',option:'Alt',meta:'Meta'})[m.toLowerCase()]);if(modifiers.some(m=>!m)||!(base.length===1||keyNames[base]||/^(Arrow(Up|Down|Left|Right)|F([1-9]|1[0-2]))$/.test(base)))throw fail('INVALID_ARGUMENT',`Unknown key ${k}.`);return {key:keyNames[base]||base,modifiers};});
    if(p.method==='type'&&(!/^[\x20-\x7e\n\t]*$/.test(p.text||'')||(p.text||'').length>300))throw fail('INVALID_ARGUMENT','Typed input supports up to 300 ASCII characters. Use paste for Unicode.');
    if(!['auto','paste','type','touch'].includes(p.method??'auto'))throw fail('INVALID_ARGUMENT','Unknown input method.');
    if(p.method==='touch'&&(p.clear||p.keys!==undefined))throw fail('INVALID_ARGUMENT','Touch paste cannot be combined with clear or keys.');
    let method=p.method||'auto',focused=null;
    if(method==='touch'||method==='auto'){
      const ui=await describe(d,p);focused=ui.elements.find(e=>e.role==='field'&&e.focused);
      if(method==='touch'&&!focused)throw fail('FIELD_NOT_FOCUSED','Touch paste needs a focused Android text field. Tap it first.');
      if(method==='auto')method=!ui?.elements.some(e=>e.role==='field')&&/^[\x20-\x7e\n\t]{1,300}$/.test(p.text||'')?'type':'paste';
    }
    const input=inputFor(d,p),inputKey=key=>input.send('sendKey',{key,eventType:2});
    try{
      if(p.clear){await input.send('sendKey',{key:'Control',eventType:0});await inputKey('a');await input.send('sendKey',{key:'Control',eventType:1});await inputKey('Backspace');}
      if(p.text!==undefined){if(method==='type')for(const char of p.text)await inputKey(char==='\n'?'Enter':char==='\t'?'Tab':char);else{
        await input.send('setClipboard',{text:p.text});const actual=await call(d,'getClipboard',{},p);if(actual.text!==p.text)throw fail('CLIPBOARD_UNVERIFIED','Android clipboard did not match the input. Paste was not sent.','unknown');
        if(method==='touch'){
          await gesture(d,{_deadline:p._deadline,kind:'tap',x:focused.center[0],y:focused.center[1],duration:0.7,observe:'none'});await sleep(300,p._deadline);
          const menu=await describe(d,p),paste=menu.elements.find(e=>/^(paste|粘贴|貼り付け|붙여넣기)$/i.test(e.label||''));
          if(!paste)throw fail('PASTE_MENU_MISSING','The Android paste menu is not visible. Inspect the screen before continuing.','unknown');
          await gesture(d,{_deadline:p._deadline,kind:'tap',x:paste.center[0],y:paste.center[1],observe:'none'});
        }else await devices.adb(d,['shell','input','keyevent','279'],{deadline:p._deadline,mutation:true});
      }}
      for(const k of parsed){const pressed=[];try{for(const m of k.modifiers){const pending=input.send('sendKey',{key:m,eventType:0});pressed.push(m);await pending;}await inputKey(k.key);}finally{for(const m of pressed.reverse())await call(d,'sendKey',{key:m,eventType:1},{_deadline:Date.now()+3000}).catch(()=>{});}}
    }catch(e){if(input.sent)e.execution='unknown';throw e;}finally{if(input.sent&&method!=='touch')await call(d,'sendKey',{key:'Control',eventType:1},{_deadline:Date.now()+3000}).catch(()=>{});}
    return after(d,{...p,observe:p.observe??'none'},{udid:d.udid,method,execution:input.sent?'executed':'not_executed'});
  }
  async function press(d,p){
    const keys={home:'GoHome',back:'GoBack',lock:'Power',power:'Power','volume-up':'AudioVolumeUp','volume-down':'AudioVolumeDown','app-switcher':'AppSwitch','swipe-to-app-switcher':'AppSwitch','swipe-to-home':'GoHome'};
    if(!keys[p.button]&&!['shake','release-input','pull-down-to-notification-center'].includes(p.button))throw fail('INVALID_ARGUMENT','This Android device has no such hardware button.');
    number(p.duration,'duration',0,10,0);
    // Reads and validation cannot have shaken the device. Keep them outside
    // the existing mutation/restore try so failures retain not_executed.
    let pose,gravity;
    if(p.button==='shake'){
      pose=await call(d,'getPhysicalModel',{target:1},p);gravity=await call(d,'getSensor',{target:0},p);
      if(pose.status!==0||gravity.status!==0||pose.value?.data?.length!==3||gravity.value?.data?.length!==3)throw fail('SENSOR_UNAVAILABLE','Cannot confirm Android orientation before shaking.');
    }
    const input=inputFor(d,p);
    try{
    if(p.button==='shake'){
      try{for(let i=0;i<6;i++){const data=[...gravity.value.data];data[0]+=i%2?18:-18;await input.send('setSensor',{target:0,value:{data}});await sleep(60,p._deadline);}}
      finally{
        if(input.sent){
        try{await call(d,'setSensor',{target:0,value:gravity.value},{_deadline:Date.now()+3000});}
        finally{await call(d,'setPhysicalModel',{target:1,value:pose.value,interpolation:1},{_deadline:Date.now()+3000});}
        }
      }
    }
    else if(p.button==='release-input'){await input.send('sendTouch',{touches:releasedTouches()});for(const key of ['Control','Shift','Alt','Meta'])await input.send('sendKey',{key,eventType:1});}
    else if(p.button==='pull-down-to-notification-center')await devices.adb(d,['shell','cmd','statusbar','expand-notifications'],{deadline:p._deadline,mutation:true});
    else if(keys[p.button]){const duration=number(p.duration,'duration',0,10,0);if(duration){try{await input.send('sendKey',{key:keys[p.button],eventType:0});await sleep(duration*1000,p._deadline);}finally{if(input.sent)await call(d,'sendKey',{key:keys[p.button],eventType:1},{_deadline:Date.now()+3000});}}else await input.send('sendKey',{key:keys[p.button],eventType:2});}
    else throw fail('INVALID_ARGUMENT','This Android device has no such hardware button.');
    return {udid:d.udid,execution:'executed'};
    }catch(e){if(input.sent)e.execution='unknown';throw e;}
  }
  async function waitFor(d,p){
    const end=Math.min(p._deadline||Infinity,Date.now()+number(p.timeout,'timeout',0.1,90,15)*1000),stable=number(p.stable,'stable',0.1,30,undefined);let previous=null,since=Date.now(),matched=false;
    if(!stable&&!p.text&&!p.id&&!p.role&&!p.log)throw fail('INVALID_ARGUMENT','Choose an element, stable interval or log expression.');
    const began=Date.now();
    while(Date.now()<end){try{
      const q={...p,_deadline:end};
      if(stable){const f=await frame(d,q),image={...f.image,channels:4};const region=p.region?Object.fromEntries(Object.entries(p.region).map(([k,v])=>[k,v*f.screen.ratio])):undefined;
        if(!previous||pixels.changedShare(previous,image,region)>number(p.tolerance,'tolerance',0,100,0.5)/100)since=Date.now();previous=image;matched=!pixels.isBlank(image,region)&&Date.now()-since>=stable*1000;
      }else if(p.log){matched=(await logs(d,{...q,level:'debug',match:p.log,limit:1,_since:began/1000})).lines.length>0;}
      else{const found=await find(d,q);matched=p.gone?!found.element&&!found.ui.accessibilityError:!!found.element;}
      if(matched)break;if(Date.now()+300<end)await sleep(300,end);else break;
    }catch(e){if(Date.now()>=end||e.code==='TIME_BUDGET_EXHAUSTED')break;throw e;}
    }
    const result={udid:d.udid,met:matched,goalMet:matched,matched,timedOut:!matched};if(p.screenshot||!matched){try{const {_modelImages,...shot}=await screenshot(d,p);result.screenshot=shot;if(_modelImages)result._modelImages=_modelImages;}catch(e){result.screenshot={error:e.message};}}return result;
  }
  async function logs(d,p){
    const limit=number(p.limit,'limit',1,1000,150),seconds=number(p.last_seconds,'last_seconds',1,86400,120),level=p.level??'default';
    const priorities={error:'E',default:'W',info:'I',debug:'V'};
    if(!Object.hasOwn(priorities,level))throw fail('INVALID_ARGUMENT','Invalid Android log level.');
    let regex;try{if(p.match!==undefined){if(typeof p.match!=='string')throw Error();regex=new RegExp(p.match,'i');}}catch{throw fail('INVALID_ARGUMENT','Invalid log expression.');}
    const processName=p.process??p.bundleId,args=['logcat','-d','-v','epoch','-t','3000','-b','main'];
    const result={udid:d.udid,...(processName!==undefined?{process:processName}:{}),level,lastSeconds:seconds,
      note:'Android reads at most the latest 3000 logcat records before filtering, not iOS crash summaries. Scoped reads cover only the current exact PID; logs and crashes from earlier PIDs after exit/restart are not checked. Empty lines do not establish that no crash occurred.'};
    if(processName!==undefined){if(typeof processName!=='string'||!/^\w[\w.:-]*$/.test(processName))throw fail('INVALID_ARGUMENT','Invalid Android process name.');
      // ps succeeds even when the process is absent. Transport, identity and
      // budget errors must propagate instead of becoming an empty log result.
      const r=await devices.adb(d,['shell','ps','-A','-o','PID,NAME'],{deadline:p._deadline}),rows=r.stdout.trim().split(/\r?\n/);
      if(!/^\s*PID\s+NAME\s*$/.test(rows.shift()||''))throw fail('PROCESS_QUERY_FAILED','Android did not return a valid process list. Inspect the device connection.');
      const processes=rows.filter(l=>l.trim()).map(l=>/^\s*(\d+)\s+(\S+)\s*$/.exec(l));
      if(processes.some(m=>!m))throw fail('PROCESS_QUERY_FAILED','Android returned an invalid process entry. Inspect the device connection.');
      const process=processes.find(m=>m[2]===processName);
      if(!process)return {...result,lines:[],processRunning:false,note:'The process is not running. '+result.note};args.push('--pid='+process[1]);}
    if(p.crashes!==false)args.push('-b','crash');
    const raw=(await devices.adb(d,args,{deadline:p._deadline,maxBuffer:4e6})).stdout;
    const min=p._since??Date.now()/1000-seconds,records=raw.split('\n').filter(l=>l.trim());
    const lines=records.filter(l=>Number(l.trim().split(/\s+/)[0])>=min&&(!regex||regex.test(l))&&'VDIWEF'.indexOf(l.match(/\s([VDIWEF])\s/)?.[1]||'V')>='VDIWEF'.indexOf(priorities[level]));
    return {...result,lines:lines.slice(-limit),total:lines.length,truncated:lines.length>limit||records.length>=3000};
  }
  return {displayRotation:(d,p)=>displayRotation(devices,d,p),frame,describe,screenshot,gesture,tap:(d,p)=>gesture(d,{...p,kind:'tap'}),typeText,press,waitFor,logs,after,release,
    reveal:async p=>{if(!saved.has(p.path))throw fail('INVALID_ARGUMENT','Unknown screenshot.');const command=process.platform==='darwin'?['/usr/bin/open',['-R',p.path]]:process.platform==='win32'?['explorer.exe',['/select,',p.path]]:['xdg-open',[path.dirname(p.path)]];await run(...command,{timeout:10000});return {execution:'executed'};}};
}
module.exports={createAgent,number,point};
