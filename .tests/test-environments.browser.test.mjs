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
async function setup(t,{locale='zh-CN',width=860,mode='light',advanced=true}={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'test-environments-browser-')),store=path.join(temp,'store'),project=path.join(temp,'project');fs.mkdirSync(project);
 fs.writeFileSync(path.join(project,'app.cjs'),"console.log('browser click fixture');setInterval(()=>{},1000);");
 fs.writeFileSync(path.join(project,'prepare.cjs'),"require('fs').writeFileSync('sample.txt','browser sample');");
 fs.writeFileSync(path.join(project,'verify.cjs'),"if(require('fs').readFileSync('sample.txt','utf8')!=='browser sample')process.exit(3);");
 const core=new Environments(store),worker=spawn(process.execPath,[path.join(root,'node/worker.cjs')],{env:{...safeEnv(),TEST_ENVIRONMENTS_HOME:store},stdio:['pipe','pipe','pipe']});
 let id=0;const pending=new Map(),calls=[],errors=[],state={wake:true,delay:0,pickCalls:[],pickResult:{ok:false,errorCode:'CANCELLED'}},token=randomUUID();
 readline.createInterface({input:worker.stdout}).on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r.result);pending.delete(r.id);});
 const rpc=q=>new Promise(resolve=>{calls.push(q);const n=++id;pending.set(n,resolve);worker.stdin.write(JSON.stringify({id:n,method:q.method,params:q.params})+'\n');});
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  const reply=(value,status=200,type='application/json')=>{res.writeHead(status,{'Content-Type':type});res.end(type==='application/json'?JSON.stringify(value):value);};
  if(u.pathname==='/wake')return reply({},state.wake?200:503);
  if(u.pathname==='/app-context')return reply({context:{locale}});
  if(u.pathname==='/pick'&&req.method==='POST'){if(req.headers.origin!==`http://127.0.0.1:${server.address().port}`||req.headers['x-test-bridge']!==token)return reply({},403);let body='';for await(const b of req)body+=b;state.pickCalls.push(JSON.parse(body));if(state.pickDelay)await wait(state.pickDelay);return reply(state.pickResult);}
  if(u.pathname==='/rpc'&&req.method==='POST'){
   if(req.headers.origin!==`http://127.0.0.1:${server.address().port}`||req.headers['x-test-bridge']!==token)return reply({},403);
   let body='';for await(const b of req){body+=b;if(body.length>100000){reply({},413);return;}}
   const q=JSON.parse(body);if(q.method==='remote'&&state.remoteHandler){calls.push(q);try{return reply({ok:true,data:await state.remoteHandler(q.params)});}catch(e){return reply({ok:false,errorCode:e.code||'REMOTE_FAILED',message:e.message,execution:e.execution||'unknown'});}}if(state.delay)await wait(state.delay);return reply(await rpc(q));
  }
  if(u.pathname==='/bridge.html')return reply(`<meta charset="utf-8"><script>window.cindy={pick:async q=>fetch('/pick',{method:'POST',headers:{'Content-Type':'application/json','X-Test-Bridge':${JSON.stringify(token)}},body:JSON.stringify(q)}).then(r=>r.json()),node:{request:async q=>({ok:true,result:await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Test-Bridge':${JSON.stringify(token)}},body:JSON.stringify(q)}).then(r=>r.json())})},onHostMessage:()=>{},send:async()=>{}};</script><script src="/main.js" onload="window.bridgeReady=true"></script>`,200,'text/html');
  const name=u.pathname.slice(1),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
  if(!['manage.html','manage.js','manage.css','main.js','workflow.js','assets/icon.png'].includes(name))return reply({},404);
  reply(fs.readFileSync(path.join(root,name)),200,types[path.extname(name)]);
 });server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
 const context=await browser.newContext({viewport:{width,height:900},colorScheme:mode});
 t.after(async()=>{for(const j of core.jobs())try{core.stop(j.jobId);}catch{}await wait(900);await context.close();worker.kill();await once(worker,'close');await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true});assert.deepEqual(errors,[]);});
 const bridge=await context.newPage();await bridge.goto(url+'/bridge.html');await bridge.waitForFunction(()=>window.bridgeReady);
 const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/manage.html');if(advanced)await page.locator('#advanced>summary').click();if(advanced)await page.getByRole('button',{name:locale==='zh-CN'?'添加':locale==='en'?'Add':locale==='ja'?'追加':'추가',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('#tabs button').length===5);
 return {page,context,url,core,project,calls,state,errors,async shot(name){if(evidence){fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,name+'.png'),fullPage:true});}}};
}
const button=(page,name)=>page.locator('#advanced').getByRole('button',{name,exact:true});
test('saved account picker reuses another project profile and follows its reported region without launching',async t=>{
 const f=await setup(t,{advanced:false});
 fs.mkdirSync(path.join(f.project,'scripts'));for(const file of ['restart-desktop-remote.mjs','desktop-restart-runner.mjs'])fs.writeFileSync(path.join(f.project,'scripts',file),'');
 f.core.saveProject({id:'source',label:'示例源码',root:f.project,adapter:'cindy'});
 const prepared=f.core.ensureTestProject({project:'source',region:'cn'}),profile=f.core.read().profiles[prepared.profile.id];
 const {rememberAccounts}=require('../test-environments/node/account-catalog.cjs');
 const userDataDir=path.join(f.project,'app-owned-login');
 rememberAccounts(f.core.home,f.core.plan(profile.id),{userDataDir},{authenticated:true,accounts:[{accountKey:'opaque-example-account',displayName:'示例正式账号',isCurrent:true}]});
 await f.page.reload();await f.page.getByLabel('已保存的测试账号',{exact:true}).waitFor();
 const account=f.core.loginAccounts().accounts[0];
 await f.page.getByLabel('已保存的测试账号',{exact:true}).selectOption(account.id);
 await until(()=>f.page.getByLabel('已保存的测试账号',{exact:true}).inputValue(),value=>value===account.id);
 await f.page.getByText('沿用上次登录档案的版本；应用未提供这个账号的所属区域。',{exact:true}).waitFor();
 await f.page.getByText('应用保管登录态的位置',{exact:true}).click();
 await f.page.getByText(userDataDir,{exact:true}).waitFor();
 assert.equal(f.core.jobs().length,0);
 const bound=Object.values(f.core.read().profiles).find(p=>p.libraryAccount===account.id);assert.equal(bound.region,'cn');assert.equal(bound.isolated,profile.isolated);
 assert.equal(await f.page.getByLabel('首次登录使用的版本',{exact:true}).count(),0);
 await f.shot('saved-account-picker');
 await f.page.getByLabel('已保存的测试账号',{exact:true}).selectOption('');
 await f.page.getByLabel('首次登录使用的版本',{exact:true}).waitFor();
 await f.page.getByLabel('首次登录使用的版本',{exact:true}).selectOption('global');
 await until(()=>f.page.getByLabel('首次登录使用的版本',{exact:true}).inputValue(),value=>value==='global');
 assert.equal(f.core.jobs().length,0);
 assert.equal(f.core.loginAccounts().accounts[0].id,account.id);
});
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
 await button(f.page,'编辑').click();f.core.saveAccount({id:'account-b',project:'project',label:'Other editor',selector:'example-b'});await fill(f.page,{label:'stale overwrite'});await button(f.page,'保存').click();await f.page.getByRole('status').filter({hasText:'请刷新后再保存'}).waitFor();assert.equal(f.core.catalog().projects.project.label,'点击测试项目');await button(f.page,'取消').click();
 f.state.wake=false;await button(f.page,'刷新').click();await f.page.getByRole('status').filter({hasText:'连接未完成'}).waitFor();f.state.wake=true;await button(f.page,'刷新').click();await until(()=>f.page.locator('#notice').textContent(),s=>s==='');await f.shot('recovered-connection');
});

