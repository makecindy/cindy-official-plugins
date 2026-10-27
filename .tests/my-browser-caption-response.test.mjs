import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const core=require('../my-browser/extension/learning-core.js');
const uiContext={};
vm.runInNewContext(fs.readFileSync(new URL('../my-browser/extension/ui.js',import.meta.url),'utf8'),uiContext);
const ui=uiContext.CindyUI;
const source=fs.readFileSync(new URL('../my-browser/extension/background.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('async function fetchYoutubeCaptions('),source.indexOf('\nchrome.runtime.onMessage.addListener',source.indexOf('async function fetchYoutubeCaptions(')));
function read(fetch){
 const context={fetch,AbortSignal,TextDecoder,Uint8Array,CindyLearning:core};
 vm.runInNewContext(helper+'\nglobalThis.read=fetchYoutubeCaptions;',context);
 return context.read('https://www.youtube.com/api/timedtext?v=fixture&fmt=json3');
}
test('YouTube HTTP 200 with an empty body is a source failure, not UNKNOWN_ERROR',async()=>{
 for(const body of ['', '  ', JSON.stringify({events:[]})])
  await assert.rejects(read(async()=>new Response(body)),/SUBTITLE_EMPTY/);
 assert.match(ui.error('SUBTITLE_EMPTY','zh-CN'),/字幕内容为空/);
 assert.doesNotMatch(ui.error('SUBTITLE_EMPTY','zh-CN'),/UNKNOWN_ERROR/);
});
test('invalid caption payloads do not leak response text into errors',async()=>{
 for(const body of ['<html>private response</html>','null','{}'])
  await assert.rejects(read(async()=>new Response(body)),/^Error: SUBTITLE_RESPONSE_INVALID$/);
});
test('caption transport failures and timeouts have distinct stable codes',async()=>{
 await assert.rejects(read(async()=>{throw new TypeError('Failed to fetch');}),/SUBTITLE_FETCH_FAILED/);
 await assert.rejects(read(async()=>{throw new DOMException('expired','TimeoutError');}),/SUBTITLE_TIMEOUT/);
 await assert.rejects(read(async()=>new Response('blocked',{status:403})),/SUBTITLE_UNAVAILABLE/);
});
test('caption stream failures retain the size limit and cancel the reader',async()=>{
 let cancelled=false;
 await assert.rejects(read(async()=>({ok:true,body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(2000001)}),cancel:async()=>{cancelled=true;}})}})),/SUBTITLE_TOO_LARGE/);
 assert.equal(cancelled,true);
 cancelled=false;
 await assert.rejects(read(async()=>({ok:true,body:{getReader:()=>({read:async()=>{throw Error('connection lost');},cancel:async()=>{cancelled=true;}})}})),/SUBTITLE_FETCH_FAILED/);
 assert.equal(cancelled,true);
});
test('valid timed captions preserve timestamps without sending cookies or following redirects',async()=>{
 const cues=await read(async(url,options)=>{
  assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.ok(options.signal);
  return new Response(JSON.stringify({events:[{tStartMs:1000,dDurationMs:2000,segs:[{utf8:'Hello world.'}]}]}));
 });
 assert.equal(cues.length,1);assert.equal(cues[0].start,1);assert.equal(cues[0].text,'Hello world.');
});

