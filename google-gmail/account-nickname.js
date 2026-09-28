/* User labels are metadata, never OAuth identities or model instructions. */
(function () {
  'use strict';
  var MESSAGES = {
    'zh-CN': { edit: '重命名账户', title: '重命名账户', nickname: '昵称', hint: '添加昵称', save: '保存', cancel: '取消', close: '关闭', more: '账号操作', reconnect: '重新连接', disconnect: '断开连接', add: '连接另一个账户', first: '连接账户', expired: '授权已失效', scopes: '需补充授权', failed: '昵称保存失败，请重试', disconnectFailed: '无法确认是否已断开连接，请重新打开插件详情核对账号状态，再决定是否重试。', cleanupFailed: '账号已断开，但昵称清理失败。' },
    en: { edit: 'Rename account', title: 'Rename account', nickname: 'Nickname', hint: 'Add nickname', save: 'Save', cancel: 'Cancel', close: 'Close', more: 'Account actions', reconnect: 'Reconnect', disconnect: 'Disconnect', add: 'Connect another account', first: 'Connect account', expired: 'Authorization expired', scopes: 'Additional authorization needed', failed: 'Unable to save nickname. Please try again.', disconnectFailed: 'Disconnect outcome is unknown. Reopen plugin details and check the account status before deciding whether to retry.', cleanupFailed: 'Account disconnected, but its nickname could not be removed.' },
    ja: { hint: 'ニックネームを追加' },
    ko: { hint: '닉네임 추가' },
  };
  function t(key) {
    return (MESSAGES[document.documentElement.lang] || MESSAGES.en)[key] || MESSAGES.en[key];
  }
  function icon(name) {
    var node = document.createElement('span');
    node.className = 'account-icon icon-' + name;
    node.setAttribute('aria-hidden', 'true');
    return node;
  }
  function button(text, iconName, className) {
    var node = document.createElement('button');
    node.type = 'button';
    node.className = className || '';
    if (iconName) node.appendChild(icon(iconName));
    if (text) node.appendChild(document.createTextNode(text));
    return node;
  }
  function status(text) { document.getElementById('status').textContent = text; }
  var closeMenu = function () {};
  var activeDialog = null;

  window.renderGoogleAccounts = function (key, accounts, refresh, reconnect) {
    closeMenu();
    document.querySelector('.title').textContent = document.documentElement.lang === 'zh-CN' ? '已连接的账户' : 'Connected accounts';
    var box = document.getElementById('accounts');
    box.textContent = '';
    var connect = document.getElementById('connect');
    var plus = document.createElement('span');
    plus.className = 'account-avatar';
    plus.appendChild(icon('Plus'));
    connect.replaceChildren(plus, document.createTextNode(t(accounts.length ? 'add' : 'first')));
    document.getElementById('reauth').hidden = true;
    accounts.forEach(function (account) {
      var row = document.createElement('div');
      row.className = 'account';
      row.dataset.accountId = account.id;
      var avatar = document.createElement('span');
      avatar.className = 'account-avatar';
      // Only use the Host-cached image. Never fetch an arbitrary profile URL.
      if (/^data:image\/(png|jpeg|webp);base64,/.test(account.avatarDataUrl || '')) {
        var image = document.createElement('img');
        image.src = account.avatarDataUrl;
        image.alt = '';
        image.onerror = function () { avatar.replaceChildren(icon('CircleUserRound')); };
        avatar.appendChild(image);
      } else {
        avatar.appendChild(icon('CircleUserRound'));
      }
      row.appendChild(avatar);
      var identity = document.createElement('div');
      identity.className = 'account-identity';
      var email = document.createElement('div');
      email.className = 'email';
      email.textContent = account.label || account.id;
      email.title = email.textContent;
      identity.appendChild(email);
      if (account.nickname) {
        var nickname = document.createElement('div');
        nickname.className = 'nickname';
        nickname.textContent = account.nickname;
        identity.appendChild(nickname);
      }
      if (account.status === 'expired' || account.scopeStale) {
        var tag = document.createElement('div');
        tag.className = 'account-auth-status expired';
        tag.textContent = t(account.status === 'expired' ? 'expired' : 'scopes');
        identity.appendChild(tag);
      }
      row.appendChild(identity);
      var more = button('', 'Ellipsis', 'account-more');
      more.setAttribute('aria-label', t('more') + ' · ' + email.textContent);
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', 'false');
      row.appendChild(more);
      box.appendChild(row);
      more.onclick = function () {
        var wasOpen = more.getAttribute('aria-expanded') === 'true';
        closeMenu();
        if (wasOpen) return;
        var menu = document.createElement('div');
        menu.className = 'account-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', more.getAttribute('aria-label'));
        // Own dismissal explicitly: native light-dismiss stops at the guest
        // document and does not see clicks in the surrounding Cindy window.
        menu.setAttribute('popover', 'manual');
        var rename = button(t('edit'), 'Pencil');
        var retry = button(t('reconnect'), 'RefreshCw');
        var disconnect = button(t('disconnect'), 'X', 'danger');
        var items = [rename, retry, disconnect];
        items.forEach(function (item) { item.setAttribute('role', 'menuitem'); menu.appendChild(item); });
        document.querySelector('.account-list').appendChild(menu);
        more.setAttribute('aria-expanded', 'true');
        var closed = false;
        var clean = function () {
          if (closed) return;
          closed = true;
          more.setAttribute('aria-expanded', 'false');
          menu.remove();
          document.removeEventListener('pointerdown', onOutside, true);
          document.removeEventListener('focusin', onOutside);
          window.removeEventListener('blur', clean);
          window.removeEventListener('resize', clean);
          window.removeEventListener('scroll', clean, true);
          if (closeMenu === clean) closeMenu = function () {};
        };
        var dismiss = function () { clean(); if (more.isConnected) more.focus(); };
        var onOutside = function (event) {
          if (!menu.contains(event.target) && !more.contains(event.target)) clean();
        };
        closeMenu = clean;
        menu.addEventListener('toggle', function (event) { if (event.newState === 'closed') clean(); });
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('focusin', onOutside);
        window.addEventListener('blur', clean);
        window.addEventListener('resize', clean);
        window.addEventListener('scroll', clean, true);
        menu.showPopover();
        var rect = more.getBoundingClientRect();
        var size = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(rect.right - size.width, innerWidth - size.width - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(rect.bottom + 4, innerHeight - size.height - 8)) + 'px';
        items[0].focus();
        menu.onkeydown = function (event) {
          var index = items.indexOf(document.activeElement);
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
          } else if (event.key === 'Escape' || event.key === 'Tab') {
            if (event.key === 'Escape') event.preventDefault();
            dismiss();
          }
        };
        rename.onclick = function () { dismiss(); editNickname(key, account, more, refresh); };
        retry.onclick = function () { dismiss(); void reconnect(account); };
        disconnect.onclick = async function () {
          dismiss();
          more.disabled = true;
          try {
            var response = await fetch('/oauth/' + key + '/accounts/' + encodeURIComponent(account.id), { method: 'DELETE' });
            if (!response.ok) throw new Error('disconnect failed');
            try { await googleAccountMetadata.remove(key, account.id); }
            catch (_) { status(t('cleanupFailed')); }
            await refresh();
          } catch (_) { status(t('disconnectFailed')); }
          finally { more.disabled = false; }
        };
      };
    });
  };

  function editNickname(key, account, trigger, refresh) {
    if (activeDialog) return;
    var dialog = document.createElement('dialog');
    dialog.className = 'nickname-dialog';
    dialog.setAttribute('aria-labelledby', 'nickname-dialog-title');
    dialog.setAttribute('aria-describedby', 'nickname-dialog-account');
    activeDialog = dialog;
    var form = document.createElement('form');
    var header = document.createElement('div');
    header.className = 'nickname-dialog-header';
    var title = document.createElement('h2');
    title.id = 'nickname-dialog-title';
    title.textContent = t('title');
    var close = button('', 'X', 'dialog-close');
    close.setAttribute('aria-label', t('close'));
    header.append(title, close);
    var email = document.createElement('p');
    email.id = 'nickname-dialog-account';
    email.className = 'nickname-dialog-email';
    email.textContent = account.label || account.id;
    var label = document.createElement('label');
    label.textContent = t('nickname');
    var input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.maxLength = 80;
    input.placeholder = t('hint');
    input.value = account.nickname || '';
    label.appendChild(input);
    var error = document.createElement('p');
    error.className = 'expired';
    error.setAttribute('role', 'status');
    var actions = document.createElement('div');
    actions.className = 'nickname-dialog-actions';
    var cancel = button(t('cancel'));
    var save = button(t('save'), null, 'primary');
    save.type = 'submit';
    save.disabled = true;
    var saving = false;
    function changed() { return input.value.trim() !== (account.nickname || ''); }
    input.oninput = function () { save.disabled = saving || !changed(); error.textContent = ''; };
    function dismiss() { if (!saving) dialog.close(); }
    cancel.onclick = close.onclick = dismiss;
    dialog.oncancel = function (event) { if (saving) event.preventDefault(); };
    dialog.onclick = function (event) {
      var rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dismiss();
    };
    actions.append(cancel, save);
    var content = document.createElement('div');
    content.className = 'nickname-dialog-content';
    content.append(email, label, error);
    form.append(header, content, actions);
    dialog.appendChild(form);
    // Host measures direct body children, including fixed-position elements.
    // Nest the top-layer dialog under the existing list so only normal-flow
    // content determines guest height. Only the form content scrolls in short
    // guests; the title, close button and actions remain visible.
    document.querySelector('.account-list').appendChild(dialog);
    dialog.onclose = function () {
      dialog.remove();
      activeDialog = null;
      if (trigger.isConnected) trigger.focus();
    };
    form.onsubmit = async function (event) {
      event.preventDefault();
      if (saving || !changed()) return;
      saving = true;
      save.disabled = cancel.disabled = close.disabled = input.disabled = true;
      try {
        await googleAccountMetadata.save(key, account.id, input.value.trim());
        dialog.close();
        await refresh();
        var next = document.getElementById('accounts').querySelectorAll('.account-more');
        var rows = document.getElementById('accounts').children;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].dataset.accountId === account.id) { next[i].focus(); break; }
        }
      } catch (_) {
        error.textContent = t('failed');
      } finally {
        saving = false;
        cancel.disabled = close.disabled = input.disabled = false;
        save.disabled = !changed();
      }
    };
    dialog.showModal();
    input.focus();
  }
})();
