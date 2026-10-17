import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const worker = require('../rhino-bridge/node/worker.cjs');
const official = require('../rhino-bridge/node/official.cjs');
const source = fs.readFileSync(new URL('../rhino-bridge/main.js', import.meta.url), 'utf8');

test('source-state Python regressions run in the Node gate', () => {
  const run = spawnSync(process.platform === 'win32' ? 'py' : 'python3', [...(process.platform === 'win32' ? ['-3'] : []), fileURLToPath(new URL('./rhino-bridge-state.test.py', import.meta.url))], {encoding:'utf8'});
  assert.equal(run.status, 0, run.stderr || String(run.error));
});

test('transport and Host preserve all source states without guessing from error codes', async () => {
  for (const state of ['not_executed','executed','unknown',undefined]) {
    const reply = {ok:false, code:'BRIDGE_SIZE', message:'failure', ...(state ? {execution_state:state} : {})};
    const transport = {createConnection() {
      const socket = new EventEmitter();
      socket.destroy = () => {};
      socket.end = wire => {const req=JSON.parse(wire); socket.emit('data', Buffer.from(JSON.stringify({protocol:1,id:req.id,result:reply})+'\n'));};
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    }};
    const result = await worker.requestRhino({action:'create',args:{}}, 'a'.repeat(64), transport);
    let handler; const sent=[];
    vm.runInNewContext(source, {fetch:async()=>({ok:true,json:async()=>({backend:'legacy'})}), BroadcastChannel:class {}, cindy:{node:{request:async()=>({ok:true,result})},onHostMessage:fn=>{handler=fn;},send:async value=>sent.push(value)}});
    await handler({type:'tool-call',tool:'rhino_create',args:{},callId:'fixture'});
    assert.equal(sent[0].execution_state, state || 'unknown');
    assert.equal(sent[0].structuredContent.execution_state, state || 'unknown');
    assert.equal(sent[0].message.includes('勿直接重试'), !state || state==='unknown');
  }
});

test('connection refusal is not executed; disconnect after send is unknown', async () => {
  for (const dispatch of [false,true]) {
    const transport = {createConnection() {const socket=new EventEmitter(); socket.destroy=()=>{};socket.end=()=>socket.emit('error',new Error('lost'));queueMicrotask(()=>socket.emit(dispatch?'connect':'error',new Error('refused')));return socket;}};
    const result=await worker.requestRhino({action:'create',args:{}},'a'.repeat(64),transport);
    assert.equal(result.execution_state, dispatch?'unknown':'not_executed');
  }
  assert.equal((await official.officialRequest({operation:'call',config:{routerPath:'invalid'}})).execution_state,'not_executed');
});
