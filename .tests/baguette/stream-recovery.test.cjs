const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
test('unexpected disconnect retries, deliberate stop cancels retry and late socket callbacks',()=>{
 const sockets=[],timers=new Map();let seq=0,disposed=0;
 class Socket{static OPEN=1;constructor(){sockets.push(this);}close(){}send(){}}
 const window={location:{protocol:'http:',host:'127.0.0.1:1234'},FrameDecoder:{create:()=>({feed(){},dispose(){disposed++;}})}};
 vm.runInNewContext(fs.readFileSync('baguette-simulator/vendor/baguette-v0.1.98-macOS-arm64/Baguette_Baguette.bundle/Web/stream-session.js','utf8'),{window,WebSocket:Socket,ArrayBuffer,setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),setInterval:()=>1,clearInterval(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
 const session=new window.StreamSession({udid:'test',format:'h264',canvas:{getContext:()=>({})}});session.start();sockets[0].onclose();assert.equal(timers.size,1);assert.equal(disposed,1);
 const retry=[...timers.values()][0];timers.clear();retry();assert.equal(sockets.length,2);
 sockets[1].onclose();assert.equal(timers.size,1);session.stop();assert.equal(timers.size,0);
 session.start();session.stop();assert.equal(sockets[2].onclose,null);assert.equal(sockets[2].onmessage,null);
});
