import importlib.util,json,sqlite3,tempfile,unittest,sys
sys.path.insert(0,str(__import__("pathlib").Path(__file__).resolve().parents[1]/"node"))
from pathlib import Path
spec=importlib.util.spec_from_file_location('capture',Path(__file__).resolve().parents[1]/'node/capture.py');capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)
class CaptureTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.home=self.root/'profile';self.home.mkdir();self.db=self.root/'history.db'
  c=sqlite3.connect(self.db);c.executescript('CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,working_dir TEXT,agent_kind TEXT,status TEXT,parent_session_id TEXT,orca_role TEXT,source TEXT);CREATE TABLE messages(id TEXT PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,created_at INTEGER,tool_use_id TEXT,rewind_at INTEGER);');c.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)',('s','Title','/tmp/project','codex','active','parent','tester','desktop'));c.commit();c.close();self.writes={}
 def tearDown(self):self.tmp.cleanup()
 def add(self,mid,role='user',text='hello'):
  c=sqlite3.connect(self.db);c.execute('INSERT INTO messages VALUES (?,?,?,?,?,?,?)',(mid,'s',role,json.dumps(text),1,'tool-1',None));c.commit();c.close()
 def writer(self,event,content,source):self.writes[event]=(content,source)
 def sync(self,writer=None,**kw):return capture.synchronize(self.db,self.home,writer or self.writer,**kw)
 def test_full_roles_unicode_chunks_background_and_replay(self):
  for i,role in enumerate(capture.ROLES):self.add(str(i),role,'café Δ '*5000 if role=='tool_result' else role)
  self.add('hidden','thinking','excluded')
  r=self.sync();self.assertEqual(r['imported'],6);self.assertTrue(r['scan_complete']);self.assertTrue(all(x[1]['metadata']['background_session'] for x in self.writes.values()))
  payload=[x for x in self.writes.values() if x[1]['message_id']=='3'];payload.sort(key=lambda x:x[1]['metadata']['part_index']);self.assertEqual(json.loads(''.join(json.loads(x[0])['fragment'] for x in payload))['content'],'café Δ '*5000)
  count=len(self.writes);self.assertEqual(self.sync()['imported'],0);self.assertEqual(len(self.writes),count)
 def test_failure_mid_record_replays_same_event_ids_without_advancing(self):
  self.add('one',text='a'*50000);calls=[]
  def fail(event,content,source):
   calls.append(event)
   if len(calls)==2:raise RuntimeError('offline')
   self.writer(event,content,source)
  with self.assertRaises(RuntimeError):self.sync(fail)
  self.assertEqual(self.sync()['imported'],1);self.assertEqual(len(self.writes),3);self.assertIn(calls[0],self.writes)
 def test_updates_and_late_timestamps_are_seen_on_rescan(self):
  self.add('one');self.sync();c=sqlite3.connect(self.db);c.execute('UPDATE messages SET content=? WHERE id=?',(json.dumps('edited'),'one'));c.commit();c.close();self.add('late','assistant','new');self.assertEqual(self.sync()['imported'],2)
 def test_source_read_only_and_schema_fail_closed(self):
  c,_=capture.source_connection(self.db)
  with self.assertRaises(sqlite3.OperationalError):c.execute('DELETE FROM messages')
  c.close();bad=self.root/'bad.db';sqlite3.connect(bad).close()
  with self.assertRaisesRegex(ValueError,'Unsupported'):capture.source_connection(bad)
 def test_redaction_applied_before_archive(self):
  self.add('one',text='token-sensitive');self.sync(redactor=lambda s:s.replace('token-sensitive','[redacted]'));self.assertNotIn('token-sensitive',str(self.writes));self.assertIn('[redacted]',str(self.writes))
 def test_limit_checkpoint_survives_new_run(self):
  for i in range(4):self.add(str(i))
  self.assertEqual(self.sync(limit=2)['imported'],2);self.assertEqual(self.sync(limit=2)['imported'],2);self.assertTrue(self.sync(limit=2)['scan_complete']);self.assertEqual(self.sync()['imported'],0)

