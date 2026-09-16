'use strict';
const {execFile} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const readline = require('node:readline');
const {openViewer,stopViewer}=require('./viewer.cjs');
const BINARY = path.join(__dirname, '../vendor/baguette-v0.1.98-macOS-arm64/Baguette');
const ROOT = path.join(os.homedir(), 'Library/Application Support/BaguetteCindy');
const DEVICE_SET = path.join(ROOT, 'devices');
const children = new Set();
const methods = new Set(['environment','devices','create_device','boot','shutdown','describe_ui','tap','swipe','type_text','press','screenshot','install_app','launch_app','heal','open_viewer','close_viewer']);
class Failure extends Error {
  constructor(code, message, execution = 'not_executed') { super(message); this.code=code; this.execution=execution; }
}
function string(value,name,max=256) {
  if(typeof value!=='string'||!value.length||value.length>max||value.includes('\0')) throw new Failure('INVALID_ARGUMENT',`Invalid ${name}`);
  return value;
}
function number(value,name,min,max) {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max) throw new Failure('INVALID_ARGUMENT',`${name} must be ${min}..${max}`);
  return value;
}
function run(file,args,{timeout=30000,mutation=false,input}={}) {
  return new Promise((resolve,reject)=>{
    const child=execFile(file,args,{timeout,maxBuffer:4*1024*1024,encoding:'utf8',killSignal:'SIGKILL',shell:false},(err,stdout,stderr)=>{
      children.delete(child);
      if(err) return reject(new Failure('COMMAND_FAILED',`${path.basename(file)}: ${(stderr||err.message).slice(-5000)}`,mutation?'unknown':'not_executed'));
      resolve({stdout:stdout.trim(),warnings:stderr.trim().slice(-3000)});
    });
    children.add(child);
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
  });
}
async function sim(args, options) { return run('/usr/bin/xcrun',['simctl','--set',DEVICE_SET,...args],options); }
async function jsonRun(file,args) { const {stdout}=await run(file,args); try{return JSON.parse(stdout);}catch{throw new Failure('INVALID_OUTPUT','Command did not return JSON');} }
async function listDevices() {
  await fs.mkdir(DEVICE_SET,{recursive:true,mode:0o700});
  const data=await sim(['list','devices','--json']);
  return Object.entries(JSON.parse(data.stdout).devices).flatMap(([runtime,devices])=>devices.map(d=>({name:d.name,udid:d.udid,state:d.state,isAvailable:d.isAvailable,runtime})));
}
async function target(p, booted=true) {
  const udid=string(p.udid,'udid',36);
  if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(udid)) throw new Failure('INVALID_DEVICE','Use an exact UDID returned by this plugin');
  const device=(await listDevices()).find(d=>d.udid.toLowerCase()===udid.toLowerCase());
  if(!device) throw new Failure('DEVICE_NOT_OWNED','Device is not in the Baguette plugin device set. Create a dedicated device first.');
  if(booted&&device.state!=='Booted') throw new Failure('DEVICE_NOT_BOOTED','Boot this device first');
  return device;
}
function deviceArgs(device) {return ['--udid',device.udid,'--device-set',DEVICE_SET];}
async function baguette(command,device,args=[],options={}) {
  const result=await run(BINARY,[command,...deviceArgs(device),...args],options);
  return {udid:device.udid,execution:options.mutation?'executed':'not_applicable',...result};
}
let keyboardBusy=false;
async function nativeKey(device,code,modifiers=[]) {
 const [key,mask]=code?require('./keys.cjs').chord(code,modifiers):[0,0];
 const dev=(await run('/usr/bin/xcode-select',['-p'])).stdout;
 return run(path.join(__dirname,'../native/keyboard'),[DEVICE_SET,device.udid,dev,String(key),String(mask)],{mutation:true,timeout:15000});
}
async function clipboardAction(p) {
 if(keyboardBusy)throw new Failure('INPUT_BUSY','Another keyboard operation is running; retry after it finishes');
 keyboardBusy=true;
 try{
  const device=await target(p);
  if(p.action==='release')return await nativeKey(device,null);
  if(p.action==='key')return await nativeKey(device,p.code,p.modifiers);
  if(p.action==='paste') {
    // First release any existing repeat before replacing its clipboard payload.
    await nativeKey(device,null);
    await sim(['pbcopy',device.udid],{input:string(p.text,'text',8000),mutation:true});
    await nativeKey(device,'KeyV',['command']);
  } else if(p.action==='copy') {
    await nativeKey(device,'KeyC',['command']);
    await new Promise(resolve=>setTimeout(resolve,250));
    await sim(['pbsync',device.udid,'host'],{mutation:true});
  } else throw new Failure('INVALID_ARGUMENT','Unknown input action');
 }finally{keyboardBusy=false;}
}
async function dispatch(method,p={}) {
  if(!methods.has(method)) throw new Failure('UNKNOWN_TOOL','Unknown Baguette operation');
  if(process.platform!=='darwin'||process.arch!=='arm64') throw new Failure('UNSUPPORTED_PLATFORM','This package requires an Apple Silicon Mac');
  if(method==='environment') {
    const [version,xcode,runtimes,types]=await Promise.all([
      run(BINARY,['--version']),run('/usr/bin/xcodebuild',['-version']),
      jsonRun('/usr/bin/xcrun',['simctl','list','runtimes','--json']),jsonRun('/usr/bin/xcrun',['simctl','list','devicetypes','--json'])]);
    return {baguette:version.stdout,xcode:xcode.stdout,deviceSet:DEVICE_SET,runtimes:runtimes.runtimes.filter(x=>x.isAvailable&&x.identifier.includes('.iOS-')).map(x=>({name:x.name,identifier:x.identifier,version:x.version})),deviceTypes:types.devicetypes.filter(x=>x.productFamily==='iPhone'||x.productFamily==='iPad').map(x=>({name:x.name,identifier:x.identifier})),note:'Baguette 0.1.98 includes Xcode 27 / iOS 27 compatibility fixes. Use dedicated devices, observe UI before acting, and verify actions afterwards.'};
  }
  if(method==='close_viewer') return {...await stopViewer(),execution:'executed',note:'Viewer server stopped; simulator and App remain running.'};
  if(method==='devices') return {deviceSet:DEVICE_SET,devices:await listDevices()};
  if(method==='create_device') {
    const name=string(p.name,'name',80), runtime=string(p.runtime,'runtime'), deviceType=string(p.deviceType,'deviceType');
    if(!/^com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+$/.test(runtime)||!/^com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9-]+$/.test(deviceType)) throw new Failure('INVALID_ARGUMENT','Use runtime and deviceType identifiers from environment');
    await fs.mkdir(DEVICE_SET,{recursive:true,mode:0o700});
    const result=await sim(['create',name,deviceType,runtime],{mutation:true});
    return {udid:result.stdout,name,runtime,deviceSet:DEVICE_SET,execution:'executed'};
  }
  const device=await target(p,!['boot','shutdown'].includes(method));
  if(method==='open_viewer') return {udid:device.udid,...await openViewer(BINARY,DEVICE_SET,children,device.udid,clipboardAction,p._locale),execution:'executed'};
  if(method==='boot') {
    // Upstream 0.1.98's automatic heal omits --set in its internal simctl calls.
    // Wait for this exact custom-set device ourselves; do not silently restart apps.
    const started=device.state==='Booted'?null:await baguette('boot',device,['--no-heal'],{timeout:15000,mutation:true});
    const ready=await sim(['bootstatus',device.udid,'-b'],{timeout:90000,mutation:true});
    return {udid:device.udid,state:'Booted',execution:started?'executed':'not_executed',warnings:started?.warnings||ready.warnings,note:'Boot completed. If Device Hub has shadowed input, explicitly use heal (terminates running apps).'};
  }
  if(method==='shutdown') {
    if(device.state==='Shutdown') return {udid:device.udid,state:'Shutdown',execution:'not_executed'};
    return baguette('shutdown',device,[],{timeout:60000,mutation:true});
  }
  if(method==='describe_ui') {
    const result=await baguette('describe-ui',device);
    let tree;
    try { tree=JSON.parse(result.stdout); }
    catch {throw new Failure('INVALID_OUTPUT','Accessibility output was not JSON');}
    const pending=[tree]; let observed=false;
    while(pending.length) {
      const node=pending.pop();
      if(Array.isArray(node)) {pending.push(...node);continue;}
      if(!node||typeof node!=='object')continue;
      if(typeof node.role==='string'&&node.role.trim()&&node.role!=='AXUnknown'&&node.hidden!==true) {observed=true;break;}
      if(Array.isArray(node.children))pending.push(...node.children);
    }
    if(!observed)throw new Failure('EMPTY_UI','No observable accessibility nodes. Take a screenshot, confirm the App is visible and retry describe_ui before acting.');
    const encoded=JSON.stringify(tree);
    if(encoded.length>180000)return {...result,stdout:undefined,treePreview:encoded.slice(0,180000),truncated:true};
    return {...result,stdout:undefined,tree};
  }
  if(method==='tap'||method==='swipe') {
    const width=number(p.width,'width',1,4000),height=number(p.height,'height',1,4000);
    const args=['--width',String(width),'--height',String(height)];
    const coordinates=method==='tap'?[['x','x',width],['y','y',height]]:[['startX','start-x',width],['startY','start-y',height],['endX','end-x',width],['endY','end-y',height]];
    for(const [key,flag,max] of coordinates) args.push('--'+flag,String(number(p[key],key,0,max)));
    if(p.duration!==undefined) args.push('--duration',String(number(p.duration,'duration',0.02,5)));
    return baguette(method,device,args,{mutation:true});
  }
  if(method==='type_text'||(method==='press'&&p.button==='release-input')) {
    await clipboardAction({udid:device.udid,action:method==='type_text'?'paste':'release',text:p.text});
    return {udid:device.udid,execution:'executed',note:'Keyboard events acknowledged by the simulator input transport; observe the UI to confirm the result.'};
  }
  if(method==='press') {
    const allowed=['home','lock','app-switcher','swipe-to-home','pull-down-to-notification-center'];
    if(!allowed.includes(p.button)) throw new Failure('INVALID_ARGUMENT','Unsupported button');
    return baguette('press',device,['--button',p.button],{mutation:true});
  }
  if(method==='screenshot') {
    const dir=path.join(ROOT,'screenshots');await fs.mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,crypto.randomUUID()+'.jpg');
    const result=await baguette('screenshot',device,['--format','jpg','--quality','0.8','--output',file]);
    const stat=await fs.stat(file); if(!stat.size) throw new Failure('EMPTY_SCREENSHOT','No image produced');
    return {...result,path:file,mimeType:'image/jpeg',bytes:stat.size,note:'Open this local image with your image-view tool. Coordinates for input are device points, not screenshot pixels.'};
  }
  if(method==='install_app') {
    const app=string(p.appPath,'appPath',4096);
    if(!path.isAbsolute(app)||!app.endsWith('.app')) throw new Failure('INVALID_ARGUMENT','appPath must be an absolute simulator .app bundle path');
    const real=await fs.realpath(app);if(!(await fs.stat(real)).isDirectory()) throw new Failure('INVALID_ARGUMENT','App bundle must be a directory');
    return {udid:device.udid,...await sim(['install',device.udid,real],{timeout:90000,mutation:true}),execution:'executed'};
  }
  if(method==='launch_app') {
    const bundleId=string(p.bundleId,'bundleId');if(!/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(bundleId)) throw new Failure('INVALID_ARGUMENT','Invalid bundle identifier');
    const launched={udid:device.udid,...await sim(['launch',device.udid,bundleId],{mutation:true}),execution:'executed'};
    if(p.showViewer===false)return launched;
    try{return {...launched,viewer:await openViewer(BINARY,DEVICE_SET,children,device.udid,clipboardAction,p._locale)};}
    catch(error){return {...launched,viewer:{previewOpened:false,error:error.message},note:'App launched, but viewer failed. Retry open_viewer, not launch_app.'};}
  }
  if(method==='heal') {
    // Baguette's documented repair sequence, scoped to our private device set.
    const jobs=await sim(['spawn',device.udid,'launchctl','list']);
    const pid=text=>text.split('\n').find(l=>l.trim().endsWith('com.apple.SpringBoard'))?.trim().split(/\s+/)[0];
    const before=pid(jobs.stdout);
    await sim(['spawn',device.udid,'notifyutil','-s','com.apple.coredevice.dtuhidd.active','0'],{timeout:10000,mutation:true});
    await sim(['spawn',device.udid,'launchctl','kickstart','-k','system/com.apple.backboardd'],{timeout:10000,mutation:true});
    const deadline=Date.now()+25000;
    while(Date.now()<deadline) {
      await new Promise(r=>setTimeout(r,500));
      const now=pid((await sim(['spawn',device.udid,'launchctl','list'],{timeout:5000,mutation:true})).stdout);
      if(now&&/^\d+$/.test(now)&&now!==before) return {udid:device.udid,execution:'executed',note:'SpringBoard restarted. Observe UI before continuing.'};
    }
    throw new Failure('HEAL_TIMEOUT','Restart requested but SpringBoard readiness not confirmed','unknown');
  }
}
function reply(value){process.stdout.write(JSON.stringify(value)+'\n');}
function shutdown(){ for(const child of children) child.kill('SIGKILL'); process.exit(0); }
function startWorker() {
  // Reject overlapping requests: do not execute a queued mutation after its caller times out.
  let queue=Promise.resolve();let pending=0;
  const input=readline.createInterface({input:process.stdin});
  input.on('line',line=>{
    let request;try{request=JSON.parse(line);}catch{return reply({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});}
    if(request.id===undefined)return;
    if(pending>=1)return reply({jsonrpc:'2.0',id:request.id,result:{ok:false,errorCode:'BUSY',message:'Another simulator operation is running; retry after it finishes',execution:'not_executed'}});
    pending++;
    queue=queue.then(async()=>{
      try {reply({jsonrpc:'2.0',id:request.id,result:{ok:true,...await dispatch(request.method,request.params)}});}
      catch(e){reply({jsonrpc:'2.0',id:request.id,result:{ok:false,errorCode:e.code||'FAILED',message:e.message,execution:e.execution||'not_executed'}});}
      finally{pending--;}
    });
  });
  input.on('close',shutdown);process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
module.exports={dispatch,DEVICE_SET,BINARY,startWorker};
