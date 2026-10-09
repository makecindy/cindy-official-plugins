'use strict';

const TOOL_NAMES = new Set([
  'flight_search', 'train_search', 'hotel_search', 'scenery_search',
  'bus_search', 'travel_search', 'traffic_search'
]);

cindy.onHostMessage(async function (msg) {
  if (msg.type !== 'tool-call' || !TOOL_NAMES.has(msg.tool)) return;
  const response = await cindy.node.request({
    method: 'tools/call',
    callId: msg.callId,
    cancelWithCall: true,
    timeoutMs: 25000,
    params: { name: msg.tool, arguments: msg.args || {} }
  });
  if (!response.ok) {
    await cindy.send({ type: 'tool-result', callId: msg.callId, ok: false, errorCode: 'TONGCHENG_REQUEST_FAILED', message: response.message });
    return;
  }
  await cindy.send({ type: 'tool-result', callId: msg.callId, ok: true, result: response.result });
});
