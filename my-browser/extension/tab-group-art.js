'use strict';
// Illustration for the tab group setting: a tab strip where the user's own tab stays put and the
// tabs Cindy opens sit in a red "Cindy automation" group. Laid out with HTML so every label fits its
// tab in any language. Wide (options page) shows two Cindy tabs; compact (side panel) shows one with
// larger text. Colors follow the light/dark appearance.
(()=>{
  const CSS=`.cta{border:1px solid #d7d7d4;border-radius:10px;overflow:hidden;background:#fff;color:#262626;font:500 11px/1 -apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',sans-serif;max-width:100%}
.cta.compact{font-size:12.5px}
.cta-strip{display:flex;align-items:flex-end;gap:6px;padding:8px 8px 0;background:#efefec;white-space:nowrap;overflow:hidden}
.cta-tab{display:inline-flex;align-items:center;gap:6px;flex:none;padding:7px 11px 8px;border-radius:7px 7px 0 0;background:#fff}
.cta-group{display:flex;align-items:center;gap:5px;min-width:0;padding:0 0 4px;border-bottom:2px solid #d93025;margin-bottom:2px}
.cta-chip{flex:none;padding:3px 9px;border-radius:999px;background:#d93025;color:#fff;font-weight:600}
.cta-cindy{display:inline-flex;align-items:center;gap:6px;min-width:0;padding:4px 10px;border-radius:6px;background:#e3e3df;color:#737373;overflow:hidden;text-overflow:ellipsis}
.cta-dot{flex:none;width:7px;height:7px;border-radius:50%;background:#737373}.cta-dot.red{background:#d93025}
.cta-page{padding:12px 16px 14px}.cta-page i{display:block;height:7px;margin-bottom:7px;border-radius:4px;background:#e5e5e5;width:55%}.cta-page i+i{width:80%;margin:0}
@media (prefers-color-scheme:dark){.cta{border-color:#3c3c3a;background:#2c2c2a;color:#d4d4d4}.cta-strip{background:#1f1f1e}.cta-tab{background:#2c2c2a}.cta-group{border-color:#f28b82}.cta-chip{background:#f28b82;color:#1f1f1e}.cta-cindy{background:#3c3c3a;color:#a3a3a3}.cta-dot{background:#a3a3a3}.cta-dot.red{background:#f28b82}.cta-page i{background:#3c3c3a}}`;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  function art(zh,{compact=false}={}){
    if(!document.getElementById('cta-style')){const s=el('style');s.id='cta-style';s.textContent=CSS;document.head.append(s);}
    const t=zh?{yours:'你的标签页',group:'Cindy 自动操作',page:'Cindy 打开'}:{yours:'Your tab',group:'Cindy automation',page:'Cindy tab'};
    const box=el('div','cta'+(compact?' compact':''));box.setAttribute('role','img');
    box.setAttribute('aria-label',zh?'示意：你的标签页保持原样，Cindy 打开的标签页归入红色的「Cindy 自动操作」分组':'Your tab stays put; tabs Cindy opens go into a red "Cindy automation" group');
    const strip=el('div','cta-strip'),own=el('span','cta-tab');own.append(el('i','cta-dot'),el('span',undefined,t.yours));
    const group=el('span','cta-group');group.append(el('span','cta-chip',t.group));
    for(let i=0;i<(compact?1:2);i++){const tab=el('span','cta-cindy');tab.append(el('i','cta-dot red'),el('span',undefined,t.page));group.append(tab);}
    strip.append(own,group);const page=el('div','cta-page');page.append(el('i'),el('i'));
    for(const n of [strip,page])n.setAttribute('aria-hidden','true');
    box.append(strip,page);
    return box;
  }
  globalThis.CindyTabGroupArt=art;
})();
