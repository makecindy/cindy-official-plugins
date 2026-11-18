"""Build the settings-page ZIP from an explicit extension file list."""
from pathlib import Path
import json
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent / 'my-browser'
files = ['manifest.json', 'background.js', 'policy.js', 'network-guard.js', 'youtube-transcript.js', 'site-captions.js', 'brand-icon.js',
         'ui.js', 'reading-ui.js', 'learning-core.js', 'subtitle-playback.js', 'content.js', 'permissions.html', 'permissions.js', 'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png']
files += [f'icons/{name}' for name in sorted(p.name for p in (root / 'extension/icons').glob('*.png')) if f'icons/{name}' not in files]
manifest = json.loads((root / 'extension/manifest.json').read_text())
for content_script in manifest.get('content_scripts', []):
    for asset in content_script.get('js', []) + content_script.get('css', []):
        if asset not in files:
            raise ValueError(f'Missing content script asset in ZIP: {asset}')
if any(Path(name).is_absolute() or '..' in Path(name).parts for name in files):
    raise ValueError('Unsafe extension asset path')
files.append('THIRD-PARTY-LICENSES.txt')
target = root / 'downloads' / 'my-browser-chromium.zip'
target.parent.mkdir(exist_ok=True)
with ZipFile(target, 'w', compression=ZIP_DEFLATED) as archive:
    for name in files:
        entry = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        content = (root / name).read_bytes() if name == 'THIRD-PARTY-LICENSES.txt' else (root / 'extension' / name).read_bytes()
        archive.writestr(entry, content)
print(target)
