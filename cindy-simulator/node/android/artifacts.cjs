'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
// Same one-day artifact retention as the iOS backend; device data is separate.
async function directory(root,kind){
  const folder=path.join(root,kind);await fs.mkdir(folder,{recursive:true,mode:0o700});
  const cutoff=Date.now()-24*3600*1000;
  for(const name of await fs.readdir(folder)){
    const file=path.join(folder,name),stat=await fs.lstat(file).catch(()=>null);
    if(stat&&stat.mtimeMs<cutoff)await fs.rm(file,{recursive:true,force:true}).catch(()=>{});
  }
  return folder;
}
module.exports={directory};
