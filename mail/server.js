require('dotenv').config();
const express = require('express');
const ImapFlow = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.MAILBOX_DATA_DIR || path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'yahoo-accounts.json');
const KEY_TEXT = process.env.MAILBOX_ENCRYPTION_KEY || '';

if (!KEY_TEXT) {
  console.error('MAILBOX_ENCRYPTION_KEY is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}
const KEY = Buffer.from(KEY_TEXT, 'hex');
if (KEY.length !== 32) throw new Error('MAILBOX_ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'このローカル版はlocalhostからのアクセスだけを許可しています。' });
  }
  next();
});
app.use(express.static(__dirname));

function readAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
function writeAccounts(accounts) {
  const temp = ACCOUNTS_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  fs.renameSync(temp, ACCOUNTS_FILE);
  try { fs.chmodSync(ACCOUNTS_FILE, 0o600); } catch {}
}
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') };
}
function decrypt(payload) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(payload.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, 'hex')), decipher.final()]).toString('utf8');
}
function publicAccount(a) { return { id: a.id, provider: 'Yahoo!メール', email: a.email, name: a.name, connectedAt: a.connectedAt }; }
function getAccount(id) {
  const account = readAccounts().find(a => a.id === id);
  if (!account) { const err = new Error('アカウントが見つかりません。'); err.status = 404; throw err; }
  return { ...account, password: decrypt(account.secret) };
}
function imapOptions(account) {
  return { host: 'imap.mail.yahoo.co.jp', port: 993, secure: true, auth: { user: account.login, pass: account.password }, logger: false, disableAutoIdle: true };
}
async function verifyYahoo(login, password) {
  const client = new ImapFlow({ host: 'imap.mail.yahoo.co.jp', port: 993, secure: true, auth: { user: login, pass: password }, logger: false, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 15000 });
  await client.connect();
  await client.logout();
  const transporter = nodemailer.createTransport({ host: 'smtp.mail.yahoo.co.jp', port: 465, secure: true, auth: { user: login, pass: password }, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 15000 });
  await transporter.verify();
  transporter.close();
}

