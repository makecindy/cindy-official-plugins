(function(root){
  'use strict';
  const C=typeof module!=='undefined'?require('./core.js'):root.PodcastCore;
  const API='https://open.feishu.cn/open-apis';
  const MAX_UPLOAD=20*1024*1024;
  const stamp=()=>new Date().toISOString();
  function token(value){if(typeof value!=='string'||!(/^[A-Za-z0-9_-]{1,256}$/).test(value))C.fail('FEISHU_INVALID_TOKEN');return value;}
  function minute(value){
    let u;try{u=new URL(value);}catch{C.fail('FEISHU_INVALID_MINUTE');}
    if(u.protocol!=='https:'||u.username||u.password||u.port||!/(^|\.)feishu\.cn$/.test(u.hostname)||!/^\/minutes\/[a-z0-9]+\/?$/.test(u.pathname))C.fail('FEISHU_INVALID_MINUTE');
    return {token:u.pathname.split('/')[2],url:u.origin+u.pathname.replace(/\/$/,'')};
  }
  class FeishuMinutes{
    constructor(service){this.s=service;}
    async meta(j){const row=(await this.s.rows('SELECT value FROM meta WHERE key=?',['feishu:'+j.id]))[0];if(!row)C.fail('FEISHU_JOB_METADATA_MISSING');return JSON.parse(row.value);}
    async save(j,m){await this.s.sql('INSERT OR REPLACE INTO meta VALUES(?,?)',['feishu:'+j.id,JSON.stringify(m)]);}
    /**
     * @param {string} path
     * @param {{method?: string, body?: Record<string, unknown>, upload?: {hashes: string[], field: string, fields: Record<string,string>}, deadline?: number}} options
     */
    async request(path,{method='GET',body,upload,deadline=Infinity}={}){
      const remaining=deadline-Date.now();if(remaining<=0)C.fail('STATUS_BUDGET_EXHAUSTED');
      const r=await this.s.host.fetch({url:API+path,method,as:'text',timeoutMs:Math.min(60000,remaining),headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),...(upload?{upload}:{})});
      if(!r?.ok||r.truncated||r.status<200||r.status>=300)throw Object.assign(new Error(r?.status===401?'FEISHU_AUTH_EXPIRED':r?.status===403?'FEISHU_PERMISSION_REQUIRED':'FEISHU_NETWORK_FAILED'),{code:r?.status===401?'FEISHU_AUTH_EXPIRED':r?.status===403?'FEISHU_PERMISSION_REQUIRED':'FEISHU_NETWORK_FAILED',definitelyRejected:r?.ok===true&&r.status>=400&&r.status<500});
      let data;try{data=JSON.parse(r.body);}catch{C.fail('FEISHU_INVALID_RESPONSE');}
      if(data.code!==0){const code=data.code===2091003?'FEISHU_PROCESSING':data.code===2091008?'FEISHU_QUOTA_EXCEEDED':[99991663,99991664,99991668].includes(data.code)?'FEISHU_AUTH_EXPIRED':[99991672,99991679,2091005].includes(data.code)?'FEISHU_PERMISSION_REQUIRED':'FEISHU_REJECTED';throw Object.assign(new Error(code),{code,definitelyRejected:true});}
      if(!data.data||typeof data.data!=='object')C.fail('FEISHU_INVALID_RESPONSE');return data.data;
    }
    async account(deadline=Infinity){
      if(!(await this.s.host.credentialsStatus('feishu')))C.fail('FEISHU_TOKEN_MISSING');
      const d=await this.request('/authen/v1/user_info',{deadline});return token(d.open_id);
    }
    async assertAccount(m,deadline=Infinity){if(await this.account(deadline)!==m.account_id)C.fail('FEISHU_ACCOUNT_CHANGED');}
    async newJob(e,cardId,m,remote=''){
      const j={id:crypto.randomUUID(),episode_id:e.id,provider:'feishu',state:remote?'submitted':'prepared',remote_id:remote,est_usd:null,submitted_at:remote?stamp():'',checked_at:'',error:'',card_id:cardId||'',audio_url:e.audio_url};
      // Metadata and the confirmation state commit together; existing schema is unchanged.
      await this.s.batch([{sql:'INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)',params:Object.values(j)},{sql:'INSERT INTO meta VALUES(?,?)',params:['feishu:'+j.id,JSON.stringify(m)]}]);return j;
    }
    outcomes(j,m){
      // Read old records conservatively: a lost receipt never means no request.
      const upload_outcome=m.upload_outcome||(['uploading','uploaded'].includes(m.phase)?(m.phase==='uploaded'?'executed':'unknown'):m.file_token?'not_requested':['submitting','unknown'].includes(j.state)?'unknown':'not_executed');
      const minute_outcome=j.remote_id?'executed':m.minute_outcome||(m.phase==='creating'?(j.state==='failed'?'not_executed':'unknown'):'not_executed');
      const submission_outcome=upload_outcome==='unknown'||minute_outcome==='unknown'?'unknown':upload_outcome==='executed'||minute_outcome==='executed'?'executed':'not_executed';
      return {...j,upload_outcome,minute_outcome,submission_outcome};
    }
    async prepareAudio(e,callId){
      if(!callId)C.fail('AGENT_CALL_REQUIRED');
      const u=new URL(C.url(e.audio_url)),hostname=u.hostname.replace(/\.$/,'');
      if(hostname==='open.feishu.cn'||hostname==='api.assemblyai.com')C.fail('SOURCE_PROVIDER_FORBIDDEN');
      // Public audio is fetched only during this still-running Agent tool call.
      const media=await this.s.host.fetch({url:u.href,as:'media',callId,timeoutMs:300000});
      if(!media?.ok||media.status<200||media.status>=300||!media.media||!Number.isSafeInteger(media.media.bytes)||media.media.bytes<1)C.fail('FEISHU_AUDIO_DOWNLOAD_FAILED');
      if(media.media.bytes>MAX_UPLOAD)C.fail('FEISHU_UPLOAD_TOO_LARGE');
      if(!/^[a-f0-9]{64}$/.test(media.media.hash))C.fail('FEISHU_INVALID_RESPONSE');
      return {hash:media.media.hash,bytes:media.media.bytes,ext:/^(mp3|wav|m4a|ogg)$/.test(media.media.ext)?media.media.ext:'mp3'};
    }
    async run(a,cardId){
      if(!['prepare','import','recover'].includes(a.action))C.fail('INVALID_INPUT');
      if(a.action==='recover'&&(typeof a.job_id!=='string'||!a.job_id))C.fail('INVALID_INPUT');
      if(a.action!=='prepare')minute(a.minute_url);
      const e=await this.s.episode(a.episode_id),account_id=await this.account();
      if(a.action==='recover'){
        const j=(await this.s.rows("SELECT * FROM jobs WHERE id=? AND provider='feishu' AND episode_id=?",[a.job_id,e.id]))[0];if(!j)C.fail('JOB_NOT_FOUND');
        if(!['unknown','submitted'].includes(j.state))C.fail('FEISHU_RECOVERY_NOT_REQUIRED');
        const m=await this.meta(j);if(m.account_id!==account_id)C.fail('FEISHU_ACCOUNT_CHANGED');const source=minute(a.minute_url);
        await this.request('/minutes/v1/minutes/'+source.token);
        if(j.remote_id&&j.remote_id!==source.token)C.fail('FEISHU_REMOTE_CONFLICT');
        const claim=await this.s.sql("UPDATE jobs SET remote_id=?,state='submitted',error='' WHERE id=? AND NOT EXISTS (SELECT 1 FROM jobs WHERE provider='feishu' AND remote_id=? AND id<>?)",[source.token,j.id,source.token,j.id]);
        if(claim.changes!==1)C.fail('FEISHU_REMOTE_CONFLICT');await this.save(j,{...m,minute_url:source.url,minute_outcome:'executed',phase:'created'});
        return {job:this.s.publicJob(await this.check({...j,remote_id:source.token,state:'submitted'})),submission_outcome:'executed'};
      }
      if(a.action==='import'){
        const source=minute(a.minute_url);await this.request('/minutes/v1/minutes/'+source.token);
        const old=(await this.s.rows("SELECT * FROM jobs WHERE provider='feishu' AND remote_id=?",[source.token]))[0];
        if(old){if(old.episode_id!==e.id)C.fail('FEISHU_REMOTE_CONFLICT');await this.assertAccount(await this.meta(old));return {job:this.s.publicJob(await this.check(old))};}
        const j=await this.newJob(e,cardId,{account_id,minute_url:source.url,phase:'created',upload_outcome:'not_requested',minute_outcome:'executed'},source.token);return {job:this.s.publicJob(await this.check(j))};
      }
      const file_token=a.file_token?token(a.file_token):'';
      if(!file_token&&!e.audio_url)C.fail('AUDIO_URL_REQUIRED');
      if(!file_token&&e.audio_bytes>MAX_UPLOAD)C.fail('FEISHU_UPLOAD_TOO_LARGE');
      if(e.duration_s>21600)C.fail('AUDIO_TOO_LARGE');
      const existing=(await this.s.rows("SELECT * FROM jobs WHERE episode_id=? AND state IN ('prepared','claiming','submitting','submitted','unknown') ORDER BY submitted_at DESC LIMIT 1",[e.id]))[0];
      if(existing){
        if(existing.provider!=='feishu')C.fail('PROVIDER_JOB_EXISTS');
        if(existing.provider==='feishu'){
          const m=await this.meta(existing);if(m.account_id!==account_id)C.fail('FEISHU_ACCOUNT_CHANGED');
          if(existing.state==='prepared'){
            await this.s.batch([{sql:'UPDATE jobs SET card_id=?,audio_url=? WHERE id=? AND state=?',params:[cardId||existing.card_id,e.audio_url,existing.id,'prepared']},{sql:'INSERT OR REPLACE INTO meta VALUES(?,?)',params:['feishu:'+existing.id,JSON.stringify({...m,file_token,audio:file_token?null:await this.prepareAudio(e,cardId),upload_outcome:file_token?'not_requested':'not_executed',minute_outcome:'not_executed'})]}]);existing.card_id=cardId||existing.card_id;
          }
        }
        return {job:this.s.publicJob(existing),episode:this.s.publicEpisode(e),requires_user_confirmation:existing.state==='prepared'};
      }
      const audio=file_token?null:await this.prepareAudio(e,cardId);
      const j=await this.newJob(e,cardId,{account_id,file_token,audio,phase:'prepared',upload_outcome:file_token?'not_requested':'not_executed',minute_outcome:'not_executed'});
      return {job:this.s.publicJob(j),episode:this.s.publicEpisode(e),requires_user_confirmation:true,upload_limit_bytes:MAX_UPLOAD};
    }
    async submit(j,event){
      if(j.state!=='prepared')return {job:this.s.publicJob(this.outcomes(j,await this.meta(j))),already_submitted:true};
      const m=await this.meta(j);await this.assertAccount(m);
      const e=await this.s.episode(j.episode_id);
      if(e.audio_url!==j.audio_url)C.fail('FEISHU_SOURCE_CHANGED');
      if(!m.file_token&&(!m.audio||!(/^[a-f0-9]{64}$/).test(m.audio.hash)||!Number.isSafeInteger(m.audio.bytes)||m.audio.bytes<1))C.fail('FEISHU_AUDIO_PREPARATION_REQUIRED');
      if(!m.file_token&&(e.audio_bytes>MAX_UPLOAD||m.audio.bytes>MAX_UPLOAD))C.fail('FEISHU_UPLOAD_TOO_LARGE');
      if(e.duration_s>21600)C.fail('AUDIO_TOO_LARGE');
      const claimed=await this.s.sql("UPDATE jobs SET state='submitting',submitted_at=?,card_id=? WHERE id=? AND state='prepared'",[stamp(),event.spawnCallId||event.callId,j.id]);if(claimed.changes!==1)C.fail('JOB_EXISTS');
      Object.assign(j,{state:'submitting',submitted_at:stamp(),card_id:event.spawnCallId||event.callId,upload_outcome:m.file_token?'not_requested':'not_executed',minute_outcome:'not_executed'});let wrote=false,phase='download';
      try{
        await this.s.sql("UPDATE episodes SET transcript_state=CASE WHEN transcript_state='ready' THEN 'ready' ELSE 'transcribing' END WHERE id=?",[j.episode_id]);
        if(!m.file_token){
          const media=m.audio;
          const folder=await this.request('/drive/explorer/v2/root_folder/meta');
          const parent=token(folder.token);phase='upload';m.phase='uploading';m.upload_outcome='unknown';await this.save(j,m);wrote=true;j.upload_outcome='unknown';
          const file=await this.request('/drive/v1/files/upload_all',{method:'POST',upload:{hashes:[media.hash],field:'file',fields:{file_name:'podcast-'+j.id+'.'+(/^(mp3|wav|m4a|ogg)$/.test(media.ext)?media.ext:'mp3'),parent_type:'explorer',parent_node:parent,size:String(media.bytes)}}});
          m.file_token=token(file.file_token);m.phase='uploaded';j.upload_outcome='executed';m.upload_outcome='executed';await this.save(j,m);
        }
        m.phase='creating';m.minute_outcome='unknown';await this.save(j,m);wrote=true;phase='create';j.minute_outcome='unknown';
        const created=await this.request('/minutes/v1/minutes/upload',{method:'POST',body:{file_token:m.file_token}}),source=minute(created.minute_url);
        j.remote_id=source.token;m.minute_url=source.url;m.phase='created';j.submission_outcome='executed';j.minute_outcome='executed';m.minute_outcome='executed';
        await this.save(j,m);
        await this.s.sql("UPDATE jobs SET state='submitted',remote_id=?,checked_at=?,error='' WHERE id=?",[source.token,stamp(),j.id]);j.state='submitted';
      }catch(error){
        const rejected=error.definitelyRejected===true;
        if(rejected&&phase==='upload')j.upload_outcome='not_executed';
        if(rejected&&phase==='create')j.minute_outcome='not_executed';
        m.upload_outcome=j.upload_outcome;m.minute_outcome=j.minute_outcome;
        const outcome=j.remote_id?'executed':wrote&&!rejected?'unknown':j.upload_outcome==='executed'?'executed':'not_executed';
        Object.assign(j,{state:j.remote_id?'submitted':wrote&&!rejected?'unknown':'failed',error:error.code||'FEISHU_NETWORK_FAILED',submission_outcome:outcome});
        try{
          await this.save(j,m);
          await this.s.sql('UPDATE jobs SET state=?,remote_id=?,error=?,checked_at=? WHERE id=?',[j.state,j.remote_id,j.error,stamp(),j.id]);
          if(j.state==='failed')await this.s.sql("UPDATE episodes SET transcript_state=CASE WHEN transcript_state='ready' THEN 'ready' ELSE 'failed' END WHERE id=?",[j.episode_id]);
        }catch{j.local_state_persisted=false;j.recovery_incomplete=true;}
      }
      return {job:this.s.publicJob(j)};
    }
    async check(j,deadline=Infinity){
      const m=await this.meta(j);j=this.outcomes(j,m);
      if(['prepared','completed','failed'].includes(j.state))return j;
      try{await this.assertAccount(m,deadline);}catch(e){return {...j,errorCode:e.code||'FEISHU_NETWORK_FAILED',recovery_incomplete:true};}
      // Never repeat either POST when a previous receipt is missing.
      if(!j.remote_id&&m.minute_url){const source=minute(m.minute_url);const claim=await this.s.sql("UPDATE jobs SET remote_id=?,state='submitted' WHERE id=? AND NOT EXISTS (SELECT 1 FROM jobs WHERE provider='feishu' AND remote_id=? AND id<>?)",[source.token,j.id,source.token,j.id]);if(claim.changes!==1)C.fail('FEISHU_REMOTE_CONFLICT');j={...j,remote_id:source.token,state:'submitted'};}
      if(!j.remote_id)return {...j,state:'unknown',recovery_incomplete:true,error:'FEISHU_SUBMISSION_UNKNOWN'};
      const remote=token(j.remote_id);let data;
      try{data=await this.request('/minutes/v1/minutes/'+remote+'/artifacts',{deadline});}catch(e){if(e.code==='FEISHU_PROCESSING')return {...j,state:'submitted'};throw e;}
      if(typeof data.transcript!=='string'||!data.transcript.trim())return {...j,state:'submitted',error:'FEISHU_TRANSCRIPT_PENDING'};
      if(C.bytes(data.transcript)>5*1024*1024)C.fail('TRANSCRIPT_TOO_LARGE');
      // This API returns text. Do not invent speaker identities or interpolate times.
      const format=/^WEBVTT\b/.test(data.transcript.trim())?'vtt':/\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(data.transcript)?'srt':'txt';
      await this.s.store(j.episode_id,C.segments(data.transcript,format),'feishu_minutes',format,m.minute_url||'',j.id);
      const artifacts={summary:typeof data.summary==='string'?data.summary.slice(0,20000):'',chapters:Array.isArray(data.minute_chapters)?data.minute_chapters.slice(0,100):[],source:m.minute_url||'',untrusted:true};
      if(C.bytes(JSON.stringify(artifacts))<=200000)await this.s.sql('INSERT OR REPLACE INTO meta VALUES(?,?)',['feishu-artifacts:'+j.id,JSON.stringify(artifacts)]);
      await this.s.sql("UPDATE jobs SET state='completed',checked_at=?,error='' WHERE id=?",[stamp(),j.id]);return {...j,state:'completed',error:''};
    }
  }
  if(typeof module!=='undefined')module.exports=FeishuMinutes;else root.FeishuMinutes=FeishuMinutes;
})(globalThis);
