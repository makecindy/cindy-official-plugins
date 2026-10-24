'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {createReadStream}=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const {zip}=require('../../vendor/android/deps.cjs');
const fail=(code,message,execution='not_executed')=>Object.assign(Error(message),{code,execution});
const packageId=value=>{if(typeof value!=='string'||!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(value))throw fail('INVALID_ARGUMENT','Use an Android package ID, such as com.example.app.');return value;};
async function fingerprint(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
// Read only the manifest's root attributes from Android's binary XML. No XML
// code, resource references or executable content is evaluated on the host.
function manifest(buffer){
  if(buffer.length<8||buffer.readUInt16LE(0)!==3)throw fail('INVALID_APK','APK manifest is not Android binary XML.');
  let strings=[],chunkStart=0,chunkEnd=buffer.length;
  const span=(offset,size)=>{if(!Number.isSafeInteger(offset)||offset<chunkStart||size<0||offset+size>chunkEnd)throw fail('INVALID_APK','APK manifest is truncated.');};
  for(let off=8;off<buffer.length;){
    chunkStart=off;chunkEnd=buffer.length;
    span(off,8);const type=buffer.readUInt16LE(off),header=buffer.readUInt16LE(off+2),size=buffer.readUInt32LE(off+4);if(size<header||size<8)throw fail('INVALID_APK','Invalid APK manifest chunk.');span(off,size);
    chunkEnd=off+size;
    if(type===1){
      span(off,28);const count=buffer.readUInt32LE(off+8),flags=buffer.readUInt32LE(off+16),start=off+buffer.readUInt32LE(off+20);if(count>50000)throw fail('INVALID_APK','APK manifest string table is too large.');span(off+header,count*4);
      strings=Array.from({length:count},(_,i)=>{let p=start+buffer.readUInt32LE(off+header+i*4);const len8=()=>{span(p,1);let n=buffer[p++];if(n&128){span(p,1);n=((n&127)<<8)|buffer[p++];}return n;};
        if(flags&256){len8();const n=len8();span(p,n);return buffer.toString('utf8',p,p+n);}
        span(p,2);let n=buffer.readUInt16LE(p);p+=2;if(n&32768){span(p,2);n=((n&32767)*65536)+buffer.readUInt16LE(p);p+=2;}span(p,n*2);return buffer.toString('utf16le',p,p+n*2);});
    }else if(type===0x102){
      span(off,36);if(strings[buffer.readUInt32LE(off+20)]==='manifest'){
        const start=off+16+buffer.readUInt16LE(off+24),step=buffer.readUInt16LE(off+26),count=buffer.readUInt16LE(off+28),attrs={};
        if(step<20||count>500)throw fail('INVALID_APK','Invalid APK manifest attributes.');span(start,step*count);
        for(let i=0;i<count;i++){const p=start+i*step,key=strings[buffer.readUInt32LE(p+4)],raw=buffer.readUInt32LE(p+8),kind=buffer[p+15],value=buffer.readUInt32LE(p+16);attrs[key]=raw!==0xffffffff?strings[raw]:kind===3?strings[value]:value;}
        return {bundleId:packageId(attrs.package),versionName:attrs.versionName,versionCode:attrs.versionCode};
      }
    }
    off+=size;
  }
  throw fail('INVALID_APK','The APK has no package manifest.');
}
async function inspect(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||!file.toLowerCase().endsWith('.apk'))throw fail('INVALID_APP_PATH','Android installs require an absolute path to a built .apk file.');
  const real=await fs.realpath(file),stat=await fs.stat(real);if(!stat.isFile()||stat.size>4e9)throw fail('INVALID_APP_PATH','Select an APK file smaller than 4 GB.');
  const archive=await new Promise((r,j)=>zip.open(real,{lazyEntries:true},(e,z)=>e?j(e):r(z)));
  const bytes=await new Promise((resolve,reject)=>{
    let found=false;archive.on('error',reject);archive.on('end',()=>{if(!found)reject(fail('INVALID_APK','The APK has no AndroidManifest.xml.'));});
    archive.on('entry',entry=>{if(entry.fileName!=='AndroidManifest.xml'){archive.readEntry();return;}found=true;
      if(entry.uncompressedSize>4e6){archive.close();reject(fail('INVALID_APK','APK manifest is too large.'));return;}
      archive.openReadStream(entry,async(e,stream)=>{if(e){archive.close();reject(e);return;}try{const chunks=[];for await(const chunk of stream)chunks.push(chunk);resolve(Buffer.concat(chunks));}catch(e){reject(e);}finally{archive.close();}});
    });archive.readEntry();
  });
  return {appPath:real,...manifest(bytes),fingerprint:await fingerprint(real)};
}
function createApps({root,devices}){
  const jobs=new Map(),pending=new Map();
  async function wait(job,p,seconds){
    const left=p._deadline===undefined?90000:Math.max(0,p._deadline-Date.now()-1000);
    const ms=Math.min(left,Math.max(0,Math.min(Number(p.wait??seconds)||0,90))*1000);let timer;
    try{await Promise.race([pending.get(job.udid),new Promise(resolve=>{timer=setTimeout(resolve,ms);})]);}finally{clearTimeout(timer);}
    return {...job,elapsedSeconds:Math.round(((job.finishedAt||Date.now())-job.startedAt)/1000)};
  }
  async function info(d,p){
    const local=p.appPath?await inspect(p.appPath):null,id=packageId(p.bundleId||local?.bundleId);
    const dump=(await devices.adb(d,['shell','dumpsys','package',id],{deadline:p._deadline})).stdout;
    const installed=/versionCode=/.test(dump),versionCode=dump.match(/versionCode=(\d+)/)?.[1],versionName=dump.match(/versionName=(.+)/)?.[1];
    let hash=null,comparisonError;
    if(!installed&&!/Unable to find package|Unknown package|not found/i.test(dump))throw fail('APP_QUERY_FAILED','Android did not confirm whether the package is installed. Do not reinstall based on this result.');
    if(installed)try{
      const paths=(await devices.adb(d,['shell','pm','path',id],{deadline:p._deadline})).stdout.split('\n').filter(l=>l.startsWith('package:')).map(l=>l.slice(8));
      if(paths.length!==1)throw fail('COMPARISON_UNAVAILABLE','Content comparison requires a single installed APK.');
      const sum=(await devices.adb(d,['shell','sha256sum',paths[0]],{deadline:p._deadline})).stdout;hash=sum.match(/^[a-f0-9]{64}/)?.[0]||null;
      if(!hash)throw fail('COMPARISON_UNAVAILABLE','Android returned no APK content fingerprint.');
    }catch(e){comparisonError={code:e.code||'COMPARISON_FAILED',message:e.message};}
    return {udid:d.udid,bundleId:id,installed,versionName,versionCode,fingerprint:hash,verification:comparisonError?'unconfirmed':'confirmed',...(comparisonError?{comparisonError}:{}),...(local?{matchesLocal:hash===local.fingerprint,local}:{})};
  }
  async function install(d,p){
    if(pending.has(d.udid))throw fail('INSTALL_RUNNING','An APK install is already running on this device.');
    if(typeof p.appPath!=='string'||!path.isAbsolute(p.appPath)||!p.appPath.toLowerCase().endsWith('.apk'))throw fail('INVALID_APP_PATH','Android installs require the absolute path to a built .apk file.');
    if(p.mode!==undefined&&!['auto','full'].includes(p.mode))throw fail('INVALID_ARGUMENT','Install mode must be auto or full.');
    const id=randomUUID(),job={job:id,udid:d.udid,state:'running',mode:'checking',execution:'not_executed',startedAt:Date.now()};jobs.set(id,job);
    const work=(async()=>{
      try{
        const local=await inspect(p.appPath),before=await info(d,{bundleId:local.bundleId});Object.assign(job,{bundleId:local.bundleId});
        if(before.comparisonError&&p.mode!=='full')throw fail('COMPARISON_UNAVAILABLE',before.comparisonError.message+' Inspect app info before choosing a full install.');
        if(before.fingerprint===local.fingerprint&&p.mode!=='full'){Object.assign(job,{state:'done',mode:'unchanged',modeReason:'APK content matches the installed build.',execution:'not_executed'});return;}
        job.mode='installing';job.modeReason=p.mode==='full'?'Full install explicitly requested.':before.installed?'APK content changed; Android uses full installation.':'Package is not installed.';job.execution='unknown';
        // ADB owns endpoint/identity preflight and command execution. Only this
        // install error can establish that the write did not start; a later
        // read failure cannot erase evidence of the completed install command.
        const result=await devices.adb(d,['install','--no-incremental','-r','-t',local.appPath],{timeout:300000,mutation:true}).catch(e=>{job.execution=e.execution||'unknown';throw e;});
        if(!/\bSuccess\b/.test(result.stdout))throw fail('INSTALL_FAILED','Android did not confirm APK installation. Check signing compatibility and available storage.','unknown');
        const actual=await info(d,{bundleId:local.bundleId});if(actual.fingerprint!==local.fingerprint)throw fail('INSTALL_UNVERIFIED','APK installation completed but its content could not be verified. Inspect app info before retrying.','unknown');
        Object.assign(job,{state:'done',mode:'full',execution:'executed',versionName:actual.versionName});
      }catch(e){Object.assign(job,{state:'failed',errorCode:e.code||'INSTALL_FAILED',message:e.message});}
      finally{job.finishedAt=Date.now();pending.delete(d.udid);}
    })();pending.set(d.udid,work);return wait(job,p,80);
  }
  function status(p){const j=jobs.get(p.job);if(!j||j.udid!==p.udid)throw fail('INSTALL_JOB_UNKNOWN','Unknown APK install job. Inspect app info before starting another install.');return wait(j,p,85);}
  async function launch(d,p){
    const id=packageId(p.bundleId);if(p.arguments?.length||p.env&&Object.keys(p.env).length)throw fail('INVALID_ARGUMENT','Android launches its launcher Activity. Process arguments and environment variables apply to iOS only.');
    const resolved=(await devices.adb(d,['shell','cmd','package','resolve-activity','--brief','-a','android.intent.action.MAIN','-c','android.intent.category.LAUNCHER',id],{deadline:p._deadline})).stdout.split('\n').find(l=>/^[\w.]+\/[\w.$]+$/.test(l.trim()));
    if(!resolved)throw fail('APP_NOT_LAUNCHABLE','This Android package has no launcher Activity. Check installation or use a deep link.');
    let appTerminated=false;
    try{
      if(p.relaunch!==false){appTerminated=null;await devices.adb(d,['shell','am','force-stop',id],{deadline:p._deadline,mutation:true});appTerminated=true;}
      const result=await devices.adb(d,['shell','am','start','-W','-n',resolved.trim()],{deadline:p._deadline,mutation:true});
      if(/Error:|Exception/i.test(result.stdout))throw fail('APP_LAUNCH_FAILED','Android could not launch the Activity. Check app logs.','unknown');
      return {udid:d.udid,bundleId:id,appTerminated,appLaunched:true,execution:'executed'};
    }catch(e){
      if(appTerminated===null&&e.execution==='not_executed')appTerminated=false;
      return {udid:d.udid,bundleId:id,appTerminated,appLaunched:false,outcome:'partial',execution:appTerminated!==false?'unknown':e.execution||'unknown',launchError:{code:e.code||'APP_LAUNCH_FAILED',message:e.message,execution:e.execution||'unknown'},nextAction:'Inspect the App and launchError before continuing; do not blindly repeat launch or force-stop.'};
    }
  }
  async function bundle(d,p){
    const id=packageId(p.bundleId),paths=(await devices.adb(d,['shell','pm','path',id],{deadline:p._deadline})).stdout.split('\n').filter(l=>l.startsWith('package:')).map(l=>l.slice(8));
    if(paths.length!==1)return {bundleId:id,appPath:null,note:'Only single APK installations can be copied to another device.'};
    const directory=await require('./artifacts.cjs').directory(root,'app-transfer');const destination=path.join(directory,randomUUID()+'.apk');
    await devices.adb(d,['pull',paths[0],destination],{deadline:p._deadline});return {bundleId:id,appPath:destination};
  }
  return {info,install,status,launch,bundle,runningFor:id=>{const j=[...jobs.values()].find(j=>j.state==='running'&&(!id||j.udid===id));return j?{...j,id:j.job}:null;},pending:id=>id?pending.get(id):pending.size?Promise.allSettled([...pending.values()]):null};
}
module.exports={createApps,inspect,manifest,packageId};
