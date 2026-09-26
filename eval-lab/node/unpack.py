"""Extract only regular ZIP files into a private staging directory."""
import sys,zipfile,pathlib,stat,shutil
archive,target,budget=sys.argv[1:];target=pathlib.Path(target);budget=int(budget)
with zipfile.ZipFile(archive) as z:
    entries=z.infolist()
    if len(entries)>50000 or sum(i.file_size for i in entries)!=budget:raise ValueError('Expanded size mismatch')
    seen=set()
    for i in entries:
        p=pathlib.PurePosixPath(i.filename);mode=i.external_attr>>16
        if not i.filename or '\\' in i.filename or '\x00' in i.filename or p.is_absolute() or any(x in ('','..','.') for x in i.filename.split('/')) or i.filename in seen:raise ValueError('Unsafe archive path')
        if stat.S_IFMT(mode) not in (0,stat.S_IFREG) or i.is_dir():raise ValueError('Only regular files allowed')
        seen.add(i.filename)
    for i in entries:
        dest=target/i.filename;dest.parent.mkdir(parents=True,exist_ok=True)
        if any(p.is_symlink() for p in [dest,*dest.parents]):raise ValueError('Symlink refused')
        with z.open(i) as src,dest.open('xb') as out:shutil.copyfileobj(src,out)
        dest.chmod(0o755 if (i.external_attr>>16)&0o111 else 0o644)
