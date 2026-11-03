'use strict';
// Only operates on an already validated, private-set iOS device. The runtime's
// existing per-device operation lock serializes this with boot/shutdown/erase.
const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const catalog = require('../vendor/simslim/profiles.json');
const keep = new Set(['widgets','siri','icloud','store','pim','web','photos','connectivity','other']);
const minimal = [...new Set(catalog.flatMap(c=>c.labels))].sort();
const retained = new Set(catalog.filter(c=>keep.has(c.id)).flatMap(c=>c.labels));
const saving = minimal.filter(label=>!retained.has(label));
const profiles = {standard:[],saving,minimal};
const limitations = {
  standard: 'Restores the services managed by these memory profiles. Unrelated overrides are preserved.',
  saving: 'Disables search, family/Screen Time, health/HomeKit, some system apps/maps, game saves/controllers, messaging/FaceTime and telemetry/DeviceCheck. Use standard for these features and full acceptance tests.',
  minimal: 'Also disables iCloud/account, StoreKit/push, photos, widgets/Live Activities, Siri/speech, web background services and sharing/connectivity services. Only use for explicitly scoped core gameplay/UI tests; use standard for login, purchases, ads, sharing and full acceptance tests.',
};
function validateMode(value, Failure) {
  if(value!==undefined&&(typeof value!=='string'||!Object.hasOwn(profiles,value)))throw new Failure('INVALID_ARGUMENT','memoryMode must be standard, saving or minimal.');
}
function classify(entries) {
  const disabled=minimal.filter(label=>entries[label]===true);
  return Object.keys(profiles).find(mode=>profiles[mode].length===disabled.length&&profiles[mode].every(l=>entries[l]===true))||'custom';
}
function receipt(entries, verified=false) {
  const mode=classify(entries);
  return {mode,verified,disabledServices:minimal.filter(l=>entries[l]===true).length,
    limitations:limitations[mode]||'Overrides differ from all bundled profiles. Shut down and start with an explicit mode to apply a known profile.'};
}
function createMemoryModes({run,sim,Failure,storeRoot='/private/var/tmp'}) {
  function directory(device) {
    if(!/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(device.udid))throw new Failure('INVALID_DEVICE','Use the canonical owned device UDID.');
    return path.join(storeRoot,'com.apple.CoreSimulator.SimDevice.'+device.udid);
  }
  async function checkDirectory(dir,create=false) {
    if(create)await fs.mkdir(dir,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    let stat;try{stat=await fs.lstat(dir);}catch(e){if(e.code==='ENOENT')return false;throw e;}
    if(!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o022))throw new Failure('MEMORY_STORE_UNSAFE','Cannot safely access this device’s launchd overrides. Check its directory ownership and permissions.');
    return true;
  }
  async function read(device) {
    const dir=directory(device);if(!await checkDirectory(dir))return {};
    let handle;
    try {
      handle=await fs.open(path.join(dir,'disabled.plist'),constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await handle.stat();
      if(!stat.isFile()||stat.size>1024*1024||stat.uid!==process.getuid())throw new Failure('MEMORY_STORE_UNSAFE','Cannot safely read this device’s launchd overrides.');
      const input=await handle.readFile();
      const {stdout}=await run('/usr/bin/plutil',['-convert','json','-o','-','-'],{input,timeout:3000});
      const entries=JSON.parse(stdout);
      if(!entries||Array.isArray(entries)||typeof entries!=='object'||Object.values(entries).some(v=>typeof v!=='boolean'))throw new Failure('MEMORY_STORE_INVALID','Unexpected launchd override format. No memory settings were changed.');
      return entries;
    } catch(e){if(e.code==='ENOENT')return {};throw e;}
    finally {await handle?.close();}
  }
  async function configure(device,requested,checkStopped) {
    validateMode(requested,Failure);
    const entries=await read(device);
    if(device.state==='Booted') {
      if(requested!==undefined&&classify(entries)!==requested)throw new Failure('MEMORY_MODE_REQUIRES_SHUTDOWN','Shut down this device first, then boot with the requested memoryMode. Running Apps were not interrupted.');
      return receipt(entries);
    }
    if(device.state!=='Shutdown')throw new Failure('DEVICE_TRANSITIONING','Wait for this device to finish starting or stopping before selecting a memory mode.');
    const mode=requested??'saving',desired=new Set(profiles[mode]);
    const next={...entries};
    for(const label of minimal){if(desired.has(label))next[label]=true;else if(next[label]===true)next[label]=false;}
    const dir=directory(device);await checkDirectory(dir,true);
    const temp=path.join(dir,'disabled.plist.'+randomUUID());
    try {
      const {stdout}=await run('/usr/bin/plutil',['-convert','xml1','-o','-','-'],{input:JSON.stringify(next),timeout:3000});
      await fs.writeFile(temp,stdout,{flag:'wx',mode:0o600});
      // A device started outside Cindy must never have its live store replaced.
      await checkStopped();await checkDirectory(dir);
      await fs.rename(temp,path.join(dir,'disabled.plist'));
    } finally {await fs.rm(temp,{force:true}).catch(()=>{});}
    return receipt(next);
  }
  async function verify(device,timeout=5000) {
    const {stdout}=await sim(['spawn',device.udid,'launchctl','print-disabled','system'],{timeout});
    if(!/^\s*disabled services\s*=\s*\{/m.test(stdout))throw new Failure('MEMORY_MODE_UNVERIFIED','Could not read active launchd overrides. Check the device before testing.');
    const entries={};for(const m of stdout.matchAll(/"([^"]+)"\s*=>\s*(true|false|disabled|enabled)/g))entries[m[1]]=m[2]==='true'||m[2]==='disabled';
    return receipt(entries,true);
  }
  return {configure,verify};
}
module.exports={createMemoryModes,validateMode,profiles,classify,limitations};
