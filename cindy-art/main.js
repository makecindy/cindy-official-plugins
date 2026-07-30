/**
 * Art 意识 · 电子脑(离屏逻辑页)。
 *
 * 职责链:收活(tool-call: gen_image / edit_image / gen_video / edit_video)
 * → 请主机代办(cindy-request)→ 拿到指纹后广播给画廊面板上墙 → 交卷
 * (tool-result 带 xdt_image_urls / xdt_video_urls,聊天气泡渲染媒体卡)。
 * 视频是分钟级长任务,cindy.send 会一直等到出结果。
 * v1.9.0 起图片工具供聊天卡片(card 槽,海报模式):收活即发过程卡、交卷前
 * 发终版卡,聊天结果位渲染成本意识自绘的卡片;视频工具不供卡(保持默认
 * 视频卡渲染),供片失败自动回退默认——细节见 sendProgressCard/sendResultCard。
 * v1.7.0 起另收面板右键菜单的活(panel-request,文件末节):同一条代办
 * 通道,只是发起方从 AI 变成了用户在面板上的点击。
 *
 * 全程只经手字符串(指纹/地址),摸不到文件、网络、路径——这是平台的
 * 结构保证,不是本代码的自觉。改图/图生视频的源图也只是指纹:主机查账
 * 验归属,不是本意识名下的图递过去也会被拒。
 */

/* global cindy */

// 与面板同源(cindy-ghost://cindy-art)的广播频道;面板是被动画布,只收不发。
// 频道名按 origin 隔离(别的意识起同名频道也串不了台),纯包内暗号。
const gallery = new BroadcastChannel('cindy-art');

/** 从任意字符串里抠出 64 位 sha256 指纹(支持 cindy-media:// 地址或裸指纹)。 */
function extractHash(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/[0-9a-f]{64}/);
  return m ? m[0] : null;
}

/** 交卷失败的统一姿势。 */
function failCall(callId, message) {
  return cindy
    .send({ type: 'tool-result', callId: callId, ok: false, message: message })
    .catch(function () {});
}

/**
 * ── 聊天卡片供片(卡槽③海报模式,v1.9.0)────────────────────────────
 * 聊天卡片视觉规格:
 * 过程态 = 题注 + 灰底占位画布;终版 = 全幅大图 + 「题注」 + 落款
 * (Art · 模型名)。背景与文字消费主机注入的语义色 token,随
 * light/dark/扩展主题切换;媒体内容本身不改色。
 * 只给图片工具供卡:海报模式点图进的是图片 lightbox,视频供卡会把默认
 * 视频卡顶掉又放不了片,视频调用保持默认渲染(不发 card-update 即回退)。
 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sendCard(callId, html, height) {
  // 供片尽力而为:失败(限速/被拒)不影响干活与交卷,聊天自动回退默认渲染。
  cindy.send({ type: 'card-update', callId: callId, html: html, height: height }).catch(function () {});
}

/**
 * 过程海报:收到活立刻发(卡片这一刻出现在聊天结果位)。
 * 自绘动画(调色盘摆动 + 文案呼吸)只动 transform/opacity——主机白名单
 * 只放行这两类(合成器动画);动画只在 running 期间生效,交卷后主机自动
 * 换回静态版,历史卡永远静止,意识无需(也无法)自己收动画。
 */
