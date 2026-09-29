const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {dispatch}=require('../node/engine.cjs');
test('existing run bank projects the same opaque source as catalog without rewriting records',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-source-'));
 try{
  const q={key:'audio@v1',title:'Audio',revision:'v1',sourceManifestSha256:'r',files:{}};
  for(const name of ['one','two']){const bank=path.join(root,name);await fs.mkdir(bank);await fs.writeFile(path.join(bank,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[q]}));const dir=path.join(root,'eval-lab-data/runs',name);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'run.json'),JSON.stringify({runId:name,bank:await fs.realpath(bank),questionId:'audio',revision:'v1',releaseHash:'r',status:'prepared'}));}
  const record=path.join(root,'eval-lab-data/runs/one/run.json'),before=await fs.readFile(record,'utf8');
  const catalog=await dispatch('bank',{root,importedBanks:[{id:'a',path:path.join(root,'one')},{id:'b',path:path.join(root,'two')}]}),runs=await dispatch('runs',{root});
  assert.equal(typeof runs[0].sourceKey,'string');assert.notEqual(runs[0].sourceKey,runs[1].sourceKey);
  assert.equal(catalog.questions[0].sourceKey,runs.find(r=>r.runId==='one').sourceKey);assert.doesNotMatch(JSON.stringify(runs),new RegExp(root));assert.equal(await fs.readFile(record,'utf8'),before);
  await fs.rename(path.join(root,'one'),path.join(root,'moved'));
  const moved=await dispatch('bank',{root,importedBanks:[{id:'old',path:path.join(root,'one')},{id:'new',path:path.join(root,'moved')}]}),retained=await dispatch('runs',{root});
  assert.notEqual(moved.questions.find(q=>q.key.startsWith('imported:new:')).sourceKey,retained.find(r=>r.runId==='one').sourceKey);assert.equal(await fs.readFile(record,'utf8'),before);

 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('history and export exclude another source even for identical question versions',async()=>{
 const code=await fs.readFile(path.join(__dirname,'../view.js'),'utf8'),elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
 const q={key:'audio@v2',questionId:'audio',revision:'v2',releaseHash:'r2',distributionHash:'d2',sourceKey:'one',title:'Audio'};
 const run=(id,sourceKey,revision='v2')=>({...q,runId:id,sourceKey,revision,releaseHash:revision==='v2'?'r2':'r1',distributionHash:revision==='v2'?'d2':'d1',model:'m',provider:'p',harness:'h',effort:'medium',status:'graded',scoreExact:'1',gradedAt:'2026-01-01'});
 let exported,click;const context={$,window:{evalRunStatus:s=>require('../i18n.js').runStatus('zh-CN',s)},document:{querySelectorAll:()=>[]},state:{banks:[{id:'one',name:'One',questions:[q]}],runs:[run('own','one'),run('old','one','v1'),run('foreign','two'),run('foreign-old','two','v0'),run('unknown',undefined)],models:[]},bankId:'one',historyBankId:'one',historyQuestion:'',historyBatch:'',scoreMode:'latest',standingsRows:[],standingsQuestions:[],EvalStandings:require('../standings.js'),esc:String,tr:t=>t,dateText:()=>'',scoreText:String,bind:(_,fn)=>{click=fn;},message(){},rpc:async(_,args)=>{exported=args;return {saved:true};}};
 vm.runInNewContext(code.slice(code.indexOf('function history(){'),code.indexOf('\nfunction ',code.indexOf('function history(){')+1)),context);
 context.state.runs.push({runId:'damaged',recordError:'评测记录损坏，请恢复该记录文件后刷新；原文件保留，未计分。'});context.history();assert.match($('#standings-note').textContent,/damaged/);vm.runInNewContext(code.match(/^bind\('#export'.*$/m)[0],context);await click();assert.deepEqual(Array.from(exported.runIds),['own']);assert.match($('#history-question').innerHTML,/v1/);assert.doesNotMatch($('#history-question').innerHTML,/v0/);
 context.historyQuestion=context.EvalStandings.questionKey(run('old','one','v1'));context.history();await click();assert.deepEqual(Array.from(exported.runIds),['old']);
 assert.match($('#history-filter').innerHTML,/history-source:two/);context.historyBankId='history-source:two';context.historyQuestion='';context.history();await click();assert.deepEqual(Array.from(exported.runIds),['foreign']);assert.match(exported.standings.title,/未关联题库/);assert.equal(exported.standings.questions.length,1);
 context.historyQuestion=context.EvalStandings.questionKey(run('foreign-old','two','v0'));context.history();await click();assert.deepEqual(Array.from(exported.runIds),['foreign-old']);assert.equal(exported.standings.questions.length,1);
 assert.equal(context.state.banks.length,1,'historical view must not add a runnable bank');
 for(const [status,label]of Object.entries({failed:'未能评分',cancelled:'已停止',prepared:'待交卷'})){context.state.runs=[{...run('own','one'),status,scoreExact:null}];context.historyBankId='one';context.historyQuestion='';context.history();assert.ok($('#history').innerHTML.includes(label),status);}

});

test('draft listing excludes published versions while preserving later drafts and calibration bytes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-published-')),old='snapshot-'+'a'.repeat(64),next='snapshot-'+'b'.repeat(64);
 try{
  for(const [checkId,revision]of [[old,'v1'],[next,'v2']]){const dir=path.join(root,'eval-lab-data/calibrations',checkId);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'calibration.json'),JSON.stringify({checkId,id:'same',revision,ok:true}));}
  const cal=path.join(root,'eval-lab-data/calibrations',old,'calibration.json'),before=await fs.readFile(cal,'utf8');
  const bank=path.join(root,'eval-lab-data/custom-bank');await fs.mkdir(bank);await fs.writeFile(path.join(bank,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[{key:'same@v1'}]}));
  assert.deepEqual((await dispatch('drafts',{root})).map(d=>d.checkId),[next]);assert.equal(await fs.readFile(cal,'utf8'),before);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('listing isolates damaged required records without losing healthy results or modifying bytes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-corrupt-run-'));
 try{
  const home=path.join(root,'eval-lab-data/runs');
  for(const [id,file,body]of [['healthy','result.json',JSON.stringify({runId:'healthy',status:'graded',score:1})],['broken-result','result.json','{'],['broken-run','run.json','{'],['null-result','result.json','null'],['array-run','run.json','[]']]){
   const dir=path.join(home,id);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,file),body);
  }
  const rows=await dispatch('runs',{root});assert.equal(rows.find(r=>r.runId==='healthy').score,1);
  assert.equal(rows.filter(r=>r.recordError).length,4);for(const r of rows.filter(r=>r.recordError)){assert.match(r.recordError,/恢复.*记录/);assert.equal(r.score,undefined);}
  assert.equal(await fs.readFile(path.join(home,'broken-result/result.json'),'utf8'),'{');
  await fs.writeFile(path.join(home,'broken-result/result.json'),JSON.stringify({runId:'broken-result',status:'graded',score:1}));assert.equal((await dispatch('runs',{root})).find(r=>r.runId==='broken-result').score,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
