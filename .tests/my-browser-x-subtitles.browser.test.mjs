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
