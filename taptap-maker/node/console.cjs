'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function failure(state, message) {
  return { ok: false, execution_state: state, automatic_retry: false, message };
}

function openConsole(workdir) {
  if (workdir !== undefined && (typeof workdir !== 'string' || !path.isAbsolute(workdir))) {
    return Promise.resolve(failure('not_executed', 'A local absolute workspace is required.'));
  }
  const args = [path.resolve(__dirname, '../vendor/taptap-maker/dist/maker.js'),
    'console', 'open', '--no-open', '--json'];
  if (workdir && fs.existsSync(path.join(workdir, '.maker-mcp/config.json'))) {
    args.push('--target-dir', workdir);
  }
  return new Promise((resolve) => {
    childProcess.execFile('node', args, {
      cwd: os.homedir(), shell: false, windowsHide: true,
      env: { ...process.env, TAPTAP_MAKER_DISTRIBUTION: 'cindy_plugin' },
      timeout: 45000, maxBuffer: 256 * 1024,
    }, (error, stdout) => {
      if (error) {
        const notStarted = error.code === 'ENOENT' || error.code === 'EACCES';
        resolve(failure(notStarted ? 'not_executed' : 'unknown', notStarted
          ? 'System Node.js is unavailable. Install Node.js and restart Cindy.'
          : 'Console startup could not be confirmed. It may still be running; do not automatically retry. Check the existing Maker console/version.'));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        const url = new URL(result.url);
        if (result.ok !== true || url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
          || !url.port || url.username || url.password || url.pathname !== '/' || url.hash
          || [...url.searchParams.keys()].some((key) => !['projectid', 'checkout'].includes(key))) {
          throw new Error('Invalid console URL');
        }
        resolve({ ok: true, url: url.href, execution_state: 'executed', automatic_retry: false });
      } catch (_error) {
        resolve(failure('unknown', 'Console startup returned an invalid result. It may still be running; do not automatically retry.'));
      }
    });
  });
}

module.exports = { openConsole };
