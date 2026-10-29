'use strict';
const shortcuts = require('../shortcuts.js');
const library = require('../emote-library.js');
const { createHash } = require('node:crypto');
// Removed factory prompt fingerprints; user-written instructions are not rewritten.
const retiredPrompts = new Set([
  '2382f8b8df5dca54228becd5f478b571063a1fd366ab46b12afa90948b98c62a',
  '87cdb0a049cfbd81c700a507f17f3dd9c1e987cad4dc6d23870bd3ee8dc9860c',
  '516d1b26145ec7cf982387c16a365bf8c00aff3adefe0f9cd13bd0ad28b8f393',
  '2b36321515b4ff53f135acc9007aac51d3fc6e72638bd5bd7bad0601a0b5eb37',
  '30695bad9aae3df08b77f0daeb482274a1eb10eda5d48ff4cc9c7429c4372d2e',
  '30f45c324d6999796e5b83bffa50d185c24f4292e966aa0c46a87ceee357e5c4',
  'a4ad4a497f5a99b14a3f1029fe299968ef157585452cdafe5460b681ce5647ef',
  'ba7d41491fd83587e3545a496a5e7f74f5fa91b6ecb622e637309858538da101',
  'adc66d7d2a19a367506808c88f003bdd168657c4031b30d693a4feb3030a7410',
  '01c084b1b677cb39be178ff21bb95f9c3bde741064ccef86059c6e1a0e6ed06c',
  '0f7f3723a58ef0fede850d57b33e20f78c382bd12504832ad7bdb8277194addd',
  '0a9db5c406a76e72d1c9d744437059d93f5d372d3844aae173db4a37fae9ffc0',
  '3d40c0130a377389dfa4832e6dda54e2887a0dada2b0bba9eccfe27c21bf2cf0',
  'd4c3ade9e5394a7fecbbc96aed899037d59c0e74608d72835a410e9a00cea349',
  'ced59cc6df3757e84f11b4ab09d7005a541c966246c5a2cb79647f2f036e1b0e',
  '7baf62c565b12d622e069446c7eafa16101e83bfa703938cc353e51600c85568',
  '10569f2cad1e222338da05b64344a6308f3617e7f655594168f43c49375c92c2',
  'f3780335daca53fc7037136b012942a42f65f5f33f3a2cab142754f1eee1b525',
  '4e12e06dc79eedb74491db0c046adfab41491dcb15386b776f8a87d425adb931',
  'a937d44869728a8e9a0391efe21c457733b358c3acdca680019df2ee7dbea597',
]);
const wasFactoryPrompt = text => retiredPrompts.has(createHash('sha256').update(text || '').digest('hex'));

function validateRoute(route) {
  if (route == null) return null;
  const string = (value, limit) => typeof value === 'string' && value.length <= limit && !value.includes('\0');
  if (!['cc', 'codex', 'pi'].includes(route.agentKind) || !string(route.providerId, 128) || !route.providerId.trim() ||
      !string(route.model, 256) || !route.model.trim() || !string(route.effort, 32) ||
      (typeof route.fastMode !== 'boolean' && route.fastMode !== 'ultrafast'))
    throw new Error('CONFIG_INVALID');
  return { agentKind: route.agentKind, providerId: route.providerId, model: route.model,
    effort: route.effort, fastMode: route.fastMode };
}

