'use strict';
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {deviceId}=require('./device-id.cjs');
const {readJsonRecord,recordUpdate}=require('./json-record.cjs');
const {platform}=require('./control-model.js');
// Device changes run through the same runtime lock as Agent tools and shutdown.
function createDeviceManager({dispatch,exclusive,assertEnabled,touch,contextFile,onSettled=async()=>{}}) {
 let job=null,apps=null,recordQueue=Promise.resolve();
 // Serialize only the tiny shared record write, not device operations.
 const recordWrite=fn=>{const next=recordQueue.then(fn,fn);recordQueue=next.catch(()=>{});return next;};
 const updateRecord=(result,update)=>recordUpdate(result,'appContextError',update,
  'The device operation completed, but recent App records could not be saved. Check the records file and storage before switching devices; do not repeat the device operation.');
 const fail=(code,message,execution='not_executed')=>Object.assign(Error(message),{code,execution});
 async function contexts(){
  if(apps)return apps;
  const value=await readJsonRecord(contextFile,{initial:{},
   validate:value=>Object.entries(value).every(([id,bundle])=>/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(id)&&typeof bundle==='string'&&/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(bundle)),
   code:'APP_CONTEXT_UNREADABLE',message:'Cannot read recent App records. Restore the records file before switching devices.'});
  apps ||= Object.fromEntries(Object.entries(value).map(([id,bundle])=>[deviceId(id),bundle]));
  return apps;
 }
 async function writeApp(udid,bundleId){
  const values={...await contexts()},id=deviceId(udid);
  if(bundleId)values[id]=bundleId;else delete values[id];
  const temporary=contextFile+'.'+randomUUID()+'.tmp';
  try{await fs.mkdir(path.dirname(contextFile),{recursive:true,mode:0o700});await fs.writeFile(temporary,JSON.stringify(values),{mode:0o600});await fs.rename(temporary,contextFile);apps=values;}
  finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
 }
 const remember=(udid,bundleId)=>recordWrite(()=>writeApp(udid,bundleId));
 const snapshot=()=>job?{...job}:null;
 async function currentApp(udid){return (await contexts())[udid.toUpperCase()]||null;}
 const forget=(udid,bundleId)=>recordWrite(async()=>{
  try{
   const current=await currentApp(udid);
   if(!current||(bundleId&&current!==bundleId))return;
   await writeApp(udid,null);
  }
  catch{throw fail('APP_CONTEXT_UNSAVED','The App was removed, but its recent-app record could not be cleared. Check storage before switching devices.','executed');}
 });
 async function selection(p){
  const devices=(await dispatch('devices')).devices;
  const source=devices.find(d=>deviceId(d.udid)===deviceId(p.udid)),target=devices.find(d=>deviceId(d.udid)===deviceId(p.targetUdid));
  if(!source||!target)throw fail('DEVICE_NOT_OWNED','Select a device from this plugin.');
  if(!target.isAvailable)throw fail('DEVICE_UNAVAILABLE','The selected runtime is unavailable.');
  if(!['Booted','Shutdown'].includes(source.state)||!['Booted','Shutdown'].includes(target.state))throw fail('BUSY','Wait for the device state change to complete.');
  return {source,target};
 }
 async function start(p){
  if(job?.state==='running')throw fail('BUSY','A device switch is already in progress.');
  await assertEnabled();
  let {source,target}=await selection(p);
  // Reserve before yielding; two HTTP requests cannot both start a switch.
  if(job?.state==='running')throw fail('BUSY','A device switch is already in progress.');
  const entry={id:randomUUID(),sourceUdid:source.udid,targetUdid:target.udid,state:'running',phase:'preparing',execution:'not_executed'};job=entry;
  const failed=async error=>{
   entry.errorCode=error.code||'SWITCH_FAILED';entry.execution=entry.execution==='not_executed'?(error.execution||'not_executed'):'unknown';
   // Selection failed before committing a new device. Keep the source selected,
   // regardless of whether either simulator is running.
   entry.activeUdid=source.udid;
   entry.state='failed';entry.phase='failed';touch();
  };
  await exclusive(async()=>{
   try{
    await assertEnabled();
    ({source,target}=await selection(p));
    // Only select the device. A stopped device waits for the explicit Start
    // action; running devices and their apps are left exactly as they are.
    // activeUdid identifies the selected device, not its power state.
    entry.activeUdid=target.udid;entry.execution='executed';
    await onSettled(entry,p);entry.state='done';entry.phase='done';touch();
   }catch(error){await failed(error);}
  }).catch(failed);
  // Lock acquisition can reject before the operation starts. Once acquired,
  // selection and binding settle before replying to this caller. Return its
  // own result, not the shared status slot that a later request can replace.
  return {...entry};
 }
 return {snapshot,currentApp,remember,forget,start,updateRecord};
}
module.exports={createDeviceManager};
