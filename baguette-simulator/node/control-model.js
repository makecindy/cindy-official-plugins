'use strict';
// Shared view logic and small UI controls. No network access.
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
  function memoryOptions(lang) {
    return (lang==='zh-CN'
      ? [['saving','节省（默认）'],['standard','标准'],['minimal','极简（高级）']]
      : [['saving','Save memory (default)'],['standard','Standard'],['minimal','Minimal (advanced)']])
      .map(([value,label])=>({value,label}));
  }
  function memoryHelp(lang) {
    return lang==='zh-CN'
      ? '节省模式关闭搜索、健康、部分游戏与诊断服务。极简还影响登录、支付、照片、推送等，仅用于限定范围的玩法或界面测试。完整验收选标准。'
      : 'Saving disables search, health and some game/diagnostic services. Minimal also affects login, purchases, photos and push; use only for scoped gameplay/UI tests. Use Standard for full acceptance tests.';
  }

  function memoryPicker(value, lang, onChange, disabled = false, doc = globalThis.document) {
    const zh = lang === 'zh-CN';
    const hints = zh ? {
      saving: '默认选择，减少后台内存占用；停用搜索、健康及部分游戏与诊断服务，相关功能测试可能受影响。',
      standard: '保留完整系统服务，适合完整验收；内存占用通常更高。',
      minimal: '进一步节省内存，但可能影响登录、支付、照片、推送及部分游戏服务。仅用于明确范围的核心玩法或 UI 测试。',
    } : {
      saving: 'Default. Reduces background memory use by disabling search, health and some game/diagnostic services. Tests of those features may be affected.',
      standard: 'Full system services for complete acceptance testing; typically uses more memory.',
      minimal: 'Saves more memory, but may affect login, purchases, photos, push and some game services. Only for clearly scoped gameplay or UI tests.',
    };
    const wrap = doc.createElement('div'); wrap.className = 'memory-choice';
    const title = doc.createElement('div'); title.className = 'memory-heading'; title.textContent = zh ? '启动模式' : 'Startup mode';
    const group = doc.createElement('div'); group.className = 'memory-options';
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', title.textContent);
    const hint = doc.createElement('p'); hint.className = 'memory-hint'; hint.setAttribute('aria-live', 'polite');
    const options = memoryOptions(lang);
    const buttons = options.map(({value: mode}) => {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'memory-option';
      button.setAttribute('data-mode', mode); button.disabled = disabled;
      button.textContent = memoryLabel(mode, lang);
      button.addEventListener('click', () => { if (!button.disabled) { select(mode); onChange(mode); } });
      group.append(button); return button;
    });
    function select(mode) {
      buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(options[i].value === mode)));
      hint.textContent = hints[mode] || hints.saving;
    }
    select(value);
    const details = iconButton(zh ? '模式区别与注意事项' : 'Compare modes', doc); details.className += ' memory-help';
    details.setAttribute('aria-haspopup', 'dialog');
    details.addEventListener('click', () => {
      const dialog = doc.createElement('dialog'); dialog.className = 'memory-dialog'; dialog.setAttribute('aria-label', details.title);
      const heading = doc.createElement('h2'); heading.textContent = details.title;
      const help = doc.createElement('p'); help.textContent = memoryHelp(lang);
      const actions = doc.createElement('div'); actions.className = 'memory-actions';
      const close = doc.createElement('button'); close.type = 'button'; close.className = 'btn secondary'; close.textContent = zh ? '关闭说明' : 'Close';
      const dismiss = () => { dialog.close(); dialog.remove(); };
      close.addEventListener('click', dismiss); dialog.addEventListener('cancel', dismiss);
      actions.append(close); dialog.append(heading, help, actions); doc.body.append(dialog); dialog.showModal(); close.focus();
    });
    title.append(details); wrap.append(title, group, hint); return wrap;
  }

  function memoryLabel(mode, lang) {
    const labels = lang === 'zh-CN'
      ? {saving:'节省', standard:'标准', minimal:'极简', custom:'自定义', unknown:'待确认'}
      : {saving:'Save memory', standard:'Standard', minimal:'Minimal', custom:'Custom', unknown:'Unconfirmed'};
    return labels[mode] || labels.unknown;
  }
  // Always derive the visible value from fresh device evidence, never the boot
  // picker or a previous page's choice. Shutdown has no active memory profile.
  function memoryStatus(device, lang, requested) {
    if (!device || platform(device) !== 'iOS' || device.state === 'Shutdown') return '';
    const mode = device.state === 'Booted' ? device.memoryMode : null;
    return (lang === 'zh-CN' ? '内存模式：' : 'Memory mode: ') + memoryLabel(mode?.mode, lang)
      + (mode?.mode && mode.mode !== 'unknown' && mode.verified !== true ? (lang === 'zh-CN' ? '（未核验）' : ' (unverified)') : '')
      + (requested && (requested !== mode?.mode || mode?.verified !== true)
        ? (lang === 'zh-CN' ? ` · 重启后：${memoryLabel(requested,lang)}` : ` · After restart: ${memoryLabel(requested,lang)}`) : '');
  }
  function showMemoryDetails(device, lang, choice = {}, doc = globalThis.document) {
    const zh = lang === 'zh-CN';
    const dialog = doc.createElement('dialog'); dialog.className = 'memory-dialog';
    dialog.setAttribute('aria-label', zh ? '内存模式' : 'Memory mode');
    const title = doc.createElement('h2'); title.textContent = memoryStatus(device, lang);
    const name = doc.createElement('p'); name.textContent = device.name;
    const actual = device.state === 'Booted' && device.memoryMode?.verified === true ? device.memoryMode.mode : null;
    const hint = doc.createElement('p'); hint.className = 'memory-pending'; hint.setAttribute('role','status');
    let selected = choice.value || actual || '', busy = false;
    const restart = doc.createElement('button'); restart.type = 'button'; restart.className = 'btn primary memory-restart';
    function update(mode) {
      selected = mode || actual || '';
      restart.disabled = !memoryOptions(lang).some(option => option.value === selected);
      restart.textContent = selected !== actual ? (zh ? '重启并应用' : 'Restart & apply') : (zh ? '重启模拟器' : 'Restart simulator');
      hint.hidden = !mode || mode === actual;
      hint.textContent = hint.hidden ? '' : (zh
        ? `已选择${memoryLabel(mode,lang)}，重启模拟器后生效。当前 App 继续运行。`
        : `${memoryLabel(mode,lang)} selected. Takes effect after restarting the simulator. Current apps keep running.`);
    }
    const picker = memoryPicker(choice.value || actual || '',lang,mode=>{choice.onChange?.(mode);update(mode);},false,doc);
    update(choice.value);
    const actions = doc.createElement('div'); actions.className = 'memory-actions';
    const close = doc.createElement('button'); close.className = 'btn secondary'; close.type = 'button'; close.textContent = zh ? '完成' : 'Done';
    const dismiss = () => { if (!busy) { dialog.close(); dialog.remove(); } };
    close.addEventListener('click', dismiss); dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); }); actions.append(close);
    const warning = doc.createElement('p'); warning.className = 'memory-restart-note';
    warning.hidden = typeof choice.onRestart !== 'function';
    warning.textContent = zh ? '重启会退出当前 App，保留 App 和数据。' : 'Restarting closes current apps. Apps and data are kept.';
    const error = doc.createElement('p'); error.className = 'memory-restart-error'; error.setAttribute('role','alert'); error.hidden = true;
    if (typeof choice.onRestart === 'function') {
      actions.append(restart);
      restart.addEventListener('click', async () => {
        if (busy || restart.disabled) return;
        busy = true; close.disabled = true; restart.disabled = true;
        picker.querySelectorAll('button').forEach(button => { button.disabled = true; });
        restart.textContent = zh ? '正在重启…' : 'Restarting…';
        try { await choice.onRestart(selected); busy = false; dismiss(); }
        catch {
          busy = false; close.disabled = false;
          restart.textContent = zh ? '重启未完成' : 'Restart incomplete';
          error.hidden = false;
          error.textContent = zh ? '未能确认重启完成。请关闭此窗口，查看设备状态后再操作。' : 'Could not confirm the restart completed. Close this dialog and check the device status before trying again.';
        }
      });
    }
    dialog.append(title, name, picker, hint, warning, error, actions); doc.body.append(dialog); dialog.showModal(); close.focus();
  }

  async function restartMemoryMode(device, mode, request) {
    if (!device?.udid || platform(device) !== 'iOS' || !memoryOptions('en').some(option => option.value === mode)) throw Error('INVALID_ARGUMENT');
    // One worker-owned operation survives page navigation during shutdown.
    const started = await request('restart_device', {udid:device.udid,memoryMode:mode});
    if (!started || started.ok === false) throw Error('BOOT_UNCONFIRMED');
    return started;
  }

  function memoryNotice(result, lang, requested) {
    const mode = result?.memoryMode;
    if (!mode) return '';
    requested ??= mode.requested;
    const mismatch = requested && mode.mode !== requested;
    if (mode.verified === true && !mismatch && !mode.warning) return '';
    const zh = lang === 'zh-CN';
    const label = (value) => memoryOptions(lang).find(o => o.value === value)?.label
      || (zh ? '自定义或未知' : 'Custom or unknown');
    return [zh ? `实际内存模式：${label(mode.mode)}。` : `Actual memory mode: ${label(mode.mode)}.`,
      mismatch ? (zh ? `与所选的${label(requested)}模式不符。` : `Does not match the selected ${label(requested)} mode.`) : '',
      mode.verified !== true ? (zh ? '未能核验服务配置。' : 'Service configuration could not be verified.') : '',
      zh ? '设备已启动，请先核对配置再开始测试。' : 'The device has started. Check its configuration before testing.',
      mode.warning || ''].filter(Boolean).join(' ');
  }

  function resourceValue(metric, lang) {
    if (metric?.status !== 'ok' || !Number.isFinite(metric.bytes) || metric.bytes < 0) {
      return metric?.status === 'unsupported' ? (lang === 'zh-CN' ? '此系统暂不支持' : 'Unavailable on this OS')
        : metric?.status === 'unattributed' ? (lang === 'zh-CN' ? '未找到可确认归属的进程' : 'No attributable process found')
        : (lang === 'zh-CN' ? '暂不可用' : 'Unavailable');
    }
    return metric.bytes >= 1024**3 ? (metric.bytes/1024**3).toFixed(2)+' GiB' : (metric.bytes/1024**2).toFixed(1)+' MiB';
  }
  function iconButton(label, doc) {
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'info-button';
    button.title = label; button.setAttribute('aria-label', label);
    button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
      + '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>';
    return button;
  }
  function resourceStamp(result, lang) {
    const zh = lang === 'zh-CN';
    const time = metric => {
      const value = new Date(metric?.sampledAt || result?.sampledAt);
      return Number.isFinite(value.getTime()) ? value.toLocaleTimeString(zh?'zh-CN':'en', {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : '—';
    };
    return (zh?'内存 ':'Memory ') + time(result?.memory) + ' · ' + (zh?'磁盘 ':'Disk ') + time(result?.disk);
  }
  // One page-level cache serves the selected device and visible list rows.
  // The worker separately caches memory for 15 s and disk for 5 min.
  function createResourceSummary(lang, read, doc = globalThis.document, now = Date.now) {
    const zh = lang === 'zh-CN', cache = new Map(), bindings = new Map();
    const node = doc.createElement('span'); node.className = 'resource-summary';
    let active = null, slot = 0;
    const lanes = [Promise.resolve(), Promise.resolve()];
    const Observer = doc.defaultView?.IntersectionObserver;
    const observer = Observer ? new Observer(entries => {
      prune();
      for (const event of entries) {
        const binding = bindings.get(event.target);
        if (binding) { binding.visible = event.isIntersecting; if (binding.visible) load(binding.device); }
      }
    }) : null;
    function entryFor(device) {
      let entry = cache.get(device.udid);
      if (!entry || entry.state !== device.state) {
        const disk = entry?.result?.disk;
        entry = {state:device.state, checkedAt:-Infinity, result:disk ? {disk} : null};
        cache.set(device.udid,entry);
      }
      return entry;
    }
    function paint(target, device) {
      target.hidden = !device;
      if (!device) { target.textContent = ''; return; }
      const entry = entryFor(device), result = entry.result;
      const keys = device.state === 'Booted' ? ['disk','memory'] : ['disk'];
      target.replaceChildren(...keys.map(key => {
        const part = doc.createElement('span'); part.className = 'resource-metric';
        const metric = result?.[key], name = key === 'disk' ? (zh?'磁盘':'Disk') : (zh?'内存':'Memory');
        const valid = metric?.status === 'ok' && Number.isFinite(metric.bytes) && metric.bytes >= 0;
        part.textContent = name + ' ' + (valid ? resourceValue(metric,lang) : '—');
        part.title = (key === 'disk'
          ? (zh?'设备数据占用，不含共享系统镜像。':'Device data, excluding shared OS images.')
          : (zh?'设备进程内存估算，不含共享服务和画面服务。':'Estimated device process memory, excluding shared services and the viewer.'))
          + (valid ? ' ' + resourceStamp({[key]:metric,sampledAt:result?.sampledAt},lang).split(' · ')[key==='disk'?1:0] : ' ' + resourceValue(metric,lang))
          + (entry.failed || metric?.stale ? (zh?' · 上次读数，稍后自动更新':' · Previous reading; retrying automatically') : '');
        return part;
      }));
    }
    function paintDevice(device) {
      if (active?.udid === device.udid && active.state === device.state) paint(node,active);
      for (const [target,binding] of bindings) if (binding.device.udid === device.udid && binding.device.state === device.state) paint(target,binding.device);
    }
    function prune() {
      for (const [target] of bindings) if (target.isConnected === false) { observer?.unobserve(target); bindings.delete(target); }
      const used = new Set([active?.udid,...[...bindings.values()].map(b=>b.device.udid)]);
      for (const [id,entry] of cache) if (cache.size > 64 && !used.has(id) && !entry.pending) cache.delete(id);
    }
    async function load(device) {
      if (!device || doc.hidden) return;
      const entry = entryFor(device);
      if (entry.pending) return entry.pending;
      const ttl = entry.failed ? 30000 : device.state === 'Booted' ? 15000 : 300000;
      if (now() - entry.checkedAt < ttl) return;
      const lane = slot++ % lanes.length;
      entry.pending = lanes[lane].then(async () => {
        if (doc.hidden || cache.get(device.udid) !== entry) return;
        const wanted = active?.udid === device.udid || [...bindings.values()].some(b=>b.visible && b.device.udid===device.udid);
        if (!wanted) return;
        try {
          const result = await read(device,false);
          if (result?.ok === false || result?.udid !== device.udid) throw Error('RESOURCE_UNAVAILABLE');
          entry.result = result;
          entry.failed = (device.state === 'Booted' ? ['memory','disk'] : ['disk']).some(key=>result[key]?.status!=='ok' || result[key]?.stale);
        } catch { entry.failed = true; }
        finally { entry.checkedAt = now(); }
      }).finally(() => { entry.pending = null; if (cache.get(device.udid) === entry) paintDevice(device); });
      lanes[lane] = entry.pending;
      return entry.pending;
    }
    function update(device) { active = device; prune(); paint(node,device); return load(device); }
    function label(device) {
      const target = doc.createElement('span'); target.className = 'resource-summary';
      bindings.set(target,{device,visible:!observer}); paint(target,device);
      if (observer) observer.observe(target); else load(device);
      return target;
    }
    return {node,update,label,prune};
  }

  // A persistent result stays above an opened viewer on every boot surface.
  // Text nodes keep backend diagnostics inert; only explicit dismissal hides it.
  function showMemoryNotice(result, lang, requested, name = '', doc = globalThis.document) {
    const text = memoryNotice(result, lang, requested);
    if (!text) return;
    let notices = doc.getElementById('memory-results');
    if (!notices) {
      notices = doc.createElement('div'); notices.id = 'memory-results'; notices.className = 'memory-results';
      doc.body.append(notices);
    }
    const notice = doc.createElement('div'); notice.className = 'memory-result'; notice.setAttribute('role', 'status');
    const body = doc.createElement('span'); body.textContent = (name ? name + ' · ' : '') + text;
    const close = doc.createElement('button'); close.type = 'button'; close.textContent = lang === 'zh-CN' ? '关闭' : 'Dismiss';
    close.addEventListener('click', () => notice.remove()); notice.append(body, close); notices.append(notice);
  }

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
      '触控板双指滚动模拟双指平移；捏合或 Ctrl＋滚轮以鼠标位置为中心缩放 App 内容。两个圆点表示实际触点。',
      'Option/Alt 拖动模拟双指缩放，Option/Alt＋Shift 拖动模拟双指平移。',
      '旋转按钮每次转动 90°（⌘← / ⌘→）。折叠设备的姿态按钮选择合上、半展开或展开，高亮表示当前姿态。',
    ] : [
      'Click, hold and drag in the view to interact with app content at that position.',
      'Two-finger trackpad scrolling pans with two touches; pinch or Ctrl+wheel zooms app content around the cursor. The two dots show the touch positions.',
      'Option/Alt-drag pinches; Option/Alt+Shift-drag pans with two fingers.',
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

  const api = { STRINGS, strings, memoryOptions, memoryPicker, memoryHelp, memoryLabel, memoryStatus, showMemoryDetails, restartMemoryMode, memoryNotice, showMemoryNotice, resourceValue, resourceStamp, createResourceSummary, controlHelp, runtimeLabel, family, platform, handheld, screenRadius, presence, overlay, idleLeft, clock, deviceRows, runtimesFor, defaultChoice, ZOOM_STEPS, zoomStep, zoomFactor, zoomPct };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CindySimModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
