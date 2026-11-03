'use strict';
// npm ci --ignore-scripts in a separate directory using android-deps-package.json
// as package.json and android-deps-lock.json as package-lock.json. Pass it here.
const path=require('node:path'),fs=require('node:fs/promises');
const dependencyRoot=path.resolve(process.argv[2]||''),modules=path.join(dependencyRoot,'node_modules'),esbuild=require(path.join(modules,'esbuild'));
const output=path.join(__dirname,'../vendor/android');
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const packages=new Set(['@tesseract.js-data/eng','@tesseract.js-data/chi_sim']);
  for(const [entry,name]of [['android-deps.cjs','deps.cjs'],['android-ocr-worker.cjs','ocr-worker.cjs']]){
    const result=await esbuild.build({entryPoints:[path.join(__dirname,entry)],outfile:path.join(output,name),bundle:true,platform:'node',format:'cjs',minify:true,nodePaths:[modules],metafile:true,
      // OCR languages are explicit. Emscripten's C locale is also fixed;
      // neither the host's locale nor browser language selects plugin UI.
      define:{navigator:'undefined'}});
    for(const input of Object.keys(result.metafile.inputs)){const match=input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);if(match)packages.add(match[1]);}
  }
  await fs.copyFile(path.join(modules,'tesseract.js-core/tesseract-core-lstm.wasm'),path.join(output,'tesseract-core-lstm.wasm'));
  for(const language of ['eng','chi_sim'])await fs.copyFile(path.join(modules,`@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`),path.join(output,language+'.traineddata.gz'));
  const record=[],notices=[];
  for(const name of [...packages].sort()){
    const directory=path.join(modules,name),pkg=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
    record.push({name,version:pkg.version,license:pkg.license,source:pkg.repository?.url||pkg.repository||pkg.homepage});
    const licenses=(await fs.readdir(directory)).filter(n=>/^(license|copying|notice)(\.|$)/i.test(n));
    notices.push(`${name} ${pkg.version} (${pkg.license})\n${pkg.repository?.url||pkg.homepage||''}\n`);
    for(const file of licenses)notices.push(await fs.readFile(path.join(directory,file),'utf8'));
  }
  await fs.writeFile(path.join(output,'packages.json'),JSON.stringify(record,null,2)+'\n');
  await fs.writeFile(path.join(output,'LICENSES.txt'),notices.join('\n\n'));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
