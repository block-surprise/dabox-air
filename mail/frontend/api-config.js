/* Set this to the HTTPS URL of your deployed Cloud Run service, without a trailing slash. */
window.MAILBOX_API_BASE = '';

// UI fixes for the mail frontend. app.js and auth.js initialize their controls
// before DOMContentLoaded, so install these overrides after their setup runs.
document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    @media (max-width: 640px) {
      #sidebar {
        box-sizing: border-box;
        max-height: 100vh;
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
    const group = document.createElement('div');
    group.className = 'setting-group';
    group.innerHTML = '<h3>セッション</h3>';
    settingsBody.append(group);
    const moveLogoutIntoSettings = () => {
      const logout = document.getElementById('mailbox-auth-logout');
      if (logout && logout.parentElement !== group) group.append(logout);
    };
    moveLogoutIntoSettings();
    new MutationObserver(moveLogoutIntoSettings).observe(document.body, { childList: true, subtree: true });
  }

  const backgroundInput = document.getElementById('backgroundInput');
  const backgroundButton = document.getElementById('backgroundUploadBtn');
  const main = document.querySelector('.main');
  const toast = message => {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  };
  const showBackground = dataUrl => {
    if (!main) return;
    document.body.classList.add('has-bg');
    // Keep the tint translucent; an opaque gradient hides the selected photo.
    main.style.backgroundImage = `linear-gradient(color-mix(in srgb, var(--accent), transparent 38%), color-mix(in srgb, var(--accent), transparent 38%)), url("${dataUrl}")`;
    main.style.backgroundSize = 'cover, cover';
    main.style.backgroundPosition = 'center, center';
    main.style.backgroundRepeat = 'no-repeat, no-repeat';
  };

  // Reapply saved photos after app.js, whose old opaque gradient otherwise covers them.
  try {
    const savedPhoto = localStorage.getItem('mb_background');
    if (savedPhoto) showBackground(savedPhoto);
  } catch (error) {
    console.warn('Could not restore saved background photo:', error);
  }

  if (backgroundButton && backgroundInput) {
    backgroundButton.addEventListener('click', event => {
      event.preventDefault();
      backgroundInput.click();
    });
    backgroundInput.addEventListener('change', async event => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) return toast('画像ファイルを選択してください');
      if (file.size > 20 * 1024 * 1024) return toast('画像は20MB以下を選択してください');

      try {
        const source = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('画像を読み込めませんでした'));
          reader.readAsDataURL(file);
        });
        const image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('画像を開けませんでした'));
          img.src = source;
        });
        const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('画像を変換できませんでした');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob(result => result ? resolve(result) : reject(new Error('画像を圧縮できませんでした')), 'image/jpeg', 0.78);
        });
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('画像を保存できませんでした'));
          reader.readAsDataURL(blob);
        });

        // Avoid localStorage's small quota for photos. Fall back to it only if
        // IndexedDB is unavailable, and report a useful error if storage is full.
        try {
          localStorage.setItem('mb_background', dataUrl);
        } catch (storageError) {
          if (storageError.name !== 'QuotaExceededError' && storageError.name !== 'NS_ERROR_DOM_QUOTA_REACHED') throw storageError;
          throw new Error('保存容量が足りません。ほかのサイトデータを削除してからお試しください。');
        }
        showBackground(dataUrl);
        toast('背景写真を設定しました');
      } catch (error) {
        console.error('Background photo upload failed:', error);
        toast(error.message || '背景写真を設定できませんでした');
      }
    });
  }

  document.getElementById('clearBackground')?.addEventListener('click', () => {
    try { localStorage.removeItem('mb_background'); } catch (error) { console.warn(error); }
    document.body.classList.remove('has-bg');
    if (main) {
      main.style.backgroundImage = '';
      main.style.backgroundSize = '';
      main.style.backgroundPosition = '';
      main.style.backgroundRepeat = '';
    }
    toast('背景写真を解除しました');
  });
});
