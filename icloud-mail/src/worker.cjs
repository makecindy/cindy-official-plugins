'use strict';

const readline = require('node:readline');
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');

const ICLOUD = Object.freeze({
  imapHost: 'imap.mail.me.com',
  imapPort: 993,
  smtpHost: 'smtp.mail.me.com',
  smtpPort: 587,
});

const MAX_BODY_CHARS = 20000;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SECRET_KEYS = Object.freeze({
  a: 'icloud_mail_app_password',
  b: 'icloud_mail_app_password_b',
});

// 运行时文案跟随宿主语言：main.js 在每次 JSON-RPC 请求的 params.locale 里带上
// 宿主当前语言。Worker 拿不到 cindy.request，且按需常驻，可能跨越宿主语言切换，
// 所以不缓存语言，每个请求按自己的 locale 取文案；缺失或不支持时回退英文。
const DEFAULT_LOCALE = 'en';
const MESSAGES = Object.freeze({
  'zh-CN': Object.freeze({
    invalidEmail: '请输入有效的 iCloud Mail 邮箱地址',
    invalidAppSpecificPassword: '请输入 Apple 账户网站生成的 App 专用密码，不要输入 Apple 账户密码',
    notConfigured: '尚未配置 iCloud Mail，请到「iCloud Mail」插件详情页输入邮箱和 App 专用密码',
    invalidCredentialSlot: 'iCloud Mail 凭证状态无效，请在插件详情页重新连接',
    authRejected: 'iCloud Mail 拒绝登录。请确认 Apple 账户已开启双重认证，并使用生成的 App 专用密码（不是 Apple 账户密码）',
    networkUnreachable: '无法连接 iCloud Mail 服务器，请检查网络后重试',
    rateLimited: 'iCloud Mail 暂时限制了频繁访问，请稍后再试',
    messageNotFound: '没有在指定文件夹找到这封邮件，请重新搜索',
    messageTooLarge: '邮件内容过大，当前版本暂时无法处理',
    draftFolderNotFound: '没有找到 iCloud Mail 草稿箱，请先调用 list_folders 确认服务器文件夹',
    draftSaveFailed: 'iCloud Mail 未能保存草稿，请稍后重试',
    targetFolderRequired: 'move 需要目标文件夹',
    targetFolderSame: '目标文件夹不能与当前文件夹相同',
    moveUnconfirmed: '无法确认邮件是否已移动，请重新搜索邮箱后再操作',
    recipientRequired: '请至少填写一个收件人',
    invalidRecipient: '收件人、抄送或密送地址格式不正确',
    invalidSubject: '邮件主题格式不正确',
    invalidBody: '邮件正文格式不正确',
    invalidSearchDate: '搜索日期格式无效，请使用 ISO 日期或日期时间',
    folderUnavailable: 'iCloud Mail 文件夹不存在或不可用，请先调用 list_folders 获取准确名称',
    operationFailedRetry: 'iCloud Mail 操作失败，请稍后重试',
    operationFailed: 'iCloud Mail 操作失败',
    invalidRequestFormat: '请求格式无效',
    bodyTruncated: '…（正文过长，已截断）',
  }),
  en: Object.freeze({
    invalidEmail: 'Enter a valid iCloud Mail email address',
    invalidAppSpecificPassword: 'Enter the app-specific password generated on the Apple Account website, not your Apple Account password',
    notConfigured: 'iCloud Mail is not configured yet. Open the "iCloud Mail" plugin details and enter the email address and app-specific password.',
    invalidCredentialSlot: 'Invalid iCloud Mail credential state. Reconnect in the plugin details.',
    authRejected: 'iCloud Mail rejected the login. Make sure two-factor authentication is on for the Apple Account and use a generated app-specific password (not the Apple Account password).',
    networkUnreachable: 'Cannot reach the iCloud Mail server. Check your network connection and try again.',
    rateLimited: 'iCloud Mail is temporarily rate limiting frequent access. Try again later.',
    messageNotFound: 'This message was not found in the given folder. Search again.',
    messageTooLarge: 'The message is too large for this version to handle',
    draftFolderNotFound: 'No iCloud Mail Drafts folder found. Call list_folders first to check the server folders.',
    draftSaveFailed: 'iCloud Mail could not save the draft. Try again later.',
    targetFolderRequired: 'move requires a target folder',
    targetFolderSame: 'The target folder cannot be the same as the current folder',
    moveUnconfirmed: 'Could not confirm whether the message was moved. Search the mailbox again before doing anything else.',
    recipientRequired: 'Provide at least one recipient',
    invalidRecipient: 'Invalid To, Cc, or Bcc address format',
    invalidSubject: 'Invalid subject format',
    invalidBody: 'Invalid body format',
    invalidSearchDate: 'Invalid search date. Use an ISO date or date-time.',
    folderUnavailable: 'The iCloud Mail folder does not exist or is unavailable. Call list_folders first to get the exact name.',
    operationFailedRetry: 'iCloud Mail operation failed. Try again later.',
    operationFailed: 'iCloud Mail operation failed',
    invalidRequestFormat: 'Invalid request format',
    bodyTruncated: '... (body too long, truncated)',
  }),
  ja: Object.freeze({
    invalidEmail: '有効なiCloudメールアドレスを入力してください',
    invalidAppSpecificPassword: 'Apple アカウントの Web サイトで生成したApp用パスワードを入力してください。Apple アカウントのパスワードは入力しないでください',
    notConfigured: 'iCloudメールはまだ設定されていません。「iCloudメール」プラグインの詳細画面でメールアドレスとApp用パスワードを入力してください',
    invalidCredentialSlot: 'iCloudメールの認証情報の状態が無効です。プラグインの詳細画面で再接続してください',
    authRejected: 'iCloudメールがログインを拒否しました。Apple アカウントで2ファクタ認証が有効になっていることを確認し、生成したApp用パスワード（Apple アカウントのパスワードではありません）を使用してください',
    networkUnreachable: 'iCloudメールのサーバーに接続できません。ネットワークを確認してから再試行してください',
    rateLimited: 'iCloudメールが頻繁なアクセスを一時的に制限しています。しばらくしてから再試行してください',
    messageNotFound: '指定したフォルダーにこのメールが見つかりません。もう一度検索してください',
    messageTooLarge: 'メールのサイズが大きすぎるため、現在のバージョンでは処理できません',
    draftFolderNotFound: 'iCloudメールの下書きフォルダーが見つかりません。先に list_folders を呼び出してサーバーのフォルダーを確認してください',
    draftSaveFailed: 'iCloudメールで下書きを保存できませんでした。しばらくしてから再試行してください',
    targetFolderRequired: 'move には移動先フォルダーが必要です',
    targetFolderSame: '移動先フォルダーに現在のフォルダーは指定できません',
    moveUnconfirmed: 'メールが移動されたかどうかを確認できません。ほかの操作をする前にメールボックスをもう一度検索してください',
    recipientRequired: '宛先を1件以上入力してください',
    invalidRecipient: '宛先、Cc、Bccのアドレス形式が正しくありません',
    invalidSubject: '件名の形式が正しくありません',
    invalidBody: '本文の形式が正しくありません',
    invalidSearchDate: '検索日付の形式が無効です。ISO形式の日付または日時を使用してください',
    folderUnavailable: 'iCloudメールのフォルダーが存在しないか使用できません。先に list_folders を呼び出して正確な名前を取得してください',
    operationFailedRetry: 'iCloudメールの操作に失敗しました。しばらくしてから再試行してください',
    operationFailed: 'iCloudメールの操作に失敗しました',
    invalidRequestFormat: 'リクエストの形式が無効です',
    bodyTruncated: '…（本文が長すぎるため切り詰めました）',
  }),
  ko: Object.freeze({
    invalidEmail: '올바른 iCloud 메일 주소를 입력하세요',
    invalidAppSpecificPassword: 'Apple 계정 웹사이트에서 생성한 앱 전용 비밀번호를 입력하세요. Apple 계정 비밀번호는 입력하지 마세요',
    notConfigured: 'iCloud 메일이 아직 설정되지 않았습니다. "iCloud 메일" 플러그인 상세 화면에서 메일 주소와 앱 전용 비밀번호를 입력하세요',
    invalidCredentialSlot: 'iCloud 메일 인증 정보 상태가 올바르지 않습니다. 플러그인 상세 화면에서 다시 연결하세요',
    authRejected: 'iCloud 메일이 로그인을 거부했습니다. Apple 계정에 이중 인증이 켜져 있는지 확인하고, 생성한 앱 전용 비밀번호(Apple 계정 비밀번호 아님)를 사용하세요',
    networkUnreachable: 'iCloud 메일 서버에 연결할 수 없습니다. 네트워크를 확인한 후 다시 시도하세요',
    rateLimited: 'iCloud 메일이 잦은 접근을 일시적으로 제한하고 있습니다. 잠시 후 다시 시도하세요',
    messageNotFound: '지정한 폴더에서 이 메일을 찾을 수 없습니다. 다시 검색하세요',
    messageTooLarge: '메일 크기가 너무 커서 현재 버전에서는 처리할 수 없습니다',
    draftFolderNotFound: 'iCloud 메일 임시 보관함을 찾을 수 없습니다. 먼저 list_folders를 호출해 서버 폴더를 확인하세요',
    draftSaveFailed: 'iCloud 메일에 임시 보관 메일을 저장하지 못했습니다. 잠시 후 다시 시도하세요',
    targetFolderRequired: 'move에는 대상 폴더가 필요합니다',
    targetFolderSame: '대상 폴더는 현재 폴더와 같을 수 없습니다',
    moveUnconfirmed: '메일이 이동되었는지 확인할 수 없습니다. 다른 작업을 하기 전에 메일함을 다시 검색하세요',
    recipientRequired: '받는 사람을 한 명 이상 입력하세요',
    invalidRecipient: '받는 사람, 참조 또는 숨은 참조 주소 형식이 올바르지 않습니다',
    invalidSubject: '제목 형식이 올바르지 않습니다',
    invalidBody: '본문 형식이 올바르지 않습니다',
    invalidSearchDate: '검색 날짜 형식이 올바르지 않습니다. ISO 날짜 또는 날짜 및 시간을 사용하세요',
    folderUnavailable: 'iCloud 메일 폴더가 없거나 사용할 수 없습니다. 먼저 list_folders를 호출해 정확한 이름을 확인하세요',
    operationFailedRetry: 'iCloud 메일 작업에 실패했습니다. 잠시 후 다시 시도하세요',
    operationFailed: 'iCloud 메일 작업에 실패했습니다',
    invalidRequestFormat: '요청 형식이 올바르지 않습니다',
    bodyTruncated: '…(본문이 너무 길어 잘렸습니다)',
  }),
});

