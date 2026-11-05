'use strict';
// Copied into each private job directory: plugin upgrades cannot replace a live runner.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {identity}=require('./observation.cjs');
const dir=process.argv[2],plan=JSON.parse(fs.readFileSync(path.join(dir,'plan.json'),'utf8'));
let state=JSON.parse(fs.readFileSync(path.join(dir,'status.json'),'utf8'));
let child,childExited=false,stopping=false,userData,receipt,receiptIdentity,lastOutput='',timer;
let failureCode,wasReady=false,lastTick=Date.now(),activeStartupMs=0;
function write(patch){state={...state,...patch,supervisorPid:process.pid,updatedAt:Date.now()};const tmp=path.join(dir,`${crypto.randomUUID()}.tmp`);fs.writeFileSync(tmp,JSON.stringify(state)+'\n',{mode:0o600});fs.renameSync(tmp,path.join(dir,'status.json'));}
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
function inspect(){
  if(!userData)return;
  try{
    const records=fs.readdirSync(path.join(userData,'.dev-instances'));
    for(const name of records){if(!name.endsWith('.json'))continue;const r=JSON.parse(fs.readFileSync(path.join(userData,'.dev-instances',name),'utf8'));
      if(r.rootDir!==plan.projectRoot||r.userDataDir!==userData||!r.isolated||r.profileKind!=='isolated-sandbox'||r.startedAtMs<state.startedAt-2000||!alive(r.pid))continue;
      if(receipt&&receipt.instanceId!==r.instanceId)continue;
      if(!receipt){receiptIdentity=identity(r.pid);if(!receiptIdentity)continue;}
      receipt=r;
      const base={application:{pid:r.pid,instanceId:r.instanceId,userDataDir:r.userDataDir,processIdentity:receiptIdentity,acceptance:r.acceptance||null},execution:'executed'};
      if(r.state==='ready'&&(plan.configuration.mode!=='acceptance'||r.acceptance)){wasReady=true;write({...base,state:'ready',code:undefined,nextAction:undefined,verification:plan.configuration.mode==='acceptance'?'application-acceptance-receipt':'application-ready'});}
      else if(r.state==='failed'){write(base);failRun(r.failure?.code||'APPLICATION_FAILED');}
      else write(base);
    }
  }catch(e){if(e.code!=='ENOENT')write({observation:'receipt-unavailable'});}
}
function observeStartup(){
  if(stopping||wasReady)return;
  let startup;try{startup=JSON.parse(fs.readFileSync(path.join(dir,'startup.json'),'utf8'));}catch{}
  if(startup?.state==='failed'){failRun(startup.code||'APPLICATION_FAILED');return;}
  // Ignore another PID's waiting signal, even if a checkout incorrectly reused
  // a status file. Ready still requires the matching application receipt.
  const waiting=receipt&&startup?.pid===receipt.pid&&startup?.code==='DEV_SIGN_IN_REQUIRED'&&startup.state==='window-ready';
  const now=Date.now();
  if(!waiting&&state.state!=='waiting-for-owner')activeStartupMs+=Math.max(0,now-lastTick);
  lastTick=now;
  if(waiting)write({state:'waiting-for-owner',code:'DEV_SIGN_IN_REQUIRED',nextAction:'This sandbox is retained. Reuse its existing login or complete supported remote authorization; do not restart or require desktop unlock for inspection.'});
  else if(state.state==='waiting-for-owner')write({state:'preparing',code:undefined,nextAction:undefined});
  if(activeStartupMs>120000)failRun('STARTUP_TIMEOUT');
}
function failRun(code){failureCode=failureCode||code;stop();}
function signalOwned(signal){
  // Only signal a process group created by this runner while its original child lives.
  if(child&&!childExited){try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch{}}
  if(receipt&&receiptIdentity&&identity(receipt.pid)===receiptIdentity){try{process.kill(receipt.pid,signal);}catch{}}
}
function stop(){
  if(stopping)return;stopping=true;write({state:'stopping',code:failureCode,nextAction:undefined});signalOwned('SIGTERM');
  const deadline=Date.now()+6000;
  const wait=setInterval(()=>{
    const appStill=receipt&&receiptIdentity&&identity(receipt.pid)===receiptIdentity;
    if((childExited||!child)&&!appStill){clearInterval(wait);finish(failureCode?'failed':'stopped',failureCode);}
    else if(Date.now()>deadline){signalOwned('SIGKILL');clearInterval(wait);setTimeout(()=>finish((receipt&&identity(receipt.pid)===receiptIdentity)||!childExited?'unknown':failureCode?'failed':'stopped',failureCode),300);}
  },200);
}
function finish(s,code){clearInterval(timer);write({state:s,...(code?{code}:{}),dataPreserved:true});process.exitCode=s==='failed'?1:0;setImmediate(()=>process.exit());}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
write({state:'preparing'});
const log=fs.createWriteStream(path.join(dir,'output.log'),{flags:'a',mode:0o600});
let argv=plan.argv;
if(plan.terminalPython)argv=[plan.terminalPython,path.join(dir,'terminal.py'),...argv];
try{
  child=spawn(argv[0],argv.slice(1),{cwd:plan.projectRoot,env:{...process.env,...plan.env},detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  child.once('spawn',()=>write({state:plan.readiness==='cindy'?'preparing':'running',childPid:child.pid,execution:'executed'}));
  function output(chunk){log.write(chunk);lastOutput=(lastOutput+chunk.toString()).slice(-32768);
    const line=lastOutput.match(/==> Isolated dev user data[^\r\n]*: ([^\r\n]+)/);
    if(line&&path.isAbsolute(line[1].trim()))userData=line[1].trim();
  }
  child.stdout.on('data',output);child.stderr.on('data',output);
  child.once('error',()=>{childExited=true;finish('failed','COMMAND_START_FAILED');});
  child.once('exit',(code,signal)=>{childExited=true;write({commandExitCode:code,commandSignal:signal});if(stopping)return;
    if(plan.readiness==='cindy'){inspect();observeStartup();if(stopping)return;if(code!==0||signal){failRun('DEV_PROCESS_EXITED');return;}if(receipt&&alive(receipt.pid))return;failRun(wasReady?'APPLICATION_EXITED':'APPLICATION_NOT_READY');}
    else finish(code===0?'completed':'failed',code===0?undefined:'COMMAND_FAILED');
  });
  timer=setInterval(()=>{
    if(fs.existsSync(path.join(dir,'cancel.json'))){stop();return;}if(stopping)return;
    if(plan.readiness==='cindy'){inspect();observeStartup();if(!stopping&&receipt&&identity(receipt.pid)!==receiptIdentity)failRun(wasReady?'APPLICATION_EXITED':'APPLICATION_NOT_READY');}
  },500);
}catch{finish('failed','COMMAND_START_FAILED');}
