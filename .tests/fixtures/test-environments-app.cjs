'use strict';
// Simulated application protocol for integration tests, never a real login source.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const vm = require('node:vm');
const dir = process.argv[2];
const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json')));
const data = path.join(dir, 'app-data');
fs.mkdirSync(path.join(data, '.dev-instances'), {recursive: true});
let current = null;
const saved = new Set();
const api = {
  authInitialize: async () => {
    const requested = JSON.parse(fs.readFileSync(path.join(dir, 'account.json'))).current;
    if (requested) { current = requested; saved.add(current); }
    return {mode: current ? 'cloud' : 'signed-out', isAuthenticated: !!current, dataOwnerId: current, token: 'must-not-leak'};
  },
  authListAccounts: async () => ({accounts: [...saved].map(accountKey => ({accountKey, displayName: accountKey, isCurrent: current === accountKey, refreshToken: 'must-not-leak'}))}),
  authGetLoginState: async () => ({success: true, state: {step: 'identifier'}}),
  authSwitchAccount: async accountKey => { if (!saved.has(accountKey)) throw Error('ACCOUNT_NOT_FOUND'); current = accountKey; },
  authRefresh: async () => !!current,
  localDb: {ensureReady: async () => ({ready: !!current})},
  deviceLink: {getState: async () => ({remoteControlEnabled: false})},
};
function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  const head = Buffer.alloc(body.length < 126 ? 2 : 4);
  head[0] = 0x81;
  if (head.length === 2) head[1] = body.length;
  else { head[1] = 126; head.writeUInt16BE(body.length, 2); }
  return Buffer.concat([head, body]);
}
const server = http.createServer((req, res) => {
  if (req.url !== '/json/list') { res.writeHead(404).end(); return; }
  const port = server.address().port;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify([{type: 'page', url: `http://127.0.0.1:${port}/`, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/main`} ]));
});
server.on('upgrade', (req, socket) => {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  let bytes = Buffer.alloc(0);
  socket.on('error', () => {});
  socket.on('data', chunk => {
    bytes = Buffer.concat([bytes, chunk]);
    while (bytes.length >= 2) {
      const opcode = bytes[0] & 15;
      let length = bytes[1] & 127, offset = 2;
      if (length === 126) { if (bytes.length < 4) return; length = bytes.readUInt16BE(2); offset = 4; }
      if (length === 127) { socket.destroy(); return; }
      const masked = !!(bytes[1] & 128), maskSize = masked ? 4 : 0;
      if (bytes.length < offset + maskSize + length) return;
      const mask = bytes.subarray(offset, offset + maskSize), payload = Buffer.from(bytes.subarray(offset + maskSize, offset + maskSize + length));
      bytes = bytes.subarray(offset + maskSize + length);
      if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      if (opcode !== 1) continue;
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      const request = JSON.parse(payload.toString());
      if (request.method !== 'Runtime.evaluate') { socket.destroy(); return; }
      void Promise.resolve(vm.runInNewContext(request.params.expression, {window: {electronAPI: api}})).then(
        value => socket.write(frame({id: request.id, result: {result: {value}}})),
        () => socket.write(frame({id: request.id, result: {exceptionDetails: {text: 'simulated application error'}}})),
      );
    }
  });
});
server.listen(Number(plan.env.XDT_CDP_PORT), '127.0.0.1', () => {
  const receipt = {rootDir: plan.projectRoot, userDataDir: data, isolated: true, profileKind: 'isolated-sandbox',
    startedAtMs: Date.now(), pid: process.pid, instanceId: 'example-instance', state: 'ready'};
  fs.writeFileSync(path.join(data, '.dev-instances', process.pid + '.json'), JSON.stringify(receipt));
  fs.writeFileSync(path.join(dir, 'startup.json'), JSON.stringify({state: 'ready', pid: process.pid}));
  console.log('==> Isolated dev user data: ' + data);
});
