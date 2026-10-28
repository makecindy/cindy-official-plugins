'use strict';
// Fixed Gmail endpoints, request-local Host OAuth token. This module updates
// drafts only; sending remains owned by cindyMail's confirmation/countdown.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const MAX_BYTES = 25 * 1024 * 1024;
const header = (part, name) => (part.headers || []).filter(h => h.name.toLowerCase() === name).map(h => h.value).join('\n');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const keyFor = part => hash(JSON.stringify([part.partId || '', part.filename || '', part.mimeType, part.body?.size, header(part, 'content-id')]));
// Inline/CID are presentation metadata, not proof of an attached file. Body
// containers (and their text alternatives) still need traversal. Explicit file
// names/attachment disposition stop traversal. Every other MIME type is an
// opaque file, even when Gmail omits its filename/disposition (notably .eml).
function isAttachmentPart(part) {
  const disposition = header(part, 'content-disposition');
  const bodyPart = /^multipart\//i.test(part.mimeType) || /^text\/(plain|html)$/i.test(part.mimeType);
  return Boolean(part.filename || /^attachment\b/i.test(disposition) || !bodyPart);
}
// Inspect URL positions, never visible text, comments or code samples. All
// create/update/retention paths share this extractor; it does not rewrite HTML.
function referencedContentIds(html, locale) {
  const ids = new Set();
  const add = value => {
    const match = /^cid:(.+)$/i.exec(value.trim());
    if (!match) return;
    try { ids.add(decodeURIComponent(match[1])); }
    catch (_) { throw new Error(workerMessage(locale, 'cidInvalid')); }
  };
  const entities = value => value.replace(/&(?:#(x[0-9a-f]+|\d+);?|([a-z]+);)/gi, (all, number, name) => {
    if (!number) return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', colon: ':', commat: '@' })[name] ?? all;
    const point = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
  });
  const css = value => {
    // Consume strings/comments as tokens so content:"url(cid:example)" is text.
    for (const m of value.matchAll(/\/\*[\s\S]*?(?:\*\/|$)|\burl\(\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s)'"\\]+))\s*\)|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/gi)) {
      if (m[1] !== undefined || m[2] !== undefined || m[3] !== undefined) add(m[1] ?? m[2] ?? m[3]);
    }
  };
  // Keep quoted '>' inside a tag, and consume raw-text elements as a whole so
  // example markup in textarea/script cannot create phantom references.
  const tokens = /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)(?:<\/\1\s*>|$)|<[a-z][\w:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  for (const token of html.matchAll(tokens)) {
    if (token[0].startsWith('<!--')) continue;
    if (token[1]?.toLowerCase() === 'style') css(token[3]);
    const opening = token[1] ? token[2] : token[0].replace(/^<[\w:-]+|>$/g, '');
    for (const attr of opening.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const name = attr[1].toLowerCase(), value = entities(attr[2] ?? attr[3] ?? attr[4] ?? '');
      if (name === 'style') css(value);
      else if (name === 'srcset') {
        // URLs end at whitespace, not at every comma (data URLs contain commas).
        let cursor = 0;
        while (cursor < value.length) {
          while (/[\s,]/.test(value[cursor] || '') && cursor < value.length) cursor++;
          const start = cursor;
          while (cursor < value.length && !/\s/.test(value[cursor])) cursor++;
          const url = value.slice(start, cursor);
          add(url.replace(/,+$/, ''));
          if (url.endsWith(',')) continue;
          let depth = 0;
          while (cursor < value.length) {
            const ch = value[cursor++];
            if (ch === '(') depth++;
            else if (ch === ')') depth = Math.max(0, depth - 1);
            else if (ch === ',' && !depth) break;
          }
        }
      } else if (['src', 'href', 'xlink:href', 'background', 'poster', 'data'].includes(name)) add(value);
    }
  }
  return ids;
}
// Worker results reach the Agent and the mail card verbatim. main.js passes the
// Host locale (docs/localization.md) with every request as params.locale; the
// worker keeps no locale state of its own. Missing or unsupported means English.
const MESSAGES = {
  'zh-CN': {
    draftNotSaved: '草稿未保存，邮件尚未发送。请检查附件、正文和 Gmail 插件详情页中的账号授权后重试。',
    draftSavedReceiptUnverified: '草稿已保存但未发送：无法完整核对 Gmail 回执，请先重新读取或到 Gmail 检查，不要重复创建、保存或发送。',
    draftSaveUnknown: '无法确认草稿保存结果，邮件尚未发送。请先核对 Gmail 草稿，不要重复创建或保存。',
    composeFieldsIncomplete: '邮件尚未发送：草稿字段不完整，请重新打开草稿。',
    composeReadFailed: '邮件尚未发送：无法读取当前草稿，请先到 Gmail 核对。',
    draftChangedReview: '草稿已在其他地方修改，请检查更新后的内容再发送。',
    draftChangedVerify: '草稿已在其他地方修改，请重新核对后再发送。',
    composeHeadersInvalid: '邮件尚未发送：请检查收件人地址和主题，不能包含换行。',
    composeHtmlDraft: '邮件尚未发送：此草稿包含 HTML，请由 AI 更新 HTML 草稿后重新预览。',
    attachmentListInvalid: '附件清单无效，请重新读取草稿。',
    inlineImagesNotPreserved: '草稿包含内嵌图片，当前编辑器无法完整保留图片引用。请在 Gmail 修改后重新读取；原草稿未更改。',
    draftSavedReadBackUnverified: '草稿已保存但未发送：无法完整核对读回内容或附件，请先重新读取或到 Gmail 检查，不要重复保存或发送。',
    draftSaveUnconfirmed: '无法确认草稿保存结果，请先重新读取核对，邮件尚未发送。',
    draftSavedNoReadBack: '草稿已保存但未发送：无法读回确认，请先到 Gmail 检查。',
    draftSavedMismatch: '草稿已保存但未发送：读回内容、收件人或附件不一致，请先到 Gmail 检查。',
    draftAttachmentsUnverified: '无法核对草稿附件，草稿未修改。请重新读取后重试。',
    htmlDraftFieldsOnly: '此 HTML 草稿仅支持更新收件人、主题、正文和附件，草稿未修改。',
    richDraftBodyPair: '更新此图文草稿时，请同时提供 body 和 body-html（或对应文件），以保留图片和纯文本版本。',
    tooManyAttachments: '附件过多，草稿未修改。',
    messageTooLarge: '邮件内容超过大小上限',
    draftBodyCharset: '不支持草稿正文的字符编码，请在邮箱中编辑此草稿。',
    draftBodyDecode: '无法无损解码草稿正文，请在邮箱中编辑此草稿。',
    cidInvalid: '正文图片引用无效，请检查 CID 地址后再保存。',
    bodyIncomplete: '无法完整读取邮件正文',
    bodySizeMismatch: '邮件正文大小不一致',
    draftBodyIncomplete: '无法完整读取草稿正文',
    attachmentItemsInvalid: '附件清单无效，请重新读取草稿',
    attachmentsModified: '附件已发生变化，请重新读取草稿',
    attachmentReadIncomplete: '无法完整读取附件，草稿未修改',
    attachmentSizeInvalid: '附件大小不一致或超过 25 MiB，草稿未修改',
    imageReferenceInvalid: '图片引用无效',
    onlyImagesInline: '只能将图片附件插入正文',
    attachmentNameInvalid: '附件名称无效',
    newAttachmentsInvalid: '附件清单无效',
    attachmentInvalidReselect: '附件无效，请重新选择',
    attachmentChangedReselect: '附件已变化，请重新选择',
    attachmentsTotalTooLarge: '附件总大小不能超过 25 MiB',
    imageTypeRequired: '请选择 PNG、JPEG、GIF 或 WebP 图片',
    imageReferenceDuplicate: '图片引用重复，请重新读取草稿',
    removedImageReferenced: '正文仍引用已移除的图片，请先在正文中删除图片',
    attachmentUnverifiable: '附件内容无法核对',
    attachmentSizeMismatch: '附件大小不一致',
    attachmentContentTooLarge: '附件内容超过大小上限',
  },
  en: {
    draftNotSaved: 'Draft not saved; the message has not been sent. Check the attachments, the body and the account authorization in the Gmail plugin details, then try again.',
    draftSavedReceiptUnverified: 'Draft saved but not sent: could not fully verify the Gmail receipt. Read it again or check Gmail first; do not create, save or send it again.',
    draftSaveUnknown: 'Could not confirm whether the draft was saved; the message has not been sent. Check the Gmail drafts first; do not create or save it again.',
    composeFieldsIncomplete: 'Message not sent: the draft fields are incomplete. Reopen the draft.',
    composeReadFailed: 'Message not sent: could not read the current draft. Check it in Gmail first.',
    draftChangedReview: 'The draft was changed elsewhere. Review the updated content before sending.',
    draftChangedVerify: 'The draft was changed elsewhere. Verify it again before sending.',
    composeHeadersInvalid: 'Message not sent: check the recipient addresses and subject; they cannot contain line breaks.',
    composeHtmlDraft: 'Message not sent: this draft contains HTML. Have the AI update the HTML draft, then preview it again.',
    attachmentListInvalid: 'Invalid attachment list. Read the draft again.',
    inlineImagesNotPreserved: 'The draft contains inline images, and this editor cannot fully preserve their references. Edit it in Gmail, then read it again; the original draft was not changed.',
    draftSavedReadBackUnverified: 'Draft saved but not sent: could not fully verify the read-back content or attachments. Read it again or check Gmail first; do not save or send it again.',
    draftSaveUnconfirmed: 'Could not confirm whether the draft was saved. Read it again to verify first; the message has not been sent.',
    draftSavedNoReadBack: 'Draft saved but not sent: could not read it back to confirm. Check Gmail first.',
    draftSavedMismatch: 'Draft saved but not sent: the read-back content, recipients or attachments do not match. Check Gmail first.',
    draftAttachmentsUnverified: 'Could not verify the draft attachments; the draft was not changed. Read it again, then retry.',
    htmlDraftFieldsOnly: 'This HTML draft only supports updating recipients, subject, body and attachments; the draft was not changed.',
    richDraftBodyPair: 'When updating this rich draft, provide both body and body-html (or their file variants) to keep the images and the plain-text version.',
    tooManyAttachments: 'Too many attachments; the draft was not changed.',
    messageTooLarge: 'Message content exceeds the size limit',
    draftBodyCharset: 'The draft body uses an unsupported character encoding. Edit this draft in your mailbox.',
    draftBodyDecode: 'Could not decode the draft body losslessly. Edit this draft in your mailbox.',
    cidInvalid: 'Invalid image reference in the body. Check the CID address before saving.',
    bodyIncomplete: 'Could not read the full message body',
    bodySizeMismatch: 'Message body size mismatch',
    draftBodyIncomplete: 'Could not read the full draft body',
    attachmentItemsInvalid: 'Invalid attachment list. Read the draft again',
    attachmentsModified: 'The attachments were modified. Read the draft again',
    attachmentReadIncomplete: 'Could not read the full attachment; the draft was not changed',
    attachmentSizeInvalid: 'Attachment size mismatch or over 25 MiB; the draft was not changed',
    imageReferenceInvalid: 'Invalid image reference',
    onlyImagesInline: 'Only image attachments can be inserted into the body',
    attachmentNameInvalid: 'Invalid attachment name',
    newAttachmentsInvalid: 'Invalid attachment list',
    attachmentInvalidReselect: 'Invalid attachment. Select it again',
    attachmentChangedReselect: 'Attachment has changed. Select it again',
    attachmentsTotalTooLarge: 'Total attachment size cannot exceed 25 MiB',
    imageTypeRequired: 'Select a PNG, JPEG, GIF or WebP image',
    imageReferenceDuplicate: 'Duplicate image reference. Read the draft again',
    removedImageReferenced: 'The body still references a removed image. Delete the image from the body first',
    attachmentUnverifiable: 'Could not verify the attachment content',
    attachmentSizeMismatch: 'Attachment size mismatch',
    attachmentContentTooLarge: 'Attachment content exceeds the size limit',
  },
  ja: {
    draftNotSaved: '下書きは保存されておらず、メールも送信されていません。添付ファイル、本文、Gmail プラグインの詳細ページにあるアカウントの認証を確認してから再試行してください。',
    draftSavedReceiptUnverified: '下書きは保存されましたが、送信されていません：Gmail の応答を完全には確認できませんでした。まず読み込み直すか Gmail で確認し、作成、保存、送信を繰り返さないでください。',
    draftSaveUnknown: '下書きが保存されたか確認できません。メールは送信されていません。まず Gmail の下書きを確認し、作成や保存を繰り返さないでください。',
    composeFieldsIncomplete: 'メールは送信されていません：下書きの項目が不足しています。下書きを開き直してください。',
    composeReadFailed: 'メールは送信されていません：現在の下書きを読み込めません。まず Gmail で確認してください。',
    draftChangedReview: '下書きが別の場所で変更されました。更新後の内容を確認してから送信してください。',
    draftChangedVerify: '下書きが別の場所で変更されました。もう一度確認してから送信してください。',
    composeHeadersInvalid: 'メールは送信されていません：宛先アドレスと件名を確認してください。改行は含められません。',
    composeHtmlDraft: 'メールは送信されていません：この下書きには HTML が含まれています。AI に HTML 下書きを更新させてから、もう一度プレビューしてください。',
    attachmentListInvalid: '添付ファイルの一覧が無効です。下書きを読み込み直してください。',
    inlineImagesNotPreserved: '下書きにインライン画像が含まれており、このエディターでは画像の参照を完全には保持できません。Gmail で編集してから読み込み直してください。元の下書きは変更されていません。',
    draftSavedReadBackUnverified: '下書きは保存されましたが、送信されていません：読み込み直した内容や添付ファイルを完全には確認できませんでした。まず読み込み直すか Gmail で確認し、保存や送信を繰り返さないでください。',
    draftSaveUnconfirmed: '下書きが保存されたか確認できません。まず読み込み直して確認してください。メールは送信されていません。',
    draftSavedNoReadBack: '下書きは保存されましたが、送信されていません：読み込み直して確認できませんでした。まず Gmail で確認してください。',
    draftSavedMismatch: '下書きは保存されましたが、送信されていません：読み込み直した内容、宛先、添付ファイルが一致しません。まず Gmail で確認してください。',
    draftAttachmentsUnverified: '下書きの添付ファイルを確認できません。下書きは変更されていません。読み込み直してから再試行してください。',
    htmlDraftFieldsOnly: 'この HTML 下書きで更新できるのは宛先、件名、本文、添付ファイルのみです。下書きは変更されていません。',
    richDraftBodyPair: 'この画像付き下書きを更新するときは、画像とプレーンテキスト版を保持するため、body と body-html（または対応するファイル）を両方指定してください。',
    tooManyAttachments: '添付ファイルが多すぎます。下書きは変更されていません。',
    messageTooLarge: 'メールの内容がサイズ上限を超えています',
    draftBodyCharset: '下書き本文の文字エンコーディングには対応していません。この下書きはメールボックスで編集してください。',
    draftBodyDecode: '下書き本文を欠落なくデコードできません。この下書きはメールボックスで編集してください。',
    cidInvalid: '本文の画像参照が無効です。CID アドレスを確認してから保存してください。',
    bodyIncomplete: 'メール本文をすべて読み込めませんでした',
    bodySizeMismatch: 'メール本文のサイズが一致しません',
    draftBodyIncomplete: '下書き本文をすべて読み込めませんでした',
    attachmentItemsInvalid: '添付ファイルの一覧が無効です。下書きを読み込み直してください',
    attachmentsModified: '添付ファイルが変更されています。下書きを読み込み直してください',
    attachmentReadIncomplete: '添付ファイルをすべて読み込めませんでした。下書きは変更されていません',
    attachmentSizeInvalid: '添付ファイルのサイズが一致しないか、25 MiB を超えています。下書きは変更されていません',
    imageReferenceInvalid: '画像参照が無効です',
    onlyImagesInline: '本文に挿入できるのは画像の添付ファイルのみです',
    attachmentNameInvalid: '添付ファイル名が無効です',
    newAttachmentsInvalid: '添付ファイルの一覧が無効です',
    attachmentInvalidReselect: '添付ファイルが無効です。選び直してください',
    attachmentChangedReselect: '添付ファイルが変更されています。選び直してください',
    attachmentsTotalTooLarge: '添付ファイルの合計サイズは 25 MiB を超えられません',
    imageTypeRequired: 'PNG、JPEG、GIF、WebP のいずれかの画像を選んでください',
    imageReferenceDuplicate: '画像参照が重複しています。下書きを読み込み直してください',
    removedImageReferenced: '本文が削除済みの画像をまだ参照しています。先に本文から画像を削除してください',
    attachmentUnverifiable: '添付ファイルの内容を確認できません',
    attachmentSizeMismatch: '添付ファイルのサイズが一致しません',
    attachmentContentTooLarge: '添付ファイルの内容がサイズ上限を超えています',
  },
  ko: {
    draftNotSaved: '초안이 저장되지 않았고 메일도 전송되지 않았습니다. 첨부 파일, 본문, Gmail 플러그인 상세 페이지의 계정 인증을 확인한 후 다시 시도하세요.',
    draftSavedReceiptUnverified: '초안은 저장되었지만 전송되지 않았습니다: Gmail 응답을 완전히 확인할 수 없습니다. 먼저 다시 읽거나 Gmail에서 확인하고, 생성, 저장 또는 전송을 반복하지 마세요.',
    draftSaveUnknown: '초안 저장 여부를 확인할 수 없습니다. 메일은 전송되지 않았습니다. 먼저 Gmail 초안을 확인하고, 생성이나 저장을 반복하지 마세요.',
    composeFieldsIncomplete: '메일이 전송되지 않았습니다: 초안 항목이 불완전합니다. 초안을 다시 여세요.',
    composeReadFailed: '메일이 전송되지 않았습니다: 현재 초안을 읽을 수 없습니다. 먼저 Gmail에서 확인하세요.',
    draftChangedReview: '초안이 다른 곳에서 수정되었습니다. 업데이트된 내용을 확인한 후 전송하세요.',
    draftChangedVerify: '초안이 다른 곳에서 수정되었습니다. 다시 확인한 후 전송하세요.',
    composeHeadersInvalid: '메일이 전송되지 않았습니다: 받는 사람 주소와 제목을 확인하세요. 줄바꿈은 포함할 수 없습니다.',
    composeHtmlDraft: '메일이 전송되지 않았습니다: 이 초안에는 HTML이 포함되어 있습니다. AI가 HTML 초안을 업데이트하게 한 후 다시 미리 보세요.',
    attachmentListInvalid: '첨부 파일 목록이 올바르지 않습니다. 초안을 다시 읽으세요.',
    inlineImagesNotPreserved: '초안에 인라인 이미지가 포함되어 있어 현재 편집기에서는 이미지 참조를 완전히 유지할 수 없습니다. Gmail에서 수정한 후 다시 읽으세요. 원래 초안은 변경되지 않았습니다.',
    draftSavedReadBackUnverified: '초안은 저장되었지만 전송되지 않았습니다: 다시 읽은 내용이나 첨부 파일을 완전히 확인할 수 없습니다. 먼저 다시 읽거나 Gmail에서 확인하고, 저장이나 전송을 반복하지 마세요.',
    draftSaveUnconfirmed: '초안 저장 여부를 확인할 수 없습니다. 먼저 다시 읽어 확인하세요. 메일은 전송되지 않았습니다.',
    draftSavedNoReadBack: '초안은 저장되었지만 전송되지 않았습니다: 다시 읽어 확인할 수 없습니다. 먼저 Gmail에서 확인하세요.',
    draftSavedMismatch: '초안은 저장되었지만 전송되지 않았습니다: 다시 읽은 내용, 받는 사람 또는 첨부 파일이 일치하지 않습니다. 먼저 Gmail에서 확인하세요.',
    draftAttachmentsUnverified: '초안 첨부 파일을 확인할 수 없습니다. 초안은 변경되지 않았습니다. 다시 읽은 후 다시 시도하세요.',
    htmlDraftFieldsOnly: '이 HTML 초안은 받는 사람, 제목, 본문, 첨부 파일만 업데이트할 수 있습니다. 초안은 변경되지 않았습니다.',
    richDraftBodyPair: '이 이미지 포함 초안을 업데이트할 때는 이미지와 일반 텍스트 버전을 유지하도록 body와 body-html(또는 해당 파일)을 함께 제공하세요.',
    tooManyAttachments: '첨부 파일이 너무 많습니다. 초안은 변경되지 않았습니다.',
    messageTooLarge: '메일 내용이 크기 제한을 초과합니다',
    draftBodyCharset: '초안 본문의 문자 인코딩을 지원하지 않습니다. 이 초안은 메일함에서 편집하세요.',
    draftBodyDecode: '초안 본문을 손실 없이 디코딩할 수 없습니다. 이 초안은 메일함에서 편집하세요.',
    cidInvalid: '본문의 이미지 참조가 올바르지 않습니다. CID 주소를 확인한 후 저장하세요.',
    bodyIncomplete: '메일 본문 전체를 읽을 수 없습니다',
    bodySizeMismatch: '메일 본문 크기가 일치하지 않습니다',
    draftBodyIncomplete: '초안 본문 전체를 읽을 수 없습니다',
    attachmentItemsInvalid: '첨부 파일 목록이 올바르지 않습니다. 초안을 다시 읽으세요',
    attachmentsModified: '첨부 파일이 변경되었습니다. 초안을 다시 읽으세요',
    attachmentReadIncomplete: '첨부 파일 전체를 읽을 수 없습니다. 초안은 변경되지 않았습니다',
    attachmentSizeInvalid: '첨부 파일 크기가 일치하지 않거나 25 MiB를 초과합니다. 초안은 변경되지 않았습니다',
    imageReferenceInvalid: '이미지 참조가 올바르지 않습니다',
    onlyImagesInline: '본문에는 이미지 첨부 파일만 삽입할 수 있습니다',
    attachmentNameInvalid: '첨부 파일 이름이 올바르지 않습니다',
    newAttachmentsInvalid: '첨부 파일 목록이 올바르지 않습니다',
    attachmentInvalidReselect: '첨부 파일이 올바르지 않습니다. 다시 선택하세요',
    attachmentChangedReselect: '첨부 파일이 변경되었습니다. 다시 선택하세요',
    attachmentsTotalTooLarge: '첨부 파일의 총 크기는 25 MiB를 초과할 수 없습니다',
    imageTypeRequired: 'PNG, JPEG, GIF 또는 WebP 이미지를 선택하세요',
    imageReferenceDuplicate: '이미지 참조가 중복되었습니다. 초안을 다시 읽으세요',
    removedImageReferenced: '본문이 아직 삭제된 이미지를 참조하고 있습니다. 먼저 본문에서 이미지를 삭제하세요',
    attachmentUnverifiable: '첨부 파일 내용을 확인할 수 없습니다',
    attachmentSizeMismatch: '첨부 파일 크기가 일치하지 않습니다',
    attachmentContentTooLarge: '첨부 파일 내용이 크기 제한을 초과합니다',
  },
};
function workerMessage(locale, key) {
  const table = typeof locale === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, locale) ? MESSAGES[locale] : MESSAGES.en;
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : MESSAGES.en[key];
}
// Return only fixed, safe guidance across worker boundaries; never forward an
// arbitrary decoder/provider exception (which may contain private input).
function draftBodyErrorMessage(error, locale) {
  switch (error?.code) {
    case 'DRAFT_BODY_CHARSET': return workerMessage(locale, 'draftBodyCharset');
    case 'DRAFT_BODY_DECODE': return workerMessage(locale, 'draftBodyDecode');
    default: return '';
  }
}
function decodeMimeBody(part, locale) {
  const match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/i.exec(header(part, 'content-type'));
  let decoder;
  try { decoder = new TextDecoder(match ? (match[1] ?? match[2] ?? match[3]) : 'utf-8', { fatal: true }); }
  catch (_) { throw Object.assign(new Error(draftBodyErrorMessage({ code: 'DRAFT_BODY_CHARSET' }, locale)), { code: 'DRAFT_BODY_CHARSET' }); }
  try { return decoder.decode(Buffer.from(part.body.data, 'base64url')); }
  catch (_) { throw Object.assign(new Error(draftBodyErrorMessage({ code: 'DRAFT_BODY_DECODE' }, locale)), { code: 'DRAFT_BODY_DECODE' }); }
}
function imageType(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString())) return 'image/gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return '';
}

