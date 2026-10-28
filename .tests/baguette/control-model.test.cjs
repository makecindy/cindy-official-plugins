const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../../baguette-simulator/node/control-model.js');
test('restart submits the exact device and chosen mode in one operation, without retries',async()=>{
 const device={udid:'target',runtime:'iOS 27.0'};
 for(const mode of ['saving','standard','minimal']){
  const calls=[];
  const result=await M.restartMemoryMode(device,mode,async(action,args)=>{calls.push({action,args});return {ok:true,memoryMode:{mode,verified:true}};});
  assert.equal(result.memoryMode.mode,mode);
  assert.deepEqual(calls,[{action:'restart_device',args:{udid:'target',memoryMode:mode}}]);
 }
 let writes=0;
 await assert.rejects(M.restartMemoryMode(device,'custom',()=>{writes++;}),/INVALID_ARGUMENT/);
 assert.equal(writes,0);
 const calls=[];
 await assert.rejects(M.restartMemoryMode(device,'saving',async(action)=>{calls.push(action);return {ok:false};}),/BOOT_UNCONFIRMED/);
 assert.deepEqual(calls,['restart_device']);
});
const udid='00000000-0000-4000-8000-000000000001';
const booted={ready:true,parked:false,generation:1,device:{udid,name:'iPhone 17 Pro',state:'Booted',runtime:'com.apple.CoreSimulator.SimRuntime.iOS-27-1',deviceType:'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro'},settings:{enabled:true,idleMinutes:15},idleDeadline:0};

test('memory status never substitutes the default choice for missing live evidence',()=>{
 const d=booted.device;
 for(const lang of ['zh-CN','en','ja','ko']){
  const unknown=M.memoryStatus(d,lang);
  assert.ok(unknown.includes(M.memoryLabel('unknown',lang)));
  for(const mode of ['saving','minimal','standard','custom']){
   assert.ok(M.memoryStatus({...d,memoryMode:{mode,verified:true}},lang).includes(M.memoryLabel(mode,lang)));
  }
  assert.notEqual(M.memoryStatus({...d,memoryMode:{mode:'saving',verified:false}},lang),M.memoryStatus({...d,memoryMode:{mode:'saving',verified:true}},lang));
  assert.equal(M.memoryStatus({...d,state:'Shutdown'},lang),'');
  assert.equal(M.memoryStatus({...d,state:'Booting',memoryMode:{mode:'saving',verified:true}},lang),unknown);
  for(const runtime of ['android:36','tvOS-27','xrOS-27'])assert.equal(M.memoryStatus({...d,runtime},lang),'');
 }
});

test('memory notice distinguishes unverified, mismatched and warning results from confirmed boots',()=>{
 for(const lang of ['en','zh-CN','ja','ko']) {
  assert.equal(M.memoryNotice({},lang,'standard'),'');
  assert.equal(M.memoryNotice({memoryMode:{mode:'standard',verified:true}},lang,'standard'),'');
  assert.ok(M.memoryNotice({memoryMode:{mode:'standard',verified:false,warning:'diagnostic'}},lang,'standard').includes('diagnostic'));
  assert.ok(M.memoryNotice({memoryMode:{mode:'minimal',verified:true,requested:'standard'}},lang));
  assert.ok(M.memoryNotice({memoryMode:{mode:'custom',verified:true}},lang,'standard'));
 }
});

test('presence and overlay reflect device, service and page state in priority order',()=>{
 assert.deepEqual(M.presence(booted),{tone:'on',key:'connected'});assert.equal(M.overlay(booted),null);
 assert.equal(M.overlay({...booted,ready:false,parked:true}).kind,'offline');assert.equal(M.presence({...booted,ready:false,parked:true}).tone,'warn');
 assert.equal(M.overlay({...booted,ready:false,parked:false}).kind,'connecting');
 assert.equal(M.overlay({...booted,device:{...booted.device,state:'Shutdown'}}).kind,'off');
 assert.equal(M.overlay({...booted,device:{...booted.device,state:'Booting'}}).kind,'booting');
 assert.equal(M.overlay({...booted,settings:{enabled:false}}).kind,'paused');
 assert.equal(M.overlay(null).kind,'connecting');
 assert.deepEqual(M.presence(null),{tone:'busy',key:'connecting'});
 assert.equal(M.overlay(null,{lost:true}).kind,'offline');
 assert.deepEqual(M.presence(null,{lost:true}),{tone:'off',key:'offline'});
 assert.equal(M.overlay(booted,{switching:true,phase:'booting'}).kind,'switching');
 assert.equal(M.overlay({...booted,device:{...booted.device,state:'Shutdown'}},{recovering:true}).kind,'recovering','page flags win over device state');
});

