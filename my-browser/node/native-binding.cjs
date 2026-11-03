'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const HOST='com.makecindy.browser';
// Private bootstrap authority; never sent to the extension or stored in Cindy KV.
function createNativeBinding(options={}) {
  const platform=options.platform||process.platform,home=options.home||os.homedir(),env=options.env||process.env;
  const root=options.root||path.join(platform==='darwin'?path.join(home,'Library/Application Support'):platform==='win32'?(env.LOCALAPPDATA||path.join(home,'AppData/Local')):path.join(home,'.local/share'),'Cindy','browser-native');
  const token=crypto.randomBytes(32).toString('hex');
  let config;let state='preparing';
  const run=options.run||promisify(execFile);
  async function privateDirectory(dir) {
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('NATIVE_PATH_UNSAFE');
    if(platform!=='win32')await fs.chmod(dir,0o700);
  }
  async function atomic(file,data,mode=0o600) {
    const tmp=file+'.'+crypto.randomUUID()+'.tmp';
    try{await fs.writeFile(tmp,data,{flag:'wx',mode});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}
  }
  async function install(port,ids) {
    try {
      await privateDirectory(root);await privateDirectory(path.join(root,'connections'));
      const binaryName='cindy-browser-native'+(platform==='win32'?'.exe':'');
      const source=options.binary||path.join(__dirname,'../native-host/bin',platform+'-'+(options.arch||process.arch),binaryName);
      const binary=path.join(root,binaryName);
      // Don't replace a running Windows image when it already matches this build.
      const content=await fs.readFile(source),old=await fs.readFile(binary).catch(()=>null);
      if(!old?.equals(content))await atomic(binary,content,0o700);
      const manifest={name:HOST,description:'Cindy browser automatic key binding',path:binary,type:'stdio',allowed_origins:ids.map(id=>'chrome-extension://'+id+'/')};
      if(platform==='win32') {
        const file=path.join(root,HOST+'.json');await atomic(file,JSON.stringify(manifest));
        const reg=path.join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32','reg.exe');
        for(const vendor of ['Google\\Chrome','Microsoft\\Edge','BraveSoftware\\Brave-Browser'])await run(reg,['ADD','HKCU\\Software\\'+vendor+'\\NativeMessagingHosts\\'+HOST,'/ve','/t','REG_SZ','/d',file,'/f'],{windowsHide:true,timeout:10000});
      } else {
        const profiles=options.profiles||(platform==='darwin'?['Google/Chrome','Google/Chrome for Testing','Chromium','Microsoft Edge','BraveSoftware/Brave-Browser','BraveSoftware/Brave-Origin','Dia'].map(p=>path.join(home,'Library/Application Support',p)):['google-chrome','google-chrome-for-testing','chromium','microsoft-edge','BraveSoftware/Brave-Browser'].map(p=>path.join(env.XDG_CONFIG_HOME||path.join(home,'.config'),p)));
        let registered=0;for(const profile of profiles){try{const dir=path.join(profile,'NativeMessagingHosts');await privateDirectory(dir);await atomic(path.join(dir,HOST+'.json'),JSON.stringify(manifest));registered++;}catch(e){const reason=['EACCES','EPERM','ENOENT','EROFS','EBUSY'].includes(e?.code)?e.code:e?.message==='NATIVE_PATH_UNSAFE'?'NATIVE_PATH_UNSAFE':'INSTALL_FAILED';console.error('Cindy native binding skipped a browser directory: '+reason);}}if(!registered)throw Error('INSTALL_FAILED');
      }
      config=path.join(root,'connections',port+'.json');await atomic(config,JSON.stringify({token}));
      state='ready';return {ok:true};
    }catch(e){state='unavailable';const reason=['EACCES','EPERM','ENOENT','EROFS','EBUSY'].includes(e?.code)?e.code:e?.message==='NATIVE_PATH_UNSAFE'?'NATIVE_PATH_UNSAFE':'INSTALL_FAILED';console.error('Cindy native binding unavailable: '+reason);return {ok:false,error:'NATIVE_BINDING_UNAVAILABLE'};}
  }
  async function close(){if(config){const data=await fs.readFile(config,'utf8').catch(()=>'');if(data===JSON.stringify({token}))await fs.rm(config,{force:true});}}
  return {token,install,close,status:()=>state};
}
module.exports={createNativeBinding,HOST};
