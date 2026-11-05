'use strict';
// Shared IMAP/SMTP adapter for Cindy's common mail cards (cindyMail v1).
// Identical copies live in each IMAP mail plugin; .tests/imap-mail-compose.test.mjs
// enforces that. Cindy owns cards, autosave, countdown and continuation; this
// module only reads, writes, sends and deletes the mailbox draft itself.
//
// Identity: the draft's Message-ID is the stable logical draftId. IMAP cannot
// edit a stored message, so every save appends a new revision, removes the
// previous one and reads the result back. The locator {folder, uid, uidValidity}
// changes on each save; a stale locator falls back to a Message-ID search.
// Execution receipts: not_executed before a remote write, unknown while one is
// in flight, executed once the server confirmed it. Nothing is ever replayed.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path = require('node:path');
const addressparser = require('nodemailer/lib/addressparser');

const MAX_FIELD = 16000;
const MAX_HTML_FIELD = 64000;
const MAX_NEW_FILE = 16 * 1024 * 1024;
const MAX_NEW_TOTAL = 25 * 1024 * 1024;
const MAX_PREVIEW_IMAGE = 16 * 1024 * 1024;
const MAX_PREVIEW_TOTAL = 25 * 1024 * 1024;
const MAX_AGENT_FILES = 10;
const DRAFT_SCAN_LIMIT = 500;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const DRAFT_ID_RE = /^<[^<>\s\0]{3,994}>$/;
const QUOTE_HTML_MARK = '<div class="cindy_quote"';
const QUOTE_TEXT_RE = /\r?\n\r?\n(?=On [^\r\n]{1,600} wrote:\r?\n|-{10} Forwarded message -{9}\r?\n)/;
const BLOCKQUOTE = '<blockquote style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">';