test('clicking save with a delayed response deduplicates BroadcastChannel retries',async t=>{
 const f=await setup(t);await f.page.evaluate(()=>{const original=channel.onmessage;channel.onmessage=event=>{if(event.data.type!=='accepted')original(event);};});await addProject(f);await tab(f.page,'账号');await editAdd(f.page);await fill(f.page,{id:'account-a',label:'Delayed example',project:'project',selector:'example-a'});f.state.delay=1400;const before=f.calls.length;
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
 fs.writeFileSync(path.join(dir,'account.json'),JSON.stringify({current:'account-a',expired:true}));await until(()=>f.core.status('ui-account-job'),s=>s.state==='waiting-for-owner');await button(f.page,'刷新').click();await button(f.page,'详情').click();await f.page.locator('#output').filter({hasText:'ACCOUNT_REAUTH_REQUIRED'}).waitFor();await f.page.locator('#records').getByText('本机登录已失效，请在目标应用中重新登录。其他电脑的登录态不受影响。',{exact:true}).waitFor();await f.shot('simulated-expired-login');
 await button(f.page,'停止').click();await until(()=>f.core.status('ui-account-job'),s=>s.state==='stopped');await exited;
});

const home=page=>page.locator('#workflow');
const homeButton=(page,name)=>home(page).getByRole('button',{name,exact:true});
test('first use reuses the native picker, stores defaults once and never launches on selection',async t=>{
 const f=await setup(t,{advanced:false});await homeButton(f.page,'选择项目…').waitFor();assert.equal(await home(f.page).locator('input').count(),0);
 fs.mkdirSync(path.join(f.project,'scripts'));fs.writeFileSync(path.join(f.project,'scripts/restart-desktop-remote.mjs'),'');fs.writeFileSync(path.join(f.project,'scripts/desktop-restart-runner.mjs'),'');f.state.pickResult={ok:true,path:f.project,name:'我的 Cindy'};
 await homeButton(f.page,'选择项目…').click();await homeButton(f.page,'启动测试').waitFor();const db=f.core.catalog(),p=Object.values(db.profiles)[0];assert.equal(Object.keys(db.projects).length,1);assert.equal(p.mode,'acceptance');assert.equal(p.remoteControl,'off');assert.ok(p.isolated);assert.equal(f.core.jobs().length,0);assert.deepEqual(f.state.pickCalls[0],{mode:'directory',title:'选择 Cindy 项目'});await f.shot('compact-first-selected');
 await homeButton(f.page,'选择项目…').click();await until(()=>f.state.pickCalls.length,n=>n===2);await until(()=>f.core.catalog().revision,n=>n>db.revision);assert.equal(Object.keys(f.core.catalog().projects).length,1);assert.equal(Object.values(f.core.catalog().profiles)[0].isolated,p.isolated);await f.page.reload();await homeButton(f.page,'启动测试').waitFor();assert.equal(f.core.jobs().length,0);
});

