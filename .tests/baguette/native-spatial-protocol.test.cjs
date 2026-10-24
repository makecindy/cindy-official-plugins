const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');

// Exercise the production parser/stream loop with fake HID and a fast clock.
// No simulator, Xcode private frameworks or real mouse events are used.
test('native pointer stream preserves large offsets, held masks and release while spatial limits remain', {skip:process.platform!=='darwin'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cindy-spatial-protocol-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=fs.readFileSync(path.join(__dirname,'../../cindy-simulator/native/spatial.m'),'utf8');
 const start=source.indexOf('static int stream('),end=source.indexOf('\nint main(');
 assert.ok(start>=0&&end>start);
 const fixture=fs.readFileSync(path.join(__dirname,'spatial-protocol.m'),'utf8');
 assert.equal(fixture.split('// PRODUCTION_STREAM').length,2);
 const file=path.join(root,'protocol.m'),binary=path.join(root,'protocol');
 fs.writeFileSync(file,fixture.replace('// PRODUCTION_STREAM',source.slice(start,end)));
 execFileSync('xcrun',['clang','-fobjc-arc','-fblocks','-O2','-framework','Foundation',file,'-o',binary],{timeout:30000});
 const run=input=>{
  const p=spawnSync(binary,[],{input,encoding:'utf8',timeout:10000});
  if(p.error)throw p.error;
  return {status:p.status,...JSON.parse(p.stderr)};
 };
 const frames=['0 9 0 0 1 1 .1 0 0 0'];
 for(let i=1;i<=2101;i++)frames.push(`1 9 ${i*1.2} ${-i*.6} ${{1:3,2:1,3:2,4:0}[i]??1} 1 .1 0 0 0`);
 frames.push(`2 9 ${2101*1.2} ${-2101*.6} 1 1 .1 0 0 0`);
 const long=run(frames.join('\n')+'\n');
 assert.deepEqual(long,{status:0,result:0,events:2103,mask:0,dx:2521200,dy:-1260600,created:1,removed:1});
 const invalid=run('0 9 0 0 3 1 .1 0 0 0\n1 9 nan 0 3 1 .1 0 0 0\n');
 assert.equal(invalid.status,5);assert.equal(invalid.events,2);assert.equal(invalid.mask,0);assert.equal(invalid.removed,1);
 for(const input of ['0 2 11 0 0 1 .1 0 0 0\n','0 2 0 0 0 1 .1 0 0 0\n']){
  const spatial=run(input);assert.equal(spatial.status,5);assert.equal(spatial.events,0);
 }
});
