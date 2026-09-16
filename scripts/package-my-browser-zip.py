"""Build the settings-page ZIP from an explicit first-party extension file list."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent / 'my-browser'
files = ['manifest.json', 'background.js', 'policy.js', 'popup.html', 'popup.js',
         'popup.css', 'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png']
target = root / 'downloads' / 'my-browser-chromium.zip'
target.parent.mkdir(exist_ok=True)
with ZipFile(target, 'w', compression=ZIP_DEFLATED) as archive:
    for name in files:
        entry = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, (root / 'extension' / name).read_bytes())
print(target)
