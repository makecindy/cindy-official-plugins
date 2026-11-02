'use strict';
const fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os');
const {createWriteStream}=require('node:fs');
const {pipeline}=require('node:stream/promises');
const {createHash,randomUUID}=require('node:crypto');
const {XMLParser,zip}=require('../../vendor/android/deps.cjs');
const BASE='https://dl.google.com/android/repository/';
const XML=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,processEntities:false});
const array=v=>v===undefined?[]:Array.isArray(v)?v:[v];
const text=v=>String(v?.['#text']??v??'');
const fail=(code,message,execution='not_executed')=>Object.assign(Error(message),{code,execution});
const exists=file=>fs.access(file).then(()=>true,()=>false);
function host(platform=process.platform,arch=process.arch){
  if(!['darwin','win32','linux'].includes(platform)||!['x64','arm64'].includes(arch)||(platform!=='darwin'&&arch!=='x64'))
    throw fail('ANDROID_HOST_UNSUPPORTED','Android Emulator requires an Intel/AMD 64-bit Windows/Linux PC or an Intel/Apple Silicon Mac.');
  return {os:{darwin:'macosx',win32:'windows',linux:'linux'}[platform],arch:arch==='arm64'?'aarch64':'x64',abi:arch==='arm64'?'arm64-v8a':'x86_64'};
}
function repository(xml){
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw fail('SDK_CATALOG_INVALID','The Android download catalog contains unsupported XML.');
  const root=Object.values(XML.parse(xml)).find(v=>v?.remotePackage);
  if(!root)throw fail('SDK_CATALOG_INVALID','Could not read the Android download catalog. Try again later.');
  return root;
}
function packageArchive(root,id,base,target=host()){
  const pkg=array(root.remotePackage).find(p=>p['@_path']===id&&p.channelRef?.['@_ref']==='channel-0');
  const archive=array(pkg?.archives?.archive).find(a=>(!a['host-os']||a['host-os']===target.os)&&(!a['host-arch']||a['host-arch']===target.arch));
  if(!archive?.complete)throw fail('SDK_PACKAGE_UNAVAILABLE',`No stable Android package is available for this computer (${id}).`);
  const c=archive.complete,url=new URL(text(c.url),base);
  if(url.origin!=='https://dl.google.com'||!url.pathname.startsWith('/android/repository/')||url.username||url.password)throw fail('SDK_CATALOG_INVALID','Unexpected Android package source.');
  const size=Number(c.size),checksum=text(c.checksum),algorithm=c.checksum?.['@_type']||'sha1';
  if(!Number.isSafeInteger(size)||size<=0||size>8e9||!['sha1','sha256'].includes(algorithm)||!new RegExp(`^[a-f0-9]{${algorithm==='sha1'?40:64}}$`,'i').test(checksum))throw fail('SDK_CATALOG_INVALID','Invalid Android package size or checksum.');
  const license=array(root.license).find(l=>l['@_id']===pkg['uses-license']?.['@_ref']);
  if(!license||!text(license).trim()||! /^[A-Za-z0-9_-]+$/.test(license['@_id']))throw fail('SDK_LICENSE_MISSING','The Android package license could not be read. Try again later.');
  return {id,name:text(pkg['display-name']),url:url.href,size,checksum,algorithm,license:{id:license['@_id'],text:text(license)}};
}
async function response(url,signal){
  // Autonomous downloads have one fixed upstream. Never follow a redirect to
  // a different host, local address, or an unencrypted URL.
  for(let i=0;i<4;i++){
    const u=new URL(url);if(u.origin!=='https://dl.google.com'||!u.pathname.startsWith('/android/repository/'))throw fail('SDK_DOWNLOAD_SOURCE','Unexpected Android download source.');
    const r=await fetch(u,{redirect:'manual',signal});
    if([301,302,303,307,308].includes(r.status)){await r.body?.cancel();url=new URL(r.headers.get('location'),u).href;continue;}
    if(!r.ok){await r.body?.cancel();throw fail('SDK_DOWNLOAD_FAILED',`Android download returned HTTP ${r.status}. Check the connection and try again.`);}
    return r;
  }
  throw fail('SDK_DOWNLOAD_FAILED','Android download redirected too many times. Try again later.');
}
async function catalog(url){
  const r=await response(url,AbortSignal.timeout(30000));let bytes=0,chunks=[];
  for await(const chunk of r.body){bytes+=chunk.length;if(bytes>12e6)throw fail('SDK_CATALOG_INVALID','Android catalog is too large.');chunks.push(chunk);}
  return repository(Buffer.concat(chunks).toString('utf8'));
}
async function extract(file,directory){
  const archive=await new Promise((resolve,reject)=>zip.open(file,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?reject(e):resolve(z)));
  let total=0,count=0;const links=[];
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  await new Promise((resolve,reject)=>{
    const abort=e=>{archive.close();reject(e);};archive.on('error',abort);archive.on('end',resolve);
    archive.on('entry',entry=>{(async()=>{
      const name=entry.fileName;
      if(++count>100000||(total+=entry.uncompressedSize)>24e9||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..'||p.includes(':')))
        throw fail('SDK_ARCHIVE_INVALID','Unsafe Android archive entry. Nothing was installed.');
      const destination=path.join(directory,...name.split('/'));
      const mode=entry.externalFileAttributes>>>16,type=mode&0o170000;
      if(type&&![0o100000,0o040000,0o120000].includes(type))throw fail('SDK_ARCHIVE_INVALID','Unsupported Android archive entry.');
      if(name.endsWith('/')){await fs.mkdir(destination,{recursive:true});archive.readEntry();return;}
      await fs.mkdir(path.dirname(destination),{recursive:true});
      const stream=await new Promise((r,j)=>archive.openReadStream(entry,(e,s)=>e?j(e):r(s)));
      if(type===0o120000){
        if(entry.uncompressedSize>4096)throw fail('SDK_ARCHIVE_INVALID','Invalid Android archive link.');
        const chunks=[];for await(const chunk of stream)chunks.push(chunk);const target=Buffer.concat(chunks).toString('utf8');
        const resolved=path.resolve(path.dirname(destination),target);
        if(path.isAbsolute(target)||target.includes('\\')||!resolved.startsWith(path.resolve(directory)+path.sep))throw fail('SDK_ARCHIVE_INVALID','Android archive link escapes its directory.');
        links.push([destination,target]);
      }else await pipeline(stream,createWriteStream(destination,{flags:'wx',mode:(mode&0o111)?0o755:0o644}));
      archive.readEntry();
    })().catch(abort);});archive.readEntry();
  });
  // No archive file is ever written through a symlink.
  for(const [file,target] of links)await fs.symlink(target,file);
  for(const [file] of links){const actual=await fs.realpath(file);if(!actual.startsWith(path.resolve(directory)+path.sep))throw fail('SDK_ARCHIVE_INVALID','Android archive link resolves outside its directory.');}
}
function createSdk(root,{platform=process.platform,arch=process.arch,env=process.env,home=os.homedir()}={}){
  const managed=path.join(root,'sdk'),ext=platform==='win32'?'.exe':'';
  const candidates=[managed,env.ANDROID_HOME,env.ANDROID_SDK_ROOT,
    platform==='darwin'?path.join(home,'Library/Android/sdk'):platform==='win32'?path.join(env.LOCALAPPDATA||path.join(home,'AppData/Local'),'Android/Sdk'):path.join(home,'Android/Sdk')].filter(Boolean);
  let offered=null,job=null,pending=null;
  async function inspect(){
    const target=host(platform,arch);let emulator=null,adb=null;const images=[];
    for(const sdk of [...new Set(candidates)]){
      if(!emulator&&await exists(path.join(sdk,'emulator','emulator'+ext)))emulator=path.join(sdk,'emulator','emulator'+ext);
      if(!adb&&await exists(path.join(sdk,'platform-tools','adb'+ext)))adb=path.join(sdk,'platform-tools','adb'+ext);
      const base=path.join(sdk,'system-images');
      for(const api of await fs.readdir(base).catch(()=>[])){
        if(!/^android-\d+$/.test(api))continue;
        for(const tag of ['google_apis','google_apis_playstore','default']){
          const dir=path.join(base,api,tag,target.abi);
          if(await exists(path.join(dir,'system.img'))&&!images.some(i=>i.identifier===`android:${api}:${tag}:${target.abi}`))
            images.push({identifier:`android:${api}:${tag}:${target.abi}`,name:`Android API ${api.slice(8)} · ${tag==='google_apis_playstore'?'Google Play':tag==='google_apis'?'Google APIs':'AOSP'}`,version:api.slice(8),platform:'android',directory:dir,abi:target.abi});
        }
      }
    }
    return {emulator,adb,images,ready:!!(emulator&&adb&&images.length),managed};
  }
  async function plan(){
    const local=await inspect(),target=host(platform,arch),packages=[];
    if(!local.emulator||!local.adb){const repo=await catalog(BASE+'repository2-3.xml');for(const id of ['emulator','platform-tools'])if(!local[id==='emulator'?'emulator':'adb'])packages.push(packageArchive(repo,id,BASE,target));}
    if(!local.images.length){
      const base=BASE+'sys-img/google_apis/',repo=await catalog(base+'sys-img2-3.xml');
      const ids=array(repo.remotePackage).map(p=>p['@_path']).filter(id=>new RegExp(`^system-images;android-\\d+;google_apis;${target.abi}$`).test(id));
      const id=ids.sort((a,b)=>Number(b.split(';')[1].slice(8))-Number(a.split(';')[1].slice(8))).find(id=>array(repo.remotePackage).some(p=>p['@_path']===id&&p.channelRef?.['@_ref']==='channel-0'));
      packages.push(packageArchive(repo,id,base,target));
    }
    offered={id:randomUUID(),packages,bytes:packages.reduce((s,p)=>s+p.size,0),licenses:[...new Map(packages.map(p=>[p.license.id,p.license])).values()],destination:managed};
    return offered;
  }
  async function install(p){
    if(pending)throw fail('SDK_INSTALL_RUNNING','Android environment installation is already running.');
    if(!offered||p.planId!==offered.id||p.acceptLicenses!==true)throw fail('SDK_CONFIRM_REQUIRED','Review the download size and SDK licenses in the setup page, then confirm installation.');
    const selected=offered;offered=null;
    job={id:randomUUID(),state:'running',phase:'downloading',bytes:0,total:selected.bytes,bytesPerSecond:0};
    pending=(async()=>{
      const temporary=path.join(root,'downloads',job.id);
      let committed=false;
      try{
        await require('./artifacts.cjs').directory(root,'downloads');
        await fs.mkdir(temporary,{recursive:true,mode:0o700});
        for(const pkg of selected.packages){
          job.package=pkg.name;job.phase='downloading';const began=Date.now(),before=job.bytes;
          const r=await response(pkg.url,AbortSignal.timeout(30*60*1000)),hash=createHash(pkg.algorithm),file=path.join(temporary,'download.zip');
          let size=0;
          await pipeline(r.body,async function*(source){for await(const chunk of source){size+=chunk.length;if(size>pkg.size)throw fail('SDK_SIZE_MISMATCH','Android download size did not match the catalog. Retry setup.');hash.update(chunk);job.bytes+=chunk.length;job.bytesPerSecond=Math.round((job.bytes-before)*1000/Math.max(1,Date.now()-began));yield chunk;}},createWriteStream(file,{flags:'w',mode:0o600}));
          if(size!==pkg.size||hash.digest('hex').toLowerCase()!==pkg.checksum.toLowerCase())throw fail('SDK_CHECKSUM_MISMATCH','Android download verification failed. Retry setup.');
          job.phase='extracting';const stage=path.join(temporary,'unpacked');await extract(file,stage);
          const isImage=pkg.id.startsWith('system-images;'),parts=pkg.id.split(';');
          const source=path.join(stage,isImage?parts.at(-1):pkg.id),destination=path.join(managed,...parts);
          if(!await exists(source))throw fail('SDK_ARCHIVE_INVALID','Android package layout differs from the catalog.');
          await fs.mkdir(path.dirname(destination),{recursive:true});
          if(await exists(destination))throw fail('SDK_DESTINATION_EXISTS','This Android component already exists. Refresh setup; it was not overwritten.');
          await fs.rename(source,destination);committed=true;await fs.rm(stage,{recursive:true,force:true});
          const licenses=path.join(managed,'licenses');await fs.mkdir(licenses,{recursive:true});
          await fs.writeFile(path.join(licenses,pkg.license.id),createHash('sha1').update(pkg.license.text).digest('hex')+'\n',{mode:0o600});
        }
        job.state='done';job.phase='done';job.execution='executed';
      }catch(error){Object.assign(job,{state:'failed',phase:'failed',errorCode:error.code||'SDK_INSTALL_FAILED',message:error.message,execution:committed?'unknown':'not_executed'});}
      finally{await fs.rm(temporary,{recursive:true,force:true}).catch(()=>{});pending=null;}
    })();
    pending.catch(error=>{Object.assign(job,{state:'failed',message:error.message});pending=null;});
    return {...job};
  }
  return {inspect,plan,install,status:()=>job?{...job}:{state:'idle'},pending:()=>pending};
}
module.exports={createSdk,host,repository,packageArchive,extract};