app.get('/api/status', (_req, res) => res.json({ ready: true, provider: 'Yahoo! JAPAN Mail', mode: 'local-single-user' }));
app.get('/api/accounts', (_req, res) => res.json(readAccounts().map(publicAccount)));
app.post('/api/yahoo/connect', async (req, res) => {
  const { email, login, password, name } = req.body || {};
  if (!email || !login || !password || !/^\S+@(?:yahoo\.co\.jp|ymail\.ne\.jp)$/i.test(email)) {
    return res.status(400).json({ error: 'Yahoo! JAPANのメールアドレス（@yahoo.co.jp / @ymail.ne.jp）、ログインID、パスワードを確認してください。' });
  }
  if (String(password).length > 512 || String(login).length > 256) return res.status(400).json({ error: '入力内容が長すぎます。' });
  try {
    await verifyYahoo(String(login).trim(), String(password));
    const accounts = readAccounts();
    if (accounts.some(a => a.email.toLowerCase() === String(email).trim().toLowerCase())) return res.status(409).json({ error: 'このメールアドレスはすでに登録されています。' });
    const account = { id: crypto.randomUUID(), email: String(email).trim(), login: String(login).trim(), name: String(name || 'Yahoo!メール').trim().slice(0, 60), secret: encrypt(String(password)), connectedAt: new Date().toISOString() };
    accounts.push(account); writeAccounts(accounts);
    res.status(201).json(publicAccount(account));
  } catch (e) {
    console.error('Yahoo connection failed:', e.message);
    res.status(400).json({ error: 'Yahoo!メールに接続できませんでした。Yahoo!側のIMAP/SMTPアクセス設定、ログインID、パスワードを確認してください。' });
  }
});
app.get('/api/yahoo/:id/messages', async (req, res) => {
  let account;
  try { account = getAccount(req.params.id); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const client = new ImapFlow(imapOptions(account));
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    const messages = [];
    try {
      const total = client.mailbox.exists || 0;
      const latestUid = Math.max(0, (client.mailbox.uidNext || (total + 1)) - 1);
      const start = Math.max(1, latestUid - 49);
      if (total && latestUid >= start) {
        for await (const msg of client.fetch(`${start}:${latestUid}`,  { envelope: true, flags: true, internalDate: true, size: true }, { uid: true })) {
          const e = msg.envelope || {};
          const from = (e.from || []).map(x => x.name || x.address || '').join(', ');
          messages.push({ uid: msg.uid, from, fromEmail: (e.from || []).map(x => x.address || '').join(', '), subject: e.subject || '(件名なし)', date: msg.internalDate ? msg.internalDate.toISOString() : null, unread: !(msg.flags || new Set()).has('\\Seen'), starred: (msg.flags || new Set()).has('\\Flagged'), size: msg.size || 0, snippet: '' });
        }
      }
    } finally { lock.release(); }
    await client.logout();
    messages.reverse();
    res.json({ messages, total: messages.length, note: '最新50件のヘッダー情報です。' });
  } catch (e) {
    try { await client.logout(); } catch {}
    console.error('Yahoo sync failed:', e.message);
    res.status(502).json({ error: 'メールを取得できませんでした。Yahoo!側のアクセス設定や接続状態を確認してください。' });
  }
});
app.get('/api/yahoo/:id/messages/:uid', async (req, res) => {
  let account;
  try { account = getAccount(req.params.id); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const uid = Number(req.params.uid);
  if (!Number.isSafeInteger(uid) || uid < 1) return res.status(400).json({ error: 'メールIDが不正です。' });
  const client = new ImapFlow(imapOptions(account));
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let parsed;
    try {
      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!msg || !msg.source) { lock.release(); await client.logout(); return res.status(404).json({ error: 'メールが見つかりません。' }); }
      parsed = await simpleParser(msg.source);
    } finally { lock.release(); }
    await client.logout();
    res.json({ subject: parsed.subject || '(件名なし)', from: parsed.from?.text || '', date: parsed.date || null, text: parsed.text || '本文をテキストとして表示できません。', htmlAvailable: Boolean(parsed.html) });
  } catch (e) {
    try { await client.logout(); } catch {}
    console.error('Yahoo message read failed:', e.message);
    res.status(502).json({ error: 'メール本文を取得できませんでした。' });
  }
});

app.post('/api/yahoo/:id/send', async (req, res) => {
  let account;
  try { account = getAccount(req.params.id); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const { to, cc, bcc, subject, text } = req.body || {};
  if (!to || !text || String(to).length > 2000 || String(text).length > 100000) return res.status(400).json({ error: '宛先と本文を入力してください。' });
  try {
    const transporter = nodemailer.createTransport({ host: 'smtp.mail.yahoo.co.jp', port: 465, secure: true, auth: { user: account.login, pass: account.password } });
    const info = await transporter.sendMail({ from: account.email, to, cc, bcc, subject: subject || '', text });
    transporter.close();
    res.json({ sent: true, messageId: info.messageId });
  } catch (e) {
    console.error('Yahoo send failed:', e.message);
    res.status(502).json({ error: '送信できませんでした。宛先とYahoo!メールのSMTP設定を確認してください。' });
  }
});
app.delete('/api/yahoo/:id', (req, res) => {
  const accounts = readAccounts();
  const next = accounts.filter(a => a.id !== req.params.id);
  if (next.length === accounts.length) return res.status(404).json({ error: 'アカウントが見つかりません。' });
  writeAccounts(next); res.json({ removed: true });
});
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'サーバー内部エラーが発生しました。' }); });
app.listen(PORT, HOST, () => console.log(`MailBox local server: http://${HOST}:${PORT}`));
