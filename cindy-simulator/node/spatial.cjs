'use strict';
const {createTrackpad}=require('./trackpad.cjs');
const MODES=['interact','tilt','pan','orbit','dolly','move','reset','gaze','two-hands','pointer'];
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
function sample(p,Failure=Error){
 const value={...p,z:p.z??0,aspect:p.aspect??1,spread:p.spread??.1,angle:p.angle??0,yaw:p.yaw??0,pitch:p.pitch??0};
 const xyLimit=value.mode==='pointer'?1e9:10;
 if(typeof value.gesture!=='string'||!(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.gesture))||
   !['began','changed','ended'].includes(value.phase)||!MODES.includes(value.mode)||
   !finite(value.x,-xyLimit,xyLimit)||!finite(value.y,-xyLimit,xyLimit)||!finite(value.z,-10,10)||!finite(value.aspect,.5,4)||!finite(value.spread,0,2)||!finite(value.angle,-20,20)||!finite(value.yaw,-20,20)||!finite(value.pitch,-20,20)||
   (value.mode==='pointer'&&(!Number.isInteger(value.z)||value.z<0||value.z>3)))
   throw new Failure('INVALID_ARGUMENT','Invalid Vision Pro input sample.');
 return value;
}
function encode(p){const v=sample(p);return [ ['began','changed','ended'].indexOf(v.phase),MODES.indexOf(v.mode),v.x,v.y,v.z,v.aspect,v.spread,v.angle,v.yaw,v.pitch].join(' ')+'\n';}
function createSpatial(options){
 return createTrackpad({...options,validateSample:p=>sample(p,options.Failure),encodeSample:encode});
}
// Plan fully before touching the device. Positions use screenshot view points;
// camera translation is in metres, rotation in degrees, positive dolly is back.
function plan(p,screen,Failure=Error){
 const fail=message=>{throw new Failure('INVALID_ARGUMENT',message);};
 const scalar=(v,f,min,max)=>{v=v??f;if(!finite(v,min,max))fail(`Expected a number in ${min}..${max}`);return v;};
 const point=(v,f)=>{v=v??f;if(!Array.isArray(v)||v.length!==2||!finite(v[0],0,screen.width)||!finite(v[1],0,screen.height))fail('Use points inside the current screenshot.');return [v[0]/screen.width,v[1]/screen.height];};
 const action=p.action,center=[screen.width/2,screen.height/2];
 const duration=scalar(p.duration,.5,.05,10),hold=scalar(p.hold,0,0,5);
 const gesture=require('node:crypto').randomUUID(),base={gesture,aspect:screen.width/screen.height,mode:action,x:0,y:0,z:0,spread:.1,angle:0};
 let start={...base},end={...base};
 if(['drag','pinch','rotate','gaze'].includes(action)){
  const [x,y]=point(p.from??p.center,center);Object.assign(start,{x,y,mode:action==='gaze'?'gaze':action==='drag'?'interact':'two-hands'});end={...start};
  if(action==='drag'){const [x,y]=point(p.to,p.from??center);Object.assign(end,{x,y,z:scalar(p.depth,0,-2,2)});}
  if(action==='pinch'){end.spread=.1*scalar(p.scale,2,.1,10);if(p.to)[end.x,end.y]=point(p.to);}
  if(action==='rotate')end.angle=scalar(p.angle,45,-360,360)*Math.PI/180;
 }else if(['tilt','pan','orbit','dolly','move','reset'].includes(action)){
  const by=p.by??[0,0];if(!Array.isArray(by)||(by.length!==2&&!(action==='move'&&by.length===3))||!by.every(n=>finite(n,-360,360)))fail('Use by=[x, y] for pan/tilt/orbit or by=[x, y, z] for move; use move or dolly for depth.');
  if(action==='tilt'||action==='orbit'){end.x=by[0]/180;end.y=by[1]/180;}
  else if(action==='pan'){end.x=-scalar(by[0],0,-5,5)/2;end.y=scalar(by[1],0,-5,5)/2;}
  else if(action==='dolly')end.y=scalar(p.distance,0,-5,5)/2;
  else if(action==='move'){end.x=scalar(by[0],0,-5,5);end.y=scalar(by[1],0,-5,5);end.z=scalar(by[2],0,-5,5);}
 }else fail('Unknown spatial action.');
 sample({...start,phase:'began'},Failure);sample({...end,phase:'ended'},Failure);
 const count=Math.ceil((duration+hold)*30),out=[{...start,phase:'began',at:0}];
 for(let i=1;i<=count;i++){
  const at=(duration+hold)*1000*i/count,t=Math.min(1,Math.max(0,(at/1000-hold)/duration)),value={...start,phase:i===count?'ended':'changed',at};
  for(const key of ['x','y','z','spread','angle'])value[key]=start[key]+(end[key]-start[key])*t;
  out.push(value);
 }
 return out;
}
async function perform(manager,udid,samples,developerDir,deadline=Date.now()+20000){
 let last=null;
 if(Date.now()+samples.at(-1).at>=deadline)throw Object.assign(Error('Not enough time for this spatial gesture.'),{code:'TIME_BUDGET_EXHAUSTED',execution:'not_executed'});
 try{
  await manager.send(udid,samples[0],developerDir);last=samples[0];const start=Date.now();
  for(const p of samples.slice(1)){
   if(Date.now()+Math.max(0,start+p.at-Date.now())>=deadline)throw Object.assign(Error('Spatial input deadline exceeded.'),{code:'TIME_BUDGET_EXHAUSTED',execution:'unknown'});
   await new Promise(r=>setTimeout(r,Math.max(0,start+p.at-Date.now())));
   await manager.send(udid,p);last=p;
  }
 }catch(error){if(last)error.execution='unknown';await manager.cancel(udid);throw error;}
}
module.exports={createSpatial,sample,encode,plan,perform,MODES};