class FileAndFidelityTests(unittest.TestCase):
 setUp=CaptureTests.setUp
 tearDown=CaptureTests.tearDown
 add=CaptureTests.add
 writer=CaptureTests.writer
 sync=CaptureTests.sync
 def test_chunk_wrappers_preserve_whitespace_even_when_store_trims(self):
  text='leading '+'x'*23900+' '*400+' café Δ '+(' '*30+'tail')*1000+' trailing '
  self.add('spaces',text=text)
  def trimmed(event,content,source):self.writes[event]=(content.strip(),source)
  self.sync(trimmed)
  parts=sorted(self.writes.values(),key=lambda x:x[1]['metadata']['part_index'])
  restored=json.loads(''.join(json.loads(x[0])['fragment'] for x in parts))
  self.assertEqual(restored['content'],text)
 def test_explicit_attachment_snapshots_survive_deletion_and_report_missing(self):
  file=self.root/'document.bin';data=bytes(range(256))*100;file.write_bytes(data)
  self.add('file',text={'text':'Attached','files':[{'path':str(file),'name':file.name}]})
  snapshots={};statuses=[]
  def archive(event,manifest,temp,source):
   statuses.append(manifest['status'])
   if temp:snapshots[event]=temp.read_bytes()
   return {'id':'manifest-id'}
  result=self.sync(archive_files=True,artifact_writer=archive)
  self.assertEqual(result['files_this_sweep']['archived'],1);self.assertEqual(list(snapshots.values()),[data]);file.unlink()
  result=self.sync(archive_files=True,artifact_writer=archive);self.assertEqual(result['files_this_sweep']['missing'],1);self.assertEqual(list(snapshots.values()),[data])
 def test_generated_references_are_bounded_to_task_roots_and_symlinks_are_rejected(self):
  from capture_files import eligible_path
  record={'working_dir':str(self.root),'workspace_kind':'local'}
  file=self.root/'artifact.txt';file.write_text('artifact');link=self.root/'link';link.symlink_to(file)
  self.assertEqual(eligible_path(str(file),'artifact_reference',record,self.db)[1],None)
  self.assertEqual(eligible_path(str(file),'artifact_reference',{**record,'workspace_kind':'dialogue'},self.db)[1],None)
  self.assertEqual(eligible_path(str(link),'attachment',record,self.db)[1],'symlink_reference')
  self.assertEqual(eligible_path('/etc/passwd','artifact_reference',record,self.db)[1],'outside_artifact_roots')
  self.assertEqual(eligible_path(str(file),'artifact_reference',{**record,'remote_host_id':'remote'},self.db)[1],'remote_reference')
 def test_size_limits_and_unsupported_references_have_manifests(self):
  from capture_files import snapshot
  file=self.root/'large.bin';file.write_bytes(b'x'*10);seen=[]
  def writer(event,manifest,temp):seen.append(manifest);self.assertIsNone(temp)
  snapshot(str(file),'attachment',{},self.db,self.home,writer,max_bytes=4)
  snapshot('https://example.com/file','attachment',{},self.db,self.home,writer)
  self.assertEqual([x['status'] for x in seen],['size_limit','unsupported_reference'])
 def test_tool_arguments_results_and_attachment_descriptors_roundtrip(self):
  objects={'tool_use':{'toolUseId':'call-1','toolName':'exec','input':{'cmd':'echo café','args':['x','y']}},'tool_result':{'ok':True,'result':{'stdout':' Δ\\n done '}}}
  for role,value in objects.items():self.add(role,role,value)
  self.sync()
  for role,value in objects.items():
   parts=[x for x in self.writes.values() if x[1]['message_id']==role];parts.sort(key=lambda x:x[1]['metadata']['part_index'])
   self.assertEqual(json.loads(''.join(json.loads(x[0])['fragment'] for x in parts))['content'],value)

 def test_audit_understands_cortex_nested_source_metadata(self):
  self.add('audit')
  src,path=capture.source_connection(self.db);row=src.execute(capture.rows_query(src),capture.ROLES).fetchone();record=capture.envelope(row);src.close()
  import hashlib
  metadata={'metadata':{'source_database_sha256':hashlib.sha256(str(path).encode()).hexdigest(),'source_revision_sha256':capture.revision(record),'part_index':0}}
  target=sqlite3.connect(self.home/'graph-memory.sqlite3');target.executescript('CREATE TABLE sources(id TEXT,kind TEXT,message_id TEXT,metadata_json TEXT);CREATE TABLE memories(source_id TEXT,content TEXT,status TEXT);')
  target.execute('INSERT INTO sources VALUES (?,?,?,?)',('s','cindy_history_message','audit',json.dumps(metadata)));target.execute('INSERT INTO memories VALUES (?,?,?)',('s',capture.fragment(capture.serialize(record)),'candidate'));target.commit();target.close()
  report=capture.audit(self.db,self.home);self.assertTrue(report['messages_verified']);self.assertEqual(report['roles']['user']['verified'],1)

if __name__=='__main__':unittest.main()
