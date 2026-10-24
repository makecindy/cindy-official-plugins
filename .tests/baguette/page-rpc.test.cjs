const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

function fixture(page,{steps=1}={}){
  const buses=new Map(),intervals=new Map(),timers=new Map(),messages=[],calls=[];
  let serial=0,now=0;
  const results=Array.from({length:steps},()=>{let finish,fail;const result=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});return {result,finish,fail};});
  class BroadcastChannel{
    constructor(name){this.name=name;if(!buses.has(name))buses.set(name,[]);buses.get(name).push(this);}
    postMessage(data){messages.push(data);for(const p of buses.get(this.name))if(p!==this)queueMicrotask(()=>p.onmessage?.({data}));}
  }
  const clock={setInterval:(fn,ms)=>{const id=++serial;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id),
    setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
  const elements=new Map();
  const nodes=[];
  const element=tag=>{
    const n={tag,children:[],value:'',textContent:'',listeners:{},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
      setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this.listeners[k]=fn;},focus(){},select(){},showModal(){},close(){},remove(){this.removed=true;},
      get selectedOptions(){return this.children.filter(c=>c.value===this.value);}};
    nodes.push(n);return n;
  };
  const context={...clock,BroadcastChannel,crypto:require('node:crypto').webcrypto,AbortSignal,
    document:{documentElement:{},body:element('body'),createElement:element,getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}},
    CindySimModel:require('../../cindy-simulator/node/control-model.js'),fetch:async url=>url==='/app-context'?new Promise(()=>{}):{ok:true,json:async()=>({state:'on'})}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(`cindy-simulator/${page}.js`,'utf8'),context);
  return {messages,calls,nodes,create:options=>context.CindySimPages.createDevice(options),finish:(value,index=0)=>results[index].finish(value),fail:(error,index)=>results[index].fail(error),intervals,timers,
    advance:async ms=>{now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}await flush();},
    rpc:action=>page==='pages'?context.CindySimPages.rpc(action,{sessionId:'task-1',udid:'device-1'}):vm.runInContext(`rpc(${JSON.stringify(action)})`,context),
    tick:()=>{for(const {fn,ms} of [...intervals.values()])if(ms===500)fn();},
    ready:id=>{for(const p of buses.get(page==='pages'?'baguette-pages':'baguette-settings'))queueMicrotask(()=>p.onmessage?.({data:{type:'ready',id}}));},
    start:()=>vm.runInNewContext(fs.readFileSync('cindy-simulator/main.js','utf8'),{...clock,BroadcastChannel,
      cindy:{onHostMessage(){},request:async()=>({context:{locale:'en'}}),node:{request:async r=>{
        if(r.method==='device_hold')return {ok:true,result:{running:false}};
        calls.push(r);return {ok:true,result:await results[calls.length-1].result};
      }}}})};
}

test('creation families keep Android, iPhone, TV and Vision runtimes separate after upstream integration',async()=>{
 const types=[{identifier:'android:phone',name:'Android Phone',platform:'android'},
  {identifier:'t.iPhone-18-Pro',name:'iPhone 18 Pro'},
  {identifier:'t.Apple-TV',name:'Apple TV'},
  {identifier:'t.Apple-Vision-Pro',name:'Apple Vision Pro'}];
 const runtimes=types.map((d,i)=>({identifier:['android:android-36','r.iOS-27-0','r.tvOS-27-0','r.xrOS-27-0'][i],version:'27.0',supportedDeviceTypes:[d.identifier]}));
 for(const lang of ['en','zh-CN'])for(const [i,family] of ['android','iphone','tv','vision'].entries()){
  const f=fixture('pages');f.start();f.create({lang,family});await flush();f.tick();await flush();
  f.finish({ok:true,deviceTypes:types,runtimes});await flush();
  const selects=f.nodes.filter(n=>n.tag==='select');
  assert.equal(selects[0].children.length,1);assert.equal(selects[0].children[0].value,runtimes[i].identifier);
  assert.equal(selects[1].children.length,1);assert.equal(selects[1].children[0].value,types[i].identifier);
  const title=f.nodes.find(n=>n.tag==='h2').textContent;
  assert.match(title,i===0?/Android|安卓/:i===1?/iPhone/:i===2?/Apple TV/:/Vision Pro/);
 }
});

