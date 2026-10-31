"""Snapshot explicit attachments and eligible task artifact references; never crawl folders."""
import errno,hashlib,json,mimetypes,os,re,stat,tempfile,time
from pathlib import Path
from urllib.parse import unquote,urlsplit
MAX_BYTES=50*1024*1024
MAX_FILES=64
def references(record):
    content=record.get('content');out=[]
    if record['role']=='user' and isinstance(content,dict):
        for key in ('files','images'):
            for item in content.get(key,[]) or []:
                ref=item if isinstance(item,str) else next((item[k] for k in ('path','filePath','url','src') if isinstance(item.get(k),str)),None) if isinstance(item,dict) else None
                if ref:out.append((ref,'attachment'))
    if record['role']=='assistant' and isinstance(content,str):
        for ref in re.findall(r'\]\(<?((?:/|file://|cindy-media://)[^\n)]*?)>?\)',content):out.append((ref,'artifact_reference'))
    if record['role']=='tool_result' and isinstance(content,dict):
        def visit(v,depth=0):
            if depth>5:return
            if isinstance(v,dict):
                for k,x in v.items():
                    if k in ('cindyPath','output_path','artifact_path','saved_path') and isinstance(x,str):out.append((x,'artifact_reference'))
                    elif isinstance(x,(dict,list)):visit(x,depth+1)
            elif isinstance(v,list):
                for x in v[:MAX_FILES]:visit(x,depth+1)
        visit(content)
    return list(dict.fromkeys(out))
def eligible_path(reference,kind,record,database):
    ref=reference.strip();parsed=urlsplit(ref)
    if parsed.scheme=='cindy-media':
        match=re.fullmatch(r'/([0-9a-f]{64})(\.[a-zA-Z0-9]+)',parsed.path)
        if parsed.netloc!='blobs' or not match:return None,'unsupported_reference'
        digest,ext=match.groups();candidate=Path(database).parent/'cindy-media'/'blobs'/digest[:2]/(digest+ext)
    else:
        if parsed.scheme not in ('','file') or parsed.netloc not in ('','localhost'):return None,'unsupported_reference'
        if parsed.query or parsed.fragment:return None,'unsupported_reference'
        raw=unquote(parsed.path) if parsed.scheme else ref
        raw=re.sub(r':\d+(?::\d+)?$','',raw)
        candidate=Path(raw).expanduser()
        if not candidate.is_absolute():return None,'relative_reference'
        if kind!='attachment':
            if record.get('remote_host_id') or record.get('workspace_kind') not in (None,'local','dialogue'):return None,'remote_reference'
            roots=[Path.home()/d for d in ('Projects','Pictures','Documents','Desktop')]
            if record.get('working_dir'):roots.append(Path(record['working_dir']))
            absolute=Path(os.path.abspath(candidate))
            if not any(absolute==r or r in absolute.parents for r in roots if r.is_absolute()):return None,'outside_artifact_roots'
    candidate=Path(os.path.abspath(candidate))
    if any(x.is_symlink() for x in (candidate,*candidate.parents)):return None,'symlink_reference'
    if candidate.name in ('.env','id_rsa','id_ed25519','credentials','credentials.json') or candidate.suffix in ('.pem','.key') or any(x in candidate.parts for x in ('.ssh','.aws','safe-storage','safeStorage')):return None,'credential_path'
    return candidate,None
class SnapshotDeferred(Exception):
    """The cooperative sweep budget expired; keep the file checkpoint for resumption."""

def check_budget(deadline):
    if deadline is not None and time.monotonic() >= deadline:raise SnapshotDeferred()

def open_no_symlinks(candidate):
    """Resolve every component relative to a held directory FD, never a checked path."""
    directory_flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
    directory=os.open(candidate.anchor,directory_flags)
    try:
        for component in candidate.parts[1:-1]:
            following=os.open(component,directory_flags,dir_fd=directory)
            os.close(directory);directory=following
        return os.open(candidate.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
    finally:os.close(directory)

def source_stat(info):
    return [info.st_dev,info.st_ino,info.st_mode,info.st_size,info.st_mtime_ns,info.st_ctime_ns]

def snapshot(reference,kind,record,database,folder,consumer,max_bytes=MAX_BYTES,previous=None,deadline=None):
    check_budget(deadline)
    candidate,reason=eligible_path(reference,kind,record,database)
    manifest={'reference':reference,'reference_kind':kind,'status':reason or 'pending','snapshot_semantics':'bytes available at capture time; not proof of original creation bytes'}
    temp=None
    try:
        if candidate:
            try:
                fd=open_no_symlinks(candidate)
                with os.fdopen(fd,'rb') as src:
                    before=os.fstat(src.fileno())
                    if not stat.S_ISREG(before.st_mode):manifest['status']='not_regular_file'
                    elif before.st_size>max_bytes:manifest.update(status='size_limit',byte_size=before.st_size,max_bytes=max_bytes)
                    elif previous and previous[0].get('source_stat')==source_stat(before):
                        # The secure FD walk still runs on every sweep. The existing snapshot
                        # remains independently hash-verifiable even when its source disappears.
                        return previous[0],{**previous[1],'reused':True}
                    else:
                        sha=hashlib.sha256();size=0
                        with tempfile.NamedTemporaryFile(dir=folder,prefix='snapshot-',delete=False) as out:
                            temp=Path(out.name);os.chmod(temp,0o600)
                            while True:
                                check_budget(deadline)
                                chunk=src.read(1024*1024)
                                if not chunk:break
                                size+=len(chunk)
                                if size>max_bytes:break
                                sha.update(chunk);out.write(chunk)
                        after=os.fstat(src.fileno())
                        if size>max_bytes:manifest.update(status='size_limit',byte_size=size,max_bytes=max_bytes)
                        elif source_stat(before)!=source_stat(after):manifest['status']='changed_during_read'
                        else:manifest.update(status='archived',byte_size=size,sha256=sha.hexdigest(),source_stat=source_stat(before),media_type=mimetypes.guess_type(str(candidate))[0] or 'application/octet-stream')
            except FileNotFoundError:manifest['status']='missing'
            except PermissionError:manifest['status']='permission_denied'
            except OSError as exc:manifest['status']='symlink_reference' if exc.errno in (errno.ELOOP,errno.ENOTDIR) else 'file_read_failed'
        check_budget(deadline)
        identity=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        result=consumer(identity,manifest,temp if manifest['status']=='archived' else None)
        return manifest,result
    finally:
        if temp:temp.unlink(missing_ok=True)
