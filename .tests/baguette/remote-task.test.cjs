'use strict';
// A task that lives on another of the account's computers: the task page shows
// the device that computer runs for the task, through the address Cindy hands
// the logic page. Nothing on this computer is started, listed or bound for it.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const settle=()=>new Promise(r=>setTimeout(r,10));
const HOST='http://127.0.0.1:7/'+'c'.repeat(64);
const listed=(id,name,taskIds)=>({id,name,platform:'ios',taskIds});

function logicPage({view,legacy=false}={}){
  const buses=new Map();
  class BroadcastChannel{constructor(n){this.name=n;this.onmessage=null;(buses.get(n)||buses.set(n,new Set()).get(n)).add(this);}postMessage(data){for(const p of buses.get(this.name))if(p!==this)queueMicrotask(()=>p.onmessage?.({data}));}}
  const asked=[],calls=[];
  const cindy={onHostMessage(){},request:async()=>({ok:true,context:{locale:'zh-CN'}}),
    // A Cindy without this channel rejects the unknown message.
    send:async p=>{if(p.type==='live-screen-view-request')throw Error('INVALID_PARAMS');},
    node:{request:async r=>{calls.push(r);if(r.method==='device_hold')return {ok:true,result:{running:false}};
      return {ok:true,result:{ok:true,ready:true,url:'http://127.0.0.1:9/control?udid='+r.params.id+'#cindyClipboard=9.t'}};}}};
  if(!legacy)cindy.liveScreenView=async r=>{asked.push(r);return view(r);};
  vm.runInNewContext(fs.readFileSync('cindy-simulator/main.js','utf8'),{cindy,BroadcastChannel,Object,String,Promise,Set,RegExp,Array,queueMicrotask,setTimeout});
  const page=new BroadcastChannel('baguette-pages'),replies=[];
  page.onmessage=({data})=>{if(data.type==='response')replies.push(data);};
  const ask=async params=>{const id='r'+replies.length;page.postMessage({type:'request',id,action:'remote_state',...params});await settle();return replies.find(r=>r.id===id)?.result;};
  return {ask,asked,calls};
}

test('the logic page opens only this task’s device on the named computer and hands its address to the worker',async()=>{
  const f=logicPage({view:async r=>r.op==='screens'
    ?{ok:true,screens:[listed('SIM-OTHER','Other task',['task-2']),listed('SIM-1','iPhone Air',['task-1','task-3'])]}
    :{ok:true,view:'lv-1',url:HOST}});
  const state=await f.ask({sessionId:'task-1',deviceId:'computer-a'});
  assert.deepEqual(JSON.parse(JSON.stringify(state)),{ok:true,remote:true,screens:[{id:'SIM-1',name:'iPhone Air',platform:'ios'}],
    screen:{id:'SIM-1',name:'iPhone Air',platform:'ios'},viewer:{url:'http://127.0.0.1:9/control?udid=SIM-1#cindyClipboard=9.t'}});
  assert.deepEqual(JSON.parse(JSON.stringify(f.asked)),[{op:'screens',deviceId:'computer-a'},{op:'open',deviceId:'computer-a',id:'SIM-1'}]);
  const worker=f.calls.find(c=>c.method==='remote_viewer');
  assert.deepEqual(JSON.parse(JSON.stringify(worker.params)),{id:'SIM-1',url:HOST,name:'iPhone Air',platform:'ios',_locale:'zh-CN',_task:'task-1'});
  // Nothing of this computer's own devices is read, bound or started for a remote task.
  assert.deepEqual(f.calls.map(c=>c.method).filter(m=>m!=='device_hold'),['remote_viewer']);
});

