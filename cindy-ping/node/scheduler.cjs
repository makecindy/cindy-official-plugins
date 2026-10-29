'use strict';
const { randomUUID } = require('node:crypto');

// One global generation for every emote, including display-only emotes.
// Rendering has already happened in the native process before trigger is called.
class LatestAction {
  constructor({ capture, notify }) {
    this.capture = capture;
    this.notify = notify;
    this.current = null;
    this.timer = null;
    this.snapshot = null;
    this.capturing = false;
    this.pendingCapture = null;
  }
  invalidate(cancelled = false) {
    const id = this.current?.id;
    const gestureId = this.current?.event.gestureId;
    clearTimeout(this.timer);
    this.timer = null;
    this.current = null;
    this.snapshot = null;
    this.pendingCapture = null;
    this.notify('invalidate', { id, gestureId, cancelled });
  }
  trigger(event, emote) {
    clearTimeout(this.timer);
    const operation = { id: randomUUID(), event, emote: structuredClone(emote), deadline: Date.now() + 2000,
      elapsed: false, targetReady: !emote.target, captureReady: false, started: false, committed: false,
      inputReady: emote.promptMode !== 'input', inputRequested: false };
    this.current = operation;
    this.snapshot = null;
    this.pendingCapture = null;
    this.timer = null;
    this.notify('trigger', { id: operation.id, label: emote.label, action: emote.action,
      gestureId: event.gestureId, emote: operation.emote });
    if (emote.action === 'none') return;
    this.timer = setTimeout(() => { this.timer = null; operation.elapsed = true; this.prepare(operation); }, 2000);
    this.pendingCapture = operation;
    void this.captureNext();
  }
  resolveTarget(id, target) {
    if (!this.isCurrent(id) || this.current.started) return { current: false };
    if (!target) { this.invalidate(); return { current: false }; }
    this.current.target = target;
    this.current.targetReady = true;
    this.prepare(this.current);
    return { current: true };
  }
  async captureNext() {
    if (this.capturing || !this.pendingCapture) return;
    const operation = this.pendingCapture;
    this.pendingCapture = null;
    if (this.current !== operation) return;
    this.capturing = true;
    this.notify('capturing', { id: operation.id });
    try {
      const snapshot = await this.capture(operation);
      if (this.current !== operation) return;
      this.snapshot = snapshot;
      operation.captureReady = true;
      this.prepare(operation);
    } catch (error) {
      if (this.current === operation) this.notify('capture-error', { id: operation.id, code: error.code || error.message });
    } finally {
      this.capturing = false;
      void this.captureNext();
    }
  }
  prepare(operation) {
    if (this.current !== operation || !operation.captureReady || !operation.targetReady || operation.started) return;
    if (!operation.inputReady) {
      if (!operation.inputRequested) {
        operation.inputRequested = true;
        this.notify('input-required', { id: operation.id, label: operation.emote.label,
          prompt: '', point: operation.event.point, gestureId: operation.event.gestureId });
      }
      return;
    }
    if (!operation.elapsed) return;
    operation.started = true;
    this.notify('prepared', { id: operation.id, emote: operation.emote, target: operation.target,
      summary: { hasImage: !!this.snapshot.jpeg, hasText: !!this.snapshot.text, issues: this.snapshot.issues || [] } });
  }
  submitInput(id, text) {
    const operation = this.current;
    if (!this.isCurrent(id) || !operation.inputRequested || operation.inputReady || operation.started ||
        typeof text !== 'string' || !text.trim() || text.length > 8000 || text.includes('\0')) return { current: false };
    operation.emote.prompt = text;
    operation.inputReady = true;
    this.prepare(operation);
    return { current: true };
  }
  cancel(id) {
    if (!this.isCurrent(id) || this.current.committed) return { cancelled: false };
    this.invalidate(true);
    return { cancelled: true };
  }
  beginDispatch(id) {
    if (!this.isCurrent(id) || !this.current.started || this.current.committed) return { current: false };
    this.current.committed = true;
    return { current: true };
  }
  complete(id) {
    if (!this.isCurrent(id)) return { current: false };
    const gestureId = this.current.event.gestureId;
    clearTimeout(this.timer);
    this.timer = null;
    this.current = null;
    this.snapshot = null;
    this.pendingCapture = null;
    this.notify('complete', { id, gestureId });
    return { current: true };
  }
  isCurrent(id) { return this.current?.id === id; }
}
module.exports = { LatestAction };