test('native picker cancellation is respected without saving, launching or automatically reopening',async t=>{
 const f=await setup(t,{advanced:false});await homeButton(f.page,'选择项目…').click();await until(()=>f.state.pickCalls.length,n=>n===1);await homeButton(f.page,'选择项目…').waitFor({state:'visible'});assert.equal(Object.keys(f.core.catalog().projects).length,0);assert.equal(f.core.jobs().length,0);assert.equal(f.state.pickCalls.length,1);
});

test('guided local workflow previews before launch and executes sample/check/stop without claiming command login',async t=>{
 const f=await setup(t,{advanced:false});f.core.saveProject({id:'p',label:'样本项目',root:f.project,adapter:'command',commands:{start:[process.execPath,'app.cjs'],prepare:[process.execPath,'prepare.cjs'],verify:[process.execPath,'verify.cjs']}});f.core.saveProfile({id:'daily',label:'可复用配置',project:'p',platform:'desktop',mode:'acceptance'});
 await f.page.reload();assert.equal(f.core.jobs().length,0);await homeButton(f.page,'启动测试').click();await until(()=>f.core.jobs(),jobs=>jobs.some(j=>j.action==='start'&&j.state==='running'));
 await homeButton(f.page,'更新状态').click();await home(f.page).getByText('应用进程已启动。请按应用自己的方式登录并检查用例；启动成功不代表验收通过。',{exact:true}).waitFor();
 for(const [label,action]of [['准备样本','prepare'],['运行验收脚本','verify']]){await homeButton(f.page,label).click();await until(()=>f.core.jobs(),jobs=>jobs.some(j=>j.action===action&&j.state==='completed'));await homeButton(f.page,'更新状态').click();}
 assert.equal(fs.readFileSync(path.join(f.project,'sample.txt'),'utf8'),'browser sample');assert.equal(await home(f.page).locator('.workflow-panel').count(),2);await f.shot('guided-local-running');await homeButton(f.page,'停止这次实例').click();await until(()=>f.core.jobs(),jobs=>jobs.filter(j=>j.action==='start').every(j=>j.state==='stopped'));await homeButton(f.page,'更新状态').click();await f.shot('guided-local-stopped');const starts=f.calls.filter(q=>q.method==='start'&&!q.params?.action).length;await f.page.reload();await homeButton(f.page,'启动测试').waitFor();assert.equal(f.calls.filter(q=>q.method==='start'&&!q.params?.action).length,starts);
});

