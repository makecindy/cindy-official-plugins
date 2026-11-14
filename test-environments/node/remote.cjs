'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const FILES=['core.cjs','cli.cjs','runner.cjs','observation.cjs','account-catalog.cjs','login-library.cjs','session-monitor.cjs','cindy-launch.cjs','terminal.py','remote-agent.cjs','remote-runner.cjs'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function fail(code,message,execution='not_executed'){throw Object.assign(new Error(message),{code,execution});}
function target(value){
 if(!value||Object.keys(value).some(k=>!['host','node'].includes(k))||! /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.host||''))fail('INVALID_SSH_TARGET','Choose an exact SSH Host alias or hostname, without options or shell text.');
 const node=value.node||'node';if(node!=='node'&&! /^\/[a-zA-Z0-9/._ -]+$/.test(node))fail('INVALID_REMOTE_NODE','Use node or an absolute Node executable path.');
 return {host:value.host,node};
}
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
// Only this reviewed source bundle is provisioned. No app data, credentials,
// repository working files or SSH agent are transferred.
const BOOTSTRAP=`const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');let input='';
process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{input+=c;if(input.length>2097152)process.exit(2)});
process.stdin.on('end',async()=>{try{if(Number(process.versions.node.split('.')[0])<22)throw Object.assign(Error(),{code:'REMOTE_NODE_UPDATE_REQUIRED',execution:'not_executed'});const q=JSON.parse(input),names=${JSON.stringify(FILES)};
if(q.protocol!==1||JSON.stringify(Object.keys(q.files).sort())!==JSON.stringify([...names].sort())||crypto.createHash('sha256').update(JSON.stringify(q.files)).digest('hex')!==q.digest)throw Error('INVALID_BUNDLE');
const home=process.env.TEST_ENVIRONMENTS_HOME||(process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support','Test Environments'):path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share'),'test-environments'));
const root=path.join(home,'ssh-runtime',q.digest);fs.mkdirSync(root,{recursive:true,mode:448});if(fs.lstatSync(root).isSymbolicLink())throw Error('UNSAFE_RUNTIME');
for(const name of names){const file=path.join(root,name),content=q.files[name];if(typeof content!=='string'||content.length>262144)throw Error('INVALID_BUNDLE');
 try{fs.writeFileSync(file,content,{flag:'wx',mode:384})}catch(e){if(e.code!=='EEXIST')throw e;if(fs.lstatSync(file).isSymbolicLink()||fs.readFileSync(file,'utf8')!==content)throw Error('RUNTIME_CHANGED')}}
process.env.PATH=path.dirname(process.execPath)+path.delimiter+(process.env.PATH||'');
const data=await require(path.join(root,'remote-agent.cjs')).dispatch(q.request);process.stdout.write(JSON.stringify({ok:true,data})+'\\n');
}catch(e){process.stdout.write(JSON.stringify({ok:false,errorCode:/^[A-Z_]+$/.test(e.code||'')?e.code:'REMOTE_OPERATION_UNCONFIRMED',message:'Inspect the same remote run before repeating an operation.',execution:e.execution||'unknown'})+'\\n')}});`;
function sshArguments(value){const t=target(value);return ['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','ConnectTimeout=10','--',t.host,`${quote(t.node)} -e ${quote(BOOTSTRAP)}`];}
function transport(value,payload,{spawnProcess=spawn}={}){return new Promise((resolve,reject)=>{
 const chunks=[];let size=0,settled=false,spawned=false,child;const finish=(e,v)=>{if(settled)return;settled=true;clearTimeout(timer);e?reject(e):resolve(v);};
 const error=()=>Object.assign(new Error('SSH returned no confirmed receipt. Query the same runId; do not repeat start or an action.'),{code:'SSH_UNCONFIRMED',execution:'unknown'});
 const timer=setTimeout(()=>{child?.kill();finish(error());},25000);
 try{child=spawnProcess('ssh',sshArguments(value),{stdio:['pipe','pipe','ignore']});}catch(e){finish(Object.assign(error(),{execution:'not_executed'}));return;}
 child.on('spawn',()=>{spawned=true;});
 child.on('error',()=>finish(Object.assign(error(),{execution:spawned?'unknown':'not_executed'})));
 child.stdin.on('error',()=>{});child.stdout.on('data',b=>{size+=b.length;if(size>32*1024*1024){child.kill();finish(error());}else chunks.push(Buffer.from(b));});
 child.on('close',code=>{if(code!==0){finish(error());return;}try{const reply=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!reply.ok)finish(Object.assign(error(),{code:reply.errorCode,execution:reply.execution||'unknown'}));else finish(null,reply.data);}catch{finish(error());}});
 child.stdin.end(JSON.stringify(payload));
});}
class Remote{
 constructor(home,{send=transport}={}){this.home=home;this.send=send;}
 async call(t,request){const files=Object.fromEntries(FILES.map(name=>[name,fs.readFileSync(path.join(__dirname,name),'utf8')]));return this.send(target(t),{protocol:1,files,digest:crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'),request});}
 file(id){if(!UUID.test(id||''))fail('INVALID_REMOTE_ID','Use a runId from remote_plan.');return path.join(this.home,'remote-jobs',id,'local.json');}
 save(record){const file=this.file(record.runId);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});require('./core.cjs').atomic(file,record);}
 read(id){return JSON.parse(fs.readFileSync(this.file(id),'utf8'));}
 async invoke(method,args){
  if(['remote_catalog','remote_plan'].includes(method))return this.invokeUnlocked(method,args);
  const lock=path.join(path.dirname(this.file(args.runId)),'.request-lock'),owner=crypto.randomUUID()+'.json';
  const busy=()=>fail('REMOTE_REQUEST_BUSY','Another request is in progress. Wait for its receipt before querying the same run.');
  try{fs.mkdirSync(lock,{mode:0o700});}catch(e){
   if(e.code!=='EEXIST')throw e;
   // Remove only the exact dead owner's file. A racing replacement owner has
   // another name, so rmdir cannot remove its occupied lock directory.
   const names=fs.readdirSync(lock);let removed=names.length===0;
   for(const name of names){
    if(!/^[a-f0-9-]+\.json$/.test(name))busy();
    let previous;try{previous=JSON.parse(fs.readFileSync(path.join(lock,name),'utf8'));}catch{busy();}
    const {alive}=require('./core.cjs'),{identity}=require('./observation.cjs');
    if(alive(previous.pid)){const current=identity(previous.pid);if(!previous.identity||!current||current===previous.identity)busy();}
    try{fs.unlinkSync(path.join(lock,name));removed=true;}catch{busy();}
   }
   if(!removed)busy();try{fs.rmdirSync(lock);fs.mkdirSync(lock,{mode:0o700});}catch{busy();}
  }
  const ownerFile=path.join(lock,owner);
  try{fs.writeFileSync(ownerFile,JSON.stringify({pid:process.pid,identity:require('./observation.cjs').identity(process.pid)}),{flag:'wx',mode:0o600});}catch{busy();}
  try{
   if(fs.readdirSync(lock).some(name=>name!==owner))busy();
   return await this.invokeUnlocked(method,args);
  }finally{fs.unlinkSync(ownerFile);try{fs.rmdirSync(lock);}catch(e){if(!['ENOENT','ENOTEMPTY'].includes(e.code))throw e;}}

 }
 async invokeUnlocked(method,args){
  if(method==='remote_catalog')return this.call(args.target,{method:'catalog'});
  if(method==='remote_plan'){
   const t=target(args.target),plan=await this.call(t,{method:'plan',profile:args.profile,pr:args.pr,requirements:args.requirements||[]});
   const runId=crypto.randomUUID();this.save({runId,target:t,plan,planHash:hash(plan),state:'planned'});
   return {runId,target:t,plan,execution:'not_executed',nextAction:'Review this target, hardware, exact commit and B-local profile, then remote_start with this runId.'};
  }
  const record=this.read(args.runId),mutating=['remote_start','remote_action','remote_select_account','remote_stop'].includes(method);
  if(['remote_status','remote_stop'].includes(method)&&record.state==='start-rejected')return {runId:record.runId,state:'not-executed',execution:'not_executed',errorCode:record.errorCode,nextAction:'The target rejected this plan before starting. Inspect the reason and preview a new plan.'};
  if(mutating&&record.state==='unknown')fail('REMOTE_EXECUTION_UNKNOWN','First query remote_status with this runId. Do not blindly repeat remote operations.','unknown');
  if(method==='remote_action'&&record.state==='action-requested')fail('REMOTE_ACTION_PENDING','Query the previous action through remote_status before requesting another.');
  if(method==='remote_start'&&record.state!=='planned')fail('REMOTE_ALREADY_REQUESTED','Query remote_status using the same runId before any further action.');
  const previousState=record.state,request={method:method.replace('remote_',''),runId:record.runId,planHash:record.planHash};
  if(method==='remote_start'){request.plan=record.plan;record.state='start-requested';this.save(record);}
  else if(method==='remote_action'){
   if(!['prepare','verify'].includes(args.action))fail('INVALID_ACTION','Choose the project-configured prepare or verify action.');
   request.action=args.action;request.actionId=crypto.randomUUID();record.state='action-requested';record.actionId=request.actionId;this.save(record);
  }else if(method==='remote_select_account'){request.account=args.account;}
  else if(method==='remote_collect'){request.logs=args.logs===true;request.screenshot=args.screenshot===true;}
  else if(!['remote_status','remote_stop'].includes(method))fail('UNKNOWN_OPERATION','Unknown remote operation.');
  try{
   const result=await this.call(record.target,request);
   if(method==='remote_collect')return this.collect(record,result,args.outputDir);
   record.state=method==='remote_status'?result.state:record.state;record.lastReceipt=result;this.save(record);return result;
  }catch(e){if(mutating){record.state=e.execution==='not_executed'?(method==='remote_start'?'start-rejected':previousState):'unknown';record.errorCode=e.code||'SSH_UNCONFIRMED';this.save(record);}throw e;}
 }
 collect(record,result,outputDir){
  if(!Array.isArray(result.files)||result.files.length>8)fail('INVALID_ARTIFACTS','Invalid evidence manifest.','unknown');
  if(outputDir&&!path.isAbsolute(outputDir))fail('INVALID_PATH','Choose an absolute task output directory.');
  const names=new Set(),validated=[];
  for(const file of result.files){
   if(!file||!['result.json','build.log','app.log','inspection.png'].includes(file.name)||names.has(file.name)||typeof file.content!=='string'||file.content.length>24*1024*1024)fail('INVALID_ARTIFACTS','Unapproved or duplicate evidence file.','unknown');
   names.add(file.name);const bytes=Buffer.from(file.content,'base64');
   if(bytes.toString('base64')!==file.content||bytes.length>16*1024*1024||hash(bytes)!==file.sha256)fail('ARTIFACT_HASH_MISMATCH','Evidence did not match its manifest.','unknown');
   validated.push({file,bytes});
  }
  const root=outputDir?path.join(outputDir,`ssh-${record.runId}`):path.join(path.dirname(this.file(record.runId)),'artifacts');
  fs.mkdirSync(root,{recursive:true,mode:0o700});if(fs.lstatSync(root).isSymbolicLink())fail('UNSAFE_ARTIFACT_PATH','Artifact directory must not be a symbolic link.');
  const collection=crypto.randomUUID(),staging=path.join(root,'.'+collection),dir=path.join(root,collection),written=[];
  fs.mkdirSync(staging,{mode:0o700});
  try{
   for(const {file,bytes} of validated){
    fs.writeFileSync(path.join(staging,file.name),bytes,{flag:'wx',mode:0o600});written.push({name:file.name,path:path.join(dir,file.name),sha256:file.sha256,bytes:bytes.length});
   }
   fs.renameSync(staging,dir);
  }catch(e){fs.rmSync(staging,{recursive:true,force:true});throw e;}
  return {runId:record.runId,files:written,publication:'private-task-evidence; review/redact before PR publication',result:result.result};
 }
}
function hash(value){return crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');}
module.exports={Remote,target,sshArguments,BOOTSTRAP,hash,transport};