async function gmailJson(token, resource, init = {}, maxBytes = MAX_BYTES * 2, locale) {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + resource, {
    ...init, redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    // A received rejection is authoritative even if discarding its body fails.
    // Request timeout/client-close and server errors cannot exclude a write.
    const execution = response.status >= 400 && response.status < 500 && ![408, 499].includes(response.status)
      ? 'not_executed' : 'unknown';
    try { await response.body?.cancel(); } catch (_) { /* Keep the HTTP receipt. */ }
    throw Object.assign(new Error('Gmail HTTP ' + response.status), { execution, status: response.status });
  }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) throw new Error(workerMessage(locale, 'messageTooLarge')); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    // The successful status survives parse/size/stream failure of its receipt.
    throw Object.assign(error, { execution: 'executed', status: response.status });
  }
}

function collectAttachments(payload) {
  const result = [];
  function walk(part) {
    if (isAttachmentPart(part)) result.push(part);
    else for (const child of part.parts || []) walk(child);
  }
  walk(payload); return result;
}

// Gmail may store a text body behind an attachmentId. Resolve it before
// fingerprinting or editing; an incomplete body must never look like empty text.
async function loadMessageBodies(message, token, locale) {
  let total = 0;
  async function walk(part) {
    if (isAttachmentPart(part)) return;
    const body = part.body || {};
    if (['text/plain', 'text/html'].includes(part.mimeType) && body.attachmentId && !body.data) {
      if (!Number.isSafeInteger(body.size) || body.size < 0 || total + body.size > MAX_BYTES) throw new Error(workerMessage(locale, 'bodyIncomplete'));
      const loaded = await gmailJson(token, 'messages/' + encodeURIComponent(message.id) + '/attachments/' + encodeURIComponent(body.attachmentId), undefined, undefined, locale);
      if (typeof loaded.data !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(loaded.data)
        || loaded.size !== body.size || Buffer.from(loaded.data, 'base64url').length !== body.size) throw new Error(workerMessage(locale, 'bodySizeMismatch'));
      total += body.size;
      body.data = loaded.data;
    }
    for (const child of part.parts || []) await walk(child);
  }
  if (message?.payload) await walk(message.payload);
}