test('idle countdown appears only inside the final minute of a running, enabled device',()=>{
 const now=1_000_000;
 assert.equal(M.idleLeft({...booted,idleDeadline:now+90_000},now),null);
 assert.equal(M.idleLeft({...booted,idleDeadline:now+42_400},now),43);
 assert.equal(M.idleLeft({...booted,idleDeadline:now-5000},now),0);
 assert.equal(M.idleLeft({...booted,idleDeadline:now+30_000,settings:{enabled:false}},now),null);
 assert.equal(M.idleLeft({...booted,idleDeadline:now+30_000,device:{...booted.device,state:'Shutdown'}},now),null);
 assert.equal(M.idleLeft({...booted,idleDeadline:null},now),null);
 assert.equal(M.clock(65),'1:05');assert.equal(M.clock(0),'0:00');
});

test('device rows hide the UDID, label the runtime and keep the current device first',()=>{
 const rows=M.deviceRows([
  {udid:'b',name:'Zed iPad',state:'Shutdown',runtime:'com.apple.CoreSimulator.SimRuntime.iOS-27-0',deviceType:'com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-M4'},
  {udid:'a',name:'Alpha',state:'Booted',runtime:'com.apple.CoreSimulator.SimRuntime.iOS-26-4',deviceType:'x.iPhone-17'},
  {udid,name:'Mine',state:'Shutdown',runtime:'iOS 27.1',deviceType:'x.iPhone-17-Pro',isAvailable:false},
 ],udid,'zh-CN');
 assert.deepEqual(rows.map(r=>r.udid),[udid,'a','b']);
 assert.equal(rows[0].current,true);assert.equal(rows[0].available,false);assert.equal(rows[0].meta,'iOS 27.1 · 已关闭');
 assert.equal(rows[1].meta,'iOS 26.4 · 运行中');assert.equal(rows[1].tone,'on');
 assert.equal(rows[2].family,'ipad');assert.equal(rows[2].meta,'iOS 27.0 · 已关闭');
 assert.ok(!JSON.stringify(rows).includes('00000000-0000-4000-8000-000000000001".slice'),'rows never expose UDID fragments as labels');
 assert.equal(M.runtimeLabel('com.apple.CoreSimulator.SimRuntime.iOS-27-1'),'iOS 27.1');assert.equal(M.runtimeLabel(''),'');
});

test('screen corner radius follows the device family',()=>{
 assert.equal(M.screenRadius({deviceType:'x.iPhone-17-Pro'},300),39);
 assert.equal(M.screenRadius({deviceType:'x.iPad-Pro-13-inch'},600),21);
 assert.equal(M.screenRadius({deviceType:'x.iPhone-17'},0),0);
});

