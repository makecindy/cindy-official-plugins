// This bridge only proposes a file. Sandbox restrictions enforce that the
// artifact cannot download it; authorization belongs to the parent button.
function installDownloadRequests() {
  document.addEventListener('click', async event => {
    const link = (event.target as Element)?.closest?.('a[download]') as HTMLAnchorElement | null;
    if (!link) return;
    event.preventDefault();
    try {
      const url = new URL(link.href, document.baseURI);
      const base = new URL(document.baseURI);
      if (!['data:','blob:'].includes(url.protocol) && !(url.origin === base.origin && url.pathname.startsWith(base.pathname))) return;
      if (!['data:','blob:'].includes(url.protocol)) {
        parent.postMessage({type:'od:download-request',name:link.download || 'download',url:url.href}, '*');
        return;
      }
      const response = await fetch(url.href);
      if (!response.ok) return;
      const blob = await response.blob();
      if (blob.size > 12*1024*1024) return;
      parent.postMessage({type:'od:download-request',name:link.download || 'download',blob}, '*');
    } catch { /* A failed proposal never grants download permission. */ }
  }, true);
}
export function injectDownloadRequests(html: string): string {
  const script = `<script data-od-download-gate>(${installDownloadRequests.toString()})();</script>`;
  const head = /<head\b[^>]*>/i;
  return head.test(html) ? html.replace(head, match => match + script) : script + html;
}
