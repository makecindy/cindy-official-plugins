// Repository-owned data encoding only; never load or execute the input.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Expected input and output paths');
if (statSync(source).size > 256 * 1024 * 1024) throw new Error('Input exceeds 256 MiB');
const input = readFileSync(source);
writeFileSync(destination, brotliCompressSync(input, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}), { flag: 'wx' });
