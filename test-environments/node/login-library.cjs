'use strict';
// Public account references and app-owned profile locations only. Never credentials.
const crypto=require('node:crypto');
const regions=new Set(['global','cn']);
const clean=(value,max=256)=>typeof value==='string'&&value.trim()&&value.length<=max&&!value.includes('\0')?value:null;
function rememberLoginAccounts(db,profile,application,snapshot){
  if(profile.mode!=='acceptance'||profile.platform!=='desktop'||!profile.isolated||!regions.has(profile.region||'global'))return;
  const library=db.loginAccounts||(db.loginAccounts={}),region=profile.region||'global';
  const slot=region+':'+profile.isolated,seen=new Set();
  for(const item of snapshot.accounts){
    const selector=clean(item.accountKey,512);if(!selector)continue;
    // Region must come from the application. Opaque keys and email domains are not parsed.
    const authRegion=regions.has(item.region)?item.region:null;
    let account=Object.values(library).find(a=>a.selector===selector&&a.region===authRegion&&(authRegion||Object.values(a.sessions).some(s=>s.region===region)));
    if(!account&&!authRegion)account=Object.values(library).find(a=>a.selector===selector&&a.sessions[slot]);
    if(!account&&authRegion){account=Object.values(library).find(a=>a.selector===selector&&a.region===null&&a.sessions[slot]);if(account)account.region=authRegion;}
    if(!account){const id=crypto.randomUUID();account=library[id]={id,selector,region:authRegion,label:clean(item.displayName)||'Cindy',sessions:{}};}
    seen.add(account.id);
    const session={isolated:profile.isolated,region,userDataDir:application.userDataDir,listed:true};
    account.sessions[slot]=session;
    // Only public display fields from the native account summary are retained.
    account.label=clean(item.displayName)||account.label;
    if(clean(item.email,320))account.email=item.email;else delete account.email;
    if(clean(item.orgName))account.orgName=item.orgName;else delete account.orgName;
    if(['personal','org'].includes(item.kind))account.kind=item.kind;else delete account.kind;
  }
  for(const account of Object.values(library))if(account.sessions[slot]&&!seen.has(account.id))account.sessions[slot].listed=false;
}
function selectLoginSession(account){return Object.values(account.sessions).find(s=>s.listed&&(!account.region||s.region===account.region));}
function listLoginAccounts(db){return Object.values(db.loginAccounts||{}).map(account=>{
  const session=selectLoginSession(account);
  // Older clients omit the realm. Reuse the observed build/profile, without guessing a realm.
  return {...account,launchRegion:session?.region||null,regionSource:account.region?'application':'saved-profile',available:!!session,reason:!session?'ACCOUNT_SIGN_IN_REQUIRED':null};
});}
function migrateLoginAccounts(db){
  if(db.loginAccounts!==undefined)return false;
  db.loginAccounts={};
  for(const profile of Object.values(db.profiles)){
    const entries=Object.values(db.accounts).filter(a=>a.project===profile.project&&a.sessions?.[profile.id]?.listed&&a.sessions[profile.id].isolated===profile.isolated);
    const userDataDir=entries[0]?.sessions[profile.id].userDataDir;
    if(!userDataDir)continue;
    rememberLoginAccounts(db,profile,{userDataDir},{accounts:entries.filter(a=>a.sessions[profile.id].userDataDir===userDataDir).map(a=>({accountKey:a.selector,displayName:a.label}))});
  }
  return true;
}
module.exports={rememberLoginAccounts,listLoginAccounts,selectLoginSession,migrateLoginAccounts};