const MESSAGES = Object.freeze({
  'zh-CN': {
    fieldsInvalid: '草稿内容不完整或超过大小上限，未保存。',
    headersInvalid: '收件人、抄送、密送或主题格式不正确，未保存。',
    recipientRequired: '请至少填写一个收件人，邮件未发送。',
    draftIdInvalid: 'draft_id 必须是创建或读取草稿时返回的 Message-ID（形如 <id@example.test>）。',
    draftNotFound: '没有在草稿箱找到这份草稿；它可能已被发送、删除或在其他设备上修改，请重新搜索草稿箱。',
    draftNoMessageId: '这份草稿没有 Message-ID，无法在卡片中编辑；请在邮箱中打开它。',
    draftChanged: '草稿已在邮箱中被修改，请核对最新内容后再操作。',
    notEditable: '这份草稿的格式无法在卡片中完整编辑（例如签名或加密邮件），请在邮箱中处理。',
    attachmentListInvalid: '附件列表无效或包含未知附件，未保存。',
    attachmentUnreadable: '附件不存在、无法读取、不是普通文件或与选择时不一致，未保存。',
    attachmentTooLarge: '新增附件单个不能超过 16 MiB，合计不能超过 25 MiB，未保存。',
    attachmentPathsInvalid: 'attachment_paths 须为本机文件绝对路径列表，每封最多 10 个文件。',
    messageTooLarge: '邮件内容过大，未保存。',
    sourceNotFound: '没有在指定文件夹找到要回复或转发的原邮件，请重新搜索后再试。',
    sourceRequired: '回复或转发需要原邮件的 folder 和 message_uid。',
    saveUnknown: '无法确认草稿是否已保存，请先查看草稿箱，不要重复保存。',
    savedUnverified: '草稿已保存，但未能读回核对；请先读取草稿确认，不要重复创建。',
    savedMismatch: '草稿已保存，但读回内容与预期不一致；请读取草稿核对后再发送。',
    sendUnknown: '无法确认邮件是否已发出，请先查看「已发送」文件夹，不要重复发送。',
    sendRejected: '邮件服务器拒绝了全部收件人，邮件未发送。',
    deleteUnknown: '无法确认草稿是否已删除，请先查看草稿箱，不要重复操作。',
    readFailed: '无法读取草稿，请稍后重试。',
  },
  en: {
    fieldsInvalid: 'The draft is incomplete or exceeds the size limit. Nothing was saved.',
    headersInvalid: 'Invalid To, Cc, Bcc or Subject. Nothing was saved.',
    recipientRequired: 'Add at least one recipient. The message was not sent.',
    draftIdInvalid: 'draft_id must be the Message-ID returned when the draft was created or read (like <id@example.test>).',
    draftNotFound: 'This draft is no longer in the Drafts folder. It may have been sent, deleted or changed elsewhere; search Drafts again.',
    draftNoMessageId: 'This draft has no Message-ID and cannot be edited in the card. Open it in your mailbox.',
    draftChanged: 'The draft was changed in the mailbox. Review the latest version before continuing.',
    notEditable: 'This draft cannot be edited in full here (for example a signed or encrypted message). Handle it in your mailbox.',
    attachmentListInvalid: 'The attachment list is invalid or contains an unknown attachment. Nothing was saved.',
    attachmentUnreadable: 'An attachment is missing, unreadable, not a regular file or changed since it was selected. Nothing was saved.',
    attachmentTooLarge: 'New attachments are limited to 16 MiB each and 25 MiB in total. Nothing was saved.',
    attachmentPathsInvalid: 'attachment_paths must be a list of absolute local file paths, at most 10 per message.',
    messageTooLarge: 'The message is too large. Nothing was saved.',
    sourceNotFound: 'The message to reply to or forward was not found in that folder. Search again.',
    sourceRequired: 'Replying or forwarding needs the original message folder and message_uid.',
    saveUnknown: 'Could not confirm whether the draft was saved. Check the Drafts folder before saving again.',
    savedUnverified: 'The draft was saved but could not be read back. Read the draft before doing anything else; do not create it again.',
    savedMismatch: 'The draft was saved, but its read-back differs from what was expected. Read the draft and review it before sending.',
    sendUnknown: 'Could not confirm whether the message was sent. Check the Sent folder; do not send it again.',
    sendRejected: 'The mail server rejected every recipient. The message was not sent.',
    deleteUnknown: 'Could not confirm whether the draft was deleted. Check the Drafts folder; do not repeat the operation.',
    readFailed: 'Could not read the draft. Try again later.',
  },
  ja: {
    fieldsInvalid: '下書きの内容が不完全か、サイズの上限を超えています。保存していません。',
    headersInvalid: '宛先、Cc、Bcc、または件名の形式が正しくありません。保存していません。',
    recipientRequired: '宛先を1件以上入力してください。メールは送信していません。',
    draftIdInvalid: 'draft_id には下書きの作成時または読み込み時に返された Message-ID（<id@example.test> の形式）を指定してください。',
    draftNotFound: 'この下書きは下書きフォルダーにありません。送信・削除されたか、別の場所で変更された可能性があります。下書きフォルダーをもう一度検索してください。',
    draftNoMessageId: 'この下書きには Message-ID がないため、カードで編集できません。メールボックスで開いてください。',
    draftChanged: '下書きがメールボックスで変更されました。最新の内容を確認してから続けてください。',
    notEditable: 'この下書きはここでは完全に編集できません（署名付きまたは暗号化されたメールなど）。メールボックスで処理してください。',
    attachmentListInvalid: '添付ファイルの一覧が無効か、不明な添付ファイルを含んでいます。保存していません。',
    attachmentUnreadable: '添付ファイルが見つからない、読み込めない、通常のファイルではない、または選択後に変更されています。保存していません。',
    attachmentTooLarge: '追加する添付ファイルは1件16 MiB、合計25 MiBまでです。保存していません。',
    attachmentPathsInvalid: 'attachment_paths にはローカルファイルの絶対パスを指定してください（1通あたり最大10件）。',
    messageTooLarge: 'メールのサイズが大きすぎます。保存していません。',
    sourceNotFound: '返信または転送する元のメールがそのフォルダーに見つかりません。もう一度検索してください。',
    sourceRequired: '返信や転送には元のメールの folder と message_uid が必要です。',
    saveUnknown: '下書きが保存されたか確認できません。もう一度保存する前に下書きフォルダーを確認してください。',
    savedUnverified: '下書きは保存されましたが、読み戻して確認できませんでした。先に下書きを読み込んで確認し、作り直さないでください。',
    savedMismatch: '下書きは保存されましたが、読み戻した内容が想定と異なります。送信する前に下書きを読み込んで確認してください。',
    sendUnknown: 'メールが送信されたか確認できません。送信済みフォルダーを確認し、もう一度送信しないでください。',
    sendRejected: 'メールサーバーがすべての宛先を拒否しました。メールは送信していません。',
    deleteUnknown: '下書きが削除されたか確認できません。下書きフォルダーを確認し、操作を繰り返さないでください。',
    readFailed: '下書きを読み込めませんでした。しばらくしてから再試行してください。',
  },
  ko: {
    fieldsInvalid: '임시 보관 메일 내용이 불완전하거나 크기 제한을 넘었습니다. 저장하지 않았습니다.',
    headersInvalid: '받는 사람, 참조, 숨은 참조 또는 제목 형식이 올바르지 않습니다. 저장하지 않았습니다.',
    recipientRequired: '받는 사람을 한 명 이상 입력하세요. 메일을 보내지 않았습니다.',
    draftIdInvalid: 'draft_id에는 임시 보관 메일을 만들거나 읽을 때 반환된 Message-ID(<id@example.test> 형식)를 지정하세요.',
    draftNotFound: '이 임시 보관 메일이 임시 보관함에 없습니다. 이미 보냈거나 삭제했거나 다른 곳에서 변경했을 수 있습니다. 임시 보관함을 다시 검색하세요.',
    draftNoMessageId: '이 임시 보관 메일에는 Message-ID가 없어 카드에서 편집할 수 없습니다. 메일함에서 여세요.',
    draftChanged: '메일함에서 임시 보관 메일이 변경되었습니다. 최신 내용을 확인한 후 계속하세요.',
    notEditable: '이 임시 보관 메일은 여기에서 완전히 편집할 수 없습니다(예: 서명 또는 암호화된 메일). 메일함에서 처리하세요.',
    attachmentListInvalid: '첨부 파일 목록이 올바르지 않거나 알 수 없는 첨부 파일이 있습니다. 저장하지 않았습니다.',
    attachmentUnreadable: '첨부 파일이 없거나, 읽을 수 없거나, 일반 파일이 아니거나, 선택한 뒤 변경되었습니다. 저장하지 않았습니다.',
    attachmentTooLarge: '새 첨부 파일은 파일당 16 MiB, 합계 25 MiB까지입니다. 저장하지 않았습니다.',
    attachmentPathsInvalid: 'attachment_paths에는 로컬 파일 절대 경로 목록을 지정하세요(메일당 최대 10개).',
    messageTooLarge: '메일이 너무 큽니다. 저장하지 않았습니다.',
    sourceNotFound: '답장하거나 전달할 원본 메일을 해당 폴더에서 찾을 수 없습니다. 다시 검색하세요.',
    sourceRequired: '답장이나 전달에는 원본 메일의 folder와 message_uid가 필요합니다.',
    saveUnknown: '임시 보관 메일이 저장되었는지 확인할 수 없습니다. 다시 저장하기 전에 임시 보관함을 확인하세요.',
    savedUnverified: '임시 보관 메일은 저장했지만 다시 읽어 확인하지 못했습니다. 먼저 임시 보관 메일을 읽어 확인하고 다시 만들지 마세요.',
    savedMismatch: '임시 보관 메일은 저장했지만 다시 읽은 내용이 예상과 다릅니다. 보내기 전에 임시 보관 메일을 읽어 확인하세요.',
    sendUnknown: '메일이 전송되었는지 확인할 수 없습니다. 보낸 편지함을 확인하고 다시 보내지 마세요.',
    sendRejected: '메일 서버가 모든 받는 사람을 거부했습니다. 메일을 보내지 않았습니다.',
    deleteUnknown: '임시 보관 메일이 삭제되었는지 확인할 수 없습니다. 임시 보관함을 확인하고 작업을 반복하지 마세요.',
    readFailed: '임시 보관 메일을 읽지 못했습니다. 잠시 후 다시 시도하세요.',
  },
});

function localeOf(value) {
  if (typeof value !== 'string') return 'en';
  if (/^zh/i.test(value)) return 'zh-CN';
  const base = value.slice(0, 2).toLowerCase();
  return MESSAGES[base] ? base : 'en';
}
function text(locale, key) {
  return MESSAGES[localeOf(locale)][key] || MESSAGES.en[key];
}
class ComposeError extends Error {
  constructor(key) { super(key); this.composeKey = key; }
}
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const escapeHtml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const normalizeNewlines = (value) => String(value || '').replace(/\r\n?/g, '\n');
const bareCid = (value) => String(value || '').trim().replace(/^<|>$/g, '');

