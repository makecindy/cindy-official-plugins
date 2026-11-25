const tools = {
  artifact: 'Artifact',
  artifact_data: 'ArtifactData',
  artifact_comments: 'ArtifactComments',
};
let ownerScope;
const pendingToolSession = new Map();

function getScope() {
  ownerScope ??= (async () => {
    const response = await fetch('/kv');
    if (!response.ok) throw new Error('Could not read plugin storage.');
    const saved = await response.json();
    if (saved.runtimeScope) return saved.runtimeScope;
    const runtimeScope = crypto.randomUUID();
    const written = await fetch('/kv', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...saved, runtimeScope }),
    });
    if (!written.ok) throw new Error('Could not initialize plugin storage.');
    return runtimeScope;
  })().catch(error => {
    ownerScope = undefined;
    throw error;
  });
  return ownerScope;
}

function request(method, params, options = {}) {
  return cindy.node.request({ method, params, ...options });
}

async function answerHost({ method, params }) {
  const { id, session, url, text, requestKey } = params;
  let answer = method === 'artifact/open' ? false : 'failed';
  try {
    if (method === 'artifact/open') {
      if (pendingToolSession.has(session)) {
        const opened = await cindy.preview({ url, sessionId: session, reuseExisting: true });
        answer = opened?.ok === true;
      }
    } else {
      const target = await cindy.targets.resolve({ session });
      if (target?.kind === 'task' && target.id === session) {
        const result = await cindy.targets.send({
          target: { kind: 'task', id: session }, requestKey, text, delivery: 'queue',
        });
        if (result?.accepted === true) answer = 'queued';
      }
    }
  } finally {
    await request('host/complete', { id, answer });
  }
}

cindy.onHostMessage(async msg => {
  if (msg.type === 'event' && msg.name === 'node-notification' &&
      (msg.method === 'artifact/open' || msg.method === 'artifact/wake')) {
    await answerHost(msg).catch(() => {});
    return;
  }
  if (msg.type !== 'tool-call' || !Object.hasOwn(tools, msg.tool)) return;
  const { session_context: ctx, ...args } = msg.args ?? {};
  const reply = data => cindy.send({ type: 'tool-result', callId: msg.callId, ...data });
  if (!ctx?.session_id || !ctx.workdir_is_local || !ctx.workdir || ctx.workdir_is_read_only) {
    await reply({ ok: false, errorCode: 'LOCAL_WORKSPACE_REQUIRED', message: 'Open Artifact needs a writable local task workspace.' });
    return;
  }
  const session = ctx.session_id;
  pendingToolSession.set(session, (pendingToolSession.get(session) ?? 0) + 1);
  const longWait = msg.tool === 'artifact_comments' && args.action === 'wait';
  const progress = longWait ? setInterval(() => {
    void cindy.send({ type: 'tool-progress', callId: msg.callId }).catch(() => {});
  }, 45000) : undefined;
  let result;
  try {
    result = await request('artifact/call', {
      scope: await getScope(), session, workspace: ctx.workdir, tool: tools[msg.tool], args,
    }, longWait ? { timeoutMs: 120000, maxTotalMs: 630000 } : { timeoutMs: 120000 });
  } catch {
    result = null;
  } finally {
    if (progress !== undefined) clearInterval(progress);
    const count = pendingToolSession.get(session) - 1;
    if (count === 0) pendingToolSession.delete(session);
    else pendingToolSession.set(session, count);
  }
  if (!result?.ok) {
    await reply({ ok: false, errorCode: 'ARTIFACT_CALL_FAILED', message: result?.message ?? 'Open Artifact could not complete the request.' });
    return;
  }
  const output = result.result;
  if (output?.error && Object.keys(output).filter(key => key !== 'messages').length === 1) {
    const message = typeof output.error === 'string' ? output.error : output.error.message;
    await reply({ ok: false, errorCode: 'OPEN_ARTIFACT_ERROR', message: message ?? 'Open Artifact rejected the request.', result: output });
    return;
  }
  await reply({ ok: true, result: output });
});