// Exercise the shipped message handler as well as its parser: an empty
// timedtext response must reach the transcript fallback and return usable cues.
async function captions({body='',fallbackError,changed=false,configError,playerText,playerError}={}){
 const start=source.indexOf("chrome.runtime.onMessage.addListener((m,sender,reply)=>{",source.indexOf('async function fetchYoutubeCaptions('));
 const end=source.indexOf('// Resume only',start);
 let handler,reads=0,checks=0;
 const pageURL='https://www.youtube.com/watch?v=fixture';
 const cues=[{start:0,end:2,text:'Hello world.'}];
 const fallback=()=>{};
 const context={
  URL,crypto,AbortSignal,TextDecoder,Uint8Array,CindyLearning:core,
  CindyYoutubeTranscript:{read:fallback},
  fetch:async()=>new Response(body),
  learningRequest:async()=>{checks++;if(configError)throw Object.assign(Error(configError),{reason:'DOCUMENT_UNAVAILABLE'});return {ok:true};},
  network:{document:async()=> 'fixture-document'},
  chrome:{runtime:{id:'fixture',onMessage:{addListener:f=>handler=f}},
   tabs:{get:async()=>({id:7,url:changed&&reads>1?pageURL+'-changed':pageURL})},
   scripting:{executeScript:async args=>{
    assert.equal(args.target.tabId,7);assert.deepEqual([...args.target.documentIds],['fixture-document']);assert.equal(args.world,'MAIN');reads++;
    if(args.func===fallback){
     assert.equal(args.args[0],pageURL);
     return [{documentId:'fixture-document',result:fallbackError?{ok:false,error:fallbackError}:{ok:true,cues}}];
    }
    if(args.func.name==='readPlayerTimedtext'){
     assert.deepEqual([...args.args],['en']);
     return [{documentId:'fixture-document',result:playerError?{ok:false,error:playerError}:playerText===undefined?{ok:false,error:'SUBTITLE_UNAVAILABLE'}:{ok:true,text:playerText}}];
    }
    return [{documentId:'fixture-document',result:[{url:'https://www.youtube.com/api/timedtext?v=fixture',language:'en'}]}];
   }},
  },
 };
 vm.runInNewContext(helper+'\n'+source.slice(start,end),context);
 const result=await new Promise(resolve=>handler({type:'cindy-captions'},{id:'fixture',tab:{id:7},documentId:'fixture-document'},resolve));
 return {result,reads,checks};
}
test('empty YouTube response automatically returns native transcript cues',async()=>{
 const {result,reads,checks}=await captions();
 assert.equal(result.ok,true);assert.equal(result.cues[0].text,'Hello world.');assert.equal(reads,3);assert.equal(checks,2);
});
// Bug regression: timedtext now answers extension requests with an empty 200 because the
// player's proof-of-origin token is missing. The player-assisted read must serve the cues
// before the transcript panel is touched, and its own failures still fall through to it.
test('empty YouTube response is retried through the player request before the transcript panel',async()=>{
 const timed=JSON.stringify({events:[{tStartMs:500,dDurationMs:1500,segs:[{utf8:'From the player.'}]}]});
 const {result,reads}=await captions({playerText:timed});
 assert.equal(result.ok,true);assert.equal(result.cues[0].text,'From the player.');assert.equal(result.cues[0].start,0.5);assert.equal(reads,2);
 const invalid=await captions({playerText:'<html>login</html>'});
 assert.equal(invalid.result.ok,true);assert.equal(invalid.result.cues[0].text,'Hello world.');assert.equal(invalid.reads,3);
 assert.equal((await captions({playerText:'<html>login</html>',fallbackError:'SUBTITLE_UNAVAILABLE'})).result.error,'SUBTITLE_RESPONSE_INVALID');
 assert.equal((await captions({playerError:'SUBTITLE_TOO_LARGE'})).result.error,'SUBTITLE_TOO_LARGE');
});
test('caption fallback preserves authorization and document checks',async()=>{
 const denied=await captions({configError:'PAIRING_REQUIRED'});
 assert.equal(denied.result.error,'PAIRING_REQUIRED');assert.equal(denied.reads,0);
 assert.equal((await captions({changed:true})).result.error,'PAGE_CHANGED');
 assert.equal((await captions({fallbackError:'SUBTITLE_UNAVAILABLE'})).result.error,'SUBTITLE_EMPTY');
});

test('caption handler preserves document failure reason for the panel',async()=>{
 const {result}=await captions({configError:'ADDRESS_UNVERIFIED'});assert.equal(result.reason,'DOCUMENT_UNAVAILABLE');
});
