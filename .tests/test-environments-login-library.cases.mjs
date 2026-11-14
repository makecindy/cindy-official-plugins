import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Environments,atomic}=require('../test-environments/node/core.cjs');
const {rememberAccounts}=require('../test-environments/node/account-catalog.cjs');
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'login-library-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const app=new Environments(path.join(dir,'store'));
 for(const name of ['one','two']){const root=path.join(dir,name);fs.mkdirSync(path.join(root,'scripts'),{recursive:true});for(const file of ['restart-desktop-remote.mjs','desktop-restart-runner.mjs'])fs.writeFileSync(path.join(root,'scripts',file),'');app.invoke('save_project',{project:{id:name,label:name,root,adapter:'cindy'}});}
 const prepared=app.invoke('ensure_test_project',{project:'one'});
 const profile=app.read().profiles[prepared.profile.id],plan=app.plan(profile.id);
 const application={userDataDir:path.join(dir,'app-owned')};
 const remember=accounts=>rememberAccounts(app.home,plan,application,{accounts,authenticated:true});
 return {app,profile,plan,application,remember};
}
const identity={accountKey:'opaque-global-looking-key',displayName:'Example',region:'cn',isCurrent:true,email:'account@example.test',kind:'personal'};
test('reuse across source roots retains account region, profile and app-owned storage without copying secrets',t=>{
 const {app,remember,profile,application}=setup(t);
 // The first profile must match the actual realm, not an opaque account key.
 app.invoke('save_profile',{profile:{...profile,region:'cn'}});
 const plan=app.plan(profile.id);
 rememberAccounts(app.home,plan,application,{accounts:[{...identity,accessToken:'fixture-secret',refreshToken:'fixture-secret',cookie:'fixture-secret'}],authenticated:true});
 const [saved]=app.invoke('login_accounts').accounts;
 assert.equal(saved.region,'cn');assert.equal(saved.available,true);
 const bound=app.invoke('bind_login_account',{account:saved.id,project:'two'});
 const p=app.read().profiles[bound.profile.id];
 assert.equal(p.isolated,profile.isolated);assert.equal(p.region,'cn');assert.equal(bound.userDataDir,application.userDataDir);
 assert.equal(app.plan(p.id).account.selector,identity.accountKey);
 assert.ok(app.plan(p.id).argv.includes('--region=cn'));
 assert.equal(app.invoke('bind_login_account',{account:saved.id,project:'two'}).profile.id,p.id);
 assert.equal(fs.existsSync(application.userDataDir),false);
 assert.ok(!fs.readFileSync(app.file,'utf8').includes('fixture-secret'));
 assert.equal(new Environments(app.home).invoke('login_accounts').accounts[0].id,saved.id);
});
test('older client reuses observed profile version without inferring realm from key or email',t=>{
 const {app,remember}=setup(t);remember([{accountKey:'global:example',email:'mail@example.test',displayName:'Example'}]);
 const [saved]=app.loginAccounts().accounts;assert.equal(saved.region,null);assert.equal(saved.regionSource,'saved-profile');assert.equal(saved.launchRegion,'global');
 const bound=app.bindLoginAccount(saved.id,'two');assert.equal(app.read().profiles[bound.profile.id].region,'global');
 remember([{accountKey:'global:example',region:'global',displayName:'Example'}]);
 assert.equal(app.loginAccounts().accounts.length,1);assert.equal(app.loginAccounts().accounts[0].id,saved.id);assert.equal(app.loginAccounts().accounts[0].available,true);
 remember([{accountKey:'global:example',displayName:'Older build again'}]);
 assert.equal(app.loginAccounts().accounts.length,1);assert.equal(app.loginAccounts().accounts[0].id,saved.id);assert.equal(app.loginAccounts().accounts[0].region,'global');
});
test('removed application login remains historical and cannot be rebound as usable',t=>{
 const {app,remember}=setup(t);remember([{...identity,region:'global'}]);const [saved]=app.loginAccounts().accounts;
 remember([]);const [after]=app.loginAccounts().accounts;assert.equal(after.id,saved.id);assert.equal(after.available,false);assert.equal(after.reason,'ACCOUNT_SIGN_IN_REQUIRED');
 assert.throws(()=>app.bindLoginAccount(saved.id,'two'),{code:'ACCOUNT_SIGN_IN_REQUIRED'});
});
test('same identity in different realms is not combined and mismatched profile is not eligible',t=>{
 const {app,remember}=setup(t);remember([identity,{...identity,region:'global'}]);const accounts=app.loginAccounts().accounts;
 assert.equal(accounts.length,2);assert.equal(accounts.find(a=>a.region==='cn').available,false);assert.equal(accounts.find(a=>a.region==='global').available,true);
});
test('library-bound profile cannot be rebound through advanced editing',t=>{
 const {app,remember}=setup(t);remember([{...identity,region:'global'}]);const saved=app.loginAccounts().accounts[0];
 const result=app.bindLoginAccount(saved.id,'two'),profile=app.read().profiles[result.profile.id];
 for(const change of [{isolated:'different'},{region:'cn'},{account:undefined},{mode:'legacy'}])assert.throws(()=>app.saveProfile({...profile,...change}),{code:'ACCOUNT_IDENTITY_CHANGED'});
 const {libraryAccount,...legacyEditor}=profile;app.saveProfile({...legacyEditor,label:'Updated'});assert.equal(app.read().profiles[profile.id].libraryAccount,saved.id);
 const alias=app.read().accounts[profile.account];assert.throws(()=>app.saveAccount({...alias,libraryAccount:'forged'}),{code:'ACCOUNT_IDENTITY_CHANGED'});
 assert.notEqual(app.invoke('ensure_test_project',{project:'two'}).profile.id,profile.id);
});
test('cross-project use refuses live or uncertain owner, preserving the existing instance',t=>{
 const {app,remember,plan}=setup(t);remember([{...identity,region:'global'}]);const saved=app.loginAccounts().accounts[0];
 const bound=app.bindLoginAccount(saved.id,'two');
 const dir=path.join(app.home,'jobs','existing');fs.mkdirSync(dir,{recursive:true});atomic(path.join(dir,'plan.json'),plan);
 for(const state of ['ready','unknown']){atomic(path.join(dir,'status.json'),{jobId:'existing',profile:plan.profile,projectRoot:plan.projectRoot,action:'start',state,startedAt:1});assert.throws(()=>app.start(bound.profile.id),{code:'ACCOUNT_PROFILE_BUSY'});}
 assert.equal(fs.existsSync(path.join(dir,'cancel.json')),false);
});
test('first sign-in version choice has stable separate profiles',t=>{
 const {app,profile}=setup(t);const cn=app.ensureTestProject({project:'one',region:'cn'});
 assert.notEqual(cn.profile.id,profile.id);assert.equal(app.read().profiles[cn.profile.id].region,'cn');
 assert.equal(app.ensureTestProject({project:'one',region:'cn'}).profile.id,cn.profile.id);
 assert.equal(app.ensureTestProject({project:'one',region:'global'}).profile.id,profile.id);
 assert.throws(()=>app.ensureTestProject({project:'one',region:'made-up'}),{code:'INVALID_REGION'});
});

test('upgrade migrates only previously observed public references and retains stable ids',t=>{
 const {app,profile,application}=setup(t);
 app.saveAccount({id:'saved',project:'one',label:'Saved',selector:'opaque-key'});
 app.saveAccount({id:'manual',project:'one',label:'Manual',selector:'not-observed'});
 const db=app.read();db.accounts.saved.sessions={[profile.id]:{isolated:profile.isolated,userDataDir:application.userDataDir,listed:true}};atomic(app.file,db);
 const first=app.loginAccounts().accounts;assert.equal(first.length,1);assert.equal(first[0].selector,'opaque-key');assert.equal(first[0].available,true);
 assert.equal(new Environments(app.home).loginAccounts().accounts[0].id,first[0].id);
 assert.equal(app.bindLoginAccount(first[0].id,'two').userDataDir,application.userDataDir);
 assert.equal(fs.existsSync(application.userDataDir),false);
});
