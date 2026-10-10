'use strict';

const TOOL_NAMES = new Set([
  'flight_search', 'train_search', 'hotel_search', 'scenery_search',
  'bus_search', 'travel_search', 'traffic_search'
]);

cindy.onHostMessage(async function (msg) {
  if (msg.type !== 'tool-call' || !TOOL_NAMES.has(msg.tool)) return;
  let reply;
  try {
    if (!cindy.node || typeof cindy.node.request !== 'function') {
      reply = { ok: false, errorCode: 'TONGCHENG_RUNTIME_UNAVAILABLE', message: '当前 Cindy 不支持此插件的 Node 查询，请升级 Cindy 后重试。' };
    } else {
      const response = await cindy.node.request({
        method: 'tools/call', callId: msg.callId, cancelWithCall: true,
        timeoutMs: 25000,
        params: { name: msg.tool, arguments: msg.args || {} }
      });
      reply = response && response.ok
        ? { ok: true, result: response.result }
        : { ok: false, errorCode: 'TONGCHENG_REQUEST_FAILED', message: response && response.message || '同程查询未完成，请检查插件配置和网络后重试。' };
    }
  } catch {
    // Do not forward raw Host exceptions, which may contain request details.
    reply = { ok: false, errorCode: 'TONGCHENG_REQUEST_FAILED', message: '同程查询连接失败或超时，请检查网络连接后重试。' };
  }
  await cindy.send({ type: 'tool-result', callId: msg.callId, ...reply });
});
