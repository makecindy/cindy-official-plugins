'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

function parseLine(line) {
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Cindy 的通用 Node broker 不向第三方 MCP 暴露宿主反向 RPC。Maker 的动态
 * tools/list 又需要 roots/list 才能识别当前项目，因此只在本插件进程内代理这一
 * 个只读方法。其它反向请求仍然失败关闭。
 */
function createMcpRootRouter(options) {
  if (!options || typeof options.writeHost !== 'function' || typeof options.writeRuntime !== 'function') {
    throw new Error('MCP root router 缺少输出通道');
  }

  const queuedLists = [];
  let activeList = null;
  let activeTimer = null;
  let failed = false;
  const listTimeoutMs = options.listTimeoutMs || 115_000;
  const staleResponseIds = new Set();

  function writeRuntime(message) {
    options.writeRuntime(`${JSON.stringify(message)}\n`);
  }

  function pumpList() {
    if (failed || activeList || queuedLists.length === 0) return;
    activeList = queuedLists.shift();
    activeTimer = setTimeout(function onListTimeout() {
      const timedOut = activeList;
      activeList = null;
      activeTimer = null;
      failed = true;
      if (timedOut) {
        staleResponseIds.add(String(timedOut.request.id));
        options.writeHost(`${JSON.stringify({
          jsonrpc: '2.0',
          id: timedOut.request.id,
          error: { code: -32000, message: 'TapTap Maker tools/list 响应超时' },
        })}\n`);
      }
      while (queuedLists.length > 0) {
        const queued = queuedLists.shift();
        options.writeHost(`${JSON.stringify({
          jsonrpc: '2.0',
          id: queued.request.id,
          error: { code: -32000, message: 'TapTap Maker tools/list 路由已重置' },
        })}\n`);
      }
      if (typeof options.onFatal === 'function') {
        options.onFatal(new Error('TapTap Maker tools/list 路由超时'));
      }
    }, listTimeoutMs);
    activeTimer.unref?.();
    writeRuntime({
      jsonrpc: '2.0',
      id: activeList.request.id,
      method: 'tools/list',
      params: {},
    });
  }

  function handleHostLine(line) {
    const message = parseLine(line);
    if (!message) {
      options.writeRuntime(`${line}\n`);
      return;
    }
    if (message.method === 'initialize' && message.id !== undefined) {
      const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params)
        ? message.params
        : {};
      const capabilities = params.capabilities
        && typeof params.capabilities === 'object'
        && !Array.isArray(params.capabilities)
        ? params.capabilities
        : {};
      writeRuntime({
        ...message,
        params: {
          ...params,
          capabilities: {
            ...capabilities,
            roots: { listChanged: false },
          },
        },
      });
      return;
    }
    if (message.method === 'cindy/tools-list' && message.id !== undefined) {
      if (failed) {
        options.writeHost(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: 'TapTap Maker tools/list 路由不可用' },
        })}\n`);
        return;
      }
      const targetDir = message.params
        && typeof message.params === 'object'
        && !Array.isArray(message.params)
        ? message.params.target_dir
        : null;
      if (typeof targetDir !== 'string' || !path.isAbsolute(targetDir)) {
        options.writeHost(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32602, message: 'target_dir 必须是本地绝对目录' },
        })}\n`);
        return;
      }
      queuedLists.push({ request: message, targetDir: path.resolve(targetDir) });
      pumpList();
      return;
    }
    options.writeRuntime(`${line}\n`);
  }

  function handleRuntimeLine(line) {
    const message = parseLine(line);
    if (!message) {
      options.writeHost(`${line}\n`);
      return;
    }
    if (typeof message.method === 'string' && message.id !== undefined) {
      if (message.method === 'roots/list' && activeList) {
        writeRuntime({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            roots: [{
              uri: pathToFileURL(activeList.targetDir).href,
              name: path.basename(activeList.targetDir) || activeList.targetDir,
            }],
          },
        });
      } else {
        writeRuntime({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Cindy plugin does not expose this reverse RPC method' },
        });
      }
      return;
    }

    if (
      message.id !== undefined
      && typeof message.method !== 'string'
      && staleResponseIds.delete(String(message.id))
    ) {
      return;
    }
    options.writeHost(`${line}\n`);
    if (
      activeList
      && message.id !== undefined
      && String(message.id) === String(activeList.request.id)
      && typeof message.method !== 'string'
    ) {
      if (activeTimer) clearTimeout(activeTimer);
      activeTimer = null;
      activeList = null;
      pumpList();
    }
  }

  return { handleHostLine, handleRuntimeLine };
}

module.exports = { createMcpRootRouter };
