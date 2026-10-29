import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('Build this native helper on macOS.');
const root = fileURLToPath(new URL('..', import.meta.url));
const build = resolve(root, 'build');
const app = resolve(root, 'native/Cindy Ping.app');
const manifest = JSON.parse(readFileSync(resolve(root, 'ghost.json'), 'utf8'));
mkdirSync(build, { recursive: true });
mkdirSync(resolve(app, 'Contents/MacOS'), { recursive: true });
writeFileSync(resolve(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>app.cindy-ping.helper</string>
<key>CFBundleName</key><string>Cindy Ping</string>
<key>CFBundleExecutable</key><string>Cindy Ping</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${manifest.version}</string>
<key>CFBundleVersion</key><string>10</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSScreenCaptureUsageDescription</key><string>Capture the original window when you send a configured emote, before delivery or per-use input.</string>
</dict></plist>\n`);
for (const arch of ['arm64', 'x86_64']) {
  execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-O', '-target', `${arch}-apple-macosx14.0`,
    '-module-cache-path', resolve(build, 'module-cache'),
    resolve(root, 'native/EmoteHelper.swift'), '-o', resolve(build, `helper-${arch}`),
    '-framework', 'AppKit', '-framework', 'Carbon', '-framework', 'ApplicationServices',
    '-framework', 'ScreenCaptureKit'], { stdio: 'inherit' });
}
execFileSync('lipo', ['-create', resolve(build, 'helper-arm64'), resolve(build, 'helper-x86_64'),
  '-output', resolve(app, 'Contents/MacOS/Cindy Ping')], { stdio: 'inherit' });
execFileSync('codesign', ['--force', '--sign', '-', app], { stdio: 'inherit' });
console.log('Built macOS 14+ universal helper (arm64 / x86_64).');
