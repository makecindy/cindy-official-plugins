// Real content scripts on an X-shaped page; the DOM mirrors x.com and the transport/model are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';

const require=createRequire(import.meta.url);
const extension=process.env.CINDY_EXTENSION_DIR||path.resolve(import.meta.dirname,'../my-browser/extension');
const poster=id=>`https://pbs.twimg.com/amplify_video_thumb/${id}/img/a.jpg`;
const player=id=>`<div data-testid="tweet"><a href="/u/status/9${id}"><time>t</time></a><div data-testid="videoPlayer" class="p"><div class="c"><video poster="${poster(id)}"></video></div><div class="row"><div><button data-testid="captions">CC</button></div><div><button>Fullscreen</button></div></div></div></div>`;

test('X: each player has its own entry, session and identity',{skip:!process.env.PLAYWRIGHT_CORE,timeout:30000},async()=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  try{
    const page=await browser.newPage({viewport:{width:1000,height:1300}});page.setDefaultTimeout(6000);
    await page.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><style>.p{position:relative;width:560px;height:315px;background:#333;margin:10px}.c,video{width:100%;height:100%}.row{position:absolute;bottom:0;right:0;display:flex;height:40px}</style>${player(111)}${player(222)}`}));
    await page.route('https://pbs.twimg.com/**',route=>route.abort());
    await page.goto('https://x.com/home');
    await page.evaluate(()=>{
      globalThis.log=[];
      for(const video of document.querySelectorAll('video')){
        const real=video.addTextTrack('subtitles','en (auto-generated)','en');real.mode='hidden';
        real.addCue(new VTTCue(0,2,'<X-word-ms ms=10,20 index=1 character_ranges=0-4,6-10>hello there</X-word-ms>'));
        real.addCue(new VTTCue(2,4,'<X-word-ms ms=10,20 index=2 character_ranges=0-4,6-10>general kenobi</X-word-ms>'));
        real.mode='disabled';
        // X renders its own captions through a copy holding the current cue.
        const clone=video.addTextTrack('subtitles','clone','en');clone.mode='showing';clone.addCue(new VTTCue(0,2,'hello'));
      }
      const store={cindyReadingPreferences:{webTarget:'zh-CN',videoTarget:'zh-CN',autoVideo:true,videoMode:'both'}};
      globalThis.browser={runtime:{id:'fixture',getURL:()=>'data:,',onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},async sendMessage(m){
        if(m.type!=='cindy-learning')return {ok:true,enabled:false,cues:[]};
        const q=m.request;log.push({op:q.op,videoId:q.source?.videoId,words:q.words?.map(w=>w.text).join(' ')});
        if(q.op==='config')return {ok:true,locale:'zh-CN',features:['subtitle-segmentation-v1','subtitle-editorial-v1']};
        if(q.op==='subtitles')return {ok:true,cues:[{start:q.words[0].start,end:q.words.at(-1).end,text:'t',translation:'译'}]};
        return {ok:true};
      }},storage:{local:{async get(){return store;},async set(v){Object.assign(store,v);}},onChanged:{addListener(){},removeListener(){}}}};
    });
    for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])
      await page.addScriptTag({path:path.join(extension,file)});

    const players=page.locator('[data-testid="videoPlayer"]');
    const entry=i=>players.nth(i).locator('[data-cindy-player-entry]');
    await players.nth(1).hover();
    await entry(0).waitFor({state:'attached'});await entry(1).waitFor({state:'attached'});
    await page.waitForTimeout(1500);
    assert.deepEqual(await page.evaluate(()=>log.filter(x=>x.op==='subtitles')),[],'an autoplaying feed must not start translation unasked');
    assert.equal(await page.locator('[data-cindy-captions]').count(),0);
    // The entry sits beside X's own captions button, without replacing it.
    assert.equal(await players.nth(0).locator('.row > *').count(),3);

    const lastWords=()=>page.evaluate(()=>log.filter(x=>x.op==='subtitles').at(-1));
    await entry(1).click();
    await page.waitForFunction(()=>log.some(x=>x.op==='subtitles'));
    const second=await lastWords();
    assert.equal(second.videoId,'x:222','the clicked player is read, not the first on the page');
    assert.match(second.words,/hello there general kenobi/);
    assert.doesNotMatch(second.words,/X-word-ms/);
    assert.equal(await players.nth(1).locator('[data-cindy-captions]').count(),1);
    assert.equal(await entry(1).count(),0,'the session control replaces the entry on its own player');
    assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('video')[1].textTracks].map(t=>t.mode)),['hidden','hidden'],'the real track loads and X\'s copy stays hidden');

    await page.keyboard.press('Escape');
    await entry(0).click();
    await page.waitForFunction(()=>log.filter(x=>x.op==='subtitles').at(-1)?.videoId==='x:111');
    assert.equal(await players.nth(1).locator('[data-cindy-captions]').count(),0,'choosing another player moves the session');
    assert.equal(await players.nth(0).locator('[data-cindy-captions]').count(),1);

    // X removes players scrolled far away; another one must not start by itself.
    await page.evaluate(()=>document.querySelectorAll('video')[0].remove());
    await page.waitForFunction(()=>!document.querySelector('[data-cindy-captions]'));
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('[data-cindy-captions]').count(),0);
    assert.equal(await lastWords().then(x=>x.videoId),'x:111');

    // A video without any caption track opens from the panel and asks for a file instead of failing.
    await page.evaluate(()=>{const row=document.querySelectorAll('[data-testid="videoPlayer"]')[1];row.querySelector('.row').remove();const old=row.querySelector('video'),next=document.createElement('video');next.poster=old.poster;old.replaceWith(next);log.length=0;});
    await page.evaluate(()=>new Promise(resolve=>command({type:'cindy-ui',action:'video'},{id:'fixture'},resolve)));
    await page.locator('[data-cindy-captions]').waitFor({state:'attached'});
    await page.waitForTimeout(1500);
    assert.deepEqual(await page.evaluate(()=>log.filter(x=>x.op==='subtitles')),[]);
    assert.equal(await page.locator('[data-cindy-captions]').count(),1);
  }finally{await browser.close();}
});

