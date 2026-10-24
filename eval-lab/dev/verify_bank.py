import pathlib,json,tempfile,subprocess,shutil,concurrent.futures,sys
bank=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
m=json.loads((bank/'distribution.json').read_text())
if len(sys.argv)>3:m['questions']=[q for q in m['questions'] if q['key'] in sys.argv[3:]]
def check(q):
 with tempfile.TemporaryDirectory(prefix='eval-bank-check-') as tmp:
  root=pathlib.Path(tmp)/'workspace';release=bank/q['path'];shutil.copytree(release/'candidate',root)
  output=out/(q['key'].replace('@','-')+'.json')
  p=subprocess.run(['python3','-B',str(release/'author/grade.py'),str(root),str(output)],capture_output=True,text=True,timeout=920)
  (out/(q['key'].replace('@','-')+'.log')).write_text(p.stdout+'\n'+p.stderr)
  r=json.loads(output.read_text()) if output.exists() else {}
  row={'question':q['key'],'exitCode':p.returncode,'status':r.get('status'),'score':r.get('score'),'reason':r.get('reason')};print(json.dumps(row),flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as e:rows=list(e.map(check,m['questions']))
(out/'summary.json').write_text(json.dumps(rows,indent=2))
assert all(r['status']=='graded' and r['exitCode']==0 for r in rows), 'A packaged grader did not complete'
