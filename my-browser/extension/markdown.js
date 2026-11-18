'use strict';
// Markdown for side panel answers, following the Cindy app's message renderer (MarkdownRenderer.tsx):
// GFM, no hard breaks on single newlines, raw HTML dropped, links opened outside the panel, and code
// blocks with a copy button. Model output is untrusted: HTML is never rendered, images become their
// alt text, and only http(s)/mailto links stay links.
(()=>{
  const lib=globalThis.marked;
  const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeHref=href=>{try{const u=new URL(href);return ['http:','https:','mailto:'].includes(u.protocol)?u.href:null;}catch{return null;}};
  const parser=new lib.Marked({gfm:true,breaks:false,renderer:{
    html:()=> '',
    image:({text})=>escape(text||''),
    link({href,title,tokens}){const inner=this.parser.parseInline(tokens),url=safeHref(href);
      return url?`<a href="${escape(url)}"${title?` title="${escape(title)}"`:''} target="_blank" rel="noopener noreferrer">${inner}</a>`:inner;},
    code:({text,lang})=>`<div class="md-code"><pre><code${lang?` data-lang="${escape(String(lang).split(/\s/)[0])}"`:''}>${escape(text)}</code></pre></div>`,
    table(token){const head=token.header.map(c=>`<th>${this.parser.parseInline(c.tokens)}</th>`).join(''),rows=token.rows.map(r=>`<tr>${r.map(c=>`<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('');
      return `<div class="md-table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;},
  }});
  function render(text,{copyLabel='Copy',copiedLabel='Copied',icon}={}){
    const box=document.createElement('div');box.className='md';
    const template=document.createElement('template');template.innerHTML=parser.parse(String(text||''));
    box.append(template.content);
    for(const block of box.querySelectorAll('.md-code')){
      const code=block.querySelector('code'),button=document.createElement('button');button.type='button';button.className='md-copy';button.title=copyLabel;button.setAttribute('aria-label',copyLabel);
      if(icon)button.append(icon('copy'));
      button.onclick=async()=>{try{await navigator.clipboard.writeText(code.textContent);button.replaceChildren(icon?icon('check'):'');button.title=copiedLabel;setTimeout(()=>{button.replaceChildren(icon?icon('copy'):'');button.title=copyLabel;},1500);}catch{}};
      block.append(button);
    }
    return box;
  }
  globalThis.CindyMarkdown={render};
})();
