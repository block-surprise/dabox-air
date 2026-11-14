/* Set this to the HTTPS URL of your deployed Cloud Run service, without a trailing slash. */
window.MAILBOX_API_BASE = '';

// MailBox UI fixes: keep account actions in Settings, make the mobile drawer
// reachable on short screens, and store a compressed background photo.
document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    @media (max-width: 640px) {
      #sidebar {
        box-sizing: border-box;
        max-height: 100dvh;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior-y: contain;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
      }
    }
    #settingsModal #mailbox-auth-logout {
      position: static;
      inset: auto;
      z-index: auto;
      display: block;
      width: 100%;
      margin: 10px 0 0;
      padding: 11px 13px;
      border: 1px solid var(--line, #e7edf4);
      border-radius: 10px;
      background: var(--surface-2, #f1f6fc);
      color: var(--text, #24364a);
      font: inherit;
      text-align: center;
    }
  `;
  document.head.append(style);

  const settingsBody = document.querySelector('#settingsModal .settings-body');
  if (settingsBody) {
    const accountGroup = document.createElement('div');
    accountGroup.className = 'setting-group';
    accountGroup.innerHTML = '<h3>セッション</h3>';
    settingsBody.append(accountGroup);

    const placeLogout = () => {
      const logout = document.getElementById('mailbox-auth-logout');
      if (logout && logout.parentElement !== accountGroup) accountGroup.append(logout);
    };
    placeLogout();
    new MutationObserver(placeLogout).observe(document.body, { childList: true, subtree: true });
  }

  const input = document.getElementById('backgroundInput');
  if (input) {
    input.onchange = async event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        window.mailboxToast?.('画像ファイルを選択してください');
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        window.mailboxToast?.('画像は15MB以下を選択してください');
        return;
      }

      try {
        const source = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('画像を読み込めませんでした'));
          reader.readAsDataURL(file);
        });
        const image = await new Promise((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve(element);
          element.onerror = () => reject(new Error('画像を開けませんでした'));
          element.src = source;
        });
        const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const compressed = await new Promise((resolve, reject) => {
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像を変換できませんでした')), 'image/jpeg', 0.82);
        });
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('画像を保存できませんでした'));
          reader.readAsDataURL(compressed);
        });
        localStorage.setItem('mb_background', dataUrl);
        document.body.classList.add('has-bg');
        const main = document.querySelector('.main');
        if (main) {
          const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#dcefff';
          main.style.backgroundImage = `linear-gradient(color-mix(in srgb, ${accent}, white 24%), color-mix(in srgb, ${accent}, white 24%)), url("${dataUrl}")`;
        }
        document.getElementById('toast')?.replaceChildren(document.createTextNode('写真を背景に設定しました'));
        const toast = document.getElementById('toast');
        if (toast) {
          toast.classList.add('show');
          clearTimeout(window.toastTimer);
          window.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
        }
      } catch (error) {
        console.error('Background photo could not be saved:', error);
        const toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = '写真を保存できませんでした。容量を空けてから再度お試しください。';
          toast.classList.add('show');
          clearTimeout(window.toastTimer);
          window.toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
        }
      }
    };
  }
});
