// Build-time only. Users never install Xcode/Node or run this script.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../my-browser');
const out=path.resolve(process.argv[2] || path.join(root,'../.build/my-browser'));
const target=process.argv[3] || 'all';
if (!['all','chrome','edge','safari'].includes(target)) throw new Error('Target: chrome, edge, safari or all.');
// Refuse overwrites so an existing signed build is never replaced accidentally.
await fs.mkdir(out,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(root,'extension/manifest.json'),'utf8'));
const run=(file,args,opts={})=>execFileSync(file,args,{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe'],...opts});
for(const browser of target==='all'?['chrome','edge','safari']:[target]) {
  const dir=path.join(out,browser+'-extension');
  try{await fs.access(dir);throw new Error('Output already exists: '+dir);}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.cp(path.join(root,'extension'),dir,{recursive:true});
  const m=structuredClone(manifest);
  if(browser==='safari') {
    delete m.key;delete m.minimum_chrome_version;
    m.background={scripts:['policy.js','network-guard.js','background.js'],persistent:false};
  }
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(m,null,2)+'\n');
  if(browser!=='safari') {
    const zip=path.join(out,'my-browser-'+browser+'-'+manifest.version+'.zip');
    run('/usr/bin/zip',['-qr',zip,'.'],{cwd:dir});
    console.log(browser+': '+zip);continue;
  }
  if(process.platform!=='darwin') throw new Error('Safari packaging requires a macOS build machine.');
  const project=path.join(out,'safari');
  run('/usr/bin/xcrun',['safari-web-extension-converter',dir,'--project-location',project,'--app-name','My Browser','--bundle-identifier','com.makecindy.mybrowser','--macos-only','--copy-resources','--no-open','--no-prompt']);
  const xcodeProject=path.join(project,'My Browser','My Browser.xcodeproj');
  // Some converter releases derive the container id from the display name instead of --bundle-identifier.
  const pbx=path.join(xcodeProject,'project.pbxproj');
  let projectSource=await fs.readFile(pbx,'utf8');
  projectSource=projectSource.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g,line=>'PRODUCT_BUNDLE_IDENTIFIER = com.makecindy.mybrowser'+(line.includes('.Extension')?'.Extension':'')+';')
    .replace(/MARKETING_VERSION = [^;]+;/g,'MARKETING_VERSION = '+manifest.version+';')
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g,'CURRENT_PROJECT_VERSION = '+manifest.version.split('.').reduce((n,p)=>n*1000+Number(p),0)+';');
  await fs.writeFile(pbx,projectSource);
  const list=JSON.parse(run('/usr/bin/xcodebuild',['-list','-json','-project',xcodeProject]));
  const scheme=list.project.schemes.find(x=>x.includes('macOS')) || list.project.schemes[0];
  const log=path.join(out,'safari-build.log');
  try {
    const identity=process.env.MY_BROWSER_SIGN_IDENTITY, team=process.env.MY_BROWSER_DEVELOPMENT_TEAM;
    if (identity && !team) throw new Error('A signing identity also requires MY_BROWSER_DEVELOPMENT_TEAM.');
    const signing=identity ? ['CODE_SIGNING_ALLOWED=YES','CODE_SIGN_STYLE=Manual','CODE_SIGN_IDENTITY='+identity,'DEVELOPMENT_TEAM='+team] : ['CODE_SIGNING_ALLOWED=NO'];
    const output=run('/usr/bin/xcodebuild',['-project',xcodeProject,'-scheme',scheme,'-configuration','Release','-derivedDataPath',path.join(out,'derived'),...signing,'MACOSX_DEPLOYMENT_TARGET=12.0','ARCHS=arm64 x86_64','ONLY_ACTIVE_ARCH=NO','build']);
    await fs.writeFile(log,output);
  } catch(e) {await fs.writeFile(log,String(e.stdout || '')+'\n'+String(e.stderr || ''));throw new Error('Safari build failed; inspect '+log);}
  const app=path.join(out,'derived/Build/Products/Release/My Browser.app');
  const notary=process.env.MY_BROWSER_NOTARY_PROFILE;
  if (process.env.MY_BROWSER_SIGN_IDENTITY && notary) {
    const archive=path.join(out,'My Browser.zip');
    run('/usr/bin/ditto',['-c','-k','--keepParent',app,archive]);
    run('/usr/bin/xcrun',['notarytool','submit',archive,'--keychain-profile',notary,'--wait']);
    run('/usr/bin/xcrun',['stapler','staple',app]);
    run('/usr/sbin/spctl',['--assess','--type','execute',app]);
    const native=path.join(out,'native');await fs.mkdir(native);await fs.cp(app,path.join(native,'My Browser.app'),{recursive:true});
    console.log('Safari: signed and notarized app at '+native+'. Copy native/ into the plugin before packing.');
  } else console.log('Safari: universal Release app built. NOT READY FOR CONSUMER DISTRIBUTION: signing/notarization not completed.');
  console.log('Project: '+xcodeProject);
}
