import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadPlugin,response} from './harness.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('../../lumi-vercel/ghost.json',import.meta.url)));
const proj={id:'prj_actual',name:'shop',accountId:'team_actual',env:[{key:'SECRET',value:'never-show-this'}],link:{type:'github',repoId:12345},targets:{production:{id:'dpl_active',readyState:'READY'}}};
const dep={id:'dpl_source',projectId:proj.id,name:proj.name,target:'production',readyState:'READY',url:'shop-source.vercel.app',env:{SECRET:'never-show-this'}};
const callId='host-issued-call-id';
const execute=(p,n,a={})=>p.execute(n,a,{callId});
function route(r){const u=new URL(r.url);if(u.pathname==='/v9/projects/shop'||u.pathname==='/v9/projects/prj_actual')return response(proj);if(u.pathname==='/v13/deployments/dpl_source')return response(dep);if(r.method==='POST'&&u.pathname==='/v13/deployments')return response({...dep,id:'dpl_new',readyState:'QUEUED'});return response({});}

test('manifest definitions match executable tools and credential boundary',()=>{
 const p=loadPlugin();assert.deepEqual(JSON.parse(JSON.stringify(p.tools.map(({run,...d})=>d))),manifest.tools);
 assert.equal(p.tools.length,14);assert.equal(manifest.network.hosts[0],'api.vercel.com');assert.deepEqual(manifest.network.secrets[0].inject.hosts,['api.vercel.com']);assert.ok(manifest.confirm);assert.equal(manifest.launch,'on-demand');assert.equal(manifest.node,undefined);
});
test('reads use default scope, and explicit personal account overrides saved team',async()=>{
 const p=loadPlugin({cfg:{defaultTeamId:'team_actual'},remote:r=>response({projects:[proj],pagination:{next:'cursor-2'}})});
 const a=await execute(p,'list_projects');assert.equal(a.scope.teamId,'team_actual');assert.equal(new URL(p.requests[0].url).searchParams.get('teamId'),'team_actual');assert.equal(p.requests[0].callId,callId);assert.equal(a.pagination.next,'cursor-2');assert.ok(!JSON.stringify(a).includes('never-show-this'));
 await execute(p,'list_projects',{teamId:''});assert.equal(new URL(p.requests[1].url).searchParams.has('teamId'),false);
});
test('invalid arguments fail before network and include the corrective schema',async()=>{
 const p=loadPlugin();for(const args of [{limit:0},{limit:101},{limit:1.2},{unexpected:true},{teamId:123}])await assert.rejects(execute(p,'list_projects',args),e=>e.code==='INVALID_ARGS'&&!!e.details.parameters);
 assert.equal(p.requests.length,0);await assert.rejects(execute(p,'create_project',{name:'../bad'}),e=>e.code==='INVALID_ARGS');
});
test('project reads expose active production and never env values',async()=>{
 const p=loadPlugin({cfg:{defaultProject:'shop'},remote:route}),r=await execute(p,'get_project');assert.equal(r.project.production.id,'dpl_active');assert.equal(r.scope.projectId,proj.id);assert.ok(!JSON.stringify(r).includes('never-show-this'));
});
test('redeploy resolves project and source, confirms production and reports submission only',async()=>{
 const p=loadPlugin({cfg:{defaultTeamId:'team_actual'},remote:route});const r=await execute(p,'redeploy',{project:'shop',deployment:'dpl_source'});assert.equal(r.submitted,true);assert.equal(r.completed,false);assert.equal(r.deployment.id,'dpl_new');assert.equal(r.scope.teamId,'team_actual');assert.equal(p.confirmations.length,1);assert.equal(p.confirmations[0].danger,true);
 const req=p.requests.find(x=>x.method==='POST'),body=JSON.parse(req.body);assert.equal(body.project,proj.id);assert.equal(body.deploymentId,dep.id);assert.equal(body.target,'production');assert.equal(new URL(req.url).searchParams.get('forceNew'),'1');assert.equal(req.headers.Authorization,undefined);
});
test('mismatched deployment project and unsupported target cannot mutate',async()=>{
 const p=loadPlugin({remote:r=>new URL(r.url).pathname.includes('/v13/')?response({...dep,projectId:'prj_someone_else'}):route(r)});await assert.rejects(execute(p,'redeploy',{project:'shop',deployment:'dpl_source'}),e=>e.code==='PROJECT_MISMATCH');assert.equal(p.confirmations.length,0);assert.equal(p.requests.filter(r=>r.method!=='GET').length,0);
 const other=loadPlugin({remote:route});await assert.rejects(execute(other,'redeploy',{project:'shop',deployment:'dpl_source',target:'preview'}),e=>e.code==='INVALID_ARGS');assert.equal(other.requests.filter(r=>r.method!=='GET').length,0);
});
test('cancellation and unavailable native confirmation both fail closed',async()=>{
 for(const confirm of [{ok:true,confirmed:false},{ok:false}]){const p=loadPlugin({remote:route,confirm});await assert.rejects(execute(p,'redeploy',{project:'shop',deployment:'dpl_source'}),e=>['CANCELLED','CONFIRM_UNAVAILABLE'].includes(e.code));assert.equal(p.requests.filter(r=>r.method!=='GET').length,0);}
});
test('Git preview deploy uses existing link and no production target',async()=>{
 const p=loadPlugin({remote:route});const result=await execute(p,'deploy_git',{project:'shop',branch:'feature/fix',target:'preview'});const req=p.requests.find(r=>r.method==='POST');assert.deepEqual(JSON.parse(req.body).gitSource,{type:'github',repoId:12345,ref:'feature/fix'});assert.equal(JSON.parse(req.body).target,undefined);assert.equal(result.completed,false);
});
test('network timeout and HTTP 5xx write outcomes are unknown and never replayed',async()=>{
 for(const failure of [{ok:false,errorCode:'NETWORK_TIMEOUT',message:'Request timed out'},{ok:true,status:502,body:'{}'}]){const p=loadPlugin({remote:r=>r.method==='POST'?failure:route(r)});await assert.rejects(execute(p,'redeploy',{project:'shop',deployment:'dpl_source'}),e=>e.code==='OUTCOME_UNKNOWN'&&e.details.outcomeKnown===false);assert.equal(p.requests.filter(r=>r.method==='POST').length,1);}
});
test('HTTP authentication and rate errors give actionable guidance without body leaks',async()=>{
 for(const status of [401,403,404,429]){const p=loadPlugin({remote:()=>({ok:true,status,body:JSON.stringify({error:{message:'secret-echo'}})})});await assert.rejects(execute(p,'connection_status'),e=>e.code==='VERCEL_API_ERROR'&&e.details.status===status&&!e.message.includes('secret-echo'));assert.equal(p.requests.length,1);}
});
test('metadata-only env listing drops plain and encrypted values',async()=>{
 const p=loadPlugin({remote:r=>new URL(r.url).pathname.endsWith('/env')?response({envs:[{id:'env_one',key:'PASSWORD',value:'raw-secret',type:'encrypted',target:['production']},{id:'env_two',key:'PUBLIC_URL',value:'public-but-still-hidden',type:'plain'}]}):route(r)});
 const r=await execute(p,'manage_env',{action:'list',project:'shop'});assert.equal(r.envs.length,2);assert.ok(!JSON.stringify(r).includes('raw-secret'));assert.ok(!JSON.stringify(r).includes('public-but-still-hidden'));assert.equal(new URL(p.requests.at(-1).url).searchParams.get('decrypt'),'false');
});
test('secret env bytes travel directly from workdir into one API request and never appear in result',async()=>{
 const secret='value-from-user-file\n';const p=loadPlugin({fsRead:()=>({ok:true,content:secret}),remote:r=>r.method==='POST'?response({created:[{id:'env_one',key:'DATABASE_URL',value:secret,type:'encrypted',target:['production']}],failed:[]}):route(r)});
 const r=await execute(p,'manage_env',{action:'upsert',project:'shop',key:'DATABASE_URL',target:['production'],type:'encrypted',value_file:'secrets/database.txt'});assert.equal(p.fileReads[0].callId,callId);assert.equal(p.fileReads[0].root,'workdir');assert.equal(JSON.parse(p.requests.at(-1).body).value,secret);assert.equal(p.confirmations.length,1);assert.ok(!JSON.stringify(r).includes('value-from-user-file'));assert.equal(r.redeployRequired,true);
});
test('env secrets in arguments, traversal, invalid branch scope and sensitive dev target are rejected',async()=>{
 const base={action:'upsert',project:'shop',key:'TOKEN',target:['production'],type:'encrypted',value_file:'secrets/value.txt'};
 for(const change of [{value:'bad',value_file:undefined},{value_file:'../escape.txt'},{value_file:'.env'},{gitBranch:'main'},{type:'sensitive',target:['development']},{target:[]},{target:['production','production']},{key:'BAD/NAME'}]){const p=loadPlugin();const args={...base,...change};for(const k of Object.keys(args))if(args[k]===undefined)delete args[k];await assert.rejects(execute(p,'manage_env',args),e=>e.code==='INVALID_ARGS');assert.equal(p.requests.length,0);}
});
test('partial env rejection does not become a success receipt',async()=>{
 const p=loadPlugin({remote:r=>r.method==='POST'?response({created:[],failed:[{error:{message:'secret-echo'}}]}):route(r)});await assert.rejects(execute(p,'manage_env',{action:'upsert',project:'shop',key:'PUBLIC_URL',target:['preview'],type:'plain',value:'public'}),e=>e.code==='ENV_UPDATE_REJECTED'&&!e.message.includes('secret-echo'));
});
test('env deletion resolves the actual key and uses the exact immutable ID',async()=>{
 const p=loadPlugin({remote:r=>r.method==='DELETE'?response({}):new URL(r.url).pathname.endsWith('/env')?response({envs:[{id:'env_one',key:'API_KEY',target:['preview'],value:'not-exposed'}]}):route(r)});const r=await execute(p,'manage_env',{action:'delete',project:'shop',envId:'env_one'});assert.ok(p.confirmations[0].body.includes('API_KEY'));assert.ok(p.requests.at(-1).url.includes('/v9/projects/prj_actual/env/env_one'));assert.ok(!JSON.stringify(r).includes('not-exposed'));
});
test('domain add never purchases, domain removal does not cascade redirects',async()=>{
 const p=loadPlugin({remote:r=>new URL(r.url).pathname.includes('/domains')?response({name:'shop.example.test',verified:false}):route(r)});await execute(p,'manage_domains',{action:'add',project:'shop',domain:'shop.example.test'});assert.ok(p.requests.at(-1).url.includes('/v10/projects/prj_actual/domains'));await execute(p,'manage_domains',{action:'remove',project:'shop',domain:'shop.example.test'});assert.equal(JSON.parse(p.requests.at(-1).body).removeRedirects,false);assert.equal(p.requests.at(-1).method,'DELETE');
});
test('build log retrieval is finite, bounded, redacted and has no auth header from plugin',async()=>{
 const p=loadPlugin({remote:()=>response([{id:'event-1',created:100,type:'stderr',text:'ADMIN_API_KEY=super-secret Bearer other-secret postgres://user:password@db/x'},{id:'event-2',created:99,text:'a'.repeat(5000)}])});const r=await execute(p,'get_build_logs',{deployment:'dpl_source',limit:100});const url=new URL(p.requests[0].url);assert.equal(url.searchParams.get('follow'),'0');assert.equal(url.searchParams.get('builds'),'1');assert.ok(!JSON.stringify(r).includes('super-secret'));assert.ok(!JSON.stringify(r).includes('other-secret'));assert.ok(!JSON.stringify(r).includes('password@db'));assert.equal(r.logs[1].text.length,3000);assert.equal(r.truncated,true);
});
test('completed deployments cannot be canceled',async()=>{
 const p=loadPlugin({remote:route});await assert.rejects(execute(p,'cancel_deployment',{project:'shop',deployment:'dpl_source'}),e=>e.code==='NOT_CANCELABLE');assert.equal(p.confirmations.length,0);
});
test('Host tool-result failure keeps the corrective schema and never crashes dispatch',async()=>{
 const p=loadPlugin();await p.receive({type:'tool-call',callId,tool:'redeploy',args:{}});const r=p.messages.at(-1);assert.equal(r.ok,false);assert.equal(r.errorCode,'INVALID_ARGS');assert.ok(r.result.parameters.required.includes('project'));
});
test('settings ping is local and never touches Vercel',async()=>{
 const p=loadPlugin();await p.channels[0].onmessage({data:{type:'ping',id:'ready'}});assert.equal(p.messages.at(-1).type,'pong');assert.equal(p.requests.length,0);
});
test('creation, build setting changes and team listing conform to official endpoints',async()=>{
 const p=loadPlugin({remote:r=>r.method==='POST'?response(proj):r.method==='PATCH'?response({...proj,buildCommand:'npm run build'}):new URL(r.url).pathname==='/v2/teams'?response({teams:[{id:'team_actual',name:'Actual team'}],pagination:{next:null}}):route(r)});
 assert.equal((await execute(p,'list_teams')).teams[0].id,'team_actual');assert.equal((await execute(p,'create_project',{name:'new-project'})).scope.projectId,proj.id);const r=await execute(p,'update_project',{project:'shop',settings:{buildCommand:'npm run build',rootDirectory:null}});assert.equal(r.project.buildCommand,'npm run build');assert.equal(p.confirmations.length,2);
});
test('active deployment cancel follows confirmation and the Vercel cancel endpoint',async()=>{
 const p=loadPlugin({remote:r=>new URL(r.url).pathname==='/v13/deployments/dpl_source'?response({...dep,readyState:'BUILDING'}):r.method==='PATCH'?response({...dep,readyState:'CANCELED'}):route(r)});assert.equal((await execute(p,'cancel_deployment',{project:'shop',deployment:'dpl_source'})).deployment.readyState,'CANCELED');assert.equal(p.requests.at(-1).method,'PATCH');assert.equal(p.confirmations.length,1);
});
test('file access failure after confirmation cannot send an env write',async()=>{
 const p=loadPlugin({remote:route,fsRead:()=>({ok:false,message:'denied'})});await assert.rejects(execute(p,'manage_env',{action:'upsert',project:'shop',key:'TOKEN',target:['production'],type:'encrypted',value_file:'secrets/value.txt'}),e=>e.code==='VALUE_FILE_UNAVAILABLE');assert.equal(p.requests.filter(r=>r.method!=='GET').length,0);
});
test('standalone credential names in logs are redacted as well as prefixed names',()=>{
 const p=loadPlugin(),s=p.redact('TOKEN=a SECRET=b PASSWORD=c API_KEY=d DATABASE_URL=e VERCEL_TOKEN=f');for(const token of ['=a','=b','=c','=d','=e','=f'])assert.ok(!s.includes(token));
});
test('Cindy bridge fallback exposes the same tool contracts',async()=>{
 const p=loadPlugin({bridge:'cindy',remote:()=>response({user:{id:'u_test',username:'example-user'}})});assert.equal((await execute(p,'connection_status')).user.id,'u_test');assert.equal(p.tools.length,14);
});
test('all mutation failure paths report execution state, including unexpected exceptions',async()=>{
 const cancelled=loadPlugin({remote:route,confirm:{ok:true,confirmed:false}});await assert.rejects(execute(cancelled,'redeploy',{project:'shop',deployment:'dpl_source'}),e=>e.details.execution==='not_executed');
 for(const reply of [{ok:false,errorCode:'NETWORK_TIMEOUT',message:'Please retry'},{ok:true,status:503,body:'{}'},{ok:true,status:302,body:'{}'}]){const p=loadPlugin({remote:r=>r.method==='POST'?reply:route(r)});await assert.rejects(execute(p,'redeploy',{project:'shop',deployment:'dpl_source'}),e=>e.details.execution==='unknown'&&e.details.outcomeKnown===false&&e.message.includes('Check'))}
 const receiptFailure=loadPlugin({remote:r=>r.method==='POST'?response(null):route(r)});await assert.rejects(execute(receiptFailure,'redeploy',{project:'shop',deployment:'dpl_source'}),e=>e.details.execution==='executed'&&e.message.includes('Check'));
});