test('generic pages: video inside a web component, the right caption language',{skip:!process.env.PLAYWRIGHT_CORE,timeout:30000},async()=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  try{
    const page=await browser.newPage({viewport:{width:1000,height:700}});page.setDefaultTimeout(6000);
    await page.route('https://video.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><meta charset="utf-8"><svg><circle r="1"/></svg><my-player style="display:block;width:640px;height:360px"></my-player>'}));
    await page.goto('https://video.test/');
    await page.evaluate(()=>{
      const inner=document.querySelector('my-player').attachShadow({mode:'open'}),box=document.createElement('div');box.style.cssText='position:relative;width:640px;height:360px';const video=document.createElement('video');video.style.cssText='width:100%;height:100%;background:#222';box.append(video);inner.append(box);
      for(const [language,text]of [['pt-br','bom dia pessoal'],['en','good morning everyone']]){const track=video.addTextTrack('subtitles',language,language);track.mode='hidden';track.addCue(new VTTCue(0,3,text));track.mode='disabled';}
      globalThis.log=[];const store={cindyReadingPreferences:{webTarget:'zh-CN',videoTarget:'zh-CN',autoVideo:false,videoMode:'both'}};
      globalThis.browser={runtime:{id:'fixture',getURL:()=>'data:,',onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},async sendMessage(m){
        if(m.type!=='cindy-learning')return {ok:true,enabled:false,cues:[]};const q=m.request;if(q.op==='subtitles')log.push(q.words.map(w=>w.text).join(' '));
        if(q.op==='config')return {ok:true,locale:'zh-CN',features:['subtitle-segmentation-v1','subtitle-editorial-v1']};
        if(q.op==='subtitles')return {ok:true,cues:[{start:q.words[0].start,end:q.words.at(-1).end,text:'t',translation:'译'}]};return {ok:true};}},storage:{local:{async get(){return store;},async set(v){Object.assign(store,v);}},onChanged:{addListener(){},removeListener(){}}}};
    });
    for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])await page.addScriptTag({path:path.join(extension,file)});
    await page.evaluate(()=>new Promise(resolve=>command({type:'cindy-ui',action:'video'},{id:'fixture'},resolve)));
    await page.waitForFunction(()=>log.length>0);
    assert.match(await page.evaluate(()=>log[0]),/good morning everyone/,'English, on an English page, not the first track listed');
    assert.equal(await page.evaluate(()=>!!document.querySelector('my-player').shadowRoot.querySelector('[data-cindy-captions]')),true);
  }finally{await browser.close();}
});

