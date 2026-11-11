'use strict';
// A task that lives on another of the account's computers. The task page is
// the same page; its actions go to the plugin on that computer, which runs its
// own worker methods, and the picture comes through Cindy. Nothing on the
// viewing computer is started, listed or bound, and every state says "remote".
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const settle=(ms=10)=>new Promise(r=>setTimeout(r,ms));
const plain=value=>JSON.parse(JSON.stringify(value));
const HOST='http://127.0.0.1:7/'+'c'.repeat(64);
const SIM={udid:'SIM-1',name:'iPhone Air',state:'Booted',runtime:'com.apple.CoreSimulator.SimRuntime.iOS-27-3',deviceType:'iPhone-Air',isAvailable:true,thisTask:true,tasks:1,activeTasks:1,thisTaskActive:true,
  dataPath:'/Users/someone/Library/private',memoryMode:{mode:'saving',verified:true,disabledServices:56}};
const OFF={udid:'SIM-2',name:'iPad mini',state:'Shutdown',runtime:'com.apple.CoreSimulator.SimRuntime.iOS-27-3',deviceType:'iPad-mini',productFamily:'iPad',isAvailable:true,tasks:0};
const PHONE={udid:'PHONE-1',name:'My iPhone',state:'Booted',kind:'physical'};

// Two logic pages of the same plugin on two computers, joined by Cindy's request channel.
function computers({providerHandles=true,providerWorker}={}){
  const pages={},delivered=[];
  function page(self,peer,{worker,view}){
    const buses=new Map(),waiting=new Map();
    class BroadcastChannel{constructor(n){this.name=n;this.onmessage=null;(buses.get(n)||buses.set(n,new Set()).get(n)).add(this);}postMessage(data){for(const p of buses.get(this.name))if(p!==this)queueMicrotask(()=>p.onmessage?.({data}));}}
    const calls=[];let handler,sequence=0;
    const cindy={onHostMessage:fn=>handler=fn,request:async()=>({ok:true,context:{locale:'zh-CN'}}),send:async()=>({}),
      node:{request:async r=>{calls.push(r);if(r.method==='device_hold')return {ok:true,result:{running:false}};return {ok:true,result:await worker(r)};}},
      deviceSync:async r=>{
        if(r.op==='status')return {ok:true,version:1,online:true,peers:[{deviceId:peer,deviceName:peer==='studio'?'Mac Studio':'MacBook'}]};
        if(r.op==='reply'){waiting.get(r.requestId)?.({ok:true,data:r.data});waiting.delete(r.requestId);return {ok:true};}
        // A plugin there that does not answer leaves the result unknown, as Cindy reports it.
        if(!pages[r.peer]?.receives)return {ok:false,errorCode:'SYNC_RESULT_UNKNOWN'};
        delivered.push(plain(r.data));
        const requestId=`${self}-${++sequence}`;
        return new Promise(resolve=>{pages[r.peer].waiting.set(requestId,resolve);void pages[r.peer].deliver({type:'device-sync-request',requestId,peer:self,data:plain(r.data)});});
      }};
    if(view)cindy.liveScreenView=async r=>view(r);
    vm.runInNewContext(fs.readFileSync('cindy-simulator/main.js','utf8'),{cindy,BroadcastChannel,Object,String,Promise,Set,Map,RegExp,Array,JSON,Date,Math,queueMicrotask,setTimeout});
    const channel=new BroadcastChannel('baguette-pages'),replies=[];
    channel.onmessage=({data})=>{if(data.type==='response')replies.push(data);};
    const ask=async params=>{const id='r'+replies.length;channel.postMessage({type:'request',id,action:'remote_task',deviceId:peer,...params});await settle(20);return replies.find(r=>r.id===id)?.result;};
    return pages[self]={calls,ask,waiting,deliver:m=>handler(m),receives:true};
  }
  const state={device:SIM,devices:[SIM,OFF,PHONE],settings:{enabled:true,idleMinutes:15}};
  const provider=page('studio','laptop',{worker:providerWorker||(async r=>
    r.method==='remote_task_state'?{ok:true,sessionId:r.params._task,...state}
    :r.method==='viewer_catalog'?{ok:true,platforms:{android:{ready:false,sdkRoot:'/private/sdk'}},deviceTypes:[{identifier:'iPhone-Air',name:'iPhone Air',minRuntimeVersion:'27.0',bundlePath:'/private'}],runtimes:[{identifier:'iOS-27-3',name:'iOS 27.3',version:'27.3',supportedDeviceTypes:['iPhone-Air'],bundlePath:'/private'}]}
    :r.method==='create_device'?{ok:true,udid:'SIM-NEW',name:r.params.name,dataPath:'/private'}
    :{ok:true,execution:'executed'})});
  provider.receives=providerHandles;
  const viewer=page('laptop','studio',{worker:async r=>({ok:true,ready:true,url:'http://127.0.0.1:9/control?udid='+r.params.id+'#cindyClipboard=9.t'}),
    view:async r=>r.op==='screens'?{ok:true,screens:[{id:'SIM-1',name:'iPhone Air',platform:'ios',taskIds:['task-1']},{id:'SIM-9',name:'Other task',platform:'ios',taskIds:['task-2']}]}:{ok:true,view:'lv-1',url:HOST}});
  return {provider,viewer,delivered,state};
}

