'use strict';
// App-owned diagnostics, never window-server automation or credential extraction.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
function fail(code,message){throw Object.assign(new Error(message),{code});}
function identity(pid){try{return execFileSync('ps',['-ww','-p',String(pid),'-o','lstart=','-o','comm='],{encoding:'utf8',timeout:2000,env:{...process.env,LC_ALL:'C',TZ:'UTC0'},stdio:['ignore','pipe','ignore']}).trim();}catch{return null;}}
function ownedListener(port,pid,expectedIdentity){
  if(!expectedIdentity||identity(pid)!==expectedIdentity)fail('INSTANCE_CHANGED','The recorded app has exited. No other app was inspected.');
  let listeners=[];
  try{listeners=execFileSync('lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-t'],{encoding:'utf8',timeout:2000,stdio:['ignore','pipe','ignore']}).trim().split(/\s+/).filter(Boolean).map(Number);}catch{}
  if(!listeners.length||listeners.some(p=>p!==pid))fail('DEBUG_PORT_NOT_OWNED','The debug port is not owned by this job. No other app was inspected.');
}
function localUrl(raw,port,protocol){const u=new URL(raw);if(u.protocol!==protocol||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||Number(u.port)!==port||u.username||u.password)fail('INVALID_DEBUG_ENDPOINT','Expected the owned local debug endpoint.');return u;}
async function connect(url){
  if(typeof WebSocket!=='function')fail('RUNTIME_UPDATE_REQUIRED','Inspection requires a Node runtime with WebSocket support.');
  const ws=new WebSocket(url);let next=0;const pending=new Map();
  function rejectAll(){for(const p of pending.values()){clearTimeout(p.timer);p.reject(Object.assign(new Error('The app debug connection closed.'),{code:'DEBUG_DISCONNECTED'}));}pending.clear();}
  ws.addEventListener('message',event=>{let msg;try{msg=JSON.parse(event.data);}catch{return;}const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);clearTimeout(p.timer);if(msg.error)p.reject(Object.assign(new Error('App inspection failed.'),{code:'DEBUG_COMMAND_FAILED'}));else p.resolve(msg.result);});
  ws.addEventListener('close',rejectAll);ws.addEventListener('error',rejectAll);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.close();reject(Object.assign(new Error('App debug connection timed out.'),{code:'DEBUG_TIMEOUT'}));},5000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(Object.assign(new Error('App debug connection unavailable.'),{code:'DEBUG_UNAVAILABLE'}));},{once:true});});
  return {call(method,params={}){return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(new Error('App inspection timed out.'),{code:'DEBUG_TIMEOUT'}));},5000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});},close(){rejectAll();ws.close();}};
}
async function withDesktop(plan,status,fn){
  const port=Number(plan.env?.XDT_CDP_PORT),app=status.application;
  if(plan.readiness!=='cindy'||!app||!['preparing','waiting-for-owner','ready','checking-account'].includes(status.state))fail('APP_NOT_INSPECTABLE','Wait for the owned desktop instance before inspecting it.');
  if(!Number.isInteger(port)||port<1024||port>65535)fail('DEBUG_PORT_REQUIRED','Save a dedicated debugPort on this profile before starting it.');
  if(process.platform==='win32')fail('INSPECTION_PLATFORM_UNVERIFIED','Owned debug-port inspection is currently available on macOS and Linux.');
  ownedListener(port,app.pid,app.processIdentity);
  const response=await fetch(`http://127.0.0.1:${port}/json/list`,{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)fail('DEBUG_UNAVAILABLE','App debug endpoint is unavailable.');
  const targets=await response.json();
  const pages=targets.filter(t=>{try{const u=new URL(t.url);return t.type==='page'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)&&u.pathname==='/'&&!u.search;}catch{return false;}});
  if(pages.length!==1)fail('MAIN_WINDOW_UNCONFIRMED','Could not identify exactly one application main page.');
  const endpoint=localUrl(pages[0].webSocketDebuggerUrl,port,'ws:');
  ownedListener(port,app.pid,app.processIdentity);
  const client=await connect(endpoint.href);
  try{const result=await fn(client);ownedListener(port,app.pid,app.processIdentity);return result;}
  finally{client.close();}
}

// Fixed, bounded application operations only. No caller-supplied code, endpoint,
// credential access or raw auth response crosses the debug connection.
const SNAPSHOT=`const auth=await api.authInitialize();
 const saved=await api.authListAccounts();
 const authenticated=auth.mode==='cloud'&&auth.isAuthenticated===true;
 const login=authenticated?null:await api.authGetLoginState();
 const database=authenticated&&typeof auth.dataOwnerId==='string'&&api.localDb?.ensureReady
   ?await api.localDb.ensureReady(auth.dataOwnerId):null;
 return {supported:true,authenticated,databaseReady:database?.ready===true,
  accounts:saved.accounts.map(a=>({accountKey:a.accountKey,displayName:a.displayName,isCurrent:a.isCurrent===true})),
  step:authenticated?'authenticated':login?.state?.step||null,
  code:database?.error?.code||(login?.success===false?login.code:null),
  remoteControl:api.deviceLink?.getState?(await api.deviceLink.getState()).remoteControlEnabled:null,
  verified,operationError};`;
