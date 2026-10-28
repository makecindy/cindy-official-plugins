const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), syncFs = require('node:fs');
const os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {execFile} = require('node:child_process');
const exec = require('node:util').promisify(execFile);
const dir = path.resolve('baguette-simulator/node');
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
class Failure extends Error { constructor(code,message,execution='not_executed') {super(message);Object.assign(this,{code,execution});} }
const missingContainer = () => new Failure('COMMAND_FAILED', 'xcrun: An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=2):\nNo such file or directory');
async function temporary(t) {const root=await fs.mkdtemp(path.join(os.tmpdir(),'bag-review-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('bundle comparison detects equal-size equal-time resource changes; registration changes use installd', async t => {
  const root=await temporary(t), source=path.join(root,'Build.app'), installed=path.join(root,'Installed.app');
  const info={CFBundleSupportedPlatforms:['iPhoneSimulator'],CFBundleIdentifier:'test.example.game',CFBundleExecutable:'Game',CFBundleVersion:'1'};
  for(const folder of [source,installed]) {
    await fs.mkdir(folder);await fs.writeFile(path.join(folder,'Info.plist'),JSON.stringify(info));
    await fs.writeFile(path.join(folder,'Game'),'executable');await fs.writeFile(path.join(folder,'asset'),'old');
  }
  const stamp=new Date('2026-01-01T00:00:00Z');
  await fs.writeFile(path.join(source,'asset'),'new');
  for(const folder of [source,installed]) await fs.utimes(path.join(folder,'asset'),stamp,stamp);
  let full=0, terminateError=null, syncWrites=0;
  const apps=require(path.join(dir,'apps.cjs')).createApps({Failure,
    sim:async args=>{if(args[0]==='get_app_container')return {stdout:installed};if(args[0]==='install'){full++;await fs.cp(source,installed,{recursive:true});}return {stdout:''};},
    run:async(file,args)=>{
      if(file.endsWith('plutil'))return {stdout:await fs.readFile(args.at(-1),'utf8')};
      if(!args.includes('--dry-run'))syncWrites++;
      return exec(file,args);
    }});
  const device={udid:A}, terminate=async()=>{if(terminateError)throw terminateError;};
  assert.equal((await apps.info(device,{appPath:source})).matchesLocal,false);
  terminateError=new Failure('COMMAND_FAILED','device is unresponsive','unknown');
  await assert.rejects(apps.install(device,{appPath:source},{terminate}),e=>e.execution==='unknown');
  assert.equal(syncWrites,0);assert.equal(await fs.readFile(path.join(installed,'asset'),'utf8'),'old');
  // Confirmed "not running" is the only termination failure that permits sync.
  terminateError=new Failure('COMMAND_FAILED','No matching processes','unknown');
  assert.equal((await apps.install(device,{appPath:source},{terminate})).mode,'sync');
  assert.equal((await apps.info(device,{appPath:source})).matchesLocal,true);
  assert.equal(await fs.readFile(path.join(installed,'asset'),'utf8'),'new');
  assert.equal(full,0);
  await fs.mkdir(path.join(source,'PlugIns','Extension.appex'),{recursive:true});
  await fs.writeFile(path.join(source,'PlugIns','Extension.appex','Info.plist'),JSON.stringify({CFBundleIdentifier:'test.example.extension'}));
  assert.equal((await apps.install(device,{appPath:source},{terminate})).mode,'full');assert.equal(full,1);
  await fs.writeFile(path.join(source,'Info.plist'),JSON.stringify({...info,CFBundleURLTypes:[{CFBundleURLSchemes:['testgame']}]}));
  const job=await apps.install(device,{appPath:source},{terminate});assert.equal(job.mode,'full');assert.equal(full,2);
  await assert.rejects(apps.status({udid:A,job:'expired',wait:0}),e=>e.code==='JOB_NOT_FOUND');
  await assert.rejects(apps.status({udid:B,job:job.job,wait:0}),e=>e.code==='JOB_NOT_FOUND');
  assert.equal((await apps.status({udid:A,wait:0})).job,job.job);
});

test('lightweight info stays bounded; full comparison uses a reusable job and preserves inconclusive failure',async t=>{
  const root=await temporary(t),source=path.join(root,'Game.app');await fs.mkdir(source);
  const plist={CFBundleSupportedPlatforms:['iPhoneSimulator'],CFBundleIdentifier:'test.example.game',CFBundleExecutable:'Game'};
  await fs.writeFile(path.join(source,'Game'),Buffer.alloc(256*1024));
    let comparing=false;const gate=deferred();
    const apps=require(path.join(dir,'apps.cjs')).createApps({Failure,
      run:async(file,args,options)=>{
        if(file.endsWith('plutil'))return {stdout:JSON.stringify(plist)};
        comparing=true;assert.equal(options.timeout,1800000);await gate.promise;
        throw new Failure('COMMAND_FAILED','checksum comparison timed out');
      },sim:async()=>({stdout:source})});
    const light=await apps.info({udid:A},{appPath:source,verify:'none'});
    assert.equal(light.matchesLocal,null);assert.equal(light.verification,'not_requested');assert.equal(comparing,false);
    const job=await apps.info({udid:A},{appPath:source,wait:0});assert.equal(job.state,'running');
    assert.equal((await apps.info({udid:A},{appPath:source,wait:0})).job,job.job);
    gate.resolve();const result=await apps.status({udid:A,job:job.job,wait:85});
    assert.equal(result.matchesLocal,null);assert.equal(result.verification,'unconfirmed');assert.equal(result.comparisonError.code,'COMMAND_FAILED');assert.equal(comparing,true);
});

test('whole-bundle receipts invalidate on preserved-time resource edits, additions, removals, container changes and expiry',async t=>{
  const root=await temporary(t),source=path.join(root,'Build.app'),installed=path.join(root,'Installed.app');
  const metadata={CFBundleSupportedPlatforms:['iPhoneSimulator'],CFBundleIdentifier:'test.example.game',CFBundleExecutable:'Game'};
  for(const folder of [source,installed]){await fs.mkdir(folder);await fs.writeFile(path.join(folder,'Info.plist'),JSON.stringify(metadata));await fs.writeFile(path.join(folder,'Game'),'exe');await fs.writeFile(path.join(folder,'asset'),'old');}
  let compares=0,clock=Date.now(),container=installed;
  const apps=require(path.join(dir,'apps.cjs')).createApps({Failure,now:()=>clock,
    sim:async()=>({stdout:container}),run:async(file,args)=>{if(file.endsWith('plutil'))return {stdout:await fs.readFile(args.at(-1),'utf8')};compares++;return exec(file,args);}});
  const info=()=>apps.info({udid:A},{appPath:source,wait:85});
  assert.equal((await info()).matchesLocal,true);assert.equal(compares,1);
  assert.equal((await info()).verificationReused,true);assert.equal(compares,1);
  const stamp=await fs.stat(path.join(installed,'asset'));
  await fs.writeFile(path.join(installed,'asset'),'new');await fs.utimes(path.join(installed,'asset'),stamp.atime,stamp.mtime);
  assert.equal((await info()).matchesLocal,false);assert.equal(compares,2,'ctime detects equal size and restored mtime');
  await fs.writeFile(path.join(installed,'asset'),'old');assert.equal((await info()).matchesLocal,true);
  await fs.writeFile(path.join(source,'added'),'resource');assert.equal((await info()).matchesLocal,false);
  await fs.unlink(path.join(source,'added'));assert.equal((await info()).matchesLocal,true);
  await fs.unlink(path.join(installed,'asset'));assert.equal((await info()).matchesLocal,false);
  await fs.writeFile(path.join(installed,'asset'),'old');assert.equal((await info()).matchesLocal,true);
  const before=compares;clock+=3600001;assert.equal((await info()).matchesLocal,true);assert.equal(compares,before+1);
  const replacement=path.join(root,'Replacement.app');await fs.cp(installed,replacement,{recursive:true});container=replacement;
  assert.equal((await info()).matchesLocal,true);assert.equal(compares,before+2);
  assert.equal((await apps.info({udid:A},{appPath:source,verify:'full',wait:85})).verificationReused,undefined);assert.equal(compares,before+3);
});

test('a resource change during full comparison cannot create a reusable receipt',async t=>{
  const root=await temporary(t),source=path.join(root,'Build.app');await fs.mkdir(source);await fs.writeFile(path.join(source,'Game'),'same');
  let mutate=true;
  const apps=require(path.join(dir,'apps.cjs')).createApps({Failure,sim:async()=>({stdout:source}),run:async(file)=>{
    if(file.endsWith('plutil'))return {stdout:JSON.stringify({CFBundleIdentifier:'test.example.game',CFBundleExecutable:'Game'})};
    if(mutate)await fs.writeFile(path.join(source,'asset'),'changed');return {stdout:''};
  }});
  const first=await apps.info({udid:A},{appPath:source,wait:85});
  assert.equal(first.matchesLocal,null);assert.equal(first.comparisonError.code,'BUILD_CHANGED');
  mutate=false;assert.equal((await apps.info({udid:A},{appPath:source,wait:85})).verificationReused,undefined);
});

test('receipt reuse revisits files changed after their first scan, for info and install on either tree',async t=>{
  const code=await fs.readFile(path.join(dir,'apps.cjs'),'utf8');
  for(const side of ['source','installed'])for(const action of ['info','install'])await t.test(`${side} ${action}`,async t=>{
    const root=await temporary(t),source=path.join(root,'Build.app'),installed=path.join(root,'Installed.app');
    const metadata={CFBundleSupportedPlatforms:['iPhoneSimulator'],CFBundleIdentifier:'test.example.game',CFBundleExecutable:'Game'};
    for(const folder of [source,installed]){
      await fs.mkdir(folder);await fs.writeFile(path.join(folder,'Info.plist'),JSON.stringify(metadata));
      await fs.writeFile(path.join(folder,'Game'),'exe');await fs.writeFile(path.join(folder,'asset'),'old');
      await fs.writeFile(path.join(folder,'z-last'),'last');
    }
    const target=side==='source'?await fs.realpath(source):installed;let armed=false,mutations=0;
    const context={module:{exports:{}},setImmediate,clearTimeout,setTimeout,require:name=>{
      if(name==='node:fs')return {...syncFs,lstatSync(file,options){
        const stat=syncFs.lstatSync(file,options);
        if(armed&&file===path.join(target,'z-last')){
          armed=false;mutations++;const asset=path.join(target,'asset'),old=syncFs.statSync(asset);
          syncFs.writeFileSync(asset,'new');syncFs.utimesSync(asset,old.atime,old.mtime);
        }
        return stat;
      }};
      return require(name.startsWith('.')?path.resolve(dir,name):name);
    }};
    vm.runInNewContext(code,context);
    const apps=context.module.exports.createApps({Failure,sim:async args=>{assert.equal(args[0],'get_app_container');return {stdout:installed};},
      run:async(file,args)=>file.endsWith('plutil')?{stdout:await fs.readFile(args.at(-1),'utf8')}:exec(file,args)});
    assert.equal((await apps.info({udid:A},{appPath:source,wait:85})).matchesLocal,true);
    armed=true;
    if(action==='info'){
      const result=await apps.info({udid:A},{appPath:source,wait:85});
      assert.equal(result.verificationReused,undefined);assert.equal(result.matchesLocal,false);
    }else{
      const result=await apps.install({udid:A},{appPath:source},{terminate:async()=>{}});
      assert.equal(result.mode,'sync');assert.equal(result.execution,'executed');assert.equal(result.matchesLocal,true);
      assert.equal(await fs.readFile(path.join(installed,'asset'),'utf8'),await fs.readFile(path.join(source,'asset'),'utf8'));
    }
    assert.equal(mutations,1);
  });
});

test('missing optional platform metadata still permits verified unchanged installs; symlink edits invalidate receipts',async t=>{
  const root=await temporary(t),source=path.join(root,'Build.app'),installed=path.join(root,'Installed.app');
  const metadata={CFBundleIdentifier:'test.example.game',CFBundleExecutable:'Game'};
  for(const folder of [source,installed]){
    await fs.mkdir(folder);await fs.writeFile(path.join(folder,'Info.plist'),JSON.stringify(metadata));
    await fs.writeFile(path.join(folder,'Game'),'exe');await fs.writeFile(path.join(folder,'asset'),'bytes');
    await fs.symlink('asset',path.join(folder,'link'));
  }
  let comparisons=0;
  const apps=require(path.join(dir,'apps.cjs')).createApps({Failure,
    sim:async args=>{assert.equal(args[0],'get_app_container','no reinstall');return {stdout:installed};},
    run:async(file,args)=>{if(file.endsWith('plutil'))return {stdout:await fs.readFile(args.at(-1),'utf8')};comparisons++;return exec(file,args);}});
  const unchanged=await apps.install({udid:A},{appPath:source},{terminate:async()=>assert.fail('no termination')});
  assert.equal(unchanged.mode,'unchanged');assert.equal(unchanged.matchesLocal,true);
  assert.equal((await apps.info({udid:A},{appPath:source})).verificationReused,true);assert.equal(comparisons,1);
  await fs.unlink(path.join(installed,'link'));await fs.symlink('Game',path.join(installed,'link'));
  assert.equal((await apps.info({udid:A},{appPath:source})).matchesLocal,false);assert.equal(comparisons,2);
});

test('installation comparison is already a pollable locked job, then settles as unchanged, sync or full',async t=>{
  for(const mode of ['unchanged','sync','full']){
    const root=await temporary(t),source=path.join(root,'Build.app'),installed=path.join(root,'Installed.app');
    const plist={CFBundleSupportedPlatforms:['iPhoneSimulator'],CFBundleIdentifier:'test.example.game',CFBundleExecutable:'Game',CFBundleVersion:'1'};
    for(const folder of [source,installed]){
      await fs.mkdir(folder);await fs.writeFile(path.join(folder,'Info.plist'),JSON.stringify(plist));await fs.writeFile(path.join(folder,'Game'),'same');
    }
    const comparing=deferred(),comparison=deferred(),writing=deferred(),write=deferred();let diffs=0;
    const apps=require(path.join(dir,'apps.cjs')).createApps({Failure,
      run:async(file,args)=>{
        if(file.endsWith('plutil'))return {stdout:JSON.stringify(plist)};
        if(args.includes('--dry-run')){
          if(diffs++===0){comparing.resolve();await comparison.promise;return {stdout:mode==='unchanged'?'':mode==='full'?'>f.. Info.plist\n':'>f.. asset\n'};}
          return {stdout:''};
        }
        writing.resolve();await write.promise;return {stdout:''};
      },sim:async args=>{
        if(args[0]==='get_app_container')return {stdout:installed};
        writing.resolve();await write.promise;return {stdout:''};
      }});
    const runtime=require(path.join(dir,'runtime.cjs')).createRuntime({settingsFile:path.join(root,'runtime.json'),pendingOperation:udid=>apps.pending(udid),
      dispatch:async(method,p)=>method==='app_install'?apps.install({udid:A},p,{terminate:async()=>{}}):{ok:true}});
    const result=await runtime.request('app',{action:'install',udid:A,appPath:source,wait:0});
    assert.ok(result.job);assert.equal(result.state,'running');
    await comparing.promise;
    assert.equal((await apps.status({udid:A,job:result.job,wait:0})).mode,'checking');
    await assert.rejects(runtime.request('shutdown',{udid:A}),e=>e.code==='BUSY');
    assert.ok(apps.pending(A));
    comparison.resolve();
    if(mode!=='unchanged'){
      await writing.promise;
      await assert.rejects(runtime.request('shutdown',{udid:A}),e=>e.code==='BUSY');
      write.resolve();
    }
    await apps.pending(A);
    const done=await apps.status({udid:A,job:result.job,wait:0});
    assert.equal(done.job,result.job);assert.equal(done.mode,mode);assert.equal(done.state,'done');
    assert.equal(done.execution,mode==='unchanged'?'not_executed':'executed');
    assert.equal(apps.pending(A),null);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await runtime.request('shutdown',{udid:A})).ok,true);
  }
});

