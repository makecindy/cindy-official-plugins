const form = document.getElementById('settings');
const token = document.getElementById('token');
const status = document.getElementById('status');

form.addEventListener('submit', async event => {
  event.preventDefault();
  const value = token.value.trim();
  token.value = '';
  if (!value) return;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const reply = await fetch('/secrets/cloudflare_token', {
      method: 'PUT', body: JSON.stringify({value}),
    });
    status.textContent = reply.ok ? 'Token saved.' : 'Could not save token.';
  } catch {
    status.textContent = 'Could not save token.';
  } finally {
    button.disabled = false;
  }
});
