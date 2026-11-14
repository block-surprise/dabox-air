'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const admin = require('firebase-admin');
const ImapFlow = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const { google } = require('googleapis');
const crypto = require('node:crypto');

admin.initializeApp();
const db = admin.firestore();
const app = express();
const PORT = Number(process.env.PORT || 8080);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
const KEY_TEXT = process.env.MAILBOX_ENCRYPTION_KEY || '';
if (!/^[0-9a-f]{64}$/i.test(KEY_TEXT)) throw new Error('MAILBOX_ENCRYPTION_KEY must be 64 hex characters.');
if (!ALLOWED_ORIGINS.length) throw new Error('ALLOWED_ORIGINS must contain the exact frontend origin.');
const KEY = Buffer.from(KEY_TEXT, 'hex');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';
const FRONTEND_URL = process.env.MAILBOX_FRONTEND_URL || '';

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: '許可されていない接続元です。' });
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decrypt(value) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
}
async function requireUser(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'ログインしてください。' });
    req.user = await admin.auth().verifyIdToken(header.slice(7));
    next();
  } catch (_) { res.status(401).json({ error: 'ログイン状態を確認できませんでした。' }); }
}
const collection = (uid, name='mailboxes') => db.collection('users').doc(uid).collection(name);
async function getAccount(uid, id, type='mailboxes') {
  const snap = await collection(uid, type).doc(id).get();
  if (!snap.exists) throw Object.assign(new Error('メールアカウントが見つかりません。'), { status: 404 });
  return { id: snap.id, ...snap.data() };
}
function imapConfig(account) {
  return { host: 'imap.mail.yahoo.co.jp', port: 993, secure: true, auth: { user: account.login, pass: decrypt(account.secret) }, logger: false };
}
function gmailOAuth() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) throw Object.assign(new Error('Gmail OAuthの環境変数が未設定です。'), { status: 503 });
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}
async function gmailClient(uid, id) {
  const account = await getAccount(uid, id, 'gmailMailboxes');
  const auth = gmailOAuth();
  auth.setCredentials({ refresh_token: decrypt(account.refreshToken) });
  return { account, gmail: google.gmail({ version: 'v1', auth }) };
}
function apiError(res, error) {
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'メール処理に失敗しました。しばらくしてから再度お試しください。' });
}
function decodeBody(data='') {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function findTextPart(payload, mimeType) {
  if (!payload) return '';
  if (payload.mimeType === mimeType && payload.body?.data) return decodeBody(payload.body.data);
  for (const part of payload.parts || []) {
    const value = findTextPart(part, mimeType);
    if (value) return value;
  }
  return '';
}
function header(message, name) {
  return (message.payload?.headers || []).find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}
function summarizeGmail(message) {
  return {
    id: message.id, uid: message.id, threadId: message.threadId,
    from: header(message, 'From').replace(/\s*<[^>]*>/, '').replace(/^"|"$/g, '') || '不明な差出人',
    email: (header(message, 'From').match(/<([^>]+)>/) || [])[1] || header(message, 'From'),
    subject: header(message, 'Subject') || '(件名なし)',
    snippet: message.snippet || '',
    date: header(message, 'Date') || '',
    folder: (message.labelIds || []).includes('INBOX') ? 'inbox' : (message.labelIds || []).includes('SENT') ? 'sent' : 'archive',
    unread: (message.labelIds || []).includes('UNREAD'),
    star: (message.labelIds || []).includes('STARRED'),
    accountId: message._accountId, serverGmail: true
  };
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'mailbox-cloud-api' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));

