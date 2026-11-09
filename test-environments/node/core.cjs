'use strict';
// Shared by the plugin Worker and standalone CLI. Credentials stay in each App.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const NAME=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
function fail(code,message){throw Object.assign(new Error(message),{code});}
function text(v,key,max=256){if(typeof v!=='string'||!v.trim()||v.length>max||v.includes('\0'))fail('INVALID_INPUT',key);return v;}
function id(v){if(typeof v!=='string'||!NAME.test(v)||['__proto__','constructor','prototype'].includes(v))fail('INVALID_ID','Use letters, numbers, - or _.');return v;}
function fields(v,allowed){if(!v||typeof v!=='object'||Array.isArray(v))fail('INVALID_INPUT','Expected an object.');for(const k of Object.keys(v))if(!allowed.includes(k))fail('UNKNOWN_FIELD',`Unsupported field: ${k}`);}
function json(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e;}}
function privateDir(dir){fs.mkdirSync(dir,{recursive:true,mode:0o700});if(fs.lstatSync(dir).isSymbolicLink())fail('UNSAFE_STORAGE','Storage cannot be a symbolic link.');}
function atomic(file,value){const tmp=`${file}.${crypto.randomUUID()}.tmp`;try{fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}}
function defaultHome(){if(process.env.TEST_ENVIRONMENTS_HOME)return path.resolve(process.env.TEST_ENVIRONMENTS_HOME);if(process.platform==='darwin')return path.join(os.homedir(),'Library','Application Support','Test Environments');if(process.platform==='win32')return path.join(process.env.LOCALAPPDATA||os.homedir(),'Test Environments');return path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share'),'test-environments');}
function empty(){return {version:1,revision:0,projects:{},accounts:{},profiles:{},cases:{}};}
function command(v){if(!Array.isArray(v)||!v.length||v.length>96)fail('INVALID_COMMAND','Use an executable and an argument array.');return v.map(x=>text(x,'command argument',4096));}
function alive(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
function executable(name){const paths=path.isAbsolute(name)?[name]:(process.env.PATH||'').split(path.delimiter).map(p=>path.join(p,name));for(const p of paths)try{fs.accessSync(p,fs.constants.X_OK);if(fs.statSync(p).isFile())return p;}catch{}fail('TOOL_NOT_FOUND',`Install or configure ${name} in the project toolchain.`);}
function expand(argv,vars){return argv.map(arg=>arg.replace(/\{([a-zA-Z]+)\}/g,(_,key)=>{if(!Object.hasOwn(vars,key)||vars[key]===undefined)fail('MISSING_CONFIGURATION',`Missing ${key} for the command.`);return String(vars[key]);}));}
function safeEnv(){const env={};for(const k of ['PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','SystemRoot','WINDIR','TMPDIR','TEMP','TMP','LANG','LC_ALL','JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','DEVELOPER_DIR'])if(process.env[k])env[k]=process.env[k];return env;}
class Environments{
  constructor(home=defaultHome()){this.home=home;privateDir(home);this.file=path.join(home,'catalog.json');}
  read(){const db=json(this.file,empty());if(db.version!==1||!Number.isSafeInteger(db.revision)||!['projects','accounts','profiles','cases'].every(k=>db[k]&&typeof db[k]==='object'&&!Array.isArray(db[k])))fail('INVALID_CATALOG','Catalog cannot be read; original data was preserved.');return db;}
  change(fn,revision){const lock=path.join(this.home,'.catalog-lock');try{fs.mkdirSync(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')fail('CATALOG_BUSY','Another writer is saving.');throw e;}try{const db=this.read();if(revision!==undefined&&db.revision!==revision)fail('REVISION_CHANGED','Refresh before saving; another editor changed this catalog.');const result=fn(db);db.revision++;atomic(this.file,db);return {saved:result,revision:db.revision};}finally{fs.rmdirSync(lock);}}
  catalog(){return {storage:this.home,...this.read()};}
  saveProject(p,revision){
    fields(p,['id','label','root','adapter','commands']);id(p.id);text(p.label,'project label');
    if(!path.isAbsolute(text(p.root,'project directory',4096)))fail('INVALID_PATH','Project directory must be absolute.');
    const root=fs.realpathSync(p.root);if(!fs.statSync(root).isDirectory())fail('INVALID_PATH','Project directory does not exist.');
    if(!['cindy','command'].includes(p.adapter))fail('INVALID_ADAPTER','Choose cindy or command.');
    const commands={};if(p.commands){fields(p.commands,['prepare','start','verify']);for(const[k,v]of Object.entries(p.commands))commands[k]=command(v);}
    if(p.adapter==='command'&&!commands.start)fail('MISSING_COMMAND','A custom project needs a start command.');
    if(p.adapter==='cindy'&&!fs.existsSync(path.join(root,'scripts/restart-desktop-remote.mjs')))fail('INVALID_PROJECT','Choose a Cindy source checkout.');
    const saved={id:p.id,label:p.label,root,adapter:p.adapter,commands};
    return this.change(db=>{if(Object.values(db.profiles).some(v=>v.project===p.id)&&db.projects[p.id]?.adapter!==p.adapter)fail('PROJECT_IN_USE','Create a separate project to change adapters.');db.projects[p.id]=saved;return saved;},revision);
  }
  saveAccount(a,revision){
    fields(a,['id','project','label','selector','loginSource','notes']);id(a.id);id(a.project);text(a.label,'account label');text(a.selector,'application account key',512);if(a.loginSource)id(a.loginSource);if(a.notes)text(a.notes,'notes',1000);
    return this.change(db=>{if(!db.projects[a.project])fail('PROJECT_NOT_FOUND','Save the project first.');if(db.accounts[a.id]&&['project','selector'].some(k=>db.accounts[a.id][k]!==a[k]))fail('ACCOUNT_IDENTITY_CHANGED','Create a new account reference instead of rebinding an existing name.');db.accounts[a.id]={...a,...(db.accounts[a.id]?.sessions?{sessions:db.accounts[a.id].sessions}:{})};return db.accounts[a.id];},revision);
  }
  saveProfile(p,revision){
    fields(p,['id','label','project','platform','mode','account','isolated','region','remoteControl','background','fixture','loginSource','serveLogin','deviceId','artifactPath','bundleId','debugPort']);id(p.id);id(p.project);text(p.label,'profile label');
    if(!['desktop','ios','android','linux'].includes(p.platform))fail('INVALID_PLATFORM','Select desktop, ios, android or linux.');
    if(!['legacy','acceptance'].includes(p.mode))fail('INVALID_MODE','Select legacy or acceptance.');
    for(const k of ['account','fixture','loginSource','serveLogin'])if(p[k])id(p[k]);
    if(p.isolated&&(!NAME.test(p.isolated)||p.isolated.length>32))fail('INVALID_ISOLATION','Use an isolated name of at most 32 characters.');
    if(p.debugPort!==undefined&&(!Number.isInteger(p.debugPort)||p.debugPort<1024||p.debugPort>65535))fail('INVALID_PORT','Debug port must be 1024–65535.');
    if(p.region&&!['global','cn'].includes(p.region))fail('INVALID_REGION','Select global or cn.');
    for(const k of ['remoteControl','background'])if(p[k]&&!['inherit','off','on'].includes(p[k]))fail('INVALID_SWITCH',k);
    for(const k of ['deviceId','bundleId'])if(p[k])text(p[k],k,256);
    if(p.artifactPath&&!path.isAbsolute(text(p.artifactPath,'artifact path',4096)))fail('INVALID_PATH','Build artifact path must be absolute.');
    return this.change(db=>{const project=db.projects[p.project];if(!project)fail('PROJECT_NOT_FOUND','Save the project first.');if(p.account&&db.accounts[p.account]?.project!==p.project)fail('ACCOUNT_PROJECT_MISMATCH','Choose an account from this project.');
      if(project.adapter==='cindy'){
        if(p.platform==='linux')fail('INVALID_PLATFORM','For Cindy on Linux select desktop.');
        if(p.platform==='desktop'&&!p.isolated)fail('ISOLATION_REQUIRED','Choose a persistent isolated desktop profile.');
        if(p.mode==='legacy'&&[p.account,p.fixture,p.loginSource,p.serveLogin,p.remoteControl&&p.remoteControl!=='inherit',p.background&&p.background!=='inherit'].some(Boolean))fail('LEGACY_OPTIONS','Legacy mode preserves the original behavior; remove acceptance overrides.');
        if(p.platform!=='desktop'&&(p.remoteControl==='on'||p.background==='on'||p.serveLogin))fail('DESKTOP_OPTION','Enable these options on the desktop source profile.');
        if((p.loginSource||db.accounts[p.account]?.loginSource)&&!p.account)fail('ACCOUNT_REQUIRED','Choose an account for the login source.');
      }db.profiles[p.id]={...p};return p;
    },revision);
  }
  saveCase(c,revision){fields(c,['id','label','profile','steps']);id(c.id);id(c.profile);text(c.label,'case label');if(!Array.isArray(c.steps)||!c.steps.length||c.steps.length>50)fail('INVALID_CASE','Save 1–50 acceptance steps.');for(const s of c.steps){fields(s,['action','expected']);text(s.action,'step action',2000);text(s.expected,'expected result',2000);}return this.change(db=>{if(!db.profiles[c.profile])fail('PROFILE_NOT_FOUND','Save the profile first.');db.cases[c.id]=c;return c;},revision);}
  remove(kind,name,revision){if(!['profiles','accounts','cases','projects'].includes(kind))fail('INVALID_KIND','Unknown record kind.');id(name);return this.change(db=>{if(kind==='projects'&&[...Object.values(db.accounts),...Object.values(db.profiles)].some(x=>x.project===name)||kind==='accounts'&&Object.values(db.profiles).some(x=>x.account===name)||kind==='profiles'&&Object.values(db.cases).some(x=>x.profile===name))fail('RECORD_IN_USE','Reassign dependent records first.');delete db[kind][name];return {kind,id:name,credentialsUntouched:true};},revision);}
  async importCindy(projectId,jobId){
    const project=this.read().projects[id(projectId)];if(project?.adapter!=='cindy')fail('INVALID_PROJECT','Select a Cindy project.');
    const candidates=this.jobs().filter(j=>j.projectRoot===project.root&&j.application&&['preparing','checking-account','waiting-for-owner','ready'].includes(j.state));
    const state=jobId?this.status(id(jobId)):candidates.length===1?candidates[0]:null;
    if(!state||state.projectRoot!==project.root)fail('JOB_REQUIRED','Start the intended profile, then choose its exact jobId to remember accounts.');
    const plan=json(path.join(this.home,'jobs',state.jobId,'plan.json'));
    const snapshot=await require('./observation.cjs').performDesktop(plan,state,'sync');
    const saved=require('./account-catalog.cjs').rememberAccounts(this.home,plan,state.application,snapshot);
    if(!saved.saved)fail(saved.reason,'Account references were not saved. Refresh the catalog and inspect this job.');
    return {accountsRemembered:snapshot.accounts.length,credentialsCopied:false,sessionStorage:'target-application',...saved};
  }
  selectAccount(jobId,accountId){
    const state=this.status(id(jobId)),db=this.read(),account=db.accounts[id(accountId)];
    const dir=path.join(this.home,'jobs',jobId),plan=json(path.join(dir,'plan.json'));
    if(plan.readiness!=='cindy'||plan.configuration.mode!=='acceptance'||!state.application||!['preparing','checking-account','waiting-for-owner','ready'].includes(state.state))fail('JOB_NOT_SELECTABLE','Choose a live Cindy acceptance job.');
    if(!account||account.project!==plan.project)fail('ACCOUNT_PROJECT_MISMATCH','Choose an account from this project.');
    const lock=path.join(dir,'.selection-lock');try{fs.mkdirSync(lock);}catch(e){if(e.code==='EEXIST')fail('SELECTION_PENDING','Another selection is being registered. Inspect status first.');throw e;}
    try{
      if(fs.existsSync(path.join(dir,'select-account.json')))fail('SELECTION_PENDING','Inspect status before requesting another account change.');
      atomic(path.join(dir,'select-account.json'),{requestId:crypto.randomUUID(),account:{id:account.id,label:account.label,selector:account.selector}});
    }finally{fs.rmdirSync(lock);}
    return {jobId,state:'checking-account',execution:'requested',nextAction:'Query status. A missing or expired local login requires signing in on this computer.'};
  }
  plan(profileId,action='start'){
    const db=this.read(),p=db.profiles[id(profileId)];if(!p)fail('PROFILE_NOT_FOUND','Choose an existing profile.');if(!['start','prepare','verify'].includes(action))fail('INVALID_ACTION','Use start, prepare or verify.');
    const project=db.projects[p.project],account=p.account?db.accounts[p.account]:undefined;if(!project||p.account&&!account)fail('REFERENCE_MISSING','A profile reference is missing.');
    const vars={profile:p.id,account:account?.selector,isolated:p.isolated,fixture:p.fixture,remoteControl:p.remoteControl||'inherit',background:p.background||'inherit',platform:p.platform,dataDir:path.join(this.home,'workspaces',p.project,p.id)};
    let argv,readiness='process',notes=[],handoff;
    if(project.adapter==='cindy'&&action!=='start'&&project.commands[action]){
      argv=expand(project.commands[action],vars);readiness='command';
      notes.push('Runs the project-configured sample/verification command. A zero exit code does not certify human or device-tool requirements.');
    }else if(project.adapter==='cindy'){
      const mobile=p.platform!=='desktop',options=[`--region=${p.region||'global'}`];if(!mobile)options.push(`--isolated=${p.isolated}`);
      if(p.mode==='acceptance'){
        if(p.loginSource||p.serveLogin||account?.loginSource)fail('REMOTE_AUTH_NOT_IMPLEMENTED','This version uses normal sign-in on each computer. Remove the old loginSource/serveLogin WIP options; no credentials are transferred.');
        if(!mobile){
          if(process.platform==='win32')fail('ACCOUNT_PLATFORM_UNVERIFIED','Account supervision requires macOS or Linux; Windows needs an ownership-check adapter. No app was launched.');
          if(!p.debugPort)fail('DEBUG_PORT_REQUIRED','Save an unused debugPort to supervise real accounts in the target application.');
          if(!p.background||p.background==='off')options.push('--passive');
        }
        notes.push('Real accounts sign in separately on each computer. App-owned encrypted sessions survive stop/restart and package upgrades; expired or revoked sessions require sign-in again.');
        if(mobile)notes.push('Account selection and sample preparation happen in the actual mobile app through Baguette; no unimplemented acceptance flags are passed.');
        if(p.fixture)notes.push('Prepare the named sample through normal application tools after account verification. The plugin does not inject a client fixture.');
      }
      if(action==='verify')fail('USE_STATUS','Use status to read the application readiness receipt.');
      if(!mobile&&action==='prepare')fail('ACTION_NOT_SUPPORTED','Desktop builds as part of start.');
      // The plugin owns readiness and login waiting. The CLI's --wait-ready
      // applies a fixed startup deadline that would terminate a pending login.
      if(!mobile){
        if(!fs.existsSync(path.join(project.root,'scripts/desktop-restart-runner.mjs')))fail('PROJECT_UPDATE_REQUIRED','This checkout does not expose the desktop restart coordinator.');
        argv=['node',path.join(__dirname,'cindy-launch.cjs'),project.root,...options];readiness='cindy';
      }
      else{
        argv=action==='prepare'?['pnpm','mobile:sim:rebuild','--',...options,`--platform=${p.platform}`,'--build-only']:['pnpm','mobile:sim:start','--',...options];readiness=action==='prepare'?'command':'process';
        handoff={plugin:'baguette-simulator',namespace:null,platform:p.platform,deviceId:p.deviceId||null,artifactPath:p.artifactPath||null,bundleId:p.bundleId||null,steps:['Read the simulator workflow and devices; select the exact permitted device.','Install the selected build and confirm matchesLocal.','Launch the app and verify its actual account and sample readiness.'],parametersTransport:'Project Metro configuration. Android app launch does not accept iOS arguments/env.'};
        notes.push('This job prepares the service/build. Installation, app launch and business checks use the simulator plugin.');
      }
    }else{if(!project.commands[action])fail('COMMAND_NOT_CONFIGURED',`Configure the ${action} command.`);argv=expand(project.commands[action],vars);readiness=action==='start'?'process':'command';if(project.commands.verify&&action==='start')notes.push('Run verify when the app is available. Starting a process does not prove sign-in.');}
    return {version:2,profile:p.id,project:p.project,projectRoot:project.root,platform:p.platform,action,argv,readiness,account:account?{id:account.id,label:account.label,selector:account.selector}:null,configuration:{mode:p.mode,isolated:p.isolated,remoteControl:p.remoteControl||(p.mode==='acceptance'?'off':'inherit'),background:p.background||(p.mode==='acceptance'?'off':'inherit'),fixture:p.fixture,region:p.region||'global'},dataDir:vars.dataDir,env:p.debugPort?{XDT_CDP_PORT:String(p.debugPort)}:{},workflow:{steps:['start','select-account','prepare-samples','execute-cases','stop'],cases:Object.values(db.cases).filter(c=>c.profile===p.id),sample:p.fixture||null,acceptance:'Run case actions with real tools and record evidence; app readiness alone is not a passed case.'},notes,...(handoff?{handoff}:{})};
  }
  jobs(){let names=[];try{names=fs.readdirSync(path.join(this.home,'jobs'));}catch(e){if(e.code!=='ENOENT')throw e;}return names.filter(x=>NAME.test(x)).map(x=>this.status(x)).sort((a,b)=>b.startedAt-a.startedAt);}
  status(jobId){id(jobId);const dir=path.join(this.home,'jobs',jobId),s=json(path.join(dir,'status.json'));if(s.jobId!==jobId)fail('INVALID_JOB','Job identity mismatch.');if(s.supervisorPid&&(!alive(s.supervisorPid)||s.supervisorIdentity&&require('./observation.cjs').identity(s.supervisorPid)!==s.supervisorIdentity)&&!['stopped','completed','failed'].includes(s.state))return {...s,state:'unknown',verification:undefined,accountVerifiedAt:undefined,nextAction:'Supervisor ended; inspect the recorded app instance before restarting.',log:path.join(dir,'output.log')};if(!['stopped','completed','failed','unknown'].includes(s.state)&&fs.existsSync(path.join(dir,'select-account.json')))return {...s,state:'checking-account',verification:undefined,accountVerifiedAt:undefined,nextAction:'Account selection is queued. Wait for a fresh identity verification.',log:path.join(dir,'output.log')};return {...s,log:path.join(dir,'output.log')};}
  start(profileId,action='start'){
    const plan=this.plan(profileId,action),lock=path.join(this.home,'.launch-lock');try{fs.mkdirSync(lock);}catch(e){if(e.code==='EEXIST')fail('LAUNCH_BUSY','Another launch is being registered.');throw e;}
    try{
      for(const job of this.jobs())if(job.projectRoot===plan.projectRoot&&(!['stopped','completed','failed'].includes(job.state)||alive(job.supervisorPid))&&action!=='verify'&&!(action==='prepare'&&plan.readiness==='command'&&job.action==='start'))fail('PROJECT_BUSY',`Inspect or stop job ${job.jobId} before launching again.`);
      if(plan.readiness==='cindy'){
        const processes=execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8',maxBuffer:8*1024*1024});
        if(processes.split('\n').some(line=>line.includes(plan.projectRoot)&&/electron|electron-forge|vite|restart-desktop/.test(line)))fail('CHECKOUT_IN_USE','A desktop process already uses this checkout. Stop it through its owner before launching here.');
        if(plan.env.XDT_CDP_PORT&&process.platform!=='win32'){
          let listeners='';try{listeners=execFileSync('lsof',['-nP',`-iTCP:${plan.env.XDT_CDP_PORT}`,'-sTCP:LISTEN','-t'],{encoding:'utf8',timeout:2000,stdio:['ignore','pipe','ignore']});}catch(e){if(e.status!==1)fail('PORT_CHECK_UNAVAILABLE','Cannot verify the configured debug port. No app was launched.');}
          if(listeners.trim())fail('DEBUG_PORT_IN_USE','Choose an unused debug port. The existing listener was not touched.');
        }
      }
      const node=executable('node');if(process.platform==='darwin'&&plan.readiness==='cindy')plan.terminalPython=executable('python3');plan.argv[0]=executable(plan.argv[0]);const jobId=crypto.randomUUID(),dir=path.join(this.home,'jobs',jobId);privateDir(dir);privateDir(plan.dataDir);
      if(plan.readiness==='cindy'){
        const startup=path.join(dir,'startup.json');atomic(startup,{state:'pending',at:Date.now()});
        plan.env.XDT_DESKTOP_DEV_STARTUP_STATUS_FILE=startup;
        fs.copyFileSync(path.join(__dirname,'cindy-launch.cjs'),path.join(dir,'cindy-launch.cjs'));plan.argv[1]=path.join(dir,'cindy-launch.cjs');
      }
      plan.catalogHome=this.home;
      for(const name of ['runner.cjs','observation.cjs','account-catalog.cjs','session-monitor.cjs'])fs.copyFileSync(path.join(__dirname,name),path.join(dir,name));if(plan.terminalPython)fs.copyFileSync(path.join(__dirname,'terminal.py'),path.join(dir,'terminal.py'));atomic(path.join(dir,'plan.json'),plan);atomic(path.join(dir,'status.json'),{jobId,profile:plan.profile,projectRoot:plan.projectRoot,action,startedAt:Date.now(),state:'starting',execution:'not_executed'});
      const log=fs.openSync(path.join(dir,'supervisor.log'),'a',0o600);let child;try{child=spawn(node,[path.join(dir,'runner.cjs'),dir],{detached:true,stdio:['ignore',log,log],env:safeEnv()});child.unref();}finally{fs.closeSync(log);}
      child.on('error',()=>atomic(path.join(dir,'status.json'),{jobId,profile:plan.profile,projectRoot:plan.projectRoot,action,startedAt:Date.now(),state:'failed',code:'RUNNER_START_FAILED',execution:'not_executed'}));
      return {jobId,state:'starting',plan,nextAction:'Query status with this jobId; do not repeat start while preparing or waiting for sign-in.'};
    }finally{fs.rmdirSync(lock);}
  }
  stop(jobId){const s=this.status(jobId);if(['stopped','completed','failed'].includes(s.state)&&!alive(s.supervisorPid))return s;if(s.state==='unknown')fail('JOB_UNCONFIRMED','Original supervisor unavailable; no process was stopped.');atomic(path.join(this.home,'jobs',jobId,'cancel.json'),{jobId,at:Date.now()});return {jobId,state:'stopping',execution:'requested',dataPreserved:true};}
  inspect(jobId,screenshot=false){if(typeof screenshot!=='boolean')fail('INVALID_INPUT','screenshot must be boolean.');const state=this.status(jobId),dir=path.join(this.home,'jobs',jobId);return require('./observation.cjs').inspectDesktop(dir,json(path.join(dir,'plan.json')),state,{screenshot});}
  invoke(method,args={}){if(method==='remote'){const {operation,...params}=args;if(!['catalog','plan','start','status','stop','select_account','action','collect'].includes(operation))fail('UNKNOWN_OPERATION','Unknown remote operation.');return new (require('./remote.cjs').Remote)(this.home).invoke('remote_'+operation,params);}if(['remote_catalog','remote_plan','remote_start','remote_status','remote_stop','remote_select_account','remote_action','remote_collect'].includes(method))return new (require('./remote.cjs').Remote)(this.home).invoke(method,args);switch(method){case 'catalog':return this.catalog();case 'save_project':return this.saveProject(args.project,args.revision);case 'save_account':return this.saveAccount(args.account,args.revision);case 'save_profile':return this.saveProfile(args.profile,args.revision);case 'save_case':return this.saveCase(args.testCase,args.revision);case 'remove':return this.remove(args.kind,args.id,args.revision);case 'import_cindy':return this.importCindy(args.project,args.jobId);case 'select_account':return this.selectAccount(args.jobId,args.account);case 'plan':return this.plan(args.profile,args.action);case 'start':return this.start(args.profile,args.action);case 'status':return args.jobId?this.status(args.jobId):{jobs:this.jobs()};case 'stop':return this.stop(args.jobId);case 'inspect':return this.inspect(args.jobId,args.screenshot);default:fail('UNKNOWN_OPERATION','Unknown operation.');}}
}
module.exports={Environments,defaultHome,atomic,json,alive,safeEnv};