// Plain text is not Markdown. Each line becomes a block so paragraph breaks and
// signatures survive in HTML clients; reading it back recognises plain drafts.
function textToHtml(value) {
  return '<div dir="auto">' + normalizeNewlines(value).split('\n')
    .map((line) => '<div>' + (escapeHtml(line) || '<br>') + '</div>').join('') + '</div>';
}
// Cindy's SDK uses this wrapper when a draft has no HTML part of its own.
function sdkTextHtml(value) {
  return '<div>' + value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</div>';
}
function quoteBlock(innerHtml, attributionHtml) {
  return QUOTE_HTML_MARK + ' style="margin-top:1em">' + (attributionHtml || '') + BLOCKQUOTE + innerHtml + '</blockquote></div>';
}

function parseAddresses(value) {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > MAX_FIELD) throw new ComposeError('headersInvalid');
  if (!value.trim()) return [];
  const flat = [];
  const walk = (items) => items.forEach((item) => (item.group ? walk(item.group) : flat.push(item)));
  walk(addressparser(value.replace(/;/g, ',')));
  if (flat.length > 100 || flat.some((item) => !EMAIL_RE.test(item.address || ''))) throw new ComposeError('headersInvalid');
  return flat.map((item) => ({ name: item.name || '', address: item.address }));
}
function formatAddress(item) {
  if (!item.name) return item.address;
  const name = /^[\w .'-]+$/u.test(item.name) ? item.name : '"' + item.name.replace(/["\\]/g, '\\$&') + '"';
  return name + ' <' + item.address + '>';
}
const addressKey = (value) => parseAddresses(value).map((item) => item.address.toLowerCase()).sort().join(',');
function headerAddresses(parsed, name) {
  const value = parsed[name];
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const flat = [];
  const walk = (items) => items.forEach((item) => (item.group ? walk(item.group) : item.address && flat.push({ name: item.name || '', address: item.address })));
  list.forEach((entry) => walk(entry.value || []));
  return flat;
}
const addressList = (items) => items.map(formatAddress).join(', ');

function referencesOf(parsed) {
  const value = parsed.references;
  return (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/) : []).filter((id) => DRAFT_ID_RE.test(id));
}
function rootContentType(parsed) {
  const value = parsed.headers && typeof parsed.headers.get === 'function' ? parsed.headers.get('content-type') : null;
  return String((value && value.value) || value || '').toLowerCase();
}

// Signed/encrypted messages cannot be rebuilt without breaking them.
function supportedType(parsed) {
  return !/^multipart\/(signed|encrypted)|^application\/(pkcs7|x-pkcs7)-mime/.test(rootContentType(parsed));
}
function snapshotAttachments(parsed) {
  const seen = new Map();
  let previewBytes = 0;
  return (parsed.attachments || []).map((attachment) => {
    const content = Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.alloc(0);
    const digest = sha256(content);
    const index = seen.get(digest) || 0;
    seen.set(digest, index + 1);
    const mimeType = String(attachment.contentType || 'application/octet-stream').toLowerCase();
    const cid = bareCid(attachment.cid);
    const item = {
      // Content-addressed, so renaming or (re)assigning a Content-ID keeps the key.
      key: digest.slice(0, 40) + '-' + index,
      filename: attachment.filename || '',
      mimeType,
      bytes: content.length,
      contentId: cid && attachment.contentDisposition !== 'attachment' ? cid : '',
      sha256: digest,
    };
    if (/^image\/(png|jpeg|gif|webp)$/.test(mimeType) && content.length <= MAX_PREVIEW_IMAGE
      && previewBytes + content.length <= MAX_PREVIEW_TOTAL) {
      previewBytes += content.length;
      item.inlineData = content.toString('base64');
    }
    return item;
  });
}

function draftEditor(bodyText, bodyHtml, supported) {
  const htmlAt = bodyHtml.indexOf(QUOTE_HTML_MARK);
  const textMatch = QUOTE_TEXT_RE.exec(bodyText);
  // Only split Cindy's own paired quote layout; unknown layouts stay intact.
  const split = textMatch && (htmlAt >= 0 || !bodyHtml);
  const body = split ? bodyText.slice(0, textMatch.index) : bodyText;
  const quote = split ? bodyText.slice(textMatch.index) : '';
  const html = split && htmlAt >= 0 ? bodyHtml.slice(0, htmlAt) : bodyHtml;
  const quoteHtml = split && htmlAt >= 0 ? bodyHtml.slice(htmlAt) : '';
  return {
    format: !html || html === textToHtml(body) ? 'text' : 'html',
    body, quote, bodyHtml: html, quoteHtml,
    editable: supported && Boolean(bodyText || !bodyHtml),
  };
}