test('the one-tap default is the newest iPhone that has a compatible runtime, on its newest runtime',()=>{
 const catalog={
  deviceTypes:[
   {name:'iPad Pro 13-inch (M4)',identifier:'t.iPad',minRuntimeVersion:'17.0'},
   {name:'iPhone 17',identifier:'t.iPhone17',minRuntimeVersion:'26.0'},
   {name:'iPhone 17 Pro',identifier:'t.iPhone17Pro',minRuntimeVersion:'26.0'},
   {name:'iPhone Duo',identifier:'t.Duo',minRuntimeVersion:'27.1'},
  ],
  runtimes:[
   {name:'iOS 26.4',identifier:'r.26.4',version:'26.4'},
   {name:'iOS 27.0',identifier:'r.27.0',version:'27.0',supportedDeviceTypes:['t.iPhone17','t.iPhone17Pro','t.iPad']},
   {name:'iOS 27.1',identifier:'r.27.1',version:'27.1',supportedDeviceTypes:['t.Duo']},
  ]};
 // Real case: simctl lists types newest first and "New iPhone" created an iPhone 11.
 // The newest numbered Pro wins in any order; the foldable is not the default.
 assert.deepEqual(M.defaultChoice(catalog),{deviceType:'t.iPhone17Pro',runtime:'r.27.0',name:'iPhone 17 Pro'});
 const listed={...catalog,deviceTypes:[{name:'iPhone 18 Pro',identifier:'t.iPhone18Pro'},{name:'iPhone Duo',identifier:'t.Duo'},{name:'iPhone 17',identifier:'t.iPhone17'},{name:'iPhone 11',identifier:'t.iPhone11'}],
  runtimes:[{name:'iOS 27.0',identifier:'r.27.0',version:'27.0',supportedDeviceTypes:['t.iPhone18Pro','t.iPhone17','t.iPhone11']}]};
 assert.equal(M.defaultChoice(listed).name,'iPhone 18 Pro');
 assert.equal(M.defaultChoice({...listed,deviceTypes:[...listed.deviceTypes].reverse()}).name,'iPhone 18 Pro');
 assert.deepEqual(M.defaultChoice({...catalog,deviceTypes:catalog.deviceTypes.filter(d=>!/^iPhone \d/.test(d.name))}),{deviceType:'t.Duo',runtime:'r.27.1',name:'iPhone Duo'},'other iPhones before iPads');
 assert.deepEqual(M.runtimesFor(catalog,'t.iPad').map(r=>r.identifier),['r.26.4','r.27.0']);
 assert.deepEqual(M.runtimesFor(catalog,'t.Duo').map(r=>r.identifier),['r.27.1']);
 assert.equal(M.defaultChoice({deviceTypes:catalog.deviceTypes,runtimes:[]}),null);
});

test('zoom steps from any percentage to the next Simulator-style step, and stays relative to the fitted size',()=>{
 assert.equal(M.zoomStep(57,1),67);assert.equal(M.zoomStep(57,-1),50);assert.equal(M.zoomStep(100,1),125);assert.equal(M.zoomStep(100,-1),75);
 assert.equal(M.zoomStep(300,1),300);assert.equal(M.zoomStep(25,-1),25);assert.equal(M.zoomStep(66.8,1),75,'a step within half a percent counts as the current one');
 assert.equal(M.zoomFactor({mode:'fit'},57),1);assert.equal(M.zoomFactor({mode:'pct',pct:100},50),2);
 assert.equal(M.zoomFactor({mode:'pct',pct:100},0),1,'unknown fitted size (3D stage) keeps the fitted frame');
 assert.equal(M.zoomFactor({mode:'pct',pct:300},10),6);assert.equal(M.zoomFactor({mode:'pct',pct:25},200),0.2);
 assert.equal(M.zoomPct({mode:'fit'},57.4),57);assert.equal(M.zoomPct({mode:'pct',pct:150},57),150);assert.equal(M.zoomPct({mode:'fit'},0),100);
});

test('TV and Vision keep their platform, rectangular frame and compatible runtimes',()=>{
 const tv={identifier:'com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K',name:'Living Room',productFamily:'Apple TV'};
 const vision={identifier:'com.apple.CoreSimulator.SimDeviceType.Apple-Vision-Pro-4K',name:'Spatial',productFamily:'Apple Vision'};
 const phone={identifier:'t.iPhone',name:'iPhone 17'};
 const runtimes=[{identifier:'r.iOS-27-0',version:'27.0'},{identifier:'r.tvOS-27-0',version:'27.0'},{identifier:'r.xrOS-27-0',version:'27.0'}];
 const catalog={deviceTypes:[tv,vision,phone],runtimes};
 for(const [d,kind,label,index] of [[tv,'tv','tvOS',1],[vision,'vision','visionOS',2]]){
  assert.equal(M.family(d),kind);assert.equal(M.platform(d),label);
  assert.equal(M.screenRadius(d,1920),0);
  assert.deepEqual(M.runtimesFor(catalog,d.identifier),[runtimes[index]],'same version does not imply same platform');
  assert.equal(M.runtimeLabel(runtimes[index].identifier),label+' 27.0');
 }
 assert.equal(M.defaultChoice(catalog).deviceType,phone.identifier,'adding TV and Vision must not change the default phone');
 assert.equal(M.defaultChoice({...catalog,deviceTypes:[tv]}).runtime,runtimes[1].identifier);
 assert.deepEqual(M.runtimesFor({...catalog,runtimes:[{...runtimes[1],supportedDeviceTypes:[]}]},tv.identifier),[]);
});
