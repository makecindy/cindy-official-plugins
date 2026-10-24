const {test}=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const engine=path.resolve(__dirname,'../node/engine.cjs');
test('Python startup resource and permission errors retain their actual cause',async()=>{
 const {preflight}=require('../node/python-runtime.cjs');
 for(const code of ['EACCES','EPERM','EMFILE','ENFILE','EAGAIN'])await assert.rejects(preflight(async()=>({code:null,errorCode:code})),e=>e.code===code&&!/install Python|安装 Python/.test(e.message));
});
test('missing Python rejects preflight and preparation before creating answer files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-python-'));
 try{
  const result=cp.spawnSync(process.execPath,['-e',"const {dispatch}=require(process.argv[1]);(async()=>{for(const method of ['preflight','prepare']){try{await dispatch(method,{root:process.argv[2]});process.exitCode=1;}catch(e){if(!e.message.includes('Python 3'))throw e;}}})().catch(()=>process.exitCode=2);",engine,root],{env:{...process.env,PATH:root},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(await fs.readdir(root),[]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('Python probe rejects nonzero interpreters and accepts successful exit',async()=>{
 const original=cp.spawn,events=require('node:events');
 try{
  for(const code of [1,0]){
   cp.spawn=(command,args)=>{assert.equal(command,'python3');assert.deepEqual(args.slice(0,2),['-I','-c']);const child=new events.EventEmitter();child.stdout=new events.EventEmitter();child.stderr=new events.EventEmitter();queueMicrotask(()=>child.emit('close',code,null));return child;};
   if(code)await assert.rejects(require(engine).dispatch('preflight',{}),/Python 3/);else assert.deepEqual(await require(engine).dispatch('preflight',{}),{ok:true});
  }
 }finally{cp.spawn=original;}
});
test('Python startup guidance keeps error codes and Chinese plus English fallback',()=>{
 const {startupError}=require('../node/python-runtime.cjs'),{translate}=require('../i18n.js');
 for(const code of ['EACCES','EPERM','EMFILE','ENFILE','EAGAIN','ENOMEM','EIO',undefined]){
  const e=startupError(code);assert.equal(e.code,code||'PYTHON_START_FAILED');assert.match(e.message,/Python 无法启动/);assert.match(e.message,new RegExp(code||'UNKNOWN'));
  assert.equal(translate('zh-CN',e.message),e.message);
  for(const locale of ['en','ja','ko']){const value=translate(locale,e.message);assert.match(value,/Python could not start/);assert.doesNotMatch(value,/[\u4e00-\u9fff]/);assert.match(value,new RegExp(code||'UNKNOWN'));assert.doesNotMatch(translate(locale,'评分受阻：'+e.message),/[\u4e00-\u9fff]/);}
 }
});