function resolveLocale(locale) {
  return typeof locale === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, locale)
    ? locale
    : DEFAULT_LOCALE;
}

function t(locale, key) {
  return MESSAGES[resolveLocale(locale)][key];
}

function requestLocale(request) {
  const params = request && request.params && typeof request.params === 'object'
    ? request.params
    : {};
  return resolveLocale(params.locale);
}

function normalizeCredentials(value) {
  const input = value && typeof value === 'object' ? value : {};
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const appSpecificPassword = typeof input.appSpecificPassword === 'string'
    ? input.appSpecificPassword.replace(/\s+/g, '').trim()
    : '';
  if (!EMAIL_RE.test(email) || email.length > 254) throw new Error('INVALID_EMAIL');
  if (
    appSpecificPassword.length < 8
    || appSpecificPassword.length > 128
    || /[\r\n\0]/.test(appSpecificPassword)
  ) {
    throw new Error('INVALID_APP_SPECIFIC_PASSWORD');
  }
  return { email, appSpecificPassword };
}

/**
 * 读取宿主为本次 JSON-RPC 请求临时注入的凭证。该字段不来自插件 main.js，
 * 只有 ghost.json 绑定的方法才能收到；取出后立即清掉请求对象中的引用。
 */
function consumeRequestCredentials(request) {
  const params = request.params && typeof request.params === 'object' ? request.params : {};
  const cindy = request.cindy && typeof request.cindy === 'object' ? request.cindy : {};
  const secrets = cindy.secrets && typeof cindy.secrets === 'object' ? cindy.secrets : {};
  const credentialSlot = params.credentialSlot === undefined ? 'a' : params.credentialSlot;
  const rawCode = credentialSlot === 'a' || credentialSlot === 'b'
    ? secrets[SECRET_KEYS[credentialSlot]]
    : undefined;
  Object.values(SECRET_KEYS).forEach((key) => {
    secrets[key] = '';
  });
  if (credentialSlot !== 'a' && credentialSlot !== 'b') {
    throw new Error('INVALID_CREDENTIAL_SLOT');
  }
  return normalizeCredentials({
    email: params.email,
    appSpecificPassword: rawCode,
  });
}