test('the first look shows the running device at once, then the plugin there answers for the whole task',async()=>{
  const {provider,viewer}=computers();
  // Before that plugin has answered: what Cindy lists, view only, already named for its computer.
  const first=await viewer.ask({call:'task_state',sessionId:'task-1'});
  assert.deepEqual(plain(first.remote),{computer:'Mac Studio',manage:false});
  assert.equal(first.device.udid,'SIM-1');assert.equal(first.viewer.url,'http://127.0.0.1:9/control?udid=SIM-1#cindyClipboard=9.t');
  // Then its own state: the task's device and that computer's simulators, never its attached phones or paths.
  const state=await viewer.ask({call:'task_state',sessionId:'task-1'});
  assert.deepEqual(plain(state.remote),{computer:'Mac Studio',manage:true});
  assert.deepEqual(state.devices.map(d=>d.udid),['SIM-1','SIM-2']);
  assert.equal(JSON.stringify(state).includes('private'),false);
  assert.deepEqual(plain(state.device.memoryMode),{mode:'saving',verified:true});
  assert.equal(state.viewer.udid,'SIM-1');
  const opened=viewer.calls.filter(c=>c.method==='remote_viewer').at(-1).params;
  assert.deepEqual({id:opened.id,url:opened.url,platform:opened.platform,computer:opened.computer,manage:opened.manage,task:opened._task,devices:opened.devices.map(d=>d.udid)},
    {id:'SIM-1',url:HOST,platform:'ios',computer:'Mac Studio',manage:true,task:'task-1',devices:['SIM-1','SIM-2']});
  // Reading it never starts that computer's own viewer, and nothing local is touched here.
  assert.deepEqual([...new Set(provider.calls.map(c=>c.method))],['remote_task_state']);
  assert.deepEqual([...new Set(viewer.calls.map(c=>c.method).filter(m=>m!=='device_hold'))],['remote_viewer']);
});

test('choosing, starting, shutting down and creating run on the computer that owns the devices',async()=>{
  let boot;
  const world=computers({providerWorker:async r=>{
    if(r.method==='remote_task_state')return {ok:true,device:world.state.device,devices:world.state.devices,settings:{enabled:true}};
    if(r.method==='boot')return new Promise(resolve=>boot=resolve);
    if(r.method==='create_device')return {ok:true,udid:'SIM-NEW',name:r.params.name};
    if(r.method==='viewer_catalog')return {ok:true,platforms:{android:{ready:true}},deviceTypes:[{identifier:'iPhone-Air',name:'iPhone Air',minRuntimeVersion:'27.0'}],runtimes:[{identifier:'iOS-27-3',name:'iOS 27.3',version:'27.3'}]};
    return {ok:true,execution:'executed'};}});
  const {provider,viewer,state}=world;
  await viewer.ask({call:'task_state',sessionId:'task-1'});
  // The task moves to another of that computer's devices, without opening that computer's viewer.
  state.device={...OFF,thisTask:true};
  const bound=await viewer.ask({call:'task_bind',sessionId:'task-1',udid:'SIM-2'});
  assert.equal(bound.device.udid,'SIM-2');assert.equal(bound.viewer,undefined);
  assert.deepEqual(plain(provider.calls.find(c=>c.method==='task_bind').params),{_task:'task-1',udid:'SIM-2',_locale:'zh-CN',_remote:true});
  // Starting outlasts one request: the answer comes at once and says it is running.
  const starting=await viewer.ask({call:'task_boot',sessionId:'task-1',udid:'SIM-2',memoryMode:'saving'});
  assert.deepEqual(plain(starting.operation),{call:'task_boot',udid:'SIM-2',state:'running'});
  assert.deepEqual(plain(provider.calls.find(c=>c.method==='boot').params),{udid:'SIM-2',memoryMode:'saving',_task:'task-1',_locale:'zh-CN'});
  // A second request while it runs starts nothing more.
  await viewer.ask({call:'task_boot',sessionId:'task-1',udid:'SIM-2'});
  assert.equal(provider.calls.filter(c=>c.method==='boot').length,1);
  // What that computer could not finish is told once.
  boot({ok:false,errorCode:'BOOT_TIMEOUT'});await settle();
  assert.deepEqual(plain((await viewer.ask({call:'task_state',sessionId:'task-1'})).operation),{call:'task_boot',udid:'SIM-2',state:'failed',errorCode:'BOOT_TIMEOUT'});
  assert.equal((await viewer.ask({call:'task_state',sessionId:'task-1'})).operation,undefined);
  state.device={...OFF,state:'Booted',thisTask:true};
  await viewer.ask({call:'shutdown',sessionId:'task-1',udid:'SIM-2'});
  assert.deepEqual(plain(provider.calls.find(c=>c.method==='settings_shutdown').params),{udid:'SIM-2'});
  // The new device sheet reads that computer's models and creates there.
  const catalog=await viewer.ask({call:'catalog'});
  assert.deepEqual(plain(catalog),{ok:true,platforms:{android:{ready:true}},deviceTypes:[{identifier:'iPhone-Air',name:'iPhone Air',minRuntimeVersion:'27.0'}],runtimes:[{identifier:'iOS-27-3',name:'iOS 27.3',version:'27.3'}]});
  assert.deepEqual(plain(await viewer.ask({call:'create',name:'Mine',deviceType:'iPhone-Air',runtime:'iOS-27-3'})),{ok:true,udid:'SIM-NEW',name:'Mine'});
  // Only the listed requests exist; this computer's worker is never asked to manage anything.
  assert.equal((await viewer.ask({call:'erase',sessionId:'task-1',udid:'SIM-2'})).errorCode,'INVALID_ARGUMENT');
  assert.deepEqual([...new Set(viewer.calls.map(c=>c.method).filter(m=>m!=='device_hold'))],['remote_viewer']);
});

