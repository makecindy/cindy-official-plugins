const channel=new BroadcastChannel('eval-lab'),pending=new Map();
channel.onmessage=({data:m})=>{if(m?.type==='job-progress'){state.job=m.job;renderJob();return;}if(m?.type==='download-progress'){downloadProgress(m);return;}if(m?.type==='progress'){message(m.message);return;}if(m?.type==='response'&&pending.has(m.id)){const p=pending.get(m.id);clearInterval(p.timer);clearTimeout(p.deadline);pending.delete(m.id);m.ok?p.resolve(m.result):p.reject(Error(m.message));}};
async function rpc(action,args={}){const wake=await fetch('/wake');if(!wake.ok)throw Error('插件未能唤醒');return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),m={type:'request',id,action,args};const send=()=>channel.postMessage(m);const timer=setInterval(send,700),deadline=setTimeout(()=>{clearInterval(timer);pending.delete(id);reject(Error('响应尚未到达，请查看任务状态；不要重复启动评测。'));},action==='status'?15000:900000);pending.set(id,{resolve,reject,timer,deadline});send();});}
const $=s=>document.querySelector(s),tr=t=>window.evalTranslate?window.evalTranslate(t):t;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state={banks:[],models:[],runs:[],drafts:[]},bankId='default',busy=false,refreshing=false,modelStamp='',onlineIndex=null,showHidden=false,dismissedJobId=null;
const picks=new Map();
function message(t){$('#status').textContent=tr(t);$('#launch-status').textContent='';}
function bank(){return state.banks.find(b=>b.id===bankId);}
function configs(){return state.models.flatMap((m,i)=>[...(picks.get(i)||[])].map(effort=>({model:m.model,harness:m.harness,provider:m.provider,effort})));}
function summary(){const n=bank()?.questions.length||0,c=configs().length;$('#summary').textContent=`${n} ${tr('道题')} × ${c} ${tr('组模型配置')} = ${n*c} ${tr('次作答')}`;$('#start').disabled=busy||['running','stopping'].includes(state.job?.status)||!n||!c||[...picks.values()].some(s=>!s.size);$('#start').textContent=tr(['running','stopping'].includes(state.job?.status)?'评测进行中':busy?'正在准备…':'开始测试');$('#start').setAttribute('aria-busy',String(busy));$('#launch-hint').textContent=tr(!c?'请先选择模型和思考强度。':[...picks.values()].some(s=>!s.size)?'请为已选模型选择至少一个强度。':'');}
function listedModels(){return state.models.map((m,i)=>({m,i})).filter(({m,i})=>m.visible!==false||showHidden||picks.has(i));}
function renderModels(){
 const hidden=state.models.filter(m=>m.visible===false).length;$('#toggle-hidden').hidden=!hidden;$('#toggle-hidden').textContent=tr(showHidden?'收起隐藏模型':'展开隐藏模型')+` (${hidden})`;$('#toggle-hidden').setAttribute('aria-expanded',String(showHidden));
 $('#models').innerHTML=listedModels().length?listedModels().map(({m,i})=>`<div class="model-row"><div class="model-head"><label class="model-name"><input type="checkbox" data-model="${i}" ${picks.has(i)?'checked':''}><span><b>${esc(m.label)}</b><small>${esc(m.providerLabel)} · ${esc(m.harness)}</small></span></label></div>${picks.has(i)?`<div class="efforts">${m.efforts.map(e=>`<button class="effort" data-effort="${i}" data-value="${esc(e)}" aria-pressed="${picks.get(i).has(e)}">${esc(e)}</button>`).join('')}<button class="quiet effort-all" data-all="${i}">${tr('全强度')}</button></div>`:''}</div>`).join(''):`<p class="empty">${tr(state.models.length?'模型已隐藏，可展开查看。':'暂无可用模型，请先在 Cindy 中连接模型来源。')}</p>`;
 for(const b of document.querySelectorAll('[data-model]'))b.onchange=()=>{const i=Number(b.dataset.model);b.checked?picks.set(i,new Set([state.models[i].defaultEffort|| (state.models[i].efforts.includes('medium')?'medium':state.models[i].efforts[0])])):picks.delete(i);renderModels();};
 for(const b of document.querySelectorAll('[data-effort]'))b.onclick=()=>{const s=picks.get(Number(b.dataset.effort)),e=b.dataset.value;s.has(e)?s.delete(e):s.add(e);renderModels();};
 for(const b of document.querySelectorAll('[data-all]'))b.onclick=()=>{const i=Number(b.dataset.all);picks.set(i,new Set(state.models[i].efforts));renderModels();};summary();
}
let historyBankId=null,scoreMode='latest',historyQuestion='',historyBatch='',standingsRows=[],standingsQuestions=[];
try{historyBankId=localStorage.getItem('eval-history-bank');}catch{}
const scoreText=n=>Number(n).toFixed(2);
const dateText=at=>at?new Date(at).toLocaleDateString():tr('时间未知');
function history(){
 const open=new Set([...document.querySelectorAll('[data-standing][open]')].map(e=>e.dataset.standing));const openQuestions=new Set([...document.querySelectorAll('[data-question-score][open]')].map(e=>e.dataset.questionScore));
 if(!state.banks.some(b=>b.id===historyBankId))historyBankId=bankId;
 const selectedBank=state.banks.find(b=>b.id===historyBankId)||state.banks[0];
 $('#history-filter').innerHTML=state.banks.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');$('#history-filter').value=selectedBank?.id||'';
 const current=(selectedBank?.questions||[]).map(q=>({...q,questionId:q.questionId||q.key.split(':').pop().split('@')[0]}));
 const ids=new Set(current.map(q=>q.questionId));const versions=new Map(current.map(q=>[EvalStandings.questionKey(q),q]));
 for(const r of state.runs)if(ids.has(r.questionId)&&!versions.has(EvalStandings.questionKey(r)))versions.set(EvalStandings.questionKey(r),{questionId:r.questionId,title:r.question,revision:r.revision,releaseHash:r.releaseHash,distributionHash:r.distributionHash});
 $('#history-question').innerHTML=`<option value="">${tr('全部现行题目')}</option>`+[...versions].map(([k,q])=>`<option value="${esc(k)}">${esc(q.title)} · ${esc(q.revision)}${current.some(c=>EvalStandings.questionKey(c)===k)?'':' · '+tr('历史版本')}${q.distributionHash?' · '+esc(q.distributionHash.slice(0,6)):''}</option>`).join('');
 if(!versions.has(historyQuestion))historyQuestion='';$('#history-question').value=historyQuestion;
 standingsQuestions=historyQuestion?[versions.get(historyQuestion)]:current;
 const eligible=state.runs.filter(r=>standingsQuestions.some(q=>EvalStandings.questionKey(q)===EvalStandings.questionKey(r)));
 const batches=new Map();for(const r of eligible){const k=r.batchId||r.runId;if(!batches.has(k))batches.set(k,[]);batches.get(k).push(r);}
 $('#history-batch').innerHTML=`<option value="">${tr('全部测试')}</option>`+[...batches].sort((a,b)=>Math.max(...b[1].map(EvalStandings.stamp))-Math.max(...a[1].map(EvalStandings.stamp))).map(([k,rs])=>`<option value="${esc(k)}">${esc(dateText(Math.max(...rs.map(EvalStandings.stamp))))} · ${rs.length} ${tr('份记录')} · ${esc(k.slice(0,8))}</option>`).join('');
 if(!batches.has(historyBatch))historyBatch='';$('#history-batch').value=historyBatch;
 const rows=historyBatch?batches.get(historyBatch):eligible;standingsRows=EvalStandings.aggregate(rows,standingsQuestions,scoreMode);
 $('#history-count').textContent=standingsRows.length||'';
 $('#standings-note').textContent=(current.some(q=>q.unresolved)?tr('存在多个评分版本，请在高级筛选中选择；不同版本不混算。')+' ':'')+standingsQuestions.length+' '+tr('道题')+' · '+tr(scoreMode==='latest'?'每题取最近一次有效成绩，补测自动合并。':'每题先取有效作答平均分，再合计；重复测试不增加题目权重。');
 $('#history').innerHTML=standingsRows.map((r,i)=>`<details class="standing" data-standing="${esc(r.key)}" ${open.has(r.key)?'open':''}><summary><span class="rank">${r.complete?i+1:'—'}</span><span class="standing-model"><strong>${esc(state.models.find(m=>m.model===r.model&&m.provider===r.provider&&m.harness===r.harness)?.label||r.model)} <span class="hint">${esc(r.effort)}</span></strong><small>${esc(r.harness)} · ${esc(state.models.find(m=>m.provider===r.provider)?.providerLabel||r.provider)}</small></span><span class="standing-score"><strong>${scoreText(r.total)}${r.complete?' / '+r.required:''}</strong><small>${r.complete?tr('已测齐'):tr('已得分')+' · '+tr('已测')+' '+r.answered+' / '+r.required}</small></span><span class="standing-date">${esc(dateText(r.updatedAt))}<small>${r.attempts} ${tr('份记录')}</small></span><span aria-hidden="true">⌄</span></summary><div class="standing-details"><p class="hint">${tr('费用 USD')}：${r.costUSD==null?tr('未知'):'$'+r.costUSD.toFixed(2)} · ${tr('未知费用不记零；完整成绩与未测齐成绩分开排序。')}</p>${r.details.map(d=>`<details class="question-scores" data-question-score="${esc(r.key+EvalStandings.questionKey(d.question))}" ${openQuestions.has(r.key+EvalStandings.questionKey(d.question))?'open':''}><summary><span>${esc(d.question.title||d.question.questionId)}</span><span>${d.score==null?tr('待补测'):scoreText(d.score)+' / 1'}${d.recentBlocked?' · '+tr('最近一次环境受阻'):''}<small>${d.records.length} ${tr('份记录')}</small></span></summary>${d.records.length?d.records.map(x=>`<div class="attempt"><span>${esc(dateText(EvalStandings.stamp(x)))} · ${x.status==='graded'?scoreText(EvalStandings.value(x))+' / 1':tr(x.status==='environment_invalid'?'环境受阻，不计分':'待交卷')}${d.selected.includes(x)?' · '+tr('已计入'):''}</span><button class="quiet" data-detail="${esc(x.runId)}">${tr('详情')}</button></div>`).join(''):`<p class="hint">${tr('尚无此版本的有效成绩')}</p>`}</details>`).join('')}</div></details>`).join('')||`<p class="empty">${tr('这个题库还没有成绩。开始评测后，模型总成绩会显示在这里。')}</p>`;
 for(const b of document.querySelectorAll('[data-detail]'))b.onclick=()=>{const r=state.runs.find(r=>r.runId===b.dataset.detail);$('#detail-title').textContent=r.question+' · '+r.revision;$('#detail-note').textContent=modelTitle(r);$('#detail-items').textContent=`${tr('得分')}：${r.scoreExact??tr('未能评分')} · ${tr('耗时')}：${duration(r.durationSeconds)} · USD：${r.costUSD==null?tr('未知'):r.costUSD} · ${tr('排队')}：${duration(r.queueSeconds)} · ${tr('评分')}：${duration(r.gradingSeconds)} · ${r.reason||''}`;$('#detail-dialog').showModal();};
 $('#export').disabled=!standingsRows.some(r=>r.answered);
}
const settledStatus=s=>['graded','failed','cancelled','environment_invalid'].includes(s);
function questionTitle(key){const q=state.banks.flatMap(b=>b.questions||[]).find(q=>q.key===key);if(q)return q.title;const id=key?.split(':').pop()?.split('@')[0];return ({audio:'音频重采样',island:'灵动岛交互',recovery:'自动恢复',composer:'输入框发送','mobile-stream-order':'手机消息顺序','remote-files-bughunt':'远程文件','task-switch-cache':'消息缓存'})[id]||key?.split(':').pop()||'正在准备题目';}
function modelTitle(item){const model=state.models.find(m=>m.model===item.model&&(!item.harness||m.harness===item.harness)&&(!item.provider||m.provider===item.provider));return [model?.label||item.model,item.effort,item.harness||model?.harness,model?.providerLabel||item.provider].filter(Boolean).join(' · ');}
function duration(s){return Number.isFinite(s)?Math.round(s)+' s':'未知';}
function elapsed(at){return typeof at==='number'&&at>0?duration(Math.max(0,(Date.now()-at)/1000)):'等待开始';}
function renderJob(){
 const j=state.job,show=!!j?.items&&(!j.id||j.id!==dismissedJobId),locked=busy||show;
 $('#cancel-preparation').hidden=!busy||show;$('#setup').hidden=locked;$('#setup').disabled=locked;$('footer').hidden=locked;$('#execution').hidden=!show;$('#tab-run').textContent=tr(show?'评测进度':'开始评测');
 if(!show)return;
 $('#download-panel').hidden=true;
 const terminal=['completed','cancelled'].includes(j.status),labels={recovering:'正在自动恢复',awaiting_confirmation:'等待主任务确认',stopping:'正在停止评测',coordinating:'主任务正在协调',permission:'等待授权',preparing:'正在准备作答目录',queued:'等待模型开始',answering:'模型正在作答',grading:'正在独立评分',reconciling:'正在核对执行状态',blocked:'评测暂停，需要处理'};
 const stage=tr(j.status==='completed'?'评测已结束':j.status==='cancelled'?'已停止评测':labels[j.phase]||'正在准备评测');
 const total=j.total??j.items.length,finished=j.finished??j.items.filter(x=>settledStatus(x.status)).length;
 $('#job-state').textContent=j.phase==='answering'?tr('评测进行中'):stage;$('#job-count').textContent=`${finished} / ${total}`;$('#job-meter').max=Math.max(1,total);$('#job-meter').value=finished;
 const banks=state.banks.filter(b=>j.items.some(i=>b.questions?.some(q=>q.key===i.question))).map(b=>b.name),configCount=new Set(j.items.map(i=>JSON.stringify([i.model,i.effort,i.harness,i.provider]))).size;
 $('#job-config').textContent=([...new Set(banks)].join('、')||tr('本次评测'))+` · ${new Set(j.items.map(i=>i.question)).size} ${tr('道题')} × ${configCount} ${tr('组模型配置')}`;
 const running=j.items.filter(x=>['running','grading','awaiting_confirmation'].includes(x.status));
 const active=j.items.find(x=>x.runId&&x.runId===j.currentRunId)||j.items.find(x=>['running','grading'].includes(x.status))||j.items.find(x=>!settledStatus(x.status)&&x.status!=='blocked');
 $('#current-test').hidden=terminal||!active;$('#current-stage').textContent=stage+(running.length?' · '+running.length+' 份同时作答':'');$('#current-question').textContent=active?questionTitle(active.question):'';$('#current-model').textContent=active?modelTitle(active):'';
 $('#current-test').hidden=terminal||!active||running.length>1;
 $('#active-tests').innerHTML=terminal||running.length<2?'':running.map(i=>`<article class="active-answer"><strong>${esc(questionTitle(i.question))}</strong><p class="hint">${esc(modelTitle(i))}</p><p class="hint">${esc(i.waitReason||'模型正在执行')} · ${esc(elapsed(i.telemetry?.startedAt))}</p></article>`).join('');
 const usage=j.coordinatorUsage;$('#job-usage').textContent=(j.capacity?`并发上限 ${j.capacity.hardLimit} · `:'')+`协调费用 USD：${usage?.costUSD==null?'未知':(usage.approximate?'约 ':'')+'$'+usage.costUSD}（单列，不计入模型作答费用）`;
 $('#job-note').textContent=j.message|| (terminal?tr('成绩已保存，可随时查看与分享。'):'');
 const statuses={graded:'已评分',failed:'未能评分',cancelled:'已停止',environment_invalid:'环境受阻',awaiting_confirmation:'等待审批',queue_paused:'队列暂停',blocked:'需要处理',running:'正在作答',queued:'等待开始',pending:'等待开始',completed:'等待评分',grading:'正在评分'};
 $('#job-items').innerHTML=j.items.map((item,i)=>{const current=!terminal&&(item===active||running.includes(item));return `<li ${current?'aria-current="step"':''}><span class="item-number">${item.status==='graded'?'✓':['failed','cancelled'].includes(item.status)?'—':i+1}</span><div><strong>${esc(questionTitle(item.question))}</strong><p class="hint">${esc(modelTitle(item))}</p>${item.error?`<p class="hint">${esc(item.error)}</p>`:''}${!settledStatus(item.status)&&item.waitReason?`<p class="hint">${esc(item.waitReason)} · ${esc(elapsed(item.telemetry?.startedAt))}</p>`:''}</div><span class="item-status">${esc(tr(current&&j.phase==='grading'?'正在评分':statuses[item.status]||'等待开始'))}</span></li>`;}).join('');
 $('#allow-write').hidden=j.status!=='running'||j.phase!=='permission';$('#allow-write').textContent=tr(j.coordinatorTaskId?'启用 Auto 并继续':'允许修改并继续');
 $('#job').hidden=!(['running','needs_attention'].includes(j.status)&&j.phase==='blocked');$('#cancel').hidden=terminal;$('#cancel').disabled=j.status==='stopping';$('#view-results').hidden=finished===0;$('#new-run').hidden=!terminal;
}

