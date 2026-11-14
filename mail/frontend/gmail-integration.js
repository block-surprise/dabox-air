(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const api = async (path, options={}) => {
    const base = (window.MAILBOX_API_BASE || '').replace(/\/$/, '');
    if (!base) throw new Error('API URLが未設定です。mail/README.mdのCloud Run設定を確認してください。');
    if (!window.mailboxAuth?.getIdToken) throw new Error('先にMailBoxへログインしてください。');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${await window.mailboxAuth.getIdToken()}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(base + path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'メールAPIでエラーが発生しました。');
    return data;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const notify = message => {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  };
  let gmailAccounts = [];
  let activeGmail = null;
  let activeFolder = 'inbox';

  function setGmailStatusFromRedirect() {
    const params = new URLSearchParams(location.search);
    if (!params.has('gmail')) return;
    const result = params.get('gmail');
    history.replaceState({}, '', location.pathname + location.hash);
    if (result === 'connected') notify('Gmailを接続しました');
    else if (result === 'error') notify('Gmailの接続に失敗しました。OAuth設定をご確認ください');
    else if (result === 'denied') notify('Gmailへのアクセスは許可されませんでした');
  }
  async function connectGmail() {
    try {
      const { url } = await api('/api/gmail/connect');
      location.assign(url);
    } catch (error) { notify(error.message); }
  }
  function renderGmailAccounts() {
    const list = $('#accountList');
    if (!list) return;
    list.querySelectorAll('[data-gmail-account="true"]').forEach(node => node.remove());
    gmailAccounts.forEach(account => {
      const button = document.createElement('button');
      button.className = 'account' + (activeGmail?.id === account.id ? ' active' : '');
      button.dataset.gmailAccount = 'true';
      button.dataset.accountId = account.id;
      button.innerHTML = `<span class="avatar gmail">G</span><span class="account-text"><b>${esc(account.name || 'Gmail')}</b><small>${esc(account.email)}</small></span><i></i>`;
      list.append(button);
    });
  }
  async function loadGmailAccounts() {
    try {
      const accounts = await api('/api/accounts');
      gmailAccounts = accounts.filter(account => account.provider === 'Gmail');
      renderGmailAccounts();
      if (!activeGmail && gmailAccounts.length) {
        const params = new URLSearchParams(location.search);
        if (params.get('gmail') === 'connected') selectGmail(gmailAccounts[0]);
      }
    } catch (error) {
      if (window.mailboxAuth) console.warn('Gmail account list unavailable:', error.message);
    }
  }
  function folderLabel(folder) {
    return { inbox:'INBOX', starred:'STARRED', sent:'SENT', drafts:'DRAFT', spam:'SPAM', trash:'TRASH', archive:'ARCHIVE' }[folder] || 'INBOX';
  }
  async function renderGmailMessages() {
    if (!activeGmail) return;
    const list = $('#mailList');
    if (!list) return;
    list.innerHTML = '<div class="muted" style="padding:20px">Gmailを読み込んでいます…</div>';
    try {
      const data = await api(`/api/gmail/${encodeURIComponent(activeGmail.id)}/messages?folder=${encodeURIComponent(activeFolder)}`);
      const messages = data.messages || [];
      list.innerHTML = messages.map(message => `<div class="mail-row ${message.unread ? 'unread' : ''}" data-gmail-message="${esc(message.id)}" data-id="${esc(message.id)}"><input class="check" type="checkbox" aria-label="選択"><button class="star ${message.star ? 'on' : ''}" data-gmail-star="${esc(message.id)}" aria-label="スター">★</button><div class="mail-avatar">${esc((message.from || 'G').slice(0,1))}</div><div class="sender">${esc(message.from)}</div><div class="mail-preview"><span class="subject">${esc(message.subject)}</span><span class="snippet"> — ${esc(message.snippet)}</span></div><div class="date">${esc(message.date ? new Date(message.date).toLocaleDateString('ja-JP') : '')}</div></div>`).join('');
      $('#emptyState')?.classList.toggle('hidden', messages.length > 0);
      if (!messages.length) list.innerHTML = '';
      const title = $('#folderTitle');
      if (title) title.textContent = `${folderLabel(activeFolder) === 'INBOX' ? '受信トレイ' : activeFolder} — ${activeGmail.email}`;
    } catch (error) { list.innerHTML = `<p class="muted" style="padding:20px">${esc(error.message)}</p>`; }
  }
  function selectGmail(account) {
    activeGmail = account;
    renderGmailAccounts();
    renderGmailMessages();
    const composeFrom = $('#fromAccount');
    if (composeFrom) {
      const existing = [...composeFrom.options].find(option => option.value === `gmail:${account.id}`);
      if (!existing) composeFrom.add(new Option(`${account.email} (Gmail)`, `gmail:${account.id}`));
      composeFrom.value = `gmail:${account.id}`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setGmailStatusFromRedirect();
    // Gmail's legacy provider choice was a local-only placeholder. Intercept it
    // and start Google's OAuth flow instead of creating a fake account.
    document.addEventListener('click', event => {
      const provider = event.target.closest('[data-provider]');
      if (provider?.dataset.provider === 'Gmail') {
        event.preventDefault(); event.stopImmediatePropagation();
        connectGmail();
        return;
      }
      const account = event.target.closest('[data-gmail-account="true"]');
      if (account) {
        event.preventDefault(); event.stopImmediatePropagation();
        const found = gmailAccounts.find(item => item.id === account.dataset.accountId);
        if (found) selectGmail(found);
        return;
      }
      if (event.target.closest('#refreshBtn') && activeGmail) {
        event.preventDefault(); event.stopImmediatePropagation(); renderGmailMessages();
      }
      if (event.target.closest('[data-folder]') && activeGmail) {
        activeFolder = event.target.closest('[data-folder]').dataset.folder;
        setTimeout(renderGmailMessages, 0);
      }
      if (event.target.closest('#composeBtn') && activeGmail) {
        const option = $('#fromAccount');
        if (option) setTimeout(() => { option.value = `gmail:${activeGmail.id}`; }, 0);
      }
    }, true);

    document.addEventListener('click', async event => {
      const row = event.target.closest('[data-gmail-message]');
      if (!row || !activeGmail) return;
      if (event.target.closest('button,input')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try {
        const message = await api(`/api/gmail/${encodeURIComponent(activeGmail.id)}/messages/${encodeURIComponent(row.dataset.gmailMessage)}`);
        $('#detailSubject').textContent = message.subject || '(件名なし)';
        $('#detailFrom').textContent = `${message.from || ''} ${message.date ? new Date(message.date).toLocaleString('ja-JP') : ''}`;
        $('#detailBody').textContent = message.text || '';
        $('#overlay')?.classList.remove('hidden');
        $('#mailDetailModal')?.classList.remove('hidden');
      } catch (error) { notify(error.message); }
    }, true);

    $('#composeForm')?.addEventListener('submit', async event => {
      const selected = $('#fromAccount')?.value || '';
      const accountId = selected.startsWith('gmail:') ? selected.slice(6) : activeGmail?.id;
      if (!accountId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const form = event.currentTarget;
      const inputs = form.querySelectorAll('input');
      const button = form.querySelector('[type="submit"]');
      const data = { to: inputs[0]?.value || '', subject: inputs[1]?.value || '', text: form.querySelector('textarea')?.value || '' };
      if (button) button.disabled = true;
      try {
        await api(`/api/gmail/${encodeURIComponent(accountId)}/send`, { method: 'POST', body: JSON.stringify(data) });
        $('#composeModal')?.classList.add('hidden'); $('#overlay')?.classList.add('hidden');
        form.reset(); notify('Gmailから送信しました');
        if (activeGmail?.id === accountId && activeFolder === 'sent') renderGmailMessages();
      } catch (error) { notify(error.message); }
      finally { if (button) button.disabled = false; }
    }, true);

    const accountList = $('#accountList');
    if (accountList) new MutationObserver(renderGmailAccounts).observe(accountList, { childList: true });
    loadGmailAccounts();
    window.addEventListener('mailbox-auth-changed', event => {
      if (event.detail?.user) loadGmailAccounts();
      else { gmailAccounts = []; activeGmail = null; renderGmailAccounts(); }
    });

    // Background photos use IndexedDB (larger quota than localStorage) and a
    // translucent white wash. The old app.js handler used an opaque gradient.
    const input = $('#backgroundInput');
    const choose = $('#backgroundUploadBtn');
    const main = $('.main');
    const showPhoto = src => {
      if (!main) return;
      document.body.classList.add('has-bg');
      main.style.backgroundImage = `linear-gradient(rgba(255,255,255,.10), rgba(255,255,255,.10)), url("${src}")`;
      main.style.backgroundSize = 'cover, cover';
      main.style.backgroundPosition = 'center, center';
      main.style.backgroundRepeat = 'no-repeat, no-repeat';
    };
    const openDb = () => new Promise((resolve, reject) => {
      const request = indexedDB.open('mailbox-settings', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('photos');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const photoStore = async (mode, value) => {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('photos', mode);
        const store = tx.objectStore('photos');
        const request = mode === 'readwrite' ? (value === null ? store.delete('background') : store.put(value, 'background')) : store.get('background');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
      });
    };
    photoStore('readonly').then(saved => { if (saved) showPhoto(saved); }).catch(error => console.warn('Background photo restore failed:', error));
    if (input) {
      input.onchange = null;
      input.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) return notify('画像ファイルを選択してください');
        if (file.size > 25 * 1024 * 1024) return notify('写真は25MB以下を選択してください');
        try {
          const source = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
          });
          const image = await new Promise((resolve, reject) => {
            const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('画像を開けませんでした')); img.src = source;
          });
          const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('写真を変換できませんでした')), 'image/jpeg', .82));
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
          });
          await photoStore('readwrite', dataUrl);
          showPhoto(dataUrl); notify('背景写真を設定しました');
        } catch (error) { console.error(error); notify(error.message || '背景写真を保存できませんでした'); }
      });
    }
    if (choose && input) choose.onclick = event => { event.preventDefault(); input.click(); };
    $('#clearBackground')?.addEventListener('click', async () => {
      try { await photoStore('readwrite', null); } catch (error) { console.warn(error); }
      document.body.classList.remove('has-bg');
      if (main) main.style.backgroundImage = '';
      notify('背景写真を解除しました');
    });
  });
})();