function remoteFixture(f){const runId='00000000-0000-4000-8000-000000000009',commit='a'.repeat(40),ops=[];let state='running';
 const profile={id:'daily',label:'远端配置',project:'remote',platform:'desktop',mode:'legacy'},catalog={projects:{remote:{id:'remote',label:'远端项目',adapter:'command'}},profiles:{daily:profile},accounts:{},cases:{}};
 f.state.remoteHandler=async q=>{ops.push(q);if(q.operation==='catalog')return {hardware:{model:'Fixture Mac'},catalog};if(q.operation==='plan')return {runId,target:q.target,execution:'not_executed',plan:{profile:'daily',pr:{...q.pr,commit},source:{profile}}};if(q.operation==='start')return {runId,state:'preparing',execution:'requested'};if(q.operation==='stop'){state='stopped';return {runId,state:'stopping',execution:'requested'};}if(q.operation==='status')return {runId,state,profile:'daily',hardware:{model:'Fixture Mac'},job:{jobId:'remote-job',state,profile:'daily'},actions:[],accounts:[]};if(q.operation==='collect'){const file=path.join(f.project,'result.json');fs.writeFileSync(file,JSON.stringify({runId,state}));return {runId,files:[{path:file,name:'result.json'}]};}if(q.operation==='action')return {runId,execution:'requested'};throw Error('Unexpected remote operation');};return {runId,commit,ops};}
async function remoteGuide(f){await homeButton(f.page,'另一台电脑 · SSH').click();await home(f.page).getByLabel('SSH 电脑名称',{exact:true}).fill('computer-b.example.test');await homeButton(f.page,'连接并读取项目').click();await home(f.page).getByLabel('目标应用的 PR 链接',{exact:true}).fill('https://github.com/example/client/pull/17');await homeButton(f.page,'读取 PR 并预览').click();await homeButton(f.page,'启动测试').waitFor();}

test('guided remote UI freezes preview, passes omitted SHA and retains runId for stop/evidence/resume',async t=>{
 const f=await setup(t,{advanced:false}),r=remoteFixture(f);await remoteGuide(f);assert.equal(r.ops.filter(q=>q.operation==='start').length,0);const preview=r.ops.find(q=>q.operation==='plan');assert.equal(preview.pr.repo,'example/client');assert.equal(preview.pr.number,17);assert.equal(preview.pr.commit,undefined);
 await home(f.page).getByLabel('目标应用的 PR 链接',{exact:true}).fill('https://github.com/example/client/pull/18');assert.equal(await homeButton(f.page,'启动测试').isDisabled(),true);await homeButton(f.page,'读取 PR 并预览').click();await homeButton(f.page,'启动测试').click();await homeButton(f.page,'停止这次实例').waitFor();assert.equal(r.ops.filter(q=>q.operation==='start').length,1);assert.equal(await home(f.page).getByLabel('目标应用的 PR 链接',{exact:true}).isVisible(),false);await f.shot('guided-remote-active');
 await homeButton(f.page,'停止这次实例').click();await homeButton(f.page,'取回日志和结果').click();await home(f.page).getByRole('heading',{name:'已保存的证据',exact:true}).waitFor();assert.equal(r.ops.findLast(q=>q.operation==='collect').screenshot,false);assert.ok(r.ops.filter(q=>['status','stop','collect'].includes(q.operation)).every(q=>q.runId===r.runId));await f.page.reload();await homeButton(f.page,'读取这次运行').click();await homeButton(f.page,'取回日志和结果').waitFor();assert.equal(r.ops.filter(q=>q.operation==='start').length,1);
});