function normalizeRecipients(value, required) {
  let items = [];
  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string') items = value.split(',');
  const normalized = items.map((entry) => String(entry).trim()).filter(Boolean);
  if (required && normalized.length === 0) throw new Error('RECIPIENT_REQUIRED');
  if (normalized.length > 50 || normalized.some((entry) => !EMAIL_RE.test(entry))) {
    throw new Error('INVALID_RECIPIENT');
  }
  return normalized;
}

function parseSearchDate(value, field) {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`INVALID_${field.toUpperCase()}`);
  return date;
}

function buildSearchCriteria(action) {
  const criteria = {};
  if (typeof action.from === 'string' && action.from.trim()) criteria.from = action.from.trim();
  if (typeof action.to === 'string' && action.to.trim()) criteria.to = action.to.trim();
  if (typeof action.subject === 'string' && action.subject.trim()) criteria.subject = action.subject.trim();
  if (typeof action.unread === 'boolean') criteria.seen = !action.unread;
  const since = parseSearchDate(action.since, 'since');
  const before = parseSearchDate(action.before, 'before');
  if (since) criteria.since = since;
  if (before) criteria.before = before;
  if (typeof action.text === 'string' && action.text.trim()) {
    const text = action.text.trim();
    criteria.or = [
      { subject: text },
      { from: text },
      { to: text },
      { body: text },
    ];
  }
  if (Object.keys(criteria).length === 0) criteria.all = true;
  return criteria;
}

