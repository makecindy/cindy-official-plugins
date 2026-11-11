'use strict';
// A device of this plugin that runs on another of the account's computers,
// shown here with the plugin's own controller page. Cindy holds the connection
// to that computer and hands this worker a loopback address (main.js asks for
// it with cindy.liveScreenView): GET <address>/stream is the message format
// live-screen.cjs produces ([u32 BE length][type][payload]: 0x01 avcC, 0x02
// keyframe, 0x03 delta, 0x10 JSON {type:'state'|'device'|'screen'}), and POST
// <address>/input takes {events:[touch | press | text | key | release]}, and
// POST <address>/retry connects again at the user's request.
// This server adds the controller page and the device page around it; nothing
// here needs Xcode, the Android SDK or a Mac.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomBytes}=require('node:crypto');
const {execFile}=require('node:child_process');

const GESTURES='../../vendor/baguette/Baguette_Baguette.bundle/Web/baguette/gestures/';
const GESTURE_FILES=['attachable-event-source','edge-bands','screen-quad','pinch-overlay','mouse-gesture-source','option-hover-preview','touch-gesture-source','wheel-gesture-source','safari-gesture-event-source','pointer-interpreter'];
const SCREEN_ID=/^[A-Za-z0-9._:-]{1,128}$/;
const PLATFORMS=['ios','ipados','tvos','visionos','android'];
const MAX_INPUT=64000,MAX_SHOT=32*1024*1024;
const CSP="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self' cindy-ghost://cindy-simulator";
const HOST_URL=/^http:\/\/127\.0\.0\.1:\d{2,5}\/[0-9a-f]{64}$/;

