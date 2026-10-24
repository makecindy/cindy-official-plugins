from pathlib import Path
r=Path(__file__).resolve().parent.parent
s=(r/'main-view.html').read_text().replace('<link rel="stylesheet" href="view.css">','<style>'+(r/'view.css').read_text()+'</style>')
s=s.replace('<body>','<body><p style="padding:12px 20px;background:var(--hover);font:12px system-ui">本地界面预览 · 模型、账号、题库及成绩为示例。不会调用模型；下载、出题、导出只演示交互。</p>')
s=s.replace('<script src="i18n.js"></script>','<script>'+(r/'dev/preview-fixture.js').read_text()+'</script><script>'+(r/'i18n.js').read_text()+'</script>')
s=s.replace('<script src="view.js"></script>','<script>'+(r/'view.js').read_text()+'</script>')
p=r.parent/'eval-lab-local-preview.html';p.write_text(s);print(p)