function addressText(value) {
  if (!Array.isArray(value)) return '';
  return value.map((entry) => {
    const address = entry && entry.address ? String(entry.address) : '';
    const name = entry && entry.name ? String(entry.name) : '';
    return name && address ? `${name} <${address}>` : address || name;
  }).filter(Boolean).join(', ');
}

function flagsArray(flags) {
  return flags && typeof flags[Symbol.iterator] === 'function' ? Array.from(flags) : [];
}

function summaryFromMessage(message, folder) {
  const envelope = message.envelope || {};
  const flags = flagsArray(message.flags);
  return {
    uid: message.uid,
    folder,
    from: addressText(envelope.from),
    to: addressText(envelope.to),
    subject: envelope.subject || '',
    date: (envelope.date || message.internalDate || null)
      ? new Date(envelope.date || message.internalDate).toISOString()
      : null,
    unread: !flags.includes('\\Seen'),
    flagged: flags.includes('\\Flagged'),
    size: Number.isFinite(message.size) ? message.size : null,
  };
}

function imapOptions(credentials) {
  return {
    host: ICLOUD.imapHost,
    port: ICLOUD.imapPort,
    secure: true,
    auth: {
      user: credentials.email,
      pass: credentials.appSpecificPassword,
    },
    disableAutoIdle: true,
    emitLogs: false,
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  };
}

