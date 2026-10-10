'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const LF = String.fromCharCode(10);
const LIMIT = 900000;
const BLOCKED = new Set(['spawn_slot', 'close_slot']);
function error(code, message) { return Object.assign(new Error(message), { code }); }
function validateConfig(config) {
  const file = config?.routerPath;
  if (typeof file !== 'string' || file.includes(String.fromCharCode(0)) || !path.isAbsolute(file) || !['rhino-mcp-router', 'rhino-mcp-router.exe'].includes(path.basename(file).toLowerCase())) {
    throw error('OFFICIAL_PATH', '请在设置中填写官方 MCPConnect 输出的 rhino-mcp-router 可执行文件绝对路径，只填路径，不含引号或参数。');
  }
  const version = config.version ?? '8';
  if (!['8', '9', 'WIP'].includes(version)) throw error('OFFICIAL_VERSION', '请选择 Rhino 8、9 或 WIP。');
  if (!fs.statSync(file).isFile()) throw error('OFFICIAL_PATH', 'Router 文件不存在，请安装官方 Rhino-MCP-Platform，并用 MCPConnect 核对路径。');
  return { file, version };
}
function usable(tool) {
  return tool && typeof tool.name === 'string' && !BLOCKED.has(tool.name) &&
    (tool.name === 'list_slots' || tool.inputSchema?.properties?.slot);
}
class Router {
  constructor(child) {
    this.child = child; this.pending = new Map(); this.id = 0; this.buffer = Buffer.alloc(0); this.closed = false;
    child.stdout.on('data', chunk => this.consume(chunk));
    child.stderr.on('data', () => {}); // Do not forward model data or script text from upstream logs.
    child.on('error', () => this.abort(error('OFFICIAL_START', '官方 Router 启动失败，请检查路径、系统架构与执行权限。')));
    child.on('exit', () => this.abort(error('OFFICIAL_EXIT', '官方 Router 已退出；若刚提交操作，先检查 Rhino 模型，勿自动重试。')));
    child.stdin.on('error', () => this.abort(error('OFFICIAL_PIPE', 'Router 通信中断；操作结果可能未知，请先检查 Rhino。')));
  }
  consume(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (!this.closed) {
      const end = this.buffer.indexOf(10);
      if (end < 0) { if (this.buffer.length > LIMIT) this.abort(error('OFFICIAL_SIZE', '官方响应超过当前容量，请减少对象数量或截图尺寸；不要重复写入。')); return; }
      if (end > LIMIT) { this.abort(error('OFFICIAL_SIZE', '官方响应过大，请缩小查询或截图尺寸；修改结果请先核对模型。')); return; }
      const line = this.buffer.subarray(0, end).toString('utf8'); this.buffer = this.buffer.subarray(end + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { this.abort(error('OFFICIAL_PROTOCOL', 'Router 输出不是有效 MCP 消息，请核对官方版本。')); return; }
      if (!msg || msg.jsonrpc !== '2.0') { this.abort(error('OFFICIAL_PROTOCOL', '官方 MCP 协议不匹配，请核对 Router。')); return; }
      if (msg.method) {
        if (msg.id !== undefined) this.send({ jsonrpc:'2.0', id:msg.id, error:{code:-32601,message:'Client capability not supported'} });
        continue;
      }
      const job = this.pending.get(msg.id);
      if (!job) continue;
      this.pending.delete(msg.id); clearTimeout(job.timer);
      if (msg.error) job.reject(error('OFFICIAL_RPC', '官方工具返回错误：' + String(msg.error.message || '未知错误').slice(0,1200) + '。请核对参数；修改操作勿直接重试。'));
      else if (!Object.prototype.hasOwnProperty.call(msg, 'result')) job.reject(error('OFFICIAL_PROTOCOL', '官方响应缺少结果，请核对版本。'));
      else job.resolve(msg.result);
    }
  }
  send(message) { if (!this.closed) this.child.stdin.write(JSON.stringify(message) + LF); }
  request(method, params, timeout=15000) {
    if (this.closed) return Promise.reject(error('OFFICIAL_EXIT', 'Router 连接已结束，请重新检测连接。'));
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => this.abort(error('OFFICIAL_WAIT', '等待官方 Router 超时。若已提交操作，其结果未知；请先检查 Rhino 模型，不要自动重试。')), timeout);
      this.pending.set(id, {resolve,reject,timer});
      try { this.send({jsonrpc:'2.0',id,method,params}); }
      catch { this.abort(error('OFFICIAL_PIPE', '无法发送请求；操作结果可能未知，请检查 Rhino。')); }
    });
  }
  abort(reason) {
    if (this.closed) return;
    this.closed = true;
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(reason); }
    this.pending.clear(); this.child.kill();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 1500);
    this.child.once('exit', () => clearTimeout(timer));
    timer.unref?.();
  }
  async initialize() {
    const init = await this.request('initialize', {protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'cindy-rhino-bridge',version:'0.2.4'}});
    if (!['2024-11-05','2025-03-26','2025-06-18'].includes(init?.protocolVersion) || !init?.capabilities?.tools) throw error('OFFICIAL_PROTOCOL', '官方 Router 的 MCP 版本或工具能力不受当前插件支持，请核对版本。');
    this.send({jsonrpc:'2.0',method:'notifications/initialized'});
    return init;
  }
  async tools() {
    let cursor, all=[], seen=new Set();
    for (let page=0;page<32;page++) {
      const result = await this.request('tools/list', cursor ? {cursor} : {});
      if (!Array.isArray(result?.tools)) throw error('OFFICIAL_PROTOCOL', '官方工具列表格式不匹配，请核对版本。');
      all.push(...result.tools);
      if (all.length > 1500) throw error('OFFICIAL_SIZE', '官方工具列表过大，当前插件无法处理。');
      if (!result.nextCursor) return all.filter(usable);
      if (seen.has(result.nextCursor)) throw error('OFFICIAL_PROTOCOL', '官方工具列表分页循环，请更新 Router。');
      seen.add(result.nextCursor); cursor=result.nextCursor;
    }
    throw error('OFFICIAL_SIZE', '工具列表分页过多，请核对 Router。');
  }
}
function inspectResult(mcp) {
  if (!mcp || !Array.isArray(mcp.content)) throw error('OFFICIAL_PROTOCOL', '官方工具结果格式无效；修改操作请先核对模型。');
  let failed=!!mcp.isError;
  const content=[];
  function collect(blocks,depth=0) {
    for (const block of blocks) {
      if (block.type === 'text') {
        let v;
        try { v=JSON.parse(block.text); } catch {}
        if (v && typeof v==='object') {
          if (v.error || v.Error || v.payload?.error || v.payload?.Error || v.isError) failed=true;
          // Router wrappers can return a serialized CallToolResult as a text block.
          if (depth<3 && Array.isArray(v.content)) { collect(v.content,depth+1); continue; }
        }
      }
      content.push(block);
    }
  }
  collect(mcp.content);
  return {ok:!failed,backend:'official',mcp:{...mcp,content,isError:failed}, ...(failed ? {code:'OFFICIAL_TOOL',message:'官方工具报告执行失败，请读取返回详情并核对 Rhino 模型；不要自动重复修改。'} : {})};
}
async function execute(router, operation, args={}) {
  const init = await router.initialize();
  const tools = await router.tools();
  if (operation === 'list') {
    const offset=args.offset ?? 0, limit=args.limit ?? 15;
    if (!Number.isInteger(offset) || offset<0 || !Number.isInteger(limit) || limit<1 || limit>30) throw error('OFFICIAL_ARGS','分页参数无效，limit 须为 1–30。');
    const filtered = args.name ? tools.filter(t=>t.name===args.name) : tools;
    return {ok:true,backend:'official',server:init.serverInfo,tools:filtered.slice(offset,offset+limit),total:filtered.length,next_offset:offset+limit<filtered.length?offset+limit:null};
  }
  if (operation === 'status') {
    if (!tools.some(t=>t.name==='list_slots')) throw error('OFFICIAL_VERSION','官方 Router 未提供 list_slots，请更新官方插件。');
    const result=inspectResult(await router.request('tools/call',{name:'list_slots',arguments:{}}));
    return {...result,server:init.serverInfo,tool_count:tools.length,note:'Router 已连接；请从 list_slots 结果确认 Rhino 实例，工具数量不代表所有版本都可执行。'};
  }
  if (operation !== 'call') throw error('OFFICIAL_ARGS','不支持此官方操作。');
  const tool=tools.find(t=>t.name===args.name);
  if (!tool) throw error('OFFICIAL_TOOL_UNAVAILABLE','该工具未在当前官方目录中，或当前插件未开放。请先读取工具列表。');
  const input=args.arguments ?? {};
  if (!input || typeof input!=='object' || Array.isArray(input)) throw error('OFFICIAL_ARGS','arguments 必须是对象。');
  if (args.name!=='list_slots' && (typeof input.slot!=='string' || !input.slot.trim())) throw error('OFFICIAL_SLOT','请先调用 list_slots，使用明确的 slot；插件不会自动启动 Rhino。');
  for (const key of tool.inputSchema?.required || []) if (!Object.prototype.hasOwnProperty.call(input,key)) throw error('OFFICIAL_ARGS','缺少官方工具参数：'+key+'，请读取该工具的实时 schema。');
  if (Buffer.byteLength(JSON.stringify(input))>200000) throw error('OFFICIAL_SIZE','调用参数过大，请减少脚本或对象数量。');
  return inspectResult(await router.request('tools/call',{name:args.name,arguments:input},65000));
}
async function officialRequest(params) {
  let router;
  try {
    const cfg=validateConfig(params?.config);
    // A fixed native executable, never a shell command, no user-controlled argv.
    const child=spawn(cfg.file,['--default-version',cfg.version],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    router=new Router(child);
    return await execute(router,params.operation,params.args);
  } catch(e) { return {ok:false,code:e.code?.startsWith('OFFICIAL_')?e.code:'OFFICIAL_CONFIG',message:e.code?.startsWith('OFFICIAL_')?e.message:'官方 Router 未能启动，请安装官方插件并核对 MCPConnect 返回的可执行文件路径。'}; }
  finally { router?.close(); }
}
module.exports={Router,execute,inspectResult,usable,validateConfig,officialRequest};
