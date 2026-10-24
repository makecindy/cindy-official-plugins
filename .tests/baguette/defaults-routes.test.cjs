const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {blockedRoute}=require('../../cindy-simulator/node/viewer-proxy.cjs');
const {createClipboard}=require('../../cindy-simulator/node/clipboard.cjs');
const udid='00000000-0000-4000-8000-000000000001';

test('routes outside the viewer are blocked in every spelling; the viewer\'s own routes pass',()=>{
 for(const route of ['input','carplay-display?enabled=1','INPUT/'])assert.equal(blockedRoute(`/simulators/${udid}/`+route),true,route);
 for(const route of ['/plugins/a11y/commands/audit?udid=x','/bakeries/preview','/bakeries/install','/bakeries.json','/farm','/farm/farm-app.js',`/devices/${udid}/stream`,'//plugins//x/commands/y','/%62akeries/preview'])
  assert.equal(blockedRoute(route),true,route);
 for(const route of ['/plugins.json','/devices.json','/plugin-control.js','/farm-tile.js'])assert.equal(blockedRoute(route),false,route);
 for(const route of ['defaults.json?bundleId=com.example.app','defaults','defaults/','DEFAULTS','apps.json','defaults-groups.json?bundleId=x','relaunch?bundleId=x','%64efaults','defaults%2Ejson'])
  for(const prefix of [`/simulators/${udid}/`,`//simulators//${udid}/`])assert.equal(blockedRoute(prefix+route),true,prefix+route);
 assert.equal(blockedRoute('/simulators/%E0%A4%A/defaults'),true,'malformed encoding fails closed');
 for(const route of [`/simulators/${udid}`,`/simulators/${udid}/stream`,`/simulators/${udid}/logs`,'/simulators.json','/defaults/preference-rows.js','/sim-defaults.js'])
  assert.equal(blockedRoute(route),false,route);
});

test('blocked routes never reach the native server, even with a valid viewer session',async()=>{
 const seen=[];
 const upstream=http.createServer((req,res)=>{seen.push(req.method+' '+req.url);res.end('ok');});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const port=upstream.address().port;
 const bridge=await createClipboard('http://127.0.0.1:'+port,async()=>{}, {port,status:async()=>({ready:true})});bridge.devices.add(udid);
 try{
  const token=bridge.fragment.split('.')[1];
  const auth=await fetch(bridge.base+'/control-api',{method:'POST',headers:{Origin:bridge.base,'X-Cindy-Clipboard':token},body:JSON.stringify({action:'status',udid})});
  const cookie=auth.headers.get('set-cookie').split(';')[0];
  for(const [method,path] of [['GET','defaults.json?bundleId=com.example.app'],['POST','defaults'],['DELETE','defaults?bundleId=x&key=y'],['POST','relaunch?bundleId=x'],['GET','apps.json']]){
   const res=await fetch(`${bridge.base}/simulators/${udid}/${path}`,{method,headers:{Cookie:cookie,Origin:bridge.base},body:method==='POST'?'{}':undefined});
   assert.equal(res.status,404,method+' '+path);
  }
  assert.deepEqual(seen,[]);
  assert.equal((await fetch(`${bridge.base}/simulators/${udid}`,{headers:{Cookie:cookie}})).status,200);
  assert.deepEqual(seen,[`GET /simulators/${udid}`]);
 }finally{bridge.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});

const {stagedPage,injectStage,STAGE_STYLE,STAGE_HEAD}=require('../../cindy-simulator/node/viewer-proxy.cjs');
test('only the device page receives the Cindy stage stylesheet, and not when the full workbench is requested',()=>{
 assert.equal(stagedPage(`/simulators/${udid}`),true);assert.equal(stagedPage(`/simulators/${udid}?handheld=1`),true);assert.equal(stagedPage(`/simulators/${udid}/`),true);
 assert.equal(stagedPage(`/simulators/${udid}?handheld=0&cindyFull=1`),false);
 for(const url of ['/simulators','/simulators.json',`/simulators/${udid}/stream`,`/simulators/${udid}/hinge`,'/sim-native.js'])assert.equal(stagedPage(url),false,url);
 assert.equal(injectStage('<html><head><title>x</title></head><body></body></html>'),'<html><head><title>x</title>'+STAGE_HEAD+'</head><body></body></html>');
 assert.equal(injectStage('<html><head lang="en"><body>'),'<html><head lang="en">'+STAGE_HEAD+'<body>');
 assert.equal(injectStage('<p>bare</p>'),STAGE_HEAD+'<p>bare</p>');
 assert.match(STAGE_STYLE,/\.top-bar/);assert.match(STAGE_STYLE,/--nv-page-bg/);
});

test('the proxy injects the stylesheet into the device page HTML with a correct length and leaves other responses alone',async()=>{
 const upstream=http.createServer((req,res)=>{
  if(req.url.startsWith(`/simulators/${udid}/stream`)){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ok":true}');}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Frame-Options':'DENY'});res.end('<!doctype html><html><head><meta charset="utf-8"></head><body>page</body></html>');
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const port=upstream.address().port;
 const bridge=await createClipboard('http://127.0.0.1:'+port,async()=>{}, {port,status:async()=>({ready:true})});bridge.devices.add(udid);
 try{
  const token=bridge.fragment.split('.')[1];
  const auth=await fetch(bridge.base+'/control-api',{method:'POST',headers:{Origin:bridge.base,'X-Cindy-Clipboard':token},body:JSON.stringify({action:'status',udid})});
  const cookie=auth.headers.get('set-cookie').split(';')[0];
  const page=await fetch(`${bridge.base}/simulators/${udid}?handheld=1`,{headers:{Cookie:cookie}});
  const body=await page.text();
  assert.equal(page.status,200);assert.ok(body.includes('id="cindy-stage-style"'));assert.equal(Number(page.headers.get('content-length')),Buffer.byteLength(body));
  assert.equal(page.headers.get('x-frame-options'),null);assert.equal(page.headers.get('content-security-policy'),"frame-ancestors 'self' cindy-ghost://cindy-simulator");
  const control=await fetch(`${bridge.base}/control?udid=${udid}&lang=zh-CN`);assert.equal(control.headers.get('content-security-policy'),"frame-ancestors 'self' cindy-ghost://cindy-simulator");
  const full=await (await fetch(`${bridge.base}/simulators/${udid}?handheld=0&cindyFull=1`,{headers:{Cookie:cookie}})).text();
  assert.ok(!full.includes('cindy-stage-style'));
  const json=await (await fetch(`${bridge.base}/simulators/${udid}/stream`,{headers:{Cookie:cookie}})).text();
  assert.equal(json,'{"ok":true}');
 }finally{bridge.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});
