import json,os,sqlite3,unittest
from unittest.mock import patch
import test_history_capture as fixtures
import capture
import capture_files

class ReviewFileTests(unittest.TestCase):
 setUp=fixtures.CaptureTests.setUp
 tearDown=fixtures.CaptureTests.tearDown
 add=fixtures.CaptureTests.add
 writer=fixtures.CaptureTests.writer
 sync=fixtures.CaptureTests.sync
 def test_parent_directory_swap_never_captures_outside_bytes(self):
  parent=self.root/'inside';parent.mkdir();file=parent/'file.txt';file.write_bytes(b'allowed')
  outside=self.root/'outside';outside.mkdir();(outside/'file.txt').write_bytes(b'private outside bytes')
  real_open=os.open;swapped=False;captured=[]
  def race(path,flags,*args,**kwargs):
   nonlocal swapped
   if not swapped and (str(path)==str(file) or (str(path)=='inside' and 'dir_fd' in kwargs)):
    swapped=True;parent.rename(self.root/'old-inside');parent.symlink_to(outside,target_is_directory=True)
   return real_open(path,flags,*args,**kwargs)
  def consume(identity,manifest,temp):
   if temp:captured.append(temp.read_bytes())
  with patch.object(capture_files.os,'open',side_effect=race):
   capture_files.snapshot(str(file),'artifact_reference',{'working_dir':str(parent)},self.db,self.home,consume)
  self.assertTrue(swapped);self.assertNotIn(b'private outside bytes',captured)
 def test_archived_attachment_remains_auditable_after_original_is_deleted(self):
  file=self.root/'file.bin';file.write_bytes(b'archived bytes');self.add('file',text={'files':[str(file)]})
  target=sqlite3.connect(self.home/'graph-memory.sqlite3');target.executescript('CREATE TABLE sources(id TEXT,kind TEXT,message_id TEXT,metadata_json TEXT);CREATE TABLE memories(source_id TEXT,content TEXT,status TEXT);CREATE TABLE attachments(memory_id TEXT,storage_locator TEXT,content_hash TEXT,byte_size INTEGER);');target.commit();target.close()
  def archive(event,manifest,temp,source):
   if temp:
    blob=self.home/'blobs'/manifest['sha256'];blob.parent.mkdir(exist_ok=True);blob.write_bytes(temp.read_bytes())
    c=sqlite3.connect(self.home/'graph-memory.sqlite3');c.execute('INSERT INTO attachments VALUES (?,?,?,?)',('saved',str(blob),'sha256:'+manifest['sha256'],manifest['byte_size']));c.commit();c.close()
   return {'id':'saved' if temp else 'missing'}
  self.sync(archive_files=True,artifact_writer=archive);file.unlink();self.sync(archive_files=True,artifact_writer=archive)
  report=capture.audit(self.db,self.home);self.assertTrue(report['files_verified']);self.assertEqual(report['files']['verified_blobs'],1)
 def test_unchanged_successful_files_are_not_copied_again(self):
  file=self.root/'file.bin';file.write_bytes(b'unchanged');self.add('file',text={'files':[str(file)]});calls=[]
  def archive(event,manifest,temp,source):calls.append(event);return {'id':'saved'}
  self.sync(archive_files=True,artifact_writer=archive);self.sync(archive_files=True,artifact_writer=archive);self.assertEqual(len(calls),1)
 def test_deadline_between_files_checkpoints_progress_inside_message(self):
  files=[self.root/f'file-{i}.bin' for i in range(3)]
  for file in files:file.write_bytes(b'data')
  self.add('files',text={'files':[str(f) for f in files]});clock=[0];archived=[]
  def archive(event,manifest,temp,source):archived.append(manifest['reference']);clock[0]+=2;return {'id':'saved-'+str(len(archived))}
  with patch.object(capture.time,'monotonic',side_effect=lambda:clock[0]):first=self.sync(archive_files=True,artifact_writer=archive,deadline=1)
  self.assertFalse(first['scan_complete']);self.assertEqual(len(archived),1)
  self.sync(archive_files=True,artifact_writer=archive);self.assertEqual(archived,[str(f) for f in files])

if __name__=='__main__':unittest.main()
