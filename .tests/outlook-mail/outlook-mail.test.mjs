import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const source=fs.readFileSync(new URL('../../outlook-mail/main.js',import.meta.url),'utf8');
const manifest=JSON.parse(fs.readFileSync(new URL('../../outlook-mail/ghost.json',import.meta.url)));
const response=(data,status=200,extra={})=>({ok:true,status,body:data===null?'':JSON.stringify(data),...extra});
const fixture=[
  {key:'outlook_global',clientConfigured:true,accounts:[{id:'g1',label:'Global',status:'connected',isDefault:true},{id:'g2',label:'Second',status:'connected',isDefault:false}]},
  {key:'outlook_china',clientConfigured:true,accounts:[{id:'c1',label:'China',status:'connected',isDefault:true}]},
];
function harness({accounts=structuredClone(fixture),config={},localFailure=false,reply=response({value:[]})}={}) {
  const requests=[],results=[],locals=[];let listener;
  const context=vm.createContext({URL,URLSearchParams,TextEncoder,TextDecoder,btoa,atob,
    fetch:async path=>{locals.push(path);if(localFailure)throw new Error('private local failure');return {ok:true,json:async()=>path==='/oauth'?accounts:config};},
    cindy:{onHostMessage:fn=>listener=fn,send:r=>results.push(r),fetch:async req=>{requests.push(req);if(reply instanceof Error)throw reply;return typeof reply==='function'?reply(req):reply;}},
  });
  vm.runInContext(source,context);
  const M=context.OutlookMail;
  return {M,requests,results,locals,call:async args=>{await listener({type:'tool-call',tool:'outlook_mail',args,callId:'test-call'});return results.at(-1);},
    accounts:async()=>{await listener({type:'tool-call',tool:'outlook_accounts',args:{},callId:'list-call'});return results.at(-1);}};
}
const send={action:'send',to:'reader@example.test',subject:'Test',body_text:'Hello'};
const mutation=(action)=> ['send','draft'].includes(action) ? {...send,action} : action === 'move' ? {action,message_id:'old/id+=',target_folder:'target/id'} : {action,message_id:'old/id+='};
const ctx={base:'https://graph.microsoft.com/v1.0',cloud:'global',account:'g1'};

test('account setup can be inspected before either cloud is configured',async()=>{
  // Configuration inspection remains available before connecting. Mail actions
  // separately require a configured application and a connected account.
  assert.deepEqual(manifest.setup,{requires:[]});
  const entries=structuredClone(fixture);
  for(const e of entries){e.clientConfigured=false;e.accounts=[];}
  const h=harness({accounts:entries});
  assert((await h.accounts()).ok);
  const r=await h.call({action:'search'});
  assert.equal(r.ok,false);assert.equal(h.requests.length,0);
});

