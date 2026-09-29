"""Advance extraction by bounded bytes; input archives belong to this operation."""
import errno, json, pathlib, stat, sys, time, zipfile
archive, target, budget = sys.argv[1:]
target = pathlib.Path(target)
source = output = None
try:
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        if len(entries) > 50000 or sum(i.file_size for i in entries) != int(budget):
            raise ValueError('Expanded size mismatch')
        seen = set()
        for i in entries:
            p = pathlib.PurePosixPath(i.filename)
            mode = i.external_attr >> 16
            if not i.filename or '\\' in i.filename or '\x00' in i.filename or p.is_absolute() or any(x in ('', '..', '.') for x in i.filename.split('/')) or i.filename in seen:
                raise ValueError('Unsafe archive path')
            if stat.S_IFMT(mode) not in (0, stat.S_IFREG) or i.is_dir():
                raise ValueError('Only regular files allowed')
            seen.add(i.filename)
        index = 0
        for line in sys.stdin:
            request = json.loads(line)
            allowance = min(32 * 1024 * 1024, max(1, int(request['bytes'])))
            deadline = time.monotonic() + 2
            used = 0
            while index < len(entries) and used < allowance and time.monotonic() < deadline:
                item = entries[index]
                if source is None:
                    dest = target / item.filename
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    if any(p.is_symlink() for p in [dest, *dest.parents]):
                        raise ValueError('Symlink refused')
                    source = z.open(item)
                    output = dest.open('xb')
                chunk = source.read(min(1024 * 1024, allowance - used))
                if chunk:
                    output.write(chunk)
                    used += len(chunk)
                else:
                    source.close()
                    output.close()
                    source = output = None
                    dest.chmod(0o755 if (item.external_attr >> 16) & 0o111 else 0o644)
                    index += 1
            if output is not None:
                output.flush()
            print(json.dumps({'done': index == len(entries), 'bytes': used}), flush=True)
            if index == len(entries):
                break
except Exception as error:
    # Preserve only a bounded errno name, never local archive/member paths.
    code = errno.errorcode.get(error.errno, 'PACKAGE_INVALID') if isinstance(error, OSError) else 'PACKAGE_INVALID'
    print(json.dumps({'error': 'Extraction failed', 'code': code}), flush=True)
    sys.exit(1)
finally:
    if source is not None:
        source.close()
    if output is not None:
        output.close()
