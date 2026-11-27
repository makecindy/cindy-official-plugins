(() => {
  'use strict';
  const panel = document.getElementById('harness-usage');
  const channel = new BroadcastChannel(panel.dataset.channel);
  const title = panel.querySelector('h2');
  const rows = panel.querySelector('dl');
  const note = panel.querySelector('small');
  let usage;
  let expiryTimer;
  let waiting;
  const check = () => channel.postMessage({ type: 'harness-usage-request' });

  function render() {
    const locale = document.documentElement.lang || 'en';
    const zh = /^zh/i.test(locale);
    title.textContent = zh ? '账号用量' : 'Account usage';
    rows.replaceChildren();
    const add = (name, value) => {
      const label = document.createElement('dt');
      const data = document.createElement('dd');
      label.textContent = name;
      data.textContent = value;
      rows.append(label, data);
    };
    const now = Date.now();
    let nextReset = Infinity;
    for (const item of usage?.windows || []) {
      const reset = item.resetsAt;
      if (reset && reset <= now) {
        add(item.label, zh ? '等待额度刷新' : 'Awaiting refresh');
        continue;
      }
      const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(item.remainingPercent / 100);
      const deadline = reset ? new Date(reset).toLocaleString(locale) : '';
      add(item.label, (zh ? '剩余 ' + percent : percent + ' left') +
        (deadline ? (zh ? ' · 重置于 ' : ' · Resets ') + deadline : ''));
      if (reset) nextReset = Math.min(nextReset, reset);
    }
    for (const item of usage?.balances || []) {
      add(zh ? '可用余额' : 'Available balance', new Intl.NumberFormat(locale, {
        style: 'currency', currency: item.currency, currencyDisplay: 'code',
      }).format(Number(item.amount)));
    }
    rows.hidden = !rows.childElementCount;
    if (usage?.updatedAt) {
      note.textContent = (zh ? '更新于 ' : 'Updated ') + new Date(usage.updatedAt).toLocaleString(locale);
    } else {
      note.textContent = usage === undefined ? (zh ? '正在读取用量…' : 'Checking usage…') :
        (zh ? '暂时没有可用的账号用量数据。' : 'Account usage is currently unavailable.');
    }
    clearTimeout(expiryTimer);
    if (Number.isFinite(nextReset)) expiryTimer = setTimeout(() => {
      render();
      if (!document.hidden) check();
    }, Math.min(2147483647, Math.max(1000, nextReset - now + 100)));
  }

  channel.onmessage = ({ data }) => {
    if (data?.type === 'status' || data?.type === 'detect-result') { check(); return; }
    if (data?.type !== 'harness-usage') return;
    if (!data.checking) clearTimeout(waiting);
    usage = data.checking && !data.usage ? undefined : data.usage;
    render();
  };
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  document.getElementById(panel.dataset.recheck)?.addEventListener('click', check);
  render();
  check();
  waiting = setTimeout(() => { if (usage === undefined) { usage = null; render(); } }, 28000);
})();
