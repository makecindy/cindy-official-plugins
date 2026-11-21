import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import lib from '../herdr/panel-lib.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const panelSource = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');

// 最小 DOM 桩：够跑一遍真实渲染路径，能抓到 ReferenceError 这类
// “只有真跑才炸”的问题（上一轮把 dirName 抽走后没绑定就是这么漏掉的）。
function makeElement(tag) {
  const children = [];
  const attrs = {};
  return {
    tagName: String(tag).toUpperCase(),
    children,
    attrs,
    className: '',
    textContent: '',
    innerHTML: '',
    title: '',
    value: '',
    placeholder: '',
    hidden: false,
    type: '',
    style: {},
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    appendChild(child) { children.push(child); return child; },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return attrs[name] ?? null; },
    addEventListener() {},
    removeEventListener() {},
    focus() {}
  };
}

function loadPanel() {
  const nodes = new Map();
  const document = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, makeElement('div'));
      return nodes.get(selector);
    },
    querySelectorAll() { return []; },
    createElement(tag) { return makeElement(tag); },
    createTextNode(text) { return { nodeValue: String(text), children: [] }; },
    createDocumentFragment() { return makeElement('#fragment'); },
    documentElement: makeElement('html'),
    body: makeElement('body')
  };
  const sandbox = {
    console,
    document,
    BroadcastChannel: class {
      constructor() {}
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
    },
    // 面板只认宿主语言，所以这里直接给 zh-CN。
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, context: { region: 'cn', locale: 'zh-CN', uiLocale: 'zh-CN' } })
    }),
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    Promise,
    RegExp,
    Intl
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.HerdrPanelLib = lib;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(panelSource, sandbox, { filename: 'panel.js' });
  return { sandbox, nodes };
}

function collectText(node, out = []) {
  if (node && typeof node.textContent === 'string' && node.textContent) out.push(node.textContent);
  for (const child of (node && node.children) || []) collectText(child, out);
  return out;
}

function collectByClassName(node, className, out = []) {
  if (node && String(node.className || '').split(/\s+/).includes(className)) out.push(node);
  for (const child of (node && node.children) || []) collectByClassName(child, className, out);
  return out;
}

test('the panel renders the Herdr pane list without throwing', async () => {
  const { sandbox, nodes } = loadPanel();
  await sandbox.loadLocale();
  const fixture = {
    workspaces: [
      { workspace_id: 'w1', label: 'vibecoding', focused: true },
      { workspace_id: 'wM', label: 'magpie', focused: false }
    ],
    tabs: [],
    panes: [
      { pane_id: 'w1:p1', workspace_id: 'w1', label: 'cindy', agent: 'claude', agent_status: 'working', cwd: '/home/michael/codes/cindy', title: 'feat' },
      { pane_id: 'w1:p2', workspace_id: 'w1', label: 'shell', agent: null, agent_status: 'idle', cwd: '/home/michael', title: 'zsh' },
      { pane_id: 'wM:p1', workspace_id: 'wM', agent: 'codex', agent_status: 'blocked', cwd: '/home/michael/codes/magpie', title: 'blocked work' }
    ]
  };

  // state 是顶层 let，直接挂在 window 上不生效：在同一 context 里注入并渲染。
  vm.runInContext('state = ' + JSON.stringify(fixture) + '; renderHerdr();', sandbox);

  const list = nodes.get('#list');
  assert.ok(list.children.length > 0, 'renderHerdr produced no nodes');
  const titles = collectText(list);

  assert.ok(titles.includes('vibecoding'), `missing group title: ${titles.join(' | ')}`);
  assert.ok(titles.includes('magpie'), 'second workspace should render');
  assert.ok(titles.includes('cindy'), 'agent chip should show the directory name');
  assert.ok(titles.includes('shell'), 'plain pane chip should keep its label');

  // 状态不能只靠颜色：agent chip 要有本地化状态文字。
  assert.ok(titles.includes('进行中'), `missing status text: ${titles.join(' | ')}`);
  assert.ok(titles.includes('待处理'), 'blocked state must be readable text');

  // 原始 pane id 不该出现在列表里。
  assert.ok(!titles.some((text) => /^w\d+:p\d+$/.test(text)), `raw pane id leaked: ${titles.join(' | ')}`);

  // 每个 chip 都要给读屏软件一份完整 aria-label。
  const chips = collectByClassName(list, 'chip');
  assert.ok(chips.length >= 3, `expected at least 3 chips, got ${chips.length}`);
  for (const chip of chips) {
    assert.ok(chip.attrs['aria-label'], `chip without aria-label: ${chip.title}`);
  }
  const shellChip = chips.find((chip) => (chip.attrs['aria-label'] || '').includes('shell'));
  assert.ok(shellChip, 'plain pane chip should exist');
  assert.match(shellChip.attrs['aria-label'], /idle|空闲/, 'aria-label must carry the state');
});

