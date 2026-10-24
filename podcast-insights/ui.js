(async function(){
  const r=await fetch('/app-context'),ctx=await r.json();const locale=ctx.context?.locale==='zh-CN'?'zh-CN':'en';
  globalThis.PodcastUI=await (await fetch('/ui/'+locale+'.json')).json();
  document.documentElement.lang=locale;
  document.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=PodcastUI[e.dataset.i18n] || e.dataset.i18n);
  dispatchEvent(new Event('podcast-ui-ready'));
})().catch(()=>{document.body.textContent='页面未能加载，请重新打开插件 / Unable to load. Reopen the plugin.';});