function buildMime({ fields, headers, files }, helpers) {
  const { addressHeader, encodeWords, encodeHeader, wrap } = helpers;
  const boundary = 'cindy-' + crypto.randomUUID();
  const lines = [];
  for (const [name, value] of Object.entries({ From: headers.from, To: fields.to, Cc: fields.cc, Bcc: fields.bcc, 'Reply-To': headers['reply-to'] })) {
    if (value) lines.push(name + ': ' + addressHeader(value));
  }
  lines.push('Subject: ' + encodeWords(fields.subject));
  for (const name of ['in-reply-to', 'references']) if (headers[name]) lines.push(name + ': ' + encodeHeader(headers[name]));
  lines.push('MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + boundary + '"', '', '--' + boundary,
    'Content-Type: multipart/related; boundary="rel-' + boundary + '"', '', '--rel-' + boundary,
    'Content-Type: multipart/alternative; boundary="alt-' + boundary + '"', '', '--alt-' + boundary,
    'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(fields.body + fields.quote), '', '--alt-' + boundary,
    'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(fields.bodyHtml + fields.quoteHtml), '', '--alt-' + boundary + '--');
  const addFile = (file, delimiter) => {
    const filename = encodeURIComponent(file.filename).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16));
    const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) ? file.mimeType : 'application/octet-stream';
    lines.push('', delimiter, 'Content-Type: ' + contentType, 'Content-Transfer-Encoding: base64',
      'Content-Disposition: ' + (file.contentId ? 'inline' : 'attachment') + "; filename*=UTF-8''" + filename);
    if (file.contentId) lines.push('Content-ID: <' + encodeHeader(file.contentId.replace(/^<|>$/g, '')) + '>');
    lines.push('', wrap(file.data));
  };
  for (const file of files.filter(f => f.contentId)) addFile(file, '--rel-' + boundary);
  lines.push('', '--rel-' + boundary + '--');
  for (const file of files.filter(f => !f.contentId)) addFile(file, '--' + boundary);
  lines.push('', '--' + boundary + '--', '');
  return lines.join('\r\n');
}