test('preparation failure settles the original install job without reporting a mutation',async t=>{
  const source=path.join(await temporary(t),'Game.app');await fs.mkdir(source);
  const preparation=deferred();
  const apps=require(path.join(dir,'apps.cjs')).createApps({Failure,sim:async()=>{throw Error('must not mutate');},run:()=>preparation.promise});
  const result=await apps.install({udid:A},{appPath:source,wait:0},{terminate:async()=>{throw Error('must not terminate');}});
  assert.equal(result.mode,'checking');assert.equal(apps.runningFor(A).id,result.job);
  preparation.reject(Error('unreadable build'));
  await apps.pending(A);
  await assert.rejects(apps.status({udid:A,job:result.job,wait:0}),e=>e.execution==='not_executed');
  assert.equal(apps.pending(A),null);
});

test('background install retains the device lock through success and failure, while reads and other devices proceed', async t => {
  const {createRuntime}=require(path.join(dir,'runtime.cjs'));
  for(const fail of [false,true]) {
    const job=deferred(), calls=[];let writing=false;
    const runtime=createRuntime({settingsFile:path.join(await temporary(t),'settings.json'),
      pendingOperation:udid=>writing&&(!udid||udid===A)?job.promise:null,
      dispatch:async(method,p={})=>{calls.push(method);if(method==='app_install'){writing=true;return {state:'running'};}if(method==='devices')return {devices:[]};return {ok:true};}});
    await runtime.request('app',{action:'install',udid:A});
    for(const [method,p] of [['shutdown',{udid:A}],['erase_device',{udid:A}],['delete_device',{udid:A}],['settings_shutdown',{udid:A}],['settings_stop_all',{}],['settings_save',{enabled:false,idleMinutes:15}],['viewer_switch',{udid:A,targetUdid:B}]]) {
      await assert.rejects(runtime.request(method,p),e=>['BUSY','DEVICE_NOT_OWNED'].includes(e.code));
    }
    assert.ok(!calls.includes('shutdown')&&!calls.includes('erase_device')&&!calls.includes('delete_device'));
    assert.deepEqual(await runtime.request('tap',{udid:B}),{ok:true});
    assert.deepEqual(await runtime.request('app',{action:'install_status',udid:A}),{ok:true});
    writing=false;if(fail)job.reject(new Failure('INSTALL_FAILED','write failed','unknown'));else job.resolve();
    await new Promise(resolve=>setImmediate(resolve));
    await runtime.request('shutdown',{udid:A});assert.ok(calls.includes('shutdown'));
  }
});

// One deterministic harness for read, mutate and capture outcomes. No simulator,
// image tool or real timers; each test exercises the production Agent methods.
function agentFixture({frames=[],streamError=false,streamEvents=[],onDelay,onCommand,onFile,onInput,clockStep=10}={}) {
  const state={orientation:'portrait',calls:[],files:new Map(),diagnostics:new Map(),inputs:[],imageBytes:4,failWord:null,missingApp:false,turnOnShot:false,failRender:false,failTree:false,treeChildren:[],ocr:null,logEntries:[]};
  state.target={litPanel:'primary',screenId:1,pixelSize:{width:1206,height:2622}};
  const screen=()=>({width:state.width||402,height:874,orientation:state.orientation,target:state.target});
  let clock=0;
  state.advance=ms=>{clock+=ms;};
  state.time=()=>clock;
  const run=async(file,args,options)=>{
    state.calls.push([file,args,options]);
    onCommand?.(file,args,options,state);
    if(args[0]==='input'){if(state.failConfirm||!require('node:util').isDeepStrictEqual(JSON.parse(args[args.indexOf('--expected-screen')+1]),screen()))throw Error('changed');return {stdout:''};}
    if(args[0]==='describe-ui'){if(state.failTree)throw Error('tree unavailable');return {stdout:JSON.stringify({screen:screen(),children:state.treeChildren})};}
    if(args[0]==='screenshot') {state.files.set(args[args.indexOf('--output')+1],Buffer.from('raw'));if(state.turnOnShot)state.orientation='landscape-left';return {stdout:''};}
    if(args[0]==='chrome')return {stdout:JSON.stringify(state.layout||{})};
    if(args[0]===state.failWord)throw new Failure('COMMAND_FAILED','failed','not_executed');
    if(file.endsWith('plutil'))return {stdout:'测试 Game'};
    if(file.endsWith('osascript')) {
      if(args[2].endsWith('ocr.jxa.js')) {if(state.ocr===null)throw Error('OCR unavailable');return {stdout:JSON.stringify(state.ocr)};}
      if(state.failRender)throw new Failure('RENDER_FAILED','image conversion failed',options.mutation?'unknown':'not_executed');
      if(args[2].endsWith('image.jxa.js')&&JSON.parse(args.at(-1)).clipboard){
        state.copied=true;
        return {stdout:state.renderReceipt??JSON.stringify({width:874,height:402,bytes:state.imageBytes,copied:true})};
      }
      const script=args[2];state.files.set(args[script.endsWith('image.jxa.js')?4:3],Buffer.alloc(state.imageBytes,1));
      return {stdout:JSON.stringify({width:402,height:874})};
    }
    return {stdout:''};
  };
  const sim=async(args,options)=>{state.calls.push(['sim',args,options]);onCommand?.('sim',args,options,state);if(args[0]==='io'&&args[2]==='enumerate')return {stdout:state.enumeration||''};if(args[0]==='get_app_container'){if(state.missingApp)throw missingContainer();return {stdout:'/App.app'};}return {stdout:args.includes('show')?state.logEntries.map(e=>JSON.stringify(e)).join('\n'):''};};
  const spawnImpl=(_file,args)=>{
    const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.kill=()=>{};
    if(args[0]==='input') {
      c.stdin.write=line=>{state.inputs.push(JSON.parse(line));const ack=onInput?.(state)||{ok:true};queueMicrotask(()=>c.stdout.emit('data',JSON.stringify(ack)+'\n'));};
      c.stdin.end=()=>c.emit('exit',0);return c;
    }
    const streaming=args.includes('stream');
    if(streaming){c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=signal=>c.emit('close',null,signal);state.stream=c;}
    queueMicrotask(()=>{
      if(streamError)c.emit('error',Error('stream failed'));else for(const f of frames){if(streaming)c.stdout.write(f);else c.stdout.emit('data',f);}
      for(const {source,event,args:values} of streamEvents){
        if(streaming&&source&&event==='data')c[source].write(values[0]);else (source?c[source]:c).emit(event,...values);
      }
    });return c;
  };
  const context={module:{exports:{}},__dirname:dir,Buffer,Date,
    setTimeout:(fn,ms)=>setTimeout(()=>{onDelay?.(ms,state);fn();},ms===2000?2000:0),clearTimeout,
    require(name){if(name==='node:fs/promises')return {mkdir:async()=>{},readdir:async p=>{onFile?.('readdir',p,state);return p.endsWith('DiagnosticReports')?[...state.diagnostics.keys()]:[];},stat:async p=>{onFile?.('stat',p,state);return state.diagnostics.get(path.basename(p));},rm:async p=>state.files.delete(p),writeFile:async(p,b)=>state.files.set(p,b),readFile:async p=>{onFile?.('readFile',p,state);const report=state.diagnostics.get(path.basename(p));if(report)return report.text;if(!state.files.has(p))throw Error('missing');return state.files.get(p);}};
      return require(name.startsWith('./')?path.join(dir,name):name);}};
  vm.runInNewContext(syncFs.readFileSync(path.join(dir,'agent.cjs'),'utf8'),context);
  const agent=context.module.exports.createAgent({binary:'/bag',deviceSet:'/set',root:'/fixture',run,sim,Failure,spawnImpl,spatialAction:async(d,p,s)=>{state.spatial={device:d,params:p,screen:s};},now:()=>{clock+=clockStep;return clock;}});
  return {agent,state,device:{udid:A}};
}

test('screenshots and captures share one inline budget and preserve files and execution when the image cannot attach',async()=>{
  const jpeg=Buffer.from([0xff,0xd8,1,2,0xff,0xd9]);
  for(const bytes of [0,130000,130001,700000])for(const enabled of [false,true])for(const execution of ['executed','unknown']) {
    const f=agentFixture({frames:[jpeg]});f.state.imageBytes=bytes;
    const shot=await f.agent.screenshot(f.device,{_inline:enabled,corners:false});
    const capture=await f.agent.capture(f.device,{_inline:enabled,seconds:0.5,action:{tool:'tap'}},async()=>{
      if(execution==='unknown')throw new Failure('ACTION_FAILED','ack lost','unknown');return {execution};
    });
    const attached=enabled&&bytes>0&&bytes<=130000;
    for(const result of [shot,capture]) {
      assert.equal(!!result._modelImages,attached);
      if(attached)assert.equal(Buffer.from(result._modelImages[0].data,'base64').length,bytes);
      assert.ok(f.state.files.has(result.path||result.sheet),'file survives the inline fallback');
      assert.match(result.note,attached?/attached/:/Open/);
    }
    assert.equal(capture.execution,execution);
    if(execution==='unknown')assert.equal(capture.actionError.execution,'unknown');
  }
});

test('tap, scroll and wait distinguish identifiers from same-named labels and never widen an id to OCR',async()=>{
  const f=agentFixture();
  f.state.treeChildren=[
    {role:'AXButton',identifier:'different',label:'checkout',frame:{x:10,y:100,width:80,height:40}},
    {role:'AXButton',identifier:'checkout',label:'Pay',frame:{x:110,y:200,width:80,height:40}},
  ];
  const tapped=await f.agent.tap(f.device,{id:'checkout',observe:'none'});
  assert.equal(tapped.element.id,'checkout');assert.equal(f.state.inputs[0].x,150);
  const scrolled=await f.agent.gesture(f.device,{kind:'scroll_to',id:'checkout',observe:'none'});
  assert.equal(scrolled.element.id,'checkout');assert.equal(scrolled.swipes,0);
  assert.equal((await f.agent.waitFor(f.device,{id:'checkout',timeout:1})).element.id,'checkout');
  f.state.treeChildren.pop();
  await assert.rejects(f.agent.tap(f.device,{id:'checkout',observe:'none'}),e=>e.code==='ELEMENT_NOT_FOUND');
  assert.equal((await f.agent.waitFor(f.device,{id:'checkout',timeout:1})).met,false);
  assert.equal((await f.agent.waitFor(f.device,{id:'checkout',gone:true,timeout:1})).met,true);
  f.state.treeChildren=[];f.state.ocr=[{text:'checkout',box:[0.1,0.1,0.2,0.1]}];
  await assert.rejects(f.agent.tap(f.device,{id:'checkout',text:'checkout',observe:'none'}),e=>e.code==='ELEMENT_NOT_FOUND');
  assert.equal((await f.agent.waitFor(f.device,{id:'checkout',text:'checkout',timeout:1})).met,false);
  assert.ok(!f.state.calls.some(c=>c[1][2]?.endsWith?.('ocr.jxa.js')),'explicit id never falls back to text recognition');
});