function createRemoteViewer({desktop=()=>path.join(os.homedir(),'Desktop'),now=()=>new Date()}={}){
  let server,base,token,starting,lastSeen=0,shotTo='desktop';
  // screen id → {id, upstream, name, platform}
  const views=new Map();
  const url=(id,locale,task)=>`${base}/control?udid=${encodeURIComponent(id)}&lang=${locale==='zh-CN'?'zh-CN':'en'}${task?`&task=${encodeURIComponent(task)}`:''}#cindyClipboard=${new URL(base).port}.${token}`;
  const assets={'/control.js':['../control.js','text/javascript'],'/control-model.js':['../control-model.js','text/javascript'],'/control.css':['../control.css','text/css'],
    '/remote.js':['screen.js','text/javascript'],'/remote.css':['../physical/screen.css','text/css'],
    ...Object.fromEntries(GESTURE_FILES.map(name=>[`/gestures/${name}.js`,[GESTURES+name+'.js','text/javascript']]))};
  // The control model reads a platform from these fields.
  function device(view){
    return {udid:view.id,name:view.name,state:'Booted',kind:'remote',isAvailable:true,
      ...(view.platform==='android'?{platform:'android'}:{}),
      runtime:view.platform==='tvos'?'tvOS':view.platform==='visionos'?'visionOS':'',
      productFamily:view.platform==='ipados'?'iPad':view.platform==='tvos'?'Apple TV':view.platform==='visionos'?'Apple Vision':'iPhone'};
  }
  function send(view,events,route='/input'){
    return new Promise((resolve,reject)=>{
      const body=Buffer.from(JSON.stringify(events?{events}:{}));
      const request=http.request(view.upstream+route,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length},timeout:10000},response=>{
        const chunks=[];response.on('data',c=>chunks.push(c));
        response.on('end',()=>{
          let result={};try{result=JSON.parse(Buffer.concat(chunks));}catch{}
          if(response.statusCode===200&&result.ok)resolve();
          else reject(Object.assign(Error(result.errorCode||'REMOTE_INPUT_FAILED'),{code:result.errorCode||'REMOTE_INPUT_FAILED',execution:'not_executed'}));
        });
      });
      request.once('timeout',()=>request.destroy(Object.assign(Error('REMOTE_INPUT_TIMEOUT'),{code:'REMOTE_INPUT_TIMEOUT',execution:'unknown'})));
      request.once('error',error=>reject(Object.assign(error,{code:error.code||'REMOTE_INPUT_FAILED',execution:error.execution||'unknown'})));
      request.end(body);
    });
  }
  // The picture as shown: this computer has no direct way to the device itself.
  // Named like a screenshot of a device on this computer (core.cjs desktopFile).
  const shots=new Set();
  async function screenshot(view,p){
    if(typeof p.png!=='string'||!/^[A-Za-z0-9+/]+=*$/.test(p.png))throw Object.assign(Error('INVALID_ARGUMENT'),{code:'INVALID_ARGUMENT'});
    if(p.to==='clipboard')return {clipboardPng:p.png};
    const dir=desktop();await fs.mkdir(dir,{recursive:true});
    const d=now(),pad=n=>String(n).padStart(2,'0');
    const stamp=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
    const base=`${(view.name.replace(/[\\/:*?"<>|\0]/g,'-').slice(0,80)||'Device')} ${stamp}`;
    for(let i=1;i<100;i++){
      const file=path.join(dir,`${base}${i>1?` (${i})`:''}.png`);
      try{await fs.writeFile(file,Buffer.from(p.png,'base64'),{flag:'wx'});shots.add(file);return {path:file};}
      catch(error){if(error.code!=='EEXIST')throw Object.assign(Error('SCREENSHOT_EXPORT_FAILED'),{code:'SCREENSHOT_EXPORT_FAILED'});}
    }
    throw Object.assign(Error('SCREENSHOT_NAME'),{code:'SCREENSHOT_NAME'});
  }
  // Only a screenshot this page saved can be shown in the file manager.
  function reveal(file){
    if(!shots.has(file))return;
    if(process.platform==='darwin')execFile('/usr/bin/open',['-R',file],()=>{});
    else if(process.platform==='win32')execFile('explorer.exe',['/select,',file],()=>{});
    else execFile('xdg-open',[path.dirname(file)],()=>{});
  }
  async function control(view,p){
    switch(p.action){
      case 'status':lastSeen=Date.now();return {devices:[device(view)],device:device(view),viewerPlatform:'remote',ready:true,generation:1,settings:{enabled:true,screenshotDestination:shotTo}};
      case 'activity':lastSeen=Date.now();return {};
      case 'press':if(typeof p.button!=='string'||!/^[a-z0-9-]{1,32}$/.test(p.button))throw Object.assign(Error('INVALID_ARGUMENT'),{code:'INVALID_ARGUMENT'});await send(view,[{kind:'press',button:p.button}]);return {execution:'executed'};
      case 'input':if(!Array.isArray(p.events)||!p.events.length||p.events.length>64)throw Object.assign(Error('INVALID_ARGUMENT'),{code:'INVALID_ARGUMENT'});await send(view,p.events);return {execution:'executed'};
      case 'screenshot':return screenshot(view,p);
      case 'screenshot_destination':shotTo=p.destination==='clipboard'?'clipboard':'desktop';return {destination:shotTo};
      case 'reveal':reveal(p.path);return {};
      // The user asks to connect again; Cindy then takes the view over from their other device.
      case 'retry':await send(view,null,'/retry');return {execution:'executed'};
      case 'restart':return {ready:true,generation:Date.now()};
      case 'release':await send(view,[{kind:'release'}]).catch(()=>{});return {execution:'executed'};
      // Starting, stopping, creating and renaming belong to the computer that runs the device.
      default:throw Object.assign(Error('REMOTE_UNSUPPORTED'),{code:'REMOTE_UNSUPPORTED',execution:'not_executed'});
    }
  }
  function pipe(view,res){
    const upstream=http.get(view.upstream+'/stream',response=>{
      if(response.statusCode!==200){response.resume();res.writeHead(response.statusCode===404?410:502,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,errorCode:'REMOTE_VIEW_CLOSED'}));return;}
      res.writeHead(200,{'Content-Type':'application/x-cindy-live-screen'});
      response.on('data',chunk=>{lastSeen=Date.now();if(!res.write(chunk)&&res.writableLength>16*1024*1024)upstream.destroy();});
      response.on('end',()=>res.end());response.on('error',()=>res.destroy());
    });
    upstream.once('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,errorCode:'REMOTE_VIEW_CLOSED'}));}else res.destroy();});
    res.once('close',()=>upstream.destroy());
  }
  async function start(){
    token=randomBytes(32).toString('hex');
    server=http.createServer(async(req,res)=>{
      const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      if(req.headers.host!==new URL(base).host)return reply(403,{message:'Invalid host'});
      const u=new URL(req.url,base);
      try{
        if(req.method==='GET'&&(assets[u.pathname]||u.pathname==='/control')){
          const [file,type]=assets[u.pathname]||[u.searchParams.get('lang')==='zh-CN'?'../control.zh-CN.html':'../control.html','text/html; charset=utf-8'];
          res.setHeader('Content-Security-Policy',CSP);
          res.writeHead(200,{'Content-Type':type});return res.end(await fs.readFile(path.join(__dirname,file)));
        }
        const match=/^\/simulators\/([^/]{1,400})$/.exec(u.pathname);
        if(req.method==='GET'&&match){
          let capability=u.searchParams.get('cindyViewer')===token;
          try{const r=new URL(req.headers.referer);capability ||= r.origin===base&&r.searchParams.get('cindyViewer')===token;}catch{}
          if(!capability)return reply(403,{message:'Viewer expired. Reopen the device.'});
          if(!views.has(decodeURIComponent(match[1])))return reply(404,{message:'Device not opened'});
          // The device page sits inside the controller page, which sits inside the task page.
          res.setHeader('Content-Security-Policy',CSP);
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(await fs.readFile(path.join(__dirname,'screen.html')));
        }
        if(req.method==='GET'&&u.pathname==='/remote-stream'){
          if(req.headers['x-cindy-clipboard']!==token||(req.headers.origin&&req.headers.origin!==base))return reply(403,{message:'Viewer expired. Reopen the device.'});
          const view=views.get(u.searchParams.get('udid'));if(!view)return reply(404,{message:'Device not opened'});
          lastSeen=Date.now();return pipe(view,res);
        }
        if(req.method!=='POST'||u.pathname!=='/control-api'||req.headers.origin!==base||req.headers['x-cindy-clipboard']!==token)return reply(403,{message:'Viewer expired. Reopen the device.'});
        let size=0;const chunks=[];
        for await(const c of req){size+=c.length;if(size>MAX_SHOT)return reply(413,{message:'Input too large'});chunks.push(c);}
        const p=JSON.parse(Buffer.concat(chunks));
        if(p.action!=='screenshot'&&size>MAX_INPUT)return reply(413,{message:'Input too large'});
        const view=views.get(p.udid);if(!view)return reply(404,{message:'Device not opened'});
        return reply(200,{ok:true,...await control(view,p)});
      }catch(e){if(!res.headersSent)reply(409,{ok:false,errorCode:e.code||'VIEWER_FAILED',message:e.message,execution:e.execution||'unknown'});else res.end();}
    });
    server.requestTimeout=30000;server.headersTimeout=10000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
  }
  return {
    viewing:()=>Date.now()-lastSeen<15000,
    // Opens (or re-points) the page for one device; the same device keeps its page while Cindy renews the address.
    async open({id,url:upstream,name,platform,locale,task}){
      if(typeof id!=='string'||!SCREEN_ID.test(id)||typeof upstream!=='string'||!HOST_URL.test(upstream)||!PLATFORMS.includes(platform))
        throw Object.assign(Error('INVALID_ARGUMENT'),{code:'INVALID_ARGUMENT',execution:'not_executed'});
      if(starting)await starting;else if(!server){starting=start().finally(()=>{starting=null;});await starting;}
      views.set(id,{id,upstream,platform,name:typeof name==='string'&&name?name.slice(0,128):id});lastSeen=Date.now();
      return {url:url(id,locale,task),ready:true};
    },
    async close(){await starting?.catch(()=>{});if(server){server.close();server.closeAllConnections();}server=null;base=null;token=null;views.clear();lastSeen=0;}};
}
module.exports={createRemoteViewer};
