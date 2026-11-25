const tools = {
  artifact: 'Artifact',
  artifact_data: 'ArtifactData',
  artifact_comments: 'ArtifactComments',
};
const writeActions = {
  artifact: new Set(['publish', 'call', 'delete']),
  artifact_data: new Set(['set', 'update', 'delete', 'str_replace', 'batch']),
  artifact_comments: new Set(['reply', 'resolve', 'reopen']),
};
let ownerScope;

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
  let answer = method === 'artifact/wake' ? 'failed' : false;
  try {
    if (method === 'artifact/open') {
      // The Node worker checks the attached task before sending this event.
      if (typeof session === 'string' && session) {
        const opened = await cindy.preview({ url, sessionId: session, reuseExisting: true });
        answer = opened?.ok === true;
      }
    } else if (method === 'artifact/confirm-adopt') {
      const target = await cindy.targets.resolve({ session });
      if (target?.kind === 'task' && target.id === session) {
        const title = params.title.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, 70) || 'Untitled work';
        const destination = session.slice(0, 64);
        const previous = params.owner?.replace(/^cindy:/, '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, 64);
        const action = previous ? `Transfer “${title}” from task ${previous} to task ${destination}?` : `Adopt “${title}” into task ${destination}?`;
        const consent = await cindy.confirm({
          body: `${action} New comments and edit requests will go to that task.`,
          danger: params.owner !== null,
        });
        if (consent?.ok === true && consent.confirmed === true) {
          const current = await cindy.targets.resolve({ session });
          answer = current?.kind === 'task' && current.id === session;
        }
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
      (msg.method === 'artifact/open' || msg.method === 'artifact/wake' || msg.method === 'artifact/confirm-adopt')) {
    await answerHost(msg).catch(() => {});
    return;
  }
  if (msg.type !== 'tool-call' || !Object.hasOwn(tools, msg.tool)) return;
  const { session_context: ctx, ...args } = msg.args ?? {};
  const reply = data => cindy.send({ type: 'tool-result', callId: msg.callId, ...data });
  const cloudPublication = msg.tool === 'artifact' && args.action === 'share' && args.cloud !== undefined;
  const action = msg.tool === 'artifact' ? args.action ?? 'publish' : args.action;
  const statusField = cloudPublication ? 'publicationStatus' :
    writeActions[msg.tool].has(action) ? 'executionStatus' : undefined;
  if (!ctx?.session_id || !ctx.workdir_is_local || !ctx.workdir || ctx.workdir_is_read_only) {
    await reply({
      ok: false, errorCode: 'LOCAL_WORKSPACE_REQUIRED', message: 'Open Artifact needs a writable local task workspace.',
      ...(statusField ? { result: { [statusField]: 'not_executed' } } : {}),
    });
    return;
  }
  const session = ctx.session_id;
  const longWait = msg.tool === 'artifact_comments' && args.action === 'wait';
  const progress = longWait ? setInterval(() => {
    void cindy.send({ type: 'tool-progress', callId: msg.callId }).catch(() => {});
  }, 45000) : undefined;
  let result;
  let forwarded = false;
  try {
    const scope = await getScope();
    forwarded = true;
    result = await request('artifact/call', {
      scope, session, workspace: ctx.workdir, tool: tools[msg.tool], args, statusField,
    }, longWait ? { timeoutMs: 120000, maxTotalMs: 630000 } : { timeoutMs: 120000 });
  } catch {
    result = null;
  } finally {
    if (progress !== undefined) clearInterval(progress);
  }
  const output = result?.ok ? result.result : undefined;
  const pending = output?.messages ?? result?.data?.messages;
  const feedback = Array.isArray(pending) && pending.length ? { messages: pending } : {};
  if (statusField) {
    const prefix = cloudPublication ? 'ARTIFACT_SHARE' : 'ARTIFACT_WRITE';
    const cloud = output?.cloud;
    const confirmed = output && typeof output === 'object' && !Array.isArray(output) && !output.error &&
      (!cloudPublication || (cloud?.remote === args.cloud && typeof cloud?.view_url === 'string' && cloud.view_url));
    if (confirmed) {
      await reply({ ok: true, result: { ...output, [statusField]: cloudPublication ? 'published' : 'completed' } });
    } else if (!forwarded || result?.data?.[statusField] === 'not_executed') {
      await reply({
        ok: false, errorCode: `${prefix}_NOT_EXECUTED`,
        message: result?.message ?? (cloudPublication ? 'Open Artifact could not start the cloud publication.' : 'Open Artifact could not start the write.'),
        result: { ...feedback, [statusField]: 'not_executed' },
      });
    } else if (msg.tool === 'artifact' && action === 'publish' && args.url &&
        output?.error?.code === 'conflict' && output.url === args.url && output.current) {
      // The bundled file writer checks every precondition before writing any file.
      await reply({
        ok: false, errorCode: 'OPEN_ARTIFACT_ERROR', message: output.error.message,
        result: { ...output, executionStatus: 'not_executed' },
      });
    } else {
      await reply({
        ok: false, errorCode: `${prefix}_UNKNOWN`,
        message: cloudPublication
          ? 'The artifact may have been published. Check the remote or the Share panel before trying again.'
          : 'The write may have completed. Check the artifact or the remote before trying again.',
        result: { ...feedback, [statusField]: 'unknown' },
      });
    }
    return;
  }
  if (!result?.ok) {
    await reply({
      ok: false, errorCode: 'ARTIFACT_CALL_FAILED', message: result?.message ?? 'Open Artifact could not complete the request.',
      ...(feedback.messages ? { result: feedback } : {}),
    });
    return;
  }
  if (output?.error && Object.keys(output).filter(key => key !== 'messages').length === 1) {
    const message = typeof output.error === 'string' ? output.error : output.error.message;
    await reply({ ok: false, errorCode: 'OPEN_ARTIFACT_ERROR', message: message ?? 'Open Artifact rejected the request.', result: output });
    return;
  }
  await reply({ ok: true, result: output });
});
