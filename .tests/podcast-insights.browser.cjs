'use strict';
// Isolated Chromium and synthetic Host; does not control Cindy or send real audio.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {chromium}=require(process.env.PODCAST_PLAYWRIGHT_PATH || 'playwright-core');
const root=path.resolve(__dirname,'../podcast-insights');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PODCAST_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const db=new DatabaseSync(':memory:');let version=0,locale='zh-CN';const errors=[];let failReaderOnce=false;
  try{
    const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    await page.exposeFunction('testLibrary',a=>{
      if(['open','status'].includes(a.op))return {ok:true,state:'ready',usedBytes:4096};
      if(a.op==='read')return {ok:false,errorCode:'NOT_FOUND'};
      if(a.op==='db.open'||a.op==='db.backup')return {ok:true};
      if(a.op==='db.migrate'){if(!version){for(const step of a.steps)for(const sql of step.sql)db.exec(sql);version=1;}return {ok:true};}
      if(a.op==='db.exec'){if(failReaderOnce&&a.sql.startsWith('SELECT g.id,g.transcript_id')){failReaderOnce=false;return {ok:false,errorCode:'LIBRARY_UNAVAILABLE'};}const stmt=db.prepare(a.sql);return /^SELECT/i.test(a.sql)?{ok:true,rows:stmt.all(...a.params)}:{ok:true,...stmt.run(...a.params),lastInsertRowid:0};}
      if(a.op==='db.batch'){db.exec('BEGIN');try{for(const s of a.statements)db.prepare(s.sql).run(...(s.params || []));db.exec('COMMIT');return {ok:true};}catch(e){db.exec('ROLLBACK');throw e;}}
      return {ok:false,errorCode:'UNKNOWN_OP'};
    });
    await page.route('http://127.0.0.1:18765/**',async route=>{
      const u=new URL(route.request().url());const p=u.pathname;
      if(p==='/app-context')return route.fulfill({json:{context:{locale}}});
      if(p==='/wake')return route.fulfill({json:{ok:true}});
      if(p==='/secrets')return route.fulfill({json:[{key:'assemblyai_key',saved:false}]});
      if(p==='/kv')return route.fulfill({json:{}});
      const file=path.join(root,p==='/'?'main-view.html':p.slice(1));
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
      const ext=path.extname(file);return route.fulfill({body:fs.readFileSync(file),contentType:ext==='.html'?'text/html':ext==='.css'?'text/css':ext==='.json'?'application/json':'text/javascript'});
    });
    await page.addInitScript(()=>{
      window.responses=[];window.cards=[];window.uiReads=[];
      const seen=new Map(),monitor=new BroadcastChannel('podcast-insights-v2');monitor.onmessage=({data:m})=>{if(m.type==='request')seen.set(m.reqId,m);if(m.type==='response'&&seen.get(m.reqId)?.tool==='podcast_read')uiReads.push({args:seen.get(m.reqId).args,result:m});};
      window.cindy={library:a=>window.testLibrary(a),request:async()=>({context:{locale:document.documentElement.lang || 'zh-CN'}}),send:async m=>{if(m.type==='tool-result')responses.push(m);if(m.type==='card-update')cards.push(m);},onHostMessage:f=>window.hostListener=f,
        fetch:async a=>({ok:true,status:200,body:a.url.endsWith('.vtt')?'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n城市绿地很重要。\n\n00:00:04.000 --> 00:00:06.000\nGreen spaces matter.':'<rss xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><title>Synthetic show</title><item><title>Synthetic episode</title><guid>one</guid><link>https://example.test/episode</link><enclosure url="https://audio.example.test/one.mp3"/><podcast:transcript url="https://example.test/one.vtt" type="text/vtt"/></item></channel></rss>'})};
    });
    console.log('browser: start');
    await page.goto('http://127.0.0.1:18765/');
    await page.addScriptTag({url:'http://127.0.0.1:18765/main.js'});
    await page.waitForFunction(()=>typeof hostListener==='function');
    await page.evaluate(()=>hostListener({type:'tool-call',tool:'podcast_import',args:{url:'https://example.test/feed'},callId:'import-1'}));
    await page.waitForFunction(()=>responses.some(r=>r.callId==='import-1'));
    const result=await page.evaluate(()=>responses.find(r=>r.callId==='import-1').result);assert.equal(result.episodes.length,1);assert.equal(result.transcripts[0].segment_count,2);
    const eid=result.episodes[0].id;
    await page.getByRole('button',{name:'Synthetic episode',exact:true}).waitFor();
    await page.getByRole('button',{name:'Synthetic episode',exact:true}).click();
    await page.locator('#reader blockquote').first().waitFor();
    await page.evaluate(eid=>hostListener({type:'tool-call',tool:'podcast_cite',args:{references:[{episode_id:eid,quote:'城市绿地很重要。'}]},callId:'cite-1'}),eid);
    await page.waitForFunction(()=>responses.some(r=>r.callId==='cite-1'));assert.equal(await page.evaluate(()=>responses.find(r=>r.callId==='cite-1').result.citations[0].status),'exact');
    const segment=await page.evaluate(()=>responses.find(r=>r.callId==='cite-1').result.citations[0].id);
    await page.evaluate(({eid,segment})=>hostListener({type:'event',name:'card-action',actionId:'focus:'+eid+':'+segment,callId:'cite-1',userActionToken:'synthetic-click'}),{eid,segment});
    await page.locator('#reader .selected').waitFor();
    await page.evaluate(()=>hostListener({type:'tool-call',tool:'podcast_import',args:{url:'https://audio.example.test/empty.mp3'},callId:'empty-1'}));
    await page.waitForFunction(()=>responses.some(r=>r.callId==='empty-1'));
    await page.locator('#episodes').getByRole('button',{name:'empty.mp3',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('转录'));
    assert.equal(await page.locator('#reader blockquote').count(),0);
    assert.equal(await page.locator('#more').isVisible(),false);
    await page.getByRole('button',{name:'Synthetic episode',exact:true}).click();
    await page.locator('#reader blockquote').first().waitFor();
    assert.equal(await page.locator('#reader .selected').count(),0);
    await page.evaluate(eid=>hostListener({type:'tool-call',tool:'podcast_transcribe',args:{episode_id:eid},callId:'missing-key'}),eid);
    await page.waitForFunction(()=>responses.some(r=>r.callId==='missing-key'));
    const failed=await page.evaluate(()=>responses.find(r=>r.callId==='missing-key'));
    assert.equal(failed.ok,false);assert.equal(failed.errorCode,'AAI_KEY_MISSING');
    const recoveredId=await page.evaluate(()=>responses.find(r=>r.callId==='empty-1').result.episodes[0].id);
    db.prepare("UPDATE episodes SET transcript_state='transcribing' WHERE id=?").run(recoveredId);
    db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('browser-resume',recoveredId,'assemblyai','submitted','browser-remote',null,'2025-01-01T00:00:00.000Z','','','browser-slot','https://audio.example.test/empty.mp3');
    await page.locator('#episodes').getByRole('button',{name:'empty.mp3',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('转录'));
    const recovered=await page.evaluate(async()=>{
      const original=cindy.fetch;cindy.fetch=async a=>a.url.includes('/v2/transcript/')?{ok:true,status:200,body:JSON.stringify({id:'browser-remote',status:'completed',utterances:[{text:'Recovered browser evidence',start:0,end:1000}]})}:original(a);
      const channel=new BroadcastChannel('podcast-insights-v2');
      try{return await new Promise(resolve=>{channel.onmessage=e=>{if(e.data.type==='response'&&e.data.reqId==='browser-resume')resolve(e.data);};channel.postMessage({type:'request',tool:'resume',args:{},reqId:'browser-resume'});});}finally{channel.close();cindy.fetch=original;}
    });assert.equal(recovered.ok,true);
    await page.waitForFunction(()=>document.querySelector('#reader blockquote')?.textContent==='Recovered browser evidence');
    assert.equal(db.prepare('SELECT state FROM jobs WHERE id=?').get('browser-resume').state,'completed');
    await page.getByRole('button',{name:'Synthetic episode',exact:true}).click();
    await page.locator('#reader blockquote').first().waitFor();
    const parser=await page.evaluate(()=>{
      const xml='<feed xmlns="http://www.w3.org/2005/Atom" xmlns:podcast="https://podcastindex.org/namespace/1.0"><title>Atom</title><entry><id>id-1</id><title>Entry</title><link rel="enclosure" href="https://audio.example.test/a.mp3"/><podcast:transcript type="text/plain" url="https://example.test/a.txt"/><podcast:transcript type="text/vtt" url="https://example.test/a.vtt"/></entry></feed>';
      const f=PodcastCore.feed(xml,'https://example.test/feed');return {title:f.title,url:f.episodes[0].audio_url,first:f.episodes[0].transcripts[0].type};
    });assert.equal(parser.first,'text/vtt');assert.equal(parser.title,'Atom');
    const dialogs=[];let noteReply='Synthetic note';page.on('dialog',async d=>{dialogs.push(d.message());await d.accept(d.type()==='prompt'?noteReply:undefined);});
    await page.evaluate(eid=>hostListener({type:'tool-call',tool:'podcast_import_transcript',args:{episode_id:eid,content:'x'.repeat(1300),format:'txt'},callId:'long-note'}),eid);
    await page.waitForFunction(()=>responses.some(r=>r.callId==='long-note'));
    await page.getByRole('button',{name:'Synthetic episode',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#reader blockquote')?.textContent.length===1300);
    await page.evaluate(()=>{const text=document.querySelector('#reader blockquote').firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,1201);getSelection().removeAllRanges();getSelection().addRange(range);});
    await page.locator('#reader').getByRole('button',{name:'保存选中引用与笔记',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('1200'));
    assert.equal(dialogs.length,0);assert.equal(db.prepare('SELECT count(*) n FROM notes').get().n,0);
    await page.evaluate(()=>getSelection().removeAllRanges());
    await page.locator('#reader').getByRole('button',{name:'保存选中引用与笔记',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('1200'));
    assert.equal(dialogs.length,0);assert.equal(db.prepare('SELECT count(*) n FROM notes').get().n,0);
    await page.evaluate(()=>{const text=document.querySelector('#reader blockquote').firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,100);getSelection().removeAllRanges();getSelection().addRange(range);});
    await page.locator('#reader').getByRole('button',{name:'保存选中引用与笔记',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('已保存'));
    assert.equal(dialogs.length,1);assert.equal(db.prepare('SELECT quote FROM notes').get().quote,'x'.repeat(100));
    noteReply='n'.repeat(5001);
    await page.evaluate(()=>{const text=document.querySelector('#reader blockquote').firstChild,range=document.createRange();range.setStart(text,0);range.setEnd(text,100);getSelection().removeAllRanges();getSelection().addRange(range);});
    await page.locator('#reader').getByRole('button',{name:'保存选中引用与笔记',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('5000'));assert.equal(db.prepare('SELECT count(*) n FROM notes').get().n,1);noteReply='Synthetic note';
    const other=await page.evaluate(()=>responses.find(r=>r.callId==='empty-1').result.episodes[0].id);
    await page.evaluate(eid=>hostListener({type:'tool-call',tool:'podcast_import_transcript',args:{episode_id:eid,content:'Other episode evidence',format:'txt'},callId:'other-text'}),other);
    await page.waitForFunction(()=>responses.some(r=>r.callId==='other-text'));
    await page.getByRole('button',{name:'Synthetic episode',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('episode-title').textContent==='Synthetic episode');
    await page.locator('#query').fill('Other episode');await page.locator('#search button').click();
    await page.waitForFunction(()=>document.querySelector('#reader blockquote')?.textContent==='Other episode evidence');
    assert.equal(await page.locator('#episode-title').textContent(),'检索结果');assert.equal(await page.locator('#episode-actions').isVisible(),false);
    assert.ok((await page.locator('#reader').textContent()).includes('empty.mp3'));
    await page.locator('#reader').getByRole('button',{name:'在资料库中查看',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('episode-title').textContent==='empty.mp3');assert.equal(await page.locator('#episode-actions').isVisible(),true);
    await page.evaluate(eid=>hostListener({type:'tool-call',tool:'podcast_import_transcript',args:{episode_id:eid,content:JSON.stringify([{text:'Duration evidence',start:90000,end:90001}]),format:'json'},callId:'duration-text'}),other);
    await page.waitForFunction(()=>responses.some(r=>r.callId==='duration-text'));
    await page.locator('#episodes').getByRole('button',{name:'empty.mp3',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#reader small')?.textContent.includes('25:00:00'));
    assert.ok(!(await page.locator('#reader small').first().textContent()).includes('01:00:00'));
    await page.getByRole('button',{name:'Synthetic episode',exact:true}).click();await page.locator('#query').fill('');
    const addNote=db.prepare('INSERT INTO notes VALUES(?,?,?,?,?,?,?)');
    for(let i=0;i<501;i++)addNote.run('archived-'+i,eid,segment,'Archive quote '+i,'Archive note '+i,'https://example.test/source',new Date(Date.UTC(2024,0,1)+i*1000).toISOString());
    await page.reload();await page.addScriptTag({url:'http://127.0.0.1:18765/main.js'});
    await page.waitForFunction(()=>document.querySelectorAll('#notes input').length>=1);
    await page.locator('#notes input').first().check();
    for(let i=0;i<10;i++){if(!(await page.locator('#more-notes').isVisible()))break;const count=await page.locator('#notes input').count();await page.locator('#more-notes').click();await page.waitForFunction(count=>document.querySelectorAll('#notes input').length>count,count);}
    assert.equal(await page.locator('#notes input').count(),502);assert.equal(await page.locator('#notes input').first().isChecked(),true);
    await page.locator('#notes input[value="archived-0"]').check();assert.equal(await page.locator('#notes input[value="archived-0"]').isChecked(),true);
    await page.getByRole('button',{name:'Synthetic episode',exact:true}).click();
    console.log('browser: initial flows passed');
    const output=process.env.PODCAST_SCREENSHOT_DIR || '/private/tmp/podcast-158-visual';fs.mkdirSync(output,{recursive:true});
    for(const language of ['zh-CN','en']){
      locale=language;
      if(language==='en'){
        await page.reload();await page.addScriptTag({url:'http://127.0.0.1:18765/main.js'});await page.getByRole('button',{name:'Synthetic episode',exact:true}).waitFor();await page.getByRole('button',{name:'Synthetic episode',exact:true}).click();await page.locator('#reader blockquote').first().waitFor();
      }
      for(const dark of [false,true]){
        await page.evaluate(dark=>{const vars=dark?{'--surface':'#181818','--surface-elevated':'#2c2c2a','--surface-chip':'#3c3c3a','--text-primary':'#d4d4d4','--text-secondary':'#a1a19b','--border-default':'#3c3c3a'}:{'--surface':'#f2f2ed','--surface-elevated':'#ffffff','--surface-chip':'#e5e5e5','--text-primary':'#262626','--text-secondary':'#696963','--border-default':'#d7d7d4'};for(const [k,v]of Object.entries(vars))document.documentElement.style.setProperty(k,v);document.documentElement.style.colorScheme=dark?'dark':'light';},dark);
        await page.screenshot({path:path.join(output,language+'-'+(dark?'dark':'light')+'.png'),fullPage:true});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
    }
    await page.setViewportSize({width:360,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    // A successful reader must follow active-version changes without reselecting.
    await page.evaluate(eid=>hostListener({type:'tool-call',tool:'podcast_import_transcript',args:{episode_id:eid,content:'New active evidence',format:'txt'},callId:'active-refresh'}),eid);
    await page.waitForFunction(()=>responses.some(r=>r.callId==='active-refresh'));
    await page.waitForFunction(()=>document.querySelector('#reader blockquote')?.textContent==='New active evidence',null,{timeout:2000}).catch(()=>errors.push('active transcript did not refresh'));
    // Explicit selection also establishes the same starting point on the old implementation.
    await page.getByRole('button',{name:'Synthetic episode',exact:true}).click();
    await page.evaluate(eid=>hostListener({type:'tool-call',tool:'podcast_import_transcript',args:{episode_id:eid,content:'z'.repeat(40000),format:'txt'},callId:'paging-refresh'}),eid);
    await page.waitForFunction(()=>responses.some(r=>r.callId==='paging-refresh'));
    await page.getByRole('button',{name:'Synthetic episode',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#reader blockquote')?.textContent.startsWith('zzz'));
    const activeSegment=db.prepare('SELECT g.id FROM segments g JOIN transcripts t ON t.id=g.transcript_id WHERE t.episode_id=? AND t.is_active=1 ORDER BY g.idx LIMIT 1').get(eid).id;
    await page.evaluate(({eid,id})=>{const c=new BroadcastChannel('podcast-insights-v2');c.postMessage({type:'focus',episode_id:eid,segment_id:id});c.close();},{eid,id:activeSegment});
    await page.locator('#reader .selected').first().waitFor();
    await page.locator('#more').click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('#reader blockquote')).reduce((n,e)=>n+e.textContent.length,0)>10000);
    const beforeRetry=await page.locator('#reader').textContent(),beforeHighlight=await page.locator('#reader .selected').count();failReaderOnce=true;
    await page.locator('#more').click();await page.waitForFunction(()=>uiReads.at(-1)?.result.ok===false);
    const reads=await page.evaluate(()=>uiReads.length);
    await page.evaluate(()=>{const c=new BroadcastChannel('podcast-insights-v2');c.postMessage({type:'changed'});c.close();});
    await page.waitForFunction(n=>uiReads.length>n,reads);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(await page.locator('#reader').textContent()!==beforeRetry)errors.push('failed continuation reset the reader on unrelated refresh');
    assert.equal(await page.locator('#reader .selected').count(),beforeHighlight);
    await page.locator('#more').click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('#reader blockquote')).reduce((n,e)=>n+e.textContent.length,0)===22000);
    console.log('browser: pagination baseline passed');
    // A queued import can activate a new transcript before an old continuation runs.
    // Change only the synthetic DB here: no changed notification reaches the UI first.
    db.prepare('UPDATE transcripts SET is_active=0 WHERE episode_id=?').run(eid);
    db.prepare('INSERT INTO transcripts VALUES(?,?,?,?,?,?,?,?)').run('race-version',eid,'user','txt','','','',1);
    for(let i=0;i<4;i++)db.prepare('INSERT INTO segments VALUES(?,?,?,?,?,?,?,?)').run('race-'+i,'race-version',i,null,null,'','n'.repeat(12000),'n'.repeat(12000));
    await page.locator('#more').click();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('#reader blockquote')).map(e=>e.textContent).join('').startsWith('n'));
    assert.equal(await page.locator('#reader blockquote').allTextContents().then(parts=>parts.join('')),'n'.repeat(10000));
    await page.evaluate(()=>{const c=new BroadcastChannel('podcast-insights-v2');c.postMessage({type:'changed'});c.close();});
    await page.waitForFunction(()=>document.querySelector('#episode-title').textContent==='Synthetic episode');
    // Deleting the selected episode must discard its notes and checkbox selections too.
    await page.locator('#delete-episode').click();
    await page.waitForFunction(()=>document.querySelectorAll('#notes input').length===0);
    assert.equal(await page.locator('#notes input:checked').count(),0);
    assert.equal(await page.locator('#more-notes').isVisible(),false);
    assert.equal(await page.locator('#episode-actions').isVisible(),false);
    assert.equal(db.prepare('SELECT count(*) n FROM notes WHERE episode_id=?').get(eid).n,0);
    assert.deepEqual(errors,[]);console.log('Browser checks passed: RSS/Atom DOMParser, transcript import, citation, reader, en/zh-CN × light/dark, narrow layout');
  }finally{db.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