test('identifier representation survives the raw AX tree through tap, scroll and present/gone waits',async()=>{
  for(const node of [
    {role:'AXButton',identifier:'checkout',label:'checkout'},
    {role:'AXGroup',identifier:'checkout'},
    {role:'AXGenericElement',identifier:'checkout'},
    {role:'AXButton',identifier:' checkout ',label:'Pay'},
  ]) {
    const f=agentFixture(),id=node.identifier;
    f.state.treeChildren=[
      {role:'AXButton',label:id,frame:{x:10,y:100,width:80,height:40}},
      {...node,frame:{x:110,y:200,width:80,height:40}},
    ];
    assert.equal((await f.agent.describe(f.device,{})).elements[1].id,id);
    assert.equal((await f.agent.tap(f.device,{id,observe:'none'})).element.id,id);
    assert.equal(f.state.inputs[0].x,150,'only the true identifier is tapped');
    assert.equal((await f.agent.gesture(f.device,{kind:'scroll_to',id,observe:'none'})).swipes,0);
    assert.equal((await f.agent.waitFor(f.device,{id,timeout:1})).met,true);
    assert.equal((await f.agent.waitFor(f.device,{id,gone:true,timeout:1})).met,false);
    f.state.treeChildren.pop();
    assert.equal((await f.agent.waitFor(f.device,{id,gone:true,timeout:1})).met,true);
  }
});

test('explicit invalid selectors fail before AX/OCR reads, coordinate input or scrolling',async()=>{
  const f=agentFixture();
  f.state.treeChildren=[{role:'AXButton',label:'Unrelated',frame:{x:10,y:100,width:80,height:40}}];
  for(const key of ['text','id','role'])for(const value of ['', ' \t\n ',null,42]) {
    const selector={text:'Unrelated',[key]:value};
    for(const operation of [
      ()=>f.agent.tap(f.device,{...selector,x:50,y:120,observe:'none'}),
      ()=>f.agent.gesture(f.device,{...selector,kind:'scroll_to'}),
      ()=>f.agent.waitFor(f.device,{...selector,timeout:1}),
      ()=>f.agent.waitFor(f.device,{...selector,gone:true,timeout:1}),
    ])await assert.rejects(operation(),e=>e.code==='INVALID_ARGUMENT'&&e.execution==='not_executed');
  }
  assert.equal(f.state.calls.length,0);assert.equal(f.state.inputs.length,0);
});

test('crash summaries take the latest five from all matching reports regardless of directory order',async()=>{
  const f=agentFixture();
  const report=(minute,device=A)=>({mtimeMs:1000,size:200,text:JSON.stringify({timestamp:`2026-10-22T10:${String(minute).padStart(2,'0')}:00Z`,app_name:'Game'})+'\n'+JSON.stringify({device,procName:'Game'})});
  for(const minute of [2,1,4,3,0,9,8,7,6,5])f.state.diagnostics.set(`Game-${minute}.ips`,report(minute));
  f.state.diagnostics.set('Game-foreign.ips',report(59,B));
  f.state.diagnostics.set('Game-bad.ips',{mtimeMs:1000,size:100,text:'invalid '+A});
  f.state.diagnostics.set('Other-null.ips',{mtimeMs:1000,size:100,text:'null\n'+JSON.stringify({device:A,procName:'Game'})});
  f.state.diagnostics.set('Game-old.ips',{...report(58),mtimeMs:-10000000});
  f.state.diagnostics.set('Game-not-report.txt',report(57));
  for(const minute of [56,55,54,53,52,51]) {
    const helper=report(minute);helper.text=helper.text.replace('"procName":"Game"','"procName":"GameHelper"');
    f.state.diagnostics.set(`GameHelper-${minute}.ips`,helper);
  }
  f.state.diagnostics.set('unrelated-filename.ips',report(10));
  const headerOnly=report(11);headerOnly.text=headerOnly.text.replace(',"procName":"Game"','');
  f.state.diagnostics.set('another-filename.ips',headerOnly);
  const result=await f.agent.logs(f.device,{process:'Game'});
  assert.deepEqual(Array.from(result.crashes,r=>path.basename(r.file)),['another-filename.ips','unrelated-filename.ips',... [9,8,7].map(n=>`Game-${n}.ips`)]);
});

test('crash scanning distinguishes empty, skipped, unreadable and incomplete while retaining the logs',async()=>{
  for(const phase of ['empty','skipped','readdir','stat','readFile','deadline','partial']){
    let reads=0;
    const f=agentFixture({clockStep:0,onFile(operation,_file,state){
      reads++;
      if(operation===phase||(phase==='partial'&&operation==='stat'&&reads>3))throw Object.assign(Error('diagnostic access denied'),{code:'EACCES'});
      if(phase==='deadline'&&operation==='readdir')state.advance(10000);
    }});
    f.state.logEntries=[{eventMessage:'ready'}];
    if(phase!=='empty')for(const n of [1,2])f.state.diagnostics.set('Game-'+n+'.ips',{mtimeMs:1000,size:200,text:JSON.stringify({timestamp:'2026-10-22T10:00:00Z'})+'\n'+JSON.stringify({device:A,procName:'Game'})});
    const result=await f.agent.logs(f.device,{process:'Game',_deadline:10000,...(phase==='skipped'?{crashes:false}:{})});
    assert.ok(result.lines[0].includes('ready'),'diagnostic failure does not lose the primary logs');
    if(phase==='empty'){assert.deepEqual(Array.from(result.crashes),[]);assert.equal(result.crashesError,undefined);}
    else if(phase==='skipped'){assert.equal(result.crashes,undefined);assert.equal(result.crashesError,undefined);assert.equal(reads,0);}
    else {assert.equal(result.crashes,undefined,'unverified coverage is not reported as an empty or complete list');assert.equal(result.crashesError.code,phase==='deadline'?'TIME_BUDGET_EXHAUSTED':'EACCES');}
  }
});

test('explicit log scope is shared by history and waits and never widens after lookup or validation failure', async()=>{
  const {agent,state,device}=agentFixture();state.missingApp=true;
  for(const call of [()=>agent.logs(device,{bundleId:'test.example.missing',crashes:false}),()=>agent.waitFor(device,{bundleId:'test.example.missing',log:'ready',timeout:1})]) {
    await assert.rejects(call(),e=>e.code==='APP_NOT_INSTALLED');
  }
  assert.ok(!state.calls.some(c=>c[1].includes('show')||c[1].includes('stream')));
  for(const process of ['',42,'bad\nprocess','a'.repeat(101)])await assert.rejects(agent.logs(device,{process,crashes:false}),e=>e.code==='INVALID_ARGUMENT');
  await agent.logs(device,{process:'测试 "Game"',crashes:false});
  const args=state.calls.find(c=>c[1].includes('show'))[1];assert.equal(args[args.indexOf('--predicate')+1],'process == '+JSON.stringify('测试 "Game"'));
});

test('container lookup failures never become absent apps, installations or widened log scopes',async t=>{
  const root=await temporary(t),source=path.join(root,'Game.app');await fs.mkdir(source);await fs.writeFile(path.join(source,'Game'),'executable');
  const plist=JSON.stringify({CFBundleSupportedPlatforms:['iPhoneSimulator'],CFBundleIdentifier:'test.example.game',CFBundleExecutable:'Game'});
  for(const code of ['COMMAND_FAILED','COMMAND_TIMEOUT','TIME_BUDGET_EXHAUSTED']) {
    const error=new Failure(code,'CoreSimulator service unavailable');const mutations=[];
    const apps=require(path.join(dir,'apps.cjs')).createApps({Failure,
      run:async()=>({stdout:plist}),sim:async args=>{if(args[0]==='get_app_container')throw error;mutations.push(args);return {stdout:''};}});
    await assert.rejects(apps.info({udid:A},{bundleId:'test.example.game'}),e=>e===error);
    await assert.rejects(apps.install({udid:A},{appPath:source},{terminate:async()=>mutations.push('terminate')}),e=>e.code===code&&e.execution==='not_executed');
    assert.deepEqual(mutations,[]);assert.equal(apps.pending(A),null);
    const f=agentFixture({onCommand(file,args){if(file==='sim'&&args[0]==='get_app_container')throw error;}});
    for(const call of [()=>f.agent.logs(f.device,{bundleId:'test.example.game',crashes:false}),()=>f.agent.waitFor(f.device,{bundleId:'test.example.game',log:'ready',timeout:1})])await assert.rejects(call(),e=>e===error);
    assert.ok(!f.state.calls.some(c=>c[1].includes('show')||c[1].includes('stream')));
  }
  const {appContainer}=require(path.join(dir,'app-container.cjs'));
  const lookup=sim=>appContainer({sim,Failure},{udid:A},'test.example.game');
  assert.equal(await lookup(async()=>{throw missingContainer();}),null);
  assert.equal(await lookup(async()=>({stdout:'/Game.app'})),'/Game.app');
  await assert.rejects(lookup(async()=>({stdout:''})),e=>e.code==='APP_LOOKUP_FAILED');
  // Generic missing files and other POSIX errors cannot establish App absence.
  for(const message of ['No such file or directory','domain=NSPOSIXErrorDomain, code=60): No such file or directory'])await assert.rejects(lookup(async()=>{throw new Failure('COMMAND_FAILED',message);}),e=>e.message===message);
  const absent=require(path.join(dir,'apps.cjs')).createApps({Failure,run:async()=>{throw Error('no identity lookup');},sim:async()=>{throw missingContainer();}});
  assert.equal((await absent.info({udid:A},{bundleId:'test.example.game'})).installed,false);
});

test('compound state requests validate all fields before mutating and preserve partial execution on command failure', async()=>{
  const {agent,state,device}=agentFixture();
  for(const invalid of [{network:{}},{location:{}},{network:{latency:null}},{privacy:{action:'grant',service:'camera'}},{contrast:'yes'},{status_bar:'invalid'}]) {
    await assert.rejects(agent.setState(device,{orientation:'landscape-left',...invalid}),e=>e.code==='INVALID_ARGUMENT'&&e.execution==='not_executed');
  }
  assert.equal(state.calls.length,0);
  state.failWord='network';
  const partial=await agent.setState(device,{orientation:'landscape-left',network:'wifi'});
  assert.equal(partial.execution,'unknown');assert.deepEqual(Array.from(partial.applied),['orientation']);
  assert.equal(partial.stateError.field,'network');assert.equal(partial.stateError.execution,'not_executed');
  assert.deepEqual(state.calls.map(c=>c[1][0]),['orientation','network']);
});

test('all state fields stop at the shared deadline and report the completed prefix plus the failed field',async()=>{
  const fields={orientation:'landscape-left',posture:'open',appearance:'dark',contrast:true,text_size:'large',network:'wifi',location:{lat:1,lon:2},status_bar:'clean',privacy:{action:'grant',service:'camera',bundleId:'test.example.game'}};
  const names=Object.keys(fields);
  for(const mode of ['expired-before','expired-between','command-timeout','command-rejected','success'])for(let prefix=0;prefix<names.length;prefix++){
    let mutations=0;
    const deadline=mode==='expired-before'?0:mode==='expired-between'?prefix*1000:100000;
    const f=agentFixture({clockStep:0,onCommand(_file,_args,options,state){
      assert.ok(options.timeout>0&&options.timeout<=deadline-state.time(),'every command including readback has only remaining time');
      if(!options.mutation)return;
      mutations++;
      if(mode==='command-timeout'&&mutations===prefix+1){state.advance(options.timeout);throw new Failure('COMMAND_FAILED','timeout','unknown');}
      if(mode==='command-rejected'&&mutations===prefix+1)throw new Failure('STATE_REJECTED','rejected before execution','not_executed');
      state.advance(1000);
    },onDelay(ms,state){state.advance(ms);}});
    const result=await f.agent.setState(f.device,{...fields,_deadline:deadline});
    if(mode==='success'){
      assert.equal(result.execution,'executed');assert.deepEqual(Array.from(result.applied),names);assert.equal(result.stateError,undefined);
    }else{
      const done=mode==='expired-before'?0:prefix;
      assert.deepEqual(Array.from(result.applied),names.slice(0,done));
      assert.equal(result.stateError.field,names[done]);
      assert.equal(result.execution,done||mode==='command-timeout'?'unknown':'not_executed');
      assert.equal(result.stateError.execution,mode==='command-timeout'?'unknown':'not_executed');
      assert.equal(mutations,done+Number(mode.startsWith('command-')),'no later field or readback was attempted');
    }
  }
});

