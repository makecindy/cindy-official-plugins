'use strict';
const {execFile} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const {commandBudget} = require('./budget.cjs');
const {deviceId} = require('./device-id.cjs');
const {platform} = require('./control-model.js');
const {openViewer,stopViewer,configureControls}=require('./viewer.cjs');
const BINARY = path.join(__dirname, '../vendor/baguette/Baguette');
const ROOT = process.platform==='darwin'?path.join(os.homedir(), 'Library/Application Support/BaguetteCindy')
  :path.join(process.platform==='win32'?(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local')):(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share')),'BaguetteCindy');
const DEVICE_SET = path.join(ROOT, 'devices');
const children = new Set();
const methods = new Set(['environment','devices','create_device','rename_device','app_bundle','boot','shutdown','describe_ui','tap','viewer_screen','viewer_tap','viewer_trackpad','viewer_spatial','swipe','gesture','type_text','press','screenshot','install_app','launch_app','heal','open_viewer','close_viewer','delete_device','erase_device','reveal_screenshot',
  'import_media','wait_for','capture','set_state','logs','app_install','app_install_status','app_info','app_terminate','app_uninstall','open_url','resource_usage']);
// Agent operations that only read the device; they never change what is on screen.
const READ_ONLY = new Set(['describe_ui','screenshot','wait_for','logs','app_info','app_install_status','viewer_screen']);
class Failure extends Error {
  constructor(code, message, execution = 'not_executed') { super(message); this.code=code; this.execution=execution; }
}
let trackpadImpl;
let spatialImpl;
function spatial(){return spatialImpl||(spatialImpl=require('./spatial.cjs').createSpatial({binary:path.join(__dirname,'../native/spatial'),deviceSet:DEVICE_SET,children,Failure}));}
function trackpad(){return trackpadImpl||(trackpadImpl=require('./trackpad.cjs').createTrackpad({binary:path.join(__dirname,'../native/trackpad'),deviceSet:DEVICE_SET,children,Failure}));}
async function deviceViewer(device,locale){
 if(['tvOS','visionOS'].includes(platform(device))) {
  // Viewing still works if this Xcode lacks remote input. A later gesture
  // reports the input failure through the normal guarded API.
  try{const dev=(await run('/usr/bin/xcode-select',['-p'],{timeout:5000})).stdout;await (platform(device)==='tvOS'?trackpad():spatial()).prepare(device.udid,dev);}catch{}
 }
 return openViewer(BINARY,DEVICE_SET,children,device.udid,clipboardAction,locale);
}
function string(value,name,max=256) {
  if(typeof value!=='string'||!value.length||value.length>max||value.includes('\0')) throw new Failure('INVALID_ARGUMENT',`Invalid ${name}`);
  return value;
}
function deviceName(value){
  const name=string(value,'name',80).trim();
  if(!name||name.startsWith('-')||/[\x00-\x1f\x7f]/.test(name))throw new Failure('INVALID_ARGUMENT','Use a device name of 1–80 characters without control characters or a leading dash.');
  return name;
}
function number(value,name,min,max) {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max) throw new Failure('INVALID_ARGUMENT',`${name} must be ${min}..${max}`);
  return value;
}
function run(file,args,{timeout=30000,mutation=false,input,env,trimOutput=true,encoding='utf8',maxBuffer=4*1024*1024}={}) {
  return new Promise((resolve,reject)=>{
    // These bounded native adapters handle TERM by releasing their held input.
    // Other commands retain the existing hard timeout behavior.
    const releasesInput = ['remote','spatial'].some(name=>file===path.join(__dirname,'../native',name));
    const child=execFile(file,args,{timeout,maxBuffer,encoding,killSignal:releasesInput?'SIGTERM':'SIGKILL',shell:false,env},(err,stdout,stderr)=>{
      children.delete(child);
      stderr=String(stderr||'');
      if(err) return reject(new Failure('COMMAND_FAILED',`${path.basename(file)}: ${(stderr||err.message).slice(-5000)}`,mutation?'unknown':'not_executed'));
      resolve({stdout:trimOutput&&typeof stdout==='string'?stdout.trim():stdout,warnings:stderr.trim().slice(-3000)});
    });
    children.add(child);
    child.stdin.on('error',()=>{});
    child.stdin.end(input);
  });
}
async function sim(args, options) { return run('/usr/bin/xcrun',['simctl','--set',DEVICE_SET,...args],options); }
async function listDevices(deadline) {
  await fs.mkdir(DEVICE_SET,{recursive:true,mode:0o700});
  const data=await sim(['list','devices','--json'],commandBudget(5000,deadline));
  return Object.entries(JSON.parse(data.stdout).devices).flatMap(([runtime,devices])=>devices.map(d=>({name:d.name,udid:d.udid,state:d.state,isAvailable:d.isAvailable,runtime,deviceType:d.deviceTypeIdentifier})));
}
async function target(p, booted=true) {
  const udid=string(p.udid,'udid',36);
  if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(udid)) throw new Failure('INVALID_DEVICE','Use an exact UDID returned by this plugin');
  const device=(await listDevices(p._deadline)).find(d=>deviceId(d.udid)===deviceId(udid));
  if(!device) throw new Failure('DEVICE_NOT_OWNED','Device is not in the Baguette plugin device set. Create a dedicated device first.');
  if(booted&&device.state!=='Booted') throw new Failure('DEVICE_NOT_BOOTED','Boot this device first');
  return device;
}
function deviceArgs(device) {return ['--udid',device.udid,'--device-set',DEVICE_SET];}
// "iPhone 18 Pro", then "iPhone 18 Pro 2", "iPhone 18 Pro 3"… so devices stay tellable apart.
function uniqueName(name,taken){
  const used=new Set(taken.filter(n=>typeof n==='string').map(n=>n.toLowerCase()));
  if(!used.has(name.toLowerCase()))return name;
  for(let i=2;i<1000;i++){const next=`${name} ${i}`;if(!used.has(next.toLowerCase()))return next;}
  return `${name} ${Date.now()}`;
}
const desktopShots=new Set();
async function desktopFile(deviceLabel){
  const dir=path.join(os.homedir(),'Desktop');await fs.mkdir(dir,{recursive:true});
  const d=new Date(),pad=n=>String(n).padStart(2,'0');
  const stamp=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
  const base=`${deviceLabel.replace(/[\/:]/g,'-')} ${stamp}`;
  for(let i=1;i<100;i++){const file=path.join(dir,`${base}${i>1?` (${i})`:''}.png`);try{await fs.access(file);}catch{return file;}}
  throw new Failure('SCREENSHOT_NAME','Could not name the screenshot');
}
let agentImpl=null,appsImpl=null;
async function spatialAction(device,p,screen,deadline){
 const S=require('./spatial.cjs'),samples=S.plan(p,screen,Failure);
 const dev=(await run('/usr/bin/xcode-select',['-p'],commandBudget(5000,deadline))).stdout;
 await S.perform(spatial(),device.udid,samples,dev,deadline);
}
function agent(){return agentImpl||(agentImpl=require('./agent.cjs').createAgent({binary:BINARY,deviceSet:DEVICE_SET,root:ROOT,run,sim,Failure,spatialAction}));}
function apps(){return appsImpl||(appsImpl=require('./apps.cjs').createApps({sim,run,Failure}));}
const BUNDLE_ID=/^[A-Za-z0-9][A-Za-z0-9.-]+$/;
function bundleId(value){const id=string(value,'bundleId');if(!BUNDLE_ID.test(id))throw new Failure('INVALID_ARGUMENT','Invalid bundle identifier');return id;}
// `screenshot: true` on boot / launch: wait until the screen settles, then look,
// in the same call (one model round trip fewer). The image is hoisted for main.js.
async function settledShot(device,p,result){
  if(p.screenshot!==true)return result;
  // Stay inside the host's 120 s per call: the boot itself may have used most of it.
  // Past the black launch frame, until the screen stops moving (an animated menu after a few seconds).
  const deadline=p._deadline, left=deadline-Date.now();
  let settled=null;
  if(left>=2000){try{settled=await agent().settle(device,{timeout:Math.min(20000,left),deadline});}catch{}}
  try{const {_modelImages,...shot}=await agent().screenshot(device,{_inline:p._inline,_deadline:deadline});
    if(settled&&!settled.settled)shot.note=`${settled.blank?'The screen was still blank (loading) when this was taken; wait_for stable=1 and look again. ':settled.animated?'The screen keeps animating; this is its state after a few seconds. ':'The screen was still changing when this was taken. '}${shot.note}`;
    return {...result,screenshot:shot,...(_modelImages?{_modelImages}:{})};}
  catch(error){return {...result,screenshot:{error:error.message}};}
}
async function viewerFallback(device,p,result,error){
  // The existing viewer already reconnects its service. If it still cannot
  // open, use an independent capture; never touch the launched App process.
  const started=Date.now(),deadline=Math.min(p._deadline??Infinity,started+12000);
  const out={...result,outcome:'partial',viewer:{ready:false,previewOpened:false,error:error.message},
    nextAction:'Inspect the screenshot or retry viewer action=open. Do not repeat a confirmed App launch.'};
  try{const {_modelImages,...shot}=await agent().screenshot(device,{_inline:p._inline,_deadline:deadline});out.screenshot=shot;if(_modelImages)out._modelImages=_modelImages;}
  catch(e){out.screenshot={error:e.message};}
  return {...out,recovery:{kind:'independent-screenshot',observed:!!out.screenshot.path,elapsedMs:Date.now()-started}};
}
const keyboardBusy=new Set();
// Any key event makes iOS treat a hardware keyboard as attached and hide the on-screen one from then on.
// A touch-only phone shows it on focus, so forget the hardware keyboard once typing is over
// (iOS records it about 2 s late; clearing sooner would be overwritten).
const softTimers=new Map();
function softKeyboardBack(device){
  if(platform(device)!=='iOS')return;
  clearTimeout(softTimers.get(device.udid));
  const timer=setTimeout(()=>{softTimers.delete(device.udid);sim(['spawn',device.udid,'defaults','write','com.apple.keyboard.preferences','HardwareKeyboardLastSeen','-bool','false'],{timeout:10000}).catch(()=>{});},3000);
  timer.unref?.();softTimers.set(device.udid,timer);
}
async function nativeKey(device,code,modifiers=[],deadline) {
 await trackpadImpl?.cancel(device.udid);
 await spatialImpl?.cancel(device.udid);
 const [key,mask]=code?require('./keys.cjs').chord(code,modifiers):[0,0];
 const dev=process.env?.DEVELOPER_DIR || (await run('/usr/bin/xcode-select',['-p'],commandBudget(5000,deadline))).stdout;
 if(platform(device)==='tvOS')return run(path.join(__dirname,'../native/remote'),[DEVICE_SET,device.udid,dev,'key',String(key),String(mask),'0'],{mutation:true,...commandBudget(15000,deadline)});
 const options={mutation:true,...commandBudget(15000,deadline)};
 try { return await run(path.join(__dirname,'../native/keyboard'),[DEVICE_SET,device.udid,dev,String(key),String(mask)],options); }
 finally { softKeyboardBack(device); }
}
async function clipboardAction(p) {
 const key=deviceId(p.udid);
 if(keyboardBusy.has(key))throw new Failure('INPUT_BUSY','Another keyboard operation on this device is running; retry after it finishes');
 keyboardBusy.add(key);
 let inputCompleted=false;
 try{
  const device=await target(p);
  if(p.action==='release')return await nativeKey(device,null,[],p._deadline);
  if(p.action==='key')return await nativeKey(device,p.code,p.modifiers,p._deadline);
  if(p.action==='paste') {
    if(platform(device)==='tvOS')throw new Failure('UNSUPPORTED_INPUT','tvOS has no simulator pasteboard. Use type_text method=type for up to 300 US-keyboard characters, or keys.');
    const text=string(p.text,'text',8000);
    // First release any existing repeat before replacing its clipboard payload
    // (not for a touch paste: any key event hides the on-screen keyboard).
    if(!p.touch){await nativeKey(device,null,[],p._deadline);inputCompleted=true;}
    // CoreDevice (devicectl) cannot see a private device set, so write with
    // simctl --set. Xcode 27 pbcopy has been seen to exit 0 without changing the
    // guest clipboard: compare exact UTF-8 text (whitespace kept) before pasting.
    await sim(['pbcopy',device.udid],{input:text,mutation:true,...commandBudget(30000,p._deadline),env:{...process.env,LC_ALL:'en_US.UTF-8',LANG:'en_US.UTF-8'}});
    inputCompleted=true;
    let actual;
    try {
      actual=await sim(['pbpaste',device.udid],{trimOutput:false,...commandBudget(30000,p._deadline),env:{...process.env,LC_ALL:'en_US.UTF-8',LANG:'en_US.UTF-8'}});
    } catch {
      throw new Failure('CLIPBOARD_UNVERIFIED','Could not confirm guest clipboard contents; paste was not sent','unknown');
    }
    if(actual.stdout!==text)throw new Failure('CLIPBOARD_UNVERIFIED','Guest clipboard did not match requested text; paste was not sent','unknown');
    if(!p.touch)await nativeKey(device,'KeyV',['command'],p._deadline);
  } else if(p.action==='copy') {
    await nativeKey(device,'KeyC',['command'],p._deadline);
    inputCompleted=true;
    await new Promise(resolve=>setTimeout(resolve,250));
    await sim(['pbsync',device.udid,'host'],{mutation:true,...commandBudget(30000,p._deadline)});
  } else throw new Failure('INVALID_ARGUMENT','Unknown input action');
 }catch(error){if(inputCompleted&&error.execution==='not_executed')error.execution='unknown';throw error;}
 finally{keyboardBusy.delete(key);}
}
let androidImpl;
function android(){return androidImpl||(androidImpl=require('./android/index.cjs').createAndroid({root:ROOT,run,children}));}
const appleHost=process.platform==='darwin'&&process.arch==='arm64';
async function dispatch(method,p={},deadline=Date.now()+110000) {
  if (method === 'screenshot' && Number.isFinite(p._observationBudgetMs)) deadline=Math.min(deadline,Date.now()+Math.max(1,Math.min(12000,p._observationBudgetMs)));
  p={...p,_deadline:deadline,_startedAt:Date.now()};
  if(method.startsWith('android_setup_'))return android().dispatch(method,p);
  if(!methods.has(method))throw new Failure('UNKNOWN_TOOL','Unknown simulator operation');
  if(method==='environment'){
    const results=await Promise.allSettled([appleHost?appleDispatch(method,p,deadline):Promise.resolve(null),android().dispatch(method,p)]);
    const apple=results[0].status==='fulfilled'?results[0].value:null,other=results[1].status==='fulfilled'?results[1].value:null;
    return {...(apple||{}),platforms:{ios:apple?{ready:true}:{ready:false,message:results[0].reason?.message||'iOS requires an Apple Silicon Mac with Xcode.'},android:other||{ready:false,message:results[1].reason?.message}},
      runtimes:[...(apple?.runtimes||[]).map(r=>({...r,platform:'ios'})),...(other?.runtimes||[])],deviceTypes:[...(apple?.deviceTypes||[]).map(d=>({...d,platform:'ios'})),...(other?.deviceTypes||[])],note:'Choose an installed runtime and model from this catalog. Android setup is available in the plugin; iOS runtimes are installed through Xcode.'};
  }
  if(method==='devices'){
    const results=await Promise.allSettled([appleHost?appleDispatch('devices',p,deadline):Promise.resolve({devices:[]}),android().dispatch('devices',p)]);
    const errors=results.flatMap((r,i)=>r.status==='rejected'?[{platform:i?'android':'ios',code:r.reason.code,message:r.reason.message}]:[]);
    return {deviceSet:DEVICE_SET,devices:[...(results[0].status==='fulfilled'?results[0].value.devices.map(d=>({...d,platform:'ios'})):[]),...(results[1].status==='fulfilled'?results[1].value.devices:[])],...(errors.length?{platformErrors:errors}:{})};
  }
  if(method==='close_viewer'){await Promise.all([stopViewer(),android().viewer.close()]);return {execution:'executed'};}
  if(method==='reveal_screenshot'&&p.platform==='android')return android().dispatch(method,p);
  if((method==='create_device'&&p.runtime?.startsWith('android:'))||await android().owns(p.udid)){
    if(method==='boot'&&p.memoryMode!==undefined)throw new Failure('UNSUPPORTED_MEMORY_MODE','Memory modes are only supported for iOS simulators. Omit memoryMode for Android.');
    return android().dispatch(method,p);
  }
  return appleDispatch(method,p,deadline);
}
async function appleDispatch(method,p={},deadline=Date.now()+110000) {
  // Core owns the request deadline, including preflight. Nested observation
  // never starts another full budget after a slow boot, launch or input.
  p={...p,_deadline:deadline};
  // All foreground commands use this request's remaining time by construction.
  // The app install job deliberately uses the process runner outside this scope.
  const runCommand=(file,args,options={})=>run(file,args,{...options,...commandBudget(options.timeout??30000,deadline)});
  const simCommand=(args,options)=>runCommand('/usr/bin/xcrun',['simctl','--set',DEVICE_SET,...args],options);
  const bagCommand=async(command,device,args=[],options={})=>({udid:device.udid,execution:options.mutation?'executed':'not_applicable',...await runCommand(BINARY,[command,...deviceArgs(device),...args],options)});
  const jsonCommand=async(file,args)=>{const {stdout}=await runCommand(file,args);try{return JSON.parse(stdout);}catch{throw new Failure('INVALID_OUTPUT','Command did not return JSON');}};
  if(!methods.has(method)) throw new Failure('UNKNOWN_TOOL','Unknown Baguette operation');
  if(process.platform!=='darwin'||process.arch!=='arm64') throw new Failure('UNSUPPORTED_PLATFORM','This package requires an Apple Silicon Mac');
  // The native connection was bound to an owned, booted tvOS device on opening.
  // Further samples must match its live gesture; rediscovering the device with
  // simctl per sample destroys the continuous input cadence.
  if(method==='viewer_trackpad')p.udid=deviceId(p.udid);
  if(method==='viewer_trackpad'&&(p.phase!=='began'||trackpadImpl?.has(p.udid)))return trackpad().send(p.udid,p);
  if(method==='viewer_spatial')p.udid=deviceId(p.udid);
  if(method==='viewer_spatial'&&(p.phase!=='began'||spatialImpl?.has(p.udid)))return spatial().send(p.udid,p);
  const macOS=(await runCommand('/usr/bin/sw_vers',['-productVersion'],{timeout:3000})).stdout;
  if(!/^\d+\.\d+(?:\.\d+)?$/.test(macOS)||Number(macOS.split('.')[0])<15)throw new Failure('UNSUPPORTED_OS',`Requires macOS 15.0 or newer; detected ${macOS || 'unknown'}. Upgrade macOS before using this plugin.`);
  if(method==='environment') {
    const keyboardCheck = (async () => {
      let developerDir;
      try {
        developerDir = process.env?.DEVELOPER_DIR || (await runCommand('/usr/bin/xcode-select',['-p'],{timeout:5000})).stdout;
        const result = await jsonCommand(path.join(__dirname,'../native/keyboard'),['--check',developerDir]);
        if(result?.ready!==true || result.scope!=='keyboard-abi')throw new Failure('KEYBOARD_ABI_UNAVAILABLE','Keyboard interface check did not confirm compatibility.');
        return {...result,developerDir};
      } catch(error) {
        return {ready:false,scope:'keyboard-abi',developerDir,errorCode:error.code||'KEYBOARD_ABI_UNAVAILABLE',message:error.message};
      }
    })();
    const [version,xcode,runtimes,types]=await Promise.all([
      runCommand(BINARY,['--version']),runCommand('/usr/bin/xcodebuild',['-version']),
      jsonCommand('/usr/bin/xcrun',['simctl','list','runtimes','--json']),jsonCommand('/usr/bin/xcrun',['simctl','list','devicetypes','--json'])]);
    return {macOS,baguette:version.stdout,xcode:xcode.stdout,deviceSet:DEVICE_SET,diagnostics:{keyboard:await keyboardCheck},runtimes:runtimes.runtimes.filter(x=>x.isAvailable&&/\.SimRuntime\.(?:iOS|tvOS|xrOS)-/.test(x.identifier)).map(x=>({name:x.name,identifier:x.identifier,version:x.version,...(Array.isArray(x.supportedDeviceTypes)?{supportedDeviceTypes:x.supportedDeviceTypes.map(d=>d.identifier)}:{})})),deviceTypes:types.devicetypes.filter(x=>['iPhone','iPad','Apple TV','Apple Vision'].includes(x.productFamily)).map(x=>({name:x.name,identifier:x.identifier,productFamily:x.productFamily,minRuntimeVersion:x.minRuntimeVersionString,maxRuntimeVersion:x.maxRuntimeVersionString})),note:'Xcode 26/27 are supported; iPhone Duo requires Xcode 27.1 and iOS 27.1. diagnostics.keyboard checks interface availability only, not live input delivery or display-host ownership. A failed keyboard check does not invalidate the runtime catalog. Use dedicated devices, observe UI before acting, and verify actions afterwards.'};
  }
  if(method==='close_viewer') {await trackpadImpl?.stop();await spatialImpl?.stop();return {...await stopViewer(),execution:'executed',note:'Viewer server stopped; simulator and App remain running.'};}
  if(method==='devices') {
    let devices=await listDevices(deadline);
    if(p.includeMemoryModes) {
      const memory=require('./memory-mode.cjs').createMemoryModes({run:runCommand,sim:simCommand,Failure});
      devices=await Promise.all(devices.map(async device=>{
        if(device.state!=='Booted'||platform(device)!=='iOS')return device;
        try{return {...device,memoryMode:await memory.verify(device,1500)};}
        catch(error){return {...device,memoryMode:{mode:'unknown',verified:false,errorCode:error.code||'MEMORY_MODE_UNVERIFIED'}};}
      }));
    }
    return {deviceSet:DEVICE_SET,devices};
  }
  if(method==='create_device') {
    const name=deviceName(p.name), runtime=string(p.runtime,'runtime'), deviceType=string(p.deviceType,'deviceType');
    if(!/^com\.apple\.CoreSimulator\.SimRuntime\.(?:iOS|tvOS|xrOS)-[0-9-]+$/.test(runtime)||!/^com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9-]+$/.test(deviceType)) throw new Failure('INVALID_ARGUMENT','Use runtime and deviceType identifiers from environment');
    const installed=(await jsonCommand('/usr/bin/xcrun',['simctl','list','runtimes','--json'])).runtimes.find(r=>r.identifier===runtime&&r.isAvailable);
    if(!installed)throw new Failure('RUNTIME_UNAVAILABLE','Select an available installed iOS, tvOS or visionOS runtime.');
    if(Array.isArray(installed.supportedDeviceTypes)&&!installed.supportedDeviceTypes.some(d=>d.identifier===deviceType))throw new Failure('DEVICE_RUNTIME_MISMATCH','This runtime does not support the selected model. Refresh the model and OS options.');
    await fs.mkdir(DEVICE_SET,{recursive:true,mode:0o700});
    const unique=uniqueName(name,(await listDevices(deadline)).map(d=>d.name));
    const result=await simCommand(['create',unique,deviceType,runtime],{mutation:true});
    return {udid:result.stdout,name:unique,runtime,deviceSet:DEVICE_SET,execution:'executed'};
  }
  if(method==='app_install_status') return apps().status(p);
  if(method==='reveal_screenshot') {
    // Only a screenshot this worker just saved; never an arbitrary path.
    const file=string(p.path,'path',1024);
    if(!desktopShots.has(file))throw new Failure('INVALID_ARGUMENT','Unknown screenshot');
    await runCommand('/usr/bin/open',['-R',file],{timeout:10000});
    return {execution:'executed'};
  }
  const device=await target(p,!['boot','shutdown','rename_device','delete_device','erase_device','resource_usage'].includes(method));
  if(method==='resource_usage')return require('./resource-usage.cjs').cachedResourceUsage({refresh:p.refresh===true,device,directory:path.join(DEVICE_SET,device.udid),run:runCommand,deadline});
  if(['shutdown','erase_device','delete_device'].includes(method))await trackpadImpl?.stop(device.udid);
  if(['press','type_text','launch_app'].includes(method))await trackpadImpl?.cancel(device.udid);
  if(['shutdown','erase_device','delete_device'].includes(method))await spatialImpl?.stop(device.udid);
  if(['press','type_text','launch_app','tap','gesture'].includes(method))await spatialImpl?.cancel(device.udid);
  if(method==='viewer_spatial') {
    if(platform(device)!=='visionOS')throw new Failure('UNSUPPORTED_INPUT','Spatial input requires Vision Pro.');
    const dev=(await runCommand('/usr/bin/xcode-select',['-p'],{timeout:5000})).stdout;
    return spatial().send(device.udid,p,dev);
  }
  if(method==='viewer_trackpad') {
    if(platform(device)!=='tvOS')throw new Failure('UNSUPPORTED_INPUT','Remote trackpad is only available on Apple TV.');
    const dev=p.phase==='began'?(await runCommand('/usr/bin/xcode-select',['-p'],{timeout:5000})).stdout:null;
    return trackpad().send(device.udid,p,dev);
  }
  if(method==='delete_device'||method==='erase_device') {
    // simctl refuses to erase a booted device; delete would stop it mid-write.
    const action=method==='delete_device'?'delete':'erase';
    let stopped=false;
    try {
      if(device.state!=='Shutdown'){await bagCommand('shutdown',device,[],{timeout:60000,mutation:true});stopped=true;}
      await simCommand([action,device.udid],{timeout:120000,mutation:true});
    } catch(error) {
      if(stopped){
        const notStarted=error.execution==='not_executed';
        error.execution='unknown';
        error.message=`Shutdown completed; ${action} ${notStarted?'was not started':'is unconfirmed; inspect the device before retrying'}. ${error.message}`;
      }
      throw error;
    }
    return {udid:device.udid,execution:'executed'};
  }
  if(method==='rename_device') {
    const name=deviceName(p.name);
    await simCommand(['rename',device.udid,name],{mutation:true});
    return {udid:device.udid,name,execution:'executed'};
  }
  if(method==='app_bundle') {
    const bundleId=string(p.bundleId,'bundleId');
    if(!/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(bundleId))throw new Failure('INVALID_ARGUMENT','Invalid bundle identifier');
    const value=(await simCommand(['get_app_container',device.udid,bundleId,'app'],{timeout:10000})).stdout;
    const real=await fs.realpath(value),root=await fs.realpath(path.join(DEVICE_SET,device.udid,'data'));
    if(!real.endsWith('.app')||!(await fs.stat(real)).isDirectory())throw new Failure('INVALID_APP_PATH','Only this private simulator application bundle may be reused.');
    // System apps live in the runtime, outside the device data directory.
    // Never copy any host/runtime path; launch its bundle ID on the target.
    if(!real.startsWith(root+path.sep))return {bundleId,appPath:null};
    return {bundleId,appPath:real};
  }
  if(method==='open_viewer'){
    try{return {udid:device.udid,...await deviceViewer(device,p._locale),execution:'executed'};}
    catch(error){return viewerFallback(device,p,{udid:device.udid,execution:'unknown'},error);}
  }
  if(method==='boot') {
    const {createMemoryModes,validateMode}=require('./memory-mode.cjs');
    validateMode(p.memoryMode,Failure);
    const supportsMemory=/\.SimRuntime\.iOS-/.test(device.runtime);
    if(!supportsMemory&&p.memoryMode!==undefined)throw new Failure('UNSUPPORTED_MEMORY_MODE','Memory modes are only supported for iOS simulators.');
    const memory=supportsMemory?createMemoryModes({run:runCommand,sim:simCommand,Failure}):null;
    let memoryMode=memory?await memory.configure(device,p.memoryMode,async()=>{
      if((await target(p,false)).state!=='Shutdown')throw new Failure('DEVICE_TRANSITIONING','The device started elsewhere. Shut it down before changing memory mode.');
    }):undefined;
    try {
    // Upstream 0.1.98's automatic heal omits --set in its internal simctl calls.
    // Wait for this exact custom-set device ourselves; do not silently restart apps.
    const started=device.state==='Booted'?null:await bagCommand('boot',device,['--no-heal'],{timeout:15000,mutation:true});
    const ready=await simCommand(['bootstatus',device.udid,'-b'],{timeout:90000,mutation:true});
    // Baguette always warns about Simulator.app's lifetime setting; it does not apply to these headless devices.
    const warnings=(started?.warnings||ready.warnings||'').split('\n').filter(l=>l.trim()&&!/lifetime|^\[baguette\] Booted /.test(l)).join('\n');
    // A fresh device shows the slide-to-type introduction over the keyboard the first time it appears; it is not part of any App.
    if(started&&platform(device)==='iOS'){try{await simCommand(['spawn',device.udid,'defaults','write','com.apple.keyboard.preferences','DidShowContinuousPathIntroduction','-bool','true'],{timeout:10000,mutation:true});}catch{}}
    if(memory){
      try {const actual=await memory.verify(device);memoryMode={...actual,requested:memoryMode.mode,...(actual.mode!==memoryMode.mode?{warning:'Active overrides differ from the requested profile. Check the device before testing.'}:{})};}
      catch(error){memoryMode={...memoryMode,verified:false,warning:'Boot completed, but memory mode verification failed: '+error.message};}
    }
    return settledShot(device,p,{udid:device.udid,state:'Booted',execution:started?'executed':'not_executed',...(memoryMode?{memoryMode}:{}),...(warnings?{warnings}:{}),note:'Boot completed. If Device Hub has shadowed input, explicitly use heal (terminates running apps).'});
    } catch(error){
      if(memoryMode&&device.state==='Shutdown'){error.execution='unknown';error.message='Memory overrides were configured; inspect device state before continuing. '+error.message;}
      throw error;
    }
  }
  if(method==='shutdown') {
    if(device.state==='Shutdown') return {udid:device.udid,state:'Shutdown',execution:'not_executed'};
    return bagCommand('shutdown',device,[],{timeout:60000,mutation:true});
  }
  if(method==='describe_ui') return agent().describe(device,p);
  if(method==='viewer_screen') { const {screen}=await agent().geometry(device,{maxAge:0,deadline}); return {width:screen.width,height:screen.height}; }
  if(method==='tap') return agent().tap(device,p);
  if(method==='viewer_tap') {
    if(platform(device)!=='visionOS')throw new Failure('UNSUPPORTED_INPUT','Spatial selection is only available on Vision Pro.');
    const x=number(p.x,'x',0,1),y=number(p.y,'y',0,1);
    const {screen}=await agent().geometry(device,{maxAge:0,deadline});
    return agent().tap(device,{x:x*screen.width,y:y*screen.height,duration:p.duration,observe:'none',_deadline:deadline});
  }
  if(method==='gesture') return agent().gesture(device,p);
  if(method==='swipe') return agent().gesture(device,{kind:'swipe',from:[p.startX,p.startY],to:[p.endX,p.endY],duration:p.duration,observe:'none',_deadline:deadline});
  if(method==='wait_for') return agent().waitFor(device,p);
  if(method==='set_state') return agent().setState(device,p);
  if(method==='logs') return agent().logs(device,p);
  if(method==='capture') {
    // The action runs inside the capture, through the same operations as its own tool.
    const allowed=['tap','gesture','press','type_text','open_url','app_launch'];
    return agent().capture(device,p,async action=>{
      if(!action||!allowed.includes(action.tool))throw new Failure('INVALID_ARGUMENT',`capture action.tool must be one of ${allowed.join(', ')}`);
      const args={...(action.args||{}),udid:device.udid,observe:'none'};
      // Only the outer contact sheet uses the attachment channel. Nested
      // screenshots keep paths; private image bytes must not enter action JSON.
      return dispatch(action.tool==='app_launch'?'launch_app':action.tool,{...args,showViewer:false,_inline:false},p._deadline);
    });
  }
  if(method==='type_text') {
    if(p.text===undefined&&p.keys===undefined&&p.clear!==true)throw new Failure('INVALID_ARGUMENT','Pass text, keys or clear');
    const how=p.method??'auto';
    const tv=platform(device)==='tvOS';
    if(tv&&how==='paste')throw new Failure('UNSUPPORTED_INPUT','tvOS has no simulator pasteboard. Use auto/type with US-keyboard text, or keys.');
    if(!['auto','paste','type','touch'].includes(how))throw new Failure('INVALID_ARGUMENT','method must be auto, paste, type or touch');
    if(how==='touch'&&platform(device)!=='iOS')throw new Failure('UNSUPPORTED_INPUT','Touch edit-menu paste is only supported on iOS. Use method=paste or keys.');
    if(how==='touch'&&(p.clear===true||p.keys!==undefined))throw new Failure('INVALID_ARGUMENT','method=touch preserves the on-screen keyboard; omit clear and keys.');
    const {parseKey,typeable}=require('./keys.cjs');
    // Every key is checked before anything is sent.
    const rawKeys=p.keys===undefined?[]:Array.isArray(p.keys)?p.keys:[p.keys];
    if(rawKeys.length>40)throw new Failure('INVALID_ARGUMENT','At most 40 keys per call','not_executed');
    const keys=rawKeys.map(k=>{try{return parseKey(k);}catch(error){throw new Failure('INVALID_ARGUMENT',error.message);}});
    const text=p.text===undefined?undefined:string(p.text,'text (1–8000 characters)',8000);
    if(tv&&text!==undefined&&(!typeable(text)||text.length>300))throw new Failure('INVALID_ARGUMENT','tvOS supports at most 300 US-keyboard characters per call; Unicode paste is not supported. Use remote keys to interact with the on-screen input method.');
    if(how==='type'&&text!==undefined&&!typeable(text))throw new Failure('INVALID_ARGUMENT','method=type types US-keyboard characters only (letters, digits, punctuation, space, newline). Use paste for other text such as Chinese.');
    if(how==='type'&&text!==undefined&&text.length>300)throw new Failure('INVALID_ARGUMENT','method=type is limited to 300 characters per call (about 0.1 s each); split the text or use paste.');
    let inputStarted=false;
    const inputAction=async args=>{const result=await clipboardAction({udid:device.udid,...args,_deadline:p._deadline});inputStarted=true;return result;};
    try {
    if(p.clear===true){await inputAction({action:'key',code:'KeyA',modifiers:['command']});await inputAction({action:'key',code:'Backspace',modifiers:[]});}
    let used=null,typed=null;
    if(text!==undefined){
      // Paste is exact and works with any input method; games often ignore it, so they get keystrokes.
      used=how==='auto'?(tv?'type':platform(device)==='visionOS'?'paste':typeable(text)&&text.length<=300&&!(await agent().hasAccessibility(device,p._deadline))?'type':'paste'):how;
      if(used==='type'&&platform(device)==='tvOS'){
        const chords=Array.from(text,c=>{const k=parseKey(c==='\n'?'Enter':c==='\t'?'Tab':c===' '?'Space':c);return require('./keys.cjs').chord(k.code,k.modifiers);});
        const dev=(await runCommand('/usr/bin/xcode-select',['-p'],{timeout:5000})).stdout;
        await runCommand(path.join(__dirname,'../native/remote'),[DEVICE_SET,device.udid,dev,'keys',JSON.stringify(chords),'0','0'],{mutation:true,timeout:40000});
        inputStarted=true;typed={typed:text.length,inputSource:'US keyboard events sent; verify the focused field and input language.'};
      }else if(used==='type'){typed=await agent().typeText(device,text,p._deadline);inputStarted=true;}
      else if(used==='touch'){await inputAction({action:'paste',text,touch:true});typed=await agent().pasteByTouch(device,p._deadline);}
      else await inputAction({action:'paste',text});
    }
    for(const key of keys)await inputAction({action:'key',code:key.code,modifiers:key.modifiers});
    agentImpl?.forgetTree(device.udid);
    const keyEvents=keys.length||p.clear===true||(used&&used!=='touch');
    if(keyEvents)softKeyboardBack(device);
    const notes=['Input was delivered; observe the UI to confirm the result.'];
    if(used==='paste')notes.push('Text was pasted (Cmd+V). If the field stayed empty (some games ignore paste), retry with method=type.');
    if(used==='type')notes.push('Text was typed key by key; text fields may auto-capitalise or autocorrect it, as with a real keyboard.');
    if(used==='touch')notes.push('Pasted through the edit menu by touch; the on-screen keyboard stays as it was.');
    if(keyEvents&&platform(device)==='iOS')notes.push('Key events act like a hardware keyboard and hide the on-screen keyboard during input. About 3 seconds after the last input, the plugin attempts to clear that hardware-keyboard record; tap outside and refocus the field to check whether the keyboard returns. To check keyboard overlap without sending keys, use method=touch. Enter may submit a form or confirm a game screen; to only end editing, tap an empty area.');
    const typedResult={udid:device.udid,execution:'executed',...(used?{method:used}:{}),...(typed?.inputSource?{inputSource:typed.inputSource}:{}),...(keys.length?{keys:keys.map(k=>[...k.modifiers,k.code].join('+'))}:{}),note:notes.join(' ')};
    // Like tap: optionally wait for text and/or look at the result in the same call.
    return p.observe===undefined&&p.until===undefined?typedResult:await agent().after(device,{observe:p.observe??(p.until?undefined:'none'),settle:p.settle,until:p.until,_inline:p._inline,_deadline:p._deadline,_startedAt:p._startedAt},typedResult);
    } catch(error){if(inputStarted&&error.execution==='not_executed')error.execution='unknown';throw error;}
  }
  if(method==='press'&&p.button==='release-input') {
    await clipboardAction({udid:device.udid,action:'release',_deadline:p._deadline});
    return {udid:device.udid,execution:'executed',note:'Stuck keys released; nothing restarted.'};
  }
  if(method==='press'&&platform(device)==='tvOS') {
    const remote={up:82,down:81,left:80,right:79,select:40,back:41,menu:41};
    const buttons={home:64,'play-pause':205,'volume-up':233,'volume-down':234};
    const kind=Object.hasOwn(remote,p.button)?'key':Object.hasOwn(buttons,p.button)?'button':null;
    if(!kind)throw new Failure('INVALID_ARGUMENT','Apple TV buttons: up, down, left, right, select, back, menu, home, play-pause, volume-up, volume-down, release-input');
    const duration=p.duration===undefined?0:number(p.duration,'duration',0,10);
    const dev=(await runCommand('/usr/bin/xcode-select',['-p'],{timeout:5000})).stdout;
    await runCommand(path.join(__dirname,'../native/remote'),[DEVICE_SET,device.udid,dev,kind,String((kind==='key'?remote:buttons)[p.button]),'0',String(duration)],{mutation:true,timeout:20000});
    return {udid:device.udid,execution:'executed'};
  }
  if(method==='press') {
    if(platform(device)==='visionOS'&&p.button==='home')p={...p,button:'digital-crown'};
    const allowed=platform(device)==='visionOS'?['digital-crown']:['home','lock','power','volume-up','volume-down','action','app-switcher','swipe-to-app-switcher','swipe-to-home','pull-down-to-notification-center','pull-down-to-lock-screen'];
    if(!allowed.includes(p.button)) throw new Failure('INVALID_ARGUMENT',`button must be one of ${allowed.join(', ')} or release-input`);
    const args=['--button',p.button];
    if(p.duration!==undefined)args.push('--duration',String(number(p.duration,'duration',0,10)));
    const pressed=await bagCommand('press',device,args,{mutation:true});
    agent().forget(device.udid);
    return {udid:device.udid,execution:pressed.execution};
  }
  if(method==='screenshot'&&['desktop','clipboard'].includes(p.destination)) {
    // Export the same upright screen as the viewer, at the capture's native resolution.
    const shot=await agent().nativeScreenshot(device,deadline,p.orientation,p.destination==='clipboard');
    if(shot.copied) return {udid:device.udid,mimeType:'image/png',bytes:shot.bytes,execution:'executed',copied:true};
    try {
      const stat=await fs.stat(shot.path); if(!stat.size) throw new Failure('EMPTY_SCREENSHOT','No image produced');
      const result={udid:device.udid,mimeType:'image/png',bytes:stat.size};
      if(p.destination==='desktop') {
        const file=await desktopFile(device.name);
        commandBudget(15000,deadline);
        try { await fs.copyFile(shot.path,file); }
        catch(error) { throw new Failure('SCREENSHOT_EXPORT_FAILED',`Could not save the screenshot; check the Desktop before retrying: ${error.message}`,'unknown'); }
        desktopShots.add(file); if(desktopShots.size>50)desktopShots.delete(desktopShots.values().next().value);
        return {...result,execution:'executed',path:file,name:path.basename(file)};
      }
      await runCommand('/usr/bin/osascript',['-e','on run argv','-e','set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)','-e','end run',shot.path],{timeout:15000,mutation:true});
      return {...result,execution:'executed',copied:true};
    } finally { await fs.rm(shot.path,{force:true}).catch(()=>{}); }
  }
  if(method==='screenshot') return agent().screenshot(device,p);
  if(method==='app_info') return apps().info(device,p);
  if(method==='app_install') return apps().install(device,p,{terminate:id=>sim(['terminate',device.udid,id],{mutation:true})});
  if(method==='app_terminate') {
    const id=bundleId(p.bundleId);
    try{await simCommand(['terminate',device.udid,id],{mutation:true,timeout:15000});}
    catch(error){if(/not running|found nothing|No matching processes/i.test(error.message))return {udid:device.udid,bundleId:id,execution:'not_executed',note:'The App was not running.'};throw error;}
    return {udid:device.udid,bundleId:id,execution:'executed'};
  }
  if(method==='app_uninstall') {
    const id=bundleId(p.bundleId);
    if(apps().runningFor(device.udid))throw new Failure('INSTALL_RUNNING','An install is running on this device; wait for it first.');
    await simCommand(['uninstall',device.udid,id],{mutation:true,timeout:60000});
    return {udid:device.udid,bundleId:id,execution:'executed',note:'Uninstalled; the App and its data are gone from this device.'};
  }
  if(method==='open_url') {
    const url=string(p.url,'url',4096);
    if(!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url))throw new Failure('INVALID_ARGUMENT','url needs a scheme, e.g. myapp://path or https://…');
    await runCommand(BINARY,['openurl',...deviceArgs(device),url],{mutation:true,timeout:20000});
    agent().forget(device.udid);
    return {udid:device.udid,execution:'executed',note:'Opened. iOS may ask whether to open another App; take a screenshot and tap the system prompt if one appears.'};
  }
  if(method==='install_app') return apps().install(device,p,{terminate:id=>sim(['terminate',device.udid,id],{mutation:true})});
  if(method==='launch_app') {
    const id=bundleId(p.bundleId);
    if(apps().runningFor(device.udid))throw new Failure('INSTALL_RUNNING','An install is still running on this device. Wait with app action=install_status first.');
    const args=['launch'];
    if(p.relaunch!==false)args.push('--terminate-running-process');
    args.push(device.udid,id);
    if(p.arguments!==undefined){
      if(!Array.isArray(p.arguments)||p.arguments.length>50||!p.arguments.every(a=>typeof a==='string'&&a.length<=1000&&!a.includes('\0')))throw new Failure('INVALID_ARGUMENT','arguments must be up to 50 strings');
      args.push(...p.arguments);
    }
    const env={...process.env};
    if(p.env!==undefined){
      if(!p.env||typeof p.env!=='object'||Array.isArray(p.env)||Object.keys(p.env).length>30)throw new Failure('INVALID_ARGUMENT','env must be an object of up to 30 strings');
      for(const [k,v] of Object.entries(p.env)){if(!/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(k)||typeof v!=='string'||v.length>4000)throw new Failure('INVALID_ARGUMENT','env names must be identifiers and values strings');env['SIMCTL_CHILD_'+k]=v;}
    }
    agent().forget(device.udid);
    const launched={udid:device.udid,bundleId:id,...await simCommand(args,{mutation:true,env}),execution:'executed',appLaunched:true};
    if(p.showViewer===false)return settledShot(device,p,launched);
    let viewer;
    try{viewer={viewer:await deviceViewer(device,p._locale)};}
    catch(error){return viewerFallback(device,p,launched,error);}
    return settledShot(device,p,{...launched,...viewer});
  }
  if(method==='heal') {
    if(platform(device)!=='iOS')throw new Failure('UNSUPPORTED_INPUT','heal is only supported on iOS. Try press release-input for stuck keys.');
    // Baguette's documented repair sequence, scoped to our private device set.
    const jobs=await simCommand(['spawn',device.udid,'launchctl','list']);
    const pid=text=>text.split('\n').find(l=>l.trim().endsWith('com.apple.SpringBoard'))?.trim().split(/\s+/)[0];
    const before=pid(jobs.stdout);
    let restarted=false;
    try {
      await simCommand(['spawn',device.udid,'notifyutil','-s','com.apple.coredevice.dtuhidd.active','0'],{timeout:10000,mutation:true});
      restarted=true;
      await simCommand(['spawn',device.udid,'launchctl','kickstart','-k','system/com.apple.backboardd'],{timeout:10000,mutation:true});
      const pollingDeadline=Math.min(p._deadline,Date.now()+25000);
      while(Date.now()<pollingDeadline) {
        await new Promise(r=>setTimeout(r,Math.min(500,Math.max(0,pollingDeadline-Date.now()))));
        const now=pid((await simCommand(['spawn',device.udid,'launchctl','list'],{timeout:5000,mutation:true})).stdout);
        if(now&&/^\d+$/.test(now)&&now!==before) return {udid:device.udid,execution:'executed',note:'SpringBoard restarted. Observe UI before continuing.'};
      }
      throw new Failure('HEAL_TIMEOUT','Restart requested but SpringBoard readiness not confirmed','unknown');
    } catch(error){if(restarted&&error.execution==='not_executed')error.execution='unknown';throw error;}
  }
}
function reply(value){process.stdout.write(JSON.stringify(value)+'\n');}
function shutdown(){ for(const child of children) child.kill('SIGKILL'); process.exit(0); }
function startWorker() {
  if(appleHost)require('./viewer.cjs').reapOrphans(BINARY,DEVICE_SET);
  // In use = a viewer window is open, or another process names a running device.
  const inUse=async()=>{
    if(require('./viewer.cjs').viewing()||android().viewer.viewing())return true;
    if(appsImpl?.installing()||android().installing())return true;
    const running=(await dispatch('devices')).devices.filter(d=>d.state!=='Shutdown').map(d=>d.udid);
    return process.platform==='win32'?false:(await require('./activity.cjs').externalUse(running)).length>0;
  };
  const runtime=require('./runtime.cjs').createRuntime({dispatch,settingsFile:path.join(ROOT,'runtime-settings.json'),inUse,viewing:()=>require('./viewer.cjs').viewing()||android().viewer.viewing()||android().installing(),forgetViewer:()=>{require('./viewer.cjs').forgetSession(DEVICE_SET);android().viewer.forget();},
    pendingOperation:udid=>android().pending(udid)||appsImpl?.pending(udid),
    pendingJob:udid=>android().runningFor(udid)||appsImpl?.runningFor(udid),
    viewerWanted:()=>require('./viewer.cjs').hasSession(DEVICE_SET)||android().viewer.wanted(),
    tasks:require('./tasks.cjs').createTaskBindings(path.join(ROOT,'task-bindings.json')),
    existingViewerUrl:async(udid,locale)=>await android().owns(udid)?android().viewer.existing(udid,locale):require('./viewer.cjs').existingViewerUrl(udid,locale)});
  configureControls(runtime);
  android().configure(runtime);
  const timer=setInterval(()=>runtime.checkIdle().catch(error=>process.stderr.write('[baguette-idle] '+(error.code||'FAILED')+'\n')),15000);
  timer.unref();
  const recycle=setInterval(()=>require('./viewer.cjs').recycleIfBloated().catch(()=>{}),60000);
  recycle.unref();
  let stopping=false;
  const stop=async()=>{
    if(stopping)return;stopping=true;clearInterval(timer);clearInterval(recycle);
    await trackpadImpl?.stop();
    await spatialImpl?.stop();
    // Host may force termination before this completes. User-facing stop
    // controls await and verify shutdown instead of relying on process exit.
    require('./viewer.cjs').abandonViewer();
    try{await runtime.close();}catch{process.stderr.write('[baguette-exit] Device shutdown not confirmed\n');}
    shutdown();
  };
  const input=readline.createInterface({input:process.stdin});
  input.on('line',async line=>{
    let request;try{request=JSON.parse(line);}catch{return reply({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});}
    if(request.id===undefined)return;
      try {reply({jsonrpc:'2.0',id:request.id,result:{ok:true,...await runtime.request(request.method,request.params)}});}
      catch(e){reply({jsonrpc:'2.0',id:request.id,result:{ok:false,errorCode:e.code||'FAILED',message:e.message,execution:e.execution||'not_executed',...(e.busy?{busy:e.busy}:{})}});}
  });
  input.on('close',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
module.exports={dispatch,DEVICE_SET,BINARY,startWorker,uniqueName};