// OAuth callback is public; the random one-time state is bound to the Firebase UID in Firestore.
app.get('/api/gmail/callback', async (req, res) => {
  try {
    if (!FRONTEND_URL) throw new Error('MAILBOX_FRONTEND_URL is not configured.');
    if (req.query.error) return res.redirect(`${FRONTEND_URL}?gmail=denied`);
    const { code, state } = req.query;
    if (typeof code !== 'string' || typeof state !== 'string') throw new Error('OAuth response is incomplete.');
    const stateRef = db.collection('mailboxOAuthStates').doc(state);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists || stateSnap.data().expiresAt.toMillis() < Date.now()) throw new Error('OAuth state is expired or already used.');
    const { uid } = stateSnap.data();
    await stateRef.delete();
    const oauth = gmailOAuth();
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Revoke previous consent and reconnect.');
    oauth.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress;
    const existing = await collection(uid, 'gmailMailboxes').where('email', '==', email).limit(1).get();
    const ref = existing.empty ? collection(uid, 'gmailMailboxes').doc() : existing.docs[0].ref;
    await ref.set({ email, name: email, refreshToken: encrypt(tokens.refresh_token), connectedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.redirect(`${FRONTEND_URL}?gmail=connected`);
  } catch (error) {
    console.error('Gmail OAuth callback failed:', error);
    if (FRONTEND_URL) return res.redirect(`${FRONTEND_URL}?gmail=error`);
    res.status(400).send('Gmail authorization failed.');
  }
});

app.use('/api', requireUser);
app.get('/api/accounts', async (req, res) => {
  try {
    const [yahoo, gmail] = await Promise.all([
      collection(req.user.uid).get(), collection(req.user.uid, 'gmailMailboxes').get()
    ]);
    const yahooAccounts = yahoo.docs.map(doc => ({ id: doc.id, ...doc.data(), provider: 'Yahoo!メール' })).map(({ secret, ...a }) => a);
    const gmailAccounts = gmail.docs.map(doc => ({ id: doc.id, name: doc.data().name, email: doc.data().email, provider: 'Gmail' }));
    res.json([...gmailAccounts, ...yahooAccounts]);
  } catch (error) { apiError(res, error); }
});

app.get('/api/gmail/connect', async (req, res) => {
  try {
    const nonce = crypto.randomBytes(32).toString('hex');
    await db.collection('mailboxOAuthStates').doc(nonce).create({ uid: req.user.uid, expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60_000) });
    const oauth = gmailOAuth();
    const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', include_granted_scopes: true, state: nonce, scope: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'] });
    res.json({ url });
  } catch (error) { apiError(res, error); }
});
app.get('/api/gmail/:id/messages', async (req, res) => {
  try {
    const { gmail } = await gmailClient(req.user.uid, req.params.id);
    const label = { inbox: 'INBOX', starred: 'STARRED', sent: 'SENT', drafts: 'DRAFT', spam: 'SPAM', trash: 'TRASH' }[req.query.folder] || 'INBOX';
    const result = await gmail.users.messages.list({ userId: 'me', labelIds: [label], maxResults: 40 });
    const messages = await Promise.all((result.data.messages || []).map(async item => {
      const response = await gmail.users.messages.get({ userId: 'me', id: item.id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] });
      return summarizeGmail({ ...response.data, _accountId: req.params.id });
    }));
    res.json({ messages });
  } catch (error) { apiError(res, error); }
});
app.get('/api/gmail/:id/messages/:messageId', async (req, res) => {
  try {
    const { gmail } = await gmailClient(req.user.uid, req.params.id);
    const result = await gmail.users.messages.get({ userId: 'me', id: req.params.messageId, format: 'full' });
    const message = result.data;
    res.json({ ...summarizeGmail({ ...message, _accountId: req.params.id }), text: findTextPart(message.payload, 'text/plain') || findTextPart(message.payload, 'text/html') || message.snippet || '' });
  } catch (error) { apiError(res, error); }
});
app.post('/api/gmail/:id/send', async (req, res) => {
  try {
    const { gmail } = await gmailClient(req.user.uid, req.params.id);
    const { to, subject='', text='' } = req.body || {};
    if (typeof to !== 'string' || !/^\S+@\S+\.\S+$/.test(to) || typeof text !== 'string' || text.length > 100_000) return res.status(400).json({ error: '宛先または本文を確認してください。' });
    const raw = [`To: ${to}`, `Subject: ${String(subject).replace(/[\r\n]/g, ' ').slice(0, 998)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(text, 'utf8').toString('base64')].join('\r\n');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(raw).toString('base64url') } });
    res.json({ ok: true });
  } catch (error) { apiError(res, error); }
});
app.delete('/api/gmail/:id', async (req, res) => {
  try { await collection(req.user.uid, 'gmailMailboxes').doc(req.params.id).delete(); res.json({ ok: true }); }
  catch (error) { apiError(res, error); }
});

app.post('/api/yahoo/connect', async (req, res) => {
  const { name, email, login, password } = req.body || {};
  if (!email || !login || !password || !String(email).toLowerCase().endsWith('@yahoo.co.jp')) return res.status(400).json({ error: 'Yahoo! JAPANメールのアドレス、ログインID、パスワードを確認してください。' });
  try {
    const client = new ImapFlow({ host: 'imap.mail.yahoo.co.jp', port: 993, secure: true, auth: { user: login, pass: password }, logger: false });
    await client.connect(); await client.logout();
    const ref = collection(req.user.uid).doc();
    await ref.set({ name: String(name || email).slice(0, 120), email, login, secret: encrypt(password), createdAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ id: ref.id });
  } catch (error) { apiError(res, error); }
});
app.get('/api/yahoo/:id/messages', async (req, res) => {
  let client;
  try {
    const account = await getAccount(req.user.uid, req.params.id);
    client = new ImapFlow(imapConfig(account)); await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const messages = [];
      for await (const item of client.fetch('1:*', { envelope: true, flags: true, uid: true }, { uid: true })) {
        if (messages.length >= 40) break;
        messages.push({ id: item.uid, uid: item.uid, from: item.envelope?.from?.[0]?.name || item.envelope?.from?.[0]?.address || '', email: item.envelope?.from?.[0]?.address || '', subject: item.envelope?.subject || '', snippet: '', date: item.envelope?.date || '', folder: 'inbox', unread: !item.flags?.has('\\Seen'), star: item.flags?.has('\\Flagged'), accountId: req.params.id, serverYahoo: true });
      }
      res.json({ messages: messages.reverse() });
    } finally { lock.release(); }
  } catch (error) { apiError(res, error); }
  finally { if (client?.usable) await client.logout().catch(() => {}); }
});
app.get('/api/yahoo/:id/messages/:uid', async (req, res) => {
  let client;
  try {
    const account = await getAccount(req.user.uid, req.params.id);
    client = new ImapFlow(imapConfig(account)); await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const item = await client.fetchOne(req.params.uid, { source: true, envelope: true }, { uid: true });
      if (!item) return res.status(404).json({ error: 'メールが見つかりません。' });
      const parsed = await simpleParser(item.source);
      res.json({ subject: parsed.subject, from: parsed.from?.text || '', date: parsed.date, text: parsed.text || parsed.html || '' });
    } finally { lock.release(); }
  } catch (error) { apiError(res, error); }
  finally { if (client?.usable) await client.logout().catch(() => {}); }
});
app.post('/api/yahoo/:id/send', async (req, res) => {
  try {
    const account = await getAccount(req.user.uid, req.params.id);
    const { to, subject='', text='' } = req.body || {};
    if (typeof to !== 'string' || !/^\S+@\S+\.\S+$/.test(to) || typeof text !== 'string') return res.status(400).json({ error: '宛先または本文を確認してください。' });
    const transporter = nodemailer.createTransport({ host: 'smtp.mail.yahoo.co.jp', port: 465, secure: true, auth: { user: account.login, pass: decrypt(account.secret) } });
    await transporter.sendMail({ from: account.email, to, subject, text }); res.json({ ok: true });
  } catch (error) { apiError(res, error); }
});
app.delete('/api/yahoo/:id', async (req, res) => {
  try { await collection(req.user.uid).doc(req.params.id).delete(); res.json({ ok: true }); }
  catch (error) { apiError(res, error); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`MailBox API listening on ${PORT}`));
