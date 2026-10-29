'use strict';
const path=require('node:path');
const fs=require('node:fs/promises');
const {commandBudget}=require('./budget.cjs');

// CoreSimulator's host playback volume, observed by the guest audio service.
// This is separate from the Mac's output volume and never enables its microphone.
function createAudio({deviceSet,run,Failure}) {
  const previous=new Map();
  const file=device=>path.join(deviceSet,device.udid,'data/var/run/simulatoraudio/audiosettings.plist');
  async function status(device,deadline){
    const {stdout}=await run('/usr/bin/plutil',['-convert','json','-o','-',file(device)],commandBudget(5000,deadline));
    const volume=JSON.parse(stdout).sim_volume;
    if(volume===undefined)return {enabled:null,volume:null,restartRequired:false};
    if(typeof volume!=='number'||!Number.isFinite(volume)||volume<0||volume>100)throw new Failure('AUDIO_UNCONFIRMED','无法读取模拟器声音状态，请刷新设备后重试。');
    return {enabled:volume>0,volume,restartRequired:false};
  }
  async function set(device,enabled,deadline){
    if(typeof enabled!=='boolean')throw new Failure('INVALID_ARGUMENT','audioEnabled 必须为 true 或 false。');
    const before=await status(device,deadline);
    if(before.enabled===enabled)return {...before,execution:'not_executed'};
    if(before.volume>0)previous.set(device.udid,before.volume);
    const volume=enabled?(previous.get(device.udid)||60):0;
    await run('/usr/bin/plutil',['-replace','sim_volume','-integer',String(volume),file(device)],{mutation:true,...commandBudget(5000,deadline)});
    try {
      const current=await status(device,deadline);
      if(current.enabled!==enabled)throw new Failure('AUDIO_UNCONFIRMED','声音状态未确认，请刷新设备后检查。','unknown');
      return {...current,execution:'executed'};
    }catch(error){error.execution='unknown';throw error;}
  }
  async function prepare(device,enabled,deadline){
    commandBudget(1,deadline);
    const target=file(device);
    await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    // Preconfigure before launchd starts any guest audio clients. Existing
    // route settings are retained; a new device gets its routes during boot.
    await fs.writeFile(target,'<?xml version="1.0"?><plist version="1.0"><dict><key>sim_volume</key><integer>0</integer></dict></plist>',{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    return set(device,enabled,deadline);
  }
  return {status,set,prepare};
}
async function playbackStatus(controls,device){
  if(device?.state!=='Booted')return null;
  try{return await controls.request('audio',{udid:device.udid});}
  catch(error){return {enabled:null,errorCode:error.code||'AUDIO_UNCONFIRMED'};}
}
module.exports={createAudio,playbackStatus};
