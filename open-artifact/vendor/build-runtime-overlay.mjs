import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const upstreamCommit = '132c038529e4527d1bc30561a855ffd958aa7302';
const checkout = process.argv[2];
if (!checkout) throw new Error('Pass the patched Open Artifact source checkout.');
const source = resolve(checkout);
const patch = await readFile(new URL('./runtime-workspace.patch', import.meta.url), 'utf8');
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' });
if (git('rev-parse', 'HEAD').trim() !== upstreamCommit || git('diff', '--no-ext-diff', '--binary', '--unified=0', 'HEAD', '--') !== patch) {
  throw new Error('Use the pinned upstream checkout with only runtime-workspace.patch applied to the index.');
}

const { build } = createRequire(join(source, 'package.json'))('esbuild');
const inventoryFile = new URL('./runtime-integrity.json', import.meta.url);
const inventory = JSON.parse(await readFile(inventoryFile, 'utf8'));
const targets = [
  {
    entry: 'packages/daemon/src/bin/open-artifact.ts',
    output: 'vendor/open-artifact.mjs',
    extra: {
      charset: 'utf8',
      banner: { js: "import { createRequire as __openArtifactCreateRequire } from 'node:module'; const require = __openArtifactCreateRequire(import.meta.url);" },
    },
  },
  { entry: 'packages/server-sdk/bin/frame-host.ts', output: 'vendor/frame-host/frame-host.mjs' },
  { entry: 'packages/type-server/src/cli.ts', output: 'vendor/type-server/cli.mjs' },
];

for (const { entry, output, extra } of targets) {
  if (!Object.hasOwn(inventory, output)) throw new Error(`Missing upstream inventory entry for ${output}`);
  const bundle = await build({
    absWorkingDir: source, entryPoints: [entry], outfile: output, bundle: true, write: false,
    platform: 'node', format: 'esm', target: 'node22', legalComments: 'none', ...extra,
  });
  if (bundle.outputFiles.length !== 1) throw new Error(`Expected one bundle for ${output}`);
  const bytes = bundle.outputFiles[0].contents;
  const location = new URL(`./runtime-overlay/${output}.gz`, import.meta.url);
  await mkdir(new URL('./', location), { recursive: true });
  await writeFile(location, gzipSync(bytes, { level: 9 }));
  inventory[output] = createHash('sha256').update(bytes).digest('hex');
}

await writeFile(inventoryFile, JSON.stringify(inventory, null, 2) + '\n');
