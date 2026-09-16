import React, {useEffect,useRef,useState} from 'react';

export function DownloadGate({file,zh,previewBase}:{file:string;zh:boolean;previewBase:string}) {
  const [pending,setPending] = useState<{name:string;blob:Blob}|null>(null);
  const current = useRef<typeof pending>(null);
  function clear() {current.current=null;setPending(null);}
  useEffect(() => {
    clear();
    let alive=true,busy=false;
    async function receive(event:MessageEvent) {
      const frame=document.querySelector<HTMLIFrameElement>('[data-testid="artifact-preview-frame"]');
      if (!frame || event.source !== frame.contentWindow || event.data?.type !== 'od:download-request' || current.current || busy) return;
      let blob=event.data.blob;
      if (typeof event.data.url === 'string') {
        try {
          const url=new URL(event.data.url),base=new URL(previewBase);
          if(url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password) return;
          busy=true;
          const response=await fetch(url.href,{credentials:'omit',redirect:'error'});
          if(!response.ok) return;
          blob=await response.blob();
        } catch {return;} finally {busy=false;}
      }
      if(!alive) return;
      if (!(blob instanceof Blob) || blob.size > 12*1024*1024 || typeof event.data.name !== 'string') return;
      const name=event.data.name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,128) || 'download';
      current.current={name,blob};setPending(current.current);
    }
    window.addEventListener('message',receive);
    return () => {alive=false;current.current=null;window.removeEventListener('message',receive);};
  },[file,previewBase]);
  if (!pending) return null;
  return <aside data-testid="artifact-download-request" style={{padding:12,border:'1px solid #ccc',background:'#fff',color:'#222'}}>
    <span>{zh?'稿件请求下载：':'Manuscript requests a download: '}{pending.name} ({pending.blob.size} B)</span>{' '}
    <button onClick={event=>{
      if (!event.nativeEvent.isTrusted || current.current !== pending) return;
      clear();
      const url=URL.createObjectURL(pending.blob),a=document.createElement('a');
      a.href=url;a.download=pending.name;document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }}>{zh?'保存文件':'Save file'}</button>{' '}
    <button onClick={event=>{if(event.nativeEvent.isTrusted) clear();}}>{zh?'取消':'Cancel'}</button>
  </aside>;
}
