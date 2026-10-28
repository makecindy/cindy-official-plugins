const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const dir=path.resolve('baguette-simulator/node');
const udid='00000000-0000-4000-8000-000000000001';
test('environment reports keyboard ABI failures separately from usable device catalogs',async()=>{
 for(const ready of [true,false]){
  const commands=[],context={module:{exports:{}},__dirname:dir,process:{platform:'darwin',arch:'arm64',env:{DEVELOPER_DIR:'/Selected/Xcode/Contents/Developer'}},require(name){
   if(name==='./viewer.cjs')return {};
   if(name==='./android/index.cjs')return {createAndroid:()=>({dispatch:async()=>({ready:false,runtimes:[],deviceTypes:[]})})};
   if(name==='node:child_process')return {execFile(file,args,_options,cb){
    commands.push({file,args});let output='',error=null;
    if(file.endsWith('sw_vers'))output='27.0';
    if(file.endsWith('xcodebuild'))output='Xcode fixture';
    if(args.includes('runtimes'))output=JSON.stringify({runtimes:[{isAvailable:true,name:'iOS',identifier:'com.apple.CoreSimulator.SimRuntime.iOS-27-0',version:'27.0'}]});
    if(args.includes('devicetypes'))output=JSON.stringify({devicetypes:[{name:'iPhone',identifier:'phone',productFamily:'iPhone'}]});
    if(args[0]==='--check'){output=JSON.stringify({ready,scope:'keyboard-abi'});if(!ready)error=Error('missing keyboard interface');}
    queueMicrotask(()=>cb(error,output,''));return {stdin:{on(){},end(){}}};
   }};
   return require(name.startsWith('./')?path.join(dir,name):name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
  const result=await context.module.exports.dispatch('environment');
  assert.equal(result.platforms.ios.ready,true);assert.equal(result.runtimes.length,1);assert.equal(result.deviceTypes.length,1);
  assert.equal(result.diagnostics.keyboard.ready,ready);
  assert.equal(result.diagnostics.keyboard.developerDir,'/Selected/Xcode/Contents/Developer');
  assert.deepEqual(Array.from(commands.find(c=>c.args[0]==='--check').args),['--check','/Selected/Xcode/Contents/Developer']);
  assert.ok(!commands.some(c=>c.args.includes('boot')||c.args.includes('spawn')||c.args.includes('--set')));
 }
});
function core(output,failAt=Infinity,macOS="15.0",catalog=[]){
 let polls=0,mutations=0;const commands=[],budgets=[];
 const context={module:{exports:{}},__dirname:dir,process:{platform:'darwin',arch:'arm64'},setTimeout:fn=>fn(),require(name){
  if(name==='./viewer.cjs')return {};
  // These are Apple host fixtures. Never discover the developer's real AVDs.
  if(name==='./android/index.cjs')return {createAndroid:()=>({owns:async()=>false,dispatch:async()=>({devices:[]})})};
  if(name==='node:fs/promises')return {mkdir:async()=>{}};
  if(name==='node:child_process')return {execFile(file,args,opts,cb){
   commands.push(file);budgets.push(opts.timeout);let data='',error=null;
   if(file==='/usr/bin/sw_vers')data=macOS;
   else if(args.includes('--json'))data=JSON.stringify(args.includes('runtimes')?{runtimes:catalog}:{devices:{runtime:[{udid,state:'Booted'}]}});
   else if(args[0]==='describe-ui')data=output;
   else if(args.includes('list')){polls++;if(polls===failAt)error=Error('simctl timeout');data=(polls===1?'100':'200')+' 0 com.apple.SpringBoard';}
   else mutations++;
   queueMicrotask(()=>cb(error,data,''));return {stdin:{on(){},end(){}}};
  }};
  return require(name.startsWith('./')?path.join(dir,name):name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
 return {dispatch:context.module.exports.dispatch,mutations:()=>mutations,commands,budgets};
}
test('describe_ui needs screen geometry and a successful AX or OCR read before returning elements',async()=>{
 for(const value of ['invalid','null','{}','{"children":[]}']) {
  await assert.rejects(core(value).dispatch('describe_ui',{udid}),e=>e.code==='SCREEN_UNAVAILABLE');
 }
 const screen={width:402,height:874,orientation:'portrait'};
 // This command fixture has no screenshot renderer or Vision response. Its
 // empty AX tree must expose that failure rather than claim no visible text.
 await assert.rejects(core(JSON.stringify({role:'AXApplication',frame:{x:0,y:0,width:402,height:874},screen,children:[]})).dispatch('describe_ui',{udid}));
 const tree={role:'AXApplication',frame:{x:0,y:0,width:402,height:874},screen,children:[{role:'AXButton',label:'Google',frame:{x:100,y:200,width:80,height:40},children:[]}]};
 const ui=await core(JSON.stringify(tree)).dispatch('describe_ui',{udid});
 assert.deepEqual(ui.elements,[{i:0,role:'button',label:'Google',frame:[100,200,80,40],center:[140,220]}]);
 assert.deepEqual(ui.screen,{width:402,height:874,orientation:'portrait'});
});
test('screenshot exports distinguish unstarted writes, uncertain writes and completed writes despite cleanup failures',async()=>{
 for(const destination of ['desktop','clipboard'])for(const phase of ['preflight','capture','export','budget','success'])for(const cleanupFails of [false,true]){
  let clock=0,clipboard='old',desktop=false;const commands=[];
  const context={module:{exports:{}},__dirname:dir,process:{platform:'darwin',arch:'arm64'},require(name){
   if(name==='./viewer.cjs')return {};
   if(name==='./budget.cjs')return {commandBudget:(timeout,deadline)=>require(path.join(dir,'budget.cjs')).commandBudget(timeout,deadline,()=>clock)};
   if(name==='./agent.cjs')return {createAgent:({Failure})=>({nativeScreenshot:async(device,deadline,orientation)=>{
    assert.equal(device.udid,udid);assert.equal(deadline,1000);
    assert.equal(orientation,'landscape-left');
    if(phase==='capture')throw new Failure('SCREEN_CHANGED','Screen turned during capture');
    if(phase==='budget')clock=1000;
    return {path:'/upright.png'};
   }})};
   if(name==='node:fs/promises')return {mkdir:async()=>{},access:async()=>{throw Error('absent');},stat:async()=>({size:10}),
    copyFile:async source=>{assert.equal(source,'/upright.png');desktop=true;if(phase==='export')throw Error('copy failed');},
    rm:async()=>{if(cleanupFails)throw Error('cleanup failed');}};
   if(name==='node:child_process')return {execFile(file,args,_options,callback){
    commands.push({file,args});let data='',error=null;
    if(file==='/usr/bin/sw_vers'){data='27.0';if(phase==='preflight')error=Error('preflight failed');}
    else if(args.includes('--json'))data=JSON.stringify({devices:{runtime:[{udid,name:'Phone',state:'Booted'}]}});
    else if(file==='/usr/bin/osascript'){assert.equal(args.at(-1),'/upright.png');clipboard='new';if(phase==='export')error=Error('clipboard write timed out');}
    queueMicrotask(()=>callback(error,data,''));return {stdin:{on(){},end(){}}};
   }};
   return require(name.startsWith('./')?path.join(dir,name):name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
  const pending=context.module.exports.dispatch('screenshot',{udid,destination,orientation:'landscape-left'},1000);
  const succeeds=phase==='success';
  if(succeeds){const result=await pending;assert.equal(result.execution,'executed');if(destination==='clipboard')assert.equal(result.copied,true);}
  else await assert.rejects(pending,error=>error.execution===(phase==='export'?'unknown':'not_executed'));
  assert.equal(clipboard, destination==='clipboard'&&['export','success'].includes(phase)?'new':'old');
  assert.equal(desktop,destination==='desktop'&&['export','success'].includes(phase));
  assert.ok(commands.filter(c=>c.file==='/usr/bin/osascript').length<=1,'cleanup failure never repeats the export');
 }
});

test('heal distinguishes preflight failure from post-restart polling failure',async()=>{
 const before=core('',1);await assert.rejects(before.dispatch('heal',{udid}),e=>e.execution==='not_executed');assert.equal(before.mutations(),0);
 const after=core('',2);await assert.rejects(after.dispatch('heal',{udid}),e=>e.execution==='unknown');assert.equal(after.mutations(),2);
 assert.equal((await core('').dispatch('heal',{udid})).execution,'executed');
});

test('macOS minimum is checked before any simulator or bundled binary runs',async()=>{
 for(const version of ['14.7.6','13.6','unknown','']){
  const c=core('',Infinity,version);
  const result=await c.dispatch('devices');assert.equal(result.platformErrors.find(e=>e.platform==='ios').code,'UNSUPPORTED_OS');
  assert.deepEqual(c.commands,['/usr/bin/sw_vers']);
 }
 for(const version of ['15.0','15.7.1','26.0','27.0']){
  const c=core('',Infinity,version);await c.dispatch('devices');
  assert.deepEqual(c.commands,['/usr/bin/sw_vers','/usr/bin/xcrun']);
 }
});

test('invalid paste text never reaches key release or clipboard mutation',async()=>{
 for(const text of ['', 'a'.repeat(8001), 'before\0after']) {
  const c=core('');await assert.rejects(c.dispatch('type_text',{udid,text}),e=>e.code==='INVALID_ARGUMENT'&&e.execution==='not_executed');
  assert.equal(c.mutations(),0);
  assert.ok(c.commands.every(file=>file==='/usr/bin/sw_vers'||file==='/usr/bin/xcrun'));
 }
});

test('touch input rejects clear and keys before sending any keyboard or clipboard event',async()=>{
 for(const extra of [{clear:true},{keys:'Enter'},{keys:[]}]) {
  const c=core('');
  await assert.rejects(c.dispatch('type_text',{udid,text:'test',method:'touch',...extra}),e=>e.code==='INVALID_ARGUMENT'&&e.execution==='not_executed');
  assert.equal(c.mutations(),0);
 }
});

test('boot and heal complete command budgets fit the Host bridge ceiling',async()=>{
 const boot=core('');await boot.dispatch('boot',{udid});
 // Booted fixture skips the optional 15-second cold boot command.
 assert.equal(boot.budgets.reduce((a,b)=>a+b,0)+15000,113000);
 const heal=core('');await heal.dispatch('heal',{udid});
 // The polling window permits up to 25s plus one last 5s command.
 assert.ok(heal.budgets.slice(0,-1).reduce((a,b)=>a+b,0)+30500<120000);
});

test('boot and launch retain completed results when settling and screenshots consume the request deadline',async()=>{
 for(const method of ['boot','launch_app'])for(const slow of [false,true]){
  let clock=0;const observations=[];
  const {commandBudget}=require(path.join(dir,'budget.cjs'));
  const context={module:{exports:{}},__dirname:dir,Date:{now:()=>clock},process:{platform:'darwin',arch:'arm64',env:{}},
   require(name){
    if(name==='./budget.cjs')return {commandBudget:(timeout,deadline)=>commandBudget(timeout,deadline,()=>clock)};
    if(name==='./viewer.cjs')return {openViewer:async()=>{if(slow)clock+=15000;return {ready:true};}};
    if(name==='./apps.cjs')return {createApps:()=>({runningFor:()=>null})};
    if(name==='./agent.cjs')return {createAgent:()=>({forget(){},
     settle:async(_d,p)=>{observations.push(['settle',p.deadline]);if(slow)clock+=p.timeout;return {settled:true};},
     screenshot:async(_d,p)=>{observations.push(['shot',p._deadline]);if(slow){clock+=commandBudget(120000,p._deadline,()=>clock).timeout;}commandBudget(20000,p._deadline,()=>clock);return {path:'/shot.jpg'};}})};
    if(name==='node:child_process')return {execFile(file,args,opts,cb){
     let data='',cost=0;
     if(file==='/usr/bin/sw_vers'){data='27.0';cost=3000;}
     else if(args.includes('--json')){data=JSON.stringify({devices:{r:[{udid,state:method==='boot'?'Shutdown':'Booted'}]}});cost=5000;}
     else if(args[0]==='boot')cost=14999;
     else if(args.includes('bootstatus')||args.includes('launch'))cost=85000;
     else if(args.includes('defaults'))cost=10000;
     if(slow)clock+=Math.min(cost,opts.timeout);
     queueMicrotask(()=>cb(null,data,''));return {stdin:{on(){},end(){}}};
    }};
    return require(name.startsWith('./')?path.join(dir,name):name);
   }};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
  const result=await context.module.exports.dispatch(method,{udid,bundleId:'test.example.app',screenshot:true,_deadline:Infinity});
  assert.equal(result.execution,'executed');
  assert.ok(slow?result.screenshot.error:result.screenshot.path);
  assert.ok(clock<=110000);
  assert.ok(observations.length>0&&observations.every(([,deadline])=>deadline===110000),'caller input cannot renew the core deadline');
 }
});

test('rename only accepts an owned device and a bounded non-option name',async()=>{
 for(const name of ['', '  ', '-option', 'name\nline', 'a'.repeat(81)]){
  const c=core('');await assert.rejects(c.dispatch('rename_device',{udid,name}),e=>e.code==='INVALID_ARGUMENT');assert.equal(c.mutations(),0);
 }
 const c=core('');await assert.rejects(c.dispatch('rename_device',{udid:'00000000-0000-4000-8000-000000000002',name:'Phone'}),e=>e.code==='DEVICE_NOT_OWNED');assert.equal(c.mutations(),0);
 assert.equal((await c.dispatch('rename_device',{udid,name:'测试 Phone'})).execution,'executed');assert.equal(c.mutations(),1);
});

test('app reuse obtains only an owned app container, never a data container or runtime copy',async()=>{
 const set=path.join(require('node:os').homedir(),'Library/Application Support/BaguetteCindy/devices');
 for(const appPath of [path.join(set,udid,'data/Containers/Bundle/Application/test/App.app'),'/RuntimeRoot/Applications/Settings.app']){
  const calls=[];
  const context={module:{exports:{}},__dirname:dir,process:{platform:'darwin',arch:'arm64'},require(name){
   if(name==='./viewer.cjs')return {};
   if(name==='node:fs/promises')return {mkdir:async()=>{},realpath:async p=>p,stat:async()=>({isDirectory:()=>true})};
   if(name==='node:child_process')return {execFile(file,args,opts,cb){calls.push(args);let data='';if(file==='/usr/bin/sw_vers')data='27.0';else if(args.includes('--json'))data=JSON.stringify({devices:{runtime:[{udid,state:'Booted'}]}});else if(args.includes('get_app_container'))data=appPath;queueMicrotask(()=>cb(null,data,''));return {stdin:{on(){},end(){}}};}};
   return require(name.startsWith('./')?path.join(dir,name):name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
  const result=await context.module.exports.dispatch('app_bundle',{udid,bundleId:'test.example.app'});
  assert.equal(result.appPath,appPath.startsWith(set)?appPath:null);
  const request=calls.find(args=>args.includes('get_app_container'));assert.deepEqual(Array.from(request),['simctl','--set',set,'get_app_container',udid,'test.example.app','app']);
 }
});


test('create rejects a runtime/model mismatch before mutation even when version ranges would allow it',async()=>{
 const runtime='com.apple.CoreSimulator.SimRuntime.iOS-27-1',deviceType='com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro';
 const catalog=[{identifier:runtime,isAvailable:true,supportedDeviceTypes:[{identifier:'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo'}]}];
 const mismatch=core('',Infinity,'27.0',catalog);await assert.rejects(mismatch.dispatch('create_device',{name:'Phone',runtime,deviceType}),e=>e.code==='DEVICE_RUNTIME_MISMATCH'&&e.execution==='not_executed');assert.equal(mismatch.mutations(),0);
 const missing=core('');await assert.rejects(missing.dispatch('create_device',{name:'Phone',runtime,deviceType}),e=>e.code==='RUNTIME_UNAVAILABLE');assert.equal(missing.mutations(),0);
 const supported=core('',Infinity,'27.0',[{identifier:runtime,isAvailable:true,supportedDeviceTypes:[{identifier:deviceType}]}]);assert.equal((await supported.dispatch('create_device',{name:'Phone',runtime,deviceType})).execution,'executed');assert.equal(supported.mutations(),1);
});

test('device management: unique names, delete and erase stop the device first, reveal only known screenshots',async()=>{
 // Real case: three "iPhone 11" devices in a row; no way to delete one.
 const {uniqueName}=require(path.join(dir,'core.cjs'));
 assert.equal(uniqueName('iPhone 18 Pro',['iPad']),'iPhone 18 Pro');
 assert.equal(uniqueName('iPhone 18 Pro',['iphone 18 pro','iPhone 18 Pro 2']),'iPhone 18 Pro 3');
 for(const method of ['delete_device','erase_device']){
  const calls=[];
  const context={module:{exports:{}},__dirname:dir,process:{platform:'darwin',arch:'arm64'},require(name){
   if(name==='./viewer.cjs')return {};
   if(name==='node:fs/promises')return {mkdir:async()=>{}};
   if(name==='node:child_process')return {execFile(file,args,opts,cb){calls.push([file.split('/').pop(),...args]);let data='';
    if(file==='/usr/bin/sw_vers')data='27.0';else if(args.includes('--json'))data=JSON.stringify({devices:{runtime:[{udid,state:'Booted',name:'Phone'}]}});
    queueMicrotask(()=>cb(null,data,''));return {stdin:{on(){},end(){}}};}};
   return require(name.startsWith('./')?path.join(dir,name):name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
  const r=await context.module.exports.dispatch(method,{udid});
  assert.equal(r.execution,'executed');
  const shutdown=calls.findIndex(c=>c[0]==='Baguette'&&c[1]==='shutdown'),remove=calls.findIndex(c=>c.includes(method==='delete_device'?'delete':'erase'));
  assert.ok(shutdown>=0&&remove>shutdown,'stopped before '+method);
  assert.deepEqual(calls[remove].slice(1,3),['simctl','--set']);assert.equal(calls[remove].at(-1),udid);
  await assert.rejects(context.module.exports.dispatch('reveal_screenshot',{path:'/etc/passwd'}),e=>e.code==='INVALID_ARGUMENT');
  assert.ok(!calls.some(c=>c[0]==='open'));
 }
});
test('a clipboard screenshot puts the PNG on the pasteboard by path argument and keeps no file',async()=>{
 const calls=[],removed=[];
 const file='/screenshots/upright.png';
 const context={module:{exports:{}},__dirname:dir,process:{platform:'darwin',arch:'arm64'},require(name){
  if(name==='./viewer.cjs')return {};
  if(name==='./agent.cjs')return {createAgent:()=>({nativeScreenshot:async()=>({path:file})})};
  if(name==='node:fs/promises')return {mkdir:async()=>{},stat:async()=>({size:1234}),rm:async(f)=>{removed.push(f);}};
  if(name==='node:child_process')return {execFile(file,args,opts,cb){calls.push([file.split('/').pop(),...args]);let data='';
   if(file==='/usr/bin/sw_vers')data='27.0';else if(args.includes('--json'))data=JSON.stringify({devices:{runtime:[{udid,state:'Booted',name:'Phone'}]}});
   queueMicrotask(()=>cb(null,data,''));return {stdin:{on(){},end(){}}};}};
  return require(name.startsWith('./')?path.join(dir,name):name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
 const r=await context.module.exports.dispatch('screenshot',{udid,destination:'clipboard'});
 assert.equal(r.copied,true);assert.equal(r.path,undefined);
 const osa=calls.find(c=>c[0]==='osascript');
 assert.equal(osa.at(-1),file,'the path is passed as an argument, never spliced into the script');
 assert.ok(!osa.slice(1,-1).some(a=>a.includes(file)));
 assert.deepEqual(removed,[file]);
});

test('a flat clipboard export consumes the renderer receipt without another command or file read',async()=>{
 const calls=[];
 const context={module:{exports:{}},__dirname:dir,process:{platform:'darwin',arch:'arm64'},require(name){
  if(name==='./viewer.cjs')return {};
  if(name==='./agent.cjs')return {createAgent:()=>({nativeScreenshot:async(device,_deadline,orientation,clipboard)=>{
   assert.equal(device.udid,udid);assert.equal(orientation,'landscape-left');assert.equal(clipboard,true);
   return {copied:true,bytes:1234};
  }})};
  if(name==='node:fs/promises')return {mkdir:async()=>{}};
  if(name==='node:child_process')return {execFile(file,args,_opts,cb){calls.push(file);let data='';
   if(file==='/usr/bin/sw_vers')data='27.0';else if(args.includes('--json'))data=JSON.stringify({devices:{runtime:[{udid,state:'Booted'}]}});
   queueMicrotask(()=>cb(null,data,''));return {stdin:{on(){},end(){}}};}};
  return require(name.startsWith('./')?path.join(dir,name):name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
 const r=await context.module.exports.dispatch('screenshot',{udid,destination:'clipboard',orientation:'landscape-left'});
 assert.equal(r.copied,true);assert.equal(r.bytes,1234);assert.equal(r.execution,'executed');assert.equal(r.path,undefined);
 assert.deepEqual(calls,['/usr/bin/sw_vers','/usr/bin/xcrun']);
});

test('erase and delete share preflight and shutdown time, never start a late mutation, and retain shutdown evidence',async()=>{
 for(const method of ['erase_device','delete_device'])for(const deviceState of ['Booted','Shutdown'])for(const mode of ['success','shutdown-timeout','expired-after-shutdown','removal-timeout']){
  if(deviceState==='Shutdown'&&['shutdown-timeout','expired-after-shutdown'].includes(mode))continue;
  let clock=0;const calls=[];const deadline=mode==='expired-after-shutdown'?58000:110000;
  const {commandBudget}=require(path.join(dir,'budget.cjs'));
  const context={module:{exports:{}},__dirname:dir,Date:{now:()=>clock},process:{platform:'darwin',arch:'arm64'},require(name){
   if(name==='./budget.cjs')return {commandBudget:(timeout,limit)=>commandBudget(timeout,limit,()=>clock)};
   if(name==='./viewer.cjs')return {};
   if(name==='node:fs/promises')return {mkdir:async()=>{}};
   if(name==='node:child_process')return {execFile(file,args,options,cb){
    const left=deadline-clock;assert.ok(options.timeout>0&&options.timeout<=left);
    const shutting=args[0]==='shutdown',removing=args.includes('erase')||args.includes('delete');
    calls.push({args,timeout:options.timeout});
    let cost=0,data='',error=null;
    if(file==='/usr/bin/sw_vers'){cost=3000;data='27.0';}
    else if(args.includes('--json')){cost=5000;data=JSON.stringify({devices:{r:[{udid,state:deviceState}]}});}
    else if(shutting)cost=mode==='shutdown-timeout'?70000:mode==='expired-after-shutdown'?50000:55000;
    else if(removing)cost=mode==='removal-timeout'?120000:1000;
    clock+=Math.min(cost,options.timeout);
    if(cost>options.timeout)error=Error('command killed at deadline');
    queueMicrotask(()=>cb(error,data,''));return {stdin:{on(){},end(){}}};
   }};
   return require(name.startsWith('./')?path.join(dir,name):name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
  const result=await context.module.exports.dispatch(method,{udid},deadline).catch(e=>e);
  assert.ok(clock<=deadline);
  const remove=calls.find(c=>c.args.includes('erase')||c.args.includes('delete'));
  if(mode==='success')assert.equal(result.execution,'executed');
  else {
   assert.equal(result.execution,'unknown');
   if(mode==='expired-after-shutdown'){assert.equal(remove,undefined);assert.match(result.message,/Shutdown completed; .*was not started/);}
   if(mode==='shutdown-timeout')assert.equal(remove,undefined);
   if(mode==='removal-timeout')assert.ok(remove);
  }
  if(remove)assert.equal(remove.timeout,deviceState==='Booted'?47000:102000);
 }
});

test('remote trackpad rejects iOS and unowned devices before native input',async()=>{
 for(const [id,code] of [[udid,'UNSUPPORTED_INPUT'],['00000000-0000-4000-8000-000000000002','DEVICE_NOT_OWNED']]){
  const c=core('');await assert.rejects(c.dispatch('viewer_trackpad',{udid:id,phase:'began',x:.5,y:.5,gesture:udid}),e=>e.code===code);assert.equal(c.mutations(),0);
 }
});

test('native hold timeouts request release and retain unknown outcome, without changing unrelated command termination',async()=>{
 const calls=[];
 const context={module:{exports:{}},__dirname:dir,process:{platform:'darwin',arch:'arm64'},require(name){
  if(name==='./viewer.cjs')return {};
  if(name==='node:child_process')return {execFile(file,args,options,cb){calls.push({file,options});queueMicrotask(()=>cb(Error('timed out'),'',''));return {stdin:{on(){},end(){}}};}};
  return require(name.startsWith('./')?path.join(dir,name):name);
 }};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
 const run=vm.runInContext('run',context);
 for(const [file,signal] of [[path.join(dir,'../native/remote'),'SIGTERM'],[path.join(dir,'../native/spatial'),'SIGTERM'],['/usr/bin/xcrun','SIGKILL']]){
  await assert.rejects(run(file,[],{timeout:500,mutation:true}),e=>e.execution==='unknown');
  assert.equal(calls.at(-1).options.killSignal,signal);assert.equal(calls.at(-1).options.timeout,500);
 }
});