// The feed draws the thumbnail as an image and wraps the timestamp; a post opened from the feed
// replaces the player with another element showing the same video.
test('X: feed players keep their own identity, and subtitles follow a post opened from the feed',{skip:!process.env.PLAYWRIGHT_CORE,timeout:40000},async()=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  const feedPlayer=(post,media)=>`<article data-testid="tweet"><a href="/u/status/${post}"><span><time>t</time></span></a><div data-testid="videoPlayer" class="p"><div class="c"><video></video>${media?`<img src="${poster(media)}">`:''}</div><div class="row"><div><button data-testid="captions">CC</button></div><div><button>Fullscreen</button></div></div></div></article>`;
  try{
    const page=await browser.newPage({viewport:{width:1000,height:1300}});page.setDefaultTimeout(8000);
    await page.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><style>.p{position:relative;width:560px;height:315px;background:#333;margin:10px}.c,video{width:100%;height:100%}img{display:none}.row{position:absolute;bottom:0;right:0;display:flex;height:40px}</style><main>${feedPlayer(9111,111)}${feedPlayer(9222)}<article data-testid="tweet"><div data-testid="videoPlayer" class="p"><div class="c"><video></video></div><div class="row"><div><button data-testid="captions">CC</button></div><div><button>Fullscreen</button></div></div></div></article></main>`}));
    await page.route('https://pbs.twimg.com/**',route=>route.abort());
    await page.goto('https://x.com/home');
    await page.evaluate(()=>{
      globalThis.captions=video=>{const real=video.addTextTrack('subtitles','en (auto-generated)','en');real.mode='hidden';real.addCue(new VTTCue(0,2,'hello there'));real.addCue(new VTTCue(2,4,'general kenobi'));real.mode='disabled';};
      for(const video of document.querySelectorAll('video'))captions(video);
      globalThis.log=[];const store={cindyReadingPreferences:{webTarget:'zh-CN',videoTarget:'zh-CN',autoVideo:true,videoMode:'both'}};
      globalThis.browser={runtime:{id:'fixture',getURL:()=>'data:,',onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},async sendMessage(m){
        if(m.type!=='cindy-learning')return {ok:true,enabled:false,cues:[]};
        const q=m.request;log.push({op:q.op,videoId:q.source?.videoId});
        if(q.op==='config')return {ok:true,locale:'zh-CN',features:['subtitle-segmentation-v1','subtitle-editorial-v1']};
        if(q.op==='subtitles')return {ok:true,cues:[{start:q.words[0].start,end:q.words.at(-1).end,text:'t',translation:'译'}]};
        return {ok:true};
      }},storage:{local:{async get(){return store;},async set(v){Object.assign(store,v);}},onChanged:{addListener(){},removeListener(){}}}};
    });
    for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])
      await page.addScriptTag({path:path.join(extension,file)});
    const players=page.locator('[data-testid="videoPlayer"]');
    const entry=i=>players.nth(i).locator('[data-cindy-player-entry]');
    const sent=()=>page.evaluate(()=>log.filter(x=>x.op==='subtitles').map(x=>x.videoId));
    const start=async i=>{await players.nth(i).hover();await entry(i).click();await page.waitForFunction(()=>log.some(x=>x.op==='subtitles'));const ids=await sent();await page.evaluate(()=>{log.length=0;});return ids.at(-1);};

    assert.equal(await start(1),'x:9222','without a thumbnail, the post the player sits in, never the feed address');
    const first=await start(2);
    assert.match(first,/^x:s-[0-9a-f-]{36}$/,'an unrecognised player gets an identity of its own');
    assert.equal(await start(1),'x:9222');
    assert.notEqual(await start(2),first,'a new session on it never reuses an earlier one');
    assert.equal(await start(0),'x:111','the media id from the thumbnail the feed draws');

    // Opening the post: the address changes and X mounts a new element for the same video.
    await page.evaluate(()=>{history.pushState({},'','/u/status/9111');const main=document.querySelector('main');main.innerHTML=`<article data-testid="tweet"><a href="/u/status/9111"><time>t</time></a><div data-testid="videoPlayer" class="p"><div class="c"><video poster="https://pbs.twimg.com/amplify_video_thumb/111/img/a.jpg"></video></div><div class="row"><div><button data-testid="captions">CC</button></div><div><button>Fullscreen</button></div></div></div></article>`;captions(main.querySelector('video'));});
    await page.waitForFunction(()=>log.some(x=>x.op==='subtitles'));
    assert.deepEqual([...new Set(await sent())],['x:111'],'the subtitles continue under the same identity, unasked');
    assert.equal(await page.locator('[data-cindy-captions]').count(),1);

    // A different video on the next page is not started by itself.
    await page.evaluate(()=>{log.length=0;history.pushState({},'','/v/status/9333');const main=document.querySelector('main');main.innerHTML=`<article data-testid="tweet"><a href="/v/status/9333"><time>t</time></a><div data-testid="videoPlayer" class="p"><div class="c"><video poster="https://pbs.twimg.com/amplify_video_thumb/333/img/a.jpg"></video></div></div></article>`;captions(main.querySelector('video'));});
    await page.waitForTimeout(2500);
    assert.deepEqual(await sent(),[]);
    assert.equal(await page.locator('[data-cindy-captions]').count(),0);
  }finally{await browser.close();}
});

