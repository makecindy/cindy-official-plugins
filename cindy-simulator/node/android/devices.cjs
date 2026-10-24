'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {rpc}=require('./grpc.cjs');
const {commandBudget}=require('../budget.cjs');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fail=(code,message,execution='not_executed')=>Object.assign(Error(message),{code,execution});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MODELS=[
  {identifier:'android:phone',name:'Android Phone',platform:'android',width:1080,height:2400,density:420},
  {identifier:'android:tablet',name:'Android Tablet',platform:'android',width:1600,height:2560,density:320},
];
function ini(raw){return Object.fromEntries(raw.split(/\r?\n/).map(l=>/^\s*([^#;=]+?)\s*=\s*(.*?)\s*$/.exec(l)).filter(Boolean).map(m=>[m[1],m[2]]));}
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
// adb keeps its signing key in the user's Android directory. The emulator
// injects the key from ANDROID_EMULATOR_HOME, copying the adb key only when
// its own copy is missing, so a first boot on a fresh Mac must create the
// adb key first and later boots must not keep a stale private copy.
function adbKeyPath(env=process.env){
  if(env.ANDROID_USER_HOME)return path.join(env.ANDROID_USER_HOME,'adbkey');
  return path.join(env.ANDROID_SDK_HOME?path.join(env.ANDROID_SDK_HOME,'.android'):path.join(os.homedir(),'.android'),'adbkey');
}
function createDevices({root,sdk,run,children,spawn:launchProcess=spawn}){
  const avds=path.join(root,'avd'),processes=new Map();let hostGpuFailed=false;
  async function trustAdb(local){
    try{await run(local.adb,['start-server'],{timeout:15000});}catch{/* The boot loop reports adb failures. */}
    const user=await fs.readFile(adbKeyPath()).catch(()=>null);if(!user)return;
    const own=path.join(root,'adbkey');if((await fs.readFile(own).catch(()=>null))?.equals(user))return;
    const next=own+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(next,user,{mode:0o600,flag:'wx'});await fs.rename(next,own);}finally{await fs.rm(next,{force:true});}
  }
  // The emulator records the renderer it selected near the start of its log.
  async function renderer(d){
    let handle;try{handle=await fs.open(path.join(d.directory,'emulator.log'),'r');const {buffer,bytesRead}=await handle.read(Buffer.alloc(256*1024),0,256*1024,0);
      const mode=/gles_mode_selected:(\S+)/.exec(buffer.subarray(0,bytesRead).toString('utf8'))?.[1];return mode?(mode==='host'?'gpu':'software'):undefined;
    }catch{return undefined;}finally{await handle?.close();}
  }
  const file=id=>{if(!UUID.test(id))throw fail('INVALID_DEVICE','Use an exact device ID returned by this plugin.');return path.join(avds,id.toUpperCase()+'.json');};
  const discovery=[path.join(os.homedir(),'Library/Caches/TemporaryItems/avd/running'),path.join(process.env.XDG_RUNTIME_DIR||path.join(os.homedir(),'.cache'),'avd/running'),path.join(process.env.LOCALAPPDATA||os.tmpdir(),'Temp/avd/running'),path.join(os.tmpdir(),'avd/running')];
  async function metadata(id){try{
    const d=JSON.parse(await fs.readFile(file(id),'utf8')),avdName='cindy_'+id.toUpperCase().replace(/-/g,''),model=MODELS.find(m=>m.identifier===d.deviceType);
    if(d.udid!==id.toUpperCase()||d.avdName!==avdName||d.directory!==path.join(avds,avdName+'.avd')||!model)throw fail('DEVICE_METADATA_INVALID','The private Android device definition is damaged. Restore it before operating this device.');
    return {...d,model};
  }catch(e){if(e.code==='ENOENT')throw fail('DEVICE_NOT_OWNED','This Android device does not belong to the plugin.');throw e;}}
  async function endpoint(device){
    for(const directory of discovery){
      for(const name of await fs.readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){
        if(!/^pid_\d+(?:_info)?\.ini$/.test(name))continue;
        const info=ini(await fs.readFile(path.join(directory,name),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;}));
        if(info['avd.id']!==device.avdName||path.resolve(info['avd.dir']||'')!==path.resolve(device.directory))continue;
        const pid=Number(name.match(/\d+/)[0]);try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')continue;throw e;}
        const port=Number(info['grpc.port']),serial=Number(info['port.serial']);
        if(!Number.isInteger(port)||port<1024||port>65535||!Number.isInteger(serial)||serial<5554||serial>5682||!info['grpc.token'])throw fail('DEVICE_DISCOVERY_UNCONFIRMED','The running private Android device has an invalid connection record. Inspect its state before changing this device.');
        return {port,token:info['grpc.token'],serial:`emulator-${serial}`,pid};
      }
    }
    return null;
  }
  async function devices(){
    const local=await sdk.inspect(),out=[];
    for(const name of await fs.readdir(avds).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){
      if(!UUID.test(name.slice(0,-5))||!name.endsWith('.json'))continue;
      const d=await metadata(name.slice(0,-5)),ep=await endpoint(d);let state='Shutdown';
      if(ep){try{const {stdout}=await run(local.adb,['-s',ep.serial,'shell','getprop','sys.boot_completed'],{timeout:2000});state=stdout==='1'?'Booted':'Booting';}catch{state='Booting';}}
      else if(processes.get(d.udid)?.exitCode===null)state='Booting';
      const drawn=state==='Shutdown'?undefined:await renderer(d);
      out.push({udid:d.udid,name:d.name,state,platform:'android',runtime:d.runtime,deviceType:d.deviceType,isAvailable:local.images.some(i=>i.identifier===d.runtime)&&!!local.emulator&&!!local.adb,...(drawn?{renderer:drawn}:{})});
    }
    return out;
  }
  async function target(p,booted=true){
    const d=await metadata(p.udid),ep=await endpoint(d);
    if(booted&&!ep)throw fail('DEVICE_NOT_BOOTED','Start this Android device first.');
    return {...d,endpoint:ep};
  }
  async function adb(device,args,{deadline,mutation=false,timeout=30000,...options}={}){
    const ep=await endpoint(device);if(!ep)throw fail('DEVICE_NOT_BOOTED','Start this Android device first.');
    const local=await sdk.inspect();
    // ADB serials are ports and can be reused by Android Studio. Confirm the
    // exact private AVD before every command, including after worker restart.
    const named=await run(local.adb,['-s',ep.serial,'emu','avd','name'],commandBudget(4000,deadline));
    if(named.stdout.split(/\r?\n/)[0]!==device.avdName)throw fail('DEVICE_NOT_OWNED','The Android connection now belongs to another device. Refresh this plugin.');
    // adb shell joins its arguments into a remote shell command. Quote every
    // argument there even though the host itself always uses shell:false.
    const remote=args[0]==='shell'?['shell',...args.slice(1).map(v=>"'"+String(v).replace(/'/g,"'\\''")+"'")]:args;
    return run(local.adb,['-s',ep.serial,...remote],{...options,mutation,...commandBudget(timeout,deadline)});
  }
  async function create(p){
    const model=MODELS.find(m=>m.identifier===p.deviceType),local=await sdk.inspect(),image=local.images.find(i=>i.identifier===p.runtime);
    if(!local.ready)throw fail('ANDROID_SETUP_REQUIRED','Open the simulator setup page to install the Android environment.');
    if(!model||!image)throw fail('INVALID_ARGUMENT','Choose an Android model and runtime from environment.');
    if(typeof p.name!=='string'||!p.name.trim()||p.name.length>80||/[\x00-\x1f\x7f]/.test(p.name))throw fail('INVALID_ARGUMENT','Use a device name of 1–80 characters without control characters.');
    const udid=randomUUID().toUpperCase(),avdName='cindy_'+udid.replace(/-/g,''),directory=path.join(avds,avdName+'.avd');
    const taken=new Set((await devices()).map(d=>d.name.toLowerCase()));let name=p.name.trim();for(let n=2;taken.has(name.toLowerCase());n++)name=p.name.trim()+' '+n;
    const d={udid,name,platform:'android',runtime:p.runtime,deviceType:p.deviceType,avdName,directory,model};
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const config={AvdId:avdName,'avd.ini.encoding':'UTF-8','avd.ini.displayname':name,'image.sysdir.1':image.directory+path.sep,'abi.type':image.abi,'hw.cpu.arch':image.abi==='arm64-v8a'?'arm64':'x86_64','hw.cpu.ncore':4,'hw.ramSize':2048,
      'hw.lcd.width':model.width,'hw.lcd.height':model.height,'hw.lcd.density':model.density,'hw.gpu.enabled':'yes','hw.gpu.mode':'auto','hw.keyboard':'yes','hw.mainKeys':'no','hw.dPad':'no','hw.screen':'multi-touch','hw.battery':'yes','hw.gps':'yes','hw.accelerometer':'yes','hw.sensors.orientation':'yes','hw.camera.back':'none','hw.camera.front':'none','hw.audioInput':'no','disk.dataPartition.size':'6G','fastboot.forceColdBoot':'yes','showDeviceFrame':'no'};
    try{
      await fs.writeFile(path.join(directory,'config.ini'),Object.entries(config).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
      await fs.writeFile(path.join(avds,avdName+'.ini'),`avd.ini.encoding=UTF-8\npath=${directory}\ntarget=android-${image.version}\n`,{mode:0o600});
      await fs.writeFile(file(udid),JSON.stringify(d),{flag:'wx',mode:0o600});
    }catch(e){
      const cleanupErrors=[];
      for(const target of [directory,path.join(avds,avdName+'.ini'),file(udid)])try{await fs.rm(target,{recursive:true,force:true});}catch(error){cleanupErrors.push(error.message);}
      e.execution='unknown';e.message+=' Device '+udid+(cleanupErrors.length?' creation rollback was incomplete: '+cleanupErrors.join('; '):' creation failed after writing files; rollback completed. Inspect devices before retrying.');throw e;
    }
    return {udid,name,runtime:p.runtime,platform:'android',execution:'executed'};
  }
  async function boot(p){
    const d=await target(p,false),local=await sdk.inspect();let ep=d.endpoint;
    if(!local.ready)throw fail('ANDROID_SETUP_REQUIRED','Open simulator setup to install the Android environment.');
    let started=false,gpu=null;
    const launch=async mode=>{
      const port=await freePort(),logs=await fs.open(path.join(d.directory,'emulator.log'),'w',0o600);
      const env={...process.env,ANDROID_AVD_HOME:avds,ANDROID_EMULATOR_HOME:root,ANDROID_HOME:path.dirname(path.dirname(local.emulator)),ANDROID_SDK_ROOT:path.dirname(path.dirname(local.emulator))};
      // Headless `-gpu auto` selects SwiftShader/lavapipe, which renders on
      // about eleven CPU cores while the screen moves. Host GPU is the
      // default; `auto` remains the fallback when the host GPU cannot start.
      const child=launchProcess(local.emulator,['-avd',d.avdName,'-no-window','-gpu',mode,'-no-boot-anim','-no-snapshot','-no-audio','-grpc',String(port),'-grpc-use-token','-no-metrics','-camera-back','none','-camera-front','none'],{env,stdio:['ignore',logs.fd,logs.fd],windowsHide:true});
      children.add(child);processes.set(d.udid,child);started=true;gpu=mode;
      child.on('error',()=>{if(processes.get(d.udid)===child)processes.delete(d.udid);children.delete(child);});child.on('exit',()=>{if(processes.get(d.udid)===child)processes.delete(d.udid);children.delete(child);});
      try{await logs.close();}catch(e){e.execution='unknown';throw e;}
    };
    if(!ep&&!processes.has(d.udid)){
      await trustAdb(local);
      await launch(hostGpuFailed?'auto':'host');
    }
    const deadline=p._deadline??Date.now()+105000;
    while(Date.now()<deadline-1000){
      try{ep=await endpoint(d);}catch(e){if(started)e.execution='unknown';throw e;}
      if(ep){try{const r=await adb(d,['shell','getprop','sys.boot_completed'],{deadline,timeout:3000});if(r.stdout==='1')return {udid:d.udid,state:'Booted',platform:'android',execution:started?'executed':'not_executed',renderer:await renderer(d)};}catch{}}
      if(started&&!processes.has(d.udid)){
        // A host without a usable GPU exits during startup. Retry once with
        // the emulator's own choice and keep that choice for this worker.
        if(gpu==='host'){hostGpuFailed=true;await launch('auto');continue;}
        throw fail('ANDROID_BOOT_FAILED','Android Emulator stopped during startup. Check hardware virtualization and the device emulator.log; retry after correcting the environment.','unknown');
      }
      await sleep(500);
    }
    throw fail('ANDROID_BOOT_TIMEOUT','Android is still starting. Refresh devices before trying to start it again.','unknown');
  }
  async function shutdown(p){
    const d=await target(p,false);if(!d.endpoint){
      const child=processes.get(d.udid);
      if(!child)return {udid:d.udid,state:'Shutdown',execution:'not_executed'};
      // Only a child launched by this worker can be stopped before discovery.
      try{
      child.kill('SIGTERM');const until=Date.now()+5000;
      while(processes.has(d.udid)&&Date.now()<until)await sleep(100);
      if(processes.has(d.udid)){child.kill('SIGKILL');for(let i=0;i<20&&processes.has(d.udid);i++)await sleep(100);}
      if(processes.has(d.udid))throw fail('STOP_UNCONFIRMED','The starting emulator has not confirmed shutdown. Refresh devices.','unknown');
      return {udid:d.udid,state:'Shutdown',execution:'executed'};
      }catch(e){e.execution='unknown';throw e;}
    }
    try{await rpc(d.endpoint,'setVmState',{state:5},{deadline:Date.now()+10000});}catch{/* Shutdown closes its own connection; confirm below. */}
    const until=Date.now()+30000;while(Date.now()<until){try{if(!await endpoint(d))return {udid:d.udid,state:'Shutdown',execution:'executed'};}catch(e){e.execution='unknown';throw e;}await sleep(250);}
    throw fail('STOP_UNCONFIRMED','Android shutdown was requested but has not completed. Refresh device state.','unknown');
  }
  async function manage(method,p){
    const d=await target(p,false);
    if(method==='rename_device'){
      if(typeof p.name!=='string'||!p.name.trim()||p.name.length>80||/[\x00-\x1f\x7f]/.test(p.name))throw fail('INVALID_ARGUMENT','Use a device name of 1–80 characters.');
      const {endpoint:_,...saved}=d;saved.name=p.name.trim();try{await fs.writeFile(file(d.udid),JSON.stringify(saved),{mode:0o600});}catch(e){e.execution='unknown';throw e;}return {udid:d.udid,name:saved.name,execution:'executed'};
    }
    const completedSteps=[];let stopped=null,failedStep='shutdown',entry,writeStarted=false;
    try{
      stopped=await shutdown(p);completedSteps.push({step:'shutdown',execution:stopped.execution});
      if(method==='delete_device'){
        for(const [step,target] of [['remove-avd-directory',d.directory],['remove-avd-ini',path.join(avds,d.avdName+'.ini')],['remove-device-metadata',file(d.udid)]]){
          failedStep=step;writeStarted=true;await fs.rm(target,{recursive:true,force:true});completedSteps.push({step});
        }
      }else{
        // Retain the definition; remove only this private AVD's writable data.
        failedStep='list-avd-data';
        for(const name of (await fs.readdir(d.directory)).sort())if(name!=='config.ini'){
          failedStep='erase-entry';entry=name;writeStarted=true;await fs.rm(path.join(d.directory,name),{recursive:true,force:true});completedSteps.push({step:failedStep,entry});
        }
      }
      return {udid:d.udid,execution:'executed',completedSteps};
    }catch(e){
      return {udid:d.udid,outcome:'partial',execution:writeStarted||stopped?.execution==='executed'?'unknown':e.execution||'not_executed',completedSteps,failedStep,...(entry?{entry}:{}),...(stopped?{shutdown:stopped}:{}),deviceError:{code:e.code||'DEVICE_CHANGE_FAILED',message:e.message,execution:e.execution||'unknown'},nextAction:'Inspect this private device and the completed steps before continuing; do not blindly repeat deletion or erasure.'};
    }
  }
  return {devices,target,adb,create,boot,shutdown,manage,endpoint,owns:id=>UUID.test(id||'')?fs.access(file(id)).then(()=>true,()=>false):Promise.resolve(false),models:MODELS};
}
module.exports={createDevices,MODELS,ini};