test('the empty workspace list renders an empty state instead of throwing', async () => {
  const { sandbox } = loadPanel();
  await sandbox.loadLocale();
  vm.runInContext(
    'state = { workspaces: [], tabs: [], panes: [] }; renderHerdr();',
    sandbox
  );
});

test('every shared-library function used by the panel is bound', () => {
  const used = ['dirName', 'graphemes', 'isWideGrapheme', 'specialKey', 'WIDE_CHAR'];
  for (const name of used) {
    const defined = new RegExp(`(const|function|let|var)\\s+${name}\\b`).test(panelSource);
    const referenced = new RegExp(`(?<![.\\w])${name}\\b`).test(panelSource);
    if (referenced) assert.ok(defined, `${name} is used in panel.js but never defined or bound`);
  }
});


test('switching panes drops the unsent draft instead of sending it to the new target', async () => {
  const { sandbox, nodes } = loadPanel();
  await sandbox.loadLocale();
  const input = nodes.get('#term-input');

  vm.runInContext(
    'state = { workspaces: [{ workspace_id: "w1", label: "w" }], tabs: [], panes: ['
    + ' { pane_id: "w1:p1", workspace_id: "w1", label: "a", agent: "claude", agent_status: "working", cwd: "/a" },'
    + ' { pane_id: "w1:p2", workspace_id: "w1", label: "b", agent: "claude", agent_status: "idle", cwd: "/b" } ] };'
    + ' renderHerdr();',
    sandbox
  );
  // state 是顶层 let，不在 window 上：在同一 context 里取。
  const paneA = vm.runInContext('state.panes[0]', sandbox);
  const paneB = vm.runInContext('state.panes[1]', sandbox);

  void sandbox.openPane(paneA);
  input.value = 'ls --color';
  void sandbox.openPane(paneB);

  // 换目标必须丢草稿：否则回车会把 A 的命令打进 B。
  assert.equal(input.value, '', 'draft must be dropped when the target changes');
});

