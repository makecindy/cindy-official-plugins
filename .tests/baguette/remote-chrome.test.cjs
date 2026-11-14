'use strict';
// A simulator shown on another of the user's computers looks the same as on
// the computer that runs it: the same body, made there from the same artwork,
// fetched in pieces and checked before the device page draws it.
const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http');
const {createChromeSource,createChromeStore,CHUNK}=require('../../cindy-simulator/node/remote/chrome.cjs');
const {createChrome}=require('../../cindy-simulator/node/physical/chrome.cjs');
const {createRemoteViewer}=require('../../cindy-simulator/node/remote/viewer.cjs');
const {PNG}=require('../../cindy-simulator/vendor/android/deps.cjs');

const png=(width,height)=>PNG.sync.write(new PNG({width,height}));
const data=bytes=>'data:image/png;base64,'+bytes.toString('base64');
// Large enough to need several pieces, as a real framebuffer mask does.
const body=(mask='A'.repeat(CHUNK*2+17))=>({screen:{viewport:{width:492,height:990},rect:{x:27,y:18,width:438,height:954},clipRadius:62,crease:false,
  maskImage:'data:image/png;base64,'+mask,bezelImage:{rest:data(png(4,8)),bare:data(png(4,8))}}});

test('the body made for a simulator follows its type and how the picture is turned',async()=>{
  const calls=[];
  const run=async(file,args)=>{
    calls.push([file.split('/').pop(),...args]);
    if(args[0]==='simctl')return {stdout:JSON.stringify({devicetypes:[{name:'iPhone Air',identifier:'com.apple.CoreSimulator.SimDeviceType.iPhone-Air',modelIdentifier:'iPhone18,4',bundlePath:'/types/air'},
      {name:'Apple TV',identifier:'com.apple.CoreSimulator.SimDeviceType.Apple-TV',modelIdentifier:'AppleTV14,1',bundlePath:'/types/tv'}]})};
    if(args.includes('/types/air/Contents/Resources/capabilities.plist'))return {stdout:JSON.stringify({capabilities:{displays:[{displayType:'integrated',scale:3,width:1260,height:2736,deviceName:'primary'}]}})};
    if(args[1]==='layout')return {stdout:JSON.stringify({screen:{x:27,y:18,width:438,height:954},composite:{width:492,height:990},innerCornerRadius:62})};
    if(args[1]==='composite'){const image=new PNG({width:4,height:8});image.data[0]=255;image.data[3]=255;return {stdout:PNG.sync.write(image)};}
    throw Error('unexpected '+args.join(' '));
  };
  const chrome=createChrome({root:'/nowhere',run});
  const upright=await chrome.simulatorDefinition('com.apple.CoreSimulator.SimDeviceType.iPhone-Air',{width:1260,height:2736,rotation:0});
  assert.deepEqual(upright.screen.viewport,{width:492,height:990});assert.deepEqual(upright.screen.rect,{x:27,y:18,width:438,height:954});
  // Turned on its side: the body turns with it, and the picture stays upright inside.
  const turned=await chrome.simulatorDefinition('com.apple.CoreSimulator.SimDeviceType.iPhone-Air',{width:2736,height:1260,rotation:1});
  assert.deepEqual(turned.screen.viewport,{width:990,height:492});assert.deepEqual(turned.screen.rect,{x:18,y:27,width:954,height:438});
  const image=PNG.sync.read(Buffer.from(turned.screen.bezelImage.rest.split(',')[1],'base64'));assert.deepEqual([image.width,image.height],[8,4]);
  const opposite=await chrome.simulatorDefinition('com.apple.CoreSimulator.SimDeviceType.iPhone-Air',{width:2736,height:1260,rotation:3});
  const inverted=await chrome.simulatorDefinition('com.apple.CoreSimulator.SimDeviceType.iPhone-Air',{width:1260,height:2736,rotation:2});
  assert.deepEqual(opposite.screen.viewport,turned.screen.viewport);
  assert.deepEqual(inverted.screen.viewport,upright.screen.viewport);
  assert.equal(new Set([upright,turned,opposite,inverted].map(d=>d.screen.bezelImage.rest)).size,4,'four observed poses produce four distinct bodies');
  assert.equal(await chrome.simulatorDefinition('com.apple.CoreSimulator.SimDeviceType.iPhone-Air',{width:1260,height:2736}),null,'unknown rotation never guesses a mask');
  // A picture that is none of the type's panels, a type without phone artwork, an unknown type: no body.
  assert.equal(await chrome.simulatorDefinition('com.apple.CoreSimulator.SimDeviceType.iPhone-Air',{width:1170,height:2532}),null);
  assert.equal(await chrome.simulatorDefinition('com.apple.CoreSimulator.SimDeviceType.Apple-TV',{width:1920,height:1080}),null);
  assert.equal(await chrome.simulatorDefinition('com.apple.CoreSimulator.SimDeviceType.Unknown',{width:1260,height:2736}),null);
  // The artwork is made once per type and panel, however it is turned.
  assert.equal(calls.filter(c=>c[2]==='composite').length,1);
});

