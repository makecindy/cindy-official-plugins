'use strict';

process.env.TAPTAP_MAKER_DISTRIBUTION = 'cindy_plugin';

const path = require('node:path');
const readline = require('node:readline');
const { PassThrough, Readable } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');
const { pathToFileURL } = require('node:url');

const { installMakerSpawnAdapter } = require('./child-process-adapter.cjs');
const { createMcpRootRouter } = require('./mcp-root-router.cjs');

const makerEntry = path.resolve(__dirname, '../vendor/taptap-maker/dist/maker.js');
const childApi = globalThis.__CINDY_NODE__;

if (!childApi || typeof childApi.spawnEntry !== 'function') {
  throw new Error('TapTap Maker 需要 Cindy 的 node.childSpawn 能力');
}

installMakerSpawnAdapter({
  makerEntry,
  childEntry: 'node/maker-child.cjs',
  spawnEntry: childApi.spawnEntry,
});

// Maker 的 MCP server 运行在虚拟 stdio 上；外层只代理 roots/list，把当前
// session-context 的可信本地目录作为本次 tools/list 的唯一 root。
//
// 虚拟 stdio 有两种装法，取决于宿主是否允许替换 process.stdio 属性：
//   替换   —— 属性可配置时把 process.stdin / stdout 换成 PassThrough。
//   就地劫持 —— Electron 在 Windows 上把 process.stdin 钉成 configurable: false
//               的 getter，此时 defineProperty 抛 "Cannot redefine property:
//               stdin"，本入口会在模块加载期就崩掉、全部 Maker 工具不可用。
//               改成不换对象：截下宿主喂字节用的 stdin.push 与 Maker 写出用的
//               stdout.write，路由语义与替换路径一致。
// 判据是属性能力而不是 process.platform，宿主哪天在别的平台上也钉死属性会自动
// 走劫持路径。
const hostStdin = process.stdin;
const hostStdout = process.stdout;
const runtimeStdout = new PassThrough();
const runtimeDecoder = new StringDecoder('utf8');
let runtimeBuffer = '';

const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
const stdoutDescriptor = Object.getOwnPropertyDescriptor(process, 'stdout');
const canReplaceStdin = !stdinDescriptor || stdinDescriptor.configurable === true;
const canReplaceStdout = !stdoutDescriptor || stdoutDescriptor.configurable === true;
// 劫持路径会换掉 hostStdout.write，router 回写宿主必须用劫持前抓到的引用，否则自我递归。
const writeHostBytes = hostStdout.write.bind(hostStdout);
// 劫持路径下 hostStdin 同时是宿主入口与 Maker 的读取源，塞数据必须绕过劫持。
const nativePush = Readable.prototype.push;
const runtimeStdin = canReplaceStdin ? new PassThrough() : null;

const router = createMcpRootRouter({
  writeHost(line) {
    writeHostBytes(line);
  },
  writeRuntime(line) {
    if (runtimeStdin) runtimeStdin.write(line);
    else nativePush.call(hostStdin, Buffer.from(line, 'utf8'));
  },
  onFatal(error) {
    process.stderr.write(`${error.message}\n`);
    setImmediate(function terminatePoisonedRouter() {
      process.exit(1);
    });
  },
});

if (canReplaceStdin) {
  readline.createInterface({ input: hostStdin }).on('line', function onHostLine(line) {
    router.handleHostLine(line);
  });
} else {
  const hostDecoder = new StringDecoder('utf8');
  let hostBuffer = '';
  const intakeHostBytes = function intakeHostBytes(chunk, encoding) {
    hostBuffer += hostDecoder.write(Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
    for (;;) {
      const newline = hostBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = hostBuffer.slice(0, newline).trim();
      hostBuffer = hostBuffer.slice(newline + 1);
      if (!line) continue;
      router.handleHostLine(line);
    }
  };
  // 宿主先宣布 ready、再 require 本入口，所以装劫持之前可能已有宿主字节（通常是
  // MCP initialize）落进流缓冲。这些字节必须补喂给 router，否则会被 Maker 当成
  // 已路由的输入直接读走，capabilities.roots 注入不上、动态 tools/list 残废。
  // 必须先取完再处理：router 会把路由后的行推回同一条流，边读边处理会把自己的
  // 输出当成新的宿主行反复路由，卡死在这个循环里。
  const bufferedChunks = [];
  for (;;) {
    const buffered = hostStdin.read();
    if (buffered === null || buffered === undefined) break;
    bufferedChunks.push(buffered);
  }
  hostStdin.push = function pushFromHost(chunk, encoding) {
    // 宿主宣布 stdin 结束：原样透传，让 Maker 侧的读取流正常收摊。
    if (chunk === null || chunk === undefined) return nativePush.call(hostStdin, null);
    intakeHostBytes(chunk, encoding);
    return true;
  };
  for (let index = 0; index < bufferedChunks.length; index += 1) {
    intakeHostBytes(bufferedChunks[index]);
  }
}

runtimeStdout.on('data', function onRuntimeData(chunk) {
  runtimeBuffer += runtimeDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  for (;;) {
    const newline = runtimeBuffer.indexOf('\n');
    if (newline < 0) break;
    const line = runtimeBuffer.slice(0, newline).trim();
    runtimeBuffer = runtimeBuffer.slice(newline + 1);
    if (line) router.handleRuntimeLine(line);
  }
});

if (runtimeStdin) {
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    enumerable: true,
    value: runtimeStdin,
  });
}
if (canReplaceStdout) {
  Object.defineProperty(process, 'stdout', {
    configurable: true,
    enumerable: true,
    value: runtimeStdout,
  });
} else {
  hostStdout.write = function writeFromRuntime(chunk, encoding, callback) {
    return runtimeStdout.write(chunk, encoding, callback);
  };
}

// utilityProcess 普通 worker 的 argv 含 Cindy 引导层；Maker 只应看到自己的入口。
process.argv = [process.argv[0], makerEntry];

import(pathToFileURL(makerEntry).href).catch(function onImportError(error) {
  process.stderr.write(`TapTap Maker Runtime 启动失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
