/* global cindy */
// Generated plugin-local bridge. Existing named tools remain compatibility-only.
async function selectGoogleAccount(accountId) {
  var listed = await listAccounts();
  if (!listed.ok) return listed;
  var accounts = listed.result.accounts;
  if (accountId === undefined && accounts.length !== 1) {
    return fail('尚未执行：已连接多个账号，请明确选择账号并传入 account。');
  }
  var account = accountId === undefined ? accounts[0] : accounts.find(function (item) { return item.id === accountId; });
  if (!account) return fail('尚未执行：指定账号不存在，请重新选择账号；不会切换到其他账号。');
  if (account.status !== 'connected') {
    return fail('尚未执行：账号 ' + (account.email || account.id) + ' 授权已失效或权限不足，请到插件详情页重新连接此账号。');
  }
  return { ok: true, accountId: account.id };
}
(function () {
  var PREFIX = '__TOOL_PREFIX__';
  cindy.onHostMessage(async function (message) {
    if (!message || message.type !== 'tool-call') return;
    if (message.tool !== PREFIX + '_schema' && message.tool !== PREFIX + '_run') return;
    var args = message.args || {};
    var isSchema = message.tool === PREFIX + '_schema';
    var context = args.session_context;
    try {
      if (!isSchema) {
        var selected = await selectGoogleAccount(args.account);
        if (!selected.ok) {
          await cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: selected.message });
          return;
        }
        args = Object.assign({}, args, { account: selected.accountId });
      }
      if (!isSchema && !context) throw new Error('This operation requires a Cindy version with plugin session context.');
      var response = await cindy.node.request({
        method: isSchema ? 'schema' : 'run',
        authAccount: args.account,
        params: {
          command: args.command || [], arguments: args.arguments || [], options: args.options || {},
          workdir: context && context.workdir_is_local === true ? context.workdir : undefined,
          readOnly: !context || context.workdir_is_read_only !== false,
        },
        timeoutMs: 120000,
      });
      if (!response || !response.ok) {
        // Broker timeouts/process exits cannot prove an upstream mutation failed.
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
          message: 'Execution outcome unknown; do not retry a write before checking. ' + (response && response.message || 'Worker unavailable') });
        return;
      }
      var result = response.result;
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: !!result.ok,
        ...(result.ok ? { result: result.data } : { message: '[' + result.execution + '] ' + result.message }) });
    } catch (_error) {
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
        message: 'Unable to complete Google operation. If execution started, check the result before retrying.' });
    }
  });
})();
