'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
// A random profile key stored in owner-scoped Library partitions this plugin's
// external workspace. Never infer Cindy's private owner paths or write its vault.
async function defaultRoot(profile,{home=os.homedir(),platform=process.platform,appData=process.env.APPDATA,xdg=process.env.XDG_DATA_HOME}={}){
 if(!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(profile||''))throw Error('Invalid storage profile');
 const base=platform==='darwin'?path.join(home,'Library/Application Support'):platform==='win32'?(appData||path.join(home,'AppData/Roaming')):(xdg||path.join(home,'.local/share'));
 const root=path.join(base,'Cindy Eval Lab','profiles',profile);await fs.mkdir(root,{recursive:true,mode:0o700});return {root:await fs.realpath(root)};
}
module.exports={defaultRoot};
