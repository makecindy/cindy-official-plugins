'use strict';
const COPY={
 en:['Test Environments','Choose an account and settings. Keep the setup for the next run.','Profiles','Projects','Accounts','Cases','Runs','Add','Refresh','Edit','Save','Cancel','Preview launch','Start','Prepare build','Verify','Stop','Remove','Import Cindy accounts','No entries yet. Add one, or ask Cindy to configure this project.','Saved','Connecting…','Details','ID','Name','Project directory','Adapter','Commands (argument arrays)','Project','Application account key','Login source','Notes','Platform','Mode','Account','Isolated data name','Region','Remote control','Automatic background triggers','Sample fixture','Offer login as','Device ID','Build artifact','App bundle ID','Profile','Steps (action / expected)','Use application sign-in. Never enter a password or token here.','Saved locally. Application login and data remain when an entry is removed.','Remove this catalog entry? Application data will remain.','Select…','Keep existing behavior','Off','On','Original launch','Acceptance settings','Connection failed. Refresh to reconnect; check Runs before starting again.','Run requested. Follow its state in Runs.','Refresh before saving: another editor changed the catalog.','Launch details','Custom command','Cindy checkout','Ready','Waiting for sign-in','Preparing','Running','Stopped','Completed','Failed','Unknown','Stopping','Starting','Debug port'],
 'zh-CN':['测试环境','选好账号与配置，下次测试直接复用。','启动方案','项目','账号','用例','运行记录','添加','刷新','编辑','保存','取消','查看启动配置','启动','准备构建','验证','停止','移除','导入 Cindy 账号','还没有记录。可以添加，也可以让 Cindy 帮你配置项目。','已保存','正在连接…','详情','标识','名称','项目目录','接入方式','命令（参数数组）','项目','应用账号标识','登录来源','备注','平台','启动方式','账号','隔离数据名称','区域','允许远程控制','后台自动触发','测试样本','提供登录的名称','设备 ID','构建产物','应用标识','启动方案','步骤（action / expected）','使用应用自己的登录入口。这里不填写密码或令牌。','保存在本机。移除条目不会删除应用登录和数据。','移除这条目录记录？应用数据将保留。','请选择…','沿用原配置','关闭','开启','原始启动','验收配置','连接未完成。请刷新重连；再次启动前先检查运行记录。','已提交启动，请到运行记录查看状态。','保存前请刷新：另一处已修改这份配置。','启动详情','自定义命令','Cindy 源码项目','已就绪','等待登录','准备中','运行中','已停止','已完成','失败','待核实','停止中','启动中','调试端口'],
 ja:['テスト環境','アカウントと設定を選び、次回も再利用。','起動設定','プロジェクト','アカウント','ケース','実行履歴','追加','更新','編集','保存','キャンセル','起動設定を見る','起動','ビルド準備','検証','停止','削除','Cindy アカウントを読み込む','項目がありません。追加するか Cindy に設定を依頼してください。','保存しました','接続中…','詳細','ID','名前','プロジェクトの場所','接続方法','コマンド（引数配列）','プロジェクト','アプリのアカウントキー','ログイン元','メモ','プラットフォーム','起動方法','アカウント','分離データ名','地域','リモート操作','バックグラウンド自動実行','サンプル','ログイン提供名','デバイス ID','ビルド成果物','アプリ ID','起動設定','手順（action / expected）','アプリでログインしてください。ここにパスワードやトークンを入力しないでください。','ローカルに保存します。削除してもアプリのログインとデータは残ります。','この項目を削除しますか？アプリデータは残ります。','選択…','既存の設定','オフ','オン','従来の起動','テスト設定','接続できません。更新して再接続し、実行履歴を確認してください。','起動を要求しました。実行履歴を確認してください。','他の変更があります。保存前に更新してください。','起動の詳細','カスタムコマンド','Cindy ソース','準備完了','ログイン待ち','準備中','実行中','停止済み','完了','失敗','要確認','停止中','起動中','デバッグポート'],
 ko:['테스트 환경','계정과 설정을 선택하고 다음에도 재사용하세요.','실행 설정','프로젝트','계정','사례','실행 기록','추가','새로 고침','편집','저장','취소','실행 설정 보기','시작','빌드 준비','검증','중지','삭제','Cindy 계정 가져오기','항목이 없습니다. 추가하거나 Cindy에 설정을 요청하세요.','저장됨','연결 중…','상세','ID','이름','프로젝트 경로','연결 방식','명령 (인수 배열)','프로젝트','앱 계정 키','로그인 소스','메모','플랫폼','실행 방식','계정','격리 데이터 이름','지역','원격 제어','백그라운드 자동 실행','테스트 샘플','로그인 제공 이름','기기 ID','빌드 결과물','앱 ID','실행 설정','단계 (action / expected)','앱에서 로그인하세요. 여기에는 비밀번호나 토큰을 입력하지 마세요.','로컬에 저장됩니다. 항목을 삭제해도 앱 로그인과 데이터는 유지됩니다.','이 항목을 삭제할까요? 앱 데이터는 유지됩니다.','선택…','기존 설정 유지','끄기','켜기','기존 실행','검수 설정','연결하지 못했습니다. 새로 고침 후 실행 기록을 확인하세요.','실행을 요청했습니다. 실행 기록에서 상태를 확인하세요.','다른 변경이 있습니다. 저장하기 전에 새로 고침하세요.','실행 상세','사용자 명령','Cindy 소스','준비 완료','로그인 대기','준비 중','실행 중','중지됨','완료','실패','확인 필요','중지 중','시작 중','디버그 포트']};
