
'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),headless:true,args:['--no-sandbox']});let total=0;
 try{for(const theme of ['light','dark'])for(const width of [320,850]){
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let cfg={};let tokenSaved=false,tokenValue=null,tokenWrites=0,holdToken=false,releaseToken=null,failToken=false;let tokenGateEntered;const tokenGateReady=new Promise(resolve=>tokenGateEntered=resolve);
  await context.route('https://plugin.test/**',async route=>{const url=new URL(route.request().url());const name=url.pathname.slice(1)||'settings.html';const req=route.request();
   if(name==='runtime.html')return route.fulfill({contentType:'text/html',body:'<script>globalThis.__nodeCalls=[];globalThis.cindy={onHostMessage(){},send(){},node:{request:async r=>{__nodeCalls.push(r);return {ok:true,result:{content:[]}};}}};</script><script src="/main.js"></script>'});
   if(name==='kv'){if(req.method()==='PUT'){assert.ok(await req.frame().evaluate(async()=>{const state=await navigator.locks.query();return state.held.some(lock=>lock.name==='cortex-settings-v1');}));cfg=req.postDataJSON();return route.fulfill({status:204});}return route.fulfill({json:cfg});}
   if(name==='secrets')return route.fulfill({json:[{key:'cortex_token',saved:tokenSaved}]});
   if(name==='secrets/cortex_token'){tokenWrites++;if(holdToken){const waiting=new Promise(resolve=>releaseToken=resolve);tokenGateEntered();await waiting;}if(failToken){failToken=false;return route.fulfill({status:500});}tokenSaved=req.method()==='PUT';tokenValue=tokenSaved?req.postDataJSON().value:null;return route.fulfill({status:204});}
   if(name==='wake')return route.fulfill({json:{state:'awake'}});
   const f=path.join(__dirname,'..',name);return route.fulfill({body:fs.readFileSync(f),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});
  });
  const runtime=await context.newPage();await runtime.goto('https://plugin.test/runtime.html');
  await page.goto('https://plugin.test/');await page.locator('#token-state').filter({hasText:'No hosted token saved.'}).waitFor({state:'attached'});
  assert.equal(await page.locator('#executable').inputValue(),'');assert.equal(await page.locator('#home').inputValue(),'');
  await page.addStyleTag({content:`:root{color-scheme:${theme};--text-primary:${theme==='dark'?'#eee':'#111'};--text-secondary:${theme==='dark'?'#ccc':'#555'};--surface:${theme==='dark'?'#222':'#fff'};--border-default:${theme==='dark'?'#777':'#aaa'}}`});
  assert.equal(await page.locator('#recording').isChecked(),false);assert.equal(await page.locator('#hosted').isVisible(),false);
  await page.locator('#mode').selectOption('hosted');await page.locator('#endpoint').fill('https://cortex.example/mcp');await page.locator('#token').fill('test-token-not-a-real-secret');await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved. Recording is paused.'}).waitFor();
  assert.ok(tokenSaved);assert.equal(cfg.endpoint,'https://cortex.example/mcp');assert.equal('token' in cfg,false);assert.equal(await page.locator('#token').inputValue(),'');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.deepEqual(errors,[]);
  // Two independently loaded settings windows: the stale one must not restart capture.
  await page.locator('#recording').check();await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.locator('#message').filter({hasText:'Saved. Recording is enabled.'}).waitFor();
  const stale=await context.newPage();await stale.goto('https://plugin.test/');await stale.locator('#token-state').filter({hasText:'A token is stored'}).waitFor({state:'attached'});assert.equal(await stale.locator('#recording').isChecked(),true);
  await page.locator('#endpoint').fill('https://second.example.test/mcp');await page.locator('#token').fill('working-second-token');
  await page.locator('#recording').uncheck();await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.locator('#message').filter({hasText:'Saved. Recording is paused.'}).waitFor();
  const writesBefore=tokenWrites;await stale.locator('#token').fill('stale-wrong-token');
  await stale.getByRole('button',{name:'Save settings',exact:true}).click();await stale.locator('#message').filter({hasText:'Settings changed in another window or tool.'}).waitFor();assert.equal(cfg.recording,false);assert.equal(cfg.endpoint,'https://second.example.test/mcp');assert.equal(tokenValue,'working-second-token');assert.equal(tokenWrites,writesBefore);
  await stale.evaluate(()=>document.getElementById('clear-token').onclick());await stale.locator('#message').filter({hasText:'Settings changed in another window or tool.'}).waitFor();assert.equal(tokenValue,'working-second-token');assert.equal(tokenWrites,writesBefore);
  // A queued save keeps its submitted endpoint and token paired while the lock is held.
  await runtime.evaluate(()=>{globalThis.hasSaveLock=false;globalThis.heldSaveLock=navigator.locks.request('cortex-settings-v1',()=>{globalThis.hasSaveLock=true;return new Promise(resolve=>globalThis.releaseSaveLock=resolve);});});await runtime.waitForFunction(()=>hasSaveLock);
  await page.locator('#endpoint').fill('https://queued.example.test/mcp');await page.locator('#token').fill('queued-token-A');await page.evaluate(()=>message('Waiting for save lock'));await page.getByRole('button',{name:'Save settings',exact:true}).click();
  const editsBlocked=await page.locator('#token').isDisabled();
  if(editsBlocked){const beforeDuplicate=tokenWrites;await page.evaluate(()=>Promise.all([document.getElementById('settings').onsubmit(new Event('submit',{cancelable:true})),document.getElementById('clear-token').onclick()]));assert.equal(tokenWrites,beforeDuplicate);}
  if(!editsBlocked){await page.locator('#endpoint').fill('https://later.example.test/mcp');await page.locator('#token').fill('later-token-B');}
  await runtime.evaluate(()=>releaseSaveLock());await page.locator('#message').filter({hasText:'Saved. Recording is paused.'}).waitFor();assert.equal(cfg.endpoint,'https://queued.example.test/mcp');assert.equal(tokenValue,'queued-token-A');assert.equal(editsBlocked,true);assert.equal(await page.locator('#endpoint').isEnabled(),true);assert.equal(await page.getByRole('button',{name:'Remove saved token',exact:true}).isEnabled(),true);
  // An active vault update excludes resident mutations and hosted secret injection.
  holdToken=true;await page.locator('#endpoint').fill('https://third.example.test/mcp');await page.locator('#token').fill('working-third-token');await page.evaluate(()=>message('Saving credential test'));
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.waitForFunction(async()=>Boolean((await(await fetch('/kv')).json()).credentialPending));await tokenGateReady;
  await runtime.evaluate(async()=>{const before=await config();globalThis.waitingHosted=call(before,'memory_remember',{}).then(()=>({ok:true}),error=>({outcome:error.outcome}));globalThis.waitingMutation=updateConfig({archiveFiles:false});});
  assert.equal(cfg.endpoint,'https://queued.example.test/mcp');assert.equal(tokenValue,'queued-token-A');assert.equal(await runtime.evaluate(()=>__nodeCalls.length),0);
  holdToken=false;releaseToken();await page.locator('#message').filter({hasText:'Saved. Recording is paused.'}).waitFor();await runtime.evaluate(()=>waitingMutation);
  assert.equal((await runtime.evaluate(()=>waitingHosted)).outcome,'not_executed');assert.equal(cfg.endpoint,'https://third.example.test/mcp');assert.equal(tokenValue,'working-third-token');assert.equal(cfg.credentialPending,false);
  // A failed vault operation leaves a durable guard and can be explicitly recovered.
  await page.reload();await page.locator('#token-state').filter({hasText:'A token is stored'}).waitFor({state:'attached'});failToken=true;await page.locator('#token').fill('unconfirmed-token');await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.locator('#message').filter({hasText:'Credential update was not confirmed.'}).waitFor();
  assert.equal(cfg.credentialPending,true);assert.equal(tokenValue,'working-third-token');assert.equal(await page.locator('#token').inputValue(),'');
  const blocked=await runtime.evaluate(async()=>{try{await call(await config(),'memory_remember',{});return 'executed';}catch(error){return error.outcome;}});assert.equal(blocked,'not_executed');assert.equal(await runtime.evaluate(()=>__nodeCalls.length),0);
  await page.reload();await page.locator('#token-state').filter({hasText:'A token is stored'}).waitFor({state:'attached'});await page.evaluate(()=>document.getElementById('clear-token').onclick());assert.equal(cfg.credentialPending,false);assert.equal(tokenValue,null);
  total++;await context.close();
 }console.log(`Settings UI: ${total} viewport/theme combinations passed; vault-only token storage, default pause, stale token replacement/removal rejection, interleaved resident mutations, hosted-call exclusion and failed-vault recovery verified.`);}finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
