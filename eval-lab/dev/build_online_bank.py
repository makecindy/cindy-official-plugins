from pathlib import Path
import json,hashlib,zipfile,sys
bank,out,base=Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3].rstrip('/')
out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((bank/'distribution.json').read_text())
artifacts={}
def package(entries):
    signature=[(rel,hashlib.sha256(p.read_bytes()).hexdigest(),p.stat().st_mode & 0o777) for rel,p in entries]
    name=hashlib.sha256(json.dumps(signature,separators=(',',':')).encode()).hexdigest()+'.zip'
    dest=out/name
    if not dest.exists():
        with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for rel,p in entries:z.write(p,rel)
    digest=hashlib.sha256(dest.read_bytes()).hexdigest()
    artifacts[name]={'url':base+'/'+name,'sha256':digest,'bytes':dest.stat().st_size,'expandedBytes':sum(p.stat().st_size for _,p in entries)}
    return name
rows=[]
for q in manifest['questions']:
    root=bank/q['path']; groups={}; payload=[]
    for rel in q['files']:
        p=root/rel
        if not p.is_file() or p.is_symlink():raise ValueError(rel)
        if hashlib.sha256(p.read_bytes()).hexdigest()!=q['files'][rel]:raise ValueError('Changed '+rel)
        parts=rel.split('/')
        if 'runtime' in parts:
            i=parts.index('runtime'); mount='/'.join(parts[:i+1]); groups.setdefault(mount,[]).append(('/'.join(parts[i+1:]),p))
        else:payload.append((rel,p))
    layers=[{'artifact':package(payload),'mount':''}]
    for mount,entries in groups.items():layers.append({'artifact':package(entries),'mount':mount})
    rows.append({**q,'layers':layers})
index={'format':'eval-lab-online-v1','platform':manifest['platform'],'suite':manifest['suite'],'questions':rows,'artifacts':artifacts}
(out/'index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps({'questions':len(rows),'archives':len(artifacts),'bytes':sum(a['bytes'] for a in artifacts.values()),'index':str(out/'index.json')}))