test('state readback never renews the budget or loses a completed mutation',async()=>{
  for(const p of [{},{orientation:'landscape-left'},{appearance:'dark'}]){
    const f=agentFixture({clockStep:0,onCommand(_file,_args,options,state){
      assert.ok(options.timeout<=1000-state.time());state.advance(options.timeout);
    },onDelay(ms,state){state.advance(ms);}});
    const result=await f.agent.setState(f.device,{...p,_deadline:1000});
    assert.equal(result.execution,Object.keys(p).length?'executed':'not_executed');
    assert.ok(f.state.time()<=1000);
    assert.equal(f.state.calls.length,1,'no command starts after expiry');
  }
});

test('screenshots reject a rotation during capture and refresh a rotation inside the former cache window', async()=>{
  const {agent,state,device}=agentFixture();state.ocr=[];await agent.describe(device,{});
  state.orientation='landscape-left';
  const shot=await agent.screenshot(device,{corners:false});assert.equal(shot.screen.width,874);assert.equal(shot.screen.orientation,'landscape-left');
  state.orientation='portrait';state.turnOnShot=true;
  await assert.rejects(agent.screenshot(device,{corners:false}),e=>e.code==='SCREEN_CHANGED');
});

test('viewer exports use live orientation and full resolution after an Agent screenshot warmed the density cache',async()=>{
  for(const [orientation,rotation] of Object.entries({'portrait':0,'landscape-left':90,'portrait-upside-down':180,'landscape-right':270})) {
    const {agent,state,device}=agentFixture();
    await agent.screenshot(device,{corners:false});
    state.orientation=orientation;state.calls.length=0;
    const shot=await agent.nativeScreenshot(device,10000);
    assert.equal(shot._screen.orientation,orientation);
    const capture=state.calls.find(([,args])=>args[0]==='screenshot')[1];
    assert.equal(capture[capture.indexOf('--scale')+1],'1');
    const render=state.calls.find(([,args])=>args[2]?.endsWith('image.jxa.js'));
    const options=JSON.parse(render[1].at(-1));
    assert.equal(options.rotate,rotation);assert.equal(options.nativeResolution,true);
    assert.equal(options.radius,0);assert.equal(options.grid,0);assert.equal(options.format,'png');
    assert.equal(options.view.width,rotation%180?874:402);
    assert.ok(!state.calls.some(([,args])=>args[0]==='chrome'));
    assert.ok([...state.files.keys()].every(file=>!file.endsWith('.raw.png')));
  }
  const {agent,state,device}=agentFixture();
  state.turnOnShot=true;
  await assert.rejects(agent.nativeScreenshot(device,10000),e=>e.code==='SCREEN_CHANGED');
  assert.equal(state.files.size,0);
});

test('Agent and native fallback screenshots remove temporary and partial output files on every capture stage failure',async()=>{
  for(const native of [false,true])for(const phase of ['capture','geometry','stale','render']){
    let f,captures=0;
    f=agentFixture({onCommand(_file,args,_options,state){
      if(args[0]==='screenshot'){
        captures++;
        if(phase==='capture'){
          state.files.set(args[args.indexOf('--output')+1],Buffer.from('partial'));
          throw new Failure('CAPTURE_FAILED','original capture failure');
        }
        if(phase==='geometry'){f.agent.forget(f.device.udid);state.failTree=true;}
        if(phase==='stale'){state.failConfirm=true;state.failTree=true;}
      }
      if(args[2]?.endsWith('image.jxa.js')&&phase==='render'){
        state.files.set(args[4],Buffer.from('partial output'));
        throw new Failure('RENDER_FAILED','original render failure');
      }
    }});
    const expected={capture:'CAPTURE_FAILED',geometry:'SCREEN_UNAVAILABLE',stale:'SCREEN_CHANGED',render:'RENDER_FAILED'}[phase];
    const task=native?f.agent.nativeScreenshot(f.device,10000):f.agent.screenshot(f.device,{corners:false,_deadline:10000});
    await assert.rejects(task,e=>e.code===expected);
    assert.equal(captures,phase==='capture'?2:1);
    assert.equal(f.state.files.size,0,`${native?'native fallback':'Agent'} ${phase} leaves no private image files`);
  }
});

test('flat viewer exports capture native pixels at the visible pose without AX or input probes',async()=>{
  for(const [orientation,rotation] of Object.entries({'portrait':0,'landscape-left':90,'portrait-upside-down':180,'landscape-right':270})) {
    const {agent,state,device}=agentFixture();
    await agent.screenshot(device,{corners:false}); // populate a lower-density Agent cache
    state.calls.length=0;state.orientation='portrait';state.failTree=true;state.failConfirm=true;
    const shot=await agent.nativeScreenshot(device,10000,orientation);
    assert.ok(state.files.has(shot.path));
    assert.deepEqual(state.calls.map(([,args])=>args[0]),['screenshot','-l']);
    const capture=state.calls[0][1];assert.equal(capture[capture.indexOf('--scale')+1],'1');
    const options=JSON.parse(state.calls.find(([,args])=>args[2]?.endsWith('image.jxa.js'))[1].at(-1));
    assert.equal(options.rotate,rotation);assert.equal(options.view,undefined,'renderer derives dimensions from the captured PNG');
    assert.equal(options.nativeResolution,true);
    assert.ok([...state.files.keys()].every(file=>!file.endsWith('.raw.png')));
  }
  const invalid=agentFixture();
  await assert.rejects(invalid.agent.nativeScreenshot(invalid.device,10000,'bogus'),e=>e.code==='INVALID_ARGUMENT');
  assert.equal(invalid.state.calls.length,0);
});

test('flat exports clean partial files and do not restart an expired capture budget',async()=>{
  for(const phase of ['capture','render','expired','transient']){
    let captures=0;
    const f=agentFixture({clockStep:0,onCommand(_file,args,_options,state){
      if(args[0]==='screenshot'){
        captures++;
        if(phase==='capture'||(phase==='transient'&&captures===1)){
          state.files.set(args[args.indexOf('--output')+1],Buffer.from('partial'));
          throw new Failure('CAPTURE_FAILED','capture failed');
        }
      }
      if(args[0]==='-l'&&phase==='render'){
        state.files.set(args[4],Buffer.from('partial'));
        throw new Failure('RENDER_FAILED','render failed');
      }
    }});
    const task=f.agent.nativeScreenshot(f.device,phase==='expired'?0:10000,'landscape-left');
    if(phase==='transient'){const result=await task;assert.equal(captures,2);assert.deepEqual([...f.state.files.keys()],[result.path]);}
    else{await assert.rejects(task);assert.equal(f.state.files.size,0);}
    if(phase==='expired')assert.equal(f.state.calls.length,0);
  }
});

test('flat clipboard exports render and copy once without a second PNG file, and never retry uncertain writes',async()=>{
  for(const orientation of ['portrait','landscape-left','landscape-right','portrait-upside-down']){
    const f=agentFixture();f.state.failTree=true;
    const shot=await f.agent.nativeScreenshot(f.device,10000,orientation,true);
    assert.equal(shot.copied,true);assert.equal(shot.bytes,f.state.imageBytes);assert.equal(shot.path,undefined);
    assert.equal(f.state.files.size,0);
    assert.deepEqual(f.state.calls.map(([,args])=>args[0]),['screenshot','-l']);
    assert.equal(f.state.calls.at(-1)[2].mutation,true);
  }
  for(const receipt of ['invalid','{}','null','{"copied":true,"bytes":0}']){
    const f=agentFixture();f.state.renderReceipt=receipt;
    await assert.rejects(f.agent.nativeScreenshot(f.device,10000,'landscape-left',true),e=>e.execution==='unknown');
    assert.equal(f.state.calls.filter(([,args])=>args[0]==='-l').length,1);
    assert.equal(f.state.files.size,0);
  }
  const failed=agentFixture();failed.state.failRender=true;
  await assert.rejects(failed.agent.nativeScreenshot(failed.device,10000,'portrait',true),e=>e.execution==='unknown');
  assert.equal(failed.state.calls.filter(([,args])=>args[0]==='-l').length,1);
  const expired=agentFixture({clockStep:0,onCommand(_file,args,_opts,state){if(args[0]==='screenshot')state.advance(1000);}});
  await assert.rejects(expired.agent.nativeScreenshot(expired.device,1000,'portrait',true),e=>e.execution==='not_executed');
  assert.equal(expired.state.copied,undefined);assert.equal(expired.state.files.size,0);
});

test('a log wait timeout includes the current screenshot without a separate request',async()=>{
  const {agent,device}=agentFixture();
  const result=await agent.waitFor(device,{log:'never printed',timeout:1});
  assert.equal(result.met,false);assert.ok(result.screenshot.path);
});

test('all wait outcomes retain their result when slow optional images exhaust the shared host budget',async()=>{
  for(const mode of ['log-timeout','log-match','id-timeout','stable-timeout','ocr-timeout']) {
    const f=agentFixture({clockStep:0,frames:mode==='log-match'?[JSON.stringify({eventMessage:'ready'})+'\n']:[],
      onDelay:(ms,s)=>s.advance(ms),
      onCommand:(file,args,options,s)=>{
        // Model commands honoring their supplied timeout; screenshots retry,
        // geometry and OCR compete for the same finite remaining budget.
        const cost=mode==='ocr-timeout'?file.endsWith('osascript')&&args[2].endsWith('ocr.jxa.js')?40000:1000:mode==='log-match'?20000:args[0]==='describe-ui'?16000:20000;
        s.advance(Math.min(cost,options.timeout));
        if(cost>=options.timeout)throw new Failure('COMMAND_TIMEOUT','slow command');
      }});
    const p=mode.startsWith('log')?{log:'ready'}:mode==='stable-timeout'?{stable:1}:mode==='ocr-timeout'?{text:'ready'}:{id:'ready'};
    const result=await f.agent.waitFor(f.device,{...p,timeout:90,screenshot:true,_inline:true});
    assert.equal(result.met,mode==='log-match',mode);
    assert.ok(mode==='ocr-timeout'?result.screenshot.path:result.screenshot.error,mode);
    assert.ok(f.state.time()<=100500,`${mode}: ${f.state.time()}ms`);
    assert.ok(!result.reason?.includes('is attached'));
    assert.ok(f.state.calls.every(([, ,o])=>o.timeout>0&&o.timeout<=40000));
    if(mode==='ocr-timeout')assert.ok(f.state.calls.some(([,args])=>args[2]?.endsWith?.('ocr.jxa.js')));
  }
});

test('supplemental capture retries and inline renders never renew a wait deadline',async()=>{
  for(const phase of ['capture','render','inline']) {
    let captures=0,renders=0;
    const f=agentFixture({clockStep:0,onDelay:(ms,s)=>s.advance(ms),
      onCommand:(file,args,options,s)=>{
        if(args[0]==='screenshot'){
          captures++;
          if(phase==='capture') {s.advance(options.timeout);throw new Failure('COMMAND_TIMEOUT','slow capture');}
        }
        if(file.endsWith('osascript')&&args[2].endsWith('image.jxa.js')){
          renders++;
          if(phase==='inline'&&renders===1)return;
          s.advance(options.timeout);throw new Failure('COMMAND_TIMEOUT','slow render');
        }
      }});
    f.state.imageBytes=130001;
    const result=await f.agent.waitFor(f.device,{log:'never',timeout:90,_inline:true});
    assert.equal(result.met,false);assert.ok(result.screenshot.error);
    assert.ok(f.state.time()<=100300);
    assert.equal(captures,1,'exhausted budget does not start a second capture');
    assert.equal(renders,phase==='capture'?0:phase==='render'?1:2);
    const direct=agentFixture({clockStep:0});
    assert.ok((await direct.agent.screenshot(direct.device,{corners:false})).path);
  }
});

test('after/until/both and settling inherit the original request deadline',async()=>{
  for(const mode of ['until','both','settle']) {
    const f=agentFixture({clockStep:0,onDelay:(ms,s)=>s.advance(ms),onCommand:(_file,_args,options,s)=>{
      s.advance(options.timeout);throw new Failure('COMMAND_TIMEOUT','slow observation');
    }});
    f.state.advance(99000);
    if(mode==='settle'){
      await f.agent.settle(f.device,{timeout:20000,deadline:100000});
    }else{
      const result=await f.agent.after(f.device,{...(mode==='until'?{until:'ready'}:{observe:'both',settle:0}),_deadline:100000},{execution:'executed'});
      assert.equal(result.execution,'executed');
      if(mode==='until'){assert.equal(result.until.met,false);assert.ok(result.until.screenshot.error);}
      else {assert.ok(result.ui.error);assert.ok(result.screenshot.error);}
    }
    assert.ok(f.state.time()<=100400);
    assert.ok(f.state.calls.every(([, ,options])=>options.timeout<=1000));
  }
});