function validateConfig(input) {
  if (!input || !Array.isArray(input.emotes) ||
      input.emotes.length < 4) throw new Error('CONFIG_INVALID');
  const ids = new Set();
  const emotes = input.emotes.map((item, index) => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id))
      throw new Error('CONFIG_INVALID');
    ids.add(item.id);
    const string = (value, limit) => typeof value === 'string' && value.length <= limit && !value.includes('\0');
    const promptMode = item.promptMode ?? 'preset';
    if (!string(item.label, 40) || !item.label.trim() || !string(item.emoji, 32) ||
        !string(item.imagePath || '', 4096) || (!item.emoji.trim() && !item.imagePath) ||
        !['none', 'undo', 'new', 'existing', 'bot'].includes(item.action) || !string(item.prompt || '', 8000) ||
        !['preset', 'input'].includes(promptMode) ||
        (!['none', 'undo'].includes(item.action) && promptMode === 'preset' && !item.prompt?.trim()) ||
        (item.action === 'existing' && !item.target && !string(item.taskId, 200)) ||
        (item.action === 'existing' && !item.target && !item.taskId?.trim())) throw new Error('CONFIG_INVALID');
    let target;
    if (item.target != null) {
      const value = item.target;
      if (!['pick', 'recent', 'fixed'].includes(value.mode)) throw new Error('CONFIG_INVALID');
      target = { mode: value.mode === 'pick' ? 'recent' : value.mode };
      if (value.mode === 'fixed') {
        const kind = { new: 'project', existing: 'task', bot: 'bot' }[item.action];
        if (!string(value.label || '', 200)) throw new Error('CONFIG_INVALID');
        if (value.ref) {
          if (!['project', 'task', 'bot'].includes(value.ref.kind) || (kind && value.ref.kind !== kind) ||
              !string(value.ref.id, value.ref.kind === 'project' ? 8192 : 200) || !value.ref.id.trim())
            throw new Error('CONFIG_INVALID');
          target.ref = { kind: value.ref.kind, id: value.ref.id };
        } else {
          // Retain unpublished prototype handles for explicit reselection; never guess a destination.
          if (!string(value.bindingId, 200) || !value.bindingId.trim()) throw new Error('CONFIG_INVALID');
          target.bindingId = value.bindingId;
        }
        target.label = value.label || '';
      }
    }
    if (item.action === 'bot' && !target) throw new Error('CONFIG_INVALID');
    if (item.delivery !== undefined && !['queue', 'steer'].includes(item.delivery)) throw new Error('CONFIG_INVALID');
    if (item.action === 'new' && item.permissionMode !== undefined &&
        !['ask', 'auto', 'bypassPermissions'].includes(item.permissionMode)) throw new Error('CONFIG_INVALID');
    const angle = item.angle === undefined ? index * 360 / input.emotes.length : item.angle;
    const pinAngle = item.pinAngle ?? null;
    if (!Number.isFinite(angle) || angle < 0 || angle >= 360 ||
        (pinAngle !== null && (!Number.isFinite(pinAngle) || pinAngle !== angle))) throw new Error('CONFIG_INVALID');
    return { angle, pinAngle, id: item.id, label: item.label.trim(), emoji: item.emoji, imagePath: library.imagePath(item.imagePath || ''),
      action: item.action === 'undo' ? 'none' : item.action, promptMode,
      prompt: ['none', 'undo'].includes(item.action) ? '' : item.prompt || '',
      taskId: item.action === 'existing' ? item.taskId : '', screenshot: item.screenshot !== false,
      route: item.action === 'new' ? validateRoute(item.route) : null, ...(target ? { target } : {}),
      ...(item.action === 'new' && item.permissionMode !== undefined ? { permissionMode: item.permissionMode } : {}),
      ...(item.delivery !== undefined ? { delivery: item.delivery } : {}) };
  });
  emotes.sort((a, b) => a.angle - b.angle);
  if (new Set(emotes.map(item => item.angle)).size !== emotes.length) throw new Error('CONFIG_INVALID');
  return { version: 2, emotes,
    wheelShortcut: shortcuts.validate(input.wheelShortcut === undefined ? shortcuts.defaults() : input.wheelShortcut) };
}
function migrateConfig(input) {
  const next = JSON.parse(JSON.stringify(input));
  for (const item of next.emotes || []) item.imagePath = library.imagePath(item.imagePath || '');
  const defaultIds = ['help', 'verify', 'inspire', 'improve'];
  const factoryPresets = [...library.presets('zh-CN'), ...library.presets('en')];
  const factoryWheel = next.emotes?.length === 4 && next.emotes.every(item =>
    factoryPresets.some(preset => defaultIds.includes(preset.id) && item.id === `ping-${preset.id}` &&
      item.imagePath === preset.imagePath && item.label === preset.label && item.emoji === preset.emoji) &&
    ['none', 'new'].includes(item.action) && !item.route && !item.taskId &&
    (!item.target || item.target.mode === 'pick') && (!item.prompt || wasFactoryPrompt(item.prompt)));
  for (const item of next.emotes || []) {
    if (!['none', 'new'].includes(item.action) || item.route || item.taskId || item.target?.mode === 'fixed' ||
        !wasFactoryPrompt(item.prompt)) continue;
    item.action = 'none'; item.prompt = ''; item.taskId = '';
    delete item.target;
  }
  if (factoryWheel) {
    const undo = library.defaults(input.locale).emotes.find(item => item.id === 'ping-undo');
    next.emotes = next.emotes.map(item => item.id === 'ping-improve'
      ? { ...undo, angle: item.angle, pinAngle: item.pinAngle } : item);
  }
  if (next.version === 2) return validateConfig(next);
  if (!Array.isArray(next.emotes) || !next.emotes.length) throw new Error('CONFIG_INVALID');
  const defaults = [['question', '问号', '❓'], ['smile', '开心', '😄'], ['eyes', '看看', '👀'], ['think', '思考', '🤔']];
  for (const [id, label, emoji] of defaults) {
    if (next.emotes.length >= 4) break;
    if (!next.emotes.some(item => item.id === id)) next.emotes.push({ id, label, emoji, action: 'none', prompt: '', taskId: '', screenshot: true });
  }
  next.emotes.forEach((item, i) => { item.angle = i * 360 / next.emotes.length; item.pinAngle = null; });
  return validateConfig(next);
}
module.exports = { validateConfig, migrateConfig };
