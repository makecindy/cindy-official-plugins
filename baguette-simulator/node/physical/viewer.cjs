'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {randomBytes}=require('node:crypto');
function createViewer({root,run,devices,wda,agent,children,live}){
  let server,base,token,controls,lastSeen=0,starting;const opened=new Set();
  const preview=require('./preview.cjs').createPreview({devices,wda,agent});
  const chrome=require('./chrome.cjs').createChrome({root,run});
  live ||= require('./realtime.cjs').createRealtime({root,run,devices,children});
  const url=(id,locale)=>`${base}/control?udid=${id}&lang=${locale==='zh-CN'?'zh-CN':'en'}#cindyClipboard=${new URL(base).port}.${token}`;
  const assets={'/control.js':['../control.js','text/javascript'],'/control-model.js':['../control-model.js','text/javascript'],'/control.css':['../control.css','text/css'],
    '/physical.js':['screen.js','text/javascript'],'/physical-live.js':['realtime.js','text/javascript'],'/physical.css':['screen.css','text/css'],'/physical-shell.js':['shell.js','text/javascript'],
    '/bezel.js':['../../vendor/baguette/Baguette_Baguette.bundle/Web/baguette/parts/bezel.js','text/javascript'],
    '/gesture-overlay.js':['../../vendor/baguette/Baguette_Baguette.bundle/Web/baguette/gestures/pinch-overlay.js','text/javascript']};
  async function control(p){
    switch(p.action){
      case 'status':{lastSeen=Date.now();const s=await controls.status();return {...s,device:s.devices.find(d=>d.udid===p.udid),viewerPlatform:'physical',ready:s.devices.some(d=>d.udid===p.udid&&d.state==='Booted'),generation:1};}
      case 'activity':controls.touch();return {};
      case 'open':return controls.request('open_viewer',{udid:p.udid,_locale:p.locale});
      case 'catalog':return controls.request('viewer_catalog');
      case 'resources':return controls.request('resource_usage',{udid:p.udid});
      case 'create':{const created=await controls.request('create_device',{name:p.name,deviceType:p.deviceType,runtime:p.runtime});return {ok:created.ok!==false,created};}
      case 'rename':await controls.request('rename_device',{udid:p.targetUdid,name:p.name});return {devices:(await controls.status()).devices};
      // A switch to a stopped simulator keeps this controller until it boots;
      // lifecycle dispatch still rejects these operations for physical phones.
      case 'boot':return controls.request('settings_boot',{udid:p.udid,memoryMode:p.memoryMode});
      case 'restart_device':return controls.request('settings_restart',{udid:p.udid,memoryMode:p.memoryMode});
      case 'shutdown':return controls.request('settings_shutdown',{udid:p.udid});
      case 'switch':{const job=await controls.request('viewer_switch',{udid:p.udid,targetUdid:p.targetUdid,_locale:p.locale,task:p.task});if(job.activeUdid)opened.add(job.activeUdid);return {job};}
      case 'release':return {execution:'not_executed'};
      case 'restart':return {ready:true,generation:Date.now()};
      case 'screenshot':return agent.screenshot(await devices.target(p),{destination:p.to==='clipboard'?'clipboard':'desktop',_deadline:Date.now()+30000});
      case 'screenshot_destination':return controls.request('screenshot_destination',{destination:p.destination});
      case 'reveal':return controls.request('reveal_screenshot',{path:p.path,platform:'physical'});
      default:throw Error('Unknown controller action');
    }
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
          const [file,type]=assets[u.pathname]||[u.searchParams.get('lang')==='zh-CN'?'../control.zh-CN.html':'../control.html','text/html; charset=utf-8'];res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' cindy-ghost://baguette-simulator");
          res.writeHead(200,{'Content-Type':type});return res.end(await fs.readFile(path.join(__dirname,file)));
        }
        const match=/^\/simulators\/([a-f0-9-]{36})(\/definition.json)?$/i.exec(u.pathname);
        if(req.method==='GET'&&match){
          let capability=u.searchParams.get('cindyViewer')===token;
          try{const r=new URL(req.headers.referer);capability ||= r.origin===base&&r.searchParams.get('cindyViewer')===token;}catch{}
          if(!capability)return reply(403,{message:'Viewer expired. Reopen the device.'});
          if(!opened.has(match[1]))return reply(404,{message:'Device not opened'});
          await controls.assertEnabled();
          if(match[2]){
            const d=await devices.target({udid:match[1]}),deviceScreen=await devices.screen(d);
            const definition=await chrome.definition(d,deviceScreen).catch(()=>null);
            return reply(200,{...(definition||{screen:{viewport:deviceScreen}}),deviceScreen});
          }
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(await fs.readFile(path.join(__dirname,'screen.html')));
        }
        if(req.method==='GET'&&u.pathname==='/physical-stream'){
          if(req.headers['x-cindy-clipboard']!==token||(req.headers.origin&&req.headers.origin!==base))return reply(403,{message:'Viewer expired. Reopen the device.'});
          const id=u.searchParams.get('udid');if(!opened.has(id))return reply(404,{message:'Device not opened'});
          await controls.assertEnabled();lastSeen=Date.now();return live.pipe(id,u.searchParams.get('session'),res);
        }
        if(req.method!=='POST'||!['/physical-api','/control-api'].includes(u.pathname)||req.headers.origin!==base||req.headers['x-cindy-clipboard']!==token)return reply(403,{message:'Viewer expired. Reopen the device.'});
        let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>64000)return reply(413,{message:'Input too large'});chunks.push(c);}
        const p=JSON.parse(Buffer.concat(chunks));if(!opened.has(p.udid))return reply(404,{message:'Device not opened'});
        await controls.assertEnabled();
        if(u.pathname==='/control-api')return reply(200,{ok:true,...await control(p)});
        if(p.action==='live'){
          lastSeen=Date.now();const current=live.state(p.udid);
          return reply(200,{ok:true,control:['ready','running'].includes(current.state)?current:await live.start(await devices.target(p))});
        }
        if(p.action==='live-input'){controls.touch();return reply(200,{ok:true,...await live.input(p.udid,p)});}
        if(p.action==='disconnect')await live.disconnect(p.udid);
        if(p.action==='status'){
          lastSeen=Date.now();const d=await devices.target(p,false);
          return reply(200,{ok:true,name:d.name,connected:d.isAvailable,developerMode:d.developerMode,control:wda.state(d.udid)});
        }
        if(p.action==='frame'){
          lastSeen=Date.now();const f=await preview.frame(p.udid);
          return reply(200,{ok:true,...f,control:wda.state(p.udid)});
        }
        const methods={connect:'physical_connect',disconnect:'physical_disconnect',touch:'physical_touch',tap:'tap',gesture:'gesture',type:'type_text',press:'press'};
        if(!methods[p.action])return reply(400,{message:'Unknown action'});
        // Preparing control must never queue/replay a stale user action.
        if(!['connect','disconnect'].includes(p.action)&&!wda.state(p.udid).ready){
          const current=wda.state(p.udid),result=current.state==='running'?current:await controls.request('physical_connect',{udid:p.udid});
          return reply(200,{ok:true,preparing:true,execution:'not_executed',control:result});
        }
        const params={udid:p.udid,observe:'none'};
        const allowed={connect:['teamId'],disconnect:[],touch:['paths','duration','hold','expectedScreen'],tap:['x','y','count','duration','expectedScreen'],gesture:['kind','from','to','direction','distance','duration','hold','center','from_spread','to_spread','by','expectedScreen'],type:['text','keys'],press:['button']};
        for(const key of allowed[p.action])if(p[key]!==undefined)params[key]=p[key];
        return reply(200,{ok:true,...await controls.request(methods[p.action],params)});
      }catch(e){if(!res.headersSent)reply(409,{ok:false,errorCode:e.code||'VIEWER_FAILED',message:e.message,execution:e.execution||'unknown',...(e.teams?{teams:e.teams}:{})});else res.end();}
    });
    server.requestTimeout=15000;server.headersTimeout=10000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
  }
  return {configure:c=>{controls=c;},viewing:()=>Date.now()-lastSeen<15000,wanted:()=>!!server,forget:()=>{},
    existing:(id,locale)=>server&&opened.has(id)?url(id,locale):null,
    async open(id,locale){await devices.target({udid:id});if(starting)await starting;else if(!server){starting=start().finally(()=>{starting=null;});await starting;}opened.add(id);return {url:url(id,locale),ready:true};},
    async close(){await starting?.catch(()=>{});if(server){server.close();server.closeAllConnections();}await live.close();server=null;base=null;token=null;opened.clear();preview.clear();chrome.clear();lastSeen=0;}};
}
module.exports={createViewer};