test('slow capture after a real input acknowledgement consumes only observation budget and never repeats input',async()=>{
  const f=agentFixture({clockStep:0,onDelay:(ms,s)=>s.advance(ms),onCommand:(_file,args,options,s)=>{
    if(args[0]==='screenshot'){s.advance(options.timeout);throw new Failure('COMMAND_TIMEOUT','capture stalled');}
  }});
  const result=await f.agent.tap(f.device,{x:50,y:50,observe:'screenshot',settle:0,_deadline:110000});
  assert.equal(result.execution,'executed');assert.ok(result.screenshot.error);assert.equal(result.observation,'unconfirmed');
  assert.ok(result.timing.observationMs<=12000);assert.ok(f.state.time()<=12000);
  assert.equal(f.state.inputs.filter(i=>i.type==='tap').length,1);
  const count=f.state.inputs.length;
  await assert.rejects(f.agent.screenshot(f.device,{_deadline:f.state.time()+1000}));
  assert.equal(f.state.inputs.length,count,'independent observation cannot send input');
});

test('an exhausted corner lookup never poisons later independent screenshot geometry',async()=>{
  let reads=0;
  const f=agentFixture({clockStep:0,onCommand:(_file,args,options,s)=>{
    if(args[0]==='chrome'&&++reads===1){s.advance(options.timeout);throw Error('deadline');}
  }});
  f.state.layout={innerCornerRadius:40,screen:{width:402}};
  await assert.rejects(f.agent.screenshot(f.device,{_deadline:1000}));
  await f.agent.screenshot(f.device,{});
  await f.agent.screenshot(f.device,{});
  assert.equal(reads,2,'successful geometry is cached, an unavailable layout is not');
  const renders=f.state.calls.filter(([,a])=>a[2]?.endsWith?.('image.jxa.js'));
  assert.ok(renders.length&&renders.every(([,a])=>JSON.parse(a[5]).radius===40));
});

test('a scroll observation failure after a swipe preserves the completed input',async()=>{
  const f=agentFixture({onDelay:(ms,s)=>{if(ms===450)s.failTree=true;}});
  f.state.treeChildren=[{role:'AXButton',label:'Other',frame:{x:0,y:0,width:50,height:50}}];
  await assert.rejects(f.agent.gesture(f.device,{kind:'scroll_to',text:'Target',_deadline:100000}),e=>e.execution==='executed');
  assert.ok(f.state.inputs.length);
});

test('scroll execution distinguishes first rejection, prior swipes, uncertain ACK and failed settling',async()=>{
  for(const prior of [false,true])for(const execution of ['not_executed','unknown']){
    let swipes=0;
    const f=agentFixture({onInput:s=>{
      swipes++;
      if(prior&&swipes===1)return {ok:true};
      return {ok:false,error:'input refused',execution};
    },onDelay:(ms,s)=>{if(ms===450)s.treeChildren[0].frame.y+=10;}});
    f.state.treeChildren=[{role:'AXButton',label:'Other',frame:{x:0,y:50,width:50,height:50}}];
    await assert.rejects(f.agent.gesture(f.device,{kind:'scroll_to',text:'Target',_deadline:100000}),e=>e.execution===(prior?'unknown':execution));
    assert.equal(swipes,prior?2:1);
  }
  for(const phase of ['before','after']){
    const f=agentFixture({clockStep:0,onCommand:(_file,args,_opts,s)=>{if(phase==='before'&&args[0]==='describe-ui')s.advance(1000);},onInput:s=>{if(phase==='after')s.advance(900);}});
    f.state.treeChildren=[{role:'AXButton',label:'Other',frame:{x:0,y:50,width:50,height:50}}];
    await assert.rejects(f.agent.gesture(f.device,{kind:'scroll_to',text:'Target',_deadline:1000}),e=>e.execution===(phase==='before'?'not_executed':'executed'));
    assert.equal(f.state.inputs.length,phase==='before'?0:1);
  }
});

test('live log waits and history use the same message field with eventMessage taking precedence',async()=>{
  for(const entry of [{composedMessage:'ready'},{eventMessage:'',composedMessage:'ready'},{eventMessage:'ready',composedMessage:'ignored'}]) {
    const line=JSON.stringify(entry)+'\n';
    // NDJSON fields can arrive across arbitrary stream chunks.
    const f=agentFixture({frames:[line.slice(0,9),line.slice(9)]});
    f.state.logEntries=[entry];
    const history=await f.agent.logs(f.device,{match:'ready',crashes:false});
    const wait=await f.agent.waitFor(f.device,{log:'ready',timeout:1});
    assert.equal(wait.met,true);assert.equal(wait.line,history.lines[0]);
  }
});

test('live and historical log matching share formatted metadata, message normalization and partial-line parsing',async()=>{
  const entry={timestamp:'2026-10-22 10:00:00.123+0000',messageType:'Error',subsystem:'example.test',category:'network',eventMessage:'x'.repeat(700)+' ready\n now 测试 '};
  const raw=Buffer.from('not json\nnull\n{}\n'+JSON.stringify(entry)),cut=raw.indexOf(Buffer.from('测试'))+1;
  for(const match of ['10:00:00\\.123','\\[error\\]','example\\.test/network','ready now','测试']) {
    const f=agentFixture({frames:[raw.subarray(0,23),raw.subarray(23,cut),raw.subarray(cut)],streamEvents:[{event:'exit',args:[0]},{event:'close',args:[0]}]});
    f.state.logEntries=[null,{},entry];
    const history=await f.agent.logs(f.device,{match,crashes:false});
    const live=await f.agent.waitFor(f.device,{log:match,timeout:1});
    assert.equal(live.met,true);assert.equal(live.line,history.lines[0]);
    assert.ok(!live.line.includes('ready'),'full content is matched while the display remains shortened');
  }
});

test('log stream terminal events settle once, consume trailing output and distinguish failure from timeout',async()=>{
  const ready={source:'stdout',event:'data',args:[JSON.stringify({eventMessage:'ready'})+'\n']};
  const close={event:'close',args:[1]},error={event:'error',args:[Error('spawn failed')]};
  for(const terminal of [close,error]) {
    const success=agentFixture({streamEvents:[ready,terminal,close,ready]});
    assert.equal((await success.agent.waitFor(success.device,{log:'ready',timeout:1})).met,true);
    const failed=agentFixture({streamEvents:[{source:'stderr',event:'data',args:['x'.repeat(5000)+' device shut down']},terminal,ready,close]});
    await assert.rejects(failed.agent.waitFor(failed.device,{log:'ready',timeout:90}),e=>{
      assert.equal(e.code,'LOGS_UNAVAILABLE');
      if(terminal===close){assert.match(e.message,/device shut down/);assert.ok(e.message.length<4100);}
      return true;
    });
    assert.ok(!failed.state.calls.some(c=>c[1][0]==='screenshot'),'infrastructure failure is not a normal wait timeout');
  }
  // exit can precede the final stdout data; only close proves the pipes drained.
  const drained=agentFixture({streamEvents:[{event:'exit',args:[0]},{...ready,args:[JSON.stringify({eventMessage:'ready'})]}, {event:'close',args:[0]}]});
  assert.equal((await drained.agent.waitFor(drained.device,{log:'ready',timeout:1})).met,true);
  const ended=agentFixture({streamEvents:[{event:'close',args:[0]}]});
  await assert.rejects(ended.agent.waitFor(ended.device,{log:'ready',timeout:1}),e=>e.code==='LOGS_UNAVAILABLE');
  const waiting=agentFixture();
  assert.equal((await waiting.agent.waitFor(waiting.device,{log:'ready',timeout:1})).met,false,'timeout kills the stream without turning its own close into a failure');
});

test('capture gates actions on a complete first frame within the original deadline',async()=>{
  const jpeg=Buffer.from([0xff,0xd8,1,2,0xff,0xd9]);
  for(const mode of ['delayed','partial','missing','late','changed','stream-error','geometry-error']){
    let actions=0,received=false,stopped=false;
    const f=agentFixture({clockStep:0,onDelay(ms,s){
      s.advance(ms);
      if(!stopped&&s.time()===100){const kill=s.stream.kill;s.stream.kill=signal=>{stopped=true;return kill(signal);};}
      if(s.time()===500&&mode==='partial')s.stream.stdout.write(jpeg.subarray(0,4));
      if(s.time()===800&&['delayed','partial','changed','stream-error','geometry-error'].includes(mode)){
        s.stream.stdout.write(mode==='partial'?jpeg.subarray(4):jpeg);received=true;
        if(mode==='changed')s.orientation='landscape-left';
        if(mode==='stream-error')s.stream.emit('error',Error('recording unavailable'));
      }
    },onCommand(_file,args,_options,s){if(mode==='geometry-error'&&received&&args[0]==='input')s.stream.emit('error',Error('failed during geometry confirmation'));}});
    const result=await f.agent.capture(f.device,{seconds:0.5,_deadline:2000,action:{tool:'tap'}},async()=>{
      actions++;assert.equal(received,true);assert.ok(f.state.time()>=800,'a fixed 400ms delay is insufficient');f.state.advance(50);return {execution:'executed'};
    });
    assert.equal(stopped,true);
    if(['delayed','partial'].includes(mode)){assert.equal(actions,1);assert.ok(result.sheet);assert.ok(result.frames.some(frame=>frame.ms<0),'the sheet contains a before frame');}
    else {assert.equal(actions,0);assert.equal(result.execution,'not_executed');assert.ok(result.captureError);assert.equal(result.sheet,undefined);}
    if(mode==='late'){f.state.stream.stdout.write(jpeg);await new Promise(resolve=>setImmediate(resolve));assert.equal(actions,0,'late frames cannot revive the action');}
    assert.ok(f.state.time()<=2000);
  }
});

test('capture keeps same-length different frames and carries action execution through every result path', async()=>{
  const a=Buffer.from([0xff,0xd8,1,2,0xff,0xd9]),b=Buffer.from([0xff,0xd8,3,4,0xff,0xd9]);
  for(const frames of [[a,a,b]]) for(const execution of ['not_executed','executed','unknown']) {
    const {agent,device}=agentFixture({frames});
    const result=await agent.capture(device,{action:{tool:'tap'},seconds:0.5},async()=>{throw new Failure('ACTION_FAILED','action failed',execution);});
    assert.equal(result.execution,execution);assert.equal(result.actionError.execution,execution);
    assert.equal(result.distinct,2);
  }
  const f=agentFixture({frames:[a]});f.state.failRender=true;
  const failed=await f.agent.capture(f.device,{action:{tool:'tap'},seconds:0.5},async()=>({execution:'executed',bundleId:'test.example.app'}));
  assert.equal(failed.execution,'executed');assert.equal(failed.action.bundleId,'test.example.app');assert.equal(failed.captureError.code,'RENDER_FAILED');
  const broken=agentFixture({streamError:true});
  const empty=await broken.agent.capture(broken.device,{action:{tool:'tap'},seconds:0.5},async()=>({execution:'executed'}));
  assert.equal(empty.captureError.code,'CAPTURE_FAILED');assert.equal(empty.execution,'not_executed');assert.equal(empty.action,undefined);
});

test('capture rejects interrupted streams with or without frames and preserves every action outcome',async()=>{
  const jpeg=Buffer.from([0xff,0xd8,1,2,0xff,0xd9]);
  for(const terminal of ['exit','close','error','stdout-error'])for(const when of ['before','action','window'])for(const frames of [[],[jpeg]])for(const execution of ['executed','unknown','not_executed']){
    const interrupt=state=>{for(let i=0;i<2;i++)terminal==='stdout-error'?state.stream.stdout.emit('error',Error('pipe failed')):state.stream.emit(terminal,...(terminal==='error'?[Error('stream failed')]:[0]));};
    const f=agentFixture({frames,onDelay(ms,state){state.advance(ms);if((when==='before'&&ms===100)||(when==='window'&&ms===500))interrupt(state);}});
    const result=await f.agent.capture(f.device,{seconds:0.5,_deadline:2000,action:{tool:'tap'}},async()=>{
      if(when==='action')interrupt(f.state);
      if(execution!=='executed')throw new Failure('ACTION_FAILED','action not confirmed',execution);
      return {execution,marker:'original action result'};
    });
    const acted=frames.length&&when!=='before';
    assert.ok(result.captureError);assert.equal(result.sheet,undefined);assert.equal(result.execution,acted?execution:'not_executed');
    assert.ok(!f.state.calls.some(c=>c[1][2]?.endsWith?.('sheet.jxa.js')));
    if(!acted){assert.equal(result.action,undefined);assert.equal(result.actionError,undefined);}
    else if(execution==='executed')assert.equal(result.action.marker,'original action result');
    else assert.equal(result.actionError.execution,execution);
  }
});

