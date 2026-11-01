'use strict';
/**
 * 通讯录主视图：左边是 Cindy 整理过的人，右边是一个人的档案（概览 / 往来 / 资料）。
 * 页面没有任何宿主能力，所有数据经同源 BroadcastChannel 交给 main.js 处理。
 */
(() => {
  /* ───────── 文案 ───────── */
  const STRINGS = {
    'zh-CN': {
      title: '人', all: '所有人', recent: '最近联系', pending: '待确认', orgs: '公司与团队', groups: '分组',
      search: '找一个人…',
      secNew: '上次看过之后', secRecent: '最近在来往', secEarlier: '更早认识的',
      folded: (n) => `另有 ${n} 人只有联系方式`, expand: '展开', collapse: '收起',
      subNew: (n) => `上次看过之后更新了 ${n} 人`, subCount: (n) => `Cindy 整理了 ${n} 人的档案`,
      today: '今天', yesterday: '昨天', days: (n) => `${n} 天前`, weeks: (n) => `${n} 周前`, months: (n) => `${n} 个月前`, years: (n) => `${n} 年前`,
      noMatch: '没有找到这个人。', emptyScope: '这里还没有人。',
      edit: '编辑', more: '更多', back: '返回', save: '保存', cancel: '取消', create: '新建',
      newContact: '新建联系人', importMac: '从 macOS 通讯录导入', findDups: '查找重复', retryLegacy: '重新导入旧版通讯录', autoSettings: '整理',
      tabOverview: '概览', tabHistory: '往来', tabInfo: '资料',
      since: '上次看过之后', sinceCount: (n) => `${n} 件事`,
      loops: '你们之间还没完的事', loopsNone: '没有还没完的事。', doneTag: '已完成', markDone: '标记为已完成', reopen: '重新打开',
      cv: '履历与关系', related: '常一起', inGroups: '分组',
      thin: 'Cindy 还没读到和 TA 的往来。', thinAct: '去邮件和飞书里找找',
      contactLine: (n) => `往来 ${n} 次`, lastLine: (d) => `上次 ${d}`,
      filterAll: (n) => `全部 ${n}`, shownRecent: (n) => `这里只显示最近 ${n} 条往来。`, ch: { mail: '邮件', im: '消息', calendar: '日程', cindy: 'Cindy 对话', github: 'GitHub', call: '通话', other: '其它' },
      open: '打开原文', coveredTo: (d) => `已补到 ${d}`, coveredNone: '还没有往前补过', backfillBtn: (m) => `再往前补 ${m} 个月`, backfilling: 'Cindy 正在往前补…',
      noHistory: '还没有记下往来。',
      ids: '联系方式', merges: 'Cindy 自动合并的档案', split: '拆开', splitDone: (n) => `已拆开，「${n}」恢复成单独的档案`,
      mergeNote: 'Cindy 会自己判断哪些是同一个人并直接合并。合错了点「拆开」，或者直接告诉 Cindy 哪句不对。',
      copied: (v) => `已复制 ${v}`,
      askPh: (n) => (n ? `问关于${n}的事，或让 Cindy 写封邮件` : '让 Cindy 帮你整理通讯录'),
      thinking: 'Cindy 在想…', working: (n) => `Cindy 正在处理，过程在侧边栏「通讯录 · ${n}」任务里`, failedTask: '这次没有完成，可以在侧边栏的任务里看原因。',
      markPending: '标记为待确认', markConfirmed: '标记为已确认', addToGroup: '加入分组', newGroup: '新分组名，回车创建',
      removeFromGroup: (g) => `移出「${g}」`, del: '删除这个人…', delAsk: (n) => `确定删除「${n}」？往来和联系方式会一起删除，无法恢复。`, delYes: '删除',
      deleted: (n) => `已删除 ${n}`, savedOk: '已保存', confirmed: '已确认',
      fName: '名字', fAliases: '别名（逗号分隔）', fKind: '类型', person: '人', org: '组织', fSummary: '一句话介绍', fStory: '介绍',
      fNote: '给 AI 的提示（只给 AI 看）', fIds: '联系方式与身份', addId: '添加一项', fGroups: '分组（逗号分隔）',
      dupSuspect: '已有名字相似的人：', createAnyway: '仍然新建',
      helloTitle: '让 Cindy 认识你身边的人',
      helloText: (d) => `Cindy 会读你最近 ${d} 天的邮件、日历、飞书和 Cindy 对话，给常来往的人写好档案：是谁、你们之间还没完的事、全部往来。之后每天自动更新；想要更早的，随时往前补。`,
      helloStart: (d) => `整理最近 ${d} 天`, helloDaily: '每天自动整理', helloOther: '也可以', helloMac: '从 Mac 通讯录导入', helloManual: '手动新建一位',
      helloRunning: 'Cindy 正在整理。先写来往最多的人，写好一个，左边就出现一个。',
      helloNote: '整理会用你已经装好的插件和本机能读到的数据（加密的聊天记录不读），每次都会用到 AI 额度。过程在侧边栏「通讯录 · 整理」任务里，第一次用某个插件时可能要你点一下允许。',
      legacyFailed: (m) => `旧版通讯录没有导入成功：${m}`,
      loading: '正在打开通讯录…', importingLegacy: '正在从旧版通讯录导入…', legacyDone: (n) => `已从旧版通讯录导入 ${n} 份档案`,
      legacyAvailable: (n) => `旧版智能通讯录里还有 ${n} 份档案，可以导入到这里；和已有档案邮箱、手机号或平台账号相同的人会并到一起。`, importLegacy: '导入旧版通讯录',
      legacyMerged: '旧版通讯录已导入。名字相同但没有共同联系方式的人可能重复，可用「查找重复」合并。',
      readMac: '读取 Mac 通讯录', reading: '正在读取 Mac 通讯录…第一次会弹出系统授权，请选择允许。',
      importIntro: '只读取，不会修改 Mac 通讯录。邮箱或电话相同的名片会并入已有档案。',
      preview: (r) => `共 ${r.total} 张名片：新建 ${r.created} 位，补全 ${r.updated} 位已有档案，${r.unchanged} 位已经在了。`,
      previewReview: (n) => `其中 ${n} 位和已有档案重名。`,
      doImport: '导入', importing: '正在导入…', imported: (r) => `已导入：新建 ${r.created} 位，补全 ${r.updated} 位`,
      noPerm: '没有通讯录权限。请到「系统设置 › 隐私与安全性 › 自动化」允许 Cindy 控制「通讯录」，然后重试。',
      macOnly: '只有 Mac 可以从系统通讯录导入。', retry: '重试',
      dupsTitle: '可能重复的档案', dupsNone: '没有发现重复的档案。', mergeLeft: '并入左边', notSame: '不是同一人', merged: '已合并',
      failed: '没有成功：', libError: '通讯录资料库暂时打不开：',
      footLast: (w) => `上次整理 ${w}`, footNever: '还没有整理过', footRunning: 'Cindy 正在整理…', footSettings: '整理',
      autoTitle: '整理',
      autoText: 'Cindy 按时间段整理：每次只读上次整理之后的新往来，给有变化的人改写档案。第一次只读最近一段，想要更早的可以往前补。每次整理都会用到 AI 额度。',
      settingsWhere: '读哪些来源、第一次读几天、每天自动整理，在 Cindy 侧边栏「插件」→「通讯录」的详情页里设置；整理用的模型和动手权限也在那里的「任务设置」。',
      firstDays: '第一次读最近', daysOpt: (d) => `${d} 天`,
      sourcesLabel: '读哪些来源', src: { mail: '邮件', calendar: '日历', im: '消息（飞书、iMessage 等）', cindy: 'Cindy 对话', github: 'GitHub' },
      srcHint: '用已装的插件、本机命令行工具和能直接读的数据；都读不到的会跳过，并写明原因。',
      backLabel: '往前补每次', monthsOpt: (m) => `${m} 个月`,
      tidyNow: '现在整理一次', backfillAll: (m) => `所有人往前补 ${m} 个月`, tidySent: '已交给 Cindy，在侧边栏「通讯录 · 整理」任务里可以看过程',
      profileLabel: '你的通讯录主要是', profColleagues: '同事和朋友', profClients: '很多客户',
      profColleaguesHint: '每天整理一次', profClientsHint: '每 6 小时整理一次，客户按公司归类，记下需求、报价和跟进约定',
      macSync: '每天和 macOS 通讯录对一次账（不用 AI）', macSyncHint: '只在你导入过一次后生效；只读，不改 Mac 通讯录',
      openAutomation: '每天自动整理：去自动化页开启', automationOpened: '已打开 Cindy 的自动化页：选好模型后点保存，每天自动整理就开始了。',
      automationAgain: '重新打开自动化页', stopHint: '想停用或改频率：在 Cindy 的自动化页暂停或删除「整理通讯录」。',
      srcName: { mail: '邮件', calendar: '日历', im: '消息', cindy: 'Cindy 对话', github: 'GitHub' },
      srcState: { ok: '能读', missing: '没装插件', unauthorized: '没连接账号', unavailable: '这次用不了', error: '出错了', skipped: '跳过' },
      srcTitle: '上次检查的来源',
      covPartial: (n) => `没读完${n ? ` ${n} 处` : ''}，下次先补`, covNone: '这次没读到，下次接着读',
      srcFix: '没装或没连接的：在 Cindy 侧边栏「插件」里安装并连接账号，下次整理就能读到。',
      srcFirst: '第一次整理会先检查能读到哪些来源：已装的插件、本机的命令行工具和应用数据都会试，结果和读不到的原因显示在这里。',
      before: '开始前要知道',
      beforeItems: (d) => [
        'Cindy 会请你确认一次「允许整理任务自动执行」，同意后整理时不再逐步问你。',
        '邮件、飞书等插件第一次被读取时，可能还要各确认一次。',
        `第一次读最近 ${d} 天，大约要几分钟，会用到 AI 额度；整理好一个人，左边就出现一个。`,
      ],
      accessDenied: '你没有允许整理任务自动执行，整理时每一步都会请你确认。想改：在 Cindy 侧边栏「插件」→「通讯录」详情页的「任务设置」里，把动手权限改成「自动审查」。',
      lastOk: (w) => `上次整理（${w}）`, lastFail: '上次整理没有完成', lastIncomplete: '上次整理没有走完：AI 没有记下结果，可以再整理一次。',
      stale: '每天自动整理好像没在跑：已经两天多没有整理了。去自动化页看看「整理通讯录」是不是没保存或被暂停了。', openAutomationShort: '打开自动化页',
      footFail: '上次整理没有完成', footStale: '自动整理好像没在跑',
      runsTitle: '最近几次', runLine: (r) => `${r.scope === 'contact' ? '单人回补' : r.scope === 'backfill' ? '往前补' : '整理'} · 新增 ${r.created} · 更新 ${r.updated}`,
      noSchedule: '当前 Cindy 版本还不支持由插件发起自动化。',
    },
    en: {
      title: 'People', all: 'Everyone', recent: 'Recent', pending: 'To confirm', orgs: 'Companies & teams', groups: 'Groups',
      search: 'Find someone…',
      secNew: 'Since you last looked', secRecent: 'In touch lately', secEarlier: 'Known for a while',
      folded: (n) => `${n} more with contact details only`, expand: 'Show', collapse: 'Hide',
      subNew: (n) => `${n} updated since you last looked`, subCount: (n) => `Cindy has written up ${n} people`,
      today: 'today', yesterday: 'yesterday', days: (n) => `${n}d ago`, weeks: (n) => `${n}w ago`, months: (n) => `${n}mo ago`, years: (n) => `${n}y ago`,
      noMatch: 'No one matches.', emptyScope: 'No one here yet.',
      edit: 'Edit', more: 'More', back: 'Back', save: 'Save', cancel: 'Cancel', create: 'Create',
      newContact: 'New contact', importMac: 'Import from macOS Contacts', findDups: 'Find duplicates', retryLegacy: 'Re-import old contacts', autoSettings: 'Tidy up',
      tabOverview: 'Overview', tabHistory: 'Exchanges', tabInfo: 'Details',
      since: 'Since you last looked', sinceCount: (n) => `${n} ${n === 1 ? 'item' : 'items'}`,
      loops: 'Still open between you', loopsNone: 'Nothing open.', doneTag: 'Done', markDone: 'Mark done', reopen: 'Reopen',
      cv: 'Timeline & people', related: 'Works with', inGroups: 'Groups',
      thin: 'Cindy has not found any exchanges with them yet.', thinAct: 'Look in mail and chats',
      contactLine: (n) => `${n} exchanges`, lastLine: (d) => `last ${d}`,
      filterAll: (n) => `All ${n}`, shownRecent: (n) => `Showing the latest ${n} exchanges.`, ch: { mail: 'Mail', im: 'Chat', calendar: 'Calendar', cindy: 'Cindy', github: 'GitHub', call: 'Call', other: 'Other' },
      open: 'Open', coveredTo: (d) => `Covered back to ${d}`, coveredNone: 'Not backfilled yet', backfillBtn: (m) => `Go back ${m} more months`, backfilling: 'Cindy is going further back…',
      noHistory: 'No exchanges recorded yet.',
      ids: 'Contact details', merges: 'Merged by Cindy', split: 'Split', splitDone: (n) => `Split: “${n}” is a separate entry again`,
      mergeNote: 'Cindy decides on its own which entries are the same person and merges them. If one is wrong, split it, or tell Cindy what is off.',
      copied: (v) => `Copied ${v}`,
      askPh: (n) => (n ? `Ask about ${n}, or have Cindy draft an email` : 'Ask Cindy to tidy up your contacts'),
      thinking: 'Cindy is thinking…', working: (n) => `Cindy is on it; follow along in the sidebar task for ${n}`, failedTask: 'This did not finish; the task in the sidebar shows why.',
      markPending: 'Mark as to confirm', markConfirmed: 'Mark as confirmed', addToGroup: 'Add to group', newGroup: 'New group name, press Enter',
      removeFromGroup: (g) => `Remove from “${g}”`, del: 'Delete…', delAsk: (n) => `Delete “${n}”? Their exchanges and contact details are deleted too. This cannot be undone.`, delYes: 'Delete',
      deleted: (n) => `Deleted ${n}`, savedOk: 'Saved', confirmed: 'Confirmed',
      fName: 'Name', fAliases: 'Other names (comma separated)', fKind: 'Type', person: 'Person', org: 'Organization', fSummary: 'One-line intro', fStory: 'Intro',
      fNote: 'Note for AI (only AI sees this)', fIds: 'Contact details', addId: 'Add', fGroups: 'Groups (comma separated)',
      dupSuspect: 'Someone with a similar name exists: ', createAnyway: 'Create anyway',
      helloTitle: 'Let Cindy get to know your people',
      helloText: (d) => `Cindy reads the last ${d} days of your mail, calendar, Feishu and Cindy chats and writes up the people you deal with: who they are, what is still open, every exchange. It updates daily after that; go further back whenever you like.`,
      helloStart: (d) => `Tidy up the last ${d} days`, helloDaily: 'Tidy up daily', helloOther: 'Or', helloMac: 'import Mac Contacts', helloManual: 'add someone',
      helloRunning: 'Cindy is working. The people you deal with most come first; each appears on the left as soon as it is written.',
      helloNote: 'Tidying uses your installed plugins and the data this Mac can read (encrypted chat stores are never read), and uses AI quota. Follow along in the tidy-up task in the sidebar; the first use of a plugin may ask you to allow it.',
      legacyFailed: (m) => `Old contacts were not imported: ${m}`,
      loading: 'Opening contacts…', importingLegacy: 'Importing your old contacts…', legacyDone: (n) => `Imported ${n} entries from old contacts`,
      legacyAvailable: (n) => `Your old Smart Contacts still has ${n} entries you can import here. People who share an email, phone number or account with an existing entry are merged.`, importLegacy: 'Import old contacts',
      legacyMerged: 'Old contacts imported. People with the same name but no shared contact details may be duplicated; use Find duplicates to merge them.',
      readMac: 'Read Mac Contacts', reading: 'Reading Mac Contacts… macOS asks for permission the first time.',
      importIntro: 'Read-only: your Mac Contacts are not changed. Cards with the same email or phone join existing entries.',
      preview: (r) => `${r.total} cards: ${r.created} new, ${r.updated} existing entries completed, ${r.unchanged} already here.`,
      previewReview: (n) => `${n} share a name with an existing entry.`,
      doImport: 'Import', importing: 'Importing…', imported: (r) => `Imported: ${r.created} new, ${r.updated} completed`,
      noPerm: 'No access to Contacts. Allow Cindy to control Contacts in System Settings › Privacy & Security › Automation, then retry.',
      macOnly: 'Importing from system contacts works only on a Mac.', retry: 'Retry',
      dupsTitle: 'Possible duplicates', dupsNone: 'No duplicates found.', mergeLeft: 'Merge into left', notSame: 'Not the same', merged: 'Merged',
      failed: 'Did not work: ', libError: 'The contacts library cannot be opened right now: ',
      footLast: (w) => `Last tidy ${w}`, footNever: 'Not tidied yet', footRunning: 'Cindy is tidying up…', footSettings: 'Tidy up',
      autoTitle: 'Tidy up',
      settingsWhere: 'Sources, how far the first run reads and the daily tidy-up are set on this plugin’s page under Plugins in the Cindy sidebar; the model and permission for tidy-ups are in its Task settings.',
      autoText: 'Cindy works in time windows: each run reads only what is new since the last one and rewrites the people who changed. The first run reads a short recent window; go further back whenever you like. Each run uses AI quota.',
      firstDays: 'First run reads the last', daysOpt: (d) => `${d} days`,
      sourcesLabel: 'Sources to read', src: { mail: 'Mail', calendar: 'Calendar', im: 'Chats (Feishu, iMessage, etc.)', cindy: 'Cindy chats', github: 'GitHub' },
      srcHint: 'Uses installed plugins, command-line tools and data this Mac can read; sources it cannot read are skipped with the reason shown.',
      backLabel: 'Each backfill goes back', monthsOpt: (m) => `${m} ${m === 1 ? 'month' : 'months'}`,
      tidyNow: 'Tidy up now', backfillAll: (m) => `Go back ${m} months for everyone`, tidySent: 'Sent to Cindy; follow along in the tidy-up task in the sidebar',
      profileLabel: 'Your contacts are mostly', profColleagues: 'Colleagues and friends', profClients: 'Many clients',
      profColleaguesHint: 'Tidy once a day', profClientsHint: 'Tidy every 6 hours, group clients by company, note needs, quotes and follow-ups',
      macSync: 'Reconcile with macOS Contacts daily (no AI)', macSyncHint: 'Starts after your first import; read-only',
      openAutomation: 'Tidy up daily: open Automations', automationOpened: 'Cindy’s Automations page is open: pick a model and save to start daily tidy-ups.',
      automationAgain: 'Open Automations again', stopHint: 'To pause or change it, pause or delete “整理通讯录” on Cindy’s Automations page.',
      srcName: { mail: 'Mail', calendar: 'Calendar', im: 'Chats', cindy: 'Cindy chats', github: 'GitHub' },
      srcState: { ok: 'readable', missing: 'plugin not installed', unauthorized: 'account not connected', unavailable: 'not available here', error: 'error', skipped: 'skipped' },
      srcTitle: 'Sources at the last check',
      covPartial: (n) => `partly read${n ? ` (${n} gaps)` : ''}; next run fills in`, covNone: 'not read; next run continues',
      srcFix: 'For missing or unconnected ones, install and connect them under Plugins in the Cindy sidebar; the next tidy-up will read them.',
      srcFirst: 'The first tidy-up checks which sources can be read — installed plugins, command-line tools and app data on this Mac — and shows the result and any reasons here.',
      before: 'Before you start',
      beforeItems: (d) => [
        'Cindy asks you once to let tidy-up tasks run on their own; after that it stops asking at every step.',
        'Mail and chat plugins may each ask once the first time they are read.',
        `The first run reads the last ${d} days, takes a few minutes and uses AI quota; people appear on the left as they are written up.`,
      ],
      accessDenied: 'You did not let tidy-up tasks run on their own, so every step asks you. To change it, set the permission to Auto-review in Task settings on this plugin’s page under Plugins.',
      lastOk: (w) => `Last tidy-up (${w})`, lastFail: 'The last tidy-up did not finish', lastIncomplete: 'The last tidy-up stopped early without recording a result; run it again.',
      stale: 'The daily tidy-up seems to have stopped: nothing for over two days. Check whether “整理通讯录” was saved or paused on the Automations page.', openAutomationShort: 'Open Automations',
      footFail: 'Last tidy-up did not finish', footStale: 'Daily tidy-up seems stopped',
      runsTitle: 'Recent runs', runLine: (r) => `${r.scope === 'contact' ? 'One person' : r.scope === 'backfill' ? 'Backfill' : 'Tidy'} · ${r.created} new · ${r.updated} updated`,
      noSchedule: 'This Cindy version cannot start automations from plugins yet.',
    },
  };
  let T = STRINGS.en;
  let LOCALE = 'en';

  /* ───────── 小工具 ───────── */
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ICONS = {
    down: '<path d="m6 9 6 6 6-6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 3-3 4-6.5 4.5"/>',
    at: '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    spark: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
  };
  const I = (n, cls) => `<svg class="i${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  const PLATFORM_ICON = { email: 'mail', phone: 'phone', feishu: 'chat', lark: 'chat', slack: 'chat', wechat: 'chat', telegram: 'chat', dingtalk: 'chat', discord: 'chat', github: 'git', gitlab: 'git', x: 'at', twitter: 'at' };
  const PLATFORM_NAME = { email: '邮箱', phone: '电话', feishu: '飞书', lark: 'Lark', slack: 'Slack', wechat: '微信', telegram: 'Telegram', dingtalk: '钉钉', discord: 'Discord', github: 'GitHub', x: 'X' };
  const CHANNEL_ICON = { mail: 'mail', im: 'chat', calendar: 'cal', cindy: 'spark', github: 'git', call: 'phone', other: 'link' };
  /** 飞书 open_id 这类机器 id 不直接给人看，显示平台名，点击仍复制原值。 */
  function identityLabel(i) {
    const opaque = /^[a-z]{2,3}_[0-9a-z]{16,}$/i.test(i.value) || (i.value.length > 28 && !/[\s@.]/.test(i.value));
    if (opaque) return i.label || PLATFORM_NAME[i.platform] || i.platform;
    return i.value;
  }
  /** 反复去掉 <!-- … --> 标记直到不再变化。 */
  function stripMarkers(text) {
    let s = String(text || '');
    for (let prev = ''; prev !== s; ) {
      prev = s;
      s = s.replace(/<!--[\s\S]*?-->/g, '');
    }
    return s;
  }
  /** 旧数据里的说明文字：去掉导入标记注释，**粗体** 渲染成粗体，其余一律转义。 */
  function richText(text) {
    const clean = stripMarkers(text).trim();
    return esc(clean).replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  }
  const paragraphs = (text) =>
    stripMarkers(text).split(/\n{2,}|\r\n\r\n/).map((p) => p.trim()).filter(Boolean);
  const PLATFORMS = ['email', 'phone', 'feishu', 'wechat', 'slack', 'telegram', 'github', 'x', 'other'];

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  /* ───────── 与 main.js 通信 ───────── */
  const channel = new BroadcastChannel('cindy-contacts');
  const pending = new Map();
  let lastWake = 0;
  async function wake() {
    if (Date.now() - lastWake < 20000) return;
    lastWake = Date.now();
    try {
      await fetch('/wake');
    } catch (_) {
      /* 已经在跑时也可能失败，交给重发兜底 */
    }
  }
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = uid();
      const send = () => channel.postMessage({ kind: 'req', id, method, params: params || {} });
      const timer = setInterval(() => {
        wake();
        send();
      }, 800);
      pending.set(id, { resolve, reject, timer });
      wake().then(send);
    });
  }
  channel.onmessage = (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.kind === 'res' && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      clearInterval(p.timer);
      if (m.ok) p.resolve(m.result);
      else p.reject(Object.assign(new Error(m.error?.message || 'failed'), { code: m.error?.code, extra: m.error?.extra }));
    } else if (m.kind === 'event') {
      onEvent(m);
    }
  };

  /* ───────── 状态 ───────── */
  const S = {
    boot: 'loading',
    meta: null,
    view: { prev: '', current: '' },
    contacts: [],
    groups: [],
    scope: 'all',
    query: '',
    showFolded: false,
    selId: null,
    detail: null,
    qa: [],
    asking: false,
    tab: 'overview',
    filter: 'all',
    mode: 'view', // view | edit | new | import | dups | hello | auto
    confirmDelete: false,
    importStep: null,
    importResult: null,
    importError: null,
    dups: null,
    dismissedDups: new Set(),
    formError: null,
    progress: null,
    tasks: new Map(), // key -> 任务状态（来自 main.js 广播）
  };

  /* ───────── 时间 ───────── */
  const collator = new Intl.Collator(['zh-Hans-CN-u-co-pinyin', 'zh-Hans', 'en'], { sensitivity: 'base', numeric: true });
  const pad = (n) => String(n).padStart(2, '0');
  function localDay(v) {
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function daysSince(v) {
    const day = localDay(v);
    if (!day) return Infinity;
    const d = Date.parse(`${day}T00:00:00`);
    const now = new Date();
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.max(0, Math.round((t0 - d) / 86400000));
  }
  function ago(v) {
    const n = daysSince(v);
    if (n === Infinity) return '';
    if (n === 0) return T.today;
    if (n === 1) return T.yesterday;
    if (n < 7) return T.days(n);
    if (n < 30) return T.weeks(Math.floor(n / 7));
    if (n < 365) return T.months(Math.floor(n / 30));
    return T.years(Math.floor(n / 365));
  }
  function fmtDay(v) {
    const day = localDay(v);
    if (!day) return '';
    const d = new Date(`${day}T00:00:00`);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(LOCALE, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function fmtWhen(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const n = daysSince(iso);
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (n === 0) return `${T.today} ${time}`;
    if (n === 1) return `${T.yesterday} ${time}`;
    return `${fmtDay(iso)} ${time}`;
  }
  const isNew = (iso) => !!(S.view.prev && iso && iso > S.view.prev);

  /* ───────── 名单 ───────── */
  function scoped() {
    let rows = S.contacts;
    if (S.scope === 'recent') rows = rows.filter((c) => daysSince(c.last) <= 30);
    else if (S.scope === 'pending') rows = rows.filter((c) => c.status === 'pending');
    else if (S.scope === 'orgs') rows = rows.filter((c) => c.kind === 'org');
    else if (S.scope.startsWith('g:')) rows = rows.filter((c) => c.groups.includes(S.scope.slice(2)));
    const q = S.query.trim().toLowerCase();
    if (q) rows = rows.filter((c) => [c.name, c.summary, c.latest, ...c.aliases, ...c.groups].some((v) => String(v || '').toLowerCase().includes(q)));
    return rows;
  }
  const byLast = (a, b) => String(b.last || '').localeCompare(String(a.last || '')) || collator.compare(a.name, b.name);
  const changedSinceView = (c) => isNew(c.lastIngest) || isNew(c.latestAt);

  /** 有搜索或筛选时平铺；否则分成「上次看过之后 / 最近在来往 / 更早认识的」，只有联系方式的折叠起来。 */
  function sections() {
    const rows = scoped();
    if (S.query.trim() || S.scope !== 'all') return { secs: [{ key: '', items: rows.slice().sort(byLast) }], folded: [] };
    const rich = rows.filter((c) => c.rich);
    const fresh = rich.filter(changedSinceView).sort(byLast);
    const rest = rich.filter((c) => !changedSinceView(c));
    const recent = rest.filter((c) => daysSince(c.last) <= 14).sort(byLast);
    const earlier = rest.filter((c) => daysSince(c.last) > 14).sort(byLast);
    const folded = rows.filter((c) => !c.rich).sort((a, b) => collator.compare(a.name, b.name));
    const secs = [];
    if (fresh.length) secs.push({ key: T.secNew, items: fresh });
    if (recent.length) secs.push({ key: T.secRecent, items: recent });
    if (earlier.length) secs.push({ key: T.secEarlier, items: earlier });
    return { secs, folded };
  }
  const flatVisible = () => {
    const { secs, folded } = sections();
    return [...secs.flatMap((s) => s.items), ...(S.showFolded ? folded : [])];
  };

  function scopeTitle() {
    if (S.scope === 'all') return T.title;
    if (S.scope === 'recent') return T.recent;
    if (S.scope === 'pending') return T.pending;
    if (S.scope === 'orgs') return T.orgs;
    return S.scope.slice(2);
  }

  const listpane = $('#listpane');
  const detailEl = $('#detail');

  function rowHtml(c) {
    const line = c.latest || c.summary || c.groups[0] || '';
    const fresh = changedSinceView(c) && c.latest;
    return `<button class="row" data-id="${esc(c.id)}" aria-selected="${c.id === S.selId}">
      <span class="nm">${esc(c.name)}</span><span class="t">${esc(ago(c.last))}</span>
      <span class="sub${fresh ? ' fresh' : ''}">${esc(line)}</span></button>`;
  }

  function renderList() {
    const { secs, folded } = sections();
    const richCount = S.contacts.filter((c) => c.rich).length;
    const freshCount = S.contacts.filter((c) => c.rich && changedSinceView(c)).length;
    let h = `<div class="lhead">
      <button class="scope" id="scopeBtn" aria-haspopup="menu">${esc(scopeTitle())}${I('down')}</button>
      <div class="lsub">${freshCount ? `<b>${esc(T.subNew(freshCount))}</b>` : esc(T.subCount(richCount))}</div>
      <label class="find">${I('search')}<input id="findInput" type="search" value="${esc(S.query)}" placeholder="${esc(T.search)}" autocomplete="off" spellcheck="false">${S.query ? `<button class="clear" id="clearFind" aria-label="clear">${I('x', 's')}</button>` : ''}</label></div>`;
    h += '<div class="lscroll" id="lscroll">';
    if (!S.query) h += legacyNotice();
    const any = secs.some((s) => s.items.length) || folded.length;
    if (!any) h += `<div class="lempty">${esc(S.query ? T.noMatch : T.emptyScope)}</div>`;
    for (const s of secs) {
      if (!s.items.length) continue;
      if (s.key) h += `<div class="lsec">${esc(s.key)}</div>`;
      h += s.items.map(rowHtml).join('');
    }
    if (folded.length) {
      h += `<button class="fold" data-action="toggleFolded"><span>${esc(T.folded(folded.length))}</span><span>${esc(S.showFolded ? T.collapse : T.expand)} ›</span></button>`;
      if (S.showFolded) h += `<div class="folded">${folded.map(rowHtml).join('')}</div>`;
    }
    h += '</div>' + listFooter();
    const keepScroll = $('#lscroll')?.scrollTop || 0;
    const hadFocus = document.activeElement?.id === 'findInput';
    const caret = hadFocus ? document.activeElement.selectionStart : null;
    listpane.innerHTML = h;
    $('#lscroll').scrollTop = keepScroll;
    if (hadFocus) {
      const inp = $('#findInput');
      inp.focus();
      if (caret !== null) inp.setSelectionRange(caret, caret);
    }
  }

  const tidyRunning = () => [...S.tasks.values()].some((t) => t.key === 'maintain' && t.status === 'running');

  /** 每天自动整理请求过、但两天多没有任何整理：多半没保存或被暂停了。 */
  function tidyStale() {
    const req = S.meta?.automationRequested;
    if (!req || !req.at) return false;
    const last = S.meta?.maintenance?.lastRunAt || '';
    const ref = last && last > req.at ? last : req.at;
    return Date.now() - Date.parse(ref) > 50 * 3600 * 1000;
  }

  /** 资料库已有档案、旧版智能通讯录还没导入时，提示并给出导入入口（不自动合并）。 */
  function legacyNotice() {
    const legacy = S.meta?.legacy;
    if (!legacy || legacy.status !== 'available') return '';
    const n = legacy.counts?.contacts || 0;
    return `<div class="notice"><p>${esc(T.legacyAvailable(n))}</p><button class="pill" data-action="retryLegacy">${esc(T.importLegacy)}</button></div>`;
  }

  function statusBlock() {
    const m = S.meta || {};
    let h = '';
    const lt = m.lastTidy;
    if (lt && !tidyRunning()) {
      if (lt.status === 'failed') h += `<div class="notice warn"><b>${esc(T.lastFail)}</b>${lt.reply ? `<p>${esc(lt.reply)}</p>` : ''}</div>`;
      else if (lt.status === 'incomplete') h += `<div class="notice warn"><p>${esc(T.lastIncomplete)}</p>${lt.reply ? `<p class="muted">${esc(lt.reply)}</p>` : ''}</div>`;
      else if (lt.reply) h += `<div class="notice"><b>${esc(T.lastOk(fmtWhen(lt.at)))}</b><p>${esc(lt.reply)}</p></div>`;
    }
    if (m.autoAccess && m.autoAccess.granted === false) h += `<div class="notice warn"><p>${esc(T.accessDenied)}</p></div>`;
    if (tidyStale()) h += `<div class="notice warn"><p>${esc(T.stale)}</p><button class="pill" data-action="requestAutomation">${esc(T.openAutomationShort)}</button></div>`;
    const ss = m.sourcesStatus;
    if (ss && ss.items && ss.items.length) {
      const enabled = m.settings?.sources || {};
      const items = ss.items.filter((i) => enabled[i.source] !== false);
      h += `<div class="srcs-status"><div class="sech">${esc(T.srcTitle)} · ${esc(fmtWhen(ss.at))}</div>`;
      for (const i of items) {
        const cov = i.coverage && i.status === 'ok' ? i.coverage : '';
        const good = (i.status === 'ok' && cov !== 'partial' && cov !== 'none') || i.status === 'unavailable' || i.status === 'skipped';
        const label = cov === 'partial' ? T.covPartial(i.gaps || 0) : cov === 'none' ? T.covNone : T.srcState[i.status] || i.status;
        const note = cov && cov !== 'complete' ? i.coverageNote : i.status !== 'ok' ? i.note : '';
        h += `<div class="srow${good ? ' ok' : ''}"><span>${esc(T.srcName[i.source] || i.source)}</span><span class="st">${esc(label)}${note ? ` · ${esc(note)}` : ''}</span></div>`;
      }
      if (items.some((i) => i.status === 'missing' || i.status === 'unauthorized')) h += `<p class="small muted">${esc(T.srcFix)}</p>`;
      h += '</div>';
    } else {
      h += `<p class="small muted">${esc(T.srcFirst)}</p>`;
    }
    return h;
  }

  function listFooter() {
    if (S.boot !== 'ready' || !S.meta) return '';
    const m = S.meta.maintenance;
    let text;
    const lt = S.meta.lastTidy;
    if (tidyRunning()) text = `<span class="spin s"></span><span>${esc(T.footRunning)}</span>`;
    else if (lt && (lt.status === 'failed' || lt.status === 'incomplete') && (!m || !m.lastRunAt || m.lastRunAt < lt.at)) text = `<span class="warnline">${esc(T.footFail)}</span>`;
    else if (tidyStale()) text = `<span class="warnline">${esc(T.footStale)}</span>`;
    else if (m && m.lastRunAt) text = `<span>${esc(T.footLast(fmtWhen(m.lastRunAt)))}</span>`;
    else text = `<span>${esc(T.footNever)}</span>`;
    return `<button class="lfoot" data-action="auto">${I('spark', 's')}${text}<b>${esc(T.footSettings)}</b></button>`;
  }

  /* ───────── 详情：概览 / 往来 / 资料 ───────── */
  function sinceBlock(d) {
    const fresh = d.interactions.filter((i) => isNew(i.addedAt)).slice(0, 6);
    if (!fresh.length) return '';
    let h = `<section class="since"><div class="sh"><b>${esc(T.since)}</b><span>${esc(T.sinceCount(fresh.length))}</span></div>`;
    for (const i of fresh) {
      h += `<div class="si"><span class="t">${esc(fmtWhen(i.at))}</span><div>${esc(i.summary || i.title)}${i.quote ? `<q>${esc(i.quote)}</q>` : ''}</div></div>`;
    }
    return h + '</section>';
  }

  function overviewTab(d) {
    let h = '';
    const paras = paragraphs(d.narrative);
    if (paras.length) h += `<div class="portrait">${paras.map((p) => `<p>${richText(p)}</p>`).join('')}</div>`;
    if (!d.interactions.length && !paras.length) {
      h += `<div class="thin"><p>${esc(T.thin)}</p>${S.meta?.tasks ? `<button class="pill" data-action="backfill">${I('search', 's')}${esc(T.thinAct)}</button>` : ''}</div>`;
    }
    if (String(d.agentNotes || '').trim()) h += `<p class="note">${richText(d.agentNotes)}</p>`;
    const open = d.loops.filter((l) => l.status === 'open');
    const done = d.loops.filter((l) => l.status === 'done').slice(0, 3);
    if (open.length || done.length) {
      h += `<h3>${esc(T.loops)}</h3><div class="loops">`;
      for (const l of [...open, ...done]) {
        const fresh = l.status === 'open' && isNew(l.updatedAt);
        h += `<div class="loop${l.status === 'done' ? ' done' : ''}">
          <button class="dot" data-loop="${esc(l.id)}" data-status="${l.status === 'done' ? 'open' : 'done'}" title="${esc(l.status === 'done' ? T.reopen : T.markDone)}" aria-label="${esc(l.status === 'done' ? T.reopen : T.markDone)}">${l.status === 'done' ? I('check', 's') : ''}</button>
          <div class="tx">${esc(l.text)}${fresh ? '<span class="tag">新</span>' : ''}${l.detail ? `<div>${esc(l.detail)}</div>` : ''}</div>
          <span class="when">${esc(l.status === 'done' ? T.doneTag : fmtDay(l.since || l.updatedAt))}</span></div>`;
      }
      h += '</div>';
    }
    const kv = [...d.facts.map((f) => [f.label, esc(f.value)])];
    if (d.relations.length) {
      kv.push([T.related, d.relations.map((r) => `<span class="link" data-goto="${esc(r.otherId)}">${esc(r.otherName)}</span>${r.relation ? `<small>${esc(r.relation)}</small>` : ''}`).join('　')]);
    }
    if (d.groups.length) kv.push([T.inGroups, d.groups.map((g) => `<span class="link" data-scope="g:${esc(g.name)}">${esc(g.name)}</span>`).join('　')]);
    if (d.events.length || kv.length) {
      h += `<h3>${esc(T.cv)}</h3><div class="cv">`;
      h += `<div class="tl">${d.events.slice(0, 8).map((e) => `<div class="ti"><div class="y">${esc(fmtDay(e.date))}</div><div class="e">${esc(e.text)}</div></div>`).join('')}</div>`;
      h += `<dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
    }
    return h;
  }

  function historyTab(d) {
    const all = d.interactions;
    const kinds = [...new Set(all.map((i) => i.channel))];
    let h = '';
    if (all.length) {
      h += `<div class="filt"><button data-filter="all" aria-pressed="${S.filter === 'all'}">${esc(T.filterAll(d.interactionTotal))}</button>`;
      for (const k of kinds) h += `<button data-filter="${esc(k)}" aria-pressed="${S.filter === k}">${esc(T.ch[k] || k)} ${all.filter((i) => i.channel === k).length}</button>`;
      h += '</div>';
      if (d.interactionTotal > all.length) h += `<p class="muted small">${esc(T.shownRecent(all.length))}</p>`;
    } else {
      h += `<p class="muted">${esc(T.noHistory)}</p>`;
    }
    let lastMonth = '';
    for (const i of all.filter((x) => S.filter === 'all' || x.channel === S.filter)) {
      const dt = new Date(i.at);
      const month = dt.toLocaleDateString(LOCALE, { year: dt.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', month: 'long' });
      if (month !== lastMonth) {
        h += `<div class="month">${esc(month)}</div>`;
        lastMonth = month;
      }
      h += `<div class="evx${isNew(i.addedAt) ? ' fresh' : ''}"><div class="dt">${esc(fmtWhen(i.at))}</div><div class="ch">${I(CHANNEL_ICON[i.channel] || 'link')}</div>
        <div><div class="tt">${esc(i.title || T.ch[i.channel] || '')}<span>${esc(T.ch[i.channel] || i.channel)}</span></div>
        ${i.summary ? `<div class="sm">${esc(i.summary)}</div>` : ''}${i.quote ? `<q>${esc(i.quote)}</q>` : ''}
        ${i.link ? `<a class="go" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer">${esc(T.open)} ›</a>` : ''}</div></div>`;
    }
    const covered = d.coveredFrom || S.meta?.coverage?.from || '';
    const months = S.meta?.settings?.backfillMonths || 3;
    const busy = S.tasks.get(`c:${d.id}`)?.status === 'running';
    h += `<div class="cover"><span>${esc(covered ? T.coveredTo(fmtDay(covered)) : T.coveredNone)}</span>`;
    if (S.meta?.tasks) h += busy ? `<span class="muted"><span class="spin s"></span>${esc(T.backfilling)}</span>` : `<button class="pill" data-action="backfill">${esc(T.backfillBtn(months))}</button>`;
    return h + '</div>';
  }

  function infoTab(d) {
    const ids = d.identities.filter((i) => i.platform !== 'apple-contacts');
    let h = `<h3>${esc(T.ids)}</h3>`;
    for (const i of ids) {
      h += `<button class="idr" data-copy="${esc(i.value)}">${I(PLATFORM_ICON[i.platform] || 'link')}<span class="k">${esc(i.label || PLATFORM_NAME[i.platform] || i.platform)}</span><span class="v">${esc(identityLabel(i))}</span></button>`;
    }
    if (d.merges.length) {
      h += `<h3>${esc(T.merges)}</h3>`;
      for (const m of d.merges) {
        h += `<div class="mg"><div>${esc(m.sourceName)}<span>${esc([m.reason, fmtDay(m.at)].filter(Boolean).join(' · '))}</span></div><button class="link" data-unmerge="${esc(m.id)}">${esc(T.split)}</button></div>`;
      }
    }
    h += `<p class="note small">${esc(T.mergeNote)}</p>`;
    return h;
  }

  function qaBlock(d) {
    const list = S.qa.slice(-3);
    const running = S.tasks.get(`c:${d.id}`);
    if (!list.length && !S.asking) return '';
    let h = '<section class="qa">';
    for (const x of list) {
      h += `<div class="qq">${esc(x.q)}</div>`;
      if (x.status === 'running' || (running && running.status === 'running' && x === list[list.length - 1] && !x.a)) h += `<div class="qa-a muted"><span class="spin s"></span>${esc(T.working(d.name))}</div>`;
      else if (x.status === 'failed' && !x.a) h += `<div class="qa-a muted">${esc(T.failedTask)}</div>`;
      else h += `<div class="qa-a">${paragraphs(x.a).map((p) => `<p>${richText(p)}</p>`).join('')}</div>`;
    }
    if (S.asking) h += `<div class="qa-a muted"><span class="spin s"></span>${esc(T.thinking)}</div>`;
    return h + '</section>';
  }

  function askBar(d) {
    if (!S.meta?.tasks && !d) return '';
    return `<div class="askwrap"><form class="askbar" id="askForm">${I('spark')}<input id="askInput" placeholder="${esc(T.askPh(d ? d.name : ''))}" autocomplete="off"><button class="askgo" type="submit" aria-label="send">${I('arrow', 's')}</button></form></div>`;
  }

  function renderView() {
    const d = S.detail;
    if (!d) {
      detailEl.innerHTML = '';
      return;
    }
    const latin = d.aliases.find((a) => /^[A-Za-z][A-Za-z .'-]*$/.test(a));
    let h = `<div class="tools"><button class="tbtn back" data-action="back">${I('back', 's')}${esc(T.back)}</button>`;
    if (!S.confirmDelete) h += `<button class="tbtn" data-action="edit">${esc(T.edit)}</button><button class="tbtn" id="moreBtn" aria-label="${esc(T.more)}">${I('more')}</button>`;
    h += '</div>';
    h += `<article class="page"><h1 class="name">${esc(d.name)}${latin ? `<small>${esc(latin)}</small>` : ''}</h1>`;
    const who = [d.summary, d.interactionTotal ? T.contactLine(d.interactionTotal) : '', d.interactions[0] ? T.lastLine(fmtDay(d.interactions[0].at)) : ''].filter(Boolean);
    h += `<div class="who">${who.map((w) => `<span>${esc(w)}</span>`).join('')}</div>`;
    if (S.confirmDelete) {
      h += `<div class="confirmrow"><span>${esc(T.delAsk(d.name))}</span><span class="sp"></span><button class="pill" data-action="cancelDelete">${esc(T.cancel)}</button><button class="pill pri" data-action="doDelete">${esc(T.delYes)}</button></div>`;
    }
    h += sinceBlock(d);
    const tab = (key, label, n) => `<button role="tab" data-tab="${key}" aria-selected="${S.tab === key}">${esc(label)}${n ? `<em>${n}</em>` : ''}</button>`;
    h += `<nav class="tabs" role="tablist">${tab('overview', T.tabOverview)}${tab('history', T.tabHistory, d.interactionTotal)}${tab('info', T.tabInfo)}</nav>`;
    h += `<div class="tabbody">${S.tab === 'history' ? historyTab(d) : S.tab === 'info' ? infoTab(d) : overviewTab(d)}</div>`;
    h += qaBlock(d);
    h += '</article>';
    h += askBar(d);
    detailEl.innerHTML = h;
  }

  function idRow(i, n) {
    return `<div class="idrow" data-row="${n}"${i.id ? ` data-idid="${esc(i.id)}"` : ''}>
      <select aria-label="platform">${[...new Set([i.platform || 'email', ...PLATFORMS])].map((p) => `<option value="${esc(p)}"${p === (i.platform || 'email') ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <input value="${esc(i.value || '')}" autocomplete="off" spellcheck="false">
      <button type="button" class="rm" data-rm-row="${n}" aria-label="remove">${I('x', 's')}</button></div>`;
  }

  function renderForm(isNewForm) {
    const d = isNewForm ? { name: '', kind: 'person', aliases: [], summary: '', narrative: '', agentNotes: '', identities: [], groups: [] } : S.detail;
    const ids = d.identities.filter((i) => i.platform !== 'apple-contacts');
    let h = `<div class="tools"><button class="tbtn" data-action="cancelEdit">${esc(T.cancel)}</button></div><article class="page"><form class="form" id="editForm">`;
    h += `<label class="field"><span>${esc(T.fName)}</span><input class="big" name="name" value="${esc(d.name)}" required autocomplete="off"></label>`;
    h += `<div class="field"><span>${esc(T.fKind)}</span><div class="seg" id="kindSeg"><button type="button" data-kind="person" aria-pressed="${d.kind !== 'org'}">${esc(T.person)}</button><button type="button" data-kind="org" aria-pressed="${d.kind === 'org'}">${esc(T.org)}</button></div></div>`;
    h += `<label class="field"><span>${esc(T.fSummary)}</span><input name="summary" value="${esc(d.summary)}" autocomplete="off"></label>`;
    h += `<label class="field"><span>${esc(T.fStory)}</span><textarea name="narrative">${esc(d.narrative)}</textarea></label>`;
    h += `<div class="field"><span>${esc(T.fIds)}</span><div id="idRows" style="display:grid;gap:8px">${ids.map((i, n) => idRow(i, n)).join('')}</div><div><button type="button" class="pill" data-action="addId">${esc(T.addId)}</button></div></div>`;
    h += `<label class="field"><span>${esc(T.fAliases)}</span><input name="aliases" value="${esc(d.aliases.join(', '))}" autocomplete="off"></label>`;
    h += `<label class="field"><span>${esc(T.fGroups)}</span><input name="groups" value="${esc((d.groups || []).map((g) => g.name || g).join(', '))}" autocomplete="off"></label>`;
    h += `<label class="field"><span>${esc(T.fNote)}</span><textarea name="agentNotes" style="min-height:80px">${esc(d.agentNotes)}</textarea></label>`;
    if (S.formError) h += `<div class="err" id="formErr">${S.formError}</div>`;
    h += `<div class="formacts"><span class="sp"></span><button type="button" class="pill" data-action="cancelEdit">${esc(T.cancel)}</button><button type="submit" class="pill pri">${esc(isNewForm ? T.create : T.save)}</button></div>`;
    h += '</form></article>';
    detailEl.innerHTML = h;
    $('#editForm [name=name]').focus();
  }

  function renderHello() {
    const legacy = S.meta?.legacy;
    const mac = S.meta?.platform === 'darwin';
    const days = S.meta?.settings?.initialDays || 14;
    let h = '<div class="center"><div class="hello">';
    h += `<h1>${esc(T.helloTitle)}</h1>`;
    if (tidyRunning()) {
      h += `<p><span class="spin"></span>${esc(T.helloRunning)}</p>`;
    } else {
      h += `<p>${esc(T.helloText(days))}</p>`;
      h += `<div class="before"><div class="sech">${esc(T.before)}</div><ul>${T.beforeItems(days).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
      h += statusBlock();
      h += '<div class="acts">';
      if (S.meta?.tasks) h += `<button class="pill pri" data-action="tidyRecent">${esc(T.helloStart(days))}</button>`;
      if (S.meta?.schedule) h += `<button class="pill" data-action="requestAutomation">${esc(T.helloDaily)}</button>`;
      h += '</div>';
      h += `<p class="small">${esc(T.helloOther)} ${mac ? `<button class="link" data-action="import">${esc(T.helloMac)}</button> · ` : ''}<button class="link" data-action="new">${esc(T.helloManual)}</button></p>`;
    }
    if (tidyRunning()) h += statusBlock();
    if (S.autoOpened) h += `<p class="small">${esc(T.automationOpened)}</p>`;
    if (legacy && (legacy.status === 'error' || legacy.status === 'partial')) {
      h += `<p class="small">${esc(T.legacyFailed(legacy.message || legacy.status))} <button class="link" data-action="retryLegacy">${esc(T.retry)}</button></p>`;
    }
    h += '</div></div>';
    detailEl.innerHTML = h;
  }

  function renderImport() {
    let h = `<div class="tools"><button class="tbtn" data-action="closePanel">${esc(T.cancel)}</button></div><div class="center"><div class="hello"><h1>${esc(T.importMac)}</h1>`;
    if (S.importError) {
      const msg = S.importError.code === 'PERMISSION_DENIED' ? T.noPerm : S.importError.code === 'UNSUPPORTED' ? T.macOnly : T.failed + S.importError.message;
      h += `<p>${esc(msg)}</p><div class="acts"><button class="pill pri" data-action="readMac">${esc(T.retry)}</button></div>`;
    } else if (S.importStep === 'reading' || S.importStep === 'importing') {
      h += `<p><span class="spin"></span>${esc(S.importStep === 'reading' ? T.reading : T.importing)}</p>`;
    } else if (S.importStep === 'preview' && S.importResult) {
      const r = S.importResult;
      h += `<p>${esc(T.preview(r))}${r.needsReview.length ? `<br>${esc(T.previewReview(r.needsReview.length))}` : ''}</p>`;
      h += `<div class="acts"><button class="pill pri" data-action="doImport"${r.created + r.updated === 0 ? ' disabled' : ''}>${esc(T.doImport)}</button><button class="pill" data-action="closePanel">${esc(T.cancel)}</button></div>`;
    } else {
      h += `<p>${esc(T.importIntro)}</p><div class="acts"><button class="pill pri" data-action="readMac">${esc(T.readMac)}</button></div>`;
    }
    h += '</div></div>';
    detailEl.innerHTML = h;
  }

  function renderDups() {
    const pairs = (S.dups || []).filter((p) => !S.dismissedDups.has(`${p.a.id}|${p.b.id}`));
    let h = `<div class="tools"><button class="tbtn" data-action="closePanel">${esc(T.cancel)}</button></div><article class="page"><h1 class="name" style="font-size:34px">${esc(T.dupsTitle)}</h1><div class="who"></div>`;
    if (S.dups === null) h += '<p><span class="spin"></span></p>';
    else if (!pairs.length) h += `<p class="muted">${esc(T.dupsNone)}</p>`;
    for (const p of pairs) {
      h += `<div class="dup"><div class="who2"><b>${esc(p.a.name)}</b><small>${esc(p.a.summary)}</small></div><span class="arrow">${I('back', 's')}</span>
        <div class="who2"><b>${esc(p.b.name)}</b><small>${esc(p.b.summary)}</small></div>
        <div style="display:flex;gap:6px"><button class="pill" data-not-same="${esc(p.a.id)}|${esc(p.b.id)}">${esc(T.notSame)}</button><button class="pill pri" data-merge="${esc(p.b.id)}|${esc(p.a.id)}">${esc(T.mergeLeft)}</button></div></div>`;
    }
    h += '</article>';
    detailEl.innerHTML = h;
  }

  /** 「整理」：只放马上要做的动作和最近几次的记录；来源、天数、每天自动整理在插件详情页的设置里。 */
  function renderAuto() {
    const m = S.meta?.maintenance;
    const months = S.meta?.settings?.backfillMonths || 3;
    let h = `<div class="tools"><button class="tbtn" data-action="closePanel">${esc(T.cancel)}</button></div><article class="page">`;
    h += `<h1 class="name" style="font-size:36px">${esc(T.autoTitle)}</h1><p class="who" style="margin-bottom:26px">${esc(T.autoText)}</p>`;
    if (S.meta?.tasks) {
      h += `<div class="acts row-acts"><button class="pill pri" data-action="tidyRecent"${tidyRunning() ? ' disabled' : ''}>${esc(tidyRunning() ? T.footRunning : T.tidyNow)}</button><button class="pill" data-action="backfillAll"${tidyRunning() ? ' disabled' : ''}>${esc(T.backfillAll(months))}</button></div>`;
    }
    h += statusBlock();
    if (!S.meta?.maintenance?.lastRunAt) h += `<div class="before"><div class="sech">${esc(T.before)}</div><ul>${T.beforeItems(S.meta?.settings?.initialDays || 14).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    h += `<p class="small muted">${esc(T.settingsWhere)}</p>`;
    if (m && m.runs && m.runs.length) {
      h += `<div class="sec"><div class="sech">${esc(T.runsTitle)}</div>`;
      for (const r of m.runs.slice(0, 6)) h += `<div class="runrow"><span class="d">${esc(fmtWhen(r.at))}</span><span>${esc(T.runLine(r))}${r.note ? `<br><span class="muted">${esc(r.note)}</span>` : ''}</span></div>`;
      h += '</div>';
    }
    h += '</article>';
    detailEl.innerHTML = h;
  }

  function renderStatus() {
    if (S.boot === 'error') {
      detailEl.innerHTML = `<div class="center"><div class="hello"><p>${esc(T.libError)}${esc(S.meta?.error?.message || '')}</p><div class="acts"><button class="pill pri" data-action="reload">${esc(T.retry)}</button></div></div></div>`;
      return;
    }
    const p = S.progress;
    const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
    const msg = S.meta?.importing === 'legacy' ? T.importingLegacy : T.loading;
    detailEl.innerHTML = `<div class="center"><div class="hello"><p><span class="spin"></span>${esc(msg)}</p>${p && p.total ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div></div>`;
  }

  function renderDetail() {
    $('#app').classList.toggle('showing', !!S.selId || S.mode !== 'view');
    if (S.boot !== 'ready') return renderStatus();
    if (S.mode === 'hello') return renderHello();
    if (S.mode === 'import') return renderImport();
    if (S.mode === 'dups') return renderDups();
    if (S.mode === 'auto') return renderAuto();
    if (S.mode === 'new') return renderForm(true);
    if (S.mode === 'edit' && S.detail) return renderForm(false);
    return renderView();
  }

  function render() {
    renderList();
    renderDetail();
  }

  /* ───────── 数据加载 ───────── */
  async function loadList() {
    const r = await rpc('list');
    S.contacts = r.contacts;
    S.groups = r.groups;
  }
  async function loadDetail(id) {
    if (!id) {
      S.detail = null;
      S.qa = [];
      return;
    }
    try {
      const [d, qa] = await Promise.all([rpc('get', { id }), rpc('qa', { contactId: id }).catch(() => [])]);
      // 读的时候用户已经切到别人：丢掉这份，免得旧详情盖住新选择
      if (S.selId !== id) return;
      S.detail = d;
      S.qa = qa || [];
    } catch (e) {
      if (e.code === 'NOT_FOUND') {
        S.detail = null;
        S.selId = null;
      } else throw e;
    }
  }

  async function select(id) {
    S.selId = id;
    S.mode = 'view';
    S.tab = 'overview';
    S.filter = 'all';
    S.confirmDelete = false;
    S.asking = false;
    renderList();
    await loadDetail(id);
    renderDetail();
    detailEl.scrollTop = 0;
  }

  function pickDefault() {
    const rich = S.contacts.some((c) => c.rich);
    if (!rich && !['import', 'new', 'auto', 'edit'].includes(S.mode)) {
      S.mode = 'hello';
      S.selId = null;
      return;
    }
    if (S.mode === 'hello') S.mode = 'view';
    if (!S.selId || !S.contacts.some((c) => c.id === S.selId)) {
      const first = flatVisible()[0];
      S.selId = first ? first.id : null;
    }
  }

  async function refreshAll() {
    await loadList();
    pickDefault();
    if (S.mode === 'view' || S.mode === 'edit') await loadDetail(S.selId);
    render();
  }

  let changeTimer = null;
  function onEvent(m) {
    if (m.name === 'progress') {
      S.progress = m.data && m.data.total ? m.data : null;
      if (S.boot !== 'ready') renderStatus();
      return;
    }
    if (m.name === 'legacy') {
      boot();
      return;
    }
    if (m.name === 'task' && m.data) {
      S.tasks.set(m.data.key, m.data);
      if (S.boot !== 'ready') return;
      if (m.data.contactId && m.data.contactId === S.selId && S.mode === 'view') {
        rpc('qa', { contactId: S.selId })
          .then((qa) => {
            S.qa = qa || [];
            renderView();
          })
          .catch(() => {});
      }
      renderList();
      if (S.mode === 'hello' || S.mode === 'auto') renderDetail();
      return;
    }
    if (m.name === 'changed' && S.boot === 'ready') {
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => {
        if (S.mode === 'edit' || S.mode === 'new') {
          loadList().then(renderList).catch(() => {});
          return;
        }
        rpc('state')
          .then((meta) => {
            S.meta = meta;
          })
          .catch(() => {})
          .finally(() => refreshAll().catch(() => {}));
      }, 250);
    }
  }

  /* ───────── 提示 ───────── */
  function toast(msg, undo) {
    const el = document.createElement('div');
    el.className = `toast${undo ? '' : ' plain'}`;
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button>${esc(LOCALE === 'zh-CN' ? '撤销' : 'Undo')}</button>` : ''}`;
    if (undo) el.querySelector('button').onclick = () => {
      el.remove();
      undo();
    };
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 3800);
  }
  const failToast = (e) => toast(T.failed + (e && e.message ? e.message : e));

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(T.copied(text));
  }

  /* ───────── 菜单 ───────── */
  const menu = $('#menu');
  function openMenu(anchor, html) {
    menu.innerHTML = html;
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left));
    menu.style.left = `${anchor.id === 'moreBtn' ? Math.max(8, r.right - w) : left}px`;
    menu.style.top = `${Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8)}px`;
  }
  function closeMenu() {
    menu.hidden = true;
    menu.innerHTML = '';
  }
  function scopeMenu(anchor) {
    const count = (fn) => S.contacts.filter(fn).length;
    const item = (key, label, n) => `<button class="mi" data-scope="${esc(key)}"><span>${esc(label)}</span><span class="r">${n}</span></button>`;
    let h = item('all', T.all, S.contacts.length) + item('recent', T.recent, count((c) => daysSince(c.last) <= 30));
    const pendingN = count((c) => c.status === 'pending');
    if (pendingN) h += item('pending', T.pending, pendingN);
    h += item('orgs', T.orgs, count((c) => c.kind === 'org'));
    if (S.groups.length) {
      h += `<div class="msep"></div><div class="mhead">${esc(T.groups)}</div>`;
      for (const g of S.groups) h += item(`g:${g.name}`, g.name, g.members);
    }
    h += `<div class="msep"></div><button class="mi" data-action="auto">${esc(T.autoSettings)}</button><button class="mi" data-action="new">${esc(T.newContact)}</button>`;
    if (S.meta?.platform === 'darwin') h += `<button class="mi" data-action="import">${esc(T.importMac)}</button>`;
    h += `<button class="mi" data-action="dups">${esc(T.findDups)}</button>`;
    if (S.meta?.legacy?.status === 'partial' || S.meta?.legacy?.status === 'error') h += `<button class="mi" data-action="retryLegacy">${esc(T.retryLegacy)}</button>`;
    else if (S.meta?.legacy?.status === 'available') h += `<button class="mi" data-action="retryLegacy">${esc(T.importLegacy)}</button>`;
    openMenu(anchor, h);
  }
  function moreMenu(anchor) {
    const d = S.detail;
    if (!d) return;
    const inGroups = new Set(d.groups.map((g) => g.name));
    let h = '';
    if (d.status === 'pending') h += `<button class="mi" data-action="confirm">${esc(T.markConfirmed)}</button><div class="msep"></div>`;
    h += `<div class="mhead">${esc(T.addToGroup)}</div>`;
    for (const g of S.groups) {
      if (!inGroups.has(g.name)) h += `<button class="mi" data-add-group="${esc(g.name)}">${esc(g.name)}</button>`;
    }
    h += `<div style="padding:4px 6px"><input id="newGroupInput" placeholder="${esc(T.newGroup)}" style="width:100%;height:30px;border:1px solid var(--c-line);border-radius:8px;background:var(--c-bg);padding:0 10px;outline:none"></div>`;
    for (const g of inGroups) h += `<button class="mi" data-remove-group="${esc(g)}">${esc(T.removeFromGroup(g))}</button>`;
    h += `<div class="msep"></div><button class="mi danger" data-action="askDelete">${esc(T.del)}</button>`;
    openMenu(anchor, h);
  }

  /* ───────── 操作 ───────── */
  async function mutate(fn, okMsg) {
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      await refreshAll();
      return r;
    } catch (e) {
      failToast(e);
      return null;
    }
  }

  function readForm() {
    const f = $('#editForm');
    const val = (n) => f.querySelector(`[name=${n}]`).value.trim();
    const list = (n) => val(n).split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    const kind = f.querySelector('#kindSeg [aria-pressed="true"]')?.dataset.kind || 'person';
    const rows = [...f.querySelectorAll('.idrow')].map((r) => ({
      id: r.dataset.idid || null,
      platform: r.querySelector('select').value,
      value: r.querySelector('input').value.trim(),
    }));
    return { name: val('name'), kind, summary: val('summary'), narrative: val('narrative'), agentNotes: val('agentNotes'), aliases: list('aliases'), groups: list('groups'), rows };
  }

  async function submitForm(allowDuplicate) {
    const isNewForm = S.mode === 'new';
    const v = readForm();
    if (!v.name) return;
    try {
      if (isNewForm) {
        const r = await rpc('save', {
          name: v.name, kind: v.kind, summary: v.summary, narrative: v.narrative, agentNotes: v.agentNotes, aliases: v.aliases, groups: v.groups,
          identities: v.rows.filter((x) => x.value).map((x) => ({ platform: x.platform, value: x.value })), allowDuplicate: !!allowDuplicate,
        });
        S.formError = null;
        S.mode = 'view';
        S.selId = r.id;
        toast(T.savedOk);
        await refreshAll();
        return;
      }
      const d = S.detail;
      const keptIds = new Set(v.rows.filter((x) => x.id).map((x) => x.id));
      const changedIds = v.rows.filter((x) => x.id && d.identities.some((i) => i.id === x.id && (i.value !== x.value || i.platform !== x.platform)));
      const removeIdentityIds = d.identities.filter((i) => i.platform !== 'apple-contacts' && (!keptIds.has(i.id) || changedIds.some((c) => c.id === i.id))).map((i) => i.id);
      const identities = v.rows
        .filter((x) => x.value && (!x.id || changedIds.some((c) => c.id === x.id)))
        .map((x) => ({ platform: x.platform, value: x.value, label: (x.id && d.identities.find((i) => i.id === x.id)?.label) || '' }));
      const oldGroups = d.groups.map((g) => g.name);
      await rpc('save', {
        id: d.id, name: v.name, kind: v.kind, summary: v.summary, narrative: v.narrative, agentNotes: v.agentNotes,
        aliases: v.aliases, removeAliases: d.aliases.filter((a) => !v.aliases.includes(a)), identities, removeIdentityIds,
        groups: v.groups.filter((g) => !oldGroups.includes(g)),
      });
      for (const g of oldGroups.filter((g) => !v.groups.includes(g))) {
        await rpc('organize', { action: 'remove_from_group', contactIds: [d.id], group: g });
      }
      S.formError = null;
      S.mode = 'view';
      toast(T.savedOk);
      await refreshAll();
    } catch (e) {
      if (e.code === 'DUPLICATE_SUSPECT') {
        const c = e.extra?.candidates || [];
        S.formError = `${esc(T.dupSuspect)}${c.map((x) => `<span class="link" data-goto="${esc(x.id)}">${esc(x.name)}</span>`).join('、')} · <button type="button" class="link" data-action="createAnyway">${esc(T.createAnyway)}</button>`;
      } else if (e.code === 'IDENTITY_CONFLICT') {
        S.formError = `${esc(e.message)} <span class="link" data-goto="${esc(e.extra?.conflictContactId || '')}">→</span>`;
      } else {
        S.formError = esc(T.failed + e.message);
      }
      const keep = readForm();
      renderForm(isNewForm);
      const f = $('#editForm');
      f.querySelector('[name=name]').value = keep.name;
      f.querySelector('[name=summary]').value = keep.summary;
      f.querySelector('[name=narrative]').value = keep.narrative;
      f.querySelector('[name=agentNotes]').value = keep.agentNotes;
      f.querySelector('[name=aliases]').value = keep.aliases.join(', ');
      f.querySelector('[name=groups]').value = keep.groups.join(', ');
      $('#idRows').innerHTML = keep.rows.map((x, n) => idRow(x, n)).join('');
    }
  }

  async function readMac() {
    S.importError = null;
    S.importStep = 'reading';
    renderImport();
    try {
      S.importResult = await rpc('importSystem', { dryRun: true });
      S.importStep = 'preview';
    } catch (e) {
      S.importError = { code: e.code, message: e.message };
    }
    if (S.mode === 'import') renderImport();
  }

  async function doImport() {
    S.importStep = 'importing';
    renderImport();
    try {
      const r = await rpc('importSystem', { dryRun: false });
      toast(T.imported(r));
      S.mode = 'view';
      S.importStep = null;
      S.selId = null;
      await refreshAll();
    } catch (e) {
      S.importError = { code: e.code, message: e.message };
      renderImport();
    }
  }

  async function openDups() {
    S.mode = 'dups';
    S.dups = null;
    renderDetail();
    try {
      S.dups = (await rpc('duplicates')).pairs;
    } catch (e) {
      S.dups = [];
      failToast(e);
    }
    if (S.mode === 'dups') renderDups();
  }

  async function startTidy(params) {
    try {
      const r = await rpc('tidy', params);
      S.tasks.set(r.key, r);
      if (params.scope !== 'contact') toast(T.tidySent);
    } catch (e) {
      failToast(e);
    }
    render();
  }

  async function ask(text) {
    const id = S.selId;
    S.asking = true;
    renderView();
    try {
      const r = await rpc('ask', { text, contactId: id || '' });
      if (r.kind === 'task') S.tasks.set(r.key, r);
      if (id) S.qa = await rpc('qa', { contactId: id });
    } catch (e) {
      failToast(e);
    }
    S.asking = false;
    if (S.selId === id && S.mode === 'view') {
      renderView();
      const qa = $('.qa');
      if (qa) qa.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ───────── 事件绑定 ───────── */
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const c = (sel) => t.closest(sel);
    if (!c('#menu') && !c('#scopeBtn') && !c('#moreBtn')) closeMenu();
    let x;
    if ((x = c('#scopeBtn'))) return menu.hidden ? scopeMenu(x) : closeMenu();
    if ((x = c('#moreBtn'))) return menu.hidden ? moreMenu(x) : closeMenu();
    if ((x = c('[data-scope]'))) {
      closeMenu();
      S.scope = x.dataset.scope;
      S.selId = null;
      S.mode = 'view';
      pickDefault();
      renderList();
      if (S.selId) return select(S.selId);
      S.detail = null;
      return renderDetail();
    }
    if (c('#clearFind')) {
      S.query = '';
      renderList();
      return $('#findInput').focus();
    }
    if ((x = c('.row[data-id]'))) return select(x.dataset.id);
    if ((x = c('[data-goto]'))) {
      const id = x.dataset.goto;
      if (!id) return;
      S.scope = 'all';
      S.query = '';
      if (!S.contacts.find((r) => r.id === id)?.rich) S.showFolded = true;
      return select(id);
    }
    if ((x = c('[data-tab]'))) {
      S.tab = x.dataset.tab;
      S.filter = 'all';
      return renderView();
    }
    if ((x = c('[data-filter]'))) {
      S.filter = x.dataset.filter;
      return renderView();
    }
    if ((x = c('[data-loop]'))) return mutate(() => rpc('loop', { id: x.dataset.loop, status: x.dataset.status }));
    if ((x = c('[data-unmerge]'))) return mutate(() => rpc('unmerge', { id: x.dataset.unmerge }), (r) => T.splitDone(r.name));
    if ((x = c('[data-copy]'))) return copy(x.dataset.copy);
    if ((x = c('[data-add-group]'))) {
      closeMenu();
      return mutate(() => rpc('organize', { action: 'add_to_group', contactIds: [S.selId], group: x.dataset.addGroup }), T.savedOk);
    }
    if ((x = c('[data-remove-group]'))) {
      closeMenu();
      return mutate(() => rpc('organize', { action: 'remove_from_group', contactIds: [S.selId], group: x.dataset.removeGroup }), T.savedOk);
    }
    if ((x = c('[data-merge]'))) {
      const [sourceId, targetId] = x.dataset.merge.split('|');
      try {
        await rpc('merge', { sourceId, targetId, reason: '' });
        toast(T.merged);
        S.dups = S.dups.filter((p) => p.a.id !== sourceId && p.b.id !== sourceId);
        await loadList();
        renderList();
        renderDups();
      } catch (err) {
        failToast(err);
      }
      return;
    }
    if ((x = c('[data-not-same]'))) {
      S.dismissedDups.add(x.dataset.notSame);
      return renderDups();
    }
    if ((x = c('[data-profile]'))) {
      try {
        S.meta.settings = await rpc('settings', { profile: x.dataset.profile });
      } catch (err) {
        failToast(err);
      }
      return renderAuto();
    }
    if ((x = c('[data-set]'))) {
      try {
        S.meta.settings = await rpc('settings', { [x.dataset.set]: Number(x.dataset.value) });
      } catch (err) {
        failToast(err);
      }
      return renderAuto();
    }
    if ((x = c('[data-rm-row]'))) return x.closest('.idrow').remove();
    if ((x = c('[data-kind]'))) {
      for (const b of x.parentNode.children) b.setAttribute('aria-pressed', String(b === x));
      return;
    }
    if (!(x = c('[data-action]'))) return;
    const a = x.dataset.action;
    closeMenu();
    if (a === 'toggleFolded') {
      S.showFolded = !S.showFolded;
      return renderList();
    }
    if (a === 'edit') {
      S.mode = 'edit';
      S.formError = null;
      return renderDetail();
    }
    if (a === 'new') {
      S.mode = 'new';
      S.formError = null;
      return renderDetail();
    }
    if (a === 'cancelEdit' || a === 'closePanel') {
      S.mode = 'view';
      S.formError = null;
      S.importStep = null;
      S.importError = null;
      pickDefault();
      if (S.selId) await loadDetail(S.selId);
      return render();
    }
    if (a === 'createAnyway') return submitForm(true);
    if (a === 'addId') {
      const box = $('#idRows');
      box.insertAdjacentHTML('beforeend', idRow({ platform: 'email', value: '' }, box.children.length));
      return box.lastElementChild.querySelector('input').focus();
    }
    if (a === 'confirm') return mutate(() => rpc('organize', { action: 'confirm', contactIds: [S.selId] }), T.confirmed);
    if (a === 'askDelete') {
      S.confirmDelete = true;
      renderView();
      return detailEl.scrollTo({ top: 0 });
    }
    if (a === 'cancelDelete') {
      S.confirmDelete = false;
      return renderView();
    }
    if (a === 'doDelete') {
      // 删的是确认框里显示的那个人，不是此刻 selId 指向的人
      const name = S.detail?.name;
      const id = S.detail?.id;
      if (!id) return;
      S.confirmDelete = false;
      S.selId = null;
      return mutate(() => rpc('delete', { id }), T.deleted(name));
    }
    if (a === 'import') {
      S.mode = 'import';
      S.importStep = null;
      S.importError = null;
      S.importResult = null;
      return renderDetail();
    }
    if (a === 'auto') {
      S.mode = 'auto';
      S.autoOpened = false;
      try {
        S.meta = await rpc('state');
      } catch (_) {
        /* 用已有状态 */
      }
      return render();
    }
    if (a === 'requestAutomation') {
      try {
        S.meta.automationRequested = await rpc('requestAutomation');
        S.autoOpened = true;
      } catch (err) {
        failToast(err);
      }
      return render();
    }
    if (a === 'tidyRecent') return startTidy({ scope: 'recent' });
    if (a === 'backfillAll') return startTidy({ scope: 'backfill' });
    if (a === 'backfill' && S.selId) {
      await startTidy({ scope: 'contact', contactId: S.selId });
      S.qa = await rpc('qa', { contactId: S.selId }).catch(() => S.qa);
      return renderView();
    }
    if (a === 'readMac') return readMac();
    if (a === 'doImport') return doImport();
    if (a === 'dups') return openDups();
    if (a === 'retryLegacy') {
      S.boot = 'loading';
      S.meta = { ...(S.meta || {}), importing: 'legacy' };
      renderStatus();
      try {
        const r = await rpc('importLegacy');
        if (r.status === 'done') toast(r.merged ? T.legacyMerged : T.legacyDone(r.counts?.contacts?.local || 0));
      } catch (err) {
        failToast(err);
      }
      return boot();
    }
    if (a === 'back') {
      S.selId = null;
      S.detail = null;
      return render();
    }
    if (a === 'reload') return boot();
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'macSync') {
      try {
        S.meta.settings = await rpc('settings', { macAutoSync: t.checked });
      } catch (err) {
        t.checked = !t.checked;
        failToast(err);
      }
    }
    if (t.dataset && t.dataset.source) {
      try {
        S.meta.settings = await rpc('settings', { sources: { [t.dataset.source]: t.checked } });
      } catch (err) {
        t.checked = !t.checked;
        failToast(err);
      }
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'findInput') {
      S.query = e.target.value;
      renderList();
    }
  });

  document.addEventListener('keydown', async (e) => {
    const t = e.target;
    if (t.id === 'newGroupInput' && e.key === 'Enter') {
      const name = t.value.trim();
      if (!name) return;
      closeMenu();
      return mutate(() => rpc('organize', { action: 'add_to_group', contactIds: [S.selId], group: name }), T.savedOk);
    }
    if (e.key === 'Escape') {
      if (!menu.hidden) return closeMenu();
      if (S.mode === 'edit' || S.mode === 'new') {
        S.mode = 'view';
        return render();
      }
      if (t.id === 'findInput' && S.query) {
        S.query = '';
        return renderList();
      }
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      return $('#findInput')?.focus();
    }
    if (typing || S.mode !== 'view') return;
    if (e.key === '/') {
      e.preventDefault();
      return $('#findInput')?.focus();
    }
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      const flat = flatVisible();
      const i = flat.findIndex((c) => c.id === S.selId);
      const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1)))];
      if (next && next.id !== S.selId) {
        await select(next.id);
        listpane.querySelector(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    }
  });

  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'editForm') return submitForm(false);
    if (f.id === 'askForm') {
      const inp = $('#askInput');
      const text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      return ask(text);
    }
  });

  /* ───────── 启动 ───────── */
  let pollTimer = null;
  async function boot() {
    clearTimeout(pollTimer);
    try {
      S.meta = await rpc('state');
    } catch (e) {
      S.boot = 'error';
      S.meta = { error: { message: e.message } };
      return render();
    }
    if (S.meta.error && !S.meta.ready) {
      S.boot = 'error';
      return render();
    }
    if (!S.meta.ready || S.meta.importing === 'legacy') {
      S.boot = 'loading';
      S.progress = S.meta.progress;
      renderList();
      renderStatus();
      pollTimer = setTimeout(boot, 1000);
      return;
    }
    for (const r of S.meta.running || []) S.tasks.set(r.key, r);
    try {
      S.view = await rpc('opened');
    } catch (_) {
      /* 没有「上次看过」也能用 */
    }
    S.boot = 'ready';
    await refreshAll();
  }

  (async () => {
    try {
      const ctx = await (await fetch('/app-context')).json();
      LOCALE = ctx?.context?.locale || 'en';
    } catch (_) {
      LOCALE = 'en';
    }
    T = STRINGS[LOCALE] || STRINGS.en;
    document.documentElement.lang = LOCALE;
    render();
    boot();
  })();
})();
