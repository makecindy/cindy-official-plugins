'use strict';
const $ = selector => document.querySelector(selector);
let slots = [], selected = 0, assetSlot = null, dragged = null, placement = null, assetRequest = 0;
let pointer = { x: 0, y: 0 }, hintTimer;
const { layout, geometry, slicePath, polar, normalizedAngle } = EmoteWheel;
const strings = {
  'zh-CN': {
    title: 'Cindy Ping', enable: '启用', intro: '每次表情立即出现。绑定任务后，最后一次触发满 2 秒才开始取材和执行。',
    palette: '轮盘快捷键', refresh: '刷新', record: '录制快捷键', recording: '请按下组合键…', preparing: '准备录制…',
    shortcutHint: '可录制单键、修饰键或组合键，选择后立即生效。Esc 取消录制。',
    gesture: '按住快捷键，移向表情，松键发送',
    SHORTCUT_INVALID: '请选择单键、修饰键或组合键；Esc 用于取消。',
    scope: '支持 macOS 14+。每个表情可独立选择模型、新建任务或绑定本插件已有任务；项目与权限沿用插件任务设置。',
    recovery: '上一条任务的结果尚未确认，自动投递已暂停。请到 Cindy 查看下方任务；确认后可恢复。不会自动重发旧内容。',
    reviewed: '已检查旧任务，恢复', emotes: '轮盘表情 · 从上方顺时针', add: '＋ 添加', permissions: '输入与窗口取材权限',
    permissionHint: '使用 Cindy 已有的系统权限，不单独申请授权。辅助功能用于全局快捷键和读取窗口文本；屏幕录制仅用于任务截图。只展示不会取材。',
    INPUT_ACCESS_REQUIRED: '暂时无法使用 Cindy 的辅助功能权限。请确认 Cindy 版本支持权限复用，在插件详情停用后重新启用，再刷新状态。本插件不会另行申请授权。',
    INPUT_HOOK_FAILED: '轮盘输入未能启动。请在插件详情停用后重新启用，再刷新状态。',
    accessibility: '辅助功能', screen: '屏幕录制', tasks: '刷新可选任务', save: '保存并应用',
    none: '只展示表情', undo: '撤销', new: '新建任务', existing: '继续本插件的任务', remove: '移除', image: '选择图片', clearImage: '使用 emoji',
    imageHint: '引用本地图片，请保留原文件', name: '表情名称', prompt: '固定指令', promptPlaceholder: '填写你自己的指令',
    screenshot: '附上目标窗口截图', target: '选择任务', choose: '先刷新并选择任务', missing: '所选任务未在当前列表，保存时保留原绑定',
    unsaved: '有未保存的修改', saved: '已保存', loading: '正在连接…', enabled: '快捷键已启用', disabled: '尚未启用',
    displayed: '表情已显示，没有后续行为', undone: '已撤销上一条待执行动作', undoUnavailable: '当前没有可撤销的动作', waiting: '表情已显示，等待最后一次触发满 2 秒', capturing: '正在获取目标窗口内容',
    sent: '已交给 Cindy 任务', configured: '配置已生效', idle: '准备就绪', error: '需要处理', granted: '已可用，无需授权', denied: '系统尚未允许', unknown: '尚未检查',
    newLabel: '新表情',
    imageUnavailable: '部分图片无法读取，当前使用 emoji。请重新选择图片。', hotkeyConflict: '快捷键被其他应用占用。请解除占用后重新保存。',
    tasksReady: '任务列表已更新', noTasks: '还没有本插件创建的任务。先用一个表情新建任务。',
    TARGETS_UNSUPPORTED: '当前 Cindy 尚未提供项目、任务和伙伴接口，请更新支持这些功能的版本；原有绑定保留。',
    TARGET_LIST_TOO_LARGE: '目标列表超过桌面选择器容量，本次没有投递。',
    TARGET_UNAVAILABLE: '目标已不可用，请重新选择，不会自动投递到其他位置。',
    DELIVERY_UNCERTAIN: '上次投递结果未知，请先到 Cindy 检查，不会自动重发。',
    DELIVERY_REJECTED: 'Cindy 拒绝了本次输入，没有排队或自动重试。',
    ATTACHMENTS_UNSUPPORTED: '当前 Cindy 不支持消息图片附件，请更新支持此能力的客户端后再试。',
    INVALID_ATTACHMENTS: '截图格式或大小不符合要求，本次没有投递。',
    CONTEXT_TOO_LARGE: '指令与窗口来源信息过长，本次没有投递。请缩短表情指令后再试。',
    REQUEST_KEY_CONFLICT: '本次投递参数已改变，请重新发出表情。',
    CONFIG_INVALID: '请补全表情名称、内容，以及任务的固定指令和目标。', MACOS_REQUIRED: '第一版仅支持 macOS 14+。',
    HELPER_START_FAILED: '桌面进程未能启动。请确认系统为 macOS 14+，重新保存设置。', HELPER_STOPPED: '桌面进程已停止，请重新保存设置启动。',
    CAPTURE_TIMEOUT: '读取窗口超时，桌面进程已停止。请重新保存设置后再试。', CAPTURE_BUSY: '上一次窗口读取尚未结束，请稍后重新发表情。',
    NO_CONTENT: '没有取得窗口内容。请检查采集权限和目标窗口，再重新发表情。', TASK_DIRECTORY_MISSING: '目标任务没有可用的本地目录，请检查插件的任务设置。',
    SUPERSEDED: '已丢弃，新的表情操作已取代这次操作。', PERMISSION_DENIED: 'Cindy 未允许任务操作，请检查插件任务权限。表情展示仍可使用。',
    TASK_UNAVAILABLE: '绑定任务已不可用，请选择仍活跃的本插件任务。', TASKS_UNSUPPORTED: '当前客户端未提供可用的普通任务接口；请先使用「只展示表情」。',
    MODELS_UNSUPPORTED: '当前客户端不支持单独选择任务模型。请更新 Cindy，或选择沿用默认模型。',
    MODEL_UNAVAILABLE: '所选模型、推理强度或 Fast 已不可用。请刷新模型列表并重新选择，不会自动切换到其他模型。',
    TASK_BUSY: '任务或附件服务正忙，本次投递尚未确认。请先检查 Cindy 中的任务状态。',
    STALE_REVISION: '任务配置已变化，本次未投递。请检查任务后重新发表情。',
    HOST_NOT_READY: 'Cindy 的任务服务暂未就绪。请检查任务状态后再试。',
    CHECK_PREVIOUS_TASK: '上一条任务尚未确认停止或结果未知。请先到 Cindy 检查，再点击恢复。',
    LOCAL_OPERATION_FAILED: '本地操作未完成，请检查图片和任务目录后重试。', SAVE_FAILED: '设置未能保存，请重新打开插件详情页再试。',
    CONFIG_TOO_LARGE: '配置太长，请缩短固定指令后再保存。', OPERATION_FAILED: '操作未能确认完成。请查看 Cindy 中的任务和模型设置，不要重复投递同一内容。',
    CONNECTION_TIMEOUT: '未能连接插件后台，请重新打开插件详情页再试。',
  },
  en: {
    title: 'Cindy Ping', enable: 'Enable', intro: 'Every emote appears immediately. A bound task starts capturing and processing 2 seconds after the last trigger.',
    palette: 'Wheel shortcut', refresh: 'Refresh', record: 'Record shortcut', recording: 'Press a shortcut…', preparing: 'Preparing…',
    shortcutHint: 'Record a single key, modifier or combination. Changes apply immediately. Esc cancels recording.',
    gesture: 'Hold shortcut, move to an emote, release to send',
    SHORTCUT_INVALID: 'Choose a single key, modifier or combination. Esc is reserved for cancelling.',
    scope: 'macOS 14+. Choose a model and a new or existing plugin task for each emote. Project and permissions follow plugin Task settings.',
    recovery: 'The previous task has an unconfirmed outcome. Automatic delivery is paused. Inspect the task in Cindy, then resume. Old content is never automatically resent.',
    reviewed: 'I checked the task — resume', emotes: 'Wheel · clockwise from top', add: '+ Add', permissions: 'Input and window capture permissions',
    permissionHint: 'Uses Cindy\'s existing system permissions without requesting separate access. Accessibility handles wheel drags and window text; screen recording is only for task screenshots. Display-only never captures content.',
    INPUT_ACCESS_REQUIRED: 'Cindy\'s Accessibility access is unavailable. Check that Cindy supports permission sharing, disable and re-enable this plugin in its details, then refresh. This plugin will not request separate access.',
    INPUT_HOOK_FAILED: 'Wheel input could not start. Disable and re-enable the plugin in its details, then refresh.',
    accessibility: 'Accessibility', screen: 'Screen recording', tasks: 'Refresh tasks', save: 'Save and apply',
    none: 'Display only', undo: 'Undo', new: 'Create task', existing: 'Continue a plugin task', remove: 'Remove', image: 'Choose image', clearImage: 'Use emoji',
    imageHint: 'References a local image; keep the original file', name: 'Emote name', prompt: 'Fixed prompt', promptPlaceholder: 'Write your own instructions',
    screenshot: 'Include target window screenshot', target: 'Task', choose: 'Refresh and choose a task', missing: 'Selected task is not in this page; its binding is retained',
    unsaved: 'Unsaved changes', saved: 'Saved', loading: 'Connecting…', enabled: 'Shortcuts enabled', disabled: 'Not enabled',
    displayed: 'Emote displayed; no further action', undone: 'Previous pending action undone', undoUnavailable: 'No action available to undo', waiting: 'Emote displayed; waiting 2 seconds after the last trigger', capturing: 'Capturing target window',
    sent: 'Delivered to a Cindy task', configured: 'Settings applied', idle: 'Ready', error: 'Action needed', granted: 'Available; no authorization needed', denied: 'Not allowed by macOS', unknown: 'Not checked',
    newLabel: 'New emote',
    imageUnavailable: 'Some images could not be read; using emoji. Choose the image again.', hotkeyConflict: 'Another app is using a shortcut. Release it and save again.',
    tasksReady: 'Task list refreshed', noTasks: 'No plugin tasks yet. Use an emote to create one first.',
    TARGETS_UNSUPPORTED: 'Update Cindy to a version that supports project, task and companion destinations. Existing bindings are retained.',
    TARGET_LIST_TOO_LARGE: 'The destination list exceeds the desktop picker capacity. Nothing was delivered.',
    TARGET_UNAVAILABLE: 'The target is unavailable. Choose it again; no replacement will be used automatically.',
    DELIVERY_UNCERTAIN: 'Previous delivery is uncertain. Check Cindy before trying again.',
    DELIVERY_REJECTED: 'Cindy declined this input; it was not queued or retried.',
    ATTACHMENTS_UNSUPPORTED: 'This Cindy version does not support message images. Update to a client with attachment support.',
    INVALID_ATTACHMENTS: 'The screenshot format or size is unsupported. Nothing was delivered.',
    CONTEXT_TOO_LARGE: 'The instruction and window metadata are too long. Shorten the emote instruction and retry.',
    REQUEST_KEY_CONFLICT: 'Delivery parameters changed. Send the emote again.',
    CONFIG_INVALID: 'Complete the name, emote, task prompt and target.', MACOS_REQUIRED: 'This version requires macOS 14+.',
    HELPER_START_FAILED: 'Desktop helper could not start. Check macOS 14+ and save again.', HELPER_STOPPED: 'Desktop helper stopped. Save settings to restart it.',
    CAPTURE_TIMEOUT: 'Window capture timed out and the helper stopped. Save settings and try again.', CAPTURE_BUSY: 'Previous capture is still running. Try another emote shortly.',
    NO_CONTENT: 'No window content captured. Check capture permissions and the target window, then trigger again.', TASK_DIRECTORY_MISSING: 'No local directory for this task. Check plugin Task settings.',
    SUPERSEDED: 'Discarded because a newer emote replaced this action.', PERMISSION_DENIED: 'Cindy did not allow task access. Check plugin task permissions; display-only still works.',
    TASK_UNAVAILABLE: 'The task is unavailable. Select an active task created by this plugin.', TASKS_UNSUPPORTED: 'This client does not offer the required task API. Use display-only for now.',
    MODELS_UNSUPPORTED: 'This client does not support per-task model selection. Update Cindy or inherit the default model.',
    MODEL_UNAVAILABLE: 'The model, effort or Fast option is unavailable. Refresh and choose again; models are never switched automatically.',
    TASK_BUSY: 'The task or attachment service is busy. Delivery is unconfirmed; check the task in Cindy first.',
    STALE_REVISION: 'Task settings changed; nothing was sent. Inspect the task before triggering again.',
    HOST_NOT_READY: 'Cindy task service is not ready. Check the task state before retrying.',
    CHECK_PREVIOUS_TASK: 'The previous input has not stopped or has an unknown outcome. Inspect it in Cindy before resuming.',
    LOCAL_OPERATION_FAILED: 'Local operation failed. Check the image and task directory before retrying.', SAVE_FAILED: 'Could not save settings. Reopen plugin details and try again.',
    CONFIG_TOO_LARGE: 'Configuration is too large. Shorten your prompts.', OPERATION_FAILED: 'Completion is unconfirmed. Check the task and model settings in Cindy; do not resend the same content.',
    CONNECTION_TIMEOUT: 'Could not connect to the plugin. Reopen plugin details and try again.',
  },
};
const modelStrings = {
  'zh-CN': { choose: '选择模型', search: '搜索模型或供应商', all: '全部', inherit: '沿用 Cindy 默认模型', keep: '保持任务当前模型', empty: '没有找到匹配的模型', hidden: '显示隐藏模型', hide: '收起隐藏模型', effort: '推理强度', refresh: '刷新模型', default: '默认', efforts: { none: '无', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极高' } },
  en: { choose: 'Choose a Model', search: 'Search models or providers', all: 'All', inherit: 'Use Cindy Defaults', keep: 'Keep Current Task Model', empty: 'No matching models', hidden: 'Show hidden models', hide: 'Hide hidden models', effort: 'Reasoning', refresh: 'Refresh models', default: 'Default', efforts: { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max', ultra: 'Ultra' } },
  ja: { choose: 'モデルを選択', search: 'モデル・プロバイダーを検索', all: 'すべて', inherit: 'Cindy の既定モデルを使う', keep: 'タスクの現在のモデルを維持', empty: '一致するモデルがありません', hidden: '非表示のモデルを表示', hide: '非表示のモデルを隠す', effort: '推論の強度', refresh: 'モデルを更新', default: '既定', efforts: { none: 'なし', minimal: '最小', low: '低', medium: '中', high: '高', xhigh: '非常に高い', max: '最大', ultra: '最高' } },
  ko: { choose: '모델 선택', search: '모델 또는 공급자 검색', all: '전체', inherit: 'Cindy 기본 모델 사용', keep: '작업의 현재 모델 유지', empty: '일치하는 모델이 없어요', hidden: '숨긴 모델 표시', hide: '숨긴 모델 접기', effort: '추론 강도', refresh: '모델 새로고침', default: '기본값', efforts: { none: '없음', minimal: '최소', low: '낮음', medium: '중간', high: '높음', xhigh: '매우 높음', max: '최대', ultra: '최고' } },
};
const M = key => (modelStrings[document.documentElement.lang] || modelStrings.en)[key];
const modelPicker = { open: false, query: '', engine: 'all', hidden: false, active: 0 };
const modelIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>';
const chevronIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
const modelCheck = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';
const pinIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-5 1-4 4v4l-2 2-5-5 2-2h4l4-4zM5 19l-3 3"/></svg>';
const deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>';
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function icon(emote) {
  const bundled = CindyPingLibrary.presets().some(item => item.imagePath === emote.imagePath);
  const source = bundled ? emote.imagePath : previews[emote.id];
  return source ? `<img src="${escapeText(source)}" alt="">` : escapeText(['❓', '？'].includes(emote.emoji) ? '?' : emote.emoji || '🖼️');
}
function showDeleteHint() {
  const hint = $('#delete-hint');
  clearTimeout(hintTimer); hint.hidden = false;
  hintTimer = setTimeout(() => { hint.hidden = true; }, 2800);
}
function arrange() {
  const current = slots[selected];
  layout(slots); selected = Math.max(0, slots.indexOf(current));
}
function wheelActionsMarkup(emote) {
  const pinAt = polar(70, emote.angle - 90 - 14), deleteAt = polar(70, emote.angle - 90 + 14);
  const pinned = emote.pinAngle !== null;
  return `<div class="wheel-slot-actions" role="group" aria-label="${escapeText(emote.label)} · ${L('位置操作', 'Position controls')}">
    <button data-wheel-action="pin" data-emote-id="${emote.id}" style="left:${pinAt[0] / 3.2}%;top:${pinAt[1] / 3.2}%" aria-label="${pinned ? L('取消 Pin 固定', 'Unpin position') : L('Pin 固定当前位置', 'Pin position')}" aria-pressed="${pinned}" title="${pinned ? L('取消 Pin', 'Unpin') : L('Pin 固定位置', 'Pin position')}">${pinIcon}</button>
    <button data-wheel-action="delete" data-emote-id="${emote.id}" style="left:${deleteAt[0] / 3.2}%;top:${deleteAt[1] / 3.2}%" aria-label="${L('删除当前表情', 'Delete emote')}" title="${slots.length <= 4 ? L('最少保留 4 个表情', 'Keep at least 4 emotes') : L('删除表情', 'Delete emote')}" aria-disabled="${slots.length <= 4}" ${slots.length <= 4 ? 'aria-describedby="delete-hint"' : ''}>${deleteIcon}</button>
    <span id="delete-hint" class="wheel-action-hint" role="status" hidden style="left:clamp(96px,${deleteAt[0] / 3.2}%,calc(100% - 96px));top:calc(${deleteAt[1] / 3.2}% + 20px)">${L('最少保留 4 个表情；可点击「更换表情」。', 'Keep at least 4 emotes. Use Change to replace one.')}</span>
  </div>`;
}
function wheelMarkup(active, preview = false, items = slots) {
  return `<svg viewBox="0 0 320 320" aria-hidden="true"><circle class="outer-ring" cx="160" cy="160" r="154"/>${items.map((emote, i) => `<path data-slice="${i}" class="slice ${emote.draft ? 'draft' : active === i ? 'active' : ''}" d="${slicePath(i, items)}"/>`).join('')}</svg>` +
    items.map((emote, i) => {
      const p = polar(103, emote.angle - 90), size = Math.min(48, 103 * geometry(i, items).gap * Math.PI / 180 * .8);
      const font = Math.min(['?', '❓', '？'].includes(emote.emoji) ? 34 : 27, size * .72);
      return `<button class="slot-btn ${emote.draft ? 'draft-slot' : ['?', '❓', '？'].includes(emote.emoji) ? 'question' : ''}" data-slot="${i}" data-emote-id="${emote.id}" style="left:${p[0] / 3.2}%;top:${p[1] / 3.2}%;width:${size / 3.2}%;height:${size / 3.2}%;font-size:calc(var(--wheel-size) * ${font / 320})" aria-label="${escapeText(emote.label)}${emote.pinAngle !== null ? L('，位置已固定', ', pinned') : ''}" ${preview || placement ? 'tabindex="-1"' : `draggable="${emote.pinAngle === null}"`}>${icon(emote)}${!preview && emote.pinAngle !== null ? `<span class="pin-badge">${pinIcon}</span>` : ''}</button>`;
    }).join('') + (!preview && !placement && items[active] ? wheelActionsMarkup(items[active]) : '') +
    (preview ? `<button class="center-preview" tabindex="-1">${L('取消', 'Cancel')}<span>${L('移向表情', 'Choose an emote')}</span></button>` : `<button class="center-preview center-add" aria-label="${placement ? L('取消添加', 'Cancel adding') : L('添加表情', 'Add emote')}" aria-pressed="${Boolean(placement)}" title="${placement ? L('移回中心取消', 'Return to the center to cancel') : L('点击或按住，选择添加位置', 'Click or hold to choose a position')}">${placement ? '×' : '+'}</button>`);
}
function renderPlacementFeedback() {
  const moving = Boolean(placement && !placement.locked);
  document.body.classList.toggle('placing-emote', moving);
  $('#placement-cursor').hidden = !moving;
  if (moving) {
    const at = placement.at;
    $('#placement-cursor').style.transform = `translate3d(${at.x + 14}px,${at.y + 16}px,0) rotate(-8deg)`;
  }
  $('#slot-count').textContent = `${slots.length}${L(' 个', '')}${placement?.items ? ' + 1' : ''}`;
  $('#placement-hint').textContent = !placement ? L('点击或按住 ＋，移动鼠标选择添加位置', 'Click or hold + and move to choose a position') : placement.locked ? L('已选好位置，选择要添加的表情', 'Position selected. Choose an emote') : placement.items ? (placement.pointerId === null ? L('单击放入此处 · 移回中心取消', 'Click to place · Return to center to cancel') : L('松开放入此处 · 移回中心取消', 'Release to place · Return to center to cancel')) : L('带着 ＋ 移向表情之间 · Esc 取消', 'Move + between emotes · Esc cancels');
  $('#editor').inert = Boolean(placement);
}
function renderWheel() {
  $('#wheel').innerHTML = wheelMarkup(placement ? null : selected, false, placement?.items || slots);
  $('#wheel').classList.toggle('is-placing', Boolean(placement));
  renderPlacementFeedback();
  renderValidation();
}
function beginPlacement(pointerId = null) {
  // Hit detection stays anchored to the original wheel, not its moving preview borders.
  const base = slots.map(emote => ({ ...emote }));
  const gaps = base.map((emote, i) => {
    const span = (i + 1 < base.length ? base[i + 1].angle : base[0].angle + 360) - emote.angle;
    return { start: emote.angle, span, angle: normalizedAngle(emote.angle + span / 2) };
  });
  placement = { pointerId, initialPress: true, moved: false, items: null, locked: false, base, gaps, gapIndex: -1, at: { ...pointer } };
  renderWheel();
}
function movePlacement(at) {
  if (!placement || placement.locked) return;
  placement.at = { ...at };
  const box = $('#wheel').getBoundingClientRect();
  const dx = at.x - box.x - box.width / 2, dy = at.y - box.y - box.height / 2;
  // Separate enter/exit radii keep hand jitter near the center from toggling the draft.
  const outsideCenter = Math.hypot(dx, dy) > box.width * (placement.items ? 44 : 56) / 320;
  const angle = normalizedAngle(Math.atan2(dy, dx) * 180 / Math.PI + 90);
  placement.moved ||= outsideCenter;
  const { gaps, gapIndex } = placement;
  let nextGap = outsideCenter ? gaps.findIndex(gap => normalizedAngle(angle - gap.start) < gap.span) : -1;
  if (outsideCenter && gapIndex !== -1) {
    const gap = gaps[gapIndex];
    const margin = Math.min(7, gap.span / 8, gaps[(gapIndex + gaps.length - 1) % gaps.length].span / 4, gaps[(gapIndex + 1) % gaps.length].span / 4);
    if (normalizedAngle(angle - gap.start + margin) <= gap.span + 2 * margin) nextGap = gapIndex;
  }
  if (nextGap !== gapIndex) {
    placement.gapIndex = nextGap;
    // Rebalance once for this gap, using the original snapshot rather than pointer angle.
    placement.items = nextGap === -1 ? null : layout([
      ...placement.base.map(emote => ({ ...emote })),
      { id: 'placement-preview', label: L('新表情位置', 'New emote position'), emoji: '+', angle: gaps[nextGap].angle, pinAngle: null, draft: true },
    ]);
    renderWheel();
  } else renderPlacementFeedback();
}
function cancelPlacement() {
  if (!placement) return;
  const id = placement.pointerId;
  placement = null;
  if (id !== null && $('#wheel').hasPointerCapture(id)) $('#wheel').releasePointerCapture(id);
  renderWheel();
}
function confirmPlacement() {
  if (!placement?.items) return;
  placement.locked = true; renderWheel(); openAssets();
}
function openAssets(emote = null) {
  assetSlot = emote; assetRequest++; renderLibrary();
  $('#asset-hint').textContent = emote
    ? L('仅更换表情图案，保留当前指令、任务绑定和位置。', 'Changes the image while keeping your prompt, task and position.')
    : L('新增表情默认只展示；行为和指令由你配置。', 'New emotes display only. Configure your own action and instructions.');
  $('#assets').showModal();
}
function chooseEmote(emoji, label, imagePath = '', preview = '') {
  if (!$('#assets').open) return;
  if (assetSlot) {
    Object.assign(assetSlot, { emoji, label, imagePath }); previews[assetSlot.id] = preview; selected = slots.indexOf(assetSlot);
  } else if (placement?.locked) {
    const id = crypto.randomUUID();
    slots = placement.items.map(emote => emote.draft ? { id, emoji, label, imagePath, action: 'none', prompt: '', taskId: '', screenshot: true, angle: emote.angle, pinAngle: null } : emote);
    selected = slots.findIndex(emote => emote.id === id); previews[id] = preview;
  } else return;
  assetRequest++; assetSlot = null; placement = null;
  $('#assets').close(); renderWheel(); renderEditor(); change();
}
$('#assets').addEventListener('close', () => { if (!$('#assets').open) { assetRequest++; assetSlot = null; cancelPlacement(); } });
document.addEventListener('pointerdown', event => {
  if (event.button !== 0 || placement?.locked) return;
  if (!placement && !event.target.closest('#wheel .center-add')) return;
  event.preventDefault(); event.stopPropagation();
  if (!placement) beginPlacement(event.pointerId);
  else { placement.pointerId = event.pointerId; placement.initialPress = false; }
  $('#wheel').setPointerCapture(event.pointerId);
  movePlacement({ x: event.clientX, y: event.clientY });
}, true);
document.addEventListener('pointerup', event => {
  if (!placement || placement.locked || placement.pointerId !== event.pointerId) return;
  event.preventDefault(); event.stopPropagation();
  movePlacement({ x: event.clientX, y: event.clientY });
  placement.pointerId = null;
  if ($('#wheel').hasPointerCapture(event.pointerId)) $('#wheel').releasePointerCapture(event.pointerId);
  if (placement.items) confirmPlacement();
  else if (placement.initialPress && !placement.moved) renderWheel();
  else cancelPlacement();
}, true);
$('#wheel').onpointercancel = cancelPlacement;
document.addEventListener('click', event => {
  if (placement && !event.target.closest('#assets')) { event.preventDefault(); event.stopPropagation(); }
}, true);
$('#wheel').onclick = event => {
  if (placement) return;
  const action = event.target.closest('[data-wheel-action]');
  if (action) {
    const index = slots.findIndex(emote => emote.id === action.dataset.emoteId);
    if (index === -1) return;
    const emote = slots[index]; selected = index;
    if (action.dataset.wheelAction === 'pin') {
      const pinned = emote.pinAngle !== null;
      emote.pinAngle = pinned ? null : emote.angle;
      if (pinned) arrange();
    } else {
      if (slots.length <= 4) { showDeleteHint(); return; }
      slots.splice(index, 1); selected = Math.min(index, slots.length - 1); arrange();
    }
    renderWheel(); renderEditor(); change();
    return;
  }
  const button = event.target.closest('[data-slot], [data-slice]');
  if (button) { selected = Number(button.dataset.slot ?? button.dataset.slice); renderWheel(); renderEditor(); }
  else if (event.target.closest('.center-add') && event.detail === 0) beginPlacement();
};
$('#wheel').ondragstart = event => {
  const button = event.target.closest('[data-slot]');
  if (placement || !button || slots[button.dataset.slot].pinAngle !== null) return event.preventDefault();
  dragged = slots[button.dataset.slot]; event.dataTransfer.setData('text/plain', dragged.id); event.dataTransfer.effectAllowed = 'move';
};
$('#wheel').ondragover = event => {
  if (!dragged) return;
  const button = event.target.closest('[data-slot], [data-slice]');
  if (!button) return;
  const index = Number(button.dataset.slot ?? button.dataset.slice);
  $('#wheel').querySelectorAll('.dragover').forEach(path => path.classList.remove('dragover'));
  if (slots[index].pinAngle !== null) return;
  event.preventDefault(); $(`#wheel [data-slice="${index}"]`).classList.add('dragover');
};
$('#wheel').ondrop = event => {
  const button = event.target.closest('[data-slot], [data-slice]'); if (!button || !dragged) return;
  event.preventDefault(); const target = slots[Number(button.dataset.slot ?? button.dataset.slice)];
  if (target.pinAngle !== null) return;
  [target.angle, dragged.angle] = [dragged.angle, target.angle]; slots.sort((a, b) => a.angle - b.angle);
  selected = slots.indexOf(dragged); dragged = null; renderWheel(); renderEditor(); change();
};
$('#wheel').ondragend = () => { dragged = null; renderWheel(); };
function renderLibrary() {
  const locale = T === strings['zh-CN'] ? 'zh-CN' : 'en';
  $('#asset-grid').innerHTML = CindyPingLibrary.presets(locale).map(preset => `<button data-asset="${preset.id}" title="${escapeText(preset.meaning)}" aria-label="${escapeText(preset.label + '：' + preset.meaning)}"><img src="${preset.imagePath}" alt=""><span>${escapeText(preset.label)}</span></button>`).join('');
}
$('#asset-grid').onclick = event => {
  const button = event.target.closest('[data-asset]'); if (!button) return;
  const preset = CindyPingLibrary.presets(T === strings['zh-CN'] ? 'zh-CN' : 'en').find(item => item.id === button.dataset.asset);
  if (preset) chooseEmote(preset.emoji, preset.label, preset.imagePath);
};

let config, configRevision, T = strings.en, taskList = [], previews = {}, shortcut, pendingKey;
let modelList = [], modelsLoaded = false, modelsLoading = false, modelsError = '', tasksLoaded = false, tasksLoading;
let targetSelectionRevision = 0, destinationPicker = null;
let editRevision = 0, appliedRevision = 0, saving = false, recording = false, recordingTimer;
const channel = new BroadcastChannel('cindy-ping-v1');
const pending = new Map();
const L = (zh, en) => T === strings['zh-CN'] ? zh : en;
function localize() {
  const labels = {
    '.keybar > div > span': [T.palette, T.palette],
    '#shortcut > span': ['更改快捷键', 'Change shortcut'],
    '.section-head h2': ['轮盘', 'Wheel'],
    '.section-hint': ['点击配置 · 拖动排序 · Pin 固定位置', 'Click to configure · Drag to reorder · Pin position'],
    '#retry': ['重试应用', 'Retry applying'], '#refresh': ['刷新状态', 'Refresh status'],
    '#recovery p': [T.recovery, T.recovery], '#reviewed': [T.reviewed, T.reviewed],
    '#assets h3': ['选择表情', 'Choose an emote'],
    '#custom-image': ['选择本地图片', 'Choose a local image'],
    '#assets .dialog-hint': ['本地图片引用原文件，请保留；内置表情随插件保存。', 'Keep the original local image file. Built-in emotes are included with the plugin.'],
    '#keys h3': [T.palette, T.palette], '#keys .dialog-intro': ['按下单键或组合键。', 'Press a key or a combination.'],
    '#keys .dialog-footer [data-close]': ['取消', 'Cancel'], '#use-key': ['使用此快捷键', 'Use shortcut'],
    '#gesture-hint': [T.gesture, T.gesture], '#permissions summary': [T.permissions, T.permissions],
    '#permission-hint': [T.permissionHint, T.permissionHint],
  };
  for (const [selector, values] of Object.entries(labels)) $(selector).textContent = L(...values);
  for (const [selector, values] of Object.entries({
    '#shortcut': ['更改轮盘快捷键', 'Change wheel shortcut'], '#wheel': ['可配置表情轮盘', 'Configurable emote wheel'],
    '#editor': ['当前表情设置', 'Selected emote settings'],
    '[data-close="assets"]': ['关闭表情选择', 'Close emote picker'], '[data-close="keys"]': ['关闭快捷键录制', 'Close shortcut recorder'],
  })) $(selector).setAttribute('aria-label', L(...values));
}
function rpc(action, params = {}) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CONNECTION_TIMEOUT')); }, action === 'pickImage' ? 125000 : 30000);
    pending.set(id, { resolve, reject, timer });
    channel.postMessage({ type: 'request', id, action, params });
  });
}
function feedback(message, error = false) {
  $('#feedback').textContent = message;
  $('#feedback').classList.toggle('error', error);
}
function report(error) {
  feedback(error.message === 'STALE_REVISION'
    ? L('配置已在别处更新，本次修改未保存。请重新打开设置。', 'Settings changed elsewhere. This edit was not saved. Reopen settings.')
    : T[error.message] || L('操作未完成，请重试。', 'Operation failed. Please retry.'), true);
}
channel.onmessage = event => {
  const message = event.data;
  if (message?.type === 'response' && pending.has(message.id)) {
    const entry = pending.get(message.id); pending.delete(message.id); clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result); else entry.reject(new Error(message.code));
  } else if (message?.type === 'status') renderOutcome(message.outcome);
  else if (message?.type === 'locale') {
    T = strings[message.locale] || strings.en;
    document.documentElement.lang = message.locale; localize();
    if (config) { renderWheel(); renderEditor(); renderLibrary(); }
  }
};
function draftConfig() { return { version: 2, emotes: slots, wheelShortcut: shortcut }; }
function emoteErrors(item) {
  const errors = {};
  if (!item.label.trim()) errors['emote-name'] = L('请填写名称', 'Enter a name');
  if (!(item.emoji.trim() || item.imagePath)) errors['change-emote'] = L('请选择表情', 'Choose an emote');
  if (!['none', 'undo'].includes(item.action) && !item.prompt.trim()) errors.prompt = L('填写指令后生效', 'Add a prompt to apply');
  if (item.action === 'existing' && !item.target && !item.taskId) errors['task-target'] = L('请选择任务', 'Choose a task');
  if (item.target && !(['pick', 'recent'].includes(item.target.mode) || item.target.ref?.id || item.target.bindingId)) {
    errors['destination-preset'] = L('请选择目标', 'Choose a destination');
  }
  return errors;
}
function renderValidation() {
  const errors = slots[selected] ? emoteErrors(slots[selected]) : {};
  document.querySelectorAll('[data-field-error]').forEach(hint => {
    const id = hint.dataset.fieldError, message = errors[id] || '';
    hint.textContent = message; hint.hidden = !message;
    const field = document.getElementById(id);
    if (message) { field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', hint.id); }
    else { field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby'); }
  });
  $('#wheel').querySelectorAll('[data-slot]').forEach(button => {
    const item = slots.find(emote => emote.id === button.dataset.emoteId);
    if (!item) return;
    const messages = Object.values(emoteErrors(item));
    button.classList.toggle('incomplete', messages.length > 0);
    const label = item.label + (item.pinAngle !== null ? L('，位置已固定', ', pinned') : '');
    button.setAttribute('aria-label', label + (messages.length ? ` · ${messages.join(' / ')}` : ''));
    button.title = messages.length ? messages.join(' / ') : '';
  });
}
function completeDraft() {
  return slots.every(item => Object.keys(emoteErrors(item)).length === 0);
}
function change() {
  editRevision++;
  $('#shortcut-label').textContent = EmoteShortcuts.label(shortcut);
  renderValidation();
  if (!completeDraft()) {
    if (!$('#feedback').classList.contains('error')) feedback('');
    return;
  }
  void applyChanges();
}
async function applyChanges() {
  if (saving || !config || !completeDraft()) return;
  saving = true;
  $('#retry').hidden = true;
  try {
    while (appliedRevision < editRevision && completeDraft()) {
      const revision = editRevision;
      const next = JSON.parse(JSON.stringify(draftConfig()));
      feedback(L('正在应用…', 'Applying…'));
      const result = await rpc('save', { config: next, revision: configRevision });
      appliedRevision = revision; config = result.config; configRevision = result.revision;
      if (revision === editRevision) {
        const selectedId = slots[selected]?.id;
        slots = config.emotes.map(saved => {
          // Preserve references held by input handlers and the target picker.
          const item = slots.find(item => item.id === saved.id);
          for (const key of Object.keys(item)) if (!(key in saved)) delete item[key];
          return Object.assign(item, saved);
        });
        selected = Math.max(0, slots.findIndex(item => item.id === selectedId));
        shortcut = config.wheelShortcut;
        $('#shortcut-label').textContent = EmoteShortcuts.label(shortcut);
        for (const [id, value] of [['#emote-name', slots[selected].label], ['#prompt', slots[selected].prompt]]) {
          const field = $(id);
          if (!field || field.value === value) continue;
          const cursor = document.activeElement === field ? [field.selectionStart, field.selectionEnd] : null;
          field.value = value;
          if (cursor) field.setSelectionRange(...cursor.map(position => Math.min(position, value.length)));
        }
        renderWheel(); renderValidation();
        applyStatus(result);
        if (result.outcome.issues?.includes('HOTKEY_CONFLICT')) {
          feedback(L('快捷键已被占用，请换一个键，或解除占用后重试。', 'Shortcut is in use. Choose another key or retry after releasing it.'), true);
          $('#retry').hidden = false;
        } else feedback('');
      }
    }
  } catch (error) { report(error); $('#retry').hidden = error.message === 'STALE_REVISION'; }
  finally { saving = false; }
}
function renderOutcome(value) {
  if (!value) return;
  $('#status-text').textContent = T[value.phase] || T.idle;
  if (value.phase === 'sent' && value.delivery) $('#status-text').textContent = value.delivery === 'steer'
    ? L('已插话，交给当前工作中的 AI', 'Inserted into the current work')
    : L('已进入队列，空闲时处理', 'Queued for processing when ready');
  $('#detail').textContent = value.code ? (T[value.code] || T.OPERATION_FAILED) : '';
  if (value.issues?.includes('INPUT_ACCESS_REQUIRED')) $('#detail').textContent = T.INPUT_ACCESS_REQUIRED;
  else if (value.issues?.includes('INPUT_HOOK_FAILED')) $('#detail').textContent = T.INPUT_HOOK_FAILED;
  else if (value.issues?.includes('HOTKEY_CONFLICT')) $('#detail').textContent = L('快捷键被占用，请更换或重试应用。', 'Shortcut is in use; change it or retry.');
  else if (value.issues?.includes('IMAGE_UNAVAILABLE')) $('#detail').textContent = T.imageUnavailable;
  $('#detail').classList.toggle('error', value.phase === 'error');
  if (value.phase === 'error' && value.code === 'CHECK_PREVIOUS_TASK') {
    $('#recovery').hidden = false; $('#pending-id').textContent = value.taskId || '';
  }
}
function applyStatus(value) {
  renderOutcome(value.outcome);
  if (['idle', 'configured'].includes(value.outcome.phase)) $('#status-text').textContent = value.native.enabled ? L('轮盘已就绪', 'Wheel ready') : L('轮盘尚未就绪', 'Wheel unavailable');
  const permissions = value.native.permissions || {};
  const label = value => value === true ? T.granted : value === false ? T.denied : T.unknown;
  $('#permission-status').textContent = `${T.accessibility}：${label(permissions.accessibility)} · ${T.screen}：${label(permissions.screenRecording)}`;
  $('#gesture-hint').textContent = T.gesture;
  $('#permissions summary').textContent = T.permissions;
  $('#permission-hint').textContent = T.permissionHint;
  const inputIssue = value.native.issues?.find(code => ['INPUT_ACCESS_REQUIRED', 'INPUT_HOOK_FAILED'].includes(code));
  $('#input-status').hidden = !inputIssue;
  $('#input-status').textContent = inputIssue ? T[inputIssue] : '';
  if (inputIssue) $('#permissions').open = true;
  $('#recovery').hidden = !value.needsReview;
  $('#pending-id').textContent = value.pending?.taskId || '';
}
function destinationPresets() {
  return [
    ['existing', 'recent', L('最近活跃的三个会话', 'Three recent conversations')],
    ['existing', 'pick', L('每次选择会话', 'Choose a conversation each time')],
    ['existing', 'fixed', L('指定会话', 'A specific conversation')],
    ['bot', 'recent', L('最近活跃的三个伙伴', 'Three recent companions')],
    ['bot', 'pick', L('每次选择伙伴', 'Choose a companion each time')],
    ['bot', 'fixed', L('指定伙伴', 'A specific companion')],
    ['new', 'pick', L('每次选择项目，新建会话', 'Choose a project for a new conversation')],
    ['new', 'fixed', L('指定项目，新建会话', 'A specific project for a new conversation')],
  ];
}
function targetFields(emote) {
  const value = destinationPicker?.emote === emote ? `${destinationPicker.action}:fixed` : `${emote.action}:${emote.target?.mode || 'legacy'}`;
  const options = destinationPresets();
  return `<div class="target-field"><label>${L('发送到', 'Send to')}<select id="destination-preset">${!emote.target ? `<option value="${emote.action}:legacy">${L('保留原有任务绑定', 'Keep the existing task binding')}</option>` : ''}${options.map(([action, mode, label]) => `<option value="${action}:${mode}" ${value === `${action}:${mode}` ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    ${emote.target?.mode === 'fixed' ? `<div class="target-binding"><span>${escapeText(emote.target.label || L('尚未选择', 'No destination'))}</span><button id="change-target" class="subtle">${L('更换', 'Change')}</button></div>` : ''}
    <span id="destination-preset-error" class="field-error" data-field-error="destination-preset" hidden></span>
    <section id="target-chooser" class="target-chooser" aria-label="${L('选择目标', 'Choose destination')}" hidden></section></div>`;
}
function renderTargetPicker() {
  const pane = $('#target-chooser'), picker = destinationPicker;
  if (!pane || !picker || picker.emote !== slots[selected]) return;
  pane.hidden = false;
  pane.innerHTML = `<div class="chooser-head"><span>${L('选择目标', 'Choose destination')}</span><button id="close-target" class="subtle" aria-label="${L('关闭', 'Close')}">×</button></div><input id="target-filter" type="search" placeholder="${L('筛选名称或目录', 'Filter name or directory')}"><div id="target-options" class="target-options" role="list"></div>`;
  $('#close-target').onclick = () => { targetSelectionRevision++; destinationPicker = null; renderEditor(); };
  const draw = () => {
    const query = $('#target-filter').value.trim().toLocaleLowerCase();
    const visible = picker.rows.map((target, index) => ({ target, index })).filter(({ target }) =>
      `${target.label} ${target.detail}`.toLocaleLowerCase().includes(query));
    $('#target-options').innerHTML = picker.loading ? `<p>${T.loading}</p>` : !visible.length ? `<p>${L('暂无可选目标', 'No matching destinations')}</p>` : visible.map(({ target, index }) =>
      `<button type="button" data-target-index="${index}" role="listitem"><span>${escapeText(target.label)}</span><small>${escapeText(target.detail || '')}</small></button>`).join('');
    pane.querySelectorAll('[data-target-index]').forEach(button => button.onclick = () => {
      if (destinationPicker !== picker || picker.emote !== slots[selected]) return;
      const target = picker.rows[Number(button.dataset.targetIndex)];
      picker.emote.action = picker.action;
      picker.emote.target = { mode: 'fixed', ref: { kind: target.kind, id: target.id }, label: target.label.slice(0, 200) };
      if (picker.action === 'new') picker.emote.delivery = 'queue';
      destinationPicker = null; targetSelectionRevision++; renderEditor(); change();
    });
  };
  $('#target-filter').oninput = draw; draw();
}
async function pickFixedTarget(emote, action = emote.action) {
  const revision = ++targetSelectionRevision;
  destinationPicker = { emote, action, loading: true, rows: [] }; renderEditor();
  try {
    const result = await rpc('targets', { kind: { new: 'project', existing: 'task', bot: 'bot' }[action] });
    if (revision !== targetSelectionRevision || slots[selected] !== emote || destinationPicker?.emote !== emote) return;
    destinationPicker.loading = false; destinationPicker.rows = result.targets; renderTargetPicker();
  } catch (error) { if (revision === targetSelectionRevision) { destinationPicker = null; renderEditor(); report(error); } }
}
function renderEditor() {
  closeModelPicker();
  const emote = slots[selected];
  if (!emote) return;
  if (destinationPicker && destinationPicker.emote !== emote) { destinationPicker = null; targetSelectionRevision++; }
  $('#editor').innerHTML = `
    <div class="editor-head"><span class="editor-icon ${['?', '❓', '？'].includes(emote.emoji) ? 'question' : ''}">${icon(emote)}</span><div class="editor-name"><input id="emote-name" class="editor-title" aria-label="${T.name}" value="${escapeText(emote.label)}" maxlength="40"><span id="emote-name-error" class="field-error" data-field-error="emote-name" hidden></span></div><div><button id="change-emote" class="subtle">${L('更换表情', 'Change')}</button><span id="change-emote-error" class="field-error" data-field-error="change-emote" hidden></span></div></div>
    <p class="field-caption">${L('发出后', 'After sending')}</p><div class="modes" aria-label="${L('表情行为', 'Action')}">${[['none', L('只展示','Display')], ['send', L('发送到…','Send to…')]].map(([mode, name]) => { const active = mode === emote.action || (mode === 'send' && emote.action !== 'none'); return `<button data-mode="${mode}" aria-pressed="${active}" class="${active ? 'active' : ''}">${name}</button>`; }).join('')}</div>
    ${emote.action === 'none' ? `<p class="editor-help">${L('只发表情，同时撤销上一个尚未生效的动作（2 秒内）。', 'Displays the emote and cancels the previous action during its 2-second wait.')}</p>` : `
    <div class="fields">${targetFields(emote)}${emote.action === 'existing' && !emote.target ? `<label>${T.target}<select id="task-target"></select><span id="task-target-error" class="field-error" data-field-error="task-target" hidden></span></label><button id="tasks" class="subtle task-refresh">${T.tasks}</button>` : ''}
    <div id="model-settings"></div>
    ${emote.target && ['existing', 'bot'].includes(emote.action) ? `<label>${L('补充方式', 'Delivery')}<select id="emote-delivery"><option value="queue" ${(emote.delivery ?? 'queue') === 'queue' ? 'selected' : ''}>${L('排队发送', 'Queue')}</option><option value="steer" ${emote.delivery === 'steer' ? 'selected' : ''}>${L('立即插话', 'Insert now')}</option></select></label><p>${L('空闲时直接处理。忙碌时按所选方式投递；暂时无法插话时会排队，并显示实际结果。', 'Processed immediately when idle. While busy, follows this setting; if insertion is unavailable, queues the input and shows the actual result.')}</p>` : ''}
    <label><span class="field-label">${L('给 Cindy 的指令', 'Prompt for Cindy')}<span id="prompt-error" class="field-error" data-field-error="prompt" hidden></span></span><textarea id="prompt" maxlength="8000" placeholder="${T.promptPlaceholder}">${escapeText(emote.prompt)}</textarea></label>
    <label class="check"><input id="capture" type="checkbox" ${emote.screenshot ? 'checked' : ''}>${T.screenshot}</label>
    <div class="delay-note">${L('表情立即显示；满 2 秒且目标选定后执行。连续操作只保留最后一次。', 'Displays immediately; runs after 2 seconds and target selection. Only the last action takes effect.')}</div></div>
    <p class="editor-help">${emote.target ? (emote.action === 'new' ? L('在选定项目中新建任务，模型按此表情配置；任务权限由 Cindy 管理。', 'Creates a task in the chosen project with this emote’s model. Cindy manages task permissions.') : L('保留接收任务或伙伴的模型、工作目录和权限。', 'Keeps the recipient’s model, directory and permissions.')) : emote.action === 'existing' ? L('原有绑定继续使用本插件任务，工作目录和权限保持不变。', 'The saved binding continues to use its plugin task, with the same directory and permissions.') : L('沿用此前的任务目录及权限；可选择项目作为新的目标。', 'Keeps the saved task directory and permissions. Choose a project to change the destination.')}</p>`}`;
  $('#emote-name').oninput = event => { emote.label = event.target.value; renderWheel(); change(); };
  $('#change-emote').onclick = () => openAssets(emote);
  document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => {
    const mode = button.dataset.mode;
    if (mode === emote.action || (mode === 'send' && emote.action !== 'none')) return;
    targetSelectionRevision++; destinationPicker = null;
    emote.action = mode === 'send' ? 'existing' : mode;
    if (mode === 'send') emote.target = { mode: 'recent' }; else delete emote.target;
    renderEditor(); change();
  });
  if ($('#destination-preset')) $('#destination-preset').onchange = event => {
    const [action, mode] = event.target.value.split(':');
    if (mode === 'legacy') return;
    if (mode === 'fixed') { void pickFixedTarget(emote, action); return; }
    targetSelectionRevision++; destinationPicker = null;
    emote.action = action; emote.target = { mode };
    if (action === 'new') emote.delivery = 'queue';
    renderEditor(); change();
  };
  if ($('#prompt')) $('#prompt').oninput = event => { emote.prompt = event.target.value; change(); };
  if ($('#capture')) $('#capture').onchange = event => { emote.screenshot = event.target.checked; change(); };
  if ($('#emote-delivery')) $('#emote-delivery').onchange = event => { emote.delivery = event.target.value; change(); };
  if ($('#change-target')) $('#change-target').onclick = () => void pickFixedTarget(emote);
  renderTargetPicker();
  renderModels();
  if ($('#task-target')) {
    renderTasks();
    $('#task-target').onchange = event => { emote.taskId = event.target.value; change(); };
    $('#tasks').onclick = () => void loadTasks().catch(report);
    if (!tasksLoaded) void loadTasks().catch(report);
  }
  renderValidation();
}
const sameModel = (a, b) => a?.agentKind === b?.agentKind && a?.providerId === b?.providerId && a?.model === b?.model;
const modelEngineName = kind => ({ cc: 'Claude Code', codex: 'Codex', pi: 'Pi' }[kind] || kind);
function modelLabel(route, details) {
  const agent = { cc: 'Claude Code', codex: 'Codex', pi: 'Pi' }[route.agentKind] || route.agentKind;
  return `${details?.name || route.model} · ${agent} · ${details?.providerName || route.providerId}`;
}
function modelProviderMark(route, details) {
  if (!route) return modelIcon;
  const kind = Object.hasOwn(CindyPingProviderMarks.byId, route.providerId)
    ? CindyPingProviderMarks.byId[route.providerId] : null;
  if (kind) {
    const logo = CindyPingProviderMarks.logos[kind];
    return `<svg viewBox="${logo.viewBox}" fill="currentColor" aria-hidden="true">${logo.paths.map(path => `<path d="${path}"/>`).join('')}</svg>`;
  }
  const name = (details?.providerName || route.providerId).trim();
  return `<span class="provider-monogram" aria-hidden="true">${escapeText([...name][0]?.toUpperCase() || '?')}</span>`;
}
function filterModelOptions(options, state, currentRoute) {
  const words = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return options.filter(item => {
    if (item.details?.visible === false && !state.hidden && !sameModel(item.route, currentRoute)) return false;
    if (!words.length && state.engine !== 'all' && item.route.agentKind !== state.engine) return false;
    const text = [item.details?.name, item.route.model, item.details?.providerName,
      item.route.providerId, modelEngineName(item.route.agentKind)].join(' ').toLowerCase();
    return words.every(word => text.includes(word));
  });
}
function modelRouteUnavailable(route, option) {
  return Boolean(route && (!option ||
    (route.effort !== option.route.effort && !option.efforts.includes(route.effort)) ||
    (route.fastMode && !option.supportsFastMode)));
}
function chooseModel(emote, option) {
  if (slots[selected] !== emote) return;
  modelPicker.open = false;
  const route = option?.route ?? null;
  if (!sameModel(emote.route, route) || (option && modelRouteUnavailable(emote.route, option))) {
    emote.route = route ? { ...route } : null;
    change();
  }
  renderModels();
  $('#emote-model')?.focus({ preventScroll: true });
}
function closeModelPicker(focus = false) {
  modelPicker.open = false;
  if ($('#model-picker-panel')) $('#model-picker-panel').hidden = true;
  $('#emote-model')?.setAttribute('aria-expanded', 'false');
  if (focus) $('#emote-model')?.focus({ preventScroll: true });
}
function positionModelPicker() {
  const panel = $('#model-picker-panel'), trigger = $('#emote-model');
  if (!modelPicker.open || !panel || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) { closeModelPicker(); return; }
  const width = Math.min(380, window.innerWidth - 16);
  const above = rect.top - 16, below = window.innerHeight - rect.bottom - 16;
  const upwards = below < 260 && above > below;
  panel.style.width = `${width}px`;
  panel.style.maxHeight = `${Math.max(80, Math.min(380, upwards ? above : below))}px`;
  panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  const height = panel.getBoundingClientRect().height;
  panel.style.top = `${Math.max(8, upwards ? rect.top - height - 8 : rect.bottom + 8)}px`;
}
function highlightModel(index, scroll = false) {
  const rows = [...document.querySelectorAll('#model-options [role="option"]')];
  if (!rows.length) { $('#model-search')?.removeAttribute('aria-activedescendant'); return; }
  modelPicker.active = (index + rows.length) % rows.length;
  rows.forEach((row, i) => row.classList.toggle('is-active', i === modelPicker.active));
  $('#model-search')?.setAttribute('aria-activedescendant', rows[modelPicker.active].id);
  if (scroll) rows[modelPicker.active].scrollIntoView({ block: 'nearest' });
}
function renderModelOptions() {
  const list = $('#model-options'); if (!list) return;
  const emote = slots[selected], route = emote.route;
  list.replaceChildren();
  const addRow = (name, detail, option) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'model-option'; button.tabIndex = -1;
    button.id = `model-option-${list.querySelectorAll('[role="option"]').length}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(sameModel(route, option?.route)));
    button.title = option ? modelLabel(option.route, option.details) : name;
    button.setAttribute('aria-label', button.title);
    button.innerHTML = `<span class="model-option-icon">${modelProviderMark(option?.route, option?.details)}</span><span class="model-option-text"><span>${escapeText(name)}</span>${detail ? `<small>${escapeText(detail)}</small>` : ''}</span><span class="model-option-check">${sameModel(route, option?.route) ? modelCheck : ''}</span>`;
    button.onclick = () => chooseModel(emote, option);
    button.onpointerenter = () => highlightModel([...list.querySelectorAll('[role="option"]')].indexOf(button));
    list.append(button);
  };
  const inherit = M(emote.action === 'existing' ? 'keep' : 'inherit');
  if (!modelPicker.query.trim() || inherit.toLowerCase().includes(modelPicker.query.trim().toLowerCase())) addRow(inherit, '', null);
  const groups = new Map();
  for (const option of filterModelOptions(modelList, modelPicker, route)) {
    const key = option.route.providerId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(option);
  }
  for (const options of groups.values()) {
    const heading = document.createElement('div'); heading.className = 'model-source';
    heading.innerHTML = `<span class="model-source-icon">${modelProviderMark(options[0].route, options[0].details)}</span><span>${escapeText(options[0].details?.providerName || options[0].route.providerId)}</span>`;
    heading.setAttribute('aria-hidden', 'true');
    list.append(heading);
    for (const option of options) addRow(option.details?.name || option.route.model, modelEngineName(option.route.agentKind), option);
  }
  if (!list.querySelector('[role="option"]')) {
    const empty = document.createElement('div'); empty.className = 'model-empty';
    empty.textContent = modelsLoading ? L('正在获取可用模型…', 'Loading models…') : M('empty'); list.append(empty);
  }
  document.querySelectorAll('[data-model-engine]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.modelEngine === (modelPicker.query.trim() ? 'all' : modelPicker.engine)));
  });
  const rows = [...list.querySelectorAll('[role="option"]')];
  highlightModel(Math.max(0, rows.findIndex(row => row.getAttribute('aria-selected') === 'true')));
  positionModelPicker();
}
function renderModels(focusId) {
  const container = $('#model-settings'); if (!container) return;
  const emote = slots[selected], route = emote.route;
  if (emote.target && emote.action !== 'new') {
    container.innerHTML = `<p>${L('沿用接收方当前模型，不会因这次 Ping 改变。', 'Uses the recipient’s current model without changing it.')}</p>`;
    return;
  }
  const index = route ? modelList.findIndex(item => sameModel(item.route, route)) : -1;
  const option = index >= 0 ? modelList[index] : null;
  const invalid = modelsLoaded && modelRouteUnavailable(route, option);
  const name = route ? option?.details?.name || route.model : M(emote.action === 'existing' ? 'keep' : 'inherit');
  const detail = route ? `${option?.details?.providerName || route.providerId} · ${modelEngineName(route.agentKind)}` : '';
  const engines = ['all', ...new Set(modelList.map(item => item.route.agentKind))];
  container.innerHTML = `<label id="emote-model-label">${L('此表情的模型', 'Model for this emote')}</label>
    <button id="emote-model" type="button" class="model-trigger" aria-haspopup="dialog" aria-controls="model-picker-panel" aria-expanded="${modelPicker.open}" aria-labelledby="emote-model-label model-current-name"><span class="model-trigger-icon">${modelProviderMark(route, option?.details)}</span><span class="model-trigger-text"><span id="model-current-name">${escapeText(name)}</span>${detail ? `<small>${escapeText(detail)}</small>` : ''}</span>${chevronIcon}</button>
    <div id="model-picker-panel" class="model-picker-panel" role="dialog" aria-label="${M('choose')}" ${modelPicker.open ? '' : 'hidden'}>
      <div class="model-search-row"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input id="model-search" type="search" role="combobox" aria-label="${M('search')}" placeholder="${M('search')}" aria-controls="model-options" aria-expanded="true" autocomplete="off" value="${escapeText(modelPicker.query)}"><button id="refresh-models" type="button" class="model-refresh" aria-label="${M('refresh')}" title="${M('refresh')}" ${modelsLoading ? 'disabled' : ''}>↻</button></div>
      <div class="model-filters" role="group" aria-label="${M('choose')}">${engines.map(engine => `<button type="button" data-model-engine="${escapeText(engine)}" aria-pressed="false">${escapeText(engine === 'all' ? M('all') : modelEngineName(engine))}</button>`).join('')}</div>
      <div id="model-options" class="model-options" role="listbox" aria-label="${M('choose')}"></div>
      ${modelList.some(item => item.details?.visible === false) ? `<button id="model-hidden" type="button" class="model-hidden">${M(modelPicker.hidden ? 'hide' : 'hidden')}</button>` : ''}
    </div>
    <div id="model-tuning" class="model-tuning"></div><p id="model-scope"></p><p id="model-message" role="status"></p>`;
  $('#emote-model').onclick = () => {
    if (modelPicker.open) { closeModelPicker(); return; }
    Object.assign(modelPicker, { open: true, query: '', engine: 'all', hidden: false, active: 0 });
    renderModels();
  };
  $('#model-search').oninput = event => { modelPicker.query = event.target.value; renderModelOptions(); };
  document.querySelectorAll('[data-model-engine]').forEach(button => button.onclick = () => {
    modelPicker.engine = button.dataset.modelEngine; modelPicker.query = '';
    $('#model-search').value = ''; renderModelOptions(); $('#model-search').focus();
  });
  if ($('#model-hidden')) $('#model-hidden').onclick = () => {
    modelPicker.hidden = !modelPicker.hidden;
    $('#model-hidden').textContent = M(modelPicker.hidden ? 'hide' : 'hidden'); renderModelOptions();
  };
  $('#refresh-models').onclick = () => void loadModels();
  $('#model-scope').textContent = emote.action === 'existing'
    ? route ? L('触发时将原绑定任务切换到此模型，再发送指令。', 'Applies this model to the saved plugin task before sending.') : L('保持原绑定任务自身的模型。', 'Keeps the saved task’s model.')
    : route ? L('此模型只用于这个表情新建的任务。', 'This model applies to tasks created by this emote.') : L('沿用 Cindy 为插件保存的默认配置；可在这里单独选择。', 'Uses Cindy’s saved defaults for this plugin. Choose a model here to override them for this emote.');
  const message = $('#model-message');
  message.textContent = modelsLoading ? L('正在获取可用模型…', 'Loading models…') : modelsError ? T[modelsError] || T.OPERATION_FAILED :
    invalid ? T.MODEL_UNAVAILABLE : modelsLoaded && !modelList.length ? L('没有可单独选择的模型，请检查 Cindy 的模型设置。', 'No models available. Check Cindy model settings.') : '';
  message.classList.toggle('error', Boolean(modelsError || invalid));
  const tuning = $('#model-tuning');
  if (route && option?.efforts.length) {
    const label = document.createElement('label'); label.textContent = M('effort');
    const effort = document.createElement('select'); effort.id = 'model-effort';
    for (const value of option.efforts) effort.add(new Option(M('efforts')[value] || value || M('default'), value));
    if (!option.efforts.includes(route.effort)) {
      const current = new Option(route.effort || L('默认', 'Default'), route.effort);
      current.disabled = route.effort !== option.route.effort; effort.add(current);
    }
    effort.value = route.effort;
    effort.onchange = () => { emote.route = { ...emote.route, effort: effort.value }; renderModels('model-effort'); change(); };
    label.append(effort); tuning.append(label);
  }
  if (route && option && (option.supportsFastMode || route.fastMode)) {
    const label = document.createElement('label'); label.className = 'check';
    const fast = document.createElement('input'); fast.type = 'checkbox'; fast.id = 'model-fast'; fast.checked = route.fastMode;
    fast.onchange = () => { emote.route = { ...emote.route, fastMode: fast.checked }; renderModels('model-fast'); change(); };
    label.append(fast, route.fastMode === 'ultrafast' ? L('Fast · 超快', 'Fast · Ultrafast') : 'Fast'); tuning.append(label);
  }
  if (modelPicker.open) {
    renderModelOptions(); $('#model-search').focus({ preventScroll: true });
  } else if (focusId) $(`#${focusId}`)?.focus({ preventScroll: true });
}
document.addEventListener('pointerdown', event => {
  if (modelPicker.open && !event.target.closest('#model-picker-panel, #emote-model')) closeModelPicker();
});
document.addEventListener('focusin', event => {
  if (modelPicker.open && !event.target.closest('#model-picker-panel, #emote-model')) closeModelPicker();
});
document.addEventListener('keydown', event => {
  if (!modelPicker.open || event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeModelPicker(true); }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); highlightModel(modelPicker.active + (event.key === 'ArrowDown' ? 1 : -1), true);
  } else if (event.key === 'Enter' && event.target.id === 'model-search') {
    event.preventDefault(); document.querySelectorAll('#model-options [role="option"]')[modelPicker.active]?.click();
  }
});
window.addEventListener('resize', positionModelPicker);
window.addEventListener('scroll', positionModelPicker, true);
async function loadModels() {
  if (modelsLoading) return;
  modelsLoading = true; modelsError = ''; renderModels();
  try {
    const [catalog, names] = await Promise.allSettled([
      rpc('models'), fetch('/agent-models', { signal: AbortSignal.timeout(5000) }).then(async response => {
        if (!response.ok) throw new Error('HOST_NOT_READY');
        return response.json();
      }),
    ]);
    if (catalog.status === 'rejected') throw catalog.reason;
    const details = names.status === 'fulfilled' ? names.value.models || [] : [];
    modelList = catalog.value.models.map(option => ({ ...option,
      details: details.find(item => item.id === option.route.model && item.providerId === option.route.providerId &&
        item.agent === (option.route.agentKind === 'cc' ? 'claude-code' : option.route.agentKind)) }));
    modelsLoaded = true;
  }
  catch (error) { modelsError = error.message; }
  finally { modelsLoading = false; renderModels(); }
}
function renderTasks() {
  const select = $('#task-target'); if (!select) return;
  const emote = slots[selected];
  select.replaceChildren(new Option(L('选择任务', 'Choose a task'), ''));
  for (const task of taskList) select.add(new Option(task.title, task.taskId));
  if (emote.taskId && !taskList.some(task => task.taskId === emote.taskId)) select.add(new Option(T.missing, emote.taskId));
  select.value = emote.taskId || '';
}
async function loadTasks() {
  if (tasksLoading) return tasksLoading;
  tasksLoading = (async () => {
    const items = []; let after;
    do {
      const page = await rpc('tasks', after ? { after } : {});
      items.push(...page.items.filter(task => task.status === 'active')); after = page.nextCursor;
    } while (after && items.length < 500);
    taskList = items; tasksLoaded = true; renderTasks();
    if (!items.length && slots[selected].action === 'existing') feedback(T.noTasks);
  })();
  try { await tasksLoading; } finally { tasksLoading = null; }
}
$('#custom-image').onclick = async () => {
  const request = assetRequest;
  $('#custom-image').disabled = true;
  try {
    const image = await rpc('pickImage');
    if (image.path && request === assetRequest) chooseEmote('', image.path.split('/').pop().replace(/\.[^.]+$/, '').slice(0, 40), image.path, image.preview);
  } catch (error) { report(error); }
  finally { $('#custom-image').disabled = false; }
};
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(`#${button.dataset.close}`).close());
const presets = { option: { code: 'AltLeft', modifiers: 0 }, control: { code: 'ControlLeft', modifiers: 0 }, g: { code: 'KeyG', modifiers: 0 }, f8: { code: 'F8', modifiers: 0 } };
function renderPendingKey() {
  $('#record-key').textContent = EmoteShortcuts.label(pendingKey);
  $('#key-warning').textContent = pendingKey.modifiers === 0 && /^(Key|Digit)/.test(pendingKey.code)
    ? L('按下唤出，松键发送。插件启用时，此单键不再输入该字符。', 'Press to open, release to send. This single key is reserved while the plugin is enabled.')
    : L('按下快捷键唤出轮盘，移动选择后松键发送。', 'Hold the shortcut to open the wheel, move to choose, then release to send.');
}
async function finishRecording() {
  if (!recording) return;
  recording = false; clearTimeout(recordingTimer);
  if ($('#keys').open) $('#keys').close();
  try { const result = await rpc('shortcutRecording', { active: false }); if (result.issues?.length) feedback(T[result.issues[0]] || T.hotkeyConflict, true); }
  catch (error) { report(error); }
}
$('#shortcut').onclick = async () => {
  if (recording || !config) return;
  recording = true;
  try {
    await rpc('shortcutRecording', { active: true });
    if (!recording) return;
    pendingKey = { ...shortcut }; renderPendingKey(); $('#keys').showModal(); $('#record-key').focus();
    recordingTimer = setTimeout(() => void finishRecording(), 25000);
  } catch (error) { void finishRecording(); report(error); }
};
$('#keys').addEventListener('close', () => void finishRecording());
document.querySelectorAll('[data-key]').forEach(button => button.onclick = () => { pendingKey = { ...presets[button.dataset.key] }; renderPendingKey(); });
$('#use-key').onclick = () => { shortcut = { ...pendingKey }; change(); void finishRecording(); };
document.addEventListener('keydown', event => {
  if ($('#keys').open) {
    if (event.key === 'Escape' || event.key === 'Tab') return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat) return;
    try { pendingKey = EmoteShortcuts.fromEvent(event); renderPendingKey(); }
    catch { $('#key-warning').textContent = L('此按键无法用于轮盘，请换一个。', 'This key is unavailable. Choose another.'); }
    return;
  }
  if (event.key === 'Escape' && !$('#assets').open) cancelPlacement();
  if (placement && !placement.locked && event.key === 'Enter' && !event.repeat) { event.preventDefault(); confirmPlacement(); }
});
document.addEventListener('pointermove', event => { pointer = { x: event.clientX, y: event.clientY }; movePlacement(pointer); });
document.addEventListener('contextmenu', event => { if (placement && !placement.locked) { event.preventDefault(); cancelPlacement(); } });
window.addEventListener('blur', () => { if (placement && !placement.locked) cancelPlacement(); void finishRecording(); });
window.addEventListener('resize', () => { if (placement && !placement.locked) cancelPlacement(); });
window.addEventListener('pagehide', () => void finishRecording());
$('#retry').onclick = () => change();
$('#refresh').onclick = async () => {
  try { const value = await rpc('load'); applyStatus(value); }
  catch (error) { report(error); }
};
$('#reviewed').onclick = async () => { try { applyStatus(await rpc('reviewed')); } catch (error) { report(error); } };
let lastTheme;
function syncTheme() {
  const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
  if (dark === lastTheme || !config) return;
  lastTheme = dark; void rpc('theme', { dark }).catch(report);
}
new MutationObserver(syncTheme).observe(document.head, { subtree: true, childList: true, characterData: true });
(async () => {
  $('#prototype').inert = true;
  try {
    const context = await (await fetch('/app-context')).json(); T = strings[context.context?.locale] || strings.en; localize();
    const wake = await fetch('/wake'); if (!wake.ok) throw new Error('CONNECTION_TIMEOUT');
    const value = await rpc('load');
    config = value.config; configRevision = value.revision; slots = config.emotes; shortcut = config.wheelShortcut;
    T = strings[value.locale] || strings.en; document.documentElement.lang = value.locale; localize();
    renderWheel(); renderEditor(); applyStatus(value);
    $('#shortcut-label').textContent = EmoteShortcuts.label(shortcut);
    syncTheme();
    void loadModels();
    const images = await rpc('previewImages'); previews = images.images || {}; renderWheel(); renderEditor();
  } catch (error) { report(error); }
  finally { $('#prototype').inert = !config; }
})();
