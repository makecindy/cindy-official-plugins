'use strict';
// The extension's options page: optional abilities the user turns on with a click, which is the only
// way Chrome lets an extension gain an optional permission. Cindy opens it when a task first needs
// the debugger. Copy follows Cindy's interface language (asked from Cindy like the extension's other
// pages), never the browser's; English until Cindy answers or when it cannot be reached.
const COPY = {
  'zh-CN': {
    debugTitle:'调试功能（按需）',
    debugNeeded:'Cindy 正在执行的任务需要用到 Chrome 的调试接口。开启后，Cindy 只在用到以下操作时临时接上调试，做完马上断开：',
    debugIntro:'少数操作只能通过 Chrome 的调试接口完成。开启后，Cindy 只在用到这些操作时临时接上调试，做完马上断开：',
    debugUses:['导出网页为 PDF','整页截图、元素截图，以及不切换标签页截取后台标签页','需要读取 Cookie 或网络请求的网站配方'],
    debugBar:'接上调试的那几秒，Chrome 顶部会显示「正在调试此浏览器」的提示，这是 Chrome 的安全规定。点提示上的「取消」可以随时中断。',
    groupTitle:'在标签栏标出 Cindy 打开的页面',
    groupIntro:'Cindy 自动操作时打开的页面都在一个单独的窗口里。开启后，这些页面会归入标签栏上一个红色的「Cindy 自动操作」标签组，一眼就能认出来。你自己的标签页不会被移动。',
    on:'已开启。',off:'未开启。',allow:'开启',revoke:'关闭',failed:'Chrome 没有授予权限。',done:'已开启，这个页面马上会关闭。',
    debugOn:'已开启。Cindy 只会在需要时临时使用。以后想关闭，在工具栏右键 Cindy 图标，选「选项」回到这里。'
  },
  'zh-TW': {
    debugTitle:'調試功能（按需）',
    debugNeeded:'Cindy 正在執行的任務需要用到 Chrome 的調試介面。開啟後，Cindy 只在用到以下操作時臨時接上調試，做完馬上斷開：',
    debugIntro:'少數操作只能透過 Chrome 的調試介面完成。開啟後，Cindy 只在用到這些操作時臨時接上調試，做完馬上斷開：',
    debugUses:['將網頁匯出為 PDF','整頁截圖、元素截圖，以及不切換分頁擷取背景分頁','需要讀取 Cookie 或網路請求的網站配方'],
    debugBar:'接上調試的那幾秒，Chrome 頂部會顯示「正在調試此瀏覽器」的提示，這是 Chrome 的安全規定。點提示上的「取消」可以隨時中斷。',
    groupTitle:'在分頁列標出 Cindy 開啟的頁面',
    groupIntro:'Cindy 自動操作時開啟的頁面都在一個獨立的視窗裡。開啟後，這些頁面會歸入分頁列上一個紅色的「Cindy 自動操作」分頁群組，一眼就能認出來。你自己的分頁不會被移動。',
    on:'已開啟。',off:'未開啟。',allow:'開啟',revoke:'關閉',failed:'Chrome 沒有授予權限。',done:'已開啟，這個頁面馬上會關閉。',
    debugOn:'已開啟。Cindy 只會在需要時臨時使用。以後想關閉，在工具列按右鍵點 Cindy 圖示，選「選項」回到這裡。'
  },
  en: {
    debugTitle:'Debugging feature (on demand)',
    debugNeeded:"A task Cindy is running needs Chrome's debugger. When this is on, Cindy attaches it only for these actions and detaches right after:",
    debugIntro:"A few actions are only possible through Chrome's debugger. When this is on, Cindy attaches it only for those actions and detaches right after:",
    debugUses:['Saving a page as PDF','Full-page and element screenshots, and capturing a background tab without switching to it','Site recipes that read cookies or network requests'],
    debugBar:'While it is attached, Chrome shows "Cindy started debugging this browser" at the top. This is a Chrome safety rule; Cancel on that bar stops it at any time.',
    groupTitle:'Mark the pages Cindy opens in the tab strip',
    groupIntro:'Pages Cindy opens while working sit in a window of their own. When this is on, they also go into a red "Cindy automation" tab group, so you can tell them apart at a glance. Your own tabs are never moved.',
    on:'On.',off:'Off.',allow:'Turn on',revoke:'Turn off',failed:'Chrome did not grant the permission.',done:'On. This page closes in a moment.',
    debugOn:'On. Cindy uses it only when needed. To turn it off later, right-click the Cindy toolbar icon and choose Options.'
  }
};
const $ = id => document.getElementById(id);
// Opened by Cindy because a task needs the debugger: say so, and close the page once it is allowed.
const needed = new URLSearchParams(location.search).has('needed');
let text = COPY.en;
const features = [
  {key:'debug',access:{permissions:['debugger']},closeWhenGranted:needed,onText:() => text.debugOn},
  {key:'group',access:{permissions:['tabGroups']},closeWhenGranted:false,onText:() => text.on},
];
function paint(locale) {
  text = COPY[locale] || (/^zh/i.test(locale || '') ? COPY['zh-CN'] : COPY.en);
  document.documentElement.lang = text === COPY.en ? 'en' : locale;
  $('debug-title').textContent = text.debugTitle; $('debug-intro').textContent = needed ? text.debugNeeded : text.debugIntro;
  $('debug-uses').replaceChildren(...text.debugUses.map(use => { const li = document.createElement('li'); li.textContent = use; return li; }));
  $('debug-bar').textContent = text.debugBar;
  $('group-title').textContent = text.groupTitle; $('group-intro').textContent = text.groupIntro;
  for (const f of features) { $(f.key+'-allow').textContent = text.allow; $(f.key+'-revoke').textContent = text.revoke; }
}
async function render(f,note) {
  const granted = await chrome.permissions.contains(f.access);
  $(f.key+'-status').textContent = note || (granted ? f.onText() : text.off);
  $(f.key+'-allow').hidden = granted; $(f.key+'-revoke').hidden = !granted;
}
const renderAll = () => Promise.all(features.map(f => render(f)));
for (const f of features) {
  $(f.key+'-allow').addEventListener('click',async () => {
    const ok = await chrome.permissions.request(f.access).catch(() => false);
    if (!ok) return render(f,text.failed);
    if (!f.closeWhenGranted) return render(f);
    await render(f,text.done);
    setTimeout(async () => { const tab = await chrome.tabs.getCurrent(); if (tab) chrome.tabs.remove(tab.id); },1500);
  });
  $(f.key+'-revoke').addEventListener('click',async () => { await chrome.permissions.remove(f.access).catch(() => false); render(f); });
}
chrome.permissions.onAdded.addListener(renderAll); chrome.permissions.onRemoved.addListener(renderAll);
paint('en'); renderAll();
chrome.runtime.sendMessage({type:'cindy-learning',id:crypto.randomUUID(),request:{op:'config'}})
  .then(r => { if (r?.ok && r.locale) { paint(r.locale); renderAll(); } },() => {});
