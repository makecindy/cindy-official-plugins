import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../my-browser/extension/background.js',import.meta.url),'utf8');
const listenerSource=source.slice(source.indexOf('chrome.runtime.onMessage.addListener('),source.lastIndexOf('\nchain();'));
test('injected document receives no target after final authorization is revoked',async()=>{
  for(const revoked of [false,true]) {
    let listener, calls=0;
    const entry={url:'https://example.test/page',target:{base:'http://127.0.0.1:18819',session:'fixture'},tabId:7,documentId:'doc'};
    const targets=new Map([['job',entry]]);
    vm.runInNewContext(listenerSource,{targets,PAGE_URL_MAX:8192,chrome:{runtime:{onMessage:{addListener:fn=>listener=fn}}},fetchJSON:async(_base,path,_session,body)=>{
      calls++;assert.equal(path,'/authorize');assert.equal(body.id,'job');assert.equal(body.url,entry.url);assert.equal(body.dispatch,true);
      if(revoked)throw new Error('JOB_EXPIRED');return {ok:true};
    }});
    const response=await new Promise(resolve=>listener({type:'my-browser-target',id:'job'},{tab:{id:7},documentId:'doc'},resolve));
    assert.equal(response,revoked?null:entry.url);assert.equal(calls,1);
    const foreign=await new Promise(resolve=>listener({type:'my-browser-target',id:'job'},{tab:{id:8},documentId:'other'},resolve));
    assert.equal(foreign,null);assert.equal(calls,1);
  }
});
