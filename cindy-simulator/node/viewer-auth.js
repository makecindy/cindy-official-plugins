'use strict';
// Injected into the embedded device page. Cindy's docked panel is not an HTTP
// origin, so the viewer capability cookie cannot be stored for this frame; the
// page therefore carries the capability in its own URL. Same-origin requests
// pass it along in Referer, but WebSocket handshakes send no Referer, so the
// stream URL needs the capability appended here.
(function () {
  const script = document.currentScript && document.currentScript.src;
  let token = null;
  try { token = script ? new URL(script, location.href).searchParams.get('cindyViewer') : null; } catch { token = null; }
  if (!token || typeof WebSocket !== 'function') return;
  const Native = WebSocket;
  function Authorized(url, protocols) {
    let target = url;
    try {
      const parsed = new URL(String(url), location.href);
      if ((parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && parsed.host === location.host && !parsed.searchParams.has('cindyViewer')) {
        parsed.searchParams.set('cindyViewer', token);
        target = parsed.toString();
      }
    } catch { /* leave non-URL inputs to the native constructor */ }
    return protocols === undefined ? new Native(target) : new Native(target, protocols);
  }
  Authorized.prototype = Native.prototype;
  for (const name of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Authorized[name] = Native[name];
  window.WebSocket = Authorized;
})();
