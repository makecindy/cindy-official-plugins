import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const version=JSON.parse(fs.readFileSync(new URL('../my-browser/extension/manifest.json',import.meta.url),'utf8')).version;
const source=fs.readFileSync(new URL('../my-browser/extension/background.js',import.meta.url),'utf8');
test('discovery continues past mismatched and unpaired bridges without opening tabs',async()=>{
  const ports=[],saved={};
  const noop={addListener(){}};
  const chrome={runtime:{id:'fixture',getManifest:()=>({version}),getURL:()=> 'chrome-extension://fixture/',onStartup:noop,onInstalled:noop,onMessage:noop},
    storage:{local:{get:async()=>({clientId:'fixture'}),set:async()=>{}},session:{get:async()=>({}),set:async v=>Object.assign(saved,v)}},
    tabs:{onRemoved:noop,onActivated:noop},alarms:{create(){},onAlarm:noop},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
  const context={chrome,MyBrowserNetwork:{create:()=>({})},MyBrowserPolicy:{},navigator:{userAgent:'Chrome'},URL,AbortController,setTimeout,clearTimeout,crypto:globalThis.crypto,
    fetch:async url=>{const port=Number(new URL(url).port);ports.push(port);return {ok:true,json:async()=>({plugin:'my-browser',protocol:3,extensionId:'fixture',version:port===18810?'0.2.0':version,pairing_required:port===18811,session:'fixture-session'})};}};
  vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'')+'\nglobalThis.discoverTest=discover;',context);
  const found=await context.discoverTest();assert.equal(found.base,'http://127.0.0.1:18812');assert.deepEqual(ports,[18810,18811,18812]);assert.equal(saved.connection.connected,true);
});
