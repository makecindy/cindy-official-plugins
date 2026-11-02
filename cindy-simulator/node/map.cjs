'use strict';
const https = require('node:https');
// Autonomous Node networking: fixed public endpoints, never a caller-provided URL.
function endpoint(raw) {
 const url=new URL(raw,'http://localhost');
 if(url.pathname==='/map/search') {
  const q=url.searchParams.get('q');
  if(!q||q.length>500)throw Error('Invalid query');
  return {host:'nominatim.openstreetmap.org',path:'/search?format=json&limit=1&q='+encodeURIComponent(q),type:'application/json',max:256*1024};
 }
 const match=/^\/map\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/.exec(url.pathname);
 if(!match)throw Error('Invalid map path');
 const [z,x,y]=match.slice(1).map(Number);
 if(z>19||x>=2**z||y>=2**z)throw Error('Invalid tile');
 return {host:'tile.openstreetmap.org',path:`/${z}/${x}/${y}.png`,type:'image/png',max:1024*1024};
}
function serveMap(req,res,own,request=https.get) {
 let target;
 const fail=status=>{if(!res.headersSent){res.writeHead(status,{'Content-Type':'text/plain'});res.end('Map request unavailable');}};
 try {
  if(req.headers['sec-fetch-site']!=='same-origin'||new URL(req.headers.referer).origin!==`http://${own}`)return fail(403);
  target=endpoint(req.url);
 }catch{return fail(400);}
 const upstream=request({hostname:target.host,path:target.path,port:443,headers:{Accept:target.type,'User-Agent':'Cindy-Baguette/0.1.9 (+https://github.com/makecindy/cindy-official-plugins)'}},response=>{
  // Do not follow redirects or forward caller headers/cookies to the provider.
  if(response.statusCode!==200){response.resume();return fail(502);}
  let bytes=0;const chunks=[];
  response.on('data',chunk=>{bytes+=chunk.length;if(bytes>target.max){upstream.destroy();fail(502);}else chunks.push(chunk);});
  response.on('error',()=>fail(502));
  response.on('end',()=>{if(res.writableEnded)return;res.writeHead(200,{'Content-Type':target.type,'X-Content-Type-Options':'nosniff'});res.end(Buffer.concat(chunks));});
 });
 const deadline=setTimeout(()=>{upstream.destroy();fail(504);},10000);
 upstream.on('error',()=>fail(502));
 res.on('close',()=>{clearTimeout(deadline);upstream.destroy();});
}
module.exports={endpoint,serveMap};
