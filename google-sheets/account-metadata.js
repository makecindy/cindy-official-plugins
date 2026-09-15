/* Plugin-owned labels. OAuth identities, credentials and status remain Host-owned. */
var googleAccountMetadata = (function () {
  'use strict';
  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  async function read() {
    var response = await fetch('/kv');
    if (!response.ok) throw new Error('Account preferences unavailable');
    return object(await response.json());
  }
  function labels(data, key) {
    return object(object(data.accountNicknames)[key]);
  }
  async function update(key, accountId, nickname) {
    // /kv replaces the whole document. Serialize settings-page writers sharing
    // this plugin origin, and read inside the lock to preserve unrelated keys.
    return navigator.locks.request('google-account-metadata', async function () {
      var data = await read();
      if (nickname !== null) {
        var response = await fetch('/oauth');
        if (!response.ok) throw new Error('Account status unavailable');
        var accounts = await response.json();
        var entry = accounts.find(function (item) { return item.key === key; });
        if (!entry || !entry.accounts.some(function (account) { return account.id === accountId; })) {
          throw new Error('Account no longer connected');
        }
      }
      var all = Object.assign({}, object(data.accountNicknames));
      var next = Object.assign({}, labels(data, key));
      if (nickname) next[accountId] = nickname;
      else delete next[accountId];
      all[key] = next;
      data.accountNicknames = all;
      var saved = await fetch('/kv', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      if (!saved.ok) throw new Error('Account preferences not saved');
    });
  }
  return {
    list: async function (key, accounts) {
      var names = labels(await read(), key);
      return accounts.map(function (account) {
        var nickname = Object.prototype.hasOwnProperty.call(names, account.id) ? names[account.id] : '';
        // Do not accept a Host nickname as a second source of truth.
        return Object.assign({}, account, { nickname: typeof nickname === 'string' ? nickname : '' });
      });
    },
    save: async function (key, accountId, nickname) {
      if (typeof nickname !== 'string' || nickname.length > 80 || /[\u0000-\u001f\u007f]/.test(nickname)) {
        throw new Error('Invalid account nickname');
      }
      return update(key, accountId, nickname.trim());
    },
    remove: function (key, accountId) { return update(key, accountId, null); },
  };
})();