function createMailCompose(env) {
  // env: { email, withImap(fn), withMailbox(client, folder, fn), findDraftFolder(client),
  //        createSmtp(), createComposer(), parseMessage(buffer), maxSourceBytes, describeError(error, locale) }
  const self = env.email.toLowerCase();
  const domain = self.split('@')[1];

  async function download(client, uid) {
    const downloaded = await client.download(String(uid), undefined, { uid: true, maxBytes: env.maxSourceBytes + 1 });
    if (!downloaded || !downloaded.content) return null;
    const chunks = [];
    let size = 0;
    for await (const chunk of downloaded.content) {
      size += chunk.length;
      if (size > env.maxSourceBytes) {
        if (typeof downloaded.content.destroy === 'function') downloaded.content.destroy();
        throw new ComposeError('messageTooLarge');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  }

  function snapshot(parsed, raw, draftId, locator) {
    const bodyText = normalizeNewlines(typeof parsed.text === 'string' ? parsed.text : '').replace(/\n+$/, '');
    const bodyHtml = typeof parsed.html === 'string' ? parsed.html : '';
    const supported = supportedType(parsed);
    return {
      status: 'read_back',
      draftId,
      fingerprint: sha256(raw),
      locator,
      headers: {
        from: addressList(headerAddresses(parsed, 'from')),
        to: addressList(headerAddresses(parsed, 'to')),
        cc: addressList(headerAddresses(parsed, 'cc')),
        bcc: addressList(headerAddresses(parsed, 'bcc')),
        subject: parsed.subject || '',
      },
      editor: draftEditor(bodyText, bodyHtml, supported),
      attachments: snapshotAttachments(parsed),
    };
  }

  async function readAt(client, folder, uid, draftId) {
    const raw = await download(client, uid);
    if (!raw) return null;
    const parsed = await env.parseMessage(raw);
    if (parsed.messageId !== draftId) return null;
    return { raw, parsed, uid: Number(uid),
      locator: { folder, uid: Number(uid), uidValidity: String(client.mailbox && client.mailbox.uidValidity) } };
  }

  async function findCopies(client, draftId) {
    let uids = [];
    try {
      uids = (await client.search({ header: { 'message-id': draftId } }, { uid: true })) || [];
    } catch (_error) {
      uids = [];
    }
    if (!uids.length) {
      // Some servers do not index Message-ID; scan the newest drafts' envelopes.
      const exists = client.mailbox && Number(client.mailbox.exists);
      if (exists > 0) {
        const range = Math.max(1, exists - DRAFT_SCAN_LIMIT + 1) + ':*';
        for await (const message of client.fetch(range, { uid: true, envelope: true, flags: true })) {
          const flags = message.flags ? Array.from(message.flags) : [];
          if (message.envelope && message.envelope.messageId === draftId && !flags.includes('\\Deleted')) uids.push(message.uid);
        }
      }
    }
    return uids.map(Number).filter((uid) => Number.isInteger(uid) && uid > 0).sort((a, b) => b - a);
  }

  // Run inside the Drafts mailbox lock. Prefer the recorded UID, then search.
  async function locate(client, folder, draftId, locator) {
    if (locator && locator.folder === folder && Number.isInteger(Number(locator.uid))
      && String(locator.uidValidity) === String(client.mailbox && client.mailbox.uidValidity)) {
      const found = await readAt(client, folder, locator.uid, draftId);
      if (found) return found;
    }
    for (const uid of await findCopies(client, draftId)) {
      const found = await readAt(client, folder, uid, draftId);
      if (found) return found;
    }
    return null;
  }

  async function inDrafts(locator, operation) {
    return env.withImap(async (client) => {
      const folder = locator && typeof locator.folder === 'string' && locator.folder
        ? locator.folder : await env.findDraftFolder(client);
      return env.withMailbox(client, folder, () => operation(client, folder));
    });
  }

  async function buildRaw(options) {
    const composer = env.createComposer();
    try {
      const info = await composer.sendMail({
        ...options,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (!info || !Buffer.isBuffer(info.message)) throw new ComposeError('fieldsInvalid');
      return info.message;
    } finally {
      if (composer && typeof composer.close === 'function') composer.close();
    }
  }

  // Reply headers, Message-ID and the From identity of a stored revision.
  function headerMeta(parsed) {
    const from = headerAddresses(parsed, 'from');
    const replyTo = headerAddresses(parsed, 'replyTo');
    return {
      from: from.length === 1 && from[0].address.toLowerCase() === self ? formatAddress(from[0]) : env.email,
      replyTo: addressList(replyTo),
      inReplyTo: DRAFT_ID_RE.test(parsed.inReplyTo || '') ? parsed.inReplyTo : '',
      references: referencesOf(parsed),
    };
  }
  function messageOptions(meta, draftId, content) {
    return {
      from: meta.from,
      to: content.to, cc: content.cc, bcc: content.bcc,
      subject: content.subject,
      messageId: draftId,
      date: new Date(),
      ...(meta.replyTo ? { replyTo: meta.replyTo } : {}),
      ...(meta.inReplyTo ? { inReplyTo: meta.inReplyTo } : {}),
      ...(meta.references.length ? { references: meta.references } : {}),
      text: content.text,
      ...(content.html ? { html: content.html } : {}),
      attachments: content.files.map((file) => ({
        filename: file.filename || undefined,
        content: file.content,
        contentType: file.mimeType,
        ...(file.contentId ? { cid: file.contentId } : {}),
        contentDisposition: file.contentId ? 'inline' : 'attachment',
      })),
    };
  }

  // Host-picked card files ({path, filename, bytes, sha256, contentId}) and
  // agent paths ({path}) are read once, bounded, without following symlinks.
  async function loadFiles(descriptors) {
    if (!Array.isArray(descriptors)) throw new ComposeError('attachmentListInvalid');
    let total = 0;
    const files = [];
    for (const item of descriptors) {
      if (!item || typeof item.path !== 'string' || !path.isAbsolute(item.path) || /[\r\n\0]/.test(item.path)) {
        throw new ComposeError('attachmentUnreadable');
      }
      let handle;
      try {
        const link = await fs.lstat(item.path);
        if (!link.isFile()) throw new ComposeError('attachmentUnreadable');
        handle = await fs.open(item.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0) | (fsConstants.O_NONBLOCK || 0));
        const stat = await handle.stat();
        if (!stat.isFile()) throw new ComposeError('attachmentUnreadable');
        if (stat.size > MAX_NEW_FILE || total + stat.size > MAX_NEW_TOTAL) throw new ComposeError('attachmentTooLarge');
        const content = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < stat.size) {
          const { bytesRead } = await handle.read(content, offset, stat.size - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        const extra = await handle.read(Buffer.alloc(1), 0, 1, offset);
        if (offset !== stat.size || extra.bytesRead) throw new ComposeError('attachmentUnreadable');
        if ((item.bytes !== undefined && item.bytes !== content.length)
          || (item.sha256 !== undefined && item.sha256 !== sha256(content))) throw new ComposeError('attachmentUnreadable');
        total += content.length;
        const filename = typeof item.filename === 'string' && item.filename && !/[\r\n\0/\\]/.test(item.filename)
          ? item.filename : path.basename(item.path);
        const contentId = item.contentId === undefined ? '' : bareCid(item.contentId);
        if (contentId && !/^[^<>\s@]+@[^<>\s@]+$/.test(contentId)) throw new ComposeError('attachmentListInvalid');
        files.push({ filename, content, mimeType: mimeFor(filename, item.mimeType), contentId });
      } catch (error) {
        if (error instanceof ComposeError) throw error;
        throw new ComposeError('attachmentUnreadable');
      } finally {
        if (handle) await handle.close().catch(() => undefined);
      }
    }
    return files;
  }

  function parsedFiles(parsed) {
    const meta = snapshotAttachments(parsed);
    return (parsed.attachments || []).map((attachment, index) => ({
      key: meta[index].key,
      filename: meta[index].filename,
      mimeType: meta[index].mimeType,
      contentId: meta[index].contentId,
      content: Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.alloc(0),
    }));
  }

  const facts = (files) => JSON.stringify(files.map((file) => [file.filename || '', String(file.mimeType || '').toLowerCase(),
    file.bytes !== undefined ? file.bytes : file.content.length, bareCid(file.contentId), file.sha256 || sha256(file.content)]).sort());

  // Append the next revision, remove older copies, read it back and verify it.
  async function saveRevision(client, folder, current, draftId, content, execution, locale, meta) {
    const raw = await buildRaw(messageOptions(meta || headerMeta(current.parsed), draftId, content));
    if (raw.length > env.maxSourceBytes) throw new ComposeError('messageTooLarge');
    execution.state = 'unknown';
    const appended = await client.append(folder, raw, ['\\Draft', '\\Seen'], new Date());
    execution.state = 'executed';
    const unverified = { ok: false, execution: 'executed', message: text(locale, 'savedUnverified') };
    let saved = null;
    try {
      if (appended && appended.uid) saved = await readAt(client, folder, appended.uid, draftId);
      if (!saved) {
        const latest = (await findCopies(client, draftId)).find((uid) => !current || uid !== current.uid);
        if (latest) saved = await readAt(client, folder, latest, draftId);
      }
    } catch (_error) {
      saved = null;
    }
    if (!saved) return unverified;
    const readBack = snapshot(saved.parsed, saved.raw, draftId, saved.locator);
    const actual = { to: readBack.headers.to, cc: readBack.headers.cc, bcc: readBack.headers.bcc };
    const sameText = (a, b) => normalizeNewlines(a).replace(/\s+$/, '') === normalizeNewlines(b).replace(/\s+$/, '');
    if (['to', 'cc', 'bcc'].some((name) => addressKey(actual[name]) !== addressKey(content[name] || ''))
      || readBack.headers.subject !== content.subject.trim()
      || !sameText(readBack.editor.body + readBack.editor.quote, content.text)
      || normalizeNewlines(typeof saved.parsed.html === 'string' ? saved.parsed.html : '').trim() !== normalizeNewlines(content.html || '').trim()
      || facts(parsedFiles(saved.parsed)) !== facts(content.files)) {
      // The previous revision stays: it is the last complete copy. Drop only the
      // mismatched new one (best effort) so a later lookup cannot pick it.
      if (current) await client.messageDelete(String(saved.uid), { uid: true }).catch(() => undefined);
      return { ok: false, execution: 'executed', message: text(locale, 'savedMismatch') };
    }
    // Older revisions are removed only after the new one is readable and verified.
    // A failed removal leaves a duplicate; later lookups always pick the newest UID.
    const older = (await findCopies(client, draftId).catch(() => [])).filter((uid) => uid !== saved.uid);
    if (current && !older.includes(current.uid)) older.push(current.uid);
    if (older.length) await client.messageDelete(older.join(','), { uid: true }).catch(() => undefined);
    return { ok: true, execution: 'executed', data: { draftId, readBack } };
  }

  function validateFields(fields) {
    const names = ['to', 'cc', 'bcc', 'subject', 'body', 'quote'];
    const rich = fields && typeof fields.bodyHtml === 'string';
    if (rich) names.push('bodyHtml', 'quoteHtml', 'attachmentItems');
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)
      || names.some((name) => typeof fields[name] !== 'string' || fields[name].includes('\0')
        || fields[name].length > (name.endsWith('Html') ? MAX_HTML_FIELD : MAX_FIELD))) {
      throw new ComposeError('fieldsInvalid');
    }
    for (const name of ['to', 'cc', 'bcc']) parseAddresses(fields[name]);
    if (/[\r\n]/.test(fields.subject) || fields.subject.length > 998) throw new ComposeError('headersInvalid');
    return rich;
  }

  // Map card fields onto MIME content, keeping untouched HTML byte-for-byte.
  function contentFromFields(before, fields, rich, additions) {
    const editor = before.editor;
    const original = {
      body: editor.body, quote: editor.quote,
      bodyHtml: editor.bodyHtml || sdkTextHtml(editor.body), quoteHtml: editor.quoteHtml,
    };
    const htmlless = !editor.bodyHtml && !editor.quoteHtml;
    let bodyHtml;
    if (rich && (editor.format === 'html' || fields.bodyHtml !== original.bodyHtml)) bodyHtml = fields.bodyHtml;
    else if (fields.body === original.body) bodyHtml = htmlless ? '' : editor.bodyHtml;
    else bodyHtml = htmlless ? '' : textToHtml(fields.body);
    let quoteHtml;
    if (rich && fields.quoteHtml !== original.quoteHtml) quoteHtml = fields.quoteHtml;
    else if (fields.quote === original.quote) quoteHtml = editor.quoteHtml;
    else quoteHtml = htmlless || !fields.quote ? '' : quoteBlock(textToHtml(fields.quote.replace(/^\n+/, '')));
    let files = parsedFiles(before.parsed);
    if (rich) {
      let wanted;
      try { wanted = JSON.parse(fields.attachmentItems); } catch (_error) { throw new ComposeError('attachmentListInvalid'); }
      if (!Array.isArray(wanted) || wanted.some((item) => !item || typeof item.key !== 'string')) throw new ComposeError('attachmentListInvalid');
      const keys = new Set();
      files = wanted.map((item) => {
        const file = files.find((candidate) => candidate.key === item.key);
        if (!file || keys.has(item.key)) throw new ComposeError('attachmentListInvalid');
        keys.add(item.key);
        const filename = typeof item.filename === 'string' && item.filename && !/[\r\n\0/\\]/.test(item.filename) ? item.filename : file.filename;
        const contentId = typeof item.contentId === 'string' ? bareCid(item.contentId) : file.contentId;
        if (contentId && !/^[^<>\s]+$/.test(contentId)) throw new ComposeError('attachmentListInvalid');
        return { ...file, filename, contentId };
      });
    }
    files = files.concat(additions);
    const html = bodyHtml + quoteHtml;
    return {
      to: fields.to, cc: fields.cc, bcc: fields.bcc, subject: fields.subject,
      text: fields.body + fields.quote,
      html: html || (additions.some((file) => file.contentId) ? textToHtml(fields.body) : ''),
      files,
    };
  }

  function sameContent(before, content) {
    const parsedHtml = typeof before.parsed.html === 'string' ? before.parsed.html : '';
    const beforeText = before.editor.body + before.editor.quote;
    return content.to === before.headers.to && content.cc === before.headers.cc && content.bcc === before.headers.bcc
      && content.subject === before.headers.subject && normalizeNewlines(content.text) === normalizeNewlines(beforeText)
      && (content.html || '') === parsedHtml && facts(content.files) === facts(parsedFiles(before.parsed));
  }

  async function sendRevision(current, draftId, execution, locale, client) {
    const headers = current.readBack.headers;
    const recipients = ['to', 'cc', 'bcc'].flatMap((name) => parseAddresses(headers[name]).map((item) => item.address));
    if (!recipients.length) throw new ComposeError('recipientRequired');
    const parsedHtml = typeof current.parsed.html === 'string' ? current.parsed.html : '';
    // Bcc recipients travel only in the SMTP envelope, never in the message.
    const raw = await buildRaw(messageOptions(headerMeta(current.parsed), draftId, {
      to: headers.to, cc: headers.cc, bcc: '', subject: headers.subject,
      text: current.readBack.editor.body + current.readBack.editor.quote,
      html: parsedHtml, files: parsedFiles(current.parsed),
    }));
    const transporter = env.createSmtp();
    let info;
    try {
      execution.state = 'unknown';
      info = await transporter.sendMail({ envelope: { from: env.email, to: [...new Set(recipients)] }, raw });
      execution.state = 'executed';
    } catch (error) {
      // An envelope rejection happens before DATA: nothing was accepted.
      if (error && error.code === 'EENVELOPE' && !(error.accepted && error.accepted.length)) {
        execution.state = 'not_executed';
        return { ok: false, execution: 'not_executed', message: text(locale, 'sendRejected') };
      }
      return { ok: false, execution: 'unknown', message: text(locale, 'sendUnknown') };
    } finally {
      if (transporter && typeof transporter.close === 'function') transporter.close();
    }
    // The send succeeded. Removing the draft is best effort and never changes that.
    let draftRemoved = false;
    try {
      const copies = await findCopies(client, draftId);
      if (!copies.includes(current.uid)) copies.push(current.uid);
      await client.messageDelete(copies.join(','), { uid: true });
      draftRemoved = true;
    } catch (_error) {
      draftRemoved = false;
    }
    return { ok: true, execution: 'executed', data: { sent: true, draftId, receipt: {
      messageId: draftId,
      accepted: Array.isArray(info && info.accepted) ? info.accepted.map(String).slice(0, 100) : [],
      rejected: Array.isArray(info && info.rejected) ? info.rejected.map(String).slice(0, 100) : [],
      delivery_confirmed: false,
      draftRemoved,
    } } };
  }

  async function guarded(locale, execution, operation) {
    try {
      return await operation();
    } catch (error) {
      if (execution.state === 'unknown') return { ok: false, execution: 'unknown', message: text(locale, execution.unknownKey || 'saveUnknown') };
      if (execution.state === 'executed') return { ok: false, execution: 'executed', message: text(locale, 'savedUnverified') };
      const message = error instanceof ComposeError ? text(locale, error.composeKey) : env.describeError(error, locale);
      return { ok: false, execution: 'not_executed', message };
    }
  }

  function checkDraftId(draftId) {
    if (typeof draftId !== 'string' || !DRAFT_ID_RE.test(draftId)) throw new ComposeError('draftIdInvalid');
  }

  async function readDraft({ draftId, locator }, locale) {
    const execution = { state: 'not_executed' };
    return guarded(locale, execution, async () => {
      checkDraftId(draftId);
      return inDrafts(locator, async (client, folder) => {
        const current = await locate(client, folder, draftId, locator);
        if (!current) throw new ComposeError('draftNotFound');
        return { ok: true, data: { draftId, readBack: snapshot(current.parsed, current.raw, draftId, current.locator) } };
      });
    });
  }

  async function writeDraft({ draftId, locator, fingerprint, fields, send, attachments }, locale) {
    const execution = { state: 'not_executed' };
    return guarded(locale, execution, async () => {
      checkDraftId(draftId);
      if (typeof fingerprint !== 'string' || typeof send !== 'boolean') throw new ComposeError('fieldsInvalid');
      const rich = validateFields(fields);
      const additions = await loadFiles(attachments || []);
      return inDrafts(locator, async (client, folder) => {
        let current = await locate(client, folder, draftId, locator);
        if (!current) throw new ComposeError('draftNotFound');
        current.readBack = snapshot(current.parsed, current.raw, draftId, current.locator);
        current.headers = current.readBack.headers;
        current.editor = current.readBack.editor;
        if (current.readBack.fingerprint !== fingerprint) {
          return { ok: false, execution: 'not_executed', stale: current.readBack, message: text(locale, 'draftChanged') };
        }
        if (!current.editor.editable && !rich) throw new ComposeError('notEditable');
        if (!supportedType(current.parsed)) throw new ComposeError('notEditable');
        const content = contentFromFields(current, fields, rich, additions);
        if (send && !['to', 'cc', 'bcc'].some((name) => parseAddresses(content[name]).length)) throw new ComposeError('recipientRequired');
        if (!sameContent(current, content)) {
          const saved = await saveRevision(client, folder, current, draftId, content, execution, locale);
          if (!saved.ok || !send) return saved;
          const reread = await locate(client, folder, draftId, saved.data.readBack.locator);
          if (!reread) return { ok: false, execution: 'executed', message: text(locale, 'savedUnverified') };
          current = reread;
          current.readBack = saved.data.readBack;
        }
        if (!send) return { ok: true, execution: 'not_executed', data: { draftId, readBack: current.readBack } };
        execution.unknownKey = 'sendUnknown';
        return sendRevision(current, draftId, execution, locale, client);
      });
    });
  }

  async function deleteDraft({ draftId, locator }, locale) {
    const execution = { state: 'not_executed', unknownKey: 'deleteUnknown' };
    return guarded(locale, execution, async () => {
      checkDraftId(draftId);
      return inDrafts(locator, async (client, folder) => {
        const current = await locate(client, folder, draftId, locator);
        if (!current) throw new ComposeError('draftNotFound');
        const copies = await findCopies(client, draftId);
        if (!copies.includes(current.uid)) copies.push(current.uid);
        execution.state = 'unknown';
        await client.messageDelete(copies.join(','), { uid: true });
        execution.state = 'executed';
        return { ok: true, execution: 'executed', data: { deleted: true, draftId } };
      });
    });
  }

  // Agent-side changes: only supplied values change; card fields stay intact.
  async function updateDraft(action, locale) {
    const execution = { state: 'not_executed' };
    return guarded(locale, execution, async () => {
      checkDraftId(action.draft_id);
      const additions = await loadFiles(agentPaths(action.attachment_paths));
      return inDrafts(action.locator, async (client, folder) => {
        const current = await locate(client, folder, action.draft_id, action.locator);
        if (!current) throw new ComposeError('draftNotFound');
        const readBack = snapshot(current.parsed, current.raw, action.draft_id, current.locator);
        Object.assign(current, { readBack, headers: readBack.headers, editor: readBack.editor });
        // Signed/encrypted drafts cannot be rebuilt without breaking them.
        if (!supportedType(current.parsed)) throw new ComposeError('notEditable');
        if (!readBack.editor.editable && action.body_html === undefined && action.body_text !== undefined) throw new ComposeError('notEditable');
        const htmlOnly = action.body_html !== undefined && action.body_text === undefined;
        const fields = {
          to: action.to !== undefined ? joinRecipients(action.to) : readBack.headers.to,
          cc: action.cc !== undefined ? joinRecipients(action.cc) : readBack.headers.cc,
          bcc: action.bcc !== undefined ? joinRecipients(action.bcc) : readBack.headers.bcc,
          subject: action.subject !== undefined ? action.subject : readBack.headers.subject,
          // An HTML-only update must not leave the old plain-text alternative behind.
          body: action.body_text !== undefined ? normalizeNewlines(action.body_text)
            : htmlOnly ? htmlToText(action.body_html) : readBack.editor.body,
          quote: readBack.editor.quote,
          bodyHtml: action.body_html !== undefined ? action.body_html
            : action.body_text !== undefined ? textToHtml(action.body_text) : readBack.editor.bodyHtml || sdkTextHtml(readBack.editor.body),
          quoteHtml: readBack.editor.quoteHtml,
          attachmentItems: JSON.stringify(readBack.attachments.map((item) => ({ key: item.key, filename: item.filename, contentId: item.contentId }))),
        };
        if (typeof fields.subject !== 'string' || typeof fields.bodyHtml !== 'string') throw new ComposeError('fieldsInvalid');
        validateFields(fields);
        const content = contentFromFields(current, fields, true, additions);
        if (sameContent(current, content)) return { ok: true, execution: 'not_executed', data: { draftId: action.draft_id, readBack } };
        return saveRevision(client, folder, current, action.draft_id, content, execution, locale);
      });
    });
  }

  function joinRecipients(value) {
    if (Array.isArray(value)) return value.map(String).join(', ');
    if (typeof value === 'string') return value;
    throw new ComposeError('headersInvalid');
  }
  function agentPaths(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_AGENT_FILES || value.some((item) => typeof item !== 'string')) {
      throw new ComposeError('attachmentPathsInvalid');
    }
    return value.map((file) => ({ path: file }));
  }

  // New message, reply, reply-all or forward. Defaults follow the common flow:
  // reply-all excludes this account, duplicates and the original Bcc.
  async function createDraft(action, locale) {
    const execution = { state: 'not_executed' };
    return guarded(locale, execution, async () => {
      const mode = action.mode || 'new';
      if (!['new', 'reply', 'reply_all', 'forward'].includes(mode)) throw new ComposeError('fieldsInvalid');
      if (action.body_text !== undefined && typeof action.body_text !== 'string') throw new ComposeError('fieldsInvalid');
      if (action.body_html !== undefined && (typeof action.body_html !== 'string' || action.body_html.length > MAX_HTML_FIELD)) throw new ComposeError('fieldsInvalid');
      // An HTML-only body still needs its plain-text alternative.
      const body = (action.body_text !== undefined || action.body_html === undefined
        ? normalizeNewlines(action.body_text || '') : htmlToText(action.body_html)).replace(/\n+$/, '');
      if (body.length > MAX_FIELD) throw new ComposeError('fieldsInvalid');
      const additions = await loadFiles(agentPaths(action.attachment_paths));
      return env.withImap(async (client) => {
        let source = null;
        if (mode !== 'new') {
          const uid = Number(action.source_uid);
          if (typeof action.source_folder !== 'string' || !action.source_folder || !Number.isInteger(uid) || uid <= 0) {
            throw new ComposeError('sourceRequired');
          }
          source = await env.withMailbox(client, action.source_folder, async () => {
            const raw = await download(client, uid);
            return raw ? env.parseMessage(raw) : null;
          });
          if (!source) throw new ComposeError('sourceNotFound');
        }
        const draftId = '<' + crypto.randomUUID() + '@' + domain + '>';
        const plan = composePlan(mode, source, action, body, additions);
        const folder = await env.findDraftFolder(client);
        return env.withMailbox(client, folder, async () => {
          for (const name of ['to', 'cc', 'bcc']) parseAddresses(plan[name]);
          if (typeof plan.subject !== 'string' || /[\r\n]/.test(plan.subject) || plan.subject.length > 998) throw new ComposeError('headersInvalid');
          const content = { to: plan.to, cc: plan.cc, bcc: plan.bcc, subject: plan.subject, text: plan.text, html: plan.html, files: plan.files };
          const meta = { from: env.email, replyTo: '', inReplyTo: plan.inReplyTo, references: plan.references };
          const saved = await saveRevision(client, folder, null, draftId, content, execution, locale, meta);
          if (saved.ok) return { ok: true, execution: 'executed', data: { draft: true, draftId, readBack: saved.data.readBack } };
          if (saved.execution === 'executed') {
            return { ok: true, execution: 'executed', data: { draft: true, draftId,
              readBack: { status: 'unavailable', message: saved.message } } };
          }
          return saved;
        });
      });
    });
  }

  function composePlan(mode, source, action, body, additions) {
    const pick = (name, fallback) => (action[name] !== undefined ? joinRecipients(action[name]) : fallback);
    let to = '';
    let cc = '';
    let subject = typeof action.subject === 'string' ? action.subject : '';
    let quoteText = '';
    let quoteHtml = '';
    let inReplyTo = '';
    let references = [];
    let files = [];
    if (source) {
      const sourceText = normalizeNewlines(typeof source.text === 'string' ? source.text : '').replace(/\n+$/, '');
      const sourceHtml = typeof source.html === 'string' ? htmlFragment(source.html) : textToHtml(sourceText);
      const fromText = addressList(headerAddresses(source, 'from')) || 'unknown sender';
      const date = source.date instanceof Date && !Number.isNaN(source.date.getTime()) ? source.date.toUTCString() : '';
      const sourceFiles = parsedFiles(source);
      if (mode === 'forward') {
        if (action.subject === undefined) subject = /^\s*(fwd?|转发)\s*[:：]/i.test(source.subject || '') ? source.subject : 'Fwd: ' + (source.subject || '');
        const lines = ['---------- Forwarded message ---------', 'From: ' + fromText, 'Date: ' + date,
          'Subject: ' + (source.subject || ''), 'To: ' + addressList(headerAddresses(source, 'to'))];
        const cc0 = addressList(headerAddresses(source, 'cc'));
        if (cc0) lines.push('Cc: ' + cc0);
        quoteText = '\n\n' + lines.join('\n') + '\n\n' + sourceText;
        quoteHtml = QUOTE_HTML_MARK + ' style="margin-top:1em">' + lines.map((line) => '<div>' + escapeHtml(line) + '</div>').join('')
          + '<br>' + sourceHtml + '</div>';
        files = sourceFiles;
      } else {
        if (action.subject === undefined) subject = /^\s*(re|回复|答复)\s*[:：]/i.test(source.subject || '') ? source.subject : 'Re: ' + (source.subject || '');
        const attribution = 'On ' + (date || 'an earlier date') + ', ' + fromText + ' wrote:';
        quoteText = '\n\n' + attribution + '\n' + sourceText.split('\n').map((line) => '> ' + line).join('\n');
        quoteHtml = quoteBlock(sourceHtml, '<div dir="auto">' + escapeHtml(attribution) + '</div>');
        // Keep the quoted message's inline pictures, not its file attachments.
        const cids = new Set((sourceHtml.match(/cid:[^"'\s)>]+/gi) || []).map((ref) => bareCid(decodeSafe(ref.slice(4)))));
        files = sourceFiles.filter((file) => file.contentId && cids.has(file.contentId));
        inReplyTo = DRAFT_ID_RE.test(source.messageId || '') ? source.messageId : '';
        references = [...new Set([...referencesOf(source), ...(inReplyTo ? [inReplyTo] : [])])];
        const replyTo = headerAddresses(source, 'replyTo');
        const from = headerAddresses(source, 'from');
        let primary = replyTo.length ? replyTo : from;
        if (primary.length && primary.every((item) => item.address.toLowerCase() === self)) primary = headerAddresses(source, 'to');
        const seen = new Set([self]);
        const unique = (items) => items.filter((item) => {
          const key = item.address.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        to = addressList(unique(primary));
        if (mode === 'reply_all') cc = addressList(unique([...headerAddresses(source, 'to'), ...headerAddresses(source, 'cc')]));
      }
    }
    // The draft card holds at most 16,000 text / 64,000 HTML characters per field,
    // measured on the HTML actually produced (newlines and escapes expand it). A
    // longer quoted message is shortened to a plain-text quote until it fits; an
    // own body that cannot fit is refused before anything is written.
    const bodyHtml = action.body_html !== undefined ? action.body_html : textToHtml(body);
    if (body.length > MAX_FIELD || bodyHtml.length > MAX_HTML_FIELD) throw new ComposeError('fieldsInvalid');
    if (quoteText.length > MAX_FIELD || quoteHtml.length > MAX_HTML_FIELD) {
      const full = quoteText;
      for (let limit = 12000; ; limit = Math.floor(limit * 0.6)) {
        quoteText = full.slice(0, limit).replace(/\s+$/, '') + '\n…';
        quoteHtml = quoteBlock(textToHtml(quoteText.trim()));
        if (quoteHtml.length <= MAX_HTML_FIELD || limit < 200) break;
      }
      if (mode !== 'forward') files = [];
    }
    const html = bodyHtml + quoteHtml;
    return {
      to: pick('to', to), cc: pick('cc', cc), bcc: pick('bcc', ''), subject,
      text: body + quoteText, html, inReplyTo, references, files: files.concat(additions),
    };
  }

  return { readDraft, writeDraft, deleteDraft, updateDraft, createDraft };
}

function decodeSafe(value) {
  try { return decodeURIComponent(value); } catch (_error) { return value; }
}
// Drop every script element, scanning tags instead of pattern-matching them, so
// split or oddly spaced end tags cannot leave a script start behind.
function stripScripts(html) {
  const lower = html.toLowerCase();
  const nameEnd = (at) => !/[a-z0-9:_-]/.test(lower[at] || '');
  let out = '';
  let index = 0;
  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt < 0) { out += html.slice(index); break; }
    out += html.slice(index, lt);
    const open = lower.startsWith('<script', lt) && nameEnd(lt + 7);
    const close = lower.startsWith('</script', lt) && nameEnd(lt + 8);
    if (!open && !close) { out += '<'; index = lt + 1; continue; }
    let end = lt;
    if (open) {
      end = lower.indexOf('</script', lt + 7);
      if (end < 0) break; // unterminated script: drop the remainder
    }
    const gt = html.indexOf('>', end);
    if (gt < 0) break;
    index = gt + 1;
  }
  return out;
}
// Quote only the body of a full HTML document; keep its styles, drop scripts.
function htmlFragment(html) {
  const styles = (html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []).join('');
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const inner = body ? styles + body[1] : html.replace(/<!doctype[^>]*>|<\/?(?:html|head|body)\b[^>]*>|<meta\b[^>]*>|<title\b[^>]*>[\s\S]*?<\/title>/gi, '');
  return stripScripts(inner);
}
// End of the tag starting at `start`; a ">" inside a quoted attribute value does not end it.
function tagEnd(source, start) {
  let quote = '';
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index];
    if (quote) { if (char === quote) quote = ''; } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return index;
  }
  return -1;
}
// Plain-text alternative for an HTML fragment (fallback only; never sent as HTML).
function htmlToText(html) {
  const source = stripScripts(html);
  const lower = source.toLowerCase();
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  let out = '';
  let index = 0;
  while (index < source.length) {
    const lt = source.indexOf('<', index);
    out += source.slice(index, lt < 0 ? source.length : lt);
    if (lt < 0) break;
    const gt = tagEnd(source, lt);
    if (gt < 0) break;
    const tag = /^<\/?([a-z][a-z0-9]*)/.exec(lower.slice(lt, gt + 1));
    const name = tag ? tag[1] : '';
    if (name === 'style' && lower[lt + 1] !== '/') {
      const close = lower.indexOf('</style', gt);
      index = close < 0 ? source.length : (source.indexOf('>', close) < 0 ? source.length : source.indexOf('>', close) + 1);
      continue;
    }
    if (name === 'br' || lower[lt + 1] === '/' && ['p', 'div', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'].includes(name)) out += '\n';
    index = gt + 1;
  }
  return out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return Object.hasOwn(entities, entity.toLowerCase()) ? entities[entity.toLowerCase()] : all;
  }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const MIME_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', html: 'text/html', json: 'application/json',
  zip: 'application/zip', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg', mp4: 'video/mp4', mov: 'video/quicktime', ics: 'text/calendar', eml: 'message/rfc822',
};
function mimeFor(filename, declared) {
  if (typeof declared === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(declared)) return declared.toLowerCase();
  const extension = /\.([a-z0-9]+)$/i.exec(filename || '');
  return (extension && MIME_TYPES[extension[1].toLowerCase()]) || 'application/octet-stream';
}

module.exports = { createMailCompose, textToHtml, MESSAGES };
