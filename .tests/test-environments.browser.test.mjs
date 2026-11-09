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
 const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/manage.html');await page.waitForFunction(()=>document.querySelector('#refresh').textContent.length>0);await page.waitForFunction(()=>document.querySelector('#accounts').children.length>0);
 return {page,context,url,core,project,calls,state,errors,async shot(name){if(evidence){fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,name+'.png'),fullPage:true});}}};
}
function seed(f){
 fs.mkdirSync(path.join(f.project,'scripts'));for(const name of ['restart-desktop-remote.mjs','desktop-restart-runner.mjs'])fs.writeFileSync(path.join(f.project,'scripts',name),'');
 f.core.saveProject({id:'source',label:'Example',root:f.project,adapter:'cindy'});
 const prepared=f.core.ensureTestProject({project:'source',region:'global'}),profile=f.core.read().profiles[prepared.profile.id];
 const {rememberAccounts}=require('../test-environments/node/account-catalog.cjs');
 rememberAccounts(f.core.home,f.core.plan(profile.id),{userDataDir:path.join(f.project,'app-owned-login')},{authenticated:true,accounts:[{accountKey:'example-a',displayName:'Example A',isCurrent:true},{accountKey:'example-b',displayName:'Example B'}]});
 return f.core.loginAccounts().accounts;
}
test('empty account page has no project, API, PR, package or advanced forms; add explains the conversation prerequisite',async t=>{
 const f=await setup(t);assert.equal(await f.page.locator('input,select,textarea,#advanced,#tabs').count(),0);
 await f.page.getByRole('button',{name:'添加账号',exact:true}).click();await f.page.getByRole('status').filter({hasText:'先在右侧对话说'}).waitFor();
 assert.equal(f.core.jobs().length,0);assert.equal(f.state.pickCalls.length,0);await f.shot('accounts-empty');
});
test('click saves the exact account for the conversation, survives reload and never starts or switches a client',async t=>{
 const f=await setup(t),accounts=seed(f);await f.page.getByRole('button',{name:'刷新',exact:true}).click();
 const card=f.page.locator('article').filter({hasText:'Example B'});await card.getByRole('button',{name:'使用这个账号',exact:true}).click();await card.getByRole('button',{name:'下次测试使用',exact:true}).waitFor();
 assert.equal(f.core.loginAccounts().selectedAccount,accounts[1].id);assert.equal(f.core.jobs().length,0);
 await f.page.reload();await f.page.locator('article').filter({hasText:'Example B'}).getByRole('button',{name:'下次测试使用',exact:true}).waitFor();
 await f.page.locator('summary').click();assert.match(await f.page.locator('#storage').textContent(),/app-owned-login/);
 assert.equal(f.calls.some(q=>['start','select_account','bind_login_account'].includes(q.method)),false);await f.shot('accounts-selected');
});
test('unavailable account cannot be selected and public labels render as text',async t=>{
 const f=await setup(t);const accounts=seed(f);f.core.change(db=>{db.loginAccounts[accounts[0].id].label='<img src=x onerror=alert(1)>';for(const s of Object.values(db.loginAccounts[accounts[0].id].sessions))s.listed=false;});await f.page.getByRole('button',{name:'刷新',exact:true}).click();
 const card=f.page.locator('article').first();await card.getByText('需要重新登录',{exact:true}).waitFor();assert.equal(await card.locator('button').isDisabled(),true);assert.equal(await card.locator('img').count(),0);
});
test('failed wake is visible and refresh recovers without repeating account actions',async t=>{
 const f=await setup(t);f.state.wake=false;await f.page.getByRole('button',{name:'添加账号',exact:true}).click();await f.page.getByRole('status').filter({hasText:'连接结果未确认'}).waitFor();f.state.wake=true;await f.page.getByRole('button',{name:'刷新',exact:true}).click();await f.page.waitForFunction(()=>!document.querySelector('#notice').textContent);assert.equal(f.calls.some(q=>q.method==='add_account'),false);
});
for(const locale of ['en','zh-CN','ja','ko'])for(const mode of ['light','dark'])test(`account page fits 320px in ${locale} / ${mode}`,async t=>{
 const f=await setup(t,{locale,mode,width:320});seed(f);await f.page.locator('#refresh').click();await f.page.locator('article').first().waitFor();await f.page.locator('summary').click();assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await f.page.locator('input,select,textarea').count(),0);await f.shot('accounts-'+locale+'-'+mode);
});