async function refresh(){if(refreshing)return;refreshing=true;try{const s=await rpc('status');const previousModels=state.models;state={...state,...s};state.banks=s.banks||[{id:'default',name:'Cindy 实战题库',questions:s.bank?.questions||[]}];if(!bank())bankId=state.banks[0]?.id||'default';$('#bank').innerHTML=state.banks.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')+`<option value="create">＋ ${tr('创建自己的题库')}</option>`;$('#bank').value=bankId;$('#bank-description').textContent=bank()?.error?tr(bank().error):`${bank()?.questions.length||0} ${tr('道题')} · ${tr('自主查错，独立验收')}`;
 const stamp=JSON.stringify(state.models);if(stamp!==modelStamp){const retained=new Map(previousModels.map((m,i)=>[JSON.stringify([m.provider,m.harness,m.model]),picks.get(i)]));picks.clear();state.models.forEach((m,i)=>{const old=retained.get(JSON.stringify([m.provider,m.harness,m.model]));if(old){const valid=new Set([...old].filter(e=>m.efforts.includes(e)));if(valid.size)picks.set(i,valid);}});modelStamp=stamp;renderModels();}summary();history();renderJob();$('#model-note').textContent=tr(state.modelError||'已显示当前已连接的模型和强度，读取不产生模型费用。');
 $('#setup-state').textContent=tr(s.automaticRoot?'资料保存在插件默认位置，无需选择目录。':'正在使用你选择的保存位置。');if(!$('#bank-url').value)$('#bank-url').value=s.indexUrl||'';
 $('#check-id').innerHTML=state.drafts.map(d=>`<option value="${esc(d.checkId)}" ${d.passed?'':'disabled'}>${esc(d.id)} · ${esc(d.revision)} ${d.passed?'✓':tr('校准未通过')}</option>`).join('');$('#freeze-section').hidden=!state.drafts.length;$('#freeze').disabled=!state.drafts.some(d=>d.passed);const passed=state.drafts.find(d=>d.passed);if(passed)$('#check-id').value=passed.checkId;
 $('#sync-state').textContent=tr('进度自动更新');
 }finally{refreshing=false;}}
