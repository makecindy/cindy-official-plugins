// In-memory IMAP/SMTP doubles for the shared mail-compose adapter tests.
import { Readable } from 'node:stream';

export class FakeMailbox {
  constructor() {
    this.folders = {
      INBOX: { uidValidity: 700n, uidNext: 1, messages: new Map(), specialUse: undefined },
      Drafts: { uidValidity: 900n, uidNext: 40, messages: new Map(), specialUse: '\\Drafts' },
    };
    this.sent = [];
    this.calls = [];
    this.failures = {};
  }
  add(folder, raw, flags = []) {
    const box = this.folders[folder];
    const uid = box.uidNext++;
    box.messages.set(uid, { raw: Buffer.from(raw), flags: new Set(flags) });
    return uid;
  }
  drafts() { return [...this.folders.Drafts.messages.entries()]; }
  client() { return new FakeImapClient(this); }
  smtp() {
    const mailbox = this;
    return {
      async sendMail(options) {
        mailbox.calls.push('smtp');
        if (mailbox.failures.smtp) throw mailbox.failures.smtp;
        mailbox.sent.push({ envelope: options.envelope, raw: Buffer.from(options.raw) });
        return { accepted: options.envelope.to, rejected: [], messageId: 'smtp-id' };
      },
      close() {},
    };
  }
}

class FakeImapClient {
  constructor(server) { this.server = server; this.mailbox = null; }
  async connect() { this.server.calls.push('connect'); if (this.server.failures.connect) throw this.server.failures.connect; }
  async logout() {}
  close() {}
  async list() {
    return Object.entries(this.server.folders).map(([path, box]) => ({ path, specialUse: box.specialUse }));
  }
  async getMailboxLock(path) {
    const box = this.server.folders[path];
    if (!box) throw new Error('Mailbox not found');
    this.box = box;
    this.mailbox = { path, uidValidity: box.uidValidity, exists: box.messages.size };
    return { release() {} };
  }
  async download(uid) {
    const message = this.box.messages.get(Number(uid));
    if (!message) return null;
    return { meta: { expectedSize: message.raw.length }, content: Readable.from([message.raw]) };
  }
  async search(query) {
    if (this.server.failures.search) return [];
    const id = query.header['message-id'];
    return [...this.box.messages.entries()].filter(([, m]) => !m.flags.has('\\Deleted')
      && new RegExp('^Message-ID: ' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\r?$', 'mi').test(m.raw.toString())).map(([uid]) => uid);
  }
  async *fetch() {
    for (const [uid, m] of this.box.messages) {
      const match = /^Message-ID: (\S+)\r?$/mi.exec(m.raw.toString());
      yield { uid, flags: m.flags, envelope: { messageId: match ? match[1] : undefined } };
    }
  }
  async append(path, raw, flags) {
    this.server.calls.push('append');
    if (this.server.failures.append) throw this.server.failures.append;
    if (this.server.failures.mutateAppend) raw = this.server.failures.mutateAppend(raw);
    const uid = this.server.add(path, raw, flags);
    return this.server.failures.noUidPlus ? {} : { destination: path, uid, uidValidity: this.server.folders[path].uidValidity };
  }
  async messageDelete(range) {
    this.server.calls.push('delete:' + range);
    if (this.server.failures.delete) throw this.server.failures.delete;
    for (const uid of String(range).split(',')) this.box.messages.delete(Number(uid));
    return true;
  }
}
