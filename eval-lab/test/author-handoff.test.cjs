const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {dispatch}=require('../node/engine.cjs');
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'author-handoff-'));try{
 const p={root,id:'sample',revision:'v1',taskId:'host-task',workspace:path.join(root,'host')};await fs.mkdir(p.workspace);
 const draft=await dispatch('draft',{...p,records:[{sessionId:'synthetic',text:'Selected material'}]});
 const staged=await dispatch('author_stage',p);
 for(const name of ['candidate','reference','controls/incomplete','author'])await fs.mkdir(path.join(staged.directory,name),{recursive:true});
 await fs.writeFile(path.join(staged.directory,'question.json'),JSON.stringify({id:p.id,revision:p.revision,title:'Fixture',scoringVersion:'v1',groups:[{id:'g',weight:'1',mode:'all',items:['a']}]}));
 for(const name of ['candidate','reference','controls/incomplete'])await fs.writeFile(path.join(staged.directory,name,'answer'),name==='reference'?'yes':'no');
 await fs.writeFile(path.join(staged.directory,'author/grade.py'),"import pathlib,json,sys\npathlib.Path(sys.argv[2]).write_text(json.dumps({'status':'graded','items':{'a':(pathlib.Path(sys.argv[1])/'answer').read_text()=='yes'}}))\n");
 await fn(p,draft.directory,staged.directory);
}finally{await fs.rm(root,{recursive:true,force:true});}}
test('author stays in the host workspace and only completed output is imported, calibrated and frozen',()=>fixture(async(p,draft,staged)=>{
 assert.ok(staged.startsWith(await fs.realpath(p.workspace)+path.sep));assert.deepEqual(await dispatch('author_stage',p),{directory:staged});
 await fs.writeFile(path.join(staged,'unrelated.log'),'not imported');
 const result=await dispatch('author_collect',p);assert.equal(result.directory,path.join(draft,'authored'));
 await assert.rejects(fs.access(path.join(result.directory,'unrelated.log')));
 const bytes=await fs.readFile(path.join(result.directory,'question.json'));await fs.writeFile(path.join(staged,'question.json'),'later change');
 assert.deepEqual(await dispatch('author_collect',p),result);assert.deepEqual(await fs.readFile(path.join(result.directory,'question.json')),bytes);
 const cal=await dispatch('calibrate',p);assert.equal(cal.ok,true);
 const frozen=await dispatch('freeze',{root:p.root,checkId:cal.checkId});assert.equal(frozen.key,'custom:sample@v1');
}));
test('handoff rejects changed task identity, source records, links and mismatched question identity without publishing',()=>fixture(async(p,draft,staged)=>{
 await assert.rejects(dispatch('author_collect',{...p,taskId:'other'}),e=>/identity/.test(e.cause?.message));
 const input=path.join(staged,'sources.private.json'),original=await fs.readFile(input);await fs.writeFile(input,'changed');
 await assert.rejects(dispatch('author_collect',p),e=>/source records/.test(e.cause?.message));await fs.writeFile(input,original);
 const link=path.join(staged,'candidate/link');await fs.symlink(path.join(draft,'sources.private.json'),link);
 await assert.rejects(dispatch('author_collect',p),e=>/regular files/.test(e.cause?.message));await fs.unlink(link);
 const spec=path.join(staged,'question.json'),old=await fs.readFile(spec);await fs.writeFile(spec,old.toString().replace('sample','other'));
 await assert.rejects(dispatch('author_collect',p),e=>/identity/.test(e.cause?.message));await assert.rejects(fs.access(path.join(draft,'authored')));
 assert.equal((await fs.readdir(draft)).some(x=>x.startsWith('.authored-')),false);
}));
