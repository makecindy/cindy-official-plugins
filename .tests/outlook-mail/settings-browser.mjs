// Optional browser verification: npm install --no-save playwright-core outside
// the plugin, then set OUTLOOK_PLAYWRIGHT_MODULE and OUTLOOK_TEST_CHROMIUM.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.OUTLOOK_PLAYWRIGHT_MODULE || 'playwright-core');
const root=new URL('../../outlook-mail/',import.meta.url);
const manifest=JSON.parse(await fs.readFile(new URL('ghost.json',root),'utf8'));
const screenshots=process.env.OUTLOOK_SCREENSHOTS_DIR
  ? pathToFileURL(process.env.OUTLOOK_SCREENSHOTS_DIR.replace(/\/$/,'')+'/')
  : new URL('./screenshots/',import.meta.url);
const browser=await chromium.launch({...(process.env.OUTLOOK_TEST_CHROMIUM?{executablePath:process.env.OUTLOOK_TEST_CHROMIUM}:{}),headless:true});
const page=await browser.newPage({viewport:{width:460,height:940}});
const errors=[],unexpected=[],calls=[];
page.on('pageerror',e=>errors.push(e.message));
let entries=[{key:'outlook_global',clientConfigured:false,clientCustom:false,accounts:[]},{key:'outlook_china',clientConfigured:false,clientCustom:false,accounts:[]}];
let config={sdk_account:{id:'sdk:old',login:'legacy@example.test'},global_connection:'sdk',keep:'preference'},locale='zh-CN',mode='light',failLoad=false,failDisconnect=false;
let nextAccount='g1';
const theme={light:':root{--text-primary:#202020;--text-secondary:#646464;--surface:#fff;--border-default:#dededb;--accent-cta-bg:#262626;--accent-pure-cta-fg:#fff}body{background:#fafaf8}',dark:':root{--text-primary:#ededeb;--text-secondary:#aaa;--surface:#262626;--border-default:#464644;--accent-cta-bg:#eee;--accent-pure-cta-fg:#171717}body{background:#202020}'};
await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),path=u.pathname;
  const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:status===204?'':JSON.stringify(data)});
  if(u.origin!=='https://outlook.example.test'){unexpected.push(req.url());return route.abort();}
  if(path==='/app-context')return reply({context:{locale}});
  if(path==='/oauth')return failLoad?reply({},503):reply(entries);
  if(path==='/kv'){
    if(req.method()==='PUT'){config=JSON.parse(req.postData());calls.push({path,method:'PUT'});return reply(null,204);}
    return reply(config);
  }
  if(path.startsWith('/oauth/')){
    calls.push({path,method:req.method(),body:req.postData()});
    const [,,key,operation,id]=path.split('/');const e=entries.find(e=>e.key===key);assert(e);
    if(operation==='client'){
      e.clientConfigured=req.method()==='PUT';e.clientCustom=e.clientConfigured;
      e.accounts.forEach(a=>a.status='expired');return reply(null,204);
    }
    if(operation==='connect'){
      let a=e.accounts.find(a=>a.id===nextAccount);
      if(a){a.status='connected';a.scopeStale=false;}
      else {a={id:nextAccount,label:'<img src=x onerror=alert(1)> '+nextAccount+'@example.test',status:'connected',isDefault:e.accounts.length===0};e.accounts.push(a);}
      return reply({ok:true,account:a});
    }
    if(operation==='accounts'){
      if(failDisconnect)return reply({},503);
      e.accounts=e.accounts.filter(a=>a.id!==decodeURIComponent(id));return reply(null,204);
    }
    if(operation==='default'){const b=JSON.parse(req.postData());e.accounts.forEach(a=>a.isDefault=a.id===b.accountId);return reply(null,204);}
    unexpected.push(path);return reply({},404);
  }
  const filename=path==='/'?'settings.html':path.slice(1);
  if(!/^(settings\.(html|css|js)|ui\/(en|zh-CN|ja|ko)\.json)$/.test(filename)){unexpected.push(path);return reply({},404);}
  let body=await fs.readFile(new URL(filename,root));
  if(filename.endsWith('.html'))body=Buffer.from(body.toString().replace('</head>','<style>'+theme[mode]+'</style></head>'));
  return route.fulfill({status:200,body,contentType:filename.endsWith('.html')?'text/html':filename.endsWith('.css')?'text/css':filename.endsWith('.json')?'application/json':'text/javascript'});
});
const settled=()=>page.waitForFunction(()=>!document.querySelector('#default-cloud').disabled);
try {
  await page.goto('https://outlook.example.test/');await settled();
  const registeredRedirect=key=>'http://127.0.0.1:'+manifest.network.secrets.find(s=>s.key===key).oauth.redirectPort+'/callback';
  assert.equal(await page.locator('#redirect').textContent(),registeredRedirect('outlook_global'));
  assert(await page.locator('#connect').isDisabled());assert(await page.locator('#advanced').evaluate(e=>e.open));
  assert.doesNotMatch(await page.locator('#accounts').textContent(),/legacy@example|sdk:old/);
  assert.equal(await page.locator('#connection-mode,#sdk-options').count(),0);
  await page.locator('#client-id').fill('invalid');await page.locator('#save-client').click();await settled();assert.equal(calls.length,0);
  await page.locator('#client-id').fill('12345678-1234-1234-1234-123456789abc');await page.locator('#save-client').click();await settled();
  assert.equal(calls.at(-1).path,'/oauth/outlook_global/client');assert(!calls.at(-1).body.includes('clientSecret'));assert.equal(await page.locator('#client-id').inputValue(),'');
  // The displayed registration hint is not an OAuth request target or input.
  // Even when changed in the DOM, sign-in delegates only to Host /oauth.
  await page.locator('#redirect').evaluate(el=>{el.textContent='https://callback.example.test/changed';});
  await page.locator('#connect').click();await settled();
  assert.equal(calls.at(-1).path,'/oauth/outlook_global/connect');assert.equal(await page.locator('#accounts img').count(),0);
  assert.equal(calls.at(-1).body,null);
  const row=(cloud,id)=>page.locator('[data-cloud="'+cloud+'"] [data-account-id="'+id+'"]');
  nextAccount='g2';await page.locator('#connect').click();await settled();
  await page.locator('#cloud').selectOption('china');await settled();assert(await page.locator('#connect').isDisabled());
  assert.equal(await page.locator('#redirect').textContent(),registeredRedirect('outlook_china'));
  await page.locator('#client-id').fill('abcdef01-1234-1234-1234-123456789abc');await page.locator('#save-client').click();await settled();
  for(const id of ['c1','c2']){nextAccount=id;await page.locator('#connect').click();await settled();}
  assert.deepEqual(entries.map(e=>e.accounts.map(a=>a.id)),[['g1','g2'],['c1','c2']]);
  assert.equal(await page.locator('.account').count(),4);
  await page.locator('#cloud').selectOption('global');await settled();
  // China row actions must stay in China even with the global add-account selector.
  await row('china','c2').getByRole('button',{name:'设为默认',exact:true}).click();await settled();
  assert.equal(calls.at(-1).path,'/oauth/outlook_china/default');
  assert.equal(entries[0].accounts.find(a=>a.isDefault).id,'g1');
  assert.equal(entries[1].accounts.find(a=>a.isDefault).id,'c2');
  entries[1].accounts[0].status='expired';nextAccount='c1';
  await page.reload();await settled();
  await row('china','c1').getByRole('button',{name:'重新连接',exact:true}).click();await settled();
  assert.equal(calls.at(-1).path,'/oauth/outlook_china/connect');
  assert.equal(entries[1].accounts.length,2);assert.equal(entries[1].accounts[0].status,'connected');
  assert.equal(entries[1].accounts.find(a=>a.isDefault).id,'c2');
  const kvWrites=()=>calls.filter(c=>c.path==='/kv').length;
  const before=kvWrites();failDisconnect=true;
  await row('china','c1').getByRole('button',{name:'断开',exact:true}).click();await settled();
  assert.equal(await page.locator('.account').count(),4);assert.equal(kvWrites(),before);
  failDisconnect=false;await row('china','c1').getByRole('button',{name:'断开',exact:true}).click();await settled();
  assert.equal(calls.at(-1).path,'/oauth/outlook_china/accounts/c1');
  assert.deepEqual(entries.map(e=>e.accounts.map(a=>a.id)),[['g1','g2'],['c2']]);assert.equal(kvWrites(),before);
  assert.equal(await page.locator('.account').count(),3);
  await page.locator('#cloud').selectOption('china');await settled();nextAccount='c1';
  await page.locator('#connect').click();await settled();
  await page.locator('#default-cloud').click();await settled();assert.equal(config.default_cloud,'china');assert.equal(config.keep,'preference');
  for(const e of entries)for(const a of e.accounts)a.label=(e.key==='outlook_global'?'全球演示':'中国区演示')+' · '+a.id+'@example.test';
  await page.reload();await settled();assert.equal(await page.locator('.account').count(),4);
  await fs.mkdir(screenshots,{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('outlook-host-settings-light.png',screenshots)),fullPage:true});
  mode='dark';await page.reload();await settled();assert.equal(await page.locator('#cloud').inputValue(),'china');
  await page.screenshot({path:fileURLToPath(new URL('outlook-host-settings-dark.png',screenshots)),fullPage:true});
  await page.setViewportSize({width:320,height:940});
  for(const lang of ['zh-CN','en','ja','ko','fr']){
    locale=lang;await page.reload();await settled();
    const expected=lang==='fr'?'en':lang;
    assert.equal(await page.locator('html').getAttribute('lang'),expected);
    const ui=JSON.parse(await fs.readFile(new URL('ui/'+expected+'.json',root),'utf8'));
    assert.equal(await page.locator('h1').textContent(),ui.title);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    if(lang==='ja'||lang==='ko')await page.screenshot({path:fileURLToPath(new URL('outlook-host-settings-'+lang+'-narrow.png',screenshots)),fullPage:true});
  }
  failLoad=true;await page.reload();await page.waitForFunction(()=>document.querySelector('#setup-note').textContent.includes('Unable to load'));
  assert(await page.locator('#connect').isDisabled());assert(await page.locator('#save-client').isDisabled());
  for(const call of calls.filter(c=>c.path.endsWith('/connect'))){
    assert.equal(call.method,'POST');assert.equal(call.body,null);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  console.log('PASS Host OAuth settings: app setup, missing-config gate, connect/disconnect, failed disconnect, four simultaneous accounts across both clouds, per-cloud defaults, reconnect deduplication and row isolation, disconnect isolation, legacy state ignored, XSS, four locales + fallback, 320px layout, load failure; 4 fixture screenshots.');
} finally {await browser.close();}
