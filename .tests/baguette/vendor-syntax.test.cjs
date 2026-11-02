const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const web=path.resolve(__dirname,'../../cindy-simulator/vendor/baguette/Baguette_Baguette.bundle/Web');
const plugin=path.resolve(__dirname,'../../cindy-simulator/node');
function* scripts(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())yield* scripts(full);else if(/\.(c?js|mjs)$/.test(entry.name))yield full;}}
// A misplaced patch hunk once left sim-native.js unparsable; the page then silently fell back to the device list.
test('every vendored and first-party page script parses',()=>{
 const failures=[];
 for(const file of [...scripts(web),...[...scripts(plugin)].filter(f=>!f.endsWith('.cjs'))]){
  try{new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});}catch(error){failures.push(path.relative(web,file)+': '+error.message);}
 }
 assert.deepEqual(failures,[]);
});
test('the patched 3D attach still hands the lit-panel callback to the panel inside toggle3D',()=>{
 const source=fs.readFileSync(path.join(web,'sim-native.js'),'utf8');
 const toggle=source.slice(source.indexOf('  function toggle3D('),source.indexOf('  function toggle3DInspector('));
 assert.match(toggle,/onLitPanelChange: syncLitPanel/);
 assert.equal((source.match(/onLitPanelChange: syncLitPanel/g)||[]).length,1);
});
