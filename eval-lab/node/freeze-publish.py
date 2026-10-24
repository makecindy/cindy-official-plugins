"""Publish one frozen question under an OS lock held by this writer itself."""
import json, os, pathlib, sys, tempfile
bank = pathlib.Path(sys.argv[1])
entry = json.loads(pathlib.Path(sys.argv[2]).read_text())
limit = int(sys.argv[3])
manifest_path = bank / 'distribution.json'
lock_path = bank / 'publication.guard'
if lock_path.is_symlink() or manifest_path.is_symlink():
    raise ValueError('Symlink refused')
with lock_path.open('a+b') as lock:
    if os.name == 'nt':
        import msvcrt
        if os.fstat(lock.fileno()).st_size == 0:
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    if manifest_path.exists():
        with manifest_path.open('rb') as source:
            raw = source.read(limit + 1)
        if len(raw) > limit:
            sys.exit(65)
        manifest = json.loads(raw.decode('utf-8'))
        if manifest.get('format') != 'eval-lab-bank-v1' or not isinstance(manifest.get('questions'), list):
            raise ValueError('Invalid manifest')
    else:
        manifest = {'format': 'eval-lab-bank-v1', 'questions': []}
    matches = [q for q in manifest['questions'] if q.get('key') == entry['key']]
    if matches:
        if len(matches) != 1 or matches[0] != entry:
            raise ValueError('Frozen version conflict')
    else:
        manifest['questions'].append(entry)
        encoded = json.dumps(manifest, ensure_ascii=False).encode('utf-8')
        if len(encoded) > limit:
            sys.exit(65)
        fd, temporary = tempfile.mkstemp(prefix='distribution-', suffix='.tmp', dir=bank)
        try:
            with os.fdopen(fd, 'wb') as out:
                out.write(encoded)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, manifest_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
print(json.dumps({'ok': True}))
