'use strict';

const { startStdio } = require('./worker.cjs');

// Cindy 通过宿主引导进程 require() 插件入口，而不是直接执行该文件。
// 因此生产入口必须无条件启动 stdio JSON-RPC 循环。
startStdio();
