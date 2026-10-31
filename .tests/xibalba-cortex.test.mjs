import test from 'node:test';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const plugin = path.resolve(import.meta.dirname, '../xibalba-cortex');
for (const script of ['bridge.test.cjs', 'worker-startup.test.cjs', 'worker-outcomes.test.cjs']) {
  test(`Cortex ${script}`, () => {
    execFileSync(process.execPath, [path.join(plugin, 'tests', script)], {timeout: 30000, stdio: 'pipe'});
  });
}