function sendProgressCard(callId, prompt, verb) {
  sendCard(
    callId,
    '<style>' +
      '@keyframes ca-bob{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-5px) rotate(4deg)}}' +
      '@keyframes ca-breathe{0%,100%{opacity:.45}50%{opacity:1}}' +
      '</style>' +
      // 布局对齐结果卡(与 xd-mivo 过程卡同规格):画布通栏出血(与结果图
      // 同一左缘,无外层 padding),高度按卡片画布宽 458 取 16:9 ≈ 258px;
      // 题注贴画布上方(与画布同左缘)。
      '<div style="height:290px;box-sizing:border-box;padding-top:8px;font-family:system-ui;' +
      'background:var(--msg-tool-card-bg,var(--surface-elevated,#ffffff));' +
      'color:var(--msg-tool-card-text,var(--text-primary,#1a1a1a))">' +
      '<div style="margin:0 0 8px;padding:0 12px;font-size:12px;line-height:16px;' +
      'color:var(--text-secondary,#6b6b66);text-align:center;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">「' + esc(prompt) + '」</div>' +
      '<div style="height:258px;border-radius:10px;' +
      'background:linear-gradient(135deg,var(--surface-chip,#eeeeec),' +
      'var(--surface,#f7f7f5) 55%,var(--surface-chip,#eeeeec));' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px">' +
      '<div style="font-size:26px;line-height:1;animation:ca-bob 1.6s ease-in-out infinite">🎨</div>' +
      '<div style="font-size:12px;color:var(--text-secondary,#6b6b66);font-weight:500;animation:ca-breathe 1.6s ease-in-out infinite">' + esc(verb) + '</div>' +
      '<div style="font-size:10px;color:var(--text-tertiary,#9a9a94)">通常 10–30 秒</div>' +
      '</div></div>',
    290,
  );
}

/** 终版海报:通栏出血作品(宽度撑满卡片,高度按比例自适应)+ 题注 + 落款;
 *  交卷前发。 */
function sendResultCard(callId, gen, caption, edited) {
  var label = edited ? '改动:' + caption : '「' + caption + '」';
  var sig = 'Art' + (gen.modelLabel ? ' · ' + gen.modelLabel : '');
  // 卡高精确声明:主机随代办结果带回图片真实像素宽高,按卡片画布宽
  // 458(卡宽 460 − 边框 2)算出出血图高,加题注区 ~52——首帧即最终
  // 高度,切 session 回看不再有"估计高 → 实测高"的收缩跳动。主机没带
  // 宽高(极老结果/解析失败)才回退方图估计,由主机实测兜底收敛。
  var height = 520;
  if (
    typeof gen.width === 'number' && gen.width > 0 &&
    typeof gen.height === 'number' && gen.height > 0
  ) {
    height = Math.round((458 * gen.height) / gen.width) + 52;
  }
  sendCard(
    callId,
    '<div style="font-family:system-ui;background:var(--msg-tool-card-bg,var(--surface-elevated,#ffffff));' +
      'color:var(--msg-tool-card-text,var(--text-primary,#1a1a1a))">' +
      '<img src="' + esc(gen.url) + '" style="display:block;width:100%;height:auto">' +
      '<div style="padding:8px 12px 10px">' +
      '<div style="font-size:12px;color:var(--text-secondary,#6b6b66);text-align:center;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(label) + '</div>' +
      '<div style="margin-top:3px;font-size:10px;color:var(--text-tertiary,#9a9a94);text-align:center">' + esc(sig) + '</div>' +
      '</div></div>',
    height,
  );
}

/** 代办成功后的统一收尾:上墙 + 交卷(note 带上主机实际用的模型;视频交卷用视频字段)。 */
async function deliver(callId, gen, caption, note) {
  gallery.postMessage({
    type: 'artwork',
    src: 'cindy-ghost://cindy-art/media/' + gen.hash + gen.ext,
    caption: caption,
  });
  var byModel = gen.modelLabel ? '(' + gen.modelLabel + ')' : '';
  var isVideo = typeof gen.ext === 'string' && (gen.ext === '.mp4' || gen.ext === '.webm');
  var result = { note: note + byModel };
  if (isVideo) result.xdt_video_urls = [gen.url];
  else result.xdt_image_urls = [gen.url];
  await cindy.send({
    type: 'tool-result',
    callId: callId,
    ok: true,
    result: result,
  });
}

async function handleGenImage(msg) {
  const prompt =
    msg.args && typeof msg.args.prompt === 'string' ? msg.args.prompt.trim() : '';
  if (!prompt) return failCall(msg.callId, '缺少 prompt(图片描述)');
  sendProgressCard(msg.callId, prompt, '正在起草');

  // callId 归因:让这单代办在主机日志/账单里对得上"哪次工具调用花的钱"。
  const req = { type: 'cindy-request', kind: 'gen_image', prompt: prompt, callId: msg.callId };
  if (msg.args && typeof msg.args.model === 'string') req.model = msg.args.model;
  if (msg.args && typeof msg.args.aspectRatio === 'string') req.aspectRatio = msg.args.aspectRatio;
  if (msg.args && typeof msg.args.tier === 'string') req.tier = msg.args.tier;

  const gen = await cindy.send(req);
  if (!gen || gen.ok !== true) {
    return failCall(msg.callId, (gen && gen.message) || '出图失败');
  }
  sendResultCard(msg.callId, gen, prompt, false);
  await deliver(msg.callId, gen, prompt, '图片已生成并挂进画廊面板。');
}