test('manifest separates clouds and permits public application IDs but no client secrets',()=>{
  assert.equal(manifest.schemaVersion,3);assert.equal(manifest.slots,undefined);
  assert.equal(manifest.network.secrets.length,2);
  for(const s of manifest.network.secrets){
    assert.equal(s.source,'oauth');assert.equal(s.oauth.pkce,true);assert.equal(s.oauth.clientSecret,undefined);
    if (s.oauth.clientId !== undefined) assert.match(s.oauth.clientId,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.equal(s.inject.hosts.length,1);
    const base='https://'+s.inject.hosts[0];
    assert(s.oauth.scopes.includes(base+'/Mail.ReadWrite'));assert(s.oauth.scopes.includes(base+'/Mail.Send'));
    assert(s.oauth.scopes.includes('offline_access'));assert(s.oauth.identity.url.startsWith(base+'/'));
    assert.equal(s.oauth.identity.labelPath,'id');
  }
});
test('application configuration changes only the selected cloud and rejects invalid IDs without writing',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'outlook-app-config-test-'));
  try {
    fs.mkdirSync(path.join(dir,'scripts'));fs.mkdirSync(path.join(dir,'outlook-mail'));
    const script=path.join(dir,'scripts','configure-outlook-app.mjs');
    const file=path.join(dir,'outlook-mail','ghost.json');
    fs.copyFileSync(new URL('../../scripts/configure-outlook-app.mjs',import.meta.url),script);
    fs.writeFileSync(file,JSON.stringify(manifest));
    const publicId='12345678-1234-1234-1234-123456789abc';
    execFileSync(process.execPath,[script,'china',publicId]);
    const expected=structuredClone(manifest);
    expected.network.secrets.find(s=>s.key==='outlook_china').oauth.clientId=publicId;
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),expected);
    const before=fs.readFileSync(file,'utf8');
    for (const args of [['global','not-a-client-id'],['invalid',publicId],['global',publicId,'extra']]) {
      assert.throws(()=>execFileSync(process.execPath,[script,...args],{stdio:'pipe'}));
      assert.equal(fs.readFileSync(file,'utf8'),before);
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('all four catalog locales preserve tool set',()=>{
  for(const lang of ['en','zh-CN','ja','ko']){
    const l=JSON.parse(fs.readFileSync(new URL('../../outlook-mail/'+manifest.locales[lang],import.meta.url)));
    assert.deepEqual(Object.keys(l.tools).sort(),manifest.tools.map(t=>t.name).sort());
    for(const key of ['name','description','whenToUse'])assert(l[key].length>0);
  }
});
test('account listing contains no tokens and makes no Graph request',async()=>{
  const h=harness();const r=await h.accounts();assert(r.ok);assert.equal(r.result.regions.length,2);assert.equal(h.requests.length,0);
});
test('default global routes to explicitly resolved account and carries callId',async()=>{
  const h=harness();assert((await h.call({action:'search'})).ok);const q=h.requests[0];
  assert.equal(q.authAccount,'g1');assert.equal(q.callId,'test-call');assert(q.url.startsWith(ctx.base+'/me/messages?'));
  assert.equal(new URL(q.url).searchParams.get('$orderby'),'receivedDateTime desc');
  assert.equal(q.headers.Authorization,undefined);
});
test('configured China default is respected',async()=>{
  const h=harness({config:{default_cloud:'china'}});const r=await h.call({action:'search'});assert(r.ok);
  assert.equal(r.result.cloud,'china');assert(h.requests[0].url.startsWith('https://microsoftgraph.chinacloudapi.cn/'));assert.equal(h.requests[0].authAccount,'c1');
});
test('explicit account overrides default region and preserves China isolation',async()=>{
  const h=harness();assert((await h.call({action:'search',account:'c1'})).ok);assert.equal(h.requests[0].authAccount,'c1');
});
test('mismatched cloud/account fails without Graph request',async()=>{
  const h=harness();const r=await h.call({...send,cloud:'china',account:'g1'});assert(!r.ok);assert.match(r.message,/not_executed/);assert.equal(h.requests.length,0);
});
test('expired default does not silently send from another account',async()=>{
  const accounts=structuredClone(fixture);accounts[0].accounts[0].status='expired';const h=harness({accounts});
  const r=await h.call(send);assert.equal(r.errorCode,'ACCOUNT_EXPIRED');assert.equal(h.requests.length,0);
});
test('missing application and missing default are actionable',async()=>{
  for(const mode of ['app','default']){
    const accounts=structuredClone(fixture);if(mode==='app')accounts[0].clientConfigured=false;else accounts[0].accounts[0].isDefault=false;
    const h=harness({accounts});const r=await h.call(send);assert(!r.ok);assert.match(r.message,/插件详情页/);assert.equal(h.requests.length,0);
  }
});
test('search escapes OData strings and omits invalid ordering',async()=>{
  const h=harness();await h.call({action:'search',from:"o'brien@example.test",subject:"a'b",unread:true});
  const q=new URL(h.requests[0].url).searchParams;
  assert.equal(q.get('$filter'),"from/emailAddress/address eq 'o''brien@example.test' and contains(subject,'a''b') and isRead eq false");assert.equal(q.get('$orderby'),null);
});
test('date filter leads ordering filter and is timezone aware',async()=>{
  const h=harness();await h.call({action:'search',unread:false,since:'2026-09-08T08:00:00+08:00',before:'2026-09-09'});
  const q=new URL(h.requests[0].url).searchParams;
  assert(q.get('$filter').startsWith('receivedDateTime ge 2026-09-08T00:00:00.000Z'));
  assert.equal(q.get('$orderby'),'receivedDateTime desc');
});
test('KQL is encoded once, without filter or orderby',async()=>{
  const h=harness();await h.call({action:'search',query:'from:reader@example.test AND subject:"hello world"'});
  const q=new URL(h.requests[0].url).searchParams;assert.equal(q.get('$search'),JSON.stringify('from:reader@example.test AND subject:"hello world"'));
  assert.equal(q.get('$filter'),null);assert.equal(q.get('$orderby'),null);
});
test('invalid inputs are rejected before any Graph side effects',async()=>{
  const bad=[{action:'unknown'},{action:'search',query:'a',unread:true},{action:'search',max_results:51},{action:'search',max_results:1.2},{action:'search',unread:'false'},
    {action:'search',since:'2026-02-30'},{action:'search',since:'2026-02-30T12:00:00Z'},{action:'search',since:'yesterday'},{action:'search',since:'2026-09-10',before:'2026-09-09'},
    {...send,from:'another@example.test'},{...send,attachments:['not-supported']},
    {...send,to:'good@example.test\r\nBcc: evil@example.test'},{...send,to:[]},{...send,to:'Name <reader@example.test>'},{...send,body_text:123},
    {action:'move',message_id:'..',target_folder:'inbox'},{action:'read'},{action:'search',cloud:'__proto__'}];
  for(const args of bad){const h=harness();const r=await h.call(args);assert(!r.ok,JSON.stringify(args));assert.match(r.message,/not_executed/);assert.equal(h.requests.length,0);}
});
test('Unicode byte budget enforced before sending',async()=>{
  const h=harness();const r=await h.call({...send,body_text:'邮'.repeat(100000)});assert(!r.ok);assert.equal(h.requests.length,0);
});
test('read encodes message id, prefers text and never marks read',async()=>{
  const h=harness({reply:response({id:'a/b+=',body:{contentType:'text',content:'原文'},isRead:false})});
  const r=await h.call({action:'read',message_id:'a/b+='});assert(r.ok);assert.equal(r.result.body,'原文');assert.equal(r.result.is_read,false);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].method,'GET');assert.match(h.requests[0].url,/a%2Fb%2B%3D/);assert.match(h.requests[0].headers.Prefer,/text/);
});
test('long read reports explicit truncation',async()=>{
  const h=harness({reply:response({id:'m',body:{contentType:'text',content:'a'.repeat(50001)}})});
  const r=await h.call({action:'read',message_id:'m'});assert.equal(r.result.body.length,50000);assert.equal(r.result.body_truncated,true);
});
test('send returns accepted, not delivered, and preserves BCC/CC and Unicode',async()=>{
  const h=harness({reply:response(null,202)});const r=await h.call({...send,subject:'中文',body_text:'原文\n第二行',cc:['cc@example.test'],bcc:'secret@example.test'});
  assert(r.ok);assert.equal(r.result.accepted,true);assert.equal(r.result.delivery_confirmed,false);assert.equal(h.requests.length,1);
  const body=JSON.parse(h.requests[0].body);assert.equal(body.message.body.content,'原文\n第二行');assert.equal(body.message.bccRecipients[0].emailAddress.address,'secret@example.test');assert.equal(body.saveToSentItems,true);
});
test('draft permits empty recipients/subject/body and never calls sendMail',async()=>{
  const h=harness({reply:response({id:'draft1',isDraft:true},201)});const r=await h.call({action:'draft',subject:'',body_text:''});assert(r.ok);
  assert.equal(h.requests[0].url,ctx.base+'/me/messages');assert.equal(JSON.parse(h.requests[0].body).body.content,'');assert.equal(r.result.message.is_draft,true);
});
test('read/unread patches only isRead',async()=>{
  for(const action of ['mark_read','mark_unread']){const h=harness({reply:response({id:'m',isRead:action==='mark_read'})});await h.call({action,message_id:'m'});
    assert.equal(h.requests[0].method,'PATCH');assert.deepEqual(JSON.parse(h.requests[0].body),{isRead:action==='mark_read'});}
});
test('move returns the new message id',async()=>{
  const h=harness({reply:response({id:'new',parentFolderId:'target'},201)});const r=await h.call({action:'move',message_id:'old',target_folder:'target'});
  assert.equal(r.result.message.id,'new');assert.equal(r.result.previous_id,'old');assert.equal(JSON.parse(h.requests[0].body).destinationId,'target');
});
test('folder list supports nested folders and counters',async()=>{
  const h=harness({reply:response({value:[{id:'f',displayName:'子目录',childFolderCount:2,unreadItemCount:3,totalItemCount:4}]})});
  const r=await h.call({action:'list_folders',folder:'parent/id'});assert.match(h.requests[0].url,/parent%2Fid\/childFolders/);assert.equal(r.result.folders[0].child_folder_count,2);
});
test('pagination preserves complete query and binds to cloud/account/action',async()=>{
  const url=ctx.base+'/me/messages?$skip=17&$top=10&$select=id';const h=harness({reply:response({value:[], '@odata.nextLink':url})});
  const first=await h.call({action:'search'});const token=first.result.next_page_token;
  await h.call({action:'search',page_token:token});assert.equal(h.requests[1].url,url);
  for(const a of [{action:'search',account:'g2'},{action:'search',cloud:'china'},{action:'list_folders'}]){
    const count=h.requests.length;const r=await h.call({...a,page_token:token});assert(!r.ok);assert.equal(h.requests.length,count);
  }
});
test('hostile pagination links never dispatch',async()=>{
  for(const url of ['https://attacker.example.test/v1.0/me/messages','https://graph.microsoft.com/v1.0/users/other/messages','https://graph.microsoft.com/v1.0/me/sendMail','https://name:pass@graph.microsoft.com/v1.0/me/messages','https://graph.microsoft.com/v1.0/me/messages#fragment']){
    const h=harness();const token=btoa(JSON.stringify({url,cloud:'global',account:'g1',action:'search'}));const r=await h.call({action:'search',page_token:token});assert(!r.ok,url);assert.equal(h.requests.length,0);
  }
});
test('write transport failures and 5xx never retry and declare unknown',async()=>{
  for(const action of ['send','draft','mark_read','mark_unread','move'])for(const reply of [new Error('private upstream stack'),{ok:false,message:'token=secret'},response({error:{message:'private'}},503)]){
    const h=harness({reply});const r=await h.call(mutation(action));assert(!r.ok);assert.match(r.message,/execution_status=unknown/);assert.equal(h.requests.length,1);assert.doesNotMatch(r.message,/private|secret/);
  }
});
test('Graph rejections distinguish not executed and have recovery guidance',async()=>{
  for(const status of [400,401,403,404,429]){
    const h=harness({reply:response({error:{code:'ErrorAccessDenied',message:'private'}},status)});const r=await h.call(send);assert(!r.ok);assert.match(r.message,/not_executed/);assert.equal(h.requests.length,1);assert.doesNotMatch(r.message,/private/);
  }
});
test('successful malformed write response is executed, never claimed unsent',async()=>{
  const h=harness({reply:{ok:true,status:201,body:'bad json'}});const r=await h.call({action:'draft',subject:'t',body_text:'b'});assert(!r.ok);assert.match(r.message,/execution_status=executed/);assert.equal(h.requests.length,1);
});
test('truncated reads are errors, not silently incomplete successful data',async()=>{
  const h=harness({reply:response({value:[]},200,{truncated:true})});const r=await h.call({action:'search'});assert.equal(r.errorCode,'INVALID_RESPONSE');
});