test('the detail header follows the pane state after a rebind', async () => {
  const { sandbox, nodes } = loadPanel();
  await sandbox.loadLocale();
  sandbox.renderHerdrDetail({ pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', cwd: '/home/michael/codes/cindy', title: 'feat' });
  const title = nodes.get('#detail-title');
  const state = nodes.get('#detail-state-text');
  assert.equal(title.textContent, 'feat');
  assert.equal(state.textContent, '进行中');

  sandbox.renderHerdrDetail({ pane_id: 'w1:p1', agent: 'claude', agent_status: 'blocked', cwd: '/home/michael/codes/cindy', title: 'feat' });
  assert.equal(state.textContent, '待处理', 'detail state must follow the fresh pane object');
});

test('each refresh gets its own token so a stale response cannot overwrite', () => {
  const source = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  const body = /async function refresh\(force\) \{([\s\S]*?)\n\}/.exec(source);
  assert.ok(body, 'refresh() must exist');
  assert.match(body[1], /refreshToken \+= 1;/, 'refresh must allocate a new token at the start');

  // 过期检查必须发生在写 state / 渲染之前：等 refresh() 回来再判已经晚了。
  const herdr = /async function refreshHerdr\(token\) \{([\s\S]*?)\n\}/.exec(source);
  assert.ok(herdr, 'refreshHerdr must take the token');
  const assignAt = herdr[1].indexOf('state = snapshot');
  const checkAt = herdr[1].indexOf('token !== refreshToken');
  assert.ok(checkAt >= 0 && assignAt > checkAt, 'stale check must run before writing state');
});

test('the wrap toggle keeps its icon and the refresh button names its action', async () => {
  const { sandbox, nodes } = loadPanel();
  await sandbox.loadLocale();
  const wrap = nodes.get('#detail-wrap');
  const refresh = nodes.get('#refresh');

  // 换行开关不能用 textContent 把 SVG 抹掉。
  assert.equal(wrap.innerHTML, '', 'icon markup lives in panel.html, not in JS');
  assert.equal(wrap.attrs['aria-label'], '自动换行');
  assert.equal(wrap.attrs['aria-pressed'], 'true');

  // 刷新按钮的可访问名要是动作，不能是「已更新」这种状态。
  assert.equal(refresh.attrs['aria-label'], '刷新');
  assert.equal(refresh.attrs['title'], '刷新');

  // outputWrap 是顶层 let，要同一 context 里改。
  vm.runInContext('outputWrap = false; syncWrapButton();', sandbox);
  assert.equal(wrap.attrs['aria-pressed'], 'false');
  assert.equal(wrap.attrs['aria-label'], '不换行');
});

test('submitting a line pins one target for both tmux sends', () => {
  const source = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  const wrapper = /function submitLine\(\) \{([\s\S]*?)\n\}/.exec(source);
  assert.ok(wrapper, 'submitLine must exist');
  assert.match(wrapper[1], /const target = selectedTarget;/, 'target must be captured at submit time');
  assert.match(wrapper[1], /enqueueForScope\(scope/, 'submits must be serialized per scope');
  const body = /async function submitLineQueued\(text, pinnedView, target, paneId, scope, holdAtEnqueue, kindAtEnqueue, unlockTokenValue, epoch\) \{([\s\S]*?)\n\}/.exec(source);
  assert.ok(body, 'submitLineQueued must exist');
  const text = body[1];
  assert.match(text, /request\('tmux_submit', \{[\s\S]{0,120}?target: target, text: text, allow_held: unlockedResend/,
    'the text and Enter must be one RPC pinned to the captured target');
  // Herdr 的提交走 submit 动作（pane.send_input），不是只打字的 send。
  assert.match(text, /request\('submit', \{ pane_id: paneId, text: text \}\)/,
    'herdr submission must go through the submit action');
});

test('the detail closes when the selected pane disappears', () => {
  const source = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  const body = /async function refresh\(force\) \{([\s\S]*?)\n\}/.exec(source);
  assert.ok(body, 'refresh must exist');
  assert.match(body[1], /if \(fresh\) renderTmuxDetail\(fresh\);\s*else closeDetail\(\);/,
    'a vanished tmux target must close the detail');
  assert.match(body[1], /if \(fresh\) \{[\s\S]*?renderHerdrDetail\(fresh\);\s*\} else \{\s*closeDetail\(\);/,
    'a vanished herdr pane must close the detail');
});

test('the panel waits longer than the slowest backend operation', () => {
  const source = readFileSync(path.join(root, 'herdr', 'panel.js'), 'utf8');
  const match = /const PANEL_REQUEST_TIMEOUT_MS = (\d+);/.exec(source);
  assert.ok(match, 'panel request budget must be a constant');
  // 后端最慢：session.snapshot 30s，tmux_state 是三连 8+8+8s。
  assert.ok(Number(match[1]) >= 30000, `panel budget ${match[1]}ms is shorter than the backend`);
});

// 非 macOS 的剪贴板快捷键必须留在本地。
{
  const textField = { tagName: 'TEXTAREA', isContentEditable: false };
  assert.equal(lib.specialKey('tmux', { ctrlKey: true, key: 'v', target: textField }), null,
    'Ctrl+V in the input box must stay a local paste');
  assert.equal(lib.specialKey('tmux', { ctrlKey: true, shiftKey: true, key: 'C', target: textField }), null,
    'Ctrl+Shift+C in the input box must stay a local copy');
  assert.equal(lib.specialKey('tmux', { ctrlKey: true, key: 'c', target: textField }), 'C-c',
    'plain Ctrl+C must still cancel the terminal line');
  assert.equal(lib.specialKey('tmux', { ctrlKey: true, key: 'v', target: { tagName: 'DIV' } }), 'C-v',
    'outside a text field the terminal still receives Ctrl+V');
}
