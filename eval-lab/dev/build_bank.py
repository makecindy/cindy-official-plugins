"""Build an offline runtime pack, preserving original release provenance."""
import pathlib,json,hashlib,shutil,sys
src=pathlib.Path(sys.argv[1]);dst=pathlib.Path(sys.argv[2]);dst.mkdir(parents=True,exist_ok=False)
extra={
'audio':'runner.py verify.py behavior.py compositions.py adapter.mjs environment.json long-scenes.json',
'island':'run.mjs mapping.json',
'recovery':'run.cjs scenarios.cjs mapping.json',
'composer':'legacy_grade.py common.py scoring.py acceptance.json case.cjs hydration-case.cjs browser-case.cjs visible-send-case.cjs pending-behavior.cjs recovery-case.cjs isolation-case.cjs composition-case.cjs',
'mobile-stream-order':'run.mjs acceptance.mjs',
'remote-files-bughunt':'checks.mjs legacy-checks.mjs',
 'task-switch-cache':'scenarios.mjs legacy-scenarios.mjs capability-map.json'}
suite=json.loads((src/'suites/seven-question-quality-v2.json').read_text());rows=[]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for q in suite['questions']:
 rel=pathlib.Path('questions')/q['id']/q['revision'];s=src/rel;d=dst/rel;d.mkdir(parents=True)
 assert digest(s/'manifest.json')==q['manifestSha256']
 shutil.copytree(s/'candidate',d/'candidate');shutil.copy2(s/'question.json',d/'question.json')
 shutil.copy2(s/'manifest.json',d/'source-manifest.json');(d/'author').mkdir()
 for f in ('grade.py grade_impl.py editable.json '+extra[q['id']]).split():shutil.copy2(s/'author'/f,d/'author'/f)
 if q['id'] in ('remote-files-bughunt','task-switch-cache'):
  shutil.copytree(s/'reference/runtime',d/'reference/runtime');shutil.copy2(s/'reference/package.json',d/'reference/package.json')
 if q['id']=='audio':shutil.copytree(s/'author/public',d/'author/public')
 if q['id']=='task-switch-cache':shutil.copytree(s/'reference/src',d/'reference/src')
 scope=next(x for x in (d/'candidate/TASK.md').read_text().splitlines() if x.startswith('允许修改的源码范围'))
 prompt='请独立检查这个项目，依据产品约定发现并修复可证实的问题，运行验证，并在 BUGS_FOUND.md 记录问题、证据和结果。\n\n先读 CONTRACT.md、ENVIRONMENT.md；不存在时读 README.md 和 documentation/。\n\n'+scope+'可新增测试，不修改已有测试、运行环境和题面。仅使用本工作目录材料，不访问其他答案或委派。\n'
 overlays={}
 for n in ['TASK.md','PROMPT.md']:
  f=d/'candidate'/n;old=digest(f);f.write_text(prompt);overlays[n]={'originalSha256':old,'sha256':digest(f)}
 spec=json.loads((d/'question.json').read_text());hashes={p.relative_to(d).as_posix():digest(p) for p in sorted(d.rglob('*')) if p.is_file()}
 rows.append(dict(key=q['id']+'@'+q['revision'],title=spec['title'],revision=q['revision'],environment=spec['environment'],path=rel.as_posix(),sourceManifestSha256=q['manifestSha256'],files=hashes,promptOverlay={'policy':'concise-no-time-limit-v1','files':overlays}))
 print(q['id'],len(hashes),flush=True)
(dst/'distribution.json').write_text(json.dumps(dict(format='eval-lab-bank-v1',suite=suite['id'],platform='darwin-arm64',questions=rows),ensure_ascii=False,indent=2)+'\n')
(dst/'README.txt').write_text('评测工坊离线题包。保留原题候选源码和可信评分运行闭包，不含历史作答或原始聊天。macOS Apple Silicon；评分需要 python3。解压后在插件选择此目录。题目沿用独立运行环境，不支持 Windows/Linux。来源清单与分发清单分开记录；此包不冒充原始完整归档。评分会执行候选代码，应仅运行自己信任的题目和作答。\n')
