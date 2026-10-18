// Real content scripts and layout; only the extension transport/model are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const require=createRequire(import.meta.url);
const extension=process.env.CINDY_EXTENSION_DIR||path.resolve(import.meta.dirname,'../my-browser/extension');
const brandURL='data:image/png;base64,'+(await fs.readFile(path.join(extension,'icons/48.png'))).toString('base64');

test('automatic video entries stay inside adapted controls',{
  skip:!process.env.PLAYWRIGHT_CORE,timeout:30000,
},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  t.after(()=>browser.close());

  async function fixture(markup,theme='light'){
    const page=await browser.newPage({viewport:{width:1100,height:720}});
    t.after(()=>page.close());
    await page.route('https://video.test/**',route=>route.fulfill({contentType:'text/html',body:`
      <meta charset="utf-8"><style>body{margin:0;background:${theme==='dark'?'#181818':'#fff'};color:${theme==='dark'?'#fff':'#222'};font:16px sans-serif}
      main{margin:80px 100px}.player{position:relative;width:800px;height:450px;background:#45576b}
      video{display:block;width:100%;height:100%}.ytp-right-controls{position:absolute;bottom:0;right:0;height:40px}
      h1{font-size:20px;font-weight:500}</style><main><h1>播放器入口回归验证 · ${theme}</h1>${markup}</main>`}));
    await page.goto('https://video.test/');
    await page.evaluate(brandURL=>{
      globalThis.browser={runtime:{id:'fixture',getURL:()=>brandURL,
        onMessage:{addListener(fn){globalThis.command=fn;},removeListener(){}},
        async sendMessage(m){return m.type==='cindy-learning'?{ok:true,locale:'zh-CN',features:[]}:{ok:true,enabled:false,cues:[]};}},
        storage:{local:{async get(){return {cindyReadingPreferences:{webTarget:'zh-CN',autoVideo:false,videoMode:'off'}};}},
          onChanged:{addListener(){},removeListener(){}}}};
    },brandURL);
    const bounds=await page.locator('video').boundingBox();
    for(const file of ['learning-core.js','subtitle-playback.js','ui.js','reading-ui.js','content.js'])
      await page.addScriptTag({path:path.join(extension,file)});
    return {page,bounds};
  }
  async function screenshot(page,name){
    if(!process.env.CINDY_SCREENSHOTS)return;
    await fs.mkdir(process.env.CINDY_SCREENSHOTS,{recursive:true});
    await page.screenshot({path:path.join(process.env.CINDY_SCREENSHOTS,name+'.png')});
  }

  for(const theme of ['light','dark'])await t.test('unadapted feed keeps its layout and manual entry: '+theme,async()=>{
    const {page,bounds}=await fixture('<div class="player"><video></video></div>',theme);
    await page.waitForTimeout(1200); // Exercise the periodic re-insertion path too.
    assert.equal(await page.locator('[data-cindy-player-entry]').count(),0);
    assert.deepEqual(await page.locator('video').boundingBox(),bounds);
    await screenshot(page,'unadapted-'+theme);
    await page.evaluate(()=>{document.querySelector('.player').innerHTML='<video></video>';history.pushState({},'', '/next');});
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('[data-cindy-player-entry]').count(),0,'feed navigation must not recreate the icon');
    const opened=await page.evaluate(()=>new Promise(resolve=>command({type:'cindy-ui',action:'open'},{id:'fixture'},resolve)));
    assert.equal(opened.ok,true);
    const cdp=await page.context().newCDPSession(page);
    const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
    const text=await page.evaluate(()=>CindyUI.copy('zh-CN').video);
    let videoButton;
    function visit(node){
      if(node.nodeName==='BUTTON'&&node.children?.some(n=>n.nodeValue===text))videoButton=node;
      for(const child of [...(node.children||[]),...(node.shadowRoots||[])])visit(child);
    }
    visit(root);assert.ok(videoButton,'toolbar panel retains the manual video action');
    const {object}=await cdp.send('DOM.resolveNode',{nodeId:videoButton.nodeId});
    const {result}=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,
      functionDeclaration:'function(){const r=this.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}',returnByValue:true});
    await page.mouse.click(result.value.x,result.value.y);
    await page.locator('[data-cindy-captions]').waitFor();
    assert.equal(await page.locator('[data-cindy-player-entry]').count(),0);
  });

  await t.test('adapted player waits for controls, deduplicates and cleans up on navigation',async()=>{
    const {page}=await fixture('<div id="movie_player" class="player"><video></video></div>');
    assert.equal(await page.locator('[data-cindy-player-entry]').count(),0,'no fallback into the player itself');
    await page.evaluate(()=>{
      const controls=document.createElement('div');controls.className='ytp-right-controls';
      document.querySelector('#movie_player').append(controls);
      for(let i=0;i<3;i++)document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    assert.equal(await page.locator('.ytp-right-controls > [data-cindy-player-entry]').count(),1);
    await screenshot(page,'adapted-controls');
    await page.evaluate(()=>{
      const old=document.querySelector('.ytp-right-controls');
      const replacement=old.cloneNode(false);old.replaceWith(replacement);
      document.querySelector('#movie_player').append(old);
      old.className='obsolete-controls';
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    assert.equal(await page.locator('[data-cindy-player-entry]').count(),1,'remove entries from stale control bars');
    assert.equal(await page.locator('.ytp-right-controls > [data-cindy-player-entry]').count(),1);
    await page.evaluate(()=>document.querySelector('video').remove());
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('[data-cindy-player-entry]').count(),0,'removing the last video cleans up the entry');
    await page.evaluate(()=>{
      document.querySelector('#movie_player').prepend(document.createElement('video'));
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await page.evaluate(()=>{
      document.querySelector('#movie_player').removeAttribute('id');
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    assert.equal(await page.locator('[data-cindy-player-entry]').count(),0);
  });

  await t.test('extension invalidation removes its player entry',async()=>{
    const {page}=await fixture('<div id="movie_player" class="player"><video></video><div class="ytp-right-controls"></div></div>');
    assert.equal(await page.locator('[data-cindy-player-entry]').count(),1);
    await page.evaluate(()=>{browser.runtime=undefined;document.dispatchEvent(new Event('yt-navigate-finish'));});
    assert.equal(await page.locator('[data-cindy-player-entry]').count(),0);
  });
});
