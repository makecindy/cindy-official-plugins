'use strict';
const {X509Certificate}=require('node:crypto');
const {fail}=require('./devices.cjs');
function candidates(identities,pem){
  const valid=new Set([...identities.matchAll(/\b([A-Fa-f0-9]{40})\s+"(?:Apple Development|iPhone Developer):/g)].map(m=>m[1].toUpperCase()));
  const teams=new Map();
  for(const block of pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)||[]){
    const c=new X509Certificate(block);
    if(!valid.has(c.fingerprint.replaceAll(':','')))continue;
    const id=/^OU=([A-Z0-9]{10})$/m.exec(c.subject)?.[1],name=/^O=(.+)$/m.exec(c.subject)?.[1];
    if(id)teams.set(id,{id,name:name||id});
  }
  return [...teams.values()];
}
function choose(teams,preferred,apps=[]){
  if(preferred&&teams.some(t=>t.id===preferred))return preferred;
  const installed=teams.filter(t=>apps.some(a=>new RegExp('^com\\.makecindy\\.WebDriverAgent\\.'+t.id.toLowerCase()+'(?:\\.xctrunner)?$').test(a.bundleIdentifier||'')));
  if(installed.length===1)return installed[0].id;
  return teams.length===1?teams[0].id:null;
}
function createSigning({run,devices}){
  const choices=new Map();
  async function teams(){
    // Inspect public certificate metadata and valid signing identities only.
    // Private keys and Apple account credentials stay managed by Keychain/Xcode.
    const [identities,certificates]=await Promise.all([
      run('/usr/bin/security',['find-identity','-v','-p','codesigning'],{timeout:10000}),
      run('/usr/bin/security',['find-certificate','-a','-p'],{timeout:10000,maxBuffer:8*1024*1024}),
    ]);
    return candidates(identities.stdout,certificates.stdout);
  }
  async function resolve(d,p={}){
    if(p.teamId!==undefined){
      if(!/^[A-Z0-9]{10}$/.test(p.teamId))throw fail('INVALID_SIGNING_TEAM','开发团队无效，请重新选择。');
      choices.set(d.udid,p.teamId);return p.teamId;
    }
    const available=await teams();
    if(!available.length)throw fail('XCODE_LOGIN_REQUIRED','查看画面不受影响。操作手机前，请在 Xcode → Settings → Accounts 登录开发者账号并创建开发证书。');
    const apps=await devices.command(['device','info','apps','--device',d.udid],p);
    const selected=choose(available,choices.get(d.udid),apps.apps||[]);
    if(!selected)throw Object.assign(fail('SIGNING_TEAM_CHOICE','请选择用于操作手机的开发团队；查看画面不受影响。'),{teams:available});
    choices.set(d.udid,selected);return selected;
  }
  return {resolve};
}
module.exports={createSigning,candidates,choose};
