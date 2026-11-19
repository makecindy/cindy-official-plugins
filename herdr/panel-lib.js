/* Herdr 控制台面板的纯函数：按键映射、宽字符与 grapheme 处理、目录名。
   既给面板页面用（普通 script，挂 window.HerdrPanelLib），
   也给仓库测试用（CommonJS 导出），两边是同一份代码。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HerdrPanelLib = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  // 宽字符（中日韩、全角、emoji 区）：在终端里占 2 个单元格。
  const WIDE_CHAR = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{2FA1F}]/u;

  const HERDR_KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end',
    Tab: 'tab', Escape: 'esc', Backspace: 'backspace', Delete: 'delete'
  };
  const TMUX_KEYS = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    PageUp: 'PageUp', PageDown: 'PageDown', Home: 'Home', End: 'End',
    Tab: 'Tab', Escape: 'Escape', Backspace: 'BSpace', Delete: 'DC'
  };
  // 只有「终端行为」键才转发；退格/删除/左右/Home/End 只编辑还没提交的草稿。
  const FORWARDABLE_KEYS = {
    ArrowUp: 1, ArrowDown: 1, PageUp: 1, PageDown: 1, Tab: 1, Escape: 1
  };

  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

  function graphemes(text) {
    const source = String(text == null ? '' : text);
    if (segmenter) {
      return Array.from(segmenter.segment(source), function (part) { return part.segment; });
    }
    // 没有 Intl.Segmenter 时，至少别把代理对拆开。
    const out = [];
    for (let i = 0; i < source.length;) {
      const code = source.codePointAt(i);
      const size = code > 0xffff ? 2 : 1;
      out.push(source.slice(i, i + size));
      i += size;
    }
    return out;
  }

  function isWideGrapheme(text) {
    const unit = String(text == null ? '' : text);
    return WIDE_CHAR.test(unit[0] || '') || WIDE_CHAR.test(unit);
  }

  // view: 'herdr' | 'tmux'；返回要发给后端的按键名，或 null（这次不转发）。
  function specialKey(view, event) {
    if (event.ctrlKey || event.metaKey) {
      if (String(event.key).length !== 1) return null;
      return (view === 'tmux' ? 'C-' : 'ctrl+') + String(event.key).toLowerCase();
    }
    if (!FORWARDABLE_KEYS[event.key]) return null;
    const table = view === 'tmux' ? TMUX_KEYS : HERDR_KEYS;
    return table[event.key] || null;
  }

  // 目录名：只保留路径最后一段；没有路径时返回空串。
  function dirName(value) {
    const text = String(value == null ? '' : value).replace(/\/+$/, '');
    if (!text) return '';
    const parts = text.split('/');
    return parts[parts.length - 1] || text;
  }

  return {
    WIDE_CHAR: WIDE_CHAR,
    HERDR_KEYS: HERDR_KEYS,
    TMUX_KEYS: TMUX_KEYS,
    FORWARDABLE_KEYS: FORWARDABLE_KEYS,
    graphemes: graphemes,
    isWideGrapheme: isWideGrapheme,
    specialKey: specialKey,
    dirName: dirName
  };
});