function smtpOptions(credentials) {
  return {
    host: ICLOUD.smtpHost,
    port: ICLOUD.smtpPort,
    secure: false,
    requireTLS: true,
    pool: false,
    auth: {
      user: credentials.email,
      pass: credentials.appSpecificPassword,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

function createRuntimeDeps() {
  return {
    createImap(credentials) {
      return new ImapFlow(imapOptions(credentials));
    },
    createSmtp(credentials) {
      return nodemailer.createTransport(smtpOptions(credentials));
    },
    createComposer() {
      return nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
        newline: 'windows',
      });
    },
    parseMessage(source) {
      return simpleParser(source, {
        keepCidLinks: true,
        skipHtmlToText: false,
        skipTextToHtml: true,
        maxHtmlLengthToParse: 2 * 1024 * 1024,
      });
    },
  };
}

async function withImap(credentials, deps, operation) {
  const client = deps.createImap(credentials);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    return await operation(client);
  } finally {
    if (connected) {
      try {
        await client.logout();
      } catch (_error) {
        try {
          client.close();
        } catch (_closeError) {
          // 连接已在关闭，忽略。
        }
      }
    } else {
      try {
        client.close();
      } catch (_error) {
        // 尚未连通，无需额外处理。
      }
    }
  }
}

async function withMailbox(client, folder, operation) {
  let lock;
  try {
    lock = await client.getMailboxLock(folder);
    return await operation();
  } finally {
    if (lock) lock.release();
  }
}

async function listFolders(credentials, deps) {
  return withImap(credentials, deps, async (client) => {
    const folders = await client.list();
    return {
      folders: folders.map((folder) => ({
        path: folder.path,
        name: folder.name || folder.path,
        delimiter: folder.delimiter || null,
        special_use: folder.specialUse || null,
        selectable: !(folder.flags && folder.flags.has && folder.flags.has('\\Noselect')),
      })),
    };
  });
}

async function search(credentials, action, deps) {
  const folder = action.folder || 'INBOX';
  const maxResults = Number.isInteger(action.max_results)
    ? Math.min(20, Math.max(1, action.max_results))
    : 10;
  return withImap(credentials, deps, (client) => withMailbox(client, folder, async () => {
    const uids = await client.search(buildSearchCriteria(action), { uid: true });
    const selected = uids.slice(-maxResults).reverse();
    if (selected.length === 0) return { folder, total: 0, messages: [] };
    const messages = await client.fetchAll(
      selected,
      { uid: true, envelope: true, flags: true, internalDate: true, size: true },
      { uid: true },
    );
    const byUid = new Map(messages.map((message) => [message.uid, message]));
    return {
      folder,
      total: uids.length,
      messages: selected.map((uid) => byUid.get(uid)).filter(Boolean)
        .map((message) => summaryFromMessage(message, folder)),
    };
  }));
}

async function readMessage(credentials, action, deps, locale) {
  const folder = action.folder || 'INBOX';
  return withImap(credentials, deps, (client) => withMailbox(client, folder, async () => {
    const message = await client.fetchOne(
      action.message_uid,
      { uid: true, envelope: true, flags: true, internalDate: true, size: true },
      { uid: true },
    );
    if (!message) throw new Error('MESSAGE_NOT_FOUND');
    if (Number.isFinite(message.size) && message.size > MAX_SOURCE_BYTES) {
      throw new Error('MESSAGE_TOO_LARGE');
    }

    const downloaded = await client.download(
      action.message_uid,
      undefined,
      { uid: true, maxBytes: MAX_SOURCE_BYTES + 1 },
    );
    if (!downloaded || !downloaded.content) throw new Error('MESSAGE_NOT_FOUND');
    if (
      downloaded.meta
      && Number.isFinite(downloaded.meta.expectedSize)
      && downloaded.meta.expectedSize > MAX_SOURCE_BYTES
    ) {
      downloaded.content.destroy();
      throw new Error('MESSAGE_TOO_LARGE');
    }

    const chunks = [];
    let sourceBytes = 0;
    for await (const chunk of downloaded.content) {
      sourceBytes += chunk.length;
      if (sourceBytes > MAX_SOURCE_BYTES) {
        downloaded.content.destroy();
        throw new Error('MESSAGE_TOO_LARGE');
      }
      chunks.push(chunk);
    }
    const parsed = await deps.parseMessage(Buffer.concat(chunks, sourceBytes));
    const text = typeof parsed.text === 'string' && parsed.text.trim()
      ? parsed.text
      : typeof parsed.html === 'string'
        ? parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : '';
    return {
      ...summaryFromMessage(message, folder),
      cc: parsed.cc && parsed.cc.text ? parsed.cc.text : '',
      reply_to: parsed.replyTo && parsed.replyTo.text ? parsed.replyTo.text : '',
      message_id: parsed.messageId || '',
      body_text: text.length > MAX_BODY_CHARS
        ? `${text.slice(0, MAX_BODY_CHARS)}\n${t(locale, 'bodyTruncated')}`
        : text,
      attachments: Array.isArray(parsed.attachments)
        ? parsed.attachments.map((attachment) => ({
            filename: attachment.filename || null,
            content_type: attachment.contentType || null,
            size: Number.isFinite(attachment.size) ? attachment.size : null,
          }))
        : [],
    };
  }));
}

