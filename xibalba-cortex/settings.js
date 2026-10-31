'use strict';
const $=id=>document.getElementById(id),channel=new BroadcastChannel('cortex-cindy');
const defaults={mode:'local',executable:'',home:'',agentId:'',endpoint:'',recording:false,historyCapture:false,historyDatabase:'',archiveFiles:false,captureActivity:false};
let revision=0,saving=false;
function setSaving(active){
 saving=active;
 // Keep the submitted endpoint/token pair immutable while waiting for the lock.
 // The connection-test button is read-only and owns its independent busy state.
 for(const control of $('settings').elements)if(control.id!=='test')control.disabled=active;
}
// This is the same origin-scoped lock used by the resident configuration tools
// and hosted calls. Secrets never travel through BroadcastChannel, KV, or tools.
function settingsLock(action){
 if(!globalThis.navigator?.locks?.request)throw new Error('Safe settings coordination is unavailable. Update Cindy before changing settings or hosted credentials.');
 return navigator.locks.request('cortex-settings-v1',{mode:'exclusive'},action);
}
async function saveSettings(cfg,secretAction,secretValue=''){
 const expectedRevision=revision;
 return settingsLock(async()=>{
  const latest={...defaults,...await(await request('/kv')).json()};
  const currentRevision=Number.isSafeInteger(latest.settingsRevision)?latest.settingsRevision:0;
  if(currentRevision!==expectedRevision)throw new Error('Settings changed in another window or tool. Reload settings before saving again.');
  if(latest.credentialPending&&!secretAction)throw new Error('Finish the pending credential update by explicitly saving or removing the hosted token.');
  let nextRevision=currentRevision+1;
  if(secretAction){
   // A durable marker prevents the old endpoint being used with a new token if
   // the credential request or final configuration save loses its confirmation.
   await request('/kv',{method:'PUT',body:JSON.stringify({...latest,settingsRevision:nextRevision,credentialPending:true})});revision=nextRevision;
   try{
    if(secretAction==='delete')await request('/secrets/cortex_token',{method:'DELETE'});
    else await request('/secrets/cortex_token',{method:'PUT',body:JSON.stringify({value:secretValue})});
   }catch{throw new Error('Credential update was not confirmed. Hosted calls are paused; reload settings and explicitly save or remove the token.');}
   finally{$('token').value='';}
   nextRevision++;
  }
  const next={...latest,...(cfg||{}),settingsRevision:nextRevision,credentialPending:false};
  try{await request('/kv',{method:'PUT',body:JSON.stringify(next)});}catch{throw new Error('Settings save was not confirmed. Reload settings and check the connection and recording state.');}
  revision=nextRevision;channel.postMessage({type:'settings-changed'});
 });
}
const fields=['mode','executable','home','agentId','endpoint','historyDatabase'];
function message(t){$('message').textContent=t;}
async function request(path,options){const r=await fetch(path,options);if(!r.ok)throw new Error('Settings could not be saved. Reopen this page and retry.');return r;}
function mode(){ $('local').hidden=$('mode').value!=='local';$('hosted').hidden=$('mode').value!=='hosted';}
async function secretState(){const data=await(await request('/secrets')).json();const entries=Array.isArray(data)?data:(data.secrets||[]);const saved=Array.isArray(entries)?entries.some(x=>x.key==='cortex_token'&&x.saved):Boolean(entries.cortex_token?.saved);$('token-state').textContent=saved?'A token is stored in Cindy’s protected vault.':'No hosted token saved.';}
async function load(){const cfg={...defaults,...await(await request('/kv')).json()};revision=Number.isSafeInteger(cfg.settingsRevision)?cfg.settingsRevision:0;fields.forEach(k=>$(k).value=cfg[k]);$('recording').checked=cfg.recording;$('historyCapture').checked=cfg.historyCapture;$('archiveFiles').checked=cfg.archiveFiles;$('captureActivity').checked=cfg.captureActivity;mode();await secretState();await request('/wake');channel.postMessage({type:'status-request'});}
$('mode').onchange=mode;
$('settings').onsubmit=async e=>{e.preventDefault();if(saving)return;setSaving(true);try{const cfg={};fields.forEach(k=>cfg[k]=$(k).value.trim());cfg.recording=$('recording').checked;cfg.historyCapture=$('historyCapture').checked;cfg.archiveFiles=$('archiveFiles').checked;cfg.captureActivity=$('captureActivity').checked;
  const secretValue=$('token').value;
  if((cfg.archiveFiles||cfg.captureActivity)&&!cfg.historyCapture)throw new Error('File snapshots and activity metadata require history capture.');
  if(cfg.historyCapture&&(cfg.mode!=='local'||!cfg.historyDatabase.startsWith('/')||!cfg.recording))throw new Error('History capture requires local Cortex, an absolute database path, and recording enabled.');
  if(cfg.mode==='hosted'){const u=new URL(cfg.endpoint);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new Error('Use an HTTPS MCP URL without credentials, query parameters, or fragments.');}
  else if(!cfg.executable.startsWith('/')||!cfg.home.startsWith('/'))throw new Error('Use absolute executable and profile paths.');
  await request('/wake');await saveSettings(cfg,secretValue?'put':null,secretValue);await secretState();message(cfg.recording?'Saved. Recording is enabled.':'Saved. Recording is paused.');
}catch(e){message(e.message);}finally{setSaving(false);}};
$('clear-token').onclick=async()=>{if(saving)return;setSaving(true);try{await saveSettings(null,'delete');await secretState();message('Saved token removed.');}catch(e){message(e.message);}finally{setSaving(false);}};
let testTimer;
$('test').onclick=async()=>{try{$('test').disabled=true;message('Checking saved connection…');await request('/wake');channel.postMessage({type:'test-connection'});testTimer=setTimeout(()=>{$('test').disabled=false;message('Connection check timed out. Check the saved settings and retry.');},40000);}catch(e){$('test').disabled=false;message(e.message);}};
channel.onmessage=e=>{const d=e.data;if(d.type==='connection-result'){clearTimeout(testTimer);$('test').disabled=false;message(d.ok?'Connected: Cortex memory_status succeeded.':d.message);}if(d.type==='status')$('status').textContent=`This run: ${d.recorded} recorded · ${d.skipped} skipped · ${d.failed} failed. ${d.lastResult}`;};
load().catch(e=>message(e.message));
