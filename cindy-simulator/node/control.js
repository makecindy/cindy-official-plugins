'use strict';
// Controller page: Cindy draws the chrome; the Baguette page in the iframe only
// renders the live screen. All strings and derived state live in control-model.js.
(() => {
  const M = globalThis.CindySimModel;
  const lang = document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en';
  const t = M.strings(lang);
  const params = new URLSearchParams(location.search);
  let udid = params.get('udid');
  const token = new URLSearchParams(location.hash.slice(1)).get('cindyClipboard')?.split('.')[1];
  const $ = (id) => document.getElementById(id);
  const screen = $('screen'), stage = $('stage'), scroll = $('scroll'), frame = $('frame'), overlay = $('overlay'), dock = $('dock');

  // Page state. `status` is the last successful status response; flags are page-local.
  const state = { status: null, lost: false, generation: null, zoom: { mode: 'fit' }, fitPct: 0, fullToolbar: false,
    recovering: false, stopping: false, switching: false, phase: null, lastTouch: 0, screenWidth: 0,
    pose: null, viewport: null };
  // Inside the management view the device list names the device; show a title instead of the switcher.
  const hub = params.get('embed') === 'hub';
  const store = { get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} } };
  const zoomKey = () => `cindy.zoom.${udid}`;
  state.zoom = store.get(zoomKey())?.mode === 'pct' ? store.get(zoomKey()) : { mode: 'fit' };

  const ICON = {
    phone: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2.5"/><path d="M12 18h.01"/></svg>',
    pad: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 18h.01"/></svg>',
    off: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg>',
    unplug: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m19 5 3-3"/><path d="m2 22 3-3"/><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/><path d="M7.5 13.5 10 11"/><path d="M10.5 16.5 13 14"/><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M10 15V9"/><path d="M14 15V9"/></svg>',
    check: '<svg class="check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>',
    shake: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2.5 3.5 4m15.5-1.5L20.5 4M3 20l1.5-1.5M21 20l-1.5-1.5"/><rect width="10" height="16" x="7" y="4" rx="2"/></svg>',
    grid: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="14" rx="1.5"/><rect width="7" height="7" x="3" y="14" rx="1.5"/></svg>',
    bar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/></svg>',
    key: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
    power: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    ok: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
  };

  function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  async function api(action, extra = {}) {
    let r;
    try {
      r = await fetch('/control-api', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cindy-Clipboard': token },
        // Every control action uses the worker's existing request budget (115s).
        // Keep the HTTP response alive through it, including screenshots and recovery.
        body: JSON.stringify({ ...extra, action, udid, locale: lang }), signal: AbortSignal.timeout(120000) });
    } catch (error) {
      // Nothing answers on this address: the plugin's service is gone.
      throw Object.assign(Error('SERVICE_STOPPED'), { code: error?.name === 'TimeoutError' ? 'TIMEOUT' : 'SERVICE_STOPPED' });
    }
    // A service answers but no longer accepts this page's capability.
    if (r.status === 403) throw Object.assign(Error('VIEWER_EXPIRED'), { code: 'VIEWER_EXPIRED' });
    const p = await r.json();
    if (!r.ok || p.ok === false) throw Object.assign(Error(p.errorCode || 'CONTROL_FAILED'), { code: p.errorCode });
    return p;
  }

  // ---- stage / iframe ----
  function load() {
    state.generation = state.status?.generation ?? state.generation;
    // The capability travels in the frame URL: Cindy's panel is not an HTTP
    // origin, so this frame can hold no cookie.
    // The device with its bezel, like Simulator; the guest owns its orientation.
    screen.src = !M.handheld(state.status?.device)
      ? `/platform-stage.html?udid=${encodeURIComponent(udid)}&lang=${lang}&platform=${M.platform(state.status?.device)}&cindyViewer=${encodeURIComponent(token || '')}`
      : `/simulators/${encodeURIComponent(udid)}?handheld=0${state.fullToolbar ? '&cindyFull=1' : ''}${token ? `&cindyViewer=${encodeURIComponent(token)}` : ''}${location.hash}`;
    state.viewport = null; state.fitPct = 0; state.pose = null;
  }
  function blank() { state.generation = null; screen.src = 'about:blank'; }
  // ---- zoom ----
  // The device page fits the device into its frame; zoom resizes that frame.
  // Percentages are of actual size (one device point per CSS pixel).
  function stageSize() {
    const bounds = stage.getBoundingClientRect();
    const css = M.handheld(state.status?.device) ? null : globalThis.getComputedStyle?.(frame);
    const insetX = parseFloat(css?.paddingLeft || 0) + parseFloat(css?.paddingRight || 0);
    const insetY = parseFloat(css?.paddingTop || 0) + parseFloat(css?.paddingBottom || 0);
    return {width: Math.max(0,bounds.width - insetX),height: Math.max(0,bounds.height - insetY),insetX,insetY};
  }
  function applyZoom() {
    const { width, height, insetX, insetY } = stageSize();
    const factor = !M.handheld(state.status?.device) && state.zoom.mode === 'pct' && state.fitPct > 0
      ? state.zoom.pct / state.fitPct : M.zoomFactor(state.zoom, state.fitPct);
    // Keep the point at the centre of the view in place while the frame grows or shrinks.
    const cx = scroll.scrollWidth > scroll.clientWidth ? (scroll.scrollLeft + scroll.clientWidth / 2) / scroll.scrollWidth : 0.5;
    const cy = scroll.scrollHeight > scroll.clientHeight ? (scroll.scrollTop + scroll.clientHeight / 2) / scroll.scrollHeight : 0.5;
    frame.style.width = Math.round(width * factor + insetX) + 'px';
    frame.style.height = Math.round(height * factor + insetY) + 'px';
    if (factor > 1.001) stage.setAttribute('data-zoomed', ''); else stage.removeAttribute('data-zoomed');
    scroll.scrollLeft = cx * scroll.scrollWidth - scroll.clientWidth / 2;
    scroll.scrollTop = cy * scroll.scrollHeight - scroll.clientHeight / 2;
    renderZoom();
  }
  async function viewport() {
    if (state.viewport) return state.viewport;
    try {
      if (!M.handheld(state.status?.device)) {
        const v = await api('viewport');
        if (v?.width > 0 && v?.height > 0) state.viewport = { width: v.width, height: v.height };
        return state.viewport;
      }
      const w = screen.contentWindow;
      const def = await (await w.fetch(`/simulators/${encodeURIComponent(udid)}/definition.json`)).json();
      const v = def?.screen?.viewport;
      if (v?.width > 0 && v?.height > 0) state.viewport = { width: v.width, height: v.height };
    } catch {}
    return state.viewport;
  }
  // What the fitted device measures, in percent of actual size. The 3D stage
  // (foldables) has no fixed size, so its zoom is relative to fit.
  async function measure() {
    let doc; try { doc = screen.contentDocument; } catch { return; }
    const v = await viewport();
    if (!M.handheld(state.status?.device)) {
      const {width,height} = stageSize();
      if (!v || !(width > 0 && height > 0)) return;
      const fit = Math.min(width / v.width, height / v.height) * 100;
      if (Math.abs(fit - state.fitPct) > 0.01) { state.fitPct = fit; applyZoom(); }
      else renderZoom();
      return;
    }
    const device = doc?.getElementById('nativeDeviceFrame');
    const rect = device?.getBoundingClientRect();
    if (!v || !rect?.width || doc.getElementById('simNativeView')?.getAttribute('data-render3d') === 'open') { state.fitPct = 0; renderZoom(); return; }
    const shown = Math.max(rect.width, rect.height) / Math.max(v.width, v.height) * 100;
    state.fitPct = shown / M.zoomFactor(state.zoom, state.fitPct || shown);
    renderZoom();
  }
  function setZoom(zoom) {
    state.zoom = zoom; store.set(zoomKey(), zoom);
    applyZoom(); setTimeout(measure, 350);
  }
  const zoomBy = (direction) => setZoom({ mode: 'pct', pct: M.zoomStep(M.zoomPct(state.zoom, state.fitPct), direction) });
  function renderZoom() {
    const pct = M.zoomPct(state.zoom, state.fitPct);
    $('zoom-label').textContent = state.zoom.mode === 'fit' ? t.zoomFitShort : `${pct}%`;
    $('zoom-label').title = state.zoom.mode === 'fit' && state.fitPct ? `${t.zoomFit} · ${pct}%` : t.zoom;
    $('zoom-out').disabled = pct <= M.ZOOM_STEPS[0];
    $('zoom-in').disabled = pct >= M.ZOOM_STEPS.at(-1);
  }
  function decorate() {
    let doc; try { doc = screen.contentDocument; } catch { return; }
    if (!doc?.documentElement || doc.location?.href === 'about:blank') return;
    if (state.fullToolbar) { doc.documentElement.setAttribute('data-cindy-full', ''); stage.setAttribute('data-full', ''); } else { doc.documentElement.removeAttribute('data-cindy-full'); stage.removeAttribute('data-full'); }
    const view = doc.getElementById('simNativeView');
    const width = view ? parseFloat(doc.defaultView.getComputedStyle(view).getPropertyValue('--nv-hh-w')) : 0;
    if (width && width !== state.screenWidth) {
      state.screenWidth = width;
      doc.documentElement.style.setProperty('--cindy-screen-radius', M.screenRadius(state.status?.device, width) + 'px');
    }
  }
  function activity(event) {
    if (event && !event.isTrusted) return;
    if (!state.status || state.status.device?.state !== 'Booted' || state.switching || Date.now() - state.lastTouch < 10000) return;
    state.lastTouch = Date.now();
    api('activity').catch(() => {});
  }
  screen.addEventListener('load', () => {
    decorate();
    try {
      const doc = screen.contentDocument;
      for (const name of ['pointerdown', 'keydown', 'wheel']) doc?.addEventListener(name, activity, { passive: true, capture: true });
      // Before the device page forwards keys to the simulator.
      doc?.defaultView?.addEventListener('keydown', shortcut, true);
      doc?.defaultView?.addEventListener('resize', () => { setTimeout(decorate, 50); setTimeout(measure, 120); });
    } catch {}
    setTimeout(decorate, 300); setTimeout(decorate, 1500); setTimeout(measure, 800); setTimeout(measure, 2500);
  });
  const native = (name, ...args) => { try { const fn = screen.contentWindow?.[name]; if (typeof fn === 'function') { fn(...args); return true; } } catch {} return false; };

  // ---- rendering ----
  const live = () => { const s = state.lost ? null : state.status; return !!s?.ready && s.device?.state === 'Booted' && !state.switching && !state.recovering && !state.stopping; };
  const label = (node, text, keys) => { node.title = keys ? `${text}  ${keys}` : text; node.setAttribute('aria-label', text); node.setAttribute('aria-description', node.title); };
  function renderBar() {
    const s = state.lost ? null : state.status;
    const p = M.presence(s, state);
    const device = s?.device || state.status?.device;
    $('device-chip').hidden = hub; $('title').hidden = !hub;
    $('chip-dot').dataset.tone = $('title-dot').dataset.tone = p.tone;
    $('chip-name').textContent = $('title-name').textContent = device?.name || '…';
    $('title-sub').textContent = [M.runtimeLabel(device?.runtime), t[p.key]].filter(Boolean).join(' · ');
    $('status').textContent = t[p.key];
    const on = live();
    const handheld = M.handheld(device);
    $('tools').hidden = !on;
    $('btn-rotl').hidden = $('btn-rotr').hidden = !handheld;
    $('tv-remote').hidden = !on || M.platform(device) !== 'tvOS';
    visionBar.hidden = !on || M.platform(device) !== 'visionOS';
    stage.dataset.vision = M.platform(device) === 'visionOS' ? 'true' : 'false';
    for (const id of ['btn-home', 'btn-shot', 'btn-shot-menu', 'btn-rotl', 'btn-rotr']) $(id).disabled = !on;
    $('btn-shot').disabled = !on || !!$('btn-shot').dataset.busy;
    label($('btn-home'), M.platform(device)==='visionOS'?(lang==='zh-CN'?'主屏幕（数码旋钮）':'Home (Digital Crown)'):t.home, '⇧⌘H'); label($('btn-shot'), `${t.screenshot} · ${shotTo() === 'clipboard' ? t.shotToClipboard : t.shotToDesktop}`, '⌘S'); label($('btn-shot-menu'), t.shotTo);
    label($('btn-rotl'), t.rotateLeft, '⌘←'); label($('btn-rotr'), t.rotateRight, '⌘→');
    label($('zoom-out'), t.zoomOut, '⌘−'); label($('zoom-in'), t.zoomIn, '⌘+'); label($('btn-more'), t.more);
    $('device-chip').title = t.devices;
    renderPosture();
  }
  function renderOverlay() {
    const s = state.lost ? null : state.status;
    const o = M.overlay(s, state);
    overlay.replaceChildren();
    overlay.hidden = !o;
    if (o) stage.setAttribute('data-dim', ''); else stage.removeAttribute('data-dim');
    if (!o) return;
    const name = state.status?.device?.name || '';
    const card = (glyph, title, body, actions) => h('div', { class: 'card' }, [
      h('div', { class: 'glyph', html: glyph }), h('h2', { text: title }), body && h('p', { text: body }),
      actions && h('div', { class: 'actions' }, actions)]);
    const busy = (label) => h('div', { class: 'card plain' }, [h('div', { class: 'spinner' }), h('p', { text: label })]);
    if (o.kind === 'offline') overlay.append(card(ICON.unplug, t.offlineTitle, t.offlineBody, [h('button', { class: 'btn primary', text: t.recover, onclick: recover })]));
    else if (o.kind === 'serviceOff') overlay.append(card(ICON.unplug, t.serviceOffTitle, t.serviceOffBody, [h('button', { class: 'btn', text: t.retry, onclick: check })]));
    else if (o.kind === 'expired') overlay.append(card(ICON.unplug, t.expiredTitle, t.expiredBody));
    else if (o.kind === 'off') overlay.append(card(ICON.off, t.offTitle(name), t.offBody, [h('button', { class: 'btn cta', text: t.boot, onclick: boot })]));
    else if (o.kind === 'paused') overlay.append(card(ICON.pause, t.pausedTitle, t.pausedBody));
    else if (o.kind === 'switching') {
      const target = state.status?.devices?.find((d) => d.udid === state.switchTarget)?.name || '';
      const phase = t.switching[o.phase] || t.switching.preparing;
      overlay.append(busy(typeof phase === 'function' ? phase(o.phase === 'stopping' ? name : target) : phase));
    } else overlay.append(busy(t[o.kind] || t.connecting));
  }
  let toastTimer = null;
  function toast(text, tone = 'info', action) {
    dock.querySelector?.('.toast')?.remove?.();
    const node = h('div', { class: 'toast', 'data-tone': tone, role: 'status' }, [h('span', { class: 'ico', html: ICON[tone] || ICON.info }), h('span', { text }),
      action && h('button', { class: 'toast-action', text: action.label, onclick: () => { node.remove(); action.run(); } })]);
    dock.append(node); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.remove(), action ? 8000 : 4000);
  }
  function renderIdle() {
    const left = M.idleLeft(state.lost ? null : state.status, Date.now());
    const existing = dock.querySelector?.('.idle');
    if (left === null) { existing?.remove?.(); return; }
    if (existing) { existing.querySelector('strong').textContent = t.idleTitle(M.clock(left)); return; }
    dock.append(h('div', { class: 'idle', role: 'status' }, [
      h('div', { class: 'text' }, [h('strong', { text: t.idleTitle(M.clock(left)) }), h('small', { text: t.idleBody })]),
      h('button', { class: 'btn primary', text: t.keepUsing, onclick: () => { state.lastTouch = 0; activity(); state.status.idleDeadline = Date.now() + 15 * 60000; renderIdle(); } })]));
  }
  function render() { renderBar(); renderOverlay(); renderIdle(); }

  // ---- status loop ----
  let checking = false;
  async function check() {
    if (checking) return; checking = true;
    try {
      const s = await api('status');
      state.status = s; state.lost = false;
      // A completed selection may point at a stopped device. Use its own
      // state immediately, never load its stream using the source's state.
      if (s.device?.udid !== udid) s.device = s.devices?.find((d) => d.udid === udid);
      if (!state.switching && s.device?.state === 'Booted' && s.viewerPlatform && (s.device.platform==='android'?'android':'ios')!==s.viewerPlatform) {
        const opened=await api('open');
        if(opened.url){const next=new URL(opened.url);for(const key of ['task','embed'])if(params.get(key))next.searchParams.set(key,params.get(key));location.replace(next.href);return;}
      }
      if (!state.switching && s.device?.state === 'Booted' && s.ready) {
        let unavailable = false; try { unavailable = !!screen.contentDocument?.querySelector('[data-viewer-unavailable]'); } catch {}
        if (state.generation === null || screen.src === 'about:blank' || unavailable) load();
        else decorate();
      }
      if (s.device?.state === 'Shutdown' && screen.src !== 'about:blank') blank();
    } catch (error) {
      state.lost = error.code === 'SERVICE_STOPPED' ? 'stopped' : error.code === 'VIEWER_EXPIRED' ? 'expired' : true;
      // The screen frame died with the service; reload it once the service is back.
      if (state.lost !== true && screen.src !== 'about:blank') blank();
    }
    finally { checking = false; render(); }
  }
  function adopt(id) {
    udid = id; state.generation = null; state.screenWidth = 0;
    const url = new URL(location.href); url.searchParams.set('udid', id); history.replaceState(null, '', url);
    blank();
  }

  // ---- actions ----
  async function recover() {
    if (state.recovering) return;
    state.recovering = true; blank(); render();
    try { const s = await api('restart'); state.generation = s.generation; state.lost = false; load(); }
    catch { state.lost = true; }
    finally { state.recovering = false; render(); }
  }
  async function boot() {
    if (state.stopping || state.switching) return;
    state.status = { ...state.status, device: { ...state.status?.device, state: 'Booting' } }; render();
    try { await api('boot'); state.generation = null; } catch (error) { toast(error.code === 'RUNTIME_DISABLED' ? t.pausedTitle : t.actionFailed, 'error'); }
    await check();
  }
  function confirmShutdown() {
    const name = state.status?.device?.name || '';
    $('confirm-title').textContent = t.confirmShutdownTitle(name); $('confirm-body').textContent = t.confirmShutdownBody;
    $('confirm-cancel').textContent = t.cancel; $('confirm-ok').textContent = t.confirmShutdown;
    $('confirm-dialog').showModal();
  }
  $('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close());
  $('confirm-ok').addEventListener('click', async () => {
    $('confirm-dialog').close();
    if (state.stopping || state.switching) return;
    state.stopping = true; blank(); render();
    try {
      const result = await api('shutdown');
      if (!result.devices?.some((d) => d.udid === udid && d.state === 'Shutdown')) throw Error('UNCONFIRMED');
      toast(t.stopped, 'ok');
    } catch { toast(t.actionFailed, 'error'); }
    finally { state.stopping = false; await check(); }
  });
  async function release() {
    try { screen.contentWindow?.postMessage({ type: 'cindy-release-input' }, location.origin); } catch {}
    try { await api('release'); toast(t.released, 'ok'); } catch { toast(t.actionFailed, 'error'); }
  }
  async function screenshot() {
    if (!live() || $('btn-shot').dataset.busy) return;
    $('btn-shot').dataset.busy = '1'; $('btn-shot').disabled = true;
    flash();
    const to = shotTo();
    try {
      const r = await api('screenshot', { to });
      if(to==='clipboard'&&r.clipboardPng){const bytes=Uint8Array.from(atob(r.clipboardPng),c=>c.charCodeAt(0));await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([bytes],{type:'image/png'})})]);}
      if (to === 'clipboard') toast(t.shotCopied, 'ok');
      else toast(t.shotDesktop, 'ok', r.path && { label: t.reveal, run: () => api('reveal', { path: r.path }).catch(() => {}) });
    }
    catch { toast(t.shotFailed, 'error'); }
    finally { delete $('btn-shot').dataset.busy; renderBar(); }
  }
  // Where the screenshot button puts the image: the Desktop (as Simulator
  // does) or the clipboard. One choice for every device, picked from the caret.
  const shotTo = () => store.get('cindy.shotTo') === 'clipboard' ? 'clipboard' : 'desktop';
  $('btn-shot-menu').addEventListener('click', () => {
    const choice = (to, text) => h('button', { class: 'item', role: 'menuitemradio', 'aria-checked': String(shotTo() === to), onclick: () => { closeMenu(); store.set('cindy.shotTo', to); renderBar(); } },
      [h('span', { class: 'label', text }), h('span', { html: shotTo() === to ? ICON.check : '' })]);
    showMenu($('btn-shot-menu'), [h('div', { class: 'menu-title', text: t.shotTo }), choice('desktop', t.shotToDesktop), choice('clipboard', t.shotToClipboard)]);
  });
  // A brief shutter flash over the device, as Simulator does.
  function flash() {
    const node = h('div', { class: 'flash' }); stage.append(node); setTimeout(() => node.remove(), 450);
  }
  async function press(button) {
    if (!live()) return;
    try {
      const controller=screen.contentWindow?.cindyPlatform;
      if(!controller)throw Object.assign(Error('INPUT_NOT_READY'),{code:'INPUT_NOT_READY'});
      await controller.press(button);
    } catch (error) { toast(`${t.actionFailed} (${error.code || 'INPUT_FAILED'})`, 'error'); }
  }
  function home() { if (!M.handheld(state.status?.device)) return press('home'); if (live() && native('__nativeHome')) activity({ isTrusted: true }); }
  $('tv-remote').addEventListener('click', event => { const button = event.target.closest('[data-remote]'); if (button) press(button.dataset.remote); });
  for(const node of [$('tv-remote'),$('btn-home')])node.addEventListener('pointerdown',event=>{
    if(event.button===0&&live()&&!M.handheld(state.status?.device))event.preventDefault();
  }); // Keep device focus: clicking a remote control must not cancel its swipe.
  const visionBar=h('div',{id:'vision-controls',class:'vision-controls',role:'group',hidden:true});
  const visionNames=lang==='zh-CN'?['交互','转向','平移','环绕','前后移动','复位视角','双手缩放与旋转','键盘输入','捕获指针（Esc 退出）','操作说明','录屏']:
    ['Interact','Tilt camera','Pan camera','Orbit camera','Dolly camera','Reset camera','Two-hand scale and rotate','Capture keyboard','Capture pointer (Esc to exit)','Controls help','Record'];
  const visionModes=['interact','tilt','pan','orbit','dolly','reset','two-hands','keyboard','pointer','help','record'];
  const visionTips=lang==='zh-CN'?
    ['单击选择交互模式，在画面中点击、长按或拖动物体。','','','','','单击恢复初始视角，保留当前指针模式。','开启后在画面中横向拖动缩放、纵向拖动旋转；再次单击关闭。','开启后把文字和按键传入设备；再次单击关闭，Esc 退出。','开启后把鼠标相对移动和按键传入设备；Esc 退出。','','单击开始录屏，再次单击停止并保存。']:
    ['Click to interact with objects by clicking, holding or dragging in the view.','','','','','Click to restore the starting view without changing pointer mode.','Enable horizontal dragging to scale and vertical dragging to rotate; click again to disable.','Send text and keys to the device; click again to disable or press Esc.','Send relative mouse movement and buttons to the device; Esc releases capture.','','Click to record; click again to stop and save.'];
  let cameraButtonDrag=null,suppressCameraClick=false;
  function endCameraButtonDrag(discard=false){
    const d=cameraButtonDrag;if(!d)return;cameraButtonDrag=null;
    d.gesture?.end(discard);delete d.button.dataset.dragging;
    if(d.button.hasPointerCapture(d.id))d.button.releasePointerCapture(d.id);
  }
  window.addEventListener?.('blur',()=>endCameraButtonDrag(true));
  window.addEventListener?.('pagehide',()=>endCameraButtonDrag(true));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)endCameraButtonDrag(true);});
  const paths=[
    '<path d="m6 3 12 9-6 1-3 6zM15 16l3 5"/>',
    '<circle cx="12" cy="12" r="8"/><path d="m12 4-3 4h6zM12 20l-3-4h6zM4 12l4-3v6zM20 12l-4-3v6z"/>',
    '<path d="M12 3v18M3 12h18m-13-5 4-4 4 4m-9 9-4-4 4-4m10 0 4 4-4 4m-9 1 4 4 4-4"/>',
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 13l6-6m-6 0h6v6"/>',
    '<rect x="3" y="5" width="14" height="14" rx="3"/><path d="m17 9 4-2v10l-4-2M7 10h5a3 3 0 0 1 0 6H9m0-9-3 3 3 3"/>',
    '<path d="m3 8 5-4v8m13-4-5-4v8M8 4l3 4m5-4-3 4M5 14l3 6h8l3-6"/>',
    '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8"/>',
    '<path d="m8 6 10 8-5 1-2 5zM4 4 2 2m10 0v2m8-2-2 2M2 12h2m16 0h2M4 18l-2 2"/>',
    '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01"/>',
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor"/>',
  ];
  for(const group of [[0,1,2,3,4],[5,6,7,8,10]]){
    const container=h('div',{class:'tool-group'});
    for(const i of group){const draggable=i>=1&&i<=4;
      const tip=visionNames[i]+(draggable?(lang==='zh-CN'?'：拖动此按钮临时调整视角，保留当前指针模式；单击切换画面拖动模式。':': drag this button to adjust the camera without changing pointer mode; click to select the canvas drag mode.'):' · '+visionTips[i]);
      const b=h('button',{class:'tool',title:tip,'aria-label':visionNames[i],'aria-description':tip,'data-vision':visionModes[i],'aria-pressed':i===5?null:i===0?'true':'false'});
      b.innerHTML=`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[i]}</svg>`;
      if(draggable){
        b.dataset.cameraDrag='true';
        b.addEventListener('pointerdown',e=>{
          if(!live()||e.button!==0||e.isPrimary===false)return;
          endCameraButtonDrag(true);suppressCameraClick=false;e.preventDefault();
          b.setPointerCapture(e.pointerId);
          cameraButtonDrag={id:e.pointerId,button:b,x:e.clientX,y:e.clientY,controller:screen.contentWindow?.cindyVision};
        });
        b.addEventListener('pointermove',e=>{
          const d=cameraButtonDrag;if(!d||d.button!==b||d.id!==e.pointerId)return;
          if(!live()||d.controller!==screen.contentWindow?.cindyVision){suppressCameraClick=true;endCameraButtonDrag(true);return;}
          const dx=e.clientX-d.x,dy=e.clientY-d.y;
          if(!d.started&&Math.hypot(dx,dy)<4)return;
          if(!d.started){d.started=true;suppressCameraClick=true;d.gesture=d.controller?.cameraDrag(visionModes[i]);b.dataset.dragging='true';}
          d.gesture?.move(dx,dy);
        });
        b.addEventListener('pointerup',e=>{if(cameraButtonDrag?.id===e.pointerId)endCameraButtonDrag();});
        for(const event of ['pointercancel','lostpointercapture'])b.addEventListener(event,()=>{if(cameraButtonDrag?.button===b){suppressCameraClick=true;endCameraButtonDrag(true);}});
      }
      b.addEventListener('click',e=>{
        if(draggable&&suppressCameraClick&&e.detail!==0){suppressCameraClick=false;return;}
        if(live())screen.contentWindow?.cindyVision?.choose(visionModes[i]);
      });container.append(b);}
    visionBar.append(container);
  }
  $('tools').append(visionBar);
  // The same help entry works with mouse, keyboard and touch on every device.
  const helpButton=h('button',{id:'btn-controls-help',class:'tool',title:M.controlHelp(lang).title,'aria-label':M.controlHelp(lang).title,'aria-haspopup':'dialog',html:ICON.info});
  const helpDialog=h('dialog',{id:'controls-help',class:'controls-help','aria-labelledby':'controls-help-title'});
  document.body.append(helpDialog);
  function showControlsHelp(){
    const help=M.controlHelp(lang,state.status?.device);
    endCameraButtonDrag(true);screen.contentWindow?.cindyVision?.cancel();
    helpDialog.replaceChildren(h('h2',{id:'controls-help-title',text:help.title}),
      ...help.common.map(text=>h('p',{class:'hint',text})),h('hr'),
      ...help.specific.map(text=>h('p',{text})),
      h('div',{class:'row'},[h('button',{class:'btn secondary',text:help.close,onclick:()=>helpDialog.close()})]));
    helpDialog.showModal();
  }
  helpButton.addEventListener('click',showControlsHelp);
  $('tools').append(h('div',{class:'tool-group'},[helpButton]));
  const remoteKeys={up:'↑',down:'↓',left:'←',right:'→',select:'Enter',back:'Esc','play-pause':'Space'};
  for(const b of $('tv-remote').querySelectorAll('[data-remote]'))label(b,b.getAttribute('aria-label'),remoteKeys[b.dataset.remote]);
  function rotate(step) {
    if (!live() || !M.handheld(state.status?.device)) return;
    // A foldable turns through viewer-stage.js, which animates the 3D book.
    let turned = false; try { turned = screen.contentWindow?.__cindyPose?.turn?.(step) === true; } catch {}
    const fn = screen.contentWindow?.__nativeRotateBy ? '__nativeRotateBy' : '__nativeRotate';
    if (!turned && !native(fn, step)) return;
    activity({ isTrusted: true });
    renderPosture();
    setTimeout(measure, 450);
  }
  $('btn-home').addEventListener('click', home);
  $('btn-rotl').addEventListener('click', () => rotate(-1));
  $('btn-rotr').addEventListener('click', () => rotate(1));
  $('btn-shot').addEventListener('click', screenshot);
  $('zoom-out').addEventListener('click', () => zoomBy(-1));
  $('zoom-in').addEventListener('click', () => zoomBy(1));
  $('zoom-label').addEventListener('click', () => {
    const pct = M.zoomPct(state.zoom, state.fitPct);
    const choice = (text, zoom, checked, keys) => h('button', { class: 'item', role: 'menuitemradio', 'aria-checked': String(checked), onclick: () => { closeMenu(); setZoom(zoom); } },
      [h('span', { class: 'label', text }), keys ? h('span', { class: 'keys', text: keys }) : h('span', { html: checked ? ICON.check : '' })]);
    showMenu($('zoom-label'), [
      choice(t.zoomFit, { mode: 'fit' }, state.zoom.mode === 'fit', '⌘0'),
      state.fitPct ? choice(t.zoomActual, { mode: 'pct', pct: 100 }, state.zoom.mode === 'pct' && pct === 100, '⌘1') : null,
      h('div', { class: 'sep' }),
      ...[50, 75, 100, 150, 200].map((p) => choice(`${p}%`, { mode: 'pct', pct: p }, state.zoom.mode === 'pct' && pct === p)),
    ]);
  });

  // ---- keyboard shortcuts (Simulator's) ----
  function shortcut(event) {
    const inDevice=event.currentTarget===screen.contentWindow||event.target?.ownerDocument===screen.contentDocument;
    if(live()&&inDevice&&screen.contentWindow?.cindyVision?.acceptsKeyboard())return;
    const remote = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'select', Escape: 'back', ' ': 'play-pause'};
    if (live() && M.platform(state.status?.device) === 'tvOS' && !event.metaKey && !event.ctrlKey && !event.altKey && remote[event.key]
      && !document.querySelector('dialog[open]') && !openMenu && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target?.tagName)) {
      event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) press(remote[event.key]); return;
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const k = event.key, handheld = M.handheld(state.status?.device), action =
      (k === '=' || k === '+') ? () => zoomBy(1) : k === '-' ? () => zoomBy(-1) : k === '0' ? () => setZoom({ mode: 'fit' })
        : (k === '1' && state.fitPct) ? () => setZoom({ mode: 'pct', pct: 100 })
          : (handheld && k === 'ArrowLeft') ? () => rotate(-1) : (handheld && k === 'ArrowRight') ? () => rotate(1)
            : (event.shiftKey && (k === 'h' || k === 'H')) ? home : (!event.shiftKey && (k === 's' || k === 'S')) ? screenshot : null;
    if (!action) return;
    event.preventDefault(); event.stopImmediatePropagation(); action();
  }
  document.addEventListener('keydown', shortcut, true);
  // Pinch or Ctrl+scroll over the stage (outside the device) zooms; on the device it stays a gesture.
  stage.addEventListener('wheel', (event) => {
    if (!event.ctrlKey || ![stage, scroll, frame].includes(event.target)) return;
    event.preventDefault();
    if (Math.abs(event.deltaY) < 2) return;
    const now = Date.now(); if (now - (stage.lastPinch || 0) < 120) return; stage.lastPinch = now;
    zoomBy(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // ---- foldable posture ----
  // viewer-stage.js exposes the 3D stage's hinge (window.__cindyPose); the
  // device page's own picker is hidden in favour of this one.
  const POSES = { shut: 0, open: 130, flat: 180 };
  // The glyphs turn with the device; the angle accumulates so each step takes the short way round.
  let glyphTurn = null;
  function renderPosture() {
    let pose = null, roll = 0; try { pose = screen.contentWindow?.__cindyPose?.get?.() ?? null; roll = screen.contentWindow.__cindyPose.roll?.() || 0; } catch {}
    const show = live() && pose !== null;
    const appearing = show && $('posture').hidden;
    $('posture').hidden = !show;
    if (!show) { glyphTurn = null; return; }
    if (appearing || glyphTurn === null) { glyphTurn = roll; $('posture').setAttribute('data-still', ''); }
    else { glyphTurn += ((roll - glyphTurn) % 360 + 540) % 360 - 180; $('posture').removeAttribute('data-still'); }
    $('posture').style.setProperty('--device-roll', glyphTurn + 'deg');
    const nearest = Object.entries(POSES).reduce((a, b) => Math.abs(b[1] - pose) < Math.abs(a[1] - pose) ? b : a)[0];
    for (const node of $('posture').querySelectorAll('[data-pose]')) {
      node.setAttribute('aria-checked', String(node.dataset.pose === nearest));
      label(node, t.pose[node.dataset.pose]);
    }
  }
  $('posture').addEventListener('click', (event) => {
    const node = event.target.closest('[data-pose]'); if (!node || !live()) return;
    try { screen.contentWindow.__cindyPose.set(POSES[node.dataset.pose]); activity({ isTrusted: true }); } catch {}
    for (const n of $('posture').querySelectorAll('[data-pose]')) n.setAttribute('aria-checked', String(n === node));
  });

  // ---- menus ----
  let openMenu = null;
  function closeMenu() { openMenu?.menu.remove(); openMenu?.scrim.remove(); openMenu?.anchor.setAttribute('aria-expanded', 'false'); openMenu = null; }
  function showMenu(anchor, items) {
    closeMenu();
    const menu = h('div', { class: 'menu', role: 'menu' }, items);
    const scrim = h('div', { class: 'scrim', onclick: closeMenu });
    const r = anchor.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight || 0;
    if (r.left + 240 > vw) menu.style.right = Math.max(8, Math.round(vw - r.right)) + 'px'; else menu.style.left = Math.round(r.left) + 'px';
    document.body.append(scrim, menu); anchor.setAttribute('aria-expanded', 'true'); openMenu = { menu, scrim, anchor };
    // Anchors in the bottom toolbar open upwards.
    const height = menu.getBoundingClientRect?.().height || 0;
    if (vh && r.bottom + 6 + height > vh && r.top - 6 - height > 0) menu.style.bottom = Math.round(vh - r.top + 6) + 'px';
    else menu.style.top = Math.round(r.bottom + 6) + 'px';
    menu.querySelector?.('button:not(:disabled)')?.focus?.();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  const item = (icon, label, onclick, extra = {}) => h('button', { class: 'item', role: 'menuitem', onclick: () => { closeMenu(); onclick(); }, ...extra }, [
    h('span', { html: icon }), h('span', { class: 'label', text: label })]);

  $('btn-more').addEventListener('click', () => {
    const on = live();
    showMenu($('btn-more'), [
      ...(state.status?.device?.platform === 'android' ? [item(ICON.key, lang === 'zh-CN' ? '返回' : 'Back', () => native('__nativeBack'), { disabled: !on })] : []),
      ['iOS','android'].includes(M.platform(state.status?.device)) ? item(ICON.shake, t.shake, () => native('__nativeShake'), { disabled: !on }) : null,
      ['iOS','android'].includes(M.platform(state.status?.device)) ? item(ICON.grid, t.appSwitcher, () => native('__nativeAppSwitcher'), { disabled: !on }) : null,
      ...(state.status?.device?.platform === 'android' ? [
        item(ICON.key, lang === 'zh-CN' ? '复制设备剪贴板' : 'Copy device clipboard', () => native('__nativeCopy'), {disabled:!on}),
        item(ICON.plus, lang === 'zh-CN' ? '导入 APK、图片或视频…' : 'Import APK, image or video…', () => native('__nativeImport'), {disabled:!on}),
        item(ICON.camera, screen.contentWindow?.__nativeRecording?.() ? (lang === 'zh-CN' ? '停止录像并保存' : 'Stop recording & save') : (lang === 'zh-CN' ? '开始录像' : 'Start recording'), () => native('__nativeRecord'), {disabled:!on}),
      ] : []),
      item(ICON.key, t.releaseKeys, release, { disabled: !on }),
      h('div', { class: 'sep' }),
      item(ICON.refresh, t.recover, recover, { disabled: state.recovering || state.switching }),
      M.platform(state.status?.device) === 'iOS' ? item(ICON.bar, t.advanced, () => { state.fullToolbar = !state.fullToolbar; load(); }, { role: 'menuitemcheckbox', 'aria-checked': String(state.fullToolbar) }) : null,
      h('div', { class: 'sep' }),
      item(ICON.power, t.shutdown, confirmShutdown, { 'data-danger': true, disabled: !state.status || state.status.device?.state !== 'Booted' || state.switching }),
    ]);
  });

  $('device-chip').addEventListener('click', () => {
    const rows = M.deviceRows(state.status?.devices, udid, lang);
    const paused = state.status?.settings?.enabled === false;
    showMenu($('device-chip'), [
      h('div', { class: 'head', text: t.devices }),
      ...rows.map((d) => h('button', { class: 'item', role: 'menuitemradio', 'aria-checked': String(d.current), disabled: paused || state.switching || !d.available || d.current,
        title: d.current ? t.current : t.switchTo, onclick: () => { closeMenu(); switchTo(d.udid); } }, [
        h('span', { class: 'dot', 'data-tone': d.tone }),
        h('span', { class: 'label' }, [h('span', { text: d.name }), h('span', { class: 'sub', text: d.meta })]),
        d.current ? h('span', { html: ICON.check }) : null])),
      h('div', { class: 'sep' }),
      item(ICON.plus, t.addDevice, () => openDialog('add'), { disabled: paused }),
      item(ICON.pencil, t.rename, () => openDialog('rename'), { disabled: paused }),
    ]);
  });
  async function switchTo(targetUdid) {
    if (state.switching) return;
    state.switching = true; state.phase = 'preparing'; state.switchTarget = targetUdid; blank(); render();
    // Inside a task page the switch also moves that task to the new device.
    try {
      const result = await api('switch', { targetUdid, ...(params.get('task') ? { task: params.get('task') } : {}) });
      // The request returns its final result after selection and task binding.
      // Shared status jobs belong to other pages and never change this page.
      const job = result.job;
      if (job.activeUdid && job.activeUdid !== udid) adopt(job.activeUdid);
      if (job.state === 'done') toast(t.switching.done, 'ok'); else toast(`${t.switching.failed} (${job.errorCode || 'SWITCH_FAILED'})`, 'error');
      if (job.taskBindingError || job.appContextError) toast(t.switching.recordFailed, 'error');
    }
    catch (error) { toast(`${t.switching.failed} (${error.code || 'SWITCH_FAILED'})`, 'error'); }
    finally { state.switching = false; state.phase = null; }
    await check();
  }

  // ---- add / rename dialog ----
  let catalog = null, mode = 'add';
  function fillRuntimes() {
    const runtime = $('f-runtime'), options = M.runtimesFor(catalog, $('f-model').value), previous = runtime.value;
    runtime.replaceChildren(...options.map((r) => h('option', { value: r.identifier, text: r.name })));
    runtime.value = options.some((r) => r.identifier === previous) ? previous : (options.at(-1)?.identifier || '');
    $('dialog-error').textContent = options.length ? '' : t.noRuntime;
    $('dialog-save').disabled = !options.length;
  }
  async function openDialog(kind) {
    mode = kind;
    const current = state.status?.devices?.find((d) => d.udid === udid);
    $('dialog-title').textContent = kind === 'add' ? t.dialogAdd : t.dialogRename;
    $('dialog-hint').textContent = kind === 'add' ? t.addHint : t.renameHint;
    $('f-name-text').textContent = t.name; $('f-model-text').textContent = t.model; $('f-runtime-text').textContent = t.runtime;
    $('dialog-cancel').textContent = t.cancel; $('dialog-save').textContent = kind === 'add' ? t.create : t.save;
    $('f-model-label').hidden = $('f-runtime-label').hidden = kind !== 'add';
    $('dialog-error').textContent = '';
    $('f-name').value = kind === 'rename' ? current?.name || '' : ''; delete $('f-name').dataset.edited;
    $('dialog-save').disabled = kind === 'add';
    $('device-dialog').showModal();
    if (kind === 'rename') { $('f-name').focus(); return; }
    $('dialog-error').textContent = t.loading;
    try {
      catalog = catalog || await api('catalog');
      const model = $('f-model');
      model.replaceChildren(...catalog.deviceTypes.map((d) => h('option', { value: d.identifier, text: d.name })));
      const choice = M.defaultChoice(catalog);
      if (choice) { model.value = choice.deviceType; fillRuntimes(); $('f-runtime').value = choice.runtime; $('f-name').value = choice.name; }
      else fillRuntimes();
      $('dialog-error').textContent = $('dialog-save').disabled ? t.noRuntime : '';
      $('f-name').focus();
    } catch (error) { $('dialog-error').textContent = `${t.actionFailed} (${error.code || 'CATALOG_FAILED'})`; }
  }
  $('f-model').addEventListener('change', () => { fillRuntimes(); if (!$('f-name').dataset.edited) $('f-name').value = catalog?.deviceTypes.find((d) => d.identifier === $('f-model').value)?.name || ''; });
  $('f-name').addEventListener('input', () => { $('f-name').dataset.edited = 'true'; });
  $('dialog-cancel').addEventListener('click', () => $('device-dialog').close());
  $('device-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('f-name').value.trim(); if (!name) return;
    $('dialog-save').disabled = true; $('dialog-error').textContent = '';
    try {
      if (mode === 'add') await api('create', { name, deviceType: $('f-model').value, runtime: $('f-runtime').value });
      else await api('rename', { name, targetUdid: udid });
      $('device-dialog').close(); toast(mode === 'add' ? t.created : t.saved, 'ok'); await check();
    } catch (error) { $('dialog-error').textContent = `${t.actionFailed} (${error.code || 'FAILED'})`; }
    finally { $('dialog-save').disabled = false; }
  });

  // ---- boot ----
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { applyZoom(); clearTimeout(stage.remeasure); stage.remeasure = setTimeout(measure, 200); }).observe(stage);
    new ResizeObserver(()=>{
      stage.style.setProperty('--tools-inset',Math.max(64,$('tools').getBoundingClientRect().height+24)+'px');
      applyZoom();clearTimeout(stage.remeasure);stage.remeasure=setTimeout(measure,200);
    }).observe($('tools'));
  }
  applyZoom();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  render(); check();
  setInterval(check, 3000);
  setInterval(renderIdle, 1000);
  setInterval(renderPosture, 700);
  globalThis.cindySim = { state, check, api, recover, boot, native, applyZoom, decorate, setZoom, rotate, measure };
})();