function mailOptions(credentials, action) {
  const to = normalizeRecipients(action.to, true);
  const cc = normalizeRecipients(action.cc, false);
  const bcc = normalizeRecipients(action.bcc, false);
  if (typeof action.subject !== 'string' || /[\r\n\0]/.test(action.subject)) {
    throw new Error('INVALID_SUBJECT');
  }
  if (typeof action.body_text !== 'string') throw new Error('INVALID_BODY');
  if (action.subject.length > 998 || action.body_text.length > 500000) {
    throw new Error('MESSAGE_TOO_LARGE');
  }
  return {
    from: credentials.email,
    to,
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    subject: action.subject,
    text: action.body_text,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

async function sendMessage(credentials, action, deps) {
  const transporter = deps.createSmtp(credentials);
  try {
    const info = await transporter.sendMail(mailOptions(credentials, action));
    return {
      sent: true,
      message_id: info.messageId || null,
      accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
      rejected: Array.isArray(info.rejected) ? info.rejected.map(String) : [],
    };
  } finally {
    if (transporter && typeof transporter.close === 'function') transporter.close();
  }
}

async function findDraftFolder(client) {
  const folders = await client.list();
  const special = folders.find((folder) => folder.specialUse === '\\Drafts');
  if (special) return special.path;
  const fallback = folders.find((folder) => /(^|[/])drafts?$|草稿箱/i.test(folder.path));
  if (fallback) return fallback.path;
  throw new Error('DRAFT_FOLDER_NOT_FOUND');
}

async function saveDraft(credentials, action, deps) {
  const composer = deps.createComposer();
  try {
    const info = await composer.sendMail(mailOptions(credentials, action));
    if (!info || !Buffer.isBuffer(info.message)) throw new Error('DRAFT_BUILD_FAILED');
    return withImap(credentials, deps, async (client) => {
      const folder = await findDraftFolder(client);
      const appended = await client.append(folder, info.message, ['\\Draft'], new Date());
      if (!appended) throw new Error('DRAFT_SAVE_FAILED');
      return {
        draft: true,
        folder,
        uid: appended && appended.uid ? appended.uid : null,
        uid_validity: appended && appended.uidValidity ? String(appended.uidValidity) : null,
      };
    });
  } finally {
    if (composer && typeof composer.close === 'function') composer.close();
  }
}

async function changeFlags(credentials, action, deps, seen) {
  const folder = action.folder || 'INBOX';
  return withImap(credentials, deps, (client) => withMailbox(client, folder, async () => {
    const existing = await client.fetchOne(
      action.message_uid,
      { uid: true, flags: true },
      { uid: true },
    );
    if (!existing) throw new Error('MESSAGE_NOT_FOUND');

    const currentFlags = flagsArray(existing.flags);
    if (currentFlags.includes('\\Seen') !== seen) {
      const updated = seen
        ? await client.messageFlagsAdd(action.message_uid, ['\\Seen'], { uid: true })
        : await client.messageFlagsRemove(action.message_uid, ['\\Seen'], { uid: true });
      if (!updated) throw new Error('MESSAGE_NOT_FOUND');

      const verified = await client.fetchOne(
        action.message_uid,
        { uid: true, flags: true },
        { uid: true },
      );
      if (!verified) throw new Error('MESSAGE_NOT_FOUND');
      if (flagsArray(verified.flags).includes('\\Seen') !== seen) {
        throw new Error('MESSAGE_UPDATE_FAILED');
      }
    }
    return { updated: true, folder, uid: action.message_uid, unread: !seen };
  }));
}

async function moveMessage(credentials, action, deps) {
  const folder = action.folder || 'INBOX';
  const target = typeof action.target_folder === 'string' ? action.target_folder.trim() : '';
  if (!target) throw new Error('TARGET_FOLDER_REQUIRED');
  if (target === folder) throw new Error('TARGET_FOLDER_SAME');
  return withImap(credentials, deps, (client) => withMailbox(client, folder, async () => {
    const existing = await client.fetchOne(
      action.message_uid,
      { uid: true },
      { uid: true },
    );
    if (!existing) throw new Error('MESSAGE_NOT_FOUND');

    const moved = await client.messageMove(action.message_uid, target, { uid: true });
    if (!moved) throw new Error('MESSAGE_NOT_FOUND');
    const destinationUid = moved.uidMap && moved.uidMap.get
      ? (moved.uidMap.get(action.message_uid) || null)
      : null;
    if (!destinationUid) throw new Error('MESSAGE_MOVE_UNCONFIRMED');
    return {
      moved: true,
      from_folder: folder,
      to_folder: target,
      uid: action.message_uid,
      destination_uid: destinationUid,
    };
  }));
}

async function testAccount(credentials, deps) {
  await withImap(credentials, deps, async () => undefined);
  const transporter = deps.createSmtp(credentials);
  try {
    await transporter.verify();
  } finally {
    if (transporter && typeof transporter.close === 'function') transporter.close();
  }
  return {
    connected: true,
    email: credentials.email,
    imap: `${ICLOUD.imapHost}:${ICLOUD.imapPort}`,
    smtp: `${ICLOUD.smtpHost}:${ICLOUD.smtpPort}`,
  };
}

async function performAction(credentials, action, deps, locale) {
  switch (action.action) {
    case 'list_folders':
      return listFolders(credentials, deps);
    case 'search':
      return search(credentials, action, deps);
    case 'read':
      return readMessage(credentials, action, deps, locale);
    case 'send':
      return sendMessage(credentials, action, deps);
    case 'draft':
      return saveDraft(credentials, action, deps);
    case 'mark_read':
      return changeFlags(credentials, action, deps, true);
    case 'mark_unread':
      return changeFlags(credentials, action, deps, false);
    case 'move':
      return moveMessage(credentials, action, deps);
    default:
      throw new Error('UNKNOWN_ACTION');
  }
}

function humanizeError(error, locale) {
  const code = error && error.code ? String(error.code) : '';
  const message = error && error.message ? String(error.message) : String(error || '');
  const combined = `${code} ${message}`.toLowerCase();

  if (message === 'INVALID_EMAIL') return t(locale, 'invalidEmail');
  if (message === 'INVALID_APP_SPECIFIC_PASSWORD') {
    return t(locale, 'invalidAppSpecificPassword');
  }
  if (message === 'NOT_CONFIGURED') {
    return t(locale, 'notConfigured');
  }
  if (message === 'INVALID_CREDENTIAL_SLOT') {
    return t(locale, 'invalidCredentialSlot');
  }
  if (
    code === 'EAUTH'
    || combined.includes('authenticationfailed')
    || combined.includes('authentication failed')
    || combined.includes('invalid credentials')
    || combined.includes('login failed')
  ) {
    return t(locale, 'authRejected');
  }
  if (
    code === 'ETIMEDOUT'
    || code === 'ECONNREFUSED'
    || code === 'ECONNRESET'
    || code === 'ENETUNREACH'
    || combined.includes('timed out')
  ) {
    return t(locale, 'networkUnreachable');
  }
  if (combined.includes('too many') || combined.includes('rate limit') || combined.includes('频繁')) {
    return t(locale, 'rateLimited');
  }
  if (message === 'MESSAGE_NOT_FOUND') return t(locale, 'messageNotFound');
  if (message === 'MESSAGE_TOO_LARGE') return t(locale, 'messageTooLarge');
  if (message === 'DRAFT_FOLDER_NOT_FOUND') {
    return t(locale, 'draftFolderNotFound');
  }
  if (message === 'DRAFT_SAVE_FAILED') {
    return t(locale, 'draftSaveFailed');
  }
  if (message === 'TARGET_FOLDER_REQUIRED') return t(locale, 'targetFolderRequired');
  if (message === 'TARGET_FOLDER_SAME') return t(locale, 'targetFolderSame');
  if (message === 'MESSAGE_MOVE_UNCONFIRMED') {
    return t(locale, 'moveUnconfirmed');
  }
  if (message === 'RECIPIENT_REQUIRED') return t(locale, 'recipientRequired');
  if (message === 'INVALID_RECIPIENT') return t(locale, 'invalidRecipient');
  if (message === 'INVALID_SUBJECT') return t(locale, 'invalidSubject');
  if (message === 'INVALID_BODY') return t(locale, 'invalidBody');
  if (message.startsWith('INVALID_SINCE') || message.startsWith('INVALID_BEFORE')) {
    return t(locale, 'invalidSearchDate');
  }
  if (combined.includes('mailbox') || combined.includes('folder')) {
    return t(locale, 'folderUnavailable');
  }
  return t(locale, 'operationFailedRetry');
}

async function handleRequest(request, deps = createRuntimeDeps()) {
  if (!request || typeof request !== 'object') throw new Error('INVALID_REQUEST');
  const locale = requestLocale(request);
  let credentials = null;
  try {
    const params = request.params && typeof request.params === 'object' ? request.params : {};
    const methodMatch = /^(account\/connect|mail\/action)-([ab])$/.exec(request.method);
    if (!methodMatch) throw new Error('METHOD_NOT_FOUND');
    const method = methodMatch[1];
    const credentialSlot = methodMatch[2];
    if (params.credentialSlot !== undefined && params.credentialSlot !== credentialSlot) {
      throw new Error('INVALID_CREDENTIAL_SLOT');
    }
    const boundRequest = {
      ...request,
      params: {
        ...params,
        credentialSlot,
      },
    };
    if (method === 'account/connect') {
      credentials = consumeRequestCredentials(boundRequest);
      const tested = await testAccount(credentials, deps);
      return { ...tested, persistence: 'cindy-safe-storage' };
    }
    if (method === 'mail/action') {
      credentials = consumeRequestCredentials(boundRequest);
      const action = params.action && typeof params.action === 'object' ? params.action : {};
      return await performAction(credentials, action, deps, locale);
    }
    throw new Error('METHOD_NOT_FOUND');
  } catch (error) {
    throw new Error(humanizeError(error, locale));
  } finally {
    if (credentials) credentials.appSpecificPassword = '';
  }
}

function writeReply(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function startStdio() {
  readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch (_error) {
      writeReply({
        jsonrpc: '2.0',
        id: null,
        // 整行无法解析时拿不到 params.locale，按协议回退英文。
        error: { code: -32700, message: t(DEFAULT_LOCALE, 'invalidRequestFormat') },
      });
      return;
    }
    void handleRequest(request)
      .then((result) => {
        writeReply({ jsonrpc: '2.0', id: request.id, result });
      })
      .catch((error) => {
        writeReply({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32000,
            message: error && error.message
              ? error.message
              : t(requestLocale(request), 'operationFailed'),
          },
        });
      });
  });
}

if (require.main === module) startStdio();

module.exports = {
  DEFAULT_LOCALE,
  ICLOUD,
  MESSAGES,
  buildSearchCriteria,
  createRuntimeDeps,
  consumeRequestCredentials,
  handleRequest,
  humanizeError,
  imapOptions,
  normalizeCredentials,
  normalizeRecipients,
  performAction,
  resolveLocale,
  smtpOptions,
  startStdio,
  summaryFromMessage,
};