test('plugin uses only Host OAuth and bundles no executable runtime',()=>{
  assert.equal(manifest.node,undefined);
  assert.equal(fs.existsSync(new URL('../../outlook-mail/node',import.meta.url)),false);
  assert.doesNotMatch(source,/cindy\.node|OutlookSdk|BroadcastChannel|Connect-MgGraph/);
});
test('legacy SDK preferences cannot restore an account or route requests',async()=>{
  const h=harness({config:{global_connection:'sdk',sdk_account:{id:'sdk:old',login:'old@example.test'},sdk_mode:'full'}});
  const list=await h.accounts();assert(list.ok);assert.doesNotMatch(JSON.stringify(list),/sdk:old|old@example/);
  assert((await h.call({action:'search'})).ok);assert.equal(h.requests[0].authAccount,'g1');
  const r=await h.call({...send,account:'sdk:old'});
  assert.equal(r.errorCode,'ACCOUNT_NOT_FOUND');assert.match(r.message,/not_executed/);assert.equal(h.requests.length,1);
});
test('disconnected Host account is never restored from old KV state',async()=>{
  const accounts=structuredClone(fixture);accounts[0].accounts=[];
  const h=harness({accounts,config:{sdk_account:{id:'sdk:old'},global_connection:'sdk'}});
  const r=await h.call(send);assert.equal(r.errorCode,'ACCOUNT_NOT_CONNECTED');assert.match(r.message,/not_executed/);
  assert.equal(h.requests.length,0);assert(h.locals.every(p=>p==='/oauth'||p==='/kv'));
});
test('local account state failure is known not executed and does not expose raw errors',async()=>{
  const h=harness({localFailure:true});const r=await h.call(send);
  assert.equal(r.errorCode,'LOCAL_STATE_FAILED');assert.match(r.message,/not_executed/);assert.doesNotMatch(r.message,/private/);assert.equal(h.requests.length,0);
});
test('every accepted but malformed mutation preserves executed and prohibits blind retry',async()=>{
  for(const action of ['draft','mark_read','mark_unread','move']) {
    for(const reply of [{ok:true,status:201,body:'bad json'},response({id:'m'},200,{truncated:true}),response({},200)]) {
      const h=harness({reply});const r=await h.call(mutation(action));
      assert.equal(r.ok,false);assert.match(r.message,/execution_status=executed/);
      assert.match(r.message,/先检查邮箱/);assert.doesNotMatch(r.message,/稍后重试|后重试/);assert.equal(h.requests.length,1);
    }
  }
});
test('four settings locales contain the same translated UI keys',()=>{
  const en=JSON.parse(fs.readFileSync(new URL('../../outlook-mail/ui/en.json',import.meta.url)));
  for(const lang of ['zh-CN','en','ja','ko']) {
    const ui=JSON.parse(fs.readFileSync(new URL('../../outlook-mail/ui/'+lang+'.json',import.meta.url)));
    assert.deepEqual(Object.keys(ui).sort(),Object.keys(en).sort());
    assert(Object.values(ui).every(v=>typeof v==='string'&&v.length>0));
    if(lang!=='en')assert.notEqual(ui.title,en.title);
  }
});