test('capture drains trailing stdout after its own stop and bounds missing close with the existing cleanup window',async()=>{
  const a=Buffer.from([0xff,0xd8,1,2,0xff,0xd9]),b=Buffer.from([0xff,0xd8,3,4,0xff,0xd9]);
  for(const mode of ['drained','missing-close','deadline']){
    let drained=false;const signals=[];
    const f=agentFixture({frames:[a],clockStep:0,onDelay(ms,state){
      state.advance(ms);
      if(ms===100)state.stream.kill=signal=>{
        signals.push(signal);
        if(mode!=='drained')return;
        state.stream.emit('exit',null,signal);
        queueMicrotask(()=>{state.stream.stdout.write(b);state.stream.stdout.end();drained=true;state.stream.emit('close',null,signal);});
      };
    },onCommand(_file,args){if(args[2]?.endsWith?.('sheet.jxa.js'))assert.equal(drained,true,'exit alone does not permit rendering');}});
    const result=await f.agent.capture(f.device,{seconds:0.5,_deadline:mode==='deadline'?1000:10000,action:{tool:'tap'}},async()=>({execution:'executed'}));
    assert.equal(result.execution,'executed');assert.ok(f.state.time()<=(mode==='deadline'?1000:10000));
    if(mode==='drained'){assert.ok(result.sheet);assert.equal(result.received,2);assert.equal(result.distinct,2);assert.deepEqual(signals,['SIGTERM']);}
    else {assert.equal(result.captureError.code,'CAPTURE_DRAIN_TIMEOUT');assert.equal(result.sheet,undefined);assert.deepEqual(signals,['SIGTERM','SIGKILL']);}
  }
});

test('capture refuses changed or unconfirmed geometry at action/end boundaries while preserving action execution',async()=>{
  const jpeg=Buffer.from([0xff,0xd8,1,2,0xff,0xd9]);
  const changes=[s=>{s.orientation='landscape-left';},s=>{s.width=800;},s=>{s.target.litPanel='secondary';},s=>{s.target.screenId=2;},s=>{s.target.pixelSize={width:2400,height:2622};},s=>{s.failTree=true;s.failConfirm=true;}];
  for(const change of changes)for(const when of ['action','end'])for(const execution of ['executed','unknown','not_executed']) {
    const f=agentFixture({frames:[jpeg],onDelay:(ms,state)=>{if(ms===500&&when==='end')change(state);}});
    const result=await f.agent.capture(f.device,{seconds:0.5,action:{tool:'tap'}},async()=>{
      if(when==='action')change(f.state);
      if(execution!=='executed')throw new Failure('ACTION_FAILED','ack lost',execution);
      return {execution};
    });
    assert.ok(['SCREEN_CHANGED','SCREEN_UNAVAILABLE'].includes(result.captureError.code));assert.equal(result.execution,execution);
    assert.ok(!f.state.calls.some(c=>c[1][2]?.endsWith?.('sheet.jxa.js')),'uncertain geometry never produces a misleading sheet');
  }
  const f=agentFixture({frames:[jpeg],onDelay:(ms,state)=>{if(ms===500)state.orientation='landscape-left';}});
  const result=await f.agent.capture(f.device,{seconds:0.5},()=>{});
  assert.equal(result.captureError.code,'SCREEN_CHANGED');assert.equal(result.execution,'not_executed');
});

test('capture shares one deadline across before/action/record/check/render and retains the full action outcome',async()=>{
  const jpeg=Buffer.from([0xff,0xd8,1,2,0xff,0xd9]);
  for(const phase of ['before','action','record','check','render','success'])for(const execution of ['executed','unknown','not_executed']){
    let checked=0,acted=0;
    const f=agentFixture({frames:[jpeg],clockStep:0,onDelay:(ms,s)=>s.advance(ms),onCommand:(_file,args,options,s)=>{
      if(args[0]==='input'&&++checked===3&&phase==='check'){s.advance(options.timeout);throw new Failure('COMMAND_TIMEOUT','slow geometry');}
      if(args[2]?.endsWith?.('sheet.jxa.js')&&phase==='render'){s.advance(options.timeout);throw new Failure('COMMAND_TIMEOUT','slow rendering');}
    }});
    if(phase==='before')f.state.advance(109950);
    const result=await f.agent.capture(f.device,{seconds:15,_deadline:110000,action:{tool:'app_launch'}},async()=>{
      acted++;
      if(phase==='action')f.state.advance(109600);
      if(phase==='record')f.state.advance(100000);
      if(phase==='check')f.state.advance(94000);
      if(phase==='render')f.state.advance(90000);
      if(execution!=='executed')throw new Failure('ACTION_FAILED','ack lost',execution);
      return {execution,bundleId:'test.example.app'};
    });
    assert.ok(f.state.time()<=110000,phase+': '+f.state.time());
    assert.equal(result.execution,phase==='before'?'not_executed':execution);
    assert.equal(acted,phase==='before'?0:1);
    if(acted){if(execution==='executed')assert.equal(result.action.bundleId,'test.example.app');else assert.equal(result.actionError.execution,execution);}
    assert.ok(phase==='success'?result.sheet:result.captureError,phase);
    assert.ok(f.state.calls.every(([, ,options])=>options.timeout>0&&options.timeout<=30000));
  }
});

