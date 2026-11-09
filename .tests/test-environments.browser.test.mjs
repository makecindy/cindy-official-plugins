// Optional real Chromium clicks on the shipped pages/main.js and actual Worker.
// Only Cindy's page context/wake/node transport is shimmed; no installed-Host claim.
// Install playwright-core outside Git; set TEST_ENVIRONMENTS_PLAYWRIGHT to its module path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.TEST_ENVIRONMENTS_PLAYWRIGHT||'playwright-core');
const root=path.resolve(import.meta.dirname,'../test-environments'),{Environments,safeEnv}=require('../test-environments/node/core.cjs');
const evidence=process.env.TEST_ENVIRONMENTS_BROWSER_EVIDENCE&&path.resolve(process.env.TEST_ENVIRONMENTS_BROWSER_EVIDENCE);
let browser;
test.before(async()=>{browser=await chromium.launch({executablePath:process.env.TEST_ENVIRONMENTS_CHROMIUM||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});console.log('Isolated Chromium:',browser.version());});
test.after(async()=>{await browser?.close();});
async function setup(t,{locale='zh-CN',width=860,mode='light'}={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'test-environments-browser-')),store=path.join(temp,'store'),project=path.join(temp,'project');fs.mkdirSync(project);
 fs.writeFileSync(path.join(project,'app.cjs'),"console.log('browser click fixture');setInterval(()=>{},1000);");
 fs.writeFileSync(path.join(project,'prepare.cjs'),"require('fs').writeFileSync('sample.txt','browser sample');");
 fs.writeFileSync(path.join(project,'verify.cjs'),"if(require('fs').readFileSync('sample.txt','utf8')!=='browser sample')process.exit(3);");
 const core=new Environments(store),worker=spawn(process.execPath,[path.join(root,'node/worker.cjs')],{env:{...safeEnv(),TEST_ENVIRONMENTS_HOME:store},stdio:['pipe','pipe','pipe']});
 let id=0;const pending=new Map(),calls=[],errors=[],state={wake:true,delay:0},token=randomUUID();
 readline.createInterface({input:worker.stdout}).on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r.result);pending.delete(r.id);});
 const rpc=q=>new Promise(resolve=>{calls.push(q);const n=++id;pending.set(n,resolve);worker.stdin.write(JSON.stringify({id:n,method:q.method,params:q.params})+'\n');});
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  const reply=(value,status=200,type='application/json')=>{res.writeHead(status,{'Content-Type':type});res.end(type==='application/json'?JSON.stringify(value):value);};
  if(u.pathname==='/wake')return reply({},state.wake?200:503);
  if(u.pathname==='/app-context')return reply({context:{locale}});
  if(u.pathname==='/rpc'&&req.method==='POST'){
   if(req.headers.origin!==`http://127.0.0.1:${server.address().port}`||req.headers['x-test-bridge']!==token)return reply({},403);
   let body='';for await(const b of req){body+=b;if(body.length>100000){reply({},413);return;}}
   const q=JSON.parse(body);if(state.delay)await wait(state.delay);return reply(await rpc(q));
  }
  if(u.pathname==='/bridge.html')return reply(`<script>window.cindy={node:{request:async q=>({ok:true,result:await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Test-Bridge':${JSON.stringify(token)}},body:JSON.stringify(q)}).then(r=>r.json())})},onHostMessage:()=>{},send:async()=>{}};</script><script src="/main.js" onload="window.bridgeReady=true"></script>`,200,'text/html');
  const name=u.pathname.slice(1),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
  if(!['manage.html','manage.js','manage.css','main.js','assets/icon.png'].includes(name))return reply({},404);
  reply(fs.readFileSync(path.join(root,name)),200,types[path.extname(name)]);
 });server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
 const context=await browser.newContext({viewport:{width,height:900},colorScheme:mode});
 t.after(async()=>{for(const j of core.jobs())try{core.stop(j.jobId);}catch{}await wait(900);await context.close();worker.kill();await once(worker,'close');await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});assert.deepEqual(errors,[]);});
 const bridge=await context.newPage();await bridge.goto(url+'/bridge.html');await bridge.waitForFunction(()=>window.bridgeReady);
 const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/manage.html');await page.getByRole('button',{name:locale==='zh-CN'?'添加':locale==='en'?'Add':locale==='ja'?'追加':'추가',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('#tabs button').length===5);
 return {page,context,url,core,project,calls,state,errors,async shot(name){if(evidence){fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,name+'.png'),fullPage:true});}}};
}
const button=(page,name)=>page.getByRole('button',{name,exact:true});
async function tab(page,name){await button(page,name).click();await page.waitForFunction(()=>!document.querySelector('#tabs button:disabled'));}
async function editAdd(page){await button(page,'添加').click();await page.locator('#editor form').waitFor({state:'visible'});}
async function fill(page,values){for(const [name,value]of Object.entries(values)){const field=page.locator(`#editor [name="${name}"]`);if(await field.evaluate(e=>e.tagName)==='SELECT')await field.selectOption(value);else await field.fill(String(value));}}
async function save(page){await button(page,'保存').click();await page.locator('#editor').waitFor({state:'hidden'});await page.getByRole('status').filter({hasText:'已保存'}).waitFor();}
async function addProject(f,id='project',label='点击测试项目'){
 await tab(f.page,'项目');await editAdd(f.page);await fill(f.page,{id,label,root:f.project,adapter:'command',commands:JSON.stringify({start:[process.execPath,'app.cjs'],prepare:[process.execPath,'prepare.cjs'],verify:[process.execPath,'verify.cjs']})});await save(f.page);
}
async function addAccount(f,id,project='project'){
 await tab(f.page,'账号');await editAdd(f.page);await fill(f.page,{id,label:'示例 '+id,project,selector:'example-'+id});await save(f.page);
}
async function addProfile(f){await tab(f.page,'启动方案');await editAdd(f.page);await fill(f.page,{id:'daily',label:'日常验收',project:'project',account:'account-a',isolated:'browser'});await save(f.page);}

