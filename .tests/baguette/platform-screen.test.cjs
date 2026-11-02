const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixedScreen}=require('../../cindy-simulator/node/platform-screen.cjs');
const screen=(name,w,h,scale,id=1)=>`Screen ID: ${id}\n Device Name: ${name}\n Pixel Size: {${w}, ${h}}\n Preferred UI Scale: ${scale}\n`;
test('connected TV and Vision framebuffers use their own UI density, not a phone orientation',()=>{
 const tv=fixedScreen(screen('external-0',1920,1080,1));
 const vision=fixedScreen(screen('primary',3840,2160,2));
 assert.equal(tv.width,1920);assert.equal(tv.height,1080);
 assert.equal(vision.width,1920);assert.equal(vision.height,1080);
 assert.deepEqual(vision.target.pixelSize,{width:3840,height:2160});
 assert.equal(vision.orientation,'portrait');
});
test('screen discovery rejects missing, invalid or ambiguous displays',()=>{
 for(const text of ['',screen('primary',3840,2160,0),screen('a',1920,1080,1)+screen('b',1920,1080,1,2)])
  assert.throws(()=>fixedScreen(text),e=>e.code==='SCREEN_UNAVAILABLE'&&e.execution==='not_executed');
 assert.equal(fixedScreen(screen('other',800,600,1)+screen('primary',3840,2160,2,2)).target.screenId,2);
});
