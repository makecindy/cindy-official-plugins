import React, { forwardRef, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';

export interface InlineTextHandle { finish(commit: boolean): Promise<boolean> }
// Runs in the editor origin. The artifact never receives this input's value or
// one-use credential, and cannot synthesize trusted input events on it.
export const ManualInlineTextEditor = forwardRef<InlineTextHandle, {
  originalText: string;
  style: CSSProperties;
  onApply(value: string): Promise<boolean>;
  onClose(): void;
  label: string;
  saveLabel: string;
  cancelLabel: string;
}>((props, ref) => {
  const [value, setValue] = useState(props.originalText);
  const [saving, setSaving] = useState(false);
  const draft = useRef(props.originalText);
  const credential = useRef<string | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  function authorize(event: Event) {
    if (!event.isTrusted) return false;
    credential.current = crypto.randomUUID();
    return true;
  }
  function finish(commit: boolean): Promise<boolean> {
    if (inFlight.current) return inFlight.current;
    if (!commit || draft.current === props.originalText) {
      credential.current = null;
      props.onClose();
      return Promise.resolve(true);
    }
    if (!credential.current) return Promise.resolve(false);
    credential.current = null; // consume before any asynchronous work
    setSaving(true);
    const pending = Promise.resolve().then(() => props.onApply(draft.current)).then(ok => {
      if (ok) props.onClose();
      return ok;
    }).catch(() => false).finally(() => {
      inFlight.current = null;
      setSaving(false);
    });
    inFlight.current = pending;
    return pending;
  }
  useImperativeHandle(ref, () => ({ finish }));
  return <div data-testid="manual-inline-editor" style={{...props.style, zIndex: 10000, background:'#fff', color:'#222', padding:8, border:'2px solid #6749ac', borderRadius:8, boxShadow:'0 4px 16px #0002'}}>
    <textarea autoFocus aria-label={props.label} value={value} disabled={saving}
      style={{width:'100%', minHeight:60, font:'inherit', color:'inherit', boxSizing:'border-box'}}
      onChange={event => {
        if (!authorize(event.nativeEvent)) return;
        draft.current = event.currentTarget.value;
        setValue(draft.current);
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || !event.nativeEvent.isTrusted) return;
        if (event.key === 'Escape') { event.preventDefault(); void finish(false); }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault(); authorize(event.nativeEvent); void finish(true);
        }
      }} />
    <div style={{display:'flex', gap:8}}>
      <button disabled={saving} onClick={event => { if (authorize(event.nativeEvent)) void finish(true); }}>{props.saveLabel}</button>
      <button disabled={saving} onClick={event => { if (event.nativeEvent.isTrusted) void finish(false); }}>{props.cancelLabel}</button>
    </div>
  </div>;
});
