(function () {
  'use strict';

  var input = document.getElementById('token');
  var eye = document.getElementById('eye');
  var badge = document.getElementById('badge');
  var status = document.getElementById('status');
  var timer = null;

  function showStatus(message) {
    status.textContent = message;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { status.textContent = ''; }, 2500);
  }

  function syncEye() {
    var empty = input.value.length === 0;
    eye.classList.toggle('hidden', empty);
    if (empty) {
      input.type = 'password';
      eye.classList.remove('revealed');
    }
  }

  function setSaved(saved, tail) {
    badge.className = saved ? 'badge on' : 'badge';
    input.placeholder = saved
      ? (tail ? '已保存（尾号 ' + tail + '），粘贴新值可覆盖' : '已保存，粘贴新值可覆盖')
      : '粘贴 FAOSTAT API Token';
  }

  eye.addEventListener('click', function () {
    var revealed = input.type === 'password';
    input.type = revealed ? 'text' : 'password';
    eye.classList.toggle('revealed', revealed);
  });
  input.addEventListener('input', syncEye);

  document.getElementById('save').addEventListener('click', function () {
    var value = input.value.trim();
    if (!value) {
      showStatus('先粘贴 Token 再保存');
      return;
    }
    fetch('/secrets/faostat_api_token', {
      method: 'PUT',
      body: JSON.stringify({ value: value })
    }).then(function (response) {
      if (response.status !== 204) throw new Error('HTTP ' + response.status);
      input.value = '';
      syncEye();
      setSaved(true, null);
      void load();
      showStatus('Token 已安全保存');
    }).catch(function () {
      showStatus('保存失败，请重试');
    });
  });

  document.getElementById('clear').addEventListener('click', function () {
    fetch('/secrets/faostat_api_token', { method: 'DELETE' })
      .then(function (response) {
        if (response.status !== 204) throw new Error('HTTP ' + response.status);
        input.value = '';
        syncEye();
        setSaved(false, null);
        showStatus('Token 已清除');
      }).catch(function () {
        showStatus('清除失败，请重试');
      });
  });

  async function load() {
    try {
      var response = await fetch('/secrets');
      var entries = await response.json();
      var entry = Array.isArray(entries)
        ? entries.filter(function (item) {
          return item && item.key === 'faostat_api_token';
        })[0]
        : null;
      setSaved(Boolean(entry && entry.saved), entry && entry.tail ? entry.tail : null);
    } catch (error) {
      setSaved(false, null);
    }
  }

  syncEye();
  void load();
})();