test('clicks save projects/accounts/profiles/cases, filter accounts, preview and preserve literal labels',async t=>{
 const f=await setup(t);assert.equal((await fetch(f.url+'/rpc',{method:'POST',body:JSON.stringify({method:'catalog'})})).status,403);await addProject(f,'project','<img src=x onerror="window.injected=true">');await addAccount(f,'account-a');await addAccount(f,'account-b');await addProject(f,'other');await addAccount(f,'other-account','other');
 await tab(f.page,'启动方案');await editAdd(f.page);await fill(f.page,{project:'project'});
 assert.deepEqual(await f.page.locator('[name="account"] option').allTextContents(),['请选择…','示例 account-a','示例 account-b']);
 await fill(f.page,{mode:'legacy'});assert.equal(await f.page.locator('[name="account"]').isDisabled(),true);await fill(f.page,{mode:'acceptance'});assert.equal(await f.page.locator('[name="account"]').isEnabled(),true);
 await button(f.page,'取消').click();await addProfile(f);
 await tab(f.page,'用例');await editAdd(f.page);await fill(f.page,{id:'case-a',label:'样本验收',profile:'daily',steps:JSON.stringify([{action:'Inspect prepared sample',expected:'browser sample'}])});await save(f.page);
 await tab(f.page,'启动方案');await button(f.page,'查看启动配置').click();await f.page.locator('#output').filter({hasText:'case-a'}).waitFor();
 const plan=JSON.parse(await f.page.locator('#output').textContent());assert.equal(plan.account.selector,'example-account-a');assert.equal(plan.workflow.cases[0].id,'case-a');
 await tab(f.page,'项目');assert.equal(await f.page.locator('#records img').count(),0);assert.equal(await f.page.evaluate(()=>window.injected),undefined);await f.shot('projects-literal-label');
});

