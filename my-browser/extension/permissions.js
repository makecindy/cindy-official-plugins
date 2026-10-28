'use strict';
// The on-demand debugging feature. Chrome only lets the user grant an optional permission by a click
// on the extension's own page, so Cindy opens this page when a task first needs it. Copy follows
// Cindy's interface language (asked from Cindy like the extension's other pages), never the
// browser's; English until Cindy answers or when it cannot be reached.
const COPY = {
  'zh-CN': {
    title:'调试功能（按需）',
    needed:'Cindy 正在执行的任务需要用到 Chrome 的调试接口。开启后，Cindy 只在用到以下操作时临时接上调试，做完马上断开：',
    intro:'少数操作只能通过 Chrome 的调试接口完成。开启后，Cindy 只在用到这些操作时临时接上调试，做完马上断开：',
    uses:['导出网页为 PDF','整页截图、元素截图，以及不切换标签页截取后台标签页','需要读取 Cookie 或网络请求的网站配方'],
    bar:'接上调试的那几秒，Chrome 顶部会显示「正在调试此浏览器」的提示，这是 Chrome 的安全规定。点提示上的「取消」可以随时中断。',
    on:'已开启。Cindy 只会在需要时临时使用。以后想关闭，在工具栏右键 Cindy 图标，选「选项」回到这里。',off:'未开启。',allow:'开启',revoke:'关闭',failed:'Chrome 没有授予权限。',done:'已开启，这个页面马上会关闭。'
  },
  'zh-TW': {
    title:'調試功能（按需）',
    needed:'Cindy 正在執行的任務需要用到 Chrome 的調試介面。開啟後，Cindy 只在用到以下操作時臨時接上調試，做完馬上斷開：',
    intro:'少數操作只能透過 Chrome 的調試介面完成。開啟後，Cindy 只在用到這些操作時臨時接上調試，做完馬上斷開：',
    uses:['將網頁匯出為 PDF','整頁截圖、元素截圖，以及不切換分頁擷取背景分頁','需要讀取 Cookie 或網路請求的網站配方'],
    bar:'接上調試的那幾秒，Chrome 頂部會顯示「正在調試此瀏覽器」的提示，這是 Chrome 的安全規定。點提示上的「取消」可以隨時中斷。',
    on:'已開啟。Cindy 只會在需要時臨時使用。以後想關閉，在工具列按右鍵點 Cindy 圖示，選「選項」回到這裡。',off:'未開啟。',allow:'開啟',revoke:'關閉',failed:'Chrome 沒有授予權限。',done:'已開啟，這個頁面馬上會關閉。'
  },
  en: {
    title:'Debugging feature (on demand)',
    needed:"A task Cindy is running needs Chrome's debugger. When this is on, Cindy attaches it only for these actions and detaches right after:",
    intro:"A few actions are only possible through Chrome's debugger. When this is on, Cindy attaches it only for those actions and detaches right after:",
    uses:['Saving a page as PDF','Full-page and element screenshots, and capturing a background tab without switching to it','Site recipes that read cookies or network requests'],
    bar:'While it is attached, Chrome shows "Cindy started debugging this browser" at the top. This is a Chrome safety rule; Cancel on that bar stops it at any time.',
    on:'On. Cindy uses it only when needed. To turn it off later, right-click the Cindy toolbar icon and choose Options.',off:'Off.',allow:'Turn on',revoke:'Turn off',failed:'Chrome did not grant the permission.',done:'On. This page closes in a moment.'
  }
};
const access = {permissions:['debugger']};
const $ = id => document.getElementById(id);
// Opened by Cindy because a task needs it: say so, and close the page once the user has allowed it.
const needed = new URLSearchParams(location.search).has('needed');
let text = COPY.en;
function paint(locale) {
  text = COPY[locale] || (/^zh/i.test(locale || '') ? COPY['zh-CN'] : COPY.en);
  document.documentElement.lang = text === COPY.en ? 'en' : locale;
  $('title').textContent = text.title; $('intro').textContent = needed ? text.needed : text.intro; $('bar').textContent = text.bar;
  $('uses').replaceChildren(...text.uses.map(use => { const li = document.createElement('li'); li.textContent = use; return li; }));
  $('allow').textContent = text.allow; $('revoke').textContent = text.revoke;
}
async function render(note) {
  const granted = await chrome.permissions.contains(access);
  $('status').textContent = note || (granted ? text.on : text.off);
  $('allow').hidden = granted; $('revoke').hidden = !granted;
}
$('allow').addEventListener('click',async () => {
  const ok = await chrome.permissions.request(access).catch(() => false);
  if (!ok) return render(text.failed);
  if (!needed) return render();
  await render(text.done);
  setTimeout(async () => { const tab = await chrome.tabs.getCurrent(); if (tab) chrome.tabs.remove(tab.id); },1500);
});
$('revoke').addEventListener('click',async () => { await chrome.permissions.remove(access).catch(() => false); render(); });
chrome.permissions.onAdded.addListener(() => render()); chrome.permissions.onRemoved.addListener(() => render());
paint('en'); render();
chrome.runtime.sendMessage({type:'cindy-learning',id:crypto.randomUUID(),request:{op:'config'}})
  .then(r => { if (r?.ok && r.locale) { paint(r.locale); render(); } },() => {});
