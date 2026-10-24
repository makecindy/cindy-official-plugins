/**
 * Headline Digest settings.
 *
 * Credential discipline (authoring reference §4.7):
 *  - the value goes straight from the input to the Host vault via
 *    `PUT /secrets/newsapi_key`; it is never written to /kv, a BroadcastChannel,
 *    the DOM after submit, or a log;
 *  - `GET /secrets` reports only `{ key, saved, tail? }` per entry — never the value;
 *  - `DELETE /secrets/newsapi_key` clears it.
 */
(function () {
  'use strict';

  var SECRET_KEY = 'newsapi_key';
  var ENDPOINT = '/secrets/' + SECRET_KEY;

  var els = {
    status: document.getElementById('status'),
    input: document.getElementById('key'),
    save: document.getElementById('save'),
    remove: document.getElementById('remove'),
    message: document.getElementById('message')
  };

  function setMessage(text) {
    els.message.textContent = text || '';
  }

  function setStatus(saved, tail) {
    if (saved) {
      els.status.dataset.state = 'saved';
      els.status.textContent = tail ? 'Saved — ends ' + tail : 'Saved';
    } else {
      els.status.dataset.state = 'missing';
      els.status.textContent = 'Not saved yet';
    }
  }

  async function refresh() {
    try {
      var response = await fetch('/secrets', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('status ' + response.status);
      var list = await response.json();
      var entry = Array.isArray(list)
        ? list.find(function (item) { return item && item.key === SECRET_KEY; })
        : null;
      setStatus(Boolean(entry && entry.saved), entry && entry.tail ? entry.tail : '');
    } catch (error) {
      els.status.dataset.state = 'missing';
      els.status.textContent = 'Cannot read status';
      setMessage('Cindy could not report the saved key. Reopen this page; if it repeats, update Cindy.');
    }
  }

  async function save() {
    var value = els.input.value.trim();
    if (!value) return;

    els.save.disabled = true;
    setMessage('');
    try {
      var response = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: value })
      });
      if (response.status !== 204 && !response.ok) {
        throw new Error('status ' + response.status);
      }
      // Clear the field as soon as the Host has it: the page keeps no copy.
      els.input.value = '';
      setMessage('Key saved. Cindy injects it on newsapi.org requests; Headline Digest cannot read it.');
      await refresh();
    } catch (error) {
      setMessage('Cindy could not save the key. Check that the value is correct and try again.');
    } finally {
      els.save.disabled = els.input.value.trim() === '';
    }
  }

  async function remove() {
    els.remove.disabled = true;
    setMessage('');
    try {
      var response = await fetch(ENDPOINT, { method: 'DELETE' });
      if (response.status !== 204 && !response.ok) throw new Error('status ' + response.status);
      els.input.value = '';
      setMessage('Key removed. Headlines will fail until a new key is saved.');
      await refresh();
    } catch (error) {
      setMessage('Cindy could not remove the key. Retry once; if it repeats, update Cindy.');
    } finally {
      els.remove.disabled = false;
    }
  }

  els.input.addEventListener('input', function () {
    els.save.disabled = els.input.value.trim() === '';
    if (els.message.textContent) setMessage('');
  });

  els.input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !els.save.disabled) {
      event.preventDefault();
      save();
    }
  });

  els.save.addEventListener('click', save);
  els.remove.addEventListener('click', remove);

  refresh();
})();