test('clicks complete start, prepare samples, verify, stop and restart using actual child processes',async t=>{
 const f=await setup(t);await addProject(f);await addAccount(f,'account-a');await addProfile(f);
 assert.equal(await button(f.page,'准备样本').count(),1,'Desktop configured prepare command must be reachable from the management page');
 await button(f.page,'启动').click();await f.page.waitForFunction(()=>document.querySelector('#tabs button[aria-pressed="true"]').textContent==='运行记录');
 await until(()=>f.core.jobs(),jobs=>jobs.some(j=>j.action==='start'&&j.state==='running'));
 await tab(f.page,'启动方案');await button(f.page,'准备样本').click();await until(()=>f.core.jobs(),jobs=>jobs.some(j=>j.action==='prepare'&&j.state==='completed'));assert.equal(fs.readFileSync(path.join(f.project,'sample.txt'),'utf8'),'browser sample');
 await tab(f.page,'启动方案');await button(f.page,'验证').click();await until(()=>f.core.jobs(),jobs=>jobs.some(j=>j.action==='verify'&&j.state==='completed'));
 await button(f.page,'刷新').click();const running=f.page.locator('article').filter({has:f.page.getByText('运行中',{exact:true})});await running.getByRole('button',{name:'停止',exact:true}).click();await until(()=>f.core.jobs(),jobs=>jobs.filter(j=>j.action==='start').every(j=>j.state==='stopped'));
 await tab(f.page,'启动方案');await button(f.page,'启动').click();await until(()=>f.core.jobs(),jobs=>jobs.filter(j=>j.action==='start').length===2&&jobs.some(j=>j.state==='running'));
 assert.equal(Object.keys(f.core.catalog().accounts).length,1);await button(f.page,'刷新').click();await f.shot('runs-stopped-and-restarted');
});

async function until(fn,predicate){const end=Date.now()+10000;while(Date.now()<end){const value=await fn();if(predicate(value))return value;await wait(100);}assert.fail('Timed out waiting for the owned job');}

test('clicks reject rebinding and invalid JSON, preserve newer edits and recover from wake failure',async t=>{
 const f=await setup(t);await addProject(f);await addAccount(f,'account-a');await button(f.page,'编辑').click();await fill(f.page,{selector:'different-account'});await button(f.page,'保存').click();await f.page.getByRole('status').filter({hasText:'ACCOUNT_IDENTITY_CHANGED'}).waitFor();assert.equal(f.core.catalog().accounts['account-a'].selector,'example-account-a');await button(f.page,'取消').click();
 await tab(f.page,'项目');await button(f.page,'编辑').click();await fill(f.page,{commands:'{ broken json'});await button(f.page,'保存').click();await f.page.locator('#notice.error').waitFor();assert.equal(f.core.catalog().projects.project.commands.start[1],'app.cjs');await button(f.page,'取消').click();
 await button(f.page,'编辑').click();f.core.saveAccount({id:'account-b',project:'project',label:'Other editor',selector:'example-b'});await fill(f.page,{label:'stale overwrite'});await button(f.page,'保存').click();await f.page.getByRole('status').filter({hasText:'保存前请刷新'}).waitFor();assert.equal(f.core.catalog().projects.project.label,'点击测试项目');await button(f.page,'取消').click();
 f.state.wake=false;await button(f.page,'刷新').click();await f.page.getByRole('status').filter({hasText:'连接未完成'}).waitFor();f.state.wake=true;await button(f.page,'刷新').click();await until(()=>f.page.locator('#notice').textContent(),s=>s==='');await f.shot('recovered-connection');
});

test('clicking save with a delayed response deduplicates BroadcastChannel retries',async t=>{
 const f=await setup(t);await addProject(f);await tab(f.page,'账号');await editAdd(f.page);await fill(f.page,{id:'account-a',label:'Delayed example',project:'project',selector:'example-a'});f.state.delay=1400;const before=f.calls.length;
 await button(f.page,'保存').click();await f.page.locator('#editor').waitFor({state:'hidden'});await f.page.getByRole('status').filter({hasText:'已保存'}).waitFor();assert.equal(f.calls.slice(before).filter(q=>q.method==='save_account').length,1);assert.equal(Object.keys(f.core.catalog().accounts).length,1);
});

