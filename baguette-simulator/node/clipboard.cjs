'use strict';
const http=require('node:http');
const {randomBytes}=require('node:crypto');
// An unguessable capability plus exact viewer Origin: other local pages cannot
// use the bridge. No clipboard contents, tokens, or request bodies are logged.
async function createClipboard(origin,perform,control){
 const token=randomBytes(32).toString('hex'),devices=new Set();let busy=false;const sockets=new Set();
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const own=`127.0.0.1:${server.address().port}`;
  if(req.headers.host!==own)return reply(403,{error:'Invalid host'});
  if(control&&req.method==='GET'){
   if(req.url.startsWith('/map/'))return require('./map.cjs').serveMap(req,res,own);
   if(req.url.startsWith('/control?')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"frame-ancestors 'none'",'Referrer-Policy':'no-referrer'});return res.end(require('./viewer-proxy.cjs')[new URL(req.url,'http://localhost').searchParams.get('lang')==='zh-CN'?'chineseHtml':'html']);}
   return require('./viewer-proxy.cjs').proxyRequest(req,res,control.port);
  }
  if(req.headers.origin!==origin&&req.headers.origin!==`http://${own}`)return reply(403,{error:'Invalid origin',execution:'not_executed'});
  res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){
   res.writeHead(204,{'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type, X-Cindy-Clipboard','Access-Control-Allow-Private-Network':'true'});return res.end();
  }
  if(control&&!['/clipboard','/control-api'].includes(req.url))return require('./viewer-proxy.cjs').proxyRequest(req,res,control.port);
  if(req.method!=='POST'||!['/clipboard',...(control?['/control-api']:[])].includes(req.url)||req.headers['x-cindy-clipboard']!==token)return reply(403,{error:'Invalid capability',execution:'not_executed'});
  const chunks=[];let bytes=0;
  try{
   for await(const chunk of req){bytes+=chunk.length;if(bytes>40000){reply(413,{error:'Text too long',execution:'not_executed'});req.destroy();return;}chunks.push(chunk);}
   const p=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!devices.has(p.udid))return reply(400,{error:'Unknown device',execution:'not_executed'});
   if(req.url==='/control-api'){
    if(!['status','restart','release'].includes(p.action))return reply(400,{error:'Invalid action'});
    try{return reply(200,await control[p.action](p));}catch{return reply(503,{error:'画面服务暂时无法启动，请重试。'});}
   }
   if(!['paste','copy','key','release'].includes(p.action)||(p.action==='paste'&&(typeof p.text!=='string'||!p.text.length||p.text.length>8000||p.text.includes('\0'))))return reply(400,{error:'Invalid clipboard request',execution:'not_executed'});
   if(busy)return reply(409,{error:'Clipboard busy; try again',execution:'not_executed'});
   busy=true;
   try{await perform(p);reply(200,{ok:true,execution:'executed'});}
   catch(error){reply(500,{error:'Clipboard operation failed; check the device and retry.',execution:error.execution||'unknown'});}
   finally{busy=false;}
  }catch{if(!res.headersSent)reply(400,{error:'Invalid request',execution:'not_executed'});}
 });
 if(control)require('./viewer-proxy.cjs').attachUpgrade(server,control.port,sockets);
 server.requestTimeout=10000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {devices,base:`http://127.0.0.1:${server.address().port}`,fragment:`cindyClipboard=${server.address().port}.${token}`,close(){for(const socket of sockets)socket.destroy();server.close();server.closeAllConnections();}};
}
module.exports={createClipboard};
