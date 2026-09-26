const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const web=path.join(__dirname,'../../baguette-simulator/vendor/baguette/Baguette_Baguette.bundle/Web');
test('live panel updates remap taps and drags in both directions without resetting manual rotation',async()=>{
 const streams=[];
 const context={window:{},URLSearchParams,location:{protocol:'http:',host:'localhost'},fetch:async()=>({ok:true,json:async()=>({variantSets:[]})})};
 const native=fs.readFileSync(path.join(web,'sim-native.js'),'utf8');
 vm.createContext(context);
 vm.runInContext("let foldable=true,currentLitPanel='primary',currentOrientation='portrait',orientationIndex=0;const ORIENTATION_CYCLE=['portrait','landscape-left','portrait-upside-down','landscape-right'];"+native.slice(native.indexOf('  function orientationCycle()'),native.indexOf('  // Apply orientation visually:'))+native.slice(native.indexOf('  function syncLitPanel('),native.indexOf('  function resetToPortrait('))+native.slice(native.indexOf('  function visualToPortraitNorm('),native.indexOf('  // Map a screen-edge name')),context);
 vm.runInContext(fs.readFileSync(path.join(web,'sim-3d.js'),'utf8'),context);
 context.window.Baguette={_ScreenPieces:{fromMessage:()=>({length:1})}};
 context.window.StreamSession=class {constructor(options){streams.push(options);}start(){}stop(){}};
 const panel=new context.window.Sim3DPanel();
 // DOM/canvas are not needed to exercise production attach, stream callbacks,
 // page orientation state and the actual outgoing coordinate remapper.
 for(const method of ['renderLoading','renderControls','mountStage','setState','cancelPointer','placeButtons','placePosePicker'])panel[method]=()=>{};
 panel.canvas={};panel.outputSize=()=>({width:100,height:100});
 await panel.attach(null,null,'00000000-0000-4000-8000-000000000001',{onLitPanelChange:context.syncLitPanel});
 const emit=litPanel=>streams.at(-1).onText({type:'screen_quad',litPanel});
 const tap=()=>context.remapEnvelopeToPortrait({type:'tap',x:20,y:30,width:100,height:100});
 emit('secondary');assert.deepEqual([tap().x,tap().y],[30,80]);
 const drag=context.remapEnvelopeToPortrait({type:'swipe',startX:20,startY:30,endX:40,endY:50,width:100,height:100});
 assert.deepEqual([drag.startX,drag.startY,drag.endX,drag.endY],[30,80,50,60]);
 vm.runInContext("currentOrientation='landscape-right'",context);
 emit('secondary');assert.deepEqual([tap().x,tap().y],[70,20]);
 emit('bogus');assert.deepEqual([tap().x,tap().y],[70,20]);
 emit('primary');assert.deepEqual([tap().x,tap().y],[20,30]);
 const old=streams.at(-1);await panel.attach(null,null,panel.udid,{});
 old.onText({type:'screen_quad',litPanel:'secondary'});assert.deepEqual([tap().x,tap().y],[20,30]);
 emit('secondary');assert.deepEqual([tap().x,tap().y],[30,80]);
 emit('primary');assert.deepEqual([tap().x,tap().y],[20,30]);
});
