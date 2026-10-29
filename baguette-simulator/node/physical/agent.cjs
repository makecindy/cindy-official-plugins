'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {PNG,jpeg}=require('../../vendor/android/deps.cjs');
const {fail}=require('./devices.cjs');
const number=(v,name,min,max,fallback)=>{if(v===undefined&&fallback!==undefined)return fallback;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw fail('INVALID_ARGUMENT',`${name}: ${min}–${max}`);return v;};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function compact(tree){
  const elements=[];
  function visit(n){if(!n||typeof n!=='object')return;const r=n.rect||{},role=/TextField|TextView/.test(n.type)?'field':/Button/.test(n.type)?'button':/StaticText/.test(n.type)?'text':'element';
    if(r.width>0&&r.height>0&&(n.label||n.name||role==='field'))elements.push({role,label:n.label||n.name||'',id:n.name||'',value:n.value,enabled:n.isEnabled!==false,frame:[r.x,r.y,r.width,r.height],center:[r.x+r.width/2,r.y+r.height/2]});
    for(const child of n.children||[])visit(child);
  }visit(tree);return elements;
}
function createAgent({root,wda,run,devices,live}){
  const seen=new Map(),saved=new Set();
  const call=(d,route,p,body)=>wda.call(d,route,p,body);
  async function geometry(d,p={}){
    if(devices){
      const [screen,apps]=await Promise.all([devices.screen(d,p),call(d,'/wda/apps/list',p)]),foreground=(apps||[]).filter(a=>a.bundleId&&a.bundleId!=='com.apple.springboard');
      await call(d,'/appium/settings',p,{settings:{cindyDisplayId:screen.displayId,defaultActiveApplication:foreground.length===1?foreground[0].bundleId:'auto'}});
      return screen;
    }
    const size=await call(d,'/window/size',p),orientation=await call(d,'/orientation',p);
    if(!(size?.width>0&&size?.height>0))throw fail('SCREEN_UNAVAILABLE','手机未返回有效画面尺寸。');
    return {width:size.width,height:size.height,orientation};
  }
  async function frame(d,p={}){
    if(live){
      const f=await live.snapshot(d,p),bytes=Buffer.from(f.image,'base64'),image=jpeg.decode(bytes),ratio=image.width/f.screen.width;
      return {bytes,image,screen:{...f.screen,ratio},source:f.source,capturedAt:new Date(f.capturedAt).toISOString(),frameAgeMs:f.frameAgeMs,sequence:f.sequence};
    }
    if(devices?.capture){
      const {bytes,screen}=await devices.capture(d,p),image=PNG.sync.read(bytes),ratio=image.width/screen.width;
      if(Math.abs(image.height/screen.height-ratio)>.05)throw fail('SCREEN_CHANGED','截图与手机坐标比例不一致，正在刷新画面。');
      return {bytes,image,screen:{...screen,ratio}};
    }
    const screen=await geometry(d,p),encoded=await call(d,'/screenshot',p);
    if(typeof encoded!=='string'||encoded.length>32*1024*1024)throw fail('INVALID_SCREENSHOT','手机截图数据无效。');
    const bytes=Buffer.from(encoded,'base64'),image=PNG.sync.read(bytes);
    if(JSON.stringify(screen)!==JSON.stringify(await geometry(d,p)))throw fail('SCREEN_CHANGED','截图时手机已转向，请重新观察。');
    const ratio=image.width/screen.width;
    if(Math.abs(image.height/screen.height-ratio)>.05)throw fail('SCREEN_CHANGED','截图与手机坐标比例不一致，请重新观察。');
    return {bytes,image,screen:{...screen,ratio}};
  }
  // Preview metadata is short-lived; every input still reads fresh geometry.
  // Keep full-resolution exports independent of the signed control component.
  async function preview(d,p={},screen){
    if(!wda.state(d.udid).ready){
      const f=await frame(d,p),{ratio,...screen}=f.screen;
      return {image:jpeg.encode(f.image,65).data.toString('base64'),mime:'image/jpeg',screen,fast:false};
    }
    screen ||= await devices.screen(d,p);
    try{
      const f=await call(d,`/cindy/frame/${screen.displayId}`,p);
      if(typeof f?.image!=='string'||f.image.length>8*1024*1024||!(f.width>0&&f.height>0))throw fail('INVALID_SCREENSHOT','手机预览数据无效。');
      if(Math.abs(f.width/f.height-screen.width/screen.height)>.01)throw fail('SCREEN_CHANGED','手机屏幕已变化，正在刷新画面。');
      return {image:f.image,mime:'image/jpeg',screen,fast:true};
    }catch(e){if(!wda.state(d.udid).ready)return preview(d,p);throw e;}
  }
  async function screenshot(d,p={}){
    if(p.corners===true)throw fail('UNSUPPORTED_OPTION','真机截图不添加模拟器外框，请省略 corners 或设为 false。');
    const f=await frame(d,p),scale=number(p.scale,'scale',1,3,1),r=p.region||{x:0,y:0,width:f.screen.width,height:f.screen.height};
    for(const [k,max] of [['x',f.screen.width],['y',f.screen.height],['width',f.screen.width-r.x],['height',f.screen.height-r.y]])number(r[k],k,k==='width'||k==='height'?1:0,max);
    const width=Math.round(r.width*scale),height=Math.round(r.height*scale),out=new PNG({width,height}),grid=p.grid===true?100:number(p.grid,'grid',0,1000,0);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const sx=Math.min(f.image.width-1,Math.floor((r.x+x/scale)*f.screen.ratio)),sy=Math.min(f.image.height-1,Math.floor((r.y+y/scale)*f.screen.ratio)),dest=(y*width+x)*4;
      f.image.data.copy(out.data,dest,(sy*f.image.width+sx)*4,(sy*f.image.width+sx)*4+4);
      if(grid&&(Math.floor(r.x+x/scale)%grid===0||Math.floor(r.y+y/scale)%grid===0)){out.data[dest]=255;out.data[dest+1]=70;out.data[dest+2]=70;}
    }
    if(grid){const {label}=require('../android/labels.cjs');for(let x=Math.ceil(r.x/grid)*grid;x<r.x+r.width;x+=grid)label(out,x,Math.round((x-r.x)*scale)+3,4,scale);for(let y=Math.ceil(r.y/grid)*grid;y<r.y+r.height;y+=grid)label(out,y,4,Math.round((y-r.y)*scale)+3,scale);}
    const png=p.format==='png'||p.destination,bytes=png?PNG.sync.write(out):jpeg.encode(out,82).data;
    const dir=p.destination==='desktop'?path.join(os.homedir(),'Desktop'):await require('../android/artifacts.cjs').directory(root,'screenshots');await fs.mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,`iPhone-${randomUUID()}.${png?'png':'jpg'}`);await fs.writeFile(file,bytes,{mode:0o600});saved.add(file);
    const {ratio,...screen}=f.screen;seen.set(d.udid,JSON.stringify(screen));
    let inline;if(p._inline)for(const quality of [82,62,45]){const b=jpeg.encode(out,quality).data;if(b.length<=130000){inline=[{data:b.toString('base64')}];break;}}
    return {udid:d.udid,platform:'physical',path:file,screen,pixels:{width,height},scale,...(p.region?{region:r}:{}),capturedAt:f.capturedAt||new Date().toISOString(),source:f.source||'device-capture',frameAgeMs:f.frameAgeMs,sequence:f.sequence,screenshotAttached:!!inline,
      ...(inline?{_modelImages:inline}:{}),...(p.destination==='clipboard'?{clipboardPng:bytes.toString('base64')}:{}),note:'真机画面。图片像素除以 scale，再加 region 原点，即可用于点击的视图坐标。'};
  }
  async function describe(d,p={}){
    const screen=await geometry(d,p),tree=await call(d,'/source?format=json',p);
    if(JSON.stringify(screen)!==JSON.stringify(await geometry(d,p)))throw fail('SCREEN_CHANGED','读取界面时手机已转向，请重新观察。');
    const all=compact(tree),elements=all.filter(e=>(!p.query||[e.label,e.id,String(e.value||'')].some(v=>v.includes(p.query)))&&(!p.role||e.role===p.role)&&
      (p.x===undefined||p.x>=e.frame[0]&&p.x<=e.frame[0]+e.frame[2])&&(p.y===undefined||p.y>=e.frame[1]&&p.y<=e.frame[1]+e.frame[3]));
    seen.set(d.udid,JSON.stringify(screen));const limit=number(p.limit,'limit',1,1000,250);
    return {udid:d.udid,screen,source:'accessibility',elements:elements.slice(0,limit),total:elements.length,...(p.mode==='full'?{tree}:{}),...(!all.length?{note:'此界面没有可读无障碍元素，请使用截图与坐标。'}:{})};
  }
  async function actions(d,p,paths,duration=300,hold=0){
    if(live)return live.actions(d,p,paths,duration,hold,p.expectedScreen||(seen.has(d.udid)?JSON.parse(seen.get(d.udid)):undefined));
    const screen=await geometry(d,p),expected=p.expectedScreen?JSON.stringify(p.expectedScreen):seen.get(d.udid);
    if(expected&&expected!==JSON.stringify(screen))throw fail('SCREEN_CHANGED','手机画面尺寸或方向已变化，请重新观察后操作。');
    const prepared=paths.map((points,i)=>{
      if(!Array.isArray(points)||!points.length||points.length>100)throw fail('INVALID_ARGUMENT','触摸路径无效。');
      for(const pt of points){if(!Array.isArray(pt)||pt.length!==2)throw fail('INVALID_ARGUMENT','触摸坐标无效。');number(pt[0],'x',0,screen.width);number(pt[1],'y',0,screen.height);}
      return {type:'pointer',id:`finger${i}`,parameters:{pointerType:'touch'},actions:[{type:'pointerMove',duration:0,x:Math.round(points[0][0]),y:Math.round(points[0][1]),origin:'viewport'},
        {type:'pointerDown',button:0},{type:'pause',duration:hold},...points.slice(1).map(pt=>({type:'pointerMove',duration:Math.round(duration/Math.max(1,points.length-1)),x:Math.round(pt[0]),y:Math.round(pt[1]),origin:'viewport'})),{type:'pointerUp',button:0}]};
    });
    await call(d,'/actions',p,{actions:prepared});return {udid:d.udid,execution:'executed'};
  }
  async function after(d,p,result){
    const mode=p.observe??(live?'screenshot':'ui');if(mode==='none')return result;
    p={...p,_frameAfter:result.inputFinishedAt};
    try{await pause(number(p.settle,'settle',0,5,.4)*1000);
      if(p.until){result.wait=await waitFor(d,{...p,text:p.until,timeout:15,screenshot:false});}
      if(['ui','both'].includes(mode))result.ui=await describe(d,p);
      if(['screenshot','both'].includes(mode)){const {_modelImages,...shot}=await screenshot(d,p);result.screenshot=shot;if(_modelImages)result._modelImages=_modelImages;}
    }catch(e){result.observationError={code:e.code,message:e.message};}return result;
  }
  async function tap(d,p){
    let x=p.x,y=p.y;
    if(p.text!==undefined||p.id!==undefined){const ui=await describe(d,p);const found=ui.elements.filter(e=>(p.text===undefined||e.label===p.text)&&(p.id===undefined||e.id===p.id));const n=number(p.nth,'nth',0,999,0);if(!found[n])throw fail('ELEMENT_NOT_FOUND','未找到要点击的元素，请重新观察。');[x,y]=found[n].center;}
    const count=number(p.count,'count',1,2,1),duration=number(p.duration,'duration',0,10,.05);
    if(!Number.isInteger(count))throw fail('INVALID_ARGUMENT','count 必须为 1 或 2。');
    let completed=false,result;
    try{for(let i=0;i<count;i++){result=await actions(d,p,[[[x,y]]],0,duration*1000);completed=true;}}
    catch(e){if(completed)e.execution='unknown';throw e;}
    return after(d,p,result);
  }
  async function gesture(d,p){
    if(p.phase){if(!live)throw fail('UNSUPPORTED_GESTURE','此设备不支持分阶段触摸。');return after(d,p,await live.touch(d,p,seen.has(d.udid)?JSON.parse(seen.get(d.udid)):undefined));}
    const s=live?await live.screen(d,p):await geometry(d,p),duration=number(p.duration,'duration',.05,10,.35)*1000,hold=number(p.hold,'hold',0,10,p.kind==='drag'?.6:0)*1000;
    let paths;
    if(p.kind==='swipe'||p.kind==='drag'){
      let from=p.from,to=p.to;
      if(p.direction){const v={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[p.direction];if(!v)throw fail('INVALID_ARGUMENT','滑动方向无效。');const dist=number(p.distance,'distance',1,Math.min(s.width,s.height),Math.min(s.width,s.height)*.5);from=[s.width/2-v[0]*dist/2,s.height/2-v[1]*dist/2];to=[from[0]+v[0]*dist,from[1]+v[1]*dist];}paths=[[from,to]];
    }else if(p.kind==='pinch'){
      const c=p.center||[s.width/2,s.height/2],a=number(p.from_spread,'from_spread',1,s.width,60),b=number(p.to_spread,'to_spread',1,s.width,240);
      paths=[[[c[0]-a/2,c[1]],[c[0]-b/2,c[1]]],[[c[0]+a/2,c[1]],[c[0]+b/2,c[1]]]];
    }else if(p.kind==='pan'){
      const f=p.from||[s.width/2,s.height/2],by=p.by;if(!Array.isArray(by)||by.length!==2||!by.every(Number.isFinite))throw fail('INVALID_ARGUMENT','by 必须是 [dx,dy]。');paths=[[[f[0]-20,f[1]],[f[0]-20+by[0],f[1]+by[1]]],[[f[0]+20,f[1]],[f[0]+20+by[0],f[1]+by[1]]]];
    }else throw fail('UNSUPPORTED_GESTURE','真机支持 swipe、drag、pinch 和 pan。');
    return after(d,p,await actions(d,p,paths,duration,hold));
  }
  async function typeText(d,p){
    if(p.method && p.method!=='auto')throw fail('UNSUPPORTED_OPTION','真机输入使用 auto，通过 XCTest 输入 Unicode 文字。');
    if(p.clear)throw fail('UNSUPPORTED_OPTION','真机暂不支持 clear，请先选中输入框内容再输入。');
    if(p.text!==undefined&&(typeof p.text!=='string'||p.text.length>8000))throw fail('INVALID_ARGUMENT','text 必须是不超过 8000 字的文字。');
    const keys={Enter:'\n',Return:'\n',Backspace:'\u0008',Tab:'\t'};let text=p.text||'';
    for(const key of p.keys===undefined?[]:Array.isArray(p.keys)?p.keys:[p.keys]){if(!keys[key])throw fail('UNSUPPORTED_KEY','真机支持 Enter、Backspace、Tab；其他输入请使用文字或触摸。');text+=keys[key];}
    if(!text)throw fail('INVALID_ARGUMENT','请输入 text 或 keys。');
    await geometry(d,p);
    if(devices){const keyboard=await call(d,'/cindy/keyboard-ready',p);if(!keyboard?.ready)throw fail('KEYBOARD_NOT_READY','手机输入框尚未就绪，文字尚未发送。请点选输入框后再输入。');}
    await call(d,'/wda/keys',p,{value:[text]});return after(d,{...p,observe:p.observe??'none'},{udid:d.udid,execution:'executed',inputFinishedAt:Date.now()});
  }
  async function press(d,p){
    if(p.duration)throw fail('UNSUPPORTED_OPTION','真机硬件按钮暂不支持长按。');
    if(live&&p.button==='home')return after(d,p,await live.home(d,p));
    if(live&&p.button==='release-input')return live.release(d.udid);
    if(p.button==='release-input')return {udid:d.udid,execution:'not_executed',note:'真机触摸在每次完整动作结束时释放。'};
    const names={home:'home','volume-up':'volumeup','volume-down':'volumedown'};if(!names[p.button])throw fail('UNSUPPORTED_BUTTON','真机支持 home、volume-up、volume-down。');
    await call(d,'/wda/pressButton',p,{name:names[p.button]});return after(d,p,{udid:d.udid,execution:'executed'});
  }
  async function waitFor(d,p){
    if((!p.text&&!p.id)||p.stable!==undefined||p.log!==undefined)throw fail('UNSUPPORTED_WAIT','真机 wait_for 目前仅支持 text 或 id。');
    const end=Math.min(p._deadline||Infinity,Date.now()+number(p.timeout,'timeout',0,30,10)*1000);let met=false;
    while(Date.now()<end){const ui=await describe(d,{...p,_deadline:end});const match=ui.elements.some(e=>(!p.text||e.label.includes(p.text))&&(!p.id||e.id===p.id));met=p.gone?!match:match;if(met||Date.now()>=end-500)break;await pause(300);}
    const result={udid:d.udid,met,goalMet:met,timedOut:!met};
    if(p.screenshot)try{const {_modelImages,...shot}=await screenshot(d,p);result.screenshot=shot;if(_modelImages)result._modelImages=_modelImages;}catch(e){result.screenshot={error:{code:e.code,message:e.message}};}
    return result;
  }
  return {geometry,frame,preview,screenshot,describe,tap,gesture,typeText,press,waitFor,actions,after,
    async reveal(p){if(!saved.has(p.path))throw fail('INVALID_ARGUMENT','未知截图。');await run('/usr/bin/open',['-R',p.path],{timeout:5000});return {execution:'executed'};}};
}
module.exports={createAgent,compact,number};