for(const locale of ['zh-CN','en','ja','ko'])for(const mode of ['light','dark'])test(`narrow ${locale}/${mode} original page has translated controls and no horizontal overflow`,async t=>{
 const f=await setup(t,{locale,mode,width:320}),labels={'zh-CN':'添加',en:'Add',ja:'追加',ko:'추가'};
 await button(f.page,labels[locale]).click();assert.equal(await f.page.locator('html').getAttribute('lang'),locale);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await f.shot(`narrow-${locale}-${mode}`);
});

test('clicks remember/select accounts against a simulated app over real CDP and show expired-session guidance',async t=>{
 const f=await setup(t),net=await import('node:net'),reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 fs.mkdirSync(path.join(f.project,'scripts'));fs.writeFileSync(path.join(f.project,'scripts/restart-desktop-remote.mjs'),'');fs.writeFileSync(path.join(f.project,'scripts/desktop-restart-runner.mjs'),'');
 f.core.saveProject({id:'cindy',label:'模拟 Cindy 协议',root:f.project,adapter:'cindy'});f.core.saveProfile({id:'account-flow',label:'模拟账号流程',project:'cindy',mode:'acceptance',platform:'desktop',isolated:'browser-accounts',debugPort:port});
 const dir=path.join(f.core.home,'jobs','ui-account-job');fs.mkdirSync(dir,{recursive:true});
 const plan={...f.core.plan('account-flow'),catalogHome:f.core.home,argv:[process.execPath,path.resolve(import.meta.dirname,'fixtures/test-environments-app.cjs'),dir]};
 fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(plan));fs.writeFileSync(path.join(dir,'account.json'),JSON.stringify({current:'account-a'}));fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({jobId:'ui-account-job',profile:'account-flow',projectRoot:plan.projectRoot,startedAt:Date.now(),action:'start',state:'starting'}));
 const runner=spawn(process.execPath,[path.join(root,'node/runner.cjs'),dir],{stdio:'ignore'}),exited=once(runner,'exit');t.after(async()=>{if(runner.exitCode===null&&runner.signalCode===null)fs.writeFileSync(path.join(dir,'cancel.json'),'{}');await exited;});
 await until(()=>f.core.status('ui-account-job'),s=>s.state==='ready');fs.writeFileSync(path.join(dir,'account.json'),JSON.stringify({current:'account-b'}));await until(()=>Object.keys(f.core.catalog().accounts),keys=>keys.length===2);
 await button(f.page,'刷新').click();await tab(f.page,'运行记录');await button(f.page,'记住账号').click();await until(()=>f.page.getByRole('combobox',{name:'选用账号'}).count(),n=>n===1);
 const account=Object.values(f.core.catalog().accounts).find(a=>a.selector==='account-a');await f.page.getByRole('combobox',{name:'选用账号'}).selectOption(account.id);await button(f.page,'选用账号').click();await until(()=>f.core.status('ui-account-job'),s=>s.state==='ready'&&s.currentAccount?.accountKey==='account-a');
 await button(f.page,'刷新').click();await button(f.page,'详情').click();await f.page.locator('#output').filter({hasText:'application-account-online'}).waitFor();await f.shot('simulated-account-selection');
 fs.writeFileSync(path.join(dir,'account.json'),JSON.stringify({current:'account-a',expired:true}));await until(()=>f.core.status('ui-account-job'),s=>s.state==='waiting-for-owner');await button(f.page,'刷新').click();await button(f.page,'详情').click();await f.page.locator('#output').filter({hasText:'ACCOUNT_REAUTH_REQUIRED'}).waitFor();await f.page.getByText('本机登录已失效，请在目标应用中重新登录。其他电脑的登录态不受影响。',{exact:true}).waitFor();await f.shot('simulated-expired-login');
 await button(f.page,'停止').click();await until(()=>f.core.status('ui-account-job'),s=>s.state==='stopped');await exited;
});
