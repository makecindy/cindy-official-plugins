import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('binary dependency packaging contract (optional live HTTPS smoke)', () => {
  execFileSync('python3', [fileURLToPath(new URL('./binary-dependencies_test.py', import.meta.url))], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    stdio: 'inherit',
    timeout: process.env.CINDY_BINARY_LIVE_SMOKE === '1' ? 300_000 : 60_000,
  });
});
