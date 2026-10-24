'use strict';
// Use of a device outside this plugin: a script or tool that names the device
// in its own arguments (simctl, xcodebuild -destination id=…, Baguette CLI…).
// The simulator's own processes only carry the UDID inside a path, and this
// worker's process tree (including the viewer server) is excluded.
const {execFile}=require('node:child_process');
const UDID=/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
function listProcesses(){
 return new Promise((resolve,reject)=>execFile('/bin/ps',['-axww','-o','pid=,ppid=,args='],{maxBuffer:8*1024*1024,timeout:3000},(error,stdout)=>error?reject(error):resolve(stdout)));
}
function parse(text){
 return String(text).split('\n').map(line=>line.match(/^\s*(\d+)\s+(\d+)\s(.*)$/)).filter(Boolean).map(m=>({pid:Number(m[1]),ppid:Number(m[2]),args:m[3]}));
}
function tree(processes,root){
 const children=new Map();
 for(const p of processes){if(!children.has(p.ppid))children.set(p.ppid,[]);children.get(p.ppid).push(p.pid);}
 const seen=new Set([root]),stack=[root];
 while(stack.length)for(const child of children.get(stack.pop())||[])if(!seen.has(child)){seen.add(child);stack.push(child);}
 return seen;
}
function names(args,udid){
 return new RegExp(`(^|[\\s=,:'"])${udid}($|[\\s,'"])`,'i').test(args);
}
// Returns the UDIDs among `udids` that another process is operating right now.
async function externalUse(udids,{self=process.pid,ps=listProcesses}={}){
 const wanted=udids.filter(u=>typeof u==='string'&&UDID.test(u));
 if(!wanted.length)return [];
 const processes=parse(await ps()),own=tree(processes,self);
 return wanted.filter(udid=>processes.some(p=>!own.has(p.pid)&&names(p.args,udid)));
}
module.exports={externalUse,parse,names,tree};
