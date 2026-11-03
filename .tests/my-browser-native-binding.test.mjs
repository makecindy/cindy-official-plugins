import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {createNativeBinding,HOST}=require('../my-browser/node/native-binding.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cindy-native-fixture-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const binary=path.join(dir,'input');await fs.writeFile(binary,'fixture executable');const profile=path.join(dir,'profile');await fs.mkdir(profile);return {dir,binary,profile};}
test('native registration contains only allowed origins; private authority is not in the browser manifest',async t=>{
 const {dir,binary,profile}=await fixture(t),root=path.join(dir,'native');
 const n=createNativeBinding({root,binary,profiles:[profile],platform:'darwin'});
 assert.deepEqual(await n.install(18819,['a'.repeat(32)]),{ok:true});
 const m=JSON.parse(await fs.readFile(path.join(profile,'NativeMessagingHosts',HOST+'.json')));
 assert.deepEqual(m.allowed_origins,['chrome-extension://'+'a'.repeat(32)+'/']);assert.equal(m.type,'stdio');
 assert.equal(JSON.stringify(m).includes(n.token),false);
 assert.equal((await fs.stat(path.join(root,'connections/18819.json'))).mode&0o777,0o600);
 assert.equal((await fs.stat(root)).mode&0o777,0o700);
 await n.close();await assert.rejects(fs.access(path.join(root,'connections/18819.json')));
});
test('closing one bridge does not delete another instance authority on the same reused port',async t=>{
 const {dir,binary,profile}=await fixture(t),opts={root:path.join(dir,'native'),binary,profiles:[profile],platform:'darwin'};
 const a=createNativeBinding(opts),b=createNativeBinding(opts);await a.install(18819,['a'.repeat(32)]);await b.install(18819,['a'.repeat(32)]);await a.close();
 assert.equal(JSON.parse(await fs.readFile(path.join(opts.root,'connections/18819.json'))).token,b.token);await b.close();
});
test('Windows registration uses only current-user fixed registry keys and argv',async t=>{
 const {dir,binary}=await fixture(t),calls=[];
 const n=createNativeBinding({root:path.join(dir,'native'),binary,platform:'win32',env:{SystemRoot:'C:\\Windows'},run:async(...args)=>calls.push(args)});
 assert.equal((await n.install(18819,['a'.repeat(32)])).ok,true);assert.equal(calls.length,3);
 for(const [,args,opts] of calls){assert.equal(args[0],'ADD');assert.match(args[1],/^HKCU\\Software\\/);assert.equal(opts.windowsHide,true);assert.equal(args.at(-1),'/f');}
 await n.close();
});
test('native installation fails closed if executable is absent or registration directory is a symlink',async t=>{
 const {dir,binary,profile}=await fixture(t);const root=path.join(dir,'link');await fs.symlink(profile,root);
 const n=createNativeBinding({root,binary,profiles:[profile]});assert.equal((await n.install(18819,['a'.repeat(32)])).ok,false);assert.equal(n.status(),'unavailable');
});
test('direct invocation by a non-browser cannot use native bootstrap', {skip:!process.env.CINDY_NATIVE_TEST_BINARY},()=>{
 const input=Buffer.from('{}'),header=Buffer.alloc(4);header.writeUInt32LE(input.length);
 const r=spawnSync(process.env.CINDY_NATIVE_TEST_BINARY,['chrome-extension://'+'a'.repeat(32)+'/'],{input:Buffer.concat([header,input]),timeout:10000});
 assert.equal(r.status,0);const len=r.stdout.readUInt32LE();const result=JSON.parse(r.stdout.subarray(4,4+len));assert.equal(result.ok,false);
});

test('a forged browser argv[0] does not pass macOS running-process identity verification', {skip:process.platform!=='darwin'||!process.env.CINDY_NATIVE_TEST_BINARY},()=>{
 const binary=process.env.CINDY_NATIVE_TEST_BINARY;
 const script=`const {spawnSync}=require('node:child_process');const b=Buffer.from('{}'),h=Buffer.alloc(4);h.writeUInt32LE(b.length);const r=spawnSync(process.argv[1],['chrome-extension://'+'a'.repeat(32)+'/'],{input:Buffer.concat([h,b]),timeout:10000});process.stdout.write(r.stdout);`;
 const r=spawnSync(process.execPath,['-e',script,binary],{argv0:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',timeout:15000});
 assert.equal(r.status,0);const len=r.stdout.readUInt32LE();const result=JSON.parse(r.stdout.subarray(4,4+len));assert.equal(result.error,'BROWSER_CALLER_UNVERIFIED');
});
test('native registration is ready before the browser has ever created a profile',async t=>{
 const {dir,binary}=await fixture(t),profile=path.join(dir,'not-yet-installed');
 const n=createNativeBinding({root:path.join(dir,'native'),binary,profiles:[profile],platform:'darwin'});
 assert.equal((await n.install(18819,['a'.repeat(32)])).ok,true);
 assert.equal(JSON.parse(await fs.readFile(path.join(profile,'NativeMessagingHosts',HOST+'.json'))).name,HOST);
 await n.close();
});

test('one browser directory failure does not abort native installation',async t=>{
 const {dir,binary}=await fixture(t),home=path.join(dir,'home');
 const bad=path.join(home,'Library/Application Support/Dia/NativeMessagingHosts');
 await fs.mkdir(path.dirname(bad),{recursive:true});await fs.symlink(dir,bad);
 const n=createNativeBinding({root:path.join(dir,'native'),binary,platform:'darwin',home});
 assert.equal((await n.install(18819,['a'.repeat(32)])).ok,true);
 assert.equal(n.status(),'ready');
 const host=HOST+'.json';
 assert.equal(JSON.parse(await fs.readFile(path.join(home,'Library/Application Support/BraveSoftware/Brave-Origin/NativeMessagingHosts',host))).name,HOST);
 assert.equal(JSON.parse(await fs.readFile(path.join(home,'Library/Application Support/Google/Chrome/NativeMessagingHosts',host))).name,HOST);
 await assert.rejects(fs.readFile(path.join(bad,host)));
 await n.close();
});
test('native installation still fails when every browser directory fails',async t=>{
 const {dir,binary}=await fixture(t);
 const a=path.join(dir,'a'),b=path.join(dir,'b');
 await fs.writeFile(a,'x');await fs.writeFile(b,'y');
 const n=createNativeBinding({root:path.join(dir,'native'),binary,platform:'darwin',profiles:[a,b]});
 assert.equal((await n.install(18819,['a'.repeat(32)])).ok,false);
 assert.equal(n.status(),'unavailable');
});
