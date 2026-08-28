'use strict';

process.env.TAPTAP_MAKER_DISTRIBUTION = 'cindy_plugin';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const makerEntry = path.resolve(__dirname, '../vendor/taptap-maker/dist/maker.js');

// childSpawn 已把 argv 伪装为 [node, 本入口, ...args]；把入口替换为官方
// Runtime 后原样保留固定 CLI / __maker-proxy 参数。
process.argv = [process.argv[0], makerEntry].concat(process.argv.slice(2));

import(pathToFileURL(makerEntry).href).catch(function onImportError(error) {
  process.stderr.write(`TapTap Maker 子进程启动失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