// A carried session is a convenience, never a new decision: it must not undo a cancel or a page translation.
for(const scenario of ['cancelled','page-translation']){
  test(`X: subtitles do not follow into the post after ${scenario==='cancelled'?'the person cancelled them':'a page translation started'}`,{skip:!process.env.PLAYWRIGHT_CORE,timeout:40000},async()=>{
    const {chromium}=require(process.env.PLAYWRIGHT_CORE);
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
    const feed=`<article data-testid="tweet"><p>Feed text that can be translated</p><a href="/u/status/9111"><time>t</time></a><div data-testid="videoPlayer" class="p"><div class="c"><video></video><img src="${poster(111)}"></div><div class="row"><div><button data-testid="captions">CC</button></div><div><button>Fullscreen</button></div></div></div></article>`;
    const post=`<article data-testid="tweet"><p>Post text that can be translated</p><a href="/u/status/9111"><time>t</time></a><div data-testid="videoPlayer" class="p"><div class="c"><video poster="${poster(111)}"></video></div><div class="row"><div><button data-testid="captions">CC</button></div><div><button>Fullscreen</button></div></div></div></article>`;
    try{
      const page=await browser.newPage({viewport:{width:1000,height:1300}});page.setDefaultTimeout(8000);
      await page.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><style>.p{position:relative;width:560px;height:315px;background:#333;margin:10px}.c,video{width:100%;height:100%}img{display:none}.row{position:absolute;bottom:0;right:0;display:flex;height:40px}</style><main>${feed}</main>`}));
      await page.route('https://pbs.twimg.com/**',route=>route.abort());
      await page.goto('https://x.com/home');
      await page.evaluate(({post,scenario})=>{
        // Open shadow roots let the test reach the cancel button.
        const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(init){return attach.call(this,{...init,mode:'open'});};
        globalThis.captions=video=>{const real=video.addTextTrack('subtitles','en (auto-generated)','en');real.mode='hidden';real.addCue(new VTTCue(0,2,'hello there'));real.addCue(new VTTCue(2,4,'general kenobi'));real.mode='disabled';};
        captions(document.querySelector('video'));
        globalThis.post=post;globalThis.log=[];globalThis.release=null;
        const gate=new Promise(resolve=>{globalThis.release=resolve;});
        const store={cindyReadingPreferences:{webTarget:'zh-CN',videoTarget:'zh-CN',autoVideo:true,videoMode:'both'}};globalThis.store=store;
        globalThis.browser={runtime:{id:'fixture',getURL:()=>'data:,',onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},async sendMessage(m){
          if(m.type!=='cindy-learning')return {ok:true,enabled:false,cues:[]};
          const q=m.request;log.push({op:q.op,videoId:q.source?.videoId});
          if(q.op==='config')return {ok:true,locale:'zh-CN',features:['subtitle-segmentation-v1','subtitle-editorial-v1']};
          if(q.op==='translate')return {ok:true,translations:q.texts.map(()=>'译')};
          if(q.op==='subtitles'){if(scenario==='cancelled')await gate;return {ok:true,cues:[{start:q.words[0].start,end:q.words.at(-1).end,text:'t',translation:'译'}]};}
          return {ok:true};
        }},storage:{local:{async get(){return store;},async set(v){Object.assign(store,v);}},onChanged:{addListener(){},removeListener(){}}}};
      },{post,scenario});
      for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])
        await page.addScriptTag({path:path.join(extension,file)});
      const player=page.locator('[data-testid="videoPlayer"]');
      await player.hover();await player.locator('[data-cindy-player-entry]').click();
      await page.waitForFunction(()=>log.some(x=>x.op==='subtitles'));
      if(scenario==='cancelled'){
        await page.evaluate(()=>new Promise(resolve=>command({type:'cindy-ui',action:'video'},{id:'fixture'},resolve)));
        await page.locator('[data-cindy-captions] button',{hasText:/^(取消|Cancel)$/}).click();
      }else{
        await page.evaluate(()=>{store.cindyReadingPreferences.autoSites={'https://x.com':true};});
      }
      await page.evaluate(()=>{log.length=0;history.pushState({},'','/u/status/9111');const main=document.querySelector('main');main.innerHTML=post;captions(main.querySelector('video'));});
      await page.waitForTimeout(3000);
      assert.deepEqual(await page.evaluate(()=>log.filter(x=>x.op==='subtitles')),[],'no paid subtitle request starts by itself');
      assert.equal(await page.locator('[data-cindy-captions]').count(),0);
      if(scenario==='page-translation')assert.ok(await page.evaluate(()=>log.some(x=>x.op==='translate')),'the page translation that was asked for still runs');
    }finally{await browser.close();}
  });
}