test('shared create sheet preserves backend errors and uses platform-correct fallbacks without replay',async()=>{
  for(const lang of ['en','zh-CN'])for(const platform of ['android','ios'])for(const family of ['any',platform==='android'?'android':'iphone'])for(const detail of [true,false]){
    const f=fixture('pages',{steps:3});f.start();const pending=f.create({lang,family});await flush();f.tick();await flush();
    f.finish({ok:true,deviceTypes:[{identifier:platform==='android'?'android:phone':'iphone',platform,name:'Test phone',family:'iphone'}],
      runtimes:[{identifier:platform==='android'?'android:36':'ios',platform,version:'36',name:'Test OS'}]});await flush();
    const form=f.nodes.find(n=>n.tag==='form'),error=f.nodes.find(n=>n.className==='sheet-error'),submit=f.nodes.find(n=>n.type==='submit');
    const operation=form.listeners.submit({preventDefault(){}});await flush();f.tick();await flush();
    f.finish({ok:false,...(detail?{message:'ENOSPC: device metadata could not be written'}:{})},1);await operation;
    if(detail)assert.equal(error.textContent,'ENOSPC: device metadata could not be written');
    else assert.equal(error.textContent.includes('Xcode'),platform==='ios');
    assert.equal(submit.disabled,false);assert.equal(f.calls.length,2);assert.equal(f.nodes.find(n=>n.tag==='dialog').removed,undefined);
    for(let i=0;i<3;i++){f.tick();await flush();}assert.equal(f.calls.length,2,'rendering the failure never replays create');
    const success=form.listeners.submit({preventDefault(){}});await flush();f.tick();await flush();
    f.finish({ok:true,udid:'device-created',name:'Test phone'},2);await success;
    assert.equal((await pending).udid,'device-created');assert.equal(f.nodes.find(n=>n.tag==='dialog').removed,true);
  }
  for(const family of ['android','any']){
    const f=fixture('pages');f.start();const pending=f.create({family});await flush();f.tick();await flush();
    f.finish({ok:false,message:'Android SDK metadata unreadable'});await flush();
    assert.equal(f.nodes.find(n=>n.className==='sheet-error').textContent,'Android SDK metadata unreadable');
    f.nodes.find(n=>n.tag==='dialog').listeners.cancel({preventDefault(){}});assert.equal(await pending,null);
  }
});

test('startup probes never replay slow page or settings operations, on success or failure',async()=>{
  for(const [page,actions] of [['pages',['catalog','manage_state','task_state','boot']],['settings',['status','catalog','boot']]])for(const action of actions)for(const ok of [true,false]){
    const f=fixture(page),pending=f.rpc(action);await flush();
    f.tick();await flush();assert.equal(f.calls.length,0,'listener not started');
    f.start();f.tick();await flush();assert.equal(f.calls.length,1,`${page}/${action}`);
    const id=f.messages.find(m=>m.type==='request').id;
    for(let i=0;i<4;i++){f.tick();f.ready(id);await flush();}
    assert.equal(f.calls.length,1,'slow operations and duplicate readiness never replay');
    f.finish({ok,errorCode:ok?undefined:'READ_FAILED'});
    assert.equal((await pending).ok,ok);
    f.ready(id);f.tick();await flush();assert.equal(f.calls.length,1,'late readiness is ignored');
    assert.equal(f.timers.size,0);assert.equal(f.intervals.size,0);
  }
});

