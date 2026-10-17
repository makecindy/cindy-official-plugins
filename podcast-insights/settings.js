(function () {
  "use strict";
  let ui;
  const key = document.getElementById("key"),
    status = document.getElementById("key-status");
  async function state() {
    const r = await fetch("/secrets");
    if (!r.ok) throw new Error(ui.failed);
    const values = await r.json();
    const entry = values.find(v => v.key === 'assemblyai_key' && v.saved);
    status.textContent = entry ? ui.keySaved + (typeof entry.tail === 'string' ? ' · …' + entry.tail : '') : ui.keyMissing;
  }
  async function act(method) {
    const buttons = document.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    try {
      const value = key.value.trim();
      if (method === "PUT" && !value) {
        status.textContent = ui.keyMissing;
        return;
      }
      const r = await fetch("/secrets/assemblyai_key", {
        method,
        ...(method === "PUT" ? { body: JSON.stringify({ value }) } : {}),
      });
      if (!r.ok) throw new Error(ui.failed);
      await state();
    } catch {
      status.textContent = ui.failed;
    } finally {
      key.value = "";
      buttons.forEach((b) => (b.disabled = false));
    }
  }
  window.addEventListener("podcast-ui-ready", () => {
    ui = PodcastUI;
    document.getElementById("save").onclick = () => act("PUT");
    document.getElementById("clear").onclick = () => act("DELETE");
    state().catch(() => {
      status.textContent = ui.failed;
    });
  });
})();
