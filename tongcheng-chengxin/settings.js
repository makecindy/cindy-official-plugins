'use strict';
const keyInput = document.getElementById('api-key');
const statusNode = document.getElementById('status');
const saveButton = document.getElementById('save');
const clearButton = document.getElementById('clear');
const key = 'tongcheng_api_key';
async function refresh(message) {
  try { const response = await fetch('/secrets'); if (!response.ok) throw new Error(); const list = await response.json(); const saved = Array.isArray(list) && list.some((item) => item.key === key && item.saved); statusNode.textContent = message || (saved ? 'API Key 已保存；密钥内容不会显示。' : '尚未配置 API Key，请按上方步骤领取程心激活码。'); clearButton.disabled = !saved; }
  catch { statusNode.textContent = '暂时无法读取授权状态，请稍后重试。'; }
}
saveButton.addEventListener('click', async () => { const value = keyInput.value; if (!value.trim()) { statusNode.textContent = '请先输入 API Key。'; return; } saveButton.disabled = true; try { const response = await fetch('/secrets/' + key, { method: 'PUT', body: JSON.stringify({ value }) }); if (!response.ok) throw new Error(); keyInput.value = ''; await refresh('API Key 已交给 Cindy 安全保存。'); } catch { statusNode.textContent = '保存失败；密钥仍留在输入框中，可检查后重试。'; } finally { saveButton.disabled = false; } });
clearButton.addEventListener('click', async () => { clearButton.disabled = true; try { const response = await fetch('/secrets/' + key, { method: 'DELETE' }); if (!response.ok) throw new Error(); await refresh('已清除 API Key。'); } catch { statusNode.textContent = '清除失败，请稍后重试。'; clearButton.disabled = false; } });
refresh();
