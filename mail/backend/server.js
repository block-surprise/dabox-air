'use strict';
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const admin = require('firebase-admin');
const ImapFlow = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const crypto = require('node:crypto');

admin.initializeApp();
const db = admin.firestore();
const app = express();
const PORT = Number(process.env.PORT || 8080);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
const KEY_TEXT = process.env.MAILBOX_ENCRYPTION_KEY || '';
if (!/^[0-9a-f]{64}$/i.test(KEY_TEXT)) throw new Error('MAILBOX_ENCRYPTION_KEY must be 64 hex characters.');
if (!ALLOWED_ORIGINS.length) throw new Error('ALLOWED_ORIGINS must contain the exact GitHub Pages origin.');
const KEY = Buffer.from(KEY_TEXT, 'hex');
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((req,res,next)=>{
  res.set('X-Content-Type-Options','nosniff'); res.set('Cache-Control','no-store'); res.set('Referrer-Policy','no-referrer');
  const origin=req.headers.origin;
  if (origin && ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({error:'許可されていない接続元です。'});
  if(origin && ALLOWED_ORIGINS.includes(origin)){res.set('Access-Control-Allow-Origin',origin);res.set('Vary','Origin');res.set('Access-Control-Allow-Headers','Authorization, Content-Type');res.set('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');}
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});
function encrypt(value){const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',KEY,iv);const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return {iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')};}
function decrypt(x){const d=crypto.createDecipheriv('aes-256-gcm',KEY,Buffer.from(x.iv,'base64'));d.setAuthTag(Buffer.from(x.tag,'base64'));return Buffer.concat([d.update(Buffer.from(x.data,'base64')),d.final()]).toString('utf8');}
async function requireUser(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'ログインしてください。'});req.user=await admin.auth().verifyIdToken(h.slice(7));next();}catch(e){return res.status(401).json({error:'ログイン状態を確認できません。'});}}
app.get('/health',(req,res)=>res.json({ok:true,service:'mailbox-cloud-api'}));
app.use('/api', rateLimit({windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false}));
app.use('/api',requireUser);
const collection=uid=>db.collection('users').doc(uid).collection('mailboxes');
async function getAccount(uid,id){const s=await collection(uid).doc(id).get();if(!s.exists)throw Object.assign(new Error('メールアカウントが見つかりません。'),{status:404});return {id:s.id,...s.data(),password:decrypt(s.data().secret)};}
function imapConfig(a){return {host:'imap.mail.yahoo.co.jp',port:993,secure:true,auth:{user:a.login,pass:a.password},logger:false};}
app.get('/api/accounts',async(req,res)=>{try{const s=await collection(req.user.uid).get();res.json(s.docs.map(d=>({id:d.id,...d.data(),provider:'Yahoo!メール'})).map(({secret,...a})=>a));}catch(e){res.status(500).json({error:'アカウント一覧を取得できませんでした。'});}});
app.post('/api/yahoo/connect',async(req,res)=>{const {name,email,login,password}=req.body||{};if(!email||!login||!password||!String(email).toLowerCase().endsWith('@yahoo.co.jp'))return res.status(400).json({error:'@yahoo.co.jpのメールアドレス、ログインID、パスワードを確認してください。'});let client;try{client=new ImapFlow(imapConfig({login,password}));await client.connect();await client.mailboxOpen('INBOX');await client.logout();client=null;const ref=collection(req.user.uid).doc();await ref.set({name:String(name||'Yahoo!メール').slice(0,80),email:String(email).slice(0,254),login:String(login).slice(0,254),provider:'Yahoo!メール',secret:encrypt(String(password)),createdAt:admin.firestore.FieldValue.serverTimestamp()});res.status(201).json({id:ref.id});}catch(e){if(client)try{await client.logout();}catch{};res.status(400).json({error:'Yahoo!メールに接続できませんでした。Yahoo!側のIMAP/SMTP設定とログイン情報を確認してください。'});}});
app.get('/api/yahoo/:id/messages',async(req,res)=>{let client;try{const a=await getAccount(req.user.uid,req.params.id);client=new ImapFlow(imapConfig(a));await client.connect();const lock=await client.getMailboxLock('INBOX');try{const messages=[];const uids=await client.search({all:true},{uid:true});for await(const m of client.fetch(uids.slice(-100),{uid:true,envelope:true,flags:true,internalDate:true,source:true},{uid:true})){const parsed=await simpleParser(m.source);messages.push({uid:m.uid,from:parsed.from?.text||'',fromEmail:parsed.from?.value?.[0]?.address||'',subject:parsed.subject||'(件名なし)',snippet:(parsed.text||'').replace(/\s+/g,' ').slice(0,180),date:m.internalDate,unread:!m.flags?.has('\\Seen'),starred:m.flags?.has('\\Flagged')});}res.json({messages:messages.slice(-100).reverse()});}finally{lock.release();}}catch(e){res.status(e.status||502).json({error:e.status?e.message:'メールを取得できませんでした。'});}finally{if(client)try{await client.logout();}catch{}}});
app.get('/api/yahoo/:id/messages/:uid',async(req,res)=>{let client;try{const a=await getAccount(req.user.uid,req.params.id);client=new ImapFlow(imapConfig(a));await client.connect();const lock=await client.getMailboxLock('INBOX');try{const m=await client.fetchOne(Number(req.params.uid),{uid:true,source:true,internalDate:true},{uid:true});if(!m)return res.status(404).json({error:'メールが見つかりません。'});const p=await simpleParser(m.source);res.json({subject:p.subject||'(件名なし)',from:p.from?.text||'',date:m.internalDate,text:(p.text||'').slice(0,50000)});}finally{lock.release();}}catch(e){res.status(e.status||502).json({error:e.status?e.message:'本文を取得できませんでした。'});}finally{if(client)try{await client.logout();}catch{}}});
app.post('/api/yahoo/:id/send',async(req,res)=>{try{const a=await getAccount(req.user.uid,req.params.id);const {to,subject,text}=req.body||{};if(!to||!/^\S+@\S+\.\S+$/.test(to)||!String(text||'').trim())return res.status(400).json({error:'宛先と本文を入力してください。'});const tx=nodemailer.createTransport({host:'smtp.mail.yahoo.co.jp',port:465,secure:true,auth:{user:a.login,pass:a.password}});await tx.sendMail({from:a.email,to,subject:String(subject||'').slice(0,998),text:String(text).slice(0,50000)});res.json({ok:true});}catch(e){res.status(e.status||502).json({error:e.status?e.message:'メールを送信できませんでした。'});}});
app.delete('/api/yahoo/:id',async(req,res)=>{try{await collection(req.user.uid).doc(req.params.id).delete();res.json({ok:true});}catch(e){res.status(500).json({error:'連携を解除できませんでした。'});}});
app.listen(PORT,'0.0.0.0',()=>console.log(`MailBox API listening on ${PORT}`));