async function handleEditImage(msg) {
  const prompt =
    msg.args && typeof msg.args.prompt === 'string' ? msg.args.prompt.trim() : '';
  if (!prompt) return failCall(msg.callId, '缺少 prompt(怎么改)');

  // 源图两个来源:images(本意识之前生成的图)+ attachments(主机过户来的
  // 用户图指纹。合并去重后统一走主机归属校验。
  const images = msg.args && Array.isArray(msg.args.images) ? msg.args.images : [];
  const granted = msg.args && Array.isArray(msg.args.attachments) ? msg.args.attachments : [];
  const hashes = [];
  for (let i = 0; i < images.length; i++) {
    const h = extractHash(images[i]);
    if (!h) return failCall(msg.callId, '源图地址不合法:' + String(images[i]));
    if (hashes.indexOf(h) === -1) hashes.push(h);
  }
  for (let i = 0; i < granted.length; i++) {
    const h = extractHash(granted[i]);
    if (h && hashes.indexOf(h) === -1) hashes.push(h);
  }
  if (hashes.length === 0) return failCall(msg.callId, '缺少源图(images 或用户图片附件)');
  sendProgressCard(msg.callId, prompt, '正在修改');

  const req = { type: 'cindy-request', kind: 'edit_image', prompt: prompt, hashes: hashes, callId: msg.callId };
  if (msg.args && typeof msg.args.model === 'string') req.model = msg.args.model;
  if (msg.args && typeof msg.args.aspectRatio === 'string') req.aspectRatio = msg.args.aspectRatio;
  if (msg.args && typeof msg.args.tier === 'string') req.tier = msg.args.tier;

  const gen = await cindy.send(req);
  if (!gen || gen.ok !== true) {
    return failCall(msg.callId, (gen && gen.message) || '改图失败');
  }
  sendResultCard(msg.callId, gen, prompt, true);
  await deliver(msg.callId, gen, prompt, '图片已改好并挂进画廊面板。');
}

async function handleGenVideo(msg) {
  const prompt =
    msg.args && typeof msg.args.prompt === 'string' ? msg.args.prompt.trim() : '';
  if (!prompt) return failCall(msg.callId, '缺少 prompt(视频描述)');

  const req = { type: 'cindy-request', kind: 'gen_video', prompt: prompt, callId: msg.callId };
  if (msg.args && typeof msg.args.model === 'string') req.model = msg.args.model;
  if (msg.args && typeof msg.args.tier === 'string') req.tier = msg.args.tier;

  const gen = await cindy.send(req);
  if (!gen || gen.ok !== true) {
    return failCall(msg.callId, (gen && gen.message) || '生成视频失败');
  }
  await deliver(msg.callId, gen, prompt, '视频已生成并挂进画廊面板。');
}

async function handleEditVideo(msg) {
  const prompt =
    msg.args && typeof msg.args.prompt === 'string' ? msg.args.prompt.trim() : '';
  if (!prompt) return failCall(msg.callId, '缺少 prompt(想让画面怎么动)');

  // 参考图来源同 edit_image:images(本意识名下)+ attachments(用户过户),上限 2 张。
  const images = msg.args && Array.isArray(msg.args.images) ? msg.args.images : [];
  const granted = msg.args && Array.isArray(msg.args.attachments) ? msg.args.attachments : [];
  const hashes = [];
  for (let i = 0; i < images.length; i++) {
    const h = extractHash(images[i]);
    if (!h) return failCall(msg.callId, '参考图地址不合法:' + String(images[i]));
    if (hashes.indexOf(h) === -1) hashes.push(h);
  }
  for (let i = 0; i < granted.length; i++) {
    const h = extractHash(granted[i]);
    if (h && hashes.indexOf(h) === -1) hashes.push(h);
  }
  if (hashes.length === 0) return failCall(msg.callId, '缺少参考图(images 或用户图片附件)');

  const req = { type: 'cindy-request', kind: 'edit_video', prompt: prompt, hashes: hashes, callId: msg.callId };
  if (msg.args && typeof msg.args.model === 'string') req.model = msg.args.model;
  if (msg.args && typeof msg.args.tier === 'string') req.tier = msg.args.tier;

  const gen = await cindy.send(req);
  if (!gen || gen.ok !== true) {
    return failCall(msg.callId, (gen && gen.message) || '图生视频失败');
  }
  await deliver(msg.callId, gen, prompt, '视频已生成并挂进画廊面板。');
}

