'use strict';
const http=require('node:http');
const {randomBytes}=require('node:crypto');
const {deviceId}=require('./device-id.cjs');
// An unguessable capability plus exact viewer Origin: other local pages cannot
// use the bridge. No clipboard contents, tokens, or request bodies are logged.
// `preferred` {port, token} comes from the last viewer session: reusing both
// lets a tab opened earlier reconnect once the plugin runs again.
const JS='text/javascript; charset=utf-8';
const STATIC_ASSETS=new Map([
 ['/control.js',{file:'control.js',type:JS}],
 ['/control-model.js',{file:'control-model.js',type:JS}],
 ['/control.css',{file:'control.css',type:'text/css; charset=utf-8'}],
 ['/viewer-auth.js',{file:'viewer-auth.js',type:JS}],
 ['/viewer-stage.js',{file:'viewer-stage.js',type:JS}],
 ['/platform-stage.js',{file:'platform-stage.js',type:JS}],
 ['/vision-stage.js',{file:'vision-stage.js',type:JS}],
 ['/platform-stage.html',{file:'platform-stage.html',type:'text/html; charset=utf-8'}],
]);
async function createClipboard(origin,perform,control,preferred={}){
 const token=/^[0-9a-f]{64}$/.test(preferred.token||'')?preferred.token:randomBytes(32).toString('hex'),devices=new Set(),busy=new Set();const sockets=new Set(),clients=new Set();
 // Cindy's plugin pages are not an HTTP origin, so a viewer framed by them can
 // store no cookie. It carries the same capability in its own URL instead:
 // same-origin subresources pass it in Referer, the stream socket appends it
 // (viewer-auth.js). Anything without the capability stays rejected.
 const capability=value=>{try{return new URL(String(value),`http://127.0.0.1:${server.address().port}`).searchParams.get('cindyViewer')===token;}catch{return false;}};
 const sameOrigin=value=>typeof value==='string'&&value.startsWith(`http://127.0.0.1:${server.address().port}/`);
 const authorized=req=>req.headers.cookie?.split(';').some(part=>part.trim()===`cindy_viewer_${server.address().port}=${token}`)===true
  ||capability(req.url)||(sameOrigin(req.headers.referer)&&capability(req.headers.referer));
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const own=`127.0.0.1:${server.address().port}`;
  if(req.headers.host!==own)return reply(403,{error:'Invalid host'});
  if(control&&req.method==='GET'){
   // The file name comes from this fixed table, never from the request.
   const asset=STATIC_ASSETS.get(req.url.split('?',1)[0]);
   if(asset){
    res.writeHead(200,{'Content-Type':asset.type,'X-Content-Type-Options':'nosniff'});
    return res.end(require('node:fs').readFileSync(require('node:path').join(__dirname,asset.file)));
   }
   if(req.url.startsWith('/control?')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"frame-ancestors 'self' cindy-ghost://baguette-simulator",'Referrer-Policy':'no-referrer'});return res.end(require('./viewer-proxy.cjs')[new URL(req.url,'http://localhost').searchParams.get('lang')==='zh-CN'?'chineseHtml':'html']);}
   if(!authorized(req))return reply(403,{error:'Viewer capability required'});
   if(req.url.startsWith('/map/'))return require('./map.cjs').serveMap(req,res,own);
   return require('./viewer-proxy.cjs').proxyRequest(req,res,control.port,token);
  }
  if(req.headers.origin!==origin&&req.headers.origin!==`http://${own}`)return reply(403,{error:'Invalid origin',execution:'not_executed'});
  res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){
   res.writeHead(204,{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type, X-Cindy-Clipboard','Access-Control-Allow-Private-Network':'true'});return res.end();
  }
  if(control&&!['/clipboard','/control-api'].includes(req.url)){
   if(!authorized(req))return reply(403,{error:'Viewer capability required'});
   try{
    const operation=async()=>{
     await control.guard?.();
     await new Promise(resolve=>{res.once('finish',resolve);res.once('close',resolve);require('./viewer-proxy.cjs').proxyRequest(req,res,control.port,token);});
     control.touch?.();
    };
    return await (control.run?control.run(operation):operation());
   }catch(error){if(!res.headersSent)return reply(409,{errorCode:error.code||'CONTROL_FAILED',error:'Device operation unavailable. Check plugin settings.',execution:'not_executed'});return;}
  }
  if(req.method!=='POST'||!['/clipboard',...(control?['/control-api']:[])].includes(req.url)||req.headers['x-cindy-clipboard']!==token)return reply(403,{error:'Invalid capability',execution:'not_executed'});
  const chunks=[];let bytes=0;
  try{
   for await(const chunk of req){bytes+=chunk.length;if(bytes>40000){reply(413,{error:'Text too long',execution:'not_executed'});req.destroy();return;}chunks.push(chunk);}
   const p=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(![...devices].some(id=>deviceId(id)===deviceId(p.udid)))return reply(400,{error:'Unknown device',execution:'not_executed'});
   p.udid=deviceId(p.udid);
   if(req.url==='/control-api'){
    res.setHeader('Set-Cookie',`cindy_viewer_${server.address().port}=${token}; HttpOnly; SameSite=Strict; Path=/`);
    if(!['status','open','restart','restart_device','release','shutdown','boot','screenshot','screenshot_destination','activity','catalog','resources','create','rename','switch','reveal','press','tap','trackpad','spatial','viewport'].includes(p.action))return reply(400,{error:'Invalid action'});
    try{const result=await control[p.action](p);return reply(result?.ok===false?409:200,result);}
    catch(error){return reply(503,{errorCode:error.code||'CONTROL_FAILED',error:'Operation not confirmed. Refresh the device status in Baguette settings.',execution:error.execution||'unknown'});}
   }
   if(!['paste','copy','key','release'].includes(p.action)||(p.action==='paste'&&(typeof p.text!=='string'||!p.text.length||p.text.length>8000||p.text.includes('\0'))))return reply(400,{error:'Invalid clipboard request',execution:'not_executed'});
   const key=deviceId(p.udid);
   if(busy.has(key))return reply(409,{error:'Clipboard busy on this device; try again',execution:'not_executed'});
   busy.add(key);
   try{const operation=async()=>{await control?.guard?.();await perform(p);control?.touch?.();};await(control?.run?control.run(operation,p.udid):operation());reply(200,{ok:true,execution:'executed'});}
   catch(error){reply(500,{error:'Clipboard operation failed; check the device and retry.',execution:error.execution||'unknown'});}
   finally{busy.delete(key);}
  }catch{if(!res.headersSent)reply(400,{error:'Invalid request',execution:'not_executed'});}
 });
 if(control)require('./viewer-proxy.cjs').attachUpgrade(server,control.port,sockets,authorized,clients);
 server.requestTimeout=10000;server.headersTimeout=10000;
 const listen=port=>new Promise((resolve,reject)=>{const fail=error=>{server.off('listening',done);reject(error);};const done=()=>{server.off('error',fail);resolve();};server.once('error',fail);server.once('listening',done);server.listen(port,'127.0.0.1');});
 const wanted=Number.isInteger(preferred.port)&&preferred.port>=1024&&preferred.port<=65535?preferred.port:0;
 try{await listen(wanted);}catch(error){if(!wanted||error.code!=='EADDRINUSE')throw error;await listen(0);}
 return {devices,viewers:()=>clients.size,session:{port:server.address().port,token},base:`http://127.0.0.1:${server.address().port}`,fragment:`cindyClipboard=${server.address().port}.${token}`,close(){for(const socket of sockets)socket.destroy();server.close();server.closeAllConnections();}};
}
module.exports={createClipboard};
