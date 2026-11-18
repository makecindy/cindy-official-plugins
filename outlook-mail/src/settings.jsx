import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  Input,
  Icon,
  Disclosure,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from './components/ui.jsx';

const clouds = {
  global: {
    key: 'outlook_global',
    port: 53687,
    portal: 'https://portal.azure.com',
  },
  china: {
    key: 'outlook_china',
    port: 53688,
    portal: 'https://portal.azure.cn',
  },
};
async function request(path, init) {
  const response = await fetch(
    path,
    init?.body ? { ...init, headers: { 'Content-Type': 'application/json' } } : init,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function locale() {
  let lang = 'en';
  try {
    const c = await request('/app-context');
    if (['en', 'zh-CN', 'ja', 'ko'].includes(c?.context?.locale)) lang = c.context.locale;
  } catch {
    /* Host locale; English fallback */
  }
  let strings;
  try {
    strings = await request('/ui/' + lang + '.json');
  } catch {
    lang = 'en';
    strings = await request('/ui/en.json');
  }
  document.documentElement.lang = lang;
  return strings;
}
function Settings({ strings }) {
  const t = (key) => strings[key] || key;
  const [entries, setEntries] = useState([]),
    [config, setConfig] = useState({});
  const [selected, setSelected] = useState('global'),
    [loaded, setLoaded] = useState(false);
  const [attempted, setAttempted] = useState(false),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''),
    [clientId, setClientId] = useState('');
  const [more, setMore] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [permissions, setPermissions] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const initialized = useRef(false),
    pending = useRef(false),
    input = useRef(null),
    redirect = useRef(null);
  const entry = (cloud) => entries.find((e) => e.key === clouds[cloud].key);
  const defaultCloud = config.default_cloud === 'china' ? 'china' : 'global';
  const current = entry(selected),
    required = loaded && !current?.clientConfigured;
  const disabled = busy || !loaded;
  const callback = 'http://127.0.0.1:' + clouds[selected].port + '/callback';
  async function load() {
    try {
      const [oauth, kv] = await Promise.all([request('/oauth'), request('/kv')]);
      if (!Array.isArray(oauth)) throw new Error();
      setEntries(oauth);
      setConfig(kv || {});
      setLoaded(true);
      if (!initialized.current) {
        setSelected(kv?.default_cloud === 'china' ? 'china' : 'global');
        initialized.current = true;
      }
    } catch {
      setLoaded(false);
      setEntries([]);
      setMessage(t('loadFailed'));
    }
    setAttempted(true);
  }
  useEffect(() => {
    void load();
  }, []);
  async function perform(fn) {
    if (pending.current || !loaded) return false;
    pending.current = true;
    setBusy(true);
    setMenuOpen(false);
    let succeeded = false;
    try {
      await fn();
      succeeded = true;
    } catch (error) {
      setMessage(t('requestFailed') + ' (' + error.message + ')');
    } finally {
      await load();
      pending.current = false;
      setBusy(false);
    }
    return succeeded;
  }
  function selectCloud(cloud) {
    if (pending.current || !loaded || !clouds[cloud]) return;
    if (cloud !== selected) {
      setSelected(cloud);
      setClientId('');
      setAdvanced(false);
      setMessage('');
    }
    setMenuOpen(false);
  }
  async function connect(cloud = selected) {
    if (!entry(cloud)?.clientConfigured) {
      setSelected(cloud);
      setClientId('');
      setAdvanced(false);
      setMessage(t('appMissing'));
      return;
    }
    setMessage(t('connecting'));
    const r = await request('/oauth/' + clouds[cloud].key + '/connect', {
      method: 'POST',
    });
    if (!r.ok) {
      setMessage(strings[r.error] || t('connectFailed'));
      return;
    }
    setMessage(t('connected') + ': ' + (r.account?.label || ''));
  }
  async function saveApplication(event) {
    event.preventDefault();
    if (pending.current || !loaded) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId.trim())) {
      setMessage(t('invalidClient'));
      input.current?.focus();
      return;
    }
    const saved = await perform(async () => {
      await request('/oauth/' + clouds[selected].key + '/client', {
        method: 'PUT',
        body: JSON.stringify({ clientId: clientId.trim() }),
      });
      setClientId('');
      setAdvanced(false);
      setMore(false);
      setMessage(t('clientSaved'));
    });
    if (saved) requestAnimationFrame(() => document.getElementById('connect')?.focus());
  }
  const application = (
    <form id="application-form" onSubmit={saveApplication}>
      <div className="application-intro">
        {required && <h3>{t('setupTitle')}</h3>}
        <p id="application-help" className="hint">
          {t(required ? 'requiredHelp' : 'setupHelp')}
        </p>
      </div>
      <div className="field">
        <label htmlFor="client-id">Client ID</label>
        <Input
          ref={input}
          id="client-id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder={t('clientPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          required
          disabled={disabled}
          aria-describedby="application-help"
        />
      </div>
      <div className="field">
        <label htmlFor="redirect">{t('redirect')}</label>
        <div className="redirect-field">
          <Input ref={redirect} id="redirect" value={callback} readOnly />
          <Button
            id="copy-redirect"
            className="copy-button"
            disabled={disabled}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(callback);
                setMessage(t('copied'));
              } catch {
                redirect.current?.focus();
                redirect.current?.select();
                setMessage(t('copyManually'));
              }
            }}
          >
            <Icon name="copy" />
            {t('copy')}
          </Button>
        </div>
      </div>
      <div className="application-links">
        <a id="portal" href={clouds[selected].portal}>
          {t('portal')}
        </a>
        <p className="hint">{t('noSecret')}</p>
      </div>
      <div className="actions">
        <Button id="save-client" variant="primary" type="submit" disabled={disabled}>
          {t('save')}
        </Button>
        <Button
          id="cancel-client"
          hidden={required}
          disabled={disabled}
          onClick={() => {
            setClientId('');
            setAdvanced(false);
            requestAnimationFrame(() => document.querySelector('#advanced > button')?.focus());
          }}
        >
          {t('cancel')}
        </Button>
      </div>
      {current?.clientCustom && (
        <Button
          id="reset-client"
          variant="ghost"
          disabled={disabled}
          onClick={() =>
            void perform(async () => {
              await request('/oauth/' + clouds[selected].key + '/client', {
                method: 'DELETE',
              });
              setClientId('');
              setMessage(t('clientCleared'));
            })
          }
        >
          {t('reset')}
        </Button>
      )}
    </form>
  );
  const accounts = Object.entries(clouds).flatMap(([cloud, cfg]) =>
    (entry(cloud)?.accounts || []).map((account) => ({
      cloud,
      cfg,
      account,
      label: (account.label || account.id).replace(/^\s*·\s*/, ''),
      status:
        account.status !== 'connected'
          ? 'expired'
          : account.scopeStale
            ? 'scopeStale'
            : 'connected',
    })),
  );
  return (
    <main aria-busy={busy}>
      <header className="connection-header">
        <h1>{t('title')}</h1>
        <DropdownMenu
          modal={false}
          open={menuOpen}
          onOpenChange={(open) => {
            if (!pending.current) setMenuOpen(open);
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              id="cloud"
              className="service-trigger"
              disabled={disabled}
              aria-label={t('region') + ': ' + t(selected)}
            >
              <span id="service-name">{t(selected)}</span>
              <Icon name="chevron" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            id="service-menu"
            className="service-menu"
            reserveSpace
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              requestAnimationFrame(() =>
                document.querySelector('#service-menu [aria-checked="true"]')?.focus(),
              );
            }}
          >
            <DropdownMenuRadioGroup value={selected} onValueChange={selectCloud}>
              {Object.keys(clouds).map((cloud) => (
                <DropdownMenuRadioItem
                  key={cloud}
                  value={cloud}
                  data-cloud={cloud}
                  textValue={t(cloud)}
                >
                  <span className="option-name">{t(cloud)}</span>
                  {cloud === defaultCloud && (
                    <span className="default-badge">{t('defaultBadge')}</span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              id="default-cloud"
              disabled={disabled || selected === defaultCloud}
              aria-describedby="default-help"
              onSelect={() =>
                void perform(async () => {
                  // Shares the mail SDK lock: draft card records live in the same KV.
                  await navigator.locks.request('outlook-mail-kv', async () => {
                    const kv = await request('/kv');
                    await request('/kv', {
                      method: 'PUT',
                      body: JSON.stringify({ ...kv, default_cloud: selected }),
                    });
                  });
                  setMessage(t('saved'));
                })
              }
            >
              {t(selected === defaultCloud ? 'alreadyDefault' : 'defaultCloud')}
            </DropdownMenuItem>
            <p id="default-help" className="hint menu-help">
              {t('defaultHelp')}
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <section className="connection-content">
        <div className="connection-note" hidden={required}>
          <p id="setup-note" className="hint">
            {!loaded
              ? t(attempted ? 'loadFailed' : 'loading')
              : t(current?.clientCustom ? 'customReady' : 'builtInReady')}
          </p>
          {loaded && current?.clientCustom && (
            <Button
              id="edit-client"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setMore(true);
                setAdvanced(true);
                requestAnimationFrame(() => input.current?.focus());
              }}
            >
              {t('edit')}
            </Button>
          )}
        </div>
        {!loaded && attempted && (
          <Button
            id="retry"
            disabled={busy}
            onClick={async () => {
              if (pending.current) return;
              pending.current = true;
              setBusy(true);
              setMessage('');
              await load();
              pending.current = false;
              setBusy(false);
            }}
          >
            {t('retry')}
          </Button>
        )}
        <div id="required-application" hidden={!required}>
          {required && application}
        </div>
      </section>
      <section className="accounts-section" aria-labelledby="accounts-title">
        <h2 id="accounts-title" tabIndex={-1}>
          {t('accountsTitle')}
        </h2>
        <div id="accounts">
          {loaded && !accounts.length && <p className="hint empty">{t('noAccounts')}</p>}
          {accounts.map(({ cloud, cfg, account: a, label, status }) => (
            <div key={cloud + a.id} className="account" data-cloud={cloud} data-account-id={a.id}>
              <span className="account-avatar">
                <Icon name="user" />
              </span>
              <div className="identity">
                <span className="account-name">{label}</span>
                {status !== 'connected' && <p className="hint account-status">{t(status)}</p>}
              </div>
              <div className="account-controls">
                {status !== 'connected' && (
                  <Button
                    className="reconnect"
                    onClick={() => void perform(() => connect(cloud))}
                    disabled={disabled}
                  >
                    {t('reconnect')}
                  </Button>
                )}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="account-actions"
                      variant="icon"
                      disabled={disabled}
                      aria-label={t('accountActions') + ': ' + label}
                    >
                      <Icon name="more" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="account-menu">
                    <div className="account-details hint">
                      <p>{t(cloud)}</p>
                      <p>{t(status)}</p>
                      {a.isDefault && <span className="default-badge">{t('defaultAccount')}</span>}
                    </div>
                    <DropdownMenuSeparator />
                    {!a.isDefault && a.status === 'connected' && (
                      <DropdownMenuItem
                        disabled={disabled}
                        onSelect={() =>
                          void perform(async () => {
                            await request('/oauth/' + cfg.key + '/default', {
                              method: 'POST',
                              body: JSON.stringify({ accountId: a.id }),
                            });
                            setMessage(t('saved'));
                          })
                        }
                      >
                        {t('setDefault')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      disabled={disabled}
                      onSelect={async () => {
                        await perform(async () => {
                          await request(
                            '/oauth/' + cfg.key + '/accounts/' + encodeURIComponent(a.id),
                            { method: 'DELETE' },
                          );
                          setMessage(t('disconnected'));
                        });
                        requestAnimationFrame(() => {
                          const trigger = document.querySelector(
                            `[data-account-id="${CSS.escape(a.id)}"][data-cloud="${cloud}"] .account-actions`,
                          );
                          (trigger || document.getElementById('accounts-title'))?.focus();
                        });
                      }}
                    >
                      {t('disconnect')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
          <Button
            id="connect"
            variant="ghost"
            className="account-connect"
            disabled={disabled || !current?.clientConfigured}
            hidden={required}
            onClick={() => void perform(() => connect())}
          >
            <span className="account-avatar">
              <Icon name="plus" />
            </span>
            <span>{t(accounts.length ? 'connectAnother' : 'connect')}</span>
          </Button>
        </div>
      </section>
      <Disclosure
        id="more"
        className="more-settings"
        title={t('more')}
        open={more}
        onOpenChange={setMore}
      >
        {!required && (
          <Disclosure
            id="advanced"
            title={t('application')}
            description={t(current?.clientCustom ? 'configured' : 'builtIn')}
            open={advanced}
            onOpenChange={setAdvanced}
          >
            {application}
          </Disclosure>
        )}
        <Disclosure
          id="permissions"
          title={t('permissionsTitle')}
          open={permissions}
          onOpenChange={setPermissions}
        >
          <div className="permissions-copy">
            {['permissions', 'boundary', 'multiAccountHelp'].map((key) => (
              <p key={key} className="hint">
                {t(key)}
              </p>
            ))}
          </div>
        </Disclosure>
      </Disclosure>
      <p id="status" className="hint" role="status" aria-live="polite">
        {message}
      </p>
    </main>
  );
}
locale()
  .then((strings) =>
    createRoot(document.getElementById('root')).render(<Settings strings={strings} />),
  )
  .catch(() => {
    document.getElementById('root').textContent =
      'Unable to load settings. Please reopen the plugin details.';
  });