test('all six capture actions inherit the outer deadline, including nested screenshots and partial key sequences',async()=>{
  for(const action of [{tool:'app_launch',args:{bundleId:'test.example.app',screenshot:true,_deadline:Infinity}},
    {tool:'tap',args:{x:10,y:10}},{tool:'gesture',args:{kind:'swipe',from:[10,10],to:[20,20]}},
    {tool:'press',args:{button:'home'}},{tool:'open_url',args:{url:'https://example.test'}},{tool:'type_text',args:{keys:Array(40).fill('a')}}]){
  const jpeg=Buffer.from([0xff,0xd8,1,2,0xff,0xd9]),commands=[];
  const f=agentFixture({frames:[jpeg],clockStep:0,onDelay:(ms,s)=>s.advance(ms),onCommand:(_file,_args,options,s)=>{
    const cost=15000;s.advance(Math.min(cost,options.timeout));if(cost>=options.timeout)throw new Failure('COMMAND_TIMEOUT','slow observation');
  }});
  const {commandBudget}=require(path.join(dir,'budget.cjs'));
  const context={module:{exports:{}},__dirname:dir,Date:{now:f.state.time},process:{platform:'darwin',arch:'arm64',env:{}},
    setTimeout:()=>({unref(){}}),clearTimeout(){},
    require(name){
      if(name==='./budget.cjs')return {commandBudget:(ms,deadline)=>commandBudget(ms,deadline,f.state.time)};
      if(name==='./viewer.cjs')return {};
      if(name==='./agent.cjs')return {createAgent:()=>f.agent};
      if(name==='./apps.cjs')return {createApps:()=>({runningFor:()=>null})};
      if(name==='node:child_process')return {execFile(file,args,options,callback){
        commands.push({file,args,timeout:options.timeout});
        const cost=file.endsWith('sw_vers')?3000:args.includes('--json')||file.endsWith('xcode-select')?5000:file.endsWith('/keyboard')?15000:30000;
        f.state.advance(Math.min(cost,options.timeout));
        const stdout=file.endsWith('sw_vers')?'27.0':args.includes('--json')?JSON.stringify({devices:{r:[{udid:A,state:'Booted'}]}}):'launched';
        queueMicrotask(()=>callback(cost>options.timeout?Error('command timeout'):null,stdout,''));return {stdin:{on(){},end(){}}};
      }};
      return require(name.startsWith('./')?path.join(dir,name):name);
    }};
  vm.runInNewContext(syncFs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
  const result=await context.module.exports.dispatch('capture',{udid:A,seconds:15,action});
  assert.equal(result.execution,['type_text','open_url'].includes(action.tool)?'unknown':'executed',action.tool);assert.ok(result.captureError);
  assert.ok(f.state.time()<=110000,action.tool+': '+f.state.time());
  if(action.tool==='app_launch'){assert.equal(result.action.bundleId,'test.example.app');assert.ok(result.action.screenshot.error);assert.equal(commands.filter(c=>c.args.includes('launch')).length,1);}
  if(action.tool==='type_text')assert.equal(commands.filter(c=>c.file.endsWith('/keyboard')).length,2,'partially completed key sequence is not retried');
  }
});

test('nested capture images remain paths while only the outer contact sheet can attach image bytes',async()=>{
  for(const tool of ['app_launch','tap','gesture','type_text'])for(const enabled of [false,true])for(const failed of [false,true]){
    const jpeg=Buffer.from([0xff,0xd8,1,2,0xff,0xd9]);
    const f=agentFixture({frames:[jpeg],clockStep:0,onDelay:(ms,s)=>s.advance(ms),onCommand:(_file,args)=>{
      if(failed&&args[2]?.endsWith?.('sheet.jxa.js'))throw new Failure('RENDER_FAILED','contact sheet failed');
    }});
    f.agent.settle=async()=>({settled:true});
    const context={module:{exports:{}},__dirname:dir,setTimeout,clearTimeout,process:{platform:'darwin',arch:'arm64',env:{}},require(name){
      if(name==='./viewer.cjs')return {};
      if(name==='./agent.cjs')return {createAgent:()=>f.agent};
      if(name==='./apps.cjs')return {createApps:()=>({runningFor:()=>null})};
      if(name==='node:child_process')return {execFile(file,args,_options,callback){
        const stdout=file.endsWith('sw_vers')?'27.0':args.includes('--json')?JSON.stringify({devices:{r:[{udid:A,state:'Booted'}]}}):'/Xcode';
        queueMicrotask(()=>callback(null,stdout,''));return {stdin:{on(){},end(){}}};
      }};
      return require(name.startsWith('./')?path.join(dir,name):name);
    }};
    vm.runInNewContext(syncFs.readFileSync(path.join(dir,'core.cjs'),'utf8'),context);
    const args=tool==='app_launch'?{bundleId:'test.example.app',screenshot:true}:tool==='tap'?{x:10,y:10,until:'Never'}:tool==='gesture'?{kind:'swipe',from:[10,10],to:[20,20],until:'Never'}:{keys:['a'],until:'Never'};
    const result=await context.module.exports.dispatch('capture',{udid:A,_inline:enabled,seconds:0.5,action:{tool,args:{...args,_inline:true}}});
    assert.equal(result.execution,'executed');
    const shot=tool==='app_launch'?result.action.screenshot:result.action.until.screenshot;
    assert.ok(shot.path,tool);
    assert.ok(!JSON.stringify(result.action).includes('_modelImages'),tool);
    const {_modelImages,...structured}=result;
    assert.equal(!!_modelImages,enabled&&!failed);assert.ok(!JSON.stringify(structured).includes('_modelImages'));
    assert.ok(failed?result.captureError:result.sheet);
  }
});

test('input ACK timers and multi-step gesture waits use the same remaining deadline',async()=>{
  for(const mode of ['ack','steps','wait','expired']){
    let clock=mode==='expired'?1000:0,writes=0,kills=0;const timers=[];
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
    child.kill=()=>{kills++;child.emit('exit',null);};child.stdin.end=()=>child.emit('exit',0);
    child.stdin.write=()=>{writes++;if(mode!=='ack')queueMicrotask(()=>{clock+=600;child.stdout.emit('data','{"ok":true}\n');});};
    const context={module:{exports:{}},setTimeout:(fn,ms)=>{const timer={fn,ms,unref(){}};timers.push(timer);return timer;},clearTimeout:timer=>{timer.cleared=true;},require:name=>require(name.startsWith('./')?path.join(dir,name):name)};
    vm.runInNewContext(syncFs.readFileSync(path.join(dir,'input.cjs'),'utf8'),context);
    const input=context.module.exports,deadline=1000,now=()=>clock;
    const session=input.openSession('/bag',[],{spawnImpl:()=>child,deadline,now});
    const result=input.perform(session,[{envelope:{type:'touch1-down'},waitMs:mode==='wait'?500:0},...(mode==='steps'?[{envelope:{type:'touch1-up'},waitMs:0},{envelope:{type:'tap'},waitMs:0}]:[])],{deadline,now});
    if(mode==='ack'){assert.equal(timers[0].ms,1000);clock=1000;timers[0].fn();}
    await assert.rejects(result,e=>e.execution===(mode==='expired'?'not_executed':'unknown'));
    assert.equal(writes,mode==='expired'?0:mode==='steps'?2:mode==='wait'?2:1);
    assert.ok(timers.every(t=>t.ms<=1000));if(mode==='ack')assert.equal(kills,1);session.close();
  }
});

test('hidden subtrees and unreachable centres never become text tap targets; 3D zoom stays relative to fit',()=>{
  const G=require(path.join(dir,'geometry.cjs')),M=require(path.join(dir,'control-model.js'));
  const frame={x:0,y:0,width:50,height:40},child={role:'AXButton',label:'Wrong',frame};
  const result=G.compactTree({children:[{hidden:true,children:[child]},{children:[{...child,label:'Right'}]}]},{width:100,height:100,orientation:'portrait'});
  assert.deepEqual(result.elements.map(e=>e.label),['Right']);
  assert.equal(G.findElement([{role:'button',label:'Wrong',center:[-1,10]}],{text:'Wrong',view:{width:100,height:100}}).element,null);
  assert.equal(M.zoomFactor({mode:'pct',pct:150},0),1.5);
});

test('parallel viewer startup shares native process and bridge; stop owns both exactly once',async()=>{
  let launches=0,bridges=0,closed=0,controller;const children=new Set();
  const context={module:{exports:{}},__dirname:dir,process:{stderr:{write(){}}},setTimeout,clearTimeout,
    require(name){
      if(name==='node:fs')return {readFileSync:()=>{throw Error('no saved session');},mkdirSync(){},writeFileSync(){},renameSync(){}};
      if(name==='./clipboard.cjs')return {createClipboard:async(_origin,_perform,control)=>{controller=control;bridges++;await new Promise(r=>setImmediate(r));return {devices:new Set(),base:'http://127.0.0.1:1',fragment:'capability',session:{port:1,token:'test'},close:()=>closed++};}};
      if(name==='node:child_process')return {spawn(){launches++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=null;child.signalCode=null;child.kill=signal=>{child.signalCode=signal;queueMicrotask(()=>child.emit('close',null,signal));};queueMicrotask(()=>child.stdout.emit('data',Buffer.from('listening')));return child;}};
      if(name==='node:http')return {get(url,opts,callback){const request=new EventEmitter(),response=new EventEmitter();response.statusCode=200;response.resume=()=>{};queueMicrotask(()=>{callback(response);response.emit('end');});return request;}};
      return require(name.startsWith('./')?path.join(dir,name):name);
    }};
  vm.runInNewContext(syncFs.readFileSync(path.join(dir,'viewer.cjs'),'utf8'),context);
  const viewer=context.module.exports;
  const result=await Promise.all([viewer.openViewer('/bag','/set',children,A,async()=>{}),viewer.openViewer('/bag','/set',children,B,async()=>{})]);
  assert.equal(launches,1);assert.equal(bridges,1);assert.equal(children.size,1);assert.equal(result.length,2);
  const keys=[];
  viewer.configureControls({exclusive:async(fn,key)=>{keys.push(key);return fn();},assertEnabled:async()=>{},touch(){}});
  const lower='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await controller.run(async()=>{},lower);await controller.release({udid:lower});await controller.run(async()=>{});
  assert.deepEqual(keys,['device:'+lower.toUpperCase(),'device:'+lower.toUpperCase(),'*']);
  await viewer.stopViewer();assert.equal(closed,1);assert.equal(children.size,0);
});

test('management view ignores late viewer successes and failures, including returning to the same device',async()=>{
  for(const lateFails of [false,true]) {
    const nodes=new Map(),requests=[];
    const get=id=>{if(!nodes.has(id))nodes.set(id,{replaceChildren(){}});return nodes.get(id);};
    const context={document:{getElementById:get,addEventListener(){}},localStorage:{getItem:()=>null},
      CindySimPages:{locale:()=>new Promise(()=>{}),rpc:()=>{const d=deferred();requests.push(d);return d.promise;},h:()=>({}),GLYPH:{}},CindySimModel:{}};
    vm.runInNewContext(syncFs.readFileSync(path.resolve('baguette-simulator/manage.js'),'utf8')+'\nglobalThis.page={showScreen,hero};',context);
    const old=context.page.showScreen({udid:A});
    await context.page.showScreen({udid:A});await context.page.showScreen({udid:A});
    assert.equal(requests.length,1,'same-device pending render reuses its owner instead of causing BUSY');
    const current=context.page.showScreen({udid:B});requests[1].resolve({ok:true,url:'http://127.0.0.1:1/control?udid=B'});await current;
    if(lateFails)requests[0].reject(Error('late error'));else requests[0].resolve({ok:true,url:'http://127.0.0.1:1/control?udid=A'});
    await old;assert.match(get('screen').src,/udid=B/);assert.equal(get('screen').hidden,false);
    // A -> B -> A: device id alone is insufficient to identify an in-flight request.
    const firstA=context.page.showScreen({udid:A}),middle=context.page.showScreen({udid:B}),lastA=context.page.showScreen({udid:A});
    assert.equal(get('screen').src,'about:blank','a pending selection never leaves the previous device interactive');
    requests[4].resolve({ok:true,url:'http://127.0.0.1:1/control?udid=A&new=1'});await lastA;
    requests[2].reject(Error('obsolete A'));requests[3].reject(Error('obsolete B'));await Promise.all([firstA,middle]);
    assert.match(get('screen').src,/new=1/);assert.equal(get('screen').hidden,false);
    const pending=context.page.showScreen({udid:B});context.page.hero(null);
    requests[5].resolve({ok:true,url:'http://127.0.0.1:1/control?udid=B'});await pending;
    assert.equal(get('screen').hidden,true,'off/empty selection retires pending requests too');
  }
});

test('input acknowledgement loss is unknown, while a proven display bind rejection is not executed',async()=>{
  for(const mode of ['exit','error','stdin','timeout','malformed','null','bind']) {
    let child;
    const context={module:{exports:{}},setTimeout:(fn)=>setImmediate(fn),clearTimeout:clearImmediate,
      require:n=>require(n.startsWith('./')?path.join(dir,n):n)};
    vm.runInNewContext(syncFs.readFileSync(path.join(dir,'input.cjs'),'utf8'),context);
    const input=context.module.exports;
    const session=input.openSession('/bag',[],{spawnImpl:()=>{
      child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{};
      child.stdin.write=()=>queueMicrotask(()=>{
        if(mode==='bind'){child.stderr.emit('data','display bind failed: changed');child.emit('exit',1);}
        if(mode==='exit')child.emit('exit',1);
        if(mode==='error')child.emit('error',Error('transport failed'));
        if(mode==='stdin')child.stdin.emit('error',Error('EPIPE'));
        if(mode==='malformed')child.stdout.emit('data','invalid json\n');
        if(mode==='null')child.stdout.emit('data','null\n');
      });return child;
    }});
    await assert.rejects(input.perform(session,[{envelope:{type:'tap'},waitMs:0}]),e=>e.execution===(mode==='bind'?'not_executed':'unknown'));
  }
});

test('fresh tree and OCR failures never prove that a button is present or text has disappeared',async()=>{
  const f=agentFixture();f.state.treeChildren=[{role:'AXButton',label:'OK',frame:{x:0,y:0,width:50,height:50}}];
  await f.agent.describe(f.device,{});f.state.failTree=true;
  await assert.rejects(f.agent.describe(f.device,{}),e=>e.code==='SCREEN_UNAVAILABLE');
  await assert.rejects(f.agent.tap(f.device,{text:'OK',observe:'none'}),e=>e.code==='SCREEN_UNAVAILABLE');
  assert.equal((await f.agent.waitFor(f.device,{text:'OK',gone:true,timeout:1})).met,false);
  const game=agentFixture();
  assert.equal((await game.agent.waitFor(game.device,{text:'Loading',gone:true,timeout:1})).met,false,'failed OCR is not evidence of absence');
  game.state.ocr=[];
  assert.equal((await game.agent.waitFor(game.device,{text:'Loading',gone:true,timeout:1})).met,true,'a successful empty read does prove absence');
});

test('describe distinguishes successful empty OCR from screenshot, Vision and budget failures',async()=>{
  for(const params of [{},{query:'Continue'},{role:'text'}])for(const mode of ['empty','text','vision','screenshot','budget']){
    const f=agentFixture({onCommand:(file,args,_options,state)=>{
      if(mode==='budget'&&args[0]==='describe-ui')state.advance(2000);
      if(mode==='screenshot'&&args[0]==='screenshot')throw new Failure('SCREENSHOT_FAILED','capture failed');
    }});
    f.state.ocr=mode==='vision'?null:mode==='text'?[{text:'Continue',box:[0.1,0.1,0.2,0.1]}]:[];
    const reading=f.agent.describe(f.device,{...params,...(mode==='budget'?{_deadline:1000}:{})});
    if(['vision','screenshot','budget'].includes(mode))await assert.rejects(reading);
    else {const result=await reading;assert.equal(result.source,'ocr');assert.equal(result.total,mode==='text'?1:0);}
  }
});

test('TV and Vision describe modes always use real OCR, including point and full queries',async()=>{
 for(const runtime of ['tvOS-27','xrOS-27']){
  const f=agentFixture(),device={...f.device,runtime};
  f.state.enumeration='Screen ID: 1\n Device Name: primary\n Pixel Size: {3840, 2160}\n Preferred UI Scale: 2\n';
  f.state.ocr=[{text:'Continue',box:[.1,.1,.2,.1]},{text:'Go',box:[.11,.12,.05,.03]},{text:'Other',box:[.7,.7,.1,.1]}];
  for(const params of [{},{mode:'full'},{x:220,y:140},{query:'continue'},{role:'button'},{x:0,y:0}]){
   const result=await f.agent.describe(device,params);assert.equal(result.source,'ocr');assert.equal(result.tree,undefined);
   if(params.x===220)assert.deepEqual(Array.from(result.elements,e=>e.label),['Go','Continue']);
   else if(params.x===0||params.role==='button')assert.equal(result.elements.length,0);
   else assert.equal(result.total,params.query?1:3);
  }
  assert.ok(!f.state.calls.some(([,args])=>args[0]==='describe-ui'));
  for(const params of [{mode:'full'},{x:220,y:140}]){
   f.state.ocr=null;await assert.rejects(f.agent.describe(device,params),/OCR unavailable/);
   f.state.ocr=[];const empty=await f.agent.describe(device,params);assert.equal(empty.source,'ocr');assert.equal(empty.elements.length,0);
  }
 }
});

test('explicit viewer close survives task polling and worker restart; an unexpected exit can reconnect',async t=>{
  const {createRuntime}=require(path.join(dir,'runtime.cjs'));let wanted=true,live=false,opens=0;
  const bindings=new Map([['task-1',{udid:A}]]),settingsFile=path.join(await temporary(t),'settings.json');
  const make=()=>createRuntime({settingsFile,viewerWanted:()=>wanted,forgetViewer:()=>{wanted=false;},
    existingViewerUrl:()=>live?'http://127.0.0.1:1/control?udid=A#token':null,
    tasks:{get:async s=>bindings.get(s),counts:async()=>({}),bind:async(s,udid)=>bindings.set(s,{udid})},
    dispatch:async(method)=>{if(method==='devices')return {devices:[{udid:A,state:'Booted'}]};if(method==='close_viewer')live=false;if(method==='open_viewer'){opens++;live=true;wanted=true;return {url:'http://127.0.0.1:1/control?udid=A#token'};}return {ok:true};}});
  let runtime=make();await runtime.request('task_state',{_task:'task-1'});assert.equal(opens,1);
  await runtime.request('viewer',{action:'close'});
  for(let i=0;i<2;i++){const state=await runtime.request('task_state',{_task:'task-1'});assert.equal(state.viewer,null);assert.equal(state.viewerClosed,true);}
  runtime=make();assert.equal((await runtime.request('task_state',{_task:'task-1'})).viewer,null);assert.equal(opens,1);
  const reopened=await runtime.request('task_bind',{_task:'task-1',udid:A});assert.equal(opens,2);assert.equal(reopened.viewerClosed,false);assert.ok(reopened.viewer);
  live=false;runtime=make();assert.ok((await runtime.request('task_state',{_task:'task-1'})).viewer);assert.equal(opens,3);
});

test('launches on different devices run independently and retain both shared App records',async t=>{
  const {createRuntime}=require(path.join(dir,'runtime.cjs'));const root=await temporary(t),hold=deferred(),started=deferred();
  const settingsFile=path.join(root,'settings.json');
  const dispatch=async(method,p={})=>{if(method==='launch_app'&&p.udid===A){started.resolve();await hold.promise;}return {ok:true};};
  const runtime=createRuntime({settingsFile,dispatch});
  const first=runtime.request('launch_app',{udid:A,bundleId:'test.example.a'});await started.promise;
  assert.equal((await runtime.request('launch_app',{udid:B,bundleId:'test.example.b'})).ok,true);
  for(const method of ['app_uninstall','erase_device','delete_device'])assert.equal((await runtime.request(method,{udid:B,bundleId:'test.example.b'})).ok,true);
  assert.deepEqual(await runtime.request('logs',{udid:B}),{ok:true});
  hold.resolve();await first;await runtime.request('launch_app',{udid:B,bundleId:'test.example.b'});
  const reloaded=createRuntime({settingsFile,dispatch});
  assert.equal(await reloaded.currentApp(A),'test.example.a');assert.equal(await reloaded.currentApp(B),'test.example.b');
});

function pageFixture(kind) {
  const nodes=new Map(),requests=[],memoryNotices=[];let push;
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,{dataset:{},setAttribute(){},replaceChildren(){},append(){},querySelector(){return null;},querySelectorAll(){return [];},classList:{contains:()=>false,toggle(){}}});
    return nodes.get(id);
  };
  const context={URLSearchParams,addEventListener(){},location:{search:'?session=task-1'},document:{getElementById:get,addEventListener(){},hidden:false},
    localStorage:{getItem:()=>null},clearTimeout(){},setTimeout:()=>0,
    CindySimPages:{locale:()=>new Promise(()=>{}),onPush:fn=>{push=fn;},createDevice:async()=>({udid:B}),memoryArgs:()=>({memoryMode:'saving'}),memoryPicker:()=>null,memoryBadge:()=>null,resourceButton:()=>({}),
      rpc:(action,params)=>{const d=deferred();requests.push({...d,action,params});return d.promise;},
      h:()=>({}),GLYPH:{iphone:'',big:'',pause:''}},CindySimModel:{runtimeLabel:()=>'',deviceRows:()=>[],showMemoryNotice:(...args)=>memoryNotices.push(args)}};
  const expose=kind==='task'
    ? 'globalThis.page={refresh,act,createDevice,state:()=>state,note:()=>note,seed:r=>{state=r;show(r.viewer?.url);}};'
    : 'globalThis.page={refresh,act,showScreen,hero,state:()=>state,seed:r=>{state=r;selected=r.devices[0]?.udid;}};';
  vm.runInNewContext(syncFs.readFileSync(path.resolve(`baguette-simulator/${kind}.js`),'utf8')+'\n'+expose,context);
  return {page:context.page,get,requests,memoryNotices,push:m=>push(m)};
}
const taskState=udid=>({ok:true,settings:{enabled:true},devices:[],device:{udid,state:'Booted'},viewer:{url:`http://127.0.0.1:1/control?udid=${udid}`}});

