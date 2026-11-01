'use strict';
// The extension's options page: optional abilities the user turns on with a click, which is the only
// way Chrome lets an extension gain an optional permission. Copy follows Cindy's interface language
// (asked from Cindy like the extension's other pages), never the browser's; English until Cindy answers
// or when it cannot be reached.
const COPY = {
  'zh-CN': {
    groupTitle:'在标签栏标出 Cindy 打开的页面',
    groupIntro:'Cindy 自动操作时打开的页面都在一个单独的窗口里。开启后，这些页面会归入标签栏上一个红色的「Cindy 自动操作」标签组，一眼就能认出来。你自己的标签页不会被移动。',
    on:'已开启。',off:'未开启。',allow:'开启',revoke:'关闭',failed:'Chrome 没有授予权限。'
  },
  'zh-TW': {
    groupTitle:'在分頁列標出 Cindy 開啟的頁面',
    groupIntro:'Cindy 自動操作時開啟的頁面都在一個獨立的視窗裡。開啟後，這些頁面會歸入分頁列上一個紅色的「Cindy 自動操作」分頁群組，一眼就能認出來。你自己的分頁不會被移動。',
    on:'已開啟。',off:'未開啟。',allow:'開啟',revoke:'關閉',failed:'Chrome 沒有授予權限。'
  },
  en: {
    groupTitle:'Mark the pages Cindy opens in the tab strip',
    groupIntro:'Pages Cindy opens while working sit in a window of their own. When this is on, they also go into a red "Cindy automation" tab group, so you can tell them apart at a glance. Your own tabs are never moved.',
    on:'On.',off:'Off.',allow:'Turn on',revoke:'Turn off',failed:'Chrome did not grant the permission.'
  }
};
const $ = id => document.getElementById(id);
let text = COPY.en;
const features = [
  {key:'group',access:{permissions:['tabGroups']},onText:() => text.on},
];
function paint(locale) {
  text = COPY[locale] || (/^zh/i.test(locale || '') ? COPY['zh-CN'] : COPY.en);
  document.documentElement.lang = text === COPY.en ? 'en' : locale;
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
    render(f);
  });
  $(f.key+'-revoke').addEventListener('click',async () => { await chrome.permissions.remove(f.access).catch(() => false); render(f); });
}
chrome.permissions.onAdded.addListener(renderAll); chrome.permissions.onRemoved.addListener(renderAll);
paint('en'); renderAll();
chrome.runtime.sendMessage({type:'cindy-learning',id:crypto.randomUUID(),request:{op:'config'}})
  .then(r => { if (r?.ok && r.locale) { paint(r.locale); renderAll(); } },() => {});
