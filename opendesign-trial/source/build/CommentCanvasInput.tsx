import React, { useEffect, useRef } from 'react';
import { randomUUID } from '../latest/apps/web/src/utils/uuid';

export const COMMENT_TARGET_LIMIT = 500;
const authorizedEvents = new WeakSet<MessageEvent>();
export function isAuthorizedCommentEvent(event: MessageEvent) { return authorizedEvents.has(event); }
// Only this parent-realm module can mark an event. An iframe postMessage,
// including one with a copied request id, cannot manufacture this identity.
function deliver(frame: HTMLIFrameElement, data: object) {
  const event = new MessageEvent('message', {source: frame.contentWindow, data});
  authorizedEvents.add(event);
  try { window.dispatchEvent(event); } finally { authorizedEvents.delete(event); }
}
type Point = {x: number; y: number};
type Pending = {id: string; frame: HTMLIFrameElement; source: string | null; mode: string; at: number; hover: boolean};
export function CommentCanvasInput(props: {frame(): HTMLIFrameElement | null; source: string | null; mode: 'picker' | 'pod' | 'inspect'}) {
  const current = useRef(props); current.current = props;
  const pending = useRef<Pending | null>(null);
  const stroke = useRef<{frame: HTMLIFrameElement; points: Point[]} | null>(null);
  useEffect(() => { pending.current = null; stroke.current = null; }, [props.source, props.mode]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      const p = pending.current;
      if (!p || event.source !== p.frame.contentWindow || event.data?.type !== 'od:comment-hit-result' || event.data.request !== p.id) return;
      pending.current = null;
      if (p.frame !== current.current.frame() || p.source !== current.current.source || p.mode !== current.current.mode || Date.now() - p.at > 1500) return;
      const target = event.data.target;
      if (!target || typeof target.elementId !== 'string' || typeof target.selector !== 'string') {
        if (p.hover) deliver(p.frame, {type: 'od:comment-leave'});
        return;
      }
      deliver(p.frame, {...target, type: p.hover ? 'od:comment-hover' : 'od:comment-target'});
    }
    window.addEventListener('message', receive);
    return () => { pending.current = null; stroke.current = null; window.removeEventListener('message', receive); };
  }, []);
  function point(frame: HTMLIFrameElement, event: {clientX: number; clientY: number}): Point {
    const r = frame.getBoundingClientRect();
    return {x: (event.clientX - r.left) * frame.clientWidth / r.width, y: (event.clientY - r.top) * frame.clientHeight / r.height};
  }
  function query(event: React.PointerEvent, hover: boolean) {
    if (!event.nativeEvent.isTrusted || props.mode === 'pod') return;
    if (hover && pending.current && Date.now() - pending.current.at < 1500) return;
    const frame = props.frame(); if (!frame?.contentWindow) return;
    const id = randomUUID();
    pending.current = {id, frame, source: props.source, mode: props.mode, at: Date.now(), hover};
    frame.contentWindow.postMessage({type: 'od:comment-hit-test', request: id, hover, ...point(frame, event)}, '*');
  }
  return <div data-testid="comment-canvas-input" style={{position: 'absolute', inset: 0, zIndex: 10, touchAction: 'none'}}
    onPointerDown={event => {
      if (!event.nativeEvent.isTrusted || event.button !== 0) return;
      const frame = props.frame(); if (!frame) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      if (props.mode === 'pod') stroke.current = {frame, points: [point(frame, event)]};
      else query(event, false);
    }}
    onPointerMove={event => {
      if (!event.nativeEvent.isTrusted) return;
      const s = stroke.current;
      if (!s) { if (!event.buttons) query(event, true); return; }
      if (s.points.length < 512) s.points.push(point(s.frame, event));
      deliver(s.frame, {type: 'od:pod-stroke', points: s.points});
    }}
    onPointerUp={event => {
      if (!event.nativeEvent.isTrusted) return;
      const s = stroke.current; stroke.current = null;
      if (s) { s.points.push(point(s.frame, event)); deliver(s.frame, {type: 'od:pod-select', points: s.points}); }
    }}
    onPointerCancel={() => { const s = stroke.current; stroke.current = null; pending.current = null; if (s) deliver(s.frame, {type: 'od:pod-clear'}); }}
    onPointerLeave={event => {
      if (!event.nativeEvent.isTrusted) return;
      if (pending.current?.hover) pending.current = null;
      const frame = props.frame(); if (frame) deliver(frame, {type: 'od:comment-leave'});
    }}
    onWheel={event => { if (event.nativeEvent.isTrusted) props.frame()?.contentWindow?.postMessage({type: 'od:preview-scroll-by', left: event.deltaX, top: event.deltaY}, '*'); }} />;
}
