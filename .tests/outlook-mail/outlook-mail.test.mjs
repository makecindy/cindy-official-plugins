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
// Existing Chinese assertions run with the zh-CN host locale; other locales are opted in per test.
// request:null removes cindy.request; timers lets a test fire the 3 second locale timeout at once.
function harness({accounts=structuredClone(fixture),config={},localFailure=false,reply=response({value:[]}),locale='zh-CN',request,timers}={}) {
  const requests=[],results=[],locals=[],contexts=[];let listener;
  const host={onHostMessage:fn=>listener=fn,send:r=>results.push(r),fetch:async req=>{requests.push(req);if(reply instanceof Error)throw reply;return typeof reply==='function'?reply(req):reply;}};
  if(request!==null)host.request=async req=>{contexts.push(req);if(request)return request(req);return req.kind==='app-context'?{ok:true,context:{region:'cn',locale}}:{ok:false};};
  const context=vm.createContext({URL,URLSearchParams,TextEncoder,TextDecoder,btoa,atob,setTimeout:timers?.setTimeout||setTimeout,clearTimeout:timers?.clearTimeout||clearTimeout,
    fetch:async path=>{locals.push(path);if(localFailure)throw new Error('private local failure');return {ok:true,json:async()=>path==='/oauth'?accounts:config};},
    cindy:host,
  });
  vm.runInContext(source,context);
  const M=context.OutlookMail;
  return {M,requests,results,locals,contexts,call:async args=>{await listener({type:'tool-call',tool:'outlook_mail',args,callId:'test-call'});return results.at(-1);},
    accounts:async(args={})=>{await listener({type:'tool-call',tool:'outlook_accounts',args,callId:'list-call'});return results.at(-1);},
    tool:async(tool,args={})=>{await listener({type:'tool-call',tool,args,callId:'tool-call'});return results.at(-1);},
    hostMessage:msg=>listener(msg)};
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
test('opt-in profile uses the selected account and its cloud without exposing other fields',async()=>{
  for(const [account,base] of [['g2',ctx.base],['c1','https://microsoftgraph.chinacloudapi.cn/v1.0']]) {
    const h=harness({reply:response({mail:'mailbox@example.test',userPrincipalName:'login@example.test',id:'private-id',extra:'private'})});
    const r=await h.accounts({profile_account:account});assert(r.ok);
    assert.equal(r.result.profile.account,account);assert.equal(r.result.profile.mail,'mailbox@example.test');
    assert.equal(r.result.profile.user_principal_name,'login@example.test');assert.equal(r.result.profile.extra,undefined);
    assert.equal(h.requests.length,1);assert.equal(h.requests[0].method,'GET');assert.equal(h.requests[0].authAccount,account);
    assert.equal(h.requests[0].callId,'list-call');assert.equal(h.requests[0].url,base+'/me?$select=mail,userPrincipalName');
    assert.equal(h.requests[0].headers.Authorization,undefined);
  }
});
test('profile null mail is never replaced with the sign-in name',async()=>{
  const h=harness({reply:response({mail:null,userPrincipalName:'login@example.test'})});
  const r=await h.accounts({profile_account:'g1'});assert(r.ok);assert.equal(r.result.profile.mail,null);
});
test('invalid profile arguments and unavailable accounts fail before Graph',async()=>{
  for(const args of [{profile_account:''},{profile_account:1},{profile_account:'missing'},{url:'https://example.test'},{profile_account:'g1',cloud:'china'}]) {
    const h=harness();const r=await h.accounts(args);assert(!r.ok);assert.match(r.message,/not_executed/);assert.equal(h.requests.length,0);
  }
  const accounts=structuredClone(fixture);accounts[0].accounts[0].status='expired';const h=harness({accounts});
  assert.equal((await h.accounts({profile_account:'g1'})).errorCode,'ACCOUNT_EXPIRED');assert.equal(h.requests.length,0);
});
test('profile failures remain read-only and do not leak transport or response details',async()=>{
  for(const reply of [new Error('private transport detail'),response({error:{message:'private Graph detail'}},403),response({mail:42,userPrincipalName:'login@example.test'}),response({})]) {
    const h=harness({reply});const r=await h.accounts({profile_account:'g1'});assert(!r.ok);assert.match(r.message,/not_executed/);
    assert.doesNotMatch(r.message,/private|login@example/);assert.equal(h.requests.length,1);assert.equal(h.requests[0].method,'GET');
  }
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
test('Graph OData folder keys and lowercase nextLinks keep the original query',async()=>{
  for(const [action,path] of [['search',"/me/mailfolders('folder%2Bid%3D')/messages"],['search','/me/mailfolders/folder/messages'],['list_folders',"/me/mailfolders('folder')/childfolders"]]) {
    const url=ctx.base+path+'?$skip=1&$top=1';const h=harness({reply:response({value:[], '@odata.nextLink':url})});
    const first=await h.call({action});assert(first.ok);const token=first.result.next_page_token;
    await h.call({action,page_token:token});assert.equal(h.requests[1].url,url);
    const count=h.requests.length;assert(!(await h.call({action,account:'g2',page_token:token})).ok);assert.equal(h.requests.length,count);
  }
});
test('OData pagination cannot switch user, collection, origin or operation',async()=>{
  for(const suffix of ["/users('other')/mailfolders('folder')/messages","/me/mailfolders('folder')/messages/delta","/me/mailfolders('folder')/sendMail","/me/mailfolders('folder')/messages('message')","/me/mailfolders('folder/child')/messages"]) {
    const h=harness();const token=btoa(JSON.stringify({url:ctx.base+suffix,cloud:'global',account:'g1',action:'search'}));
    assert(!(await h.call({action:'search',page_token:token})).ok);assert.equal(h.requests.length,0);
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


// Runtime copy localization (docs/localization.md): host locale only, English fallback.
const HOST_LOCALES=['zh-CN','en','ja','ko'];
const HAN=/[一-鿿]/;
const placeholders=s=>(s.match(/\{\w+\}/g)||[]).sort();
const expiredAccounts=()=>{const a=structuredClone(fixture);a[0].accounts[0].status='expired';return a;};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=()=>new Promise(r=>setImmediate(r));
const notExecuted=text=>'[execution_status=not_executed] '+text;
test('four runtime locales cover identical message keys and placeholders',()=>{
  const {MESSAGES}=harness().M;
  assert.deepEqual(Object.keys(MESSAGES).sort(),Object.keys(manifest.locales).sort());
  assert.deepEqual(Object.keys(MESSAGES).sort(),[...HOST_LOCALES].sort());
  const keys=Object.keys(MESSAGES.en).sort();
  for(const lang of HOST_LOCALES){
    assert.deepEqual(Object.keys(MESSAGES[lang]).sort(),keys,lang);
    for(const key of keys){
      const value=MESSAGES[lang][key];
      assert(typeof value==='string'&&value.trim().length>0,lang+'.'+key);
      assert.deepEqual(placeholders(value),placeholders(MESSAGES.en[key]),lang+'.'+key);
      if(lang!=='en')assert.notEqual(value,MESSAGES.en[key],lang+'.'+key+' is untranslated');
      if(lang!=='zh-CN')assert.notEqual(value,MESSAGES['zh-CN'][key],lang+'.'+key+' copied from zh-CN');
      if(lang==='en'||lang==='ko')assert.doesNotMatch(value,HAN,lang+'.'+key+' still contains Chinese');
    }
  }
});
test('every message key used by main.js exists, and every table key is used',()=>{
  const {MESSAGES}=harness().M;
  const used=new Set([
    ...[...source.matchAll(/\b(?:invalid|t)\('(\w+)'/g)].map(m=>m[1]),
    ...[...source.matchAll(/MailError\('\w+',\s*(?:write \? )?'(\w+)'(?: : '(\w+)')?/g)].flatMap(m=>m.slice(1).filter(Boolean)),
    ...[...source.matchAll(/return '(\w+)';/g)].map(m=>m[1]),
    ...[...source.matchAll(/'(\w+)' : undefined/g)].map(m=>m[1]),
  ]);
  assert(used.size>=40,String(used.size));
  for(const key of used)assert(Object.hasOwn(MESSAGES.en,key),key);
  for(const key of Object.keys(MESSAGES.en))assert(used.has(key),'unused key '+key);
});
test('runtime copy never reads browser or operating system language',()=>{
  assert.doesNotMatch(source,/navigator\.(language|languages)|Intl\.DateTimeFormat\(\)\.resolvedOptions/);
});
test('no hardcoded Chinese copy remains outside comments and the message tables',()=>{
  const stripped=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  // Only the zh-CN and ja tables may contain Han characters (Japanese shares kanji).
  const outside=stripped.replace(/\n {4}(?:'zh-CN'|ja): \{[\s\S]*?\n {4}\},(?=\n)/g,'');
  assert.notEqual(outside,stripped);
  assert.deepEqual(outside.split('\n').filter(line=>HAN.test(line)),[]);
});
test('zh-CN runtime output is byte-identical to the previous hardcoded strings',async()=>{
  const unconfigured=structuredClone(fixture);unconfigured[0].clientConfigured=false;
  const cases=[
    [{},{action:'nope'},notExecuted('请选择支持的邮件操作。')],
    [{},{action:'search',bogus:1},notExecuted('此操作包含不适用的参数，请按工具说明调整；指定发件账号请使用 account。')],
    [{},{action:'search',cloud:'x'},notExecuted('cloud 仅支持 global 或 china。')],
    [{},{action:'search',max_results:0},notExecuted('max_results 必须是 1–50 的整数。')],
    [{},{action:'search',page_token:btoa(JSON.stringify({url:ctx.base+'/me/messages',cloud:'global',account:'g2',action:'search'}))},notExecuted('分页凭据与账号或操作不匹配，请重新查询。')],
    [{},{action:'search',page_token:'!!'},notExecuted('分页凭据无效，请重新查询。')],
    [{},{action:'search',query:'q',from:'a'},notExecuted('query 与结构化筛选请分开使用，可将条件写入 Microsoft KQL query。')],
    [{},{action:'search',since:'2020-02-30'},notExecuted('since 日期无效。')],
    [{},{action:'search',since:'yesterday'},notExecuted('since 请使用 ISO 日期或含时区的时间。')],
    [{},{action:'search',since:'2021-01-02',before:'2021-01-01'},notExecuted('since 必须早于 before。')],
    [{},{action:'read',message_id:''},notExecuted('message_id 必须是有效文本，请检查参数。')],
    [{},{action:'read',message_id:'..'},notExecuted('message_id 无效，请使用插件返回的原始 ID。')],
    [{},{...send,to:'Name <a@b.cd>'},notExecuted('to 请填写完整邮箱地址，不带姓名或换行。')],
    [{},{...send,to:Array(101).fill('a@b.cd')},notExecuted('to 最多支持 100 个地址。')],
    [{},{...send,to:undefined},notExecuted('发送邮件至少需要一个收件人。')],
    [{localFailure:true},send,notExecuted('无法读取插件配置，请重新打开插件详情页后重试。')],
    [{accounts:unconfigured},send,notExecuted('此区域尚未配置微软应用身份，请在插件详情页配置 Client ID，再连接账号。')],
    [{accounts:expiredAccounts()},send,notExecuted('账号授权已失效，请在插件详情页重新连接同一账号。')],
    [{reply:response({error:{code:'E'}},418)},{action:'search'},notExecuted('微软拒绝了请求（HTTP 418），请检查参数、服务区域及邮箱权限。')],
    [{reply:response({error:{code:'E'}},403)},{action:'search'},notExecuted('微软拒绝此操作，请重新连接以授权邮件读写／发送权限；若仍失败，请让企业管理员检查应用访问策略。')],
    [{reply:new Error('x')},{action:'search'},notExecuted('连接中断；请检查网络后重试。')],
    [{reply:{ok:false}},{action:'search'},notExecuted('主机未能完成请求；请检查账号授权和网络后重试。')],
    [{reply:response({x:1})},{action:'search'},notExecuted('微软返回的列表不完整，请重新查询。')],
    [{reply:new Error('x')},send,'[execution_status=unknown] 操作结果不确定；请先检查邮箱中的实际状态，不要直接重复执行。'],
    [{reply:{ok:true,status:201,body:'bad'}},{action:'draft',subject:'',body_text:''},'[execution_status=executed] 服务已接受操作，但结果未能完整返回；请先检查邮箱中的实际状态，不要直接重复执行。'],
  ];
  for(const [options,args,expected] of cases){
    const r=await harness(options).call(args);assert.equal(r.message,expected,JSON.stringify(args).slice(0,80));
  }
  assert.equal((await harness().tool('outlook_unknown')).message,notExecuted('未知邮件工具，请重新获取插件工具清单。'));
  assert.equal((await harness({reply:response(null,202)}).call(send)).result.note,'微软已接受发送请求；不代表收件人已收到邮件。');
  assert.equal((await harness({reply:response({id:'new'},201)}).call({action:'move',message_id:'old',target_folder:'t'})).result.note,'后续操作请使用返回的新 ID。');
});
test('English is used for unsupported, missing or failed host locales',async()=>{
  const en=harness().M.MESSAGES.en;
  const instant={setTimeout:fn=>{setImmediate(fn);return 1;},clearTimeout:()=>{}};
  const cases={en:{locale:'en'},fr:{locale:'fr'},zh:{locale:'zh'},zhTW:{locale:'zh-TW'},proto:{locale:'__proto__'},nullLocale:{locale:null},empty:{locale:''},number:{locale:42},
    noRequestApi:{request:null},throws:{request:async()=>{throw new Error('private host failure');}},
    notOk:{request:async()=>({ok:false,context:{locale:'zh-CN'}})},nullReply:{request:async()=>null},
    hangs:{request:()=>new Promise(()=>{}),timers:instant}};
  for(const [label,options] of Object.entries(cases)){
    const h=harness({...options,accounts:expiredAccounts()});const r=await h.call(send);
    assert.equal(r.errorCode,'ACCOUNT_EXPIRED',label);assert.equal(r.message,notExecuted(en.accountExpired),label);
    assert.doesNotMatch(r.message,/private/);assert.equal(h.requests.length,0);
  }
});
test('an unanswered locale request gives up after 3 seconds instead of blocking the result',async()=>{
  const delays=[];
  const timers={setTimeout:(fn,ms)=>{delays.push(ms);setImmediate(fn);return 7;},clearTimeout:()=>{}};
  const h=harness({request:()=>new Promise(()=>{}),timers,accounts:expiredAccounts()});
  assert.equal((await h.call(send)).message,notExecuted(h.M.MESSAGES.en.accountExpired));
  assert.deepEqual(delays,[3000]);
});
test('only the host app-context is read, and a successful locale is cached',async()=>{
  const h=harness({accounts:expiredAccounts()});await h.call(send);await h.accounts();await h.call(send);
  assert.deepEqual(h.contexts.map(c=>JSON.stringify(c)),['{"kind":"app-context"}']);
  assert(h.locals.every(p=>p==='/oauth'||p==='/kv'));
});
test('concurrent tool calls share one app-context request and all use the host locale',async()=>{
  const pending=deferred();const h=harness({request:()=>pending.promise,accounts:expiredAccounts()});
  const calls=[1,2,3].map(()=>h.call(send));
  await flush();
  assert.equal(h.contexts.length,1);assert.equal(h.locals.length,0,'no mail work before the locale is known');
  pending.resolve({ok:true,context:{locale:'ko'}});await Promise.all(calls);
  assert.equal(h.results.length,3);
  for(const r of h.results)assert.equal(r.message,notExecuted(h.M.MESSAGES.ko.accountExpired));
});
test('a failed app-context lookup is retried on the next call instead of pinning English',async()=>{
  let attempts=0;
  const h=harness({accounts:expiredAccounts(),request:async()=>{attempts++;if(attempts===1)throw new Error('host busy');return {ok:true,context:{locale:'ja'}};}});
  assert.equal((await h.call(send)).message,notExecuted(h.M.MESSAGES.en.accountExpired));
  assert.equal((await h.call(send)).message,notExecuted(h.M.MESSAGES.ja.accountExpired));
  assert.equal((await h.call(send)).message,notExecuted(h.M.MESSAGES.ja.accountExpired));
  assert.equal(attempts,2);
});
test('host-context-changed switches runtime copy without another app-context request',async()=>{
  const h=harness({accounts:expiredAccounts()});const T=h.M.MESSAGES;
  assert.equal((await h.call(send)).message,notExecuted(T['zh-CN'].accountExpired));
  for(const [context,lang] of [[{region:'global',locale:'ko'},'ko'],[{locale:'ja'},'ja'],[{locale:'en'},'en'],[{locale:'xx'},'en'],[undefined,'en'],[{locale:'zh-CN'},'zh-CN']]){
    await h.hostMessage({type:'host-context-changed',context});
    assert.equal((await h.call(send)).message,notExecuted(T[lang].accountExpired),JSON.stringify(context));
  }
  assert.equal(h.contexts.length,1);assert.equal(h.requests.length,0);assert.equal(h.results.length,7);
});
test('a locale change that arrives during the app-context request wins over the stale reply',async()=>{
  const pending=deferred();const h=harness({request:()=>pending.promise,accounts:expiredAccounts()});
  const calling=h.call(send);await flush();
  await h.hostMessage({type:'host-context-changed',context:{locale:'ja'}});
  pending.resolve({ok:true,context:{locale:'zh-CN'}});
  assert.equal((await calling).message,notExecuted(h.M.MESSAGES.ja.accountExpired));
  assert.equal((await h.call(send)).message,notExecuted(h.M.MESSAGES.ja.accountExpired));
  assert.equal(h.contexts.length,1);
});
test('Japanese and Korean hosts receive their own validation, account and Graph copy',async()=>{
  for(const lang of ['ja','ko']){
    const T=harness().M.MESSAGES[lang];
    let h=harness({locale:lang});let r=await h.call({action:'read',message_id:''});
    assert.equal(r.message,notExecuted(T.invalidText.replace('{name}','message_id')));
    h=harness({locale:lang,accounts:expiredAccounts()});r=await h.call(send);
    assert.equal(r.message,notExecuted(T.accountExpired));
    const unconfigured=structuredClone(fixture);unconfigured[1].clientConfigured=false;
    h=harness({locale:lang,accounts:unconfigured});r=await h.call({...send,cloud:'china'});assert.equal(r.message,notExecuted(T.clientNotConfigured));
    h=harness({locale:lang});r=await h.call({action:'search',cloud:'other'});assert.equal(r.message,notExecuted(T.invalidCloud));
    assert.match(r.message,/global/);assert.match(r.message,/china/);
    h=harness({locale:lang,reply:response({error:{code:'Teapot',message:'private'}},418)});r=await h.call({action:'search'});
    assert.equal(r.errorCode,'GRAPH_REQUEST_FAILED');assert.equal(r.message,notExecuted(T.httpOther.replace('{status}','418')));
    h=harness({locale:lang,reply:response({error:{code:'MailboxNotEnabledForRESTAPI'}},404)});r=await h.call({action:'search'});
    assert.equal(r.message,notExecuted(T.mailboxNotEnabled));
    h=harness({locale:lang,reply:response(null,202)});r=await h.call(send);assert(r.ok);assert.equal(r.result.note,T.sendAccepted);
    assert.equal(r.result.execution_status,'executed');assert.equal(r.result.delivery_confirmed,false);
    h=harness({locale:lang,reply:response({id:'new'},201)});r=await h.call({action:'move',message_id:'old',target_folder:'t'});assert.equal(r.result.note,T.moveNote);
  }
});
test('unknown tool copy is localized and still known not executed',async()=>{
  for(const lang of HOST_LOCALES){
    const h=harness({locale:lang});const r=await h.tool('outlook_unknown');
    assert.equal(r.errorCode,'UNKNOWN_MAIL_TOOL');assert.equal(r.message,notExecuted(h.M.MESSAGES[lang].unknownTool));
    assert.equal(h.requests.length,0);
  }
});
test('Graph failures keep the HTTP status and stable error codes in every locale',async()=>{
  for(const lang of HOST_LOCALES){
    const r=await harness({locale:lang,reply:response({error:{code:'E'}},418)}).call({action:'search'});
    assert.equal(r.errorCode,'GRAPH_REQUEST_FAILED');assert.match(r.message,/^\[execution_status=not_executed\] .*HTTP 418/);
  }
});
const SAFETY={
  'zh-CN':{check:/先检查邮箱/,noRepeat:/勿直接重复|不要直接重复/,retry:/重试/},
  en:{check:/check the mailbox first/i,noRepeat:/do not repeat/i,retry:/retry/i},
  ja:{check:/まずメールボックス/,noRepeat:/繰り返さないでください/,retry:/再試行/},
  ko:{check:/먼저 메일함/,noRepeat:/반복하지 마세요/,retry:/다시 시도/},
};
test('uncertain write outcomes say check the mailbox first and never retry, in every locale',async()=>{
  for(const [lang,rule] of Object.entries(SAFETY)){
    const T=harness().M.MESSAGES[lang];
    for(const key of ['interruptedWrite','hostFailedWrite','unknownSuffix','incompleteWrite','outcomeUnknown','outcomeExecuted']){
      assert.match(T[key],rule.check,lang+'.'+key);assert.match(T[key],rule.noRepeat,lang+'.'+key);assert.doesNotMatch(T[key],rule.retry,lang+'.'+key);
    }
    assert.doesNotMatch(T.unexpectedSend,rule.retry,lang);
    for(const action of ['send','draft','mark_read','mark_unread','move'])for(const reply of [new Error('private'),{ok:false},response({},503)]){
      const h=harness({locale:lang,reply});const r=await h.call(mutation(action));
      assert.equal(r.message,'[execution_status=unknown] '+T.outcomeUnknown);assert.equal(h.requests.length,1);
    }
    for(const reply of [{ok:true,status:201,body:'bad json'},response({},200)]){
      const h=harness({locale:lang,reply});const r=await h.call(mutation('draft'));
      assert.equal(r.message,'[execution_status=executed] '+T.outcomeExecuted);assert.equal(h.requests.length,1);
    }
  }
});