function projectSnapshot(value){
  if(!value?.supported||!Array.isArray(value.accounts)||value.accounts.length>1000)fail('APP_INTERFACE_UNAVAILABLE','The target does not expose the expected account interface.');
  const bounded=(v,max)=>typeof v==='string'&&v.length<=max&&!v.includes('\0')?v:null;
  const accounts=value.accounts.map(a=>{
    const accountKey=bounded(a?.accountKey,512);if(!accountKey)fail('INVALID_ACCOUNT_SNAPSHOT','Invalid account reference from the application.');
    return {accountKey,displayName:bounded(a.displayName,256)||'Cindy account',isCurrent:a.isCurrent===true};
  });
  if(accounts.filter(a=>a.isCurrent).length>1)fail('INVALID_ACCOUNT_SNAPSHOT','Ambiguous current account.');
  return {authenticated:value.authenticated===true,databaseReady:value.databaseReady===true,accounts,
    step:bounded(value.step,80),code:bounded(value.code,100),remoteControl:typeof value.remoteControl==='boolean'?value.remoteControl:null,verified:value.verified===true,
    operationError:['ACCOUNT_REAUTH_REQUIRED','CREDENTIAL_STORE_UNAVAILABLE','ACCOUNT_NOT_FOUND'].includes(value.operationError)?value.operationError:null};
}
function accountExpression(operation='snapshot',args={}){
  let action='';
  if(operation==='sync')action='await api.authSyncAccounts();';
  else if(operation==='select'){
    if(typeof args.accountKey!=='string'||!args.accountKey||args.accountKey.length>512||args.accountKey.includes('\0'))fail('INVALID_ACCOUNT','Choose an existing account reference.');
    action=`await api.authSwitchAccount(${JSON.stringify(args.accountKey)});`;
  }else if(operation==='verify')action='verified=await api.authRefresh()===true;';
  else if(operation==='remote-control'){
    if(typeof args.enabled!=='boolean')fail('INVALID_INPUT','Expected a remote-control switch.');
    action=`await api.deviceLink.setEnabled(${args.enabled});`;
  }else if(operation!=='snapshot')fail('UNKNOWN_OPERATION','Unknown application operation.');
  return `(async()=>{const api=window.electronAPI;
      if(!api?.authInitialize||!api?.authListAccounts)return {supported:false};let verified=false,operationError=null;
      try{${action}}catch(e){const known=['ACCOUNT_REAUTH_REQUIRED','CREDENTIAL_STORE_UNAVAILABLE','ACCOUNT_NOT_FOUND'];
       operationError=known.find(code=>e?.code===code||typeof e?.message==='string'&&e.message.includes('['+code+']'));
       if(!operationError)throw Error('APP_OPERATION_UNCONFIRMED');}
      ${SNAPSHOT}})()`;
}
async function performDesktop(plan,status,operation='snapshot',args={}){
  const expression=accountExpression(operation,args);
  return withDesktop(plan,status,async client=>{
    const result=await client.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)fail('APP_OPERATION_UNCONFIRMED','Application operation did not return a confirmed result. Check this exact instance before repeating it.');
    return projectSnapshot(result.result?.value);
  });
}
async function inspectDesktop(dir,plan,status,{screenshot=false}={}){
  const snapshot=await performDesktop(plan,status);
  return withDesktop(plan,status,async client=>{
    const observed={jobId:status.jobId,state:status.state,transport:'owned-app-cdp',login:{step:snapshot.step,code:snapshot.code,authenticated:snapshot.authenticated},accountsRetained:snapshot.accounts.length};
    if(screenshot){
      const capture=await client.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      ownedListener(Number(plan.env.XDT_CDP_PORT),status.application.pid,status.application.processIdentity);
      const bytes=Buffer.from(capture.data,'base64');
      if(bytes.length>16*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail('INVALID_CAPTURE','The application did not return a valid bounded PNG.');
      const file=path.join(dir,'inspection.png'),tmp=path.join(dir,`inspection-${require('node:crypto').randomUUID()}.tmp`);
      try{fs.writeFileSync(tmp,bytes,{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}
      observed.screenshot=file;
    }
    return observed;
  });
}
module.exports={identity,inspectDesktop,performDesktop,projectSnapshot,accountExpression};
