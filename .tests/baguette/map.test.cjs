const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{EventEmitter}=require('node:events');
const {endpoint,serveMap}=require('../../baguette-simulator/node/map.cjs');
test('map only permits bounded tiles and encoded search on fixed providers',()=>{
 assert.equal(endpoint('/map/tiles/2/1/3.png').host,'tile.openstreetmap.org');
 const search=endpoint('/map/search?q='+encodeURIComponent('x&url=https://example.test'));
 assert.equal(search.host,'nominatim.openstreetmap.org');assert.equal(new URLSearchParams(search.path.split('?')[1]).get('q'),'x&url=https://example.test');
 for(const raw of ['/map/tiles/20/0/0.png','/map/tiles/1/2/0.png','/map/search','/map/proxy?url=https://example.test'])assert.throws(()=>endpoint(raw));
});
test('map rejects foreign pages and upstream redirects without following them',async()=>{
 let calls=0;
 const server=http.createServer((req,res)=>serveMap(req,res,req.headers.host,(options,cb)=>{
  calls++;assert.equal(options.hostname,'tile.openstreetmap.org');assert.equal(options.headers.Cookie,undefined);
  const request=new EventEmitter();request.destroy=()=>{};
  queueMicrotask(()=>cb({statusCode:302,resume(){},headers:{location:'https://example.test'}}));return request;
 }));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/map/tiles/0/0/0.png')).status,403);assert.equal(calls,0);
  assert.equal((await fetch(base+'/map/tiles/0/0/0.png',{headers:{'sec-fetch-site':'same-origin',referer:base+'/simulators/test'}})).status,502);assert.equal(calls,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
