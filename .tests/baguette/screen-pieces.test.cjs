const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const context={window:{}};
for(const name of ['screen-quad','screen-pieces'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../baguette-simulator/vendor/baguette/Baguette_Baguette.bundle/Web/baguette/gestures',name+'.js'),'utf8'),context);
const Pieces=context.window.Baguette._ScreenPieces;
const piece=(left,right,u)=>({corners:[[left,0],[right,0],[right,1],[left,1]],u,v:[0,1]});
test('Duo drags leaving either half stay at the nearest half regardless of ordering',()=>{
 for(const reverse of [false,true]){
  const pieces=[piece(0,0.4,[0,0.5]),piece(0.6,1,[0.5,1])];
  const screen=Pieces.fromMessage({pieces:reverse?pieces.reverse():pieces});
  for(const [x,y,u,v] of [[1.1,0.5,1,0.5],[0.8,-0.1,0.75,0],[0.8,1.1,0.75,1],[-0.1,0.5,0,0.5],[0.2,1.1,0.25,1]]){
   const hit=screen.locate(x,y);assert.equal(hit.inside,false);assert.ok(Math.abs(hit.u-u)<1e-9);assert.ok(Math.abs(hit.v-v)<1e-9);
  }
  assert.equal(screen.locate(0.8,0.5).inside,true);
 }
});
test('single screen and empty screen retain their fallback behavior',()=>{
 const single=Pieces.fromMessage({corners:[[0,0],[1,0],[1,1],[0,1]]});
 assert.equal(single.locate(2,0.5).u,1);assert.equal(new Pieces([]).locate(1,1).inside,false);
});
