'use strict';
const {spawn,execFileSync}=require('node:child_process');
const net=require('node:net');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {createClipboard}=require('./clipboard.cjs');
const {deviceId}=require('./device-id.cjs');
// The viewer address (port + capability) survives worker restarts so open tabs
// can reconnect. It is forgotten when the user turns simulators off.
const sessionFile=deviceSet=>path.join(path.dirname(deviceSet),'viewer-session.json');
function readSession(deviceSet){try{return JSON.parse(fs.readFileSync(sessionFile(deviceSet),'utf8'));}catch{return {};}}
function writeSession(deviceSet,session){
 const file=sessionFile(deviceSet),temporary=file+'.'+process.pid+'.tmp';
 try{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(temporary,JSON.stringify(session),{mode:0o600});fs.renameSync(temporary,file);}catch{try{fs.rmSync(temporary,{force:true});}catch{}}
}
function forgetSession(deviceSet){try{fs.rmSync(sessionFile(deviceSet),{force:true});}catch{}}
function hasSession(deviceSet){const value=readSession(deviceSet);return typeof value.token==='string'&&/^[0-9a-f]{64}$/.test(value.token)&&Number.isInteger(value.port)&&value.port>1023&&value.port<=65535;}
let active=null;
let controls=null;
// An open page's authenticated status polls count even without a live stream.
// Keep a short grace after opening, polling or stream disconnection.
const VIEWER_GRACE_MS=60000;
let lastViewerSeen=0;
function viewing(now=Date.now()){
 if((active?.clipboard?.viewers?.()||0)>0)lastViewerSeen=now;
 return now-lastViewerSeen<=VIEWER_GRACE_MS;
}
function configureControls(value){controls=value;}
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}
function probe(url){return new Promise((resolve,reject)=>{const request=http.get(url,{timeout:1500},response=>{response.resume();response.on('end',()=>response.statusCode===200?resolve():reject(Error('Viewer HTTP '+response.statusCode)));});request.once('timeout',()=>request.destroy(Error('Viewer timed out')));request.once('error',reject);});}
async function stopViewer(){
 const current=active;if(!current)return {stopped:false};active=null;current.stopped=true;clearTimeout(current.restartTimer);current.clipboard?.close();
 const child=current.child;
 if(!child||child.exitCode!==null||child.signalCode!==null)return {stopped:true};
 await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),3000);child.once('close',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
 return {stopped:true};
}
// The host gives a stopping worker about 2 s before SIGKILL, less than shutting
// devices down takes; a serve child it never stopped is re-parented to launchd and
// keeps capturing. Exit paths drop it first, and a new worker reaps any left over.
function abandonViewer(){
 const current=active;if(!current)return;active=null;current.stopped=true;clearTimeout(current.restartTimer);current.clipboard?.close();
 const child=current.child;if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
}
function orphanedServes(binary,deviceSet,listing){
 return String(listing).split('\n').map(line=>line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
  .filter(m=>m&&m[2]==='1'&&m[3].startsWith(binary+' serve ')&&m[3].includes(' --device-set '+deviceSet+' ')).map(m=>Number(m[1]));
}
function reapOrphans(binary,deviceSet,{list=()=>execFileSync('/bin/ps',['-axww','-o','pid=,ppid=,command='],{encoding:'utf8',timeout:5000}),kill=pid=>process.kill(pid,'SIGTERM')}={}){
 let pids=[];try{pids=orphanedServes(binary,deviceSet,list());}catch{return [];}
 for(const pid of pids){try{kill(pid);}catch{/* already gone */}}
 return pids;
}
function launch(current){
 if(current.stopped)return;
 current.error=null;current.log='';current.generation=(current.generation||0)+1;
 const child=spawn(current.binary,['serve','--host','127.0.0.1','--port',String(current.port),'--device-set',current.deviceSet,'--no-plugins'],{stdio:['ignore','pipe','pipe'],shell:false});
 current.child=child;current.children.add(child);
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{current.log=(current.log+chunk.toString()).slice(-4000);});
 child.once('error',error=>{current.error=error;});
 child.once('close',(code,signal)=>{
  current.children.delete(child);
  if(current.stopped||current.retiring===child||active!==current)return;
  current.lastExit={code,signal,at:new Date().toISOString()};
  current.crashes=current.crashes.filter(t=>Date.now()-t<60000);current.crashes.push(Date.now());
  process.stderr.write('[baguette-viewer] '+JSON.stringify(current.lastExit)+'\n');
  if(current.crashes.length>5){current.parked=true;current.error=Error('Viewer crashed repeatedly. Call open_viewer explicitly to retry.');return;}
  current.restartTimer=setTimeout(()=>launch(current),500);
 });
}
async function ready(current){
 const deadline=Date.now()+12000;
 while(Date.now()<deadline){
  if(current.stopped)throw Error('Viewer stopped');
  if(current.parked)throw current.error;
  const child=current.child;
  if(child&&child.exitCode===null&&child.signalCode===null){
   // Readiness belongs to the live service, not its rolling diagnostic log.
   // Re-check the child after probing: it may have restarted during the request.
   try{await probe(current.base+'/simulators');if(!current.stopped&&current.child===child&&child.exitCode===null&&child.signalCode===null)return current;}catch{}
  }
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 const detail=current.error?.message||[...new Set(current.log.split('\n').filter(Boolean))].slice(-2).join(' ').slice(-600);
 throw Error('Viewer service did not become reachable within 12 seconds. Retry viewer action=open; do not relaunch the App. '+detail);
}
async function startViewer(binary,deviceSet,children,clipboardAction){
 if(active&&!active.stopped){if(active.starting)return active.starting;if(active.parked)await restartNative(active);return ready(active);}
 const previousPort=active?.port;
 if(active)await stopViewer();
 const current={binary,deviceSet,children,child:null,log:'',error:null,stopped:false,parked:false,crashes:[],lastExit:null,restartTimer:null};active=current;
 // Reserve the shared server before the first await. Its bridge is part of the
 // same startup, so all devices receive one completely initialized owner.
 current.starting=(async()=>{
  try{
   current.port=previousPort||await freePort();current.base='http://127.0.0.1:'+current.port;
   if(current.stopped)throw Error('Viewer stopped');
   launch(current);await ready(current);
   await initializeBridge(current,deviceSet,clipboardAction);
   if(current.stopped){current.clipboard.close();throw Error('Viewer stopped');}
   return current;
  }catch(error){if(active===current)await stopViewer();throw error;}
  finally{current.starting=null;}
 })();
 return current.starting;
}
async function restartNative(current){
 if(current.restartPromise)return current.restartPromise;
 current.restartPromise=(async()=>{
  clearTimeout(current.restartTimer);
  try{
   const child=current.child;current.retiring=child;
   if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),3000);child.once('close',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
   current.parked=false;current.crashes=[];launch(current);await ready(current);
   return {ready:true,generation:current.generation};
  }finally{current.retiring=null;current.restartPromise=null;}
 })();return current.restartPromise;
}
// Backstop for server memory: unpatched Baguette 0.2.7/0.2.8 kept about 33 MB per
// closed 3D stream (foldables reconnect on every task-page load; fixed by the
// bundled patch, tddworks/baguette#123). With nobody watching, a server past this
// budget restarts on the same port; tabs reconnect.
const RECYCLE_RSS_KB=1536*1024;
function residentKb(pid){
 try{return Number(execFileSync('/bin/ps',['-o','rss=','-p',String(pid)],{encoding:'utf8',timeout:5000}).trim())||0;}catch{return 0;}
}
async function recycleIfBloated({rssKb=residentKb,now=Date.now()}={}){
 const current=active;
 if(!current||current.stopped||current.parked||current.restartPromise||viewing(now))return false;
 const child=current.child;
 if(!child||child.exitCode!==null||child.signalCode!==null)return false;
 const kb=rssKb(child.pid);
 if(kb<RECYCLE_RSS_KB)return false;
 process.stderr.write('[baguette-viewer] recycling idle server at '+Math.round(kb/1024)+' MB\n');
 await restartNative(current);
 return true;
}
async function viewerStatus(server){
 let available=false;try{await probe(server.base+'/simulators');available=true;}catch{}
 return {ready:available,parked:server.parked,generation:server.generation};
}
async function initializeBridge(server,deviceSet,clipboardAction){
 const preferred=readSession(deviceSet);
 server.clipboard=await createClipboard(server.base,clipboardAction,{
  port:server.port,
  status:async p=>{
   // The page is still open even if its stream or device status is unavailable.
   lastViewerSeen=Date.now();
   const state=controls?await controls.status():null;
   let currentApp=null,currentAppError;
   try{currentApp=await controls?.currentApp?.(p.udid)??null;}
   catch(error){
    if(error.code!=='APP_CONTEXT_UNREADABLE')throw error;
    currentAppError={code:error.code,message:error.message};
   }
   return {viewerPlatform:'ios',...await viewerStatus(server),device:state?.devices.find(d=>d.udid===p.udid),devices:state?.devices,deviceJob:state?.deviceJob,
    currentApp,...(currentAppError?{currentAppError}:{}),settings:state?.settings,idleDeadline:state?.idleDeadline};
  },
  open:p=>controls.request('open_viewer',{udid:p.udid,_locale:p.locale}),
  catalog:()=>controls.request('viewer_catalog'),
  resources:p=>controls.request('resource_usage',{udid:p.udid,refresh:p.refresh===true}),
  viewport:p=>controls.request('viewer_screen',{udid:p.udid}),
  create:async p=>{const created=await controls.request('create_device',{name:p.name,deviceType:p.deviceType,runtime:p.runtime});return {ok:created.ok!==false,created};},
  rename:async p=>{await controls.request('rename_device',{udid:p.targetUdid,name:p.name});return {ok:true,devices:(await controls.status()).devices};},
  switch:async p=>{const job=await controls.request('viewer_switch',{udid:p.udid,targetUdid:p.targetUdid,_locale:p.locale,task:p.task});server.clipboard.devices.add(job.targetUdid);return {ok:true,job};},
  restart:()=>controls?controls.exclusive(async()=>{await controls.assertEnabled();return restartNative(server);}):restartNative(server),
  release:p=>controls?controls.exclusive(async()=>{await controls.assertEnabled();await clipboardAction({udid:p.udid,action:'release'});controls.touch();return {ok:true};},`device:${deviceId(p.udid)}`):clipboardAction({udid:p.udid,action:'release'}),
  shutdown:p=>controls.request('settings_shutdown',{udid:p.udid}),
  // Both run under the runtime lock and the user's run switch, like Agent tools.
  boot:p=>controls.request('settings_boot',{udid:p.udid,memoryMode:p.memoryMode}),
  restart_device:p=>controls.request('settings_restart',{udid:p.udid,memoryMode:p.memoryMode}),
  press:p=>controls.request('press',{udid:p.udid,button:p.button}),
  tap:p=>controls.request('viewer_tap',{udid:p.udid,x:p.x,y:p.y,duration:p.duration}),
  trackpad:p=>controls.request('viewer_trackpad',{udid:p.udid,gesture:p.gesture,phase:p.phase,x:p.x,y:p.y}),
  spatial:p=>controls.request('viewer_spatial',{udid:p.udid,gesture:p.gesture,phase:p.phase,mode:p.mode,x:p.x,y:p.y,z:p.z,aspect:p.aspect,spread:p.spread,angle:p.angle,yaw:p.yaw,pitch:p.pitch}),
  screenshot:p=>controls.request('screenshot',{udid:p.udid,destination:p.to==='clipboard'?'clipboard':'desktop',orientation:p.orientation}),
  screenshot_destination:p=>controls.request('screenshot_destination',{destination:p.destination}),
  reveal:p=>controls.request('reveal_screenshot',{path:p.path}),
  activity:async()=>{await controls?.assertEnabled();controls?.touch();return {ok:true};},
  guard:()=>controls?.assertEnabled(),
  run:(fn,udid)=>controls?controls.exclusive(fn,udid?`device:${deviceId(udid)}`:'*'):fn(),
  touch:()=>controls?.touch()
 },preferred);
 const session=server.clipboard.session;
 if(session.port!==preferred.port||session.token!==preferred.token)writeSession(deviceSet,session);
}
async function openViewer(binary,deviceSet,children,udid,clipboardAction,locale){
 const server=await startViewer(binary,deviceSet,children,clipboardAction);
 const page=server.base+'/simulators/'+encodeURIComponent(udid);await probe(page);
 server.clipboard.devices.add(udid);
 lastViewerSeen=Date.now();
 const url=server.clipboard.base+'/control?udid='+encodeURIComponent(udid)+'&lang='+(locale==='zh-CN'?'zh-CN':'en')+'#'+server.clipboard.fragment;
 return {url,ready:true,recentRestarts:server.crashes.length,lastExit:server.lastExit,note:'Live viewer ready with zoom and device shutdown controls. Simulator data is preserved. Devices are not shut down for idleness while a viewer window is open or another tool or script is operating them; otherwise idle shutdown follows plugin settings (15 minutes by default). close_viewer only stops streaming. Use shutdown when finished.'};
}
// The controller address for a device while the viewer already runs, without
// starting anything; null when it is not running.
function existingViewerUrl(udid,locale){
 if(!active||active.stopped||active.parked||!active.clipboard)return null;
 active.clipboard.devices.add(udid);
 return active.clipboard.base+'/control?udid='+encodeURIComponent(udid)+'&lang='+(locale==='zh-CN'?'zh-CN':'en')+'#'+active.clipboard.fragment;
}
module.exports={openViewer,stopViewer,abandonViewer,reapOrphans,recycleIfBloated,configureControls,viewing,VIEWER_GRACE_MS,forgetSession,hasSession,existingViewerUrl};
