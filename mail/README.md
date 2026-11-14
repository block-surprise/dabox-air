# MailBox Cloud — Gmail / Yahoo!メール接続

このパッケージはMailBoxのフロントエンドと、Cloud Run上で動くメールAPIです。GitHub Pagesへ置いただけでは送受信できません。Firebase Authentication、Google Cloud、Firestore、Cloud Run、OAuth設定が必要です。

## 機能

- Gmail: Google OAuth 2.0で接続、受信一覧・本文取得・SMTPではなくGmail APIで送信
- Yahoo! JAPANメール: IMAP受信、SMTP送信
- Firebase Authentication IDトークンをAPIで検証し、メール接続情報をFirebase UIDごとにFirestore分離
- Gmailのrefresh token、Yahoo!メールのパスワードはAES-256-GCMで暗号化して保存
- 背景写真はブラウザのIndexedDBに保存

## Gmailを使うための準備

1. Google Cloud Consoleでプロジェクトを用意し、Gmail APIを有効化します。
2. OAuth同意画面を設定し、OAuthクライアントID（ウェブアプリ）を作成します。Google OAuthクライアントの承認済みリダイレクトURIに、Cloud Run APIの `/api/gmail/callback` を登録してください。
3. OAuth同意画面のテストユーザーに接続するGoogleアカウントを追加します。公開利用する場合は、GoogleのOAuth検証・必要なプライバシーポリシー等が必要になる場合があります。Gmailの読み取り権限は制限付き/機密性の高いスコープに該当することがあるため、公開前にGoogleの最新要件を確認してください。
4. Firebase Authenticationでログイン方法を有効化し、GitHub Pagesのドメインを承認済みドメインに追加します。`frontend/auth.js`のFirebase設定はご自身のFirebaseプロジェクトを使用してください。
5. Google CloudでCloud Run、Firestore Native mode、Cloud Buildを準備し、Cloud Run実行サービスアカウントにはFirestore読み書きの最小権限を付与します。
6. `backend/`をCloud Runへデプロイし、以下の環境変数を設定します。暗号化キーとOAuthクライアントシークレットはSecret Managerで管理し、GitHubへコミットしないでください。
   - `MAILBOX_ENCRYPTION_KEY`: 32バイトのランダム値を表す16進数64文字
   - `ALLOWED_ORIGINS`: GitHub Pagesの正確なオリジン（例 `https://YOUR-ACCOUNT.github.io`）
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`: `https://<Cloud Run URL>/api/gmail/callback`
   - `MAILBOX_FRONTEND_URL`: GitHub Pages上のメール画面URL（例 `https://YOUR-ACCOUNT.github.io/dabox-air/mail/frontend/index.html`）
7. `frontend/api-config.js` の `window.MAILBOX_API_BASE` にCloud RunのHTTPS URLを設定して公開します。
8. メール画面へログインし、「アカウントを追加」→「Gmail」を選んでGoogleの許可画面を完了します。接続完了後、Gmailアカウントを選択して受信一覧を確認します。

必要なOAuthスコープは受信一覧/本文の読み取りと送信のための `gmail.readonly`、`gmail.send` です。ユーザーが許可を取り消すと再接続が必要です。アプリは本番セキュリティ監査済みではありません。公開前にOAuth同意画面、データ削除、トークン失効、レート制限、監査・プライバシー対応を確認してください。

## Yahoo!メール

Yahoo!側でIMAP/SMTPアクセスを許可し、接続画面でYahoo! JAPANメールの情報を入力します。パスワードはHTTPS経由でAPIへ送られ、Firestore保存前に暗号化されます。

## 既知の制限

- Gmailの既読/スター変更、フォルダ操作、添付ファイル、ページング、送信済みフォルダ同期は未対応です。
- Yahoo!メールの既読/スター/フォルダ移動、添付ファイル、ページング、送信済み同期は未対応です。
- Gmail OAuthの公開利用はGoogleの同意画面審査/検証の対象になる可能性があります。
- 実アカウントでOAuth接続、受信、本文表示、送信をテストしてから利用してください。
