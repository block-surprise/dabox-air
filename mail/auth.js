/* MailBox Firebase Authentication integration (Firebase JS SDK v13.3.0)
 * Configure Email/Password, Google, Microsoft and Apple providers in Firebase Console.
 * Microsoft and Apple require provider credentials configured in their respective consoles.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification,
  signOut, GoogleAuthProvider, OAuthProvider, signInWithRedirect,
  getRedirectResult, updateProfile
} from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBfwon4kiCkBc2KMnzH82viNWkRM5E1t8',
  authDomain: 'koyomi-96cd7.firebaseapp.com',
  projectId: 'koyomi-96cd7',
  storageBucket: 'koyomi-96cd7.firebasestorage.app',
  messagingSenderId: '237812391840',
  appId: '1:237812391840:web:c90d8873c053f634cb0ec5',
  measurementId: 'G-NZSLBRWPYX'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const $ = (s, root=document) => root.querySelector(s);
const gate = document.createElement('section');
gate.id = 'mailbox-auth-gate';
gate.innerHTML = `
<style>
#mailbox-auth-gate{position:fixed;inset:0;z-index:99999;background:#f4f8fc;display:grid;place-items:center;padding:20px;font-family:system-ui,-apple-system,sans-serif;color:#24364a}
#mailbox-auth-gate *{box-sizing:border-box}#mailbox-auth-gate .panel{width:min(420px,100%);background:white;border:1px solid #e3ebf3;border-radius:20px;padding:26px;box-shadow:0 18px 55px #27435b18}
#mailbox-auth-gate h1{font-size:25px;margin:0 0 6px}#mailbox-auth-gate p{color:#71849a;font-size:13px;line-height:1.6}
#mailbox-auth-gate label{display:block;font-size:12px;margin:14px 0 6px;color:#60758a}
#mailbox-auth-gate input{width:100%;min-height:46px;border:1px solid #dce5ee;border-radius:10px;padding:11px 12px;font-size:16px;background:white;color:#24364a}
#mailbox-auth-gate button{width:100%;min-height:44px;border:0;border-radius:10px;background:#8bbce8;color:#173e5e;font-weight:700;margin-top:10px;padding:10px;font-size:14px}
#mailbox-auth-gate button.secondary{background:#eef4fa;color:#456078}#mailbox-auth-gate button:disabled{opacity:.55}
#mailbox-auth-gate .row{display:grid;grid-template-columns:1fr 1fr;gap:9px}#mailbox-auth-gate .status{min-height:22px;font-size:12px;color:#a04444;white-space:pre-wrap}
#mailbox-auth-gate .small{font-size:11px;color:#8494a5}#mailbox-auth-gate .hidden{display:none!important}
#mailbox-auth-logout{display:block;width:100%;min-height:42px;margin:8px 0 0;padding:10px 14px;border:1px solid #e7caca;border-radius:10px;background:#fff7f7;color:#a34b4b;font-size:13px;font-weight:650;text-align:center}#mailbox-auth-logout.hidden{display:none!important}
</style>
<div class="panel">
 <h1>MailBox</h1><p>メールボックスにログインしてください。</p>
 <div id="mb-auth-form">
  <label for="mb-auth-email">メールアドレス</label><input id="mb-auth-email" type="email" autocomplete="email" required>
  <label for="mb-auth-password">パスワード</label><input id="mb-auth-password" type="password" autocomplete="current-password" required>
  <div class="row"><button id="mb-login">ログイン</button><button class="secondary" id="mb-signup">新規登録</button></div>
  <button class="secondary" id="mb-reset">パスワードをリセット</button>
  <p class="small">または外部アカウントでログイン</p>
  <button class="secondary" id="mb-google">Googleでログイン</button>
  <button class="secondary" id="mb-microsoft">Microsoftでログイン</button>
  <button class="secondary" id="mb-apple">Appleでログイン</button>
 </div>
 <div id="mb-auth-message" class="status" role="status"></div>
 <p class="small">新規登録後、確認メールが届く場合があります。</p>
</div>`;
document.addEventListener('DOMContentLoaded', () => document.body.append(gate));

const errorText = (e) => ({
  'auth/invalid-email':'メールアドレスの形式を確認してください。',
  'auth/invalid-credential':'メールアドレスまたはパスワードが違います。',
  'auth/email-already-in-use':'このメールアドレスはすでに登録されています。',
  'auth/weak-password':'パスワードは6文字以上にしてください。',
  'auth/too-many-requests':'試行回数が多すぎます。しばらくしてからお試しください。',
  'auth/popup-blocked':'ログイン画面が開けませんでした。もう一度お試しください。',
  'auth/operation-not-allowed':'このログイン方法はFirebase側でまだ有効になっていません。'
}[e.code] || `認証エラー: ${e.message || e.code || '不明なエラー'}`);
function status(message, bad=true){const el=$('#mb-auth-message',gate);if(el){el.textContent=message;el.style.color=bad?'#a04444':'#34734d';}}
function setBusy(b){gate.querySelectorAll('button').forEach(x=>x.disabled=b);}
async function run(fn){setBusy(true);try{await fn()}catch(e){status(errorText(e))}finally{setBusy(false)}}
function email(){return $('#mb-auth-email',gate).value.trim()}
function password(){return $('#mb-auth-password',gate).value}

$('#mb-login',gate).onclick=()=>run(async()=>{await signInWithEmailAndPassword(auth,email(),password())});
$('#mb-signup',gate).onclick=()=>run(async()=>{const c=await createUserWithEmailAndPassword(auth,email(),password());await sendEmailVerification(c.user);status('登録しました。確認メールを確認してください。',false)});
$('#mb-reset',gate).onclick=()=>run(async()=>{if(!email())throw new Error('先にメールアドレスを入力してください。');await sendPasswordResetEmail(auth,email());status('パスワード再設定メールを送信しました。',false)});
async function providerRedirect(provider){await signInWithRedirect(auth,provider)}
$('#mb-google',gate).onclick=()=>run(()=>providerRedirect(new GoogleAuthProvider()));
$('#mb-microsoft',gate).onclick=()=>run(()=>providerRedirect(new OAuthProvider('microsoft.com')));
const apple = new OAuthProvider('apple.com'); apple.addScope('email'); apple.addScope('name');
$('#mb-apple',gate).onclick=()=>run(()=>providerRedirect(apple));

getRedirectResult(auth).catch(e=>status(errorText(e)));
let logout=document.createElement('button');logout.id='mailbox-auth-logout';logout.type='button';logout.textContent='ログアウト';logout.className='hidden';logout.onclick=()=>run(()=>signOut(auth));
function placeLogout(){
  const settingsBody=document.querySelector('#settingsModal .settings-body');
  if(!settingsBody)return;
  let group=document.querySelector('#mailbox-logout-setting');
  if(!group){group=document.createElement('div');group.id='mailbox-logout-setting';group.className='setting-group';group.innerHTML='<h3>アカウント</h3><p class="tiny muted">MailBoxからログアウトします。</p>';settingsBody.append(group);}
  group.append(logout);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',placeLogout,{once:true});else placeLogout();

onAuthStateChanged(auth, async user=>{
  if(!document.body.contains(gate)) document.body.append(gate);
  gate.classList.toggle('hidden',!!user);
  placeLogout();
  logout.classList.toggle('hidden',!user);
  if(user){
    window.mailboxAuth={user,getIdToken:()=>user.getIdToken(),uid:user.uid};
    window.dispatchEvent(new CustomEvent('mailbox-auth-changed',{detail:{user,uid:user.uid}}));
  }else{
    window.mailboxAuth=null;
    window.dispatchEvent(new CustomEvent('mailbox-auth-changed',{detail:{user:null}}));
  }
});
