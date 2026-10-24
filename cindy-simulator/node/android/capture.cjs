'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {PNG,jpeg}=require('../../vendor/android/deps.cjs'),{rpc}=require('./grpc.cjs'),{number}=require('./agent.cjs');
const {commandBudget}=require('../budget.cjs'),{label}=require('./labels.cjs');
const {normalizeFrame}=require('./geometry.cjs');
async function capture({d,p,root,agent,perform}){
  const seconds=number(p.seconds,'seconds',0.5,15,3),fps=number(p.fps,'fps',1,20,10),max=number(p.max_frames,'max_frames',2,30,12),start=Date.now(),deadline=p._deadline||start+110000;
  let before,stream=Promise.resolve();
  const frames=[],abort=new AbortController();let changed=false,shape=null,last=0,error=null,actionResult=null,actionError=null,finished=start,keptBytes=0,lastHash=null,received=0;
  const confirmScreen=async()=>{
    if(changed||JSON.stringify(before)!==JSON.stringify((await agent.frame(d,p)).screen))throw Object.assign(Error('The screen changed during capture. Record again with a fixed orientation.'),{code:'SCREEN_CHANGED'});
  };
  const width=Math.round(d.model.width/(d.model.density/160)),height=Math.round(d.model.height/(d.model.density/160));
  try{
  commandBudget(seconds*1000,deadline);
  before=(await agent.frame(d,p)).screen;
  stream=rpc(d.endpoint,'streamScreenshot',{format:0,width:Math.max(width,height),height:Math.max(width,height)},{deadline,signal:abort.signal,onData:image=>{
    const now=Date.now(),geometry=JSON.stringify([image.format.width,image.format.height,image.format.rotation?.rotation]);
    if(shape&&shape!==geometry)changed=true;shape=geometry;
    if(!image.image.length||now-last<1000/fps)return;last=now;received++;
    const hash=createHash('sha256').update(image.image).digest('hex');if(hash===lastHash)return;lastHash=hash;
    if((keptBytes+=image.image.length)>64e6){error=Object.assign(Error('Capture exceeded its memory limit. Use a shorter interval.'),{code:'CAPTURE_TOO_LARGE'});abort.abort();return;}
    frames.push({at:now,bytes:Buffer.from(normalizeFrame(image,before.rotation||0).bytes)});
  }}).catch(e=>{if(!abort.signal.aborted)error=e;});
    while(!frames.length&&!error&&Date.now()<Math.min(deadline,start+5000))await new Promise(r=>setTimeout(r,20));
    if(error)throw error;if(!frames.length)throw Error('Android produced no capture frames.');
    await confirmScreen();
    if(p.action)try{actionResult=await perform(p.action);}catch(e){actionError={code:e.code,message:e.message,execution:e.execution||'unknown'};}
    finished=Date.now();
    await confirmScreen();
    if(commandBudget(seconds*1000,deadline).timeout<seconds*1000)throw Object.assign(Error('Not enough time remains to finish capture.'),{code:'TIME_BUDGET_EXHAUSTED'});
    await new Promise(r=>setTimeout(r,seconds*1000));
    await confirmScreen();
  }catch(e){error=e;}
  finally{abort.abort();await stream;}
  const outcome={udid:d.udid,execution:actionError?.execution||actionResult?.execution||'not_executed',...(actionResult?{action:actionResult}:{}),...(actionError?{actionError}:{})};
  const failed=e=>({...outcome,captureError:{code:e.code||'CAPTURE_FAILED',message:e.message},note:'No contact sheet was generated. The action outcome is retained; inspect execution before continuing.'});
  if(error)return failed(error);
  if(changed)return failed(Object.assign(Error('The screen changed during capture. Record again with a fixed orientation.'),{code:'SCREEN_CHANGED'}));
  try{
  const distinct=frames.length;
  if(frames.length>max){const chosen=Array.from({length:max},(_,i)=>frames[Math.round(i*(frames.length-1)/(max-1))]);frames.splice(0,frames.length,...chosen);}
  const first=PNG.sync.read(frames[0].bytes);
  const columns=Math.min(4,frames.length),cellWidth=240,cellHeight=Math.round(first.height/first.width*cellWidth),rows=Math.ceil(frames.length/columns),sheet=new PNG({width:columns*cellWidth,height:rows*(cellHeight+20),fill:true});sheet.data.fill(245);
  const directory=path.join(await require('./artifacts.cjs').directory(root,'captures'),randomUUID());await fs.mkdir(directory,{recursive:true,mode:0o700});
  const results=[];
  for(let i=0;i<frames.length;i++){
    commandBudget(1,deadline);
    const f=frames[i],image=PNG.sync.read(f.bytes),x0=(i%columns)*cellWidth,y0=Math.floor(i/columns)*(cellHeight+20);
    for(let y=0;y<cellHeight;y++)for(let x=0;x<cellWidth;x++){const src=(Math.min(image.height-1,Math.floor(y*image.height/cellHeight))*image.width+Math.min(image.width-1,Math.floor(x*image.width/cellWidth)))*4,dest=((y0+y)*sheet.width+x0+x)*4;image.data.copy(sheet.data,dest,src,src+4);}
    const ms=f.at-finished;label(sheet,`${ms<0?'':'+'}${ms}ms`,x0+6,y0+cellHeight+5,2);
    const file=path.join(directory,String(i+1)+'.png');await fs.writeFile(file,f.bytes,{mode:0o600});results.push({ms,path:file});
  }
  const file=path.join(directory,'contact-sheet.jpg'),bytes=jpeg.encode(sheet,70).data;await fs.writeFile(file,bytes,{mode:0o600});
  return {...outcome,sheet:file,frames:results,received,distinct,screen:before,...(p._inline&&bytes.length<=130000?{_modelImages:[{data:bytes.toString('base64')}]}:{}),note:'Frames run left to right, then top to bottom; labels show milliseconds since the action finished. Use a fresh screenshot for input coordinates.'};
  }catch(e){return failed(e);}
}
module.exports={capture};