const HANDLERS = {
  gen_image: handleGenImage,
  edit_image: handleEditImage,
  gen_video: handleGenVideo,
  edit_video: handleEditVideo,
};

cindy.onHostMessage(function (msg) {
  if (!msg || msg.type !== 'tool-call') return;
  const handler = HANDLERS[msg.tool] || null;
  if (!handler) {
    failCall(msg.callId, '未知工具:' + msg.tool);
    return;
  }
  handler(msg).catch(function (err) {
    failCall(msg.callId, String((err && err.message) || err));
  });
});

/**
 * ── 面板右键菜单的活(panel-request,v1.7.0)────────────────────────────
 * 面板零桥发不了 cindy-request,菜单动作经同源广播递到这里,由电子脑转手。
 * 这些是用户在面板上主动点的,无 tool-call 语境,不带 callId(主机日志记
 * unattributed)。流程:收到即回执(panel-ack,面板据此判断电子脑在线)→
 * 代办 → 成功则广播上墙 + panel-done,失败 panel-fail。
 */
function panelFail(reqId, message) {
  gallery.postMessage({ type: 'panel-fail', reqId: reqId, message: message });
}

const PANEL_KINDS = { gen_image: true, edit_image: true, gen_video: true, edit_video: true };

/** 已接过的面板请求(面板在收到回执前会按 reqId 重发,收过的只补回执不重做)。 */
const seenPanelReqs = {};

async function handlePanelRequest(msg) {
  const reqId = typeof msg.reqId === 'string' ? msg.reqId : '';
  if (!reqId) return;
  if (seenPanelReqs[reqId]) {
    // 重发的同一份活:补个回执(面板可能没赶上第一份),绝不重复干活。
    gallery.postMessage({ type: 'panel-ack', reqId: reqId });
    return;
  }
  seenPanelReqs[reqId] = true;
  // 立即回执:活已接下(长任务另等完成消息;面板的"不在线"超时靠它解除)。
  gallery.postMessage({ type: 'panel-ack', reqId: reqId });

  if (!PANEL_KINDS[msg.kind]) return panelFail(reqId, '未知操作:' + String(msg.kind));
  const prompt = typeof msg.prompt === 'string' ? msg.prompt.trim() : '';
  if (!prompt) return panelFail(reqId, '缺少描述文字');

  const req = { type: 'cindy-request', kind: msg.kind, prompt: prompt };
  if (msg.kind === 'edit_image' || msg.kind === 'edit_video') {
    const h = extractHash(msg.hash);
    if (!h) return panelFail(reqId, '源图指纹不合法');
    req.hashes = [h];
  }

  const gen = await cindy.send(req);
  if (!gen || gen.ok !== true) {
    return panelFail(reqId, (gen && gen.message) || '代办失败');
  }
  gallery.postMessage({
    type: 'artwork',
    src: 'cindy-ghost://cindy-art/media/' + gen.hash + gen.ext,
    caption: prompt,
  });
  gallery.postMessage({ type: 'panel-done', reqId: reqId, modelLabel: gen.modelLabel || '' });
}

gallery.onmessage = function (event) {
  const msg = event.data;
  if (!msg || msg.type !== 'panel-request') return;
  handlePanelRequest(msg).catch(function (err) {
    if (typeof msg.reqId === 'string' && msg.reqId) {
      panelFail(msg.reqId, String((err && err.message) || err));
    }
  });
};

// 开机自检:管子握手(失败也不影响后续,主机派活时会再拉起)。
cindy.ping().catch(function () {});