function bind(selector,fn){$(selector).onclick=async()=>{const b=$(selector);b.disabled=true;try{await fn();}catch(e){message(e.message);const dialog=b.closest('dialog');if(dialog)dialog.querySelector('[role=status]')?.replaceChildren(document.createTextNode(e.message));}finally{b.disabled=false;summary();if(selector==='#export')b.disabled=!standingsRows.some(r=>r.answered);}};}
function tab(id){for(const b of document.querySelectorAll('[role=tab]')){const yes=b.id===id;b.setAttribute('aria-selected',yes);b.tabIndex=yes?0:-1;$('#'+b.getAttribute('aria-controls')).hidden=!yes;}}
for(const b of document.querySelectorAll('[role=tab]')){b.onclick=()=>tab(b.id);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const other=$('#'+(b.id==='tab-run'?'tab-history':'tab-run'));tab(other.id);other.focus();}};}tab('tab-run');
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
$('#bank').onchange=()=>{if($('#bank').value==='create'){$('#bank').value=bankId;$('#author-dialog').showModal();return;}bankId=$('#bank').value;refresh().catch(e=>message(e.message));summary();};
$('#toggle-hidden').onclick=()=>{showHidden=!showHidden;renderModels();};
$('#all-models').onclick=()=>{listedModels().forEach(({m,i})=>{if(!picks.has(i))picks.set(i,new Set([m.defaultEffort||(m.efforts.includes('medium')?'medium':m.efforts[0])]));});renderModels();};$('#clear-models').onclick=()=>{picks.clear();renderModels();};
$('#bulk-effort').onchange=()=>{const e=$('#bulk-effort').value;if(!e)return;const missed=[];for(const [i] of picks){const m=state.models[i];if(e==='all')picks.set(i,new Set(m.efforts));else if(m.efforts.includes(e))picks.set(i,new Set([e]));else missed.push(m.label);}$('#effort-note').textContent=missed.length?missed.join('、')+'：'+tr('不支持该强度，保留原选择。'):tr('每个模型可以选择多个强度，分别计分。');renderModels();};
$('#view-bank').onclick=()=>{$('#bank-title').textContent=bank()?.name||'';$('#bank-modal-note').textContent=tr('每题 1 分，按考核点完成度计分。');$('#bank-questions').innerHTML=(bank()?.questions||[]).map(q=>`<div class="question-item">${esc(q.title)} <span class="hint">${esc(q.revision)}</span></div>`).join('');$('#bank-dialog').showModal();};$('#confirm-bank').onclick=()=>$('#bank-dialog').close();$('#history-filter').onchange=()=>{historyBankId=$('#history-filter').value;historyQuestion='';historyBatch='';try{localStorage.setItem('eval-history-bank',historyBankId);}catch{}history();};
$('#history-question').onchange=()=>{historyQuestion=$('#history-question').value;historyBatch='';history();};$('#history-batch').onchange=()=>{historyBatch=$('#history-batch').value;history();};
for(const b of document.querySelectorAll('[data-score-mode]'))b.onclick=()=>{scoreMode=b.dataset.scoreMode;for(const x of document.querySelectorAll('[data-score-mode]'))x.setAttribute('aria-pressed',String(x===b));history();};
$('#view-results').onclick=()=>tab('tab-history');
$('#new-run').onclick=()=>{dismissedJobId=state.job?.id;renderJob();summary();$('#bank').focus();};
bind('#start',async()=>{busy=true;state.job=null;dismissedJobId=null;renderJob();message('正在检查题库与模型配置…');summary();try{const questions=(bank()?.questions||[]).map(q=>q.key),configurations=configs();const r=await rpc('start',{questions,configurations,concurrency:$('#concurrency').value===''?null:Number($('#concurrency').value)});state.job=r;renderJob();message(r.items?'':r.message||'评测批次已创建，正在准备任务。');$('#execution').scrollIntoView({block:'nearest'});await refresh();}finally{busy=false;renderJob();}});
bind('#allow-write',async()=>{state.job=await rpc('allow_write');renderJob();await refresh();});
bind('#job',async()=>{state.job=await rpc('resume_coordination');renderJob();await refresh();});
bind('#cancel-preparation',async()=>{state.job=await rpc('cancel');renderJob();message('已收到停止请求。');});
bind('#cancel',async()=>{state.job=await rpc('cancel');renderJob();await refresh();});
bind('#create-bank',async()=>{if(!$('#bank-name').value.trim()||!$('#source').value.trim())throw Error('请填写名称与选定的任务记录');await rpc('author',{name:$('#bank-name').value.trim(),records:[{sessionId:'user-selected-excerpts',text:'题库名称：'+$('#bank-name').value+'\n'+$('#source').value}]});$('#author-dialog').close();message('正在整理题目，完成后会出现在待加入列表。');});
bind('#freeze',async()=>{const r=await rpc('freeze',{checkId:$('#check-id').value});bankId=r.key;await refresh();message('新版本已加入本地题库。');});
bind('#export',async()=>{const runIds=[...new Set(standingsRows.flatMap(r=>r.details.flatMap(d=>d.records.map(x=>x.runId))))];const r=await rpc('export',{runIds,standings:{title:state.banks.find(b=>b.id===historyBankId)?.name||'模型成绩',mode:scoreMode,questions:standingsQuestions}});message(r.saved?'网页已导出。':'已取消另存，报告仍保留在本地作品库。');});
bind('#pick-root',async()=>{await rpc('setup_root');picks.clear();await refresh();});bind('#pick-bank',async()=>{await rpc('setup_bank');await refresh();});bind('#import',async()=>{await rpc('setup_bank');await refresh();message('题库已载入。');});
bind('#online-check',async()=>{const url=$('#bank-url').value.trim(),r=await rpc('online_inspect',{url});await rpc('save_source',{url});onlineIndex=r.indexId;$('#online-questions').innerHTML=r.questions.map(q=>`<label class="question-item"><input name="online-question" type="checkbox" value="${esc(q.key)}"> ${esc(q.title)} · ${(q.bytes/1048576).toFixed(1)} MiB</label>`).join('');});
bind('#online-download',async()=>{const qs=[...document.querySelectorAll('[name=online-question]:checked')].map(e=>e.value);if(!onlineIndex||!qs.length)throw Error('请先检查题库并选择题目');for(const question of qs)await rpc('online_install',{indexId:onlineIndex,question});await refresh();message('题库已下载并校验，可离线运行。');});
async function syncProgress(){if(document.hidden)return;try{await refresh();}catch(e){$('#sync-state').textContent=tr('连接暂时中断，正在自动重连；已有进度保留。');if(!state.job)message(e.message);}}
syncProgress();setInterval(syncProgress,5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncProgress();});window.addEventListener('online',syncProgress);window.addEventListener('focus',syncProgress);

function downloadProgress(p){
 const panel=$('#download-panel'),meter=$('#download-meter'),cancel=$('#download-cancel');
 panel.hidden=false;
 const labels={stopping:'正在停止评测',queued:'等待下载',downloading:'正在下载题库',verifying:'正在校验文件',retrying:'网络重试中',unpacking:'正在解包并校验题库',ready:'题库已就绪',completed:p.fromCache?'已使用缓存文件':'文件下载完成',cancelled:'下载已取消',failed:'下载失败，请重试'};
 $('#download-label').textContent=tr(labels[p.phase]||'正在准备题库');
 if(p.phase==='downloading'&&p.total>0){meter.value=Math.min(100,p.loaded/p.total*100);$('#download-detail').textContent=(p.loaded/1048576).toFixed(1)+' / '+(p.total/1048576).toFixed(1)+' MiB · '+(p.speedBps/1048576).toFixed(1)+' MiB/s';}
 else{meter.removeAttribute('value');$('#download-detail').textContent='';}
 if(['ready','completed'].includes(p.phase))meter.value=100;
 cancel.hidden=['ready','cancelled','failed'].includes(p.phase);
 cancel.onclick=()=>rpc('cancel_download').catch(e=>message(e.message));
}
