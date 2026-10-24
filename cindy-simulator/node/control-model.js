'use strict';
// Pure view logic for the controller page. No DOM, no network: control.js
// renders what these functions return, and the unit tests exercise them directly.
(function (root) {
  const STRINGS = {
    'zh-CN': {
      connected: '运行中', connecting: '正在连接画面…', recovering: '正在恢复画面…', offline: '画面已断开', off: '已关闭',
      paused: '运行已关闭', booting: '正在启动…', stopping: '正在关闭…', unknown: '状态未知',
      home: '主屏幕', rotate: '旋转', screenshot: '截图', more: '更多', shake: '摇一摇', appSwitcher: 'App 切换器',
      zoom: '画面大小', zoomFit: '适合窗口', fullToolbar: '显示完整工具栏', releaseKeys: '解除卡键', recover: '恢复画面', shutdown: '关闭设备',
      devices: '设备', addDevice: '添加设备', rename: '重命名', switchTo: '切换到此设备', current: '当前',
      offlineTitle: '画面已断开', offlineBody: '设备可能仍在运行。恢复画面不会影响 App。',
      serviceOff: '服务已停止', expired: '画面已过期', retry: '立即重试',
      serviceOffTitle: '模拟器服务已停止', serviceOffBody: '在对话里让 Cindy 打开模拟器，或到「插件 → 设备模拟器」点「打开画面」。服务回来后这里会自动接上。',
      expiredTitle: '这个画面已过期', expiredBody: '插件换了新的画面地址。在对话里让 Cindy 打开模拟器，或到「插件 → 设备模拟器」点「打开画面」。',
      offTitle: (name) => `${name} 已关闭`, offBody: 'App 已退出，数据保留。', boot: '打开',
      pausedTitle: '模拟器运行已关闭', pausedBody: '在「插件 → 设备模拟器」里打开开关后即可继续。',
      idleTitle: (left) => `${left} 后自动关闭`, idleBody: '一段时间没有操作。继续使用会重新计时。', keepUsing: '继续使用',
      confirmShutdownTitle: (name) => `关闭 ${name}？`, confirmShutdownBody: 'App 会退出，设备数据和登录状态保留。', cancel: '取消', confirmShutdown: '关闭',
      stopped: '设备已关闭', released: '按键已释放', shotSaved: '截图已保存', shotFailed: '截图失败', actionFailed: '操作没有完成，请核对设备状态',
      switching: { preparing: '正在切换…', done: '已切换', failed: '切换没有完成', recordFailed: '任务绑定未保存，请检查存储' },
      dialogAdd: '添加设备', dialogRename: '重命名', name: '名称', model: '机型', runtime: '系统版本', create: '创建', save: '保存',
      addHint: '新设备创建后保持关闭，点击「打开」才会启动。', renameHint: '改名不影响 App 和数据。',
      noRuntime: '没有可用的系统版本。请先在 Xcode 或插件的安卓设置中安装。', loading: '正在读取机型…', created: '已创建', saved: '已保存',
      runningMeta: '运行中', offMeta: '已关闭', busyMeta: '处理中',
      rotateLeft: '向左旋转', rotateRight: '向右旋转', zoomIn: '放大', zoomOut: '缩小', zoomActual: '实际大小', zoomFitShort: '适合',
      pose: { shut: '合上', open: '半展开', flat: '展开' }, posture: '姿态',
      shotDesktop: '截图已存到桌面', shotCopied: '截图已拷贝到剪贴板', shotTo: '截图存到', shotToDesktop: '桌面', shotToClipboard: '剪贴板', reveal: '在访达中显示', advanced: 'Baguette 高级工具',
    },
    en: {
      connected: 'Running', connecting: 'Connecting…', recovering: 'Recovering view…', offline: 'View disconnected', off: 'Shut down',
      paused: 'Simulators off', booting: 'Starting…', stopping: 'Shutting down…', unknown: 'State unknown',
      home: 'Home', rotate: 'Rotate', screenshot: 'Screenshot', more: 'More', shake: 'Shake', appSwitcher: 'App Switcher',
      zoom: 'View size', zoomFit: 'Fit window', fullToolbar: 'Show full toolbar', releaseKeys: 'Release stuck keys', recover: 'Recover view', shutdown: 'Shut down device',
      devices: 'Devices', addDevice: 'Add device', rename: 'Rename', switchTo: 'Switch to this device', current: 'Current',
      offlineTitle: 'View disconnected', offlineBody: 'The device may still be running. Recovering the view does not affect the app.',
      serviceOff: 'Service stopped', expired: 'View expired', retry: 'Retry now',
      serviceOffTitle: 'The simulator service stopped', serviceOffBody: 'Ask Cindy in the chat to open the simulator, or choose Open in Plugins → Device Simulator. This view reconnects on its own when the service is back.',
      expiredTitle: 'This view has expired', expiredBody: 'The plugin now uses a new view address. Ask Cindy in the chat to open the simulator, or choose Open in Plugins → Device Simulator.',
      offTitle: (name) => `${name} is shut down`, offBody: 'Apps quit; data is kept.', boot: 'Open',
      pausedTitle: 'Simulators are turned off', pausedBody: 'Turn them on in Plugins → Device Simulator to continue.',
      idleTitle: (left) => `Shuts down in ${left}`, idleBody: 'No activity for a while. Keep using resets the timer.', keepUsing: 'Keep using',
      confirmShutdownTitle: (name) => `Shut down ${name}?`, confirmShutdownBody: 'Apps quit. Device data and sign-ins are kept.', cancel: 'Cancel', confirmShutdown: 'Shut down',
      stopped: 'Device shut down', released: 'Keys released', shotSaved: 'Screenshot saved', shotFailed: 'Screenshot failed', actionFailed: 'Not completed. Check the device state.',
      switching: { preparing: 'Switching…', done: 'Switched', failed: 'Switch did not finish', recordFailed: 'Task binding was not saved. Check storage.' },
      dialogAdd: 'Add device', dialogRename: 'Rename', name: 'Name', model: 'Model', runtime: 'OS version', create: 'Create', save: 'Save',
      addHint: 'New devices stay off until you click Open.', renameHint: 'Renaming keeps apps and data.',
      noRuntime: 'No runtime available. Install one in Xcode or the plugin Android settings first.', loading: 'Loading models…', created: 'Created', saved: 'Saved',
      runningMeta: 'Running', offMeta: 'Off', busyMeta: 'Busy',
      rotateLeft: 'Rotate Left', rotateRight: 'Rotate Right', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', zoomActual: 'Actual Size', zoomFitShort: 'Fit',
      pose: { shut: 'Closed', open: 'Half open', flat: 'Flat' }, posture: 'Posture',
      shotDesktop: 'Screenshot saved to Desktop', shotCopied: 'Screenshot copied to the clipboard', shotTo: 'Save Screenshots To', shotToDesktop: 'Desktop', shotToClipboard: 'Clipboard', reveal: 'Show in Finder', advanced: 'Baguette advanced tools',
    },
  };

  const strings = (lang) => STRINGS[lang] || STRINGS.en;

  // One interaction vocabulary for every device, with platform-specific input.
  function controlHelp(lang, device) {
    const zh = lang === 'zh-CN', kind = platform(device);
    const common = zh ? [
      '单击动作按钮执行一次；模式或开关高亮表示当前已选中或已开启。',
      '悬停查看按钮说明和快捷键；键盘 Tab 聚焦，Enter 或空格激活。触屏可点此入口查看操作说明。',
      '主屏幕：⇧⌘H；截图：⌘S。截图旁的箭头选择保存位置。顶部缩放只改变查看大小。',
    ] : [
      'Click an action button once to execute it. Highlighted modes and toggles remain selected or enabled.',
      'Hover for instructions and shortcuts; Tab focuses a button, and Enter or Space activates it. On touch screens, open this guide.',
      'Home: ⇧⌘H. Screenshot: ⌘S; its arrow chooses the destination. Top-bar zoom changes only the viewing size.',
    ];
    const specific = kind === 'visionOS' ? (zh ? [
      '画面中点击或长按对应捏合，按住拖动移动物体；Shift 拖动调整远近，Option 拖动双手缩放或旋转，Control 拖动转向。',
      '转向、平移、环绕、前后移动：单击选择画面拖动模式；直接拖动按钮临时调整视角，松手保持原模式。复位恢复初始视角。',
      'WASD / 方向键移动，Q/E 下降/上升；触控板双指滚动平移、捏合前后移动。键盘输入开关开启后，按键交给设备。Esc 退出键盘或指针捕获。',
      '录屏按钮单击开始，再次单击停止并保存。主屏幕按钮模拟数码旋钮。',
    ] : [
      'Click or hold to pinch; drag to move objects. Shift-drag changes depth, Option-drag scales or rotates with two hands, and Control-drag turns the camera.',
      'Tilt, pan, orbit and dolly: click to select the canvas mode, or drag the button for temporary camera movement without changing mode. Reset restores the starting view.',
      'WASD / arrows move, Q/E lower/raise. Two-finger scrolling pans; trackpad pinch moves forward/back. Keyboard capture sends keys to the device. Esc releases keyboard or pointer capture.',
      'Click Record to start, then again to stop and save. Home simulates the Digital Crown.',
    ]) : kind === 'tvOS' ? (zh ? [
      '遥控方向按钮或键盘方向键移动焦点；确认按钮或 Enter 选择；返回按钮或 Esc 返回；空格播放/暂停。',
      '点击画面任意位置确认当前焦点；右键返回。触控板双指滚动模拟 Siri Remote 滑动，点击位置不代表要选择的电视元素。',
    ] : [
      'Remote arrows or keyboard arrows move focus. Select or Enter confirms; Back or Esc returns; Space plays/pauses.',
      'Click anywhere in the view to confirm the focused item; right-click goes back. Two-finger scrolling simulates Siri Remote swipes. Click position does not select a TV element.',
    ]) : (zh ? [
      '在画面中点击、长按和拖动，操作对应位置的 App 内容。',
      '旋转按钮每次转动 90°（⌘← / ⌘→）。折叠设备的姿态按钮选择合上、半展开或展开，高亮表示当前姿态。',
    ] : [
      'Click, hold and drag in the view to interact with app content at that position.',
      'Rotation buttons turn the device 90° (⌘← / ⌘→). Foldable posture buttons select closed, half-open or flat; the current posture is highlighted.',
    ]);
    return {title:zh?'操作说明':'Controls help',close:zh?'关闭':'Close',common,specific};
  }

  /** "iOS 27.1" from a CoreSimulator runtime identifier or name. */
  function runtimeLabel(runtime) {
    if (!runtime) return '';
    const android=/^android:android-(\d+)/.exec(runtime);if(android)return `Android API ${android[1]}`;
    const m = /(iOS|tvOS|xrOS|visionOS)[-\s]?([0-9]+)(?:[-.]([0-9]+))?/.exec(runtime);
    return m ? `${m[1] === 'xrOS' ? 'visionOS' : m[1]} ${m[2]}${m[3] !== undefined ? '.' + m[3] : ''}` : runtime;
  }

  function family(device) {
    const type = device?.productFamily || device?.deviceType || device?.identifier || device?.name || '';
    return /Apple[- ]?TV/i.test(type) ? 'tv' : /Apple[- ]?Vision/i.test(type) ? 'vision' : /iPad|android:tablet/i.test(type) ? 'ipad' : 'iphone';
  }
  function platform(device) {
    const runtime = device?.runtime || device?.identifier || device?.name || '';
    if (device?.platform === 'android' || /^android:/.test(runtime)) return 'android';
    if (/tvOS/.test(runtime)) return 'tvOS';
    if (/xrOS|visionOS/.test(runtime)) return 'visionOS';
    const kind = family(device);
    return kind === 'tv' ? 'tvOS' : kind === 'vision' ? 'visionOS' : 'iOS';
  }
  function handheld(device) { return ['iOS', 'android'].includes(platform(device)); }

  /** Corner radius of the live screen, in CSS px, for a portrait screen box of `width` px. */
  function screenRadius(device, width) {
    if (!width || width <= 0) return 0;
    return Math.round(width * ({iphone: 0.13, ipad: 0.035, tv: 0, vision: 0}[family(device)]));
  }

  /** Status dot + label from a status response and page flags. */
  function presence(s, flags = {}) {
    const state = s?.device?.state;
    if (flags.switching) return { tone: 'busy', key: 'connecting' };
    // No response yet is a normal page load, not a disconnected view.
    if (!s && !flags.lost) return { tone: 'busy', key: 'connecting' };
    if (!s && flags.lost === 'stopped') return { tone: 'off', key: 'serviceOff' };
    if (!s && flags.lost === 'expired') return { tone: 'off', key: 'expired' };
    if (!s) return { tone: 'off', key: 'offline' };
    if (s.settings && s.settings.enabled === false) return { tone: 'off', key: 'paused' };
    if (state === 'Shutdown') return { tone: 'off', key: 'off' };
    if (state && state !== 'Booted') return { tone: 'busy', key: state === 'Booting' ? 'booting' : 'stopping' };
    if (s.ready) return { tone: 'on', key: 'connected' };
    if (s.parked) return { tone: 'warn', key: 'offline' };
    return { tone: 'busy', key: 'connecting' };
  }

  /** Which overlay the stage shows. One at a time, most urgent first. */
  function overlay(s, flags = {}) {
    if (flags.switching) return { kind: 'switching', phase: flags.phase || 'preparing' };
    if (flags.recovering) return { kind: 'recovering' };
    if (flags.stopping) return { kind: 'stopping' };
    if (!s && !flags.lost) return { kind: 'connecting' };
    // The page outlived its service: nothing to recover here, say how to reopen.
    if (!s && flags.lost === 'stopped') return { kind: 'serviceOff' };
    if (!s && flags.lost === 'expired') return { kind: 'expired' };
    if (!s) return { kind: 'offline' };
    if (s.settings && s.settings.enabled === false) return { kind: 'paused' };
    if (s.device?.state === 'Shutdown') return { kind: 'off' };
    if (s.device && s.device.state !== 'Booted') return { kind: 'booting' };
    if (s.parked) return { kind: 'offline' };
    if (!s.ready) return { kind: 'connecting' };
    return null;
  }

  /** Seconds left before idle shutdown, or null when none is due within `window` ms. */
  function idleLeft(s, now, window = 60000) {
    if (!s?.idleDeadline || !s.settings?.enabled || s.device?.state !== 'Booted') return null;
    const left = s.idleDeadline - now;
    if (left > window) return null;
    return Math.max(0, Math.ceil(left / 1000));
  }

  const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  /** Rows for the device menu: current first, running next, then by name. */
  function deviceRows(devices, currentUdid, lang) {
    const t = strings(lang);
    return (devices || [])
      .map((d) => ({
        udid: d.udid, name: d.name, current: d.udid === currentUdid, family: family(d),
        tone: d.state === 'Booted' ? 'on' : d.state === 'Shutdown' ? 'off' : 'busy',
        meta: [runtimeLabel(d.runtime), d.state === 'Booted' ? t.runningMeta : d.state === 'Shutdown' ? t.offMeta : t.busyMeta].filter(Boolean).join(' · '),
        available: d.isAvailable !== false,
      }))
      .sort((a, b) => (b.current - a.current) || ((b.tone === 'on') - (a.tone === 'on')) || a.name.localeCompare(b.name));
  }

  const version = (v) => String(v || '0').split('.').map(Number).slice(0, 3).reduce((a, n, i) => a + (n || 0) * Math.pow(65536, 2 - i), 0);

  /** Runtimes a model can run, newest last. */
  function runtimesFor(catalog, deviceTypeId) {
    const chosen = catalog?.deviceTypes?.find((d) => d.identifier === deviceTypeId);
    return (catalog?.runtimes || []).filter((r) => {
      if (!chosen) return true;
      if (platform(r) !== platform(chosen)) return false;
      if (Array.isArray(r.supportedDeviceTypes) && !r.supportedDeviceTypes.includes(chosen.identifier)) return false;
      return version(r.version) >= version(chosen.minRuntimeVersion) && version(r.version) <= version(chosen.maxRuntimeVersion || '65535.255.255');
    }).sort((a, b) => version(a.version) - version(b.version));
  }

  /** The one-tap default for a new device: the newest iPhone with a runtime, on its newest runtime. */
  // "New iPhone": the newest numbered iPhone (Pro first, then the base model),
  // whatever order simctl lists types in; then other iPhones, then iPads.
  function defaultChoice(catalog) {
    const types = catalog?.deviceTypes || [];
    const generation = (name) => Number(/^iPhone (\d+)\b/.exec(name)?.[1] || 0);
    const variant = (name) => (/^iPhone \d+ Pro$/.test(name) ? 0 : /^iPhone \d+$/.test(name) ? 1 : 2);
    const numbered = types.filter((d) => generation(d.name) > 0)
      .sort((a, b) => generation(b.name) - generation(a.name) || variant(a.name) - variant(b.name));
    const phones = types.filter((d) => !numbered.includes(d) && family(d) === 'iphone');
    const pads = types.filter((d) => family(d) === 'ipad');
    const others = types.filter((d) => ['tv', 'vision'].includes(family(d)));
    for (const d of [...numbered, ...phones, ...pads, ...others]) {
      const runtimes = runtimesFor(catalog, d.identifier);
      if (runtimes.length) return { deviceType: d.identifier, runtime: runtimes[runtimes.length - 1].identifier, name: d.name };
    }
    return null;
  }

  // Zoom, in percent of actual size (one device point per CSS pixel). `fitPct`
  // is what "fit window" currently amounts to; unknown (3D stage) counts as 100.
  const ZOOM_STEPS = [25, 33, 50, 67, 75, 100, 125, 150, 200, 300];
  function zoomStep(pct, direction) {
    const steps = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
    return steps.find((step) => (direction > 0 ? step > pct + 0.5 : step < pct - 0.5)) ?? steps.at(-1);
  }
  /** Frame size factor relative to the fitted size for a zoom state. */
  function zoomFactor(zoom, fitPct) {
    if (!zoom || zoom.mode !== 'pct') return 1;
    return Math.min(6, Math.max(0.2, zoom.pct / (fitPct > 0 ? fitPct : 100)));
  }
  /** The percentage the zoom state shows, given the fitted percentage. */
  const zoomPct = (zoom, fitPct) => Math.round(zoom?.mode === 'pct' ? zoom.pct : (fitPct > 0 ? fitPct : 100));

  const api = { STRINGS, strings, controlHelp, runtimeLabel, family, platform, handheld, screenRadius, presence, overlay, idleLeft, clock, deviceRows, runtimesFor, defaultChoice, ZOOM_STEPS, zoomStep, zoomFactor, zoomPct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CindySimModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
