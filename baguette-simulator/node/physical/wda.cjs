'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const {createHash,randomInt,randomUUID}=require('node:crypto');
const {fail}=require('./devices.cjs');
const SHA='98c8f7102768aa10530c9b124be39d66a06a146631708416348b88f2db1a56c3';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function runnerLocked(log){
  let file;
  try{
    file=await fs.open(log,'r');const {size}=await file.stat(),tail=Buffer.alloc(Math.min(size,16384));
    await file.read(tail,0,tail.length,Math.max(0,size-tail.length));
    return /device is locked|Unlock .+ to Continue|DeviceLocked/i.test(tail.toString());
  }catch{return false;}finally{await file?.close();}
}
function request(base,route,{body,deadline=Date.now()+15000,mutation=false}={}){
  if(deadline<=Date.now())return Promise.reject(fail('TIME_BUDGET_EXHAUSTED','操作时间已用尽，请先检查手机状态。'));
  return new Promise((resolve,reject)=>{
    const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));let sent=false;
    const req=http.request(new URL(route,base),{method:bytes?'POST':'GET',headers:bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{}},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024)req.destroy(Error('响应过大'));else chunks.push(chunk);});
      res.on('error',error=>req.destroy(error));
      res.on('end',()=>{try{
        const data=JSON.parse(Buffer.concat(chunks).toString());
        if(res.statusCode!==200||data.value?.error)throw Error(data.value?.message||`HTTP ${res.statusCode}`);
        resolve(data);
      }catch(e){reject(fail('DEVICE_CONTROL_FAILED',e.message,mutation&&sent?'unknown':'not_executed'));}});
    });
    const timer=setTimeout(()=>req.destroy(Error('真机控制响应超时，请检查手机画面。')),Math.min(30000,deadline-Date.now()));
    req.on('close',()=>clearTimeout(timer));req.on('error',e=>reject(Object.assign(fail('DEVICE_CONTROL_FAILED',e.message,mutation&&sent?'unknown':'not_executed'),{transport:true})));
    sent=true;req.end(bytes);
  });
}
function createWda({root,devices,run,children,spawnImpl=spawn}){
  const entries=new Map();
  const signing=require('./signing.cjs').createSigning({run,devices});
  const buildEnv={...process.env};
  // Host compiler include paths must not leak macOS headers into iphoneos.
  for(const key of ['CPATH','C_INCLUDE_PATH','CPLUS_INCLUDE_PATH','OBJC_INCLUDE_PATH'])delete buildEnv[key];
  function signal(child,signal){if(!child)return;try{if(child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{child.kill(signal);}}
  async function stop(child){
    if(!child||child.exitCode!==null&&child.exitCode!==undefined)return;
    let timer;const exited=new Promise(resolve=>child.once('close',resolve));
    signal(child,'SIGTERM');
    await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);clearTimeout(timer);
    if(child.exitCode===null&&child.signalCode===null){signal(child,'SIGKILL');await Promise.race([exited,pause(1000)]);}
  }
  const state=id=>{const e=entries.get(id);return e?{state:e.state,phase:e.phase,job:e.job,ready:e.state==='ready',...(e.error?{error:e.error}:{}),...(e.log?{logPath:e.log}:{})}:{state:'disconnected',ready:false};};
  async function start(d,p={}){
    const existing=entries.get(d.udid);
    if(existing?.state==='running'||existing?.state==='ready')return {udid:d.udid,...state(d.udid)};
    if(existing)await disconnect(d.udid);
    if(!d.developerMode)throw fail('DEVELOPER_MODE_REQUIRED','请在 iPhone 设置 → 隐私与安全性中开启开发者模式，并在 Xcode 中完成设备准备。');
    p={...p,teamId:await signing.resolve(d,p)};
    devices.endpoint(d,8100);
    const e={state:'running',phase:'building',job:randomUUID(),port:randomInt(20000,50000),tunnelAddress:d.tunnelAddress,session:null,process:null,cancelled:false};entries.set(d.udid,e);
    e.pending=prepare(d,p,e).catch(async error=>{if(!e.cancelled){e.state='failed';e.phase='failed';e.error={code:error.code||'DEVICE_SETUP_FAILED',message:error.message,execution:error.execution||'unknown'};}await stop(e.process);}).finally(()=>{e.pending=null;});
    return {udid:d.udid,...state(d.udid)};
  }
  async function prepare(d,p,e){
    const work=path.join(root,'wda',d.udid),source=path.join(work,'source'),derived=path.join(work,'build');
    const archive=path.join(__dirname,'../../vendor/wda/source.tar.gz');
    if(createHash('sha256').update(await fs.readFile(archive)).digest('hex')!==SHA)throw fail('SOURCE_INVALID','真机控制组件校验失败，请重新安装插件。');
    await fs.mkdir(source,{recursive:true,mode:0o700});
    const patch=path.join(__dirname,'../../native/wda-network.patch'),stamp=path.join(work,'source-version'),version=SHA+':'+createHash('sha256').update(await fs.readFile(patch)).digest('hex');
    // Preserve source timestamps so reconnect does not recompile every file.
    // Xcode still checks/builds/signs the selected source on each connection.
    if(await fs.readFile(stamp,'utf8').catch(()=>'')!==version){
      await run('/usr/bin/tar',['-xzf',archive,'-C',source,'--strip-components=1'],{timeout:15000});
      await run('/usr/bin/patch',['-d',source,'-p1','--batch','-i',patch],{timeout:5000});
      await fs.writeFile(stamp,version,{mode:0o600});
    }
    const bundle=`com.makecindy.WebDriverAgent.${p.teamId.toLowerCase()}`;
    const args=['-quiet','-project',path.join(source,'WebDriverAgent.xcodeproj'),'-scheme','WebDriverAgentRunner','-destination',`id=${d.hardwareUdid}`,'-derivedDataPath',derived,
      `DEVELOPMENT_TEAM=${p.teamId}`,'CODE_SIGN_STYLE=Automatic','CLANG_ENABLE_EXPLICIT_MODULES=NO','GCC_TREAT_WARNINGS_AS_ERRORS=NO',`PRODUCT_BUNDLE_IDENTIFIER=${bundle}`,'-allowProvisioningUpdates'];
    e.log=path.join(work,'runner.log');
    // Build and test follow a connect or direct input action. Xcode owns credentials and
    // provisioning; no keys or Apple account data are read or copied here.
    const buildLog=await fs.open(path.join(work,'build.log'),'w',0o600);
    try{await new Promise((resolve,reject)=>{
      if(e.cancelled)return resolve();
      const child=spawnImpl('/usr/bin/xcodebuild',[...args,'build-for-testing'],{env:buildEnv,detached:true,stdio:['ignore',buildLog.fd,buildLog.fd]});e.process=child;children.add(child);
      const timer=setTimeout(()=>signal(child,'SIGKILL'),240000);
      child.once('error',reject);child.once('close',code=>{clearTimeout(timer);children.delete(child);if(e.process===child)e.process=null;code===0||e.cancelled?resolve():reject(fail('BUILD_FAILED',`控制组件构建失败，请检查 ${path.join(work,'build.log')}，确认 Xcode 登录、团队签名和设备注册。`,'unknown'));});
    });}finally{await buildLog.close();}
    if(e.cancelled)return;
    e.phase='connecting';const log=await fs.open(e.log,'w',0o600);
    try{e.process=spawnImpl('/usr/bin/xcodebuild',[...args,`USE_PORT=${e.port}`,`USE_IP=${d.tunnelAddress}`,`WDA_PRODUCT_BUNDLE_IDENTIFIER=${bundle}`,'test-without-building'],{env:buildEnv,detached:true,stdio:['ignore',log.fd,log.fd]});}finally{await log.close();}
    children.add(e.process);e.process.on('error',error=>{e.error={code:'RUNNER_FAILED',message:error.message};e.state='failed';});
    e.process.on('exit',()=>{children.delete(e.process);if(e.state!=='disconnected'){e.state='failed';e.error ||= {code:'RUNNER_STOPPED',message:'真机控制组件已停止。请检查 runner.log，解锁手机后重新连接。'};}});
    const deadline=Date.now()+90000;
    while(!e.cancelled&&e.state==='running'&&Date.now()<deadline){
      try{
        const current=await devices.target({udid:d.udid}),base=devices.endpoint(current,e.port);
        await request(base,'/status',{deadline:Date.now()+2000});
        const session=await request(base,'/session',{body:{capabilities:{alwaysMatch:{shouldUseCompactResponses:false,waitForIdleTimeout:0}}},mutation:true,deadline:Date.now()+15000});
        const id=session.sessionId||session.value?.sessionId;
        if(typeof id!=='string'||!/^[a-z0-9-]+$/i.test(id))throw fail('INVALID_SESSION','控制组件未返回有效会话。','unknown');
        // Interactive viewing must not wait for app animations to settle after
        // each gesture: that blocks the same main queue serving preview frames.
        await request(base,`/session/${id}/appium/settings`,{body:{settings:{animationCoolOffTimeout:0}},mutation:true,deadline:Date.now()+5000});
        if(e.cancelled)return;
        e.session=id;e.state='ready';e.phase='ready';return;
      }catch(error){if(error.execution==='unknown')throw error;if(await runnerLocked(e.log))e.phase='waiting_unlock';}
      await pause(1000);
    }
    if(!e.cancelled)throw e.phase==='waiting_unlock'
      ?fail('PHONE_LOCKED','手机锁屏导致控制未能启动。请解锁并保持亮屏，再点击手机画面连接控制。','not_executed')
      :fail('RUNNER_NOT_READY','真机控制未就绪。请解锁手机、信任开发者证书，并检查 runner.log。','unknown');
  }
  async function call(d,route,p={},body){
    const e=entries.get(d.udid);if(e?.state!=='ready')throw fail('DEVICE_CONTROL_NOT_CONNECTED','请操作手机画面以准备控制，或调用 device action=connect 并等待 connect_status 就绪。');
    if(d.tunnelAddress!==e.tunnelAddress){e.state='failed';e.phase='failed';e.error={code:'DEVICE_TUNNEL_CHANGED',message:'手机调试连接已变化，请重新连接控制。'};throw fail(e.error.code,e.error.message);}
    const base=devices.endpoint(d,e.port);
    try{return (await request(base,`/session/${e.session}${route}`,{body,deadline:p._deadline,mutation:body!==undefined})).value;}
    catch(error){if(error.transport){e.state='failed';e.phase='failed';e.error={code:error.code,message:'手机控制连接已中断；画面仍可查看，下次操作会重新准备控制。'};}throw error;}
  }
  async function disconnect(id){const e=entries.get(id);if(e){e.cancelled=true;e.state='disconnected';e.phase='disconnected';delete e.error;await stop(e.process);await e.pending;}return {udid:id,execution:'executed',control:state(id)};}
  return {start,state,call,disconnect,pending:id=>id?entries.get(id)?.pending:[...entries.values()].find(e=>e.pending)?.pending,
    async close(){await Promise.all([...entries.keys()].map(disconnect));}};
}
module.exports={createWda,request,runnerLocked};
