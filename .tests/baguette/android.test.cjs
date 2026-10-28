'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http2=require('node:http2');
const A=path.resolve('baguette-simulator/node/android');
const {PNG}=require('../../baguette-simulator/vendor/android/deps.cjs');
const {host,repository,packageArchive,createSdk,extract}=require(path.join(A,'sdk.cjs'));
const {rpc,schema}=require(path.join(A,'grpc.cjs'));
const M=require('../../baguette-simulator/node/control-model.js');
const id='00000000-0000-4000-8000-000000000001';
async function temp(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cindy-android-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function catalog(){return {license:[{'@_id':'license','#text':'SDK terms'}],remotePackage:[{'@_path':'emulator',channelRef:{'@_ref':'channel-0'},'display-name':'Emulator','uses-license':{'@_ref':'license'},archives:{archive:[['macosx','aarch64'],['macosx','x64'],['windows','x64'],['linux','x64']].map(([os,arch])=>({'host-os':os,'host-arch':arch,complete:{url:`emulator-${os}-${arch}.zip`,size:'100',checksum:{'@_type':'sha256','#text':'a'.repeat(64)}}}))}}]};}
test('Android downloads select stable archives for each supported host and require a license',()=>{
  for(const [platform,arch]of [['darwin','arm64'],['darwin','x64'],['win32','x64'],['linux','x64']]){
    const target=host(platform,arch),p=packageArchive(catalog(),'emulator','https://dl.google.com/android/repository/',target);assert.ok(p.url.includes(target.arch));assert.equal(p.license.text,'SDK terms');
  }
  assert.throws(()=>host('linux','arm64'),e=>e.code==='ANDROID_HOST_UNSUPPORTED');
  const noLicense=catalog();noLicense.license=[];assert.throws(()=>packageArchive(noLicense,'emulator','https://dl.google.com/android/repository/'),e=>e.code==='SDK_LICENSE_MISSING');
});
test('Android catalog rejects external URLs, bad checksums and XML entities',()=>{
  for(const change of [{url:'https://example.test/payload.zip'},{checksum:'bad'},{size:'-1'}]){
    const c=catalog();for(const archive of c.remotePackage[0].archives.archive)Object.assign(archive.complete,change);
    assert.throws(()=>packageArchive(c,'emulator','https://dl.google.com/android/repository/'));
  }
  assert.throws(()=>repository('<!DOCTYPE a><root/>'),e=>e.code==='SDK_CATALOG_INVALID');
});
test('SDK discovery reuses tools and images without downloads on Windows, Linux and Mac',async t=>{
  const root=await temp(t),sdkRoot=path.join(root,'existing'),image=path.join(sdkRoot,'system-images/android-36/google_apis/x86_64');
  for(const name of ['emulator/emulator','emulator/emulator.exe','platform-tools/adb','platform-tools/adb.exe','system-images/android-36/google_apis/x86_64/system.img']){const f=path.join(sdkRoot,name);await fs.mkdir(path.dirname(f),{recursive:true});await fs.writeFile(f,'');}
  for(const platform of ['darwin','win32','linux']){const sdk=createSdk(path.join(root,platform),{platform,arch:'x64',env:{ANDROID_HOME:sdkRoot},home:root});const actual=await sdk.inspect();assert.equal(actual.ready,true);assert.equal(actual.images[0].directory,image);assert.equal((await sdk.plan()).packages.length,0);await assert.rejects(sdk.install({planId:'invented',acceptLicenses:true}),e=>e.code==='SDK_CONFIRM_REQUIRED');}
});
test('mixed catalogs never offer Android models against iOS runtimes',()=>{
  const catalog={deviceTypes:[{identifier:'android:phone',platform:'android',name:'Android Phone'},{identifier:'iphone',platform:'ios',name:'iPhone'}],runtimes:[{identifier:'ios',platform:'ios',version:'27'},{identifier:'android',platform:'android',version:'36'}]};
  assert.deepEqual(M.runtimesFor(catalog,'android:phone').map(r=>r.identifier),['android']);assert.deepEqual(M.runtimesFor(catalog,'iphone').map(r=>r.identifier),['ios']);
});
test('Android press dispatches the complete shared contract and rejects iOS-only buttons before input',async t=>{
  const inputs=[],commands=[],endpoint=await emulator(t,(s,h,body)=>{
    const method=h[':path'].split('/').at(-1);
    if(method==='getPhysicalModel')return send(s,'PhysicalModelValue',{target:1,value:{data:[0,0,0]}});
    if(method==='getSensor')return send(s,'SensorValue',{target:0,value:{data:[0,9.81,0]}});
    inputs.push(method==='sendKey'?schema.lookupType('KeyboardEvent').decode(body.subarray(5)).key:method);send(s,'Empty',{});
  });
  const agent=require(path.join(A,'agent.cjs')).createAgent({root:await temp(t),devices:{adb:async(d,args)=>commands.push(args)}});
  const manifest=JSON.parse(await fs.readFile('baguette-simulator/ghost.json','utf8'));
  const buttons=manifest.tools.find(t=>t.name==='press').parameters.properties.button.enum;
  for(const button of ['up','down','left','right','select','menu','play-pause','digital-crown','back','shake'])assert.ok(buttons.includes(button),`retained Apple/Android button: ${button}`);
  const keys={home:'GoHome',back:'GoBack',lock:'Power',power:'Power','volume-up':'AudioVolumeUp','volume-down':'AudioVolumeDown','app-switcher':'AppSwitch','swipe-to-app-switcher':'AppSwitch','swipe-to-home':'GoHome'};
  for(const button of [...buttons,'invalid']){
    inputs.length=commands.length=0;
    if(!keys[button]&&!['shake','release-input','pull-down-to-notification-center'].includes(button)){
      await assert.rejects(agent.press({udid:id,endpoint},{button}),e=>e.code==='INVALID_ARGUMENT'&&e.execution==='not_executed');
      assert.equal(inputs.length+commands.length,0);continue;
    }
    assert.equal((await agent.press({udid:id,endpoint},{button})).execution,'executed');
    if(keys[button])assert.deepEqual(inputs,[keys[button]]);
    else if(button==='pull-down-to-notification-center')assert.deepEqual(commands,[['shell','cmd','statusbar','expand-notifications']]);
    else if(button==='release-input')assert.deepEqual(inputs,['sendTouch','Control','Shift','Alt','Meta']);
    else {assert.equal(button,'shake');assert.deepEqual(inputs,[...Array(7).fill('setSensor'),'setPhysicalModel']);}
  }
  for(const locale of ['zh-CN','en','ja','ko']){
    const d=JSON.parse(await fs.readFile(`baguette-simulator/locales/${locale}.json`,'utf8')).tools.press.description;
    assert.match(d,/iOS/);assert.match(d,/Android|安卓/);
    for(const button of buttons)assert.ok(d.includes(button),`${locale}: ${button}`);
  }
});
async function emulator(t,handler){
  const server=http2.createServer(),sessions=new Set();server.on('session',s=>{sessions.add(s);s.on('close',()=>sessions.delete(s));});
  server.on('stream',async(stream,headers)=>{assert.equal(headers.authorization,'Bearer test-capability');stream.on('error',()=>{});let chunks=[];for await(const chunk of stream)chunks.push(chunk);await handler(stream,headers,Buffer.concat(chunks));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of sessions)s.destroy();await new Promise(r=>server.close(r));});return {port:server.address().port,token:'test-capability'};
}
function send(stream,type,value,{status='0',fragment=false}={}){
  const payload=Buffer.from(schema.lookupType(type).encode(value).finish()),header=Buffer.alloc(5);header.writeUInt32BE(payload.length,1);const all=Buffer.concat([header,payload]);
  stream.respond({':status':200,'content-type':'application/grpc'},{waitForTrailers:true});stream.on('wantTrailers',()=>stream.sendTrailers({'grpc-status':status}));
  if(fragment){stream.write(all.subarray(0,2));stream.write(all.subarray(2,7));stream.end(all.subarray(7));}else stream.end(all);
}
test('gRPC authenticates, reassembles fragmented frames and rejects failed mutation results',async t=>{
  const endpoint=await emulator(t,(s,h)=>send(s,'ClipData',{text:'你好 Android'},{fragment:true}));assert.equal((await rpc(endpoint,'getClipboard')).text,'你好 Android');
  const rejected=await emulator(t,(s,h)=>send(s,'Empty',{}, {status:'7'}));await assert.rejects(rpc(rejected,'sendKey',{key:'Enter',eventType:2}),e=>e.execution==='unknown');
});
test('gRPC cancellation closes a live stream promptly',async t=>{
  const endpoint=await emulator(t,s=>s.respond({':status':200,'content-type':'application/grpc'}));const abort=new AbortController();const promise=rpc(endpoint,'streamScreenshot',{}, {signal:abort.signal});abort.abort();await assert.rejects(promise,/cancelled/);
});
function image(){const png=new PNG({width:108,height:240});png.data.fill(255);return PNG.sync.write(png);}
test('Android touch failures release all fingers and retain unknown execution',async t=>{
  const sent=[],endpoint=await emulator(t,(s,h,body)=>{
    const method=h[':path'].split('/').at(-1);
    if(method==='getScreenshot')return send(s,'Image',{format:{width:108,height:240,rotation:{rotation:0}},image:image()});
    const touch=schema.lookupType('TouchEvent').decode(body.subarray(5));sent.push(touch.touches);send(s,'Empty',{}, {status:sent.length===2?'13':'0'});
  });
  const root=await temp(t),agent=require(path.join(A,'agent.cjs')).createAgent({root,devices:{adb:async()=>({stdout:"Viewport INTERNAL: displayId=0, orientation=0, logicalFrame=[0, 0, 108, 240]"})},run:()=>{}});
  await assert.rejects(agent.gesture({udid:id,model:{density:160,width:108,height:240},endpoint},{kind:'swipe',from:[20,20],to:[40,40],duration:0.03,observe:'none'}),e=>e.execution==='unknown');
  assert.equal(sent.at(-1).length,10);assert.ok(sent.at(-1).every(t=>t.pressure===0));
});
test('Android screenshot crops in view points and never exposes emulator credentials',async t=>{
  const endpoint=await emulator(t,s=>send(s,'Image',{format:{width:108,height:240,rotation:{rotation:0}},image:image()}));
  const root=await temp(t),agent=require(path.join(A,'agent.cjs')).createAgent({root,devices:{adb:async()=>({stdout:"Viewport INTERNAL: displayId=0, orientation=0, logicalFrame=[0, 0, 108, 240]"})},run:()=>{}}),result=await agent.screenshot({udid:id,name:'Test',model:{density:160},endpoint},{region:{x:10,y:20,width:40,height:50},scale:2,_inline:true});
  assert.deepEqual(result.pixels,{width:80,height:100});assert.ok(result._modelImages[0].data);assert.ok(!JSON.stringify(result).includes(endpoint.token));
});
test('private Android devices reject foreign IDs, validate model/runtime and preserve unique names',async t=>{
  const root=await temp(t),sdk={inspect:async()=>({ready:true,emulator:'/sdk/emulator',adb:'/sdk/adb',images:[{identifier:'android:test',directory:'/sdk/image',version:'36',abi:'x86_64'}]})};
  const devices=require(path.join(A,'devices.cjs')).createDevices({root,sdk,run:()=>{throw Error('No process should run');},children:new Set()});
  assert.equal(await devices.owns(id),false);await assert.rejects(devices.target({udid:id}),e=>e.code==='DEVICE_NOT_OWNED');await assert.rejects(devices.create({name:'Bad',deviceType:'iphone',runtime:'android:test'}),e=>e.code==='INVALID_ARGUMENT');
  const one=await devices.create({name:'Android',deviceType:'android:phone',runtime:'android:test'}),two=await devices.create({name:'Android',deviceType:'android:phone',runtime:'android:test'});
  assert.equal(one.name,'Android');assert.equal(two.name,'Android 2');assert.equal(await devices.owns(one.udid),true);assert.equal((await devices.devices()).length,2);
});
test('Android viewer requires capability, origin and a plugin-owned opened device',async t=>{
  const root=await temp(t),d={udid:id,endpoint:{port:1,token:'private'},model:{density:160,width:108,height:240}};
  const viewer=require(path.join(A,'viewer.cjs')).createViewer({root,devices:{target:async p=>{assert.equal(p.udid,id);return d;}},agent:{}});t.after(()=>viewer.close());
  viewer.configure({status:async()=>({devices:[{udid:id,state:'Booted'}]}),assertEnabled:async()=>{},touch:()=>{}});
  const opened=await viewer.open(id,'en'),url=new URL(opened.url),token=new URLSearchParams(url.hash.slice(1)).get('cindyClipboard').split('.')[1];
  const post=(headers,body)=>fetch(url.origin+'/control-api',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await post({Origin:url.origin},{action:'status',udid:id})).status,403);
  assert.equal((await post({Origin:'https://example.test','X-Cindy-Clipboard':token},{action:'status',udid:id})).status,403);
  const good=await post({Origin:url.origin,'X-Cindy-Clipboard':token},{action:'status',udid:id});assert.equal(good.status,200);assert.equal((await good.json()).device.udid,id);
  assert.equal((await post({Origin:url.origin,'X-Cindy-Clipboard':token},{action:'status',udid:'foreign'})).status,404);
});
test('Android touch coordinates match all four display rotations',()=>{
  const {toNative}=require(path.join(A,'geometry.cjs')),model={width:1080,height:2400};
  assert.deepEqual(toNative(model,0,200,300),{x:200,y:300});
  assert.deepEqual(toNative(model,1,1200,637),{x:442,y:1200});
  assert.deepEqual(toNative(model,2,200,300),{x:879,y:2099});
  assert.deepEqual(toNative(model,3,1200,637),{x:637,y:1199});
});
test('Android pixel rotation preserves asymmetric content in every direction',()=>{
  const {rotateImage}=require(path.join(A,'geometry.cjs'));
  const image={width:2,height:3,data:Buffer.from([1,2,3,4,5,6].flatMap(n=>[n,0,0,255]))};
  for(const [turns,width,height,expected]of [[0,2,3,[1,2,3,4,5,6]],[1,3,2,[5,3,1,6,4,2]],[2,2,3,[6,5,4,3,2,1]],[3,3,2,[2,4,6,1,3,5]]]){
    const out=rotateImage(image,turns);assert.equal(out.width,width);assert.equal(out.height,height);assert.deepEqual([...out.data].filter((_,i)=>i%4===0),expected);
  }
});
test('Android orientation uses the primary display and refuses missing display metadata',async()=>{
  const {displayRotation}=require(path.join(A,'geometry.cjs'));
  assert.equal(await displayRotation({adb:async()=>({stdout:'Viewport INTERNAL: displayId=1, orientation=2\nViewport INTERNAL: displayId=0, orientation=1, logicalFrame=[]'})},{}),1);
  await assert.rejects(displayRotation({adb:async()=>({stdout:'SurfaceOrientation: 2'})},{}),e=>e.code==='SCREEN_UNAVAILABLE');
});
test('Android screenshots follow the locked display even when the sensor is upside down',async t=>{
  const png=new PNG({width:2,height:3});png.data=Buffer.from([6,5,4,3,2,1].flatMap(n=>[n,0,0,255]));
  const endpoint=await emulator(t,s=>send(s,'Image',{format:{width:2,height:3,rotation:{rotation:2}},image:PNG.sync.write(png)}));
  const agent=require(path.join(A,'agent.cjs')).createAgent({root:await temp(t),devices:{adb:async()=>({stdout:'Viewport INTERNAL: displayId=0, orientation=0'})}});
  const f=await agent.frame({endpoint,model:{density:160,width:2,height:3}});
  assert.equal(f.screen.rotation,0);assert.equal(f.screen.orientation,'portrait');
  assert.deepEqual([...PNG.sync.read(f.bytes).data].filter((_,i)=>i%4===0),[1,2,3,4,5,6]);
});
test('Android screenshots reject a display change during capture',async t=>{
  const endpoint=await emulator(t,s=>send(s,'Image',{format:{width:108,height:240},image:image()}));let reads=0;
  const agent=require(path.join(A,'agent.cjs')).createAgent({root:await temp(t),devices:{adb:async()=>({stdout:'Viewport INTERNAL: displayId=0, orientation='+reads++})}});
  await assert.rejects(agent.frame({endpoint,model:{density:160}}),e=>e.code==='SCREEN_CHANGED'&&e.execution==='not_executed');
});
test('Android viewer rejects stale rotated touches and maps current display coordinates',async t=>{
  const touches=[],endpoint=await emulator(t,(s,h,body)=>{touches.push(schema.lookupType('TouchEvent').decode(body.subarray(5)).touches);send(s,'Empty',{});});
  let orientationReads=0;
  const d={udid:id,endpoint,model:{width:1080,height:2400}},viewer=require(path.join(A,'viewer.cjs')).createViewer({root:await temp(t),devices:{target:async()=>d},agent:{displayRotation:async()=>{orientationReads++;return 0;}}});t.after(()=>viewer.close());
  viewer.configure({assertEnabled:async()=>{},touch:()=>{},exclusive:fn=>fn()});
  const u=new URL((await viewer.open(id,'en')).url),token=new URLSearchParams(u.hash.slice(1)).get('cindyClipboard').split('.')[1];
  const post=(rotation,start=true,pressure=1024,deviceRotation=rotation)=>fetch(u.origin+'/android-input',{method:'POST',headers:{Origin:u.origin,'Content-Type':'application/json','X-Cindy-Clipboard':token},body:JSON.stringify({udid:id,action:'touch',rotation,deviceRotation,start,touches:[{identifier:0,pressure,x:0.25,y:0.1}]})});
  const stale=await post(2);assert.equal(stale.status,409);assert.equal((await stale.json()).errorCode,'SCREEN_CHANGED');assert.equal(touches.length,0);
  assert.equal((await post(0)).status,200);assert.equal(touches[0][0].x,270);assert.equal(touches[0][0].y,240);
  assert.equal((await post(0,false)).status,200);assert.equal((await post(0,false,0)).status,200);assert.equal(orientationReads,2,'move and release must not wait for another Android shell command');assert.equal(touches.at(-1)[0].pressure,0);
  for(const [pose,x,y]of [[1,971,600],[2,809,2159],[3,108,1799]]){
    assert.equal((await post(0,true,1024,pose)).status,200);
    assert.equal(touches.at(-1)[0].x,x);assert.equal(touches.at(-1)[0].y,y);
  }
  assert.equal((await post(0,true,1024,4)).status,409);
  assert.equal((await post(4,false)).status,409);
});
function storedZip(entries){
  const local=[],central=[];let offset=0;
  for(const [name,value,mode=0o100644]of entries){
    const filename=Buffer.from(name),data=Buffer.from(value);let crc=0xffffffff;
    for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt32LE(crc,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(filename.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE((mode*65536)>>>0,38);c.writeUInt32LE(offset,42);
    local.push(l,filename,data);central.push(c,filename);offset+=l.length+filename.length+data.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(Buffer.concat(central).length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,...central,end]);
}
test('SDK extraction rejects traversal, external links and duplicate file replacement',async t=>{
  const root=await temp(t);
  for(const [i,entries]of [[['../escape','bad']],[['safe/link','../../escape',0o120777]],[['same','one'],['same','two']]].entries()){
    const archive=path.join(root,i+'.zip');await fs.writeFile(archive,storedZip(entries));await assert.rejects(extract(archive,path.join(root,'out'+i)));
  }
  const archive=path.join(root,'good.zip');await fs.writeFile(archive,storedZip([['bin/tool','tool',0o100755]]));await extract(archive,path.join(root,'good'));assert.equal(await fs.readFile(path.join(root,'good/bin/tool'),'utf8'),'tool');
});
test('SDK installation requires exact consent, verifies bytes and installs only its own directory',async t=>{
  const root=await temp(t),existing=path.join(root,'existing');
  for(const name of ['emulator/emulator','platform-tools/adb']){await fs.mkdir(path.dirname(path.join(existing,name)),{recursive:true});await fs.writeFile(path.join(existing,name),'existing');}
  const bytes=storedZip([['x86_64/system.img','test image']]),hash=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const xml=`<repository><license id="sdk-license">Test license</license><remotePackage path="system-images;android-36;google_apis;x86_64"><channelRef ref="channel-0"/><display-name>Test image</display-name><uses-license ref="sdk-license"/><archives><archive><complete><url>test-image.zip</url><size>${bytes.length}</size><checksum type="sha256">${hash}</checksum></complete></archive></archives></remotePackage></repository>`;
  t.mock.method(globalThis,'fetch',async url=>new Response(String(url).endsWith('.xml')?xml:bytes));
  const sdk=createSdk(path.join(root,'private'),{platform:'linux',arch:'x64',home:root,env:{ANDROID_HOME:existing}}),plan=await sdk.plan();
  const downloads=path.join(root,'private/downloads'),old=path.join(downloads,'interrupted'),recent=path.join(downloads,'recent'),external=path.join(root,'keep');
  await fs.mkdir(old,{recursive:true});await fs.mkdir(recent);await fs.mkdir(external);await fs.writeFile(path.join(old,'download.zip'),'old interrupted bytes');await fs.writeFile(path.join(recent,'download.zip'),'recent bytes');await fs.writeFile(path.join(external,'sentinel'),'keep');
  const link=path.join(downloads,'old-link');await fs.symlink(external,link);const past=new Date(Date.now()-2*86400000);await fs.utimes(old,past,past);await fs.lutimes(link,past,past);
  await assert.rejects(sdk.install({planId:plan.id,acceptLicenses:false}),e=>e.code==='SDK_CONFIRM_REQUIRED');
  assert.ok(await fs.stat(old),'no cleanup before installation consent');
  const started=await sdk.install({planId:plan.id,acceptLicenses:true});await assert.rejects(sdk.install({planId:plan.id,acceptLicenses:true}),e=>e.code==='SDK_INSTALL_RUNNING');
  await sdk.pending();assert.equal(sdk.status().state,'done');assert.equal((await sdk.inspect()).ready,true);
  for(const removed of [old,link,path.join(downloads,started.id)])await assert.rejects(fs.lstat(removed),e=>e.code==='ENOENT');
  assert.equal(await fs.readFile(path.join(recent,'download.zip'),'utf8'),'recent bytes');assert.equal(await fs.readFile(path.join(external,'sentinel'),'utf8'),'keep');
  assert.equal(await fs.readFile(path.join(existing,'emulator/emulator'),'utf8'),'existing');assert.equal(await fs.readFile(path.join(root,'private/sdk/system-images/android-36/google_apis/x86_64/system.img'),'utf8'),'test image');
});
test('Android screenshot rejects iOS-only masks before reading and preserves raw rectangle pixels',async t=>{
  let reads=0;const png=new PNG({width:8,height:12});png.data.fill(255);
  const endpoint=await emulator(t,(s,h)=>{reads++;assert.ok(h[':path'].endsWith('/getScreenshot'));send(s,'Image',{format:{width:8,height:12},image:PNG.sync.write(png)});});
  const agent=require(path.join(A,'agent.cjs')).createAgent({root:await temp(t),devices:{adb:async()=>{reads++;return {stdout:'Viewport INTERNAL: displayId=0, orientation=0'};}}});
  const d={udid:id,name:'Fixture',endpoint,model:{width:8,height:12,density:160}};
  await assert.rejects(agent.screenshot(d,{corners:true}),e=>e.code==='INVALID_ARGUMENT'&&e.execution==='not_executed');assert.equal(reads,0);
  for(const corners of [undefined,false]){
    const result=await agent.screenshot(d,{corners,format:'png'}),actual=PNG.sync.read(await fs.readFile(result.path));
    assert.equal(actual.width,8);assert.equal(actual.height,12);assert.deepEqual(actual.data,png.data);assert.match(result.note,/without an added corner or cutout mask/);
  }
});

test('Android location clear is rejected before all batch mutations while coordinates enable GPS',async()=>{
  const calls=[],state=require(path.join(A,'state.cjs')).createState({devices:{adb:async(d,args)=>calls.push(args)},agent:{frame:async()=>({screen:{}})}});
  await assert.rejects(state({udid:id},{appearance:'dark',orientation:'portrait',network:'clear',location:'clear'}),e=>e.code==='INVALID_ARGUMENT'&&e.execution==='not_executed');assert.equal(calls.length,0);
  const result=await state({udid:id},{location:{lat:25,lon:121}});assert.equal(result.execution,'executed');assert.deepEqual(result.applied,['location']);
  assert.deepEqual(calls,[['shell','cmd','location','set-location-enabled','true'],['emu','geo','fix','121','25']]);
});
test('APK binary manifest parser rejects truncated and invalid chunks without executing content',()=>{
  const {manifest,packageId}=require(path.join(A,'apps.cjs'));
  for(const buffer of [Buffer.alloc(0),Buffer.from([3,0,8,0,0,0,0,0,1]),Buffer.from([3,0,8,0,16,0,0,0,1,0,20,0,8,0,0,0])])assert.throws(()=>manifest(buffer),e=>e.code==='INVALID_APK');
  for(const value of ['com.test;echo bad','../app','com.test\n'])assert.throws(()=>packageId(value));
});
test('capture retains a completed action when the final observation fails',async t=>{
  const endpoint=await emulator(t,s=>send(s,'Image',{format:{width:108,height:240},image:image()})),root=await temp(t);let calls=0;
  const result=await require(path.join(A,'capture.cjs')).capture({d:{udid:id,endpoint,model:{width:108,height:240,density:160}},p:{seconds:0.5,action:{tool:'press'}},root,agent:{frame:async()=>{if(++calls>2)throw Object.assign(Error('Screen unavailable'),{code:'SCREEN_UNAVAILABLE'});return {screen:{width:108,height:240}};}},perform:async()=>({execution:'executed'})});
  assert.equal(result.execution,'executed');assert.equal(result.captureError.code,'SCREEN_UNAVAILABLE');assert.equal(result.sheet,undefined);
});
test('Android viewer rotation keeps the portrait body size and caps only a narrow-window overflow',async()=>{
  const listeners={},frame={style:{}},canvas={width:720,height:1600,getContext:()=>({}),addEventListener:()=>{}};
  const context={URLSearchParams,AbortController,location:{pathname:'/simulators/'+id,search:''},window:{Baguette:{_PinchOverlay:class{clear(){}}}},
    parent:{document:{documentElement:{lang:'en'}}},innerWidth:900,innerHeight:800,
    document:{getElementById:name=>name==='display'?canvas:name==='nativeDeviceFrame'?frame:{}},
    matchMedia:()=>({matches:false}),addEventListener:(name,fn)=>{listeners[name]=fn;},fetch:()=>new Promise(()=>{})};
  require('node:vm').runInNewContext(await fs.readFile(path.join(A,'screen.js'),'utf8'),context);
  const size=(width,height)=>{Object.assign(canvas,{width,height});listeners.resize();return [parseFloat(frame.style.width),parseFloat(frame.style.height)];};
  const portrait=size(720,1600),landscape=size(720,324);
  assert.deepEqual(landscape,[portrait[1],portrait[0]],'rotation swaps edges without growing the device');
  assert.deepEqual(size(360,800),portrait,'stream resolution must not change the rendered body size');
  context.innerWidth=360;context.innerHeight=740;
  const narrowPortrait=size(720,1600),narrowLandscape=size(720,324);
  assert.equal(narrowLandscape[0],336);assert.ok(narrowLandscape[1]<narrowPortrait[0]);
  assert.ok(narrowPortrait[0]<=336&&narrowPortrait[1]<=716);
});
test('state changes retain executed outcome when the resulting screen is unavailable',async()=>{
  const actions=[],setState=require(path.join(A,'state.cjs')).createState({devices:{adb:async(d,args)=>actions.push(args)},agent:{frame:async()=>{throw Object.assign(Error('No frame'),{code:'SCREEN_UNAVAILABLE'});}}});
  const result=await setState({udid:id},{appearance:'dark'});assert.equal(actions.length,1);assert.equal(result.execution,'executed');assert.equal(result.observationError.code,'SCREEN_UNAVAILABLE');
});
test('Android rotation changes physical pose without changing either orientation-lock setting',async t=>{
  const poses=[],commands=[],endpoint=await emulator(t,(s,h,body)=>{assert.ok(h[':path'].endsWith('/setPhysicalModel'));poses.push(schema.lookupType('PhysicalModelValue').decode(body.subarray(5)));send(s,'Empty',{});});
  const state=require(path.join(A,'state.cjs')).createState({devices:{adb:async(d,args)=>commands.push(args)},agent:{frame:async()=>({screen:{rotation:0}})}});
  for(const locked of [0,1]){
    const before=commands.length;
    for(const orientation of ['portrait','landscape-left','portrait-upside-down','landscape-right'])assert.equal((await state({endpoint},{orientation})).execution,'executed');
    assert.equal(commands.length,before,`accelerometer_rotation=${locked} must never be written`);
  }
  assert.deepEqual(poses.map(p=>p.value.data),Array(2).fill([[0,0,0],[0,0,90],[0,0,180],[0,0,270]]).flat());
  assert.ok(poses.every(p=>p.target===1&&p.interpolation===1));
  assert.deepEqual(commands,[]);
});
test('Android shake read/validation failures do not send sensor or pose restoration writes',async t=>{
 for(const mode of ['pose-rpc','sensor-rpc','pose-status','sensor-status','pose-shape','sensor-shape']){
  const calls=[],endpoint=await emulator(t,(s,h)=>{
   const name=h[':path'].split('/').at(-1);calls.push(name);assert.ok(name.startsWith('get'));
   const pose=name==='getPhysicalModel',prefix=pose?'pose':'sensor';
   send(s,pose?'PhysicalModelValue':'SensorValue',{target:pose?1:0,status:mode===prefix+'-status'?1:0,value:{data:mode===prefix+'-shape'?[0]:[0,0,1]}},{status:mode===prefix+'-rpc'?'13':'0'});
  });
  const agent=require(path.join(A,'agent.cjs')).createAgent({devices:{}});
  await assert.rejects(agent.press({endpoint},{button:'shake'}),e=>e.execution==='not_executed');
  assert.deepEqual(calls,mode==='pose-rpc'?['getPhysicalModel']:['getPhysicalModel','getSensor']);
 }
});

test('Android scroll_to retains every completed swipe across subsequent observation and input failures',async()=>{
 const vm=require('node:vm'),source=await fs.readFile(path.join(A,'agent.cjs'),'utf8');
 const cases=[...[0,1,2].flatMap(n=>['SCREEN_CHANGED','ANDROID_GRPC_FAILED','TIME_BUDGET_EXHAUSTED'].map(code=>({n,code}))),{n:1,code:'OBSERVATION_FAILED',plain:true},{n:1,code:'INPUT_FAILED',input:true},{n:2,missing:true},{n:1,success:true}];
 for(const c of cases){
  let completed=0;const writes=[];
  const rpc=async(_endpoint,method,value)=>{
   if(method==='getScreenshot'){
    if(!c.input&&!c.success&&!c.missing&&completed===c.n)throw Object.assign(Error(c.code),{code:c.code,...(!c.plain?{execution:'not_executed'}:{})});
    return {format:{width:108,height:240},image:image()};
   }
   assert.equal(method,'sendTouch');writes.push(value);
   if(c.input&&completed===c.n&&value.touches.some(t=>t.pressure))throw Object.assign(Error(c.code),{code:c.code,execution:'unknown'});
   if(value.touches.length===1&&value.touches[0].pressure===0)completed++;
   return {};
  };
  const devices={adb:async(_d,args)=>({stdout:args.includes('dumpsys')?'Viewport INTERNAL: displayId=0, orientation=0':`<?xml version="1.0"?><hierarchy rotation="0"><node bounds="[1,1][40,30]" text="Visible" resource-id="${c.success&&completed===c.n?'target':'other'}" clickable="true" enabled="true"/></hierarchy>`})};
  const context={module:{exports:{}},__dirname:A,Buffer,Date,setTimeout:fn=>{queueMicrotask(fn);},require:n=>n==='./grpc.cjs'?{rpc}:require(n.startsWith('.')?path.resolve(A,n):n)};
  vm.runInNewContext(source,context);const agent=context.module.exports.createAgent({devices});
  const action=agent.gesture({udid:id,endpoint:{},model:{width:108,height:240,density:160}},{kind:'scroll_to',id:'target',max_swipes:2,duration:.01,observe:'none'});
  if(c.success){const r=await action;assert.equal(r.execution,'executed');assert.equal(r.swipes,c.n);}
  else await assert.rejects(action,e=>{
   assert.equal(e.code,c.missing?'ELEMENT_NOT_FOUND':c.code);assert.equal(e.swipes,c.n);
   assert.equal(e.execution,c.input?'unknown':c.n?'executed':'not_executed');
   if(c.n)assert.match(e.message,new RegExp(`${c.n} swipe\\(s\\) completed`));
   return true;
  });
  assert.equal(completed,c.n);if(!c.n)assert.equal(writes.length,0);
 }
});

test('Android until gives subsequent observation twelve seconds inside the original deadline',async t=>{
  const code=await fs.readFile(path.join(A,'agent.cjs'),'utf8');
  for(const [waitMs,callDeadline] of [[0,100000],[14000,100000],[1000,5000]])await t.test(`${waitMs}/${callDeadline}`,async()=>{
    let clock=0,trees=0,observationDeadline;
    class Clock extends Date{static now(){return clock;}}
    const context={module:{exports:{}},Buffer,Date:Clock,setTimeout,require:name=>name==='./grpc.cjs'?{rpc:async(_d,method)=>{
      assert.equal(method,'getScreenshot','observation never dispatches input');return {format:{width:108,height:240},image:image()};
    }}:require(name.startsWith('.')?path.resolve(A,name):name)};
    require('node:vm').runInNewContext(code,context);
    const agent=context.module.exports.createAgent({devices:{adb:async(_d,args,options)=>{
      if(args.includes('dumpsys'))return {stdout:'Viewport INTERNAL: displayId=0, orientation=0'};
      if(++trees===1){clock+=waitMs;return {stdout:'<?xml version="1.0"?><hierarchy rotation="0"><node bounds="[1,1][40,30]" text="Ready" enabled="true"/></hierarchy>'};}
      observationDeadline=options.deadline;clock=options.deadline;
      throw Object.assign(Error('slow observation'),{code:'TIME_BUDGET_EXHAUSTED'});
    }}});
    const result=await agent.after({udid:id,endpoint:{},model:{width:108,height:240,density:160}},
      {until:'Ready',observe:'both',_deadline:callDeadline},{execution:'executed'});
    assert.equal(result.wait.met,true);assert.equal(result.execution,'executed');
    assert.equal(observationDeadline,Math.min(callDeadline,waitMs+12000));
    assert.equal(result.observationError.code,'TIME_BUDGET_EXHAUSTED');assert.equal(result.timing.observationMs,observationDeadline);
  });
});
for(const mode of ['success','first-sample','last-sample','sensor-restore','pose-restore','both-restore'])test(`Android shake restores acceleration and pose: ${mode}`,async t=>{
  const poses=[],samples=[],endpoint=await emulator(t,(s,h,body)=>{
    const name=h[':path'].split('/').at(-1);
    if(name==='getPhysicalModel')return send(s,'PhysicalModelValue',{target:1,value:{data:[0,0,90]}});
    if(name==='getSensor')return send(s,'SensorValue',{target:0,value:{data:[9.81,0,0]}});
    if(name==='setPhysicalModel'){poses.push(schema.lookupType('PhysicalModelValue').decode(body.subarray(5)));return send(s,'Empty',{}, {status:['pose-restore','both-restore'].includes(mode)?'13':'0'});}
    assert.equal(name,'setSensor');const sample=schema.lookupType('SensorValue').decode(body.subarray(5));samples.push(sample);
    const restoring=sample.value.data[0]===Math.fround(9.81),broken=restoring?['sensor-restore','both-restore'].includes(mode):(mode==='first-sample'&&samples.length===1)||(mode==='last-sample'&&samples.length===6);
    send(s,'Empty',{}, {status:broken?'13':'0'});
  });
  const agent=require(path.join(A,'agent.cjs')).createAgent({root:await temp(t),devices:{}}),action=agent.press({endpoint},{button:'shake'});
  if(mode!=='success')await assert.rejects(action,e=>e.execution==='unknown');else assert.equal((await action).execution,'executed');
  assert.equal(samples.length,mode==='first-sample'?2:7);assert.ok(samples.every(s=>s.value.data[1]===0));assert.deepEqual(samples.at(-1).value.data,[Math.fround(9.81),0,0]);
  assert.equal(poses.length,1,'pose restore is attempted even if sensor restore fails');assert.deepEqual(poses[0].value.data,[0,0,90]);assert.equal(poses[0].interpolation,1);
});

test('OCR releases its one busy owner after every settle path and ignores late replies',async t=>{
  const vm=require('node:vm'),{EventEmitter}=require('node:events'),source=await fs.readFile(path.join(A,'ocr.cjs'),'utf8');
  for(const mode of ['success','construct','resume','postMessage','reject','error','exit','timeout','terminate-throw','terminate-reject','blocked'])await t.test(mode,async()=>{
    const workers=[];let attempts=0,timer,clears=0;
    class Worker extends EventEmitter{
      constructor(){super();this.attempt=++attempts;if(mode==='construct'&&this.attempt===1)throw Error('raw startup detail');workers.push(this);
        this.stdout=this.stderr={resume:()=>{if(mode==='resume'&&this.attempt===1)throw Error('raw stream detail');}};this.stops=0;}
      postMessage(m){
        if(this.attempt===1&&m.action==='load'){
          if(mode==='postMessage')throw Error('raw postMessage detail');
          if(mode==='blocked'){this.unblock=()=>this.reply(m);return;}
          if(['error','exit','timeout','reject'].includes(mode)){queueMicrotask(()=>mode==='timeout'?timer():mode==='reject'?this.emit('message',{jobId:m.jobId,status:'reject'}):this.emit(mode,Error('raw worker detail')));return;}
        }
        queueMicrotask(()=>this.reply(m));
      }
      reply(m){this.emit('message',{jobId:'wrong-job',status:'reject'});this.emit('message',{jobId:m.jobId,status:'resolve',data:m.action==='recognize'?{tsv:'header\n5\t1\t1\t1\t1\t1\t10\t20\t30\t40\t90\tReady'}:{}});}
      terminate(){this.stops++;if(this.attempt===1){if(mode==='terminate-throw')throw Error('raw terminate detail');if(mode==='terminate-reject')return Promise.reject(Error('raw terminate detail'));}return Promise.resolve(0);}
    }
    const module={exports:{}};vm.runInNewContext(source,{module,__dirname:A,Uint8Array,require:name=>name==='node:worker_threads'?{Worker}:name==='../budget.cjs'?{commandBudget:()=>({timeout:1000})}:require(name),setTimeout:fn=>{timer=fn;return fn;},clearTimeout:()=>{clears++;}});
    const {recognize}=module.exports,first=recognize(Buffer.alloc(1),2);
    if(mode==='blocked'){await assert.rejects(recognize(Buffer.alloc(1),2),e=>e.code==='OCR_BUSY');workers[0].unblock();}
    if(['success','blocked'].includes(mode))assert.equal((await first)[0].label,'Ready');
    else await assert.rejects(first,e=>e.code==='OCR_FAILED'&&e.execution==='not_executed'&&/screenshot/i.test(e.message)&&!e.message.includes('raw'));
    assert.ok(clears>0);for(const worker of workers)assert.equal(worker.stops,1,'termination has one owner even on timeout');
    for(const worker of workers){worker.emit('message',{jobId:'1',status:'resolve',data:{}});worker.emit('error',Error('late error'));worker.emit('exit',0);}
    const next=await recognize(Buffer.alloc(1),2);assert.equal(next[0].label,'Ready');assert.deepEqual(Array.from(next[0].frame),[5,10,15,20]);
  });
});

test('state progress preserves every completed step within a partially applied field',async()=>{
  const {createState}=require(path.join(A,'state.cjs'));
  for(const profile of ['offline','wifi','clear'])for(const failAt of Array.from({length:profile==='offline'?3:5},(_,i)=>i)){
    let calls=0;const state=createState({devices:{adb:async()=>{if(calls++===failAt)throw Object.assign(Error('budget'),{code:'TIME_BUDGET_EXHAUSTED',execution:'not_executed'});}},agent:{frame:async()=>({screen:{}})}});
    const result=await state({udid:id},{network:profile,appearance:'dark'});
    // appearance is the first step; network includes two or four substeps.
    assert.equal(result.stateError.code,'TIME_BUDGET_EXHAUSTED');assert.equal(result.appliedSteps.length,failAt);
    assert.equal(result.execution,failAt?'unknown':'not_executed');
    assert.equal(result.applied.includes('network'),false);assert.equal(calls,failAt+1);
  }
  const calls=[],state=createState({devices:{adb:async(d,args)=>calls.push(args)},agent:{frame:async()=>({screen:{}})}});
  assert.deepEqual((await state({udid:id},{network:'wifi'})).applied,['network']);assert.ok(calls.some(a=>a.join(' ')==='emu network speed full'));
  calls.length=0;
  await assert.rejects(state({udid:id},{appearance:'dark',privacy:{action:'reset',service:'camera',bundleId:'test.example.app'}}),e=>e.code==='INVALID_ARGUMENT'&&e.execution==='not_executed');assert.equal(calls.length,0,'unsupported reset is rejected before any field changes');
});

test('scoped logs distinguish absent processes, exact matches and query failures',async()=>{
  const create=adb=>require(path.join(A,'agent.cjs')).createAgent({devices:{adb}}),d={udid:id};
  for(const code of ['DEVICE_NOT_OWNED','COMMAND_FAILED','TIME_BUDGET_EXHAUSTED']){
    const agent=create(async()=>{throw Object.assign(Error('query failed'),{code});});
    await assert.rejects(agent.logs(d,{process:'test.example.app'}),e=>e.code===code);
    if(code!=='TIME_BUDGET_EXHAUSTED')await assert.rejects(agent.waitFor(d,{log:'ready',process:'test.example.app',timeout:.1}),e=>e.code===code);
  }
  let reads=0;
  const absent=await create(async()=>{reads++;return {stdout:'PID NAME\n1 init\n8 test.example.app.other'};}).logs(d,{process:'test.example.app'});
  assert.equal(absent.lines.length,0);assert.equal(absent.processRunning,false);assert.match(absent.note,/not checked/);assert.match(absent.note,/do not establish/);assert.equal(reads,1,'absence never widens scope to device logs');
  let scope;
  const result=await create(async(d,args)=>{if(args.includes('ps'))return {stdout:'PID NAME\n7 test.example.app\n8 test.example.app.other'};scope=args;return {stdout:Date.now()/1000+' 7 7 I test: ready'};}).logs(d,{process:'test.example.app',level:'info'});
  assert.ok(scope.includes('--pid=7'));assert.equal(result.lines.length,1);
  await assert.rejects(create(async()=>({stdout:''})).logs(d,{process:'test.example.app'}),e=>e.code==='PROCESS_QUERY_FAILED');
});

test('Android log defaults, explicit filters and crash buffers share one bounded query contract',async t=>{
  t.mock.method(Date,'now',()=>2000000);
  const raw=['1879 7 7 E app: outside','1880 7 7 W app: boundary','1910 7 7 E app: startup error',
    '1990 7 7 I app: ready','1995 7 7 D app: debug ready','1999 7 7 F app: fatal'].join('\n');
  const d={udid:id};
  for(const scope of [{},{process:'test.example.app'},{bundleId:'test.example.app'}])for(const crashes of [undefined,false,true]){
    let waiting=false;
    const queries=[],agent=require(path.join(A,'agent.cjs')).createAgent({devices:{adb:async(d,args)=>{
      queries.push(args);return {stdout:args.includes('ps')?'PID NAME\n7 test.example.app\n8 test.example.app.other':raw+(waiting?'\n2000 7 7 I app: ready after wait began':'')};
    }}});
    const p={...scope,...(crashes===undefined?{}:{crashes})},result=await agent.logs(d,p),query=queries.at(-1);
    assert.equal(result.lastSeconds,120);assert.equal(result.level,'default');assert.equal(result.total,3);assert.equal(result.truncated,false);
    assert.deepEqual(result.lines,[raw.split('\n')[1],raw.split('\n')[2],raw.split('\n')[5]]);
    assert.equal(query.includes('--pid=7'),!!(scope.process||scope.bundleId));assert.ok(query.includes('3000'));
    assert.deepEqual(query.filter((_,i)=>query[i-1]==='-b'),crashes===false?['main']:['main','crash']);
    assert.equal(result.crashes,undefined);assert.match(result.note,/earlier PIDs/);
    assert.deepEqual((await agent.logs(d,{...p,last_seconds:60,level:'error'})).lines,[raw.split('\n')[5]]);
    const matched=await agent.logs(d,{...p,level:'debug',match:'ready',limit:1});
    assert.equal(matched.total,2);assert.equal(matched.truncated,true);assert.deepEqual(matched.lines,[raw.split('\n')[4]]);
    waiting=true;
    assert.equal((await agent.waitFor(d,{...scope,log:'ready',timeout:.1})).goalMet,true,'log waits still include info/debug records');
  }
  const agent=require(path.join(A,'agent.cjs')).createAgent({devices:{adb:async()=>({stdout:Array(3000).fill('1999 7 7 W app: warning').join('\n')})}});
  const capped=await agent.logs(d,{});assert.equal(capped.lines.length,150);assert.equal(capped.truncated,true);
  for(const locale of ['zh-CN','en','ja','ko']){
    const desc=JSON.parse(await fs.readFile(`baguette-simulator/locales/${locale}.json`,'utf8')).tools.logs.description;
    for(const term of ['120','150','3000','PID','processRunning=false','crashes=false','Default'])assert.ok(desc.includes(term),`${locale}: ${term}`);
  }
});

test('Android log validation and transport failures cannot become empty or unscoped evidence',async()=>{
  let reads=0;
  const agent=require(path.join(A,'agent.cjs')).createAgent({devices:{adb:async()=>{reads++;throw Error('must not read');}}});
  for(const p of [{match:'['},{last_seconds:0},{limit:1001},{level:'invalid'},{process:''}]){
    await assert.rejects(agent.logs({udid:id},p),e=>e.code==='INVALID_ARGUMENT');assert.equal(reads,0);
  }
  for(const code of ['DEVICE_NOT_OWNED','COMMAND_FAILED','TIME_BUDGET_EXHAUSTED']){
    const queries=[],failed=require(path.join(A,'agent.cjs')).createAgent({devices:{adb:async(d,args)=>{
      queries.push(args);if(args.includes('ps'))return {stdout:'PID NAME\n7 test.example.app'};throw Object.assign(Error('log read failed'),{code});
    }}});
    await assert.rejects(failed.logs({udid:id},{bundleId:'test.example.app'}),e=>e.code===code);
    assert.equal(queries.length,2);assert.ok(queries[1].includes('--pid=7'));
  }
});

test('directional swipes preserve explicit starts and pan defaults to the screen center',async t=>{
  const touches=[],png=new PNG({width:400,height:800});png.data.fill(255);
  const endpoint=await emulator(t,(s,h,body)=>{const name=h[':path'].split('/').at(-1);
    if(name==='getScreenshot')return send(s,'Image',{format:{width:400,height:800},image:PNG.sync.write(png)});
    assert.equal(name,'sendTouch');touches.push(schema.lookupType('TouchEvent').decode(body.subarray(5)).touches);send(s,'Empty',{});
  });
  const agent=require(path.join(A,'agent.cjs')).createAgent({devices:{adb:async()=>({stdout:'Viewport INTERNAL: displayId=0, orientation=0'})}}),d={udid:id,endpoint,model:{width:400,height:800,density:160}};
  await agent.gesture(d,{kind:'swipe',direction:'up',from:[100,500],distance:100,duration:.01,observe:'none'});
  assert.deepEqual([touches[0][0].x,touches[0][0].y],[100,500]);assert.ok(touches.some(ts=>ts[0]?.y===400));touches.length=0;
  await agent.gesture(d,{kind:'pan',by:[0,100],duration:.01,observe:'none'});
  assert.deepEqual(touches[0].map(p=>[p.x,p.y]),[[180,400],[220,400]]);assert.ok(touches.some(ts=>ts.length===2&&ts.every(p=>p.y===500)));
});

test('capture preflight failures always retain the capture result shape without executing an action',async()=>{
  const {capture}=require(path.join(A,'capture.cjs'));let actions=0;
  for(const code of ['SCREEN_UNAVAILABLE','SCREEN_CHANGED','TIME_BUDGET_EXHAUSTED']){
    const result=await capture({d:{udid:id,model:{width:2,height:3,density:160}},p:{seconds:.5,action:{tool:'press'}},agent:{frame:async()=>{throw Object.assign(Error('preflight'),{code});}},perform:async()=>{actions++;}});
    assert.equal(result.captureError.code,code);assert.equal(result.execution,'not_executed');assert.equal(result.sheet,undefined);
  }
  assert.equal(actions,0);
});

test('contact-sheet frame bytes use locked display orientation before saving and rendering',async t=>{
  const png=new PNG({width:2,height:3});png.data=Buffer.from([1,2,3,4,5,6].flatMap(n=>[n,0,0,255]));
  for(const [rotation,sensor,expected,width,height]of [[0,2,[6,5,4,3,2,1],2,3],[1,0,[2,4,6,1,3,5],3,2]]){
    const endpoint=await emulator(t,s=>send(s,'Image',{format:{width:2,height:3,rotation:{rotation:sensor}},image:PNG.sync.write(png)})),screen={width,height,rotation},root=await temp(t);
    const result=await require(path.join(A,'capture.cjs')).capture({d:{udid:id,endpoint,model:{width:2,height:3,density:160}},p:{seconds:.5},root,agent:{frame:async()=>({screen})}});
    assert.equal(result.captureError,undefined);assert.deepEqual(result.screen,screen);const frame=PNG.sync.read(await fs.readFile(result.frames[0].path));assert.equal(frame.width,width);assert.equal(frame.height,height);
    assert.deepEqual([...frame.data].filter((_,i)=>i%4===0),expected);assert.ok((await fs.stat(result.sheet)).size>0);
  }
});

test('capture rechecks the display after its first stream frame before executing the action',async t=>{
  const endpoint=await emulator(t,s=>send(s,'Image',{format:{width:108,height:240},image:image()}));let reads=0,actions=0;
  const result=await require(path.join(A,'capture.cjs')).capture({d:{udid:id,endpoint,model:{width:108,height:240,density:160}},p:{seconds:.5,action:{tool:'press'}},root:await temp(t),agent:{frame:async()=>({screen:{rotation:reads++?1:0}})},perform:async()=>{actions++;return {execution:'executed'};}});
  assert.equal(result.captureError.code,'SCREEN_CHANGED');assert.equal(result.execution,'not_executed');assert.equal(actions,0);
});

test('every Android gesture shares the RPC dispatch boundary and skips cleanup before its first request',async t=>{
  const source=await fs.readFile(path.join(A,'agent.cjs'),'utf8'),budget=require('../../baguette-simulator/node/budget.cjs').commandBudget;
  for(const p of [{kind:'tap',x:30,y:30},{kind:'tap',x:30,y:30,count:2},{kind:'swipe',from:[20,20],to:[40,40]},{kind:'drag',from:[20,20],to:[40,40]},{kind:'edge'},{kind:'pinch',center:[50,50],from_spread:10,to_spread:20},{kind:'pan',from:[40,40],by:[10,10]}])for(const phase of ['preflight','first-send','connection','after-send','success'])await t.test(JSON.stringify(p)+' '+phase,async t=>{
    let clock=100,reads=0;const deadline=10000,events=[];t.mock.method(Date,'now',()=>clock);
    const rpc=(_d,method,value,options)=>{
      budget(1000,options.deadline,()=>clock);
      if(method==='getScreenshot')return Promise.resolve({format:{width:108,height:240,rotation:{rotation:0}},image:image()});
      assert.equal(method,'sendTouch');events.push(value.touches);
      if(events.length===1&&phase==='connection')return Promise.reject(Object.assign(Error('connection failed'),{code:'ANDROID_GRPC_FAILED',execution:'unknown'}));
      if(events.length===1&&phase==='after-send')clock=deadline;
      return Promise.resolve({});
    };
    const context={module:{exports:{}},Buffer,Date,setTimeout:(fn,ms)=>{clock+=ms;queueMicrotask(fn);},require:n=>n==='./grpc.cjs'?{rpc}:require(n.startsWith('.')?path.resolve(A,n):n)};
    require('node:vm').runInNewContext(source,context);
    const agent=context.module.exports.createAgent({devices:{adb:async()=>{
      if(phase==='preflight')throw Object.assign(Error('read budget exhausted'),{code:'TIME_BUDGET_EXHAUSTED',execution:'not_executed'});
      if(++reads===2&&phase==='first-send')clock=deadline;
      return {stdout:'Viewport INTERNAL: displayId=0, orientation=0'};
    }}});
    const action=agent.gesture({udid:id,endpoint:{},model:{width:108,height:240,density:160}},{...p,duration:.01,hold:.01,_deadline:deadline,observe:'none'});
    if(phase==='success')assert.equal((await action).execution,'executed');
    else await assert.rejects(action,e=>e.code===(phase==='connection'?'ANDROID_GRPC_FAILED':'TIME_BUDGET_EXHAUSTED')&&e.execution===(['preflight','first-send'].includes(phase)?'not_executed':'unknown'));
    if(['preflight','first-send'].includes(phase))assert.deepEqual(events,[],'no touch and no release when first RPC never started');
    else {assert.ok(events.length>=2);assert.equal(events.at(-1).length,10);assert.ok(events.at(-1).every(t=>t.pressure===0),'existing cleanup remains after a started touch');}
  });
});
test('Android hardware, release and shake distinguish preflight rejection from a started mutation',async t=>{
  const source=await fs.readFile(path.join(A,'agent.cjs'),'utf8'),budget=require('../../baguette-simulator/node/budget.cjs').commandBudget;
  for(const p of [{button:'home'},{button:'home',duration:.01},{button:'release-input'},{button:'shake'},{button:'pull-down-to-notification-center'}])for(const phase of ['preflight','first-send','connection','after-send','success'].filter(v=>v!=='after-send'||p.button!=='home'||p.duration))await t.test(JSON.stringify(p)+' '+phase,async t=>{
    let clock=100;const deadline=10000,events=[];t.mock.method(Date,'now',()=>clock);
    const rpc=(_d,method,value,options)=>{
      budget(1000,options.deadline,()=>clock);
      if(method==='getPhysicalModel'||method==='getSensor'){
        if(phase==='preflight')throw Object.assign(Error('read failed'),{code:'TIME_BUDGET_EXHAUSTED',execution:'not_executed'});
        if(method==='getSensor'&&phase==='first-send')clock=deadline;
        return Promise.resolve({status:0,value:{data:method==='getSensor'?[0,9.81,0]:[0,0,0]}});
      }
      events.push({method,value});
      if(events.length===1&&phase==='connection')return Promise.reject(Object.assign(Error('connection failed'),{code:'ANDROID_GRPC_FAILED',execution:'unknown'}));
      if(events.length===1&&phase==='after-send')clock=deadline;
      return Promise.resolve({});
    };
    const context={module:{exports:{}},Buffer,Date,setTimeout:(fn,ms)=>{clock+=ms;queueMicrotask(fn);},require:n=>n==='./grpc.cjs'?{rpc}:require(n.startsWith('.')?path.resolve(A,n):n)};
    require('node:vm').runInNewContext(source,context);const agent=context.module.exports.createAgent({devices:{adb:async()=>{
      if(['preflight','first-send'].includes(phase))throw Object.assign(Error('ADB preflight'),{code:'TIME_BUDGET_EXHAUSTED',execution:'not_executed'});
      events.push({method:'adb'});if(phase!=='success')throw Object.assign(Error('ADB unknown'),{code:'ANDROID_GRPC_FAILED',execution:'unknown'});return {};
    }}});
    if(p.button!=='shake'&&['preflight','first-send'].includes(phase))clock=deadline;
    const action=agent.press({endpoint:{}},{...p,_deadline:deadline});
    if(phase==='success')assert.equal((await action).execution,'executed');
    else await assert.rejects(action,e=>e.code===((phase==='connection'||p.button==='pull-down-to-notification-center'&&phase==='after-send')?'ANDROID_GRPC_FAILED':'TIME_BUDGET_EXHAUSTED')&&e.execution===(['preflight','first-send'].includes(phase)?'not_executed':'unknown'));
    if(['preflight','first-send'].includes(phase))assert.deepEqual(events,[],'no cleanup write after rejected first mutation');
    else if(p.duration){assert.equal(events.at(-1).value.eventType,1);assert.equal(events.at(-1).value.key,'GoHome');}
    else if(p.button==='shake'){assert.equal(events.at(-2).method,'setSensor');assert.equal(events.at(-1).method,'setPhysicalModel');}
    else assert.ok(events.length);
  });
});
test('Android text input owns dispatch evidence across preflight, first-send and later failures',async t=>{
  const source=await fs.readFile(path.join(A,'agent.cjs'),'utf8'),budget=require('../../baguette-simulator/node/budget.cjs').commandBudget;
  for(const request of [{text:'AB'},{method:'touch',text:'AB'},{method:'type',text:'AB'},{method:'paste',text:'你好'},{method:'type',clear:true},{method:'type',keys:['ctrl+shift+x']}])for(const phase of ['preflight','first-send','after-send','connection',...(request.method==='touch'?[]:['success'])])await t.test(JSON.stringify(request)+' '+phase,async t=>{
    let clock=100,writes=0;const events=[],deadline=200,screen=image();t.mock.method(Date,'now',()=>clock);
    const rpc=(_endpoint,method,value={},options={})=>{
      budget(1000,options.deadline,()=>clock);
      if(method==='getScreenshot')return Promise.resolve({format:{width:108,height:240,rotation:{rotation:0}},image:screen});
      if(method==='getClipboard')return Promise.resolve({text:request.text});
      events.push({method,...value});writes++;
      if(phase==='connection'&&writes===1)return Promise.reject(Object.assign(Error('connection closed'),{code:'ANDROID_GRPC_FAILED',execution:'unknown'}));
      if(phase==='after-send'&&writes===1)clock=deadline;
      return Promise.resolve({});
    };
    const devices={adb:async(_d,args)=>{
      if(args.includes('dumpsys')){if(phase==='preflight')clock=deadline;return {stdout:'Viewport INTERNAL: displayId=0, orientation=0'};}
      if(args.includes('uiautomator')){
        if(phase==='first-send')clock=deadline;
        const field=request.method==='touch';return {stdout:`<?xml version="1.0"?><hierarchy rotation="0"><node bounds="[1,1][40,30]" text="Visible" class="${field?'EditText':'TextView'}" focused="true" clickable="true" enabled="true"/></hierarchy>`};
      }
      budget(1000,deadline,()=>clock);events.push({method:'adb'});return {stdout:''};
    }};
    const context={module:{exports:{}},Buffer,Date,setTimeout,require:n=>n==='./grpc.cjs'?{rpc}:require(n.startsWith('.')?path.resolve(A,n):n)};
    require('node:vm').runInNewContext(source,context);const agent=context.module.exports.createAgent({devices});
    const explicit=!['auto','touch'].includes(request.method||'auto');if(explicit&&['preflight','first-send'].includes(phase))clock=deadline;
    const action=agent.typeText({udid:id,endpoint:{},model:{width:108,height:240,density:160}},{...request,_deadline:deadline,observe:'none'});
    if(phase==='success')assert.equal((await action).execution,'executed');
    else await assert.rejects(action,e=>{
      assert.equal(e.code,phase==='connection'?'ANDROID_GRPC_FAILED':'TIME_BUDGET_EXHAUSTED');
      assert.equal(e.execution,['preflight','first-send'].includes(phase)?'not_executed':'unknown');return true;
    });
    if(['preflight','first-send'].includes(phase))assert.deepEqual(events,[],'no input or cleanup before first dispatch');
    else assert.ok(events.length);
    if(request.keys&&phase==='after-send')assert.ok(!events.some(e=>e.key==='Shift'),'only actually started modifiers can be released');
  });
});
test('Android permissions resolve the guest API before every batch and preserve per-step evidence',async t=>{
  const create=require(path.join(A,'state.cjs')).createState;
  for(const api of [23,28,29,32,33,36])for(const service of ['photos','media-library','location-always','motion','camera'])for(const action of ['grant','revoke'])await t.test(api+' '+service+' '+action,async()=>{
    const writes=[],state=create({devices:{adb:async(_d,args,options)=>{
      if(args.includes('getprop')){assert.equal(options.mutation,undefined);return {stdout:String(api)};}
      writes.push(args);return {stdout:''};
    }},agent:{frame:async()=>({screen:{}})}});
    const p={appearance:'dark',privacy:{action,service,bundleId:'test.example'}};
    if(service==='motion'&&api<29){await assert.rejects(state({},p),e=>e.execution==='not_executed');assert.deepEqual(writes,[]);return;}
    const result=await state({},p);assert.equal(result.execution,'executed');assert.equal(writes[0][2],'uimode');
    const expected=service==='photos'?(api>=33?['READ_MEDIA_IMAGES','READ_MEDIA_VIDEO']:['READ_EXTERNAL_STORAGE']):service==='media-library'?[api>=33?'READ_MEDIA_AUDIO':'READ_EXTERNAL_STORAGE']:service==='location-always'?['ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION',...(api>=29?['ACCESS_BACKGROUND_LOCATION']:[])]:[service==='motion'?'ACTIVITY_RECOGNITION':'CAMERA'];
    assert.deepEqual(writes.slice(1),expected.map(name=>['shell','pm',action,'test.example','android.permission.'+name]));assert.equal(result.appliedSteps.length,1+expected.length);
  });
  for(const failure of ['22','','invalid','33junk','TIME_BUDGET_EXHAUSTED','COMMAND_FAILED'])await t.test('API preflight '+failure,async()=>{
    let writes=0;const state=create({devices:{adb:async(_d,args)=>{
      if(args.includes('getprop')){if(failure.endsWith('FAILED')||failure==='TIME_BUDGET_EXHAUSTED')throw Object.assign(Error(failure),{code:failure,execution:'not_executed'});return {stdout:failure};}
      writes++;return {stdout:''};
    }},agent:{}});
    await assert.rejects(state({},{appearance:'dark',privacy:{action:'grant',service:'photos',bundleId:'test.example'}}),e=>e.execution==='not_executed');assert.equal(writes,0);
  });
  for(const api of [32,33])for(const failAt of [0,1])await t.test('partial '+api+' '+failAt,async()=>{
    let writes=0;const state=create({devices:{adb:async(_d,args)=>{
      if(args.includes('getprop'))return {stdout:String(api)};
      if(writes++===failAt)throw Object.assign(Error('pm failed'),{code:'COMMAND_FAILED',execution:'unknown'});return {stdout:''};
    }},agent:{frame:async()=>({screen:{}})}});
    const result=await state({},{privacy:{action:'revoke',service:'photos',bundleId:'test.example'}});
    if(api===32&&failAt===1)assert.equal(result.execution,'executed');else{assert.equal(result.execution,'unknown');assert.equal(result.appliedSteps.length,failAt);assert.equal(result.stateError.step,failAt+1);}
  });
});
async function privateAndroid(t){
  const root=await temp(t),runtime='android:android-36:google_apis:arm64-v8a';
  const sdk={inspect:async()=>({ready:true,images:[{identifier:runtime,directory:path.join(root,'image'),abi:'arm64-v8a',version:'36'}]})};
  const devices=require(path.join(A,'devices.cjs')).createDevices({root,sdk,run:async()=>{throw Error('Unexpected host command');},children:new Set()});
  const created=await devices.create({name:'Lifecycle fixture',runtime,deviceType:'android:phone'}),d=await devices.target({udid:created.udid},false);
  await fs.writeFile(path.join(d.directory,'one.img'),'one');await fs.writeFile(path.join(d.directory,'two.img'),'two');
  return {root,devices,d};
}
test('Android discovery never turns unreadable runtime evidence into a stopped device',async t=>{
  for(const source of ['directory','record','pid','connection'])for(const code of source==='connection'?['DEVICE_DISCOVERY_UNCONFIRMED']:source==='pid'?['EPERM']:['EACCES','EIO','ENOTDIR'])await t.test(source+' '+code,async t=>{
    const {devices,d}=await privateAndroid(t),name='pid_'+process.pid+'.ini',list=fs.readdir,read=fs.readFile,kill=process.kill;
    const error=()=>Object.assign(Error('discovery unreadable'),{code});
    t.mock.method(fs,'readdir',async(dir,...args)=>{
      if(String(dir).endsWith(path.join('avd','running'))){if(source==='directory')throw error();return [name];}
      return list(dir,...args);
    });
    t.mock.method(fs,'readFile',async(file,...args)=>{
      if(path.basename(String(file))!==name)return read(file,...args);
      if(source==='record')throw error();
      return `avd.id=${d.avdName}\navd.dir=${d.directory}\ngrpc.port=${source==='connection'?0:12345}\ngrpc.token=test-capability\nport.serial=5554\n`;
    });
    t.mock.method(process,'kill',(pid,signal)=>{if(source==='pid'&&pid===process.pid&&signal===0)throw error();return kill(pid,signal);});
    const rejected=e=>e.code===code&&(e.execution===undefined||e.execution==='not_executed');
    for(const operation of [()=>devices.devices(),()=>devices.boot({udid:d.udid}),()=>devices.shutdown({udid:d.udid}),...['delete_device','erase_device'].map(method=>()=>devices.manage(method,{udid:d.udid}))])await assert.rejects(operation(),rejected);
    assert.equal(await fs.readFile(path.join(d.directory,'one.img'),'utf8'),'one');assert.equal(await devices.owns(d.udid),true);
  });
});
test('Android discovery tolerates only real absence and rejects unreadable post-shutdown evidence',async t=>{
  for(const phase of ['missing-directory','missing-record','dead-pid','after-shutdown'])await t.test(phase,async t=>{
    const {devices,d}=await privateAndroid(t),list=fs.readdir,read=fs.readFile,kill=process.kill,name='pid_'+process.pid+'.ini';let stopped=false;
    const endpoint=await emulator(t,s=>{stopped=true;send(s,'Empty',{});});
    t.mock.method(fs,'readdir',async(dir,...args)=>{
      if(String(dir).endsWith(path.join('avd','running'))){
        if(phase==='missing-directory'||stopped)throw Object.assign(Error('discovery '+phase),{code:stopped?'EACCES':'ENOENT'});
        return [name];
      }
      return list(dir,...args);
    });
    t.mock.method(fs,'readFile',async(file,...args)=>{
      if(path.basename(String(file))!==name)return read(file,...args);
      if(phase==='missing-record')throw Object.assign(Error('record gone'),{code:'ENOENT'});
      return `avd.id=${d.avdName}\navd.dir=${d.directory}\ngrpc.port=${endpoint.port}\ngrpc.token=test-capability\nport.serial=5554\n`;
    });
    t.mock.method(process,'kill',(pid,signal)=>{if(phase==='dead-pid'&&pid===process.pid&&signal===0)throw Object.assign(Error('pid gone'),{code:'ESRCH'});return kill(pid,signal);});
    if(phase==='after-shutdown'){
      const result=await devices.manage('delete_device',{udid:d.udid});assert.equal(stopped,true);assert.equal(result.execution,'unknown');assert.equal(result.deviceError.code,'EACCES');assert.deepEqual(result.completedSteps,[]);assert.equal(await devices.owns(d.udid),true);
      assert.equal(await fs.readFile(path.join(d.directory,'one.img'),'utf8'),'one');
    }else {assert.equal((await devices.devices())[0].state,'Shutdown');assert.equal((await devices.shutdown({udid:d.udid})).execution,'not_executed');}
  });
});
test('unreadable private Android inventory makes every stop-all entry incomplete',async t=>{
  const {createRuntime}=require('../../baguette-simulator/node/runtime.cjs');
  for(const entry of ['manual','disable','idle','exit'])for(const phase of ['before','after'])await t.test(entry+' '+phase,async t=>{
    const {root,devices}=await privateAndroid(t),list=fs.readdir;let reads=0,clock=0;
    t.mock.method(fs,'readdir',async(dir,...args)=>{
      if(String(dir)===path.join(root,'avd')&&++reads>=(phase==='before'?1:2))throw Object.assign(Error('inventory denied'),{code:'EACCES'});
      return list(dir,...args);
    });
    const runtime=createRuntime({settingsFile:path.join(root,'runtime.json'),now:()=>clock,dispatch:async method=>{
      if(method==='devices')try{return {devices:await devices.devices()};}catch(e){return {devices:[],platformErrors:[{platform:'android',code:e.code,message:e.message}]};}
      assert.equal(method,'close_viewer');return {};
    }});
    if(entry==='idle')clock=15*60000;
    const result=entry==='manual'?await runtime.request('settings_stop_all'):entry==='disable'?await runtime.request('settings_save',{enabled:false,idleMinutes:15}):entry==='idle'?await runtime.checkIdle():await runtime.close();
    assert.equal(result.ok,false);assert.equal(result.execution,'unknown');assert.equal(result.errorCode,'STOP_INCOMPLETE');assert.equal(result.platformErrors[0].code,'EACCES');
  });
  await t.test('missing inventory is empty',async t=>{
    const {root,devices}=await privateAndroid(t);await fs.rm(path.join(root,'avd'),{recursive:true});assert.deepEqual(await devices.devices(),[]);
  });
});
test('device removal reports each completed step and preserves records when a later deletion fails',async t=>{
  for(const action of ['delete_device','erase_device'])for(let failure=0;failure<(action==='delete_device'?3:2);failure++)await t.test(action+' step '+failure,async t=>{
    const {devices,d}=await privateAndroid(t),remove=fs.rm;let writes=0;
    const spy=t.mock.method(fs,'rm',async(target,options)=>{if(String(target).startsWith(path.dirname(d.directory))){if(writes++===failure)throw Object.assign(Error('disk denied'),{code:'EACCES'});}return remove(target,options);});
    const result=await devices.manage(action,{udid:d.udid});spy.mock.restore();
    assert.equal(result.outcome,'partial');assert.equal(result.execution,'unknown');assert.equal(result.completedSteps.length,failure+1);assert.equal(writes,failure+1);assert.equal(result.deviceError.code,'EACCES');
    assert.equal(result.shutdown.state,'Shutdown');assert.equal(await devices.owns(d.udid),true,'partial changes retain device identity');
    if(action==='erase_device')assert.ok(await fs.stat(path.join(d.directory,'config.ini')));
  });
});
test('a completed shutdown remains visible when the subsequent AVD listing fails',async t=>{
  const {devices,d}=await privateAndroid(t);let running=true;
  const endpoint=await emulator(t,s=>{running=false;send(s,'Empty',{});}),name='pid_'+process.pid+'.ini',read=fs.readFile,list=fs.readdir;
  t.mock.method(fs,'readFile',async(file,...args)=>path.basename(String(file))===name?`avd.id=${d.avdName}\navd.dir=${d.directory}\ngrpc.port=${endpoint.port}\ngrpc.token=test-capability\nport.serial=5554\n`:read(file,...args));
  const spy=t.mock.method(fs,'readdir',async(dir,...args)=>{
    if(String(dir).endsWith(path.join('avd','running')))return running?[name]:[];
    if(String(dir)===d.directory)throw Object.assign(Error('cannot list'),{code:'EACCES'});
    return list(dir,...args);
  });
  const result=await devices.manage('erase_device',{udid:d.udid});spy.mock.restore();
  assert.equal(result.execution,'unknown');assert.equal(result.failedStep,'list-avd-data');assert.equal(result.shutdown.execution,'executed');assert.deepEqual(result.completedSteps,[{step:'shutdown',execution:'executed'}]);
});
test('new-device rollback and rename failures never claim a disk write was not executed',async t=>{
  const {devices,d}=await privateAndroid(t),write=fs.writeFile;
  const spy=t.mock.method(fs,'writeFile',async(file,...args)=>{
    if(String(file).endsWith('config.ini'))throw Object.assign(Error('config denied'),{code:'EACCES'});
    if(String(file).endsWith(d.udid+'.json'))throw Object.assign(Error('rename denied'),{code:'EACCES'});
    return write(file,...args);
  });
  await assert.rejects(devices.create({name:'Failed fixture',runtime:d.runtime,deviceType:d.deviceType}),e=>e.execution==='unknown'&&/rollback completed/.test(e.message));
  await assert.rejects(devices.manage('rename_device',{udid:d.udid,name:'Changed'}),e=>e.execution==='unknown');spy.mock.restore();
});
test('App relaunch preserves force-stop evidence across later budget and connection failures',async()=>{
  const {createApps}=require(path.join(A,'apps.cjs'));
  for(const relaunch of [undefined,false])for(const code of ['TIME_BUDGET_EXHAUSTED','COMMAND_FAILED']){
    const apps=createApps({devices:{adb:async(d,args)=>{
      if(args.includes('resolve-activity'))return {stdout:'test.example/.Main'};
      if(args.includes('force-stop'))return {stdout:''};
      throw Object.assign(Error('start unavailable'),{code,execution:code==='TIME_BUDGET_EXHAUSTED'?'not_executed':'unknown'});
    }}});
    const result=await apps.launch({udid:id},{bundleId:'test.example',relaunch});
    assert.equal(result.appTerminated,relaunch!==false);assert.equal(result.appLaunched,false);assert.equal(result.outcome,'partial');assert.equal(result.launchError.code,code);
    assert.equal(result.execution,relaunch===false&&code==='TIME_BUDGET_EXHAUSTED'?'not_executed':'unknown');
  }
});
test('partial launch and destruction do not change successful App records or task bindings',async t=>{
  const root=await temp(t),file=path.join(root,'settings.json'),record=file+'.apps.json';let binds=0,forgets=0;
  await fs.writeFile(record,JSON.stringify({[id]:'test.previous'}));
  const partial={udid:id,execution:'unknown',outcome:'partial',appLaunched:false,appTerminated:true,launchError:{code:'TIME_BUDGET_EXHAUSTED'}};
  const runtime=require('../../baguette-simulator/node/runtime.cjs').createRuntime({settingsFile:file,dispatch:async()=>partial,tasks:{bind:async()=>{binds++;},forgetDevice:async()=>{forgets++;},activity(){}}});
  for(const method of ['launch_app','delete_device','erase_device'])assert.equal((await runtime.request(method,{udid:id,bundleId:'test.next',session_context:{session_id:id}})).outcome,'partial');
  assert.equal(binds,0);assert.equal(forgets,0);assert.deepEqual(JSON.parse(await fs.readFile(record)),{[id]:'test.previous'});
});
test('Android launch adaptation preserves a partial App result and never opens a preview for it',async()=>{
  const partial={udid:id,execution:'unknown',outcome:'partial',appLaunched:false,appTerminated:true},source=await fs.readFile(path.join(A,'index.cjs'),'utf8');let opens=0;
  const modules={
    './sdk.cjs':{createSdk:()=>({})},'./devices.cjs':{createDevices:()=>({target:async()=>({udid:id})})},
    './agent.cjs':{createAgent:()=>({})},'./apps.cjs':{createApps:()=>({launch:async()=>partial})},
    './state.cjs':{createState:()=>({})},'./viewer.cjs':{createViewer:()=>({open:async()=>{opens++;}})}
  },context={module:{exports:{}},require:name=>modules[name]||require(name)};
  require('node:vm').runInNewContext(source,context);
  const android=context.module.exports.createAndroid({root:'/fixture',children:new Set()});
  const result=await android.dispatch('launch_app',{udid:id,bundleId:'test.example'});assert.equal(result.appLaunched,false);assert.equal(result.appTerminated,true);assert.equal(opens,0);
});

test('successful device removal/erase and App launch still produce confirmed outcomes',async t=>{
  for(const method of ['erase_device','delete_device']){
    const {devices,d}=await privateAndroid(t),result=await devices.manage(method,{udid:d.udid});
    assert.equal(result.execution,'executed');assert.equal(result.outcome,undefined);
    if(method==='erase_device'){assert.deepEqual(await fs.readdir(d.directory),['config.ini']);assert.equal(await devices.owns(d.udid),true);}
    else assert.equal(await devices.owns(d.udid),false);
  }
  const {createApps}=require(path.join(A,'apps.cjs'));
  for(const relaunch of [true,false]){
    const calls=[],apps=createApps({devices:{adb:async(d,args)=>{calls.push(args);return {stdout:args.includes('resolve-activity')?'test.example/.Main':'Status: ok'};}}});
    const result=await apps.launch({udid:id},{bundleId:'test.example',relaunch});assert.equal(result.appLaunched,true);assert.equal(result.appTerminated,relaunch);assert.equal(result.execution,'executed');
    assert.equal(calls.some(args=>args.includes('force-stop')),relaunch);
  }
});
test('Android boots on the host GPU, falls back once, and aligns the adb key first',async t=>{
  const root=await temp(t),runtime='android:android-36:google_apis:arm64-v8a',userHome=path.join(root,'user-android'),previous=process.env.ANDROID_USER_HOME;
  process.env.ANDROID_USER_HOME=userHome;t.after(()=>{if(previous===undefined)delete process.env.ANDROID_USER_HOME;else process.env.ANDROID_USER_HOME=previous;});
  const commands=[],launches=[],{EventEmitter}=require('node:events');
  const sdk={inspect:async()=>({ready:true,emulator:path.join(root,'sdk/emulator/emulator'),adb:path.join(root,'sdk/platform-tools/adb'),images:[{identifier:runtime,directory:path.join(root,'image'),abi:'arm64-v8a',version:'36'}]})};
  const run=async(file,args)=>{commands.push(args);if(args[0]==='start-server'){await fs.mkdir(userHome,{recursive:true});await fs.writeFile(path.join(userHome,'adbkey'),'adb-private-key');}return {stdout:''};};
  const spawn=(file,args)=>{const child=new EventEmitter();child.exitCode=null;launches.push(args[args.indexOf('-gpu')+1]);
    // The host GPU attempt exits during startup; the fallback keeps running.
    if(launches.length===1)setTimeout(()=>{child.exitCode=1;child.emit('exit',1);},50);
    t.after(()=>child.emit('exit',0));return child;};
  const devices=require(path.join(A,'devices.cjs')).createDevices({root,sdk,run,children:new Set(),spawn});
  const {udid}=await devices.create({name:'GPU fixture',runtime,deviceType:'android:phone'});
  await fs.writeFile(path.join(root,'adbkey'),'stale-emulator-key');
  await assert.rejects(devices.boot({udid,_deadline:Date.now()+2500}),e=>e.code==='ANDROID_BOOT_TIMEOUT');
  assert.deepEqual(launches,['host','auto']);
  assert.deepEqual(commands[0],['start-server'],'adb creates its key before the emulator copies it');
  assert.equal(await fs.readFile(path.join(root,'adbkey'),'utf8'),'adb-private-key');
  const d=await devices.target({udid},false);
  await fs.writeFile(path.join(d.directory,'emulator.log'),'INFO | emuglConfig_init: vulkan_mode_selected:lavapipe gles_mode_selected:swangle\n');
  assert.equal((await devices.devices()).find(x=>x.udid===udid).renderer,'software');
  await fs.writeFile(path.join(d.directory,'emulator.log'),'INFO | emuglConfig_init: vulkan_mode_selected:host gles_mode_selected:host\n');
  assert.equal((await devices.devices()).find(x=>x.udid===udid).renderer,'gpu');
});
function streamFixture(t,{onRequest}={}){
  const frames=[];let live=null;
  const ready=emulator(t,(s,h,body)=>{
    const request=schema.lookupType('ImageFormat').decode(body.subarray(5));onRequest?.(request);
    s.respond({':status':200,'content-type':'application/grpc'});live=s;
  });
  const push=(value)=>{const payload=Buffer.from(schema.lookupType('Image').encode(value).finish()),head=Buffer.alloc(5);head.writeUInt32BE(payload.length,1);live.write(Buffer.concat([head,payload]));};
  const out=[],res={headers:null,destroyed:false,writableLength:0,writeHead(status,headers){this.status=status;this.headers=headers;},write(b){out.push(Buffer.from(b));return true;},once(){}};
  const messages=()=>{const all=Buffer.concat(out),list=[];for(let i=0;i+4<=all.length;){const n=all.readUInt32BE(i);list.push(all.subarray(i+4,i+4+n));i+=4+n;}return list;};
  return {ready,push,res,messages,frames,live:()=>live};
}
function fakeEncoder(){
  const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
  const child=new EventEmitter(),lines=[];child.stdin=new PassThrough();child.stdout=new PassThrough();
  let text='';child.stdin.on('data',c=>{text+=c;let i;while((i=text.indexOf('\n'))>=0){lines.push(text.slice(0,i));text=text.slice(i+1);child.emit('line',lines.at(-1));}});
  child.stdin.on('finish',()=>setImmediate(()=>child.emit('exit',0,null)));
  const reply=(type,bytes=Buffer.from([0xAA]))=>{const b=Buffer.concat([Buffer.from([type]),bytes]),h=Buffer.alloc(4);h.writeUInt32BE(b.length);child.stdout.write(Buffer.concat([h,b]));};
  return {child,lines,reply,spawn:()=>child};
}
const until=async(check,ms=2000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timed out');await new Promise(r=>setTimeout(r,5));}};
test('Android H.264 stream keeps one frame in flight, carries rotation and settles on a keyframe',async t=>{
  const {serve,resetFailures}=require(path.join(A,'stream.cjs'));resetFailures();t.after(resetFailures);let request=null;
  const f=streamFixture(t,{onRequest:r=>{request=r;}}),endpoint=await f.ready,encoder=fakeEncoder(),abort=new AbortController();t.after(()=>abort.abort());
  const d={udid:id,endpoint,model:{width:1080,height:2400}};
  const done=serve({d,agent:{displayRotation:async()=>1},res:f.res,signal:abort.signal,format:'avcc',spawnEncoder:encoder.spawn}).catch(e=>e);
  await until(()=>f.live());
  assert.equal(request.format,2);assert.equal(request.width,2400);assert.equal(request.height,2400,'an explicit square box: 37.1.11 writes no pixels for 0x0');
  assert.match(request.transport.handle,/^file:\/\/\//);assert.equal(request.transport.channel,1);
  assert.match(encoder.lines[0],/^open 23040000 \/.+screen\.raw$/);
  f.push({format:{width:1080,height:2400,rotation:{rotation:0}}});
  await until(()=>encoder.lines.length===2);assert.equal(encoder.lines[1],'frame 1080 2400 1');
  f.push({format:{width:1080,height:2400,rotation:{rotation:0}}});f.push({format:{width:2400,height:1080,rotation:{rotation:1}}});
  await new Promise(r=>setTimeout(r,30));assert.equal(encoder.lines.length,2,'frames wait while the encoder is busy');
  encoder.reply(1,Buffer.from([1,0x64,0,0x33]));encoder.reply(2);
  await until(()=>encoder.lines.length===3);assert.equal(encoder.lines[2],'frame 2400 1080 0','only the newest waiting frame is encoded');
  encoder.reply(3);
  await until(()=>encoder.lines.length===4,1000);assert.equal(encoder.lines[3],'frame 2400 1080 1','a quiet screen ends on a keyframe');
  encoder.reply(2);await new Promise(r=>setTimeout(r,250));assert.equal(encoder.lines.length,4,'then nothing more is encoded');
  assert.equal(f.res.headers['Content-Type'],'application/x-cindy-android-avcc');
  const messages=f.messages();
  assert.deepEqual(messages.map(m=>[m[0],m[1],m[2]]),[[1,0,1],[1,0,2],[1,1,3],[1,1,1],[1,1,2]],'display rotation, device rotation, envelope type; every keyframe carries its description');
  abort.abort();await done;
  assert.ok(!require('node:fs').existsSync(path.dirname(encoder.lines[0].split(' ').slice(2).join(' '))),'the shared frame file is removed');
});
test('Android PNG stream is unthrottled, unbounded and never runs adb per frame',async t=>{
  const {serve,resetFailures}=require(path.join(A,'stream.cjs'));resetFailures();t.after(resetFailures);
  const f=streamFixture(t),endpoint=await f.ready,abort=new AbortController();t.after(()=>abort.abort());let polls=0;
  const done=serve({d:{udid:id,endpoint,model:{width:1080,height:2400}},agent:{displayRotation:async()=>{polls++;return 3;}},res:f.res,signal:abort.signal,format:'png'}).catch(e=>e);
  await until(()=>f.live());
  for(let i=0;i<20;i++)f.push({format:{width:108,height:240,rotation:{rotation:2}},image:image()});
  await until(()=>f.messages().length===20);
  assert.equal(polls,1,'rotation is polled, not read for each frame');
  assert.deepEqual([...new Set(f.messages().map(m=>m[0]+','+m[1]))],['3,2']);
  assert.equal(f.res.headers['Content-Type'],'application/octet-stream');
  abort.abort();await done;
});
test('Android H.264 stream retries one crashed encoder and uses PNG after a second crash',async t=>{
  const {serve,resetFailures}=require(path.join(A,'stream.cjs'));resetFailures();t.after(resetFailures);
  for(const attempt of [1,2]){
    const f=streamFixture(t),endpoint=await f.ready,encoder=fakeEncoder(),abort=new AbortController();t.after(()=>abort.abort());
    const done=serve({d:{udid:id,endpoint,model:{width:1080,height:2400}},agent:{displayRotation:async()=>0},res:f.res,signal:abort.signal,format:'avcc',spawnEncoder:encoder.spawn});
    await until(()=>f.live());assert.equal(f.res.headers['Content-Type'],'application/x-cindy-android-avcc',`attempt ${attempt} still uses H.264`);
    encoder.child.emit('exit',null,'SIGSEGV');
    await assert.rejects(done,/encoder stopped/);
  }
  const g=streamFixture(t),second=await g.ready,again=new AbortController();t.after(()=>again.abort());
  const next=serve({d:{udid:id,endpoint:second,model:{width:1080,height:2400}},agent:{displayRotation:async()=>0},res:g.res,signal:again.signal,format:'avcc',spawnEncoder:()=>{throw Error('must not start');}}).catch(e=>e);
  await until(()=>g.res.headers);assert.equal(g.res.headers['Content-Type'],'application/octet-stream');
  again.abort();await next;
});
test('Android H.264 stream treats a helper that only skips frames as failed',async t=>{
  const {serve,resetFailures}=require(path.join(A,'stream.cjs'));resetFailures();t.after(resetFailures);
  for(const attempt of [1,2]){
    const f=streamFixture(t),endpoint=await f.ready,encoder=fakeEncoder(),abort=new AbortController();t.after(()=>abort.abort());
    const done=serve({d:{udid:id,endpoint,model:{width:1080,height:2400}},agent:{displayRotation:async()=>0},res:f.res,signal:abort.signal,format:'avcc',spawnEncoder:encoder.spawn}).catch(e=>e);
    await until(()=>f.live());f.push({format:{width:1080,height:2400,rotation:{rotation:0}}});
    // The helper stays alive but cannot create an encoder session.
    for(let n=0;n<10;n++){await until(()=>encoder.lines.filter(l=>l.startsWith('frame')).length>n);f.push({format:{width:1080,height:2400,rotation:{rotation:0}}});encoder.reply(0,Buffer.alloc(0));}
    const error=await done;assert.match(String(error),/cannot encode/,`attempt ${attempt}`);
  }
  const g=streamFixture(t),second=await g.ready,again=new AbortController();t.after(()=>again.abort());
  const next=serve({d:{udid:id,endpoint:second,model:{width:1080,height:2400}},agent:{displayRotation:async()=>0},res:g.res,signal:again.signal,format:'avcc',spawnEncoder:()=>{throw Error('must not start');}}).catch(e=>e);
  await until(()=>g.res.headers);assert.equal(g.res.headers['Content-Type'],'application/octet-stream');
  again.abort();await next;
});
test('Android H.264 stream corrects a default rotation once the first failed poll recovers',async t=>{
  const {serve,resetFailures}=require(path.join(A,'stream.cjs'));resetFailures();t.after(resetFailures);
  const f=streamFixture(t),endpoint=await f.ready,encoder=fakeEncoder(),abort=new AbortController();t.after(()=>abort.abort());
  let calls=0;
  const done=serve({d:{udid:id,endpoint,model:{width:1080,height:2400}},agent:{displayRotation:async()=>{if(++calls===1)throw Error('adb busy');return 3;}},res:f.res,signal:abort.signal,format:'avcc',spawnEncoder:encoder.spawn}).catch(e=>e);
  await until(()=>f.live());f.push({format:{width:2400,height:1080,rotation:{rotation:1}}});
  await until(()=>encoder.lines.length===2);encoder.reply(1,Buffer.from([1,0x64,0,0x33]));encoder.reply(2);
  await until(()=>encoder.lines.length===3,3000);assert.equal(encoder.lines[2],'frame 2400 1080 1');
  encoder.reply(2);await until(()=>f.messages().length>=4);
  assert.deepEqual(f.messages().slice(0,2).map(m=>m[0]),[0,0],'frames before recovery carry the default');
  assert.deepEqual(f.messages().slice(-2).map(m=>[m[0],m[1],m[2]]),[[3,1,1],[3,1,2]]);
  abort.abort();await done;
});
test('Android H.264 stream re-sends a still frame as a keyframe when display rotation turns',async t=>{
  const {serve,resetFailures}=require(path.join(A,'stream.cjs'));resetFailures();t.after(resetFailures);
  const f=streamFixture(t),endpoint=await f.ready,encoder=fakeEncoder(),abort=new AbortController();t.after(()=>abort.abort());
  let rotation=0;
  const done=serve({d:{udid:id,endpoint,model:{width:1080,height:2400}},agent:{displayRotation:async()=>rotation},res:f.res,signal:abort.signal,format:'avcc',spawnEncoder:encoder.spawn}).catch(e=>e);
  await until(()=>f.live());f.push({format:{width:1080,height:2400,rotation:{rotation:0}}});
  await until(()=>encoder.lines.length===2);encoder.reply(1,Buffer.from([1,0x64,0,0x33]));encoder.reply(2);
  await new Promise(r=>setTimeout(r,300));
  rotation=1;// Android locked the activity; the emulator sends no new frame.
  await until(()=>encoder.lines.length===3,3000);assert.equal(encoder.lines[2],'frame 1080 2400 1');
  encoder.reply(2);await until(()=>f.messages().length>=4);
  assert.deepEqual(f.messages().slice(-2).map(m=>[m[0],m[1],m[2]]),[[1,0,1],[1,0,2]],'display rotation 1 (was 0), device rotation 0, description then keyframe');
  abort.abort();await done;
});
