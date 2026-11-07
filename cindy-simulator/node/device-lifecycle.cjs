'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {deviceId}=require('./device-id.cjs');
const {readJsonRecord,isRecord}=require('./json-record.cjs');
const HOUR=3600000, EXCESS_IDLE_MS=72*HOUR, MAX_IDLE_MS=7*24*HOUR, LEASE_MS=15*60000;
const validTime=v=>Number.isFinite(v)&&v>=0;
// Missing provenance is permanent. Never infer ownership from a name or an old task binding.
function createDeviceLifecycle(file,now=Date.now){
 let queue=Promise.resolve();
 const serial=fn=>{const result=queue.then(fn,fn);queue=result.catch(()=>{});return result;};
 const read=()=>readJsonRecord(file,{initial:{version:1,devices:{},history:[]},
  validate:v=>v.version===1&&isRecord(v.devices)&&Array.isArray(v.history)&&Object.entries(v.devices).every(([id,d])=>
   /^[0-9A-F-]{36}$/.test(id)&&isRecord(d)&&['temporary','permanent'].includes(d.retention)&&
   validTime(d.createdAt)&&validTime(d.lastUsedAt)&&validTime(d.leaseUntil)&&(d.idleSince===null||validTime(d.idleSince))),
  code:'LIFECYCLE_UNREADABLE',message:'Cannot read simulator retention records. Restore the file before creating or reclaiming devices.'});
 async function write(value){
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(tmp,JSON.stringify(value),{mode:0o600});await fs.rename(tmp,file);}
  finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
 }
 const change=fn=>serial(async()=>{const value=await read();if(await fn(value)!==false)await write(value);});
 async function snapshot(){await queue;return read();}
 return {
  snapshot,
  register(udid,{temporary,purpose,isolationReason}){return change(v=>{const at=now();v.devices[deviceId(udid)]={retention:temporary?'temporary':'permanent',createdBy:temporary?'agent':'user',creationReason:temporary?(isolationReason||'no-matching-available-device'):'manual',createdAt:at,lastUsedAt:at,idleSince:temporary?null:at,leaseUntil:temporary?at+LEASE_MS:0,...(purpose?{purpose}: {})};});},
  use(udid){return change(v=>{const d=v.devices[deviceId(udid)];if(!d||d.retention!=='temporary')return false;
   const at=now();if(d.idleSince===null&&d.lastUsedAt>at-60000&&d.leaseUntil>at+LEASE_MS-60000)return false;
   d.lastUsedAt=at;d.idleSince=null;d.leaseUntil=at+LEASE_MS;});},
  release(udid){return change(v=>{const d=v.devices[deviceId(udid)];if(!d)return false;d.leaseUntil=now();d.idleSince=now();});},
  retain(udid){return change(v=>{const d=v.devices[deviceId(udid)];if(!d)return false;d.retention='permanent';});},
  forget(udid){return change(v=>{if(!v.devices[deviceId(udid)])return false;delete v.devices[deviceId(udid)];});},
  record(entry){return change(v=>{v.history.push({...entry,at:now()});v.history=v.history.slice(-100);});},
  // Only observed shutdown devices can become idle; booted/unknown states protect
  // against worker restarts and external tools. Polling never refreshes lastUsedAt.
  observe(devices,protectedDevice){return change(v=>{let changed=false;const at=now();
   for(const device of devices){const d=v.devices[deviceId(device.udid)];if(!d||d.retention!=='temporary'||device.kind==='physical')continue;
    const protectedNow=device.state!=='Shutdown'||protectedDevice(device)||d.leaseUntil>at;
    if(protectedNow){if(d.idleSince!==null){d.idleSince=null;changed=true;}}
    else if(d.idleSince===null){d.idleSince=at;changed=true;}
   }return changed;});},
 };
}
function planReclamation(devices,records,now){
 const idle=devices.filter(d=>d.kind!=='physical'&&d.state==='Shutdown').map(d=>({device:d,record:records[deviceId(d.udid)]}))
  .filter(({record:r})=>r?.retention==='temporary'&&r.idleSince!==null&&r.leaseUntil<=now)
  .sort((a,b)=>b.record.idleSince-a.record.idleSince||a.device.udid.localeCompare(b.device.udid));
 return idle.map(({device,record},index)=>({udid:device.udid,name:device.name,
  reason:index<2?'idle-7-days':'excess-idle-72-hours',reclaimAt:record.idleSince+(index<2?MAX_IDLE_MS:EXCESS_IDLE_MS)}));
}
module.exports={createDeviceLifecycle,planReclamation,LEASE_MS,EXCESS_IDLE_MS,MAX_IDLE_MS};