async function updateRichDraft(p, token, before, helpers, execution) {
  const locale = p.locale;
  const text = key => workerMessage(locale, key);
  const fields = p.fields;
  const wanted = JSON.parse(fields.attachmentItems);
  if (!Array.isArray(wanted) || wanted.length > 100 || wanted.some(a => !a || typeof a.key !== 'string') || new Set(wanted.map(a => a.key)).size !== wanted.length) throw new Error(text('attachmentItemsInvalid'));
  const current = await gmailJson(token, 'drafts/' + encodeURIComponent(p.draftId) + '?format=full', undefined, undefined, locale);
  await loadMessageBodies(current.message, token, locale);
  const verified = helpers.draftReadBack({ draft: current }, p.draftId, locale);
  if (verified.fingerprint !== before.fingerprint) return { ok: false, execution: 'not_executed', stale: verified, message: text('draftChangedVerify') };
  const parts = collectAttachments(current.message.payload);
  const files = []; let total = 0;
  for (const item of wanted) {
    const part = parts.find(part => keyFor(part) === item.key);
    if (!part) throw new Error(text('attachmentsModified'));
    let encoded = part.body?.data;
    if (encoded === undefined && part.body?.attachmentId) {
      const result = await gmailJson(token, 'messages/' + encodeURIComponent(current.message.id) + '/attachments/' + encodeURIComponent(part.body.attachmentId), undefined, undefined, locale);
      encoded = result.data;
    }
    if (typeof encoded !== 'string') throw new Error(text('attachmentReadIncomplete'));
    const data = Buffer.from(encoded, 'base64url'); total += data.length;
    if (total > MAX_BYTES || data.length !== part.body.size) throw new Error(text('attachmentSizeInvalid'));
    const originalCid = header(part, 'content-id').replace(/^<|>$/g, '');
    const contentId = item.contentId === undefined ? originalCid : item.contentId;
    if (typeof contentId !== 'string') throw new Error(text('imageReferenceInvalid'));
    const cid = contentId.replace(/^<|>$/g, '');
    if (cid !== originalCid && (originalCid || !/^image-[1-9]\d*@cindy\.local$/.test(cid) || !imageType(data))) throw new Error(text('onlyImagesInline'));
    const filename = item.filename ?? part.filename ?? '';
    if (typeof filename !== 'string' || filename.length > 1024 || /[\r\n\0]/.test(filename)) throw new Error(text('attachmentNameInvalid'));
    files.push({ filename, mimeType: cid !== originalCid ? imageType(data) : part.mimeType, contentId: cid, data });
  }
  if (!Array.isArray(p.attachments || []) || (p.attachments || []).length > 20) throw new Error(text('newAttachmentsInvalid'));
  for (const item of p.attachments || []) {
    if (!item || typeof item.path !== 'string' || typeof item.filename !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > 16 * 1024 * 1024) throw new Error(text('attachmentInvalidReselect'));
    const file = await fs.promises.open(item.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let data;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== item.bytes) throw new Error(text('attachmentChangedReselect'));
      data = await file.readFile();
    } finally { await file.close(); }
    if (hash(data) !== item.sha256) throw new Error(text('attachmentChangedReselect'));
    total += data.length;
    if (total > MAX_BYTES) throw new Error(text('attachmentsTotalTooLarge'));
    const mimeType = imageType(data) || 'application/octet-stream';
    if (item.contentId && (!/^image\//.test(mimeType) || !/^[a-f0-9-]+@cindy\.local$/.test(item.contentId))) throw new Error(text('imageTypeRequired'));
    files.push({ filename: item.filename, mimeType, contentId: item.contentId || '', data });
  }
  // Removing an inline attachment must not leave a broken image reference.
  const cids = new Set(files.filter(f => f.contentId).map(f => f.contentId.replace(/^<|>$/g, '')));
  if (cids.size !== files.filter(f => f.contentId).length) throw new Error(text('imageReferenceDuplicate'));
  for (const cid of referencedContentIds(fields.bodyHtml + fields.quoteHtml, locale)) if (!cids.has(cid)) throw new Error(text('removedImageReferenced'));
  const raw = buildMime({ fields, headers: before.headers, files }, helpers);
  // The transport preserves a received write status; without one, do not replay.
  execution.started = true;
  await gmailJson(token, 'drafts/' + encodeURIComponent(p.draftId), { method: 'PUT', body: JSON.stringify({ id: p.draftId, message: { raw: Buffer.from(raw).toString('base64url'), ...(before.threadId ? { threadId: before.threadId } : {}) } }) }, 300 * 1024, locale);
  return { ok: true, files: files.map(f => ({ filename: f.filename, mimeType: f.mimeType, bytes: f.data.length,
    contentId: f.contentId.replace(/^<|>$/g, ''), sha256: hash(f.data) })) };
}
async function verifyDraftAttachmentBytes(token, saved, expected, locale) {
  const text = key => workerMessage(locale, key);
  const actual = [];
  let total = 0;
  for (const file of saved.attachments) {
    let sha256 = file.sha256;
    if (!sha256) {
      if (!file.attachmentId) throw new Error(text('attachmentUnverifiable'));
      const part = await gmailJson(token, 'messages/' + encodeURIComponent(saved.messageId) + '/attachments/' + encodeURIComponent(file.attachmentId), undefined, undefined, locale);
      if (typeof part.data !== 'string') throw new Error(text('attachmentUnverifiable'));
      const data = Buffer.from(part.data, 'base64url');
      if (data.length !== file.bytes) throw new Error(text('attachmentSizeMismatch'));
      sha256 = hash(data);
    }
    total += file.bytes;
    if (total > MAX_BYTES) throw new Error(text('attachmentContentTooLarge'));
    actual.push({ ...file, sha256 });
  }
  const facts = files => JSON.stringify(files.map(f => [f.filename, f.mimeType, f.bytes, (f.contentId || '').replace(/^<|>$/g, ''), f.sha256]).sort());
  return facts(actual) === facts(expected);
}
module.exports = { MESSAGES, workerMessage, updateRichDraft, buildMime, keyFor, isAttachmentPart, referencedContentIds, gmailJson, decodeMimeBody, draftBodyErrorMessage, loadMessageBodies, verifyDraftAttachmentBytes };