test('no device, an unreachable computer and an older Cindy are reported without opening anything',async()=>{
  const none=logicPage({view:async()=>({ok:true,screens:[listed('SIM-OTHER','Other task',['task-2'])]})});
  assert.deepEqual(JSON.parse(JSON.stringify(await none.ask({sessionId:'task-1',deviceId:'computer-a'}))),{ok:true,remote:true,screens:[]});
  assert.equal(none.asked.length,1);assert.equal(none.calls.some(c=>c.method==='remote_viewer'),false);
  const down=logicPage({view:async()=>({ok:false,errorCode:'DEVICE_UNAVAILABLE'})});
  assert.equal((await down.ask({sessionId:'task-1',deviceId:'computer-a'})).errorCode,'DEVICE_UNAVAILABLE');
  const busy=logicPage({view:async r=>r.op==='screens'?{ok:true,screens:[listed('SIM-1','iPhone Air',['task-1'])]}:{ok:false,errorCode:'HOST_NOT_READY'}});
  const waiting=await busy.ask({sessionId:'task-1',deviceId:'computer-a'});
  assert.equal(waiting.viewerError,'HOST_NOT_READY');assert.equal(waiting.screen.id,'SIM-1');
  const old=logicPage({legacy:true});
  assert.equal((await old.ask({sessionId:'task-1',deviceId:'computer-a'})).errorCode,'HOST_UPDATE_REQUIRED');
  assert.equal((await logicPage({view:async()=>({ok:true,screens:[]})}).ask({sessionId:'task-1',deviceId:'bad id'})).errorCode,'INVALID_ARGUMENT');
});

test('the task page of a remote task shows that computer’s device and never this computer’s own',async()=>{
  const nodes=new Map(),events={},calls=[];
  const get=id=>{if(!nodes.has(id))nodes.set(id,{children:[],contentWindow:{},replaceChildren(){this.children=[];},append(...children){this.children.push(...children);}});return nodes.get(id);};
  let poll,answer={ok:true,remote:true,screens:[{id:'SIM-1',name:'iPhone Air',platform:'ios'}],screen:{id:'SIM-1',name:'iPhone Air',platform:'ios'},viewer:{url:'http://127.0.0.1:9/control?udid=SIM-1'}};
  const context={URL,URLSearchParams,location:{search:'?session=task-1&device=computer-a'},BroadcastChannel:class{postMessage(){}},
    addEventListener:(type,fn)=>events[type]=fn,setInterval:fn=>poll=fn,
    document:{hidden:false,documentElement:{},getElementById:get,addEventListener(){}}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('cindy-simulator/pages.js','utf8'),context);
  const pages=context.CindySimPages;
  Object.assign(pages,{locale:async()=>'en',h:(tag,props,children=[])=>({tag,props,children}),
    rpc:async(action,params)=>{calls.push({action,params});if(answer instanceof Error)throw answer;return answer;}});
  context.CindySimModel={createResourceSummary:()=>({node:{},update(){},prune(){}})};
  vm.runInContext(fs.readFileSync('cindy-simulator/task.js','utf8'),context);await settle();
  // The page's own request id must survive: the device goes in its own field.
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{action:'remote_state',params:{sessionId:'task-1',deviceId:'computer-a'}}]);
  assert.equal(Object.hasOwn(calls[0].params,'id'),false);
  assert.equal(get('screen').src,'http://127.0.0.1:9/control?udid=SIM-1');assert.equal(get('screen').hidden,false);
  // Later polls keep the device already shown, and still never ask about local devices.
  poll();await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])),{action:'remote_state',params:{sessionId:'task-1',deviceId:'computer-a',screenId:'SIM-1'}});
  // The device page lost its stream: renew now, but only at the controller's own request.
  events.message({origin:'https://elsewhere.test',data:{type:'cindy-simulator-remote-ended'}});await settle();assert.equal(calls.length,2);
  events.message({origin:'http://127.0.0.1:9',data:{type:'cindy-simulator-remote-ended'}});await settle();assert.equal(calls.length,3);
  // The device stopped on that computer: back to the explanation, no local device list.
  answer={ok:true,remote:true,screens:[]};poll();await settle();
  assert.equal(get('screen').src,'about:blank');assert.equal(get('home').hidden,false);
  const flatten=n=>[n,...(n.children||[]).filter(Boolean).flatMap(flatten)];
  assert.ok(get('inner').children.flatMap(flatten).some(n=>n.props?.text==='No device is running for this task'));
  assert.equal(calls.every(c=>c.action==='remote_state'),true);
});