test('expired startup and in-flight requests ignore late readiness and results',async()=>{
  for(const page of ['pages','settings'])for(const running of [false,true]){
    const f=fixture(page),pending=f.rpc('catalog');const rejected=assert.rejects(pending);
    await flush();if(running){f.start();f.tick();await flush();}
    const id=f.messages.find(m=>m.type==='ping').id;
    for(const timer of f.timers.values())timer.fn();f.timers.clear();await rejected;
    if(!running)f.start();
    f.ready(id);f.finish({ok:true});f.tick();await flush();
    assert.equal(f.calls.length,running?1:0);assert.equal(f.intervals.size,0);
  }
});

test('page and settings reads wait for the complete worker window without redispatch',async()=>{
  for(const [page,actions] of [['pages',['task_state','manage_state','catalog']],['settings',['status','catalog']]])for(const action of actions)for(const ok of [true,false]){
    const f=fixture(page);let settled=false;
    const pending=f.rpc(action).finally(()=>{settled=true;});await flush();
    await f.advance(119000);assert.equal(settled,false,'startup is still within its own limit');
    f.start();f.tick();await flush();
    await f.advance(30000);assert.equal(settled,false,`${page}/${action} still running after 20s`);
    f.tick();await flush();assert.equal(f.calls.length,1);
    await f.advance(89000);assert.equal(settled,false,'page covers the 120s worker request');
    f.finish({ok});assert.equal((await pending).ok,ok);assert.equal(f.timers.size,0);
  }
});

test('compound task actions cover both sequential worker requests',async()=>{
  for(const action of ['task_boot','task_create']){
    const f=fixture('pages',{steps:2});f.start();let settled=false;
    const pending=f.rpc(action).finally(()=>{settled=true;});await flush();
    await f.advance(119000);f.finish({ok:true,udid:'device-1'});await flush();
    assert.equal(f.calls.length,2);
    await f.advance(119000);assert.equal(settled,false,'second worker retains its full window');
    f.finish({ok:true},1);assert.equal((await pending).ok,true);assert.equal(f.timers.size,0);
  }
});

test('task boot keeps completed device evidence when its binding cannot be saved',async()=>{
  const f=fixture('pages');f.start();const pending=f.rpc('task_boot');await flush();
  const result={ok:true,execution:'executed',udid:'device-1',taskBindingError:{code:'TASK_BINDINGS_UNREADABLE',message:'check storage'}};
  f.finish(result);
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)),result);assert.equal(f.calls.length,1,'no state query can discard the completed boot or its binding error');
});

test('compound task actions retain completed evidence across rejected, timed out, and error follow-ups',async()=>{
 for(const action of ['task_boot','task_create'])for(const outcome of ['reject','timeout','error','partial','success']){
  const f=fixture('pages',{steps:2});f.start();const pending=f.rpc(action);await flush();
  f.finish({ok:true,execution:'executed',udid:'device-1',marker:'completed'});await flush();assert.equal(f.calls.length,2);
  if(outcome==='reject'||outcome==='timeout')f.fail(Object.assign(Error(outcome),{code:outcome==='timeout'?'TIMEOUT':'NODE_FAILED'}),1);
  else f.finish(outcome==='error'?{ok:false,errorCode:'STATE_FAILED',execution:'not_executed'}:
   {ok:true,boundUdid:'device-1',...(outcome==='partial'?{taskStateError:{code:'VIEWER_FAILED'}}:{viewer:{url:'screen'}})},1);
  const result=await pending;
  assert.equal(result.ok,true);assert.equal(result.execution,'executed');assert.equal(result.marker,'completed');assert.equal(result.udid,'device-1');
  if(outcome==='partial')assert.equal(result.taskStateError.code,'VIEWER_FAILED');
  else if(outcome==='success')assert.equal(result.viewer.url,'screen');
  else assert.ok(result[action==='task_create'?'taskBindingError':'taskStateError']);
  assert.deepEqual(f.calls.map(c=>c.method),action==='task_boot'?['boot','task_state']:['create_device','task_bind']);
 }
});
