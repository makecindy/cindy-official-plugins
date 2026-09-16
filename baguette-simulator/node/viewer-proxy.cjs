'use strict';
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'control.html'));
const chineseHtml=fs.readFileSync(path.join(__dirname,'control.zh-CN.html'));
function proxyRequest(req,res,port){
 const upstream=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`,origin:`http://127.0.0.1:${port}`}},response=>{
  const headers={...response.headers};delete headers['x-frame-options'];
  // Only our same-origin controller may embed the native page.
  headers['content-security-policy']=((headers['content-security-policy']||'').replace(/frame-ancestors[^;]*(;|$)/gi,'')+"; frame-ancestors 'self'").replace(/^;\s*/,'');
  res.writeHead(response.statusCode,headers);response.pipe(res);
 });
 upstream.on('error',()=>{if(!res.headersSent){res.writeHead(503,{'Content-Type':'text/html; charset=utf-8'});res.end('<p data-viewer-unavailable>画面连接中断，请点击上方“恢复画面”。</p>');}else res.destroy();});
 upstream.setTimeout(15000,()=>upstream.destroy());req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
}
function attachUpgrade(server,port,sockets){
 server.on('upgrade',(req,socket,head)=>{
  const own=`127.0.0.1:${server.address().port}`;
  if(req.headers.host!==own||req.headers.origin!==`http://${own}`||typeof req.headers['sec-websocket-key']!=='string'){socket.destroy();return;}
  // Native HTTP/1 upgrade requires a fresh connection, never a pooled HTTP socket.
  const request=http.request({agent:false,hostname:'127.0.0.1',port,path:req.url,headers:{host:`127.0.0.1:${port}`,connection:'upgrade',upgrade:'websocket','sec-websocket-key':req.headers['sec-websocket-key'],'sec-websocket-version':'13','sec-fetch-mode':'websocket'}});
  request.on('upgrade',(response,upstream,upHead)=>{
   sockets.add(upstream);sockets.add(socket);
   socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
   if(head.length)upstream.write(head);if(upHead.length)socket.write(upHead);
   socket.pipe(upstream);upstream.pipe(socket);
   for(const [a,b] of [[socket,upstream],[upstream,socket]]){a.on('error',()=>b.destroy());a.on('close',()=>{sockets.delete(a);b.destroy();});}
  });
  request.on('response',()=>socket.destroy());request.on('error',()=>socket.destroy());socket.on('error',()=>request.destroy());socket.on('close',()=>request.destroy());request.end();
 });
}
module.exports={html,chineseHtml,proxyRequest,attachUpgrade};
