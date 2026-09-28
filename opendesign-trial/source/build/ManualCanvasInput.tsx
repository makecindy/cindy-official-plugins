import React, { useEffect, useRef } from 'react';
import type { ManualEditTarget } from '../latest/apps/web/src/edit-mode/types';
type Gesture = {request:string;frame:HTMLIFrameElement;text:boolean;hover:boolean;x:number;y:number;lastX:number;lastY:number;scaleX:number;scaleY:number;startedAt:number;source:string|null;dragged?:boolean;target?:ManualEditTarget;done?:boolean};

// The artifact may describe a hit target, but never authorizes a gesture or
// supplies its displacement. Pointer capture and all coordinates live here.
export function ManualCanvasInput(props: {
  frame(): HTMLIFrameElement | null;
  source: string | null;
  onSelect(target: ManualEditTarget): void;
  onHover(target: ManualEditTarget | null): void;
  onBackground(): void;
  onText(target: ManualEditTarget, point: {x:number;y:number}): void;
  onMove(target: ManualEditTarget, dx: number, dy: number, commit: boolean): void;
}) {
  const pending = useRef<Gesture | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  useEffect(() => { pending.current = null; }, [props.source]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      const p = pending.current;
      if (!p || event.source !== p.frame.contentWindow || event.data?.type !== 'od-host-hit-result' || event.data.request !== p.request || p.target) return;
      if (p.source !== callbacks.current.source || Date.now() - p.startedAt > 2000) { pending.current = null; return; }
      const target = event.data.target;
      if (!target || typeof target.id !== 'string') {
        pending.current = null;
        if (p.hover) callbacks.current.onHover(null);
        else if (!p.text) callbacks.current.onBackground();
        return;
      }
      if (p.hover) { pending.current=null; callbacks.current.onHover(target); return; }
      p.target = target;
      if (p.text) {
        pending.current = null;
        callbacks.current.onText(target, {x:p.x,y:p.y});
      } else {
        callbacks.current.onSelect(target);
        if (p.done) settle(p, true);
      }
    }
    window.addEventListener('message', receive);
    return () => { pending.current = null; window.removeEventListener('message', receive); };
  }, []);
  function settle(p: Gesture, commit: boolean) {
    if (p.source !== callbacks.current.source) {pending.current=null;return;}
    if (!p.target) return;
    const dx = (p.lastX-p.x)/p.scaleX, dy = (p.lastY-p.y)/p.scaleY;
    if (Math.hypot(dx,dy) >= 4) {p.dragged=true;callbacks.current.onMove(p.target, dx, dy, commit);}
    else if (p.dragged) callbacks.current.onMove(p.target,0,0,false);
    if (commit) pending.current = null;
  }
  function begin(event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>, text: boolean, hover = false) {
    if (!event.nativeEvent.isTrusted || (!hover && event.button !== 0)) return;
    const frame = props.frame(); if (!frame?.contentWindow) return;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const request = crypto.randomUUID();
    const scaleX = rect.width / (frame.clientWidth || rect.width), scaleY = rect.height / (frame.clientHeight || rect.height);
    pending.current = {request,frame,text,hover,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,scaleX,scaleY,startedAt:Date.now(),source:props.source};
    frame.contentWindow.postMessage({type:'od-host-hit-test',request,x:(event.clientX-rect.left)/scaleX,y:(event.clientY-rect.top)/scaleY}, '*');
  }
  return <div data-testid="manual-canvas-input" style={{position:'absolute',inset:0,zIndex:10,touchAction:'none'}}
    onPointerDown={event => { begin(event,false); if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { const p=pending.current; if (!event.nativeEvent.isTrusted) return; if (!p) {begin(event,false,true);return;} if (p.done || p.text || p.hover) return; p.lastX=event.clientX;p.lastY=event.clientY;settle(p,false); }}
    onPointerUp={event => { const p=pending.current; if (!event.nativeEvent.isTrusted || !p || p.text || p.hover) return; p.lastX=event.clientX;p.lastY=event.clientY;p.done=true;settle(p,true); }}
    onPointerCancel={() => { const p=pending.current; if (p?.target) callbacks.current.onMove(p.target,0,0,false); pending.current=null; }}
    onPointerLeave={() => { if (pending.current?.hover) pending.current=null; callbacks.current.onHover(null); }}
    onDoubleClick={event => begin(event,true)}
    onWheel={event => { if (event.nativeEvent.isTrusted) props.frame()?.contentWindow?.postMessage({type:'od-host-scroll',x:event.deltaX,y:event.deltaY},'*'); }} />;
}
