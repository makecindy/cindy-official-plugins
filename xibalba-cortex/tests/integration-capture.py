
"""Real Cortex verification against a disposable source and destination, never the active store."""
import hashlib,json,os,sqlite3,subprocess,sys,tempfile
from pathlib import Path
PLUGIN=Path(__file__).resolve().parents[1]
def main():
 with tempfile.TemporaryDirectory(prefix='cortex-full-capture-') as temp:
  root=Path(temp);home=root/'profile';home.mkdir();db=root/'history.db';artifact=root/'artifact.bin';payload=bytes(range(256))*100;artifact.write_bytes(payload)
  c=sqlite3.connect(db)
  c.executescript('CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,working_dir TEXT,agent_kind TEXT,status TEXT,parent_session_id TEXT,orca_role TEXT,source TEXT);CREATE TABLE messages(id TEXT PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,created_at INTEGER,tool_use_id TEXT,rewind_at INTEGER);')
  c.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)',('session-test','Canary',str(root),'codex','active','parent','worker','desktop'))
  text='a'*23900+' '*500+'café Δ'+' '*300+'tail '
  rows=[('u','user',{'text':text,'files':[{'name':'artifact.bin','path':str(artifact)}]}),('a','assistant','Saved [artifact]('+str(artifact)+').'),('call','tool_use',{'toolUseId':'call-1','toolName':'canary','input':{'arg':'Δ','values':[1,2,3]}}),('result','tool_result',{'ok':True,'stdout':' tool output  '}),('q','ask_user',{'question':'Choose a canary'}),('plan','plan_review',{'steps':['capture','verify']}),('private','thinking','PRIVATE_REASONING_NOT_ARCHIVED')]
  for mid,role,content in rows:c.execute('INSERT INTO messages VALUES (?,?,?,?,?,?,?)',(mid,'session-test',role,json.dumps(content,ensure_ascii=False),1,'call-1',None))
  c.commit();c.close();before=hashlib.sha256(db.read_bytes()).hexdigest()
  cfg={'mode':'local','home':str(home),'agentId':'did:key:zCindyIntegrationCanary','historyDatabase':str(db),'historyCapture':True,'recording':True,'archiveFiles':True}
  def run(op,**extra):
   done=subprocess.run([sys.executable,str(PLUGIN/'node/capture.py')],input=json.dumps({'config':cfg,'operation':op,**extra}),text=True,capture_output=True,timeout=80)
   if done.returncode:raise AssertionError('Capture failed: '+done.stdout[:500])
   result=json.loads(done.stdout);assert result['ok'];return result
  first=run('sync');assert first['imported']==6;assert first['files_this_sweep']=={'archived':2}
  second=run('sync');assert second['imported']==0
  audit=run('audit');assert audit['messages_verified'] and audit['files_verified'];assert audit['files']['verified_blobs']==2
  target=sqlite3.connect(home/'graph-memory.sqlite3');target.row_factory=sqlite3.Row
  assert target.execute('SELECT count(*) FROM attachments').fetchone()[0]==2
  assert target.execute("SELECT count(*) FROM memories WHERE content LIKE '%PRIVATE_REASONING_NOT_ARCHIVED%'").fetchone()[0]==0
  parts=[]
  for row in target.execute("SELECT m.content,s.metadata_json FROM memories m JOIN sources s ON s.id=m.source_id WHERE s.kind='cindy_history_message' AND s.message_id='u'"):
   meta=json.loads(row['metadata_json']);meta=meta.get('metadata',meta);parts.append((meta['part_index'],json.loads(row['content'])['fragment']))
  restored=json.loads(''.join(v for i,v in sorted(parts)));assert restored['content']['text']==text
  attachment=target.execute('SELECT storage_locator FROM attachments LIMIT 1').fetchone();blob=Path(attachment['storage_locator']);assert blob.read_bytes()==payload
  artifact.unlink();assert blob.read_bytes()==payload
  missing=run('sync');assert missing['files_this_sweep']['missing']==2;assert run('audit')['files_verified']
  blob.write_bytes(b'corrupt');corrupt=run('audit');assert not corrupt['files_verified'] and corrupt['files']['missing_or_corrupt_blobs']==2;blob.write_bytes(payload)
  readonly_verified=before==hashlib.sha256(db.read_bytes()).hexdigest();assert readonly_verified
  c=sqlite3.connect(db);c.execute('UPDATE messages SET content=? WHERE id=?',(json.dumps({'ok':True,'stdout':'edited'}),'result'));c.commit();c.close()
  changed=run('audit');assert changed['roles']['tool_result']['missing_or_changed']==1
  artifact.write_bytes(payload);run('sync');assert run('audit')['messages_verified']
  event={'id':'thinking-canary','session_id':'session-test','name':'did-thinking-start','timestamp':'2026-10-25T00:00:00Z','block_id':'opaque-block'}
  run('activities',events=[event]);run('activities',events=[event]);assert target.execute("SELECT count(*) FROM memories m JOIN sources s ON s.id=m.source_id WHERE s.kind='cindy_activity_boundary'").fetchone()[0]==1
  print(json.dumps({'passed':True,'source_readonly_during_initial_capture':readonly_verified,'exact_whitespace_unicode_roundtrip':True,'all_six_roles_verified':True,'artifact_snapshots':2,'survives_original_deletion':True,'duplicate_attachment_prevention':True,'blob_corruption_detected':True,'changed_message_detected':True,'activity_metadata_idempotent':True,'private_reasoning_excluded':True},indent=2))
if __name__=='__main__':main()
