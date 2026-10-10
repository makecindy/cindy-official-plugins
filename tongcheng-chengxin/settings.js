'use strict';
const STRINGS = {
  "zh-CN": {
    "title": "同程程心设置",
    "heading": "同程程心授权",
    "intro": "填写你自己的程心激活码，即可查询机票、火车票、酒店等旅行资源。",
    "helpTitle": "获取 API Key",
    "step1": "打开同程旅行 App 或微信小程序，登录你的同程账号。",
    "step2": "在顶部搜索「程心激活码」，按页面提示申领。",
    "step3": "将领取的激活码粘贴到下方，点击「保存 Key」。",
    "website": "打开同程官网",
    "support": "联系同程客服",
    "helpNote": "激活码需在 App 或小程序内申领；官网链接用于访问同程，客服可协助处理申领问题。",
    "label": "API Key（程心激活码）",
    "save": "保存 Key",
    "clear": "清除",
    "loading": "正在读取授权状态…",
    "saved": "API Key 已保存；密钥内容不会显示。",
    "missing": "尚未配置 API Key，请按上方步骤领取程心激活码。",
    "readFailed": "暂时无法读取授权状态，请稍后重试。",
    "empty": "请先输入 API Key。",
    "saveOk": "API Key 已交给 Cindy 安全保存。",
    "saveFailed": "保存失败；密钥仍留在输入框中，可检查后重试。",
    "clearOk": "已清除 API Key。",
    "clearFailed": "清除失败，请稍后重试。"
  },
  "en": {
    "title": "Tongcheng Chengxin settings",
    "heading": "Tongcheng Chengxin authorization",
    "intro": "Enter your own Chengxin activation code to search flights, trains, hotels and other travel resources.",
    "helpTitle": "Get an API Key",
    "step1": "Open the Tongcheng Travel app or WeChat mini program and sign in to your Tongcheng account.",
    "step2": "Search for “程心激活码” (Chengxin activation code) and follow the instructions to claim one.",
    "step3": "Paste the activation code below and click “Save Key”.",
    "website": "Open Tongcheng website",
    "support": "Contact Tongcheng support",
    "helpNote": "Claim activation codes in the app or mini program. The website opens Tongcheng; customer support can help with activation-code requests.",
    "label": "API Key (Chengxin activation code)",
    "save": "Save Key",
    "clear": "Clear",
    "loading": "Reading authorization status…",
    "saved": "API Key saved; the secret is not displayed.",
    "missing": "API Key not configured. Follow the steps above to get a Chengxin activation code.",
    "readFailed": "Unable to read authorization status. Please try again later.",
    "empty": "Enter an API Key first.",
    "saveOk": "Cindy has securely saved your API Key.",
    "saveFailed": "Save failed. The key remains in the input; check it and try again.",
    "clearOk": "API Key cleared.",
    "clearFailed": "Unable to clear the key. Please try again later."
  }
};
let text = STRINGS.en;
const keyInput = document.getElementById('api-key');
const statusNode = document.getElementById('status');
const saveButton = document.getElementById('save');
const clearButton = document.getElementById('clear');
const key = 'tongcheng_api_key';
let busy = true;
let saved = null;

function updateButtons() {
  saveButton.disabled = busy;
  clearButton.disabled = busy || saved === false;
  keyInput.disabled = busy;
}

async function refresh(message) {
  try {
    const response = await fetch('/secrets');
    if (!response.ok) throw new Error();
    const list = await response.json();
    saved = Array.isArray(list) && list.some((item) => item.key === key && item.saved);
    statusNode.textContent = message || (saved ? text.saved : text.missing);
    updateButtons();
  } catch { saved = null; statusNode.textContent = text.readFailed; updateButtons(); }
}

saveButton.addEventListener('click', async () => {
  if (busy) return;
  const value = keyInput.value;
  if (!value.trim()) { statusNode.textContent = text.empty; return; }
  busy = true;
  updateButtons();
  try {
    const response = await fetch('/secrets/' + key, { method: 'PUT', body: JSON.stringify({ value }) });
    if (!response.ok) throw new Error();
    keyInput.value = '';
    saved = true;
    await refresh(text.saveOk);
  } catch { statusNode.textContent = text.saveFailed; }
  finally { busy = false; updateButtons(); }
});
clearButton.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  updateButtons();
  try {
    const response = await fetch('/secrets/' + key, { method: 'DELETE' });
    if (!response.ok) throw new Error();
    saved = false;
    await refresh(text.clearOk);
  } catch { statusNode.textContent = text.clearFailed; }
  finally { busy = false; updateButtons(); }
});

async function initialize() {
  updateButtons();
  try {
    const response = await fetch('/app-context');
    if (!response.ok) throw new Error();
    const data = await response.json();
    text = STRINGS[data.context && data.context.locale] || STRINGS.en;
  } catch { text = STRINGS.en; }
  document.documentElement.lang = text === STRINGS['zh-CN'] ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = text[node.dataset.i18n];
  });
  await refresh();
  busy = false;
  updateButtons();
}
initialize();
