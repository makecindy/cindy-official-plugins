// Real content script and native TextTracks in Chromium; caption transport/model are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const extension=process.env.CINDY_EXTENSION_DIR||path.resolve(import.meta.dirname,'../my-browser/extension');
test('same-language automatic subtitles leave native captions alone in both display modes', {skip:!process.env.PLAYWRIGHT_CORE,timeout:60000},async()=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  try{
    for(const mode of ['both','translation'])for(const nativeMode of ['showing','disabled']){
      const page=await browser.newPage({viewport:{width:1000,height:800}});
      await page.route('https://www.youtube.com/**',r=>r.fulfill({contentType:'text/html',body:'<meta charset="utf-8"><div id="movie_player" style="position:relative;width:800px;height:450px"><video style="width:100%;height:100%"></video><div class="ytp-caption-window-container" style="visibility:visible">Site captions</div></div>'}));
      await page.goto('https://www.youtube.com/watch?v=fixture');
      await page.evaluate(({mode,nativeMode})=>{
        globalThis.roots=[];const attach=Element.prototype.attachShadow;
        Element.prototype.attachShadow=function(options){const root=attach.call(this,options);roots.push(root);return root;};
        const video=document.querySelector('video'),track=video.addTextTrack('subtitles','中文','zh-Hans');
        track.mode='hidden';track.addCue(new VTTCue(0,10,'中文字幕'));track.mode=nativeMode;
        globalThis.calls=[];globalThis.reads=0;
        const store={cindyReadingPreferences:{videoTarget:'zh-CN',webTarget:'zh-CN',autoVideo:true,videoMode:mode}};
        globalThis.changeTarget=value=>{const oldValue=store.cindyReadingPreferences;const newValue={...oldValue,videoTarget:value};store.cindyReadingPreferences=newValue;storageChanged({cindyReadingPreferences:{oldValue,newValue}},'local');};
        globalThis.browser={runtime:{id:'fixture',getURL:()=>'data:,',onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},async sendMessage(m){
          if(m.type==='cindy-captions'){reads++;return {ok:true,language:'zh-Hans',cues:[{start:0,end:10,text:'中文字幕'}]};}
          if(m.type!=='cindy-learning')return {ok:true,enabled:false};
          const q=m.request;calls.push(q.op);
          if(q.op==='config')return {ok:true,locale:'zh-CN',features:['subtitle-segmentation-v1','subtitle-editorial-v1']};
          if(q.op==='subtitles')return {ok:true,cues:[{start:0,end:10,text:'中文字幕',translation:'Translated caption'}]};
          return {ok:true};
        }},storage:{local:{async get(){return store;},async set(v){Object.assign(store,v);}},onChanged:{addListener(fn){globalThis.storageChanged=fn;},removeListener(){}}}};
      },{mode,nativeMode});
      for(const file of ['brand-icon.js','learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])await page.addScriptTag({path:path.join(extension,file)});
      await page.waitForFunction(()=>reads>0&&roots.some(r=>r.querySelector('.caption-box')));
      const state=()=>page.evaluate(()=>{
        const box=roots.map(r=>r.querySelector('.caption-box')).find(Boolean);
        return {hidden:box.hidden,native:document.querySelector('video').textTracks[0].mode,visibility:document.querySelector('.ytp-caption-window-container').style.visibility,translations:calls.filter(x=>x==='subtitles').length};
      });
      await page.waitForTimeout(1500); // Includes the next caption read, which must not re-hide the track.
      assert.deepEqual(await state(),{hidden:true,native:nativeMode,visibility:'visible',translations:0},`${mode}/${nativeMode}`);
      await page.evaluate(()=>document.querySelector('#movie_player').append(document.createElement('span')));
      await page.waitForTimeout(50);
      assert.equal((await state()).visibility,'visible','DOM changes must not suppress native captions');
      // A different target starts translation; returning to Chinese immediately relinquishes captions.
      await page.evaluate(()=>changeTarget('en'));
      await page.waitForFunction(()=>calls.includes('subtitles'));
      await page.waitForTimeout(100);
      assert.equal((await state()).hidden,false);
      assert.equal((await state()).visibility,'hidden');
      await page.evaluate(()=>changeTarget('zh-TW'));
      await page.waitForTimeout(100);
      assert.equal((await state()).hidden,true);
      assert.equal((await state()).native,nativeMode);
      assert.equal((await state()).visibility,'visible');
      // Explicit "translate anyway" remains an escape hatch. Use a real trusted click.
      await page.evaluate(()=>new Promise(resolve=>command({type:'cindy-ui',action:'open'},{id:'fixture'},resolve)));
      const point=await page.evaluate(()=>{const button=roots.flatMap(r=>[...r.querySelectorAll('button')]).find(b=>b.textContent==='仍然翻译');if(!button)return null;button.scrollIntoView();const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
      assert.ok(point,'translate-anyway control');await page.mouse.click(point.x,point.y);
      await page.waitForFunction(()=>calls.filter(x=>x==='subtitles').length>=2);
      assert.equal((await state()).hidden,false);
      await page.close();
    }
  }finally{await browser.close();}
});
