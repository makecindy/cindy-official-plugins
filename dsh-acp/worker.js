'use strict';

/**
 * Node worker (json-rpc-stdio). One JSON-RPC 2.0 object per line in each direction;
 * stdout carries protocol messages only.
 *
 * Methods:
 *   detect({ locale? }) -> { available, path?, version?, reason?, message?, messages?, detail? }
 *     Finds the local dsh executable and checks that `dsh --version` runs. `message`
 *     is in the requested locale ('zh-CN' or English); `messages` carries both.
 *   keyStatus() / setKey({ key }) / clearKey()
 *     -> { supported: true, configured, source?: 'file' | 'env' | 'dotenv', writable }
 *      | { supported: false, reason } | { supported: true, error, detail? }
 *     DeepSeek API key in DSH's own credential store (see dsh-credentials.js). The key
 *     value is never returned or logged.
 *   listModels({ sessionId? })
 *     -> { supported: true, models: [{ id, name, description?, group? }], sessionId? }
 *      | { supported: false, reason } | { supported: true, error, detail? }
 *     Asks dsh for its models over ACP in the plugin's one dedicated session (see dsh-models.js).
 *   cliMaintenance({ action, version?, op? }) -> { state, version } | { error }
 *     Checks, installs or updates dsh from npm (see cli-installer.cjs). While installing it sends
 *     `progress` keep-alives and `cli-progress` { op, events } notifications for the settings page.
 */

const readline = require('node:readline');
const maintain = require('./cli-installer.cjs');
const { detectDsh } = require('./resolve-dsh.js');
const { clearKey, keyStatus, readUsage, setKey } = require('./dsh-credentials.js');
const { listModels } = require('./dsh-models.js');

/** Store failures (unreadable file, lock timeout) as data; DSH diagnostics never quote values. */
function storeFailure(error) {
  const detail = error && error.message ? String(error.message).slice(0, 300) : undefined;
  return { supported: true, error: 'store-failed', ...(detail ? { detail } : {}) };
}

function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function replyError(id, code, message) {
  reply({ jsonrpc: '2.0', id, error: { code, message } });
}

let usageRead;
const handlers = {
  cliMaintenance(params) {
    return maintain(params, (method, data) => reply({ jsonrpc: '2.0', method, ...(data ? { params: data } : {}) }));
  },
  usage() {
    if (!usageRead) {
      const read = readUsage().catch(() => null).finally(() => {
        if (usageRead === read) usageRead = undefined;
      });
      usageRead = read;
    }
    return usageRead;
  },
  async detect(params) {
    const locale = params && typeof params.locale === 'string' ? params.locale : undefined;
    return detectDsh({ locale });
  },
  async keyStatus() {
    return keyStatus().catch(storeFailure);
  },
  async setKey(params) {
    usageRead = undefined;
    return setKey(params && params.key).catch(storeFailure);
  },
  async clearKey() {
    usageRead = undefined;
    return clearKey().catch(storeFailure);
  },
  async listModels(params) {
    return listModels(params).catch((error) => ({
      supported: true,
      error: 'list-failed',
      detail: String((error && error.message) || error).slice(0, 300),
    }));
  },
};

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on('line', (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    replyError(null, -32700, 'Parse error');
    return;
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    replyError(null, -32600, 'Invalid request');
    return;
  }
  const hasId = Object.prototype.hasOwnProperty.call(request, 'id') && request.id !== null;
  if (typeof request.method !== 'string') {
    if (hasId) replyError(request.id, -32600, 'Invalid request');
    return;
  }
  const handler = Object.prototype.hasOwnProperty.call(handlers, request.method) ? handlers[request.method] : null;
  if (!handler) {
    if (hasId) replyError(request.id, -32601, 'Method not found');
    return;
  }
  Promise.resolve()
    .then(() => handler(request.params))
    .then(
      (result) => {
        if (hasId) reply({ jsonrpc: '2.0', id: request.id, result });
      },
      (error) => {
        process.stderr.write(`[dsh-acp worker] ${request.method} failed: ${error && error.message ? error.message : error}\n`);
        if (hasId) replyError(request.id, -32603, `DeepSeek Harness ${request.method} failed`);
      },
    );
});

input.on('close', () => {
  process.exit(0);
});