test('guided remote UI preserves a lost-start runId and removes the blind-start button',async t=>{
 const f=await setup(t,{advanced:false}),r=remoteFixture(f),original=f.state.remoteHandler;f.state.remoteHandler=q=>{if(q.operation==='start'){r.ops.push(q);throw Object.assign(Error('lost fixture receipt'),{code:'SSH_UNCONFIRMED'});}return original(q);};await remoteGuide(f);await homeButton(f.page,'启动测试').click();await f.page.getByRole('status').filter({hasText:'连接没有完成'}).waitFor();assert.equal(await homeButton(f.page,'启动测试').count(),0);await homeButton(f.page,'读取这次运行').click();await homeButton(f.page,'停止这次实例').waitFor();assert.equal(r.ops.filter(q=>q.operation==='start').length,1);
});

for(const locale of ['zh-CN','en','ja','ko'])for(const mode of ['light','dark'])test(`guided first-use ${locale}/${mode} fits 320px with advanced settings collapsed`,async t=>{
 const f=await setup(t,{locale,mode,width:320,advanced:false}),titles={'zh-CN':'选择项目',en:'Choose a project',ja:'プロジェクトを選択',ko:'프로젝트 선택'};await home(f.page).getByRole('heading',{name:titles[locale],exact:true}).waitFor();assert.equal(await f.page.locator('#advanced').getAttribute('open'),null);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await f.shot(`guided-${locale}-${mode}`);
});

test('guided stop also cancels this run’s active sample command while preserving another project',async t=>{
 const f=await setup(t,{advanced:false});fs.writeFileSync(path.join(f.project,'long-prepare.cjs'),"setInterval(()=>{},1000);");
 f.core.saveProject({id:'p',label:'目标项目',root:f.project,adapter:'command',commands:{start:[process.execPath,'app.cjs'],prepare:[process.execPath,'long-prepare.cjs']}});f.core.saveProfile({id:'daily',label:'目标配置',project:'p',platform:'desktop',mode:'acceptance'});
 const other=path.join(f.project,'other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'app.cjs'),"setInterval(()=>{},1000);");f.core.saveProject({id:'other',label:'Other',root:other,adapter:'command',commands:{start:[process.execPath,'app.cjs']}});f.core.saveProfile({id:'other',label:'Other',project:'other',platform:'desktop',mode:'legacy'});const unrelated=f.core.start('other');
 await f.page.reload();await homeButton(f.page,'启动测试').click();await until(()=>f.core.jobs(),jobs=>jobs.some(j=>j.profile==='daily'&&j.action==='start'&&j.state==='running'));await homeButton(f.page,'更新状态').click();await homeButton(f.page,'准备样本').click();await until(()=>f.core.jobs(),jobs=>jobs.some(j=>j.profile==='daily'&&j.action==='prepare'&&j.state==='running'));await homeButton(f.page,'停止这次实例').click();await until(()=>f.core.jobs(),jobs=>jobs.filter(j=>j.profile==='daily').every(j=>['stopped','completed','failed'].includes(j.state)));assert.equal(f.core.status(unrelated.jobId).state,'running');
});

test('guided viewing state persists validated references rather than invalid SSH text or PR query secrets',async t=>{
 const f=await setup(t,{advanced:false});await homeButton(f.page,'另一台电脑 · SSH').click();await home(f.page).getByLabel('SSH 电脑名称',{exact:true}).fill('invalid; example-private-text');
 let saved=await f.page.evaluate(()=>localStorage.getItem('test-environments-workflow'));assert.equal(saved.includes('example-private-text'),false);
 const r=remoteFixture(f);await home(f.page).getByLabel('SSH 电脑名称',{exact:true}).fill('computer-b.example.test');await homeButton(f.page,'连接并读取项目').click();await home(f.page).getByLabel('目标应用的 PR 链接',{exact:true}).fill('https://github.com/example/client/pull/17?token=example-query-secret');saved=await f.page.evaluate(()=>localStorage.getItem('test-environments-workflow'));assert.equal(saved.includes('example-query-secret'),false);assert.equal(JSON.parse(saved).prUrl,'https://github.com/example/client/pull/17');assert.equal(r.ops.some(q=>q.operation==='plan'),false);
});