test('a plugin there that cannot be asked still shows its running device, and says what needs updating',async()=>{
  const {viewer,delivered,provider}=computers({providerHandles:false});
  for(let i=0;i<3;i++){
    const state=await viewer.ask({call:'task_state',sessionId:'task-1'});
    assert.deepEqual(plain(state.remote),{computer:'Mac Studio',manage:false});assert.equal(state.device.udid,'SIM-1');
  }
  assert.equal((await viewer.ask({call:'task_bind',sessionId:'task-1',udid:'SIM-2'})).errorCode,'REMOTE_PLUGIN_UPDATE_REQUIRED');
  // It is asked once, not on every poll: an unanswered request costs that computer's whole timeout.
  assert.equal(delivered.length,0);assert.equal(provider.calls.length,0);
  // An unknown request from another computer is refused without touching the worker.
  const refused=computers();
  let reply;refused.provider.waiting.set('x',r=>reply=r);
  await refused.provider.deliver({type:'device-sync-request',requestId:'x',peer:'laptop',data:{v:1,kind:'something-else',call:'task_state'}});
  assert.deepEqual(plain(reply.data),{ok:false,errorCode:'UNSUPPORTED',execution:'not_executed'});assert.equal(refused.provider.calls.length,0);
});

test('the task page of a remote task is the same page, marked remote, and asks only the other computer',async()=>{
  const nodes=new Map(),events={},calls=[],posted=[];
  const get=id=>{if(!nodes.has(id))nodes.set(id,{children:[],contentWindow:{postMessage:(data,origin)=>posted.push({data,origin})},replaceChildren(){this.children=[];},append(...children){this.children.push(...children);}});return nodes.get(id);};
  let poll,clock=1e6;
  const remote={computer:'Mac Studio',manage:true},devices=[{udid:'SIM-1',name:'iPhone Air',state:'Booted'},{udid:'SIM-2',name:'iPad mini',state:'Shutdown'}];
  let answer={ok:true,remote,device:devices[0],devices,settings:{enabled:true},viewer:{url:'http://127.0.0.1:9/control?udid=SIM-1'}};
  const context={URL,URLSearchParams,Date:{now:()=>clock},location:{search:'?session=task-1&device=studio&deviceName=Mac%20Studio'},BroadcastChannel:class{postMessage(){}},
    addEventListener:(type,fn)=>events[type]=fn,setInterval:fn=>poll=fn,
    document:{hidden:false,documentElement:{},getElementById:get,addEventListener(){}}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('cindy-simulator/pages.js','utf8'),context);
  const pages=context.CindySimPages,sheets=[];
  Object.assign(pages,{locale:async()=>'en',h:(tag,props,children=[])=>({tag,props,children}),memoryBadge:()=>null,memoryPicker:()=>null,memoryArgs:()=>({memoryMode:'saving'}),
    createDevice:async options=>{sheets.push(options);return {udid:'SIM-NEW'};},
    rpc:async(action,params)=>{calls.push({action,params:plain(params)});return typeof answer==='function'?answer(params):answer;}});
  context.CindySimModel={runtimeLabel:()=>'iOS 27.3',deviceRows:list=>list.map(d=>({udid:d.udid,name:d.name,meta:'',tone:'off',available:true})),showMemoryNotice(){assert.fail('local notice');},
    createResourceSummary(){assert.fail('this computer’s resources are not that device’s');}};
  vm.runInContext(fs.readFileSync('cindy-simulator/task.js','utf8'),context);await settle();
  const flatten=n=>[n,...(n.children||[]).filter(Boolean).flatMap(flatten)];
  const shown=()=>get('inner').children.flatMap(flatten);
  const text=()=>shown().map(n=>n.props?.text).filter(Boolean);
  // Every request names the other computer and the action; the page's own request id is left alone.
  assert.deepEqual(calls,[{action:'remote_task',params:{deviceId:'studio',computer:'Mac Studio',call:'task_state',sessionId:'task-1'}}]);
  assert.equal(get('screen').src,'http://127.0.0.1:9/control?udid=SIM-1');
  // The controller's device menu: switch to a device that is off, which also starts it.
  const controller={source:get('screen').contentWindow,origin:'http://127.0.0.1:9'};
  let booting=false;
  answer=p=>{if(p.call==='task_boot')booting=true;
    return {ok:true,remote,device:devices[1],devices,settings:{enabled:true},...(booting?{operation:{call:'task_boot',udid:'SIM-2',state:'running'}}:{})};};
  events.message({...controller,origin:'https://elsewhere.test',data:{type:'cindy-simulator-remote-action',action:'bind',udid:'SIM-2'}});await settle();assert.equal(calls.length,1);
  events.message({...controller,data:{type:'cindy-simulator-remote-action',action:'bind',udid:'SIM-2'}});await settle();
  assert.deepEqual(calls.slice(1).filter(c=>c.params.call!=='task_state').map(c=>[c.params.call,c.params.udid,c.params.memoryMode]),[['task_bind','SIM-2',undefined],['task_boot','SIM-2','saving']]);
  // While that computer starts it, the page says so, and says whose device it is.
  assert.equal(get('screen').src,'about:blank');assert.equal(get('home').hidden,false);
  assert.ok(text().includes('Remote · Mac Studio'));assert.ok(text().includes('Starting…'));
  // It asks again sooner while that is running, and less often otherwise.
  const before=calls.length;clock+=2000;poll();await settle();assert.equal(calls.length,before+1);
  // The controller, had it stayed, would have been told the switch went through.
  assert.deepEqual(plain(posted.at(-1)),{data:{type:'cindy-simulator-remote-result',action:'bind',ok:true},origin:'http://127.0.0.1:9'});
  // That computer could not finish: said once, with its reason.
  answer={ok:true,remote,device:devices[1],devices,settings:{enabled:true},operation:{call:'task_boot',udid:'SIM-2',state:'failed',errorCode:'BOOT_TIMEOUT'}};clock+=2000;poll();await settle();
  assert.ok(text().some(line=>line.includes('BOOT_TIMEOUT')));
  // New device: the same sheet, pointed at that computer.
  answer={ok:true,remote,device:null,devices,settings:{enabled:true}};clock+=7000;poll();await settle();
  assert.ok(text().includes('Pick one of that computer’s devices for this task, or create a new one there.'));
  await shown().find(n=>n.tag==='button'&&n.props.text==='New device…').props.onclick();await settle();
  assert.equal(sheets[0].heading,'New device on Mac Studio');assert.equal(typeof sheets[0].call,'function');
  assert.deepEqual(calls.filter(c=>c.params.call==='task_bind').at(-1).params,{deviceId:'studio',computer:'Mac Studio',call:'task_bind',sessionId:'task-1',udid:'SIM-NEW'});
  // A plugin there that cannot be asked: no list and no create, only the explanation.
  answer={ok:true,remote:{computer:'',manage:false},device:null,devices:[],settings:{enabled:true}};clock+=7000;poll();await settle();
  // Cindy's own name for that computer still marks the page.
  assert.ok(text().includes('No device is running for this task'));assert.ok(text().includes('Remote · Mac Studio'));assert.equal(shown().some(n=>n.tag==='button'),false);
  assert.equal(calls.every(c=>c.action==='remote_task'),true);
});
