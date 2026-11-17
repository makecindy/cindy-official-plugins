// Real sidepanel DOM in isolated Chromium; Chrome transport/model are fixtures.
// Covers tab switching during generation, extraction exclusions and narrow themes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('sidepanel chats with the active page and cancels stale work',{skip:!process.env.PLAYWRIGHT_CORE},async t=>{
  const {chromium}=require(process.env.PLAYWRIGHT_CORE);
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:320,height:720}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.fixture={tab:{id:1,url:'https://example.test/one',title:'First page'},calls:[],listeners:{},hold:false,stored:{},favorites:[]};const f=window.fixture;
    window.chrome={permissions:{contains:async()=>f.granted===true,request:async a=>{f.calls.push({permission:'request',...a});f.granted=f.allow===true;return f.granted;},remove:async a=>{f.calls.push({permission:'remove',...a});f.granted=false;return true;}},storage:{local:{get:async()=>({...f.stored}),set:async v=>Object.assign(f.stored,v),remove:async k=>{delete f.stored[k];}}},windows:{getCurrent:async()=>({id:9})},tabs:{query:async()=>[f.tab],sendMessage:async(id,m)=>{f.calls.push({tab:id,...m});return m.type==='cindy-page'&&m.action==='translate'?{ok:true,translated:true}:{ok:true};},onActivated:{addListener:fn=>f.listeners.active=fn},onUpdated:{addListener:fn=>f.listeners.update=fn}},scripting:{executeScript:async()=>[{frameId:0,documentId:'document-1',result:{text:'Answer: 42',source:{url:f.tab.url,title:f.tab.title}}}]},runtime:{onMessage:{addListener:fn=>{const prev=f.listeners.runtime;f.listeners.runtime=m=>{prev?.(m);fn(m);};}},sendMessage:async message=>{
      f.calls.push(message);if(message.type==='cindy-cancel')return {ok:true};
      if(message.request.op==='config')return {ok:true,locale:'zh-CN',features:['webpage-chat-v1','webpage-chat-models-v1']};
      if(message.request.op==='models')return {ok:true,preferences:'ok',favorites:f.favorites,recents:[{providerId:'b',modelId:'deep',agent:'codex'}],models:[{name:'Fixture Fast',provider:'Provider A',visible:true,route:{agentKind:'pi',providerId:'a',model:'fast',effort:'',fastMode:false},efforts:[]},{name:'Fixture Deep',provider:'Provider B',visible:true,supportsFastMode:true,defaultEffort:'medium',route:{agentKind:'codex',providerId:'b',model:'deep',effort:'medium',fastMode:false},efforts:['low','medium','high']}]};
      if(message.request.op==='model-favorite'){const m=message.request.mutation;if(m.kind==='add')f.favorites=[...f.favorites,{uid:'fav-'+f.favorites.length,...m.item}];if(m.kind==='remove')f.favorites=f.favorites.filter(x=>x.uid!==m.expected.uid);return {ok:true,favorites:f.favorites};}
      if(f.hold)return new Promise(resolve=>f.finish=resolve);
      if(f.answer)return {ok:true,text:f.answer};
      return {ok:true,text:'答案是 **42**。<script>bad()</script>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nx()\n```\n\n[bad](javascript:alert(1)) [ok](https://example.test/)'};
    }}};
  });
  await page.goto(new URL('../my-browser/extension/sidepanel.html',import.meta.url).href);
  // One click translates the page in place (no page panel); the button then offers the original.
  // Page commands never use cindy-ui: older page scripts open their panel for unknown cindy-ui actions.
  assert.equal(await page.locator('#tools').innerText(),'翻译');
  await page.locator('#tools').click();
  await page.waitForFunction(()=>document.querySelector('#tools').innerText==='原文');
  assert.ok(await page.evaluate(()=>fixture.calls.some(c=>c.type==='cindy-page'&&c.action==='translate'&&c.tab===1)));
  assert.ok(await page.evaluate(()=>!fixture.calls.some(c=>c.type==='cindy-ui')));
  // Settings write the same preferences the page scripts read.
  await page.locator('#settings').click();
  await page.getByRole('switch',{name:'选中文字时显示 Cindy 按钮'}).check();
  await page.evaluate(()=>{fixture.stored.cindyReadingPreferences={...fixture.stored.cindyReadingPreferences,autoVideo:false,videoMode:'translation'};});
  await page.getByRole('switch',{name:'选中文字时显示 Cindy 按钮'}).uncheck();await page.getByRole('switch',{name:'选中文字时显示 Cindy 按钮'}).check();
  await page.waitForFunction(()=>fixture.stored.cindyReadingPreferences?.selectionButton===true);
  // A change keeps the other preferences the page scripts use.
  assert.equal(await page.evaluate(()=>fixture.stored.cindyReadingPreferences.videoMode),'translation');
  await page.locator('.setting-select').selectOption('ja');
  await page.waitForFunction(()=>fixture.stored.cindyReadingPreferences?.webTarget==='ja');
  // Tab grouping is a switch here: Chrome is asked only when it is turned on; a denial leaves it off.
  const groups=page.getByRole('switch',{name:/把 Cindy 打开的标签页放进分组/});
  await groups.click();await page.waitForFunction(()=>fixture.calls.some(c=>c.permission==='request'&&c.permissions?.[0]==='tabGroups'));
  assert.equal(await groups.isChecked(),false,'a denied permission leaves the switch off');
  await page.evaluate(()=>fixture.allow=true);await groups.click();
  await page.waitForFunction(()=>fixture.granted===true);assert.equal(await groups.isChecked(),true);
  await groups.click();await page.waitForFunction(()=>fixture.calls.some(c=>c.permission==='remove'));
  await page.getByRole('radio',{name:'仅译文'}).click();
  await page.waitForFunction(()=>fixture.stored.cindyReadingPreferences?.webMode==='translation');
  await page.getByRole('button',{name:'返回'}).click();
  // The page panel's settings button lands on these settings.
  await page.evaluate(()=>fixture.listeners.runtime({type:'cindy-sidepanel-view',view:'settings'}));
  await page.getByRole('button',{name:'返回'}).waitFor();
  await page.getByRole('button',{name:'返回'}).click();
  assert.equal(await page.locator('#question').isVisible(),true);
  // The picker lists Cindy's models; a configured effort/Fast travels with the question, and stars edit the app's favorites.
  await page.locator('#model').click();await page.locator('.mp-panel.settled').waitFor();
  const deep=page.locator('.mp-row[data-anchor^="model:"]',{hasText:'Fixture Deep'});
  await deep.hover();await deep.locator('.mp-star').click();
  await page.waitForFunction(()=>fixture.favorites.length===1);
  assert.deepEqual(await page.evaluate(()=>fixture.favorites[0]),{uid:'fav-0',providerId:'b',modelId:'deep',agent:'codex'});
  await deep.hover();await deep.locator('.mp-customize').click();
  await page.locator('.mf-thumb').focus();await page.keyboard.press('End');await page.locator('.mf-fast').click();
  await page.keyboard.press('Escape');await deep.click();
  assert.match(await page.locator('#model').innerText(),/Fixture Deep/);
  assert.equal(await page.evaluate(()=>fixture.stored.sidepanelModel?.effort),'high');
  await page.getByPlaceholder('问问当前网页…').fill('是多少？');await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.locator('.message.assistant').waitFor();
  assert.match(await page.locator('.message.assistant').innerText(),/42/);
  assert.equal(await page.locator('.message.assistant script').count(),0);
  // Answers render as Markdown like the Cindy app; HTML and unsafe links never become live.
  assert.equal(await page.locator('.message.assistant strong').innerText(),'42');
  assert.equal(await page.locator('.message.assistant table td').first().innerText(),'1');
  assert.equal(await page.locator('.message.assistant .md-code .md-copy').count(),1);
  assert.deepEqual(await page.locator('.message.assistant a').evaluateAll(a=>a.map(x=>x.href)),['https://example.test/']);
  if(process.env.UI_EVIDENCE_DIR){for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});await page.screenshot({path:process.env.UI_EVIDENCE_DIR+'/sidepanel-'+colorScheme+'.png'});}}
  const request=await page.evaluate(()=>fixture.calls.find(c=>c.request?.scenario==='webpage-chat'));
  assert.equal(request.request.instruction,'是多少？');assert.deepEqual(request.request.route,{agentKind:'codex',providerId:'b',model:'deep',effort:'high',fastMode:true});assert.equal(request.tabId,1);assert.equal(request.documentId,'document-1');
  await page.evaluate(()=>fixture.hold=true);await page.locator('#question').fill('解释一下');await page.locator('#send').click();
  await page.waitForFunction(()=>!!fixture.finish);
  // The answer streams in while it is written.
  await page.evaluate(()=>{const id=fixture.calls.filter(c=>c.request?.scenario==='webpage-chat').at(-1).id;fixture.listeners.runtime({type:'cindy-learning-progress',id,progress:{stage:'generating',text:'## 进行中\n- 一\n- 二'}});});
  assert.equal(await page.locator('.message.assistant-live h2').innerText(),'进行中');
  assert.equal(await page.locator('.message.assistant-live li').count(),2);
  await page.evaluate(()=>{fixture.tab={id:2,url:'https://example.test/two',title:'Second page'};fixture.listeners.active({windowId:9});});
  await page.waitForFunction(()=>document.querySelector('#page').textContent==='Second page');
  await page.evaluate(()=>fixture.finish({ok:true,text:'stale result'}));
  assert.equal(await page.locator('.message').count(),0);
  assert.ok(await page.evaluate(()=>fixture.calls.some(c=>c.type==='cindy-cancel')));
  // 2026-11-17 review: a long last answer emptied the next question's context, breaking follow-ups.
  await page.evaluate(()=>{fixture.hold=false;fixture.answer='第一点。'+'细节'.repeat(3000);});
  await page.locator('#question').fill('总结要点');await page.locator('#send').click();await page.locator('.message.assistant').waitFor();
  await page.locator('#question').fill('解释第二点');await page.locator('#send').click();
  await page.waitForFunction(()=>fixture.calls.filter(c=>c.request?.scenario==='webpage-chat').at(-1).request.instruction==='解释第二点');
  const followUp=await page.evaluate(()=>fixture.calls.filter(c=>c.request?.scenario==='webpage-chat').at(-1).request.context);
  assert.match(followUp,/^user: 总结要点\nassistant: 第一点。/);assert.ok(followUp.length<=4000);
  // "Default model" puts the side panel back on Cindy Chrome's own model setting.
  await page.locator('#model').click();await page.locator('.mp-panel.settled').waitFor();
  await page.locator('.mp-row[data-anchor="default"]').click();
  assert.equal(await page.locator('#model').innerText(),'默认模型');
  await page.waitForFunction(()=>!('sidepanelModel' in fixture.stored));
  for(const scheme of ['light','dark']){await page.emulateMedia({colorScheme:scheme});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=320));}
  assert.deepEqual(errors,[]);
  // Same production extraction function against real layout, with form/hidden exclusions.
  const extracted=await page.evaluate(()=>{
    document.querySelector('main').innerHTML='<p>Public facts</p><textarea>private draft</textarea><div contenteditable>private editing</div><p hidden>hidden secret</p><p style="display:none">invisible</p>';
    return readChatPage();
  });
  const limited=await page.evaluate(()=>{document.querySelector('main').innerHTML='<p>'+('x'.repeat(18000))+'</p><p>'+('y'.repeat(2000))+'</p>';return readChatPage();});
  assert.equal(limited.text.length,18000);assert.equal(limited.truncated,true);
  assert.match(extracted.text,/Public facts/);assert.doesNotMatch(extracted.text,/private|secret|invisible/);
});
