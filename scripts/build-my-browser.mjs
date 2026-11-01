// Build-time only. Users never install Xcode/Node or run this script.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../my-browser');
const repository=path.resolve(import.meta.dirname,'..');
const out=path.resolve(process.argv[2] || path.join(root,'../.build/my-browser'));
const target=process.argv[3] || 'all';
if (!['all','chrome','edge','safari'].includes(target)) throw new Error('Target: chrome, edge, safari or all.');
// Refuse overwrites so an existing signed build is never replaced accidentally.
await fs.mkdir(out,{recursive:true});
process.chdir(repository);
const manifest=JSON.parse(await fs.readFile(path.join(root,'extension/manifest.json'),'utf8'));
const run=(file,args,opts={})=>execFileSync(file,args,{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe'],...opts,shell:false});
const relativePath=(value,base=repository)=>{
  const relative=path.relative(base,value);
  if(!relative||relative.includes('\0'))throw new Error('Invalid child-process path.');
  return relative;
};
const dependencyStage=await fs.mkdtemp(path.join(out,'.my-browser-dependencies-'));
try {
  // Assemble pinned resources once and copy them inside each extension root.
  // reader-pdf.js and ocr.js resolve ./vendor/... relative to that root.
  const dependencyPackage=path.join(dependencyStage,'my-browser.cindy');
  const dependencyOutput=path.relative(repository,dependencyPackage);
  if(!dependencyOutput||path.isAbsolute(dependencyOutput)||dependencyOutput.includes('\0'))throw new Error('Invalid dependency staging path.');
  run('/bin/bash',['.github/scripts/package-plugin.sh','my-browser',dependencyOutput],{shell:false});
  const dependencyUnpacked=path.join(dependencyStage,'unpacked');
  await fs.mkdir(dependencyUnpacked);
  run('/usr/bin/unzip',['-q',relativePath(dependencyPackage),'-d',relativePath(dependencyUnpacked)]);
  const generatedVendor=path.join(dependencyUnpacked,'extension','vendor');
  await fs.access(generatedVendor);
  for(const browser of target==='all'?['chrome','edge','safari']:[target]) {
  const dir=path.join(out,browser+'-extension');
  try{await fs.access(dir);throw new Error('Output already exists: '+dir);}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.cp(path.join(root,'extension'),dir,{recursive:true});
  await fs.cp(generatedVendor,path.join(dir,'vendor'),{recursive:true});
  await fs.copyFile(path.join(root,'THIRD-PARTY-LICENSES.txt'),path.join(dir,'THIRD-PARTY-LICENSES.txt'));
  const m=structuredClone(manifest);
  // Store uploads reject the development identity key. Keep it only in the
  // source/settings-page ZIP so existing local installations retain their ID.
  delete m.key;
  if(browser==='safari') {
    delete m.minimum_chrome_version;
    m.background={scripts:['policy.js','network-guard.js','learning-core.js','youtube-transcript.js','site-captions.js','background.js'],persistent:false};
  }
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(m,null,2)+'\n');
  if(browser!=='safari') {
    const zip=path.join(out,'my-browser-'+browser+'-'+manifest.version+'.zip');
    process.chdir(dir);
    try { run('/usr/bin/zip',['-qr',relativePath(zip,dir),'.'],{shell:false}); }
    finally { process.chdir(repository); }
    console.log(browser+': '+zip);continue;
  }
  if(process.platform!=='darwin') throw new Error('Safari packaging requires a macOS build machine.');
  const project=path.join(out,'safari');
  run('/usr/bin/xcrun',['safari-web-extension-converter',relativePath(dir),'--project-location',relativePath(project),'--app-name','My Browser','--bundle-identifier','com.makecindy.mybrowser','--macos-only','--copy-resources','--no-open','--no-prompt']);
  const xcodeProject=path.join(project,'My Browser','My Browser.xcodeproj');
  // Some converter releases derive the container id from the display name instead of --bundle-identifier.
  const pbx=path.join(xcodeProject,'project.pbxproj');
  let projectSource=await fs.readFile(pbx,'utf8');
  projectSource=projectSource.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g,line=>'PRODUCT_BUNDLE_IDENTIFIER = com.makecindy.mybrowser'+(line.includes('.Extension')?'.Extension':'')+';')
    .replace(/MARKETING_VERSION = [^;]+;/g,'MARKETING_VERSION = '+manifest.version+';')
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g,'CURRENT_PROJECT_VERSION = '+manifest.version.split('.').reduce((n,p)=>n*1000+Number(p),0)+';');
  await fs.writeFile(pbx,projectSource);
  const list=JSON.parse(run('/usr/bin/xcodebuild',['-list','-json','-project',relativePath(xcodeProject)]));
  const scheme=list.project.schemes.find(x=>x.includes('macOS')) || list.project.schemes[0];
  const log=path.join(out,'safari-build.log');
  try {
    const identity=process.env.MY_BROWSER_SIGN_IDENTITY, team=process.env.MY_BROWSER_DEVELOPMENT_TEAM;
    if (identity && !team) throw new Error('A signing identity also requires MY_BROWSER_DEVELOPMENT_TEAM.');
    const signing=identity ? ['CODE_SIGNING_ALLOWED=YES','CODE_SIGN_STYLE=Manual','CODE_SIGN_IDENTITY='+identity,'DEVELOPMENT_TEAM='+team] : ['CODE_SIGNING_ALLOWED=NO'];
    const output=run('/usr/bin/xcodebuild',['-project',relativePath(xcodeProject),'-scheme',scheme,'-configuration','Release','-derivedDataPath',relativePath(path.join(out,'derived')),...signing,'MACOSX_DEPLOYMENT_TARGET=12.0','ARCHS=arm64 x86_64','ONLY_ACTIVE_ARCH=NO','build']);
    await fs.writeFile(log,output);
  } catch(e) {await fs.writeFile(log,String(e.stdout || '')+'\n'+String(e.stderr || ''));throw new Error('Safari build failed; inspect '+log);}
  const app=path.join(out,'derived/Build/Products/Release/My Browser.app');
  const notary=process.env.MY_BROWSER_NOTARY_PROFILE;
  if (process.env.MY_BROWSER_SIGN_IDENTITY && notary) {
    const archive=path.join(out,'My Browser.zip');
    run('/usr/bin/ditto',['-c','-k','--keepParent',relativePath(app),relativePath(archive)]);
    run('/usr/bin/xcrun',['notarytool','submit',relativePath(archive),'--keychain-profile',notary,'--wait']);
    run('/usr/bin/xcrun',['stapler','staple',relativePath(app)]);
    run('/usr/sbin/spctl',['--assess','--type','execute',relativePath(app)]);
    const native=path.join(out,'native');await fs.mkdir(native);await fs.cp(app,path.join(native,'My Browser.app'),{recursive:true});
    console.log('Safari: signed and notarized app at '+native+'. Copy native/ into the plugin before packing.');
  } else console.log('Safari: universal Release app built. NOT READY FOR CONSUMER DISTRIBUTION: signing/notarization not completed.');
  console.log('Project: '+xcodeProject);
  }
} finally {
  await fs.rm(dependencyStage,{recursive:true,force:true});
}