const ACCOUNT_COPY={
 en:['Select account','Remember accounts','Real accounts sign in separately on each computer. The app keeps encrypted sessions; the plugin remembers their profiles. Expired authorization needs sign-in again.','Local profiles','Account history; sign in on this computer if unavailable','Checking account'],
 'zh-CN':['选用账号','记住账号','正式账号在每台电脑分别登录。应用保存加密登录态，插件记住对应档案；授权过期后需重新登录。','本机登录档案','历史账号；本机不可用时需登录','核对账号中'],
 ja:['アカウントを選択','アカウントを記録','実アカウントは各パソコンでログインします。暗号化セッションはアプリ、プロファイル参照はプラグインが保持します。期限切れ時は再ログインが必要です。','この端末のプロファイル','履歴です。この端末で利用できない場合はログインしてください。','アカウントを確認中'],
 ko:['계정 선택','계정 기억','실제 계정은 컴퓨터마다 로그인합니다. 암호화 세션은 앱이, 프로필 참조는 플러그인이 보관합니다. 인증 만료 시 다시 로그인해야 합니다.','이 컴퓨터의 프로필','계정 기록입니다. 이 컴퓨터에서 사용할 수 없으면 로그인하세요.','계정 확인 중']};
for(const key of Object.keys(COPY))COPY[key].push(...ACCOUNT_COPY[key],{en:'Prepare samples','zh-CN':'准备样本',ja:'サンプルを準備',ko:'샘플 준비'}[key],{en:'This local sign-in has expired. Sign in again in the target application; other computers keep their own sessions.','zh-CN':'本机登录已失效，请在目标应用中重新登录。其他电脑的登录态不受影响。',ja:'この端末のログインが失効しました。対象アプリで再ログインしてください。他の端末のセッションには影響しません。',ko:'이 컴퓨터의 로그인이 만료되었습니다. 대상 앱에서 다시 로그인하세요. 다른 컴퓨터의 세션은 유지됩니다.'}[key]);
let locale='en',db,tab='profiles',busy=false;const $=id=>document.getElementById(id),t=n=>(COPY[locale]||COPY.en)[n];
const channel=new BroadcastChannel('test-environments-pages'),pending=new Map();
channel.onmessage=({data})=>{if(data?.type!=='response')return;const p=pending.get(data.id);if(!p)return;clearTimeout(p.timer);clearInterval(p.resend);pending.delete(data.id);data.result?.ok?p.resolve(data.result.data):p.reject(Object.assign(new Error(data.result?.message||t(55)),{code:data.result?.errorCode}));};
async function call(method,args={}){await fetch('/wake').then(r=>{if(!r.ok)throw Error(t(55));});return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{clearInterval(resend);pending.delete(id);reject(Error(t(55)));},32000);const send=()=>channel.postMessage({type:'request',id,method,args}),resend=setInterval(send,600);pending.set(id,{resolve,reject,timer,resend});send();});}
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function notice(text,error=false){$('notice').textContent=text;$('notice').className=error?'error':'';}
async function perform(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){notice(e.code==='REVISION_CHANGED'?t(57):`${e.code||''} ${e.message}`,true);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
function button(text,fn,cls){const b=el('button',text,cls);b.type='button';b.onclick=()=>perform(fn);return b;}
function output(data){$('outputWrap').hidden=false;$('outputWrap').open=true;$('output').textContent=JSON.stringify(data,null,2);}
async function refresh(){db=await call('catalog');$('storage').textContent=t(47)+'\n'+db.storage;await render();notice('');}
const sections={profiles:2,projects:3,accounts:4,cases:5,jobs:6};
async function render(){
 $('tabs').replaceChildren(...Object.entries(sections).map(([k,n])=>{const b=button(t(n),async()=>{tab=k;$('editor').hidden=true;await render();});b.setAttribute('aria-pressed',String(tab===k));return b;}));$('add').hidden=tab==='jobs';$('records').replaceChildren();
 const records=tab==='jobs'?(await call('status')).jobs:Object.values(db[tab]);if(!records.length){$('records').append(el('p',t(19),'empty'));return;}
 for(const record of records){const card=el('article',undefined,'record');card.append(el('h2',record.label||db.profiles[record.profile]?.label||record.profile));
 let meta=tab==='profiles'?[db.projects[record.project]?.label,record.platform,record.mode==='legacy'?t(53):t(54),record.account?db.accounts[record.account]?.label:''].filter(Boolean).join(' · '):tab==='projects'?record.root:tab==='accounts'?`${db.projects[record.project]?.label} · ${record.selector}`:tab==='cases'?`${db.profiles[record.profile]?.label} · ${record.steps.length}`:new Date(record.startedAt).toLocaleString(locale);
 card.append(el('p',meta,'meta'));const actions=el('div',undefined,'actions');
 if(tab==='accounts'){
 const sessions=Object.values(record.sessions||{}).filter(s=>db.profiles[s.profile]?.isolated===s.isolated);
 card.append(el('p',t(75)+': '+(sessions.map(s=>(db.profiles[s.profile]?.label||s.profile)+(s.listed?'':' · '+t(76))).join(', ')||t(76)),'meta'));
 }
 if(tab==='jobs'){
 const states={ready:61,'waiting-for-owner':62,'checking-account':77,preparing:63,running:64,stopped:65,completed:66,failed:67,unknown:68,stopping:69,starting:70};card.append(el('p',t(states[record.state]??68),'badge'));actions.append(button(t(22),()=>output(record)));if(!['stopped','completed'].includes(record.state))actions.append(button(t(16),async()=>{output(await call('stop',{jobId:record.jobId}));await render();}));
 if(record.code==='ACCOUNT_REAUTH_REQUIRED')card.append(el('p',t(79),'meta'));
 const profile=db.profiles[record.profile];
 if(record.application&&profile&&['preparing','checking-account','waiting-for-owner','ready'].includes(record.state)){
 actions.append(button(t(73),async()=>{output(await call('import_cindy',{project:profile.project,jobId:record.jobId}));await refresh();}));
 if(profile.mode==='acceptance'){
 const choice=el('select');choice.setAttribute('aria-label',t(72));choice.append(new Option(t(49),''));
 for(const account of Object.values(db.accounts).filter(a=>a.project===profile.project))choice.append(new Option(account.label,account.id));
 actions.append(choice,button(t(72),async()=>{if(!choice.value)return;output(await call('select_account',{jobId:record.jobId,account:choice.value}));await render();}));
 }
 }
 }else{
 actions.append(button(t(9),()=>edit(record)));if(tab==='profiles'){
 if(db.projects[record.project]?.commands?.prepare||(record.platform!=='desktop'&&record.platform!=='linux'))actions.append(button(t(db.projects[record.project]?.commands?.prepare?78:14),async()=>{output(await call('start',{profile:record.id,action:'prepare'}));tab='jobs';await render();}));
 if(db.projects[record.project]?.commands?.verify)actions.append(button(t(15),async()=>{output(await call('start',{profile:record.id,action:'verify'}));tab='jobs';await render();}));
 actions.append(button(t(12),async()=>output(await call('plan',{profile:record.id}))),button(t(13),async()=>{output(await call('start',{profile:record.id}));notice(t(56));tab='jobs';await render();},'primary'));
 }if(tab==='projects'&&record.adapter==='cindy')actions.append(button(t(18),async()=>{output(await call('import_cindy',{project:record.id}));await refresh();}));
 actions.append(button(t(17),async()=>{if(!confirm(t(48)))return;await call('remove',{kind:tab,id:record.id,revision:db.revision});await refresh();}));}
 card.append(actions);$('records').append(card);
 }
}
const definitions={
 projects:[['id',23],['label',24],['root',25],['adapter',26,['cindy','command']],['commands',27,'json']],
 accounts:[['id',23],['label',24],['project',28,'projects'],['selector',29],['notes',31]],
 profiles:[['id',23],['label',24],['project',28,'projects'],['platform',32,['desktop','ios','android','linux']],['mode',33,['acceptance','legacy']],['account',34,'accounts'],['isolated',35],['region',36,['global','cn']],['remoteControl',37,['off','on','inherit']],['background',38,['off','on','inherit']],['fixture',39],['deviceId',41],['artifactPath',42],['bundleId',43],['debugPort',71,'number']],
 cases:[['id',23],['label',24],['profile',44,'profiles'],['steps',45,'json']]
};
function edit(record={}){
 const kind=tab,revision=db.revision,form=el('form'),fields=el('div',undefined,'fields'),inputs={};$('editor').replaceChildren(form);$('editor').hidden=false;
 for(const[key,n,type]of definitions[kind]){const label=el('label',t(n));let input;
 if(Array.isArray(type)||['projects','accounts','profiles'].includes(type)){
 input=el('select');const choices=Array.isArray(type)?type:Object.values(db[type]).map(x=>x.id);if(!Array.isArray(type))input.append(new Option(t(49),''));for(const value of choices){const map={off:51,on:52,inherit:50,legacy:53,acceptance:54,command:59,cindy:60};input.append(new Option(Array.isArray(type)?(map[value]!==undefined?t(map[value]):value):db[type][value].label,value));}
 }else{input=el(type==='json'?'textarea':'input');if(type==='number'){input.type='number';input.min='1024';input.max='65535';}if(type==='json')label.className='wide';}
 input.setAttribute('aria-label',t(n));input.name=key;input.value=type==='json'?JSON.stringify(record[key]??(key==='steps'?[{action:'',expected:''}]:{}),null,2):record[key]??(kind==='profiles'?{mode:'acceptance',platform:'desktop',region:'global',remoteControl:'off',background:'off'}[key]:'')??input.value;
 if(Array.isArray(type)&&!input.value)input.value=type[0];
 if(['id','label','root','selector'].includes(key))input.required=true;if(key==='id'&&record.id)input.readOnly=true;
 inputs[key]=input;label.append(input);fields.append(label);
 }
 function accountChoices(){if(kind!=='profiles')return;const old=inputs.account.value;inputs.account.replaceChildren(new Option(t(49),''));Object.values(db.accounts).filter(a=>a.project===inputs.project.value).forEach(a=>inputs.account.append(new Option(a.label,a.id)));inputs.account.value=old;}
 if(kind==='profiles'){accountChoices();inputs.project.onchange=accountChoices;const sync=()=>{const legacy=inputs.mode.value==='legacy';for(const k of ['account','remoteControl','background','fixture']){inputs[k].disabled=legacy;} };inputs.mode.onchange=sync;sync();}
 form.append(fields,el('p',t(46)),el('p',t(74)));const actions=el('div',undefined,'actions'),save=el('button',t(10),'primary');save.type='submit';actions.append(save,button(t(11),()=>{$('editor').hidden=true;}));form.append(actions);
 form.onsubmit=e=>{e.preventDefault();perform(async()=>{const value={};for(const[key,,type]of definitions[kind]){if(inputs[key].disabled)continue;const v=inputs[key].value.trim();if(v)value[key]=type==='json'?JSON.parse(v):type==='number'?Number(v):v;}const method={projects:'save_project',accounts:'save_account',profiles:'save_profile',cases:'save_case'}[kind],param={projects:'project',accounts:'account',profiles:'profile',cases:'testCase'}[kind];await call(method,{[param]:value,revision});$('editor').hidden=true;await refresh();notice(t(20));});};$('editor').scrollIntoView({block:'nearest'});
}
async function boot(){const context=await fetch('/app-context').then(r=>r.json()).catch(()=>null);locale=COPY[context?.context?.locale]?context.context.locale:'en';document.documentElement.lang=locale;$('title').textContent=t(0);$('subtitle').textContent=t(1)+' '+t(74);$('add').textContent=t(7);$('refresh').textContent=t(8);$('outputTitle').textContent=t(58);$('add').onclick=()=>edit();$('refresh').onclick=()=>perform(refresh);notice(t(21));await perform(refresh);}
boot();
