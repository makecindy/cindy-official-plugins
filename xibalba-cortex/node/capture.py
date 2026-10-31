"""Opt-in local Cindy history connector. Source database is ALWAYS read-only."""
from __future__ import annotations
import collections,hashlib,json,os,sqlite3,sys,time
from pathlib import Path
from urllib.parse import quote
from capture_files import references,snapshot,MAX_FILES,SnapshotDeferred
ROLES=('user','assistant','tool_use','tool_result','ask_user','plan_review')
REQUIRED={'messages':{'id','session_id','role','content','created_at','tool_use_id','rewind_at'},'sessions':{'id','title','working_dir','agent_kind','status','parent_session_id','orca_role','source'}}
def source_connection(database):
    path=Path(database).expanduser().resolve(strict=True)
    if not path.is_file():raise ValueError('Select an existing Cindy history database.')
    conn=sqlite3.connect('file:'+quote(str(path),safe='/')+'?mode=ro',uri=True,timeout=2)
    conn.execute('PRAGMA query_only=ON');conn.row_factory=sqlite3.Row
    for table,columns in REQUIRED.items():
        if not columns<={r[1] for r in conn.execute('PRAGMA table_info('+table+')')}:
            conn.close();raise ValueError('Unsupported Cindy history schema. Capture stopped without changing source history.')
    return conn,path
def rows_query(conn):
    cols={r[1] for r in conn.execute('PRAGMA table_info(sessions)')}
    optional=''.join(',s.'+x for x in ('workspace_kind','remote_host_id') if x in cols)
    return 'SELECT m.rowid AS source_rowid,m.id,m.session_id,m.role,m.content,m.created_at,m.tool_use_id,m.rewind_at,s.title AS session_title,s.working_dir,s.agent_kind,s.parent_session_id,s.orca_role,s.source AS session_source'+optional+' FROM messages m JOIN sessions s ON s.id=m.session_id WHERE s.status<>\'deleted\' AND m.role IN ('+','.join('?' for _ in ROLES)+')'
def envelope(row):
    value=dict(row);value.pop('source_rowid',None);value['capture_schema']=2
    try:value['content']=json.loads(value['content'])
    except (ValueError,TypeError):pass
    return value