test('task, management and settings boot surfaces retain the result for the common memory warning',async()=>{
 const result={...taskState(A),memoryMode:{mode:'minimal',verified:false,warning:'verification failed'}};
 const task=pageFixture('task');task.page.seed(taskState(A));
 const pending=task.page.act('task_boot',{udid:A},A);task.requests[0].resolve(result);await pending;
 assert.equal(task.memoryNotices[0][0],result);assert.equal(task.memoryNotices[0][2],'saving');
 assert.equal(task.get('screen').hidden,false,'a warning does not undo the completed boot');
 const hub=pageFixture('manage'),device={udid:A,name:'Phone',state:'Shutdown'};
 hub.page.seed({ok:true,settings:{enabled:true},devices:[device]});
 const boot=hub.page.act('boot',device);hub.requests[0].resolve(result);await new Promise(r=>setImmediate(r));
 assert.equal(hub.memoryNotices[0][0],result);assert.equal(hub.memoryNotices[0][2],'saving');
 hub.requests[1].resolve({ok:true,settings:{enabled:true},devices:[{...device,state:'Booted'}]});await boot;
 const notices=[],nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',replaceChildren(){},classList:{toggle(){}}});return nodes.get(id);};
 const context={BroadcastChannel:class{},document:{documentElement:{lang:'zh-CN'},getElementById:get},
  CindySimModel:{deviceRows:()=>[],showMemoryNotice:(...args)=>notices.push(args)},CindySimPages:{memoryArgs:()=>({memoryMode:'standard'})},
  fetch:()=>new Promise(()=>{}),result,device};
 vm.createContext(context);vm.runInContext(syncFs.readFileSync(path.resolve('baguette-simulator/settings.js'),'utf8'),context);
 await vm.runInContext("state={settings:{enabled:true},devices:[device]};rpc=async()=>result;refresh=async()=>{};render=()=>{};perform('boot',{udid:device.udid})",context);
 assert.equal(notices[0][0],result);assert.equal(notices[0][1],'zh-CN');assert.equal(notices[0][2],'standard');
});

test('task and management pages report saved bindings with failed status without showing old task screens or claiming opened',async()=>{
  const result={ok:true,execution:'executed',sessionId:'task-1',boundUdid:B,taskStateError:{code:'STATUS_FAILED'}};
  const f=pageFixture('task');f.page.seed(taskState(A));
  const operation=f.page.act('task_bind',{udid:B},B);f.requests[0].resolve(result);await operation;
  assert.equal(f.get('screen').src,'about:blank');assert.equal(f.page.state(),null);
  assert.match(f.page.note().text,/operation completed/);
  assert.equal(f.requests[1].action,'task_state','refresh reads state rather than replaying binding');
  f.requests[1].resolve(taskState(B));await new Promise(r=>setImmediate(r));
  assert.match(f.get('screen').src,new RegExp(B));assert.ok(!new RegExp(A).test(f.get('screen').src));
  const hub=pageFixture('manage');hub.page.seed({ok:true,settings:{enabled:true},devices:[]});
  const opened=hub.page.act('open_in_task',{udid:B},'opened');hub.requests[0].resolve(result);
  await new Promise(r=>setImmediate(r));
  assert.match(hub.get('message').textContent,/binding was saved/);assert.notEqual(hub.get('message').textContent,'opened');
  hub.requests[1].reject(Error('refresh unavailable'));await opened;
  assert.match(hub.get('message').textContent,/binding was saved/);
  // A management-originated binding must also retire an old task read/screen.
  const pushed=pageFixture('task');pushed.page.seed(taskState(A));const old=pushed.page.refresh();
  pushed.push({type:'viewer',sessionId:'task-1',udid:B,url:'',taskStateError:result.taskStateError});
  assert.equal(pushed.get('screen').src,'about:blank');assert.equal(pushed.page.state(),null);
  pushed.requests[0].resolve(taskState(A));await old;
  assert.equal(pushed.get('screen').src,'about:blank','late old state cannot undo the saved binding notification');
});

test('task RPC results have one owner across polling, binding, boot, creation and viewer pushes',async()=>{
  for(const lateFails of [false,true])for(const action of ['task_bind','task_boot','create']) {
    const f=pageFixture('task');f.page.seed(taskState(A));
    const old=f.page.refresh();
    const current=action==='create'?f.page.createDevice():f.page.act(action,{udid:B},B);
    await new Promise(r=>setImmediate(r));
    await f.page.refresh();assert.equal(f.requests.length,2,'polls do not overlap an action');
    f.requests[1].resolve(taskState(B));await current;
    if(lateFails)f.requests[0].reject(Error('old device unavailable'));else f.requests[0].resolve(taskState(A));
    await old;
    assert.equal(f.page.state().device.udid,B);assert.match(f.get('screen').src,new RegExp(B));assert.equal(f.page.note(),null);
  }
  for(const lateFails of [false,true]) {
    const f=pageFixture('task');f.page.seed(taskState(A));
    const first=f.page.refresh();await f.page.refresh();
    assert.equal(f.requests.length,1,'a slow read is not superseded by polling');
    if(lateFails)f.requests[0].reject(Error('slow poll'));else f.requests[0].resolve(taskState(A));
    await first;
    const second=f.page.refresh();f.requests[1].resolve(taskState(B));await second;
    assert.match(f.get('screen').src,new RegExp(B));assert.equal(f.page.note(),null);
    const action=f.page.act('task_bind',{udid:A},A);
    f.push({type:'viewer',sessionId:'task-1',url:taskState(B).viewer.url});
    if(lateFails)f.requests[2].reject(Error('late bind'));else f.requests[2].resolve(taskState(A));
    await action;assert.match(f.get('screen').src,new RegExp(B));assert.equal(f.page.note(),null);
  }
});

test('task and management polling waits for slow reads and resumes after every settlement',async()=>{
  for(const kind of ['task','manage'])for(const outcome of ['success','error','timeout','not-ok']){
    const f=pageFixture(kind),state=kind==='task'?taskState(B):{ok:true,settings:{enabled:true},devices:[]};
    const reading=f.page.refresh();
    for(let i=0;i<8;i++)await f.page.refresh();
    assert.equal(f.requests.length,1,'timer and visibility refreshes reuse the slow read');
    if(outcome==='success')f.requests[0].resolve(state);
    else if(outcome==='not-ok')f.requests[0].resolve({ok:false,errorCode:'READ_FAILED'});
    else f.requests[0].reject(Object.assign(Error(outcome),{code:outcome==='timeout'?'TIMEOUT':'READ_FAILED'}));
    await reading;
    const next=f.page.refresh();assert.equal(f.requests.length,2,'settled reads release ownership');
    f.requests[1].resolve(state);await next;assert.equal(f.page.state().ok,true);
  }
});

test('management refresh failures cannot replace a successful erase or delete result',async()=>{
  for(const action of ['erase','delete']){
    const f=pageFixture('manage'),d={udid:A,name:'Phone',state:'Booted'};
    f.page.seed({ok:true,settings:{enabled:true},devices:[d]});
    const operation=f.page.act(action,d,'operation completed');
    f.requests[0].resolve({ok:true,udid:A,execution:'executed'});
    await new Promise(r=>setImmediate(r));
    assert.equal(f.get('message').textContent,'operation completed');
    assert.equal(f.requests[1].action,'manage_state');
    f.requests[1].reject(Error('device list unavailable'));await operation;
    assert.equal(f.get('message').textContent,'operation completed');
    assert.equal(f.requests.filter(r=>r.action===action).length,1,'a failed refresh never replays the destructive operation');
    // Rendering the previous list may check its old viewer; that is separate
    // from the completed mutation and cannot replace its success message.
    f.requests.find(r=>r.action==='viewer_url')?.resolve({ok:false,errorCode:'DEVICE_NOT_OWNED'});
  }
});

test('management actions retire old refreshes and unload the iframe for shutdown, erase and delete',async()=>{
  for(const action of ['shutdown','erase','delete'])for(const fails of [false,true]) {
    const f=pageFixture('manage'),d={udid:A,name:'Phone',state:'Booted'};
    const state={ok:true,settings:{enabled:true},devices:[d]};f.page.seed(state);
    const opening=f.page.showScreen(d);f.requests[0].resolve({ok:true,url:taskState(A).viewer.url});await opening;
    const old=f.page.refresh(),operation=f.page.act(action,d);
    assert.equal(f.get('screen').src,'about:blank','starting the action unloads the real frame');
    assert.equal(f.get('screen').hidden,true);
    f.requests[1].resolve(state);await old;
    assert.equal(f.get('screen').src,'about:blank','old manage_state cannot reopen it');
    if(fails)f.requests[2].reject(Error('action failed'));else f.requests[2].resolve({ok:true});
    await new Promise(r=>setImmediate(r));
    const read=f.requests.at(-1);assert.equal(read.action,'manage_state');
    const devices=action==='delete'?[]:[{...d,state:'Shutdown'}];read.resolve({...state,devices});await operation;
    assert.equal(f.get('screen').src,'about:blank');assert.equal(f.get('screen').hidden,true);
  }
  // A new viewer request has no URL yet while an older iframe is still loaded.
  const f=pageFixture('manage');f.page.seed({ok:true,devices:[],settings:{enabled:true}});
  const first=f.page.showScreen({udid:A});f.requests[0].resolve({ok:true,url:taskState(A).viewer.url});await first;
  const pending=f.page.showScreen({udid:B});f.page.hero(null);
  assert.equal(f.get('screen').src,'about:blank');
  f.requests[1].resolve({ok:true,url:taskState(B).viewer.url});await pending;
  assert.equal(f.get('screen').src,'about:blank','late viewer cannot resurrect an unloaded page');
});

const rectangular = (name,width,height,scale) => `Screen ID: 1
 Device Name: ${name}
 Pixel Size: {${width}, ${height}}
 Preferred UI Scale: ${scale}
`;
test('Vision Pro maps view points to a spatial ray; TV and spatial drags never send phone touches',async()=>{
 const f=agentFixture();f.device.runtime='com.apple.CoreSimulator.SimRuntime.xrOS-27-0';
 f.state.enumeration=rectangular('primary',3840,2160,2);
 await f.agent.tap(f.device,{x:1152,y:648,observe:'none'});
 const call=f.state.calls.find(([file])=>file.endsWith('/native/spatial'));
 assert.deepEqual(Array.from(call[1].slice(3)),['0.6','0.6',String(16/9),'0.1','1']);
 assert.equal(call[2].mutation,true);assert.equal(f.state.inputs.length,0);
 await f.agent.gesture(f.device,{kind:'swipe',from:[100,100],to:[200,200],observe:'none'});
 assert.equal(f.state.spatial.params.action,'drag');assert.equal(f.state.inputs.length,0);
 await f.agent.gesture(f.device,{kind:'spatial',action:'reset',observe:'none'});
 assert.equal(f.state.spatial.params.action,'reset');
 f.device.runtime='com.apple.CoreSimulator.SimRuntime.tvOS-27-0';f.agent.forget(f.device.udid);
 f.state.enumeration=rectangular('external-0',1920,1080,1);
 await assert.rejects(f.agent.tap(f.device,{x:100,y:100}),e=>e.code==='UNSUPPORTED_INPUT');
 const before=f.state.calls.length;
 await assert.rejects(f.agent.setState(f.device,{appearance:'dark',orientation:'portrait'}),e=>e.code==='UNSUPPORTED_INPUT');
 assert.equal(f.state.calls.length,before);
});
test('management never announces a partial Android erase/delete as completed',async()=>{
  for(const action of ['erase','delete']){
    const f=pageFixture('manage'),d={udid:A,name:'Phone',state:'Shutdown'};
    f.page.seed({ok:true,settings:{enabled:true},devices:[d]});
    const operation=f.page.act(action,d,'operation completed');
    f.requests[0].resolve({ok:true,udid:A,outcome:'partial',execution:'unknown',completedSteps:[{step:'shutdown'}],failedStep:'erase-entry',deviceError:{code:'EACCES'}});
    await new Promise(r=>setImmediate(r));assert.notEqual(f.get('message').textContent,'operation completed');assert.ok(f.get('message').textContent.length>0);
    assert.equal(f.requests[1].action,'manage_state');f.requests[1].resolve({ok:true,settings:{enabled:true},devices:[d]});await operation;
    assert.equal(f.requests.filter(r=>r.action===action).length,1);
  }
});