// X removes the old player and changes the address in either order; two timers notice them separately.
for(const order of ['player first','address first']){
  test(`X: subtitles follow into the post when the ${order} changes`,{skip:!process.env.PLAYWRIGHT_CORE,timeout:40000},async()=>{
    const {chromium}=require(process.env.PLAYWRIGHT_CORE);
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
    const markup=(href,thumb)=>`<article data-testid="tweet"><a href="${href}"><time>t</time></a><div data-testid="videoPlayer" class="p"><div class="c"><video${thumb?` poster="${poster(111)}"`:''}></video>${thumb?'':`<img src="${poster(111)}">`}</div><div class="row"><div><button data-testid="captions">CC</button></div><div><button>Fullscreen</button></div></div></div></article>`;
    try{
      const page=await browser.newPage({viewport:{width:1000,height:1300}});page.setDefaultTimeout(8000);
      await page.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><style>.p{position:relative;width:560px;height:315px;background:#333;margin:10px}.c,video{width:100%;height:100%}img{display:none}.row{position:absolute;bottom:0;right:0;display:flex;height:40px}</style><main>${markup('/u/status/9111',false)}</main>`}));
      await page.route('https://pbs.twimg.com/**',route=>route.abort());
      await page.goto('https://x.com/home');
      await page.evaluate(post=>{
        globalThis.captions=video=>{const real=video.addTextTrack('subtitles','en (auto-generated)','en');real.mode='hidden';real.addCue(new VTTCue(0,2,'hello there'));real.addCue(new VTTCue(2,4,'general kenobi'));real.mode='disabled';};
        captions(document.querySelector('video'));globalThis.post=post;globalThis.log=[];
        const store={cindyReadingPreferences:{webTarget:'zh-CN',videoTarget:'zh-CN',autoVideo:true,videoMode:'both'}};
        globalThis.browser={runtime:{id:'fixture',getURL:()=>'data:,',onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},async sendMessage(m){
          if(m.type!=='cindy-learning')return {ok:true,enabled:false,cues:[]};
          const q=m.request;log.push({op:q.op,videoId:q.source?.videoId});
          if(q.op==='config')return {ok:true,locale:'zh-CN',features:['subtitle-segmentation-v1','subtitle-editorial-v1']};
          if(q.op==='subtitles')return {ok:true,cues:[{start:q.words[0].start,end:q.words.at(-1).end,text:'t',translation:'译'}]};
          return {ok:true};
        }},storage:{local:{async get(){return store;},async set(v){Object.assign(store,v);}},onChanged:{addListener(){},removeListener(){}}}};
      },markup('/u/status/9111',true));
      for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])
        await page.addScriptTag({path:path.join(extension,file)});
      const player=page.locator('[data-testid="videoPlayer"]');
      await player.hover();await player.locator('[data-cindy-player-entry]').click();
      await page.waitForFunction(()=>log.some(x=>x.op==='subtitles'));
      await page.evaluate(()=>{log.length=0;});
      const swap=()=>page.evaluate(()=>{const main=document.querySelector('main');main.innerHTML=post;captions(main.querySelector('video'));});
      const navigate=()=>page.evaluate(()=>history.pushState({},'','/u/status/9111'));
      if(order==='player first'){await page.evaluate(()=>document.querySelector('video').remove());await page.waitForTimeout(2600);await navigate();await swap();}
      else{await navigate();await swap();}
      await page.waitForFunction(()=>log.some(x=>x.op==='subtitles'));
      assert.deepEqual([...new Set(await page.evaluate(()=>log.filter(x=>x.op==='subtitles').map(x=>x.videoId)))],['x:111']);
    }finally{await browser.close();}
  });
}
