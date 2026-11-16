import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const contracts = JSON.parse(fs.readFileSync(new URL('./api-contract.json',import.meta.url))).operations;
function checkRequest(r) {
  const url = new URL(r.url);
  assert.equal(url.origin, 'https://api.vercel.com');
  const contract=contracts.find(c=>c.method===r.method&&new RegExp('^'+c.path.replace(/\{[^}]+\}/g,'[^/]+')+'$').test(url.pathname));
  assert.ok(contract, 'Request must match a verified official endpoint: '+r.method+' '+url.pathname);
  for(const key of url.searchParams.keys()) assert.ok(contract.query.includes(key), 'Unsupported query parameter '+key);
  if(r.body) {
    const body=JSON.parse(r.body);
    for(const key of contract.requiredBody) assert.ok(key in body, 'Required API body field '+key);
    for(const [key,value] of Object.entries(body)) {
      assert.ok(key in contract.bodyProperties, 'Unsupported API body field '+key);
      const spec=contract.bodyProperties[key];
      if(spec.enum) assert.ok(spec.enum.includes(value), 'API enum for '+key);
      if(spec.type&&value!==null) assert.equal(Array.isArray(value)?'array':typeof value,spec.type,'API type for '+key);
    }
  }
}
export function loadPlugin({cfg = {}, remote, fsRead, confirm = {ok:true,confirmed:true}, localFetch, bridge='lumi'} = {}) {
  const requests = [], confirmations = [], messages = [], fileReads = [], channels = [];
  let receive;
  const source = fs.readFileSync(new URL('../../lumi-vercel/main.js', import.meta.url), 'utf8');
  const context = {
    URL, console, setTimeout, clearTimeout,
    fetch: localFetch || (async path => { if(path !== '/kv') throw Error('Unexpected local fetch: '+path); return {ok:true,json:async()=>cfg}; }),
    BroadcastChannel: class { constructor(name){this.name=name;channels.push(this);} postMessage(m){messages.push(m);} },
    lumi: {
      onHostMessage: fn => { receive = fn; },
      send: async m => { messages.push(m); return {ok:true}; },
      fetch: async r => { checkRequest(r); requests.push(r); return remote ? remote(r, requests) : {ok:true,status:200,body:'{}'}; },
      confirm: async r => { confirmations.push(r); return typeof confirm === 'function' ? confirm(r) : confirm; },
      fs: async r => {fileReads.push(r); return fsRead ? fsRead(r) : {ok:true,content:'value-from-file'};}
    }
  };
  if (bridge === 'cindy') { context.cindy = context.lumi; delete context.lumi; }
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.pluginTests = {tools, execute, redact}; })();'), context);
  return {...context.pluginTests, requests, confirmations, messages, fileReads, channels, receive};
}
export const response = data => ({ok:true,status:200,body:JSON.stringify(data)});
