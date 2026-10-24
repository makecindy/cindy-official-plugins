'use strict';
const {spawn}=require('node:child_process');
const readline=require('node:readline');
// The viewer owns a native connection. No saved sessions or background daemon.
function createTrackpad({binary,deviceSet,children,Failure,spawnProcess=spawn,validateSample,encodeSample}){
 const active=new Map();
 const fail=(code,message,execution='not_executed')=>new Failure(code,message,execution);
 function validate(p){
  if(validateSample)return validateSample(p);
  if(typeof p.gesture!=='string'||!(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.gesture))||!['began','changed','ended'].includes(p.phase)||![p.x,p.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1))throw fail('INVALID_ARGUMENT','Invalid trackpad contact.');
 }
 function open(udid,gesture,developerDir){
  const child=spawnProcess(binary,[deviceSet,udid,developerDir],{stdio:['pipe','pipe','pipe']});children.add(child);
  const entry={child,gesture,pending:null,sending:false,dead:false,ready:null,closed:null};
  active.set(udid,entry);
  let readyResolve,readyReject;
  entry.ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const deadline=setTimeout(()=>{readyReject(fail('INPUT_FAILED','Trackpad did not become ready.'));child.kill('SIGTERM');},4000);
  const lines=readline.createInterface({input:child.stdout});
  lines.on('line',line=>{
   if(line==='ready'){clearTimeout(deadline);readyResolve();}
   else if(line==='ok'&&entry.pending){const pending=entry.pending;entry.pending=null;clearTimeout(pending.timer);pending.resolve();}
  });
  // Never return framework diagnostics, which can contain host paths.
  child.stderr.resume();child.stdin.on('error',()=>{});
  const reject=()=>{entry.dead=true;clearTimeout(deadline);readyReject(fail('INPUT_FAILED','Trackpad service unavailable.'));
   if(entry.pending){const p=entry.pending;entry.pending=null;clearTimeout(p.timer);p.reject(fail('INPUT_FAILED','Trackpad delivery not confirmed.','unknown'));}};
  child.once('error',reject);
  entry.closed=new Promise(resolve=>child.once('close',()=>{reject();children.delete(child);if(active.get(udid)===entry)active.delete(udid);lines.close();resolve();}));
  return entry;
 }
 async function stop(udid){
  const entries=udid?[active.get(udid)].filter(Boolean):[...active.values()];
  await Promise.all(entries.map(async entry=>{
   entry.child.stdin.end();
   // EOF normally releases immediately. Allow both native send deadlines
   // before terminating a helper stuck in framework initialization/delivery.
   const deadline=setTimeout(()=>entry.child.kill('SIGKILL'),3000);
   try{await entry.closed;}finally{clearTimeout(deadline);}
  }));
 }
 async function prepare(udid,developerDir){
  const entry=active.get(udid)||open(udid,null,developerDir);
  try{await entry.ready;}catch(error){await stop(udid);throw error;}
 }
 async function cancel(udid){if(active.get(udid)?.gesture)await stop(udid);}
 async function send(udid,p,developerDir){
  validate(p);
  let entry=active.get(udid);
  if(p.phase==='began'){
   if(entry?.gesture)throw fail('INPUT_BUSY','A trackpad contact is already active.');
   entry=entry||open(udid,null,developerDir);entry.gesture=p.gesture;
  }else if(!entry||entry.dead||entry.gesture!==p.gesture)throw fail('INPUT_EXPIRED','Trackpad contact ended. Start a new gesture.');
  if(entry.sending)throw fail('INPUT_BUSY','A trackpad sample is still being delivered.');
  entry.sending=true;
  try{
   await entry.ready;
   if(entry.dead)throw fail('INPUT_EXPIRED','Trackpad contact ended.');
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{entry.pending=null;entry.child.stdin.end();reject(fail('INPUT_FAILED','Trackpad delivery timed out.','unknown'));},2000);
    entry.pending={resolve,reject,timer};
    entry.child.stdin.write(encodeSample?encodeSample(p):`${{began:0,changed:1,ended:2}[p.phase]} ${p.x} ${p.y}\n`);
   });
   // Native unlocks before acknowledging ended; keep its client warm for the
   // next gesture so short flicks are not swallowed by framework startup.
   if(p.phase==='ended')entry.gesture=null;
   return {udid,execution:'executed'};
  }catch(error){entry.child.stdin.end();throw error;}finally{entry.sending=false;}
 }
 return {send,stop,prepare,cancel,has:udid=>{const e=active.get(udid);return !!e&&!e.dead;}};
}
module.exports={createTrackpad};