def chunks(text,size=24000):return [text[i:i+size] for i in range(0,len(text),size)] or ['']
def serialize(record):return json.dumps(record,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def revision(record):return hashlib.sha256(serialize(record).encode()).hexdigest()
def fragment(part):return json.dumps({'capture_schema':2,'fragment':part},ensure_ascii=False,separators=(',',':'))
def checkpoint_schema(state):
    state.executescript('CREATE TABLE IF NOT EXISTS imported(source TEXT,message TEXT,revision TEXT,parts INTEGER,PRIMARY KEY(source,message,revision)); CREATE TABLE IF NOT EXISTS cursors(source TEXT PRIMARY KEY,rowid INTEGER NOT NULL DEFAULT 0,last_error TEXT,last_success REAL); CREATE TABLE IF NOT EXISTS artifact_attempts(source TEXT,message TEXT,reference TEXT,status TEXT,sha256 TEXT,memory_id TEXT,byte_size INTEGER,PRIMARY KEY(source,message,reference));')
    # Preserve the last successful snapshot independently of later missing/error attempts.
    state.executescript('CREATE TABLE IF NOT EXISTS artifact_snapshots(source TEXT,message TEXT,reference TEXT,sha256 TEXT,memory_id TEXT,byte_size INTEGER,manifest_json TEXT,PRIMARY KEY(source,message,reference)); CREATE TABLE IF NOT EXISTS artifact_cursors(source TEXT,message TEXT,revision TEXT,next_index INTEGER,PRIMARY KEY(source,message));')
    state.execute("INSERT OR IGNORE INTO artifact_snapshots(source,message,reference,sha256,memory_id,byte_size) SELECT source,message,reference,sha256,memory_id,byte_size FROM artifact_attempts WHERE status='archived'")

def synchronize(database,home,writer,redactor=lambda x:x,limit=50,deadline=25,archive_files=False,artifact_writer=None):
    source,path=source_connection(database);root=Path(home).resolve(strict=True)
    if root==path or root in path.parents:source.close();raise ValueError('Cindy source history must be outside the Cortex destination profile.')
    folder=root/'cindy-capture';folder.mkdir(mode=0o700,exist_ok=True);checkpoint=folder/'history.sqlite3'
    state=sqlite3.connect(checkpoint,timeout=5);os.chmod(checkpoint,0o600);checkpoint_schema(state)
    source_id=hashlib.sha256(str(path).encode()).hexdigest();state.execute('INSERT OR IGNORE INTO cursors(source) VALUES (?)',(source_id,));state.commit()
    cursor=state.execute('SELECT rowid FROM cursors WHERE source=?',(source_id,)).fetchone()[0]
    imported=0;scanned=0;started=time.monotonic();complete=False;files=collections.Counter();budget_exhausted=False
    try:
        rows=source.execute(rows_query(source)+' AND m.rowid>? ORDER BY m.rowid LIMIT ?',(*ROLES,cursor,limit)).fetchall()
        for row in rows:
            if time.monotonic()-started>deadline:break
            scanned+=1;record=envelope(row);rev=revision(record)
            seen=state.execute('SELECT 1 FROM imported WHERE source=? AND message=? AND revision=?',(source_id,row['id'],rev)).fetchone()
            if not seen:
                parts=chunks(redactor(serialize(record)))
                for index,part in enumerate(parts):
                    event_id=f'{source_id}:{row["id"]}:{rev}:{index}'
                    writer(event_id,fragment(part),{'kind':'cindy_history_message','locator':f'cindy://sessions/{row["session_id"]}/messages/{row["id"]}/parts/{index}','session_id':'cindy:'+row['session_id'],'message_id':row['id'],'role':row['role'],'metadata':{'capture_surface':'cindy_history_readonly','source_revision_sha256':rev,'part_index':index,'part_count':len(parts),'part_sha256':hashlib.sha256(part.encode()).hexdigest(),'background_session':bool(row['parent_session_id'] or row['orca_role']),'tool_use_id':row['tool_use_id'],'rewound':row['rewind_at'] is not None,'content_format':'json_fragment_v2','source_database_sha256':source_id}})
                state.execute('INSERT INTO imported VALUES (?,?,?,?)',(source_id,row['id'],rev,len(parts)));imported+=1;state.commit()
            if archive_files and artifact_writer:
                refs=references(record)
                if len(refs)>MAX_FILES:files['reference_limit']+=len(refs)-MAX_FILES
                progress=state.execute('SELECT revision,next_index FROM artifact_cursors WHERE source=? AND message=?',(source_id,row['id'])).fetchone()
                next_index=progress[1] if progress and progress[0]==rev else 0
                for file_index,(reference,kind) in enumerate(refs[:MAX_FILES]):
                    if file_index<next_index:continue
                    state.execute('INSERT OR REPLACE INTO artifact_cursors VALUES (?,?,?,?)',(source_id,row['id'],rev,file_index));state.commit()
                    previous=state.execute('SELECT manifest_json,memory_id FROM artifact_snapshots WHERE source=? AND message=? AND reference=?',(source_id,row['id'],reference)).fetchone()
                    cached=(json.loads(previous[0]),{'id':previous[1]}) if previous and previous[0] else None
                    def consume(identity,manifest,temp):
                        return artifact_writer(f'{source_id}:{row["id"]}:file:{identity}',manifest,temp,{'kind':'cindy_file_snapshot','locator':f'cindy://sessions/{row["session_id"]}/messages/{row["id"]}/artifacts/{identity}','session_id':'cindy:'+row['session_id'],'message_id':row['id'],'role':row['role'],'metadata':{'capture_surface':'cindy_file_snapshot','source_database_sha256':source_id,'artifact_status':manifest['status'],'artifact_sha256':manifest.get('sha256')}})
                    try:manifest,result=snapshot(reference,kind,record,path,folder,consume,previous=cached,deadline=started+deadline)
                    except SnapshotDeferred:
                        budget_exhausted=True;files['deferred']+=len(refs[:MAX_FILES])-file_index;break
                    files[manifest['status']]+=1
                    if isinstance(result,dict) and result.get('reused'):files['reused_snapshots']+=1
                    memory=result.get('id') if isinstance(result,dict) else None
                    state.execute('INSERT OR REPLACE INTO artifact_attempts VALUES (?,?,?,?,?,?,?)',(source_id,row['id'],reference,manifest['status'],manifest.get('sha256'),memory,manifest.get('byte_size')))
                    if manifest['status']=='archived':
                        state.execute('INSERT OR REPLACE INTO artifact_snapshots VALUES (?,?,?,?,?,?,?)',(source_id,row['id'],reference,manifest['sha256'],memory,manifest['byte_size'],json.dumps(manifest)))
                    state.execute('UPDATE artifact_cursors SET next_index=? WHERE source=? AND message=?',(file_index+1,source_id,row['id']));state.commit()
                if budget_exhausted:break
                state.execute('DELETE FROM artifact_cursors WHERE source=? AND message=?',(source_id,row['id']));state.commit()
            cursor=row['source_rowid'];state.execute('UPDATE cursors SET rowid=?,last_error=NULL,last_success=? WHERE source=?',(cursor,time.time(),source_id));state.commit()
        complete=not budget_exhausted and len(rows)<limit and scanned==len(rows)
        if complete:state.execute('UPDATE cursors SET rowid=0 WHERE source=?',(source_id,));state.commit()
        total=state.execute('SELECT count(*) FROM imported WHERE source=?',(source_id,)).fetchone()[0]
        return {'ok':True,'imported':imported,'scanned':scanned,'imported_revisions':total,'scan_complete':complete,'source_read_only':True,'source_fingerprint':source_id,'files_this_sweep':dict(files),'coverage':{'roles':list(ROLES),'background_sessions':'persisted messages included','artifacts':'explicit attachments and eligible local artifact references snapshotted, 50 MiB per file, with status manifests' if archive_files else 'persisted content and references only','reasoning':'private text excluded; visible plans/progress retained; activity boundary metadata captured separately','source_truncation':'cannot recover content absent from Cindy history','delivery':'idempotent replay; checkpoint after successful writes; rescans catch edits','fragment_format':'json_fragment_v2, whitespace preserved','retention':'Cortex redaction on message envelopes; original attached bytes are not redacted'}}
    except Exception:
        state.execute('UPDATE cursors SET last_error=? WHERE source=?',('History import failed; checkpoint retained for retry.',source_id));state.commit();raise
    finally:source.close();state.close()
def audit(database,home,redactor=lambda x:x,verify_blobs=True):
    source,path=source_connection(database);source_id=hashlib.sha256(str(path).encode()).hexdigest();root=Path(home)
    target=sqlite3.connect('file:'+quote(str(root/'graph-memory.sqlite3'),safe='/')+'?mode=ro',uri=True);target.row_factory=sqlite3.Row
    counts={role:{'source':0,'verified':0,'missing_or_changed':0} for role in ROLES};failures=[];archived={};current_refs=set()
    try:
        for r in target.execute("SELECT m.content,m.status,s.message_id,s.metadata_json FROM memories m JOIN sources s ON s.id=m.source_id WHERE s.kind='cindy_history_message'"):
            meta=json.loads(r['metadata_json'] or '{}');meta=meta.get('metadata',meta)
            if meta.get('source_database_sha256')==source_id:archived.setdefault((r['message_id'],meta.get('source_revision_sha256')),{}).setdefault(meta.get('part_index'),r)
        source.execute('BEGIN')
        for row in source.execute(rows_query(source),ROLES):
            record=envelope(row);current_refs.update((row['id'],ref) for ref,kind in references(record));wanted=chunks(redactor(serialize(record)));parts=archived.get((row['id'],revision(record)),{});valid=True
            for index,text in enumerate(wanted):
                found=parts.get(index)
                try:valid=valid and found is not None and found['status']!='forgotten' and json.loads(found['content'])['fragment']==text
                except (KeyError,ValueError,TypeError):valid=False
            role=counts[row['role']];role['source']+=1;role['verified' if valid else 'missing_or_changed']+=1
            if not valid and len(failures)<10:failures.append({'message_id':row['id'],'role':row['role']})
        excluded={r['role']:r['n'] for r in source.execute("SELECT m.role,count(*) AS n FROM messages m JOIN sessions s ON s.id=m.session_id WHERE s.status<>'deleted' GROUP BY m.role") if r['role'] not in ROLES}
        file_counts=collections.Counter(source_references=len(current_refs));attempted=set();checkpoint=root/'cindy-capture'/'history.sqlite3'
        if checkpoint.exists():
            state=sqlite3.connect('file:'+quote(str(checkpoint),safe='/')+'?mode=ro',uri=True)
            if state.execute("SELECT 1 FROM sqlite_master WHERE name='artifact_attempts'").fetchone():
                for message,reference,status in state.execute('SELECT message,reference,status FROM artifact_attempts WHERE source=?',(source_id,)):
                    if (message,reference) in current_refs:attempted.add((message,reference));file_counts[status]+=1
                has_snapshots=state.execute("SELECT 1 FROM sqlite_master WHERE name='artifact_snapshots'").fetchone()
                query='SELECT message,reference,sha256,memory_id,byte_size FROM artifact_snapshots WHERE source=?' if has_snapshots else "SELECT message,reference,sha256,memory_id,byte_size FROM artifact_attempts WHERE source=? AND status='archived'"
                for message,reference,digest,memory,size in state.execute(query,(source_id,)):
                    if (message,reference) not in current_refs:continue
                    attachment=target.execute('SELECT storage_locator,content_hash,byte_size FROM attachments WHERE memory_id=? AND content_hash=?',(memory,'sha256:'+digest)).fetchone()
                    valid=attachment is not None and attachment['byte_size']==size
                    if valid and verify_blobs:
                        try:
                            blob=Path(attachment['storage_locator']).resolve(strict=True)
                            if not blob.is_relative_to((root/'blobs').resolve()):valid=False
                            else:
                                h=hashlib.sha256()
                                with blob.open('rb') as stream:
                                    for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
                                valid=h.hexdigest()==digest and blob.stat().st_size==size
                        except OSError:valid=False
                    file_counts['verified_blobs' if valid else 'missing_or_corrupt_blobs']+=1
            state.close()
        file_counts['not_attempted']=len(current_refs-attempted)
        return {'ok':True,'checked_at':time.time(),'scope':'snapshot of currently persisted non-deleted supported messages; subsequent activity may still be queued','roles':counts,'missing_sample':failures,'messages_verified':all(x['missing_or_changed']==0 for x in counts.values()),'excluded_role_counts':excluded,'files':dict(file_counts),'files_verified':file_counts.get('verified_blobs',0)==len(current_refs),'private_reasoning':'not imported or inspected; thinking boundaries only','source_read_only':True}
    finally:source.close();target.close()
def main():
    request=json.load(sys.stdin);cfg=request['config']
    if cfg.get('mode')!='local':raise ValueError('History capture currently requires local Cortex.')
    database=cfg.get('historyDatabase','');operation=request.get('operation')
    if operation=='validate':
        conn,path=source_connection(database)
        try:
            expected=request.get('sessionId')
            if not expected or not conn.execute('SELECT 1 FROM sessions WHERE id=?',(expected,)).fetchone():raise ValueError('Selected database does not contain the current Cindy session.')
            print(json.dumps({'ok':True,'source_read_only':True,'database':str(path)}))
        finally:conn.close()
        return
    if not cfg.get('historyCapture') or not cfg.get('recording'):raise ValueError('Enable history capture and recording before syncing.')
    os.environ['XIBALBA_CORTEX_HOME']=cfg['home'];os.environ.pop('XIBALBA_CORTEX_ALLOW_UNSCOPED_STDIO',None);os.environ.pop('XIBALBA_AGENT_ID',None)
    if cfg.get('agentId'):os.environ['XIBALBA_AGENT_ID']=cfg['agentId']
    from xibalba_cortex import server
    from xibalba_cortex.redaction import redact
    if operation=='audit':print(json.dumps(audit(database,cfg['home'],redact)));return
    server._install_stdio_principal()
    def writer(event_id,content,source):return server.memory_ingest_connector_event(connector='cindy_history',event_id=event_id,content=content,source=source,status='candidate',evidence_class='observed_event')
    def artifact_writer(event_id,manifest,temp,source):
        memory=writer(event_id,json.dumps(redact(manifest),ensure_ascii=False,sort_keys=True),source)
        if temp and not any(x['content_hash']=='sha256:'+manifest['sha256'] for x in server.memory_list_attachments(memory['id'])):server.memory_attach(memory['id'],str(temp),manifest['media_type'])
        return memory
    if operation=='activities':
        events=request.get('events',[])
        if len(events)>20:raise ValueError('Activity batch too large.')
        for event in events:
            if set(event)-{'id','session_id','name','timestamp','block_id','request_id','agent','model','duration_ms','end_reason'}:raise ValueError('Unsupported activity metadata.')
            if event['name'] not in ('did-thinking-start','did-thinking-end','did-approval-start','did-approval-end','did-user-input-start','did-user-input-end','did-turn-start','did-turn-end'):raise ValueError('Unsupported activity event.')
            writer('activity:'+event['id'],json.dumps(event,sort_keys=True),{'kind':'cindy_activity_boundary','locator':'cindy://activity/'+event['id'],'session_id':'cindy:'+event['session_id'],'metadata':{'capture_surface':'activity_metadata','reasoning_text_available':False}})
        print(json.dumps({'ok':True,'imported':len(events)}));return
    result=synchronize(database,cfg['home'],writer,redact,limit=min(100,max(1,request.get('limit',50))),archive_files=bool(cfg.get('archiveFiles')),artifact_writer=artifact_writer)
    print(json.dumps(result))
if __name__=='__main__':
    try:main()
    except Exception as exc:
        print(json.dumps({'ok':False,'error':'History capture failed ('+type(exc).__name__+'). Check schema, profile identity, disk space and backend health. Checkpoint retained.'}));sys.exit(1)