test('the body travels in pieces that fit one request and is checked before use',async()=>{
  const source=createChromeSource({definition:async(type)=>type==='known'?body():null});
  const meta=await source.meta('known',{width:1260,height:2736});
  assert.match(meta.key,/^[0-9a-f]{32}$/);assert.ok(meta.chunks>=3);
  const store=createChromeStore();
  for(let i=0;i<meta.chunks;i++){
    const {data:piece}=source.chunk(meta.key,i);assert.ok(piece.length<=CHUNK);
    assert.equal(store.put(meta.key,i,meta.chunks,piece).complete,i===meta.chunks-1);
  }
  const got=store.get(meta.key);
  assert.deepEqual(got.viewport,{width:492,height:990});assert.equal(got.bezelImage.rest,body().screen.bezelImage.rest);assert.equal(got.bezelImage.bare,got.bezelImage.rest);
  assert.equal(got.maskImage,body().screen.maskImage);
  // No artwork there, a wrong size, an expired key: nothing to draw, never a guess.
  assert.deepEqual(await source.meta('other',{width:1260,height:2736}),{none:true});
  await assert.rejects(source.meta('known',{width:0,height:5}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>source.chunk('0'.repeat(32),0),{code:'CHROME_EXPIRED'});assert.throws(()=>source.chunk(meta.key,meta.chunks),{code:'CHROME_EXPIRED'});
  // A piece out of order or changed on the way is refused, and what was received so far is dropped.
  const other=createChromeStore();
  other.put(meta.key,0,meta.chunks,source.chunk(meta.key,0).data);
  assert.throws(()=>other.put(meta.key,2,meta.chunks,source.chunk(meta.key,2).data),{code:'CHROME_OUT_OF_ORDER'});
  assert.throws(()=>other.put(meta.key,1,meta.chunks,source.chunk(meta.key,1).data),{code:'CHROME_OUT_OF_ORDER'});
  other.put(meta.key,0,meta.chunks,source.chunk(meta.key,0).data);other.put(meta.key,1,meta.chunks,'B'.repeat(CHUNK));
  assert.throws(()=>{for(let i=2;i<meta.chunks;i++)other.put(meta.key,i,meta.chunks,source.chunk(meta.key,i).data);},{code:'CHROME_INVALID'});
  assert.equal(other.has(meta.key),false);
  // Only images as data, never an address to load from somewhere.
  const evil=createChromeSource({definition:async()=>({screen:{...body('AAAA').screen,bezelImage:{rest:'https://example.com/x.png'}}})});
  const bad=await evil.meta('known',{width:1,height:1}),into=createChromeStore();
  assert.throws(()=>into.put(bad.key,0,1,evil.chunk(bad.key,0).data),{code:'CHROME_INVALID'});
});

test('the device page gets the body once it has arrived, and the worker says what is still wanted',async t=>{
  const upstream=http.createServer((req,res)=>{res.writeHead(200);res.write('x');});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const viewer=createRemoteViewer();
  t.after(async()=>{await viewer.close();upstream.close();upstream.closeAllConnections();});
  const open=()=>viewer.open({rotation:3,id:'SIM-1',url:`http://127.0.0.1:${upstream.address().port}/${'a'.repeat(64)}`,name:'iPhone Air',platform:'ios',manage:true});
  const first=await open(),page=new URL(first.url),token=page.hash.split('.')[1];
  const status=await fetch(page.origin+'/control-api',{method:'POST',headers:{Origin:page.origin,'X-Cindy-Clipboard':token},body:JSON.stringify({action:'status',udid:'SIM-1'})});
  assert.equal((await status.json()).device.rotation,3);
  assert.equal(first.chromeWanted,undefined);
  const definition=async(w,h,rotation)=>(await fetch(`${page.origin}/simulators/SIM-1/definition.json?cindyViewer=${token}&w=${w}&h=${h}${rotation===undefined?'':'&rotation='+rotation}`)).json();
  // Not here yet: the page keeps its plain body, and the next round is told what to fetch.
  assert.deepEqual(await definition(1260,2736),{deviceScreen:{width:1260,height:2736}});
  assert.deepEqual((await open()).chromeWanted,{width:1260,height:2736});
  const source=createChromeSource({definition:async()=>body()}),meta=await source.meta('x',{width:1260,height:2736});
  const where={id:'SIM-1',width:1260,height:2736};
  assert.deepEqual(viewer.chrome({...where,key:meta.key}),{have:false});
  for(let i=0;i<meta.chunks;i++)assert.equal(viewer.chrome({...where,key:meta.key,index:i,total:meta.chunks,data:source.chunk(meta.key,i).data}).have,i===meta.chunks-1);
  const got=await definition(1260,2736);
  assert.deepEqual(got.screen.rect,{x:27,y:18,width:438,height:954});assert.match(got.screen.bezelImage.rest,/^data:image\/png;base64,/);
  assert.equal((await open()).chromeWanted,undefined);
  // The same model seen again needs no second transfer; turned, it is a different body.
  assert.deepEqual(viewer.chrome({...where,key:meta.key}),{have:true});
  assert.deepEqual(await definition(2736,1260),{deviceScreen:{width:2736,height:1260}});
  assert.deepEqual((await open()).chromeWanted,{width:2736,height:1260});
  assert.deepEqual(await definition(1260,2736,2),{deviceScreen:{width:1260,height:2736,rotation:2}});
  assert.deepEqual((await open()).chromeWanted,{width:1260,height:2736,rotation:2});
  viewer.chrome({id:'SIM-1',width:1260,height:2736,rotation:2,key:meta.key});
  assert.ok((await definition(1260,2736,2)).screen);
  // The old width/height-only cache entry remains distinct from a known pose.
  assert.ok((await definition(1260,2736)).screen);
  // That computer has none for it: asked no more.
  viewer.chrome({id:'SIM-1',width:2736,height:1260,none:true});
  assert.deepEqual(await definition(2736,1260),{deviceScreen:{width:2736,height:1260}});assert.equal((await open()).chromeWanted,undefined);
  assert.equal((await fetch(`${page.origin}/simulators/SIM-1/definition.json?cindyViewer=wrong&w=1&h=1`)).status,403);
  assert.equal((await fetch(`${page.origin}/simulators/SIM-1/definition.json?cindyViewer=${token}&w=0&h=1`)).status,400);
  assert.equal((await fetch(`${page.origin}/bezel.js`)).status,200);
  assert.throws(()=>viewer.chrome({id:'OTHER',width:1,height:1,none:true}),{code:'INVALID_ARGUMENT'});
});