test('invalid Host response status never reports a write as definitely unexecuted',async()=>{
  for(const status of [undefined,0,'200',999]){
    const h=harness({reply:{ok:true,status,body:'{}'}});const r=await h.call(send);
    assert.equal(r.ok,false);assert.match(r.message,/execution_status=unknown/);assert.equal(h.requests.length,1);
  }
});

function multiAccounts() {
  const accounts=structuredClone(fixture);
  accounts[1].accounts.push({id:'c2',label:'China second',status:'connected',isDefault:false});
  return accounts;
}
test('four simultaneous accounts route identical message IDs to their own cloud and identity',async()=>{
  const h=harness({accounts:multiAccounts(),reply:response({id:'same-message',body:{contentType:'text',content:'fixture'}})});
  const listing=await h.accounts();
  assert.deepEqual(Array.from(listing.result.regions,r=>r.accounts.length),[2,2]);
  for(const account of ['g1','c1','g2','c2']){
    const r=await h.call({action:'read',message_id:'same-message',account});assert(r.ok);
    const cloud=account.startsWith('g')?'global':'china';assert.equal(r.result.cloud,cloud);
    const req=h.requests.at(-1);assert.equal(req.authAccount,account);
    assert.equal(new URL(req.url).hostname,cloud==='global'?'graph.microsoft.com':'microsoftgraph.chinacloudapi.cn');
  }
});
test('each cloud default changes independently and explicit identity still overrides both',async()=>{
  const accounts=multiAccounts(),h=harness({accounts});
  accounts[1].accounts.forEach(a=>a.isDefault=a.id==='c2');
  await h.call({action:'search',cloud:'global'});assert.equal(h.requests.at(-1).authAccount,'g1');
  await h.call({action:'search',cloud:'china'});assert.equal(h.requests.at(-1).authAccount,'c2');
  accounts[0].accounts.forEach(a=>a.isDefault=a.id==='g2');
  await h.call({action:'search',cloud:'global'});assert.equal(h.requests.at(-1).authAccount,'g2');
  await h.call({action:'search',cloud:'china'});assert.equal(h.requests.at(-1).authAccount,'c2');
  await h.call({action:'search',account:'g1'});assert.equal(h.requests.at(-1).authAccount,'g1');
});
test('disconnecting one account leaves the other three usable and never silently substitutes an account',async()=>{
  const accounts=multiAccounts(),h=harness({accounts});
  accounts[1].accounts=accounts[1].accounts.filter(a=>a.id!=='c1');
  const removed=await h.call({...send,account:'c1'});assert(!removed.ok);assert.equal(h.requests.length,0);
  for(const account of ['g1','g2','c2']){assert((await h.call({action:'search',account})).ok);assert.equal(h.requests.at(-1).authAccount,account);}
  assert.deepEqual(Array.from((await h.accounts()).result.regions,r=>r.accounts.length),[2,1]);
});
test('an unconfigured or expired China connection does not block either global account',async()=>{
  for(const state of ['unconfigured','expired']){
    const accounts=multiAccounts();
    if(state==='unconfigured')accounts[1].clientConfigured=false;
    else accounts[1].accounts.forEach(a=>a.status='expired');
    const h=harness({accounts});
    assert(!(await h.call({...send,account:'c1'})).ok);assert.equal(h.requests.length,0);
    for(const account of ['g1','g2'])assert((await h.call({action:'search',account})).ok);
    assert.deepEqual(h.requests.map(r=>r.authAccount),['g1','g2']);
  }
});
